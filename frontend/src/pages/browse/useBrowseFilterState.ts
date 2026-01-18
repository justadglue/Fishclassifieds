import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getListingOptionsCached, type Category, type ListingSex, type WantedStatus, type WaterType } from "../../api";

export type BrowseType = "sale" | "wanted";
export type SortMode = "newest" | "price_asc" | "price_desc";
export type PageSize = 12 | 24 | 48 | 96;

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
  const age = sp.get("age") ?? "";
  const minDollars = sp.get("min") ?? "";
  const maxDollars = sp.get("max") ?? "";
  const sort = (sp.get("sort") ?? "newest") as SortMode;
  const featuredOnly = sp.get("featured") === "1";
  const wantedStatus = (sp.get("status") ?? "") as "" | WantedStatus;

  const page = clampInt(sp.get("page"), 1, 1, 999999);
  const per = clampInt(sp.get("per"), 24, 12, 200) as PageSize;

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
      next.delete("sort");
      next.delete("featured");
    } else {
      if (!next.get("sort")) next.set("sort", "newest");
      next.delete("status");
    }
    setSp(next, { replace: true });
  }

  function clearFilters() {
    const next = new URLSearchParams();
    next.set("type", browseType);
    next.set("page", "1");
    if (browseType === "sale") next.set("sort", "newest");
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
    const had = next.has("species") || next.has("waterType") || next.has("sex") || next.has("age");
    if (!had) return;
    next.delete("species");
    next.delete("waterType");
    next.delete("sex");
    next.delete("age");
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
    age,
    minDollars,
    maxDollars,
    sort,
    featuredOnly,
    wantedStatus,
    page,
    per,

    // derived
    minCents,
    maxCents,
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

