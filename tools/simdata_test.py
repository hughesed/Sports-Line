#!/usr/bin/env python3
"""Roster and injury correctness for the battle data (engine/simdata.py).
  python3 tools/simdata_test.py            offline: synthetic teams in all five sports (injured star disappears, teammates' lines rise, team strength drops,
                                           questionable players are flagged and trimmed, 8+ players per team) + the cache/digest round trip
  python3 tools/simdata_test.py --real     adds REAL ESPN pulls: one team per league (NFL, NBA with the offseason fallback, MLB, CFB, CBB):
                                           every listed player is on ESPN's CURRENT roster of that team, nobody the injury feed calls Out is listed,
                                           the team's Out list matches the feed, and a synthetic injured star on the real data behaves
Exit code 1 if any check fails."""
import sys, os, json, copy, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "engine"))
import simdata

RES = []
def check(name, cond, extra=""):
    RES.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + ((" - " + str(extra)[:220]) if extra not in ("", None) else ""), flush=True)

# ------------------------------------------------------------------------------------------------ synthetic teams
def P(pid, name, pos, role, **stats): return dict(pid=pid, tid="1", team="AAA", name=name, pos=pos, role=role, stats=stats)
def nfl_team():
    return [P("q1", "Star QB", "QB", "QB", py=270, ptd=1.8, ry=12, rtd=0.1, att=36, gp=8), P("q2", "Backup QB", "QB", "QB", py=40, ptd=0.2, ry=2, rtd=0, att=6, gp=8),
            P("r1", "Lead Back", "RB", "RB", ry=80, car=18, rtd=0.6, rec=3, ly=22, rctd=0.1, gp=8), P("r2", "Change Back", "RB", "RB", ry=30, car=7, rtd=0.2, rec=3, ly=24, rctd=0.1, gp=8),
            P("r3", "Third Back", "RB", "RB", ry=10, car=3, rtd=0.05, rec=1, ly=6, rctd=0, gp=8),
            P("w1", "Star WR", "WR", "WR", ry=0, car=0, rtd=0, rec=7, ly=95, rctd=0.7, gp=8), P("w2", "Second WR", "WR", "WR", rec=5, ly=62, rctd=0.4, gp=8),
            P("w3", "Third WR", "WR", "WR", rec=4, ly=48, rctd=0.3, gp=8), P("t1", "Tight End", "TE", "WR", rec=4, ly=42, rctd=0.3, gp=8),
            P("w4", "Fourth WR", "WR", "WR", rec=2, ly=25, rctd=0.1, gp=8), P("w5", "Fifth WR", "WR", "WR", rec=1.5, ly=18, rctd=0.1, gp=8)]
def nba_team():
    stars = [("Star Guard", 28, 5, 7, 3.2, 35), ("Big Man", 22, 11, 3, 0.5, 33), ("Wing One", 17, 5, 3, 2.1, 31), ("Wing Two", 14, 4, 2, 1.8, 29), ("Forward", 11, 6, 2, 1.0, 27),
             ("Sixth Man", 10, 3, 3, 1.5, 24), ("Guard Two", 8, 2, 4, 1.0, 21), ("Backup Big", 6, 5, 1, 0.1, 18), ("Reserve", 5, 2, 1, 0.5, 14), ("Deep Bench", 3, 1, 1, 0.3, 9)]
    return [P(f"b{i}", n, "G", "P", pts=a, reb=b, ast=c, fg3=d, min=m, gp=60) for i, (n, a, b, c, d, m) in enumerate(stars)]
def mlb_team():
    hit = [P(f"h{i}", f"Hitter {i}", "OF", "H", h=1.25 - i * 0.06, hr=0.22 - i * 0.015, rbi=0.75 - i * 0.04, tb=2.0 - i * 0.1, r=0.7 - i * 0.03, gp=120) for i in range(11)]
    return hit + [P("s1", "Ace", "SP", "SP", k=7.5, outs=18, gs=25, gp=25), P("s2", "Number Two", "SP", "SP", k=6, outs=16, gs=24, gp=24)]

def ranks(lg, cands, out=(), q=(), items=()):
    return simdata.compose_team(lg, "AAA", cands, set(out), set(q), list(items), today=datetime.date(2026, 10, 2))

def stat(pl, pid, k):
    for p in pl:
        if p["pid"] == pid: return p["stats"].get(k)
    return None

