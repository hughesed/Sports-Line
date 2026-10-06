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
os.environ["ODDS_API_KEY"] = "test"; odds.pull = lambda key, n, now=None: ([ev], "Response is missing 270 bookmaker odds.")
s1 = odds.refresh(path); chk("first pull writes file: " + s1, s1.startswith("ok: 1") and json.load(open(path))["events"][0]["home"] == "DET")
s2 = odds.refresh(path); chk("second pull inside the gap is skipped: " + s2, s2.startswith("kept"))
os.environ["ODDS_MIN_GAP_MIN"] = "0"
def boom(*a, **k): raise RuntimeError("Invalid API key")
odds.pull = boom; before = open(path).read(); s3 = odds.refresh(path, log=lambda *a: None)
chk("failure keeps the old file: " + s3, s3.startswith("error") and open(path).read() == before)
print("ALL PASS" if ok else "SOME FAILED"); sys.exit(0 if ok else 1)
