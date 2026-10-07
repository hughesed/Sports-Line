-- Battle v6: play the COMPUTER. Run ONCE in the Supabase SQL editor after setup.sql and patches v2 to v5. Safe to run again.
--
--  * A CPU player ("SportsLineCPU") exists as a normal account nobody can log in to.
--  * create_cpu_battle(...) opens a battle against it at once: it picks the opposing team (a fairly even matchup), builds its parlay
--    from the battle's real lines and player props, and locks it. You build yours and lock; the game starts 5 seconds later.
--  * How it picks a parlay ("balanced, best bets"):
--      - every leg on the board is priced against the model, then corrected by what the CPU has LEARNED (see below)
--      - it takes the best-value legs inside a target probability band, mixes team legs and player props from both teams,
--        never stacks more than 2 legs on one player or 3 on one stat, keeps its team picks on one side, skips questionable players
--      - legs: at least 4; with Unlimited legs at most 14; with 4 / 8 / 12 legs it stays inside that cap
--  * How it learns (both automatic, after every settled battle):
--      1. Calibration: for every leg type (home ML, away spread, total over, QB pass yards over, 25+ point rung, ...) it keeps a running
--         "how often did it hit vs how often the model said it would". Legs that beat the model get picked more, legs that lag get picked less.
--         It learns from BOTH slips of every battle (yours too), shrunk toward "the model is right" until there is plenty of data (range 0.80 to 1.25).
--      2. Style: it has three styles (steady = many safe legs, balanced, sharp = fewer, bolder legs) and plays them like a bandit:
--         the styles that actually beat players win more often and get chosen more often, with a little exploration.
--  * Practice rules for CPU battles: coins and your win/loss record count; Elo, the daily Board, streaks and KING badges do not.
--    The CPU matches your wager from the house (maximum wager against the CPU: 1,000 coins).

