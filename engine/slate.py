"""Slate selection + card building. No dates, games, players or paths are hard-coded: everything comes from the clock and ESPN."""
import datetime, time, json, re, traceback, os
from espn import pmap, curl
from timeutil import ET, parse_iso, et_date_of
import feeds
import build as B1
import build2 as B2

PRIORITY = ["nfl", "cfb", "nba", "wnba", "mlb", "cbb"]          # who wins a place when the slate is over its cap
CAPS = dict(nfl=12, cfb=8, nba=8, wnba=6, mlb=8, cbb=6)         # per-league cap
TOTAL_CAP = 24
PLAYER_CAP = dict(nfl=10, wnba=6, mlb=8)                         # most events per league that get the (slower) player-level build
HORIZON_H = 48
HORIZON_LG = dict(nfl=72)      # NFL games are weekly: on Friday the Sunday slate should already be visible
RETAIN_H = 30            # finished / live games stay on the slate (frozen pre-game card) this long after kickoff, so open practice bets can settle
RETAIN_CAP = 14          # ...at most this many of them
PLAYER_LG = ("nfl", "wnba", "mlb")

def _status(e):
    t = e["competitions"][0]["status"]["type"]
    return t.get("state"), t.get("name", "")

def candidates(lg, events, now, today):
    """events from the scoreboards -> list of dict(e, state, start, day, rank) that belong on the slate"""
    out = []
    for e in events:
        try:
            c = e["competitions"][0]
            state, name = _status(e)
            if name in ("STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_SUSPENDED") and state != "in": continue
            comps = {x["homeAway"]: x for x in c["competitors"]}
            ha, aa = comps["home"]["team"]["abbreviation"], comps["away"]["team"]["abbreviation"]
            if "TBD" in (ha, aa): continue
            start = parse_iso(e["date"]); day = start.astimezone(ET).date()
            keep = state in ("in", "post") and now - start <= datetime.timedelta(hours=RETAIN_H) or day == today or (state == "pre" and now - datetime.timedelta(hours=6) <= start <= now + datetime.timedelta(hours=HORIZON_LG.get(lg, HORIZON_H)))
            if not keep: continue
            out.append(dict(e=e, state=state, start=start, day=day, has_odds=bool(c.get("odds")), ha=ha, aa=aa))
        except Exception:
            continue
    return out

def interest(model, big, c):
    """how much a game matters: strength of both teams (learned ratings), only used to rank the many college games"""
    try:
        s = 0.0
        for ab in (c["ha"], c["aa"]):
            if ab in model.o: s += model.o[ab] - model.d[ab]
            if big is not None and ab not in big: s -= 6
        return s
    except Exception:
        return 0.0

def order_key(c, today):
    bucket = 0 if c["state"] == "in" else (1 if c["day"] == today else 2)
    return (bucket, 0 if c["has_odds"] else 1, c["start"])

def pick(lg, cands, today, model=None, big=None):
    """cap one league's candidates. NFL/NBA/WNBA/MLB: soonest first. College: biggest games first inside each day bucket."""
    cap = CAPS[lg]
    if lg in ("cfb", "cbb") and model is not None:
        cands = sorted(cands, key=lambda c: (order_key(c, today)[0], order_key(c, today)[1], -interest(model, big, c)))
    else:
        cands = sorted(cands, key=lambda c: order_key(c, today))
    return cands            # caller walks the list until it has `cap` events with odds

def trim_total(chosen):
    """chosen: {lg: [cand,...]} -> same, trimmed to TOTAL_CAP. Lowest-priority leagues give up their last (least important) games first."""
    n = sum(len(v) for v in chosen.values())
    for lg in reversed(PRIORITY):
        while n > TOTAL_CAP and chosen.get(lg):
            chosen[lg].pop(); n -= 1
    return chosen

def carry(prev_games, lg, today, now=None):
    """keep a league's previous cards that are still relevant (today or later, or inside the retention window) when the league could not be refreshed"""
    def ok(g):
        if g.get("day", "") >= str(today): return True
        try: return now is not None and now - parse_iso(g["iso"]) <= datetime.timedelta(hours=RETAIN_H)
        except Exception: return False
    return [g for g in prev_games if (g.get("key") or g.get("lg")) == lg and ok(g)]

