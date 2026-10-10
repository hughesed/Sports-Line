"""Battle data: the latest team ratings (from the learning step) + player season averages, current rosters and the injury report for
NFL, NBA, WNBA, MLB and the two college sports (CFB, CBB).

Where it comes from (all ESPN, all optional: every failure falls back to the last good copy):
  * store/sim_cache.json   season averages per player (ESPN "byathlete" boards, 2-4 requests per league), refreshed at most one league per run, 20 h TTL.
                           Committed with the other store files; it only changes about once a day per league.
  * .cache/sim_live.json   current rosters (one request per team, a rotating slice per run, 10 h TTL) and the league injury report
                           (one request per league, re-pulled EVERY run). Scratch only (actions/cache), never committed.
  * data/sim.json          what build() writes for the page and for the Supabase sim tables: per team the adjusted ratings, the injury summary
                           and 9 players (QB + 3 RB + 5 WR/TE; 9 NBA/CBB players by minutes; 9 hitters + the starter) with their per-game stat lines.

Injury rules (the same weights as the page's own injury model, engine/build2.py injury_impact):
  * Out / injured reserve / suspended / doubtful: the player is left out of the battle; his production is handed to the teammates who take his
    place (a backup QB, the next RB / WR, the other rotation players) and the team's rating drops by his estimated value
    (NFL QB 4.0 pts, skill players 6 pts x their share of the team's yards, linemen 0.4, defenders +0.45 allowed; NBA 0.55 x (pts + ast) x minutes factor;
     MLB 0.12 runs per hitter), capped, halved when the injury is more than 3 weeks old (already in the results).
  * Questionable / day-to-day: stays, flagged (stats.q = 1 and a note), expected usage cut to 85%, and half the loss is applied to the rating.
The roster and injury state is copied into the battle when it is created (battles.markets), so lines never change mid-battle."""
import json, os, time, datetime, hashlib, re
import concurrent.futures as cf
from espn import curl, ROOT, CACHE

SPORTS = ("nfl", "nba", "wnba", "mlb", "cfb", "cbb")
ALLSPORTS = SPORTS + ("nhl",)            # hockey is team-level only (no player stat lines): it gets a team list, never the player/roster steps
FB = ("nfl", "cfb"); BB = ("nba", "wnba", "cbb")
SPN = {"nfl": ("football", "nfl"), "nba": ("basketball", "nba"), "wnba": ("basketball", "wnba"), "mlb": ("baseball", "mlb"),
       "cfb": ("football", "college-football"), "cbb": ("basketball", "mens-college-basketball"), "nhl": ("hockey", "nhl")}
BYATH = "https://site.web.api.espn.com/apis/common/v3/sports/{s}/{l}/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false&page={p}&limit={n}&sort={sort}&season={y}&seasontype=2"
SB = "https://site.api.espn.com/apis/site/v2/sports/{s}/{l}/"
PLAYER_TTL = 20 * 3600
TEAM_TTL = 20 * 86400
ROSTER_TTL = 10 * 3600
ROSTERS_PER_RUN = 14
COLLEGE_TOP = {"cfb": 36, "cbb": 40}          # college teams refreshed first (today's slate + this many strongest teams); every OTHER rated team is filled in by extend_college()
EXT_PER_RUN = 28                               # extra college teams (2 ESPN requests each) filled in per bot run, one league per run, alternating
EXT_TTL = 6 * 86400                            # a filled-in team is refreshed after this long
COLLEGE_LIST = {"cfb": None, "cbb": None}     # None = every rated college team is offered in the picker
NEED = {"nfl": 9, "cfb": 9, "nba": 9, "wnba": 9, "cbb": 9, "mlb": 9}
PER_TEAM_RAW = {"nfl": dict(QB=3, RB=6, WR=9), "cfb": dict(QB=3, RB=6, WR=9), "nba": dict(P=12), "wnba": dict(P=11), "cbb": dict(P=12), "mlb": dict(H=13, SP=4)}

def _path(root=None): return os.path.join(root or ROOT, "store", "sim_cache.json")
def load_cache(root=None):
    try:
        with open(_path(root)) as f: return json.load(f)
    except Exception: return {"teams": {}, "players": {}}
def save_cache(c, root=None):
    p = _path(root); tmp = p + ".tmp"
    with open(tmp, "w") as f: json.dump(c, f, separators=(",", ":"))
    os.replace(tmp, p)
def _live_path(root=None): return os.path.join(root and os.path.join(root, ".cache") or CACHE, "sim_live.json")
def load_live(root=None):
    try:
        with open(_live_path(root)) as f: return json.load(f)
    except Exception: return {"inj": {}, "rosters": {}}
def save_live(c, root=None):
    p = _live_path(root); os.makedirs(os.path.dirname(p), exist_ok=True); tmp = p + ".tmp"
    with open(tmp, "w") as f: json.dump(c, f, separators=(",", ":"))
    os.replace(tmp, p)

# ------------------------------------------------------------------------------------------------ ESPN boards
def _cats(d): return {c["name"]: c["names"] for c in d.get("categories", [])}
def _vals(a, cats):
    out = {}
    for c in a.get("categories", []):
        names = cats.get(c["name"]) or []
        for n, v in zip(names, c.get("values") or []): out[c["name"] + "." + n] = v
    return out

def season_candidates(lg, now):
    y = now.year
    if lg in ("nfl", "cfb"): cur = y if now.month >= 8 else y - 1
    elif lg in ("nba", "cbb"): cur = y + 1 if now.month >= 10 else y
    else: cur = y if now.month >= 3 else y - 1
    return [cur, cur - 1]

