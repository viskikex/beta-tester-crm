-- Beta Tester CRM — a reply thread on each feedback item.
-- Run AFTER 0002_feedback_portal.sql.
--
-- WHY: a status pill is a one-way signal. When an admin declines or plans an
-- item, the submitter has no idea why. This adds a two-way thread: the admin can
-- explain, the tester can answer. That's the single biggest "I feel heard" lever
-- for a feedback portal.
--
-- The table is append-only by policy (no UPDATE/DELETE) so the conversation is an
-- honest record — you can't quietly rewrite what was said during triage.

create table if not exists public.feedback_comments (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback (id) on delete cascade,
  author      uuid not null references public.profiles (id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists feedback_comments_feedback_idx
  on public.feedback_comments (feedback_id, created_at);

alter table public.feedback_comments enable row level security;

-- Visibility / authorship both reduce to the same rule: you may touch a comment
-- iff you can see its parent feedback. Admins see everything (is_admin()), and a
-- tester sees a thread only on feedback they submitted. The EXISTS subquery runs
-- under the feedback table's own RLS, which already restricts a tester to their
-- own rows — so no SECURITY DEFINER and no cross-table recursion is needed.
create policy "read comments on visible feedback" on public.feedback_comments
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.feedback f
      where f.id = feedback_id and f.submitted_by = auth.uid()
    )
  );

-- Insert as yourself, and only onto a thread you're allowed to see.
create policy "comment on visible feedback" on public.feedback_comments
  for insert with check (
    author = auth.uid()
    and (
      public.is_admin()
      or exists (
        select 1 from public.feedback f
        where f.id = feedback_id and f.submitted_by = auth.uid()
      )
    )
  );

-- No UPDATE/DELETE policies: comments are immutable once posted.
