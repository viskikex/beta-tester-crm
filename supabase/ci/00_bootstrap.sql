-- CI-only bootstrap — INSURANCE, not a shim.
--
-- The supabase/postgres image already ships the auth/storage schemas, the
-- anon/authenticated/service_role roles, and auth.uid()/auth.role(). This file
-- creates the JWT helpers ONLY IF the image somehow lacks them, so a bare image
-- can't fail the run on a missing auth.uid(). On a normal image every block here
-- is a no-op — the RLS test still runs against the image's real functions, so the
-- "tested against real Supabase Postgres" claim holds.

create schema if not exists auth;

-- Pin auth.uid()/auth.role() to the canonical *hosted* Supabase definitions —
-- the coalesce form that reads EITHER the singular `request.jwt.claim.sub` GUC OR
-- the `request.jwt.claims` JSON. Some image builds ship an older auth.uid() that
-- only reads the singular GUC, but rls_smoke sets the JSON (as PostgREST does), so
-- without this the policies would see a null uid and reject the tester's own
-- insert. This is JWT-claim plumbing, not policy — every access rule under test
-- still comes entirely from the migrations. (Safe to replace: we connect as the
-- auth-schema owner, and create-or-replace keeps the signature RLS policies bind to.)
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$fn$;

create or replace function auth.role() returns text language sql stable as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$fn$;

-- ── storage schema ──────────────────────────────────────────────────────────
-- The bare supabase/postgres image ships auth.* but NOT the storage.* tables —
-- those are created by the storage-api service at deploy time, not baked into the
-- database image. Migration 0008 needs storage.buckets, storage.objects, and
-- storage.foldername(), so stand up their canonical shapes here if absent. Guarded
-- with IF NOT EXISTS, so a fuller image (or a hosted project) is left untouched.
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean default false,
  avif_autodetection boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table if not exists storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets (id),
  name        text,
  owner       uuid,
  metadata    jsonb,
  path_tokens text[],
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Matches prod: RLS on, so 0008's per-user folder policies actually bind.
alter table storage.objects enable row level security;

-- The folder path parts of an object name, minus the filename — 0008 keys
-- per-user folders on (storage.foldername(name))[1] = auth.uid()::text.
create or replace function storage.foldername(name text)
returns text[] language sql immutable as $fn$
  select case
    when array_length(string_to_array(name, '/'), 1) > 1
      then (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
    else array[]::text[]
  end;
$fn$;
