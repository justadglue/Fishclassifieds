import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authRegister, authLogin } from "../api";

export default function SignUpPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agree, setAgree] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const emailOk = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()), [email]);
  const usernameOk = useMemo(() => /^[a-zA-Z0-9_]{3,20}$/.test(username), [username]);
  const pwOk = useMemo(() => password.length >= 10, [password]);
  const matchOk = useMemo(() => password === confirm && confirm.length > 0, [password, confirm]);

  const canSubmit =
    emailOk &&
    firstName.trim().length >= 2 &&
    surname.trim().length >= 2 &&
    usernameOk &&
    pwOk &&
    matchOk &&
    agree;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setErr(null);
    setLoading(true);

    try {
      const displayName = `${firstName.trim()} ${surname.trim()}`.trim();

      await authRegister({
        email: email.trim(),
        username: username.trim(),
        password,
        displayName,
      });

      await authLogin({ email: email.trim(), password });
      navigate("/me");
    } catch (e: any) {
      setErr(e?.message ?? "Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="text-sm font-semibold text-slate-600 hover:text-slate-900">
            ← Back to home
          </button>
          <div className="text-sm text-slate-600">
            Already have an account?{" "}
            <button
              onClick={() => navigate("/login")}
              className="font-semibold text-slate-900 underline underline-offset-4"
            >
              Login
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Create your account</h1>
          <p className="mt-2 text-sm text-slate-600">Create an account to manage your ads.</p>

          {err && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>
          )}

          <form onSubmit={onSubmit} className="mt-6 grid gap-4">
            <div>
              <label className="text-sm font-semibold text-slate-800">Email</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="you@example.com"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
              />
              {!emailOk && email && <div className="mt-1 text-xs text-red-700">Enter a valid email address.</div>}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="text-sm font-semibold text-slate-800">First name</label>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-800">Surname</label>
                <input
                  value={surname}
                  onChange={(e) => setSurname(e.target.value)}
                  placeholder="Surname"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-800">Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. adam_g"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              {!usernameOk && username && (
                <div className="mt-1 text-xs text-red-700">3–20 chars: letters, numbers, underscore only.</div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="text-sm font-semibold text-slate-800">Password</label>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  placeholder="At least 10 characters"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                />
                {!pwOk && password && <div className="mt-1 text-xs text-red-700">Password must be 10+ chars.</div>}
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-800">Confirm</label>
                <input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  type="password"
                  placeholder="Re-enter password"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
                />
                {!matchOk && confirm && <div className="mt-1 text-xs text-red-700">Passwords must match.</div>}
              </div>
            </div>

            <label className="mt-2 flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300"
              />
              <span>
                I agree to the terms (placeholder). You can replace this with real terms later.
              </span>
            </label>

            <button
              type="submit"
              disabled={!canSubmit || loading}
              className="mt-2 rounded-xl border border-slate-900 bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {loading ? "Creating account..." : "Create account"}
            </button>

            <button
              type="button"
              onClick={() => navigate("/")}
              className="text-sm font-semibold text-slate-600 hover:text-slate-900"
            >
              ← Back to home
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
