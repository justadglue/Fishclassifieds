import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useNavHistory } from "../../navigation/NavHistory";
import { MoveLeft } from "lucide-react";

function isTemporaryPath(pathname: string) {
  const p = String(pathname || "/");
  return p.startsWith("/edit/") || p.startsWith("/auth") || p === "/login" || p === "/signup" || p === "/oauth/complete";
}

function canGoBackInBrowserHistory() {
  try {
    const idx = (window.history.state as any)?.idx;
    return typeof idx === "number" && idx > 0;
  } catch {
    return false;
  }
}

export default function BackToButton(props: {
  fallbackTo: string;
  fallbackLabel?: string;
  className?: string;
}) {
  const { fallbackTo, fallbackLabel = "home", className = "" } = props;
  const location = useLocation();
  const nav = useNavigate();
  const { prev, prevNonTemp, goBack, goBackNonTemp } = useNavHistory();

  const from = (location.state as any)?.from as
    | { pathname: string; search?: string; label?: string }
    | undefined;

  const label = useMemo(() => {
    const s = String(from?.label ?? "").trim();
    if (s) return s;
    // If the immediate previous page is a temporary route (like /edit/*), use the last non-temporary page.
    if (prevNonTemp?.label) return prevNonTemp.label;
    if (prev?.label) return prev.label;
    return fallbackLabel;
  }, [from?.label, prev?.label, prevNonTemp?.label, fallbackLabel]);

  return (
    <button
      type="button"
      onClick={() => {
        // On temporary/auth pages, never rely on raw browser back (it can land on other temporary pages,
        // like /oauth/complete). Always jump to the most recent non-temporary page instead.
        if (isTemporaryPath(location.pathname)) {
          goBackNonTemp(fallbackTo);
          return;
        }

        // Prefer in-app history helpers when we have them, to avoid landing on temporary routes like /edit/*.
        // Only fall back to browser history when our in-app stack is missing (e.g. after refresh),
        // or when we have an explicit `from` (browser back should match exactly and preserve scroll).
        const canBrowserBack = canGoBackInBrowserHistory();

        // If the immediate previous route is temporary (e.g. user just edited then landed on listing),
        // jump back to the last non-temporary route.
        if (prev && prevNonTemp && isTemporaryPath(prev.pathname)) {
          goBackNonTemp(fallbackTo);
          return;
        }

        // After refresh, NavHistory stack resets so `prev` can be null; use real browser history.
        if (!prev && canBrowserBack) {
          nav(-1);
          return;
        }

        // If we have an explicit `from` and browser-back won't land on a temp page, prefer browser back
        // so we match native Back behavior (including scroll restoration).
        if (from?.pathname && canBrowserBack) {
          nav(-1);
          return;
        }

        // Prefer true history back (restores scroll + URL state).
        // If we have an explicit `from`, just go back one entry (it should be the right place).
        // Otherwise, skip temporary routes like /edit/* and jump to the last non-temporary page.
        if (from?.pathname) {
          goBack(`${from.pathname}${from.search ?? ""}`);
          return;
        }
        // If the immediate previous entry is temporary, go back past it.
        if (prev && prevNonTemp && prev.pathname !== prevNonTemp.pathname) {
          goBackNonTemp(fallbackTo);
          return;
        }
        goBack(fallbackTo);
      }}
      className={["text-sm font-semibold text-slate-700 hover:text-slate-900", className].join(" ")}
    >
      <span className="inline-flex items-center gap-2">
        <MoveLeft aria-hidden="true" className="h-4 w-4" />
        <span>Back to {label}</span>
      </span>
    </button>
  );
}

