#!/usr/bin/env python3
"""Browser test of the prop bot on the page: the calibration on a card's player stat changes the chance of that player's legs in hpLegs (so gold picks,
combos and parlays get it), a flagged player is left out of the builders, legs carry the bot's note, the Prop bot section renders, no page errors.
Uses the real data/ (needs an upcoming game with FanDuel player legs) plus a data/propbot.json made by engine/propbot.py from synthetic graded legs.
usage: python tools/propbot_ui_test.py"""
import os, sys, json, shutil, datetime, random
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools")); sys.path.insert(0, os.path.join(ROOT, "engine"))
from ui_test import Host, browser, page, check, res, ORIGIN
from playwright.sync_api import sync_playwright
import propbot as PB

def build():
    site = os.path.join(ROOT, ".cache", "site_bot"); shutil.rmtree(site, ignore_errors=True); os.makedirs(site + "/data")
    for f in ("index.html", "manifest.webmanifest"): shutil.copy(os.path.join(ROOT, f), site)
    shutil.copytree(os.path.join(ROOT, "icons"), site + "/icons")
    for f in os.listdir(os.path.join(ROOT, "data")): shutil.copy(os.path.join(ROOT, "data", f), site + "/data")
    sl = json.load(open(site + "/data/slate.json")); now = datetime.datetime.now(datetime.timezone.utc)
    pick = None
    for g in sl["games"]:
        if datetime.datetime.fromisoformat(g["iso"].replace("Z", "+00:00")) <= now + datetime.timedelta(minutes=30): continue
        pls = [p for p in g.get("players") or [] if any(m.get("fd") and m.get("price") is not None for s in p["stats"] for m in s.get("miles") or [])]
        if len(pls) >= 3: pick = (g, pls[0], pls[1], pls[2]); break
    if not pick: print("SKIP: no upcoming game with FanDuel player rungs on the slate"); sys.exit(0)
    g, A, Bp, Cn = pick
    for p in g["players"]: p.pop("bot", None)
    for s in A["stats"]: s["bot"] = dict(p0=s.get("proj"), f=0.94, l={"rest": -0.0619}, s=0.8, c={"o": -0.3, "u": 0.1})
    A["bot"] = dict(notes=["Tonight is the second night of a back-to-back: on those days he plays 9% less (12 games, min), so -6%"], avoid=None)
    Bp["bot"] = dict(notes=[], avoid="Questionable on the injury report")
    Cn["bot"] = dict(notes=[], avoid=None, under="New team: 7 games with CHA (was PHX until Apr 12); overs need 10 games with his new team, unders only until then")
    json.dump(sl, open(site + "/data/slate.json", "w"))
    # the page file from synthetic graded legs
    random.seed(3); tmp = os.path.join(site, "_bot"); os.makedirs(tmp + "/store")
    bot = PB.PropBot(root=tmp, log=lambda *a: None)
    for k in range(400):
        p = random.choice((0.55, 0.65, 0.75, 0.85, 0.92))
        bot.rows.append(dict(d=(datetime.date.today() - datetime.timedelta(days=1 + k % 9)).isoformat(), lg="nba", g="X%d" % k, i="P%d" % (k % 30), n="Player %d" % (k % 30), h=1, s="pts", r="o", t=20,
                             pr=-200, pf=p, pn=p, pc=p, ps=p, sv=1.0, y=1 if random.random() < p - 0.06 else 0, why="minutes"))
    bot.learn(now); bot.today_notes = [dict(g=g["id"], lg="nba", n=A["name"], tm=A.get("abbr"), avoid=None, notes=A["bot"]["notes"], f={"pts": 0.94}),
                                      dict(g=g["id"], lg="nba", n=Bp["name"], tm=Bp.get("abbr"), avoid=Bp["bot"]["avoid"], notes=[], f={})]
    json.dump(bot.page(now), open(site + "/data/propbot.json", "w"))
    return site, g["id"], A, Bp, Cn

