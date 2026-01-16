import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authLogin, authLogout, authMe, authRefresh, setAuthFailureHandler, type AuthUser } from "./api";

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Keep React auth state in sync if refresh fails anywhere in the app.
    setAuthFailureHandler(() => {
      setUser(null);
    });
    return () => setAuthFailureHandler(null);
  }, []);

  async function loadMeWithRefreshFallback() {
    setError(null);
    try {
      const me = await authMe();
      setUser(me.user as any);
      return;
    } catch (e: any) {
      const msg = e?.message ?? "Not authenticated";
      const looksUnauthorized = msg.includes("401") || msg.toLowerCase().includes("not authenticated");
      if (!looksUnauthorized) {
        setUser(null);
        setError(msg);
        return;
      }
    }

    try {
      await authRefresh();
      const me2 = await authMe();
      setUser(me2.user as any);
    } catch {
      setUser(null);
    }
  }

  async function refresh() {
    setLoading(true);
    try {
      await loadMeWithRefreshFallback();
    } finally {
      setLoading(false);
    }
  }

  async function login(input: { email: string; password: string }) {
    setError(null);
    const res = await authLogin(input);
    setUser(res.user);
  }

  async function logout() {
    setError(null);
    try {
      await authLogout();
    } finally {
      setUser(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadMeWithRefreshFallback();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      error,
      refresh,
      login,
      logout,
    }),
    [user, loading, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
