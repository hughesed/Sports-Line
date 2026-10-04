-- Run once in the Supabase SQL editor if you already ran setup.sql: the opponent now always gets the team the creator did not pick.
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
  side := case b.creator_side when 'home' then 'away' else 'home' end;      -- the creator picks first; the opponent always gets the other team (p_side is ignored)
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
