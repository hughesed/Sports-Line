"""Offline test of the ESPN cross-reference (engine/fdenrich.py) for FanDuel players a card is missing.
An NHL card with no players and a FanDuel event (team unknown, as FanDuel lists it) for TOR @ CBJ: each player is found on the ESPN roster (team, id),
his game log (this season + last season's playoffs) gives the record, then fanduel.apply puts FanDuel's lines and rungs on. Also: an NBA card that has some players
gets only the missing ones, a name ESPN spells differently still matches, two roster players with the same weak spelling are never guessed.
Run: python tools/espn_xref_test.py"""
import os, sys, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.path.join(ROOT, "engine"))
import fdenrich, fanduel, feeds, espn
NOW = datetime.datetime(2026, 10, 20, 15, 0, tzinfo=datetime.timezone.utc)
ok = fail = 0
def check(c, what):
    global ok, fail
    if c: ok += 1; print("  ok  ", what)
    else: fail += 1; print("  FAIL", what)
ROSTER = {("nhl", "21"): [{"id": "3114727", "name": "Auston Matthews", "pos": "C", "inj": [], "jersey": "34"}, {"id": "9", "name": "William Nylander", "pos": "RW", "inj": []}],
          ("nhl", "29"): [{"id": "4697382", "name": "Zach Werenski", "pos": "D", "inj": []}, {"id": "77", "name": "Elvis Merzlikins", "pos": "G", "inj": []},
                          {"id": "81", "name": "Kent Johnson", "pos": "C", "inj": []}, {"id": "82", "name": "Kenny Johnson", "pos": "LW", "inj": []}],
          ("nba", "2"): [{"id": "4065648", "name": "Jayson Tatum", "pos": "SF", "inj": []}, {"id": "500", "name": "Nicolas Claxton", "pos": "C", "inj": ["Out"]}],
          ("nba", "8"): [{"id": "4432166", "name": "Cade Cunningham", "pos": "PG", "inj": []}]}
feeds.roster_players = lambda lg, tid: ROSTER.get((lg, str(tid)), [])
def log(lg, aid):
    rows = []
    def add(i, season, post, pre, **st): rows.append({"eventId": f"{aid}{i}", "date": f"2026-{4 + i // 30:02d}-{1 + i % 28:02d}T00:00Z", "opp": "X", "home": True, "result": "W", "post": post, "pre": pre, "season": season, "stats": st})
    if aid == "3114727":
        for i in range(10): add(i, "2025-26", False, False, goals=1 if i % 2 else 0, assists=1, points=2 if i % 2 else 1, shotsTotal=4 + i % 3, timeOnIcePerGame="20:01")
        for i in range(10, 18): add(i, "2025-26", True, False, goals=1, assists=0, points=1, shotsTotal=5, timeOnIcePerGame="21:00")
        for i in range(40, 43): rows.append({"eventId": f"p{i}", "date": f"2026-10-{i - 35:02d}T00:00Z", "opp": "Y", "home": False, "result": "L", "post": False, "pre": False, "season": "2026-27", "stats": {"goals": 0, "assists": 0, "points": 0, "shotsTotal": 2, "timeOnIcePerGame": "18:00"}})
    elif aid == "77":
        for i in range(12): add(i, "2025-26", False, False, gameStarted=1, saves=26 + i % 5, shotsAgainst=30)
    elif aid == "4697382":
        for i in range(12): add(i, "2025-26", False, False, goals=0, assists=1, points=1, shotsTotal=3 + i % 2, timeOnIcePerGame="25:00")
    else:
        for i in range(12): add(i, "2025-26", False, False, minutes=30, points=20, totalRebounds=8, assists=5)
    return [], sorted(rows, key=lambda g: g["date"])
espn.gamelog_multi = log; espn.prefetch_gamelogs = lambda *a, **k: None
def bk(o, line=None, alts=None):
    b = {"odds": o, "line": line, "link": "https://sportsbook.fanduel.com/addToBetslip?marketId=1&selectionId=%d" % abs(o)}
    if alts: b["alts"] = alts
    return {"fanduel": b}
def ou(name, stat, line, o, u, alts=None):
    return [{"pid": "fd:" + name, "name": name, "team": None, "stat": stat, "type": "ou", "side": "over", "fair": {"odds": o}, "books": bk(o, line, alts)},
            {"pid": "fd:" + name, "name": name, "team": None, "stat": stat, "type": "ou", "side": "under", "fair": {"odds": u}, "books": bk(u, line)}]
