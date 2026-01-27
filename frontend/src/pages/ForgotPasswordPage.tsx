import { useState } from "react";
import { Link } from "react-router-dom";
import { requestPasswordReset } from "../api";
import BackToButton from "../components/nav/BackToButton";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      setDone(true);
    } catch (e: any) {
      // Still keep message generic (avoid any account enumeration).
      setErr(e?.message ?? "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Forgot password</h1>
        <p className="mt-1 text-sm text-slate-600">We’ll send a reset link if the email exists.</p>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}
        {done ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            If an account exists for that email, a reset link will be sent shortly.
            <div className="mt-2 text-xs text-emerald-900">
              (Dev mode: the server logs the reset link to the backend console.)
            </div>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-6 grid gap-4">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
          />
          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-xl border border-slate-900 bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {loading ? "Sending..." : "Send reset link"}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between gap-4 text-sm">
          <BackToButton fallbackTo="/login" fallbackLabel="login" className="text-sm font-semibold text-slate-600 hover:text-slate-900" />
          <Link to="/login" className="font-semibold text-slate-900 underline underline-offset-4">
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}

