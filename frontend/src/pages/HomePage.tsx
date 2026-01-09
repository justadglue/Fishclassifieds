import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchListings, resolveAssets, type Listing } from "../api";
import Header from "../components/Header";
import homepageBackground from "../assets/homepage_background_1.jpg";
import featuredArowana from "../assets/featured_arowana.jpg";

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "AUD" });
}

function featuredHeroUrl(listing: Listing) {
  const assets = resolveAssets(listing.images ?? []);
  const hero = assets[0]?.medUrl ?? assets[0]?.fullUrl ?? null;
  if (hero) return hero;
  // Always-available placeholder image if the listing has no images.
  return `https://picsum.photos/seed/${encodeURIComponent(listing.id)}/1200/900`;
}

function FeaturedCard({ item }: { item: Listing }) {
  const hero = featuredHeroUrl(item);
  return (
    <div className="group min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow">
      <div className="relative aspect-4/3 w-full bg-slate-100">
        <img
          src={hero}
          alt={item.title}
          className="h-full w-full object-cover opacity-90 transition-transform duration-300 group-hover:scale-[1.02]"
          loading="lazy"
          decoding="async"
        />
        <div className="absolute left-3 top-3 rounded-full bg-slate-900 px-2 py-1 text-[11px] font-bold text-white">
          Featured
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold text-slate-900">{item.title}</div>
            <div className="mt-1 truncate text-xs font-semibold text-slate-600">
              {item.category} • {item.species} • {item.location}
            </div>
          </div>
          <div className="shrink-0 rounded-xl bg-slate-900 px-3 py-1 text-xs font-extrabold text-white">
            {centsToDollars(item.priceCents)}
          </div>
        </div>
      </div>
    </div>
  );
}

type FeaturedTile = { kind: "listing"; listing: Listing } | { kind: "promo" };

