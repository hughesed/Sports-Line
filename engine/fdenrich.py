"""Cross-reference ESPN for the FanDuel players a card is missing.

FanDuel's own markets (engine/fdapi.py) name the player but not his team, and they list more players than the cards carry: NHL and college football cards
have no players at all (ESPN publishes no props for them), and NBA / NFL / WNBA / MLB cards carry only the players ESPN's prop feed featured. For every
upcoming game this step takes the FanDuel players the card does not have, finds each one on the two teams' ESPN rosters (that gives his team, ESPN id,
position and injury status) and reads his ESPN game log: this season, plus last season's regular season and playoffs while this one is still short
(preseason counts 15% at most, exactly like the main builder). From that log each FanDuel stat gets the same fields the main builder writes (last 10,
last 15, last playoffs, projection, spread), so fanduel.apply() then puts FanDuel's lines, X+ rungs and prices on them, with each rung's chance compared
to the player's record. A player ESPN cannot match, or a stat with no game log, falls back to FanDuel's own price (marked feed) when FanDuel has an
over/under for it. Grading uses the ESPN id (the box score is keyed by it). Never raises into the caller."""
import re, math, statistics, datetime, unicodedata
import espn, feeds
import fanduel as FD

MAX_ADD = 18            # most players added to one card (the ones with the most FanDuel markets first)
HORIZON_H = 30

def _v(g, k):
    x = g["stats"].get(k)
    return x if isinstance(x, (int, float)) else 0.0
FB = {"passYds": lambda g: _v(g, "passingYards"), "passTD": lambda g: _v(g, "passingTouchdowns"), "passAtt": lambda g: _v(g, "passingAttempts"),
      "comp": lambda g: _v(g, "completions"), "rushYds": lambda g: _v(g, "rushingYards"), "carries": lambda g: _v(g, "rushingAttempts"),
      "recYds": lambda g: _v(g, "receivingYards"), "rec": lambda g: _v(g, "receptions"),
      "rr": lambda g: _v(g, "rushingYards") + _v(g, "receivingYards"), "pr": lambda g: _v(g, "passingYards") + _v(g, "rushingYards")}
BB = {"pts": lambda g: _v(g, "points"), "reb": lambda g: _v(g, "totalRebounds"), "ast": lambda g: _v(g, "assists"),
      "fg3": lambda g: _v(g, "threePointFieldGoalsMade-threePointFieldGoalsAttempted_made"),
      "pra": lambda g: _v(g, "points") + _v(g, "totalRebounds") + _v(g, "assists"), "ptsreb": lambda g: _v(g, "points") + _v(g, "totalRebounds"),
      "ptsast": lambda g: _v(g, "points") + _v(g, "assists"), "rebast": lambda g: _v(g, "totalRebounds") + _v(g, "assists")}
HK = {"pts": lambda g: _v(g, "points") or (_v(g, "goals") + _v(g, "assists")), "ast": lambda g: _v(g, "assists"), "gls": lambda g: _v(g, "goals"),
      "sog": lambda g: _v(g, "shotsTotal") or _v(g, "shots"), "saves": lambda g: _v(g, "saves")}
BS = {"hits": lambda g: _v(g, "hits"), "rbi": lambda g: _v(g, "RBIs"), "runs": lambda g: _v(g, "runs"), "hr": lambda g: _v(g, "homeRuns"),
      "k": lambda g: _v(g, "strikeouts"), "tb": lambda g: _v(g, "hits") + _v(g, "doubles") + 2 * _v(g, "triples") + 3 * _v(g, "homeRuns")}
FNS = {"nfl": FB, "cfb": FB, "nba": BB, "wnba": BB, "cbb": BB, "nhl": HK, "mlb": BS}

def _played(lg, g, stat):
    s = g["stats"]
    if lg in ("nba", "wnba", "cbb"): return (s.get("minutes") or 0) > 0
    if lg == "nhl":
        if stat == "saves": return (s.get("gameStarted") or 0) > 0 or (s.get("shotsAgainst") or 0) >= 10
        t = s.get("timeOnIcePerGame"); return t not in (None, "0:00", 0, 0.0)
    if lg == "mlb":
        if stat == "k": return (s.get("innings") or 0) > 0
        return (s.get("atBats") or 0) + (s.get("walks") or 0) > 0
    return True

