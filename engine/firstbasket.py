"""First basket (NBA and WNBA): who is likeliest to score it, and a record of who did.
  * predict(): for each game that has not tipped off, a chance for each player to score the game's first basket (and to score his own team's first basket).
      model = which team scores first (a small edge for the taller centre in the tip-off and for the better team) x the player's share of his team's early scoring
              (his scoring average, only players who are in the slate's rotation list, scaled by availability).
      book  = FanDuel's "first basket" prices when the feed has them, with the margin taken out (the listed prices are normalised to sum to 1).
      The two are averaged when both exist.
  * store/firstbasket.jsonl: ONE line per game, the first snapshot taken before tip-off (later runs never replace it), later graded from ESPN's play-by-play:
      the first made field goal (res.fg), the first made shot of any kind (res.any, can be a free throw), and each team's first made field goal (res.tf).
  * data/firstbasket.json: the page's track record (top pick right how often vs how often it was expected to be), and the last results.
A free throw is NOT a basket here (the first made field goal counts); res.any says when the first points of the game were a free throw.
Never raises into the caller."""
import json, os, re, math, datetime, unicodedata
from espn import SP, SB, curl, pmap, ROOT
from timeutil import parse_iso

LGS = ("wnba", "nba")
KEEP_DAYS = 400
MAX_ROWS = 12                      # players kept per game
TEAM_SHARE = 0.92                  # share of a team's first baskets that the listed players take (the rest: bench, unlisted players)
BLEND = 0.5                        # weight of the book when both it and the model have a number

def _norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)
def _imp(a):
    try: a = float(a)
    except Exception: return None
    return (-a) / (-a + 100) if a < 0 else 100 / (a + 100)
def _am(p):
    p = min(max(p, 0.005), 0.995)
    return int(round(-100 * p / (1 - p))) if p >= 0.5 else int(round(100 * (1 - p) / p))
def _clamp(x, a, b): return max(a, min(b, x))

def _pts(pl):
    for st in pl.get("stats") or []:
        if st.get("key") == "pts":
            v = st.get("proj") if st.get("proj") is not None else st.get("avg")
            if v is not None: return float(v)
    return None

def team_first(g):
    """chance that the HOME team scores the first basket: 50% + a little for the taller centre (tip-off) and for the better team"""
    cr = g.get("crossroads") or {}; T = g.get("teams") or {}
    bh = ((T.get("home") or {}).get("ht") or {}).get("big"); ba = ((T.get("away") or {}).get("ht") or {}).get("big")
    tip = _clamp(0.01 * (bh - ba), -0.04, 0.04) if (bh and ba) else 0.0
    ph = cr.get("pHome")
    return _clamp(0.5 + tip + (0.12 * (ph - 0.5) if ph is not None else 0.0), 0.40, 0.60), round(tip, 3)

def feed_first(odds_event):
    """{normalised name: (price, link-less meta)} for the player first-basket market FanDuel lists, or {} """
    out = {}
    if not odds_event: return out
    rows = [x for x in (odds_event.get("first") or []) if x.get("pid") and x.get("name")]
    by = {}
    for x in rows:
        sid = str(x.get("stat") or "").lower()
        if "team" in sid: continue                    # "first team basket scorer" is another market
        b = ((x.get("books") or {}).get("fanduel") or {})
        if b.get("odds") is None: continue
        by.setdefault(sid, []).append((x, b["odds"]))
    if not by: return out
    sid = max(by, key=lambda k: len(by[k]))
    for x, o in by[sid]:
        out[_norm(x["name"])] = dict(name=x["name"], price=int(o), side=x.get("team"))
    return out

