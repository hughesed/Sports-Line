-- =====================================================================================================================
--  Line Scout: social backend for Supabase (free tier).  PRACTICE COINS ONLY: no real money, nothing to buy, no cash-out.
--
--  HOW TO USE: Supabase dashboard > SQL Editor > New query > paste this WHOLE file > Run.
--  It is safe to run again (every statement is idempotent), e.g. after an update of this file.
--
--  What it creates: profiles (username, coin balance), a ledger of every coin movement, server-side practice bets on real
--  games (settled by the GitHub bot), the daily leaderboard + badges, chat with @mentions, and Battles (simulated games
--  between two players). All coin movements happen ONLY inside SECURITY DEFINER functions below; the tables are read-only
--  for the app (row level security), so balances, badges and stats cannot be edited from a browser.
-- =====================================================================================================================

create extension if not exists pg_cron;           -- Supabase free tier includes pg_cron; this turns it on

create schema if not exists ls_private;           -- internal helpers: NOT exposed through the API
revoke all on schema ls_private from public;

-- ---------------------------------------------------------------- clock (a fake clock exists only for automated tests)
create table if not exists ls_private.settings(id int primary key default 1 check (id = 1), fake_now timestamptz);
insert into ls_private.settings(id) values (1) on conflict do nothing;

create or replace function public.app_now() returns timestamptz
language sql stable security definer set search_path = public, ls_private, pg_temp as $$
  select coalesce((select fake_now from ls_private.settings where id = 1), now())
$$;
create or replace function ls_private.et_day(ts timestamptz) returns date language sql immutable as $$
  select (ts at time zone 'America/New_York')::date
$$;
create or replace function ls_private.today() returns date language sql stable as $$
  select ls_private.et_day(public.app_now())
$$;

-- ---------------------------------------------------------------- tables
create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,18}$'),
  created_at timestamptz not null default now(),
  balance numeric(14,2) not null default 0 check (balance >= 0),
  streak int not null default 0,
  last_chat_at timestamptz
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

create table if not exists public.ledger(
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  amount numeric(14,2) not null,
  balance_after numeric(14,2) not null,
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists ledger_user on public.ledger(user_id, id desc);

create table if not exists public.daily_stats(
  day date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  net numeric(14,2) not null default 0,
  actions int not null default 0,
  mentions int not null default 0,
  primary key(day, user_id)
);
create index if not exists daily_stats_user on public.daily_stats(user_id, day);

create table if not exists public.badges(
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('champion','trash','active','convo','king','hot')),
  day date not null,
  sport text not null default '',
  detail text,
  created_at timestamptz not null default now()
);
create unique index if not exists badges_daily_unique on public.badges(kind, day, sport) where kind <> 'hot';
create unique index if not exists badges_hot_unique on public.badges(user_id, day) where kind = 'hot';
create index if not exists badges_user on public.badges(user_id);

create table if not exists public.finalized_days(day date primary key, finalized_at timestamptz not null default now(), summary jsonb);

-- real games the bot publishes (lines + player props as on the page), used to price and check practice bets
create table if not exists public.games(
  gid text primary key,
  lg text not null,
  key text,
  start_at timestamptz not null,
  home text, away text, title text,
  lines jsonb not null default '{}'::jsonb,
  props jsonb not null default '{}'::jsonb,
  status text not null default 'pre',
  final jsonb,
  final_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.bets(
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  placed_at timestamptz not null default now(),
  stake numeric(14,2) not null check (stake > 0),
  mode text not null,
  boost jsonb,
  status text not null default 'pending' check (status in ('pending','won','lost','void')),
  payout numeric(14,2) not null default 0,
  settled_at timestamptz
);
create index if not exists bets_user on public.bets(user_id, id desc);
create index if not exists bets_pending on public.bets(status) where status = 'pending';

create table if not exists public.bet_legs(
  id bigserial primary key,
  bet_id bigint not null references public.bets(id) on delete cascade,
  tok text not null,
  gid text not null,
  label text not null,
  price int not null,
  live boolean not null default false,
  spec jsonb,
  grp text,
  res text check (res in ('W','L','V')),
  graded_at timestamptz
);
create index if not exists bet_legs_bet on public.bet_legs(bet_id);
create index if not exists bet_legs_open on public.bet_legs(gid) where res is null;

create table if not exists public.chat_messages(
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  username text not null,
  body text not null default '',
  img text,
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists chat_recent on public.chat_messages(id desc);

create table if not exists public.mentions(
  id bigserial primary key,
  msg_id bigint not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  from_user uuid,
  from_name text,
  day date not null,
  created_at timestamptz not null default now(),
  unique(msg_id, user_id)
);
create index if not exists mentions_user on public.mentions(user_id, id desc);

-- battle data uploaded by the bot (latest team ratings + player averages)
create table if not exists public.sim_teams(
  sport text not null, abbr text not null, name text, short text, color text,
  o numeric not null default 0, d numeric not null default 0, gp int not null default 0,
  lg_avg numeric not null, hfa numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key(sport, abbr)
);
create table if not exists public.sim_players(
  sport text not null, pid text not null, team text not null, name text not null, pos text, role text, rk int not null default 9,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(sport, pid)
);
create index if not exists sim_players_team on public.sim_players(sport, team, role, rk);

create table if not exists public.battles(
  id bigserial primary key,
  sport text not null check (sport in ('nfl','nba','mlb')),
  home text not null, away text not null,
  wager numeric(14,2) not null check (wager >= 1),
  creator uuid not null references public.profiles(id) on delete cascade,
  creator_side text not null check (creator_side in ('home','away')),
  opponent uuid references public.profiles(id) on delete cascade,
  opponent_side text check (opponent_side in ('home','away')),
  status text not null default 'open' check (status in ('open','building','live','final','cancelled')),
  markets jsonb not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz, started_at timestamptz, ends_at timestamptz, settled_at timestamptz,
  winner uuid,
  result jsonb,
  cancel_reason text
);
create index if not exists battles_status on public.battles(status, id desc);
create index if not exists battles_creator on public.battles(creator);
create index if not exists battles_opponent on public.battles(opponent);

create table if not exists public.battle_parlays(
  battle_id bigint not null references public.battles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  legs jsonb not null default '[]'::jsonb,
  locked boolean not null default false,
  payout numeric(14,2), hits int, graded jsonb,
  updated_at timestamptz not null default now(),
  primary key(battle_id, user_id)
);
create table if not exists public.battle_events(
  id bigserial primary key,
  battle_id bigint not null references public.battles(id) on delete cascade,
  seq int not null,
  visible_at timestamptz not null,
  kind text not null,
  text text not null,
  hs int not null, as_ int not null,
  clock text,
  wp numeric,
  stats jsonb
);
create index if not exists battle_events_b on public.battle_events(battle_id, seq);
create table if not exists public.battle_results(
  battle_id bigint primary key references public.battles(id) on delete cascade,
  ends_at timestamptz not null,
  home_score int not null, away_score int not null,
  players jsonb not null default '{}'::jsonb
);
create table if not exists public.spectator_bets(
  id bigserial primary key,
  battle_id bigint not null references public.battles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  tok text not null, label text not null, price int not null,
  stake numeric(14,2) not null check (stake > 0),
  status text not null default 'pending' check (status in ('pending','won','lost','void')),
  payout numeric(14,2) not null default 0,
  created_at timestamptz not null default now(), settled_at timestamptz
);
create index if not exists spectator_bets_b on public.spectator_bets(battle_id);
create index if not exists spectator_bets_u on public.spectator_bets(user_id, id desc);
create table if not exists public.battle_stats(
  user_id uuid not null references public.profiles(id) on delete cascade,
  sport text not null,
  elo numeric(8,2) not null default 1200,
  w int not null default 0, l int not null default 0, t int not null default 0, rated int not null default 0,
  primary key(user_id, sport)
);

-- ---------------------------------------------------------------- small math helpers
create or replace function ls_private.dec_of(price int) returns numeric language sql immutable as $$
  select case when price > 0 then 1 + price / 100.0 else 1 + 100.0 / abs(price) end
$$;
create or replace function ls_private.amer_of(d numeric) returns int language sql immutable as $$
  select case when d >= 2 then round((d - 1) * 100)::int else -round(100 / greatest(d - 1, 0.0001))::int end
$$;
-- same as the page's estPrice(): a 4.5% hold on top of a probability
create or replace function ls_private.est_price(p0 numeric) returns int language plpgsql immutable as $$
declare p numeric := least(greatest(p0 * 1.045, 0.03), 0.97);
begin
  if p >= 0.5 then return greatest(-1000, -round(100 * p / (1 - p))::int); end if;
  return round(100 * (1 - p) / p)::int;
end $$;
create or replace function ls_private.erf(x0 double precision) returns double precision language plpgsql immutable as $$
declare s double precision := sign(x0); x double precision := abs(x0); t double precision; y double precision;
begin
  t := 1 / (1 + 0.3275911 * x);
  y := 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return s * y;
end $$;
create or replace function ls_private.phi(x double precision) returns double precision language sql immutable as $$
  select 0.5 * (1 + ls_private.erf(x / sqrt(2)))
$$;
create or replace function ls_private.gauss() returns double precision language plpgsql volatile as $$
declare u double precision := random();
begin
  while u <= 1e-12 loop u := random(); end loop;
  return sqrt(-2 * ln(u)) * cos(2 * pi() * random());
end $$;
create or replace function ls_private.pois(l double precision) returns int language plpgsql volatile as $$
declare lim double precision; k int := 0; p double precision := 1;
begin
  if l <= 0 then return 0; end if;
  if l > 40 then return greatest(0, round(l + sqrt(l) * ls_private.gauss())::int); end if;
  lim := exp(-l);
  loop k := k + 1; p := p * random(); exit when p <= lim or k > 200; end loop;
  return k - 1;
end $$;
-- P(X >= k) for X ~ Poisson(l)
create or replace function ls_private.pois_ge(k int, l double precision) returns double precision language plpgsql immutable as $$
declare term double precision; cdf double precision; i int;
begin
  if k <= 0 then return 1; end if;
  if l <= 0 then return 0; end if;
  term := exp(-l); cdf := term;
  for i in 1..k - 1 loop term := term * l / i; cdf := cdf + term; end loop;
  return least(greatest(1 - cdf, 0), 1);
end $$;
create or replace function ls_private.num_txt(x numeric) returns text language sql immutable as $$
  select trim_scale(x)::text
$$;
create or replace function ls_private.surname(n text) returns text language plpgsql immutable as $$
declare w text[]; out text := null; x text;
begin
  foreach x in array regexp_split_to_array(regexp_replace(coalesce(n, ''), '[.,]', '', 'g'), ' ') loop
    if x <> '' and lower(x) not in ('jr','sr','ii','iii','iv') then out := x; end if;
  end loop;
  return coalesce(out, n);
end $$;
create or replace function ls_private.clean_text(s text, maxlen int) returns text language sql immutable as $$
  select left(btrim(regexp_replace(coalesce(s, ''), '[\x01-\x09\x0B-\x1F\x7F]', '', 'g')), maxlen)
$$;

-- ---------------------------------------------------------------- coins: the only place balances change
create or replace function ls_private.move_coins(p_user uuid, p_amount numeric, p_kind text, p_ref text) returns numeric
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare nb numeric;
begin
  update public.profiles set balance = balance + p_amount where id = p_user and balance + p_amount >= 0 returning balance into nb;
  if nb is null then
    if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Pick a username first'; end if;
    raise exception 'Not enough coins';
  end if;
  insert into public.ledger(user_id, kind, amount, balance_after, ref) values (p_user, p_kind, p_amount, nb, p_ref);
  return nb;
end $$;
create or replace function ls_private.add_net(p_user uuid, p_net numeric) returns void
language sql security definer set search_path = public, ls_private, pg_temp as $$
  insert into public.daily_stats(day, user_id, net) values (ls_private.today(), p_user, round(p_net, 2))
  on conflict (day, user_id) do update set net = public.daily_stats.net + excluded.net
$$;
create or replace function ls_private.add_action(p_user uuid) returns void
language sql security definer set search_path = public, ls_private, pg_temp as $$
  insert into public.daily_stats(day, user_id, actions) values (ls_private.today(), p_user, 1)
  on conflict (day, user_id) do update set actions = public.daily_stats.actions + 1
$$;
-- HOT STREAK: 5 winning settled slips/battles in a row earns the badge (at most one per day); a loss resets the count
create or replace function ls_private.streak(p_user uuid, p_res text) returns void
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare s int;
begin
  if p_res = 'L' then update public.profiles set streak = 0 where id = p_user; return; end if;
  if p_res <> 'W' then return; end if;
  update public.profiles set streak = streak + 1 where id = p_user returning streak into s;
  if s >= 5 then
    insert into public.badges(user_id, kind, day, detail) values (p_user, 'hot', ls_private.today(), '5 wins in a row')
      on conflict (user_id, day) where kind = 'hot' do nothing;
    update public.profiles set streak = 0 where id = p_user;
  end if;
end $$;

-- ---------------------------------------------------------------- accounts
create or replace function public.username_available(p_name text) returns boolean
language sql stable security definer set search_path = public, ls_private, pg_temp as $$
  select coalesce(p_name, '') ~ '^[A-Za-z0-9_]{3,18}$' and not exists (select 1 from public.profiles where lower(username) = lower(p_name))
$$;
create or replace function ls_private.new_profile(p_id uuid, p_name text) returns void
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
begin
  insert into public.profiles(id, username, balance) values (p_id, p_name, 0);
  perform ls_private.move_coins(p_id, 1000, 'signup', 'welcome coins');
end $$;
-- runs when Supabase Auth creates a user: takes the username chosen at sign-up (if valid and free)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare nm text := new.raw_user_meta_data ->> 'username';
begin
  if nm ~ '^[A-Za-z0-9_]{3,18}$' and not exists (select 1 from public.profiles where lower(username) = lower(nm)) then
    begin
      perform ls_private.new_profile(new.id, nm);
    exception when unique_violation then null;   -- the page asks for another name (claim_username)
    end;
  end if;
  return new;
end $$;
drop trigger if exists ls_on_auth_user_created on auth.users;
create trigger ls_on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- fallback when the sign-up name was taken in the meantime: the page asks for a name and calls this
create or replace function public.claim_username(p_name text) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); pr public.profiles;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  select * into pr from public.profiles where id = uid;
  if found then return jsonb_build_object('username', pr.username, 'balance', pr.balance); end if;
  if coalesce(p_name, '') !~ '^[A-Za-z0-9_]{3,18}$' then raise exception 'Usernames are 3 to 18 letters, numbers or _'; end if;
  begin
    perform ls_private.new_profile(uid, p_name);
  exception when unique_violation then raise exception 'That username is taken';
  end;
  return jsonb_build_object('username', p_name, 'balance', 1000);
end $$;

-- =====================================================================================================================
--  Practice bets on real games. Prices for pregame legs come from the server copy of the slate (public.games, uploaded
--  by the bot), never from the browser. Live legs (l:...) are priced by the page's live model; the server only accepts
--  them inside the game's live window and within a price cap (see README "Limits").
-- =====================================================================================================================
create or replace function ls_private.boost_of(p_id text) returns jsonb language sql immutable as $$
  select b from jsonb_array_elements('[
    {"id":"dk50","book":"DraftKings","name":"SGP Profit Boost","pct":50,"sgp":true,"minLegs":3},
    {"id":"bet50","book":"bet365","name":"Profit Boost (primetime)","pct":50,"sgp":false,"minLegs":2},
    {"id":"fan50","book":"Fanatics","name":"SGP Profit Boost (primetime)","pct":50,"sgp":true,"minLegs":2},
    {"id":"fd30","book":"FanDuel","name":"SGP Profit Boost","pct":30,"sgp":true,"minLegs":2},
    {"id":"czr30","book":"Caesars","name":"Profit Boost","pct":30,"sgp":false,"minLegs":2},
    {"id":"fd25","book":"FanDuel","name":"SGP Profit Boost (NBA promo)","pct":25,"sgp":true,"minLegs":2},
    {"id":"dk20","book":"DraftKings","name":"Parlay Boost","pct":20,"sgp":false,"minLegs":2},
    {"id":"mgm10","book":"BetMGM","name":"SGP Token / Parlay Boost","pct":10,"sgp":true,"minLegs":2}]'::jsonb) b
  where b ->> 'id' = p_id
$$;
create or replace function ls_private.live_hours(p_key text) returns numeric language sql immutable as $$
  select case p_key when 'nfl' then 4.0 when 'cfb' then 4.5 when 'nba' then 3.0 when 'cbb' then 2.6 when 'wnba' then 2.6 when 'mlb' then 4.5 else 4.0 end
$$;
create or replace function ls_private.sg(x numeric) returns text language sql immutable as $$
  select case when x > 0 then '+' else '' end || ls_private.num_txt(round(x, 1))
$$;

-- token -> {tok, gid, label, price, live, spec, grp}.  Same tokens as the page: g:gid:ml|spr|tot:side, p:gid:pid:stat:over|safe|m:T,
-- l:gid:ml|spr:side, l:gid:tot:dir:line, l:gid:p:pid:stat:ge|lt:T
create or replace function ls_private.resolve_leg(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, ls_private, pg_temp as $$
declare tok text; parts text[]; g public.games; k text; side text; st jsonb; pl jsonb; ln numeric; price int; lbl text;
  m jsonb; t numeric; pr numeric; now_ timestamptz := public.app_now(); cp int;
begin
  tok := case when jsonb_typeof(p) = 'string' then p #>> '{}' else p ->> 'tok' end;
  if tok is null or length(tok) > 120 then raise exception 'Bad selection'; end if;
  parts := string_to_array(tok, ':');
  k := parts[1];
  select * into g from public.games where gid = parts[2];
  if not found then raise exception 'That game is not open for practice bets (refresh the page)'; end if;
  if g.status = 'final' then raise exception '% is already final.', coalesce(g.title, 'That game'); end if;
  if k in ('g', 'p') then
    if now_ >= g.start_at then raise exception '% has started. Use its live prices in the Live tab.', coalesce(g.title, 'That game'); end if;
    if k = 'g' then
      side := parts[4];
      if parts[3] = 'ml' and side in ('home', 'away') then
        price := (g.lines ->> (case side when 'home' then 'mlHome' else 'mlAway' end))::int;
        lbl := (case side when 'home' then g.home else g.away end) || ' moneyline';
        return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', lbl, 'price', price, 'live', false, 'grp', g.gid || ':ml',
          'spec', jsonb_build_object('k', 'ml', 'side', side));
      elsif parts[3] = 'spr' and side in ('home', 'away') then
        ln := (g.lines ->> (case side when 'home' then 'sprHome' else 'sprAway' end))::numeric;
        price := (g.lines ->> (case side when 'home' then 'prHome' else 'prAway' end))::int;
        lbl := (case side when 'home' then g.home else g.away end) || ' ' || ls_private.sg(ln);
        return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', lbl, 'price', price, 'live', false, 'grp', g.gid || ':spr',
          'spec', jsonb_build_object('k', 'spr', 'side', side, 'line', ln));
      elsif parts[3] = 'tot' and side in ('over', 'under') then
        ln := (g.lines ->> 'total')::numeric;
        price := (g.lines ->> (case side when 'over' then 'over' else 'under' end))::int;
        lbl := initcap(side) || ' ' || ls_private.num_txt(ln);
        return jsonb_build_object('tok', tok, 'gid', g.gid, 'label', lbl, 'price', price, 'live', false, 'grp', g.gid || ':tot',
          'spec', jsonb_build_object('k', 'tot', 'dir', side, 'line', ln));
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

