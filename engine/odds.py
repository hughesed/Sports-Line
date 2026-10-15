"""Sportsbook odds from SportsGameOdds (https://api.sportsgameodds.com/v2/events) -> data/odds.json.
Stdlib only. Needs ODDS_API_KEY (a GitHub secret). Never raises: with no key, a failure, or too little time since the last pull, the old file is kept.
Free plans are small, so it pulls on a budget. Two pulls feed the same file:
  * the PREGAME pull (refresh): ODDS_MIN_GAP_MIN minutes apart (default 60), games that have not started, per-league caps below. It stops paging as soon as every
    game on the slate for that league has its event, so a big college slate costs only the pages it needs. A game on the slate that the file has no event for
    pulls again after ODDS_COVER_GAP_MIN (default 20), once, so a game that the feed simply does not carry is not asked for again and again.
  * the LIVE pull (refresh_live): only for leagues with a game in play, FanDuel only, every ODDS_LIVE_GAP_MIN minutes (default 4). Each event it returns replaces
    that event in the file with FanDuel's CURRENT in-play lines (asOf = the pull time, each price carries FanDuel's own update time in "t")."""
import os, json, time, datetime, urllib.request, urllib.parse, urllib.error

API = "https://api.sportsgameodds.com/v2/events"
# soccer: the big European leagues, the Champions League, MLS and Liga MX. Soccer lines barely move before kickoff, so soccer is pulled at most every
# ODDS_SOCCER_GAP_MIN minutes (default 120) to keep the plan's request budget for the US leagues; between pulls the file keeps the last soccer events.
# The free SportsGameOdds plan carries the Champions League and MLS only (the others answer 400 and are then skipped for a day, see NO_PLAN), so those two go first.
SOCCER = [x.strip() for x in os.environ.get("ODDS_SOCCER", "UEFA_CHAMPIONS_LEAGUE,MLS,EPL,LA_LIGA,BUNDESLIGA,IT_SERIE_A,FR_LIGUE_1,LIGA_MX").split(",") if x.strip()]
LEAGUES = os.environ.get("ODDS_LEAGUES", "NFL,NCAAF,NBA,NCAAB,MLB,WNBA,NHL,ATP,WTA" + ("," + ",".join(SOCCER) if SOCCER else ""))
# FanDuel is the main book: ask the API for FanDuel's prices first (and DraftKings as the fallback) so the plan's cap on bookmaker odds is spent on them, not on nine other books.
# ODDS_BOOKS="" asks for every book again. ODDS_ALTS=1 also asks for alternate lines (bigger responses, so off unless the plan allows it).
BOOKS = os.environ.get("ODDS_BOOKS", "fanduel,draftkings").strip()
ALTS = os.environ.get("ODDS_ALTS", "0").strip() == "1"
LIVE_BOOKS = os.environ.get("ODDS_LIVE_BOOKS", "fanduel").strip()          # in-play lines: FanDuel only (the page never shows another book's live price)
# events pulled per league per run: college slates are big, and the feed lists games by start time, so a small cap never reaches the evening games
CAPS = {"NCAAF": 150, "NCAAB": 80, "NFL": 20, "NBA": 20, "NHL": 20, "MLB": 20, "WNBA": 12, "ATP": 12, "WTA": 12, **{lg: 10 for lg in SOCCER}}
# minutes back from now that the pregame pull still asks for (a game that started longer ago than this is the live pull's job); tennis matches run long
STARTED_BACK_MIN = {"ATP": 240, "WTA": 240, **{lg: 120 for lg in SOCCER}}
DEFAULT_BACK_MIN = float(os.environ.get("ODDS_STARTED_MIN", "30"))
KEEP_H = 6                  # events that started less than this long ago stay in the file between pulls (live games)
# SportsGameOdds stat ids -> the stat names used by the battle picker
STAT = {"points": "pts", "rebounds": "reb", "assists": "ast", "threePointersMade": "fg3", "points+rebounds+assists": "pra",
        "points+rebounds": "pr", "points+assists": "pa", "rebounds+assists": "ra", "doubleDouble": "dd", "tripleDouble": "td",
        "passing_yards": "passYds", "passing_touchdowns": "passTD", "rushing_yards": "rushYds", "receiving_yards": "recYds",
        "receiving_receptions": "rec", "batting_hits": "hits", "batting_homeRuns": "hr", "batting_RBI": "rbi", "pitching_strikeouts": "k",
        "passing_attempts": "passAtt", "passing_completions": "comp", "rushing_attempts": "carries",
        "shots_onGoal": "sog", "goalie_saves": "saves", "shots": "shots", "passes_attempted": "passes", "tackles": "tkl"}
