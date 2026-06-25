-- Beta Tester CRM — initial schema
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- This is private CRM data: every row is scoped to its owner (the signed-in
-- program manager), and RLS makes that scoping the database's job, not the app's.

-- ─────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────

create table if not exists public.testers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text not null,
  role         text,          -- e.g. "PM", "Engineer", "Designer"
  organization text,
  status       text not null default 'prospect'
               check (status in ('prospect','invited','active','inactive')),
  source       text,          -- how we found them (referral, conference, etc.)
  notes        text,
  owner        uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now()
);

create table if not exists public.sessions (
  id           uuid primary key default gen_random_uuid(),
  tester_id    uuid not null references public.testers (id) on delete cascade,
  scheduled_at timestamptz not null,
  status       text not null default 'scheduled'
               check (status in ('scheduled','completed','no_show','canceled')),
  notes        text,
  owner        uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now()
);

-- (The feedback portal — testers + admins — lives in 0002_feedback_portal.sql.)

create index if not exists testers_owner_idx   on public.testers (owner);
create index if not exists sessions_tester_idx on public.sessions (tester_id);
create index if not exists sessions_when_idx   on public.sessions (scheduled_at);

-- ─────────────────────────────────────────────────────────────
-- Row-Level Security — owner sees and touches only their own rows.
-- ─────────────────────────────────────────────────────────────

alter table public.testers  enable row level security;
alter table public.sessions enable row level security;

-- A single policy per table covering all verbs, keyed on owner = auth.uid().
create policy "own testers"  on public.testers
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

create policy "own sessions" on public.sessions
  for all using (auth.uid() = owner) with check (auth.uid() = owner);
