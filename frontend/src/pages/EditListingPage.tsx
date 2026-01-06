import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  deleteListing,
  fetchListing,
  getOwnerToken,
  removeOwnerToken,
  resolveAssets,
  resolveImageUrl,
  updateListing,
  uploadImage,
  pauseListing,
  resumeListing,
  markSold,
  type Category,
  type Listing,
  type ImageAsset,
} from "../api";
import Header from "../components/Header";

function dollarsToCents(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function centsToDollarsString(cents: number) {
  return (cents / 100).toFixed(2);
}

const CATEGORIES: Category[] = ["Fish", "Shrimp", "Snails", "Plants", "Equipment"];

type PendingImage = {
  id: string;
  file: File;
  uploaded?: ImageAsset;
  status: "ready" | "uploading" | "uploaded" | "error";
  error?: string;
};

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function fmtStatus(l: Listing) {
  const parts: string[] = [];
  if (l.status === "draft") parts.push("Draft (hidden)");
  if (l.status === "pending") parts.push("Pending (public)");
  if (l.status === "active") parts.push("Active (public)");
  if (l.status === "paused") parts.push("Paused (hidden)");
  if (l.status === "expired") parts.push("Expired (hidden)");
  if (l.status === "deleted") parts.push("Deleted");

  if (l.resolution === "sold") parts.push("Marked sold");

  return parts.join(" • ");
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
    "inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2";
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

export default function EditListingPage() {
  const { id } = useParams();
  const nav = useNavigate();

  const [orig, setOrig] = useState<Listing | null>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("Fish");
  const [species, setSpecies] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [location, setLocation] = useState("");
  const [contact, setContact] = useState("");
  const [description, setDescription] = useState("");

  const [images, setImages] = useState<ImageAsset[]>([]);
  const [pending, setPending] = useState<PendingImage[]>([]);

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ownerToken = id ? getOwnerToken(id) : null;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!id) return;
      setErr(null);
      setLoading(true);
      try {
        const l = await fetchListing(id);
        if (cancelled) return;

        setOrig(l);
        setTitle(l.title);
        setCategory(l.category);
        setSpecies(l.species);
        setPriceDollars(centsToDollarsString(l.priceCents));
        setLocation(l.location);
        setContact(l.contact ?? "");
        setDescription(l.description);
        setImages((l.images ?? []).slice(0, 6));
        setPending([]);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load listing");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const existingPreviews = useMemo(() => {
    const assets = resolveAssets(images ?? []);
    return assets
      .map((a) => resolveImageUrl(a.thumbUrl || a.fullUrl))
      .filter((x): x is string => !!x);
  }, [images]);

  const pendingPreviews = useMemo(() => {
    return pending.map((p) => {
      const resolvedThumb = p.uploaded?.thumbUrl ? resolveImageUrl(p.uploaded.thumbUrl) : null;
      const resolvedFull = p.uploaded?.fullUrl ? resolveImageUrl(p.uploaded.fullUrl) : null;

      return {
        id: p.id,
        status: p.status,
        error: p.error,
        src: resolvedThumb || resolvedFull || URL.createObjectURL(p.file),
        uploaded: !!p.uploaded,
        local: !p.uploaded,
      };
    });
  }, [pending]);

  useEffect(() => {
    const locals = pendingPreviews.filter((p) => p.local).map((p) => p.src);
    return () => {
      for (const u of locals) URL.revokeObjectURL(u);
    };
  }, [pendingPreviews]);

  function moveExisting(idx: number, dir: -1 | 1) {
    setImages((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      const tmp = copy[idx];
      copy[idx] = copy[j];
      copy[j] = tmp;
      return copy;
    });
  }

  function removeExisting(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  function onPickFiles(nextFiles: FileList | null) {
    setErr(null);
    if (!nextFiles) return;

    setPending((prev) => {
      const room = Math.max(0, 6 - (images.length + prev.length));
      const picked = Array.from(nextFiles).slice(0, room);
      if (!picked.length) return prev;

      return [
        ...prev,
        ...picked.map((f) => ({
          id: uid(),
          file: f,
          status: "ready" as const,
        })),
      ];
    });
  }

  function removePending(pid: string) {
    setPending((prev) => prev.filter((x) => x.id !== pid));
  }

  function movePending(pid: string, dir: -1 | 1) {
    setPending((prev) => {
      const i = prev.findIndex((x) => x.id === pid);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
      return copy;
    });
  }

  async function uploadOne(p: PendingImage) {
    setPending((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "uploading", error: undefined } : x)));
    try {
      const asset = await uploadImage(p.file);
      setPending((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "uploaded", uploaded: asset } : x)));
      return asset;
    } catch (e: any) {
      const msg = e?.message ?? "Upload failed";
      setPending((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "error", error: msg } : x)));
      throw new Error(msg);
    }
  }

  async function uploadAllPending() {
    if (!pending.length) return;
    setUploading(true);
    try {
      for (const p of pending) {
        if (p.status === "uploaded" && p.uploaded) continue;
        await uploadOne(p).catch(() => {});
      }
    } finally {
      setUploading(false);
    }
  }

  async function refresh() {
    if (!id) return;
    const l = await fetchListing(id);
    setOrig(l);
    setTitle(l.title);
    setCategory(l.category);
    setSpecies(l.species);
    setPriceDollars(centsToDollarsString(l.priceCents));
    setLocation(l.location);
    setContact(l.contact ?? "");
    setDescription(l.description);
    setImages((l.images ?? []).slice(0, 6));
    setPending([]);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!id) return;

    if (!ownerToken) {
      setErr("Missing owner token for this listing (it wasn't created on this device).");
      return;
    }

    const priceCents = dollarsToCents(priceDollars);
    if (priceCents === null) {
      setErr("Please enter a valid non-negative price.");
      return;
    }

    setLoading(true);
    try {
      if (pending.some((p) => p.status !== "uploaded")) {
        await uploadAllPending();
      }

      const newlyUploaded = pending
        .filter((p) => p.status === "uploaded" && p.uploaded)
        .map((p) => p.uploaded!)
        .slice(0, 6);

      const merged = [...images, ...newlyUploaded].slice(0, 6);

      const updated = await updateListing(id, {
        title: title.trim(),
        category,
        species: species.trim(),
        priceCents,
        location: location.trim(),
        description: description.trim(),
        contact: contact.trim() ? contact.trim() : null,
        images: merged,
      });

      setOrig(updated);
      setImages((updated.images ?? []).slice(0, 6));
      setPending([]);
      nav(`/listing/${id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function onDelete() {
    if (!id) return;
    setErr(null);

    if (!ownerToken) {
      setErr("Missing owner token for this listing (it wasn't created on this device).");
      return;
    }

    const ok = window.confirm("Delete this listing? This cannot be undone.");
    if (!ok) return;

    setLoading(true);
    try {
      await deleteListing(id);
      removeOwnerToken(id);
      nav("/me");
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed");
    } finally {
      setLoading(false);
    }
  }

  async function doTogglePauseResume() {
    if (!id || !orig) return;
    setErr(null);
    setLoading(true);
    try {
      if (orig.status === "paused") {
        await resumeListing(id);
      } else {
        await pauseListing(id);
      }
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update listing status");
    } finally {
      setLoading(false);
    }
  }

  async function doSold() {
    if (!id) return;
    setErr(null);
    const ok = window.confirm("Mark this listing as SOLD? It will be hidden from Browse.");
    if (!ok) return;

    setLoading(true);
    try {
      await markSold(id);
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to mark sold");
    } finally {
      setLoading(false);
    }
  }

  const canSave = !loading && !uploading;

  const canTogglePause =
    !!ownerToken &&
    !!orig &&
    orig.status !== "draft" &&
    orig.status !== "expired" &&
    orig.status !== "deleted" &&
    orig.resolution === "none";

  const toggleLabel = orig?.status === "paused" ? "Resume listing" : "Pause listing";

  const canResolve =
    !!ownerToken &&
    !!orig &&
    orig.status !== "expired" &&
    orig.status !== "deleted" &&
    orig.resolution === "none";

  return (
    <div className="min-h-full">
      <Header maxWidth="3xl" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold text-slate-900">Edit listing</h1>
          {id && (
            <Link to={`/listing/${id}`} className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              View
            </Link>
          )}
        </div>

        {!ownerToken && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            You can view this listing, but you can't edit/delete it from this device (missing owner token).
          </div>
        )}

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

        {loading && !orig && <div className="mt-4 text-sm text-slate-600">Loading...</div>}

        {orig && (
          <form onSubmit={onSave} className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            {/* Lifecycle + actions */}
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-bold text-slate-900">Listing state</div>
              <div className="mt-1 text-xs text-slate-600">{fmtStatus(orig)}</div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <IconButton title={toggleLabel} onClick={doTogglePauseResume} disabled={!canTogglePause || loading} variant="default">
                  {orig.status === "paused" ? (
                    <>
                      <IconPlay />
                      <span className="ml-2">Resume Ad</span>
                    </>
                  ) : (
                    <>
                      <IconPause />
                      <span className="ml-2">Pause Ad</span>
                    </>
                  )}
                </IconButton>

                <IconButton title="Mark as sold" onClick={doSold} disabled={!canResolve || loading} variant="primary">
                  <IconCheck />
                  <span className="ml-2">Mark as Sold</span>
                </IconButton>

                <IconButton title="Delete listing" onClick={onDelete} disabled={loading || uploading || !ownerToken} variant="danger">
                  <IconTrash />
                  <span className="ml-2">Delete</span>
                </IconButton>
              </div>

              <div className="mt-3 text-xs text-slate-600">
                {orig.expiresAt ? (
                  <>
                    Expires{" "}
                    {new Date(orig.expiresAt).toLocaleString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    . Expiry is automatic.
                  </>
                ) : (
                  <>Expiry is automatic.</>
                )}
              </div>
            </div>

            {/* Images */}
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-slate-900">Photos</div>
                  <div className="text-xs text-slate-600">Up to 6 total (existing + new)</div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
                    Add photos
                    <input
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => onPickFiles(e.target.files)}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={uploadAllPending}
                    disabled={!pending.length || uploading}
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {uploading ? "Uploading..." : "Upload new"}
                  </button>
                </div>
              </div>

              {/* Existing */}
              <div className="mt-4">
                <div className="text-xs font-semibold text-slate-700">Existing</div>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  {existingPreviews.length ? (
                    existingPreviews.map((src, idx) => (
                      <div key={src + idx} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        <div className="relative h-28 w-full bg-slate-100">
                          <img src={src} alt={`existing-${idx}`} className="h-full w-full object-cover" />

                          <div className="absolute left-2 top-2 flex gap-1">
                            <button
                              type="button"
                              onClick={() => moveExisting(idx, -1)}
                              disabled={idx === 0}
                              className="rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-900 disabled:opacity-50"
                            >
                              ←
                            </button>
                            <button
                              type="button"
                              onClick={() => moveExisting(idx, 1)}
                              disabled={idx === existingPreviews.length - 1}
                              className="rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-900 disabled:opacity-50"
                            >
                              →
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => removeExisting(idx)}
                            className="absolute right-2 top-2 rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-white"
                            aria-label="Remove image"
                            title="Remove"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-full flex h-28 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-500">
                      No existing images
                    </div>
                  )}
                </div>
              </div>

              {/* Pending */}
              <div className="mt-4">
                <div className="text-xs font-semibold text-slate-700">New</div>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  {pendingPreviews.length ? (
                    pendingPreviews.map((p, idx) => (
                      <div key={p.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        <div className="relative h-28 w-full bg-slate-100">
                          <img src={p.src} alt={`pending-${idx}`} className="h-full w-full object-cover" />

                          <div className="absolute left-2 top-2 flex gap-1">
                            <button
                              type="button"
                              onClick={() => movePending(p.id, -1)}
                              disabled={idx === 0}
                              className="rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-900 disabled:opacity-50"
                            >
                              ←
                            </button>
                            <button
                              type="button"
                              onClick={() => movePending(p.id, 1)}
                              disabled={idx === pendingPreviews.length - 1}
                              className="rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-900 disabled:opacity-50"
                            >
                              →
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => removePending(p.id)}
                            className="absolute right-2 top-2 rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-white"
                            aria-label="Remove pending image"
                            title="Remove"
                          >
                            ×
                          </button>

                          <div className="absolute bottom-2 left-2 rounded-lg bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-700">
                            {p.status === "uploading"
                              ? "Uploading..."
                              : p.status === "uploaded"
                              ? "Uploaded"
                              : p.status === "error"
                              ? "Error"
                              : "Ready"}
                          </div>
                        </div>

                        {p.status === "error" && p.error && (
                          <div className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                            {p.error}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="col-span-full flex h-28 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-500">
                      No new images
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Fields */}
            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Title</div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                required
                minLength={3}
                maxLength={80}
                disabled={!ownerToken}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Category</div>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  disabled={!ownerToken}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Species</div>
                <input
                  value={species}
                  onChange={(e) => setSpecies(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  required
                  minLength={2}
                  maxLength={60}
                  disabled={!ownerToken}
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Price ($)</div>
                <input
                  value={priceDollars}
                  onChange={(e) => setPriceDollars(e.target.value)}
                  inputMode="decimal"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  required
                  disabled={!ownerToken}
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Location</div>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  required
                  minLength={2}
                  maxLength={80}
                  disabled={!ownerToken}
                />
              </label>
            </div>

            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Contact (optional)</div>
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="e.g. phone, email, or 'DM on FB: ...'"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                maxLength={200}
                disabled={!ownerToken}
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Description</div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[140px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                required
                minLength={1}
                maxLength={1000}
                disabled={!ownerToken}
              />
            </label>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!canSave || !ownerToken}
                className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {loading ? "Saving..." : uploading ? "Uploading..." : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