SOCCER_STAT = {"points": "gls"}          # a soccer player's "points" are his goals

def _fd():
    try:
        import fanduel; return fanduel
    except Exception:
        return None

def _am(s):
    try: return int(str(s).replace("+", ""))
    except Exception: return None

def _num(s):
    try: return float(s)
    except Exception: return None

def _utc(now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    if now.tzinfo is None: now = now.replace(tzinfo=datetime.timezone.utc)
    return now.astimezone(datetime.timezone.utc)

def _iso(dt): return _utc(dt).strftime("%Y-%m-%dT%H:%M:%SZ")

def _parse(s):
    try: return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception: return None

def _books(odd, line_key, stamp=False):
    """{book: {odds, line, link}} for books whose price is live (the feed also lists stale prices with available=false). stamp=True keeps the book's own update time ("t")."""
    out = {}
    for b, v in (odd.get("byBookmaker") or {}).items():
        if not v.get("available", True): continue
        o = _am(v.get("odds"))
        if o is None: continue
        out[b] = {"odds": o, "line": _num(v.get(line_key)) if line_key else None, "link": v.get("deeplink")}
        if stamp and v.get("lastUpdatedAt"): out[b]["t"] = v.get("lastUpdatedAt")
        alts = [{"odds": _am(a.get("odds")), "line": _num(a.get(line_key)) if line_key else None, "link": a.get("deeplink")} for a in (v.get("altLines") or []) if isinstance(a, dict) and a.get("available", True) and _am(a.get("odds")) is not None]
        if alts: out[b]["alts"] = alts
    return out

def normalize(ev, live=False):
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
            bk = _books(o, "overUnder", live)
            if bk: g.setdefault("nrfi", {}).setdefault(ent, {})[side] = {"fair": fair, "books": bk}
            continue
        # basketball: first basket / first to score markets (a player, or a team)
        if "first" in sid.lower() and bt in ("yn", "ou", "ml") and (o.get("playerID") or ent in ("home", "away")):
            bk = _books(o, None, live)
            if bk:
                p = players.get(o.get("playerID")) or {}
                g.setdefault("first", []).append({"stat": sid, "pid": o.get("playerID"), "name": p.get("name"), "ent": ent, "side": side,
                    "team": "home" if (p.get("teamID") or ent) in ((t.get("home") or {}).get("teamID"), "home") else "away", "fair": fair, "books": bk})
            continue
        soc = g["league"] in SOCCER
        # soccer: the 3-way result over 90 minutes (home / draw / away, and the double chances home+draw / away+draw), both teams to score, team goal totals
        if soc and bt == "ml3way" and sid == "points" and per == "reg" and not o.get("playerID"):
            bk = _books(o, None, live)
            if bk: g.setdefault("m3", {})[side] = {"fair": fair, "books": bk}
            continue
        if soc and sid == "bothTeamsScored" and bt == "yn" and per == "game":
            bk = _books(o, None, live)
            if bk: g.setdefault("btts", {})[side] = {"fair": fair, "books": bk}
            continue
        if sid == "points" and bt == "ou" and per == "game" and ent in ("home", "away") and not o.get("playerID"):
            bk = _books(o, "overUnder", live)
            if bk: g.setdefault("tt", {}).setdefault(ent, {})[side] = {"fair": fair, "books": bk}
            continue
        if per != "game" or o.get("statID") != "points" and not o.get("playerID"): continue
        if o.get("playerID"):
            stat = (SOCCER_STAT.get(o.get("statID")) if soc else None) or STAT.get(o.get("statID"))
            if not stat or bt not in ("ou", "yn"): continue
            bk = _books(o, "overUnder" if bt == "ou" else None, live)
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
        bk = _books(o, {"ml": None, "spread": "spread", "total": "overUnder"}[key[0]], live)
        if bk: g["main"].setdefault(key[0], {})[key[1]] = {"fair": fair, "books": bk}
    return g

# ---------------------------------------------------------------- one request, with the rate-limit retry the free plan needs
RPM = float(os.environ.get("ODDS_RPM", "10") or 10)        # the plan's requests per minute (free plan: 10); requests are spaced to stay under it
_LAST = [0.0]
NO_PLAN = {}                 # league -> ISO time it answered 400 (not on the plan): skipped for NO_PLAN_H hours, then tried again
NO_PLAN_H = 24
def _get(key, q, pause=0.6):
    gap = 60.0 / max(RPM, 1) + 0.25 - (time.time() - _LAST[0])
    if gap > 0: time.sleep(gap)
    _LAST[0] = time.time()
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(q), headers={"x-api-key": key, "Accept": "application/json", "User-Agent": "LineScout/1.0"})
    for attempt in range(3):          # the free plan rate-limits bursts: wait and retry instead of dropping the league
        try:
            with urllib.request.urlopen(req, timeout=20) as r: d = json.loads(r.read())
            break
        except urllib.error.HTTPError as ex:
            if ex.code != 429 or attempt == 2: raise
            time.sleep(8 * (attempt + 1)); _LAST[0] = time.time()
    time.sleep(pause)
    if not d.get("success"): raise RuntimeError(str(d.get("error") or d)[:120])
    return d

