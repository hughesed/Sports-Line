#!/usr/bin/env python3
"""Upgrade path: a Supabase project that already ran the FIRST setup.sql (fixtures/setup_v1.sql) and has players, coins and battles in every state
re-runs the NEW supabase/setup.sql.  Checks that nothing is lost, waiting battles are refunded, live battles still settle, and the new features work.
Uses its own throw-away database (lsup) in the local Postgres from up.sh.   python3 upgrade_test.py <site_dir>"""
import os, sys, json, subprocess, uuid, datetime
import psycopg2
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", ".."))
PSQL = ["psql", "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-q", "-v", "ON_ERROR_STOP=1"]
RES = []
def check(name, cond, extra=""):
    RES.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + ((" - " + str(extra)[:240]) if extra not in ("", None) else ""), flush=True)
def run_file(db, path):
    r = subprocess.run(PSQL + ["-d", db, "-f", path], capture_output=True, text=True)
    if r.returncode: print(r.stderr[-1500:])
    return r.returncode == 0
adm = psycopg2.connect("host=127.0.0.1 port=54329 dbname=postgres user=postgres"); adm.autocommit = True
cur = adm.cursor(); cur.execute("select pg_terminate_backend(pid) from pg_stat_activity where datname='lsup'"); cur.execute("drop database if exists lsup"); cur.execute("create database lsup")
# pg_cron lives in the 'ls' database only (cron.database_name); the old and new scripts guard that part, so run without it here
import tempfile, re
def nocron(src):
    """pg_cron can only be installed in the 'ls' database of the test server, so this throw-away database gets a stand-in cron.schedule (cron_test.py covers the real one)"""
    t = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False); t.write(re.sub(r"create extension if not exists pg_cron;", "", open(src).read())); t.close(); return t.name
check("stub project + the FIRST setup.sql run cleanly", run_file("lsup", os.path.join(HERE, "supabase_stub.sql")) and
      run_file("lsup", os.path.join(HERE, "fixtures", "cron_stub.sql")) and run_file("lsup", nocron(os.path.join(HERE, "fixtures", "setup_v1.sql"))))
c = psycopg2.connect("host=127.0.0.1 port=54329 dbname=lsup user=postgres"); c.autocommit = True; q = c.cursor()
def sql(s, a=None, one=False):
    q.execute(s, a)
    try: r = q.fetchall()
    except Exception: r = None
    return (r[0][0] if r else None) if one else r
def as_user(uid): sql("select set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": uid, "role": "authenticated"}),))
def clock(ts): sql("update ls_private.settings set fake_now = %s where id = 1", (ts,))

# old-format battle data (the first version had 3 sports and no injury columns)
for ab, nm in (("KC", "Kansas City Chiefs"), ("BUF", "Buffalo Bills"), ("DET", "Detroit Lions"), ("GB", "Green Bay Packers")):
    sql("insert into public.sim_teams(sport,abbr,name,short,color,o,d,gp,lg_avg,hfa) values ('nfl',%s,%s,%s,'#123456',1.0,-0.5,4,23,1.5)", (ab, nm, nm.split()[-1]))
    sql("insert into public.sim_players(sport,pid,team,name,pos,role,rk,stats) values ('nfl',%s,%s,%s,'QB','QB',1,%s)", (ab + "q", ab, ab + " QB", json.dumps({"py": 250, "ptd": 1.6, "ry": 8, "rtd": 0.1, "att": 35, "gp": 4})))
    for i, (r, st) in enumerate((("RB", {"ry": 70, "car": 16, "rtd": 0.5, "rec": 3, "ly": 20, "rctd": 0.1}), ("WR", {"rec": 6, "ly": 80, "rctd": 0.5}), ("WR", {"rec": 4, "ly": 55, "rctd": 0.3})), 1):
        sql("insert into public.sim_players(sport,pid,team,name,pos,role,rk,stats) values ('nfl',%s,%s,%s,%s,%s,%s,%s)", (f"{ab}{i}", ab, f"{ab} {r}{i}", r, r, i if r == "WR" else 1, json.dumps(st)))
U = {}
for n in "ABCD":
    uid = str(uuid.uuid4()); U[n] = uid
    sql("insert into auth.users(id, email, raw_user_meta_data) values (%s, %s, %s)", (uid, f"{n}{uid[:4]}@x.test", json.dumps({"username": f"User{n}_{uid[:4]}"})))
