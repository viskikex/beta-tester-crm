import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import type { FeedbackComment } from "../lib/types";
import { one } from "../lib/embed";

// A two-way reply thread on one feedback item, shared by the tester and admin
// views. RLS (migration 0007) guarantees you only ever load/post on a thread you
// can see, so this component carries no access logic of its own. Collapsed by
// default and fetched on first open, so a long list of items isn't N eager
// queries on mount.
export default function FeedbackThread({ feedbackId }: { feedbackId: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [comments, setComments] = useState<FeedbackComment[]>([]);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("feedback_comments")
      .select("*, author_profile:profiles(email)")
      .eq("feedback_id", feedbackId)
      .order("created_at", { ascending: true });
    if (error) {
      setError(error.message);
      return;
    }
    setComments(
      ((data as FeedbackComment[]) ?? []).map((c) => ({
        ...c,
        author_profile: one(c.author_profile),
      }))
    );
    setLoaded(true);
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) load();
  }

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !body.trim()) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("feedback_comments").insert({
      feedback_id: feedbackId,
      author: user.id,
      body: body.trim(),
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setBody("");
    load();
  }

  return (
    <div className="thread">
      <button type="button" className="link-btn" onClick={toggle}>
        {open ? "Hide replies" : loaded ? `Replies (${comments.length})` : "Replies"}
      </button>

      {open && (
        <div className="thread-body">
          {error && <p className="error" role="alert">{error}</p>}
          {!loaded ? (
            <p className="muted small">Loading…</p>
          ) : comments.length === 0 ? (
            <p className="muted small">No replies yet.</p>
          ) : (
            <ul className="thread-list">
              {comments.map((c) => (
                <li key={c.id} className="thread-item">
                  <div className="muted small">
                    {c.author === user?.id
                      ? "you"
                      : c.author_profile?.email ?? "unknown"}{" "}
                    · {new Date(c.created_at).toLocaleString()}
                  </div>
                  <div>{c.body}</div>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={post} className="row tight">
            <input
              className="grow"
              placeholder="Write a reply…"
              maxLength={10000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <button type="submit" disabled={saving || !body.trim()}>
              {saving ? "…" : "Reply"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