def build_slate(now, today, boards, store, prev, budget_s=840, log=print, learn_ready=True):
    """boards: {lg: scoreboard events | None}. prev: previous slate.json (dict) or None.
    returns (games, status) where status[lg] = dict(status, games, playerLevel, teamLevel, error)"""
    t0 = time.time()
    prev_games = (prev or {}).get("games", [])
    prev_by_id = {g["id"]: g for g in prev_games}
    status = {lg: dict(status="ok", games=0, playerLevel=0, teamLevel=0, carried=0, error=None) for lg in ("nfl", "wnba", "mlb", "nba", "cfb", "cbb")}
    cands = {}; prep = {}
    for lg in status:
        evs = boards.get(lg)
        if evs is None:
            status[lg].update(status="error", error="scoreboard unavailable")
            kept = carry(prev_games, lg, today, now); status[lg]["carried"] = len(kept)
            cands[lg] = ("carry", kept)
            continue
        cands[lg] = ("new", candidates(lg, evs, now, today))
    chosen = {}
    retained = {}          # started / finished games we already have a card for: kept frozen, no new feeds needed
    for lg in status:
        kind, lst = cands[lg]
        if kind == "carry": continue
        retained[lg] = [c for c in lst if c["state"] != "pre" and c["e"]["id"] in prev_by_id and now - c["start"] <= datetime.timedelta(hours=RETAIN_H)]
        ids = {id(c) for c in retained[lg]}
        # finished games we never had a card for are not built (the Past view covers them); anything else is a candidate for a fresh card
        cands[lg] = (kind, [c for c in lst if id(c) not in ids and c["state"] != "post"])
    allret = sorted((c for lg in retained for c in retained[lg]), key=lambda c: c["start"], reverse=True)[RETAIN_CAP:]
    drop = {id(c) for c in allret}
    for lg in retained: retained[lg] = [c for c in retained[lg] if id(c) not in drop]
    # rank college games by learned strength: needs the model
    for lg in status:
        kind, lst = cands[lg]
        if kind == "carry": continue
        if not lst: chosen[lg] = []; continue
        model = big = None
        if lg in ("cfb", "cbb") and len(lst) > CAPS[lg]:
            try:
                PR = prep.setdefault(lg, B2.prep(lg)); model = PR["LR"]["model"]; big = PR["TB"]["big"]
            except Exception as ex:
                log(f"  {lg}: could not rank by strength ({ex})")
        chosen[lg] = pick(lg, lst, today, model, big)
    # core odds for the leading candidates (parallel); walk the list until the cap is met
    odds = {}
    for lg in list(chosen):
        lst = chosen[lg]; got = []
        i = 0
        while len(got) < CAPS[lg] and i < len(lst) and i < CAPS[lg] * 4:
            batch = lst[i:i + max(4, CAPS[lg] - len(got))]; i += len(batch)
            res = pmap(lambda c: feeds.fetch_core_odds(lg, c["e"]["id"]), batch, 8)
            for c, o in zip(batch, res):
                if o and o.get("homeTeamOdds") and o.get("awayTeamOdds"): c["core"] = o; got.append(c)
                elif c["e"]["id"] in prev_by_id: c["reuse"] = True; got.append(c)      # odds feed hiccup: keep the card we already have instead of dropping the game
        chosen[lg] = got
    trim_total(chosen)
    for lg in list(chosen): chosen[lg] = chosen[lg] + retained.get(lg, [])
    for lg in retained:
        if lg not in chosen and retained[lg]: chosen[lg] = list(retained[lg])
    games = []
    for lg in status:
        if cands[lg][0] == "carry":
            games += cands[lg][1]; status[lg]["games"] = len(cands[lg][1]); continue
        lst = chosen.get(lg, [])
        if not lst: status[lg]["status"] = "empty"; continue
        try:
            built = _build_league(lg, lst, prev_by_id, prep, now, today, t0, budget_s, log)
            games += built["games"]
            status[lg].update(games=len(built["games"]), playerLevel=built["pl"], teamLevel=built["tl"], carried=built["frozen"], error=built.get("error"))
            if built.get("error") and not built["games"]: status[lg]["status"] = "error"
        except Exception as ex:
            traceback.print_exc()
            kept = carry(prev_games, lg, today, now)
            games += kept
            status[lg].update(status="error", error=f"{type(ex).__name__}: {ex}"[:300], games=len(kept), carried=len(kept))
    games.sort(key=lambda g: (g["iso"], g["id"]))
    return games, status

