"""FanDuel straight from FanDuel: the same public JSON its own website reads (sbapi.<state>.sportsbook.fanduel.com).

Why: the SportsGameOdds feed (engine/odds.py) answers 429 for days at a time on its free plan, and then the app has no FanDuel lines at all, so gold picks,
same-game parlays, stacks and combos are empty. This module reads FanDuel's own pages for the games on the slate and writes them as events in the SAME shape
odds.py writes (data/odds.json "events": main / props / books.fanduel {odds, line, link, alts}), so fanduel.apply() and the page use them unchanged.

What it reads, per league page (customPageId nba, nfl, nhl, ncaaf, mlb, wnba, ncaab) and per slate game (event-page and its player-prop tabs):
  * moneyline, spread (puck line), total, FanDuel's alternate totals / spreads and team totals where it lists them;
  * player over/unders ("Jayson Tatum - Made Threes" 2.5);
  * player "X+" ladders: "2+ Made Threes", "To Record 8+ Rebounds", "To Score 25+ Points", "Name - Alt Receiving Yds" (Name 40+ Yards), "Player to Record 4+ Shots on Goal".
    They go on the player's over line as its alternate lines (line = X - 0.5), or as a "ladder" prop when FanDuel has no over/under for that stat.
Every price is FanDuel's own, with its add-to-betslip link (marketId + selectionId). Nothing is estimated here.
Never raises into the caller. Cached in data/fdodds.json; pulled at most every FD_GAP_MIN minutes (sooner when a game starts within 90 minutes)."""
import os, re, json, time, gzip, datetime, unicodedata, urllib.request, urllib.error
import concurrent.futures as cf

HOST = os.environ.get("FD_HOST") or "sbapi.mi.sportsbook.fanduel.com"       # Michigan: the user's state (any state's host returns the same lines for these markets)
AK = os.environ.get("FD_AK") or "FhMFpcPWXMeyZxOx"                            # the public app key FanDuel's own web page sends
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
HDR = {"User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "gzip", "Origin": "https://sportsbook.fanduel.com", "Referer": "https://sportsbook.fanduel.com/"}
PAGE = {"nba": "nba", "nfl": "nfl", "nhl": "nhl", "cfb": "ncaaf", "mlb": "mlb", "wnba": "wnba", "cbb": "ncaab"}
LEAGUE = {"nba": "NBA", "nfl": "NFL", "nhl": "NHL", "cfb": "NCAAF", "mlb": "MLB", "wnba": "WNBA", "cbb": "NCAAB"}      # the league ids odds.py / fanduel.py use
SPORT = {"nba": "basketball", "wnba": "basketball", "cbb": "basketball", "nfl": "football", "cfb": "football", "nhl": "hockey", "mlb": "baseball"}
# player-prop tabs, by their title on FanDuel's event page (the tab parameter is the title in lower case with dashes)
TABS = {"basketball": ("player points", "player threes", "player rebounds", "player assists", "player combos"),
        "football": ("passing props", "receiving props", "rushing props"),
        "hockey": ("points/assists", "shots", "game props", "goalie props", "saves"),
        "baseball": ("batter props", "pitcher props", "player props")}
GAP_MIN = float(os.environ.get("FD_GAP_MIN", "15") or 15)
NEAR_GAP_MIN = float(os.environ.get("FD_NEAR_GAP_MIN", "6") or 6)
HORIZON_H = 30
SKIP = re.compile(r"\b(1st|2nd|3rd|4th|first|second|third|last|quarter|qtr|half|period|each|most|either|race|overtime|double|triple|parlay|specials?|longest|combine)\b|/", re.I)

def _norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)
def _slug(t): return re.sub(r"[^a-z0-9]+", "-", (t or "").lower()).strip("-")
def _am(r):
    o = ((r.get("winRunnerOdds") or {}).get("americanDisplayOdds") or {})
    v = o.get("americanOddsInt", o.get("americanOdds"))
    try: return int(v)
    except Exception: return None
