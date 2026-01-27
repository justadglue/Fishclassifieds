import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { User, Search, X, Bell, Menu } from "lucide-react";
import { createPortal } from "react-dom";
import { fetchNotifications, markAllNotificationsRead, markNotificationRead, type NotificationItem } from "../api";

function cap1(s: string) {
  const t = String(s ?? "");
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function relativeTime(iso: string) {
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return iso;
  const now = Date.now();
  const s = Math.max(0, Math.floor((now - d) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

function statusPill(statusRaw: string | null | undefined) {
  const s = String(statusRaw ?? "").trim().toLowerCase();
  const cls =
    s === "active"
      ? "text-emerald-700"
      : s === "pending"
        ? "text-amber-700"
        : s === "paused"
          ? "text-violet-700"
          : s === "expired"
            ? "text-slate-600"
            : s === "draft"
              ? "text-sky-700"
              : s === "sold" || s === "closed"
                ? "text-slate-800"
                : s === "deleted"
                  ? "text-red-700"
                  : "text-slate-700";
  const label = s === "sold" ? "Sold" : s === "closed" ? "Closed" : cap1(s || "Updated");
  return <span className={`inline-flex shrink-0 rounded-full border border-slate-200 bg-transparent px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

function statusChangeFromNotification(n: NotificationItem): { prevStatus: string | null; nextStatus: string | null } | null {
  try {
    if (n.kind === "listing_status_changed") {
      const meta = n.metaJson ? JSON.parse(n.metaJson) : null;
      const prevStatus = meta?.prevStatus != null ? String(meta.prevStatus) : null;
      const nextStatus = meta?.nextStatus != null ? String(meta.nextStatus) : null;
      if (!prevStatus && !nextStatus) return null;
      return { prevStatus, nextStatus };
    }
    if (n.kind === "listing_approved") {
      // Prefer explicit meta if present (e.g., admin restore flows), otherwise default pending -> active.
      const meta = n.metaJson ? JSON.parse(n.metaJson) : null;
      const prevStatus = meta?.prevStatus != null ? String(meta.prevStatus) : null;
      const nextStatus = meta?.nextStatus != null ? String(meta.nextStatus) : null;
      if (prevStatus || nextStatus) return { prevStatus, nextStatus };
      return { prevStatus: "pending", nextStatus: "active" };
    }
    if (n.kind === "listing_rejected") {
      // Prefer explicit meta if present, otherwise default pending -> deleted.
      const meta = n.metaJson ? JSON.parse(n.metaJson) : null;
      const prevStatus = meta?.prevStatus != null ? String(meta.prevStatus) : null;
      const nextStatus = meta?.nextStatus != null ? String(meta.nextStatus) : null;
      if (prevStatus || nextStatus) return { prevStatus, nextStatus };
      return { prevStatus: "pending", nextStatus: "deleted" };
    }
    return null;
  } catch {
    return null;
  }
}

export default function Header(props: { maxWidth?: "3xl" | "5xl" | "6xl" | "7xl" }) {
  const { user, loading, logout } = useAuth();
  const nav = useNavigate();
  // Site-standard width (matches My Listings page content width).
  const maxWidth = props.maxWidth ?? "7xl";

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

  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const mobileActionsAnchorRef = useRef<HTMLDivElement | null>(null);
  const mobileActionsPanelRef = useRef<HTMLDivElement | null>(null);
  const [mobileActionsShiftX, setMobileActionsShiftX] = useState(0);

  const [notifOpen, setNotifOpen] = useState(false);
  const notifAnchorRef = useRef<HTMLDivElement | null>(null);
  const notifPanelRef = useRef<HTMLDivElement | null>(null);
  const [notifPos, setNotifPos] = useState<{ top: number; left: number } | null>(null);
  const [notifItems, setNotifItems] = useState<NotificationItem[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifLimit, setNotifLimit] = useState(NOTIF_INITIAL);
  const [notifHasMore, setNotifHasMore] = useState(false);
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [notifModalItem, setNotifModalItem] = useState<NotificationItem | null>(null);
  const notifModalPanelRef = useRef<HTMLDivElement | null>(null);

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
      if (!open && !searchOpen && !notifOpen && !mobileActionsOpen) return;
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

      if (mobileActionsOpen) {
        const anchor = mobileActionsAnchorRef.current;
        const panel = mobileActionsPanelRef.current;
        const inside = (!!anchor && anchor.contains(target)) || (!!panel && panel.contains(target));
        if (!inside) setMobileActionsOpen(false);
      }

      if (notifModalOpen) {
        const panel = notifModalPanelRef.current;
        if (panel && !panel.contains(target)) {
          setNotifModalOpen(false);
          setNotifModalItem(null);
        }
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (open) setOpen(false);
      if (notifOpen) setNotifOpen(false);
      if (notifModalOpen) {
        setNotifModalOpen(false);
        setNotifModalItem(null);
      }
      if (searchOpen) closeSearch();
      if (mobileActionsOpen) setMobileActionsOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, searchOpen, notifOpen, mobileActionsOpen, notifModalOpen]);

  function openNotifModal(n: NotificationItem) {
    setNotifModalItem(n);
    setNotifModalOpen(true);
  }

  function closeNotifModal() {
    setNotifModalOpen(false);
    setNotifModalItem(null);
  }

  // Keep the mobile actions dropdown within the viewport by shifting horizontally if needed.
  useEffect(() => {
    if (!mobileActionsOpen) {
      setMobileActionsShiftX(0);
      return;
    }

    const PADDING = 8;

    function reposition() {
      const panel = mobileActionsPanelRef.current;
      if (!panel) return;

      // Reset first so we measure the "natural" position.
      panel.style.transform = "translateX(0px)";
      const rect = panel.getBoundingClientRect();

      let shift = 0;
      if (rect.right > window.innerWidth - PADDING) {
        shift -= rect.right - (window.innerWidth - PADDING);
      }
      if (rect.left + shift < PADDING) {
        shift += PADDING - (rect.left + shift);
      }
      setMobileActionsShiftX(shift);
    }

    // After render/layout
    reposition();
    const t = window.setTimeout(reposition, 0);

    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, { passive: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition);
    };
  }, [mobileActionsOpen]);

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
      const nextStatus = meta?.nextStatus != null ? String(meta.nextStatus) : null;
      // Defense-in-depth: never offer a "view deleted listing" action unless superadmin.
      if (nextStatus === "deleted" && !user?.isSuperadmin) return null;
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

  function closeAllOverlays() {
    setOpen(false);
    setNotifOpen(false);
    setMobileActionsOpen(false);
  }

  const shell =
    maxWidth === "3xl"
      ? "max-w-3xl"
      : maxWidth === "5xl"
        ? "max-w-5xl"
        : maxWidth === "6xl"
          ? "max-w-6xl"
          : "max-w-7xl";

  const collapseForSearch = searchOpen;

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className={`mx-auto flex ${shell} items-center gap-3 px-4 py-3`}>
        <Link
          to="/"
          className="max-w-40 min-w-0 truncate font-extrabold tracking-tight text-slate-900 sm:max-w-none"
        >
          Fishclassifieds
        </Link>

        <div className="flex-1" />

        {/* Desktop nav (full) */}
        <div className={["hidden items-center gap-3 md:flex", collapseForSearch ? "md:hidden lg:flex" : ""].join(" ")}>
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
            <Link to="/me" className="hidden text-sm font-semibold text-slate-700 hover:text-slate-900 lg:inline-flex">
              My listings
            </Link>
          ) : null}

          {user && (user.isAdmin || user.isSuperadmin) ? (
            <Link to="/admin" className="hidden text-sm font-semibold text-slate-700 hover:text-slate-900 lg:inline-flex">
              Admin dashboard
            </Link>
          ) : null}
        </div>

        {/* Mobile nav: collapse Browse + Post under a single actions menu on very small screens */}
        <div className={["flex items-center gap-2 md:hidden", collapseForSearch ? "hidden" : ""].join(" ")}>
          <div className="flex items-center gap-2 max-[380px]:hidden">
            <Link
              to="/browse?type=sale"
              className="inline-flex h-10 items-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900"
            >
              Browse
            </Link>
            <Link to="/post" className="rounded-2xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              Post
            </Link>
          </div>

          <div className="relative hidden max-[380px]:block" ref={mobileActionsAnchorRef}>
            <button
              type="button"
              onClick={() => {
                closeAllOverlays();
                setMobileActionsOpen((v) => !v);
              }}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900"
              aria-label="Actions"
              aria-haspopup="menu"
              aria-expanded={mobileActionsOpen}
            >
              <Menu aria-hidden="true" className="h-5 w-5" />
            </button>

            {mobileActionsOpen ? (
              <div
                ref={mobileActionsPanelRef}
                role="menu"
                className="absolute right-0 top-full z-50 mt-2 w-44 max-w-[calc(100dvw-1rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg"
                style={mobileActionsShiftX ? { transform: `translateX(${mobileActionsShiftX}px)` } : undefined}
              >
                <div className="p-2">
                  <Link
                    to="/browse?type=sale"
                    onClick={() => setMobileActionsOpen(false)}
                    className="block rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    role="menuitem"
                  >
                    Browse
                  </Link>
                  <Link
                    to="/post"
                    onClick={() => setMobileActionsOpen(false)}
                    className="mt-1 block rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    role="menuitem"
                  >
                    Post
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Top-right search: icon-only until clicked */}
        <div className="relative" ref={searchRef}>
          {!searchOpen ? (
            <button
              type="button"
              onClick={() => {
                closeAllOverlays();
                setSearchOpen(true);
              }}
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
              <div className="flex w-[min(18rem,calc(100dvw-6.5rem))] items-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:w-72">
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

        <div className={["items-center gap-2", collapseForSearch ? "hidden md:flex" : "flex"].join(" ")}>
          {loading ? <div className="text-sm font-semibold text-slate-500">Checking session…</div> : null}
          {!loading && user ? (
            <div className="flex items-center gap-2">
              {/* Notifications */}
              <div className="relative" ref={notifAnchorRef}>
                <button
                  type="button"
                  onClick={() => {
                    setNotifOpen((v) => {
                      const next = !v;
                      if (next) {
                        setOpen(false);
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
                        <div className="text-base font-black tracking-tight text-slate-900">Notifications</div>
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
                          const statusChange = statusChangeFromNotification(n);
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
                                // Open modal with full content (instead of navigating immediately).
                                openNotifModal({ ...n, isRead: true, readAt: n.readAt ?? new Date().toISOString() });
                                await refreshNotifications();
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex min-w-0 items-start gap-3">
                                  {n.imageUrl ? (
                                    <img
                                      src={n.imageUrl}
                                      alt=""
                                      loading="lazy"
                                      className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 bg-slate-50 object-cover"
                                    />
                                  ) : null}
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-bold text-slate-900">{n.title}</div>
                                    {statusChange ? (
                                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                        <span className="text-[11px] font-bold text-slate-500">Status:</span>
                                        {statusChange.prevStatus ? statusPill(statusChange.prevStatus) : null}
                                        {statusChange.prevStatus && statusChange.nextStatus && statusChange.prevStatus !== statusChange.nextStatus ? (
                                          <span className="text-[11px] font-bold text-slate-400">→</span>
                                        ) : null}
                                        {statusChange.nextStatus ? statusPill(statusChange.nextStatus) : null}
                                      </div>
                                    ) : null}
                                    {n.body ? <div className="mt-0.5 line-clamp-2 text-xs font-semibold text-slate-600">{n.body}</div> : null}
                                    {navTo ? <div className="mt-1 text-[11px] font-bold text-slate-700 underline underline-offset-4">{navTo.label}</div> : null}
                                  </div>
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

              {notifModalOpen &&
                notifModalItem &&
                typeof document !== "undefined" &&
                createPortal(
                  <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
                    <div
                      ref={notifModalPanelRef}
                      role="dialog"
                      aria-label="Notification details"
                      className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
                    >
                      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-base font-extrabold text-slate-900">{notifModalItem.title}</div>
                          <div
                            className="mt-0.5 text-xs font-semibold text-slate-500"
                            title={(() => {
                              const dt = new Date(notifModalItem.createdAt);
                              return Number.isFinite(dt.getTime()) ? dt.toLocaleString() : String(notifModalItem.createdAt ?? "");
                            })()}
                          >
                            {relativeTime(notifModalItem.createdAt)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={closeNotifModal}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                          aria-label="Close"
                          title="Close"
                        >
                          <X aria-hidden="true" className="h-5 w-5" />
                        </button>
                      </div>

                      <div className="max-h-[70vh] overflow-auto px-4 py-3">
                        {(() => {
                          const statusChange = statusChangeFromNotification(notifModalItem);
                          if (!statusChange) return null;
                          const { prevStatus, nextStatus } = statusChange;
                          return (
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                              <div className="text-xs font-bold text-slate-600">Status</div>
                              {prevStatus ? statusPill(prevStatus) : null}
                              {prevStatus && nextStatus && prevStatus !== nextStatus ? <span className="text-xs font-bold text-slate-400">→</span> : null}
                              {nextStatus ? statusPill(nextStatus) : null}
                            </div>
                          );
                        })()}
                        {notifModalItem.body ? (
                          <div className="whitespace-pre-wrap text-sm font-semibold text-slate-800">{notifModalItem.body}</div>
                        ) : (
                          <div className="text-sm font-semibold text-slate-500">No details.</div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
                        {(() => {
                          const navTo = extractNavFromNotification(notifModalItem);
                          if (!navTo) return null;
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                closeNotifModal();
                                nav(navTo.href);
                              }}
                              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                            >
                              {navTo.label}
                            </button>
                          );
                        })()}
                        <button
                          type="button"
                          onClick={closeNotifModal}
                          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}

              {/* Account */}
              <div className="relative" ref={menuAnchorRef}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen((v) => {
                      const next = !v;
                      if (next) {
                        setNotifOpen(false);
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
          ) : !loading && !user ? (
            <div className="hidden items-center gap-2 md:flex">
              <Link to="/login" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
                Sign in
              </Link>
              <span className="text-slate-300">/</span>
              <Link to="/signup" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
                Create account
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
