# Test report

Two parts: the original site and bot (first sections, tested 2026-10-01/02), and the **accounts / practice coins / leaderboard / badges / chat / Battles** extension (section "Social features", tested 2026-10-02). Everything below was run for real; "not tested" items are listed at the end of each part.

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

**Page (Chromium, 400 px wide, served from the fake origin `https://linescout.test` so CORS is enforced like on a real host; `tools/ui_test.py`: 17/17 checks, now 21/21 with the "no Supabase configured" checks)**
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

---

# Social features (accounts, practice coins, leaderboard, badges, chat, profiles, Battles)

**Practice coins only: no real money, nothing to buy, no cash-out.**

## How it was tested

There is no Supabase account in the sandbox, so a **local stand-in** was built (`tools/localstack/`, `bash tools/localstack/run_all.sh`):

* **Real PostgreSQL 16 with the real pg_cron extension** (apt package `postgresql-16-cron`), plus `supabase_stub.sql`: the Supabase roles (`anon`, `authenticated`, `service_role`, `authenticator`, `supabase_auth_admin`), an `auth.users` table, `auth.uid()` / `auth.role()` / `auth.jwt()` with Supabase's own definitions, Supabase's default grants on `public`, and the `supabase_realtime` publication.
* **`supabase/setup.sql` run twice in a row on a fresh database** every time (proves it is idempotent), then the battle data from `data/sim.json`.
* **Real PostgREST v12.2.3** (static binary from GitHub releases) with JWT auth, exactly like Supabase's `/rest/v1`.
* `gateway.py`: `/rest/v1/*` proxied to PostgREST, and a small **GoTrue-compatible auth mock** (`/auth/v1/signup`, `token?grant_type=password|refresh_token`, `user`, `logout`) that inserts `auth.users` rows **as `supabase_auth_admin`** (so the sign-up trigger runs with the same role as on Supabase) and mints HS256 JWTs with PostgREST's secret.
* The page used the **real supabase-js 2.117.2** (the pinned CDN build, sha384 SRI verified against jsDelivr), routed to the stand-in by Playwright as `https://sb.test`. Realtime cannot run locally: the websocket is refused, which tests the polling fallback.

## Passed

