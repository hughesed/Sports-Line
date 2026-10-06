#!/usr/bin/env python3
"""Checks the Same Game Parlay price model against brute force: run thousands of FULL game simulations, count how often a set of legs all hit together,
and compare with the model's joint chance (ls_private.sgp_price) and with the naive 'independent' product.
  python3 fit_sgp.py [sims] [sports,...]      prints a table; exit code 1 if the model is not clearly better than independence."""
import json, sys, math, itertools
import psycopg2
sys.path.insert(0, ".")
from market_test import pyg, PAIRS   # noqa  (importing runs nothing heavy: the test body is under main guard below)

import subprocess, os; subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "load_sim.py")], check=True, stdout=subprocess.DEVNULL)
NSIM = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
SEL = sys.argv[2].split(",") if len(sys.argv) > 2 else ["nfl", "nba", "mlb", "cfb", "cbb"]
conn = psycopg2.connect("host=127.0.0.1 port=54329 dbname=ls user=postgres"); conn.autocommit = True; cur = conn.cursor()

def top(m, side, stat, k=0):
    L = sorted([p for p in m["props"] if p["side"] == side and p["stat"] == stat], key=lambda p: -p["mean"]); return L[k] if len(L) > k else None

def combos(sp, m):
    out = []
    h = lambda st, k=0: top(m, "home", st, k); a = lambda st, k=0: top(m, "away", st, k)
    ov = lambda p: f"p:{p['pid']}:{p['stat']}:over"; un = lambda p: f"p:{p['pid']}:{p['stat']}:under"
    def mid(p):
        r = p["rungs"]; return f"x:{p['pid']}:{p['stat']}:{r[len(r) // 2]['n']}"
    if sp in ("nfl", "cfb"):
        qb = h("passYds"); w1 = h("recYds", 0); w2 = h("recYds", 1); rb = h("rushYds", 0); aq = a("passYds")
        out += [("QB over + home win", ["ml:home", ov(qb)]), ("QB over + total over", ["tot:over", ov(qb)]), ("QB over + WR1 over", [ov(qb), ov(w1)]),
                ("QB over + WR1 + WR2 over", [ov(qb), ov(w1), ov(w2)]), ("RB over + home win", ["ml:home", ov(rb)]), ("RB over + QB over", [ov(rb), ov(qb)]),
                ("away QB over + home win", ["ml:home", ov(aq)]), ("QB over + away QB over", [ov(qb), ov(aq)]), ("QB mid-rung + home win + total over", ["ml:home", "tot:over", mid(qb)]),
                ("WR1 over + home win", ["ml:home", ov(w1)])]
        td = h("tdany", 0)
        if td: out += [("anytime TD + home win", ["ml:home", mid(td)]), ("anytime TD + total over", ["tot:over", mid(td)])]
    elif sp in ("nba", "cbb"):
        s1 = h("pts", 0); s2 = h("pts", 1); r1 = h("reb", 0); a1 = h("ast", 0); pra = h("pra", 0); as1 = a("pts", 0)
        out += [("star pts over + home win", ["ml:home", ov(s1)]), ("star pts + total over", ["tot:over", ov(s1)]), ("star pts + reb over (same player)", [ov(s1), ov(h("reb", 0)) if h("reb", 0)["pid"] == s1["pid"] else mid(h("reb", 0))]),
                ("two teammates pts over", [ov(s1), ov(s2)]), ("star pts over + opp star pts over", [ov(s1), ov(as1)]), ("PRA over + home win", ["ml:home", ov(pra)]),
                ("star pts + assists teammate", [ov(s1), ov(a1)]), ("home win + star over + total over", ["ml:home", "tot:over", ov(s1)]), ("threes mid + pts mid same star", [mid(s1), mid(h("fg3", 0))])]
    else:
        b1 = h("hits", 0); b2 = h("hits", 1); b3 = h("hits", 2); tb = h("tb", 0); rbi = h("rbi", 0); run = h("runs", 1); ab = a("hits", 0)
        out += [("hitter 1+ hit + home win", ["ml:home", mid(b1)]), ("hits + total over", ["tot:over", mid(b1)]), ("two teammates 1+ hit", [mid(b1), mid(b2)]), ("three teammates 1+ hit", [mid(b1), mid(b2), mid(b3)]),
                ("RBI 1+ + home win", ["ml:home", mid(rbi)]), ("run 1+ + RBI 1+ (teammates)", [mid(run), mid(rbi)]), ("hit + tb over same player", [mid(b1), mid(tb) if tb["pid"] == b1["pid"] else ov(tb)]),
                ("home hit + away hit", [mid(b1), mid(ab)])]
    return out

PRICE = "select ls_private.sgp_price(%s::jsonb, (select jsonb_agg(ls_private.battle_leg(%s::jsonb, t)) from unnest(%s::text[]) t), 6000)"
tot_err_model = tot_err_ind = 0.0; n = 0; wrong_dir = 0
for sp in SEL:
    h, a = PAIRS[sp][0]
    cur.execute("select public.battle_markets(%s,%s,%s)", (sp, h, a)); m = cur.fetchone()[0]
    cur.execute("select ls_private.run_sim(%s::jsonb) from generate_series(1,%s)", (json.dumps(m), NSIM)); sims = [r[0] for r in cur.fetchall()]
    print(f"\n[{sp}] {a} @ {h}   ({NSIM} full simulations)")
    print(f"  {'legs':44s} {'sim':>7s} {'model':>7s} {'indep':>7s} | {'uplift sim':>10s} {'model':>6s}")
    for name, toks in combos(sp, m):
        cnt = 0; mc = [0] * len(toks)
        for r in sims:
            g = [pyg(m, t, r["hs"], r["as"], r["players"]) for t in toks]
            if all(x == "W" for x in g): cnt += 1
            for i, x in enumerate(g): mc[i] += (x == "W")
        ps = max(cnt, 0.5) / NSIM; pind_sim = math.prod(max(c_, 0.5) / NSIM for c_ in mc)
        cur.execute(PRICE, (json.dumps(m), json.dumps(m), toks)); q = cur.fetchone()[0]
        pm, pi = float(q["p"]), float(q["pIndep"])
        us, um = ps / pind_sim, pm / pi      # how much each one lifts the joint chance above independence
        e1, e2 = abs(math.log(um / us)), abs(math.log(1.0 / us)); tot_err_model += e1; tot_err_ind += e2; n += 1
        if (um - 1) * (us - 1) < 0 and abs(us - 1) > 0.12: wrong_dir += 1
        print(f"  {name:44s} {ps:7.4f} {pm:7.4f} {pi:7.4f} | {us:10.2f} {um:6.2f}")
print(f"\nmean |log(uplift error)|  model {tot_err_model / n:.3f}   independent {tot_err_ind / n:.3f}   ({n} combos); model on the wrong side of independence in {wrong_dir}")
sys.exit(0 if tot_err_model < tot_err_ind and tot_err_model / n < 0.15 and wrong_dir <= 1 else 1)
