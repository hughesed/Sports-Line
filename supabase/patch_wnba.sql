-- WNBA in the simulation (battles): run this once in the Supabase SQL Editor (safe to repeat).
-- Generated from the latest version of every function that has a sport branch; only the WNBA branches are new.

alter table public.battles drop constraint if exists battles_sport_check;
alter table public.battles add constraint battles_sport_check check (sport in ('nfl','nba','wnba','mlb','cfb','cbb'));

create or replace function ls_private.sport_sd(p_sport text, which text) returns double precision language sql immutable as $$
  -- spread of the simulated final margin / total (measured on thousands of simulated games, see TEST_REPORT.md)
  select case p_sport when 'nfl' then case which when 'm' then 14.5 else 14.6 end
                      when 'cfb' then case which when 'm' then 17.0 else 17.0 end
                      when 'nba' then case which when 'm' then 13.0 else 18.0 end
                      when 'wnba' then case which when 'm' then 12.0 else 15.0 end
    when 'cbb' then case which when 'm' then 11.0 else 13.0 end
                      else case which when 'm' then 4.2 else 4.4 end end
$$;

create or replace function ls_private.exp_points(p_sport text, p_home text, p_away text) returns double precision[]
language plpgsql stable security definer set search_path = public, ls_private, pg_temp as $$
declare th public.sim_teams; ta public.sim_teams; eh double precision; ea double precision; lo double precision; hi double precision;
begin
  select * into th from public.sim_teams where sport = p_sport and abbr = p_home;
  if not found then raise exception 'Unknown team %', p_home; end if;
  select * into ta from public.sim_teams where sport = p_sport and abbr = p_away;
  if not found then raise exception 'Unknown team %', p_away; end if;
  eh := th.lg_avg + th.hfa / 2 + th.o + ta.d;
  ea := th.lg_avg - th.hfa / 2 + ta.o + th.d;
  lo := case p_sport when 'nfl' then 10 when 'cfb' then 10 when 'nba' then 92 when 'wnba' then 62 when 'cbb' then 52 else 2.6 end;
  hi := case p_sport when 'nfl' then 38 when 'cfb' then 55 when 'nba' then 136 when 'wnba' then 106 when 'cbb' then 95 else 7.5 end;
  return array[least(greatest(eh, lo), hi), least(greatest(ea, lo), hi), th.lg_avg];
end $$;

create or replace function public.battle_markets_core(p_sport text, p_home text, p_away text) returns jsonb
language plpgsql stable security definer set search_path = public, ls_private, pg_temp as $$
declare e double precision[]; eh double precision; ea double precision; lg double precision; sdm double precision; sdt double precision; x double precision;
  ph double precision; lh numeric; pc double precision; tl numeric; po double precision; players jsonb := '[]'::jsonb; props jsonb := '[]'::jsonb; pm jsonb := '{}'::jsonb;
  side text; ab text; fac double precision; r record; pe jsonb; pes jsonb[]; th public.sim_teams; ta public.sim_teams; simh double precision; sima double precision;
  s jsonb; has_players boolean; etd double precision; ppass double precision; swp double precision; swr double precision; srtd double precision; qptd double precision; hasqb boolean; wpi double precision; kyd double precision; krec double precision; sly double precision; qpy double precision; w3s double precision; mf double precision; mob double precision; mwr double precision; mr double precision[]; mrun double precision; w2s double precision; bw3 double precision; bw2 double precision; bk double precision[]; t3 double precision; t2p double precision; m3 double precision; mp double precision; w2i double precision; wri double precision; mutd double precision; nplayers int; inj jsonb := '{}'::jsonb; fb boolean := p_sport in ('nfl', 'cfb'); bb boolean := p_sport in ('nba', 'wnba', 'cbb');
