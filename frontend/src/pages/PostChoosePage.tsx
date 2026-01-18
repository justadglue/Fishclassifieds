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
    return qs ? `/post/sale?${qs}` : "/post/sale";
  })();

  const wantedHref = (() => {
    const qp = new URLSearchParams();
    if (next) qp.set("next", next);
    const qs = qp.toString();
    return qs ? `/post/wanted?${qs}` : "/post/wanted";
  })();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Header maxWidth="6xl" />
      <main className="mx-auto grid w-full max-w-4xl flex-1 grid-rows-[1fr_auto_1fr] px-4 py-10">
        {/* Heading sits above, but the *buttons* are what get vertically centered */}
        <div className="flex items-end justify-center pb-6">
          <h1 className="text-center text-2xl font-extrabold tracking-tight text-slate-900">What would you like to post?</h1>
        </div>

        <div className="grid w-full gap-4 self-center sm:grid-cols-2">
          <Link
            to={saleHref}
            className="group flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <div className="text-sm font-bold text-slate-500">For sale</div>
            <div className="mt-2 text-xl font-extrabold text-slate-900">Post a sale listing →</div>
            <div className="mt-2 text-sm font-semibold text-slate-600">
              Post livestock, plants, equipment, or services for buyers to discover.
            </div>
          </Link>

          <Link
            to={wantedHref}
            className="group flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <div className="text-sm font-bold text-slate-500">Wanted</div>
            <div className="mt-2 text-xl font-extrabold text-slate-900">Post a wanted listing →</div>
            <div className="mt-2 text-sm font-semibold text-slate-600">
              Tell sellers what you’re looking to buy.
            </div>
          </Link>
        </div>
        <div />
      </main>
    </div>
  );
}

