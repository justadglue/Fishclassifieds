import { useEffect, useMemo, useRef, useState } from "react";

export type AuLocation = {
    id: string;
    label: string; // "LGA, ST"
    lga: string;
    state: string;
    population?: number | null;
};

let _locationsPromise: Promise<AuLocation[]> | null = null;

async function fetchLocationsAU(): Promise<AuLocation[]> {
    const res = await fetch("/locations.au.json", { credentials: "same-origin" });
    if (!res.ok) throw new Error(`Failed to load locations.au.json (${res.status})`);
    const data = (await res.json()) as AuLocation[];
    return Array.isArray(data) ? data : [];
}

function getLocationsCached() {
    _locationsPromise ??= fetchLocationsAU().catch(() => []);
    return _locationsPromise;
}

function useDebouncedValue<T>(value: T, ms: number) {
    const [v, setV] = useState(value);
    useEffect(() => {
        const t = window.setTimeout(() => setV(value), ms);
        return () => window.clearTimeout(t);
    }, [value, ms]);
    return v;
}

function norm(s: string) {
    return s.trim().toLowerCase();
}

export function LocationTypeaheadAU(props: {
    value: string; // canonical selected label
    onChange: (value: string) => void;

    disabled?: boolean;
    placeholder?: string;

    minChars?: number; // default 2
    limit?: number; // default 20
    debounceMs?: number; // default 200 (slightly less aggressive than 150ms)
}) {
    const { value, onChange, disabled, placeholder = "Start typing your area…", minChars = 2, limit = 20, debounceMs = 200 } = props;

    const [all, setAll] = useState<AuLocation[]>([]);
    const [open, setOpen] = useState(false);

    // query is what user types; we only write to form value on selection
    const [query, setQuery] = useState(value);
    const debounced = useDebouncedValue(query, debounceMs);

    const [activeIndex, setActiveIndex] = useState<number>(-1);

    const rootRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => setQuery(value), [value]);

    useEffect(() => {
        let cancelled = false;
        getLocationsCached().then((items) => {
            if (!cancelled) setAll(items);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        function onDocMouseDown(e: MouseEvent) {
            if (!rootRef.current) return;
            if (rootRef.current.contains(e.target as Node)) return;
            setOpen(false);
            setActiveIndex(-1);
        }
        document.addEventListener("mousedown", onDocMouseDown);
        return () => document.removeEventListener("mousedown", onDocMouseDown);
    }, []);

    const results = useMemo(() => {
        const q = norm(debounced);
        if (q.length < minChars) return [];

        const scored: Array<{ item: AuLocation; prefix: boolean; pop: number }> = [];
        for (const it of all) {
            const loc = norm(it.lga);
            const label = norm(it.label);
            if (!(loc.includes(q) || label.includes(q))) continue;
            const prefix = loc.startsWith(q) || label.startsWith(q);
            const pop = typeof it.population === "number" && Number.isFinite(it.population) ? it.population : -1;
            scored.push({ item: it, prefix, pop });
        }

        scored.sort((a, b) => {
            // Primary: most likely first → higher population.
            if (a.pop !== b.pop) return b.pop - a.pop;
            // Tie-break: prefix matches first, then alphabetical.
            if (a.prefix !== b.prefix) return a.prefix ? -1 : 1;
            return a.item.label.localeCompare(b.item.label, "en");
        });

        return scored.slice(0, limit).map((x) => x.item);
    }, [all, debounced, limit, minChars]);

    useEffect(() => {
        if (!open) {
            setActiveIndex(-1);
            return;
        }
        if (results.length === 0) {
            setActiveIndex(-1);
            return;
        }
        setActiveIndex((i) => {
            if (i < 0) return -1;
            return Math.min(i, results.length - 1);
        });
    }, [results, open]);

    const qn = norm(debounced);

    function commitSelection(it: AuLocation) {
        setOpen(false);
        setActiveIndex(-1);
        setQuery(it.label);
        onChange(it.label);
        window.requestAnimationFrame(() => inputRef.current?.focus());
    }

    return (
        <div ref={rootRef} className="relative">
            <input
                ref={inputRef}
                value={query}
                disabled={disabled}
                placeholder={placeholder}
                onFocus={() => setOpen(true)}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setOpen(true);
                    setActiveIndex(-1);
                }}
                onKeyDown={(e) => {
                    if (!open) return;

                    if (e.key === "Escape") {
                        e.preventDefault();
                        setOpen(false);
                        setActiveIndex(-1);
                        return;
                    }

                    if (qn.length < minChars || results.length === 0) return;

                    if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setActiveIndex((i) => (i < results.length - 1 ? i + 1 : 0));
                        return;
                    }
                    if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setActiveIndex((i) => (i > 0 ? i - 1 : results.length - 1));
                        return;
                    }
                    if (e.key === "Enter") {
                        // Select highlighted option, else select the first result.
                        // (No more aggressive behavior beyond this.)
                        e.preventDefault();
                        const idx = activeIndex >= 0 ? activeIndex : 0;
                        const it = results[idx];
                        if (it) commitSelection(it);
                        return;
                    }
                }}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
                role="combobox"
                aria-expanded={open}
                aria-autocomplete="list"
                aria-controls="location-typeahead-list"
                aria-activedescendant={activeIndex >= 0 ? `location-opt-${results[activeIndex]?.id ?? activeIndex}` : undefined}
            />

            {open && qn.length >= minChars && results.length > 0 && (
                <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                    <ul id="location-typeahead-list" role="listbox" className="max-h-72 overflow-auto py-1">
                        {results.map((it, idx) => {
                            const active = idx === activeIndex;
                            return (
                                <li key={it.id} id={`location-opt-${it.id}`} role="option" aria-selected={active}>
                                    <button
                                        type="button"
                                        className={["w-full px-3 py-2 text-left text-sm", active ? "bg-slate-100" : "hover:bg-slate-50"].join(" ")}
                                        onMouseEnter={() => setActiveIndex(idx)}
                                        onMouseDown={(e) => {
                                            // Prevent input blur before click.
                                            e.preventDefault();
                                        }}
                                        onClick={() => commitSelection(it)}
                                    >
                                        <div className="font-semibold text-slate-900">{it.label}</div>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {open && qn.length >= minChars && results.length === 0 && (
                <div className="absolute z-20 mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-lg">
                    No match - search wider or use the state.
                </div>
            )}
        </div>
    );
}

