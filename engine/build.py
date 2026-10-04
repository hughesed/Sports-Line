import sys, unicodedata, math, statistics, datetime, collections, re, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from espn import *
from timeutil import ET
import games_all
from feeds import roster_players

NOW_UTC = datetime.datetime.now(datetime.timezone.utc)      # refresh.py calls set_now() with the run time
def set_now(dt):
    global NOW_UTC; NOW_UTC = dt

HFA = {"nfl": 1.5, "wnba": 2.5, "mlb": 0.3}          # total home margin shift
SHRINK_K = {"nfl": 5, "wnba": 0, "mlb": 0}            # pseudo-games toward league average
RATING_SCALE = {"nfl": 2.5, "wnba": 2.0, "mlb": 25.0} # rating points per 1 point/run of injury impact
LOGI = {"nfl": 7.9, "wnba": 6.5, "mlb": 2.5}          # logistic scale for win prob from margin
SPREAD_T = {"nfl": 3.0, "wnba": 2.5, "mlb": 0.5}
TOTAL_T = {"nfl": 4.0, "wnba": 4.0, "mlb": 0.6}
ML_T = {"nfl": 0.06, "wnba": 0.05, "mlb": 0.04}

def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)

def clamp(x, a, b): return max(a, min(b, x))
def amer(p):
    p = clamp(p, 0.03, 0.97)
    return max(-1000, int(round(-100 * p / (1 - p)))) if p >= 0.5 else int(round(100 * (1 - p) / p))
def dec_from_amer(a): return 1 + (a / 100 if a > 0 else 100 / abs(a))
def est_price(p):  # fair prob -> American price with ~4.5% hold
    return amer(min(0.97, p * 1.045))
def phi(z): return 0.5 * (1 + math.erf(z / math.sqrt(2)))
def r1(x): return None if x is None else round(x, 1)

def score_of(c):
    s = c.get("score")
    if isinstance(s, dict): return num(s.get("value") if s.get("value") is not None else s.get("displayValue"))
    return num(s)

# ----------------------------------------------------------------------------------------------
# league ratings (points for / against per game, this season's regular-season games from the store)
def load_ratings(lg):
    """same numbers the standings feed gives (games, points for/against per game), computed from store/. Keyed by team abbreviation."""
    games = games_all.load(lg)
    reg = [g for g in games if not g["post"] and g.get("season") is not None]
    if not reg: raise RuntimeError(f"no regular-season games in the store for {lg}")
    cur = max(g["season"] for g in reg)
    agg = {}
    for g in reg:
        if g["season"] != cur: continue
        for ab, pf, pa in ((g["home"], g["hs"], g["as_"]), (g["away"], g["as_"], g["hs"])):
            r = agg.setdefault(ab, dict(g=0, pf=0.0, pa=0.0, w=0, l=0)); r["g"] += 1; r["pf"] += pf; r["pa"] += pa
            if pf > pa: r["w"] += 1
            elif pf < pa: r["l"] += 1
    rows = {}
    for ab, r in agg.items():
        rows[ab] = dict(g=r["g"], pf=r["pf"] / r["g"], pa=r["pa"] / r["g"], w=r["w"], l=r["l"], name=ab)
    if len(rows) < 8: raise RuntimeError(f"too few teams with games this season in {lg} ({len(rows)})")
    lgpf = statistics.mean(r["pf"] for r in rows.values())
    lgpa = statistics.mean(r["pa"] for r in rows.values())
    k = SHRINK_K[lg]
    for r in rows.values():
        r["pfs"] = (r["g"] * r["pf"] + k * lgpf) / (r["g"] + k)
        r["pas"] = (r["g"] * r["pa"] + k * lgpa) / (r["g"] + k)
    sdpf = statistics.pstdev(r["pfs"] for r in rows.values()) or 1
    sdpa = statistics.pstdev(r["pas"] for r in rows.values()) or 1
    for r in rows.values():
        r["off"] = clamp(50 + 20 * (r["pfs"] - lgpf) / sdpf, 5, 95)
        r["def"] = clamp(50 + 20 * (lgpa - r["pas"]) / sdpa, 5, 95)   # lower points allowed => higher rating
    ranked_off = sorted(rows, key=lambda t: -rows[t]["pfs"]); ranked_def = sorted(rows, key=lambda t: rows[t]["pas"])
    for t, r in rows.items():
        r["offRank"] = ranked_off.index(t) + 1; r["defRank"] = ranked_def.index(t) + 1
    return rows, lgpf, lgpa

# ----------------------------------------------------------------------------------------------
def team_games(lg, abbr):
    """completed games oldest->newest from the store (all season types)"""
    out = []
    for g in games_all.load(lg):
        if g["home"] == abbr: me_pf, me_pa, home, opp = g["hs"], g["as_"], True, g["away"]
        elif g["away"] == abbr: me_pf, me_pa, home, opp = g["as_"], g["hs"], False, g["home"]
        else: continue
        out.append(dict(id=g["id"], date=g["date"], opp=opp, home=home, pf=me_pf, pa=me_pa, win=me_pf > me_pa, post=bool(g["post"])))
    return sorted(out, key=lambda x: x["date"])