def predict(g, odds_event=None):
    """-> {'tip':..,'pH':..,'rows':[{id,name,side,p,pt,fd}], 'src':'model'|'book'|'both'} or None"""
    try:
        pl = [p for p in (g.get("players") or []) if not (p.get("status") or {}).get("kind") == "out" and _pts(p)]
        fd = feed_first(odds_event)
        if not pl and not fd: return None
        pH, tip = team_first(g)
        rows = {}
        if pl:
            tot = {"home": 0.0, "away": 0.0}; w = {}
            for p in pl:
                a = p.get("avail"); x = (_pts(p) ** 1.25) * (1.0 if a is None else float(a))
                w[p["id"]] = x; tot[p["side"]] += x
            for side in ("home", "away"):             # a side with fewer than five listed players: the missing starters take a typical (smaller) share, so the listed ones are not inflated
                n_side = sum(1 for p in pl if p["side"] == side)
                if 0 < n_side < 5: tot[side] += (5 - n_side) * 0.6 * (tot[side] / n_side)
            for p in pl:
                if tot[p["side"]] <= 0: continue
                share = w[p["id"]] / tot[p["side"]] * TEAM_SHARE
                pm = (pH if p["side"] == "home" else 1 - pH) * share
                rows[_norm(p["name"])] = dict(id=p["id"], name=p["name"], side=p["side"], pm=pm, pt=share)
        book = {}
        if fd:
            imps = {k: _imp(v["price"]) for k, v in fd.items()}; s = sum(i for i in imps.values() if i)
            if s > 0: book = {k: i / s for k, i in imps.items() if i}
        out = []
        for k in set(rows) | set(book):
            r = rows.get(k); f = fd.get(k)
            pm = r["pm"] if r else None; pb = book.get(k)
            p = pm if pb is None else (pb if pm is None else (1 - BLEND) * pm + BLEND * pb)
            if p is None or p <= 0: continue
            out.append(dict(id=(r["id"] if r else "n" + k), name=(r["name"] if r else f["name"]), side=(r["side"] if r else f.get("side")), p=p, pt=(r["pt"] if r else None),
                            fd=(f["price"] if f else None)))
        if not out: return None
        s = sum(o["p"] for o in out)
        if s > 0.97:                                           # listed players cannot take more than all the baskets
            for o in out: o["p"] *= 0.97 / s
        out.sort(key=lambda o: -o["p"])
        for o in out[:MAX_ROWS]:
            o["p"] = round(o["p"], 4); o["pt"] = None if o["pt"] is None else round(o["pt"], 3)
        return dict(tip=tip, pH=round(pH, 3), rows=out[:MAX_ROWS], src=("both" if (pl and fd) else "book" if fd else "model"))
    except Exception:
        return None

# ---------------------------------------------------------------- results from ESPN's play-by-play
def first_baskets(s):
    """summary JSON -> {fg:{i,n,tm,sv,c,q}, any:{...}, tf:{home:{..},away:{..}}} or None when the play-by-play has no scoring plays (yet)"""
    try:
        comp = ((s.get("header") or {}).get("competitions") or [{}])[0]
        side = {}
        for c in comp.get("competitors") or []:
            side[str((c.get("team") or {}).get("id"))] = c.get("homeAway")
        if not side:
            for t in (s.get("boxscore") or {}).get("teams") or []:
                side[str((t.get("team") or {}).get("id"))] = t.get("homeAway")
        res = {"fg": None, "any": None, "tf": {}}
        for pl in s.get("plays") or []:
            sv = pl.get("scoreValue") or 0
            if not (pl.get("scoringPlay") and sv > 0): continue
            who = None
            for pa in pl.get("participants") or []:
                a = pa.get("athlete") or {}
                if a.get("id"): who = (str(a["id"]), a.get("displayName") or a.get("shortName"), pa.get("type")); break
            txt = (pl.get("text") or "").strip()
            name = who[1] if who and who[1] else (re.match(r"(.+?)\s+(?:makes|made)\b", txt) or [None, None])[1]
            if not name and not who: continue
            tm = side.get(str((pl.get("team") or {}).get("id")))
            d = dict(i=(who[0] if who else "n" + _norm(name)), n=name, tm=tm, sv=sv, q=(pl.get("period") or {}).get("number"), c=(pl.get("clock") or {}).get("displayValue"), t=txt[:90])
            if res["any"] is None: res["any"] = d
            if sv >= 2:                                                  # a field goal (a free throw is worth 1)
                if res["fg"] is None: res["fg"] = d
                if tm in ("home", "away") and tm not in res["tf"]: res["tf"][tm] = d
            if res["fg"] is not None and len(res["tf"]) == 2: break
        return res if res["fg"] else None
    except Exception:
        return None

