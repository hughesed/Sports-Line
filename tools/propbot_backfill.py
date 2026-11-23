#!/usr/bin/env python3
"""One-off seeding of the prop bot (engine/propbot.py) from the repo's own history, so it starts learning with weeks of graded legs instead of none.

The refresh bot commits data/slate.json every run, so git history holds the cards exactly as the page showed them before each game: FanDuel's lines,
rungs and prices, the model's chances, injury status. For each past day this takes two versions of the slate (about 11:30 AM and 6:30 PM ET), writes
down every FanDuel player leg of the games that had not started yet (the later version wins, as in the live bot), marks them bf=1 (rebuilt, no
research factors) and adds them to store/propbot/state.json as open legs. The refresh bot then grades them from ESPN's box scores in its next runs
(about 40 games a run) and learns from them like any other leg. Legs already on file are left alone, so running it twice changes nothing.
Needs the GitHub CLI (gh) logged in to the repo.   usage: python tools/propbot_backfill.py [days=20] [repo=hughesed/Sports-Line]"""
import os, sys, json, subprocess, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))
import propbot as PB
UTC = datetime.timezone.utc
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 20
REPO = sys.argv[2] if len(sys.argv) > 2 else "hughesed/Sports-Line"
TIMES = ((16, 30), (23, 30))           # UTC: before the early NFL / weekend matinees, and before the night games

def gh(path, raw=False):
    cmd = ["gh", "api", path] + (["-H", "Accept: application/vnd.github.raw+json"] if raw else [])
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0: raise RuntimeError(r.stderr[:200])
    return r.stdout

def version_at(t):
    """the last commit of data/slate.json in the 40 minutes before t: (sha, commit time) or None"""
    since = (t - datetime.timedelta(minutes=40)).strftime("%Y-%m-%dT%H:%M:%SZ"); until = t.strftime("%Y-%m-%dT%H:%M:%SZ")
    js = json.loads(gh(f"repos/{REPO}/commits?path=data/slate.json&since={since}&until={until}&per_page=1"))
    if not js: return None
    return js[0]["sha"], datetime.datetime.fromisoformat(js[0]["commit"]["author"]["date"].replace("Z", "+00:00"))

def main():
    live = PB.PropBot(log=print)
    have = set(live.open) | {f"{r['g']}|{r['i']}|{r['s']}|{r['r']}|{r['t']}" for r in live.rows}
    seed = PB.PropBot(root=os.path.join(ROOT, ".cache", "bf"), log=lambda *a: None); seed.open = {}; seed.rows = []; seed.L = {}
    today = datetime.datetime.now(UTC).astimezone(PB.ET).date()
    for k in range(DAYS, 0, -1):
        d = today - datetime.timedelta(days=k)
        for hh, mm in TIMES:
            t = datetime.datetime(d.year, d.month, d.day, hh, mm, tzinfo=UTC)
            try: v = version_at(t)
            except Exception as ex: print(f"  {t:%m-%d %H:%M}Z: commit list failed: {ex}"); continue
            if not v: print(f"  {t:%m-%d %H:%M}Z: no slate version"); continue
            sha, when = v
            try: sl = json.loads(gh(f"repos/{REPO}/contents/data/slate.json?ref={sha}", raw=True))
            except Exception as ex: print(f"  {t:%m-%d %H:%M}Z: download failed: {ex}"); continue
            n0 = len(seed.open)
            seed.snapshot(sl.get("games") or [], when)
            print(f"  {when:%m-%d %H:%M}Z ({sha[:7]}): {len(sl.get('games') or [])} games, open legs {n0} -> {len(seed.open)}")
    add = 0
    for key, r in seed.open.items():
        if key in have: continue
        r["bf"] = 1; r.pop("l", None); live.open[key] = r; add += 1
    live.save(datetime.datetime.now(UTC))
    print(f"added {add} rebuilt legs ({len(seed.open) - add} were on file already); {len(live.open)} open legs now in store/propbot/state.json")

if __name__ == "__main__":
    main()