def _link(m, r): return f"https://sportsbook.fanduel.com/addToBetslip?marketId={m['marketId']}&selectionId={r['selectionId']}"
def _imp(a): return None if a is None else ((-a) / (-a + 100) if a < 0 else 100 / (a + 100))
def _fair(a, b):
    """no-vig American odds of side a against side b"""
    ia, ib = _imp(a), _imp(b)
    if not ia or not ib: return None
    p = ia / (ia + ib); p = min(max(p, 0.01), 0.99)
    return int(round(-100 * p / (1 - p))) if p >= 0.5 else int(round(100 * (1 - p) / p))

STATS = {"madethrees": "fg3", "threes": "fg3", "threepointersmade": "fg3", "pts": "pts", "reb": "reb", "ast": "ast", "ptsrebast": "pra", "ptsreb": "ptsreb",
         "ptsast": "ptsast", "rebast": "rebast", "passingyds": "passYds", "passingyards": "passYds", "passingtds": "passTD", "passingtouchdowns": "passTD",
         "rushingyds": "rushYds", "rushingyards": "rushYds", "receivingyds": "recYds", "receivingyards": "recYds", "receptions": "rec", "totalreceptions": "rec",
         "rushingreceivingyds": "rr", "rushingreceivingyards": "rr", "passattempts": "passAtt", "passingattempts": "passAtt", "completions": "comp", "passcompletions": "comp",
         "rushingattempts": "carries", "carries": "carries", "shotsongoal": "sog", "shots": "sog", "saves": "saves", "goaliesaves": "saves", "totalsaves": "saves",
         "strikeouts": "k", "pitcherstrikeouts": "k", "hits": "hits", "totalbases": "tb", "rbis": "rbi", "rbi": "rbi", "homeruns": "hr", "runs": "runs", "goals": "gls", "totalgoals": "gls"}
def _stat(txt, sport):
    t = (txt or "").lower().replace("alt ", "").replace("total ", "").replace("player ", "").replace("to record ", "").replace("to score ", "").replace("&", "+")
    t = re.sub(r"\bpoints\b", "pts", t); t = re.sub(r"\brebounds\b", "reb", t); t = re.sub(r"\bassists\b", "ast", t)
    k = re.sub(r"[^a-z]", "", t)
    if sport == "hockey" and k in ("pts", "points"): return "pts"
    if sport == "hockey" and k == "ast": return "ast"
    return STATS.get(k)

def _get(url, timeout=12):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=HDR), timeout=timeout) as r:
            raw = r.read()
            if raw[:2] == b"\x1f\x8b": raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as ex:
        raise RuntimeError(f"HTTP {ex.code}")
    except Exception as ex:
        raise RuntimeError(f"{type(ex).__name__}: {ex}"[:80])

def _page(lg):
    return _get(f"https://{HOST}/api/content-managed-page?page=CUSTOM&customPageId={PAGE[lg]}&pbHorizontal=false&_ak={AK}&timezone=America%2FNew_York")
def _event(eid, tab=None):
    return _get(f"https://{HOST}/api/event-page?_ak={AK}&eventId={eid}" + (f"&tab={tab}" if tab else "") + "&useCombinedTouchdownsVirtualMarket=true&usePulse=true&useQuickBets=true")

def _markets(d): return list((((d or {}).get("attachments") or {}).get("markets") or {}).values())
def _open(m): return (m.get("marketStatus") or "OPEN") == "OPEN" and not m.get("inPlay")
def _active(rs): return [r for r in rs or [] if (r.get("runnerStatus") or "ACTIVE") == "ACTIVE" and _am(r) is not None]

# ---------------------------------------------------------------- one game -> one event in odds.json's shape
def _team_side(name, ev):
    n = _norm(name)
    if n and n == _norm(ev["homeName"]): return "home"
    if n and n == _norm(ev["awayName"]): return "away"
    return None

