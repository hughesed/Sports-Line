-- Battle v4. Run ONCE in the Supabase SQL editor, after setup.sql and the earlier battle patches (v2, v3). Safe to run again.
--  1. The creator now picks only a sport, THEIR team and the settings, then waits for a challenger.
--     The challenger picks the opposing team when accepting. Rosters, injuries and prices are frozen at that moment.
--  2. Unlimited-legs Same Game Parlays accept every option (several picks from one market, e.g. a 20+ and a 30+ rung,
--     both spreads' alternates, spread + moneyline + total of the same game); the SGP price is recomputed for the whole slip.
--     Picks that cannot both happen (both moneylines, over + under, ...) are refused.
alter table public.battles alter column away drop not null;

drop function if exists public.create_battle(text, text, text, numeric, text, text, int, int);
drop function if exists public.create_battle(text, text, numeric, text, int, int);
create or replace function public.create_battle(p_sport text, p_home text, p_wager numeric, p_fmt text default 'parlay', p_max_legs int default 8, p_minutes int default 4) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); w numeric := round(coalesce(p_wager, 0), 2); bid bigint; bal numeric; fm text := coalesce(p_fmt, 'parlay');
begin
  if uid is null then raise exception 'Sign in to battle'; end if;
  if p_sport not in ('nfl', 'nba', 'mlb', 'cfb', 'cbb') then raise exception 'Pick NFL, NBA, MLB, college football or college basketball'; end if;
  if fm not in ('parlay', 'sgp') then raise exception 'Pick Parlay or Same Game Parlay'; end if;
  if not exists (select 1 from public.sim_teams where sport = p_sport and abbr = p_home) then raise exception 'Pick your team'; end if;
  if w < 1 then raise exception 'The wager must be at least 1 coin'; end if;
  if w > 100000 then raise exception 'That wager is too large'; end if;
  if p_max_legs not in (0, 4, 8, 12) then raise exception 'Parlay size must be 4, 8, 12 or unlimited'; end if;
  if p_minutes is null or p_minutes < 2 or p_minutes > 8 then raise exception 'Game length must be 2 to 8 minutes'; end if;
  if (select count(*) from public.battles where creator = uid and status in ('open', 'building')) >= 3 then raise exception 'You already have 3 open battles'; end if;
  perform public.battle_tick();
  -- the creator's team is the home team; the away team (and with it the lines, rosters and injuries) is set when a challenger accepts
  insert into public.battles(sport, fmt, home, away, wager, creator, creator_side, markets, max_legs, duration_min)
    values (p_sport, fm, p_home, null, w, uid, 'home', '{}'::jsonb, p_max_legs, p_minutes) returning id into bid;
  bal := ls_private.move_coins(uid, -w, 'battle_escrow', 'battle ' || bid);
  insert into public.battle_stats(user_id, sport) values (uid, p_sport) on conflict do nothing;
  perform ls_private.add_action(uid);
  return jsonb_build_object('id', bid, 'balance', bal);
end $$;
grant execute on function public.create_battle(text, text, numeric, text, int, int) to authenticated;

drop function if exists public.accept_battle(bigint, text);
create or replace function public.accept_battle(p_id bigint, p_team text default null) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); b public.battles; bal numeric; ec numeric; eo numeric; pc double precision; side text; cn text; onm text; mk jsonb; away_ text;
begin
  if uid is null then raise exception 'Sign in to battle'; end if;
  perform public.battle_tick();
  select * into b from public.battles where id = p_id for update;
  if not found then raise exception 'No such battle'; end if;
  if b.creator = uid then raise exception 'You cannot accept your own battle'; end if;
  if b.status <> 'open' or b.opponent is not null then raise exception 'This battle is no longer open'; end if;
  if b.away is null then                                               -- new style: the challenger picks the team they play
    away_ := p_team;
    if away_ is null or not exists (select 1 from public.sim_teams where sport = b.sport and abbr = away_) then raise exception 'Pick your team'; end if;
    if away_ = b.home then raise exception 'Pick a different team than %', b.home; end if;
    side := 'away';
    mk := ls_private.boost_json(public.battle_markets(b.sport, b.home, away_));   -- rosters, injuries and lines are frozen right now
  else                                                                 -- battles created before v4: the opponent gets the other team
    away_ := b.away; mk := b.markets;
    side := case b.creator_side when 'home' then 'away' else 'home' end;
  end if;
  bal := ls_private.move_coins(uid, -b.wager, 'battle_escrow', 'battle ' || p_id);
  insert into public.battle_stats(user_id, sport) values (uid, b.sport) on conflict do nothing;
  insert into public.battle_stats(user_id, sport) values (b.creator, b.sport) on conflict do nothing;
  select elo into ec from public.battle_stats where user_id = b.creator and sport = b.sport;
  select elo into eo from public.battle_stats where user_id = uid and sport = b.sport;
  select username into cn from public.profiles where id = b.creator;
  select username into onm from public.profiles where id = uid;
  pc := 1 / (1 + power(10, (eo - ec) / 400.0));
  update public.battles set opponent = uid, opponent_side = side, away = away_, status = 'building', accepted_at = public.app_now(),
    markets = mk || jsonb_build_object('winner', jsonb_build_object('creator', ls_private.est_price(pc::numeric), 'opponent', ls_private.est_price((1 - pc)::numeric),
      'creatorName', cn, 'opponentName', onm, 'pCreator', round(pc::numeric, 3)))
    where id = p_id;
  insert into public.battle_parlays(battle_id, user_id) values (p_id, b.creator), (p_id, uid) on conflict do nothing;
  perform ls_private.add_action(uid);
  return jsonb_build_object('ok', true, 'balance', bal);
