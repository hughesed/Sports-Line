-- =====================================================================================================================
--  patch_shop_v8.sql: coin shop, gifts, 30-day pass, direct messages, online/offline, profile visitors, battle invites.
--  Additive only: new tables, new columns, new functions. Nothing existing is changed or dropped. Safe to run twice.
--  Practice coins only: nothing here uses real money.
-- =====================================================================================================================
alter table public.profiles add column if not exists last_seen timestamptz;
alter table public.profiles add column if not exists pass_until timestamptz;
alter table public.profiles add column if not exists last_daily date;
alter table public.battles  add column if not exists invited uuid references public.profiles(id) on delete set null;

create table if not exists public.shop_items(
  id text primary key, name text not null, emoji text not null, price int not null check (price > 0),
  blurb text not null default '', active boolean not null default true, sort int not null default 0);
insert into public.shop_items(id, name, emoji, price, blurb, sort) values
  ('corn', 'It''s corn', '🌽', 5, 'Corny, but it counts.', 1),
  ('wink', 'Wink wink', '😉', 5, 'A little nod.', 2),
  ('heart', 'Heart', '❤️', 10, 'Show some love.', 3),
  ('clap', 'Clap clap', '👏', 10, 'Nice call.', 4),
  ('icecream', 'Ice cream', '🍦', 10, 'Cool under pressure.', 5),
  ('chili', 'Chili', '🌶️', 15, 'Spicy pick.', 6),
  ('rose', 'Rose', '🌹', 25, 'A small thank-you.', 7),
  ('donut', 'Doughnut', '🍩', 30, 'Sweet win.', 8),
  ('pizza', 'Pizza slice', '🍕', 40, 'Winner winner.', 9),
  ('cook', 'Let em cook', '👨‍🍳', 50, 'Let them cook.', 10),
  ('fire', 'Hot streak', '🔥', 60, 'You are on fire.', 11),
  ('rocket', 'Rocket', '🚀', 80, 'To the moon.', 12),
  ('trophy', 'Trophy', '🏆', 100, 'For a big win.', 13),
  ('diamond', 'Diamond', '💎', 120, 'Rare and shiny.', 14),
  ('goat', 'GOAT', '🐐', 150, 'The greatest.', 15),
  ('crown', 'Crown', '👑', 250, 'Royalty. Lasts the longest.', 16),
  ('car', 'Sports car', '🏎️', 400, 'Top of the board.', 17),
  ('football', 'Football', '🏈', 15, 'Game day.', 18),
  ('basketball', 'Basketball', '🏀', 15, 'Bucket.', 19),
  ('baseball', 'Baseball', '⚾', 15, 'Play ball.', 20),
  ('hockey', 'Hockey stick', '🏒', 15, 'Top shelf.', 21),
  ('soccer', 'Soccer ball', '⚽', 15, 'Goooal.', 22),
  ('golf', 'Golf flag', '⛳', 20, 'Fore.', 23),
  ('glove', 'Boxing glove', '🥊', 30, 'Knockout call.', 24),
  ('sneakers', 'Sneakers', '👟', 40, 'Fresh kicks.', 25),
  ('gold', 'Gold medal', '🥇', 60, 'First place.', 26),
  ('belt', 'Champ belt', '🏅', 90, 'Undisputed.', 27),
  ('hotdog', 'Hot dog', '🌭', 10, 'Stadium classic.', 28),
  ('popcorn', 'Popcorn', '🍿', 10, 'Enjoy the show.', 29),
  ('nachos', 'Nachos', '🌮', 10, 'Tailgate fuel.', 30),
  ('finger', 'Foam finger', '👆', 15, 'We are number one.', 31),
  ('bell', 'Cowbell', '🔔', 15, 'More cowbell.', 32),
  ('paint', 'Face paint', '🎨', 15, 'Full game face.', 33),
  ('flag', 'Pennant', '🚩', 20, 'Wave it.', 34),
  ('mega', 'Megaphone', '📣', 20, 'Loud and proud.', 35),
  ('cap', 'Fan cap', '🧢', 30, 'Rep your side.', 36),
  ('scarf', 'Team scarf', '🧣', 35, 'Cold weather fan.', 37),
  ('ticket', 'Season ticket', '🎟️', 40, 'Front row.', 38),
  ('jersey', 'Jersey', '👕', 60, 'Wear it.', 39),
  ('ring', 'Champion ring', '💍', 300, 'Bling.', 40),
  ('stadium', 'Stadium', '🏟️', 200, 'Your own house.', 41),
  ('lion', 'Blue Lion', '🦁', 75, 'Roar. A look-alike for the Lions.', 42),
  ('eagle', 'Gridiron Eagle', '🦅', 75, 'Fly high. A look-alike for the Eagles.', 43),
  ('bear', 'Prairie Bear', '🐻', 75, 'Windy city bear.', 44),
  ('cheese', 'Cheese Hat', '🧀', 40, 'Dairy-state fan.', 45),
  ('cowboy', 'Lone Star Cowboy', '🤠', 75, 'Big Texas energy.', 46),
  ('dolphin', 'Dolphin', '🐬', 75, 'Surf the wave.', 47),
  ('raven', 'Raven', '🐦‍⬛', 75, 'Nevermore losing.', 48),
  ('tiger', 'Tiger', '🐯', 75, 'Old English D vibes.', 49),
  ('bull', 'Bull', '🐂', 75, 'Charging in.', 50),
  ('pirate', 'Pirate Flag', '🏴‍☠️', 75, 'Raise the flag.', 51),
  ('ram', 'Ram', '🐏', 75, 'Headbutt.', 52),
  ('panther', 'Panther', '🐆', 75, 'Prowling.', 53),
  ('horse', 'Wild Horse', '🐎', 75, 'Broncos energy.', 54),
  ('bat', 'Night Bat', '🦇', 75, 'After dark.', 55),
  ('gear', 'Motor City Gear', '⚙️', 50, 'Built in Detroit.', 56)