# ----------------------------------------------------------------------------------------------
STATUS_W = {"out": 1.0, "doubtful": 0.85, "questionable": 0.5, "day-to-day": 0.3, "probable": 0.1}
def classify_injury(i, game_dt):
    st = (i.get("status") or "")
    short = (i.get("shortComment") or "").strip()
    txt = (short or (i.get("longComment") or "")).lower()
    det = i.get("details") or {}
    reason = det.get("type") or ""
    ret = det.get("returnDate")
    s = st.lower()
    age = (datetime.date.fromisoformat(game_dt[:10]) - datetime.date.fromisoformat(i["date"][:10])).days
    label = st; weight = 0.0; kind = "info"
    if s in ("out", "injured reserve", "suspension") or s.endswith("-il"):
        label = "Out" if s == "out" else st; weight = 1.0; kind = "out"
    elif s == "day-to-day":
        if "probable" in txt: label = "Probable"; weight = 0.1; kind = "probable"
        elif "questionable" in txt: label = "Questionable"; weight = 0.5; kind = "questionable"
        else:
            label = "Day-to-day"; weight = 0.3; kind = "dtd"
            if ret and ret > game_dt[:10]: weight = 0.7; label = "Day-to-day (listed back " + ret[5:] + ")"
    elif s == "active":
        paren = re.search(r"\([a-z ]+\)", txt[:200]) is not None
        cleared = ("no longer has an injury designation" in txt) or (paren and any(k in txt for k in ("full participant", "is active for", "was activated", "returned to practice", "cleared to")))
        if age > 4: return None                              # stale note
        if "ruled out" in txt or "officially listed as out" in txt: label = "Out"; weight = 1.0; kind = "out"
        elif "doubtful" in txt: label = "Doubtful"; weight = 0.85; kind = "doubtful"
        elif cleared: kind = "returning"; label = "Cleared / back"
        elif "questionable" in txt:
            exp = "expected to play" in txt
            label = "Questionable" + (" (expected to play)" if exp else ""); weight = 0.35 if exp else 0.5; kind = "questionable"
        elif "probable" in txt: label = "Probable"; weight = 0.1; kind = "probable"
        else: return None
    if "coach's decision" in reason.lower(): kind = "inactive"; weight = 0.0
    return dict(label=label, kind=kind, weight=weight, reason=reason, ret=ret)

# ----------------------------------------------------------------------------------------------
# stat definitions
def v(g, k):
    x = g["stats"].get(k)
    return x if isinstance(x, (int, float)) else 0.0

def outs(g):
    ip = g["stats"].get("innings") or 0.0
    whole = int(ip); frac = round((ip - whole) * 10)
    return whole * 3 + frac

STATS = {
    "nfl": {
        "QB": [("passYds", "Pass yds", lambda g: v(g, "passingYards"), ["Total Passing Yards"], "Passing Yards", 225),
               ("comp", "Completions", lambda g: v(g, "completions"), ["Total Pass Completions"], "Pass Completions", 20),
               ("passTD", "Pass TD", lambda g: v(g, "passingTouchdowns"), ["Total Passing Touchdowns"], "Passing Touchdowns", 1.4),
               ("rushYds", "Rush yds", lambda g: v(g, "rushingYards"), ["Total Rushing Yards"], "Rushing Yards", 15),
               ("pr", "Pass+rush yds", lambda g: v(g, "passingYards") + v(g, "rushingYards"), ["Total Passing Plus Rushing Yards"], None, 235)],
        "RB": [("rushYds", "Rush yds", lambda g: v(g, "rushingYards"), ["Total Rushing Yards"], "Rushing Yards", 55),
               ("carries", "Carries", lambda g: v(g, "rushingAttempts"), ["Total Carries"], None, 14),
               ("recYds", "Rec yds", lambda g: v(g, "receivingYards"), ["Total Receiving Yards"], "Receiving Yards", 20),
               ("rec", "Receptions", lambda g: v(g, "receptions"), ["Total Receptions"], "Receptions", 2.5),
               ("rr", "Rush+rec yds", lambda g: v(g, "rushingYards") + v(g, "receivingYards"), ["Total Rushing Plus Receiving Yards"], None, 70)],
        "WR": [("recYds", "Rec yds", lambda g: v(g, "receivingYards"), ["Total Receiving Yards"], "Receiving Yards", 40),
               ("rec", "Receptions", lambda g: v(g, "receptions"), ["Total Receptions"], "Receptions", 3.5)],
    },
    "wnba": {
        "ALL": [("pts", "Points", lambda g: v(g, "points"), ["Total Points"], "Points", 12),
                ("reb", "Rebounds", lambda g: v(g, "totalRebounds"), ["Total Rebounds"], "Rebounds", 5),
                ("ast", "Assists", lambda g: v(g, "assists"), ["Total Assists"], "Assists", 3),
                ("fg3", "3-pointers", lambda g: v(g, "threePointFieldGoalsMade-threePointFieldGoalsAttempted_made"), ["Total 3-Point Field Goals"], "3-Point Field Goals", 1.2),
                ("pra", "Pts+Reb+Ast", lambda g: v(g, "points") + v(g, "totalRebounds") + v(g, "assists"), ["Total Points, Rebounds, and Assists"], "Points + Assists + Rebounds", 21)],
    },
    "mlb": {
        "H": [("hits", "Hits", lambda g: v(g, "hits"), ["Total Hits"], "Hits", 0.9),
              ("tb", "Total bases", lambda g: v(g, "hits") + v(g, "doubles") + 2 * v(g, "triples") + 3 * v(g, "homeRuns"), ["Total Bases"], "Total Bases", 1.5),
              ("runs", "Runs", lambda g: v(g, "runs"), ["Total Runs Scored"], "Runs", 0.55),
              ("rbi", "RBIs", lambda g: v(g, "RBIs"), ["Total RBIs"], "RBIs", 0.55),
              ("hrr", "Hits+Runs+RBIs", lambda g: v(g, "hits") + v(g, "runs") + v(g, "RBIs"), ["Total Hits + Runs + RBIs"], "Hits + Runs + RBIs", 2.0)],
        "P": [("k", "Strikeouts", lambda g: v(g, "strikeouts"), ["Total Strikeouts"], "Strikeouts Thrown", 5.5),
              ("outs", "Outs recorded", lambda g: outs(g), ["Total Outs Recorded"], None, 16)],
    },
}

