-- Beta Tester CRM — lock down what a tester may set when submitting feedback.
-- Run AFTER 0002_feedback_portal.sql.
--
-- WHY: the original "submit own feedback" INSERT policy only checked
--   submitted_by = auth.uid()
-- and left status / tags / merged_into unconstrained. A tester (any
-- authenticated user) could insert with status='shipped'/'declined' (evading the
-- dashboard's status='new' triage count), seed arbitrary tags, or point
-- merged_into at any feedback id (the FK check bypasses RLS). Triage is supposed
-- to be admin-only — that has to be enforced at the INSERT boundary, not just on
-- UPDATE. New submissions must start clean; admins move them from there.

drop policy if exists "submit own feedback" on public.feedback;

create policy "submit own feedback" on public.feedback
  for insert with check (
    submitted_by = auth.uid()
    and status = 'new'
    and tags = '{}'
    and merged_into is null
  );

-- The admin UPDATE policy ("admins update feedback") is unchanged, so admins
-- still set status/tags/merged_into during triage. Only the tester-facing INSERT
-- path is tightened.