def _n(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)
def _keys(name, weak=True):
    """spellings of one name that ESPN and FanDuel can disagree on, exact ones first: suffixes (Jr., III), then (weak) the first three letters
    of the first name with the last name (Nic / Nicolas Claxton, Cam / Cameron)"""
    w = [x for x in re.sub(r"[.,'’-]", " ", name or "").split() if x.lower() not in ("jr", "sr", "ii", "iii", "iv", "v")]
    ks = [_n(name), _n(" ".join(w))]
    if weak and len(w) >= 2: ks.append("L:" + _n(w[-1]) + ":" + _n(w[0])[:3])
    out = []
    for k in ks:
        if k and k not in out: out.append(k)
    return out

def _r(x): return int(x) if x == int(x) else round(x, 1)

def _stat_from_logs(lg, key, gl, line, role=""):
    fn = FNS.get(lg, {}).get(key)
    if not fn: return None
    rows = [g for g in gl if _played(lg, g, key)]
    real = [g for g in rows if not g.get("pre")]
    if not real: return None
    postg = [g for g in real if g.get("post")]
    reg = [g for g in real if not g.get("post")]
    if len(reg) >= 5: real = reg          # regular season only (playoff roles are not normal games); playoffs shown for reference
    full, part = espn.full_games(lg, real, role)          # full games only: a game where he came in late or played a few minutes says nothing about a full one
    if full and part: real = full
    last_real = real[-1]["date"] or ""
    pre = [g for g in rows if g.get("pre") and (g["date"] or "") > last_real]
    vals = [fn(g) for g in real[-10:]]; v15 = [fn(g) for g in real[-15:]]
    allv = [fn(g) for g in real[-45:]]
    n = len(vals); avg = statistics.mean(vals); avg5 = statistics.mean(vals[-5:]); season = statistics.mean(allv)
    base = 0.25 * avg5 + 0.25 * avg + 0.5 * season if len(allv) >= 20 else (avg if n < 5 else 0.6 * avg5 + 0.4 * avg)
    prev = [fn(g) for g in pre]
    if len(prev) >= 2: base = 0.85 * base + 0.15 * statistics.mean(prev)
    if line and line > 0:                                  # FanDuel's line knows about role changes the old log does not: pull a quarter of the way to it
        base = 0.75 * base + 0.25 * line
    post = postg
    if post: post = [g for g in post if g.get("season") == post[-1].get("season")][-12:]
    ln = line if line else (math.floor(statistics.median(vals)) + 0.5)
    sd = max(statistics.pstdev(vals) if n > 1 else ln * 0.5, (0.25 if len(full) < 3 and part else 0.15) * ln, 0.5)
    mn, mx = min(v15), max(v15)
    return dict(key=key, label=FD.LABEL.get(key, key), vals=[_r(x) for x in vals], line=ln, lineSrc="FanDuel" if line else "model", prices=[], n=n,
                avg=round(avg, 1), avg5=round(avg5, 1), mn=_r(mn), mx=_r(mx), safe=None, safeAdj=None, overHits=sum(1 for x in vals if x > ln), streak=0, streakDir=None,
                hot="steady", hotNote="", grade="–", gradePct=None, proj=round(base, 1), season=round(season, 1), anchorNote="", matchup=0, matchupNote="", boost=0.0,
                lean="No edge", pOver=None, overPrice=None, pSafe=None, safePrice=None, safeSrc="est.", miles=[], prate=50,
                v15=[_r(x) for x in v15], n15=len(v15), fullN=len(full), partN=len(part), thin=bool(len(full) < 3 and part), overHits15=sum(1 for x in v15 if x > ln), sd=round(sd, 2),
                post=[_r(fn(g)) for g in post], postSeason=(post[-1].get("season") if post else None), pre=[_r(x) for x in prev],
                seasons=sorted({g.get("season") for g in real[-15:] if g.get("season")}), xref="espn")

def _fd_players(e):
    """{name key: {"name", "stats": {stat: over/under dict or None}}} for every player FanDuel lists in this event"""
    by, lad = FD._props_by_player(e, ladders=True)
    out = {}
    for (pid, stat), d in list(by.items()) + list(lad.items()):
        nm = d.get("name")
        if not nm: continue
        p = out.setdefault(_n(nm), {"name": nm, "stats": {}, "n": 0})
        p["stats"][stat] = d if "over" in d else p["stats"].get(stat); p["n"] += 1
    return out

