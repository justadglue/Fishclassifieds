import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { MapPin } from "lucide-react";
import { fetchFeatured, resolveAssets, type FeaturedItem, type Listing, type WantedPost } from "../api";
import { useAuth } from "../auth";
import Header from "../components/Header";
import homepageBackground from "../assets/homepage_background_1.jpg";
import featuredArowana from "../assets/featured_arowana.jpg";
import { decodeSaleDetailsFromDescription } from "../utils/listingDetailsBlock";

function centsToDollars(cents: number) {
  const s = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${s}`;
}

function featuredHeroUrl(listing: Listing) {
  const assets = resolveAssets(listing.images ?? []);
  const hero = assets[0]?.medUrl ?? assets[0]?.fullUrl ?? null;
  return hero;
}

function featuredHeroUrlWanted(w: WantedPost) {
  const assets = resolveAssets(w.images ?? []);
  const hero = assets[0]?.medUrl ?? assets[0]?.fullUrl ?? null;
  return hero;
}

function budgetLabel(w: WantedPost) {
  const budget = w.budgetCents ?? null;
  if (budget == null) return "Make an offer";
  return `Up to ${centsToDollars(budget)}`;
}

function FeaturedCard({ item }: { item: FeaturedItem }) {
  const hero = item.kind === "sale" ? featuredHeroUrl(item.item) : featuredHeroUrlWanted(item.item);
  const salePricePill = (() => {
    if (item.kind !== "sale") return null;
    const details = decodeSaleDetailsFromDescription(item.item.description).details;
    if (details.priceType === "free") return "Free";
    if (details.priceType === "offer") return "Make an Offer";
    return centsToDollars(item.item.priceCents);
  })();
  return (
    <div className="group min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow">
      <div className="relative aspect-4/3 w-full bg-slate-100">
        {hero ? (
          <img
            src={hero}
            alt={item.item.title}
            className="h-full w-full object-cover opacity-90 transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-500">No image</div>
        )}
        <div className="absolute left-3 top-3 rounded-full bg-slate-900 px-2 py-1 text-[11px] font-bold text-white">
          {item.kind === "wanted" ? "Wanted" : "For sale"}
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold text-slate-900">{item.item.title}</div>
            <div className="mt-1 truncate text-xs font-semibold text-slate-600">
              <span className="inline-flex items-center gap-1">
                <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 truncate">
                  {item.item.location}
                  {item.kind === "sale" ? ` • ${item.item.shippingOffered ? "Shipping offered" : "Local only"}` : ""}
                </span>
              </span>
            </div>
          </div>
          <div className="shrink-0 rounded-xl bg-slate-900 px-3 py-1 text-xs font-extrabold text-white">
            {item.kind === "sale" ? salePricePill : budgetLabel(item.item)}
          </div>
        </div>
      </div>
    </div>
  );
}

type FeaturedTile = { kind: "sale"; item: Listing } | { kind: "wanted"; item: WantedPost } | { kind: "promo" };

function FeaturedSkeletonCard() {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="relative aspect-4/3 w-full bg-slate-100 animate-pulse">
        <div className="absolute inset-0 bg-slate-200/70" aria-hidden="true" />
        <div className="absolute left-3 top-3 h-5 w-16 rounded-full bg-slate-300" aria-hidden="true" />
      </div>
      <div className="p-4 animate-pulse">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="h-4 w-3/4 rounded bg-slate-200" aria-hidden="true" />
            <div className="mt-2 h-3 w-5/6 rounded bg-slate-200" aria-hidden="true" />
          </div>
          <div className="h-6 w-16 rounded-xl bg-slate-200" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

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
  const routerLocation = useLocation();
  const { user, loading: authLoading } = useAuth();
  const [featured, setFeatured] = useState<FeaturedItem[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(false);
  const [featuredErr, setFeaturedErr] = useState<string | null>(null);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [featuredCols, setFeaturedCols] = useState(() => {
    const w = typeof window !== "undefined" ? window.innerWidth : 0;
    // Tailwind breakpoints: sm=640, lg=1024
    if (w >= 1024) return 3;
    if (w >= 640) return 2;
    return 1;
  });
  const [featuredAnimate, setFeaturedAnimate] = useState(false);
  const [featuredAnimMs, setFeaturedAnimMs] = useState(450);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [isCarouselPaused, setIsCarouselPaused] = useState(false);
  const [heroSearch, setHeroSearch] = useState("");
  const [heroImgLoaded, setHeroImgLoaded] = useState(false);
  const heroImgRef = useRef<HTMLImageElement | null>(null);
  const heroImgDecodingRef = useRef(false);

  useEffect(() => {
    // In dev StrictMode, components can mount twice and an already-cached image
    // may not fire onLoad the second time. If it's already in cache, decode it
    // and then flip the state on the next frame so opacity can animate.
    const img = heroImgRef.current;
    if (!img) return;
    if (!img.complete || img.naturalWidth === 0) return;
    if (heroImgDecodingRef.current) return;

    heroImgDecodingRef.current = true;
    const p = typeof img.decode === "function" ? img.decode() : Promise.resolve();
    p.catch(() => { })
      .then(() => {
        window.requestAnimationFrame(() => setHeroImgLoaded(true));
      })
      .finally(() => {
        heroImgDecodingRef.current = false;
      });
  }, []);

  function markHeroReady(img: HTMLImageElement) {
    if (!img || img.naturalWidth === 0) return;
    if (heroImgDecodingRef.current) return;
    heroImgDecodingRef.current = true;

    const p = typeof img.decode === "function" ? img.decode() : Promise.resolve();
    p.catch(() => { })
      .then(() => {
        window.requestAnimationFrame(() => setHeroImgLoaded(true));
      })
      .finally(() => {
        heroImgDecodingRef.current = false;
      });
  }

  function navWithParams(path: string, params?: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      const val = String(v ?? "").trim();
      if (val) sp.set(k, val);
    }
    const suffix = sp.toString() ? `?${sp.toString()}` : "";
    nav(`${path}${suffix}`);
  }

  function goBrowse(extra?: { q?: string; category?: string; species?: string; min?: string; max?: string }) {
    navWithParams("/browse", extra);
  }

  function goRequireAuth(targetPath: string) {
    // If auth is still resolving, don't bounce the user unexpectedly.
    // They can click again once state is loaded.
    if (authLoading) return;
    if (!user) {
      navWithParams("/auth", { next: targetPath });
      return;
    }
    nav(targetPath);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFeaturedLoading(true);
      setFeaturedErr(null);
      try {
        // Fetch more than the visible count so the carousel can scroll and show arrows when overflow exists.
        const res = await fetchFeatured({ limit: 24, offset: 0 });
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
    setFeaturedAnimate(false);
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
    setFeaturedAnimate(false);
  }, [featuredCols]);

  // Auto-advance carousel every 4 seconds (only when there's overflow and not paused by user interaction)
  useEffect(() => {
    if (featured.length === 0) return;
    if (isCarouselPaused) return;
    const ROWS = 2;
    const colCount = Math.ceil((featured.length + 1) / ROWS); // +1 for promo tile
    const hasOverflow = colCount > featuredCols;
    if (!hasOverflow) return;

    const maxStart = Math.max(0, colCount - Math.max(1, featuredCols));
    if (maxStart === 0) return;

    const timer = setInterval(() => {
      // Loop back to start when reaching the end.
      setFeaturedIndex((i) => (i >= maxStart ? 0 : i + 1));
      setFeaturedAnimMs(450);
      setFeaturedAnimate(true);
    }, 4000);

    return () => clearInterval(timer);
  }, [featured.length, featuredCols, isCarouselPaused]);

  return (
    <div className="min-h-full overflow-x-hidden">
      <Header maxWidth="7xl" />

      {/* Hero Section with Quick Actions */}
      <div className="relative">
        <div className="absolute inset-0 -z-10">
          {/* Instant fallback background (match site theme) */}
          <div className="absolute inset-0 bg-slate-50" aria-hidden="true" />

          {/* Hero image (revealed by overlay fade) */}
          <img
            src={homepageBackground}
            alt=""
            ref={heroImgRef}
            data-no-fade
            className="absolute inset-0 h-full w-full object-cover"
            loading="eager"
            decoding="async"
            onLoad={(e) => markHeroReady(e.currentTarget)}
            onError={() => setHeroImgLoaded(true)}
          />

          {/* Overlay is always present; the white cover hides it until ready */}
          <div className="absolute inset-0 bg-linear-to-b from-slate-950/40 via-slate-950/50 to-slate-950/70" aria-hidden="true" />
        </div>

        {/* One single white cover that fades away once hero is ready */}
        <div
          className={[
            "pointer-events-auto absolute inset-0 z-10 bg-slate-50 transition-opacity duration-1000 ease-out",
            heroImgLoaded ? "pointer-events-none opacity-0" : "opacity-100",
          ].join(" ")}
          aria-hidden="true"
        />

        <main className="mx-auto max-w-7xl px-4 py-14 sm:py-20">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Australia's aquarium marketplace</h1>
          </div>

          {/* Quick actions (translucent / glass) */}
          <div className="mt-16 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <button
              type="button"
              onClick={() => nav("/browse?type=sale")}
              className="group rounded-2xl border border-white/25 bg-white/15 p-4 text-left shadow-lg shadow-black/25 backdrop-blur transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40"
            >
              <div className="text-sm font-extrabold text-white">Explore sale listings →</div>
              <div className="mt-1 text-xs font-semibold text-white/75">Fish, plants, shrimp, equipment and more</div>
            </button>

            <button
              type="button"
              onClick={() => goRequireAuth("/post/sale")}
              className="group rounded-2xl border border-white/25 bg-white/15 p-4 text-left shadow-lg shadow-black/25 backdrop-blur transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40"
            >
              <div className="text-sm font-extrabold text-white">Post a sale listing →</div>
              <div className="mt-1 text-xs font-semibold text-white/75">Reach interested buyers</div>
            </button>

            <button
              type="button"
              onClick={() => nav("/browse?type=wanted")}
              className="group rounded-2xl border border-white/25 bg-white/15 p-4 text-left shadow-lg shadow-black/25 backdrop-blur transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40"
            >
              <div className="text-sm font-extrabold text-white">Browse wanted listings →</div>
              <div className="mt-1 text-xs font-semibold text-white/75">See what buyers are looking for</div>
            </button>

            <button
              type="button"
              onClick={() => goRequireAuth("/post/wanted")}
              className="group rounded-2xl border border-white/25 bg-white/15 p-4 text-left shadow-lg shadow-black/25 backdrop-blur transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40"
            >
              <div className="text-sm font-extrabold text-white">Post a wanted listing →</div>
              <div className="mt-1 text-xs font-semibold text-white/75">Let sellers know what you need</div>
            </button>
          </div>

          {/* Simple keyword search */}
          <form
            className="mt-6"
            onSubmit={(e) => {
              e.preventDefault();
              goBrowse({ q: heroSearch });
            }}
          >
            <div className="flex overflow-hidden rounded-2xl border border-white/25 bg-white/15 shadow-lg shadow-black/25 backdrop-blur-xl focus-within:ring-2 focus-within:ring-white/40">
              <input
                value={heroSearch}
                onChange={(e) => setHeroSearch(e.target.value)}
                placeholder="Search all listings"
                className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm font-semibold text-white outline-none placeholder:text-white/70"
              />
              <button
                type="submit"
                className="shrink-0 border-l border-white/20 bg-white/20 px-5 py-3 text-sm font-extrabold text-white transition hover:bg-white/25"
              >
                Search →
              </button>
            </div>
          </form>

          {/* Popular searches (placeholder list; can be swapped for real analytics later) */}
          <section className="mt-14">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-xs font-bold uppercase tracking-wider text-white/70">Popular searches</div>
            </div>

            {/* One-row, subtle “generated” chips. Scrolls horizontally on small screens. */}
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {[
                { label: "Guppies", params: { category: "Fish", species: "guppy" } },
                { label: "Betta", params: { category: "Fish", species: "betta" } },
                { label: "Goldfish", params: { category: "Fish", species: "goldfish" } },
                { label: "Cherry shrimp", params: { category: "Shrimp", q: "neocaridina" } },
                { label: "Live plants", params: { category: "Plants", q: "live plants" } },
                { label: "Canister filter", params: { category: "Equipment", q: "canister filter" } },
                { label: "CO2 kit", params: { category: "Equipment", q: "co2" } },
                { label: "Breeding pair", params: { q: "breeding pair" } },
              ].map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => goBrowse(t.params)}
                  className="shrink-0 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 backdrop-blur transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/25"
                >
                  {t.label} →
                </button>
              ))}
            </div>
          </section>
        </main>
      </div>

      {/* Featured Listings Section with Gradient Background */}
      <div className="relative bg-slate-50">
        <main className="mx-auto max-w-7xl px-4 py-10 sm:py-14">
          <section>
            <div className="flex items-end justify-between gap-4">
              <div>

                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  A curated selection
                </div>
                <h2 className="text-2xl mt-2 font-black text-slate-900">Featured listings</h2>
              </div>
              <button type="button" onClick={() => goBrowse()} className="text-sm font-extrabold text-slate-700 hover:text-slate-900">
                View all listings→
              </button>
            </div>

            {featuredLoading && <div className="mt-5 text-sm font-semibold text-slate-600">Loading featured…</div>}

            {featuredErr && (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800 shadow-sm">
                {featuredErr}
              </div>
            )}

            {!featuredLoading && !featuredErr && featured.length === 0 && (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800 shadow-sm">
                No featured listings yet.
                <div className="mt-2 text-xs font-semibold text-slate-600">Check back later for promoted listings.</div>
              </div>
            )}

            <div className="mt-5">
              {featuredLoading ? (
                <div
                  className="grid min-w-0 gap-4"
                  style={{ gridTemplateColumns: `repeat(${Math.max(1, featuredCols)}, minmax(0, 1fr))` }}
                >
                  {Array.from({ length: Math.max(1, featuredCols) }, (_, colIdx) => colIdx).map((colIdx) => (
                    <div key={`featured-skel-col-${colIdx}`} className="min-w-0">
                      <div className="flex flex-col gap-4">
                        <FeaturedSkeletonCard />
                        <FeaturedSkeletonCard />
                      </div>
                    </div>
                  ))}
                </div>
              ) : !featuredErr && featured.length > 0 ? (
                (() => {
                  const ROWS = 2;
                  const VISIBLE_COLS = Math.max(1, featuredCols);

                  const tiles: FeaturedTile[] = [
                    ...featured.map((x) =>
                      x.kind === "sale" ? ({ kind: "sale" as const, item: x.item }) : ({ kind: "wanted" as const, item: x.item })
                    ),
                    // Only show the promo tile once featured data has loaded.
                    { kind: "promo" as const },
                  ];

                  const n = tiles.length;
                  const colCount = Math.ceil(n / ROWS);
                  const hasOverflow = colCount > VISIBLE_COLS;
                  const maxStart = Math.max(0, colCount - VISIBLE_COLS);

                  // featuredIndex is the column index of the leftmost visible column.
                  const safeColIndex = Math.max(0, Math.min(maxStart, featuredIndex));

                  // Build "true" columns (2 rows per column) so wrapping never re-pairs items.
                  const cols: Array<Array<FeaturedTile | null>> = Array.from({ length: colCount }, (_, c) => [
                    tiles[c * ROWS] ?? null,
                    tiles[c * ROWS + 1] ?? null,
                  ]);

                  function shift(dir: -1 | 1) {
                    if (!hasOverflow) return;
                    // Wrap at the ends (prev from start -> end, next from end -> start).
                    const next =
                      dir === -1 && safeColIndex === 0
                        ? maxStart
                        : dir === 1 && safeColIndex === maxStart
                          ? 0
                          : Math.max(0, Math.min(maxStart, safeColIndex + dir));
                    setFeaturedAnimMs(450);
                    setFeaturedAnimate(true);
                    setFeaturedIndex(next);
                  }

                  function jumpTo(target: number) {
                    if (!hasOverflow) return;
                    if (target === safeColIndex) return;

                    const t = Math.max(0, Math.min(maxStart, target));
                    const dist = Math.abs(t - safeColIndex);
                    setFeaturedAnimMs(Math.min(1200, 350 + dist * 120));
                    setFeaturedAnimate(true);
                    setFeaturedIndex(t);
                  }

                  return (
                    <div
                      className="relative"
                      role="region"
                      aria-roledescription="carousel"
                      aria-label="Promoted listings"
                      tabIndex={-1}
                      onMouseEnter={() => setIsCarouselPaused(true)}
                      onMouseLeave={() => setIsCarouselPaused(false)}
                      onMouseDownCapture={(e) => {
                        // Prevent the focusable wrapper from showing a blinking text caret
                        // when users click "empty" space around the dots/cards.
                        const target = e.target as HTMLElement | null;
                        const isInteractive = !!target?.closest?.(
                          'button, a, input, select, textarea, [role="button"], [role="tab"]'
                        );
                        if (!isInteractive) e.preventDefault();
                      }}
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
                          setFeaturedAnimMs(450);
                          setFeaturedAnimate(true);
                          setFeaturedIndex(0);
                        } else if (e.key === "End") {
                          e.preventDefault();
                          setFeaturedAnimMs(450);
                          setFeaturedAnimate(true);
                          setFeaturedIndex(Math.max(0, colCount - VISIBLE_COLS));
                        }
                      }}
                      onTouchStart={(e) => setTouchStartX(e.touches[0]?.clientX ?? null)}
                      onTouchEnd={(e) => {
                        if (!hasOverflow) return;
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
                              className="absolute left-2 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-md hover:bg-slate-50 hover:text-slate-900 sm:left-0 sm:-translate-x-full"
                              aria-label="Previous promoted listing"
                            >
                              <span aria-hidden="true">←</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => shift(1)}
                              className="absolute right-2 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-md hover:bg-slate-50 hover:text-slate-900 sm:right-0 sm:translate-x-full"
                              aria-label="Next promoted listing"
                            >
                              <span aria-hidden="true">→</span>
                            </button>
                          </>
                        )}

                        {!hasOverflow ? (
                          <div
                            className="grid min-w-0 gap-4"
                            style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(colCount, VISIBLE_COLS))}, minmax(0, 1fr))` }}
                          >
                            {Array.from({ length: Math.min(colCount, VISIBLE_COLS) }, (_, colIdx) => colIdx).map((colIdx) => (
                              <div key={`featured-col-static-${colIdx}`} className="min-w-0">
                                <div className="flex flex-col gap-4">
                                  {cols[colIdx]?.map((t, r) => {
                                    if (!t) return null;
                                    if (t.kind === "sale") {
                                      return (
                                        <Link
                                          key={t.item.id}
                                          to={`/listing/sale/${t.item.id}`}
                                          state={{
                                            from: {
                                              pathname: routerLocation.pathname,
                                              search: routerLocation.search,
                                              label: "homepage",
                                            },
                                          }}
                                          className="block min-w-0"
                                        >
                                          <FeaturedCard item={{ kind: "sale", item: t.item }} />
                                        </Link>
                                      );
                                    }
                                    if (t.kind === "wanted") {
                                      return (
                                        <Link
                                          key={t.item.id}
                                          to={`/listing/wanted/${t.item.id}`}
                                          state={{
                                            from: {
                                              pathname: routerLocation.pathname,
                                              search: routerLocation.search,
                                              label: "homepage",
                                            },
                                          }}
                                          className="block min-w-0"
                                        >
                                          <FeaturedCard item={{ kind: "wanted", item: t.item }} />
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
                                transform: `translateX(-${safeColIndex * (100 / VISIBLE_COLS)}%)`,
                                transition: featuredAnimate ? `transform ${featuredAnimMs}ms ease` : "none",
                              }}
                              onTransitionEnd={(e) => {
                                if (e.propertyName !== "transform") return;
                                setFeaturedAnimate(false);
                              }}
                            >
                              {Array.from({ length: colCount }, (_, colIdx) => colIdx).map((colIdx) => (
                                <div
                                  key={`featured-col-${colIdx}`}
                                  className="shrink-0 px-2"
                                  style={{ width: `${100 / VISIBLE_COLS}%` }}
                                >
                                  <div className="flex flex-col gap-4">
                                    {cols[colIdx]?.map((t, r) => {
                                      if (!t) return null;
                                      if (t.kind === "sale") {
                                        return (
                                          <Link
                                            key={t.item.id}
                                            to={`/listing/sale/${t.item.id}`}
                                            state={{
                                              from: {
                                                pathname: routerLocation.pathname,
                                                search: routerLocation.search,
                                                label: "homepage",
                                              },
                                            }}
                                            className="block min-w-0"
                                          >
                                            <FeaturedCard item={{ kind: "sale", item: t.item }} />
                                          </Link>
                                        );
                                      }
                                      if (t.kind === "wanted") {
                                        return (
                                          <Link
                                            key={t.item.id}
                                            to={`/listing/wanted/${t.item.id}`}
                                            state={{
                                              from: {
                                                pathname: routerLocation.pathname,
                                                search: routerLocation.search,
                                                label: "homepage",
                                              },
                                            }}
                                            className="block min-w-0"
                                          >
                                            <FeaturedCard item={{ kind: "wanted", item: t.item }} />
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
                          className="relative z-10 mt-4 flex flex-wrap items-center justify-center gap-1 select-none"
                          role="tablist"
                          aria-label="Promoted listing position"
                        >
                          {Array.from({ length: maxStart + 1 }, (_, i) => {
                            const active = i === safeColIndex;
                            return (
                              <button
                                key={`featured-dot-${i}`}
                                type="button"
                                onMouseDown={(e) => {
                                  // Prevent a blinking text caret when clicking the "empty"
                                  // part of the dot hit area (keeps keyboard accessibility).
                                  e.preventDefault();
                                }}
                                onClick={() => jumpTo(i)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full cursor-pointer caret-transparent"
                                aria-label={`Go to featured position ${i + 1} of ${maxStart + 1}`}
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
                })()
              ) : null}
            </div>
          </section>
        </main>

      </div>
    </div>
  );
}
