"""Context factors for the Crossroads: rest/workload, contract & trade news, dominant opposing players.
Small, bounded point adjustments (judgment weights, not backtested). Sources: ESPN public feeds (news, transactions, league leaders) + team schedules."""
import json, os, re, sys, datetime, time
sys.path.insert(0, os.path.dirname(__file__))
from espn import curl, SP, D

UNIT = {"nfl": 1.0, "cfb": 1.0, "nba": 1.0, "wnba": 1.0, "cbb": 1.0, "mlb": 0.12, "nhl": 0.1}       # points -> this sport's scoring unit
STAR_SCALE = {"nfl": 1.6, "cfb": 1.8, "nba": 1.8, "wnba": 1.8, "cbb": 1.8, "mlb": 0.25, "nhl": 0.2}
KEYCATS = {
    "nfl": {"passingYards": "O", "rushingYards": "O", "receivingYards": "O", "passingTouchdowns": "O", "quarterbackRating": "O", "sacks": "D"},
    "cfb": {"passingYards": "O", "rushingYards": "O", "receivingYards": "O", "passingTouchdowns": "O", "quarterbackRating": "O", "sacks": "D"},
    "nba": {"pointsPerGame": "O", "assistsPerGame": "O", "reboundsPerGame": "O", "PER": "O", "3PointsMadePerGame": "O"},
    "wnba": {"pointsPerGame": "O", "assistsPerGame": "O", "reboundsPerGame": "O", "PER": "O", "3PointsMadePerGame": "O"},
    "cbb": {"pointsPerGame": "O", "assistsPerGame": "O", "reboundsPerGame": "O", "PER": "O", "3PointsMadePerGame": "O"},
    "nhl": {"goals": "O", "assists": "O", "points": "O", "savePct": "P", "goalsAgainstAverage": "P"},
    "mlb": {"avg": "O", "homeRuns": "O", "OPS": "O", "RBIs": "O", "ERA": "P", "strikeouts": "P", "WHIP": "P"},
}
CATLABEL = {"passingYards": "passing yards", "rushingYards": "rushing yards", "receivingYards": "receiving yards", "passingTouchdowns": "passing touchdowns", "quarterbackRating": "QB rating", "sacks": "sacks",
            "pointsPerGame": "points per game", "assistsPerGame": "assists per game", "reboundsPerGame": "rebounds per game", "PER": "player efficiency", "3PointsMadePerGame": "threes per game",
            "avg": "batting average", "homeRuns": "home runs", "OPS": "OPS", "RBIs": "RBIs", "ERA": "ERA", "strikeouts": "strikeouts", "WHIP": "WHIP"}
W = "https://site.web.api.espn.com/apis/site/v3/sports/"; A = "https://site.api.espn.com/apis/site/v2/sports/"
NOW = datetime.datetime.now(datetime.timezone.utc)      # refresh.py calls set_now() with the run time
def set_now(dt):
    global NOW; NOW = dt

def fetch(lg, refresh=False):
    f = f"{D}/ctx_{lg}.json"
    if os.path.exists(f) and not refresh and time.time() - os.path.getmtime(f) < 3 * 3600: return json.load(open(f))
    sport, l = SP[lg]
    out = dict(leaders=[], news=[], trans=[], fetched=NOW.isoformat())
    j = curl(f"{W}{sport}/{l}/leaders")
    for c in ((j or {}).get("leaders") or {}).get("categories", []):
        for i, x in enumerate(c.get("leaders", [])):
            a = x.get("athlete") or {}; t = x.get("team") or {}
            out["leaders"].append(dict(cat=c["name"], rank=i + 1, disp=x.get("displayValue"), aid=str(a.get("id")), name=a.get("displayName"), pos=((a.get("position") or {}).get("abbreviation")), tid=str(t.get("id") or (a.get("team") or {}).get("id") or "")))
    j = curl(f"{A}{sport}/{l}/news?limit=100")
    for a in (j or {}).get("articles", []):
        cats = a.get("categories") or []
        out["news"].append(dict(h=a.get("headline"), d=(a.get("description") or "")[:300], t=(a.get("published") or "")[:10],
                                tids=[str(c.get("teamId")) for c in cats if c.get("type") == "team" and c.get("teamId")],
                                ath=[dict(id=str(c.get("athleteId")), name=c.get("description")) for c in cats if c.get("type") == "athlete" and c.get("athleteId")],
                                link=(((a.get("links") or {}).get("web") or {}).get("href"))))
    j = curl(f"{A}{sport}/{l}/transactions?limit=200")
    for t in (j or {}).get("transactions", []):
        out["trans"].append(dict(date=(t.get("date") or "")[:10], tid=str((t.get("team") or {}).get("id") or ""), ab=(t.get("team") or {}).get("abbreviation"), desc=t.get("description") or ""))
    if out["leaders"] or out["news"]:
        try: json.dump(out, open(f, "w"))
        except Exception: pass
    return out

