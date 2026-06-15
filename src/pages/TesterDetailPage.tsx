import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import type { Session, Tester } from "../lib/types";

export default function TesterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [tester, setTester] = useState<Tester | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!id) return;
    const [{ data: t }, { data: s }] = await Promise.all([
      supabase.from("testers").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("sessions")
        .select("*")
        .eq("tester_id", id)
        .order("scheduled_at", { ascending: false }),
    ]);
    setTester((t as Tester) ?? null);
    setSessions((s as Session[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <p className="muted">Loading…</p>;
  if (!tester)
    return (
      <p className="muted">
        Tester not found. <Link to="/testers">Back</Link>
      </p>
    );

  return (
    <section>
      <Link to="/testers" className="muted">
        ← All testers
      </Link>
      <h1>{tester.name}</h1>
      <p className="muted">
        {[tester.role, tester.organization].filter(Boolean).join(" · ") || "—"} ·{" "}
        <span className="tag">{tester.status}</span>
      </p>
      <p className="muted">{tester.email}</p>

      <h2>Sessions</h2>
      {user && id && (
        <ScheduleSessionForm ownerId={user.id} testerId={id} onSaved={load} />
      )}
      {sessions.length === 0 ? (
        <p className="muted small">No sessions yet.</p>
      ) : (
        <ul className="plain-list">
          {sessions.map((s) => (
            <li key={s.id}>
              <strong>{new Date(s.scheduled_at).toLocaleString()}</strong>{" "}
              <span className="tag">{s.status}</span>
              {s.notes && <div className="muted small">{s.notes}</div>}
              <SessionStatusControl session={s} onChanged={load} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ScheduleSessionForm({
  ownerId,
  testerId,
  onSaved,
}: {
  ownerId: string;
  testerId: string;
  onSaved: () => void;
}) {
  // Separate date + time inputs: a single datetime-local renders inconsistently
  // across browsers (the time can read as locked to "now"), so split them.
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !time) return;
    const scheduled = new Date(`${date}T${time}`); // parsed in local time
    if (Number.isNaN(scheduled.getTime())) {
      setError("That date and time didn't parse — please re-check.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("sessions").insert({
      tester_id: testerId,
      scheduled_at: scheduled.toISOString(),
      status: "scheduled",
      owner: ownerId,
    });
    setSaving(false);
    if (error) {
      setError(`Couldn't schedule: ${error.message}`);
      return;
    }
    setDate("");
    setTime("");
    onSaved();
  }

  return (
    <>
      <form onSubmit={submit} className="row tight">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        <button type="submit" disabled={saving || !date || !time}>
          Schedule
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}

function SessionStatusControl({
  session,
  onChanged,
}: {
  session: Session;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function change(status: string) {
    setError(null);
    setSaving(true);
    const { error } = await supabase
      .from("sessions")
      .update({ status })
      .eq("id", session.id);
    setSaving(false);
    if (error) {
      // Don't reload() on failure — that would silently snap the select back to
      // the old value and hide that nothing was saved. Surface it instead.
      setError(`Couldn't update session: ${error.message}`);
      return;
    }
    onChanged();
  }

  return (
    <>
      <select
        value={session.status}
        disabled={saving}
        onChange={(e) => change(e.target.value)}
      >
        <option value="scheduled">scheduled</option>
        <option value="completed">completed</option>
        <option value="no_show">no_show</option>
        <option value="canceled">canceled</option>
      </select>
      {error && (
        <span role="alert" className="error small">
          {error}
        </span>
      )}
    </>
  );
}
