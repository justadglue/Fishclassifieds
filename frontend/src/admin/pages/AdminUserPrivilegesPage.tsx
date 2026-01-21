import { useEffect, useMemo, useRef, useState } from "react";
import { adminFetchUsers, adminSetAdmin, adminSetSuperadmin, authReauth, type AdminUser } from "../../api";
import { useAuth } from "../../auth";

export default function AdminUserPrivilegesPage() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
  );
}

