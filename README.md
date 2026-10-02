# Line Scout (runs by itself, no Claude needed)

Line Scout is a **practice** sports-betting scouting page: lines, a statistical model, injury context, "Safe 2/4/8" slips, a pick of the day, live games, and a play-money bankroll. It covers NFL, college football, NBA, college basketball, WNBA and MLB.

It runs forever on free services:

```
GitHub Actions bot (free)          static host (free)               your iPhone
every ~45 min: pulls ESPN,   -->   serves index.html + data/   -->  Safari / home-screen icon
re-learns, grades itself,          (plain files, nothing to run)    polls ESPN live for scores
commits data/ + store/
```

* The **page** (`index.html`) never changes unless you edit `src/`. It loads `data/slate.json`, `data/learn.json`, `data/pastp.json` and `data/meta.json` when it opens and checks again every 4 minutes.
* The **bot** (`refresh.py`, run by `.github/workflows/refresh.yml`) only rewrites `data/` and `store/`.
* The "AI" is a **statistical model** (walk-forward team ratings blended with the betting lines). There is no language model in the loop, so there is nothing that can run out of credits.
* Your bankroll, bets and ledger live **only in your phone's browser** (localStorage). Clearing Safari data for the site erases them.

> **Practice money only.** Line Scout does not place bets and cannot fill in a sportsbook slip for you. If you bet real money anywhere, you must be of legal age where you are (21+ in most US states) and the activity must be legal where you live. Odds and models are not advice and not a guarantee. If gambling stops being fun, call 1-800-GAMBLER (US) or your local helpline.

---

## 1. Decide: public or private repository

| | **Public repo** (recommended) | **Private repo** |
|---|---|---|
| GitHub Actions minutes | **unlimited and free** | 2,000 min/month on GitHub Free (this bundle is scheduled to use almost all of it, see section 6) |
| GitHub Pages hosting | free | **not available on GitHub Free** (needs a paid plan) |
| Where to host | GitHub Pages (simplest) | Cloudflare Pages connected to the repo |
| Anything secret in the repo? | No: only public sports data. Your bets never leave your phone. | |

The schedule in this bundle was sized for the **private-repo 2,000-minute budget**, as you asked. It is also perfectly fine on a public repo (where you could run it much more often; see "Change the schedule").

## 2. One-time setup (about 15 minutes)

