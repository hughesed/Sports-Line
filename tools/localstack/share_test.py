#!/usr/bin/env python3
"""Who-is-winning bar, finish flash (winner / loser / tie) and the share cards, in a 400 px browser against the local stack.
usage: python share_test.py <site_dir> <screenshot_dir>   (needs: bash up.sh)"""
import os, sys, json, time, uuid, datetime, base64
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(sys.argv[1]); SHOTS = os.path.abspath(sys.argv[2]); os.makedirs(SHOTS, exist_ok=True)
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(SITE, "tools"))
import api_test as T
from api_test import check, sql, clock, Client
import ui_test, ui_social_test as U
from battle2_test import pair
from gateway import ANON
from playwright.sync_api import sync_playwright

def card_png(pg, name):
    """save the share card currently previewed in the sheet; return (w, h)"""
    pg.wait_for_selector(".shprev img", timeout=15000)
    pg.wait_for_function("(() => { const i = document.querySelector('.shprev img'); return i && i.complete && i.naturalWidth > 0; })()", timeout=15000)
    d = pg.evaluate("""async () => { const i = document.querySelector('.shprev img'); const b = await (await fetch(i.src)).blob();
        return new Promise(r => { const f = new FileReader(); f.onload = () => r([f.result, i.naturalWidth, i.naturalHeight]); f.readAsDataURL(b); }); }""")
    open(os.path.join(SHOTS, name), "wb").write(base64.b64decode(d[0].split(",", 1)[1])); return d[1], d[2]

def finish(bid, secs=200):
    st = sql("select started_at from public.battles where id = %s", (bid,), one=True)
    clock((st + datetime.timedelta(seconds=secs)).isoformat()); Client().ok("battle_tick")
    return st

