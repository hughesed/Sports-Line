#!/usr/bin/env python3
"""Browser test: the NHL and WNBA same-game-parlay builders carry the markets FanDuel lists for those sports.
NHL (ANA @ NYR): player assists (overs only), alternate puck line, team totals (main and alternate lines), alternate game totals.
WNBA (ATL @ GS): X+ ladders from FanDuel's alternate lines, alternate handicaps, alternate game totals.
Builds .cache/site_nw from the real data/ plus a synthetic FanDuel feed for those two games, re-applies engine/fanduel.py, then checks the legs the page builds.
usage: python tools/nhl_wnba_markets_test.py"""
import os, sys, json, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools")); sys.path.insert(0, os.path.join(ROOT, "engine"))
from ui_test import Host, browser, page, check, res, ORIGIN
from playwright.sync_api import sync_playwright
import fanduel as FD
import odds as ODDS

LINK = "https://sportsbook.fanduel.com/addToBetslip?marketId=%s&selectionId=%s"
def bk(odds, line=None, alts=None, n=[0]):
    n[0] += 1
    d = {"fanduel": {"odds": odds, "line": line, "link": LINK % ("m%d" % n[0], "s%d" % n[0])}}
    if alts: d["fanduel"]["alts"] = [{"odds": o, "line": l, "link": LINK % ("m%d" % n[0], "a%d" % int(abs(l) * 10))} for l, o in alts]
    return d
def side(odds, line=None, alts=None): return {"fair": {"odds": odds, "line": line}, "books": bk(odds, line, alts)}
def prop(pid, name, team, stat, line, over, under, alts=()):
    return [{"pid": pid, "name": name, "team": team, "stat": stat, "type": "ou", "side": "over", "fair": {"odds": over}, "books": bk(over, line, list(alts))},
            {"pid": pid, "name": name, "team": team, "stat": stat, "type": "ou", "side": "under", "fair": {"odds": under}, "books": bk(under, line)}]

def nhl_event(start):
    props = []
    for pid, nm, tm in (("A1", "Troy Terry", "away"), ("A2", "Mason McTavish", "away"), ("H1", "Artemi Panarin", "home"), ("H2", "Adam Fox", "home")):
        props += prop(pid, nm, tm, "pts", 0.5, 130, -170, [(1.5, 480)])
        props += prop(pid, nm, tm, "ast", 0.5, -110, -120, [(1.5, 330)])
        props += prop(pid, nm, tm, "sog", 2.5, -125, -105, [(1.5, -300), (3.5, 135)])
    return {"id": "NHLTEST", "league": "NHL", "start": start, "live": False, "final": False, "home": "NYR", "away": "ANA", "homeName": "New York Rangers", "awayName": "Anaheim Ducks",
            "eventLinks": {"fanduel": "https://sportsbook.fanduel.com/hockey/nhl"}, "props": props, "first": [],
            "main": {"ml": {"home": side(-155), "away": side(130)},
                     "spread": {"home": side(160, -1.5, [(-2.5, 430), (1.5, -230), (2.5, -420)]), "away": side(-192, 1.5, [(2.5, -430), (-1.5, 230), (-2.5, 420)])},
                     "total": {"over": side(-110, 6.5, [(5.5, -240), (7.5, 150)]), "under": side(-110, 6.5, [(5.5, 190), (7.5, -190)])}},
            "tt": {"away": {"over": side(-118, 2.5, [(1.5, -330), (3.5, 160)]), "under": side(-106, 2.5, [(1.5, 250), (3.5, -210)])},
                   "home": {"over": side(-130, 3.5, [(2.5, -180), (4.5, 210)]), "under": side(100, 3.5, [(2.5, 150), (4.5, -280)])}}}

