import { useEffect, useMemo, useState } from "react";
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
  reopenWantedPost,
  resolveAssets,
  pauseListing,
  resumeListing,
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
  const min = w.budgetMinCents ?? null;
  const max = w.budgetMaxCents ?? null;
  if (min == null && max == null) return "Any budget";
  if (min != null && max != null) return `${centsToDollars(min)}–${centsToDollars(max)}`;
  if (min != null) return `${centsToDollars(min)}+`;
  return `Up to ${centsToDollars(max!)}`;
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
  // If sold, show Sold (not Active).
  if (l.resolution === "sold") return "Sold";
  return cap1(l.status);
}

function parseMs(iso: string | null | undefined) {
  if (!iso) return null;
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : null;
}

type SortKey = "listing" | "price" | "views" | "status" | "created" | "updated" | "expiresIn";
type SortDir = "asc" | "desc";

function statusRank(l: Listing) {
  // Custom priority (lower = higher). Sold treated as its own state.
  if (l.resolution === "sold") return 5;
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
    case "deleted":
      return 6;
    default:
      return 7;
  }
}

function StatusText({ l }: { l: Listing }) {
  const s = l.status;
  const r = l.resolution;

  const cls =
    r !== "none"
      ? "text-slate-800"
      : s === "active"
        ? "text-emerald-700"
        : s === "pending"
          ? "text-amber-700"
          : s === "paused"
            ? "text-violet-700"
            : s === "expired"
              ? "text-slate-600"
              : s === "draft"
                ? "text-sky-700"
                : s === "deleted"
                  ? "text-red-700"
                  : "text-slate-700";
  const showActiveTime = s === "active" && r === "none";
  const expiresShort = showActiveTime ? expiresInShort(l.expiresAt) : null;
  const showExpires = expiresShort && expiresShort !== "—" && expiresShort !== "Expired";

  return (
    <div className={`text-sm font-semibold ${cls}`}>
      <div>{statusLabel(l)}</div>
      {showExpires ? <div className="text-[11px] font-semibold leading-none">({expiresShort} left)</div> : null}
    </div>
  );
}

function WantedStatusText({ w }: { w: WantedPost }) {
  const s = w.status;
  const cls =
    s === "open" ? "text-emerald-700" : s === "closed" ? "text-slate-700" : "text-slate-700";
  return (
    <div className={`text-sm font-semibold ${cls}`}>
      <div>{s === "open" ? "Open" : "Closed"}</div>
    </div>
  );
}

