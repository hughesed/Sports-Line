import json, os, sys, math, glob, datetime, statistics, collections
sys.path.insert(0, os.path.dirname(__file__))
import learn
from learn import *
import ctxfactors as CF
from timeutil import et_date_of
CTXC = {}
def tg_of(games, ab):
    out = []
    for g in games:
        if g["home"] == ab: out.append(dict(date=g["date"], home=True))
        elif g["away"] == ab: out.append(dict(date=g["date"], home=False))
    return out
def brief(cx):
    return dict(net=round(-(cx["off"] + cx["deff"]), 2), items=[dict(kind=i["kind"], text=i["text"][:110], pts=i["pts"]) for i in cx["items"]][:4], stars=[dict(name=s["name"], pos=s["pos"], cat=s["cats"][0]["label"], rank=s["cats"][0]["rank"], pts=s["pts"], unit=s["unit"]) for s in cx["stars"]][:2])

LEAGUES = ("nfl", "wnba", "mlb", "nba", "cfb", "cbb", "nhl")
SPREAD_T = {"nfl": 3.0, "wnba": 2.5, "nba": 2.5, "cfb": 3.5, "cbb": 3.0, "nhl": 99.0}; TOTAL_T = {"nhl": 0.5, "nfl": 4.0, "wnba": 4.0, "mlb": 0.6, "nba": 5.0, "cfb": 4.5, "cbb": 5.0}; ML_T = {"nfl": 0.06, "wnba": 0.05, "mlb": 0.04, "nba": 0.05, "cfb": 0.06, "cbb": 0.05, "nhl": 0.04}
CLOSE_T = {"nfl": 8, "wnba": 8, "mlb": 2, "nba": 8, "cfb": 8, "cbb": 8, "nhl": 1}       # "one-score game" margin
FLOOR_W = 0.15                                    # keep a minimum share of the model so it can still disagree with the book
CALIB = {}                                        # per-league win-chance slope learned from the bot's own graded predictions (set by refresh.py)
CALIB_BOUNDS = (0.85, 1.15)

def rank_map(m, teams):
    big = getattr(m, "big", None)
    if big: teams = [t for t in teams if t in big]
    o = sorted(teams, key=lambda t: -m.o[t]); d = sorted(teams, key=lambda t: m.d[t])
    return {t: (o.index(t) + 1, d.index(t) + 1) for t in teams}

def final_proj(lg, R, mm, mt, b, calib=False):
    """blend raw model margin/total with the book using fitted weights (floor FLOOR_W). returns dict.
    calib=True applies the bounded slope fitted on the bot's own graded predictions to the win chance (never to backtest rows)."""
    sd = R["sd"]; bl = R["blend"]
    wm = max(bl["m"], FLOOR_W) if bl.get("m") is not None else FLOOR_W
    wt = max(bl["t"], FLOOR_W) if bl.get("t") is not None else FLOOR_W
    wp = max(bl["p"], FLOOR_W) if bl.get("p") is not None else FLOOR_W
    pm = phi(mm / sd["m"]); fm = mm; ft = mt; fp = pm
    if b:
        if b.get("spr") is not None: fm = wm * mm + (1 - wm) * (-b["spr"])
        if b.get("total"): ft = wt * mt + (1 - wt) * b["total"]
        if b.get("pml") is not None: fp = sig(wp * logit(pm) + (1 - wp) * logit(b["pml"]))
        elif b.get("spr") is not None: fp = phi(fm / sd["m"])
        if b.get("spr") is None and b.get("pml") is not None:   # baseball: margin implied by the blended win chance
            z = 0.0
            lo, hi = -6, 6
            for _ in range(40):
                z = (lo + hi) / 2
                if phi(z) < fp: lo = z
                else: hi = z
            fm = z * sd["m"]
    fp0 = fp
    s = CALIB.get(lg, 1.0) if calib else 1.0
    if s != 1.0:
        s = max(CALIB_BOUNDS[0], min(CALIB_BOUNDS[1], s)); fp = sig(s * logit(fp))
    return dict(fm=fm, ft=ft, fp=fp, fp0=fp0, w=dict(m=wm, t=wt, p=wp), slope=s)

