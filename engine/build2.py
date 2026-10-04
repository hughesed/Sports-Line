"""Team-level game cards for NBA / college football / college basketball (no player props: the book feed does not publish them for these),
and the fallback card for NFL / WNBA / MLB games whose player-level build fails. Same crossroads model as the main build: learned ratings + injuries + context factors, anchored to the book."""
import sys, os, json, math, statistics, datetime, re, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as B1
import learn_export as LEX
import ctxfactors as CF
from games_all import load
from espn import curl, D, SP, gamelog, SB, CORE
ET = B1.ET; clamp = B1.clamp; r1 = B1.r1
FAM = {"cfb": "nfl", "nba": "wnba", "cbb": "wnba", "nfl": "nfl", "wnba": "wnba", "mlb": "mlb"}
NAME = {"cfb": "College Football", "nba": "NBA", "cbb": "College Basketball", "nfl": "NFL", "wnba": "WNBA", "mlb": "MLB"}
SPREAD_T = dict(LEX.SPREAD_T); SPREAD_T["mlb"] = 99.0; TOTAL_T = LEX.TOTAL_T; ML_T = LEX.ML_T
CTX_ON = True

def am(x):
    try: return int(float(str(x).replace("+", "")))
    except Exception: return None

def team_blocks(lg, LR, games):
    """per-team season-to-date numbers from results; ranks among real top-flight teams only"""
    cur = max(g["season"] for g in games)
    cnt = collections.Counter(); pf = collections.defaultdict(float); pa = collections.defaultdict(float); gp = collections.Counter()
    for g in games:
        cnt[g["home"]] += 1; cnt[g["away"]] += 1
        if g["season"] != cur: continue
        pf[g["home"]] += g["hs"]; pa[g["home"]] += g["as_"]; pf[g["away"]] += g["as_"]; pa[g["away"]] += g["hs"]; gp[g["home"]] += 1; gp[g["away"]] += 1
    minn = {"cfb": 6, "cbb": 20, "nba": 20, "nfl": 1, "wnba": 1, "mlb": 1}[lg]
    big = [t for t in LR["model"].o if cnt[t] >= minn]
    m = LR["model"]
    so = statistics.pstdev([m.o[t] for t in big]) or 1; sd_ = statistics.pstdev([m.d[t] for t in big]) or 1
    ro = sorted(big, key=lambda t: -m.o[t]); rd = sorted(big, key=lambda t: m.d[t])
    return dict(cur=cur, big=set(big), N=len(big), so=so, sd=sd_, ro=ro, rd=rd, pf=pf, pa=pa, gp=gp, m=m)

def tgames(games, abbr):
    out = []
    for g in games:
        if g["home"] == abbr: out.append(dict(id=g["id"], date=g["date"], opp=g["away"], home=True, pf=g["hs"], pa=g["as_"], win=g["hs"] > g["as_"], post=g["post"], season=g["season"]))
        elif g["away"] == abbr: out.append(dict(id=g["id"], date=g["date"], opp=g["home"], home=False, pf=g["as_"], pa=g["hs"], win=g["as_"] > g["hs"], post=g["post"], season=g["season"]))
    return out

def parse_core(core, lg=None):
    ho, ao = core["homeTeamOdds"], core["awayTeamOdds"]
    ml_h, ml_a = am(ho.get("moneyLine")), am(ao.get("moneyLine"))
    cur_h, cur_a = ho.get("current") or {}, ao.get("current") or {}
    spr_h = float(cur_h["pointSpread"]["american"]); spr_a = float(cur_a["pointSpread"]["american"])
    pr_h = am((cur_h.get("spread") or {}).get("american")) or -110; pr_a = am((cur_a.get("spread") or {}).get("american")) or -110
    if lg == "mlb" and ml_h is not None and ml_a is not None:   # feed labels conflict with the moneyline; give the -1.5 to the moneyline favorite
        fav_home = ml_h < ml_a; plus = max(pr_h, pr_a); minus = min(pr_h, pr_a)
        if fav_home: spr_h, spr_a, pr_h, pr_a = -1.5, 1.5, plus, minus
        else: spr_h, spr_a, pr_h, pr_a = 1.5, -1.5, minus, plus
    total = float(core["overUnder"]); oo = am(core.get("overOdds")) or -110; uo = am(core.get("underOdds")) or -110
    return dict(ml_h=ml_h, ml_a=ml_a, spr_h=spr_h, spr_a=spr_a, pr_h=pr_h, pr_a=pr_a, total=total, o=oo, u=uo)

def prep(lg, ctx_refresh=True):
    """per-league inputs shared by every game card of the league"""
    sport, l = SP[lg]
    LR = B1.learned(lg)
    games = load(lg); TB = team_blocks(lg, LR, games)
    C = CF.fetch(lg, ctx_refresh) if CTX_ON else None
    inj_all = (curl(f"{SB}{sport}/{l}/injuries") or {}).get("injuries", [])
    return dict(LR=LR, games=games, TB=TB, C=C, inj_all=inj_all)

