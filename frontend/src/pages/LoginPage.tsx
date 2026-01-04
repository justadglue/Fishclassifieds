import { useState } from "react";
import { useNavigate } from "react-router-dom";

type Props = {
  onBack: () => void;
};

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Placeholder – hook backend auth later
    alert(`Login attempted for ${email}`);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          Login
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Sign in to manage your listings
        </p>

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

          <button
            type="submit"
            className="mt-2 rounded-xl border border-slate-900 bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800"
          >
            Login
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between text-sm">
          <button
            onClick={() => navigate("/")}
            className="font-semibold text-slate-600 hover:text-slate-900"
            >
                ← Back to home
            </button>
          <button
            type="button"
            className="font-semibold text-cyan-700 hover:text-cyan-900"
          >
            Create account
          </button>
        </div>
      </div>
    </div>
  );
}
