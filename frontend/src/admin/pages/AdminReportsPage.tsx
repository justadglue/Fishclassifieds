import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { adminFetchReports, adminReportAction, type AdminReport, type AdminReportAction } from "../../api";
import SortHeaderCell, { type SortDir } from "../components/SortHeaderCell";
import { PaginationMeta, PrevNext } from "../components/PaginationControls";
import FloatingHScrollbar from "../../components/FloatingHScrollbar";

function fmtIso(iso: string) {
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString();
}

export default function AdminReportsPage() {
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [items, setItems] = useState<AdminReport[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [actionById, setActionById] = useState<Record<string, AdminReportAction>>({});
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "createdAt", dir: "desc" });

  async function load(next?: { offset?: number; limit?: number; sort?: { key: string; dir: SortDir } }) {
    const s = next?.sort ?? sort;
    setLoading(true);
    setErr(null);
    try {
      const res = await adminFetchReports({
        status,
        sortKey: s.key,
        sortDir: s.dir,
        limit: next?.limit ?? limit,
        offset: next?.offset ?? offset,
      });
      setItems(res.items);
      setTotal(res.total);
      setLimit(res.limit);
      setOffset(res.offset);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ offset: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  const defaultDirByKey: Record<string, SortDir> = {
    createdAt: "desc",
    target: "asc",
    reason: "asc",
    reporter: "asc",
    owner: "asc",
  };

  function toggleSort(next: string) {
    const same = sort.key === next;
    const dir = same ? (sort.dir === "asc" ? "desc" : "asc") : defaultDirByKey[next] ?? "asc";
    const nextSort = { key: next, dir };
    setSort(nextSort);
    setOffset(0);
    load({ offset: 0, sort: nextSort });
  }

  const displayItems = useMemo(() => items, [items]);

  async function doAction(r: AdminReport) {
    const action = actionById[r.id] ?? ("resolve_only" as const);

    if (action === "resolve_only") {
      const note = window.prompt("Resolve note (optional):") ?? "";
      await adminReportAction(r.id, { action, note: note.trim() ? note.trim() : null });
      setItems((prev) => prev.filter((x) => x.id !== r.id));
      setTotal((t) => Math.max(0, t - 1));
      return;
    }

    if (action === "hide_listing") {
      const ok = window.confirm("Hide (delete) this listing now and resolve the report?");
      if (!ok) return;
      const note = window.prompt("Action note (optional):") ?? "";
      await adminReportAction(r.id, { action, note: note.trim() ? note.trim() : null });
      setItems((prev) => prev.filter((x) => x.id !== r.id));
      setTotal((t) => Math.max(0, t - 1));
      return;
    }

    if (action === "warn_user") {
      const note = window.prompt("Warning note (optional):") ?? "";
      await adminReportAction(r.id, { action, note: note.trim() ? note.trim() : null });
      setItems((prev) => prev.filter((x) => x.id !== r.id));
      setTotal((t) => Math.max(0, t - 1));
      return;
    }

    if (action === "suspend_user") {
      const note = window.prompt("Suspension reason (optional):") ?? "";
      const daysRaw = window.prompt("Suspend for how many days? (blank for indefinite)", "7") ?? "";
      const days = daysRaw.trim() ? Math.max(1, Math.min(3650, Math.floor(Number(daysRaw)))) : null;
      const suspendDays = days == null || !Number.isFinite(days) ? null : days;
      await adminReportAction(r.id, { action, note: note.trim() ? note.trim() : null, suspendDays });
      setItems((prev) => prev.filter((x) => x.id !== r.id));
      setTotal((t) => Math.max(0, t - 1));
      return;
    }

    if (action === "ban_user") {
      const ok = window.confirm("Ban the user who owns this listing and resolve the report?");
      if (!ok) return;
      const note = window.prompt("Ban reason (optional):") ?? "";
      await adminReportAction(r.id, { action, note: note.trim() ? note.trim() : null });
      setItems((prev) => prev.filter((x) => x.id !== r.id));
      setTotal((t) => Math.max(0, t - 1));
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => load({ offset: 0 })}
          disabled={loading}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
        >
          Refresh
        </button>
        <PaginationMeta
          className="ml-auto"
          total={total}
          limit={limit}
          offset={offset}
          currentCount={items.length}
          loading={loading}
          onChangeLimit={(next) => {
            setLimit(next);
            setOffset(0);
            load({ limit: next, offset: 0 });
          }}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto" ref={tableScrollRef}>
          <div className="grid w-max min-w-full grid-cols-[120px_140px_170px_170px_170px_1fr_220px] gap-3 border-b border-slate-200 bg-slate-100/80 p-3 text-xs font-bold tracking-wider text-slate-600">
            <SortHeaderCell label="Created" k="createdAt" sort={sort} onToggle={toggleSort} />
            <SortHeaderCell label="Target" k="target" sort={sort} onToggle={toggleSort} />
            <SortHeaderCell label="Reason" k="reason" sort={sort} onToggle={toggleSort} />
            <SortHeaderCell label="Reporter" k="reporter" sort={sort} onToggle={toggleSort} />
            <SortHeaderCell label="Owner" k="owner" sort={sort} onToggle={toggleSort} />
            <div className="px-2 py-1">Details</div>
            <div className="px-2 py-1 text-center">Actions</div>
          </div>

          <div className="divide-y divide-slate-200">
            {!loading && displayItems.length === 0 ? <div className="p-4 text-sm text-slate-600">No reports.</div> : null}
            {displayItems.map((r) => (
              <div key={r.id} className="grid w-max min-w-full grid-cols-[120px_140px_170px_170px_170px_1fr_220px] gap-3 p-4">
                <div className="text-xs font-semibold text-slate-700" title={fmtIso(r.createdAt)}>
                  {fmtIso(r.createdAt)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">
                    {r.targetKind} • {r.targetId}
                  </div>
                  <Link
                    to={`/listing/${r.targetKind}/${r.targetId}?viewContext=admin`}
                    className="mt-1 inline-block text-xs font-bold text-slate-700 underline underline-offset-4 hover:text-slate-900"
                  >
                    Open target
                  </Link>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-extrabold text-slate-900">{r.reason}</div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">{r.reporter.username}</div>
                  <div className="truncate text-xs font-semibold text-slate-600 hidden lg:block">{r.reporter.email}</div>
                </div>
                <div className="min-w-0">
                  {r.owner ? (
                    <>
                      <div className="truncate text-sm font-semibold text-slate-800">{r.owner.username}</div>
                      <div className="truncate text-xs font-semibold text-slate-600 hidden lg:block">{r.owner.email}</div>
                    </>
                  ) : (
                    <div className="text-sm text-slate-500">—</div>
                  )}
                </div>
                <div className="min-w-0">
                  {r.details ? <div className="line-clamp-2 text-sm text-slate-700">{r.details}</div> : <div className="text-sm text-slate-500">—</div>}
                  {status === "resolved" && r.resolvedNote ? (
                    <div className="mt-1 line-clamp-2 text-xs font-semibold text-slate-600">Resolved note: {r.resolvedNote}</div>
                  ) : null}
                </div>
                <div className="flex flex-col items-center justify-center gap-2 sm:flex-row sm:justify-center">
                  {status === "open" ? (
                    <>
                      <select
                        value={actionById[r.id] ?? "resolve_only"}
                        onChange={(e) => setActionById((prev) => ({ ...prev, [r.id]: e.target.value as any }))}
                        className="w-full max-w-[200px] rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-800 outline-none focus:border-slate-400 sm:w-auto"
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
                        className="w-full max-w-[200px] rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60 sm:w-auto"
                        disabled={loading}
                      >
                        Apply
                      </button>
                    </>
                  ) : (
                    <div className="text-xs font-semibold text-slate-600">Resolved</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <FloatingHScrollbar scrollRef={tableScrollRef} deps={[items.length, status, limit, offset]} />

      <PrevNext
        canPrev={canPrev}
        canNext={canNext}
        loading={loading}
        onPrev={() => {
          const next = Math.max(0, offset - limit);
          setOffset(next);
          load({ offset: next });
        }}
        onNext={() => {
          const next = offset + limit;
          setOffset(next);
          load({ offset: next });
        }}
      />
    </div>
  );
}