| Test (file in `tools/localstack/`) | Result | What it covers |
|---|---|---|
| `api_test.py` (REST as anon / 5 users / service role) | **110 / 110** | sign-up creates profile + 1,000 coins + ledger row; usernames unique case-insensitive, `claim_username` fallback; email never exposed. **Security:** direct UPDATE of balance, INSERT of badges, ledger writes, battle-stats edits, profile deletes all denied (HTTP 403); bot functions denied to users (403) and anon (401); internal coin function not exposed (404); other users' ledger invisible; chat unreadable signed out. **Bets:** server re-prices legs (a client price of +900 was ignored), atomic stake deduction, boost by server rules, page-identical labels and milestone prices (estPrice port), singles = one slip per leg, refused: negative stake, stake above balance, two legs from one market, signed out, live leg before the game window, pregame leg after kickoff, live price above +400, bets on a final game; live parlay accepted in the window with its label sanitized. **Settlement** (`bot_settle_games`): boosted parlay payout to the cent, singles, live parlay lost on its losing leg, prop on a ruled-out player void, payouts credited, daily net = profit on the settle day, re-settling changes nothing, **ledger sums to the balance**. **Chat:** control characters stripped, HTML kept as text, 2-second rate limit, 501 chars refused, SVG and >120 KB images refused, mentions recorded only for existing usernames, users read only their own mentions, cannot delete others' messages, delete own. **Battle:** markets (ML, spread, total, 2-4 props per team), wager escrow, self-accept refused, winner market closed until accepted, double-accept refused (row lock), players cannot bet on their own battle, spectator stake above balance refused, empty parlay cannot lock, one pick per market, **parlays private until the start**, edit after lock refused, second lock starts the sim, **betting after the start refused**, **future plays hidden by RLS** (and through `battle_detail`), result hidden until the end, early settle does nothing, plays revealed progressively (about half visible at 90 s), lazy settle by anyone after the end, pot to the winner per the rules, W/L + Elo for both players, spectator bets paid at their odds and no battle record for spectators, settle twice does nothing, timeline ends with the final score. **Refunds:** creator cancel (wager + spectator bets), not accepted in 30 min, parlays not locked in 15 min. NBA and MLB battles simulated and settled. **HOT STREAK** after 5 straight winning slips. **Midnight ET (fake clock):** finalize finalizes the ended day and is idempotent; CHAMPION, TRASH CAN, MOST ACTIVE, CONVERSATION, KING (NFL) awarded correctly; daily top-up to 100; board resets and shows yesterday's badges; badges stack (CHAMPION ×2); profile and all-time table. |
| `sim_test.py` (thousands of simulated games in the database) | **21 / 21** | see table below: realistic scoring per sport and league-wide, favourites win more often, posted win chances match the simulator within 8 points, NBA/MLB never tied |
| `cron_test.py` | **3 / 3** | the real pg_cron job alone (no page, no bot) cancelled and refunded an expired battle within 15 s; job runs recorded as succeeded |
| `bot_test.py` (runs `refresh.py` twice on a copy of the site) | **11 / 11** | practice bets on a **real finished MLB game** (PHI @ ATL, 2-6, from the store; placed before its start with the fake clock) settled by the bot from the store final + the **real ESPN box score**: ML + 1.5-hits parlay won, 20.5-K over lost, prop on a player not in the box score void + refunded, total and total-bases singles graded like the page; `data/config.json` gets URL + anon key and never the service key (grep of `data/` and `store/`); battle teams + the slate's games uploaded; second run uploads nothing unchanged and pays nothing twice; run time 20 to 33 s with `LS_ONLY=mlb,nfl` |
| `ui_social_test.py` (Chromium, **three players in three browsers**, 400 px) | **40 / 40** | signed out: Sign in button and no money in the header, board and battle lobby browsable, chat asks to sign in, slip says "Sign in to bet"; sign-up x3 through the modal; header swaps to the coin balance; session survives a reload; server bet placed from a game card (1,000 -> 990), listed as Pending, shows Won after the bot settles it; chat **falls back to polling** ("updates every 4 s") because realtime is refused; **@mention autocomplete**, highlighted mention, HTML shown as text, "@1" badge and "mentioned you" for the other player, messages arrive by polling, delete own; full **battle**: create (NFL BUF @ KC, 100 coins), accept from the lobby, a third player places ML / spread / total / battle-winner spectator bets, both build and lock parlays (hidden from each other), sim starts, scoreboard + play-by-play while the server withholds future plays, plays keep arriving for the spectator, fake clock to the end -> settled by the watching page, winner banner, W/L only for the two players, spectator bets settled; leaderboard with usernames; after midnight ET (fake clock): yesterday's champion, board reset; profile with coins, nets, CHAMPION ×2, battle record, slips; sign out; no horizontal scroll at 400 px on chat, live battle, leaderboard, profile; **no JavaScript errors** |
| `tools/ui_test.py` (no Supabase configured) | **21 / 21** | the original 17 checks (local bank, bets, live ESPN polling, stale/offline/error states) still pass; Battle / Board / Chat say "Sign-in not set up yet"; header keeps the phone-only bank |
| `tools/selftest.py` | **21 / 21** | the original 16 + config guard (a secret key is never published), box-score parser port incl. total bases from play text and composite stats, battle data builder, setup.sql static checks |
| `refresh.py` without Supabase env | OK | 47 s and 59 s full runs (ESPN through the sandbox proxy); `meta.json -> social.enabled:false`; `data/config.json` empty; `data/sim.json` written (92 teams, 396 players) |
| `refresh.py` with Supabase env, all leagues | OK | 64 s, of which Supabase calls took 0.2 s (11 calls); the settlement work runs in a background thread during the ESPN phase |
| `refresh.py` with Supabase **unreachable** | OK | 30 s, exit code 0, every failed call listed in `meta.json -> social.errors`, all data files written |

Simulator (from `sim_test.py`; lines = what the battle markets post):

