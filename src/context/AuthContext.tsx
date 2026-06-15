import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Profile } from "../lib/types";

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  // Auth session resolving (getSession + first onAuthStateChange).
  loading: boolean;
  // getSession() failed (e.g. offline at startup). Without surfacing this the app
  // would otherwise sit on a permanent spinner.
  authError: string | null;
  // Profile row fetch in flight. This is a SEPARATE signal from profile===null:
  // null means "no row" (trigger didn't fire / genuinely missing), not "loading".
  profileLoading: boolean;
  profileError: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    // Two-arg then (not a bare .then): the reject branch still releases loading,
    // so a network failure at startup can't pin the app on a spinner forever.
    supabase.auth.getSession().then(
      ({ data }) => {
        setSession(data.session);
        setLoading(false);
      },
      (err) => {
        setAuthError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    );

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // Load the profile (which carries is_admin) whenever the user changes.
  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setProfileError(null);
      setProfileLoading(false);
      return;
    }
    let cancelled = false;
    setProfileLoading(true);
    setProfileError(null);
    supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle()
      .then(
        ({ data, error }) => {
          if (cancelled) return;
          // Surface the fetch error instead of swallowing it — an RLS/network
          // failure must not masquerade as "no profile" (which reads as admin=false).
          if (error) {
            setProfileError(error.message);
            setProfile(null);
          } else {
            setProfile((data as Profile) ?? null);
          }
          setProfileLoading(false);
        },
        (err) => {
          if (cancelled) return;
          setProfileError(err instanceof Error ? err.message : String(err));
          setProfile(null);
          setProfileLoading(false);
        }
      );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const value: AuthState = {
    session,
    user: session?.user ?? null,
    profile,
    isAdmin: profile?.is_admin ?? false,
    loading,
    authError,
    profileLoading,
    profileError,
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
