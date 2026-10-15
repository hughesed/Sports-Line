-- Soccer in battles and practice bets, plus alternate game totals. Run ONCE in the Supabase SQL Editor AFTER patch_hockey_tennis.sql. Safe to run twice.
--  * Battles: teams of the soccer matches on the board (the bot rates them from the book's expected goals). Poisson goals over 90 minutes; a level match
--    goes to extra time / penalties so a battle never ends tied (the winner gets one more goal). Money line, +/-1.5 handicap, total goals.
--  * Practice bets on real matches: the 90-minute 3-way result (home / draw / away; a draw loses both team sides), double chance, both teams to score,
--    goal totals 0.5 to 5.5, team goal totals, and player props (a stat ESPN did not report voids the leg). Prices come from games.lines.soc, which the bot
--    writes with every soccer match (the page shows the same numbers).
--  * Alternate game totals for the other sports ("Under 7.5" in hockey): priced from the projected total the bot uploads (lines.projTotal) blended
--    with the book's total, the same way the page prices them.
--  * bot_pending_games also returns the ESPN league of a soccer match (lines.esl) so the bot can read its box score.
-- Every existing function is either replaced whole (sport_sd, exp_points, run_sim, grade_leg, resolve_leg, bot_pending_games) or edited in place by text
-- replacement (battle_markets_core, award_day, create_battle, create_cpu_battle), exactly like patch_hockey_tennis.sql did.

alter table public.battles drop constraint if exists battles_sport_check;
alter table public.battles add constraint battles_sport_check check (sport in ('nfl','nba','wnba','mlb','cfb','cbb','nhl','tennis','soccer'));

create or replace function ls_private.sport_sd(p_sport text, which text) returns double precision language sql immutable as $$
  select case p_sport when 'nfl' then case which when 'm' then 14.5 else 14.6 end
                      when 'cfb' then case which when 'm' then 17.0 else 17.0 end
                      when 'nba' then case which when 'm' then 13.0 else 18.0 end
                      when 'wnba' then case which when 'm' then 12.0 else 15.0 end
                      when 'cbb' then case which when 'm' then 11.0 else 13.0 end
                      when 'nhl' then case which when 'm' then 2.35 else 2.4 end
                      when 'tennis' then case which when 'm' then 5.2 else 4.6 end
                      when 'soccer' then case which when 'm' then 1.7 else 1.7 end
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
  if p_sport = 'tennis' then
    pg := 1 / (1 + exp(-(th.o - ta.o)::double precision));
    return array[least(greatest(pg, 0.2), 0.8), 1 - least(greatest(pg, 0.2), 0.8), 0.5];
  end if;
  eh := th.lg_avg + th.hfa / 2 + th.o + ta.d;
  ea := th.lg_avg - th.hfa / 2 + ta.o + th.d;
  lo := case p_sport when 'nfl' then 10 when 'cfb' then 10 when 'nba' then 92 when 'wnba' then 62 when 'cbb' then 52 when 'nhl' then 1.4 when 'soccer' then 0.25 else 2.6 end;
  hi := case p_sport when 'nfl' then 38 when 'cfb' then 55 when 'nba' then 136 when 'wnba' then 106 when 'cbb' then 95 when 'nhl' then 5.0 when 'soccer' then 4.0 else 7.5 end;
  return array[least(greatest(eh, lo), hi), least(greatest(ea, lo), hi), th.lg_avg];
end $$;

-- ---------------------------------------------------------------- battle markets: soccer uses the hockey branch (exact Poisson, a level score goes to the winner of extra time / penalties)
do $mk$
declare src text;
begin
  src := pg_get_functiondef('public.battle_markets_core(text, text, text)'::regprocedure);
  if src not like '%''soccer''%' then
    src := replace(src, 'if p_sport not in (''nhl'', ''tennis'') then', 'if p_sport not in (''nhl'', ''tennis'', ''soccer'') then');
    src := replace(src, 'if p_sport = ''nhl'' then', 'if p_sport in (''nhl'', ''soccer'') then');
    src := replace(src, 'sdm := ls_private.sport_sd(''nhl'', ''m''); sdt := ls_private.sport_sd(''nhl'', ''t'');', 'sdm := ls_private.sport_sd(p_sport, ''m''); sdt := ls_private.sport_sd(p_sport, ''t'');');
    if src not like '%''soccer''%' then raise exception 'battle_markets_core: expected text not found, nothing changed'; end if;
    execute src;
  end if;
end $mk$;

-- ---------------------------------------------------------------- the soccer simulator: 90 minutes of Poisson goals, then extra time / penalties if level
create or replace function ls_private.sim_soccer(mk jsonb) returns jsonb language plpgsql volatile as $$
declare eh float := coalesce(mk ->> 'simh', mk ->> 'eh')::float; ea float := coalesce(mk ->> 'sima', mk ->> 'ea')::float; hab text := mk ->> 'home'; aab text := mk ->> 'away';
  hs int := 0; as_ int := 0; m int; side text; ab text; ev jsonb := '[]'::jsonb; q float; t float; et_min int;
  how text[] := array['curls it into the top corner', 'taps in at the back post', 'heads in from a corner', 'finishes a counter-attack', 'scores from the penalty spot', 'fires in from outside the box', 'slots it past the keeper one-on-one', 'pounces on a rebound'];
begin
  ev := ev || jsonb_build_array(jsonb_build_object('t', 0, 'kind', 'start', 'text', 'Kick-off: ' || aab || ' at ' || hab, 'hs', 0, 'as', 0, 'clock', '0'''));
  for m in 0 .. 89 loop
    for side in select unnest(array['home', 'away']) loop
      if random() < (case side when 'home' then eh else ea end) / 90.0 then
        if side = 'home' then hs := hs + 1; else as_ := as_ + 1; end if;
        ab := case side when 'home' then hab else aab end; t := (m + random()) / 90.0;
        ev := ev || jsonb_build_array(jsonb_build_object('t', t, 'kind', 'score', 'side', side, 'text', ab || ' GOAL! ' || how[1 + floor(random() * 8)::int],
          'hs', hs, 'as', as_, 'clock', (m + 1) || ''''));
      end if;
    end loop;
    if m = 44 then
      ev := ev || jsonb_build_array(jsonb_build_object('t', 0.5 + 0.0001, 'kind', 'period', 'text', 'Half-time: ' || aab || ' ' || as_ || ', ' || hab || ' ' || hs, 'hs', hs, 'as', as_, 'clock', 'HT'));
    end if;
  end loop;
  ev := ev || jsonb_build_array(jsonb_build_object('t', 1.0, 'kind', 'period', 'text', 'Full time: ' || aab || ' ' || as_ || ', ' || hab || ' ' || hs, 'hs', hs, 'as', as_, 'clock', 'FT'));
  if hs = as_ then
    q := least(greatest(eh / (eh + ea), 0.35), 0.65);
    side := case when random() < q then 'home' else 'away' end; ab := case side when 'home' then hab else aab end;
    if side = 'home' then hs := hs + 1; else as_ := as_ + 1; end if;
    if random() < 0.55 then
      et_min := 91 + floor(random() * 30)::int;
      ev := ev || jsonb_build_array(jsonb_build_object('t', 1.0 + 0.001, 'kind', 'score', 'side', side, 'text', ab || ' wins it in extra time!', 'hs', hs, 'as', as_, 'clock', et_min || ''''));
    else
      ev := ev || jsonb_build_array(jsonb_build_object('t', 1.0 + 0.002, 'kind', 'score', 'side', side, 'text', ab || ' wins the penalty shootout!', 'hs', hs, 'as', as_, 'clock', 'PEN'));
    end if;
  end if;
  return jsonb_build_object('hs', hs, 'as', as_, 'players', jsonb_build_object('_home', jsonb_build_object('pts', hs), '_away', jsonb_build_object('pts', as_)), 'ev', ev, 'inc', '[]'::jsonb);
end $$;

create or replace function ls_private.run_sim(mk jsonb) returns jsonb language plpgsql volatile as $$
begin
  if mk ->> 'sport' in ('nfl', 'cfb') then return ls_private.sim_football(mk); end if;
  if mk ->> 'sport' in ('nba', 'wnba', 'cbb') then return ls_private.sim_basketball(mk); end if;
  if mk ->> 'sport' = 'nhl' then return ls_private.sim_hockey(mk); end if;
  if mk ->> 'sport' = 'soccer' then return ls_private.sim_soccer(mk); end if;
  if mk ->> 'sport' = 'tennis' then return ls_private.sim_tennis(mk); end if;
  return ls_private.sim_mlb(mk);
end $$;

-- ---------------------------------------------------------------- sports lists in the existing functions
do $up$
declare fn text; src text; sigs text[] := array['public.create_battle(text, text, numeric, text, integer, integer)', 'public.create_cpu_battle(text, text, numeric, text, integer, integer, text)', 'ls_private.award_day(date)'];
begin
  foreach fn in array sigs loop
    src := pg_get_functiondef(fn::regprocedure);
    if src like '%''soccer''%' then continue; end if;
    src := replace(src, '''nhl'', ''tennis''', '''nhl'', ''tennis'', ''soccer''');
    src := replace(src, 'Pick NFL, NBA, WNBA, MLB, NHL, tennis,', 'Pick NFL, NBA, WNBA, MLB, NHL, soccer, tennis,');
    if src not like '%''soccer''%' then raise exception '%: expected sports list not found, nothing changed', fn; end if;
    execute src;
  end loop;
end $up$;

-- ---------------------------------------------------------------- grading real games: the soccer kinds
create or replace function ls_private.grade_leg(sp jsonb, f jsonb, g public.games) returns text language plpgsql stable as $$
declare k text := sp ->> 'k'; h numeric := (f ->> 'home')::numeric; a numeric := (f ->> 'away')::numeric; m numeric; v numeric; t numeric;
  pid text; played text; x numeric; fam text := coalesce(g.lg, ''); soc boolean := coalesce(g.lg, '') = 'soccer' or coalesce(sp ->> 'x3', '') <> '';
begin
  if sp is null or k is null then return 'V'; end if;
  if k = 'ml' then
    m := h - a;
    if sp ->> 'side' = 'draw' then return case when m = 0 then 'W' else 'L' end; end if;
    if m = 0 then return case when soc then 'L' else 'V' end; end if;          -- soccer: the 3-way result, a draw loses both sides
    return case when (sp ->> 'side' = 'home') = (m > 0) then 'W' else 'L' end;
  end if;
  if k = 'dc' then
    return case when (sp ->> 'side' = 'home' and h >= a) or (sp ->> 'side' = 'away' and a >= h) or (sp ->> 'side' = 'nodraw' and h <> a) then 'W' else 'L' end;
  end if;
  if k = 'btts' then return case when (sp ->> 'dir' = 'yes') = (h > 0 and a > 0) then 'W' else 'L' end; end if;
  if k = 'tt' then
    v := case when sp ->> 'side' = 'home' then h else a end; t := (sp ->> 'line')::numeric;
    if v = t then return 'V'; end if;
    return case when (sp ->> 'dir' = 'over') = (v > t) then 'W' else 'L' end;
  end if;
  if k = 'spr' then m := h - a; v := (case when sp ->> 'side' = 'home' then m else -m end) + (sp ->> 'line')::numeric;
    if v = 0 then return 'V'; end if; return case when v > 0 then 'W' else 'L' end; end if;
  if k = 'tot' then t := h + a; if t = (sp ->> 'line')::numeric then return 'V'; end if;
    return case when (sp ->> 'dir' = 'over') = (t > (sp ->> 'line')::numeric) then 'W' else 'L' end; end if;
  if k = 'prop' then
    pid := sp ->> 'pid'; played := f -> 'played' ->> pid;
    if played is null then
      -- not in the box score: the page treats an NFL player who was not ruled out as "played, 0"; everyone else is void
      if fam = 'nfl' and coalesce(g.props -> pid -> 'status' ->> 'kind', '') <> 'out' then played := 'true'; else return 'V'; end if;
    end if;
    if played <> 'true' then return 'V'; end if;
    if soc and not coalesce((f -> 'stat' -> pid) ? (sp ->> 'stat'), false) then return 'V'; end if;     -- soccer: a stat ESPN did not report is void, not zero
    x := coalesce((f -> 'stat' -> pid ->> (sp ->> 'stat'))::numeric, 0);
    if sp ->> 'dir' = 'lt' then return case when x < (sp ->> 'T')::numeric then 'W' else 'L' end; end if;
    return case when x >= (sp ->> 'T')::numeric then 'W' else 'L' end;
  end if;
  return 'V';
end $$;

-- ---------------------------------------------------------------- pricing a selection on a real game: the soccer kinds and alternate totals
create or replace function ls_private.resolve_leg(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, ls_private, pg_temp as $$
declare tok text; parts text[]; g public.games; k text; side text; st jsonb; pl jsonb; ln numeric; price int; lbl text;
  m jsonb; t numeric; pr numeric; now_ timestamptz := public.app_now(); cp int; soc boolean; sm jsonb; o jsonb; mu double precision; sd double precision; po double precision; fam text;
begin
  tok := case when jsonb_typeof(p) = 'string' then p #>> '{}' else p ->> 'tok' end;
  if tok is null or length(tok) > 120 then raise exception 'Bad selection'; end if;
  parts := string_to_array(tok, ':');
  k := parts[1];
  select * into g from public.games where gid = parts[2];
  if not found then raise exception 'That game is not open for practice bets (refresh the page)'; end if;
  if g.status = 'final' then raise exception '% is already final.', coalesce(g.title, 'That game'); end if;
  soc := coalesce(g.key, g.lg) = 'soccer'; sm := g.lines -> 'soc'; fam := coalesce(g.key, g.lg);
  if k in ('g', 'p') then
    if now_ >= g.start_at then raise exception '% has started. Use its live prices in the Live tab.', coalesce(g.title, 'That game'); end if;
    if k = 'g' then
      side := parts[4];
      if parts[3] = 'ml' and side in ('home', 'away') then
        price := (g.lines ->> (case side when 'home' then 'mlHome' else 'mlAway' end))::int;
        lbl := (case side when 'home' then g.home else g.away end) || case when soc then ' to win (90 min)' else ' moneyline' end;
        return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', lbl, 'price', price, 'live', false, 'grp', g.gid || ':ml',
          'spec', case when soc then jsonb_build_object('k', 'ml', 'side', side, 'x3', 1) else jsonb_build_object('k', 'ml', 'side', side) end);
      elsif parts[3] = 'ml' and side = 'draw' and soc then
        price := (sm -> 'ml3' -> 'draw' ->> 'price')::int; if price is null then raise exception 'No draw price for this match'; end if;
        return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', 'Draw (90 min)', 'price', price, 'live', false, 'grp', g.gid || ':ml',
          'spec', jsonb_build_object('k', 'ml', 'side', 'draw', 'x3', 1));
      elsif parts[3] = 'spr' and side in ('home', 'away') then
        ln := (g.lines ->> (case side when 'home' then 'sprHome' else 'sprAway' end))::numeric;
        price := (g.lines ->> (case side when 'home' then 'prHome' else 'prAway' end))::int;
        lbl := (case side when 'home' then g.home else g.away end) || ' ' || ls_private.sg(ln) || case when soc then ' goals' else '' end;
        return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', lbl, 'price', price, 'live', false, 'grp', g.gid || ':spr',
          'spec', jsonb_build_object('k', 'spr', 'side', side, 'line', ln));
      elsif parts[3] = 'tot' and side in ('over', 'under') then
        ln := (g.lines ->> 'total')::numeric;
        price := (g.lines ->> (case side when 'over' then 'over' else 'under' end))::int;
        lbl := initcap(side) || ' ' || ls_private.num_txt(ln) || case when soc then ' goals' else '' end;
        return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', lbl, 'price', price, 'live', false, 'grp', g.gid || ':tot',
          'spec', jsonb_build_object('k', 'tot', 'dir', side, 'line', ln));
      elsif parts[3] = 'dc' and side in ('home', 'away', 'nodraw') and soc then
        price := (sm -> 'dc' -> side ->> 'price')::int; if price is null then raise exception 'No double-chance price for this match'; end if;
        lbl := case side when 'home' then g.home || ' or draw' when 'away' then g.away || ' or draw' else g.home || ' or ' || g.away || ' (no draw)' end;
        return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', lbl, 'price', price, 'live', false, 'grp', g.gid || ':dc', 'spec', jsonb_build_object('k', 'dc', 'side', side));
      elsif parts[3] = 'btts' and side in ('yes', 'no') and soc then
        price := (sm -> 'btts' -> side ->> 'price')::int; if price is null then raise exception 'No both-teams-to-score price for this match'; end if;
        return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', 'Both teams to score: ' || initcap(side), 'price', price, 'live', false, 'grp', g.gid || ':btts', 'spec', jsonb_build_object('k', 'btts', 'dir', side));
      elsif parts[3] = 'at' and side in ('over', 'under') and coalesce(parts[5], '') ~ '^[0-9]+(\.[0-9]+)?$' then
        ln := parts[5]::numeric;
        if soc then
          o := sm -> 'tot' -> ls_private.num_txt(ln) -> side;
          if o is null then o := sm -> 'tot' -> (ln::text) -> side; end if;
          if o is null then raise exception 'That goal line is not offered'; end if;
          price := (o ->> 'price')::int; lbl := initcap(side) || ' ' || ls_private.num_txt(ln) || ' goals';
        else
          if g.lines ->> 'total' is null then raise exception 'No total for this game'; end if;
          mu := (g.lines ->> 'total')::double precision;
          if g.lines ->> 'projTotal' is not null then mu := 0.5 * (g.lines ->> 'projTotal')::double precision + 0.5 * mu; end if;
          if fam in ('mlb', 'nhl') then po := ls_private.pois_ge(floor(ln)::int + 1, greatest(mu, 0.5));
          else
            sd := case fam when 'nfl' then 13.5 when 'wnba' then 17 when 'cfb' then 16.5 when 'nba' then 18.8 when 'cbb' then 17.5 else 10 end;
            po := 1 - ls_private.phi((ln - mu) / sd);
          end if;
          pr := least(greatest((case when side = 'over' then po else 1 - po end)::numeric, 0.02), 0.97);
          price := ls_private.est_price(pr); lbl := initcap(side) || ' ' || ls_private.num_txt(ln) || ' (alt total)';
        end if;
        return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', lbl, 'price', price, 'live', false, 'grp', g.gid || ':tot', 'spec', jsonb_build_object('k', 'tot', 'dir', side, 'line', ln));
      elsif parts[3] = 'tt' and side in ('home', 'away') and soc and parts[5] in ('over', 'under') and coalesce(parts[6], '') ~ '^[0-9]+(\.[0-9]+)?$' then
        ln := parts[6]::numeric;
        o := sm -> 'tt' -> side -> ls_private.num_txt(ln) -> parts[5];
        if o is null then raise exception 'That team goal line is not offered'; end if;
        lbl := (case side when 'home' then g.home else g.away end) || ' ' || parts[5] || ' ' || ls_private.num_txt(ln) || ' goals';
        return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', lbl, 'price', (o ->> 'price')::int, 'live', false, 'grp', g.gid || ':tt:' || side,
          'spec', jsonb_build_object('k', 'tt', 'side', side, 'dir', parts[5], 'line', ln));
      end if;
      raise exception 'Unknown selection';
    end if;
    -- player props
    pl := g.props -> parts[3];
    st := pl -> 'stats' -> parts[4];
    if pl is null or st is null then raise exception 'That player prop is no longer offered (refresh the page)'; end if;
    if parts[5] = 'over' then
      ln := (st ->> 'line')::numeric; price := (st ->> 'overPrice')::int;
      lbl := ls_private.surname(pl ->> 'name') || ' Over ' || ls_private.num_txt(ln) || ' ' || lower(st ->> 'label');
      t := floor(ln) + 1;
    elsif parts[5] = 'safe' and st ? 'safeAdj' and st ->> 'safeAdj' is not null then
      t := (st ->> 'safeAdj')::numeric; price := (st ->> 'safePrice')::int;
      lbl := ls_private.surname(pl ->> 'name') || ' ' || ls_private.num_txt(t) || '+ ' || lower(st ->> 'label');
    elsif parts[5] = 'm' then
      t := parts[6]::numeric;
      select x into m from jsonb_array_elements(st -> 'miles') x where (x ->> 't')::numeric = t limit 1;
      if m is null then raise exception 'That line is no longer offered (refresh the page)'; end if;
      if m ->> 'price' is not null then price := (m ->> 'price')::int;
      else
        pr := least(greatest(((m ->> 'hit')::numeric + 1) / ((m ->> 'n')::numeric + 2) * (1 + 0.5 * coalesce((st ->> 'matchup')::numeric, 0)), 0.03), 0.95);
        price := ls_private.est_price(pr);
      end if;
      lbl := ls_private.surname(pl ->> 'name') || ' ' || ls_private.num_txt(t) || '+ ' || lower(st ->> 'label');
    else
      raise exception 'Unknown selection';
    end if;
    if price is null then raise exception 'No price for %', lbl; end if;
    return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', lbl, 'price', price, 'live', false, 'grp', g.gid || ':' || parts[3] || ':' || parts[4],
      'spec', jsonb_build_object('k', 'prop', 'pid', parts[3], 'stat', parts[4], 'T', t, 'dir', 'ge'));
  elsif k = 'l' then
    if now_ < g.start_at - interval '20 minutes' or now_ > g.start_at + make_interval(secs => ls_private.live_hours(coalesce(g.key, g.lg)) * 3600) then
      raise exception 'Live betting is closed for %', coalesce(g.title, 'that game');
    end if;
    if jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'price') <> 'number' then raise exception 'Live selections need a price'; end if;
    cp := (p ->> 'price')::numeric::int;
    if cp > 400 or cp < -10000 or (cp > -100 and cp < 100) then raise exception 'Live price % is out of range (practice live prices are capped at +400)', cp; end if;
    lbl := ls_private.clean_text(regexp_replace(p ->> 'label', '[<>]', '', 'g'), 90);
    if lbl = '' then lbl := 'Live selection'; end if;
    if parts[3] in ('ml', 'spr') and parts[4] in ('home', 'away') then
      if parts[3] = 'ml' then
        return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', lbl, 'price', cp, 'live', true, 'grp', 'L:' || g.gid || ':ml',
          'spec', jsonb_build_object('k', 'ml', 'side', parts[4]));
      end if;
      ln := (g.lines ->> (case parts[4] when 'home' then 'sprHome' else 'sprAway' end))::numeric;
      return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', lbl, 'price', cp, 'live', true, 'grp', 'L:' || g.gid || ':spr',
        'spec', jsonb_build_object('k', 'spr', 'side', parts[4], 'line', ln));
    elsif parts[3] = 'tot' and parts[4] in ('over', 'under') and parts[5] ~ '^[0-9]+(\.[0-9]+)?$' then
      return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', lbl, 'price', cp, 'live', true, 'grp', 'L:' || g.gid || ':tot',
        'spec', jsonb_build_object('k', 'tot', 'dir', parts[4], 'line', parts[5]::numeric));
    elsif parts[3] = 'p' and parts[6] in ('ge', 'lt') and parts[7] ~ '^[0-9]+(\.[0-9]+)?$' and coalesce(parts[4], '') <> '' then
      return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', lbl, 'price', cp, 'live', true, 'grp', 'L:' || g.gid || ':' || parts[4] || ':' || parts[5],
        'spec', jsonb_build_object('k', 'prop', 'pid', parts[4], 'stat', parts[5], 'T', parts[7]::numeric, 'dir', parts[6]));
    end if;
    raise exception 'Unknown live selection';
  end if;
  raise exception 'Unknown selection';
end $$;

-- ---------------------------------------------------------------- the bot's list of games to settle: soccer needs its ESPN league
create or replace function public.bot_pending_games() returns jsonb
language sql stable security definer set search_path = public, ls_private, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('gid', g.gid, 'lg', g.lg, 'key', g.key, 'start', g.start_at, 'esl', g.lines ->> 'esl',
           'props', exists (select 1 from public.bet_legs l2 where l2.gid = g.gid and l2.res is null and l2.spec ->> 'k' = 'prop'))), '[]'::jsonb)
  from public.games g
  where g.status <> 'final' and g.start_at < public.app_now() and exists (select 1 from public.bet_legs l where l.gid = g.gid and l.res is null)
$$;