| Game | Sims | Average score (sim) | Lines expect | Home wins (sim / line) | Margin sd |
|---|---|---|---|---|---|
| NFL BUF @ KC | 800 | 24.3 - 24.5 | 23.9 - 24.0 | 49.8% / 50.4% | 14.7 |
| NFL NYJ @ BUF | 800 | 20.7 - 29.7 | 20.0 - 29.3 | 73.0% / 73.9% | 14.8 |
| NBA LAL @ BOS | 500 | 105.3 - 109.8 | 104.2 - 108.7 | 63.2% / 63.4% | 13.2 |
| NBA WSH @ OKC | 500 | 109.3 - 128.1 | 109.2 - 127.3 | 94.4% / 91.8% | 12.2 |
| MLB BOS @ NYY | 800 | 3.8 - 4.3 | 3.7 - 4.2 | 55.9% / 55.1% | 4.0 |
| MLB COL @ LAD | 800 | 4.4 - 6.1 | 4.0 - 5.8 | 68.2% / 66.0% | 4.6 |
| League-wide, 16 random matchups x 40 games | | NFL 23.4, NBA 113.6, MLB 4.6 points per team | | | |

Screenshots were taken and looked at (light and dark): signed-out header, signed-in header, My bets, chat with mentions, battle open / spectator / live (NFL, NBA, MLB) / final, battle lobby, leaderboard, profile. Fixes made after looking: win-probability labels hidden when a side is under 14%, play-by-play alignment, a stale @-suggestion after sending, coin icon size, iPhone zoom on small fields (all form fields are 16 px now), a focus bug where a live-score refresh could blur the sign-in form.

## Budget

Unchanged: 32 runs/day, `timeout-minutes: 2`, worst case **1,984 min** in a 31-day month (`tools/budget.py` OK). The social work starts no Supabase call after `LS_DEADLINE + 3 s`, uploads are skipped after the deadline, and each call has a 6 to 12 s timeout, so a hanging Supabase can add at most a few seconds to a run that already hit the deadline; the 2-minute cap bounds billing either way.

## Not tested (please read)

* **A real hosted Supabase project** was not available: hosted PostgREST/Kong, the real GoTrue auth service, the dashboard steps in `supabase/README-setup.md`, and the new `sb_publishable_` / `sb_secret_` key formats (the bot sends `sb_` keys only in the `apikey` header, as documented by Supabase; legacy JWT keys were tested).
* **Supabase Realtime** (instant chat) could not run locally; only the 4-second polling fallback was tested. The realtime code path (channel on `chat_messages` and `mentions`, added to the `supabase_realtime` publication by `setup.sql`) is untested.
* **Supabase's managed pg_cron**: tested with the real pg_cron extension on PostgreSQL 16 (Supabase runs PostgreSQL 15/17 with the same extension). If pg_cron is off, battles still settle when anyone opens them and the daily reset runs on every bot run and page load.
* **Email confirmation flow** (it is meant to be switched off), password reset (not offered), sign-up rate limits.
* **iPhone Safari**: layout tested in Chromium at 400 px with an iPhone user agent only; home-screen app storage of the sign-in session is from documented behaviour.
* **The GitHub Actions run** with the new secrets (same as before: never run on GitHub from here).
* Concurrency was tested by design (row locks, unique constraints, an advisory lock for the daily reset) and with sequential calls; no load test with many simultaneous players.
* Live-bet prices are computed by the page and only loosely checked by the server (live window + a +400 cap): a determined cheater could pick favourable live prices. Pregame prices are fully server-side.


---

# Update: deeper battle rosters + injuries (data layer only)

**Done and tested (`python3 tools/simdata_test.py`, offline, mocked ESPN payloads):**
* `engine/simdata.py` now keeps 9 players per NFL team (QB1, RB3, WR/TE5), 9 per NBA team and 9 hitters + 1 starting pitcher per MLB team (was 4 / 5 / 4), so `data/sim.json` and the `sim_players` rows carry 8+ players per team.
* It reads each league's ESPN injury feed (one extra request per league per daily refresh). Out / injured reserve / suspended / doubtful players are left out; "questionable" players stay with `stats.q = 1`. Ranks (`rk`) are assigned after that filter, so the existing battle props automatically use the healthy starters.
* Additive and backward compatible: the SQL only reads roles/ranks it already knew, so extra players are ignored until the SQL uses them.

