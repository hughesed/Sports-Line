#!/usr/bin/env python3
"""Offline test of engine/firstbasket.py: prediction (model, book, both), the one-snapshot-per-game log, grading from a play-by-play, the summary.
usage: python tools/firstbasket_test.py"""
import os, sys, json, tempfile, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))
import firstbasket as FB
res = []
def check(name, cond, extra=""):
    res.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + ((" - " + str(extra)[:200]) if extra else ""))

def pl(i, name, side, pts, avail=1.0, out=False):
    return dict(id=i, name=name, side=side, avail=avail, status=dict(kind="out" if out else "ok"), stats=[dict(key="pts", avg=pts, proj=pts)])
def game(gid="G1", iso="2026-10-20T00:00:00Z"):
    return dict(id=gid, key="wnba", iso=iso, teams=dict(home=dict(abbr="GS", ht=dict(avg=71, big=75)), away=dict(abbr="ATL", ht=dict(avg=72, big=77))),
                crossroads=dict(pHome=0.55), players=[pl("1", "Gabby Williams", "home", 18), pl("2", "Veronica Burton", "home", 10), pl("3", "Kiah Stokes", "home", 4.5), pl("8", "Tiffany Hayes", "home", 9.5), pl("9", "Kaila Charles", "home", 5.5),
                pl("4", "Angel Reese", "away", 14), pl("5", "Rhyne Howard", "away", 15.5), pl("6", "Jordin Canada", "away", 10.5), pl("10", "Allisha Gray", "away", 15.5), pl("11", "Naz Hillmon", "away", 6.5), pl("7", "Hurt Player", "away", 20, out=True)])
def feed(names_odds):
    return dict(first=[dict(stat="firstBasket", pid=n.upper(), name=n, team=t, side="yes", books=dict(fanduel=dict(odds=o))) for n, t, o in names_odds])

g = game(); pr = FB.predict(g, None)
rows = pr["rows"]; s = sum(r["p"] for r in rows)
check("model: ten players listed (the injured one is left out), sorted by chance", len(rows) == 10 and all(rows[i]["p"] >= rows[i + 1]["p"] for i in range(9)) and "Hurt" not in " ".join(r["name"] for r in rows), [r["name"] for r in rows])
check("model: chances add to at most 100% and the best player is a plausible 10-20%", s <= 0.97 + 1e-6 and 0.10 <= rows[0]["p"] <= 0.20, (round(s, 3), rows[0]))
check("model: the better scorer on a team has the higher chance", next(r["p"] for r in rows if r["name"] == "Gabby Williams") > next(r["p"] for r in rows if r["name"] == "Kiah Stokes"))
check("model: source says model", pr["src"] == "model")
home_p = sum(r["p"] for r in rows if r["side"] == "home"); check("model: the favourite is a bit likelier to score first, the taller away centre wins a bit of tip-off", 0.45 < home_p / s < 0.56, round(home_p / s, 3))

pb = FB.predict(g, feed([("Gabby Williams", "home", 600), ("Angel Reese", "away", 750), ("Rhyne Howard", "away", 800), ("Veronica Burton", "home", 1100), ("Random Bench", "home", 2500)]))
check("book + model: source says both and the bench player from the feed is added", pb["src"] == "both" and any(r["name"] == "Random Bench" and r["id"].startswith("n") for r in pb["rows"]), pb["src"])
check("book + model: FanDuel's price is carried on the row", next(r for r in pb["rows"] if r["name"] == "Gabby Williams")["fd"] == 600)
po = FB.predict(dict(game(), players=[]), feed([("Gabby Williams", "home", 600), ("Angel Reese", "away", 750)]))
check("book only: works with no player cards, chances without the margin", po and po["src"] == "book" and abs(sum(r["p"] for r in po["rows"]) - 0.97) < 0.01, po and po["rows"][:2])
check("nothing to go on gives None", FB.predict(dict(game(), players=[]), None) is None)

# play-by-play
def play(i, sv, team, who, name, txt, scoring=True, period=1):
    return dict(id=i, scoringPlay=scoring, scoreValue=sv, team=dict(id=team), period=dict(number=period), clock=dict(displayValue="9:40"), text=txt,
                participants=[dict(athlete=dict(id=who, displayName=name), type="scorer")] if who else [])
