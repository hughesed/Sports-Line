-- Battle v7: box score, end-of-game timing, MLB Hits+Runs+RBIs, team totals.   Run ONCE in the Supabase SQL editor, after patch_battle_v6.sql.  Safe to run twice.
--  * The plays are now spread over the WHOLE game length you picked and the battle ends 3 seconds after the last play (before: plays ended
--    at 3 minutes but the battle only closed at the full length, so a 4-minute game waited 1 minute, an 8-minute game waited 5 minutes).
--  * The live view stores a running total for EVERY player and stat (not only the ones in the two slips), so the page can show a box score.
--    Each play row now keeps only what changed on that play (the page adds them up), which makes the rows smaller than before.
--  * MLB: Hits + Runs + RBIs player prop (over/under + ladder), and a team total (over/under) for each team in every sport.
--  * pg_cron also settles battles every 10 seconds (when the extension supports it), so a finished battle closes even if nobody is watching.
-- NOT run against a real database here (no PostgreSQL in the sandbox where this was written): run it, then play one MLB battle to check.

create or replace function ls_private.start_battle(p_id bigint) returns void
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare b public.battles; sim jsonb; ev jsonb; tmax float; t0 timestamptz := public.app_now(); e jsonb; seq int := 0; lh int := 0; la int := 0; t float;
  snap jsonb := '{}'::jsonb; rem float; wp float; m int; eh float; ea float; sdm float; ends timestamptz; fin boolean; hs int; as_ int;
  need text[]; pr text[]; incs jsonb; ii int := 0; ninc int; ic jsonb; pk text; h1h int; h1a int; span float; d jsonb;
