import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchListings, resolveAssets, type Listing } from "../api";
import Header from "../components/Header";
import homepageBackground from "../assets/homepage_background_1.jpg";

const CATEGORIES = ["", "Fish", "Shrimp", "Snails", "Plants", "Equipment"] as const;

type Chip = { label: string; params: Record<string, string | undefined> };

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

export default function HomePage() {
  const nav = useNavigate();
  const [featured, setFeatured] = useState<Listing[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(false);
  const [featuredErr, setFeaturedErr] = useState<string | null>(null);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [featuredCols, setFeaturedCols] = useState(1);
  const [featuredSlideDir, setFeaturedSlideDir] = useState<null | (-1 | 1)>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  const [q, setQ] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("");

  // “Species” is a dedicated param your /browse page already supports.
  const [species, setSpecies] = useState("");

  // /browse supports min/max in dollars via min/max params (it converts to cents internally).
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");

  const chips: Chip[] = useMemo(
    () => [
      { label: "Guppy", params: { species: "guppy" } },
      { label: "Betta", params: { species: "betta" } },
      { label: "Shrimp", params: { category: "Shrimp" } },
      { label: "Plants", params: { category: "Plants" } },
      { label: "Equipment", params: { category: "Equipment" } },
      // location is searchable via q (your browse backend searches location)
      { label: "Brisbane", params: { q: "brisbane" } },
      { label: "Under $50", params: { max: "50" } },
    ],
    []
  );

  function goBrowse(extra?: Record<string, string | undefined>) {
    const sp = new URLSearchParams();

    const qq = (extra?.q ?? q).trim();
    const cc = extra?.category ?? category;
    const ss = (extra?.species ?? species).trim();
    const mn = (extra?.min ?? min).trim();
    const mx = (extra?.max ?? max).trim();

    if (qq) sp.set("q", qq);
    if (cc) sp.set("category", cc);
    if (ss) sp.set("species", ss);
    if (mn) sp.set("min", mn);
    if (mx) sp.set("max", mx);

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

  return (
    <div className="min-h-full">
      <Header maxWidth="6xl" />

      {/* Search and Browse Section with Background Image */}
      <div className="relative">
        <div className="absolute inset-0 -z-10">
          <img src={homepageBackground} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-linear-to-b from-slate-950/40 via-slate-950/50 to-slate-950/70" />
        </div>

        <main className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-white/90 backdrop-blur">
              Find fish, plants, shrimp, snails, and equipment near you
            </div>

            <h1 className="mt-4 text-4xl font-black tracking-tight text-white sm:text-5xl">
              Search local aquarium listings.
            </h1>
            <p className="mt-4 text-base leading-relaxed text-white/90">
              Use search and filters to find the right stock fast — then message the seller or post your own.
            </p>
          </div>

          <div className="mt-8 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg">
            <div className="p-5 sm:p-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <label className="block lg:col-span-2">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Search</div>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="e.g. guppy, brisbane, breeder..."
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400"
                  />
                </label>

                <label className="block">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Category</div>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c || "Any"} value={c} className="text-slate-900">
                        {c ? c : "Any"}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Species</div>
                  <input
                    value={species}
                    onChange={(e) => setSpecies(e.target.value)}
                    placeholder="e.g. betta"
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <div className="mb-1 text-xs font-semibold text-slate-700">Min ($)</div>
                    <input
                      value={min}
                      onChange={(e) => setMin(e.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400"
                    />
                  </label>

                  <label className="block">
                    <div className="mb-1 text-xs font-semibold text-slate-700">Max ($)</div>
                    <input
                      value={max}
                      onChange={(e) => setMax(e.target.value)}
                      inputMode="decimal"
                      placeholder="200"
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400"
                    />
                  </label>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  {chips.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() => goBrowse(c.params)}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => goBrowse()}
                    className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-extrabold text-white hover:bg-slate-800"
                  >
                    Browse
                  </button>
                  <button
                    type="button"
                    onClick={() => nav("/post")}
                    className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-extrabold text-slate-900 hover:bg-slate-50"
                  >
                    Post a listing
                  </button>
                </div>
              </div>
            </div>
          </div>

          <section className="mt-10">
            <div className="text-xs font-bold uppercase tracking-wider text-white/70">Browse by category</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { label: "Fish", params: { category: "Fish" } },
                { label: "Shrimp", params: { category: "Shrimp" } },
                { label: "Snails", params: { category: "Snails" } },
                { label: "Plants", params: { category: "Plants" } },
                { label: "Equipment", params: { category: "Equipment" } },
              ].map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => goBrowse(t.params)}
                  className="rounded-2xl border border-white/20 bg-white/10 p-4 text-left backdrop-blur hover:bg-white/20"
                >
                  <div className="text-sm font-extrabold text-white">{t.label}</div>
                  <div className="mt-1 text-xs font-semibold text-white/80">Explore</div>
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
                const VISIBLE = Math.max(1, featuredCols);
                const n = featured.length;
                const hasOverflow = n > VISIBLE;
                const safeIndex = n > 0 ? ((featuredIndex % n) + n) % n : 0;
                const isSliding = featuredSlideDir != null;

                const windowItems = hasOverflow
                  ? Array.from({ length: VISIBLE + 2 }, (_, i) => featured[(safeIndex + i - 1 + n) % n]!)
                  : featured.slice(0, VISIBLE);

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
                        setFeaturedIndex(Math.max(0, n - 1));
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
                    {/* Overlay arrows (modulo looping) */}
                    {hasOverflow && (
                      <>
                        <button
                          type="button"
                          onClick={() => shift(-1)}
                          className="absolute left-2 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-md hover:bg-slate-50 hover:text-slate-900"
                          aria-label="Previous promoted listing"
                        >
                          <span aria-hidden="true">←</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => shift(1)}
                          className="absolute right-2 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-md hover:bg-slate-50 hover:text-slate-900"
                          aria-label="Next promoted listing"
                        >
                          <span aria-hidden="true">→</span>
                        </button>
                      </>
                    )}

                    {!hasOverflow ? (
                      <div
                        className="grid min-w-0 gap-4"
                        style={{ gridTemplateColumns: `repeat(${Math.max(1, windowItems.length)}, minmax(0, 1fr))` }}
                      >
                        {windowItems.map((l) => (
                          <Link key={l.id} to={`/listing/${l.id}`} className="block min-w-0">
                            <FeaturedCard item={l} />
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div className="overflow-hidden">
                        <div
                          className="-mx-2 flex will-change-transform"
                          style={{
                            transform: `translateX(-${(1 + (isSliding ? (featuredSlideDir as -1 | 1) : 0)) * (100 / VISIBLE)}%)`,
                            transition: isSliding ? "transform 280ms ease" : "none",
                          }}
                          onTransitionEnd={(e) => {
                            if (e.propertyName !== "transform") return;
                            if (!featuredSlideDir) return;
                            const dir = featuredSlideDir;
                            setFeaturedIndex((i) => ((i + dir) % n + n) % n);
                            setFeaturedSlideDir(null);
                          }}
                        >
                          {windowItems.map((l) => (
                            <div key={`${l.id}-${safeIndex}`} className="shrink-0 px-2" style={{ width: `${100 / VISIBLE}%` }}>
                              <Link to={`/listing/${l.id}`} className="block min-w-0">
                                <FeaturedCard item={l} />
                              </Link>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {hasOverflow && (
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-2" role="tablist" aria-label="Promoted listing position">
                        {Array.from({ length: n }, (_, i) => {
                          const active = i === safeIndex;
                          return (
                            <button
                              key={`featured-dot-${i}`}
                              type="button"
                              onClick={() => setFeaturedIndex(i)}
                              className={[
                                "h-2.5 w-2.5 rounded-full border transition",
                                active
                                  ? "border-slate-900 bg-slate-900"
                                  : "border-slate-300 bg-slate-200 hover:bg-slate-300",
                              ].join(" ")}
                              aria-label={`Go to featured listing ${i + 1} of ${n}`}
                              aria-current={active ? "true" : undefined}
                            />
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

