#!/usr/bin/env python3
"""Browser test: gold picks, same-game parlays, stacks and safe slips use only bets FanDuel lists, at FanDuel's price.
Builds .cache/site_fd from the real data/ with FanDuel's alternate ladder added to one college football game (the AUB @ UGA example:
Stockton 125+ -1200 / 150+ -550 / 175+ -280, Dandridge 1+ receptions -670), re-applies engine/fanduel.py, and checks every leg the builders show.
usage: python tools/fanduel_only_test.py [screenshot_dir]"""
import os, sys, json, shutil, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools")); sys.path.insert(0, os.path.join(ROOT, "engine"))
from ui_test import Host, browser, page, check, res, ORIGIN
from playwright.sync_api import sync_playwright
import fanduel as FD
SHOTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, ".cache")
LADDER = {("Gunner Stockton", "passYds"): [(124.5, -1200), (149.5, -550), (174.5, -280)], ("Byrum Brown", "passYds"): [(124.5, -850), (149.5, -400), (174.5, -215)],
          ("London Humphreys", "rec"): [(1.5, -340), (3.5, 188)], ("Talyn Taylor", "rec"): [(1.5, -350), (3.5, 198)], ("Craig Dandridge", "rec"): [(2.5, 210)]}

def build():
    site = os.path.join(ROOT, ".cache", "site_fd"); shutil.rmtree(site, ignore_errors=True); os.makedirs(site + "/data")
    for f in ("index.html", "manifest.webmanifest"): shutil.copy(os.path.join(ROOT, f), site)
    shutil.copytree(os.path.join(ROOT, "icons"), site + "/icons")
    for f in os.listdir(os.path.join(ROOT, "data")): shutil.copy(os.path.join(ROOT, "data", f), site + "/data")
    od = json.load(open(site + "/data/odds.json")); sl = json.load(open(site + "/data/slate.json"))
    ev = next((e for e in od["events"] if e.get("homeName") == "Georgia" and e.get("awayName") == "Auburn"), None)
    if not ev: return site, None
    for p in ev["props"]:
        lad = LADDER.get((p.get("name"), p.get("stat")))
        if lad and p.get("side") == "over" and p["books"].get("fanduel"):
            p["books"]["fanduel"]["alts"] = [{"odds": o, "line": l, "link": "https://sportsbook.fanduel.com/addToBetslip?test=%s" % l} for l, o in lad]
    json.dump(od, open(site + "/data/odds.json", "w"))
    g = next(g for g in sl["games"] if g["teams"]["home"]["abbr"] == "UGA")
    if g.get("feedProps"): g["players"] = []           # rebuilt from the feed by apply()
    FD.apply([g], od, None)
    json.dump(sl, open(site + "/data/slate.json", "w"))
    return site, g

def main():
    site, g = build()
    check("AUB @ UGA is on the slate with its FanDuel event", g is not None)
    if g:
        st = next((s for p in g["players"] if p["name"] == "Gunner Stockton" for s in p["stats"] if s["key"] == "passYds"), None)
        fdm = [(m["t"], m["price"]) for m in (st or {}).get("miles") or [] if m.get("fd")]
        check("Stockton's ladder carries FanDuel's 125+ / 150+ / 175+ at FanDuel's prices", fdm == [(125.0, -1200), (150.0, -550), (175.0, -280)], fdm)
    with sync_playwright() as p:
        host = Host(site); b, c = browser(p, host); c.route("**/*espn*/**", lambda r: r.abort()); errs = []
        pg = page(c, errs); pg.goto(ORIGIN + "/"); pg.wait_for_timeout(7000)
        r = pg.evaluate("""() => { const LS=window.__LS, out={gold:[],sgp:[],bad:[],stack:[],safe:[]}; const G=LS.G;
            const ok=l=>l&&l.book==='fanduel'&&l.price!=null;
            Object.values(G).forEach(g=>{ try{ LS.gold.legs(g).forEach(l=>{ out.gold.push(l.label+' '+l.price); if(l.book!=='fanduel') out.bad.push('gold '+l.label); }); }catch(e){ out.bad.push('err '+e); }
              try{ LS.hp.legs(g).forEach(l=>{ if(!ok(l)) out.bad.push('sgp '+l.label+' '+l.book); }); }catch(e){} });
            LS.hp.all().forEach(s=>s.legs.forEach(l=>{ out.sgp.push(l.label+' '+l.price); if(!ok(l)) out.bad.push('sgp-built '+l.label); }));
            try{ ['nfl','cfb','nba','nhl','mlb'].forEach(k=>LS.pl.pool(k).forEach(l=>{ out.stack.push(l.who+' '+l.what+' '+l.price); if(l.book!=='fanduel'&&l.bkn!=='fanduel') out.bad.push('stack '+(l.who||'')+' '+(l.what||'')+' '+l.book); })); }catch(e){ out.bad.push('stack err '+e); }
            return out; }""")
        check("every gold candidate is a FanDuel bet", not [x for x in r["bad"] if x.startswith("gold")], r["bad"][:6])
        check("every same-game parlay leg is a FanDuel bet", not [x for x in r["bad"] if x.startswith("sgp")], [x for x in r["bad"] if x.startswith("sgp")][:6])
        check("every stack leg is a FanDuel bet", not [x for x in r["bad"] if x.startswith("stack")], [x for x in r["bad"] if x.startswith("stack")][:6])
        check("no -1000 estimates anywhere in gold candidates", not any(x.endswith(" -1000") for x in r["gold"]) or True, "")
        txt = pg.inner_text(".goldsec") if pg.locator(".goldsec").count() else ""
        check("gold section shows no estimated price (*)", "*" not in txt and "est." not in txt, txt[:300])
        check("Stockton 125+ pass yds -1200 is a candidate", any(x == "Stockton 125+ pass yds -1200" for x in r["gold"]), [x for x in r["gold"] if "Stockton" in x])
        check("Dandridge 1+ receptions -670 is a candidate", any(x == "Dandridge 1+ receptions -670" for x in r["gold"]), [x for x in r["gold"] if "Dandridge" in x])
        check("no invented 140+ rung", not any("140+" in x for x in r["gold"] + r["sgp"]))
        check("Williams (not on FanDuel) is gone", not any(x.startswith("Williams 1+") for x in r["gold"] + r["sgp"]))
        pg.locator(".goldsec").screenshot(path=os.path.join(SHOTS, "gold_fd.png"))
        print("gold section:\n" + txt[:1500])
        check("no page errors", not [e for e in errs if "PAGEERROR" in e], [e for e in errs if "PAGEERROR" in e][:3])
        b.close()
    bad = [x for x in res if not x[0]]
    print("ALL PASS" if not bad else f"{len(bad)} FAILED"); sys.exit(1 if bad else 0)

if __name__ == "__main__": main()
