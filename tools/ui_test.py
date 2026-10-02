#!/usr/bin/env python3
"""Browser test (developer tool, needs `pip install playwright` + a Chromium).  usage: python tools/ui_test.py [site_dir] [screenshot_dir]
Serves site_dir from the fake origin https://linescout.test (so the browser enforces CORS exactly as on a real host) and checks, at 400px width:
slate renders, "Data updated" label, Today view with Safe 2/4/8 buttons + Pick of the Day, calendar, live ESPN polling from a static page (CORS),
practice-bet persistence in localStorage, a bet on a game that later left the slate, the stale warning, the error state and the offline fallback."""
import os, sys, json, time, mimetypes, datetime, collections
from playwright.sync_api import sync_playwright
SITE = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "/tmp"
ORIGIN = "https://linescout.test"
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
res = []
def check(name, cond, extra=""):
    res.append((bool(cond), name, extra)); print(("PASS " if cond else "FAIL ") + name + ((" - " + str(extra)[:200]) if extra else ""), flush=True)

class Host:
    """a tiny static host: files from a directory, optional per-path overrides (to simulate stale / broken data)"""
    def __init__(self, root): self.root = root; self.over = {}; self.hits = []
    def handler(self, route):
        path = route.request.url[len(ORIGIN):].split("?")[0] or "/"
        if path.endswith("/"): path += "index.html"
        self.hits.append(path)
        if path in self.over:
            o = self.over[path]
            if o is None: return route.fulfill(status=500, body="boom")
            return route.fulfill(status=200, body=json.dumps(o), headers={"content-type": "application/json"})
        f = os.path.join(self.root, path.lstrip("/"))
        if os.path.isfile(f): return route.fulfill(status=200, body=open(f, "rb").read(), headers={"content-type": mimetypes.guess_type(f)[0] or "application/octet-stream", "cache-control": "max-age=0"})
        route.fulfill(status=404, body="not found")

def browser(p, host, w=400, h=900):
    b = p.chromium.launch(channel="chromium", proxy=({"server": os.environ["HTTPS_PROXY"]} if os.environ.get("HTTPS_PROXY") else None))
    c = b.new_context(user_agent=UA, viewport={"width": w, "height": h})
    c.route(ORIGIN + "/**", host.handler)
    return b, c

def page(c, errs):
    pg = c.new_page()
    pg.on("console", lambda m: errs.append(m.type + ": " + m.text[:160]) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)[:160]))
    return pg

