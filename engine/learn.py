"""Self-learning team model. Walk-forward: every game is predicted using only earlier games, then the ratings learn from the result.
Tuned each run on past results (grid search on out-of-sample error), blended with the closing book line using weights fitted on past games."""
import json, math, os, sys, itertools, datetime, statistics, collections
sys.path.insert(0, os.path.dirname(__file__))
from games_all import load
from timeutil import et_date_of

TODAY = None                      # set by refresh.py (today in Eastern Time)
def set_today(d):
    global TODAY; TODAY = d
def et_date(iso):
    return et_date_of(iso)
def phi(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
def logit(p): p = min(max(p, 1e-4), 1 - 1e-4); return math.log(p / (1 - p))
def sig(z): return 1 / (1 + math.exp(-z))
def ml_prob(a):
    if a is None: return None
    return (-a) / (-a + 100) if a < 0 else 100 / (a + 100)

ODDS = {}                         # closing lines by game id, filled from store/odds.json
def set_odds(o):
    global ODDS; ODDS = o
def book(lg, g):
    o = ODDS.get(g["id"])
    if not o: return None
    spr = o.get("sprH") if lg != "mlb" else None
    pml = None
    if o.get("mlH") is not None and o.get("mlA") is not None:
        h, a = ml_prob(o["mlH"]), ml_prob(o["mlA"]); pml = h / (h + a)
    if spr is None and pml is None and not o.get("total"): return None
    return dict(spr=spr, total=o.get("total"), pml=pml, mlH=o.get("mlH"), mlA=o.get("mlA"))

GRID = {
    "nfl":  dict(k=[0.06, 0.10, 0.15, 0.22], hfa=[1.5, 2.5], boost=[0, 3], reg=[0.5, 0.75]),
    "wnba": dict(k=[0.04, 0.07, 0.11, 0.16], hfa=[1.5, 3.0, 4.5], boost=[0, 3], reg=[1.0]),
    "mlb":  dict(k=[0.008, 0.015, 0.025, 0.04], hfa=[0.1, 0.3], boost=[0, 3], reg=[1.0]),
    "nba":  dict(k=[0.03, 0.05, 0.08, 0.12], hfa=[2.0, 3.0], boost=[0, 3], reg=[0.5, 0.7]),
    "cfb":  dict(k=[0.05, 0.08, 0.12, 0.18], hfa=[2.0, 3.0, 4.0], boost=[0, 3], reg=[0.5, 0.7]),
    "cbb":  dict(k=[0.04, 0.06, 0.09, 0.13], hfa=[3.0, 4.5], boost=[0, 3], reg=[1.0]),
}

class Model:
    def __init__(self, p):
        self.p = p; self.o = collections.defaultdict(float); self.d = collections.defaultdict(float)
        self.gp = collections.defaultdict(int); self.L = None; self.n = 0; self.sum = 0.0; self.season = None
        self.h2h = collections.defaultdict(float)
    def predict(self, h, a):
        L = self.L if self.L is not None else 0
        ph = L + self.p["hfa"] / 2 + self.o[h] + self.d[a]
        pa = L - self.p["hfa"] / 2 + self.o[a] + self.d[h]
        return ph, pa
    def new_season(self):
        r = self.p["reg"]
        for t in list(self.o): self.o[t] *= r; self.d[t] *= r; self.gp[t] = 0
    def learn(self, g):
        h, a = g["home"], g["away"]
        ph, pa = self.predict(h, a)
        eh, ea = g["hs"] - ph, g["as_"] - pa
        for t, e_off, opp in ((h, eh, a), (a, ea, h)):
            gp = min(self.gp[t], self.gp[opp])
            k = self.p["k"] * (1 + self.p["boost"] / (1 + gp))
            self.o[t] += 0.5 * k * e_off; self.d[opp] += 0.5 * k * e_off
        self.gp[h] += 1; self.gp[a] += 1
        self.n += 2; self.sum += g["hs"] + g["as_"]; self.L = self.sum / self.n

MINN = {"cfb": 6, "cbb": 20, "nba": 20}
def big_set(lg, games):
    if lg not in MINN: return None
    cnt = collections.Counter()
    for g in games: cnt[g["home"]] += 1; cnt[g["away"]] += 1
    return {t for t, c in cnt.items() if c >= MINN[lg]}

def walk(lg, games, p, collect=False):
    m = Model(p); recs = []; cur_season = None; m.big = big_set(lg, games)
    by_day = collections.defaultdict(list)
    for g in games: by_day[et_date(g["date"])].append(g)
    for day in sorted(by_day):
        # season boundary (ratings regress toward the mean when a new season starts)
        if lg in ("nfl", "nba", "cfb"):
            sd_ = by_day[day][0].get("season")
            if cur_season is None: cur_season = sd_
            elif sd_ != cur_season: m.new_season(); cur_season = sd_
        for g in by_day[day]:
            ph, pa = m.predict(g["home"], g["away"])
            recs.append(dict(g=g, day=day, ph=ph, pa=pa, warm=m.n))
        for g in by_day[day]: m.learn(g)
    return (m, recs) if collect else m

def score_recs(recs, skip):
    use = [r for r in recs[skip:]]
    if not use: return 1e9
    mse_m = sum(((r["g"]["hs"] - r["g"]["as_"]) - (r["ph"] - r["pa"])) ** 2 for r in use) / len(use)
    mse_t = sum(((r["g"]["hs"] + r["g"]["as_"]) - (r["ph"] + r["pa"])) ** 2 for r in use) / len(use)
    return mse_m + mse_t

def tune(lg, games):
    g = GRID[lg]; best = None; trials = []
    skip = int(len(games) * 0.3)
    for k, hfa, boost, reg in itertools.product(g["k"], g["hfa"], g["boost"], g["reg"]):
        p = dict(k=k, hfa=hfa, boost=boost, reg=reg)
        _, recs = walk(lg, games, p, True)
        s = score_recs(recs, skip); trials.append((s, p))
        if best is None or s < best[0]: best = (s, p)
    trials.sort(key=lambda x: x[0])
    return best[1], best[0], trials

def fit_blend(rows, kind):
    """rows: (model_value, book_value, actual). returns best weight on model in [0,1] by squared error (or log loss for probs)."""
    best = (1e18, 0.0)
    for w in [i / 20 for i in range(21)]:
        s = 0
        for mv, bv, y in rows:
            if kind == "p":
                z = w * logit(mv) + (1 - w) * logit(bv); p = min(max(sig(z), 1e-4), 1 - 1e-4)
                s += -(y * math.log(p) + (1 - y) * math.log(1 - p))
            else:
                s += (w * mv + (1 - w) * bv - y) ** 2
        if s < best[0]: best = (s, w)
    return best[1]

def evaluate(lg, games, p, sd, blend, recs, from_day):
    """Per-game as-of predictions for days >= from_day, plus aggregate metrics over all out-of-sample games with odds."""
    out = []
    for r in recs:
        g = r["g"]; b = book(lg, g)
        mm = r["ph"] - r["pa"]; mt = r["ph"] + r["pa"]
        pH = phi(mm / sd["m"])
        row = dict(id=g["id"], lg=lg, day=str(r["day"]), home=g["home"], away=g["away"], hs=g["hs"], as_=g["as_"], mm=mm, mt=mt, pH=pH, b=b)
        if b:
            fm = mm; ft = mt; fp = pH
            if b.get("spr") is not None and blend.get("m") is not None: fm = blend["m"] * mm + (1 - blend["m"]) * (-b["spr"])
            if b.get("total") and blend.get("t") is not None: ft = blend["t"] * mt + (1 - blend["t"]) * b["total"]
            if b.get("pml") is not None and blend.get("p") is not None: fp = sig(blend["p"] * logit(pH) + (1 - blend["p"]) * logit(b["pml"]))
            elif b.get("spr") is not None: fp = phi(fm / sd["m"])
            row.update(fm=fm, ft=ft, fp=fp)
        else: row.update(fm=mm, ft=mt, fp=pH)
        out.append(row)
    return out

def team_ratings(m, teams):
    return {t: dict(o=round(m.o[t], 3), d=round(m.d[t], 3), gp=m.gp[t]) for t in teams}

_RUNS = {}
def run_league(lg):
    """memoised: the store does not change during a run"""
    if lg not in _RUNS: _RUNS[lg] = _run_league(lg)
    return _RUNS[lg]

def _run_league(lg):
    games = load(lg)
    if lg == "mlb": pass
    p, s, trials = tune(lg, games)
    m, recs = walk(lg, games, p, True)
    skip = int(len(recs) * 0.3)
    use = recs[skip:]
    resid_m = [(r["g"]["hs"] - r["g"]["as_"]) - (r["ph"] - r["pa"]) for r in use]
    resid_t = [(r["g"]["hs"] + r["g"]["as_"]) - (r["ph"] + r["pa"]) for r in use]
    sd = dict(m=statistics.pstdev(resid_m), t=statistics.pstdev(resid_t))
    # fit blend weights on the first 70% of out-of-sample games with odds, test on the last 30%
    rowsM, rowsT, rowsP = [], [], []
    for r in use:
        g = r["g"]; b = book(lg, g)
        if not b: continue
        mm = r["ph"] - r["pa"]; mt = r["ph"] + r["pa"]
        actual_m = g["hs"] - g["as_"]
        if b.get("spr") is not None: rowsM.append((r["day"], mm, -b["spr"], actual_m))
        if b.get("total"): rowsT.append((r["day"], mt, b["total"], g["hs"] + g["as_"]))
        if b.get("pml") is not None: rowsP.append((r["day"], phi(mm / sd["m"]), b["pml"], 1 if actual_m > 0 else 0))
    def split(rows): n = int(len(rows) * 0.7); return rows[:n], rows[n:]
    blend = {}; test = {}
    for key, rows, kind in (("m", rowsM, "m"), ("t", rowsT, "m"), ("p", rowsP, "p")):
        if len(rows) < 25: blend[key] = None; continue
        tr, te = split(rows)
        w = fit_blend([(a, b, c) for _, a, b, c in tr], kind)
        wall = fit_blend([(a, b, c) for _, a, b, c in rows], kind)
        # out-of-sample comparison on the held-out part
        def err(wt):
            if kind == "p":
                s = 0
                for _, mv, bv, y in te:
                    pp = min(max(sig(wt * logit(mv) + (1 - wt) * logit(bv)), 1e-4), 1 - 1e-4); s += -(y * math.log(pp) + (1 - y) * math.log(1 - pp))
                return s / len(te)
            return (sum((wt * mv + (1 - wt) * bv - y) ** 2 for _, mv, bv, y in te) / len(te)) ** 0.5
        test[key] = dict(n=len(te), model=round(err(1.0), 3), book=round(err(0.0), 3), blend=round(err(w), 3), w_train=w)
        blend[key] = wall
    allrows = evaluate(lg, games, p, sd, blend, recs, None)
    return dict(lg=lg, params=p, tune_score=s, trials=[(round(a, 2), b) for a, b in trials[:3]], sd=sd, blend=blend, test=test,
                n_games=len(games), model=m, rows=allrows, games=games)

def summarize(rows, lg):
    """win-pick accuracy etc. over rows with scores"""
    n = len(rows)
    if not n: return {}
    acc_model = sum(1 for r in rows if (r["mm"] > 0) == (r["hs"] > r["as_"])) / n
    acc_final = sum(1 for r in rows if (r["fm"] > 0) == (r["hs"] > r["as_"])) / n
    out = dict(n=n, accModel=acc_model, accFinal=acc_final, maeM=sum(abs((r["hs"] - r["as_"]) - r["mm"]) for r in rows) / n, maeFinalM=sum(abs((r["hs"] - r["as_"]) - r["fm"]) for r in rows) / n,
               maeT=sum(abs((r["hs"] + r["as_"]) - r["mt"]) for r in rows) / n, maeFinalT=sum(abs((r["hs"] + r["as_"]) - r["ft"]) for r in rows) / n)
    bk = [r for r in rows if r["b"]]
    if bk:
        out["nBook"] = len(bk)
        out["accBook"] = sum(1 for r in bk if r["b"].get("pml") is not None and (r["b"]["pml"] > 0.5) == (r["hs"] > r["as_"])) / max(1, sum(1 for r in bk if r["b"].get("pml") is not None))
        bm = [r for r in bk if r["b"].get("spr") is not None]
        if bm: out["maeBookM"] = sum(abs((r["hs"] - r["as_"]) + r["b"]["spr"]) for r in bm) / len(bm)
        bt = [r for r in bk if r["b"].get("total")]
        if bt: out["maeBookT"] = sum(abs((r["hs"] + r["as_"]) - r["b"]["total"]) for r in bt) / len(bt)
    return out
