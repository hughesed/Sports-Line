"""Past-day player recaps (box-score lines for finished NFL / WNBA / MLB games in the learning window). Finished games never change, so they are cached in store/pastp.json."""
import json, os, re
from espn import SP, SB, curl, pmap, ROOT

def toi(x):
    try: return int(float(str(x).replace('+', '')))
    except Exception: return 0
def first(s):
    m = re.match(r'\s*(-?\d+)', str(s)); return int(m.group(1)) if m else 0

def recap_rows(lg, s):
    out = []
    for t in s.get('boxscore', {}).get('players', []):
        tm = t['team']['abbreviation']
        for grp in t.get('statistics', []):
            keys = grp.get('keys') or []
            for at in grp.get('athletes', []):
                v = dict(zip(keys, at.get('stats', []))); d = {}
                if lg == 'nfl':
                    n = grp['name']
                    if n == 'passing': d = dict(py=toi(v.get('passingYards')), ptd=toi(v.get('passingTouchdowns')), pc=first(v.get('completions/passingAttempts')))
                    elif n == 'rushing': d = dict(ry=toi(v.get('rushingYards')), rc=toi(v.get('rushingAttempts')), rtd=toi(v.get('rushingTouchdowns')))
                    elif n == 'receiving': d = dict(rec=toi(v.get('receptions')), ly=toi(v.get('receivingYards')), ltd=toi(v.get('receivingTouchdowns')))
                elif lg == 'wnba':
                    if at.get('didNotPlay'): continue
                    d = dict(pts=toi(v.get('points')), reb=toi(v.get('rebounds')), ast=toi(v.get('assists')), fg3=first(v.get('threePointFieldGoalsMade-threePointFieldGoalsAttempted')))
                elif lg == 'mlb':
                    if grp.get('type') == 'batting': d = dict(h=toi(v.get('hits')), r=toi(v.get('runs')), rbi=toi(v.get('RBIs')), hr=toi(v.get('homeRuns')))
                    elif grp.get('type') == 'pitching':
                        ip = str(v.get('fullInnings.partInnings', '0.0')).split('.'); d = dict(k=toi(v.get('strikeouts')), outs=toi(ip[0]) * 3 + (toi(ip[1]) if len(ip) > 1 else 0))
                if d: out.append(dict(i=at['athlete']['id'], n=at['athlete'].get('shortName') or at['athlete'].get('displayName'), t=tm, **d))
    m = {}
    for r in out:
        m.setdefault(r['i'], dict(i=r['i'], n=r['n'], t=r['t'])).update({a: b for a, b in r.items() if a not in ('i', 'n', 't')})
    return list(m.values())

def build_pastp(window, root=None, log=print):
    """window: learn.json 'window' (day -> games). returns (pastp dict for those games, number of new fetches, failures)"""
    path = os.path.join(root or ROOT, "store", "pastp.json")
    cache = json.load(open(path)) if os.path.exists(path) else {}
    games = [(g["id"], g["lg"]) for d in window.values() for g in d if g["lg"] in ("nfl", "wnba", "mlb")]
    need = [(gid, lg) for gid, lg in games if gid not in cache]
    def one(a):
        gid, lg = a
        sport, l = SP[lg]
        s = curl(f"{SB}{sport}/{l}/summary?event={gid}")
        if not s: return None
        return recap_rows(lg, s)
    res = pmap(one, need, 8)
    fails = 0
    for (gid, lg), r in zip(need, res):
        if r is None: fails += 1; continue
        cache[gid] = r
    out = {gid: cache[gid] for gid, lg in games if gid in cache}
    tmp = path + ".tmp"; json.dump(out, open(tmp, "w"), separators=(",", ":")); os.replace(tmp, path)
    log(f"  pastp: {len(out)} games ({len(need)} fetched, {fails} failed)")
    return out, len(need), fails
