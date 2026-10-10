"""Tennis match cards, built from the sportsbook feed (data/odds.json: ATP + WTA events).
There is no ESPN result history for tennis in this app, so these are book-only cards: the match winner comes from the de-vigged moneyline, the
game total and game handicap are the book's own numbers. No ratings model, no injuries. Never raises: any problem returns an empty list."""
import datetime, math, re, statistics
from timeutil import ET

def _imp(a):
    return (100 / (a + 100)) if a > 0 else (abs(a) / (abs(a) + 100))

def _pick(side):
    """consensus (median) price and line across the live books of one market side -> (odds, line)"""
    bks = (side or {}).get("books") or {}
    odds = [b["odds"] for b in bks.values() if b.get("odds") is not None]
    lines = [b["line"] for b in bks.values() if b.get("line") is not None]
    return (int(statistics.median(odds)) if odds else None), (statistics.median(lines) if lines else None)

def _abbr(name, fallback):
    w = re.sub(r"[^A-Za-z ]", "", name or "").split()
    return (w[-1][:3] if w else (fallback or "PLR")).upper()

def _team(name, short, color, alt):
    nm = name or short or "Player"
    return dict(id=re.sub(r"\W+", "-", nm.lower()), abbr=_abbr(nm, short), name=nm, short=short or nm.split()[-1], color=color, alt=alt, record="", recent=[], pf=0, pa=0,
                offBase=50, defBase=50, offRank=None, defRank=None, gp=0, injuries=[], injImpact=dict(off=0.0, deff=0.0, notes=[]), off=50, **{"def": 50})

def card(ev, now):
    m = ev.get("main") or {}
    mlh, _ = _pick((m.get("ml") or {}).get("home")); mla, _ = _pick((m.get("ml") or {}).get("away"))
    if mlh is None or mla is None: return None
    try: st = datetime.datetime.fromisoformat((ev.get("start") or "").replace("Z", "+00:00"))
    except Exception: return None
    iH, iA = _imp(mlh), _imp(mla); pH = iH / (iH + iA)
    sh, lh = _pick((m.get("spread") or {}).get("home")); sa, la = _pick((m.get("spread") or {}).get("away"))
    to, lo = _pick((m.get("total") or {}).get("over")); tu, lu = _pick((m.get("total") or {}).get("under"))
    total = lo if lo is not None else (lu if lu is not None else 22.5)
    sprH = lh if lh is not None else (-la if la is not None else (-round(math.log(pH / (1 - pH)) * 2.6 * 2) / 2))
    tour = ev.get("league") or "ATP"
    a = _team(ev.get("awayName"), ev.get("away"), "#2d6a4f", "#ffffff"); h = _team(ev.get("homeName"), ev.get("home"), "#1d4e89", "#ffffff")
    margin = -sprH                                  # games the home player is expected to win by
    stt = st.astimezone(ET)
    projH = (total + margin) / 2; projA = (total - margin) / 2
    lines = dict(dk=dict(ml=dict(home=None, away=None), spr=dict(home=None, away=None), tot=dict(over=None, under=None)),
                 mlHome=mlh, mlAway=mla, sprHome=sprH, sprAway=-sprH, prHome=sh or -110, prAway=sa or -110, total=total, over=to or -110, under=tu or -110)
    cr = dict(projHome=round(projH, 1), projAway=round(projA, 1), projHomeNoInj=round(projH, 1), projAwayNoInj=round(projA, 1), projTotal=round(total, 1), projMargin=round(margin, 1),
              pHome=round(pH, 3), bookHome=round(pH, 3), leans=[],
              learn=dict(rawMargin=round(margin, 1), rawTotal=round(total, 1), baseMargin=round(margin, 1), baseTotal=round(total, 1), injMargin=0, injTotal=0, bookMargin=round(margin, 1),
                         w=dict(m=0, t=0, p=0), n=0, sd=dict(m=4.5, t=4.0), leanStats={}, test={}, rk=dict(home=None, away=None), rt=dict(home=dict(o=0, d=0, gp=0), away=dict(o=0, d=0, gp=0))),
              matchups=[], ctx=dict(away=dict(off=0, deff=0, items=[], rest={}, stars=[]), home=dict(off=0, deff=0, items=[], rest={}, stars=[])))
    return dict(id="t" + str(ev.get("id")), lg="tennis", key="tennis", league=f"Tennis ({tour})", title=f"{a['name']} vs {h['name']}", start=stt.strftime("%-I:%M %p ET"), startDate=stt.strftime("%a %b %-d"),
                iso=st.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), day=stt.strftime("%Y-%m-%d"), venue="", tv="", series=None, note="Book lines only (no ratings model for tennis)", n=0,
                teams=dict(away=a, home=h), lines=lines, crossroads=cr, players=[], bookOnly=True, oddsId=ev.get("id"))

