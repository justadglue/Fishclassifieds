import type { ReactNode, SVGProps } from "react";
import { useEffect, useState } from "react";

function GoogleMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" {...props}>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.72 1.22 9.24 3.62l6.9-6.9C35.94 2.38 30.36 0 24 0 14.62 0 6.54 5.38 2.56 13.22l8.02 6.22C12.52 13.48 17.78 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.62-.14-3.18-.42-4.7H24v9.1h12.64c-.54 2.92-2.18 5.4-4.66 7.06l7.16 5.56c4.18-3.86 6.56-9.54 6.56-17.02z"
      />
      <path
        fill="#FBBC05"
        d="M10.58 28.56c-.5-1.46-.78-3.02-.78-4.62s.28-3.16.78-4.62l-8.02-6.22C.92 16.48 0 20.14 0 23.94s.92 7.46 2.56 10.76l8.02-6.14z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.36 0 11.7-2.1 15.6-5.68l-7.16-5.56c-1.98 1.34-4.52 2.14-8.44 2.14-6.22 0-11.48-3.98-13.42-9.44l-8.02 6.14C6.54 42.62 14.62 48 24 48z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

type ProviderId = "google";

const PROVIDERS: Array<{
  id: ProviderId;
  label: string;
  Icon: (props: SVGProps<SVGSVGElement>) => ReactNode;
}> = [
    { id: "google", label: "Google", Icon: (p) => <GoogleMark {...p} /> },
  ];

const API_BASE = (import.meta as any).env?.VITE_API_URL?.toString().trim() || "http://localhost:3001";

export default function OAuthButtons(props: { intent: "signin" | "signup" }) {
  const caption = props.intent === "signup" ? "Or create an account with" : "Or continue with";
  const [enabled, setEnabled] = useState<Record<ProviderId, boolean> | null>(null);
  const isSingleProvider = PROVIDERS.length <= 1;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/auth/oauth/providers`, { credentials: "include" });
        const j = (await r.json().catch(() => null)) as any;
        if (!r.ok || !j?.providers) return;
        const next = {
          google: Boolean(j.providers.google),
        } as Record<ProviderId, boolean>;
        if (!cancelled) setEnabled(next);
      } catch {
        // ignore; we'll just leave them enabled (backend will reject if not configured)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mt-5">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <div className="text-xs font-semibold text-slate-500">{caption}</div>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <div className={["mt-4 grid gap-3", isSingleProvider ? "" : "sm:grid-cols-2"].join(" ")}>
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={enabled ? !enabled[p.id] : false}
            onClick={() => {
              if (enabled && !enabled[p.id]) return;
              const sp = new URLSearchParams(window.location.search);
              const nextFromQuery = sp.get("next");
              const fallbackNext = "/";
              const isOkNext = (v: string | null) => v && v.startsWith("/") && !v.startsWith("//");

              // Prefer explicit ?next=... when present.
              let next = isOkNext(nextFromQuery) ? nextFromQuery! : null;

              // If no explicit next is provided, don't bounce back to auth pages.
              if (!next) {
                const p = String(window.location.pathname ?? "");
                const isAuthPage = p === "/login" || p === "/signup" || p === "/auth" || p === "/forgot-password" || p === "/reset-password";
                if (isAuthPage) next = fallbackNext;
                else if (isOkNext(p)) next = `${p}${window.location.search || ""}`;
                else next = fallbackNext;
              }

              // Store the current URL so OAuthCompletePage can return here if user cancels.
              try {
                sessionStorage.setItem("oauth_origin_url", window.location.href);
              } catch {
                // ignore
              }

              const u = new URL(`${API_BASE}/api/auth/oauth/${p.id}/start`);
              u.searchParams.set("intent", props.intent);
              u.searchParams.set("next", next);
              window.location.href = u.toString();
            }}
            title={enabled && !enabled[p.id] ? `${p.label} sign-in is not configured yet` : undefined}
            className={[
              "inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-900",
              "hover:bg-slate-50",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
            ].join(" ")}
          >
            <span className="inline-flex h-5 w-5 items-center justify-center">
              <>{p.Icon({ className: "h-5 w-5" })}</>
            </span>
            <span>{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

