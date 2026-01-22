import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { adminApprove, adminFetchApprovals, adminReject, type AdminApprovalItem } from "../../api";
import SortHeaderCell, { type SortDir } from "../components/SortHeaderCell";
import { PaginationMeta, PrevNext } from "../components/PaginationControls";
import FloatingHScrollbar from "../../components/FloatingHScrollbar";
import { MobileCard, MobileCardActions, MobileCardBody, MobileCardList, MobileCardMeta, MobileCardMetaGrid } from "../../components/table/MobileCards";
import { useDialogs } from "../../components/dialogs/DialogProvider";

function kindLabel(k: "sale" | "wanted") {
  return k === "sale" ? "For sale" : "Wanted";
}

function fmtIso(iso: string) {
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString();
}

export default function AdminApprovalsPage() {
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const dialogs = useDialogs();
  const [kind, setKind] = useState<"all" | "sale" | "wanted">("all");
  const [items, setItems] = useState<AdminApprovalItem[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "createdAt", dir: "desc" });

  async function load(next?: { offset?: number; limit?: number; sort?: { key: string; dir: SortDir } }) {
    const s = next?.sort ?? sort;
    setLoading(true);
    setErr(null);
    try {
      const res = await adminFetchApprovals({
        kind,
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
      setErr(e?.message ?? "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ offset: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  const defaultDirByKey: Record<string, SortDir> = {
    createdAt: "desc",
    kind: "asc",
    title: "asc",
    category: "asc",
    location: "asc",
    user: "asc",
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

  async function doApprove(it: AdminApprovalItem) {
    await adminApprove(it.kind, it.id);
    setItems((prev) => prev.filter((x) => x.id !== it.id));
    setTotal((t) => Math.max(0, t - 1));
  }

  async function doReject(it: AdminApprovalItem) {
    const note = await dialogs.prompt({
      title: "Reject listing",
      body: "Reject note (optional):",
      placeholder: "Optional note…",
      defaultValue: "",
      confirmText: "Reject",
      cancelText: "Cancel",
      multiline: false,
    });
    if (note === null) return;
    await adminReject(it.kind, it.id, note.trim() ? note.trim() : undefined);
    setItems((prev) => prev.filter((x) => x.id !== it.id));
    setTotal((t) => Math.max(0, t - 1));
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

      {/* Mobile cards */}
      <div className="mt-4 md:hidden">
        <MobileCardList>
          {!loading && displayItems.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No pending items.</div> : null}
          {displayItems.map((it) => (
            <MobileCard key={`${it.kind}-${it.id}`}>
              <MobileCardBody>
                <div className="min-w-0">
                  <div className="truncate text-sm font-extrabold text-slate-900">{it.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                      {kindLabel(it.kind)}
                    </span>
                    <span className="truncate">{it.location}</span>
                  </div>
                  <Link
                    to={`/listing/${it.kind}/${it.id}?viewContext=admin`}
                    className="mt-2 inline-block text-xs font-bold text-slate-700 underline underline-offset-4 hover:text-slate-900"
                  >
                    Open listing
                  </Link>
                </div>

                <MobileCardMetaGrid>
                  <MobileCardMeta label="Created" value={fmtIso(it.createdAt)} />
                  <MobileCardMeta label="Category" value={it.category} />
                  <MobileCardMeta label="User" value={<span className="truncate">{it.user.username}</span>} />
                  <MobileCardMeta label="Email" value={<span className="truncate">{it.user.email}</span>} />
                </MobileCardMetaGrid>

                <MobileCardActions>
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
                </MobileCardActions>
              </MobileCardBody>
            </MobileCard>
          ))}
        </MobileCardList>
      </div>

      {/* Desktop table */}
      <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 bg-white md:block">
        <div className="overflow-x-auto" ref={tableScrollRef}>
          <div className="grid w-max min-w-full grid-cols-[160px_110px_1fr_160px_200px_220px_160px] gap-3 border-b border-slate-200 bg-slate-100/80 p-3 text-xs font-bold tracking-wider text-slate-600">
            <SortHeaderCell label="Created" k="createdAt" sort={sort} onToggle={toggleSort} />
            <SortHeaderCell label="Type" k="kind" sort={sort} onToggle={toggleSort} />
            <SortHeaderCell label="Title" k="title" sort={sort} onToggle={toggleSort} />
            <SortHeaderCell label="Category" k="category" sort={sort} onToggle={toggleSort} />
            <SortHeaderCell label="Location" k="location" sort={sort} onToggle={toggleSort} />
            <SortHeaderCell label="User" k="user" sort={sort} onToggle={toggleSort} />
            <div className="px-2 py-1 text-center">Actions</div>
          </div>

          <div className="divide-y divide-slate-200">
            {!loading && displayItems.length === 0 ? <div className="p-4 text-sm text-slate-600">No pending items.</div> : null}
            {displayItems.map((it) => (
              <div
                key={`${it.kind}-${it.id}`}
                className="grid w-max min-w-full grid-cols-[160px_110px_1fr_160px_200px_220px_160px] gap-3 p-4"
              >
                <div className="text-xs font-semibold text-slate-700">{fmtIso(it.createdAt)}</div>
                <div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                    {kindLabel(it.kind)}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-extrabold text-slate-900">{it.title}</div>
                  <Link
                    to={`/listing/${it.kind}/${it.id}?viewContext=admin`}
                    className="mt-1 inline-block text-xs font-bold text-slate-700 underline underline-offset-4 hover:text-slate-900"
                  >
                    Open listing
                  </Link>
                </div>
                <div className="text-sm font-semibold text-slate-700">{it.category}</div>
                <div className="text-sm font-semibold text-slate-700">{it.location}</div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">{it.user.username}</div>
                  <div className="truncate text-xs font-semibold text-slate-600">{it.user.email}</div>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
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
      <div className="hidden md:block">
        <FloatingHScrollbar scrollRef={tableScrollRef} deps={[items.length, kind, limit, offset]} />
      </div>

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

