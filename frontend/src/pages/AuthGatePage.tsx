import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import OAuthButtons from "../components/OAuthButtons";

function safeNext(sp: URLSearchParams) {
  const next = sp.get("next");
  if (next && next.startsWith("/")) return next;
  return null;
}

type AuthGateCtx =
  | "create_listing"
  | "edit_listing"
  | "feature_listing"
  | "my_listings"
  | "profile"
  | "wanted_post"
  | "wanted_edit"
  | "message";

function normalizeCtx(raw: string | null, next: string | null): AuthGateCtx | null {
  const v = (raw ?? "").trim();
  if (v) return v as AuthGateCtx;

  // Derive a sensible default from `next` when no explicit context is provided.
  if (!next) return null;
  if (next === "/post/sale") return "create_listing";
  if (next.startsWith("/edit/")) return "edit_listing";
  if (next.startsWith("/feature/")) return "feature_listing";
  if (next === "/me") return "my_listings";
  if (next === "/profile") return "profile";
  if (next === "/post/wanted") return "wanted_post";
  if (next.startsWith("/edit/wanted/")) return "wanted_edit";
  if (next.startsWith("/listing/wanted/")) return "message";
  return null;
}

function ctxCopy(ctx: AuthGateCtx | null) {
  switch (ctx) {
    case "create_listing":
      return {
        title: "Sign in to create a listing",
        body: "To create a listing, you’ll need to register or sign in. Sign in below, or create an account if you’re new here.",
      };
    case "edit_listing":
      return {
        title: "Sign in to edit your listing",
        body: "Your listings are tied to your account. Sign in below to edit them.",
      };
    case "feature_listing":
      return {
        title: "Sign in to manage featuring",
        body: "Featuring and promotion tools require an account. Sign in below to continue.",
      };
    case "my_listings":
      return {
        title: "Sign in to manage your listings",
        body: "Your listings are tied to your account. Sign in below to manage them.",
      };
    case "profile":
      return {
        title: "Sign in to access your profile",
        body: "Profile and account settings require you to be signed in.",
      };
    case "wanted_post":
      return {
        title: "Sign in to create a wanted post",
        body: "To create a wanted post, you’ll need to register or sign in. Sign in below, or create an account if needed.",
      };
    case "wanted_edit":
      return {
        title: "Sign in to edit your wanted post",
        body: "Editing wanted posts requires you to be signed in.",
      };
    case "message":
      return {
        title: "Sign in to continue",
        body: "This action requires an account. Sign in below, or create one if you don’t have an account yet.",
      };
    default:
      return {
        title: "Sign in to continue",
        body: "Some features require an account. Register or sign in below to continue.",
      };
  }
}

export default function AuthGatePage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const next = safeNext(sp);
  const ctx = useMemo(() => normalizeCtx(sp.get("ctx"), next), [sp, next]);
  const copy = useMemo(() => ctxCopy(ctx), [ctx]);

  const { user, loading: authLoading, login } = useAuth();

  // If already authenticated, skip this page.
  useEffect(() => {
    if (authLoading) return;
    if (user) navigate(next ?? "/", { replace: true });
  }, [authLoading, user, next, navigate]);

  // --- Login state ---
  const [liEmail, setLiEmail] = useState("");
  const [liPassword, setLiPassword] = useState("");
  const [liLoading, setLiLoading] = useState(false);
  const [liErr, setLiErr] = useState<string | null>(null);

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

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    if (liLoading) return;
    setLiErr(null);
    setLiLoading(true);
    try {
      await login({ email: liEmail.trim(), password: liPassword });
      navigate(next ?? "/", { replace: true });
    } catch (e: any) {
      setLiErr(formatAuthError(e));
    } finally {
      setLiLoading(false);
    }
  }

  const signUpHref = useMemo(() => {
    const qp = new URLSearchParams();
    if (next) qp.set("next", next);
    if (ctx) qp.set("ctx", ctx);
    const qs = qp.toString();
    return qs ? `/signup?${qs}` : "/signup";
  }, [next, ctx]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
            ← Back to home
          </Link>
          <Link to={signUpHref} className="text-sm font-semibold text-slate-900 underline underline-offset-4">
            Create account
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mx-auto w-full max-w-4xl">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{copy.title}</h1>
            <p className="mt-2 text-sm text-slate-600">{copy.body}</p>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {/* Sign in (primary) */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-extrabold tracking-tight text-slate-900">Sign in</h2>
              <p className="mt-1 text-sm text-slate-600">Use your email and password.</p>

              {liErr && (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{renderErr(liErr)}</div>
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
                  className="mt-2 rounded-xl border border-slate-900 bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {liLoading ? "Signing in..." : "Sign in"}
                </button>
              </form>

              <OAuthButtons intent="signin" />
            </section>

            {/* Create account (secondary) */}
            <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-extrabold tracking-tight text-slate-900">New here?</h3>
              <p className="mt-1 text-sm text-slate-600">
                Creating an account lets you post listings and wanted posts, and manage everything in one place.
              </p>

              <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-700">
                <li>Create and edit your listings</li>
                <li>Post and manage wanted posts</li>
                <li>Join the community and reach out to other members and listings</li>
              </ul>

              <Link
                to={signUpHref}
                className="mt-6 inline-flex w-full items-center justify-center rounded-xl border border-slate-900 bg-white px-4 py-3 text-sm font-extrabold text-slate-900 hover:bg-slate-50"
              >
                Create account
              </Link>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

