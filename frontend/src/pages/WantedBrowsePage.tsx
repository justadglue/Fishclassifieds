import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Header from "../components/Header";
import { fetchWanted, getListingOptionsCached, type Category, type WantedPost } from "../api";

type PageSize = 12 | 24 | 48 | 96;

const PAGE_SIZES: PageSize[] = [12, 24, 48, 96];

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

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "AUD" });
}

function clampInt(v: string | null, fallback: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function budgetLabel(w: WantedPost) {
  const min = w.budgetMinCents ?? null;
  const max = w.budgetMaxCents ?? null;
  if (min == null && max == null) return "Budget: any";
  if (min != null && max != null) return `Budget: ${centsToDollars(min)}–${centsToDollars(max)}`;
  if (min != null) return `Budget: ${centsToDollars(min)}+`;
  return `Budget: up to ${centsToDollars(max!)}`;
}

export default function WantedBrowsePage() {
  const [sp, setSp] = useSearchParams();

  const q = sp.get("q") ?? "";
  const category = (sp.get("category") ?? "") as "" | Category;
  const species = sp.get("species") ?? "";
  const minDollars = sp.get("min") ?? "";
  const maxDollars = sp.get("max") ?? "";
  const status = (sp.get("status") ?? "open") as "open" | "closed";

  const page = clampInt(sp.get("page"), 1, 1, 999999);
  const per = clampInt(sp.get("per"), 24, 12, 200) as PageSize;
  const offset = (page - 1) * per;

  const [items, setItems] = useState<WantedPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const categoryOptions = useMemo(() => ["", ...categories] as Array<"" | Category>, [categories]);

  useEffect(() => {
    let cancelled = false;
    getListingOptionsCached()
      .then((opts) => {
        if (cancelled) return;
        setCategories(opts.categories as Category[]);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const minBudgetCents = useMemo(() => {
    const s = String(minDollars ?? "").trim();
    if (!s) return undefined;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
  }, [minDollars]);

  const maxBudgetCents = useMemo(() => {
    const s = String(maxDollars ?? "").trim();
    if (!s) return undefined;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
  }, [maxDollars]);

  const totalPages = Math.max(1, Math.ceil(total / per));
  const showingFrom = total === 0 ? 0 : (page - 1) * per + 1;
  const showingTo = Math.min(total, (page - 1) * per + items.length);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setErr(null);
      try {
        const data = await fetchWanted({
          q: q || undefined,
          category: category || undefined,
          species: species || undefined,
          status,
          minBudgetCents,
          maxBudgetCents,
          limit: per,
          offset,
        });
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.total);

        const tp = Math.max(1, Math.ceil(data.total / per));
        if (page > tp) {
          const nextSp = new URLSearchParams(sp);
          nextSp.set("page", String(tp));
          setSp(nextSp, { replace: true });
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load wanted posts");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [q, category, species, status, minBudgetCents, maxBudgetCents, per, page, offset, sp, setSp]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(sp);
    const resetsPage = key !== "page";
    if (resetsPage) next.set("page", "1");
    if (!value) next.delete(key);
    else next.set(key, value);
    setSp(next, { replace: true });
  }

  function clearFilters() {
    setSp(new URLSearchParams(), { replace: true });
  }

  function goPage(p: number) {
    const next = new URLSearchParams(sp);
    next.set("page", String(Math.max(1, Math.min(totalPages, p))));
    setSp(next, { replace: true });
  }

  return (
    <div className="min-h-full">
      <Header maxWidth="6xl" />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">Wanted</h1>
            <div className="mt-1 text-sm text-slate-600">
              {loading ? "Loading..." : total === 0 ? "0 results" : `Showing ${showingFrom}–${showingTo} of ${total}`}
            </div>
          </div>
          <Link
            to="/post/wanted"
            className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
          >
            Post a wanted
          </Link>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-[280px_1fr]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-900">Filters</div>
              <button type="button" onClick={clearFilters} className="text-xs font-semibold text-slate-600 hover:text-slate-900">
                Clear
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Search</div>
                <input
                  value={q}
                  onChange={(e) => setParam("q", e.target.value)}
                  placeholder="e.g. betta, brisbane, nano tank..."
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
                  {categoryOptions.map((c) => (
                    <option key={c || "Any"} value={c}>
                      {c ? c : "Any"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Species</div>
                <input
                  value={species}
                  onChange={(e) => setParam("species", e.target.value)}
                  placeholder="e.g. guppy"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Min ($)</div>
                  <input
                    value={minDollars}
                    onChange={(e) => setParam("min", e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Max ($)</div>
                  <input
                    value={maxDollars}
                    onChange={(e) => setParam("max", e.target.value)}
                    inputMode="decimal"
                    placeholder="200"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                </label>
              </div>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Status</div>
                <select
                  value={status}
                  onChange={(e) => setParam("status", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                >
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
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
          </aside>

          <section>
            <div className="flex items-center justify-between">
              <div />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => goPage(page - 1)}
                  disabled={loading || page <= 1}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
                >
                  Prev
                </button>
                <div className="text-sm font-semibold text-slate-600">
                  Page {Math.min(page, totalPages)} / {totalPages}
                </div>
                <button
                  type="button"
                  onClick={() => goPage(page + 1)}
                  disabled={loading || page >= totalPages}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
                >
                  Next
                </button>
              </div>
            </div>

            {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

            {!loading && !err && total === 0 && (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
                <div className="text-sm font-semibold text-slate-900">No wanted posts</div>
                <div className="mt-1 text-sm text-slate-600">Try clearing filters, or post the first wanted request.</div>
              </div>
            )}

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((w) => (
                <Link
                  key={w.id}
                  to={`/wanted/${w.id}`}
                  state={{
                    from: { pathname: "/browse", search: "?type=wanted", label: "wanted" },
                  }}
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
                      <div className="truncate">{w.username ? `Wanted by @${w.username}` : ""}</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

