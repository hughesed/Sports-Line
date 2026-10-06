# Turning on accounts, coins, the leaderboard, chat and Battles

**Practice coins only.** Nobody pays anything, there is nothing to buy and coins can never be cashed out. They exist only to keep score.

Without this step the site keeps working exactly as before (phone-only practice bank); the Board, Chat and Battle tabs then say "Sign-in not set up yet".

You need: the GitHub repository of your Line Scout site (already set up from the main README) and a free Supabase account. About 15 minutes. A computer is easiest for step 3 (copying a long file); everything else works on an iPhone.

Button names on Supabase and GitHub move around now and then; the idea of each step stays the same.

## 1. Create a free Supabase project

1. Go to **supabase.com**, tap **Start your project** and sign in (signing in **with GitHub** is easiest).
2. **New project**. Name: `line-scout`. Database password: tap **Generate a password** and save it somewhere (you will probably never need it). Region: the one closest to your players (for the US, an East US region). Plan: **Free**. Tap **Create new project**.
3. Wait about 2 minutes until the project dashboard shows it is ready.

## 2. Run the setup script

1. In your GitHub repository open the file `supabase/setup.sql` and copy all of it (on github.com: the **Copy raw file** button, the two-squares icon above the file).
2. In Supabase: left sidebar, **SQL Editor**, then **New query** (the **+**). Paste everything, tap **Run**.
3. At the bottom you should see `Line Scout setup complete`.
   * If it says something about **pg_cron**: left sidebar, **Database**, **Extensions**, search `pg_cron`, switch it on, then run the script again.
   * Running the script again later is always safe (it only creates what is missing and updates the functions).
   * If Supabase asks whether to run a query with "destructive operations" (the script removes and re-creates its own access rules), confirm: it does not delete any data.

