"""Compact history store (store/): finished games per league (all the learner needs) + closing odds, appended incrementally from scoreboards."""
import json, os, re, datetime, time
from espn import curl, pmap, SP, SB, CORE, ROOT
from timeutil import et_date_of

LEAGUES = ("nfl", "wnba", "mlb", "nba", "cfb", "cbb")
GR = {"cfb": "&groups=80&limit=300", "cbb": "&groups=50&limit=400", "nba": "&limit=100", "nfl": "&limit=100", "wnba": "&limit=100", "mlb": "&limit=100"}
ODDS_LEAGUES = ("nfl", "wnba", "mlb", "nba", "cfb")        # same as the original build: no closing lines are kept for college basketball
KEEP_DAYS = 1100
BACKFILL_CAP_DAYS = 120

def score_of(c):
    s = c.get("score")
    if isinstance(s, dict): s = s.get("value") if s.get("value") is not None else s.get("displayValue")
    try: return float(s)
    except Exception: return None

def event_to_game(lg, e):
    """completed ESPN scoreboard event -> compact game dict (or None)"""
    try:
        c = e["competitions"][0]
        if not c["status"]["type"]["completed"]: return None
        h = [x for x in c["competitors"] if x["homeAway"] == "home"][0]; a = [x for x in c["competitors"] if x["homeAway"] == "away"][0]
        hs, as_ = score_of(h), score_of(a)
        if hs is None or as_ is None: return None
        ha, aa = h["team"]["abbreviation"], a["team"]["abbreviation"]
        if "TBD" in (ha, aa): return None
        se = e.get("season") or {}
        st = se.get("type")
        if lg in ("nfl", "wnba", "mlb", "nba") and st not in (2, 3): return None      # preseason / exhibition games do not count for ratings
        return dict(id=str(e["id"]), date=e["date"], home=ha, away=aa, hs=hs, as_=as_, neutral=bool(c.get("neutralSite")), post=(st == 3), season=se.get("year"))
    except Exception:
        return None

def parse_core_odds(j, game):
    """core odds item -> [sprH,total,mlH,mlA] (same rules as the original pull_odds.py) or None"""
    if not j or not j.get("items"): return None
    it = j["items"][0]
    m = re.match(r"(\w+)\s+([+-]?[\d.]+)", it.get("details") or "")
    sp = None
    if m and m.group(2) not in ("0",):
        fav = m.group(1); v = float(m.group(2)); sp = v if fav == game["home"] else -v
    elif it.get("details") == "EVEN": sp = 0.0
    return [sp, it.get("overUnder"), (it.get("homeTeamOdds") or {}).get("moneyLine"), (it.get("awayTeamOdds") or {}).get("moneyLine")]

class Store:
    def __init__(self, root=None):
        self.dir = os.path.join(root or ROOT, "store")
        os.makedirs(self.dir, exist_ok=True)
        self.games = {lg: {} for lg in LEAGUES}
        self.odds = {}
        self.state = {}
        self.dirty = set()
        self.load()

    # ---- io
    def _p(self, n): return os.path.join(self.dir, n)
    def load(self):
        for lg in LEAGUES:
            f = self._p(f"games_{lg}.jsonl")
            if not os.path.exists(f): continue
            for line in open(f):
                line = line.strip()
                if not line: continue
                r = json.loads(line)
                self.games[lg][r["i"]] = dict(id=r["i"], date=r["d"], home=r["h"], away=r["a"], hs=r["hs"], as_=r["as"], neutral=bool(r.get("n")), post=bool(r.get("p")), season=r.get("s"))
        f = self._p("odds.json")
        if os.path.exists(f):
            for k, v in json.load(open(f)).items(): self.odds[k] = None if v is None else dict(sprH=v[0], total=v[1], mlH=v[2], mlA=v[3])
        f = self._p("state.json")
        if os.path.exists(f): self.state = json.load(open(f))

    @staticmethod
    def _atomic(path, text):
        tmp = path + ".tmp"; open(tmp, "w").write(text); os.replace(tmp, path)

    def save(self):
        cutoff = (datetime.date.today() - datetime.timedelta(days=KEEP_DAYS)).isoformat()
        for lg in LEAGUES:
            if lg not in self.dirty and os.path.exists(self._p(f"games_{lg}.jsonl")): continue
            rows = sorted(self.games[lg].values(), key=lambda g: (g["date"], g["id"]))
            lines = []
            for g in rows:
                if g["date"][:10] < cutoff: continue
                r = dict(i=g["id"], d=g["date"], h=g["home"], a=g["away"], hs=_n(g["hs"]), **{"as": _n(g["as_"])})
                if g["neutral"]: r["n"] = 1
                if g["post"]: r["p"] = 1
                if g["season"] is not None: r["s"] = g["season"]
                lines.append(json.dumps(r, separators=(",", ":")))
            self._atomic(self._p(f"games_{lg}.jsonl"), "\n".join(lines) + ("\n" if lines else ""))
        live = {g["id"] for lg in LEAGUES for g in self.games[lg].values()}
        o = {k: (None if v is None else [v["sprH"], v["total"], v["mlH"], v["mlA"]]) for k, v in sorted(self.odds.items()) if k in live}
        self._atomic(self._p("odds.json"), json.dumps(o, separators=(",", ":")))
        self._atomic(self._p("state.json"), json.dumps(self.state, indent=1, sort_keys=True))
        self.dirty = set()

    # ---- updates
    def upsert(self, lg, g):
        old = self.games[lg].get(g["id"])
        if old == g: return False
        self.games[lg][g["id"]] = g; self.dirty.add(lg); return True

    def last_date(self, lg):
        d = [g["date"][:10] for g in self.games[lg].values()]
        return max(d) if d else None