create or replace function public.place_bet(p_legs jsonb, p_stake numeric, p_mode text default 'parlay', p_boost text default null) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); st numeric := round(coalesce(p_stake, 0), 2); n int; i int; leg jsonb; legs jsonb := '[]'::jsonb;
  grps text[] := '{}'; gids text[] := '{}'; dec numeric := 1; bst jsonb; cost numeric; bal numeric; bid bigint; ids bigint[] := '{}';
begin
  if uid is null then raise exception 'Sign in to bet'; end if;
  if not exists (select 1 from public.profiles where id = uid) then raise exception 'Pick a username first'; end if;
  if jsonb_typeof(p_legs) is distinct from 'array' then raise exception 'Bad slip'; end if;
  n := jsonb_array_length(p_legs);
  if n < 1 or n > 12 then raise exception 'A slip needs 1 to 12 selections'; end if;
  if st < 0.01 then raise exception 'Enter a stake of at least 0.01 coins'; end if;
  if st > 1000000 then raise exception 'That stake is too large'; end if;
  if p_mode not in ('parlay', 'single') then raise exception 'Bad bet type'; end if;
  for i in 0 .. n - 1 loop
    leg := ls_private.resolve_leg(p_legs -> i);
    if (leg ->> 'grp') = any(grps) then raise exception 'Two selections from the same market: %', leg ->> 'label'; end if;
    grps := grps || (leg ->> 'grp');
    if not (leg ->> 'gid') = any(gids) then gids := gids || (leg ->> 'gid'); end if;
    dec := dec * ls_private.dec_of((leg ->> 'price')::int);
    legs := legs || jsonb_build_array(leg);
  end loop;
  if p_mode = 'parlay' and dec > 5000 then raise exception 'Parlay odds are capped at about +500000 in practice mode'; end if;
  if p_mode = 'parlay' and n > 1 and p_boost is not null then
    bst := ls_private.boost_of(p_boost);
    if bst is not null and (n < (bst ->> 'minLegs')::int or ((bst ->> 'sgp')::boolean and array_length(gids, 1) > 1)) then bst := null; end if;
    if bst is not null then bst := bst - 'sgp'; end if;
  end if;
  cost := case when p_mode = 'single' then st * n else st end;
  bal := ls_private.move_coins(uid, -cost, 'bet_stake', 'slip of ' || n || ' leg' || case when n > 1 then 's' else '' end);
  if p_mode = 'single' then
    for i in 0 .. n - 1 loop
      leg := legs -> i;
      insert into public.bets(user_id, stake, mode, boost) values (uid, st, 'single', null) returning id into bid;
      insert into public.bet_legs(bet_id, tok, gid, label, price, live, spec, grp)
        values (bid, leg ->> 'tok', leg ->> 'gid', leg ->> 'label', (leg ->> 'price')::int, (leg ->> 'live')::boolean, leg -> 'spec', leg ->> 'grp');
      ids := ids || bid;
      perform ls_private.add_action(uid);
    end loop;
  else
    insert into public.bets(user_id, stake, mode, boost) values (uid, st, case when n > 1 then 'parlay' else 'single' end, bst) returning id into bid;
    insert into public.bet_legs(bet_id, tok, gid, label, price, live, spec, grp)
      select bid, x ->> 'tok', x ->> 'gid', x ->> 'label', (x ->> 'price')::int, (x ->> 'live')::boolean, x -> 'spec', x ->> 'grp' from jsonb_array_elements(legs) x;
    ids := ids || bid;
    perform ls_private.add_action(uid);
  end if;
  update public.ledger set ref = 'bets ' || array_to_string(ids, ',') where id = (select max(id) from public.ledger where user_id = uid and kind = 'bet_stake');
  return jsonb_build_object('ok', true, 'balance', bal, 'bets', to_jsonb(ids), 'legs', legs, 'cost', cost, 'boost', bst);
end $$;

-- port of the page's gradeLeg(): W / L / V (void = push or did not play)
create or replace function ls_private.grade_leg(sp jsonb, f jsonb, g public.games) returns text language plpgsql stable as $$
declare k text := sp ->> 'k'; h numeric := (f ->> 'home')::numeric; a numeric := (f ->> 'away')::numeric; m numeric; v numeric; t numeric;
  pid text; played text; x numeric; fam text := coalesce(g.lg, '');
begin
  if sp is null or k is null then return 'V'; end if;
  if k = 'ml' then m := h - a; if m = 0 then return 'V'; end if; return case when (sp ->> 'side' = 'home') = (m > 0) then 'W' else 'L' end; end if;
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
    x := coalesce((f -> 'stat' -> pid ->> (sp ->> 'stat'))::numeric, 0);
    if sp ->> 'dir' = 'lt' then return case when x < (sp ->> 'T')::numeric then 'W' else 'L' end; end if;
    return case when x >= (sp ->> 'T')::numeric then 'W' else 'L' end;
  end if;
  return 'V';
end $$;

create or replace function ls_private.settle_bet(p_bet bigint) returns text
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare b public.bets; nl int; nopen int; nlive int; d numeric; pay numeric; bst jsonb;
begin
  select * into b from public.bets where id = p_bet for update;
  if not found or b.status <> 'pending' then return null; end if;
  select count(*) filter (where res = 'L'), count(*) filter (where res is null), count(*) filter (where res = 'W')
    into nl, nopen, nlive from public.bet_legs where bet_id = p_bet;
  if nl > 0 then
    update public.bets set status = 'lost', payout = 0, settled_at = public.app_now() where id = p_bet;
    perform ls_private.add_net(b.user_id, -b.stake);
    perform ls_private.streak(b.user_id, 'L');
    return 'lost';
  end if;
  if nopen > 0 then return null; end if;
  if nlive = 0 then
    update public.bets set status = 'void', payout = b.stake, settled_at = public.app_now() where id = p_bet;
    perform ls_private.move_coins(b.user_id, b.stake, 'bet_refund', 'bet ' || p_bet);
    return 'void';
  end if;
  select exp(sum(ln(ls_private.dec_of(price)))) into d from public.bet_legs where bet_id = p_bet and res = 'W';
  bst := b.boost;
  if bst is not null and nlive >= coalesce((bst ->> 'minLegs')::int, 2) then d := 1 + (d - 1) * (1 + (bst ->> 'pct')::numeric / 100); end if;
  pay := round(b.stake * d, 2);
  update public.bets set status = 'won', payout = pay, settled_at = public.app_now() where id = p_bet;
  perform ls_private.move_coins(b.user_id, pay, 'bet_payout', 'bet ' || p_bet);
  perform ls_private.add_net(b.user_id, pay - b.stake);
  perform ls_private.streak(b.user_id, 'W');
  return 'won';
end $$;

-- BOT ONLY (service role): which games have open legs and need a final?
create or replace function public.bot_pending_games() returns jsonb
language sql stable security definer set search_path = public, ls_private, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('gid', g.gid, 'lg', g.lg, 'key', g.key, 'start', g.start_at,
           'props', exists (select 1 from public.bet_legs l2 where l2.gid = g.gid and l2.res is null and l2.spec ->> 'k' = 'prop'))), '[]'::jsonb)
  from public.games g
  where g.status <> 'final' and g.start_at < public.app_now() and exists (select 1 from public.bet_legs l where l.gid = g.gid and l.res is null)
$$;