bal = lambda n: float(sql("select balance from public.profiles where id = %s", (U[n],), one=True))
check("4 players created with 1,000 coins by the old trigger", all(bal(n) == 1000 for n in "ABCD"))
as_user(U["A"]); live = sql("select (public.create_battle('nfl','KC','BUF',50,'home') ->> 'id')::bigint", one=True)
as_user(U["B"]); sql("select public.accept_battle(%s, 'away')", (live,))
mk = sql("select markets from public.battles where id = %s", (live,), one=True)
check("old-format markets stored (no player model, no ladders)", "pm" not in mk and all("rungs" not in p for p in mk["props"]), list(mk))
pa = [t for t in ("ml:home", f"p:{mk['props'][0]['pid']}:{mk['props'][0]['stat']}:over")]
as_user(U["A"]); sql("select public.set_battle_parlay(%s, %s)", (live, json.dumps(pa))); sql("select public.lock_battle_parlay(%s)", (live,))
as_user(U["B"]); sql("select public.set_battle_parlay(%s, %s)", (live, json.dumps(["ml:away", "tot:under"]))); sql("select public.lock_battle_parlay(%s)", (live,))
check("an old battle is LIVE at upgrade time", sql("select status from public.battles where id = %s", (live,), one=True) == "live")
as_user(U["C"]); waiting = sql("select (public.create_battle('nfl','DET','GB',30,'away') ->> 'id')::bigint", one=True)
as_user(U["D"]); building = sql("select (public.create_battle('nfl','GB','DET',20,'home') ->> 'id')::bigint", one=True)
as_user(U["C"]); sql("select public.accept_battle(%s, 'away')", (building,))
as_user(U["C"]); sql("select public.set_battle_parlay(%s, %s)", (building, json.dumps(["ml:home"]))); sql("select public.lock_battle_parlay(%s)", (building,))
before = {n: bal(n) for n in "ABCD"}
check("coins are held in escrow for the waiting and building battles", before["C"] < 1000 and before["D"] < 1000, before)
profiles = sql("select id, username, balance from public.profiles order by username")
ledger = sql("select count(*) from public.ledger", one=True)

# ------------------------------------------------------------------ the upgrade
new_sql = nocron(os.path.join(SITE, "supabase", "setup.sql")); ok1 = run_file("lsup", new_sql); ok2 = run_file("lsup", new_sql)
check("the NEW setup.sql runs on top of the old project, twice, without errors", ok1 and ok2)
check("profiles and balances unchanged by the upgrade (except refunds below)", all(abs(float(r[2]) - before[n]) < 0.01 or n in "CD" for r in sql("select id, username, balance from public.profiles") for n in "ABCD" if str(r[0]) == U[n]))
check("ledger rows are kept", sql("select count(*) from public.ledger", one=True) >= ledger)
check("new columns exist (battles.fmt, parlay quote, injuries)", sql("select count(*) from information_schema.columns where (table_name='battles' and column_name='fmt') or (table_name='battle_parlays' and column_name='quote') or (table_name='sim_teams' and column_name='inj') or (table_name='sim_players' and column_name in ('inj','note'))", one=True) == 5)
check("only one create_battle remains (old signature dropped)", sql("select count(*) from pg_proc where proname = 'create_battle'", one=True) == 1)
st = {r[0]: r[1] for r in sql("select id, status from public.battles")}
check("the live battle was left alone", st[live] == "live", st)
check("the waiting and building battles were cancelled", st[waiting] == "cancelled" and st[building] == "cancelled", st)
check("...and their wagers refunded", abs(bal("C") - 1000) < 0.01 and abs(bal("D") - 1000) < 0.01, (bal("C"), bal("D")))
# the live battle finishes under the new code
started = sql("select started_at from public.battles where id = %s", (live,), one=True)
clock((started + datetime.timedelta(seconds=200)).isoformat()); sql("select public.battle_tick()"); clock(None)
r = sql("select status, result from public.battles where id = %s", (live,))[0]
check("the old live battle settles under the new grading code", r[0] == "final" and r[1].get("creator") is not None, r)
check("pot paid out once (A + B coins = 2,000 before/after)", abs(bal("A") + bal("B") - 2000) < 0.01, (bal("A"), bal("B")))
as_user(U["A"]); det = sql("select public.battle_detail(%s)", (live,), one=True); lob = sql("select public.battle_lobby()", one=True)
check("battle_detail / battle_lobby work on the old battle", det["battle"]["id"] == live and any(b["id"] == live for b in lob["recent"]), list(det))
# new things work on the upgraded project (new data load, then SGP battle)
for ab in ("KC", "BUF"):
    sql("update public.sim_teams set inj = '{}'::jsonb where sport='nfl' and abbr=%s", (ab,))
as_user(U["A"]); nb = sql("select (public.create_battle('nfl','KC','BUF',10,'home','sgp') ->> 'id')::bigint", one=True)
check("a new SGP battle can be created on the upgraded project", sql("select fmt from public.battles where id = %s", (nb,), one=True) == "sgp")
as_user(U["B"]); sql("select public.accept_battle(%s, 'away')", (nb,))
as_user(U["A"]); out = sql("select public.set_battle_parlay(%s, %s)", (nb, json.dumps(["ml:home", "tot:over"])), one=True)
check("SGP pricing runs on the upgraded project", out["quote"]["mult"] > 1, out["quote"])
bad = RES.count(False); print(f"\n{len(RES) - bad}/{len(RES)} upgrade checks passed")
adm.close(); sys.exit(1 if bad else 0)
