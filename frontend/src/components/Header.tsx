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
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!open && !searchOpen) return;
      const target = e.target;
      if (!(target instanceof Node)) return;

      if (open) {
        const el = menuRef.current;
        if (el && !el.contains(target)) setOpen(false);
      }

      if (searchOpen) {
        const el = searchRef.current;
        if (el && !el.contains(target)) setSearchOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (open) setOpen(false);
      if (searchOpen) setSearchOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [searchOpen]);

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

        <Link to="/browse" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
          Browse
        </Link>

        <Link to="/wanted" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
          Wanted
        </Link>

        <Link to="/post" className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
          Post a listing
        </Link>

        <Link to="/me" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
          My listings
        </Link>

        {/* Top-right search: icon-only until clicked */}
        <div className="relative" ref={searchRef}>
          {!searchOpen ? (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900"
              aria-label="Search listings"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const term = q.trim();
                const sp = new URLSearchParams();
                if (term) sp.set("q", term);
                const suffix = sp.toString() ? `?${sp.toString()}` : "";
                nav(`/browse${suffix}`);
                setSearchOpen(false);
              }}
              className="flex"
            >
              <div className="flex w-72 items-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="pl-3 text-slate-500">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <input
                  ref={searchInputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  type="search"
                  placeholder="Search listings"
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setSearchOpen(false)}
                  className="shrink-0 px-3 py-2 text-sm font-extrabold text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                  aria-label="Close search"
                >
                  ×
                </button>
              </div>
            </form>
          )}
        </div>

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
              <div role="menu" className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
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

                  <Link
                    to="/profile"
                    onClick={() => setOpen(false)}
                    className="mt-1 block rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    role="menuitem"
                  >
                    My profile
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
