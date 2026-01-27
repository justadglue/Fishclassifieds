import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../auth";
import OAuthButtons from "../components/OAuthButtons";
import BackToButton from "../components/nav/BackToButton";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function renderErr(e: string) {
    const contactLine = "If you believe this is a mistake, please contact support.";
    if (!e.includes(contactLine)) return e;
    const lines = e.split("\n");
    return (
      <div className="grid gap-1">
        {lines.map((line, idx) => {
          if (line.trim() !== contactLine) {
            return (
              <div key={idx} className="whitespace-pre-line">
                {line}
              </div>
            );
          }
          return (
            <div key={idx}>
              If you believe this is a mistake, please{" "}
              <Link to="/contact" className="font-extrabold underline underline-offset-4">
                contact support
              </Link>
              .
            </div>
          );
        })}
      </div>
    );
  }

  function formatAuthError(e: any): string {
    const msg = String(e?.message ?? "Login failed");
    // Fallback: sometimes the error bubbles up as ApiError.message: "API 403:{json}"
    // Convert that into a user-friendly message.
    if (msg.startsWith("API 403:")) {
      const raw = msg.slice("API 403:".length).trim();
      try {
        const parsed = JSON.parse(raw) as any;
        const code = String(parsed.code ?? "");
        const reason = parsed.reason != null ? String(parsed.reason) : null;
        const suspendedUntil = parsed.suspendedUntil != null ? Number(parsed.suspendedUntil) : null;
        if (code === "ACCOUNT_BANNED") {
          return ["Your account has been banned.", `Reason: ${reason ? reason : "Not provided"}`, "If you believe this is a mistake, please contact support."].join("\n");
        }
        if (code === "ACCOUNT_SUSPENDED") {
          const untilStr =
            suspendedUntil != null && Number.isFinite(suspendedUntil) ? new Date(suspendedUntil).toLocaleString() : null;
          return [
            "Your account has been suspended.",
            `Until: ${untilStr ? untilStr : "Further notice"}`,
            `Reason: ${reason ? reason : "Not provided"}`,
            "If you believe this is a mistake, please contact support.",
          ].join("\n");
        }
      } catch {
        // ignore
      }
    }
    return msg;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await login({ email: email.trim(), password });
      navigate("/");
    } catch (e: any) {
      setErr(formatAuthError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Login</h1>
        <p className="mt-1 text-sm text-slate-600">Sign in to your account.</p>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{renderErr(err)}</div>}

        <form onSubmit={onSubmit} className="mt-6 grid gap-4">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
          />
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
          />
          <div className="-mt-2 flex justify-end">
            <Link to="/forgot-password" className="text-sm font-semibold text-slate-700 underline underline-offset-4 hover:text-slate-900">
              Forgot password?
            </Link>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-xl border border-slate-900 bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>

        <OAuthButtons intent="signin" />

        <div className="mt-6 flex items-center justify-between gap-4 text-sm">
          <BackToButton fallbackTo="/" fallbackLabel="home" className="text-sm font-semibold text-slate-600 hover:text-slate-900" />
          <div className="text-right">
            <div className="text-xs font-semibold text-slate-600">Don’t have an account?</div>
            <Link to="/signup" className="font-semibold text-slate-900 underline underline-offset-4">
              Create account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
