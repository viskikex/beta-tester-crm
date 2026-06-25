-- Beta Tester CRM — enforce the merge invariants at the TABLE, for every writer.
-- Run AFTER 0010_merge_feedback_rpc.sql.
--
-- WHY: 0010 moved the dedup rules (no self-merge, target must be canonical, no
-- cycles) server-side into the merge_feedback() RPC — but only into the RPC. The
-- "admins update feedback" policy (0002) still lets an admin set feedback.merged_into
-- to ANY value through a direct PostgREST UPDATE, which bypasses those checks: a
-- hand-crafted call can point a row at itself (self-loop) or two rows at each other
-- (cycle). The FK keeps merged_into pointing at a real row, but not at a *canonical*
-- one. A self-looped row goes non-canonical with no canonical parent, so it drops out
-- of the triage list with no in-UI unmerge path. The app never does this (the triage
-- UI always merges through the RPC), but the README's thesis is that integrity holds
-- at the database against a direct API write — so this is the one spot that has to be
-- closed at the table, not the call site.
--
-- FIX: a BEFORE INSERT/UPDATE trigger that re-asserts the RPC's two structural rules.
-- Given the one-level-deep tree the RPC maintains, "target must be canonical" also
-- makes a cycle unreachable. Not SECURITY DEFINER — only admins (who see all feedback)
-- or the SECURITY DEFINER RPC reach this write path, so the canonical-check subquery
-- sees the true state either way. Pinned search_path, consistent with 0003/0009.
--
-- Existing rows aren't scanned (no merges exist that predate this, and a trigger only
-- fires on new writes); the merge_feedback RPC's own writes satisfy the rules, so this
-- is transparent to the normal merge/unmerge paths.

create or replace function public.feedback_merge_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.merged_into is not null then
    if new.merged_into = new.id then
      raise exception 'a submission cannot be merged into itself';
    end if;
    if exists (
      select 1 from public.feedback
      where id = new.merged_into and merged_into is not null
    ) then
      raise exception 'merge target must be a canonical (unmerged) submission';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_merge_guard on public.feedback;
create trigger feedback_merge_guard
  before insert or update of merged_into on public.feedback
  for each row execute function public.feedback_merge_guard();
