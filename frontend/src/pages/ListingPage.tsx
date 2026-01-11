// frontend/src/pages/ListingPage.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchListing, resolveAssets, type Listing } from "../api";
import Header from "../components/Header";
import { decodeSaleDetailsFromDescription } from "../utils/listingDetailsBlock";

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "AUD" });
}

export default function ListingPage() {
  const { id } = useParams();
  const [item, setItem] = useState<Listing | null>(null);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [phoneRevealed, setPhoneRevealed] = useState(false);

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
          setPhoneRevealed(false);
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

  const decoded = useMemo(() => {
    if (!item) return null;
    return decodeSaleDetailsFromDescription(item.description);
  }, [item]);

  const bodyDescription = decoded?.hadPrefix ? decoded.body : item?.description ?? "";
  const details = decoded?.details ?? { quantity: 1, priceType: "each" as const, customPriceText: "", willingToShip: false };
  const priceSuffix =
    details.priceType === "each"
      ? "each"
      : details.priceType === "all"
        ? "for all"
        : details.customPriceText
          ? `(${details.customPriceText})`
          : "(custom)";
  const qtyLabel = `Qty ${details.quantity}`;
  const phoneDigits = (item?.phone ?? "").toString().replace(/[^\d+]/g, "");

  function DefaultAvatar() {
    return (
      <div className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-600">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M20 21a8 8 0 0 0-16 0" />
          <circle cx="12" cy="8" r="4" />
        </svg>
      </div>
    );
  }

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
        <Link to="/browse?type=sale" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
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
            {/* Left column: gallery + description */}
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h1 className="text-2xl font-extrabold text-slate-900">{item.title}</h1>
                <div className="mt-2 text-sm font-semibold text-slate-700">
                  <span className="text-slate-500">Location:</span> {item.location}
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="bg-slate-100">
                  {/* Image box */}
                  <div className="relative aspect-4/3 w-full bg-slate-100">
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
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="text-sm font-extrabold text-slate-900">Description</div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                  {bodyDescription ? bodyDescription : <span className="text-slate-500">No description.</span>}
                </div>

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

            {/* Right column: seller + contact + listing details */}
            <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 lg:sticky lg:top-24">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-600">Price</div>
              <div className="mt-1 flex items-baseline gap-2">
                <div className="text-3xl font-extrabold text-slate-900">{centsToDollars(item.priceCents)}</div>
                <div className="text-sm font-semibold text-slate-600">{priceSuffix}</div>
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-700">
                <span className="text-slate-500">{qtyLabel}</span>
              </div>

              <div className="mt-5 border-t border-slate-200 pt-4">
                <div className="text-sm font-extrabold text-slate-900">Listing owner</div>
                <div className="mt-2 flex items-center gap-3">
                  {item.sellerAvatarUrl ? (
                    <img
                      src={item.sellerAvatarUrl}
                      alt=""
                      className="h-10 w-10 rounded-full border border-slate-200 object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <DefaultAvatar />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {item.sellerUsername ? item.sellerUsername : "Fishclassifieds user"}
                    </div>
                    <div className="text-xs font-semibold text-slate-600">Fishclassifieds member</div>
                  </div>
                </div>
              </div>

              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="text-sm font-extrabold text-slate-900">Contact</div>
                {!item.phone ? (
                  <div className="mt-2 text-sm font-semibold text-slate-700">Phone not available.</div>
                ) : phoneRevealed ? (
                  <a
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-900 hover:bg-slate-50"
                    href={`tel:${phoneDigits}`}
                  >
                    {item.phone}
                    <span className="text-xs font-semibold text-slate-600">(tap to call)</span>
                  </a>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setPhoneRevealed(true)}
                      className="mt-3 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      Reveal phone number
                    </button>
                    <div className="mt-2 text-xs font-semibold text-slate-600">
                      The listing owner's phone number is hidden for privacy.
                    </div>
                  </>
                )}
              </div>

              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="text-sm font-extrabold text-slate-900">Listing details</div>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="font-semibold text-slate-600">Category</dt>
                    <dd className="font-semibold text-slate-900">{item.category}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="font-semibold text-slate-600">Species</dt>
                    <dd className="font-semibold text-slate-900">{item.species}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="font-semibold text-slate-600">Sex</dt>
                    <dd className="font-semibold text-slate-900">{item.sex}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="font-semibold text-slate-600">Location</dt>
                    <dd className="font-semibold text-slate-900">{item.location}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="font-semibold text-slate-600">Price type</dt>
                    <dd className="font-semibold text-slate-900">{priceSuffix}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="font-semibold text-slate-600">Shipping</dt>
                    <dd className={["font-semibold", details.willingToShip ? "text-emerald-700" : "text-slate-900"].join(" ")}>
                      {details.willingToShip ? "Shipping offered" : "Local pickup or delivery only"}
                    </dd>
                  </div>
                </dl>
              </div>
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
