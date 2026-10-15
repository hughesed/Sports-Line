#!/usr/bin/env python3
"""Offline test of the soccer path: a SportsGameOdds-shaped event -> odds.normalize -> soccer.cards (fake ESPN scoreboard) -> battle ratings -> settlement box.
usage: python tools/soccer_test.py        (no network; prints PASS / FAIL lines, exit 1 on a failure)
--write also appends the test match to data/slate.json and data/odds.json copies under .cache/soccer_demo/ for a page test."""
import os, sys, json, datetime, copy
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))
import odds as O, soccer as SOC

NOW = datetime.datetime(2026, 10, 17, 9, 0, tzinfo=datetime.timezone.utc)
KICK = "2026-10-17T14:00:00Z"
fails = 0
def check(name, ok, info=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + (("  " + str(info)) if info and not ok else ""))
    if not ok: fails += 1

def bk(odds, line=None, key="overUnder"):
    d = {"odds": odds, "available": True, "deeplink": "https://sportsbook.fanduel.com/addToBetslip?marketId=1&selectionId=2"}
    if line is not None: d[key] = str(line)
    return {"fanduel": d}

def odd(stat, ent, per, bt, side, odds, line=None, pid=None, key="overUnder"):
    return {"statID": stat, "statEntityID": pid or ent, "periodID": per, "betTypeID": bt, "sideID": side, "playerID": pid,
            "fairOdds": None, "byBookmaker": bk(odds, line, key)}

def raw_event():
    od = {}
    def add(o): od[str(len(od))] = o
    add(odd("points", "home", "reg", "ml3way", "home", -150)); add(odd("points", "all", "reg", "ml3way", "draw", 290)); add(odd("points", "away", "reg", "ml3way", "away", 400))
    add(odd("points", "home", "reg", "ml3way", "home+draw", -500)); add(odd("points", "away", "reg", "ml3way", "away+draw", 135))
    add(odd("points", "all", "game", "ou", "over", -130, 2.5)); add(odd("points", "all", "game", "ou", "under", 105, 2.5))
    add(odd("points", "home", "game", "sp", "home", 110, -0.5, key="spread")); add(odd("points", "away", "game", "sp", "away", -135, 0.5, key="spread"))
    add(odd("bothTeamsScored", "all", "game", "yn", "yes", -105)); add(odd("bothTeamsScored", "all", "game", "yn", "no", -120))
    add(odd("points", "home", "game", "ou", "over", -120, 1.5)); add(odd("points", "home", "game", "ou", "under", -105, 1.5))
    for pid, stat, line, o, u in (("BUKAYO_SAKA_1_EPL", "shots_onGoal", 0.5, -190, 145), ("BUKAYO_SAKA_1_EPL", "shots", 2.5, 110, -140),
                                  ("DECLAN_RICE_1_EPL", "passes_attempted", 54.5, -115, -115), ("BUKAYO_SAKA_1_EPL", "points", 0.5, 160, -210),
                                  ("JORDAN_PICKFORD_1_EPL", "goalie_saves", 3.5, -125, -105)):
        add(odd(stat, None, "game", "ou", "over", o, line, pid)); add(odd(stat, None, "game", "ou", "under", u, line, pid))
    return {"eventID": "SGO123", "leagueID": "EPL", "status": {"startsAt": KICK, "live": False, "completed": False},
            "teams": {"home": {"teamID": "ARSENAL_EPL", "names": {"short": "ARS", "long": "Arsenal"}}, "away": {"teamID": "EVERTON_EPL", "names": {"short": "EVE", "long": "Everton"}}},
            "players": {"BUKAYO_SAKA_1_EPL": {"name": "Bukayo Saka", "teamID": "ARSENAL_EPL"}, "DECLAN_RICE_1_EPL": {"name": "Declan Rice", "teamID": "ARSENAL_EPL"},
                        "JORDAN_PICKFORD_1_EPL": {"name": "Jordan Pickford", "teamID": "EVERTON_EPL"}},
            "links": {"bookmakers": {"fanduel": "https://sportsbook.fanduel.com/soccer/x"}}, "odds": od}

def espn_board():
    return {"events": [{"id": "740123", "date": "2026-10-17T14:00Z", "status": {"type": {"state": "pre"}},
                        "competitions": [{"competitors": [
                            {"homeAway": "home", "score": "0", "team": {"id": "359", "abbreviation": "ARS", "displayName": "Arsenal", "shortDisplayName": "Arsenal", "color": "e20520", "alternateColor": "132257", "logo": "https://a.espncdn.com/i/teamlogos/soccer/500/359.png"}, "records": [{"summary": "5-1-1"}]},
                            {"homeAway": "away", "score": "0", "team": {"id": "368", "abbreviation": "EVE", "displayName": "Everton", "shortDisplayName": "Everton", "color": "0d3b8a"}}]}]}]}

