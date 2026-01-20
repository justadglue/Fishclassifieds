// frontend/src/pages/PostListingPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Undo2 } from "lucide-react";
import {
    createListing,
    createWantedPost,
    deleteListing,
    deleteWantedPost,
    fetchListing,
    fetchWantedPost,
    getListingOptionsCached,
    updateListing,
    updateWantedPost,
    type Category,
    type ListingSex,
    type ImageAsset,
    type WaterType,
} from "../api";
import Header from "../components/Header";
import { useAuth } from "../auth";
import {
    decodeSaleDetailsFromDescription,
    decodeWantedDetailsFromDescription,
    encodeSaleDetailsIntoDescription,
    encodeWantedDetailsIntoDescription,
    type PriceType,
} from "../utils/listingDetailsBlock";
import ShippingInfoButton from "../components/ShippingInfoButton";
import { LocationTypeaheadAU } from "../components/LocationTypeaheadAU";
import PhotoUploader, { type PhotoUploaderHandle } from "../components/PhotoUploader";
import { MAX_MONEY_INPUT_LEN, sanitizeMoneyInput } from "../utils/money";
import { listingDetailPath, listingPostPath, parseListingKind, type ListingKind } from "../utils/listingRoutes";

function dollarsToCentsMaybe(s: string) {
    const t = String(s ?? "").trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
}

const MAX_CUSTOM_PRICE_TYPE_LEN = 20;
const MAX_DESC_BODY_LEN = 1000;

function fieldLabelClass(hasError: boolean) {
    return ["mb-1 text-xs font-semibold", hasError ? "text-red-700" : "text-slate-700"].join(" ");
}

function controlClass(hasError: boolean, extra?: string) {
    return [
        "w-full rounded-xl border px-3 py-2 text-sm outline-none",
        hasError ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
        extra ?? "",
    ]
        .filter(Boolean)
        .join(" ");
}

function Field({
    label,
    required,
    error,
    className,
    children,
}: {
    label: string;
    required?: boolean;
    error?: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <label className={["block", className ?? ""].filter(Boolean).join(" ")}>
            <div className={fieldLabelClass(Boolean(error))}>
                {label} {required ? <span className="text-red-600">*</span> : null}
            </div>
            {children}
            {error ? <div className="mt-1 text-xs font-semibold text-red-600">{error}</div> : null}
        </label>
    );
}

