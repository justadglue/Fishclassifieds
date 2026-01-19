import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MapPin } from "lucide-react";
import Header from "../components/Header";
import { clearListingFeaturing, clearWantedFeaturing, fetchListing, fetchWantedPost, setListingFeaturingForDays, setListingFeaturingUntilMs, setWantedFeaturingForDays, setWantedFeaturingUntilMs, type Listing, type WantedPost } from "../api";
import { useAuth } from "../auth";

export default function FeatureListingPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [item, setItem] = useState<{ kind: "sale"; item: Listing } | { kind: "wanted"; item: WantedPost } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Placeholder selection for the "featuring pipeline".
  const [plan, setPlan] = useState<"7d" | "30d" | "15h" | "10h_ago">("7d");

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      nav(`/auth?next=${encodeURIComponent(`/feature/${id ?? ""}`)}&ctx=feature_listing`);
      return;
    }

    let cancelled = false;
    async function run() {
      if (!id) return;
      setErr(null);
      setLoading(true);
      try {
        try {
          const l = await fetchListing(id);
          if (!cancelled) setItem({ kind: "sale", item: l });
        } catch {
          const w = await fetchWantedPost(id);
          if (!cancelled) setItem({ kind: "wanted", item: w });
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load listing");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, id, nav]);

  const canBeFeatured = useMemo(() => {
    if (!item) return false;
    if (item.kind === "sale") return item.item.status === "active" && item.item.resolution === "none";
    return item.item.lifecycleStatus === "active" && item.item.status === "open";
  }, [item]);

  const featuringState = useMemo<"none" | "active" | "expired">(() => {
    if (!item) return "none";
    const until = item.item.featuredUntil ?? null;
    if (until !== null) return until > Date.now() ? "active" : "expired";
    return item.item.featured ? "active" : "none";
  }, [item]);

  async function onConfirm(featured: boolean) {
    if (!id) return;
    setErr(null);
    setBusy(true);
    try {
      if (featured) {
        if (!item) return;
        const setForDays = item.kind === "sale" ? setListingFeaturingForDays : setWantedFeaturingForDays;
        const setUntil = item.kind === "sale" ? setListingFeaturingUntilMs : setWantedFeaturingUntilMs;
        if (plan === "7d") await setForDays(id, 7);
        else if (plan === "30d") await setForDays(id, 30);
        else if (plan === "15h") await setUntil(id, Date.now() + 15 * 60 * 60 * 1000);
        else await setUntil(id, Date.now() - 10 * 60 * 60 * 1000); // expired dev option
      } else {
        if (!item) return;
        if (item.kind === "sale") await clearListingFeaturing(id);
        else await clearWantedFeaturing(id);
      }
      nav("/me");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update featured status");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full">
      <Header maxWidth="5xl" />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Link to="/me" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
          ← Back to My listings
        </Link>

        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">Feature listing</h1>
            <div className="mt-1 text-sm text-slate-600">
              Placeholder checkout flow. This page will become the “featuring pipeline”.
            </div>
          </div>
        </div>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}
        {loading && <div className="mt-4 text-sm text-slate-600">Loading…</div>}

        {item && (
          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_360px]">
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Listing</div>
              <div className="mt-2 text-lg font-extrabold text-slate-900">{item.item.title}</div>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                <span className="inline-flex items-center gap-1">
                  <MapPin aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">
                    {item.item.location}
                    {item.kind === "sale" ? ` • ${item.item.shippingOffered ? "Shipping offered" : "Local only"}` : ""}
                  </span>
                </span>
              </div>

              {featuringState === "active" ? (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
                  This listing is currently featured.
                </div>
              ) : featuringState === "expired" ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
                  Featuring for this listing has expired.
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  Featuring increases visibility by placing your listing in the homepage carousel.
                </div>
              )}
            </section>

            <aside className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-extrabold text-slate-900">Featuring options</div>

              <div className="mt-3 space-y-2">
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
                  <input type="radio" name="plan" checked={plan === "7d"} onChange={() => setPlan("7d")} />
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900">7 days</div>
                    <div className="text-xs font-semibold text-slate-600">Best for quick sales</div>
                  </div>
                </label>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
                  <input type="radio" name="plan" checked={plan === "30d"} onChange={() => setPlan("30d")} />
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900">30 days</div>
                    <div className="text-xs font-semibold text-slate-600">Best value</div>
                  </div>
                </label>

                <div className="pt-2 text-xs font-bold uppercase tracking-wider text-slate-400">Dev</div>

                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
                  <input type="radio" name="plan" checked={plan === "15h"} onChange={() => setPlan("15h")} />
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900">15 hours</div>
                    <div className="text-xs font-semibold text-slate-600">Temporary test: “running out” state</div>
                  </div>
                </label>

                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
                  <input type="radio" name="plan" checked={plan === "10h_ago"} onChange={() => setPlan("10h_ago")} />
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900">Expired (10 hours ago)</div>
                    <div className="text-xs font-semibold text-slate-600">Temporary test: expired state</div>
                  </div>
                </label>
              </div>

              {!canBeFeatured && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                  Only active, unsold listings can be featured.
                </div>
              )}

              <div className="mt-4 space-y-2">
                {featuringState !== "active" ? (
                  <button
                    type="button"
                    disabled={!canBeFeatured || busy}
                    onClick={() => onConfirm(true)}
                    className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {busy
                      ? "Processing…"
                      : `Confirm featuring (${
                          plan === "7d"
                            ? "7 days"
                            : plan === "30d"
                              ? "30 days"
                              : plan === "15h"
                                ? "15 hours"
                                : "expired (10 hours ago)"
                        })`}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onConfirm(false)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {busy ? "Updating…" : "Remove featured status"}
                  </button>
                )}
              </div>

              <div className="mt-3 text-xs font-semibold text-slate-500">
                Payments/placement rules are placeholders for now; this pipeline is wired and ready to expand.
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

