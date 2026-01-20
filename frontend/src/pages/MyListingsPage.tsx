import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  MoveDown,
  MoveUp,
  ArrowUpDown,
  Check,
  CircleCheck,
  CircleX,
  Hourglass,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  closeWantedPost,
  deleteWantedPost,
  deleteListing,
  fetchMyListings,
  fetchMyWanted,
  pauseListing,
  pauseWantedPost,
  resolveAssets,
  resumeListing,
  resumeWantedPost,
  markSold,
  type Listing,
  type WantedPost,
} from "../api";
import Header from "../components/Header";
import { useAuth } from "../auth";
import NoPhotoPlaceholder from "../components/NoPhotoPlaceholder";

function centsToDollars(cents: number) {
  const s = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${s}`;
}

function budgetLabel(w: WantedPost) {
  const budget = w.budgetCents ?? null;
  if (budget == null) return "Make an offer";
  return `Up to ${centsToDollars(budget)}`;
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

function statusLabel(l: Listing) {
  if (l.status === "sold") return "Sold";
  if (l.status === "closed") return "Closed";
  return cap1(String(l.status));
}

function parseMs(iso: string | null | undefined) {
  if (!iso) return null;
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : null;
}

type SortKey = "listing" | "price" | "views" | "status" | "published" | "created" | "updated" | "expiresIn";
type SortDir = "asc" | "desc";

function statusRank(l: Listing) {
  // Custom priority (lower = higher). Sold treated as its own state.
  switch (l.status) {
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

function statusRankWanted(w: WantedPost) {
  switch (w.status) {
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
    case "closed":
      return 5;
    case "sold":
      return 6;
    case "deleted":
      return 7;
    default:
      return 8;
  }
}
function StatusText({ l }: { l: Listing }) {
  const s = l.status;

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
      <div>{statusLabel(l)}</div>
    </div>
  );
}

function WantedStatusText({ w }: { w: WantedPost }) {
  const s = w.status;
  const cls =
    s === "active"
      ? "text-emerald-700"
      : s === "pending"
        ? "text-amber-700"
        : s === "paused"
          ? "text-violet-700"
          : s === "draft"
            ? "text-sky-700"
            : s === "expired"
              ? "text-slate-600"
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
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

type RowKind = "sale" | "wanted";
type MixedRow = { kind: RowKind; key: string; idx: number; sale?: Listing; wanted?: WantedPost };

function sortMixedRows(rows: MixedRow[], sortKey: SortKey, sortDir: SortDir, nowMs: number) {
  const dirMul = sortDir === "asc" ? 1 : -1;
  const withIdx = rows.map((r, idx) => ({ r, idx }));

  function cmpStr(a: string, b: string) {
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  }

  function cmpNumNullLast(a: number | null, b: number | null) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return a === b ? 0 : a < b ? -1 : 1;
  }

  function getTitle(r: MixedRow) {
    return r.kind === "sale" ? String(r.sale?.title ?? "") : String(r.wanted?.title ?? "");
  }

  function getPriceSort(r: MixedRow): number | null {
    if (r.kind === "sale") return Number.isFinite(Number(r.sale?.priceCents)) ? Number(r.sale!.priceCents) : null;
    const b = r.wanted?.budgetCents ?? null;
    return Number.isFinite(Number(b)) ? Number(b) : null;
  }

  function getViewsSort(r: MixedRow): number | null {
    if (r.kind === "sale") return Number.isFinite(Number(r.sale?.views)) ? Number(r.sale!.views) : 0;
    return Number.isFinite(Number(r.wanted?.views)) ? Number(r.wanted!.views) : 0;
  }

  function getCreatedMs(r: MixedRow): number | null {
    const iso = r.kind === "sale" ? r.sale?.createdAt : r.wanted?.createdAt;
    return parseMs(iso);
  }

  function getPublishedMs(r: MixedRow): number | null {
    const iso = r.kind === "sale" ? (r.sale?.publishedAt ?? null) : (r.wanted?.publishedAt ?? null);
    return parseMs(iso);
  }

  function getUpdatedMs(r: MixedRow): number | null {
    const iso = r.kind === "sale" ? r.sale?.updatedAt : r.wanted?.updatedAt;
    return parseMs(iso);
  }

  function getExpiresInMs(r: MixedRow): number | null {
    const exp = parseMs(r.kind === "sale" ? r.sale?.expiresAt : r.wanted?.expiresAt);
    if (exp == null) return null;
    return Math.max(0, exp - nowMs);
  }

  function getStatusRankMixed(r: MixedRow) {
    if (r.kind === "sale") return statusRank(r.sale!);
    return r.wanted ? statusRankWanted(r.wanted) : 9;
  }

  function cmpRow(a: MixedRow, b: MixedRow) {
    if (sortKey === "status") {
      const r = (getStatusRankMixed(a) - getStatusRankMixed(b)) * dirMul;
      if (r) return r;
      // Secondary: updated newest first (always).
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
        // Nulls always go last, regardless of direction.
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
    // Secondary: status (asc priority), then updated newest first.
    const sr = getStatusRankMixed(a) - getStatusRankMixed(b);
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

export default function MyListingsPage() {
  const nav = useNavigate();
  const routerLocation = useLocation();
  const [sp, setSp] = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const [includeResolved, setIncludeResolved] = useState(false);

  const viewType =
    sp.get("type") === "wanted"
      ? ("wanted" as const)
      : sp.get("type") === "sale"
        ? ("sale" as const)
        : sp.get("type") === "drafts"
          ? ("drafts" as const)
          : ("all" as const);

  const [items, setItems] = useState<Listing[]>([]);
  const [wantedItems, setWantedItems] = useState<WantedPost[]>([]);
  const [rowOrder, setRowOrder] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "status", dir: "asc" });
  // Treat the page as "loading" until the first listings fetch completes, to avoid empty-state flashing.
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const expandedIdRef = useRef<string | null>(null);

  useEffect(() => {
    expandedIdRef.current = expandedId;
  }, [expandedId]);

  // Collapse only on full click (not pointerdown) and only when clicking outside any row.
  // This ensures selection + expansion happen together on click, not split across mouse-down/up.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const cur = expandedIdRef.current;
      if (!cur) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      // Clicking anywhere inside any row (summary or expanded actions) should not auto-collapse.
      const anyRowKey = t.closest(`[data-row-key]`)?.getAttribute("data-row-key") ?? null;
      if (anyRowKey) return;
      setExpandedId(null);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) nav(`/auth?next=${encodeURIComponent("/me")}&ctx=my_listings`);
  }, [authLoading, user, nav]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setErr(null);
      if (!user) {
        // Keep loading=true until auth/redirect resolves; don't flash empty states.
        setLoading(true);
        return;
      }
      setLoading(true);
      try {
        if (viewType === "wanted") {
          const res = await fetchMyWanted({ limit: 200, offset: 0 });
          if (!cancelled) {
            // Wanted tab excludes drafts (drafts appear only in All + Drafts tabs)
            const nextWanted = (res.items ?? []).filter((w) => w.status !== "draft");
            setWantedItems(nextWanted);
            // Compute initial ordering on load only; do NOT auto-reorder after local row updates.
            const rows = nextWanted.map((w, idx) => ({ kind: "wanted" as const, key: `wanted:${w.id}`, idx: 10_000 + idx, wanted: w }));
            setRowOrder(sortMixedRows(rows, sort.key, sort.dir, nowMs).map((r) => r.key));
          }
        } else if (viewType === "sale") {
          const res = await fetchMyListings({ limit: 200, offset: 0 });
          if (!cancelled) {
            // For sale tab excludes drafts (drafts appear only in All + Drafts tabs)
            const nextItems = (res.items ?? []).filter((l) => l.status !== "draft");
            setItems(nextItems);
            const rows = nextItems.map((l, idx) => ({ kind: "sale" as const, key: `sale:${l.id}`, idx, sale: l }));
            setRowOrder(sortMixedRows(rows, sort.key, sort.dir, nowMs).map((r) => r.key));
          }
        } else if (viewType === "drafts") {
          const [saleRes, wantedRes] = await Promise.all([
            fetchMyListings({ limit: 200, offset: 0 }),
            fetchMyWanted({ limit: 200, offset: 0 }),
          ]);
          if (!cancelled) {
            const nextItems = (saleRes.items ?? []).filter((l) => l.status === "draft");
            const nextWanted = (wantedRes.items ?? []).filter((w) => w.status === "draft");
            setItems(nextItems);
            setWantedItems(nextWanted);
            const rows: MixedRow[] = [
              ...nextItems.map((l, idx) => ({ kind: "sale" as const, key: `sale:${l.id}`, idx, sale: l })),
              ...nextWanted.map((w, idx) => ({ kind: "wanted" as const, key: `wanted:${w.id}`, idx: 10_000 + idx, wanted: w })),
            ];
            setRowOrder(sortMixedRows(rows, sort.key, sort.dir, nowMs).map((r) => r.key));
          }
        } else {
          const [saleRes, wantedRes] = await Promise.all([
            fetchMyListings({ limit: 200, offset: 0 }),
            fetchMyWanted({ limit: 200, offset: 0 }),
          ]);
          if (!cancelled) {
            const nextItems = saleRes.items ?? [];
            const nextWanted = wantedRes.items ?? [];
            setItems(nextItems);
            setWantedItems(nextWanted);
            const rows: MixedRow[] = [
              ...nextItems.map((l, idx) => ({ kind: "sale" as const, key: `sale:${l.id}`, idx, sale: l })),
              ...nextWanted.map((w, idx) => ({ kind: "wanted" as const, key: `wanted:${w.id}`, idx: 10_000 + idx, wanted: w })),
            ];
            setRowOrder(sortMixedRows(rows, sort.key, sort.dir, nowMs).map((r) => r.key));
          }
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load your listings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [user, viewType]); // intentionally does not depend on `sort` (keeps ordering stable until refresh or explicit sort click)

  function rowsForOrdering(nextViewType: "all" | "sale" | "wanted" | "drafts", nextIncludeResolved: boolean): MixedRow[] {
    const hideResolved = <T extends { status: string }>(arr: T[]) => arr.filter((x) => x.status !== "sold" && x.status !== "closed");

    const allowResolved = nextIncludeResolved;
    const saleBase = allowResolved ? items : hideResolved(items);
    const wantedBase = allowResolved ? wantedItems : hideResolved(wantedItems);

    // Keep these consistent with the server/UI expectations:
    // - Sale/Wanted tabs exclude drafts
    // - Drafts tab includes only drafts
    if (nextViewType === "sale") {
      const sale = saleBase.filter((l) => l.status !== "draft");
      return sale.map((l, idx) => ({ kind: "sale" as const, key: `sale:${l.id}`, idx, sale: l }));
    }
    if (nextViewType === "wanted") {
      const wanted = wantedBase.filter((w) => w.status !== "draft");
      return wanted.map((w, idx) => ({ kind: "wanted" as const, key: `wanted:${w.id}`, idx: 10_000 + idx, wanted: w }));
    }
    if (nextViewType === "drafts") {
      const sale = items.filter((l) => l.status === "draft");
      const wanted = wantedItems.filter((w) => w.status === "draft");
      return [
        ...sale.map((l, idx) => ({ kind: "sale" as const, key: `sale:${l.id}`, idx, sale: l })),
        ...wanted.map((w, idx) => ({ kind: "wanted" as const, key: `wanted:${w.id}`, idx: 10_000 + idx, wanted: w })),
      ];
    }

    // all
    return [
      ...saleBase.map((l, idx) => ({ kind: "sale" as const, key: `sale:${l.id}`, idx, sale: l })),
      ...wantedBase.map((w, idx) => ({ kind: "wanted" as const, key: `wanted:${w.id}`, idx: 10_000 + idx, wanted: w })),
    ];
  }

  function setViewType(next: "all" | "sale" | "wanted" | "drafts") {
    // Immediately recompute ordering for the new view so the UI updates without waiting for refetch.
    // This does NOT run when rows change (pause/resume/etc.), preserving the "don't auto-reorder on local updates" behavior.
    setRowOrder(sortMixedRows(rowsForOrdering(next, includeResolved), sort.key, sort.dir, nowMs).map((r) => r.key));

    const nextSp = new URLSearchParams(sp);
    if (next === "wanted") nextSp.set("type", "wanted");
    else if (next === "sale") nextSp.set("type", "sale");
    else if (next === "drafts") nextSp.set("type", "drafts");
    else nextSp.delete("type");
    setSp(nextSp, { replace: true });
  }

  // Keep “Featured for Xd/Xh” pills fresh over time.
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  function renderFeaturedText(l: Listing) {
    return renderFeaturedTextAny(l.featuredUntil ?? null);
  }

  function renderFeaturedTextAny(until: number | null) {
    if (until === null) return null;

    const diffMs = until - nowMs;
    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * hourMs;

    if (diffMs <= 0) {
      return (
        <div className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold leading-none text-red-700">
          <CircleX aria-hidden="true" className="h-4 w-4" />
          <span>Feature expired</span>
        </div>
      );
    }

    if (diffMs < dayMs) {
      const hrs = Math.max(1, Math.ceil(diffMs / hourMs));
      return (
        <div className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold leading-none text-amber-700">
          <Hourglass aria-hidden="true" className="h-4 w-4" />
          <span>Featured ({hrs}h left)</span>
        </div>
      );
    }

    const days = Math.max(1, Math.ceil(diffMs / dayMs));
    return (
      <div className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold leading-none text-emerald-700">
        <CircleCheck aria-hidden="true" className="h-4 w-4" />
        <span>
          Featured ({days}d left)
        </span>
      </div>
    );
  }

  async function onDelete(l: Listing) {
    setErr(null);
    const ok = window.confirm(l.status === "draft" ? "Delete this Draft? This cannot be undone." : "Delete this listing? This cannot be undone.");
    if (!ok) return;

    try {
      await deleteListing(l.id);
      setItems((prev) => prev.filter((x) => x.id !== l.id));
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed");
    }
  }

  async function onPauseResumeWanted(w: WantedPost) {
    setErr(null);
    try {
      const updated = w.status === "paused" ? await resumeWantedPost(w.id) : await pauseWantedPost(w.id);
      setWantedItems((prev) => prev.map((x) => (x.id === w.id ? updated : x)));
      setExpandedId(`wanted:${w.id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update wanted post status");
    }
  }

  async function onCloseWanted(w: WantedPost) {
    setErr(null);
    try {
      const ok = window.confirm("Mark this wanted post as closed? It will be hidden from public browsing.");
      if (!ok) return;
      const updated = await closeWantedPost(w.id);
      setWantedItems((prev) => prev.map((x) => (x.id === w.id ? updated : x)));
      setExpandedId(`wanted:${w.id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to close wanted post");
    }
  }

  async function onDeleteWanted(w: WantedPost) {
    setErr(null);
    const ok = window.confirm(w.status === "draft" ? "Delete this Draft? This cannot be undone." : "Delete this wanted post? This cannot be undone.");
    if (!ok) return;
    try {
      await deleteWantedPost(w.id);
      setWantedItems((prev) => prev.filter((x) => x.id !== w.id));
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed");
    }
  }

  async function doTogglePauseResume(l: Listing) {
    setErr(null);
    try {
      const updated = l.status === "paused" ? await resumeListing(l.id) : await pauseListing(l.id);
      setItems((prev) => prev.map((x) => (x.id === l.id ? updated : x)));
      setExpandedId(`sale:${l.id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update listing status");
    }
  }

  async function doSold(id: string) {
    setErr(null);
    try {
      const ok = window.confirm("Mark this listing as sold? This will deactivate it and hide it from browsing.");
      if (!ok) return;
      const updated = await markSold(id);
      setItems((prev) => prev.map((x) => (x.id === id ? updated : x)));
      setExpandedId(`sale:${id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to mark sold");
    }
  }

  async function doRelist(id: string) {
    setErr(null);
    nav(`/edit/sale/${encodeURIComponent(id)}?relist=1`);
  }

  function expandRow(id: string) {
    setExpandedId(id);
  }

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
    // Explicit sort click: reorder immediately.
    setRowOrder(sortMixedRows(mixedRows, key, dir, nowMs).map((r) => r.key));
  }

  const mixedRows = useMemo(() => {
    const out: MixedRow[] = [];
    const allowResolved = includeResolved;
    const hideResolved = <T extends { status: string }>(arr: T[]) => arr.filter((x) => x.status !== "sold" && x.status !== "closed");

    if (viewType === "sale" || viewType === "all" || viewType === "drafts") {
      const saleItems = allowResolved ? items : hideResolved(items);
      saleItems.forEach((l, idx) => out.push({ kind: "sale", key: `sale:${l.id}`, idx, sale: l }));
    }
    if (viewType === "wanted" || viewType === "all" || viewType === "drafts") {
      const wItems = allowResolved ? wantedItems : hideResolved(wantedItems);
      wItems.forEach((w, idx) => out.push({ kind: "wanted", key: `wanted:${w.id}`, idx: 10_000 + idx, wanted: w }));
    }
    return out;
  }, [items, wantedItems, viewType, includeResolved]);

  const displayRows = useMemo(() => {
    const map = new Map(mixedRows.map((r) => [r.key, r] as const));
    const seen = new Set<string>();
    const ordered = rowOrder.map((k) => {
      const r = map.get(k) ?? null;
      if (r) seen.add(k);
      return r;
    }).filter((x): x is MixedRow => !!x);
    const extras = mixedRows.filter((r) => !seen.has(r.key));
    return [...ordered, ...extras];
  }, [mixedRows, rowOrder]);

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

  return (
    <div className="min-h-full">
      <Header maxWidth="6xl" />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">{viewType === "drafts" ? "My drafts" : "My listings"}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setViewType("all")}
                className={[
                  "px-4 py-2 text-sm font-bold",
                  viewType === "all" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
                aria-pressed={viewType === "all"}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setViewType("sale")}
                className={[
                  "px-4 py-2 text-sm font-bold",
                  viewType === "sale" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
                aria-pressed={viewType === "sale"}
              >
                For sale
              </button>
              <button
                type="button"
                onClick={() => setViewType("wanted")}
                className={[
                  "px-4 py-2 text-sm font-bold",
                  viewType === "wanted" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
                aria-pressed={viewType === "wanted"}
              >
                Wanted
              </button>
              <button
                type="button"
                onClick={() => setViewType("drafts")}
                className={[
                  "px-4 py-2 text-sm font-bold",
                  viewType === "drafts" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
                aria-pressed={viewType === "drafts"}
              >
                Drafts
              </button>
            </div>

            <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 select-none">
              <input
                type="checkbox"
                checked={includeResolved}
                onChange={(e) => {
                  const next = e.target.checked;
                  setIncludeResolved(next);
                  // Recompute ordering immediately for the newly-filtered set.
                  setRowOrder(sortMixedRows(rowsForOrdering(viewType, next), sort.key, sort.dir, nowMs).map((r) => r.key));
                }}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-300"
              />
              Include sold/closed
            </label>
          </div>
        </div>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

        {!loading && viewType === "sale" && items.length === 0 && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">No listings yet</div>
            <div className="mt-1 text-sm text-slate-600">Post one and it will show here.</div>
            <Link to="/post" className="mt-4 inline-block rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              Post a listing
            </Link>
          </div>
        )}

        {!loading && viewType === "all" && items.length === 0 && wantedItems.length === 0 && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">No listings yet</div>
            <div className="mt-1 text-sm text-slate-600">Post a for sale listing or a wanted post and it will show here.</div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/post" className="inline-flex rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                Post a listing
              </Link>
              <Link
                to="/post/wanted"
                className="inline-flex rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              >
                Post a wanted
              </Link>
            </div>
          </div>
        )}

        {!loading && viewType === "wanted" && wantedItems.length === 0 && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">No wanted posts yet</div>
            <div className="mt-1 text-sm text-slate-600">Post one and it will show here.</div>
            <Link
              to="/post/wanted"
              className="mt-4 inline-block rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Post a wanted
            </Link>
          </div>
        )}

        {!loading && viewType === "drafts" && items.length === 0 && wantedItems.length === 0 && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">No drafts yet</div>
            <div className="mt-1 text-sm text-slate-600">Start a listing and save it as a draft to finish later.</div>
            <Link to="/post" className="mt-4 inline-block rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              Post a listing
            </Link>
          </div>
        )}

        {(viewType === "sale" && items.length > 0) ||
          (viewType === "wanted" && wantedItems.length > 0) ||
          (viewType === "drafts" && (items.length > 0 || wantedItems.length > 0)) ||
          (viewType === "all" && (items.length > 0 || wantedItems.length > 0)) ? (
          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="overflow-x-auto ">
              <table className="w-full min-w-[1180px] table-fixed lg:min-w-0">
                <thead className="bg-slate-100/80 border-b border-slate-200 shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.06)]">
                  <tr className="text-xs font-bold tracking-wider text-slate-600">
                    <SortTh label="Listing" k="listing" className="w-[20%] px-2 py-3" align="left" />
                    <SortTh label="Price" k="price" className="w-[6%] px-2 py-3" align="right" />
                    <SortTh label="Views" k="views" className="w-[6%] px-2 py-3" align="right" />
                    <SortTh label="Status" k="status" className="w-[6%] px-2 py-3" title="Default: Status then Updated" align="left" />
                    <SortTh label="Published" k="published" className="w-[7.5%] px-2 py-3" align="left" />
                    <SortTh label="Created" k="created" className="w-[6.5%] px-2 py-3" align="left" />
                    <SortTh label="Updated" k="updated" className="w-[7%] px-2 py-3" align="left" />
                    <SortTh label="Expiry" k="expiresIn" className="w-[6%] px-2 py-3" align="right" />
                    <th className="w-[6%] px-2 py-3 text-center">Actions</th>
                  </tr>
                </thead>

                {displayRows.map((row, idx) => {
                  const rowBorder = idx === 0 ? "" : "border-t border-slate-200";
                  const isExpanded = expandedId === row.key;

                  if (row.kind === "sale") {
                    const l = row.sale!;
                    const assets = resolveAssets(l.images ?? []);
                    const hero = assets[0]?.thumbUrl ?? assets[0]?.medUrl ?? assets[0]?.fullUrl ?? null;
                    const openHref = l.status === "draft" ? `/post/sale?draft=${encodeURIComponent(l.id)}` : `/listing/sale/${l.id}`;
                    const isDraft = l.status === "draft";

                    const canToggle = l.status === "active" || l.status === "paused";
                    const canResolve = l.status === "active" || l.status === "paused";

                    const toggleTitle = l.status === "paused" ? "Resume" : "Pause";
                    const canFeature = l.status === "active";
                    const isSold = l.status === "sold";

                    return (
                      <tbody key={row.key} className="group">
                        <tr
                          className={["cursor-pointer transition-colors group-hover:bg-slate-50/70", rowBorder].join(" ")}
                          data-row-key={row.key}
                          onClick={() => expandRow(row.key)}
                        >
                          <td className="px-4 py-4 align-top text-left">
                            <div className="flex min-h-20 items-center gap-3">
                              <Link
                                to={openHref}
                                state={{ from: { pathname: routerLocation.pathname, search: routerLocation.search, label: "my listings" } }}
                                onClick={(e) => e.stopPropagation()}
                                className="h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
                              >
                                {hero ? (
                                  <img src={hero} alt={l.title} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                                ) : (
                                  <NoPhotoPlaceholder variant="tile" className="px-1 text-center" />
                                )}
                              </Link>

                              <div className="flex h-20 min-w-0 flex-1 flex-col justify-center">
                                <Link
                                  to={openHref}
                                  state={{ from: { pathname: routerLocation.pathname, search: routerLocation.search, label: "my listings" } }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="block truncate text-sm font-extrabold text-slate-900 hover:underline"
                                >
                                  {l.title}
                                </Link>
                                <div className="mt-1 flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-600">
                                  <span className="inline-flex shrink-0 rounded-full border border-slate-200 bg-transparent px-2 py-0.5 text-xs font-semibold text-slate-600">
                                    For sale
                                  </span>
                                </div>
                                <div className="mt-1">{renderFeaturedText(l)}</div>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-4 align-top text-right">
                            <div className="text-sm font-extrabold text-slate-900">{centsToDollars(l.priceCents)}</div>
                          </td>

                          <td className="px-4 py-4 align-top text-right">
                            <div className="text-sm font-semibold text-slate-700">{Number(l.views ?? 0).toLocaleString()}</div>
                          </td>

                          <td className="px-4 py-4 align-top text-left">
                            <StatusText l={l} />
                          </td>

                          <td className="px-4 py-4 align-top text-left">
                            {l.publishedAt ? (
                              <div className="text-sm font-semibold leading-tight text-slate-700">
                                <div>{new Date(l.publishedAt).toLocaleDateString()}</div>
                                <div className="text-xs font-semibold text-slate-600">
                                  {new Date(l.publishedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                </div>
                              </div>
                            ) : (
                              <div className="text-sm font-semibold text-slate-700">—</div>
                            )}
                          </td>

                          <td className="px-4 py-4 align-top text-left">
                            <div className="text-sm font-semibold leading-tight text-slate-700">
                              <div>{new Date(l.createdAt).toLocaleDateString()}</div>
                              <div className="text-xs font-semibold text-slate-600">
                                {new Date(l.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-4 align-top text-left">
                            <div className="text-sm font-semibold text-slate-700" title={new Date(l.updatedAt).toLocaleString()}>
                              {relativeTime(l.updatedAt)}
                            </div>
                          </td>

                          <td className="px-4 py-4 align-top text-right">
                            <div className="text-sm font-semibold text-slate-700" title={l.expiresAt ? new Date(l.expiresAt).toLocaleString() : ""}>
                              {expiresInShort(l.expiresAt)}
                            </div>
                          </td>

                          <td className="px-4 py-4 align-top text-center">
                            <div
                              className="flex justify-center"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isExpanded) setExpandedId(null);
                                else expandRow(row.key);
                              }}
                            >
                              <ActionButton label={isExpanded ? "Hide" : "Actions"} title={isExpanded ? "Hide actions" : "Show actions"} />
                            </div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="transition-colors group-hover:bg-slate-50/70" data-row-key={row.key}>
                            <td colSpan={9} className="px-4 pb-4 pt-0" data-row-key={row.key} onClick={(e) => e.stopPropagation()}>
                              <div
                                className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2"
                                data-row-key={row.key}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {isDraft ? (
                                  <ActionLink to={openHref} label="Resume draft" icon={<Pencil aria-hidden="true" className="h-4 w-4" />} />
                                ) : !isSold ? (
                                  <>
                                    <ActionButton
                                      label={l.featured ? "Manage featuring" : "Feature this listing"}
                                      title={
                                        !canFeature
                                          ? "Only active, unsold listings can be featured."
                                          : l.featured
                                            ? "Manage featuring"
                                            : "Feature this listing"
                                      }
                                      variant="feature"
                                      disabled={!canFeature}
                                      onClick={() => nav(`/feature/${encodeURIComponent(l.id)}`)}
                                      icon={l.featured ? <CircleCheck aria-hidden="true" className="h-4 w-4" /> : undefined}
                                    />

                                    <ActionLink to={`/edit/sale/${l.id}`} label="Edit" icon={<Pencil aria-hidden="true" className="h-4 w-4" />} />

                                    <ActionButton
                                      label={toggleTitle}
                                      title={toggleTitle}
                                      disabled={!canToggle}
                                      onClick={() => doTogglePauseResume(l)}
                                      icon={l.status === "paused" ? <Play aria-hidden="true" className="h-4 w-4" /> : <Pause aria-hidden="true" className="h-4 w-4" />}
                                    />

                                    <ActionButton
                                      label="Mark sold"
                                      title="Mark as sold"
                                      variant="primary"
                                      disabled={!canResolve}
                                      onClick={() => doSold(l.id)}
                                      icon={<Check aria-hidden="true" className="h-4 w-4" />}
                                    />
                                  </>
                                ) : (
                                  <ActionButton
                                    label="Relist"
                                    title="Relist"
                                    variant="primary"
                                    onClick={() => doRelist(l.id)}
                                    icon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}
                                  />
                                )}

                                <ActionButton
                                  label="Delete"
                                  title="Delete"
                                  variant="danger"
                                  onClick={() => onDelete(l)}
                                  icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    );
                  }

                  const w = row.wanted!;
                  const assets = resolveAssets(w.images ?? []);
                  const hero = assets[0]?.thumbUrl ?? assets[0]?.medUrl ?? assets[0]?.fullUrl ?? null;
                  const openHref = w.status === "draft" ? `/post/wanted?draft=${encodeURIComponent(w.id)}` : `/listing/wanted/${w.id}`;
                  const isDraft = w.status === "draft";

                  return (
                    <tbody key={row.key} className="group">
                      <tr
                        className={["cursor-pointer transition-colors group-hover:bg-slate-50/70", rowBorder].join(" ")}
                        data-row-key={row.key}
                        onClick={() => expandRow(row.key)}
                      >
                        <td className="px-4 py-4 align-top text-left">
                          <div className="flex min-h-20 items-center gap-3">
                            <Link
                              to={openHref}
                              state={{ from: { pathname: routerLocation.pathname, search: routerLocation.search, label: "my listings" } }}
                              onClick={(e) => e.stopPropagation()}
                              className="h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
                            >
                              {hero ? (
                                <img src={hero} alt={w.title} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                              ) : (
                                <NoPhotoPlaceholder variant="tile" className="px-1 text-center" />
                              )}
                            </Link>

                            <div className="flex h-20 min-w-0 flex-1 flex-col justify-center">
                              <Link
                                to={openHref}
                                state={{ from: { pathname: routerLocation.pathname, search: routerLocation.search, label: "my listings" } }}
                                onClick={(e) => e.stopPropagation()}
                                className="block truncate text-sm font-extrabold text-slate-900 hover:underline"
                              >
                                {w.title}
                              </Link>
                              <div className="mt-1 flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-600">
                                <span className="inline-flex shrink-0 rounded-full border border-slate-200 bg-transparent px-2 py-0.5 text-xs font-semibold text-slate-600">
                                  Wanted
                                </span>
                              </div>
                              <div className="mt-1">{renderFeaturedTextAny(w.featuredUntil ?? null)}</div>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-4 align-top text-right">
                          <div className="text-sm font-extrabold text-slate-900">{budgetLabel(w)}</div>
                        </td>

                        <td className="px-4 py-4 align-top text-right">
                          <div className="text-sm font-semibold text-slate-700">{Number(w.views ?? 0).toLocaleString()}</div>
                        </td>

                        <td className="px-4 py-4 align-top text-left">
                          <WantedStatusText w={w} />
                        </td>

                        <td className="px-4 py-4 align-top text-left">
                          {w.publishedAt ? (
                            <div className="text-sm font-semibold leading-tight text-slate-700">
                              <div>{new Date(w.publishedAt).toLocaleDateString()}</div>
                              <div className="text-xs font-semibold text-slate-600">
                                {new Date(w.publishedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                              </div>
                            </div>
                          ) : (
                            <div className="text-sm font-semibold text-slate-700">—</div>
                          )}
                        </td>

                        <td className="px-4 py-4 align-top text-left">
                          <div className="text-sm font-semibold leading-tight text-slate-700">
                            <div>{new Date(w.createdAt).toLocaleDateString()}</div>
                            <div className="text-xs font-semibold text-slate-600">
                              {new Date(w.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-4 align-top text-left">
                          <div className="text-sm font-semibold text-slate-700" title={new Date(w.updatedAt).toLocaleString()}>
                            {relativeTime(w.updatedAt)}
                          </div>
                        </td>

                        <td className="px-4 py-4 align-top text-right">
                          <div className="text-sm font-semibold text-slate-700" title={w.expiresAt ? new Date(w.expiresAt).toLocaleString() : ""}>
                            {expiresInShort(w.expiresAt)}
                          </div>
                        </td>

                        <td className="px-4 py-4 align-top text-center">
                          <div
                            className="flex justify-center"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isExpanded) setExpandedId(null);
                              else expandRow(row.key);
                            }}
                          >
                            <ActionButton label={isExpanded ? "Hide" : "Actions"} title={isExpanded ? "Hide actions" : "Show actions"} />
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="transition-colors group-hover:bg-slate-50/70" data-row-key={row.key}>
                          <td colSpan={9} className="px-4 pb-4 pt-0" data-row-key={row.key} onClick={(e) => e.stopPropagation()}>
                            <div
                              className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2"
                              data-row-key={row.key}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {isDraft ? (
                                <ActionLink to={openHref} label="Resume draft" icon={<Pencil aria-hidden="true" className="h-4 w-4" />} />
                              ) : (
                                <>
                                  {(() => {
                                    const canFeature = w.status === "active";
                                    return (
                                      <ActionButton
                                        label={w.featured ? "Manage featuring" : "Feature this listing"}
                                        title={!canFeature ? "Only active wanted posts can be featured." : w.featured ? "Manage featuring" : "Feature this listing"}
                                        variant="feature"
                                        disabled={!canFeature}
                                        onClick={() => nav(`/feature/${encodeURIComponent(w.id)}`)}
                                        icon={w.featured ? <CircleCheck aria-hidden="true" className="h-4 w-4" /> : undefined}
                                      />
                                    );
                                  })()}
                                  <ActionLink to={`/edit/wanted/${w.id}`} label="Edit" icon={<Pencil aria-hidden="true" className="h-4 w-4" />} />
                                  <ActionButton
                                    label={w.status === "paused" ? "Resume" : "Pause"}
                                    title={w.status === "paused" ? "Resume" : "Pause"}
                                    disabled={w.status !== "active" && w.status !== "paused"}
                                    onClick={() => onPauseResumeWanted(w)}
                                    icon={w.status === "paused" ? <Play aria-hidden="true" className="h-4 w-4" /> : <Pause aria-hidden="true" className="h-4 w-4" />}
                                  />
                                  <ActionButton
                                    label="Mark as Closed"
                                    title="Mark as Closed"
                                    variant="primary"
                                    disabled={w.status !== "active" && w.status !== "paused"}
                                    onClick={() => onCloseWanted(w)}
                                    icon={<Check aria-hidden="true" className="h-4 w-4" />}
                                  />
                                </>
                              )}
                              <ActionButton
                                label="Delete"
                                title="Delete wanted post"
                                variant="danger"
                                onClick={() => onDeleteWanted(w)}
                                icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                              />
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
        ) : null}
      </main>
    </div>
  );
}
