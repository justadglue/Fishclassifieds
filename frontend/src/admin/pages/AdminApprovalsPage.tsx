import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Undo2 } from "lucide-react";
import {
  adminApprove,
  adminFetchApprovals,
  adminFetchApprovalsHistory,
  adminReject,
  adminSetApprovalDecision,
  resolveImageUrl,
  type AdminApprovalHistoryItem,
  type AdminApprovalItem,
} from "../../api";
import SortHeaderCell, { type SortDir } from "../components/SortHeaderCell";
import { PaginationMeta, PrevNext } from "../components/PaginationControls";
import FloatingHScrollbar from "../../components/FloatingHScrollbar";
import { MobileCard, MobileCardActions, MobileCardBody, MobileCardList, MobileCardMeta, MobileCardMetaGrid } from "../../components/table/MobileCards";
import { useDialogs } from "../../components/dialogs/DialogProvider";

function kindLabel(k: "sale" | "wanted") {
  return k === "sale" ? "For sale" : "Wanted";
}

function cap1(s: string) {
  const t = String(s ?? "");
  return t ? t.slice(0, 1).toUpperCase() + t.slice(1) : t;
}

function statusPill(statusRaw: string | null | undefined) {
  const s = String(statusRaw ?? "").trim().toLowerCase();
  const cls =
    s === "active"
      ? "text-emerald-700"
      : s === "pending"
        ? "text-amber-700"
        : s === "paused"
          ? "text-violet-700"
          : s === "expired"
            ? "text-slate-600"
            : s === "draft"
              ? "text-sky-700"
              : s === "sold" || s === "closed"
                ? "text-slate-800"
                : s === "deleted"
                  ? "text-red-700"
                  : "text-slate-700";
  const label = s === "sold" ? "Sold" : s === "closed" ? "Closed" : cap1(s || "Updated");
  return <span className={`inline-flex shrink-0 rounded-full border border-slate-200 bg-transparent px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

function statusChangePills(prevStatus: string | null, nextStatus: string | null) {
  if (!prevStatus && !nextStatus) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {prevStatus ? statusPill(prevStatus) : null}
      {prevStatus && nextStatus && prevStatus !== nextStatus ? <span className="text-xs font-bold text-slate-400">→</span> : null}
      {nextStatus ? statusPill(nextStatus) : null}
    </div>
  );
}

function inferredNextStatusForHistoryRow(h: AdminApprovalHistoryItem): string | null {
  if (h.nextStatus) return h.nextStatus;
  // Back-compat for older audit rows that didn't store nextStatus in meta_json.
  if (h.action === "approve") return "active";
  if (h.action === "reject") return "deleted";
  return null;
}

function fmtIso(iso: string) {
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString();
}

function decisionLabelFromHistoryRow(h: AdminApprovalHistoryItem) {
  const next = h.nextStatus ?? null;
  if (next === "active") return "Approve";
  if (next === "deleted") return "Reject";
  if (next === "pending") return "Pending";
  // Fallback to the action label for legacy rows / unknown statuses.
  return h.action === "approve" ? "Approve" : h.action === "reject" ? "Reject" : "Decision changed";
}

const HISTORY_GRID_TEMPLATE = "150px 90px minmax(220px, 1fr) 130px 130px 90px minmax(160px, 1fr) 140px";
const HISTORY_GRID_MIN_WIDTH_PX = 1200;

// Title column is intentionally capped to match the History table's Listing column width.
// Extra space should not inflate the title; it can inflate the user column instead.
const PENDING_GRID_TEMPLATE = "150px 90px 220px 130px 150px 130px minmax(140px, 1fr)";
const PENDING_GRID_MIN_WIDTH_PX = 1050;
function ListingThumb(props: { src: string | null; alt: string }) {
  const { src, alt } = props;
  if (!src) {
    return <div className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 bg-slate-100" aria-hidden="true" />;
  }
  return <img src={src} alt={alt} className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 bg-slate-50 object-cover" loading="lazy" />;
}

export default function AdminApprovalsPage() {
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const historyTableScrollRef = useRef<HTMLDivElement | null>(null);
  const dialogs = useDialogs();
  const [kind, setKind] = useState<"all" | "sale" | "wanted">("all");
  const [items, setItems] = useState<AdminApprovalItem[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "createdAt", dir: "desc" });
  const pendingTimersRef = useRef<Record<string, number>>({});
  const [pendingUndo, setPendingUndo] = useState<Record<string, { decision: "approve" | "reject"; note: string | null }>>({});
  const pendingUndoRef = useRef<Record<string, { decision: "approve" | "reject"; note: string | null }>>({});

  const [historyOpen, setHistoryOpen] = useState(false);
  const [histKind, setHistKind] = useState<"all" | "sale" | "wanted">("all");
  const [histAction, setHistAction] = useState<"all" | "approve" | "reject" | "approval_decision_changed">("all");
  const [histTitle, setHistTitle] = useState("");
  const [histOwner, setHistOwner] = useState("");
  const [histActor, setHistActor] = useState("");
  const [histItems, setHistItems] = useState<AdminApprovalHistoryItem[]>([]);
  const [histTotal, setHistTotal] = useState(0);
  const [histLimit, setHistLimit] = useState(50);
  const [histOffset, setHistOffset] = useState(0);
  const [histLoading, setHistLoading] = useState(false);
  const [histErr, setHistErr] = useState<string | null>(null);
  const hasHistFilters =
    histKind !== "all" ||
    histAction !== "all" ||
    Boolean(histTitle.trim()) ||
    Boolean(histOwner.trim()) ||
    Boolean(histActor.trim());

  useEffect(() => {
    return () => {
      // If the admin navigates away while an undo window is open, finalize the decision immediately.
      // This avoids treating navigation as an implicit "undo".
      try {
        const staged = pendingUndoRef.current;
        for (const k of Object.keys(staged)) {
          const entry = staged[k];
          const m = k.match(/^(sale|wanted)-(.*)$/);
          if (!m) continue;
          const kind = m[1] as "sale" | "wanted";
          const id = m[2] as string;
          if (entry.decision === "approve") {
            void adminApprove(kind, id);
          } else {
            const note = entry.note && entry.note.trim() ? entry.note.trim() : undefined;
            void adminReject(kind, id, note);
          }
        }
      } catch {
        // ignore
      }

      // Clear any pending timers on unmount.
      const timers = pendingTimersRef.current;
      Object.values(timers).forEach((t) => window.clearTimeout(t));
      pendingTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    pendingUndoRef.current = pendingUndo;
  }, [pendingUndo]);

  function keyFor(it: { kind: "sale" | "wanted"; id: string }) {
    return `${it.kind}-${it.id}`;
  }

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

  function clearPendingTimer(k: string) {
    const t = pendingTimersRef.current[k];
    if (t) window.clearTimeout(t);
    delete pendingTimersRef.current[k];
  }

  function undoPending(it: { kind: "sale" | "wanted"; id: string }) {
    const k = keyFor(it);
    clearPendingTimer(k);
    setPendingUndo((prev) => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
  }

  async function commitDecision(it: AdminApprovalItem, decision: "approve" | "reject", note: string | null) {
    try {
      if (decision === "approve") {
        await adminApprove(it.kind, it.id);
      } else {
        await adminReject(it.kind, it.id, note && note.trim() ? note.trim() : undefined);
      }
      // Remove row from pending list after commit.
      setItems((prev) => prev.filter((x) => !(x.kind === it.kind && x.id === it.id)));
      setTotal((t) => Math.max(0, t - 1));
      // Refresh history if open so it appears immediately.
      if (historyOpen) {
        await loadHistory({ offset: histOffset });
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to apply decision");
    }
  }

  async function stageDecision(it: AdminApprovalItem, decision: "approve" | "reject", note: string | null) {
    const k = keyFor(it);
    if (pendingUndoRef.current[k]) return;
    setPendingUndo((prev) => ({ ...prev, [k]: { decision, note } }));

    clearPendingTimer(k);
    pendingTimersRef.current[k] = window.setTimeout(async () => {
      // If it was undone, do nothing.
      const still = pendingUndoRef.current[k];
      if (!still) return;
      // Clear staged state before committing so UI re-enables on failure.
      setPendingUndo((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
      clearPendingTimer(k);
      await commitDecision(it, decision, note);
    }, 5000);
  }

  async function onApprove(it: AdminApprovalItem) {
    await stageDecision(it, "approve", null);
  }

  async function onReject(it: AdminApprovalItem) {
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
    await stageDecision(it, "reject", note.trim() ? note.trim() : null);
  }

  async function loadHistory(next?: {
    offset?: number;
    limit?: number;
    kind?: "all" | "sale" | "wanted";
    action?: "all" | "approve" | "reject" | "approval_decision_changed";
    title?: string;
    ownerUsername?: string;
    actorUsername?: string;
  }) {
    const k = next?.kind ?? histKind;
    const a = next?.action ?? histAction;
    const title = next?.title ?? histTitle;
    const ownerUsername = next?.ownerUsername ?? histOwner;
    const actorUsername = next?.actorUsername ?? histActor;
    const lim = next?.limit ?? histLimit;
    const off = next?.offset ?? histOffset;

    setHistLoading(true);
    setHistErr(null);
    try {
      const res = await adminFetchApprovalsHistory({
        kind: k,
        action: a,
        title: title.trim() ? title.trim() : undefined,
        ownerUsername: ownerUsername.trim() ? ownerUsername.trim() : undefined,
        actorUsername: actorUsername.trim() ? actorUsername.trim() : undefined,
        limit: lim,
        offset: off,
      });
      setHistItems(res.items);
      setHistTotal(res.total);
      setHistLimit(res.limit);
      setHistOffset(res.offset);
    } catch (e: any) {
      setHistErr(e?.message ?? "Failed to load approvals history");
    } finally {
      setHistLoading(false);
    }
  }

  async function doSetDecision(row: AdminApprovalHistoryItem, decision: "approve" | "reject" | "pending") {
    if (decision === "reject") {
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
      await adminSetApprovalDecision({ kind: row.kind, id: row.listing.id, decision, note: note.trim() ? note.trim() : null });
      setHistOffset(0);
      await loadHistory({ offset: 0 });
      return;
    }

    if (decision === "pending") {
      const note = await dialogs.prompt({
        title: "Move listing to pending",
        body: "Reason (optional):",
        placeholder: "Optional reason…",
        defaultValue: "",
        confirmText: "Move to pending",
        cancelText: "Cancel",
        multiline: false,
      });
      if (note === null) return;
      await adminSetApprovalDecision({ kind: row.kind, id: row.listing.id, decision, note: note.trim() ? note.trim() : null });
      setHistOffset(0);
      await loadHistory({ offset: 0 });
      return;
    }

    const ok = await dialogs.confirm({
      title: decision === "approve" ? "Approve listing?" : "Move listing back to pending?",
      body:
        decision === "approve"
          ? "This will approve the listing (set it live)."
          : "This will move the listing back to pending review (it will not be publicly visible).",
      confirmText: decision === "approve" ? "Approve" : "Move to pending",
      cancelText: "Cancel",
    });
    if (!ok) return;
    await adminSetApprovalDecision({ kind: row.kind, id: row.listing.id, decision, note: null });
    setHistOffset(0);
    await loadHistory({ offset: 0 });
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
                <div className="flex min-w-0 items-start gap-3">
                  <ListingThumb src={resolveImageUrl((it as any).heroUrl ?? null)} alt={it.title} />
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
                </div>

                <MobileCardMetaGrid>
                  <MobileCardMeta label="Created" value={fmtIso(it.createdAt)} />
                  <MobileCardMeta label="Category" value={it.category} />
                  <MobileCardMeta label="User" value={<span className="truncate">{it.user.username}</span>} />
                </MobileCardMetaGrid>

                <MobileCardActions>
                  {pendingUndo[keyFor(it)] ? (
                    <button
                      type="button"
                      onClick={() => undoPending(it)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50"
                      aria-label="Undo"
                      title="Undo"
                    >
                      <Undo2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onApprove(it)}
                        className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => onReject(it)}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </MobileCardActions>
              </MobileCardBody>
            </MobileCard>
          ))}
        </MobileCardList>
      </div>

      {/* Desktop table */}
      <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 bg-white md:block">
        <div className="overflow-x-auto" ref={tableScrollRef}>
          <div
            className="grid gap-3 border-b border-slate-200 bg-slate-100/80 p-3 text-xs font-bold tracking-wider text-slate-600"
            style={{ gridTemplateColumns: PENDING_GRID_TEMPLATE, minWidth: PENDING_GRID_MIN_WIDTH_PX, width: "100%" }}
          >
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
                className="grid gap-3 p-3"
                style={{ gridTemplateColumns: PENDING_GRID_TEMPLATE, minWidth: PENDING_GRID_MIN_WIDTH_PX, width: "100%" }}
              >
                <div className="text-xs font-semibold text-slate-700">{fmtIso(it.createdAt)}</div>
                <div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                    {kindLabel(it.kind)}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-start gap-3">
                    <ListingThumb src={resolveImageUrl((it as any).heroUrl ?? null)} alt={it.title} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-extrabold text-slate-900">{it.title}</div>
                      <Link
                        to={`/listing/${it.kind}/${it.id}?viewContext=admin`}
                        className="mt-1 inline-flex whitespace-nowrap text-xs font-bold text-slate-700 underline underline-offset-4 hover:text-slate-900"
                      >
                        Open listing
                      </Link>
                    </div>
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-700">{it.category}</div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-700">{it.location}</div>
                </div>
                <div className="min-w-0">
                  <Link
                    to={`/admin/users/${it.user.id}`}
                    className="block truncate text-sm font-semibold text-slate-800 underline underline-offset-4 hover:text-slate-900"
                    title="Open user"
                  >
                    {it.user.username}
                  </Link>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {pendingUndo[keyFor(it)] ? (
                    <button
                      type="button"
                      onClick={() => undoPending(it)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50"
                      aria-label="Undo"
                      title="Undo"
                    >
                      <Undo2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onApprove(it)}
                        className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => onReject(it)}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                      >
                        Reject
                      </button>
                    </>
                  )}
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

      {/* Approvals history */}
      <div className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold text-slate-900">Approvals history</div>
            <div className="mt-1 text-sm text-slate-600">Review past approval decisions and undo/change them.</div>
          </div>
          <button
            type="button"
            onClick={async () => {
              const nextOpen = !historyOpen;
              setHistoryOpen(nextOpen);
              if (nextOpen) {
                setHistOffset(0);
                await loadHistory({ offset: 0 });
              }
            }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
          >
            {historyOpen ? "Hide history" : "Show history"}
          </button>
        </div>

        {historyOpen ? (
          <>
            {histErr ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{histErr}</div> : null}

            <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
              <div className="flex min-w-0 flex-wrap items-center gap-2 md:flex-1 md:flex-nowrap md:overflow-x-auto md:pb-1">
                {hasHistFilters ? (
                  <button
                    type="button"
                    onClick={async () => {
                      setHistKind("all");
                      setHistAction("all");
                      setHistTitle("");
                      setHistOwner("");
                      setHistActor("");
                      setHistOffset(0);
                      await loadHistory({
                        kind: "all",
                        action: "all",
                        title: "",
                        ownerUsername: "",
                        actorUsername: "",
                        offset: 0,
                      });
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
                  >
                    Clear
                  </button>
                ) : null}
                <select
                  value={histKind}
                  onChange={async (e) => {
                    const v = e.target.value as any;
                    setHistKind(v);
                    setHistOffset(0);
                    await loadHistory({ kind: v, offset: 0 });
                  }}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                >
                  <option value="all">All types</option>
                  <option value="sale">For sale</option>
                  <option value="wanted">Wanted</option>
                </select>
                <select
                  value={histAction}
                  onChange={async (e) => {
                    const v = e.target.value as any;
                    setHistAction(v);
                    setHistOffset(0);
                    await loadHistory({ action: v, offset: 0 });
                  }}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                >
                  <option value="all">All actions</option>
                  <option value="approve">Approve</option>
                  <option value="reject">Reject</option>
                  <option value="approval_decision_changed">Decision changed</option>
                </select>
                <input
                  value={histTitle}
                  onChange={(e) => setHistTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    setHistOffset(0);
                    loadHistory({ offset: 0 });
                  }}
                  placeholder="Listing title…"
                  className="w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                />
                <input
                  value={histOwner}
                  onChange={(e) => setHistOwner(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    setHistOffset(0);
                    loadHistory({ offset: 0 });
                  }}
                  placeholder="Owner username…"
                  className="w-56 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                />
                <input
                  value={histActor}
                  onChange={(e) => setHistActor(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    setHistOffset(0);
                    loadHistory({ offset: 0 });
                  }}
                  placeholder="Actor username…"
                  className="w-56 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                />
              </div>
              <div className="shrink-0 md:ml-auto">
                <PaginationMeta
                  total={histTotal}
                  limit={histLimit}
                  offset={histOffset}
                  currentCount={histItems.length}
                  loading={histLoading}
                  onChangeLimit={(next) => {
                    setHistLimit(next);
                    setHistOffset(0);
                    loadHistory({ limit: next, offset: 0 });
                  }}
                />
              </div>
            </div>

            {/* Mobile cards */}
            <div className="mt-4 md:hidden">
              <MobileCardList>
                {!histLoading && histItems.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No history entries.</div> : null}
                {histItems.map((h) => (
                  <MobileCard key={h.id}>
                    <MobileCardBody>
                      <div className="flex min-w-0 items-start gap-3">
                        <ListingThumb src={resolveImageUrl((h.listing as any).heroUrl ?? null)} alt={h.listing.title || h.listing.id} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-extrabold text-slate-900">{h.listing.title || h.listing.id}</div>
                          <div className="mt-1 text-xs font-semibold text-slate-600">
                            {kindLabel(h.kind)} • {h.action} • {fmtIso(h.createdAt)}
                          </div>
                        </div>
                      </div>
                      <MobileCardMetaGrid>
                        <MobileCardMeta
                          label="Owner"
                          value={
                            h.owner?.userId != null ? (
                              <Link to={`/admin/users/${h.owner.userId}`} className="truncate font-bold underline underline-offset-4">
                                {h.owner.username ?? `User ${h.owner.userId}`}
                              </Link>
                            ) : (
                              <span className="truncate">—</span>
                            )
                          }
                        />
                        <MobileCardMeta
                          label="Actor"
                          value={
                            <Link to={`/admin/users/${h.actor.userId}`} className="truncate font-bold underline underline-offset-4">
                              {h.actor.username ?? `User ${h.actor.userId}`}
                            </Link>
                          }
                        />
                        <MobileCardMeta
                          label="Status"
                          value={statusChangePills(h.prevStatus ?? null, inferredNextStatusForHistoryRow(h)) ?? "—"}
                        />
                        {h.note ? <MobileCardMeta label="Note" value={<span className="truncate">{h.note}</span>} /> : null}
                      </MobileCardMetaGrid>
                      <MobileCardActions>
                        {(() => {
                          const curStatus = h.listing.status ?? null;
                          const disablePending = curStatus === "pending";
                          const disableApprove = curStatus === "active";
                          const disableReject = curStatus === "deleted";
                          return (
                            <>
                              <Link
                                to={`/listing/${h.kind}/${h.listing.id}?viewContext=admin`}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50"
                              >
                                Open
                              </Link>
                              <button
                                type="button"
                                disabled={disablePending}
                                onClick={() => doSetDecision(h, "pending")}
                                className={[
                                  "rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800",
                                  disablePending ? "cursor-not-allowed opacity-50" : "hover:bg-slate-50",
                                ].join(" ")}
                              >
                                Set pending
                              </button>
                              <button
                                type="button"
                                disabled={disableApprove}
                                onClick={() => doSetDecision(h, "approve")}
                                className={[
                                  "rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800",
                                  disableApprove ? "cursor-not-allowed opacity-50" : "hover:bg-emerald-100",
                                ].join(" ")}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={disableReject}
                                onClick={() => doSetDecision(h, "reject")}
                                className={[
                                  "rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700",
                                  disableReject ? "cursor-not-allowed opacity-50" : "hover:bg-red-100",
                                ].join(" ")}
                              >
                                Reject
                              </button>
                            </>
                          );
                        })()}
                      </MobileCardActions>
                    </MobileCardBody>
                  </MobileCard>
                ))}
              </MobileCardList>
            </div>

            {/* Desktop table */}
            <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 bg-white md:block">
              <div className="overflow-x-auto" ref={historyTableScrollRef}>
                <div
                  className="grid gap-3 border-b border-slate-200 bg-slate-100/80 p-3 text-xs font-bold tracking-wider text-slate-600"
                  style={{ gridTemplateColumns: HISTORY_GRID_TEMPLATE, minWidth: HISTORY_GRID_MIN_WIDTH_PX, width: "100%" }}
                >
                  <div>When</div>
                  <div>Type</div>
                  <div>Listing</div>
                  <div>Owner</div>
                  <div>Actor</div>
                  <div>Decision</div>
                  <div>Note</div>
                  <div className="text-center">Actions</div>
                </div>
                <div className="divide-y divide-slate-200">
                  {!histLoading && histItems.length === 0 ? <div className="p-4 text-sm text-slate-600">No history entries.</div> : null}
                  {histItems.map((h) => (
                    <div
                      key={h.id}
                      className="grid gap-3 p-3"
                      style={{ gridTemplateColumns: HISTORY_GRID_TEMPLATE, minWidth: HISTORY_GRID_MIN_WIDTH_PX, width: "100%" }}
                    >
                      <div className="text-xs font-semibold text-slate-700">{fmtIso(h.createdAt)}</div>
                      <div>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                          {kindLabel(h.kind)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-start gap-3">
                          <ListingThumb src={resolveImageUrl((h.listing as any).heroUrl ?? null)} alt={h.listing.title || h.listing.id} />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-extrabold text-slate-900">{h.listing.title || h.listing.id}</div>
                            <Link
                              to={`/listing/${h.kind}/${h.listing.id}?viewContext=admin`}
                              className="mt-1 inline-flex whitespace-nowrap text-xs font-bold text-slate-700 underline underline-offset-4 hover:text-slate-900"
                            >
                              Open listing
                            </Link>
                          </div>
                        </div>
                      </div>
                      <div className="min-w-0">
                        {h.owner?.userId != null ? (
                          <Link
                            to={`/admin/users/${h.owner.userId}`}
                            className="block truncate text-sm font-semibold text-slate-800 underline underline-offset-4 hover:text-slate-900"
                            title="Open user"
                          >
                            {h.owner.username ?? `User ${h.owner.userId}`}
                          </Link>
                        ) : (
                          <div className="truncate text-sm font-semibold text-slate-500">—</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <Link
                          to={`/admin/users/${h.actor.userId}`}
                          className="block truncate text-sm font-semibold text-slate-800 underline underline-offset-4 hover:text-slate-900"
                          title="Open user"
                        >
                          {h.actor.username ?? `User ${h.actor.userId}`}
                        </Link>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-800">
                          {h.action === "approval_decision_changed" ? decisionLabelFromHistoryRow(h) : h.action === "approve" ? "Approve" : "Reject"}
                        </div>
                        {(h.prevStatus || h.nextStatus) && h.prevStatus !== inferredNextStatusForHistoryRow(h) ? (
                          <div className="mt-1">{statusChangePills(h.prevStatus ?? null, inferredNextStatusForHistoryRow(h))}</div>
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        {h.note ? (
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="min-w-0 truncate text-sm font-semibold text-slate-700" title={h.note}>
                              {h.note}
                            </div>
                            <button
                              type="button"
                              onClick={async () => {
                                await dialogs.alert({
                                  title: "Approval note",
                                  body: <div className="whitespace-pre-wrap text-sm font-semibold text-slate-800">{h.note}</div>,
                                  confirmText: "Close",
                                });
                              }}
                              className="shrink-0 rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-800 hover:bg-slate-50"
                            >
                              View
                            </button>
                          </div>
                        ) : (
                          <div className="text-sm font-semibold text-slate-500">—</div>
                        )}
                      </div>
                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={async () => {
                            const curStatus = h.listing.status ?? null;
                            const picked = await dialogs.choice({
                              title: "Approval actions",
                              body: "Choose an action:",
                              cancelText: "Close",
                              options: [
                                { label: "Set pending", value: "pending", disabled: curStatus === "pending" },
                                { label: "Approve", value: "approve", variant: "primary", disabled: curStatus === "active" },
                                { label: "Reject", value: "reject", variant: "danger", disabled: curStatus === "deleted" },
                              ],
                            });
                            if (!picked) return;
                            if (picked === "pending" || picked === "approve" || picked === "reject") {
                              await doSetDecision(h, picked);
                            }
                          }}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50"
                        >
                          Actions
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="hidden md:block">
              <FloatingHScrollbar scrollRef={historyTableScrollRef} deps={[histItems.length, histKind, histAction, histLimit, histOffset]} />
            </div>

            <PrevNext
              canPrev={histOffset > 0}
              canNext={histOffset + histLimit < histTotal}
              loading={histLoading}
              onPrev={() => {
                const next = Math.max(0, histOffset - histLimit);
                setHistOffset(next);
                loadHistory({ offset: next });
              }}
              onNext={() => {
                const next = histOffset + histLimit;
                setHistOffset(next);
                loadHistory({ offset: next });
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

