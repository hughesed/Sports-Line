#!/usr/bin/env python3
"""Line Scout data refresh. One command, no arguments, stdlib only:

    python refresh.py

Pulls ESPN (scoreboards, odds, props, injuries, results), appends finished games to store/, re-learns the ratings (walk-forward model),
grades its own earlier predictions, rebuilds the slate and writes data/slate.json, data/learn.json, data/pastp.json, data/meta.json.
Safe to run any time and as often as you like. A failing league keeps its last good data and is reported in data/meta.json.

Environment (all optional):  LS_ROOT repo root | LS_CACHE scratch dir | LS_NOW=2026-10-01T18:00:00Z pretend it is that moment
                             LS_SIMULATE_FAIL=nba,cfb make those leagues fail (test the keep-last-good path) | LS_ONLY=nfl,mlb only those leagues
                             LS_DEADLINE=120 seconds after which no new ESPN request is started (the run then finishes from what it has and still writes valid files)
                             LS_MIN_PUBLISH_GAP_MIN=100 publish at most once per 100 minutes (see README, hosting with a deploy cap)
                             LS_BUDGET=70 seconds allowed for the slower player-level builds (default: 55% of LS_DEADLINE, or 840 without a deadline)"""
import os, sys, json, time, datetime, traceback, copy
ROOT = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("LS_ROOT", ROOT)
sys.path.insert(0, os.path.join(ROOT, "engine"))

import espn
from timeutil import ET, UTC, today_et
from store import Store, LEAGUES, fetch_range, scan_start, ingest
import games_all, learn, learn_export as LEX, build as B1, ctxfactors as CF
from predlog import PredLog
import slate as SL
from pastp import build_pastp

DATA = os.path.join(ROOT, "data")
SCHEMA = 1
T0 = time.time()

def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)

def read_json(path, default=None):
    try:
        with open(path) as f: return json.load(f)
    except Exception:
        return default

def write_json(path, obj, compact=True):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, separators=(",", ":") if compact else None, indent=None if compact else 1, ensure_ascii=False)
    os.replace(tmp, path)

def sim_fail(lg):
    return lg in [x.strip() for x in os.environ.get("LS_SIMULATE_FAIL", "").split(",") if x.strip()]

def validate_slate(s):
    assert isinstance(s, dict) and isinstance(s.get("games"), list) and "asOf" in s, "slate shape"
    for g in s["games"]:
        for k in ("id", "lg", "teams", "lines", "crossroads", "players", "iso", "day"):
            assert k in g, f"game {g.get('id')} lacks {k}"
        for k in ("projHome", "projAway", "projTotal", "pHome", "leans", "learn", "matchups", "ctx"):
            assert k in g["crossroads"], f"crossroads lacks {k}"
    return True

def validate_learn(l):
    for k in ("leagues", "days", "window", "gen"):
        assert k in l, f"learn lacks {k}"
    assert len(l["days"]) == 12 and l["leagues"], "learn days/leagues"
    return True