def build_event(lg, e, core_item, PR):
    comp = e["competitions"][0]
    ch = [c for c in comp["competitors"] if c["homeAway"] == "home"][0]; ca = [c for c in comp["competitors"] if c["homeAway"] == "away"][0]
    ha, aa = ch["team"]["abbreviation"], ca["team"]["abbreviation"]
    mdl = PR["LR"]["model"]
    if ha not in mdl.o or aa not in mdl.o: raise RuntimeError(f"teams not in the learned model: {aa} @ {ha}")
    ln = parse_core(core_item, lg)
    return make_game(lg, e, comp, ch, ca, ha, aa, ln, PR["LR"], PR["TB"], PR["games"], PR["C"], PR["inj_all"])

def injuries_for(lg, tid, inj_all, game_dt):
    lst = [t for t in inj_all if str(t["id"]) == str(tid)]
    res = []
    if not lst: return res
    for i in lst[0].get("injuries", []):
        cl = B1.classify_injury(i, game_dt)
        if not cl: continue
        a = i["athlete"]; pos = (a.get("position") or {}).get("abbreviation") if isinstance(a.get("position"), dict) else a.get("position")
        res.append(dict(id=B1.athlete_id(a), name=a["displayName"], pos=pos, status=i.get("status"), label=cl["label"], kind=cl["kind"], weight=cl["weight"], reason=cl["reason"], ret=cl["ret"], date=i["date"][:10], note=(i.get("shortComment") or "").strip()))
    return res

def injury_impact(lg, inj, tg):
    off = 0.0; deff = 0.0; notes = []
    last = tg[-1]["date"][:10] if tg else "0000"
    for i in inj:
        w = i["weight"]
        if w <= 0 or i["kind"] in ("returning", "inactive"): continue
        if i["date"] < last: continue            # absence began before the team's last game: already in its results
        if lg == "mlb":
            if i["pos"] in ("2B", "SS", "3B", "1B", "LF", "CF", "RF", "C", "DH") and not B1.baked_in("mlb", dict(_tg=tg), i):
                imp = 0.12 * w; off += imp; notes.append(f"{i['name']} ({i['pos']}) {i['label']}: -{imp:.2f} runs")
        elif lg in ("cfb", "nfl"):
            if i["pos"] == "QB": offp = 4.0 * w; off += offp; notes.append(f"{i['name']} (QB) {i['label']}: −{offp:.1f} pts")
            elif i["pos"] in ("RB", "WR", "TE"): offp = 0.6 * w; off += offp; notes.append(f"{i['name']} ({i['pos']}) {i['label']}: −{offp:.1f} pts")
            elif i["pos"] in ("OL", "OT", "OG", "C", "G", "T"): offp = 0.4 * w; off += offp; notes.append(f"{i['name']} ({i['pos']}) {i['label']}: −{offp:.1f} pts (OL starter assumed)")
            elif i["pos"] in ("DE", "DT", "DL", "LB", "CB", "S", "DB", "EDGE"): d = 0.45 * w; deff += d; notes.append(f"{i['name']} ({i['pos']}) {i['label']}: +{d:.2f} pts allowed")
        else:
            r = gamelog(lg, i["id"])
            if r:
                gl = [g for g in r[1] if (g["stats"].get("minutes") or 0) > 0][-10:]
                if gl:
                    ppg = statistics.mean(B1.v(g, "points") for g in gl); apg = statistics.mean(B1.v(g, "assists") for g in gl); mpg = statistics.mean(B1.v(g, "minutes") for g in gl)
                    imp = 0.55 * (ppg + apg) * w * clamp(mpg / 30, 0.3, 1.0)
                    if imp >= 0.1: off += imp; notes.append(f"{i['name']} ({ppg:.0f} pts, {apg:.0f} ast) {i['label']}: −{imp:.1f} pts")
    cap = {"cfb": 6.0, "nba": 8.0, "cbb": 8.0, "nfl": 6.0, "wnba": 8.0, "mlb": 0.6}[lg]
    return dict(off=round(min(off, cap), 2), deff=round(min(deff, cap / 2), 2), notes=notes)

