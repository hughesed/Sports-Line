"""ESPN access layer: stdlib only (urllib), retries, timeouts, a User-Agent, thread-safe request counting.
Paths come from the environment (LS_ROOT / LS_CACHE) or are relative to this repo, never hard-coded."""
import json, os, re, time, gzip, threading, urllib.request, urllib.error
import concurrent.futures as cf

ENGINE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("LS_ROOT") or os.path.dirname(ENGINE)
CACHE = os.environ.get("LS_CACHE") or os.path.join(ROOT, ".cache")      # scratch only, never committed
D = CACHE                                                                  # legacy name used by the old scripts
os.makedirs(CACHE + "/gl", exist_ok=True)

SP = {"nfl": ("football", "nfl"), "wnba": ("basketball", "wnba"), "mlb": ("baseball", "mlb"), "nba": ("basketball", "nba"),
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
def _gl_raw(lg, aid):
    cache = f"{CACHE}/gl/{lg}_{aid}.json"
    if os.path.exists(cache) and time.time() - os.path.getmtime(cache) < GL_TTL:
        try: return json.load(open(cache))
        except Exception: pass
    sport, l = SP[lg]
    d = curl(f"https://site.web.api.espn.com/apis/common/v3/sports/{sport}/{l}/athletes/{aid}/gamelog")
    if d is None: return None
    try: json.dump(d, open(cache + ".tmp", "w")); os.replace(cache + ".tmp", cache)
    except Exception: pass
    return d

def gamelog(lg, aid):
    """returns (names, games[list oldest->newest of dict(eventId,date,opp,home,result,score,stats{})]) or None"""
    d = _gl_raw(lg, aid)
    if d is None: return None
    names = d.get("names") or []
    evmeta = d.get("events") or {}
    games = {}
    for st in d.get("seasonTypes", []):
        stname = st.get("displayName", "")
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
                              "post": "Post" in stname, "stats": row}
    gl = sorted(games.values(), key=lambda g: g["date"] or "")
    return names, gl

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

def prefetch_gamelogs(lg, ids, workers=12):
    ids = [i for i in dict.fromkeys(str(x) for x in ids if x)]
    pmap(lambda a: _gl_raw(lg, a), ids, workers)
