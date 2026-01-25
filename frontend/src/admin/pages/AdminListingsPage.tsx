import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowUpDown, CircleCheck, Clock, Eye, Hourglass, MoveDown, MoveUp, Pause, Play, Star, Trash2, User as UserIcon } from "lucide-react";
import {
    adminFetchListings,
    adminSetListingFeaturedUntil,
    adminSetListingRestrictions,
    adminSetListingStatus,
    resolveImageUrl,
    type AdminListingListItem,
    type ListingStatus,
} from "../../api";
import { useAuth } from "../../auth";
import NoPhotoPlaceholder from "../../components/NoPhotoPlaceholder";
import { MobileCard, MobileCardActions, MobileCardBody, MobileCardList, MobileCardMeta, MobileCardMetaGrid } from "../../components/table/MobileCards";
import { useDialogs } from "../../components/dialogs/DialogProvider";

type KindFilter = "all" | "sale" | "wanted";
type StatusFilter = "all" | ListingStatus;
type RestrictionsFilter = "all" | "any" | "none" | "edit" | "status" | "featuring";
type SortKey =
    | "listing"
    | "fullName"
    | "username"
    | "email"
    | "phone"
    | "restrictions"
    | "price"
    | "views"
    | "status"
    | "published"
    | "created"
    | "updated"
    | "expiresIn";
type SortDir = "asc" | "desc";
type ColKey =
    | "fullName"
    | "username"
    | "email"
    | "phone"
    | "restrictions"
    | "price"
    | "views"
    | "status"
    | "published"
    | "created"
    | "updated"
    | "expiresIn";

function GroupToggle(props: {
    label: string;
    keys: ColKey[];
    visibleCols: Record<ColKey, boolean>;
    setVisibleCols: React.Dispatch<React.SetStateAction<Record<ColKey, boolean>>>;
}) {
    const { label, keys, visibleCols, setVisibleCols } = props;
    const allOn = keys.every((k) => visibleCols[k]);
    const allOff = keys.every((k) => !visibleCols[k]);
    const ref = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!ref.current) return;
        ref.current.indeterminate = !allOn && !allOff;
    }, [allOn, allOff]);

    return (
        <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-bold text-slate-900">{label}</div>
            <div className="flex items-center gap-2">
                <input
                    ref={ref}
                    type="checkbox"
                    checked={allOn}
                    onChange={(e) => {
                        const next = e.target.checked;
                        setVisibleCols((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, next])) } as any));
                    }}
                    aria-label={`${label} columns`}
                />
            </div>
        </div>
    );
}

