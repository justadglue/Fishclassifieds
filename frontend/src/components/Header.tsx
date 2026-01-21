import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { User, Search, X, Bell } from "lucide-react";
import { createPortal } from "react-dom";
import { fetchNotifications, markAllNotificationsRead, markNotificationRead, type NotificationItem } from "../api";

export default function Header(props: { maxWidth?: "3xl" | "5xl" | "6xl" }) {
  const { user, loading, logout } = useAuth();
  const nav = useNavigate();
  const maxWidth = props.maxWidth ?? "6xl";

  const NOTIF_INITIAL = 5;
  const NOTIF_PAGE = 6;

  const [open, setOpen] = useState(false);
  const menuAnchorRef = useRef<HTMLDivElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [notifOpen, setNotifOpen] = useState(false);
  const notifAnchorRef = useRef<HTMLDivElement | null>(null);
  const notifPanelRef = useRef<HTMLDivElement | null>(null);
  const [notifPos, setNotifPos] = useState<{ top: number; left: number } | null>(null);
  const [notifItems, setNotifItems] = useState<NotificationItem[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifLimit, setNotifLimit] = useState(NOTIF_INITIAL);
  const [notifHasMore, setNotifHasMore] = useState(false);

  function closeSearch() {
    setSearchOpen(false);
    setQ("");
  }

  function computeMenuPos() {
    const anchor = menuAnchorRef.current;
    if (!anchor) return null;

    const rect = anchor.getBoundingClientRect();
    const MENU_W = 256; // w-64
    const GAP = 8; // mt-2
    const PADDING = 8;

    const top = rect.bottom + GAP;
    const left = Math.min(window.innerWidth - MENU_W - PADDING, Math.max(PADDING, rect.right - MENU_W));
    return { top, left };
  }

  function computeNotifPos() {
    const anchor = notifAnchorRef.current;
    if (!anchor) return null;

    const rect = anchor.getBoundingClientRect();
    const MENU_W = 320; // w-80
    const GAP = 8; // mt-2
    const PADDING = 8;

    const top = rect.bottom + GAP;
    const left = Math.min(window.innerWidth - MENU_W - PADDING, Math.max(PADDING, rect.right - MENU_W));
    return { top, left };
  }

  const accountLabel = useMemo(() => {
    const u = user?.username?.trim();
    if (u) return u;
    return "Account";
  }, [user]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!open && !searchOpen && !notifOpen) return;
      const target = e.target;
      if (!(target instanceof Node)) return;

      if (open) {
        const anchor = menuAnchorRef.current;
        const panel = menuPanelRef.current;
        const inside = (!!anchor && anchor.contains(target)) || (!!panel && panel.contains(target));
        if (!inside) setOpen(false);
      }

      if (notifOpen) {
        const anchor = notifAnchorRef.current;
        const panel = notifPanelRef.current;
        const inside = (!!anchor && anchor.contains(target)) || (!!panel && panel.contains(target));
        if (!inside) setNotifOpen(false);
      }

      if (searchOpen) {
        const el = searchRef.current;
        if (el && !el.contains(target)) closeSearch();
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (open) setOpen(false);
      if (notifOpen) setNotifOpen(false);
      if (searchOpen) closeSearch();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, searchOpen, notifOpen]);

  useEffect(() => {
    if (!open) return;

    function positionMenu() {
      const pos = computeMenuPos();
      if (pos) setMenuPos(pos);
    }

    positionMenu();
    window.addEventListener("resize", positionMenu);
    // Sticky headers + backdrop filters can repaint oddly; reposition on scroll too.
    window.addEventListener("scroll", positionMenu, { passive: true });
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu);
    };
  }, [open]);

  useEffect(() => {
    if (!notifOpen) return;

    function positionMenu() {
      const pos = computeNotifPos();
      if (pos) setNotifPos(pos);
    }

    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, { passive: true });
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu);
    };
  }, [notifOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [searchOpen]);

  async function refreshNotifications(limitOverride?: number) {
    if (!user) return;
    const desiredLimit = limitOverride ?? notifLimit;
    setNotifLoading(true);
    try {
      // Fetch one extra so we can reliably show/hide the "See previous" button.
      const res = await fetchNotifications({ limit: desiredLimit + 1, offset: 0 });
      setNotifItems(res.items.slice(0, desiredLimit));
      setNotifHasMore(res.items.length > desiredLimit);
      setNotifUnread(res.unreadCount);
    } catch {
      // ignore
    } finally {
      setNotifLoading(false);
    }
  }

  useEffect(() => {
    if (!user) {
      setNotifUnread(0);
      setNotifItems([]);
      setNotifOpen(false);
      setNotifLimit(NOTIF_INITIAL);
      setNotifHasMore(false);
      return;
    }

    // Default to showing only the newest notifications.
    setNotifLimit(NOTIF_INITIAL);
    refreshNotifications(NOTIF_INITIAL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    const t = window.setInterval(() => {
      // If the dropdown is open, keep the user's expanded view fresh.
      // If closed, keep the polling light (newest only).
      refreshNotifications(notifOpen ? notifLimit : NOTIF_INITIAL);
    }, 30_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, notifOpen, notifLimit]);

  useEffect(() => {
    if (!notifOpen) return;
    // Reset to newest-only each time the dropdown opens.
    setNotifLimit(NOTIF_INITIAL);
    refreshNotifications(NOTIF_INITIAL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifOpen]);

  function extractNavFromNotification(n: NotificationItem): { href: string; label: string } | null {
    try {
      const meta = n.metaJson ? JSON.parse(n.metaJson) : null;
      const listingId = meta?.listingId ?? meta?.targetId ?? null;
      const listingType = meta?.listingType ?? meta?.targetKind ?? null;
      if (listingId && (listingType === "sale" || listingType === "wanted")) {
        return { href: `/listing/${listingType}/${listingId}`, label: "Open listing" };
      }
      if (meta?.targetKind && meta?.targetId && (meta.targetKind === "sale" || meta.targetKind === "wanted")) {
        return { href: `/listing/${meta.targetKind}/${meta.targetId}`, label: "Open listing" };
      }
      return null;
    } catch {
      return null;
    }
  }

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

        <Link to="/browse?type=sale" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
          For sale
        </Link>

        <Link to="/browse?type=wanted" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
          Wanted
        </Link>

        <Link to="/post" className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
          Post a listing
        </Link>

        {user ? (
          <Link to="/me" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
            My listings
          </Link>
        ) : null}

        {user && (user.isAdmin || user.isSuperadmin) ? (
          <Link to="/admin" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
            Admin dashboard
          </Link>
        ) : null}

        {/* Top-right search: icon-only until clicked */}
        <div className="relative" ref={searchRef}>
          {!searchOpen ? (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900"
              aria-label="Search listings"
            >
              <Search aria-hidden="true" className="h-5 w-5" />
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const term = q.trim();
                const sp = new URLSearchParams();
                sp.set("type", "sale");
                if (term) sp.set("q", term);
                const suffix = sp.toString() ? `?${sp.toString()}` : "";
                nav(`/browse${suffix}`);
                closeSearch();
              }}
              className="flex"
            >
              <div className="flex w-72 items-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="pl-3 text-slate-500">
                  <Search aria-hidden="true" className="h-4 w-4" />
                </div>
                <input
                  ref={searchInputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  type="text"
                  inputMode="search"
                  enterKeyHint="search"
                  placeholder="Search"
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={closeSearch}
                  className="shrink-0 px-3 py-2 text-sm font-extrabold text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                  aria-label="Close search"
                >
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>
            </form>
          )}
        </div>

        {loading ? (
          <div className="text-sm font-semibold text-slate-500">Checking session…</div>
        ) : user ? (
          <div className="flex items-center gap-2">
            {/* Notifications */}
            <div className="relative" ref={notifAnchorRef}>
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((v) => {
                    const next = !v;
                    if (next) {
                      const pos = computeNotifPos();
                      if (pos) setNotifPos(pos);
                    } else {
                      setNotifPos(null);
                    }
                    return next;
                  });
                }}
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 focus:outline-none"
                aria-label="Notifications"
                title="Notifications"
              >
                <Bell aria-hidden="true" className="h-5 w-5" />
                {notifUnread > 0 ? (
                  <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-extrabold leading-none text-white">
                    {notifUnread > 99 ? "99+" : notifUnread}
                  </span>
                ) : null}
              </button>

              {notifOpen &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    ref={notifPanelRef}
                    className="fixed z-50 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg"
                    style={notifPos ? { top: notifPos.top, left: notifPos.left } : undefined}
                    role="dialog"
                    aria-label="Notifications"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                      <div className="text-sm font-extrabold text-slate-900">Notifications</div>
                      <button
                        type="button"
                        className="text-xs font-bold text-slate-700 hover:text-slate-900"
                        disabled={notifUnread === 0}
                        onClick={async () => {
                          await markAllNotificationsRead();
                          await refreshNotifications();
                        }}
                      >
                        Mark all read
                      </button>
                    </div>

                    <div className="max-h-[70vh] overflow-auto p-2">
                      {notifLoading ? <div className="px-3 py-2 text-sm font-semibold text-slate-600">Loading…</div> : null}
                      {!notifLoading && notifItems.length === 0 ? (
                        <div className="px-3 py-6 text-center text-sm font-semibold text-slate-600">No notifications yet.</div>
                      ) : null}

                      {notifItems.map((n) => {
                        const navTo = extractNavFromNotification(n);
                        return (
                          <button
                            key={n.id}
                            type="button"
                            className={[
                              "w-full rounded-xl px-3 py-2 text-left hover:bg-slate-50",
                              n.isRead ? "" : "bg-slate-50/60",
                            ].join(" ")}
                            onClick={async () => {
                              if (!n.isRead) {
                                await markNotificationRead(n.id);
                              }
                              setNotifOpen(false);
                              if (navTo) nav(navTo.href);
                              await refreshNotifications();
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-extrabold text-slate-900">{n.title}</div>
                                {n.body ? <div className="mt-0.5 line-clamp-2 text-xs font-semibold text-slate-600">{n.body}</div> : null}
                                {navTo ? <div className="mt-1 text-[11px] font-bold text-slate-700 underline underline-offset-4">{navTo.label}</div> : null}
                              </div>
                              {!n.isRead ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-600" aria-hidden="true" /> : null}
                            </div>
                          </button>
                        );
                      })}

                      {!notifLoading && notifItems.length > 0 && notifHasMore ? (
                        <button
                          type="button"
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                          onClick={async () => {
                            const nextLimit = notifLimit + NOTIF_PAGE;
                            setNotifLimit(nextLimit);
                            await refreshNotifications(nextLimit);
                          }}
                        >
                          See previous
                        </button>
                      ) : null}
                    </div>
                  </div>,
                  document.body
                )}
            </div>

            {/* Account */}
            <div className="relative" ref={menuAnchorRef}>
              <button
                type="button"
                onClick={() => {
                  setOpen((v) => {
                    const next = !v;
                    if (next) {
                      const pos = computeMenuPos();
                      if (pos) setMenuPos(pos);
                    } else {
                      setMenuPos(null);
                    }
                    return next;
                  });
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 hover:text-slate-900 focus:outline-none"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={`Account menu for ${accountLabel}`}
                title={accountLabel}
              >
                <User aria-hidden="true" className="h-5 w-5" />
                <span className="sr-only">{accountLabel}</span>
              </button>

            {open &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  ref={menuPanelRef}
                  role="menu"
                  className="fixed z-50 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg"
                  style={menuPos ? { top: menuPos.top, left: menuPos.left } : undefined}
                >
                  <div className="border-b border-slate-100 px-4 py-3">
                    <div className="text-xs font-semibold text-slate-500">Signed in as</div>
                    <div className="mt-1 truncate text-sm font-bold text-slate-900">{accountLabel}</div>
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

                    {user && (user.isAdmin || user.isSuperadmin) ? (
                      <Link
                        to="/admin"
                        onClick={() => setOpen(false)}
                        className="mt-1 block rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                        role="menuitem"
                      >
                        Admin dashboard
                      </Link>
                    ) : null}

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
                </div>,
                document.body
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link to="/login" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              Sign in
            </Link>
            <span className="text-slate-300">/</span>
            <Link to="/signup" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              Create account
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
