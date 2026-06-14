import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { safeUrl } from "../lib/safeUrl";

// Renders the "screenshot" link for a feedback item. New rows carry a Storage
// object path → resolve a short-lived signed URL (the bucket is private). Legacy
// rows carry a pasted URL → fall back to safeUrl() so the http(s) allowlist still
// applies. Renders nothing if there's no viewable image.
export default function ScreenshotLink({
  path,
  legacyUrl,
}: {
  path: string | null;
  legacyUrl: string | null;
}) {
  const [signed, setSigned] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setSigned(null);
      return;
    }
    let cancelled = false;
    supabase.storage
      .from("screenshots")
      .createSignedUrl(path, 300)
      .then(({ data }) => {
        if (!cancelled) setSigned(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const href = path ? signed : safeUrl(legacyUrl);
  if (!href) return null;

  return (
    <a href={href} target="_blank" rel="noreferrer" className="small">
      screenshot
    </a>
  );
}
