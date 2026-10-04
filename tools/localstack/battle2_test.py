#!/usr/bin/env python3
"""Battle formats (Parlay / Same Game Parlay), five sports, X+ ladder legs, SGP pricing, payouts, freezes.  Needs the local stack (bash up.sh)."""
import json, sys, time, uuid, datetime, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import api_test as T
from api_test import check, sql, clock, bal, Client, signup

def pair(sp):
    r = sql("select team from public.sim_players where sport = %s group by team having count(*) >= 8 order by team", (sp,))
    t = [x[0] for x in r]; return t[0], t[1]

def run_battle(A, B, bid, la, lb, wait=200):
    A.ok("set_battle_parlay", p_id=bid, p_legs=la); B.ok("set_battle_parlay", p_id=bid, p_legs=lb)
    A.ok("lock_battle_parlay", p_id=bid)
    t = time.time(); r = B.ok("lock_battle_parlay", p_id=bid); dt = time.time() - t
    st = sql("select started_at from public.battles where id = %s", (bid,), one=True)
    clock((st + datetime.timedelta(seconds=wait)).isoformat()); Client().ok("battle_tick"); clock(None)
    return dt, sql("select status, result, markets from public.battles where id = %s", (bid,))[0]

def main():
    import subprocess; subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'load_sim.py')], check=True, stdout=subprocess.DEVNULL)   # fresh sim tables (this test deletes a player)
    clock(None); tag = uuid.uuid4().hex[:5]
    A = signup(f"sa{tag}@x.test", "secret1", "SA_" + tag); B = signup(f"sb{tag}@x.test", "secret1", "SB_" + tag); C = signup(f"sc{tag}@x.test", "secret1", "SC_" + tag)
    anon = Client()
    # ---- format
    h, a = pair("nfl")
    s, x = A.rpc("create_battle", p_sport="nfl", p_home=h, p_away=a, p_wager=10, p_side="home", p_fmt="bogus"); check("unknown format refused", s >= 400, x)
    s, x = A.rpc("create_battle", p_sport="nhl", p_home=h, p_away=a, p_wager=10, p_side="home"); check("unknown sport refused", s >= 400, x)
    b0 = A.ok("create_battle", p_sport="nfl", p_home=h, p_away=a, p_wager=10, p_side="home")["id"]
    check("default format is Parlay", sql("select fmt from public.battles where id = %s", (b0,), one=True) == "parlay")
    A.ok("cancel_battle", p_id=b0)
    # ---- SGP pricing on a real NFL pair
    mk = anon.ok("battle_markets", p_sport="nfl", p_home="KC", p_away="BUF")
    qb = next(p for p in mk["props"] if p["stat"] == "passYds" and p["side"] == "home")
    qa = next(p for p in mk["props"] if p["stat"] == "passYds" and p["side"] == "away")
    bid = A.ok("create_battle", p_sport="nfl", p_home="KC", p_away="BUF", p_wager=50, p_side="home", p_fmt="sgp")["id"]
    check("SGP battle recorded", sql("select fmt from public.battles where id = %s", (bid,), one=True) == "sgp")
    lobby = anon.ok("battle_lobby"); check("lobby shows the format", any(b["id"] == bid and b["fmt"] == "sgp" for b in lobby["open"]), lobby["open"][:1])
    B.ok("accept_battle", p_id=bid)
    leg_qb = f"p:{qb['pid']}:passYds:over"
    r = A.ok("set_battle_parlay", p_id=bid, p_legs=["ml:home", leg_qb]); q = r["quote"]
    check("SGP: QB passing yards + his team to win prices shorter than the naive product", q["mult"] < q["naive"] * 0.98, q)
    r2 = A.ok("set_battle_parlay", p_id=bid, p_legs=["ml:home", f"p:{qa['pid']}:passYds:under"]); q2 = r2["quote"]
    check("SGP: opposing QB UNDER with my team to win is also positively correlated (shorter than naive)", q2["mult"] < q2["naive"], q2)
    r3 = A.ok("set_battle_parlay", p_id=bid, p_legs=["tot:over", leg_qb]); q3 = r3["quote"]
    check("SGP: total over + QB passing yards over prices shorter than naive", q3["mult"] < q3["naive"], q3)
    r4 = A.ok("set_battle_parlay", p_id=bid, p_legs=["ml:home", "tot:over"]); q4 = r4["quote"]
    check("SGP: any two legs never pay more than straight multiplication by more than the model margin", q4["mult"] <= q4["naive"] * 1.08, q4)
    ladders = [p for p in mk["props"] if p["stat"] == "passYds" and p["side"] == "home"][0]["rungs"]
    rg = ladders[len(ladders) // 2]
    r5 = A.ok("set_battle_parlay", p_id=bid, p_legs=["ml:home", f"x:{qb['pid']}:passYds:{rg['n']}"]); check("an X+ ladder leg is accepted and priced", r5["quote"]["mult"] > 1 and r5["legs"][1]["price"] == rg["price"], r5["quote"])
    s, x = A.rpc("set_battle_parlay", p_id=bid, p_legs=[leg_qb, f"x:{qb['pid']}:passYds:{rg['n']}"]); check("one pick per player stat (over and ladder on the same stat refused)", s >= 400, x)
    s, x = A.rpc("set_battle_parlay", p_id=bid, p_legs=["ml:home", f"x:{qb['pid']}:passYds:7"]); check("a rung that is not on the ladder is refused", s >= 400, x)
    s, x = A.rpc("set_battle_parlay", p_id=bid, p_legs=["ml:home"] * 1 + ["spr:home", "tot:over", leg_qb, f"p:{qa['pid']}:passYds:under", "ml:away", "tot:under"]); check("more than 6 legs refused", s >= 400, x)
    a2 = A.ok("set_battle_parlay", p_id=bid, p_legs=["ml:home"])
    s, x = A.rpc("lock_battle_parlay", p_id=bid); check("an SGP needs at least 2 legs", s >= 400 and "2 legs" in json.dumps(x), x)
    s, x = C.rpc("place_spectator_bet", p_id=bid, p_tok=leg_qb, p_stake=10); check("spectators cannot take player props", s >= 400, x)
    s, x = C.rpc("place_spectator_bet", p_id=bid, p_tok=f"x:{qb['pid']}:passYds:{rg['n']}", p_stake=10); check("spectators cannot take ladder rungs", s >= 400, x)
    la = ["ml:home", leg_qb, "tot:over"]; lb = ["ml:away", f"p:{qa['pid']}:passYds:over"]
    qa_ = A.ok("set_battle_parlay", p_id=bid, p_legs=la)["quote"]; qb_ = B.ok("set_battle_parlay", p_id=bid, p_legs=lb)["quote"]
    # the saved price must follow the legs
    check("quote is bound to the legs", qa_["toks"] == sorted(la) and qa_["fmt"] == "sgp", qa_)
    # freeze: remove the QB from the live sim table after creation -> the battle keeps its snapshot
    sql("delete from public.sim_players where sport='nfl' and pid = %s", (qb["pid"],))
    mk2 = anon.ok("battle_markets", p_sport="nfl", p_home="KC", p_away="BUF")
    check("a player who drops out later disappears from NEW battles", not any(p["pid"] == qb["pid"] for p in mk2["props"]))
    s, det = A.rpc("battle_detail", p_id=bid); check("the existing battle keeps its frozen roster", any(p["pid"] == qb["pid"] for p in det["battle"]["markets"]["props"]))
    dt, (status, res, mkf) = run_battle(A, B, bid, la, lb)
    check(f"start_battle with {len(mk['props'])} props is fast ({dt:.2f}s)", dt < 3.0, dt)
    check("SGP battle settled", status == "final", (status, res))
    for who, U in (("creator", A), ("opponent", B)):
        pay, hits, gr, qq = sql("select payout, hits, graded, quote from public.battle_parlays where battle_id = %s and user_id = %s", (bid, U.uid))[0]
        allw = all(l["res"] == "W" for l in gr); want = round(float(mkf["notional"]) * qq["mult"], 2) if allw else 0
        check(f"SGP {who}: payout = notional x saved price when every leg hits, else 0 ({float(pay)} vs {want}; {hits}/{len(gr)} hit)", abs(float(pay) - want) < 0.02, (gr, qq))
    s, det = anon.rpc("battle_detail", p_id=bid)
    check("finished battle no longer ships the whole prop list", "props" not in det["battle"]["markets"], list(det["battle"]["markets"]))
    # ---- parlay format keeps straight multiplication
    bp = A.ok("create_battle", p_sport="nba", p_home="BOS", p_away="LAL", p_wager=10, p_side="home", p_fmt="parlay")["id"]; B.ok("accept_battle", p_id=bp)
    mkn = anon.ok("battle_markets", p_sport="nba", p_home="BOS", p_away="LAL")
    pr = next(p for p in mkn["props"] if p["stat"] == "pra")
    q = A.ok("set_battle_parlay", p_id=bp, p_legs=["ml:home", f"p:{pr['pid']}:pra:over"])["quote"]
    check("Parlay format: naive multiplication", abs(q["mult"] - q["naive"]) < 0.002, q)
    A.ok("cancel_battle", p_id=bp)
    # ---- every sport end to end
    for sp in ("nfl", "nba", "mlb", "cfb", "cbb"):
        h, a = pair(sp) if sp in ("cfb", "cbb") else {"nfl": ("DET", "GB"), "nba": ("DEN", "OKC"), "mlb": ("HOU", "ATL")}[sp]
        for fmt in ("parlay", "sgp"):
            x = A.ok("create_battle", p_sport=sp, p_home=h, p_away=a, p_wager=10, p_side="home", p_fmt=fmt)["id"]; B.ok("accept_battle", p_id=x)
            m = sql("select markets from public.battles where id = %s", (x,), one=True)
            ps = m["props"]; sides = {p["side"] for p in ps}
            check(f"{sp} {fmt}: {len(ps)} props, both teams, 8+ players each", len(ps) >= 20 and sides == {"home", "away"} and sum(1 for p in m["players"] if p["side"] == "home") >= 8 and sum(1 for p in m["players"] if p["side"] == "away") >= 8, (len(ps), len(m["players"])))
            pa = [p for p in ps if p["side"] == "home" and not p["yn"]][0]; pb = [p for p in ps if p["side"] == "away" and p["yn"]]
            la = ["ml:home", f"x:{pa['pid']}:{pa['stat']}:{pa['rungs'][0]['n']}"]
            lb = ["ml:away"] + ([f"x:{pb[0]['pid']}:{pb[0]['stat']}:1"] if pb else ["tot:under"])
            dt, (status, res, _) = run_battle(A, B, x, la, lb)
            check(f"{sp} {fmt}: simulated + settled in {dt:.2f}s lock", status == "final" and dt < 3.0, (status, dt))
            pl = sql("select players from public.battle_results where battle_id = %s", (x,), one=True)
            check(f"{sp} {fmt}: result has player lines for the listed players", len([k for k in pl if not k.startswith("_")]) >= 8, len(pl))
    # ---- King badge for all five sports
    for sp in ("nfl", "nba", "mlb", "cfb", "cbb"):
        sql("insert into public.battle_stats(user_id, sport, elo, rated, w) values (%s, %s, 1500, 5, 5) on conflict (user_id, sport) do update set elo = 1500, rated = 5", (C.uid, sp))
    sm = sql("select ls_private.award_day(%s::date)", ((datetime.date.today() - datetime.timedelta(days=3)).isoformat(),), one=True)
    check("King badge is awarded per sport, all five", all(("king_" + sp) in sm for sp in ("nfl", "nba", "mlb", "cfb", "cbb")), sm)
    bad = [r for r in T.RES if not r[0]]
    print(f"\n{len(T.RES) - len(bad)}/{len(T.RES)} battle2 checks passed")
    return 1 if bad else 0

if __name__ == "__main__":
    try: sys.exit(main())
    finally: clock(None)