-- BOT ONLY: finals [{gid, home, away, played:{pid:true|false}, stat:{pid:{key:value}}}] -> grade legs, settle slips; also voids stale legs
create or replace function public.bot_settle_games(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare f jsonb; v_g public.games; r record; ngames int := 0; nlegs int := 0; c int; v_res text; won int := 0; lost int := 0; voided int := 0;
begin
  for f in select x from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x loop
    select * into v_g from public.games where gid = f ->> 'gid' for update;
    if not found or f ->> 'home' is null or f ->> 'away' is null then continue; end if;
    update public.games set status = 'final', final = f, final_at = public.app_now() where gid = v_g.gid;
    update public.bet_legs set res = ls_private.grade_leg(spec, f, v_g), graded_at = public.app_now() where gid = v_g.gid and res is null;
    get diagnostics c = row_count; nlegs := nlegs + c; ngames := ngames + 1;
  end loop;
  -- legs whose game never produced a final (postponed, cancelled, feed gone) are void 48 h after the scheduled start
  update public.bet_legs l set res = 'V', graded_at = public.app_now()
    from public.games g where l.gid = g.gid and l.res is null and g.status <> 'final' and g.start_at < public.app_now() - interval '48 hours';
  get diagnostics c = row_count; nlegs := nlegs + c;
  for r in select distinct b.id from public.bets b join public.bet_legs l on l.bet_id = b.id where b.status = 'pending' and l.res is not null loop
    v_res := ls_private.settle_bet(r.id);
    if v_res = 'won' then won := won + 1; elsif v_res = 'lost' then lost := lost + 1; elsif v_res = 'void' then voided := voided + 1; end if;
  end loop;
  -- old finished games without open legs are not needed any more
  delete from public.games g where g.start_at < public.app_now() - interval '10 days' and not exists (select 1 from public.bet_legs l where l.gid = g.gid and l.res is null);
  return jsonb_build_object('games', ngames, 'legs', nlegs, 'won', won, 'lost', lost, 'void', voided);
end $$;

-- =====================================================================================================================
--  Chat (signed-in users), @mentions, daily leaderboard, badges, profiles
-- =====================================================================================================================
create or replace function public.send_chat(p_body text, p_img text default null) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); pr public.profiles; body text; mid bigint;
begin
  if uid is null then raise exception 'Sign in to chat'; end if;
  select * into pr from public.profiles where id = uid for update;
  if not found then raise exception 'Pick a username first'; end if;
  if pr.last_chat_at is not null and pr.last_chat_at > now() - interval '2 seconds' then raise exception 'Slow down: one message every 2 seconds'; end if;
  body := btrim(regexp_replace(coalesce(p_body, ''), '[\x01-\x09\x0B-\x1F\x7F]', '', 'g'));
  if length(body) > 500 then raise exception 'Messages are limited to 500 characters'; end if;
  if p_img is not null then
    if length(p_img) > 122880 then raise exception 'Pictures are limited to 120 KB'; end if;
    if p_img !~ '^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'That picture format is not allowed'; end if;
  end if;
  if body = '' and p_img is null then raise exception 'Empty message'; end if;
  insert into public.chat_messages(user_id, username, body, img) values (uid, pr.username, body, p_img) returning id into mid;
  update public.profiles set last_chat_at = now() where id = uid;
  perform ls_private.add_action(uid);
  return jsonb_build_object('id', mid);
end $$;

create or replace function public.delete_chat(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
begin
  update public.chat_messages set deleted = true, body = '', img = null where id = p_id and user_id = auth.uid() and not deleted;
  if not found then raise exception 'You can only delete your own messages'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- @username mentions are recorded by the database (only for usernames that exist; not for yourself)
create or replace function public.chat_mentions_trigger() returns trigger
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare nm text; target uuid; c int := 0;
begin
  for nm in select distinct lower(m[1]) from regexp_matches(new.body, '@([A-Za-z0-9_]{3,18})', 'g') as m loop
    exit when c >= 10;
    select id into target from public.profiles where lower(username) = nm;
    if target is not null and target <> new.user_id then
      insert into public.mentions(msg_id, user_id, from_user, from_name, day) values (new.id, target, new.user_id, new.username, ls_private.today())
        on conflict do nothing;
      if found then
        insert into public.daily_stats(day, user_id, mentions) values (ls_private.today(), target, 1)
          on conflict (day, user_id) do update set mentions = public.daily_stats.mentions + 1;
        c := c + 1;
      end if;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists ls_chat_mentions on public.chat_messages;
create trigger ls_chat_mentions after insert on public.chat_messages for each row execute function public.chat_mentions_trigger();

-- ---------------------------------------------------------------- daily reset: badges for every ET day that has ended
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
  foreach s in array array['nfl', 'nba', 'mlb'] loop
    select user_id, elo into r from public.battle_stats where sport = s and rated >= 3 order by elo desc, user_id limit 1;
    if found then insert into public.badges(user_id, kind, day, sport, detail) values (r.user_id, 'king', d, s, 'Elo ' || round(r.elo)) on conflict do nothing;
      out := out || jsonb_build_object('king_' || s, r.user_id); end if;
  end loop;
  return out;
end $$;

-- Safe to call any time, from anywhere, as often as you like (pg_cron every 10 min, the bot, and the page all call it)
create or replace function public.finalize_days() returns int
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare d date; last date; today date := ls_private.today(); n int := 0; sm jsonb; r record;
begin
  if exists (select 1 from public.finalized_days where day = today - 1) then return 0; end if;   -- fast path: nothing to do
  perform pg_advisory_xact_lock(hashtext('ls_finalize_days'));
  select max(day) into last from public.finalized_days;
  if last is null then select min(day) - 1 into last from public.daily_stats; end if;
  if last is null then last := today - 1; end if;
  last := greatest(last, today - 60);
  d := last + 1;
  while d < today loop
    insert into public.finalized_days(day) values (d) on conflict do nothing;
    if found then
      sm := ls_private.award_day(d);
      update public.finalized_days set summary = sm where day = d;
      n := n + 1;
    end if;
    d := d + 1;
  end loop;
  if n > 0 then   -- daily top-up: nobody stays locked out
    for r in select id, balance from public.profiles where balance < 100 for update loop
      perform ls_private.move_coins(r.id, 100 - r.balance, 'topup', 'daily top-up to 100');
    end loop;
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------- read-only views of the data (run with the caller's rights: RLS applies)
create or replace function public.leaderboard(p_day date default null) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare d date := coalesce(p_day, (public.app_now() at time zone 'America/New_York')::date); y date := d - 1;
begin
  return jsonb_build_object(
    'day', d,
    'winners', coalesce((select jsonb_agg(x) from (select p.username, p.id, s.net from public.daily_stats s join public.profiles p on p.id = s.user_id
                 where s.day = d and s.net > 0 order by s.net desc, p.username limit 10) x), '[]'::jsonb),
    'losers', coalesce((select jsonb_agg(x) from (select p.username, p.id, s.net from public.daily_stats s join public.profiles p on p.id = s.user_id
                 where s.day = d and s.net < 0 order by s.net asc, p.username limit 10) x), '[]'::jsonb),
    'players', (select count(*) from public.daily_stats s where s.day = d and (s.net <> 0 or s.actions > 0)),
    'yesterday', jsonb_build_object('day', y, 'final', exists (select 1 from public.finalized_days f where f.day = y),
       'badges', coalesce((select jsonb_agg(x) from (select b.kind, b.sport, b.detail, p.username, p.id from public.badges b join public.profiles p on p.id = b.user_id
                 where b.day = y and b.kind <> 'hot' order by b.kind, b.sport) x), '[]'::jsonb)),
    'recent', coalesce((select jsonb_agg(x order by x.day desc) from (select b.day, b.kind, p.username, p.id, b.detail from public.badges b join public.profiles p on p.id = b.user_id
                 where b.kind in ('champion', 'trash') and b.day >= d - 8 order by b.day desc) x), '[]'::jsonb),
    'alltime', coalesce((select jsonb_agg(x) from (select p.username, p.id,
                 count(*) filter (where b.kind = 'champion') champion, count(*) filter (where b.kind = 'trash') trash,
                 count(*) filter (where b.kind = 'active') active, count(*) filter (where b.kind = 'convo') convo,
                 count(*) filter (where b.kind = 'king') king, count(*) filter (where b.kind = 'hot') hot, count(*) total
                 from public.badges b join public.profiles p on p.id = b.user_id group by p.id, p.username
                 order by count(*) filter (where b.kind = 'champion') desc, count(*) desc, p.username limit 25) x), '[]'::jsonb));
end $$;

create or replace function public.get_profile(p_username text default null, p_id uuid default null) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare pr public.profiles; d date := (public.app_now() at time zone 'America/New_York')::date;
begin
  if p_id is not null then select * into pr from public.profiles where id = p_id;
  else select * into pr from public.profiles where lower(username) = lower(p_username); end if;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', pr.id, 'username', pr.username, 'joined', pr.created_at, 'balance', pr.balance, 'streak', pr.streak,
    'today_net', coalesce((select net from public.daily_stats where user_id = pr.id and day = d), 0),
    'alltime_net', coalesce((select sum(net) from public.daily_stats where user_id = pr.id), 0),
    'badges', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from public.badges where user_id = pr.id group by kind) x), '{}'::jsonb),
    'badge_list', coalesce((select jsonb_agg(x) from (select kind, day, sport, detail from public.badges where user_id = pr.id order by day desc, id desc limit 40) x), '[]'::jsonb),
    'battle', coalesce((select jsonb_object_agg(sport, jsonb_build_object('elo', elo, 'w', w, 'l', l, 't', t, 'rated', rated)) from public.battle_stats where user_id = pr.id), '{}'::jsonb),
    'battles', coalesce((select jsonb_agg(x) from (select b.id, b.sport, b.home, b.away, b.wager, b.status, b.winner, b.result, b.settled_at,
                 case when b.creator = pr.id then b.creator_side else b.opponent_side end as side,
                 (select username from public.profiles o where o.id = case when b.creator = pr.id then b.opponent else b.creator end) as vs
               from public.battles b where (b.creator = pr.id or b.opponent = pr.id) and b.status in ('final', 'live', 'building', 'open')
               order by b.id desc limit 10) x), '[]'::jsonb),
    'slips', jsonb_build_object(
       'won', (select count(*) from public.bets where user_id = pr.id and status = 'won'),
       'lost', (select count(*) from public.bets where user_id = pr.id and status = 'lost'),
       'pending', (select count(*) from public.bets where user_id = pr.id and status = 'pending'),
       'recent', coalesce((select jsonb_agg(x) from (select b.id, b.stake, b.status, b.payout, b.placed_at, b.mode,
                   (select jsonb_agg(jsonb_build_object('label', l.label, 'price', l.price, 'res', l.res) order by l.id) from public.bet_legs l where l.bet_id = b.id) legs
                 from public.bets b where b.user_id = pr.id order by b.id desc limit 8) x), '[]'::jsonb)));
end $$;

-- =====================================================================================================================
--  BATTLES: two players, one simulated game (NFL / NBA / MLB) built from the latest team ratings and player averages.
--  The whole game is computed by the database when both parlays are locked; each play becomes visible at its own time
--  over about 3 minutes, and row level security hides plays that are still in the future (no spoilers through the API).
-- =====================================================================================================================
create or replace function ls_private.sport_sd(p_sport text, which text) returns double precision language sql immutable as $$
  -- spread of the simulated final margin / total (measured on thousands of simulated games, see TEST_REPORT.md)
  select case p_sport when 'nfl' then case which when 'm' then 14.5 else 14.6 end
                      when 'nba' then case which when 'm' then 13.0 else 18.0 end
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
  lo := case p_sport when 'nfl' then 10 when 'nba' then 92 else 2.6 end;
  hi := case p_sport when 'nfl' then 38 when 'nba' then 136 else 7.5 end;
  return array[least(greatest(eh, lo), hi), least(greatest(ea, lo), hi), th.lg_avg];
end $$;

create or replace function ls_private.prop_entry(p_pid text, p_name text, p_side text, p_abbr text, p_stat text, p_label text, p_mean double precision, p_dist text, p_sd double precision, p_line numeric default null)
returns jsonb language plpgsql immutable as $$
declare line numeric; po double precision;
begin
  if p_mean is null or p_mean <= 0 then return null; end if;
  if p_line is not null then line := p_line;
  elsif p_dist = 'pois' and p_stat = 'hits' then line := case when p_mean < 1.25 then 0.5 else 1.5 end;
  elsif p_dist = 'pois' and p_stat = 'tb' then line := 1.5;
  else line := floor(p_mean) + 0.5; end if;
  if p_dist = 'pois' then po := ls_private.pois_ge(floor(line)::int + 1, p_mean);
  else po := 1 - ls_private.phi((line - p_mean) / greatest(p_sd, 0.5)); end if;
  po := least(greatest(po, 0.04), 0.96);
  return jsonb_build_object('pid', p_pid, 'name', p_name, 'side', p_side, 'abbr', p_abbr, 'stat', p_stat, 'label', p_label,
    'line', line, 'mean', round(p_mean::numeric, 2), 'sd', round(p_sd::numeric, 2), 'dist', p_dist,
    'over', ls_private.est_price(po::numeric), 'under', ls_private.est_price((1 - po)::numeric));
end $$;

