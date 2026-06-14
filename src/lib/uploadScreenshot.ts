import { supabase } from "./supabase";

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
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "png";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return path;
}
