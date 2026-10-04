#!/usr/bin/env python3
"""pg_cron really runs the jobs from setup.sql: a battle nobody accepts is cancelled + refunded by the cron job alone (no page, no bot)."""
import sys, os, time, uuid, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_test import signup, sql, clock, bal, check, RES
clock(None)
tag = uuid.uuid4().hex[:5]
U = signup(f"cron{tag}@x.test", "secret1", "Cron_" + tag)
bid = U.ok("create_battle", p_sport="nfl", p_home="KC", p_away="BUF", p_wager=77, p_side="home")["id"]
check("wager escrowed", bal(U) == 923)
clock((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=31)).isoformat())
t0 = time.time(); st = None
while time.time() - t0 < 75:
    st = sql("select status from public.battles where id = %s", (bid,), one=True)
    if st == "cancelled": break
    time.sleep(3)
clock(None)
check(f"pg_cron job ls-battle-tick cancelled the expired battle by itself ({time.time() - t0:.0f}s)", st == "cancelled" and bal(U) == 1000, (st, bal(U)))
runs = sql("select j.jobname, d.status from cron.job_run_details d join cron.job j on j.jobid = d.jobid where d.start_time > now() - interval '5 minutes'")
check("cron runs recorded as succeeded", runs and all(r[1] == "succeeded" for r in runs), runs[:3])
print(f"{sum(1 for r in RES if r[0])}/{len(RES)} cron checks passed"); sys.exit(0 if all(r[0] for r in RES) else 1)
