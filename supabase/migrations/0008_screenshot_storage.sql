-- Beta Tester CRM — real screenshot uploads via Supabase Storage.
-- Run AFTER 0002_feedback_portal.sql.
--
-- WHY: pasting a URL is a non-starter for non-technical testers (they have a PNG
-- on disk, not a hosted link) and a user-controlled URL is the XSS surface that
-- 0004 + safeUrl() have to defend. A private bucket with per-user upload scoping
-- removes both problems: testers upload a file, the app stores only the object
-- path, and images are served through short-lived signed URLs.
--
-- The legacy feedback.screenshot_url column stays (old rows, and the 0004 http
-- check still guards it); new submissions populate screenshot_path instead.

-- ─────────────────────────────────────────────────────────────
-- Private bucket, capped at 5 MB, images only.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'screenshots', 'screenshots', false, 5242880,
  array['image/png','image/jpeg','image/gif','image/webp']
)
on conflict (id) do nothing;

-- feedback gets a path column alongside the legacy URL.
alter table public.feedback
  add column if not exists screenshot_path text;

-- ─────────────────────────────────────────────────────────────
-- storage.objects RLS for the 'screenshots' bucket.
--
-- Objects are keyed `<uid>/<uuid>.<ext>`. A tester may only write/read/delete
-- under their own uid folder; admins may read everyone's (for triage). The
-- folder-prefix check is the storage equivalent of `owner = auth.uid()`.
-- ─────────────────────────────────────────────────────────────
create policy "upload own screenshots" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "read own or admin screenshots" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'screenshots'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

create policy "delete own screenshots" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
