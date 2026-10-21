"""ESPN access layer: stdlib only (urllib), retries, timeouts, a User-Agent, thread-safe request counting.
Paths come from the environment (LS_ROOT / LS_CACHE) or are relative to this repo, never hard-coded."""
import json, os, re, time, gzip, threading, urllib.request, urllib.error
import concurrent.futures as cf

ENGINE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("LS_ROOT") or os.path.dirname(ENGINE)
CACHE = os.environ.get("LS_CACHE") or os.path.join(ROOT, ".cache")      # scratch only, never committed
D = CACHE                                                                  # legacy name used by the old scripts
os.makedirs(CACHE + "/gl", exist_ok=True)

SP = {"nfl": ("football", "nfl"), "wnba": ("basketball", "wnba"), "mlb": ("baseball", "mlb"), "nba": ("basketball", "nba"), "nhl": ("hockey", "nhl"),
      "cfb": ("football", "college-football"), "cbb": ("basketball", "mens-college-basketball")}
UA = os.environ.get("LS_UA") or "Mozilla/5.0 (compatible; LineScout/1.0)"      # note: a UA containing the word "bot" is rejected by some proxies
SB = "https://site.api.espn.com/apis/site/v2/sports/"
CORE = "https://sports.core.api.espn.com/v2/sports/{s}/leagues/{l}/events/{e}/competitions/{e}/odds"

STATS = {"requests": 0, "fails": 0, "retries": 0, "skipped": 0, "slowest": []}   # slowest: [(seconds, url)] top 3
DEADLINE_AT = None        # epoch seconds: after this moment no network call is started (the run then finishes from what it already has)
def set_deadline(ts):
    global DEADLINE_AT; DEADLINE_AT = ts
def past_deadline():
    return DEADLINE_AT is not None and time.time() > DEADLINE_AT
_lock = threading.Lock()
_memo = {}
_blocked = set()          # hosts that kept failing this run: after 12 consecutive failures we stop hammering them
_consec = {}

def _host(url): return url.split("/")[2]

def curl(url, tries=3, timeout=8, memo=False):
    """GET json. Returns parsed JSON or None. Never raises."""
    if memo and url in _memo: return _memo[url]
    h = _host(url)
    if h in _blocked: return None
    for t in range(tries):
        if past_deadline():
            with _lock: STATS["skipped"] += 1
            return None
        t_req = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip" or raw[:2] == b"\x1f\x8b": raw = gzip.decompress(raw)
            d = json.loads(raw.decode("utf-8"))
            with _lock:
                dt = time.time() - t_req
                if dt > 3: STATS["slowest"] = sorted(STATS["slowest"] + [(round(dt, 1), url[:110])], reverse=True)[:3]
                STATS["requests"] += 1; _consec[h] = 0
                if memo: _memo[url] = d
            return d
        except urllib.error.HTTPError as ex:
            with _lock: STATS["retries"] += 1
            if ex.code in (400, 401, 403, 404): break          # retrying will not help
            time.sleep(1.0 * (t + 1))
        except Exception:
            with _lock: STATS["retries"] += 1
            time.sleep(1.0 * (t + 1))
    with _lock:
        STATS["fails"] += 1; _consec[h] = _consec.get(h, 0) + 1
        if _consec[h] >= 12: _blocked.add(h)
    return None

def pmap(fn, items, workers=8):
    """parallel map that keeps order and swallows nothing silently: exceptions come back as None"""
    items = list(items)
    if not items: return []
    def safe(x):
        try: return fn(x)
        except Exception: return None
    with cf.ThreadPoolExecutor(workers) as ex: return list(ex.map(safe, items))

def num(v):
    if isinstance(v, (int, float)): return float(v)
    if v is None: return None
    try: return float(str(v).strip())
    except Exception: return None

