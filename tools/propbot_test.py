#!/usr/bin/env python3
"""Offline test of engine/propbot.py (no network): research from game logs (rest days, teammate out, injury report, news, trade), the FanDuel legs it
writes down, grading from an ESPN-shaped box score, learning (calibration, pattern weights, player bias), the page file and the saved store.
usage: python tools/propbot_test.py"""
import os, sys, json, math, random, tempfile, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))
import espn, propbot as PB, fanduel as FD
res = []
def check(name, cond, extra=""):
    res.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + ((" - " + str(extra)[:240]) if extra else ""))

UTC = datetime.timezone.utc
NOW = datetime.datetime(2026, 11, 24, 15, 0, tzinfo=UTC)
TIP = "2026-11-25T00:30:00Z"                     # Mon Nov 24, 7:30 PM ET

# ---------------------------------------------------------------- synthetic game logs (ESPN gamelog shape after espn._parse_gl)
def glgame(eid, date, mins, pts, reb=6, ast=4, home=True, season="2026-27"):
    return dict(eventId=eid, date=date, opp="XXX", home=home, result="W", score="100-90", post=False, pre=False, season=season,
                stats={"minutes": mins, "points": pts, "totalRebounds": reb, "assists": ast, "threePointFieldGoalsMade-threePointFieldGoalsAttempted_made": 2})
day0 = datetime.date(2026, 10, 21)
A_games, T_games = [], []
d = day0; eid = 1000; t_out = set()
for k in range(26):
    b2b = k % 4 == 3                              # every 4th game is the second night of a back-to-back
    d = d + datetime.timedelta(days=1 if b2b else 2)
    out = k in (5, 6, 7, 14, 15, 16)               # the teammate missed 6 games
    mins = 28.0 if b2b else 34.0
    pts = (31 if out else 23) * mins / 34.0
    iso = d.isoformat() + "T23:30Z"
    A_games.append(glgame(str(eid), iso, mins, round(pts), home=(k % 2 == 0)))
    if not out: T_games.append(glgame(str(eid), iso, 33.0, 20))
    eid += 1
last_date = d
LOGS = {("nba", "1"): A_games, ("nba", "9"): T_games}
espn.gamelog_multi = lambda lg, pid: (["x"], LOGS.get((lg, str(pid)), []))
espn.gamelog = lambda lg, pid: (["x"], LOGS.get((lg, str(pid)), []))
espn._gl_raw = lambda lg, pid, season=None: None
PB.pmap = lambda fn, items, workers=8: [fn(x) for x in items]

def stat(key, proj, line, sd=6.0, rungs=()):
    return dict(key=key, label={"pts": "Points", "reb": "Rebounds"}.get(key, key), proj=proj, line=line, lineSrc="FanDuel", overPrice=-115, underPrice=-105, sd=sd,
                vals=[20, 22, 25, 24, 30, 21, 26, 23, 27, 25], v15=[20, 22, 25, 24, 30, 21, 26, 23, 27, 25, 22, 24, 26, 28, 23], miles=[], post=[])
def card(rest_days=0, injuries=None, status=None, gid="G1"):
    pa = dict(id="1", name="Alpha Guard", side="home", abbr="HOM", pos="G", status=status or dict(label="Active", kind="ok", note=""), avail=1.0, flags=[],
              boostNotes=["Theta Big out: +5%"], stats=[stat("pts", 24.0, 23.5), stat("reb", 6.0, 5.5, sd=2.5)])
    return dict(id=gid, key="nba", lg="nba", iso=TIP, lines=dict(sprHome=-3.5),
                teams=dict(home=dict(abbr="HOM", injuries=injuries if injuries is not None else [dict(id="9", name="Theta Big", pos="C", kind="out", weight=1.0, label="Out")]), away=dict(abbr="AWY", injuries=[])),
                crossroads=dict(ctx=dict(home=dict(rest=dict(days=rest_days)), away=dict(rest=dict(days=1)))), players=[pa])
def fd_on(g):
    """what fanduel.apply does to the stat: FanDuel's X+ rungs at its prices, the model's chance on each (from the bot-adjusted projection)"""
    for pl in g["players"]:
        for st in pl["stats"]:
            if st["key"] == "pts": FD._put_rungs(st, [dict(t=20.0, odds=-250, link=None), dict(t=25.0, odds=120, link=None), dict(t=15.0, odds=-900, link=None)], FD._model_pf(st))

