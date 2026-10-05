-- Battle v3: halftime (1st-half spread, total, moneyline) and spread/total line sliders. Run once AFTER setup.sql and patch_battle_v2.sql.
-- Not yet run against a real database.
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'battle_markets_core') then alter function public.battle_markets(text, text, text) rename to battle_markets_core; end if;
end $$;
grant execute on function public.battle_markets_core(text, text, text) to anon, authenticated;
create or replace function ls_private.p2price(p double precision) returns int language sql immutable as $$ select ls_private.est_price(least(greatest(p, 0.03), 0.97)::numeric) $$;
-- price of any spread / total line from the model's own expectation (used by the sliders; scope 'game' or 'h1')
create or replace function ls_private.line_price(mk jsonb, scope text, kind text, side text, ln numeric) returns int language plpgsql immutable as $$
declare src jsonb := case when scope = 'h1' then mk -> 'h1' else mk end; mu float; sd float; tm float; st float; p float;
begin
  if src is null or (src ->> 'sdm') is null then return null; end if;
  mu := (src ->> 'eh')::float - (src ->> 'ea')::float; sd := greatest((src ->> 'sdm')::float, 0.5);
  tm := (src ->> 'eh')::float + (src ->> 'ea')::float; st := greatest(coalesce((src ->> 'sdt')::float, sd * 1.2), 0.5);
  if kind = 'spr' then p := case when side = 'home' then ls_private.phi((mu + ln::float) / sd) else ls_private.phi((ln::float - mu) / sd) end;
  elsif kind = 'tot' then p := case when side = 'over' then 1 - ls_private.phi((ln::float - tm) / st) else ls_private.phi((ln::float - tm) / st) end;
  else return null; end if;
  return ls_private.p2price(p);
end $$;
create or replace function public.battle_markets(p_sport text, p_home text, p_away text) returns jsonb
language plpgsql stable security definer set search_path = public, ls_private, pg_temp as $$
declare m jsonb := public.battle_markets_core(p_sport, p_home, p_away); fh float := case when p_sport = 'mlb' then 0.556 else 0.5 end;
  eh1 float; ea1 float; sd1 float; st1 float; mu float; tm float; hl numeric; tl numeric; ph float;
begin
  eh1 := (m ->> 'eh')::float * fh; ea1 := (m ->> 'ea')::float * fh;
  sd1 := (m ->> 'sdm')::float * sqrt(fh); st1 := coalesce((m ->> 'sdt')::float, (m ->> 'sdm')::float * 1.2) * sqrt(fh);
  mu := eh1 - ea1; tm := eh1 + ea1; hl := floor(-mu) + 0.5; tl := floor(tm) + 0.5; ph := ls_private.phi(mu / greatest(sd1, 0.5));
  return m || jsonb_build_object('h1', jsonb_build_object('eh', round(eh1::numeric, 2), 'ea', round(ea1::numeric, 2), 'sdm', round(sd1::numeric, 2), 'sdt', round(st1::numeric, 2),
    'ml', jsonb_build_object('home', ls_private.p2price(ph), 'away', ls_private.p2price(1 - ph)),
    'spr', jsonb_build_object('homeLine', hl, 'awayLine', -hl, 'home', ls_private.line_price(jsonb_build_object('h1', jsonb_build_object('eh', eh1, 'ea', ea1, 'sdm', sd1, 'sdt', st1)), 'h1', 'spr', 'home', hl), 'away', ls_private.line_price(jsonb_build_object('h1', jsonb_build_object('eh', eh1, 'ea', ea1, 'sdm', sd1, 'sdt', st1)), 'h1', 'spr', 'away', -hl)),
    'tot', jsonb_build_object('line', tl, 'over', ls_private.line_price(jsonb_build_object('h1', jsonb_build_object('eh', eh1, 'ea', ea1, 'sdm', sd1, 'sdt', st1)), 'h1', 'tot', 'over', tl), 'under', ls_private.line_price(jsonb_build_object('h1', jsonb_build_object('eh', eh1, 'ea', ea1, 'sdm', sd1, 'sdt', st1)), 'h1', 'tot', 'under', tl))));
end $$;
grant execute on function public.battle_markets(text, text, text) to anon, authenticated;

