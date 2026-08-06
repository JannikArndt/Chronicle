-- Local-only stand-in for the parts of a Supabase project that the migration
-- leans on. Loaded by scripts/verify-sql.sh into a throwaway database so
-- 0001_sharing.sql can be run *unmodified* against a real Postgres.
--
-- This file must never run against a real project: there, all of it already
-- exists and is maintained by Supabase.
--
-- What a hosted project gives us and a bare Postgres does not:
--   * the `anon` / `authenticated` / `service_role` roles the policies target
--   * an `auth` schema with `auth.users` and `auth.uid()`
--   * the `supabase_realtime` publication
--
-- `auth.uid()` here reads the same GUC PostgREST sets from the JWT, so the
-- tests switch identity exactly the way a request does:
--   set local role authenticated; set local request.jwt.claim.sub = '<uuid>';

create extension if not exists "pgcrypto";

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Only the columns the migration references. The real table has ~30 more.
create table if not exists auth.users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  created_at    timestamptz not null default now()
);

-- PostgREST sets `request.jwt.claim.sub` per request; `true` = missing is null,
-- which is what an anonymous request looks like.
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