**(Superseded by "Update 3 (final)" below: everything in this list was later built and tested.)**
* ~~`supabase/setup.sql` (`battle_markets`, `sim_nfl/nba/mlb`) still offers the same props and simulates the same key players. Props for the extra players, typical lines (e.g. receptions, anytime TD, rebounds/assists/3PM, HR/RBI), their simulation and grading, are not written.
* The SGP option in the battle slip (UI) is not written.
* No Postgres/PostgREST in the environment this update was made in, so `tools/localstack/run_all.sh` was **not** re-run. The live ESPN requests for the new boards/injury feed were not exercised either (only mocked).


---

# Update 3 (final): five-sport Battles, FanDuel-style markets, Same Game Parlay

Everything is in the single `supabase/setup.sql`; `setup_extras.sql` no longer exists. It was **run** against the local stack (Postgres 16 + pg_cron + PostgREST + a GoTrue mock), twice in a row, and also on top of the first version (upgrade_test).

Results (bash tools/localstack/run_all.sh): api_test 110/110, sim_test 42/42, cron_test 3/3, market_test 90/90 (every prop of NFL, NBA, MLB, CFB, CBB prices, simulates and grades the same in SQL and an independent Python grader; player lines add up to team scores; sim means within tolerance of the priced means), battle2_test 56/56 (both formats x 5 sports, ladders, payouts, freeze, King x 5), fit_sgp (correlated legs priced shorter than naive; fit error 0.055 vs 0.185 independent), upgrade_test 18/18, simdata_test offline 23/23, bot_test 11/11 (refresh.py twice; 56.8 s with Supabase on, 48 s without, deadline 70 s), ui_social_test 67/67 (browser at 400 px: 5 sports, SGP create/accept, ladders, See all, Anytime TD, betslip pull-down and place, never stuck), selftest 21/21, ui_test 21/21. The full run_all.sh passed end to end. Bot budget unchanged at 1,984 min/month.

Not tested / honest limits:
* Not run on a real hosted Supabase project (Realtime, hosted pg_cron, GoTrue, rate limits). Only the local stand-in.
* Live ESPN: rosters and injuries were pulled for one team per league with `tools/simdata_test.py --real`; the college football injury feed returned nothing at the time, so college injuries are untested against real data and the page shows none for those teams.
* College player props appear only where ESPN gives 8+ players; others get lines only.
* SGP correlation loadings are fitted to this simulator, not to real games. Anytime TD rates and MLB scaling are heuristics.
* Offseason: NBA and college basketball use last season's averages.


---

# Update 4: animated Battle scene (tested 2026-10-03)

**Built:** a small SVG scene (field / court / diamond) above the play-by-play that animates each play for 1 to 2 seconds: NFL and college football (touchdown run-in with confetti, first-down line sweep, penalty flag with the call, field goal over the uprights, sack burst, interception / fumble, punt); NBA and college basketball (three-pointer arc, dunk, bucket, free throws, foul whistle, steal, block, scoring run banner); MLB (single / double / triple with the runner, home run over the fence, safe / out at the base, stolen base, strikeout, walk, run scoring, walk-off). The scoreboard digits bump on every score. Animations are CSS/SVG (Web Animations API), no libraries; with "reduce motion" on, only the banner shows. Files: `src/battle_anim.js`, `src/battle_anim.css`.

**Simulator:** `ls_private.sprinkle()` adds "color" plays (first downs, flags, sacks; fouls, steals, blocks, runs; strikeouts, walks, stolen bases, safe / out calls) after the game is simulated. They carry `hs = as = -1`, so they never change a score, a stat line, a price or a grade. Also fixed: college basketball games with no player data now produce scoring plays (they used to show none), and `ls_private.phi` is clamped so a very lopsided late score can no longer abort `start_battle` with "value out of range: underflow".