def _main(ev, mks):
    M = ev["main"]
    def bk(odds, line, link, alts=None):
        b = {"odds": odds, "line": line, "link": link}
        if alts: b["alts"] = alts
        return {"books": {"fanduel": b}}
    for m in mks:
        if not _open(m): continue
        mt = (m.get("marketType") or ""); rs = _active(m.get("runners"))
        if mt == "MONEY_LINE" and len(rs) == 2:
            sides = {_team_side(r.get("runnerName"), ev): r for r in rs}
            if "home" in sides and "away" in sides:
                h, a = sides["home"], sides["away"]
                M["ml"] = {"home": bk(_am(h), None, _link(m, h)), "away": bk(_am(a), None, _link(m, a))}
                M["ml"]["home"]["fair"] = {"odds": _fair(_am(h), _am(a)), "line": None}; M["ml"]["away"]["fair"] = {"odds": _fair(_am(a), _am(h)), "line": None}
        elif mt == "MATCH_HANDICAP_(2-WAY)" and len(rs) == 2:
            sides = {_team_side(r.get("runnerName"), ev): r for r in rs}
            if "home" in sides and "away" in sides:
                h, a = sides["home"], sides["away"]
                M["spread"] = {"home": bk(_am(h), float(h.get("handicap") or 0), _link(m, h)), "away": bk(_am(a), float(a.get("handicap") or 0), _link(m, a))}
                M["spread"]["home"]["fair"] = {"odds": _fair(_am(h), _am(a)), "line": float(h.get("handicap") or 0)}; M["spread"]["away"]["fair"] = {"odds": _fair(_am(a), _am(h)), "line": float(a.get("handicap") or 0)}
        elif mt == "TOTAL_POINTS_(OVER/UNDER)" and len(rs) == 2:
            o = next((r for r in rs if (r.get("runnerName") or "").lower().startswith("over")), None); u = next((r for r in rs if (r.get("runnerName") or "").lower().startswith("under")), None)
            if o and u:
                ln = float(o.get("handicap") or 0)
                keep = {s: (M.get("total") or {}).get(s, {}).get("books", {}).get("fanduel", {}).get("alts") for s in ("over", "under")}
                M["total"] = {"over": bk(_am(o), ln, _link(m, o), keep["over"]), "under": bk(_am(u), ln, _link(m, u), keep["under"])}
                M["total"]["over"]["fair"] = {"odds": _fair(_am(o), _am(u)), "line": ln}; M["total"]["under"]["fair"] = {"odds": _fair(_am(u), _am(o)), "line": ln}
    # FanDuel's alternate game totals ("Over 2.5", "Under 8.5") and alternate spreads ("Toronto Maple Leafs +2.5") as alts on the main line
    for m in mks:
        if not _open(m): continue
        mt = (m.get("marketType") or "")
        if mt.startswith("ALTERNATE_TOTAL") and M.get("total"):
            for r in _active(m.get("runners")):
                x = re.match(r"(over|under)\s+([\d.]+)$", (r.get("runnerName") or "").strip(), re.I)
                if not x: continue
                side = x.group(1).lower(); ln = float(x.group(2))
                b = M["total"][side]["books"]["fanduel"]
                if ln == b.get("line"): continue
                b.setdefault("alts", []).append({"odds": _am(r), "line": ln, "link": _link(m, r)})
        elif (mt.startswith("ALTERNATE_PUCK_LINE") or mt.startswith("ALTERNATE_SPREAD") or mt.startswith("ALTERNATE_HANDICAP")) and M.get("spread"):
            for r in _active(m.get("runners")):
                x = re.match(r"(.+?)\s+([+-][\d.]+)$", (r.get("runnerName") or "").strip())
                if not x: continue
                side = _team_side(x.group(1), ev); ln = float(x.group(2))
                if not side: continue
                b = M["spread"][side]["books"]["fanduel"]
                if ln == b.get("line"): continue
                b.setdefault("alts", []).append({"odds": _am(r), "line": ln, "link": _link(m, r)})
        elif mt in ("HOME_TOTAL_GOALS", "AWAY_TOTAL_GOALS", "HOME_TOTAL_POINTS", "AWAY_TOTAL_POINTS"):
            side = "home" if mt.startswith("HOME") else "away"
            for r in _active(m.get("runners")):
                d = (r.get("runnerName") or "").lower()
                d = "over" if d.startswith("over") else "under" if d.startswith("under") else None
                if d: ev.setdefault("tt", {}).setdefault(side, {})[d] = bk(_am(r), float(r.get("handicap") or 0), _link(m, r))

