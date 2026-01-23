import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { ChevronLeft, ChevronRight, GripVertical, Maximize2, X } from "lucide-react";
import { DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MAX_UPLOAD_IMAGE_BYTES, MAX_UPLOAD_IMAGE_MB, resolveImageUrl, uploadImage, type ImageAsset } from "../api";

type PendingItem = {
  kind: "pending";
  id: string;
  file: File;
  status: "ready" | "uploading" | "uploaded" | "error";
  uploaded?: ImageAsset;
  error?: string;
};

type ExistingItem = {
  kind: "existing";
  id: string;
  asset: ImageAsset;
};

type Item = PendingItem | ExistingItem;

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export type PhotoUploaderHandle = {
  ensureUploaded: () => Promise<void>;
  getAssets: () => ImageAsset[];
  getCounts: () => { total: number; uploaded: number };
};

type PhotoUploaderChange = {
  total: number;
  uploaded: number;
  assets: ImageAsset[];
  /**
   * A stable, order-sensitive key representing the current photo list.
   * - Existing photos use their `fullUrl`
   * - Pending (not-yet-uploaded) photos use a `pending:<id>` placeholder
   */
  itemsKey: string;
};

type PhotoUploaderProps = {
  initialAssets?: ImageAsset[];
  disabled?: boolean;
  maxCount?: number;
  onChange?: (next: PhotoUploaderChange) => void;
};