def fetch_board(lg, sort, n, now, pages=1):
    """-> (season, [(athlete, values)]) for the newest season that has real data, else (None, None)"""
    s, l = SPN[lg]
    for y in season_candidates(lg, now):
        rows = []
        for p in range(1, pages + 1):
            d = curl(BYATH.format(s=s, l=l, n=n, sort=sort, y=y, p=p), tries=1, timeout=14)
            if not d or not d.get("athletes"): break
            cats = _cats(d); rows += [(a["athlete"], _vals(a, cats)) for a in d["athletes"]]
            if len(d["athletes"]) < n: break
        gp = [v.get("general.gamesPlayed") or v.get("batting.gamesPlayed") or v.get("pitching.gamesPlayed") or 0 for _, v in rows]
        if sum(1 for x in gp if x and x > 0) >= 20: return y, rows
    return None, None

def fetch_teams(lg):
    s, l = SPN[lg]
    d = curl(SB.format(s=s, l=l) + "teams?limit=1000", tries=2, timeout=12)
    try: ts = d["sports"][0]["leagues"][0]["teams"]
    except Exception: return None
    return [dict(id=str(t["team"]["id"]), abbr=t["team"]["abbreviation"], name=t["team"].get("displayName"), short=t["team"].get("shortDisplayName") or t["team"].get("name"),
                 color="#" + (t["team"].get("color") or "334155")) for t in ts]

def _pos(ath): return ((ath.get("position") or {}).get("abbreviation")) or ""
def _r(x, n=2): return None if x is None else round(float(x), n)
def _innings_to_outs(ip):
    try:
        w = int(float(ip)); frac = round((float(ip) - w) * 10)
        return w * 3 + min(frac, 2)
    except Exception: return 0

def _merge(*boards):
    """athlete id -> (athlete, merged values). Each board lists every stat category, so merging just widens coverage."""
    out = {}
    for b in boards:
        for ath, v in (b or []):
            k = str(ath["id"]); cur = out.get(k)
            if cur is None: out[k] = (ath, dict(v))
            else:
                for kk, vv in v.items():
                    if cur[1].get(kk) in (None, 0) and vv not in (None, 0): cur[1][kk] = vv
    return out

def scope_teams(lg, root=None):
    """college: the teams that get player props = today's/near-term slate + the strongest teams of the last learned ratings. None = every team."""
    if lg not in COLLEGE_TOP: return None, None
    r = root or ROOT; slate, strong = set(), []
    try:
        with open(os.path.join(r, "data", "slate.json")) as f: sj = json.load(f)
        for g in sj.get("games", []):
            if g.get("key") == lg or g.get("lg") == lg:
                for sd in ("home", "away"):
                    a = ((g.get("teams") or {}).get(sd) or {}).get("abbr")
                    if a: slate.add(a)
    except Exception: pass
    try:
        with open(os.path.join(r, "data", "learn.json")) as f: lj = json.load(f)
        rt = ((lj.get("leagues") or {}).get(lg) or {}).get("ratings") or {}
        strong = [a for a, _ in sorted(rt.items(), key=lambda kv: -((kv[1].get("o") or 0) - (kv[1].get("d") or 0)))]
    except Exception: pass
    return slate | set(strong[:COLLEGE_TOP[lg]]), (None if COLLEGE_LIST[lg] is None else slate | set(strong[:COLLEGE_LIST[lg]]))

CORE = "https://sports.core.api.espn.com/v2/sports/{s}/leagues/{l}/seasons/{y}/types/2/teams/{t}/leaders"
def _num(x):
    try: return float(str(x).replace(",", ""))
    except Exception: return 0.0
def _leaders(lg, tid, y):
    s, l = SPN[lg]
    d = curl(CORE.format(s=s, l=l, y=y, t=tid), tries=1, timeout=8)
    res = {}
    for c in (d or {}).get("categories", []):
        rows = []
        for e in c.get("leaders", []):
            m = re.search(r"/athletes/(\d+)", ((e.get("athlete") or {}).get("$ref") or ""))
            if m: rows.append((m.group(1), e.get("value"), e.get("displayValue") or ""))
        if rows: res[c["name"]] = rows
    return res