begin
  select * into b from public.battles where id = p_id for update;
  if b.status <> 'building' then return; end if;
  sim := ls_private.run_sim(b.markets);
  sim := jsonb_set(sim, '{ev}', ls_private.sprinkle(b.sport, b.home, b.away, sim -> 'ev'));
  hs := (sim ->> 'hs')::int; as_ := (sim ->> 'as')::int;
  if b.sport = 'mlb' then
    sim := jsonb_set(sim, '{inc}', (sim -> 'inc') || coalesce((select jsonb_agg(i || jsonb_build_object('stat', 'hrr')) from jsonb_array_elements(sim -> 'inc') i where i ->> 'stat' in ('hits', 'runs', 'rbi')), '[]'::jsonb));
    sim := jsonb_set(sim, '{players}', coalesce((select jsonb_object_agg(k, case when v ? 'hits' then v || jsonb_build_object('hrr', coalesce((v ->> 'hits')::int, 0) + coalesce((v ->> 'runs')::int, 0) + coalesce((v ->> 'rbi')::int, 0)) else v end)
      from jsonb_each(sim -> 'players') e(k, v)), '{}'::jsonb));
  end if;
  select coalesce((x ->> 'hs')::int, 0), coalesce((x ->> 'as')::int, 0) into h1h, h1a from jsonb_array_elements(sim -> 'ev') x
    where (x ->> 'hs')::int >= 0 and (x ->> 't')::float <= case when b.sport = 'mlb' then 0.556 else 0.5 end order by (x ->> 't')::float desc limit 1;
  sim := jsonb_set(sim, '{players}', coalesce(sim -> 'players', '{}'::jsonb) || jsonb_build_object('_h1', jsonb_build_object('hs', coalesce(h1h, 0), 'as', coalesce(h1a, 0))));
  -- the live view only follows the (player, stat) pairs the two slips contain: keep their running totals per play, nothing else
  select coalesce(array_agg(distinct (i ->> 'pid') || '|' || (i ->> 'stat')), '{}') into need from jsonb_array_elements(sim -> 'inc') i where (i ->> 'pid') is not null;
  incs := coalesce((select jsonb_agg(i order by (i ->> 't')::float) from jsonb_array_elements(sim -> 'inc') i), '[]'::jsonb);
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
  span := greatest(60.0 * b.duration_min - 10, 30);
  ends := t0 + make_interval(secs => 4 + span + 3);
  for e in select x from jsonb_array_elements(ev) with ordinality as a(x, o) order by (x ->> 't')::float, o loop
    t := (e ->> 't')::float; d := '{}'::jsonb;
    if (e ->> 'hs')::int >= 0 then lh := (e ->> 'hs')::int; la := (e ->> 'as')::int; end if;
    fin := e ->> 'kind' = 'final';
    while ii < ninc and (incs -> ii ->> 't')::float <= t loop
      ic := incs -> ii;
      snap := jsonb_set(snap, array[ic ->> 'pid'], coalesce(snap -> (ic ->> 'pid'), '{}'::jsonb) || jsonb_build_object(ic ->> 'stat', coalesce((snap -> (ic ->> 'pid') ->> (ic ->> 'stat'))::numeric, 0) + (ic ->> 'd')::numeric), true);
      d := jsonb_set(d, array[ic ->> 'pid'], coalesce(d -> (ic ->> 'pid'), '{}'::jsonb) || jsonb_build_object(ic ->> 'stat', snap -> (ic ->> 'pid') -> (ic ->> 'stat')), true);
      ii := ii + 1;
    end loop;
    rem := greatest(0, 1 - least(t, 1)); m := lh - la;
    if fin then wp := case when m > 0 then 1 when m < 0 then 0 else 0.5 end;
    else wp := ls_private.phi((m + (eh - ea) * rem) / (sdm * sqrt(rem) + 0.75)); end if;
    insert into public.battle_events(battle_id, seq, visible_at, kind, text, hs, as_, clock, wp, stats)
      values (p_id, seq, t0 + make_interval(secs => 4 + (t / tmax) * span), e ->> 'kind', e ->> 'text', lh, la, e ->> 'clock', round(wp::numeric, 3), d);
    seq := seq + 1;
  end loop;
  insert into public.battle_results(battle_id, ends_at, home_score, away_score, players) values (p_id, ends, hs, as_, sim -> 'players')
    on conflict (battle_id) do update set ends_at = excluded.ends_at, home_score = excluded.home_score, away_score = excluded.away_score, players = excluded.players;
  update public.battles set status = 'live', started_at = t0, ends_at = ends,
    markets = markets || jsonb_build_object('roster', coalesce((select jsonb_object_agg(x ->> 'pid', jsonb_build_array(x ->> 'name', x ->> 'side', x ->> 'role', x ->> 'rk'))
                from jsonb_array_elements(b.markets -> 'players') x where x ->> 'pid' is not null), '{}'::jsonb)) where id = p_id;
end $$;

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
  elsif p[1] = 'tt' and p[2] in ('home', 'away') and p[3] in ('over', 'under') and mk ? 'tt' and (mk -> 'tt' -> p[2]) is not null then
    return jsonb_build_object('tok', tok, 'kind', 'tt', 'side', p[2], 'dir', p[3], 'line', (mk -> 'tt' -> p[2] ->> 'line')::numeric, 'grp', 'tt:' || p[2], 'price', (mk -> 'tt' -> p[2] ->> p[3])::int,
      'label', (mk ->> p[2]) || ' team total ' || initcap(p[3]) || ' ' || ls_private.num_txt((mk -> 'tt' -> p[2] ->> 'line')::numeric));
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
  if p[1] = 'tt' then ln := (mk -> 'tt' -> p[2] ->> 'line')::numeric; x := case when p[2] = 'home' then hs else as_ end;
    if x = ln then return 'V'; end if; return case when (p[3] = 'over') = (x > ln) then 'W' else 'L' end; end if;
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

