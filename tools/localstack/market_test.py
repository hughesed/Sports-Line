#!/usr/bin/env python3
"""Every battle prop must (1) price, (2) simulate, (3) GRADE correctly, and the simulated player lines must add up to the team scores.
Runs against the local test stack (bash up.sh first).  Usage: python3 market_test.py [sims_per_matchup]"""
import json, sys, time, math, random
import psycopg2

NS = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[0].endswith("market_test.py") else 300
c = psycopg2.connect("host=127.0.0.1 port=54329 dbname=ls user=postgres"); c.autocommit = True; cur = c.cursor()
ok = fail = 0
def check(cond, msg):
    global ok, fail
    if cond: ok += 1
    else: fail += 1; print("  FAIL:", msg)

def teams_with_players(sp, n=2, need=8):
    cur.execute("select team from sim_players where sport=%s group by team having count(*)>=%s order by team", (sp, need))
    t = [r[0] for r in cur.fetchall()]
    random.Random(7).shuffle(t)
    return [(t[2 * i], t[2 * i + 1]) for i in range(min(n, len(t) // 2))]

PAIRS = {"nfl": [("KC", "BUF"), ("DET", "GB")], "nba": [("BOS", "LAL"), ("DEN", "OKC")], "mlb": [("NYY", "LAD"), ("HOU", "ATL")]}
for sp in ("cfb", "cbb"): PAIRS[sp] = teams_with_players(sp)

def tokens(m):
    toks = ["ml:home", "ml:away", "spr:home", "spr:away", "tot:over", "tot:under"]
    for p in m["props"]:
        if not p["yn"]: toks += [f"p:{p['pid']}:{p['stat']}:over", f"p:{p['pid']}:{p['stat']}:under"]
        toks += [f"x:{p['pid']}:{p['stat']}:{r['n']}" for r in p["rungs"]]
    return toks

def pyg(m, tok, hs, as_, pl):
    q = tok.split(":"); d = hs - as_
    if q[0] == "ml": return "V" if d == 0 else ("W" if (q[1] == "home") == (d > 0) else "L")
    if q[0] == "spr":
        v = (d if q[1] == "home" else -d) + float(m["spr"][q[1] + "Line"]); return "V" if v == 0 else ("W" if v > 0 else "L")
    if q[0] == "tot":
        t = hs + as_; ln = float(m["tot"]["line"]); return "V" if t == ln else ("W" if (q[1] == "over") == (t > ln) else "L")
    x = (pl.get(q[1]) or {}).get(q[2], 0)
    if q[0] == "x": return "W" if x >= int(q[3]) else "L"
    ln = next(float(p["line"]) for p in m["props"] if p["pid"] == q[1] and p["stat"] == q[2])
    return "V" if x == ln else ("W" if (q[3] == "over") == (x > ln) else "L")

def sums(sp, m, r):
    pl = r["players"]; out = []
    for side in ("home", "away"):
        T = pl["_" + side]; mine = [p for p in m["players"] if p["side"] == side]
        g = lambda p, k: (pl.get(p["pid"]) or {}).get(k, 0)
        if sp in ("nfl", "cfb"):
            qbs = [p for p in mine if p["role"] == "QB"]
            out.append((qbs and g(qbs[0], "passYds") == T["passYds"] and g(qbs[0], "passTD") == T["passTD"] or not qbs, f"{side} QB pass yds/TD = team"))
            out.append((sum(g(p, "rushYds") for p in mine) <= T["rushYds"] + 1, f"{side} listed rush yds <= team rush yds"))
            out.append((sum(g(p, "recYds") for p in mine) <= T["passYds"] + 1, f"{side} listed rec yds <= team pass yds"))
            out.append((sum(g(p, "rec") for p in mine) >= 0, "rec"))
            out.append((sum(g(p, "tdany") for p in mine) <= T["tds"], f"{side} anytime TD scorers <= team TDs"))
            out.append((T["pts"] >= 6 * T["tds"] - 0 and T["pts"] <= 8 * T["tds"] + 24, f"{side} points consistent with TDs"))
            out.append((T["passTD"] <= T["tds"], f"{side} pass TDs <= TDs"))
        elif sp in ("nba", "cbb"):
            s = sum(g(p, "pts") for p in mine)
            out.append((s <= T["pts"], f"{side} listed pts {s} <= team {T['pts']}"))
            out.append((s + T.get("othPts", 0) == T["pts"], f"{side} listed pts + others = team pts ({s}+{T.get('othPts')} vs {T['pts']})"))
            out.append((sum(g(p, "reb") for p in mine) <= T["reb"], f"{side} reb"))
            out.append((sum(g(p, "ast") for p in mine) <= T["ast"] + 0, f"{side} ast"))
            out.append((all(g(p, "pra") == g(p, "pts") + g(p, "reb") + g(p, "ast") for p in mine), f"{side} PRA = pts+reb+ast"))
            out.append((all(g(p, "fg3") * 3 <= g(p, "pts") for p in mine), f"{side} threes*3 <= points"))
        else:
            score = hs_ = r["hs"] if side == "home" else r["as"]
            hit = [p for p in mine if p["role"] == "H"]
            out.append((sum(g(p, "runs") for p in hit) <= score + 0, f"{side} runs scored by listed <= team runs"))
            out.append((sum(g(p, "rbi") for p in hit) <= score, f"{side} RBIs <= team runs"))
            out.append((all(g(p, "tb") >= g(p, "hits") for p in hit), f"{side} TB >= H"))
            out.append((all(g(p, "hr") <= g(p, "hits") for p in hit), f"{side} HR <= H"))
            out.append((all(g(p, "tb") >= 4 * g(p, "hr") for p in hit), f"{side} TB >= 4*HR"))
    return out

def run_all():
    global ok, fail
    SEL = sys.argv[2].split(',') if len(sys.argv) > 2 else list(PAIRS)
    for sp, prs in PAIRS.items():
        if sp not in SEL: continue
        for h, a in prs:
            print(f"[{sp}] {a} @ {h}")
            t = time.time(); cur.execute("select public.battle_markets(%s,%s,%s)", (sp, h, a)); m = cur.fetchone()[0]; tm = time.time() - t
            np_ = len(m["props"]); per = {s: len({p['pid'] for p in m['players'] if p['side'] == s}) for s in ("home", "away")}
            print(f"  markets {tm * 1000:.0f} ms, {np_} props, players per side {per}, {len(json.dumps(m)) // 1024} KB")
            check(tm < 1.0, "battle_markets < 1 s")
            check(np_ >= 20 and min(per.values()) >= 8, f"enough props/players ({np_}, {per})")
            toks = tokens(m)
            # whole start_battle path: sim + events
            t = time.time(); cur.execute("select ls_private.run_sim(%s::jsonb) from generate_series(1,%s)", (json.dumps(m), NS)); sims = [x[0] for x in cur.fetchall()]; ts = time.time() - t
            print(f"  {NS} sims in {ts:.1f}s ({ts / NS * 1000:.1f} ms each)")
            check(ts / NS < 0.5, "one sim under 0.5 s")
            bad = 0
            for r in sims:
                for good, msg in sums(sp, m, r):
                    if not good:
                        bad += 1
                        if bad <= 3: print("  sum-check failed:", msg, json.dumps({k: v for k, v in r["players"].items() if k.startswith("_")}))
            check(bad == 0, f"sum-consistency across {NS} sims ({bad} violations)")
            # grading: SQL vs python, every token, 25 sims
            gb = 0
            for r in sims[:25]:
                cur.execute("select tok, ls_private.grade_battle_leg(%s::jsonb, tok, %s, %s, %s::jsonb) from unnest(%s::text[]) tok", (json.dumps(m), r["hs"], r["as"], json.dumps(r["players"]), toks))
                for tok, g in cur.fetchall():
                    if g != pyg(m, tok, r["hs"], r["as"], r["players"]):
                        gb += 1
                        if gb <= 3: print("  grade mismatch", tok, g, pyg(m, tok, r["hs"], r["as"], r["players"]))
            check(gb == 0, f"grading of {len(toks)} tokens x 25 sims matches ({gb} mismatches)")
            # every leg resolves to a priced leg
            cur.execute("select count(*) filter (where ls_private.battle_leg(%s::jsonb, tok) is null) from unnest(%s::text[]) tok", (json.dumps(m), toks))
            check(cur.fetchone()[0] == 0, "every market token resolves")
            # realism: simulated mean vs the priced mean, per stat family
            worst = []
            for p in m["props"]:
                vals = [(r["players"].get(p["pid"]) or {}).get(p["stat"], 0) for r in sims]
                mu = sum(vals) / len(vals); sd = (sum((v - mu) ** 2 for v in vals) / len(vals)) ** 0.5
                ph = sum(1 for v in vals if v >= (math.floor(p["line"]) + 1)) / len(vals) if not p["yn"] else sum(1 for v in vals if v >= 1) / len(vals)
                # implied P(over) from the posted price
                pr_over = p["over"] if not p["yn"] else p.get("yes")
                worst.append((abs(mu - p["mean"]) / max(p["mean"], 25.0 if "Yds" in p["stat"] or p["stat"] == "outs" else 1.0), p["name"], p["stat"], round(p["mean"], 2), round(mu, 2), round(sd, 2), round(p["sd"], 2)))
            worst.sort(reverse=True)
            print("  largest sim-vs-line mean gaps (rel):", [(w[1].split()[-1], w[2], w[3], w[4]) for w in worst[:4]])
            check(worst[0][0] < 0.30, f"sim means within 30% of priced means (worst {worst[0]})")
            avg = sum(w[0] for w in worst) / len(worst); check(avg < 0.10, f"avg relative gap {avg:.3f} < 0.10")
            # league-level
            hs = sum(r["hs"] for r in sims) / NS; as_ = sum(r["as"] for r in sims) / NS
            print(f"  sim avg score home {hs:.1f} (priced {m['eh']}) away {as_:.1f} (priced {m['ea']})")
            check(abs(hs - m["simh"]) < max(0.12 * m["simh"], 1.0) and abs(as_ - m["sima"]) < max(0.12 * m["sima"], 1.0), "team scores track the priced expectations")

    print(f"\nmarket_test: {ok} passed, {fail} failed")
    return 1 if fail else 0

if __name__ == '__main__':
    sys.exit(run_all())
