-- Beta Tester CRM — fix tester edits getting bricked by admin triage.
-- Run AFTER 0006_tester_edit_own_feedback.sql.
--
-- BUG (introduced by 0005/0006): the "edit own new feedback" UPDATE policy pinned
--   tags = '{}' and merged_into is null
-- in its WITH CHECK. WITH CHECK evaluates the *post-update row* and has no access
-- to the OLD row, so it can only assert "tags is empty NOW", not "the tester didn't
-- CHANGE tags". But admins may set tags / merged_into on an item while it's still
-- status='new' (that's normal triage — tag first, move status later). The moment
-- they do, the row's tags is no longer '{}', and the submitter's next edit — even a
-- plain typo fix that never touches tags — fails the WITH CHECK and is rejected by
-- RLS. (Withdraw still worked: the DELETE policy only checks status.)
--
-- FIX: a WITH CHECK can't express "these columns are unchanged" — that needs OLD,
-- which only a trigger sees. So we split the job:
--   * The policy keeps the ROW-SCOPE rule (your own row, still untriaged).
--   * A BEFORE UPDATE trigger enforces COLUMN IMMUTABILITY for non-admin writers:
--     status / tags / merged_into / submitted_by may not change vs OLD.
-- This restores exactly the invariant 0005/0006 wanted (testers can't self-promote
-- status, seed tags, or set a merge target) without the value-equality brittleness.
--
-- The INSERT policy from 0005 is left alone: a brand-new submission has no OLD row,
-- so pinning the values directly in WITH CHECK is correct there.

-- ─────────────────────────────────────────────────────────────
-- 1. Relax the tester UPDATE policy to a pure row-scope rule.
--    (No value pins; the trigger below owns column immutability.)
-- ─────────────────────────────────────────────────────────────
drop policy if exists "edit own new feedback" on public.feedback;

create policy "edit own new feedback" on public.feedback
  for update
  using (submitted_by = auth.uid() and status = 'new')
  with check (submitted_by = auth.uid() and status = 'new');

-- ─────────────────────────────────────────────────────────────
-- 2. Lock the triage-owned columns against non-admin writers.
--
--    Bypassed by:
--      * admins        — is_admin(); they own status/tags/merged_into during triage.
--      * service role  — auth.uid() is null (SQL editor / Edge Functions, no JWT);
--                        otherwise a manual `update feedback set status=...` would
--                        trip this. anon never reaches here (RLS USING blocks it).
--
--    For everyone else (a tester editing their own row via the policy above) any
--    change to a locked column vs OLD is rejected. The normal client never hits the
--    RAISE — PostgREST only writes the columns in the request body, so the unsent
--    status/tags/merged_into keep their OLD values and compare equal. Only a direct
--    API write that *explicitly* sets a locked column gets stopped.
-- ─────────────────────────────────────────────────────────────
create or replace function public.feedback_lock_triage_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.status       is distinct from old.status
     or new.tags        is distinct from old.tags
     or new.merged_into is distinct from old.merged_into
     or new.submitted_by is distinct from old.submitted_by then
    raise exception
      'testers may not modify status, tags, merged_into, or submitted_by';
  end if;

  return new;
end;
$$;

-- Not a SECURITY DEFINER function, so EXECUTE-from-PUBLIC isn't a privilege vector;
-- it only reads OLD/NEW and calls the already-locked-down is_admin(). Pinned
-- search_path keeps the Supabase advisor quiet (consistent with 0003).
drop trigger if exists feedback_lock_triage on public.feedback;
create trigger feedback_lock_triage
  before update on public.feedback
  for each row execute function public.feedback_lock_triage_columns();