create or replace function ls_private.battle_leg(mk jsonb, tok text, allow_win boolean default false) returns jsonb language plpgsql immutable as $$
declare p text[] := string_to_array(coalesce(tok, ''), ':'); pr jsonb; n int; pz int; ln numeric;
begin
  if p[1] = 'ml' and p[2] in ('home', 'away') then
    return jsonb_build_object('tok', tok, 'kind', 'ml', 'side', p[2], 'grp', 'ml', 'price', (mk -> 'ml' ->> p[2])::int, 'label', (mk ->> p[2]) || ' to win');
  elsif p[1] = 'spr' and p[2] in ('home', 'away') then
    return jsonb_build_object('tok', tok, 'kind', 'spr', 'side', p[2], 'line', (mk -> 'spr' ->> (p[2] || 'Line'))::numeric, 'grp', 'spr', 'price', (mk -> 'spr' ->> p[2])::int,
      'label', (mk ->> p[2]) || ' ' || ls_private.sg((mk -> 'spr' ->> (p[2] || 'Line'))::numeric));
  elsif p[1] = 'tot' and p[2] in ('over', 'under') then
    return jsonb_build_object('tok', tok, 'kind', 'tot', 'dir', p[2], 'line', (mk -> 'tot' ->> 'line')::numeric, 'grp', 'tot', 'price', (mk -> 'tot' ->> p[2])::int,
      'label', initcap(p[2]) || ' ' || ls_private.num_txt((mk -> 'tot' ->> 'line')::numeric));
  elsif p[1] = 'p' and p[4] in ('over', 'under') then
    select x into pr from jsonb_array_elements(mk -> 'props') x where x ->> 'pid' = p[2] and x ->> 'stat' = p[3] limit 1;
    if pr is null or (pr ->> 'yn')::boolean then return null; end if;
    return jsonb_build_object('tok', tok, 'kind', 'p', 'pid', p[2], 'stat', p[3], 'dir', p[4], 'line', (pr ->> 'line')::numeric, 'grp', 'p:' || p[2] || ':' || p[3], 'price', (pr ->> p[4])::int,
      'label', ls_private.surname(pr ->> 'name') || ' ' || initcap(p[4]) || ' ' || ls_private.num_txt((pr ->> 'line')::numeric) || ' ' || lower(pr ->> 'label'));
  elsif p[1] = 'x' and p[4] ~ '^[0-9]{1,3}$' then
    select x into pr from jsonb_array_elements(mk -> 'props') x where x ->> 'pid' = p[2] and x ->> 'stat' = p[3] limit 1;
    if pr is null then return null; end if;
    select (r ->> 'price')::int into pz from jsonb_array_elements(pr -> 'rungs') r where (r ->> 'n') = p[4] limit 1;
    if pz is null then return null; end if;
    n := p[4]::int;
    return jsonb_build_object('tok', tok, 'kind', 'x', 'pid', p[2], 'stat', p[3], 'n', n, 'grp', 'p:' || p[2] || ':' || p[3], 'price', pz,
      'label', ls_private.surname(pr ->> 'name') || case when (pr ->> 'yn')::boolean then ' ' || lower(pr ->> 'label') else ' ' || n || '+ ' || lower(pr ->> 'label') end);
  elsif p[1] = 'h1ml' and p[2] in ('home', 'away') and mk ? 'h1' then
    return jsonb_build_object('tok', tok, 'kind', 'h1ml', 'side', p[2], 'grp', 'h1ml', 'price', (mk -> 'h1' -> 'ml' ->> p[2])::int, 'label', (mk ->> p[2]) || ' leads at the half');
  elsif p[1] = 'sl' and p[2] in ('game', 'h1') and p[3] in ('spr', 'tot') and p[4] in ('home', 'away', 'over', 'under') and p[5] ~ '^-?[0-9]{1,3}(\.[05])?$' then
    ln := p[5]::numeric; if (ln * 2) <> floor(ln * 2) then return null; end if;
    if (p[3] = 'spr') <> (p[4] in ('home', 'away')) then return null; end if;
    pz := ls_private.line_price(mk, p[2], p[3], p[4], ln); if pz is null then return null; end if;
    return jsonb_build_object('tok', tok, 'kind', 'sl', 'scope', p[2], 'k', p[3], 'side', p[4], 'line', ln, 'grp', case when p[2] = 'h1' then 'h1' || p[3] else p[3] end, 'price', ls_private.boost_price(pz),
      'label', case when p[3] = 'spr' then (mk ->> p[4]) || ' ' || ls_private.sg(ln) else initcap(p[4]) || ' ' || ls_private.num_txt(ln) end || case when p[2] = 'h1' then ' (1st half)' else '' end);
  elsif allow_win and p[1] = 'win' and p[2] in ('creator', 'opponent') and mk ? 'winner' then
    return jsonb_build_object('tok', tok, 'kind', 'win', 'grp', 'win', 'price', (mk -> 'winner' ->> p[2])::int, 'label', (mk -> 'winner' ->> (p[2] || 'Name')) || ' wins the battle');
  end if;
  return null;
