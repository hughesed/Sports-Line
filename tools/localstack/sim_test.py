#!/usr/bin/env python3
"""Battle simulator sanity: thousands of simulated games per sport straight in the database (ls_private.sim_many).
Checks realistic scoring levels, that favourites win more often, and that the posted lines match what the simulator does."""
import os, sys, json, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_test import sql, check, RES

GAMES = [("nfl", "KC", "BUF", 800), ("nfl", "BUF", "NYJ", 800), ("nba", "BOS", "LAL", 500), ("nba", "OKC", "WSH", 500), ("mlb", "NYY", "BOS", 800), ("mlb", "LAD", "COL", 800), ("cfb", "JMU", "MIA", 600), ("cfb", "UNT", "UNM", 600), ("cbb", "VCU", "MCN", 400), ("cbb", "TOL", "STMN", 400)]
RANGE = {"nfl": (14, 34), "nba": (95, 135), "mlb": (2.8, 7.0), "cfb": (14, 50), "cbb": (55, 95)}         # one matchup can be lopsided
LEAGUE = {"nfl": (20, 27), "nba": (105, 120), "mlb": (4.0, 5.0), "cfb": (24, 36), "cbb": (66, 78)}       # league-wide average points per team
rows = []
for sp, h, a, n in GAMES:
    r = sql(f"""with s as (select * from ls_private.sim_many(%s, %s, %s, {n}))
               select avg(hs)::float, avg(as_)::float, stddev(hs - as_)::float, avg((hs > as_)::int)::float, avg((hs = as_)::int)::float, min(hs + as_), max(hs + as_) from s""", (sp, h, a))[0]
    m = sql("select public.battle_markets(%s, %s, %s)", (sp, h, a), one=True)
    rows.append((sp, h, a, n) + r + (m["pHome"], m["eh"], m["ea"]))
    hs, as_, sdm, ph, ties, lo, hi = r
    print(f"{sp.upper()} {a}@{h}: {n} sims  avg {as_:.1f}-{hs:.1f} (lines expect {m['ea']}-{m['eh']})  margin sd {sdm:.1f}  home wins {ph:.1%} (line {m['pHome']:.1%})  ties {ties:.1%}  totals {lo}..{hi}")
    lo_, hi_ = RANGE[sp]
    check(f"{sp.upper()} {a}@{h}: points per team in a realistic range", lo_ <= hs <= hi_ and lo_ <= as_ <= hi_, (round(hs, 2), round(as_, 2)))
    check(f"{sp.upper()} {a}@{h}: posted win chance matches the simulator (within 8 points)", abs(ph - float(m["pHome"])) <= 0.08, (round(ph, 3), m["pHome"]))
    fav_home = float(m["pHome"]) >= 0.5
    if abs(float(m["pHome"]) - 0.5) > 0.05:
        check(f"{sp.upper()} {a}@{h}: the favourite wins more often", (ph > 0.5) == fav_home, round(ph, 3))
import random
random.seed(11)
for sp in ("nfl", "nba", "mlb", "cfb", "cbb"):
    teams = [r[0] for r in sql("select abbr from public.sim_teams where sport = %s", (sp,))]
    pts = []
    for i in range(16):
        h, a = random.sample(teams, 2)
        r = sql("select avg(hs)::float, avg(as_)::float from ls_private.sim_many(%s, %s, %s, 40)", (sp, h, a))[0]; pts += [r[0], r[1]]
    avg = sum(pts) / len(pts); lo, hi = LEAGUE[sp]
    print(f"{sp.upper()} league-wide: {avg:.2f} points per team over 16 random matchups x 40 games")
    check(f"{sp.upper()} league-wide scoring is realistic ({lo}-{hi} per team)", lo <= avg <= hi, round(avg, 2))
check("NBA, college basketball and MLB games never end tied", all(r[8] == 0 for r in rows if r[0] in ("nba", "mlb", "cbb")))

# ---- per-player realism: the simulated stat lines of the main players
def players_avg(sp, pairs, n, pick):
    vals = []
    for h, a in pairs:
        m = sql("select public.battle_markets(%s, %s, %s)", (sp, h, a), one=True)
        res = sql("select players from ls_private.sim_many(%s, %s, %s, %s)", (sp, h, a, n))
        for (pl,) in res:
            for p in m["players"]:
                v = pick(p, pl.get(p["pid"]) or {})
                if v is not None: vals.append(v)
    return vals
v = players_avg("nfl", [("KC", "BUF"), ("DET", "GB"), ("ARI", "SEA")], 60, lambda p, st: st.get("passYds") if p["role"] == "QB" else None)
print(f"NFL starting QBs: {statistics.mean(v):.0f} passing yards per game (sd {statistics.pstdev(v):.0f}, min {min(v)}, max {max(v)})")
check("NFL starting QB averages 200-300 passing yards", 200 <= statistics.mean(v) <= 300, round(statistics.mean(v)))
check("NFL QB single-game range is realistic (no 0-yard or 600-yard games)", min(v) >= 60 and max(v) <= 520, (min(v), max(v)))
v = players_avg("nba", [("BOS", "LAL"), ("DEN", "OKC"), ("MIL", "NY")], 60, lambda p, st: st.get("pts") if p["rk"] == 1 else None)
print(f"NBA top-listed player: {statistics.mean(v):.1f} points per game (sd {statistics.pstdev(v):.1f}, max {max(v)})")
check("NBA top-listed player averages 18-30 points", 18 <= statistics.mean(v) <= 30, round(statistics.mean(v), 1))
check("NBA single-game points stay human (max < 65)", max(v) < 65, max(v))
v = players_avg("mlb", [("NYY", "LAD"), ("HOU", "ATL"), ("BOS", "SEA")], 120, lambda p, st: st.get("hits") if p["role"] == "H" else None)
print(f"MLB hitters: {statistics.mean(v):.2f} hits per game (max {max(v)})")
check("MLB hitters average 0.8-1.2 hits per game", 0.8 <= statistics.mean(v) <= 1.2, round(statistics.mean(v), 2))
check("MLB no hitter has more than 6 hits", max(v) <= 6, max(v))
v = players_avg("cfb", [("JMU", "MIA"), ("UNT", "UNM")], 80, lambda p, st: st.get("passYds") if p["role"] == "QB" else None)
check("college football starting QB averages 150-320 passing yards", 150 <= statistics.mean(v) <= 320, round(statistics.mean(v)))
v = players_avg("cbb", [("VCU", "MCN"), ("TOL", "STMN")], 80, lambda p, st: st.get("pts") if p["rk"] == 1 else None)
check("college basketball top-listed player averages 10-24 points", 10 <= statistics.mean(v) <= 24, round(statistics.mean(v), 1))
bad = [r for r in RES if not r[0]]
print(f"\n{len(RES) - len(bad)}/{len(RES)} simulator checks passed")
sys.exit(1 if bad else 0)
