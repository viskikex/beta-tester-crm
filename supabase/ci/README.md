# CI database harness

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs two jobs on every push / PR:

- **frontend** — `npm ci`, lint, vitest, and the production build.
- **rls** — stands up the real `supabase/postgres` image, applies the migrations
  in order, seeds an admin + a tester, and runs
  [`supabase/tests/rls_smoke.sql`](../tests/rls_smoke.sql) against it. That test
  RAISEs on any failed access-rule invariant, so **a broken RLS policy fails the
  build** — the security model is regression-tested, not just asserted in prose.

The three `*.sql` files here reproduce the parts of a *hosted* Supabase project
that the bare database image doesn't set up on its own:

| file | why it exists |
|------|---------------|
| `00_bootstrap.sql` | Insurance: guard-creates `auth.uid()` / `auth.role()` **only if** the image lacks them, and stands up the `storage.*` schema (`buckets`/`objects`/`foldername()`) that the bare image doesn't ship but migration `0008` needs. All guarded with `IF NOT EXISTS`, so a fuller image is untouched. |
| `01_grants.sql` | Table grants for `anon` / `authenticated`. **Tables only** — function `EXECUTE` grants are left to the migrations, because `0003` deliberately revokes `is_admin()` from `anon` so anon fails *closed*. |
| `02_seed.sql` | Inserts two `auth.users` rows (firing the `handle_new_user` trigger that creates profiles) and promotes one to admin. |

## Assumptions (verified by the first Actions run, not locally)

This harness was authored without a local Docker daemon, so the first CI run is
the integration test. It assumes:

1. The `supabase/postgres` image ships the `auth` + `storage` schemas, the
   `anon`/`authenticated`/`service_role` roles, `auth.uid()`, and
   `storage.foldername()` on a bare boot. (This is the image's purpose; migrations
   `0002`/`0008` depend on it.)
2. `POSTGRES_PASSWORD` sets the `postgres` superuser password at first boot.
3. `auth.users` accepts the column set used in `02_seed.sql`.

If any of these is off on the first run, the failing **step name** points straight
at it (bootstrap / migrate / grant / seed / smoke).

## Running it locally

If you have Docker + the Supabase CLI, the same sequence runs locally:

```bash
supabase start                      # or: docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 supabase/postgres:15.14.1.136
export PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres
psql -v ON_ERROR_STOP=1 -f supabase/ci/00_bootstrap.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$f"; done
psql -v ON_ERROR_STOP=1 -f supabase/ci/01_grants.sql
psql -v ON_ERROR_STOP=1 -f supabase/ci/02_seed.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_smoke.sql   # prints "rls_smoke: ALL PASS"
```
