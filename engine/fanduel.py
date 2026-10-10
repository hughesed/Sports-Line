"""FanDuel as the main book. Takes the sportsbook feed (data/odds.json, SportsGameOdds) and puts FanDuel's numbers on the slate:
  * game lines: moneyline, spread and total (prices and links) replace the ESPN/DraftKings numbers whenever FanDuel lists them (the other book stays as the fallback, and lines.src says which book each market came from);
  * player props: on games with ESPN player cards, each stat's line and price becomes FanDuel's; on games with NO player cards (college football, hockey, baseball) the players
    FanDuel lists become player cards of their own, so the same-game-parlay builder has props to build from. Those players have no game log here: the chance comes from FanDuel's no-vig price,
    alternate rungs are the model's estimate around FanDuel's line (marked est.).
Never raises into the caller: apply() returns a short status string and leaves any card it cannot match as it was."""
import math, re

KEYLG = {"nfl": "NFL", "cfb": "NCAAF", "nba": "NBA", "cbb": "NCAAB", "mlb": "MLB", "wnba": "WNBA", "nhl": "NHL"}
BOOK = "fanduel"
LABEL = {"passYds": "Pass yds", "passTD": "Pass TD", "rushYds": "Rush yds", "recYds": "Rec yds", "rec": "Receptions", "pts": "Points", "ast": "Assists", "reb": "Rebounds",
         "fg3": "3-pointers", "hits": "Hits", "hr": "Home runs", "rbi": "RBI", "k": "Strikeouts", "pra": "Pts+reb+ast", "pr": "Pts+reb", "pa": "Pts+ast", "ra": "Reb+ast"}
POS = {"passYds": "QB", "passTD": "QB", "rushYds": "RB", "recYds": "WR", "rec": "WR", "pts": "", "ast": "", "k": "P", "hits": "B", "hr": "B", "rbi": "B"}
REL_SD = {"passYds": 0.28, "rushYds": 0.55, "recYds": 0.62}        # yardage spread relative to the line; counting stats use a Poisson-like spread
MAX_PLAYERS_PER_TEAM = 14

def _n(s): return re.sub(r"[^a-z]", "", (s or "").lower())
def _imp(a): return None if a is None else ((-a) / (-a + 100) if a < 0 else 100 / (a + 100))
def _am(p):
    p = min(max(p, 0.01), 0.99)
    return int(round(-100 * p / (1 - p))) if p >= 0.5 else int(round(100 * (1 - p) / p))
def _phi(z): return 0.5 * (1 + math.erf(z / math.sqrt(2)))
def _clamp(x, a, b): return max(a, min(b, x))
def _ppf(p):                                         # inverse normal by bisection (only a handful of calls per card)
    lo, hi = -6.0, 6.0
    for _ in range(50):
        mid = (lo + hi) / 2
        if _phi(mid) < p: lo = mid
        else: hi = mid
    return (lo + hi) / 2
def _est_price(p): return _am(min(0.97, p * 1.045))

def _team_eq(ev, side, t):
    ab, nm = _n(ev.get(side)), _n(ev.get(side + "Name"))
    if ab and ab == _n(t.get("abbr")): return True
    if not nm: return False
    return nm in (_n(t.get("name")), _n(t.get("short")), _n(t.get("loc")))

def _started(g, now):
    import datetime
    try: return datetime.datetime.fromisoformat(g["iso"].replace("Z", "+00:00")) <= now
    except Exception: return False

def find_event(g, events):
    lg = KEYLG.get(g.get("key") or g.get("lg"))
    if not lg: return None
    try: import datetime; gt = datetime.datetime.fromisoformat(g["iso"].replace("Z", "+00:00"))
    except Exception: gt = None
    for e in events:
        if e.get("league") != lg: continue
        if gt is not None:
            try:
                st = datetime.datetime.fromisoformat((e.get("start") or "").replace("Z", "+00:00"))
                if abs((st - gt).total_seconds()) > 30 * 3600: continue
            except Exception: pass
        if _team_eq(e, "home", g["teams"]["home"]) and _team_eq(e, "away", g["teams"]["away"]): return e
    return None

def _fd(x):
    """FanDuel's entry of one market side -> {odds, line, link} or None"""
    b = ((x or {}).get("books") or {}).get(BOOK)
    return b if b and b.get("odds") is not None else None