end $$;
grant execute on function public.accept_battle(bigint, text) to authenticated;

-- picks that can never both be true (used by unlimited Same Game Parlays, where several picks per market are allowed)
create or replace function ls_private.slip_conflict(legs jsonb) returns text language plpgsql immutable as $$
declare a jsonb; b jsonb; i int; j int; n int := coalesce(jsonb_array_length(legs), 0); ga int; gb int; la int; lb int;
begin
  for i in 0 .. n - 1 loop
    for j in i + 1 .. n - 1 loop
      a := legs -> i; b := legs -> j;
      if (a ->> 'grp') is distinct from (b ->> 'grp') then continue; end if;
      if (a ->> 'kind') in ('ml', 'spr') and (a ->> 'kind') = (b ->> 'kind') and (a ->> 'side') <> (b ->> 'side') then return (a ->> 'label') || ' and ' || (b ->> 'label'); end if;
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

create or replace function public.set_battle_parlay(p_id bigint, p_legs jsonb) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare v_cap int; uid uuid := auth.uid(); b public.battles; pp public.battle_parlays; n int; i int; leg jsonb; v_legs jsonb := '[]'::jsonb; grps text[] := '{}'; toks text[] := '{}'; free boolean; cf text; q jsonb; nv numeric := 1;
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
  free := (b.fmt = 'sgp' and b.max_legs = 0);                       -- unlimited Same Game Parlay: every option is selectable, the price adjusts
  if n > v_cap then raise exception 'This battle allows at most % legs', v_cap; end if;
  for i in 0 .. n - 1 loop
    leg := ls_private.battle_leg(b.markets, p_legs ->> i, false);
    if leg is null then raise exception 'Unknown battle market'; end if;
    if b.fmt = 'sgp' and ((leg ->> 'kind') in ('h1ml', 'sl')) then raise exception 'Halftime bets and line sliders are for Parlay battles'; end if;
    if (leg ->> 'tok') = any(toks) then raise exception 'Already in your slip: %', leg ->> 'label'; end if;
    if (leg ->> 'grp') = any(grps) and not free then raise exception 'One pick per market: %', leg ->> 'label'; end if;
    toks := toks || (leg ->> 'tok'); grps := grps || (leg ->> 'grp'); v_legs := v_legs || jsonb_build_array(leg);
    nv := nv * ls_private.dec_of((leg ->> 'price')::int);
  end loop;
  if free then cf := ls_private.slip_conflict(v_legs); if cf is not null then raise exception 'These picks cannot both happen: %', cf; end if; end if;
  -- the slip's price: straight multiplication (Parlay) or the correlated Same Game Parlay price from the simulator model
  if n >= 1 and b.fmt = 'sgp' then q := ls_private.boost_q(ls_private.sgp_price(b.markets, v_legs, 3000));
  else q := jsonb_build_object('mult', round(nv, 3), 'naive', round(nv, 3), 'legs', n); end if;
  q := q || jsonb_build_object('toks', (select coalesce(jsonb_agg(l ->> 'tok' order by l ->> 'tok'), '[]'::jsonb) from jsonb_array_elements(v_legs) l), 'fmt', b.fmt);
  update public.battle_parlays set legs = v_legs, quote = q, updated_at = public.app_now() where battle_id = p_id and user_id = uid;
  return jsonb_build_object('ok', true, 'legs', v_legs, 'quote', q);
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
    if l ->> 'kind' in ('ml', 'spr', 'tot') then
      nt := nt + 1; tkind := tkind || (l ->> 'kind'); targ := targ || coalesce(l ->> 'side', l ->> 'dir'); tline := tline || coalesce((l ->> 'line')::float, 0);
      pfair := case l ->> 'kind'
        when 'ml' then ls_private.phi(case l ->> 'side' when 'home' then (eh - ea) else (ea - eh) end / sdm)
        when 'spr' then ls_private.phi((case l ->> 'side' when 'home' then (eh - ea) else (ea - eh) end + (l ->> 'line')::float) / sdm)
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

-- spectators can bet only once a challenger has joined (before that there are no lines yet)
create or replace function public.place_spectator_bet(p_id bigint, p_tok text, p_stake numeric) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); b public.battles; leg jsonb; st numeric := round(coalesce(p_stake, 0), 2); bal numeric; sid bigint;
begin
  if uid is null then raise exception 'Sign in to bet'; end if;
  select * into b from public.battles where id = p_id for update;
  if not found then raise exception 'No such battle'; end if;
  if b.status not in ('open', 'building') then raise exception 'Betting closed when the game started'; end if;
  if uid = b.creator or uid is not distinct from b.opponent then raise exception 'Players cannot bet on their own battle'; end if;
  if b.away is null then raise exception 'Bets open once a challenger joins this battle'; end if;
  if st < 1 then raise exception 'Bet at least 1 coin'; end if;
  if st > 100000 then raise exception 'That stake is too large'; end if;
  if p_tok like 'p:%' or p_tok like 'x:%' then raise exception 'Spectators bet on the game lines and the battle winner'; end if;
  leg := ls_private.battle_leg(b.markets, p_tok, true);
  if leg is null then raise exception 'That market is not open%', case when p_tok like 'win:%' then ' until someone accepts the battle' else '' end; end if;
  bal := ls_private.move_coins(uid, -st, 'spectator_stake', 'battle ' || p_id);
  insert into public.spectator_bets(battle_id, user_id, tok, label, price, stake) values (p_id, uid, p_tok, leg ->> 'label', (leg ->> 'price')::int, st) returning id into sid;
  perform ls_private.add_action(uid);
  return jsonb_build_object('ok', true, 'id', sid, 'balance', bal, 'price', (leg ->> 'price')::int, 'label', leg ->> 'label');
end $$;
