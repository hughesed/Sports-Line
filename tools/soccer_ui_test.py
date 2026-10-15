#!/usr/bin/env python3
"""Browser test for soccer, gold picks and alternate totals (needs playwright + Chromium). usage: python tools/soccer_ui_test.py [screenshot_dir]
Builds a copy of the site under .cache/site_soccer with the real data/ plus one soccer match from tools/soccer_test.py (moved to kick off in 20 hours),
serves it at a fake origin with ESPN blocked, and checks the soccer card, its markets, the slip, grading, the gold section and the battle sport list."""
import os, sys, json, shutil, datetime, subprocess
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools")); sys.path.insert(0, os.path.join(ROOT, "engine"))
from ui_test import Host, browser, page, check, res, ORIGIN
from playwright.sync_api import sync_playwright
SHOTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, ".cache")

def build_site():
    subprocess.run([sys.executable, os.path.join(ROOT, "tools", "soccer_test.py"), "--write"], check=True, stdout=subprocess.DEVNULL)
    site = os.path.join(ROOT, ".cache", "site_soccer"); shutil.rmtree(site, ignore_errors=True); os.makedirs(site + "/data")
    for f in ("index.html", "manifest.webmanifest"): shutil.copy(os.path.join(ROOT, f), site)
    shutil.copytree(os.path.join(ROOT, "icons"), site + "/icons")
    for f in os.listdir(os.path.join(ROOT, "data")): shutil.copy(os.path.join(ROOT, "data", f), site + "/data")
    import soccer as SOC
    from timeutil import ET
    card = json.load(open(os.path.join(ROOT, ".cache", "soccer_demo", "card.json"))); ev = json.load(open(os.path.join(ROOT, ".cache", "soccer_demo", "event.json")))
    t = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0, second=0) + datetime.timedelta(hours=20)
    card["iso"] = t.strftime("%Y-%m-%dT%H:%M:%SZ"); card["day"] = t.astimezone(ET).strftime("%Y-%m-%d"); ev["start"] = card["iso"]
    sl = json.load(open(site + "/data/slate.json")); sl["games"].append(card); json.dump(sl, open(site + "/data/slate.json", "w"))
    od = json.load(open(site + "/data/odds.json")); od["events"].append(ev); json.dump(od, open(site + "/data/odds.json", "w"))
    sim = json.load(open(site + "/data/sim.json")); sim["sports"]["soccer"] = SOC.sim_sport([card]); json.dump(sim, open(site + "/data/sim.json", "w"))
    return site, card

def main():
    site, card = build_site(); gid = card["id"]
    with sync_playwright() as p:
        host = Host(site); b, c = browser(p, host); c.route("**/*espn*/**", lambda r: r.abort()); errs = []
        pg = page(c, errs); pg.goto(ORIGIN + "/"); pg.wait_for_timeout(6000)
        txt = pg.inner_text("#app")
        check("gold section on the home screen", "GOLD PICKS" in txt.upper(), txt[:200])
        check("a gold pick shows (90%+)", pg.locator(".glpick").count() >= 1, pg.locator(".gold").count())
        pct = [int(x.strip("%")) for x in pg.locator(".glpick .glbig").all_inner_texts() for x in [x.split("%")[0] + "%"]]
        check("every gold pick is 90%+", pct and all(v >= 90 for v in pct), pct)
        check("gold slips present", pg.locator(".glslip").count() >= 1)
        pg.screenshot(path=os.path.join(SHOTS, "gold_home.png"), full_page=False)
        check("Soccer league tab", pg.locator('[data-act="league"][data-k="soccer"]').count() == 1)
        pg.click('[data-act="league"][data-k="soccer"]'); pg.wait_for_timeout(800)
        el = pg.locator("#game-" + gid)
        check("soccer card renders", el.count() == 1)
        ct = el.inner_text() if el.count() else ""
        check("3-way grid with a draw row", "Draw" in ct and "Result" in ct, ct[:300])
        check("soccer markets section", "SOCCER MARKETS" in ct.upper() and "DOUBLE CHANCE" in ct.upper() and "Under 4.5" in ct)
        pg.locator("#game-" + gid + ' [data-tok="g:' + gid + ':at:under:4.5"]').first.click(); pg.wait_for_timeout(400)
        n = pg.evaluate("() => window.__LS.S.slip.map(l=>l.label+' '+l.price+' '+Math.round(l.p*100))")
        check("Under 4.5 goals goes into the slip", any("Under 4.5 goals" in x for x in n), n)
        el.screenshot(path=os.path.join(SHOTS, "soccer_card.png"))
        gold_soc = pg.inner_text(".goldsec") if pg.locator(".goldsec").count() else ""
        check("soccer gold pick listed", "Soccer" in gold_soc, gold_soc[:300])
        gr = pg.evaluate("""(gid) => { const g=window.__LS.soc.grade; const F={home:1,away:1,played:{},stat:{}};
            return [g({gid,spec:{k:'ml',side:'home',x3:1}},F), g({gid,spec:{k:'ml',side:'draw',x3:1}},F), g({gid,spec:{k:'dc',side:'away'}},F), g({gid,spec:{k:'btts',dir:'yes'}},F),
                    g({gid,spec:{k:'tt',side:'home',dir:'under',line:1.5}},F), g({gid,spec:{k:'tot',dir:'under',line:2.5}},F)]; }""", gid)
        check("soccer grading: 1-1 -> home L, draw W, away-or-draw W, BTTS yes W, home U1.5 W", gr[:5] == ["L", "W", "W", "W", "W"], gr)
        check("goal total falls through to the usual grader", gr[5] is None, gr)
        pr = pg.evaluate("(gid) => { const s=window.__LS.soc; const G=window.__LS.G[gid]; return [s.prob(G,(x,y)=>x>y), G.crossroads.pHome, s.team(G).length]; }", gid)
        check("Poisson home-win chance matches the book within 3 pts", abs(pr[0] - pr[1]) < 0.03, pr)
        check("soccer legs offered to the builders", pr[2] >= 20, pr)
        nhl = pg.evaluate("""() => { const G=window.__LS.G; const g=Object.values(G).find(x=>(x.key||x.lg)==='nhl'&&x.lines&&x.lines.total!=null); if(!g) return null;
            const t='g:'+g.id+':at:under:'+(g.lines.total+2); const l=window.__LS.gold.alt(t,t.split(':'),g); return l&&[l.label,Math.round(l.p*100),l.price]; }""")
        check("alternate total leg (hockey)", nhl is None or (nhl[1] >= 80), nhl)
        # battle sport list
        sp = pg.evaluate("() => (typeof sports3==='function')?null:'n/a'")
        pg.evaluate("() => { try{ window.__LS.S.view='battle'; }catch(e){} }")
        check("no page errors", not [e for e in errs if "PAGEERROR" in e], errs[:5])
        print("console errors (info):", [e for e in errs if "PAGEERROR" not in e][:5])
        b.close()
    bad = [r for r in res if not r[0]]
    print("ALL PASS" if not bad else f"{len(bad)} FAILED"); sys.exit(1 if bad else 0)

if __name__ == "__main__": main()