GL_TTL = 3 * 3600
GL_TTL_OLD = 20 * 3600           # a finished season's log does not change: keep it most of a day
def _gl_raw(lg, aid, season=None):
    cache = f"{CACHE}/gl/{lg}_{aid}" + (f"_s{season}" if season else "") + ".json"
    ttl = GL_TTL_OLD if season else GL_TTL
    if os.path.exists(cache) and time.time() - os.path.getmtime(cache) < ttl:
        try: return json.load(open(cache))
        except Exception: pass
    sport, l = SP[lg]
    d = curl(f"https://site.web.api.espn.com/apis/common/v3/sports/{sport}/{l}/athletes/{aid}/gamelog" + (f"?season={season}" if season else ""))
    if d is None: return None
    try: json.dump(d, open(cache + ".tmp", "w")); os.replace(cache + ".tmp", cache)
    except Exception: pass
    return d

def _parse_gl(d):
    names = d.get("names") or []
    evmeta = d.get("events") or {}
    games = {}
    for st in d.get("seasonTypes", []):
        stname = st.get("displayName", "")
        label = (re.match(r"\d{4}(-\d{2})?", stname) or [None])[0] if re.match(r"\d{4}", stname) else None
        for cat in st.get("categories", []):
            for e in cat.get("events", []):
                eid = e["eventId"]; m = evmeta.get(eid, {})
                if eid in games: continue
                row = {}
                for n, v in zip(names, e["stats"]):
                    if isinstance(v, str) and re.fullmatch(r"\d+-\d+", v):
                        a, b = v.split("-"); row[n + "_made"] = float(a); row[n + "_att"] = float(b)
                        continue
                    x = num(v)
                    row[n] = x if x is not None else v
                games[eid] = {"eventId": eid, "date": m.get("gameDate"), "opp": (m.get("opponent") or {}).get("abbreviation"),
                              "home": (m.get("atVs") == "vs"), "result": m.get("gameResult"), "score": m.get("score"),
                              "post": "Post" in stname, "pre": "Pre" in stname, "season": label, "stats": row}
    return names, games

def gamelog(lg, aid):
    """returns (names, games[list oldest->newest of dict(eventId,date,opp,home,result,score,post,pre,season,stats{})]) or None. ESPN's current season only."""
    d = _gl_raw(lg, aid)
    if d is None: return None
    names, games = _parse_gl(d)
    return names, sorted(games.values(), key=lambda g: g["date"] or "")

NEED_REAL = {"nfl": 6, "cfb": 6, "wnba": 15, "nba": 15, "cbb": 12, "mlb": 25, "nhl": 15}
def prior_season_param(label):
    """ESPN's season= value of the season before the one labelled "2025-26" (-> 2025) or "2026" (-> 2025)"""
    m = re.match(r"(\d{4})", label or "")
    return int(m.group(1)) if m and "-" in (label or "") else (int(m.group(1)) - 1 if m else None)

def gamelog_multi(lg, aid):
    """the current season plus, while it is still short of real games, the season before it (regular season AND postseason).
    Preseason games stay in the list (pre=True) so the caller can give them little weight: teams do not go all out in exhibition games."""
    d = _gl_raw(lg, aid)
    if d is None: return None
    names, games = _parse_gl(d)
    labels = sorted({g["season"] for g in games.values() if g["season"]})
    cur = labels[-1] if labels else None
    real = sum(1 for g in games.values() if not g["pre"] and g["season"] == cur)
    if cur and real < NEED_REAL.get(lg, 15):
        ps = prior_season_param(cur)
        if ps:
            d2 = _gl_raw(lg, aid, ps)
            if d2:
                n2, g2 = _parse_gl(d2)
                for eid, g in g2.items():
                    if eid not in games and not g["pre"]: games[eid] = g      # last season's exhibition games are worth nothing now
                if not names: names = n2
    return names, sorted(games.values(), key=lambda g: g["date"] or "")