def _build_league(lg, lst, prev_by_id, prep, now, today, t0, budget_s, log):
    out = []; pl = tl = frozen = 0; errs = []
    todo = []
    for c in lst:
        old = prev_by_id.get(c["e"]["id"])
        if (c["state"] != "pre" or c.get("reuse")) and old:             # started: freeze the pre-game card (props and lines vanish at kickoff; open bets keep settling against it)
            out.append(old); frozen += 1
        else: todo.append(c)
    if not todo: return dict(games=out, pl=0, tl=0, frozen=frozen)
    PR = None
    player_ctx = None
    if lg in PLAYER_LG:
        try:
            rows, lgpf, lgpa = B1.load_ratings(lg)
            import espn
            sport, l = espn.SP[lg]
            league_inj = (curl(f"{espn.SB}{sport}/{l}/injuries") or {}).get("injuries")
            if league_inj is None: raise RuntimeError("injury feed unavailable")
            import ctxfactors as CF
            CX = CF.fetch(lg)
            player_ctx = dict(rows=rows, league_inj=league_inj, CX=CX)
        except Exception as ex:
            log(f"  {lg}: player-level inputs failed ({type(ex).__name__}: {ex}); team-level cards instead")
            errs.append(f"player-level unavailable: {ex}"[:200])
    n_player = 0
    # fetch per-event feeds in parallel for the events that will get player cards
    pl_ev = []
    if player_ctx:
        for c in todo:
            if n_player >= PLAYER_CAP[lg]: break
            pl_ev.append(c); n_player += 1
        def feed(c):
            e = c["e"]; eid = e["id"]; comps = {x["homeAway"]: x for x in e["competitions"][0]["competitors"]}
            items = feeds.fetch_props(lg, eid)
            summ = feeds.fetch_summary(lg, eid)
            ros = {s: feeds.roster_players(lg, comps[s]["team"]["id"]) for s in ("away", "home")}
            return items, summ, ros
        fetched = pmap(feed, pl_ev, 4)
        fmap = {c["e"]["id"]: f for c, f in zip(pl_ev, fetched)}
    for c in todo:
        e = c["e"]; eid = e["id"]; g = None
        if player_ctx and c in pl_ev and time.time() - t0 < budget_s:
            try:
                f = fmap.get(eid)
                if not f: raise RuntimeError("event feeds unavailable")
                items, summ, ros = f
                if not items: raise RuntimeError("no player props published")
                if not ros["away"] or not ros["home"]: raise RuntimeError("roster unavailable")
                pidx = feeds.props_index(items)
                picks = {s: feeds.select_players(lg, ros[s], pidx) for s in ("away", "home")}
                if not picks["away"] or not picks["home"]: raise RuntimeError("no players with props on one side")
                # fetch the game logs we will need in parallel (the build then reads them from the cache)
                ids = [p["id"] for s in picks for p in picks[s]]
                from espn import prefetch_gamelogs
                if lg == "nfl":
                    ids += [p["id"] for s in ros for p in ros[s] if p["pos"] in ("QB", "RB", "WR", "TE", "FB") and p["grp"] in ("offense", "injuredReserveOrOut")]
                comps = e["competitions"][0]["competitors"]
                for inj in player_ctx["league_inj"]:
                    if str(inj["id"]) in {str(x["team"]["id"]) for x in comps}:
                        ids += [B1.athlete_id(i["athlete"]) for i in inj.get("injuries", []) if i.get("athlete")]
                prefetch_gamelogs(lg, ids)
                g = B1.build_game(lg, e, summ, c["core"], pidx, player_ctx["rows"], player_ctx["league_inj"], player_ctx["CX"], picks)
                pl += 1
            except Exception as ex:
                log(f"  {lg} {e.get('shortName')}: player-level failed ({type(ex).__name__}: {ex}); falling back to a team-level card")
                if os.environ.get("LS_DEBUG"): traceback.print_exc()
                g = None
        if g is None and prev_by_id.get(eid, {}).get("players"):          # a player-level card we already have beats a team-level downgrade
            g = prev_by_id[eid]; frozen += 1; out.append(g); continue
        if g is None:
            try:
                PR = prep.get(lg) or prep.setdefault(lg, B2.prep(lg))
                g = B2.build_event(lg, e, c["core"], PR)
                tl += 1
            except Exception as ex:
                log(f"  {lg} {e.get('shortName')}: card failed ({type(ex).__name__}: {ex}); game skipped")
                errs.append(f"{e.get('shortName')}: {type(ex).__name__}: {ex}"[:200])
                continue
        out.append(g)
    return dict(games=out, pl=pl, tl=tl, frozen=frozen, error=("; ".join(errs[:3]) if errs else None))
