"""Battle data: the latest team ratings (from the learning step) + player averages for every NFL / NBA / MLB team.
Player averages come from ESPN's season stat leaderboards (one to three requests per league) and are cached in store/sim_cache.json;
a league is refreshed at most once a day and at most one league per run, so this adds very little to a run.
If a league is in its offseason, the latest finished season is used. Output: data/sim.json (for the page) + rows for Supabase."""
import json, os, time, datetime, hashlib
from espn import curl, ROOT

SPORTS = ("nfl", "nba", "mlb")
SPN = {"nfl": ("football", "nfl"), "nba": ("basketball", "nba"), "mlb": ("baseball", "mlb")}
BYATH = "https://site.web.api.espn.com/apis/common/v3/sports/{s}/{l}/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false&page=1&limit={n}&sort={sort}&season={y}&seasontype=2"
TEAMS = "https://site.api.espn.com/apis/site/v2/sports/{s}/{l}/teams"
PLAYER_TTL = 20 * 3600
TEAM_TTL = 20 * 86400

def _path(root=None): return os.path.join(root or ROOT, "store", "sim_cache.json")
def load_cache(root=None):
    try:
        with open(_path(root)) as f: return json.load(f)
    except Exception: return {"teams": {}, "players": {}}
def save_cache(c, root=None):
    p = _path(root); tmp = p + ".tmp"
    with open(tmp, "w") as f: json.dump(c, f, separators=(",", ":"))
    os.replace(tmp, p)

def _cats(d):
    return {c["name"]: c["names"] for c in d.get("categories", [])}
def _vals(a, cats):
    out = {}
    for c in a.get("categories", []):
        names = cats.get(c["name"]) or []
        for n, v in zip(names, c.get("values") or []):
            out[c["name"] + "." + n] = v
    return out

def season_candidates(lg, now):
    y = now.year
    if lg == "nfl": cur = y if now.month >= 8 else y - 1
    elif lg == "nba": cur = y + 1 if now.month >= 10 else y
    else: cur = y if now.month >= 3 else y - 1
    return [cur, cur - 1]

def fetch_board(lg, sort, n, now):
    s, l = SPN[lg]
    for y in season_candidates(lg, now):
        d = curl(BYATH.format(s=s, l=l, n=n, sort=sort, y=y), tries=1, timeout=10)
        if not d or not d.get("athletes"): continue
        cats = _cats(d)
        rows = [(a["athlete"], _vals(a, cats)) for a in d["athletes"]]
        gp = [v.get("general.gamesPlayed") or v.get("batting.gamesPlayed") or v.get("pitching.gamesPlayed") or 0 for _, v in rows]
        if sum(1 for x in gp if x and x > 0) >= 20:
            return y, rows
    return None, None

def fetch_teams(lg):
    s, l = SPN[lg]
    d = curl(TEAMS.format(s=s, l=l), tries=2, timeout=8)
    try:
        ts = d["sports"][0]["leagues"][0]["teams"]
    except Exception:
        return None
    return [dict(id=str(t["team"]["id"]), abbr=t["team"]["abbreviation"], name=t["team"].get("displayName"), short=t["team"].get("shortDisplayName") or t["team"].get("name"),
                 color="#" + (t["team"].get("color") or "334155")) for t in ts]

def _team(ath, idmap):
    return idmap.get(str(ath.get("teamId"))) or ath.get("teamShortName")
def _pos(ath): return ((ath.get("position") or {}).get("abbreviation")) or ""
def _r(x, n=2): return None if x is None else round(float(x), n)
def _innings_to_outs(ip):
    try:
        w = int(float(ip)); frac = round((float(ip) - w) * 10)
        return w * 3 + min(frac, 2)
    except Exception: return 0

