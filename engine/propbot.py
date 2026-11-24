"""Prop bot: the player-prop half of the self-learning loop (the team half is engine/learn.py + engine/predlog.py).

Before this, only team picks learned on the server. Player legs (the ones gold picks, combos, same-game parlays and stacks are made of) were graded
only in the practice ledger of the phone that had the app open before the games, so most of them were never graded and nothing learned from them.
The bot runs inside every refresh:

  learn()     from the last 21 days of graded legs (below): how much each research pattern should count, then a calibration per league (how often legs
              the app called 80% really landed), per stat and side, for big favourites / big underdogs (blowouts cut starters' minutes) and per player
              (players the numbers keep getting wrong). Everything is shrunk toward "no change" until there is enough evidence, and bounded.
  research()  before FanDuel's prices go on (refresh.py runs it before fanduel.apply): for every player on an upcoming card, his ESPN game log
              (regular season, full games only, this season plus last season) and ESPN's injury report and news:
                rest   his playing time on the same rest as tonight (second night of a back-to-back, one day off, two or more) vs his usual
                mates  teammates who are out tonight: what he did in the games they missed this season (the ball goes to the players left)
                home   home vs road playing time
                dow    day of the week (starts at a small weight: mostly noise unless the graded results say otherwise)
              The projection is scaled by what it finds (weights learned, total kept within -15% / +20%), so the rungs' chances follow. It also flags
              players to keep out of the picks: questionable / game-time decision, a minutes limit or rest in the news, traded with fewer than
              3 games for the new team. Trade talk only widens the doubt (the chance is pulled a little toward 50%).
  snapshot()  after FanDuel's prices go on: every FanDuel player leg the builders can use (over/under and X+ rungs, chance 50-97%) is written
              down with the chance the app shows, the chance without the research, and the size of each pattern. Until the game starts the
              latest snapshot replaces the earlier one (late injury news counts); after that it is frozen.
  grade()     once the game is final in the store: ESPN's box score gives each leg's result (a player who did not play is a void, as at FanDuel),
              and each miss its reason: minutes cut, blowout, just short, off night.
The page (home_picks.js hpLegs) applies the calibration on the card (st.bot.s / st.bot.c) to every player leg, leaves flagged players out of the
builders, and shows the bot's notes; bot.js shows the record and what it learned (data/propbot.json). Never raises into the caller."""
import json, os, re, math, statistics, datetime, collections
import espn
from espn import ROOT, SP, SB, curl, pmap
from timeutil import ET, parse_iso
import fanduel as FD
import fdenrich as FE

DIR = os.path.join(ROOT, "store", "propbot")                     # state.json (open snapshots + learned parameters) and graded-YYYY-MM-DD.jsonl
KEEP_DAYS = 21                  # graded legs kept (one file per game day, so a finished day's file never changes again)
OPEN_MAX_DAYS = 5               # a snapshot whose game never shows up final (postponed, not in the store) is dropped after this many days
HORIZON_H = 36
P_LO, P_HI = 0.50, 0.97         # legs the builders can use (a little below their floors, so the calibration sees both sides of them)
RESEARCH = ("nba", "wnba", "nhl", "nfl", "cfb")
SNAP = ("nba", "wnba", "nhl", "nfl", "cfb", "mlb")
BIG = {"nba": 9.5, "wnba": 9.5, "nfl": 9.5, "cfb": 16.5}        # |spread| from which a game is blowout-prone
PRIOR_W = {"rest": 1.0, "mates": 1.0, "home": 0.5, "dow": 0.25}
W_GRID = (0.0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5)
K = {"rest": 8.0, "home": 12.0, "dow": 20.0, "mates": 8.0}         # shrinkage: a split of n games moves n/(n+K) of the way to what it measured
F_LO, F_HI = 0.85, 1.20
MATE_MIN = {"nba": 15.0, "wnba": 15.0, "nhl": 14.0, "nfl": 4.0, "cfb": 4.0}    # usual playing time for a teammate's absence to matter
PRIOR_PER_RUN = 80              # new players whose last season is read per run (each is read once, then kept)
MIN_CAL = 100                   # effective graded legs (one per player, stat and game) before a league's calibration moves
OVER_ONLY = {"nhl": {"pts", "sog", "saves", "ast"}}             # the user's book: NHL player props are overs only, on these stats
# news that the injury report can miss (rest days and minutes limits are often announced before the report changes); the report itself covers questionable / doubtful
NEWS_AVOID = re.compile(r"minutes? (restriction|limit)|load management|game-time decision|will (sit|rest)|(sits?|rests?|resting) (out )?(tonight|on the second|the second|on the back)|"
                        r"not (expected|likely) to play|won't play|will not play|ruled out", re.I)
NEWS_TRADE = re.compile(r"\btrade[ds]?\b|\btrading\b|trade (talks|request|block|market|rumou?rs?)|acquir|deal(t)? to", re.I)
# a trade that happened (vs talk about one): the headline says he moved, and none of the rumour words
TRADE_DONE = re.compile(r"\btraded\b|\bacquir(e|es|ed|ing)\b|\blands?\b|\blanded\b|\bdealt\b|trade sends|sends? .{2,40} to|agree(s|d)? (to|on) (a )?trade|\bswap\b|\bclaim(s|ed)?\b|\bsigns?\b|\bsigned\b", re.I)
TRADE_TALK = re.compile(r"talks?\b|rumou?r|\bcould\b|\bmight\b|interest|explor|linked|eyeing|pursu|monitor|request|wants?\b|\bblock\b|market|considering|available|calling|calls about|react|would|should|\bif\b|\?", re.I)
# THE NEW-TEAM RULE: a player who has played fewer than this many games for the team he is with now (traded, signed, or moved in the offseason)
# is not a pick for an over: his numbers come from another team and another role. Builders may use him for unders only.
NEW_TEAM_GAMES = 10
MISS_TXT = {"minutes": "minutes cut", "blowout": "blowout, sat late", "short": "just short", "off": "off night", "over": "went over the line"}

