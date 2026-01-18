import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Check, Pause, Play, Trash2, Undo2 } from "lucide-react";
import {
  createWantedPost,
  deleteListing,
  deleteWantedPost,
  fetchListing,
  fetchWantedPost,
  createListing,
  getListingOptionsCached,
  updateListing,
  updateWantedPost,
  pauseListing,
  resumeListing,
  markSold,
  type Category,
  type Listing,
  type ImageAsset,
  type ListingSex,
  type WantedPost,
  type WaterType,
} from "../api";
import Header from "../components/Header";
import { useAuth } from "../auth";
import {
  buildSaleDetailsPrefix,
  decodeSaleDetailsFromDescription,
  encodeSaleDetailsIntoDescription,
  type PriceType,
} from "../utils/listingDetailsBlock";
import ShippingInfoButton from "../components/ShippingInfoButton";
import PhotoUploader, { type PhotoUploaderHandle } from "../components/PhotoUploader";
import { MAX_MONEY_INPUT_LEN, sanitizeMoneyInput } from "../utils/money";
import { listingDetailPath, listingEditPath, parseListingKind, type ListingKind } from "../listings/routes";

function dollarsToCents(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function centsToDollarsString(cents: number) {
  return (cents / 100).toFixed(2);
}

function expiresInShort(iso: string) {
  const exp = new Date(iso).getTime();
  if (!Number.isFinite(exp)) return null;
  const diffMs = exp - Date.now();
  if (diffMs <= 0) return "0m";

  const minMs = 60 * 1000;
  const hourMs = 60 * minMs;
  const dayMs = 24 * hourMs;

  if (diffMs < hourMs) return `${Math.max(1, Math.ceil(diffMs / minMs))}m`;
  if (diffMs < dayMs) return `${Math.max(1, Math.ceil(diffMs / hourMs))}h`;
  return `${Math.max(1, Math.ceil(diffMs / dayMs))}d`;
}

const MAX_CUSTOM_PRICE_TYPE_LEN = 20;

function fmtStatus(l: Listing) {
  const parts: string[] = [];
  if (l.status === "draft") parts.push("Draft (hidden)");
  if (l.status === "pending") parts.push("Pending (public)");
  if (l.status === "active") parts.push("Active (public)");
  if (l.status === "paused") parts.push("Paused (hidden)");
  if (l.status === "expired") parts.push("Expired (hidden)");
  if (l.status === "deleted") parts.push("Deleted");

  if (l.resolution === "sold") parts.push("Marked sold");

  return parts.join(" • ");
}

function IconButton(props: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "danger" | "primary";
  children: React.ReactNode;
}) {
  const { title, onClick, disabled, variant = "default", children } = props;

  const base =
    "inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2";
  const cls =
    variant === "danger"
      ? "border-red-200 bg-white text-red-700 hover:bg-red-50 focus-visible:ring-red-300 disabled:opacity-60"
      : variant === "primary"
        ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800 focus-visible:ring-slate-400 disabled:opacity-60"
        : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50 focus-visible:ring-slate-300 disabled:opacity-60";

  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled} className={`${base} ${cls}`}>
      {children}
    </button>
  );
}

function SaleEditForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [sp] = useSearchParams();
  const relistMode = sp.get("relist") === "1";

  const [orig, setOrig] = useState<Listing | null>(null);

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
  const [age, setAge] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [priceType, setPriceType] = useState<PriceType>("each");
  const [customPriceText, setCustomPriceText] = useState("");
  const [willingToShip, setWillingToShip] = useState(false);
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [description, setDescription] = useState("");

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
        // ignore; backend will validate on save
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const customPriceInputRef = useRef<HTMLInputElement | null>(null);
  const [showShipHint, setShowShipHint] = useState(false);
  const [shipHintVisible, setShipHintVisible] = useState(false);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const photoUploaderRef = useRef<PhotoUploaderHandle | null>(null);
  const [initialPhotoAssets, setInitialPhotoAssets] = useState<ImageAsset[]>([]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  type FieldKey =
    | "title"
    | "category"
    | "species"
    | "waterType"
    | "sex"
    | "age"
    | "price"
    | "quantity"
    | "priceType"
    | "customPriceText"
    | "location"
    | "phone"
    | "description";
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});

  function clearFieldError(k: FieldKey) {
    setFieldErrors((prev) => {
      if (!prev[k]) return prev;
      return { ...prev, [k]: undefined };
    });
  }

  const isOtherCategory = String(category) === String(otherCategoryName);
  const bioFieldsRequired = bioRequiredCategories.has(String(category));
  const bioFieldsDisabled = Boolean(category) && !bioFieldsRequired && !isOtherCategory;
  const bioFieldsEnabled = !bioFieldsDisabled;
  // Show bio-field asterisks by default (before a category is selected). If a non-bio (disabled) or "Other"
  // category is chosen, requirements drop as they do today.
  const bioFieldsRequiredForUser = !category ? true : bioFieldsRequired && !isOtherCategory;
  const ageRequired = bioFieldsEnabled && !isOtherCategory;

  useEffect(() => {
    if (!category) return;
    if (!bioFieldsDisabled) return;
    setSpecies("");
    setSex("");
    setWaterType("");
    setAge("");
    clearFieldError("species");
    clearFieldError("sex");
    clearFieldError("waterType");
    clearFieldError("age");
  }, [category, bioFieldsDisabled]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const target = id ? listingEditPath("sale", id) : "/me";
      nav(`/auth?next=${encodeURIComponent(target)}&ctx=edit_listing`);
    }
  }, [authLoading, user, id, nav]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!id) return;
      setErr(null);
      setLoading(true);
      try {
        const l = await fetchListing(id);
        if (cancelled) return;

        setOrig(l);
        setTitle(l.title);
        setCategory(l.category);
        setSpecies(l.species);
        setSex(l.sex ?? "");
        setWaterType((l as any).waterType ?? "");
        setAge((l as any).age ?? "");
        setPriceDollars(centsToDollarsString(l.priceCents));
        setLocation(l.location);
        setPhone(l.phone ?? "");
        const decoded = decodeSaleDetailsFromDescription(l.description);
        setQuantity(decoded.details.quantity);
        setPriceType(decoded.details.priceType);
        setCustomPriceText(decoded.details.customPriceText);
        setWillingToShip(decoded.details.willingToShip);
        setDescription(decoded.body);
        setInitialPhotoAssets((l.images ?? []).slice(0, 6));
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load listing");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (priceType !== "custom") return;
    // Avoid focusing a disabled input while the page is still loading.
    if (loading) return;
    window.setTimeout(() => customPriceInputRef.current?.focus(), 0);
  }, [priceType, loading]);

  const resizeDescription = useCallback((el?: HTMLTextAreaElement | null) => {
    const t = el ?? descriptionRef.current;
    if (!t) return;
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

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!id) return;
    setFieldErrors({});

    const nextErrors: Partial<Record<FieldKey, string>> = {};
    if (!title.trim()) nextErrors.title = "Required field";
    if (!category) nextErrors.category = "Required field";
    if (bioFieldsRequiredForUser && !species.trim()) nextErrors.species = "Required field";
    if (bioFieldsRequiredForUser && !waterType) nextErrors.waterType = "Required field";
    if (bioFieldsRequiredForUser && !sex) nextErrors.sex = "Required field";
    if (ageRequired && !age.trim()) nextErrors.age = "Required field";
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

    if (!nextErrors.description && !nextErrors.customPriceText && priceCents !== null) {
      const detailsPrefix = buildSaleDetailsPrefix({ quantity: qty, priceType, customPriceText: custom, willingToShip });
      const maxBodyLen = Math.max(1, 1000 - detailsPrefix.length);
      if (description.trim().length > maxBodyLen) {
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
    const waterTypeToSubmit = bioFieldsEnabled && waterType ? waterType : null;
    const ageToSubmit = bioFieldsDisabled ? "" : age.trim();

    const photoCounts = photoUploaderRef.current?.getCounts() ?? { total: 0, uploaded: 0 };
    if (photoCounts.total === 0) {
      const ok = window.confirm("You haven't added any photos. Update this listing without photos?");
      if (!ok) return;
    }

    setLoading(true);
    try {
      await photoUploaderRef.current?.ensureUploaded();
      const merged = photoUploaderRef.current?.getAssets() ?? [];
      if (photoCounts.total > 0 && merged.length === 0) {
        throw new Error("Images were selected but none uploaded successfully. Remove broken images or retry upload.");
      }

      if (relistMode) {
        // Relist: do not modify anything until user clicks Update listing.
        // Create a brand new listing (active/pending depending on server config), then archive the sold one.
        const finalDescription = encodeSaleDetailsIntoDescription({ quantity: qty, priceType, customPriceText: custom, willingToShip }, description);
        const created = await createListing({
          title: title.trim(),
          category,
          species: speciesToSubmit,
          sex: sexToSubmit,
          waterType: waterTypeToSubmit,
          age: ageToSubmit,
          priceCents,
          location: location.trim(),
          description: finalDescription,
          phone: phoneTrim,
          images: merged,
          status: "active",
        });

        await deleteListing(id);
        nav(listingDetailPath("sale", created.id));
        return;
      }

      const finalDescription = encodeSaleDetailsIntoDescription({ quantity: qty, priceType, customPriceText: custom, willingToShip }, description);
      const updated = await updateListing(id, {
        title: title.trim(),
        category,
        species: speciesToSubmit,
        sex: sexToSubmit,
        waterType: waterTypeToSubmit,
        age: ageToSubmit,
        priceCents,
        location: location.trim(),
        description: finalDescription,
        phone: phoneTrim,
        images: merged,
      });

      setOrig(updated);
      setInitialPhotoAssets((updated.images ?? []).slice(0, 6));
      nav(listingDetailPath("sale", id));
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    if (!id) return;
    const l = await fetchListing(id);
    setOrig(l);
    setTitle(l.title);
    setCategory(l.category);
    setSpecies(l.species);
    setSex(l.sex ?? "");
    setWaterType((l as any).waterType ?? "");
    setAge((l as any).age ?? "");
    setPriceDollars(centsToDollarsString(l.priceCents));
    setLocation(l.location);
    setPhone(l.phone ?? "");
    const decoded = decodeSaleDetailsFromDescription(l.description);
    setQuantity(decoded.details.quantity);
    setPriceType(decoded.details.priceType);
    setCustomPriceText(decoded.details.customPriceText);
    setWillingToShip(decoded.details.willingToShip);
    setDescription(decoded.body);
    setInitialPhotoAssets((l.images ?? []).slice(0, 6));
  }

  async function onDeleteListing() {
    if (!id) return;
    setErr(null);

    const ok = window.confirm("Delete this listing? This cannot be undone.");
    if (!ok) return;

    setLoading(true);
    try {
      await deleteListing(id);
      nav("/me");
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed");
    } finally {
      setLoading(false);
    }
  }

  async function doTogglePauseResume() {
    if (!id || !orig) return;
    setErr(null);
    setLoading(true);
    try {
      if (orig.status === "paused") {
        await resumeListing(id);
      } else {
        await pauseListing(id);
      }
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update listing status");
    } finally {
      setLoading(false);
    }
  }

  async function doSold() {
    if (!id) return;
    setErr(null);
    setLoading(true);
    try {
      await markSold(id);
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to mark sold");
    } finally {
      setLoading(false);
    }
  }

  const canSave = !loading;
  const detailsPrefix = useMemo(
    () => buildSaleDetailsPrefix({ quantity, priceType, customPriceText, willingToShip }),
    [quantity, priceType, customPriceText, willingToShip]
  );
  const maxDescLen = Math.max(1, 1000 - detailsPrefix.length);

  const canTogglePause =
    !relistMode &&
    !!orig &&
    orig.status !== "draft" &&
    orig.status !== "expired" &&
    orig.status !== "deleted" &&
    orig.resolution === "none";

  const toggleLabel = orig?.status === "paused" ? "Resume listing" : "Pause listing";

  const canResolve =
    !relistMode && !!orig && orig.status !== "expired" && orig.status !== "deleted" && orig.resolution === "none";

  return (
    <div className="min-h-full">
      <Header maxWidth="3xl" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold text-slate-900">{relistMode ? "Relist listing" : "Edit listing"}</h1>
          {id && (
            <Link to={listingDetailPath("sale", id)} className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              View
            </Link>
          )}
        </div>

        {err && !orig && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

        {loading && !orig && <div className="mt-4 text-sm text-slate-600">Loading...</div>}

        {orig && (
          <form onSubmit={onSave} noValidate className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            {/* Listing state (only for normal edit, not relist) */}
            {!relistMode && (
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-sm font-bold text-slate-900">Listing state</div>
                <div className="mt-1 text-xs text-slate-600">{fmtStatus(orig)}</div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <IconButton title={toggleLabel} onClick={doTogglePauseResume} disabled={!canTogglePause || loading} variant="default">
                    {orig.status === "paused" ? (
                      <>
                        <Play aria-hidden="true" className="h-5 w-5" />
                        <span className="ml-2">Resume Ad</span>
                      </>
                    ) : (
                      <>
                        <Pause aria-hidden="true" className="h-5 w-5" />
                        <span className="ml-2">Pause Ad</span>
                      </>
                    )}
                  </IconButton>

                  <IconButton title="Mark as sold" onClick={doSold} disabled={!canResolve || loading} variant="primary">
                    <Check aria-hidden="true" className="h-5 w-5" />
                    <span className="ml-2">Mark as Sold</span>
                  </IconButton>

                  <IconButton title="Delete listing" onClick={onDeleteListing} disabled={loading} variant="danger">
                    <Trash2 aria-hidden="true" className="h-5 w-5" />
                    <span className="ml-2">Delete</span>
                  </IconButton>
                </div>

                <div className="mt-3 text-xs text-slate-600">
                  {orig.expiresAt ? (
                    <>
                      Expires in {expiresInShort(orig.expiresAt) ?? "—"} on{" "}
                      {new Date(orig.expiresAt).toLocaleString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      . Expiry is automatic.
                    </>
                  ) : (
                    <>Expiry is automatic.</>
                  )}
                </div>
              </div>
            )}

            {/* Images */}
            <PhotoUploader ref={photoUploaderRef} initialAssets={initialPhotoAssets} disabled={loading} />

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
                  disabled={loading}
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
                  disabled={loading}
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
                  minLength={2}
                  maxLength={60}
                  disabled={loading || bioFieldsDisabled}
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
                  disabled={loading || bioFieldsDisabled}
                  required={bioFieldsRequiredForUser}
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
                  disabled={loading || bioFieldsDisabled}
                  required={bioFieldsRequiredForUser}
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
                <div className={["mb-1 text-xs font-semibold", fieldErrors.age ? "text-red-700" : "text-slate-700"].join(" ")}>
                  Age {ageRequired && <span className="text-red-600">*</span>}
                </div>
                <input
                  value={age}
                  onChange={(e) => {
                    setAge(e.target.value);
                    clearFieldError("age");
                  }}
                  className={[
                    "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                    fieldErrors.age ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                    "disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed",
                  ].join(" ")}
                  required={ageRequired}
                  maxLength={40}
                  disabled={loading || bioFieldsDisabled}
                />
                {fieldErrors.age && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.age}</div>}
              </label>
            </div>

            {/* Row 2: Price + Quantity + Age + Price type */}
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
                  disabled={loading}
                />
                {fieldErrors.price && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.price}</div>}
              </label>

              <label className="block">
                <div className={["mb-1 text-xs font-semibold", fieldErrors.quantity ? "text-red-700" : "text-slate-700"].join(" ")}>
                  Quantity <span className="text-red-600">*</span>
                </div>
                <input
                  value={String(quantity)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return setQuantity(1);
                    setQuantity(Math.max(1, Math.floor(n)));
                    clearFieldError("quantity");
                  }}
                  inputMode="numeric"
                  className={[
                    "w-full rounded-xl border px-3 py-2 text-sm outline-none",
                    fieldErrors.quantity ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                  ].join(" ")}
                  required
                  disabled={loading}
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
                        disabled={loading}
                      />
                      <button
                        type="button"
                        onClick={() => setPriceType("each")}
                        className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        title="Return to dropdown options"
                        aria-label="Return to dropdown options"
                        disabled={loading}
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
                    disabled={loading}
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
                  disabled={loading}
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
                  disabled={loading}
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
                      <input
                        type="checkbox"
                        checked={willingToShip}
                        onChange={(e) => setWillingToShip(e.target.checked)}
                        disabled={loading}
                      />
                      Willing to ship
                    </label>
                    <ShippingInfoButton disabled={loading} />
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
                disabled={loading}
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
                disabled={!canSave}
                className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {loading ? "Saving..." : "Update listing"}
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  if (window.history.length > 1) nav(-1);
                  else if (id) nav(listingDetailPath("sale", id));
                  else nav("/me");
                }}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

function centsToDollarsMaybe(cents: number | null) {
  if (cents == null) return "";
  return String((cents / 100).toFixed(2)).replace(/\.00$/, "");
}

function dollarsToCentsMaybe(s: string) {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function WantedEditForm() {
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
      const target = id ? listingEditPath("wanted", id) : "/me";
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
        setMinBudget(centsToDollarsMaybe(w.budgetMinCents));
        setMaxBudget(centsToDollarsMaybe(w.budgetMaxCents));
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

      if (!location.trim()) throw new Error("Location is required.");

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
        const created = await createWantedPost({
          title: title.trim(),
          category,
          species: bioFieldsEnabled ? (species.trim() ? species.trim() : null) : null,
          waterType: bioFieldsEnabled && waterType ? waterType : null,
          sex: bioFieldsEnabled && sex ? sex : null,
          age: age.trim(),
          quantity: qty,
          budgetMinCents: dollarsToCentsMaybe(minBudget),
          budgetMaxCents: dollarsToCentsMaybe(maxBudget),
          location: location.trim(),
          phone: phoneTrim,
          description: description.trim(),
          images: uploadedAssets,
        });

        await deleteWantedPost(id);
        nav(listingDetailPath("wanted", created.id));
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
        budgetMinCents: dollarsToCentsMaybe(minBudget),
        budgetMaxCents: dollarsToCentsMaybe(maxBudget),
        location: location.trim(),
        phone: phoneTrim,
        description: description.trim(),
        images: uploadedAssets,
      });
      nav(listingDetailPath("wanted", updated.id));
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
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{relistMode ? "Relist wanted" : "Edit wanted"}</h1>
          {id ? (
            <Link to={listingDetailPath("wanted", id)} className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              View
            </Link>
          ) : null}
        </div>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}
        {!item && !err && <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">Loading…</div>}

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
                  disabled={saving || !isOwner}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                />
              </label>

              <label className="block sm:col-span-1">
                <div className="mb-1 text-xs font-semibold text-slate-700">Category</div>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                  disabled={saving || !isOwner}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
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

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Species {bioFieldsRequiredForUser ? <span className="text-red-600">*</span> : null}</div>
                <input
                  value={species}
                  onChange={(e) => setSpecies(e.target.value)}
                  disabled={saving || !isOwner || !bioFieldsEnabled}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">
                  Water type {bioFieldsRequiredForUser ? <span className="text-red-600">*</span> : null}
                </div>
                <select
                  value={waterType}
                  onChange={(e) => setWaterType(e.target.value as any)}
                  disabled={saving || !isOwner || !bioFieldsEnabled}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                >
                  <option value="">Select…</option>
                  {waterTypes.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Sex {bioFieldsRequiredForUser ? <span className="text-red-600">*</span> : null}</div>
                <select
                  value={sex}
                  onChange={(e) => setSex(e.target.value as any)}
                  disabled={saving || !isOwner || !bioFieldsEnabled}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                >
                  <option value="">Select…</option>
                  {wantedSexOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Age {ageRequired ? <span className="text-red-600">*</span> : null}</div>
                <input
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  disabled={saving || !isOwner || !bioFieldsEnabled}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Quantity</div>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  min={1}
                  disabled={saving || !isOwner}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Min budget ($)</div>
                <input
                  inputMode="decimal"
                  value={minBudget}
                  onChange={(e) => setMinBudget(sanitizeMoneyInput(e.target.value, MAX_MONEY_INPUT_LEN))}
                  disabled={saving || !isOwner}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Max budget ($)</div>
                <input
                  inputMode="decimal"
                  value={maxBudget}
                  onChange={(e) => setMaxBudget(sanitizeMoneyInput(e.target.value, MAX_MONEY_INPUT_LEN))}
                  disabled={saving || !isOwner}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Location</div>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  disabled={saving || !isOwner}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Phone</div>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={saving || !isOwner}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                />
              </label>
            </div>

            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Description</div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={saving || !isOwner}
                className="min-h-[160px] w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
              />
            </label>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving || !isOwner}
                className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Update wanted"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  if (window.history.length > 1) nav(-1);
                  else if (id) nav(listingDetailPath("wanted", id));
                  else nav("/me");
                }}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

export default function EditListingPage() {
  const { kind: kindParam } = useParams();
  const kind: ListingKind = parseListingKind(kindParam);
  return kind === "wanted" ? <WantedEditForm /> : <SaleEditForm />;
}