def make_game(lg, e, comp, ch, ca, ha, aa, ln, LR, TB, games, C, inj_all):
    m = TB["m"]; fam = FAM[lg]
    start = datetime.datetime.fromisoformat(e["date"].replace("Z", "+00:00")).astimezone(ET); game_dt = e["date"]
    teams = {}
    for side, c, ab in (("away", ca, aa), ("home", ch, ha)):
        tg = tgames(games, ab); cur = [g for g in tg if g["season"] == TB["cur"]]
        gp = TB["gp"][ab]; pf = TB["pf"][ab] / gp if gp else 0; pa = TB["pa"][ab] / gp if gp else 0
        rec = ([r["summary"] for r in c.get("records", []) if r["name"] == "overall"] or [""])[0]
        if not rec: w = sum(1 for g in cur if g["win"]); rec = f"{w}-{len(cur) - w}"
        offb = clamp(50 + 20 * m.o[ab] / TB["so"], 5, 95); defb = clamp(50 - 20 * m.d[ab] / TB["sd"], 5, 95)
        t = c["team"]
        teams[side] = dict(id=t["id"], abbr=ab, name=t["displayName"], short=t.get("shortDisplayName") or t.get("name"), color="#" + (t.get("color") or "444444"), alt="#" + (t.get("alternateColor") or "888888"),
                           record=rec, recent=[dict(opp=g["opp"], home=g["home"], pf=g["pf"], pa=g["pa"], win=g["win"], post=g["post"], date=g["date"][:10]) for g in tg[-10:]],
                           pf=r1(pf), pa=r1(pa), offBase=round(offb), defBase=round(defb), offRank=(TB["ro"].index(ab) + 1 if ab in TB["ro"] else None), defRank=(TB["rd"].index(ab) + 1 if ab in TB["rd"] else None), gp=gp, _tg=tg)
        inj = injuries_for(lg, t["id"], inj_all, game_dt); teams[side]["injuries"] = inj
        teams[side]["injImpact"] = injury_impact(lg, inj, tg)
    a, h = teams["away"], teams["home"]
    # --- context factors (rest, contract/trade news, dominant opposing player)
    ctx = {}
    N = TB["N"]
    notable = [x["name"] for x in (C or {}).get("leaders", [])]
    for side, me, op in (("away", a, h), ("home", h, a)):
        ctx[side] = CF.team_context(lg, C, me["id"], op["id"], side, me["_tg"], game_dt, me["defRank"] or N // 2, me["offRank"] or N // 2, N, op["defRank"] or N // 2, op["offRank"] or N // 2, notable,
                                    [i["name"] for i in op["injuries"] if i["kind"] in ("out", "doubtful")], [me["short"], me["name"].split()[-1]]) if C else dict(off=0, deff=0, items=[], rest={}, stars=[])
    rs = 20 / (TB["so"] or 1)             # rating points per 1 point of scoring
    for side in ("away", "home"):
        t = teams[side]; cx = ctx[side]
        t["off"] = round(clamp(t["offBase"] - (t["injImpact"]["off"] + cx["off"]) * rs, 3, 97)); t["def"] = round(clamp(t["defBase"] - (t["injImpact"]["deff"] + cx["deff"]) * rs, 3, 97))
    lph, lpa = m.predict(h["abbr"], a["abbr"])
    d_h = -h["injImpact"]["off"] + a["injImpact"]["deff"] - ctx["home"]["off"] + ctx["away"]["deff"]
    d_a = -a["injImpact"]["off"] + h["injImpact"]["deff"] - ctx["away"]["off"] + ctx["home"]["deff"]
    dm = d_h - d_a; dt = d_h + d_a
    ml_h, ml_a = ln["ml_h"], ln["ml_a"]
    def imp(a_): return (100 / (a_ + 100)) if a_ > 0 else (abs(a_) / (abs(a_) + 100))
    if ml_h is not None and ml_a is not None: iH, iA = imp(ml_h), imp(ml_a); bookH = iH / (iH + iA)
    else: bookH = LEX.phi(-ln["spr_h"] / LR["sd"]["m"])
    book_marg = -ln["spr_h"]; total = ln["total"]
    raw_m = (lph - lpa) + dm; raw_t = (lph + lpa) + dt
    fin = LEX.final_proj(lg, LR, raw_m, raw_t, dict(spr=(ln["spr_h"] if lg != "mlb" else None), total=total, pml=bookH), calib=True)
    marg, pt, pH = fin["fm"], fin["ft"], fin["fp"]
    projH = (pt + marg) / 2; projA = (pt - marg) / 2
    projH0 = lph; projA0 = lpa
    rkm = LR["ranks"]
    learn_info = dict(rawMargin=round(raw_m, 1), rawTotal=round(raw_t, 1), baseMargin=round(lph - lpa, 1), baseTotal=round(lph + lpa, 1), injMargin=round(dm, 1), injTotal=round(dt, 1),
                      bookMargin=round(book_marg, 1), w={k: round(v, 2) for k, v in fin["w"].items()}, n=LR["n_games"], sd=LR["sd"], leanStats=LR["leanStats"], test=LR["test"],
                      rk=dict(home=rkm.get(h["abbr"]), away=rkm.get(a["abbr"])), rt=dict(home=dict(o=round(m.o[h["abbr"]], 2), d=round(m.d[h["abbr"]], 2), gp=m.gp[h["abbr"]]), away=dict(o=round(m.o[a["abbr"]], 2), d=round(m.d[a["abbr"]], 2), gp=m.gp[a["abbr"]])))
    def lean_ok(kind):
        st = LR["leanStats"].get(kind); return not st or st["n"] < 50 or st["hit"] / st["n"] >= 0.52
    leans = []
    d_sp = raw_m - book_marg
    if lg == "mlb" or not lean_ok("spread"): d_sp = 0     # baseball run lines are not expected margins
    if abs(d_sp) >= SPREAD_T[lg]:
        if d_sp > 0: leans.append(dict(kind="spread", text=f"Spread lean: {h['abbr']} {ln['spr_h']:+g}", why=f"model margin {h['abbr']} {raw_m:+.1f} vs book {book_marg:+.1f}"))
        else: leans.append(dict(kind="spread", text=f"Spread lean: {a['abbr']} {ln['spr_a']:+g}", why=f"model margin {h['abbr']} {raw_m:+.1f} vs book {book_marg:+.1f}"))
    d_t = raw_t - total
    if not lean_ok("total"): d_t = 0
    if abs(d_t) >= TOTAL_T[lg]: leans.append(dict(kind="total", text=f"Total lean: {'Over' if d_t > 0 else 'Under'} {total:g}", why=f"model total {pt:.1f} vs book {total:g}"))
    pH_raw = LEX.phi(raw_m / LR["sd"]["m"])
    if lg == "mlb" and not lean_ok("mlLean"): pH_raw = bookH
    if ml_h is not None:
        if pH_raw - bookH >= ML_T[lg]: leans.append(dict(kind="ml", text=f"Moneyline lean: {h['abbr']} {ml_h:+d}", why=f"model {pH_raw*100:.0f}% vs book {bookH*100:.0f}%"))
        elif bookH - pH_raw >= ML_T[lg]: leans.append(dict(kind="ml", text=f"Moneyline lean: {a['abbr']} {ml_a:+d}", why=f"model {(1-pH_raw)*100:.0f}% vs book {(1-bookH)*100:.0f}%"))
    cr = dict(projHome=round(projH, 1), projAway=round(projA, 1), projHomeNoInj=round(projH0, 1), projAwayNoInj=round(projA0, 1), projTotal=round(pt, 1), projMargin=round(marg, 1), pHome=round(pH, 3), bookHome=round(bookH, 3),
              leans=leans, learn=learn_info,
              matchups=[dict(title=f"{a['abbr']} offense vs {h['abbr']} defense", off=a["off"], dfn=h["def"], gap=a["off"] - h["def"], offBase=a["offBase"], dfnBase=h["defBase"], offRank=a["offRank"], dfnRank=h["defRank"]),
                        dict(title=f"{h['abbr']} offense vs {a['abbr']} defense", off=h["off"], dfn=a["def"], gap=h["off"] - a["def"], offBase=h["offBase"], dfnBase=a["defBase"], offRank=h["offRank"], dfnRank=a["defRank"])],
              ctx=dict(away=ctx["away"], home=ctx["home"]))
    sb_odds = ((e["competitions"][0].get("odds") or [None])[0]) or {}
    dk = {"ml": {"home": None, "away": None}, "spr": {"home": None, "away": None}, "tot": {"over": None, "under": None}}
    try: dk = B1.dk_links(e)
    except Exception: pass
    venue = (comp.get("venue") or {}).get("fullName") or ""
    pre_note = None
    if (e.get("season") or {}).get("type") == 1: pre_note = "Preseason"
    elif (e.get("season") or {}).get("type") == 3 and lg in ("nba", "nfl", "wnba", "mlb"): pre_note = "Postseason"
    g = dict(id=e["id"], lg=fam, key=lg, league=NAME[lg], title=f"{a['name']} at {h['name']}", start=start.strftime("%-I:%M %p ET"), startDate=start.strftime("%a %b %-d"), iso=start.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), day=start.strftime("%Y-%m-%d"), venue=venue,
             tv=", ".join(sum([b.get("names", []) for b in comp.get("broadcasts", [])], [])) if comp.get("broadcasts") and isinstance(comp["broadcasts"][0], dict) and "names" in comp["broadcasts"][0] else "",
             series=pre_note, note=((comp.get("notes") or [{}])[0].get("headline") if comp.get("notes") else None), n=TB["N"],
             teams={k: {kk: vv for kk, vv in teams[k].items() if kk != "_tg"} for k in teams},
             lines=dict(dk=dk, mlHome=ml_h, mlAway=ml_a, sprHome=ln["spr_h"], sprAway=ln["spr_a"], prHome=ln["pr_h"], prAway=ln["pr_a"], total=total, over=ln["o"], under=ln["u"]),
             crossroads=cr, players=[])
    return g