function sortListings(items: Listing[], sortKey: SortKey, sortDir: SortDir, nowMs: number) {
  const dirMul = sortDir === "asc" ? 1 : -1;
  const withIdx = items.map((l, idx) => ({ l, idx }));

  function cmpNum(a: number | null, b: number | null) {
    const av = a ?? Number.POSITIVE_INFINITY;
    const bv = b ?? Number.POSITIVE_INFINITY;
    return av === bv ? 0 : av < bv ? -1 : 1;
  }

  function cmpStr(a: string, b: string) {
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  }

  function cmpListing(a: Listing, b: Listing) {
    if (sortKey === "status") {
      const r = (statusRank(a) - statusRank(b)) * dirMul;
      if (r) return r;
      // Secondary: updated newest first (always).
      const au = parseMs(a.updatedAt) ?? 0;
      const bu = parseMs(b.updatedAt) ?? 0;
      return bu - au;
    }

    let r = 0;
    switch (sortKey) {
      case "listing":
        r = cmpStr(a.title, b.title) * dirMul;
        break;
      case "price":
        r = (a.priceCents - b.priceCents) * dirMul;
        break;
      case "views":
        r = (Number(a.views ?? 0) - Number(b.views ?? 0)) * dirMul;
        break;
      case "created": {
        const ac = parseMs(a.createdAt);
        const bc = parseMs(b.createdAt);
        r = cmpNum(ac, bc) * dirMul;
        break;
      }
      case "updated": {
        const au = parseMs(a.updatedAt);
        const bu = parseMs(b.updatedAt);
        r = cmpNum(au, bu) * dirMul;
        break;
      }
      case "expiresIn": {
        const ae = parseMs(a.expiresAt);
        const be = parseMs(b.expiresAt);
        const an = ae === null ? null : Math.max(0, ae - nowMs);
        const bn = be === null ? null : Math.max(0, be - nowMs);
        r = cmpNum(an, bn) * dirMul;
        break;
      }
    }

    if (r) return r;
    // Secondary: status (asc priority), then updated newest first.
    const sr = statusRank(a) - statusRank(b);
    if (sr) return sr;
    const au = parseMs(a.updatedAt) ?? 0;
    const bu = parseMs(b.updatedAt) ?? 0;
    if (bu !== au) return bu - au;
    return 0;
  }

  withIdx.sort((aa, bb) => {
    const r = cmpListing(aa.l, bb.l);
    if (r) return r;
    return aa.idx - bb.idx;
  });

  return withIdx.map((x) => x.l);
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

export default function MyListingsPage() {
  const nav = useNavigate();
  const routerLocation = useLocation();
  const [sp, setSp] = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const viewType = sp.get("type") === "wanted" ? ("wanted" as const) : sp.get("type") === "sale" ? ("sale" as const) : ("all" as const);

  const [items, setItems] = useState<Listing[]>([]);
  const [wantedItems, setWantedItems] = useState<WantedPost[]>([]);
  const [displayOrder, setDisplayOrder] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "status", dir: "asc" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (authLoading) return;
    if (!user) nav(`/auth?next=${encodeURIComponent("/me")}&ctx=my_listings`);
  }, [authLoading, user, nav]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setErr(null);
      setLoading(true);
      try {
        if (!user) return;
        if (viewType === "wanted") {
          const res = await fetchMyWanted({ limit: 200, offset: 0 });
          if (!cancelled) setWantedItems(res.items ?? []);
        } else if (viewType === "sale") {
          const res = await fetchMyListings({ limit: 200, offset: 0 });
          if (!cancelled) {
            const nextItems = res.items ?? [];
            setItems(nextItems);
            // Apply default sort on load (and on hard refresh).
            const ordered = sortListings(nextItems, sort.key, sort.dir, nowMs).map((l) => l.id);
            setDisplayOrder(ordered);
          }
        } else {
          const [saleRes, wantedRes] = await Promise.all([
            fetchMyListings({ limit: 200, offset: 0 }),
            fetchMyWanted({ limit: 200, offset: 0 }),
          ]);
          if (!cancelled) {
            const nextItems = saleRes.items ?? [];
            setItems(nextItems);
            const ordered = sortListings(nextItems, sort.key, sort.dir, nowMs).map((l) => l.id);
            setDisplayOrder(ordered);
            setWantedItems(wantedRes.items ?? []);
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
  }, [user, viewType, nowMs, sort.key, sort.dir]);

  function setViewType(next: "all" | "sale" | "wanted") {
    const nextSp = new URLSearchParams(sp);
    if (next === "wanted") nextSp.set("type", "wanted");
    else if (next === "sale") nextSp.set("type", "sale");
    else nextSp.delete("type");
    setSp(nextSp, { replace: true });
  }

  // Keep “Featured for Xd/Xh” pills fresh over time.
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  function renderFeaturedText(l: Listing) {
    // We show this line if there is an active/expired featuring timer, or if the legacy `featured` flag is set.
    const until = l.featuredUntil ?? null;
    const shouldShow = Boolean(l.featured) || until !== null;
    if (!shouldShow) return null;

    // Legacy fallback (no timer set)
    if (until === null) {
      return (
        <div className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold leading-none text-emerald-700">
          <CircleCheck aria-hidden="true" className="h-4 w-4" />
          <span>Featured</span>
        </div>
      );
    }

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

  async function onDelete(id: string) {
    setErr(null);
    const ok = window.confirm("Delete this listing? This cannot be undone.");
    if (!ok) return;

    try {
      await deleteListing(id);
      setItems((prev) => prev.filter((l) => l.id !== id));
      setDisplayOrder((prev) => prev.filter((x) => x !== id));
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed");
    }
  }

  async function onToggleWantedStatus(w: WantedPost) {
    setErr(null);
    try {
      const updated = w.status === "open" ? await closeWantedPost(w.id) : await reopenWantedPost(w.id);
      setWantedItems((prev) => prev.map((x) => (x.id === w.id ? updated : x)));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update wanted status");
    }
  }

  async function onDeleteWanted(id: string) {
    setErr(null);
    const ok = window.confirm("Delete this wanted post? This cannot be undone.");
    if (!ok) return;
    try {
      await deleteWantedPost(id);
      setWantedItems((prev) => prev.filter((w) => w.id !== id));
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed");
    }
  }

  async function doTogglePauseResume(l: Listing) {
    setErr(null);
    try {
      const updated = l.status === "paused" ? await resumeListing(l.id) : await pauseListing(l.id);
      setItems((prev) => prev.map((x) => (x.id === l.id ? updated : x)));
      setExpandedId(l.id);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update listing status");
    }
  }

  async function doSold(id: string) {
    setErr(null);
    try {
      const updated = await markSold(id);
      setItems((prev) => prev.map((x) => (x.id === id ? updated : x)));
      setExpandedId(id);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to mark sold");
    }
  }

  async function doRelist(id: string) {
    setErr(null);
    nav(`/edit/${encodeURIComponent(id)}?relist=1`);
  }

  function toggleExpanded(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  const defaultDirByKey: Record<SortKey, SortDir> = {
    listing: "asc",
    price: "asc",
    views: "desc",
    status: "asc",
    created: "desc",
    updated: "desc",
    expiresIn: "asc",
  };

  function toggleSort(next: SortKey) {
    setSort((prev) => {
      const same = prev.key === next;
      const dir = same ? (prev.dir === "asc" ? "desc" : "asc") : defaultDirByKey[next];
      const key = next;
      // Recompute order only on explicit sort click (not when row data changes).
      setDisplayOrder(sortListings(items, key, dir, nowMs).map((l) => l.id));
      return { key, dir };
    });
  }

  const displayItems = useMemo(() => {
    const map = new Map(items.map((l) => [l.id, l] as const));
    const orderedSet = new Set(displayOrder);
    const ordered = displayOrder.map((id) => map.get(id)).filter((x): x is Listing => !!x);
    const extras = items.filter((l) => !orderedSet.has(l.id));
    return [...ordered, ...extras];
  }, [items, displayOrder]);

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
    const btnJustify = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";

    return (
      <th className={[thAlign, className].filter(Boolean).join(" ")}>
        <button
          type="button"
          onClick={() => toggleSort(k)}
          title={title ?? `Sort by ${label}`}
          className={["inline-flex w-full items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100", btnJustify].join(" ")}
        >
          <span>{label}</span>
          {icon}
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
            <h1 className="text-xl font-extrabold text-slate-900">My listings</h1>
            <div className="mt-1 text-sm text-slate-600">Listings linked to your account.</div>
          </div>
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
          </div>
        </div>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}
        {loading && <div className="mt-4 text-sm text-slate-600">Loading...</div>}

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

        {(viewType === "sale" && items.length > 0) || (viewType === "wanted" && wantedItems.length > 0) || (viewType === "all" && (items.length > 0 || wantedItems.length > 0)) ? (
          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="overflow-x-auto lg:overflow-x-visible">
              <table className="w-full min-w-[1080px] lg:min-w-0">
                <thead className="bg-slate-50">
                  <tr className="text-xs font-bold tracking-wider text-slate-600">
                    <SortTh label="Listing" k="listing" className="px-4 py-3" align="left" />
                    <SortTh label="Price" k="price" className="px-4 py-3" align="right" />
                    <SortTh label="Views" k="views" className="px-4 py-3" align="right" />
                    <SortTh label="Status" k="status" className="px-4 py-3" title="Default: Status then Updated" align="left" />
                    <SortTh label="Created" k="created" className="px-4 py-3" align="left" />
                    <SortTh label="Updated" k="updated" className="px-4 py-3" align="left" />
                    <SortTh label="Expires in" k="expiresIn" className="px-4 py-3" align="right" />
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>

                {/* For sale rows */}
                {(viewType === "sale" || viewType === "all") &&
                  displayItems.map((l, idx) => {
                    const rowBorder = idx === 0 ? "" : "border-t border-slate-200";

                    const assets = resolveAssets(l.images ?? []);
                    const hero = assets[0]?.thumbUrl ?? assets[0]?.medUrl ?? assets[0]?.fullUrl ?? null;

                    const canToggle = l.status !== "expired" && l.status !== "deleted" && l.status !== "draft" && l.resolution === "none";
                    const canResolve = l.status !== "expired" && l.status !== "deleted" && l.resolution === "none";

                    const toggleTitle = l.status === "paused" ? "Resume" : "Pause";
                    const canFeature = l.status === "active" && l.resolution === "none";
                    const isSold = l.resolution === "sold";
                    const expandedKey = `sale:${l.id}`;
                    const isExpanded = expandedId === expandedKey;

                    return (
                      <tbody key={expandedKey} className="group">
                        <tr className={["cursor-pointer transition-colors group-hover:bg-slate-50/70", rowBorder].join(" ")} onClick={() => toggleExpanded(expandedKey)}>
                          <td className="px-4 py-4 align-top text-left">
                            <div className="flex min-h-20 items-center gap-3">
                              <Link
                                to={`/listing/${l.id}`}
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
                                  to={`/listing/${l.id}`}
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
                                  <span className="min-w-0 truncate">
                                    {l.category} • {l.species} • {l.location}
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
                            <div className="text-sm font-semibold text-slate-700">{new Date(l.createdAt).toLocaleDateString()}</div>
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
                            <div className="flex justify-center"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpanded(expandedKey);
                              }}
                            >
                              <ActionButton label={isExpanded ? "Hide" : "Actions"} title={isExpanded ? "Hide actions" : "Show actions"} />
                            </div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="cursor-pointer transition-colors group-hover:bg-slate-50/70" onClick={() => toggleExpanded(expandedKey)}>
                            <td colSpan={8} className="px-4 pb-4 pt-0">
                              <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                                {!isSold ? (
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

                                    <ActionLink to={`/edit/${l.id}`} label="Edit" icon={<Pencil aria-hidden="true" className="h-4 w-4" />} />

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
                                  onClick={() => onDelete(l.id)}
                                  icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    );
                  })}

                {/* Divider between types in All */}
                {viewType === "all" && displayItems.length > 0 && wantedItems.length > 0 ? (
                  <tbody>
                    <tr className="border-t border-slate-200 bg-slate-50">
                      <td colSpan={8} className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-600">
                        Wanted
                      </td>
                    </tr>
                  </tbody>
                ) : null}

                {/* Wanted rows */}
                {(viewType === "wanted" || viewType === "all") &&
                  wantedItems.map((w, idx) => {
                    const rowBorder =
                      viewType === "wanted" && idx === 0 ? "" : viewType !== "wanted" && displayItems.length > 0 && idx === 0 ? "" : "border-t border-slate-200";

                    const assets = resolveAssets(w.images ?? []);
                    const hero = assets[0]?.thumbUrl ?? assets[0]?.medUrl ?? assets[0]?.fullUrl ?? null;

                    const expandedKey = `wanted:${w.id}`;
                    const isExpanded = expandedId === expandedKey;

                    return (
                      <tbody key={expandedKey} className="group">
                        <tr className={["cursor-pointer transition-colors group-hover:bg-slate-50/70", rowBorder].join(" ")} onClick={() => toggleExpanded(expandedKey)}>
                          <td className="px-4 py-4 align-top text-left">
                            <div className="flex min-h-20 items-center gap-3">
                              <Link
                                to={`/wanted/${w.id}`}
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
                                  to={`/wanted/${w.id}`}
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
                                  <span className="min-w-0 truncate">
                                    {w.category}
                                    {w.species ? ` • ${w.species}` : ""} • {w.location}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-4 align-top text-right">
                            <div className="text-sm font-extrabold text-slate-900">{budgetLabel(w)}</div>
                          </td>

                          <td className="px-4 py-4 align-top text-right">
                            <div className="text-sm font-semibold text-slate-600">—</div>
                          </td>

                          <td className="px-4 py-4 align-top text-left">
                            <WantedStatusText w={w} />
                          </td>

                          <td className="px-4 py-4 align-top text-left">
                            <div className="text-sm font-semibold text-slate-700">{new Date(w.createdAt).toLocaleDateString()}</div>
                          </td>

                          <td className="px-4 py-4 align-top text-left">
                            <div className="text-sm font-semibold text-slate-700" title={new Date(w.updatedAt).toLocaleString()}>
                              {relativeTime(w.updatedAt)}
                            </div>
                          </td>

                          <td className="px-4 py-4 align-top text-right">
                            <div className="text-sm font-semibold text-slate-600">—</div>
                          </td>

                          <td className="px-4 py-4 align-top text-center">
                            <div className="flex justify-center"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpanded(expandedKey);
                              }}
                            >
                              <ActionButton label={isExpanded ? "Hide" : "Actions"} title={isExpanded ? "Hide actions" : "Show actions"} />
                            </div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="cursor-pointer transition-colors group-hover:bg-slate-50/70" onClick={() => toggleExpanded(expandedKey)}>
                            <td colSpan={8} className="px-4 pb-4 pt-0">
                              <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                                <ActionLink to={`/wanted/edit/${w.id}`} label="Edit" icon={<Pencil aria-hidden="true" className="h-4 w-4" />} />
                                <ActionButton
                                  label={w.status === "open" ? "Close" : "Reopen"}
                                  title={w.status === "open" ? "Close wanted post" : "Reopen wanted post"}
                                  onClick={() => onToggleWantedStatus(w)}
                                />
                                <ActionButton
                                  label="Delete"
                                  title="Delete wanted post"
                                  variant="danger"
                                  onClick={() => onDeleteWanted(w.id)}
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
