import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";

export default function AuthPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);

    const { data, error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setBusy(false);

    if (error) {
      setMessage(error.message);
      return;
    }
    if (mode === "signin") {
      navigate("/");
      return;
    }
    // Signup: only tell people to check their email when confirmation is actually
    // required. If the project has email confirmation off, signUp returns a live
    // session and they're already in — sending them to "check your email" would
    // strand them.
    if (data.session) navigate("/");
    else setMessage("Account created. Check your email to confirm, then sign in.");
  }

  return (
    <section className="form-page narrow">
      <h1>{mode === "signin" ? "Sign in" : "Create an account"}</h1>
      <p className="muted">Manage your beta tester program.</p>
      {message && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}
      <form onSubmit={handleSubmit} className="stack">
        <label>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            // Only enforce a minimum when creating a password; on sign-in the
            // password already exists, so a client minLength just risks blocking
            // a valid (older, shorter) one.
            minLength={mode === "signup" ? 6 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
      </form>
      <button
        className="link-btn"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
      >
        {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
      </button>
    </section>
  );
}