def pull_league(key, league, max_events, now, done=None):
    """FanDuel/DraftKings only, games that have not started (or began a moment ago); if the API refuses those filters the same pull is made without them.
    done(events) -> True stops paging early (every slate game of this league already has its event)."""
    back = STARTED_BACK_MIN.get(league, DEFAULT_BACK_MIN)
    def go(filters):
        events, cursor, notice = [], None, None
        while len(events) < max_events:
            q = {"leagueID": league, "oddsAvailable": "true", "limit": str(min(20, max_events - len(events))),
                 "startsBefore": (now + datetime.timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")}
            if filters:
                q["startsAfter"] = (now - datetime.timedelta(minutes=back)).strftime("%Y-%m-%dT%H:%M:%SZ")
                if BOOKS: q["bookmakerID"] = BOOKS
                if ALTS: q["includeAltLines"] = "true"
            if cursor: q["cursor"] = cursor
            d = _get(key, q)
            notice = d.get("notice") or notice
            events += d.get("data") or []
            cursor = d.get("nextCursor")
            if not cursor or not d.get("data"): break
            if done is not None:
                try:
                    if done([normalize(e) for e in events]): break
                except Exception: pass
        return events[:max_events], notice
    try:
        ev, notice = go(True)
        if ev: return ev, notice
    except urllib.error.HTTPError as ex:
        if ex.code not in (400, 422): raise
    except RuntimeError:
        pass
    return go(False)

def _slate_wants(games, league, now):
    """the slate games of a league that have not started: what the pregame pull has to find"""
    FD = _fd()
    if not games or FD is None: return []
    return [g for g in games if FD.KEYLG.get(g.get("key") or g.get("lg")) == league and not g.get("bookOnly") and not g.get("oddsId") and not FD._started(g, now)]

def pull(key, max_events, now=None, log=print, games=None, skip=None, skip_leagues=None):
    """one request series per league; a league that errors (unknown id, plan limit) is skipped, the others still count. max_events is per league.
    Leagues with slate games go first and the whole pull stops at ODDS_DEADLINE_S (default 110) so a slow API cannot eat the run."""
    now = now or datetime.datetime.utcnow(); events, notice, ok = [], None, 0
    aware = _utc(now); FD = _fd(); skip = skip or set()
    def off_plan(lg):
        t = _parse(NO_PLAN.get(lg))
        return t is not None and (aware - t).total_seconds() < NO_PLAN_H * 3600
    order = [x.strip() for x in LEAGUES.split(",") if x.strip() and x.strip() not in (skip_leagues or ())]
    for lg in [x for x in order if off_plan(x)]: LEAGUE_INFO[lg] = "not on the plan (400), retried after " + str(NO_PLAN_H) + " h"
    order = [x for x in order if not off_plan(x)]
    have = {lg for lg in order if _slate_wants(games, lg, aware)}
    order.sort(key=lambda lg: 0 if lg in have else 1)          # stable: the slate's leagues first, the rest in the configured order
    t0 = time.time(); deadline = float(os.environ.get("ODDS_DEADLINE_S", "110"))
    pulled = []
    for lg in order:
        if time.time() - t0 > deadline:
            log(f"  odds {lg}: skipped (pull time limit of {deadline:.0f}s reached)"); LEAGUE_INFO[lg] = "skipped (time)"; continue
        try:
            cap = max(max_events, CAPS.get(lg, max_events)) if os.environ.get("ODDS_MAX_EVENTS") is None else max_events
            done = None
            want = [g for g in _slate_wants(games, lg, aware) if str(g.get("id")) not in skip]
            if want and FD is not None:
                done = lambda evs, want=want: all(FD.find_event(g, evs) for g in want)
            ev, n = pull_league(key, lg, cap, now, done); events += ev; notice = n or notice; ok += 1; pulled.append(lg); LEAGUE_INFO[lg] = len(ev)
        except Exception as ex:
            log(f"  odds {lg}: {type(ex).__name__}: {ex}"[:160]); LEAGUE_INFO[lg] = f"{type(ex).__name__}: {ex}"[:80]
            if isinstance(ex, urllib.error.HTTPError) and ex.code == 400: NO_PLAN[lg] = _iso(aware)
    if not ok: raise RuntimeError("no league could be pulled")
    PULLED[:] = pulled
    return events, notice
LEAGUE_INFO = {}     # per league: events pulled, or why not (written to odds.json so a league the plan does not cover is visible)
PULLED = []          # the leagues the last pull() reached (refresh() uses it to know whether soccer was refreshed)

def _unmatched(games, evs, now, old=None):
    """{slate game id: first time it was seen without an event}: games the feed does not carry; they do not trigger another pull for 6 hours"""
    FD = _fd(); out = {}
    if FD is None or not games: return out
    prev = (old or {}).get("unmatched") or {}
    for g in games:
        if g.get("bookOnly") or g.get("oddsId") or FD.KEYLG.get(g.get("key") or g.get("lg")) is None or FD._started(g, now): continue
        if FD.find_event(g, evs) is None:
            t0 = _parse(prev.get(str(g.get("id"))))
            out[str(g.get("id"))] = prev.get(str(g.get("id"))) if (t0 and (now - t0).total_seconds() < 6 * 3600) else _iso(now)
    return out

def _uncovered(games, old, now):
    """slate games (not started, within a day and a half) that the file has no event for and has not already given up on"""
    FD = _fd()
    if FD is None or not games or not old: return []
    evs = old.get("events") or []; seen = old.get("unmatched") or {}; out = []
    for g in games:
        if g.get("bookOnly") or g.get("oddsId") or FD.KEYLG.get(g.get("key") or g.get("lg")) is None or FD._started(g, now): continue
        t = _parse(g.get("iso"))
        if t is None or (t - now).total_seconds() > 36 * 3600: continue
        if str(g.get("id")) in seen and (_parse(seen[str(g.get("id"))]) and (now - _parse(seen[str(g.get("id"))])).total_seconds() < 6 * 3600): continue
        if FD.find_event(g, evs) is None: out.append(g)
    return out

def refresh(path, log=print, now=None, games=None):
    """Returns a short status string for meta.json. Keeps the previous file on any problem.
    games = the slate's cards (optional): lets the pull stop once they are covered and pull again when one is missing."""
    key = os.environ.get("ODDS_API_KEY", "").strip()
    if not key: return "no ODDS_API_KEY (skipped)"
    now = now or datetime.datetime.utcnow()
    try: old = json.load(open(path))
    except Exception: old = None
    gap = float(os.environ.get("ODDS_MIN_GAP_MIN", "60")); cover_gap = float(os.environ.get("ODDS_COVER_GAP_MIN", "20"))
    why = ""
    if old and old.get("generatedAt"):
        age = (now - datetime.datetime.strptime(old["generatedAt"], "%Y-%m-%dT%H:%M:%SZ")).total_seconds() / 60
        if age < gap:
            miss = _uncovered(games, old, _utc(now)) if age >= cover_gap else []
            if not miss: return f"kept ({age:.0f} min old, pulls every {gap:.0f} min)"
            why = f" (early: {len(miss)} slate game(s) had no event, e.g. {miss[0]['teams']['away']['abbr']}@{miss[0]['teams']['home']['abbr']})"
    try:
        aware = _utc(now)
        skip = set((old or {}).get("unmatched") or {})
        NO_PLAN.clear(); NO_PLAN.update((old or {}).get("noPlan") or {}); LEAGUE_INFO.clear()
        s_gap = float(os.environ.get("ODDS_SOCCER_GAP_MIN", "120")); s_at = _parse((old or {}).get("soccerAt"))
        soccer_due = bool(SOCCER) and (s_at is None or (aware - s_at).total_seconds() / 60 >= s_gap)
        try: evs, notice = pull(key, int(os.environ.get("ODDS_MAX_EVENTS", "15")), now, log, games=games, skip=skip, skip_leagues=None if soccer_due else set(SOCCER))
        except TypeError: evs, notice = pull(key, int(os.environ.get("ODDS_MAX_EVENTS", "15")), now, log)      # an older stub without the new arguments
        stamp = _iso(aware)
        fresh = [normalize(e) for e in evs]
        for e in fresh: e["asOf"] = stamp
        ids = {e["id"] for e in fresh}
        # games that began a moment ago drop out of this pull (the live pull owns them): keep what the file had, with its own asOf, so a live game's lines are not lost between pulls
        keep = []
        soccer_pulled = soccer_due and any(lg in PULLED for lg in SOCCER)
        for e in (old or {}).get("events") or []:
            st = _parse(e.get("start"))
            if e.get("id") in ids or st is None: continue
            if st <= aware and (aware - st).total_seconds() <= KEEP_H * 3600: keep.append(e)
            elif e.get("league") in SOCCER and not soccer_pulled and not e.get("final") and st > aware: keep.append(e)      # soccer not due this pull: its upcoming events stay
        out = {"generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "sportsgameodds", "notice": notice, "events": fresh + keep}
        out["soccerAt"] = stamp if soccer_pulled else (old or {}).get("soccerAt")
        out["leagues"] = dict(LEAGUE_INFO); out["noPlan"] = dict(NO_PLAN)
        if old and old.get("liveAt"): out["liveAt"] = old["liveAt"]
        if games is not None: out["unmatched"] = _unmatched(games, fresh + keep, aware, old)
        tmp = path + ".tmp"; json.dump(out, open(tmp, "w"), separators=(",", ":")); os.replace(tmp, path)
        soc = {lg: LEAGUE_INFO[lg] for lg in SOCCER if lg in LEAGUE_INFO}
        return f"ok: {len(fresh)} events" + (f" (+{len(keep)} in play kept)" if keep else "") + (f"; soccer {soc}" if soc else "") + (f" (plan limit: {notice[:80]})" if notice else "") + why
    except Exception as ex:
        log(f"  odds step failed: {type(ex).__name__}: {ex}"[:200])
        return f"error: {type(ex).__name__}"[:60]

# ---------------------------------------------------------------- the live pull: FanDuel's current in-play lines
def in_play(g, now, hours=6):
    """a slate card whose game has kicked off and is probably not over (the feed's own 'completed' flag settles it)"""
    t = _parse(g.get("iso"))
    return t is not None and t <= now + datetime.timedelta(minutes=2) and (now - t).total_seconds() <= hours * 3600

def pull_live_league(key, league, now):
    """in-play events of one league, FanDuel only. The window filters are always sent, so an API that ignored the live flag would still not page through finished games;
    if it refuses the live flag (400/422) the same pull goes without it, and the result is filtered on the event's own live status either way."""
    base = {"leagueID": league, "oddsAvailable": "true", "limit": "20", "startsAfter": _iso(now - datetime.timedelta(hours=KEEP_H)), "startsBefore": _iso(now + datetime.timedelta(minutes=5))}
    if LIVE_BOOKS: base["bookmakerID"] = LIVE_BOOKS
    def go(extra):
        q = dict(base); q.update(extra); events, cursor = [], None
        for _ in range(3):
            if cursor: q["cursor"] = cursor
            d = _get(key, q, 0.4)
            events += d.get("data") or []
            cursor = d.get("nextCursor")
            if not cursor or not d.get("data"): break
        return events
    try: evs = go({"live": "true"})
    except urllib.error.HTTPError as ex:
        if ex.code not in (400, 422): raise
        evs = go({})
    return [e for e in evs if (e.get("status") or {}).get("live") or (e.get("status") or {}).get("completed")]

def refresh_live(path, games, now=None, log=print):
    """-> status string. Replaces each in-play event in the file with its current FanDuel lines (and marks it live with the pull time)."""
    key = os.environ.get("ODDS_API_KEY", "").strip()
    if not key: return "no ODDS_API_KEY (skipped)"
    FD = _fd(); now = _utc(now)
    live = [g for g in (games or []) if FD is not None and FD.KEYLG.get(g.get("key") or g.get("lg")) and not g.get("bookOnly") and not g.get("oddsId") and in_play(g, now)]
    if not live: return "no games in play"
    try: old = json.load(open(path))
    except Exception: return "no odds file yet"
    gap = float(os.environ.get("ODDS_LIVE_GAP_MIN", "4"))
    if old.get("liveAt"):
        t = _parse(old["liveAt"])
        if t is not None and (now - t).total_seconds() / 60 < gap: return f"kept ({(now - t).total_seconds() / 60:.0f} min old, live pulls every {gap:.0f} min)"
    leagues = []
    for g in live:
        lg = FD.KEYLG.get(g.get("key") or g.get("lg"))
        if lg not in leagues: leagues.append(lg)
    got, errs = [], []
    for lg in leagues:
        try: got += pull_live_league(key, lg, now)
        except Exception as ex:
            errs.append(lg); log(f"  odds live {lg}: {type(ex).__name__}: {ex}"[:160])
    if not got and errs and len(errs) == len(leagues): return "error: live pull failed (" + ", ".join(errs) + ")"
    stamp = _iso(now); fresh = []
    for e in got:
        n = normalize(e, live=True); n["asOf"] = stamp; fresh.append(n)
    by = {e.get("id"): e for e in old.get("events") or []}
    for n in fresh:
        o = by.get(n["id"])
        if o and not n.get("eventLinks"): n["eventLinks"] = o.get("eventLinks") or {}
        by[n["id"]] = n
    old["events"] = list(by.values()); old["liveAt"] = stamp
    try:
        tmp = path + ".tmp"; json.dump(old, open(tmp, "w"), separators=(",", ":")); os.replace(tmp, path)
    except Exception as ex:
        return f"error: {type(ex).__name__}"[:60]
    n_live = sum(1 for e in fresh if e.get("live")); n_fd = sum(1 for e in fresh if e.get("live") and (e.get("main") or {}))
    return f"ok: {len(fresh)} in-play events ({n_live} live, {n_fd} with FanDuel lines)" + (f"; failed: {', '.join(errs)}" if errs else "")