create or replace function ls_private.slip_conflict(legs jsonb) returns text language plpgsql immutable as $$
declare a jsonb; b jsonb; i int; j int; n int := coalesce(jsonb_array_length(legs), 0); ga int; gb int; la int; lb int;
begin
  for i in 0 .. n - 1 loop
    for j in i + 1 .. n - 1 loop
      a := legs -> i; b := legs -> j;
      if (a ->> 'grp') is distinct from (b ->> 'grp') then continue; end if;
      if (a ->> 'kind') in ('ml', 'spr') and (a ->> 'kind') = (b ->> 'kind') and (a ->> 'side') <> (b ->> 'side') then return (a ->> 'label') || ' and ' || (b ->> 'label'); end if;
      if (a ->> 'kind') = 'tt' and (b ->> 'kind') = 'tt' and (a ->> 'dir') <> (b ->> 'dir') then return (a ->> 'label') || ' and ' || (b ->> 'label'); end if;
      if (a ->> 'kind') = 'tot' and (b ->> 'kind') = 'tot' and (a ->> 'dir') <> (b ->> 'dir') then return (a ->> 'label') || ' and ' || (b ->> 'label'); end if;
      if (a ->> 'kind') in ('p', 'x') and (b ->> 'kind') in ('p', 'x') then
        ga := case when a ->> 'kind' = 'x' then (a ->> 'n')::int when a ->> 'dir' = 'over' then floor((a ->> 'line')::numeric)::int + 1 end;
        la := case when a ->> 'kind' = 'p' and a ->> 'dir' = 'under' then floor((a ->> 'line')::numeric)::int + 1 end;
        gb := case when b ->> 'kind' = 'x' then (b ->> 'n')::int when b ->> 'dir' = 'over' then floor((b ->> 'line')::numeric)::int + 1 end;
        lb := case when b ->> 'kind' = 'p' and b ->> 'dir' = 'under' then floor((b ->> 'line')::numeric)::int + 1 end;
        if (ga is not null and lb is not null and ga >= lb) or (gb is not null and la is not null and gb >= la) then return (a ->> 'label') || ' and ' || (b ->> 'label'); end if;
      end if;
    end loop;
  end loop;
  return null;
end $$;

create or replace function ls_private.sgp_price(mk jsonb, legs jsonb, n int default 3000) returns jsonb
language plpgsql immutable set search_path = public, ls_private, pg_temp as $$
declare nl int := coalesce(jsonb_array_length(legs), 0); i int; k int; l jsonb; sport text := mk ->> 'sport';
  eh float := (mk ->> 'eh')::float; ea float := (mk ->> 'ea')::float; sdm float := (mk ->> 'sdm')::float; sdt float := (mk ->> 'sdt')::float; a float; b float; sh float;
  -- team legs
  tkind text[] := '{}'; targ text[] := '{}'; tline float[] := '{}'; nt int := 0;
  -- player legs
  pside text[] := '{}'; ppid text[] := '{}'; pthr float[] := '{}'; pdir int[] := '{}'; plt float[] := '{}'; plu float[] := '{}'; plp float[] := '{}'; pun int[] := '{}'; pres float[] := '{}';
  pui int[] := '{}'; ppi int[] := '{}'; pgi int[] := '{}'; pgk text[] := '{}'; ng int := 0; gmn float[]; gmx float[]; np int := 0; units text[] := '{}'; nu int := 0; pids text[] := '{}'; npid int := 0;
  pr jsonb; pe jsonb; pfair float; pn float; pj float; pnv float := 1; naive float := 1; seed bigint := 0; x bigint; u1 float; u2 float; zh float; za float; zp float; hs float; ass float; m float; tt float;
  ok boolean; acc float := 0; w float; lat float; uu float[]; ee float[]; zth float; zta float; ld double precision[]; ukey text; idx int; tx text; dec float; mult float; hold float;
  toks text[] := '{}'; thr float; cap boolean := false; zt float; q float; p_ge float; lv float;
