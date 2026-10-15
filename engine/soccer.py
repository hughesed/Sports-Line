"""Soccer match cards: the sportsbook feed (data/odds.json, SportsGameOdds) for the prices, ESPN's soccer scoreboards for the match itself.
Each card is keyed by its ESPN event id, so the page's live view, the practice-bet grader and the bot's settlement read the same ESPN summary
(soccer/<league>/summary?event=<id>) they read for every other sport. A feed match that ESPN does not list is left out (it could never be graded).

There is no ratings history for soccer in this app: the numbers are the book's. The expected goals of each side (lh, la) are fitted to the book's
no-vig 3-way result and its total-goals price with a Poisson model, which then prices what the book does not post the same way for every match:
alternate goal totals (under 3.5 / 4.5), team totals, double chance, both teams to score.
Never raises: any problem returns an empty list."""
import datetime, math, re, statistics, unicodedata

# SportsGameOdds league id -> (ESPN league slug, name on the card)
LEAGUES = {"EPL": ("eng.1", "Premier League"), "UEFA_CHAMPIONS_LEAGUE": ("uefa.champions", "Champions League"), "LA_LIGA": ("esp.1", "La Liga"),
           "BUNDESLIGA": ("ger.1", "Bundesliga"), "IT_SERIE_A": ("ita.1", "Serie A"), "FR_LIGUE_1": ("fra.1", "Ligue 1"), "MLS": ("usa.1", "MLS"),
           "LIGA_MX": ("mex.1", "Liga MX"), "UEFA_EUROPA_LEAGUE": ("uefa.europa", "Europa League")}
BOOK = "fanduel"
L_AVG, HFA = 1.3, 0.3            # battle ratings: league-average goals per side, home edge in goals

def _imp(a):
    return None if a is None else ((100 / (a + 100)) if a > 0 else (abs(a) / (abs(a) + 100)))

def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)

def pid_of(name):
    """the player id used on soccer cards: his normalised name (the feed and ESPN use different ids, the name is what both carry)"""
    return "n" + norm(name)

STOP = {"fc", "cf", "afc", "sc", "ac", "cd", "ss", "as", "us", "rc", "sv", "fk", "club", "de", "real", "the", "united", "city", "sporting", "athletic", "atletico", "calcio", "olympique", "stade"}
def _toks(name):
    w = re.sub(r"[^a-z ]", " ", unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()).split()
    return {x for x in w if len(x) > 2 and x not in STOP} or set(w)

def _same(a, b):
    ta, tb = _toks(a), _toks(b)
    if not ta or not tb: return False
    if ta & tb: return True
    na, nb = norm(a), norm(b)
    return len(na) >= 4 and len(nb) >= 4 and (na in nb or nb in na)

def _pick(side):
    """FanDuel's price (and line, link) for one side of a market, else the median of the other books -> (odds, line, link, src)"""
    bks = (side or {}).get("books") or {}
    b = bks.get(BOOK)
    if b and b.get("odds") is not None: return b["odds"], b.get("line"), b.get("link"), "FanDuel"
    od = [x["odds"] for x in bks.values() if x.get("odds") is not None]; ln = [x["line"] for x in bks.values() if x.get("line") is not None]
    if not od: return None, None, None, None
    return int(statistics.median(od)), (statistics.median(ln) if ln else None), None, "DraftKings"

# ---------------------------------------------------------------- Poisson goals
def _pmf(lam, n=11):
    out, p = [], math.exp(-lam)
    for k in range(n):
        out.append(p); p *= lam / (k + 1)
    return out

def probs(lh, la, total=2.5):
    """-> dict(h, d, a, over) for expected goals lh (home), la (away)"""
    ph, pa = _pmf(lh), _pmf(la); h = d = a = ov = 0.0
    for i, x in enumerate(ph):
        for j, y in enumerate(pa):
            p = x * y
            if i > j: h += p
            elif i == j: d += p
            else: a += p
            if i + j > total: ov += p
    return dict(h=h, d=d, a=a, over=ov)

def fit(p_h, p_d, p_a, total=None, p_over=None):
    """expected goals that reproduce the book's no-vig result and total prices (coarse grid, then a finer one around the best)"""
    best, bv = (1.4, 1.1), 1e9
    def err(lh, la):
        r = probs(lh, la, total if total is not None else 2.5)
        e = (r["h"] - p_h) ** 2 + (r["a"] - p_a) ** 2 + (0 if p_d is None else (r["d"] - p_d) ** 2)
        if p_over is not None and total is not None: e += 1.5 * (r["over"] - p_over) ** 2
        return e
    for step, span, center in ((0.1, None, None), (0.02, 0.12, True)):
        if center:
            rng_h = [best[0] + k * step for k in range(-6, 7)]; rng_a = [best[1] + k * step for k in range(-6, 7)]
        else:
            rng_h = rng_a = [0.2 + k * step for k in range(35)]
        for lh in rng_h:
            for la in rng_a:
                if lh <= 0.05 or la <= 0.05: continue
                v = err(lh, la)
                if v < bv: bv, best = v, (lh, la)
    return round(best[0], 3), round(best[1], 3)

