import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { TESTER_STATUSES, type Tester, type TesterStatus } from "../lib/types";

export default function TestersPage() {
  const { user } = useAuth();
  const [testers, setTesters] = useState<Tester[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<TesterStatus | null>(null);
  const location = useLocation();

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("testers")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      setLoadError(error.message);
      setTesters([]);
    } else {
      setLoadError(null);
      setTesters((data as Tester[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

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
    // whole-array snapshot, which would discard any other card the user moved
    // meanwhile), and only if it's still the value we set — so a stale failure
    // can't undo a newer move of the same card.
    setActionError(null);
    setTesters((cur) => cur.map((x) => (x.id === t.id ? { ...x, status } : x)));
    const { error } = await supabase.from("testers").update({ status }).eq("id", t.id);
    if (error) {
      setTesters((cur) =>
        cur.map((x) =>
          x.id === t.id && x.status === status ? { ...x, status: t.status } : x
        )
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

      {actionError && <p className="error">{actionError}</p>}
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
                      value={t.status}
                      onChange={(e) => moveStatus(t, e.target.value as TesterStatus)}
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
      {error && <p className="error">{error}</p>}
      <div className="row">
        <input
          placeholder="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          placeholder="Email"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </div>
      <div className="row">
        <input
          placeholder="Role (e.g. Field Director)"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        />
        <input
          placeholder="Organization"
          value={form.organization}
          onChange={(e) => setForm({ ...form, organization: e.target.value })}
        />
      </div>
      <div className="row">
        <input
          placeholder="Source (referral, RootsCamp…)"
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