summ = dict(header=dict(competitions=[dict(competitors=[dict(team=dict(id="10"), homeAway="home"), dict(team=dict(id="20"), homeAway="away")])]),
            plays=[play("p1", 0, "10", None, None, "Jump ball", scoring=False), play("p2", 1, "20", "4", "Angel Reese", "Angel Reese makes free throw 1 of 2"),
                   play("p3", 3, "10", "1", "Gabby Williams", "Gabby Williams makes 25-foot three point jumper"), play("p4", 2, "20", "5", "Rhyne Howard", "Rhyne Howard makes layup")])
fbk = FB.first_baskets(summ)
check("play-by-play: first basket is the first made field goal (the free throw is not a basket)", fbk and fbk["fg"]["n"] == "Gabby Williams" and fbk["fg"]["tm"] == "home" and fbk["fg"]["sv"] == 3, fbk and fbk["fg"])
check("play-by-play: the free throw is kept as the first score, and each team's first field goal", fbk["any"]["n"] == "Angel Reese" and fbk["tf"]["away"]["n"] == "Rhyne Howard", (fbk["any"]["n"], fbk["tf"]))
check("play-by-play: name parsed from the text when the play has no participants", FB.first_baskets(dict(summ, plays=[play("x", 2, "10", None, None, "Kiah Stokes makes 4-foot layup")]))["fg"]["n"] == "Kiah Stokes")
check("play-by-play: no scoring plays gives None", FB.first_baskets(dict(summ, plays=[play("x", 0, "10", None, None, "Jump ball", scoring=False)])) is None)

# log + settle + summary with a temp store and a stubbed ESPN call
d = tempfile.mkdtemp(); os.makedirs(d + "/store")
now = datetime.datetime(2026, 10, 19, 21, 0, tzinfo=datetime.timezone.utc)
b = FB.FirstBasket(d); gs = [game("G1"), game("G2", "2026-10-20T01:00:00Z")]
n = b.log_games(gs, {"events": []}, now)
check("log: one snapshot per game, and the card carries g['fb']", n == 2 and gs[0]["fb"]["rows"] and gs[0]["fb"]["locked"] is False)
gs2 = [game("G1"), game("G2", "2026-10-20T01:00:00Z")]; gs2[0]["players"][0]["stats"][0]["proj"] = 30
check("log: the first snapshot is kept (a later run adds nothing)", b.log_games(gs2, {"events": []}, now) == 0 and b.recs["G1"]["rows"][0][1] == "Gabby Williams")
later = now + datetime.timedelta(hours=4); gs3 = [game("G1")]
b.log_games(gs3, {"events": []}, later)
check("log: after tip-off the card shows the locked snapshot", gs3[0]["fb"]["locked"] is True)
class St: games = {"wnba": {"G1": {"id": "G1"}}, "nba": {}}
FB.curl = lambda url, *a, **k: summ if "event=G1" in url else None
FB.pmap = lambda fn, items, w=8: [fn(x) for x in items]
check("settle: a final game is graded from the play-by-play", b.settle(St, later) == 1 and b.recs["G1"]["res"]["fg"]["n"] == "Gabby Williams")
r = b.recs["G1"]
check("settle: rank, chance given and top-pick flags are written", r["rank"] in (1, 2, 3) and r["pw"] > 0 and r["top1"] in (0, 1) and r["top3"] == 1, {k: r.get(k) for k in ("rank", "pw", "top1", "top3", "tipHit")})
check("settle: a game that is not final is left alone", "res" not in b.recs["G2"])
sm = b.summary(later)
check("summary: counts and expected top-pick hits", sm["leagues"]["wnba"]["n"] == 1 and sm["leagues"]["wnba"]["pending"] == 1 and sm["leagues"]["wnba"]["exp1"] > 0 and sm["recent"][0]["who"] == "Gabby Williams", sm["leagues"]["wnba"])
b.save(datetime.date(2026, 10, 19)); b2 = FB.FirstBasket(d)
check("save/load round trip keeps the results", b2.recs["G1"]["res"]["fg"]["n"] == "Gabby Williams" and len(b2.recs) == 2)
print("\n%d checks, %d failed" % (len(res), res.count(False))); sys.exit(1 if False in res else 0)
