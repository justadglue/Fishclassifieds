import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { adminFetchReports, adminReportAction, type AdminReport, type AdminReportAction } from "../../api";

export default function AdminReportsPage() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [items, setItems] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [actionById, setActionById] = useState<Record<string, AdminReportAction>>({});

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

  async function doAction(r: AdminReport) {
    const action = actionById[r.id] ?? ("resolve_only" as const);

    if (action === "resolve_only") {
      const note = window.prompt("Resolve note (optional):") ?? "";
      await adminReportAction(r.id, { action, note: note.trim() ? note.trim() : null });
      setItems((prev) => prev.filter((x) => x.id !== r.id));
      return;
    }

    if (action === "hide_listing") {
      const ok = window.confirm("Hide (delete) this listing now and resolve the report?");
      if (!ok) return;
      const note = window.prompt("Action note (optional):") ?? "";
      await adminReportAction(r.id, { action, note: note.trim() ? note.trim() : null });
      setItems((prev) => prev.filter((x) => x.id !== r.id));
      return;
    }

    if (action === "warn_user") {
      const note = window.prompt("Warning note (optional):") ?? "";
      await adminReportAction(r.id, { action, note: note.trim() ? note.trim() : null });
      setItems((prev) => prev.filter((x) => x.id !== r.id));
      return;
    }

    if (action === "suspend_user") {
      const note = window.prompt("Suspension reason (optional):") ?? "";
      const daysRaw = window.prompt("Suspend for how many days? (blank for indefinite)", "7") ?? "";
      const days = daysRaw.trim() ? Math.max(1, Math.min(3650, Math.floor(Number(daysRaw)))) : null;
      const suspendDays = days == null || !Number.isFinite(days) ? null : days;
      await adminReportAction(r.id, { action, note: note.trim() ? note.trim() : null, suspendDays });
      setItems((prev) => prev.filter((x) => x.id !== r.id));
      return;
    }

    if (action === "ban_user") {
      const ok = window.confirm("Ban the user who owns this listing and resolve the report?");
      if (!ok) return;
      const note = window.prompt("Ban reason (optional):") ?? "";
      await adminReportAction(r.id, { action, note: note.trim() ? note.trim() : null });
      setItems((prev) => prev.filter((x) => x.id !== r.id));
      return;
    }
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
                    to={`/listing/${r.targetKind}/${r.targetId}?viewContext=admin`}
                    className="text-xs font-bold text-slate-700 underline underline-offset-4 hover:text-slate-900"
                  >
                    Open target
                  </Link>
                </div>
              </div>
              {status === "open" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={actionById[r.id] ?? "resolve_only"}
                    onChange={(e) => setActionById((prev) => ({ ...prev, [r.id]: e.target.value as any }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-slate-400"
                    title="Choose an action and apply it (this resolves the report)."
                  >
                    <option value="resolve_only">Resolve only</option>
                    <option value="hide_listing">Hide listing</option>
                    <option value="warn_user">Warn user (audit only)</option>
                    <option value="suspend_user">Suspend user</option>
                    <option value="ban_user">Ban user</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => doAction(r)}
                    className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                    disabled={loading}
                  >
                    Apply
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