def stat_family(lg, pos):
    if lg == "nfl": return "QB" if pos == "QB" else ("RB" if pos in ("RB", "FB") else "WR")
    if lg == "wnba": return "ALL"
    return "P" if pos in ("SP", "RP", "P") else "H"

def played(lg, g, fam):
    s = g["stats"]
    if lg == "wnba": return (s.get("minutes") or 0) > 0
    if lg == "mlb": return (s.get("innings") or 0) > 0 if fam == "P" else (s.get("atBats") or 0) + (s.get("walks") or 0) > 0
    return True

def book_lines(pidx, aid, names, mile_name):
    """returns main line (target, prices[]) and milestone list [(target, american)]"""
    ent = pidx.get(aid, {})
    line = None
    for nm in names:
        for key, items in ent.items():
            if key.replace(" (incl. overtime)", "") == nm:
                tg = [((e.get("current") or {}).get("target") or {}).get("value") for e in items]
                tg = [t for t in tg if t is not None]
                if not tg: continue
                main = collections.Counter(tg).most_common(1)[0][0]
                prices = []
                for e in items:
                    if ((e.get("current") or {}).get("target") or {}).get("value") == main:
                        a = ((e.get("odds") or {}).get("american") or {}).get("value")
                        if a: prices.append(int(a))
                line = dict(line=main, prices=prices, ts=max(e.get("lastUpdated", "") for e in items))
    miles = []
    if mile_name:
        for key, items in ent.items():
            if key.replace(" (incl. overtime)", "") == mile_name + " Milestones" or key == mile_name + " Milestones":
                for e in items:
                    t = ((e.get("current") or {}).get("target") or {}).get("value")
                    a = ((e.get("odds") or {}).get("american") or {}).get("value")
                    miles.append((t, int(a) if a else None))
    miles = sorted(set(miles), key=lambda x: x[0])
    return line, miles

def grade_of(vals):
    n = len(vals)
    if n < 2: return "—", None, "small sample"
    m = statistics.mean(vals); med = statistics.median(vals)
    mad = statistics.mean(abs(x - m) for x in vals)
    rel = mad / max(m, 1.0)
    pct = sum(1 for x in vals if abs(x - med) <= max(0.25 * med, 1.0)) / n
    score = 100 * (0.5 * pct + 0.5 * max(0.0, 1 - rel / 0.8))
    g = "A" if score >= 85 else "B" if score >= 70 else "C" if score >= 55 else "D" if score >= 40 else "F"
    return g, round(pct * 100), None

def hotcold(vals):
    n = len(vals)
    if n < 3: return "steady", "too few games"
    if n >= 6:
        recent = statistics.mean(vals[-3:]); prior = statistics.mean(vals[:-3]); lab = "last 3"
    else:
        recent = vals[-1]; prior = statistics.mean(vals[:-1]); lab = "last game"
    if prior <= 0: return ("hot" if recent > 0 else "steady"), f"{lab} {recent:.1f} vs {prior:.1f} before"
    r = recent / prior
    note = f"{lab} {recent:.1f} vs {prior:.1f} before"
    hi, lo = (1.2, 0.8) if n >= 6 else (1.3, 0.7)
    if r >= hi and recent > statistics.mean(vals) : return "hot", note
    if r <= lo and recent < statistics.mean(vals): return "cold", note
    return "steady", note

def athlete_id(a):
    for l in a.get("links", []) or []:
        m = re.search(r"/id/(\d+)", l.get("href", ""))
        if m: return m.group(1)
    return str(a.get("id"))

def baked_in(lg, t, i):
    """absences that began before the team's latest game are already in its recent results/usage"""
    last = t["_tg"][-1]["date"][:10] if t.get("_tg") else "0000-00-00"
    if lg == "mlb":
        return (NOW_UTC.date() - datetime.date.fromisoformat(i["date"])).days > 14
    return i["date"] < last

def surname(n):
    parts = [x for x in n.replace(",", "").split() if x.lower().strip(".") not in ("jr", "sr", "ii", "iii", "iv")]
    return parts[-1] if parts else n

import learn as LRN, learn_export as LEX
import ctxfactors as CF
LEARN = {}
LIVE_LEANS = {}     # lean hit/n graded from the bot's own live predictions (set by refresh.py), added to the backtest record
def learned(lg):
    if lg not in LEARN:
        R = LRN.run_league(lg); skip = int(len(R["rows"]) * 0.3)
        R["leanStats"] = LEX.lean_stats(lg, R["rows"][skip:])
        for k_, v_ in (LIVE_LEANS.get(lg) or {}).items():
            cur_ = R["leanStats"].get(k_, dict(hit=0, n=0)); R["leanStats"][k_] = dict(hit=cur_["hit"] + v_["hit"], n=cur_["n"] + v_["n"])
        R["ranks"] = LEX.rank_map(R["model"], list(R["model"].o.keys()))
        LEARN[lg] = R
    return LEARN[lg]
def dk_links(sb):
    import urllib.parse
    o = ((sb["competitions"][0].get("odds") or [None])[0]) or {}
    def pre(x):
        try:
            h = x["close"]["link"]["href"]; q = urllib.parse.parse_qs(urllib.parse.urlparse(h).query).get("preurl")
            return q[0] if q else None
        except Exception: return None
    out = {}
    ml, ps, tt = o.get("moneyline") or {}, o.get("pointSpread") or {}, o.get("total") or {}
    out["ml"] = {k: pre(ml.get(k) or {}) for k in ("home", "away")}
    out["spr"] = {k: pre(ps.get(k) or {}) for k in ("home", "away")}
    out["tot"] = {"over": pre(tt.get("over") or {}), "under": pre(tt.get("under") or {})}
    return out

def _series(summ):
    try:
        s = summ["header"]["competitions"][0].get("series")
        return (s or [{}])[-1].get("summary") if s else None
    except Exception:
        return None

