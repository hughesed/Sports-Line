-- Local stand-in for what a fresh Supabase project already has (roles, auth schema, default grants, realtime publication).
-- Test-only. Mirrors Supabase's definitions of auth.uid()/auth.role()/auth.jwt() and its default privileges on schema public.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit password 'authpass'; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
do $$ begin if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin; end if; end $$;
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users(
  id uuid primary key default gen_random_uuid(),
  aud text default 'authenticated', role text default 'authenticated',
  email text unique, encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_sign_in_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase default privileges: everything in public is granted to the API roles; RLS is what protects it
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
do $$ begin if not exists (select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if; end $$;
grant usage on schema auth to supabase_auth_admin;
grant all on auth.users to supabase_auth_admin;