def fake_curl(url, **kw):
    if "/eng.1/scoreboard" in url: return espn_board()
    if "/summary?event=740123" in url:
        return {"header": {"competitions": [{"status": {"type": {"state": "post", "completed": True}}, "competitors": [{"homeAway": "home", "score": "2"}, {"homeAway": "away", "score": "1"}]}]},
                "rosters": [{"homeAway": "home", "roster": [{"athlete": {"displayName": "Bukayo Saka"}, "starter": True, "stats": [{"name": "totalGoals", "value": 1}, {"name": "shotsOnTarget", "value": 2}, {"name": "totalShots", "value": 4}]},
                                                            {"athlete": {"displayName": "Declan Rice"}, "starter": True, "stats": [{"name": "totalGoals", "value": 0}]}]},
                            {"homeAway": "away", "roster": [{"athlete": {"displayName": "Jordan Pickford"}, "starter": True, "stats": [{"name": "saves", "value": 5}]},
                                                            {"athlete": {"displayName": "Bench Guy"}, "starter": False, "subbedIn": False, "stats": []}]}]}
    return None

ev = O.normalize(raw_event())
check("3-way market parsed", set(ev.get("m3", {})) == {"home", "draw", "away", "home+draw", "away+draw"}, ev.get("m3", {}).keys())
check("both teams to score parsed", set(ev.get("btts", {})) == {"yes", "no"})
check("team total parsed", "home" in ev.get("tt", {}))
check("soccer props mapped", sorted({p["stat"] for p in ev["props"]}) == ["gls", "passes", "saves", "shots", "sog"], sorted({p["stat"] for p in ev["props"]}))
cs = SOC.cards({"events": [ev]}, NOW, curl=fake_curl)
check("one card, keyed by the ESPN event", len(cs) == 1 and cs[0]["id"] == "740123", [c["id"] for c in cs])
c = cs[0]
L = c["lines"]; cr = c["crossroads"]
check("3-way prices on the card", L["mlHome"] == -150 and L["mlDraw"] == 290 and L["mlAway"] == 400 and L["dcHome"] == -500)
check("expected goals fitted (home favourite, total near 2.5-3)", cr["soc"]["lh"] > cr["soc"]["la"] and 2.3 < cr["projTotal"] < 3.3, cr["soc"])
r = SOC.probs(cr["soc"]["lh"], cr["soc"]["la"], 2.5)
check("fit reproduces the book's home chance within 3 pts", abs(r["h"] - cr["pHome"]) < 0.03, (r, cr["pHome"]))
check("players built from props with name ids", {p["id"] for p in c["players"]} == {"nbukayosaka", "ndeclanrice", "njordanpickford"}, [p["id"] for p in c["players"]])
check("player cards are complete (side, status, stats)", all(p.get("side") in ("home", "away") and (p.get("status") or {}).get("kind") == "ok" and p.get("stats") for p in c["players"]), [sorted(p) for p in c["players"]][:1])
check("keeper tagged", any(p["pos"] == "GK" for p in c["players"]))
check("logo + esl carried", c["teams"]["home"]["logo"].endswith("359.png") and c["esl"] == "eng.1")
sim = SOC.sim_sport(cs)
t = {x["abbr"]: x for x in sim["teams"]}
eh = sim["L"] + sim["hfa"] / 2 + t["ARS"]["o"] + t["EVE"]["d"]; ea = sim["L"] - sim["hfa"] / 2 + t["EVE"]["o"] + t["ARS"]["d"]
check("battle ratings reproduce the fixture's expected goals", abs(eh - cr["soc"]["lh"]) < 0.01 and abs(ea - cr["soc"]["la"]) < 0.01, (eh, ea, cr["soc"]))
fin = SOC.final_of({"gid": "740123", "esl": "eng.1"}, fake_curl)
check("final box: score and player stats by name", fin and fin[0] == 2 and fin[1] == 1 and fin[2]["nbukayosaka"]["sog"] == 2 and fin[2]["njordanpickford"]["saves"] == 5, fin)
check("unused sub marked did-not-play", fin and "nbenchguy" in fin[3])
import social
fd = social.final_doc("740123", *fin)
check("final doc for the database", fd["played"]["nbukayosaka"] is True and fd["stat"]["nbukayosaka"]["gls"] == 1)

if "--write" in sys.argv:
    out = os.path.join(ROOT, ".cache", "soccer_demo"); os.makedirs(out, exist_ok=True)
    json.dump(c, open(os.path.join(out, "card.json"), "w")); json.dump(ev, open(os.path.join(out, "event.json"), "w"))
    print("wrote", out)
print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
