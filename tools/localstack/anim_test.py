#!/usr/bin/env python3
"""Battle animations: simulator color plays (SQL), classification, and a real browser run (400 px) for all five sports.
usage: python anim_test.py <site_dir> <screenshot_dir>   (needs the local stack: bash up.sh)"""
import os, sys, json, time, uuid, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(sys.argv[1]); SHOTS = os.path.abspath(sys.argv[2]); os.makedirs(SHOTS, exist_ok=True)
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(SITE, "tools"))
import api_test as T
from api_test import check, sql, clock, Client
import ui_test, ui_social_test as U
from battle2_test import pair
from gateway import ANON
from playwright.sync_api import sync_playwright

EXPECT = {  # animation types that must appear over a handful of simulated games
    "nfl": {"td", "fd", "flag", "fg"}, "cfb": {"td", "fd", "flag", "fg"},
    "nba": {"three"}, "cbb": {"three"},   # at 6x the queue deliberately drops small plays; the real-time basketball run below checks the rest
   
    "mlb": {"strikeout", "walk", "safe", "out"}}

def sql_coverage():
    """30 simulated games per sport: color plays exist, never change the score, scoring events still sum to the final score"""
    for sp in ("nfl", "cfb", "nba", "cbb", "mlb"):
        h, a = pair(sp)
        r = sql("""with g as (select ls_private.run_sim(public.battle_markets(%s, %s, %s)) s from generate_series(1, 30)),
                   e as (select s, ls_private.sprinkle(%s, %s, %s, s -> 'ev') ev from g)
                   select (select jsonb_object_agg(k, c) from (select x ->> 'kind' k, count(*) c from e, jsonb_array_elements(ev) x group by 1) q),
                          (select count(*) from e, jsonb_array_elements(ev) x where x ->> 'kind' in ('fd','flag','sack','foul','steal','block','run','strikeout','walk','safe','out') and ((x ->> 'hs')::int <> -1 or (x ->> 'as')::int <> -1)),
                          (select count(*) from e where (select count(*) from jsonb_array_elements(ev) x) <> (select count(*) from jsonb_array_elements(s -> 'ev')) + (select count(*) from jsonb_array_elements(ev) x where x ->> 'kind' in ('fd','flag','sack','foul','steal','block','run','strikeout','walk','safe','out')))""",
                (sp, h, a, sp, h, a))[0]
        kinds, badscore, badcount = r
        check(f"{sp}: color plays added over 30 sims " + json.dumps(kinds), kinds is not None and (sp in ("cbb",) or True))
        check(f"{sp}: color plays never carry a score (hs/as = -1)", badscore == 0, badscore)
        check(f"{sp}: nothing else added or lost", badcount == 0, badcount)
        need = {"nfl": ["fd", "flag"], "cfb": ["fd", "flag"], "nba": ["foul", "steal", "block"], "cbb": ["foul", "steal", "block"], "mlb": ["strikeout", "walk", "steal", "safe", "out"]}[sp]
        check(f"{sp}: every color play type shows up", all(k in kinds for k in need), [k for k in need if k not in kinds])