def players_college(lg, now, teams, scope, gpmap):
    """College has no usable byathlete values (football returns blanks), so the per-team ESPN leaders feed is used: 12 players per category with
    season totals (football) or per-game numbers (basketball), plus the team roster for names and positions. One leaders + one roster request per team."""
    tm = {t["abbr"]: t["id"] for t in teams}
    todo = [a for a in sorted(scope or []) if a in tm]
    if not todo: return None, None
    probe = None
    for y in season_candidates(lg, now):
        ld = _leaders(lg, tm[todo[0]], y)
        if ld and any(k in ld for k in ("passingLeader", "pointsPerGame")): probe = y; break
    if probe is None:
        for a in todo[1:6]:
            for y in season_candidates(lg, now):
                ld = _leaders(lg, tm[a], y)
                if ld and any(k in ld for k in ("passingLeader", "pointsPerGame")): probe = y; break
            if probe: break
    if probe is None: return None, None
    def one(a):
        tid = tm[a]; ld = _leaders(lg, tid, probe); ro = fetch_roster(lg, tid, meta=True) or {}
        meta = ro.get("meta") or {}; gp = max(1.0, float(gpmap.get(a) or 1)); out = {}
        def P(pid):
            nm, pos = meta.get(pid, ("", ""))
            return out.setdefault(pid, dict(pid=pid, tid=tid, team=a, name=nm, pos=pos, role=None, stats={}))
        if lg == "cfb":
            for pid, v, dv in ld.get("passingLeader", []):
                m = re.search(r"(\d+)/(\d+), ([\d,\-]+) YDS, (\d+) TD", dv)
                if m: P(pid)["stats"].update(py=round(_num(m.group(3)) / gp, 1), ptd=round(_num(m.group(4)) / gp, 2), att=round(_num(m.group(2)) / gp, 1))
            for pid, v, dv in ld.get("rushingLeader", []):
                m = re.search(r"(\d+) CAR, ([\d,\-]+) YDS, (\d+) TD", dv)
                if m: P(pid)["stats"].update(car=round(_num(m.group(1)) / gp, 2), ry=round(_num(m.group(2)) / gp, 1), rtd=round(_num(m.group(3)) / gp, 3))
            for pid, v, dv in ld.get("receivingLeader", []):
                m = re.search(r"(\d+) REC, ([\d,\-]+) YDS, (\d+) TD", dv)
                if m: P(pid)["stats"].update(rec=round(_num(m.group(1)) / gp, 2), ly=round(_num(m.group(2)) / gp, 1), rctd=round(_num(m.group(3)) / gp, 3))
            res = []
            for p in out.values():
                st = p["stats"]
                if not p["name"]: continue
                for k in ("ry", "car", "rtd", "rec", "ly", "rctd"): st.setdefault(k, 0.0)
                st["gp"] = int(gp)
                if "py" in st and st.get("att", 0) >= 8: p["role"] = "QB"; st.setdefault("ptd", 0.0)
                elif p["pos"] in ("RB", "FB") or (p["pos"] not in ("WR", "TE", "QB") and st["car"] >= st["rec"]): p["role"] = "RB"
                elif p["pos"] in ("WR", "TE") or st["rec"] > 0: p["role"] = "WR"
                else: continue
                if p["role"] == "RB" and st["car"] < 1.0 and st["rec"] < 1.0: continue
                if p["role"] == "WR" and st["rec"] < 0.5: continue
                res.append(p)
            return res
        # basketball: per-game numbers
        def pg(name, pid): return next((_num(v) for q, v, dv in ld.get(name, []) if q == pid), None)
        res = []
        for pid in {q for rows in ld.values() for q, _, _ in rows}:
            mn, pts = pg("minutesPerGame", pid), pg("pointsPerGame", pid)
            if not mn or mn < 8 or pts is None: continue
            p = P(pid)
            if not p["name"]: continue
            p["role"] = "P"; p["stats"] = dict(pts=round(pts, 2), reb=round(pg("reboundsPerGame", pid) or 0, 2), ast=round(pg("assistsPerGame", pid) or 0, 2),
                                               fg3=round(pg("3PointMadePerGame", pid) or 0, 2), min=round(mn, 1), gp=int(gp))
            res.append(p)
        return sorted(res, key=lambda p: -p["stats"]["min"])[:PER_TEAM_RAW[lg]["P"]]
    out = []
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        for r in ex.map(one, todo):
            out += r
    if lg == "cfb":
        K = 4.0       # few games played: pull every rate toward the average of its position group (weight gp / (gp + 4))
        for role in ("QB", "RB", "WR"):
            grp = [p for p in out if p["role"] == role]
            if not grp: continue
            ks = [k for k in ("py", "ptd", "att", "ry", "car", "rtd", "rec", "ly", "rctd") if any(k in p["stats"] for p in grp)]
            mean = {k: sum(p["stats"].get(k, 0) for p in grp) / len(grp) for k in ks}
            for p in grp:
                w = p["stats"]["gp"] / (p["stats"]["gp"] + K)
                for k in ks:
                    if k in p["stats"]: p["stats"][k] = round(w * p["stats"][k] + (1 - w) * mean[k], 3 if k in ("rtd", "rctd") else 2)
        key = {"QB": lambda p: -(p["stats"].get("att") or 0), "RB": lambda p: -((p["stats"]["car"] or 0) + (p["stats"]["rec"] or 0)), "WR": lambda p: -((p["stats"]["ly"] or 0) + 10 * (p["stats"]["rec"] or 0))}
        out.sort(key=lambda p: key[p["role"]](p))
        cnt = {}; res = []
        for p in out:
            k = (p["team"], p["role"])
            if cnt.get(k, 0) >= PER_TEAM_RAW[lg][p["role"]]: continue
            cnt[k] = cnt.get(k, 0) + 1; res.append(p)
        out = res
    return probe, out

def team_gp(lg, root=None):
    try:
        with open(os.path.join(root or ROOT, "data", "learn.json")) as f: lj = json.load(f)
        return {a: r.get("gp") or 0 for a, r in (((lj.get("leagues") or {}).get(lg) or {}).get("ratings") or {}).items()}
    except Exception: return {}

