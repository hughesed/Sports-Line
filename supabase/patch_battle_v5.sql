-- Battle v5: winning battle parlay bonus.
-- Run after setup.sql and battle patches v2-v4. Safe to run again.

create or replace function ls_private.settle_battle_internal(p_id bigint) returns text
language plpgsql security definer set search_path = public, ls_private, pg_temp as $$
declare b public.battles; r public.battle_results; gc jsonb; go jsonb; pc numeric; po numeric; hc int; ho int; win uuid := null; lose uuid; s record;
  res text; pay numeric; split boolean := false; bonus numeric := 0;
begin
  select * into b from public.battles where id = p_id for update;
  if not found or b.status <> 'live' or b.ends_at > public.app_now() then return null; end if;
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
    perform ls_private.elo_update(b.sport, b.creator, b.opponent, 0.5);
  else
    lose := case when win = b.creator then b.opponent else b.creator end;
    -- Winning a battle also earns a 10% bonus based on the total payout of the winning parlay.
    bonus := round((case when win = b.creator then pc else po end) * 0.10, 2);
    perform ls_private.move_coins(win, b.wager * 2, 'battle_payout', 'battle ' || p_id || ' won');
    if bonus > 0 then
      perform ls_private.move_coins(win, bonus, 'battle_bonus', 'battle ' || p_id || ' · 10% parlay payout bonus');
    end if;
    perform ls_private.add_net(win, b.wager + bonus);
    perform ls_private.add_net(lose, -b.wager);
    perform ls_private.elo_update(b.sport, win, lose, 1);
    perform ls_private.streak(win, 'W'); perform ls_private.streak(lose, 'L');
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
  return 'final';
end $$;