-- lines and key players for a battle game: fair-ish lines from the ratings + a small hold (the page's 4.5%)
create or replace function public.battle_markets(p_sport text, p_home text, p_away text) returns jsonb
language plpgsql stable security definer set search_path = public, ls_private, pg_temp as $$
declare e double precision[]; eh double precision; ea double precision; lg double precision; sdm double precision; sdt double precision; x double precision;
  ph double precision; lh numeric; pc double precision; tl numeric; po double precision; players jsonb := '[]'::jsonb; props jsonb := '[]'::jsonb;
  side text; ab text; fac double precision; r record; pe jsonb; th public.sim_teams; ta public.sim_teams; simh double precision; sima double precision;
begin
  if p_sport not in ('nfl', 'nba', 'mlb') then raise exception 'Battles are NFL, NBA or MLB'; end if;
  e := ls_private.exp_points(p_sport, p_home, p_away); eh := e[1]; ea := e[2]; lg := e[3]; simh := eh; sima := ea;
  if p_sport = 'nba' then   -- the NBA sim eases off in blowouts, which shrinks expected margins to about 2/3: price what the sim really does
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
  foreach side in array array['away', 'home'] loop
    ab := case side when 'home' then p_home else p_away end;
    fac := (case side when 'home' then eh else ea end) / lg;
    for r in select * from public.sim_players where sport = p_sport and team = ab order by role, rk loop
      if p_sport = 'nfl' then
        if r.role = 'QB' and r.rk = 1 then pe := ls_private.prop_entry(r.pid, r.name, side, ab, 'passYds', 'Pass yds', (r.stats ->> 'py')::float * (0.75 + 0.25 * fac), 'norm', (r.stats ->> 'py')::float * 0.27);
        elsif r.role = 'RB' and r.rk = 1 then pe := ls_private.prop_entry(r.pid, r.name, side, ab, 'rushYds', 'Rush yds', (r.stats ->> 'ry')::float * (0.8 + 0.2 * fac), 'norm', greatest((r.stats ->> 'ry')::float * 0.45, 12));
        elsif r.role = 'WR' and r.rk = 1 then pe := ls_private.prop_entry(r.pid, r.name, side, ab, 'recYds', 'Rec yds', (r.stats ->> 'ly')::float * (0.8 + 0.2 * fac), 'norm', greatest((r.stats ->> 'ly')::float * 0.5, 12));
        elsif r.role = 'WR' and r.rk = 2 then pe := ls_private.prop_entry(r.pid, r.name, side, ab, 'rec', 'Receptions', (r.stats ->> 'rec')::float * (0.85 + 0.15 * fac), 'pois', 0);
        else continue; end if;
      elsif p_sport = 'nba' then
        if r.role <> 'P' or r.rk > 3 then continue; end if;
        if r.rk = 3 and coalesce((r.stats ->> 'reb')::float, 0) >= 5 then
          pe := ls_private.prop_entry(r.pid, r.name, side, ab, 'reb', 'Rebounds', (r.stats ->> 'reb')::float, 'pois', 0);
        else
          pe := ls_private.prop_entry(r.pid, r.name, side, ab, 'pts', 'Points', (r.stats ->> 'pts')::float * fac, 'norm', sqrt(greatest((r.stats ->> 'pts')::float * fac, 1)) * 1.55);
        end if;
      else
        if r.role = 'H' and r.rk = 1 then pe := ls_private.prop_entry(r.pid, r.name, side, ab, 'hits', 'Hits', (r.stats ->> 'h')::float * power(fac, 0.3), 'pois', 0);
        elsif r.role = 'H' and r.rk = 2 then pe := ls_private.prop_entry(r.pid, r.name, side, ab, 'tb', 'Total bases', (r.stats ->> 'tb')::float * power(fac, 0.3), 'pois', 0);
        elsif r.role = 'SP' and r.rk = 1 then pe := ls_private.prop_entry(r.pid, r.name, side, ab, 'k', 'Strikeouts', (r.stats ->> 'k')::float, 'pois', 0);
        else pe := null; end if;
      end if;
      -- every key player the sim needs (also those without a prop) goes into "players"
      if (p_sport = 'nfl' and ((r.role in ('QB', 'RB') and r.rk = 1) or (r.role = 'WR' and r.rk <= 2)))
         or (p_sport = 'nba' and r.role = 'P' and r.rk <= 4)
         or (p_sport = 'mlb' and ((r.role = 'H' and r.rk <= 3) or (r.role = 'SP' and r.rk = 1))) then
        players := players || jsonb_build_array(jsonb_build_object('pid', r.pid, 'name', r.name, 'side', side, 'abbr', ab, 'role', r.role, 'rk', r.rk, 'pos', r.pos, 'stats', r.stats));
      end if;
      if pe is not null then props := props || jsonb_build_array(pe); end if;
    end loop;
  end loop;
  return jsonb_build_object('sport', p_sport, 'home', p_home, 'away', p_away,
    'homeName', th.name, 'awayName', ta.name, 'homeColor', th.color, 'awayColor', ta.color,
    'eh', round(eh::numeric, 2), 'ea', round(ea::numeric, 2), 'simh', round(simh::numeric, 3), 'sima', round(sima::numeric, 3), 'lgavg', round(lg::numeric, 2), 'sdm', sdm, 'sdt', sdt, 'pHome', round(ph::numeric, 3), 'notional', 100,
    'ml', jsonb_build_object('home', ls_private.est_price(ph::numeric), 'away', ls_private.est_price((1 - ph)::numeric)),
    'spr', jsonb_build_object('homeLine', lh, 'awayLine', -lh, 'home', ls_private.est_price(pc::numeric), 'away', ls_private.est_price((1 - pc)::numeric)),
    'tot', jsonb_build_object('line', tl, 'over', ls_private.est_price(po::numeric), 'under', ls_private.est_price((1 - po)::numeric)),
    'players', players, 'props', props);
end $$;

-- battle market token -> {tok, label, price, grp}.  ml:home, spr:away, tot:over, p:<pid>:<stat>:over|under, win:creator|opponent (spectators)
create or replace function ls_private.battle_leg(mk jsonb, tok text, allow_win boolean default false) returns jsonb language plpgsql immutable as $$
declare p text[] := string_to_array(coalesce(tok, ''), ':'); pr jsonb;
begin
  if p[1] = 'ml' and p[2] in ('home', 'away') then
    return jsonb_build_object('tok', tok, 'grp', 'ml', 'price', (mk -> 'ml' ->> p[2])::int, 'label', (mk ->> p[2]) || ' to win');
  elsif p[1] = 'spr' and p[2] in ('home', 'away') then
    return jsonb_build_object('tok', tok, 'grp', 'spr', 'price', (mk -> 'spr' ->> p[2])::int,
      'label', (mk ->> p[2]) || ' ' || ls_private.sg((mk -> 'spr' ->> (p[2] || 'Line'))::numeric));
  elsif p[1] = 'tot' and p[2] in ('over', 'under') then
    return jsonb_build_object('tok', tok, 'grp', 'tot', 'price', (mk -> 'tot' ->> p[2])::int, 'label', initcap(p[2]) || ' ' || ls_private.num_txt((mk -> 'tot' ->> 'line')::numeric));
  elsif p[1] = 'p' and p[4] in ('over', 'under') then
    select x into pr from jsonb_array_elements(mk -> 'props') x where x ->> 'pid' = p[2] and x ->> 'stat' = p[3] limit 1;
    if pr is null then return null; end if;
    return jsonb_build_object('tok', tok, 'grp', 'p:' || p[2] || ':' || p[3], 'price', (pr ->> p[4])::int,
      'label', ls_private.surname(pr ->> 'name') || ' ' || initcap(p[4]) || ' ' || ls_private.num_txt((pr ->> 'line')::numeric) || ' ' || lower(pr ->> 'label'));
  elsif allow_win and p[1] = 'win' and p[2] in ('creator', 'opponent') and mk ? 'winner' then
    return jsonb_build_object('tok', tok, 'grp', 'win', 'price', (mk -> 'winner' ->> p[2])::int, 'label', (mk -> 'winner' ->> (p[2] || 'Name')) || ' wins the battle');
  end if;
  return null;
end $$;

create or replace function ls_private.grade_battle_leg(mk jsonb, tok text, hs int, as_ int, players jsonb) returns text language plpgsql immutable as $$
declare p text[] := string_to_array(tok, ':'); m int := hs - as_; v numeric; t int := hs + as_; pr jsonb; x numeric; ln numeric;
begin
  if p[1] = 'ml' then if m = 0 then return 'V'; end if; return case when (p[2] = 'home') = (m > 0) then 'W' else 'L' end; end if;
  if p[1] = 'spr' then v := (case when p[2] = 'home' then m else -m end) + (mk -> 'spr' ->> (p[2] || 'Line'))::numeric;
    if v = 0 then return 'V'; end if; return case when v > 0 then 'W' else 'L' end; end if;
  if p[1] = 'tot' then ln := (mk -> 'tot' ->> 'line')::numeric; if t = ln then return 'V'; end if;
    return case when (p[2] = 'over') = (t > ln) then 'W' else 'L' end; end if;
  if p[1] = 'p' then
    select y into pr from jsonb_array_elements(mk -> 'props') y where y ->> 'pid' = p[2] and y ->> 'stat' = p[3] limit 1;
    if pr is null then return 'V'; end if;
    x := coalesce((players -> p[2] ->> p[3])::numeric, 0); ln := (pr ->> 'line')::numeric;
    if x = ln then return 'V'; end if;
    return case when (p[4] = 'over') = (x > ln) then 'W' else 'L' end;
  end if;
  return 'V';
end $$;

-- ---------------------------------------------------------------- simulators.  Each returns
--   {hs, as, players:{pid:{stat:value}}, ev:[{t, kind, text, hs, as, clock}], inc:[{t, pid, stat, d}]}
-- t is the share of regulation played (overtime / extra innings go past 1); the caller spreads t over ~3 minutes.
create or replace function ls_private.pl_of(mk jsonb, side text, role text, rk int) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(mk -> 'players') x where x ->> 'side' = side and x ->> 'role' = role and (x ->> 'rk')::int = rk limit 1
$$;
create or replace function ls_private.short_name(pl jsonb, fallback text) returns text language sql immutable as $$
  select coalesce(ls_private.surname(pl ->> 'name'), fallback)
$$;
create or replace function ls_private.prop_mean(mk jsonb, pid text, stat text) returns double precision language sql immutable as $$
  select (x ->> 'mean')::float from jsonb_array_elements(mk -> 'props') x where x ->> 'pid' = pid and x ->> 'stat' = stat limit 1
$$;
create or replace function ls_private.prop_sd(mk jsonb, pid text, stat text) returns double precision language sql immutable as $$
  select (x ->> 'sd')::float from jsonb_array_elements(mk -> 'props') x where x ->> 'pid' = pid and x ->> 'stat' = stat limit 1
$$;
create or replace function ls_private.ordinal(n int) returns text language sql immutable as $$
  select n || case when n % 100 between 11 and 13 then 'th' when n % 10 = 1 then 'st' when n % 10 = 2 then 'nd' when n % 10 = 3 then 'rd' else 'th' end
$$;

-- ----- NFL: drive model.  ~11-13 drives a team; each drive scores a TD / FG / nothing with chances set by the team's expected points
create or replace function ls_private.sim_nfl(mk jsonb) returns jsonb language plpgsql volatile as $$
declare eh float := coalesce(mk ->> 'simh', mk ->> 'eh')::float; ea float := coalesce(mk ->> 'sima', mk ->> 'ea')::float; hab text := mk ->> 'home'; aab text := mk ->> 'away';
  nd int := 11 + floor(random() * 3)::int; gfh float := exp(0.12 * ls_private.gauss()); gfa float := exp(0.12 * ls_private.gauss());
  hs int := 0; as_ int := 0; i int; k int; side text; ab text; oab text; t float; epd float; ptd float; pfg float; r float; pts int; d int;
  txt text; q int; secs int; clk text; qb jsonb; rb jsonb; w1 jsonb; w2 jsonb; who text; rcv text; ptd_h int := 0; ptd_a int := 0;
  ev jsonb := '[]'::jsonb; inc jsonb := '[]'::jsonb; players jsonb := '{}'::jsonb; pr jsonb; v float; fac float; qbv jsonb; n int; tt float;
  qbyds jsonb := '{}'::jsonb; st text; first_side text := case when random() < 0.5 then 'home' else 'away' end;
begin
  ev := ev || jsonb_build_array(jsonb_build_object('t', 0, 'kind', 'start', 'text', 'Kickoff: ' || aab || ' at ' || hab, 'hs', 0, 'as', 0, 'clock', 'Q1 15:00'));
  for i in 0 .. 2 * nd - 1 loop
    side := case when (i % 2 = 0) = (first_side = 'away') then 'away' else 'home' end;
    ab := case side when 'home' then hab else aab end; oab := case side when 'home' then aab else hab end;
    t := (i + 0.15 + 0.7 * random()) / (2 * nd);
    q := least(4, floor(t * 4)::int + 1); secs := greatest(0, round((1 - (t * 4 - (q - 1))) * 900)::int);
    clk := 'Q' || q || ' ' || (secs / 60) || ':' || lpad((secs % 60)::text, 2, '0');
    epd := case side when 'home' then eh * gfh else ea * gfa end / nd;
    ptd := least(0.65, epd * 0.78 / 7.0); pfg := least(0.45, epd * 0.22 / 3.0);
    qb := ls_private.pl_of(mk, side, 'QB', 1); rb := ls_private.pl_of(mk, side, 'RB', 1); w1 := ls_private.pl_of(mk, side, 'WR', 1); w2 := ls_private.pl_of(mk, side, 'WR', 2);
    r := random();
    if r < ptd then
      r := random(); pts := case when r < 0.92 then 7 when r < 0.97 then 6 else 8 end;
      d := 1 + floor(power(random(), 2) * 64)::int;
      if random() < 0.6 then
        r := random();
        rcv := case when r < 0.42 then ls_private.short_name(w1, null) when r < 0.68 then ls_private.short_name(w2, null) else null end;
        txt := ab || ' touchdown! ' || ls_private.short_name(qb, ab || '''s QB') || ' ' || d || '-yd pass' || coalesce(' to ' || rcv, '');
        if side = 'home' then ptd_h := ptd_h + 1; else ptd_a := ptd_a + 1; end if;
        if qb is not null then inc := inc || jsonb_build_array(jsonb_build_object('t', t, 'pid', qb ->> 'pid', 'stat', 'passTD', 'd', 1)); end if;
      else
        r := random();
        who := case when r < 0.55 then ls_private.short_name(rb, null) when r < 0.67 then ls_private.short_name(qb, null) else null end;
        txt := ab || ' touchdown! ' || coalesce(who || ' ', '') || least(d, 40) || '-yd run';
      end if;
      if pts = 6 then txt := txt || ' (extra point missed)'; elsif pts = 8 then txt := txt || ' (two-point try good)'; end if;
      if side = 'home' then hs := hs + pts; else as_ := as_ + pts; end if;
      ev := ev || jsonb_build_array(jsonb_build_object('t', t, 'kind', 'score', 'side', side, 'text', txt, 'hs', hs, 'as', as_, 'clock', clk));
    elsif r < ptd + pfg then
      if side = 'home' then hs := hs + 3; else as_ := as_ + 3; end if;
      ev := ev || jsonb_build_array(jsonb_build_object('t', t, 'kind', 'score', 'side', side, 'text', ab || ' field goal from ' || (22 + floor(random() * 33)::int) || ' yards', 'hs', hs, 'as', as_, 'clock', clk));
    elsif random() < 0.5 then
      r := random();
      txt := case when r < 0.55 then ab || ' punts after a stalled drive'
                  when r < 0.72 then 'Interception! ' || oab || ' picks off ' || ls_private.short_name(qb, ab || '''s QB')
                  when r < 0.84 then 'Fumble! ' || oab || ' recovers'
                  when r < 0.93 then ab || ' stopped on fourth down'
                  else ab || ' misses a ' || (44 + floor(random() * 12)::int) || '-yard field goal' end;
      ev := ev || jsonb_build_array(jsonb_build_object('t', t, 'kind', 'play', 'side', side, 'text', txt, 'hs', hs, 'as', as_, 'clock', clk));
    end if;
  end loop;
  -- quarter marks (scores at that moment are filled in below when the events are sorted)
  foreach tt in array array[0.25, 0.5, 0.75]::float[] loop
    ev := ev || jsonb_build_array(jsonb_build_object('t', tt, 'kind', 'period', 'text', case when tt = 0.5 then 'Halftime' else 'End of Q' || round(tt * 4) end, 'hs', -1, 'as', -1, 'clock', case when tt = 0.5 then 'Half' else 'End Q' || round(tt * 4) end));
  end loop;
  -- overtime: first score wins (simplified)
  if hs = as_ then
    ev := ev || jsonb_build_array(jsonb_build_object('t', 1.0, 'kind', 'period', 'text', 'Tied after four quarters: overtime', 'hs', hs, 'as', as_, 'clock', 'OT'));
    for k in 0 .. 5 loop
      side := case when (k % 2 = 0) = (random() < 0.5) then 'home' else 'away' end;
      ab := case side when 'home' then hab else aab end;
      t := 1.0 + (k + 0.5) * 0.04;
      epd := case side when 'home' then eh * gfh else ea * gfa end / nd;
      r := random();
      if r < least(0.65, epd * 0.78 / 7.0) then
        if side = 'home' then hs := hs + 6; else as_ := as_ + 6; end if;
        ev := ev || jsonb_build_array(jsonb_build_object('t', t, 'kind', 'score', 'side', side, 'text', ab || ' wins it with an overtime touchdown!', 'hs', hs, 'as', as_, 'clock', 'OT'));
        exit;
      elsif r < least(0.65, epd * 0.78 / 7.0) + least(0.45, epd * 0.22 / 3.0) * 1.2 then
        if side = 'home' then hs := hs + 3; else as_ := as_ + 3; end if;
        ev := ev || jsonb_build_array(jsonb_build_object('t', t, 'kind', 'score', 'side', side, 'text', ab || ' wins it with an overtime field goal!', 'hs', hs, 'as', as_, 'clock', 'OT'));
        exit;
      end if;
    end loop;
  end if;
  -- player lines, consistent with how the team scored
  for pr in select x from jsonb_array_elements(mk -> 'props') x loop
    side := pr ->> 'side';
    fac := least(greatest(((case side when 'home' then hs else as_ end) + 3.0) / ((case side when 'home' then eh else ea end) + 3.0), 0.5), 1.7);
    st := pr ->> 'stat';
    if st = 'rec' then v := ls_private.pois((pr ->> 'mean')::float * (0.85 + 0.15 * fac));
    else
      v := (pr ->> 'mean')::float * (0.8 + 0.2 * fac) + (pr ->> 'sd')::float * ls_private.gauss();
      v := round(greatest(v, case when st = 'rushYds' then -4 else 0 end));
    end if;
    players := jsonb_set(players, array[pr ->> 'pid'], coalesce(players -> (pr ->> 'pid'), '{}'::jsonb) || jsonb_build_object(st, v));
  end loop;
  -- a QB throws at least what his top receivers caught
  foreach side in array array['home', 'away'] loop
    qb := ls_private.pl_of(mk, side, 'QB', 1); w1 := ls_private.pl_of(mk, side, 'WR', 1);
    if qb is not null and w1 is not null and players -> (qb ->> 'pid') ? 'passYds' and players -> (w1 ->> 'pid') ? 'recYds' then
      if (players -> (w1 ->> 'pid') ->> 'recYds')::float > 0.75 * (players -> (qb ->> 'pid') ->> 'passYds')::float then
        players := jsonb_set(players, array[qb ->> 'pid', 'passYds'], to_jsonb(round((players -> (w1 ->> 'pid') ->> 'recYds')::numeric / 0.6)));
      end if;
    end if;
    if qb is not null then
      players := jsonb_set(players, array[qb ->> 'pid'], coalesce(players -> (qb ->> 'pid'), '{}'::jsonb) || jsonb_build_object('passTD', case side when 'home' then ptd_h else ptd_a end));
    end if;
  end loop;
  -- spread yardage/catches over the game (cumulative lines in the play feed never run ahead of the clock)
  for pr in select x from jsonb_array_elements(mk -> 'props') x loop
    v := coalesce((players -> (pr ->> 'pid') ->> (pr ->> 'stat'))::float, 0);
    if v = 0 then continue; end if;
    n := least(greatest(case when pr ->> 'stat' = 'rec' then v::int else round(abs(v) / 18)::int + 1 end, 1), 12);
    for k in 1 .. n loop
      inc := inc || jsonb_build_array(jsonb_build_object('t', 0.02 + 0.96 * random(), 'pid', pr ->> 'pid', 'stat', pr ->> 'stat',
        'd', case when k < n then round(v / n) else v - round(v / n) * (n - 1) end));
    end loop;
  end loop;
  return jsonb_build_object('hs', hs, 'as', as_, 'players', players, 'ev', ev, 'inc', inc);
end $$;

-- ----- NBA: possession model (about 100 possessions a team), shots by key players by their scoring share
create or replace function ls_private.sim_nba(mk jsonb) returns jsonb language plpgsql volatile as $$
declare eh float := coalesce(mk ->> 'simh', mk ->> 'eh')::float; ea float := coalesce(mk ->> 'sima', mk ->> 'ea')::float; hab text := mk ->> 'home'; aab text := mk ->> 'away';
  pace int := 96 + floor(random() * 7)::int; gfh float := exp(0.045 * ls_private.gauss()); gfa float := exp(0.045 * ls_private.gauss());
  hs int := 0; as_ int := 0; q int; j int; npos int; side text; ab text; t float; s float; p3 float; p2 float; pf float; r float; pts int;
  pid text; nm text; w float; acc float; ev jsonb := '[]'::jsonb; inc jsonb := '[]'::jsonb; players jsonb := '{}'::jsonb; pl jsonb; pr jsonb;
  ot int := 0; per_end float; nper float; half int; secs int; clk text; v int; k int; mark float; next_mark float; lead int;
begin
  ev := ev || jsonb_build_array(jsonb_build_object('t', 0, 'kind', 'start', 'text', 'Tip-off: ' || aab || ' at ' || hab, 'hs', 0, 'as', 0, 'clock', 'Q1 12:00'));
  q := 1;
  loop
    if q <= 4 then npos := round(pace / 4.0)::int; nper := 0.25; else npos := round(pace / 9.6)::int; nper := 0.25 * 5 / 12; end if;
    next_mark := 0.5;
    for j in 0 .. 2 * npos - 1 loop
      side := case when j % 2 = (q % 2) then 'home' else 'away' end;
      ab := case side when 'home' then hab else aab end;
      if q <= 4 then t := ((q - 1) + (j + random()) / (2 * npos)) / 4.0;
      else t := 1.0 + (q - 5) * nper + (j + random()) / (2 * npos) * nper; end if;
      s := (case side when 'home' then eh * gfh else ea * gfa end) / pace / 1.1754;
      -- blowouts: the side that leads big eases off (bench minutes), which keeps final margins realistic
      lead := case side when 'home' then hs - as_ else as_ - hs end;
      if abs(lead) > 6 then s := s * (1 - sign(lead) * least(0.12, 0.006 * (abs(lead) - 6))); end if;
      p3 := 0.125 * s; p2 := 0.33 * s; pf := 0.09 * s;
      r := random();
      if r < p3 then pts := 3; elsif r < p3 + p2 then pts := 2;
      elsif r < p3 + p2 + pf then pts := (random() < 0.78)::int + (random() < 0.78)::int; else pts := 0; end if;
      if pts > 0 then
        if side = 'home' then hs := hs + pts; else as_ := as_ + pts; end if;
        -- who scored: key players by their share of the team's expected points
        r := random(); acc := 0; pid := null; nm := null;
        for pl in select x from jsonb_array_elements(mk -> 'players') x where x ->> 'side' = side order by (x ->> 'rk')::int loop
          w := coalesce((pl -> 'stats' ->> 'pts')::float, 0) / (mk ->> 'lgavg')::float;   -- E[player pts] = avg * team pts / league avg
          acc := acc + w;
          if r < acc then pid := pl ->> 'pid'; nm := ls_private.surname(pl ->> 'name'); exit; end if;
        end loop;
        if pid is not null then
          inc := inc || jsonb_build_array(jsonb_build_object('t', t, 'pid', pid, 'stat', 'pts', 'd', pts));
          if pts = 3 then inc := inc || jsonb_build_array(jsonb_build_object('t', t, 'pid', pid, 'stat', 'fg3', 'd', 1)); end if;
          if pts = 3 or random() < 0.25 then
            secs := greatest(0, round((1 - ((t - case when q <= 4 then (q - 1) * 0.25 else 1.0 + (q - 5) * nper end) / nper)) * (case when q <= 4 then 720 else 300 end))::int);
            clk := case when q <= 4 then 'Q' || q else 'OT' || (q - 4) end || ' ' || (secs / 60) || ':' || lpad((secs % 60)::text, 2, '0');
            ev := ev || jsonb_build_array(jsonb_build_object('t', t, 'kind', 'score', 'side', side,
              'text', nm || case pts when 3 then ' drains a three' when 2 then case when random() < 0.3 then ' throws it down' else ' scores inside' end else ' at the line, ' || pts || ' of 2' end,
              'hs', hs, 'as', as_, 'clock', clk));
          end if;
        end if;
      end if;
      -- mid-period score check
      if (j + 1)::float / (2 * npos) >= next_mark and next_mark < 1 then
        clk := case when q <= 4 then 'Q' || q || ' 6:00' else 'OT' || (q - 4) || ' 2:30' end;
        ev := ev || jsonb_build_array(jsonb_build_object('t', t + 0.0001, 'kind', 'snap', 'text', aab || ' ' || as_ || ', ' || hab || ' ' || hs || ' midway through ' || case when q <= 4 then 'Q' || q else 'overtime' end, 'hs', hs, 'as', as_, 'clock', clk));
        next_mark := 2;
      end if;
    end loop;
    per_end := case when q <= 4 then q * 0.25 else 1.0 + (q - 4) * nper end;
    ev := ev || jsonb_build_array(jsonb_build_object('t', per_end, 'kind', 'period',
      'text', case when q = 2 then 'Halftime' when q < 4 then 'End of Q' || q when q = 4 and hs = as_ then 'Tied after regulation: overtime' when q = 4 then 'End of regulation' else 'End of OT' || (q - 4) end,
      'hs', hs, 'as', as_, 'clock', case when q <= 4 then 'End Q' || q else 'End OT' || (q - 4) end));
    exit when q >= 4 and hs <> as_;
    exit when q >= 10;
    q := q + 1;
  end loop;
  if hs = as_ then hs := hs + 1; end if;   -- never ends tied
  -- final player lines: points from the shots above; rebounds/assists drawn around their averages (pace-scaled)
  for pl in select x from jsonb_array_elements(mk -> 'players') x loop
    pid := pl ->> 'pid';
    v := coalesce((select sum((i ->> 'd')::int) from jsonb_array_elements(inc) i where i ->> 'pid' = pid and i ->> 'stat' = 'pts'), 0);
    players := jsonb_set(players, array[pid], jsonb_build_object('pts', v,
      'fg3', coalesce((select sum((i ->> 'd')::int) from jsonb_array_elements(inc) i where i ->> 'pid' = pid and i ->> 'stat' = 'fg3'), 0)));
    foreach nm in array array['reb', 'ast'] loop
      v := ls_private.pois(coalesce((pl -> 'stats' ->> nm)::float, 0) * pace / 99.0);
      players := jsonb_set(players, array[pid, nm], to_jsonb(v));
      for k in 1 .. v loop inc := inc || jsonb_build_array(jsonb_build_object('t', 0.01 + 0.98 * random(), 'pid', pid, 'stat', nm, 'd', 1)); end loop;
    end loop;
  end loop;
  return jsonb_build_object('hs', hs, 'as', as_, 'players', players, 'ev', ev, 'inc', inc);
end $$;

-- ----- MLB: plate-appearance model with base running, starting pitchers and extra innings (runner on second)
create or replace function ls_private.sim_mlb(mk jsonb) returns jsonb language plpgsql volatile as $$
declare eh float := coalesce(mk ->> 'simh', mk ->> 'eh')::float; ea float := coalesce(mk ->> 'sima', mk ->> 'ea')::float; hab text := mk ->> 'home'; aab text := mk ->> 'away';
  gfh float := exp(0.1 * ls_private.gauss()); gfa float := exp(0.1 * ls_private.gauss());
  hs int := 0; as_ int := 0; inn int := 1; half int; side text; dside text; ab text; outs int; b1 text; b2 text; b3 text;
  idx_h int := 0; idx_a int := 0; idx int; bat jsonb; bid text; bnm text; f float; pk float; pbb float; p1 float; p2 float; p3 float; phr float; hr float; ph float; bbar float;
  r float; res text; runs int; rbi int; t float; ev jsonb := '[]'::jsonb; inc jsonb := '[]'::jsonb; players jsonb := '{}'::jsonb;
  sp_h jsonb; sp_a jsonb; sp jsonb; sp_in_h boolean := true; sp_in_a boolean := true; sp_outs_h int := 0; sp_outs_a int := 0; tgt_h int; tgt_a int;
  sp_k_h int := 0; sp_k_a int := 0; spk float; spin boolean; txt text; scorers text[]; s text; done boolean := false; clk text; lineup_h jsonb; lineup_a jsonb; lu jsonb;
  k int; pl jsonb; v int; hitword text;
begin
  sp_h := ls_private.pl_of(mk, 'home', 'SP', 1); sp_a := ls_private.pl_of(mk, 'away', 'SP', 1);
  tgt_h := least(greatest(round(coalesce((sp_h -> 'stats' ->> 'outs')::float, 15) + 3 * ls_private.gauss())::int, 6), 27);
  tgt_a := least(greatest(round(coalesce((sp_a -> 'stats' ->> 'outs')::float, 15) + 3 * ls_private.gauss())::int, 6), 27);
  -- lineups: key hitters bat 2nd, 3rd and 4th
  lineup_h := jsonb_build_array(null, ls_private.pl_of(mk, 'home', 'H', 1), ls_private.pl_of(mk, 'home', 'H', 2), ls_private.pl_of(mk, 'home', 'H', 3), null, null, null, null, null);
  lineup_a := jsonb_build_array(null, ls_private.pl_of(mk, 'away', 'H', 1), ls_private.pl_of(mk, 'away', 'H', 2), ls_private.pl_of(mk, 'away', 'H', 3), null, null, null, null, null);
  ev := ev || jsonb_build_array(jsonb_build_object('t', 0, 'kind', 'start', 'text', 'First pitch: ' || aab || ' at ' || hab, 'hs', 0, 'as', 0, 'clock', 'Top 1st'));
  while not done loop
    for half in 0 .. 1 loop
      if half = 1 and inn >= 9 and hs > as_ then done := true; exit; end if;
      side := case half when 0 then 'away' else 'home' end; dside := case half when 0 then 'home' else 'away' end;
      ab := case side when 'home' then hab else aab end;
      f := (case side when 'home' then eh * gfh else ea * gfa end) / 4.45;
      lu := case side when 'home' then lineup_h else lineup_a end;
      outs := 0; b1 := null; b2 := null; b3 := null;
      if inn >= 10 then b2 := '-'; end if;
      clk := case half when 0 then 'Top ' else 'Bot ' end || ls_private.ordinal(inn);
      while outs < 3 loop
        idx := case side when 'home' then idx_h else idx_a end;
        if side = 'home' then idx_h := (idx_h + 1) % 9; else idx_a := (idx_a + 1) % 9; end if;
        bat := lu -> idx; if jsonb_typeof(bat) = 'null' then bat := null; end if;
        bid := coalesce(bat ->> 'pid', '-'); bnm := ls_private.short_name(bat, null);
        sp := case dside when 'home' then sp_h else sp_a end;
        spin := case dside when 'home' then sp_in_h else sp_in_a end and sp is not null;
        pk := case when spin then least(greatest(coalesce((sp -> 'stats' ->> 'k')::float, 5) / (coalesce((sp -> 'stats' ->> 'outs')::float, 16) * 1.33), 0.12), 0.40) else 0.232 end;
        pbb := 0.085 * power(f, 0.6);
        if bat is not null and coalesce((bat -> 'stats' ->> 'h')::float, 0) > 0 then
          ph := (bat -> 'stats' ->> 'h')::float / 4.4 * power(f, 0.3);
          hr := least(coalesce((bat -> 'stats' ->> 'hr')::float, 0) / (bat -> 'stats' ->> 'h')::float, 0.5);
          bbar := coalesce((bat -> 'stats' ->> 'tb')::float / (bat -> 'stats' ->> 'h')::float, 1.5);
          ph := 0.6 * ph + 0.4 * 0.237 * power(f, 0.5);   -- blend the hitter's own rate with the team level so team runs match the line
          phr := ph * hr; p3 := ph * 0.015; p2 := ph * least(greatest(bbar - 1 - 0.03 - 3 * hr, 0.08), 0.45); p1 := greatest(ph - phr - p2 - p3, 0);
        else
          p1 := 0.152 * power(f, 0.5); p2 := 0.048 * power(f, 0.5); p3 := 0.004 * power(f, 0.5); phr := 0.033 * power(f, 0.5);
        end if;
        r := random();
        if r < pk then res := 'K'; elsif r < pk + pbb then res := 'BB'; elsif r < pk + pbb + p1 then res := '1B';
        elsif r < pk + pbb + p1 + p2 then res := '2B'; elsif r < pk + pbb + p1 + p2 + p3 then res := '3B';
        elsif r < pk + pbb + p1 + p2 + p3 + phr then res := 'HR'; else res := 'OUT'; end if;
        runs := 0; rbi := 0; scorers := '{}';
        t := ((inn - 1) * 2 + half + outs / 3.0 + 0.15) / 18.0;
        if res in ('K', 'OUT') then
          outs := outs + 1;
          if res = 'OUT' and outs < 3 and b3 is not null and random() < 0.2 then scorers := scorers || b3; b3 := null; runs := 1; rbi := 1; end if;
          if res = 'K' and spin then
            if dside = 'home' then sp_k_h := sp_k_h + 1; else sp_k_a := sp_k_a + 1; end if;
            inc := inc || jsonb_build_array(jsonb_build_object('t', t, 'pid', sp ->> 'pid', 'stat', 'k', 'd', 1));
          end if;
          if spin then
            if dside = 'home' then sp_outs_h := sp_outs_h + 1; if sp_outs_h >= tgt_h then sp_in_h := false;
                ev := ev || jsonb_build_array(jsonb_build_object('t', t + 0.001, 'kind', 'play', 'text', ls_private.short_name(sp, 'The starter') || ' leaves after ' || (sp_outs_h / 3) || '.' || (sp_outs_h % 3) || ' innings, ' || sp_k_h || ' K', 'hs', hs, 'as', as_, 'clock', clk)); end if;
            else sp_outs_a := sp_outs_a + 1; if sp_outs_a >= tgt_a then sp_in_a := false;
                ev := ev || jsonb_build_array(jsonb_build_object('t', t + 0.001, 'kind', 'play', 'text', ls_private.short_name(sp, 'The starter') || ' leaves after ' || (sp_outs_a / 3) || '.' || (sp_outs_a % 3) || ' innings, ' || sp_k_a || ' K', 'hs', hs, 'as', as_, 'clock', clk)); end if;
            end if;
          end if;
        elsif res = 'BB' then
          if b1 is not null then if b2 is not null then if b3 is not null then scorers := scorers || b3; runs := 1; rbi := 1; end if; b3 := b2; end if; b2 := b1; end if;
          b1 := bid;
        elsif res = '1B' then
          if b3 is not null then scorers := scorers || b3; b3 := null; end if;
          if b2 is not null then if random() < 0.62 then scorers := scorers || b2; else b3 := b2; end if; b2 := null; end if;
          if b1 is not null then if b3 is null and random() < 0.28 then b3 := b1; else b2 := b1; end if; end if;
          b1 := bid;
        elsif res = '2B' then
          if b3 is not null then scorers := scorers || b3; b3 := null; end if;
          if b2 is not null then scorers := scorers || b2; b2 := null; end if;
          if b1 is not null then if random() < 0.45 then scorers := scorers || b1; else b3 := b1; end if; b1 := null; end if;
          b2 := bid;
        elsif res = '3B' then
          scorers := scorers || array_remove(array[b3, b2, b1], null); b1 := null; b2 := null; b3 := bid;
        else -- HR
          scorers := scorers || array_remove(array[b3, b2, b1], null) || bid; b1 := null; b2 := null; b3 := null;
        end if;
        if res in ('1B', '2B', '3B', 'HR') then
          runs := coalesce(array_length(scorers, 1), 0); rbi := runs;
          if bid <> '-' then
            inc := inc || jsonb_build_array(jsonb_build_object('t', t, 'pid', bid, 'stat', 'hits', 'd', 1),
                                            jsonb_build_object('t', t, 'pid', bid, 'stat', 'tb', 'd', case res when '1B' then 1 when '2B' then 2 when '3B' then 3 else 4 end));
          end if;
        end if;
        if bid <> '-' and rbi > 0 then inc := inc || jsonb_build_array(jsonb_build_object('t', t, 'pid', bid, 'stat', 'rbi', 'd', rbi)); end if;
        foreach s in array scorers loop
          if s <> '-' then inc := inc || jsonb_build_array(jsonb_build_object('t', t, 'pid', s, 'stat', 'runs', 'd', 1)); end if;
        end loop;
        if runs > 0 then
          if side = 'home' then hs := hs + runs; else as_ := as_ + runs; end if;
          hitword := case res when 'HR' then case runs when 1 then ' homers (solo)' when 4 then ' hits a grand slam!' else ' homers (' || runs || ' runs)' end
                              when '3B' then ' triples' when '2B' then ' doubles' when '1B' then ' singles' when 'BB' then ' walks with the bases loaded' else ' hits a sacrifice fly' end;
          txt := coalesce(bnm, ab || ' batter') || hitword || case when res not in ('HR') and runs > 0 then ', ' || runs || ' run' || case when runs > 1 then 's' else '' end || ' score' || case when runs = 1 then 's' else '' end else '' end;
          ev := ev || jsonb_build_array(jsonb_build_object('t', t, 'kind', 'score', 'side', side, 'text', txt, 'hs', hs, 'as', as_, 'clock', clk));
        elsif bnm is not null and res in ('1B', '2B', '3B') then
          ev := ev || jsonb_build_array(jsonb_build_object('t', t, 'kind', 'play', 'side', side, 'text', bnm || case res when '1B' then ' singles' when '2B' then ' doubles' else ' triples' end, 'hs', hs, 'as', as_, 'clock', clk));
        end if;
        if half = 1 and inn >= 9 and hs > as_ then
          ev := ev || jsonb_build_array(jsonb_build_object('t', t + 0.001, 'kind', 'score', 'side', 'home', 'text', 'Walk-off! ' || hab || ' wins it', 'hs', hs, 'as', as_, 'clock', clk));
          done := true; exit;
        end if;
      end loop;
      exit when done;
    end loop;
    if not done then
      ev := ev || jsonb_build_array(jsonb_build_object('t', (inn * 2) / 18.0, 'kind', 'period', 'text', 'End of the ' || ls_private.ordinal(inn) || ': ' || aab || ' ' || as_ || ', ' || hab || ' ' || hs, 'hs', hs, 'as', as_, 'clock', 'End ' || ls_private.ordinal(inn)));
      if inn >= 9 and hs <> as_ then done := true; end if;
      if inn >= 20 and not done then hs := hs + 1; done := true; end if;
      inn := inn + 1;
    end if;
  end loop;
  for pl in select x from jsonb_array_elements(mk -> 'players') x loop
    players := jsonb_set(players, array[pl ->> 'pid'], jsonb_build_object(
      'hits', coalesce((select sum((i ->> 'd')::int) from jsonb_array_elements(inc) i where i ->> 'pid' = pl ->> 'pid' and i ->> 'stat' = 'hits'), 0),
      'tb', coalesce((select sum((i ->> 'd')::int) from jsonb_array_elements(inc) i where i ->> 'pid' = pl ->> 'pid' and i ->> 'stat' = 'tb'), 0),
      'rbi', coalesce((select sum((i ->> 'd')::int) from jsonb_array_elements(inc) i where i ->> 'pid' = pl ->> 'pid' and i ->> 'stat' = 'rbi'), 0),
      'runs', coalesce((select sum((i ->> 'd')::int) from jsonb_array_elements(inc) i where i ->> 'pid' = pl ->> 'pid' and i ->> 'stat' = 'runs'), 0),
      'k', coalesce((select sum((i ->> 'd')::int) from jsonb_array_elements(inc) i where i ->> 'pid' = pl ->> 'pid' and i ->> 'stat' = 'k'), 0)));
  end loop;
  return jsonb_build_object('hs', hs, 'as', as_, 'players', players, 'ev', ev, 'inc', inc);
end $$;

create or replace function ls_private.run_sim(mk jsonb) returns jsonb language plpgsql volatile as $$
begin
  if mk ->> 'sport' = 'nfl' then return ls_private.sim_nfl(mk); end if;
  if mk ->> 'sport' = 'nba' then return ls_private.sim_nba(mk); end if;
  return ls_private.sim_mlb(mk);
end $$;

-- test helper (owner only): simulate n games without storing anything -> [{hs, as}]
create or replace function ls_private.sim_many(p_sport text, p_home text, p_away text, n int) returns table(hs int, as_ int, players jsonb)
language plpgsql volatile as $$
declare mk jsonb := public.battle_markets(p_sport, p_home, p_away); r jsonb; i int;
begin
  for i in 1 .. n loop r := ls_private.run_sim(mk); hs := (r ->> 'hs')::int; as_ := (r ->> 'as')::int; players := r -> 'players'; return next; end loop;
end $$;

-- ---------------------------------------------------------------- battle life cycle
create or replace function ls_private.refund_spectators(p_id bigint) returns void
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare s record;
begin
  for s in select * from public.spectator_bets where battle_id = p_id and status = 'pending' for update loop
    update public.spectator_bets set status = 'void', payout = s.stake, settled_at = public.app_now() where id = s.id;
    perform ls_private.move_coins(s.user_id, s.stake, 'spectator_refund', 'battle ' || p_id);
  end loop;
end $$;

create or replace function ls_private.cancel_battle_internal(p_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare b public.battles;
begin
  select * into b from public.battles where id = p_id for update;
  if not found or b.status not in ('open', 'building') then return; end if;
  update public.battles set status = 'cancelled', cancel_reason = p_reason, settled_at = public.app_now() where id = p_id;
  perform ls_private.move_coins(b.creator, b.wager, 'battle_refund', 'battle ' || p_id);
  if b.opponent is not null then perform ls_private.move_coins(b.opponent, b.wager, 'battle_refund', 'battle ' || p_id); end if;
  perform ls_private.refund_spectators(p_id);
end $$;

create or replace function public.create_battle(p_sport text, p_home text, p_away text, p_wager numeric, p_side text) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); w numeric := round(coalesce(p_wager, 0), 2); mk jsonb; bid bigint; bal numeric;
begin
  if uid is null then raise exception 'Sign in to battle'; end if;
  if p_home = p_away then raise exception 'Pick two different teams'; end if;
  if p_side not in ('home', 'away') then raise exception 'Pick the team you back'; end if;
  if w < 1 then raise exception 'The wager must be at least 1 coin'; end if;
  if w > 100000 then raise exception 'That wager is too large'; end if;
  if (select count(*) from public.battles where creator = uid and status in ('open', 'building')) >= 3 then raise exception 'You already have 3 open battles'; end if;
  perform public.battle_tick();
  mk := public.battle_markets(p_sport, p_home, p_away);
  insert into public.battles(sport, home, away, wager, creator, creator_side, markets)
    values (p_sport, p_home, p_away, w, uid, p_side, mk) returning id into bid;
  bal := ls_private.move_coins(uid, -w, 'battle_escrow', 'battle ' || bid);
  insert into public.battle_stats(user_id, sport) values (uid, p_sport) on conflict do nothing;
  perform ls_private.add_action(uid);
  return jsonb_build_object('id', bid, 'balance', bal);
end $$;

create or replace function public.accept_battle(p_id bigint, p_side text default null) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); b public.battles; bal numeric; ec numeric; eo numeric; pc double precision; side text; cn text; onm text;
begin
  if uid is null then raise exception 'Sign in to battle'; end if;
  perform public.battle_tick();
  select * into b from public.battles where id = p_id for update;
  if not found then raise exception 'No such battle'; end if;
  if b.creator = uid then raise exception 'You cannot accept your own battle'; end if;
  if b.status <> 'open' or b.opponent is not null then raise exception 'This battle is no longer open'; end if;
  side := coalesce(p_side, case b.creator_side when 'home' then 'away' else 'home' end);
  if side not in ('home', 'away') then raise exception 'Pick a team'; end if;
  bal := ls_private.move_coins(uid, -b.wager, 'battle_escrow', 'battle ' || p_id);
  insert into public.battle_stats(user_id, sport) values (uid, b.sport) on conflict do nothing;
  insert into public.battle_stats(user_id, sport) values (b.creator, b.sport) on conflict do nothing;
  select elo into ec from public.battle_stats where user_id = b.creator and sport = b.sport;
  select elo into eo from public.battle_stats where user_id = uid and sport = b.sport;
  select username into cn from public.profiles where id = b.creator;
  select username into onm from public.profiles where id = uid;
  pc := 1 / (1 + power(10, (eo - ec) / 400.0));
  update public.battles set opponent = uid, opponent_side = side, status = 'building', accepted_at = public.app_now(),
    markets = markets || jsonb_build_object('winner', jsonb_build_object('creator', ls_private.est_price(pc::numeric), 'opponent', ls_private.est_price((1 - pc)::numeric),
      'creatorName', cn, 'opponentName', onm, 'pCreator', round(pc::numeric, 3)))
    where id = p_id;
  insert into public.battle_parlays(battle_id, user_id) values (p_id, b.creator), (p_id, uid) on conflict do nothing;
  perform ls_private.add_action(uid);
  return jsonb_build_object('ok', true, 'balance', bal);
end $$;

create or replace function public.cancel_battle(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); b public.battles;
begin
  select * into b from public.battles where id = p_id for update;
  if not found then raise exception 'No such battle'; end if;
  if uid is null or (uid <> b.creator and uid is distinct from b.opponent) then raise exception 'Only the two players can cancel'; end if;
  if b.status not in ('open', 'building') then raise exception 'This battle can no longer be cancelled'; end if;
  perform ls_private.cancel_battle_internal(p_id, 'cancelled by a player');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.set_battle_parlay(p_id bigint, p_legs jsonb) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); b public.battles; pp public.battle_parlays; n int; i int; leg jsonb; v_legs jsonb := '[]'::jsonb; grps text[] := '{}';