begin
  if nl = 0 then return jsonb_build_object('mult', 1, 'naive', 1, 'p', 1, 'pIndep', 1, 'n', 0); end if;
  a := sdm / sqrt(2.0); b := sqrt(greatest((sdt * sdt - sdm * sdm) / 4.0, 0.0)); sh := sqrt(a * a + b * b);
  for i in 0 .. nl - 1 loop
    l := legs -> i; toks := toks || (l ->> 'tok'); naive := naive * ls_private.dec_of((l ->> 'price')::int);
    if l ->> 'kind' in ('ml', 'spr', 'tot', 'tt') then
      nt := nt + 1; tkind := tkind || (l ->> 'kind'); targ := targ || (case when l ->> 'kind' = 'tt' then (l ->> 'side') || ':' || (l ->> 'dir') else coalesce(l ->> 'side', l ->> 'dir') end); tline := tline || coalesce((l ->> 'line')::float, 0);
      pfair := case l ->> 'kind'
        when 'ml' then ls_private.phi(case l ->> 'side' when 'home' then (eh - ea) else (ea - eh) end / sdm)
        when 'spr' then ls_private.phi((case l ->> 'side' when 'home' then (eh - ea) else (ea - eh) end + (l ->> 'line')::float) / sdm)
        when 'tt' then case l ->> 'dir' when 'over' then 1 - ls_private.phi(((l ->> 'line')::float - (case l ->> 'side' when 'home' then eh else ea end)) / sqrt(a * a + b * b))
                       else ls_private.phi(((l ->> 'line')::float - (case l ->> 'side' when 'home' then eh else ea end)) / sqrt(a * a + b * b)) end
        else case l ->> 'dir' when 'over' then 1 - ls_private.phi(((l ->> 'line')::float - (eh + ea)) / sdt) else ls_private.phi(((l ->> 'line')::float - (eh + ea)) / sdt) end end;
      pnv := pnv * pfair;
    else
      select y into pe from jsonb_array_elements(mk -> 'props') y where y ->> 'pid' = l ->> 'pid' and y ->> 'stat' = l ->> 'stat' limit 1;
      if pe is null then raise exception 'Unknown player market in the slip'; end if;
      -- P(stat >= k) for the leg's threshold k (a line x.5 means >= x+1)
      k := case l ->> 'kind' when 'x' then (l ->> 'n')::int else floor((l ->> 'line')::float)::int + 1 end;
      p_ge := ls_private.p_ge(pe ->> 'dist', (pe ->> 'mean')::float, (pe ->> 'sd')::float, k);
      p_ge := least(greatest(p_ge, 0.001), 0.999);
      thr := ls_private.phi_inv(1 - p_ge);
      ld := ls_private.sgp_load(sport, l ->> 'stat');
      np := np + 1; pside := pside || (pe ->> 'side'); ppid := ppid || (l ->> 'pid'); pthr := pthr || thr; pdir := pdir || (case when l ->> 'dir' = 'under' then -1 else 1 end);
      plt := plt || ld[1]; plu := plu || ld[2]; plp := plp || ld[3]; pun := pun || ld[4]::int;
      pres := pres || sqrt(greatest(1 - ld[1] * ld[1] - ld[2] * ld[2] - ld[3] * ld[3], 0.02));
      ukey := (pe ->> 'side') || ':' || ld[4]::int;
      idx := coalesce(array_position(units, ukey), 0); if idx = 0 then units := units || ukey; nu := nu + 1; idx := nu; end if; pui := pui || idx;
      idx := coalesce(array_position(pgk, (l ->> 'pid') || '|' || (l ->> 'stat')), 0); if idx = 0 then pgk := pgk || ((l ->> 'pid') || '|' || (l ->> 'stat')); ng := ng + 1; idx := ng; end if; pgi := pgi || idx;
      idx := coalesce(array_position(pids, l ->> 'pid'), 0); if idx = 0 then pids := pids || (l ->> 'pid'); npid := npid + 1; idx := npid; end if; ppi := ppi || idx;
      pn := case when l ->> 'dir' = 'under' then 1 - p_ge else p_ge end; pnv := pnv * pn;
    end if;
  end loop;
  -- seed: the same game + the same slip always draws the same numbers
  select string_agg(t, '|' order by t) into tx from unnest(toks) t;
  seed := (abs(hashtext(coalesce(tx, '') || (mk ->> 'eh') || (mk ->> 'ea') || (mk ->> 'home') || (mk ->> 'away'))::bigint) % 2147483646) + 1;
  x := seed;
  for i in 1 .. 5 loop x := ls_private.lcg(x); end loop;
  for k in 1 .. n loop
    -- standard normals from the seeded generator (Box-Muller)
    x := ls_private.lcg(x); u1 := x / 2147483647.0; x := ls_private.lcg(x); u2 := x / 2147483647.0; w := sqrt(-2 * ln(greatest(u1, 1e-12)));
    zh := w * cos(2 * pi() * u2); za := w * sin(2 * pi() * u2);
    x := ls_private.lcg(x); u1 := x / 2147483647.0; x := ls_private.lcg(x); u2 := x / 2147483647.0; zp := sqrt(-2 * ln(greatest(u1, 1e-12))) * cos(2 * pi() * u2);
    hs := eh + a * zh + b * zp; ass := ea + a * za + b * zp; m := hs - ass; tt := hs + ass;
    ok := true;
    for i in 1 .. nt loop
      if tkind[i] = 'ml' then ok := case targ[i] when 'home' then m > 0 else m < 0 end;
      elsif tkind[i] = 'tt' then
        ok := case split_part(targ[i], ':', 2) when 'over' then (case split_part(targ[i], ':', 1) when 'home' then hs else ass end) > tline[i]
                                              else (case split_part(targ[i], ':', 1) when 'home' then hs else ass end) < tline[i] end;
      elsif tkind[i] = 'spr' then ok := (case targ[i] when 'home' then m else -m end) + tline[i] > 0;
      else ok := case targ[i] when 'over' then tt > tline[i] else tt < tline[i] end; end if;
      exit when not ok;
    end loop;
    if not ok then continue; end if;
    if np = 0 then acc := acc + 1; continue; end if;
    zth := (hs - eh) / sh; zta := (ass - ea) / sh;
    uu := '{}'; ee := '{}';
    for i in 1 .. nu loop x := ls_private.lcg(x); u1 := x / 2147483647.0; x := ls_private.lcg(x); u2 := x / 2147483647.0; uu[i] := sqrt(-2 * ln(greatest(u1, 1e-12))) * cos(2 * pi() * u2); end loop;
    for i in 1 .. npid loop x := ls_private.lcg(x); u1 := x / 2147483647.0; x := ls_private.lcg(x); u2 := x / 2147483647.0; ee[i] := sqrt(-2 * ln(greatest(u1, 1e-12))) * cos(2 * pi() * u2); end loop;
    gmn := '{}'; gmx := '{}';
    for i in 1 .. ng loop gmn[i] := 2; gmx[i] := -1; end loop;
    for i in 1 .. np loop
      zt := case pside[i] when 'home' then zth else zta end;
      lv := plt[i] * zt + plu[i] * uu[pui[i]] + plp[i] * ee[ppi[i]];
      q := ls_private.phi((lv - pthr[i]) / pres[i]);              -- P(stat >= k | shared latents)
      if pdir[i] = 1 then gmn[pgi[i]] := least(gmn[pgi[i]], q); else gmx[pgi[i]] := greatest(gmx[pgi[i]], q); end if;
    end loop;
    -- several picks on the same player stat (unlimited Same Game Parlay) are one band: P(lowest "at least" <= stat < highest "under")
    w := 1;
    for i in 1 .. ng loop
      w := w * case when gmn[i] <= 1 and gmx[i] >= 0 then greatest(gmn[i] - gmx[i], 0) when gmn[i] <= 1 then gmn[i] else 1 - gmx[i] end;
    end loop;
    acc := acc + w;
  end loop;
  pj := acc / n;
  -- price
  hold := 1 - power(0.955, nl) * 0.98;
  mult := (1.0 / greatest(pj, 0.0002)) * (1 - hold);
  if mult > 50 then mult := 50; cap := true; end if;
  mult := greatest(mult, 1.01);
  return jsonb_build_object('mult', round(mult::numeric, 3), 'naive', round(naive::numeric, 3), 'p', round(pj::numeric, 5), 'pIndep', round(pnv::numeric, 5), 'n', n, 'capped', cap, 'legs', nl);
