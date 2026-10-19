"""Offline check of engine/odds.py against a payload shaped like the real SportsGameOdds response. python3 tools/odds_test.py"""
import sys, os, json, tempfile, datetime
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "engine"))
import odds
def bk(o, line=None, avail=True, link=None):
    d = {"odds": o, "available": avail}; 
    if line is not None: d["spread" if False else "line"] = line
    return d
ev = {"eventID": "E1", "leagueID": "NBA", "teams": {"home": {"teamID": "DET", "names": {"short": "DET", "long": "Detroit Pistons"}}, "away": {"teamID": "BOS", "names": {"short": "BOS", "long": "Boston Celtics"}}},
      "status": {"startsAt": "2026-10-20T19:00:00.000Z", "live": False, "completed": False}, "links": {"bookmakers": {"fanduel": "https://fd/x"}},
      "players": {"JT": {"name": "Jayson Tatum", "teamID": "BOS"}},
      "odds": {
        "points-away-game-ml-away": {"betTypeID": "ml", "sideID": "away", "statEntityID": "away", "periodID": "game", "statID": "points", "fairOdds": "+113",
            "byBookmaker": {"fanduel": {"odds": "+100", "available": True, "deeplink": "https://fd/add?m=1"}, "caesars": {"odds": "+105", "available": False}}},
        "points-home-game-sp-home": {"betTypeID": "sp", "sideID": "home", "statEntityID": "home", "periodID": "game", "statID": "points", "fairOdds": "+100", "fairSpread": "-1.5",
            "byBookmaker": {"draftkings": {"odds": "-115", "spread": "-1.5", "available": True}, "pointsbet": {"odds": "-111", "spread": "-2.5", "available": True}}},
        "points-all-game-ou-over": {"betTypeID": "ou", "sideID": "over", "statEntityID": "all", "periodID": "game", "statID": "points", "fairOdds": "-101", "fairOverUnder": "221.5",
            "byBookmaker": {"fanduel": {"odds": "-115", "overUnder": "221.5", "available": True, "deeplink": "https://fd/add?m=2"}}},
        "points-JT-game-ou-over": {"betTypeID": "ou", "sideID": "over", "statEntityID": "JT", "playerID": "JT", "periodID": "game", "statID": "points", "fairOdds": "-101", "fairOverUnder": "26.5",
            "byBookmaker": {"fanduel": {"odds": "-114", "overUnder": "26.5", "available": True, "deeplink": "https://fd/add?m=3"}}},
        "points+rebounds+assists-JT-game-ou-under": {"betTypeID": "ou", "sideID": "under", "playerID": "JT", "periodID": "game", "statID": "points+rebounds+assists", "fairOdds": "+100",
            "byBookmaker": {"fanduel": {"odds": "-125", "overUnder": "42.5", "available": True}}},
        "points-away-reg-ml3way-away": {"betTypeID": "ml3way", "sideID": "away", "statEntityID": "away", "periodID": "reg", "statID": "points", "byBookmaker": {}},
      }}
real_pull = odds.pull
g = odds.normalize(ev); ok = True
def chk(name, cond):
    global ok; ok &= bool(cond); print(("PASS " if cond else "FAIL ") + name)
