import { useMemo } from "react";

export function PaginationMeta(props: {
  total: number;
  limit: number;
  offset: number;
  currentCount: number;
  loading: boolean;
  onChangeLimit: (next: number) => void;
  options?: number[];
  className?: string;
}) {
  const { total, limit, offset, currentCount, loading, onChangeLimit, options, className } = props;
  const opts = options?.length ? options : [25, 50, 100, 200];

  const pageText = useMemo(() => {
    if (loading) return "Loading…";
    if (!total) return "0";
    const start = Math.min(total, offset + 1);
    const end = Math.min(total, offset + currentCount);
    return `${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`;
  }, [currentCount, loading, offset, total]);

  return (
    <div className={["flex flex-wrap items-center gap-3", className ?? ""].join(" ")}>
      <div className="flex items-center gap-2">
        <div className="text-xs font-semibold text-slate-600">Per page</div>
        <select
          value={limit}
          onChange={(e) => {
            const n = Math.floor(Number(e.target.value));
            const safe = Number.isFinite(n) ? Math.max(1, Math.min(200, n)) : limit;
            onChangeLimit(safe);
          }}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
        >
          {opts.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="text-xs font-semibold text-slate-600">{pageText}</div>
    </div>
  );
}

export function PrevNext(props: { canPrev: boolean; canNext: boolean; loading: boolean; onPrev: () => void; onNext: () => void }) {
  const { canPrev, canNext, loading, onPrev, onNext } = props;
  return (
    <div className="mt-4 flex items-center justify-between gap-2">
      <button
        type="button"
        disabled={!canPrev || loading}
        onClick={onPrev}
        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
      >
        Prev
      </button>
      <button
        type="button"
        disabled={!canNext || loading}
        onClick={onNext}
        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
      >
        Next
      </button>
    </div>
  );
}