class FirstBasket:
    def __init__(self, root=None):
        self.path = os.path.join(root or ROOT, "store", "firstbasket.jsonl")
        self.recs = {}
        if os.path.exists(self.path):
            for line in open(self.path):
                line = line.strip()
                if line:
                    try: r = json.loads(line); self.recs[r["id"]] = r
                    except Exception: pass

    def log_games(self, games, odds, now):
        """predict every NBA / WNBA game; a game that has not tipped off gets its FIRST snapshot written once. Puts g['fb'] on every card (the page shows it).
        A game that has tipped keeps its locked snapshot. -> number of new snapshots"""
        n = 0
        try:
            import fanduel as FD
            evs = (odds or {}).get("events") or []
        except Exception:
            FD, evs = None, []
        for g in games:
            try:
                key = g.get("key") or g.get("lg")
                if key not in LGS: continue
                started = parse_iso(g["iso"]) <= now
                rec = self.recs.get(g["id"])
                if started or (rec and rec.get("res")):
                    if rec: g["fb"] = dict(rows=rec["rows"], tip=rec.get("tip"), pH=rec.get("pH"), src=rec.get("src"), locked=True, res=rec.get("res"))
                    continue
                e = None
                if FD is not None and evs:
                    try: e = FD.find_event(g, evs)
                    except Exception: e = None
                pr = predict(g, e)
                if not pr: continue
                g["fb"] = dict(pr, locked=False)
                if g["id"] not in self.recs:
                    self.recs[g["id"]] = dict(id=g["id"], lg=key, iso=g["iso"], h=g["teams"]["home"]["abbr"], a=g["teams"]["away"]["abbr"], ts=now.strftime("%Y-%m-%dT%H:%MZ"),
                                              tip=pr["tip"], pH=pr["pH"], src=pr["src"], rows=[[o["id"], o["name"], o["side"], o["p"], o["pt"], o["fd"]] for o in pr["rows"]])
                    n += 1
            except Exception:
                continue
        return n

    def settle(self, store, now, log=print, limit=24):
        """grade snapshots whose game is final in the store (ESPN play-by-play). -> number newly graded"""
        todo = []
        for r in self.recs.values():
            if r.get("res") or r.get("void"): continue
            if not (store.games.get(r["lg"], {}).get(r["id"])): continue
            todo.append(r)
        todo = sorted(todo, key=lambda r: r["iso"])[:limit]
        def one(r):
            sport, lg = SP[r["lg"]]
            s = curl(f"{SB}{sport}/{lg}/summary?event={r['id']}")
            return first_baskets(s) if s else None
        n = 0
        for r, res in zip(todo, pmap(one, todo, 6)):
            if not res:
                r["tries"] = r.get("tries", 0) + 1
                if r["tries"] >= 6: r["void"] = 1                 # ESPN never produced a play-by-play for it
                continue
            r["res"] = res; self._grade(r); n += 1
        return n

    @staticmethod
    def _rows(r):
        return [dict(id=x[0], name=x[1], side=x[2], p=x[3], pt=x[4], fd=x[5]) for x in r["rows"]]

    def _grade(self, r):
        rows = self._rows(r); w = r["res"]["fg"]; ids = [x["id"] for x in rows]
        names = [_norm(x["name"]) for x in rows]
        k = ids.index(w["i"]) if w["i"] in ids else (names.index(_norm(w["n"])) if _norm(w["n"]) in names else None)
        r["rank"] = None if k is None else k + 1
        r["pw"] = None if k is None else rows[k]["p"]                 # the chance we gave the player who did it (None: not on our list)
        r["top"] = rows[0]["id"] if rows else None
        r["top1"] = 1 if k == 0 else 0
        r["top3"] = 1 if (k is not None and k < 3) else 0
        r["p1"] = rows[0]["p"] if rows else None
        r["tipHit"] = 1 if w.get("tm") and ((w["tm"] == "home") == ((r.get("pH") or 0.5) >= 0.5)) else 0

    def summary(self, now, recent=12):
        out = {"asOf": now.strftime("%Y-%m-%dT%H:%MZ"), "leagues": {}, "recent": []}
        for lg in LGS:
            gr = [r for r in self.recs.values() if r["lg"] == lg and r.get("res")]
            pend = [r for r in self.recs.values() if r["lg"] == lg and not r.get("res") and not r.get("void")]
            n = len(gr)
            d = dict(n=n, pending=len(pend))
            if n:
                d["top1"] = sum(r.get("top1", 0) for r in gr); d["top3"] = sum(r.get("top3", 0) for r in gr)
                d["exp1"] = round(sum((r.get("p1") or 0) for r in gr), 2)                        # how many top picks we expected to be right
                d["exp3"] = round(sum(sum(x[3] for x in r["rows"][:3]) for r in gr), 2)
                d["listed"] = sum(1 for r in gr if r.get("rank") is not None)
                d["tipSide"] = sum(r.get("tipHit", 0) for r in gr)
                lls = [-math.log(max(r["pw"], 0.01)) for r in gr if r.get("pw") is not None]
                d["avgPw"] = round(sum(r["pw"] for r in gr if r.get("pw") is not None) / max(1, len(lls)), 3) if lls else None
            out["leagues"][lg] = d
        done = sorted([r for r in self.recs.values() if r.get("res")], key=lambda r: r["iso"], reverse=True)[:recent]
        for r in done:
            w = r["res"]["fg"]; a = r["res"]["any"]
            out["recent"].append(dict(id=r["id"], lg=r["lg"], iso=r["iso"], h=r["h"], a=r["a"], who=w["n"], tm=w.get("tm"), sv=w.get("sv"), rank=r.get("rank"), pw=r.get("pw"),
                                      top=(r["rows"][0][1] if r["rows"] else None), p1=r.get("p1"), ft=(1 if (a and a["i"] != w["i"] and a.get("sv") == 1) else 0),
                                      tf={k: v["n"] for k, v in (r["res"].get("tf") or {}).items()}))
        return out

    def save(self, today):
        cutoff = (today - datetime.timedelta(days=KEEP_DAYS)).isoformat()
        rows = sorted([r for r in self.recs.values() if r["iso"][:10] >= cutoff], key=lambda r: (r["iso"], r["id"]))
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            for r in rows: f.write(json.dumps(r, separators=(",", ":"), ensure_ascii=False) + "\n")
        os.replace(tmp, self.path)
        self.recs = {r["id"]: r for r in rows}
