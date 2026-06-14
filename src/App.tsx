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
  const { user, loading } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!user) return <Navigate to="/auth" replace />;
  return children;
}

// Admin-only. Non-admins get bounced to their feedback page.
function RequireAdmin({ children }: { children: JSX.Element }) {
  const { user, isAdmin, loading, profile } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!user) return <Navigate to="/auth" replace />;
  // profile may still be loading on first paint after auth resolves
  if (profile === null) return <p className="muted">Loading…</p>;
  if (!isAdmin) return <Navigate to="/my-feedback" replace />;
  return children;
}

// Home routes admins to the dashboard, testers to their feedback.
function Home() {
  const { isAdmin, profile } = useAuth();
  if (profile === null) return <p className="muted">Loading…</p>;
  return isAdmin ? <DashboardPage /> : <Navigate to="/my-feedback" replace />;
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
