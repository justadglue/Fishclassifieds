import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

type ConfirmWithCheckboxOptions = ConfirmOptions & {
  checkboxLabel: string;
  checkboxDefaultChecked?: boolean;
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

type ChoiceOptions = {
  title: string;
  body?: ReactNode;
  options: Array<{ label: string; value: string; variant?: "default" | "primary" | "danger"; disabled?: boolean }>;
  cancelText?: string;
};

type DialogApi = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  confirmWithCheckbox: (opts: ConfirmWithCheckboxOptions) => Promise<{ ok: boolean; checked: boolean }>;
  choice: (opts: ChoiceOptions) => Promise<string | null>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  alert: (opts: AlertOptions) => Promise<void>;
};

type ActiveDialog =
  | { type: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { type: "confirm_checkbox"; opts: ConfirmWithCheckboxOptions; resolve: (v: { ok: boolean; checked: boolean }) => void }
  | { type: "choice"; opts: ChoiceOptions; resolve: (v: string | null) => void }
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
  const promptValRef = useRef("");
  const [confirmCheckboxVal, setConfirmCheckboxVal] = useState(false);
  const confirmCheckboxValRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const firstChoiceBtnRef = useRef<HTMLButtonElement | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    // Reset per-dialog refs so focus behavior doesn't leak between dialogs.
    firstChoiceBtnRef.current = null;

    lastFocusRef.current = (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    if (active.type === "prompt") {
      const v = active.opts.defaultValue ?? "";
      promptValRef.current = v;
      setPromptVal(v);
    }
    if (active.type === "confirm_checkbox") {
      const v = Boolean(active.opts.checkboxDefaultChecked);
      confirmCheckboxValRef.current = v;
      setConfirmCheckboxVal(v);
    }

    const t = window.setTimeout(() => {
      if (active.type === "prompt") inputRef.current?.focus();
      else if (active.type === "confirm" && active.opts.destructive) cancelBtnRef.current?.focus();
      else if (active.type === "choice") firstChoiceBtnRef.current?.focus();
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
        } else if (active.type === "confirm_checkbox") {
          active.resolve({ ok: false, checked: confirmCheckboxValRef.current });
          setQueue((q) => q.slice(1));
        } else if (active.type === "choice") {
          active.resolve(null);
          setQueue((q) => q.slice(1));
        } else {
          active.resolve(null);
          setQueue((q) => q.slice(1));
        }
      }
      if (e.key === "Enter" && active.type === "prompt" && !active.opts.multiline) {
        // Submit prompt with Enter.
        e.preventDefault();
        const v = promptValRef.current;
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
  }, [active]);

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
      confirmWithCheckbox: (opts) =>
        new Promise<{ ok: boolean; checked: boolean }>((resolve) => {
          enqueue({ type: "confirm_checkbox", opts, resolve }, resolve);
        }),
      choice: (opts) =>
        new Promise<string | null>((resolve) => {
          enqueue({ type: "choice", opts, resolve }, resolve);
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
    else if (active.type === "confirm_checkbox") active.resolve({ ok: false, checked: confirmCheckboxValRef.current });
    else if (active.type === "choice") active.resolve(null);
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
    if (active.type === "confirm_checkbox") {
      active.resolve({ ok: true, checked: confirmCheckboxValRef.current });
      setQueue((q) => q.slice(1));
      return;
    }
    if (active.type === "choice") {
      active.resolve(null);
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
          <div className="relative w-full max-w-md max-h-[85dvh] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
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

              {active.type === "choice" ? (
                <div className="mt-4 grid gap-2">
                  {active.opts.options.map((opt) => {
                    const cls =
                      opt.variant === "danger"
                        ? "border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
                        : opt.variant === "primary"
                          ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
                          : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50";
                    const disabled = Boolean(opt.disabled);
                    return (
                      <button
                        key={opt.value}
                        ref={(el) => {
                          if (!el) return;
                          if (firstChoiceBtnRef.current) return;
                          if (disabled) return;
                          firstChoiceBtnRef.current = el;
                        }}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (disabled) return;
                          active.resolve(opt.value);
                          setQueue((q) => q.slice(1));
                        }}
                        className={[
                          "w-full rounded-xl border px-3 py-2 text-left text-sm font-bold",
                          cls,
                          disabled ? "cursor-not-allowed opacity-50 hover:bg-inherit" : "",
                        ].join(" ")}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {active.type === "confirm_checkbox" ? (
                <label className="mt-4 flex cursor-pointer select-none items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={confirmCheckboxVal}
                    onChange={(e) => {
                      confirmCheckboxValRef.current = e.target.checked;
                      setConfirmCheckboxVal(e.target.checked);
                    }}
                  />
                  <span>{active.opts.checkboxLabel}</span>
                </label>
              ) : null}

              {active.type === "prompt" ? (
                <div className="mt-4">
                  {active.opts.multiline ? (
                    <textarea
                      ref={(el) => (inputRef.current = el)}
                      value={promptVal}
                      onChange={(e) => {
                        promptValRef.current = e.target.value;
                        setPromptVal(e.target.value);
                      }}
                      placeholder={active.opts.placeholder}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                      rows={4}
                    />
                  ) : (
                    <input
                      ref={(el) => (inputRef.current = el)}
                      value={promptVal}
                      onChange={(e) => {
                        promptValRef.current = e.target.value;
                        setPromptVal(e.target.value);
                      }}
                      placeholder={active.opts.placeholder}
                      inputMode={active.opts.inputMode}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                    />
                  )}
                </div>
              ) : null}
            </div>

            <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4">
              {active.type === "confirm" || active.type === "confirm_checkbox" || active.type === "prompt" || active.type === "choice" ? (
                <button
                  ref={cancelBtnRef}
                  type="button"
                  onClick={closeTop}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                >
                  {(active.type === "choice" ? active.opts.cancelText : active.opts.cancelText) ?? "Cancel"}
                </button>
              ) : null}
              {active.type === "choice" ? null : (
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
              )}
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