def _props(ev, mks, sport):
    """player over/unders and X+ ladders -> odds.json props. pid = the player's name (FanDuel's ids are not ESPN's; fanduel.apply matches on names)."""
    ou, lad = {}, {}
    for m in mks:
        if not _open(m): continue
        nm = (m.get("marketName") or "").strip(); rs = _active(m.get("runners"))
        if not rs or SKIP.search(nm): continue
        # (1) over / under: runners "Jayson Tatum Over" / "Kirill Marchenko - Over", with the line in handicap
        if len(rs) == 2 and all(re.search(r"(over|under)$", (r.get("runnerName") or ""), re.I) for r in rs):
            o = next((r for r in rs if re.search(r"over$", r["runnerName"], re.I)), None); u = next((r for r in rs if re.search(r"under$", r["runnerName"], re.I)), None)
            if not o or not u: continue
            pname = re.sub(r"\s*-?\s*over$", "", o["runnerName"], flags=re.I).strip()
            if not pname or pname.lower() in ("over", "under") or " " not in pname or _team_side(pname, ev): continue        # game / team totals have bare "Over"
            stxt = nm.replace(pname, "").strip(" -")
            st = _stat(stxt, sport)
            if not st: continue
            ln = float(o.get("handicap") or 0)
            if ln <= 0: continue
            ou[(_norm(pname), st)] = {"name": pname, "stat": st, "line": ln, "over": (_am(o), _link(m, o)), "under": (_am(u), _link(m, u))}
            continue
        # (2) ladder, one player per market: "Chris Olave - Alt Receiving Yds" with runners "Chris Olave 40+ Yards"
        x = re.match(r"(.+?)\s+-\s+(.+)$", nm)
        if x and all(re.search(r"\d+\+", r.get("runnerName") or "") for r in rs):
            pname = x.group(1).strip(); st = _stat(x.group(2), sport)
            if not st or " " not in pname or _team_side(pname, ev): continue          # "MTSU - Alt Total Rushing Yards" is a team market
            for r in rs:
                t = re.search(r"(\d+)\+", r["runnerName"])
                if t: lad.setdefault((_norm(pname), st), {"name": pname, "stat": st, "rungs": {}})["rungs"][int(t.group(1))] = (_am(r), _link(m, r))
            continue
        # (3) ladder, one rung per market, players as runners: "2+ Made Threes", "To Record 8+ Rebounds", "Player to Record 4+ Shots on Goal", "1+ Assists"
        x = re.search(r"(\d+)\+\s*(.+)$", nm)
        if x and not any(re.search(r"(over|under|\d+\+)", r.get("runnerName") or "", re.I) for r in rs):
            st = _stat(x.group(2), sport); t = int(x.group(1))
            if not st or t < 1: continue
            for r in rs:
                pname = (r.get("runnerName") or "").strip()
                if " " not in pname: continue
                lad.setdefault((_norm(pname), st), {"name": pname, "stat": st, "rungs": {}})["rungs"][t] = (_am(r), _link(m, r))
    props = []
    for k, d in ou.items():
        alts = []
        for t, (odds, link) in sorted((lad.get(k) or {}).get("rungs", {}).items()):
            if t - 0.5 == d["line"]: continue
            alts.append({"odds": odds, "line": t - 0.5, "link": link})
        fo, fu = _fair(d["over"][0], d["under"][0]), _fair(d["under"][0], d["over"][0])
        for side, (odds, link), fair in (("over", d["over"], fo), ("under", d["under"], fu)):
            b = {"odds": odds, "line": d["line"], "link": link}
            if side == "over" and alts: b["alts"] = alts
            props.append({"pid": "fd:" + k[0], "name": d["name"], "team": None, "stat": d["stat"], "type": "ou", "side": side, "fair": {"odds": fair, "line": d["line"]}, "books": {"fanduel": b}})
    for k, d in lad.items():
        if k in ou: continue
        rungs = [{"t": float(t), "odds": o, "link": l} for t, (o, l) in sorted(d["rungs"].items()) if o is not None]
        if rungs: props.append({"pid": "fd:" + k[0], "name": d["name"], "team": None, "stat": d["stat"], "type": "ladder", "rungs": rungs})
    ev["props"] = props

