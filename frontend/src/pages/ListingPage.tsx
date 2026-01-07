// frontend/src/pages/ListingPage.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchListing, resolveAssets, type Listing } from "../api";
import Header from "../components/Header";

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "AUD" });
}

export default function ListingPage() {
  const { id } = useParams();
  const [item, setItem] = useState<Listing | null>(null);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!id) return;
      setLoading(true);
      setErr(null);
      try {
        const data = await fetchListing(id);
        if (!cancelled) {
          setItem(data);
          setActive(0);
          setLightboxOpen(false);
        }
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

  const assets = useMemo(() => {
    if (!item) return [];
    return resolveAssets(item.images ?? []);
  }, [item]);

  const hasMultiple = assets.length > 1;

  const hero =
    assets[active]?.medUrl ??
    assets[active]?.fullUrl ??
    assets[0]?.medUrl ??
    assets[0]?.fullUrl ??
    null;

  // Full-res for lightbox
  const fullRes =
    assets[active]?.fullUrl ??
    assets[0]?.fullUrl ??
    null;

  const prevImage = useCallback(() => {
    setActive((i) => (i <= 0 ? assets.length - 1 : i - 1));
  }, [assets.length]);

  const nextImage = useCallback(() => {
    setActive((i) => (i >= assets.length - 1 ? 0 : i + 1));
  }, [assets.length]);

  const openLightbox = useCallback(() => {
    if (!assets.length) return;
    setLightboxOpen(true);
  }, [assets.length]);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
  }, []);

  // Keyboard controls while lightbox is open
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

  // Prevent background scroll while lightbox open
  useEffect(() => {
    if (!lightboxOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lightboxOpen]);

  return (
    <div className="min-h-full">
      <Header maxWidth="5xl" />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Link to="/browse" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
          ← Back to listings
        </Link>

        {loading && <div className="mt-4 text-sm text-slate-600">Loading…</div>}

        {err && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {err}
          </div>
        )}

        {item && (
          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="bg-slate-100">
                {/* Image box */}
                <div className="relative aspect-[4/3] w-full bg-slate-100">
                  {hero ? (
                    <img src={hero} alt={item.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-500">
                      No image
                    </div>
                  )}

                  {/* Maximize button (top-right) */}
                  {hero && (
                    <button
                      type="button"
                      onClick={openLightbox}
                      aria-label="Maximize image"
                      className="
                        absolute right-3 top-3
                        rounded-full border border-white/30
                        bg-slate-900/15 backdrop-blur
                        px-3 py-2
                        text-white
                        shadow-sm
                        transition
                        hover:bg-slate-900/35 hover:border-white/50
                        focus:outline-none
                        focus-visible:ring-2 focus-visible:ring-white/60
                      "
                      title="View full size"
                    >
                      ⤢
                    </button>
                  )}

                  {/* Navigation arrows (only if >1 image) */}
                  {hasMultiple && (
                    <>
                      <button
                        type="button"
                        onClick={prevImage}
                        aria-label="Previous image"
                        className="
                          absolute left-3 top-1/2 -translate-y-1/2
                          rounded-full border border-white/30
                          bg-slate-900/15 backdrop-blur
                          px-3 py-2
                          text-white
                          shadow-sm
                          transition
                          hover:bg-slate-900/35 hover:border-white/50
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
                          bg-slate-900/15 backdrop-blur
                          px-3 py-2
                          text-white
                          shadow-sm
                          transition
                          hover:bg-slate-900/35 hover:border-white/50
                          focus:outline-none
                          focus-visible:ring-2 focus-visible:ring-white/60
                        "
                      >
                        ›
                      </button>
                    </>
                  )}
                </div>

                {/* Thumbnails */}
                {assets.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto p-3">
                    {assets.map((a, i) => (
                      <button
                        key={a.fullUrl + i}
                        type="button"
                        onClick={() => setActive(i)}
                        className={[
                          "h-16 w-20 shrink-0 overflow-hidden rounded-xl border bg-white",
                          i === active ? "border-slate-900" : "border-slate-200",
                        ].join(" ")}
                        title={`Image ${i + 1}`}
                        aria-current={i === active ? "true" : undefined}
                      >
                        <img
                          src={a.thumbUrl || a.medUrl || a.fullUrl}
                          alt={`thumb-${i}`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-5">
                <h1 className="text-2xl font-extrabold text-slate-900">{item.title}</h1>
                <div className="mt-2 text-sm font-semibold text-slate-600">
                  {item.category} • {item.species} • {item.location}
                </div>

                <div className="mt-4 whitespace-pre-wrap text-sm text-slate-800">{item.description}</div>

                <div className="mt-5 text-xs font-semibold text-slate-500">
                  Posted{" "}
                  {new Date(item.createdAt).toLocaleString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </div>

            <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-semibold text-slate-600">Price</div>
              <div className="mt-1 text-3xl font-extrabold text-slate-900">{centsToDollars(item.priceCents)}</div>

              <div className="mt-4 rounded-xl bg-slate-50 p-4">
                <div className="text-sm font-bold text-slate-900">Contact seller</div>

                {item.contact ? (
                  <div className="mt-2 whitespace-pre-wrap text-sm font-semibold text-slate-800">{item.contact}</div>
                ) : (
                  <div className="mt-1 text-sm text-slate-700">Seller didn’t provide contact info.</div>
                )}
              </div>

              <Link
                to="/post"
                className="mt-4 block w-full rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-slate-800"
              >
                Post your own listing
              </Link>
            </aside>
          </div>
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

              {assets.length > 0 && (
                <div className="absolute left-2 top-2 z-10 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white backdrop-blur">
                  {active + 1} / {assets.length}
                </div>
              )}

              <div className="relative overflow-hidden rounded-2xl">
                <div className="flex items-center justify-center">
                  {fullRes ? (
                    <img
                      src={fullRes}
                      alt={item?.title ?? "Listing image"}
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
