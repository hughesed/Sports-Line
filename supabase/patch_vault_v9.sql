-- ============================================================================================================
-- Vault v9: send a gift to yourself, named rooms with a featured gift, more walls and floors.
-- Run once in the Supabase SQL Editor (after patch_shop_v8.sql). Safe to run again.
-- ============================================================================================================
alter table public.vault_rooms add column if not exists title text not null default '';
alter table public.vault_rooms add column if not exists feature bigint;

-- 1. gifts can be sent to yourself (they land in your own vault, no direct message is created)
create or replace function public.send_item(p_inv bigint, p_to uuid, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); inv public.inventory; it public.shop_items; me public.profiles; rc public.profiles; note text; untl timestamptz;
begin
  if uid is null then raise exception 'Sign in first'; end if;
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
  if p_to <> uid then
    insert into public.dms(from_user, to_user, body, gift_name, gift_emoji, gift_until) values (uid, p_to, note, it.name, it.emoji, untl);
    insert into public.chat_messages(user_id, username, body) values (uid, me.username, it.emoji || ' sent a ' || it.name || ' to @' || rc.username || case when note <> '' then ': ' || note else '' end);
  end if;
  perform ls_private.add_action(uid);
  return jsonb_build_object('ok', true, 'until', untl, 'self', p_to = uid);
end $$;

-- 2. the vault: item ids and the room's name / featured gift
create or replace function public.my_vault() returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); r public.vault_rooms;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  select * into r from public.vault_rooms where owner = uid;
  return jsonb_build_object(
    'gifts', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc) from (
       select i.id, s.id as item_id, s.emoji, s.name, s.price, s.blurb,
              (select username from public.profiles where id = i.owner) as from_name, (i.owner = uid) as self, i.sent_at as at
       from public.inventory i join public.shop_items s on s.id = i.item_id where i.sent_to = uid order by i.sent_at desc limit 300) x), '[]'::jsonb),
    'room', jsonb_build_object('wall', coalesce(r.wall, 'navy'), 'floor', coalesce(r.floor, 'wood'), 'slots', coalesce(r.slots, '{}'::jsonb),
                               'title', coalesce(r.title, ''), 'feature', r.feature));
end $$;

create or replace function public.save_room_v2(p_wall text, p_floor text, p_slots jsonb, p_title text default '', p_feature bigint default null) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare uid uuid := auth.uid(); k text; v text; clean jsonb := '{}'::jsonb; used bigint[] := '{}'; ttl text; feat bigint := null;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  if p_wall not in ('navy','sunset','forest','royal','neon','brick','midnight','gold','ice','steel') then p_wall := 'navy'; end if;
  if p_floor not in ('wood','turf','court','carpet','tile','marble','ice','concrete') then p_floor := 'wood'; end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'object' then p_slots := '{}'::jsonb; end if;
  for k, v in select key, value #>> '{}' from jsonb_each(p_slots) loop
    if k ~ '^[0-9]{1,2}$' and k::int between 0 and 23 and v ~ '^[0-9]{1,18}$'
       and not (v::bigint = any(used))
       and exists (select 1 from public.inventory where id = v::bigint and sent_to = uid) then
      clean := clean || jsonb_build_object(k, v::bigint); used := used || v::bigint;
    end if;
  end loop;
  ttl := left(regexp_replace(coalesce(p_title, ''), '[\r\n\t<>]', ' ', 'g'), 28);
  if p_feature is not null and exists (select 1 from public.inventory where id = p_feature and sent_to = uid) then feat := p_feature; end if;
  insert into public.vault_rooms(owner, wall, floor, slots, title, feature, updated_at) values (uid, p_wall, p_floor, clean, ttl, feat, now())
  on conflict (owner) do update set wall = excluded.wall, floor = excluded.floor, slots = excluded.slots, title = excluded.title, feature = excluded.feature, updated_at = now();
  return jsonb_build_object('ok', true, 'slots', clean, 'title', ttl, 'feature', feat);
end $$;

create or replace function public.get_room(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare r public.vault_rooms;
begin
  if auth.uid() is null then return null; end if;
  select * into r from public.vault_rooms where owner = p_user;
  return jsonb_build_object('wall', coalesce(r.wall, 'navy'), 'floor', coalesce(r.floor, 'wood'), 'title', coalesce(r.title, ''),
    'total', (select count(*) from public.inventory where sent_to = p_user),
    'value', coalesce((select sum(s.price) from public.inventory i join public.shop_items s on s.id = i.item_id where i.sent_to = p_user), 0),
    'feature', (select jsonb_build_object('emoji', s.emoji, 'name', s.name, 'from_name', (select username from public.profiles where id = i.owner))
                from public.inventory i join public.shop_items s on s.id = i.item_id where i.id = r.feature and i.sent_to = p_user),
    'items', coalesce((select jsonb_agg(jsonb_build_object('slot', e.key::int, 'emoji', s.emoji, 'name', s.name,
         'from_name', (select username from public.profiles where id = i.owner)))
       from jsonb_each(coalesce(r.slots, '{}'::jsonb)) e
       join public.inventory i on i.id = (e.value #>> '{}')::bigint and i.sent_to = p_user
       join public.shop_items s on s.id = i.item_id), '[]'::jsonb));
end $$;

do $$
declare f text;
begin
  foreach f in array array['send_item(bigint,uuid,text)', 'my_vault()', 'save_room_v2(text,text,jsonb,text,bigint)', 'get_room(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
