"""Full games vs partial games (engine/espn.py full_games) on real cases: Henry Belin IV (Missouri State QB, 2026) came in for a few throws in 3 games,
then started and threw 39 times for 300 yards; FanDuel's line was 226.5. A starter's normal blowout rest, an NBA overtime game, an NHL minutes limit.
Run: python tools/full_games_test.py"""
import os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.path.join(ROOT, "engine"))
import espn, fdenrich
ok = fail = 0
def check(c, w):
    global ok, fail
    if c: ok += 1; print("  ok  ", w)
    else: fail += 1; print("  FAIL", w)
def g(i, **st): return {"eventId": str(i), "date": "2026-%02d-%02dT00:00Z" % (9 + i // 28, 1 + i % 28), "opp": "X", "home": True, "result": "W", "post": False, "pre": False, "season": "2026", "stats": st}
belin = [g(1, passingAttempts=1, completions=1, passingYards=11, rushingAttempts=0), g(8, passingAttempts=15, completions=7, passingYards=69, rushingAttempts=2),
         g(19, passingAttempts=14, completions=8, passingYards=115, rushingAttempts=1), g(26, passingAttempts=39, completions=28, passingYards=300, rushingAttempts=3)]
full, part = espn.full_games("cfb", belin, "QB")
check([x["stats"]["passingYards"] for x in full] == [300] and len(part) == 3, "Belin: only the 300-yard start is a full game (3 relief games left out)")
st = fdenrich._stat_from_logs("cfb", "passYds", belin, 226.5, "QB")
check(st["proj"] > 226.5 and st["thin"] and st["fullN"] == 1, "Belin pass yds: projection %.0f is over 226.5, flagged thin (1 full game)" % st["proj"])
qb = [g(i, passingAttempts=a, passingYards=y, rushingAttempts=3) for i, (a, y) in enumerate([(34, 250), (31, 230), (22, 170), (36, 280), (33, 240), (30, 220)])]
f2, p2 = espn.full_games("nfl", qb, "QB")
check(len(f2) == 6, "a starter's 22-attempt blowout game is still a full game")
nba = [g(i, minutes=m, points=p) for i, (m, p) in enumerate([(34, 22), (35, 25), (48, 38), (33, 20), (12, 4), (36, 24)])]
f3, p3 = espn.full_games("nba", nba, "G")
check(len(f3) == 5 and [x["stats"]["points"] for x in p3] == [4], "NBA: overtime game does not set the bar; the 12-minute game is partial")
nhl = [g(i, timeOnIcePerGame=t, shotsTotal=s) for i, (t, s) in enumerate([("19:40", 4), ("20:12", 3), ("8:05", 0), ("21:00", 5)])]
f4, p4 = espn.full_games("nhl", nhl, "C")
check(len(p4) == 1 and p4[0]["stats"]["shotsTotal"] == 0, "NHL: an 8-minute game is partial")
print("\n%d passed, %d failed" % (ok, fail)); sys.exit(1 if fail else 0)
