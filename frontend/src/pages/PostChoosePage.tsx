import { Link, useLocation } from "react-router-dom";
import Header from "../components/Header";
import { useAuth } from "../auth";
import { fetchMyListings, fetchMyWanted } from "../api";
import { useEffect, useState } from "react";

export default function PostChoosePage() {
  const loc = useLocation();
  const sp = new URLSearchParams(loc.search);
  const next = sp.get("next");
  const { user, loading: authLoading } = useAuth();
  const [hasDrafts, setHasDrafts] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (authLoading) return;
      if (!user) {
        setHasDrafts(false);
        return;
      }
      try {
        const [saleRes, wantedRes] = await Promise.all([fetchMyListings({ limit: 200, offset: 0 }), fetchMyWanted({ limit: 200, offset: 0 })]);
        if (cancelled) return;
        const anySaleDraft = (saleRes.items ?? []).some((l) => l.status === "draft");
        const anyWantedDraft = (wantedRes.items ?? []).some((w) => w.status === "draft");
        setHasDrafts(anySaleDraft || anyWantedDraft);
      } catch {
        if (!cancelled) setHasDrafts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

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
              Post live fish, plants, equipment, or services for buyers to discover.
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

          {hasDrafts ? (
            <Link
              to="/drafts"
              className="group flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:col-span-2"
            >
              <div className="text-sm font-bold text-slate-500">Drafts</div>
              <div className="mt-2 text-xl font-extrabold text-slate-900">Resume from drafts →</div>
              <div className="mt-2 text-sm font-semibold text-slate-600">Continue working on saved drafts and post when ready.</div>
            </Link>
          ) : null}
        </div>
        <div />
      </main>
    </div>
  );
}