Uploading a folder is **much easier on a computer** than on a phone (a library or friend's computer is fine). Everything after step 4 can be done on the iPhone.

1. **Create a GitHub account** (github.com) and **a new repository**: the **+** at the top right, then "New repository". Name it e.g. `line-scout`. Choose Public or Private (section 1). Do not tick "add README".
2. **Upload this folder's contents.** On the empty repo page click "uploading an existing file", then drag **everything inside the `site` folder** (including the hidden `.github` folder and the `.nojekyll`/`.gitignore` files) into the browser, wait for the upload to finish, and press **Commit changes**.
   * Check: your repo must show `index.html`, `refresh.py`, `data/`, `engine/`, `store/`, and a `.github` folder.
   * If `.github` did not upload (hidden folders sometimes get skipped): in the repo click **Add file, Create new file**, type the name `.github/workflows/refresh.yml` (typing the slashes creates the folders), paste the text of `refresh.yml` from this bundle, and commit.
   * If you have git installed, the same thing is: `git init && git add -A && git commit -m start && git remote add origin <your repo url> && git push -u origin main`.
3. **Turn on Actions.** Open the **Actions** tab. If GitHub asks, press "I understand my workflows, go ahead and enable them". You should see a workflow called **Refresh data** in the left list.
4. **Run it once by hand.** Actions tab, "Refresh data", **Run workflow** (green button), Run workflow. After 1 to 2 minutes there is a green check mark. It commits fresh files to `data/` (this also proves the bot may write to your repo; if it fails with "permission denied", go to Settings, Actions, General, "Workflow permissions" and choose **Read and write permissions**, then run again).
5. **Publish the site** (pick one):
   * **GitHub Pages (public repo):** Settings, **Pages**, "Build and deployment": Source = **Deploy from a branch**, Branch = `main`, folder `/ (root)`, **Save**. After about a minute the page shows your address: `https://YOUR-NAME.github.io/line-scout/`. GitHub's own "pages build and deployment" runs are free and unmetered on public repos. (`.nojekyll` is already included so the files are served as they are.)
   * **Cloudflare Pages (works with private repos):** at dash.cloudflare.com, Workers & Pages, **Create**, **Pages**, **Connect to Git**, choose the repo. Framework preset **None**, Build command **empty**, Build output directory **`/`**. Deploy. Your address will be `https://line-scout-xxx.pages.dev`. It uses none of your GitHub minutes. **Read "Hosting with a deploy cap" below.** Button names change now and then; the idea is: "static site, no build, publish the repo root". `netlify.toml` is included for the same purpose on Netlify, but see the warning below.
6. **Put it on your iPhone.** Open the address in **Safari**, tap the Share button, **Add to Home Screen**. It opens full screen like an app. Use that home-screen icon from now on: iPhone keeps the home-screen app's saved data (your bankroll and bets) **separate from Safari's**, and Safari erases a plain website's saved data after about 7 days without a visit, while a home-screen app is exempt. The first line of the page says "Data updated ...". If it says "Could not load the data", step 4 has not finished or did not succeed (see Troubleshooting).

### Hosting with a deploy cap (important for private repos)

Every time the bot commits, a connected host starts a deploy. Free tiers cap that:

* **Cloudflare Pages Free: 500 builds/month** (about 16 per day). The bot can publish up to 32 times a day, so set the optional throttle: repo **Settings, Secrets and variables, Actions, Variables, New repository variable**, name `LS_MIN_PUBLISH_GAP_MIN`, value `100`. The bot still runs on schedule but publishes at most once per 100 minutes (about 13 a day, about 400 a month). Runs that are skipped by the throttle end after a few seconds.
* **Netlify Free** moved to a credit system where a production deploy costs 15 of 300 monthly credits (about 20 deploys a month). That is **not enough** for this bot. Do not use Netlify unless you only publish rarely.
* **GitHub Pages on a public repo** has no such cap. (As far as I know GitHub Pages is not offered on the Free plan for private repos. Check GitHub's current plan page if that matters to you.)

## 3. What runs when

All times are the bot's UTC clock; the ET column is summer time (EDT). In winter every ET time is one hour earlier on the clock.

| Runs per day | UTC | ET (summer) | Purpose |
|---|---|---|---|
| 5 | 05:47, 07:47, 09:47, 11:47, 13:47 | 1:47, 3:47, 5:47, 7:47, 9:47 AM | grade last night's finals, take in results, build the next slate, morning injury news |
| 1 | 15:37 | 11:37 AM | late-morning lines |
| 26 | every 30 min, 16:07 to 04:37 | every 30 min, 12:07 PM to 12:37 AM | US afternoon/evening: lines, injuries and live games move |
| **32** | | | |

GitHub may start a scheduled run several minutes late, or occasionally skip one, when its queue is busy. Neither matters here.

Each run: reads ESPN scoreboards and odds for every league, adds newly finished games to `store/`, re-fits the ratings, builds the slate (the games in the next 48 hours, 72 for the NFL, plus anything live or finished in the last 30 hours; at most 24 new cards), writes the files, and commits them. A league that fails keeps its last good data and is flagged in `data/meta.json` (the page shows it). If everything is down, nothing is overwritten.

## 4. Change the schedule

Edit `.github/workflows/refresh.yml` (pencil icon on GitHub), change the `cron:` lines, commit. Times are UTC. GitHub does not run schedules more often than every 5 minutes. Then check the budget:

```
python tools/budget.py              # counts runs/day and the worst-case minutes in a 31-day month, says OK / TOO MANY
python tools/budget.py --suggest 1  # ready-made schedule if your runs bill 1 minute (64 runs/day)
```

To pause everything: Actions tab, Refresh data, the "..." menu, **Disable workflow**.

## 5. Minutes budget (the arithmetic)

GitHub Free gives **2,000 Linux minutes per month** to private repos (1x multiplier). Each job is **rounded up to whole minutes**. The target is **1,990** minutes in a 31-day month, worst case.

| | |
|---|---|
| Full `python refresh.py`, measured | typical 25 to 50 s, fastest 17 s; slowest 65 s on a cold first run (one earlier trial, before request timeouts were tightened, took 116 s because of ESPN stalls) |
| + checkout, setup-python, commit and push (estimate) | about 30 s |
| Typical job | 55 to 80 s, **billed 2 minutes** |
| Hard cap in the workflow | `timeout-minutes: 2`, so a run can never bill more than 2 minutes; `LS_DEADLINE: 70` makes the script stop starting ESPN requests after 70 s and still write valid files |
| Runs per day | floor(1990 / 31 / 2) = **32** |
| Worst case in a 31-day month | 32 runs x 2 min x 31 days = **1,984 minutes** (30-day month: 1,920; February: 1,792) |

If the first days show "time limit reached" in the top bar or in `data/meta.json` (ESPN or the runner being slow so runs hit the 70-second network deadline), give each run more room instead: `python tools/budget.py --suggest 3` (21 runs/day, 3 billed minutes each, worst case 1,953) and set `timeout-minutes: 3` and `LS_DEADLINE: "130"`.

Because the cap is part of the math, the worst case holds even if ESPN is slow or a run hangs. If your **Settings, Billing, Usage** page later shows the average run bills 1 minute, switch to the 64-runs-per-day block from `tools/budget.py --suggest 1` (and set `timeout-minutes: 1`).

A **public repo has unlimited free minutes**, so there you can run as often as every 5 minutes (GitHub's minimum) if you like. The scoreboards only change so fast; every 10 to 15 minutes in the evening is plenty.

Skipping runs: when nothing is going on (offseason, empty slate) a run is naturally short because there is nothing to build, but billing is still per whole minute, so the budget math assumes the full run.

## 6. How it learns

* **Store** (`store/`): about 13,000 finished games from all six leagues (1.5 MB), plus closing lines, extended every run from the ESPN scoreboards. Nothing is fetched twice. Per-player game logs are fetched fresh on each run and not kept.
* **Ratings model**: every finished game nudges each team's offense and defense rating (like an Elo for scoring), one game at a time in date order, so the model never sees the future. The learning rate, home edge and off-season carry-over are re-tuned on past results, and the model is blended with the closing line using weights fitted on history (the model always keeps at least 15% so it can disagree with the book). That gives each upcoming game a projected margin, total and win chance, adjusted for injuries, rest and workload.
* **Self-grading**: before kickoff the bot writes its numbers for each upcoming game to `store/predictions.jsonl` (the **first** snapshot per game is kept; later runs never overwrite it, so there are no duplicates and no look-ahead). When the final arrives it grades them: winner pick, spread and total leans against the line, margin and total error, and a Brier score.
* **Feedback**: once a league has **40+ graded games**, the bot fits a "win-chance scale" on its own record, shrinks it toward 1.0 (the fewer games, the less it moves) and **bounds it to 0.85 to 1.15**. It makes the confidence sharper or softer, it never changes who is picked. The graded lean hit rates are added to the backtest lean records (lean types that hit under 52% over 50+ games are switched off by the page). You can read the bot's own record on the page under Track record, "How the model learns", and in `data/meta.json`.
* **Honest expectation**: the closing line is very hard to beat. The model's value is calibrated chances and a clear view of why, not a guaranteed edge.

## 7. Limits and honest notes

* **ESPN endpoints are unofficial.** They can change or disappear. If ESPN changes something, a league may go stale; `data/meta.json` and the page's top bar say so, and the last good data stays on screen.
* **Lines are DraftKings through ESPN**, not live sportsbook odds. There is no way to fill a sportsbook bet slip automatically; the page only builds practice slips (and opens the sportsbook's own page where a link exists).
* **Player props exist only for NFL, WNBA and MLB.** College football, NBA and college basketball are team-level (lines, projections, injuries). If a player-level card cannot be built for a game (no props posted yet, roster feed down), that game still appears as a team-level card.
* **Offseason leagues show nothing** (no crash, just empty). The NFL, NBA and WNBA also have preseason games that are ignored for ratings.
* **Cron can be late**, and GitHub pauses scheduled workflows on **public** repos that have had no activity for 60 days. The bot's own commits count as activity, so this should not happen while it runs.
* **Repo size stays small**: the bot replaces its own previous commit instead of stacking new ones, so git history does not grow. Total repo is about 4 MB.
* The page polls ESPN **directly from your phone** for live scores (ESPN allows this from any web page). Games are polled only from 20 minutes before kickoff until the final. Live view works only while the page is open.
* **Practice bets settle when the page sees the final.** The phone keeps the card of every game that has an open bet, so a bet settles on your next visit even after the game has left the slate (the page must be open for that; nothing settles in the background).
* Boards and chat (from the original Claude version) are not part of this standalone copy.

## 8. What is in the folder

```
index.html            the whole page (rebuilt only when src/ changes: python build_site.py)
data/                 written by the bot: slate.json, learn.json, pastp.json, meta.json
store/                the bot's memory: games_*.jsonl, odds.json, predictions.jsonl, ...
refresh.py            the one command: python refresh.py
engine/               the model and the ESPN code (standard library only, no installs)
src/                  page sources (JS, CSS, template) used by build_site.py
build_site.py         src/ -> index.html   (--check verifies it is current)
tools/                budget.py (minutes math), selftest.py (offline tests), ui_test.py (browser test, optional), seed_legacy.py, make_icons.py, schema_diff.py
.github/workflows/    refresh.yml: the schedule
netlify.toml, .nojekyll, manifest.webmanifest, icons/   hosting and home-screen files
TEST_REPORT.md        what was tested before hand-off
```

Run it yourself on any computer with Python 3.11 or newer: `python refresh.py` (about a minute), then `python -m http.server` and open http://localhost:8000. Offline checks: `python tools/selftest.py`.

Optional settings for `refresh.py` (environment variables): `LS_DEADLINE` (seconds before it stops starting ESPN requests), `LS_MIN_PUBLISH_GAP_MIN` (publish throttle), `LS_ONLY=nfl,mlb` (testing only), `LS_SIMULATE_FAIL=nba` (tests the keep-last-good path), `LS_NOW=2026-10-01T18:00:00Z` (pretend it is that moment).

## 9. Troubleshooting

* **Page says "Could not load the data"**: `data/` is empty or you opened `index.html` as a file. Run the workflow (step 4) and use the web address.
* **Top bar is yellow, "Stale"**: no successful refresh for 6+ hours. Actions tab, look at the last runs. A red run with "permission denied": see step 4. A workflow that never started: check that the `.github/workflows/refresh.yml` file exists and that Actions is enabled; also remember GitHub disables schedules after 60 days of no activity on public repos.
* **A league shows old games**: that league's ESPN feed failed; the page's top bar names it. It retries on the next run.
* **Hosting did not update**: Cloudflare Pages free cap reached (see "Hosting with a deploy cap") or Pages is still building (give it a minute).
* **Bankroll vanished**: the browser data for the site was cleared (Safari, Settings, Advanced, Website Data), or you opened a different address. Bets are stored per address.