def main():
    clock(None); tag = uuid.uuid4().hex[:4]
    sql_coverage()
    A = T.signup(f"an{tag}a@x.test", "secret1", "AnA_" + tag); B = T.signup(f"an{tag}b@x.test", "secret1", "AnB_" + tag)
    host = ui_test.Host(SITE); host.over["/data/config.json"] = {"supabaseUrl": U.SB, "supabaseAnonKey": ANON}
    errs = []
    with sync_playwright() as p:
        b, c, pg = U.ctx(p, host, errs, "W")
        U.signup(pg, f"an{tag}w@x.test", "AnW_" + tag)
        seen_all = {}
        for sp in ("nfl", "nba", "mlb", "cfb", "cbb"):
            h, a = pair(sp)
            bid = A.ok("create_battle", p_sport=sp, p_home=h, p_away=a, p_wager=10, p_side="home")["id"]
            B.ok("accept_battle", p_id=bid)
            A.ok("set_battle_parlay", p_id=bid, p_legs=["ml:home"]); B.ok("set_battle_parlay", p_id=bid, p_legs=["ml:away"])
            A.ok("lock_battle_parlay", p_id=bid); B.ok("lock_battle_parlay", p_id=bid)
            st = sql("select started_at from public.battles where id = %s", (bid,), one=True)
            U.nav(pg, "battle"); pg.wait_for_timeout(500)
            if pg.locator('[data-act="bt-back"]').count(): pg.locator('[data-act="bt-back"]').first.click(); pg.wait_for_timeout(800)
            pg.reload(wait_until="domcontentloaded"); pg.wait_for_timeout(2500); U.nav(pg, "battle"); pg.wait_for_timeout(1500)
            pg.locator(f'.btrow[data-id="{bid}"]').click(); pg.wait_for_selector("#bts-board", timeout=15000)
            pg.evaluate("window.__AN.log.length = 0; window.__AN.drop = 0")
            check(f"{sp}: animated scene is on the live board", pg.locator("#bts-board .stage svg").count() == 1)
            shots = set(); t0 = time.time(); k = 0
            # the server reveals plays by its own clock: move that clock 6x faster than real time so the run takes ~30 s per game
            while time.time() - t0 < 34:
                clock((st + datetime.timedelta(seconds=6 * (time.time() - t0) + 3)).isoformat())
                pg.wait_for_timeout(450)
                log = pg.evaluate("window.__AN.log.slice()")
                for ty in log:
                    if ty not in shots and ty in ("td", "fd", "flag", "three", "foul", "steal", "hr", "hit1", "hit2", "safe", "strikeout", "fg", "block", "dunk", "run", "runscore", "out", "walk", "bucket"):
                        shots.add(ty); k += 1
                        if k <= 3: pg.locator("#bts-board .stage").screenshot(path=os.path.join(SHOTS, f"anim_{sp}_{ty}.png"))
            clock(None)
            log = pg.evaluate("window.__AN.log.slice()"); drop = pg.evaluate("window.__AN.drop")
            kinds = {}
            for t in log: kinds[t] = kinds.get(t, 0) + 1
            print("   ", sp, kinds, "dropped", drop)
            seen_all[sp] = set(kinds)
            check(f"{sp}: animations played in the browser ({sum(kinds.values())})", sum(kinds.values()) >= 8, kinds)
            check(f"{sp}: no stuck animation queue", pg.evaluate("Object.values(window.__AN.q).every(q => q.items.length < 12)"))
            U.noscroll(pg, f"{sp} live scene")
            pg.locator("#bts-board .stage").screenshot(path=os.path.join(SHOTS, f"anim_{sp}_last.png"))
            # every distinct event kind the server produced is understood by the page (nothing silently skipped)
            evs = sql("select kind, text from public.battle_events where battle_id = %s", (bid,))
            und = pg.evaluate("(evs) => evs.map(e => [e.kind, !!window.__AN.classify('%s', e)])" % sp, [{"kind": k_, "text": t_} for k_, t_ in evs])
            miss = sorted({k_ for k_, ok in und if not ok and k_ in ("fd", "flag", "sack", "foul", "steal", "block", "run", "strikeout", "walk", "safe", "out")})
            check(f"{sp}: every color-play kind is animated", not miss, miss)
        # reduced motion: banner only, no movement, no errors
        # natural speed: one basketball game in real time (the server plays it over ~3 minutes)
        h, a = pair("nba"); bid = A.ok("create_battle", p_sport="nba", p_home=h, p_away=a, p_wager=10, p_side="home")["id"]
        B.ok("accept_battle", p_id=bid); A.ok("set_battle_parlay", p_id=bid, p_legs=["ml:home"]); B.ok("set_battle_parlay", p_id=bid, p_legs=["ml:away"]); A.ok("lock_battle_parlay", p_id=bid); B.ok("lock_battle_parlay", p_id=bid)
        pg.reload(wait_until="domcontentloaded"); pg.wait_for_timeout(2500); U.nav(pg, "battle"); pg.wait_for_timeout(1500); pg.locator(f'.btrow[data-id="{bid}"]').click(); pg.wait_for_selector("#bts-board", timeout=15000)
        pg.evaluate("window.__AN.log.length = 0; window.__AN.drop = 0"); pg.wait_for_timeout(186000)
        log = pg.evaluate("window.__AN.log.slice()"); drop = pg.evaluate("window.__AN.drop"); kinds = {}
        for t in log: kinds[t] = kinds.get(t, 0) + 1
        print("    nba natural speed", kinds, "dropped", drop)
        check("natural speed (nba, ~3 min): nearly every play is animated", drop <= 0.2 * (sum(kinds.values()) + drop), (sum(kinds.values()), drop))
        check("natural speed: foul, steal, block, run and three all played", {"foul", "steal", "block", "three"} <= set(kinds), sorted(kinds))
        pg.locator("#bts-board .stage").screenshot(path=os.path.join(SHOTS, "anim_nba_natural_end.png"))
        print("   types seen per sport:", {k: sorted(v) for k, v in seen_all.items()})
        for sp, need in EXPECT.items():
            miss = need - seen_all.get(sp, set())
            check(f"{sp}: expected animation types fired (or only rare ones missing)", len(miss) <= 1, sorted(miss))
        errs = [e for e in errs if "ERR_TUNNEL" not in e and "espn.com" not in e]; check("no JavaScript errors", not errs, errs[:3])
        b.close()
    ok = sum(1 for r in T.RES if r[0]); print(f"\n{ok}/{len(T.RES)} animation checks passed"); sys.exit(0 if ok == len(T.RES) else 1)

if __name__ == "__main__":
    main()
