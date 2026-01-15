import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Header from "../components/Header";
import { useAuth } from "../auth";
import { fetchWantedPost, getListingOptionsCached, updateWantedPost, type Category, type WantedPost } from "../api";

function centsToDollars(cents: number | null) {
  if (cents == null) return "";
  return String((cents / 100).toFixed(2)).replace(/\.00$/, "");
}

function dollarsToCents(s: string) {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export default function WantedEditPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, loading } = useAuth();

  const [categories, setCategories] = useState<Category[]>([]);

  const [item, setItem] = useState<WantedPost | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("");
  const [species, setSpecies] = useState("");
  const [location, setLocation] = useState("");
  const [minBudget, setMinBudget] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [description, setDescription] = useState("");

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

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const target = id ? `/wanted/edit/${id}` : "/wanted";
      nav(`/auth?next=${encodeURIComponent(target)}&ctx=wanted_edit`);
    }
  }, [loading, user, nav, id]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!id) return;
      setErr(null);
      try {
        const w = await fetchWantedPost(id);
        if (cancelled) return;
        setItem(w);
        setTitle(w.title);
        setCategory(w.category);
        setSpecies(w.species ?? "");
        setLocation(w.location);
        setMinBudget(centsToDollars(w.budgetMinCents));
        setMaxBudget(centsToDollars(w.budgetMaxCents));
        setDescription(w.description);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load wanted post");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const isOwner = useMemo(() => {
    if (!user || !item) return false;
    return Number(user.id) === Number(item.userId);
  }, [user, item]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setErr(null);
    setSaving(true);
    try {
      if (!isOwner) throw new Error("Not owner");
      const updated = await updateWantedPost(id, {
        title: title.trim(),
        category,
        species: species.trim() ? species.trim() : null,
        budgetMinCents: dollarsToCents(minBudget),
        budgetMaxCents: dollarsToCents(maxBudget),
        location: location.trim(),
        description: description.trim(),
      });
      nav(`/wanted/${updated.id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-full">
      <Header maxWidth="6xl" />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Edit wanted</h1>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}
        {!item && !err && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">Loading…</div>
        )}

        {item && (
          <form onSubmit={onSave} className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-6">
            {!isOwner && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                You can’t edit this wanted post (not the owner).
              </div>
            )}

            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Title</div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                minLength={3}
                maxLength={80}
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
                >
                  {!categories.length ? (
                    <option value="" disabled>
                      Loading…
                    </option>
                  ) : (
                    categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Species (optional)</div>
                <input
                  value={species}
                  onChange={(e) => setSpecies(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400"
                />
              </label>
            </div>

            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Location</div>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                required
                minLength={2}
                maxLength={80}
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
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Budget max ($, optional)</div>
                <input
                  value={maxBudget}
                  onChange={(e) => setMaxBudget(e.target.value)}
                  inputMode="decimal"
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
                maxLength={1000}
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400"
              />
            </label>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => nav(item ? `/wanted/${item.id}` : "/wanted")}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !isOwner}
                className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

