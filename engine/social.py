"""Bot side of the social features (only runs when SUPABASE_URL + SUPABASE_SERVICE_KEY are set):
  * settles practice bets on real games: finals from the store + ESPN box scores, graded by the database (same rules as the page)
  * uploads the games/lines/props the page offers (so the server prices bets itself) and the battle data (ratings, player averages)
  * calls finalize_days() (daily leaderboard + badges) and battle_tick() (battle timeouts / settlement); every call also keeps
    the free Supabase project awake (free projects pause after about a week without activity)
Everything here is bounded by the run's time budget and never fatal: problems are reported in data/meta.json -> social."""
import json, os, re, time, threading
import supa
from espn import SP, SB, curl, pmap, ROOT

STATE = os.path.join(ROOT, "store", "sb_state.json")
ESPFAM = {"cfb": "nfl", "nba": "wnba", "cbb": "wnba"}           # same parser families as the page (standalone.js)
COMP = {"pr": ("passYds", "rushYds"), "rr": ("rushYds", "recYds"), "pra": ("pts", "reb", "ast"), "hrr": ("hits", "runs", "rbi")}

def load_state():
    try:
        with open(STATE) as f: return json.load(f)
    except Exception: return {}
def save_state(s):
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f: json.dump(s, f, separators=(",", ":"), sort_keys=True)
    os.replace(tmp, STATE)

def write_config(data_dir):
    """data/config.json for the page: the PUBLIC project URL + anon key (safe to publish; row level security protects the data).
    Written from the GitHub variables SUPABASE_URL and SUPABASE_ANON_KEY, so nobody has to edit a file."""
    url = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/"); anon = (os.environ.get("SUPABASE_ANON_KEY") or "").strip()
    if anon and not public_key(anon):
        print("  social: SUPABASE_ANON_KEY looks like a SECRET (service role) key; it was NOT published. Use the anon / publishable key.", flush=True)
        anon = ""
    path = os.path.join(data_dir, "config.json")
    ok = url.startswith("https://") or url.startswith(("http://127.0.0.1", "http://localhost"))     # http only for a local test stack
    cfg = {"supabaseUrl": url, "supabaseAnonKey": anon} if (ok and anon) else {"supabaseUrl": "", "supabaseAnonKey": ""}
    try:
        old = json.load(open(path))
    except Exception:
        old = None
    if old != cfg:
        tmp = path + ".tmp"
        with open(tmp, "w") as f: json.dump(cfg, f, indent=1)
        os.replace(tmp, path)
    return bool(cfg["supabaseUrl"])

def public_key(k):
    """True for keys that are safe to publish (anon JWT or sb_publishable_...). Never publish a service-role / secret key."""
    import base64
    if k.startswith("sb_secret_"): return False
    if k.startswith("sb_publishable_"): return True
    try:
        part = k.split(".")[1]; part += "=" * (-len(part) % 4)
        return json.loads(base64.urlsafe_b64decode(part)).get("role") == "anon"
    except Exception:
        return False

# ------------------------------------------------------------------ finals (port of the page's espnBuild + syncMan + finalOf)
def _toi(x, d=0):
    try: return int(str(x if x is not None else "").replace("+", ""))
    except Exception:
        try: return int(float(str(x).replace("+", "")))
        except Exception: return d
def _first(s):
    m = re.match(r"\s*(-?\d+)", str(s if s is not None else "")); return int(m.group(1)) if m else 0

