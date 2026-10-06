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

# ---- social features (offline parts; the database itself is tested by tools/localstack/run_all.sh)
import social, simdata, base64
def jwt_of(role): return "x." + base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=") + ".y"
check("social: anon / publishable keys may be published, service / secret keys never", social.public_key(jwt_of("anon")) and social.public_key("sb_publishable_x") and not social.public_key(jwt_of("service_role")) and not social.public_key("sb_secret_x"))
cfgdir = os.path.join(tmp, "cfg"); os.makedirs(cfgdir)
os.environ.update(SUPABASE_URL="https://abc.supabase.co", SUPABASE_ANON_KEY=jwt_of("service_role"))
social.write_config(cfgdir); c1 = json.load(open(os.path.join(cfgdir, "config.json")))
os.environ["SUPABASE_ANON_KEY"] = jwt_of("anon"); social.write_config(cfgdir); c2 = json.load(open(os.path.join(cfgdir, "config.json")))
for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY"): os.environ.pop(k, None)
check("social: data/config.json refuses a secret key and carries URL + anon key", c1["supabaseAnonKey"] == "" and c2["supabaseUrl"] == "https://abc.supabase.co" and c2["supabaseAnonKey"] == jwt_of("anon"))
summ = {"header": {"competitions": [{"competitors": [{"homeAway": "home", "score": "6"}, {"homeAway": "away", "score": "2"}]}]},
        "boxscore": {"players": [{"statistics": [{"type": "batting", "keys": ["hits", "runs", "RBIs"], "athletes": [{"athlete": {"id": 7}, "stats": ["2", "1", "3"]}]},
                                                 {"type": "pitching", "keys": ["strikeouts", "fullInnings.partInnings"], "athletes": [{"athlete": {"id": 9}, "stats": ["8", "6.2"]}]}]}]},
        "plays": [{"text": "Smith doubled to left.", "participants": [{"type": "batter", "athlete": {"id": 7}}]}, {"text": "Smith homered to center (402 feet).", "participants": [{"type": "batter", "athlete": {"id": 7}}]}]}
h, a, box, dnp = social.box_of("mlb", summ); fd = social.final_doc("1", h, a, box, dnp)
check("social: box score parser (port of the page): hits, runs, RBI, total bases from plays, pitcher outs, composites", (h, a) == (6, 2) and fd["stat"]["7"] == {"hits": 2, "runs": 1, "rbi": 3, "tb": 6, "pr": 0, "rr": 0, "pra": 0, "hrr": 6} and fd["stat"]["9"]["outs"] == 20 and fd["played"]["7"] is True, fd)
lj = {"leagues": {"nba": {"ratings": {"BOS": {"o": 1, "d": -1, "gp": 9}, "LAL": {"o": 0, "d": 0, "gp": 9}}, "L": 114.3, "params": {"hfa": 2.0}}}}
sim = simdata.build(lj, {"teams": {"nba": {"teams": [{"id": "2", "abbr": "BOS", "name": "Boston Celtics", "short": "Celtics", "color": "#008348"}]}}, "players": {"nba": {"season": 2026, "list": [{"pid": str(i), "team": "BOS", "name": "J T%d" % i, "pos": "F", "role": "P", "rk": i, "stats": {"pts": 27 - i, "reb": 5, "ast": 3, "fg3": 2, "mp": 30, "gp": 20}} for i in range(1, 10)]}}})
tr, pr = simdata.rows(sim)
check("simdata: battle teams from the learned ratings + player averages", len(tr) == 2 and tr[0]["lg_avg"] == 114.3 and pr[0]["team"] == "BOS" and sim["sports"]["nba"]["teams"][1]["name"] == "LAL", (tr, pr))
sq = open(os.path.join(ROOT, "supabase", "setup.sql")).read()
check("setup.sql: row level security on every table, schedules, no write grants to app roles",
      sq.count("enable row level security") >= 1 and "ls-finalize-days" in sq and "ls-battle-tick" in sq and "grant insert" not in sq.lower().replace("grant select, insert, update, delete on public.games, public.sim_teams, public.sim_players to service_role", ""))

import subprocess
r = subprocess.run([sys.executable, os.path.join(ROOT, "build_site.py"), "--check"], capture_output=True, text=True)
check("index.html is up to date with src/", r.returncode == 0, r.stdout.strip())
import budget
check("budget: cron schedule fits the 1,990 minute plan", budget.check(quiet=True))
shutil.rmtree(tmp, ignore_errors=True)
print(f"\nall {ok} checks passed")