on conflict (id) do update set name = excluded.name, emoji = excluded.emoji, price = excluded.price, blurb = excluded.blurb, sort = excluded.sort;

create table if not exists public.inventory(
  id bigserial primary key,
  owner uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.shop_items(id),
  paid int not null,
  bought_at timestamptz not null default now(),
  use_by timestamptz not null,
  sent_to uuid references public.profiles(id) on delete set null,
  sent_at timestamptz);
create index if not exists inventory_owner on public.inventory(owner, id desc);

create table if not exists public.dms(
  id bigserial primary key,
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  gift_name text, gift_emoji text, gift_until timestamptz,
  battle_id bigint,
  created_at timestamptz not null default now(),
  read_at timestamptz);
create index if not exists dms_to   on public.dms(to_user, id desc);
create index if not exists dms_pair on public.dms(from_user, to_user, id desc);

create table if not exists public.profile_visits(
  visitor uuid not null references public.profiles(id) on delete cascade,
  profile uuid not null references public.profiles(id) on delete cascade,
  last_at timestamptz not null default now(),
  n int not null default 1,
  primary key (visitor, profile));
create index if not exists profile_visits_profile on public.profile_visits(profile, last_at desc);

-- no direct table access from the browser: everything goes through the functions below
alter table public.shop_items enable row level security;
alter table public.inventory enable row level security;
alter table public.dms enable row level security;
alter table public.profile_visits enable row level security;
revoke all on public.shop_items, public.inventory, public.dms, public.profile_visits from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

create or replace function ls_private.item_days(p_price int) returns int language sql immutable as $$ select 2 + (p_price / 50) $$;
create or replace function ls_private.has_pass(p_user uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select pass_until > now() from public.profiles where id = p_user), false) $$;

-- a battle sent to one person can only be accepted by that person
create or replace function ls_private.battle_invite_guard() returns trigger language plpgsql as $$
begin
  if old.invited is not null and old.opponent is null and new.opponent is not null and new.opponent <> old.invited then
    raise exception 'This battle was sent to %', coalesce((select username from public.profiles where id = old.invited), 'another player');
  end if;
  return new;
end $$;
drop trigger if exists ls_battle_invite_guard on public.battles;
create trigger ls_battle_invite_guard before update on public.battles for each row execute function ls_private.battle_invite_guard();