def grid(lh, la, n=11):
    ph, pa = _pmf(lh, n), _pmf(la, n)
    return [[ph[i] * pa[j] for j in range(n)] for i in range(n)]

def p_of(G, fn):
    return sum(G[i][j] for i in range(len(G)) for j in range(len(G)) if fn(i, j))

def _est(p):
    """the app's estimated price for a chance p (a 4.5% margin on the shorter side)"""
    p = min(max(p, 0.01), 0.99); q = min(0.985, p + 0.045 * min(p, 1 - p))      # the margin taken from the short side, so a 94% leg is not priced like a 97% one
    return int(round(-100 * q / (1 - q))) if q >= 0.5 else int(round(100 * (1 - q) / q))

def markets(lh, la, book):
    """every soccer market the app offers, priced the same way for the page and the practice server:
    {ml3, dc, btts, tot{line: {over, under}}, tt{side: {line: {over, under}}}, hcp{line: {home, away}}}; each outcome {price, p, src}.
    book = {(market, key...): american price} where the sportsbook posts one (its price is used, the chance is always the model's, which is fitted to the book)."""
    G = grid(lh, la)
    def o(p, *k):
        b = book.get(k)
        return dict(price=int(b) if b is not None else _est(p), p=round(p, 4), src="FanDuel" if b is not None else "est.")
    ph, pd, pa = p_of(G, lambda i, j: i > j), p_of(G, lambda i, j: i == j), p_of(G, lambda i, j: i < j)
    out = dict(ml3=dict(home=o(ph, "ml", "home"), draw=o(pd, "ml", "draw"), away=o(pa, "ml", "away")),
               dc=dict(home=o(ph + pd, "dc", "home"), away=o(pa + pd, "dc", "away"), nodraw=o(ph + pa, "dc", "nodraw")),
               btts=dict(yes=o(p_of(G, lambda i, j: i > 0 and j > 0), "btts", "yes"), no=o(p_of(G, lambda i, j: i == 0 or j == 0), "btts", "no")),
               tot={}, tt=dict(home={}, away={}), hcp={})
    for ln in (0.5, 1.5, 2.5, 3.5, 4.5, 5.5):
        po = p_of(G, lambda i, j: i + j > ln)
        out["tot"][str(ln)] = dict(over=o(po, "tot", "over", ln), under=o(1 - po, "tot", "under", ln))
    for side in ("home", "away"):
        for ln in (0.5, 1.5, 2.5, 3.5):
            po = p_of(G, (lambda i, j: i > ln) if side == "home" else (lambda i, j: j > ln))
            out["tt"][side][str(ln)] = dict(over=o(po, "tt", side, "over", ln), under=o(1 - po, "tt", side, "under", ln))
    for ln in (-2.5, -1.5, -0.5, 0.5, 1.5, 2.5):             # home handicap; the away side is the mirror
        pc = p_of(G, lambda i, j: i - j + ln > 0)
        out["hcp"][str(ln)] = dict(home=o(pc, "hcp", "home", ln), away=o(1 - pc, "hcp", "away", ln))
    return out

# ---------------------------------------------------------------- ESPN scoreboards
def _espn_events(slug, now, curl):
    d0 = (now - datetime.timedelta(hours=8)).strftime("%Y%m%d"); d1 = (now + datetime.timedelta(days=2)).strftime("%Y%m%d")
    j = curl(f"https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard?dates={d0}-{d1}&limit=200", tries=2, timeout=8)
    out = []
    for ev in (j or {}).get("events") or []:
        try:
            c = ev["competitions"][0]; cs = c["competitors"]
            h = next(x for x in cs if x.get("homeAway") == "home"); a = next(x for x in cs if x.get("homeAway") == "away")
            out.append(dict(id=str(ev["id"]), date=ev.get("date") or c.get("date"), h=h, a=a, state=((ev.get("status") or {}).get("type") or {}).get("state")))
        except Exception:
            continue
    return out