tmp = tempfile.mkdtemp(); os.makedirs(os.path.join(tmp, "store"))
bot = PB.PropBot(root=tmp, log=lambda *a: None)

# ---------------------------------------------------------------- research
g = card(rest_days=0)
bot.research([g], NOW, cx_fetch=lambda lg: dict(news=[], trans=[]))
pl = g["players"][0]; sp = next(s for s in pl["stats"] if s["key"] == "pts")
check("research: the projection before the bot is kept (p0) and the factor is recorded", sp["bot"]["p0"] == 24.0 and "f" in sp["bot"], sp["bot"])
lr = sp["bot"]["l"]
check("research: back-to-back tonight lowers playing time (rest factor < 1)", lr.get("rest", 0) < -0.03, lr)
check("research: teammate out tonight raises points (with/without split, flat build boost taken out)", lr.get("mates", 0) > 0.03, lr)
check("research: notes explain both patterns in words", any("back-to-back" in n for n in pl["bot"]["notes"]) and any("Without Theta Big" in n for n in pl["bot"]["notes"]), pl["bot"]["notes"])
g2 = card(rest_days=2); bot.research([g2], NOW, cx_fetch=lambda lg: dict(news=[], trans=[]))
f_b2b = sp["bot"]["f"]; f_rest = next(s for s in g2["players"][0]["stats"] if s["key"] == "pts")["bot"]["f"]
check("research: the same player rested gets a higher factor than on a back-to-back", f_rest > f_b2b, (f_b2b, f_rest))
LOGS[("nba", "8")] = [dict(x) for x in T_games]          # a second teammate who missed the very same games
gm = card(rest_days=0, injuries=[dict(id="9", name="Theta Big", pos="C", kind="out", weight=1.0, label="Out"), dict(id="8", name="Iota Wing", pos="F", kind="out", weight=1.0, label="Out")])
bot.research([gm], NOW, cx_fetch=lambda lg: dict(news=[], trans=[]))
l2 = next(s for s in gm["players"][0]["stats"] if s["key"] == "pts")["bot"]["l"]
check("research: two teammates out in the same games are one split, not counted twice", abs(l2.get("mates", 0) - lr.get("mates", 0)) < 0.03 and any("Theta Big and Iota Wing" in n for n in gm["players"][0]["bot"]["notes"]), (l2, lr))
g3 = card(rest_days=2, injuries=[]); bot.research([g3], NOW, cx_fetch=lambda lg: dict(news=[], trans=[]))
check("research: no teammate out -> no mates factor", "mates" not in next(s for s in g3["players"][0]["stats"] if s["key"] == "pts")["bot"]["l"])
check("research: total factor stays inside its bounds", all(PB.F_LO <= s["bot"]["f"] <= PB.F_HI for x in (g, g2, g3) for s in x["players"][0]["stats"]))
# running again on a carried card does not compound
p_once = sp["proj"]; bot.research([g], NOW, cx_fetch=lambda lg: dict(news=[], trans=[]))
check("research: a card carried to the next run starts again from p0 (no compounding)", abs(next(s for s in g["players"][0]["stats"] if s["key"] == "pts")["proj"] - p_once) < 1e-9, (p_once,))
# injury report, news, trade
gq = card(status=dict(label="Questionable", kind="questionable", note="Alpha (ankle) is questionable")); bot.research([gq], NOW, cx_fetch=lambda lg: dict(news=[], trans=[]))
check("flags: questionable on the injury report keeps him out of the picks", "Questionable" in (gq["players"][0]["bot"]["avoid"] or ""), gq["players"][0]["bot"])
news = [dict(h="Alpha Guard on minutes restriction Monday", d="", t="2026-11-24", ath=[dict(id="1", name="Alpha Guard")])]
gn = card(); bot.research([gn], NOW, cx_fetch=lambda lg: dict(news=news, trans=[]))
check("flags: minutes restriction in ESPN news (today) keeps him out", (gn["players"][0]["bot"]["avoid"] or "").startswith("ESPN news"), gn["players"][0]["bot"])
old_news = [dict(h="Alpha Guard on minutes restriction", d="", t="2026-11-18", ath=[dict(id="1", name="Alpha Guard")])]
go = card(); bot.research([go], NOW, cx_fetch=lambda lg: dict(news=old_news, trans=[]))
check("flags: week-old news does not", go["players"][0]["bot"]["avoid"] is None)
trans = [dict(date=(last_date - datetime.timedelta(days=1)).isoformat(), desc="Acquired G Alpha Guard from Somewhere in exchange for a pick")]
gt = card(); bot.research([gt], NOW, cx_fetch=lambda lg: dict(news=[], trans=trans))
check("new-team rule: joined by trade (league transactions) -> unders only, not left out", "unders only" in (gt["players"][0]["bot"]["under"] or "") and gt["players"][0]["bot"]["avoid"] is None, gt["players"][0]["bot"])
done = [dict(h="Hornets acquire Alpha Guard from Suns", d="", t="2026-11-23", ath=[dict(id="1", name="Alpha Guard")])]
gd = card(); bot.research([gd], NOW, cx_fetch=lambda lg: dict(news=done, trans=[]))
check("new-team rule: a completed trade in ESPN news -> unders only", "Traded (ESPN news" in (gd["players"][0]["bot"]["under"] or ""), gd["players"][0]["bot"])
rumor = [dict(h="Hornets exploring trade interest in Alpha Guard", d="", t="2026-11-23", ath=[dict(id="1", name="Alpha Guard")])]
gr_ = card(); bot.research([gr_], NOW, cx_fetch=lambda lg: dict(news=rumor, trans=[]))
check("new-team rule: trade talk is not a trade (no rule, only more doubt)", gr_["players"][0]["bot"]["under"] is None and gr_["players"][0]["bot"]["vol"], gr_["players"][0]["bot"])
# the store says which side of each game he was on: last season with PHX, this season 7 games with HOM (the Royce O'Neale case)
class St0: pass
st0 = St0(); st0.games = {"nba": {}}
reg0 = []
for k in range(20):
    d0 = datetime.date(2026, 2, 1) + datetime.timedelta(days=2 * k); eid = f"L{k}"
    st0.games["nba"][eid] = dict(id=eid, date=d0.isoformat() + "T00:00Z", home="PHX" if k % 2 else "HOM" if k == 4 else "DEN", away="DEN" if k % 2 else "PHX")
    reg0.append(dict(eventId=eid, date=d0.isoformat() + "T00:00Z", home=bool(k % 2), opp="HOM" if k == 4 else "DEN", season="2025-26", stats={"minutes": 30, "points": 10}))
