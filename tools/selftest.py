#!/usr/bin/env python3
"""Offline self-test (no network): python tools/selftest.py
Checks the date helpers, the history store, the prediction log (first snapshot kept, idempotent, graded once, bounded calibration)
and the cron budget. Exits non-zero on the first failure."""
import os, sys, json, tempfile, shutil, datetime, random
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine")); sys.path.insert(0, os.path.join(ROOT, "tools"))
tmp = tempfile.mkdtemp(); os.environ["LS_ROOT"] = tmp; os.environ["LS_CACHE"] = os.path.join(tmp, ".cache")
shutil.copytree(os.path.join(ROOT, "store"), os.path.join(tmp, "store"))
ok = 0
def check(name, cond, extra=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra) if extra else ""))
    if not cond: sys.exit(1)
    ok += 1

from timeutil import ET, UTC, today_et, et_date_of
check("ET date: 2026-07-01T02:30Z is still June 30 in Eastern time", str(et_date_of("2026-07-01T02:30:00Z")) == "2026-06-30")
check("ET date: winter offset (-5h)", str(et_date_of("2026-12-01T04:30:00Z")) == "2026-11-30")

from store import Store, LEAGUES
st = Store()
n0 = {lg: len(st.games[lg]) for lg in LEAGUES}
g = next(iter(st.games["mlb"].values()))
check("store: re-upserting an identical game changes nothing", st.upsert("mlb", dict(g)) is False and not st.dirty)
g2 = dict(g); g2["hs"] = g["hs"] + 1
check("store: a changed score is an update", st.upsert("mlb", g2) is True and "mlb" in st.dirty)
st.upsert("mlb", dict(g)); st.dirty.clear()
st.save(); st2 = Store()
check("store: save/load round trip keeps every game", {lg: len(st2.games[lg]) for lg in LEAGUES} == n0, n0)

from predlog import PredLog, MIN_FOR_SLOPE, SLOPE_BOUNDS
now = datetime.datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
fin = sorted(st.games["mlb"].values(), key=lambda x: x["date"])[-120:]
random.seed(7)
def fake_game(r, pH, home_lean):
    return dict(id=r["id"], lg="mlb", key="mlb", iso=r["date"], teams=dict(home=dict(abbr=r["home"]), away=dict(abbr=r["away"])),
                lines=dict(sprHome=-1.5, total=8.5), crossroads=dict(pHome=pH, bookHome=0.5, projMargin=0.3, projTotal=8.7, learn=dict(rawMargin=0.2, rawTotal=8.6),
                leans=[dict(kind="ml", text=("Moneyline lean: %s -120" % (r["home"] if home_lean else r["away"])))]))
pl = PredLog(tmp)
games = [fake_game(r, 0.5 + random.random() * 0.4, random.random() < 0.5) for r in fin]
# make the first 60 "pre-kickoff" for the run time; the rest start after `now` too (all finals are in the store already, grading is what we test)
for r in games: r["iso"] = (now + datetime.timedelta(hours=5)).strftime("%Y-%m-%dT%H:%MZ")
n1 = pl.log_games(games, now, {})
check("predlog: every upcoming game is logged once", n1 == len(games), n1)
for r in games: r["crossroads"]["pHome"] = 0.99          # a later run sees different numbers...
n2 = pl.log_games(games, now + datetime.timedelta(hours=1), {})
check("predlog: second run logs nothing new and keeps the FIRST snapshot", n2 == 0 and all(v["pH"] != 0.99 for v in pl.recs.values()))
late = fake_game(fin[0], 0.6, True); late["id"] = "x1"; late["iso"] = "2026-09-01T11:00Z"
check("predlog: a game that already started is not logged", pl.log_games([late], now, {}) == 0)
ng = pl.grade(st)
check("predlog: finals in the store are graded", ng == len(games), ng)
check("predlog: grading again does nothing", pl.grade(st) == 0)
sm = pl.summary()
check("predlog: summary counts graded games", sm["_all"]["n"] >= len(games) - 5, sm["_all"]["n"])
sl = pl.slopes()
lo, hi = SLOPE_BOUNDS
check("predlog: calibration slope is bounded and needs >= %d graded games" % MIN_FOR_SLOPE, all(lo <= v <= hi for v in sl.values()) and "mlb" in sl, sl)
small = PredLog(tmp); small.recs = dict(list(pl.recs.items())[:MIN_FOR_SLOPE - 1])
check("predlog: too few graded games -> no adjustment at all", small.slopes() == {})
pl.save(datetime.date(2026, 9, 1)); pl2 = PredLog(tmp)
check("predlog: file round trip", len(pl2.recs) == len(pl.recs))

import subprocess
r = subprocess.run([sys.executable, os.path.join(ROOT, "build_site.py"), "--check"], capture_output=True, text=True)
check("index.html is up to date with src/", r.returncode == 0, r.stdout.strip())
import budget
check("budget: cron schedule fits the 1,990 minute plan", budget.check(quiet=True))
shutil.rmtree(tmp, ignore_errors=True)
print(f"\nall {ok} checks passed")