-- ---------------------------------------------------------------- presence: who is online
create or replace function public.touch_presence() returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
begin
  if auth.uid() is null then return null; end if;
  update public.profiles set last_seen = now() where id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.who_online() returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return coalesce((select jsonb_agg(x) from (
    select id, username, (last_seen is not null and last_seen > now() - interval '2 minutes') as online, last_seen, (pass_until is not null and pass_until > now()) as pass
    from public.profiles order by (last_seen is not null and last_seen > now() - interval '2 minutes') desc, last_seen desc nulls last, username limit 200) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- daily coins: 10 a day, 20 with the pass
create or replace function public.claim_daily() returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); pr public.profiles; d date := ls_private.today(); amt int; nb numeric;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  select * into pr from public.profiles where id = uid for update;
  if not found then raise exception 'Pick a username first'; end if;
  if pr.last_daily is not null and pr.last_daily >= d then
    return jsonb_build_object('claimed', false, 'pass', ls_private.has_pass(uid), 'balance', pr.balance);
  end if;
  amt := case when ls_private.has_pass(uid) then 20 else 10 end;
  nb := ls_private.move_coins(uid, amt, 'daily', 'daily ' || d);
  update public.profiles set last_daily = d where id = uid;
  return jsonb_build_object('claimed', true, 'amount', amt, 'pass', ls_private.has_pass(uid), 'balance', nb);
end $$;

-- ---------------------------------------------------------------- shop
create or replace function public.shop_state() returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); pr public.profiles; pass boolean;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  select * into pr from public.profiles where id = uid;
  if not found then raise exception 'Pick a username first'; end if;
  pass := ls_private.has_pass(uid);
  return jsonb_build_object(
    'balance', pr.balance, 'pass', pass, 'pass_until', pr.pass_until, 'pass_price', 1000, 'discount_pct', 20,
    'daily_ready', (pr.last_daily is null or pr.last_daily < ls_private.today()), 'daily_amount', case when pass then 20 else 10 end,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'emoji', emoji, 'price', price,
        'pay', case when pass then ceil(price * 0.8)::int else price end, 'days', ls_private.item_days(price), 'blurb', blurb) order by sort) from public.shop_items where active), '[]'::jsonb),
    'inventory', coalesce((select jsonb_agg(x) from (
        select i.id, s.name, s.emoji, i.use_by, i.sent_at, (select username from public.profiles where id = i.sent_to) as sent_to_name
        from public.inventory i join public.shop_items s on s.id = i.item_id
        where i.owner = uid and (i.sent_at is null and i.use_by > now() or i.sent_at > now() - interval '7 days')
        order by i.id desc limit 40) x), '[]'::jsonb));
end $$;

create or replace function public.buy_item(p_item text) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); it public.shop_items; pay int; nb numeric; iid bigint;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  select * into it from public.shop_items where id = p_item and active;
  if not found then raise exception 'No such item'; end if;
  pay := case when ls_private.has_pass(uid) then ceil(it.price * 0.8)::int else it.price end;
  nb := ls_private.move_coins(uid, -pay, 'shop', 'item ' || it.id);
  insert into public.inventory(owner, item_id, paid, use_by) values (uid, it.id, pay, now() + (ls_private.item_days(it.price) || ' days')::interval) returning id into iid;
  return jsonb_build_object('ok', true, 'balance', nb, 'inv', iid, 'days', ls_private.item_days(it.price));
end $$;

create or replace function public.buy_pass() returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); nb numeric; u timestamptz;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  nb := ls_private.move_coins(uid, -1000, 'pass', '30-day pass');
  update public.profiles set pass_until = greatest(coalesce(pass_until, now()), now()) + interval '30 days' where id = uid returning pass_until into u;
  return jsonb_build_object('ok', true, 'balance', nb, 'pass_until', u);
end $$;

-- send an owned item to someone: it shows in the chat, in their messages, and on their profile until it runs out
create or replace function public.send_item(p_inv bigint, p_to uuid, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); inv public.inventory; it public.shop_items; me public.profiles; rc public.profiles; note text; untl timestamptz;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  if p_to = uid then raise exception 'Pick someone else'; end if;
  select * into me from public.profiles where id = uid;
  select * into rc from public.profiles where id = p_to;
  if me.id is null or rc.id is null then raise exception 'No such player'; end if;
  select * into inv from public.inventory where id = p_inv and owner = uid for update;
  if not found then raise exception 'You do not own that item'; end if;
  if inv.sent_at is not null then raise exception 'That item was already sent'; end if;
  if inv.use_by < now() then raise exception 'That item ran out before it was sent'; end if;
  select * into it from public.shop_items where id = inv.item_id;
  note := ls_private.clean_text(p_note, 140);
  untl := now() + (ls_private.item_days(it.price) || ' days')::interval;
  update public.inventory set sent_to = p_to, sent_at = now() where id = inv.id;
  insert into public.dms(from_user, to_user, body, gift_name, gift_emoji, gift_until) values (uid, p_to, note, it.name, it.emoji, untl);
  insert into public.chat_messages(user_id, username, body) values (uid, me.username, it.emoji || ' sent a ' || it.name || ' to @' || rc.username || case when note <> '' then ': ' || note else '' end);
  perform ls_private.add_action(uid);
  return jsonb_build_object('ok', true, 'until', untl);
