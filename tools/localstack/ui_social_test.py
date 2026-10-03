#!/usr/bin/env python3
"""Browser end-to-end test of accounts, server bets, chat, battles, leaderboard, badges and profiles.
Three browser contexts (three players) at 400 px against the local Supabase stand-in (up.sh): PostgREST + auth mock behind
https://sb.test (routed by Playwright to the local gateway), the site served from https://linescout.test.
usage: python ui_social_test.py <site_dir> <screenshot_dir>"""
import os, sys, json, time, uuid, datetime, urllib.request
import requests
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(sys.argv[1]); SHOTS = os.path.abspath(sys.argv[2]); os.makedirs(SHOTS, exist_ok=True)
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(SITE, "tools")); sys.path.insert(0, os.path.join(SITE, "engine"))
from gateway import ANON, SERVICE
from api_test import sql, clock, check, RES, Client, BASE
import ui_test
from playwright.sync_api import sync_playwright
SB = "https://sb.test"
SBJS = os.path.join(HERE, "supabase.js")

def sb_route(route):
    req = route.request; path = req.url[len(SB):]
    if req.method == "OPTIONS":
        return route.fulfill(status=204, headers={"access-control-allow-origin": ui_test.ORIGIN, "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
                                                  "access-control-allow-headers": req.headers.get("access-control-request-headers", "*"), "access-control-allow-credentials": "true"})
    if path.startswith("/realtime/"):
        return route.abort()                       # no realtime server locally: the page must fall back to polling
    h = {k: v for k, v in req.headers.items() if k.lower() in ("apikey", "authorization", "content-type", "prefer", "accept", "range", "x-client-info", "accept-profile", "content-profile")}
    r = requests.request(req.method, BASE + path, headers=h, data=req.post_data_buffer, timeout=30)
    hdr = {"content-type": r.headers.get("content-type", "application/json"), "access-control-allow-origin": ui_test.ORIGIN, "access-control-allow-credentials": "true",
           "access-control-expose-headers": "content-range"}
    if r.headers.get("content-range"): hdr["content-range"] = r.headers["content-range"]
    route.fulfill(status=r.status_code, body=r.content, headers=hdr)

def ctx(p, host, errs, name):
    b, c = ui_test.browser(p, host)
    c.route(SB + "/**", sb_route)
    c.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js", lambda r: r.fulfill(status=200, body=open(SBJS, "rb").read(), headers={"content-type": "application/javascript", "access-control-allow-origin": "*"}))
    pg = c.new_page()
    pg.on("console", lambda m: errs.append(name + " " + m.type + ": " + m.text[:200]) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(name + " PAGEERROR " + str(e)[:300]))
    pg.goto(ui_test.ORIGIN + "/"); pg.wait_for_timeout(2500)
    return b, c, pg

def nav(pg, k):
    pg.locator(f'#nav button[data-k="{k}"]').click(); pg.wait_for_timeout(700)
def noscroll(pg, what):
    w = pg.evaluate("document.documentElement.scrollWidth"); check(f"no horizontal scroll at 400px ({what})", w <= 400, w)
def shot(pg, name):
    pg.screenshot(path=os.path.join(SHOTS, name)); print("   shot", name)

def signup(pg, email, name):
    pg.locator('#hdr [data-act="signin"]').click(); pg.wait_for_selector("#socmodal")
    pg.locator('[data-act="su-tab"][data-k="up"]').click()
    pg.fill("#su-email", email); pg.fill("#su-pass", "secret12"); pg.fill("#su-name", name)
    pg.wait_for_timeout(600)
    vals = (pg.input_value("#su-email"), pg.input_value("#su-pass"), pg.input_value("#su-name"))
    if vals != (email, "secret12", name):
        print("SIGNUP DEBUG: form was redrawn while typing", vals)
        pg.fill("#su-email", email); pg.fill("#su-pass", "secret12"); pg.fill("#su-name", name); pg.wait_for_timeout(600)
    pg.locator('[data-act="su-up"]').click()
    try:
        pg.wait_for_function("document.getElementById('bankchip') && /1,000/.test(document.getElementById('bankchip').textContent)", timeout=15000)
    except Exception:
        print("SIGNUP DEBUG", name, pg.locator("#su-msg").all_inner_texts(), pg.inner_text("#hdr")[:80]); raise