def _match(ev, espn_evs):
    try: st = datetime.datetime.fromisoformat((ev.get("start") or "").replace("Z", "+00:00"))
    except Exception: return None
    for e in espn_evs:
        try: t = datetime.datetime.fromisoformat(str(e["date"]).replace("Z", "+00:00"))
        except Exception: continue
        if abs((t - st).total_seconds()) > 3 * 3600: continue
        hn = (e["h"].get("team") or {}); an = (e["a"].get("team") or {})
        sh = _same(ev.get("homeName") or ev.get("home"), hn.get("displayName") or hn.get("name")) or norm(ev.get("home")) == norm(hn.get("abbreviation")) != ""
        sa = _same(ev.get("awayName") or ev.get("away"), an.get("displayName") or an.get("name")) or norm(ev.get("away")) == norm(an.get("abbreviation")) != ""
        if (sh and sa) or ((sh or sa) and abs((t - st).total_seconds()) <= 1800):       # a team plays once at a time: one side and the kickoff are enough
            return e
    return None

def _team(c):
    t = c.get("team") or {}
    color = "#" + t["color"] if t.get("color") and re.fullmatch(r"[0-9a-fA-F]{6}", t["color"]) else "#334155"
    alt = "#" + t["alternateColor"] if t.get("alternateColor") and re.fullmatch(r"[0-9a-fA-F]{6}", t["alternateColor"]) else "#ffffff"
    rec = ""
    for r in c.get("records") or []:
        if r.get("summary"): rec = r["summary"]; break
    nm = t.get("displayName") or t.get("name") or "Team"
    return dict(id=str(t.get("id") or norm(nm)), abbr=(t.get("abbreviation") or nm[:3]).upper()[:4], name=nm, short=t.get("shortDisplayName") or nm.split()[-1], color=color, alt=alt,
                logo=t.get("logo") or "", record=rec, recent=[], pf=0, pa=0, offBase=50, defBase=50, offRank=None, defRank=None, gp=0, injuries=[],
                injImpact=dict(off=0.0, deff=0.0, notes=[]), off=50, **{"def": 50})

