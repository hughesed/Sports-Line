"""Server-side self-improvement: log the model's pre-game numbers, grade them when finals arrive, turn the track record into bounded adjustments.
store/predictions.jsonl keeps ONE line per game: the FIRST snapshot taken before the game started. Later runs never replace it (idempotent, no look-ahead, no duplicates)."""
import json, os, math, datetime, collections
from espn import ROOT
from timeutil import parse_iso

KEEP_DAYS = 150
MIN_FOR_SLOPE = 40            # graded games in a league before the win-chance slope moves at all
SLOPE_BOUNDS = (0.85, 1.15)   # never trust live results further than this
SLOPE_PRIOR_N = 100           # shrinkage: slope = 1 + (fitted-1) * n/(n+100)

def logit(p): p = min(max(p, 1e-4), 1 - 1e-4); return math.log(p / (1 - p))
def sig(z): return 1 / (1 + math.exp(-z))

class PredLog:
    def __init__(self, root=None):
        self.path = os.path.join(root or ROOT, "store", "predictions.jsonl")
        self.recs = {}
        if os.path.exists(self.path):
            for line in open(self.path):
                line = line.strip()
                if line:
                    try: r = json.loads(line); self.recs[r["id"]] = r
                    except Exception: pass

    # ---- logging
    def log_games(self, games, now, slopes):
        """games: slate game dicts. Only games that have not started are snapshotted."""
        n = 0
        for g in games:
            try:
                if parse_iso(g["iso"]) <= now: continue
                if g["id"] in self.recs: continue            # first pre-kickoff snapshot wins
                cr = g["crossroads"]; lr = cr.get("learn") or {}; L = g["lines"]
                home, away = g["teams"]["home"]["abbr"], g["teams"]["away"]["abbr"]
                ls = lt = lm = None
                for l in cr.get("leans", []):
                    if l["kind"] == "spread": ls = "h" if (" " + home + " ") in (l["text"] + " ") else "a"
                    elif l["kind"] == "total": lt = "o" if "Over" in l["text"] else "u"
                    elif l["kind"] == "ml": lm = "h" if (" " + home + " ") in (l["text"] + " ") else "a"
                key = g.get("key") or g["lg"]
                self.recs[g["id"]] = dict(id=g["id"], lg=key, iso=g["iso"], h=home, a=away, ts=now.strftime("%Y-%m-%dT%H:%MZ"),
                                          rm=lr.get("rawMargin"), rt=lr.get("rawTotal"), fm=cr.get("projMargin"), ft=cr.get("projTotal"), pH=cr.get("pHome"), s=round(slopes.get(key, 1.0), 4),
                                          bH=cr.get("bookHome"), sp=L.get("sprHome"), tot=L.get("total"), ls=ls, lt=lt, lm=lm)
                n += 1
            except Exception:
                continue
        return n

    # ---- grading
    def grade(self, store):
        """attach results to logged predictions once the game is final in the store. returns number newly graded"""
        n = 0
        for r in self.recs.values():
            if r.get("g"): continue
            g = store.games.get(r["lg"], {}).get(r["id"])
            if not g: continue
            hs, as_ = g["hs"], g["as_"]; margin = hs - as_; y = 1 if margin > 0 else 0
            if margin == 0: r["g"] = 1; r["hs"] = hs; r["as"] = as_; r["tie"] = 1; n += 1; continue
            r["g"] = 1; r["hs"] = hs; r["as"] = as_
            if r.get("pH") is not None:
                r["ml"] = 1 if ((r["pH"] >= 0.5) == (y == 1)) else 0
                p0 = sig(logit(r["pH"]) / (r.get("s") or 1.0))
                r["br"] = round((p0 - y) ** 2, 4)
            if r.get("bH") is not None:
                r["bml"] = 1 if ((r["bH"] >= 0.5) == (y == 1)) else 0; r["bbr"] = round((r["bH"] - y) ** 2, 4)
            sp = r.get("sp")
            if r.get("ls") and sp is not None:
                cover = margin + sp
                if cover != 0: r["sl"] = 1 if ((cover > 0) == (r["ls"] == "h")) else 0
            tot = r.get("tot"); at = hs + as_
            if r.get("lt") and tot:
                if at != tot: r["tl"] = 1 if ((at > tot) == (r["lt"] == "o")) else 0
            if r.get("lm"): r["ml_l"] = 1 if ((margin > 0) == (r["lm"] == "h")) else 0
            if r.get("fm") is not None: r["em"] = round(abs(margin - r["fm"]), 1)
            if sp is not None: r["ebm"] = round(abs(margin + sp), 1)
            if r.get("ft") is not None: r["et"] = round(abs(at - r["ft"]), 1)
            if tot: r["ebt"] = round(abs(at - tot), 1)
            n += 1
        return n

    # ---- summaries + calibration
    def summary(self):
        by = collections.defaultdict(list)
        for r in self.recs.values():
            if r.get("g") and not r.get("tie") and "ml" in r: by[r["lg"]].append(r)
        out = {}
        def agg(rs):
            n = len(rs)
            def mean(k):
                v = [x[k] for x in rs if k in x]; return round(sum(v) / len(v), 3) if v else None
            d = dict(n=n, accML=mean("ml"), accBook=mean("bml"), brier=mean("br"), brierBook=mean("bbr"), maeM=mean("em"), maeBookM=mean("ebm"), maeT=mean("et"), maeBookT=mean("ebt"))
            lean = {}
            for k, nm in (("sl", "spread"), ("tl", "total"), ("ml_l", "mlLean")):
                v = [x[k] for x in rs if k in x]
                if v: lean[nm] = dict(hit=sum(v), n=len(v))
            d["leans"] = lean
            return d
        allr = []
        for lg, rs in by.items():
            out[lg] = agg(rs); allr += rs
        out["_all"] = agg(allr) if allr else dict(n=0, leans={})
        return out

    def slopes(self):
        """bounded win-chance slope per league fitted on the bot's own graded predictions (logistic recalibration of the model's pre-calibration probability)"""
        by = collections.defaultdict(list)
        for r in self.recs.values():
            if r.get("g") and not r.get("tie") and r.get("pH") is not None:
                y = 1 if r["hs"] > r["as"] else 0
                by[r["lg"]].append((sig(logit(r["pH"]) / (r.get("s") or 1.0)), y))
        res = {}
        for lg, rows in by.items():
            n = len(rows)
            if n < MIN_FOR_SLOPE: continue
            best = None
            for k in range(-24, 25):
                s = 1 + k * 0.0125 * 2
                if s <= 0.1: continue
                ll = 0.0
                for p, y in rows:
                    q = min(max(sig(s * logit(p)), 1e-4), 1 - 1e-4); ll -= y * math.log(q) + (1 - y) * math.log(1 - q)
                if best is None or ll < best[0]: best = (ll, s)
            s = 1 + (best[1] - 1) * n / (n + SLOPE_PRIOR_N)
            res[lg] = round(max(SLOPE_BOUNDS[0], min(SLOPE_BOUNDS[1], s)), 4)
        return res

    # ---- io
    def save(self, today):
        cutoff = (today - datetime.timedelta(days=KEEP_DAYS)).isoformat()
        rows = [r for r in self.recs.values() if r["iso"][:10] >= cutoff]
        rows.sort(key=lambda r: (r["iso"], r["id"]))
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            for r in rows: f.write(json.dumps(r, separators=(",", ":")) + "\n")
        os.replace(tmp, self.path)
        self.recs = {r["id"]: r for r in rows}