def synthetic():
    # NFL: star WR out
    base, bi = ranks("nfl", nfl_team())
    hurt, hi = ranks("nfl", nfl_team(), out={"w1"}, items=[dict(pid="w1", name="Star WR", pos="WR", kind="out", label="Out", note="", date="2026-09-28")])
    check("NFL: 8+ players listed (QB1, RBs, WR/TE)", len(base) >= 8, len(base))
    check("NFL: injured star WR disappears from the list", all(p["pid"] != "w1" for p in hurt) and any(p["pid"] == "w1" for p in base))
    check("NFL: teammates' receiving lines rise", stat(hurt, "w2", "ly") > stat(base, "w2", "ly") and stat(hurt, "t1", "rec") > stat(base, "t1", "rec"), (stat(base, "w2", "ly"), stat(hurt, "w2", "ly")))
    check("NFL: team offence is marked down and the Out list names him", hi["offAdj"] > bi["offAdj"] and any(o["pid"] == "w1" for o in hi["out"]), hi)
    qb_out, qi = ranks("nfl", nfl_team(), out={"q1"}, items=[dict(pid="q1", name="Star QB", pos="QB", kind="out", label="Out", note="", date="2026-09-28")])
    check("NFL: starting QB out -> the backup is the QB1 and the rating drops by about 4 points", [p["pid"] for p in qb_out if p["role"] == "QB"] == ["q2"] and qi["offAdj"] >= 3.5, qi)
    qq, qi2 = ranks("nfl", nfl_team(), q={"w1"}, items=[dict(pid="w1", name="Star WR", pos="WR", kind="q", label="Questionable", note="knee", date="2026-10-01")])
    check("NFL: questionable star stays, flagged, usage cut to 85%", any(p["pid"] == "w1" and p.get("inj") for p in qq) and abs(stat(qq, "w1", "ly") / stat(base, "w1", "ly") - 0.85) < 0.01, [p for p in qq if p["pid"] == "w1"][0].get("inj"))
    # NBA
    nb, nbi = ranks("nba", nba_team())
    nh, nhi = ranks("nba", nba_team(), out={"b0"}, items=[dict(pid="b0", name="Star Guard", pos="G", kind="out", label="Out", note="", date="2026-09-30")])
    check("NBA: 9 players by minutes", len(nb) == 9 and [p["rk"] for p in nb] == list(range(1, 10)), len(nb))
    check("NBA: injured star disappears and the 10th man enters the 9", all(p["pid"] != "b0" for p in nh) and len(nh) == 9 and any(p["pid"] == "b9" for p in nh))
    check("NBA: teammates' points and assists rise", stat(nh, "b2", "pts") > stat(nb, "b2", "pts") and stat(nh, "b6", "ast") > stat(nb, "b6", "ast"), (stat(nb, "b2", "pts"), stat(nh, "b2", "pts")))
    check("NBA: team strength drops (~0.55 x (pts + ast), capped at 8)", nhi["offAdj"] >= 5.0 and nbi["offAdj"] == 0, (nbi["offAdj"], nhi["offAdj"]))
    # MLB
    mb, mi = ranks("mlb", mlb_team())
    mh, mhi = ranks("mlb", mlb_team(), out={"h0"}, items=[dict(pid="h0", name="Hitter 0", pos="OF", kind="out", label="15-Day-IL", note="", date="2026-09-20")])
    check("MLB: 9 hitters + the starter", len([p for p in mb if p["role"] == "H"]) == 9 and len([p for p in mb if p["role"] == "SP"]) == 1)
    check("MLB: injured hitter disappears, the next one is promoted, offence marked down", all(p["pid"] != "h0" for p in mh) and any(p["pid"] == "h9" for p in mh) and mhi["offAdj"] > mi["offAdj"], mhi)
    # college shares the pro code paths
    cf_, ci = simdata.compose_team("cfb", "AAA", nfl_team(), {"w1"}, set(), [dict(pid="w1", name="Star WR", pos="WR", kind="out", label="Out", note="", date="2026-09-28")], today=datetime.date(2026, 10, 2))
    check("CFB: same rules (star WR out)", all(p["pid"] != "w1" for p in cf_) and ci["offAdj"] > 0)
    cb_, cbi = simdata.compose_team("cbb", "AAA", nba_team(), {"b0"}, set(), [dict(pid="b0", name="Star Guard", pos="G", kind="out", label="Out", note="", date="2026-09-30")], today=datetime.date(2026, 10, 2))
    check("CBB: same rules (star guard out), 9 players", all(p["pid"] != "b0" for p in cb_) and len(cb_) == 9 and cbi["offAdj"] > 0)
    old, oi = ranks("nfl", nfl_team(), out={"w1"}, items=[dict(pid="w1", name="Star WR", pos="WR", kind="out", label="Out", note="", date="2026-08-01")])
    check("an injury older than 3 weeks counts half (already in the results)", oi["offAdj"] < hi["offAdj"] * 0.75, (oi["offAdj"], hi["offAdj"]))

