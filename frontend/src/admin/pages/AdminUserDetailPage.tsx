import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { adminDeleteUserAccount, adminGetUser, adminRevokeUserSessions, adminSetUserModeration, type AdminUserDetail } from "../../api";
import { useAuth } from "../../auth";

function fmtIso(iso: string | null | undefined) {
  if (!iso) return "";
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return String(iso);
  return new Date(t).toLocaleString();
}

function fmtUntil(ms: number | null) {
  if (ms == null) return "";
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString();
}

export default function AdminUserDetailPage() {
  const { id } = useParams();
  const { user: me } = useAuth();
  const [data, setData] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const userId = useMemo(() => {
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
  }, [id]);

  async function load(opts?: { silent?: boolean }) {
    if (userId == null) return;
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
      setErr(null);
    }
    try {
      const res = await adminGetUser(userId);
      setData(res);
    } catch (e: any) {
      if (!silent) setErr(e?.message ?? "Failed to load user");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const isSuper = Boolean(me?.isSuperadmin);
  const u = data?.user ?? null;
  const mod = data?.moderation ?? null;

  async function doSetStatus(status: "active" | "suspended" | "banned") {
    if (!u) return;
    if (status === "active") {
      await adminSetUserModeration(u.id, { status: "active" });
      await load();
      return;
    }

    const reason = (window.prompt("Reason (optional):") ?? "").trim();
    if (status === "suspended") {
      const daysRaw = window.prompt("Suspend for how many days? (blank for indefinite)", "7") ?? "";
      const days = daysRaw.trim() ? Math.max(1, Math.min(3650, Math.floor(Number(daysRaw)))) : null;
      const until = days == null || !Number.isFinite(days) ? null : Date.now() + days * 24 * 60 * 60 * 1000;
      await adminSetUserModeration(u.id, { status: "suspended", reason: reason || null, suspendedUntil: until });
      await load();
      return;
    }

    const ok = window.confirm("Ban this user? This will revoke their sessions immediately.");
    if (!ok) return;
    await adminSetUserModeration(u.id, { status: "banned", reason: reason || null });
    await load();
  }

  async function doRevokeSessions() {
    if (!u) return;
    const ok = window.confirm("Revoke all sessions for this user (force logout everywhere)?");
    if (!ok) return;
    await adminRevokeUserSessions(u.id);
    await load();
  }

  async function doDeleteAccount() {
    if (!u) return;
    if (!isSuper) return;
    const ok = window.confirm("Permanently delete this account? This cannot be undone.");
    if (!ok) return;
    const reason = (window.prompt("Deletion reason (optional):") ?? "").trim();
    await adminDeleteUserAccount(u.id, reason || undefined);
    // go back
    window.location.href = "/admin/users";
  }

  return (
    <div>
      <div className="mb-3">
        <Link to="/admin/users" className="text-xs font-bold text-slate-700 underline underline-offset-4 hover:text-slate-900">
          ← Back to users
        </Link>
      </div>

      {err ? <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div> : null}
      {!data ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">{loading ? "Loading…" : "No user loaded."}</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-extrabold text-slate-900">User</div>
            <div className="mt-2 grid gap-2 text-sm text-slate-700">
              <div>
                <span className="font-bold">Username:</span> {u!.username}
              </div>
              <div>
                <span className="font-bold">Email:</span> {u!.email}
              </div>
              <div>
                <span className="font-bold">Name:</span> {u!.firstName} {u!.lastName}
              </div>
              <div>
                <span className="font-bold">Created:</span> {fmtIso(u!.createdAt)}
              </div>
              <div>
                <span className="font-bold">Updated:</span> {fmtIso(u!.updatedAt)}
              </div>
              <div>
                <span className="font-bold">Last active:</span> {fmtIso(u!.lastActiveAt)}
              </div>
              <div className="mt-2 text-xs font-semibold text-slate-600">
                Listings: {data.stats.listings.total} (active {data.stats.listings.active}, pending {data.stats.listings.pending}, deleted {data.stats.listings.deleted}) •
                Sale {data.stats.listings.saleTotal} • Wanted {data.stats.listings.wantedTotal}
              </div>
              <div className="text-xs font-semibold text-slate-600">
                Sessions: {data.stats.sessions.total} total • {data.stats.sessions.active} active
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-extrabold text-slate-900">Moderation</div>
            <div className="mt-2 text-sm text-slate-700">
              <div>
                <span className="font-bold">Status:</span> {mod?.status ?? "active"}
              </div>
              {mod?.status === "suspended" ? (
                <div>
                  <span className="font-bold">Until:</span> {fmtUntil(mod.suspendedUntil)}
                </div>
              ) : null}
              {mod?.reason ? (
                <div className="mt-1">
                  <span className="font-bold">Reason:</span> {mod.reason}
                </div>
              ) : null}
              <div className="mt-1 text-xs font-semibold text-slate-600">
                Last moderation update: {mod?.updatedAt ? fmtIso(mod.updatedAt) : "—"}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => doSetStatus("active")}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50"
              >
                Set Active
              </button>
              <button
                type="button"
                onClick={() => doSetStatus("suspended")}
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100"
              >
                Suspend
              </button>
              <button
                type="button"
                onClick={() => doSetStatus("banned")}
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800 hover:bg-red-100"
              >
                Ban
              </button>
              <button
                type="button"
                onClick={doRevokeSessions}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50"
              >
                Revoke sessions
              </button>
              {isSuper ? (
                <button
                  type="button"
                  onClick={doDeleteAccount}
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800 hover:bg-red-100"
                >
                  Delete account
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