for k in range(7):
    d0 = datetime.date(2026, 10, 28) + datetime.timedelta(days=3 * k); eid = f"C{k}"
    st0.games["nba"][eid] = dict(id=eid, date=d0.isoformat() + "T00:00Z", home="HOM" if k % 2 else "BOS", away="BOS" if k % 2 else "HOM")
    reg0.append(dict(eventId=eid, date=d0.isoformat() + "T00:00Z", home=bool(k % 2), opp="BOS", season="2026-27", stats={"minutes": 24, "points": 9}))
c0 = card(); p0_ = c0["players"][0]
nt0 = PB.new_team("nba", p0_, c0, reg0, st0)
check("new-team rule: 7 games with his new team after last season elsewhere -> flagged, old team named", nt0 and nt0["n"] == 7 and nt0["prev"] == "PHX", nt0)
only_vs = [x for x in reg0 if x["eventId"] == "L4" or x["eventId"].startswith("C")]
nt_vs = PB.new_team("nba", p0_, c0, only_vs, st0)
check("new-team rule: a game against his current team last season counts as the other team", nt_vs and nt_vs["prev"] == "PHX" and nt_vs["n"] == 7, nt_vs)
reg1 = reg0 + [dict(eventId=f"D{k}", date=(datetime.date(2026, 11, 20) + datetime.timedelta(days=k)).isoformat() + "T00:00Z", home=True, opp="BOS", season="2026-27") for k in range(3)]
for k in range(3): st0.games["nba"][f"D{k}"] = dict(id=f"D{k}", home="HOM", away="BOS", date="x")
check("new-team rule: 10 games with the new team -> rule lifted", PB.new_team("nba", p0_, c0, reg1, st0) is None)
check("new-team rule: every game with the same team -> no rule", PB.new_team("nba", p0_, c0, [x for x in reg0 if x["eventId"].startswith("C")], st0) is None)
LOGS[("nba", "1")] = reg0; LOGS_SAVE = None
gnt = card(); bot.research([gnt], NOW, cx_fetch=lambda lg: dict(news=[], trans=[]), store=st0)
check("new-team rule: research flags him from the store with words the page can show", (gnt["players"][0]["bot"]["under"] or "").startswith("New team: 7 games with HOM (was PHX"), gnt["players"][0]["bot"]["under"])
LOGS[("nba", "1")] = A_games
talk = [dict(h="Teams calling about trade for Alpha Guard", d="", t="2026-11-22", ath=[dict(id="1", name="Alpha Guard")])]
gk = card(); bot.research([gk], NOW, cx_fetch=lambda lg: dict(news=talk, trans=[]))
check("flags: trade talk widens the doubt (vol) without keeping him out", gk["players"][0]["bot"]["vol"] and gk["players"][0]["bot"]["avoid"] is None, gk["players"][0]["bot"])

