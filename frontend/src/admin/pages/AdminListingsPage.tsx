import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowUpDown, CircleCheck, MoveDown, MoveUp, Pause, Play, Star, Trash2, User as UserIcon } from "lucide-react";
import { adminFetchListings, adminSetListingFeaturedUntil, adminSetListingStatus, resolveImageUrl, type AdminListingListItem, type ListingStatus } from "../../api";
import { useAuth } from "../../auth";
import NoPhotoPlaceholder from "../../components/NoPhotoPlaceholder";

type KindFilter = "all" | "sale" | "wanted";
type StatusFilter = "all" | ListingStatus;
type SortKey = "listing" | "price" | "views" | "status" | "published" | "created" | "updated" | "expiresIn";
type SortDir = "asc" | "desc";
type ColKey =
    | "fullName"
    | "username"
    | "email"
    | "phone"
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
                <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-800 hover:bg-slate-50"
                    onClick={() => setVisibleCols((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, true])) } as any))}
                >
                    Show
                </button>
                <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-800 hover:bg-slate-50"
                    onClick={() => setVisibleCols((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, false])) } as any))}
                >
                    Hide
                </button>
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

function statusRankAny(status: string) {
    switch (status) {
        case "active":
            return 0;
        case "pending":
            return 1;
        case "paused":
            return 2;
        case "draft":
            return 3;
        case "expired":
            return 4;
        case "sold":
            return 5;
        case "closed":
            return 6;
        case "deleted":
            return 7;
        default:
            return 8;
    }
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

function parseMs(iso: string | null | undefined) {
    if (!iso) return null;
    const n = new Date(iso).getTime();
    return Number.isFinite(n) ? n : null;
}

function sortAdminRows(rows: AdminListingListItem[], sortKey: SortKey, sortDir: SortDir) {
    const dirMul = sortDir === "asc" ? 1 : -1;
    const withIdx = rows.map((r, idx) => ({ r, idx }));
    const cmpStr = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
    const cmpNumNullLast = (a: number | null, b: number | null) => {
        if (a == null && b == null) return 0;
        if (a == null) return 1;
        if (b == null) return -1;
        return a === b ? 0 : a < b ? -1 : 1;
    };

    const getTitle = (r: AdminListingListItem) => String(r.title ?? "");
    const getPriceSort = (r: AdminListingListItem): number | null => (r.kind === "sale" ? Number(r.priceCents ?? 0) : r.budgetCents ?? null);
    const getViewsSort = (r: AdminListingListItem): number | null => Number.isFinite(Number(r.views)) ? Number(r.views) : 0;
    const getCreatedMs = (r: AdminListingListItem) => parseMs(r.createdAt);
    const getPublishedMs = (r: AdminListingListItem) => parseMs(r.publishedAt);
    const getUpdatedMs = (r: AdminListingListItem) => parseMs(r.updatedAt);
    const getExpiresInMs = (r: AdminListingListItem) => {
        const exp = parseMs(r.expiresAt);
        if (exp == null) return null;
        return Math.max(0, exp - Date.now());
    };

    function cmpRow(a: AdminListingListItem, b: AdminListingListItem) {
        if (sortKey === "status") {
            const r = (statusRankAny(String(a.status)) - statusRankAny(String(b.status))) * dirMul;
            if (r) return r;
            const au = getUpdatedMs(a) ?? 0;
            const bu = getUpdatedMs(b) ?? 0;
            return bu - au;
        }

        let r = 0;
        switch (sortKey) {
            case "listing":
                r = cmpStr(getTitle(a), getTitle(b)) * dirMul;
                break;
            case "price": {
                const ar = getPriceSort(a);
                const br = getPriceSort(b);
                const base = cmpNumNullLast(ar, br);
                r = base * (ar == null || br == null ? 1 : dirMul);
                break;
            }
            case "views": {
                const ar = getViewsSort(a);
                const br = getViewsSort(b);
                const base = cmpNumNullLast(ar, br);
                r = base * (ar == null || br == null ? 1 : dirMul);
                break;
            }
            case "created": {
                const ar = getCreatedMs(a);
                const br = getCreatedMs(b);
                const base = cmpNumNullLast(ar, br);
                r = base * (ar == null || br == null ? 1 : dirMul);
                break;
            }
            case "published": {
                const ar = getPublishedMs(a);
                const br = getPublishedMs(b);
                const base = cmpNumNullLast(ar, br);
                r = base * (ar == null || br == null ? 1 : dirMul);
                break;
            }
            case "updated": {
                const ar = getUpdatedMs(a);
                const br = getUpdatedMs(b);
                const base = cmpNumNullLast(ar, br);
                r = base * (ar == null || br == null ? 1 : dirMul);
                break;
            }
            case "expiresIn": {
                const ar = getExpiresInMs(a);
                const br = getExpiresInMs(b);
                const base = cmpNumNullLast(ar, br);
                r = base * (ar == null || br == null ? 1 : dirMul);
                break;
            }
        }

        if (r) return r;
        const sr = statusRankAny(String(a.status)) - statusRankAny(String(b.status));
        if (sr) return sr;
        const au = getUpdatedMs(a) ?? 0;
        const bu = getUpdatedMs(b) ?? 0;
        if (bu !== au) return bu - au;
        return 0;
    }

    withIdx.sort((aa, bb) => {
        const r = cmpRow(aa.r, bb.r);
        if (r) return r;
        return aa.idx - bb.idx;
    });

    return withIdx.map((x) => x.r);
}

export default function AdminListingsPage() {
    const { user } = useAuth();
    const routerLocation = useLocation();
    const [q, setQ] = useState("");
    const [userQ, setUserQ] = useState("");
    const [kind, setKind] = useState<KindFilter>("all");
    const [status, setStatus] = useState<StatusFilter>("all");
    const [featuredOnly, setFeaturedOnly] = useState(false);
    const [includeDeleted, setIncludeDeleted] = useState(false);

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

    const [colsOpen, setColsOpen] = useState(false);
    const colsOpenRef = useRef(false);

    const tableScrollRef = useRef<HTMLDivElement | null>(null);
    const stickyScrollRef = useRef<HTMLDivElement | null>(null);
    const [showStickyX, setShowStickyX] = useState(false);
    const [stickyGeom, setStickyGeom] = useState<{ left: number; width: number; scrollWidth: number } | null>(null);

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

    async function load(next?: { offset?: number; preserveOrder?: boolean }) {
        setLoading(true);
        setErr(null);
        try {
            const res = await adminFetchListings({
                q: q.trim() ? q.trim() : undefined,
                user: userQ.trim() ? userQ.trim() : undefined,
                kind,
                status,
                featured: featuredOnly ? true : undefined,
                includeDeleted: includeDeleted ? true : undefined,
                limit,
                offset: next?.offset ?? offset,
            });
            setItems(res.items);
            // Like My Listings: do NOT auto-reorder after local actions (pause/delete/feature),
            // because it makes the row jump out of view. Only re-order on initial load / filter changes / explicit sort clicks.
            if (!next?.preserveOrder) {
                setRowOrder(sortAdminRows(res.items, sort.key, sort.dir).map((r) => `${r.kind}:${r.id}`));
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
    }, [kind, status, featuredOnly, includeDeleted, limit]);

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
            price: 110,
            views: 90,
            status: 110,
            published: 140,
            created: 140,
            updated: 140,
            expiresIn: 90,
            actions: 110,
        } as const;

        const sum =
            W.listing +
            (visibleCols.fullName ? W.fullName : 0) +
            (visibleCols.username ? W.username : 0) +
            (visibleCols.email ? W.email : 0) +
            (visibleCols.phone ? W.phone : 0) +
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

        recompute();
        window.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", schedule, { passive: true });
        mainEl.addEventListener("scroll", schedule, { passive: true });

        return () => {
            window.removeEventListener("scroll", schedule as any);
            window.removeEventListener("resize", schedule as any);
            mainEl.removeEventListener("scroll", schedule as any);
            if (raf) window.cancelAnimationFrame(raf);
        };
    }, [tableWidthPx, visibleCols]);

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
        setSort({ key, dir });
        setRowOrder(sortAdminRows(items, key, dir).map((r) => `${r.kind}:${r.id}`));
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
                    <div className="mt-1 text-sm text-slate-600">God’s-eye view across the entire site.</div>
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

                <div className="ml-auto text-xs font-semibold text-slate-600">{pageText}</div>
            </div>

            {err ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div> : null}

            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="overflow-x-auto" ref={tableScrollRef}>
                    <table className="table-fixed" style={{ width: tableWidthPx }}>
                        <thead className="bg-slate-100/80 border-b border-slate-200 shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.06)]">
                            <tr className="text-xs font-bold tracking-wider text-slate-600">
                                <SortTh label="Listing" k="listing" className="w-[360px] px-2 py-3" align="left" />
                                {visibleCols.fullName ? <th className="w-[160px] px-2 py-3 text-left whitespace-nowrap">Full name</th> : null}
                                {visibleCols.username ? <th className="w-[140px] px-2 py-3 text-left whitespace-nowrap">Username</th> : null}
                                {visibleCols.email ? <th className="w-[200px] px-2 py-3 text-left whitespace-nowrap">Email</th> : null}
                                {visibleCols.phone ? <th className="w-[130px] px-2 py-3 text-left whitespace-nowrap">Phone</th> : null}
                                {visibleCols.price ? <SortTh label="Price" k="price" className="w-[110px] px-2 py-3" align="right" /> : null}
                                {visibleCols.views ? <SortTh label="Views" k="views" className="w-[90px] px-2 py-3" align="right" /> : null}
                                {visibleCols.status ? <SortTh label="Status" k="status" className="w-[110px] px-2 py-3" title="Default: Status then Updated" align="left" /> : null}
                                {visibleCols.published ? <SortTh label="Published" k="published" className="w-[140px] px-2 py-3" align="left" /> : null}
                                {visibleCols.created ? <SortTh label="Created" k="created" className="w-[140px] px-2 py-3" align="left" /> : null}
                                {visibleCols.updated ? <SortTh label="Updated" k="updated" className="w-[140px] px-2 py-3" align="left" /> : null}
                                {visibleCols.expiresIn ? <SortTh label="Expiry" k="expiresIn" className="w-[90px] px-2 py-3" align="right" /> : null}
                                <th className="w-[110px] px-2 py-3 text-center whitespace-nowrap">Actions</th>
                            </tr>
                        </thead>

                        {displayRows.map((it, idx) => {
                            const rowKey = `${it.kind}:${it.id}`;
                            const rowBorder = idx === 0 ? "" : "border-t border-slate-200";
                            const isExpanded = expandedId === rowKey;
                            const hero = resolveImageUrl(it.heroUrl ?? null);
                            const openHref = `/listing/${it.kind}/${it.id}?viewContext=admin`;
                            const isFeatured = it.featuredUntil != null && it.featuredUntil > Date.now();
                            const priceText = it.kind === "sale" ? centsToDollars(it.priceCents) : budgetLabel(it.budgetCents ?? null);

                            const canToggle = it.status === "active" || it.status === "paused";
                            const toggleTitle = it.status === "paused" ? "Resume" : "Pause";

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
                                                    <div className="mt-1">{renderFeaturedTextAny(it.featuredUntil ?? null)}</div>
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
                                                <StatusTextAny status={it.status} />
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
                                            <td className="px-2 py-3 align-top text-right">
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
                                            <td colSpan={colCount} className="px-2 pb-3 pt-0" data-row-key={rowKey} onClick={(e) => e.stopPropagation()}>
                                                <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2" data-row-key={rowKey} onClick={(e) => e.stopPropagation()}>
                                                    <ActionLink to={openHref} label="Open listing" icon={<Star aria-hidden="true" className="h-4 w-4" />} />
                                                    {it.user?.id != null ? (
                                                        <ActionLink to={`/admin/users/${it.user.id}`} label="Open user" icon={<UserIcon aria-hidden="true" className="h-4 w-4" />} />
                                                    ) : null}

                                                    <ActionButton
                                                        label={toggleTitle}
                                                        title={toggleTitle}
                                                        disabled={!canToggle}
                                                        onClick={async () => {
                                                            await adminSetListingStatus(it.id, it.status === "paused" ? "active" : "paused");
                                                            await load({ preserveOrder: true });
                                                        }}
                                                        icon={it.status === "paused" ? <Play aria-hidden="true" className="h-4 w-4" /> : <Pause aria-hidden="true" className="h-4 w-4" />}
                                                    />

                                                    {it.status !== "deleted" ? (
                                                        <ActionButton
                                                            label="Delete"
                                                            title="Delete"
                                                            variant="danger"
                                                            onClick={async () => {
                                                                const ok = window.confirm("Delete this listing? It will be hidden from the site.");
                                                                if (!ok) return;
                                                                await adminSetListingStatus(it.id, "deleted");
                                                                await load({ preserveOrder: true });
                                                            }}
                                                            icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                                                        />
                                                    ) : (
                                                        <ActionButton
                                                            label="Restore"
                                                            title="Restore"
                                                            variant="primary"
                                                            onClick={async () => {
                                                                const ok = window.confirm("Restore this listing to active?");
                                                                if (!ok) return;
                                                                await adminSetListingStatus(it.id, "active");
                                                                await load({ preserveOrder: true });
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
                                                                    await adminSetListingFeaturedUntil(it.id, null);
                                                                    await load({ preserveOrder: true });
                                                                }}
                                                                icon={<CircleCheck aria-hidden="true" className="h-4 w-4" />}
                                                            />
                                                        ) : (
                                                            <ActionButton
                                                                label="Feature"
                                                                title="Feature"
                                                                variant="feature"
                                                                onClick={async () => {
                                                                    const daysRaw = window.prompt("Feature for how many days?", "7") ?? "";
                                                                    const days = Math.max(1, Math.min(3650, Math.floor(Number(daysRaw))));
                                                                    if (!Number.isFinite(days)) return;
                                                                    await adminSetListingFeaturedUntil(it.id, Date.now() + days * 24 * 60 * 60 * 1000);
                                                                    await load({ preserveOrder: true });
                                                                }}
                                                                icon={<Star aria-hidden="true" className="h-4 w-4" />}
                                                            />
                                                        )
                                                    ) : null}
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
                className="fixed bottom-3 z-50"
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