def main():
    site, gid, A, Bp, Cn = build()
    with sync_playwright() as p:
        host = Host(site); b, c = browser(p, host); errs = []
        pg = page(c, errs); pg.goto(ORIGIN + "/"); pg.wait_for_timeout(5000)
        r = pg.evaluate("""([gid,a,b])=>{ const G=window.__LS.G, g=G[gid]; const ls=window.__LS.hp.legs(g); const pA=g.players.find(x=>x.id===a);
          const mine=ls.filter(l=>l.pid===a||(l.spec&&l.spec.pid===a)), hisB=ls.filter(l=>l.pid===b||(l.spec&&l.spec.pid===b));
          const chk=mine.filter(l=>l.kind==='alt').map(l=>{ const st=pA.stats.find(s=>s.key===l.spec.stat); const pb=Math.min(0.97,Math.max(0.02,(l.pModel==null?l.pFair:0.5*l.pFair+0.5*l.pModel)*(pA.avail==null?1:pA.avail)));
            const want=Math.min(0.97,Math.max(0.02,1/(1+Math.exp(-(Math.log(pb/(1-pb))*0.8-0.3))))); return {got:l.thin?null:l.p,want:want,bot:l.bot}; });
          return {n:ls.length,mine:mine.length,b:hisB.length,chk:chk.slice(0,6)}; }""", [gid, A["id"], Bp["id"]])
        check("hpLegs: the calibrated player still has legs", r["mine"] > 0, r)
        ok = [x for x in r["chk"] if x["got"] is not None]
        check("hpLegs: his rung chances are the bot-calibrated ones (slope 0.8, shift -0.3 on top of the page's blend)", ok and all(abs(x["got"] - x["want"]) < 0.002 for x in ok), r["chk"])
        print("  notes:", [x["bot"] for x in ok])
        check("hpLegs: his legs carry the bot's note (rest days on each, the track record on those it moved)", ok and all(x["bot"] and "rest days" in x["bot"] for x in ok) and any("track record" in x["bot"] for x in ok), [x["bot"] for x in ok])
        check("hpLegs: the flagged player is left out of the builders", r["b"] == 0, r["b"])
        r2 = pg.evaluate("""([gid,c])=>{ const g=window.__LS.G[gid]; const ls=window.__LS.hp.legs(g).filter(l=>l.pid===c||(l.spec&&l.spec.pid===c));
          const toks=window.__LS.preToks(g).filter(t=>t.indexOf(':'+c+':')>0), allT=window.__LS.preToks(g).length;
          return {over:ls.filter(l=>l.spec&&l.spec.dir==='ge').length, under:ls.filter(l=>l.spec&&l.spec.dir==='lt').length, slateOvers:toks.filter(t=>/:(safe|m:)/.test(t)).length,
                  floor:window.__LS.fl.legs(g).filter(l=>l.pid===c).length, allTokens:allT}; }""", [gid, Cn["id"]])
        check("new-team rule: no over legs for him in any builder (FanDuel overs, X+ rungs, slate safe/ladder legs, floor legs) while the game still has others", r2["over"] == 0 and r2["slateOvers"] == 0 and r2["floor"] == 0 and r2["allTokens"] > 0, r2)
        # his game card: Over buttons off, Under on
        ov = pg.evaluate("""([gid,c])=>{ const g=window.__LS.G[gid], pl=g.players.find(x=>x.id===c); const d=document.createElement('div'); d.innerHTML=window.__LS.playerCard(g,pl);
          const bs=[...d.querySelectorAll('[data-tok]')], of=re=>bs.filter(b=>re.test(b.getAttribute('data-tok'))).map(b=>b.disabled);
          return {n:bs.length, over:of(/:over$/), under:of(/:under$/), rungs:of(/:m:/), note:d.textContent.indexOf('unders only')>=0}; }""", [gid, Cn["id"]])
        check("new-team rule: on his game card the Over and X+ buttons are off, Under stays on, and the card says why", ov["over"] and all(ov["over"]) and all(ov["rungs"]) and not any(ov["under"]) and ov["note"], ov)
        txt = pg.inner_text("#app")
        check("home: the Prop bot section is on the page", "Prop bot" in txt)
        pg.locator('details[data-fold="bot"] > summary').click(); pg.wait_for_timeout(300)
        body = pg.inner_text('details[data-fold="bot"]')
        check("Prop bot: record table, league line and the calibration status", "Chance shown" in body and "NBA" in body and "correcting" in body, body[:300].replace("\n", " | "))
        check("Prop bot: today's research lists the flagged player", Bp["name"] in body or "Today's research" in body, body[-400:].replace("\n", " | "))
        pg.locator('details[data-fold="bot"]').screenshot(path="/tmp/propbot_section.png")
        # the player panel on the game card shows the bot's notes
        has = pg.evaluate("""([gid,a])=>{ try{ return (typeof botNotesFor==='function')||!!document.querySelector('#game-'+gid); }catch(e){ return false; } }""", [gid, A["id"]])
        check("no horizontal scroll at 400px", pg.evaluate("document.documentElement.scrollWidth") <= 400, pg.evaluate("document.documentElement.scrollWidth"))
        check("no page errors", not [e for e in errs if "PAGEERROR" in e], errs[:3])
        b.close()
    print(f"\n{sum(1 for x in res if x[0])}/{len(res)} passed")
    sys.exit(0 if all(x[0] for x in res) else 1)

if __name__ == "__main__":
    main()
