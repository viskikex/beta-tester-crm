-- Beta Tester CRM — let testers fix or withdraw their own feedback before triage.
-- Run AFTER 0002_feedback_portal.sql (and after 0005, which it complements).
--
-- WHY: 0002 gave testers INSERT + SELECT on their own feedback but no UPDATE or
-- DELETE — a typo was permanent. These two policies let a tester edit body/type/
-- screenshot_url or withdraw a submission, but ONLY while it's still untriaged
-- (status='new'). The WITH CHECK pins the admin-only columns so a tester can't
-- self-promote status, seed tags, or set a merge target through the edit path —
-- the same invariants 0005 enforces at INSERT. Postgres ORs permissive policies,
-- so the existing "admins update feedback"/"admins delete feedback" policies are
-- unaffected; admins still triage anything.
--
-- screenshot_url edits remain subject to the 0004 http(s) check constraint.

create policy "edit own new feedback" on public.feedback
  for update
  using (submitted_by = auth.uid() and status = 'new')
  with check (
    submitted_by = auth.uid()
    and status = 'new'
    and tags = '{}'
    and merged_into is null
  );

create policy "delete own new feedback" on public.feedback
  for delete
  using (submitted_by = auth.uid() and status = 'new');
