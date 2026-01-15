import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Header from "../components/Header";
import { useAuth } from "../auth";
import { closeWantedPost, deleteWantedPost, fetchWantedPost, reopenWantedPost, type WantedPost } from "../api";

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "AUD" });
}

function budgetLabel(w: WantedPost) {
  const min = w.budgetMinCents ?? null;
  const max = w.budgetMaxCents ?? null;
  if (min == null && max == null) return "Any budget";
  if (min != null && max != null) return `${centsToDollars(min)}–${centsToDollars(max)}`;
  if (min != null) return `${centsToDollars(min)}+`;
  return `Up to ${centsToDollars(max!)}`;
}

export default function WantedDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, loading } = useAuth();

  const [item, setItem] = useState<WantedPost | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msgSoon, setMsgSoon] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!id) return;
      setErr(null);
      try {
        const w = await fetchWantedPost(id);
        if (!cancelled) setItem(w);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load wanted post");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const isOwner = useMemo(() => {
    if (!user || !item) return false;
    return Number(user.id) === Number(item.userId);
  }, [user, item]);

  async function onToggleStatus() {
    if (!item) return;
    setBusy(true);
    setErr(null);
    try {
      const updated = item.status === "open" ? await closeWantedPost(item.id) : await reopenWantedPost(item.id);
      setItem(updated);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update status");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!item) return;
    if (!confirm("Delete this wanted post?")) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteWantedPost(item.id);
      nav("/browse?type=wanted");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to delete wanted post");
    } finally {
      setBusy(false);
    }
  }

  function onMessageBuyer() {
    setMsgSoon(false);
    if (loading) return;
    if (!user) {
      const target = id ? `/wanted/${id}` : "/browse?type=wanted";
      return nav(`/auth?next=${encodeURIComponent(target)}&ctx=message`);
    }
    setMsgSoon(true);
  }

  return (
    <div className="min-h-full">
      <Header maxWidth="6xl" />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => nav("/browse?type=wanted")} className="text-sm font-semibold text-slate-600 hover:text-slate-900">
            ← Back to wanted posts
          </button>
          {item && (
            <div
              className={[
                "rounded-full px-2 py-1 text-[11px] font-bold",
                item.status === "open" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700",
              ].join(" ")}
            >
              {item.status === "open" ? "Open" : "Closed"}
            </div>
          )}
        </div>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

        {!item && !err && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">Loading…</div>
        )}

        {item && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-extrabold tracking-tight text-slate-900">{item.title}</h1>
                <div className="mt-2 text-sm font-semibold text-slate-600">
                  {item.category}
                  {item.species ? ` • ${item.species}` : ""}
                  {item.waterType ? ` • ${item.waterType}` : ""}
                  {item.sex ? ` • ${item.sex}` : ""}
                  {item.age ? ` • Age: ${item.age}` : ""}
                  {Number.isFinite(item.quantity) ? ` • Qty: ${item.quantity}` : ""}
                  {" • "}
                  {item.location}
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-700">Budget: {budgetLabel(item)}</div>
                {item.phone ? (
                  <div className="mt-2 text-sm font-semibold text-slate-700">
                    Phone:{" "}
                    <a className="text-slate-900 underline underline-offset-4" href={`tel:${item.phone}`}>
                      {item.phone}
                    </a>
                  </div>
                ) : null}
                <div className="mt-2 text-xs font-semibold text-slate-500">
                  {item.username ? (
                    <>
                      Wanted by <span className="text-slate-900">@{item.username}</span>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                <button
                  type="button"
                  onClick={onMessageBuyer}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
                >
                  Message buyer
                </button>

                {isOwner && (
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Link
                      to={`/wanted/edit/${item.id}`}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 hover:bg-slate-50"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={onToggleStatus}
                      disabled={busy}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {item.status === "open" ? "Close" : "Reopen"}
                    </button>
                    <button
                      type="button"
                      onClick={onDelete}
                      disabled={busy}
                      className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>

            {msgSoon && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                Messaging is coming soon. (Placeholder button for now.)
              </div>
            )}

            <div className="mt-6 whitespace-pre-wrap text-sm text-slate-800">{item.description}</div>
          </div>
        )}
      </main>
    </div>
  );
}

