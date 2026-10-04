#!/bin/bash
# DEVELOPER TOOL: every social/battle test against the local Supabase stand-in. Takes about 6 minutes.
#   bash tools/localstack/run_all.sh [screenshot_dir]
set -e
cd "$(dirname "$0")"
SITE="$(cd ../.. && pwd)"; SHOTS="${1:-/tmp/ls_shots}"
bash up.sh
python3 api_test.py        # accounts, RLS / permissions, server bets + settlement, chat, battles, timeouts, badges, leaderboard, profiles
python3 sim_test.py        # simulator realism + lines match the simulator
python3 cron_test.py       # pg_cron alone cancels an expired battle
python3 market_test.py 300 # every prop (~60) prices, simulates, grades; sums add up
python3 battle2_test.py    # SGP format + price, ladders, freeze, payouts, 5 sports, King
python3 fit_sgp.py         # SGP uplift vs full simulations
python3 upgrade_test.py    # re-running the new setup.sql over the first version
python3 ../simdata_test.py # rosters/injuries/data layer (offline)
TMP=$(mktemp -d); cp -a "$SITE/." "$TMP/site"
python3 bot_test.py "$TMP/site"   # refresh.py settles bets on a real finished game from the ESPN box score (runs the bot twice)
rm -rf "$TMP"
bash up.sh
python3 ui_social_test.py "$SITE" "$SHOTS"   # 3 browser players at 400 px: sign-up, bets, chat, a full battle, board, badges, profile
python3 anim_test.py "$SITE" "$SHOTS"   # battle animations: color plays in the simulator + all five sports animated in a 400 px browser (about 5 minutes)
python3 share_test.py "$SITE" "$SHOTS"   # who-is-winning bar, finish flash (win/loss/tie), share cards + X/Facebook/Reddit/Instagram/Snapchat/Twitch flows
