#!/usr/bin/env python3
"""Battle simulator sanity: thousands of simulated games per sport straight in the database (ls_private.sim_many).
Checks realistic scoring levels, that favourites win more often, and that the posted lines match what the simulator does."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_test import sql, check, RES

GAMES = [("nfl", "KC", "BUF", 800), ("nfl", "BUF", "NYJ", 800), ("nba", "BOS", "LAL", 500), ("nba", "OKC", "WSH", 500), ("mlb", "NYY", "BOS", 800), ("mlb", "LAD", "COL", 800)]
RANGE = {"nfl": (14, 34), "nba": (95, 135), "mlb": (2.8, 7.0)}         # one matchup can be lopsided
LEAGUE = {"nfl": (20, 27), "nba": (105, 120), "mlb": (4.0, 5.0)}       # league-wide average points per team
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
for sp in ("nfl", "nba", "mlb"):
    teams = [r[0] for r in sql("select abbr from public.sim_teams where sport = %s", (sp,))]
    pts = []
    for i in range(16):
        h, a = random.sample(teams, 2)
        r = sql("select avg(hs)::float, avg(as_)::float from ls_private.sim_many(%s, %s, %s, 40)", (sp, h, a))[0]; pts += [r[0], r[1]]
    avg = sum(pts) / len(pts); lo, hi = LEAGUE[sp]
    print(f"{sp.upper()} league-wide: {avg:.2f} points per team over 16 random matchups x 40 games")
    check(f"{sp.upper()} league-wide scoring is realistic ({lo}-{hi} per team)", lo <= avg <= hi, round(avg, 2))
check("NBA and MLB games never end tied", all(r[8] == 0 for r in rows if r[0] in ("nba", "mlb")))
bad = [r for r in RES if not r[0]]
print(f"\n{len(RES) - len(bad)}/{len(RES)} simulator checks passed")
sys.exit(1 if bad else 0)
