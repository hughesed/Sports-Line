-- Profile pictures. Run once in the Supabase SQL editor (safe to run twice). Not yet run against a real database.
alter table public.profiles add column if not exists avatar text;
create or replace function public.set_avatar(p_avatar text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_avatar is not null and (p_avatar !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' or length(p_avatar) > 40000) then raise exception 'That picture is too large'; end if;
  update public.profiles set avatar = p_avatar where id = auth.uid();
end $$;
create or replace function public.get_avatars(p_names text[]) returns table(username text, avatar text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.username, p.avatar from public.profiles p
  where p.avatar is not null and lower(p.username) in (select lower(x) from unnest(p_names) x) limit 60
$$;
grant execute on function public.set_avatar(text) to authenticated;
grant execute on function public.get_avatars(text[]) to anon, authenticated;
notify pgrst, 'reload schema';
