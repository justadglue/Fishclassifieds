import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Header from "../components/Header";

export default function FaqPage() {
  const { hash } = useLocation();
  const [highlightShipping, setHighlightShipping] = useState(false);

  useEffect(() => {
    if (hash !== "#fish-shipping") return;
    setHighlightShipping(true);
    const t = window.setTimeout(() => setHighlightShipping(false), 1000);
    return () => window.clearTimeout(t);
  }, [hash]);

  return (
    <div className="min-h-full bg-slate-950 text-white">
      <Header maxWidth="6xl" />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <div className="text-xs font-bold uppercase tracking-wider text-white/60">Support</div>
        <h1 className="mt-2 text-3xl font-black tracking-tight">FAQ</h1>
        <p className="mt-3 text-sm font-semibold text-white/75">
          Quick answers about how Fishclassifieds works. (We can expand this any time.)
        </p>

        <div className="mt-8 space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm font-extrabold">How do I post a listing?</div>
            <div className="mt-2 text-sm font-semibold text-white/75">
              Go to <Link className="text-white underline hover:text-white/90" to="/post">Post a listing</Link> and fill out the form.
            </div>
          </div>

          <div
            id="fish-shipping"
            className={[
              "scroll-mt-24 relative rounded-2xl border bg-white/5 p-5 transition-colors duration-1000",
              // Fade the glow (ring) with opacity so it matches the border fade timing.
              "after:pointer-events-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] after:ring-2 after:ring-amber-200/20 after:opacity-0 after:transition-opacity after:duration-1000",
              highlightShipping ? "border-amber-200/40 bg-amber-200/10 after:opacity-100" : "border-white/10",
            ].join(" ")}
          >
            <div className="text-sm font-extrabold">How do I ship fish safely?</div>
            <div className="mt-2 space-y-2 text-sm font-semibold text-white/75">
              <div>
                Shipping live fish requires correct packing and planning. This is a placeholder section for now — we can expand it later.
              </div>
              <ul className="list-disc space-y-1 pl-5">
                <li>Use proper fish bags, insulation, and heat/cold packs as needed.</li>
                <li>Pack to avoid leaks, temperature swings, and excessive sloshing.</li>
                <li>Check weather and carrier rules before shipping.</li>
              </ul>
              <div className="text-white/60">
                Tip: If you’re not confident you can ship correctly, leave “Willing to ship” unchecked.
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm font-extrabold">How do I browse listings?</div>
            <div className="mt-2 text-sm font-semibold text-white/75">
              Use <Link className="text-white underline hover:text-white/90" to="/browse?type=sale">Browse</Link> to search and filter listings.
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm font-extrabold">How do featured listings work?</div>
            <div className="mt-2 text-sm font-semibold text-white/75">
              Featured listings are promoted placements that appear on the homepage and in featured areas.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

