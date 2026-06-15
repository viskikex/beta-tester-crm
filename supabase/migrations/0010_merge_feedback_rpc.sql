-- Beta Tester CRM — atomic feedback merge.
-- Run AFTER 0002_feedback_portal.sql.
--
-- WHY: the app used to merge a duplicate in two separate writes — set
-- source.merged_into = target, then reparent the source's own duplicates onto
-- target. If the first succeeded and the second failed (or vice versa), the dupe
-- tree corrupted: children yanked onto target while the source stayed canonical,
-- and rows vanished from the UI. The no-cycle / canonical-target rules were also
-- client-side only, so a direct API call could bypass them.
--
-- FIX: one SECURITY DEFINER function that does both updates in a single
-- transaction (a function body is atomic) and enforces the invariants server-side.
-- Mirrors the is_admin() definer pattern already used in 0002.

create or replace function public.merge_feedback(src uuid, target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Triage is admin-only; the definer context bypasses RLS, so this gate is the
  -- access control (same check the "admins update feedback" policy makes).
  if not public.is_admin() then
    raise exception 'only admins may merge feedback';
  end if;

  if src = target then
    raise exception 'cannot merge a submission into itself';
  end if;

  if not exists (select 1 from public.feedback where id = src) then
    raise exception 'source feedback % not found', src;
  end if;

  -- Target must exist AND be canonical. Because src's own duplicates carry
  -- merged_into = src (non-canonical), this also makes a cycle impossible without
  -- a separate reachability check, given the one-level-deep tree invariant.
  if not exists (
    select 1 from public.feedback where id = target and merged_into is null
  ) then
    raise exception 'merge target must be an existing canonical submission';
  end if;

  -- Both writes in one body == one transaction: either the whole merge lands or
  -- none of it does.
  update public.feedback set merged_into = target where id = src;
  update public.feedback set merged_into = target where merged_into = src;
end;
$$;

-- Strip the default PUBLIC execute grant, hand it back only to authenticated.
-- (anon never reaches it; the is_admin() gate handles authorization within.)
revoke execute on function public.merge_feedback(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.merge_feedback(uuid, uuid) to authenticated;
