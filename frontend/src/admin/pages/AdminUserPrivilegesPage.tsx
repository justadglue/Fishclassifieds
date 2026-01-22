import { useEffect, useMemo, useRef, useState } from "react";
import { adminFetchUsers, adminSetAdmin, adminSetSuperadmin, authReauth, resolveImageUrl, type AdminUser } from "../../api";
import { useAuth } from "../../auth";
import SortHeaderCell, { type SortDir } from "../components/SortHeaderCell";
import { PaginationMeta, PrevNext } from "../components/PaginationControls";
import FloatingHScrollbar from "../../components/FloatingHScrollbar";

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

export default function AdminUserPrivilegesPage() {
  const { user } = useAuth();
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "user", dir: "asc" });

  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthErr, setReauthErr] = useState<string | null>(null);
  const [reauthBusy, setReauthBusy] = useState(false);
  const pendingActionRef = useRef<null | (() => Promise<void>)>(null);

  const isSuper = Boolean(user?.isSuperadmin);

  const reauthTitle = useMemo(() => "Confirm your password", []);

  function isReauthRequiredError(e: any) {
    const status = e && typeof e === "object" && "status" in e ? Number((e as any).status) : null;
    if (status !== 403) return false;

    const bodyText = e && typeof e === "object" && "bodyText" in e ? String((e as any).bodyText ?? "") : "";
    const msg = String(e?.message ?? "");
    const raw = bodyText || (msg.startsWith("API 403:") ? msg.slice("API 403:".length).trim() : "");

    try {
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && String(parsed.code ?? "") === "REAUTH_REQUIRED";
    } catch {
      return false;
    }
  }

  async function runWithReauth(action: () => Promise<void>) {
    setErr(null);
    setSaving(true);
    try {
      await action();
    } catch (e: any) {
      if (isReauthRequiredError(e)) {
        pendingActionRef.current = action;
        setReauthErr(null);
        setReauthPassword("");
        setReauthOpen(true);
        return;
      }
      setErr(e?.message ?? "Failed to update user privileges");
    } finally {
      setSaving(false);
    }
  }

  async function load(next?: { offset?: number; limit?: number; sort?: { key: string; dir: SortDir } }) {
    setLoading(true);
    setErr(null);
    try {
      const s = next?.sort ?? sort;
      const res = await adminFetchUsers({
        query: q.trim() ? q.trim() : undefined,
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
      setErr(e?.message ?? "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  const defaultDirByKey: Record<string, SortDir> = {
    user: "asc",
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

  async function toggleAdmin(u: AdminUser) {
    const next = !u.isAdmin;
    await runWithReauth(async () => {
      await adminSetAdmin(u.id, next);
      setItems((prev) => prev.map((x) => (x.id === u.id ? { ...x, isAdmin: next } : x)));
    });
  }

  async function toggleSuper(u: AdminUser) {
    const next = !u.isSuperadmin;
    await runWithReauth(async () => {
      await adminSetSuperadmin(u.id, next);
      setItems((prev) => prev.map((x) => (x.id === u.id ? { ...x, isSuperadmin: next, isAdmin: next ? true : x.isAdmin } : x)));
    });
  }

  async function submitReauth() {
    setReauthErr(null);
    setReauthBusy(true);
    try {
      await authReauth(reauthPassword);
      setReauthOpen(false);
      const act = pendingActionRef.current;
      pendingActionRef.current = null;
      setReauthPassword("");
      if (act) {
        await runWithReauth(act);
      }
    } catch (e: any) {
      setReauthErr(e?.message ?? "Password confirmation failed");
    } finally {
      setReauthBusy(false);
    }
  }

  if (!isSuper) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="text-sm font-extrabold text-slate-900">Superadmin only</div>
        <div className="mt-1 text-sm text-slate-600">You don’t have permission to manage user privileges.</div>
      </div>
    );
  }

  return (
    <div>
      {reauthOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="text-sm font-extrabold text-slate-900">{reauthTitle}</div>
            <div className="mt-1 text-sm text-slate-600">To change admin privileges, please re-enter your password.</div>

            {reauthErr ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{reauthErr}</div>
            ) : null}

            <div className="mt-4">
              <label className="text-xs font-bold text-slate-600">Password</label>
              <input
                type="password"
                value={reauthPassword}
                autoFocus
                onChange={(e) => setReauthPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  submitReauth();
                }}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
              />
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  pendingActionRef.current = null;
                  setReauthOpen(false);
                  setReauthPassword("");
                  setReauthErr(null);
                }}
                disabled={reauthBusy}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitReauth}
                disabled={reauthBusy || !reauthPassword.trim()}
                className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900">User privileges</div>
          <div className="mt-1 text-sm text-slate-600">Superadmin: manage admin/superadmin roles.</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            setOffset(0);
            load();
          }}
          placeholder="Search…"
          className="w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
        />
        <button
          type="button"
          onClick={() => {
            setOffset(0);
            load({ offset: 0 });
          }}
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
            load({ limit: next, offset: 0 });
          }}
        />
      </div>

      {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto" ref={tableScrollRef}>
          <div className="grid w-max min-w-full grid-cols-[1fr_120px_140px] gap-3 border-b border-slate-200 bg-slate-100/80 p-3 text-xs font-bold tracking-wider text-slate-600">
            <SortHeaderCell label="User" k="user" sort={sort} onToggle={toggleSort} />
            <SortHeaderCell label="Admin" k="admin" sort={sort} onToggle={toggleSort} />
            <SortHeaderCell label="Superadmin" k="superadmin" sort={sort} onToggle={toggleSort} />
          </div>
          <div className="divide-y divide-slate-200">
            {displayItems.map((u) => (
              <div key={u.id} className="grid w-max min-w-full grid-cols-[1fr_120px_140px] gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
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
                      <div className="truncate text-sm font-extrabold text-slate-900">{u.username}</div>
                      <div className="truncate text-xs font-semibold text-slate-600">{u.email}</div>
                    </div>
                  </div>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => toggleAdmin(u)}
                    disabled={saving}
                    className={[
                      "rounded-xl border px-3 py-2 text-xs font-bold",
                      u.isAdmin ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-700",
                      saving ? "opacity-60" : "",
                    ].join(" ")}
                  >
                    {u.isAdmin ? "On" : "Off"}
                  </button>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => toggleSuper(u)}
                    disabled={saving}
                    className={[
                      "rounded-xl border px-3 py-2 text-xs font-bold",
                      u.isSuperadmin ? "border-indigo-200 bg-indigo-50 text-indigo-950" : "border-slate-200 bg-white text-slate-700",
                      saving ? "opacity-60" : "",
                    ].join(" ")}
                  >
                    {u.isSuperadmin ? "On" : "Off"}
                  </button>
                </div>
              </div>
            ))}
            {!loading && items.length === 0 ? <div className="p-4 text-sm text-slate-600">No users found.</div> : null}
          </div>
        </div>
      </div>
      <FloatingHScrollbar scrollRef={tableScrollRef} deps={[items.length, q, limit, offset]} />

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