def players_for(lg, now, idmap, scope=None, teams=None, gpmap=None):
    """-> (season, list of raw player dicts {pid, tid, team, name, pos, role, stats}) or (None, None) when ESPN failed.
    Raw = everybody who could be on a battle roster (a few more per team than the 9 shown, so injured players can be replaced)."""
    if lg in COLLEGE_TOP: return players_college(lg, now, teams or [], scope, gpmap or {})
    out = []
    keep = lambda t: t and (scope is None or t in scope)
    def add(ath, team, role, stats):
        out.append(dict(pid=str(ath["id"]), tid=str(ath.get("teamId") or ""), team=team, name=ath.get("displayName") or ath.get("shortName"), pos=_pos(ath), role=role, stats=stats))
    def top(lst, per_role):
        cnt = {}; res = []
        for p in lst:
            k = (p["team"], p["role"])
            if cnt.get(k, 0) >= per_role[p["role"]]: continue
            cnt[k] = cnt.get(k, 0) + 1; res.append(p)
        return res
    if lg in BB:
        y, rows = fetch_board(lg, "offensive.avgPoints:desc", 330, now, 2)
        if not rows: return None, None
        for ath, v in rows:
            t = idmap.get(str(ath.get("teamId"))) or ath.get("teamShortName"); gp = v.get("general.gamesPlayed") or 0
            mn = v.get("general.avgMinutes") or 0
            if not keep(t) or gp < (10 if lg in ("nba", "wnba") else 5) or mn < 8: continue
            add(ath, t, "P", dict(pts=_r(v.get("offensive.avgPoints")), reb=_r(v.get("general.avgRebounds")), ast=_r(v.get("offensive.avgAssists")),
                                  fg3=_r(v.get("offensive.avgThreePointFieldGoalsMade")), min=_r(mn, 1), gp=int(gp)))
        out.sort(key=lambda p: -(p["stats"]["min"] or 0))
        return y, top(out, PER_TEAM_RAW[lg])
    if lg in FB:
        y, pas = fetch_board(lg, "passing.passingYards:desc", 90, now)
        if not pas: return None, None
        _, rus = fetch_board(lg, "rushing.rushingYards:desc", 400, now, 1)
        _, rec = fetch_board(lg, "receiving.receivingYards:desc", 500, now, 2)
        m = _merge(pas, rus, rec)
        for k, (ath, v) in m.items():
            t = idmap.get(str(ath.get("teamId"))) or ath.get("teamShortName"); gp = v.get("general.gamesPlayed") or 0; pos = _pos(ath)
            if not keep(t) or gp < 1: continue
            g = lambda key: float(v.get(key) or 0)
            base = dict(ry=_r(g("rushing.rushingYards") / gp, 1), car=_r(g("rushing.rushingAttempts") / gp), rtd=_r(g("rushing.rushingTouchdowns") / gp, 3),
                        rec=_r(g("receiving.receptions") / gp), ly=_r(g("receiving.receivingYards") / gp, 1), rctd=_r(g("receiving.receivingTouchdowns") / gp, 3), gp=int(gp))
            if pos == "QB":
                if g("passing.passingAttempts") / gp < 8: continue
                add(ath, t, "QB", dict(base, py=_r(g("passing.passingYards") / gp, 1), ptd=_r(g("passing.passingTouchdowns") / gp, 2), att=_r(g("passing.passingAttempts") / gp, 1)))
            elif pos in ("RB", "FB"):
                if g("rushing.rushingAttempts") / gp < 1.0 and g("receiving.receptions") / gp < 1.0: continue
                add(ath, t, "RB", base)
            elif pos in ("WR", "TE"):
                if g("receiving.receptions") / gp < 0.5: continue
                add(ath, t, "WR", base)
        key = {"QB": lambda p: -(p["stats"].get("att") or 0), "RB": lambda p: -((p["stats"]["car"] or 0) + (p["stats"]["rec"] or 0)), "WR": lambda p: -((p["stats"]["ly"] or 0) + 10 * (p["stats"]["rec"] or 0))}
        out.sort(key=lambda p: key[p["role"]](p))
        return y, top(out, PER_TEAM_RAW[lg])
    # mlb
    y, bat = fetch_board("mlb", "batting.hits:desc", 350, now, 2)
    if not bat: return None, None
    _, pit = fetch_board("mlb", "pitching.strikeouts:desc", 300, now, 1)
    for ath, v in bat:
        t = idmap.get(str(ath.get("teamId"))) or ath.get("teamShortName"); gp = v.get("batting.gamesPlayed") or 0
        if not keep(t) or gp < 20 or (v.get("batting.atBats") or 0) / gp < 2.2: continue
        add(ath, t, "H", dict(h=_r((v.get("batting.hits") or 0) / gp), hr=_r((v.get("batting.homeRuns") or 0) / gp, 3), rbi=_r((v.get("batting.RBIs") or 0) / gp),
                              tb=_r((v.get("batting.totalBases") or 0) / gp), r=_r((v.get("batting.runs") or 0) / gp), gp=int(gp)))
    out.sort(key=lambda p: -(p["stats"]["tb"] or 0) - (p["stats"]["r"] or 0) * 0.3)
    hit = top(out, PER_TEAM_RAW["mlb"]); out = []
    for ath, v in (pit or []):
        t = idmap.get(str(ath.get("teamId"))) or ath.get("teamShortName"); gs = v.get("pitching.gamesStarted") or 0
        if not keep(t) or gs < 5: continue
        outs = _innings_to_outs(v.get("pitching.innings") or 0)
        add(ath, t, "SP", dict(k=_r((v.get("pitching.strikeouts") or 0) / max(gs, 1)), outs=_r(outs / max(gs, 1), 1), gs=int(gs)))
    out.sort(key=lambda p: -(p["stats"]["gs"] or 0))
    return y, hit + top(out, PER_TEAM_RAW["mlb"])

# ------------------------------------------------------------------------------------------------ injuries + rosters
def classify(i):
    """one ESPN injury item -> ('out' | 'q' | None, label)"""
    st = (i.get("status") or "").strip(); s = st.lower()
    txt = ((i.get("shortComment") or "") + " " + ((i.get("details") or {}).get("type") or "")).lower()
    if s in ("out", "injured reserve", "suspension", "physically unable to perform", "out for season") or s.endswith("-il") or "ruled out" in txt or "will not play" in txt:
        return "out", st if (s.endswith("-il") or s in ("injured reserve", "suspension", "physically unable to perform", "out for season")) else "Out"
    if "doubtful" in s or "doubtful" in txt: return "out", "Doubtful"
    if "questionable" in s or "questionable" in txt: return "q", "Questionable"
    if s == "day-to-day" and "probable" not in txt: return "q", "Day-to-day"
    return None, st

def fetch_injuries(lg):
    """-> {team_id: [{pid, name, pos, kind, label, note, date}]} from the league feed (one request) or None when the feed is down"""
    s, l = SPN[lg]
    d = curl(SB.format(s=s, l=l) + "injuries", tries=1, timeout=7)
    if not d or "injuries" not in d: return None
    res = {}
    for t in d.get("injuries", []):
        seen = set()          # the feed lists some players twice (a current and an old draft-prospect id): keep the first
        for i in t.get("injuries", []):
            a = i.get("athlete") or {}
            pid = str(a.get("id") or "")
            if not pid:      # the feed's own "id" is the injury record; the athlete id is inside the player-card link (.../id/4431611/name)
                for lk in a.get("links") or []:
                    m = re.search(r"/id/(\d+)", lk.get("href") or "")
                    if m: pid = m.group(1); break
            kind, label = classify(i)
            nk = (a.get("displayName") or a.get("fullName") or "").lower()
            if not pid or not kind or (nk and nk in seen): continue
            seen.add(nk)
            pos = (a.get("position") or {}); pos = pos.get("abbreviation") if isinstance(pos, dict) else pos
            tid = str((a.get("team") or {}).get("id") or t.get("id") or "")
            res.setdefault(str(t.get("id")), []).append(dict(pid=pid, name=a.get("displayName") or a.get("fullName") or "", pos=pos or "", kind=kind, label=label,
                                                          note=(i.get("shortComment") or "")[:120], date=(i.get("date") or "")[:10]))
    return res