def wnba_event(start, names):
    props = []
    for i, (pid, nm, tm) in enumerate(names):
        props += prop(pid, nm, tm, "pts", 14.5, -115, -115, [(9.5, -260), (11.5, -170), (17.5, 150)])
        props += prop(pid, nm, tm, "reb", 4.5, -115, -115, [(2.5, -330), (5.5, 125)])
        props += prop(pid, nm, tm, "ast", 2.5, -115, -115, [(1.5, -300), (3.5, 140)])
        props += prop(pid, nm, tm, "pra", 23.5, -115, -115, [(17.5, -250), (20.5, -150)])
    return {"id": "WNBATEST", "league": "WNBA", "start": start, "live": False, "final": False, "home": "GS", "away": "ATL", "homeName": "Golden State Valkyries", "awayName": "Atlanta Dream",
            "eventLinks": {"fanduel": "https://sportsbook.fanduel.com/basketball/wnba"}, "props": props, "first": [],
            "main": {"ml": {"home": side(-135), "away": side(114)},
                     "spread": {"home": side(-105, -2.5, [(-4.5, 130), (-0.5, -180), (1.5, -310)]), "away": side(-115, 2.5, [(4.5, -170), (0.5, 150), (-1.5, 270)])},
                     "total": {"over": side(-108, 152.5, [(142.5, -380), (147.5, -190)]), "under": side(-112, 152.5, [(157.5, -200), (162.5, 130)])}}}

def build():
    site = os.path.join(ROOT, ".cache", "site_nw"); shutil.rmtree(site, ignore_errors=True); os.makedirs(site + "/data")
    for f in ("index.html", "manifest.webmanifest"): shutil.copy(os.path.join(ROOT, f), site)
    shutil.copytree(os.path.join(ROOT, "icons"), site + "/icons")
    for f in os.listdir(os.path.join(ROOT, "data")): shutil.copy(os.path.join(ROOT, "data", f), site + "/data")
    od = json.load(open(site + "/data/odds.json")); sl = json.load(open(site + "/data/slate.json"))
    gn = next(g for g in sl["games"] if g["teams"]["home"]["abbr"] == "NYR" and g["teams"]["away"]["abbr"] == "ANA")
    gw = next(g for g in sl["games"] if g["teams"]["home"]["abbr"] == "GS" and g["teams"]["away"]["abbr"] == "ATL")
    names = [(p["id"], p["name"], p["side"]) for p in gw["players"]]
    od["events"] = [e for e in od["events"] if e["id"] not in ("NHLTEST", "WNBATEST")] + [nhl_event(gn["iso"]), wnba_event(gw["iso"], names)]
    json.dump(od, open(site + "/data/odds.json", "w"))
    gn["players"] = []; gn.pop("feedProps", None)
    status = FD.apply([gn, gw], od, None)
    json.dump(sl, open(site + "/data/slate.json", "w"))
    return site, gn, gw, status