end $$;


-- markets: keep the old builder as battle_markets_v3 and wrap it
do $mk$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'battle_markets_v3') then
    alter function public.battle_markets(text, text, text) rename to battle_markets_v3;
  end if;
end $mk$;

create or replace function public.battle_markets(p_sport text, p_home text, p_away text) returns jsonb
language plpgsql stable security definer set search_path = public, ls_private, pg_temp as $$
declare m jsonb := public.battle_markets_v3(p_sport, p_home, p_away); eh float := (m ->> 'eh')::float; ea float := (m ->> 'ea')::float;
  sdm float := (m ->> 'sdm')::float; sdt float := coalesce((m ->> 'sdt')::float, (m ->> 'sdm')::float * 1.2); a float; b float; sh float;
  hl numeric; al numeric; props jsonb; r record; mu float; mr float; mb float; pe jsonb;
begin
  a := sdm / sqrt(2.0); b := sqrt(greatest((sdt * sdt - sdm * sdm) / 4.0, 0.0)); sh := greatest(sqrt(a * a + b * b), 0.5);
  hl := floor(eh) + 0.5; al := floor(ea) + 0.5;
  m := m || jsonb_build_object('tt', jsonb_build_object(
    'home', jsonb_build_object('line', hl, 'over', ls_private.p2price(1 - ls_private.phi((hl::float - eh) / sh)), 'under', ls_private.p2price(ls_private.phi((hl::float - eh) / sh))),
    'away', jsonb_build_object('line', al, 'over', ls_private.p2price(1 - ls_private.phi((al::float - ea) / sh)), 'under', ls_private.p2price(ls_private.phi((al::float - ea) / sh)))));
  if p_sport = 'mlb' and m ? 'props' then
    props := m -> 'props';
    for r in select x ->> 'pid' as pid, x ->> 'name' as nm, x ->> 'side' as sd, x ->> 'abbr' as ab, (x ->> 'mean')::float as mh from jsonb_array_elements(m -> 'props') x where x ->> 'stat' = 'hits' loop
      mr := coalesce((select (x ->> 'mean')::float from jsonb_array_elements(m -> 'props') x where x ->> 'pid' = r.pid and x ->> 'stat' = 'runs' limit 1), 0);
      mb := coalesce((select (x ->> 'mean')::float from jsonb_array_elements(m -> 'props') x where x ->> 'pid' = r.pid and x ->> 'stat' = 'rbi' limit 1), 0);
      mu := r.mh + mr + mb;
      pe := ls_private.prop_entry(r.pid, r.nm, r.sd, r.ab, 'hrr', 'Hits + Runs + RBIs', mu, 'norm', 1.15 * sqrt(mu + 0.6));
      if pe is not null then props := props || jsonb_build_array(pe); end if;
    end loop;
    m := jsonb_set(m, '{props}', props);
  end if;
  return m;
end $$;
grant execute on function public.battle_markets(text, text, text) to anon, authenticated;

-- settle finished battles every 10 seconds (pg_cron 1.5+); older versions keep the 1-minute job from setup.sql
do $cr$ begin
  perform cron.schedule('ls-battle-tick-fast', '10 seconds', 'select public.battle_tick()');
exception when others then null;
end $cr$;
