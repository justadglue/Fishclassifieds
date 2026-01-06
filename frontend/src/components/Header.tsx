import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={open ? "rotate-180 transition" : "transition"}
    >
      <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Header(props: { maxWidth?: "3xl" | "5xl" | "6xl" }) {
  const { user, loading, logout } = useAuth();
  const nav = useNavigate();
  const maxWidth = props.maxWidth ?? "6xl";

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!open) return;
      const el = menuRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function doLogout() {
    setOpen(false);
    await logout();
    nav("/");
  }

  const shell = maxWidth === "3xl" ? "max-w-3xl" : maxWidth === "5xl" ? "max-w-5xl" : "max-w-6xl";

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className={`mx-auto flex ${shell} items-center gap-3 px-4 py-3`}>
        <Link to="/" className="font-extrabold tracking-tight text-slate-900">
          Fishclassifieds
        </Link>

        <div className="flex-1" />

        <Link to="/post" className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
          Post a listing
        </Link>

        <Link to="/me" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
          My listings
        </Link>

        {loading ? (
          <div className="text-sm font-semibold text-slate-500">Checking session…</div>
        ) : user ? (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              aria-haspopup="menu"
              aria-expanded={open}
            >
              <span className="max-w-[200px] truncate">{user.displayName || user.email}</span>
              <Chevron open={open} />
            </button>

            {open && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg"
              >
                <div className="border-b border-slate-100 px-4 py-3">
                  <div className="text-xs font-semibold text-slate-500">Signed in as</div>
                  <div className="mt-1 truncate text-sm font-bold text-slate-900">{user.email}</div>
                </div>

                <div className="p-2">
                  <Link
                    to="/me"
                    onClick={() => setOpen(false)}
                    className="block rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    role="menuitem"
                  >
                    My listings
                  </Link>

                  <button
                    type="button"
                    onClick={doLogout}
                    className="mt-1 w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50"
                    role="menuitem"
                  >
                    Log out
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link to="/login" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              Login
            </Link>
            <span className="text-slate-300">/</span>
            <Link to="/signup" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              Sign up
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