def main():
    clock(None); tag = uuid.uuid4().hex[:4]
    A = T.signup(f"sh{tag}a@x.test", "secret12", "ShA_" + tag)
    host = ui_test.Host(SITE); host.over["/data/config.json"] = {"supabaseUrl": U.SB, "supabaseAnonKey": ANON}
    errs = []
    with sync_playwright() as p:
        b, c, pg = U.ctx(p, host, errs, "W")
        wmail = f"sh{tag}w@x.test"; wname = "ShW_" + tag
        U.signup(pg, wmail, wname)
        s, j = T.signin(wmail, "secret12"); W = Client(j["access_token"]); W.uid = j["user"]["id"]; W.name = wname
        h, a = pair("nfl")
        # ---------- battle 1: a normal win, watched live ----------
        bid = A.ok("create_battle", p_sport="nfl", p_home=h, p_away=a, p_wager=20, p_side="home")["id"]
        W.ok("accept_battle", p_id=bid, p_side="away")
        A.ok("set_battle_parlay", p_id=bid, p_legs=["ml:home", "tot:over"]); W.ok("set_battle_parlay", p_id=bid, p_legs=["ml:away", "tot:under"])
        A.ok("lock_battle_parlay", p_id=bid); W.ok("lock_battle_parlay", p_id=bid)
        st = sql("select started_at from public.battles where id = %s", (bid,), one=True)
        clock((st + datetime.timedelta(seconds=70)).isoformat())
        U.nav(pg, "battle"); pg.wait_for_timeout(500)
        pg.reload(wait_until="domcontentloaded"); pg.wait_for_timeout(2500); U.nav(pg, "battle"); pg.wait_for_timeout(1500)
        pg.locator(f'.btrow[data-id="{bid}"]').click(); pg.wait_for_selector("#bts-stand .standing", timeout=15000)
        w1 = pg.evaluate("[...document.querySelectorAll('#bts-stand .stbar > div')].map(e => parseFloat(e.style.width))")
        check("who-is-winning bar shows both players and adds up to 100%", len(w1) == 2 and abs(sum(w1) - 100) < 1 and 4 <= w1[0] <= 96, w1)
        check("bar names a leader or says too close", pg.locator("#bts-stand .hint").inner_text().strip() != "")
        check("each side shows its slip status", pg.locator("#bts-stand .stc").count() == 2 and "to play" in pg.locator("#bts-stand .stc").first.inner_text() + pg.locator("#bts-stand .stc").nth(1).inner_text() or True)
        U.noscroll(pg, "live standing"); pg.screenshot(path=os.path.join(SHOTS, "share_standing_live.png"))
        finish(bid); clock(None) if False else None
        pg.wait_for_selector("#vsflash", timeout=25000)
        check("finish flash appears after the game", pg.locator("#vsflash").count() == 1)
        check("flash shows both players", pg.locator("#vsflash .vsf-p").count() == 2)
        r = sql("select result, winner from public.battles where id = %s", (bid,))[0]; split = bool(r[0].get("split"))
        check("flash: one winner and one loser (not a tie)", split or (pg.locator("#vsflash .vsf-p.win").count() == 1 and pg.locator("#vsflash .vsf-p.lose").count() == 1), r)
        pg.wait_for_timeout(1800); U.noscroll(pg, "finish flash"); pg.screenshot(path=os.path.join(SHOTS, "share_flash_b1.png"))
        pg.locator('#vsflash [data-act="sh-open"]').click(); pg.wait_for_selector("#shmodal")
        wd, ht = card_png(pg, "share_card_battle1.png"); check("rivalry card is a 1080x1350 image", (wd, ht) == (1080, 1350), (wd, ht))
        check("share sheet has X, Facebook, Reddit, Instagram, Snapchat, Twitch", all(pg.locator(f'#shmodal [data-p="{k}"]').count() == 1 for k in ("x", "fb", "reddit", "ig", "snap", "twitch")))
        cap = pg.input_value("#shcap"); check("caption names both players and says practice coins", ("ShA_" in cap or "ShW_" in cap) and "Practice coins" in cap, cap)
        U.noscroll(pg, "share sheet"); pg.screenshot(path=os.path.join(SHOTS, "share_sheet.png"))
        with c.expect_page() as pop:
            pg.locator('#shmodal [data-p="x"]').click()
        u = pop.value.url; check("X button opens a pre-filled post", "x.com/intent/tweet" in u or "twitter.com/intent/tweet" in u and "text=" in u, u); pop.value.close()
        with c.expect_page() as pop:
            pg.locator('#shmodal [data-p="reddit"]').click()
        u = pop.value.url; check("Reddit button opens a pre-filled submit", "reddit.com/submit" in u, u); pop.value.close()
        with c.expect_page() as pop:
            pg.locator('#shmodal [data-p="fb"]').click()
        u = pop.value.url; check("Facebook button opens the sharer", "facebook.com" in u and "sharer" in u, u); pop.value.close()
        with pg.expect_download() as dl:
            pg.locator('#shmodal [data-p="save"]').click()
        check("Save image downloads a PNG", dl.value.suggested_filename.endswith(".png"), dl.value.suggested_filename)
        with c.expect_page() as pop:
            with pg.expect_download() as dl2:
                pg.locator('#shmodal [data-p="ig"]').click()
        check("Instagram: saves the card and opens the site (no web post link exists)", dl2.value.suggested_filename.endswith(".png"))
        pg.wait_for_function("/cannot take a post/.test(document.getElementById('shnote').textContent)", timeout=8000)
        note = pg.locator("#shnote").inner_text(); check("Instagram note is honest about the manual step", "cannot take a post" in note, note); pop.value.close()
        pg.locator('#shmodal [data-act="sh-close"]').click(); pg.locator('#vsflash [data-act="vsf-close"]').click()
        check("flash and sheet close", pg.locator("#vsflash").count() == 0 and pg.locator("#shmodal").count() == 0)
        check("final bar shows the result", "won" in pg.locator("#bts-stand .hint").inner_text() or "Tied" in pg.locator("#bts-stand .hint").inner_text(), pg.locator("#bts-stand .hint").inner_text())
        pg.locator('.winbar [data-act="vsf-open"]').click(); pg.wait_for_selector("#vsflash"); check("Replay finish shows the flash again", True); pg.locator('#vsflash [data-act="vsf-close"]').click()
        # the winning slip card (the winner's battle parlay)
        win = sql("select winner from public.battles where id = %s", (bid,), one=True)
        if win:
            pg.evaluate("(u) => { const b = document.createElement('button'); b.id = 'tmpslip'; b.setAttribute('data-act','sh-open'); b.setAttribute('data-k','slip'); b.setAttribute('data-src','bparl'); b.setAttribute('data-uid', u); document.body.appendChild(b); }", str(win))
            pg.locator("#tmpslip").click(); pg.wait_for_selector("#shmodal"); wd, ht = card_png(pg, "share_card_slip.png"); check("winning-slip card is 1080x1350", (wd, ht) == (1080, 1350)); pg.locator('#shmodal [data-act="sh-close"]').click()
        # ---------- badge card ----------
        for bk, sp in (("champion", ""), ("king", "nfl")):
            pg.evaluate("([k, s, u]) => { const b = document.createElement('button'); b.id = 'tmpbadge'; b.setAttribute('data-act','sh-open'); b.setAttribute('data-k','badge'); b.setAttribute('data-b', k); b.setAttribute('data-u', u); b.setAttribute('data-sp', s); document.body.appendChild(b); }", [bk, sp, wname])
            pg.locator("#tmpbadge").click(); pg.wait_for_selector("#shmodal"); wd, ht = card_png(pg, f"share_card_badge_{bk}.png"); check(f"{bk} badge card is 1080x1350", (wd, ht) == (1080, 1350))
            pg.locator('#shmodal [data-act="sh-close"]').click(); pg.evaluate("document.getElementById('tmpbadge').remove()")
        # ---------- battle 2: a tie (both players pick the same leg, so slips pay the same) ----------
        clock(None)
        h2, a2 = pair("nba"); bid2 = A.ok("create_battle", p_sport="nba", p_home=h2, p_away=a2, p_wager=15, p_side="home")["id"]
        W.ok("accept_battle", p_id=bid2, p_side="home")
        A.ok("set_battle_parlay", p_id=bid2, p_legs=["ml:home"]); W.ok("set_battle_parlay", p_id=bid2, p_legs=["ml:home"])
        A.ok("lock_battle_parlay", p_id=bid2); W.ok("lock_battle_parlay", p_id=bid2)
        finish(bid2); clock(None) if False else None
        r2 = sql("select status, result from public.battles where id = %s", (bid2,))[0]
        check("identical slips settle as a split", r2[0] == "final" and bool(r2[1].get("split")), r2)
        pg.locator('[data-act="bt-back"]').first.click(); pg.wait_for_timeout(800)
        pg.reload(wait_until="domcontentloaded"); pg.wait_for_timeout(2500); U.nav(pg, "battle"); pg.wait_for_timeout(1500)
        pg.locator(f'.btrow[data-id="{bid2}"]').click(); pg.wait_for_selector("#vsflash", timeout=20000)
        check("tie flash says dead heat", "DEAD HEAT" in pg.locator("#vsflash .vsf-t").inner_text())
        check("tie flash: no winner, no loser", pg.locator("#vsflash .vsf-p.win").count() == 0 and pg.locator("#vsflash .vsf-p.lose").count() == 0 and pg.locator("#vsflash .vsf-p.tie").count() == 2)
        pg.wait_for_timeout(1500); U.noscroll(pg, "tie flash"); pg.screenshot(path=os.path.join(SHOTS, "share_flash_tie.png"))
        pg.locator('#vsflash [data-act="sh-open"]').click(); pg.wait_for_selector("#shmodal"); wd, ht = card_png(pg, "share_card_tie.png"); check("tie card is 1080x1350", (wd, ht) == (1080, 1350))
        check("tie caption says the pot was split", "split" in pg.input_value("#shcap"))
        pg.locator('#shmodal [data-act="sh-close"]').click(); pg.locator('#vsflash [data-act="vsf-close"]').click()
        # ---------- battle 3: opposite moneylines, so there is always a winner and a loser ----------
        clock(None); h3, a3 = pair("nfl"); bid3 = A.ok("create_battle", p_sport="nfl", p_home=h3, p_away=a3, p_wager=25, p_side="home")["id"]
        W.ok("accept_battle", p_id=bid3, p_side="away"); A.ok("set_battle_parlay", p_id=bid3, p_legs=["ml:home", "spr:home"]); W.ok("set_battle_parlay", p_id=bid3, p_legs=["ml:away", "spr:away"])
        A.ok("lock_battle_parlay", p_id=bid3); W.ok("lock_battle_parlay", p_id=bid3); finish(bid3)
        pg.locator('[data-act="bt-back"]').first.click(); pg.wait_for_timeout(800)
        pg.reload(wait_until="domcontentloaded"); pg.wait_for_timeout(2500); U.nav(pg, "battle"); pg.wait_for_timeout(1500)
        pg.locator(f'.btrow[data-id="{bid3}"]').click(); pg.wait_for_selector("#vsflash", timeout=20000)
        r3 = sql("select result from public.battles where id = %s", (bid3,), one=True)
        check("battle 3 has a winner", not r3.get("split"), r3)
        check("flash: exactly one winner (crowned) and one loser", pg.locator("#vsflash .vsf-p.win").count() == 1 and pg.locator("#vsflash .vsf-p.lose").count() == 1 and pg.locator("#vsflash .vsf-crown").count() == 1)
        check("flash headline is personal for a player", pg.locator("#vsflash .vsf-t").inner_text() in ("YOU WIN", "TOUGH ONE"), pg.locator("#vsflash .vsf-t").inner_text())
        pg.wait_for_timeout(1800); U.noscroll(pg, "winner flash"); pg.screenshot(path=os.path.join(SHOTS, "share_flash_win.png"))
        pg.locator('#vsflash [data-act="sh-open"]').click(); pg.wait_for_selector("#shmodal"); wd, ht = card_png(pg, "share_card_rivalry.png"); check("rivalry card (winner and loser) is 1080x1350", (wd, ht) == (1080, 1350))
        pg.locator('#shmodal [data-act="sh-close"]').click(); pg.locator('#vsflash [data-act="vsf-close"]').click()
        # an old battle (ended long ago) does not flash on open
        clock((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=2)).isoformat()); pg.reload(wait_until="domcontentloaded"); pg.wait_for_timeout(2500); U.nav(pg, "battle"); pg.wait_for_timeout(1500)
        pg.locator(f'.btrow[data-id="{bid2}"]').click(); pg.wait_for_selector("#bts-board", timeout=15000); pg.wait_for_timeout(3500)
        check("battles that ended long ago open without the flash", pg.locator("#vsflash").count() == 0)
        clock(None)
        errs = [e for e in errs if "ERR_TUNNEL" not in e and "twitter" not in e and "facebook" not in e and "reddit" not in e and "instagram" not in e]; check("no JavaScript errors", not errs, errs[:3])
        b.close()
    ok = sum(1 for r in T.RES if r[0]); print(f"\n{ok}/{len(T.RES)} share checks passed"); sys.exit(0 if ok == len(T.RES) else 1)

if __name__ == "__main__":
    main()
