// Pure helpers for building a Storage object path. Kept free of any `supabase`
// import on purpose: that module throws at import time when env vars are unset,
// which would make these untestable. Nothing here touches the network.

// The screenshots bucket (migration 0008) only accepts these MIME types, so the
// type is the most trustworthy source for the extension — more than a filename.
export const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

// Pick a safe extension for the storage object. file.name is attacker-controlled,
// so we never splice it raw into the path: prefer the validated MIME type, else
// the filename ext stripped to [a-z0-9] and length-capped, else "png".
export function safeExt(file: Pick<File, "name" | "type">): string {
  const fromMime = MIME_EXT[file.type];
  if (fromMime) return fromMime;
  const raw = file.name.includes(".") ? file.name.split(".").pop() ?? "" : "";
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return cleaned || "png";
}

// A unique id for the object path. crypto.randomUUID() is only defined in a
// secure context (https / localhost), so a plain-http deploy would throw and
// break every upload. Fall back to getRandomValues, then Math.random — the id
// only needs to be collision-free within the caller's own folder, not secret.
export function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const buf = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(buf);
  else for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
  buf[6] = (buf[6] & 0x0f) | 0x40; // version 4
  buf[8] = (buf[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}
