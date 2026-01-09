import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  deleteListing,
  fetchListing,
  listOwnedIds,
  removeOwnerToken,
  resolveAssets,
  pauseListing,
  resumeListing,
  markSold,
  type Listing,
} from "../api";
import Header from "../components/Header";

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "AUD" });
}

type Row = { id: string; listing?: Listing; error?: string };

function badgeText(l: Listing) {
  const bits: string[] = [];
  bits.push(l.status);
  if (l.resolution !== "none") bits.push(l.resolution);
  return bits.join(" • ");
}

function Badge({ l }: { l: Listing }) {
  const s = l.status;
  const r = l.resolution;

  const cls =
    r !== "none"
      ? "bg-slate-100 text-slate-800 border-slate-200"
      : s === "active"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : s === "pending"
      ? "bg-amber-50 text-amber-900 border-amber-200"
      : s === "paused"
      ? "bg-violet-50 text-violet-900 border-violet-200"
      : s === "expired"
      ? "bg-slate-50 text-slate-700 border-slate-200"
      : s === "draft"
      ? "bg-sky-50 text-sky-900 border-sky-200"
      : "bg-slate-50 text-slate-700 border-slate-200";

  return <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-bold ${cls}`}>{badgeText(l)}</span>;
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

function IconPencil() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 17.25V21h3.75L19.81 7.94l-3.75-3.75L3 17.25zm2.92 2.83H5v-.92l11.06-11.06.92.92L5.92 20.08zM20.71 6.04a1 1 0 0 0 0-1.41l-1.34-1.34a1 1 0 0 0-1.41 0l-1.13 1.13 3.75 3.75 1.13-1.13z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 3h6l1 2h5v2H3V5h5l1-2zm1 6h2v10h-2V9zm4 0h2v10h-2V9z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconPause() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 5h3v14H7V5zm7 0h3v14h-3V5z" fill="currentColor" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 5v14l11-7L8 5z" fill="currentColor" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9.2 16.2 4.8 11.8l1.4-1.4 3 3 8.6-8.6 1.4 1.4-10 10z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconTick() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9.2 16.2 4.8 11.8l1.4-1.4 3 3 8.6-8.6 1.4 1.4-10 10z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconHourglass() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 2h12v4a6 6 0 0 1-3.2 5.3L13.3 12l1.5.7A6 6 0 0 1 18 18v4H6v-4a6 6 0 0 1 3.2-5.3l1.5-.7-1.5-.7A6 6 0 0 1 6 6V2zm2 4a4 4 0 0 0 2.1 3.5L12 10.4l1.9-.9A4 4 0 0 0 16 6V4H8v2zm8 16v-2a4 4 0 0 0-2.1-3.5L12 13.6l-1.9.9A4 4 0 0 0 8 20v2h8z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconExpired() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v6h-2V7zm0 8h2v2h-2v-2z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function MyListingsPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const ownedIds = useMemo(() => listOwnedIds(), []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setErr(null);
      setLoading(true);
      try {
        const ids = listOwnedIds();
        const next: Row[] = [];

        for (const id of ids) {
          try {
            const l = await fetchListing(id);
            next.push({ id, listing: l });
          } catch (e: any) {
            next.push({ id, error: e?.message ?? "Failed to load listing" });
          }
        }

        if (!cancelled) setRows(next);
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
  }, []);

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
          <IconTick />
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
          <IconExpired />
          <span>Feature expired</span>
        </div>
      );
    }

    if (diffMs < dayMs) {
      const hrs = Math.max(1, Math.ceil(diffMs / hourMs));
      return (
        <div className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-800">
          <IconHourglass />
          <span>Featured for {hrs}h</span>
        </div>
      );
    }

    const days = Math.max(1, Math.ceil(diffMs / dayMs));
    return (
      <div className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
        <IconTick />
        <span>
          Featured for {days} {days === 1 ? "day" : "days"}
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
      removeOwnerToken(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed");
    }
  }

  async function doTogglePauseResume(l: Listing) {
    setErr(null);
    try {
      const updated = l.status === "paused" ? await resumeListing(l.id) : await pauseListing(l.id);
      setRows((prev) => prev.map((r) => (r.id === l.id ? { ...r, listing: updated } : r)));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update listing status");
    }
  }

  async function doSold(id: string) {
    setErr(null);
    const ok = window.confirm("Mark this listing as SOLD? It will be hidden from Browse.");
    if (!ok) return;

    try {
      const updated = await markSold(id);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, listing: updated } : r)));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to mark sold");
    }
  }

  function toggleExpanded(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="min-h-full">
      <Header maxWidth="5xl" />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-xl font-extrabold text-slate-900">My listings</h1>
        <div className="mt-1 text-sm text-slate-600">Listings created on this device.</div>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}
        {loading && <div className="mt-4 text-sm text-slate-600">Loading...</div>}

        {!loading && ownedIds.length === 0 && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">No listings yet</div>
            <div className="mt-1 text-sm text-slate-600">Post one and it will show here.</div>
            <Link to="/post" className="mt-4 inline-block rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              Post a listing
            </Link>
          </div>
        )}

        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[980px]">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-bold uppercase tracking-wider text-slate-600">
                <th className="px-4 py-3">Listing</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Views</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            {rows.map((r, idx) => {
              const l = r.listing;
              const rowBorder = idx === 0 ? "" : "border-t border-slate-200";

              if (!l) {
                return (
                  <tbody key={r.id}>
                    <tr className={["text-sm", rowBorder].join(" ")}>
                      <td className="px-4 py-4" colSpan={7}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-extrabold text-slate-900">Listing {r.id}</div>
                            <div className="mt-1 text-sm text-slate-700">{r.error ?? "Unavailable"}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              removeOwnerToken(r.id);
                              setRows((prev) => prev.filter((x) => x.id !== r.id));
                            }}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                          >
                            Remove from My Listings
                          </button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                );
              }

              const assets = resolveAssets(l.images ?? []);
              const hero = assets[0]?.thumbUrl ?? assets[0]?.medUrl ?? assets[0]?.fullUrl ?? null;

              const canToggle = l.status !== "expired" && l.status !== "deleted" && l.status !== "draft" && l.resolution === "none";
              const canResolve = l.status !== "expired" && l.status !== "deleted" && l.resolution === "none";

              const toggleTitle = l.status === "paused" ? "Resume" : "Pause";
              const canFeature = l.status === "active" && l.resolution === "none";
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
                      <Badge l={l} />
                    </td>

                    <td className="px-4 py-4 align-top">
                      <div className="text-sm font-semibold text-slate-700">{new Date(l.createdAt).toLocaleDateString()}</div>
                    </td>

                    <td className="px-4 py-4 align-top">
                      <div className="text-sm font-semibold text-slate-700">{new Date(l.updatedAt).toLocaleString()}</div>
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
                      <td colSpan={7} className="px-4 pb-4 pt-0">
                        <div
                          className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
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
                            icon={l.featured ? <IconTick /> : undefined}
                          />

                          <ActionLink to={`/edit/${l.id}`} label="Edit" icon={<IconPencil />} />

                          <ActionButton
                            label={toggleTitle}
                            title={toggleTitle}
                            disabled={!canToggle}
                            onClick={() => doTogglePauseResume(l)}
                            icon={l.status === "paused" ? <IconPlay /> : <IconPause />}
                          />

                          <ActionButton
                            label="Mark sold"
                            title="Mark as sold"
                            variant="primary"
                            disabled={!canResolve}
                            onClick={() => doSold(l.id)}
                            icon={<IconCheck />}
                          />

                          <ActionButton
                            label="Delete"
                            title="Delete"
                            variant="danger"
                            onClick={() => onDelete(l.id)}
                            icon={<IconTrash />}
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