def build_check(sim, label):
    """integrated: build() with the team's real/synthetic candidates and an injury report"""
    pass

def synthetic_build():
    simdata.scope_teams = lambda lg, root=None: (None, None)          # the test teams are not on any slate
    learn = {"leagues": {lg: {"L": {"nfl": 23, "nba": 114, "mlb": 4.5, "cfb": 28, "cbb": 75}[lg], "params": {"hfa": 1.5}, "ratings": {"AAA": {"o": 1.0, "d": -0.5, "gp": 8}, "BBB": {"o": 0.0, "d": 0.0, "gp": 8}}} for lg in simdata.SPORTS}}
    teams = [dict(id="1", abbr="AAA", name="Alpha", short="Alpha", color="#123456"), dict(id="2", abbr="BBB", name="Beta", short="Beta", color="#654321")]
    def raw(lg):
        mk = {"nfl": nfl_team, "cfb": nfl_team, "nba": nba_team, "cbb": nba_team, "mlb": mlb_team}[lg]()
        for p in mk: p["team"] = "AAA"; p["tid"] = "1"
        return mk
    cache = {"teams": {lg: dict(ts=1e12, teams=teams) for lg in simdata.SPORTS}, "players": {lg: dict(ts=1e12, season=2026, list=raw(lg)) for lg in simdata.SPORTS}}
    inj = {"nfl": "w1", "cfb": "w1", "nba": "b0", "cbb": "b0", "mlb": "h0"}
    clean = {"inj": {}, "rosters": {}}
    hurt = {"inj": {lg: dict(ts=1, teams={"1": [dict(pid=pid, name="x", pos="WR", kind="out", label="Out", note="", date="2026-10-01")]}) for lg, pid in inj.items()}, "rosters": {}}
    a = simdata.build(learn, cache, live=clean, today=datetime.date(2026, 10, 2)); b = simdata.build(learn, cache, live=hurt, today=datetime.date(2026, 10, 2))
    for lg in simdata.SPORTS:
        ta = next(t for t in a["sports"][lg]["teams"] if t["abbr"] == "AAA"); tb = next(t for t in b["sports"][lg]["teams"] if t["abbr"] == "AAA")
        pa = a["sports"][lg]["players"]["AAA"]; pb = b["sports"][lg]["players"]["AAA"]
        check(f"{lg.upper()} build(): injured star leaves the roster, team offence rating drops, 8+ players remain",
              all(p["pid"] != inj[lg] for p in pb) and any(p["pid"] == inj[lg] for p in pa) and tb["o"] < ta["o"] and len(pb) >= 8, (ta["o"], tb["o"], len(pb)))
    teams_rows, player_rows = simdata.rows(b)
    check("rows(): injury summary travels with the team, 5 sports present", all("inj" in t for t in teams_rows) and {t["sport"] for t in teams_rows} == set(simdata.SPORTS))
    check("digest() is stable (an unchanged upload is skipped)", simdata.digest(teams_rows) == simdata.digest(copy.deepcopy(teams_rows)) and simdata.digest(player_rows) != simdata.digest(teams_rows))
    check("digest() changes when an injury changes", simdata.digest(simdata.rows(a)[0]) != simdata.digest(simdata.rows(b)[0]))

