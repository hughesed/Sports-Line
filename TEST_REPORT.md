# Test report

Tested in the build sandbox on 2026-10-01/02 (Python 3.13 and 3.11, Chromium via Playwright, real ESPN traffic through the sandbox proxy, which is slower and flakier than a GitHub runner).

## Passed (real runs, not mocks)

**Refresh pipeline (`python refresh.py`)**
* Full runs from a clean copy of this folder, about 20 in total, no crash. 6 leagues, 13,333 stored games, ~250 to 1,200 ESPN requests per run (1,200 on a cold start with player game logs, ~250 when the scratch cache is warm).
* Output schema identical to the original artifact files: `slate.json`, `pastp.json` (no key differences), `learn.json` (only differences: the new `live` self-grading block, and date-keyed entries). Checked with `tools/schema_diff.py`.
* Model parity: team-level college-football cards (PITT@VT, PSU@NU, UNT@TLSA, LIB@DEL) reproduced the original artifact numbers exactly (projected score, total, win chance).
* Player-level cards built automatically with no hard-coded players: NFL (10 games, 10 to 14 players each), WNBA, MLB. Players are chosen from those the book has props on (QB, 2 RB, 3 WR, TE; top 5 WNBA; SP + 6 hitters MLB), skipping players who are out. Games where that fails (no props posted, one side with no props) fall back to a team-level card; the game is never dropped (MLB examples seen in the log).
* Idempotency: a second and third run in a row keep 100% of the same game ids; the prediction log kept the first snapshot per game (`logged 0 new` on repeat runs, 1 when a new game entered the window).
* Failure handling: `LS_SIMULATE_FAIL=nba,cfb` and `nfl,cfb`: those leagues keep their last good cards byte-for-byte, are marked `stale` in `data/meta.json`, the other leagues refresh, `ok:false`. Deadline: `LS_DEADLINE=15` produced valid files in 21 s with `deadlineHit:true`, and the history catch-up resumed on the next run. All six leagues failing at once (simulated): exit code 1 internally, `slate.json`/`learn.json` byte-identical afterwards, only `meta.json` gets `lastRunError` (the page then shows "last refresh run failed"); the workflow turns that into a warning, not a red run.
* Offseason: a run dated 2027-03-01 (nothing in season) gives an empty slate, valid files, six `empty` league statuses, no crash. An empty slate also renders in the page.
* Self-improvement: 100 synthetic predictions injected into a copy of the store were graded by a real run (`graded +100`), the win-chance scale was fitted and bounded (0.85), written to `meta.json` and `learn.json` (`live`), and applied to the MLB cards. `tools/selftest.py` (16 offline checks) covers first-snapshot-wins, no duplicates, grading once, minimum 40 games, bounds, store round trip, ET dates, cron budget, `index.html` up to date.
* Runs on Python 3.11 (the version the workflow uses): selftest and a full refresh pass.
* Repo size: **3.5 MB** total (data 1.1 MB, store 1.5 MB, page 0.27 MB, code 0.5 MB). Git history does not grow (the bot amends its own previous commit); simulated locally with a bare remote: first run makes one commit, later runs amend it, no-change runs commit nothing, a human commit in between starts a new bot commit.

**Page (Chromium, 400 px wide, served from the fake origin `https://linescout.test` so CORS is enforced like on a real host; `tools/ui_test.py`: 17/17 checks)**
* Slate renders (every game has a card), "Data updated Fri Oct 2, 12:52 AM ET · 2 min ago" label, Today view with **Safe 2 / 4 / 8** buttons (72 on 24 cards) and **Pick of the Day** section, 12-day calendar, no horizontal scroll.
* **Live polling from a static page works**: ESPN scoreboard and summary calls from the page origin all returned 200 with no CORS errors (ESPN sends `access-control-allow-origin: *`). A game that was live during the test showed up live with a score, clock and win probability. Only games within 20 minutes of kickoff, live, or just finished are polled.
* Practice bet placed, bankroll $1,000 to $990, reload: bankroll and open bet persist (localStorage). A bet on a game that then left the slate still lists and does not crash (the card is kept on the phone until settled).
* Stale warning after 6 h, offline fallback to the copy saved on the phone (labelled), error state with a Try again button that recovers, no JavaScript errors.
* Screenshots were looked at (Today, Live, stale bar, NFL player-level card, MLB team-level fallback card).

**Workflow and budget**
* `refresh.yml` parses (PyYAML); `tools/budget.py` expands the 3 cron lines to **32 runs/day**, `timeout-minutes: 2`, worst case **1,984 min** for a 31-day month (limit 1,990). The commit step logic was run against a local bare repo (see above).

## Measured runtime (budget input)

Full `python refresh.py`, steady state with the final code, in this sandbox: 26, 27, 34, 37, 42, 50, 60, 64, 65 s; 77 s when the 70 s deadline was hit. Slowest ever seen 116 s (before request timeouts were tightened from 30 s to 8 s). CPU is only 4 to 9 s of that; the rest is waiting on ESPN through the proxy. Plus about 30 to 40 s for checkout, cache, setup-python and commit/push (estimate, GitHub runners could not be measured from here). Typical job 65 to 90 s, so **2 billed minutes**; the hard cap is `timeout-minutes: 2`.

## Not tested / limitations (please read)

* **The workflow has never run on GitHub** (no access from here): runner start-up overhead, `actions/cache`, `setup-python`, commit/push permissions, and real billed minutes are estimates until the first week of runs; check Settings, Billing, Usage and adjust with `tools/budget.py`. If runs are slower than ~70 s of ESPN time, they will hit the deadline and skip some feeds (player-level cards fall back to team-level, the next run catches up).
* GitHub Pages / Cloudflare Pages deployment was not exercised; the host limits quoted in the README (Cloudflare Pages 500 builds/month, Netlify 15 credits per deploy of 300, GitHub Pages only on public repos for Free) come from their documentation as of this build; Vercel was not checked.
* Scheduled runs can start late or be skipped by GitHub; not observable here.
* iPhone Safari specifics (home-screen app storage separation, 7-day storage cleanup for non-installed sites) are from documented platform behaviour, not tested on a device.
* ESPN endpoints are unofficial and the model needs several of them (scoreboard, core odds and props, injuries, rosters, athlete game logs, summaries); a format change in any of them degrades that league (see `meta.json`) rather than failing the run.
* Self-calibration needs 40+ graded games per league; the live record starts empty, so for the first days the win-chance scale is 1.0 (no adjustment).
* Player props only exist for NFL, WNBA and MLB; NBA, college football and college basketball are team-level.
* Boards and chat from the Claude artifact version are not part of the standalone page.
* Playwright test needs `pip install playwright`; it is a developer tool, not part of the bot.