def main():
    clock(None)
    tag = uuid.uuid4().hex[:4]
    names = {"A": "Ace_" + tag, "B": "Bea_" + tag, "C": "Cal_" + tag}
    slate = json.load(open(os.path.join(SITE, "data", "slate.json")))
    import social
    rows = social.game_rows(slate["games"])
    r = requests.post(f"{BASE}/rest/v1/games?on_conflict=gid", headers={"apikey": ANON, "Authorization": "Bearer " + SERVICE, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}, data=json.dumps(rows))
    check("bot-style upload of the slate's games", r.status_code < 300, r.text[:200])
    now = datetime.datetime.now(datetime.timezone.utc)
    fut = [g for g in slate["games"] if datetime.datetime.fromisoformat(g["iso"].replace("Z", "+00:00")) > now + datetime.timedelta(hours=2) and g["lines"].get("mlHome")]
    host = ui_test.Host(SITE); host.over["/data/config.json"] = {"supabaseUrl": SB, "supabaseAnonKey": ANON}
    errs = []
    with sync_playwright() as p:
        bA, cA, A = ctx(p, host, errs, "A"); bB, cB, B = ctx(p, host, errs, "B"); bC, cC, C = ctx(p, host, errs, "C")
        # ---------------------------------------------------------------- signed out
        hdr = A.inner_text("#hdr")
        check("signed out: header shows Sign in and no money", A.locator('#hdr [data-act="signin"]').count() == 1 and "$" not in hdr and "🪙" not in hdr, hdr[:80].replace("\n", " "))
        shot(A, "01_signed_out_header.png")
        nav(C, "board"); C.wait_for_timeout(1200)
        check("signed out: the leaderboard is browsable", "top 10 winners" in C.inner_text("#app").lower())
        nav(C, "chat"); check("signed out: chat asks to sign in", "signed-in players" in C.inner_text("#app"))
        nav(C, "battle"); C.wait_for_timeout(1500)
        check("signed out: battle lobby is browsable", "start a battle" in C.inner_text("#app").lower() and "sign in to battle" in C.inner_text("#app").lower())
        nav(C, "pre")
        if fut:
            gid = fut[0]["id"]
            C.locator(f"#game-{gid} button[data-act=leg]").first.click(); C.wait_for_timeout(300)
            C.locator("#slip button[data-act=slip]").first.click(); C.wait_for_timeout(300)
            check("signed out: the slip button says 'Sign in to bet'", "Sign in to bet" in C.inner_text("#slip"))
            C.locator("#slip button[data-act=clear]").first.click()
        # ---------------------------------------------------------------- sign up x3
        signup(A, f"ace{tag}@x.test", names["A"]); signup(B, f"bea{tag}@x.test", names["B"]); signup(C, f"cal{tag}@x.test", names["C"])
        check("signed in: header shows the coin balance (1,000)", "1,000" in A.inner_text("#hdr") and A.locator('#hdr [data-act="signin"]').count() == 0)
        shot(A, "02_signed_in_header.png")
        uid = {k: sql("select id from public.profiles where username = %s", (v,), one=True) for k, v in names.items()}
        check("profiles created for all three players", all(uid.values()), uid)
        A.reload(); A.wait_for_timeout(3000)
        check("session persists after a reload", "1,000" in A.inner_text("#hdr"))
        # ---------------------------------------------------------------- real-game practice bet (server)
        gid = fut[0]["id"] if fut else None
        if gid:
            nav(A, "pre")
            A.locator(f"#game-{gid} button[data-act=leg]").first.click(); A.wait_for_timeout(300)
            A.locator("#slip button[data-act=slip]").first.click(); A.wait_for_timeout(300)
            stk = A.locator('#slip input[data-in="stake"]'); stk.fill("10"); A.wait_for_timeout(200)
            A.locator("#slip button[data-act=place]").first.click()
            A.wait_for_function("/990/.test(document.getElementById('bankchip').textContent)", timeout=15000)
            check("server bet placed: header balance 1,000 -> 990", "990" in A.inner_text("#hdr"))
            nav(A, "slips"); A.wait_for_timeout(1500)
            t = A.inner_text("#app").lower(); check("My bets lists the server bet as Pending", "pending" in t and "your coins" in t, t[:120])
            shot(A, "03_my_bets.png")
            leg = sql("select l.spec, l.bet_id from public.bet_legs l join public.bets b on b.id = l.bet_id where b.user_id = %s", (uid["A"],))[0]
            sp = leg[0]; fin = {"gid": str(gid), "home": 30, "away": 10, "played": {}, "stat": {}}
            if sp["k"] == "ml" and sp["side"] == "away" or sp["k"] == "spr" and sp["side"] == "away": fin.update(home=10, away=30)
            if sp["k"] == "tot": fin.update(home=200 if sp["dir"] == "over" else 0, away=0)
            clock((datetime.datetime.fromisoformat(fut[0]["iso"].replace("Z", "+00:00")) + datetime.timedelta(hours=4)).isoformat())
            out = Client(SERVICE).ok("bot_settle_games", p=[fin]); clock(None)
            A.reload(); A.wait_for_timeout(3000); nav(A, "slips"); A.wait_for_timeout(1500)
            check("after the bot settles it, My bets shows Won and the coins are back", "Won" in A.inner_text("#app") and float(sql("select balance from public.profiles where id = %s", (uid["A"],), one=True)) > 1000, out)
        # ---------------------------------------------------------------- chat + mentions (polling fallback)
        nav(A, "chat"); A.wait_for_timeout(1500)
        check("chat falls back to polling when realtime is unavailable", "updates every 4 s" in A.inner_text("#app"), A.inner_text("#app")[:80])
        A.locator("#chatin").click(); A.locator("#chatin").type("hello @" + names["B"][:3], delay=40); A.wait_for_timeout(1200)
        sug = A.locator("#chatsugg .sg").all_inner_texts()
        check("@mention autocomplete suggests usernames while typing", any(names["B"] in s for s in sug), sug)
        A.locator("#chatsugg .sg", has_text=names["B"]).first.click(); A.locator("#chatin").type("good luck <b>today</b>", delay=10)
        A.locator('[data-act="chat-send"]').click(); A.wait_for_timeout(2500)
        check("message shows in the sender's chat with the @mention highlighted", A.locator(".chatbox .msg.mine .mention").count() >= 1)
        check("HTML in a message is shown as text (escaped)", A.locator(".chatbox .msg.mine b").count() == 0 and "<b>today</b>" in A.inner_text("#chatbox"))
        B.reload(); B.wait_for_timeout(3500)
        bnav = B.inner_text("#nav"); check("mentioned user sees an @ badge on Chat", "@1" in bnav, bnav.replace("\n", " "))
        nav(B, "chat"); B.wait_for_timeout(2500)
        check("mentioned user sees the message marked 'mentioned you'", B.locator(".chatbox .msg.atme").count() >= 1 and B.locator(".menbar").count() == 1)
        B.locator("#chatin").fill("thanks @" + names["A"]); B.locator('[data-act="chat-send"]').click(); B.wait_for_timeout(5000)
        check("other player's message arrives by polling", names["B"] in A.inner_text("#chatbox"))
        shot(B, "04_chat.png")
        noscroll(B, "chat")
        A.locator('.chatbox .msg.mine [data-act="chat-del"]').first.click(); A.wait_for_timeout(1500)
        check("delete own message", "message deleted" in A.inner_text("#chatbox"))
        # ---------------------------------------------------------------- battle
        nav(A, "battle"); A.wait_for_timeout(2500)
        A.locator('[data-act="bt-sport"][data-k="nfl"]').click()
        A.select_option('select[data-bt="away"]', "BUF"); A.select_option('select[data-bt="home"]', "KC"); A.wait_for_timeout(300)
        A.locator('[data-act="bt-side"][data-k="home"]').click(); A.locator('input[data-bt="wager"]').fill("100")
        A.locator('[data-act="bt-create"]').click(); A.wait_for_selector("#bts-head", timeout=15000); A.wait_for_timeout(1500)
        bid = sql("select max(id) from public.battles where creator = %s", (uid["A"],), one=True)
        check("battle created, wager escrowed", bid and "Waiting for someone to accept" in A.inner_text("#app"), A.inner_text("#app")[:120])
        shot(A, "05_battle_open.png")
        nav(B, "battle"); B.wait_for_timeout(2500)
        B.locator(f'.btrow[data-id="{bid}"]').click(); B.wait_for_timeout(2500)
        B.locator('[data-act="bt-accept"]').first.click(); B.wait_for_timeout(2500)
        check("second player accepts (status building)", sql("select status from public.battles where id = %s", (bid,), one=True) == "building")
        nav(C, "battle"); C.wait_for_timeout(2000); C.locator(f'.btrow[data-id="{bid}"]').click(); C.wait_for_timeout(2500)
        for tok in ("ml:home", "spr:away", "tot:over", "win:creator"):
            C.locator(f'#bts-spec [data-act="bt-spec"][data-tok="{tok}"]').first.click(); C.wait_for_timeout(250)
            C.locator('input[data-bt="spstake"]').fill("20"); C.locator('[data-act="bt-specbet"]').click(); C.wait_for_timeout(1500)
        nsp = sql("select count(*) from public.spectator_bets where battle_id = %s and user_id = %s", (bid, uid["C"]), one=True)
        check("spectator placed ML, spread, total and battle-winner bets", nsp == 4, nsp)
        shot(C, "06_battle_spectator.png")
        props = sql("select markets->'props' from public.battles where id = %s", (bid,), one=True)
        A.wait_for_timeout(3000)
        for tok in ("ml:home", f"p:{props[0]['pid']}:{props[0]['stat']}:over"):
            A.locator(f'#bts-mk [data-act="bt-leg"][data-tok="{tok}"]').click(); A.wait_for_timeout(700)
        B.wait_for_timeout(1500)
        for tok in ("ml:away", "tot:under"):
            B.locator(f'#bts-mk [data-act="bt-leg"][data-tok="{tok}"]').click(); B.wait_for_timeout(700)
        A.wait_for_timeout(800); A.locator('[data-act="bt-lock"]').click(); A.wait_for_timeout(2000)
        check("players cannot see each other's parlay before the start", sql("select count(*) from public.battle_parlays where battle_id = %s and jsonb_array_length(legs) > 0", (bid,), one=True) == 2 and props[0]["pid"] not in B.inner_text("#app"))
        B.wait_for_timeout(800); B.locator('[data-act="bt-lock"]').click(); B.wait_for_timeout(2500)
        check("both locked: the simulation starts", sql("select status from public.battles where id = %s", (bid,), one=True) == "live")
        A.wait_for_timeout(9000)
        nfeed = A.locator("#bts-feed .fe").count(); ntot = sql("select count(*) from public.battle_events where battle_id = %s", (bid,), one=True)
        check("live: scoreboard + play-by-play shown, future plays not delivered", A.locator("#bts-board .score").count() == 1 and 1 <= nfeed < ntot, (nfeed, ntot))
        shot(A, "07_battle_live.png"); noscroll(A, "battle live")
        C.wait_for_timeout(6000); n2 = C.locator("#bts-feed .fe").count()
        check("plays keep arriving for a spectator", n2 > nfeed - 1, (nfeed, n2))
        started = sql("select started_at from public.battles where id = %s", (bid,), one=True)
        clock((started + datetime.timedelta(seconds=182)).isoformat())
        A.wait_for_timeout(6000)
        st = sql("select status, winner, result from public.battles where id = %s", (bid,))[0]
        check("battle settled (lazily by the watching page)", st[0] == "final", st)
        check("winner banner shown", A.locator("#bts-board .winbar").count() == 1, A.inner_text("#bts-board")[:200] if A.locator("#bts-board").count() else "")
        shot(A, "08_battle_final.png")
        rec = {k: sql("select w, l, t from public.battle_stats where user_id = %s and sport = 'nfl'", (uid[k],)) for k in "ABC"}
        check("battle record updated for the two players only (spectator has none)", rec["A"] and rec["B"] and sum(rec["A"][0]) == 1 and not rec["C"], rec)
        sps = sql("select status from public.spectator_bets where battle_id = %s", (bid,))
        check("spectator bets settled", all(s[0] in ("won", "lost", "void") for s in sps), sps)
        clock(None)
        # ---------------------------------------------------------------- leaderboard + profile
        A.reload(); A.wait_for_timeout(3000); nav(A, "board"); A.wait_for_timeout(2500)
        t = A.inner_text("#app"); check("daily leaderboard shows today's standings with usernames", any(n in t for n in names.values()), t[:200])
        shot(A, "09_leaderboard.png"); noscroll(A, "leaderboard")
        today = sql("select ls_private.today()", one=True)
        sql("update public.daily_stats set net = net + 100000 where day = %s and user_id = %s", (today, uid["A"]))
        sql("insert into public.daily_stats(day, user_id, net) values (%s, %s, 50) on conflict (day, user_id) do update set net = 50", (today - datetime.timedelta(days=1), uid["A"]))
        sql("delete from public.finalized_days where day >= %s", (today - datetime.timedelta(days=1),))
        sql("delete from public.badges where day >= %s", (today - datetime.timedelta(days=1),))
        clock(f"{datetime.datetime.combine(today + datetime.timedelta(days=1), datetime.time(0, 5)).isoformat()} America/New_York")
        A.reload(); A.wait_for_timeout(3500); nav(A, "board"); A.wait_for_timeout(2500)
        t = A.inner_text("#app"); check("after midnight ET: yesterday's champion is shown, board reset", "yesterday" in t.lower() and names["A"] in t and "no winners yet today" in t.lower(), t[:300])
        A.locator('#hdr [data-act="profile"]').click(); A.wait_for_timeout(2500)
        t = A.inner_text("#app")
        tl = t.lower(); check("profile: username, coins, today/all-time net, badges with count, battle record, slips", names["A"] in t and "all-time net" in tl and "champion" in tl and "×2" in t and "nfl battles" in tl and "slips" in tl, t[:400])
        shot(A, "10_profile.png"); noscroll(A, "profile")
        clock(None)
        B.locator('#hdr [data-act="profile"]').click(); B.wait_for_timeout(2000)
        B.locator('[data-act="signout"]').click(); B.wait_for_timeout(1500)
        check("sign out returns to the Sign in button", B.locator('#hdr [data-act="signin"]').count() == 1)
        real = [e for e in errs if "PAGEERROR" in e]
        check("no JavaScript errors in the three sessions", not real, real[:3])
        other = [e for e in errs if "PAGEERROR" not in e and "Failed to load resource" not in e and "realtime" not in e.lower() and "websocket" not in e.lower()]
        print("console errors (non-fatal):", other[:6])
        for b in (bA, bB, bC): b.close()
    bad = [r for r in RES if not r[0]]
    print(f"\n{len(RES) - len(bad)}/{len(RES)} social browser checks passed")
    return 1 if bad else 0

if __name__ == "__main__":
    try: sys.exit(main())
    finally: clock(None)
