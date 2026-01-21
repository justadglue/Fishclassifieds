import { useEffect, useMemo, useState } from "react";
import { adminFetchAudit, type AdminAuditItem } from "../../api";

function fmtIso(iso: string) {
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString();
}

export default function AdminAuditPage() {
  const [actorUserId, setActorUserId] = useState("");
  const [action, setAction] = useState("");
  const [targetKind, setTargetKind] = useState("");
  const [targetId, setTargetId] = useState("");

  const [items, setItems] = useState<AdminAuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(next?: { offset?: number }) {
    setLoading(true);
    setErr(null);
    try {
      const actor = actorUserId.trim() ? Number(actorUserId.trim()) : undefined;
      const res = await adminFetchAudit({
        actorUserId: Number.isFinite(actor as any) ? actor : undefined,
        action: action.trim() ? action.trim() : undefined,
        targetKind: targetKind.trim() ? targetKind.trim() : undefined,
        targetId: targetId.trim() ? targetId.trim() : undefined,
        limit,
        offset: next?.offset ?? offset,
      });
      setItems(res.items);
      setTotal(res.total);
      setLimit(res.limit);
      setOffset(res.offset);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load({ offset: 0 });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  const pageText = useMemo(() => {
    if (loading) return "Loading…";
    if (!total) return "0";
    const start = Math.min(total, offset + 1);
    const end = Math.min(total, offset + items.length);
    return `${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`;
  }, [items.length, loading, offset, total]);

  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900">Audit log</div>
          <div className="mt-1 text-sm text-slate-600">Every admin mutation is recorded here.</div>
        </div>
        <div className="text-xs font-semibold text-slate-600">{pageText}</div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={actorUserId}
          onChange={(e) => setActorUserId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            load({ offset: 0 });
          }}
          placeholder="Actor userId…"
          className="w-36 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
        />
        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            load({ offset: 0 });
          }}
          placeholder="Action…"
          className="w-56 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
        />
        <input
          value={targetKind}
          onChange={(e) => setTargetKind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            load({ offset: 0 });
          }}
          placeholder="Target kind…"
          className="w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
        />
        <input
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            load({ offset: 0 });
          }}
          placeholder="Target id…"
          className="w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
        />
        <button
          type="button"
          onClick={() => load({ offset: 0 })}
          disabled={loading}
          className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          Filter
        </button>
      </div>

      {err ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div> : null}

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[180px_220px_1fr_1fr_160px] gap-3 border-b border-slate-200 p-4 text-xs font-bold text-slate-600">
          <div>When</div>
          <div>Actor</div>
          <div>Action</div>
          <div>Target</div>
          <div>Meta</div>
        </div>
        <div className="divide-y divide-slate-200">
          {!loading && items.length === 0 ? <div className="p-4 text-sm text-slate-600">No audit entries.</div> : null}
          {items.map((it) => (
            <div key={it.id} className="grid grid-cols-[180px_220px_1fr_1fr_160px] gap-3 p-4">
              <div className="text-xs font-semibold text-slate-700">{fmtIso(it.createdAt)}</div>
              <div className="min-w-0">
                <div className="truncate text-sm font-extrabold text-slate-900">{it.actor.username ?? `User ${it.actor.userId}`}</div>
                <div className="truncate text-xs font-semibold text-slate-600">{it.actor.email ?? ""}</div>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-800">{it.action}</div>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-800">
                  {it.targetKind} • {it.targetId}
                </div>
              </div>
              <div>
                {it.metaJson ? (
                  <button
                    type="button"
                    onClick={() => window.alert(it.metaJson)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50"
                  >
                    View
                  </button>
                ) : (
                  <div className="text-xs font-semibold text-slate-500">—</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={!canPrev || loading}
          onClick={() => load({ offset: Math.max(0, offset - limit) })}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
        >
          Prev
        </button>
        <button
          type="button"
          disabled={!canNext || loading}
          onClick={() => load({ offset: offset + limit })}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

