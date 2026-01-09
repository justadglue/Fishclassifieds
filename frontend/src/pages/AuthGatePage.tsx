import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { authRegister } from "../api";
import { useAuth } from "../auth";

function safeNext(sp: URLSearchParams) {
  const next = sp.get("next");
  if (next && next.startsWith("/")) return next;
  return null;
}

export default function AuthGatePage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const next = safeNext(sp);

  const { user, loading: authLoading, login } = useAuth();

  // If already authenticated, skip this page.
  useEffect(() => {
    if (authLoading) return;
    if (user) navigate(next ?? "/", { replace: true });
  }, [authLoading, user, next, navigate]);

  // --- Sign up state ---
  const [suEmail, setSuEmail] = useState("");
  const [suFirstName, setSuFirstName] = useState("");
  const [suSurname, setSuSurname] = useState("");
  const [suUsername, setSuUsername] = useState("");
  const [suPassword, setSuPassword] = useState("");
  const [suConfirm, setSuConfirm] = useState("");
  const [suAgree, setSuAgree] = useState(false);
  const [suLoading, setSuLoading] = useState(false);
  const [suErr, setSuErr] = useState<string | null>(null);

  const suEmailOk = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(suEmail.trim()), [suEmail]);
  const suUsernameOk = useMemo(() => /^[a-zA-Z0-9_]{3,20}$/.test(suUsername), [suUsername]);
  const suPwOk = useMemo(() => suPassword.length >= 10, [suPassword]);
  const suMatchOk = useMemo(() => suPassword === suConfirm && suConfirm.length > 0, [suPassword, suConfirm]);
  const suCanSubmit =
    suEmailOk &&
    suFirstName.trim().length >= 2 &&
    suSurname.trim().length >= 2 &&
    suUsernameOk &&
    suPwOk &&
    suMatchOk &&
    suAgree;

  async function onSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!suCanSubmit || suLoading) return;
    setSuErr(null);
    setSuLoading(true);
    try {
      const displayName = `${suFirstName.trim()} ${suSurname.trim()}`.trim();
      await authRegister({
        email: suEmail.trim(),
        username: suUsername.trim(),
        password: suPassword,
        displayName,
      });
      await login({ email: suEmail.trim(), password: suPassword });
      navigate(next ?? "/me", { replace: true });
    } catch (e: any) {
      setSuErr(e?.message ?? "Sign up failed");
    } finally {
      setSuLoading(false);
    }
  }

  // --- Login state ---
  const [liEmail, setLiEmail] = useState("");
  const [liPassword, setLiPassword] = useState("");
  const [liLoading, setLiLoading] = useState(false);
  const [liErr, setLiErr] = useState<string | null>(null);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    if (liLoading) return;
    setLiErr(null);
    setLiLoading(true);
    try {
      await login({ email: liEmail.trim(), password: liPassword });
      navigate(next ?? "/", { replace: true });
    } catch (e: any) {
      setLiErr(e?.message ?? "Login failed");
    } finally {
      setLiLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
            ← Back to home
          </Link>
          <div className="text-sm text-slate-600">
            {next ? (
              <span>
                Continue to <span className="font-semibold text-slate-900">{next}</span> after signing in.
              </span>
            ) : (
              <span>Sign in to access account features.</span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mx-auto grid w-full max-w-3xl gap-6">
          {/* Create account */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Create account</h1>
            <p className="mt-1 text-sm text-slate-600">Sign up to post listings, wanted posts, and manage your account.</p>

            {suErr && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{suErr}</div>
            )}

            <form onSubmit={onSignUp} className="mt-6 grid gap-3">
              <input
                type="email"
                required
                value={suEmail}
                onChange={(e) => setSuEmail(e.target.value)}
                placeholder="Email address"
                className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                autoComplete="email"
              />

              <div className="grid grid-cols-2 gap-3">
                <input
                  required
                  value={suFirstName}
                  onChange={(e) => setSuFirstName(e.target.value)}
                  placeholder="First name"
                  className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                  autoComplete="given-name"
                />
                <input
                  required
                  value={suSurname}
                  onChange={(e) => setSuSurname(e.target.value)}
                  placeholder="Surname"
                  className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                  autoComplete="family-name"
                />
              </div>

              <input
                required
                value={suUsername}
                onChange={(e) => setSuUsername(e.target.value)}
                placeholder="Username (letters, numbers, underscore)"
                className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                autoComplete="username"
              />

              <input
                type="password"
                required
                value={suPassword}
                onChange={(e) => setSuPassword(e.target.value)}
                placeholder="Password (10+ chars)"
                className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                autoComplete="new-password"
              />

              <input
                type="password"
                required
                value={suConfirm}
                onChange={(e) => setSuConfirm(e.target.value)}
                placeholder="Confirm password"
                className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                autoComplete="new-password"
              />

              <label className="mt-2 flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={suAgree}
                  onChange={(e) => setSuAgree(e.target.checked)}
                  className="mt-1"
                />
                <span>I agree to basic marketplace rules (no scams, be respectful, accurate listings).</span>
              </label>

              <button
                type="submit"
                disabled={!suCanSubmit || suLoading || authLoading}
                className="mt-2 rounded-xl border border-slate-900 bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {suLoading ? "Creating..." : "Create account"}
              </button>

              <div className="text-xs font-semibold text-slate-500">
                Password must be at least 10 characters. Username: 3–20 characters (letters/numbers/underscore).
              </div>
            </form>
          </section>

          {/* Login */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <h2 className="text-xl font-extrabold tracking-tight text-slate-900">Sign in</h2>
              <div className="text-sm text-slate-600">
                Prefer separate pages? <Link to="/login" className="font-semibold text-slate-900 underline underline-offset-4">Login</Link>{" "}
                /{" "}
                <Link to="/signup" className="font-semibold text-slate-900 underline underline-offset-4">Sign up</Link>
              </div>
            </div>

            {liErr && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{liErr}</div>
            )}

            <form onSubmit={onLogin} className="mt-6 grid gap-4">
              <input
                type="email"
                required
                value={liEmail}
                onChange={(e) => setLiEmail(e.target.value)}
                placeholder="Email address"
                className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                autoComplete="email"
              />
              <input
                type="password"
                required
                value={liPassword}
                onChange={(e) => setLiPassword(e.target.value)}
                placeholder="Password"
                className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                autoComplete="current-password"
              />
              <button
                type="submit"
                disabled={liLoading || authLoading}
                className="mt-2 rounded-xl border border-slate-900 bg-white px-4 py-3 text-sm font-extrabold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
              >
                {liLoading ? "Signing in..." : "Sign in"}
              </button>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}