-- ---------------------------------------------------------------- the CPU account
do $$
declare cid uuid := '00000000-0000-4000-8000-00000000c0de'; col text;
begin
  if not exists (select 1 from auth.users where id = cid) then
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (cid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cpu@sportsline.invalid', '', now(),
            '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('username', 'SportsLineCPU'), now(), now());
  end if;
  -- the auth service dislikes NULL in its token columns for hand-made users: blank them where those columns exist
  for col in select column_name from information_schema.columns where table_schema = 'auth' and table_name = 'users'
             and column_name in ('confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change', 'email_change_token_current', 'reauthentication_token', 'phone_change', 'phone_change_token') loop
    execute format('update auth.users set %I = %L where id = %L and %I is null', col, '', cid, col);
  end loop;
  if not exists (select 1 from public.profiles where id = cid) then
    perform ls_private.new_profile(cid, 'SportsLineCPU');
  end if;
end $$;

create or replace function ls_private.cpu_id() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-00000000c0de'::uuid $$;

-- ---------------------------------------------------------------- what the CPU remembers
create table if not exists public.cpu_brain(
  sport text not null, cat text not null,
  n int not null default 0, pred double precision not null default 0, hit double precision not null default 0,
  primary key (sport, cat)
);
create table if not exists public.cpu_arms(
  sport text not null, arm text not null,
  plays int not null default 0, wins double precision not null default 0,
  primary key (sport, arm)
);
create table if not exists public.cpu_battles(
  battle_id bigint primary key references public.battles(id) on delete cascade,
  arm text not null
);
alter table public.cpu_brain enable row level security;
alter table public.cpu_arms enable row level security;
alter table public.cpu_battles enable row level security;
revoke all on table public.cpu_brain, public.cpu_arms, public.cpu_battles from anon, authenticated;

-- ---------------------------------------------------------------- small helpers
-- the model's own chance behind a battle price: undo the 10% battle boost and the 4.5% hold
create or replace function ls_private.cpu_unboost_p(price int) returns double precision language sql immutable as $$
  select least(0.97, greatest(0.03, (1.0 / (1 + (ls_private.dec_of(price) - 1) / 1.10)) / 1.045))::double precision
$$;
-- the leg's type, the unit the CPU learns about
create or replace function ls_private.cpu_cat(leg jsonb) returns text language sql immutable as $$
  select case leg ->> 'kind'
    when 'ml' then 'ml:' || coalesce(leg ->> 'side', '')
    when 'spr' then 'spr:' || coalesce(leg ->> 'side', '')
    when 'tot' then 'tot:' || coalesce(leg ->> 'dir', '')
    when 'p' then 'p:' || coalesce(leg ->> 'stat', '') || ':' || coalesce(leg ->> 'dir', '')
    when 'x' then 'x:' || coalesce(leg ->> 'stat', '')
    else coalesce(leg ->> 'kind', 'other') end
$$;
-- learned correction for a leg type: (hits + 30) / (expected hits + 30), kept between 0.80 and 1.25
create or replace function ls_private.cpu_calib(p_sport text, p_cat text) returns double precision
language sql stable security definer set search_path = public, ls_private, pg_temp as $$
  select coalesce((select least(1.25, greatest(0.80, (hit + 30.0) / (pred + 30.0))) from public.cpu_brain where sport = p_sport and cat = p_cat), 1.0)::double precision
$$;
-- choose a playing style (steady / balanced / sharp): best record so far, plus an exploration bonus and a little noise
create or replace function ls_private.cpu_pick_arm(p_sport text) returns text
language plpgsql volatile security definer set search_path = public, ls_private, pg_temp as $$
declare v_tot double precision; v_arm text;
begin
  select coalesce(sum(plays), 0) into v_tot from public.cpu_arms where sport = p_sport;
  select a.arm into v_arm
    from (values ('steady'), ('balanced'), ('sharp')) a(arm)
    left join public.cpu_arms r on r.sport = p_sport and r.arm = a.arm
    order by (coalesce(r.wins, 0) + 2.0) / (coalesce(r.plays, 0) + 4.0)
             + 0.18 * sqrt(ln(v_tot + 2.0) / (coalesce(r.plays, 0) + 2.0))
             + random() * 0.06 desc
    limit 1;
  return coalesce(v_arm, 'balanced');
end $$;

-- ---------------------------------------------------------------- the CPU builds and locks its parlay
create or replace function ls_private.cpu_build(p_id bigint) returns void
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare
  b public.battles; v_cpu uuid := ls_private.cpu_id(); mk jsonb; v_arm text; v_free boolean; v_max int; v_min int; v_n int; v_lo double precision; v_hi double precision;
  v_target double precision; v_flo double precision; v_fhi double precision; v_bad text[]; v_sides jsonb; cands jsonb; c jsonb; pass int; v_chosen jsonb := '[]'::jsonb;
  v_toks text[] := '{}'; v_grps text[] := '{}'; v_pids text[] := '{}'; v_stats text[] := '{}'; v_cnt int := 0; v_teamside text := null; v_side text; v_pid text; v_stat text;
  v_home_cnt int := 0; v_away_cnt int := 0; v_k text; v_p double precision; q jsonb; nv numeric := 1; v_cf text; v_cap_side int; v_pcount int; v_scount int; v_tmp jsonb;
begin
  select * into b from public.battles where id = p_id;
  if not found or b.status <> 'building' then return; end if;
  mk := b.markets;
  v_free := (b.fmt = 'sgp' and b.max_legs = 0);
  v_max := case when b.max_legs = 0 then 14 else least(b.max_legs, 14) end;          -- unlimited: the CPU stops at 14 legs
  v_min := least(4, v_max);                                                          -- and never goes below 4
  v_arm := ls_private.cpu_pick_arm(b.sport);
  -- style: target chance per leg, the band it accepts, and how much of the 4..max leg range it uses
  if v_arm = 'steady' then v_target := 0.78; v_lo := 0.64; v_hi := 0.92; v_flo := 0.55; v_fhi := 1.00;
  elsif v_arm = 'sharp' then v_target := 0.58; v_lo := 0.42; v_hi := 0.74; v_flo := 0.00; v_fhi := 0.40;
  else v_target := 0.68; v_lo := 0.52; v_hi := 0.84; v_flo := 0.25; v_fhi := 0.70; end if;
  v_n := v_min + round((v_max - v_min) * (v_flo + random() * (v_fhi - v_flo)))::int;
  v_n := least(greatest(v_n, v_min), v_max);

  -- questionable players are skipped; remember which side each player is on
  v_bad := coalesce((select array_agg(x ->> 'pid') from jsonb_array_elements(coalesce(mk -> 'players', '[]'::jsonb)) x where nullif(x ->> 'inj', '') is not null), '{}');
  v_sides := coalesce((select jsonb_object_agg(x ->> 'pid', x ->> 'side') from jsonb_array_elements(coalesce(mk -> 'props', '[]'::jsonb)) x), '{}'::jsonb);

  -- every leg on the board, scored: chance (model x learned correction), value (chance x payout), closeness to the style's target chance
  select coalesce(jsonb_agg(z.o order by z.score desc), '[]'::jsonb) into cands from (
    select l.l || jsonb_build_object('p', l.p, 'ev', l.p * ls_private.dec_of((l.l ->> 'price')::int)) as o,
           l.p * ls_private.dec_of((l.l ->> 'price')::int) * greatest(0.2, 1 - 0.6 * abs(l.p - v_target)) * (0.94 + random() * 0.12) as score
    from (
      select t.l, least(0.97, greatest(0.03, ls_private.cpu_unboost_p((t.l ->> 'price')::int) * ls_private.cpu_calib(b.sport, ls_private.cpu_cat(t.l)))) as p
      from (
        select ls_private.battle_leg(mk, tk.tok, false) as l from (
          select u as tok from unnest(array['ml:home', 'ml:away', 'spr:home', 'spr:away', 'tot:over', 'tot:under']) u
          union all select 'h1ml:home' where b.fmt = 'parlay' and mk ? 'h1'
          union all select 'h1ml:away' where b.fmt = 'parlay' and mk ? 'h1'
          union all select 'p:' || (pr ->> 'pid') || ':' || (pr ->> 'stat') || ':' || d
            from jsonb_array_elements(coalesce(mk -> 'props', '[]'::jsonb)) pr, unnest(array['over', 'under']) d
            where not coalesce((pr ->> 'yn')::boolean, false) and not ((pr ->> 'pid') = any(v_bad))
          union all select 'x:' || (pr ->> 'pid') || ':' || (pr ->> 'stat') || ':' || (r ->> 'n')
            from jsonb_array_elements(coalesce(mk -> 'props', '[]'::jsonb)) pr, jsonb_array_elements(coalesce(pr -> 'rungs', '[]'::jsonb)) r
            where not ((pr ->> 'pid') = any(v_bad))
        ) tk
      ) t where t.l is not null and (t.l ->> 'price') is not null
    ) l
  ) z;

  -- greedy pick: pass 1 stays inside the band, pass 2 widens it, pass 3 takes anything that still fits the balance rules
  for pass in 1 .. 3 loop
    exit when v_cnt >= v_n;
    for c in select x from jsonb_array_elements(cands) x loop
      exit when v_cnt >= v_n;
      v_k := c ->> 'tok'; v_p := (c ->> 'p')::double precision;
      continue when v_k = any(v_toks);
      continue when (c ->> 'grp') = any(v_grps);
      if pass = 1 and (v_p < v_lo or v_p > v_hi) then continue; end if;
      if pass = 2 and (v_p < v_lo - 0.12 or v_p > least(v_hi + 0.08, 0.95)) then continue; end if;
      v_side := null; v_pid := null; v_stat := null;
      if c ->> 'kind' in ('p', 'x') then
        v_pid := c ->> 'pid'; v_stat := c ->> 'stat'; v_side := v_sides ->> v_pid;
        select count(*) into v_pcount from unnest(v_pids) u where u = v_pid;
        select count(*) into v_scount from unnest(v_stats) u where u = v_stat;
        continue when v_pcount >= 2 or v_scount >= 3;
        -- keep the player legs spread over both teams (no more than about 60% from one side)
        v_cap_side := greatest(2, ceil(v_n * 0.6)::int);
        continue when v_side = 'home' and v_home_cnt >= v_cap_side;
        continue when v_side = 'away' and v_away_cnt >= v_cap_side;
      elsif c ->> 'kind' in ('ml', 'spr', 'h1ml') then
        v_side := c ->> 'side';
        continue when v_teamside is not null and v_teamside <> v_side;               -- one side for all the team-result legs
      end if;
      -- accept it
      v_chosen := v_chosen || jsonb_build_array(c - 'p' - 'ev');
      v_toks := v_toks || v_k; v_grps := v_grps || (c ->> 'grp'); v_cnt := v_cnt + 1;
      if c ->> 'kind' in ('p', 'x') then
        v_pids := v_pids || v_pid; v_stats := v_stats || v_stat;
        if v_side = 'home' then v_home_cnt := v_home_cnt + 1; elsif v_side = 'away' then v_away_cnt := v_away_cnt + 1; end if;
      elsif c ->> 'kind' in ('ml', 'spr', 'h1ml') then v_teamside := v_side; end if;
    end loop;
  end loop;

  if v_cnt = 0 then return; end if;                                -- nothing to pick from (the battle then times out and refunds as usual)
  if b.fmt = 'sgp' and v_cnt < 2 then return; end if;
  if v_free then v_cf := ls_private.slip_conflict(v_chosen); if v_cf is not null then raise exception 'CPU slip conflict: %', v_cf; end if; end if;

  -- price it exactly the way set_battle_parlay does
  select coalesce(exp(sum(ln(ls_private.dec_of((x ->> 'price')::int)))), 1) into nv from jsonb_array_elements(v_chosen) x;
  if b.fmt = 'sgp' then q := ls_private.boost_q(ls_private.sgp_price(mk, v_chosen, 3000));
  else q := jsonb_build_object('mult', round(nv, 3), 'naive', round(nv, 3), 'legs', v_cnt); end if;
  q := q || jsonb_build_object('toks', (select coalesce(jsonb_agg(l ->> 'tok' order by l ->> 'tok'), '[]'::jsonb) from jsonb_array_elements(v_chosen) l), 'fmt', b.fmt);
  update public.battle_parlays set legs = v_chosen, quote = q, locked = true, updated_at = public.app_now() where battle_id = p_id and user_id = v_cpu;
  insert into public.cpu_battles(battle_id, arm) values (p_id, v_arm) on conflict (battle_id) do update set arm = excluded.arm;
end $$;

-- ---------------------------------------------------------------- start a battle against the computer
drop function if exists public.create_cpu_battle(text, text, numeric, text, int, int);
create or replace function public.create_cpu_battle(p_sport text, p_home text, p_wager numeric, p_fmt text default 'parlay', p_max_legs int default 8, p_minutes int default 4) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare
  uid uuid := auth.uid(); v_cpu uuid := ls_private.cpu_id(); w numeric := round(coalesce(p_wager, 0), 2); fm text := coalesce(p_fmt, 'parlay'); bid bigint; bal numeric; cb numeric;
  v_has boolean; r record; m jsonb; best jsonb := null; bestd double precision := 9; bestab text := null; bestd2 double precision := 9; anyab text := null; anym jsonb := null; mk jsonb; ec numeric; eo numeric; pc double precision; cn text; v_ph double precision;
begin
  if uid is null then raise exception 'Sign in to battle'; end if;
  if uid = v_cpu then raise exception 'Not available'; end if;
  if p_sport not in ('nfl', 'nba', 'mlb', 'cfb', 'cbb') then raise exception 'Pick NFL, NBA, MLB, college football or college basketball'; end if;
  if fm not in ('parlay', 'sgp') then raise exception 'Pick Parlay or Same Game Parlay'; end if;
  if not exists (select 1 from public.sim_teams where sport = p_sport and abbr = p_home) then raise exception 'Pick your team'; end if;
  if w < 1 then raise exception 'The wager must be at least 1 coin'; end if;
  if w > 1000 then raise exception 'The most you can wager against the computer is 1,000 coins'; end if;
  if p_max_legs not in (0, 4, 8, 12) then raise exception 'Parlay size must be 4, 8, 12 or unlimited'; end if;
  if p_minutes is null or p_minutes < 2 or p_minutes > 8 then raise exception 'Game length must be 2 to 8 minutes'; end if;
  if (select count(*) from public.battles where creator = uid and status in ('open', 'building')) >= 3 then raise exception 'You already have 3 open battles'; end if;
  perform public.battle_tick();

  -- the CPU's team: a fairly even matchup (your team's win chance closest to 50%) among a handful of random teams, preferring ones with player props
  v_has := (select count(*) from public.sim_players where sport = p_sport and team = p_home) >= 8;
  for r in select abbr from public.sim_teams where sport = p_sport and abbr <> p_home order by random() limit 8 loop
    m := public.battle_markets(p_sport, p_home, r.abbr);
    v_ph := coalesce((m ->> 'pHome')::double precision, 0.5);
    if coalesce(jsonb_array_length(m -> 'props'), 0) >= 8 or not v_has then
      if abs(v_ph - 0.5) < bestd then bestd := abs(v_ph - 0.5); bestab := r.abbr; best := m; end if;
    elsif abs(v_ph - 0.5) < bestd2 then bestd2 := abs(v_ph - 0.5); anyab := r.abbr; anym := m; end if;
  end loop;
  if bestab is null then bestab := anyab; best := anym; end if;       -- no team with props found: team lines only
  if bestab is null then raise exception 'Could not find an opponent team right now, try again'; end if;
  mk := ls_private.boost_json(best);

  -- the house matches the wager
  select balance into cb from public.profiles where id = v_cpu;
  if cb < w then perform ls_private.move_coins(v_cpu, w - cb + 100, 'cpu_house', 'house top-up'); end if;

  insert into public.battles(sport, fmt, home, away, wager, creator, creator_side, opponent, opponent_side, status, accepted_at, markets, max_legs, duration_min)
    values (p_sport, fm, p_home, bestab, w, uid, 'home', v_cpu, 'away', 'building', public.app_now(), mk, p_max_legs, p_minutes) returning id into bid;
  bal := ls_private.move_coins(uid, -w, 'battle_escrow', 'battle ' || bid);
  perform ls_private.move_coins(v_cpu, -w, 'battle_escrow', 'battle ' || bid);
  insert into public.battle_stats(user_id, sport) values (uid, p_sport) on conflict do nothing;
  insert into public.battle_stats(user_id, sport) values (v_cpu, p_sport) on conflict do nothing;
  select elo into ec from public.battle_stats where user_id = uid and sport = p_sport;
  select elo into eo from public.battle_stats where user_id = v_cpu and sport = p_sport;
  select username into cn from public.profiles where id = uid;
  pc := 1 / (1 + power(10, (eo - ec) / 400.0));
  update public.battles set markets = mk || jsonb_build_object('winner', jsonb_build_object('creator', ls_private.est_price(pc::numeric), 'opponent', ls_private.est_price((1 - pc)::numeric),
      'creatorName', cn, 'opponentName', 'SportsLineCPU', 'pCreator', round(pc::numeric, 3)))
    where id = bid;
  insert into public.battle_parlays(battle_id, user_id) values (bid, uid), (bid, v_cpu) on conflict do nothing;
  perform ls_private.add_action(uid);
  perform ls_private.cpu_build(bid);
  return jsonb_build_object('id', bid, 'balance', bal, 'cpu_team', bestab);