def _main(g, e):
    m = e.get("main") or {}; L = g["lines"]; src = dict(L.get("src") or {}); n = 0
    ml_h, ml_a = _fd((m.get("ml") or {}).get("home")), _fd((m.get("ml") or {}).get("away"))
    if ml_h and ml_a:
        L["mlHome"], L["mlAway"] = ml_h["odds"], ml_a["odds"]; src["ml"] = "FanDuel"; n += 1
        ih, ia = _imp(ml_h["odds"]), _imp(ml_a["odds"])
        if ih and ia and g.get("crossroads"): g["crossroads"]["bookHome"] = round(ih / (ih + ia), 3)
    sp_h, sp_a = _fd((m.get("spread") or {}).get("home")), _fd((m.get("spread") or {}).get("away"))
    if sp_h and sp_a and sp_h.get("line") is not None and sp_a.get("line") is not None:
        L["sprHome"], L["sprAway"], L["prHome"], L["prAway"] = sp_h["line"], sp_a["line"], sp_h["odds"], sp_a["odds"]; src["spr"] = "FanDuel"; n += 1
    ov, un = _fd((m.get("total") or {}).get("over")), _fd((m.get("total") or {}).get("under"))
    if ov and un and ov.get("line") is not None:
        L["total"], L["over"], L["under"] = ov["line"], ov["odds"], un["odds"]; src["tot"] = "FanDuel"; n += 1
    fd = {"ml": {"home": (ml_h or {}).get("link"), "away": (ml_a or {}).get("link")}, "spr": {"home": (sp_h or {}).get("link"), "away": (sp_a or {}).get("link")},
          "tot": {"over": (ov or {}).get("link"), "under": (un or {}).get("link")}}
    L["fd"] = fd; L["src"] = src
    if (e.get("eventLinks") or {}).get(BOOK): g["fdEvent"] = e["eventLinks"][BOOK]
    return n

def _props_by_player(e):
    """{(pid, stat): {over:{...}, under:{...}, name, team}} using FanDuel only"""
    by = {}
    for p in e.get("props") or []:
        if p.get("type") != "ou": continue
        b = (p.get("books") or {}).get(BOOK)
        if not b or b.get("odds") is None or b.get("line") is None: continue
        d = by.setdefault((p["pid"], p["stat"]), {"name": p.get("name"), "team": p.get("team"), "stat": p["stat"]})
        d[p.get("side")] = {"odds": b["odds"], "line": float(b["line"]), "link": b.get("link"), "fair": (p.get("fair") or {}).get("odds")}
    return {k: v for k, v in by.items() if v.get("over") and v.get("under") and v["over"]["line"] == v["under"]["line"]}

def _rungs(line, key):
    if line >= 100: step = 25
    elif line >= 40: step = 10
    elif line >= 15: step = 5
    elif line >= 6: step = 2
    else: step = 1
    base = math.floor(line) + 1; ts = {base}
    for k in range(1, 4):
        ts.add(base + k * step)
        if base - k * step >= 1: ts.add(base - k * step)
    return sorted(t for t in ts if t >= 1 and t <= max(line * 1.9, line + 3))

def _synth_stat(key, d):
    line = d["over"]["line"]; po_i, pu_i = _imp(d["over"]["odds"]), _imp(d["under"]["odds"]); p_over = po_i / (po_i + pu_i)
    sd = max(0.7, line * REL_SD[key]) if key in REL_SD else max(0.6, math.sqrt(max(line, 0.4)) * 1.05)
    mu = line - _ppf(1 - p_over) * sd                 # the mean that makes P(X > line) match FanDuel's no-vig chance
    mu = max(mu, 0.1)
    def ge(t): return _clamp(1 - _phi((t - 0.5 - mu) / sd), 0.02, 0.97)
    miles = [dict(t=float(t), price=None, hit=0, n=0, p=round(ge(t), 3)) for t in _rungs(line, key) if 0.12 <= ge(t) <= 0.9]
    margin = max(0.07 * line, 0.25 if line < 5 else 0)
    return dict(key=key, label=LABEL.get(key, key), vals=[], line=line, lineSrc="FanDuel", prices=[d["over"]["odds"], d["under"]["odds"]], n=0, avg=round(mu, 1), avg5=round(mu, 1), mn=0, mx=0,
                safe=None, safeAdj=None, overHits=0, streak=0, streakDir=None, hot="steady", hotNote="", grade="–", gradePct=None, proj=round(mu, 1), season=round(mu, 1), anchorNote="",
                matchup=0, matchupNote="", boost=0.0, lean="No edge", pOver=round(p_over, 3), overPrice=d["over"]["odds"], underPrice=d["under"]["odds"], pSafe=None, safePrice=None, safeSrc="est.",
                miles=miles, prate=50, v15=[], n15=0, overHits15=0, sd=round(sd, 2), feed=True, fdOver=d["over"].get("link"), fdUnder=d["under"].get("link"))