LOGS[("nba", "1")] = [dict(x, season="2025-26", date="2026-03-%02dT23:30Z" % (k + 1)) for k, x in enumerate(A_games)]       # has not played this season
gl = card(); gl["players"][0]["slots"] = [dict(date=(datetime.date(2026, 11, 23) - datetime.timedelta(days=2 * k)).isoformat()) for k in range(6)]
bot.research([gl], NOW, cx_fetch=lambda lg: dict(news=[], trans=[]))
check("flags: back after a long absence (team kept playing) keeps him out; no with/without record from another season", "Has not played since" in (gl["players"][0]["bot"]["avoid"] or "") and "mates" not in next(s for s in gl["players"][0]["stats"] if s["key"] == "pts")["bot"]["l"], gl["players"][0]["bot"])
LOGS[("nba", "1")] = A_games

# ---------------------------------------------------------------- snapshot (after FanDuel's prices)
g = card(rest_days=0); bot.research([g], NOW, cx_fetch=lambda lg: dict(news=[], trans=[])); fd_on(g)
bot.open = {}
bot.snapshot([g], NOW)
rows = list(bot.open.values())
check("snapshot: over/under at FanDuel's line and FanDuel's rungs are written down", any(r.get("ou") and r["r"] == "o" for r in rows) and any(r.get("ou") and r["r"] == "u" for r in rows) and any(not r.get("ou") and r["t"] == 20 for r in rows), [(r["s"], r["r"], r["t"]) for r in rows])
bot.open = {}; gnt2 = card(rest_days=0); gnt2["players"][0]["bot"] = dict(under="New team"); fd_on(gnt2)
for x in gnt2["players"][0]["stats"]: x["bot"] = {}
bot.snapshot([gnt2], NOW)
check("snapshot: legs of a new-team player are still written down, marked nt (so the rule's record can be checked)", bot.open and all(r.get("nt") == 1 for r in bot.open.values()))
bot.open = {}; bot.snapshot([g], NOW); rows = list(bot.open.values())
check("snapshot: only legs between 50% and 97%", all(PB.P_LO <= r["pc"] <= PB.P_HI for r in rows), [r["pc"] for r in rows])
r20 = next(r for r in rows if r["s"] == "pts" and r["t"] == 20 and not r.get("ou"))
check("snapshot: chance with and without the research both kept, plus the size of each pattern", r20["pn"] != r20["pc"] and r20.get("l") and r20["sv"] > 0, r20)
m20 = next(m for m in next(s for s in g["players"][0]["stats"] if s["key"] == "pts")["miles"] if m["t"] == 20.0)
check("snapshot: the leg's chance is the page's blend (half FanDuel's price less 4% margin, half the model's rung chance)", abs(r20["pc"] - PB._blend(PB._imp(-250) * 0.96, m20["p"], 1.0)) < 0.002, (r20["pc"], m20["p"]))
nh = dict(card(), key="nhl", lg="nhl"); nh["players"][0]["stats"] = [dict(stat("pts", 0.9, 0.5, sd=0.9), key="pts"), dict(stat("hits", 2, 1.5), key="hits")]
bot.open = {}; bot.snapshot([nh], NOW)
check("snapshot: NHL keeps the user's book rules (overs only, listed stats only)", all(r["r"] == "o" and r["s"] in ("pts", "sog", "saves", "ast") for r in bot.open.values()), [(r["s"], r["r"]) for r in bot.open.values()])
started = card(); started["iso"] = "2026-11-24T14:00:00Z"
bot.open = {}; bot.snapshot([started], NOW)
check("snapshot: a game already started is not written down", not bot.open)

