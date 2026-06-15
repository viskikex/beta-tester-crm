import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { TESTER_STATUSES, type Session, type TesterStatus } from "../lib/types";
import { one } from "../lib/embed";

type Counts = Record<TesterStatus, number>;

export default function DashboardPage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [upcoming, setUpcoming] = useState<Session[]>([]);
  const [newFeedback, setNewFeedback] = useState(0);

  useEffect(() => {
    async function run() {
      const { data: testers } = await supabase.from("testers").select("status");
      const c: Counts = { prospect: 0, invited: 0, active: 0, inactive: 0 };
      (testers ?? []).forEach((t) => {
        // Only count known statuses — a drifted/unexpected value would make
        // c[status] NaN and poison the whole grid.
        const s = t.status as TesterStatus;
        if (TESTER_STATUSES.includes(s)) c[s] += 1;
      });
      setCounts(c);

      const { data: sessions } = await supabase
        .from("sessions")
        .select("*, tester:testers(id,name)")
        .eq("status", "scheduled")
        .order("scheduled_at", { ascending: true })
        .limit(5);
      setUpcoming(
        ((sessions as Session[]) ?? []).map((s) => ({
          ...s,
          tester: one(s.tester),
        }))
      );

      // Untriaged feedback waiting on you.
      const { count } = await supabase
        .from("feedback")
        .select("*", { count: "exact", head: true })
        .eq("status", "new")
        .is("merged_into", null);
      setNewFeedback(count ?? 0);
    }
    run();
  }, []);

  return (
    <section>
      <h1>Program overview</h1>

      <div className="stat-grid">
        {TESTER_STATUSES.map((s) => (
          <Link key={s} to={`/testers#status-${s}`} className="stat-card">
            <span className="stat-num">{counts ? counts[s] : "—"}</span>
            <span className="stat-label">{s}</span>
          </Link>
        ))}
        <Link to="/feedback" className="stat-card highlight">
          <span className="stat-num">{newFeedback}</span>
          <span className="stat-label">new feedback</span>
        </Link>
      </div>

      <h2>Upcoming sessions</h2>
      {upcoming.length === 0 ? (
        <p className="muted">
          Nothing scheduled. Go to <Link to="/testers">Testers</Link> to book one.
        </p>
      ) : (
        <ul className="plain-list">
          {upcoming.map((s) => (
            <li key={s.id}>
              <strong>{new Date(s.scheduled_at).toLocaleString()}</strong>
              {" — "}
              <Link to={`/testers/${s.tester_id}`}>{s.tester?.name ?? "tester"}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
