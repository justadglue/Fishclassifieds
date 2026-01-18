import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Header from "../components/Header";
import { useAuth } from "../auth";
import {
  type ImageAsset,
  createWantedPost,
  deleteWantedPost,
  fetchWantedPost,
  getListingOptionsCached,
  updateWantedPost,
  type Category,
  type ListingSex,
  type WantedPost,
  type WaterType,
} from "../api";
import PhotoUploader, { type PhotoUploaderHandle } from "../components/PhotoUploader";
import { MAX_MONEY_INPUT_LEN, sanitizeMoneyInput } from "../utils/money";

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
  const [sp] = useSearchParams();
  const relistMode = sp.get("relist") === "1";
  const photoUploaderRef = useRef<PhotoUploaderHandle | null>(null);
  const [initialPhotoAssets, setInitialPhotoAssets] = useState<ImageAsset[]>([]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [waterTypes, setWaterTypes] = useState<WaterType[]>([]);
  const [listingSexes, setListingSexes] = useState<ListingSex[]>([]);
  const [bioRequiredCategories, setBioRequiredCategories] = useState<Set<string>>(new Set());
  const [otherCategoryName, setOtherCategoryName] = useState("Other");

  const [item, setItem] = useState<WantedPost | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("");
  const [species, setSpecies] = useState("");
  const [waterType, setWaterType] = useState<WaterType | "">("");
  const [sex, setSex] = useState<ListingSex | "">("");
  const [age, setAge] = useState("");
  const [quantity, setQuantity] = useState<number>(1);
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [minBudget, setMinBudget] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    let cancelled = false;
    getListingOptionsCached()
      .then((opts) => {
        if (cancelled) return;
        setCategories(opts.categories as Category[]);
        setWaterTypes((opts as any).waterTypes as WaterType[]);
        setListingSexes((opts as any).listingSexes as ListingSex[]);
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
        setWaterType((w as any).waterType ?? "");
        setSex((w as any).sex ?? "");
        setAge((w as any).age ?? "");
        setQuantity(Number.isFinite(Number((w as any).quantity)) ? Math.max(1, Math.floor(Number((w as any).quantity))) : 1);
        setLocation(w.location);
        setPhone((w as any).phone ?? "");
        setMinBudget(centsToDollars(w.budgetMinCents));
        setMaxBudget(centsToDollars(w.budgetMaxCents));
        setDescription(w.description);
        setInitialPhotoAssets((w as any).images ?? []);
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

  const isOtherCategory = String(category) === String(otherCategoryName);
  const bioFieldsRequired = bioRequiredCategories.has(String(category));
  const bioFieldsDisabled = Boolean(category) && !bioFieldsRequired && !isOtherCategory;
  const bioFieldsEnabled = !bioFieldsDisabled;
  // Default to required (bio is the common case). If a non-bio category is chosen,
  // these inputs become disabled and requirements/asterisks effectively drop.
  const bioFieldsRequiredForUser = bioFieldsEnabled && !isOtherCategory;
  const ageRequired = bioFieldsEnabled && !isOtherCategory;
  const wantedSexOptions = useMemo(() => {
    const base = (listingSexes ?? []).map(String);
    const out = [...base];
    if (!out.includes("No preference")) out.push("No preference");
    return out as ListingSex[];
  }, [listingSexes]);

  useEffect(() => {
    if (!category) return;
    if (!bioFieldsDisabled) return;
    setSpecies("");
    setWaterType("");
    setSex("");
    setAge("");
  }, [category, bioFieldsDisabled]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setErr(null);
    try {
      if (!isOwner) throw new Error("Not owner");
      if (!category) throw new Error("Category is required.");
      if (bioFieldsRequiredForUser && !species.trim()) throw new Error("Species is required.");
      if (bioFieldsRequiredForUser && !waterType) throw new Error("Water type is required.");
      if (bioFieldsRequiredForUser && !sex) throw new Error("Sex is required.");
      if (ageRequired && !age.trim()) throw new Error("Age is required.");

      const qty = Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
      if (qty < 1) throw new Error("Quantity must be at least 1.");

      const phoneTrim = phone.trim();
      if (!phoneTrim) throw new Error("Phone number is required.");
      if (phoneTrim.length < 6) throw new Error("Phone number looks too short.");
      if (phoneTrim.length > 30) throw new Error("Phone number is too long.");

      const photoCounts = photoUploaderRef.current?.getCounts() ?? { total: 0, uploaded: 0 };
      if (photoCounts.total === 0) {
        const ok = window.confirm("You haven't added any photos. Update this wanted listing without photos?");
        if (!ok) return;
      }

      setSaving(true);
      await photoUploaderRef.current?.ensureUploaded();
      const uploadedAssets = photoUploaderRef.current?.getAssets() ?? [];
      if (photoCounts.total > 0 && uploadedAssets.length === 0) {
        throw new Error("Images were selected but none uploaded successfully. Remove broken images or retry upload.");
      }

      if (relistMode) {
        // Relist: create a new wanted post with these details, then archive the old one.
        const created = await createWantedPost({
          title: title.trim(),
          category,
          species: bioFieldsEnabled ? (species.trim() ? species.trim() : null) : null,
          waterType: bioFieldsEnabled && waterType ? waterType : null,
          sex: bioFieldsEnabled && sex ? sex : null,
          age: age.trim(),
          quantity: qty,
          budgetMinCents: dollarsToCents(minBudget),
          budgetMaxCents: dollarsToCents(maxBudget),
          location: location.trim(),
          phone: phoneTrim,
          description: description.trim(),
          images: uploadedAssets,
        });

        await deleteWantedPost(id);
        nav(`/wanted/${created.id}`);
        return;
      }

      const updated = await updateWantedPost(id, {
        title: title.trim(),
        category,
        species: bioFieldsEnabled ? (species.trim() ? species.trim() : null) : null,
        waterType: bioFieldsEnabled && waterType ? waterType : null,
        sex: bioFieldsEnabled && sex ? sex : null,
        age: age.trim(),
        quantity: qty,
        budgetMinCents: dollarsToCents(minBudget),
        budgetMaxCents: dollarsToCents(maxBudget),
        location: location.trim(),
        phone: phoneTrim,
        description: description.trim(),
        images: uploadedAssets,
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
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{relistMode ? "Relist wanted" : "Edit wanted"}</h1>

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

            <PhotoUploader ref={photoUploaderRef} initialAssets={initialPhotoAssets} disabled={saving || !isOwner} />

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block sm:col-span-2">
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

              <label className="block sm:col-span-1">
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
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">
                  Species {bioFieldsRequiredForUser && <span className="text-red-600">*</span>}
                </div>
                <input
                  value={species}
                  onChange={(e) => setSpecies(e.target.value)}
                  disabled={bioFieldsDisabled}
                  required={bioFieldsRequiredForUser}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">
                  Water type {bioFieldsRequiredForUser && <span className="text-red-600">*</span>}
                </div>
                <select
                  value={waterType}
                  onChange={(e) => setWaterType(e.target.value as WaterType)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                  required={bioFieldsRequiredForUser}
                  disabled={bioFieldsDisabled}
                >
                  <option value="" disabled hidden>
                    Select…
                  </option>
                  {!waterTypes.length ? (
                    <option value="" disabled>
                      Loading…
                    </option>
                  ) : (
                    waterTypes.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">
                  Sex {bioFieldsRequiredForUser && <span className="text-red-600">*</span>}
                </div>
                <select
                  value={sex}
                  onChange={(e) => setSex(e.target.value as ListingSex)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                  required={bioFieldsRequiredForUser}
                  disabled={bioFieldsDisabled}
                >
                  <option value="" disabled hidden>
                    Select…
                  </option>
                  {!wantedSexOptions.length ? (
                    <option value="" disabled>
                      Loading…
                    </option>
                  ) : (
                    wantedSexOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">
                  Age {ageRequired && <span className="text-red-600">*</span>}
                </div>
                <input
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  disabled={bioFieldsDisabled}
                  required={ageRequired}
                  maxLength={40}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Quantity</div>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={Number.isFinite(quantity) ? quantity : 1}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  required
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400"
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Budget min ($)</div>
                <input
                  value={minBudget}
                  onChange={(e) => setMinBudget(sanitizeMoneyInput(e.target.value))}
                  inputMode="decimal"
                  maxLength={MAX_MONEY_INPUT_LEN}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400"
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Budget max ($)</div>
                <input
                  value={maxBudget}
                  onChange={(e) => setMaxBudget(sanitizeMoneyInput(e.target.value))}
                  inputMode="decimal"
                  maxLength={MAX_MONEY_INPUT_LEN}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Phone number</div>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  minLength={6}
                  maxLength={30}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400"
                  autoComplete="tel"
                  inputMode="tel"
                />
              </label>

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

