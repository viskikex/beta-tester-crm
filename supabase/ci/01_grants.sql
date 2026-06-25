-- Table-level privileges for anon/authenticated on the public schema.
--
-- A hosted Supabase project extends these to new tables automatically (the
-- platform sets default privileges); a bare supabase/postgres container may not
-- extend them to the tables our migrations create. RLS still does the real access
-- control — these grants are only the coarse layer PostgREST needs before a policy
-- is even evaluated.
--
-- IMPORTANT: TABLE privileges only. Function EXECUTE grants are left ENTIRELY to
-- the migrations — 0003 deliberately revokes is_admin() from anon so anon fails
-- CLOSED (rls_smoke test 8 asserts exactly that), and 0010 grants merge_feedback
-- to authenticated. Re-granting routines here would undo 0003 and turn a
-- fails-closed assertion into a fails-open one. Don't add `grant ... on routines`.

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;

-- Storage: a hosted project grants these on storage.objects automatically; the bare
-- image does not, so the per-user folder RLS from 0008 (tested in rls_smoke) would
-- fail CLOSED on a missing table grant rather than exercising the policy. Grant the
-- coarse layer to authenticated only — anon gets nothing, so the "anon sees no
-- screenshots" assertion still holds (RLS has no anon policy either way). Table
-- privileges only; storage.foldername() keeps its default PUBLIC execute.
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
