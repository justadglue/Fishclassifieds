// frontend/src/pages/ListingPage.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Flag } from "lucide-react";
import { createReport, fetchListing, fetchWantedPost, getListingOptionsCached, resolveAssets, type Listing, type WantedPost } from "../api";
import Header from "../components/Header";
import NoPhotoPlaceholder from "../components/NoPhotoPlaceholder";
import { decodeSaleDetailsFromDescription, decodeWantedDetailsFromDescription } from "../utils/listingDetailsBlock";
import ShippingInfoButton from "../components/ShippingInfoButton";
import { browsePath, parseListingKind, type ListingKind } from "../utils/listingRoutes";
import { useAuth } from "../auth";

function centsToDollars(cents: number) {
  const s = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${s}`;
}

function timeAgo(iso: string) {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "";
  let diffMs = Date.now() - t;
  if (!Number.isFinite(diffMs) || diffMs < 0) diffMs = 0;

  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;

  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;

  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk} week${wk === 1 ? "" : "s"} ago`;

  const mo = Math.floor(day / 30);
  return `${Math.max(1, mo)} month${mo === 1 ? "" : "s"} ago`;
}

function budgetLabel(w: WantedPost) {
  const budget = w.budgetCents ?? null;
  if (budget == null) return "Make an offer";
  return `Up to ${centsToDollars(budget)}`;
}

type DetailItem = { kind: "sale"; item: Listing } | { kind: "wanted"; item: WantedPost };

