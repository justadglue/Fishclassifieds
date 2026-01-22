import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

type PromptOptions = {
  title: string;
  body?: ReactNode;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  multiline?: boolean;
};

type AlertOptions = {
  title: string;
  body?: ReactNode;
  confirmText?: string;
};

type DialogApi = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  alert: (opts: AlertOptions) => Promise<void>;
};

type ActiveDialog =
  | { type: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { type: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void }
  | { type: "alert"; opts: AlertOptions; resolve: () => void };

const DialogContext = createContext<DialogApi | null>(null);

function BodyContent({ body }: { body: ReactNode | undefined }) {
  if (body == null) return null;
  if (typeof body === "string") {
    return <div className="whitespace-pre-wrap text-sm font-semibold text-slate-700">{body}</div>;
  }
  return <div className="text-sm font-semibold text-slate-700">{body}</div>;
}

export function DialogProvider(props: { children: ReactNode }) {
  const { children } = props;
  const [queue, setQueue] = useState<ActiveDialog[]>([]);
  const active = queue[0] ?? null;

  const [promptVal, setPromptVal] = useState("");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    lastFocusRef.current = (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    if (active.type === "prompt") {
      setPromptVal(active.opts.defaultValue ?? "");
    }

    const t = window.setTimeout(() => {
      if (active.type === "prompt") inputRef.current?.focus();
      else if (active.type === "confirm" && active.opts.destructive) cancelBtnRef.current?.focus();
      else confirmBtnRef.current?.focus();
    }, 0);

    function onKeyDown(e: KeyboardEvent) {
      if (!active) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (active.type === "alert") {
          active.resolve();
          setQueue((q) => q.slice(1));
        } else if (active.type === "confirm") {
          active.resolve(false);
          setQueue((q) => q.slice(1));
        } else {
          active.resolve(null);
          setQueue((q) => q.slice(1));
        }
      }
      if (e.key === "Enter" && active.type === "prompt" && !active.opts.multiline) {
        // Submit prompt with Enter.
        e.preventDefault();
        const v = promptVal;
        active.resolve(v);
        setQueue((q) => q.slice(1));
      }
    }
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prev;
      lastFocusRef.current?.focus?.();
    };
  }, [active, promptVal]);

  const enqueue = useCallback(<T,>(d: ActiveDialog, resolve: (v: T) => void) => {
    setQueue((q) => [...q, d]);
    return resolve;
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (opts) =>
        new Promise<boolean>((resolve) => {
          enqueue({ type: "confirm", opts, resolve }, resolve);
        }),
      prompt: (opts) =>
        new Promise<string | null>((resolve) => {
          enqueue({ type: "prompt", opts, resolve }, resolve);
        }),
      alert: (opts) =>
        new Promise<void>((resolve) => {
          enqueue({ type: "alert", opts, resolve }, resolve);
        }),
    }),
    [enqueue]
  );

  function closeTop() {
    if (!active) return;
    if (active.type === "alert") active.resolve();
    else if (active.type === "confirm") active.resolve(false);
    else active.resolve(null);
    setQueue((q) => q.slice(1));
  }

  function confirmTop() {
    if (!active) return;
    if (active.type === "alert") {
      active.resolve();
      setQueue((q) => q.slice(1));
      return;
    }
    if (active.type === "confirm") {
      active.resolve(true);
      setQueue((q) => q.slice(1));
      return;
    }
    // prompt
    active.resolve(promptVal);
    setQueue((q) => q.slice(1));
  }

  const modal =
    active && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
            <button type="button" className="absolute inset-0" aria-label="Close dialog" onClick={closeTop} />
            <div className="relative w-full max-w-md max-h-[85vh] max-h-[85dvh] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
              <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-5 py-4">
                <div className="min-w-0">
                  <div className="truncate text-base font-extrabold text-slate-900">{active.opts.title}</div>
                </div>
                <button
                  type="button"
                  onClick={closeTop}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>

              <div className="px-5 py-4">
                <BodyContent body={active.opts.body} />

                {active.type === "prompt" ? (
                  <div className="mt-4">
                    {active.opts.multiline ? (
                      <textarea
                        ref={(el) => (inputRef.current = el)}
                        value={promptVal}
                        onChange={(e) => setPromptVal(e.target.value)}
                        placeholder={active.opts.placeholder}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                        rows={4}
                      />
                    ) : (
                      <input
                        ref={(el) => (inputRef.current = el)}
                        value={promptVal}
                        onChange={(e) => setPromptVal(e.target.value)}
                        placeholder={active.opts.placeholder}
                        inputMode={active.opts.inputMode}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                      />
                    )}
                  </div>
                ) : null}
              </div>

              <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4">
                {active.type === "confirm" || active.type === "prompt" ? (
                  <button
                    ref={cancelBtnRef}
                    type="button"
                    onClick={closeTop}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                  >
                    {active.opts.cancelText ?? "Cancel"}
                  </button>
                ) : null}
                <button
                  ref={confirmBtnRef}
                  type="button"
                  onClick={confirmTop}
                  className={[
                    "rounded-2xl px-4 py-2 text-sm font-extrabold text-white",
                    active.type === "confirm" && active.opts.destructive ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800",
                  ].join(" ")}
                >
                  {active.type === "alert"
                    ? active.opts.confirmText ?? "OK"
                    : active.type === "prompt"
                      ? active.opts.confirmText ?? "OK"
                      : active.opts.confirmText ?? "Confirm"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <DialogContext.Provider value={api}>
      {children}
      {modal}
    </DialogContext.Provider>
  );
}

export function useDialogs(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialogs must be used within <DialogProvider>");
  return ctx;
}

