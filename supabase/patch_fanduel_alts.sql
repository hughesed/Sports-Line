-- FanDuel alternate totals priced at FanDuel's own price. Run ONCE after patch_soccer.sql. Safe to run twice.
-- The bot now writes FanDuel's alternate game totals into games.lines.altTot ({"over": {"7.5": -400}, "under": {...}}). A practice bet on an alternate
-- total takes that price; only a line FanDuel does not list falls back to the estimate (the page no longer offers those).
-- Player alternate lines ("125+ pass yds") need no change here: the bot puts FanDuel's rungs and prices on the player's ladder (props.stats.miles), which
-- resolve_leg already prices from.
do $fd$
declare src text;
begin
  src := pg_get_functiondef('ls_private.resolve_leg(jsonb)'::regprocedure);
  if src not like '%altTot%' then
    src := replace(src, '          if g.lines ->> ''total'' is null then raise exception ''No total for this game''; end if;',
      '          o := g.lines -> ''altTot'' -> side -> ls_private.num_txt(ln);
          if o is not null then
            price := (o #>> ''{}'')::int; lbl := initcap(side) || '' '' || ls_private.num_txt(ln) || '' (alt total)'';
            return jsonb_build_object(''tok'', tok, ''gid'', g.gid, ''label'', lbl, ''price'', price, ''live'', false, ''grp'', g.gid || '':tot'', ''spec'', jsonb_build_object(''k'', ''tot'', ''dir'', side, ''line'', ln));
          end if;
          if g.lines ->> ''total'' is null then raise exception ''No total for this game''; end if;');
    if src not like '%altTot%' then raise exception 'resolve_leg: expected text not found, nothing changed'; end if;
    execute src;
  end if;
end $fd$;