def verdicts(lg, r, fin, b):
    """what the model was 'supposed to' do: ML pick, spread/total lean vs the line, one-score call, and whether each worked"""
    hs, as_ = r["hs"], r["as_"]; margin = hs - as_; total = hs + as_
    v = {}
    pick_home = fin["fp"] >= 0.5
    v["ml"] = dict(pick=r["home"] if pick_home else r["away"], p=round(max(fin["fp"], 1 - fin["fp"]), 3), ok=(margin > 0) == pick_home)
    if b and b.get("spr") is not None and lg in SPREAD_T:
        gap = r["mm"] - (-b["spr"])
        if abs(gap) >= SPREAD_T[lg]:
            side_home = gap > 0; cover = margin + b["spr"]
            v["spr"] = dict(pick=(r["home"] if side_home else r["away"]), line=(b["spr"] if side_home else -b["spr"]), gap=round(gap, 1),
                            ok=None if cover == 0 else ((cover > 0) == side_home))
    if b and b.get("total"):
        gap = r["mt"] - b["total"]
        if abs(gap) >= TOTAL_T[lg]:
            over = gap > 0
            v["tot"] = dict(pick="Over" if over else "Under", line=b["total"], gap=round(gap, 1), ok=None if total == b["total"] else ((total > b["total"]) == over))
    if b and b.get("pml") is not None and lg in ("mlb", "nhl"):
        gap = r["pH"] - b["pml"]
        if abs(gap) >= ML_T[lg]:
            h = gap > 0; v["mlLean"] = dict(pick=r["home"] if h else r["away"], gap=round(gap, 3), ok=(margin > 0) == h)
    close_pred = abs(fin["fm"]) <= CLOSE_T[lg] * 0.6
    v["close"] = dict(called=close_pred, actual=abs(margin) <= CLOSE_T[lg], margin=abs(margin))
    return v

def lean_stats(lg, rows):
    """historic hit rate of the model's leans vs the closing line (out-of-sample rows only)"""
    out = {}
    s = [0, 0]; t = [0, 0]; m = [0, 0]
    for r in rows:
        b = r["b"]
        if not b: continue
        margin = r["hs"] - r["as_"]; total = r["hs"] + r["as_"]
        if b.get("spr") is not None and lg in SPREAD_T:
            gap = r["mm"] + b["spr"]
            if abs(gap) >= SPREAD_T[lg] and margin + b["spr"] != 0:
                s[1] += 1; s[0] += ((margin + b["spr"] > 0) == (gap > 0))
        if b.get("total"):
            gap = r["mt"] - b["total"]
            if abs(gap) >= TOTAL_T[lg] and total != b["total"]:
                t[1] += 1; t[0] += ((total > b["total"]) == (gap > 0))
        if b.get("pml") is not None and lg in ("mlb", "nhl"):
            gap = r["pH"] - b["pml"]
            if abs(gap) >= ML_T[lg]: m[1] += 1; m[0] += ((margin > 0) == (gap > 0))
    if s[1]: out["spread"] = dict(hit=s[0], n=s[1])
    if t[1]: out["total"] = dict(hit=t[0], n=t[1])
    if m[1]: out["mlLean"] = dict(hit=m[0], n=m[1])
    return out

def parse_sched_odds(e, home, away):
    c = e["competitions"][0]; o = (c.get("odds") or [None])[0]
    if not o: return None
    b = dict(spr=None, total=o.get("overUnder"), pml=None, mlH=None, mlA=None, dk={})
    import re
    m = re.match(r"(\w+)\s+([+-]?[\d.]+)", o.get("details") or "")
    ml = o.get("moneyline") or {}
    def amer(x):
        try: return int(str(x).replace("+", ""))
        except: return None
    if ml.get("home"): b["mlH"] = amer(ml["home"].get("close", {}).get("odds") or ml["home"].get("open", {}).get("odds"))
    if ml.get("away"): b["mlA"] = amer(ml["away"].get("close", {}).get("odds") or ml["away"].get("open", {}).get("odds"))
    if b["mlH"] is not None and b["mlA"] is not None:
        h, a = ml_prob(b["mlH"]), ml_prob(b["mlA"]); b["pml"] = h / (h + a)
    ps = o.get("pointSpread") or {}
    if ps.get("home") and ps["home"].get("close", {}).get("line") not in (None, ""):
        try: b["spr"] = float(ps["home"]["close"]["line"])
        except: pass
    return b

