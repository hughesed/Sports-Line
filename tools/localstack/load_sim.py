#!/usr/bin/env python3
"""Loads data/sim.json (battle teams + player averages written by the bot) into the local test database, like the bot's upload."""
import json, os, sys
import psycopg2
SITE = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(SITE, "engine"))
import simdata
sim = json.load(open(os.path.join(SITE, "data", "sim.json")))
teams, players = simdata.rows(sim)
c = psycopg2.connect("host=127.0.0.1 port=54329 dbname=ls user=postgres"); c.autocommit = True; cur = c.cursor()
cur.execute("delete from public.sim_players; delete from public.sim_teams")
for t in teams:
    cur.execute("insert into public.sim_teams(sport,abbr,name,short,color,o,d,gp,lg_avg,hfa,inj) values (%(sport)s,%(abbr)s,%(name)s,%(short)s,%(color)s,%(o)s,%(d)s,%(gp)s,%(lg_avg)s,%(hfa)s,%(inj)s::jsonb)", dict(t, inj=json.dumps(t.get('inj') or {})))
for p in players:
    cur.execute("insert into public.sim_players(sport,pid,team,name,pos,role,rk,stats,inj,note) values (%(sport)s,%(pid)s,%(team)s,%(name)s,%(pos)s,%(role)s,%(rk)s,%(stats)s::jsonb,%(inj)s,%(note)s)", dict(p, stats=json.dumps(p["stats"]), inj=p.get('inj'), note=p.get('note')))
print(f"battle data loaded: {len(teams)} teams, {len(players)} players")