chk("home/away + start", g["home"] == "DET" and g["away"] == "BOS" and g["start"].startswith("2026-10-20"))
chk("stale book (available=false) dropped", "caesars" not in g["main"]["ml"]["away"]["books"])
chk("deeplink kept", g["main"]["ml"]["away"]["books"]["fanduel"]["link"] == "https://fd/add?m=1")
chk("each book keeps its own spread", g["main"]["spread"]["home"]["books"]["pointsbet"]["line"] == -2.5 and g["main"]["spread"]["home"]["books"]["draftkings"]["line"] == -1.5)
chk("fair (no-vig) line kept", g["main"]["spread"]["home"]["fair"]["line"] == -1.5 and g["main"]["ml"]["away"]["fair"]["odds"] == 113)
chk("total over line", g["main"]["total"]["over"]["books"]["fanduel"]["line"] == 221.5)
chk("player props mapped (pts, pra)", {p["stat"] for p in g["props"]} == {"pts", "pra"} and all(p["team"] == "away" for p in g["props"]))
chk("3-way/regulation market ignored", len(g["main"]) == 3)
d = tempfile.mkdtemp(); path = d + "/odds.json"; os.environ.pop("ODDS_API_KEY", None)
chk("no key -> skipped, no file", odds.refresh(path).startswith("no ODDS_API_KEY") and not os.path.exists(path))
os.environ["ODDS_API_KEY"] = "test"; odds.pull = lambda key, n, now=None, log=print, **kw: ([ev], "Response is missing 270 bookmaker odds.")
s1 = odds.refresh(path); chk("first pull writes file: " + s1, s1.startswith("ok: 1") and json.load(open(path))["events"][0]["home"] == "DET")
s2 = odds.refresh(path); chk("second pull inside the gap is skipped: " + s2, s2.startswith("kept"))
os.environ["ODDS_MIN_GAP_MIN"] = "0"
def boom(*a, **k): raise RuntimeError("Invalid API key")
odds.pull = boom; before = open(path).read(); s3 = odds.refresh(path, log=lambda *a: None)
chk("failure keeps the old file's events: " + s3, s3.startswith("error") and json.load(open(path))["events"] == json.loads(before)["events"])
g3 = json.load(open(path)).get("guard") or {}
chk("failure notes a back-off in the file (1 fail, next try later)", g3.get("fails") == 1 and g3.get("blockedUntil"))
odds.pull = lambda *a, **k: (_ for _ in ()).throw(AssertionError("asked the API while backing off"))
s3b = odds.refresh(path, log=lambda *a: None); chk("while backing off nothing is asked: " + s3b, s3b.startswith("kept (odds feed backing off"))
odds.FAR_GAP_MIN = 0          # the older checks below expect a pull whenever ODDS_MIN_GAP_MIN says so

# ---- v2: per-event asOf, coverage re-pull, early exit, live pull ----
import copy
chk("pregame events carry asOf", json.load(open(path))["events"][0].get("asOf"))
NOW = datetime.datetime(2026, 10, 10, 17, 0, 0)
def card(i, away, home, iso, key="cfb", **t):
    return {"id": i, "key": key, "lg": key, "iso": iso, "teams": {"away": {"abbr": away, "name": away + " Team", "short": away}, "home": {"abbr": home, "name": home + " Team", "short": home}}}
def evt(i, away, home, start, **k):
    e = {"id": i, "league": "NCAAF", "start": start, "live": False, "final": False, "home": home, "away": away, "homeName": home + " Team", "awayName": away + " Team", "eventLinks": {}, "main": {"ml": {"home": {"books": {"fanduel": {"odds": -150, "line": None, "link": "x"}}}}}, "props": [], "asOf": "2026-10-10T16:00:00Z"}
    e.update(k); return e
def write(d, **kw):
    out = {"generatedAt": "2026-10-10T16:50:00Z", "events": [], "source": "sportsgameodds"}; out.update(kw); json.dump(out, open(path, "w"))
os.environ["ODDS_MIN_GAP_MIN"] = "60"; os.environ["ODDS_COVER_GAP_MIN"] = "20"
pulls = []
def stub(key, n, now=None, log=print, games=None, skip=None):
    pulls.append((games, skip)); return ([ev], None)