end $$;
grant execute on function public.create_cpu_battle(text, text, numeric, text, int, int) to authenticated;

-- ---------------------------------------------------------------- learning (runs when a battle settles)
create or replace function ls_private.cpu_learn(p_id bigint) returns void
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare b public.battles; pp record; leg jsonb; v_res text; v_p double precision; v_cat text; v_cpu uuid := ls_private.cpu_id(); v_arm text; v_score double precision;
begin
  select * into b from public.battles where id = p_id;
  if not found or b.status <> 'final' then return; end if;
  -- 1. calibration: what the model said vs what happened, for every settled leg of both slips
  for pp in select graded from public.battle_parlays where battle_id = p_id loop
    for leg in select x from jsonb_array_elements(coalesce(pp.graded, '[]'::jsonb)) x loop
      v_res := leg ->> 'res';
      if v_res is null or v_res not in ('W', 'L') or (leg ->> 'price') is null then continue; end if;
      v_p := ls_private.cpu_unboost_p((leg ->> 'price')::int);
      v_cat := ls_private.cpu_cat(leg);
      insert into public.cpu_brain(sport, cat, n, pred, hit) values (b.sport, v_cat, 1, v_p, case when v_res = 'W' then 1 else 0 end)
        on conflict (sport, cat) do update set n = public.cpu_brain.n + 1, pred = public.cpu_brain.pred + excluded.pred, hit = public.cpu_brain.hit + excluded.hit;
    end loop;
  end loop;
  -- 2. style: did the CPU beat its opponent with this style?
  if b.creator = v_cpu or b.opponent = v_cpu then
    select arm into v_arm from public.cpu_battles where battle_id = p_id;
    if v_arm is not null then
      v_score := case when coalesce((b.result ->> 'split')::boolean, false) then 0.5 when b.winner = v_cpu then 1 else 0 end;
      insert into public.cpu_arms(sport, arm, plays, wins) values (b.sport, v_arm, 1, v_score)
        on conflict (sport, arm) do update set plays = public.cpu_arms.plays + 1, wins = public.cpu_arms.wins + excluded.wins;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------- settling (patch v5 + CPU rules + learning)
