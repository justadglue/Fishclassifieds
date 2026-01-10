import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Maximize2, Pause, Play, Trash2, X } from "lucide-react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  deleteListing,
  fetchListing,
  createListing,
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
import { useAuth } from "../auth";

function dollarsToCents(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function centsToDollarsString(cents: number) {
  return (cents / 100).toFixed(2);
}

function expiresInShort(iso: string) {
  const exp = new Date(iso).getTime();
  if (!Number.isFinite(exp)) return null;
  const diffMs = exp - Date.now();
  if (diffMs <= 0) return "0m";

  const minMs = 60 * 1000;
  const hourMs = 60 * minMs;
  const dayMs = 24 * hourMs;

  if (diffMs < hourMs) return `${Math.max(1, Math.ceil(diffMs / minMs))}m`;
  if (diffMs < dayMs) return `${Math.max(1, Math.ceil(diffMs / hourMs))}h`;
  return `${Math.max(1, Math.ceil(diffMs / dayMs))}d`;
}

const CATEGORIES: Category[] = ["Fish", "Shrimp", "Snails", "Plants", "Equipment"];

type PendingImage = {
  id: string;
  file: File;
  uploaded?: ImageAsset;
  status: "ready" | "uploading" | "uploaded" | "error";
  error?: string;
};

type PhotoItem =
  | { kind: "existing"; id: string; asset: ImageAsset }
  | { kind: "pending"; id: string; file: File; uploaded?: ImageAsset; status: PendingImage["status"]; error?: string };

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

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export default function EditListingPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [sp] = useSearchParams();
  const relistMode = sp.get("relist") === "1";

  const [orig, setOrig] = useState<Listing | null>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("Fish");
  const [species, setSpecies] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [location, setLocation] = useState("");
  const [contact, setContact] = useState("");
  const [description, setDescription] = useState("");

  const [photos, setPhotos] = useState<PhotoItem[]>([]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  const inFlightUploads = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      nav(`/auth?next=${encodeURIComponent(`/edit/${id ?? ""}`)}`);
    }
  }, [authLoading, user, id, nav]);

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
        setPhotos((l.images ?? []).slice(0, 6).map((a, i) => ({ kind: "existing" as const, id: `existing-${i}-${a.fullUrl}`, asset: a })));
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

  const photoPreviews = useMemo(() => {
    return photos.map((p, idx) => {
      if (p.kind === "existing") {
        const full = resolveImageUrl(p.asset.fullUrl) ?? p.asset.fullUrl;
        const thumb = resolveImageUrl(p.asset.thumbUrl || p.asset.fullUrl) ?? (p.asset.thumbUrl || p.asset.fullUrl);
        const med = resolveImageUrl(p.asset.medUrl || p.asset.fullUrl) ?? (p.asset.medUrl || p.asset.fullUrl);
        return {
          id: p.id,
          key: p.id,
          kind: "existing" as const,
          idx,
          status: "uploaded" as const,
          src: thumb,
          fullSrc: full || med || thumb,
          local: false,
          error: undefined as string | undefined,
        };
      }

      const uploaded = p.uploaded;
      const resolvedThumb = uploaded?.thumbUrl ? resolveImageUrl(uploaded.thumbUrl) : null;
      const resolvedFull = uploaded?.fullUrl ? resolveImageUrl(uploaded.fullUrl) : null;
      const src = resolvedThumb || resolvedFull || URL.createObjectURL(p.file);
      const fullSrc = resolvedFull || src;
      return {
        id: p.id,
        key: p.id,
        kind: "pending" as const,
        idx,
        status: p.status,
        src,
        fullSrc,
        local: !uploaded,
        error: p.error,
      };
    });
  }, [photos]);

  useEffect(() => {
    const locals = photoPreviews.filter((p) => p.local).map((p) => p.src);
    return () => {
      for (const u of locals) URL.revokeObjectURL(u);
    };
  }, [photoPreviews]);

  const hasMultiple = photoPreviews.length > 1;

  const openLightboxAt = useCallback(
    (idx: number) => {
      if (!photoPreviews.length) return;
      setActivePhotoIdx(Math.max(0, Math.min(idx, photoPreviews.length - 1)));
      setLightboxOpen(true);
    },
    [photoPreviews.length]
  );

  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  const prevImage = useCallback(() => {
    setActivePhotoIdx((i) => (i <= 0 ? photoPreviews.length - 1 : i - 1));
  }, [photoPreviews.length]);

  const nextImage = useCallback(() => {
    setActivePhotoIdx((i) => (i >= photoPreviews.length - 1 ? 0 : i + 1));
  }, [photoPreviews.length]);

  useEffect(() => {
    if (!lightboxOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeLightbox();
        return;
      }
      if (!hasMultiple) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prevImage();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        nextImage();
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeLightbox, hasMultiple, lightboxOpen, nextImage, prevImage]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lightboxOpen]);

  function movePhoto(idx: number, dir: -1 | 1) {
    setPhotos((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      const tmp = copy[idx];
      copy[idx] = copy[j];
      copy[j] = tmp;
      return copy;
    });
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }

  function onPickFiles(nextFiles: FileList | null) {
    setErr(null);
    if (!nextFiles) return;

    setPhotos((prev) => {
      const room = Math.max(0, 6 - prev.length);
      const picked = Array.from(nextFiles).slice(0, room);
      if (!picked.length) return prev;

      return [
        ...prev,
        ...picked.map((f) => ({ kind: "pending" as const, id: uid(), file: f, status: "ready" as const })),
      ];
    });
  }

  const uploadOne = useCallback(async (p: { id: string; file: File }) => {
    setPhotos((prev) =>
      prev.map((x) => (x.kind === "pending" && x.id === p.id ? { ...x, status: "uploading", error: undefined } : x))
    );
    try {
      const asset = await uploadImage(p.file);
      setPhotos((prev) =>
        prev.map((x) => (x.kind === "pending" && x.id === p.id ? { ...x, status: "uploaded", uploaded: asset } : x))
      );
      return asset;
    } catch (e: any) {
      const msg = e?.message ?? "Upload failed";
      setPhotos((prev) =>
        prev.map((x) => (x.kind === "pending" && x.id === p.id ? { ...x, status: "error", error: msg } : x))
      );
      throw new Error(msg);
    }
  }, []);

  // Auto-upload newly added photos (no separate upload button).
  useEffect(() => {
    const ready = photos.filter((p) => p.kind === "pending" && p.status === "ready") as Array<
      Extract<PhotoItem, { kind: "pending" }>
    >;
    if (!ready.length) return;

    let cancelled = false;
    (async () => {
      for (const p of ready) {
        if (cancelled) return;
        if (inFlightUploads.current.has(p.id)) continue;
        inFlightUploads.current.add(p.id);
        try {
          await uploadOne({ id: p.id, file: p.file });
        } catch {
          // error already stored on the photo
        } finally {
          inFlightUploads.current.delete(p.id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [photos, uploadOne]);

  const isUploading = photos.some((p) => p.kind === "pending" && p.status === "uploading");

  const retryUpload = useCallback(
    async (pendingId: string) => {
      const p = photos.find((x) => x.kind === "pending" && x.id === pendingId) as Extract<PhotoItem, { kind: "pending" }> | undefined;
      if (!p) return;
      if (inFlightUploads.current.has(p.id)) return;
      inFlightUploads.current.add(p.id);
      try {
        await uploadOne({ id: p.id, file: p.file });
      } catch {
        // error already stored
      } finally {
        inFlightUploads.current.delete(p.id);
      }
    },
    [photos, uploadOne]
  );

  async function uploadAllPending() {
    const pendingItems = photos.filter((p) => p.kind === "pending") as Array<Extract<PhotoItem, { kind: "pending" }>>;
    if (!pendingItems.length) return;
    try {
      for (const p of pendingItems) {
        if (p.status === "uploaded" && p.uploaded) continue;
        await uploadOne({ id: p.id, file: p.file }).catch(() => { });
      }
    } finally {
      // noop
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!id) return;

    const priceCents = dollarsToCents(priceDollars);
    if (priceCents === null) {
      setErr("Please enter a valid non-negative price.");
      return;
    }

    setLoading(true);
    try {
      if (photos.some((p) => p.kind === "pending" && p.status !== "uploaded")) {
        await uploadAllPending();
      }

      const merged = photos
        .map((p) => {
          if (p.kind === "existing") return p.asset;
          if (p.status === "uploaded" && p.uploaded) return p.uploaded;
          return null;
        })
        .filter((x): x is ImageAsset => !!x)
        .slice(0, 6);

      if (relistMode) {
        // Relist: do not modify anything until user clicks Update listing.
        // Create a brand new listing (active/pending depending on server config), then archive the sold one.
        const created = await createListing({
          title: title.trim(),
          category,
          species: species.trim(),
          priceCents,
          location: location.trim(),
          description: description.trim(),
          contact: contact.trim() ? contact.trim() : null,
          images: merged,
          status: "active",
        });

        await deleteListing(id);
        nav(`/listing/${created.id}`);
        return;
      }

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
      setPhotos((updated.images ?? []).slice(0, 6).map((a, i) => ({ kind: "existing" as const, id: `existing-${i}-${a.fullUrl}`, asset: a })));
      nav(`/listing/${id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally {
      setLoading(false);
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
    setPhotos((l.images ?? []).slice(0, 6).map((a, i) => ({ kind: "existing" as const, id: `existing-${i}-${a.fullUrl}`, asset: a })));
  }

  async function onDeleteListing() {
    if (!id) return;
    setErr(null);

    const ok = window.confirm("Delete this listing? This cannot be undone.");
    if (!ok) return;

    setLoading(true);
    try {
      await deleteListing(id);
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

  const canSave = !loading && !isUploading;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  function onDragEnd(e: any) {
    const activeId = String(e.active?.id ?? "");
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!activeId || !overId || activeId === overId) return;
    setPhotos((prev) => {
      const oldIndex = prev.findIndex((p) => p.id === activeId);
      const newIndex = prev.findIndex((p) => p.id === overId);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function SortablePhotoCard(props: {
    p: (typeof photoPreviews)[number];
    idx: number;
    total: number;
  }) {
    const { p, idx, total } = props;
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id });

    const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
    };

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={[
          "overflow-hidden rounded-2xl border bg-white touch-none select-none",
          isDragging ? "border-slate-900 shadow-lg opacity-95 cursor-grabbing" : "border-slate-200 cursor-grab",
        ].join(" ")}
        {...attributes}
        {...listeners}
      >
        <div className="relative h-28 w-full bg-slate-100">
          <img src={p.src} alt={`photo-${idx}`} className="h-full w-full object-cover" draggable={false} />

          {idx === 0 && (
            <div className="absolute bottom-2 left-2 rounded-full bg-slate-900/80 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
              Thumbnail
            </div>
          )}

          <div className="absolute left-2 top-2 flex gap-1">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                movePhoto(idx, -1);
              }}
              disabled={idx === 0}
              className="rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-900 disabled:opacity-50"
              title="Move left"
            >
              <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                movePhoto(idx, 1);
              }}
              disabled={idx === total - 1}
              className="rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-900 disabled:opacity-50"
              title="Move right"
            >
              <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              removePhoto(idx);
            }}
            className="absolute right-2 top-2 rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-white"
            aria-label="Remove image"
            title="Remove"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              openLightboxAt(idx);
            }}
            className="absolute right-10 top-2 rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-white"
            aria-label="Expand photo"
            title="Expand"
          >
            <Maximize2 aria-hidden="true" className="h-3.5 w-3.5" />
          </button>

          {p.kind === "pending" && (
            <div className="absolute bottom-2 right-2 rounded-lg bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-700">
              {p.status === "uploading"
                ? "Uploading..."
                : p.status === "uploaded"
                  ? "Uploaded"
                  : p.status === "error"
                    ? "Error"
                    : "Ready"}
            </div>
          )}
        </div>

        {p.kind === "pending" && p.status === "error" && p.error && (
          <div className="flex items-center justify-between gap-3 border-t border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
            <span className="truncate">{p.error}</span>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                retryUpload(p.id);
              }}
              className="shrink-0 rounded-lg bg-white/90 px-2 py-1 text-[11px] font-bold text-slate-900 hover:bg-white"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    );
  }

  const canTogglePause =
    !relistMode &&
    !!orig &&
    orig.status !== "draft" &&
    orig.status !== "expired" &&
    orig.status !== "deleted" &&
    orig.resolution === "none";

  const toggleLabel = orig?.status === "paused" ? "Resume listing" : "Pause listing";

  const canResolve =
    !relistMode && !!orig && orig.status !== "expired" && orig.status !== "deleted" && orig.resolution === "none";

  return (
    <div className="min-h-full">
      <Header maxWidth="3xl" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold text-slate-900">{relistMode ? "Relist listing" : "Edit listing"}</h1>
          {id && (
            <Link to={`/listing/${id}`} className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              View
            </Link>
          )}
        </div>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

        {loading && !orig && <div className="mt-4 text-sm text-slate-600">Loading...</div>}

        {orig && (
          <form onSubmit={onSave} className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            {/* Listing state (only for normal edit, not relist) */}
            {!relistMode && (
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-sm font-bold text-slate-900">Listing state</div>
                <div className="mt-1 text-xs text-slate-600">{fmtStatus(orig)}</div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <IconButton title={toggleLabel} onClick={doTogglePauseResume} disabled={!canTogglePause || loading} variant="default">
                    {orig.status === "paused" ? (
                      <>
                        <Play aria-hidden="true" className="h-5 w-5" />
                        <span className="ml-2">Resume Ad</span>
                      </>
                    ) : (
                      <>
                        <Pause aria-hidden="true" className="h-5 w-5" />
                        <span className="ml-2">Pause Ad</span>
                      </>
                    )}
                  </IconButton>

                  <IconButton title="Mark as sold" onClick={doSold} disabled={!canResolve || loading} variant="primary">
                    <Check aria-hidden="true" className="h-5 w-5" />
                    <span className="ml-2">Mark as Sold</span>
                  </IconButton>

                  <IconButton title="Delete listing" onClick={onDeleteListing} disabled={loading || isUploading} variant="danger">
                    <Trash2 aria-hidden="true" className="h-5 w-5" />
                    <span className="ml-2">Delete</span>
                  </IconButton>
                </div>

                <div className="mt-3 text-xs text-slate-600">
                  {orig.expiresAt ? (
                    <>
                      Expires in {expiresInShort(orig.expiresAt) ?? "—"} on{" "}
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
            )}

            {/* Images */}
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-slate-900">Photos</div>
                  <div className="text-xs text-slate-600">Up to 6 photos.</div>
                  <div className="text-xs text-slate-600">Photos will appear in this order on the listing.</div>
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
                </div>
              </div>

              {/* Photos (single combined section) */}
              {photoPreviews.length === 0 ? (
                <div className="mt-4 flex h-28 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-500">
                  No photos
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={photoPreviews.map((x) => x.id)} strategy={rectSortingStrategy}>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      {photoPreviews.map((p, idx) => (
                        <SortablePhotoCard key={p.id} p={p} idx={idx} total={photoPreviews.length} />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
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
                disabled={loading}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Category</div>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  disabled={loading}
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
                  disabled={loading}
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
                  disabled={loading}
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
                  disabled={loading}
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
                disabled={loading}
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
                disabled={loading}
              />
            </label>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!canSave}
                className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {loading ? "Saving..." : isUploading ? "Uploading..." : "Update listing"}
              </button>

              <button
                type="button"
                disabled={loading || isUploading}
                onClick={() => {
                  if (window.history.length > 1) nav(-1);
                  else if (id) nav(`/listing/${id}`);
                  else nav("/me");
                }}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </main>

      {/* Lightbox */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeLightbox();
          }}
          aria-modal="true"
          role="dialog"
        >
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="relative w-full max-w-6xl">
              <button
                type="button"
                onClick={closeLightbox}
                aria-label="Close"
                className="
                  absolute right-2 top-2 z-10
                  rounded-full border border-white/30
                  bg-white/10 backdrop-blur
                  px-3 py-2
                  text-white
                  shadow-sm
                  transition
                  hover:bg-white/20 hover:border-white/50
                  focus:outline-none
                  focus-visible:ring-2 focus-visible:ring-white/60
                "
              >
                ✕
              </button>

              {photoPreviews.length > 0 && (
                <div className="absolute left-2 top-2 z-10 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white backdrop-blur">
                  {activePhotoIdx + 1} / {photoPreviews.length}
                </div>
              )}

              <div className="relative overflow-hidden rounded-2xl">
                <div className="flex items-center justify-center">
                  {photoPreviews[activePhotoIdx]?.fullSrc ? (
                    <img
                      src={photoPreviews[activePhotoIdx].fullSrc}
                      alt={orig?.title ?? "Listing image"}
                      className="max-h-[85vh] w-auto max-w-full select-none object-contain"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex h-[60vh] w-full items-center justify-center rounded-2xl bg-white/10 text-sm font-semibold text-white">
                      No image
                    </div>
                  )}
                </div>

                {hasMultiple && (
                  <>
                    <button
                      type="button"
                      onClick={prevImage}
                      aria-label="Previous image"
                      className="
                        absolute left-3 top-1/2 -translate-y-1/2
                        rounded-full border border-white/30
                        bg-white/10 backdrop-blur
                        px-4 py-3
                        text-white
                        shadow-sm
                        transition
                        hover:bg-white/20 hover:border-white/50
                        focus:outline-none
                        focus-visible:ring-2 focus-visible:ring-white/60
                      "
                    >
                      ‹
                    </button>

                    <button
                      type="button"
                      onClick={nextImage}
                      aria-label="Next image"
                      className="
                        absolute right-3 top-1/2 -translate-y-1/2
                        rounded-full border border-white/30
                        bg-white/10 backdrop-blur
                        px-4 py-3
                        text-white
                        shadow-sm
                        transition
                        hover:bg-white/20 hover:border-white/50
                        focus:outline-none
                        focus-visible:ring-2 focus-visible:ring-white/60
                      "
                    >
                      ›
                    </button>
                  </>
                )}
              </div>

              <div className="mt-3 text-center text-xs font-semibold text-white/70">
                {hasMultiple ? "Use ← / → to navigate, Esc to close" : "Press Esc to close"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
