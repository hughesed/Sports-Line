-- NHL hockey and tennis in battles. Run ONCE in the Supabase SQL Editor AFTER patch_wnba.sql and patch_shop_v8.sql. Safe to run twice.
--  * NHL: team ratings (goals) from the bot, Poisson goals, overtime / shootout so a game never ends tied. Money line, puck line (+/-1.5), total goals, team totals.
--  * Tennis: one match between two players (best of 3 sets). Scores are TOTAL GAMES won, so the money line is "most games", the spread is a games handicap
--    and the total is total games. Prices come from simulating 2000 matches with a fixed seed (the same matchup always shows the same prices).
--  * No player props for either sport (the bot has no hockey / tennis stat lines yet): team markets only, Parlay and Same Game Parlay both work.
--  * Nothing that already exists changes for the other six sports: the original markets function is kept as battle_markets_core_base and called for them.
-- Sports lists inside create_battle / create_cpu_battle / award_day are the only existing functions that are replaced (copied with the two sports added).

alter table public.battles drop constraint if exists battles_sport_check;
alter table public.battles add constraint battles_sport_check check (sport in ('nfl','nba','wnba','mlb','cfb','cbb','nhl','tennis'));

create or replace function ls_private.sport_sd(p_sport text, which text) returns double precision language sql immutable as $$
  select case p_sport when 'nfl' then case which when 'm' then 14.5 else 14.6 end
                      when 'cfb' then case which when 'm' then 17.0 else 17.0 end
                      when 'nba' then case which when 'm' then 13.0 else 18.0 end
                      when 'wnba' then case which when 'm' then 12.0 else 15.0 end
                      when 'cbb' then case which when 'm' then 11.0 else 13.0 end
                      when 'nhl' then case which when 'm' then 2.35 else 2.4 end
                      when 'tennis' then case which when 'm' then 5.2 else 4.6 end
                      else case which when 'm' then 4.2 else 4.4 end end
$$;

create or replace function ls_private.exp_points(p_sport text, p_home text, p_away text) returns double precision[]
language plpgsql stable security definer set search_path = public, ls_private, pg_temp as $$
declare th public.sim_teams; ta public.sim_teams; eh double precision; ea double precision; lo double precision; hi double precision; pg double precision;
begin
  select * into th from public.sim_teams where sport = p_sport and abbr = p_home;
  if not found then raise exception 'Unknown team %', p_home; end if;
  select * into ta from public.sim_teams where sport = p_sport and abbr = p_away;
  if not found then raise exception 'Unknown team %', p_away; end if;
  if p_sport = 'tennis' then          -- "o" is a skill rating on the logit scale; eh is the chance the home player wins a game
    pg := 1 / (1 + exp(-(th.o - ta.o)::double precision));
    return array[least(greatest(pg, 0.2), 0.8), 1 - least(greatest(pg, 0.2), 0.8), 0.5];
  end if;
  eh := th.lg_avg + th.hfa / 2 + th.o + ta.d;
  ea := th.lg_avg - th.hfa / 2 + ta.o + th.d;
  lo := case p_sport when 'nfl' then 10 when 'cfb' then 10 when 'nba' then 92 when 'wnba' then 62 when 'cbb' then 52 when 'nhl' then 1.4 else 2.6 end;
  hi := case p_sport when 'nfl' then 38 when 'cfb' then 55 when 'nba' then 136 when 'wnba' then 106 when 'cbb' then 95 when 'nhl' then 5.0 else 7.5 end;
  return array[least(greatest(eh, lo), hi), least(greatest(ea, lo), hi), th.lg_avg];
end $$;

