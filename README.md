# Line Scout (runs by itself, no Claude needed)

Line Scout is a **practice** sports-betting scouting page: lines, a statistical model, injury context, "Safe 2/4/8" slips, a pick of the day, live games, and a play-money bankroll. It covers NFL, college football, NBA, college basketball, WNBA and MLB.

Optional (free, see section 10): **accounts with practice coins**, a **daily leaderboard with badges**, **chat** with @mentions, player **profiles**, and **Battles**: simulated NFL / NBA / MLB games between two players with parlays and spectator bets.

> **Practice coins only.** No real money anywhere: nothing to buy, no deposits, no cash-out, no prizes. Coins only keep score.

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
* Without accounts (the default), your bankroll, bets and ledger live **only in your phone's browser** (localStorage). Clearing Safari data for the site erases them.
* With accounts turned on (section 10), coins and bets live on a free **Supabase** server: the same on every device, settled by the bot, and nobody can edit them from a browser.

> **Practice money only.** Line Scout does not place bets and cannot fill in a sportsbook slip for you. If you bet real money anywhere, you must be of legal age where you are (21+ in most US states) and the activity must be legal where you live. Odds and models are not advice and not a guarantee. If gambling stops being fun, call 1-800-GAMBLER (US) or your local helpline.

---

## 1. Decide: public or private repository

| | **Public repo** (recommended) | **Private repo** |
|---|---|---|
| GitHub Actions minutes | **unlimited and free** | 2,000 min/month on GitHub Free (this bundle is scheduled to use almost all of it, see section 6) |
| GitHub Pages hosting | free | **not available on GitHub Free** (needs a paid plan) |
| Where to host | GitHub Pages (simplest) | Cloudflare Pages connected to the repo |
| Anything secret in the repo? | No: only public sports data. Without accounts your bets never leave your phone. With accounts (section 10) the only secret is the Supabase service key, which lives in a GitHub *secret*, never in a file. | |

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
* The boards and chat of the original Claude version are replaced by the Supabase versions in section 10 (accounts, server balance, daily leaderboard, badges, chat, Battles). Without Supabase those tabs say "Sign-in not set up yet".

## 8. What is in the folder

```
index.html            the whole page (rebuilt only when src/ changes: python build_site.py)
data/                 written by the bot: slate.json, learn.json, pastp.json, meta.json, sim.json (battle teams), config.json (public Supabase URL + key, empty until section 10)
store/                the bot's memory: games_*.jsonl, odds.json, predictions.jsonl, ...
refresh.py            the one command: python refresh.py
engine/               the model and the ESPN code (standard library only, no installs); social.py, supa.py, simdata.py = accounts/bets/battles side of the bot
supabase/             setup.sql (paste into Supabase once) and README-setup.md (step by step)
src/                  page sources (JS, CSS, template) used by build_site.py
build_site.py         src/ -> index.html   (--check verifies it is current)
tools/                budget.py (minutes math), selftest.py (offline tests), ui_test.py (browser test, optional), seed_legacy.py, make_icons.py, schema_diff.py
tools/localstack/     developer tests of the social features against a local Supabase stand-in (run_all.sh); not needed to run the site
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
* **Bankroll vanished**: the browser data for the site was cleared (Safari, Settings, Advanced, Website Data), or you opened a different address. Bets are stored per address. (With accounts on, coins are on the server: just sign in again.)
* **Accounts / chat / battles**: see "If something does not work" in `supabase/README-setup.md`.

## 10. Accounts, chat, leaderboard and Battles (optional, free)

**Practice coins only: no real money, nothing to buy, no cash-out.**

Turning this on takes about 15 minutes and costs nothing: **follow `supabase/README-setup.md`**. In short:

1. Create a free project at supabase.com.
2. Paste `supabase/setup.sql` into its SQL Editor and press Run (safe to run again any time).
3. Authentication settings: Email sign-in on, **"Confirm email" OFF** (the free built-in mailer only sends a few emails per hour).
4. In your GitHub repo (Settings, Secrets and variables, Actions) add the variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` (public) and the secret `SUPABASE_SERVICE_KEY`.
5. Run the **Refresh data** workflow once. The bot writes `data/config.json` for the page; you never edit a file.

What you get:

