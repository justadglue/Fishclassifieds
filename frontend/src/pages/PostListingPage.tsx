// frontend/src/pages/PostListingPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Undo2 } from "lucide-react";
import {
  createListing,
  createWantedPost,
  getListingOptionsCached,
  type Category,
  type ListingSex,
  type WaterType,
} from "../api";
import Header from "../components/Header";
import { useAuth } from "../auth";
import { buildSaleDetailsPrefix, encodeSaleDetailsIntoDescription, encodeWantedDetailsIntoDescription, type PriceType } from "../utils/listingDetailsBlock";
import ShippingInfoButton from "../components/ShippingInfoButton";
import PhotoUploader, { type PhotoUploaderHandle } from "../components/PhotoUploader";
import { MAX_MONEY_INPUT_LEN, sanitizeMoneyInput } from "../utils/money";
import { listingDetailPath, listingPostPath, parseListingKind, type ListingKind } from "../utils/listingRoutes";

function dollarsToCents(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const MAX_CUSTOM_PRICE_TYPE_LEN = 20;

function SalePostForm({ kind }: { kind: ListingKind }) {
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;
    if (!user) nav(`/auth?next=${encodeURIComponent(listingPostPath(kind))}&ctx=create_listing`);
  }, [authLoading, user, nav]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [sexes, setSexes] = useState<ListingSex[]>([]);
  const [waterTypes, setWaterTypes] = useState<WaterType[]>([]);
  const [bioRequiredCategories, setBioRequiredCategories] = useState<Set<string>>(new Set());
  const [otherCategoryName, setOtherCategoryName] = useState("Other");

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("");
  const [species, setSpecies] = useState("");
  const [sex, setSex] = useState<ListingSex | "">("");
  const [waterType, setWaterType] = useState<WaterType | "">("");
  const [size, setSize] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [priceType, setPriceType] = useState<PriceType>("each");
  const [customPriceText, setCustomPriceText] = useState("");
  const [willingToShip, setWillingToShip] = useState(false);
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [description, setDescription] = useState("");

  const customPriceInputRef = useRef<HTMLInputElement | null>(null);
  const [showShipHint, setShowShipHint] = useState(false);
  const [shipHintVisible, setShipHintVisible] = useState(false);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

  const photoUploaderRef = useRef<PhotoUploaderHandle | null>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  type FieldKey =
    | "title"
    | "category"
    | "species"
    | "waterType"
    | "sex"
    | "size"
    | "price"
    | "quantity"
    | "priceType"
    | "customPriceText"
    | "location"
    | "phone"
    | "description";
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});

  const isOtherCategory = String(category) === String(otherCategoryName);
  const bioFieldsRequired = bioRequiredCategories.has(String(category));
  const bioFieldsDisabled = Boolean(category) && !bioFieldsRequired && !isOtherCategory;
  const bioFieldsEnabled = !bioFieldsDisabled;
  // Show bio-field asterisks by default (before a category is selected). If a non-bio (disabled) or "Other"
  // category is chosen, requirements drop as they do today.
  const bioFieldsRequiredForUser = !category ? true : bioFieldsRequired && !isOtherCategory;
  const sizeRequired = bioFieldsEnabled && !isOtherCategory;

  useEffect(() => {
    // If category is non-living (equipment/accessories/services), clear + disable bio fields.
    if (!category) return;
    if (!bioFieldsDisabled) return;
    setSpecies("");
    setSex("");
    setWaterType("");
    setSize("");
    clearFieldError("species");
    clearFieldError("sex");
    clearFieldError("waterType");
    clearFieldError("size");
  }, [category, bioFieldsDisabled]);

  useEffect(() => {
    let cancelled = false;
    getListingOptionsCached()
      .then((opts) => {
        if (cancelled) return;
        setCategories(opts.categories as Category[]);
        setSexes(opts.listingSexes as ListingSex[]);
        setWaterTypes((opts as any).waterTypes as WaterType[]);
        setBioRequiredCategories(new Set(((opts as any).bioFieldsRequiredCategories as string[]) ?? []));
        setOtherCategoryName(String((opts as any).otherCategory ?? "Other"));
      })
      .catch(() => {
        // ignore; backend will validate on submit
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function clearFieldError(k: FieldKey) {
    setFieldErrors((prev) => {
      if (!prev[k]) return prev;
      return { ...prev, [k]: undefined };
    });
  }

  useEffect(() => {
    if (priceType !== "custom") return;
    window.setTimeout(() => customPriceInputRef.current?.focus(), 0);
  }, [priceType]);

  const resizeDescription = useCallback((el?: HTMLTextAreaElement | null) => {
    const t = el ?? descriptionRef.current;
    if (!t) return;
    // Auto-grow based on content; reset to auto first so it can shrink too.
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resizeDescription();
  }, [description, resizeDescription]);

  useEffect(() => {
    if (willingToShip) {
      setShowShipHint(true);
      window.requestAnimationFrame(() => setShipHintVisible(true));
      return;
    }
    setShipHintVisible(false);
    const t = window.setTimeout(() => setShowShipHint(false), 250);
    return () => window.clearTimeout(t);
  }, [willingToShip]);

  const canSubmit = !loading;

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
    if (sizeRequired && !size.trim()) nextErrors.size = "Required field";
    if (!location.trim()) nextErrors.location = "Required field";

    const phoneTrim = phone.trim();
    if (!phoneTrim) nextErrors.phone = "Required field";
    else if (phoneTrim.length < 6) nextErrors.phone = "Phone number looks too short.";
    else if (phoneTrim.length > 30) nextErrors.phone = "Phone number is too long.";

    const priceCents = dollarsToCents(priceDollars);
    if (priceCents === null) nextErrors.price = "Please enter a valid non-negative price.";

    const qty = Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
    if (qty < 1) nextErrors.quantity = "Quantity must be at least 1.";

    if (!priceType) nextErrors.priceType = "Required field";
    const custom = customPriceText.trim();
    if (priceType === "custom" && !custom) nextErrors.customPriceText = "Required field";
    else if (priceType === "custom" && custom.length > MAX_CUSTOM_PRICE_TYPE_LEN) {
      nextErrors.customPriceText = `Custom price type must be ${MAX_CUSTOM_PRICE_TYPE_LEN} characters or less.`;
    }

    if (!description.trim()) nextErrors.description = "Required field";

    const body = String(description ?? "").trim();

    // Length check (only if we have enough info to construct the details block).
    if (!nextErrors.description && !nextErrors.customPriceText && priceCents !== null) {
      const detailsPrefix = buildSaleDetailsPrefix({ quantity: qty, priceType, customPriceText: custom, willingToShip });
      const maxBodyLen = Math.max(1, 1000 - detailsPrefix.length);
      if (body.trim().length > maxBodyLen) {
        nextErrors.description = `Description is too long. Max ${maxBodyLen} characters when sale details are included.`;
      }
    }

    if (Object.values(nextErrors).some(Boolean)) {
      setFieldErrors(nextErrors);
      setErr("Please fill out the required fields.");
      return;
    }
    // Narrow types for TS (should be unreachable due to validation above).
    if (priceCents === null) return;
    if (bioFieldsRequiredForUser && !sex) return;
    const sexToSubmit: ListingSex = ((bioFieldsEnabled && sex ? sex : "Unknown") as ListingSex) ?? "Unknown";
    const speciesToSubmit = bioFieldsEnabled ? species.trim() : "";

    const photoCounts = photoUploaderRef.current?.getCounts() ?? { total: 0, uploaded: 0 };
    if (photoCounts.total === 0) {
      const ok = window.confirm("You haven't added any photos. Post this listing without photos?");
      if (!ok) return;
    }

    setLoading(true);
    try {
      await photoUploaderRef.current?.ensureUploaded();
      const uploadedAssets = photoUploaderRef.current?.getAssets() ?? [];
      if (photoCounts.total > 0 && uploadedAssets.length === 0) {
        throw new Error("Images were selected but none uploaded successfully. Remove broken images or retry upload.");
      }

      const finalDescription = encodeSaleDetailsIntoDescription({ quantity: qty, priceType, customPriceText: custom, willingToShip }, body);

      const created = await createListing({
        title: title.trim(),
        category,
        species: speciesToSubmit,
        sex: sexToSubmit,
        waterType: bioFieldsEnabled && waterType ? waterType : null,
        size: size.trim(),
        priceCents,
        location: location.trim(),
        description: finalDescription,
        phone: phoneTrim,
        images: uploadedAssets,
      });

      nav(listingDetailPath(kind, created.id));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to post listing");
    } finally {
      setLoading(false);
    }
  }

  const detailsPrefix = useMemo(
    () => buildSaleDetailsPrefix({ quantity, priceType, customPriceText, willingToShip }),
    [quantity, priceType, customPriceText, willingToShip]
  );
  const maxDescLen = Math.max(1, 1000 - detailsPrefix.length);

  return (
    <div className="min-h-full">
      <Header maxWidth="3xl" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-extrabold text-slate-900">Create a sale listing</h1>
        <div className="mt-1 text-sm text-slate-600">Add details, photos, and pricing to publish your listing.</div>

        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          {/* Images */}
          <PhotoUploader ref={photoUploaderRef} disabled={loading} />

          {/* Fields */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-2">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.title ? "text-red-700" : "text-slate-700"].join(" ")}>
                Title <span className="text-red-600">*</span>
              </div>
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  clearFieldError("title");
                }}
                className={[
                  "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  fieldErrors.title ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
                required
                minLength={3}
                maxLength={80}
              />
              {fieldErrors.title && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.title}</div>}
            </label>

            <label className="block sm:col-span-1">
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
                  "w-full rounded-xl border px-3 py-2 text-sm outline-none",
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
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.species ? "text-red-700" : "text-slate-700"].join(" ")}>
                Species {bioFieldsRequiredForUser && <span className="text-red-600">*</span>}
              </div>
              <input
                value={species}
                onChange={(e) => {
                  setSpecies(e.target.value);
                  clearFieldError("species");
                }}
                className={[
                  "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  fieldErrors.species ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  "disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed",
                ].join(" ")}
                required={bioFieldsRequiredForUser}
                disabled={bioFieldsDisabled}
                minLength={2}
                maxLength={60}
              />
              {fieldErrors.species && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.species}</div>}
            </label>

            <label className="block">
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
                  "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  fieldErrors.waterType ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  "disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed",
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

            <label className="block">
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
                  "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  fieldErrors.sex ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  "disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed",
                ].join(" ")}
                required={bioFieldsRequiredForUser}
                disabled={bioFieldsDisabled}
              >
                <option value="" disabled hidden>
                  Select…
                </option>
                {!sexes.length ? (
                  <option value="" disabled>
                    Loading…
                  </option>
                ) : (
                  sexes.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))
                )}
              </select>
              {fieldErrors.sex && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.sex}</div>}
            </label>
            <label className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.size ? "text-red-700" : "text-slate-700"].join(" ")}>
                Size {sizeRequired && <span className="text-red-600">*</span>}
              </div>
              <input
                value={size}
                onChange={(e) => {
                  setSize(e.target.value);
                  clearFieldError("size");
                }}
                className={[
                  "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  fieldErrors.size ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  "disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed",
                ].join(" ")}
                required={sizeRequired}
                maxLength={40}
                disabled={loading || bioFieldsDisabled}
              />
              {fieldErrors.size && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.size}</div>}
            </label>
          </div>

          {/* Row 2: Price + Quantity + Price type */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.price ? "text-red-700" : "text-slate-700"].join(" ")}>
                Price ($) <span className="text-red-600">*</span>
              </div>
              <input
                value={priceDollars}
                onChange={(e) => {
                  setPriceDollars(sanitizeMoneyInput(e.target.value));
                  clearFieldError("price");
                }}
                inputMode="decimal"
                maxLength={MAX_MONEY_INPUT_LEN}
                className={[
                  "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  fieldErrors.price ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
                required
              />
              {fieldErrors.price && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.price}</div>}
            </label>

            <label className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.quantity ? "text-red-700" : "text-slate-700"].join(" ")}>
                Quantity <span className="text-red-600">*</span>
              </div>
              <input
                type="number"
                value={String(quantity)}
                onChange={(e) => {
                  const raw = e.target.value;
                  const n = raw === "" ? NaN : Number.parseInt(raw, 10);
                  if (!Number.isFinite(n)) return;
                  setQuantity(Math.max(1, n));
                  clearFieldError("quantity");
                }}
                onBlur={() => setQuantity((q) => (Number.isFinite(q) ? Math.max(1, Math.floor(q)) : 1))}
                inputMode="numeric"
                step={1}
                min={1}
                className={[
                  "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  fieldErrors.quantity ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
                required
              />
              {fieldErrors.quantity && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.quantity}</div>}
            </label>

            <div className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.priceType || fieldErrors.customPriceText ? "text-red-700" : "text-slate-700"].join(" ")}>
                Price type <span className="text-red-600">*</span>
              </div>
              {priceType === "custom" ? (
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <input
                      ref={customPriceInputRef}
                      value={customPriceText}
                      onChange={(e) => {
                        setCustomPriceText(e.target.value);
                        clearFieldError("customPriceText");
                        clearFieldError("priceType");
                      }}
                      className={[
                        "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                        fieldErrors.customPriceText ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                      ].join(" ")}
                      placeholder="e.g. breeding pair"
                      maxLength={MAX_CUSTOM_PRICE_TYPE_LEN}
                    />
                    <button
                      type="button"
                      onClick={() => setPriceType("each")}
                      className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      title="Return to dropdown options"
                      aria-label="Return to dropdown options"
                    >
                      <Undo2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                  {/* Absolutely position into the vertical gap so layout doesn't shift */}
                  <div className="pointer-events-none absolute left-0 top-full text-[11px] leading-4 font-semibold text-slate-500">
                    ({customPriceText.trim().length}/{MAX_CUSTOM_PRICE_TYPE_LEN})
                  </div>
                  {fieldErrors.customPriceText && (
                    <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.customPriceText}</div>
                  )}
                </div>
              ) : (
                <select
                  value={priceType}
                  onChange={(e) => {
                    setPriceType(e.target.value as PriceType);
                    clearFieldError("priceType");
                  }}
                  className={[
                    "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                    fieldErrors.priceType ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  ].join(" ")}
                  required
                >
                  <option value="each">Each</option>
                  <option value="all">All</option>
                  <option value="custom">Custom</option>
                </select>
              )}
              {fieldErrors.priceType && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.priceType}</div>}
            </div>
          </div>

          {/* Row 3: Phone + Location + Shipping */}
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block sm:col-span-1">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.phone ? "text-red-700" : "text-slate-700"].join(" ")}>
                Phone number <span className="text-red-600">*</span>
              </div>
              <input
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  clearFieldError("phone");
                }}
                inputMode="tel"
                autoComplete="tel"
                className={[
                  "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  fieldErrors.phone ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
                required
                minLength={6}
                maxLength={30}
              />
              {fieldErrors.phone && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.phone}</div>}
            </label>

            <label className="block sm:col-span-1">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.location ? "text-red-700" : "text-slate-700"].join(" ")}>
                Location <span className="text-red-600">*</span>
              </div>
              <input
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  clearFieldError("location");
                }}
                className={[
                  "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                  fieldErrors.location ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
                required
                minLength={2}
                maxLength={80}
              />
              {fieldErrors.location && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.location}</div>}
            </label>

            <div className="grid sm:col-span-2">
              {/* Spacer so checkbox aligns with the input row (not the label row) */}
              <div className="mb-1 text-xs font-semibold text-transparent select-none" aria-hidden="true">
                Phone number
              </div>
              <div className="flex h-10 items-center">
                <div className="inline-flex items-center gap-1 min-w-0">
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 select-none">
                    <input type="checkbox" checked={willingToShip} onChange={(e) => setWillingToShip(e.target.checked)} />
                    Willing to ship
                  </label>
                  <ShippingInfoButton />
                  {showShipHint && (
                    <div
                      className={[
                        "ml-1 min-w-0 text-xs font-semibold text-slate-500 transition-opacity duration-250 ease-out",
                        shipHintVisible ? "opacity-100" : "opacity-0",
                      ].join(" ")}
                      aria-hidden={!shipHintVisible}
                    >
                      Ship safely.{" "}
                      <Link
                        to="/faq#fish-shipping"
                        tabIndex={shipHintVisible ? 0 : -1}
                        className="text-slate-700 underline underline-offset-2 hover:text-slate-900"
                      >
                        Fish shipping FAQ
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <label className="block">
            <div className={["mb-1 text-xs font-semibold", fieldErrors.description ? "text-red-700" : "text-slate-700"].join(" ")}>
              Description <span className="text-red-600">*</span>
            </div>
            <textarea
              ref={descriptionRef}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                resizeDescription(e.currentTarget);
                clearFieldError("description");
              }}
              onInput={(e) => resizeDescription(e.currentTarget as HTMLTextAreaElement)}
              className={[
                "min-h-[140px] w-full resize-none overflow-hidden rounded-xl border px-3 py-2 text-sm outline-none",
                fieldErrors.description ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
              ].join(" ")}
              required
              minLength={1}
              maxLength={maxDescLen}
            />
            {fieldErrors.description && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.description}</div>}
            <div className="mt-1 text-[11px] font-semibold text-slate-500">
              ({description.trim().length}/{maxDescLen})
            </div>
          </label>

          {err && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {loading ? "Posting..." : "Post listing"}
            </button>

            <Link
              to="/"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}

