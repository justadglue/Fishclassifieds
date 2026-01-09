import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchListings, fetchWanted, resolveAssets, type Category, type Listing, type WantedPost, type WantedStatus } from "../api";
import Header from "../components/Header";

type SortMode = "newest" | "price_asc" | "price_desc";
type PageSize = 12 | 24 | 48 | 96;
type BrowseType = "sale" | "wanted";

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "AUD" });
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

const CATEGORIES: ("" | Category)[] = ["", "Fish", "Shrimp", "Snails", "Plants", "Equipment"];
const PAGE_SIZES: PageSize[] = [12, 24, 48, 96];

function budgetLabel(w: WantedPost) {
  const min = w.budgetMinCents ?? null;
  const max = w.budgetMaxCents ?? null;
  if (min == null && max == null) return "Budget: any";
  if (min != null && max != null) return `Budget: ${centsToDollars(min)}–${centsToDollars(max)}`;
  if (min != null) return `Budget: ${centsToDollars(min)}+`;
  return `Budget: up to ${centsToDollars(max!)}`;
}

function clampInt(v: string | null, fallback: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
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
  const [sp, setSp] = useSearchParams();
  const topRef = useRef<HTMLDivElement | null>(null);

  const browseType: BrowseType = sp.get("type") === "wanted" ? "wanted" : "sale";

  const q = sp.get("q") ?? "";
  const category = (sp.get("category") ?? "") as "" | Category;
  const species = sp.get("species") ?? "";
  const minDollars = sp.get("min") ?? "";
  const maxDollars = sp.get("max") ?? "";
  const sort = (sp.get("sort") ?? "newest") as SortMode;
  const wantedStatus = (sp.get("status") ?? "open") as WantedStatus;

  const page = clampInt(sp.get("page"), 1, 1, 999999);
  const per = clampInt(sp.get("per"), 24, 12, 200) as PageSize;

  const [saleItems, setSaleItems] = useState<Listing[]>([]);
  const [wantedItems, setWantedItems] = useState<WantedPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const minCents = useMemo(() => {
    const s = String(minDollars ?? "").trim();
    if (!s) return undefined;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
  }, [minDollars]);

  const maxCents = useMemo(() => {
    const s = String(maxDollars ?? "").trim();
    if (!s) return undefined;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
  }, [maxDollars]);

  const offset = (page - 1) * per;
  const totalPages = Math.max(1, Math.ceil(total / per));
  const pageButtons = buildPageButtons(page, totalPages);

  const speciesPresets = [
    "",
    "guppy",
    "betta",
    "goldfish",
    "angelfish",
    "discus",
    "neon tetra",
    "corydoras",
    "shrimp",
    "snails",
    "plants",
    "equipment",
  ];

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
                status: wantedStatus,
                minBudgetCents: minCents,
                maxBudgetCents: maxCents,
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
  }, [browseType, q, category, species, wantedStatus, minCents, maxCents, sort, per, page, offset, sp, setSp]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(sp);
    const resetsPage = key !== "page";
    if (resetsPage) next.set("page", "1");
    if (!value) next.delete(key);
    else next.set(key, value);
    setSp(next, { replace: true });
  }

  function setBrowseType(nextType: BrowseType) {
    const next = new URLSearchParams(sp);
    next.set("type", nextType);
    next.set("page", "1");
    if (nextType === "wanted") {
      if (!next.get("status")) next.set("status", "open");
      next.delete("sort");
    } else {
      next.delete("status");
      if (!next.get("sort")) next.set("sort", "newest");
    }
    setSp(next, { replace: true });
  }

  function clearFilters() {
    setSp(new URLSearchParams(), { replace: true });
  }

  function scrollToTop() {
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const behavior: ScrollBehavior = prefersReducedMotion ? "auto" : "smooth";

    // Prefer scrolling a real element into view so this works even if the page is inside a nested scroll container.
    if (topRef.current) {
      topRef.current.scrollIntoView({ behavior, block: "start" });
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior });
  }

  function goPage(p: number) {
    if (p === page) return;
    const next = new URLSearchParams(sp);
    next.set("page", String(Math.max(1, Math.min(totalPages, p))));
    setSp(next, { replace: true });
  }

  function goPageFromBottom(p: number) {
    if (p === page) return;
    goPage(p);

    // Defer to avoid any scroll restoration / layout shifts immediately after the URL change.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollToTop();
      });
    });
  }

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
          <aside className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-900">Filters</div>
              <button type="button" onClick={clearFilters} className="text-xs font-semibold text-slate-600 hover:text-slate-900">
                Clear
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Listing type</div>
                <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <button
                    type="button"
                    onClick={() => setBrowseType("sale")}
                    className={[
                      "flex-1 px-3 py-2 text-sm font-semibold",
                      browseType === "sale" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
                    ].join(" ")}
                    aria-pressed={browseType === "sale"}
                  >
                    For sale
                  </button>
                  <button
                    type="button"
                    onClick={() => setBrowseType("wanted")}
                    className={[
                      "flex-1 px-3 py-2 text-sm font-semibold",
                      browseType === "wanted" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
                    ].join(" ")}
                    aria-pressed={browseType === "wanted"}
                  >
                    Wanted
                  </button>
                </div>
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Search</div>
                <input
                  value={q}
                  onChange={(e) => setParam("q", e.target.value)}
                  placeholder={browseType === "sale" ? "e.g. guppy, Brisbane, breeder..." : "e.g. betta, Brisbane, nano tank..."}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Category</div>
                <select
                  value={category}
                  onChange={(e) => setParam("category", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c || "Any"} value={c}>
                      {c ? c : "Any"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Species</div>
                <select
                  value={species}
                  onChange={(e) => setParam("species", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                >
                  {speciesPresets.map((s) => (
                    <option key={s} value={s}>
                      {s ? s : "Any"}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <div className="mb-1 text-xs font-semibold text-slate-700">{browseType === "sale" ? "Min price ($)" : "Min budget ($)"}</div>
                  <input
                    value={minDollars}
                    onChange={(e) => setParam("min", e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-xs font-semibold text-slate-700">{browseType === "sale" ? "Max price ($)" : "Max budget ($)"}</div>
                  <input
                    value={maxDollars}
                    onChange={(e) => setParam("max", e.target.value)}
                    inputMode="decimal"
                    placeholder="200"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                </label>
              </div>

              {browseType === "wanted" && (
                <label className="block">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Status</div>
                  <select
                    value={wantedStatus}
                    onChange={(e) => setParam("status", e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  >
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
              )}

              <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                {browseType === "sale"
                  ? "Tip: category narrows broad items; search finds details like “cherry”, “pair”, “breeder”."
                  : "Tip: use search for details like “pair”, “juvenile”, or “pickup”. Include location for local-only requests."}
              </div>
            </div>
          </aside>

          <section>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-extrabold text-slate-900">Browse</h1>
                  <div className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700">
                    {browseType === "sale" ? "For sale" : "Wanted"}
                  </div>
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {loading ? "Loading..." : total === 0 ? "0 results" : `Showing ${showingFrom}–${showingTo} of ${total}`}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {browseType === "sale" && (
                  <label className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700">Sort</span>
                    <select
                      value={sort}
                      onChange={(e) => setParam("sort", e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                    >
                      <option value="newest">Newest</option>
                      <option value="price_asc">Price: Low → High</option>
                      <option value="price_desc">Price: High → Low</option>
                    </select>
                  </label>
                )}

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
                        to={`/listing/${l.id}`}
                        className="group overflow-hidden rounded-2xl border border-slate-200 bg-white hover:border-slate-300"
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
                            <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-500">
                              No image
                            </div>
                          )}
                        </div>

                        <div className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-extrabold text-slate-900">{l.title}</div>
                              <div className="mt-1 truncate text-xs font-semibold text-slate-600">
                                {l.category} • {l.species} • {l.location}
                              </div>
                            </div>
                            <div className="shrink-0 rounded-xl bg-slate-900 px-3 py-1 text-xs font-bold text-white">
                              {centsToDollars(l.priceCents)}
                            </div>
                          </div>
                          <div className="mt-3 line-clamp-2 text-xs text-slate-700">{l.description}</div>
                          <div className="mt-3 text-[11px] font-semibold text-slate-500">{relativeTime(l.createdAt)}</div>
                        </div>
                      </Link>
                    );
                  })
                : wantedItems.map((w) => (
                    <Link
                      key={w.id}
                      to={`/wanted/${w.id}`}
                      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white hover:border-slate-300"
                    >
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-extrabold text-slate-900">{w.title}</div>
                            <div className="mt-1 truncate text-xs font-semibold text-slate-600">
                              {w.category}
                              {w.species ? ` • ${w.species}` : ""} • {w.location}
                            </div>
                          </div>
                          <div
                            className={[
                              "shrink-0 rounded-full px-2 py-1 text-[11px] font-bold",
                              w.status === "open" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700",
                            ].join(" ")}
                          >
                            {w.status === "open" ? "Open" : "Closed"}
                          </div>
                        </div>

                        <div className="mt-3 text-xs font-semibold text-slate-700">{budgetLabel(w)}</div>
                        <div className="mt-3 line-clamp-3 text-xs text-slate-700">{w.description}</div>

                        <div className="mt-3 flex items-center justify-between gap-3 text-[11px] font-semibold text-slate-500">
                          <div>{relativeTime(w.createdAt)}</div>
                          <div className="truncate">{w.userDisplayName ? `Wanted by ${w.userDisplayName}` : ""}</div>
                        </div>
                      </div>
                    </Link>
                  ))}
            </div>

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
          </section>
        </div>
      </main>
    </div>
  );
}