def build_game(lg, sb, summ, core, pidx, rows, league_inj, CX, picks):
    """Player-level card for one NFL / WNBA / MLB event. All inputs are passed in (nothing is read from disk):
    sb scoreboard event, summ summary json, core odds item, pidx props index, rows league ratings by team abbreviation,
    league_inj league injury feed, CX context factors, picks {side: [roster dict, ...]}. Model logic is the original one."""
    comp = sb["competitions"][0]
    G = dict(event=sb["id"], away=[c for c in comp["competitors"] if c["homeAway"] == "away"][0]["team"]["id"], home=[c for c in comp["competitors"] if c["homeAway"] == "home"][0]["team"]["id"])
    start = datetime.datetime.fromisoformat(sb["date"].replace("Z", "+00:00")).astimezone(ET)
    game_dt = sb["date"]
    # --- teams
    teams = {}
    for side in ("away", "home"):
        tid = G[side]
        c = [x for x in comp["competitors"] if x["team"]["id"] == tid][0]
        tg = team_games(lg, c["team"]["abbreviation"])
        last = tg[-10:]
        rr = rows[c["team"]["abbreviation"]]
        teams[side] = dict(id=tid, abbr=c["team"]["abbreviation"], name=c["team"]["displayName"], short=c["team"].get("shortDisplayName") or c["team"]["name"],
                           color="#" + (c["team"].get("color") or "444444"), alt="#" + (c["team"].get("alternateColor") or "888888"),
                           record=([r["summary"] for r in c.get("records", []) if r["name"] == "overall"] or [""])[0],
                           recent=[dict(opp=g["opp"], home=g["home"], pf=g["pf"], pa=g["pa"], win=g["win"], post=g["post"], date=g["date"][:10]) for g in last],
                           pf=r1(rr["pf"]) if lg != "mlb" else round(rr["pf"], 2), pa=r1(rr["pa"]) if lg != "mlb" else round(rr["pa"], 2),
                           offBase=round(rr["off"]), defBase=round(rr["def"]), offRank=rr["offRank"], defRank=rr["defRank"], gp=rr["g"], _tg=tg)
    # --- injuries (league feed, richer than summary)
    for side in ("away", "home"):
        tid = G[side]
        lst = next((t["injuries"] for t in league_inj if str(t["id"]) == str(tid)), [])
        inj = []
        for i in lst:
            cl = classify_injury(i, game_dt)
            if not cl: continue
            a = i["athlete"]
            pos = (a.get("position") or {}).get("abbreviation") if isinstance(a.get("position"), dict) else a.get("position")
            inj.append(dict(id=athlete_id(a), name=a["displayName"], pos=pos, status=i.get("status"), label=cl["label"], kind=cl["kind"], weight=cl["weight"],
                            reason=cl["reason"], ret=cl["ret"], date=i["date"][:10], note=(i.get("shortComment") or "").strip()))
        teams[side]["injuries"] = inj
    # --- players: logs
    P = []
    for side in ("away", "home"):
        tid = G[side]
        for p in picks[side]:
            r = gamelog(lg, p["id"])
            if not r: print("no game log for", p["name"]); continue
            names, gl = r
            fam = stat_family(lg, p["pos"])
            gl = [g for g in gl if played(lg, g, fam)]
            P.append(dict(side=side, tid=tid, p=p, fam=fam, gl=gl, allgl=r[1]))
    # --- injuries impact on team scoring
    # injured players production (for share-based impact)
    def prod_nfl(aid):
        r = gamelog("nfl", aid);
        if not r: return 0, 0
        gl = r[1]
        return sum(v(g, "rushingYards") + v(g, "receivingYards") for g in gl), sum(v(g, "passingAttempts") for g in gl)
    team_scrim = {}
    if lg == "nfl":
        for side in ("away", "home"):
            tid = G[side]; tot = 0; att = 0
            for p in roster_players("nfl", tid):
                if p["pos"] in ("QB", "RB", "WR", "TE", "FB") and p["grp"] in ("offense", "injuredReserveOrOut"):
                    s, a = prod_nfl(p["id"]); tot += s; att += a
            team_scrim[side] = (tot or 1, att or 1)
    for side in ("away", "home"):
        t = teams[side]; tid = G[side]
        offp = 0.0; defp = 0.0; notes = []
        rpl = {p["id"]: p for p in roster_players(lg, tid)}
        for i in t["injuries"]:
            w = i["weight"]
            if w <= 0 or i["kind"] in ("returning", "inactive"): continue
            # baked in: long-term absences are already in the season/last-10 numbers
            if baked_in(lg, t, i): continue
            if lg == "nfl":
                pid = i["id"]
                if i["pos"] in ("QB",):
                    s, a = prod_nfl(pid)
                    if a / team_scrim[side][1] >= 0.6:
                        offp += 4.5 * w; notes.append(f"{i['name']} (QB) {i['label']}: −{4.5*w:.1f} pts")
                elif i["pos"] in ("RB", "WR", "TE", "FB"):
                    s, a = prod_nfl(pid)
                    share = s / team_scrim[side][0]
                    imp = share * 6.0 * w
                    if imp >= 0.05:
                        offp += imp; notes.append(f"{i['name']} ({i['pos']}) {i['label']}: {share*100:.0f}% of skill yards → −{imp:.1f} pts")
                elif i["pos"] in ("C", "G", "OT", "T", "OL"):
                    offp += 0.4 * w; notes.append(f"{i['name']} ({i['pos']}) {i['label']}: −{0.4*w:.1f} pts (OL starter assumed)")
                elif i["pos"] in ("DE", "DT", "LB", "CB", "S", "DB", "DL", "EDGE"):
                    defp += 0.45 * w; notes.append(f"{i['name']} ({i['pos']}) {i['label']}: +{0.45*w:.2f} pts allowed")
            elif lg == "wnba":
                r = gamelog("wnba", i["id"])
                if r:
                    gl = [g for g in r[1] if (g["stats"].get("minutes") or 0) > 0][-10:]
                    if gl:
                        ppg = statistics.mean(v(g, "points") for g in gl); apg = statistics.mean(v(g, "assists") for g in gl)
                        mpg = statistics.mean(v(g, "minutes") for g in gl)
                        imp = 0.55 * (ppg + apg) * w * clamp(mpg / 30, 0.3, 1.0)
                        if imp >= 0.1:
                            offp += imp; notes.append(f"{i['name']} ({ppg:.0f} pts, {apg:.0f} ast) {i['label']}: −{imp:.1f} pts")
            elif lg == "mlb":
                if i["pos"] in ("2B", "SS", "3B", "1B", "LF", "CF", "RF", "C", "DH"):
                    imp = 0.12 * w
                    offp += imp; notes.append(f"{i['name']} ({i['pos']}) {i['label']}: −{imp:.2f} runs")
        cap = {"nfl": 6.0, "wnba": 8.0, "mlb": 0.6}[lg]
        offp = min(offp, cap); defp = min(defp, cap / 2)
        t["injImpact"] = dict(off=round(offp, 2), deff=round(defp, 2), notes=notes)
    # --- context factors: rest/workload, contract and trade news, dominant opposing players
    notable = [x["name"] for x in CX["leaders"]]
    NT = max(len(rows), 8)
    ctx = {}
    for side, op_side in (("away", "home"), ("home", "away")):
        me, op = teams[side], teams[op_side]
        ctx[side] = CF.team_context(lg, CX, me["id"], op["id"], side, me["_tg"], game_dt, me["defRank"], me["offRank"], NT, op["defRank"], op["offRank"], notable,
                                    [i["name"] for i in op["injuries"] if i["kind"] in ("out", "doubtful")], [me["short"], me["name"].split()[-1]])
    if lg == "wnba":   # heavy recent minutes for the players being tracked
        for X in P:
            ml_ = CF.minutes_load(X["gl"])
            if ml_:
                cx = ctx[X["side"]]; cx["items"].append(dict(kind="workload", text=f"{X['p']['name']} has averaged {ml_['last3']} minutes over the last 3 games (season {ml_['season']})", pts=-0.2, src="game logs"))
                cx["off"] = round(cx["off"] + 0.2 * 0.5, 2); cx["deff"] = round(cx["deff"] + 0.2 * 0.5, 2)
    for side in ("away", "home"):
        t = teams[side]; sc = RATING_SCALE[lg]; cx = ctx[side]
        t["off"] = round(clamp(t["offBase"] - (t["injImpact"]["off"] + cx["off"]) * sc, 3, 97)); t["def"] = round(clamp(t["defBase"] - (t["injImpact"]["deff"] + cx["deff"]) * sc, 3, 97))

    # --- crossroads (team level)
    a, h = teams["away"], teams["home"]
    ra, rh = rows[a["abbr"]], rows[h["abbr"]]
    hfa = HFA[lg]
    projH = (rh["pfs"] + ra["pas"]) / 2 + hfa / 2 - h["injImpact"]["off"] + a["injImpact"]["deff"] - ctx["home"]["off"] + ctx["away"]["deff"]
    projA = (ra["pfs"] + rh["pas"]) / 2 - hfa / 2 - a["injImpact"]["off"] + h["injImpact"]["deff"] - ctx["away"]["off"] + ctx["home"]["deff"]
    projH0 = (rh["pfs"] + ra["pas"]) / 2 + hfa / 2; projA0 = (ra["pfs"] + rh["pas"]) / 2 - hfa / 2
    # book lines
    def am(x): return int(x) if x is not None else None
    ho, ao = core["homeTeamOdds"], core["awayTeamOdds"]
    ml_h, ml_a = am(ho["moneyLine"]), am(ao["moneyLine"])
    spr_h = float(ho["current"]["pointSpread"]["american"]); spr_a = float(ao["current"]["pointSpread"]["american"])
    pr_h = int(ho["current"]["spread"]["american"]); pr_a = int(ao["current"]["spread"]["american"])
    if lg == "mlb":  # feed labels conflict with the moneyline; give the -1.5 to the moneyline favorite
        fav_home = ml_h < ml_a
        plus = max(pr_h, pr_a); minus = min(pr_h, pr_a)
        if fav_home: spr_h, spr_a, pr_h, pr_a = -1.5, 1.5, plus, minus
        else: spr_h, spr_a, pr_h, pr_a = 1.5, -1.5, minus, plus
    total = float(core["overUnder"]); o_odds = int(core["overOdds"]); u_odds = int(core["underOdds"])
    book_marg = -spr_h
    def imp(a_): return (100 / (a_ + 100)) if a_ > 0 else (abs(a_) / (abs(a_) + 100))
    iH, iA = imp(ml_h), imp(ml_a); vig = iH + iA
    bookH = iH / vig
    # learned base (walk-forward ratings) + injury delta, then anchored to the book with backtest-fitted weights
    LR = learned(lg); mdl = LR["model"]
    lph, lpa = mdl.predict(h["abbr"], a["abbr"])
    dm = (projH - projA) - (projH0 - projA0); dt = (projH + projA) - (projH0 + projA0)
    raw_m = (lph - lpa) + dm; raw_t = (lph + lpa) + dt
    fin = LEX.final_proj(lg, LR, raw_m, raw_t, dict(spr=(spr_h if lg != "mlb" else None), total=total, pml=bookH), calib=True)
    marg = fin["fm"]; pt = fin["ft"]; pH = fin["fp"]
    projH = (pt + marg) / 2; projA = (pt - marg) / 2
    rkm = LR["ranks"]
    learn_info = dict(rawMargin=round(raw_m, 1), rawTotal=round(raw_t, 1), baseMargin=round(lph - lpa, 1), baseTotal=round(lph + lpa, 1), injMargin=round(dm, 1), injTotal=round(dt, 1),
                      bookMargin=round(book_marg, 1), w={k: round(v, 2) for k, v in fin["w"].items()}, n=LR["n_games"], sd=LR["sd"],
                      leanStats=LR["leanStats"], test=LR["test"],
                      rk=dict(home=rkm.get(h["abbr"]), away=rkm.get(a["abbr"])),
                      rt=dict(home=dict(o=round(mdl.o[h["abbr"]], 2), d=round(mdl.d[h["abbr"]], 2), gp=mdl.gp[h["abbr"]]), away=dict(o=round(mdl.o[a["abbr"]], 2), d=round(mdl.d[a["abbr"]], 2), gp=mdl.gp[a["abbr"]])))
    def lean_ok(kind):
        st = LR["leanStats"].get(kind)
        return not st or st["n"] < 50 or st["hit"] / st["n"] >= 0.52
    leans = []
    d_sp = raw_m - book_marg
    if lg == "mlb" or not lean_ok("spread"): d_sp = 0     # baseball run lines are not expected margins
    if abs(d_sp) >= SPREAD_T[lg]:
        if d_sp > 0: leans.append(dict(kind="spread", text=f"Spread lean: {h['abbr']} {spr_h:+g}", why=f"model margin {h['abbr']} {raw_m:+.1f} vs book {book_marg:+.1f}"))
        else: leans.append(dict(kind="spread", text=f"Spread lean: {a['abbr']} {spr_a:+g}", why=f"model margin {h['abbr']} {raw_m:+.1f} vs book {book_marg:+.1f}"))
    d_t = raw_t - total
    if not lean_ok("total"): d_t = 0
    if abs(d_t) >= TOTAL_T[lg]:
        leans.append(dict(kind="total", text=f"Total lean: {'Over' if d_t > 0 else 'Under'} {total:g}", why=f"model total {pt:.1f} vs book {total:g}"))
    pH_raw = LEX.phi(raw_m / LR["sd"]["m"])
    if not lean_ok("mlLean") and lg == "mlb": pH_raw = bookH
    if pH_raw - bookH >= ML_T[lg]: leans.append(dict(kind="ml", text=f"Moneyline lean: {h['abbr']} {ml_h:+d}", why=f"model {pH_raw*100:.0f}% vs book {bookH*100:.0f}%"))
    elif bookH - pH_raw >= ML_T[lg]: leans.append(dict(kind="ml", text=f"Moneyline lean: {a['abbr']} {ml_a:+d}", why=f"model {(1-pH_raw)*100:.0f}% vs book {(1-bookH)*100:.0f}%"))
    cr = dict(projHome=round(projH, 1), projAway=round(projA, 1), projHomeNoInj=round(projH0, 1), projAwayNoInj=round(projA0, 1),
              projTotal=round(pt, 1), projMargin=round(marg, 1), pHome=round(pH, 3), bookHome=round(bookH, 3), leans=leans, learn=learn_info,
              matchups=[dict(title=f"{a['abbr']} offense vs {h['abbr']} defense", off=a["off"], dfn=h["def"], gap=a["off"] - h["def"],
                             offBase=a["offBase"], dfnBase=h["defBase"], offRank=a["offRank"], dfnRank=h["defRank"]),
                        dict(title=f"{h['abbr']} offense vs {a['abbr']} defense", off=h["off"], dfn=a["def"], gap=h["off"] - a["def"],
                             offBase=h["offBase"], dfnBase=a["defBase"], offRank=h["offRank"], dfnRank=a["defRank"])],
              ctx=dict(away=ctx["away"], home=ctx["home"]))

    # --- players analytics
    opp_of = {"away": "home", "home": "away"}
    # opposing probable pitcher rating for MLB hitters
    sp_info = {}
    if lg == "mlb":
        for side in ("away", "home"):
            pr = [x for x in P if x["side"] == side and x["fam"] == "P"]
            if pr:
                gl = pr[0]["gl"]
                er = sum(v(g, "earnedRuns") for g in gl); ip = sum((int(g["stats"].get("innings", 0)) * 3 + round((g["stats"].get("innings", 0) % 1) * 10)) / 3 for g in gl)
                era = 9 * er / ip if ip else 4.5
                era_s = 9 * (er + 4.2 * 30 / 9) / (ip + 30)     # shrink toward a 4.20 league ERA with 30 pseudo-innings
                avg_outs = statistics.mean(outs(g) for g in gl) if gl else 15
                sp_info[side] = dict(name=pr[0]["p"]["name"], era=round(era, 2), eraAdj=round(era_s, 2), rating=clamp(50 + (4.2 - era_s) * 15, 10, 90),
                                     w=clamp(avg_outs / 27 * 0.8, 0.15, 0.5), avgIP=round(avg_outs / 3, 1))
    # teammate-out boost data
    team_out = {"away": [], "home": []}
    for side in ("away", "home"):
        for i in teams[side]["injuries"]:
            if i["weight"] >= 0.5 and i["kind"] in ("out", "doubtful", "questionable") and not baked_in(lg, teams[side], i):
                team_out[side].append(i)
    players_out = []
    for X in P:
        p = X["p"]; side = X["side"]; opp = opp_of[side]; T = teams[side]; O = teams[opp]
        pid = p["id"]
        inj = next((i for i in T["injuries"] if i["id"] == pid or norm(i["name"]) == norm(p["name"])), None)
        # availability
        avail = 1.0; status = dict(label="Active", kind="ok", note="")
        if inj and inj["kind"] != "inactive":
            status = dict(label=inj["label"], kind=inj["kind"], note=inj["note"], ret=inj["ret"])
            avail = {"out": 0.0, "doubtful": 0.25, "questionable": 0.7, "dtd": 0.8, "probable": 0.92, "returning": 1.0}.get(inj["kind"], 1.0)
            if inj["kind"] == "questionable" and "expected to play" in inj["note"].lower(): avail = 0.9
        # absences from logs
        tg = T["_tg"][-6:]
        ev_played = {g["eventId"] for g in X["allgl"] if played(lg, g, X["fam"])}
        flags = []
        missed = [g["id"] for g in tg if g["id"] not in ev_played]
        ret_factor = 1.0
        if X["fam"] == "P":
            pass
        elif tg and missed and tg[-1]["id"] in ev_played:
            if lg == "mlb" and len(missed) < 2:
                flags.append(f"Sat out {len(missed)} of the last {len(tg)} team games (rest day or minor injury), back in the latest lineup")
            else:
                flags.append(f"Back from an absence: missed {len(missed)} of the last {len(tg)} team games, played the latest. Usage may be eased in.")
                ret_factor = {"nfl": 0.97, "wnba": 0.95, "mlb": 0.98}[lg]
        elif tg and missed and tg[-1]["id"] not in ev_played:
            flags.append(f"Did not play the latest team game (missed {len(missed)} of the last {len(tg)})")
        # usage boost from out teammates
        boost = 0.0; boost_note = []
        for i in team_out[side]:
            if i["id"] == pid: continue
            w = i["weight"]
            if lg == "nfl" and i["pos"] in ("RB", "WR", "TE") and X["fam"] in ("RB", "WR"):
                s_i, a_i = prod_nfl(i["id"]) if i["id"] else (0, 0)
                share = s_i / team_scrim[side][0]
                same = (i["pos"] == "RB") == (X["fam"] == "RB")
                b = (0.8 if same else 0.25) * share * w
                if b >= 0.01: boost += b; boost_note.append(f"{i['name']} out: +{b*100:.0f}%")
            elif lg == "wnba":
                r = gamelog("wnba", i["id"])
                if r:
                    gl2 = [g for g in r[1] if (g["stats"].get("minutes") or 0) > 0][-10:]
                    if gl2:
                        mins = statistics.mean(v(g, "minutes") for g in gl2)
                        b = 0.5 * (mins / 200.0) * w
                        if b >= 0.01: boost += b; boost_note.append(f"{i['name']} out: +{b*100:.0f}%")
        boost = min(boost, 0.12)
        # opponent defense/offense rating for matchup
        defs = STATS[lg][X["fam"] if lg == "nfl" else ("ALL" if lg == "wnba" else X["fam"])]
        # 15-game display window (SGP chart). The model still uses only the last 10 games played.
        by_eid = {g["eventId"]: g for g in X["gl"]}
        model_eids = {g["eventId"] for g in X["gl"][-10:]}
        slots = []
        if X["fam"] == "P" or not T.get("_tg"):
            for g in X["gl"][-15:]:
                slots.append(dict(eid=g["eventId"], date=g["date"][:10], opp=g["opp"], home=g["home"], res=g["result"], post=g["post"], dnp=False, model=g["eventId"] in model_eids))
        else:
            first = min((g["date"] for g in X["gl"]), default=None)
            for tgm in T["_tg"]:
                if first is not None and tgm["date"] < first: continue
                g = by_eid.get(tgm["id"])
                if g is not None:
                    slots.append(dict(eid=g["eventId"], date=g["date"][:10], opp=g["opp"], home=g["home"], res=g["result"], post=g["post"], dnp=False, model=g["eventId"] in model_eids))
                else:
                    slots.append(dict(eid=tgm["id"], date=tgm["date"][:10], opp=tgm["opp"], home=tgm["home"], res=("W " if tgm["win"] else "L ") + f"{int(tgm['pf'])}-{int(tgm['pa'])}", post=tgm["post"], dnp=True, model=False))
            slots = slots[-15:]
        stats_out = []
        pstat_ratings = {}
        for key, label, fn, book_names, mile, ref in defs:
            gl = X["gl"][-10:]
            vals = [fn(g) for g in gl]
            n = len(vals)
            if n == 0: continue
            v15 = [None if s_["dnp"] else fn(by_eid[s_["eid"]]) for s_ in slots]
            vals15 = [x for x in v15 if x is not None] or vals
            bl, miles = book_lines(pidx, pid, book_names, mile)
            avg = statistics.mean(vals); avg5 = statistics.mean(vals[-5:])
            allv = [fn(g) for g in X["gl"]]
            season = statistics.mean(allv) if allv else avg
            if len(allv) >= 20: base = 0.25 * avg5 + 0.25 * avg + 0.5 * season
            else: base = avg if n < 5 else 0.6 * avg5 + 0.4 * avg
            # player rating vs a typical starter (0-100)
            prate = clamp(50 + 35 * math.log(max(base, 0.05) / ref, 2), 5, 99)
            if lg == "mlb" and X["fam"] == "P":
                opp_r = O["off"]; opp_lab = f"{O['abbr']} offense"
            elif lg == "mlb":
                sp = sp_info.get(opp)
                if sp:
                    opp_r = (1 - sp["w"]) * O["def"] + sp["w"] * sp["rating"]
                    opp_lab = f"{O['abbr']} pitching (SP {sp['name']}, {sp['eraAdj']:.2f} adj. ERA, ~{sp['avgIP']} IP per outing)"
                else:
                    opp_r = O["def"]; opp_lab = f"{O['abbr']} pitching"
            else:
                opp_r = O["def"]; opp_lab = f"{O['abbr']} defense"
            # opponent strength vs a league-average opponent, amplified for dominant players
            mu = clamp(0.36 * (50 - opp_r) / 100 * (0.6 + 0.8 * prate / 100), -0.18, 0.18)
            matchup = 1 + mu
            mnote = f"{surname(p['name'])} rating {prate:.0f} vs {opp_lab} {opp_r:.0f}: {mu*100:+.0f}%"
            proj = base * matchup * (1 + boost) * ret_factor * (0.97 if status["kind"] in ("questionable", "dtd", "doubtful") else 1.0)
            anchor_note = ""
            if bl and bl["line"] > 0:
                gap = abs(proj - bl["line"]) / bl["line"]
                far = gap > 0.30 and abs(proj - bl["line"]) >= max(1.5, 0.15 * bl["line"])
                wgt = 0.5 if far else 0.25
                if far: anchor_note = "The book line is far from recent usage (possible role or workload change), so the projection is pulled toward it."
                proj = (1 - wgt) * proj + wgt * bl["line"]
            # line
            if bl: line = bl["line"]; lsrc = "DraftKings"
            else:
                line = math.floor(statistics.median(vals)) + 0.5 if statistics.median(vals) >= 1 else 0.5; lsrc = "model"
            over_hits = sum(1 for x in vals if x > line)
            over_hits15 = sum(1 for x in vals15 if x > line)
            streak = 0; direction = None
            for x in reversed(vals15):
                d_ = "over" if x > line else "under"
                if direction is None: direction = d_
                if d_ == direction: streak += 1
                else: break
            mn, mx = min(vals15), max(vals15)
            safe = int(mn) if mn >= 1 else None
            safe_adj = safe
            if safe is not None:
                f = min(1.0, matchup) * ret_factor * (0.97 if status["kind"] in ("questionable", "dtd", "doubtful") else 1.0)
                safe_adj = max(1, int(math.floor(safe * f + 1e-9))) if f < 0.999 else safe
                if f < 0.999 and safe_adj == safe: pass
                if safe_adj >= safe: safe_adj = safe
            hc, hcnote = hotcold(vals)
            g_, gpct, gwarn = grade_of(vals)
            sd = statistics.pstdev(vals) if n > 1 else line * 0.5
            sd_adj = max(sd, 0.15 * line, 0.5)
            p_norm = 1 - phi((line - proj) / sd_adj)
            p_emp = (over_hits + 1) / (n + 2)
            p_over = clamp(0.5 * p_emp + 0.5 * p_norm, 0.04, 0.96)
            p_safe = None
            if safe_adj is not None:
                n_clear = sum(1 for x in vals if x >= safe_adj)
                p_safe = clamp((n_clear + 1) / (n + 2), 0.2, 0.95)
            margin = max(0.07 * line, 0.25 if line < 5 else 0)
            lean = "Over" if proj >= line + margin else "Under" if proj <= line - margin else "No edge"
            # milestone legs (book prices where published)
            mlist = []
            for t_, a_ in miles:
                if t_ is None: continue
                mlist.append(dict(t=t_, price=a_, hit=sum(1 for x in vals15 if x >= t_), n=len(vals15)))
            # safe price: exact milestone match
            safe_price = None; safe_src = "est."
            if safe_adj is not None:
                mm = [m for m in mlist if m["t"] == safe_adj and m["price"] is not None]
                if mm: safe_price = mm[0]["price"]; safe_src = "DraftKings"
                else: safe_price = est_price(p_safe)
            stats_out.append(dict(key=key, label=label, vals=[round(x, 1) if x != int(x) else int(x) for x in vals], line=line, lineSrc=lsrc,
                                  prices=(bl or {}).get("prices", []), n=n, avg=r1(avg), avg5=r1(avg5), mn=mn, mx=mx, safe=safe, safeAdj=safe_adj,
                                  overHits=over_hits, streak=streak, streakDir=direction, hot=hc, hotNote=hcnote, grade=g_, gradePct=gpct,
                                  proj=round(proj, 1), season=r1(season), anchorNote=anchor_note, matchup=round(mu, 3), matchupNote=mnote, boost=round(boost, 3), lean=lean,
                                  pOver=round(p_over, 3), overPrice=est_price(p_over), pSafe=(round(p_safe, 3) if p_safe is not None else None),
                                  safePrice=safe_price, safeSrc=safe_src, miles=mlist[:14], prate=round(prate),
                                  v15=[None if x is None else (round(x, 1) if x != int(x) else int(x)) for x in v15], n15=len(vals15), overHits15=over_hits15, sd=round(sd_adj, 2)))
        games_meta = [dict(date=g["date"][:10], opp=g["opp"], home=g["home"], res=g["result"], post=g["post"]) for g in X["gl"][-10:]]
        players_out.append(dict(id=pid, name=p["name"], side=side, abbr=T["abbr"], pos=p["pos"], jersey=p.get("jersey"), status=status, avail=avail,
                                flags=flags, boostNotes=boost_note, games=games_meta, slots=slots, stats=stats_out, fam=X["fam"]))
    # --- output
    gout = dict(id=G["event"], lg=lg, league={"nfl": "NFL", "wnba": "WNBA", "mlb": "MLB"}[lg],
                title=f"{a['name']} at {h['name']}", start=start.strftime("%-I:%M %p ET"), startDate=start.strftime("%a %b %-d"), iso=start.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), day=start.strftime("%Y-%m-%d"),
                venue=(comp.get("venue") or {}).get("fullName") or "", tv=", ".join(sum([b.get("names", []) for b in comp.get("broadcasts", [])], [])),
                series=_series(summ),
                note=((comp.get("notes") or [{}])[0].get("headline") if comp.get("notes") else None),
                teams={k: {kk: vv for kk, vv in teams[k].items() if kk != "_tg"} for k in teams},
                lines=dict(dk=dk_links(sb), mlHome=ml_h, mlAway=ml_a, sprHome=spr_h, sprAway=spr_a, prHome=pr_h, prAway=pr_a, total=total, over=o_odds, under=u_odds),
                crossroads=cr, players=players_out, n=NT)
    return gout