-- ---------------------------------------------------------------- tennis: one match as a string of games
-- 'H' / 'A' = a game won by the home / away player, '|' closes a set. A set goes to 6 games with a 2-game lead; at 6-6 one tiebreak game decides it (7-6).
create or replace function ls_private.tennis_seq(pg double precision) returns text language plpgsql volatile as $$
declare s text := ''; sh int := 0; sa int := 0; gh int; ga int; done boolean;
begin
  while sh < 2 and sa < 2 loop
    gh := 0; ga := 0; done := false;
    while not done loop
      if random() < pg then gh := gh + 1; s := s || 'H'; else ga := ga + 1; s := s || 'A'; end if;
      if (gh >= 6 and gh - ga >= 2) or (ga >= 6 and ga - gh >= 2) or gh = 7 or ga = 7 then done := true; end if;
    end loop;
    s := s || '|';
    if gh > ga then sh := sh + 1; else sa := sa + 1; end if;
  end loop;
  return s;
end $$;

create or replace function ls_private.tennis_games(seq text) returns int[] language sql immutable as $$
  select array[length(seq) - length(replace(seq, 'H', '')), length(seq) - length(replace(seq, 'A', ''))]
$$;

-- ---------------------------------------------------------------- markets
do $mk$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'battle_markets_core_base') then
    alter function public.battle_markets_core(text, text, text) rename to battle_markets_core_base;
  end if;
end $mk$;
grant execute on function public.battle_markets_core_base(text, text, text) to anon, authenticated;

create or replace function public.battle_markets_core(p_sport text, p_home text, p_away text) returns jsonb
language plpgsql stable security definer set search_path = public, ls_private, pg_temp as $$
declare e double precision[]; eh double precision; ea double precision; sdm double precision; sdt double precision; ph double precision; pc double precision; po double precision;
  lh numeric; tl numeric; th public.sim_teams; ta public.sim_teams; q double precision; pmf_h double precision[]; pmf_a double precision[]; h int; a int; pr double precision; mg int; tot int;
  sm double precision := 0; st double precision := 0; ssm double precision := 0; sst double precision := 0; n int := 2000; i int; g int[]; mgn int; ttl int; seq text; cnt_w double precision := 0;
  mhist int[]; thist int[]; sd_seed double precision; k int;
  rh double precision; ra double precision;
  pw double precision := 0; ps double precision := 0; pt double precision := 0; mean_m double precision; mean_t double precision; l_sp numeric; l_tt numeric; cs double precision; ct double precision;