def _synth_players(g, e, by):
    byp = {}
    for (pid, stat), d in by.items():
        if stat not in LABEL: continue
        side = d["team"] if d["team"] in ("home", "away") else None
        if side is None or not d.get("name"): continue
        byp.setdefault(pid, {"name": d["name"], "side": side, "stats": []})["stats"].append(_synth_stat(stat, d))
    out = []
    for side in ("home", "away"):
        mine = [(pid, v) for pid, v in byp.items() if v["side"] == side]
        mine.sort(key=lambda kv: -max(s["line"] * (1 if s["key"] in REL_SD else 12) for s in kv[1]["stats"]))     # the featured players first
        for pid, v in mine[:MAX_PLAYERS_PER_TEAM]:
            ks = [s["key"] for s in v["stats"]]; pos = next((POS[k] for k in ("passYds", "rushYds", "recYds", "rec", "k") if k in ks and POS.get(k)), "")
            out.append(dict(id=str(pid), name=v["name"], side=side, abbr=g["teams"][side]["abbr"], pos=pos, jersey=None, status=dict(label="Active", kind="ok", note=""), avail=1.0, flags=[], boostNotes=[],
                            games=[], slots=[], stats=sorted(v["stats"], key=lambda s: list(LABEL).index(s["key"])), fam=("P" if "k" in ks else pos or "X"), ht=None, feed=True))
    return out

def _overlay_stat(st, d):
    """a slate player's stat takes FanDuel's line and price; the model's chance is recomputed on the new line"""
    line = d["over"]["line"]; vals = st.get("vals") or []; n = len(vals); proj = st.get("proj")
    sd = st.get("sd") or max(0.15 * line, 0.5)
    over_hits = sum(1 for x in vals if x > line)
    if proj is not None and n:
        p_norm = 1 - _phi((line - proj) / sd); p_emp = (over_hits + 1) / (n + 2); p = _clamp(0.5 * p_emp + 0.5 * p_norm, 0.04, 0.96)
        margin = max(0.07 * line, 0.25 if line < 5 else 0)
        st["lean"] = "Over" if proj >= line + margin else "Under" if proj <= line - margin else "No edge"
    else:
        po, pu = _imp(d["over"]["odds"]), _imp(d["under"]["odds"]); p = po / (po + pu)
    st.update(line=line, lineSrc="FanDuel", overHits=over_hits, pOver=round(p, 3), overPrice=d["over"]["odds"], underPrice=d["under"]["odds"], prices=[d["over"]["odds"], d["under"]["odds"]],
              fdOver=d["over"].get("link"), fdUnder=d["under"].get("link"))
    # rungs the book listed come from another book: show the model's estimate instead of mixing books
    for m in st.get("miles") or []: m["price"] = None
    if st.get("safeSrc") == "DraftKings" and st.get("pSafe") is not None:
        st["safeSrc"] = "est."; st["safePrice"] = _est_price(st["pSafe"])