begin
  if p_sport not in ('nfl', 'nba', 'wnba', 'mlb', 'cfb', 'cbb') then raise exception 'Battles are NFL, NBA, WNBA, MLB, college football or college basketball'; end if;
  e := ls_private.exp_points(p_sport, p_home, p_away); eh := e[1]; ea := e[2]; lg := e[3]; simh := eh; sima := ea;
  if bb then   -- the basketball sims ease off in blowouts, which shrinks expected margins to about 2/3: price what the sim really does
    x := (eh + ea) / 2; eh := x + 0.67 * (simh - sima) / 2; ea := x - 0.67 * (simh - sima) / 2;
  end if;
  select * into th from public.sim_teams where sport = p_sport and abbr = p_home;
  select * into ta from public.sim_teams where sport = p_sport and abbr = p_away;
  sdm := ls_private.sport_sd(p_sport, 'm'); sdt := ls_private.sport_sd(p_sport, 't');
  x := eh - ea; ph := ls_private.phi(x / sdm);
  if p_sport = 'mlb' then lh := case when x >= 0 then -1.5 else 1.5 end; else lh := -(floor(x) + 0.5); end if;
  pc := ls_private.phi((x + lh) / sdm);
  tl := floor(eh + ea) + 0.5;
  po := 1 - ls_private.phi((tl - (eh + ea)) / sdt);
  -- player props only when the bot has real stat lines for BOTH teams (8+ players each; football also needs a quarterback on each side)
  has_players := (select count(*) from public.sim_players where sport = p_sport and team = p_home) >= 8 and (select count(*) from public.sim_players where sport = p_sport and team = p_away) >= 8
    and (not fb or ((select count(*) from public.sim_players where sport = p_sport and team = p_home and role = 'QB' and rk = 1 and coalesce((stats ->> 'py')::float, 0) > 0) = 1
                    and (select count(*) from public.sim_players where sport = p_sport and team = p_away and role = 'QB' and rk = 1 and coalesce((stats ->> 'py')::float, 0) > 0) = 1));
  inj := jsonb_build_object('home', coalesce(th.inj, '{}'::jsonb), 'away', coalesce(ta.inj, '{}'::jsonb));
  foreach side in array array['away', 'home'] loop
    ab := case side when 'home' then p_home else p_away end;
    fac := (case side when 'home' then eh else ea end) / lg;
    if fb and has_players then
      -- anytime-TD chances come from the same recipe the simulator uses: the team's expected TDs, shared out by touchdown rates
      select coalesce(sum(case when role = 'QB' then 0 else greatest(coalesce((stats ->> 'rctd')::float, 0), 0.02) end), 0),
             coalesce(sum(case when role = 'WR' then coalesce((stats ->> 'rtd')::float, 0) * 0.5 else greatest(coalesce((stats ->> 'rtd')::float, 0), 0.02) end), 0),
             coalesce(sum(coalesce((stats ->> 'rtd')::float, 0)), 0), coalesce(max(case when role = 'QB' and rk = 1 then (stats ->> 'ptd')::float end), 0), coalesce(bool_or(role = 'QB' and rk = 1), false)
        into swp, swr, srtd, qptd, hasqb from public.sim_players where sport = p_sport and team = ab and ((role = 'QB' and rk = 1) or (role = 'RB' and rk <= 3) or (role = 'WR' and rk <= 7));
      swp := swp * 1.12 + 0.03; swr := swr * 1.1 + 0.03;
      ppass := case when hasqb then least(greatest(qptd / greatest(qptd + srtd + 0.15, 0.1), 0.35), 0.82) else 0.6 end;
      etd := (case side when 'home' then simh else sima end) * (case when p_sport = 'cfb' then 0.82 else 0.78 end) / 7.0;
      select coalesce(sum(case when role <> 'QB' then coalesce((stats ->> 'ly')::float, 0) end), 0), coalesce(max(case when role = 'QB' and rk = 1 then (stats ->> 'py')::float end), 0)
        into sly from public.sim_players where sport = p_sport and team = ab and ((role = 'QB' and rk = 1) or (role = 'RB' and rk <= 3) or (role = 'WR' and rk <= 7));
      select coalesce(max((stats ->> 'py')::float), 0) into qpy from public.sim_players where sport = p_sport and team = ab and role = 'QB' and rk = 1;
      -- receivers share the QB's priced passing yards the way the simulator shares them (with an "everybody else" slot)
      kyd := (qpy * (0.75 + 0.25 * fac)) / greatest(sly + greatest(qpy - sly, 0.1 * qpy), 1);
      krec := 0.75 + 0.25 * fac;
    elsif p_sport = 'mlb' and has_players then
      mrun := case side when 'home' then simh else sima end; mf := ls_private.mlb_f(mrun);
      select coalesce(sum((ls_private.mlb_rates(stats, mf, rk))[7]), 1), coalesce(sum((ls_private.mlb_rates(stats, mf, rk))[8]), 1) into mob, mwr
        from public.sim_players where sport = 'mlb' and team = ab and role = 'H' and rk <= 9;
    elsif bb and has_players then
      select sum(coalesce((stats ->> 'fg3')::float, 0) + 0.02), sum(greatest(coalesce((stats ->> 'pts')::float, 0) - 3 * coalesce((stats ->> 'fg3')::float, 0), 0.5) / 2)
        into w3s, w2s from public.sim_players where sport = p_sport and team = ab and role = 'P' and rk <= 9;
      bw3 := w3s * 1.1 + 0.05; bw2 := w2s * 1.09 + 0.1; bk := ls_private.bb_k(p_sport);
      t3 := bk[1] * (case side when 'home' then simh else sima end) / bk[4];
      t2p := (2 * bk[2] + 1.56 * bk[3]) * (case side when 'home' then simh else sima end) / bk[4];
    end if;
    for r in select * from public.sim_players where has_players and sport = p_sport and team = ab order by role, rk loop
      pes := array[]::jsonb[]; s := r.stats;
      if fb then
        wpi := case when r.role = 'QB' then 0 else greatest(coalesce((s ->> 'rctd')::float, 0), 0.02) end;
        wri := case when r.role = 'WR' then coalesce((s ->> 'rtd')::float, 0) * 0.5 else greatest(coalesce((s ->> 'rtd')::float, 0), 0.02) end;
        mutd := etd * (ppass * wpi / swp + (1 - ppass) * wri / swr);
        if r.role = 'QB' and r.rk = 1 then
          pes := array[ls_private.prop_entry(r.pid, r.name, side, ab, 'passYds', 'Pass yds', (s ->> 'py')::float * (0.75 + 0.25 * fac), 'norm', (s ->> 'py')::float * 0.27),
                       ls_private.prop_entry(r.pid, r.name, side, ab, 'passTD', 'Pass TDs', etd * ppass, 'pois', 0),
                       case when coalesce((s ->> 'ry')::float, 0) >= 4 then ls_private.prop_entry(r.pid, r.name, side, ab, 'rushYds', 'Rush yds', (s ->> 'ry')::float * (0.8 + 0.2 * fac), 'norm', greatest((s ->> 'ry')::float * 0.5, 8)) end,
                       ls_private.prop_entry(r.pid, r.name, side, ab, 'tdany', 'Anytime TD', mutd, 'pois', 0)];
        elsif r.role = 'RB' and r.rk <= 3 then
          pes := array[ls_private.prop_entry(r.pid, r.name, side, ab, 'rushYds', 'Rush yds', (s ->> 'ry')::float * (0.8 + 0.2 * fac), 'norm', greatest((s ->> 'ry')::float * 0.45, 12)),
                       ls_private.prop_entry(r.pid, r.name, side, ab, 'rec', 'Receptions', (s ->> 'rec')::float * krec, 'pois', 0),
                       case when coalesce((s ->> 'ly')::float, 0) >= 8 then ls_private.prop_entry(r.pid, r.name, side, ab, 'recYds', 'Rec yds', (s ->> 'ly')::float * kyd, 'norm', greatest((s ->> 'ly')::float * kyd * 0.6, 8)) end,
                       ls_private.prop_entry(r.pid, r.name, side, ab, 'tdany', 'Anytime TD', mutd, 'pois', 0)];
        elsif r.role = 'WR' and r.rk <= 7 then
          pes := array[ls_private.prop_entry(r.pid, r.name, side, ab, 'recYds', 'Rec yds', (s ->> 'ly')::float * kyd, 'norm', greatest((s ->> 'ly')::float * kyd * 0.5, 12)),
                       ls_private.prop_entry(r.pid, r.name, side, ab, 'rec', 'Receptions', (s ->> 'rec')::float * krec, 'pois', 0),
                       ls_private.prop_entry(r.pid, r.name, side, ab, 'tdany', 'Anytime TD', mutd, 'pois', 0)];
        end if;
      elsif bb then
        if r.role = 'P' and r.rk <= 9 then
          -- the simulator hands out threes and twos by these weights, so these are its true averages
          m3 := t3 * (coalesce((s ->> 'fg3')::float, 0) + 0.02) / bw3;
          w2i := greatest(coalesce((s ->> 'pts')::float, 0) - 3 * coalesce((s ->> 'fg3')::float, 0), 0.5) / 2;
          mp := 3 * m3 + t2p * w2i / bw2;
          pes := array[ls_private.prop_entry(r.pid, r.name, side, ab, 'pts', 'Points', mp, 'norm', sqrt(greatest(mp, 1)) * (case when p_sport = 'nba' then 1.55 else 1.6 end)),
                       case when coalesce((s ->> 'reb')::float, 0) >= 1.5 then ls_private.prop_entry(r.pid, r.name, side, ab, 'reb', 'Rebounds', (s ->> 'reb')::float * (0.92 + 0.08 * fac), 'pois', 0) end,
                       case when coalesce((s ->> 'ast')::float, 0) >= 1.0 then ls_private.prop_entry(r.pid, r.name, side, ab, 'ast', 'Assists', (s ->> 'ast')::float * (0.92 + 0.08 * fac), 'pois', 0) end,
                       case when coalesce((s ->> 'fg3')::float, 0) >= 0.4 then ls_private.prop_entry(r.pid, r.name, side, ab, 'fg3', 'Threes', m3, 'pois', 0) end,
                       case when r.rk <= 6 then ls_private.prop_entry(r.pid, r.name, side, ab, 'pra', 'Pts + Reb + Ast',
                         mp + coalesce((s ->> 'reb')::float, 0) * (0.92 + 0.08 * fac) + coalesce((s ->> 'ast')::float, 0) * (0.92 + 0.08 * fac), 'norm',
                         1.12 * sqrt(greatest(mp, 1) * 2.4 + coalesce((s ->> 'reb')::float, 0) + coalesce((s ->> 'ast')::float, 0))) end];
        end if;
      else
        if r.role = 'H' and r.rk <= 9 then
          mr := ls_private.mlb_rates(s, mf, r.rk);
          pes := array[ls_private.prop_entry(r.pid, r.name, side, ab, 'hits', 'Hits', mr[6] * mr[1], 'pois', 0),
                       ls_private.prop_entry(r.pid, r.name, side, ab, 'tb', 'Total bases', mr[6] * (mr[2] + 2 * mr[3] + 3 * mr[4] + 4 * mr[5]), 'pois', 0),
                       ls_private.prop_entry(r.pid, r.name, side, ab, 'hr', 'Home runs', mr[6] * mr[5], 'pois', 0),
                       ls_private.prop_entry(r.pid, r.name, side, ab, 'rbi', 'RBIs', 0.95 * mrun * mr[8] / mwr, 'pois', 0),
                       ls_private.prop_entry(r.pid, r.name, side, ab, 'runs', 'Runs', 0.97 * mrun * mr[7] / mob, 'pois', 0)];
        elsif r.role = 'SP' and r.rk = 1 then
          pes := array[ls_private.prop_entry(r.pid, r.name, side, ab, 'k', 'Strikeouts', (s ->> 'k')::float, 'pois', 0),
                       ls_private.prop_entry(r.pid, r.name, side, ab, 'outs', 'Outs recorded', (s ->> 'outs')::float, 'norm', 4.0)];
        end if;
      end if;
      for pe in select y from unnest(pes) y where y is not null loop
        props := props || jsonb_build_array(pe);
        pm := pm || jsonb_build_object((pe ->> 'pid') || ':' || (pe ->> 'stat'), jsonb_build_array(pe -> 'mean', pe -> 'sd'));
      end loop;
      -- every rostered player goes into "players" (the sim reads their season stat lines from here)
      if (fb and ((r.role in ('QB') and r.rk = 1) or (r.role = 'RB' and r.rk <= 3) or (r.role = 'WR' and r.rk <= 7)))
         or (bb and r.role = 'P' and r.rk <= 9) or (p_sport = 'mlb' and ((r.role = 'H' and r.rk <= 9) or (r.role = 'SP' and r.rk = 1))) then
        players := players || jsonb_build_array(jsonb_build_object('pid', r.pid, 'name', r.name, 'side', side, 'abbr', ab, 'role', r.role, 'rk', r.rk, 'pos', r.pos, 'stats', r.stats)
          || case when r.inj is not null then jsonb_build_object('inj', r.inj, 'note', r.note) else '{}'::jsonb end);
      end if;
    end loop;
  end loop;
  return jsonb_build_object('sport', p_sport, 'home', p_home, 'away', p_away,
    'homeName', th.name, 'awayName', ta.name, 'homeColor', th.color, 'awayColor', ta.color,
    'eh', round(eh::numeric, 2), 'ea', round(ea::numeric, 2), 'simh', round(simh::numeric, 3), 'sima', round(sima::numeric, 3), 'lgavg', round(lg::numeric, 2), 'sdm', sdm, 'sdt', sdt, 'pHome', round(ph::numeric, 3), 'notional', 100,
    'ml', jsonb_build_object('home', ls_private.est_price(ph::numeric), 'away', ls_private.est_price((1 - ph)::numeric)),
    'spr', jsonb_build_object('homeLine', lh, 'awayLine', -lh, 'home', ls_private.est_price(pc::numeric), 'away', ls_private.est_price((1 - pc)::numeric)),
    'tot', jsonb_build_object('line', tl, 'over', ls_private.est_price(po::numeric), 'under', ls_private.est_price((1 - po)::numeric)),
    'players', players, 'props', props, 'pm', pm, 'inj', inj);