def build_learn(today, slate_count, sched_events, prev=None, live=None, log=print):
    """today: datetime.date (ET). sched_events: {lg: [scoreboard events for today..today+4]}. prev: previous learn.json (used per league if a league fails).
    live: calibration summary from the bot's own graded predictions (added under leagues[lg]['live'])."""
    learn.set_today(today)
    TODAY = today; WIN0 = today - datetime.timedelta(days=7)
    out = dict(leagues={}, days=[], gen=1)
    window = {}; errors = {}
    for lg in LEAGUES:
        try:
            part_l, part_w, part_s = league_block(lg, today, WIN0, sched_events.get(lg) or [])
        except Exception as ex:
            import traceback; traceback.print_exc()
            errors[lg] = f"{type(ex).__name__}: {ex}"[:300]
            pv = (prev or {})
            if lg in (pv.get("leagues") or {}):
                out["leagues"][lg] = pv["leagues"][lg]
                for dd, gs in (pv.get("window") or {}).items():
                    k = [x for x in gs if x.get("lg") == lg]
                    if k: window.setdefault(dd, []).extend(k)
                for dd, gs in (pv.get("sched") or {}).items():
                    k = [x for x in gs if x.get("lg") == lg]
                    if k: out.setdefault("sched", {}).setdefault(dd, []).extend(k)
            continue
        out["leagues"][lg] = part_l
        for dd, gs in part_w.items(): window.setdefault(dd, []).extend(gs)
        for dd, gs in part_s.items(): out.setdefault("sched", {}).setdefault(dd, []).extend(gs)
        if live and lg in live: out["leagues"][lg]["live"] = live[lg]
    days = []
    for k in range(-7, 5):
        d = TODAY + datetime.timedelta(days=k); ds = str(d)
        if k < 0: n = len(window.get(ds, [])); kind = "past"
        elif k == 0: n = slate_count; kind = "today"
        else: n = len([x for x in out.get("sched", {}).get(ds, []) if not x.get("tbd")]); kind = "future"
        days.append(dict(date=ds, n=n, kind=kind, ok=n > 0))
    out["days"] = days
    out["window"] = window
    for dd in out.get("sched", {}):
        out["sched"][dd].sort(key=lambda x: (x["date"], x["id"]))
    if live: out["live"] = live.get("_all")
    out["errors"] = errors
    return out

