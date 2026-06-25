-- Beta Tester CRM — InitPlan-optimize every RLS policy.
-- Run AFTER 0012_feedback_merge_guard.sql.
--
-- WHY: auth.uid() and public.is_admin() are STABLE, but inside an RLS policy Postgres
-- re-invokes them once PER ROW. Wrapping each call in a scalar subquery —
-- (select auth.uid()), (select public.is_admin()) — lets the planner hoist it into an
-- InitPlan evaluated ONCE per statement. Identical results, far fewer calls at scale;
-- this clears Supabase's "auth_rls_initplan" performance advisor on every policy.
-- Behavior is unchanged (rls_smoke.sql exercises all of these and proves it) — we just
-- drop and recreate each policy with the calls wrapped. Roles/clauses are preserved
-- exactly (storage policies stay `to authenticated`; the public-schema ones stay
-- role-unscoped, i.e. apply to anon+authenticated, with anon's null uid matching nothing).

-- ── public.testers / public.sessions (0001) ──────────────────────────────────
drop policy if exists "own testers" on public.testers;
create policy "own testers" on public.testers
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);

drop policy if exists "own sessions" on public.sessions;
create policy "own sessions" on public.sessions
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);

-- ── public.profiles (0002) ───────────────────────────────────────────────────
drop policy if exists "read own profile or admin reads all" on public.profiles;
create policy "read own profile or admin reads all" on public.profiles
  for select using ((id = (select auth.uid())) or (select public.is_admin()));

-- ── public.feedback (0002 / 0005 / 0006 / 0009) ──────────────────────────────
drop policy if exists "read own feedback or admin reads all" on public.feedback;
create policy "read own feedback or admin reads all" on public.feedback
  for select using ((submitted_by = (select auth.uid())) or (select public.is_admin()));

drop policy if exists "submit own feedback" on public.feedback;
create policy "submit own feedback" on public.feedback
  for insert with check (
    submitted_by = (select auth.uid())
    and status = 'new'
    and tags = '{}'::text[]
    and merged_into is null
  );

drop policy if exists "admins update feedback" on public.feedback;
create policy "admins update feedback" on public.feedback
  for update using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "admins delete feedback" on public.feedback;
create policy "admins delete feedback" on public.feedback
  for delete using ((select public.is_admin()));

drop policy if exists "edit own new feedback" on public.feedback;
create policy "edit own new feedback" on public.feedback
  for update
  using (submitted_by = (select auth.uid()) and status = 'new')
  with check (submitted_by = (select auth.uid()) and status = 'new');

drop policy if exists "delete own new feedback" on public.feedback;
create policy "delete own new feedback" on public.feedback
  for delete using (submitted_by = (select auth.uid()) and status = 'new');

-- ── public.feedback_comments (0007) ──────────────────────────────────────────
drop policy if exists "read comments on visible feedback" on public.feedback_comments;
create policy "read comments on visible feedback" on public.feedback_comments
  for select using (
    (select public.is_admin())
    or exists (
      select 1 from public.feedback f
      where f.id = feedback_id and f.submitted_by = (select auth.uid())
    )
  );

drop policy if exists "comment on visible feedback" on public.feedback_comments;
create policy "comment on visible feedback" on public.feedback_comments
  for insert with check (
    author = (select auth.uid())
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.feedback f
        where f.id = feedback_id and f.submitted_by = (select auth.uid())
      )
    )
  );

-- ── storage.objects, screenshots bucket (0008) ───────────────────────────────
drop policy if exists "upload own screenshots" on storage.objects;
create policy "upload own screenshots" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "read own or admin screenshots" on storage.objects;
create policy "read own or admin screenshots" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'screenshots'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_admin())
    )
  );

drop policy if exists "delete own screenshots" on storage.objects;
create policy "delete own screenshots" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
