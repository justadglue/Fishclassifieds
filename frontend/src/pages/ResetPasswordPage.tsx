import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import BackToButton from "../components/nav/BackToButton";
import { resetPassword } from "../api";

export default function ResetPasswordPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const qs = useMemo(() => new URLSearchParams(loc.search), [loc.search]);
  const email = qs.get("email") ?? "";
  const token = qs.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const canSubmit = password.length >= 10 && password === confirm && !!email && !!token;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await resetPassword(email.trim(), token.trim(), password);
      setOk(true);
      window.setTimeout(() => nav("/login"), 500);
    } catch (e: any) {
      setErr(e?.message ?? "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Reset password</h1>
        <p className="mt-1 text-sm text-slate-600">Choose a new password for your account.</p>

        {!email || !token ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            This reset link is missing required information.
          </div>
        ) : null}

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}
        {ok ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            Password updated. Redirecting to login…
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-6 grid gap-4">
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password (min 10 chars)"
            className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
          />
          <input
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
          />
          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="mt-2 rounded-xl border border-slate-900 bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {loading ? "Updating..." : "Update password"}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between gap-4 text-sm">
          <BackToButton fallbackTo="/login" fallbackLabel="login" className="text-sm font-semibold text-slate-600 hover:text-slate-900" />
          <Link to="/forgot-password" className="font-semibold text-slate-900 underline underline-offset-4">
            Request a new link
          </Link>
        </div>
      </div>
    </div>
  );
}