begin
  select * into b from public.battles where id = p_id for update;
  if not found then raise exception 'No such battle'; end if;
  if uid is null or (uid <> b.creator and uid is distinct from b.opponent) then raise exception 'Only the two players build parlays'; end if;
  if b.status <> 'building' then raise exception 'Parlays can only be changed before the game starts'; end if;
  select * into pp from public.battle_parlays where battle_id = p_id and user_id = uid for update;
  if pp.locked then raise exception 'Your parlay is locked'; end if;
  if jsonb_typeof(p_legs) is distinct from 'array' then raise exception 'Bad parlay'; end if;
  n := jsonb_array_length(p_legs);
  if n > 6 then raise exception 'A battle parlay has at most 6 legs'; end if;
  for i in 0 .. n - 1 loop
    leg := ls_private.battle_leg(b.markets, p_legs ->> i, false);
    if leg is null then raise exception 'Unknown battle market'; end if;
    if (leg ->> 'grp') = any(grps) then raise exception 'One pick per market: %', leg ->> 'label'; end if;
    grps := grps || (leg ->> 'grp'); v_legs := v_legs || jsonb_build_array(leg);
  end loop;
  update public.battle_parlays set legs = v_legs, updated_at = public.app_now() where battle_id = p_id and user_id = uid;
  return jsonb_build_object('ok', true, 'legs', v_legs);