# ---------------------------------------------------------------- one card
def card(ev, e, slug, lname, now):
    from timeutil import ET
    import fanduel as FD
    m3 = ev.get("m3") or {}; mn = ev.get("main") or {}
    oh, _, lkh, srh = _pick(m3.get("home")); od, _, lkd, _ = _pick(m3.get("draw")); oa, _, lka, _ = _pick(m3.get("away"))
    if oh is None or oa is None:          # no 3-way market: nothing honest to show for a sport where the draw is a real result
        return None
    ih, id_, ia = _imp(oh), _imp(od) if od is not None else None, _imp(oa)
    tot_imp = ih + ia + (id_ or 0)
    p_h, p_a = ih / tot_imp, ia / tot_imp; p_d = (id_ / tot_imp) if id_ else max(0.0, 1 - p_h - p_a)
    to, lo, lko, srt = _pick((mn.get("total") or {}).get("over")); tu, lu, lku, _ = _pick((mn.get("total") or {}).get("under"))
    total = lo if lo is not None else (lu if lu is not None else 2.5)
    p_over = None
    if to is not None and tu is not None: io, iu = _imp(to), _imp(tu); p_over = io / (io + iu)
    lh, la = fit(p_h, p_d, p_a, total, p_over)
    sph, lsh, lks_h, srs = _pick((mn.get("spread") or {}).get("home")); spa, lsa, lks_a, _ = _pick((mn.get("spread") or {}).get("away"))
    sprH = lsh if lsh is not None else (-lsa if lsa is not None else None)
    book = {("ml", "home"): oh, ("ml", "away"): oa}
    if od is not None: book[("ml", "draw")] = od
    dch, _, lkdh, _ = _pick(m3.get("home+draw")); dca, _, lkda, _ = _pick(m3.get("away+draw"))
    by, bn = _pick((ev.get("btts") or {}).get("yes")), _pick((ev.get("btts") or {}).get("no"))
    tt = {}
    for side in ("home", "away"):
        x = (ev.get("tt") or {}).get(side) or {}
        o_, l_, _, _ = _pick(x.get("over")); u_, lu_, _, _ = _pick(x.get("under"))
        if l_ is not None or lu_ is not None:
            tt[side] = dict(line=l_ if l_ is not None else lu_, over=o_, under=u_)
            if o_ is not None: book[("tt", side, "over", float(tt[side]["line"]))] = o_
            if u_ is not None: book[("tt", side, "under", float(tt[side]["line"]))] = u_
    if dch is not None: book[("dc", "home")] = dch
    if dca is not None: book[("dc", "away")] = dca
    if by[0] is not None: book[("btts", "yes")] = by[0]
    if bn[0] is not None: book[("btts", "no")] = bn[0]
    if to is not None: book[("tot", "over", float(total))] = to
    if tu is not None: book[("tot", "under", float(total))] = tu
    if sprH is not None and sph is not None: book[("hcp", "home", float(sprH))] = sph
    if sprH is not None and spa is not None: book[("hcp", "away", float(sprH))] = spa
    mk = markets(lh, la, book)
    if sprH is None or sph is None or spa is None:         # no handicap posted: the -0.5 / +0.5 handicap (= win) priced by the model, so every card has a spread
        sprH = -0.5 if lh >= la else 0.5; sph = mk["hcp"][str(sprH)]["home"]["price"]; spa = mk["hcp"][str(sprH)]["away"]["price"]; srs = "est."
    try: st = datetime.datetime.fromisoformat((ev.get("start") or "").replace("Z", "+00:00"))
    except Exception: return None
    a, h = _team(e["a"]), _team(e["h"])
    stt = st.astimezone(ET); margin = lh - la
    src = {"ml": srh, "tot": srt}
    if srs: src["spr"] = srs
    lines = dict(dk=dict(ml=dict(home=None, away=None), spr=dict(home=None, away=None), tot=dict(over=None, under=None)),
                 mlHome=oh, mlAway=oa, mlDraw=od, dcHome=dch, dcAway=dca, threeWay=True,
                 sprHome=sprH, sprAway=(-sprH if sprH is not None else None), prHome=sph if sprH is not None else None, prAway=spa if sprH is not None else None,
                 total=total, over=to if to is not None else -110, under=tu if tu is not None else -110,
                 bttsYes=by[0], bttsNo=bn[0], tt=tt, soc=mk, esl=slug, src={k: v for k, v in src.items() if v},
                 fd={"ml": {"home": lkh, "away": lka, "draw": lkd}, "dc": {"home": lkdh, "away": lkda}, "spr": {"home": lks_h, "away": lks_a}, "tot": {"over": lko, "under": lku}})
    cr = dict(projHome=round(lh, 2), projAway=round(la, 2), projHomeNoInj=round(lh, 2), projAwayNoInj=round(la, 2), projTotal=round(lh + la, 2), projMargin=round(margin, 2),
              pHome=round(p_h, 3), pDraw=round(p_d, 3), pAway=round(p_a, 3), bookHome=round(p_h / max(p_h + p_a, 1e-6), 3), leans=[], soc=dict(lh=lh, la=la),
              learn=dict(rawMargin=round(margin, 2), rawTotal=round(lh + la, 2), baseMargin=round(margin, 2), baseTotal=round(lh + la, 2), injMargin=0, injTotal=0, bookMargin=round(margin, 2),
                         w=dict(m=0, t=0, p=0), n=0, sd=dict(m=1.6, t=1.6), leanStats={}, test={}, rk=dict(home=None, away=None), rt=dict(home=dict(o=0, d=0, gp=0), away=dict(o=0, d=0, gp=0))),
              matchups=[], ctx=dict(away=dict(off=0, deff=0, items=[], rest={}, stars=[]), home=dict(off=0, deff=0, items=[], rest={}, stars=[])))
    c = dict(id=e["id"], lg="soccer", key="soccer", league=lname, esl=slug, title=f"{a['name']} at {h['name']}", start=stt.strftime("%-I:%M %p ET"), startDate=stt.strftime("%a %b %-d"),
             iso=st.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), day=stt.strftime("%Y-%m-%d"), venue="", tv="", series=None,
             note="Book lines (FanDuel first). Expected goals " + f"{h['abbr']} {lh:.2f}, {a['abbr']} {la:.2f}" + " come from the book's 3-way and total prices; the moneyline is the 90-minute result (a draw loses both sides).",
             n=20, teams=dict(away=a, home=h), lines=lines, crossroads=cr, players=[], bookOnly=True, oddsId=ev.get("id"))
    if (ev.get("eventLinks") or {}).get(BOOK): c["fdEvent"] = ev["eventLinks"][BOOK]
    try:
        ps = FD._synth_players(c, ev, FD._props_by_player(ev))
        for p in ps:
            p["id"] = pid_of(p["name"]); p["pos"] = "GK" if any(s["key"] == "saves" for s in p["stats"]) else ""; p["fam"] = p["pos"] or "X"
        seen = set(); ps = [p for p in ps if not (p["id"] in seen or seen.add(p["id"]))]
        if ps: c["players"] = ps; c["feedProps"] = True
    except Exception:
        pass
    return c