# ---------- rest / workload ----------
def _d(iso): return datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
def rest_info(lg, tg, game_dt_iso):
    """tg: completed games oldest->newest dicts(date, home). returns dict(days, b2b, n4, n7, road_trip, ...) for the game on game_dt_iso"""
    gd = _d(game_dt_iso); prev = [g for g in tg if _d(g["date"]) < gd - datetime.timedelta(hours=6)]
    if not prev: return dict(days=None, b2b=False, n4=0, n7=0, awayRun=0, last=None)
    last = prev[-1]; dd = (gd.date() - (_d(last["date"]) - datetime.timedelta(hours=5)).date()).days   # local-date difference
    # ET-ish date difference: use UTC-5 shift on both
    dd = ((gd - datetime.timedelta(hours=5)).date() - (_d(last["date"]) - datetime.timedelta(hours=5)).date()).days
    n4 = sum(1 for g in prev if (gd - _d(g["date"])).days < 4) + 1; n7 = sum(1 for g in prev if (gd - _d(g["date"])).days < 7) + 1
    run = 0
    for g in reversed(prev):
        if not g["home"]: run += 1
        else: break
    return dict(days=dd - 1, b2b=(dd <= 1), n4=n4, n7=n7, awayRun=run, last=last["date"][:10])

def rest_effect(lg, ri, is_home):
    """points (negative = hurts the team). returns (pts, note)"""
    if ri.get("days") is None: return 0.0, None
    d = ri["days"]; pts = 0.0; bits = []
    if d > 21: return 0.0, None   # offseason gap, not a rest edge
    if lg == "nhl":
        if ri["b2b"]: pts -= 0.12 if is_home else 0.2; bits.append("second game in two nights" + ("" if is_home else " on the road"))
        elif 3 <= d <= 7: pts += 0.04; bits.append(f"{d} days of rest")
    elif lg in ("nba", "wnba", "cbb"):
        if ri["b2b"]:
            pts -= 1.3 if is_home else 1.8; bits.append("second game in two nights" + ("" if is_home else " on the road"))
        elif ri["n4"] >= 3 and lg != "cbb": pts -= 0.5; bits.append(f"{ri['n4']} games in 4 days")
        if ri["n7"] >= 4 and lg != "cbb": pts -= 0.3; bits.append(f"{ri['n7']} games in 7 days")
        if 3 <= d <= 10 and not ri["b2b"]: pts += 0.3; bits.append(f"{d} days of rest")
        if (not is_home) and ri["awayRun"] >= 3: pts -= 0.3; bits.append(f"{ri['awayRun'] + 1}th straight away game")
    elif lg in ("nfl", "cfb"):
        short = 5 if lg == "nfl" else 5
        if d <= short - 1 + 0: pts -= (0.7 if lg == "nfl" else 0.6); bits.append(f"short week ({d} days of rest)")
        elif d >= 10: pts += (0.7 if lg == "nfl" else 0.5); bits.append(f"extra rest ({d} days, likely a bye)")
    elif lg == "mlb":
        if (not is_home) and ri["awayRun"] >= 7: pts -= 0.3; bits.append("long road trip")
    return pts, ("; ".join(bits) if bits else None)