def apply(games, odds, now=None):
    """-> status string. Mutates the cards in place. Cards that have kicked off keep the numbers they had (open bets settle against them)."""
    try:
        events = (odds or {}).get("events") or []
        if not events: return "no odds feed"
        stat = dict(lines=0, props=0, synth=0, games=0)
        for g in games:
            try:
                if g.get("bookOnly") or g.get("oddsId"): continue          # tennis cards are built from FanDuel-first prices already
                if now is not None and _started(g, now): continue
                e = find_event(g, events)
                if not e: continue
                if _main(g, e): stat["lines"] += 1
                by = _props_by_player(e)
                if g.get("players"):
                    names = {_n(p["name"]): p for p in g["players"]}
                    for (pid, key), d in by.items():
                        pl = names.get(_n(d["name"]))
                        st = next((s for s in pl["stats"] if s["key"] == key), None) if pl else None
                        if st: _overlay_stat(st, d); stat["props"] += 1
                elif by:
                    ps = _synth_players(g, e, by)
                    if ps: g["players"] = ps; g["feedProps"] = True; stat["synth"] += 1
                stat["games"] += 1
            except Exception:
                continue
        return "ok: FanDuel lines on %d cards, %d player stats, FanDuel-only players on %d cards" % (stat["lines"], stat["props"], stat["synth"])
    except Exception as ex:
        return "error: %s: %s" % (type(ex).__name__, ex)


# ---------------------------------------------------------------- cards straight from the feed, for leagues ESPN gave us nothing for
NHL_TEAMS = {"ANA": ("Ducks", "#f47a38"), "BOS": ("Bruins", "#fcb514"), "BUF": ("Sabres", "#003087"), "CGY": ("Flames", "#d2001c"), "CAR": ("Hurricanes", "#cc0000"), "CHI": ("Blackhawks", "#cf0a2c"),
             "COL": ("Avalanche", "#6f263d"), "CBJ": ("Blue Jackets", "#002654"), "DAL": ("Stars", "#006847"), "DET": ("Red Wings", "#ce1126"), "EDM": ("Oilers", "#041e42"), "FLA": ("Panthers", "#c8102e"),
             "LA": ("Kings", "#111111"), "MIN": ("Wild", "#154734"), "MTL": ("Canadiens", "#af1e2d"), "NSH": ("Predators", "#ffb81c"), "NJ": ("Devils", "#ce1126"), "NYI": ("Islanders", "#00539b"),
             "NYR": ("Rangers", "#0038a8"), "OTT": ("Senators", "#c52032"), "PHI": ("Flyers", "#f74902"), "PIT": ("Penguins", "#fcb514"), "SJ": ("Sharks", "#006d75"), "SEA": ("Kraken", "#001628"),
             "STL": ("Blues", "#002f87"), "TB": ("Lightning", "#002868"), "TOR": ("Maple Leafs", "#00205b"), "UTA": ("Mammoth", "#6cace4"), "VAN": ("Canucks", "#00205b"), "VGK": ("Golden Knights", "#b4975a"),
             "WSH": ("Capitals", "#c8102e"), "WPG": ("Jets", "#041e42")}
FEED_LEAGUES = {"NHL": "nhl", "MLB": "mlb"}

def _pick(side):
    """FanDuel's price and line for one side of a market, else the median of the other books"""
    bks = (side or {}).get("books") or {}
    b = bks.get(BOOK)
    if b and b.get("odds") is not None: return b["odds"], b.get("line"), b.get("link"), "FanDuel"
    import statistics
    od = [x["odds"] for x in bks.values() if x.get("odds") is not None]; ln = [x["line"] for x in bks.values() if x.get("line") is not None]
    if not od: return None, None, None, None
    return int(statistics.median(od)), (statistics.median(ln) if ln else None), None, "DraftKings"

