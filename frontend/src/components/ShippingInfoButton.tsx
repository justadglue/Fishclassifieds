import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Info } from "lucide-react";

export default function ShippingInfoButton(props: { disabled?: boolean }) {
  const { disabled } = props;
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target;
      if (!(t instanceof Node)) return;
      const panel = panelRef.current;
      if (panel && !panel.contains(t)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60"
        aria-label="Shipping info"
        title="Shipping info"
      >
        <Info aria-hidden="true" className="h-4 w-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Shipping fish information"
            className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="text-base font-extrabold text-slate-900">Shipping fish (important)</div>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                Only enable shipping if you’re confident you can pack livestock safely.
              </div>
            </div>

            <div className="px-5 py-4 text-sm text-slate-700">
              <ul className="list-disc space-y-2 pl-5">
                <li>Shipping requires the right equipment (bags, insulation, heat/cold packs) and correct technique.</li>
                <li>Incorrect packing can stress or harm fish.</li>
                <li>Always follow local carrier rules and weather considerations.</li>
              </ul>

              <div className="mt-4 text-sm font-semibold">
                See:{" "}
                <Link
                  to="/faq#fish-shipping"
                  className="text-slate-900 underline underline-offset-4 hover:text-slate-700"
                  onClick={() => setOpen(false)}
                >
                  Fish shipping FAQ (placeholder)
                </Link>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

