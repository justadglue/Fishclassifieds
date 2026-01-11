// frontend/src/pages/PostListingPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, GripVertical, Maximize2, Undo2, X } from "lucide-react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createListing,
  uploadImage,
  resolveImageUrl,
  type Category,
  type ImageAsset,
} from "../api";
import Header from "../components/Header";
import { useAuth } from "../auth";
import { buildSaleDetailsPrefix, encodeSaleDetailsIntoDescription, type PriceType } from "../utils/listingDetailsBlock";
import ShippingInfoButton from "../components/ShippingInfoButton";

function dollarsToCents(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
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

export default function PostListingPage() {
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;
    if (!user) nav(`/auth?next=${encodeURIComponent("/post")}&ctx=create_listing`);
  }, [authLoading, user, nav]);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("Fish");
  const [species, setSpecies] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [priceType, setPriceType] = useState<PriceType>("each");
  const [customPriceText, setCustomPriceText] = useState("");
  const [willingToShip, setWillingToShip] = useState(false);
  const [location, setLocation] = useState("");
  const [contact, setContact] = useState("");
  const [description, setDescription] = useState("");

  const customPriceInputRef = useRef<HTMLInputElement | null>(null);
  const [showShipHint, setShowShipHint] = useState(false);
  const [shipHintVisible, setShipHintVisible] = useState(false);

  const [photos, setPhotos] = useState<PendingImage[]>([]);
  const inFlightUploads = useRef<Set<string>>(new Set());

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (priceType !== "custom") return;
    window.setTimeout(() => customPriceInputRef.current?.focus(), 0);
  }, [priceType]);

  useEffect(() => {
    if (willingToShip) {
      setShowShipHint(true);
      window.requestAnimationFrame(() => setShipHintVisible(true));
      return;
    }
    setShipHintVisible(false);
    const t = window.setTimeout(() => setShowShipHint(false), 250);
    return () => window.clearTimeout(t);
  }, [willingToShip]);

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((x) => x.id !== id));
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
        ...picked.map((f) => ({
          id: uid(),
          file: f,
          status: "ready" as const,
        })),
      ];
    });
  }

  const photoPreviews = useMemo(() => {
    return photos.map((img) => {
      const resolvedThumb = img.uploaded?.thumbUrl ? resolveImageUrl(img.uploaded.thumbUrl) : null;
      const resolvedFull = img.uploaded?.fullUrl ? resolveImageUrl(img.uploaded.fullUrl) : null;
      const resolvedMed = img.uploaded?.medUrl ? resolveImageUrl(img.uploaded.medUrl) : null;

      const localUrl = img.uploaded ? null : URL.createObjectURL(img.file);
      const src = resolvedThumb || resolvedFull || localUrl || "";
      const fullSrc = resolvedFull || resolvedMed || src;

      return {
        id: img.id,
        key: img.id,
        status: img.status,
        error: img.error,
        src,
        fullSrc,
        uploaded: !!img.uploaded,
        local: !img.uploaded && !!localUrl, // indicates src is an object URL we should revoke
      };
    });
  }, [photos]);

  useEffect(() => {
    const locals = photoPreviews.filter((p) => p.local).map((p) => p.src);
    return () => {
      for (const u of locals) URL.revokeObjectURL(u);
    };
  }, [photoPreviews]);

  const uploadOne = useCallback(async ({ id, file }: { id: string; file: File }) => {
    setPhotos((prev) => prev.map((x) => (x.id === id ? { ...x, status: "uploading", error: undefined } : x)));
    try {
      const asset = await uploadImage(file);
      setPhotos((prev) => prev.map((x) => (x.id === id ? { ...x, status: "uploaded", uploaded: asset } : x)));
      return asset;
    } catch (e: any) {
      const msg = e?.message ?? "Upload failed";
      setPhotos((prev) => prev.map((x) => (x.id === id ? { ...x, status: "error", error: msg } : x)));
      throw new Error(msg);
    }
  }, []);

  // Auto-upload newly added photos (no separate upload button).
  useEffect(() => {
    const ready = photos.filter((p) => p.status === "ready");
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
          // error already stored
        } finally {
          inFlightUploads.current.delete(p.id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [photos, uploadOne]);

  const isUploading = photos.some((p) => p.status === "uploading");

  const retryUpload = useCallback(
    async (id: string) => {
      const p = photos.find((x) => x.id === id);
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
    if (!photos.length) return;
    for (const p of photos) {
      if (p.status === "uploaded" && p.uploaded) continue;
      await uploadOne({ id: p.id, file: p.file }).catch(() => { });
    }
  }

  const canSubmit = !loading && !isUploading;

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

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  function openLightboxAt(idx: number) {
    setActivePhotoIdx(idx);
    setLightboxOpen(true);
  }

  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  const prevImage = useCallback(() => {
    setActivePhotoIdx((i) => (photoPreviews.length ? (i - 1 + photoPreviews.length) % photoPreviews.length : 0));
  }, [photoPreviews.length]);

  const nextImage = useCallback(() => {
    setActivePhotoIdx((i) => (photoPreviews.length ? (i + 1) % photoPreviews.length : 0));
  }, [photoPreviews.length]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") prevImage();
      if (e.key === "ArrowRight") nextImage();
    };
    window.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxOpen, closeLightbox, prevImage, nextImage]);

  function SortablePhotoCard(props: { p: (typeof photoPreviews)[number]; idx: number }) {
    const { p, idx } = props;
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

          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-lg bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-800 backdrop-blur pointer-events-none">
            <GripVertical aria-hidden="true" className="h-3.5 w-3.5" />
            <span>Drag</span>
          </div>

          {idx === 0 && (
            <div className="absolute bottom-2 left-2 rounded-full bg-slate-900/80 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
              Thumbnail
            </div>
          )}

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              removePhoto(p.id);
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

          <div className="absolute bottom-2 right-2 rounded-lg bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-700">
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    const priceCents = dollarsToCents(priceDollars);
    if (priceCents === null) {
      setErr("Please enter a valid non-negative price.");
      return;
    }

    const qty = Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
    if (qty < 1) {
      setErr("Quantity must be at least 1.");
      return;
    }

    const custom = customPriceText.trim();
    if (priceType === "custom" && !custom) {
      setErr("Please enter a custom price type (e.g. breeding pair).");
      return;
    }

    const detailsPrefix = buildSaleDetailsPrefix({ quantity: qty, priceType, customPriceText: custom, willingToShip });
    const maxBodyLen = Math.max(1, 1000 - detailsPrefix.length);
    if (description.trim().length > maxBodyLen) {
      setErr(`Description is too long. Max ${maxBodyLen} characters when sale details are included.`);
      return;
    }

    setLoading(true);
    try {
      if (photos.some((i) => i.status !== "uploaded")) {
        await uploadAllPending();
      }

      const uploadedAssets = photos
        .filter((i) => i.status === "uploaded" && i.uploaded)
        .map((i) => i.uploaded!)
        .slice(0, 6);

      if (photos.length > 0 && uploadedAssets.length === 0) {
        throw new Error("Images were selected but none uploaded successfully. Remove broken images or retry upload.");
      }

      const finalDescription = encodeSaleDetailsIntoDescription(
        { quantity: qty, priceType, customPriceText: custom, willingToShip },
        description
      );

      const created = await createListing({
        title: title.trim(),
        category,
        species: species.trim(),
        priceCents,
        location: location.trim(),
        description: finalDescription,
        contact: contact.trim() ? contact.trim() : null,
        images: uploadedAssets,
      });

      nav(`/listing/${created.id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to post listing");
    } finally {
      setLoading(false);
    }
  }

  const detailsPrefix = useMemo(
    () => buildSaleDetailsPrefix({ quantity, priceType, customPriceText, willingToShip }),
    [quantity, priceType, customPriceText, willingToShip]
  );
  const maxDescLen = Math.max(1, 1000 - detailsPrefix.length);

  return (
    <div className="min-h-full">
      <Header maxWidth="3xl" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-extrabold text-slate-900">Post a listing</h1>
        <div className="mt-1 text-sm text-slate-600">Add up to 6 photos.</div>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

        <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          {/* Images */}
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-900">Photos</div>
                <div className="text-xs text-slate-600">JPG / PNG / WebP up to 6MB each</div>
                <div className="text-xs text-slate-600">Drag to reorder. The first photo is used as the thumbnail.</div>
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

            {photoPreviews.length === 0 ? (
              <div className="mt-4 flex h-28 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-500">
                No photos
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={photoPreviews.map((x) => x.id)} strategy={rectSortingStrategy}>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {photoPreviews.map((p, idx) => (
                      <SortablePhotoCard key={p.key} p={p} idx={idx} />
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
              placeholder="e.g. Guppy trio - healthy stock"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-6">
            <label className="block sm:col-span-2">
              <div className="mb-1 text-xs font-semibold text-slate-700">Category</div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="block sm:col-span-3">
              <div className="mb-1 text-xs font-semibold text-slate-700">Species</div>
              <input
                value={species}
                onChange={(e) => setSpecies(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                required
                minLength={2}
                maxLength={60}
                placeholder="e.g. Betta splendens"
              />
            </label>

            {/* Spacer: keeps Species at 1/2 width while Category is 1/3 */}
            <div className="hidden sm:block sm:col-span-1" aria-hidden="true" />
          </div>

          {/* Row 2: Price + Quantity + Price type */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Price ($)</div>
              <input
                value={priceDollars}
                onChange={(e) => setPriceDollars(e.target.value)}
                inputMode="decimal"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                required
                placeholder="e.g. 25"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Quantity</div>
              <input
                value={String(quantity)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return setQuantity(1);
                  setQuantity(Math.max(1, Math.floor(n)));
                }}
                inputMode="numeric"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                required
              />
            </label>

            <div className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Price type</div>
              {priceType === "custom" ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={customPriceInputRef}
                    value={customPriceText}
                    onChange={(e) => setCustomPriceText(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    placeholder="e.g. breeding pair"
                    maxLength={80}
                  />
                  <button
                    type="button"
                    onClick={() => setPriceType("each")}
                    className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    title="Return to dropdown options"
                    aria-label="Return to dropdown options"
                  >
                    <Undo2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <select
                  value={priceType}
                  onChange={(e) => setPriceType(e.target.value as PriceType)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                >
                  <option value="each">Each</option>
                  <option value="all">All</option>
                  <option value="custom">Custom</option>
                </select>
              )}
            </div>
          </div>

          {/* Row 3: Location + Shipping */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Location</div>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                required
                minLength={2}
                maxLength={80}
                placeholder="e.g. Brisbane"
              />
            </label>

            <div className="grid sm:col-span-2">
              {/* Spacer so checkbox aligns with the input row (not the label row) */}
              <div className="mb-1 text-xs font-semibold text-transparent select-none" aria-hidden="true">
                Location
              </div>
              <div className="flex h-10 items-center">
                <div className="inline-flex items-center gap-1 min-w-0">
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 select-none">
                    <input type="checkbox" checked={willingToShip} onChange={(e) => setWillingToShip(e.target.checked)} />
                    Willing to ship
                  </label>
                  <ShippingInfoButton />
                  {showShipHint && (
                    <div
                      className={[
                        "ml-1 min-w-0 text-xs font-semibold text-slate-500 transition-opacity duration-250 ease-out",
                        shipHintVisible ? "opacity-100" : "opacity-0",
                      ].join(" ")}
                      aria-hidden={!shipHintVisible}
                    >
                      Ship safely.{" "}
                      <Link
                        to="/faq#fish-shipping"
                        tabIndex={shipHintVisible ? 0 : -1}
                        className="text-slate-700 underline underline-offset-2 hover:text-slate-900"
                      >
                        Fish shipping FAQ
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <label className="block">
            <div className="mb-1 text-xs font-semibold text-slate-700">Contact (optional)</div>
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="e.g. phone, email, or 'DM here'"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              maxLength={200}
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
              maxLength={maxDescLen}
              placeholder="Add details like age/size, water params, pickup, etc."
            />
            <div className="mt-1 text-[11px] font-semibold text-slate-500">
              ({description.trim().length}/{maxDescLen})
            </div>
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {loading ? "Posting..." : isUploading ? "Uploading..." : "Post listing"}
            </button>

            <Link
              to="/"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Cancel
            </Link>
          </div>
        </form>

        {lightboxOpen && photoPreviews.length > 0 && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Photo viewer"
            onClick={closeLightbox}
          >
            <button
              type="button"
              className="absolute right-4 top-4 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20"
              onClick={(e) => {
                e.stopPropagation();
                closeLightbox();
              }}
            >
              Close
            </button>

            <button
              type="button"
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20"
              onClick={(e) => {
                e.stopPropagation();
                prevImage();
              }}
              aria-label="Previous photo"
              title="Previous"
            >
              <ChevronLeft aria-hidden="true" className="h-5 w-5" />
            </button>

            <div className="mx-auto max-h-[85vh] w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
              <img
                src={photoPreviews[activePhotoIdx]?.fullSrc}
                alt={`photo-${activePhotoIdx + 1}`}
                className="mx-auto max-h-[85vh] w-auto max-w-full rounded-2xl object-contain"
                draggable={false}
              />
              <div className="mt-3 text-center text-xs font-semibold text-white/80">
                {activePhotoIdx + 1} / {photoPreviews.length}
              </div>
            </div>

            <button
              type="button"
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20"
              onClick={(e) => {
                e.stopPropagation();
                nextImage();
              }}
              aria-label="Next photo"
              title="Next"
            >
              <ChevronRight aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