def prune_cache(max_age_h=24):
    """the scratch cache is restored between runs by the workflow (actions/cache): drop what is old so it never grows"""
    n = 0
    try:
        for f in os.listdir(CACHE + "/gl"):
            p = os.path.join(CACHE, "gl", f)
            if time.time() - os.path.getmtime(p) > max_age_h * 3600: os.remove(p); n += 1
    except Exception:
        pass
    return n

def prefetch_gamelogs(lg, ids, workers=12, multi=None):
    """multi = ids whose prior-season log may be needed as well (gamelog_multi): fetched in the same parallel pass"""
    ids = [i for i in dict.fromkeys(str(x) for x in ids if x)]
    pmap(lambda a: _gl_raw(lg, a), ids, workers)
    if multi:
        pmap(lambda a: gamelog_multi(lg, a), [i for i in dict.fromkeys(str(x) for x in multi if x)], workers)

# ---------------------------------------------------------------- full games vs partial games
def _mins(x):
    if isinstance(x, (int, float)): return float(x)
    m = re.match(r"\s*(\d+):(\d+)", str(x or ""))
    return int(m.group(1)) + int(m.group(2)) / 60 if m else 0.0

def usage(lg, g, role=""):
    """how much a player was on the field in one game, by the stat that measures playing time in his sport and role:
    basketball minutes, hockey ice time, QB pass + rush attempts, RB carries + receptions, WR/TE receptions + targets, MLB plate appearances / innings.
    None when the log has no such number (the game is then taken as it is)."""
    s = g.get("stats") or {}; role = (role or "").upper()
    if lg in ("nba", "wnba", "cbb"): return _mins(s.get("minutes")) if s.get("minutes") is not None else None
    if lg == "nhl":
        if role == "G": return _mins(s.get("timeOnIcePerGame")) if s.get("timeOnIcePerGame") is not None else None
        return _mins(s.get("timeOnIcePerGame")) if s.get("timeOnIcePerGame") is not None else None
    if lg in ("nfl", "cfb"):
        n = lambda k: s.get(k) if isinstance(s.get(k), (int, float)) else 0.0
        if role == "QB" or n("passingAttempts") >= 5: return n("passingAttempts") + n("rushingAttempts")
        if role in ("RB", "FB"): return n("rushingAttempts") + n("receptions")
        if role in ("WR", "TE"):
            t = n("receivingTargets") or n("targets")
            return t if t else (n("receptions") if n("receptions") else None)
        return None
    if lg == "mlb":
        n = lambda k: s.get(k) if isinstance(s.get(k), (int, float)) else 0.0
        if role in ("P", "SP", "RP"): return n("innings")
        return n("atBats") + n("walks")
    return None

PART = {"nba": 0.6, "wnba": 0.6, "cbb": 0.6, "nhl": 0.6, "nfl": 0.5, "cfb": 0.5, "mlb": 0.6}
def full_games(lg, games, role=""):
    """splits games into (full, partial). A game is partial when the player's playing time (usage()) was under PART of his usual full workload:
    the most he had in his recent games (subbed in late, a mop-up series, pulled early, came back from injury on a minutes limit).
    His numbers in partial games say nothing about a full game, so the projection and the record use full games. The usual workload is
    the second-highest of his last 8 games, or the highest when that came in his last 3 (a new starter)."""
    us = [(g, usage(lg, g, role)) for g in games]
    known = [u for _, u in us if u is not None and u > 0]
    if len(known) < 2: return list(games), []
    rec8 = known[-8:]; top = sorted(rec8, reverse=True)
    # his biggest workload sets the bar when it is one of his last 3 games (he just took over the job: a backup QB who started his latest game);
    # otherwise the second-highest, so one overtime game does not make every normal game look partial
    ref = top[0] if (len(top) < 3 or max(known[-3:]) == top[0]) else top[1]
    cut = PART.get(lg, 0.6) * ref
    full = [g for g, u in us if u is None or u >= cut]
    part = [g for g, u in us if u is not None and u < cut]
    return full, part
