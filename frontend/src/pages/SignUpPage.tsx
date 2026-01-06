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
          <button
            onClick={() => navigate("/")}
            className="text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
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

      <main className="mx-auto flex max-w-6xl justify-center px-6 py-10">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Create account</h1>
          <p className="mt-1 text-sm text-slate-600">Sign up to manage your listings.</p>

          {err && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {err}
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-6 grid gap-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
            />

            <div className="grid grid-cols-2 gap-3">
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
              />
              <input
                required
                value={surname}
                onChange={(e) => setSurname(e.target.value)}
                placeholder="Surname"
                className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
              />
            </div>

            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username (letters, numbers, underscore)"
              className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
            />

            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (10+ chars)"
              className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
            />

            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
            />

            <label className="mt-2 flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="mt-1"
              />
              <span>I agree to basic marketplace rules (no scams, be respectful, accurate listings).</span>
            </label>

            <button
              type="submit"
              disabled={!canSubmit || loading}
              className="mt-2 rounded-xl border border-slate-900 bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {loading ? "Creating..." : "Create account"}
            </button>
          </form>

          <div className="mt-6 text-sm text-slate-600">
            Tip: your username becomes part of your profile later (if you add one).
          </div>
        </div>
      </main>
    </div>
  );
}