end $$;

create or replace function public.lock_battle_parlay(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); b public.battles; pp public.battle_parlays; nlocked int;
begin
  select * into b from public.battles where id = p_id for update;
  if not found then raise exception 'No such battle'; end if;
  if uid is null or (uid <> b.creator and uid is distinct from b.opponent) then raise exception 'Only the two players lock parlays'; end if;
  if b.status <> 'building' then raise exception 'This battle is not waiting for parlays'; end if;
  select * into pp from public.battle_parlays where battle_id = p_id and user_id = uid for update;
  if jsonb_array_length(pp.legs) < 1 then raise exception 'Add at least one leg before locking'; end if;
  update public.battle_parlays set locked = true, updated_at = public.app_now() where battle_id = p_id and user_id = uid;
  select count(*) into nlocked from public.battle_parlays where battle_id = p_id and locked;
  if nlocked >= 2 then perform ls_private.start_battle(p_id); return jsonb_build_object('ok', true, 'started', true); end if;
  return jsonb_build_object('ok', true, 'started', false);
end $$;

-- computes the whole game now; plays become visible one by one over ~3 minutes
create or replace function ls_private.start_battle(p_id bigint) returns void
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare b public.battles; sim jsonb; ev jsonb; tmax float; t0 timestamptz := public.app_now(); e jsonb; seq int := 0; lh int := 0; la int := 0; t float;
  snap jsonb; pr jsonb; rem float; wp float; m int; eh float; ea float; sdm float; ends timestamptz; fin boolean; hs int; as_ int;
