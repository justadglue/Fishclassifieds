import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { useAuth } from "../auth";
import { createWantedPost, getListingOptionsCached, type Category, type WaterType } from "../api";

function dollarsToCents(s: string) {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export default function WantedPostPage() {
  const nav = useNavigate();
  const { user, loading } = useAuth();

  const [categories, setCategories] = useState<Category[]>([]);
  const [waterTypes, setWaterTypes] = useState<WaterType[]>([]);
  const [bioRequiredCategories, setBioRequiredCategories] = useState<Set<string>>(new Set());
  const [otherCategoryName, setOtherCategoryName] = useState("Other");

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("");
  const [species, setSpecies] = useState("");
  const [waterType, setWaterType] = useState<WaterType | "">("");
  const [location, setLocation] = useState("");
  const [minBudget, setMinBudget] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) nav(`/auth?next=${encodeURIComponent("/post/wanted")}&ctx=wanted_post`);
  }, [loading, user, nav]);

  useEffect(() => {
    let cancelled = false;
    getListingOptionsCached()
      .then((opts) => {
        if (cancelled) return;
        setCategories(opts.categories as Category[]);
        setWaterTypes((opts as any).waterTypes as WaterType[]);
        setBioRequiredCategories(new Set(((opts as any).bioFieldsRequiredCategories as string[]) ?? []));
        setOtherCategoryName(String((opts as any).otherCategory ?? "Other"));
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isOtherCategory = String(category) === String(otherCategoryName);
  const bioFieldsRequired = bioRequiredCategories.has(String(category));
  const bioFieldsDisabled = Boolean(category) && !bioFieldsRequired && !isOtherCategory;
  const bioFieldsEnabled = !bioFieldsDisabled;

  useEffect(() => {
    if (!category) return;
    if (!bioFieldsDisabled) return;
    setSpecies("");
    setWaterType("");
  }, [category, bioFieldsDisabled]);

  const budgetMinCents = useMemo(() => dollarsToCents(minBudget), [minBudget]);
  const budgetMaxCents = useMemo(() => dollarsToCents(maxBudget), [maxBudget]);
  const maxDescLen = 1000;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      if (!category) throw new Error("Category is required.");
      if (bioFieldsRequired && !waterType) throw new Error("Water type is required.");
      const finalDescription = String(description ?? "").trim();
      const w = await createWantedPost({
        title: title.trim(),
        category,
        species: species.trim() ? species.trim() : null,
        waterType: bioFieldsEnabled && waterType ? waterType : null,
        budgetMinCents,
        budgetMaxCents,
        location: location.trim(),
        description: finalDescription,
      });
      nav(`/wanted/${w.id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create wanted post");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-full">
      <Header maxWidth="6xl" />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Post a wanted</h1>
        <p className="mt-1 text-sm text-slate-600">Describe what you’re looking to buy. Sellers will be able to message you (coming soon).</p>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

        <form onSubmit={onSubmit} className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-6">
          <label className="block">
            <div className="mb-1 text-xs font-semibold text-slate-700">Title</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={3}
              maxLength={80}
              placeholder="e.g. Looking for a pair of breeding angelfish"
              className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Category</div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-slate-400"
                required
              >
                {!categories.length ? (
                  <option value="" disabled>
                    Loading…
                  </option>
                ) : (
                  <>
                    <option value="" disabled hidden>
                      Select…
                    </option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Species (optional)</div>
              <input
                value={species}
                onChange={(e) => setSpecies(e.target.value)}
                placeholder="e.g. betta, cherry shrimp"
                disabled={bioFieldsDisabled}
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
              />
            </label>
          </div>

          <label className="block">
            <div className="mb-1 text-xs font-semibold text-slate-700">Water type</div>
            <select
              value={waterType}
              onChange={(e) => setWaterType(e.target.value as WaterType)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
              required={bioFieldsRequired}
              disabled={bioFieldsDisabled}
            >
              <option value="" disabled hidden>
                Select…
              </option>
              {waterTypes.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="mb-1 text-xs font-semibold text-slate-700">Location</div>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              required
              minLength={2}
              maxLength={80}
              placeholder="e.g. Brisbane"
              className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Budget min ($, optional)</div>
              <input
                value={minBudget}
                onChange={(e) => setMinBudget(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Budget max ($, optional)</div>
              <input
                value={maxBudget}
                onChange={(e) => setMaxBudget(e.target.value)}
                inputMode="decimal"
                placeholder="200"
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400"
              />
            </label>
          </div>

          <label className="block">
            <div className="mb-1 text-xs font-semibold text-slate-700">Description</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={6}
              maxLength={maxDescLen}
              placeholder="Include any details: size, quantity, preferred pickup, timeframe..."
              className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400"
            />
          </label>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => nav("/browse?type=wanted")}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {submitting ? "Posting..." : "Post wanted"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

