import type { Category, ListingSex, WantedStatus, WaterType } from "../../api";

export type BrowseType = "sale" | "wanted";

export default function BrowseFilters(props: {
    browseType: BrowseType;
    setBrowseType: (t: BrowseType) => void;
    clearFilters: () => void;

    category: "" | Category;
    setCategory: (v: string) => void;
    categoryOptions: Array<"" | Category>;

    species: string;
    setSpecies: (v: string) => void;
    speciesPresets: string[];

    waterType: string;
    setWaterType: (v: string) => void;
    waterTypes: WaterType[];

    sex: string;
    setSex: (v: string) => void;
    listingSexes: ListingSex[];
    wantedSexOptions: ListingSex[];

    age: string;
    setAge: (v: string) => void;

    location: string;
    setLocation: (v: string) => void;

    minDollars: string;
    setMinDollars: (v: string) => void;
    maxDollars: string;
    setMaxDollars: (v: string) => void;

    wantedStatus: "" | WantedStatus;
    setWantedStatus: (v: string) => void;

    featuredOnly: boolean;
    setFeaturedOnly: (v: boolean) => void;

    bioFieldsDisabled: boolean;
}) {
    const {
        browseType,
        setBrowseType,
        clearFilters,
        category,
        setCategory,
        categoryOptions,
        species,
        setSpecies,
        speciesPresets,
        waterType,
        setWaterType,
        waterTypes,
        sex,
        setSex,
        listingSexes,
        wantedSexOptions,
        age,
        setAge,
        location,
        setLocation,
        minDollars,
        setMinDollars,
        maxDollars,
        setMaxDollars,
        wantedStatus,
        setWantedStatus,
        featuredOnly,
        setFeaturedOnly,
        bioFieldsDisabled,
    } = props;

    return (
        <aside className="rounded-2xl border border-slate-200 bg-white p-4 md:sticky md:top-24 md:self-start md:max-h-[calc(100vh-7rem)] md:overflow-auto">
            <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-slate-900">Filters</div>
                <button type="button" onClick={clearFilters} className="text-xs font-semibold text-slate-600 hover:text-slate-900">
                    Clear
                </button>
            </div>

            <div className="mt-4 space-y-3">
                <label className="block">
                    <div className="mb-1 text-xs font-semibold text-slate-700">Listing type</div>
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
                </label>

                <label className="block">
                    <div className="mb-1 text-xs font-semibold text-slate-700">Category</div>
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
                </label>

                <label className="block">
                    <div className="mb-1 text-xs font-semibold text-slate-700">Species</div>
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
                </label>

                <label className="block">
                    <div className="mb-1 text-xs font-semibold text-slate-700">Water type</div>
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
                </label>

                <label className="block">
                    <div className="mb-1 text-xs font-semibold text-slate-700">Sex</div>
                    <select
                        value={sex}
                        onChange={(e) => setSex(e.target.value)}
                        disabled={bioFieldsDisabled}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                    >
                        <option value="">Any</option>
                        {(browseType === "wanted" ? wantedSexOptions : listingSexes).map((s) => (
                            <option key={s} value={s}>
                                {s}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="block">
                    <div className="mb-1 text-xs font-semibold text-slate-700">Age</div>
                    <input
                        value={age}
                        onChange={(e) => setAge(e.target.value)}
                        disabled={bioFieldsDisabled}
                        placeholder="e.g. juvenile"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                    />
                </label>

                <label className="block">
                    <div className="mb-1 text-xs font-semibold text-slate-700">Location</div>
                    <input
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="e.g. Brisbane"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    />
                </label>

                <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                        <div className="mb-1 text-xs font-semibold text-slate-700">{browseType === "sale" ? "Min price ($)" : "Min budget ($)"}</div>
                        <input
                            value={minDollars}
                            onChange={(e) => setMinDollars(e.target.value)}
                            inputMode="decimal"
                            placeholder="0"
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                        />
                    </label>
                    <label className="block">
                        <div className="mb-1 text-xs font-semibold text-slate-700">{browseType === "sale" ? "Max price ($)" : "Max budget ($)"}</div>
                        <input
                            value={maxDollars}
                            onChange={(e) => setMaxDollars(e.target.value)}
                            inputMode="decimal"
                            placeholder="200"
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                        />
                    </label>
                </div>

                {browseType === "wanted" ? (
                    <label className="block">
                        <div className="mb-1 text-xs font-semibold text-slate-700">Status</div>
                        <select
                            value={wantedStatus}
                            onChange={(e) => setWantedStatus(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                        >
                            <option value="">Any</option>
                            <option value="open">Active</option>
                            <option value="closed">Closed</option>
                        </select>
                    </label>
                ) : (
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={featuredOnly}
                            onChange={(e) => setFeaturedOnly(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-slate-900"
                        />
                        <span className="text-xs font-semibold text-slate-700">Featured only</span>
                    </label>
                )}

                <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                    {browseType === "sale"
                        ? "Tip: category narrows broad items; search finds details like “cherry”, “pair”, “breeder”."
                        : "Tip: use search for details like “pair”, “juvenile”, or “pickup”. Include location for local-only requests."}
                </div>
            </div>
        </aside>
    );
}

