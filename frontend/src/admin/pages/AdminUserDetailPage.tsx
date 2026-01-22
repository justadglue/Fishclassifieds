import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { adminDeleteUserAccount, adminGetUser, adminRevokeUserSessions, adminSetUserModeration, resolveImageUrl, type AdminUserDetail } from "../../api";
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

function normUrl(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `https://${s}`;
}

function DefaultAvatar({ sizeClassName }: { sizeClassName: string }) {
  return (
    <div className={["grid place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-600", sizeClassName].join(" ")}>
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M20 21a8 8 0 0 0-16 0" />
        <circle cx="12" cy="8" r="4" />
      </svg>
    </div>
  );
}

export default function AdminUserDetailPage() {
  const { id } = useParams();
  const { user: me } = useAuth();
  const [data, setData] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [modDraftAction, setModDraftAction] = useState<null | "restore" | "suspend" | "ban" | "revokeSessions" | "deleteAccount">(null);
  const [modDraftReason, setModDraftReason] = useState("");
  const [modDraftSuspendPreset, setModDraftSuspendPreset] = useState<
    "1" | "3" | "7" | "14" | "30" | "90" | "365" | "indefinite" | "custom"
  >("7");
  const [modDraftSuspendCustomDays, setModDraftSuspendCustomDays] = useState<string>("");
  const [modDraftDeleteReason, setModDraftDeleteReason] = useState("");

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
  const profile = data?.profile ?? null;
  const avatarSrc = (() => {
    const raw = profile?.avatarUrl ? String(profile.avatarUrl) : "";
    if (!raw) return null;
    return resolveImageUrl(raw) ?? raw;
  })();
  const websiteHref = normUrl(profile?.website ?? null);
  const showProfileTimestamps = (() => {
    // "Account" timestamps (users table) vs "Profile" timestamps (user_profiles table) can differ.
    const acctCreated = u?.createdAt ?? null;
    const acctUpdated = u?.updatedAt ?? null;
    const profCreated = profile?.createdAt ?? null;
    const profUpdated = profile?.updatedAt ?? null;
    if (!profCreated && !profUpdated) return false;
    // If they exactly match the account timestamps, it's redundant.
    if (profCreated === acctCreated && profUpdated === acctUpdated) return false;
    return true;
  })();

  const currentModStatus = (mod?.status ?? "active") as "active" | "suspended" | "banned";

  useEffect(() => {
    // Initialize draft state from current moderation when user changes / reloads.
    const reason = mod?.reason ?? "";
    setModDraftReason(reason);
    // Do not auto-select an action; require explicit user choice.
    setModDraftAction(null);
    setModDraftDeleteReason("");
    setModDraftSuspendCustomDays("");

    const until = mod?.status === "suspended" ? (mod.suspendedUntil ?? null) : null;
    if (until == null) {
      setModDraftSuspendPreset("7");
    } else {
      const days = Math.max(1, Math.ceil((until - Date.now()) / (24 * 60 * 60 * 1000)));
      const opts = [1, 3, 7, 14, 30, 90, 365];
      const nearest = opts.reduce((best, n) => (Math.abs(n - days) < Math.abs(best - days) ? n : best), 7);
      setModDraftSuspendPreset(String(nearest) as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, mod?.status, mod?.reason, mod?.suspendedUntil]);

  const isModDraftDirty = (() => {
    if (!u) return false;
    const curReason = (mod?.reason ?? "").trim();
    const draftReason = modDraftReason.trim();
    // No action selected => nothing to apply.
    if (modDraftAction == null) return false;

    if (modDraftAction === "restore") {
      return currentModStatus !== "active";
    }

    if (modDraftAction === "revokeSessions") {
      return true;
    }

    if (modDraftAction === "deleteAccount") {
      return isSuper;
    }

    // suspend/ban: reason change (or any other change) counts
    if (draftReason !== curReason) return true;

    if (modDraftAction === "ban") return currentModStatus !== "banned";

    // suspend
    if (modDraftSuspendPreset === "custom") {
      const raw = modDraftSuspendCustomDays.trim();
      const days = Math.floor(Number(raw));
      // Don't enable Apply until the custom duration is valid.
      if (!raw || !Number.isFinite(days) || days < 1 || days > 3650) return false;
    }
    if (currentModStatus !== "suspended") return true;
    const curUntil = mod?.status === "suspended" ? (mod.suspendedUntil ?? null) : null;
    if (curUntil == null && modDraftSuspendPreset !== "indefinite") return true;
    if (curUntil != null && modDraftSuspendPreset === "indefinite") return true;
    return false;
  })();

  async function applyModerationDraft() {
    if (!u) return;
    setErr(null);

    if (modDraftAction == null) return;

    if (modDraftAction === "restore") {
      await adminSetUserModeration(u.id, { status: "active" });
      await load();
      setModDraftAction(null);
      return;
    }

    if (modDraftAction === "revokeSessions") {
      const ok = window.confirm("Revoke all sessions for this user (force logout everywhere)?");
      if (!ok) return;
      await adminRevokeUserSessions(u.id);
      await load();
      setModDraftAction(null);
      return;
    }

    if (modDraftAction === "deleteAccount") {
      if (!isSuper) return;
      const ok = window.confirm("Permanently delete this account? This cannot be undone.");
      if (!ok) return;
      const reason = modDraftDeleteReason.trim() ? modDraftDeleteReason.trim() : undefined;
      await adminDeleteUserAccount(u.id, reason);
      window.location.href = "/admin/users";
      return;
    }

    const reason = modDraftReason.trim() ? modDraftReason.trim() : null;

    if (modDraftAction === "ban") {
      const ok = window.confirm("Ban this user? This will revoke their sessions immediately.");
      if (!ok) return;
      await adminSetUserModeration(u.id, { status: "banned", reason });
      await load();
      setModDraftAction(null);
      return;
    }

    // suspend
    let until: number | null = null;
    if (modDraftSuspendPreset === "indefinite") {
      until = null;
    } else if (modDraftSuspendPreset === "custom") {
      const raw = modDraftSuspendCustomDays.trim();
      const days = Math.max(1, Math.min(3650, Math.floor(Number(raw))));
      if (!raw || !Number.isFinite(days)) {
        setErr("Enter a valid custom suspension duration in days (1–3650).");
        return;
      }
      until = Date.now() + days * 24 * 60 * 60 * 1000;
    } else {
      until = Date.now() + Number(modDraftSuspendPreset) * 24 * 60 * 60 * 1000;
    }
    await adminSetUserModeration(u.id, { status: "suspended", reason, suspendedUntil: until });
    await load();
    setModDraftAction(null);
  }

  function cancelModerationDraft() {
    setModDraftReason(mod?.reason ?? "");
    setModDraftAction(null);
    setModDraftDeleteReason("");
    setModDraftSuspendCustomDays("");
    const until = mod?.status === "suspended" ? (mod.suspendedUntil ?? null) : null;
    if (until == null) setModDraftSuspendPreset("7");
    else {
      const days = Math.max(1, Math.ceil((until - Date.now()) / (24 * 60 * 60 * 1000)));
      const opts = [1, 3, 7, 14, 30, 90, 365];
      const nearest = opts.reduce((best, n) => (Math.abs(n - days) < Math.abs(best - days) ? n : best), 7);
      setModDraftSuspendPreset(String(nearest) as any);
    }
  }

  // Moderation changes are applied via the draft UI + Apply button.

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
            <div className="rounded-2xl border border-slate-200 bg-linear-to-br from-slate-50 to-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  {avatarSrc ? (
                    <img
                      src={avatarSrc}
                      alt={`${u!.username} avatar`}
                      className="h-14 w-14 rounded-full border border-slate-200 object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <DefaultAvatar sizeClassName="h-14 w-14" />
                  )}

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-lg font-extrabold text-slate-900">
                        {u!.firstName} {u!.lastName}
                      </div>
                      {u!.isSuperadmin ? (
                        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-800">Superadmin</span>
                      ) : u!.isAdmin ? (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-bold text-slate-700">Admin</span>
                      ) : null}
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-bold text-slate-700">ID {u!.id}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-slate-700">
                      <span className="truncate">@{u!.username}</span>
                      <a className="truncate underline underline-offset-4 hover:text-slate-900" href={`mailto:${u!.email}`}>
                        {u!.email}
                      </a>
                    </div>
                  </div>
                </div>

                <div className="min-w-[180px] text-right text-xs font-semibold text-slate-600">
                  <div className="text-[11px] font-extrabold tracking-wide text-slate-500">ACCOUNT</div>
                  <div>Created: {fmtIso(u!.createdAt) || "—"}</div>
                  <div>Updated: {fmtIso(u!.updatedAt) || "—"}</div>
                  <div>Last active: {fmtIso(u!.lastActiveAt) || "—"}</div>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-extrabold text-slate-700">Profile</div>
                <div className="mt-2 grid gap-2 text-sm text-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-600">Location</span>
                    <span className="font-semibold">{profile?.location ?? "—"}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-600">Phone</span>
                    {profile?.phone ? (
                      <a className="font-semibold underline underline-offset-4 hover:text-slate-900" href={`tel:${profile.phone}`}>
                        {profile.phone}
                      </a>
                    ) : (
                      <span className="font-semibold">—</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-600">Website</span>
                    {websiteHref ? (
                      <a className="max-w-[220px] truncate font-semibold underline underline-offset-4 hover:text-slate-900" href={websiteHref} target="_blank" rel="noreferrer">
                        {profile?.website}
                      </a>
                    ) : (
                      <span className="font-semibold">—</span>
                    )}
                  </div>
                  <div className="mt-1">
                    <div className="text-xs font-bold text-slate-600">Bio</div>
                    <div className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-800">{profile?.bio?.trim() ? profile.bio : "—"}</div>
                  </div>
                  {showProfileTimestamps ? (
                    <div className="mt-2 text-xs font-semibold text-slate-600">
                      <span className="font-bold">Profile record</span>: created {fmtIso(profile?.createdAt) || "—"} • updated {fmtIso(profile?.updatedAt) || "—"}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-extrabold text-slate-700">Stats</div>
                <div className="mt-2 grid gap-2 text-sm text-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-600">Listings</span>
                    <span className="font-semibold">
                      {data.stats.listings.total} total (active {data.stats.listings.active}, pending {data.stats.listings.pending}, deleted {data.stats.listings.deleted})
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-600">Types</span>
                    <span className="font-semibold">
                      Sale {data.stats.listings.saleTotal} • Wanted {data.stats.listings.wantedTotal}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-600">Sessions</span>
                    <span className="font-semibold">
                      {data.stats.sessions.total} total • {data.stats.sessions.active} active
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-600">Reports</span>
                    <span className="font-semibold">{data.stats.reports.reportedByUser} made</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-extrabold text-slate-900">Moderation</div>
                <div className="mt-1 text-xs font-semibold text-slate-600">Account controls</div>
              </div>

              {(() => {
                const s = mod?.status ?? "active";
                const cls =
                  s === "active"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : s === "banned"
                      ? "border-red-200 bg-red-50 text-red-900"
                      : "border-amber-200 bg-amber-50 text-amber-900";
                const label = s === "active" ? "Active" : s === "banned" ? "Banned" : "Suspended";
                return <div className={["rounded-full border px-3 py-1 text-xs font-extrabold", cls].join(" ")}>{label}</div>;
              })()}
            </div>

            <div className="mt-4 grid gap-3">
              {mod?.status === "suspended" ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <div className="text-xs font-extrabold text-amber-900">Suspension</div>
                  <div className="mt-1 text-sm font-semibold">
                    Until: <span className="font-extrabold">{fmtUntil(mod.suspendedUntil) || "—"}</span>
                  </div>
                </div>
              ) : null}

              {mod?.reason ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-900">
                  <div className="text-xs font-extrabold text-slate-700">Reason</div>
                  <div className="mt-1 whitespace-pre-wrap text-sm font-semibold">{mod.reason}</div>
                </div>
              ) : null}

              <div className="text-xs font-semibold text-slate-600">
                <span className="font-extrabold text-slate-700">Last updated:</span> {mod?.updatedAt ? fmtIso(mod.updatedAt) : "—"}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid gap-2">
                <div className="text-xs font-extrabold text-slate-700">Actions</div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-extrabold text-slate-700">Select action</div>
                    </div>
                  </div>

                  <div className="mt-2">
                    <select
                      value={modDraftAction ?? ""}
                      onChange={(e) => setModDraftAction((e.target.value ? (e.target.value as any) : null) as any)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                    >
                      <option value="">Choose…</option>
                      {currentModStatus !== "active" ? <option value="restore">Restore account</option> : null}
                      {currentModStatus === "active" ? <option value="suspend">Suspend</option> : null}
                      {currentModStatus === "active" ? <option value="ban">Ban</option> : null}
                      {currentModStatus === "active" ? <option value="revokeSessions">Revoke sessions (log out)</option> : null}
                      {isSuper ? <option value="deleteAccount">Delete account</option> : null}
                    </select>
                  </div>

                  {modDraftAction === "suspend" ? (
                    <div className="mt-3">
                      <div className="text-xs font-bold text-slate-600">Duration</div>
                      <select
                        value={modDraftSuspendPreset}
                        onChange={(e) => setModDraftSuspendPreset(e.target.value as any)}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                      >
                        <option value="1">1 day</option>
                        <option value="3">3 days</option>
                        <option value="7">7 days</option>
                        <option value="14">14 days</option>
                        <option value="30">30 days</option>
                        <option value="90">90 days</option>
                        <option value="365">365 days</option>
                        <option value="indefinite">Indefinite</option>
                        <option value="custom">Custom…</option>
                      </select>
                      {modDraftSuspendPreset === "custom" ? (
                        <div className="mt-2">
                          <div className="text-xs font-bold text-slate-600">Custom days</div>
                          <input
                            value={modDraftSuspendCustomDays}
                            onChange={(e) => setModDraftSuspendCustomDays(e.target.value)}
                            inputMode="numeric"
                            placeholder="e.g. 10"
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                          />
                          <div className="mt-1 text-[11px] font-semibold text-slate-600">Enter days (1–3650).</div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {modDraftAction === "suspend" || modDraftAction === "ban" ? (
                    <div className="mt-3">
                      <div className="text-xs font-bold text-slate-600">Reason (optional)</div>
                      <textarea
                        value={modDraftReason}
                        onChange={(e) => setModDraftReason(e.target.value)}
                        placeholder="Visible to the user"
                        className="mt-1 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                        rows={2}
                      />
                    </div>
                  ) : null}

                  {modDraftAction === "deleteAccount" ? (
                    <div className="mt-3">
                      <div className="text-xs font-bold text-red-700">Deletion reason</div>
                      <textarea
                        value={modDraftDeleteReason}
                        onChange={(e) => setModDraftDeleteReason(e.target.value)}
                        placeholder="Stored in audit log"
                        className="mt-1 w-full resize-y rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-red-300"
                        rows={2}
                      />
                      <div className="mt-1 text-[11px] font-semibold text-red-700">Permanent and cannot be undone.</div>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={cancelModerationDraft}
                      disabled={modDraftAction == null}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={applyModerationDraft}
                      disabled={!isModDraftDirty}
                      className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