def cards(odds, now=None, cap=10):
    try:
        now = now or datetime.datetime.now(datetime.timezone.utc)
        out = []
        for ev in (odds or {}).get("events") or []:
            if ev.get("league") not in ("ATP", "WTA") or ev.get("final"): continue
            try: st = datetime.datetime.fromisoformat((ev.get("start") or "").replace("Z", "+00:00"))
            except Exception: continue
            if not (-6 * 3600 <= (st - now).total_seconds() <= 40 * 3600): continue
            c = card(ev, now)
            if c: out.append(c)
        out.sort(key=lambda c: c["iso"]); out = out[:cap]
        used = set()            # every player needs his own short code (it is the key of the battle teams table)
        for c in out:
            for side in ("away", "home"):
                t = c["teams"][side]; base = t["abbr"]; ab = base; n = 1
                while ab in used or (side == "home" and ab == c["teams"]["away"]["abbr"]):
                    n += 1; ab = (base[:2] + str(n))[:3] if n < 10 else base[:1] + str(n)
                used.add(ab); t["abbr"] = ab
        return out
    except Exception:
        return []


# ---------------------------------------------------------------- ratings for the battle simulator
def _set_win(p):
    """chance to win a set (first to 6 games, 2 clear, one tiebreak game at 6-6) when each game goes to the player with probability p"""
    from functools import lru_cache
    @lru_cache(None)
    def f(a, b):
        if a >= 6 and a - b >= 2: return 1.0
        if b >= 6 and b - a >= 2: return 0.0
        if a == 7: return 1.0
        if b == 7: return 0.0
        if a == 6 and b == 6: return p
        return p * f(a + 1, b) + (1 - p) * f(a, b + 1)
    return f(0, 0)

def match_win(p):
    s = _set_win(p); return s * s * (3 - 2 * s)

def game_p_for_match(pm):
    """per-game win chance that produces the given match win chance (bisection)"""
    pm = min(max(pm, 0.03), 0.97); lo, hi = 0.2, 0.8
    for _ in range(40):
        mid = (lo + hi) / 2
        if match_win(mid) < pm: lo = mid
        else: hi = mid
    return (lo + hi) / 2

def sim_sport(cards):
    """-> the sim.json entry for tennis: two rated players per scheduled match (skill on the logit scale: home - away = logit(per-game chance))"""
    teams = []
    for c in cards or []:
        try:
            pg = game_p_for_match(c["crossroads"]["bookHome"]); lg = math.log(pg / (1 - pg))
            for side, sign in (("home", 0.5), ("away", -0.5)):
                t = c["teams"][side]
                teams.append(dict(abbr=t["abbr"], id=t["id"], name=t["name"], short=t["short"], color=t["color"], o=round(sign * lg, 3), d=0, gp=0, inj=dict(out=[], q=[], offAdj=0.0, defAdj=0.0), props=False))
        except Exception:
            continue
    return dict(L=0.5, hfa=0, season=None, teams=teams, players={}) if teams else None