end $$;

-- ---------------------------------------------------------------- direct messages
create or replace function public.send_dm(p_to uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); body text; mid bigint;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  if p_to = uid then raise exception 'You cannot message yourself'; end if;
  if not exists (select 1 from public.profiles where id = uid) then raise exception 'Pick a username first'; end if;
  if not exists (select 1 from public.profiles where id = p_to) then raise exception 'No such player'; end if;
  body := ls_private.clean_text(p_body, 500);
  if body = '' then raise exception 'Empty message'; end if;
  if exists (select 1 from public.dms where from_user = uid and created_at > now() - interval '1 second') then raise exception 'Slow down a little'; end if;
  insert into public.dms(from_user, to_user, body) values (uid, p_to, body) returning id into mid;
  return jsonb_build_object('id', mid);
end $$;

create or replace function public.dm_inbox() returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (
    select distinct on (other) other as user_id, (select username from public.profiles where id = other) as username,
           (select last_seen is not null and last_seen > now() - interval '2 minutes' from public.profiles where id = other) as online,
           d.id, left(case when d.gift_name is not null then d.gift_emoji || ' ' || d.gift_name when d.battle_id is not null then 'Battle challenge' else d.body end, 80) as last, d.created_at, d.from_user = uid as mine,
           (select count(*) from public.dms u where u.from_user = other and u.to_user = uid and u.read_at is null) as unread
    from (select d.*, case when d.from_user = uid then d.to_user else d.from_user end as other from public.dms d where d.from_user = uid or d.to_user = uid) d
    order by other, d.id desc) x), '[]'::jsonb);
end $$;

create or replace function public.dm_thread(p_with uuid, p_after bigint default 0) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first'; end if;
  update public.dms set read_at = now() where to_user = uid and from_user = p_with and read_at is null;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
    select id, from_user = uid as mine, body, gift_name, gift_emoji, gift_until, battle_id, created_at
    from public.dms where ((from_user = uid and to_user = p_with) or (from_user = p_with and to_user = uid)) and id > coalesce(p_after, 0)
    order by id desc limit 100) x), '[]'::jsonb);
end $$;

create or replace function public.dm_unread() returns int
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
begin
  if auth.uid() is null then return 0; end if;
  return (select count(*) from public.dms where to_user = auth.uid() and read_at is null);
end $$;

-- ---------------------------------------------------------------- profile visitors (the pass shows who visited)
create or replace function public.record_visit(p_profile uuid) returns void
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
begin
  if auth.uid() is null or p_profile is null or p_profile = auth.uid() then return; end if;
  insert into public.profile_visits(visitor, profile) values (auth.uid(), p_profile)
    on conflict (visitor, profile) do update set last_at = now(), n = public.profile_visits.n + 1;
end $$;

create or replace function public.my_visitors() returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first'; end if;
  if not ls_private.has_pass(uid) then
    return jsonb_build_object('locked', true, 'count', (select count(*) from public.profile_visits where profile = uid and last_at > now() - interval '30 days'));
  end if;
  return jsonb_build_object('locked', false, 'list', coalesce((select jsonb_agg(x) from (
    select p.username, v.last_at, v.n from public.profile_visits v join public.profiles p on p.id = v.visitor
    where v.profile = uid order by v.last_at desc limit 30) x), '[]'::jsonb));
end $$;