* **Sign in** button top right (email + password + a unique username). Signed in, the corner shows your **coin balance** (tap it for your profile). New accounts get **1,000 coins**; at midnight ET anyone under 100 is **topped up to 100**. Signed-out visitors can browse everything (games, board, battles, profiles) but need to sign in to bet, battle or chat ("Sign in to bet").
* **Practice bets on real games** are placed on the server (it re-prices them from the bot's lines) and **settled by the bot** after the final, using the same grading rules as the page (void when a player does not play, pushes refunded). The phone-only features (safe slips, pick of the day tracking, calendar, recaps) work as before.
* **Board**: today's top 10 winners and losers by net coins (Eastern-time day), yesterday's **🏆 Champion** and **🗑️ Trash can**, and an all-time badge table. Badges (stack, shown ×count on profiles): Champion, Trash can, **⚡ Most active**, **💬 Conversation** (most @mentions), **👑 King** (top battle rating per sport, 3+ battles) and **🔥 Hot streak** (5 wins in a row).
* **Chat** (signed-in): @username suggestions while typing, highlighted mentions, a "mentioned you" marker and badge, small pictures, delete your own messages. Instant via Supabase Realtime, otherwise every 4 seconds.
* **Profiles** (tap any name): coins, today's and all-time net, badges, battle record and rating per sport, recent battles and slips.
* **Battle** tab: create an NFL, college football, NBA, college basketball or MLB game between any two teams with a wager; another player accepts; both build a parlay from that game's lines and player props (100-coin slip each) and lock it; the database simulates the game from the latest ratings and player averages and shows it play by play over about 3 minutes. The slip that pays more takes the pot. Spectators can bet on the lines and on who wins before it starts. Battles not accepted in 30 minutes, or not locked within 15 minutes, are refunded. The game is animated while it plays (touchdowns, first downs and flags; threes, fouls and steals; hits, home runs, safe / out calls and stolen bases, and more) with an animated field, court or diamond and a bouncing scoreboard. It runs about 60 times faster than a real game. To pick up this animation upgrade on an existing Supabase project, paste `supabase/setup.sql` into the SQL Editor again and Run (safe to re-run); the page itself updates when you redeploy `index.html`.
* **Winning bar, finish flash and sharing** (no database change, only the page): a *Who is winning* bar compares the two slips live (a missed leg busts a slip; otherwise it weighs how each open leg is tracking against what the slip pays). When the game ends a full-screen flash shows both players, crowns the winner and dims the loser (a gold "Dead heat" version when the pot is split). **Share result** makes a 1080x1350 picture on the device: a rivalry card (both players, score, the winning parlay leg by leg against the other player's slip) or a tie card. Badges (profile, and your own on the Board's Yesterday list) and winning slips (My bets, profile, battle parlays, spectator bets) have **Share** buttons too. The share sheet offers: **Share...** (phone share sheet: pick any app), **X, Facebook, Reddit** (pre-filled post; the picture goes on your clipboard to paste), and **Instagram, Snapchat, Twitch** (these have no "post from a web page" link, so the card is saved, your text is copied and the site opens: add the picture there). Nothing is uploaded; there is nothing to configure.

How it stays fair: balances, badges and records can only change inside the database functions in `setup.sql`; the tables are read-only for the app (row level security), every coin movement is written to a ledger, emails are never shown, and future plays of a simulated game cannot be read early. The **secret** service key lives only in a GitHub secret and is used only by the bot.

Bot budget: the extra work (settling bets, the daily reset, uploading lines and battle data) runs in the background while the bot waits for ESPN and stops at the same `LS_DEADLINE`, so runs stay inside the 2-minute cap and the 1,984-minute worst case is unchanged. With the publish throttle on (`LS_MIN_PUBLISH_GAP_MIN`), skipped runs also skip this work, so bets settle only on the runs that publish. Measured: see `TEST_REPORT.md`.

Limits: Supabase Free pauses a project after about a week without activity (the bot's runs keep it awake), 500 MB database, sign-up rate limits per IP, 200 realtime connections. Live-bet prices come from the page's live model, so the server can only check them loosely (inside the live window, capped at +400). Simulated games are for fun: the simulator is tuned to realistic scores, not to real outcomes.


### Battle details (one SQL file)
Everything for Battles, including the deeper rosters and the FanDuel-style markets, is in the single `supabase/setup.sql` (there is no second file). Battles cover NFL, college football, NBA, college basketball and MLB. Format is chosen at creation: **Parlay** (multiply the legs) or **Same Game Parlay** (priced with a correlation model, shown next to the naive multiply; correlated legs pay less). Each team's roster (8+ players) and injuries are frozen when the battle is created. College games are simulated at team level; player props appear only for teams where ESPN gives 8+ players. **King** badges are per sport (up to five a day, 3+ battles). In the offseason NBA/college basketball use last season's averages.

Upgrading an existing project: open `supabase/setup.sql`, paste it in the SQL editor and Run once (safe to repeat). Battles still waiting for an opponent or a slip are refunded; live ones finish normally. Then run the Refresh workflow once so the bot uploads the new team tables.


### Battle teams (changed)
The person who creates a battle picks the team they back. The opponent no longer chooses: accepting a battle always gives them the other team (the database enforces it, so the same team cannot be picked). After the accept, both build and lock their parlays as before. If you already ran `supabase/setup.sql`, run `supabase/patch_accept_battle.sql` once to update the live function. It has not been run against a real database; `tools/localstack/run_all.sh` has not been re-run for this change.

### Sportsbook odds (new, optional)
Add a GitHub secret `ODDS_API_KEY` (a SportsGameOdds key). The bot then writes `data/odds.json` (each book's own spread, moneyline, total, player props and bet links) at most every `ODDS_MIN_GAP_MIN` minutes (default 120) to protect the free plan. The pages do not read this file yet.

### Battle v2 (run `supabase/patch_battle_v2.sql` once)
Creator chooses parlay size (4, 8, 12 or unlimited) and game length (2 to 8 minutes, standard 4). The creator's backed team is pre-picked as the moneyline leg (changeable), and each player can Unlock until both are locked for 5 seconds, after which the game starts. Battle prices are 10% more favorable (applied when the battle is created; Same Game Parlay payouts get the same boost). The patch has not been run against a real database; run `tools/localstack/run_all.sh` before relying on it. Old battles keep working (they default to 6 legs, 4 minutes).
Screens: bottom-nav counts (pending battles, new chat comments), recent battles show 6 with a More button, chat window is larger and the footer text is hidden on the Chat tab.

### Look update: logo team pickers, profile pictures, board
Battle form: team dropdowns with logos (NFL/NBA/MLB logos come from ESPN; college teams show a colored badge). Board: avatars on every username, and "Yesterday's champions" as colored rows. Profile pictures need `supabase/patch_avatars.sql` run once in Supabase (adds a picture column and two small functions); without it everyone just shows a colored initial. Photos are shrunk to 96x96 in the phone before upload. Open your own profile and tap the camera to change yours. Not yet run against a real database.

### Battle v6: play the computer (run `supabase/patch_battle_v6.sql` once, after the v2 to v5 patches)
* **Battle tab, "Play against: Computer"**: pick your sport, team, format, legs allowed, game length and wager (max 1,000), then **Play the computer**. You also pick the computer's team, or leave it on **Random** (the default: an even matchup, with player props when your team has them). It builds its parlay and locks it at once. You build yours and lock; the game starts 5 seconds later, exactly like a battle against a player. Its slip stays hidden until the game starts.
* **How it picks:** every leg on the board (moneyline, spread, total, halftime moneyline in Parlay battles, player over/unders and X+ rungs) is priced against the model, corrected by what it has learned, and scored for value. It takes the best legs inside a target probability band, mixes team legs with player props from both teams, never uses more than 2 legs on one player or 3 on one stat, keeps its team-result picks on one side and skips questionable players. **At least 4 legs; with Unlimited legs at most 14**; with 4, 8 or 12 legs allowed it stays inside that cap.
* **How it learns** (after every settled battle, no setup): (1) per leg type (home ML, away spread, total over, QB pass-yards over, rung ladders, ...) it keeps hits against what the model expected, from both slips of every battle, and nudges its picks toward leg types that beat the model (shrunk toward 1.0, bounded 0.80 to 1.25). (2) It has three styles (steady: many safe legs; balanced; sharp: fewer, bolder legs) and chooses between them like a bandit: styles that beat players get picked more, with some exploration. Memory lives in `cpu_brain`, `cpu_arms`, `cpu_battles` (not readable by the app); `cpu_status()` feeds the one-line summary on the form.
* **Practice rules against the computer:** coins (including the 10% win bonus) and your win/loss record count; Elo, the daily Board, streaks and KING badges do not, so the computer can never take a crown and nobody can farm them. The computer matches your wager from the house.
* Creates one account, `SportsLineCPU` (nobody can sign in to it). Not run against a real database (no PostgreSQL where this was written): run it once, then play one battle of each format to confirm.

### Battle v4: the challenger picks the opposing team (run `supabase/patch_battle_v4.sql` once)
* **Creating a battle** now asks only for the sport, **your team**, the format, legs allowed, game length and wager. You then wait for a challenger. The old "away team" and "You back" choices are gone (your team is the home team).
* **Accepting** a battle now means picking the opposing team from a dropdown (the creator's team is not in it). The lines, rosters and injuries are frozen at that moment, and the wager is escrowed from the challenger then. Spectator bets open once someone has accepted. Battles created before this patch still work the old way.
* **Pop-up:** if you start a battle and go to another screen, a "You have a match!" pop-up appears wherever you are in the app as soon as someone accepts, with **Go to battle** and **Later** buttons (plus a short vibration and whistle if sound is on). The page checks every 5 seconds while your battle is waiting and every 30 seconds otherwise; it does not run while the tab is hidden, and it checks right away when you come back to it.
* **Unlimited-legs Same Game Parlay:** every option is selectable. You can take several picks from one market (for example a 200+ and a 250+ rung for the same player, or the spread, moneyline and total together). Picks that can never both happen (both moneylines, over and under, an over above an under) swap each other out in the page, and the database refuses them. The price is recalculated by the simulator for the whole slip, with several thresholds on one player stat priced as a band. Parlay battles and Same Game Parlays with 4, 8 or 12 legs still allow one pick per market.
* Order of the SQL files on an existing project: `setup.sql`, `patch_accept_battle.sql`, `patch_battle_v2.sql`, `patch_battle_v3.sql`, `patch_avatars.sql`, `patch_battle_v4.sql`, `patch_battle_v5.sql`, `patch_battle_v6.sql`. The patches are safe to run twice. Open battles that are still waiting for an opponent when you run it keep the old rules.
* Tested against a local PostgreSQL 16 (create, accept, wrong-team refusals, SGP pricing and conflict checks, lock, start, settle) and in a browser with two players. Not yet run against your real Supabase project. `tools/localstack/*_test.py` still call the old `create_battle` / `accept_battle` arguments and need updating before `run_all.sh` is used again.