# ---------------------------------------------------------------- grade from an ESPN-shaped box score
bot.open = {}; bot.snapshot([g], NOW)
n_open = len(bot.open)
class St: pass
store = St(); store.games = {"nba": {"G1": dict(id="G1", date=TIP, home="HOM", away="AWY", hs=118, as_=99)}}
keys = ["minutes", "points", "rebounds", "assists", "threePointFieldGoalsMade-threePointFieldGoalsAttempted"]
summ = dict(header=dict(competitions=[dict(status=dict(type=dict(state="post", completed=True)), competitors=[dict(homeAway="home", score="118", team=dict(id="1")), dict(homeAway="away", score="99", team=dict(id="2"))])]),     # ESPN gives basketball minutes as "22"
            boxscore=dict(players=[dict(team=dict(id="1"), statistics=[dict(keys=keys, athletes=[dict(athlete=dict(id="1", displayName="Alpha Guard"), stats=["22", "21", "4", "5", "2-6"])])])]))
PB.curl = lambda url, tries=3, timeout=8, memo=False: summ
n = bot.grade(store, NOW + datetime.timedelta(days=1))
gr = [r for r in bot.rows if r["g"] == "G1"]
check("grade: every open leg of the game graded and moved out of the open list", n == n_open and not bot.open and len(gr) == n_open, (n, n_open))
check("grade: 21 points -> 20+ hit, 25+ missed, over 23.5 missed, under 23.5 hit", next(r for r in gr if r["t"] == 20 and not r.get("ou") and r["s"] == "pts")["y"] == 1 and
      all(r["y"] == 0 for r in gr if r["s"] == "pts" and r["t"] == 24 and r["r"] == "o") and all(r["y"] == 1 for r in gr if r["s"] == "pts" and r["t"] == 24 and r["r"] == "u"), [(r["s"], r["r"], r["t"], r["y"]) for r in gr])
miss = [r for r in gr if r["y"] == 0 and r.get("why")]
check("grade: minutes read from the box score (ESPN's plain \"22\")", all(r.get("u") == 22.0 for r in gr if r["y"] is not None), [r.get("u") for r in gr])
check("grade: a miss with far fewer minutes than usual in a 19-point win is called a blowout", any(r["why"] == "blowout" for r in miss), [(r["s"], r["t"], r.get("why"), r.get("u"), r.get("u0")) for r in miss])
check("grade: hockey ice time \"18:30\" reads as 18.5 minutes", PB._usage_of(dict(boxscore=dict(players=[dict(statistics=[dict(keys=["timeOnIce"], athletes=[dict(athlete=dict(id="5"), stats=["18:30"])])])])))["5"] == 18.5)
dnp = dict(summ); dnp["boxscore"] = dict(players=[dict(team=dict(id="1"), statistics=[dict(keys=keys, athletes=[dict(athlete=dict(id="1", displayName="Alpha Guard"), stats=[], didNotPlay=True)])])])
bot.rows = []; bot.snapshot([g], NOW); PB.curl = lambda url, tries=3, timeout=8, memo=False: dnp
bot.grade(store, NOW + datetime.timedelta(days=1))
check("grade: did not play -> void, like FanDuel", bot.rows and all(r["y"] is None for r in bot.rows), [r["y"] for r in bot.rows])

# ---------------------------------------------------------------- learning on synthetic history
random.seed(7)
def synth(n_games, said, got, lg="nba", stat_="pts", pid=None, l=None, sv=0.0, d0=datetime.date(2026, 11, 5)):
    out = []
    for k in range(n_games):
        d = (d0 + datetime.timedelta(days=k % 18)).isoformat()
        y = 1 if random.random() < got else 0
        r = dict(d=d, lg=lg, g=f"S{lg}{stat_}{pid}{k}", i=pid or f"P{k % 40}", n="Player " + (pid or str(k % 40)), h=1, s=stat_, r="o", t=10, pr=-300,
                 pf=said, pn=said, pc=said, ps=said, sv=sv, y=y)
        if l: r["l"] = l
        out.append(r)
    return out
