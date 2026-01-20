import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { adminApprove, adminFetchApprovals, adminReject, type AdminApprovalItem } from "../../api";

function kindLabel(k: "sale" | "wanted") {
  return k === "sale" ? "For sale" : "Wanted";
}

export default function AdminApprovalsPage() {
  const [kind, setKind] = useState<"all" | "sale" | "wanted">("all");
  const [items, setItems] = useState<AdminApprovalItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await adminFetchApprovals({ kind });
        if (!cancelled) setItems(res.items);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load approvals");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const grouped = useMemo(() => {
    return items;
  }, [items]);

  async function doApprove(it: AdminApprovalItem) {
    await adminApprove(it.kind, it.id);
    setItems((prev) => prev.filter((x) => x.id !== it.id));
  }

  async function doReject(it: AdminApprovalItem) {
    const note = window.prompt("Reject note (optional):") ?? "";
    await adminReject(it.kind, it.id, note.trim() ? note.trim() : undefined);
    setItems((prev) => prev.filter((x) => x.id !== it.id));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-slate-900">Pending approvals</div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">Type</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as any)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
          >
            <option value="all">All</option>
            <option value="sale">For sale</option>
            <option value="wanted">Wanted</option>
          </select>
        </div>
      </div>

      {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4 text-sm text-slate-600">
          {loading ? "Loading…" : grouped.length === 0 ? "No pending items." : `${grouped.length} item(s)`}
        </div>
        <div className="divide-y divide-slate-200">
          {grouped.map((it) => (
            <div key={`${it.kind}-${it.id}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-extrabold text-slate-900">{it.title}</div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                    {kindLabel(it.kind)}
                  </span>
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-600">
                  {it.category} • {it.location} • by {it.user.username}
                </div>
                <div className="mt-2">
                  <Link
                    to={`/listing/${it.kind}/${it.id}`}
                    className="text-xs font-bold text-slate-700 underline underline-offset-4 hover:text-slate-900"
                  >
                    Open listing
                  </Link>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => doApprove(it)}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => doReject(it)}
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