**Speed:** the whole game is revealed over about 3 minutes (about 60 times faster than a real game). The reveal clock is the server's (spectators and players see the same thing), so there is no per-user speed control; the page instead condenses animations when plays arrive faster than they can be shown (small plays are dropped first, then everything except the latest play and the final).

**Tests (`tools/localstack/anim_test.py`, part of `run_all.sh`):** 30 simulated games per sport: every color-play type appears, none carries a score, nothing else was added or lost (20/20); five sports in a 400 px browser with the server clock run 6x faster (animations play, queue never backs up, no horizontal scroll, every color-play kind is understood by the page); one real-time basketball game (about 3 minutes): 82 animations, 1 dropped, foul / steal / block / run / three / dunk all played; no JavaScript errors. 52/53 on the strict run; the one miss was an expectation that small plays survive the 6x stress run, which the queue is designed to drop (expectation relaxed). Everything else still passes: api 110, sim 42, cron 3, market 90, battle2 56, upgrade 18, simdata 23, bot 11, social browser 67, fit_sgp, selftest.

**Not tested:** audio (no sound effects were built), an iPhone, animation smoothness on a slow phone, reduced-motion on a real device (the code path exists; only the desktop media query was exercised).


---

# Update 5: who-is-winning bar, finish flash, share cards (tested 2026-10-03)

**Built (page only, no SQL change):** a live *Who is winning* bar (two slips compared: busted slip = out; otherwise chance the open legs hold x payout), a full-screen finish flash (winner crowned and loser dimmed; gold "Dead heat" for a split), and `src/share.js`: 1080x1350 PNG cards drawn on a canvas for the rivalry result, the tie, badges and winning slips, with a share sheet (system share sheet; X, Facebook and Reddit pre-filled posts; Instagram, Snapchat and Twitch via save-image + copy-text + open the site). Share buttons: finish flash and result banner, My bets, profile (badges and won slips), Board (your own badges from yesterday), battle parlays and spectator bets, and the practice-bank bets.

**Tests (`tools/localstack/share_test.py`, part of `run_all.sh`):** 36 checks in a 400 px browser against the local stack: bar adds to 100% and names a leader; flash for a win (one crowned winner, one dimmed loser), for a tie, and none for a battle that ended long ago; cards are real 1080x1350 PNGs (rivalry, tie, slip, two badges; all viewed by eye); X, Reddit and Facebook open pre-filled windows; Save image downloads; the Instagram flow saves the card and says honestly that the last step is manual; no horizontal scroll; no JavaScript errors. `ui_social_test` (68/68) and `selftest` (21/21) still pass; `anim_test` was re-run (52/52 real checks; its one console-error check only trips on the sandbox blocking the live ESPN scoreboard fetch, which the test now ignores).

**Not tested / honest limits:** the system share sheet and sharing a file into Instagram/Snapchat/Twitch (needs a real phone; headless Chrome has no share sheet); Facebook's sharer page and X/Reddit pre-fill were only checked up to the window opening (Facebook sent a logged-out browser to its login page); whether a given app accepts a pasted image from the clipboard; emoji on the badge cards depend on the device's emoji font (the test machine rendered them correctly). Links point at this site's address, so they only work once the site is hosted at a public URL.

---

# Update: battle v2 (NOT run against a database)
Written: `supabase/patch_battle_v2.sql` (also merged into `setup.sql`): `max_legs`, `duration_min`, `both_locked_at` columns; `create_battle(..., p_max_legs, p_minutes)`; `unlock_battle_parlay`; lock now starts a 5-second countdown, `battle_tick` starts the game; `boost_json` makes battle prices 10% better. Structural check only (balanced `$$` and parentheses). Browser: 19/21 checks (the 2 failures are the ESPN live checks, which need internet and fail identically on the original upload).
NOT done: first-half / halftime markets, total-points and spread sliders, extra college SGP props (yards, rushing, points, assists), calendar rework (yesterday's safe picks and whether they won), sportsbook lines inside battles.
