-- Beta Tester CRM — security hardening for the 0002 functions.
-- Run AFTER 0002_feedback_portal.sql.
--
-- These address Supabase's database linter (Security advisor) warnings.
-- Migrations are append-only: rather than editing 0002 in place, we layer the
-- fixes here so the applied history stays honest.

-- 1. Pin search_path on the updated_at trigger helper (the other two functions
--    in 0002 already do this; this one was missed). A mutable search_path on a
--    function is a privilege-escalation vector.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- NOTE: Postgres grants EXECUTE to the special role PUBLIC by default on every
-- function, and anon/authenticated inherit from PUBLIC. So revoking from those
-- roles alone is a no-op — you must revoke from PUBLIC, then grant back only
-- what's genuinely needed. That's the whole trick below.

-- 2. handle_new_user() is a trigger function — it fires as the table owner on
--    INSERT into auth.users regardless of role grants. Nothing should reach it
--    as a PostgREST RPC, so strip EXECUTE entirely.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 3. is_admin() must stay callable by `authenticated` — the RLS policies on
--    profiles/feedback evaluate it as the signed-in user, which requires the
--    EXECUTE privilege. Revoke from everyone, then grant back just authenticated.
revoke execute on function public.is_admin() from public, anon, authenticated;
grant  execute on function public.is_admin() to authenticated;
