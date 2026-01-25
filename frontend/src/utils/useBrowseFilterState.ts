import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getListingOptionsCached, type Category, type ListingSex, type SortMode, type WaterType } from "../api";

export type BrowseType = "sale" | "wanted";
export const BROWSE_PER_PAGE = 18;

function clampInt(v: string | null, fallback: number, min: number, max: number) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
}

export const SPECIES_PRESETS = [
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
] as const;

export function useBrowseFilterState() {
    const [sp, setSp] = useSearchParams();
    const topRef = useRef<HTMLDivElement | null>(null);

    // URL-backed state
    const browseType: BrowseType = sp.get("type") === "wanted" ? "wanted" : "sale";

    const q = sp.get("q") ?? "";
    const category = (sp.get("category") ?? "") as "" | Category;
    const species = sp.get("species") ?? "";
    const location = sp.get("location") ?? "";
    const waterType = sp.get("waterType") ?? "";
    const sex = sp.get("sex") ?? "";
    const shippingOnly = sp.get("ship") === "1";
    const minDollars = sp.get("min") ?? "";
    const maxDollars = sp.get("max") ?? "";
    const budgetDollars = sp.get("budget") ?? "";
    const rawSort = (sp.get("sort") ?? "newest") as SortMode;
    const sort: SortMode = (() => {
        // Only allow relevance if a search term is present (otherwise it behaves like newest).
        const hasQuery = Boolean(String(q ?? "").trim());
        if (browseType === "sale") {
            return rawSort === "newest" ||
                rawSort === "views_desc" ||
                rawSort === "price_asc" ||
                rawSort === "price_desc" ||
                (rawSort === "relevance" && hasQuery)
                ? rawSort
                : "newest";
        }
        // wanted
        return rawSort === "newest" ||
            rawSort === "views_desc" ||
            rawSort === "budget_asc" ||
            rawSort === "budget_desc" ||
            (rawSort === "relevance" && hasQuery)
            ? rawSort
            : "newest";
    })();

    // Default sorting behavior:
    // - If arriving with a search query and no explicit sort, default to Relevance.
    // - If the user types a search query while still on the default "Newest" sort, switch to Relevance.
    // - If query is cleared and URL still says relevance, normalize back to Newest.
    useEffect(() => {
        const hasQuery = Boolean(String(q ?? "").trim());
        const curSort = String(sp.get("sort") ?? "").trim();
        const hasExplicitSort = sp.has("sort");

        // If the user hasn't chosen a sort (no param), or is still on the default "newest",
        // switch to relevance as soon as a search term exists.
        if (hasQuery && (!hasExplicitSort || curSort === "newest")) {
            const next = new URLSearchParams(sp);
            next.set("sort", "relevance");
            // keep page stable: query changes already reset page elsewhere; but ensure sane default if missing
            if (!next.get("page")) next.set("page", "1");
            setSp(next, { replace: true });
            return;
        }

        if (!hasQuery && curSort === "relevance") {
            const next = new URLSearchParams(sp);
            next.set("sort", "newest");
            if (!next.get("page")) next.set("page", "1");
            setSp(next, { replace: true });
        }
    }, [q, setSp, sp]);

    const page = clampInt(sp.get("page"), 1, 1, 999999);
    const per = BROWSE_PER_PAGE;

    useEffect(() => {
        // Per-page selection has been removed; normalize legacy links that still contain ?per=...
        if (!sp.has("per")) return;
        const next = new URLSearchParams(sp);
        next.delete("per");
        setSp(next, { replace: true });
    }, [setSp, sp]);

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
            const s = (next.get("sort") ?? "newest") as SortMode;
            if (s === "price_asc" || s === "price_desc") next.set("sort", "newest");
            if (!next.get("sort")) next.set("sort", "newest");
            // Wanted uses a single budget filter, not min/max.
            next.delete("min");
            next.delete("max");
        } else {
            const s = (next.get("sort") ?? "newest") as SortMode;
            if (s === "budget_asc" || s === "budget_desc") next.set("sort", "newest");
            if (!next.get("sort")) next.set("sort", "newest");
            // Sale uses min/max price, not a single budget.
            next.delete("budget");
        }
        setSp(next, { replace: true });
    }

    function clearFilters() {
        const next = new URLSearchParams();
        next.set("type", browseType);
        next.set("page", "1");
        next.set("sort", "newest");
        setSp(next, { replace: true });
    }

    // Options (same source as PostListing forms)
    const [categories, setCategories] = useState<Category[]>([]);
    const categoryOptions = useMemo(() => ["", ...categories] as Array<"" | Category>, [categories]);
    const [waterTypes, setWaterTypes] = useState<WaterType[]>([]);
    const [listingSexes, setListingSexes] = useState<ListingSex[]>([]);
    const [bioRequiredCategories, setBioRequiredCategories] = useState<Set<string>>(new Set());
    const [otherCategoryName, setOtherCategoryName] = useState("Other");

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

    const wantedSexOptions = useMemo(() => {
        const base = (listingSexes ?? []).map(String);
        const out = [...base];
        if (!out.includes("No preference")) out.push("No preference");
        return out as ListingSex[];
    }, [listingSexes]);

    useEffect(() => {
        // If a non-bio category is chosen, clear bio-only filters so results aren't confusing.
        if (!category) return;
        if (!bioFieldsDisabled) return;
        const next = new URLSearchParams(sp);
        const had = next.has("species") || next.has("waterType") || next.has("sex");
        if (!had) return;
        next.delete("species");
        next.delete("waterType");
        next.delete("sex");
        next.set("page", "1");
        setSp(next, { replace: true });
    }, [bioFieldsDisabled, category, setSp, sp]);

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

    const budgetCents = useMemo(() => {
        const s = String(budgetDollars ?? "").trim();
        if (!s) return undefined;
        const n = Number(s);
        return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
    }, [budgetDollars]);

    return {
        sp,
        setSp,
        topRef,

        // url params
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

        // derived
        minCents,
        maxCents,
        budgetCents,
        bioFieldsDisabled,
        categoryOptions,
        waterTypes,
        listingSexes,
        wantedSexOptions,

        // actions
        setParam,
        setBrowseType,
        clearFilters,
    };
}

