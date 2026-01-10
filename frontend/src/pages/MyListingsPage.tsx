import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
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
  deleteListing,
  fetchMyListings,
  resolveAssets,
  pauseListing,
  resumeListing,
  markSold,
  relistListing,
  type Listing,
} from "../api";
import Header from "../components/Header";
import { useAuth } from "../auth";

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "AUD" });
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

  return <span className={`text-sm font-semibold ${cls}`}>{statusLabel(l)}</span>;
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
  const { user, loading: authLoading } = useAuth();

  const [items, setItems] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (authLoading) return;
    if (!user) nav(`/auth?next=${encodeURIComponent("/me")}`);
  }, [authLoading, user, nav]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setErr(null);
      setLoading(true);
      try {
        if (!user) return;
        const res = await fetchMyListings({ limit: 200, offset: 0 });
        if (!cancelled) setItems(res.items ?? []);
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
  }, [user]);

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
        <div className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
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
        <div className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-red-700">
          <CircleX aria-hidden="true" className="h-4 w-4" />
          <span>Feature expired</span>
        </div>
      );
    }

    if (diffMs < dayMs) {
      const hrs = Math.max(1, Math.ceil(diffMs / hourMs));
      return (
        <div className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
          <Hourglass aria-hidden="true" className="h-4 w-4" />
          <span>Featured ({hrs}h left)</span>
        </div>
      );
    }

    const days = Math.max(1, Math.ceil(diffMs / dayMs));
    return (
      <div className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
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
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed");
    }
  }

  async function doTogglePauseResume(l: Listing) {
    setErr(null);
    try {
      const updated = l.status === "paused" ? await resumeListing(l.id) : await pauseListing(l.id);
      setItems((prev) => prev.map((x) => (x.id === l.id ? updated : x)));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update listing status");
    }
  }

  async function doSold(id: string) {
    setErr(null);
    try {
      const updated = await markSold(id);
      setItems((prev) => prev.map((x) => (x.id === id ? updated : x)));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to mark sold");
    }
  }

  async function doRelist(id: string) {
    setErr(null);
    setLoading(true);
    try {
      const res = await relistListing(id);
      setItems((prev) => prev.map((x) => (x.id === id ? res.item : x)));
      nav(`/edit/${encodeURIComponent(res.item.id)}`);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to relist");
    } finally {
      setLoading(false);
    }
  }

  function toggleExpanded(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="min-h-full">
      <Header maxWidth="6xl" />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <h1 className="text-xl font-extrabold text-slate-900">My listings</h1>
        <div className="mt-1 text-sm text-slate-600">Listings linked to your account.</div>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}
        {loading && <div className="mt-4 text-sm text-slate-600">Loading...</div>}

        {!loading && items.length === 0 && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">No listings yet</div>
            <div className="mt-1 text-sm text-slate-600">Post one and it will show here.</div>
            <Link to="/post" className="mt-4 inline-block rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              Post a listing
            </Link>
          </div>
        )}

        <div className="mt-6 overflow-x-auto lg:overflow-x-visible rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[1080px] lg:min-w-0">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-bold uppercase tracking-wider text-slate-600">
                <th className="px-4 py-3">Listing</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Views</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Expires in</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            {items.map((l, idx) => {
              const rowBorder = idx === 0 ? "" : "border-t border-slate-200";

              const assets = resolveAssets(l.images ?? []);
              const hero = assets[0]?.thumbUrl ?? assets[0]?.medUrl ?? assets[0]?.fullUrl ?? null;

              const canToggle = l.status !== "expired" && l.status !== "deleted" && l.status !== "draft" && l.resolution === "none";
              const canResolve = l.status !== "expired" && l.status !== "deleted" && l.resolution === "none";

              const toggleTitle = l.status === "paused" ? "Resume" : "Pause";
              const canFeature = l.status === "active" && l.resolution === "none";
              const isSold = l.resolution === "sold";
              const isExpanded = expandedId === l.id;

              return (
                <tbody key={l.id} className="group">
                  <tr
                    className={["cursor-pointer transition-colors group-hover:bg-slate-50/70", rowBorder].join(" ")}
                    onClick={() => toggleExpanded(l.id)}
                  >
                    <td className="px-4 py-4 align-top">
                      <div className="flex items-start gap-3">
                        <Link
                          to={`/listing/${l.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="h-14 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
                        >
                          {hero ? (
                            <img src={hero} alt={l.title} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                          ) : null}
                        </Link>

                        <div className="min-w-0">
                          <Link
                            to={`/listing/${l.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="block truncate text-sm font-extrabold text-slate-900 hover:underline"
                          >
                            {l.title}
                          </Link>
                          <div className="mt-1 truncate text-xs font-semibold text-slate-600">
                            {l.category} • {l.species} • {l.location}
                          </div>
                          {renderFeaturedText(l)}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-4 align-top">
                      <div className="text-sm font-extrabold text-slate-900">{centsToDollars(l.priceCents)}</div>
                    </td>

                    <td className="px-4 py-4 align-top">
                      <div className="text-sm font-semibold text-slate-700">{Number(l.views ?? 0).toLocaleString()}</div>
                    </td>

                    <td className="px-4 py-4 align-top">
                      <StatusText l={l} />
                    </td>

                    <td className="px-4 py-4 align-top">
                      <div className="text-sm font-semibold text-slate-700">{new Date(l.createdAt).toLocaleDateString()}</div>
                    </td>

                    <td className="px-4 py-4 align-top">
                      <div className="text-sm font-semibold text-slate-700" title={new Date(l.updatedAt).toLocaleString()}>
                        {relativeTime(l.updatedAt)}
                      </div>
                    </td>

                    <td className="px-4 py-4 align-top">
                      <div className="text-sm font-semibold text-slate-700" title={l.expiresAt ? new Date(l.expiresAt).toLocaleString() : ""}>
                        {expiresInShort(l.expiresAt)}
                      </div>
                    </td>

                    <td className="px-4 py-4 align-top">
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(l.id);
                        }}
                      >
                        <ActionButton label={isExpanded ? "Hide" : "Actions"} title={isExpanded ? "Hide actions" : "Show actions"} />
                      </div>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className="cursor-pointer transition-colors group-hover:bg-slate-50/70" onClick={() => toggleExpanded(l.id)}>
                      <td colSpan={8} className="px-4 pb-4 pt-0">
                        <div
                          className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
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
                                icon={
                                  l.status === "paused" ? (
                                    <Play aria-hidden="true" className="h-4 w-4" />
                                  ) : (
                                    <Pause aria-hidden="true" className="h-4 w-4" />
                                  )
                                }
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
          </table>
        </div>
      </main>
    </div>
  );
}
