import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Flag } from "lucide-react";
import Header from "../components/Header";
import NoPhotoPlaceholder from "../components/NoPhotoPlaceholder";
import {
  fetchWantedPost,
  resolveAssets,
  type WantedPost,
} from "../api";

function centsToDollars(cents: number) {
  const s = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${s}`;
}

function timeAgo(iso: string) {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "";
  let diffMs = Date.now() - t;
  if (!Number.isFinite(diffMs) || diffMs < 0) diffMs = 0;

  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;

  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;

  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk} week${wk === 1 ? "" : "s"} ago`;

  const mo = Math.floor(day / 30);
  return `${Math.max(1, mo)} month${mo === 1 ? "" : "s"} ago`;
}

function budgetLabel(w: WantedPost) {
  const min = w.budgetMinCents ?? null;
  const max = w.budgetMaxCents ?? null;
  if (min == null && max == null) return "Any budget";
  if (min != null && max != null) return `${centsToDollars(min)}–${centsToDollars(max)}`;
  if (min != null) return `${centsToDollars(min)}+`;
  return `Up to ${centsToDollars(max!)}`;
}

export default function WantedDetailPage() {
  const { id } = useParams();
  const location = useLocation();

  const [item, setItem] = useState<WantedPost | null>(null);
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
        const w = await fetchWantedPost(id);
        if (!cancelled) {
          setItem(w);
          setActive(0);
          setLightboxOpen(false);
          setPhoneRevealed(false);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load wanted post");
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
  const hero = assets[active]?.medUrl ?? assets[active]?.fullUrl ?? assets[0]?.medUrl ?? assets[0]?.fullUrl ?? null;
  const fullRes = assets[active]?.fullUrl ?? assets[0]?.fullUrl ?? null;

  const postedAgo = item?.createdAt ? timeAgo(item.createdAt) : "";

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

  function DefaultAvatar() {
    return (
      <div className="grid h-[84px] w-[84px] place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-600">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M20 21a8 8 0 0 0-16 0" />
          <circle cx="12" cy="8" r="4" />
        </svg>
      </div>
    );
  }

  return (
    <div className="min-h-full">
      <Header maxWidth="5xl" />
      <main className="mx-auto max-w-5xl px-4 py-6">
        {(() => {
          const from = (location.state as any)?.from as
            | { pathname: string; search?: string; label?: string }
            | undefined;
          const label = (from?.label ?? "").trim() || "wanted";
          const to = from?.pathname ? `${from.pathname}${from.search ?? ""}` : "/browse?type=wanted";
          return (
            <Link to={to} className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              ← Back to {label}
            </Link>
          );
        })()}

        {loading && <div className="mt-4 text-sm text-slate-600">Loading…</div>}

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

        {item && (
          <>
            <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_360px]">
              {/* Left column: gallery + description */}
              <div className="space-y-5">
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <h1 className="text-2xl font-extrabold text-slate-900">{item.title}</h1>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
                    <div>
                      Posted {postedAgo ? `${postedAgo} • ` : ""}
                      {new Date(item.createdAt).toLocaleString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition hover:text-red-400"
                      title="Report this ad"
                    >
                      <Flag aria-hidden="true" className="h-3.5 w-3.5" />
                      <span>Report this listing</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="bg-slate-100">
                    {/* Image box */}
                    <div className="relative aspect-4/3 w-full bg-slate-100">
                      {hero ? (
                        <img src={hero} alt={item.title} className="h-full w-full object-cover" />
                      ) : (
                        <NoPhotoPlaceholder title={item.title} variant="detail" />
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
                    {item.description ? item.description : <span className="text-slate-500">No description.</span>}
                  </div>
                </div>
              </div>

              {/* Right column: owner + contact + wanted details */}
              <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 lg:sticky lg:top-24">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-600">Budget</div>
                <div className="mt-1 text-2xl font-extrabold text-slate-900">{budgetLabel(item)}</div>
                <div className="mt-2 text-sm font-semibold text-slate-700">
                  <span className="text-slate-500">Qty {Number.isFinite(item.quantity) ? item.quantity : 1}</span>
                </div>

                <div className="mt-4 border-t border-slate-200 pt-4">
                  <div className="text-sm font-extrabold text-slate-900">Listing owner</div>
                  <div className="mt-2 flex items-center gap-3">
                    {item.sellerAvatarUrl ? (
                      <img
                        src={item.sellerAvatarUrl}
                        alt=""
                        className="h-[84px] w-[84px] rounded-full border border-slate-200 object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <DefaultAvatar />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {item.username ? item.username : "Fishclassifieds user"}
                      </div>
                      <div className="text-xs font-semibold text-slate-600">Fishclassifieds member</div>
                    </div>
                  </div>
                  {item.sellerBio && item.sellerBio.trim() ? (
                    <div className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-xs text-slate-700">
                      {item.sellerBio.trim()}
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 border-t border-slate-200 pt-4">
                  <div className="text-sm font-extrabold text-slate-900">Contact</div>
                  {!item.phone ? (
                    <div className="mt-2 text-sm font-semibold text-slate-700">Phone not available.</div>
                  ) : phoneRevealed ? (
                    <a
                      href={`tel:${item.phone}`}
                      className="mt-3 block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-extrabold text-slate-900"
                    >
                      {item.phone}
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
                      <dt className="font-semibold text-slate-600">Listing type</dt>
                      <dd className="font-semibold text-slate-900">Wanted</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="font-semibold text-slate-600">Category</dt>
                      <dd className="font-semibold text-slate-900">{item.category}</dd>
                    </div>
                    {item.species ? (
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="font-semibold text-slate-600">Species</dt>
                        <dd className="font-semibold text-slate-900">{item.species}</dd>
                      </div>
                    ) : null}
                    {item.sex ? (
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="font-semibold text-slate-600">Sex</dt>
                        <dd className="font-semibold text-slate-900">{item.sex}</dd>
                      </div>
                    ) : null}
                    {item.waterType ? (
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="font-semibold text-slate-600">Water type</dt>
                        <dd className="font-semibold text-slate-900">{item.waterType}</dd>
                      </div>
                    ) : null}
                    {item.age ? (
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="font-semibold text-slate-600">Age</dt>
                        <dd className="font-semibold text-slate-900">{item.age}</dd>
                      </div>
                    ) : null}
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="font-semibold text-slate-600">Quantity</dt>
                      <dd className="font-semibold text-slate-900">{Number.isFinite(item.quantity) ? item.quantity : 1}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="font-semibold text-slate-600">Location</dt>
                      <dd className="font-semibold text-slate-900">{item.location}</dd>
                    </div>
                  </dl>
                </div>
              </aside>
            </div>
          </>
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
                      alt={item?.title ?? "Wanted image"}
                      className="max-h-[85vh] w-auto max-w-full select-none object-contain"
                      draggable={false}
                    />
                  ) : (
                    <div className="h-[60vh] w-full overflow-hidden rounded-2xl bg-white/10">
                      <NoPhotoPlaceholder title={item?.title ?? ""} variant="detail" />
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
