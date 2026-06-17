import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  FEEDBACK_STATUSES,
  type Feedback,
  type FeedbackStatus,
} from "../lib/types";
import FeedbackThread from "../components/FeedbackThread";
import ScreenshotLink from "../components/ScreenshotLink";
import { one } from "../lib/embed";

// Admin triage: every submission, with status + tag editing and dedup merging.
export default function AdminFeedbackPage() {
  const [all, setAll] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"" | FeedbackStatus>("");
  const [tagFilter, setTagFilter] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);

  async function load() {
    setLoading(true);
    let query = supabase
      .from("feedback")
      .select("*, submitter:profiles(email)")
      .order("created_at", { ascending: false });
    // Filters run at the database. The tag filter goes through the GIN index on
    // feedback.tags via .contains() (tags @> ARRAY[tag]) rather than being applied
    // in the browser — so triage scales past what's comfortable to ship to the client.
    if (statusFilter) query = query.eq("status", statusFilter);
    if (tagFilter) query = query.contains("tags", [tagFilter]);
    const { data, error } = await query;
    if (error) {
      setLoadError(error.message);
      setAll([]);
    } else {
      setLoadError(null);
      setAll(
        ((data as Feedback[]) ?? []).map((f) => ({
          ...f,
          submitter: one(f.submitter),
        }))
      );
    }
    setLoading(false);
  }

  // Re-query when a filter changes — the narrowing happens server-side.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, tagFilter]);

  // Tag vocabulary for the filter dropdown — fetched once and kept stable, so
  // picking a tag (which narrows the feedback query) doesn't also shrink the set
  // of tags you can choose from.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("feedback").select("tags");
      const s = new Set<string>();
      ((data as { tags: string[] }[]) ?? []).forEach((r) =>
        r.tags?.forEach((t) => s.add(t))
      );
      setAllTags([...s].sort());
    })();
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

  // Canonical (non-merged) submissions. Status/tag narrowing now happens in the
  // query (see load), so this just hides merged duplicates from the top level.
  const canonical = useMemo(() => all.filter((f) => !f.merged_into), [all]);

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
    // Single atomic RPC (migration 0010): it points id at target AND reparents
    // id's existing duplicates onto target in one transaction, and re-checks
    // admin + canonical-target server-side. The client guards above are just fast
    // UX feedback; the RPC is the real enforcement and can't half-apply.
    const { error } = await supabase.rpc("merge_feedback", {
      src: id,
      target: targetId,
    });
    if (error) setActionError(`Couldn't merge: ${error.message}`);
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

      {actionError && <p className="error" role="alert">{actionError}</p>}
      {loadError && (
        <p className="error" role="alert">Couldn't load feedback: {loadError}</p>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : loadError ? null : canonical.length === 0 ? (
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
    const parsed = [
      ...new Set(
        tagDraft
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      ),
    ];
    // Enter (onKeyDown) and the blur it precedes (onBlur) both call this, so skip
    // the write when nothing actually changed — otherwise it's two identical
    // round-trips. Order-insensitive compare against the persisted tags.
    const a = [...parsed].sort();
    const b = [...fb.tags].sort();
    if (a.length === b.length && a.every((t, i) => t === b[i])) return;
    onTags(fb.id, parsed);
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
