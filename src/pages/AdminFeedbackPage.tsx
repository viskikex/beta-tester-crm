import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  FEEDBACK_STATUSES,
  type Feedback,
  type FeedbackStatus,
} from "../lib/types";
import FeedbackThread from "../components/FeedbackThread";
import ScreenshotLink from "../components/ScreenshotLink";

// Admin triage: every submission, with status + tag editing and dedup merging.
export default function AdminFeedbackPage() {
  const [all, setAll] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"" | FeedbackStatus>("");
  const [tagFilter, setTagFilter] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("feedback")
      .select("*, submitter:profiles(email)")
      .order("created_at", { ascending: false });
    setAll((data as Feedback[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Group merged duplicates under their canonical submission.
  const dupesByTarget = useMemo(() => {
    const m = new Map<string, Feedback[]>();
    for (const f of all) {
      if (f.merged_into) {
        if (!m.has(f.merged_into)) m.set(f.merged_into, []);
        m.get(f.merged_into)!.push(f);
      }
    }
    return m;
  }, [all]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    all.forEach((f) => f.tags.forEach((t) => s.add(t)));
    return [...s].sort();
  }, [all]);

  // Canonical (non-merged) submissions, after filters.
  const canonical = useMemo(() => {
    return all
      .filter((f) => !f.merged_into)
      .filter((f) => !statusFilter || f.status === statusFilter)
      .filter((f) => !tagFilter || f.tags.includes(tagFilter));
  }, [all, statusFilter, tagFilter]);

  // candidate merge targets = other canonical submissions
  const mergeTargets = useMemo(
    () => all.filter((f) => !f.merged_into),
    [all]
  );

  // Optimistic, but self-correcting. On error we revert ONLY the one field on the
  // one row — not a whole-array snapshot, which would clobber any other edit the
  // user made while this write was in flight. The compare-and-swap guard
  // (`f.status === status`) means a stale failed write won't stomp a newer edit to
  // the same field either: we only roll back if the value is still the one we set.
  async function setStatus(id: string, status: FeedbackStatus) {
    setActionError(null);
    const prevStatus = all.find((f) => f.id === id)?.status;
    setAll((cur) => cur.map((f) => (f.id === id ? { ...f, status } : f)));
    const { error } = await supabase.from("feedback").update({ status }).eq("id", id);
    if (error) {
      if (prevStatus !== undefined) {
        setAll((cur) =>
          cur.map((f) =>
            f.id === id && f.status === status ? { ...f, status: prevStatus } : f
          )
        );
      }
      setActionError(`Couldn't update status: ${error.message}`);
    }
  }

  async function setTags(id: string, tags: string[]) {
    setActionError(null);
    const prevTags = all.find((f) => f.id === id)?.tags;
    setAll((cur) => cur.map((f) => (f.id === id ? { ...f, tags } : f)));
    const { error } = await supabase.from("feedback").update({ tags }).eq("id", id);
    if (error) {
      if (prevTags !== undefined) {
        // `f.tags === tags` is a reference check: the optimistic update stored this
        // exact array, so a later setTags (different ref) opts out of this revert.
        setAll((cur) =>
          cur.map((f) =>
            f.id === id && f.tags === tags ? { ...f, tags: prevTags } : f
          )
        );
      }
      setActionError(`Couldn't update tags: ${error.message}`);
    }
  }

  async function mergeInto(id: string, targetId: string) {
    setActionError(null);
    if (id === targetId) {
      setActionError("Can't merge an item into itself.");
      return;
    }
    // The target must be canonical. Rejecting a merged target also blocks
    // merging into one of this item's own duplicates (which would be a cycle).
    const target = all.find((f) => f.id === targetId);
    if (target?.merged_into) {
      setActionError("That target is itself merged. Pick a canonical submission.");
      return;
    }
    // Merge id into target, and re-parent id's existing duplicates onto target in
    // the same op so the dupe tree stays one level deep — otherwise those children
    // would orphan under a now-non-canonical parent and vanish from the UI.
    const { error } = await supabase
      .from("feedback")
      .update({ merged_into: targetId })
      .eq("id", id);
    const { error: reparentError } = await supabase
      .from("feedback")
      .update({ merged_into: targetId })
      .eq("merged_into", id);
    const failure = error ?? reparentError;
    if (failure) setActionError(`Couldn't merge: ${failure.message}`);
    load();
  }

  async function unmerge(id: string) {
    setActionError(null);
    const { error } = await supabase
      .from("feedback")
      .update({ merged_into: null })
      .eq("id", id);
    if (error) setActionError(`Couldn't unmerge: ${error.message}`);
    load();
  }

  return (
    <section>
      <div className="page-head">
        <h1>Feedback triage</h1>
        <div className="row tight">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="">all status</option>
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">all tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {actionError && <p className="error">{actionError}</p>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : canonical.length === 0 ? (
        <p className="muted">No submissions match.</p>
      ) : (
        <ul className="plain-list">
          {canonical.map((f) => (
            <FeedbackCard
              key={f.id}
              fb={f}
              dupes={dupesByTarget.get(f.id) ?? []}
              mergeTargets={mergeTargets.filter((t) => t.id !== f.id)}
              onStatus={setStatus}
              onTags={setTags}
              onMerge={mergeInto}
              onUnmerge={unmerge}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedbackCard({
  fb,
  dupes,
  mergeTargets,
  onStatus,
  onTags,
  onMerge,
  onUnmerge,
}: {
  fb: Feedback;
  dupes: Feedback[];
  mergeTargets: Feedback[];
  onStatus: (id: string, s: FeedbackStatus) => void;
  onTags: (id: string, tags: string[]) => void;
  onMerge: (id: string, targetId: string) => void;
  onUnmerge: (id: string) => void;
}) {
  const [tagDraft, setTagDraft] = useState(fb.tags.join(", "));

  function saveTags() {
    const parsed = tagDraft
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    onTags(fb.id, [...new Set(parsed)]);
  }

  return (
    <li>
      <div className="fb-head">
        <span className="tag">{fb.type}</span>
        <span className={`pill pill-${fb.status}`}>{fb.status}</span>
        <span className="muted small">{fb.submitter?.email ?? "unknown"}</span>
        <span className="muted small">
          {new Date(fb.created_at).toLocaleDateString()}
        </span>
      </div>

      <div className="fb-body">{fb.body}</div>
      <ScreenshotLink path={fb.screenshot_path} legacyUrl={fb.screenshot_url} />

      {dupes.length > 0 && (
        <div className="dupes">
          <span className="muted small">{dupes.length} merged duplicate(s):</span>
          {dupes.map((d) => (
            <div key={d.id} className="dupe-row small">
              “{d.body.slice(0, 60)}{d.body.length > 60 ? "…" : ""}”
              <button className="link-btn" onClick={() => onUnmerge(d.id)}>
                unmerge
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="fb-actions">
        <label className="inline-label">
          status
          <select
            value={fb.status}
            onChange={(e) => onStatus(fb.id, e.target.value as FeedbackStatus)}
          >
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <span className="tag-editor">
          <input
            value={tagDraft}
            placeholder="tags, comma, separated"
            onChange={(e) => setTagDraft(e.target.value)}
            onBlur={saveTags}
            onKeyDown={(e) => e.key === "Enter" && saveTags()}
          />
        </span>

        {mergeTargets.length > 0 && (
          <label className="inline-label">
            merge into
            <select
              value=""
              onChange={(e) => e.target.value && onMerge(fb.id, e.target.value)}
            >
              <option value="">—</option>
              {mergeTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.body.slice(0, 40)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <FeedbackThread feedbackId={fb.id} />
    </li>
  );
}