def minutes_load(gl):
    """gl: gamelog games (dict stats.minutes). flags heavy recent minutes"""
    m = [g["stats"].get("minutes") for g in gl if isinstance(g["stats"].get("minutes"), (int, float))]
    if len(m) < 8: return None
    last3 = sum(m[-3:]) / 3; season = sum(m) / len(m)
    if last3 >= 31 and last3 - season >= 3: return dict(last3=round(last3, 1), season=round(season, 1))
    return None

# ---------- stars ----------
def star_info(lg, C, tid, injured_names=()):
    """dominant players on team tid from league leaderboards: list of dict(name,cats,score,kind)"""
    kc = KEYCATS[lg]; by = {}
    for x in C["leaders"]:
        if x["tid"] != str(tid) or x["cat"] not in kc: continue
        w = 0.6 if x["rank"] == 1 else 0.4 if x["rank"] <= 3 else 0.2 if x["rank"] <= 5 else 0.1
        e = by.setdefault(x["aid"], dict(name=x["name"], pos=x["pos"], cats=[], score=0.0, kind=kc[x["cat"]]))
        e["score"] += w; e["cats"].append(dict(cat=x["cat"], label=CATLABEL.get(x["cat"], x["cat"]), rank=x["rank"], disp=x["disp"]))
    out = []
    for e in by.values():
        e["score"] = round(min(1.0, e["score"]), 2)
        e["out"] = any(e["name"] and e["name"].lower() == (n or "").lower() for n in injured_names)
        e["cats"].sort(key=lambda c: c["rank"])
        out.append(e)
    out.sort(key=lambda e: -e["score"]); return out[:2]

# ---------- moves / news ----------
DISPUTE = re.compile(r"holdout|hold-out|trade request|requests? a trade|wants? out|unhappy|contract dispute|disgruntled|skip(s|ped)? (practice|camp)|sitting out", re.I)
UNSURE = re.compile(r"free agen|unsure of (his |her )?future|contract (year|expires|talks)|negotiat|extension talks|walk year", re.I)
EXTEND = re.compile(r"extension|re-?sign|agree[sd]? to (a )?(new )?(contract|deal)|signs? (a )?(new )?(multiyear|\d-year|contract)", re.I)
TRADE = re.compile(r"\btrad(e|ed|es)\b|acquir", re.I)

def moves_for_team(lg, C, tid, notable_names, tnames=()):
    """returns list of dict(kind,text,pts,date,src) for the team in the last 21 days. tnames: nickname(s) used to tell which side of a trade the team is on"""
    items = []; tid = str(tid)
    cutoff = (NOW - datetime.timedelta(days=21)).date().isoformat()
    nn = {n.lower() for n in notable_names if n}
    nick = "|".join(re.escape(x) for x in tnames if x)
    send_pat = re.compile(rf"\b({nick})\b\s+(have\s+|had\s+)?(trad(ed|e|ing)|sent|dealt|shipp?ed)", re.I) if nick else None
    recv_pat = re.compile(rf"(\b(to|from|acquire[sd]?|trade with)\s+(the\s+)?\b({nick})\b|\b({nick})\b\s+(acquire|get|land|add|pick up|receive))", re.I) if nick else None
    for a in C["news"]:
        if tid not in a["tids"] or a["t"] < cutoff: continue
        txt = (a["h"] or "") + " " + (a["d"] or ""); h = a["h"] or ""
        kind = None; pts = 0.0
        if DISPUTE.search(txt): kind, pts = "dispute", -0.6
        elif UNSURE.search(txt) and a["ath"]: kind, pts = "unsure", -0.2
        elif TRADE.search(h) and a["ath"]:
            if send_pat and send_pat.search(h): kind, pts = "trade", -0.3
            elif recv_pat and recv_pat.search(h) and re.search(r"\btrad|acquir", h, re.I) and not re.search(r"doesn't|won't|solve|reaction|calls", h, re.I): kind, pts = "trade", 0.1
        elif EXTEND.search(txt) and a["ath"] and not re.search(r"manager|coach|\bAD\b|sponsor|deal with (adidas|nike)|shoe", txt, re.I): kind, pts = "extension", 0.1
        if not kind: continue
        items.append(dict(kind=kind, text=h, pts=pts, date=a["t"], src="ESPN news", players=[x["name"] for x in a["ath"]][:2], link=a.get("link")))
    for t in C["trans"]:
        if t["tid"] != tid or t["date"] < cutoff: continue
        d = t["desc"]
        if re.search(r"practice squad|two-way|G League|Rest-of-Season|hardship|player development|10-day|Exhibit|outright|assigned|recalled|optioned|reinstated|injured reserve", d, re.I): continue
        named = [n for n in nn if n and n.split()[-1] in d.lower()]
        if TRADE.search(d) and re.search(r"^acquired", d, re.I) and named: kind, pts = "trade", 0.1
        elif re.search(r"^(waived|released)", d, re.I) and named: kind, pts = "cut", -0.2
        elif EXTEND.search(d) and named: kind, pts = "extension", 0.1
        else: continue
        items.append(dict(kind=kind, text=d[:140], pts=pts, date=t["date"], src="league transactions", players=named[:2]))
    # one item per player/kind (several stories cover the same move)
    seen = set(); out = []
    for it in sorted(items, key=lambda x: (x["src"] != "league transactions", x["date"]), reverse=False):
        pk = (it["kind"], tuple(sorted(p.lower() for p in it["players"])) or it["text"][:50])
        if pk in seen: continue
        seen.add(pk); out.append(it)
    out.sort(key=lambda x: x["date"], reverse=True)
    return out[:5]

