"""One-off probe (run by .github/workflows/probe.yml): ESPN NHL / college football roster and game-log shapes. Writes data/probe.json."""
import json, gzip, urllib.request, time
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip"}), timeout=15) as r:
            raw = r.read(); raw = gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw; return json.loads(raw)
    except Exception as ex: return {"_err": str(ex)[:120]}
OUT = {}
for lg, sp, tid in (("nhl", "hockey/nhl", "25"), ("cfb", "football/college-football", "2393")):
    ro = get(f"https://site.api.espn.com/apis/site/v2/sports/{sp}/teams/{tid}/roster")
    grp = []; ids = []
    for g in ro.get("athletes", []):
        items = g.get("items") if "items" in g else [g]
        grp.append((g.get("position"), len(items)))
        for a in items[:40]:
            ids.append((a.get("id"), a.get("displayName"), (a.get("position") or {}).get("abbreviation")))
    OUT[lg] = {"groups": grp, "sample": ids[:50], "err": ro.get("_err")}
    picks = [x for x in ids if x[2] in ("C", "LW", "RW", "D", "G", "QB", "WR", "RB")][:6]
    if lg == "nhl": picks = [x for x in ids if x[2] == "C"][:2] + [x for x in ids if x[2] == "G"][:1]
    for aid, nm, pos in picks:
        for q in ("", "?season=2026"):
            d = get(f"https://site.web.api.espn.com/apis/common/v3/sports/{sp}/athletes/{aid}/gamelog{q}")
            st = [(s.get("displayName"), [len(c.get("events", [])) for c in s.get("categories", [])]) for s in d.get("seasonTypes", [])]
            ev1 = None
            for s in d.get("seasonTypes", []):
                for c in s.get("categories", []):
                    if c.get("events"): ev1 = c["events"][0]; break
                if ev1: break
            OUT[lg][f"{nm} {pos}{q}"] = {"names": d.get("names"), "seasonTypes": st, "ev1": ev1, "err": d.get("_err")}
        time.sleep(0.3)
json.dump(OUT, open("data/probe.json", "w"), indent=1)