def _started(g, now):
    try: return datetime.datetime.fromisoformat(g["iso"].replace("Z", "+00:00")) <= now
    except Exception: return True

def enrich(games, odds, now, log=print):
    """adds ESPN-backed players (or FanDuel-priced ones with their ESPN team) to cards that miss FanDuel's players. Returns a status string."""
    try:
        events = (odds or {}).get("events") or []
        if not events: return "no odds events"
        added = logs = feed = nomatch = cards = 0; per = {}
        for g in games:
            lg = g.get("key") or g.get("lg")
            if lg not in FNS or g.get("bookOnly") and not (g["teams"]["home"].get("id") and g["teams"]["away"].get("id")): continue
            if _started(g, now): continue
            try:
                if (datetime.datetime.fromisoformat(g["iso"].replace("Z", "+00:00")) - now).total_seconds() > HORIZON_H * 3600: continue
            except Exception: continue
            e = FD.find_event(g, events)
            if not e or not e.get("props"): continue
            fdp = _fd_players(e)
            have = set()
            for p in g.get("players") or []: have |= set(_keys(p["name"]))
            miss = [v for k, v in fdp.items() if not (set(_keys(v["name"])) & have)]
            if not miss: continue
            miss.sort(key=lambda v: -v["n"]); miss = miss[:MAX_ADD]
            ros, idx = {}, {}
            for side in ("away", "home"):
                tid = g["teams"][side].get("id")
                ros[side] = (feeds.roster_players(lg, tid) or []) if tid else []
                for p in ros[side]:
                    for k in _keys(p["name"]):
                        if k in idx and idx[k][1]["id"] != p["id"]: idx[k] = None          # two players share this spelling: never guess between them
                        elif k not in idx: idx[k] = (side, p)
            todo = []
            for v in miss:
                hit = next((idx[k] for k in _keys(v["name"]) if idx.get(k)), None)
                if not hit: nomatch += 1; continue
                todo.append((v, hit[0], hit[1]))
            if not todo: continue
            espn.prefetch_gamelogs(lg, [p["id"] for _, _, p in todo], multi=[p["id"] for _, _, p in todo])
            newp = []
            for v, side, rp in todo:
                r = espn.gamelog_multi(lg, rp["id"]); gl = r[1] if r else []
                stats = []
                for key, d in v["stats"].items():
                    line = d["over"]["line"] if d else None
                    st = _stat_from_logs(lg, key, gl, line, rp.get("pos") or "") if gl else None
                    if st is None and d: st = FD._synth_stat(key, d); st["xref"] = "fanduel"; feed += 1          # no game log: FanDuel's own price is the chance
                    elif st is not None: logs += 1
                    if st is not None: stats.append(st)
                if not stats: continue
                out = any((s or "").lower() in feeds.BAD_STATUS for s in rp.get("inj") or [])
                real = [x for x in gl if not x.get("pre")][-15:]
                slots = [dict(eid=x["eventId"], date=(x["date"] or "")[:10], opp=x["opp"], home=x["home"], res=x["result"], post=x["post"], dnp=False, model=True) for x in real]
                newp.append(dict(id=str(rp["id"]), name=v["name"], espnName=rp["name"], side=side, abbr=g["teams"][side]["abbr"], pos=rp.get("pos") or "", jersey=rp.get("jersey"),
                                 status=dict(label="Out", kind="out", note="ESPN roster") if out else dict(label="Active", kind="ok", note=""), avail=0.0 if out else 1.0,
                                 flags=[], boostNotes=[], games=[dict(date=s["date"], opp=s["opp"], home=s["home"], res=s["res"], post=s["post"]) for s in slots[-10:]], slots=slots,
                                 stats=stats, fam=("P" if any(s["key"] == "k" for s in stats) else rp.get("pos") or "X"), ht=rp.get("ht"), xref=True))
            if newp:
                g["players"] = list(g.get("players") or []) + newp; g["xref"] = len(newp)
                added += len(newp); cards += 1; per[lg] = per.get(lg, 0) + len(newp)
        return (f"ok: {added} FanDuel players added from ESPN rosters on {cards} cards {per}; {logs} stats from game logs, {feed} from FanDuel's price only"
                + (f"; {nomatch} not on either ESPN roster" if nomatch else ""))
    except Exception as ex:
        return f"error: {type(ex).__name__}: {ex}"[:160]