def _n(x):
    return int(x) if float(x).is_integer() else x

# ---------------------------------------------------------------------------------------------
def fetch_range(lg, d0, d1):
    """scoreboard events for ET days d0..d1 (inclusive), one request per day (ESPN rejects date ranges) -> (events, complete).
    complete is False when any day failed to load"""
    sport, l = SP[lg]
    jobs = []; d = d0
    while d <= d1:
        jobs.append(f"{SB}{sport}/{l}/scoreboard?dates={d:%Y%m%d}{GR[lg]}"); d += datetime.timedelta(days=1)
    res = pmap(lambda u: curl(u), jobs, 8)
    out = []; seen = set(); ok = True; through = None
    for i, j in enumerate(res):
        if j is None:
            if ok: through = d0 + datetime.timedelta(days=i - 1) if i else None      # last day before the first failure
            ok = False; continue
        for e in j.get("events", []):
            if e["id"] in seen: continue
            seen.add(e["id"]); out.append(e)
    if ok: through = d1
    fetch_range.through = through          # lets ingest() move its "scanned up to" marker over the days that did load, so a catch-up that runs out of time still progresses
    return out, ok

def scan_start(st, lg, today):
    """first ET day to read from the scoreboards: just after the last full scan (gap backfill, capped), but always at least the last 3 days"""
    key = "scanned_" + lg
    last_scan = st.state.get(key)
    floor = today - datetime.timedelta(days=BACKFILL_CAP_DAYS)
    if last_scan:
        start = datetime.date.fromisoformat(last_scan) - datetime.timedelta(days=2)
    else:
        ld = st.last_date(lg)
        start = (datetime.date.fromisoformat(ld) - datetime.timedelta(days=3)) if ld else floor
    start = max(start, floor)
    return min(start, today - datetime.timedelta(days=3))

def ingest(st, lg, evs, today, start, complete=True, log=print):
    """append newly finished games from scoreboard events, then fetch closing odds for games that do not have them yet"""
    new = []; changed = 0
    for e in evs:
        g = event_to_game(lg, e)
        if not g: continue
        if g["id"] not in st.games[lg]: new.append(g)
        if st.upsert(lg, g): changed += 1
    thr = getattr(fetch_range, "through", None) if not complete else (today - datetime.timedelta(days=1))
    if thr is not None: st.state["scanned_" + lg] = str(min(thr, today - datetime.timedelta(days=1)))      # only over days that really loaded: a half-failed scan must not skip days next time
    got = 0
    if lg in ODDS_LEAGUES:
        floor = (today - datetime.timedelta(days=BACKFILL_CAP_DAYS)).isoformat()
        need = [g for g in st.games[lg].values() if g["id"] not in st.odds and g["date"][:10] >= floor]
        need = sorted(need, key=lambda g: g["date"])[-150:]
        sport, l = SP[lg]
        res = pmap(lambda g: curl(CORE.format(s=sport, l=l, e=g["id"]), tries=2), need, 8)
        for g, j in zip(need, res):
            if j is None: continue                      # network failure: try again next run
            o = parse_core_odds(j, g)
            st.odds[g["id"]] = None if o is None else dict(sprH=o[0], total=o[1], mlH=o[2], mlA=o[3]); got += 1
    log(f"  store {lg}: scanned {start}..{today}, +{len(new)} new finals ({changed} added/changed), odds fetched {got}, now {len(st.games[lg])} games")
    return dict(new=len(new), changed=changed, scanned_from=str(start), games=len(st.games[lg]), odds=got)