export default function ListingPage() {
  const { id, kind: kindParam } = useParams();
  const location = useLocation();
  const kind: ListingKind = parseListingKind(kindParam);
  const [data, setData] = useState<DetailItem | null>(null);
  const item = data?.item ?? null;
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [phoneRevealed, setPhoneRevealed] = useState(false);
  const { user } = useAuth();

  // Report modal
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("Scam / suspicious");
  const [reportDetails, setReportDetails] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportErr, setReportErr] = useState<string | null>(null);
  const [reportOk, setReportOk] = useState(false);

  // Lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const [bioRequiredCategories, setBioRequiredCategories] = useState<Set<string>>(new Set());
  const [otherCategoryName, setOtherCategoryName] = useState("Other");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!id) return;
      setLoading(true);
      setErr(null);
      try {
        const viewContext = new URLSearchParams(location.search).get("viewContext");
        const viewCtx = viewContext === "admin" ? ("admin" as const) : undefined;
        if (kind === "wanted") {
          const w = await fetchWantedPost(id, viewCtx ? { viewContext: viewCtx } : undefined);
          if (!cancelled) setData({ kind: "wanted", item: w });
        } else {
          const l = await fetchListing(id, viewCtx ? { viewContext: viewCtx } : undefined);
          if (!cancelled) setData({ kind: "sale", item: l });
        }
        if (!cancelled) {
          setActive(0);
          setLightboxOpen(false);
          setPhoneRevealed(false);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? (kind === "wanted" ? "Failed to load wanted post" : "Failed to load listing"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id, kind, location.search]);

  useEffect(() => {
    let cancelled = false;
    getListingOptionsCached()
      .then((opts) => {
        if (cancelled) return;
        setBioRequiredCategories(new Set(((opts as any).bioFieldsRequiredCategories as string[]) ?? []));
        setOtherCategoryName(String((opts as any).otherCategory ?? "Other"));
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const assets = useMemo(() => {
    if (!item) return [];
    return resolveAssets((item as any).images ?? []);
  }, [item]);

  const decoded = useMemo(() => {
    if (!item || kind !== "sale") return null;
    return decodeSaleDetailsFromDescription((item as Listing).description);
  }, [item, kind]);

  const wantedDecoded = useMemo(() => {
    if (!item || kind !== "wanted") return null;
    return decodeWantedDetailsFromDescription((item as WantedPost).description);
  }, [item, kind]);

  const bodyDescription = useMemo(() => {
    if (!item) return "";
    if (kind === "sale") {
      const d = decoded;
      const raw = (item as Listing).description ?? "";
      return d?.body ?? raw;
    }
    const d = wantedDecoded;
    const raw = (item as WantedPost).description ?? "";
    return d?.body ?? String(raw);
  }, [decoded, wantedDecoded, item, kind]);

  const details = decoded?.details ?? { quantity: 1, priceType: "each" as const, customPriceText: "", willingToShip: false };
  const isSpecialSalePrice = details.priceType === "free" || details.priceType === "offer";
  const salePriceLabel =
    kind === "sale" && item
      ? details.priceType === "free"
        ? "Free"
        : details.priceType === "offer"
          ? "Make an Offer"
          : centsToDollars((item as Listing).priceCents)
      : "";
  const priceSuffix =
    details.priceType === "each"
      ? "each"
      : details.priceType === "all"
        ? "for all"
        : details.customPriceText
          ? `(${details.customPriceText})`
          : "(custom)";
  const priceTypeLabel = isSpecialSalePrice ? (details.priceType === "free" ? "Free" : "Make an Offer") : priceSuffix;

  const wantedDetails = wantedDecoded?.details ?? ({ priceType: "each", customPriceText: "" } as const);
  const wantedPriceSuffix =
    wantedDetails.priceType === "each"
      ? "each"
      : wantedDetails.priceType === "all"
        ? "for all"
        : wantedDetails.customPriceText
          ? `(${wantedDetails.customPriceText})`
          : "(custom)";

  const wantedHasBudget = kind === "wanted" ? (item as WantedPost | null)?.budgetCents != null : false;

  const qtyLabel = kind === "wanted" ? `Qty ${(item as any)?.quantity ?? 1} wanted` : `Qty ${details.quantity} available`;
  const postedIso = item?.publishedAt ?? item?.createdAt ?? null;
  const postedAgo = postedIso ? timeAgo(postedIso) : "";

  function DefaultAvatar() {
    return (
      <div className="grid h-[84px] w-[84px] place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-600">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M20 21a8 8 0 0 0-16 0" />
          <circle cx="12" cy="8" r="4" />
        </svg>
      </div>
    );
  }

  const hasMultiple = assets.length > 1;

  const hero =
    assets[active]?.medUrl ??
    assets[active]?.fullUrl ??
    assets[0]?.medUrl ??
    assets[0]?.fullUrl ??
    null;

  // Full-res for lightbox
  const fullRes =
    assets[active]?.fullUrl ??
    assets[0]?.fullUrl ??
    null;

  const prevImage = useCallback(() => {
    setActive((i) => (i <= 0 ? assets.length - 1 : i - 1));
  }, [assets.length]);

  const nextImage = useCallback(() => {
    setActive((i) => (i >= assets.length - 1 ? 0 : i + 1));
  }, [assets.length]);

  const openLightbox = useCallback(() => {
    if (!assets.length) return;
    setLightboxOpen(true);
  }, [assets.length]);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
  }, []);

  // Keyboard controls while lightbox is open
  useEffect(() => {
    if (!lightboxOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeLightbox();
        return;
      }
      if (!hasMultiple) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prevImage();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        nextImage();
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeLightbox, hasMultiple, lightboxOpen, nextImage, prevImage]);

  // Prevent background scroll while lightbox open
  useEffect(() => {
    if (!lightboxOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lightboxOpen]);

  useEffect(() => {
    if (!reportOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [reportOpen]);

  return (
    <div className="min-h-full">
      <Header maxWidth="7xl" />
      <main className="mx-auto max-w-7xl px-4 py-6">
        {(() => {
          const from = (location.state as any)?.from as
            | { pathname: string; search?: string; label?: string }
            | undefined;
          const label = (from?.label ?? "").trim() || (kind === "wanted" ? "wanted" : "listings");
          const to = from?.pathname ? `${from.pathname}${from.search ?? ""}` : browsePath(kind);
          return (
            <Link to={to} className="text-sm font-semibold text-slate-700 hover:text-slate-900">
              ← Back to {label}
            </Link>
          );
        })()}

        {loading && <div className="mt-4 text-sm text-slate-600">Loading…</div>}

        {err && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {err}
          </div>
        )}

        {item && (
          <>
            {reportOpen ? (
              <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true">
                <div className="w-full max-w-lg max-h-[85dvh] overflow-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-extrabold text-slate-900">Report listing</div>
                      <div className="mt-1 text-sm text-slate-600">
                        {user ? "Your report will be sent to admins for review." : "You need to sign in to submit a report."}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReportOpen(false)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      Close
                    </button>
                  </div>

                  {reportErr && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{reportErr}</div>}
                  {reportOk && (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                      Report submitted. Thank you.
                    </div>
                  )}

                  <div className="mt-4 grid gap-3">
                    <label className="block">
                      <div className="mb-1 text-xs font-semibold text-slate-700">Reason</div>
                      <select
                        value={reportReason}
                        onChange={(e) => setReportReason(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                      >
                        <option>Scam / suspicious</option>
                        <option>Prohibited item</option>
                        <option>Harassment</option>
                        <option>Spam</option>
                        <option>Other</option>
                      </select>
                    </label>

                    <label className="block">
                      <div className="mb-1 text-xs font-semibold text-slate-700">Details (optional)</div>
                      <textarea
                        value={reportDetails}
                        onChange={(e) => setReportDetails(e.target.value)}
                        rows={4}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                        placeholder="Add any relevant details…"
                      />
                    </label>

                    <button
                      type="button"
                      disabled={!user || reportLoading || reportOk}
                      onClick={async () => {
                        if (!id) return;
                        if (!user) {
                          setReportErr("Please sign in to submit a report.");
                          return;
                        }
                        if (reportLoading) return;
                        setReportLoading(true);
                        setReportErr(null);
                        try {
                          await createReport({
                            targetKind: kind === "wanted" ? "wanted" : "sale",
                            targetId: id,
                            reason: reportReason,
                            details: reportDetails.trim() ? reportDetails.trim() : null,
                          });
                          setReportOk(true);
                        } catch (e: any) {
                          setReportErr(e?.message ?? "Failed to submit report");
                        } finally {
                          setReportLoading(false);
                        }
                      }}
                      className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-extrabold text-red-800 hover:bg-red-100 disabled:opacity-60"
                    >
                      {reportLoading ? "Submitting…" : reportOk ? "Submitted" : "Submit report"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_360px]">
              {/* Left column: gallery + description */}
              <div className="space-y-5">
                <div>
                  <h1 className="text-2xl font-extrabold text-slate-900">{item.title}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
                    <div>
                      Posted {postedAgo ? `${postedAgo} • ` : ""}
                      {new Date(postedIso ?? item.createdAt).toLocaleString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setReportErr(null);
                        setReportOk(false);
                        setReportOpen(true);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition hover:text-red-400"
                      title="Report this ad"
                    >
                      <Flag aria-hidden="true" className="h-3.5 w-3.5" />
                      <span>Report this listing</span>
                    </button>
                  </div>
                </div>

                {assets.length > 0 ? (
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="bg-slate-100">
                      {/* Image box */}
                      <div className="relative aspect-4/3 w-full bg-slate-100">
                        {hero ? <img src={hero} alt={item.title} className="h-full w-full object-cover" /> : null}

                        {/* Maximize button (top-right) */}
                        {hero && (
                          <button
                            type="button"
                            onClick={openLightbox}
                            aria-label="Maximize image"
                            className="
                          absolute right-3 top-3
                          rounded-full border border-white/30
                          bg-slate-900/15 backdrop-blur
                          px-3 py-2
                          text-white
                          shadow-sm
                          transition
                          hover:bg-slate-900/35 hover:border-white/50
                          focus:outline-none
                          focus-visible:ring-2 focus-visible:ring-white/60
                        "
                            title="View full size"
                          >
                            ⤢
                          </button>
                        )}

                        {/* Navigation arrows (only if >1 image) */}
                        {hasMultiple && (
                          <>
                            <button
                              type="button"
                              onClick={prevImage}
                              aria-label="Previous image"
                              className="
                            absolute left-3 top-1/2 -translate-y-1/2
                            rounded-full border border-white/30
                            bg-slate-900/15 backdrop-blur
                            px-3 py-2
                            text-white
                            shadow-sm
                            transition
                            hover:bg-slate-900/35 hover:border-white/50
                            focus:outline-none
                            focus-visible:ring-2 focus-visible:ring-white/60
                          "
                            >
                              ‹
                            </button>

                            <button
                              type="button"
                              onClick={nextImage}
                              aria-label="Next image"
                              className="
                            absolute right-3 top-1/2 -translate-y-1/2
                            rounded-full border border-white/30
                            bg-slate-900/15 backdrop-blur
                            px-3 py-2
                            text-white
                            shadow-sm
                            transition
                            hover:bg-slate-900/35 hover:border-white/50
                            focus:outline-none
                            focus-visible:ring-2 focus-visible:ring-white/60
                          "
                            >
                              ›
                            </button>
                          </>
                        )}
                      </div>

                      {/* Thumbnails */}
                      <div className="flex gap-2 overflow-x-auto p-3">
                        {assets.map((a, i) => (
                          <button
                            key={a.fullUrl + i}
                            type="button"
                            onClick={() => setActive(i)}
                            className={[
                              "h-16 w-20 shrink-0 overflow-hidden rounded-xl border bg-white",
                              i === active ? "border-slate-900" : "border-slate-200",
                            ].join(" ")}
                            title={`Image ${i + 1}`}
                            aria-current={i === active ? "true" : undefined}
                          >
                            <img
                              src={a.thumbUrl || a.medUrl || a.fullUrl}
                              alt={`thumb-${i}`}
                              className="h-full w-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="rounded-xl bg-slate-50 p-6">
                      <NoPhotoPlaceholder variant="tile" />
                    </div>
                  </div>
                )}

                <div className="hidden lg:block rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="text-sm font-extrabold text-slate-900">Description</div>
                  <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                    {bodyDescription ? bodyDescription : <span className="text-slate-500">No description.</span>}
                  </div>
                </div>
              </div>

              {/* Right column: price/budget + seller + contact + listing details */}
              <aside className="space-y-5 lg:space-y-0 lg:h-fit lg:rounded-2xl lg:border lg:border-slate-200 lg:bg-white lg:p-5 lg:sticky lg:top-24">
                {/* Mobile card 1 / Desktop section: price + listing details */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
                  {kind === "sale" ? (
                    <>
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-600">Price</div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <div className="text-3xl font-extrabold text-slate-900">{salePriceLabel}</div>
                        {!isSpecialSalePrice ? <div className="text-sm font-semibold text-slate-600">{priceSuffix}</div> : null}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-700">
                        <span className="text-slate-500">{qtyLabel}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-600">Budget</div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <div className="text-2xl font-extrabold text-slate-900">{budgetLabel(item as WantedPost)}</div>
                        {wantedHasBudget ? <div className="text-sm font-semibold text-slate-600">{wantedPriceSuffix}</div> : null}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-700">
                        <span className="text-slate-500">{qtyLabel}</span>
                      </div>
                    </>
                  )}

                  <div className="mt-4 border-t border-slate-200 pt-4">
                    <div className="text-sm font-extrabold text-slate-900">Listing details</div>
                    <dl className="mt-3 space-y-2 text-sm">
                      {(() => {
                        const cat = String(item.category ?? "");
                        const rulesReady = bioRequiredCategories.size > 0;
                        const isOther = rulesReady ? cat === String(otherCategoryName) : false;
                        const bioEnabled = rulesReady ? Boolean(cat) && (bioRequiredCategories.has(cat) || isOther) : true;

                        const species = String(item.species ?? "").trim();
                        const sex = String(item.sex ?? "").trim();
                        const waterType = item.waterType ? String(item.waterType).trim() : "";
                        const size = String((item as any).size ?? "").trim();

                        // Show whatever was actually submitted for this listing.
                        // For non-bio categories, we still suppress the default "Unknown" sex value (it wasn't user-entered).
                        const showSpecies = Boolean(species);
                        const showSex = Boolean(sex) && (bioEnabled || sex !== "Unknown");
                        const showWaterType = Boolean(waterType);
                        const showSize = Boolean(size);

                        return (
                          <>
                            <div className="flex items-baseline justify-between gap-4">
                              <dt className="font-semibold text-slate-600">Listing type</dt>
                              <dd className="font-semibold text-slate-900">{kind === "wanted" ? "Wanted" : "For sale"}</dd>
                            </div>
                            <div className="flex items-baseline justify-between gap-4">
                              <dt className="font-semibold text-slate-600">Category</dt>
                              <dd className="font-semibold text-slate-900">{item.category}</dd>
                            </div>
                            {showSpecies ? (
                              <div className="flex items-baseline justify-between gap-4">
                                <dt className="font-semibold text-slate-600">Species</dt>
                                <dd className="font-semibold text-slate-900">{species}</dd>
                              </div>
                            ) : null}
                            {showWaterType ? (
                              <div className="flex items-baseline justify-between gap-4">
                                <dt className="font-semibold text-slate-600">Water type</dt>
                                <dd className="font-semibold text-slate-900">{waterType}</dd>
                              </div>
                            ) : null}
                            {showSex ? (
                              <div className="flex items-baseline justify-between gap-4">
                                <dt className="font-semibold text-slate-600">Sex</dt>
                                <dd className="font-semibold text-slate-900">{sex}</dd>
                              </div>
                            ) : null}
                            {showSize ? (
                              <div className="flex items-baseline justify-between gap-4">
                                <dt className="font-semibold text-slate-600">Size</dt>
                                <dd className="font-semibold text-slate-900">{size}</dd>
                              </div>
                            ) : null}
                            <div className="flex items-baseline justify-between gap-4">
                              <dt className="font-semibold text-slate-600">Quantity</dt>
                              <dd className="font-semibold text-slate-900">
                                {kind === "wanted"
                                  ? Number.isFinite(Number((item as WantedPost).quantity))
                                    ? Math.max(1, Math.floor(Number((item as WantedPost).quantity)))
                                    : 1
                                  : details.quantity}
                              </dd>
                            </div>
                            {kind === "wanted" ? (
                              wantedHasBudget ? (
                                <div className="flex items-baseline justify-between gap-4">
                                  <dt className="font-semibold text-slate-600">Price type</dt>
                                  <dd className="font-semibold text-slate-900">{wantedPriceSuffix}</dd>
                                </div>
                              ) : null
                            ) : (
                              <div className="flex items-baseline justify-between gap-4">
                                <dt className="font-semibold text-slate-600">Price type</dt>
                                <dd className="font-semibold text-slate-900">{priceTypeLabel}</dd>
                              </div>
                            )}
                            <div className="flex items-baseline justify-between gap-4">
                              <dt className="font-semibold text-slate-600">Location</dt>
                              <dd className="font-semibold text-slate-900">{item.location}</dd>
                            </div>
                            {kind === "sale" ? (
                              <div className="flex items-baseline justify-between gap-4">
                                <dt className="flex items-center gap-1 font-semibold text-slate-600">
                                  <span>Shipping</span>
                                  {details.willingToShip ? <ShippingInfoButton mode="receiver" size="sm" /> : null}
                                </dt>
                                <dd
                                  className={[
                                    "flex items-center justify-end font-semibold",
                                    details.willingToShip ? "text-emerald-700" : "text-slate-900",
                                  ].join(" ")}
                                >
                                  <span>{details.willingToShip ? "Shipping offered" : "Local pickup or delivery only"}</span>
                                </dd>
                              </div>
                            ) : null}
                          </>
                        );
                      })()}
                    </dl>
                  </div>
                </div>

                {/* Mobile card 2: description (moved below price/details when layout collapses) */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:hidden">
                  <div className="text-sm font-extrabold text-slate-900">Description</div>
                  <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                    {bodyDescription ? bodyDescription : <span className="text-slate-500">No description.</span>}
                  </div>
                </div>

                {/* Mobile card 3 / Desktop sections: owner + contact */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
                  <div className="mt-0 pt-0 lg:mt-5 lg:border-t lg:border-slate-200 lg:pt-4">
                    <div className="text-sm font-extrabold text-slate-900">Listing owner</div>
                    <div className="mt-2 flex items-center gap-3">
                      {(item as any).sellerAvatarUrl ? (
                        <img
                          src={(item as any).sellerAvatarUrl}
                          alt=""
                          className="h-[84px] w-[84px] rounded-full border border-slate-200 object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <DefaultAvatar />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">
                          {(kind === "sale" ? (item as any).sellerUsername : (item as any).username) || "Fishclassifieds user"}
                        </div>
                        <div className="text-xs font-semibold text-slate-600">Fishclassifieds member</div>
                      </div>
                    </div>
                    {(item as any).sellerBio && String((item as any).sellerBio).trim() ? (
                      <div className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-xs text-slate-700">
                        {String((item as any).sellerBio).trim()}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 border-t border-slate-200 pt-4">
                    <div className="text-sm font-extrabold text-slate-900">Contact</div>
                    {!item.phone ? (
                      <div className="mt-2 text-sm font-semibold text-slate-700">Phone not available.</div>
                    ) : phoneRevealed ? (
                      <div className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-extrabold text-slate-900">
                        {item.phone}
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setPhoneRevealed(true)}
                          className="mt-3 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                        >
                          Reveal phone number
                        </button>
                        <div className="mt-2 text-xs font-semibold text-slate-600">
                          The listing owner's phone number is hidden for privacy.
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
      </main>

      {/* Lightbox */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeLightbox();
          }}
          aria-modal="true"
          role="dialog"
        >
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="relative w-full max-w-7xl">
              <button
                type="button"
                onClick={closeLightbox}
                aria-label="Close"
                className="
                  absolute right-2 top-2 z-10
                  rounded-full border border-white/30
                  bg-white/10 backdrop-blur
                  px-3 py-2
                  text-white
                  shadow-sm
                  transition
                  hover:bg-white/20 hover:border-white/50
                  focus:outline-none
                  focus-visible:ring-2 focus-visible:ring-white/60
                "
              >
                ✕
              </button>

              {assets.length > 0 && (
                <div className="absolute left-2 top-2 z-10 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white backdrop-blur">
                  {active + 1} / {assets.length}
                </div>
              )}

              <div className="relative overflow-hidden rounded-2xl">
                <div className="flex items-center justify-center">
                  {fullRes ? (
                    <img
                      src={fullRes}
                      alt={item?.title ?? "Listing image"}
                      className="max-h-[85dvh] w-auto max-w-full select-none object-contain"
                      draggable={false}
                    />
                  ) : (
                    <div className="h-[60dvh] w-full overflow-hidden rounded-2xl bg-white/10">
                      <NoPhotoPlaceholder title={item?.title ?? ""} variant="detail" className="text-white/80 from-white/10 to-white/5" />
                    </div>
                  )}
                </div>

                {hasMultiple && (
                  <>
                    <button
                      type="button"
                      onClick={prevImage}
                      aria-label="Previous image"
                      className="
                        absolute left-3 top-1/2 -translate-y-1/2
                        rounded-full border border-white/30
                        bg-white/10 backdrop-blur
                        px-4 py-3
                        text-white
                        shadow-sm
                        transition
                        hover:bg-white/20 hover:border-white/50
                        focus:outline-none
                        focus-visible:ring-2 focus-visible:ring-white/60
                      "
                    >
                      ‹
                    </button>

                    <button
                      type="button"
                      onClick={nextImage}
                      aria-label="Next image"
                      className="
                        absolute right-3 top-1/2 -translate-y-1/2
                        rounded-full border border-white/30
                        bg-white/10 backdrop-blur
                        px-4 py-3
                        text-white
                        shadow-sm
                        transition
                        hover:bg-white/20 hover:border-white/50
                        focus:outline-none
                        focus-visible:ring-2 focus-visible:ring-white/60
                      "
                    >
                      ›
                    </button>
                  </>
                )}
              </div>

              <div className="mt-3 text-center text-xs font-semibold text-white/70">
                {hasMultiple ? "Use ← / → to navigate, Esc to close" : "Press Esc to close"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
