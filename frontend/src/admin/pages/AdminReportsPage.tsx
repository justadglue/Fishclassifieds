import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { adminFetchReports, adminResolveReport, type AdminReport } from "../../api";

export default function AdminReportsPage() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [items, setItems] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await adminFetchReports({ status });
        if (!cancelled) setItems(res.items);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load reports");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const countText = useMemo(() => (loading ? "Loading…" : items.length === 0 ? "No reports." : `${items.length} report(s)`), [items.length, loading]);

  async function resolve(r: AdminReport) {
    const note = window.prompt("Resolve note (optional):") ?? "";
    await adminResolveReport(r.id, note.trim() ? note.trim() : undefined);
    setItems((prev) => prev.filter((x) => x.id !== r.id));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-slate-900">Reports</div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
          >
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4 text-sm text-slate-600">{countText}</div>
        <div className="divide-y divide-slate-200">
          {items.map((r) => (
            <div key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-extrabold text-slate-900">{r.reason}</div>
                <div className="mt-1 text-xs font-semibold text-slate-600">
                  {r.targetKind} • {r.targetId} • by {r.reporter.username}
                </div>
                {r.details ? <div className="mt-2 text-sm text-slate-700">{r.details}</div> : null}
                <div className="mt-2">
                  <Link
                    to={`/listing/${r.targetKind}/${r.targetId}`}
                    className="text-xs font-bold text-slate-700 underline underline-offset-4 hover:text-slate-900"
                  >
                    Open target
                  </Link>
                </div>
              </div>
              {status === "open" ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => resolve(r)}
                    className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                  >
                    Resolve
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