def box_of(key, s):
    """ESPN summary -> (home, away, {pid: {stat: value}}, set of pids marked did-not-play)"""
    lg = ESPFAM.get(key, key)
    comp = s["header"]["competitions"][0]
    home = next(c for c in comp["competitors"] if c.get("homeAway") == "home")
    away = next(c for c in comp["competitors"] if c.get("homeAway") == "away")
    p, dnp = {}, set()
    for t in (s.get("boxscore") or {}).get("players") or []:
        for grp in t.get("statistics") or []:
            keys = grp.get("keys") or []
            for a in grp.get("athletes") or []:
                aid = str(a["athlete"]["id"]); v = dict(zip(keys, a.get("stats") or [])); d = p.setdefault(aid, {})
                if lg == "nfl":
                    n = grp.get("name")
                    if n == "passing": d.update(comp=_first(v.get("completions/passingAttempts")), passYds=_toi(v.get("passingYards")), passTD=_toi(v.get("passingTouchdowns")))
                    elif n == "rushing": d.update(carries=_toi(v.get("rushingAttempts")), rushYds=_toi(v.get("rushingYards")))
                    elif n == "receiving": d.update(rec=_toi(v.get("receptions")), recYds=_toi(v.get("receivingYards")))
                elif lg == "wnba":
                    d.update(pts=_toi(v.get("points")), reb=_toi(v.get("rebounds")), ast=_toi(v.get("assists")), fg3=_first(v.get("threePointFieldGoalsMade-threePointFieldGoalsAttempted")))
                    if a.get("didNotPlay"): dnp.add(aid)
                elif lg == "mlb":
                    if grp.get("type") == "batting":
                        d.update(hits=_toi(v.get("hits")), runs=_toi(v.get("runs")), rbi=_toi(v.get("RBIs")))
                        d.setdefault("tb", 0)
                    elif grp.get("type") == "pitching":
                        ip = str(v.get("fullInnings.partInnings") or "0.0").split(".")
                        d.update(k=_toi(v.get("strikeouts")), outs=_toi(ip[0]) * 3 + (_toi(ip[1]) if len(ip) > 1 else 0))
    if lg == "mlb":       # total bases from the play-by-play text, exactly like the page
        tb = {}
        for pl in s.get("plays") or []:
            tx = pl.get("text") or ""; bid = None
            for pa in pl.get("participants") or []:
                if pa.get("type") == "batter": bid = str(pa["athlete"]["id"])
            if bid:
                v = 4 if re.search(r"homered|home run", tx) else 3 if re.search(r"\btripled\b", tx) else 2 if re.search(r"\bdoubled\b", tx) else 1 if re.search(r"\bsingled\b", tx) else 0
                if v: tb[bid] = tb.get(bid, 0) + v
        for bid, v in tb.items(): p.setdefault(bid, {})["tb"] = v
    p = {k: v for k, v in p.items() if v}
    return _toi(home.get("score")), _toi(away.get("score")), p, dnp

def final_doc(gid, home, away, box=None, dnp=()):
    played, stat = {}, {}
    for pid, row in (box or {}).items():
        played[pid] = pid not in dnp
        st = dict(row)
        for k, parts in COMP.items(): st[k] = sum(row.get(x, 0) or 0 for x in parts)
        stat[pid] = st
    for pid in dnp: played[pid] = False
    return {"gid": str(gid), "home": home, "away": away, "played": played, "stat": stat}

def finals_for(pending, store, log, max_fetch=12):
    """pending: [{gid, lg, key, start, props}] -> list of final docs for games that are over"""
    out, need = [], []
    for g in pending:
        key = g.get("key") or g.get("lg"); gid = str(g["gid"])
        row = (store.games.get(key) or {}).get(gid) if store else None
        if row and row.get("hs") is not None and not g.get("props"):
            out.append(final_doc(gid, int(row["hs"]), int(row.get("as_", row.get("as")))))
        else: need.append((g, key, row))            # player legs need the box score; games missing from the store (e.g. preseason) are read directly
    def one(item):
        g, key, row = item
        if key not in SP: return None
        sport, l = SP[key]
        s = curl(f"{SB}{sport}/{l}/summary?event={g['gid']}", tries=2, timeout=8)
        if not s or not s.get("header"): return None
        st = ((s["header"]["competitions"][0].get("status") or {}).get("type") or {})
        if st.get("state") != "post" and not st.get("completed"): return None
        h, a, box, dnp = box_of(key, s)
        return final_doc(g["gid"], h, a, box, dnp)
    got = pmap(one, need[:max_fetch], 6)
    out += [x for x in got if x]
    if need: log(f"  social: {len(need)} games with open player legs, {sum(1 for x in got if x)} box scores final")
    return out

