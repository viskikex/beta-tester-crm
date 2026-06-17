# Portfolio audit — beta-tester-crm

Audited 2026-06-16 against `main`. Build/lint/typecheck/tests all green. This
document is deliberately harsh; the strengths are real and listed at the end so
the criticism has context.

## The one-sentence verdict

**~90% of this project's depth lives in the database migrations and the README.
The React app is competent but ordinary, and the single thing a non-technical
reviewer will actually judge — a running demo they can click — does not exist.**
Fix the framing gap before polishing anything internal.

---

## Tier S — blocks "portfolio worthy"

### S1. It isn't published or deployed.
README says `GitHub: (add link when published)`. There is no hosted demo, no
screenshots, no GIF. A reviewer cannot see it run without cloning, creating a
Supabase project, and hand-running 11 migrations. For a portfolio piece that is
the difference between "looked at it" and "didn't." Deploy the frontend
(Vercel/Netlify) against a seeded dev Supabase, add 3-4 screenshots to the
README, and put the repo on GitHub. Nothing else here matters as much.

### S2. No CI.
`vitest` + `tsc -b` + `eslint` + the RLS smoke test all exist and all pass — and
nothing runs them automatically. The RLS test (the project's headline proof) is
manual-only: paste-into-SQL-editor. A green GitHub Actions badge running the unit
tests and the build is ~20 lines of YAML and converts "trust me" into "see for
yourself." Right now the most impressive artifact (the policy test) is the one a
visitor is least likely to ever execute.

---

## Tier A — real bugs and gaps

### A1. The data-load functions swallow errors — and the README brags that they don't.
`AuthContext` is careful: it surfaces fetch errors instead of letting them
masquerade as "no profile" (the README calls this out as a deliberate decision).
But the actual list views do the exact opposite:

- `AdminFeedbackPage.load` (`src/pages/AdminFeedbackPage.tsx:22`) — `const { data } = …`, error dropped.
- `MyFeedbackPage.load` (`src/pages/MyFeedbackPage.tsx:29`) — same.
- `TestersPage.load` (`src/pages/TestersPage.tsx:18`) — same.
- `DashboardPage` (`src/pages/DashboardPage.tsx`) — all three queries ignore `error`.

A failed load renders as "No submissions match" / an empty board / zero counts —
indistinguishable from genuinely empty. This directly contradicts the philosophy
the README sells one paragraph up. The inconsistency is the damning part: a sharp
reviewer who reads the AuthContext comment and then opens AdminFeedbackPage will
notice immediately.

### A2. Testers see admin replies attributed to "unknown."
The reply thread is sold as "the single biggest 'I feel heard' lever." But
`profiles` RLS lets a tester read only their own row (`id = auth.uid() or is_admin()`).
So when `FeedbackThread` does `select("*, author_profile:profiles(email)")` as a
tester, the embed for an **admin-authored** comment resolves to null, and the UI
renders the responder as "unknown" (`src/components/FeedbackThread.tsx:84`). The
feature you're showcasing shows the program manager's responses as coming from a
ghost. You need a cross-boundary-readable display name or role label on profiles
(e.g. a `display_name` column readable by anyone who can see the thread, or just
hardcode "Beta team" for `is_admin` authors).

### A3. No pagination, anywhere.
`AdminFeedbackPage` fetches the entire `feedback` table on mount; `TestersPage`
fetches every tester; `MyFeedbackPage` every own row. For a tool whose pitch is
"run a beta program," unbounded `select("*")` on every mount is the first thing a
backend reviewer pokes at. Worse: the merge-target `<select>` lists *every*
canonical submission by `body.slice(0,40)` (`AdminFeedbackPage:298`) — unusable
past ~30 items, no search. Add range pagination or at least a documented LIMIT +
"load more."

### A4. The GIN index is decoration.
`feedback_tags_idx … using gin (tags)` is created (0002) and prominently sold in
the README — but tag filtering is done **client-side** (`AdminFeedbackPage:62`,
admitted at README:54). You provisioned and showcase an index the app never
queries. It's honest about it, but it reads as schema-as-resume-padding. Either
wire one `.contains()` filter through it (turning the showcase real) or stop
foregrounding it.

---

## Tier B — polish / smaller

- **B1. Comment density.** Nearly every file carries a multi-paragraph essay
  justifying its decisions. This cuts both ways: it documents genuinely subtle
  reasoning (the 0009 WITH-CHECK-can't-see-OLD explanation is excellent), but the
  comment-to-code ratio is high enough to read as defensive, and to some reviewers
  as an AI-generation tell. The code is good enough to speak more for itself. Trim
  the load-bearing comments to one line + a pointer; keep the migration essays.
- **B2. Multi-admin concurrency is last-write-wins.** The elaborate
  compare-and-swap rollback guards (`setStatus`/`setTags`) defend against *your
  own* in-flight races but silently lose to a *second admin* editing the same row
  — no `updated_at` precondition. You've over-engineered the single-user race and
  ignored the multi-user one. Fine for a demo; name it as a known limitation.
- **B3. Dashboard does three sequential awaits** that are independent
  (`DashboardPage`) — `Promise.all` them. Minor, but it's the dashboard.
- **B4. Storage orphans.** Best-effort cleanup means a failed delete leaves an
  object forever; no GC (admitted in comments). Fine for scope — add it to a
  "known limitations" section so it reads as a choice, not an oversight.
- **B5. AuthPage** has no password reset and no "resend confirmation." A reviewer
  creating an account who mistypes their email is stuck. Low effort to add.
- **B6. No in-app admin management** — promotion is SQL-only (documented, by
  design). For something called a "CRM" that's a functional hole; acceptable for a
  demo but worth one sentence acknowledging it.
- **B7.** `merged_into … on delete set null`: deleting a canonical item silently
  un-merges its duplicates back to canonical. Edge case, probably fine, but
  untested.

---

## What's genuinely good (and why the above is worth fixing)

- The **SQL/RLS layer is the real deliverable and it's strong**: recursion-safe
  `is_admin()`, the `search_path` + `REVOKE … FROM PUBLIC` hardening (0003), the
  column-lock trigger that correctly *replaces* the brittle WITH-CHECK approach
  once you realised WITH CHECK can't see OLD (0009), and the atomic
  `SECURITY DEFINER` merge RPC (0010). This is above intern level.
- The **defense-in-depth XSS story is real**, not theatre: `safeUrl()` + the 0004
  CHECK constraint genuinely close both the render and direct-write paths, and the
  threat model (admin clicks a tester-controlled `javascript:` URL in triage) is
  correctly identified.
- `rls_smoke.sql` is a **legitimate policy test with positive controls** — it
  can't silently pass on a misconfigured run. Most portfolio projects have nothing
  like it.
- Two sharp real-world calls in the frontend: the `one()` PostgREST embed-shape
  coercion (a bug almost everyone ships) and signing storage URLs *on click*
  rather than on mount.

The frustrating part is that the hard, rare skill (the database) is done well, and
the easy, common gaps (deploy it, show it, don't swallow load errors, don't render
your headline feature's author as "unknown") are what a reviewer hits first.

## Suggested order of attack
1. Deploy + screenshots + GitHub link (S1).
2. Fix the thread "unknown" attribution (A2) — it undercuts your best feature.
3. Surface load errors (A1) — cheap, and it removes a self-contradiction.
4. CI badge (S2).
5. Pagination (A3) and the GIN decision (A4).
6. Everything in Tier B as time allows.