function FeaturedPromoCard() {
  return (
    <div className="group min-w-0 overflow-hidden rounded-2xl border border-indigo-300/70 bg-white shadow-sm ring-1 ring-indigo-200/40 transition-[transform,box-shadow,border-color,ring-color] hover:scale-[1.01] hover:shadow-lg hover:shadow-indigo-500/10 hover:ring-indigo-300/60 focus-within:ring-4 focus-within:ring-indigo-200/60">
      {/* Keep overall geometry consistent, but show the image uncropped and shorter */}
      <div className="relative aspect-4/3 w-full bg-slate-100">
        <div className="flex h-full flex-col">
          <div className="relative h-[74%] w-full overflow-hidden bg-slate-100">
            {/* Background layer fills the width (no blank sides) */}
            <img
              src={featuredArowana}
              alt=""
              className="absolute inset-0 h-full w-full scale-110 object-cover object-center blur-sm opacity-60 transition-transform duration-300 group-hover:scale-[1.12]"
              aria-hidden="true"
              loading="lazy"
              decoding="async"
            />
            <div className="absolute inset-0 bg-white/35" aria-hidden="true" />

            {/* Foreground layer fills width; crop happens upward (bottom anchored) */}
            <img
              src={featuredArowana}
              alt="Arowana"
              className="relative h-full w-full object-cover object-bottom transition-transform duration-300 group-hover:scale-[1.02]"
              loading="lazy"
              decoding="async"
            />
          </div>

          {/* Use the extra space under the image for the message */}
          <div className="flex-1 p-4">
            <div className="text-sm font-black leading-tight text-slate-900">Boost your listing's visibility</div>
            <div className="mt-1 text-sm font-semibold text-slate-700">More eyes • Faster results</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Many sellers choose featuring to increase interest in their listing.
            </div>
          </div>
        </div>
      </div>

      {/* Visibly: button only. Height matches other cards by reserving the same footer space invisibly. */}
      <div className="relative p-4">
        <div className="invisible select-none">
          <div className="truncate text-sm font-extrabold text-slate-900">Feature a listing</div>
          <div className="mt-1 truncate text-xs font-semibold text-slate-600">Reserved space</div>
        </div>

        <div className="absolute inset-0 flex items-center justify-center p-4">
          <Link
            to="/me"
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-slate-800"
          >
            Feature a listing →
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const nav = useNavigate();
  const [featured, setFeatured] = useState<Listing[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(false);
  const [featuredErr, setFeaturedErr] = useState<string | null>(null);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [featuredCols, setFeaturedCols] = useState(1);
  const [featuredSlideDir, setFeaturedSlideDir] = useState<null | (-1 | 1)>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [isCarouselPaused, setIsCarouselPaused] = useState(false);

  function goBrowse(extra?: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    if (extra?.category) sp.set("category", extra.category);
    const suffix = sp.toString() ? `?${sp.toString()}` : "";
    nav(`/browse${suffix}`);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFeaturedLoading(true);
      setFeaturedErr(null);
      try {
        // Fetch more than the visible count so the carousel can scroll and show arrows when overflow exists.
        const res = await fetchListings({ featured: true, sort: "newest", limit: 24, offset: 0 });
        if (cancelled) return;
        setFeatured(res.items ?? []);
      } catch (e: any) {
        if (cancelled) return;
        setFeatured([]);
        setFeaturedErr(e?.message ?? "Failed to load featured listings");
      } finally {
        if (!cancelled) setFeaturedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Reset carousel position when featured data changes.
    setFeaturedIndex(0);
  }, [featured.length]);

  useEffect(() => {
    function computeCols() {
      const w = window.innerWidth;
      // Tailwind breakpoints: sm=640, lg=1024
      if (w >= 1024) return 3;
      if (w >= 640) return 2;
      return 1;
    }

    function onResize() {
      setFeaturedCols(computeCols());
    }

    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    // If the responsive column count changes mid-transition, cancel the slide cleanly.
    setFeaturedSlideDir(null);
  }, [featuredCols]);

  // Auto-advance carousel every 4 seconds (only when there's overflow and not paused by user interaction)
  useEffect(() => {
    if (featured.length === 0) return;
    if (isCarouselPaused) return;
    const ROWS = 2;
    const colCount = Math.ceil((featured.length + 1) / ROWS); // +1 for promo tile
    const hasOverflow = colCount > featuredCols;
    if (!hasOverflow) return;

    const timer = setInterval(() => {
      // Only auto-advance if not currently sliding
      setFeaturedSlideDir((prev) => (prev === null ? 1 : prev));
    }, 4000);

    return () => clearInterval(timer);
  }, [featured.length, featuredCols, isCarouselPaused]);

  return (
    <div className="min-h-full">
      <Header maxWidth="6xl" />

      {/* Hero Section with Quick Actions */}
      <div className="relative">
        <div className="absolute inset-0 -z-10">
          <img src={homepageBackground} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-linear-to-b from-slate-950/40 via-slate-950/50 to-slate-950/70" />
        </div>

        <main className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-white/90 backdrop-blur">
              Explore fish, plants, shrimp, snails, and equipment 
            </div>

            <h1 className="mt-4 text-4xl font-black tracking-tight text-white sm:text-5xl">
              Your local aquarium marketplace.
            </h1>
            <p className="mt-4 text-base leading-relaxed text-white/90">
              Browse listings, post what you're selling, or find what you're looking for.
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="mt-8 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg">
            <div className="p-6 sm:p-8">
              <div className="text-center mb-6">
                <h2 className="text-lg font-black text-slate-900">What would you like to do?</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">Jump straight to where you need to go</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {/* Browse Listings */}
                <button
                  type="button"
                  onClick={() => nav("/browse")}
                  className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-slate-900 bg-slate-900 p-6 text-center transition hover:bg-slate-800"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-2xl">
                    🔍
                  </div>
                  <div>
                    <div className="text-sm font-extrabold text-white">Browse Listings</div>
                    <div className="mt-1 text-xs font-semibold text-white/70">Find fish, plants & more</div>
                  </div>
                </button>

                {/* Browse Wanted */}
                <button
                  type="button"
                  onClick={() => nav("/wanted")}
                  className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-6 text-center transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-2xl">
                    📋
                  </div>
                  <div>
                    <div className="text-sm font-extrabold text-slate-900">Browse Wanted</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">See what people need</div>
                  </div>
                </button>

                {/* Sell Something */}
                <button
                  type="button"
                  onClick={() => nav("/post")}
                  className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-6 text-center transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-2xl">
                    💰
                  </div>
                  <div>
                    <div className="text-sm font-extrabold text-slate-900">Sell Something</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">Post a listing for sale</div>
                  </div>
                </button>

                {/* Post Wanted */}
                <button
                  type="button"
                  onClick={() => nav("/wanted/post")}
                  className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-6 text-center transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-2xl">
                    ✋
                  </div>
                  <div>
                    <div className="text-sm font-extrabold text-slate-900">Post Wanted</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">Tell sellers what you need</div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Browse by Category */}
          <section className="mt-10">
            <div className="text-xs font-bold uppercase tracking-wider text-white/70">Browse by category</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { label: "Fish", emoji: "🐠", params: { category: "Fish" } },
                { label: "Shrimp", emoji: "🦐", params: { category: "Shrimp" } },
                { label: "Snails", emoji: "🐌", params: { category: "Snails" } },
                { label: "Plants", emoji: "🌿", params: { category: "Plants" } },
                { label: "Equipment", emoji: "⚙️", params: { category: "Equipment" } },
              ].map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => goBrowse(t.params)}
                  className="rounded-2xl border border-white/20 bg-white/10 p-4 text-left backdrop-blur hover:bg-white/20 transition"
                >
                  <div className="text-2xl mb-2">{t.emoji}</div>
                  <div className="text-sm font-extrabold text-white">{t.label}</div>
                  <div className="mt-1 text-xs font-semibold text-white/80">Explore →</div>
                </button>
              ))}
            </div>
          </section>
        </main>
      </div>

      {/* Featured Listings Section with Gradient Background */}
      <div className="relative bg-slate-50">
        <main className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
          <section>
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Featured listings</div>
                <h2 className="mt-2 text-2xl font-black text-slate-900">Promoted listings</h2>
                <div className="mt-1 text-sm font-semibold text-slate-600">
                  These are paid placements. (Placeholder cards for now — we can hook this to real listings later.)
                </div>
              </div>
              <button type="button" onClick={() => goBrowse()} className="text-sm font-extrabold text-slate-700 hover:text-slate-900">
                View all listings→
              </button>
            </div>

            {featuredLoading && <div className="mt-5 text-sm font-semibold text-slate-600">Loading featured…</div>}

            {featuredErr && (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800 shadow-sm">
                {featuredErr}
                <div className="mt-2 text-xs font-semibold text-slate-600">
                  If this is your first time enabling featured listings, run:
                  <div className="mt-1 font-mono text-[11px] text-slate-500">
                    npm --prefix backend run db:migration -- --seed-featured
                  </div>
                </div>
              </div>
            )}

            {!featuredLoading && !featuredErr && featured.length === 0 && (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800 shadow-sm">
                No featured listings yet.
                <div className="mt-2 text-xs font-semibold text-slate-600">
                  To demo this, run:
                  <div className="mt-1 font-mono text-[11px] text-slate-500">
                    npm --prefix backend run db:migration -- --seed-featured
                  </div>
                </div>
              </div>
            )}

            <div className="mt-5">
              {(() => {
                const ROWS = 2;
                const VISIBLE_COLS = Math.max(1, featuredCols);

                const tiles: FeaturedTile[] = [
                  ...featured.map((l) => ({ kind: "listing" as const, listing: l })),
                  // Always show the promo tile as the final item.
                  { kind: "promo" as const },
                ];

                const n = tiles.length;
                const colCount = Math.ceil(n / ROWS);
                const hasOverflow = colCount > VISIBLE_COLS;

                // featuredIndex is the column index of the leftmost visible column.
                const safeColIndex = colCount > 0 ? ((featuredIndex % colCount) + colCount) % colCount : 0;
                const isSliding = featuredSlideDir != null;

                // Build "true" columns (2 rows per column) so wrapping never re-pairs items.
                const cols: Array<Array<FeaturedTile | null>> = Array.from({ length: colCount }, (_, c) => [
                  tiles[c * ROWS] ?? null,
                  tiles[c * ROWS + 1] ?? null,
                ]);

                // Keep the window indices unique to avoid reconciliation jumps.
                const windowColSlots = hasOverflow ? Math.min(colCount, VISIBLE_COLS + 2) : Math.min(colCount, VISIBLE_COLS);
                const windowColIndices = hasOverflow
                  ? Array.from({ length: windowColSlots }, (_, i) => (safeColIndex + i - 1 + colCount) % colCount)
                  : Array.from({ length: windowColSlots }, (_, i) => i);

                function shift(dir: -1 | 1) {
                  if (!hasOverflow) return;
                  if (featuredSlideDir) return; // ignore spam clicks while animating
                  setFeaturedSlideDir(dir);
                }

                return (
                  <div
                    className="relative"
                    role="region"
                    aria-roledescription="carousel"
                    aria-label="Promoted listings"
                    tabIndex={0}
                    onMouseEnter={() => setIsCarouselPaused(true)}
                    onMouseLeave={() => setIsCarouselPaused(false)}
                    onFocusCapture={() => setIsCarouselPaused(true)}
                    onBlurCapture={(e) => {
                      const next = e.relatedTarget as Node | null;
                      if (next && e.currentTarget.contains(next)) return;
                      setIsCarouselPaused(false);
                    }}
                    onKeyDown={(e) => {
                      if (!hasOverflow) return;
                      if (e.key === "ArrowLeft") {
                        e.preventDefault();
                        shift(-1);
                      } else if (e.key === "ArrowRight") {
                        e.preventDefault();
                        shift(1);
                      } else if (e.key === "Home") {
                        e.preventDefault();
                        setFeaturedIndex(0);
                      } else if (e.key === "End") {
                        e.preventDefault();
                        setFeaturedIndex(Math.max(0, colCount - 1));
                      }
                    }}
                    onTouchStart={(e) => setTouchStartX(e.touches[0]?.clientX ?? null)}
                    onTouchEnd={(e) => {
                      if (!hasOverflow) return;
                      if (featuredSlideDir) return;
                      const startX = touchStartX;
                      const endX = e.changedTouches[0]?.clientX ?? null;
                      setTouchStartX(null);
                      if (startX == null || endX == null) return;
                      const dx = endX - startX;
                      if (Math.abs(dx) < 50) return;
                      if (dx < 0) shift(1);
                      else shift(-1);
                    }}
                  >
                    <div className="relative">
                      {/* Outside-edge arrows, vertically centered between the two rows */}
                      {hasOverflow && (
                        <>
                          <button
                            type="button"
                            onClick={() => shift(-1)}
                            className="absolute left-0 top-1/2 z-20 inline-flex h-11 w-11 -translate-x-full -translate-y-1/2 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-md hover:bg-slate-50 hover:text-slate-900"
                            aria-label="Previous promoted listing"
                          >
                            <span aria-hidden="true">←</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => shift(1)}
                            className="absolute right-0 top-1/2 z-20 inline-flex h-11 w-11 translate-x-full -translate-y-1/2 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-md hover:bg-slate-50 hover:text-slate-900"
                            aria-label="Next promoted listing"
                          >
                            <span aria-hidden="true">→</span>
                          </button>
                        </>
                      )}

                      {!hasOverflow ? (
                        <div
                          className="grid min-w-0 gap-4"
                          style={{ gridTemplateColumns: `repeat(${Math.max(1, windowColIndices.length)}, minmax(0, 1fr))` }}
                        >
                          {windowColIndices.map((colIdx) => (
                            <div key={`featured-col-static-${colIdx}`} className="min-w-0">
                              <div className="flex flex-col gap-4">
                                {cols[colIdx]?.map((t, r) => {
                                  if (!t) return null;
                                  if (t.kind === "listing") {
                                    return (
                                      <Link key={t.listing.id} to={`/listing/${t.listing.id}`} className="block min-w-0">
                                        <FeaturedCard item={t.listing} />
                                      </Link>
                                    );
                                  }
                                  return <FeaturedPromoCard key={`featured-promo-tile-static-${colIdx}-${r}`} />;
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="overflow-x-hidden overflow-y-visible pb-2">
                          <div
                            className="flex will-change-transform"
                            style={{
                              transform: `translateX(-${(1 + (isSliding ? (featuredSlideDir as -1 | 1) : 0)) * (100 / VISIBLE_COLS)}%)`,
                              transition: isSliding ? "transform 450ms ease" : "none",
                            }}
                            onTransitionEnd={(e) => {
                              if (e.propertyName !== "transform") return;
                              if (!featuredSlideDir) return;
                              const dir = featuredSlideDir;
                              setFeaturedIndex((i) => ((i + dir) % colCount + colCount) % colCount);
                              setFeaturedSlideDir(null);
                            }}
                          >
                            {windowColIndices.map((colIdx) => (
                              <div
                                key={`featured-col-${colIdx}`}
                                className="shrink-0 px-2"
                                style={{ width: `${100 / VISIBLE_COLS}%` }}
                              >
                                <div className="flex flex-col gap-4">
                                  {cols[colIdx]?.map((t, r) => {
                                    if (!t) return null;
                                    if (t.kind === "listing") {
                                      return (
                                        <Link key={t.listing.id} to={`/listing/${t.listing.id}`} className="block min-w-0">
                                          <FeaturedCard item={t.listing} />
                                        </Link>
                                      );
                                    }
                                    return <FeaturedPromoCard key={`featured-promo-tile-${colIdx}-${r}`} />;
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {hasOverflow && (
                      <div
                        className="relative z-10 mt-4 flex flex-wrap items-center justify-center gap-1"
                        role="tablist"
                        aria-label="Promoted listing position"
                      >
                        {Array.from({ length: colCount }, (_, i) => {
                          const active = i === safeColIndex;
                          return (
                            <button
                              key={`featured-dot-${i}`}
                              type="button"
                              onClick={() => setFeaturedIndex(i)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full cursor-pointer"
                              aria-label={`Go to featured column ${i + 1} of ${colCount}`}
                              aria-current={active ? "true" : undefined}
                            >
                              <span
                                className={[
                                  "h-2 rounded-full transition-all duration-300",
                                  active ? "w-6 bg-slate-900" : "w-2 bg-slate-300 hover:bg-slate-400",
                                ].join(" ")}
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </section>
        </main>

        <footer className="border-t border-slate-200">
          <div className="mx-auto max-w-6xl px-4 py-10">
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              <div className="text-center">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Explore</div>
                <div className="mt-3 flex flex-col items-center gap-2">
                  <Link to="/browse" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                    Browse listings
                  </Link>
                  <Link to="/post" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                    Post a listing
                  </Link>
                  <Link to="/me" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                    My listings
                  </Link>
                </div>
              </div>

              <div className="text-center">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Account</div>
                <div className="mt-3 flex flex-col items-center gap-2">
                  <Link to="/profile" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                    My profile
                  </Link>
                  <Link to="/login" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                    Login
                  </Link>
                  <Link to="/signup" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                    Sign up
                  </Link>
                </div>
              </div>

              <div className="text-center">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Support</div>
                <div className="mt-3 flex flex-col items-center gap-2">
                  <Link to="/faq" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                    FAQ
                  </Link>
                  <Link to="/contact" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                    Contact
                  </Link>
                  <Link to="/terms" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                    Terms
                  </Link>
                  <Link to="/privacy" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                    Privacy
                  </Link>
                </div>
              </div>
            </div>

            <div className="mt-8 border-t border-slate-200 pt-6 text-center text-sm font-semibold text-slate-500">
              © {new Date().getFullYear()} Fishclassifieds. All rights reserved.
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