begin
  if p_sport not in ('nhl', 'tennis') then return public.battle_markets_core_base(p_sport, p_home, p_away); end if;
  e := ls_private.exp_points(p_sport, p_home, p_away); rh := e[1]; ra := e[2];
  select * into th from public.sim_teams where sport = p_sport and abbr = p_home;
  select * into ta from public.sim_teams where sport = p_sport and abbr = p_away;
  if p_sport = 'nhl' then
    eh := e[1]; ea := e[2]; sdm := ls_private.sport_sd('nhl', 'm'); sdt := ls_private.sport_sd('nhl', 't');
    q := least(greatest(eh / (eh + ea), 0.4), 0.6);                 -- who wins a tie after regulation (overtime / shootout), the winner gets one more goal
    -- exact Poisson scores 0..14 each, the simulator's own overtime rule included
    pmf_h := array_fill(0::double precision, array[15]); pmf_a := array_fill(0::double precision, array[15]);
    for h in 0 .. 14 loop
      pmf_h[h + 1] := exp(-eh + h * ln(eh) - ls_private.ln_fact(h)); pmf_a[h + 1] := exp(-ea + h * ln(ea) - ls_private.ln_fact(h));
    end loop;
    mean_m := 0; mean_t := 0;
    -- the puck line is +/-1.5 on the favorite; compute the line first from the expected margin
    lh := case when eh >= ea then -1.5 else 1.5 end;
    tl := floor(eh + ea) + 0.5;
    for h in 0 .. 14 loop for a in 0 .. 14 loop
      pr := pmf_h[h + 1] * pmf_a[a + 1];
      if h = a then
        -- tie: home wins with q, away with 1 - q, the winner scores one more
        pw := pw + pr * q; mg := 1; tot := 2 * h + 1;
        ps := ps + pr * q * (case when mg + lh > 0 then 1 else 0 end) + pr * (1 - q) * (case when -mg + lh > 0 then 1 else 0 end);
        pt := pt + pr * (case when tot > tl then 1 else 0 end);
        mean_m := mean_m + pr * (2 * q - 1); mean_t := mean_t + pr * tot; ssm := ssm + pr * 1.0; sst := sst + pr * tot * tot; sm := sm + pr * 0;
      else
        mg := h - a; tot := h + a;
        pw := pw + pr * (case when mg > 0 then 1 else 0 end);
        ps := ps + pr * (case when mg + lh > 0 then 1 else 0 end);
        pt := pt + pr * (case when tot > tl then 1 else 0 end);
        mean_m := mean_m + pr * mg; mean_t := mean_t + pr * tot; ssm := ssm + pr * mg * mg; sst := sst + pr * tot * tot;
      end if;
    end loop; end loop;
    ph := pw; pc := ps; po := pt;
    sdm := sqrt(greatest(ssm - mean_m * mean_m, 0.5)); sdt := sqrt(greatest(sst - mean_t * mean_t, 0.5));
    eh := (mean_t + mean_m) / 2; ea := (mean_t - mean_m) / 2;
  else
    -- tennis: simulate 800 matches with a seed that depends only on the matchup
    sd_seed := (abs(hashtext('tennis' || p_home || '|' || p_away)::bigint) % 1000000) / 1000000.0;
    perform setseed(sd_seed);
    mhist := array_fill(0, array[200]); thist := array_fill(0, array[200]);
    for i in 1 .. n loop
      seq := ls_private.tennis_seq(e[1]); g := ls_private.tennis_games(seq);
      mgn := g[1] - g[2];
      if mgn = 0 then mgn := case when substr(seq, length(seq) - 1, 1) = 'H' then 1 else -1 end; g[case when mgn = 1 then 1 else 2 end] := g[case when mgn = 1 then 1 else 2 end] + 1; end if;
      ttl := g[1] + g[2];
      sm := sm + mgn; st := st + ttl; ssm := ssm + mgn * mgn; sst := sst + ttl * ttl;
      mhist[mgn + 100] := mhist[mgn + 100] + 1; thist[ttl] := thist[ttl] + 1;
      if mgn > 0 then cnt_w := cnt_w + 1; end if;
    end loop;
    perform setseed(((extract(epoch from clock_timestamp())::numeric % 1000) / 1000.0)::double precision);
    mean_m := sm / n; mean_t := st / n;
    sdm := sqrt(greatest(ssm / n - mean_m * mean_m, 1)); sdt := sqrt(greatest(sst / n - mean_t * mean_t, 1));
    ph := cnt_w / n;
    lh := -(floor(mean_m) + 0.5); tl := floor(mean_t) + 0.5;
    -- P(home margin + line > 0) and P(total > line) from the same simulated histogram
    cs := 0; ct := 0;
    for k in 1 .. 200 loop
      if mhist[k] > 0 and (k - 100) + lh > 0 then cs := cs + mhist[k]; end if;
      if thist[k] > 0 and k > tl then ct := ct + thist[k]; end if;
    end loop;
    pc := cs / n; po := ct / n; eh := (mean_t + mean_m) / 2; ea := (mean_t - mean_m) / 2;
  end if;
  ph := least(greatest(ph, 0.02), 0.98); pc := least(greatest(pc, 0.02), 0.98); po := least(greatest(po, 0.02), 0.98);
  return jsonb_build_object('sport', p_sport, 'home', p_home, 'away', p_away,
    'homeName', th.name, 'awayName', ta.name, 'homeColor', th.color, 'awayColor', ta.color,
    'eh', round(eh::numeric, 2), 'ea', round(ea::numeric, 2), 'simh', round(rh::numeric, 4), 'sima', round(ra::numeric, 4), 'lgavg', round(coalesce(th.lg_avg, 3)::numeric, 2), 'sdm', round(sdm::numeric, 3), 'sdt', round(sdt::numeric, 3),
    'pg', case when p_sport = 'tennis' then round(e[1]::numeric, 4) else null end, 'pHome', round(ph::numeric, 3), 'notional', 100,
    'ml', jsonb_build_object('home', ls_private.est_price(ph::numeric), 'away', ls_private.est_price((1 - ph)::numeric)),
    'spr', jsonb_build_object('homeLine', lh, 'awayLine', -lh, 'home', ls_private.est_price(pc::numeric), 'away', ls_private.est_price((1 - pc)::numeric)),
    'tot', jsonb_build_object('line', tl, 'over', ls_private.est_price(po::numeric), 'under', ls_private.est_price((1 - po)::numeric)),
    'players', '[]'::jsonb, 'props', '[]'::jsonb, 'pm', '{}'::jsonb, 'inj', jsonb_build_object('home', coalesce(th.inj, '{}'::jsonb), 'away', coalesce(ta.inj, '{}'::jsonb)));