begin
  select * into b from public.battles where id = p_id for update;
  if b.status <> 'building' then return; end if;
  sim := ls_private.run_sim(b.markets);
  hs := (sim ->> 'hs')::int; as_ := (sim ->> 'as')::int;
  tmax := greatest(1.0, coalesce((select max((x ->> 't')::float) from jsonb_array_elements(sim -> 'ev') x), 1.0));
  ev := sim -> 'ev' || jsonb_build_array(jsonb_build_object('t', tmax + 0.00001, 'kind', 'final',
    'text', 'Final' || case when tmax > 1 then case b.sport when 'mlb' then ' (extra innings)' else ' (overtime)' end else '' end || ': ' || b.away || ' ' || as_ || ', ' || b.home || ' ' || hs,
    'hs', hs, 'as', as_, 'clock', 'Final'));
  tmax := tmax + 0.00001;
  eh := (b.markets ->> 'eh')::float; ea := (b.markets ->> 'ea')::float; sdm := (b.markets ->> 'sdm')::float;
  ends := t0 + interval '180 seconds';
  for e in select x from jsonb_array_elements(ev) with ordinality as a(x, o) order by (x ->> 't')::float, o loop
    t := (e ->> 't')::float;
    if (e ->> 'hs')::int >= 0 then lh := (e ->> 'hs')::int; la := (e ->> 'as')::int; end if;
    fin := e ->> 'kind' = 'final';
    snap := '{}'::jsonb;
    for pr in select x from jsonb_array_elements(b.markets -> 'props') x loop
      snap := jsonb_set(snap, array[pr ->> 'pid'], coalesce(snap -> (pr ->> 'pid'), '{}'::jsonb) || jsonb_build_object(pr ->> 'stat',
        coalesce((select sum((i ->> 'd')::numeric) from jsonb_array_elements(sim -> 'inc') i where i ->> 'pid' = pr ->> 'pid' and i ->> 'stat' = pr ->> 'stat' and (i ->> 't')::float <= t), 0)));
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

create or replace function ls_private.elo_update(p_sport text, a uuid, b uuid, score_a float) returns void
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare ra float; rb float; ea float;
begin
  insert into public.battle_stats(user_id, sport) values (a, p_sport), (b, p_sport) on conflict do nothing;
  select elo into ra from public.battle_stats where user_id = a and sport = p_sport for update;
  select elo into rb from public.battle_stats where user_id = b and sport = p_sport for update;
  ea := 1 / (1 + power(10, (rb - ra) / 400.0));
  update public.battle_stats set elo = round((ra + 32 * (score_a - ea))::numeric, 2), rated = rated + 1,
    w = w + (score_a = 1)::int, l = l + (score_a = 0)::int, t = t + (score_a = 0.5)::int where user_id = a and sport = p_sport;
  update public.battle_stats set elo = round((rb + 32 * ((1 - score_a) - (1 - ea)))::numeric, 2), rated = rated + 1,
    w = w + (score_a = 0)::int, l = l + (score_a = 1)::int, t = t + (score_a = 0.5)::int where user_id = b and sport = p_sport;
end $$;

create or replace function ls_private.grade_parlay(mk jsonb, legs jsonb, hs int, as_ int, players jsonb) returns jsonb language plpgsql immutable as $$
declare leg jsonb; res text; graded jsonb := '[]'::jsonb; d numeric := 1; nl int := 0; nw int := 0;
begin
  for leg in select x from jsonb_array_elements(legs) x loop
    res := ls_private.grade_battle_leg(mk, leg ->> 'tok', hs, as_, players);
    graded := graded || jsonb_build_array(leg || jsonb_build_object('res', res));
    if res = 'L' then nl := nl + 1; elsif res = 'W' then nw := nw + 1; d := d * ls_private.dec_of((leg ->> 'price')::int); end if;
  end loop;
  return jsonb_build_object('payout', case when nl > 0 then 0 else round((mk ->> 'notional')::numeric * d, 2) end, 'hits', nw, 'legs', graded);
end $$;

