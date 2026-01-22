import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { adminFetchUserDirectory, resolveImageUrl, type AdminUserDirectoryItem } from "../../api";

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
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AdminUserDirectoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(next?: { offset?: number; silent?: boolean }) {
    const silent = Boolean(next?.silent);
    if (!silent) {
      setLoading(true);
      setErr(null);
    }
    try {
      const res = await adminFetchUserDirectory({ query: q.trim() ? q.trim() : undefined, limit, offset: next?.offset ?? offset });
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
          <div className="text-sm font-bold text-slate-900">Users</div>
          <div className="mt-1 text-sm text-slate-600">Search and open a user to manage moderation, sessions, and account deletion.</div>
        </div>
        <div className="text-xs font-semibold text-slate-600">{pageText}</div>
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
          className="w-80 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
        />
        <button
          type="button"
          onClick={() => load({ offset: 0 })}
          disabled={loading}
          className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          Search
        </button>
      </div>

      {err ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div> : null}

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[1fr_200px_180px_110px_140px] gap-3 border-b border-slate-200 p-4 text-xs font-bold text-slate-600">
          <div>User</div>
          <div>Last active</div>
          <div>Moderation</div>
          <div>Admin</div>
          <div>Superadmin</div>
        </div>
        <div className="divide-y divide-slate-200">
          {!loading && items.length === 0 ? <div className="p-4 text-sm text-slate-600">No users found.</div> : null}
          {items.map((u) => {
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
              <div key={u.id} className="grid grid-cols-[1fr_200px_180px_110px_140px] gap-3 p-4">
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

