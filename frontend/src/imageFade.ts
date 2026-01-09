const FADE_CLASS = "img-fade";
const LOADED_CLASS = "img-fade--loaded";

function shouldSkip(img: HTMLImageElement) {
  // Opt-out for edge cases (logos, icons, deliberate custom transitions, etc.)
  return img.hasAttribute("data-no-fade");
}

function applyToImage(img: HTMLImageElement) {
  if (shouldSkip(img)) return;

  // If already processed, do nothing.
  if (img.classList.contains(FADE_CLASS)) return;

  // If already loaded (cache), mark loaded immediately so it never "blinks" invisible.
  if (img.complete) {
    img.classList.add(FADE_CLASS, LOADED_CLASS);
    return;
  }

  // Otherwise, start hidden and wait for load/error.
  img.classList.add(FADE_CLASS);
}

function markLoaded(img: HTMLImageElement) {
  if (shouldSkip(img)) return;
  img.classList.add(FADE_CLASS, LOADED_CLASS);
}

export function initImageFadeIn() {
  const w = window as any;
  if (w.__fishclassifiedsImageFadeInInit) return;
  w.__fishclassifiedsImageFadeInInit = true;

  // Apply to existing images immediately.
  document.querySelectorAll("img").forEach((img) => applyToImage(img as HTMLImageElement));

  // Capture image load events (load doesn't bubble, but it can be captured).
  document.addEventListener(
    "load",
    (e) => {
      const t = e.target;
      if (t instanceof HTMLImageElement) markLoaded(t);
    },
    true
  );

  // Don't leave broken images invisible: show the broken-image indicator.
  document.addEventListener(
    "error",
    (e) => {
      const t = e.target;
      if (t instanceof HTMLImageElement) markLoaded(t);
    },
    true
  );

  // Apply to images added later (React renders, route changes, lists, etc.).
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of Array.from(m.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (node.tagName === "IMG") applyToImage(node as HTMLImageElement);
        node.querySelectorAll?.("img")?.forEach((img) => applyToImage(img as HTMLImageElement));
      }
    }
  });
  mo.observe(document.documentElement, { subtree: true, childList: true });
}
