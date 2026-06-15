import { useState } from "react";
import { supabase } from "../lib/supabase";
import { safeUrl } from "../lib/safeUrl";

// Renders the "screenshot" link for a feedback item. New rows carry a Storage
// object path; legacy rows carry a pasted URL.
//
// Storage objects are NOT signed on mount: a long list would otherwise fire one
// signed-URL round-trip per visible item, and a 300s URL signed at render is
// already stale by the time an admin clicks it minutes later. Instead we sign on
// click — a fresh URL every time, so expiry never bites — and surface signing
// errors instead of silently rendering as "no screenshot". Legacy URLs still go
// through safeUrl()'s http(s) allowlist.
export default function ScreenshotLink({
  path,
  legacyUrl,
}: {
  path: string | null;
  legacyUrl: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const legacyHref = safeUrl(legacyUrl);

  // A storage path supersedes a legacy URL; if neither is viewable, render nothing.
  if (!path) {
    if (!legacyHref) return null;
    return (
      <a href={legacyHref} target="_blank" rel="noreferrer" className="small">
        screenshot
      </a>
    );
  }

  async function open() {
    setError(null);
    setBusy(true);
    // Open the tab synchronously inside the click gesture, then redirect it once
    // the signed URL resolves — opening after the await would be eaten by popup
    // blockers. The target is our own first-party storage, so keeping the window
    // handle (no noopener) is acceptable here.
    const tab = window.open("about:blank", "_blank");
    const { data, error } = await supabase.storage
      .from("screenshots")
      .createSignedUrl(path!, 300);
    setBusy(false);
    if (error || !data?.signedUrl) {
      tab?.close();
      setError(error?.message ?? "Couldn't load that screenshot.");
      return;
    }
    if (tab) tab.location.href = data.signedUrl;
    else window.location.href = data.signedUrl; // popup blocked: best-effort
  }

  return (
    <>
      <button
        type="button"
        className="link-btn small"
        onClick={open}
        disabled={busy}
      >
        {busy ? "opening…" : "screenshot"}
      </button>
      {error && (
        <span role="alert" className="error small">
          {error}
        </span>
      )}
    </>
  );
}
