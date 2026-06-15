import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { FEEDBACK_TYPES, type Feedback, type FeedbackType } from "../lib/types";
import { uploadScreenshot, removeScreenshot } from "../lib/uploadScreenshot";
import FeedbackThread from "../components/FeedbackThread";
import ScreenshotLink from "../components/ScreenshotLink";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

// Tester-facing: submit feedback and watch the status of your own submissions.
// RLS guarantees the list below only ever contains rows you submitted.
export default function MyFeedbackPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);

  const [type, setType] = useState<FeedbackType>("bug");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("feedback")
      .select("*")
      .eq("submitted_by", user.id)
      .order("created_at", { ascending: false });
    setItems((data as Feedback[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      // Upload first so a failed upload aborts before we create the row.
      const screenshot_path = file ? await uploadScreenshot(user.id, file) : null;
      const { error } = await supabase.from("feedback").insert({
        submitted_by: user.id,
        type,
        body: body.trim(),
        screenshot_path,
      });
      if (error) throw error;
      setBody("");
      setType("bug");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // Withdraw an own submission (RLS allows this only while status='new').
  async function remove(id: string) {
    if (!window.confirm("Delete this feedback? This can't be undone.")) return;
    setActionError(null);
    // Grab the object path before the row is gone — the delete doesn't cascade to
    // storage, so we purge it ourselves afterward.
    const screenshotPath = items.find((f) => f.id === id)?.screenshot_path ?? null;
    const { error } = await supabase.from("feedback").delete().eq("id", id);
    if (error) {
      setActionError(`Couldn't delete: ${error.message}`);
      return;
    }
    if (screenshotPath) await removeScreenshot(screenshotPath).catch(() => {});
    load();
  }

  return (
    <section>
      <h1>Send feedback</h1>
      <p className="muted">
        Found a bug, got confused, or want something? Tell us. You'll see the
        status update here as we triage it.
      </p>

      {error && <p className="error" role="alert">{error}</p>}
      <form onSubmit={submit} className="inline-form">
        <div className="row">
          <label className="grow">
            Type
            <select value={type} onChange={(e) => setType(e.target.value as FeedbackType)}>
              {FEEDBACK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        <textarea
          rows={4}
          required
          maxLength={10000}
          placeholder="What happened? What did you expect?"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <label className="muted small">
          Screenshot (optional, image up to 5 MB)
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button type="submit" disabled={saving || !body.trim()}>
          {saving ? "Sending…" : "Submit feedback"}
        </button>
      </form>

      <h2>Your submissions</h2>
      {actionError && <p className="error" role="alert">{actionError}</p>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul className="plain-list">
          {items.map((f) => (
            <SubmissionItem key={f.id} fb={f} onChanged={load} onDelete={remove} />
          ))}
        </ul>
      )}
    </section>
  );
}

// A single own-submission. Editable/withdrawable only while status='new' — which
// mirrors the RLS policy, so the buttons never offer an action the DB will reject.
function SubmissionItem({
  fb,
  onChanged,
  onDelete,
}: {
  fb: Feedback;
  onChanged: () => void;
  onDelete: (id: string) => void;
}) {
  const editable = fb.status === "new";
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<FeedbackType>(fb.type);
  const [body, setBody] = useState(fb.body);
  const [file, setFile] = useState<File | null>(null);
  const [removeShot, setRemoveShot] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasShot = !!(fb.screenshot_path || fb.screenshot_url);

  function startEdit() {
    setType(fb.type);
    setBody(fb.body);
    setFile(null);
    setRemoveShot(false);
    if (fileRef.current) fileRef.current.value = "";
    setError(null);
    setEditing(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const oldPath = fb.screenshot_path;
      let screenshot_path = fb.screenshot_path;
      let screenshot_url = fb.screenshot_url;
      let uploadedPath: string | null = null;
      if (removeShot) {
        screenshot_path = null;
        screenshot_url = null;
      }
      if (file) {
        // New upload supersedes any legacy URL on this row.
        screenshot_path = await uploadScreenshot(fb.submitted_by, file);
        uploadedPath = screenshot_path;
        screenshot_url = null;
      }
      const { error } = await supabase
        .from("feedback")
        .update({ type, body: body.trim(), screenshot_path, screenshot_url })
        .eq("id", fb.id);
      if (error) {
        // Roll back a just-uploaded object so a failed save doesn't orphan it.
        if (uploadedPath) await removeScreenshot(uploadedPath).catch(() => {});
        throw error;
      }
      // Drop the superseded object once the row no longer references it.
      if (oldPath && oldPath !== screenshot_path) {
        await removeScreenshot(oldPath).catch(() => {});
      }
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <li>
        {error && <p className="error" role="alert">{error}</p>}
        <form onSubmit={save} className="inline-form">
          <div className="row">
            <label className="grow">
              Type
              <select value={type} onChange={(e) => setType(e.target.value as FeedbackType)}>
                {FEEDBACK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <textarea
            rows={4}
            required
            maxLength={10000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <label className="muted small">
            {hasShot ? "Replace screenshot (optional)" : "Add screenshot (optional)"}
            <input
              ref={fileRef}
              type="file"
              accept={IMAGE_ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {hasShot && !file && (
            <label className="muted small row tight">
              <input
                type="checkbox"
                checked={removeShot}
                onChange={(e) => setRemoveShot(e.target.checked)}
              />
              Remove current screenshot
            </label>
          )}
          <div className="row tight">
            <button type="submit" disabled={saving || !body.trim()}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button type="button" className="link-btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li>
      <div className="fb-head">
        <span className="tag">{fb.type}</span>
        <span className={`pill pill-${fb.status}`}>{fb.status}</span>
        <span className="muted small">
          {new Date(fb.created_at).toLocaleDateString()}
        </span>
      </div>
      <div>{fb.body}</div>
      <ScreenshotLink path={fb.screenshot_path} legacyUrl={fb.screenshot_url} />
      {editable && (
        <div className="row tight">
          <button type="button" className="link-btn" onClick={startEdit}>
            Edit
          </button>
          <button type="button" className="link-btn" onClick={() => onDelete(fb.id)}>
            Delete
          </button>
        </div>
      )}
      <FeedbackThread feedbackId={fb.id} />
    </li>
  );
}
