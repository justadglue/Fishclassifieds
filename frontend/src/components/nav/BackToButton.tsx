import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useNavHistory } from "../../navigation/NavHistory";
import { MoveLeft } from "lucide-react";

export default function BackToButton(props: {
  fallbackTo: string;
  fallbackLabel?: string;
  className?: string;
}) {
  const { fallbackTo, fallbackLabel = "home", className = "" } = props;
  const location = useLocation();
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