def league_block(lg, today, WIN0, events):
    TODAY = today
    R = run_league(lg)
    rows = R["rows"]; skip = int(len(rows) * 0.3)
    oos = rows[skip:]
    # gen 0: untuned middle-of-the-grid parameters, for the learning log
    g0 = {k: v[len(v) // 2 - 1 if len(v) > 1 else 0] for k, v in GRID[lg].items()}
    m0, rec0 = walk(lg, R["games"], g0, True)
    s0 = score_recs(rec0, skip); s1 = R["tune_score"]
    acc0 = sum(1 for r in rec0[skip:] if (r["ph"] - r["pa"] > 0) == (r["g"]["hs"] > r["g"]["as_"])) / max(1, len(rec0[skip:]))
    # final (blended) predictions + summaries (backtest rows are never touched by the live calibration)
    for r in rows:
        fin = final_proj(lg, R, r["mm"], r["mt"], r["b"]); r.update(fm=fin["fm"], ft=fin["ft"], fp=fin["fp"])
    summ = summarize(oos, lg)
    # reliability of the final win chance
    buckets = collections.defaultdict(lambda: [0, 0])
    for r in oos:
        p = max(r["fp"], 1 - r["fp"]); win = (r["hs"] > r["as_"]) == (r["fp"] >= 0.5)
        k = min(int(p * 10), 9) / 10; buckets[k][0] += win; buckets[k][1] += 1
    rel = [dict(lo=k, n=v[1], hit=round(v[0] / v[1], 3)) for k, v in sorted(buckets.items()) if v[1] >= 5]
    # month by month accuracy trend (learning curve)
    mon = collections.defaultdict(lambda: [0, 0])
    for r in oos:
        k = r["day"][:7]; mon[k][0] += ((r["fp"] >= 0.5) == (r["hs"] > r["as_"])); mon[k][1] += 1
    L_out = dict(params=R["params"], gen0=g0, mse0=round(s0, 2), mse1=round(s1, 2), acc0=round(acc0, 3), sd={k: round(v, 2) for k, v in R["sd"].items()},
                 blend={k: v for k, v in R["blend"].items()}, test=R["test"], n=R["n_games"], summary={k: round(v, 3) for k, v in summ.items()},
                 leans=lean_stats(lg, oos), reliability=rel, monthly=[dict(m=k, n=v[1], acc=round(v[0] / v[1], 3)) for k, v in sorted(mon.items()) if v[1] >= 8][-14:])
    m = R["model"]
    window = {}; sched = {}
    by_day = collections.defaultdict(list)
    for g in R["games"]: by_day[et_date(g["date"])].append(g)
    mo = Model(R["params"]); mo.big = getattr(m, "big", None); cs = None; snaps = {}
    for day in sorted(by_day):
        if lg in ("nfl", "nba", "cfb", "nhl"):
            sd_ = by_day[day][0].get("season")
            if cs is None: cs = sd_
            elif sd_ != cs: mo.new_season(); cs = sd_
        if WIN0 <= day < TODAY:
            snaps[day] = (rank_map(mo, list(mo.o.keys())), {t: (round(mo.o[t], 2), round(mo.d[t], 2), mo.gp[t]) for t in mo.o})
        for g in by_day[day]: mo.learn(g)
    for r in rows:
        d = datetime.date.fromisoformat(r["day"])
        if WIN0 <= d < TODAY:
            fin = dict(fm=r["fm"], ft=r["ft"], fp=r["fp"])
            rk, vals = snaps[d]
            v = verdicts(lg, r, fin, r["b"])
            window.setdefault(r["day"], []).append(dict(
                id=r["id"], lg=lg, home=r["home"], away=r["away"], hs=r["hs"], as_=r["as_"], mm=round(r["mm"], 1), mt=round(r["mt"], 1), fm=round(r["fm"], 1), ft=round(r["ft"], 1),
                pH=round(r["fp"], 3), book=(dict(spr=r["b"].get("spr"), total=r["b"].get("total"), pml=(round(r["b"]["pml"], 3) if r["b"].get("pml") is not None else None), mlH=r["b"].get("mlH"), mlA=r["b"].get("mlA")) if r["b"] else None),
                v=v, rk=dict(home=rk.get(r["home"]), away=rk.get(r["away"])), rt=dict(home=vals.get(r["home"]), away=vals.get(r["away"]))))
    L_out["ratings"] = {t: dict(o=round(m.o[t], 2), d=round(m.d[t], 2), gp=m.gp[t]) for t in m.o}
    L_out["L"] = round(m.L, 2)
    L_out["nTeams"] = len(m.big) if getattr(m, "big", None) else len(m.o)
    # scheduled games (today .. +4 days)
    rk = rank_map(m, list(m.o.keys()))
    for e in events:
        c = e["competitions"][0]
        day = et_date(e["date"])
        if day < TODAY or day > TODAY + datetime.timedelta(days=4): continue
        comps = {x["homeAway"]: x for x in c["competitors"]}
        if "home" not in comps or "away" not in comps: continue
        h = comps["home"]["team"]["abbreviation"]; a = comps["away"]["team"]["abbreviation"]
        stt = e["status"]["type"]["name"].replace("STATUS_", "")
        if h in ("TBD",) or a in ("TBD",) or h not in m.o or a not in m.o:
            sched.setdefault(str(day), []).append(dict(id=e["id"], lg=lg, home=h, away=a, date=e["date"], status=stt, tbd=True)); continue
        b = parse_sched_odds(e, h, a)
        ph, pa = m.predict(h, a); mm = ph - pa; mt = ph + pa
        ctxb = None; adj = 0.0
        try:
            Cx = CTXC.get(lg) or CTXC.setdefault(lg, CF.fetch(lg)); notable = [x["name"] for x in Cx["leaders"]]
            ti = {sd: comps[sd]["team"] for sd in ("home", "away")}
            if h in rk and a in rk:
                NTm = len(rk); cxs = {}
                for sd, op in (("home", "away"), ("away", "home")):
                    me_ab, op_ab = ti[sd]["abbreviation"], ti[op]["abbreviation"]
                    cxs[sd] = CF.team_context(lg, Cx, ti[sd]["id"], ti[op]["id"], sd, tg_of(R["games"], me_ab), e["date"], rk[me_ab][1], rk[me_ab][0], NTm, rk[op_ab][1], rk[op_ab][0], notable, [], [ti[sd].get("shortDisplayName"), ti[sd]["displayName"].split()[-1]])
                d_h = -cxs["home"]["off"] + cxs["away"]["deff"]; d_a = -cxs["away"]["off"] + cxs["home"]["deff"]
                mm += d_h - d_a; mt += d_h + d_a; adj = d_h - d_a
                ctxb = dict(home=brief(cxs["home"]), away=brief(cxs["away"]))
        except Exception as ex:
            print("ctx fail", lg, h, a, ex)
        if not b: mm *= 0.65   # no book line yet (early look): pull the margin toward even
        fin = final_proj(lg, R, mm, mt, b, calib=True)
        sched.setdefault(str(day), []).append(dict(
            id=e["id"], lg=lg, home=h, away=a, date=e["date"], status=stt, mm=round(mm, 1), mt=round(mt, 1), fm=round(fin["fm"], 1), ft=round(fin["ft"], 1), pH=round(fin["fp"], 3),
            book=(dict(spr=b["spr"], total=b["total"], pml=(round(b["pml"], 3) if b["pml"] is not None else None), mlH=b["mlH"], mlA=b["mlA"]) if b else None),
            rk=(dict(home=rk[h], away=rk[a]) if (h in rk and a in rk) else None), ctx=ctxb, adj=round(adj, 1), names=dict(home=comps["home"]["team"].get("displayName"), away=comps["away"]["team"].get("displayName"))))
    return L_out, window, sched