end $$;
create or replace function ls_private.grade_battle_leg(mk jsonb, tok text, hs int, as_ int, players jsonb) returns text language plpgsql immutable as $$
declare p text[] := string_to_array(tok, ':'); m int := hs - as_; v numeric; t int := hs + as_; pr jsonb; x numeric; ln numeric; mm int; tt int;
begin
  if p[1] = 'ml' then if m = 0 then return 'V'; end if; return case when (p[2] = 'home') = (m > 0) then 'W' else 'L' end; end if;
  if p[1] = 'spr' then v := (case when p[2] = 'home' then m else -m end) + (mk -> 'spr' ->> (p[2] || 'Line'))::numeric;
    if v = 0 then return 'V'; end if; return case when v > 0 then 'W' else 'L' end; end if;
  if p[1] = 'tot' then ln := (mk -> 'tot' ->> 'line')::numeric; if t = ln then return 'V'; end if;
    return case when (p[2] = 'over') = (t > ln) then 'W' else 'L' end; end if;
  if p[1] = 'h1ml' then mm := coalesce((players -> '_h1' ->> 'hs')::int, 0) - coalesce((players -> '_h1' ->> 'as')::int, 0);
    if mm = 0 then return 'V'; end if; return case when (p[2] = 'home') = (mm > 0) then 'W' else 'L' end; end if;
  if p[1] = 'sl' then
    if p[2] = 'h1' then mm := coalesce((players -> '_h1' ->> 'hs')::int, 0) - coalesce((players -> '_h1' ->> 'as')::int, 0); tt := coalesce((players -> '_h1' ->> 'hs')::int, 0) + coalesce((players -> '_h1' ->> 'as')::int, 0);
    else mm := m; tt := t; end if;
    ln := p[5]::numeric;
    if p[3] = 'spr' then v := (case when p[4] = 'home' then mm else -mm end) + ln; else v := case when p[4] = 'over' then tt - ln else ln - tt end; end if;
    if v = 0 then return 'V'; end if; return case when v > 0 then 'W' else 'L' end;
  end if;
  if p[1] = 'x' then
    x := coalesce((players -> p[2] ->> p[3])::numeric, 0); return case when x >= p[4]::numeric then 'W' else 'L' end;
  end if;
  if p[1] = 'p' then
    select y into pr from jsonb_array_elements(mk -> 'props') y where y ->> 'pid' = p[2] and y ->> 'stat' = p[3] limit 1;
    if pr is null then return 'V'; end if;
    x := coalesce((players -> p[2] ->> p[3])::numeric, 0); ln := (pr ->> 'line')::numeric;
    if x = ln then return 'V'; end if;
    return case when (p[4] = 'over') = (x > ln) then 'W' else 'L' end;
  end if;
  return 'V';
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
    if b.fmt = 'sgp' and ((leg ->> 'kind') in ('h1ml', 'sl')) then raise exception 'Halftime bets and line sliders are for Parlay battles'; end if;
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
create or replace function ls_private.start_battle(p_id bigint) returns void
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare b public.battles; sim jsonb; ev jsonb; tmax float; t0 timestamptz := public.app_now(); e jsonb; seq int := 0; lh int := 0; la int := 0; t float;
  snap jsonb := '{}'::jsonb; rem float; wp float; m int; eh float; ea float; sdm float; ends timestamptz; fin boolean; hs int; as_ int;
  need text[]; pr text[]; incs jsonb; ii int := 0; ninc int; ic jsonb; pk text; h1h int; h1a int;
begin
  select * into b from public.battles where id = p_id for update;
  if b.status <> 'building' then return; end if;
  sim := ls_private.run_sim(b.markets);
  sim := jsonb_set(sim, '{ev}', ls_private.sprinkle(b.sport, b.home, b.away, sim -> 'ev'));
  hs := (sim ->> 'hs')::int; as_ := (sim ->> 'as')::int;
  select coalesce((x ->> 'hs')::int, 0), coalesce((x ->> 'as')::int, 0) into h1h, h1a from jsonb_array_elements(sim -> 'ev') x
    where (x ->> 'hs')::int >= 0 and (x ->> 't')::float <= case when b.sport = 'mlb' then 0.556 else 0.5 end order by (x ->> 't')::float desc limit 1;
  sim := jsonb_set(sim, '{players}', coalesce(sim -> 'players', '{}'::jsonb) || jsonb_build_object('_h1', jsonb_build_object('hs', coalesce(h1h, 0), 'as', coalesce(h1a, 0))));
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

create or replace function public.battle_quote(p_id bigint, p_tok text) returns jsonb
language sql stable security definer set search_path = public, ls_private, pg_temp as $$
  select ls_private.battle_leg(b.markets, p_tok, false) from public.battles b where b.id = p_id
$$;
grant execute on function public.battle_quote(bigint, text) to authenticated;
