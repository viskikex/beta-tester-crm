import { Navigate, Route, Routes } from "react-router-dom";
import type { JSX } from "react";
import Nav from "./components/Nav";
import DashboardPage from "./pages/DashboardPage";
import TestersPage from "./pages/TestersPage";
import TesterDetailPage from "./pages/TesterDetailPage";
import AdminFeedbackPage from "./pages/AdminFeedbackPage";
import MyFeedbackPage from "./pages/MyFeedbackPage";
import AuthPage from "./pages/AuthPage";
import { useAuth } from "./context/AuthContext";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading, authError } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (authError) return <SessionError message={authError} />;
  if (!user) return <Navigate to="/auth" replace />;
  return children;
}

// Admin-only. Non-admins get bounced to their feedback page.
function RequireAdmin({ children }: { children: JSX.Element }) {
  const { user, isAdmin, loading, authError, profileLoading, profileError } =
    useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (authError) return <SessionError message={authError} />;
  if (!user) return <Navigate to="/auth" replace />;
  // profileLoading (not profile===null) is the real "still loading" signal —
  // a genuinely missing profile row must resolve to an error, not a spinner.
  if (profileLoading) return <p className="muted">Loading…</p>;
  if (profileError) return <SessionError message={profileError} />;
  if (!isAdmin) return <Navigate to="/my-feedback" replace />;
  return children;
}

// Home routes admins to the dashboard, testers to their feedback.
function Home() {
  const { isAdmin, profileLoading, profileError } = useAuth();
  if (profileLoading) return <p className="muted">Loading…</p>;
  if (profileError) return <SessionError message={profileError} />;
  return isAdmin ? <DashboardPage /> : <Navigate to="/my-feedback" replace />;
}

// Shown when the session or profile can't be resolved — replaces the old
// permanent spinner so the user gets an actionable message, not a hang.
function SessionError({ message }: { message: string }) {
  return (
    <div role="alert" className="error">
      <p>Couldn't load your account: {message}</p>
      <button type="button" onClick={() => window.location.reload()}>
        Retry
      </button>
    </div>
  );
}

export default function App() {
  return (
    <>
      <Nav />
      <main className="container">
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
          <Route
            path="/my-feedback"
            element={<RequireAuth><MyFeedbackPage /></RequireAuth>}
          />
          <Route
            path="/testers"
            element={<RequireAdmin><TestersPage /></RequireAdmin>}
          />
          <Route
            path="/testers/:id"
            element={<RequireAdmin><TesterDetailPage /></RequireAdmin>}
          />
          <Route
            path="/feedback"
            element={<RequireAdmin><AdminFeedbackPage /></RequireAdmin>}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