R = synth(600, 0.85, 0.72) + synth(300, 0.65, 0.66, stat_="reb")
L, rep = PB.fit(R, datetime.date(2026, 11, 24))
c = L["cal"]["nba"]
check("learn: calibration turns on with enough graded legs", c["on"], c)
z = PB._z(dict(R[0], pn=0.85), L)
check("learn: legs called 85% that landed 72% now come out lower", PB._sig(z) < 0.83, round(PB._sig(z), 3))
check("learn: the stat that was right (rebounds 65% -> 66%) moves much less than points", abs(PB._sig(PB._z(dict(R[-1], pn=0.65), L)) - 0.65) < abs(PB._sig(z) - 0.85), (PB._sig(PB._z(dict(R[-1], pn=0.65), L)),))
check("learn: a lesson is written in words", any("85%" in x or "landed" in x for x in rep["lessons"]), rep["lessons"])
Rp = synth(600, 0.8, 0.8) + synth(40, 0.8, 0.4, pid="BAD")
L2, rep2 = PB.fit(Rp, datetime.date(2026, 11, 24))
check("learn: a player the numbers keep getting wrong gets his own correction", L2["players"].get("nba|BAD", 0) < -0.05, L2["players"])
# pattern weight: rows where the rest pattern pointed down and the legs really missed more -> weight up
Rw = []
for k in range(900):
    lr_ = -0.08 if k % 2 else 0.0; sv = 6.0
    p_true = PB._sig(PB._logit(0.75) + sv * 1.5 * lr_)
    Rw.append(dict(d=(datetime.date(2026, 11, 5) + datetime.timedelta(days=k % 18)).isoformat(), lg="nba", g=f"W{k}", i=f"P{k % 50}", n="p", h=1, s="pts", r="o", t=10, pr=-300,
                   pf=0.75, pn=0.75, pc=0.75, ps=0.75, sv=sv, l={"rest": lr_} if lr_ else {}, y=1 if random.random() < p_true else 0))
L3, rep3 = PB.fit(Rw, datetime.date(2026, 11, 24))
check("learn: a pattern that really predicts misses earns more weight than its prior", L3["w"]["rest"] > PB.PRIOR_W["rest"], L3["w"])

# ---------------------------------------------------------------- cards get the calibration, page file, save / load
bot.L = L; bot.open = {}
g = card(rest_days=0); bot.research([g], NOW, cx_fetch=lambda lg: dict(news=[], trans=[])); fd_on(g); bot.snapshot([g], NOW)
b = next(s for s in g["players"][0]["stats"] if s["key"] == "pts")["bot"]
check("cards: each stat carries the league slope and the shift per side for the page", b.get("s") is not None and set(b.get("c") or {}) == {"o", "u"}, b)
check("cards: the chance shown (ps) is the calibrated one", all(abs(r["ps"] - r["pc"]) > 0.001 for r in bot.open.values()), [(r["pc"], r["ps"]) for r in bot.open.values()][:3])
bot.rows = R[:50] + bot.rows; bot.dirty |= {r["d"] for r in R[:50]}
pg = bot.page(NOW)
check("page: record by chance bucket, per league, lessons, today's notes", pg["record"] and "nba" in pg["byLeague"] and isinstance(pg["lessons"], list) and pg["today"], list(pg))
json.dumps(pg)
bot.save(NOW)
files = sorted(os.listdir(os.path.join(tmp, "store", "propbot")))
check("save: one graded file per game day plus state.json", "state.json" in files and any(f.startswith("graded-2026-11-") for f in files), files)
bot2 = PB.PropBot(root=tmp, log=lambda *a: None)
check("save: reload gives the same graded legs, open legs and learned calibration", len(bot2.rows) == len(bot.rows) and len(bot2.open) == len(bot.open) and bot2.L.get("cal", {}).get("nba", {}).get("on"), (len(bot2.rows), len(bot.rows)))
old = PB.PropBot(root=tmp, log=lambda *a: None); old.rows.append(dict(R[0], d="2026-10-01")); old.dirty.add("2026-10-01"); old.save(NOW)
check("save: days past the 21-day window are dropped", not any("2026-10-01" in f for f in os.listdir(os.path.join(tmp, "store", "propbot"))))

print(f"\n{sum(res)}/{len(res)} passed")
sys.exit(0 if all(res) else 1)