def lad(name, stat, rungs): return {"pid": "fd:" + name, "name": name, "team": None, "stat": stat, "type": "ladder", "rungs": [{"t": float(t), "odds": o, "link": "L%d" % t} for t, o in rungs]}
hk = {"id": "fd1", "src": "fanduel", "league": "NHL", "start": "2026-10-20T23:10:00Z", "homeName": "Columbus Blue Jackets", "awayName": "Toronto Maple Leafs", "main": {"ml": {"home": {"books": bk(-154)}, "away": {"books": bk(128)}}},
      "props": ou("Auston Matthews", "sog", 3.5, -120, -105, [{"odds": -400, "line": 1.5, "link": "s2"}, {"odds": 110, "line": 3.5, "link": "s4"}]) + [lad("Auston Matthews", "pts", [(1, -200), (2, 220)]),
               lad("Zach Werenski", "sog", [(2, -350), (4, -102)]), lad("Elvis Merzlikins", "saves", [(20, -400), (25, -130)]), lad("Ken Johnson", "pts", [(1, 120)]), lad("Nobody Here", "pts", [(1, 300)])]}
nba = {"id": "fd2", "src": "fanduel", "league": "NBA", "start": "2026-10-20T19:00:00Z", "homeName": "Detroit Pistons", "awayName": "Boston Celtics", "main": {"ml": {"home": {"books": bk(102)}, "away": {"books": bk(-120)}}},
       "props": ou("Jayson Tatum", "fg3", 2.5, -156, 122) + [lad("Nic Claxton", "reb", [(6, -200)]), lad("Cade Cunningham", "ast", [(6, -900)])]}
gh = {"id": "n1", "key": "nhl", "lg": "nhl", "iso": "2026-10-20T23:10:00Z", "players": [], "lines": {}, "crossroads": {},
      "teams": {"away": {"id": "21", "abbr": "TOR", "name": "Toronto Maple Leafs", "short": "Maple Leafs"}, "home": {"id": "29", "abbr": "CBJ", "name": "Columbus Blue Jackets", "short": "Blue Jackets"}}}
gb = {"id": "b1", "key": "nba", "lg": "nba", "iso": "2026-10-20T19:00:00Z", "lines": {}, "crossroads": {},
      "players": [{"id": "4065648", "name": "Jayson Tatum", "side": "away", "stats": [{"key": "fg3", "vals": [3] * 10, "v15": [3] * 15, "proj": 3, "sd": 1.2, "line": 2.5, "miles": []}]}],
      "teams": {"away": {"id": "2", "abbr": "BOS", "name": "Boston Celtics", "short": "Celtics"}, "home": {"id": "8", "abbr": "DET", "name": "Detroit Pistons", "short": "Pistons"}}}
odds = {"events": [hk, nba]}
msg = fdenrich.enrich([gh, gb], odds, NOW); print(msg)
P = {p["name"]: p for p in gh["players"]}
check(set(P) == {"Auston Matthews", "Zach Werenski", "Elvis Merzlikins"}, "NHL card gets the FanDuel players ESPN can place (not the unknown one, not the ambiguous Johnson): %s" % sorted(P))
m = P.get("Auston Matthews", {})
check(m.get("side") == "away" and m.get("abbr") == "TOR" and m.get("id") == "3114727", "Matthews: team TOR from the ESPN roster, ESPN id for grading")
sog = next((s for s in m.get("stats", []) if s["key"] == "sog"), {})
check(sog.get("xref") == "espn" and sog.get("n15") == 13 and len(sog.get("post") or []) == 8, "shots from his regular-season ESPN log only (playoffs kept for reference) (%s, post %s)" % (sog.get("n15"), sog.get("post")))
check(P.get("Elvis Merzlikins", {}).get("side") == "home" and any(s["key"] == "saves" for s in P["Elvis Merzlikins"]["stats"]), "goalie saves for CBJ")
B = {p["name"]: p for p in gb["players"]}
check(set(B) == {"Jayson Tatum", "Nic Claxton", "Cade Cunningham"} and sum(1 for p in gb["players"] if p["name"] == "Jayson Tatum") == 1, "NBA card keeps Tatum once, adds Claxton (ESPN spells him Nicolas) and Cunningham")
check(B["Nic Claxton"]["status"]["kind"] == "out", "ESPN roster's Out status carries over")
st = fanduel.apply([gh, gb], odds, NOW); print(st)
mm = next(x for x in sog["miles"] if x["t"] == 2.0)
check(mm.get("fd") and mm["price"] == -400 and mm["hit"] >= 13 and mm.get("pn") == 8, "Matthews 2+ shots at FanDuel's -400 with his record %s/%s, playoffs %s/%s" % (mm.get("hit"), mm.get("n"), mm.get("ph"), mm.get("pn")))
pts = next(s for s in m["stats"] if s["key"] == "pts"); r1 = next(x for x in pts["miles"] if x["t"] == 1.0)
check(r1["price"] == -200 and r1["p"] > 0.6, "Matthews 1+ point (ladder only) -200, chance %.2f" % r1["p"])
check(sog["lineSrc"] == "FanDuel" and sog["line"] == 3.5, "FanDuel's line on the ESPN-backed stat")
print(f"\n{ok} passed, {fail} failed"); sys.exit(1 if fail else 0)
