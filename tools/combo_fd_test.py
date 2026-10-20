#!/usr/bin/env python3
"""Browser test: combos (double to 5x) built from FanDuel-direct NBA lines, with each leg's record vs past games.
Takes the real data/, gives two of today's NBA games player cards (game logs: last 15 + last season's playoffs), feeds a fake FanDuel site response through
engine/fdapi.py (same shapes as the live API: "2+ Made Threes", "To Record 8+ Rebounds", "Jayson Tatum - Made Threes" ...), applies engine/fanduel.py,
then checks in headless Chromium that every combo target builds from FanDuel legs only, at FanDuel prices, with the record shown.
Needs today's slate to have those NBA games still to come. usage: python tools/combo_fd_test.py"""
import os, sys, json, shutil, copy, datetime, random
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools")); sys.path.insert(0, os.path.join(ROOT, "engine"))
from ui_test import Host, browser, page, check, res, ORIGIN
from playwright.sync_api import sync_playwright
import fdapi, fanduel as FD

random.seed(7)
def rr(name, odds, h=0, sid=None): return {"selectionId": sid or random.randint(10**6, 10**8), "runnerName": name, "handicap": h, "runnerStatus": "ACTIVE", "winRunnerOdds": {"americanDisplayOdds": {"americanOdds": odds, "americanOddsInt": odds}}}
def mk(mt, nm, rs): return {"marketId": "726.%d" % random.randint(10**8, 10**9), "marketType": mt, "marketName": nm, "marketStatus": "OPEN", "inPlay": False, "runners": rs}
# player: (name, side, {stat: (avg, sd-ish, ladder rungs with prices)})
GAMES = {
  ("BOS", "DET"): [("Jayson Tatum", "away", {"fg3": (3.0, [(1, -1400), (2, -500), (3, -150), (4, 210)]), "reb": (9.0, [(4, -2000), (6, -700), (8, -210), (10, 170)]), "pts": (27, [(15, -1100), (20, -380), (25, -130)])}),
                   ("Jaylen Brown", "away", {"pts": (24, [(15, -900), (20, -270), (25, 110)]), "reb": (5.5, [(4, -320), (6, 110)])}),
                   ("Derrick White", "away", {"fg3": (2.6, [(1, -900), (2, -350), (3, 130)]), "ast": (4.5, [(2, -1000), (4, -210), (6, 220)])}),
                   ("Cade Cunningham", "home", {"ast": (9.0, [(2, -6000), (4, -2500), (6, -900), (8, -170), (10, 190)]), "pts": (26, [(15, -1200), (20, -400), (25, -120)])}),
                   ("Duncan Robinson", "home", {"fg3": (2.7, [(1, -1000), (2, -310), (3, 120)])}),
                   ("Ausar Thompson", "home", {"reb": (6.5, [(4, -500), (6, -150), (8, 190)])}),
                   ("Jalen Duren", "home", {"reb": (11, [(6, -1400), (8, -350), (10, -140), (12, 160)])})],
  ("PHI", "NY"): [("Tyrese Maxey", "away", {"pts": (26, [(15, -1000), (20, -350), (25, -110)]), "ast": (6.5, [(4, -700), (6, -170), (8, 180)]), "fg3": (3.0, [(2, -420), (3, -130)])}),
                  ("Joel Embiid", "away", {"reb": (8.5, [(6, -500), (8, -170), (10, 160)]), "pts": (25, [(20, -300), (25, 100)])}),
                  ("Jalen Brunson", "home", {"pts": (27, [(15, -1600), (20, -500), (25, -140)]), "ast": (7, [(4, -900), (6, -220), (8, 150)])}),
                  ("Karl-Anthony Towns", "home", {"reb": (11.5, [(6, -2000), (8, -600), (10, -220), (12, 125)]), "fg3": (2.1, [(1, -700), (2, -170)])}),
                  ("Josh Hart", "home", {"reb": (8, [(6, -380), (8, -110)]), "ast": (5, [(4, -260), (6, 150)])})]}