end $$;
grant execute on function public.battle_markets_core(text, text, text) to anon, authenticated;

create or replace function ls_private.ln_fact(n int) returns double precision language sql immutable as $$
  select coalesce((select sum(ln(i::double precision)) from generate_series(2, n) i), 0)
$$;

-- ---------------------------------------------------------------- simulators
create or replace function ls_private.sim_hockey(mk jsonb) returns jsonb language plpgsql volatile as $$
declare eh float := coalesce(mk ->> 'simh', mk ->> 'eh')::float; ea float := coalesce(mk ->> 'sima', mk ->> 'ea')::float; hab text := mk ->> 'home'; aab text := mk ->> 'away';
  hs int := 0; as_ int := 0; m int; side text; ab text; ev jsonb := '[]'::jsonb; q float; per int; sec int; clk text; txt text; t float; mm int; ot_min int; ot_goal boolean := false; pre text;
  how text[] := array['wrist shot', 'slap shot from the point', 'backhand off the rush', 'tip in front', 'one-timer on the power play', 'rebound goal', 'snap shot', 'wraparound'];
begin
  ev := ev || jsonb_build_array(jsonb_build_object('t', 0, 'kind', 'start', 'text', 'Puck drop: ' || aab || ' at ' || hab, 'hs', 0, 'as', 0, 'clock', 'P1 20:00'));
  for m in 0 .. 59 loop
    for side in select unnest(array['home', 'away']) loop
      if random() < (case side when 'home' then eh else ea end) / 60.0 then
        if side = 'home' then hs := hs + 1; else as_ := as_ + 1; end if;
        ab := case side when 'home' then hab else aab end; per := m / 20 + 1; sec := 60 * (19 - (m % 20)) + floor(random() * 60)::int;
        t := (m + random()) / 60.0;
        ev := ev || jsonb_build_array(jsonb_build_object('t', t, 'kind', 'score', 'side', side,
          'text', ab || ' GOAL! ' || (array['Top shelf', 'Five-hole', 'Glove side', 'Blocker side'])[1 + floor(random() * 4)::int] || ' on a ' || how[1 + floor(random() * 8)::int],
          'hs', hs, 'as', as_, 'clock', 'P' || per || ' ' || (sec / 60) || ':' || lpad((sec % 60)::text, 2, '0')));
      end if;
    end loop;
    if m % 20 = 19 then
      per := m / 20 + 1;
      ev := ev || jsonb_build_array(jsonb_build_object('t', least((m + 1) / 60.0 + 0.0001, 1.0), 'kind', 'period', 'text', case per when 1 then 'End of the 1st period' when 2 then 'End of the 2nd period' else 'End of regulation' end || ': ' || aab || ' ' || as_ || ', ' || hab || ' ' || hs,
        'hs', hs, 'as', as_, 'clock', 'End P' || per));
    end if;
  end loop;
  if hs = as_ then
    q := least(greatest(eh / (eh + ea), 0.4), 0.6);
    side := case when random() < q then 'home' else 'away' end; ab := case side when 'home' then hab else aab end;
    if random() < 0.6 then            -- sudden death 3-on-3
      ot_min := 1 + floor(random() * 5)::int; sec := 300 - ot_min * 60 + floor(random() * 60)::int; pre := 'OT';
      ev := ev || jsonb_build_array(jsonb_build_object('t', 1.0 + 0.001, 'kind', 'period', 'text', 'Tied after 60: overtime', 'hs', hs, 'as', as_, 'clock', 'OT 5:00'));
      txt := ab || ' wins it in overtime!';
      clk := 'OT ' || (sec / 60) || ':' || lpad((sec % 60)::text, 2, '0'); t := 1.0 + ot_min / 60.0;
    else
      ev := ev || jsonb_build_array(jsonb_build_object('t', 1.0 + 0.001, 'kind', 'period', 'text', 'Scoreless overtime: shootout', 'hs', hs, 'as', as_, 'clock', 'OT 0:00'));
      txt := ab || ' wins the shootout!'; clk := 'SO'; t := 1.09;
    end if;
    if side = 'home' then hs := hs + 1; else as_ := as_ + 1; end if;
    ev := ev || jsonb_build_array(jsonb_build_object('t', t, 'kind', 'score', 'side', side, 'text', txt, 'hs', hs, 'as', as_, 'clock', clk));
  end if;
  return jsonb_build_object('hs', hs, 'as', as_, 'players', jsonb_build_object('_home', jsonb_build_object('pts', hs), '_away', jsonb_build_object('pts', as_)), 'ev', ev, 'inc', '[]'::jsonb);