def main():
    only = [x.strip() for x in os.environ.get("LS_ONLY", "").split(",") if x.strip()]
    leagues = [lg for lg in LEAGUES if not only or lg in only]
    now = datetime.datetime.fromisoformat(os.environ["LS_NOW"].replace("Z", "+00:00")) if os.environ.get("LS_NOW") else datetime.datetime.now(UTC).replace(microsecond=0)
    today = today_et(now)
    deadline = float(os.environ.get("LS_DEADLINE", "0") or 0)
    if deadline: espn.set_deadline(T0 + deadline)
    budget = float(os.environ.get("LS_BUDGET") or (deadline * 0.55 if deadline else 840))
    gap = float(os.environ.get("LS_MIN_PUBLISH_GAP_MIN", "0") or 0)       # optional throttle for hosts that cap deploys (Cloudflare Pages free = 500/month): publish at most once per gap
    if gap:
        pm = read_json(f"{DATA}/meta.json", {}) or {}
        try:
            age = (now - datetime.datetime.fromisoformat(pm["generatedAt"].replace("Z", "+00:00"))).total_seconds() / 60
        except Exception:
            age = None
        if age is not None and 0 <= age < gap:
            print(f"throttled: the last publish was {age:.0f} min ago (< LS_MIN_PUBLISH_GAP_MIN={gap:.0f}); nothing to do"); return 0
    log(f"Line Scout refresh. now={now.isoformat()}  ET today={today}  leagues={','.join(leagues)}")
    os.makedirs(DATA, exist_ok=True)
    espn.prune_cache()
    B1.set_now(now); CF.set_now(now); learn.set_today(today)

    prev_slate = read_json(f"{DATA}/slate.json")
    prev_learn = read_json(f"{DATA}/learn.json")
    prev_meta = read_json(f"{DATA}/meta.json", {})
    errors = []          # human-readable list for meta.json
    lstat = {lg: dict(status="ok", games=0, playerLevel=0, teamLevel=0, carried=0, error=None) for lg in LEAGUES}

    # ---------------------------------------------------------------- 1. store: scoreboards -> finished games
    st = Store(); games_all.set_store(st)
    boards = {}
    log("1/7 scoreboards + history store")
    for lg in leagues:
        try:
            if sim_fail(lg): raise RuntimeError("simulated failure (LS_SIMULATE_FAIL)")
            start = scan_start(st, lg, today)
            evs, complete = fetch_range(lg, start, today + datetime.timedelta(days=5))
            if not evs and not complete: raise RuntimeError("scoreboard unavailable")
            boards[lg] = evs
            info = ingest(st, lg, evs, today, start, complete, log)
            lstat[lg].update(newFinals=info["new"], storeGames=info["games"])
            if not complete: errors.append(f"{lg}: some scoreboard days did not load; will retry next run")
        except Exception as ex:
            boards[lg] = None
            msg = f"{type(ex).__name__}: {ex}"[:300]
            lstat[lg].update(status="error", error=msg); errors.append(f"{lg} scoreboard: {msg}")
            log(f"  {lg}: scoreboard step failed: {msg}")
    if leagues and all(boards.get(lg) is None for lg in leagues):
        raise RuntimeError("ESPN is unreachable (no scoreboard loaded for any league); nothing was changed")
    for lg in LEAGUES:
        lstat[lg].setdefault("storeGames", len(st.games[lg]))
        ld = st.last_date(lg); lstat[lg]["lastFinal"] = ld
    learn.set_odds(st.odds)

    # ---------------------------------------------------------------- 2. grade earlier predictions, derive bounded adjustments
    log("2/7 grading earlier predictions")
    pred = PredLog()
    ngr = pred.grade(st)
    live = pred.summary()
    slopes = pred.slopes()
    LEX.CALIB.clear(); LEX.CALIB.update(slopes)
    B1.LIVE_LEANS.clear(); B1.LIVE_LEANS.update({lg: v.get("leans") or {} for lg, v in live.items() if lg != "_all"})
    log(f"  graded +{ngr}; total graded {live['_all']['n']}; win-chance slopes {slopes or 'none yet (need 40 graded games per league)'}")

    # ---------------------------------------------------------------- 3. slate
    log("3/7 slate")
    games = []
    try:
        board_for_slate = {lg: (boards.get(lg) if lg in leagues else None) for lg in LEAGUES}
        for lg in LEAGUES:
            if lg not in leagues: board_for_slate[lg] = None
        # leagues outside LS_ONLY keep their previous cards (only matters for partial test runs)
        games, sstat = SL.build_slate(now, today, board_for_slate, st, prev_slate, budget, log)
        for lg in LEAGUES:
            s = sstat[lg]
            if lg not in leagues: continue
            if lstat[lg]["status"] == "error":      # scoreboard failed: keep the error message from step 1
                s = dict(s); s["error"] = lstat[lg]["error"]; s["status"] = "stale" if s.get("carried") else "error"
            lstat[lg].update({k: v for k, v in s.items() if v is not None or k == "error"})
            if s.get("error") and lstat[lg]["status"] == "ok": lstat[lg]["status"] = "partial"
            if s.get("error"): errors.append(f"{lg}: {s['error']}")
    except Exception as ex:
        traceback.print_exc()
        errors.append(f"slate: {type(ex).__name__}: {ex}"[:300])
        games = list((prev_slate or {}).get("games", []))
        for lg in LEAGUES: lstat[lg]["status"] = "stale"
    all_failed = all(lstat[lg]["status"] in ("error", "stale") for lg in leagues) and not games and prev_slate and prev_slate.get("games")
    if all_failed:
        games = prev_slate["games"]; log("  every league failed: keeping the previous slate untouched")
    slate = dict(asOf=now.astimezone(ET).strftime("%a %b %-d, %Y, ~%-I:%M %p ET"), games=games)
    validate_slate(slate)
    log(f"  slate: {len(games)} games " + str({lg: sum(1 for g in games if (g.get('key') or g['lg']) == lg) for lg in LEAGUES}))

    # ---------------------------------------------------------------- 4. learning export
    log("4/7 learning (walk-forward ratings, tuning, blend weights)")
    sched_events = {lg: [e for e in (boards.get(lg) or [])] for lg in LEAGUES}
    learn_out = LEX.build_learn(today, len(games), sched_events, prev_learn, {**{lg: v for lg, v in live.items() if lg != "_all"}, "_all": live["_all"]}, log)
    # a league whose scoreboard failed this run keeps its last known schedule (the "future days" in the calendar)
    for lg in leagues:
        if boards.get(lg) is None and prev_learn:
            for dd, gs in (prev_learn.get("sched") or {}).items():
                k = [x for x in gs if x.get("lg") == lg and dd >= str(today)]
                if k: learn_out.setdefault("sched", {}).setdefault(dd, []).extend(k)
    for d in learn_out["days"]:
        if d["kind"] == "future":
            d["n"] = len([x for x in learn_out.get("sched", {}).get(d["date"], []) if not x.get("tbd")]); d["ok"] = d["n"] > 0
    for dd in learn_out.get("sched", {}): learn_out["sched"][dd].sort(key=lambda x: (x["date"], x["id"]))
    for lg, msg in learn_out.pop("errors", {}).items():
        errors.append(f"{lg} learning: {msg}")
        if lstat[lg]["status"] == "ok": lstat[lg]["status"] = "stale"
        lstat[lg]["error"] = (lstat[lg].get("error") or "") + f" learning: {msg}"
    # learning log (one entry per change in the amount of data)
    hist_f = os.path.join(ROOT, "store", "learn_history.json")
    hist = read_json(hist_f, [])
    entry = dict(ts=now.strftime("%Y-%m-%dT%H:%MZ"), leagues={lg: dict(n=v["n"], acc=v["summary"].get("accFinal"), maeM=v["summary"].get("maeFinalM"), maeT=v["summary"].get("maeFinalT")) for lg, v in learn_out["leagues"].items()})
    if not hist or {k: v["n"] for k, v in hist[-1]["leagues"].items()} != {k: v["n"] for k, v in entry["leagues"].items()}: hist.append(entry)
    hist = hist[-120:]
    learn_out["history"] = hist[-6:]
    validate_learn(learn_out)

    # ---------------------------------------------------------------- 5. recaps
    log("5/7 past-day recaps")
    try:
        pastp, nfetch, nfail = build_pastp(learn_out["window"], ROOT, log)
    except Exception as ex:
        traceback.print_exc(); errors.append(f"recaps: {ex}")
        pastp = read_json(f"{DATA}/pastp.json", {})

    # ---------------------------------------------------------------- 6. log this run's pre-game predictions
    log("6/7 prediction log")
    nlog = pred.log_games(games, now, slopes)
    log(f"  logged {nlog} new pre-game snapshots (first snapshot per game is kept); {len(pred.recs)} on file")

    # ---------------------------------------------------------------- 7. write everything (atomic, only after validation)
    log("7/7 writing data/ and store/")
    pred.save(today)
    if espn.STATS["skipped"]:
        errors.append(f"time limit reached: {espn.STATS['skipped']} ESPN requests were skipped to stay inside the run budget; the next run catches up")
    run_no = int(os.environ.get("GITHUB_RUN_NUMBER") or (prev_meta.get("runNumber") or 0) + 1)
    meta = dict(schema=SCHEMA, runNumber=run_no, deadlineHit=bool(espn.STATS["skipped"]), generatedAt=now.strftime("%Y-%m-%dT%H:%M:%SZ"), generatedAtET=now.astimezone(ET).strftime("%a %b %-d, %-I:%M %p ET"), today=str(today),
                lastRunAt=now.strftime("%Y-%m-%dT%H:%M:%SZ"), lastRunError=None,
                ok=not any(v["status"] in ("error", "stale") for lg, v in lstat.items() if lg in leagues),
                leagues={lg: lstat[lg] for lg in LEAGUES},
                counts=dict(slate=len(games), playerCards=sum(1 for g in games if g["players"]), teamCards=sum(1 for g in games if not g["players"]), window=sum(len(v) for v in learn_out["window"].values()),
                            sched=sum(len(v) for v in learn_out.get("sched", {}).values()), pastp=len(pastp), predictions=len(pred.recs), graded=live["_all"]["n"], storeGames=sum(len(st.games[lg]) for lg in LEAGUES)),
                calibration=dict(slopes=slopes, graded=live["_all"]["n"], accML=live["_all"].get("accML"), accBook=live["_all"].get("accBook")),
                errors=errors[:20], requests=espn.STATS["requests"], failedRequests=espn.STATS["fails"], retries=espn.STATS["retries"], seconds=round(time.time() - T0, 1))
    write_json(f"{DATA}/slate.json", slate)
    write_json(f"{DATA}/learn.json", learn_out)
    write_json(f"{DATA}/pastp.json", pastp)
    write_json(hist_f, hist)
    st.save()
    write_json(f"{DATA}/meta.json", meta, compact=False)
    log(f"done in {time.time() - T0:.0f}s: {meta['counts']}  requests={espn.STATS['requests']} failed={espn.STATS['fails']} retries={espn.STATS['retries']} slowest={espn.STATS['slowest']}")
    if errors: log("notes: " + " | ".join(errors[:6]))
    return 0

if __name__ == "__main__":
    try:
        rc = main()
    except SystemExit:
        raise
    except Exception as ex:               # catastrophic: leave data/ untouched, only note it in meta.json (so the Actions run shows red but nothing good is lost)
        traceback.print_exc()
        try:
            m = read_json(f"{DATA}/meta.json", {}) or {}
            m["lastRunAt"] = datetime.datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"); m["lastRunError"] = f"{type(ex).__name__}: {ex}"[:400]
            os.makedirs(DATA, exist_ok=True); write_json(f"{DATA}/meta.json", m, compact=False)
        except Exception: pass
        rc = 1
    sys.exit(rc)
