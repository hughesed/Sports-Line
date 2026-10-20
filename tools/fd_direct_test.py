"""Offline test of FanDuel direct (engine/fdapi.py) and of FanDuel ladders on player cards (engine/fanduel.py).
A fake FanDuel league page + event page shaped like the real ones (BOS @ DET, 2026-10-20) goes through fdapi.refresh into a temp odds.json,
then fanduel.apply puts FanDuel's lines and its X+ rungs on a card whose players have game logs (last 15 + last season's playoffs).
Run: python tools/fd_direct_test.py"""
import os, sys, json, tempfile, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.path.join(ROOT, "engine"))
import fdapi, fanduel

def r(name, odds, h=0, sid=1): return {"selectionId": sid, "runnerName": name, "handicap": h, "runnerStatus": "ACTIVE", "winRunnerOdds": {"americanDisplayOdds": {"americanOdds": odds, "americanOddsInt": odds}}}
def m(mid, mt, nm, rs): return {"marketId": mid, "marketType": mt, "marketName": nm, "marketStatus": "OPEN", "inPlay": False, "runners": rs}
NOW = datetime.datetime(2026, 10, 20, 15, 0, tzinfo=datetime.timezone.utc)
PAGE = {"attachments": {"events": {"35928218": {"eventId": 35928218, "name": "Boston Celtics @ Detroit Pistons", "openDate": "2026-10-20T19:00:00.000Z"},
                                   "1": {"eventId": 1, "name": "NBA Futures", "openDate": "2026-06-10T19:55:00.000Z"}}}}
MAIN = [m("726.1", "MONEY_LINE", "Moneyline", [r("Boston Celtics", -120, 0, 60427), r("Detroit Pistons", 102, 0, 237474)]),
        m("726.2", "MATCH_HANDICAP_(2-WAY)", "Spread", [r("Boston Celtics", -110, -1.5), r("Detroit Pistons", -110, 1.5)]),
        m("726.3", "TOTAL_POINTS_(OVER/UNDER)", "Total Points", [r("Over", -110, 220.5), r("Under", -110, 220.5)])]
TABS = {"player-threes": [m("726.4", "PLAYER_A_TOTAL_MADE_3_POINT_FIELD_GOALS", "Jayson Tatum - Made Threes", [r("Jayson Tatum Over", -156, 2.5), r("Jayson Tatum Under", 122, 2.5)]),
                          m("726.5", "2+_MADE_THREES", "2+ Made Threes", [r("Jayson Tatum", -500, 0, 13080925), r("Duncan Robinson", -310, 0, 26733620)])],
        "player-rebounds": [m("726.6", "TO_RECORD_8+_REBOUNDS", "To Record 8+ Rebounds", [r("Jayson Tatum", -210, 0, 13080925), r("Ausar Thompson", 190)]),
                            m("726.7", "TO_RECORD_6+_REBOUNDS", "To Record 6+ Rebounds", [r("Ausar Thompson", -150, 0, 51589520)])],
        "player-assists": [m("726.8", "TO_RECORD_6+_ASSISTS", "To Record 6+ Assists", [r("Cade Cunningham", -900, 0, 36981570)]),
                           m("726.9", "1ST_QUARTER_-_TO_SCORE_8+_POINTS", "1st Quarter - To Score 8+ Points", [r("Cade Cunningham", 120)])]}
LAYOUT = {"tabs": {str(i): {"title": t} for i, t in enumerate(["Popular", "Player Points", "Player Threes", "Player Rebounds", "Player Assists", "Player Combos", "Player Defense"])}}
calls = []
def fake_page(lg): calls.append(("page", lg)); return PAGE
def fake_event(eid, tab=None):
    calls.append(("event", eid, tab))
    mk = MAIN + (TABS.get(tab) or [])
    return {"layout": LAYOUT, "attachments": {"markets": {x["marketId"]: x for x in mk}}}
fdapi._page = fake_page; fdapi._event = fake_event

def stat(key, vals, post=None, proj=None):
    return {"key": key, "label": key, "vals": vals[-10:], "v15": vals[-15:], "post": post or [], "proj": proj if proj is not None else sum(vals) / len(vals), "sd": 2.0, "line": 2.5, "miles": []}
card = {"id": "401909088", "key": "nba", "lg": "nba", "iso": "2026-10-20T19:00:00Z",
        "teams": {"away": {"abbr": "BOS", "name": "Boston Celtics", "short": "Celtics"}, "home": {"abbr": "DET", "name": "Detroit Pistons", "short": "Pistons"}},
        "lines": {}, "crossroads": {},
        "players": [{"id": "4065648", "name": "Jayson Tatum", "stats": [stat("fg3", [3, 2, 4, 1, 3, 2, 5, 3, 2, 3, 4, 2, 3, 3, 2], [2, 3, 4, 1, 3, 2]), stat("reb", [9, 8, 10, 7, 11, 8, 9, 6, 10, 9, 8, 12, 9, 7, 10], [10, 9, 11])]},
                    {"id": "3157465", "name": "Duncan Robinson", "stats": [stat("fg3", [3, 2, 2, 4, 1, 3, 2, 3, 2, 5, 2, 3, 1, 2, 3])]},
                    {"id": "4432166", "name": "Cade Cunningham", "stats": [stat("ast", [9, 8, 10, 7, 9, 11, 6, 8, 9, 10, 7, 9, 8, 12, 9], [8, 9, 7, 10, 11, 9, 8])]},
                    {"id": "5", "name": "Ausar Thompson", "stats": [stat("reb", [6, 7, 5, 8, 6, 9, 4, 7, 6, 8, 5, 7, 6, 7, 8])]}]}