# ------------------------------------------------------------------------------------------------ real ESPN
def real():
    sim = json.load(open(os.path.join(HERE, "..", "data", "sim.json")))
    pick = {"nfl": "KC", "nba": "BOS", "mlb": "NYY", "cfb": None, "cbb": None}
    cache = simdata.load_cache()
    for lg in simdata.SPORTS:
        s = sim["sports"][lg]
        ab = pick[lg] if pick[lg] in s["players"] else sorted(s["players"], key=lambda a: -len(s["players"][a]))[0]
        tmeta = next(t for t in (cache["teams"].get(lg) or {}).get("teams", []) if t["abbr"] == ab)
        listed = s["players"][ab]; team = next(t for t in s["teams"] if t["abbr"] == ab)
        ros = simdata.fetch_roster(lg, tmeta["id"], meta=True); feed = simdata.fetch_injuries(lg)
        print(f"[{lg}] {ab} ({tmeta['name']}): {len(listed)} listed; ESPN roster {len(ros['ids']) if ros else None}; injury feed {sum(len(v) for v in feed.values()) if feed else None}")
        if not ros or feed is None:
            check(f"{lg.upper()}: ESPN reachable for the live checks", False, "roster/injury feed unavailable"); continue
        rid = set(ros["ids"])
        check(f"{lg.upper()} {ab}: 8+ players listed", len(listed) >= 8, len(listed))
        ghosts = [p["name"] for p in listed if p["pid"] not in rid and not str(p["pid"]).startswith("sub-")]
        check(f"{lg.upper()} {ab}: every listed player is on ESPN's current roster", not ghosts, ghosts)
        outs = {i["pid"] for i in feed.get(tmeta["id"], []) if i["kind"] == "out"} | {pid for pid, (k, _) in ros["inj"].items() if k == "out"}
        names_out = {re_name(i["name"]) for i in feed.get(tmeta["id"], []) if i["kind"] == "out"}
        bad = [p["name"] for p in listed if p["pid"] in outs or re_name(p["name"]) in names_out]
        check(f"{lg.upper()} {ab}: nobody ESPN lists as Out/IR is in the battle roster", not bad, bad)
        listed_out = {o["pid"] for o in (team.get("inj") or {}).get("out", [])}
        check(f"{lg.upper()} {ab}: the team's Out list comes from the same feed ({len(listed_out)} listed, {len(outs)} in the feed)", listed_out <= outs | {i['pid'] for i in feed.get(tmeta['id'], [])} and (len(outs) == 0 or len(listed_out) > 0), (sorted(listed_out)[:4], sorted(outs)[:4]))
        # a synthetic injured star on the real data
        raw = [p for p in (cache["players"].get(lg) or {}).get("list", []) if p["team"] == ab]
        if ros: raw = [p for p in raw if p["pid"] in rid] or raw
        out_ids = {i["pid"] for i in feed.get(tmeta["id"], []) if i["kind"] == "out"}
        q_ids = {i["pid"] for i in feed.get(tmeta["id"], []) if i["kind"] == "q"}
        base, bi = simdata.compose_team(lg, ab, raw, out_ids, q_ids, feed.get(tmeta["id"], []))
        if not base: check(f"{lg.upper()} {ab}: raw candidates available for the synthetic test", False); continue
        star = max(base, key=lambda p: ((p["stats"].get("py") or 0) * 0.1 + (p["stats"].get("ly") or 0) + (p["stats"].get("ry") or 0)) if lg in simdata.FB else (p["stats"].get("pts") or p["stats"].get("tb") or 0))
        if lg in simdata.FB and star["role"] == "QB":
            star = max([p for p in base if p["role"] != "QB"], key=lambda p: (p["stats"].get("ly") or 0) + (p["stats"].get("ry") or 0))
        itm = feed.get(tmeta["id"], []) + [dict(pid=star["pid"], name=star["name"], pos=star["pos"], kind="out", label="Out", note="synthetic", date=datetime.date.today().isoformat())]
        hurt, hi = simdata.compose_team(lg, ab, raw, out_ids | {star["pid"]}, q_ids, itm)
        key = "pts" if lg in simdata.BB else ("h" if lg == "mlb" else "ly")
        mates_up = [p for p in hurt if p["pid"] != star["pid"] and any(p["pid"] == b["pid"] and (p["stats"].get(key) or 0) > (b["stats"].get(key) or 0) for b in base)]
        check(f"{lg.upper()} {ab}: synthetic injured star {star['name']} disappears", all(p["pid"] != star["pid"] for p in hurt))
        if lg != "mlb": check(f"{lg.upper()} {ab}: teammates' {key} rise ({len(mates_up)} players)", len(mates_up) >= 1, len(mates_up))
        check(f"{lg.upper()} {ab}: team strength drops (offAdj {bi['offAdj']} -> {hi['offAdj']})", hi["offAdj"] > bi["offAdj"], (bi["offAdj"], hi["offAdj"]))
        check(f"{lg.upper()} {ab}: still 8+ players after the injury", len(hurt) >= 8, len(hurt))

def re_name(x):
    import re
    return re.sub(r"[^a-z]", "", (x or "").lower())

if __name__ == "__main__":
    synthetic(); synthetic_build()
    if "--real" in sys.argv: real()
    bad = RES.count(False); print(f"\n{len(RES) - bad}/{len(RES)} simdata checks passed")
    sys.exit(1 if bad else 0)