NAMES = {"BOS": "Boston Celtics", "DET": "Detroit Pistons", "PHI": "Philadelphia 76ers", "NY": "New York Knicks"}
LAB = {"fg3": "Made Threes", "reb": "Rebounds", "ast": "Assists", "pts": "Points"}

def ladder_mkt(stat, t, players):
    if stat == "fg3": return mk("%d+_MADE_THREES" % t, "%d+ Made Threes" % t, players)
    if stat == "pts": return mk("TO_SCORE_%d+_POINTS" % t, "To Score %d+ Points" % t, players)
    return mk("TO_RECORD_%d+_%s" % (t, LAB[stat].upper()), "To Record %d+ %s" % (t, LAB[stat]), players)

def fake_feed(cards):
    evs, by_eid = {}, {}
    for i, ((a, h), pls) in enumerate(GAMES.items()):
        g = cards[(a, h)]; eid = 9000 + i
        evs[str(eid)] = {"eventId": eid, "name": NAMES[a] + " @ " + NAMES[h], "openDate": g["iso"].replace("Z", ".000Z")}
        mks = [mk("MONEY_LINE", "Moneyline", [rr(NAMES[a], -120), rr(NAMES[h], 102)]), mk("MATCH_HANDICAP_(2-WAY)", "Spread", [rr(NAMES[a], -110, -1.5), rr(NAMES[h], -110, 1.5)]),
               mk("TOTAL_POINTS_(OVER/UNDER)", "Total Points", [rr("Over", -110, 220.5), rr("Under", -110, 220.5)])]
        rungs = {}
        for nm, side, sts in pls:
            for st, (avg, lad) in sts.items():
                line = round(avg) - 0.5 if st != "fg3" else 2.5
                mks.append(mk("PLAYER_A_TOTAL_" + st.upper(), nm + " - " + LAB[st], [rr(nm + " Over", -115, line), rr(nm + " Under", -105, line)]))
                for t, o in lad: rungs.setdefault((st, t), []).append(rr(nm, o))
        mks += [ladder_mkt(st, t, ps) for (st, t), ps in rungs.items()]
        by_eid[eid] = mks
    page = {"attachments": {"events": evs}}
    layout = {"tabs": {"1": {"title": "Player Points"}, "2": {"title": "Player Threes"}}}
    fdapi._page = lambda lg: page if lg == "nba" else {"attachments": {"events": {}}}
    fdapi._event = lambda eid, tab=None: {"layout": layout, "attachments": {"markets": {m["marketId"]: m for m in by_eid[int(eid)]}}}

def player_card(tpl, nm, side, abbr, sts):
    p = copy.deepcopy(tpl); p.update(id="t" + nm.replace(" ", "").lower(), name=nm, side=side, abbr=abbr, status=dict(label="Active", kind="ok", note=""), avail=1.0, feed=False)
    out = []
    for st, (avg, lad) in sts.items():
        sd = max(1.0, avg * 0.3) if st in ("pts", "reb", "ast") else 1.3
        vals = [max(0, round(random.gauss(avg, sd))) for _ in range(15)]; post = [max(0, round(random.gauss(avg, sd))) for _ in range(7)]
        out.append(dict(key=st, label={"fg3": "3-pointers", "pts": "Points", "reb": "Rebounds", "ast": "Assists"}[st], vals=vals[-10:], v15=vals, n=10, n15=15, proj=avg, season=avg, avg=avg, avg5=avg,
                        sd=sd, line=round(avg) - 0.5, lineSrc="model", miles=[], post=post, pre=[], pOver=0.5, overPrice=-110, prices=[], safe=None, safeAdj=None))
    p["stats"] = out; return p

