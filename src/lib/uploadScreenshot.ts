import { supabase } from "./supabase";
import { randomId, safeExt } from "./objectPath";

const BUCKET = "screenshots";
const MAX_BYTES = 5 * 1024 * 1024; // mirror the bucket's file_size_limit (0008)

// Upload a screenshot into the caller's own folder and return the object path
// to store on the feedback row. Path shape `<uid>/<uuid>.<ext>` is what the
// storage RLS policies key on, so the uid prefix is mandatory — don't change it
// without updating migration 0008.
export async function uploadScreenshot(userId: string, file: File): Promise<string> {
  if (file.size > MAX_BYTES) {
    throw new Error("Screenshot is larger than 5 MB.");
  }
  const path = `${userId}/${randomId()}.${safeExt(file)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return path;
}

// Remove a screenshot object. Testers may delete within their own uid folder
// (migration 0008), so this works for cleaning up a tester's own superseded or
// withdrawn screenshots. Used best-effort by callers — a failed cleanup orphans
// an object but must not fail the user's actual action.
export async function removeScreenshot(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