What it creates: player profiles (username, coin balance), a ledger of every coin movement, practice bets on real games, the daily leaderboard and badges, chat, Battles, the access rules (row level security: the app can only read; coins move only through the script's own functions) and two schedules (every minute: battle timeouts and results; every 10 minutes: the midnight reset with badges and the daily top-up).

### Already ran an older setup.sql? Upgrade in one step
Open the current `supabase/setup.sql`, copy all of it, paste it in the SQL Editor and Run (once; repeating is safe). That is the only SQL file; there is no second one. Nothing is lost: accounts, coins, ledger, chat and finished battles stay. Battles that were still waiting for an opponent or for slips are cancelled and their wagers refunded; live battles finish normally. Afterwards run the **Refresh data** workflow once so the bot uploads the new team and player tables (college football/basketball, injuries). New in this version: five sports (NFL, college football, NBA, college basketball, MLB), Parlay or Same Game Parlay format, FanDuel-style markets, frozen rosters and injuries, a King badge per sport.

## 3. Email sign-in settings (important)

Supabase's free built-in email sender only sends a few emails per hour, so confirmation emails would get stuck. Turn confirmation off:

1. Left sidebar, **Authentication**, then **Sign In / Providers** (on some dashboards: **Providers** or **Settings**).
2. **Email** must be **enabled** (it is by default).
3. Switch **Confirm email** **OFF**. Save.
4. Leave **Allow new users to sign up** on.

People then sign up with email + password + a username and can play right away. (There is no "forgot password" email for the same reason; you can delete an account under Authentication, Users, and the player signs up again.)

## 4. Copy two keys into GitHub (you never edit a file)

In Supabase: **Project Settings** (gear icon) and then **API Keys** and **Data API** (or the **Connect** button at the top of the dashboard). You need three values:

| Supabase shows | Looks like | What it is |
|---|---|---|
| Project URL | `https://abcdefghijkl.supabase.co` | public |
| **Publishable key**, or under "Legacy API keys" the **anon public** key | `sb_publishable_...` or a long `eyJ...` text | public by design, goes into the web page |
| **Secret key**, or under "Legacy API keys" the **service_role** key | `sb_secret_...` or a long `eyJ...` text | **SECRET**: only the bot may have it |

In your GitHub repository: **Settings**, **Secrets and variables**, **Actions**.

1. Tab **Variables**, **New repository variable**: name `SUPABASE_URL`, value the Project URL. Add variable.
2. Tab **Variables** again: name `SUPABASE_ANON_KEY`, value the publishable / anon key.
3. Tab **Secrets**, **New repository secret**: name `SUPABASE_SERVICE_KEY`, value the secret / service_role key.

(It is fine to store the first two as secrets instead of variables. The bot refuses to publish a key that looks like a secret one, so a mix-up cannot leak it.)

## 5. Run the bot once

GitHub, **Actions**, **Refresh data**, **Run workflow**. When it finishes (1 to 2 minutes) it has written `data/config.json` (the URL + publishable key), uploaded the battle teams and today's lines to Supabase, and your host publishes the new files a minute later.

Open the site: the top right corner now shows **Sign in**. Tap it, **Create account**: email, password (6+ characters) and a username (3 to 18 letters, numbers or _). New accounts get **1,000 coins**.

`data/meta.json` has a `social` section after every run that says what the bot did (bets settled, uploads) and lists any problems.

## How it works (short)

* **Coins** live on the server, the same on every device. They only move through the setup script's functions: placing a bet, a payout, a battle, a refund, or the **daily top-up** (anyone under 100 coins is topped up to 100 at midnight Eastern time, so nobody is ever locked out).
* **Bets on real games** are priced by the server from the bot's copy of the lines (never by the browser) and **settled by the bot** after the final, from the same ESPN results and box scores the page uses (about every 30 minutes, every 2 hours overnight). Live bets are priced by the page's live model; the server accepts them only while the game is on and caps them at +400.
* **Daily leaderboard**: net coins won or lost on each Eastern-time day (a bet counts on the day it settles). At midnight ET the day is closed and badges are handed out: **🏆 Champion** (biggest winner), **🗑️ Trash can** (biggest loser), **⚡ Most active**, **💬 Conversation** (most @mentions), **👑 King** of NFL / NBA / MLB battles (best rating with 3+ battles) and **🔥 Hot streak** (5 wins in a row, at most once a day). Badges stack.
* **Battles**: two players pick a simulated game between any two teams; both build a parlay from its lines and player props; the database simulates the whole game from the latest ratings and player averages and reveals it play by play over about 3 minutes (future plays cannot be read early). The parlay that pays more takes the pot. Spectators can bet on the game lines and on who wins until the game starts.
* **Chat** is for signed-in players: @mentions with suggestions, small pictures (up to about 120 KB), one message every 2 seconds, 500 characters, delete your own messages. It updates instantly (Supabase Realtime) or, if that is unavailable, every 4 seconds.

## Free plan limits (Supabase Free, as far as I know; check supabase.com/pricing)

* **Pausing**: a free project is paused after about a week without activity. The bot talks to it on every run (32 times a day), which keeps it awake. If you stop the bot for a week, open the Supabase dashboard and press **Restore project**.
* **Database 500 MB**: plenty. Chat pictures are the biggest item (up to 120 KB each); delete old chat rows in the Table Editor if you ever get close. The cron log is cleaned up daily.
* **Auth**: up to 50,000 monthly active users; sign-up/sign-in requests are rate limited per IP address (a crowd signing up from one Wi-Fi at the same minute may have to retry).
* **Realtime**: 200 simultaneous connections and 2 million messages a month on Free; above that, chat falls back to checking every 4 seconds.
* **Bandwidth**: 5 GB a month on Free, far more than this needs.

## If something does not work

* **The page still says "Sign-in not set up yet"**: `data/config.json` in your repo is still empty. Check the two variables in step 4 (exact names), run the workflow again, wait for your host to redeploy, then reload the page.
* **"Database error saving new user"** when signing up: run `setup.sql` again (step 2).
* **Sign-up says "check your email"**: "Confirm email" is still on (step 3).
* **Bets stay "Pending" long after the game**: check that `SUPABASE_SERVICE_KEY` is set (step 4) and look at `social` in `data/meta.json`. Legs on games that never finish (postponed) are refunded 48 hours after the scheduled start.
* **Battles never end**: the cron schedules did not get created (pg_cron off). Turn pg_cron on (step 2) and run the script again; meanwhile a battle also settles when anyone opens it after its end.
