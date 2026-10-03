#!/bin/bash
# DEVELOPER TOOL (not needed to run the site): a local stand-in for a Supabase project, used by the tests in this folder.
#   real PostgreSQL 16 + real pg_cron, a stub "auth" schema and the Supabase roles (supabase_stub.sql),
#   supabase/setup.sql run TWICE (proves it is idempotent), real PostgREST, and gateway.py (auth mock + /rest/v1 proxy) on :54321.
# Needs (Debian/Ubuntu): apt install postgresql-16 postgresql-16-cron ; pip install psycopg2-binary pyjwt requests playwright
# Usage: bash up.sh      (re-creates the test database every time)
set -e
cd "$(dirname "$0")"
SITE="$(cd ../.. && pwd)"
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/var/lib/postgresql/ls_test}
P="psql -h 127.0.0.1 -p 54329 -U postgres"
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"; chown postgres "$PGDATA"
  su postgres -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust -E UTF8 >/dev/null"
  cat >> "$PGDATA/postgresql.conf" <<'EOF'
port = 54329
listen_addresses = '127.0.0.1'
shared_preload_libraries = 'pg_cron'
cron.database_name = 'ls'
cron.timezone = 'UTC'
unix_socket_directories = '/var/run/postgresql'
EOF
fi
$P -c "select 1" >/dev/null 2>&1 || su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l $PGDATA/log.txt -w start" >/dev/null
[ -x ./postgrest ] || { curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar xJ; }
[ -f ./supabase.js ] || curl -sSL -o supabase.js https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js
for f in postgrest.pid gateway.pid; do [ -f $f ] && kill "$(cat $f)" 2>/dev/null || true; rm -f $f; done
sleep 0.5
$P -q -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='ls' and pid<>pg_backend_pid()" >/dev/null
$P -q -c "drop database if exists ls" -c "create database ls"
$P -d ls -q -v ON_ERROR_STOP=1 -f supabase_stub.sql >/dev/null 2>&1
$P -d ls -q -v ON_ERROR_STOP=1 -f "$SITE/supabase/setup.sql" > setup_run1.log 2>&1
$P -d ls -q -v ON_ERROR_STOP=1 -f "$SITE/supabase/setup.sql" > setup_run2.log 2>&1
echo "setup.sql ran twice without errors"
python3 load_sim.py "$SITE"
nohup ./postgrest postgrest.conf > postgrest.log 2>&1 & echo $! > postgrest.pid
nohup python3 gateway.py > gateway.log 2>&1 & echo $! > gateway.pid
for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:3000/ && break; sleep 0.25; done
sleep 0.5
echo "local Supabase stand-in ready on http://127.0.0.1:54321"
