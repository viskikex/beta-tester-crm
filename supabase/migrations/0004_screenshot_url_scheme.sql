-- Beta Tester CRM — constrain feedback.screenshot_url to http(s) URLs.
-- Run AFTER 0002_feedback_portal.sql (0003 may be applied in any order relative
-- to this one; they touch different objects).
--
-- WHY: screenshot_url is tester-controlled. The app's <input type="url"> is
-- client-side only — a direct PostgREST/supabase-js insert with the public anon
-- key bypasses it. Without this constraint a tester can store
-- `javascript:...` (or data:/vbscript:) and, because React does not sanitize
-- href, it executes in the viewer's session when the link is clicked. The viewer
-- is frequently an admin in the triage view, so this is a stored-XSS path that
-- crosses a privilege boundary. src/lib/safeUrl.ts is the client-side half;
-- this constraint is the server-side half so the rule holds against any writer.

-- Case-insensitive: must be empty/null or begin with http:// or https://.
alter table public.feedback
  add constraint feedback_screenshot_url_http
  check (screenshot_url is null or screenshot_url ~* '^https?://');
