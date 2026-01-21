import { useEffect, useState } from "react";
import { adminFetchUsers, adminSetAdmin, adminSetSuperadmin, type AdminUser } from "../../api";
import { useAuth } from "../../auth";

export default function AdminUserPrivilegesPage() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isSuper = Boolean(user?.isSuperadmin);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminFetchUsers({ query: q.trim() ? q.trim() : undefined, limit: 50, offset: 0 });
      setItems(res.items);
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

  async function toggleAdmin(u: AdminUser) {
    await adminSetAdmin(u.id, !u.isAdmin);
    setItems((prev) => prev.map((x) => (x.id === u.id ? { ...x, isAdmin: !u.isAdmin } : x)));
  }

  async function toggleSuper(u: AdminUser) {
    await adminSetSuperadmin(u.id, !u.isSuperadmin);
    setItems((prev) =>
      prev.map((x) =>
        x.id === u.id
          ? { ...x, isSuperadmin: !u.isSuperadmin, isAdmin: !u.isSuperadmin ? true : x.isAdmin }
          : x
      )
    );
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900">User privileges</div>
          <div className="mt-1 text-sm text-slate-600">Superadmin: manage admin/superadmin roles.</div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              load();
            }}
            placeholder="Search…"
            className="w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
          />
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            Search
          </button>
        </div>
      </div>

      {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[1fr_120px_140px] gap-3 border-b border-slate-200 p-4 text-xs font-bold text-slate-600">
          <div>User</div>
          <div>Admin</div>
          <div>Superadmin</div>
        </div>
        <div className="divide-y divide-slate-200">
          {items.map((u) => (
            <div key={u.id} className="grid grid-cols-[1fr_120px_140px] gap-3 p-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-extrabold text-slate-900">{u.username}</div>
                <div className="truncate text-xs font-semibold text-slate-600">{u.email}</div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => toggleAdmin(u)}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs font-bold",
                    u.isAdmin ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-700",
                  ].join(" ")}
                >
                  {u.isAdmin ? "On" : "Off"}
                </button>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => toggleSuper(u)}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs font-bold",
                    u.isSuperadmin ? "border-indigo-200 bg-indigo-50 text-indigo-950" : "border-slate-200 bg-white text-slate-700",
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
  );
}