end $$;

create or replace function ls_private.run_sim(mk jsonb) returns jsonb language plpgsql volatile as $$
begin
  if mk ->> 'sport' in ('nfl', 'cfb') then return ls_private.sim_football(mk); end if;
  if mk ->> 'sport' in ('nba', 'wnba', 'cbb') then return ls_private.sim_basketball(mk); end if;
  return ls_private.sim_mlb(mk);
end $$;

create or replace function ls_private.sgp_load(p_sport text, p_stat text) returns double precision[] language sql immutable as $$
  -- [lt, lu, lp, unit]   unit: 1 passing game, 2 rushing game, 3 scoring, 4 basketball scoring, 5 rebounding, 6 assists, 7 baseball batting, 8 pitching
  select case
    when p_sport in ('nfl', 'cfb') then case p_stat
      when 'passYds' then array[0.40, 0.80, 0.0, 1] when 'passTD' then array[0.55, 0.40, 0.0, 1]
      when 'recYds' then array[0.22, 0.55, 0.45, 1] when 'rec' then array[0.18, 0.50, 0.55, 1]
      when 'rushYds' then array[0.25, 0.45, 0.0, 2] when 'tdany' then array[0.50, 0.0, 0.10, 3] else array[0.2, 0.0, 0.0, 0] end
    when p_sport in ('nba', 'wnba', 'cbb') then case p_stat
      when 'pts' then array[0.22, 0.0, 0.70, 4] when 'fg3' then array[0.15, 0.0, 0.70, 4] when 'pra' then array[0.30, 0.0, 0.90, 4]
      when 'reb' then array[0.10, 0.0, 0.15, 5] when 'ast' then array[0.25, 0.0, 0.15, 6] else array[0.2, 0.0, 0.0, 0] end
    else case p_stat
      when 'hits' then array[0.28, 0.0, 0.75, 7] when 'tb' then array[0.28, 0.0, 0.85, 7] when 'hr' then array[0.25, 0.0, 0.50, 7]
      when 'rbi' then array[0.50, 0.0, 0.30, 7] when 'runs' then array[0.35, 0.0, 0.25, 7]
      when 'k' then array[0.05, 0.0, 0.40, 8] when 'outs' then array[0.15, 0.0, 0.40, 8] else array[0.2, 0.0, 0.0, 0] end
  end::double precision[]