def _clamp(x, a, b): return max(a, min(b, x))
def _logit(p): p = _clamp(p, 1e-4, 1 - 1e-4); return math.log(p / (1 - p))
def _sig(z): return 1 / (1 + math.exp(-_clamp(z, -30, 30)))
def _phi(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
def _imp(a): return None if a is None else ((-a) / (-a + 100) if a < 0 else 100 / (a + 100))
def _etd(iso): return parse_iso(iso).astimezone(ET).date()
def _r3(x): return None if x is None else round(x, 3)
def _mean(xs): return sum(xs) / len(xs) if xs else None

def pois_ge(k, lam):
    """P(X >= k) for a Poisson count (same as the page's poisGE)"""
    if k <= 0: return 1.0
    if lam <= 0: return 0.0
    term = math.exp(-lam); cdf = term
    for i in range(1, int(k)): term *= lam / i; cdf += term
    return _clamp(1 - cdf, 0.0, 1.0)

# ------------------------------------------------------------------------------------------------ the page's chance for a leg (home_picks.js hpLegs)
def _pm_ou(st, T, mu):
    if mu is None: return None
    sd = st.get("sd") or math.sqrt(max(mu, 0.01))
    return pois_ge(T, mu) if mu < 8 else 1 - _phi((T - 0.5 - mu) / max(0.6, sd))

def _blend(pf, pm, av):
    base = pf if pm is None else 0.5 * pf + 0.5 * pm
    return _clamp(base * av, 0.02, 0.97)

def leg_list(lg, pl, st):
    """the FanDuel legs of one player stat, as the page builds them: [dict(r='o'|'u', T, price, pf, pm, pm_nc, pm_up)]
    pm = the model's chance on the current projection, pm_nc = on the projection before the bot's research, pm_up = with a 5% higher projection"""
    out = []; key = st.get("key")
    allow = OVER_ONLY.get(lg)
    if allow is not None and key not in allow: return out
    proj = st.get("proj"); b = st.get("bot") or {}; proj0 = b.get("p0", proj)
    # over / under at FanDuel's line
    if st.get("lineSrc") == "FanDuel" and st.get("line") is not None and st.get("overPrice") is not None and st.get("underPrice") is not None:
        T = math.floor(float(st["line"])) + 1; po, pu = _imp(st["overPrice"]), _imp(st["underPrice"])
        if po and pu:
            for r, price in (("o", st["overPrice"]), ("u", st["underPrice"])):
                if r == "u" and allow is not None: continue
                pf = (po if r == "o" else pu) / (po + pu)
                def pm_at(mu):
                    x = _pm_ou(st, T, mu)
                    return None if x is None else (x if r == "o" else 1 - x)
                out.append(dict(r=r, T=T, price=price, pf=pf, pm=pm_at(proj), pm_nc=pm_at(proj0), pm_up=pm_at(proj * 1.05 if proj else None), ou=1))
    # FanDuel's X+ rungs (alternate lines, "1+" markets)
    rungs = [m for m in st.get("miles") or [] if m.get("fd") and m.get("price") is not None and m.get("t") is not None]
    if rungs:
        pf_nc = FD._model_pf(dict(st, proj=proj0)) if proj0 is not None else None
        pf_up = FD._model_pf(dict(st, proj=proj * 1.05)) if proj is not None else None
        for m in rungs:
            T = float(m["t"]); T = int(T) if T == int(T) else T
            if any(x["r"] == "o" and x["T"] == T for x in out): continue
            out.append(dict(r="o", T=T, price=m["price"], pf=_clamp(_imp(m["price"]) * 0.96, 0.02, 0.97), pm=m.get("p"),
                            pm_nc=(pf_nc(T) if pf_nc else m.get("p")), pm_up=(pf_up(T) if pf_up else None)))
    return out

# ------------------------------------------------------------------------------------------------ game logs
def _rest_group(lg, d):
    if d is None or d < 0: return None
    if lg in ("nfl", "cfb"):
        return "short" if d <= 4 else "normal" if d <= 7 else "long" if d <= 15 else None
    return "b2b" if d == 0 else "1" if d == 1 else "2+" if d <= 6 else None
REST_TXT = {"b2b": "the second night of a back-to-back", "1": "one day of rest", "2+": "two or more days of rest", "short": "a short week", "normal": "a normal week", "long": "extra rest (bye)"}
DOW = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

def _with_rest(games):
    prev = None
    for g in games:
        try: d = (_etd(g["date"]) - _etd(prev["date"])).days - 1 if prev else None
        except Exception: d = None
        g["_rest"] = d; prev = g
    return games

def logs_for(lg, pid):
    """this season's regular-season games (no preseason, no playoffs), oldest first, each with its rest before it. When the season is still short,
    gamelog_multi also brings last season in: those games are returned too (their season label tells them apart)."""
    r = espn.gamelog_multi(lg, pid)
    if not r: return []
    return _with_rest(sorted([g for g in r[1] if not g.get("pre") and not g.get("post") and g.get("date")], key=lambda g: g["date"]))

def day_agg(lg, games, role):
    """playing-time sums by the kind of day, for one season: {all:[n,sum], rest:{grp:[n,sum]}, home:{"1"|"0":[n,sum]}, dow:{"0".."6":[n,sum]}}
    (full games only: a game he left early says nothing about how a coach uses him on that kind of day)"""
    full, part = espn.full_games(lg, games, role) if games else ([], [])
    gs = full if (full and part) else games
    A = {"all": [0, 0.0], "rest": {}, "home": {}, "dow": {}}
    for x in gs:
        u = espn.usage(lg, x, role)
        if not u or u <= 0: continue
        A["all"][0] += 1; A["all"][1] += u
        for key, v in (("rest", _rest_group(lg, x.get("_rest"))), ("home", "1" if x.get("home") else "0"), ("dow", str(_etd(x["date"]).weekday()))):
            if v is None: continue
            c = A[key].setdefault(v, [0, 0.0]); c[0] += 1; c[1] += u
    A["all"][1] = round(A["all"][1], 1)
    for key in ("rest", "home", "dow"):
        for v in A[key].values(): v[1] = round(v[1], 1)
    return A

def day_ratio(aggs, key, v, k):
    """combined ratio over seasons (each season's group mean / that season's mean, so a bigger role this year does not look like a day effect),
    shrunk n/(n+k): (factor, n games in the group, raw ratio)"""
    num = n = 0.0
    for A in aggs:
        c = (A.get(key) or {}).get(v); a = A.get("all") or [0, 0]
        if not c or c[0] < 1 or a[0] < 6 or a[1] <= 0: continue
        r = (c[1] / c[0]) / (a[1] / a[0]); num += c[0] * r; n += c[0]
    if n < 2: return 1.0, int(n), None
    raw = num / n
    return 1 + (raw - 1) * n / (n + k), int(n), raw

def _boosts(pl):
    """build.py's flat 'teammate out' bump per teammate name, from its notes ("Jonathan Isaac out: +2%")"""
    out = {}
    for s in pl.get("boostNotes") or []:
        m = re.match(r"(.+) out: \+(\d+)%", s)
        if m: out[FE._n(m.group(1))] = int(m.group(2)) / 100
    return out

def _fmt(x): return ("%.1f" % x).rstrip("0").rstrip(".") if x is not None else "?"

# ------------------------------------------------------------------------------------------------ the bot
class PropBot:
    def __init__(self, root=None, log=print):
        self.log = log
        self.dir = os.path.join(root, "store", "propbot") if root else DIR
        os.makedirs(self.dir, exist_ok=True)
        self.state_f = os.path.join(self.dir, "state.json")
        st = {}
        if os.path.exists(self.state_f):
            try: st = json.load(open(self.state_f))
            except Exception: st = {}
        self.open = st.get("open") or {}
        self.L = st.get("learned") or {}
        self.meta = st.get("meta") or {}
        self.rows = []
        for f in sorted(os.listdir(self.dir)):
            if not re.fullmatch(r"graded-\d{4}-\d{2}-\d{2}\.jsonl", f): continue
            for line in open(os.path.join(self.dir, f)):
                line = line.strip()
                if line:
                    try: self.rows.append(json.loads(line))
                    except Exception: pass
        self.dirty = set()             # game days whose graded file changed
        self.prior_f = os.path.join(self.dir, "prior.json")
        try: self.prior = json.load(open(self.prior_f)) if os.path.exists(self.prior_f) else {}
        except Exception: self.prior = {}
        self.prior_dirty = False
        self.today_notes = []          # research findings of this run (for the page)
        self.info = {}

    # ============================================================ calibration (learned) applied to one leg
    def cal_of(self, lg, stat, r, pid, fv):
        """(slope, shift) for a leg, or None when the league's calibration is not active yet"""
        c = (self.L.get("cal") or {}).get(lg)
        if not c or not c.get("on"): return None
        sh = c.get("c", 0.0) + (c.get("stat") or {}).get(stat + "|" + r, 0.0)
        if fv: sh += (c.get("big") or {}).get(("f" if fv > 0 else "d") + "|" + r, 0.0)
        sh += ((self.L.get("players") or {}).get(lg + "|" + str(pid)) or 0.0)
        return c.get("s", 1.0), sh

    def weights(self):
        w = dict(PRIOR_W); w.update((self.L.get("w") or {}))
        return w

    # ============================================================ grade finished games
    def grade(self, store, now, log=None, limit=60):
        log = log or self.log
        import social
        today = now.astimezone(ET).date()
        by = collections.defaultdict(list)
        for k, r in list(self.open.items()):
            try:
                if (today - datetime.date.fromisoformat(r["d"])).days > (KEEP_DAYS if r.get("bf") else OPEN_MAX_DAYS):     # legs rebuilt from old slates wait longer
                    del self.open[k]; continue
            except Exception:
                del self.open[k]; continue
            by[(r["lg"], r["g"])].append(k)
        need = []
        for (lg, gid), ks in by.items():
            row = (store.games.get(lg) or {}).get(str(gid)) if store else None
            if row and row.get("hs") is not None: need.append((lg, gid, row))
        need.sort(key=lambda x: x[2].get("date") or "")
        def one(item):
            lg, gid, row = item
            if lg not in SP: return None
            sport, l = SP[lg]
            s = curl(f"{SB}{sport}/{l}/summary?event={gid}", tries=2, timeout=8)
            if not s or not s.get("header"): return None
            stt = ((s["header"]["competitions"][0].get("status") or {}).get("type") or {})
            if stt.get("state") != "post" and not stt.get("completed"): return None
            h, a, box, dnp = social.box_of(lg, s)
            doc = social.final_doc(gid, h, a, box, dnp)
            return lg, gid, row, doc, _usage_of(s)
        got = [x for x in pmap(one, need[:limit], 8) if x]
        n_ok = n_void = 0; tnow = now.strftime("%Y-%m-%dT%H:%MZ")
        for lg, gid, row, doc, use in got:
            hs, as_ = row["hs"], row.get("as_", row.get("as"))
            for k in by[(lg, gid)]:
                r = self.open.pop(k, None)
                if r is None: continue
                pid = str(r["i"]); stat = doc["stat"].get(pid); played = doc["played"].get(pid)
                r["gt"] = tnow
                if stat is None or played is False or stat.get(r["s"]) is None:
                    r["y"] = None; n_void += 1                        # did not play / not in the box score: FanDuel voids it too
                else:
                    v = float(stat[r["s"]]); r["v"] = v
                    hit = v >= r["t"] if r["r"] == "o" else v < r["t"]
                    r["y"] = 1 if hit else 0; n_ok += 1
                    u = use.get(pid)                                  # minutes / ice time (football has no playing-time number in the box score)
                    if u is not None: r["u"] = round(u, 1)
                    mg = (hs - as_) * (1 if r.get("h") else -1); r["mg"] = mg
                    if not hit: r["why"] = self._why(lg, r, v, u, mg)
                self.rows.append(r); self.dirty.add(r["d"])
        self.info.update(graded=n_ok, voided=n_void, games=len(got), waiting=max(0, len(need) - len(got)))
        if need or got: log(f"  prop bot: {len(need)} finished games with open legs, {len(got)} box scores read, {n_ok} legs graded, {n_void} void")
        return n_ok

    @staticmethod
    def _why(lg, r, v, u, mg):
        if r["r"] == "u": return "over"
        u0 = r.get("u0")
        if u0 and u is not None and u < 0.75 * u0:
            big = {"nba": 18, "wnba": 18, "nhl": 4, "nfl": 21, "cfb": 24}.get(lg, 99)
            return "blowout" if abs(mg) >= big else "minutes"
        return "short" if v >= 0.8 * float(r["t"]) else "off"

    # ============================================================ learn from graded legs
    def learn(self, now, log=None):
        log = log or self.log
        today = now.astimezone(ET).date(); cut = (today - datetime.timedelta(days=KEEP_DAYS)).isoformat()
        self.rows = [r for r in self.rows if (r.get("d") or "") >= cut]
        R = [r for r in self.rows if r.get("y") in (0, 1) and r.get("pn") is not None]
        L, rep = fit(R, today)
        L["at"] = now.strftime("%Y-%m-%dT%H:%MZ")
        # honest check: learn on everything but the last 3 days, then score the last 3 days with and without what it learned
        old = [r for r in R if r["d"] < (today - datetime.timedelta(days=3)).isoformat()]
        new = [r for r in R if r["d"] >= (today - datetime.timedelta(days=3)).isoformat()]
        if len(old) >= 200 and len(new) >= 50:
            L0, _ = fit(old, today)
            b_raw = _brier(new, None); b_fit = _brier(new, L0)
            L["check"] = dict(n=len(new), raw=round(b_raw, 4), bot=round(b_fit, 4), better=b_fit < b_raw)
        self.L = L; self.report = rep
        on = [lg for lg, c in (L.get("cal") or {}).items() if c.get("on")]
        log(f"  prop bot learning: {len(R)} graded legs in {KEEP_DAYS} days; calibration on for {on or 'no league yet'}; weights {L.get('w')}")
        return L

    # ============================================================ research before FanDuel's prices go on
    def research(self, games, now, cx_fetch=None, log=None, store=None):
        log = log or self.log
        self.store = store
        W = self.weights(); n_pl = n_adj = n_avoid = n_under = 0; targets = []
        for g in games:
            lg = g.get("key") or g.get("lg")
            if lg not in RESEARCH or not g.get("players"): continue
            try: t0 = parse_iso(g["iso"])
            except Exception: continue
            if t0 <= now or (t0 - now).total_seconds() > HORIZON_H * 3600: continue
            for pl in g["players"]:
                for st in pl.get("stats") or []:          # a card carried from an earlier run: start again from the projection before the bot
                    b = st.get("bot")
                    if b and b.get("p0") is not None: st["proj"] = b["p0"]
                    st.pop("bot", None)
                pl.pop("bot", None)
                if pl.get("feed") or not re.fullmatch(r"\d+", str(pl.get("id") or "")): continue
                targets.append((g, lg, pl))
        # every game log in one parallel pass (the builders fetched them already this run: cached on disk)
        logs = {}
        def fetch(x):
            g, lg, pl = x
            try: return (lg, str(pl["id"])), logs_for(lg, str(pl["id"]))
            except Exception: return (lg, str(pl["id"])), []
        for kv in pmap(fetch, targets, 12):
            if kv: logs[kv[0]] = kv[1]
        # last season's day patterns: read once per player and kept (store/propbot/prior.json), a bounded number of new players per run
        todo = []
        for g, lg, pl in targets:
            gl = logs.get((lg, str(pl["id"]))) or []
            labels = sorted({x.get("season") for x in gl if x.get("season")})
            if not labels: continue
            pk = lg + "|" + str(pl["id"]); want = espn.prior_season_param(labels[-1])
            if len(labels) >= 2 or not want: continue                 # last season is in the log already
            if (self.prior.get(pk) or {}).get("ps") == want: continue
            todo.append((lg, str(pl["id"]), (pl.get("pos") or "").upper(), want))
        def fetch_prior(x):
            lg, pid, role, want = x
            d2 = espn._gl_raw(lg, pid, want)
            if not d2: return None
            _, g2 = espn._parse_gl(d2)
            gs = _with_rest(sorted([g for g in g2.values() if not g.get("pre") and not g.get("post") and g.get("date")], key=lambda g: g["date"]))
            return lg + "|" + pid, dict(ps=want, a=day_agg(lg, gs, role))
        for kv in pmap(fetch_prior, todo[:PRIOR_PER_RUN], 12):
            if kv: self.prior[kv[0]] = kv[1]; self.prior_dirty = True
        self.info["priorFetched"] = min(len(todo), PRIOR_PER_RUN); self.info["priorWaiting"] = max(0, len(todo) - PRIOR_PER_RUN)
        mates = {}
        need_m = set()
        for g, lg, pl in targets:
            for i in (g["teams"][pl["side"]].get("injuries") or []):
                if i.get("kind") in ("out", "doubtful") and (i.get("weight") or 0) >= 0.5 and i.get("id") and str(i["id"]) != str(pl["id"]):
                    need_m.add((lg, str(i["id"])))
        def fetch_m(x):
            lg, mid = x
            r = espn.gamelog(lg, mid)
            return x, (r[1] if r else [])
        for kv in pmap(fetch_m, sorted(need_m), 12):
            if kv: mates[kv[0]] = kv[1]
        CX = {}
        for g, lg, pl in targets:
            try:
                if lg not in CX:
                    try: CX[lg] = cx_fetch(lg) if cx_fetch else None
                    except Exception: CX[lg] = None
                ok = self._research_player(g, lg, pl, logs.get((lg, str(pl["id"]))) or [], mates, CX.get(lg), W, now)
                n_pl += 1; n_adj += ok[0]; n_avoid += ok[1]; n_under += ok[2]
            except Exception as ex:
                log(f"  prop bot: research failed for {pl.get('name')}: {type(ex).__name__}: {ex}"[:200])
        self.info.update(researched=n_pl, adjusted=n_adj, avoid=n_avoid, under=n_under)
        log(f"  prop bot research: {n_pl} players, {n_adj} projections moved, {n_avoid} kept out of the picks, {n_under} new to their team (unders only)")
        return n_pl

    def _research_player(self, g, lg, pl, reg, mates, C, W, now):
        side = pl["side"]; role = (pl.get("pos") or "").upper()
        notes = []; avoid = None; vol = 0.0
        # ---------- injury report and news
        st_ = pl.get("status") or {}
        if st_.get("kind") in ("questionable", "dtd", "doubtful") and "expected to play" not in (st_.get("note") or "").lower():
            avoid = f"{st_.get('label') or 'Questionable'} on the injury report"
        # ---------- new team: games for the team he is with now (from the store: which side of each game in his log he was on), then trades in the news
        under = None
        nt = new_team(lg, pl, g, reg, getattr(self, "store", None))
        if nt:
            under = (f"New team: {nt['n']} game{'s' if nt['n'] != 1 else ''} with {nt['team']}" + (f" (was {nt['prev']} until {nt['since']:%b} {nt['since'].day})" if nt.get("prev") else "") +
                     f"; overs need {NEW_TEAM_GAMES} games with his new team, unders only until then")
        if C:
            nm = FE._n(pl["name"]); last = pl["name"].split()[-1].lower()
            for a in C.get("news") or []:
                try: age = (now.date() - datetime.date.fromisoformat(a["t"])).days
                except Exception: continue
                tagged = any(str(x.get("id")) == str(pl["id"]) for x in a.get("ath") or []) or nm in FE._n(a.get("h") or "")
                if not tagged or len(a.get("ath") or []) > 3: continue          # a round-up of many players says little about this one
                h_ = a.get("h") or ""; txt = h_ + " " + (a.get("d") or "")
                if age <= 1 and NEWS_AVOID.search(txt) and not avoid and not re.search(r"\b(cleared|will play|expected to play|available)\b", txt, re.I):
                    avoid = "ESPN news: " + h_[:90]
                elif age <= 14 and TRADE_DONE.search(h_) and not TRADE_TALK.search(h_):
                    try: since = datetime.date.fromisoformat(a["t"])
                    except Exception: continue
                    n_new = sum(1 for x in reg if _etd(x["date"]) >= since)
                    if n_new < NEW_TEAM_GAMES and not under:
                        under = f"Traded (ESPN news {since:%b} {since.day}: {h_[:80]}): {n_new} game{'s' if n_new != 1 else ''} since; unders only until {NEW_TEAM_GAMES}"
                elif age <= 10 and NEWS_TRADE.search(h_):
                    vol = max(vol, 0.1); notes.append("Trade talk in ESPN news: " + h_[:90])
            for t in C.get("trans") or []:
                d = t.get("desc") or ""
                if last in d.lower() and nm in FE._n(d) and re.search(r"acquired|traded|signed|claimed", d, re.I):
                    try: since = datetime.date.fromisoformat(t["date"])
                    except Exception: continue
                    if (now.date() - since).days > 60: continue
                    n_new = sum(1 for x in reg if _etd(x["date"]) >= since)
                    if n_new < NEW_TEAM_GAMES and not under:
                        under = f"Joined on {since:%b} {since.day} ({t.get('ab') or 'new team'}): {n_new} game{'s' if n_new != 1 else ''} since; unders only until {NEW_TEAM_GAMES}"
        # ---------- playing-time patterns by the kind of day (this season and last season, full games only)
        full, part = espn.full_games(lg, reg, role) if reg else ([], [])
        reg_f = full if (full and part) else reg
        U = [u for u in (espn.usage(lg, x, role) for x in reg_f) if u is not None and u > 0]
        u0 = _mean(U[-10:]) if U else None
        seasons = sorted({x.get("season") for x in reg if x.get("season")})
        aggs = [day_agg(lg, [x for x in reg if x.get("season") == sn], role) for sn in seasons]
        pr = (self.prior.get(lg + "|" + str(pl["id"])) or {}).get("a")
        if pr and len(seasons) < 2: aggs.append(pr)
        ctx = ((g.get("crossroads") or {}).get("ctx") or {}).get(side) or {}
        rest_d = (ctx.get("rest") or {}).get("days")
        if rest_d is None and reg:
            try: rest_d = (_etd(g["iso"]) - _etd(reg[-1]["date"])).days - 1
            except Exception: rest_d = None
        rg = _rest_group(lg, rest_d)
        home = side == "home"; dow = _etd(g["iso"]).weekday()
        f_rest = f_home = f_dow = 1.0
        if rg:
            f_rest, n, raw = day_ratio(aggs, "rest", rg, K["rest"]); f_rest = _clamp(f_rest, 0.85, 1.1)
            if abs(f_rest - 1) >= 0.03 and raw is not None:
                notes.append(f"Tonight is {REST_TXT[rg]}: on those days he plays {abs(raw - 1) * 100:.0f}% {'less' if raw < 1 else 'more'} ({n} games, {_unit(lg)}), so {(f_rest - 1) * 100:+.0f}%")
        f_home, n, raw = day_ratio(aggs, "home", "1" if home else "0", K["home"]); f_home = _clamp(f_home, 0.94, 1.06)
        if abs(f_home - 1) >= 0.03 and raw is not None: notes.append(f"{'At home' if home else 'On the road'} he plays {abs(raw - 1) * 100:.0f}% {'less' if raw < 1 else 'more'} ({n} games)")
        if lg not in ("nfl", "cfb"):          # football's day of the week is its rest (Thursday = short week), already counted
            f_dow, n, raw = day_ratio(aggs, "dow", str(dow), K["dow"]); f_dow = _clamp(f_dow, 0.95, 1.05)
            if abs(f_dow - 1) >= 0.03 and raw is not None: notes.append(f"On {DOW[dow]}s he plays {abs(raw - 1) * 100:.0f}% {'less' if raw < 1 else 'more'} ({n} games)")
        # ---------- teammates out tonight: what he did this season in the games they missed (the ball goes to the players left).
        # Several teammates out at once are one split (games with any of them missing vs games with all of them playing): splitting them one by one
        # would count the same games again for each.
        tonight = _etd(g["iso"]); last_d = _etd(reg[-1]["date"]) if reg else None
        recent_team = [x for x in pl.get("slots") or [] if x.get("date") and 0 <= (tonight - datetime.date.fromisoformat(x["date"][:10])).days <= 21]
        if last_d and (tonight - last_d).days > 21 and len(recent_team) >= 3 and not avoid:
            avoid = f"Has not played since {last_d:%b} {last_d.day}: the first games back are often on a minutes limit"
        # this season's games with his team (a player who has not played this season has no "with / without" record here)
        cur = seasons[-1] if (seasons and last_d and (tonight - last_d).days <= 30) else None
        mine = [x for x in reg_f if x.get("season") == cur] if cur else []
        last10, last5, last45 = reg_f[-10:], reg_f[-5:], reg_f[-45:]
        outs = [i for i in (g["teams"][side].get("injuries") or []) if i.get("kind") in ("out", "doubtful") and (i.get("weight") or 0) >= 0.5 and i.get("id") and str(i["id"]) != str(pl["id"])]
        bmap = _boosts(pl); mate_f = {}; mate_note = {}
        miss_dates = []; names = []; b_old = 0.0
        for i in outs[:6]:
            ml = mates.get((lg, str(i["id"]))) or []
            mreg = [x for x in ml if not x.get("pre") and not x.get("post") and x.get("season") == cur and (tonight - _etd(x["date"])).days <= 150]
            mu = [espn.usage(lg, x, i.get("pos") or "") for x in mreg]; mu = [u for u in mu if u]
            if len(mreg) < 3 or (_mean(mu) or 0) < MATE_MIN.get(lg, 99): continue          # a regular this season, not a player who has been out all year
            first = min(_etd(x["date"]) for x in mreg)
            miss_dates.append(({_etd(x["date"]) for x in mreg}, first, _mean(mu))); names.append(i.get("name")); b_old += bmap.get(FE._n(i.get("name")), 0.0)
        if miss_dates and mine:
            tot = sum(u for _, _, u in miss_dates)
            def gone(x):
                """share of tonight's missing playing time that was also missing in game x (he missed it after joining the team)"""
                d0 = _etd(x["date"])
                return sum(u for played, first, u in miss_dates if d0 not in played and d0 >= first) / tot
            wo = [x for x in mine if gone(x) >= 0.5]; w_ = [x for x in mine if gone(x) == 0]   # games like tonight vs games with all of them playing
            who = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
            if len(w_) >= 4 and len(wo) >= 3:                                                   # two games without them is a coincidence, not a pattern
                wo_set = {x["eventId"] for x in wo}
                q = 0.25 * _frac(last5, wo_set) + 0.25 * _frac(last10, wo_set) + 0.5 * _frac(last45, wo_set)   # how much of the projection already has them out
                for st in pl.get("stats") or []:
                    fn = FE.FNS.get(lg, {}).get(st.get("key"))
                    if not fn: continue
                    mw = _mean([fn(x) for x in w_]); mwo = _mean([fn(x) for x in wo])
                    if mw is None or mwo is None or mw < 1.0: continue                          # a stat he barely records: the ratio is noise
                    k_eff = K["mates"] * (1 + 1 / mw)                                            # small counts swing a lot from game to game: they need more games
                    mwo_s = mw + (mwo - mw) * len(wo) / (len(wo) + k_eff)
                    base = q * mwo_s + (1 - q) * mw
                    f = _clamp((mwo_s / base if base > 0 else 1.0) / (1 + min(b_old, 0.12)), 0.88, 1.15)
                    mate_f[st["key"]] = f
                    if abs(f - 1) >= 0.04:
                        why_ = f"Without {who}: {_fmt(mwo)} {st.get('label', st['key']).lower()} in {len(wo)} games vs {_fmt(mw)} with"
                        if b_old >= 0.01 and f < 1.0 and mwo_s <= mw * 1.03: why_ += f", so the usual +{min(b_old, 0.12) * 100:.0f}% teammate-out bump is taken back"
                        mate_note[st["key"]] = (f, why_ + f": {(f - 1) * 100:+.0f}%")
                uw = _mean([espn.usage(lg, x, role) or 0 for x in w_]); uwo = _mean([espn.usage(lg, x, role) or 0 for x in wo])
                if uw and uwo and abs(uwo / uw - 1) >= 0.08:
                    notes.append(f"Without {who} he has played {_fmt(uwo)} {_unit(lg)} ({len(wo)} games) vs {_fmt(uw)} with")
        best = sorted(mate_note.values(), key=lambda x: -abs(x[0] - 1))[:2]
        notes += [x[1] for x in best]
        # ---------- scale each stat's projection
        moved = 0
        for st in pl.get("stats") or []:
            if st.get("proj") is None or st.get("feed"): continue
            key = st.get("key")
            l = {"rest": math.log(f_rest) if key != "saves" else 0.0, "home": math.log(f_home), "dow": math.log(f_dow), "mates": math.log(mate_f.get(key, 1.0))}
            F = _clamp(math.exp(sum(W[k] * v for k, v in l.items())), F_LO, F_HI)
            p0 = st["proj"]
            st["bot"] = dict(p0=p0, f=round(F, 3), l={k: round(v, 4) for k, v in l.items() if abs(v) >= 0.0005})
            if abs(F - 1) >= 0.005:
                st["proj"] = round(p0 * F, 2); moved = 1
        pl["bot"] = dict(notes=notes[:6], avoid=avoid, under=under, vol=vol or None, u0=_r3(u0), rest=rg)
        if moved or avoid or under or notes:
            self.today_notes.append(dict(g=g["id"], lg=lg, n=pl["name"], tm=pl.get("abbr"), avoid=avoid, under=under, notes=notes[:4],
                                         f={st["key"]: st["bot"]["f"] for st in pl.get("stats") or [] if st.get("bot") and abs(st["bot"]["f"] - 1) >= 0.02}))
        return moved, 1 if avoid else 0, 1 if (under and not avoid) else 0

    # ============================================================ after FanDuel's prices: put the calibration on the cards, write down the legs
    def snapshot(self, games, now, log=None):
        log = log or self.log
        n_new = n_upd = n_cal = 0; tnow = now.strftime("%Y-%m-%dT%H:%MZ")
        for g in games:
            lg = g.get("key") or g.get("lg")
            if lg not in SNAP or not g.get("players"): continue
            try: t0 = parse_iso(g["iso"])
            except Exception: continue
            if t0 <= now or (t0 - now).total_seconds() > HORIZON_H * 3600: continue
            spr = (g.get("lines") or {}).get("sprHome")
            d = str(_etd(g["iso"]))
            for pl in g["players"]:
                if (pl.get("status") or {}).get("kind") == "out": continue
                side = pl.get("side"); av = pl.get("avail") if pl.get("avail") is not None else 1.0
                fv = 0
                if spr is not None and lg in BIG and abs(spr) >= BIG[lg]:
                    fav = "home" if spr < 0 else "away"; fv = 1 if side == fav else -1
                pb = pl.get("bot") or {}
                for st in pl.get("stats") or []:
                    b = st.setdefault("bot", {})
                    cal = {r: self.cal_of(lg, st.get("key"), r, pl["id"], fv) for r in ("o", "u")}
                    if cal["o"] is not None:
                        b["s"] = round(cal["o"][0], 3); b["c"] = {r: round(cal[r][1], 3) for r in cal}; n_cal += 1
                    for leg in leg_list(lg, pl, st):
                        p = _blend(leg["pf"], leg["pm"], av)
                        if not (P_LO <= p <= P_HI): continue
                        pn = _blend(leg["pf"], leg["pm_nc"], av)
                        pu = _blend(leg["pf"], leg["pm_up"], av) if leg.get("pm_up") is not None else None
                        sens = (_logit(pu) - _logit(p)) / math.log(1.05) if pu is not None else 0.0
                        c = cal[leg["r"]]
                        ps = _sig(c[0] * _logit(p) + c[1]) if c else p
                        if pb.get("vol"): ps = 0.5 + (ps - 0.5) * (1 - pb["vol"])
                        k = f"{g['id']}|{pl['id']}|{st['key']}|{leg['r']}|{leg['T']}"
                        row = dict(d=d, lg=lg, g=str(g["id"]), i=str(pl["id"]), n=pl.get("name"), h=1 if side == "home" else 0, s=st["key"], r=leg["r"], t=leg["T"], pr=leg["price"],
                                   pf=_r3(leg["pf"]), pn=_r3(pn), pc=_r3(p), ps=_r3(ps), sv=round(sens, 2))
                        if fv: row["fv"] = fv
                        if b.get("l"): row["l"] = b["l"]
                        if pb.get("u0"): row["u0"] = pb["u0"]
                        if pb.get("avoid"): row["av"] = 1
                        if pb.get("under"): row["nt"] = 1
                        if leg.get("ou"): row["ou"] = 1
                        o = self.open.get(k)
                        if o is not None:          # the latest pregame numbers count, but tiny moves are not worth a rewrite
                            if abs((o.get("ps") or 0) - row["ps"]) < 0.01 and o.get("pr") == row["pr"] and o.get("av") == row.get("av") and o.get("nt") == row.get("nt") and o.get("l") == row.get("l"): continue
                            n_upd += 1
                        else: n_new += 1
                        self.open[k] = row
        self.info.update(open=len(self.open), snapNew=n_new, calCards=n_cal)
        log(f"  prop bot snapshot: {n_new} new legs, {n_upd} updated, {len(self.open)} waiting for a final")
        return n_new

    # ============================================================ page summary + save
    def page(self, now):
        today = now.astimezone(ET).date()
        R = [r for r in self.rows if r.get("y") in (0, 1)]
        out = dict(at=now.strftime("%Y-%m-%dT%H:%MZ"), keepDays=KEEP_DAYS, open=len(self.open), info=self.info)
        groups = {(r["g"], r["i"], r["s"]) for r in R}
        out["graded"] = dict(n=len(R), groups=len(groups), void=sum(1 for r in self.rows if r.get("y") is None), since=min((r["d"] for r in R), default=None),
                             last=max((r.get("gt") or "" for r in R), default=None), days=len({r["d"] for r in R}), backfill=sum(1 for r in R if r.get("bf")))
        # the record of the chance the app SHOWED (before the bot's learning was on, that is the plain chance)
        def bucket(rs):
            bs = []
            for lo, hi in ((0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 0.98)):
                xs = [r for r in rs if lo <= (r.get("ps") or 0) < hi]
                if xs: bs.append(dict(lo=lo, hi=hi, n=len(xs), said=round(_mean([r["ps"] for r in xs]), 3), got=round(_mean([r["y"] for r in xs]), 3)))
            return bs
        out["record"] = bucket(R)
        out["byLeague"] = {}
        for lg in sorted({r["lg"] for r in R}):
            xs = [r for r in R if r["lg"] == lg]; c = (self.L.get("cal") or {}).get(lg) or {}
            out["byLeague"][lg] = dict(n=len(xs), said=round(_mean([r["ps"] for r in xs]), 3), got=round(_mean([r["y"] for r in xs]), 3), on=bool(c.get("on")),
                                       s=c.get("s"), c=c.get("c"), neff=c.get("n"), buckets=bucket(xs))
        out["learned"] = dict(w=self.L.get("w"), wn=self.L.get("wn"), check=self.L.get("check"), at=self.L.get("at"))
        rep = getattr(self, "report", {}) or {}
        out["stats"] = rep.get("stats", [])[:12]; out["players"] = rep.get("players", [])[:10]; out["big"] = rep.get("big", [])
        out["lessons"] = rep.get("lessons", [])
        recent = [r for r in R if r["d"] >= (today - datetime.timedelta(days=2)).isoformat() and r["y"] == 0 and (r.get("ps") or 0) >= 0.75]
        recent.sort(key=lambda r: (-r["ps"]))
        out["misses"] = [dict(d=r["d"], lg=r["lg"], n=r["n"], s=r["s"], r=r["r"], t=r["t"], v=r.get("v"), ps=r["ps"], why=MISS_TXT.get(r.get("why"), r.get("why")), u=r.get("u"), u0=r.get("u0"))
                         for r in recent[:15]]
        wk = [r for r in R if r["d"] >= (today - datetime.timedelta(days=7)).isoformat() and r["y"] == 0 and (r.get("ps") or 0) >= 0.6 and r.get("why")]
        out["missWhy"] = dict(collections.Counter(MISS_TXT.get(r["why"], r["why"]) for r in wk).most_common())
        nt = [r for r in R if r.get("nt")]
        out["newTeam"] = dict(games=NEW_TEAM_GAMES, overs=dict(n=sum(1 for r in nt if r["r"] == "o"), got=_r3(_mean([r["y"] for r in nt if r["r"] == "o"])), said=_r3(_mean([r["ps"] for r in nt if r["r"] == "o"]))),
                              unders=dict(n=sum(1 for r in nt if r["r"] == "u"), got=_r3(_mean([r["y"] for r in nt if r["r"] == "u"])), said=_r3(_mean([r["ps"] for r in nt if r["r"] == "u"]))))
        self.today_notes.sort(key=lambda x: (x["avoid"] is None, not x.get("under"), -max([abs(v - 1) for v in x["f"].values()] or [0])))
        out["today"] = self.today_notes[:60]
        return out

    def save(self, now):
        today = now.astimezone(ET).date(); cut = (today - datetime.timedelta(days=KEEP_DAYS)).isoformat()
        self.rows = [r for r in self.rows if (r.get("d") or "") >= cut]
        for f in os.listdir(self.dir):          # days past the window
            m = re.fullmatch(r"graded-(\d{4}-\d{2}-\d{2})\.jsonl", f)
            if m and m.group(1) < cut: os.remove(os.path.join(self.dir, f))
        for d in sorted(self.dirty):
            if d < cut: continue
            rs = sorted([r for r in self.rows if r.get("d") == d], key=lambda r: (r.get("g") or "", r.get("i") or "", r.get("s") or "", r.get("r") or "", float(r.get("t") or 0)))
            fn = os.path.join(self.dir, f"graded-{d}.jsonl"); tmp = fn + ".tmp"
            with open(tmp, "w") as f:
                for r in rs: f.write(json.dumps(r, separators=(",", ":")) + "\n")
            os.replace(tmp, fn)
        self.dirty = set()
        if self.prior_dirty:
            with open(self.prior_f + ".tmp", "w") as f: json.dump(dict(sorted(self.prior.items())), f, separators=(",", ":"))
            os.replace(self.prior_f + ".tmp", self.prior_f); self.prior_dirty = False
        st = dict(v=1, at=now.strftime("%Y-%m-%dT%H:%MZ"), learned=self.L, open=dict(sorted(self.open.items())), meta=self.meta)
        tmp = self.state_f + ".tmp"
        with open(tmp, "w") as f: json.dump(st, f, separators=(",", ":"))
        os.replace(tmp, self.state_f)

def new_team(lg, pl, g, reg, store):
    """the new-team rule. reg = his regular-season games (this season, plus last season while this one is short). The store knows both teams of
    each game, his log says home or away and who the opponent was, so each game gets the team he played for. Returns None when he has
    NEW_TEAM_GAMES+ games for the team on tonight's card since he last played for anyone else (or nothing to go on), else
    dict(n=games with this team, team, prev=the team before, since=his last game for it)."""
    team = ((g.get("teams") or {}).get(pl.get("side")) or {}).get("abbr") or pl.get("abbr")
    games = ((store.games.get(lg) or {}) if store is not None else {})
    if not team or not games or not reg: return None
    hist = []
    for x in reg:
        row = games.get(str(x.get("eventId")))
        if not row: continue
        both = (row.get("home"), row.get("away"))
        if team in both and x.get("opp") != team: mine = team                       # he cannot play against his own team
        else: mine = row["home"] if x.get("home") else row["away"]
        hist.append((_etd(x["date"]), mine))
    if not hist: return None
    others = [(d, t) for d, t in hist if t != team]
    if not others: return None
    since, prev = max(others)
    n = sum(1 for d, t in hist if t == team and d > since)
    if n >= NEW_TEAM_GAMES: return None
    return dict(n=n, team=team, prev=prev, since=since)

def _unit(lg): return {"nba": "min", "wnba": "min", "nhl": "min of ice time", "nfl": "touches/targets", "cfb": "touches/targets"}.get(lg, "")
def _frac(xs, wo_set): return (sum(1 for x in xs if x["eventId"] in wo_set) / len(xs)) if xs else 0.0

def _usage_of(s):
    """ESPN summary -> {athlete id: minutes (basketball) or ice time (hockey)}"""
    out = {}
    for t in (s.get("boxscore") or {}).get("players") or []:
        for grp in t.get("statistics") or []:
            keys = grp.get("keys") or []
            for a in grp.get("athletes") or []:
                v = dict(zip(keys, a.get("stats") or []))
                m = v.get("minutes") if v.get("minutes") not in (None, "", "--") else v.get("timeOnIce")
                if m in (None, "", "--"): continue
                try: out[str(a["athlete"]["id"])] = float(m)                 # basketball: "34"
                except (TypeError, ValueError):
                    try: out[str(a["athlete"]["id"])] = espn._mins(m)           # hockey: "18:32"
                    except Exception: pass
    return out

# ------------------------------------------------------------------------------------------------ fitting
def _z(r, L):
    """the leg's chance (logit) under learned parameters L (None = the chance as recorded without the research)"""
    z = _logit(r["pn"])
    if L is None: return z
    w = L.get("w") or PRIOR_W; l = r.get("l") or {}
    z += (r.get("sv") or 0.0) * sum(w.get(k, 0.0) * v for k, v in l.items())
    c = (L.get("cal") or {}).get(r["lg"])
    if c and c.get("on"):
        z = c.get("s", 1.0) * z + c.get("c", 0.0) + (c.get("stat") or {}).get(r["s"] + "|" + r["r"], 0.0)
        if r.get("fv"): z += (c.get("big") or {}).get(("f" if r["fv"] > 0 else "d") + "|" + r["r"], 0.0)
        z += (L.get("players") or {}).get(r["lg"] + "|" + str(r["i"]), 0.0)
    return z

def _brier(rs, L):
    return _mean([(_sig(_z(r, L)) - r["y"]) ** 2 for r in rs]) if rs else None

def _wts(rs):
    """one vote per player, stat and game: the rungs of one stat land or miss together"""
    c = collections.Counter((r["g"], r["i"], r["s"]) for r in rs)
    return [1.0 / c[(r["g"], r["i"], r["s"])] for r in rs]

def _ll(zs, ys, ws):
    s = 0.0
    for z, y, w in zip(zs, ys, ws):
        p = _clamp(_sig(z), 1e-4, 1 - 1e-4); s -= w * (y * math.log(p) + (1 - y) * math.log(1 - p))
    return s

def _shift(zs, ys, ws, lam, iters=8):
    """intercept that best fits outcomes on top of zs (weighted Newton), with a ridge penalty lam that keeps it near 0 on thin evidence
    (lam is worth about lam / 0.2 votes that agree with the current chance)"""
    c = 0.0
    for _ in range(iters):
        g = lam * c; h = lam
        for z, y, w in zip(zs, ys, ws):
            p = _sig(z + c); g += w * (p - y); h += w * p * (1 - p)
        c -= g / h
        c = _clamp(c, -3, 3)
    return c

def _slope_shift(zs, ys, ws, iters=12):
    s, c = 1.0, 0.0
    for _ in range(iters):
        gs = gc = hss = hsc = hcc = 0.0
        for z, y, w in zip(zs, ys, ws):
            p = _sig(s * z + c); e = w * (p - y); q = w * p * (1 - p)
            gs += e * z; gc += e; hss += q * z * z; hsc += q * z; hcc += q
        det = hss * hcc - hsc * hsc
        if abs(det) < 1e-9: break
        ds = (hcc * gs - hsc * gc) / det; dc = (hss * gc - hsc * gs) / det
        s = _clamp(s - ds, 0.3, 2.0); c = _clamp(c - dc, -3, 3)
    return s, c

def fit(R, today):
    """learned parameters from graded legs R, plus a report of what changed (for the page)"""
    L = dict(w=dict(PRIOR_W), wn={}, cal={}, players={}); rep = dict(stats=[], players=[], big=[], lessons=[])
    if not R: return L, rep
    ys = [r["y"] for r in R]; ws = _wts(R)
    # 1. how much each research pattern should count (rows the research moved; old rows without it have l = {})
    idx = [j for j, r in enumerate(R) if r.get("l") and r.get("sv")]
    if idx:
        z0 = [_logit(R[j]["pn"]) for j in idx]; sv = [R[j]["sv"] for j in idx]; ll_ = [R[j]["l"] for j in idx]
        yy = [ys[j] for j in idx]; ww = [ws[j] for j in idx]
        w = dict(PRIOR_W)
        def loss(wt): return _ll([z + s * sum(wt.get(k, 0) * v for k, v in l.items()) for z, s, l in zip(z0, sv, ll_)], yy, ww)
        for _ in range(2):
            for k in PRIOR_W:
                best = None
                for x in W_GRID:
                    t = dict(w); t[k] = x; v = loss(t)
                    if best is None or v < best[0]: best = (v, x)
                w[k] = best[1]
        for k in PRIOR_W:
            n = sum(ww[j] for j in range(len(idx)) if abs(ll_[j].get(k, 0)) >= 0.01)
            L["wn"][k] = round(n, 1)
            L["w"][k] = round(PRIOR_W[k] + (w[k] - PRIOR_W[k]) * n / (n + 300), 3)
            if n >= 60 and abs(L["w"][k] - PRIOR_W[k]) >= 0.1:
                rep["lessons"].append(f"The {k} pattern {'helped' if L['w'][k] > PRIOR_W[k] else 'helped less than expected'}: its weight is now {L['w'][k]:.2f} (started at {PRIOR_W[k]:.2f}, {n:.0f} graded legs)")
    zr = [_z(r, dict(w=L["w"])) for r in R]
    # 2. per league: slope and shift on the chance (how often 80% legs really landed)
    by = collections.defaultdict(list)
    for j, r in enumerate(R): by[r["lg"]].append(j)
    for lg, js in by.items():
        neff = sum(ws[j] for j in js)
        c = dict(n=round(neff, 1), on=neff >= MIN_CAL, s=1.0, c=0.0, stat={}, big={})
        if c["on"]:
            s, sh = _slope_shift([zr[j] for j in js], [ys[j] for j in js], [ws[j] for j in js])
            k = neff / (neff + 300)
            c["s"] = round(_clamp(1 + (s - 1) * k, 0.7, 1.2), 3); c["c"] = round(_clamp(sh * k, -0.5, 0.5), 3)
            z1 = {j: c["s"] * zr[j] + c["c"] for j in js}
            # 3. per stat and side
            sg = collections.defaultdict(list)
            for j in js: sg[R[j]["s"] + "|" + R[j]["r"]].append(j)
            for key, jj in sg.items():
                n = sum(ws[j] for j in jj)
                if n < 30: continue
                sh = round(_clamp(_shift([z1[j] for j in jj], [ys[j] for j in jj], [ws[j] for j in jj], 30.0), -0.4, 0.4), 3)
                if abs(sh) >= 0.02:
                    c["stat"][key] = sh
                    said = _mean([_sig(z1[j]) for j in jj]); got = _mean([ys[j] for j in jj])
                    rep["stats"].append(dict(lg=lg, s=key.split("|")[0], r=key.split("|")[1], n=len(jj), neff=round(n), said=round(said, 3), got=round(got, 3), shift=sh))
                for j in jj: z1[j] += c["stat"].get(key, 0.0)
            # 4. big favourites / big underdogs (blowouts)
            bg = collections.defaultdict(list)
            for j in js:
                if R[j].get("fv"): bg[("f" if R[j]["fv"] > 0 else "d") + "|" + R[j]["r"]].append(j)
            for key, jj in bg.items():
                n = sum(ws[j] for j in jj)
                if n < 30: continue
                sh = round(_clamp(_shift([z1[j] for j in jj], [ys[j] for j in jj], [ws[j] for j in jj], 30.0), -0.4, 0.4), 3)
                if abs(sh) >= 0.02:
                    c["big"][key] = sh
                    rep["big"].append(dict(lg=lg, side=("big favourite" if key[0] == "f" else "big underdog"), r=key[2], n=len(jj), said=round(_mean([_sig(z1[j]) for j in jj]), 3), got=round(_mean([ys[j] for j in jj]), 3), shift=sh))
                for j in jj: z1[j] += c["big"].get(key, 0.0)
            # 5. per player: one vote per game (his stats in one game land or miss together), so a player needs several games before he gets his own correction
            gc = collections.Counter((R[j]["g"], R[j]["i"]) for j in js)
            pg = collections.defaultdict(list)
            for j in js: pg[R[j]["i"]].append(j)
            for pid, jj in pg.items():
                ng = len({R[j]["g"] for j in jj})
                if ng < 5: continue
                wg = [1.0 / gc[(R[j]["g"], R[j]["i"])] for j in jj]
                sh = round(_clamp(_shift([z1[j] for j in jj], [ys[j] for j in jj], wg, 20.0), -0.35, 0.35), 3)
                if abs(sh) >= 0.08:
                    L["players"][lg + "|" + pid] = sh
                    rep["players"].append(dict(lg=lg, n=R[jj[0]]["n"], legs=len(jj), games=len({R[j]["g"] for j in jj}), said=round(_mean([_sig(z1[j]) for j in jj]), 3), got=round(_mean([ys[j] for j in jj]), 3), shift=sh))
            said = _mean([_sig(zr[j]) for j in js]); got = _mean([ys[j] for j in js])
            hi = [j for j in js if _sig(zr[j]) >= 0.8]
            if len(hi) >= 30:
                s_hi = _mean([_sig(zr[j]) for j in hi]); g_hi = _mean([ys[j] for j in hi])
                if abs(s_hi - g_hi) >= 0.03:
                    rep["lessons"].append(f"{lg.upper()}: legs the app called {s_hi * 100:.0f}% landed {g_hi * 100:.0f}% ({len(hi)} legs): new chances are {'pulled down' if g_hi < s_hi else 'raised'} to match")
        L["cal"][lg] = c
    rep["stats"].sort(key=lambda x: -abs(x["shift"]) * math.sqrt(x["neff"]))
    rep["players"].sort(key=lambda x: -abs(x["shift"]))
    for x in [x for x in rep["stats"] if abs(x["said"] - x["got"]) >= 0.03][:3]:
        rep["lessons"].append(f"{x['lg'].upper()} {FD.LABEL.get(x['s'], x['s']).lower()} {'overs' if x['r'] == 'o' else 'unders'}: called {x['said'] * 100:.0f}%, landed {x['got'] * 100:.0f}% ({x['n']} legs)")
    return L, rep