odds.pull = stub
games = [card("g1", "AAA", "BBB", "2026-10-10T23:00:00Z")]
write(d, events=[evt("e1", "AAA", "BBB", "2026-10-10T23:00:00.000Z")])
s = odds.refresh(path, log=lambda *a: None, now=NOW, games=games); chk("covered + inside the gap -> kept: " + s, s.startswith("kept") and not pulls)
games2 = games + [card("g2", "CCC", "DDD", "2026-10-10T23:30:00Z")]
write(d, events=[evt("e1", "AAA", "BBB", "2026-10-10T23:00:00.000Z")], generatedAt="2026-10-10T16:55:00Z")
s = odds.refresh(path, log=lambda *a: None, now=NOW, games=games2); chk("uncovered but pulled 5 min ago -> kept (cover gap): " + s, s.startswith("kept") and not pulls)
write(d, events=[evt("e1", "AAA", "BBB", "2026-10-10T23:00:00.000Z")], generatedAt="2026-10-10T16:30:00Z")
s = odds.refresh(path, log=lambda *a: None, now=NOW, games=games2); chk("uncovered game, 30 min old -> pulls early: " + s, s.startswith("ok") and "early" in s and len(pulls) == 1)
saved = json.load(open(path)); chk("the game the feed lacks is remembered as unmatched", "g2" in saved.get("unmatched", {}))
pulls.clear(); write(d, events=[evt("e1", "AAA", "BBB", "2026-10-10T23:00:00.000Z")], generatedAt="2026-10-10T16:30:00Z", unmatched={"g2": "2026-10-10T16:30:00Z"})
s = odds.refresh(path, log=lambda *a: None, now=NOW, games=games2); chk("a game already given up on does not pull again: " + s, s.startswith("kept") and not pulls)
# in-play events survive a pregame pull that no longer lists them
live_ev = evt("e9", "LLL", "MMM", "2026-10-10T15:30:00.000Z", live=True, asOf="2026-10-10T16:58:00Z")
write(d, events=[live_ev], generatedAt="2026-10-10T14:00:00Z", liveAt="2026-10-10T16:58:00Z")
odds.pull = lambda key, n, now=None, log=print, **kw: ([ev], None)
s = odds.refresh(path, log=lambda *a: None, now=NOW, games=[]); kept = json.load(open(path))
chk("a game in play stays in the file after a pregame pull: " + s, any(e["id"] == "e9" for e in kept["events"]) and kept.get("liveAt") == "2026-10-10T16:58:00Z")
write(d, events=[evt("old", "OOO", "PPP", "2026-10-10T08:00:00.000Z")], generatedAt="2026-10-10T14:00:00Z")
odds.refresh(path, log=lambda *a: None, now=NOW, games=[]); chk("an event that started 9 h ago is dropped", not any(e["id"] == "old" for e in json.load(open(path))["events"]))
# early exit: paging stops as soon as the slate is covered
calls = []
def fake_get(key, q, pause=0.6):
    calls.append(q.get("cursor"))
    page = len(calls); evs = [{"eventID": "x%d%d" % (page, i), "leagueID": "NCAAF", "teams": {"home": {"teamID": "H%d%d" % (page, i), "names": {"short": "H%d" % i, "long": "Home%d%d" % (page, i)}}, "away": {"teamID": "A%d%d" % (page, i), "names": {"short": "A%d" % i, "long": "Away%d%d" % (page, i)}}}, "status": {"startsAt": "2026-10-10T20:00:00.000Z"}, "odds": {}} for i in range(3)]
    return {"success": True, "data": evs, "nextCursor": "c%d" % page}
orig_get = odds._get; odds._get = fake_get; stub_pull_saved = odds.pull; odds.pull = real_pull
want = [card("w1", "Away11", "Home11", "2026-10-10T20:00:00Z")]
want[0]["teams"]["away"]["name"] = "Away11"; want[0]["teams"]["home"]["name"] = "Home11"
os.environ["ODDS_LEAGUES"] = "NCAAF"; odds.LEAGUES = "NCAAF"
evs, n = odds.pull("k", 15, NOW, lambda *a: None, games=want); chk("early exit after the first page that covers the slate (%d request)" % len(calls), len(calls) == 1)
calls.clear(); evs, n = odds.pull("k", 15, NOW, lambda *a: None, games=None); chk("no slate -> pages up to the cap (%d requests)" % len(calls), len(calls) >= 2)
odds._get = orig_get; odds.pull = stub_pull_saved
# live pull
import types
odds.pull = lambda *a, **k: ([ev], None)
live_game = card("espn1", "LLL", "MMM", "2026-10-10T15:30:00Z", key="cfb")
write(d, events=[evt("e9", "LLL", "MMM", "2026-10-10T15:30:00.000Z", live=True, asOf="2026-10-10T15:00:00Z", main={"ml": {"home": {"books": {"fanduel": {"odds": -300, "line": None, "link": "old"}}}}})], generatedAt="2026-10-10T16:50:00Z")
fresh_ev = {"eventID": "e9", "leagueID": "NCAAF", "teams": {"home": {"teamID": "M", "names": {"short": "MMM", "long": "MMM Team"}}, "away": {"teamID": "L", "names": {"short": "LLL", "long": "LLL Team"}}},
            "status": {"startsAt": "2026-10-10T15:30:00.000Z", "live": True, "completed": False},
            "odds": {"points-home-game-ml-home": {"betTypeID": "ml", "sideID": "home", "statEntityID": "home", "periodID": "game", "statID": "points", "byBookmaker": {"fanduel": {"odds": "-1200", "available": True, "lastUpdatedAt": "2026-10-10T16:59:40Z", "deeplink": "https://fd/live"}}}}}
