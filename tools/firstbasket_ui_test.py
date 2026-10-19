#!/usr/bin/env python3
"""Browser test: the First basket section on the home screen (prediction rows, locked/result state, track record).
Builds .cache/site_fb from the real data/: adds g.fb (engine/firstbasket.py prediction with a FanDuel first-basket list) to ATL @ GS, a locked + graded one to a copy of that game
on the previous day, and data/firstbasket.json. usage: python tools/firstbasket_ui_test.py"""
import os, sys, json, shutil, datetime, copy
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools")); sys.path.insert(0, os.path.join(ROOT, "engine"))
from ui_test import Host, browser, page, check, res, ORIGIN
from playwright.sync_api import sync_playwright
import firstbasket as FB

def build():
    site = os.path.join(ROOT, ".cache", "site_fb"); shutil.rmtree(site, ignore_errors=True); os.makedirs(site + "/data")
    for f in ("index.html", "manifest.webmanifest"): shutil.copy(os.path.join(ROOT, f), site)
    shutil.copytree(os.path.join(ROOT, "icons"), site + "/icons")
    for f in os.listdir(os.path.join(ROOT, "data")): shutil.copy(os.path.join(ROOT, "data", f), site + "/data")
    sl = json.load(open(site + "/data/slate.json"))
    g = next(g for g in sl["games"] if g["teams"]["home"]["abbr"] == "GS" and g["teams"]["away"]["abbr"] == "ATL")
    ev = dict(first=[dict(stat="firstBasket", pid=p["id"], name=p["name"], team=p["side"], side="yes", books=dict(fanduel=dict(odds=o))) for p, o in zip(g["players"][:6], (550, 700, 750, 800, 900, 1100))])
    pr = FB.predict(g, ev); g["fb"] = dict(pr, locked=False)
    rows = [[o["id"], o["name"], o["side"], o["p"], o["pt"], o["fd"]] for o in pr["rows"]]
    rec = dict(id="X1", lg="wnba", iso="2026-10-18T00:00:00Z", h="GS", a="ATL", tip=pr["tip"], pH=pr["pH"], src="both", rows=rows)
    rec["res"] = dict(fg=dict(i=rows[1][0], n=rows[1][1], tm=rows[1][2], sv=3, q=1, c="9:12", t=""), any=dict(i=rows[0][0], n=rows[0][1], tm=rows[0][2], sv=1, q=1, c="9:30", t=""), tf={})
    b = FB.FirstBasket(site); b.recs = {"X1": rec}; b._grade(rec)
    out = b.summary(datetime.datetime(2026, 10, 19, 21, tzinfo=datetime.timezone.utc))
    json.dump(out, open(site + "/data/firstbasket.json", "w")); json.dump(sl, open(site + "/data/slate.json", "w"))
    return site, g, out

def main():
    site, g, out = build()
    check("summary has the graded game", out["leagues"]["wnba"]["n"] == 1 and out["recent"][0]["who"] == rows_name(g, out), out["leagues"]["wnba"])
    with sync_playwright() as p:
        host = Host(site); b, c = browser(p, host); c.route("**/*espn*/**", lambda r: r.abort()); errs = []
        pg = page(c, errs)
        try: pg.clock.set_fixed_time(datetime.datetime(2026, 10, 19, 19, 0, tzinfo=datetime.timezone.utc))      # 3 PM ET, before the ATL @ GS tip
        except Exception as ex: print("no page.clock:", ex)
        pg.goto(ORIGIN + "/"); pg.wait_for_timeout(7000)
        html = pg.evaluate("() => window.__LS.hp.first()")
        txt = pg.evaluate("(h) => { const d=document.createElement('div'); d.innerHTML=h; return d.innerText; }", html)
        print(txt[:1500])
        check("section shows the track record line (top pick right 0 of 1, top 3 ...)", "Track record" in txt and "top pick right" in txt and "of 1" in txt)
        check("latest result shows who scored first and where we had him", "Latest results" in txt and "we had him #2" in txt, txt[:300])
        check("the ATL @ GS prediction lists players with chances and FanDuel prices", "ATL @ GS" in txt and "%" in txt and "FD" in txt, "")
        check("shows each team's chance to score first and the source", "to score first" in txt and "FanDuel's first-basket prices" in txt)
        check("explains that a free throw is not a basket", "free throw" in txt.lower())
        sec = pg.evaluate("() => document.body.innerText.includes('First basket (NBA and WNBA)')")
        check("the home screen has the First basket section", sec)
        errs = [e for e in errs if e.startswith("PAGEERROR")]; check("no script errors", not errs, errs[:3]); b.close()
    bad = res.count(False) if res and isinstance(res[0], bool) else len([x for x in res if not x[0]])
    print("\n%d checks, %d failed" % (len(res), bad)); sys.exit(1 if bad else 0)

def rows_name(g, out): return out["recent"][0]["who"]
if __name__ == "__main__": main()
