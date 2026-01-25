import { useEffect, useMemo, useRef, useState } from "react";

function isCoarsePointer() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

function isNarrowViewport(px: number) {
  if (typeof window === "undefined") return false;
  return window.innerWidth < px;
}

export default function FloatingHScrollbar(props: {
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Recompute when table content/layout changes that may not trigger scroll/resize. */
  deps?: any[];
  /** Bottom offset in px. */
  bottomPx?: number;
  /**
   * On narrow viewports, show the floating scrollbar whenever the scroller overflows horizontally,
   * even if the scroller's own bottom scrollbar is currently visible.
   */
  showWhenOverflowOnNarrow?: boolean;
  /** Narrow breakpoint for `showWhenOverflowOnNarrow` */
  narrowWidthPx?: number;
}) {
  const { scrollRef, deps = [], bottomPx = 12, showWhenOverflowOnNarrow = true, narrowWidthPx = 980 } = props;

  const stickyScrollRef = useRef<HTMLDivElement | null>(null);
  const [showStickyX, setShowStickyX] = useState(false);
  const [stickyGeom, setStickyGeom] = useState<{ left: number; width: number; scrollWidth: number } | null>(null);
  const recomputeRef = useRef<null | (() => void)>(null);

  const coarsePointer = useMemo(() => isCoarsePointer(), []);
  // Previously we disabled on coarse pointers to avoid fighting with overlay scrollbars on touch.
  // But when `showWhenOverflowOnNarrow` is enabled (default), we must NOT disable, otherwise the bar never appears
  // in small-screen / devtools mobile modes where (pointer: coarse) may match.
  const shouldDisable = coarsePointer && !showWhenOverflowOnNarrow;

  // Show the fixed scrollbar only when:
  // - the table overflows horizontally, and
  // - the table is on screen, but its own bottom scrollbar is NOT visible.
  useEffect(() => {
    if (shouldDisable) {
      setShowStickyX(false);
      setStickyGeom(null);
      return;
    }

    let raf = 0;
    let initRaf = 0;
    let attachedEl: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;

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
      const narrow = showWhenOverflowOnNarrow && isNarrowViewport(narrowWidthPx);
      const shouldShow = narrow ? true : !bottomVisible;
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

    function initWhenReady() {
      const mainEl = scrollRef.current;
      if (!mainEl) {
        initRaf = window.requestAnimationFrame(initWhenReady);
        return;
      }
      attachedEl = mainEl;

      recompute();
      window.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule, { passive: true });
      attachedEl.addEventListener("scroll", schedule, { passive: true });

      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => schedule());
        ro.observe(attachedEl);
      }
    }

    initWhenReady();

    return () => {
      if (initRaf) window.cancelAnimationFrame(initRaf);
      window.removeEventListener("scroll", schedule as any);
      window.removeEventListener("resize", schedule as any);
      if (attachedEl) attachedEl.removeEventListener("scroll", schedule as any);
      if (ro) ro.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
      if (recomputeRef.current === schedule) recomputeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef, shouldDisable, showWhenOverflowOnNarrow, narrowWidthPx]);

  // Nudge recompute when content/layout changes.
  useEffect(() => {
    recomputeRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Keep the floating horizontal scrollbar in sync with the actual table scroller.
  useEffect(() => {
    if (shouldDisable) return;
    let initRaf = 0;
    let attachedMain: HTMLElement | null = null;
    let attachedSticky: HTMLDivElement | null = null;
    let syncing = false;

    function onMainScroll() {
      if (syncing) return;
      syncing = true;
      attachedSticky!.scrollLeft = attachedMain!.scrollLeft;
      syncing = false;
    }
    function onStickyScroll() {
      if (syncing) return;
      syncing = true;
      attachedMain!.scrollLeft = attachedSticky!.scrollLeft;
      syncing = false;
    }

    function initWhenReady() {
      const mainEl = scrollRef.current;
      const stickyEl = stickyScrollRef.current;
      if (!mainEl || !stickyEl) {
        initRaf = window.requestAnimationFrame(initWhenReady);
        return;
      }
      attachedMain = mainEl;
      attachedSticky = stickyEl;

      attachedMain.addEventListener("scroll", onMainScroll, { passive: true });
      attachedSticky.addEventListener("scroll", onStickyScroll, { passive: true });
      attachedSticky.scrollLeft = attachedMain.scrollLeft;
    }

    initWhenReady();

    return () => {
      if (initRaf) window.cancelAnimationFrame(initRaf);
      if (attachedMain) attachedMain.removeEventListener("scroll", onMainScroll as any);
      if (attachedSticky) attachedSticky.removeEventListener("scroll", onStickyScroll as any);
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