function dollarsToCentsMaybe(s: string) {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function WantedPostForm() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const photoUploaderRef = useRef<PhotoUploaderHandle | null>(null);

  type FieldKey =
    | "title"
    | "category"
    | "species"
    | "waterType"
    | "sex"
    | "size"
    | "quantity"
    | "priceType"
    | "customPriceText"
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
  const [size, setSize] = useState("");
  const [quantity, setQuantity] = useState<number>(1);
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [budget, setBudget] = useState("");
  const [priceType, setPriceType] = useState<PriceType>("each");
  const [customPriceText, setCustomPriceText] = useState("");
  const [description, setDescription] = useState("");

  const customPriceInputRef = useRef<HTMLInputElement | null>(null);

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
    if (!user) nav(`/auth?next=${encodeURIComponent(listingPostPath("wanted"))}&ctx=wanted_post`);
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
  // Default to required (bio is the common case). If a non-bio category is chosen,
  // these inputs become disabled and requirements/asterisks effectively drop.
  const bioFieldsRequiredForUser = bioFieldsEnabled && !isOtherCategory;
  const sizeRequired = bioFieldsEnabled && !isOtherCategory;

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
    setSize("");
    setFieldErrors((prev) => {
      if (!prev.species && !prev.waterType && !prev.sex && !prev.size) return prev;
      const next = { ...prev };
      delete next.species;
      delete next.waterType;
      delete next.sex;
      delete next.size;
      return next;
    });
  }, [category, bioFieldsDisabled]);

  const budgetCents = useMemo(() => dollarsToCentsMaybe(budget), [budget]);
  const maxDescLen = 1000;

  useEffect(() => {
    if (priceType !== "custom") return;
    window.setTimeout(() => customPriceInputRef.current?.focus(), 0);
  }, [priceType]);

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
    if (sizeRequired && !size.trim()) nextErrors.size = "Required field";

    const qty = Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
    if (qty < 1) nextErrors.quantity = "Quantity must be at least 1.";

    if (!location.trim()) nextErrors.location = "Required field";

    const phoneTrim = phone.trim();
    if (!phoneTrim) nextErrors.phone = "Required field";
    else if (phoneTrim.length < 6) nextErrors.phone = "Phone number looks too short.";
    else if (phoneTrim.length > 30) nextErrors.phone = "Phone number is too long.";

    if (!String(description ?? "").trim()) nextErrors.description = "Required field";

    if (!priceType) nextErrors.priceType = "Required field";
    const custom = customPriceText.trim();
    if (priceType === "custom" && !custom) nextErrors.customPriceText = "Required field";
    else if (priceType === "custom" && custom.length > MAX_CUSTOM_PRICE_TYPE_LEN) {
      nextErrors.customPriceText = `Custom price type must be ${MAX_CUSTOM_PRICE_TYPE_LEN} characters or less.`;
    }

    if (Object.values(nextErrors).some(Boolean)) {
      setFieldErrors(nextErrors);
      setErr("Please fill out the required fields.");
      return;
    }

    const photoCounts = photoUploaderRef.current?.getCounts() ?? { total: 0, uploaded: 0 };
    if (photoCounts.total === 0) {
      const ok = window.confirm("You haven't added any photos. Post this wanted listing without photos?");
      if (!ok) return;
    }

    setSubmitting(true);
    try {
      await photoUploaderRef.current?.ensureUploaded();
      const uploadedAssets = photoUploaderRef.current?.getAssets() ?? [];
      if (photoCounts.total > 0 && uploadedAssets.length === 0) {
        throw new Error("Images were selected but none uploaded successfully. Remove broken images or retry upload.");
      }

      const custom = customPriceText.trim();
      const body = String(description ?? "").trim();
      const finalDescription = encodeWantedDetailsIntoDescription({ priceType, customPriceText: custom }, body);
      const w = await createWantedPost({
        title: title.trim(),
        category,
        species: bioFieldsEnabled ? (species.trim() ? species.trim() : null) : null,
        waterType: bioFieldsEnabled && waterType ? waterType : null,
        sex: bioFieldsEnabled && sex ? sex : null,
        size: size.trim(),
        quantity: qty,
        budgetCents,
        location: location.trim(),
        phone: phoneTrim,
        description: finalDescription,
        images: uploadedAssets,
      });
      nav(listingDetailPath("wanted", w.id));
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
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Create a wanted listing</h1>
        <p className="mt-1 text-sm text-slate-600">Add details, photos, and pricing to publish your listing.</p>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
          <PhotoUploader ref={photoUploaderRef} disabled={submitting} />

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-2">
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

            <label className="block sm:col-span-1">
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
          </div>

          {/* Row: Species + Water type + Sex + Size (match sale form layout) */}
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.species ? "text-red-700" : "text-slate-700"].join(" ")}>
                Species {bioFieldsRequiredForUser ? <span className="text-red-600">*</span> : null}
              </div>
              <input
                value={species}
                onChange={(e) => {
                  setSpecies(e.target.value);
                  clearFieldError("species");
                }}
                disabled={!bioFieldsEnabled}
                className={[
                  "w-full rounded-xl border px-3 py-3 text-sm outline-none disabled:bg-slate-50",
                  fieldErrors.species ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
              />
              {fieldErrors.species && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.species}</div>}
            </label>

            <label className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.waterType ? "text-red-700" : "text-slate-700"].join(" ")}>
                Water type {bioFieldsRequiredForUser ? <span className="text-red-600">*</span> : null}
              </div>
              <select
                value={waterType}
                onChange={(e) => {
                  setWaterType(e.target.value as any);
                  clearFieldError("waterType");
                }}
                disabled={!bioFieldsEnabled}
                className={[
                  "w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none disabled:bg-slate-50",
                  fieldErrors.waterType ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
              >
                <option value="">Select…</option>
                {waterTypes.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
              {fieldErrors.waterType && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.waterType}</div>}
            </label>

            <label className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.sex ? "text-red-700" : "text-slate-700"].join(" ")}>
                Sex {bioFieldsRequiredForUser ? <span className="text-red-600">*</span> : null}
              </div>
              <select
                value={sex}
                onChange={(e) => {
                  setSex(e.target.value as any);
                  clearFieldError("sex");
                }}
                disabled={!bioFieldsEnabled}
                className={[
                  "w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none disabled:bg-slate-50",
                  fieldErrors.sex ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
              >
                <option value="">Select…</option>
                {wantedSexOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {fieldErrors.sex && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.sex}</div>}
            </label>

            <label className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.size ? "text-red-700" : "text-slate-700"].join(" ")}>
                Size {sizeRequired ? <span className="text-red-600">*</span> : null}
              </div>
              <input
                value={size}
                onChange={(e) => {
                  setSize(e.target.value);
                  clearFieldError("size");
                }}
                disabled={!bioFieldsEnabled}
                className={[
                  "w-full rounded-xl border px-3 py-3 text-sm outline-none disabled:bg-slate-50",
                  fieldErrors.size ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
              />
              {fieldErrors.size && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.size}</div>}
            </label>
          </div>

          {/* Row: Budget + Quantity + Price type (match sale form order) */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Budget ($)</div>
              <input
                inputMode="decimal"
                value={budget}
                onChange={(e) => setBudget(sanitizeMoneyInput(e.target.value, MAX_MONEY_INPUT_LEN))}
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400"
              />
            </label>

            <label className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.quantity ? "text-red-700" : "text-slate-700"].join(" ")}>
                Quantity <span className="text-red-600">*</span>
              </div>
              <input
                type="number"
                value={quantity}
                onChange={(e) => {
                  const raw = e.target.value;
                  const n = raw === "" ? NaN : Number.parseInt(raw, 10);
                  if (!Number.isFinite(n)) return;
                  setQuantity(n);
                  clearFieldError("quantity");
                }}
                onBlur={() => setQuantity((q) => (Number.isFinite(q) ? Math.max(1, Math.floor(q)) : 1))}
                min={1}
                step={1}
                inputMode="numeric"
                className={[
                  "w-full rounded-xl border px-3 py-3 text-sm outline-none",
                  fieldErrors.quantity ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
              />
              {fieldErrors.quantity && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.quantity}</div>}
            </label>

            <div className="block">
              <div
                className={[
                  "mb-1 text-xs font-semibold",
                  fieldErrors.priceType || fieldErrors.customPriceText ? "text-red-700" : "text-slate-700",
                ].join(" ")}
              >
                Price type <span className="text-red-600">*</span>
              </div>

              {priceType === "custom" ? (
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <input
                      ref={customPriceInputRef}
                      value={customPriceText}
                      onChange={(e) => {
                        setCustomPriceText(e.target.value);
                        clearFieldError("customPriceText");
                        clearFieldError("priceType");
                      }}
                      className={[
                        "w-full rounded-xl border px-3 py-3 text-sm outline-none",
                        fieldErrors.customPriceText ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                      ].join(" ")}
                      placeholder="e.g. breeding pair"
                      maxLength={MAX_CUSTOM_PRICE_TYPE_LEN}
                    />
                    <button
                      type="button"
                      onClick={() => setPriceType("each")}
                      className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      title="Return to dropdown options"
                      aria-label="Return to dropdown options"
                    >
                      <Undo2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="pointer-events-none absolute left-0 top-full text-[11px] leading-4 font-semibold text-slate-500">
                    ({customPriceText.trim().length}/{MAX_CUSTOM_PRICE_TYPE_LEN})
                  </div>
                  {fieldErrors.customPriceText && (
                    <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.customPriceText}</div>
                  )}
                </div>
              ) : (
                <select
                  value={priceType}
                  onChange={(e) => {
                    setPriceType(e.target.value as PriceType);
                    clearFieldError("priceType");
                  }}
                  className={[
                    "w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none",
                    fieldErrors.priceType ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  ].join(" ")}
                  required
                >
                  <option value="each">Each</option>
                  <option value="all">All</option>
                  <option value="custom">Custom</option>
                </select>
              )}

              {fieldErrors.priceType && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.priceType}</div>}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">

            <label className="block">
              <div className={["mb-1 text-xs font-semibold", fieldErrors.phone ? "text-red-700" : "text-slate-700"].join(" ")}>
                Phone number<span className="text-red-600">*</span>
              </div>
              <input
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  clearFieldError("phone");
                }}
                className={[
                  "w-full rounded-xl border px-3 py-3 text-sm outline-none",
                  fieldErrors.phone ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
              />
              {fieldErrors.phone && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.phone}</div>}
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
                className={[
                  "w-full rounded-xl border px-3 py-3 text-sm outline-none",
                  fieldErrors.location ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                ].join(" ")}
              />
              {fieldErrors.location && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.location}</div>}
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
              className={[
                "min-h-[140px] w-full resize-none overflow-hidden rounded-xl border px-3 py-2 text-sm outline-none",
                fieldErrors.description ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
              ].join(" ")}
              required
              minLength={1}
              maxLength={maxDescLen}
            />
            {fieldErrors.description && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.description}</div>}
            <div className="mt-1 text-[11px] font-semibold text-slate-500">
              ({description.trim().length}/{maxDescLen})
            </div>
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {submitting ? "Posting..." : "Post listing"}
            </button>

            <Link to="/" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50">
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}

export default function PostListingPage() {
  const { kind: kindParam } = useParams();
  const kind = parseListingKind(kindParam);
  return kind === "wanted" ? <WantedPostForm /> : <SalePostForm kind={kind} />;
}
