"""One-time conversion of the old raw ESPN dumps (data/season, data/hist) into the compact store/.
Usage: python tools/seed_legacy.py /path/to/old/data      (already done for you; only needed to rebuild the seed)"""
import glob, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "engine"))
from store import Store, score_of, LEAGUES

old = sys.argv[1]
st = Store()
def add(lg, e, post, season):
    c = e["competitions"][0]
    if not c["status"]["type"]["completed"]: return
    h = [x for x in c["competitors"] if x["homeAway"] == "home"][0]; a = [x for x in c["competitors"] if x["homeAway"] == "away"][0]
    hs, as_ = score_of(h), score_of(a)
    if hs is None or as_ is None: return
    ha, aa = h["team"]["abbreviation"], a["team"]["abbreviation"]
    if "TBD" in (ha, aa): return
    st.upsert(lg, dict(id=str(e["id"]), date=e["date"], home=ha, away=aa, hs=hs, as_=as_, neutral=bool(c.get("neutralSite")), post=post, season=season))
for lg in ("nfl", "wnba", "mlb", "nba"):
    for f in glob.glob(f"{old}/season/sch_{lg}_*.json"):
        for e in json.load(open(f)).get("events", []):
            add(lg, e, (e.get("seasonType") or {}).get("type") == 3, (e.get("season") or {}).get("year"))
for lg in ("cfb", "cbb"):
    for f in sorted(glob.glob(f"{old}/hist/sb_{lg}_*.json")):
        try: j = json.load(open(f))
        except Exception: continue
        for e in j.get("events", []):
            add(lg, e, (e.get("season") or {}).get("type") == 3, (e.get("season") or {}).get("year"))
for k, v in json.load(open(f"{old}/season/odds.json")).items():
    st.odds[k] = None if v is None else dict(sprH=v.get("sprH"), total=v.get("total"), mlH=v.get("mlH"), mlA=v.get("mlA"))
for lg in LEAGUES: st.dirty.add(lg)
st.save()
print({lg: len(st.games[lg]) for lg in LEAGUES}, "odds", len(st.odds))
# the learning log and recap cache come along too
hist = json.load(open(f"{old}/learn_history.json"))
json.dump(hist[-1:], open(os.path.join(os.path.dirname(st.dir), "store", "learn_history.json"), "w"), separators=(",", ":"))
pp = json.load(open(f"{old}/pastp.json"))
json.dump(pp, open(os.path.join(st.dir, "pastp.json"), "w"), separators=(",", ":"))