def team_context(lg, C, tid, opp_tid, side, tg, game_iso, def_rank, off_rank, N, opp_def_rank, opp_off_rank, notable_names, injured_names_opp=(), tnames=()):
    """everything that feeds the Crossroads for one team. returns dict(off, deff, items[], rest, stars_opp[])
       off  = points the team's offense loses (positive = worse), deff = points its defense gives up extra"""
    u = UNIT[lg]; items = []; off = 0.0; deff = 0.0
    ri = rest_info(lg, tg, game_iso); rp, rnote = rest_effect(lg, ri, side == "home")
    if rnote: items.append(dict(kind="rest", text=rnote[0].upper() + rnote[1:], pts=round(rp * u, 2), src="schedule"))
    off -= rp * u * 0.5; deff -= rp * u * 0.5
    mv = moves_for_team(lg, C, tid, notable_names, tnames); mp = max(-0.9, min(0.3, sum(m["pts"] for m in mv)))
    # scale individual items to the clamped total
    raw = sum(m["pts"] for m in mv)
    for m in mv:
        m["pts"] = round(m["pts"] * u, 2); items.append(m)
    off -= mp * u * 0.5; deff -= mp * u * 0.5
    # the other team's dominant player(s) against this team's matching unit
    stars = star_info(lg, C, opp_tid, injured_names_opp)
    sf = []
    for s_ in stars:
        if s_["out"] or s_["score"] < 0.4: continue
        if s_["kind"] in ("P", "D"):      # star pitcher / pass rusher: pressure lands on this team's offense
            weak = (off_rank - 1) / max(1, N - 1) * 2 - 1       # weak offense (high rank number) -> positive
            v = STAR_SCALE[lg] * s_["score"] * 0.5 * (weak) ; off += v; unit = "offense"
        else:
            weak = (def_rank - 1) / max(1, N - 1) * 2 - 1       # weak defense -> positive
            v = STAR_SCALE[lg] * s_["score"] * 0.5 * weak; deff += v; unit = "defense"
        c0 = s_["cats"][0]
        sf.append(dict(name=s_["name"], pos=s_["pos"], score=s_["score"], cats=s_["cats"][:3], unit=unit, weak=round(weak, 2), pts=round(-v, 2) if unit == "defense" else round(-v, 2), rank=(def_rank if unit == "defense" else off_rank)))
    return dict(off=round(off, 2), deff=round(deff, 2), items=items, rest=ri, stars=sf)