def players_for(lg, now, idmap):
    """-> (season, list of {pid, team, name, pos, role, rk, stats}) or (None, None) when ESPN failed"""
    out = []
    def add(team_rank, team, role, ath, stats):
        k = (team, role); team_rank[k] = team_rank.get(k, 0) + 1
        out.append(dict(pid=str(ath["id"]), team=team, name=ath.get("displayName") or ath.get("shortName"), pos=_pos(ath), role=role, rk=team_rank[k], stats=stats))
    if lg == "nba":
        y, rows = fetch_board("nba", "offensive.avgPoints:desc", 210, now)
        if not rows: return None, None
        rk = {}
        for ath, v in rows:
            t = _team(ath, idmap); gp = v.get("general.gamesPlayed") or 0
            if not t or gp < 10 or rk.get((t, "P"), 0) >= 5: continue
            add(rk, t, "P", ath, dict(pts=_r(v.get("offensive.avgPoints")), reb=_r(v.get("general.avgRebounds")), ast=_r(v.get("offensive.avgAssists")),
                                      fg3=_r(v.get("offensive.avgThreePointFieldGoalsMade")), gp=int(gp)))
        return y, out
    if lg == "nfl":
        y, pas = fetch_board("nfl", "passing.passingYards:desc", 70, now)
        if not pas: return None, None
        _, rus = fetch_board("nfl", "rushing.rushingYards:desc", 110, now)
        _, rec = fetch_board("nfl", "receiving.receivingYards:desc", 170, now)
        rk = {}
        for ath, v in pas:
            t = _team(ath, idmap); gp = v.get("general.gamesPlayed") or 0
            if not t or gp < 1 or _pos(ath) != "QB" or rk.get((t, "QB"), 0) >= 1: continue
            add(rk, t, "QB", ath, dict(py=_r((v.get("passing.passingYards") or 0) / gp, 1), ptd=_r((v.get("passing.passingTouchdowns") or 0) / gp), gp=int(gp)))
        for ath, v in (rus or []):
            t = _team(ath, idmap); gp = v.get("general.gamesPlayed") or 0
            if not t or gp < 1 or _pos(ath) not in ("RB", "FB") or rk.get((t, "RB"), 0) >= 1: continue
            add(rk, t, "RB", ath, dict(ry=_r((v.get("rushing.rushingYards") or 0) / gp, 1), car=_r((v.get("rushing.rushingAttempts") or 0) / gp), gp=int(gp)))
        for ath, v in (rec or []):
            t = _team(ath, idmap); gp = v.get("general.gamesPlayed") or 0
            if not t or gp < 1 or _pos(ath) not in ("WR", "TE") or rk.get((t, "WR"), 0) >= 2: continue
            add(rk, t, "WR", ath, dict(ly=_r((v.get("receiving.receivingYards") or 0) / gp, 1), rec=_r((v.get("receiving.receptions") or 0) / gp), gp=int(gp)))
        return y, out
    # mlb
    y, bat = fetch_board("mlb", "batting.hits:desc", 330, now)
    if not bat: return None, None
    _, pit = fetch_board("mlb", "pitching.strikeouts:desc", 240, now)
    rk = {}
    for ath, v in bat:
        t = _team(ath, idmap); gp = v.get("batting.gamesPlayed") or 0
        if not t or gp < 20 or rk.get((t, "H"), 0) >= 3: continue
        add(rk, t, "H", ath, dict(h=_r((v.get("batting.hits") or 0) / gp), hr=_r((v.get("batting.homeRuns") or 0) / gp, 3), rbi=_r((v.get("batting.RBIs") or 0) / gp),
                                  tb=_r((v.get("batting.totalBases") or 0) / gp), r=_r((v.get("batting.runs") or 0) / gp), gp=int(gp)))
    for ath, v in (pit or []):
        t = _team(ath, idmap); gs = v.get("pitching.gamesStarted") or 0
        if not t or gs < 5 or rk.get((t, "SP"), 0) >= 1: continue
        outs = _innings_to_outs(v.get("pitching.innings") or 0)
        add(rk, t, "SP", ath, dict(k=_r((v.get("pitching.strikeouts") or 0) / max(gs, 1)), outs=_r(outs / max(gs, 1), 1), gs=int(gs)))
    return y, out

def refresh(now, log, max_leagues=1, root=None):
    """refresh the stalest league's players (and missing team lists). Returns the cache."""
    c = load_cache(root); changed = False; t_now = time.time()
    for lg in SPORTS:
        tm = c["teams"].get(lg)
        if not tm or t_now - tm.get("ts", 0) > TEAM_TTL:
            ts = fetch_teams(lg)
            if ts: c["teams"][lg] = dict(ts=t_now, teams=ts); changed = True; log(f"  sim: {lg} team list ({len(ts)} teams)")
    stale = sorted([lg for lg in SPORTS if t_now - (c["players"].get(lg) or {}).get("ts", 0) > PLAYER_TTL], key=lambda lg: (c["players"].get(lg) or {}).get("ts", 0))
    for lg in stale[:max_leagues]:
        idmap = {t["id"]: t["abbr"] for t in (c["teams"].get(lg) or {}).get("teams", [])}
        y, pl = players_for(lg, now, idmap)
        if pl:
            c["players"][lg] = dict(ts=t_now, season=y, list=pl); changed = True
            log(f"  sim: {lg} player averages, season {y}: {len(pl)} players")
        else:
            (c["players"].setdefault(lg, {}))["tried"] = t_now
            log(f"  sim: {lg} player averages could not be fetched; keeping the last copy")
    if changed: save_cache(c, root)
    return c

def build(learn_out, cache):
    """-> sim.json dict (page) ; also used for the Supabase rows"""
    out = {"sports": {}}
    for lg in SPORTS:
        L = (learn_out.get("leagues") or {}).get(lg)
        if not L or not L.get("ratings"): continue
        meta = {t["abbr"]: t for t in (cache["teams"].get(lg) or {}).get("teams", [])}
        teams = []
        for ab, r in sorted(L["ratings"].items()):
            m = meta.get(ab) or {}
            teams.append(dict(abbr=ab, name=m.get("name") or ab, short=m.get("short") or ab, color=m.get("color") or "#334155", o=r["o"], d=r["d"], gp=r.get("gp", 0)))
        pc = cache["players"].get(lg) or {}
        known = {t["abbr"] for t in teams}
        players = {}
        for p in pc.get("list", []):
            if p["team"] in known: players.setdefault(p["team"], []).append(p)
        out["sports"][lg] = dict(L=L.get("L"), hfa=(L.get("params") or {}).get("hfa", 0), season=pc.get("season"), teams=teams, players=players)
    return out

def rows(sim):
    teams, players = [], []
    for lg, s in sim["sports"].items():
        for t in s["teams"]:
            teams.append(dict(sport=lg, abbr=t["abbr"], name=t["name"], short=t["short"], color=t["color"], o=t["o"], d=t["d"], gp=t["gp"], lg_avg=s["L"], hfa=s["hfa"]))
        for ab, ps in s["players"].items():
            for p in ps:
                players.append(dict(sport=lg, pid=p["pid"], team=ab, name=p["name"], pos=p["pos"], role=p["role"], rk=p["rk"], stats=p["stats"]))
    return teams, players

def digest(x):
    return hashlib.sha1(json.dumps(x, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]
