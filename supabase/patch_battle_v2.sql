-- Battle v2: parlay size (4/8/12/unlimited), game length 2-8 min, 5-second unlock window, 10% better prices.
-- Run once in the Supabase SQL editor AFTER setup.sql. Not yet run against a real database.
alter table public.battles add column if not exists max_legs int not null default 6;           -- 4, 8, 12 or 0 = unlimited (creator's choice)
alter table public.battles add column if not exists duration_min int not null default 4;       -- length of the simulated game in minutes (2 to 8)
alter table public.battles add column if not exists both_locked_at timestamptz;                -- set when the second player locks; the game starts 5 s later unless someone unlocks
create or replace function ls_private.boost_price(p int) returns int language sql immutable as $$
  select case when p is null or abs(p) < 100 then p else
    (with d as (select case when p > 0 then 1 + p / 100.0 else 1 + 100.0 / -p end as dc),
          n as (select 1 + (dc - 1) * 1.10 as dc from d)
     select case when dc >= 2 then round((dc - 1) * 100)::int else -round(100 / (dc - 1))::int end from n) end
$$;
create or replace function ls_private.boost_json(j jsonb) returns jsonb language plpgsql immutable as $$
declare k text; v jsonb; o jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    o := '{}'::jsonb;
    for k, v in select * from jsonb_each(j) loop
      if k in ('price', 'over', 'under', 'home', 'away') and jsonb_typeof(v) = 'number' and abs((v #>> '{}')::numeric) >= 100 then o := o || jsonb_build_object(k, ls_private.boost_price((v #>> '{}')::int));
      else o := o || jsonb_build_object(k, ls_private.boost_json(v)); end if;
    end loop;
    return o;
  elsif jsonb_typeof(j) = 'array' then
    return coalesce((select jsonb_agg(ls_private.boost_json(x) order by o2) from jsonb_array_elements(j) with ordinality as a(x, o2)), '[]'::jsonb);
  end if;
  return j;
end $$;
create or replace function ls_private.boost_q(q jsonb) returns jsonb language sql immutable as $$
  select case when q ? 'mult' and jsonb_typeof(q -> 'mult') = 'number' then jsonb_set(q, '{mult}', to_jsonb(round(1 + ((q ->> 'mult')::numeric - 1) * 1.10, 3))) else q end
$$;
drop function if exists public.create_battle(text, text, text, numeric, text, text);
create or replace function public.create_battle(p_sport text, p_home text, p_away text, p_wager numeric, p_side text, p_fmt text default 'parlay', p_max_legs int default 8, p_minutes int default 4) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); w numeric := round(coalesce(p_wager, 0), 2); mk jsonb; bid bigint; bal numeric; fm text := coalesce(p_fmt, 'parlay');
begin
  if uid is null then raise exception 'Sign in to battle'; end if;
  if p_sport not in ('nfl', 'nba', 'mlb', 'cfb', 'cbb') then raise exception 'Pick NFL, NBA, MLB, college football or college basketball'; end if;
  if fm not in ('parlay', 'sgp') then raise exception 'Pick Parlay or Same Game Parlay'; end if;
  if p_home = p_away then raise exception 'Pick two different teams'; end if;
  if p_side not in ('home', 'away') then raise exception 'Pick the team you back'; end if;
  if w < 1 then raise exception 'The wager must be at least 1 coin'; end if;
  if w > 100000 then raise exception 'That wager is too large'; end if;
  if (select count(*) from public.battles where creator = uid and status in ('open', 'building')) >= 3 then raise exception 'You already have 3 open battles'; end if;
  perform public.battle_tick();
  mk := public.battle_markets(p_sport, p_home, p_away);       -- rosters, injuries, lines: frozen into the battle right here
  if p_max_legs not in (0, 4, 8, 12) then raise exception 'Parlay size must be 4, 8, 12 or unlimited'; end if;
  if p_minutes is null or p_minutes < 2 or p_minutes > 8 then raise exception 'Game length must be 2 to 8 minutes'; end if;
  mk := ls_private.boost_json(mk);                                         -- battle prices are 10% more favorable than the book-style prices
  insert into public.battles(sport, fmt, home, away, wager, creator, creator_side, markets, max_legs, duration_min)
    values (p_sport, fm, p_home, p_away, w, uid, p_side, mk, p_max_legs, p_minutes) returning id into bid;
  bal := ls_private.move_coins(uid, -w, 'battle_escrow', 'battle ' || bid);
  insert into public.battle_stats(user_id, sport) values (uid, p_sport) on conflict do nothing;
  perform ls_private.add_action(uid);
  return jsonb_build_object('id', bid, 'balance', bal);
end $$;
create or replace function public.set_battle_parlay(p_id bigint, p_legs jsonb) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare v_cap int; uid uuid := auth.uid(); b public.battles; pp public.battle_parlays; n int; i int; leg jsonb; v_legs jsonb := '[]'::jsonb; grps text[] := '{}'; q jsonb; nv numeric := 1;
begin
  select * into b from public.battles where id = p_id for update;
  if not found then raise exception 'No such battle'; end if;
  if uid is null or (uid <> b.creator and uid is distinct from b.opponent) then raise exception 'Only the two players build parlays'; end if;
  if b.status <> 'building' then raise exception 'Parlays can only be changed before the game starts'; end if;
  select * into pp from public.battle_parlays where battle_id = p_id and user_id = uid for update;
  if pp.locked then raise exception 'Your parlay is locked'; end if;
  if jsonb_typeof(p_legs) is distinct from 'array' then raise exception 'Bad parlay'; end if;
  n := jsonb_array_length(p_legs);
  v_cap := case when b.max_legs = 0 then 40 else b.max_legs end;
  if n > v_cap then raise exception 'This battle allows at most % legs', v_cap; end if;
  for i in 0 .. n - 1 loop
    leg := ls_private.battle_leg(b.markets, p_legs ->> i, false);
    if leg is null then raise exception 'Unknown battle market'; end if;
    if (leg ->> 'grp') = any(grps) then raise exception 'One pick per market: %', leg ->> 'label'; end if;
    grps := grps || (leg ->> 'grp'); v_legs := v_legs || jsonb_build_array(leg);
    nv := nv * ls_private.dec_of((leg ->> 'price')::int);
  end loop;
  -- the slip's price: straight multiplication (Parlay) or the correlated Same Game Parlay price from the simulator model
  if n >= 1 and b.fmt = 'sgp' then q := ls_private.boost_q(ls_private.sgp_price(b.markets, v_legs, 3000));
  else q := jsonb_build_object('mult', round(nv, 3), 'naive', round(nv, 3), 'legs', n); end if;
  q := q || jsonb_build_object('toks', (select coalesce(jsonb_agg(l ->> 'tok' order by l ->> 'tok'), '[]'::jsonb) from jsonb_array_elements(v_legs) l), 'fmt', b.fmt);
  update public.battle_parlays set legs = v_legs, quote = q, updated_at = public.app_now() where battle_id = p_id and user_id = uid;
  return jsonb_build_object('ok', true, 'legs', v_legs, 'quote', q);
end $$;
create or replace function public.lock_battle_parlay(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); b public.battles; pp public.battle_parlays; nlocked int; toks jsonb;
begin
  select * into b from public.battles where id = p_id for update;
  if not found then raise exception 'No such battle'; end if;
  if uid is null or (uid <> b.creator and uid is distinct from b.opponent) then raise exception 'Only the two players lock parlays'; end if;
  if b.status <> 'building' then raise exception 'This battle is not waiting for parlays'; end if;
  select * into pp from public.battle_parlays where battle_id = p_id and user_id = uid for update;
  if jsonb_array_length(pp.legs) < 1 then raise exception 'Add at least one leg before locking'; end if;
  if b.fmt = 'sgp' and jsonb_array_length(pp.legs) < 2 then raise exception 'A Same Game Parlay needs at least 2 legs'; end if;
  toks := (select coalesce(jsonb_agg(l ->> 'tok' order by l ->> 'tok'), '[]'::jsonb) from jsonb_array_elements(pp.legs) l);
  if pp.quote is null or (pp.quote -> 'toks') is distinct from toks then       -- the saved price must belong to exactly these legs
    update public.battle_parlays set quote = (select ls_private.boost_q(ls_private.sgp_price(b.markets, pp.legs, 3000)) || jsonb_build_object('toks', toks, 'fmt', b.fmt)) where battle_id = p_id and user_id = uid and b.fmt = 'sgp';
  end if;
  update public.battle_parlays set locked = true, updated_at = public.app_now() where battle_id = p_id and user_id = uid;
  select count(*) into nlocked from public.battle_parlays where battle_id = p_id and locked;
  if nlocked >= 2 then update public.battles set both_locked_at = public.app_now() where id = p_id; return jsonb_build_object('ok', true, 'started', false, 'countdown', 5); end if;
  return jsonb_build_object('ok', true, 'started', false);
end $$;

create or replace function public.unlock_battle_parlay(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); b public.battles;
begin
  select * into b from public.battles where id = p_id for update;
  if not found then raise exception 'No such battle'; end if;
  if uid is null or (uid <> b.creator and uid is distinct from b.opponent) then raise exception 'Only the two players unlock parlays'; end if;
  if b.status <> 'building' then raise exception 'Too late: the game has started'; end if;
  if b.both_locked_at is not null and public.app_now() >= b.both_locked_at + interval '5 seconds' then raise exception 'Too late: the game is starting'; end if;
  update public.battle_parlays set locked = false, updated_at = public.app_now() where battle_id = p_id and user_id = uid;
  update public.battles set both_locked_at = null where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.unlock_battle_parlay(bigint) to authenticated;
grant execute on function public.create_battle(text, text, text, numeric, text, text, int, int) to authenticated;

create or replace function public.battle_tick() returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare r record; nc int := 0; ns int := 0; now_ timestamptz := public.app_now();
begin
  for r in select id from public.battles bb where status = 'building' and both_locked_at is not null and both_locked_at <= now_ - interval '5 seconds'
             and (select count(*) from public.battle_parlays where battle_id = bb.id and locked) >= 2 loop
    perform ls_private.start_battle(r.id);
  end loop;
  for r in select id from public.battles where status = 'open' and created_at < now_ - interval '30 minutes' loop
    perform ls_private.cancel_battle_internal(r.id, 'nobody accepted within 30 minutes'); nc := nc + 1;
  end loop;
  for r in select id from public.battles where status = 'building' and accepted_at < now_ - interval '15 minutes' loop
    perform ls_private.cancel_battle_internal(r.id, 'parlays were not locked within 15 minutes'); nc := nc + 1;
  end loop;
  for r in select id from public.battles where status = 'live' and ends_at <= now_ loop
    if ls_private.settle_battle_internal(r.id) is not null then ns := ns + 1; end if;
  end loop;
  return jsonb_build_object('cancelled', nc, 'settled', ns);
end $$;
create or replace function ls_private.start_battle(p_id bigint) returns void
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare b public.battles; sim jsonb; ev jsonb; tmax float; t0 timestamptz := public.app_now(); e jsonb; seq int := 0; lh int := 0; la int := 0; t float;
  snap jsonb := '{}'::jsonb; rem float; wp float; m int; eh float; ea float; sdm float; ends timestamptz; fin boolean; hs int; as_ int;
  need text[]; pr text[]; incs jsonb; ii int := 0; ninc int; ic jsonb; pk text;
begin
  select * into b from public.battles where id = p_id for update;
  if b.status <> 'building' then return; end if;
  sim := ls_private.run_sim(b.markets);
  sim := jsonb_set(sim, '{ev}', ls_private.sprinkle(b.sport, b.home, b.away, sim -> 'ev'));
  hs := (sim ->> 'hs')::int; as_ := (sim ->> 'as')::int;
  -- the live view only follows the (player, stat) pairs the two slips contain: keep their running totals per play, nothing else
  select coalesce(array_agg(distinct (l ->> 'pid') || '|' || (l ->> 'stat')), '{}') into need
    from public.battle_parlays p, jsonb_array_elements(p.legs) l where p.battle_id = p_id and l ? 'pid';
  incs := coalesce((select jsonb_agg(i order by (i ->> 't')::float) from jsonb_array_elements(sim -> 'inc') i where (i ->> 'pid') || '|' || (i ->> 'stat') = any(need)), '[]'::jsonb);
  ninc := jsonb_array_length(incs);
  foreach pk in array need loop
    pr := string_to_array(pk, '|');
    snap := jsonb_set(snap, array[pr[1]], coalesce(snap -> pr[1], '{}'::jsonb) || jsonb_build_object(pr[2], 0), true);
  end loop;
  tmax := greatest(1.0, coalesce((select max((x ->> 't')::float) from jsonb_array_elements(sim -> 'ev') x), 1.0));
  ev := sim -> 'ev' || jsonb_build_array(jsonb_build_object('t', tmax + 0.00001, 'kind', 'final',
    'text', 'Final' || case when tmax > 1 then case b.sport when 'mlb' then ' (extra innings)' else ' (overtime)' end else '' end || ': ' || b.away || ' ' || as_ || ', ' || b.home || ' ' || hs,
    'hs', hs, 'as', as_, 'clock', 'Final'));
  tmax := tmax + 0.00001;
  eh := (b.markets ->> 'eh')::float; ea := (b.markets ->> 'ea')::float; sdm := (b.markets ->> 'sdm')::float;
  ends := t0 + make_interval(secs => 60 * b.duration_min);
  for e in select x from jsonb_array_elements(ev) with ordinality as a(x, o) order by (x ->> 't')::float, o loop
    t := (e ->> 't')::float;
    if (e ->> 'hs')::int >= 0 then lh := (e ->> 'hs')::int; la := (e ->> 'as')::int; end if;
    fin := e ->> 'kind' = 'final';
    while ii < ninc and (incs -> ii ->> 't')::float <= t loop
      ic := incs -> ii;
      snap := jsonb_set(snap, array[ic ->> 'pid'], coalesce(snap -> (ic ->> 'pid'), '{}'::jsonb) || jsonb_build_object(ic ->> 'stat', coalesce((snap -> (ic ->> 'pid') ->> (ic ->> 'stat'))::numeric, 0) + (ic ->> 'd')::numeric), true);
      ii := ii + 1;
    end loop;
    rem := greatest(0, 1 - least(t, 1)); m := lh - la;
    if fin then wp := case when m > 0 then 1 when m < 0 then 0 else 0.5 end;
    else wp := ls_private.phi((m + (eh - ea) * rem) / (sdm * sqrt(rem) + 0.75)); end if;
    insert into public.battle_events(battle_id, seq, visible_at, kind, text, hs, as_, clock, wp, stats)
      values (p_id, seq, t0 + make_interval(secs => 4 + (t / tmax) * 174), e ->> 'kind', e ->> 'text', lh, la, e ->> 'clock', round(wp::numeric, 3), snap);
    seq := seq + 1;
  end loop;
  insert into public.battle_results(battle_id, ends_at, home_score, away_score, players) values (p_id, ends, hs, as_, sim -> 'players')
    on conflict (battle_id) do update set ends_at = excluded.ends_at, home_score = excluded.home_score, away_score = excluded.away_score, players = excluded.players;
  update public.battles set status = 'live', started_at = t0, ends_at = ends where id = p_id;
end $$;