def _build_event(lg, e, tabs_wanted=True):
    """FanDuel event (from the league page) -> odds.json event, with its player-prop tabs"""
    nm = e.get("name") or ""
    if " @ " not in nm: return None
    away, home = [re.sub(r"\s*\(.*?\)\s*$", "", x).strip() for x in nm.split(" @ ", 1)]       # MLB names carry the pitcher: "Tampa Bay Rays (D Rasmussen)"
    eid = e["eventId"]; sport = SPORT[lg]
    ev = {"id": "fd" + str(eid), "fdId": eid, "src": "fanduel", "league": LEAGUE[lg], "start": (e.get("openDate") or "").replace(".000Z", "Z"), "live": False, "final": False,
          "home": None, "away": None, "homeName": home, "awayName": away, "eventLinks": {"fanduel": f"https://sportsbook.fanduel.com/{sport}/-/{eid}"}, "main": {}, "props": []}
    d = _event(eid); mks = _markets(d)
    tabs = []
    try: tabs = [t.get("title") for t in (((d or {}).get("layout") or {}).get("tabs") or {}).values() if t.get("title")]
    except Exception: pass
    want = [t for t in tabs if t.lower() in TABS.get(sport, ())] if tabs_wanted else []
    for t in want:
        try: mks += _markets(_event(eid, _slug(t)))
        except Exception: pass
        time.sleep(0.15)
    seen = {};
    for m in mks: seen[m.get("marketId")] = m
    mks = list(seen.values())
    _main(ev, mks)
    _props(ev, mks, sport)
    return ev if ev["main"] else None

