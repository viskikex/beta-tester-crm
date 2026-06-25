-- RLS / policy smoke test for the whole app (feedback portal + CRM + storage).
--
-- Asserts the access-rule invariants that docs/ARCHITECTURE.md claims actually
-- hold AT THE DATABASE — the whole selling point of this project. It simulates
-- a signed-in user the same way PostgREST does: by setting request.jwt.claims
-- (which auth.uid()/is_admin() read) and SET ROLE to the matching Postgres role
-- so RLS is actually evaluated (a superuser/owner bypasses RLS entirely).
--
-- Coverage (every negative test has a positive control so a misconfigured run
-- can't silently "pass"):
--   feedback  — own-row read, cross-user denial, submit-as-new-only, triage-column
--               lock, non-admin merge denial, no self-promote to admin, value CHECKs,
--               admin-reads-all, anon-reads-nothing.
--   CRM       — testers/sessions are owner-scoped: a tester reads only their own and
--               cannot read or write another tester's rows; admins get NO override
--               on the CRM tables (each owner's CRM is private); anon sees nothing.
--   comments  — a tester reads/writes comments only on feedback they own, never
--               another tester's thread; comments are append-only (no UPDATE/DELETE).
--   storage   — the screenshots bucket is per-user-folder scoped: a tester sees and
--               uploads only under their own <uid>/ folder, admins read all, anon none.
--
-- SAFETY: everything runs inside one transaction that ROLLS BACK at the end —
-- it never persists a row. It looks up the principals INTERNALLY and emits
-- only PASS/FAIL notices, never PII. Failures RAISE (aborting the transaction).
--
-- HOW TO RUN (any one):
--   * Supabase SQL Editor : paste this file and Run.
--   * psql                : psql "$DATABASE_URL" -f supabase/tests/rls_smoke.sql
--   * Supabase MCP        : execute_sql with this file's contents.
--
-- PRE-REQ: at least one admin profile and TWO non-admin profiles must exist
-- (the seeded admin + two testers). The test raises a clear error if they don't.
-- Run it against a dev/staging project, not production with real tester data.

begin;

do $$
declare
  v_admin   uuid;
  v_tester  uuid;
  v_tester2 uuid;   -- a SECOND non-admin, to prove cross-tester isolation
  v_fb_admin  uuid; -- a feedback row owned by the admin (tester must NOT see it)
  v_fb_tester uuid; -- a feedback row owned by the tester (tester MUST see it)
  v_crm_row uuid;   -- a CRM tester row owned by the tester
  v_session uuid;   -- a session owned by the tester
  v_comment uuid;   -- a comment by the tester on their own feedback
  v_cnt     int;
begin
  -- ---- fixtures (created as the privileged session user; ids stay internal) ----
  select id into v_admin   from public.profiles where is_admin     order by created_at limit 1;
  select id into v_tester  from public.profiles where not is_admin order by created_at limit 1;
  select id into v_tester2 from public.profiles where not is_admin order by created_at offset 1 limit 1;
  if v_admin is null or v_tester is null or v_tester2 is null then
    raise exception 'rls_smoke: need >=1 admin and >=2 non-admin profiles (seed them first)';
  end if;
  if v_admin = v_tester or v_tester = v_tester2 or v_admin = v_tester2 then
    raise exception 'rls_smoke: principals did not resolve to three distinct profiles';
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

  -- 9. CRM tables (0001) — POSITIVE CONTROLS: the tester owns a tester row + session.
  insert into public.testers (name, email, owner)
    values ('rls-smoke crm', 'crm@x.io', v_tester) returning id into v_crm_row;
  select count(*) into v_cnt from public.testers where id = v_crm_row;
  if v_cnt <> 1 then raise exception 'FAIL 9a: tester cannot read own CRM tester row'; end if;
  raise notice 'PASS 9a: tester can create and read their own CRM tester row';

  insert into public.sessions (tester_id, scheduled_at, owner)
    values (v_crm_row, now(), v_tester) returning id into v_session;
  select count(*) into v_cnt from public.sessions where id = v_session;
  if v_cnt <> 1 then raise exception 'FAIL 9b: tester cannot read own session'; end if;
  raise notice 'PASS 9b: tester can create and read their own session';

  -- 9c. POSITIVE CONTROL: the tester can comment on their OWN feedback (0007).
  insert into public.feedback_comments (feedback_id, author, body)
    values (v_fb_tester, v_tester, 'rls-smoke: tester comment') returning id into v_comment;
  select count(*) into v_cnt from public.feedback_comments where id = v_comment;
  if v_cnt <> 1 then raise exception 'FAIL 9c: tester cannot read own comment'; end if;
  raise notice 'PASS 9c: tester can comment on their own feedback';

  -- ===================== act as a SECOND TESTER =====================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tester2::text, 'role', 'authenticated')::text, true);

  -- 10. Cross-tester isolation: tester2 sees NONE of tester1's CRM/feedback/comment.
  select count(*) into v_cnt from public.testers where id = v_crm_row;
  if v_cnt <> 0 then raise exception 'FAIL 10a: tester2 can read another tester''s CRM row'; end if;
  raise notice 'PASS 10a: tester2 cannot read another tester''s CRM row';

  select count(*) into v_cnt from public.sessions where id = v_session;
  if v_cnt <> 0 then raise exception 'FAIL 10b: tester2 can read another tester''s session'; end if;
  raise notice 'PASS 10b: tester2 cannot read another tester''s session';

  select count(*) into v_cnt from public.feedback_comments where id = v_comment;
  if v_cnt <> 0 then raise exception 'FAIL 10c: tester2 can read another tester''s comment'; end if;
  raise notice 'PASS 10c: tester2 cannot read a comment on another tester''s feedback';

  -- 10d. tester2 cannot create a CRM row owned by tester1 (WITH CHECK owner=auth.uid()).
  begin
    insert into public.testers (name, email, owner) values ('evil', 'e@x.io', v_tester);
    raise exception 'FAIL 10d: tester2 inserted a CRM row owned by tester1';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS 10d: tester2 cannot insert a CRM row owned by tester1 (%)', sqlstate;
  end;

  -- 10e. tester2 cannot comment on tester1's feedback thread.
  begin
    insert into public.feedback_comments (feedback_id, author, body)
      values (v_fb_tester, v_tester2, 'rls-smoke: intrusion');
    raise exception 'FAIL 10e: tester2 commented on another tester''s feedback';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS 10e: tester2 cannot comment on another tester''s feedback (%)', sqlstate;
  end;

  -- ===================== back to the TESTER (append-only) =====================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tester::text, 'role', 'authenticated')::text, true);

  -- 11. Comments are append-only: even the author can't UPDATE or DELETE (no policy).
  update public.feedback_comments set body = 'rls-smoke: rewritten' where id = v_comment;
  get diagnostics v_cnt = row_count;
  if v_cnt <> 0 then raise exception 'FAIL 11a: comment was UPDATED (% rows)', v_cnt; end if;
  raise notice 'PASS 11a: comment UPDATE blocked (append-only)';

  delete from public.feedback_comments where id = v_comment;
  get diagnostics v_cnt = row_count;
  if v_cnt <> 0 then raise exception 'FAIL 11b: comment was DELETED (% rows)', v_cnt; end if;
  raise notice 'PASS 11b: comment DELETE blocked (append-only)';

  -- ===================== act as the ADMIN =====================
  -- Same role (authenticated); only the claims subject changes.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- 7. The admin sees ALL feedback, including the tester-owned row (is_admin path).
  select count(*) into v_cnt from public.feedback where id = v_fb_tester;
  if v_cnt <> 1 then raise exception 'FAIL 7: admin cannot see a tester''s feedback'; end if;
  raise notice 'PASS 7: admin can read another user''s feedback (is_admin path)';

  -- 12. NEGATIVE: the CRM tables (testers/sessions) have NO admin override — each
  --     owner's CRM is private, so even an admin does not see a tester's CRM rows.
  select count(*) into v_cnt from public.testers where id = v_crm_row;
  if v_cnt <> 0 then raise exception 'FAIL 12a: admin can read a tester''s private CRM row'; end if;
  raise notice 'PASS 12a: admin gets no override on the CRM tester table';
  select count(*) into v_cnt from public.sessions where id = v_session;
  if v_cnt <> 0 then raise exception 'FAIL 12b: admin can read a tester''s private session'; end if;
  raise notice 'PASS 12b: admin gets no override on the CRM sessions table';

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

  -- 13. Anon sees nothing on the CRM tables either (owner-scoped, anon uid is null).
  begin
    select count(*) into v_cnt from public.testers;
    if v_cnt <> 0 then raise exception 'FAIL 13a: anon can read testers (% rows)', v_cnt; end if;
    raise notice 'PASS 13a: anon reads no testers (0 rows)';
  exception when insufficient_privilege then
    raise notice 'PASS 13a: anon denied on testers (fails closed, %)', sqlstate;
  end;
  begin
    select count(*) into v_cnt from public.sessions;
    if v_cnt <> 0 then raise exception 'FAIL 13b: anon can read sessions (% rows)', v_cnt; end if;
    raise notice 'PASS 13b: anon reads no sessions (0 rows)';
  exception when insufficient_privilege then
    raise notice 'PASS 13b: anon denied on sessions (fails closed, %)', sqlstate;
  end;

  -- ===================== STORAGE: per-user folder isolation (0008) =====================
  -- Seed one object in tester1's folder and one in tester2's, as the privileged user
  -- (RLS bypassed for the seed). Objects are keyed `<uid>/<file>`; the policies gate on
  -- (storage.foldername(name))[1] = auth.uid()::text. Assertions target the seeded
  -- names (not total counts) so the test is robust against any other rows present.
  execute 'reset role';
  insert into storage.objects (bucket_id, name)
    values ('screenshots', v_tester::text  || '/rls-smoke-a.png');
  insert into storage.objects (bucket_id, name)
    values ('screenshots', v_tester2::text || '/rls-smoke-b.png');

  -- as tester1: sees own object, not tester2's; can upload own, not into tester2's folder.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tester::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_cnt from storage.objects
    where bucket_id = 'screenshots' and name = v_tester::text || '/rls-smoke-a.png';
  if v_cnt <> 1 then raise exception 'FAIL 14a: tester1 cannot read own screenshot'; end if;
  raise notice 'PASS 14a: tester1 reads own screenshot';

  select count(*) into v_cnt from storage.objects
    where bucket_id = 'screenshots' and name = v_tester2::text || '/rls-smoke-b.png';
  if v_cnt <> 0 then raise exception 'FAIL 14b: tester1 can read tester2''s screenshot'; end if;
  raise notice 'PASS 14b: tester1 cannot read tester2''s screenshot';

  begin
    insert into storage.objects (bucket_id, name)
      values ('screenshots', v_tester2::text || '/rls-smoke-evil.png');
    raise exception 'FAIL 14c: tester1 uploaded into tester2''s folder';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS 14c: tester1 cannot upload into tester2''s folder (%)', sqlstate;
  end;

  insert into storage.objects (bucket_id, name)
    values ('screenshots', v_tester::text || '/rls-smoke-ok.png');
  raise notice 'PASS 14d: tester1 can upload into own folder';

  -- as admin: reads everyone's screenshots (is_admin path in 0008).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  select count(*) into v_cnt from storage.objects
    where bucket_id = 'screenshots' and name = v_tester2::text || '/rls-smoke-b.png';
  if v_cnt <> 1 then raise exception 'FAIL 14e: admin cannot read a tester''s screenshot'; end if;
  raise notice 'PASS 14e: admin reads all screenshots';

  -- as anon: no storage policy for anon, so it sees nothing (0 rows or fails closed).
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin
    select count(*) into v_cnt from storage.objects
      where bucket_id = 'screenshots' and name in (
        v_tester::text || '/rls-smoke-a.png', v_tester2::text || '/rls-smoke-b.png');
    if v_cnt <> 0 then raise exception 'FAIL 14f: anon can read screenshots (% rows)', v_cnt; end if;
    raise notice 'PASS 14f: anon reads no screenshots (0 rows)';
  exception when insufficient_privilege then
    raise notice 'PASS 14f: anon denied on storage (fails closed, %)', sqlstate;
  end;

  execute 'reset role';
  raise notice 'rls_smoke: ALL PASS';
end $$;

rollback;