def feed_card(ev, key, now):
    import datetime
    from timeutil import ET
    import tennis as T
    m = ev.get("main") or {}
    mlh, _, lkh, sh_ = _pick((m.get("ml") or {}).get("home")); mla, _, lka, sa_ = _pick((m.get("ml") or {}).get("away"))
    if mlh is None or mla is None: return None
    st = datetime.datetime.fromisoformat((ev.get("start") or "").replace("Z", "+00:00"))
    iH, iA = _imp(mlh), _imp(mla); pH = iH / (iH + iA)
    sph, lh, lks_h, _ = _pick((m.get("spread") or {}).get("home")); spa, la, lks_a, _ = _pick((m.get("spread") or {}).get("away"))
    to, lo, lko, _ = _pick((m.get("total") or {}).get("over")); tu, lu, lku, _ = _pick((m.get("total") or {}).get("under"))
    default_total = 6.0 if key == "nhl" else 8.5; default_spr = 1.5 if key == "nhl" else 1.5
    total = lo if lo is not None else (lu if lu is not None else default_total)
    sprH = lh if lh is not None else (-la if la is not None else (-default_spr if pH >= 0.5 else default_spr))
    def team(side):
        ab = (ev.get(side) or "").upper() or "TBD"; nm = ev.get(side + "Name") or ab
        short, color = NHL_TEAMS.get(ab, (nm.split()[-1], "#334155")) if key == "nhl" else (nm.split()[-1], "#334155")
        t = T._team(nm, short, color, "#ffffff"); t["abbr"] = ab[:4]; t["id"] = ab
        return t
    a, h = team("away"), team("home")
    margin = -sprH; projH = (total + margin) / 2; projA = (total - margin) / 2; stt = st.astimezone(ET)
    src = {k: v for k, v in (("ml", sh_), ("spr", None), ("tot", None)) if v}
    srcs = {"ml": sh_ if sh_ == sa_ else "DraftKings", "spr": _pick((m.get("spread") or {}).get("home"))[3], "tot": _pick((m.get("total") or {}).get("over"))[3]}
    lines = dict(dk=dict(ml=dict(home=None, away=None), spr=dict(home=None, away=None), tot=dict(over=None, under=None)), mlHome=mlh, mlAway=mla, sprHome=sprH, sprAway=-sprH,
                 prHome=sph or -110, prAway=spa or -110, total=total, over=to or -110, under=tu or -110, src={k: v for k, v in srcs.items() if v},
                 fd={"ml": {"home": lkh, "away": lka}, "spr": {"home": lks_h, "away": lks_a}, "tot": {"over": lko, "under": lku}})
    cr = dict(projHome=round(projH, 1), projAway=round(projA, 1), projHomeNoInj=round(projH, 1), projAwayNoInj=round(projA, 1), projTotal=round(total, 1), projMargin=round(margin, 1),
              pHome=round(pH, 3), bookHome=round(pH, 3), leans=[],
              learn=dict(rawMargin=round(margin, 1), rawTotal=round(total, 1), baseMargin=round(margin, 1), baseTotal=round(total, 1), injMargin=0, injTotal=0, bookMargin=round(margin, 1),
                         w=dict(m=0, t=0, p=0), n=0, sd=dict(m=1.6, t=1.5), leanStats={}, test={}, rk=dict(home=None, away=None), rt=dict(home=dict(o=0, d=0, gp=0), away=dict(o=0, d=0, gp=0))),
              matchups=[], ctx=dict(away=dict(off=0, deff=0, items=[], rest={}, stars=[]), home=dict(off=0, deff=0, items=[], rest={}, stars=[])))
    c = dict(id="f" + str(ev.get("id")), lg=key, key=key, league=ev.get("league"), title=f"{a['name']} at {h['name']}", start=stt.strftime("%-I:%M %p ET"), startDate=stt.strftime("%a %b %-d"),
             iso=st.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), day=stt.strftime("%Y-%m-%d"), venue="", tv="", series=None,
             note="Book lines only: ESPN had no card for this game, so the numbers come from FanDuel.", n=32 if key == "nhl" else 30,
             teams=dict(away=a, home=h), lines=lines, crossroads=cr, players=[], bookOnly=True, oddsId=ev.get("id"))
    if (ev.get("eventLinks") or {}).get(BOOK): c["fdEvent"] = ev["eventLinks"][BOOK]
    ps = _synth_players(c, ev, _props_by_player(ev))
    if ps: c["players"] = ps; c["feedProps"] = True
    return c

def feed_cards(odds, games, now, cap=10):
    """cards for the feed's games in leagues where the slate has none (ESPN gave nothing): NHL and MLB"""
    import datetime
    out = []
    try:
        have = {(g.get("key") or g.get("lg")) for g in games}
        for lg, key in FEED_LEAGUES.items():
            if key in have: continue
            n = 0
            for ev in (odds or {}).get("events") or []:
                if ev.get("league") != lg or ev.get("final") or n >= cap: continue
                try:
                    st = datetime.datetime.fromisoformat((ev.get("start") or "").replace("Z", "+00:00"))
                    if not (0 <= (st - now).total_seconds() <= 40 * 3600): continue
                    c = feed_card(ev, key, now)
                except Exception:
                    continue
                if c: out.append(c); n += 1
        out.sort(key=lambda c: c["iso"])
    except Exception:
        return []
    return out
