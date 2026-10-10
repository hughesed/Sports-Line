"""Per-event ESPN feeds (rosters, props, summaries, core odds) and automatic player selection for the player-level cards."""
import re, collections, threading
from espn import curl, SP, SB, CORE, pmap

_roster = {}; _rlock = threading.Lock()
def roster_players(lg, tid):
    """flat list of dict(id,name,pos,jersey,inj,grp) for a team"""
    key = (lg, str(tid))
    with _rlock:
        if key in _roster: return _roster[key]
    sport, l = SP[lg]
    d = curl(f"{SB}{sport}/{l}/teams/{tid}/roster")
    if d is None: return None
    out = []
    for g in d.get("athletes", []):
        items = g["items"] if "items" in g else [g]
        for a in items:
            if "id" not in a: continue
            out.append({"id": a["id"], "name": a.get("displayName") or a.get("fullName"), "pos": (a.get("position") or {}).get("abbreviation"), "jersey": a.get("jersey"),
                        "inj": [(i.get("status")) for i in a.get("injuries", [])], "grp": g.get("position"), "ht": a.get("height") if isinstance(a.get("height"), (int, float)) else None})
    with _rlock: _roster[key] = out
    return out

def fetch_props(lg, eid):
    """all DraftKings prop items for the event (paged). [] when the feed has none"""
    sport, l = SP[lg]
    base = CORE.format(s=sport, l=l, e=eid) + "/100/propBets?limit=400"
    d = curl(base)
    if not d: return []
    items = list(d.get("items", []))
    for p in range(2, int(d.get("pageCount") or 1) + 1):
        dd = curl(base + f"&page={p}")
        if dd: items += dd.get("items", [])
    return items

def props_index(items):
    idx = collections.defaultdict(lambda: collections.defaultdict(list))
    for i in items:
        if "athlete" not in i: continue
        m = re.search(r"athletes/(\d+)", i["athlete"]["$ref"])
        if not m: continue
        idx[m.group(1)][i["type"]["name"]].append(i)
    return idx

def fetch_core_odds(lg, eid):
    sport, l = SP[lg]
    d = curl(CORE.format(s=sport, l=l, e=eid))
    if d and d.get("items"): return d["items"][0]
    return None

def fetch_summary(lg, eid):
    sport, l = SP[lg]
    return curl(f"{SB}{sport}/{l}/summary?event={eid}") or {}

MAIN = ("Total Passing Yards", "Total Rushing Yards", "Total Receiving Yards", "Total Receptions", "Total Points", "Total Rebounds", "Total Assists", "Total Hits", "Total Bases", "Total Strikeouts",
        "Total Points, Rebounds, and Assists", "Total Runs Scored", "Total RBIs", "Total Outs Recorded", "Total 3-Point Field Goals", "Total Carries", "Total Pass Completions")
def _score(types):
    """how much of the book's attention a player gets: distinct main prop markets first, then alt lines"""
    names = {k.replace(" (incl. overtime)", "") for k in types}
    main = sum(1 for n in names if n in MAIN)
    return main * 100 + sum(len(v) for v in types.values())

BAD_STATUS = ("out", "injured reserve", "suspension", "60-day-il", "15-day-il", "10-day-il", "7-day-il")
def select_players(lg, team_roster, pidx):
    """auto-pick the players to build cards for, from those the book has props on: NFL QB/2 RB/3 WR/TE, WNBA top 5, MLB SP + 6 hitters (SP first)."""
    cand = []
    for p in team_roster:
        ent = pidx.get(str(p["id"]))
        if not ent: continue
        if any((s or "").lower() in BAD_STATUS for s in p["inj"]): continue
        sc = _score(ent)
        if sc < 100: continue                       # no main market
        cand.append((sc, p))
    cand.sort(key=lambda x: -x[0])
    pick = []
    if lg == "nfl":
        cand = [(s, p) for s, p in cand if p["pos"] in ("QB", "RB", "FB", "WR", "TE")]
        def take(poss, n):
            k = [p for s, p in cand if p["pos"] in poss][:n]
            return k
        pick = take(("QB",), 1) + take(("RB", "FB"), 2) + take(("WR",), 3) + take(("TE",), 1)
    elif lg == "wnba":
        pick = [p for s, p in cand][:5]
    elif lg == "mlb":
        pit = [p for s, p in cand if p["pos"] in ("SP", "RP", "P")]
        hit = [p for s, p in cand if p["pos"] not in ("SP", "RP", "P")]
        pick = pit[:1] + hit[:6]
    return pick