end $$;

create or replace function ls_private.sim_tennis(mk jsonb) returns jsonb language plpgsql volatile as $$
declare pg float := coalesce((mk ->> 'pg')::float, 0.5); hab text := mk ->> 'home'; aab text := mk ->> 'away';
  seq text; i int; c text; hs int := 0; as_ int := 0; n int; ev jsonb := '[]'::jsonb; sh int := 0; sa int := 0; gh int := 0; ga int := 0; setno int := 1; side text; ab text; ngames int;
  mgn int; txt text; lastc text; k int := 0;
begin
  seq := ls_private.tennis_seq(pg); ngames := length(replace(seq, '|', ''));
  ev := ev || jsonb_build_array(jsonb_build_object('t', 0, 'kind', 'start', 'text', 'First serve: ' || aab || ' vs ' || hab, 'hs', 0, 'as', 0, 'clock', 'Set 1'));
  for i in 1 .. length(seq) loop
    c := substr(seq, i, 1);
    if c = '|' then
      if gh > ga then sh := sh + 1; else sa := sa + 1; end if;
      ev := ev || jsonb_build_array(jsonb_build_object('t', least(k::float / ngames + 0.0001, 1.0), 'kind', 'period',
        'text', (case when gh > ga then hab else aab end) || ' takes set ' || setno || ' ' || greatest(gh, ga) || '-' || least(gh, ga) || ' (sets ' || sh || '-' || sa || ')', 'hs', hs, 'as', as_, 'clock', 'End set ' || setno));
      setno := setno + 1; gh := 0; ga := 0; lastc := case when sh > sa then 'H' else 'A' end;
    else
      k := k + 1; side := case c when 'H' then 'home' else 'away' end; ab := case c when 'H' then hab else aab end;
      if c = 'H' then hs := hs + 1; gh := gh + 1; else as_ := as_ + 1; ga := ga + 1; end if;
      ev := ev || jsonb_build_array(jsonb_build_object('t', k::float / ngames, 'kind', 'score', 'side', side,
        'text', ab || ' ' || (array['holds serve', 'breaks serve', 'wins a long rally game', 'aces it out', 'wins the game'])[1 + floor(random() * 5)::int] || ' (' || gh || '-' || ga || ' in set ' || setno || ')',
        'hs', hs, 'as', as_, 'clock', 'Set ' || setno || ' ' || gh || '-' || ga));
    end if;
  end loop;
  if hs = as_ then   -- never ends tied: the match winner gets the extra game
    if lastc = 'H' then hs := hs + 1; else as_ := as_ + 1; end if;
    ev := ev || jsonb_build_array(jsonb_build_object('t', 1.0, 'kind', 'score', 'side', case lastc when 'H' then 'home' else 'away' end, 'text', 'Game count tied: the match winner takes the tiebreak point', 'hs', hs, 'as', as_, 'clock', 'Match'));
  end if;
  return jsonb_build_object('hs', hs, 'as', as_, 'players', jsonb_build_object('_home', jsonb_build_object('pts', hs), '_away', jsonb_build_object('pts', as_)), 'ev', ev, 'inc', '[]'::jsonb);