$$;

create or replace function ls_private.sprinkle(p_sport text, p_home text, p_away text, p_ev jsonb) returns jsonb
language plpgsql volatile set search_path = public, ls_private, pg_temp as $$
declare o jsonb := '[]'::jsonb; e jsonb; t float; side text; ab text; oab text; r float; k int; n int; txt text; clk text; ord jsonb := '[]'::jsonb;
  lh int := 0; la int := 0; pts int; runside text := ''; runp int := 0; runann boolean := false; pen text[]; yd int; x jsonb; lastclk text := null;
  names text[]; typ int; kd text;
begin
  for e in select v from jsonb_array_elements(p_ev) with ordinality a(v, i) order by (v ->> 't')::float, i loop
    o := o || jsonb_build_array(e); t := (e ->> 't')::float; clk := e ->> 'clock'; side := e ->> 'side';
    if side is null or e ->> 'kind' not in ('score', 'play') then continue; end if;
    ab := case side when 'home' then p_home else p_away end; oab := case side when 'home' then p_away else p_home end;
    if p_sport in ('nfl', 'cfb') then
      if e ->> 'kind' = 'score' and (e ->> 'text') !~* 'touchdown|field goal' then continue; end if;
      n := floor(random() * 3)::int;                                           -- 0-2 first downs earlier in the drive
      for k in 1 .. n loop
        yd := 4 + floor(random() * 22)::int;
        o := o || jsonb_build_array(jsonb_build_object('t', greatest(t - 0.007 * k, 0.00001), 'kind', 'fd', 'side', side, 'hs', -1, 'as', -1, 'clock', clk,
          'text', 'First down! ' || ab || ' ' || (array['pass for ', 'run for ', 'screen pass for ', 'QB keep for '])[1 + floor(random() * 4)::int] || yd || ' yards'));
      end loop;
      if random() < 0.30 then
        x := to_jsonb((array['holding,10', 'false start,5', 'pass interference,15', 'offside,5', 'roughing the passer,15', 'illegal block,10', 'delay of game,5'])[1 + floor(random() * 7)::int]);
        o := o || jsonb_build_array(jsonb_build_object('t', greatest(t - 0.0035, 0.00001), 'kind', 'flag', 'side', case when random() < 0.5 then side else (case side when 'home' then 'away' else 'home' end) end,
          'hs', -1, 'as', -1, 'clock', clk, 'text', 'Flag! ' || case when random() < 0.5 then ab else oab end || ': ' || split_part(x #>> '{}', ',', 1) || ', ' || split_part(x #>> '{}', ',', 2) || ' yards'));
      end if;
      if random() < 0.14 then
        o := o || jsonb_build_array(jsonb_build_object('t', greatest(t - 0.0055, 0.00001), 'kind', 'sack', 'side', side, 'hs', -1, 'as', -1, 'clock', clk,
          'text', 'Sack! ' || oab || ' drops the quarterback for a loss of ' || (3 + floor(random() * 9)::int) || ' yards'));
      end if;
    elsif p_sport in ('nba', 'wnba', 'cbb') then
      if e ->> 'kind' <> 'score' then continue; end if;
      pts := case side when 'home' then (e ->> 'hs')::int - lh else (e ->> 'as')::int - la end;
      if pts < 1 then lh := (e ->> 'hs')::int; la := (e ->> 'as')::int; continue; end if;
      -- scoring runs: points in a row by one side
      if side = runside then runp := runp + pts; else runside := side; runp := pts; runann := false; end if;
      if runp >= 8 and not runann then
        runann := true;
        o := o || jsonb_build_array(jsonb_build_object('t', t + 0.004, 'kind', 'run', 'side', side, 'hs', -1, 'as', -1, 'clock', clk, 'text', ab || ' on a ' || runp || '-0 run'));
      end if;
      lh := (e ->> 'hs')::int; la := (e ->> 'as')::int;
      r := random();
      if r < 0.26 then
        o := o || jsonb_build_array(jsonb_build_object('t', greatest(t - 0.005, 0.00001), 'kind', 'foul', 'side', case side when 'home' then 'away' else 'home' end, 'hs', -1, 'as', -1, 'clock', clk,
          'text', 'Foul on ' || oab || (array[', shooting foul', ', reach-in', ', over the back', ', offensive foul on the other end'])[1 + floor(random() * 4)::int]));
      elsif r < 0.44 then
        o := o || jsonb_build_array(jsonb_build_object('t', greatest(t - 0.004, 0.00001), 'kind', 'steal', 'side', side, 'hs', -1, 'as', -1, 'clock', clk,
          'text', 'Steal! ' || ab || ' picks off the pass and pushes the pace'));
      elsif r < 0.54 then
        o := o || jsonb_build_array(jsonb_build_object('t', greatest(t - 0.004, 0.00001), 'kind', 'block', 'side', case side when 'home' then 'away' else 'home' end, 'hs', -1, 'as', -1, 'clock', clk,
          'text', 'Blocked! ' || oab || ' swats it away'));
      end if;
    end if;
  end loop;
  if p_sport = 'mlb' then
    n := 16 + floor(random() * 14)::int;
    for k in 1 .. n loop
      t := 0.02 + 0.96 * random(); side := case when random() < 0.5 then 'home' else 'away' end;
      ab := case side when 'home' then p_home else p_away end; oab := case side when 'home' then p_away else p_home end; r := random();
      if r < 0.38 then kd := 'strikeout'; txt := 'Strikeout! ' || ab || ' batter ' || (array['goes down swinging', 'is caught looking', 'chases the slider'])[1 + floor(random() * 3)::int];
      elsif r < 0.52 then kd := 'walk'; txt := 'Ball four: ' || ab || ' batter takes a walk';
      elsif r < 0.66 then kd := 'steal'; txt := 'Stolen base! ' || ab || ' runner takes ' || (array['second', 'third'])[1 + floor(random() * 2)::int] || ' — SAFE';
      elsif r < 0.82 then kd := 'safe'; txt := 'Close play! ' || ab || ' beats the throw — SAFE';
      else kd := 'out'; txt := 'Out! ' || oab || ' ' || (array['turns two on a double play', 'makes a diving stop', 'throws him out at first', 'tags him out at the plate'])[1 + floor(random() * 4)::int]; end if;
      o := o || jsonb_build_array(jsonb_build_object('t', t, 'kind', kd, 'side', side, 'hs', -1, 'as', -1, 'text', txt));
    end loop;
  end if;
  -- put everything in time order and give color plays the clock of the play before them
  for e in select v from jsonb_array_elements(o) with ordinality a(v, i) order by (v ->> 't')::float, i loop
    if e ->> 'clock' is null then e := e || jsonb_build_object('clock', coalesce(lastclk, '')); else lastclk := e ->> 'clock'; end if;
    ord := ord || jsonb_build_array(e);
  end loop;
  return ord;
end $$;

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
  foreach s in array array['nfl', 'nba', 'wnba', 'mlb', 'cfb', 'cbb'] loop
    select user_id, elo into r from public.battle_stats where sport = s and rated >= 3 order by elo desc, user_id limit 1;
    if found then insert into public.badges(user_id, kind, day, sport, detail) values (r.user_id, 'king', d, s, 'Elo ' || round(r.elo)) on conflict do nothing;
      out := out || jsonb_build_object('king_' || s, r.user_id); end if;
  end loop;
  return out;
end $$;

create or replace function public.create_battle(p_sport text, p_home text, p_wager numeric, p_fmt text default 'parlay', p_max_legs int default 8, p_minutes int default 4) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); w numeric := round(coalesce(p_wager, 0), 2); bid bigint; bal numeric; fm text := coalesce(p_fmt, 'parlay');
begin
  if uid is null then raise exception 'Sign in to battle'; end if;
  if p_sport not in ('nfl', 'nba', 'wnba', 'mlb', 'cfb', 'cbb') then raise exception 'Pick NFL, NBA, WNBA, MLB, college football or college basketball'; end if;
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

create or replace function public.create_cpu_battle(p_sport text, p_home text, p_wager numeric, p_fmt text default 'parlay', p_max_legs int default 8, p_minutes int default 4, p_away text default null) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare
  uid uuid := auth.uid(); v_cpu uuid := ls_private.cpu_id(); w numeric := round(coalesce(p_wager, 0), 2); fm text := coalesce(p_fmt, 'parlay'); bid bigint; bal numeric; cb numeric;
  v_has boolean; r record; m jsonb; best jsonb := null; bestd double precision := 9; bestab text := null; bestd2 double precision := 9; anyab text := null; anym jsonb := null; mk jsonb; ec numeric; eo numeric; pc double precision; cn text; v_ph double precision;
begin
  if uid is null then raise exception 'Sign in to battle'; end if;
  if uid = v_cpu then raise exception 'Not available'; end if;
  if p_sport not in ('nfl', 'nba', 'wnba', 'mlb', 'cfb', 'cbb') then raise exception 'Pick NFL, NBA, WNBA, MLB, college football or college basketball'; end if;
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
  if nullif(p_away, '') is not null and p_away <> 'random' then          -- you chose the computer's team
    if p_away = p_home or not exists (select 1 from public.sim_teams where sport = p_sport and abbr = p_away) then raise exception 'Pick a different team for the computer'; end if;
    bestab := p_away; best := public.battle_markets(p_sport, p_home, p_away);
  else
  for r in select abbr from public.sim_teams where sport = p_sport and abbr <> p_home order by random() limit 8 loop
    m := public.battle_markets(p_sport, p_home, r.abbr);
    v_ph := coalesce((m ->> 'pHome')::double precision, 0.5);
    if coalesce(jsonb_array_length(m -> 'props'), 0) >= 8 or not v_has then
      if abs(v_ph - 0.5) < bestd then bestd := abs(v_ph - 0.5); bestab := r.abbr; best := m; end if;
    elsif abs(v_ph - 0.5) < bestd2 then bestd2 := abs(v_ph - 0.5); anyab := r.abbr; anym := m; end if;
  end loop;
  if bestab is null then bestab := anyab; best := anym; end if;       -- no team with props found: team lines only
  end if;
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

create or replace function ls_private.sim_basketball(mk jsonb) returns jsonb language plpgsql volatile as $$
declare cb boolean := (mk ->> 'sport') = 'cbb'; wb boolean := (mk ->> 'sport') = 'wnba'; nreg int := case when cb then 2 else 4 end; plen float := case when cb then 20 when wb then 10 else 12 end;
  eh float := coalesce(mk ->> 'simh', mk ->> 'eh')::float; ea float := coalesce(mk ->> 'sima', mk ->> 'ea')::float; hab text := mk ->> 'home'; aab text := mk ->> 'away';
  pace int := case when cb then 64 + floor(random() * 8)::int when wb then 78 + floor(random() * 7)::int else 96 + floor(random() * 7)::int end;
  a3 float := (ls_private.bb_k(mk ->> 'sport'))[1]; a2 float := (ls_private.bb_k(mk ->> 'sport'))[2]; af float := (ls_private.bb_k(mk ->> 'sport'))[3];
  mix float := (ls_private.bb_k(mk ->> 'sport'))[4];
  gfh float := exp(0.045 * ls_private.gauss()); gfa float := exp(0.045 * ls_private.gauss());
  hs int := 0; as_ int := 0; q int; j int; npos int; side text; ab text; t float; s float; p3 float; p2 float; pf float; r float; pts int; lead int;
  ev jsonb := '[]'::jsonb; inc jsonb := '[]'::jsonb; players jsonb := '{}'::jsonb; nper float := 5.0 / (nreg * plen); per_end float; secs int; clk text; next_mark float; idx int; n int; nm text;
  ah jsonb; aa jsonb; hid text[]; aid text[]; hnm text[]; anm text[]; hw3 float[]; hw2 float[]; aw3 float[]; aw2 float[]; hpts int[] := '{}'; apts int[] := '{}'; h3 int[] := '{}'; a3n int[] := '{}';
  hfgm int := 0; afgm int := 0; hoth int := 0; aoth int := 0; hoth3 int := 0; aoth3 int := 0; x float;
  hreb float[]; areb float[]; hast float[]; aast float[]; hpt float[]; apt float[]; hf3 float[]; af3 float[];
  s_ids text[]; s_reb float[]; s_ast float[]; s_fgm int; s_e float; s_pts int[]; s_3 int[]; s_oth int; s_oth3 int; wts float[]; ai int[]; treb int; tast int; fexp float; refp float;
  i int; sd jsonb; pid text; ps jsonb; mpts float; sreb float; sast float; isfg boolean;
begin
  ah := ls_private.side_arrays(mk, 'home', array['pts', 'reb', 'ast', 'fg3']); aa := ls_private.side_arrays(mk, 'away', array['pts', 'reb', 'ast', 'fg3']);
  hid := ls_private.tarr(ah -> 'pid'); aid := ls_private.tarr(aa -> 'pid'); hnm := ls_private.tarr(ah -> 'name'); anm := ls_private.tarr(aa -> 'name');
  hpt := ls_private.farr(ah -> 'pts'); apt := ls_private.farr(aa -> 'pts'); hf3 := ls_private.farr(ah -> 'fg3'); af3 := ls_private.farr(aa -> 'fg3');
  hreb := ls_private.farr(ah -> 'reb'); areb := ls_private.farr(aa -> 'reb'); hast := ls_private.farr(ah -> 'ast'); aast := ls_private.farr(aa -> 'ast');
  hw3 := '{}'; hw2 := '{}'; aw3 := '{}'; aw2 := '{}';
  for i in 1 .. coalesce(array_length(hid, 1), 0) loop hw3[i] := hf3[i] + 0.02; hw2[i] := greatest(hpt[i] - 3 * hf3[i], 0.5) / 2; end loop;
  for i in 1 .. coalesce(array_length(aid, 1), 0) loop aw3[i] := af3[i] + 0.02; aw2[i] := greatest(apt[i] - 3 * af3[i], 0.5) / 2; end loop;
  if coalesce(array_length(hid, 1), 0) > 0 then
    hw3[array_length(hid, 1) + 1] := 0.1 * (select sum(zz) from unnest(hw3) zz) + 0.05; hw2[array_length(hid, 1) + 1] := 0.09 * (select sum(zz) from unnest(hw2) zz) + 0.1; end if;
  if coalesce(array_length(aid, 1), 0) > 0 then
    aw3[array_length(aid, 1) + 1] := 0.1 * (select sum(zz) from unnest(aw3) zz) + 0.05; aw2[array_length(aid, 1) + 1] := 0.09 * (select sum(zz) from unnest(aw2) zz) + 0.1; end if;
  ev := ev || jsonb_build_array(jsonb_build_object('t', 0, 'kind', 'start', 'text', 'Tip-off: ' || aab || ' at ' || hab, 'hs', 0, 'as', 0, 'clock', case when cb then 'H1 20:00' when wb then 'Q1 10:00' else 'Q1 12:00' end));
  q := 1;
  loop
    if q <= nreg then npos := round(pace::float / nreg)::int; else npos := round(pace * 5.0 / (nreg * plen))::int; end if;
    next_mark := 0.5;
    for j in 0 .. 2 * npos - 1 loop
      side := case when j % 2 = (q % 2) then 'home' else 'away' end;
      ab := case side when 'home' then hab else aab end;
      if q <= nreg then t := ((q - 1) + (j + random()) / (2 * npos)) / nreg;
      else t := 1.0 + (q - nreg - 1) * nper + (j + random()) / (2 * npos) * nper; end if;
      s := (case side when 'home' then eh * gfh else ea * gfa end) / pace / mix;
      lead := case side when 'home' then hs - as_ else as_ - hs end;      -- blowouts: the side that leads big eases off (bench minutes)
      if abs(lead) > 6 then s := s * (1 - sign(lead) * least(0.12, 0.006 * (abs(lead) - 6))); end if;
      p3 := a3 * s; p2 := a2 * s; pf := af * s;
      r := random(); isfg := r < p3 + p2;
      if r < p3 then pts := 3; elsif r < p3 + p2 then pts := 2;
      elsif r < p3 + p2 + pf then pts := (random() < 0.78)::int + (random() < 0.78)::int; else pts := 0; end if;
      if pts > 0 then
        if side = 'home' then hs := hs + pts; else as_ := as_ + pts; end if;
        n := case side when 'home' then coalesce(array_length(hid, 1), 0) else coalesce(array_length(aid, 1), 0) end;
        idx := ls_private.pick(case when pts = 3 then case side when 'home' then hw3 else aw3 end else case side when 'home' then hw2 else aw2 end end);
        nm := null;
        if idx between 1 and n then
          nm := case side when 'home' then hnm[idx] else anm[idx] end;
          pid := case side when 'home' then hid[idx] else aid[idx] end;
          if side = 'home' then hpts[idx] := coalesce(hpts[idx], 0) + pts; if pts = 3 then h3[idx] := coalesce(h3[idx], 0) + 1; end if;
          else apts[idx] := coalesce(apts[idx], 0) + pts; if pts = 3 then a3n[idx] := coalesce(a3n[idx], 0) + 1; end if; end if;
          inc := inc || jsonb_build_array(jsonb_build_object('t', t, 'pid', pid, 'stat', 'pts', 'd', pts), jsonb_build_object('t', t, 'pid', pid, 'stat', 'pra', 'd', pts));
          if pts = 3 then inc := inc || jsonb_build_array(jsonb_build_object('t', t, 'pid', pid, 'stat', 'fg3', 'd', 1)); end if;
        else
          if side = 'home' then hoth := hoth + pts; if pts = 3 then hoth3 := hoth3 + 1; end if; else aoth := aoth + pts; if pts = 3 then aoth3 := aoth3 + 1; end if; end if;
        end if;
        if isfg then
          if side = 'home' then hfgm := hfgm + 1; else afgm := afgm + 1; end if;
        end if;
        if pts = 3 or random() < 0.25 then
          secs := greatest(0, round((1 - ((t - case when q <= nreg then (q - 1)::float / nreg else 1.0 + (q - nreg - 1) * nper end) / (case when q <= nreg then 1.0 / nreg else nper end))) * (case when q <= nreg then plen * 60 else 300 end))::int);
          clk := case when q <= nreg then (case when cb then 'H' else 'Q' end) || q else 'OT' || (q - nreg) end || ' ' || (secs / 60) || ':' || lpad((secs % 60)::text, 2, '0');
          ev := ev || jsonb_build_array(jsonb_build_object('t', t, 'kind', 'score', 'side', side,
            'text', coalesce(nm, (case side when 'home' then hab else aab end) || ' ' || (array['guard', 'wing', 'forward', 'big man'])[1 + floor(random() * 4)::int]) || case pts when 3 then ' drains a three' when 2 then case when random() < 0.3 then ' throws it down' else ' scores inside' end else ' at the line, ' || pts || ' of 2' end,
            'hs', hs, 'as', as_, 'clock', clk));
        end if;
      end if;
      if (j + 1)::float / (2 * npos) >= next_mark and next_mark < 1 then
        clk := case when q <= nreg then (case when cb then 'H' else 'Q' end) || q || ' ' || (case when cb then '10:00' when wb then '5:00' else '6:00' end) else 'OT' || (q - nreg) || ' 2:30' end;
        ev := ev || jsonb_build_array(jsonb_build_object('t', t + 0.0001, 'kind', 'snap', 'text', aab || ' ' || as_ || ', ' || hab || ' ' || hs || ' midway through ' || case when q <= nreg then (case when cb then 'the ' || ls_private.ordinal(q) || ' half' else 'Q' || q end) else 'overtime' end, 'hs', hs, 'as', as_, 'clock', clk));
        next_mark := 2;
      end if;
    end loop;
    per_end := case when q <= nreg then q::float / nreg else 1.0 + (q - nreg) * nper end;
    ev := ev || jsonb_build_array(jsonb_build_object('t', per_end, 'kind', 'period',
      'text', case when q = nreg / 2 then 'Halftime' when q < nreg then 'End of Q' || q when q = nreg and hs = as_ then 'Tied after regulation: overtime' when q = nreg then 'End of regulation' else 'End of OT' || (q - nreg) end,
      'hs', hs, 'as', as_, 'clock', case when q <= nreg then 'End ' || (case when cb then 'H' else 'Q' end) || q else 'End OT' || (q - nreg) end));
    exit when q >= nreg and hs <> as_;
    exit when q >= nreg + 6;
    q := q + 1;
  end loop;
  if hs = as_ then hs := hs + 1; hoth := hoth + 1; end if;   -- never ends tied
  -- rebounds and assists: team totals, shared out
  refp := case when cb then 69.0 else 99.0 end;
  foreach side in array array['home', 'away'] loop
    s_ids := case side when 'home' then hid else aid end; s_reb := case side when 'home' then hreb else areb end; s_ast := case side when 'home' then hast else aast end;
    s_fgm := case side when 'home' then hfgm else afgm end; s_e := case side when 'home' then eh else ea end; s_oth := case side when 'home' then hoth else aoth end; s_oth3 := case side when 'home' then hoth3 else aoth3 end;
    n := coalesce(array_length(s_ids, 1), 0);
    if n = 0 then continue; end if;
    s_pts := case side when 'home' then hpts else apts end; s_3 := case side when 'home' then h3 else a3n end;
    sreb := 0; sast := 0; for i in 1 .. n loop sreb := sreb + s_reb[i]; sast := sast + s_ast[i]; end loop;
    treb := greatest(round(sreb / 0.88 * pace / refp * exp(0.06 * ls_private.gauss()))::int, 10);
    fexp := greatest(s_e / mix * (a3 + a2), 5);                          -- expected made field goals; assists follow the real ones
    tast := greatest(round(sast / 0.9 * least(greatest(s_fgm / fexp, 0.6), 1.5))::int, 4);
    wts := '{}'; for i in 1 .. n loop wts[i] := s_reb[i] + 0.05; end loop; wts[n + 1] := 0.12 * sreb / 0.88 + 0.5;
    ai := ls_private.alloc_int(treb, wts, 0.45);
    for i in 1 .. n loop
      players := ls_private.set_stat(players, s_ids[i], 'reb', ai[i]);
      inc := inc || ls_private.spread(s_ids[i], 'reb', ai[i], 1) || ls_private.spread(s_ids[i], 'pra', ai[i], 1);
    end loop;
    wts := '{}'; for i in 1 .. n loop wts[i] := s_ast[i] + 0.05; end loop; wts[n + 1] := 0.1 * sast / 0.9 + 0.3;
    ai := ls_private.alloc_int(tast, wts, 0.45);
    for i in 1 .. n loop
      players := ls_private.set_stat(players, s_ids[i], 'ast', ai[i]);
      inc := inc || ls_private.spread(s_ids[i], 'ast', ai[i], 1) || ls_private.spread(s_ids[i], 'pra', ai[i], 1);
    end loop;
    for i in 1 .. n loop
      players := ls_private.set_stat(players, s_ids[i], 'pts', coalesce(s_pts[i], 0));
      players := ls_private.set_stat(players, s_ids[i], 'fg3', coalesce(s_3[i], 0));
      players := ls_private.set_stat(players, s_ids[i], 'pra', coalesce(s_pts[i], 0) + (players -> s_ids[i] ->> 'reb')::int + (players -> s_ids[i] ->> 'ast')::int);
    end loop;
    players := jsonb_set(players, array['_' || side], jsonb_build_object('pts', case side when 'home' then hs else as_ end, 'reb', treb, 'ast', tast, 'othPts', s_oth, 'oth3', s_oth3), true);
  end loop;
  return jsonb_build_object('hs', hs, 'as', as_, 'players', players, 'ev', ev, 'inc', inc);
end $$;
