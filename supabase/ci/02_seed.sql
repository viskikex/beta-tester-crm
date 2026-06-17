-- Seed exactly one admin and one tester so rls_smoke.sql has its two principals.
--
-- Inserting into auth.users fires the handle_new_user() trigger (migration 0002),
-- which creates the matching public.profiles row — so this also exercises that
-- trigger end-to-end. We then promote one profile to admin.

do $$
declare
  v_admin  uuid;
  v_tester uuid;
begin
  insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
            'authenticated', 'authenticated', 'admin@ci.test', now(), now())
    returning id into v_admin;

  insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
            'authenticated', 'authenticated', 'tester@ci.test', now(), now())
    returning id into v_tester;

  -- The trigger created both profiles; make one an admin, pin the other non-admin.
  update public.profiles set is_admin = true  where id = v_admin;
  update public.profiles set is_admin = false where id = v_tester;

  -- Fail loudly if the trigger didn't fire — otherwise rls_smoke's "need >=1 admin
  -- and >=1 non-admin" check would report a confusing downstream error instead.
  if not exists (select 1 from public.profiles where id = v_admin) then
    raise exception 'seed: admin profile was not created by handle_new_user trigger';
  end if;
  if not exists (select 1 from public.profiles where id = v_tester) then
    raise exception 'seed: tester profile was not created by handle_new_user trigger';
  end if;
end $$;