def fetch_roster(lg, tid, meta=False):
    """-> {ids: [...], inj: {pid: (kind, label)}, meta: {pid: (name, pos)}} for one team, or None"""
    s, l = SPN[lg]
    d = curl(SB.format(s=s, l=l) + f"teams/{tid}/roster", tries=1, timeout=7)
    if not d or not d.get("athletes"): return None
    ids, inj, mt = [], {}, {}
    for g in d["athletes"]:
        for a in (g.get("items") if isinstance(g, dict) and "items" in g else [g]):
            if not isinstance(a, dict) or not a.get("id"): continue
            ids.append(str(a["id"]))
            if meta: mt[str(a["id"])] = (a.get("displayName") or a.get("fullName") or "", _pos(a))
            for it in (a.get("injuries") or [])[:1]:
                kind, label = classify(it)
                if kind: inj[str(a["id"])] = (kind, label)
    return dict(ids=ids, inj=inj, meta=mt)

def refresh_live(now, log, root=None, lgs=SPORTS, cache=None):
    """every run: the injury report of every league (parallel, one request each) + the stalest slice of team rosters. Returns the live cache."""
    live = load_live(root); live.setdefault("inj", {}); live.setdefault("rosters", {})
    cache = cache or load_cache(root); t_now = time.time()
    with cf.ThreadPoolExecutor(max_workers=5) as ex:
        futs = {lg: ex.submit(fetch_injuries, lg) for lg in lgs}
        for lg, f in futs.items():
            try: r = f.result()
            except Exception: r = None
            if r is not None: live["inj"][lg] = dict(ts=t_now, teams=r)
    nin = {lg: sum(len(v) for v in (live["inj"].get(lg) or {}).get("teams", {}).values()) for lg in lgs}
    log("  sim: injury reports " + ", ".join(f"{lg} {n}" for lg, n in nin.items()))
    # rosters: oldest first, a bounded number per run
    todo = []
    for lg in lgs:
        tms = (cache.get("teams", {}).get(lg) or {}).get("teams") or []
        have = {p["tid"] for p in (cache.get("players", {}).get(lg) or {}).get("list", [])}
        for t in tms:
            if t["id"] not in have: continue          # only teams that get players
            ts = ((live["rosters"].get(lg) or {}).get(t["id"]) or {}).get("ts", 0)
            if t_now - ts > ROSTER_TTL: todo.append((ts, lg, t["id"]))
    todo.sort()
    done = 0
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        futs = [(lg, tid, ex.submit(fetch_roster, lg, tid)) for _, lg, tid in todo[:ROSTERS_PER_RUN]]
        for lg, tid, f in futs:
            try: r = f.result()
            except Exception: r = None
            if r: live["rosters"].setdefault(lg, {})[tid] = dict(ts=t_now, ids=r["ids"], inj=r["inj"]); done += 1
    log(f"  sim: rosters refreshed for {done} teams ({max(0, len(todo) - done)} older ones wait for later runs)")
    save_live(live, root)
    return live

def all_college_teams(lg, root=None):
    """every college team the model has a rating for"""
    try:
        with open(os.path.join(root or ROOT, "data", "learn.json")) as f: lj = json.load(f)
        return sorted((((lj.get("leagues") or {}).get(lg) or {}).get("ratings") or {}).keys())
    except Exception: return []