create or replace function ls_private.settle_battle_internal(p_id bigint) returns text
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare b public.battles; r public.battle_results; gc jsonb; go jsonb; pc numeric; po numeric; hc int; ho int; win uuid := null; lose uuid; s record;
  res text; pay numeric; split boolean := false;
begin
  select * into b from public.battles where id = p_id for update;
  if not found or b.status <> 'live' or b.ends_at > public.app_now() then return null; end if;
  select * into r from public.battle_results where battle_id = p_id;
  gc := ls_private.grade_parlay(b.markets, (select legs from public.battle_parlays where battle_id = p_id and user_id = b.creator), r.home_score, r.away_score, r.players);
  go := ls_private.grade_parlay(b.markets, (select legs from public.battle_parlays where battle_id = p_id and user_id = b.opponent), r.home_score, r.away_score, r.players);
  update public.battle_parlays set payout = (gc ->> 'payout')::numeric, hits = (gc ->> 'hits')::int, graded = gc -> 'legs' where battle_id = p_id and user_id = b.creator;
  update public.battle_parlays set payout = (go ->> 'payout')::numeric, hits = (go ->> 'hits')::int, graded = go -> 'legs' where battle_id = p_id and user_id = b.opponent;
  pc := (gc ->> 'payout')::numeric; po := (go ->> 'payout')::numeric; hc := (gc ->> 'hits')::int; ho := (go ->> 'hits')::int;
  -- the slip that pays more wins; if both pay the same (e.g. both lost): more legs hit wins; still tied: split the pot
  if pc > po then win := b.creator; elsif po > pc then win := b.opponent;
  elsif hc > ho then win := b.creator; elsif ho > hc then win := b.opponent; else split := true; end if;
  if split then
    perform ls_private.move_coins(b.creator, b.wager, 'battle_payout', 'battle ' || p_id || ' split');
    perform ls_private.move_coins(b.opponent, b.wager, 'battle_payout', 'battle ' || p_id || ' split');
    perform ls_private.elo_update(b.sport, b.creator, b.opponent, 0.5);
  else
    lose := case when win = b.creator then b.opponent else b.creator end;
    perform ls_private.move_coins(win, b.wager * 2, 'battle_payout', 'battle ' || p_id || ' won');
    perform ls_private.add_net(win, b.wager);
    perform ls_private.add_net(lose, -b.wager);
    perform ls_private.elo_update(b.sport, win, lose, 1);
    perform ls_private.streak(win, 'W'); perform ls_private.streak(lose, 'L');
  end if;
  update public.battles set status = 'final', settled_at = public.app_now(), winner = win,
    result = jsonb_build_object('hs', r.home_score, 'as', r.away_score, 'split', split, 'creator', jsonb_build_object('payout', pc, 'hits', hc), 'opponent', jsonb_build_object('payout', po, 'hits', ho))
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
  return 'final';
end $$;

create or replace function public.place_spectator_bet(p_id bigint, p_tok text, p_stake numeric) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); b public.battles; leg jsonb; st numeric := round(coalesce(p_stake, 0), 2); bal numeric; sid bigint;
begin
  if uid is null then raise exception 'Sign in to bet'; end if;
  select * into b from public.battles where id = p_id for update;
  if not found then raise exception 'No such battle'; end if;
  if b.status not in ('open', 'building') then raise exception 'Betting closed when the game started'; end if;
  if uid = b.creator or uid is not distinct from b.opponent then raise exception 'Players cannot bet on their own battle'; end if;
  if st < 1 then raise exception 'Bet at least 1 coin'; end if;
  if st > 100000 then raise exception 'That stake is too large'; end if;
  if p_tok like 'p:%' then raise exception 'Spectators bet on the game lines and the battle winner'; end if;
  leg := ls_private.battle_leg(b.markets, p_tok, true);
  if leg is null then raise exception 'That market is not open%', case when p_tok like 'win:%' then ' until someone accepts the battle' else '' end; end if;
  bal := ls_private.move_coins(uid, -st, 'spectator_stake', 'battle ' || p_id);
  insert into public.spectator_bets(battle_id, user_id, tok, label, price, stake) values (p_id, uid, p_tok, leg ->> 'label', (leg ->> 'price')::int, st) returning id into sid;
  perform ls_private.add_action(uid);
  return jsonb_build_object('ok', true, 'id', sid, 'balance', bal, 'price', (leg ->> 'price')::int, 'label', leg ->> 'label');
end $$;

-- timeouts + settlement of finished games; pg_cron runs it every minute and the page calls it lazily
create or replace function public.battle_tick() returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare r record; nc int := 0; ns int := 0; now_ timestamptz := public.app_now();
begin
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

create or replace function public.settle_battle(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
begin
  return jsonb_build_object('result', ls_private.settle_battle_internal(p_id));
end $$;

-- lobby + one battle (caller's rights: row level security decides what is visible)
create or replace function public.battle_lobby() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('now', public.app_now(),
    'open', coalesce((select jsonb_agg(x order by x.id desc) from (select b.id, b.sport, b.home, b.away, b.wager, b.status, b.creator, b.creator_side, b.opponent, b.opponent_side, b.created_at, b.accepted_at,
        (select username from public.profiles where id = b.creator) creator_name, (select username from public.profiles where id = b.opponent) opponent_name,
        (select count(*) from public.spectator_bets s where s.battle_id = b.id) nbets
      from public.battles b where b.status in ('open', 'building') order by b.id desc limit 30) x), '[]'::jsonb),
    'live', coalesce((select jsonb_agg(x order by x.id desc) from (select b.id, b.sport, b.home, b.away, b.wager, b.status, b.creator, b.opponent, b.started_at, b.ends_at,
        (select username from public.profiles where id = b.creator) creator_name, (select username from public.profiles where id = b.opponent) opponent_name,
        (select jsonb_build_object('hs', e.hs, 'as', e.as_, 'clock', e.clock) from public.battle_events e where e.battle_id = b.id order by e.seq desc limit 1) score,
        (select count(*) from public.spectator_bets s where s.battle_id = b.id) nbets
      from public.battles b where b.status = 'live' order by b.id desc limit 20) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x order by x.id desc) from (select b.id, b.sport, b.home, b.away, b.wager, b.status, b.creator, b.opponent, b.winner, b.result, b.cancel_reason, b.settled_at,
        (select username from public.profiles where id = b.creator) creator_name, (select username from public.profiles where id = b.opponent) opponent_name
      from public.battles b where b.status in ('final', 'cancelled') order by b.id desc limit 15) x), '[]'::jsonb))
$$;

create or replace function public.battle_detail(p_id bigint) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('now', public.app_now(),
    'battle', to_jsonb(b) || jsonb_build_object('creator_name', (select username from public.profiles where id = b.creator), 'opponent_name', (select username from public.profiles where id = b.opponent)),
    'parlays', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('username', (select username from public.profiles where id = p.user_id))) from public.battle_parlays p where p.battle_id = b.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'battle_id' order by e.seq) from public.battle_events e where e.battle_id = b.id), '[]'::jsonb),
    'result', (select to_jsonb(r) from public.battle_results r where r.battle_id = b.id),
    'bets', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('username', (select username from public.profiles where id = s.user_id)) order by s.id) from public.spectator_bets s where s.battle_id = b.id), '[]'::jsonb))
  from public.battles b where b.id = p_id
$$;

-- =====================================================================================================================
--  Security: row level security on every table (read-only for the app), function permissions, realtime, schedules
-- =====================================================================================================================
do $$
declare t text;
begin
  foreach t in array array['profiles','ledger','daily_stats','badges','finalized_days','games','bets','bet_legs','chat_messages','mentions',
                           'sim_teams','sim_players','battles','battle_parlays','battle_events','battle_results','spectator_bets','battle_stats'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- public read (signed-out visitors can browse the boards, battles and profiles)
grant select on public.profiles, public.daily_stats, public.badges, public.finalized_days, public.games, public.bets, public.bet_legs,
  public.sim_teams, public.sim_players, public.battles, public.battle_parlays, public.battle_events, public.battle_results,
  public.spectator_bets, public.battle_stats to anon, authenticated;
-- signed-in only
grant select on public.chat_messages, public.mentions, public.ledger to authenticated;
-- profiles: no email or other private column exists in this table; emails stay in auth.users, which the API never exposes

drop policy if exists ls_read on public.profiles;        create policy ls_read on public.profiles for select using (true);
drop policy if exists ls_read on public.daily_stats;     create policy ls_read on public.daily_stats for select using (true);
drop policy if exists ls_read on public.badges;          create policy ls_read on public.badges for select using (true);
drop policy if exists ls_read on public.finalized_days;  create policy ls_read on public.finalized_days for select using (true);
drop policy if exists ls_read on public.games;           create policy ls_read on public.games for select using (true);
drop policy if exists ls_read on public.bets;            create policy ls_read on public.bets for select using (true);
drop policy if exists ls_read on public.bet_legs;        create policy ls_read on public.bet_legs for select using (true);
drop policy if exists ls_read on public.sim_teams;       create policy ls_read on public.sim_teams for select using (true);
drop policy if exists ls_read on public.sim_players;     create policy ls_read on public.sim_players for select using (true);
drop policy if exists ls_read on public.battles;         create policy ls_read on public.battles for select using (true);
drop policy if exists ls_read on public.spectator_bets;  create policy ls_read on public.spectator_bets for select using (true);
drop policy if exists ls_read on public.battle_stats;    create policy ls_read on public.battle_stats for select using (true);
drop policy if exists ls_read on public.chat_messages;   create policy ls_read on public.chat_messages for select to authenticated using (true);
drop policy if exists ls_read on public.mentions;        create policy ls_read on public.mentions for select to authenticated using (user_id = auth.uid());
drop policy if exists ls_read on public.ledger;          create policy ls_read on public.ledger for select to authenticated using (user_id = auth.uid());
-- a player's battle parlay is private until the game starts (then everyone can see both)
drop policy if exists ls_read on public.battle_parlays;
create policy ls_read on public.battle_parlays for select using (
  user_id = auth.uid() or exists (select 1 from public.battles b where b.id = battle_id and b.status in ('live', 'final')));
-- NO SPOILERS: a play of a simulated game is only readable once its time has come
drop policy if exists ls_read on public.battle_events;
create policy ls_read on public.battle_events for select using (visible_at <= public.app_now());
drop policy if exists ls_read on public.battle_results;
create policy ls_read on public.battle_results for select using (ends_at <= public.app_now());

-- sequences are only used inside the functions
do $$ begin execute 'revoke all on all sequences in schema public from anon, authenticated'; end $$;

-- functions: nothing is callable unless listed here
do $$
declare f record;
begin
  -- only Line Scout's own functions are touched (other extensions or functions in your project keep their permissions)
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any(array['app_now','username_available','handle_new_user','claim_username','place_bet','bot_pending_games',
             'bot_settle_games','send_chat','delete_chat','chat_mentions_trigger','finalize_days','leaderboard','get_profile','battle_markets','create_battle',
             'accept_battle','cancel_battle','set_battle_parlay','lock_battle_parlay','place_spectator_bet','battle_tick','settle_battle','battle_lobby','battle_detail']) loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
revoke all on all functions in schema ls_private from public, anon, authenticated;
grant execute on function public.app_now() to anon, authenticated, service_role;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.claim_username(text) to authenticated;
grant execute on function public.place_bet(jsonb, numeric, text, text) to authenticated;
grant execute on function public.send_chat(text, text) to authenticated;
grant execute on function public.delete_chat(bigint) to authenticated;
grant execute on function public.finalize_days() to anon, authenticated, service_role;
grant execute on function public.leaderboard(date) to anon, authenticated;
grant execute on function public.get_profile(text, uuid) to anon, authenticated;
grant execute on function public.battle_markets(text, text, text) to anon, authenticated;
grant execute on function public.create_battle(text, text, text, numeric, text) to authenticated;
grant execute on function public.accept_battle(bigint, text) to authenticated;
grant execute on function public.cancel_battle(bigint) to authenticated;
grant execute on function public.set_battle_parlay(bigint, jsonb) to authenticated;
grant execute on function public.lock_battle_parlay(bigint) to authenticated;
grant execute on function public.place_spectator_bet(bigint, text, numeric) to authenticated;
grant execute on function public.battle_tick() to anon, authenticated, service_role;
grant execute on function public.settle_battle(bigint) to anon, authenticated, service_role;
grant execute on function public.battle_lobby() to anon, authenticated;
grant execute on function public.battle_detail(bigint) to anon, authenticated;
-- the auth service fires the sign-up trigger
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.handle_new_user() to supabase_auth_admin';
  end if;
end $$;
-- the GitHub bot (service role key, kept in a GitHub secret)
grant execute on function public.bot_pending_games() to service_role;
grant execute on function public.bot_settle_games(jsonb) to service_role;
grant select, insert, update, delete on public.games, public.sim_teams, public.sim_players to service_role;

-- realtime: chat + mentions (Supabase Realtime respects the read policies above)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
      execute 'alter publication supabase_realtime add table public.chat_messages';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mentions') then
      execute 'alter publication supabase_realtime add table public.mentions';
    end if;
  end if;
end $$;

-- schedules (pg_cron; re-running this file just updates them)
select cron.schedule('ls-finalize-days', '*/10 * * * *', 'select public.finalize_days()');
select cron.schedule('ls-battle-tick', '* * * * *', 'select public.battle_tick()');
-- keep the cron log small (free tier has a 500 MB database)
select cron.schedule('ls-cron-log-cleanup', '17 4 * * *', $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);

-- done
select 'Line Scout setup complete' as status;