export default forwardRef<PhotoUploaderHandle, PhotoUploaderProps>(
  function PhotoUploader(props, ref) {
    const maxCount = props.maxCount ?? 6;
    const [items, setItems] = useState<Item[]>(() =>
      (props.initialAssets ?? []).slice(0, maxCount).map((a, idx) => ({ kind: "existing", id: `existing-${idx}-${a.fullUrl}`, asset: a }))
    );

    // Keep in sync when initial assets change (edit page fetch).
    useEffect(() => {
      const next = (props.initialAssets ?? []).slice(0, maxCount).map((a, idx) => ({
        kind: "existing" as const,
        id: `existing-${idx}-${a.fullUrl}`,
        asset: a,
      }));
      setItems(next);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [maxCount, (props.initialAssets ?? []).map((a) => a.fullUrl).join("|")]);

    const [photoErr, setPhotoErr] = useState<string | null>(null);
    const photosBoxRef = useRef<HTMLDivElement | null>(null);
    const inFlightUploads = useRef<Set<string>>(new Set());
    const [dragging, setDragging] = useState(false);

    const [isCoarsePointer, setIsCoarsePointer] = useState(() => {
      // Mobile/touch-ish detection: no hover + coarse pointer is a good proxy.
      if (typeof window === "undefined") return false;
      return window.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches ?? false;
    });

    useEffect(() => {
      if (typeof window === "undefined") return;
      const mq = window.matchMedia?.("(hover: none) and (pointer: coarse)");
      if (!mq) return;
      const onChange = () => setIsCoarsePointer(mq.matches);
      onChange();
      // Safari uses addListener/removeListener
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
      }
      mq.addListener(onChange);
      return () => mq.removeListener(onChange);
    }, []);

    const sensors = useSensors(
      useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
      useSensor(TouchSensor, {
        activationConstraint: isCoarsePointer
          ? // Press-and-hold to start dragging (lets users scroll the page normally).
            { delay: 350, tolerance: 6 }
          : // If a touch device reports fine pointer, fall back to distance.
            { distance: 6 },
      })
    );

    const photoPreviews = useMemo(() => {
      return items.map((p, idx) => {
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
        const resolvedMed = uploaded?.medUrl ? resolveImageUrl(uploaded.medUrl) : null;
        const localUrl = uploaded ? null : URL.createObjectURL(p.file);
        const src = resolvedThumb || resolvedFull || localUrl || "";
        const fullSrc = resolvedFull || resolvedMed || src;
        return {
          id: p.id,
          key: p.id,
          kind: "pending" as const,
          idx,
          status: p.status,
          src,
          fullSrc,
          local: !uploaded && !!localUrl,
          error: p.error,
        };
      });
    }, [items]);

    useEffect(() => {
      const locals = photoPreviews.filter((p) => p.local).map((p) => p.src);
      return () => {
        for (const u of locals) URL.revokeObjectURL(u);
      };
    }, [photoPreviews]);

    useEffect(() => {
      if (!photoErr) return;
      function onDocPointerDown(e: MouseEvent | TouchEvent) {
        const target = e.target;
        if (!(target instanceof Node)) return;
        const box = photosBoxRef.current;
        if (!box) return;
        if (box.contains(target)) return;
        setPhotoErr(null);
      }
      document.addEventListener("mousedown", onDocPointerDown);
      document.addEventListener("touchstart", onDocPointerDown, { passive: true });
      return () => {
        document.removeEventListener("mousedown", onDocPointerDown);
        document.removeEventListener("touchstart", onDocPointerDown as any);
      };
    }, [photoErr]);

    const uploadOne = useCallback(async (id: string, file: File) => {
      setItems((prev) =>
        prev.map((x) => (x.kind === "pending" && x.id === id ? { ...x, status: "uploading", error: undefined } : x))
      );
      try {
        const asset = await uploadImage(file);
        setItems((prev) =>
          prev.map((x) => (x.kind === "pending" && x.id === id ? { ...x, status: "uploaded", uploaded: asset } : x))
        );
        return asset;
      } catch (e: any) {
        const raw = e?.message ?? "Upload failed";
        const msg =
          String(raw).includes("File too large")
            ? `File size (${(file.size / 1024 / 1024).toFixed(1)}MB) too large. Please upload a smaller file.`
            : raw;
        if (String(raw).includes("File too large")) setPhotoErr(msg);
        setItems((prev) =>
          prev.map((x) => (x.kind === "pending" && x.id === id ? { ...x, status: "error", error: msg } : x))
        );
        throw new Error(msg);
      }
    }, []);

    // Auto-upload ready photos.
    useEffect(() => {
      const ready = items.filter((p) => p.kind === "pending" && p.status === "ready") as PendingItem[];
      if (!ready.length) return;
      let cancelled = false;
      (async () => {
        for (const p of ready) {
          if (cancelled) return;
          if (inFlightUploads.current.has(p.id)) continue;
          inFlightUploads.current.add(p.id);
          try {
            await uploadOne(p.id, p.file);
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
    }, [items, uploadOne]);

    const ensureUploaded = useCallback(async () => {
      const pending = items.filter((p) => p.kind === "pending") as PendingItem[];
      for (const p of pending) {
        if (p.status === "uploaded" && p.uploaded) continue;
        if (inFlightUploads.current.has(p.id)) continue;
        inFlightUploads.current.add(p.id);
        try {
          await uploadOne(p.id, p.file).catch(() => { });
        } finally {
          inFlightUploads.current.delete(p.id);
        }
      }
    }, [items, uploadOne]);

    const uploadedAssets = useMemo(() => {
      return items
        .map((p) => {
          if (p.kind === "existing") return p.asset;
          if (p.status === "uploaded" && p.uploaded) return p.uploaded;
          return null;
        })
        .filter((x): x is ImageAsset => !!x)
        .slice(0, maxCount);
    }, [items, maxCount]);

    const itemsKey = useMemo(() => {
      return items
        .map((p) => {
          if (p.kind === "existing") return `existing:${p.asset.fullUrl}`;
          if (p.status === "uploaded" && p.uploaded) return `uploaded:${p.uploaded.fullUrl}`;
          return `pending:${p.id}`;
        })
        .join("|");
    }, [items]);

    useEffect(() => {
      props.onChange?.({
        total: items.length,
        uploaded: uploadedAssets.length,
        assets: uploadedAssets,
        itemsKey,
      });
    }, [props, items.length, uploadedAssets, itemsKey]);

    useImperativeHandle(
      ref,
      () => ({
        ensureUploaded,
        getAssets: () => uploadedAssets,
        getCounts: () => ({ total: items.length, uploaded: uploadedAssets.length }),
      }),
      [ensureUploaded, items.length, uploadedAssets]
    );

    function onPickFiles(nextFiles: FileList | null) {
      setPhotoErr(null);
      if (!nextFiles) return;
      const all = Array.from(nextFiles);
      const tooLarge = all.filter((f) => f.size > MAX_UPLOAD_IMAGE_BYTES);
      if (tooLarge.length) {
        const maxBytes = Math.max(...tooLarge.map((f) => f.size));
        const mb = (maxBytes / 1024 / 1024).toFixed(1);
        setPhotoErr(`File size (${mb}MB) too large. Please upload a smaller file.`);
      }

      setItems((prev) => {
        const room = Math.max(0, maxCount - prev.length);
        const picked = all.filter((f) => f.size <= MAX_UPLOAD_IMAGE_BYTES).slice(0, room);
        if (!picked.length) return prev;
        return [...prev, ...picked.map((f) => ({ kind: "pending" as const, id: uid(), file: f, status: "ready" as const }))];
      });
    }

    function removePhoto(id: string) {
      setItems((prev) => prev.filter((x) => x.id !== id));
    }

    const retryUpload = useCallback(
      async (id: string) => {
        const p = items.find((x) => x.kind === "pending" && x.id === id) as PendingItem | undefined;
        if (!p) return;
        if (inFlightUploads.current.has(p.id)) return;
        inFlightUploads.current.add(p.id);
        try {
          await uploadOne(p.id, p.file);
        } catch {
          // error already stored
        } finally {
          inFlightUploads.current.delete(p.id);
        }
      },
      [items, uploadOne]
    );

    function onDragEnd(e: any) {
      const activeId = String(e.active?.id ?? "");
      const overId = e.over?.id ? String(e.over.id) : null;
      if (!activeId || !overId || activeId === overId) return;
      setItems((prev) => {
        const oldIndex = prev.findIndex((p) => p.id === activeId);
        const newIndex = prev.findIndex((p) => p.id === overId);
        if (oldIndex < 0 || newIndex < 0) return prev;
        return arrayMove(prev, oldIndex, newIndex);
      });
    }

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
            // Allow vertical page scrolling until a drag actually starts; once dragging, disable touch panning
            // so the browser doesn't steal the gesture.
            "overflow-hidden rounded-2xl border bg-white select-none",
            dragging ? "touch-none" : "touch-pan-y",
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

    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [activePhotoIdx, setActivePhotoIdx] = useState(0);
    const hasMultiple = photoPreviews.length > 1;

    function closeLightbox() {
      setLightboxOpen(false);
    }

    function openLightboxAt(idx: number) {
      setActivePhotoIdx(Math.max(0, Math.min(photoPreviews.length - 1, idx)));
      setLightboxOpen(true);
    }

    const prevImage = useCallback(() => {
      if (!hasMultiple) return;
      setActivePhotoIdx((i) => (i - 1 + photoPreviews.length) % photoPreviews.length);
    }, [hasMultiple, photoPreviews.length]);

    const nextImage = useCallback(() => {
      if (!hasMultiple) return;
      setActivePhotoIdx((i) => (i + 1) % photoPreviews.length);
    }, [hasMultiple, photoPreviews.length]);

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

    return (
      <>
        <div ref={photosBoxRef} className="rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-slate-900">Photos</div>
              <div className="text-xs text-slate-600">
                Up to {maxCount} photos. Max {MAX_UPLOAD_IMAGE_MB}MB each.
              </div>
              <div className="text-xs text-slate-600">
                {isCoarsePointer ? "Press and hold to reorder. " : "Drag to reorder. "}
                The first photo is used as the thumbnail.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label
                className={[
                  "cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50",
                  props.disabled ? "pointer-events-none opacity-60" : "",
                ].join(" ")}
              >
                Add photos
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={props.disabled}
                  onChange={(e) => {
                    onPickFiles(e.target.files);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          </div>

          {photoPreviews.length === 0 ? (
            <div className="mt-4 flex h-28 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-500">
              No images
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={() => setDragging(true)}
              onDragCancel={() => setDragging(false)}
              onDragEnd={(e) => {
                setDragging(false);
                onDragEnd(e);
              }}
            >
              <SortableContext items={photoPreviews.map((x) => x.id)} strategy={rectSortingStrategy}>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {photoPreviews.map((p, idx) => (
                    <SortablePhotoCard key={p.key} p={p} idx={idx} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {photoErr ? (
            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">{photoErr}</div>
          ) : null}
        </div>

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
              <div className="relative w-full max-w-7xl">
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

                {hasMultiple ? (
                  <>
                    <button
                      type="button"
                      onClick={prevImage}
                      aria-label="Previous image"
                      className="
                        absolute left-2 top-1/2 z-10 -translate-y-1/2
                        rounded-full border border-white/30
                        bg-white/10 backdrop-blur
                        p-2 text-white
                        transition
                        hover:bg-white/20 hover:border-white/50
                        focus:outline-none
                        focus-visible:ring-2 focus-visible:ring-white/60
                      "
                    >
                      <ChevronLeft aria-hidden="true" className="h-6 w-6" />
                    </button>
                    <button
                      type="button"
                      onClick={nextImage}
                      aria-label="Next image"
                      className="
                        absolute right-2 top-1/2 z-10 -translate-y-1/2
                        rounded-full border border-white/30
                        bg-white/10 backdrop-blur
                        p-2 text-white
                        transition
                        hover:bg-white/20 hover:border-white/50
                        focus:outline-none
                        focus-visible:ring-2 focus-visible:ring-white/60
                      "
                    >
                      <ChevronRight aria-hidden="true" className="h-6 w-6" />
                    </button>
                  </>
                ) : null}

                <img
                  src={photoPreviews[Math.max(0, Math.min(activePhotoIdx, photoPreviews.length - 1))]?.fullSrc}
                  alt="Photo"
                  className="mx-auto max-h-[85vh] w-auto rounded-2xl object-contain shadow-2xl"
                  draggable={false}
                />
              </div>
            </div>
          </div>
        )}
      </>
    );
  }
);