# ------------------------------------------------------------------ uploads
def game_rows(games):
    rows = []
    for g in games:
        props = {}
        for pl in g.get("players") or []:
            stats = {}
            for st in pl.get("stats") or []:
                stats[st["key"]] = {k: st.get(k) for k in ("label", "line", "overPrice", "safeAdj", "safePrice", "matchup")}
                stats[st["key"]]["miles"] = [{k: m.get(k) for k in ("t", "price", "hit", "n")} for m in st.get("miles") or []]
            props[str(pl["id"])] = {"name": pl.get("name"), "side": pl.get("side"), "status": {"kind": (pl.get("status") or {}).get("kind")}, "avail": pl.get("avail"), "stats": stats}
        L = g.get("lines") or {}
        rows.append(dict(gid=str(g["id"]), lg=g["lg"], key=g.get("key") or g["lg"], start_at=g["iso"], home=g["teams"]["home"]["abbr"], away=g["teams"]["away"]["abbr"],
                         title=g.get("title"), lines={k: v for k, v in L.items() if k != "dk"}, props=props))
    return rows

class Runner:
    """Runs the settlement work in a background thread while the main refresh continues, so it adds ~no wall time."""
    def __init__(self, log, deadline_at):
        self.log = log; self.info = {"enabled": supa.enabled(), "errors": []}; self.t = None
        supa.STOP_AT = deadline_at
    def err(self, what, ex):
        msg = f"{what}: {type(ex).__name__}: {ex}"[:240]; self.info["errors"].append(msg); self.log("  social: " + msg)
    def start_settle(self, store, sim_refresh=None):
        if not supa.enabled(): return
        def work():
            if sim_refresh:
                try: sim_refresh()
                except Exception as ex: self.err("battle player data", ex)
            try:
                pend = supa.rpc("bot_pending_games") or []
                self.info["pending"] = len(pend)
                fins = finals_for(pend, store, self.log) if pend else []
                if fins:
                    r = supa.rpc("bot_settle_games", {"p": fins}, timeout=12); self.info["settled"] = r
                    self.log(f"  social: settled {r}")
            except Exception as ex: self.err("settle", ex)
            for fn in ("finalize_days", "battle_tick"):
                try: self.info[fn] = supa.rpc(fn)
                except Exception as ex: self.err(fn, ex)
        self.t = threading.Thread(target=work, daemon=True); self.t.start()
    def uploads(self, games, sim):
        if not supa.enabled(): return
        st = load_state(); changed = False
        try:
            rows = game_rows(games); h = st.get("games") or {}
            todo = [r for r in rows if h.get(r["gid"]) != _digest(r)]
            if todo:
                supa.upsert("games", todo, "gid")
                for r in todo: h[r["gid"]] = _digest(r)
                st["games"] = {k: v for k, v in h.items() if k in {r["gid"] for r in rows}}; changed = True
            self.info["gamesUploaded"] = len(todo)
        except Exception as ex: self.err("games upload", ex)
        try:
            import simdata
            teams, players = simdata.rows(sim)
            dt, dp = simdata.digest(teams), simdata.digest(players)
            if teams and st.get("simTeams") != dt:
                supa.upsert("sim_teams", teams, "sport,abbr"); st["simTeams"] = dt; changed = True; self.info["simTeamsUploaded"] = len(teams)
            if players and st.get("simPlayers") != dp:
                for lg in sorted({p["sport"] for p in players}):       # replace each sport's list (old players must not linger)
                    supa.delete("sim_players", f"sport=eq.{lg}")
                    supa.upsert("sim_players", [p for p in players if p["sport"] == lg], "sport,pid")
                st["simPlayers"] = dp; changed = True; self.info["simPlayersUploaded"] = len(players)
        except Exception as ex: self.err("battle data upload", ex)
        if changed: save_state(st)
        self.info["calls"] = supa.STATS["calls"]; self.info["failedCalls"] = supa.STATS["fails"]; self.info["seconds"] = round(supa.STATS["seconds"], 1)
    def finish(self, timeout):
        if self.t: self.t.join(max(0.0, timeout))
        if self.t and self.t.is_alive(): self.info["errors"].append("settlement still running at the time limit; it continues next run")
        self.info["calls"] = supa.STATS["calls"]; self.info["failedCalls"] = supa.STATS["fails"]; self.info["seconds"] = round(supa.STATS["seconds"], 1)
        return self.info

def _digest(x):
    import hashlib
    return hashlib.sha1(json.dumps(x, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()[:16]