def build():
    site = os.path.join(ROOT, ".cache", "site_cx"); shutil.rmtree(site, ignore_errors=True); os.makedirs(site + "/data")
    for f in ("index.html", "manifest.webmanifest"): shutil.copy(os.path.join(ROOT, f), site)
    shutil.copytree(os.path.join(ROOT, "icons"), site + "/icons")
    for f in os.listdir(os.path.join(ROOT, "data")): shutil.copy(os.path.join(ROOT, "data", f), site + "/data")
    sl = json.load(open(site + "/data/slate.json"))
    tpl = next(p for g in sl["games"] for p in (g.get("players") or []) if (g.get("key") or g.get("lg")) == "wnba")
    cards = {}
    for (a, h), pls in GAMES.items():
        g = next(x for x in sl["games"] if x["teams"]["away"]["abbr"] == a and x["teams"]["home"]["abbr"] == h)
        g["players"] = [player_card(tpl, nm, side, a if side == "away" else h, sts) for nm, side, sts in pls]
        cards[(a, h)] = g
    fake_feed(cards)
    now = datetime.datetime.now(datetime.timezone.utc)
    st = fdapi.refresh(site + "/data/fdodds.json", site + "/data/odds.json", sl["games"], now)
    od = json.load(open(site + "/data/odds.json"))
    msg = FD.apply(sl["games"], od, now)
    json.dump(sl, open(site + "/data/slate.json", "w"))
    return site, st, msg

def main():
    site, st, msg = build()
    print("fdapi:", st); print("apply:", msg)
    check("FanDuel direct pulled both NBA games", st.startswith("ok: 2 games"), st)
    with sync_playwright() as p:
        host = Host(site); b, c = browser(p, host); c.route("**/*espn*/**", lambda r: r.abort()); errs = []
        pg = page(c, errs); pg.goto(ORIGIN + "/"); pg.wait_for_timeout(7000)
        r = pg.evaluate("""() => { const X=window.__LS.cx; const all=X.build(); const out={};
            Object.keys(all).forEach(k=>{ const s=all[k]; out[k]=s?{am:s.am,p:s.pAll,legs:s.legs.map(l=>({k:l.spec&&l.spec.k,label:l.label,price:l.price,book:l.book,link:!!l.link,p:l.ps,rec:l.rec,lg:l.lg,gid:l.gid}))}:null; });
            const box=document.getElementById('cxbox'); return {all:out, html:box?box.innerText:'', pool:X.pool().length}; }""")
        print("pool:", r["pool"])
        for k, s in r["all"].items():
            print(" %sx:" % k, s and ("%+d, %.0f%% all-hit" % (s["am"], s["p"] * 100)), "")
            for l in (s or {}).get("legs", []): print("     ", l["label"], l["price"], "%.0f%%" % (l["p"] * 100), l["rec"])
        A = r["all"]
        check("every target builds a combo (double, 3x .. 5x)", all(A.get(k) for k in ("1", "3", "4", "5")), [k for k in ("1", "3", "4", "5") if not A.get(k)])
        lo = {"1": 100, "3": 300, "4": 400, "5": 500}
        check("each combo's price is inside its window", all(A[k] and lo[k] <= A[k]["am"] <= lo[k] + 83 for k in lo if A.get(k)), {k: A[k] and A[k]["am"] for k in A})
        legs = [l for k in A if A[k] for l in A[k]["legs"]]
        check("every leg is a FanDuel bet with its link", legs and all(l["book"] == "fanduel" and l["link"] for l in legs))
        check("player legs carry the record vs past games (last 15 + playoffs)", all(l["rec"] and l["rec"].get("n") for l in legs if l["k"] == "prop"), [l["label"] for l in legs if l["k"] == "prop" and not (l["rec"] or {}).get("n")])
        check("at most 2 legs per game", all(max([sum(1 for l in A[k]["legs"] if l["gid"] == g) for g in {l["gid"] for l in A[k]["legs"]}]) <= 2 for k in A if A[k]))
        check("the Double tab and the record line are on the page", "Double" in r["html"] and "hit " in r["html"] and "of last 15" in r["html"], r["html"][:300])
        errs = [e for e in errs if e.startswith("PAGEERROR")]
        check("no script errors on the page", not errs, errs[:3])
        pg.evaluate("() => { const b=document.getElementById('cxbox'); if(b) b.scrollIntoView(); const t=document.querySelector('[data-act=\"cx-k\"][data-k=\"3\"]'); if(t) t.click(); }"); pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(ROOT, ".cache", "combo_fd.png"), full_page=False)
        b.close()
    bad = [x for x in res if not x[0]]
    print("\n%d checks, %d failed" % (len(res), len(bad)))
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()
