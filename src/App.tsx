import { useCallback, useEffect, useState } from "react";
import { fetchAuthState, logoutAdmin } from "./api";
import { AdminLogin } from "./components/AdminLogin";
import { Dashboard } from "./components/Dashboard";
import type { AuthStateResponse } from "./types";

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  const loadAuthState = useCallback(async (currentToken: string | null) => {
    setBootError(null);
    try {
      const state = await fetchAuthState(currentToken);
      setAuthState(state);
      if (!state.authenticated && currentToken) {
        setToken(null);
      }
    } catch (err) {
      setBootError(err instanceof Error ? err.message : "Cannot reach backend server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAuthState(token);
  }, [loadAuthState, token]);

  const handleAuthenticated = (newToken: string, username: string) => {
    setToken(newToken);
    setAuthState((prev) => ({
      ok: true,
      authenticated: true,
      username,
      adminUsername: prev?.adminUsername || username,
      needsSetup: false
    }));
  };

  const handleLogout = async () => {
    await logoutAdmin(token);
    setToken(null);
    await loadAuthState(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="text-sm text-slate-600">Loading console...</div>
      </div>
    );
  }

  if (bootError && !authState) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-sm rounded-xl border border-red-200 bg-white p-6 text-center">
          <p className="text-sm font-medium text-red-700">{bootError}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              loadAuthState(token);
            }}
            className="mt-4 inline-flex min-h-[40px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!token || !authState?.authenticated) {
    return (
      <AdminLogin
        adminUsername={authState?.adminUsername || "admin"}
        needsSetup={Boolean(authState?.needsSetup)}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  return (
    <Dashboard
      token={token}
      adminUsername={authState.username || authState.adminUsername || "admin"}
      onLogout={handleLogout}
    />
  );
}
