import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MapPin } from "lucide-react";
import {
  fetchListings,
  fetchWanted,
  resolveAssets,
  type Listing,
  type WantedPost,
} from "../api";
import Header from "../components/Header";
import NoPhotoPlaceholder from "../components/NoPhotoPlaceholder";
import { decodeSaleDetailsFromDescription, decodeWantedDetailsFromDescription } from "../utils/listingDetailsBlock";
import BrowseFilters from "../components/BrowseFilters";
import { SPECIES_PRESETS, useBrowseFilterState } from "../utils/useBrowseFilterState";

type PageSize = 12 | 24 | 48 | 96;

function centsToDollars(cents: number) {
  const s = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${s}`;
}

function relativeTime(iso: string) {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(0, Math.floor((now - d) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

function descriptionPreview(raw: string) {
  const decoded = decodeSaleDetailsFromDescription(raw);
  const body = decoded.hadPrefix ? decoded.body : raw;
  return body.replace(/\s+/g, " ").trim();
}

function wantedDescriptionPreview(raw: string) {
  const decoded = decodeWantedDetailsFromDescription(raw);
  const body = decoded.hadPrefix ? decoded.body : raw;
  return body.replace(/\s+/g, " ").trim();
}

const PAGE_SIZES: PageSize[] = [12, 24, 48, 96];

function budgetPillText(w: WantedPost) {
  const budget = w.budgetCents ?? null;
  if (budget == null) return "Make an offer";
  return `Up to ${centsToDollars(budget)}`;
}

function buildPageButtons(current: number, totalPages: number) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const out: (number | "…")[] = [];
  const show = new Set<number>();
  show.add(1);
  show.add(totalPages);

  for (let p = current - 2; p <= current + 2; p++) {
    if (p >= 1 && p <= totalPages) show.add(p);
  }

  show.add(2);
  show.add(3);
  show.add(totalPages - 1);
  show.add(totalPages - 2);

  const pages = Array.from(show).sort((a, b) => a - b);
  let prev = 0;
  for (const p of pages) {
    if (prev && p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

function PaginationBar(props: {
  page: number;
  totalPages: number;
  loading: boolean;
  canPrev: boolean;
  canNext: boolean;
  pageButtons: (number | "…")[];
  onPrev: () => void;
  onNext: () => void;
  onGoPage: (p: number) => void;
}) {
  const { page, totalPages, loading, canPrev, canNext, pageButtons, onPrev, onNext, onGoPage } = props;
  if (totalPages <= 1) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        onClick={onPrev}
        disabled={!canPrev || loading}
        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
      >
        Prev
      </button>

      {pageButtons.map((p, i) =>
        p === "…" ? (
          <div key={`dots-${i}`} className="px-2 text-sm font-semibold text-slate-500">
            …
          </div>
        ) : (
          <button
            key={`page-${p}`}
            type="button"
            onClick={() => onGoPage(p)}
            disabled={loading}
            className={[
              "rounded-xl border px-3 py-2 text-sm font-semibold",
              p === page ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
              loading ? "opacity-60" : "",
            ].join(" ")}
            aria-current={p === page ? "page" : undefined}
          >
            {p}
          </button>
        )
      )}

      <button
        type="button"
        onClick={onNext}
        disabled={!canNext || loading}
        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
      >
        Next
      </button>
    </div>
  );
}

function StatusPill({ l }: { l: Listing }) {
  if (l.status !== "pending") return null;
  return (
    <div className="absolute left-3 top-3 rounded-full bg-black/55 px-2 py-1 text-[11px] font-bold text-white backdrop-blur">
      Pending
    </div>
  );
}

export default function BrowseListings() {
  const routerLocation = useLocation();
  const filter = useBrowseFilterState();
  const {
    sp,
    setSp,
    topRef,
    browseType,
    q,
    category,
    species,
    location,
    waterType,
    sex,
    shippingOnly,
    minDollars,
    maxDollars,
    budgetDollars,
    sort,
    page,
    per,
    minCents,
    maxCents,
    budgetCents,
    bioFieldsDisabled,
    categoryOptions,
    waterTypes,
    listingSexes,
    wantedSexOptions,
    setParam,
    setBrowseType,
    clearFilters,
  } = filter;

  const [saleItems, setSaleItems] = useState<Listing[]>([]);
  const [wantedItems, setWantedItems] = useState<WantedPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bottomScrollPending, setBottomScrollPending] = useState(false);

  const offset = (page - 1) * per;
  const totalPages = Math.max(1, Math.ceil(total / per));
  const pageButtons = buildPageButtons(page, totalPages);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setErr(null);
      try {
        const data =
          browseType === "sale"
            ? await fetchListings({
              q: q || undefined,
              category: category || undefined,
              species: species || undefined,
              location: location || undefined,
              waterType: waterType || undefined,
              sex: sex || undefined,
              shippingOffered: shippingOnly || undefined,
              minPriceCents: minCents,
              maxPriceCents: maxCents,
              sort,
              limit: per,
              offset,
            })
            : await fetchWanted({
              q: q || undefined,
              category: category || undefined,
              species: species || undefined,
              location: location || undefined,
              waterType: waterType || undefined,
              sex: sex || undefined,
              minBudgetCents: budgetCents,
              sort,
              limit: per,
              offset,
            });

        if (cancelled) return;

        if (browseType === "sale") {
          setSaleItems(data.items as Listing[]);
          setWantedItems([]);
        } else {
          setWantedItems(data.items as WantedPost[]);
          setSaleItems([]);
        }
        setTotal(data.total);

        const tp = Math.max(1, Math.ceil(data.total / per));
        if (page > tp) {
          const nextSp = new URLSearchParams(sp);
          nextSp.set("page", String(tp));
          setSp(nextSp, { replace: true });
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? (browseType === "sale" ? "Failed to load listings" : "Failed to load wanted posts"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [
    browseType,
    q,
    category,
    species,
    location,
    waterType,
    sex,
    shippingOnly,
    minCents,
    maxCents,
    sort,
    per,
    page,
    offset,
    sp,
    setSp,
  ]);

  function scrollToTop(behaviorOverride?: ScrollBehavior) {
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const behavior: ScrollBehavior = behaviorOverride ?? (prefersReducedMotion ? "auto" : "smooth");

    // Prefer scrolling a real element into view so this works even if the page is inside a nested scroll container.
    if (topRef.current) {
      topRef.current.scrollIntoView({ behavior, block: "start" });
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior });
  }

  function scrollToTopFromBottomReliable() {
    // Paging can cause the pagination UI + result grid to reflow (e.g. "…" appears/disappears) and images can
    // load after render. Both can interact with browser scroll anchoring and leave the scroll position "partway".
    // For the *bottom* pager only, do a hard scroll-to-top a few times and temporarily disable anchoring.
    const prevAnchorHtml = document.documentElement.style.overflowAnchor;
    const prevAnchorBody = document.body.style.overflowAnchor;
    document.documentElement.style.overflowAnchor = "none";
    document.body.style.overflowAnchor = "none";

    const doScroll = () => {
      scrollToTop("auto");
      // Also force window top as a backup in case the ref scroll targets a nested container.
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };

    doScroll();
    const t1 = window.setTimeout(doScroll, 50);
    const t2 = window.setTimeout(doScroll, 250);
    const t3 = window.setTimeout(() => {
      document.documentElement.style.overflowAnchor = prevAnchorHtml;
      document.body.style.overflowAnchor = prevAnchorBody;
    }, 500);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      document.documentElement.style.overflowAnchor = prevAnchorHtml;
      document.body.style.overflowAnchor = prevAnchorBody;
    };
  }

  function goPage(p: number) {
    if (p === page) return;
    const next = new URLSearchParams(sp);
    next.set("page", String(Math.max(1, Math.min(totalPages, p))));
    setSp(next, { replace: true });
  }

  function goPageFromBottom(p: number) {
    if (p === page) return;
    setBottomScrollPending(true);
    goPage(p);
  }

  // Bottom pager only: scroll after the next page has actually loaded/rendered.
  // This avoids browser scroll-anchoring undoing the scroll when the page buttons reflow.
  useEffect(() => {
    if (!bottomScrollPending) return;
    if (loading) return;
    setBottomScrollPending(false);
    let cleanup: (() => void) | null = null;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        cleanup = scrollToTopFromBottomReliable();
      });
    });
    return () => {
      cleanup?.();
    };
  }, [bottomScrollPending, loading, page]);

  const activeCount = browseType === "sale" ? saleItems.length : wantedItems.length;
  const showingFrom = total === 0 ? 0 : (page - 1) * per + 1;
  const showingTo = Math.min(total, (page - 1) * per + activeCount);
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="min-h-full">
      <Header maxWidth="6xl" />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div ref={topRef} />
        <div className="grid gap-6 md:grid-cols-[280px_1fr]">
          <BrowseFilters
            browseType={browseType}
            setBrowseType={setBrowseType}
            clearFilters={clearFilters}
            location={location}
            setLocation={(v) => setParam("location", v)}
            shippingOnly={shippingOnly}
            setShippingOnly={(v) => setParam("ship", v ? "1" : "")}
            waterType={waterType}
            setWaterType={(v) => setParam("waterType", v)}
            waterTypes={waterTypes}
            category={category}
            setCategory={(v) => setParam("category", v)}
            categoryOptions={categoryOptions}
            species={species}
            setSpecies={(v) => setParam("species", v)}
            speciesPresets={[...SPECIES_PRESETS]}
            minDollars={minDollars}
            setMinDollars={(v) => setParam("min", v)}
            maxDollars={maxDollars}
            setMaxDollars={(v) => setParam("max", v)}
            budgetDollars={budgetDollars}
            setBudgetDollars={(v) => setParam("budget", v)}
            sex={sex}
            setSex={(v) => setParam("sex", v)}
            listingSexes={listingSexes}
            wantedSexOptions={wantedSexOptions}
            bioFieldsDisabled={bioFieldsDisabled}
          />

          <section>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-extrabold text-slate-900">Browse</h1>
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {loading ? "Loading..." : total === 0 ? "0 results" : `Showing ${showingFrom}–${showingTo} of ${total}`}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Keep layout identical between Sale/Wanted to avoid UI "jumping" when toggling listing type. */}
                <label className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700">Sort</span>
                  <select
                    value={sort}
                    onChange={(e) => setParam("sort", e.target.value)}
                    className={[
                      "min-w-[190px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400",
                    ].join(" ")}
                  >
                    <option value="newest">Newest</option>
                    {browseType === "sale" ? (
                      <>
                        <option value="price_asc">Price: Low → High</option>
                        <option value="price_desc">Price: High → Low</option>
                      </>
                    ) : (
                      <>
                        <option value="budget_asc">Budget: Low → High</option>
                        <option value="budget_desc">Budget: High → Low</option>
                      </>
                    )}
                  </select>
                </label>

                <label className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700">Per page</span>
                  <select
                    value={String(per)}
                    onChange={(e) => setParam("per", e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                  >
                    {PAGE_SIZES.map((n) => (
                      <option key={n} value={String(n)}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {/* Search bar (above the results grid) */}
            <div className="mt-4">
              <div className="flex items-center gap-2 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-2">
                <span className="select-none text-slate-400" aria-hidden="true">
                  ⌕
                </span>
                <input
                  value={q}
                  onChange={(e) => setParam("q", e.target.value)}
                  placeholder="Search"
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                />
                {q.trim() ? (
                  <button
                    type="button"
                    onClick={() => setParam("q", "")}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    aria-label="Clear search"
                    title="Clear"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>

            <PaginationBar
              page={Math.min(page, totalPages)}
              totalPages={totalPages}
              loading={loading}
              canPrev={canPrev}
              canNext={canNext}
              pageButtons={pageButtons}
              onPrev={() => goPage(page - 1)}
              onNext={() => goPage(page + 1)}
              onGoPage={goPage}
            />

            {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

            {!loading && !err && total === 0 && (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
                <div className="text-sm font-semibold text-slate-900">No results</div>
                <div className="mt-1 text-sm text-slate-600">Try clearing filters, or posting the first listing.</div>
              </div>
            )}

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {browseType === "sale"
                ? saleItems.map((l) => {
                  const assets = resolveAssets(l.images ?? []);
                  const hero = assets[0]?.medUrl ?? assets[0]?.fullUrl ?? null;

                  return (
                    <Link
                      key={l.id}
                      to={`/listing/sale/${l.id}`}
                      state={{
                        from: { pathname: routerLocation.pathname, search: routerLocation.search, label: "listings" },
                      }}
                      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white hover:border-slate-300"
                    >
                      <div className="relative aspect-4/3 w-full bg-slate-100">
                        <StatusPill l={l} />
                        {hero ? (
                          <img
                            src={hero}
                            alt={l.title}
                            className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <NoPhotoPlaceholder variant="tile" />
                        )}
                      </div>

                      <div className="p-4 pb-12">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-extrabold text-slate-900">{l.title}</div>
                            <div className="mt-1 truncate text-xs font-semibold text-slate-600">
                              <span className="inline-flex items-center gap-1">
                                <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                                <span className="min-w-0 truncate">
                                  {l.location} • {l.shippingOffered ? "Shipping offered" : "Local only"}
                                </span>
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 line-clamp-2 text-xs text-slate-700">
                          {descriptionPreview(l.description) || "No description."}
                        </div>
                      </div>

                      <div className="absolute bottom-4 left-4 text-[11px] font-semibold text-slate-500">
                        {relativeTime(l.createdAt)}
                      </div>
                      <div className="absolute bottom-4 right-4 rounded-xl bg-slate-900 px-3 py-1 text-xs font-bold text-white shadow-sm">
                        {centsToDollars(l.priceCents)}
                      </div>
                    </Link>
                  );
                })
                : wantedItems.map((w) => (
                  <Link
                    key={w.id}
                    to={`/listing/wanted/${w.id}`}
                    state={{
                      from: { pathname: routerLocation.pathname, search: routerLocation.search, label: "wanted" },
                    }}
                    className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white hover:border-slate-300"
                  >
                    {(() => {
                      const assets = resolveAssets(w.images ?? []);
                      const hero = assets[0]?.medUrl ?? assets[0]?.fullUrl ?? null;
                      return (
                        <div className="relative aspect-4/3 w-full bg-slate-100">
                          {hero ? (
                            <img
                              src={hero}
                              alt={w.title}
                              className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <NoPhotoPlaceholder variant="tile" />
                          )}
                        </div>
                      );
                    })()}
                    <div className="p-4 pb-12">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-extrabold text-slate-900">{w.title}</div>
                          <div className="mt-1 truncate text-xs font-semibold text-slate-600">
                            <span className="inline-flex items-center gap-1">
                              <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                              <span className="min-w-0 truncate">
                                {w.location}
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 line-clamp-3 text-xs text-slate-700">
                        {wantedDescriptionPreview(w.description) || "No description."}
                      </div>

                    </div>

                    <div className="absolute bottom-4 left-4 text-[11px] font-semibold text-slate-500">
                      {relativeTime(w.createdAt)}
                    </div>
                    <div className="absolute bottom-4 right-4 rounded-xl bg-slate-900 px-3 py-1 text-xs font-bold text-white shadow-sm">
                      {budgetPillText(w)}
                    </div>
                  </Link>
                ))}
            </div>

            <div style={{ overflowAnchor: "none" }}>
              <PaginationBar
                page={Math.min(page, totalPages)}
                totalPages={totalPages}
                loading={loading}
                canPrev={canPrev}
                canNext={canNext}
                pageButtons={pageButtons}
                onPrev={() => goPageFromBottom(page - 1)}
                onNext={() => goPageFromBottom(page + 1)}
                onGoPage={goPageFromBottom}
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
