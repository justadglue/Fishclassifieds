import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { adminFetchUserDirectory, resolveImageUrl, type AdminUserDirectoryItem } from "../../api";
import SortHeaderCell, { type SortDir } from "../components/SortHeaderCell";
import { PaginationMeta, PrevNext } from "../components/PaginationControls";
import FloatingHScrollbar from "../../components/FloatingHScrollbar";
import { MobileCard, MobileCardBody, MobileCardList, MobileCardMeta, MobileCardMetaGrid } from "../../components/table/MobileCards";

function DefaultAvatar() {
  return (
    <div className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-600">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M20 21a8 8 0 0 0-16 0" />
        <circle cx="12" cy="8" r="4" />
      </svg>
    </div>
  );
}

function fmtUntil(ms: number | null) {
  if (ms == null) return "";
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString();
}

function fmtIso(iso: string | null | undefined) {
  if (!iso) return "—";
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return String(iso);
  return new Date(t).toLocaleString();
}

function fmtAgo(iso: string | null | undefined) {
  if (!iso) return "—";
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return "—";
  const diffMs = Math.max(0, Date.now() - t);
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function AdminUserDirectoryPage() {
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AdminUserDirectoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "lastActive", dir: "desc" });

  async function load(next?: { offset?: number; silent?: boolean; sort?: { key: string; dir: SortDir } }) {
    const silent = Boolean(next?.silent);
    const s = next?.sort ?? sort;
    if (!silent) {
      setLoading(true);
      setErr(null);
    }
    try {
      const res = await adminFetchUserDirectory({
        query: q.trim() ? q.trim() : undefined,
        sortKey: s.key,
        sortDir: s.dir,
        limit,
        offset: next?.offset ?? offset,
      });
      setItems(res.items);
      setTotal(res.total);
      setLimit(res.limit);
      setOffset(res.offset);
    } catch (e: any) {
      if (!silent) setErr(e?.message ?? "Failed to load users");
    } finally {
      if (!silent) setLoading(false);
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

  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  const defaultDirByKey: Record<string, SortDir> = {
    user: "asc",
    lastActive: "desc",
    moderation: "asc",
    admin: "desc",
    superadmin: "desc",
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

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900">Users</div>
          <div className="mt-1 text-sm text-slate-600">Search and open a user to manage moderation, sessions, and account deletion.</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            load({ offset: 0 });
          }}
          placeholder="Search username/email…"
          className="w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
        />
        <button
          type="button"
          onClick={() => load({ offset: 0 })}
          disabled={loading}
          className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          Search
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
          }}
        />
      </div>

      {err ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div> : null}

      {/* Mobile cards */}
      <div className="mt-4 md:hidden">
        <MobileCardList>
          {!loading && items.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No users found.</div> : null}
          {displayItems.map((u) => {
            const mod = u.moderation?.status ?? "active";
            const modText =
              mod === "active"
                ? "Active"
                : mod === "banned"
                  ? "Banned"
                  : u.moderation.suspendedUntil
                    ? `Suspended until ${fmtUntil(u.moderation.suspendedUntil)}`
                    : "Suspended";
            return (
              <MobileCard key={u.id}>
                <MobileCardBody>
                  <div className="flex min-w-0 items-start gap-3">
                    {u.avatarUrl ? (
                      <img
                        src={resolveImageUrl(u.avatarUrl) ?? u.avatarUrl}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-full border border-slate-200 object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <DefaultAvatar />
                    )}
                    <div className="min-w-0 flex-1">
                      <Link to={`/admin/users/${u.id}`} className="block truncate text-sm font-extrabold text-slate-900 underline underline-offset-4">
                        {u.username}
                      </Link>
                      <div className="truncate text-xs font-semibold text-slate-600">{u.email}</div>
                    </div>
                  </div>

                  <MobileCardMetaGrid>
                    <MobileCardMeta label="Last active" value={<span title={fmtIso(u.lastActiveAt)}>{fmtAgo(u.lastActiveAt)}</span>} />
                    <MobileCardMeta label="Moderation" value={modText} />
                    <MobileCardMeta label="Admin" value={u.isAdmin ? "On" : "Off"} />
                    <MobileCardMeta label="Superadmin" value={u.isSuperadmin ? "On" : "Off"} />
                  </MobileCardMetaGrid>
                </MobileCardBody>
              </MobileCard>
            );
          })}
        </MobileCardList>
      </div>

      {/* Desktop table */}
      <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 bg-white md:block">
        <div className="overflow-x-auto" ref={tableScrollRef}>
          <div className="grid w-max min-w-full grid-cols-[1fr_200px_180px_110px_140px] gap-3 border-b border-slate-200 bg-slate-100/80 p-3 text-xs font-bold tracking-wider text-slate-600">
            <SortHeaderCell label="User" k="user" sort={sort} onToggle={toggleSort} />
            <SortHeaderCell label="Last active" k="lastActive" sort={sort} onToggle={toggleSort} />
            <SortHeaderCell label="Moderation" k="moderation" sort={sort} onToggle={toggleSort} />
            <SortHeaderCell label="Admin" k="admin" sort={sort} onToggle={toggleSort} />
            <SortHeaderCell label="Superadmin" k="superadmin" sort={sort} onToggle={toggleSort} />
          </div>
          <div className="divide-y divide-slate-200">
            {!loading && items.length === 0 ? <div className="p-4 text-sm text-slate-600">No users found.</div> : null}
            {displayItems.map((u) => {
              const mod = u.moderation?.status ?? "active";
              const modText =
                mod === "active"
                  ? "Active"
                  : mod === "banned"
                    ? "Banned"
                    : u.moderation.suspendedUntil
                      ? `Suspended until ${fmtUntil(u.moderation.suspendedUntil)}`
                      : "Suspended";
              return (
                <div key={u.id} className="grid w-max min-w-full grid-cols-[1fr_200px_180px_110px_140px] gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-start gap-3">
                      {u.avatarUrl ? (
                        <img
                          src={resolveImageUrl(u.avatarUrl) ?? u.avatarUrl}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-full border border-slate-200 object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <DefaultAvatar />
                      )}
                      <div className="min-w-0">
                        <Link to={`/admin/users/${u.id}`} className="block truncate text-sm font-extrabold text-slate-900 underline underline-offset-4">
                          {u.username}
                        </Link>
                        <div className="truncate text-xs font-semibold text-slate-600">{u.email}</div>
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-slate-700" title={fmtIso(u.lastActiveAt)}>
                    {fmtAgo(u.lastActiveAt)}
                  </div>
                  <div className="text-sm font-semibold text-slate-700">{modText}</div>
                  <div className="text-sm font-semibold text-slate-700">{u.isAdmin ? "On" : "Off"}</div>
                  <div className="text-sm font-semibold text-slate-700">{u.isSuperadmin ? "On" : "Off"}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="hidden md:block">
        <FloatingHScrollbar scrollRef={tableScrollRef} deps={[items.length, q, limit, offset]} />
      </div>

      <PrevNext
        canPrev={canPrev}
        canNext={canNext}
        loading={loading}
        onPrev={() => load({ offset: Math.max(0, offset - limit) })}
        onNext={() => load({ offset: offset + limit })}
      />
    </div>
  );
}