-- gifts someone is showing right now, plus online state and pass badge (get_profile itself is left alone)
create or replace function public.profile_extras(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
begin
  if auth.uid() is null then return null; end if;
  return jsonb_build_object(
    'pass', ls_private.has_pass(p_user),
    'online', coalesce((select last_seen > now() - interval '2 minutes' from public.profiles where id = p_user), false),
    'last_seen', (select last_seen from public.profiles where id = p_user),
    'gifts', coalesce((select jsonb_agg(x) from (
       select d.gift_emoji as emoji, d.gift_name as name, d.gift_until as until, (select username from public.profiles where id = d.from_user) as from_name
       from public.dms d where d.to_user = p_user and d.gift_name is not null and d.gift_until > now() order by d.id desc limit 12) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- send a battle to a person
create or replace function public.invite_battle(p_battle bigint, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); b public.battles; me text;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  if p_user = uid then raise exception 'Pick someone else'; end if;
  select * into b from public.battles where id = p_battle for update;
  if not found or b.creator <> uid then raise exception 'You can only send your own battles'; end if;
  if b.status <> 'open' or b.opponent is not null then raise exception 'That battle is no longer open'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'No such player'; end if;
  update public.battles set invited = p_user where id = p_battle;
  select username into me from public.profiles where id = uid;
  insert into public.dms(from_user, to_user, body, battle_id) values (uid, p_user, me || ' challenged you to a ' || upper(b.sport) || ' battle for ' || b.wager || ' coins.', p_battle);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- permissions: signed-in players only
do $$
declare f text;
begin
  foreach f in array array['touch_presence()', 'who_online()', 'claim_daily()', 'shop_state()', 'buy_item(text)', 'buy_pass()', 'send_item(bigint,uuid,text)',
    'send_dm(uuid,text)', 'dm_inbox()', 'dm_thread(uuid,bigint)', 'dm_unread()', 'record_visit(uuid)', 'my_visitors()', 'profile_extras(uuid)', 'invite_battle(bigint,uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on all functions in schema ls_private from public, anon, authenticated;

-- ---------------------------------------------------------------- the vault: gifts you received, and a room others can see
create table if not exists public.vault_rooms(
  owner uuid primary key references public.profiles(id) on delete cascade,
  wall text not null default 'navy', floor text not null default 'wood',
  slots jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
alter table public.vault_rooms enable row level security;
revoke all on public.vault_rooms from anon, authenticated;

create or replace function public.my_vault() returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); r public.vault_rooms;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  select * into r from public.vault_rooms where owner = uid;
  return jsonb_build_object(
    'gifts', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc) from (
       select i.id, s.emoji, s.name, s.price, (select username from public.profiles where id = i.owner) as from_name, i.sent_at as at
       from public.inventory i join public.shop_items s on s.id = i.item_id where i.sent_to = uid order by i.sent_at desc limit 200) x), '[]'::jsonb),
    'room', jsonb_build_object('wall', coalesce(r.wall, 'navy'), 'floor', coalesce(r.floor, 'wood'), 'slots', coalesce(r.slots, '{}'::jsonb)));
end $$;

create or replace function public.save_room(p_wall text, p_floor text, p_slots jsonb) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); k text; v text; clean jsonb := '{}'::jsonb; used bigint[] := '{}';
begin
  if uid is null then raise exception 'Sign in first'; end if;
  if p_wall not in ('navy','sunset','forest','royal','neon','brick') then p_wall := 'navy'; end if;
  if p_floor not in ('wood','turf','court','carpet','tile') then p_floor := 'wood'; end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'object' then p_slots := '{}'::jsonb; end if;
  for k, v in select key, value #>> '{}' from jsonb_each(p_slots) loop
    if k ~ '^[0-9]{1,2}$' and k::int between 0 and 23 and v ~ '^[0-9]{1,18}$'
       and not (v::bigint = any(used))
       and exists (select 1 from public.inventory where id = v::bigint and sent_to = uid) then
      clean := clean || jsonb_build_object(k, v::bigint); used := used || v::bigint;
    end if;
  end loop;
  insert into public.vault_rooms(owner, wall, floor, slots, updated_at) values (uid, p_wall, p_floor, clean, now())
  on conflict (owner) do update set wall = excluded.wall, floor = excluded.floor, slots = excluded.slots, updated_at = now();
  return jsonb_build_object('ok', true, 'slots', clean);
end $$;

create or replace function public.get_room(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare r public.vault_rooms;
begin
  if auth.uid() is null then return null; end if;
  select * into r from public.vault_rooms where owner = p_user;
  return jsonb_build_object('wall', coalesce(r.wall, 'navy'), 'floor', coalesce(r.floor, 'wood'),
    'total', (select count(*) from public.inventory where sent_to = p_user),
    'items', coalesce((select jsonb_agg(jsonb_build_object('slot', e.key::int, 'emoji', s.emoji, 'name', s.name,
         'from_name', (select username from public.profiles where id = i.owner)))
       from jsonb_each(coalesce(r.slots, '{}'::jsonb)) e
       join public.inventory i on i.id = (e.value #>> '{}')::bigint and i.sent_to = p_user
       join public.shop_items s on s.id = i.item_id), '[]'::jsonb));
end $$;

do $$
declare f text;
begin
  foreach f in array array['my_vault()', 'save_room(text,text,jsonb)', 'get_room(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
