import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { PAGE_SIZE } from "../lib/constants";
import {
  TESTER_STATUSES,
  type Tester,
  type TesterStatus,
  toTesterStatus,
} from "../lib/types";

export default function TestersPage() {
  const { user } = useAuth();
  const [testers, setTesters] = useState<Tester[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<TesterStatus | null>(null);
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const location = useLocation();

  async function load() {
    setLoading(true);
    const { data, error, count } = await supabase
      .from("testers")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) {
      setLoadError(error.message);
      setTesters([]);
      setCount(0);
    } else {
      setLoadError(null);
      setCount(count ?? 0);
      setTesters(data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Deep-link from the dashboard status cards: /testers#status-active scrolls to
  // that pipeline column and flashes it so the landing spot is obvious.
  useEffect(() => {
    if (loading) return;
    const match = location.hash.match(/^#status-(\w+)$/);
    const status = match?.[1] as TesterStatus | undefined;
    if (!status || !TESTER_STATUSES.includes(status)) return;
    const el = document.getElementById(`status-${status}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlighted(status);
    const timer = setTimeout(() => setHighlighted(null), 1600);
    return () => clearTimeout(timer);
  }, [loading, location.hash]);

  async function moveStatus(t: Tester, status: TesterStatus) {
    // Optimistic, then persist. On failure revert ONLY this card's status (not a
    // whole-array snapshot) so other edits in flight don't get clobbered.
    setTesters((cur) =>
      cur.map((x) => (x.id === t.id ? { ...x, status } : x))
    );
    const { error } = await supabase
      .from("testers")
      .update({ status })
      .eq("id", t.id);
    if (error) {
      setTesters((cur) =>
        cur.map((x) => (x.id === t.id ? { ...x, status: t.status } : x))
      );
      setActionError(`Couldn't move ${t.name}: ${error.message}`);
    }
  }

  return (
    <section>
      <div className="page-head">
        <h1>Testers</h1>
        <button onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "+ Add tester"}
        </button>
      </div>

      {actionError && <p className="error" role="alert">{actionError}</p>}
      {loadError && (
        <p className="error" role="alert">Couldn't load testers: {loadError}</p>
      )}

      {showForm && user && (
        <AddTesterForm
          ownerId={user.id}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="board">
          {TESTER_STATUSES.map((status) => {
            const inColumn = testers.filter((t) => t.status === status);
            return (
              <div
                key={status}
                id={`status-${status}`}
                className={`board-col${highlighted === status ? " highlighted" : ""}`}
              >
                <h3>
                  {status} <span className="count">{inColumn.length}</span>
                </h3>
                {inColumn.map((t) => (
                  <div key={t.id} className="tester-card">
                    <Link to={`/testers/${t.id}`} className="tester-name">
                      {t.name}
                    </Link>
                    <div className="tester-sub">
                      {t.role ?? "—"}
                      {t.organization ? ` · ${t.organization}` : ""}
                    </div>
                    <select
                      aria-label={`Status for ${t.name}`}
                      value={t.status}
                      onChange={(e) => moveStatus(t, toTesterStatus(e.target.value))}
                    >
                      {TESTER_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                {inColumn.length === 0 && <p className="muted small">empty</p>}
              </div>
            );
          })}
        </div>
      )}

      <div className="row tight pagination">
        <button
          type="button"
          onClick={() => setPage((p) => p - 1)}
          disabled={page === 0 || loading}
        >
          Previous
        </button>
        <span className="muted small">Page {page + 1}</span>
        <button
          type="button"
          onClick={() => setPage((p) => p + 1)}
          disabled={(page + 1) * PAGE_SIZE >= count || loading}
        >
          Next
        </button>
      </div>
    </section>
  );
}

function AddTesterForm({
  ownerId,
  onSaved,
}: {
  ownerId: string;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "",
    organization: "",
    source: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("testers").insert({
      name: form.name,
      email: form.email,
      role: form.role || null,
      organization: form.organization || null,
      source: form.source || null,
      status: "prospect",
      owner: ownerId,
    });
    setSaving(false);
    if (error) setError(error.message);
    else onSaved();
  }

  return (
    <form onSubmit={submit} className="inline-form">
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <input
          placeholder="Name"
          aria-label="Tester name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          placeholder="Email"
          aria-label="Tester email"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </div>
      <div className="row">
        <input
          placeholder="Role (e.g. PM)"
          aria-label="Tester role"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        />
        <input
          placeholder="Organization"
          aria-label="Tester organization"
          value={form.organization}
          onChange={(e) => setForm({ ...form, organization: e.target.value })}
        />
      </div>
      <div className="row">
        <input
          placeholder="Source (referral, conference…)"
          aria-label="Tester source"
          value={form.source}
          onChange={(e) => setForm({ ...form, source: e.target.value })}
        />
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save tester"}
        </button>
      </div>
    </form>
  );
}
