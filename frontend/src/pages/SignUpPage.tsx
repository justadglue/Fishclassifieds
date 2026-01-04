import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function SignUpPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [username, setUsername] = useState("");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [agree, setAgree] = useState(false);
  const [newsletter, setNewsletter] = useState(true);

  const emailOk = useMemo(
    () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()),
    [email]
  );

  const usernameOk = useMemo(
    () => /^[a-zA-Z0-9_]{3,20}$/.test(username),
    [username]
  );

  const pwOk = useMemo(() => password.length >= 8, [password]);
  const matchOk = useMemo(() => password === confirm && confirm.length > 0, [password, confirm]);

  const canSubmit =
    emailOk &&
    firstName.trim().length >= 2 &&
    surname.trim().length >= 2 &&
    usernameOk &&
    pwOk &&
    matchOk &&
    agree;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    // TODO: POST /api/auth/signup
    alert("Account creation (stub). Wire to backend next.");
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

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Create your account
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Create an account to post listings, contact sellers, and manage your ads.
          </p>

          <form onSubmit={onSubmit} className="mt-6 grid gap-4">
            {/* Email */}
            <div>
              <label className="text-sm font-semibold text-slate-800">Email</label>
              <p className="mt-1 text-xs text-slate-500">
                Used for login and important account notifications.
              </p>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="you@example.com"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
              />
              {!emailOk && email && (
                <div className="mt-1 text-xs text-red-700">
                  Enter a valid email address.
                </div>
              )}
            </div>

            {/* First + Surname */}
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

            {/* Username */}
            <div>
              <label className="text-sm font-semibold text-slate-800">Username</label>
              <p className="mt-1 text-xs text-slate-500">
                This is public and <span className="font-semibold">cannot be changed later</span>.
                Letters, numbers, and underscores only.
              </p>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. reef_keeper92"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
              />
              {!usernameOk && username && (
                <div className="mt-1 text-xs text-red-700">
                  3–20 characters. Letters, numbers, underscores only.
                </div>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="text-sm font-semibold text-slate-800">Password</label>
              <p className="mt-1 text-xs text-slate-500">
                Minimum 8 characters. Use a strong, unique password.
              </p>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="••••••••"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
              />
            </div>

            {/* Confirm */}
            <div>
              <label className="text-sm font-semibold text-slate-800">Confirm password</label>
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                type="password"
                placeholder="••••••••"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-900"
              />
              {!matchOk && confirm && (
                <div className="mt-1 text-xs text-red-700">Passwords do not match.</div>
              )}
            </div>

            {/* Agreements */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="flex gap-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={agree}
                  onChange={(e) => setAgree(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  I agree to the <strong>Terms of Service</strong> and{" "}
                  <strong>Privacy Policy</strong>.
                </span>
              </label>

              <label className="mt-3 flex gap-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={newsletter}
                  onChange={(e) => setNewsletter(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  Send me occasional updates and announcements (optional).
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className={[
                "rounded-xl border px-4 py-3 text-sm font-extrabold transition",
                canSubmit
                  ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
                  : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500"
              ].join(" ")}
            >
              Create account
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