odds.pull_live_league = lambda key, lg, now: [fresh_ev]
chk("no key -> live pull skipped", (os.environ.pop("ODDS_API_KEY"), odds.refresh_live(path, [live_game], NOW).startswith("no ODDS_API_KEY"))[1]); os.environ["ODDS_API_KEY"] = "test"
chk("no game in play -> nothing pulled", odds.refresh_live(path, [card("z", "A", "B", "2026-10-10T23:00:00Z")], NOW) == "no games in play")
s = odds.refresh_live(path, [live_game], NOW, log=lambda *a: None); e9 = [e for e in json.load(open(path))["events"] if e["id"] == "e9"][0]
chk("live pull replaces the event's lines with the current ones: " + s, s.startswith("ok") and e9["main"]["ml"]["home"]["books"]["fanduel"]["odds"] == -1200 and e9["live"] is True)
chk("live prices carry FanDuel's own update time", e9["main"]["ml"]["home"]["books"]["fanduel"].get("t") == "2026-10-10T16:59:40Z")
chk("live event is stamped asOf the pull and the file records liveAt", e9["asOf"] == "2026-10-10T17:00:00Z" and json.load(open(path))["liveAt"] == "2026-10-10T17:00:00Z")
s = odds.refresh_live(path, [live_game], NOW + datetime.timedelta(minutes=2)); chk("second live pull inside the gap is skipped: " + s, s.startswith("kept"))
odds.pull_live_league = lambda key, lg, now: (_ for _ in ()).throw(RuntimeError("boom"))
before = open(path).read(); s = odds.refresh_live(path, [live_game], NOW + datetime.timedelta(minutes=10), log=lambda *a: None)
chk("live pull failure keeps the old file's events: " + s, s.startswith("error") and json.load(open(path))["events"] == json.loads(before)["events"])
# ---- v3: 429 stops the pull, back-off steps, daily budget, slate-only leagues ----
d3 = tempfile.mkdtemp(); p3 = path = d3 + "/odds.json"; os.environ["ODDS_MIN_GAP_MIN"] = "0"
write(d3, events=[], generatedAt="2026-10-10T14:00:00Z")
asked = []
def fake429(key, q, pause=0.6):
    asked.append(q["leagueID"]); raise odds.RateLimited("HTTP 429")
orig = odds._get; odds._get = fake429; odds.pull = real_pull; odds.LEAGUES = "NFL,NCAAF,NBA,MLB"
s = odds.refresh(p3, log=lambda *a: None, now=NOW); gg = json.load(open(p3))["guard"]
chk("a 429 stops after the first league (asked %s): %s" % (asked, s), asked == ["NFL"] and s.startswith("error: RateLimited"))
chk("back-off is 30 min after the first failure, 60 after the second", gg["fails"] == 1 and gg["blockedUntil"] == "2026-10-10T17:30:00Z" if NOW.strftime("%H:%M") == "17:00" else gg["fails"] == 1)
g2 = odds._fail(json.load(open(p3)), odds._utc(NOW) + datetime.timedelta(minutes=31), "x"); chk("second failure doubles the wait", g2["fails"] == 2 and (odds._parse(g2["blockedUntil"]) - (odds._utc(NOW) + datetime.timedelta(minutes=31))).total_seconds() == 3600)
g, allow = odds._guard_state({"month": "2026-10", "monthEvents": 2000, "day": "2026-10-10", "dayEvents": 40}, odds._utc(NOW))
chk("daily allowance = what is left of the month / days left (%.0f)" % allow, 10 < allow < 12)
odds._get = orig
print("ALL PASS" if ok else "SOME FAILED"); sys.exit(0 if ok else 1)
