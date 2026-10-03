#!/usr/bin/env python3
"""Bot settlement test: practice bets on a REAL finished MLB game (from the store) are placed before its start (fake clock),
then refresh.py runs with the Supabase env vars and must settle them from the store final + the real ESPN box score.
usage: python bot_test.py <site_copy_dir>"""
import json, os, sys, time, uuid, datetime, subprocess, urllib.request
import requests
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gateway import ANON, SERVICE
from api_test import signup, sql, clock, bal, BASE, Client, check, RES

SITE = os.path.abspath(sys.argv[1])
sys.path.insert(0, os.path.join(SITE, "engine"))

def main():
    clock(None)
    games = [json.loads(l) for l in open(os.path.join(SITE, "store", "games_mlb.jsonl"))]
    games = sorted(games, key=lambda g: g.get("d") or "")[-40:]
    pick = None
    for g in reversed(games):
        s = json.load(urllib.request.urlopen(f"https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event={g['i']}", timeout=15))
        import social
        h, a, box, dnp = social.box_of("mlb", s)
        hitters = [(pid, r) for pid, r in box.items() if r.get("hits", 0) >= 2]
        pitchers = [(pid, r) for pid, r in box.items() if "k" in r]
        if hitters and pitchers and h != a: pick = (g, h, a, box, hitters[0], pitchers[0]); break
    g, hs, as_, box, (hid, hrow), (pid, prow) = pick
    print("game", g["i"], g["a"], "@", g["h"], as_, "-", hs, "hitter", hid, hrow, "pitcher", pid, prow)
    check("store final matches the ESPN box score", int(g["hs"]) == hs and int(g["as"]) == as_, (g["hs"], g["as"], hs, as_))
    start = datetime.datetime.fromisoformat(g["d"].replace("Z", "+00:00"))
    tag = uuid.uuid4().hex[:5]
    svc = Client(SERVICE)
    row = dict(gid=g["i"], lg="mlb", key="mlb", start_at=start.isoformat(), home=g["h"], away=g["a"], title=f"{g['a']} at {g['h']}",
               lines=dict(mlHome=-120, mlAway=100, sprHome=-1.5, sprAway=1.5, prHome=140, prAway=-160, total=8.5, over=-110, under=-110),
               props={hid: {"name": "Hitter One", "side": "home", "status": {"kind": "ok"}, "stats": {"hits": {"label": "Hits", "line": 1.5, "overPrice": 150, "safeAdj": 1, "safePrice": -250, "matchup": 0, "miles": []},
                                                                                                         "tb": {"label": "Total bases", "line": 1.5, "overPrice": -105, "matchup": 0, "miles": []}}},
                      pid: {"name": "Pitcher Two", "side": "away", "status": {"kind": "ok"}, "stats": {"k": {"label": "Strikeouts", "line": 20.5, "overPrice": 900, "matchup": 0, "miles": []}}},
                      "999999999": {"name": "Not Playing", "side": "home", "status": {"kind": "ok"}, "stats": {"hits": {"label": "Hits", "line": 0.5, "overPrice": -150, "matchup": 0, "miles": []}}}})
    r = requests.post(f"{BASE}/rest/v1/games?on_conflict=gid", headers={**svc.h(), "Prefer": "resolution=merge-duplicates,return=minimal"}, data=json.dumps([row]))
    assert r.status_code < 300, r.text
    sql("update public.games set status = 'pre', final = null where gid = %s", (g["i"],))
    U = signup(f"bot{tag}@x.test", "secret1", "Bot_" + tag)
    clock((start - datetime.timedelta(hours=2)).isoformat())
    win_side = "home" if hs > as_ else "away"
    b1 = U.ok("place_bet", p_legs=[f"g:{g['i']}:ml:{win_side}", f"p:{g['i']}:{hid}:hits:over"], p_stake=10)["bets"][0]
    b2 = U.ok("place_bet", p_legs=[f"p:{g['i']}:{pid}:k:over"], p_stake=10)["bets"][0]
    b3 = U.ok("place_bet", p_legs=[f"p:{g['i']}:999999999:hits:over"], p_stake=10)["bets"][0]
    b4 = U.ok("place_bet", p_legs=[f"g:{g['i']}:tot:over", f"p:{g['i']}:{hid}:tb:over"], p_stake=10, p_mode="single")["bets"]
    clock(None)
    env = dict(os.environ, SUPABASE_URL=BASE, SUPABASE_ANON_KEY=ANON, SUPABASE_SERVICE_KEY=SERVICE, LS_DEADLINE="70", LS_ONLY="mlb,nfl",
               LS_CACHE=os.environ.get("LS_CACHE", "/tmp/lscache"))
    t0 = time.time()
    p = subprocess.run([sys.executable, "refresh.py"], cwd=SITE, env=env, capture_output=True, text=True, timeout=200)
    dt = time.time() - t0
    print(p.stdout[-1800:]); print(p.stderr[-800:])
    check("refresh.py with Supabase configured finishes inside the 70 s deadline (+ writing)", p.returncode == 0 and dt < 85, f"{dt:.1f}s rc={p.returncode}")
    st = {r[0]: (r[1], float(r[2])) for r in sql("select id, status, payout from public.bets where user_id = %s", (U.uid,))}
    check("bot settled the ML + hits parlay from the real box score (won)", st[b1][0] == "won", st[b1])
    check("pitcher 20.5 K over lost", st[b2][0] == "lost", st[b2])
    check("prop on a player not in the box score (MLB) is void and refunded", st[b3][0] == "void" and st[b3][1] == 10, st[b3])
    tbv = hrow.get("tb", 0); tot = hs + as_
    check("total + total bases graded like the page", st[b4[0]][0] == ("won" if tot > 8.5 else "lost") and st[b4[1]][0] == ("won" if tbv >= 2 else "lost"), (st[b4[0]], st[b4[1]], tot, tbv))
    m = json.load(open(os.path.join(SITE, "data", "meta.json")))
    soc = m.get("social") or {}
    check("meta.json reports the social step", soc.get("enabled") is True and not soc.get("errors"), soc)
    cfg = json.load(open(os.path.join(SITE, "data", "config.json")))
    check("data/config.json carries the public URL + anon key (never the service key)", cfg["supabaseUrl"] == BASE and cfg["supabaseAnonKey"] == ANON and SERVICE not in open(os.path.join(SITE, "data", "config.json")).read())
    nteam = sql("select count(*) from public.sim_teams", one=True); ngame = sql("select count(*) from public.games", one=True)
    check("battle teams and the slate's games were uploaded", nteam >= 60 and ngame >= 10, (nteam, ngame))
    for f in os.listdir(os.path.join(SITE, "data")) + os.listdir(os.path.join(SITE, "store")):
        pass
    leak = subprocess.run(["grep", "-rl", SERVICE, os.path.join(SITE, "data"), os.path.join(SITE, "store")], capture_output=True, text=True).stdout.strip()
    check("the service key is not written anywhere in data/ or store/", leak == "", leak)
    # second run: nothing re-uploaded (hash cache), nothing double-paid
    b_before = bal(U)
    p2 = subprocess.run([sys.executable, "refresh.py"], cwd=SITE, env=env, capture_output=True, text=True, timeout=200)
    soc2 = json.load(open(os.path.join(SITE, "data", "meta.json"))).get("social") or {}
    check("second run: unchanged games/battle data are not uploaded again, no double payout", soc2.get("gamesUploaded", 0) <= 3 and "simTeamsUploaded" not in soc2 and bal(U) == b_before, soc2)
    bad = [r for r in RES if not r[0]]
    print(f"\n{len(RES) - len(bad)}/{len(RES)} bot checks passed")
    return 1 if bad else 0

if __name__ == "__main__":
    try: sys.exit(main())
    finally: clock(None)