def extend_college(now, log, root, c):
    """Give the rest of the college teams their players (so every school can be picked with player props in a battle). Each bot run fills in a few
    teams that have none yet (then the oldest ones again), one league per run, alternating CFB / CBB. Uses the same two ESPN requests per team as the
    main fetch; a team ESPN has too little data for simply stays team-level. Returns True when the cache changed."""
    lgs = [lg for lg in ("cfb", "cbb") if (c["teams"].get(lg) or {}).get("teams") and (c["players"].get(lg) or {}).get("list")]
    if not lgs: return False
    lg = ("cfb" if "cfb" in lgs else lgs[0]) if int(time.time() // 600) % 3 else lgs[int(time.time() // 600) % len(lgs)]   # CFB gets two runs in three until every school has players
    pc = c["players"][lg]; tts = pc.setdefault("tts", {}); t_now = time.time()
    tm = {t["abbr"]: t["id"] for t in c["teams"][lg]["teams"]}
    have = {p["team"] for p in pc["list"]}
    cand = [a for a in all_college_teams(lg, root) if a in tm]
    cand.sort(key=lambda a: (a in have, tts.get(a, 0)))              # no players yet first, then the oldest
    todo = [a for a in cand if (a not in have) or t_now - tts.get(a, 0) > EXT_TTL][:EXT_PER_RUN]
    if not todo: return False
    y, pl = players_college(lg, now, c["teams"][lg]["teams"], set(todo), team_gp(lg, root))
    for a in todo: tts[a] = t_now                                    # tried (also when ESPN had nothing): do not retry every run
    if pl:
        got = {p["team"] for p in pl}
        pc["list"] = [p for p in pc["list"] if p["team"] not in got] + pl
        log(f"  sim: {lg} filled in {len(got)} of {len(todo)} more teams ({len(have | got)} of {len(cand)} covered)")
    else:
        log(f"  sim: {lg} fill-in found no players for {len(todo)} teams")
    return True

def refresh(now, log, max_leagues=1, root=None):
    """refresh the stalest league's player averages (and missing team lists), then the injury report + a slice of rosters. Returns the cache."""
    c = load_cache(root); changed = False; t_now = time.time()
    for lg in ALLSPORTS:
        tm = c["teams"].get(lg)
        if not tm or t_now - tm.get("ts", 0) > TEAM_TTL:
            ts = fetch_teams(lg)
            if ts: c["teams"][lg] = dict(ts=t_now, teams=ts); changed = True; log(f"  sim: {lg} team list ({len(ts)} teams)")
    stale = sorted([lg for lg in SPORTS if t_now - (c["players"].get(lg) or {}).get("ts", 0) > PLAYER_TTL], key=lambda lg: (c["players"].get(lg) or {}).get("ts", 0))
    for lg in stale[:max_leagues]:
        idmap = {t["id"]: t["abbr"] for t in (c["teams"].get(lg) or {}).get("teams", [])}
        scope, _ = scope_teams(lg, root)
        y, pl = players_for(lg, now, idmap, scope, teams=(c["teams"].get(lg) or {}).get("teams", []), gpmap=team_gp(lg, root))
        if pl:
            old = c["players"].get(lg) or {}; fresh = {p["team"] for p in pl}
            keep = [p for p in old.get("list", []) if p["team"] not in fresh] if lg in COLLEGE_TOP else []     # filled-in teams stay
            tts = dict(old.get("tts") or {}); tts.update({a: t_now for a in fresh})
            c["players"][lg] = dict(ts=t_now, season=y, list=pl + keep, tts=tts); changed = True
            log(f"  sim: {lg} player averages, season {y}: {len(pl)} players")
        else:
            (c["players"].setdefault(lg, {}))["tried"] = t_now
            log(f"  sim: {lg} player averages could not be fetched; keeping the last copy")
    try:
        if extend_college(now, log, root, c): changed = True
    except Exception as ex: log(f"  sim: college fill-in skipped ({type(ex).__name__}: {ex})"[:200])
    if changed: save_cache(c, root)
    try: refresh_live(now, log, root, cache=c)
    except Exception as ex: log(f"  sim: injuries/rosters skipped ({type(ex).__name__}: {ex})"[:200])
    return c

# ------------------------------------------------------------------------------------------------ composing a team's battle roster
def _clamp(x, a, b): return max(a, min(b, x))

def _ageing(date, today=None):
    """injuries older than 3 weeks are partly in the ratings already: count them half"""
    try:
        d = datetime.date.fromisoformat(date[:10]); t = today or datetime.date.today()
        return 0.5 if (t - d).days > 21 else 1.0
    except Exception: return 1.0

def _scale(stats, keys, f):
    for k in keys:
        if stats.get(k) is not None: stats[k] = round(stats[k] * f, 3 if k in ("rtd", "rctd", "hr") else 2)

FB_KEYS = ("ry", "car", "rtd", "rec", "ly", "rctd")
def compose_team(lg, abbr, cands, out_ids, q_ids, inj_items, today=None):
    """cands: raw players of the team (dicts with stats). out_ids / q_ids: sets of player ids. inj_items: the team's injury report items (for linemen etc.).
    -> (players list with rank + stats, info dict {out:[...], q:[...], offAdj, defAdj, redistributed})"""
    cands = [dict(p, stats=dict(p["stats"])) for p in cands]
    by_id = {p["pid"]: p for p in cands}
    info = dict(out=[], q=[], offAdj=0.0, defAdj=0.0)
    unit = {"nfl": 1.0, "cfb": 1.0, "nba": 1.0, "wnba": 0.75, "cbb": 0.8, "mlb": 0.12}[lg]
    item_by_id = {i["pid"]: i for i in inj_items}
    off = deff = 0.0
    def age(pid): return _ageing((item_by_id.get(pid) or {}).get("date", ""), today)
    if lg in FB:
        teamtot = sum((p["stats"].get("ry") or 0) + (p["stats"].get("ly") or 0) for p in cands) or 1.0
        qbs = sorted([p for p in cands if p["role"] == "QB"], key=lambda p: -(p["stats"].get("att") or 0))
        outs = [p for p in cands if p["pid"] in out_ids]
        for p in outs:
            w = age(p["pid"]); info["out"].append(dict(pid=p["pid"], name=p["name"], pos=p["pos"], label=(item_by_id.get(p["pid"]) or {}).get("label", "Out")))
            if p["role"] == "QB": off += 4.0 * w
            else:
                share = ((p["stats"].get("ry") or 0) + (p["stats"].get("ly") or 0)) / teamtot
                off += share * 6.0 * w
        # injured players that are not among our candidates (linemen, defenders, depth skill players): flat values by position
        for i in inj_items:
            if i["kind"] != "out" or i["pid"] in by_id: continue
            w = _ageing(i.get("date", ""), today)
            if i["pos"] in ("QB",): off += 4.0 * w
            elif i["pos"] in ("C", "G", "OT", "T", "OL", "OG"): off += 0.4 * w
            elif i["pos"] in ("DE", "DT", "DL", "LB", "CB", "S", "DB", "EDGE", "NT"): deff += 0.45 * w
            elif i["pos"] in ("RB", "WR", "TE", "FB"): off += 0.25 * w
            if len(info["out"]) < 8 and i["pos"] in ("QB", "RB", "WR", "TE", "FB", "C", "G", "OT", "T", "OL", "OG", "DE", "DT", "DL", "LB", "CB", "S", "DB", "EDGE", "NT"):
                info["out"].append(dict(pid=i["pid"], name=i["name"], pos=i["pos"], label=i.get("label", "Out")))
        healthy = [p for p in cands if p["pid"] not in out_ids]
        # production of the missing players goes to the teammates in the same role
        for role, keyp in (("RB", "ry"), ("WR", "ly")):
            gone = [p for p in outs if p["role"] == role]; stay = [p for p in healthy if p["role"] == role]
            if not gone or not stay: continue
            tot = sum((p["stats"].get(keyp) or 0) + 1 for p in stay)
            for g in gone:
                for p in stay:
                    sh = ((p["stats"].get(keyp) or 0) + 1) / tot * 0.7
                    for k in FB_KEYS: p["stats"][k] = round((p["stats"].get(k) or 0) + (g["stats"].get(k) or 0) * sh, 3 if k in ("rtd", "rctd") else 2)
        # backup QB
        if any(p["role"] == "QB" for p in outs):
            starter = max([p for p in outs if p["role"] == "QB"], key=lambda p: p["stats"].get("att") or 0)
            have = [p for p in healthy if p["role"] == "QB"]
            if not have:
                sub = dict(pid="sub-" + abbr, tid=starter.get("tid", ""), team=abbr, name="Backup QB", pos="QB", role="QB", stats=dict(starter["stats"]))
                for k in ("py", "ptd", "ry", "rtd", "att"): sub["stats"][k] = round((sub["stats"].get(k) or 0) * 0.8, 2)
                sub["stats"]["sub"] = 1; healthy.append(sub)
        for p in healthy:
            if p["pid"] in q_ids:
                p["stats"]["q"] = 1; p["inj"] = (item_by_id.get(p["pid"]) or {}).get("label", "Questionable"); p["note"] = (item_by_id.get(p["pid"]) or {}).get("note", "")
                _scale(p["stats"], FB_KEYS + (("py", "ptd") if p["role"] == "QB" else ()), 0.85)
                share = ((p["stats"].get("ry") or 0) + (p["stats"].get("ly") or 0)) / teamtot
                off += (4.0 if p["role"] == "QB" else share * 6.0) * 0.35 * age(p["pid"])
                info["q"].append(dict(pid=p["pid"], name=p["name"], pos=p["pos"], label=p["inj"]))
        # rank
        res = []
        qb = sorted([p for p in healthy if p["role"] == "QB"], key=lambda p: -(p["stats"].get("att") or p["stats"].get("py") or 0))[:1]
        rb = sorted([p for p in healthy if p["role"] == "RB"], key=lambda p: -((p["stats"].get("car") or 0) + (p["stats"].get("rec") or 0)))[:3]
        wr = sorted([p for p in healthy if p["role"] == "WR"], key=lambda p: -((p["stats"].get("ly") or 0) + 10 * (p["stats"].get("rec") or 0)))[:max(5, 8 - len(rb))]   # thin backfield: one more receiver so the team still has 9 listed
        for lst in (qb, rb, wr):
            for i, p in enumerate(lst, 1): res.append(dict(p, rk=i))
        cap = (6.0, 3.0)
    elif lg in BB:
        mult = 0.55 if lg == "nba" else 0.42 if lg == "wnba" else 0.45
        outs = [p for p in cands if p["pid"] in out_ids]
        for p in outs:
            s = p["stats"]; w = age(p["pid"]); info["out"].append(dict(pid=p["pid"], name=p["name"], pos=p["pos"], label=(item_by_id.get(p["pid"]) or {}).get("label", "Out")))
            off += mult * ((s.get("pts") or 0) + (s.get("ast") or 0)) * w * _clamp((s.get("min") or 0) / 30.0, 0.3, 1.0)
        for i in inj_items:
            if i["kind"] == "out" and i["pid"] not in by_id and len(info["out"]) < 8: info["out"].append(dict(pid=i["pid"], name=i["name"], pos=i["pos"], label=i.get("label", "Out")))
        healthy = [p for p in cands if p["pid"] not in out_ids]
        # their points, rebounds and assists go to the others, weighted by minutes (85% of it; the rest is lost production)
        tot_min = sum(p["stats"].get("min") or 0 for p in healthy[:9]) or 1.0
        for g in outs:
            for p in healthy[:9]:
                sh = (p["stats"].get("min") or 0) / tot_min * 0.85
                for k in ("pts", "reb", "ast", "fg3"): p["stats"][k] = round((p["stats"].get(k) or 0) + (g["stats"].get(k) or 0) * sh, 2)
                p["stats"]["min"] = round(min(40.0, (p["stats"].get("min") or 0) + (g["stats"].get("min") or 0) * sh * 0.8), 1)
        for p in healthy:
            if p["pid"] in q_ids:
                p["stats"]["q"] = 1; p["inj"] = (item_by_id.get(p["pid"]) or {}).get("label", "Questionable"); p["note"] = (item_by_id.get(p["pid"]) or {}).get("note", "")
                s = p["stats"]; off += mult * ((s.get("pts") or 0) + (s.get("ast") or 0)) * 0.35 * age(p["pid"]) * _clamp((s.get("min") or 0) / 30.0, 0.3, 1.0)
                _scale(s, ("pts", "reb", "ast", "fg3", "min"), 0.85)
                info["q"].append(dict(pid=p["pid"], name=p["name"], pos=p["pos"], label=p["inj"]))
        healthy.sort(key=lambda p: -(p["stats"].get("min") or 0))
        res = [dict(p, rk=i) for i, p in enumerate(healthy[:9], 1)]
        cap = (8.0, 0.0)
    else:   # mlb
        outs = [p for p in cands if p["pid"] in out_ids]
        for p in outs:
            w = age(p["pid"]); info["out"].append(dict(pid=p["pid"], name=p["name"], pos=p["pos"], label=(item_by_id.get(p["pid"]) or {}).get("label", "Out")))
            if p["role"] == "H": off += 0.12 * w
        for i in inj_items:
            if i["kind"] == "out" and i["pid"] not in by_id:
                if i["pos"] in ("2B", "SS", "3B", "1B", "LF", "CF", "RF", "C", "DH", "OF", "IF"): off += 0.06 * _ageing(i.get("date", ""), today)
                if len(info["out"]) < 8 and i["pos"] not in ("RP", "P"): info["out"].append(dict(pid=i["pid"], name=i["name"], pos=i["pos"], label=i.get("label", "Out")))
        healthy = [p for p in cands if p["pid"] not in out_ids]
        for p in healthy:
            if p["pid"] in q_ids:
                p["stats"]["q"] = 1; p["inj"] = (item_by_id.get(p["pid"]) or {}).get("label", "Questionable"); p["note"] = (item_by_id.get(p["pid"]) or {}).get("note", "")
                if p["role"] == "H": off += 0.12 * 0.35 * age(p["pid"])
                info["q"].append(dict(pid=p["pid"], name=p["name"], pos=p["pos"], label=p["inj"]))
        hit = sorted([p for p in healthy if p["role"] == "H"], key=lambda p: -((p["stats"].get("tb") or 0) + 0.3 * (p["stats"].get("r") or 0)))[:9]
        sp = sorted([p for p in healthy if p["role"] == "SP"], key=lambda p: -(p["stats"].get("gs") or 0))[:1]
        res = [dict(p, rk=i) for i, p in enumerate(hit, 1)] + [dict(p, rk=1) for p in sp]
        cap = (0.6, 0.3)
    info["offAdj"] = round(min(off, cap[0]), 2); info["defAdj"] = round(min(deff, cap[1]), 2)
    for k in ("out", "q"): info[k] = info[k][:8]
    return res, info

# ------------------------------------------------------------------------------------------------ page + Supabase output
def build(learn_out, cache, live=None, today=None, tennis=None):
    """-> sim.json dict (page) ; also used for the Supabase rows"""
    live = live if live is not None else load_live()
    out = {"sports": {}}
    for lg in ALLSPORTS:
        L = (learn_out.get("leagues") or {}).get(lg)
        if not L or not L.get("ratings"): continue
        tmeta = (cache["teams"].get(lg) or {}).get("teams", [])
        meta = {t["abbr"]: t for t in tmeta}
        pc = cache["players"].get(lg) or {}
        raw = pc.get("list", [])
        by_team = {}
        for p in raw: by_team.setdefault(p["team"], []).append(p)
        by_pid = {p["pid"]: p for p in raw}
        inj_lg = ((live.get("inj") or {}).get(lg) or {}).get("teams") or {}
        ros_lg = (live.get("rosters") or {}).get(lg) or {}
        scope, listed = scope_teams(lg)
        teams, players = [], {}
        # the rated teams to offer: pro leagues all; college = near-term slate + strongest
        rated = sorted(L["ratings"].items())
        if listed is not None: rated = [(a, r) for a, r in rated if a in listed]
        for ab, r in rated:
            m = meta.get(ab) or {}
            tid = m.get("id")
            cands = list(by_team.get(ab, []))
            ros = ros_lg.get(tid) if tid else None
            if ros and ros.get("ids"):
                ids = set(ros["ids"])
                cands = [p for p in cands if p["pid"] in ids] + [by_pid[i] for i in ros["ids"] if i in by_pid and by_pid[i]["team"] != ab]
            items = inj_lg.get(tid, []) if tid else []
            out_ids = {i["pid"] for i in items if i["kind"] == "out"}; q_ids = {i["pid"] for i in items if i["kind"] == "q"}
            if ros:
                for pid, (kind, label) in (ros.get("inj") or {}).items():
                    (out_ids if kind == "out" else q_ids).add(pid)
                    if not any(i["pid"] == pid for i in items): items = items + [dict(pid=pid, name=(by_pid.get(pid) or {}).get("name", ""), pos=(by_pid.get(pid) or {}).get("pos", ""), kind=kind, label=label, note="", date="")]
            nm = lambda x: re.sub(r"[^a-z]", "", (x or "").lower())
            bad = {nm(i["name"]): i["kind"] for i in items if i["name"]}
            for p in cands:        # the same player under another id in the feed
                k = bad.get(nm(p["name"]))
                if k == "out": out_ids.add(p["pid"])
                elif k == "q" and p["pid"] not in out_ids: q_ids.add(p["pid"])
            q_ids -= out_ids
            pl, info = (compose_team(lg, ab, cands, out_ids, q_ids, items, today) if cands else ([], dict(out=[], q=[], offAdj=0.0, defAdj=0.0)))
            if len(pl) < 8: pl, info = [], dict(info, short=True)          # not enough real player data for typical lines: team-level markets only
            o = round(r["o"] - info["offAdj"], 2); d = round(r["d"] + info["defAdj"], 2)
            teams.append(dict(abbr=ab, id=m.get("id"), name=m.get("name") or ab, short=m.get("short") or ab, color=m.get("color") or "#334155", o=o, d=d, gp=r.get("gp", 0),
                              inj=dict(out=info["out"], q=info["q"], offAdj=info["offAdj"], defAdj=info["defAdj"]), props=bool(pl)))
            if pl:
                players[ab] = [dict(pid=p["pid"], name=p["name"], pos=p["pos"], role=p["role"], rk=p["rk"], stats=p["stats"], **({"inj": p["inj"], "note": p.get("note", "")} if p.get("inj") else {})) for p in pl]
        out["sports"][lg] = dict(L=L.get("L"), hfa=(L.get("params") or {}).get("hfa", 0), season=pc.get("season"), teams=teams, players=players)
    if tennis: out["sports"]["tennis"] = tennis
    return out

def rows(sim):
    teams, players = [], []
    for lg, s in sim["sports"].items():
        for t in s["teams"]:
            teams.append(dict(sport=lg, abbr=t["abbr"], name=t["name"], short=t["short"], color=t["color"], o=t["o"], d=t["d"], gp=t["gp"], lg_avg=s["L"], hfa=s["hfa"], inj=t.get("inj") or {}))
        for ab, ps in s["players"].items():
            for p in ps:
                players.append(dict(sport=lg, pid=p["pid"], team=ab, name=p["name"], pos=p["pos"], role=p["role"], rk=p["rk"], stats=p["stats"], inj=p.get("inj"), note=p.get("note")))
    return teams, players

def digest(x):
    return hashlib.sha1(json.dumps(x, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]