function PostForm({ kind, draftId }: { kind: ListingKind; draftId?: string | null }) {
    const isWanted = kind === "wanted";
    const nav = useNavigate();
    const { user, loading: authLoading } = useAuth();

    type BaselineSnapshot = {
        kind: ListingKind;
        title: string;
        category: string;
        species: string;
        waterType: string;
        sex: string;
        size: string;
        quantity: number;
        priceDollars: string;
        budget: string;
        willingToShip: boolean;
        priceType: PriceType | "";
        customPriceText: string;
        location: string;
        phone: string;
        description: string;
        photosKey: string;
    };

    function defaultSnapshot(k: ListingKind): BaselineSnapshot {
        return {
            kind: k,
            title: "",
            category: "",
            species: "",
            waterType: "",
            sex: "",
            size: "",
            quantity: 1,
            priceDollars: "",
            budget: "",
            willingToShip: false,
            priceType: "",
            customPriceText: "",
            location: "",
            phone: "",
            description: "",
            photosKey: "",
        };
    }

    const baselineRef = useRef<BaselineSnapshot>(defaultSnapshot(kind));
    const [baselineKey, setBaselineKey] = useState(0);
    const [baselineReady, setBaselineReady] = useState(!draftId);

    useEffect(() => {
        if (authLoading) return;
        if (user) return;
        nav(`/auth?next=${encodeURIComponent(listingPostPath(kind))}&ctx=${isWanted ? "wanted_post" : "create_listing"}`);
    }, [authLoading, user, nav, kind, isWanted]);

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

    const photoUploaderRef = useRef<PhotoUploaderHandle | null>(null);
    const [initialPhotoAssets, setInitialPhotoAssets] = useState<ImageAsset[]>([]);
    const [photosKey, setPhotosKey] = useState("");
    const customPriceInputRef = useRef<HTMLInputElement | null>(null);
    const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

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
    const [quantity, setQuantity] = useState(1);

    // Sale-only / wanted-only fields (kept in a single state bag for a single render path).
    const [priceDollars, setPriceDollars] = useState("");
    const [budget, setBudget] = useState("");
    const [willingToShip, setWillingToShip] = useState(false);

    const [priceType, setPriceType] = useState<PriceType | "">("");
    const [customPriceText, setCustomPriceText] = useState("");
    const priceIsSpecial = !isWanted && (priceType === "free" || priceType === "offer");
    const priceTypeRequired = !isWanted || Boolean(String(budget ?? "").trim());

    const [location, setLocation] = useState("");
    const [phone, setPhone] = useState("");
    const [description, setDescription] = useState("");

    const [showShipHint, setShowShipHint] = useState(false);
    const [shipHintVisible, setShipHintVisible] = useState(false);

    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});

    const [quantityInput, setQuantityInput] = useState("1");

    // Baseline snapshot: for new listings it's the default empty state; for drafts we replace baseline after the draft loads.
    useEffect(() => {
        baselineRef.current = defaultSnapshot(kind);
        setBaselineKey((k) => k + 1);
        setBaselineReady(!draftId);
        setPhotosKey("");
        setInitialPhotoAssets([]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind, draftId]);

    const isOtherCategory = String(category) === String(otherCategoryName);
    const bioFieldsRequired = bioRequiredCategories.has(String(category));
    const bioFieldsDisabled = Boolean(category) && !bioFieldsRequired && !isOtherCategory;
    const bioFieldsEnabled = !bioFieldsDisabled;
    // Default to required (bio is the common case). If a non-bio category is chosen, these inputs become disabled and
    // requirements/asterisks effectively drop. "Other" also drops requirements (and doesn't disable).
    const bioFieldsRequiredForUser = bioFieldsEnabled && !isOtherCategory;
    const sizeRequired = bioFieldsEnabled && !isOtherCategory;

    const budgetCents = useMemo(() => (isWanted ? dollarsToCentsMaybe(budget) : null), [budget, isWanted]);

    const sexOptions = useMemo(() => {
        if (!isWanted) return sexes;
        const base = (sexes ?? []).map(String);
        const out = [...base];
        if (!out.includes("No preference")) out.push("No preference");
        return out as any as ListingSex[];
    }, [sexes, isWanted]);

    useEffect(() => {
        let cancelled = false;
        getListingOptionsCached()
            .then((opts) => {
                if (cancelled) return;
                setCategories(opts.categories as Category[]);
                setSexes((opts as any).listingSexes as ListingSex[]);
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

    // Resume draft: prefill fields + photos.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!draftId) return;
            if (!user) return;
            try {
                if (isWanted) {
                    const w = await fetchWantedPost(draftId);
                    if (cancelled) return;
                    const decoded = decodeWantedDetailsFromDescription(String(w.description ?? ""));
                    setTitle(w.title ?? "");
                    setCategory(w.category as any);
                    setSpecies(String(w.species ?? ""));
                    setWaterType((w as any).waterType ?? "");
                    setSex((w as any).sex ?? "");
                    setSize(String((w as any).size ?? ""));
                    setQuantity(Number((w as any).quantity ?? 1));
                    setBudget(w.budgetCents != null ? String((w.budgetCents / 100).toFixed(2)) : "");
                    setLocation(String(w.location ?? ""));
                    setPhone(String(w.phone ?? ""));
                    setPriceType(decoded.details.priceType);
                    setCustomPriceText(decoded.details.customPriceText);
                    // Show only the body in the textarea.
                    setDescription(decoded.body);
                    setInitialPhotoAssets((w.images ?? []).slice(0, 6));

                    baselineRef.current = {
                        kind,
                        title: w.title ?? "",
                        category: String(w.category ?? ""),
                        species: String(w.species ?? ""),
                        waterType: String((w as any).waterType ?? ""),
                        sex: String((w as any).sex ?? ""),
                        size: String((w as any).size ?? ""),
                        quantity: Number((w as any).quantity ?? 1),
                        priceDollars: "",
                        budget: w.budgetCents != null ? String((w.budgetCents / 100).toFixed(2)) : "",
                        willingToShip: false,
                        priceType: decoded.details.priceType,
                        customPriceText: decoded.details.customPriceText,
                        location: String(w.location ?? ""),
                        phone: String(w.phone ?? ""),
                        description: decoded.body,
                        photosKey: (w.images ?? []).slice(0, 6).map((a: any) => `existing:${String(a.fullUrl ?? "")}`).join("|"),
                    };
                    setBaselineReady(true);
                    setBaselineKey((k) => k + 1);
                } else {
                    const l = await fetchListing(draftId);
                    if (cancelled) return;
                    const decoded = decodeSaleDetailsFromDescription(String(l.description ?? ""));
                    setTitle(l.title ?? "");
                    setCategory(l.category as any);
                    setSpecies(String(l.species ?? ""));
                    setWaterType((l as any).waterType ?? "");
                    setSex((l as any).sex ?? "");
                    setSize(String((l as any).size ?? ""));
                    setQuantity(decoded.details.quantity ?? Number((l as any).quantity ?? 1));
                    setPriceType(decoded.details.priceType);
                    setCustomPriceText(decoded.details.customPriceText);
                    setWillingToShip(decoded.details.willingToShip);
                    setPriceDollars(String((l.priceCents / 100).toFixed(2)));
                    setLocation(String(l.location ?? ""));
                    setPhone(String(l.phone ?? ""));
                    // Show only the body in the textarea.
                    setDescription(decoded.body);
                    setInitialPhotoAssets((l.images ?? []).slice(0, 6));

                    baselineRef.current = {
                        kind,
                        title: l.title ?? "",
                        category: String(l.category ?? ""),
                        species: String(l.species ?? ""),
                        waterType: String((l as any).waterType ?? ""),
                        sex: String((l as any).sex ?? ""),
                        size: String((l as any).size ?? ""),
                        quantity: decoded.details.quantity ?? Number((l as any).quantity ?? 1),
                        priceDollars: String((l.priceCents / 100).toFixed(2)),
                        budget: "",
                        willingToShip: decoded.details.willingToShip,
                        priceType: decoded.details.priceType,
                        customPriceText: decoded.details.customPriceText,
                        location: String(l.location ?? ""),
                        phone: String(l.phone ?? ""),
                        description: decoded.body,
                        photosKey: (l.images ?? []).slice(0, 6).map((a: any) => `existing:${String(a.fullUrl ?? "")}`).join("|"),
                    };
                    setBaselineReady(true);
                    setBaselineKey((k) => k + 1);
                }
            } catch (e: any) {
                if (!cancelled) setErr(e?.message ?? "Failed to load draft");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [draftId, user, isWanted]);

    function clearFieldError(k: FieldKey) {
        setFieldErrors((prev) => {
            if (!prev[k]) return prev;
            return { ...prev, [k]: undefined };
        });
    }

    useEffect(() => {
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
        if (priceType !== "custom") return;
        window.setTimeout(() => customPriceInputRef.current?.focus(), 0);
    }, [priceType]);

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
        if (isWanted) return;
        if (willingToShip) {
            setShowShipHint(true);
            window.requestAnimationFrame(() => setShipHintVisible(true));
            return;
        }
        setShipHintVisible(false);
        const t = window.setTimeout(() => setShowShipHint(false), 250);
        return () => window.clearTimeout(t);
    }, [willingToShip, isWanted]);

    async function submit(mode: "active" | "draft", e?: FormEvent) {
        if (e) e.preventDefault();
        setErr(null);
        setFieldErrors({});

        const strict = mode === "active";
        const nextErrors: Partial<Record<FieldKey, string>> = {};
        if (strict) {
            if (!title.trim()) nextErrors.title = "Required field";
            if (!category) nextErrors.category = "Required field";

            if (bioFieldsRequiredForUser && !species.trim()) nextErrors.species = "Required field";
            if (bioFieldsRequiredForUser && !waterType) nextErrors.waterType = "Required field";
            if (bioFieldsRequiredForUser && !sex) nextErrors.sex = "Required field";
            if (sizeRequired && !size.trim()) nextErrors.size = "Required field";
        }

        const qty = Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
        if (strict && qty < 1) nextErrors.quantity = "Quantity must be at least 1.";

        if (strict && !location.trim()) nextErrors.location = "Required field";

        const phoneTrim = phone.trim();
        if (strict) {
            if (!phoneTrim) nextErrors.phone = "Required field";
            else if (phoneTrim.length < 6) nextErrors.phone = "Phone number looks too short.";
            else if (phoneTrim.length > 30) nextErrors.phone = "Phone number is too long.";
        } else {
            if (phoneTrim && phoneTrim.length < 6) nextErrors.phone = "Phone number looks too short.";
            else if (phoneTrim.length > 30) nextErrors.phone = "Phone number is too long.";
        }

        const custom = customPriceText.trim();
        if (strict && priceTypeRequired && !priceType) nextErrors.priceType = "Required field";
        // If user selected "custom" at all, custom text must be present (even if price type isn't required by budget).
        if (strict && priceType === "custom" && !custom) nextErrors.customPriceText = "Required field";
        else if (priceType === "custom" && custom.length > MAX_CUSTOM_PRICE_TYPE_LEN) {
            nextErrors.customPriceText = `Custom price type must be ${MAX_CUSTOM_PRICE_TYPE_LEN} characters or less.`;
        }

        const body = String(description ?? "").trim();
        if (strict && !body) nextErrors.description = "Required field";
        if (body.length > MAX_DESC_BODY_LEN) nextErrors.description = `Description is too long. Max ${MAX_DESC_BODY_LEN} characters.`;

        const priceIsSpecial = !isWanted && (priceType === "free" || priceType === "offer");
        const priceCents = isWanted
            ? null
            : priceIsSpecial
                ? 0
                : strict
                    ? dollarsToCentsMaybe(priceDollars)
                    : (dollarsToCentsMaybe(priceDollars) ?? 0);
        if (!isWanted && strict && !priceIsSpecial && priceCents === null) nextErrors.price = "Please enter a valid non-negative price.";

        if (Object.values(nextErrors).some(Boolean)) {
            setFieldErrors(nextErrors);
            setErr(strict ? "Please fill out the required fields." : "Please fix the highlighted fields.");
            return;
        }

        // Narrow types for TS (should be unreachable due to validation above).
        if (!isWanted && strict && !priceIsSpecial && priceCents === null) return;
        if (strict && bioFieldsRequiredForUser && !sex) return;

        const photoCounts = photoUploaderRef.current?.getCounts() ?? { total: 0, uploaded: 0 };
        if (strict && photoCounts.total === 0) {
            const ok = window.confirm(
                isWanted
                    ? "You haven't added any photos. Post this wanted listing without photos?"
                    : "You haven't added any photos. Post this listing without photos?",
            );
            if (!ok) return;
        }

        setSubmitting(true);
        try {
            await photoUploaderRef.current?.ensureUploaded();
            const uploadedAssets = photoUploaderRef.current?.getAssets() ?? [];
            if (photoCounts.total > 0 && uploadedAssets.length === 0) {
                throw new Error("Images were selected but none uploaded successfully. Remove broken images or retry upload.");
            }

            if (isWanted) {
                const finalDescription = encodeWantedDetailsIntoDescription({ priceType, customPriceText: custom }, body);
                if (draftId) {
                    await updateWantedPost(draftId, {
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
                    if (mode === "draft") {
                        nav("/me?type=drafts");
                        return;
                    }
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
                        status: "active",
                    });
                    await deleteWantedPost(draftId);
                    nav(listingDetailPath(kind, w.id));
                    return;
                }

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
                    status: mode,
                });
                nav(mode === "draft" ? "/me?type=drafts" : listingDetailPath(kind, w.id));
            } else {
                const sexToSubmit: ListingSex = ((bioFieldsEnabled && sex ? sex : "Unknown") as ListingSex) ?? "Unknown";
                const speciesToSubmit = bioFieldsEnabled ? species.trim() : "";
                const finalDescription = encodeSaleDetailsIntoDescription(
                    { quantity: qty, priceType, customPriceText: custom, willingToShip },
                    body,
                );

                if (draftId) {
                    await updateListing(draftId, {
                        title: title.trim(),
                        category,
                        species: speciesToSubmit,
                        sex: sexToSubmit,
                        waterType: bioFieldsEnabled && waterType ? waterType : null,
                        size: size.trim(),
                        shippingOffered: willingToShip,
                        priceCents: priceCents!,
                        location: location.trim(),
                        description: finalDescription,
                        phone: phoneTrim,
                        images: uploadedAssets,
                    });
                    if (mode === "draft") {
                        nav("/me?type=drafts");
                        return;
                    }
                    const created = await createListing({
                        title: title.trim(),
                        category,
                        species: speciesToSubmit,
                        sex: sexToSubmit,
                        waterType: bioFieldsEnabled && waterType ? waterType : null,
                        size: size.trim(),
                        shippingOffered: willingToShip,
                        priceCents: strict ? priceCents! : (priceCents ?? 0),
                        location: location.trim(),
                        description: finalDescription,
                        phone: phoneTrim,
                        images: uploadedAssets,
                        status: "active",
                    });
                    await deleteListing(draftId);
                    nav(listingDetailPath(kind, created.id));
                    return;
                }

                const created = await createListing({
                    title: title.trim(),
                    category,
                    species: speciesToSubmit,
                    sex: sexToSubmit,
                    waterType: bioFieldsEnabled && waterType ? waterType : null,
                    size: size.trim(),
                    shippingOffered: willingToShip,
                    priceCents: strict ? priceCents! : (priceCents ?? 0),
                    location: location.trim(),
                    description: finalDescription,
                    phone: phoneTrim,
                    images: uploadedAssets,
                    status: mode,
                });

                nav(mode === "draft" ? "/me?type=drafts" : listingDetailPath(kind, created.id));
            }
        } catch (e: any) {
            setErr(e?.message ?? (isWanted ? "Failed to create wanted post" : "Failed to post listing"));
        } finally {
            setSubmitting(false);
        }
    }

    async function onSubmit(e: FormEvent) {
        return submit("active", e);
    }

    const maxDescLen = MAX_DESC_BODY_LEN;

    const isDirty = useMemo(() => {
        if (!baselineReady) return false;
        const b = baselineRef.current;
        const curr: BaselineSnapshot = {
            kind,
            title,
            category: String(category ?? ""),
            species,
            waterType: String(waterType ?? ""),
            sex: String(sex ?? ""),
            size,
            quantity: Number(quantity ?? 1),
            priceDollars,
            budget,
            willingToShip,
            priceType,
            customPriceText,
            location,
            phone,
            description,
            photosKey,
        };

        return (
            curr.kind !== b.kind ||
            curr.title !== b.title ||
            curr.category !== b.category ||
            curr.species !== b.species ||
            curr.waterType !== b.waterType ||
            curr.sex !== b.sex ||
            curr.size !== b.size ||
            curr.quantity !== b.quantity ||
            curr.priceDollars !== b.priceDollars ||
            curr.budget !== b.budget ||
            curr.willingToShip !== b.willingToShip ||
            curr.priceType !== b.priceType ||
            curr.customPriceText !== b.customPriceText ||
            curr.location !== b.location ||
            curr.phone !== b.phone ||
            curr.description !== b.description ||
            curr.photosKey !== b.photosKey
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        baselineReady,
        baselineKey,
        kind,
        title,
        category,
        species,
        waterType,
        sex,
        size,
        quantity,
        priceDollars,
        budget,
        willingToShip,
        priceType,
        customPriceText,
        location,
        phone,
        description,
        photosKey,
    ]);

    return (
        <div className="min-h-full">
            <Header maxWidth={isWanted ? "6xl" : "3xl"} />
            <main className="mx-auto max-w-3xl px-4 py-6">
                <h1 className={["text-2xl font-extrabold text-slate-900", isWanted ? "tracking-tight" : ""].join(" ")}>
                    {isWanted ? "Create a wanted listing" : "Create a sale listing"}
                </h1>
                <div className="mt-1 text-sm text-slate-600">Add details, photos, and pricing to publish your listing.</div>

                <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
                    {/* Images */}
                    <PhotoUploader
                        ref={photoUploaderRef}
                        initialAssets={initialPhotoAssets}
                        disabled={submitting}
                        onChange={(next) => setPhotosKey(next.itemsKey)}
                    />

                    {/* Fields */}
                    <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="Title" required error={fieldErrors.title} className="sm:col-span-2">
                            <input
                                value={title}
                                onChange={(e) => {
                                    setTitle(e.target.value);
                                    clearFieldError("title");
                                }}
                                className={controlClass(Boolean(fieldErrors.title))}
                                required
                                minLength={3}
                                maxLength={80}
                            />
                        </Field>

                        <Field label="Category" required error={fieldErrors.category} className="sm:col-span-1">
                            <select
                                value={category}
                                onChange={(e) => {
                                    setCategory(e.target.value as Category);
                                    clearFieldError("category");
                                }}
                                className={controlClass(Boolean(fieldErrors.category), "bg-white")}
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
                        </Field>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-4">
                        <Field label="Species" required={bioFieldsRequiredForUser} error={fieldErrors.species}>
                            <input
                                value={species}
                                onChange={(e) => {
                                    setSpecies(e.target.value);
                                    clearFieldError("species");
                                }}
                                className={controlClass(
                                    Boolean(fieldErrors.species),
                                    "disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed",
                                )}
                                required={bioFieldsRequiredForUser}
                                disabled={bioFieldsDisabled}
                                minLength={2}
                                maxLength={60}
                            />
                        </Field>

                        <Field label="Water type" required={bioFieldsRequiredForUser} error={fieldErrors.waterType}>
                            <select
                                value={waterType}
                                onChange={(e) => {
                                    setWaterType(e.target.value as WaterType);
                                    clearFieldError("waterType");
                                }}
                                className={controlClass(
                                    Boolean(fieldErrors.waterType),
                                    "bg-white disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed",
                                )}
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
                        </Field>

                        <Field label="Sex" required={bioFieldsRequiredForUser} error={fieldErrors.sex}>
                            <select
                                value={sex}
                                onChange={(e) => {
                                    setSex(e.target.value as any);
                                    clearFieldError("sex");
                                }}
                                className={controlClass(
                                    Boolean(fieldErrors.sex),
                                    "bg-white disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed",
                                )}
                                required={bioFieldsRequiredForUser}
                                disabled={bioFieldsDisabled}
                            >
                                <option value="" disabled hidden>
                                    Select…
                                </option>
                                {!sexOptions.length ? (
                                    <option value="" disabled>
                                        Loading…
                                    </option>
                                ) : (
                                    sexOptions.map((s) => (
                                        <option key={String(s)} value={String(s)}>
                                            {String(s)}
                                        </option>
                                    ))
                                )}
                            </select>
                        </Field>

                        <Field label="Size" required={sizeRequired} error={fieldErrors.size}>
                            <input
                                value={size}
                                onChange={(e) => {
                                    setSize(e.target.value);
                                    clearFieldError("size");
                                }}
                                className={controlClass(
                                    Boolean(fieldErrors.size),
                                    "disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed",
                                )}
                                required={sizeRequired}
                                maxLength={40}
                                disabled={submitting || bioFieldsDisabled}
                            />
                        </Field>
                    </div>

                    {/* Row 2: Price/Budget + Quantity + Price type */}
                    <div className="grid gap-3 sm:grid-cols-3">
                        {isWanted ? (
                            <Field label="Budget ($)">
                                <input
                                    inputMode="decimal"
                                    value={budget}
                                    placeholder='Leave blank for "Make an Offer"'
                                    onChange={(e) => setBudget(sanitizeMoneyInput(e.target.value))}
                                    maxLength={MAX_MONEY_INPUT_LEN}
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                                />
                            </Field>
                        ) : (
                            <Field label="Price ($)" required={!priceIsSpecial} error={fieldErrors.price}>
                                <input
                                    value={priceIsSpecial ? "" : priceDollars}
                                    placeholder={priceIsSpecial ? (priceType === "free" ? "Free" : "Make an Offer") : undefined}
                                    onChange={(e) => {
                                        setPriceDollars(sanitizeMoneyInput(e.target.value));
                                        clearFieldError("price");
                                    }}
                                    inputMode="decimal"
                                    maxLength={MAX_MONEY_INPUT_LEN}
                                    className={controlClass(
                                        Boolean(fieldErrors.price),
                                        "disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed",
                                    )}
                                    required={!priceIsSpecial}
                                    disabled={submitting || priceIsSpecial}
                                />
                            </Field>
                        )}

                        <Field label="Quantity" required error={fieldErrors.quantity}>
                            <input
                            type="number"
                            value={quantityInput}
                            onChange={(e) => {
                                const raw = e.target.value;

                                // Allow empty while typing
                                if (raw === "") {
                                setQuantityInput("");
                                return;
                                }

                                // Only allow digits
                                if (!/^\d+$/.test(raw)) return;

                                setQuantityInput(raw);
                                clearFieldError("quantity");
                            }}
                            onBlur={() => {
                                const n = Number.parseInt(quantityInput, 10);

                                const finalValue = Number.isFinite(n) && n >= 1 ? n : 1;

                                setQuantityInput(String(finalValue));
                                setQuantity(finalValue);
                            }}
                            inputMode="numeric"
                            step={1}
                            min={1}
                            className={controlClass(Boolean(fieldErrors.quantity))}
                            required
                            />
                        </Field>

                        <div className="block">
                            <div className={["mb-1 text-xs font-semibold", fieldErrors.priceType || fieldErrors.customPriceText ? "text-red-700" : "text-slate-700"].join(" ")}>
                                Price type {priceTypeRequired ? <span className="text-red-600">*</span> : null}
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
                                                "h-10 w-full rounded-xl border px-3 py-2 text-sm outline-none",
                                                fieldErrors.customPriceText ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                                            ].join(" ")}
                                            placeholder="e.g. breeding pair"
                                            maxLength={MAX_CUSTOM_PRICE_TYPE_LEN}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setPriceType("")}
                                            className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
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
                                        setPriceType(e.target.value as PriceType | "");
                                        clearFieldError("priceType");
                                    }}
                                    className={[
                                        "h-10 w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none",
                                        fieldErrors.priceType ? "border-red-300 focus:border-red-500" : "border-slate-200 focus:border-slate-400",
                                    ].join(" ")}
                                    required={priceTypeRequired}
                                >
                                    <option value="each">Each</option>
                                    <option value="all">All</option>
                                    {isWanted ? null : <option value="offer">Make an Offer</option>}
                                    {isWanted ? null : <option value="free">Free</option>}
                                    <option value="custom">Custom</option>
                                    <option value="" disabled hidden>
                                        Select...
                                    </option>
                                </select>
                            )}
                            {fieldErrors.priceType && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.priceType}</div>}
                        </div>
                    </div>

                    {/* Row 3: Phone + Location + (Sale) Shipping */}
                    <div className={["grid gap-3", "sm:grid-cols-4"].join(" ")}>
                        <label className={["block", isWanted ? "" : "sm:col-span-1"].join(" ")}>
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

                        <label className={["block", isWanted ? "" : "sm:col-span-1"].join(" ")}>
                            <div className={["mb-1 text-xs font-semibold", fieldErrors.location ? "text-red-700" : "text-slate-700"].join(" ")}>
                                Location <span className="text-red-600">*</span>
                            </div>
                            <div className={[fieldErrors.location ? "rounded-xl ring-1 ring-red-300" : ""].join(" ")}>
                                <LocationTypeaheadAU
                                    value={location}
                                    onChange={(v) => {
                                        setLocation(v);
                                        clearFieldError("location");
                                    }}
                                    debounceMs={220}
                                />
                            </div>
                            {fieldErrors.location && <div className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.location}</div>}
                        </label>

                        {!isWanted && (
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
                        )}
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
                            disabled={submitting}
                            className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                        >
                            {submitting ? "Posting..." : "Post listing"}
                        </button>

                        {isDirty && (
                            <button
                                type="button"
                                disabled={submitting}
                                onClick={() => submit("draft")}
                                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
                            >
                                Save draft
                            </button>
                        )}

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
    const [sp] = useSearchParams();
    const kind = parseListingKind(kindParam);
    const draftId = sp.get("draft");
    return <PostForm kind={kind} draftId={draftId} />;
}

