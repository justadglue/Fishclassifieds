import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const STORAGE_KEY = "fc_scroll_by_key_v1";

function readMap(): Record<string, number> {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") return {};
        return obj as Record<string, number>;
    } catch {
        return {};
    }
}

function writeMap(next: Record<string, number>) {
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // ignore
    }
}

function saveScroll(key: string, y: number) {
    const map = readMap();
    map[String(key)] = Math.max(0, Math.floor(Number(y) || 0));
    writeMap(map);
}

function restoreScroll(key: string): number | null {
    const map = readMap();
    const v = map[String(key)];
    return Number.isFinite(Number(v)) ? Number(v) : null;
}

export function ScrollRestorationManager() {
    const loc = useLocation();
    const navType = useNavigationType();
    const urlKey = `${loc.pathname}${loc.search ?? ""}`;
    const prevLocRef = useRef<{ pathname: string; search: string } | null>(null);

    // Continuously save scroll position for the current route key.
    // This is more reliable than only saving on effect cleanup (which can run after layout changes).
    useEffect(() => {
        // Seed from stored scroll so StrictMode mount/cleanup doesn't clobber real values with 0.
        const seeded = restoreScroll(loc.key) ?? restoreScroll(urlKey);
        let lastY = seeded ?? window.scrollY;
        let raf = 0;
        const onScroll = () => {
            if (raf) return;
            raf = window.requestAnimationFrame(() => {
                raf = 0;
                const y = window.scrollY;
                lastY = y;
                saveScroll(loc.key, y);
                saveScroll(urlKey, y);
            });
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            window.removeEventListener("scroll", onScroll);
            if (raf) window.cancelAnimationFrame(raf);
            // Final flush
            // IMPORTANT: don't overwrite with y=0 after navigation has already scrolled to top.
            // Use the last observed scroll position from this route instead.
            const curByKey = restoreScroll(loc.key);
            const curByUrl = restoreScroll(urlKey);
            const y = Math.max(curByKey ?? 0, curByUrl ?? 0, lastY ?? 0);
            saveScroll(loc.key, y);
            saveScroll(urlKey, y);
        };
    }, [loc.key, urlKey]);

    // Restore scroll position on POP (back/forward). Otherwise, scroll to top (or hash).
    useLayoutEffect(() => {
        const prevLoc = prevLocRef.current;
        prevLocRef.current = { pathname: loc.pathname, search: loc.search ?? "" };
        const hash = String(loc.hash ?? "");
        const yByKey = restoreScroll(loc.key);
        const yByUrl = restoreScroll(urlKey);
        const y = yByKey ?? yByUrl;
        if (hash) {
            const id = hash.replace(/^#/, "");
            window.requestAnimationFrame(() => {
                const el = document.getElementById(id);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                else window.scrollTo({ top: 0, left: 0, behavior: "auto" });
            });
            return;
        }

        if (navType === "POP") {
            const chosen = y ?? 0;
            const de = document.documentElement;
            const getMaxScroll = () => Math.max(0, (de?.scrollHeight ?? 0) - (de?.clientHeight ?? 0));
            const maxNow = getMaxScroll();

            // If we can already scroll to the desired position, do it immediately (no flicker).
            if (maxNow >= chosen) {
                window.scrollTo({ top: chosen, left: 0, behavior: "auto" });
                return;
            }

            // Otherwise: the page isn't tall enough yet. Avoid "jump" by hiding until it can scroll to `chosen`.
            const prevVis = document.documentElement.style.visibility;
            document.documentElement.style.visibility = "hidden";

            // Use a bounded rAF loop so we never get stuck hidden.
            let rafId = 0;
            let done = false;
            let lastMax = -1;
            let stable = 0;
            let frames = 0;
            const MAX_FRAMES = 120; // ~2s at 60fps
            const STABLE_FRAMES = 6;

            const reveal = () => {
                document.documentElement.style.visibility = prevVis;
            };

            const finish = (reason: "exact" | "stable" | "timeout", max: number) => {
                if (done) return;
                done = true;
                const target = reason === "exact" ? chosen : Math.min(chosen, max);
                window.scrollTo({ top: target, left: 0, behavior: "auto" });
                window.requestAnimationFrame(() => {
                    reveal();
                });
            };

            const tick = () => {
                if (done) return;
                frames += 1;
                const max = getMaxScroll();
                stable = max === lastMax ? stable + 1 : 0;
                lastMax = max;

                if (max >= chosen) return finish("exact", max);
                if (stable >= STABLE_FRAMES) return finish("stable", max);
                if (frames >= MAX_FRAMES) return finish("timeout", max);

                rafId = window.requestAnimationFrame(tick);
            };

            rafId = window.requestAnimationFrame(tick);
            return () => {
                if (rafId) window.cancelAnimationFrame(rafId);
                reveal();
            };
        }

        // For same-path REPLACE navigations (typically query-param updates from in-page controls),
        // keep the user's scroll position stable. This prevents "jump to top" when toggling filters/sort.
        if (prevLoc && prevLoc.pathname === loc.pathname && navType === "REPLACE") {
            return;
        }

        // For same-path navigations, avoid forcing scroll-to-top when this is "pagination only"
        // (only the `page` query param changed). Let the page decide the landing scroll.
        if (prevLoc && prevLoc.pathname === loc.pathname) {
            const prevSp = new URLSearchParams(prevLoc.search ?? "");
            const curSp = new URLSearchParams(loc.search ?? "");
            const keys = new Set<string>([...Array.from(prevSp.keys()), ...Array.from(curSp.keys())]);
            let onlyPageChanged = true;
            for (const k of keys) {
                if (k === "page") continue;
                const a = prevSp.get(k) ?? "";
                const b = curSp.get(k) ?? "";
                if (a !== b) {
                    onlyPageChanged = false;
                    break;
                }
            }
            if (onlyPageChanged) return;
        }

        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }, [loc.key, loc.hash, navType, urlKey, loc.pathname]);

    return null;
}

