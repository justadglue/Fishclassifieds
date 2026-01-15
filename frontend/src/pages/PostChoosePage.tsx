import { Link, useLocation } from "react-router-dom";
import Header from "../components/Header";

export default function PostChoosePage() {
  const loc = useLocation();
  const sp = new URLSearchParams(loc.search);
  const next = sp.get("next");

  const saleHref = (() => {
    const qp = new URLSearchParams();
    if (next) qp.set("next", next);
    const qs = qp.toString();
    return qs ? `/post/listing?${qs}` : "/post/listing";
  })();

  const wantedHref = (() => {
    const qp = new URLSearchParams();
    if (next) qp.set("next", next);
    const qs = qp.toString();
    return qs ? `/post/wanted?${qs}` : "/post/wanted";
  })();

  return (
    <div className="min-h-full bg-slate-50">
      <Header maxWidth="6xl" />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">What would you like to post?</h1>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            Choose whether you’re selling something, or posting a wanted ad.
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Link
            to={saleHref}
            className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <div className="text-sm font-bold text-slate-500">For sale</div>
            <div className="mt-2 text-xl font-extrabold text-slate-900">Sell a listing →</div>
            <div className="mt-2 text-sm font-semibold text-slate-600">
              Post livestock, plants, equipment, or services for buyers to discover.
            </div>
          </Link>

          <Link
            to={wantedHref}
            className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <div className="text-sm font-bold text-slate-500">Wanted</div>
            <div className="mt-2 text-xl font-extrabold text-slate-900">Post a wanted listing →</div>
            <div className="mt-2 text-sm font-semibold text-slate-600">
              Tell sellers what you’re looking to buy.
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}

