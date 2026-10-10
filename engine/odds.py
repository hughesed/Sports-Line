"""Sportsbook odds from SportsGameOdds (https://api.sportsgameodds.com/v2/events) -> data/odds.json.
Stdlib only. Needs ODDS_API_KEY (a GitHub secret). Never raises: with no key, a failure, or too little time since the last pull, the old file is kept.
Free plans are small, so it pulls on a budget: ODDS_MIN_GAP_MIN minutes between pulls (default 60) and ODDS_MAX_EVENTS events per league per pull (default 15)."""
import os, json, time, datetime, urllib.request, urllib.parse, urllib.error

API = "https://api.sportsgameodds.com/v2/events"
LEAGUES = os.environ.get("ODDS_LEAGUES", "NFL,NCAAF,NBA,NCAAB,MLB,WNBA,NHL,ATP,WTA")
# SportsGameOdds stat ids -> the stat names used by the battle picker
STAT = {"points": "pts", "rebounds": "reb", "assists": "ast", "threePointersMade": "fg3", "points+rebounds+assists": "pra",
        "points+rebounds": "pr", "points+assists": "pa", "rebounds+assists": "ra", "doubleDouble": "dd", "tripleDouble": "td",
        "passing_yards": "passYds", "passing_touchdowns": "passTD", "rushing_yards": "rushYds", "receiving_yards": "recYds",
        "receiving_receptions": "rec", "batting_hits": "hits", "batting_homeRuns": "hr", "batting_RBI": "rbi", "pitching_strikeouts": "k"}

def _am(s):
    try: return int(str(s).replace("+", ""))
    except Exception: return None

def _num(s):
    try: return float(s)
    except Exception: return None

def _books(odd, line_key):
    """{book: {odds, line, link}} for books whose price is live (the feed also lists stale prices with available=false)."""
    out = {}
    for b, v in (odd.get("byBookmaker") or {}).items():
        if not v.get("available", True): continue
        o = _am(v.get("odds"))
        if o is None: continue
        out[b] = {"odds": o, "line": _num(v.get(line_key)) if line_key else None, "link": v.get("deeplink")}
    return out

def normalize(ev):
    t = ev.get("teams") or {}; st = ev.get("status") or {}
    g = {"id": ev.get("eventID"), "league": ev.get("leagueID"), "start": st.get("startsAt"), "live": bool(st.get("live")), "final": bool(st.get("completed")),
         "home": (t.get("home", {}).get("names") or {}).get("short"), "away": (t.get("away", {}).get("names") or {}).get("short"),
         "homeName": (t.get("home", {}).get("names") or {}).get("long"), "awayName": (t.get("away", {}).get("names") or {}).get("long"),
         "eventLinks": (ev.get("links") or {}).get("bookmakers") or {}, "main": {}, "props": []}
    players = ev.get("players") or {}
    for oid, o in (ev.get("odds") or {}).items():
        bt, side, ent, per = o.get("betTypeID"), o.get("sideID"), o.get("statEntityID"), o.get("periodID")
        fair = {"odds": _am(o.get("fairOdds")), "line": _num(o.get("fairSpread") or o.get("fairOverUnder"))}
        sid = str(o.get("statID") or "")
        # MLB: runs in the 1st inning (under 0.5 = "no run first inning", NRFI): both teams (all), or one team
        if per == "1i" and sid == "points" and bt == "ou" and ent in ("home", "away", "all") and not o.get("playerID"):
            bk = _books(o, "overUnder")
            if bk: g.setdefault("nrfi", {}).setdefault(ent, {})[side] = {"fair": fair, "books": bk}
            continue
        # basketball: first basket / first to score markets (a player, or a team)
        if "first" in sid.lower() and bt in ("yn", "ou", "ml") and (o.get("playerID") or ent in ("home", "away")):
            bk = _books(o, None)
            if bk:
                p = players.get(o.get("playerID")) or {}
                g.setdefault("first", []).append({"stat": sid, "pid": o.get("playerID"), "name": p.get("name"), "ent": ent, "side": side,
                    "team": "home" if (p.get("teamID") or ent) in ((t.get("home") or {}).get("teamID"), "home") else "away", "fair": fair, "books": bk})
            continue
        if per != "game" or o.get("statID") != "points" and not o.get("playerID"): continue
        if o.get("playerID"):
            stat = STAT.get(o.get("statID"))
            if not stat or bt not in ("ou", "yn"): continue
            bk = _books(o, "overUnder" if bt == "ou" else None)
            if not bk: continue
            p = players.get(o["playerID"]) or {}
            g["props"].append({"pid": o["playerID"], "name": p.get("name"), "team": "home" if p.get("teamID") == (t.get("home") or {}).get("teamID") else "away",
                               "stat": stat, "type": bt, "side": side, "fair": fair, "books": bk})
            continue
        key = None
        if bt == "ml" and ent in ("home", "away"): key = ("ml", ent)
        elif bt == "sp" and ent in ("home", "away"): key = ("spread", ent)
        elif bt == "ou" and ent == "all": key = ("total", side)
        if not key: continue
        bk = _books(o, {"ml": None, "spread": "spread", "total": "overUnder"}[key[0]])
        if bk: g["main"].setdefault(key[0], {})[key[1]] = {"fair": fair, "books": bk}
    return g