end $$;

create or replace function ls_private.run_sim(mk jsonb) returns jsonb language plpgsql volatile as $$
begin
  if mk ->> 'sport' in ('nfl', 'cfb') then return ls_private.sim_football(mk); end if;
  if mk ->> 'sport' in ('nba', 'wnba', 'cbb') then return ls_private.sim_basketball(mk); end if;
  if mk ->> 'sport' = 'nhl' then return ls_private.sim_hockey(mk); end if;
  if mk ->> 'sport' = 'tennis' then return ls_private.sim_tennis(mk); end if;
  return ls_private.sim_mlb(mk);
end $$;

-- ---------------------------------------------------------------- sports lists in the existing functions
create or replace function ls_private.award_day(d date) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare r record; out jsonb := '{}'::jsonb; s text;
begin
  select user_id, net into r from public.daily_stats where day = d and net > 0 order by net desc, user_id limit 1;
  if found then insert into public.badges(user_id, kind, day, detail) values (r.user_id, 'champion', d, '+' || r.net || ' coins') on conflict do nothing;
    out := out || jsonb_build_object('champion', r.user_id); end if;
  select user_id, net into r from public.daily_stats where day = d and net < 0 order by net asc, user_id limit 1;
  if found then insert into public.badges(user_id, kind, day, detail) values (r.user_id, 'trash', d, r.net || ' coins') on conflict do nothing;
    out := out || jsonb_build_object('trash', r.user_id); end if;
  select user_id, actions into r from public.daily_stats where day = d and actions >= 3 order by actions desc, user_id limit 1;
  if found then insert into public.badges(user_id, kind, day, detail) values (r.user_id, 'active', d, r.actions || ' actions') on conflict do nothing;
    out := out || jsonb_build_object('active', r.user_id); end if;
  select user_id, mentions into r from public.daily_stats where day = d and mentions >= 2 order by mentions desc, user_id limit 1;
  if found then insert into public.badges(user_id, kind, day, detail) values (r.user_id, 'convo', d, r.mentions || ' mentions') on conflict do nothing;
    out := out || jsonb_build_object('convo', r.user_id); end if;
  foreach s in array array['nfl', 'nba', 'wnba', 'mlb', 'cfb', 'cbb', 'nhl', 'tennis'] loop
    select user_id, elo into r from public.battle_stats where sport = s and rated >= 3 order by elo desc, user_id limit 1;
    if found then insert into public.badges(user_id, kind, day, sport, detail) values (r.user_id, 'king', d, s, 'Elo ' || round(r.elo)) on conflict do nothing;
      out := out || jsonb_build_object('king_' || s, r.user_id); end if;
  end loop;
  return out;
end $$;

-- the two battle creators: the stored text of the current functions with the sports list widened (done in place so nothing else about them changes)
do $up$
declare fn text; src text; sigs text[] := array['public.create_battle(text, text, numeric, text, integer, integer)', 'public.create_cpu_battle(text, text, numeric, text, integer, integer, text)'];
begin
  foreach fn in array sigs loop
    src := pg_get_functiondef(fn::regprocedure);
    if src like '%''nhl''%' then continue; end if;
    src := replace(src, '''nfl'', ''nba'', ''wnba'', ''mlb'', ''cfb'', ''cbb''', '''nfl'', ''nba'', ''wnba'', ''mlb'', ''cfb'', ''cbb'', ''nhl'', ''tennis''');
    src := replace(src, 'Pick NFL, NBA, WNBA, MLB, college football or college basketball', 'Pick NFL, NBA, WNBA, MLB, NHL, tennis, college football or college basketball');
    execute src;
  end loop;
end $up$;