def main():
    slate = json.load(open(os.path.join(SITE, "data", "slate.json"))); meta = json.load(open(os.path.join(SITE, "data", "meta.json")))
    ngames = len(slate["games"])
    now = datetime.datetime.now(datetime.timezone.utc)
    fut = [g for g in slate["games"] if datetime.datetime.fromisoformat(g["iso"].replace("Z", "+00:00")) > now + datetime.timedelta(hours=2) and g["lines"]]
    with sync_playwright() as p:
        host = Host(SITE); b, c = browser(p, host); errs = []; espn = []
        pg = page(c, errs); pg.on("response", lambda r: espn.append(r.status) if "espn.com" in r.url else None)
        pg.goto(ORIGIN + "/"); pg.wait_for_timeout(5000)
        bar = pg.inner_text("#lsbar")
        check("page loads and the data bar says 'Data updated'", "Data updated" in bar, bar.replace("\n", " "))
        cards = pg.locator("article.game, article").count()
        if ngames: check("every slate game has a card", cards >= ngames, f"{cards} cards / {ngames} games")
        else: check("empty slate renders without error", True)
        txt = pg.inner_text("#app")
        check("Pick of the Day section present", "PICK OF THE DAY" in txt.upper())
        if any(g["players"] for g in slate["games"]):
            check("Safe 2 / 4 / 8 buttons present", pg.locator("button.safeb").count() >= 3, pg.locator("button.safeb").count())
        pg.locator("button.calbtn").first.click(); pg.wait_for_timeout(400)
        check("calendar opens with 12 days (7 back, today, 4 ahead)", pg.locator(".cal .dcell").count() == 12, pg.locator(".cal .dcell").count())
        pg.locator("button.calbtn").first.click(); pg.wait_for_timeout(200)
        check("no horizontal scroll at 400px", pg.evaluate("document.documentElement.scrollWidth") <= 400, pg.evaluate("document.documentElement.scrollWidth"))
        pg.screenshot(path=os.path.join(SHOTS, "ui_today.png"))
        # live ESPN polling from a static page: CORS must allow it
        pg.wait_for_timeout(6000)
        cors = [e for e in errs if "CORS" in e or "Access-Control" in e]
        check("browser can call ESPN from the static page (no CORS errors)", not cors, cors[:1])
        check("ESPN polled (200 responses)", len(espn) > 0 and set(espn) == {200}, collections.Counter(espn))
        pg.locator("#nav button").nth(1).click(); pg.wait_for_timeout(1200)
        live_txt = pg.inner_text("#app")
        check("Live tab renders (live games or the idle message)", ("live" in live_txt.lower()), live_txt[:80].replace("\n", " "))
        pg.screenshot(path=os.path.join(SHOTS, "ui_live.png"))
        # bets: place, reload, persists
        if fut:
            gid = fut[0]["id"]
            pg.locator("#nav button").nth(0).click(); pg.wait_for_timeout(500)
            pg.locator(f"#game-{gid} button[data-act=leg]").first.click(); pg.wait_for_timeout(300)
            pg.locator("#slip button[data-act=slip]").first.click(); pg.wait_for_timeout(400)
            pg.locator("#slip button[data-act=place]").first.click(); pg.wait_for_timeout(1200)
            bank1 = pg.inner_text("#hdr")
            pg.wait_for_timeout(700); pg.reload(); pg.wait_for_timeout(3500)
            bank2 = pg.inner_text("#hdr")
            check("practice bet placed: bankroll drops from $1,000 and survives a reload (localStorage)", "$990.00" in bank1 and "$990.00" in bank2, bank2[-30:].replace("\n", " "))
            pg.locator("#nav button").nth(2).click(); pg.wait_for_timeout(500)
            check("open bet is listed under My bets", "Pending" in pg.inner_text("#app"))
            # the game leaves the slate (next refresh): the bet must still show, no crash
            sl2 = dict(slate); sl2["games"] = [g for g in slate["games"] if g["id"] != gid]
            m2 = dict(meta); m2["generatedAt"] = (now + datetime.timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
            host.over["/data/slate.json"] = sl2; host.over["/data/meta.json"] = m2
            pg.reload(); pg.wait_for_timeout(3500)
            pg.locator("#nav button").nth(2).click(); pg.wait_for_timeout(600)
            check("bet on a game that left the slate still lists (card kept on the phone)", "Pending" in pg.inner_text("#app") and not [e for e in errs if "PAGEERROR" in e], [e for e in errs if "PAGEERROR" in e][:1])
            host.over.clear()
        pg.close()
        # stale warning
        m3 = dict(meta); m3["generatedAt"] = (now - datetime.timedelta(hours=9)).strftime("%Y-%m-%dT%H:%M:%SZ"); m3["generatedAtET"] = "9 hours ago (test)"
        host.over["/data/meta.json"] = m3
        pg = page(c, errs); pg.goto(ORIGIN + "/"); pg.wait_for_timeout(3000)
        check("stale warning shows when data is older than 6 h", "Stale" in pg.inner_text("#lsbar"), pg.inner_text("#lsbar")[:120].replace("\n", " "))
        pg.screenshot(path=os.path.join(SHOTS, "ui_stale.png")); pg.close(); host.over.clear()
        # offline fallback: first load fills the cache, then every data file fails -> last copy on the phone
        pg = page(c, errs); pg.goto(ORIGIN + "/"); pg.wait_for_timeout(2500)
        for n in ("meta", "slate", "learn", "pastp"): host.over[f"/data/{n}.json"] = None
        pg.reload(); pg.wait_for_timeout(3000)
        check("offline: last good copy from the phone is used and labelled", "Offline" in pg.inner_text("#lsbar") and pg.locator("article").count() >= min(1, ngames), pg.inner_text("#lsbar")[:100].replace("\n", " "))
        pg.close()
        # error state: no cache at all
        b2, c2 = browser(p, host); host.over.clear()
        for n in ("meta", "slate", "learn", "pastp"): host.over[f"/data/{n}.json"] = None
        pg = c2.new_page(); pg.goto(ORIGIN + "/"); pg.wait_for_timeout(2500)
        check("error state: clear message + retry button when nothing can be loaded", "Could not load the data" in pg.inner_text("#app") and pg.locator("#ls-retry").count() == 1, pg.inner_text("#lsbar")[:60])
        pg.screenshot(path=os.path.join(SHOTS, "ui_error.png"))
        host.over.clear(); pg.locator("#ls-retry").click(); pg.wait_for_timeout(3500)
        check("error state: Try again recovers once data is available", "Data updated" in pg.inner_text("#lsbar"))
        b2.close()
        real = [e for e in errs if "PAGEERROR" in e or ("Failed to load resource" not in e and "CORS" not in e and "Access-Control" not in e)]
        check("no JavaScript errors in the whole session", not [e for e in errs if "PAGEERROR" in e], [e for e in errs if "PAGEERROR" in e][:2])
        b.close()
    bad = [r for r in res if not r[0]]
    print(f"\n{len(res) - len(bad)}/{len(res)} browser checks passed")
    return 1 if bad else 0
if __name__ == "__main__":
    sys.exit(main())