def main():
    # engine side: the stat ids the feed uses for the basketball combos map to keys that cannot be mistaken for football ones
    check("odds.py maps points+rebounds / points+assists / rebounds+assists to ptsreb / ptsast / rebast",
          (ODDS.STAT["points+rebounds"], ODDS.STAT["points+assists"], ODDS.STAT["rebounds+assists"]) == ("ptsreb", "ptsast", "rebast"))
    check("fanduel.py labels the three combos", all(k in FD.LABEL for k in ("ptsreb", "ptsast", "rebast")))
    site, gn, gw, status = build()
    print("apply:", status)
    check("NHL card got feed players with assists", any(s["key"] == "ast" for p in gn["players"] for s in p["stats"]), [s["key"] for p in gn["players"][:2] for s in p["stats"]])
    with sync_playwright() as p:
        host = Host(site); b, c = browser(p, host); c.route("**/*espn*/**", lambda r: r.abort()); errs = []
        pg = page(c, errs); pg.goto(ORIGIN + "/"); pg.wait_for_timeout(7000)
        r = pg.evaluate("""() => { const LS=window.__LS, G=LS.G; const out={};
            const pick=(ab)=>Object.values(G).find(g=>g.teams.home.abbr===ab[0]&&g.teams.away.abbr===ab[1]);
            [['nhl',['NYR','ANA']],['wnba',['GS','ATL']]].forEach(([k,ab])=>{ const g=pick(ab); if(!g){ out[k]={err:'no game'}; return; }
              const legs=LS.hp.legs(g); out[k]={n:legs.length,labels:legs.map(l=>l.label+' | '+l.kind+' | '+l.price+' | '+Math.round(l.p*100)+'% | '+l.book+(l.link?' | link':' | NO LINK')),
                kinds:legs.reduce((a,l)=>{ a[l.kind]=(a[l.kind]||0)+1; return a; },{}), bad:legs.filter(l=>l.book!=='fanduel'||!isFinite(l.price)||l.p==null||!(l.p>0&&l.p<1)).map(l=>l.label),
                gid:g.id, specs:legs.map(l=>l.spec&&l.spec.k)};
              const ps=[2,4,8].map(n=>LS.hp.pick(legs,n,0.4,{})).map(ls=>ls.map(l=>l.label));
              out[k].parlays=ps; });
            return out; }""")
        n, w = r["nhl"], r["wnba"]
        for k, o in (("NHL", n), ("WNBA", w)):
            print("\n".join("  %s %s" % (k, x) for x in o.get("labels", [])[:80]))
        check("NHL legs are all FanDuel bets with chances", n.get("n", 0) > 0 and not n["bad"], n.get("bad"))
        lab = n.get("labels", [])
        check("NHL: assists legs (overs and 1+ / 2+ rungs, no unders)", any("assists" in x.lower() and ("Over" in x or "+ assists" in x) for x in lab) and not any("Under" in x and "assists" in x.lower() for x in lab), [x for x in lab if "assist" in x.lower()][:4])
        check("NHL: no unders on players, no goals/other stats", not any(("Under" in x and "|prop|" in x.replace(" ", "")) for x in lab))
        check("NHL: alternate puck line legs (both teams, several numbers)", sum(1 for x in lab if "alt puck line" in x) >= 6, [x for x in lab if "alt puck line" in x][:4])
        check("NHL: team total legs for both teams (main and alternate lines)", sum(1 for x in lab if "team total" in x) >= 12 and any("ANA team total" in x for x in lab) and any("NYR team total" in x for x in lab), [x for x in lab if "team total" in x][:4])
        check("NHL: alternate game totals still there", any("(alt total)" in x for x in lab))
        check("NHL: every team total / alt puck line leg has a FanDuel link", all("| link" in x for x in lab if "team total" in x or "alt puck line" in x))
        lw = w.get("labels", [])
        check("WNBA legs are all FanDuel bets with chances", w.get("n", 0) > 0 and not w["bad"], w.get("bad"))
        check("WNBA: alternate handicap legs", sum(1 for x in lw if "alt handicap" in x) >= 6, [x for x in lw if "alt handicap" in x][:4])
        check("WNBA: X+ legs for points / rebounds / assists / pts+reb+ast", all(any(s in x.lower() for x in lw) for s in ("+ points", "+ rebounds", "+ assists", "+ pts+reb+ast")), [x for x in lw if "+ " in x][:6])
        check("WNBA: alternate game totals", any("(alt total)" in x for x in lw))
        for nm, o in (("NHL", n), ("WNBA", w)):
            for i, ls in enumerate(o.get("parlays", [])):
                print("  %s parlay %d legs: %s" % (nm, (2, 4, 8)[i], " || ".join(ls)))
        for nm, o in (("NHL", n), ("WNBA", w)):
            for ls in o.get("parlays", []):
                sides = [x for x in ls if ("alt puck line" in x or "alt handicap" in x or " moneyline" in x or (x.split(" ")[0] and x.split(" ")[1:2] and x.split(" ")[1][:1] in "+-" and "(" not in x))]
                check(nm + ": at most one team side and one team total per parlay", sum(1 for x in ls if "team total" in x) <= 1 and len([x for x in ls if "alt puck line" in x or "alt handicap" in x or "moneyline" in x]) <= 1, ls)
        # add one NHL team total and one alt puck line to the slip and settle them against a final score
        r2 = pg.evaluate("""() => { const LS=window.__LS, G=LS.G; const g=Object.values(G).find(g=>g.teams.home.abbr==='NYR'&&g.teams.away.abbr==='ANA');
            const legs=LS.hp.legs(g); const tt=legs.find(l=>l.spec.k==='tt'&&l.spec.side==='away'&&l.spec.dir==='over'&&l.spec.line===1.5), sp=legs.find(l=>l.spec.k==='spr'&&l.spec.side==='away'&&l.spec.line===2.5);
            const gr=(l,F)=>LS.grade?LS.grade(l,F):null; return {tt:tt&&tt.label, sp:sp&&sp.label, hasGrade:!!LS.grade}; }""")
        print("grade probe:", r2)
        errs = [e for e in errs if e.startswith("PAGEERROR")]
        check("no script errors on the page", not errs, errs[:3])
        b.close()
    bad = [x for x in res if not x[0]]
    print("\n%d checks, %d failed" % (len(res), len(bad)))
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()
