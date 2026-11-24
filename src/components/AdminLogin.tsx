import React, { useState } from "react";
import { AlertCircle, Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { claimAdminAccount, loginAdmin } from "../api";

interface AdminLoginProps {
  adminUsername: string;
  needsSetup: boolean;
  onAuthenticated: (token: string, username: string) => void;
}

export function AdminLogin({ adminUsername, needsSetup, onAuthenticated }: AdminLoginProps) {
  const [username, setUsername] = useState(adminUsername || "admin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError("Ilagay ang admin username at password.");
      return;
    }

    if (needsSetup) {
      if (password.length < 8) {
        setError("Ang admin password ay dapat hindi bababa sa 8 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Hindi tugma ang confirm password.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = needsSetup
        ? await claimAdminAccount(username.trim(), password)
        : await loginAdmin(username.trim(), password);

      if (!res.token) {
        throw new Error("Walang natanggap na session token mula sa server.");
      }
      onAuthenticated(res.token, res.username || username.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nabigo ang pag-login.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8">
          <div className="flex items-center gap-2.5 text-slate-900">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-900">
              {needsSetup ? <ShieldCheck className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </div>
            <span className="text-lg font-semibold tracking-tight">Banat Console</span>
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900 text-balance">
            {needsSetup ? "Initial Admin Password Setup" : "Admin Sign In"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {needsSetup
              ? "Walang naka-configure na ADMIN_PASSWORD secret sa server. Itakda ang nag-iisang admin password para i-lock ang dashboard access."
              : "Single-admin access lamang. Mag-sign in para pamahalaan ang Facebook session, JSON cookies, at bot status."}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="admin-username" className="block text-sm font-medium text-slate-800">
                Admin Username
              </label>
              <input
                id="admin-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                readOnly={needsSetup}
                className="mt-1.5 block w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 read-only:bg-slate-50 read-only:text-slate-600"
                placeholder="admin"
              />
            </div>

            <div>
              <label htmlFor="admin-password" className="block text-sm font-medium text-slate-800">
                {needsSetup ? "New Admin Password (min. 8 chars)" : "Password"}
              </label>
              <div className="relative mt-1.5">
                <input
                  id="admin-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={needsSetup ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full min-h-[44px] rounded-lg border border-slate-300 bg-white pl-3.5 pr-11 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                  placeholder="Enter admin password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-800 focus-visible:outline-none"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {needsSetup && (
              <div>
                <label htmlFor="admin-confirm-password" className="block text-sm font-medium text-slate-800">
                  Confirm Admin Password
                </label>
                <input
                  id="admin-confirm-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1.5 block w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                  placeholder="Re-enter admin password"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 flex w-full min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
            >
              {submitting
                ? needsSetup
                  ? "Saving Password..."
                  : "Signing In..."
                : needsSetup
                ? "Set Admin Password & Continue"
                : "Sign In"}
            </button>
          </form>

          <div className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">
            Single-admin portal · No public sign-up
          </div>
        </div>
      </div>
    </div>
  );
}