def cards(odds, now, curl=None, cap=24, log=None):
    """-> list of soccer cards (matches in the next ~40 hours, plus ones that kicked off in the last 2 hours)"""
    try:
        if curl is None:
            import espn; curl = espn.curl
        evs = [e for e in (odds or {}).get("events") or [] if e.get("league") in LEAGUES and not e.get("final")]
        want = {}
        for ev in evs:
            try: st = datetime.datetime.fromisoformat((ev.get("start") or "").replace("Z", "+00:00"))
            except Exception: continue
            if -2 * 3600 <= (st - now).total_seconds() <= 40 * 3600: want.setdefault(ev["league"], []).append(ev)
        out, miss = [], 0
        for lg, lst in want.items():
            slug, lname = LEAGUES[lg]
            espn_evs = _espn_events(slug, now, curl)
            for ev in lst:
                e = _match(ev, espn_evs)
                if not e or e.get("state") == "post": miss += 1; continue
                try: c = card(ev, e, slug, lname, now)
                except Exception: c = None
                if c: out.append(c)
        out.sort(key=lambda c: c["iso"]); seen = set(); res = []
        for c in out:
            if c["id"] in seen: continue
            seen.add(c["id"]); res.append(c)
        if log: log(f"  soccer: {len(res)} match cards" + (f" ({miss} feed matches not found on ESPN, left out)" if miss else ""))
        return res[:cap]
    except Exception as ex:
        if log: log(f"  soccer failed: {type(ex).__name__}: {ex}"[:200])
        return []

# ---------------------------------------------------------------- battle ratings
def sim_sport(cards):
    """-> the sim.json entry for soccer: every team of a match on the board, rated so that its real fixture reproduces the book's expected goals
    (o = attack, d = goals it lets in, both in goals above the league average and split evenly; the home edge is L_AVG's hfa)."""
    teams, used = [], set()
    for c in cards or []:
        try:
            s = c["crossroads"]["soc"]; fH = s["lh"] - HFA / 2; fA = s["la"] + HFA / 2
            for side, of, df in (("home", fH, fA), ("away", fA, fH)):
                t = c["teams"][side]; ab = t["abbr"]; n = 1
                while ab in used: n += 1; ab = (t["abbr"][:3] + str(n))[:4]
                used.add(ab)
                teams.append(dict(abbr=ab, id=t["id"], name=t["name"], short=t["short"], color=t["color"], logo=t.get("logo") or "", league=c.get("league"),
                                  o=round((of - L_AVG) / 2, 3), d=round((df - L_AVG) / 2, 3), gp=0, inj=dict(out=[], q=[], offAdj=0.0, defAdj=0.0), props=False))
        except Exception:
            continue
    return dict(L=L_AVG, hfa=HFA, season=None, teams=teams, players={}) if teams else None

# ---------------------------------------------------------------- finals (the bot's settlement)
ROSTER_STAT = {"totalGoals": "gls", "goalAssists": "ast", "totalShots": "shots", "shotsOnTarget": "sog", "saves": "saves",
               "totalPasses": "passes", "passes": "passes", "accuratePasses": None, "totalTackles": "tkl", "tackles": "tkl", "effectiveTackles": None}

def box(s):
    """ESPN soccer summary -> (home goals, away goals, {pid: {stat: value}}, set of pids that did not play). pid = pid_of(name)"""
    comp = s["header"]["competitions"][0]
    home = next(c for c in comp["competitors"] if c.get("homeAway") == "home"); away = next(c for c in comp["competitors"] if c.get("homeAway") == "away")
    def toi(x):
        try: return int(float(str(x)))
        except Exception: return 0
    p, dnp = {}, set()
    for r in s.get("rosters") or []:
        for a in r.get("roster") or []:
            ath = a.get("athlete") or {}; nm = ath.get("displayName") or ath.get("fullName")
            if not nm: continue
            pid = pid_of(nm); played = bool(a.get("starter")) or bool(a.get("subbedIn"))
            d = {}
            for x in a.get("stats") or []:
                k = ROSTER_STAT.get(x.get("name"))
                if k: d[k] = toi(x.get("value") if x.get("value") is not None else x.get("displayValue"))
            if played: p[pid] = d
            else: dnp.add(pid)
    return toi(home.get("score")), toi(away.get("score")), p, dnp

def final_of(g, curl):
    slug = g.get("esl") or ((g.get("lines") or {}).get("esl"))
    if not slug: return None
    s = curl(f"https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/summary?event={g['gid']}", tries=2, timeout=8)
    if not s or not s.get("header"): return None
    st = ((s["header"]["competitions"][0].get("status") or {}).get("type") or {})
    if st.get("state") != "post" and not st.get("completed"): return None
    return box(s)