def pull_league(key, league, max_events, now):
    events, cursor, notice = [], None, None
    while len(events) < max_events:
        q = {"leagueID": league, "oddsAvailable": "true", "limit": str(min(20, max_events - len(events))),
             "startsBefore": (now + datetime.timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")}
        if cursor: q["cursor"] = cursor
        req = urllib.request.Request(API + "?" + urllib.parse.urlencode(q), headers={"x-api-key": key, "Accept": "application/json", "User-Agent": "LineScout/1.0"})
        with urllib.request.urlopen(req, timeout=20) as r: d = json.loads(r.read())
        if not d.get("success"): raise RuntimeError(str(d.get("error") or d)[:120])
        notice = d.get("notice") or notice
        events += d.get("data") or []
        cursor = d.get("nextCursor")
        if not cursor or not d.get("data"): break
    return events[:max_events], notice

def pull(key, max_events, now=None, log=print):
    """one request series per league; a league that errors (unknown id, plan limit) is skipped, the others still count. max_events is per league."""
    now = now or datetime.datetime.utcnow(); events, notice, ok = [], None, 0
    for lg in [x.strip() for x in LEAGUES.split(",") if x.strip()]:
        try:
            ev, n = pull_league(key, lg, max_events, now); events += ev; notice = n or notice; ok += 1
        except Exception as ex: log(f"  odds {lg}: {type(ex).__name__}: {ex}"[:160])
    if not ok: raise RuntimeError("no league could be pulled")
    return events, notice

def refresh(path, log=print, now=None):
    """Returns a short status string for meta.json. Keeps the previous file on any problem."""
    key = os.environ.get("ODDS_API_KEY", "").strip()
    if not key: return "no ODDS_API_KEY (skipped)"
    now = now or datetime.datetime.utcnow()
    try: old = json.load(open(path))
    except Exception: old = None
    gap = float(os.environ.get("ODDS_MIN_GAP_MIN", "60"))
    if old and old.get("generatedAt"):
        age = (now - datetime.datetime.strptime(old["generatedAt"], "%Y-%m-%dT%H:%M:%SZ")).total_seconds() / 60
        if age < gap: return f"kept ({age:.0f} min old, pulls every {gap:.0f} min)"
    try:
        evs, notice = pull(key, int(os.environ.get("ODDS_MAX_EVENTS", "15")), now, log)
        games = [normalize(e) for e in evs]
        out = {"generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "sportsgameodds", "notice": notice, "events": games}
        tmp = path + ".tmp"; json.dump(out, open(tmp, "w"), separators=(",", ":")); os.replace(tmp, path)
        return f"ok: {len(games)} events" + (f" (plan limit: {notice[:80]})" if notice else "")
    except Exception as ex:
        log(f"  odds step failed: {type(ex).__name__}: {ex}"[:200])
        return f"error: {type(ex).__name__}"[:60]
