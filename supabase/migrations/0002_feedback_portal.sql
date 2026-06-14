-- Beta Tester CRM — two-sided feedback portal
-- Run AFTER 0001_init.sql, in the Supabase SQL Editor.
--
-- Adds:
--   * profiles      — one row per auth user, with an is_admin flag
--   * is_admin()    — a SECURITY DEFINER helper RLS can call without recursing
--   * feedback      — tester submissions; testers see their own, admins see all
--
-- ┌─ How to make yourself an admin ──────────────────────────────────────────┐
-- │  1. Sign up in the app (creates your auth user + profile row).            │
-- │  2. Run:  update public.profiles set is_admin = true where email = 'you'; │
-- └────────────────────────────────────────────────────────────────────────┘

-- ─────────────────────────────────────────────────────────────
-- profiles: mirrors auth.users, auto-populated by a trigger.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

-- Create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- is_admin(): the crux of role-based RLS.
--
-- It reads profiles, and the profiles SELECT policy below calls it — so if it
-- ran under the caller's RLS it would recurse forever. SECURITY DEFINER makes
-- it run as the owner (bypassing RLS on profiles), which breaks the cycle.
-- The pinned search_path is the standard hardening for SECURITY DEFINER fns.
-- ─────────────────────────────────────────────────────────────

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- feedback: the two-sided table.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.feedback (
  id             uuid primary key default gen_random_uuid(),
  submitted_by   uuid not null references public.profiles (id) on delete cascade,
  type           text not null default 'bug'
                 check (type in ('bug','confusion','request')),
  body           text not null,
  screenshot_url text,
  status         text not null default 'new'
                 check (status in ('new','triaged','planned','shipped','declined')),
  tags           text[] not null default '{}',
  -- Dedup: an admin points a duplicate at its canonical submission.
  merged_into    uuid references public.feedback (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists feedback_submitter_idx on public.feedback (submitted_by);
create index if not exists feedback_status_idx    on public.feedback (status);
create index if not exists feedback_tags_idx       on public.feedback using gin (tags);

-- bump updated_at on every change
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists feedback_touch on public.feedback;
create trigger feedback_touch
  before update on public.feedback
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Row-Level Security
-- ─────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.feedback enable row level security;

-- profiles: you can read your own row; admins can read everyone's (needed to
-- show submitter emails in the triage view). No UPDATE policy — is_admin is
-- flipped via the SQL editor (service role), not from the app.
create policy "read own profile or admin reads all" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

-- feedback:
--   SELECT — a tester sees only their own; an admin sees all.
--   INSERT — you can only submit as yourself.
--   UPDATE/DELETE — admins only. Once submitted, only an admin triages it.
--     (Letting testers edit their own row would need column-level rules — a
--      trigger — to stop them self-setting status='shipped'. Out of scope.)
create policy "read own feedback or admin reads all" on public.feedback
  for select using (submitted_by = auth.uid() or public.is_admin());

create policy "submit own feedback" on public.feedback
  for insert with check (submitted_by = auth.uid());

create policy "admins update feedback" on public.feedback
  for update using (public.is_admin()) with check (public.is_admin());

create policy "admins delete feedback" on public.feedback
  for delete using (public.is_admin());
