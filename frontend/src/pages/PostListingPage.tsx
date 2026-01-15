// frontend/src/pages/PostListingPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, GripVertical, Maximize2, Undo2, X } from "lucide-react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createListing,
  getListingOptionsCached,
  uploadImage,
  resolveImageUrl,
  type Category,
  type ImageAsset,
  type ListingSex,
  type WaterType,
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

const MAX_CUSTOM_PRICE_TYPE_LEN = 20;

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
    if (!user) nav(`/auth?next=${encodeURIComponent("/post/listing")}&ctx=create_listing`);
  }, [authLoading, user, nav]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [sexes, setSexes] = useState<ListingSex[]>([]);
  const [waterTypes, setWaterTypes] = useState<WaterType[]>([]);
  const [bioRequiredCategories, setBioRequiredCategories] = useState<Set<string>>(new Set());
  const [otherCategoryName, setOtherCategoryName] = useState("Other");

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("");
  const [species, setSpecies] = useState("");
  const [sex, setSex] = useState<ListingSex | "">("");
  const [waterType, setWaterType] = useState<WaterType | "">("");
  const [priceDollars, setPriceDollars] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [priceType, setPriceType] = useState<PriceType>("each");
  const [customPriceText, setCustomPriceText] = useState("");
  const [willingToShip, setWillingToShip] = useState(false);
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [description, setDescription] = useState("");

  const customPriceInputRef = useRef<HTMLInputElement | null>(null);
  const [showShipHint, setShowShipHint] = useState(false);
  const [shipHintVisible, setShipHintVisible] = useState(false);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

  const [photos, setPhotos] = useState<PendingImage[]>([]);
  const inFlightUploads = useRef<Set<string>>(new Set());

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  type FieldKey =
    | "title"
    | "category"
    | "species"
    | "waterType"
    | "sex"
    | "price"
    | "quantity"
    | "priceType"
    | "customPriceText"
    | "location"
    | "phone"
    | "description";
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});

  const isOtherCategory = String(category) === String(otherCategoryName);
  const bioFieldsRequired = bioRequiredCategories.has(String(category));
  const bioFieldsDisabled = Boolean(category) && !bioFieldsRequired && !isOtherCategory;
  const bioFieldsEnabled = !bioFieldsDisabled;

  useEffect(() => {
    // If category is non-living (equipment/accessories/services), clear + disable bio fields.
    if (!category) return;
    if (!bioFieldsDisabled) return;
    setSpecies("");
    setSex("");
    setWaterType("");
    clearFieldError("species");
    clearFieldError("sex");
    clearFieldError("waterType");
  }, [category, bioFieldsDisabled]);

  useEffect(() => {
    let cancelled = false;
    getListingOptionsCached()
      .then((opts) => {
        if (cancelled) return;
        setCategories(opts.categories as Category[]);
        setSexes(opts.listingSexes as ListingSex[]);
        setWaterTypes((opts as any).waterTypes as WaterType[]);
        setBioRequiredCategories(new Set(((opts as any).bioFieldsRequiredCategories as string[]) ?? []));
        setOtherCategoryName(String((opts as any).otherCategory ?? "Other"));
      })
      .catch(() => {
        // ignore; backend will validate on submit
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function clearFieldError(k: FieldKey) {
    setFieldErrors((prev) => {
      if (!prev[k]) return prev;
      return { ...prev, [k]: undefined };
    });
  }

  useEffect(() => {
    if (priceType !== "custom") return;
    window.setTimeout(() => customPriceInputRef.current?.focus(), 0);
  }, [priceType]);

  const resizeDescription = useCallback((el?: HTMLTextAreaElement | null) => {
    const t = el ?? descriptionRef.current;
    if (!t) return;
    // Auto-grow based on content; reset to auto first so it can shrink too.
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
    setFieldErrors({});

    const nextErrors: Partial<Record<FieldKey, string>> = {};
    if (!title.trim()) nextErrors.title = "Required field";
    if (!category) nextErrors.category = "Required field";
    if (bioFieldsRequired && !species.trim()) nextErrors.species = "Required field";
    if (bioFieldsRequired && !waterType) nextErrors.waterType = "Required field";
    if (bioFieldsRequired && !sex) nextErrors.sex = "Required field";
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

    const body = String(description ?? "").trim();

    // Length check (only if we have enough info to construct the details block).
    if (!nextErrors.description && !nextErrors.customPriceText && priceCents !== null) {
      const detailsPrefix = buildSaleDetailsPrefix({ quantity: qty, priceType, customPriceText: custom, willingToShip });
      const maxBodyLen = Math.max(1, 1000 - detailsPrefix.length);
      if (body.trim().length > maxBodyLen) {
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
    if (bioFieldsRequired && !sex) return;
    const sexToSubmit: ListingSex = ((bioFieldsEnabled && sex ? sex : "Unknown") as ListingSex) ?? "Unknown";
    const speciesToSubmit = bioFieldsEnabled ? species.trim() : "";

    if (photos.length === 0) {
      const ok = window.confirm("You haven't added any photos. Post this listing without photos?");
      if (!ok) return;
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

      const finalDescription = encodeSaleDetailsIntoDescription({ quantity: qty, priceType, customPriceText: custom, willingToShip }, body);

      const created = await createListing({
        title: title.trim(),
        category,
        species: speciesToSubmit,
        sex: sexToSubmit,
        waterType: bioFieldsEnabled && waterType ? waterType : null,
        priceCents,
        location: location.trim(),
        description: finalDescription,
        phone: phoneTrim,
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
        <div className="mt-1 text-sm text-slate-600">Add details, photos, and pricing to publish your listing.</div>

        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
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
            />
            {fieldErrors.title && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.title}</div>}
          </label>

          <div className="grid gap-3 sm:grid-cols-10">
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
                required
              >
                {!categories.length ? (
                  <option value="" disabled>
                    Loading…
                  </option>
                ) : (
                  <>
                    <option value="" disabled hidden>
                      Select…
                    </option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </>
                )}
              </select>
              {fieldErrors.category && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.category}</div>}
            </label>

            <label className="block sm:col-span-4">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.species ? "text-red-700" : "text-slate-700"].join(" ")}>
                Species {bioFieldsRequired && <span className="text-red-600">*</span>}
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
                  "disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed",
                ].join(" ")}
                required={bioFieldsRequired}
                disabled={bioFieldsDisabled}
                minLength={2}
                maxLength={60}
              />
              {fieldErrors.species && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.species}</div>}
            </label>

            <label className="block sm:col-span-2">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.waterType ? "text-red-700" : "text-slate-700"].join(" ")}>
                Water type {bioFieldsRequired && <span className="text-red-600">*</span>}
              </div>
              <select
                value={waterType}
                onChange={(e) => {
                  setWaterType(e.target.value as WaterType);
                  clearFieldError("waterType");
                }}
                className={[
                  "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  fieldErrors.waterType ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  "disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed",
                ].join(" ")}
                required={bioFieldsRequired}
                disabled={bioFieldsDisabled}
              >
                <option value="" disabled hidden>
                  Select…
                </option>
                {waterTypes.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
              {fieldErrors.waterType && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.waterType}</div>}
            </label>

            <label className="block sm:col-span-2">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.sex ? "text-red-700" : "text-slate-700"].join(" ")}>
                Sex {bioFieldsRequired && <span className="text-red-600">*</span>}
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
                  "disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed",
                ].join(" ")}
                required={bioFieldsRequired}
                disabled={bioFieldsDisabled}
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
