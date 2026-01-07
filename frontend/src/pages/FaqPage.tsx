import { Link } from "react-router-dom";
import Header from "../components/Header";

export default function FaqPage() {
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

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm font-extrabold">How do I browse listings?</div>
            <div className="mt-2 text-sm font-semibold text-white/75">
              Use <Link className="text-white underline hover:text-white/90" to="/browse">Browse</Link> to search and filter listings.
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

