import type { ReactNode, SVGProps } from "react";

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

function FacebookMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="#1877F2"
        d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07C0 18.09 4.39 23.08 10.12 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.79-4.69 4.54-4.69 1.31 0 2.69.24 2.69.24v2.97h-1.52c-1.5 0-1.97.94-1.97 1.9v2.29h3.36l-.54 3.49h-2.82V24C19.61 23.08 24 18.09 24 12.07z"
      />
    </svg>
  );
}

type ProviderId = "google" | "facebook";

const PROVIDERS: Array<{
  id: ProviderId;
  label: string;
  Icon: (props: SVGProps<SVGSVGElement>) => ReactNode;
}> = [
  { id: "google", label: "Google", Icon: (p) => <GoogleMark {...p} /> },
  { id: "facebook", label: "Facebook", Icon: (p) => <FacebookMark {...p} /> },
];

export default function OAuthButtons(props: { intent: "signin" | "signup" }) {
  const caption = props.intent === "signup" ? "Or create an account with" : "Or continue with";

  return (
    <div className="mt-5">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <div className="text-xs font-semibold text-slate-500">{caption}</div>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
            }}
            className={[
              "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-900",
              "hover:bg-slate-50",
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

