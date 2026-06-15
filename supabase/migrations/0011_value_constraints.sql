-- Beta Tester CRM — value constraints at the DB boundary.
-- Run AFTER 0007_feedback_comments.sql.
--
-- WHY: the README's thesis is that integrity is the database's job, but several
-- gaps let a direct PostgREST/supabase-js write (anon key, no app validation)
-- store junk: feedback.body is `text not null`, so '' and '   ' pass; nothing
-- caps body/notes length (a 10 MB body is RLS-scoped self-DoS but unbounded);
-- testers.email was format-checked client-side only. These belong at the boundary
-- the docs claim, not just in the React forms.
--
-- All constraints are added NOT VALID: they are ENFORCED on every subsequent
-- insert/update (including direct API writes — the whole point) but skip the
-- one-time scan of existing rows, so applying this migration can't fail on data
-- that predates it. Run `alter table ... validate constraint ...` later if you
-- want the existing rows checked too.

-- feedback: non-empty (after trimming whitespace) and length-capped.
alter table public.feedback
  add constraint feedback_body_nonempty
  check (length(btrim(body)) > 0) not valid;

alter table public.feedback
  add constraint feedback_body_len
  check (char_length(body) <= 10000) not valid;

-- feedback_comments: same shape — replies are also a direct-API surface.
alter table public.feedback_comments
  add constraint feedback_comments_body_ok
  check (length(btrim(body)) > 0 and char_length(body) <= 10000) not valid;

-- testers: basic email shape + bounded free-text notes.
alter table public.testers
  add constraint testers_email_format
  check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') not valid;

alter table public.testers
  add constraint testers_notes_len
  check (notes is null or char_length(notes) <= 5000) not valid;

-- sessions: bounded free-text notes.
alter table public.sessions
  add constraint sessions_notes_len
  check (notes is null or char_length(notes) <= 5000) not valid;
