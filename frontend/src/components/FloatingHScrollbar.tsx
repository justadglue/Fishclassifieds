import { useEffect, useMemo, useRef, useState } from "react";

function isCoarsePointer() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

export default function FloatingHScrollbar(props: {
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Recompute when table content/layout changes that may not trigger scroll/resize. */
  deps?: any[];
  /** Bottom offset in px. */
  bottomPx?: number;
}) {
  const { scrollRef, deps = [], bottomPx = 12 } = props;

  const stickyScrollRef = useRef<HTMLDivElement | null>(null);
  const [showStickyX, setShowStickyX] = useState(false);
  const [stickyGeom, setStickyGeom] = useState<{ left: number; width: number; scrollWidth: number } | null>(null);
  const recomputeRef = useRef<null | (() => void)>(null);

  const shouldDisable = useMemo(() => isCoarsePointer(), []);

  // Show the fixed scrollbar only when:
  // - the table overflows horizontally, and
  // - the table is on screen, but its own bottom scrollbar is NOT visible.
  useEffect(() => {
    if (shouldDisable) {
      setShowStickyX(false);
      setStickyGeom(null);
      return;
    }

    const mainEl = scrollRef.current;
    if (!mainEl) return;
    let raf = 0;

    function recompute() {
      const el = scrollRef.current;
      if (!el) {
        setShowStickyX(false);
        setStickyGeom(null);
        return;
      }
      const hasOverflow = el.scrollWidth > el.clientWidth + 1;
      if (!hasOverflow) {
        setShowStickyX(false);
        setStickyGeom(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      const isOnScreen = rect.bottom > 0 && rect.top < window.innerHeight;
      if (!isOnScreen) {
        setShowStickyX(false);
        setStickyGeom(null);
        return;
      }
      const bottomVisible = rect.bottom <= window.innerHeight - 8;
      const shouldShow = !bottomVisible;
      setShowStickyX(shouldShow);
      if (shouldShow) {
        setStickyGeom({ left: rect.left, width: rect.width, scrollWidth: el.scrollWidth });
      } else {
        setStickyGeom(null);
      }
    }

    function schedule() {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        recompute();
      });
    }

    recomputeRef.current = schedule;

    recompute();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    mainEl.addEventListener("scroll", schedule, { passive: true });

    return () => {
      window.removeEventListener("scroll", schedule as any);
      window.removeEventListener("resize", schedule as any);
      mainEl.removeEventListener("scroll", schedule as any);
      if (raf) window.cancelAnimationFrame(raf);
      if (recomputeRef.current === schedule) recomputeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef, shouldDisable]);

  // Nudge recompute when content/layout changes.
  useEffect(() => {
    recomputeRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Keep the floating horizontal scrollbar in sync with the actual table scroller.
  useEffect(() => {
    if (shouldDisable) return;
    const mainEl = scrollRef.current;
    const stickyEl = stickyScrollRef.current;
    if (!mainEl || !stickyEl) return;
    let syncing = false;

    function onMainScroll() {
      if (syncing) return;
      syncing = true;
      stickyEl!.scrollLeft = mainEl!.scrollLeft;
      syncing = false;
    }
    function onStickyScroll() {
      if (syncing) return;
      syncing = true;
      mainEl!.scrollLeft = stickyEl!.scrollLeft;
      syncing = false;
    }

    mainEl.addEventListener("scroll", onMainScroll, { passive: true });
    stickyEl.addEventListener("scroll", onStickyScroll, { passive: true });

    stickyEl.scrollLeft = mainEl.scrollLeft;

    return () => {
      mainEl.removeEventListener("scroll", onMainScroll as any);
      stickyEl.removeEventListener("scroll", onStickyScroll as any);
    };
  }, [scrollRef, shouldDisable, showStickyX]);

  return (
    <div
      className="fixed z-50"
      style={{
        bottom: `${bottomPx}px`,
        left: stickyGeom ? `${stickyGeom.left}px` : "0px",
        width: stickyGeom ? `${stickyGeom.width}px` : "0px",
        opacity: showStickyX ? 1 : 0,
        pointerEvents: showStickyX ? "auto" : "none",
      }}
    >
      <div className="rounded-xl border border-slate-200 bg-white/85 px-2 py-1 shadow-sm backdrop-blur">
        <div ref={stickyScrollRef} className="overflow-x-auto overflow-y-hidden" style={{ height: 16 }}>
          <div style={{ width: stickyGeom?.scrollWidth ?? 0, height: 1 }} />
        </div>
      </div>
    </div>
  );
}

