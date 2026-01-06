import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { deleteAccount, fetchProfile, resolveImageUrl, updateProfile, type ProfileResponse } from "../api";
import { useAuth } from "../auth";

function normNullable(s: string): string | null {
  const t = String(s ?? "").trim();
  return t ? t : null;
}

export default function ProfilePage() {
  const nav = useNavigate();
  const { user, loading: authLoading, refresh } = useAuth();

  const [data, setData] = useState<ProfileResponse | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [bio, setBio] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteUsername, setDeleteUsername] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const initialFocusRef = useRef<HTMLInputElement | null>(null);

  const avatarPreview = useMemo(() => {
    const u = normNullable(avatarUrl);
    return resolveImageUrl(u ?? "") ?? u;
  }, [avatarUrl]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      nav("/login");
      return;
    }

    let cancelled = false;
    (async () => {
      setErr(null);
      setLoading(true);
      try {
        const res = await fetchProfile();
        if (cancelled) return;

        setData(res);
        setDisplayName(res.user.displayName ?? "");
        setAvatarUrl(res.profile.avatarUrl ?? "");
        setLocation(res.profile.location ?? "");
        setPhone(res.profile.phone ?? "");
        setWebsite(res.profile.website ?? "");
        setBio(res.profile.bio ?? "");
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, nav]);

  useEffect(() => {
    if (!deleteOpen) return;
    setDeleteErr(null);
    setDeletePassword("");
    const uname = (data?.user.username ?? user?.username ?? "").trim();
    setDeleteUsername(uname);
    window.setTimeout(() => initialFocusRef.current?.focus(), 0);
  }, [deleteOpen, data, user]);

  useEffect(() => {
    if (!deleteOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDeleteOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteOpen]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSavedMsg(null);

    const dn = displayName.trim();
    if (dn.length < 1) {
      setErr("Display name is required.");
      return;
    }

    setLoading(true);
    try {
      const res = await updateProfile({
        displayName: dn,
        avatarUrl: normNullable(avatarUrl),
        location: normNullable(location),
        phone: normNullable(phone),
        website: normNullable(website),
        bio: normNullable(bio),
      });
      setData(res);
      setSavedMsg("Saved.");
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save profile");
    } finally {
      setLoading(false);
      window.setTimeout(() => setSavedMsg(null), 2000);
    }
  }

  async function onConfirmDelete() {
    setDeleteErr(null);

    const expectedUsername = (data?.user.username ?? user?.username ?? "").trim().toLowerCase();
    const presentedUsername = deleteUsername.trim().toLowerCase();

    if (!expectedUsername) {
      setDeleteErr("Cannot verify username for deletion.");
      return;
    }
    if (presentedUsername !== expectedUsername) {
      setDeleteErr("Username does not match your account.");
      return;
    }
    if (!deletePassword.trim()) {
      setDeleteErr("Password is required.");
      return;
    }

    setDeleteLoading(true);
    try {
      await deleteAccount({ username: deleteUsername.trim(), password: deletePassword });
      setDeleteOpen(false);
      await refresh();
      nav("/");
    } catch (e: any) {
      setDeleteErr(e?.message ?? "Failed to delete account");
    } finally {
      setDeleteLoading(false);
    }
  }

  const readOnlyEmail = data?.user.email ?? user?.email ?? "";
  const readOnlyUsername = data?.user.username ?? user?.username ?? "";

  const deleteButtonDisabled = deleteLoading || loading || authLoading || !user;

  return (
    <div className="min-h-full">
      <Header maxWidth="5xl" />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">My profile</h1>
            <div className="mt-1 text-sm text-slate-600">Update your public-facing details.</div>
          </div>
          <button
            type="button"
            onClick={() => nav("/")}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
          >
            Back
          </button>
        </div>

        {err && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {err}
          </div>
        )}
        {savedMsg && (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
            {savedMsg}
          </div>
        )}

        <form onSubmit={onSave} className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-sm font-bold text-slate-900">Account</div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Email</div>
                <input
                  value={readOnlyEmail}
                  readOnly
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Username</div>
                <input
                  value={readOnlyUsername}
                  readOnly
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                />
              </label>
            </div>

            <div className="mt-5 border-t border-slate-100 pt-5">
              <div className="text-sm font-bold text-slate-900">Profile</div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Display name</div>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    maxLength={80}
                    required
                    disabled={loading}
                  />
                </label>

                <label className="block sm:col-span-2">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Avatar URL</div>
                  <input
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    maxLength={500}
                    disabled={loading}
                  />
                  <div className="mt-1 text-[11px] font-semibold text-slate-500">
                    If you later add avatar uploads, you can store the uploaded URL here.
                  </div>
                </label>

                <label className="block">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Location</div>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Brisbane"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    maxLength={120}
                    disabled={loading}
                  />
                </label>

                <label className="block">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Phone</div>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Optional"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    maxLength={40}
                    disabled={loading}
                  />
                </label>

                <label className="block sm:col-span-2">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Website</div>
                  <input
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    maxLength={300}
                    disabled={loading}
                  />
                </label>

                <label className="block sm:col-span-2">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Bio</div>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Tell buyers about yourself (pickup times, breeding experience, etc.)"
                    className="min-h-[140px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    maxLength={1000}
                    disabled={loading}
                  />
                </label>
              </div>

              <div className="mt-5 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={loading || authLoading || !user}
                  className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {loading ? "Saving..." : "Save profile"}
                </button>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    if (!data) return;
                    setDisplayName(data.user.displayName ?? "");
                    setAvatarUrl(data.profile.avatarUrl ?? "");
                    setLocation(data.profile.location ?? "");
                    setPhone(data.profile.phone ?? "");
                    setWebsite(data.profile.website ?? "");
                    setBio(data.profile.bio ?? "");
                    setErr(null);
                    setSavedMsg(null);
                  }}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
                >
                  Reset
                </button>
              </div>

              <div className="mt-8 border-t border-slate-100 pt-6">
                <div className="text-sm font-bold text-slate-900">Delete account</div>
                <div className="mt-2 text-sm text-slate-600">
                  This permanently deletes your account and logs you out.
                </div>

                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setDeleteOpen(true)}
                    disabled={deleteButtonDisabled}
                    className="rounded-2xl bg-red-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    Delete account
                  </button>
                </div>
              </div>
            </div>
          </section>

          <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-sm font-bold text-slate-900">Preview</div>

            <div className="mt-4 flex items-center gap-3">
              <div className="h-14 w-14 overflow-hidden rounded-2xl bg-slate-100">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs font-bold text-slate-500">No</div>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-extrabold text-slate-900">{displayName.trim() || "Your name"}</div>
                <div className="truncate text-xs font-semibold text-slate-600">
                  @{readOnlyUsername || "username"} • {location.trim() || "Location"}
                </div>
              </div>
            </div>

            <div className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-xs text-slate-700">
              {bio.trim() || "Your bio will appear here."}
            </div>

            <div className="mt-4 text-xs font-semibold text-slate-600">
              This data is saved server-side per user (not per device).
            </div>
          </aside>
        </form>
      </main>

      {deleteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Delete account"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDeleteOpen(false);
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="text-base font-extrabold text-slate-900">Confirm account deletion</div>
              <div className="mt-1 text-sm text-slate-600">
                Enter your username and password to permanently delete your account.
              </div>
            </div>

            <div className="px-5 py-4">
              {deleteErr && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
                  {deleteErr}
                </div>
              )}

              <div className="grid gap-3">
                <label className="block">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Username</div>
                  <input
                    ref={initialFocusRef}
                    value={deleteUsername}
                    onChange={(e) => setDeleteUsername(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    autoComplete="username"
                    disabled={deleteLoading}
                  />
                </label>

                <label className="block">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Password</div>
                  <input
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    type="password"
                    autoComplete="current-password"
                    disabled={deleteLoading}
                  />
                </label>

                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900/80">
                  This cannot be undone.
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleteLoading}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirmDelete}
                disabled={deleteLoading}
                className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleteLoading ? "Deleting..." : "Delete account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
