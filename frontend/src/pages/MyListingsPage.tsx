import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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

function IconButton(props: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "danger" | "primary";
  children: React.ReactNode;
}) {
  const { title, onClick, disabled, variant = "default", children } = props;

  const base =
    "inline-flex items-center justify-center rounded-xl border p-2 transition focus:outline-none focus-visible:ring-2";
  const cls =
    variant === "danger"
      ? "border-red-200 bg-white text-red-700 hover:bg-red-50 focus-visible:ring-red-300 disabled:opacity-60"
      : variant === "primary"
      ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800 focus-visible:ring-slate-400 disabled:opacity-60"
      : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50 focus-visible:ring-slate-300 disabled:opacity-60";

  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled} className={`${base} ${cls}`}>
      {children}
    </button>
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

export default function MyListingsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  return (
    <div className="min-h-full">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="font-extrabold tracking-tight text-slate-900">
            Fishclassifieds
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/post" className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              Post a listing
            </Link>
            <Link to="/" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              Browse
            </Link>
          </div>
        </div>
      </header>

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

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const l = r.listing;
            if (!l) {
              return (
                <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-bold text-slate-900">Listing {r.id}</div>
                  <div className="mt-1 text-sm text-slate-700">{r.error ?? "Unavailable"}</div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        removeOwnerToken(r.id);
                        setRows((prev) => prev.filter((x) => x.id !== r.id));
                      }}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                    >
                      Remove from My Listings
                    </button>
                  </div>
                </div>
              );
            }

            const assets = resolveAssets(l.images ?? []);
            const hero = assets[0]?.medUrl ?? assets[0]?.fullUrl ?? null;

            const canToggle = l.status !== "expired" && l.status !== "deleted" && l.status !== "draft" && l.resolution === "none";
            const canResolve = l.status !== "expired" && l.status !== "deleted" && l.resolution === "none";

            const toggleTitle = l.status === "paused" ? "Resume" : "Pause";

            return (
              <div key={l.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <Link to={`/listing/${l.id}`} className="block">
                  <div className="aspect-[4/3] w-full bg-slate-100">
                    {hero ? (
                      <img src={hero} alt={l.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-500">No image</div>
                    )}
                  </div>
                </Link>

                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-extrabold text-slate-900">{l.title}</div>
                      <div className="mt-1 truncate text-xs font-semibold text-slate-600">
                        {l.category} • {l.species} • {l.location}
                      </div>
                    </div>
                    <Badge l={l} />
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-sm font-extrabold text-slate-900">{centsToDollars(l.priceCents)}</div>
                    <div className="text-[11px] font-semibold text-slate-500">{new Date(l.createdAt).toLocaleDateString()}</div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <Link to={`/edit/${l.id}`} className="inline-flex" aria-label="Edit">
                      <IconButton title="Edit" variant="default">
                        <IconPencil />
                      </IconButton>
                    </Link>

                    <IconButton title="Delete" variant="danger" onClick={() => onDelete(l.id)}>
                      <IconTrash />
                    </IconButton>

                    <IconButton
                      title={toggleTitle}
                      variant="default"
                      disabled={!canToggle}
                      onClick={() => doTogglePauseResume(l)}
                    >
                      {l.status === "paused" ? <IconPlay /> : <IconPause />}
                    </IconButton>

                    <IconButton title="Mark as Sold" variant="primary" disabled={!canResolve} onClick={() => doSold(l.id)}>
                      <IconCheck />
                    </IconButton>
                  </div>

                  <div className="mt-3 text-[11px] font-semibold text-slate-500">
                    Updated: {new Date(l.updatedAt).toLocaleString()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