# ---------------------------------------------------------------- which FanDuel events are slate games
def _canon(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower().replace("&", " and ")
    s = re.sub(r"\b(saint|state)\b", "st", s); s = re.sub(r"\b(the|university)\b", " ", s)
    return re.sub(r"[^a-z0-9]", "", s)
def _keys(t):
    ks = set()
    for nm in (t.get("name"), t.get("short"), t.get("loc")):
        nm = (nm or "").strip()
        if not nm: continue
        ks.add(_canon(nm)); w = nm.split()
        for k in (1, 2):
            if len(w) > k: ks.add(_canon(" ".join(w[:-k])))
    return {k for k in ks if len(k) >= 3}
def _is_game(g, e):
    nm = e.get("name") or ""
    if " @ " not in nm: return False
    away, home = [_canon(re.sub(r"\s*\(.*?\)\s*$", "", x)) for x in nm.split(" @ ", 1)]
    try:
        gt = datetime.datetime.fromisoformat(g["iso"].replace("Z", "+00:00")); et = datetime.datetime.fromisoformat((e.get("openDate") or "").replace("Z", "+00:00"))
        if abs((gt - et).total_seconds()) > 6 * 3600: return False
    except Exception: return False
    return home in _keys(g["teams"]["home"]) and away in _keys(g["teams"]["away"])

def _due(cache, games, now):
    at = cache.get("at")
    if not at: return True
    try: age = (now - datetime.datetime.fromisoformat(at.replace("Z", "+00:00"))).total_seconds() / 60
    except Exception: return True
    soon = False
    for g in games:
        try:
            dt = (datetime.datetime.fromisoformat(g["iso"].replace("Z", "+00:00")) - now).total_seconds()
            if 0 < dt < 90 * 60: soon = True; break
        except Exception: pass
    return age >= (NEAR_GAP_MIN if soon else GAP_MIN)

def refresh(cache_path, odds_path, games, now=None, log=print, budget_s=55):
    """pull FanDuel for the slate's upcoming games (when due) and merge the result into data/odds.json. Returns a status string."""
    if os.environ.get("FD_DIRECT", "1") == "0": return "off (FD_DIRECT=0)"
    now = now or datetime.datetime.now(datetime.timezone.utc)
    if now.tzinfo is None: now = now.replace(tzinfo=datetime.timezone.utc)
    t0 = time.time()
    try: cache = json.load(open(cache_path))
    except Exception: cache = {}
    up = []
    for g in games or []:
        try:
            st = datetime.datetime.fromisoformat(g["iso"].replace("Z", "+00:00"))
            if now < st <= now + datetime.timedelta(hours=HORIZON_H) and (g.get("key") or g.get("lg")) in PAGE: up.append(g)
        except Exception: pass
    msg = "kept"; info = dict(cache.get("info") or {})
    if up and _due(cache, up, now):
        evs, info, errs = [], {}, []
        lgs = sorted({(g.get("key") or g.get("lg")) for g in up})
        pages = {}
        def page(lg):
            try: return lg, _page(lg), None
            except Exception as ex: return lg, None, str(ex)
        with cf.ThreadPoolExecutor(4) as ex:
            for lg, d, err in ex.map(page, lgs):
                pages[lg] = d
                if err: info[lg] = "page " + err; errs.append(f"{lg}: {err}")
        todo = []
        for lg in lgs:
            d = pages.get(lg)
            if not d: continue
            fes = [e for e in ((d.get("attachments") or {}).get("events") or {}).values()]
            mine = [(lg, e) for e in fes if any((g.get("key") or g.get("lg")) == lg and _is_game(g, e) for g in up)]
            todo += mine; info[lg] = f"{len(mine)} of {sum(1 for g in up if (g.get('key') or g.get('lg')) == lg)} slate games on FanDuel"
        def one(x):
            lg, e = x
            if time.time() - t0 > budget_s: return None, "time"
            try: return _build_event(lg, e), None
            except Exception as exn: return None, str(exn)
        with cf.ThreadPoolExecutor(6) as ex:
            for ev, err in ex.map(one, todo):
                if ev: evs.append(ev)
                elif err: errs.append(err)
        if evs or not cache.get("events"):
            old = [e for e in cache.get("events") or [] if e["id"] not in {x["id"] for x in evs}]
            keep = []
            for e in old:            # games FanDuel no longer lists before kickoff (or not reached this time) keep their last lines for 6 hours past the start
                try:
                    if (now - datetime.datetime.fromisoformat(e["start"].replace("Z", "+00:00"))).total_seconds() < 6 * 3600: keep.append(e)
                except Exception: pass
            stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
            for e in evs: e["asOf"] = stamp
            cache = {"at": stamp, "events": evs + keep, "info": info, "errors": errs[:6]}
            try:
                tmp = cache_path + ".tmp"; json.dump(cache, open(tmp, "w"), separators=(",", ":")); os.replace(tmp, cache_path)
            except Exception: pass
            nprops = sum(len(e.get("props") or []) for e in evs)
            msg = f"ok: {len(evs)} games, {nprops} player markets" + (f"; errors: {'; '.join(errs[:3])}" if errs else "")
        else:
            msg = "pull failed, kept the last one: " + "; ".join(errs[:3])
    n = merge(odds_path, cache, now)
    return f"{msg} ({n} FanDuel games in odds.json, pulled {cache.get('at') or 'never'}; {time.time() - t0:.0f}s)"

def _same(a, b):
    """is SportsGameOdds event a the same game as FanDuel event b"""
    if a.get("league") != b.get("league"): return False
    try:
        if abs((datetime.datetime.fromisoformat(a["start"].replace("Z", "+00:00")) - datetime.datetime.fromisoformat(b["start"].replace("Z", "+00:00"))).total_seconds()) > 6 * 3600: return False
    except Exception: return False
    ka, kb = {_canon(a.get("homeName")), _canon(a.get("home"))}, {_canon(b.get("homeName"))}
    ja, jb = {_canon(a.get("awayName")), _canon(a.get("away"))}, {_canon(b.get("awayName"))}
    return bool((ka & kb) - {""}) and bool((ja & jb) - {""})

def merge(odds_path, cache, now=None):
    """FanDuel's own events replace the feed's events for the same games in data/odds.json (the feed's other games stay). Returns how many are in."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    def upcoming(e):
        try: return datetime.datetime.fromisoformat(e["start"].replace("Z", "+00:00")) > now
        except Exception: return False
    fe = [e for e in cache.get("events") or [] if upcoming(e)]          # a game in play is the live pull's (odds.py refresh_live); its pregame card is frozen anyway
    try: o = json.load(open(odds_path))
    except Exception: o = {"generatedAt": None, "source": "fanduel", "events": []}
    rest = [e for e in o.get("events") or [] if e.get("src") != "fanduel" and not any(_same(e, f) for f in fe)]
    if not fe and len(rest) == len(o.get("events") or []): return 0
    o["events"] = fe + rest
    o["fdAt"] = cache.get("at"); o["fdInfo"] = cache.get("info")
    tmp = odds_path + ".tmp"; json.dump(o, open(tmp, "w"), separators=(",", ":")); os.replace(tmp, odds_path)
    return len(fe)
