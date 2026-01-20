import { type ReactNode } from "react";
import type { Category, ListingSex, WaterType } from "../api";
import { LocationTypeaheadAU } from "./LocationTypeaheadAU";

export type BrowseType = "sale" | "wanted";

function Field(props: { label: string; children: ReactNode }) {
    const { label, children } = props;
    return (
        <label className="block">
            <div className="mb-1 text-xs font-semibold text-slate-700">{label}</div>
            {children}
        </label>
    );
}

export default function BrowseFilters(props: {
    browseType: BrowseType;
    setBrowseType: (t: BrowseType) => void;
    clearFilters: () => void;

    location: string;
    setLocation: (v: string) => void;

    shippingOnly: boolean;
    setShippingOnly: (v: boolean) => void;

    waterType: string;
    setWaterType: (v: string) => void;
    waterTypes: WaterType[];

    category: "" | Category;
    setCategory: (v: string) => void;
    categoryOptions: Array<"" | Category>;

    species: string;
    setSpecies: (v: string) => void;
    speciesPresets: string[];

    minDollars: string;
    setMinDollars: (v: string) => void;
    maxDollars: string;
    setMaxDollars: (v: string) => void;

    budgetDollars: string;
    setBudgetDollars: (v: string) => void;

    sex: string;
    setSex: (v: string) => void;
    listingSexes: ListingSex[];
    wantedSexOptions: ListingSex[];

    bioFieldsDisabled: boolean;
}) {
    const {
        browseType,
        setBrowseType,
        clearFilters,
        location,
        setLocation,
        shippingOnly,
        setShippingOnly,
        waterType,
        setWaterType,
        waterTypes,
        category,
        setCategory,
        categoryOptions,
        species,
        setSpecies,
        speciesPresets,
        minDollars,
        setMinDollars,
        maxDollars,
        setMaxDollars,
        budgetDollars,
        setBudgetDollars,
        sex,
        setSex,
        listingSexes,
        wantedSexOptions,
        bioFieldsDisabled,
    } = props;

    const isSale = browseType === "sale";
    const sexOptions = isSale ? listingSexes : wantedSexOptions;

    const moneyRow = isSale ? (
        <div className="grid grid-cols-2 gap-3">
            <Field label="Min price ($)">
                <input
                    value={minDollars}
                    onChange={(e) => setMinDollars(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
            </Field>
            <Field label="Max price ($)">
                <input
                    value={maxDollars}
                    onChange={(e) => setMaxDollars(e.target.value)}
                    inputMode="decimal"
                    placeholder="200"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
            </Field>
        </div>
    ) : (
        <Field label="Min budget ($)">
            <input
                value={budgetDollars}
                onChange={(e) => setBudgetDollars(e.target.value)}
                inputMode="decimal"
                placeholder="200"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
        </Field>
    );

    return (
        <aside
            className="rounded-2xl border border-slate-200 bg-white p-4 md:sticky md:top-24 md:self-start md:max-h-[calc(100vh-7rem)] md:overflow-auto"
            // Keep inner scrollbar from changing layout width when content height differs between Sale/Wanted.
            style={{ scrollbarGutter: "stable" }}
        >
            <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-slate-900">Filters</div>
                <button type="button" onClick={clearFilters} className="text-xs font-semibold text-slate-600 hover:text-slate-900">
                    Clear
                </button>
            </div>

            <div className="mt-4 space-y-3">
                <Field label="Listing type">
                    <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <button
                            type="button"
                            onClick={() => setBrowseType("sale")}
                            className={[
                                "flex-1 px-3 py-2 text-sm font-semibold",
                                browseType === "sale" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
                            ].join(" ")}
                            aria-pressed={browseType === "sale"}
                        >
                            For sale
                        </button>
                        <button
                            type="button"
                            onClick={() => setBrowseType("wanted")}
                            className={[
                                "flex-1 px-3 py-2 text-sm font-semibold",
                                browseType === "wanted" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
                            ].join(" ")}
                            aria-pressed={browseType === "wanted"}
                        >
                            Wanted
                        </button>
                    </div>
                </Field>

                <Field label="Location">
                    <LocationTypeaheadAU value={location} onChange={setLocation} placeholder="Start typing your area…" />
                </Field>

                {isSale && (
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={shippingOnly}
                            onChange={(e) => setShippingOnly(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-slate-900"
                        />
                        <span className="text-xs font-semibold text-slate-700">Shipping offered</span>
                    </label>
                )}

                <Field label="Category">
                    <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    >
                        {categoryOptions.map((c) => (
                            <option key={c || "Any"} value={c}>
                                {c ? c : "Any"}
                            </option>
                        ))}
                    </select>
                </Field>

                <Field label="Water type">
                    <select
                        value={waterType}
                        onChange={(e) => setWaterType(e.target.value)}
                        disabled={bioFieldsDisabled}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                    >
                        <option value="">Any</option>
                        {waterTypes.map((w) => (
                            <option key={w} value={w}>
                                {w}
                            </option>
                        ))}
                    </select>
                </Field>

                <Field label="Species">
                    <select
                        value={species}
                        onChange={(e) => setSpecies(e.target.value)}
                        disabled={bioFieldsDisabled}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                    >
                        {speciesPresets.map((s) => (
                            <option key={s} value={s}>
                                {s ? s : "Any"}
                            </option>
                        ))}
                    </select>
                </Field>

                {moneyRow}

                <Field label="Sex">
                    <select
                        value={sex}
                        onChange={(e) => setSex(e.target.value)}
                        disabled={bioFieldsDisabled}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                    >
                        <option value="">Any</option>
                        {sexOptions.map((s) => (
                            <option key={s} value={s}>
                                {s}
                            </option>
                        ))}
                    </select>
                </Field>
            </div>
        </aside>
    );
}

