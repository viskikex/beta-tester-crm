# Beta Tester CRM + Feedback Portal

[![CI](https://github.com/viskikex/beta-tester-crm/actions/workflows/ci.yml/badge.svg)](https://github.com/viskikex/beta-tester-crm/actions/workflows/ci.yml)

Two tools in one app, gated by role:

- **Admin (program manager)** — recruit testers, move them through a pipeline,
  schedule feedback sessions, and **triage incoming feedback** (set status, tag,
  merge duplicates, filter).
- **Tester** — submit feedback (bug / confusion / request, with an optional
  screenshot upload), edit or withdraw it before triage, reply in a thread, and
  watch the status of their own submissions.

I built this security-first: the access rules live in the database (Postgres RLS), not
just the React UI, so the same boundary holds whether you go through the app or hit the
API directly. React + Supabase.

## What it demonstrates

Security model (the headline — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full tour):

- **Role-based access control** — a `profiles.is_admin` flag, surfaced through the
  auth context to **gate routes** (testers can't reach the admin views) *and* to drive
  RLS, so the same boundary holds whether you go through the UI or hit the API directly.
- **Recursion-safe RLS** — the `is_admin()` helper is `SECURITY DEFINER` so the
  `profiles` SELECT policy can call it without infinite-looping. (Read the comment
  in `0002_feedback_portal.sql` — this is the classic Supabase footgun, handled.)
- **Owner-scoped RLS** — the CRM tables (`testers`, `sessions`) use the simpler
  `auth.uid() = owner` pattern, so the repo shows both RLS models side by side.
- **Column-pinned write policies** — testers may edit or withdraw their *own* feedback,
  but only while it's `status='new'`, and the `WITH CHECK` pins `status`/`tags`/`merged_into`
  so they can't self-promote a submission to `shipped` or seed tags. Triage stays admin-only
  at the *database* boundary, not just in the UI (`0005`, `0006`).
- **Defense-in-depth against stored XSS** — legacy `screenshot_url` is user-controlled, and
  React doesn't sanitize `href`, so a `javascript:` URL would run in the *admin's* session at
  triage. Guarded twice: `safeUrl()` on render (`src/lib/safeUrl.ts`) **and** a DB `CHECK`
  constraint so the rule survives a direct anon-key write (`0004`).
- **`SECURITY DEFINER` hardening** — pinned `search_path` + `REVOKE EXECUTE … FROM PUBLIC`
  on every helper (`0003`). `is_admin()` and `merge_feedback()` are then granted back
  to `authenticated` on purpose: the policies evaluate `is_admin()` as the signed-in
  user, and `merge_feedback()` is the admin triage RPC. Supabase's linter still lists
  those two as "executable by signed-in users," which is expected, not a miss. Both
  re-check authorization internally, so calling them directly leaks nothing.
- **Atomic, server-enforced merge** — duplicate-merging is one `SECURITY DEFINER` RPC
  (`0010`) that re-checks admin + canonical-target and does both writes in a single
  transaction, so a partial failure can't corrupt the dedup tree (and the no-cycle rule
  isn't just client-side). A `BEFORE UPDATE` trigger (`0012`) re-asserts the same
  no-self-merge and canonical-target rules at the table, so they hold even against a
  direct admin `UPDATE` that bypasses the RPC.
- **Validation at the DB boundary** — non-empty, length-capped feedback bodies and an
  email-format check live as `CHECK` constraints (`0011`), so "integrity is the database's
  job" holds against a direct anon-key write, not only the React forms.

Platform features:

- **Supabase Auth** — email/password, session via React context, with a
  `handle_new_user()` trigger that auto-creates a profile row on sign-up.
- **Supabase Storage** — a *private* `screenshots` bucket; testers upload an image into
  their own `<uid>/…` folder (per-user folder RLS), the app stores only the object path,
  and viewers get a short-lived **signed URL** (`0008`, `ScreenshotLink.tsx`).
- **Append-only comment threads** — a two-way reply thread on each feedback item, with
  *no* UPDATE/DELETE policy so the triage conversation is an honest record (`0007`).
- **Postgres arrays + GIN index** — `tags text[]` with a GIN index (`feedback_tags_idx`);
  the triage tag filter runs server-side through it via `.contains()` (`tags @> ARRAY[tag]`),
  so narrowing the board doesn't ship the whole table to the browser.
- **A pipeline UI**, optimistic updates with rollback-on-error, and client-side aggregation
  for the dashboard.

## Stack

Vite + React 18 + TypeScript, `@supabase/supabase-js`, `react-router-dom`. Plain CSS.

## Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com).
2. **Run the migrations in order** (`0001` → `0011`), in the SQL Editor:
   - `0001_init.sql` — testers + sessions
   - `0002_feedback_portal.sql` — profiles, roles, feedback
   - `0003_harden_functions.sql` — `search_path` + EXECUTE hardening
   - `0004_screenshot_url_scheme.sql` — http(s)-only constraint on legacy screenshot URLs
   - `0005_restrict_feedback_insert.sql` — testers submit as `status=new` only
   - `0006_tester_edit_own_feedback.sql` — testers edit/withdraw their own while `new`
   - `0007_feedback_comments.sql` — the reply thread (append-only)
   - `0008_screenshot_storage.sql` — private `screenshots` bucket + per-user upload RLS
   - `0009_feedback_edit_column_lock.sql` — trigger so admin-tagging a `new` item can't brick a tester's edit
   - `0010_merge_feedback_rpc.sql` — `SECURITY DEFINER` RPC that merges duplicates atomically
   - `0011_value_constraints.sql` — server-side value `CHECK`s (non-empty/length-capped body, email format)
   - `0012_feedback_merge_guard.sql` — trigger so the merge invariants hold for a direct admin write, not just the RPC
   - `0013_rls_initplan.sql` — wrap `auth.uid()`/`is_admin()` in `(select …)` so each policy evaluates them once per query, not once per row
   > `0004` will fail if a row already holds a non-http `screenshot_url` — clean those first.
   > `0010` is required for duplicate-merging — the triage UI calls it via `supabase.rpc('merge_feedback')`, so merge errors until this is applied.
3. **Env vars:** `cp .env.example .env`, then fill in URL + anon key (Settings → API).
4. **Run it:**
   ```bash
   npm install
   npm run dev
   ```
5. **Sign up.** Your first account lands as a *tester* — you'll see only the feedback
   submission view. Submit a couple of items.
6. **Make yourself an admin.** In the SQL Editor:
   ```sql
   update public.profiles set is_admin = true where email = 'you@example.com';
   ```
   Refresh — now you get the Dashboard, Testers, and Triage views.

> To skip email confirmation while hacking: **Authentication → Providers → Email →
> "Confirm email" off**. Then create a *second* account to act as a tester while your
> first one is the admin, so you can watch a submission flow through triage.

## Where to look first

| File | What it shows |
|------|---------------|
| `supabase/migrations/0002_feedback_portal.sql` | Roles, the `SECURITY DEFINER` helper, two-sided RLS |
| `src/context/AuthContext.tsx` | Loads the profile + exposes `isAdmin` |
| `src/App.tsx` | `RequireAuth` / `RequireAdmin` route gating |
| `src/pages/MyFeedbackPage.tsx` | Tester side: submit + see own status |
| `src/pages/AdminFeedbackPage.tsx` | Admin side: status, tags, merge, filter |
| `supabase/migrations/0008_screenshot_storage.sql` | Private bucket + per-user folder Storage RLS |
| `src/lib/safeUrl.ts` + `0004_*.sql` | The two halves of the XSS defense-in-depth |

For the full data model and the layered RLS story, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Tests

Two layers, matching the two halves of the app:

- **Unit (frontend):** `npm test` (vitest) covers the pure boundary helpers — the `http(s)` URL allowlist, the storage-path extension sanitizer + id generator, and the PostgREST embed-shape coercion.
- **RLS / policy (database):** [`supabase/tests/rls_smoke.sql`](supabase/tests/rls_smoke.sql) asserts the access-rule invariants from [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) *directly against Postgres* — a tester sees only their own feedback, can't submit a pre-triaged row or self-promote one, can't merge or flip `is_admin`; testers and their screenshots stay private to their owner (the CRM tables have no admin override); comments are append-only; anon sees nothing; and the value constraints hold. It simulates signed-in users via `request.jwt.claims` + `SET ROLE`, runs inside a transaction that **rolls back** (persists nothing), and emits only PASS/FAIL (no PII). Run it against a **dev** project:

  ```bash
  psql "$DATABASE_URL" -f supabase/tests/rls_smoke.sql
  # …or paste it into the Supabase SQL Editor and Run.
  ```

- **Both, in CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the unit tests + build, then stands up the real `supabase/postgres` image, applies all 11 migrations in order, seeds an admin + a tester, and runs `rls_smoke.sql` against it — **on every push**. So the access-rule invariants above are proven green on each commit, not just claimed. The CI-only database setup (the storage schema, role grants, and seed that a hosted Supabase project provides but the bare image doesn't) lives in [`supabase/ci/`](supabase/ci/).

## Ideas to extend

- Realtime on `feedback` so the triage board updates live as testers submit.
- Email the submitter when their item ships (Edge Function on status change).
- An LLM pass to auto-suggest tags from the body.
- Tie a feedback item back to a CRM `tester` record when emails match.
- Pagination / "load more" on the triage and tester lists (today they fetch all visible rows).

## Known limitations

Scoping calls I made on purpose, not things I missed:

- **No pagination yet.** The list and dashboard views pull every visible row on mount.
  That's fine at demo scale. A real deployment wants range pagination or a "load more,"
  and it's the first thing I'd add.
- **Multi-admin edits are last-write-wins.** The optimistic-update guards protect you
  from your own in-flight races, but if two admins edit the same feedback row at once,
  the second save wins silently. There's no `updated_at` precondition.
- **Admin promotion is SQL-only.** There's no in-app button to make someone an admin,
  and that's deliberate: the `profiles` table has no write policy, so admin can't be
  granted (or self-granted) through the API. You flip `is_admin` in the SQL editor.
- **Screenshot cleanup is best-effort.** If a storage delete fails, the object can
  orphan. There's no garbage collector.
- **Deleting a canonical feedback item un-merges its duplicates.** They fall back to
  standalone (`on delete set null`) rather than re-parenting to another item.

## License

MIT — see [`LICENSE`](LICENSE).