function centsToDollars(cents: number) {
    const s = (Number(cents ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `$${s}`;
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

function expiresInShort(expiresAt: string | null | undefined) {
    if (!expiresAt) return "—";
    const exp = new Date(expiresAt).getTime();
    if (!Number.isFinite(exp)) return "—";
    const diffMs = exp - Date.now();
    if (diffMs <= 0) return "Expired";

    const minMs = 60 * 1000;
    const hourMs = 60 * minMs;
    const dayMs = 24 * hourMs;

    if (diffMs < hourMs) return `${Math.max(1, Math.ceil(diffMs / minMs))}m`;
    if (diffMs < dayMs) return `${Math.max(1, Math.ceil(diffMs / hourMs))}h`;
    return `${Math.max(1, Math.ceil(diffMs / dayMs))}d`;
}

function cap1(s: string) {
    const t = String(s ?? "");
    if (!t) return t;
    return t.charAt(0).toUpperCase() + t.slice(1);
}

function StatusTextAny({ status }: { status: ListingStatus }) {
    const s = status;
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
    return (
        <div className={`text-sm font-semibold ${cls}`}>
            <div>{s === "sold" ? "Sold" : s === "closed" ? "Closed" : cap1(String(s))}</div>
        </div>
    );
}

function StatusPillAny({ status }: { status: ListingStatus }) {
    const s = status;
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

    return (
        <span className={`inline-flex shrink-0 rounded-full border border-slate-200 bg-transparent px-2 py-0.5 text-xs font-semibold ${cls}`}>
            {s === "sold" ? "Sold" : s === "closed" ? "Closed" : cap1(String(s))}
        </span>
    );
}

function ActionButton(props: {
    label: string;
    title?: string;
    onClick?: () => void;
    disabled?: boolean;
    variant?: "default" | "primary" | "danger" | "feature";
    icon?: React.ReactNode;
}) {
    const { label, title, onClick, disabled, variant = "default", icon } = props;
    const base =
        "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-3 text-xs font-bold leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
    const cls =
        variant === "primary"
            ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800 focus-visible:ring-slate-400 focus-visible:ring-offset-slate-50 disabled:opacity-60"
            : variant === "danger"
                ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus-visible:ring-red-200 focus-visible:ring-offset-slate-50 disabled:opacity-60"
                : variant === "feature"
                    ? "border-indigo-200 bg-indigo-50 text-indigo-950 shadow-sm hover:bg-indigo-100 focus-visible:ring-indigo-200 focus-visible:ring-offset-slate-50 disabled:opacity-60"
                    : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50 focus-visible:ring-slate-300 focus-visible:ring-offset-slate-50 disabled:opacity-60";
    return (
        <button type="button" title={title ?? label} aria-label={label} onClick={onClick} disabled={disabled} className={`${base} ${cls}`}>
            {icon}
            <span>{label}</span>
        </button>
    );
}

function ActionLink(props: { to: string; label: string; icon?: React.ReactNode }) {
    const { to, label, icon } = props;
    return (
        <Link
            to={to}
            className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold leading-none text-slate-900 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50"
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
        >
            {icon}
            <span>{label}</span>
        </Link>
    );
}

function budgetLabel(budgetCents: number | null) {
    if (budgetCents == null) return "Make an offer";
    return `Up to ${centsToDollars(budgetCents)}`;
}

function renderFeaturedTextAny(until: number | null) {
    if (until === null) return null;

    const diffMs = until - Date.now();
    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * hourMs;

    if (diffMs <= 0) {
        return (
            <div className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold leading-none text-red-700">
                <span>Feature expired</span>
            </div>
        );
    }

    if (diffMs < dayMs) {
        const hrs = Math.max(1, Math.ceil(diffMs / hourMs));
        return (
            <div className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold leading-none text-amber-700">
                <span>Featured ({hrs}h left)</span>
            </div>
        );
    }

    const days = Math.max(1, Math.ceil(diffMs / dayMs));
    return (
        <div className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold leading-none text-emerald-700">
            <span>Featured ({days}d left)</span>
        </div>
    );
}

export default function AdminListingsPage() {
    const { user } = useAuth();
    const dialogs = useDialogs();
    const routerLocation = useLocation();
    const [q, setQ] = useState("");
    const [userQ, setUserQ] = useState("");
    const [kind, setKind] = useState<KindFilter>("all");
    const [status, setStatus] = useState<StatusFilter>("all");
    const [featuredOnly, setFeaturedOnly] = useState(false);
    const [includeDeleted, setIncludeDeleted] = useState(true);
    const [restrictions, setRestrictions] = useState<RestrictionsFilter>("all");

    const [items, setItems] = useState<AdminListingListItem[]>([]);
    const [rowOrder, setRowOrder] = useState<string[]>([]);
    const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "status", dir: "asc" });
    const [total, setTotal] = useState(0);
    const [limit, setLimit] = useState(50);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const expandedIdRef = useRef<string | null>(null);

    const [mobilePanel, setMobilePanel] = useState<null | { rowKey: string; panel: "user" | "listing" | "actions" }>(null);

    const [restrictionsDraft, setRestrictionsDraft] = useState<
        | null
        | {
            listingId: string;
            // listing actions (drafted; only enacted on Save)
            desiredStatus: ListingStatus | null;
            desiredFeaturedUntil: number | null | undefined;
            blockEdit: boolean;
            blockPauseResume: boolean;
            blockStatusChanges: boolean;
            blockFeaturing: boolean;
            reason: string;
        }
    >(null);

    const editToolsRef = useRef<HTMLDivElement | null>(null);

    // Click-away should collapse the edit tools panel and discard any unsaved changes.
    useEffect(() => {
        if (!restrictionsDraft) return;
        const onMouseDown = (e: MouseEvent) => {
            const el = editToolsRef.current;
            if (!el) return;
            const t = e.target as Node | null;
            if (t && el.contains(t)) return;
            // Allow clicking the "Edit tools" toggle button without triggering click-away collapse.
            if (t && t instanceof Element && t.closest('[data-edit-tools-toggle="1"]')) return;
            setRestrictionsDraft(null);
        };
        document.addEventListener("mousedown", onMouseDown, true);
        return () => document.removeEventListener("mousedown", onMouseDown, true);
    }, [restrictionsDraft]);

    // If the row collapses or the user expands a different row, discard unsaved changes.
    useEffect(() => {
        const id = restrictionsDraft?.listingId;
        if (!id) return;
        const desktopRowStillOpen = Boolean(expandedId && expandedId.endsWith(`:${id}`));
        const mobileRowStillOpen = Boolean(mobilePanel?.rowKey && mobilePanel.rowKey.endsWith(`:${id}`));
        // Keep draft alive if the relevant row is still open in either desktop expanded-row mode
        // or the mobile cards' panels mode.
        if (!desktopRowStillOpen && !mobileRowStillOpen) setRestrictionsDraft(null);
    }, [expandedId, restrictionsDraft?.listingId, mobilePanel?.rowKey]);

    // When the backing row data refreshes after a Save, clear any "desired" values that now match the saved state.
    // This keeps the edit panel open without leaving stale "pending" values hanging around.
    useEffect(() => {
        const id = restrictionsDraft?.listingId;
        if (!id) return;
        const it = items.find((x) => x.id === id);
        if (!it) return;
        setRestrictionsDraft((p) => {
            if (!p || p.listingId !== id) return p;
            const nextDesiredStatus = p.desiredStatus != null && p.desiredStatus === it.status ? null : p.desiredStatus;
            const curFeaturedUntil = it.featuredUntil ?? null;
            const nextDesiredFeaturedUntil =
                p.desiredFeaturedUntil !== undefined && p.desiredFeaturedUntil === curFeaturedUntil ? undefined : p.desiredFeaturedUntil;
            if (nextDesiredStatus === p.desiredStatus && nextDesiredFeaturedUntil === p.desiredFeaturedUntil) return p;
            return { ...p, desiredStatus: nextDesiredStatus, desiredFeaturedUntil: nextDesiredFeaturedUntil };
        });
    }, [items, restrictionsDraft?.listingId]);

    const [colsOpen, setColsOpen] = useState(false);
    const colsOpenRef = useRef(false);

    const tableScrollRef = useRef<HTMLDivElement | null>(null);
    const stickyScrollRef = useRef<HTMLDivElement | null>(null);
    const [showStickyX, setShowStickyX] = useState(false);
    const [stickyGeom, setStickyGeom] = useState<{ left: number; width: number; scrollWidth: number } | null>(null);
    const stickyRecomputeRef = useRef<null | (() => void)>(null);
    const [tableViewportWidth, setTableViewportWidth] = useState<number | null>(null);

    const [visibleCols, setVisibleCols] = useState<Record<ColKey, boolean>>(() => {
        try {
            const raw = localStorage.getItem("fc_admin_listings_cols_v1");
            if (!raw) throw new Error("no saved cols");
            const parsed = JSON.parse(raw) as any;
            return {
                fullName: Boolean(parsed.fullName ?? true),
                username: Boolean(parsed.username ?? true),
                email: Boolean(parsed.email ?? true),
                phone: Boolean(parsed.phone ?? true),
                restrictions: Boolean(parsed.restrictions ?? true),
                price: Boolean(parsed.price ?? true),
                views: Boolean(parsed.views ?? true),
                status: Boolean(parsed.status ?? true),
                published: Boolean(parsed.published ?? true),
                created: Boolean(parsed.created ?? true),
                updated: Boolean(parsed.updated ?? true),
                expiresIn: Boolean(parsed.expiresIn ?? true),
            };
        } catch {
            return {
                fullName: true,
                username: true,
                email: true,
                phone: true,
                restrictions: true,
                price: true,
                views: true,
                status: true,
                published: true,
                created: true,
                updated: true,
                expiresIn: true,
            };
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem("fc_admin_listings_cols_v1", JSON.stringify(visibleCols));
        } catch {
            // ignore
        }
    }, [visibleCols]);

    useEffect(() => {
        expandedIdRef.current = expandedId;
    }, [expandedId]);

    useEffect(() => {
        colsOpenRef.current = colsOpen;
    }, [colsOpen]);

    // Track the visible width of the table scroller so we can center expanded-row actions
    // within the viewport even while horizontally scrolling.
    useEffect(() => {
        const el = tableScrollRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;

        function measure() {
            const cur = tableScrollRef.current;
            if (!cur) return;
            setTableViewportWidth(cur.clientWidth);
        }

        measure();
        const ro = new ResizeObserver(() => measure());
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Collapse only on full click and only when clicking outside any row.
    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            const cur = expandedIdRef.current;
            const t = e.target as HTMLElement | null;
            if (!t) return;
            const anyRowKey = t.closest(`[data-row-key]`)?.getAttribute("data-row-key") ?? null;
            if (!anyRowKey) {
                if (cur) setExpandedId(null);
                if (colsOpenRef.current) setColsOpen(false);
                return;
            }
        }
        document.addEventListener("click", onDocClick);
        return () => document.removeEventListener("click", onDocClick);
    }, []);

    function resetPaging() {
        setOffset(0);
    }

    async function load(next?: { offset?: number; preserveOrder?: boolean; sort?: { key: SortKey; dir: SortDir } }) {
        setLoading(true);
        setErr(null);
        try {
            const s = next?.sort ?? sort;
            const res = await adminFetchListings({
                q: q.trim() ? q.trim() : undefined,
                user: userQ.trim() ? userQ.trim() : undefined,
                kind,
                status,
                featured: featuredOnly ? true : undefined,
                includeDeleted: includeDeleted ? true : undefined,
                restrictions,
                sortKey: s.key,
                sortDir: s.dir,
                limit,
                offset: next?.offset ?? offset,
            });
            setItems(res.items);
            // Like My Listings: do NOT auto-reorder after local actions (pause/delete/feature),
            // because it makes the row jump out of view. Only re-order on initial load / filter changes / explicit sort clicks.
            if (!next?.preserveOrder) {
                setRowOrder(res.items.map((r) => `${r.kind}:${r.id}`));
            }
            setTotal(res.total);
            setLimit(res.limit);
            setOffset(res.offset);
        } catch (e: any) {
            setErr(e?.message ?? "Failed to load listings");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (cancelled) return;
            await load({ offset: 0 });
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind, status, restrictions, featuredOnly, includeDeleted, limit]);

    const pageText = useMemo(() => {
        if (loading) return "Loading…";
        if (!total) return "0";
        const start = Math.min(total, offset + 1);
        const end = Math.min(total, offset + items.length);
        return `${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`;
    }, [items.length, loading, offset, total]);

    const canPrev = offset > 0;
    const canNext = offset + limit < total;
    const isSuperadmin = Boolean(user?.isSuperadmin);

    const colCount = 2 + Object.values(visibleCols).filter(Boolean).length; // Listing + Actions + visible cols

    const tableWidthPx = useMemo(() => {
        // Keep these in sync with the <th className="w-[...px]"> widths below.
        const W = {
            listing: 360,
            fullName: 160,
            username: 140,
            email: 200,
            phone: 130,
            restrictions: 140,
            price: 110,
            views: 90,
            status: 110,
            published: 140,
            created: 140,
            updated: 140,
            expiresIn: 140,
            actions: 110,
        } as const;

        const sum =
            W.listing +
            (visibleCols.fullName ? W.fullName : 0) +
            (visibleCols.username ? W.username : 0) +
            (visibleCols.email ? W.email : 0) +
            (visibleCols.phone ? W.phone : 0) +
            (visibleCols.restrictions ? W.restrictions : 0) +
            (visibleCols.price ? W.price : 0) +
            (visibleCols.views ? W.views : 0) +
            (visibleCols.status ? W.status : 0) +
            (visibleCols.published ? W.published : 0) +
            (visibleCols.created ? W.created : 0) +
            (visibleCols.updated ? W.updated : 0) +
            (visibleCols.expiresIn ? W.expiresIn : 0) +
            W.actions;

        // Don't let it collapse too small; the Listing cell has a thumbnail + text.
        return Math.max(900, sum);
    }, [visibleCols]);

    // Show the fixed scrollbar only when:
    // - the table overflows horizontally, and
    // - the table is on screen, but its own bottom scrollbar is NOT visible.
    useEffect(() => {
        const mainEl = tableScrollRef.current;
        if (!mainEl) return;
        let raf = 0;

        function recompute() {
            const el = tableScrollRef.current;
            if (!el) {
                setShowStickyX(false);
                return;
            }
            const hasOverflow = el.scrollWidth > el.clientWidth + 1;
            if (!hasOverflow) {
                setShowStickyX(false);
                setStickyGeom(null);
                return;
            }
            const rect = el.getBoundingClientRect();
            const isOnScreen = rect.bottom > 0 && rect.top < window.innerHeight;
            if (!isOnScreen) {
                setShowStickyX(false);
                setStickyGeom(null);
                return;
            }
            const bottomVisible = rect.bottom <= window.innerHeight - 8;
            const shouldShow = !bottomVisible;
            setShowStickyX(shouldShow);
            if (shouldShow) {
                setStickyGeom({ left: rect.left, width: rect.width, scrollWidth: el.scrollWidth });
            } else {
                setStickyGeom(null);
            }
        }

        function schedule() {
            if (raf) return;
            raf = window.requestAnimationFrame(() => {
                raf = 0;
                recompute();
            });
        }

        // Expose a way for other effects (e.g. filter changes) to trigger a recompute.
        stickyRecomputeRef.current = schedule;

        recompute();
        window.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", schedule, { passive: true });
        mainEl.addEventListener("scroll", schedule, { passive: true });

        return () => {
            window.removeEventListener("scroll", schedule as any);
            window.removeEventListener("resize", schedule as any);
            mainEl.removeEventListener("scroll", schedule as any);
            if (raf) window.cancelAnimationFrame(raf);
            if (stickyRecomputeRef.current === schedule) stickyRecomputeRef.current = null;
        };
    }, [tableWidthPx, visibleCols]);

    // Filters / pagination / expansion can change the table's height (and whether the bottom is visible),
    // but they don't necessarily trigger scroll/resize events. Nudge the sticky scrollbar to recompute.
    useEffect(() => {
        stickyRecomputeRef.current?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [q, userQ, kind, status, featuredOnly, includeDeleted, offset, limit, items.length, expandedId, colsOpen, tableWidthPx, visibleCols]);

    // Keep the floating horizontal scrollbar in sync with the actual table scroller.
    // Note: keep the element mounted so refs exist and listeners attach reliably.
    useEffect(() => {
        const mainEl = tableScrollRef.current;
        const stickyEl = stickyScrollRef.current;
        if (!mainEl || !stickyEl) return;
        let syncing = false;

        function onMainScroll() {
            if (syncing) return;
            syncing = true;
            stickyEl!.scrollLeft = mainEl!.scrollLeft;
            syncing = false;
        }
        function onStickyScroll() {
            if (syncing) return;
            syncing = true;
            mainEl!.scrollLeft = stickyEl!.scrollLeft;
            syncing = false;
        }

        mainEl.addEventListener("scroll", onMainScroll, { passive: true });
        stickyEl.addEventListener("scroll", onStickyScroll, { passive: true });

        // Initialize sticky position to match main
        stickyEl.scrollLeft = mainEl.scrollLeft;

        return () => {
            mainEl.removeEventListener("scroll", onMainScroll as any);
            stickyEl.removeEventListener("scroll", onStickyScroll as any);
        };
    }, [tableWidthPx, showStickyX]);

    const displayRows = useMemo(() => {
        const map = new Map<string, AdminListingListItem>(items.map((r) => [`${r.kind}:${r.id}`, r]));
        const seen = new Set<string>();
        const ordered = rowOrder
            .map((k) => {
                const r = map.get(k) ?? null;
                if (r) seen.add(k);
                return r;
            })
            .filter((x): x is AdminListingListItem => !!x);
        const extras = items.filter((r) => !seen.has(`${r.kind}:${r.id}`));
        return [...ordered, ...extras];
    }, [items, rowOrder]);

    const defaultDirByKey: Record<SortKey, SortDir> = {
        listing: "asc",
        fullName: "asc",
        username: "asc",
        email: "asc",
        phone: "asc",
        restrictions: "desc",
        price: "asc",
        views: "desc",
        status: "asc",
        published: "desc",
        created: "desc",
        updated: "desc",
        expiresIn: "asc",
    };

    function toggleSort(next: SortKey) {
        const same = sort.key === next;
        const dir = same ? (sort.dir === "asc" ? "desc" : "asc") : defaultDirByKey[next];
        const key = next;
        const nextSort = { key, dir };
        setSort(nextSort);
        resetPaging();
        load({ offset: 0, sort: nextSort });
    }

    function SortTh(props: { label: string; k: SortKey; className?: string; title?: string; align?: "left" | "right" | "center" }) {
        const { label, k, className, title, align = "left" } = props;
        const active = sort.key === k;
        const icon = !active ? (
            <ArrowUpDown aria-hidden="true" className="h-4 w-4 text-slate-400" />
        ) : sort.dir === "asc" ? (
            <MoveUp aria-hidden="true" className="h-3 w-4 text-slate-400" />
        ) : (
            <MoveDown aria-hidden="true" className="h-3 w-4 text-slate-400" />
        );

        const thAlign = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

        return (
            <th className={[thAlign, className].filter(Boolean).join(" ")}>
                <button
                    type="button"
                    onClick={() => toggleSort(k)}
                    title={title ?? `Sort by ${label}`}
                    className="inline-flex w-full items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100"
                >
                    <span className={["min-w-0 flex-1 truncate whitespace-nowrap", thAlign].join(" ")}>{label}</span>
                    <span className="shrink-0">{icon}</span>
                </button>
            </th>
        );
    }

    function expandRow(id: string) {
        setExpandedId(id);
    }

    return (
        <div>
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="text-sm font-bold text-slate-900">All listings</div>
                    <div className="mt-1 text-sm text-slate-600">God’s-eye view across all listings.</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="text-xs font-semibold text-slate-600">Type</div>
                    <select
                        value={kind}
                        onChange={(e) => {
                            setKind(e.target.value as any);
                            resetPaging();
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                    >
                        <option value="all">All</option>
                        <option value="sale">For sale</option>
                        <option value="wanted">Wanted</option>
                    </select>

                    <div className="text-xs font-semibold text-slate-600">Status</div>
                    <select
                        value={status}
                        onChange={(e) => {
                            setStatus(e.target.value as any);
                            resetPaging();
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                    >
                        <option value="all">All</option>
                        <option value="draft">Draft</option>
                        <option value="pending">Pending</option>
                        <option value="active">Active</option>
                        <option value="paused">Paused</option>
                        <option value="sold">Sold</option>
                        <option value="closed">Closed</option>
                        <option value="expired">Expired</option>
                        <option value="deleted">Deleted</option>
                    </select>

                    <div className="text-xs font-semibold text-slate-600">Restrictions</div>
                    <select
                        value={restrictions}
                        onChange={(e) => {
                            setRestrictions(e.target.value as any);
                            resetPaging();
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                        title="Filter by owner restrictions"
                    >
                        <option value="all">All</option>
                        <option value="any">Any restrictions</option>
                        <option value="none">No restrictions</option>
                        <option value="edit">Edit/Resume blocked</option>
                        <option value="status">Status changes blocked</option>
                        <option value="featuring">Featuring blocked</option>
                    </select>

                    <label className="ml-2 inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <input
                            type="checkbox"
                            checked={featuredOnly}
                            onChange={(e) => {
                                setFeaturedOnly(e.target.checked);
                                resetPaging();
                            }}
                        />
                        Featured only
                    </label>

                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <input
                            type="checkbox"
                            checked={includeDeleted}
                            onChange={(e) => {
                                setIncludeDeleted(e.target.checked);
                                resetPaging();
                            }}
                        />
                        Include deleted
                    </label>

                    <div className="relative" data-row-key="columns-menu">
                        <button
                            type="button"
                            onClick={() => setColsOpen((v) => !v)}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 hover:bg-slate-50"
                        >
                            Columns
                        </button>
                        {colsOpen ? (
                            <div className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
                                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Column groups</div>
                                <div className="mt-2 grid gap-2">
                                    <GroupToggle
                                        label="User data"
                                        keys={["fullName", "username", "email", "phone"]}
                                        visibleCols={visibleCols}
                                        setVisibleCols={setVisibleCols}
                                    />
                                    <GroupToggle
                                        label="Moderation"
                                        keys={["restrictions"]}
                                        visibleCols={visibleCols}
                                        setVisibleCols={setVisibleCols}
                                    />
                                    <GroupToggle
                                        label="Listing metadata"
                                        keys={["status", "published", "created", "updated", "expiresIn"]}
                                        visibleCols={visibleCols}
                                        setVisibleCols={setVisibleCols}
                                    />
                                    <GroupToggle
                                        label="Metrics"
                                        keys={["price", "views"]}
                                        visibleCols={visibleCols}
                                        setVisibleCols={setVisibleCols}
                                    />
                                </div>

                                <div className="my-3 h-px w-full bg-slate-200" />

                                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Individual columns</div>
                                <div className="mt-2 grid gap-2">
                                    {(
                                        [
                                            ["fullName", "Full name"],
                                            ["username", "Username"],
                                            ["email", "Email"],
                                            ["phone", "Phone"],
                                            ["restrictions", "Restrictions"],
                                            ["price", "Price"],
                                            ["views", "Views"],
                                            ["status", "Status"],
                                            ["published", "Published"],
                                            ["created", "Created"],
                                            ["updated", "Updated"],
                                            ["expiresIn", "Expiry"],
                                        ] as Array<[ColKey, string]>
                                    ).map(([k, label]) => (
                                        <label key={k} className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-800">
                                            <span>{label}</span>
                                            <input
                                                type="checkbox"
                                                checked={visibleCols[k]}
                                                onChange={(e) => setVisibleCols((prev) => ({ ...prev, [k]: e.target.checked }))}
                                            />
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        load({ offset: 0 });
                    }}
                    placeholder="Search title/species/location/description…"
                    className="w-[420px] max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                />
                <input
                    value={userQ}
                    onChange={(e) => setUserQ(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        load({ offset: 0 });
                    }}
                    placeholder="User search (username/email)…"
                    className="w-[280px] max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                />
                <button
                    type="button"
                    onClick={() => load({ offset: 0 })}
                    disabled={loading}
                    className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                    Search
                </button>

                <div className="ml-auto flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <div className="text-xs font-semibold text-slate-600">Per page</div>
                        <select
                            value={limit}
                            onChange={(e) => {
                                const next = Math.max(1, Math.min(200, Math.floor(Number(e.target.value))));
                                setLimit(next);
                                setOffset(0);
                            }}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                        >
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                            <option value={200}>200</option>
                        </select>
                    </div>
                    <div className="text-xs font-semibold text-slate-600">{pageText}</div>
                </div>
            </div>

            {err ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div> : null}

            <div className="mt-4 flex items-center justify-between gap-2">
                <button
                    type="button"
                    disabled={!canPrev || loading}
                    onClick={() => load({ offset: Math.max(0, offset - limit) })}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                >
                    Prev
                </button>
                <button
                    type="button"
                    disabled={!canNext || loading}
                    onClick={() => load({ offset: offset + limit })}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                >
                    Next
                </button>
            </div>

            {/* Mobile cards */}
            <div className="mt-6 md:hidden">
                <MobileCardList>
                    {displayRows.map((it) => {
                        const rowKey = `${it.kind}:${it.id}`;
                        const hero = resolveImageUrl(it.heroUrl ?? null);
                        const openHref = `/listing/${it.kind}/${it.id}?viewContext=admin`;
                        const draft = restrictionsDraft?.listingId === it.id ? restrictionsDraft : null;
                        const effectiveStatus = (draft?.desiredStatus ?? it.status) as ListingStatus;
                        const effectiveFeaturedUntil =
                            draft?.desiredFeaturedUntil === undefined ? it.featuredUntil ?? null : draft.desiredFeaturedUntil;
                        const isFeatured = effectiveFeaturedUntil != null && effectiveFeaturedUntil > Date.now();
                        const priceText = it.kind === "sale" ? centsToDollars(it.priceCents) : budgetLabel(it.budgetCents ?? null);

                        const canToggle = effectiveStatus === "active" || effectiveStatus === "paused";
                        const toggleTitle = effectiveStatus === "paused" ? "Resume" : "Pause";

                        const e = Boolean(it.ownerBlockEdit);
                        const r = Boolean(it.ownerBlockPauseResume);
                        const s = Boolean(it.ownerBlockStatusChanges);
                        const f = Boolean(it.ownerBlockFeaturing);
                        const anyRestr = e || r || s || f;
                        const restrText = anyRestr ? [e ? "Edit" : null, r ? "Pause/Resume" : null, s ? "Status" : null, f ? "Featuring" : null].filter(Boolean).join(", ") : "—";

                        const isUserOpen = mobilePanel?.rowKey === rowKey && mobilePanel.panel === "user";
                        const isListingOpen = mobilePanel?.rowKey === rowKey && mobilePanel.panel === "listing";
                        const isActionsOpen = mobilePanel?.rowKey === rowKey && mobilePanel.panel === "actions";
                        const togglePanel = (panel: "user" | "listing" | "actions") => {
                            setMobilePanel((prev) => (prev?.rowKey === rowKey && prev.panel === panel ? null : { rowKey, panel }));
                        };

                        const qtyPillText = it.kind === "sale" ? `Qty ${Number(it.quantity ?? 0)}` : null;
                        const postedIso = (it.publishedAt ?? it.createdAt) as string;
                        const postedTitle = postedIso ? new Date(postedIso).toLocaleString() : "";
                        const postedAgo = postedIso ? relativeTime(postedIso) : "—";

                        const userLabel = it.user
                            ? `${it.user.firstName} ${it.user.lastName}${it.user.username ? ` (@${it.user.username})` : ""}`
                            : "—";
                        const emailText = it.user?.email ? String(it.user.email) : "—";
                        const phoneText = it.phone?.trim() ? it.phone.trim() : "—";

                        const catText = String(it.category ?? "—");
                        const speciesText = it.species ? String(it.species) : "—";
                        const waterText = it.waterType ? String(it.waterType) : "—";
                        const sexText = it.sex ? String(it.sex) : "—";
                        const sizeText = it.size ? String(it.size) : "—";
                        const qtyText = Number(it.quantity ?? 0).toLocaleString();
                        const shipText = it.shippingOffered ? "Yes" : "No";
                        const createdTitle = new Date(it.createdAt).toLocaleString();
                        const updatedTitle = new Date(it.updatedAt).toLocaleString();
                        const deletedTitle = it.deletedAt ? new Date(it.deletedAt).toLocaleString() : "";
                        const deletedAgo = it.deletedAt ? relativeTime(it.deletedAt) : "—";

                        return (
                            <MobileCard key={rowKey}>
                                <MobileCardBody>
                                    <div className="flex min-w-0 items-center gap-3">
                                        <Link
                                            to={openHref}
                                            state={{ from: { pathname: routerLocation.pathname, search: routerLocation.search, label: "admin listings" } }}
                                            className="h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
                                        >
                                            {hero ? (
                                                <img src={hero} alt={it.title} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                                            ) : (
                                                <NoPhotoPlaceholder variant="tile" className="px-1 text-center" />
                                            )}
                                        </Link>

                                        <div className="min-w-0 flex-1">
                                            <Link
                                                to={openHref}
                                                state={{ from: { pathname: routerLocation.pathname, search: routerLocation.search, label: "admin listings" } }}
                                                className="block truncate text-sm font-extrabold text-slate-900 hover:underline"
                                            >
                                                {it.title}
                                            </Link>
                                            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
                                                <span className="inline-flex shrink-0 rounded-full border border-slate-200 bg-transparent px-2 py-0.5 text-xs font-semibold text-slate-600">
                                                    {it.kind === "sale" ? "For sale" : "Wanted"}
                                                </span>
                                                {qtyPillText ? (
                                                    <span
                                                        title={qtyPillText}
                                                        className="inline-flex max-w-28 min-w-0 items-center rounded-full border border-slate-200 bg-transparent px-2 py-0.5 text-xs font-semibold text-slate-600"
                                                    >
                                                        <span className="min-w-0 truncate">{qtyPillText}</span>
                                                    </span>
                                                ) : null}
                                                <StatusPillAny status={effectiveStatus} />
                                            </div>
                                            <div className="mt-1">{renderFeaturedTextAny(effectiveFeaturedUntil)}</div>
                                        </div>
                                    </div>

                                    <div className="mt-3 flex items-center gap-2">
                                        <div className="w-28 shrink-0 min-h-9 flex items-center">
                                            <div title={priceText} className="text-lg font-black text-slate-900 leading-tight line-clamp-2">
                                                {priceText}
                                            </div>
                                        </div>
                                        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2 overflow-hidden pb-1 text-[11px] font-semibold text-slate-600 max-h-16">
                                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                                                <Eye aria-hidden="true" className="h-4 w-4" />
                                                {Number(it.views ?? 0).toLocaleString()}
                                            </span>
                                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1" title={postedTitle}>
                                                <Clock aria-hidden="true" className="h-4 w-4" />
                                                {postedAgo}
                                            </span>
                                            <span
                                                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1"
                                                title={it.expiresAt ? new Date(it.expiresAt).toLocaleString() : ""}
                                            >
                                                <Hourglass aria-hidden="true" className="h-4 w-4" />
                                                {expiresInShort(it.expiresAt)}
                                            </span>
                                        </div>
                                    </div>

                                    <MobileCardActions>
                                        <div className="flex w-full flex-wrap gap-2">
                                            <ActionButton
                                                label={isUserOpen ? "Hide user" : "User details"}
                                                title="User details"
                                                onClick={() => togglePanel("user")}
                                            />
                                            <ActionButton
                                                label={isListingOpen ? "Hide listing" : "Listing details"}
                                                title="Listing details"
                                                onClick={() => togglePanel("listing")}
                                            />
                                            <ActionButton
                                                label={isActionsOpen ? "Hide actions" : "Actions"}
                                                title="Actions"
                                                onClick={() => togglePanel("actions")}
                                            />
                                        </div>
                                    </MobileCardActions>

                                    {isUserOpen ? (
                                        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3" onClick={(e) => e.stopPropagation()}>
                                            <div className="text-sm font-extrabold text-slate-900">User details</div>
                                            <MobileCardMetaGrid>
                                                <MobileCardMeta
                                                    label="User"
                                                    value={
                                                        it.user?.id != null ? (
                                                            <Link to={`/admin/users/${it.user.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                                                                {userLabel}
                                                            </Link>
                                                        ) : (
                                                            userLabel
                                                        )
                                                    }
                                                />
                                                <MobileCardMeta label="Email" value={emailText} />
                                                <MobileCardMeta
                                                    label="Phone"
                                                    value={
                                                        phoneText !== "—" ? (
                                                            <a href={`tel:${phoneText}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                                                                {phoneText}
                                                            </a>
                                                        ) : (
                                                            "—"
                                                        )
                                                    }
                                                />
                                                <MobileCardMeta label="Restrictions" value={restrText} />
                                                {it.ownerBlockReason ? <MobileCardMeta label="Reason" value={String(it.ownerBlockReason)} /> : null}
                                                {it.ownerBlockUpdatedAt ? (
                                                    <MobileCardMeta
                                                        label="Restrictions updated"
                                                        value={<span title={new Date(it.ownerBlockUpdatedAt).toLocaleString()}>{relativeTime(it.ownerBlockUpdatedAt)}</span>}
                                                    />
                                                ) : null}
                                            </MobileCardMetaGrid>
                                        </div>
                                    ) : null}

                                    {isListingOpen ? (
                                        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3" onClick={(e) => e.stopPropagation()}>
                                            <div className="text-sm font-extrabold text-slate-900">Listing details</div>
                                            <MobileCardMetaGrid>
                                                <MobileCardMeta label="Location" value={it.location} />
                                                <MobileCardMeta label="Category" value={catText} />
                                                <MobileCardMeta label="Species" value={speciesText} />
                                                <MobileCardMeta label="Water" value={waterText} />
                                                <MobileCardMeta label="Sex" value={sexText} />
                                                <MobileCardMeta label="Size" value={sizeText} />
                                                <MobileCardMeta label="Qty" value={qtyText} />
                                                <MobileCardMeta label="Shipping" value={shipText} />
                                                <MobileCardMeta
                                                    label="Published"
                                                    value={it.publishedAt ? <span title={new Date(it.publishedAt).toLocaleString()}>{relativeTime(it.publishedAt)}</span> : "—"}
                                                />
                                                <MobileCardMeta label="Created" value={<span title={createdTitle}>{relativeTime(it.createdAt)}</span>} />
                                                <MobileCardMeta label="Updated" value={<span title={updatedTitle}>{relativeTime(it.updatedAt)}</span>} />
                                                <MobileCardMeta label="Expires" value={expiresInShort(it.expiresAt)} />
                                                {includeDeleted ? (
                                                    <MobileCardMeta label="Deleted" value={it.deletedAt ? <span title={deletedTitle}>{deletedAgo}</span> : "—"} />
                                                ) : null}
                                            </MobileCardMetaGrid>
                                        </div>
                                    ) : null}

                                    {isActionsOpen ? (
                                        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3" onClick={(e) => e.stopPropagation()}>
                                            <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2">
                                                <ActionLink to={openHref} label="Open listing" icon={<Star aria-hidden="true" className="h-4 w-4" />} />
                                                {it.user?.id != null ? (
                                                    <ActionLink to={`/admin/users/${it.user.id}`} label="Open user" icon={<UserIcon aria-hidden="true" className="h-4 w-4" />} />
                                                ) : null}
                                                <span data-edit-tools-toggle="1">
                                                    <span data-edit-tools-toggle="1">
                                                        <ActionButton
                                                            label={restrictionsDraft?.listingId === it.id ? "Hide edit tools" : "Edit tools"}
                                                            title="Open admin-only edit & moderation tools for this listing"
                                                            onClick={() => {
                                                                if (restrictionsDraft?.listingId === it.id) {
                                                                    setRestrictionsDraft(null);
                                                                    return;
                                                                }
                                                                setRestrictionsDraft({
                                                                    listingId: it.id,
                                                                    desiredStatus: null,
                                                                    desiredFeaturedUntil: undefined,
                                                                    blockEdit: Boolean(it.ownerBlockEdit),
                                                                    blockPauseResume: Boolean(it.ownerBlockPauseResume),
                                                                    blockStatusChanges: Boolean(it.ownerBlockStatusChanges),
                                                                    blockFeaturing: Boolean(it.ownerBlockFeaturing),
                                                                    reason: String(it.ownerBlockReason ?? ""),
                                                                });
                                                            }}
                                                        />
                                                    </span>
                                                </span>
                                            </div>

                                            {restrictionsDraft?.listingId === it.id ? (
                                                <div ref={editToolsRef} className="mx-auto mt-3 max-w-4xl rounded-2xl border border-slate-200 bg-white p-4">
                                                    <div className="text-sm font-extrabold text-slate-900">Edit tools</div>

                                                    <div className="my-2 text-xs font-extrabold text-slate-700">Listing actions</div>
                                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                                        <ActionButton
                                                            label={toggleTitle}
                                                            title={toggleTitle}
                                                            disabled={!canToggle}
                                                            onClick={async () => {
                                                                setRestrictionsDraft((p) =>
                                                                    p && p.listingId === it.id
                                                                        ? (() => {
                                                                            const nextStatus: ListingStatus = effectiveStatus === "paused" ? "active" : "paused";
                                                                            return {
                                                                                ...p,
                                                                                desiredStatus: nextStatus === it.status ? null : nextStatus,
                                                                                blockPauseResume: nextStatus === "paused",
                                                                            };
                                                                        })()
                                                                        : p
                                                                );
                                                            }}
                                                            icon={effectiveStatus === "paused" ? <Play aria-hidden="true" className="h-4 w-4" /> : <Pause aria-hidden="true" className="h-4 w-4" />}
                                                        />

                                                        {effectiveStatus !== "deleted" ? (
                                                            <ActionButton
                                                                label="Delete"
                                                                title="Delete"
                                                                variant="danger"
                                                                onClick={async () => {
                                                                    setRestrictionsDraft((p) =>
                                                                        p && p.listingId === it.id
                                                                            ? { ...p, desiredStatus: it.status === "deleted" ? null : "deleted", blockStatusChanges: true }
                                                                            : p
                                                                    );
                                                                }}
                                                                icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                                                            />
                                                        ) : (
                                                            <ActionButton
                                                                label="Restore"
                                                                title="Restore"
                                                                variant="primary"
                                                                onClick={async () => {
                                                                    setRestrictionsDraft((p) =>
                                                                        p && p.listingId === it.id
                                                                            ? { ...p, desiredStatus: it.status === "active" ? null : "active", blockStatusChanges: false }
                                                                            : p
                                                                    );
                                                                }}
                                                            />
                                                        )}

                                                        {isSuperadmin ? (
                                                            isFeatured ? (
                                                                <ActionButton
                                                                    label="Unfeature"
                                                                    title="Unfeature"
                                                                    variant="feature"
                                                                    onClick={async () => {
                                                                        setRestrictionsDraft((p) =>
                                                                            p && p.listingId === it.id
                                                                                ? {
                                                                                    ...p,
                                                                                    desiredFeaturedUntil: (it.featuredUntil ?? null) === null ? undefined : null,
                                                                                    blockFeaturing: true,
                                                                                }
                                                                                : p
                                                                        );
                                                                    }}
                                                                    icon={<CircleCheck aria-hidden="true" className="h-4 w-4" />}
                                                                />
                                                            ) : (
                                                                <ActionButton
                                                                    label="Feature"
                                                                    title="Feature"
                                                                    variant="feature"
                                                                    onClick={async () => {
                                                                        const daysRaw = await dialogs.prompt({
                                                                            title: "Feature listing",
                                                                            body: "Feature for how many days?",
                                                                            placeholder: "7",
                                                                            defaultValue: "7",
                                                                            inputMode: "numeric",
                                                                            confirmText: "Set",
                                                                            cancelText: "Cancel",
                                                                        });
                                                                        if (daysRaw === null) return;
                                                                        const days = Math.max(1, Math.min(3650, Math.floor(Number(daysRaw))));
                                                                        if (!Number.isFinite(days)) return;
                                                                        setRestrictionsDraft((p) =>
                                                                            p && p.listingId === it.id
                                                                                ? {
                                                                                    ...p,
                                                                                    desiredFeaturedUntil: Date.now() + days * 24 * 60 * 60 * 1000,
                                                                                    blockFeaturing: false,
                                                                                }
                                                                                : p
                                                                        );
                                                                    }}
                                                                    icon={<Star aria-hidden="true" className="h-4 w-4" />}
                                                                />
                                                            )
                                                        ) : null}
                                                    </div>

                                                    <div className="mt-4 text-xs font-extrabold text-slate-700">Owner restrictions</div>
                                                    <div className="mt-1 text-xs font-semibold text-slate-600">
                                                        Toggle which capabilities are blocked for the listing owner. Changes are audited and the owner is notified.
                                                    </div>

                                                    <div className="mt-3 grid gap-3 sm:grid-cols-4">
                                                        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                                                            <input
                                                                type="checkbox"
                                                                checked={restrictionsDraft.blockEdit}
                                                                onChange={(e) => setRestrictionsDraft((p) => (p ? { ...p, blockEdit: e.target.checked } : p))}
                                                            />
                                                            Block edit
                                                        </label>
                                                        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                                                            <input
                                                                type="checkbox"
                                                                checked={restrictionsDraft.blockPauseResume}
                                                                onChange={(e) => setRestrictionsDraft((p) => (p ? { ...p, blockPauseResume: e.target.checked } : p))}
                                                            />
                                                            Block pause/resume
                                                        </label>
                                                        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                                                            <input
                                                                type="checkbox"
                                                                checked={restrictionsDraft.blockStatusChanges}
                                                                onChange={(e) => setRestrictionsDraft((p) => (p ? { ...p, blockStatusChanges: e.target.checked } : p))}
                                                            />
                                                            Block status changes
                                                        </label>
                                                        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                                                            <input
                                                                type="checkbox"
                                                                checked={restrictionsDraft.blockFeaturing}
                                                                onChange={(e) => setRestrictionsDraft((p) => (p ? { ...p, blockFeaturing: e.target.checked } : p))}
                                                            />
                                                            Block featuring
                                                        </label>
                                                    </div>

                                                    <div className="mt-3">
                                                        <div className="mb-1 text-xs font-bold text-slate-700">Reason (optional)</div>
                                                        <input
                                                            value={restrictionsDraft.reason}
                                                            onChange={(e) => setRestrictionsDraft((p) => (p ? { ...p, reason: e.target.value } : p))}
                                                            placeholder="Visible to owner"
                                                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                                                        />
                                                    </div>

                                                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                                                        <ActionButton label="Cancel" title="Cancel" onClick={() => setRestrictionsDraft(null)} />
                                                        <ActionButton
                                                            label="Save"
                                                            title="Save"
                                                            variant="primary"
                                                            onClick={async () => {
                                                                const d = restrictionsDraft;
                                                                if (!d) return;

                                                                // 1) Listing actions
                                                                const desiredStatus = d.desiredStatus ?? it.status;
                                                                if (desiredStatus !== it.status) {
                                                                    const ok =
                                                                        desiredStatus === "deleted"
                                                                            ? await dialogs.confirm({
                                                                                title: "Delete listing?",
                                                                                body: "It will be hidden from the site.",
                                                                                confirmText: "Delete",
                                                                                cancelText: "Cancel",
                                                                                destructive: true,
                                                                            })
                                                                            : desiredStatus === "active" && it.status === "deleted"
                                                                                ? await dialogs.confirm({
                                                                                    title: "Restore listing?",
                                                                                    body: "Restore this listing to active?",
                                                                                    confirmText: "Restore",
                                                                                    cancelText: "Cancel",
                                                                                })
                                                                                : true;
                                                                    if (!ok) return;
                                                                    await adminSetListingStatus(it.id, desiredStatus);
                                                                }

                                                                if (isSuperadmin && d.desiredFeaturedUntil !== undefined) {
                                                                    const cur = it.featuredUntil ?? null;
                                                                    const next = d.desiredFeaturedUntil;
                                                                    if (next !== cur) {
                                                                        await adminSetListingFeaturedUntil(it.id, next);
                                                                    }
                                                                }

                                                                // 2) Owner restrictions
                                                                const any = d.blockEdit || d.blockPauseResume || d.blockStatusChanges || d.blockFeaturing;
                                                                const nextReason = any && d.reason.trim() ? d.reason.trim() : null;
                                                                const curReason = it.ownerBlockReason == null ? null : String(it.ownerBlockReason);
                                                                const shouldApplyRestrictions =
                                                                    Boolean(it.ownerBlockEdit) !== d.blockEdit ||
                                                                    Boolean(it.ownerBlockPauseResume) !== d.blockPauseResume ||
                                                                    Boolean(it.ownerBlockStatusChanges) !== d.blockStatusChanges ||
                                                                    Boolean(it.ownerBlockFeaturing) !== d.blockFeaturing ||
                                                                    curReason !== nextReason;

                                                                if (shouldApplyRestrictions) {
                                                                    await adminSetListingRestrictions(it.id, {
                                                                        blockEdit: d.blockEdit,
                                                                        blockPauseResume: d.blockPauseResume,
                                                                        blockStatusChanges: d.blockStatusChanges,
                                                                        blockFeaturing: d.blockFeaturing,
                                                                        reason: nextReason,
                                                                    });
                                                                }
                                                                await load({ preserveOrder: true });
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </MobileCardBody>
                            </MobileCard>
                        );
                    })}
                </MobileCardList>
            </div>

            {/* Desktop table */}
            <div className="mt-6 hidden overflow-hidden rounded-2xl border border-slate-200 bg-white md:block">
                <div className="overflow-x-auto" ref={tableScrollRef}>
                    <table className="table-fixed" style={{ width: tableWidthPx }}>
                        <thead className="bg-slate-100/80 border-b border-slate-200 shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.06)]">
                            <tr className="text-xs font-bold tracking-wider text-slate-600">
                                <SortTh label="Listing" k="listing" className="w-[360px] px-2 py-3" align="left" />
                                {visibleCols.fullName ? <SortTh label="Full name" k="fullName" className="w-[160px] px-2 py-3" align="left" /> : null}
                                {visibleCols.username ? <SortTh label="Username" k="username" className="w-[140px] px-2 py-3" align="left" /> : null}
                                {visibleCols.email ? <SortTh label="Email" k="email" className="w-[200px] px-2 py-3" align="left" /> : null}
                                {visibleCols.phone ? <SortTh label="Phone" k="phone" className="w-[130px] px-2 py-3" align="left" /> : null}
                                {visibleCols.restrictions ? <SortTh label="Restrictions" k="restrictions" className="w-[140px] px-2 py-3" align="left" /> : null}
                                {visibleCols.price ? <SortTh label="Price" k="price" className="w-[110px] px-2 py-3" align="right" /> : null}
                                {visibleCols.views ? <SortTh label="Views" k="views" className="w-[90px] px-2 py-3" align="right" /> : null}
                                {visibleCols.status ? <SortTh label="Status" k="status" className="w-[110px] px-2 py-3" title="Default: Status then Updated" align="left" /> : null}
                                {visibleCols.published ? <SortTh label="Published" k="published" className="w-[140px] px-2 py-3" align="left" /> : null}
                                {visibleCols.created ? <SortTh label="Created" k="created" className="w-[140px] px-2 py-3" align="left" /> : null}
                                {visibleCols.updated ? <SortTh label="Updated" k="updated" className="w-[140px] px-2 py-3" align="left" /> : null}
                                {visibleCols.expiresIn ? <SortTh label="Expiry" k="expiresIn" className="w-[140px] px-2 py-3" align="left" /> : null}
                                <th className="w-[110px] px-2 py-3 text-center whitespace-nowrap">Actions</th>
                            </tr>
                        </thead>

                        {displayRows.map((it, idx) => {
                            const rowKey = `${it.kind}:${it.id}`;
                            const rowBorder = idx === 0 ? "" : "border-t border-slate-200";
                            const isExpanded = expandedId === rowKey;
                            const hero = resolveImageUrl(it.heroUrl ?? null);
                            const openHref = `/listing/${it.kind}/${it.id}?viewContext=admin`;
                            const draft = restrictionsDraft?.listingId === it.id ? restrictionsDraft : null;
                            const effectiveStatus = (draft?.desiredStatus ?? it.status) as ListingStatus;
                            const effectiveFeaturedUntil =
                                draft?.desiredFeaturedUntil === undefined ? it.featuredUntil ?? null : draft.desiredFeaturedUntil;
                            const isFeatured = effectiveFeaturedUntil != null && effectiveFeaturedUntil > Date.now();
                            const priceText = it.kind === "sale" ? centsToDollars(it.priceCents) : budgetLabel(it.budgetCents ?? null);

                            const canToggle = effectiveStatus === "active" || effectiveStatus === "paused";
                            const toggleTitle = effectiveStatus === "paused" ? "Resume" : "Pause";

                            return (
                                <tbody key={rowKey} className="group">
                                    <tr
                                        className={["cursor-pointer transition-colors group-hover:bg-slate-50/70", rowBorder].join(" ")}
                                        data-row-key={rowKey}
                                        onClick={() => expandRow(rowKey)}
                                    >
                                        <td className="px-2 py-3 align-top text-left">
                                            <div className="flex min-h-20 items-center gap-3">
                                                <Link
                                                    to={openHref}
                                                    state={{ from: { pathname: routerLocation.pathname, search: routerLocation.search, label: "admin listings" } }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
                                                >
                                                    {hero ? (
                                                        <img src={hero} alt={it.title} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                                                    ) : (
                                                        <NoPhotoPlaceholder variant="tile" className="px-1 text-center" />
                                                    )}
                                                </Link>

                                                <div className="flex h-20 min-w-0 flex-1 flex-col justify-center">
                                                    <Link
                                                        to={openHref}
                                                        state={{ from: { pathname: routerLocation.pathname, search: routerLocation.search, label: "admin listings" } }}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="block truncate text-sm font-extrabold text-slate-900 hover:underline"
                                                    >
                                                        {it.title}
                                                    </Link>
                                                    <div className="mt-1 flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-600">
                                                        <span className="inline-flex shrink-0 rounded-full border border-slate-200 bg-transparent px-2 py-0.5 text-xs font-semibold text-slate-600">
                                                            {it.kind === "sale" ? "For sale" : "Wanted"}
                                                        </span>
                                                        <span className="truncate">{it.location}</span>
                                                    </div>
                                                    <div className="mt-1">{renderFeaturedTextAny(effectiveFeaturedUntil)}</div>
                                                </div>
                                            </div>
                                        </td>

                                        {visibleCols.fullName ? (
                                            <td className="px-2 py-3 align-top text-left">
                                                <div className="text-sm font-semibold text-slate-700">
                                                    {it.user ? `${String(it.user.firstName ?? "").trim()} ${String(it.user.lastName ?? "").trim()}`.trim() || "—" : "—"}
                                                </div>
                                            </td>
                                        ) : null}

                                        {visibleCols.username ? (
                                            <td className="px-2 py-3 align-top text-left">
                                                <div className="text-sm font-semibold text-slate-700">{it.user?.username ?? "—"}</div>
                                            </td>
                                        ) : null}

                                        {visibleCols.email ? (
                                            <td className="px-2 py-3 align-top text-left">
                                                <div className="truncate text-sm font-semibold text-slate-700">{it.user?.email ?? "—"}</div>
                                            </td>
                                        ) : null}

                                        {visibleCols.phone ? (
                                            <td className="px-2 py-3 align-top text-left">
                                                <div className="text-sm font-semibold text-slate-700">{it.phone ? it.phone : "—"}</div>
                                            </td>
                                        ) : null}

                                        {visibleCols.restrictions ? (
                                            <td className="px-2 py-3 align-top text-left">
                                                {(() => {
                                                    const e = Boolean(it.ownerBlockEdit);
                                                    const r = Boolean(it.ownerBlockPauseResume);
                                                    const s = Boolean(it.ownerBlockStatusChanges);
                                                    const f = Boolean(it.ownerBlockFeaturing);
                                                    const any = e || r || s || f;
                                                    const reason = it.ownerBlockReason ? String(it.ownerBlockReason) : "";
                                                    const title = any
                                                        ? `Blocked: ${[e ? "Edit" : null, r ? "Pause/Resume" : null, s ? "Status" : null, f ? "Featuring" : null].filter(Boolean).join(", ")}${reason ? ` — Reason: ${reason}` : ""
                                                        }`
                                                        : "No owner restrictions";
                                                    return (
                                                        <div title={title} className="text-sm font-semibold text-slate-700">
                                                            {any ? (
                                                                <div className="flex flex-wrap items-center gap-1">
                                                                    {e ? (
                                                                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-900">
                                                                            Edit
                                                                        </span>
                                                                    ) : null}
                                                                    {r ? (
                                                                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-900">
                                                                            Pause/Resume
                                                                        </span>
                                                                    ) : null}
                                                                    {s ? (
                                                                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-900">
                                                                            Status changes
                                                                        </span>
                                                                    ) : null}
                                                                    {f ? (
                                                                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-900">
                                                                            Featuring
                                                                        </span>
                                                                    ) : null}
                                                                </div>
                                                            ) : (
                                                                <span className="text-slate-400">—</span>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
                                            </td>
                                        ) : null}

                                        {visibleCols.price ? (
                                            <td className="px-2 py-3 align-top text-right">
                                                <div className="text-sm font-extrabold text-slate-900">{priceText}</div>
                                            </td>
                                        ) : null}

                                        {visibleCols.views ? (
                                            <td className="px-2 py-3 align-top text-right">
                                                <div className="text-sm font-semibold text-slate-700">{Number(it.views ?? 0).toLocaleString()}</div>
                                            </td>
                                        ) : null}

                                        {visibleCols.status ? (
                                            <td className="px-2 py-3 align-top text-left">
                                                <StatusTextAny status={effectiveStatus} />
                                            </td>
                                        ) : null}

                                        {visibleCols.published ? (
                                            <td className="px-2 py-3 align-top text-left">
                                                {it.publishedAt ? (
                                                    <div className="text-sm font-semibold leading-tight text-slate-700">
                                                        <div>{new Date(it.publishedAt).toLocaleDateString()}</div>
                                                        <div className="text-xs font-semibold text-slate-600">
                                                            {new Date(it.publishedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="text-sm font-semibold text-slate-700">—</div>
                                                )}
                                            </td>
                                        ) : null}

                                        {visibleCols.created ? (
                                            <td className="px-2 py-3 align-top text-left">
                                                <div className="text-sm font-semibold leading-tight text-slate-700">
                                                    <div>{new Date(it.createdAt).toLocaleDateString()}</div>
                                                    <div className="text-xs font-semibold text-slate-600">
                                                        {new Date(it.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                                    </div>
                                                </div>
                                            </td>
                                        ) : null}

                                        {visibleCols.updated ? (
                                            <td className="px-2 py-3 align-top text-left">
                                                <div className="text-sm font-semibold text-slate-700" title={new Date(it.updatedAt).toLocaleString()}>
                                                    {relativeTime(it.updatedAt)}
                                                </div>
                                            </td>
                                        ) : null}

                                        {visibleCols.expiresIn ? (
                                            <td className="px-2 py-3 align-top text-left">
                                                <div className="text-sm font-semibold text-slate-700" title={it.expiresAt ? new Date(it.expiresAt).toLocaleString() : ""}>
                                                    {expiresInShort(it.expiresAt)}
                                                </div>
                                            </td>
                                        ) : null}

                                        <td className="px-2 py-3 align-top text-center">
                                            <div
                                                className="flex justify-center"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (isExpanded) setExpandedId(null);
                                                    else expandRow(rowKey);
                                                }}
                                            >
                                                <ActionButton label={isExpanded ? "Hide" : "Actions"} title={isExpanded ? "Hide actions" : "Show actions"} />
                                            </div>
                                        </td>
                                    </tr>

                                    {isExpanded && (
                                        <tr className="transition-colors group-hover:bg-slate-50/70" data-row-key={rowKey}>
                                            <td colSpan={colCount} className="pb-3 pt-0" data-row-key={rowKey} onClick={(e) => e.stopPropagation()}>
                                                <div
                                                    className="sticky left-0 flex justify-center"
                                                    style={{ width: tableViewportWidth != null ? `${tableViewportWidth}px` : "100%" }}
                                                    data-row-key={rowKey}
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <div className="px-2">
                                                        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2">
                                                            <ActionLink to={openHref} label="Open listing" icon={<Star aria-hidden="true" className="h-4 w-4" />} />
                                                            {it.user?.id != null ? (
                                                                <ActionLink to={`/admin/users/${it.user.id}`} label="Open user" icon={<UserIcon aria-hidden="true" className="h-4 w-4" />} />
                                                            ) : null}
                                                            <ActionButton
                                                                label={restrictionsDraft?.listingId === it.id ? "Hide edit tools" : "Edit tools"}
                                                                title="Open admin-only edit & moderation tools for this listing"
                                                                onClick={() => {
                                                                    if (restrictionsDraft?.listingId === it.id) {
                                                                        setRestrictionsDraft(null);
                                                                        return;
                                                                    }
                                                                    setRestrictionsDraft({
                                                                        listingId: it.id,
                                                                        desiredStatus: null,
                                                                        desiredFeaturedUntil: undefined,
                                                                        blockEdit: Boolean(it.ownerBlockEdit),
                                                                        blockPauseResume: Boolean(it.ownerBlockPauseResume),
                                                                        blockStatusChanges: Boolean(it.ownerBlockStatusChanges),
                                                                        blockFeaturing: Boolean(it.ownerBlockFeaturing),
                                                                        reason: String(it.ownerBlockReason ?? ""),
                                                                    });
                                                                }}
                                                            />
                                                        </div>

                                                        {restrictionsDraft?.listingId === it.id && (
                                                            <div ref={editToolsRef} className="mx-auto mt-3 max-w-4xl rounded-2xl border border-slate-200 bg-white p-4">
                                                                <div className="text-sm font-extrabold text-slate-900">Edit tools</div>

                                                                <div className="text-xs my-2 font-extrabold text-slate-700">Listing actions</div>
                                                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                                                    <ActionButton
                                                                        label={toggleTitle}
                                                                        title={toggleTitle}
                                                                        disabled={!canToggle}
                                                                        onClick={async () => {
                                                                            setRestrictionsDraft((p) =>
                                                                                p && p.listingId === it.id
                                                                                    ? (() => {
                                                                                        const nextStatus: ListingStatus = effectiveStatus === "paused" ? "active" : "paused";
                                                                                        return {
                                                                                            ...p,
                                                                                            desiredStatus: nextStatus === it.status ? null : nextStatus,
                                                                                            blockPauseResume: nextStatus === "paused",
                                                                                        };
                                                                                    })()
                                                                                    : p
                                                                            );
                                                                        }}
                                                                        icon={effectiveStatus === "paused" ? <Play aria-hidden="true" className="h-4 w-4" /> : <Pause aria-hidden="true" className="h-4 w-4" />}
                                                                    />

                                                                    {effectiveStatus !== "deleted" ? (
                                                                        <ActionButton
                                                                            label="Delete"
                                                                            title="Delete"
                                                                            variant="danger"
                                                                            onClick={async () => {
                                                                                setRestrictionsDraft((p) =>
                                                                                    p && p.listingId === it.id
                                                                                        ? { ...p, desiredStatus: it.status === "deleted" ? null : "deleted", blockStatusChanges: true }
                                                                                        : p
                                                                                );
                                                                            }}
                                                                            icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                                                                        />
                                                                    ) : (
                                                                        <ActionButton
                                                                            label="Restore"
                                                                            title="Restore"
                                                                            variant="primary"
                                                                            onClick={async () => {
                                                                                setRestrictionsDraft((p) =>
                                                                                    p && p.listingId === it.id
                                                                                        ? { ...p, desiredStatus: it.status === "active" ? null : "active", blockStatusChanges: false }
                                                                                        : p
                                                                                );
                                                                            }}
                                                                        />
                                                                    )}

                                                                    {isSuperadmin ? (
                                                                        isFeatured ? (
                                                                            <ActionButton
                                                                                label="Unfeature"
                                                                                title="Unfeature"
                                                                                variant="feature"
                                                                                onClick={async () => {
                                                                                    setRestrictionsDraft((p) =>
                                                                                        p && p.listingId === it.id
                                                                                            ? {
                                                                                                ...p,
                                                                                                desiredFeaturedUntil: (it.featuredUntil ?? null) === null ? undefined : null,
                                                                                                blockFeaturing: true,
                                                                                            }
                                                                                            : p
                                                                                    );
                                                                                }}
                                                                                icon={<CircleCheck aria-hidden="true" className="h-4 w-4" />}
                                                                            />
                                                                        ) : (
                                                                            <ActionButton
                                                                                label="Feature"
                                                                                title="Feature"
                                                                                variant="feature"
                                                                                onClick={async () => {
                                                                                    const daysRaw = await dialogs.prompt({
                                                                                        title: "Feature listing",
                                                                                        body: "Feature for how many days?",
                                                                                        placeholder: "7",
                                                                                        defaultValue: "7",
                                                                                        inputMode: "numeric",
                                                                                        confirmText: "Set",
                                                                                        cancelText: "Cancel",
                                                                                    });
                                                                                    if (daysRaw === null) return;
                                                                                    const days = Math.max(1, Math.min(3650, Math.floor(Number(daysRaw))));
                                                                                    if (!Number.isFinite(days)) return;
                                                                                    setRestrictionsDraft((p) =>
                                                                                        p && p.listingId === it.id
                                                                                            ? {
                                                                                                ...p,
                                                                                                desiredFeaturedUntil: Date.now() + days * 24 * 60 * 60 * 1000,
                                                                                                blockFeaturing: false,
                                                                                            }
                                                                                            : p
                                                                                    );
                                                                                }}
                                                                                icon={<Star aria-hidden="true" className="h-4 w-4" />}
                                                                            />
                                                                        )
                                                                    ) : null}
                                                                </div>


                                                                <div className="mt-4 text-xs font-extrabold text-slate-700">Owner restrictions</div>
                                                                <div className="mt-1 text-xs font-semibold text-slate-600">
                                                                    Toggle which capabilities are blocked for the listing owner. Changes are audited and the owner is notified.
                                                                </div>

                                                                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                                                                    <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={restrictionsDraft.blockEdit}
                                                                            onChange={(e) => setRestrictionsDraft((p) => (p ? { ...p, blockEdit: e.target.checked } : p))}
                                                                        />
                                                                        Block edit
                                                                    </label>
                                                                    <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={restrictionsDraft.blockPauseResume}
                                                                            onChange={(e) => setRestrictionsDraft((p) => (p ? { ...p, blockPauseResume: e.target.checked } : p))}
                                                                        />
                                                                        Block pause/resume
                                                                    </label>
                                                                    <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={restrictionsDraft.blockStatusChanges}
                                                                            onChange={(e) => setRestrictionsDraft((p) => (p ? { ...p, blockStatusChanges: e.target.checked } : p))}
                                                                        />
                                                                        Block status changes
                                                                    </label>
                                                                    <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={restrictionsDraft.blockFeaturing}
                                                                            onChange={(e) => setRestrictionsDraft((p) => (p ? { ...p, blockFeaturing: e.target.checked } : p))}
                                                                        />
                                                                        Block featuring
                                                                    </label>
                                                                </div>

                                                                <div className="mt-3">
                                                                    <div className="mb-1 text-xs font-bold text-slate-700">Reason (optional)</div>
                                                                    <input
                                                                        value={restrictionsDraft.reason}
                                                                        onChange={(e) => setRestrictionsDraft((p) => (p ? { ...p, reason: e.target.value } : p))}
                                                                        placeholder="Visible to owner"
                                                                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                                                                    />
                                                                </div>

                                                                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                                                                    <ActionButton
                                                                        label="Cancel"
                                                                        title="Cancel"
                                                                        onClick={() => setRestrictionsDraft(null)}
                                                                    />
                                                                    <ActionButton
                                                                        label="Save"
                                                                        title="Save"
                                                                        variant="primary"
                                                                        onClick={async () => {
                                                                            const d = restrictionsDraft;
                                                                            if (!d) return;

                                                                            // 1) Listing actions
                                                                            const desiredStatus = d.desiredStatus ?? it.status;
                                                                            if (desiredStatus !== it.status) {
                                                                                const ok =
                                                                                    desiredStatus === "deleted"
                                                                                        ? await dialogs.confirm({
                                                                                            title: "Delete listing?",
                                                                                            body: "It will be hidden from the site.",
                                                                                            confirmText: "Delete",
                                                                                            cancelText: "Cancel",
                                                                                            destructive: true,
                                                                                        })
                                                                                        : desiredStatus === "active" && it.status === "deleted"
                                                                                            ? await dialogs.confirm({
                                                                                                title: "Restore listing?",
                                                                                                body: "Restore this listing to active?",
                                                                                                confirmText: "Restore",
                                                                                                cancelText: "Cancel",
                                                                                            })
                                                                                            : true;
                                                                                if (!ok) return;
                                                                                await adminSetListingStatus(it.id, desiredStatus);
                                                                            }

                                                                            if (isSuperadmin && d.desiredFeaturedUntil !== undefined) {
                                                                                const cur = it.featuredUntil ?? null;
                                                                                const next = d.desiredFeaturedUntil;
                                                                                if (next !== cur) {
                                                                                    await adminSetListingFeaturedUntil(it.id, next);
                                                                                }
                                                                            }

                                                                            // 2) Owner restrictions
                                                                            const any = d.blockEdit || d.blockPauseResume || d.blockStatusChanges || d.blockFeaturing;
                                                                            const nextReason = any && d.reason.trim() ? d.reason.trim() : null;
                                                                            const curReason = it.ownerBlockReason == null ? null : String(it.ownerBlockReason);
                                                                            const shouldApplyRestrictions =
                                                                                Boolean(it.ownerBlockEdit) !== d.blockEdit ||
                                                                                Boolean(it.ownerBlockPauseResume) !== d.blockPauseResume ||
                                                                                Boolean(it.ownerBlockStatusChanges) !== d.blockStatusChanges ||
                                                                                Boolean(it.ownerBlockFeaturing) !== d.blockFeaturing ||
                                                                                curReason !== nextReason;

                                                                            if (shouldApplyRestrictions) {
                                                                                await adminSetListingRestrictions(it.id, {
                                                                                    blockEdit: d.blockEdit,
                                                                                    blockPauseResume: d.blockPauseResume,
                                                                                    blockStatusChanges: d.blockStatusChanges,
                                                                                    blockFeaturing: d.blockFeaturing,
                                                                                    reason: nextReason,
                                                                                });
                                                                            }
                                                                            await load({ preserveOrder: true });
                                                                        }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            );
                        })}
                    </table>
                </div>
            </div>

            {/* Floating horizontal scrollbar (only when the table's own scrollbar isn't visible) */}
            <div
                className="fixed bottom-3 z-50 hidden md:block"
                style={{
                    left: stickyGeom ? `${stickyGeom.left}px` : "0px",
                    width: stickyGeom ? `${stickyGeom.width}px` : "0px",
                    opacity: showStickyX ? 1 : 0,
                    pointerEvents: showStickyX ? "auto" : "none",
                }}
            >
                <div className="rounded-xl border border-slate-200 bg-white/85 px-2 py-1 shadow-sm backdrop-blur">
                    <div ref={stickyScrollRef} className="overflow-x-auto overflow-y-hidden" style={{ height: 16 }}>
                        <div style={{ width: stickyGeom?.scrollWidth ?? tableWidthPx, height: 1 }} />
                    </div>
                </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
                <button
                    type="button"
                    disabled={!canPrev || loading}
                    onClick={() => load({ offset: Math.max(0, offset - limit) })}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                >
                    Prev
                </button>
                <button
                    type="button"
                    disabled={!canNext || loading}
                    onClick={() => load({ offset: offset + limit })}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                >
                    Next
                </button>
            </div>
        </div>
    );
}

