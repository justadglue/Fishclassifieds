import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Check, GripVertical, Maximize2, Pause, Play, Trash2, Undo2, X } from "lucide-react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  deleteListing,
  fetchListing,
  createListing,
  getListingOptionsCached,
  resolveImageUrl,
  updateListing,
  uploadImage,
  pauseListing,
  resumeListing,
  markSold,
  type Category,
  type Listing,
  type ImageAsset,
  type ListingSex,
} from "../api";
import Header from "../components/Header";
import { useAuth } from "../auth";
import {
  buildSaleDetailsPrefix,
  decodeSaleDetailsFromDescription,
  encodeSaleDetailsIntoDescription,
  type PriceType,
} from "../utils/listingDetailsBlock";
import ShippingInfoButton from "../components/ShippingInfoButton";

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

const MAX_CUSTOM_PRICE_TYPE_LEN = 20;

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

  const [categories, setCategories] = useState<Category[]>([]);
  const [sexes, setSexes] = useState<ListingSex[]>([]);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("");
  const [species, setSpecies] = useState("");
  const [sex, setSex] = useState<ListingSex | "">("");
  const [priceDollars, setPriceDollars] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [priceType, setPriceType] = useState<PriceType>("each");
  const [customPriceText, setCustomPriceText] = useState("");
  const [willingToShip, setWillingToShip] = useState(false);
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    let cancelled = false;
    getListingOptionsCached()
      .then((opts) => {
        if (cancelled) return;
        setCategories(opts.categories as Category[]);
        setSexes(opts.listingSexes as ListingSex[]);
      })
      .catch(() => {
        // ignore; backend will validate on save
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const customPriceInputRef = useRef<HTMLInputElement | null>(null);
  const [showShipHint, setShowShipHint] = useState(false);
  const [shipHintVisible, setShipHintVisible] = useState(false);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

  const [photos, setPhotos] = useState<PhotoItem[]>([]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  type FieldKey =
    | "title"
    | "category"
    | "species"
    | "sex"
    | "price"
    | "quantity"
    | "priceType"
    | "customPriceText"
    | "location"
    | "phone"
    | "description";
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});

  function clearFieldError(k: FieldKey) {
    setFieldErrors((prev) => {
      if (!prev[k]) return prev;
      return { ...prev, [k]: undefined };
    });
  }

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  const inFlightUploads = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      nav(`/auth?next=${encodeURIComponent(`/edit/${id ?? ""}`)}&ctx=edit_listing`);
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
        setSex(l.sex ?? "");
        setPriceDollars(centsToDollarsString(l.priceCents));
        setLocation(l.location);
        setPhone(l.phone ?? "");
        const decoded = decodeSaleDetailsFromDescription(l.description);
        setQuantity(decoded.details.quantity);
        setPriceType(decoded.details.priceType);
        setCustomPriceText(decoded.details.customPriceText);
        setWillingToShip(decoded.details.willingToShip);
        setDescription(decoded.body);
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

  useEffect(() => {
    if (priceType !== "custom") return;
    // Avoid focusing a disabled input while the page is still loading.
    if (loading) return;
    window.setTimeout(() => customPriceInputRef.current?.focus(), 0);
  }, [priceType, loading]);

  const resizeDescription = useCallback((el?: HTMLTextAreaElement | null) => {
    const t = el ?? descriptionRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resizeDescription();
  }, [description, resizeDescription]);

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
    setFieldErrors({});

    const nextErrors: Partial<Record<FieldKey, string>> = {};
    if (!title.trim()) nextErrors.title = "Required field";
    if (!category) nextErrors.category = "Required field";
    if (!species.trim()) nextErrors.species = "Required field";
    if (!sex) nextErrors.sex = "Required field";
    if (!location.trim()) nextErrors.location = "Required field";

    const phoneTrim = phone.trim();
    if (!phoneTrim) nextErrors.phone = "Required field";
    else if (phoneTrim.length < 6) nextErrors.phone = "Phone number looks too short.";
    else if (phoneTrim.length > 30) nextErrors.phone = "Phone number is too long.";

    const priceCents = dollarsToCents(priceDollars);
    if (priceCents === null) nextErrors.price = "Please enter a valid non-negative price.";

    const qty = Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
    if (qty < 1) nextErrors.quantity = "Quantity must be at least 1.";

    if (!priceType) nextErrors.priceType = "Required field";
    const custom = customPriceText.trim();
    if (priceType === "custom" && !custom) nextErrors.customPriceText = "Required field";
    else if (priceType === "custom" && custom.length > MAX_CUSTOM_PRICE_TYPE_LEN) {
      nextErrors.customPriceText = `Custom price type must be ${MAX_CUSTOM_PRICE_TYPE_LEN} characters or less.`;
    }

    if (!description.trim()) nextErrors.description = "Required field";

    if (!nextErrors.description && !nextErrors.customPriceText && priceCents !== null && sex) {
      const detailsPrefix = buildSaleDetailsPrefix({ quantity: qty, priceType, customPriceText: custom, willingToShip });
      const maxBodyLen = Math.max(1, 1000 - detailsPrefix.length);
      if (description.trim().length > maxBodyLen) {
        nextErrors.description = `Description is too long. Max ${maxBodyLen} characters when sale details are included.`;
      }
    }

    if (Object.values(nextErrors).some(Boolean)) {
      setFieldErrors(nextErrors);
      setErr("Please fill out the required fields.");
      return;
    }
    // Narrow types for TS (should be unreachable due to validation above).
    if (priceCents === null) return;
    if (!sex) return;

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

      if (merged.length === 0) {
        const ok = window.confirm("You haven't added any photos. Update this listing without photos?");
        if (!ok) return;
      }

      if (relistMode) {
        // Relist: do not modify anything until user clicks Update listing.
        // Create a brand new listing (active/pending depending on server config), then archive the sold one.
        const finalDescription = encodeSaleDetailsIntoDescription({ quantity: qty, priceType, customPriceText: custom, willingToShip }, description);
        const created = await createListing({
          title: title.trim(),
          category,
          species: species.trim(),
          sex: sex as ListingSex,
          priceCents,
          location: location.trim(),
          description: finalDescription,
          phone: phoneTrim,
          images: merged,
          status: "active",
        });

        await deleteListing(id);
        nav(`/listing/${created.id}`);
        return;
      }

      const finalDescription = encodeSaleDetailsIntoDescription({ quantity: qty, priceType, customPriceText: custom, willingToShip }, description);
      const updated = await updateListing(id, {
        title: title.trim(),
        category,
        species: species.trim(),
        sex: sex as ListingSex,
        priceCents,
        location: location.trim(),
        description: finalDescription,
        phone: phoneTrim,
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
    setSex(l.sex ?? "");
    setPriceDollars(centsToDollarsString(l.priceCents));
    setLocation(l.location);
    setPhone(l.phone ?? "");
    const decoded = decodeSaleDetailsFromDescription(l.description);
    setQuantity(decoded.details.quantity);
    setPriceType(decoded.details.priceType);
    setCustomPriceText(decoded.details.customPriceText);
    setWillingToShip(decoded.details.willingToShip);
    setDescription(decoded.body);
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
  const detailsPrefix = useMemo(
    () => buildSaleDetailsPrefix({ quantity, priceType, customPriceText, willingToShip }),
    [quantity, priceType, customPriceText, willingToShip]
  );
  const maxDescLen = Math.max(1, 1000 - detailsPrefix.length);

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
  }) {
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

        {err && !orig && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

        {loading && !orig && <div className="mt-4 text-sm text-slate-600">Loading...</div>}

        {orig && (
          <form onSubmit={onSave} noValidate className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
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
                        <SortablePhotoCard key={p.id} p={p} idx={idx} />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>

            {/* Fields */}
            <label className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.title ? "text-red-700" : "text-slate-700"].join(" ")}>
                Title <span className="text-red-600">*</span>
              </div>
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  clearFieldError("title");
                }}
                className={[
                  "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  fieldErrors.title ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
                required
                minLength={3}
                maxLength={80}
                disabled={loading}
              />
              {fieldErrors.title && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.title}</div>}
            </label>

            <div className="grid gap-3 sm:grid-cols-6">
              <label className="block sm:col-span-2">
                <div className={["mb-1 text-xs font-semibold", fieldErrors.category ? "text-red-700" : "text-slate-700"].join(" ")}>
                  Category <span className="text-red-600">*</span>
                </div>
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value as Category);
                    clearFieldError("category");
                  }}
                  className={[
                    "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                    fieldErrors.category ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  ].join(" ")}
                  disabled={loading}
                  required
                >
                  {!categories.length ? (
                    <option value="" disabled>
                      Loading…
                    </option>
                  ) : (
                    categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))
                  )}
                </select>
                {fieldErrors.category && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.category}</div>}
              </label>

              <label className="block sm:col-span-3">
                <div className={["mb-1 text-xs font-semibold", fieldErrors.species ? "text-red-700" : "text-slate-700"].join(" ")}>
                  Species <span className="text-red-600">*</span>
                </div>
                <input
                  value={species}
                  onChange={(e) => {
                    setSpecies(e.target.value);
                    clearFieldError("species");
                  }}
                  className={[
                    "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                    fieldErrors.species ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  ].join(" ")}
                  required
                  minLength={2}
                  maxLength={60}
                  disabled={loading}
                />
                {fieldErrors.species && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.species}</div>}
              </label>

              <label className="block sm:col-span-1">
                <div className={["mb-1 text-xs font-semibold", fieldErrors.sex ? "text-red-700" : "text-slate-700"].join(" ")}>
                  Sex <span className="text-red-600">*</span>
                </div>
                <select
                  value={sex}
                  onChange={(e) => {
                    setSex(e.target.value as ListingSex);
                    clearFieldError("sex");
                  }}
                  className={[
                    "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                    fieldErrors.sex ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  ].join(" ")}
                  disabled={loading}
                  required
                >
                  <option value="" disabled hidden>
                    Select…
                  </option>
                  {!sexes.length ? (
                    <option value="" disabled>
                      Loading…
                    </option>
                  ) : (
                    sexes.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))
                  )}
                </select>
                {fieldErrors.sex && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.sex}</div>}
              </label>
            </div>

            {/* Row 2: Price + Quantity + Price type */}
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <div className={["mb-1 text-xs font-semibold", fieldErrors.price ? "text-red-700" : "text-slate-700"].join(" ")}>
                  Price ($) <span className="text-red-600">*</span>
                </div>
                <input
                  value={priceDollars}
                  onChange={(e) => {
                    setPriceDollars(e.target.value);
                    clearFieldError("price");
                  }}
                  inputMode="decimal"
                  className={[
                    "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                    fieldErrors.price ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  ].join(" ")}
                  required
                  disabled={loading}
                />
                {fieldErrors.price && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.price}</div>}
              </label>

              <label className="block">
                <div className={["mb-1 text-xs font-semibold", fieldErrors.quantity ? "text-red-700" : "text-slate-700"].join(" ")}>
                  Quantity <span className="text-red-600">*</span>
                </div>
                <input
                  value={String(quantity)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return setQuantity(1);
                    setQuantity(Math.max(1, Math.floor(n)));
                    clearFieldError("quantity");
                  }}
                  inputMode="numeric"
                  className={[
                    "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                    fieldErrors.quantity ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  ].join(" ")}
                  required
                  disabled={loading}
                />
                {fieldErrors.quantity && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.quantity}</div>}
              </label>

              <div className="block">
                <div className={["mb-1 text-xs font-semibold", fieldErrors.priceType || fieldErrors.customPriceText ? "text-red-700" : "text-slate-700"].join(" ")}>
                  Price type <span className="text-red-600">*</span>
                </div>
                {priceType === "custom" ? (
                  <div className="relative">
                    <div className="flex items-center gap-2">
                      <input
                        ref={customPriceInputRef}
                        value={customPriceText}
                        onChange={(e) => {
                          setCustomPriceText(e.target.value);
                          clearFieldError("customPriceText");
                          clearFieldError("priceType");
                        }}
                        className={[
                          "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                          fieldErrors.customPriceText ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                        ].join(" ")}
                        placeholder="e.g. breeding pair"
                        maxLength={MAX_CUSTOM_PRICE_TYPE_LEN}
                        disabled={loading}
                      />
                      <button
                        type="button"
                        onClick={() => setPriceType("each")}
                        className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        title="Return to dropdown options"
                        aria-label="Return to dropdown options"
                        disabled={loading}
                      >
                        <Undo2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>
                    {/* Absolutely position into the vertical gap so layout doesn't shift */}
                    <div className="pointer-events-none absolute left-0 top-full text-[11px] leading-4 font-semibold text-slate-500">
                      ({customPriceText.trim().length}/{MAX_CUSTOM_PRICE_TYPE_LEN})
                    </div>
                    {fieldErrors.customPriceText && (
                      <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.customPriceText}</div>
                    )}
                  </div>
                ) : (
                  <select
                    value={priceType}
                    onChange={(e) => {
                      setPriceType(e.target.value as PriceType);
                      clearFieldError("priceType");
                    }}
                    className={[
                      "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                      fieldErrors.priceType ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                    ].join(" ")}
                    disabled={loading}
                    required
                  >
                    <option value="each">Each</option>
                    <option value="all">All</option>
                    <option value="custom">Custom</option>
                  </select>
                )}
                {fieldErrors.priceType && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.priceType}</div>}
              </div>
            </div>

            {/* Row 3: Location + Shipping */}
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <div className={["mb-1 text-xs font-semibold", fieldErrors.location ? "text-red-700" : "text-slate-700"].join(" ")}>
                  Location <span className="text-red-600">*</span>
                </div>
                <input
                  value={location}
                  onChange={(e) => {
                    setLocation(e.target.value);
                    clearFieldError("location");
                  }}
                  className={[
                    "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                    fieldErrors.location ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  ].join(" ")}
                  required
                  minLength={2}
                  maxLength={80}
                  disabled={loading}
                />
                {fieldErrors.location && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.location}</div>}
              </label>

              <div className="grid sm:col-span-2">
                {/* Spacer so checkbox aligns with the input row (not the label row) */}
                <div className="mb-1 text-xs font-semibold text-transparent select-none" aria-hidden="true">
                  Location
                </div>
                <div className="flex h-10 items-center">
                  <div className="inline-flex items-center gap-1 min-w-0">
                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 select-none">
                      <input
                        type="checkbox"
                        checked={willingToShip}
                        onChange={(e) => setWillingToShip(e.target.checked)}
                        disabled={loading}
                      />
                      Willing to ship
                    </label>
                    <ShippingInfoButton disabled={loading} />
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

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block sm:col-span-1">
                <div className={["mb-1 text-xs font-semibold", fieldErrors.phone ? "text-red-700" : "text-slate-700"].join(" ")}>
                  Phone number <span className="text-red-600">*</span>
                </div>
                <input
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    clearFieldError("phone");
                  }}
                  inputMode="tel"
                  autoComplete="tel"
                  className={[
                    "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                    fieldErrors.phone ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  ].join(" ")}
                  required
                  minLength={6}
                  maxLength={30}
                  disabled={loading}
                />
                {fieldErrors.phone && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.phone}</div>}
              </label>
              <div className="hidden sm:block sm:col-span-2" aria-hidden="true" />
            </div>

            <label className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.description ? "text-red-700" : "text-slate-700"].join(" ")}>
                Description <span className="text-red-600">*</span>
              </div>
              <textarea
                ref={descriptionRef}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  resizeDescription(e.currentTarget);
                  clearFieldError("description");
                }}
                onInput={(e) => resizeDescription(e.currentTarget as HTMLTextAreaElement)}
                className={[
                  "min-h-[140px] w-full resize-none overflow-hidden rounded-xl border px-3 py-2 text-sm outline-none",
                  fieldErrors.description ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
                required
                minLength={1}
                maxLength={maxDescLen}
                disabled={loading}
              />
              {fieldErrors.description && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.description}</div>}
              <div className="mt-1 text-[11px] font-semibold text-slate-500">
                ({description.trim().length}/{maxDescLen})
              </div>
            </label>

            {err && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

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