create or replace function ls_private.settle_battle_internal(p_id bigint) returns text
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare b public.battles; r public.battle_results; gc jsonb; go jsonb; pc numeric; po numeric; hc int; ho int; win uuid := null; lose uuid; s record;
  res text; pay numeric; split boolean := false; bonus numeric := 0; v_cpu uuid := ls_private.cpu_id(); vs_cpu boolean;
begin
  select * into b from public.battles where id = p_id for update;
  if not found or b.status <> 'live' or b.ends_at > public.app_now() then return null; end if;
  vs_cpu := (b.creator = v_cpu or b.opponent = v_cpu);
  select * into r from public.battle_results where battle_id = p_id;
  gc := ls_private.grade_parlay(b.markets, (select legs from public.battle_parlays where battle_id = p_id and user_id = b.creator), r.home_score, r.away_score, r.players, (select quote from public.battle_parlays where battle_id = p_id and user_id = b.creator));
  go := ls_private.grade_parlay(b.markets, (select legs from public.battle_parlays where battle_id = p_id and user_id = b.opponent), r.home_score, r.away_score, r.players, (select quote from public.battle_parlays where battle_id = p_id and user_id = b.opponent));
  update public.battle_parlays set payout = (gc ->> 'payout')::numeric, hits = (gc ->> 'hits')::int, graded = gc -> 'legs' where battle_id = p_id and user_id = b.creator;
  update public.battle_parlays set payout = (go ->> 'payout')::numeric, hits = (go ->> 'hits')::int, graded = go -> 'legs' where battle_id = p_id and user_id = b.opponent;
  pc := (gc ->> 'payout')::numeric; po := (go ->> 'payout')::numeric; hc := (gc ->> 'hits')::int; ho := (go ->> 'hits')::int;
  -- the slip that pays more wins; if both pay the same (e.g. both lost): more legs hit wins; still tied: split the pot
  if pc > po then win := b.creator; elsif po > pc then win := b.opponent;
  elsif hc > ho then win := b.creator; elsif ho > hc then win := b.opponent; else split := true; end if;
  if split then
    perform ls_private.move_coins(b.creator, b.wager, 'battle_payout', 'battle ' || p_id || ' split');
    perform ls_private.move_coins(b.opponent, b.wager, 'battle_payout', 'battle ' || p_id || ' split');
    if vs_cpu then
      update public.battle_stats set t = t + 1 where user_id in (b.creator, b.opponent) and sport = b.sport;     -- record only: no Elo against the CPU
    else perform ls_private.elo_update(b.sport, b.creator, b.opponent, 0.5); end if;
  else
    lose := case when win = b.creator then b.opponent else b.creator end;
    -- Winning a battle also earns a 10% bonus based on the total payout of the winning parlay (not for the house).
    bonus := case when win = v_cpu then 0 else round((case when win = b.creator then pc else po end) * 0.10, 2) end;
    perform ls_private.move_coins(win, b.wager * 2, 'battle_payout', 'battle ' || p_id || ' won');
    if bonus > 0 then
      perform ls_private.move_coins(win, bonus, 'battle_bonus', 'battle ' || p_id || ' · 10% parlay payout bonus');
    end if;
    if vs_cpu then
      update public.battle_stats set w = w + 1 where user_id = win and sport = b.sport;                           -- record only: no Elo, Board or streak against the CPU
      update public.battle_stats set l = l + 1 where user_id = lose and sport = b.sport;
    else
      perform ls_private.add_net(win, b.wager + bonus);
      perform ls_private.add_net(lose, -b.wager);
      perform ls_private.elo_update(b.sport, win, lose, 1);
      perform ls_private.streak(win, 'W'); perform ls_private.streak(lose, 'L');
    end if;
  end if;
  update public.battles set status = 'final', settled_at = public.app_now(), winner = win,
    result = jsonb_build_object('hs', r.home_score, 'as', r.away_score, 'split', split, 'bonus', bonus, 'creator', jsonb_build_object('payout', pc, 'hits', hc), 'opponent', jsonb_build_object('payout', po, 'hits', ho))
    where id = p_id;
  -- spectator bets: paid at their odds; they never touch anyone's battle record
  for s in select * from public.spectator_bets where battle_id = p_id and status = 'pending' for update loop
    if s.tok like 'win:%' then
      res := case when split then 'V' when (s.tok = 'win:creator') = (win = b.creator) then 'W' else 'L' end;
    else res := ls_private.grade_battle_leg(b.markets, s.tok, r.home_score, r.away_score, r.players); end if;
    if res = 'W' then pay := round(s.stake * ls_private.dec_of(s.price), 2);
      update public.spectator_bets set status = 'won', payout = pay, settled_at = public.app_now() where id = s.id;
      perform ls_private.move_coins(s.user_id, pay, 'spectator_payout', 'battle ' || p_id);
      perform ls_private.add_net(s.user_id, pay - s.stake);
    elsif res = 'L' then
      update public.spectator_bets set status = 'lost', payout = 0, settled_at = public.app_now() where id = s.id;
      perform ls_private.add_net(s.user_id, -s.stake);
    else
      update public.spectator_bets set status = 'void', payout = s.stake, settled_at = public.app_now() where id = s.id;
      perform ls_private.move_coins(s.user_id, s.stake, 'spectator_refund', 'battle ' || p_id);
    end if;
  end loop;
  -- the CPU learns from every settled battle; a problem here must never block a payout
  begin
    perform ls_private.cpu_learn(p_id);
  exception when others then null;
  end;
  return 'final';
end $$;

-- ---------------------------------------------------------------- what the page shows about the CPU
create or replace function public.cpu_status() returns jsonb
language plpgsql stable security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); v_cpu uuid := ls_private.cpu_id();
begin
  return jsonb_build_object(
    'name', 'SportsLineCPU',
    'legs_learned', coalesce((select sum(n) from public.cpu_brain), 0),
    'battles', coalesce((select sum(plays) from public.cpu_arms), 0),
    'cpu_wins', coalesce((select sum(wins) from public.cpu_arms), 0),
    'styles', coalesce((select jsonb_agg(jsonb_build_object('sport', sport, 'arm', arm, 'plays', plays, 'wins', wins) order by sport, arm) from public.cpu_arms), '[]'::jsonb),
    'you', case when uid is null then null else jsonb_build_object(
      'w', (select count(*) from public.battles where creator = uid and opponent = v_cpu and status = 'final' and winner = uid),
      'l', (select count(*) from public.battles where creator = uid and opponent = v_cpu and status = 'final' and winner = v_cpu),
      't', (select count(*) from public.battles where creator = uid and opponent = v_cpu and status = 'final' and winner is null)) end);
end $$;
grant execute on function public.cpu_status() to anon, authenticated;
