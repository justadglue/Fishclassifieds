import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { useAuth } from "../auth";
import { createWantedPost, getListingOptionsCached, type Category, type ListingSex, type WaterType } from "../api";

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

  type FieldKey =
    | "title"
    | "category"
    | "species"
    | "waterType"
    | "sex"
    | "age"
    | "quantity"
    | "location"
    | "phone"
    | "description";

  const [categories, setCategories] = useState<Category[]>([]);
  const [waterTypes, setWaterTypes] = useState<WaterType[]>([]);
  const [listingSexes, setListingSexes] = useState<ListingSex[]>([]);
  const [bioRequiredCategories, setBioRequiredCategories] = useState<Set<string>>(new Set());
  const [otherCategoryName, setOtherCategoryName] = useState("Other");

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

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});

  function clearFieldError(k: FieldKey) {
    if (!fieldErrors[k]) return;
    setFieldErrors((prev) => {
      if (!prev[k]) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });
  }

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

  const isOtherCategory = String(category) === String(otherCategoryName);
  const bioFieldsRequired = bioRequiredCategories.has(String(category));
  const bioFieldsDisabled = Boolean(category) && !bioFieldsRequired && !isOtherCategory;
  const bioFieldsEnabled = !bioFieldsDisabled;
  const bioFieldsRequiredForUser = bioFieldsRequired && !isOtherCategory;
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
    setFieldErrors((prev) => {
      if (!prev.species && !prev.waterType && !prev.sex) return prev;
      const next = { ...prev };
      delete next.species;
      delete next.waterType;
      delete next.sex;
      return next;
    });
  }, [category, bioFieldsDisabled]);

  const budgetMinCents = useMemo(() => dollarsToCents(minBudget), [minBudget]);
  const budgetMaxCents = useMemo(() => dollarsToCents(maxBudget), [maxBudget]);
  const maxDescLen = 1000;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setFieldErrors({});

    const nextErrors: Partial<Record<FieldKey, string>> = {};
    if (!title.trim()) nextErrors.title = "Required field";
    if (!category) nextErrors.category = "Required field";
    if (bioFieldsRequiredForUser && !species.trim()) nextErrors.species = "Required field";
    if (bioFieldsRequiredForUser && !waterType) nextErrors.waterType = "Required field";
    if (bioFieldsRequiredForUser && !sex) nextErrors.sex = "Required field";
    if (!age.trim()) nextErrors.age = "Required field";

    const qty = Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
    if (qty < 1) nextErrors.quantity = "Quantity must be at least 1.";

    if (!location.trim()) nextErrors.location = "Required field";

    const phoneTrim = phone.trim();
    if (!phoneTrim) nextErrors.phone = "Required field";
    else if (phoneTrim.length < 6) nextErrors.phone = "Phone number looks too short.";
    else if (phoneTrim.length > 30) nextErrors.phone = "Phone number is too long.";

    if (!String(description ?? "").trim()) nextErrors.description = "Required field";

    if (Object.values(nextErrors).some(Boolean)) {
      setFieldErrors(nextErrors);
      setErr("Please fill out the required fields.");
      return;
    }

    setSubmitting(true);
    try {
      const finalDescription = String(description ?? "").trim();
      const w = await createWantedPost({
        title: title.trim(),
        category,
        species: bioFieldsEnabled ? (species.trim() ? species.trim() : null) : null,
        waterType: bioFieldsEnabled && waterType ? waterType : null,
        sex: bioFieldsEnabled && sex ? sex : null,
        age: age.trim(),
        quantity: qty,
        budgetMinCents,
        budgetMaxCents,
        location: location.trim(),
        phone: phoneTrim,
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
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Post a wanted listing</h1>
        <p className="mt-1 text-sm text-slate-600">Add details, photos, and pricing to publish your listing.</p>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
          <label className="block">
            <div className={["mb-1 text-xs font-semibold", fieldErrors.title ? "text-red-700" : "text-slate-700"].join(" ")}>
              Title <span className="text-red-600">*</span>
            </div>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                clearFieldError("title");
              }}
              required
              minLength={3}
              maxLength={80}
              className={[
                "w-full rounded-xl border px-3 py-3 text-sm outline-none",
                fieldErrors.title ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
              ].join(" ")}
            />
            {fieldErrors.title && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.title}</div>}
          </label>

          <div className="grid gap-3 sm:grid-cols-10">
            <label className="block sm:col-span-2">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.category ? "text-red-700" : "text-slate-700"].join(" ")}>
                Category <span className="text-red-600">*</span>
              </div>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as Category);
                  clearFieldError("category");
                }}
                className={[
                  "w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none",
                  fieldErrors.category ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
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
              {fieldErrors.category && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.category}</div>}
            </label>

            <label className="block sm:col-span-4">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.species ? "text-red-700" : "text-slate-700"].join(" ")}>
                Species {bioFieldsRequiredForUser && <span className="text-red-600">*</span>}
              </div>
              <input
                value={species}
                onChange={(e) => {
                  setSpecies(e.target.value);
                  clearFieldError("species");
                }}
                disabled={bioFieldsDisabled}
                required={bioFieldsRequiredForUser}
                className={[
                  "w-full rounded-xl border px-3 py-3 text-sm outline-none",
                  fieldErrors.species ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500",
                ].join(" ")}
              />
              {fieldErrors.species && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.species}</div>}
            </label>

            <label className="block sm:col-span-2">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.waterType ? "text-red-700" : "text-slate-700"].join(" ")}>
                Water type {bioFieldsRequiredForUser && <span className="text-red-600">*</span>}
              </div>
              <select
                value={waterType}
                onChange={(e) => {
                  setWaterType(e.target.value as WaterType);
                  clearFieldError("waterType");
                }}
                className={[
                  "w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none",
                  fieldErrors.waterType ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500",
                ].join(" ")}
                required={bioFieldsRequiredForUser}
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
              {fieldErrors.waterType && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.waterType}</div>}
            </label>

            <label className="block sm:col-span-2">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.sex ? "text-red-700" : "text-slate-700"].join(" ")}>
                Sex {bioFieldsRequiredForUser && <span className="text-red-600">*</span>}
              </div>
              <select
                value={sex}
                onChange={(e) => {
                  setSex(e.target.value as ListingSex);
                  clearFieldError("sex");
                }}
                className={[
                  "w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none",
                  fieldErrors.sex ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500",
                ].join(" ")}
                required={bioFieldsRequiredForUser}
                disabled={bioFieldsDisabled}
              >
                <option value="" disabled hidden>
                  Select…
                </option>
                {wantedSexOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {fieldErrors.sex && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.sex}</div>}
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.quantity ? "text-red-700" : "text-slate-700"].join(" ")}>
                Quantity <span className="text-red-600">*</span>
              </div>
              <input
                type="number"
                min={1}
                step={1}
                value={Number.isFinite(quantity) ? quantity : 1}
                onChange={(e) => {
                  setQuantity(Number(e.target.value));
                  clearFieldError("quantity");
                }}
                className={[
                  "w-full rounded-xl border px-3 py-3 text-sm outline-none",
                  fieldErrors.quantity ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
                required
              />
              {fieldErrors.quantity && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.quantity}</div>}
            </label>

            <label className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.age ? "text-red-700" : "text-slate-700"].join(" ")}>
                Age <span className="text-red-600">*</span>
              </div>
              <input
                value={age}
                onChange={(e) => {
                  setAge(e.target.value);
                  clearFieldError("age");
                }}
                required
                maxLength={40}
                className={[
                  "w-full rounded-xl border px-3 py-3 text-sm outline-none",
                  fieldErrors.age ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
              />
              {fieldErrors.age && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.age}</div>}
            </label>

            <label className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.location ? "text-red-700" : "text-slate-700"].join(" ")}>
                Location <span className="text-red-600">*</span>
              </div>
              <input
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  clearFieldError("location");
                }}
                required
                minLength={2}
                maxLength={80}
                className={[
                  "w-full rounded-xl border px-3 py-3 text-sm outline-none",
                  fieldErrors.location ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
              />
              {fieldErrors.location && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.location}</div>}
            </label>
          </div>

          <label className="block">
            <div className={["mb-1 text-xs font-semibold", fieldErrors.phone ? "text-red-700" : "text-slate-700"].join(" ")}>
              Phone number <span className="text-red-600">*</span>
            </div>
            <input
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                clearFieldError("phone");
              }}
              required
              minLength={6}
              maxLength={30}
              className={[
                "w-full rounded-xl border px-3 py-3 text-sm outline-none",
                fieldErrors.phone ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
              ].join(" ")}
              autoComplete="tel"
              inputMode="tel"
            />
            {fieldErrors.phone && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.phone}</div>}
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
            <div className={["mb-1 text-xs font-semibold", fieldErrors.description ? "text-red-700" : "text-slate-700"].join(" ")}>
              Description <span className="text-red-600">*</span>
            </div>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                clearFieldError("description");
              }}
              required
              rows={6}
              maxLength={maxDescLen}
              className={[
                "w-full rounded-xl border px-3 py-3 text-sm outline-none",
                fieldErrors.description ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
              ].join(" ")}
            />
            {fieldErrors.description && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.description}</div>}
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

