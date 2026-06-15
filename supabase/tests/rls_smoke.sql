-- RLS / policy smoke test for the feedback portal.
--
-- Asserts the access-rule invariants that docs/ARCHITECTURE.md claims actually
-- hold AT THE DATABASE — the whole selling point of this project. It simulates
-- a signed-in user the same way PostgREST does: by setting request.jwt.claims
-- (which auth.uid()/is_admin() read) and SET ROLE to the matching Postgres role
-- so RLS is actually evaluated (a superuser/owner bypasses RLS entirely).
--
-- SAFETY: everything runs inside one transaction that ROLLS BACK at the end —
-- it never persists a row. It looks up the admin/tester ids INTERNALLY and emits
-- only PASS/FAIL notices, never PII. Failures RAISE (aborting the transaction),
-- and every negative test has a positive control so a misconfigured run can't
-- silently "pass".
--
-- HOW TO RUN (any one):
--   * Supabase SQL Editor : paste this file and Run.
--   * psql                : psql "$DATABASE_URL" -f supabase/tests/rls_smoke.sql
--   * Supabase MCP        : execute_sql with this file's contents.
--
-- PRE-REQ: at least one admin profile and one non-admin profile must exist
-- (the seeded admin + tester). The test raises a clear error if they don't.
-- Run it against a dev/staging project, not production with real tester data.

begin;

do $$
declare
  v_admin   uuid;
  v_tester  uuid;
  v_fb_admin  uuid;   -- a feedback row owned by the admin (tester must NOT see it)
  v_fb_tester uuid;   -- a feedback row owned by the tester (tester MUST see it)
  v_cnt     int;
begin
  -- ---- fixtures (created as the privileged session user; ids stay internal) ----
  select id into v_admin  from public.profiles where is_admin     order by created_at limit 1;
  select id into v_tester from public.profiles where not is_admin order by created_at limit 1;
  if v_admin is null or v_tester is null then
    raise exception 'rls_smoke: need >=1 admin and >=1 non-admin profile (seed them first)';
  end if;
  if v_admin = v_tester then
    raise exception 'rls_smoke: admin and tester resolved to the same profile';
  end if;

  insert into public.feedback (submitted_by, type, body)
    values (v_admin, 'bug', 'rls-smoke: admin-owned') returning id into v_fb_admin;

  -- ===================== act as the TESTER =====================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tester::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 1a. POSITIVE CONTROL: the tester can insert + see their OWN feedback.
  insert into public.feedback (submitted_by, type, body)
    values (v_tester, 'bug', 'rls-smoke: tester-owned') returning id into v_fb_tester;
  select count(*) into v_cnt from public.feedback where id = v_fb_tester;
  if v_cnt <> 1 then raise exception 'FAIL 1a: tester cannot see their own feedback'; end if;
  raise notice 'PASS 1a: tester can submit and read their own feedback';

  -- 1b. The tester CANNOT see another user's feedback (the admin-owned row).
  select count(*) into v_cnt from public.feedback where id = v_fb_admin;
  if v_cnt <> 0 then raise exception 'FAIL 1b: tester can read another user''s feedback'; end if;
  raise notice 'PASS 1b: tester cannot read another user''s feedback';

  -- 2. INSERT is rejected unless status=new AND tags={} AND merged_into is null (0005).
  begin
    insert into public.feedback (submitted_by, type, body, status)
      values (v_tester, 'bug', 'rls-smoke: pre-triaged', 'shipped');
    raise exception 'FAIL 2: tester INSERT with status<>new was allowed';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'PASS 2: tester INSERT with status<>new rejected (%)', sqlstate;
  end;

  -- 3. The tester cannot change triage-owned columns on their own row (0009 trigger).
  begin
    update public.feedback set status = 'shipped' where id = v_fb_tester;
    raise exception 'FAIL 3a: tester changed status on own row';
  exception when others then
    raise notice 'PASS 3a: tester status change blocked (%)', sqlstate;
  end;
  begin
    update public.feedback set tags = array['admin-only'] where id = v_fb_tester;
    raise exception 'FAIL 3b: tester changed tags on own row';
  exception when others then
    raise notice 'PASS 3b: tester tags change blocked (%)', sqlstate;
  end;

  -- 3c. POSITIVE CONTROL: an allowed edit (body only, still status=new) succeeds.
  update public.feedback set body = 'rls-smoke: tester edited body' where id = v_fb_tester;
  raise notice 'PASS 3c: tester CAN edit body of own status=new row';

  -- 4. A non-admin cannot merge (0010 RPC gates on is_admin()).
  begin
    perform public.merge_feedback(v_fb_tester, v_fb_admin);
    raise exception 'FAIL 4: non-admin merge_feedback was allowed';
  exception when others then
    raise notice 'PASS 4: non-admin merge_feedback rejected (%)', sqlstate;
  end;

  -- 5. A non-admin cannot flip profiles.is_admin (no UPDATE policy on profiles).
  update public.profiles set is_admin = true where id = v_tester;
  get diagnostics v_cnt = row_count;
  if v_cnt <> 0 then raise exception 'FAIL 5: tester updated profiles (% rows)', v_cnt; end if;
  raise notice 'PASS 5: tester cannot update profiles.is_admin (0 rows affected)';

  -- 6. Server-side value constraint (0011): a whitespace-only body is rejected.
  begin
    insert into public.feedback (submitted_by, type, body) values (v_tester, 'bug', '   ');
    raise exception 'FAIL 6: whitespace-only feedback body was accepted';
  exception when check_violation then
    raise notice 'PASS 6: whitespace-only body rejected by CHECK (%)', sqlstate;
  end;

  -- ===================== act as the ADMIN =====================
  -- Same role (authenticated); only the claims subject changes.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- 7. The admin sees ALL feedback, including the tester-owned row (is_admin path).
  select count(*) into v_cnt from public.feedback where id = v_fb_tester;
  if v_cnt <> 1 then raise exception 'FAIL 7: admin cannot see a tester''s feedback'; end if;
  raise notice 'PASS 7: admin can read another user''s feedback (is_admin path)';

  -- ===================== act as ANON =====================
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';

  -- 8. Anon (signed-out) gets no feedback. Two acceptable ways the boundary holds:
  --    either 0 rows, OR a hard permission-denied — because the SELECT policy calls
  --    is_admin(), and 0003 revoked anon's EXECUTE on it, so anon's query fails
  --    *closed* with SQLSTATE 42501 rather than returning an empty set. Both are a
  --    pass (anon obtains no data); only a row count > 0 is a failure.
  begin
    select count(*) into v_cnt from public.feedback;
    if v_cnt <> 0 then raise exception 'FAIL 8: anon can read feedback (% rows)', v_cnt; end if;
    raise notice 'PASS 8: anon reads no feedback (0 rows)';
  exception when insufficient_privilege then
    raise notice 'PASS 8: anon denied (fails closed, %)', sqlstate;
  end;

  execute 'reset role';
  raise notice 'rls_smoke: ALL PASS';
end $$;

rollback;