ok = fail = 0
def check(cond, what):
    global ok, fail
    if cond: ok += 1; print("  ok  ", what)
    else: fail += 1; print("  FAIL", what)

with tempfile.TemporaryDirectory() as d:
    cache, oddsp = os.path.join(d, "fdodds.json"), os.path.join(d, "odds.json")
    json.dump({"generatedAt": "2026-10-16T09:41:04Z", "events": [{"id": "sgoX", "league": "NBA", "start": "2026-10-20T19:00:00Z", "homeName": "Detroit Pistons", "awayName": "Boston Celtics", "main": {}, "props": []},
                                                                 {"id": "sgoY", "league": "NFL", "start": "2026-10-21T00:15:00Z", "homeName": "Chicago Bears", "awayName": "New England Patriots", "main": {}, "props": []}]}, open(oddsp, "w"))
    st = fdapi.refresh(cache, oddsp, [card], NOW)
    print(st)
    check(st.startswith("ok: 1 games"), "pulls the slate game")
    tabs = sorted(t for c in calls if c[0] == "event" for t in [c[2]] if t)
    check(tabs == ["player-assists", "player-combos", "player-points", "player-rebounds", "player-threes"], "reads the five player tabs (not defense): %s" % tabs)
    O = json.load(open(oddsp))
    ids = [e["id"] for e in O["events"]]
    check("fd35928218" in ids and "sgoX" not in ids and "sgoY" in ids, "FanDuel's event replaces the feed's event for the same game, other games stay: %s" % ids)
    check(O.get("fdAt") == "2026-10-20T15:00:00Z", "odds.json carries when FanDuel was pulled")
    ev = next(e for e in O["events"] if e["id"] == "fd35928218")
    check(ev["main"]["ml"]["home"]["books"]["fanduel"]["odds"] == 102 and ev["main"]["spread"]["away"]["books"]["fanduel"]["line"] == -1.5, "moneyline and spread by team")
    check(not any("Quarter" in (p.get("name") or "") for p in ev["props"]) and all(p["stat"] != "pts" for p in ev["props"]), "no quarter markets")
    # second call right away: not due, no new requests, merge still applied
    n0 = len(calls); st2 = fdapi.refresh(cache, oddsp, [card], NOW + datetime.timedelta(minutes=3))
    check(len(calls) == n0 and st2.startswith("kept"), "not pulled again within the gap")
    msg = fanduel.apply([card], O, NOW)
    print(msg)
    P = {p["name"]: p for p in card["players"]}
    def rung(pl, key, t):
        s = next(x for x in P[pl]["stats"] if x["key"] == key)
        return next((mm for mm in s["miles"] if mm["t"] == t and mm.get("fd")), None), s
    m2, s = rung("Jayson Tatum", "fg3", 2.0)
    check(m2 and m2["price"] == -500 and "selectionId=13080925" in m2["link"], "Tatum 2+ threes at FanDuel's -500 with its link")
    check(s["line"] == 2.5 and s["lineSrc"] == "FanDuel", "Tatum threes line is FanDuel's 2.5")
    check(m2 and m2["hit"] == 14 and m2["n"] == 15 and m2["pn"] == 6, "record at 2+: %s/%s last 15, playoffs %s/%s" % (m2 and m2["hit"], m2 and m2["n"], m2 and m2.get("ph"), m2 and m2.get("pn")))
    check(m2 and 0.8 < m2["p"] < 0.97, "chance blends model and record: %s" % (m2 and m2["p"]))
    m8, _ = rung("Jayson Tatum", "reb", 8.0)
    check(m8 and m8["price"] == -210, "Tatum 8+ rebounds (ladder only, no over/under) at -210")
    mr, _ = rung("Duncan Robinson", "fg3", 2.0); check(mr and mr["price"] == -310, "Robinson 2+ threes -310")
    mc, _ = rung("Cade Cunningham", "ast", 6.0); check(mc and mc["price"] == -900 and mc["hit"] == 15, "Cunningham 6+ assists -900, 15/15")
    ma, _ = rung("Ausar Thompson", "reb", 6.0); check(ma and ma["price"] == -150, "Thompson 6+ rebounds -150")
print(f"\n{ok} passed, {fail} failed"); sys.exit(1 if fail else 0)
