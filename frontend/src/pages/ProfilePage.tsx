import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil } from "lucide-react";
import Header from "../components/Header";
import { LocationTypeaheadAU } from "../components/LocationTypeaheadAU";
import {
  deleteAccount,
  deleteProfileAvatar,
  fetchProfile,
  resolveImageUrl,
  updateProfile,
  uploadProfileAvatar,
  type ProfileResponse,
} from "../api";
import { useAuth } from "../auth";

const API_BASE = (import.meta as any).env?.VITE_API_URL?.toString().trim() || "http://localhost:3001";

function normNullable(s: string): string | null {
  const t = String(s ?? "").trim();
  return t ? t : null;
}

export default function ProfilePage() {
  const MAX_AVATAR_MB = 4;
  const MAX_BIO_LEN = 200;
  const nav = useNavigate();
  const { user, loading: authLoading, refresh } = useAuth();

  const [data, setData] = useState<ProfileResponse | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [bio, setBio] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarErr, setAvatarErr] = useState<string | null>(null);
  const [avatarDraftFile, setAvatarDraftFile] = useState<File | null>(null);
  const [avatarDraftUrl, setAvatarDraftUrl] = useState<string>("");
  const [avatarRemovePending, setAvatarRemovePending] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const [emailOpen, setEmailOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailDraftPassword, setEmailDraftPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailErr, setEmailErr] = useState<string | null>(null);

  const initialFocusRef = useRef<HTMLInputElement | null>(null);
  const emailFocusRef = useRef<HTMLInputElement | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);

  const avatarPreview = useMemo(() => {
    const effective =
      avatarRemovePending ? "" : avatarDraftUrl ? avatarDraftUrl : normNullable(avatarUrl) ? String(avatarUrl) : "";
    const u = normNullable(effective);
    return resolveImageUrl(u ?? "") ?? u;
  }, [avatarDraftUrl, avatarRemovePending, avatarUrl]);

  useEffect(() => {
    return () => {
      if (avatarDraftUrl) URL.revokeObjectURL(avatarDraftUrl);
    };
  }, [avatarDraftUrl]);

  function DefaultAvatar({ sizeClassName }: { sizeClassName: string }) {
    return (
      <div
        className={[
          "grid place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-600",
          sizeClassName,
        ].join(" ")}
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M20 21a8 8 0 0 0-16 0" />
          <circle cx="12" cy="8" r="4" />
        </svg>
      </div>
    );
  }

  function stageAvatarFile(file: File) {
    setAvatarErr(null);
    if (!file) return;
    if (!file.type?.startsWith("image/")) {
      setAvatarErr("Please choose an image file.");
      return;
    }
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
      setAvatarErr(`Image must be ≤ ${MAX_AVATAR_MB}MB.`);
      return;
    }

    if (avatarDraftUrl) URL.revokeObjectURL(avatarDraftUrl);
    setAvatarDraftUrl(URL.createObjectURL(file));
    setAvatarDraftFile(file);
    setAvatarRemovePending(false);
  }

  function stageAvatarRemove() {
    setAvatarErr(null);
    if (avatarDraftUrl) URL.revokeObjectURL(avatarDraftUrl);
    setAvatarDraftUrl("");
    setAvatarDraftFile(null);
    setAvatarRemovePending(true);
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      nav(`/auth?next=${encodeURIComponent("/profile")}&ctx=profile`);
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
        setFirstName(res.account.firstName ?? "");
        setLastName(res.account.lastName ?? "");
        setEmailOpen(false);
        setEmailErr(null);
        setEmailDraft(res.user.email ?? "");
        setEmailDraftPassword("");
        setAvatarUrl(res.profile.avatarUrl ?? "");
        setLocation(res.profile.location ?? "");
        setPhone(res.profile.phone ?? "");
        setWebsite(res.profile.website ?? "");
        setBio(res.profile.bio ?? "");
        setAvatarErr(null);
        if (avatarDraftUrl) URL.revokeObjectURL(avatarDraftUrl);
        setAvatarDraftUrl("");
        setAvatarDraftFile(null);
        setAvatarRemovePending(false);
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
    const hasGoogle = Boolean(data?.authMethods?.hasGoogle);
    const hasPassword = Boolean(data?.authMethods?.hasPassword);
    const isGoogleOnly = hasGoogle && !hasPassword;
    if (!isGoogleOnly) window.setTimeout(() => initialFocusRef.current?.focus(), 0);
  }, [deleteOpen, data, user]);

  useEffect(() => {
    if (!deleteOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDeleteOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteOpen]);

  useEffect(() => {
    if (!emailOpen) return;
    setEmailErr(null);
    setEmailDraft("");
    setEmailDraftPassword("");
    window.setTimeout(() => emailFocusRef.current?.focus(), 0);
  }, [emailOpen]);

  useEffect(() => {
    if (!emailOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setEmailOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [emailOpen]);

  useEffect(() => {
    if (!emailOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [emailOpen]);

  useEffect(() => {
    if (!deleteOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [deleteOpen]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSavedMsg(null);
    setAvatarErr(null);

    if (!isDirty) return;

    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn) {
      setErr("First name is required.");
      return;
    }
    if (!ln) {
      setErr("Last name is required.");
      return;
    }

    setLoading(true);
    try {
      const resProfile = await updateProfile({
        firstName: fn,
        lastName: ln,
        location: normNullable(location),
        phone: normNullable(phone),
        website: normNullable(website),
        bio: normNullable(bio),
      });
      setData(resProfile);
      setFirstName(resProfile.account.firstName ?? "");
      setLastName(resProfile.account.lastName ?? "");
      setEmailDraft(resProfile.user.email ?? "");

      let finalRes: ProfileResponse = resProfile;

      // Apply staged avatar changes only when saving
      if (avatarRemovePending && normNullable(resProfile.profile.avatarUrl ?? "")) {
        setAvatarBusy(true);
        try {
          finalRes = await deleteProfileAvatar();
          setData(finalRes);
          setAvatarUrl(finalRes.profile.avatarUrl ?? "");
          setAvatarRemovePending(false);
        } finally {
          setAvatarBusy(false);
        }
      } else if (avatarDraftFile) {
        setAvatarBusy(true);
        try {
          finalRes = await uploadProfileAvatar(avatarDraftFile);
          setData(finalRes);
          setAvatarUrl(finalRes.profile.avatarUrl ?? "");
          if (avatarDraftUrl) URL.revokeObjectURL(avatarDraftUrl);
          setAvatarDraftUrl("");
          setAvatarDraftFile(null);
          setAvatarRemovePending(false);
        } finally {
          setAvatarBusy(false);
        }
      }

      // Sync other profile fields from final response (in case avatar endpoints returned fresher data)
      setFirstName(finalRes.account.firstName ?? "");
      setLastName(finalRes.account.lastName ?? "");
      setLocation(finalRes.profile.location ?? "");
      setPhone(finalRes.profile.phone ?? "");
      setWebsite(finalRes.profile.website ?? "");
      setBio(finalRes.profile.bio ?? "");

      setSavedMsg("Saved.");
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save profile");
    } finally {
      setLoading(false);
      window.setTimeout(() => setSavedMsg(null), 2000);
    }
  }

  async function onConfirmEmailChange() {
    setEmailErr(null);
    if (emailBusy) return;

    const currentEmail = String(data?.user.email ?? user?.email ?? "").trim().toLowerCase();
    const nextEmail = String(emailDraft ?? "").trim().toLowerCase();

    if (!nextEmail) {
      setEmailErr("Email is required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      setEmailErr("Please enter a valid email address.");
      return;
    }
    if (currentEmail && nextEmail === currentEmail) {
      setEmailErr("This is already your current email address.");
      return;
    }
    if (!emailDraftPassword.trim()) {
      setEmailErr("Password is required to change your email.");
      return;
    }

    setEmailBusy(true);
    try {
      const resProfile = await updateProfile({ email: nextEmail, password: emailDraftPassword });
      setData(resProfile);
      setEmailDraft(resProfile.user.email ?? "");
      setEmailDraftPassword("");
      setEmailOpen(false);
      await refresh();
      setSavedMsg("Saved.");
      window.setTimeout(() => setSavedMsg(null), 2000);
    } catch (e: any) {
      const status = typeof e?.status === "number" ? Number(e.status) : null;
      const raw = String(e?.message ?? "");
      // Make password errors user-friendly
      if (status === 403) {
        setEmailErr("Incorrect password.");
      } else {
        setEmailErr(raw || "Failed to update email");
      }
    } finally {
      setEmailBusy(false);
    }
  }

  async function onConfirmDelete() {
    setDeleteErr(null);

    const hasGoogle = Boolean(data?.authMethods?.hasGoogle);
    const hasPassword = Boolean(data?.authMethods?.hasPassword);
    const isGoogleOnly = hasGoogle && !hasPassword;

    if (isGoogleOnly) {
      window.location.href = `${API_BASE}/api/auth/oauth/google/delete-account/start`;
      return;
    }
    if (!deletePassword.trim()) {
      setDeleteErr("Password is required.");
      return;
    }

    setDeleteLoading(true);
    try {
      await deleteAccount({ password: deletePassword });
      setDeleteOpen(false);
      await refresh();
      nav("/");
    } catch (e: any) {
      const status = typeof e?.status === "number" ? Number(e.status) : null;
      const raw = String(e?.message ?? "");
      if (status === 403) setDeleteErr("Incorrect password.");
      else setDeleteErr(raw || "Failed to delete account");
    } finally {
      setDeleteLoading(false);
    }
  }

  const readOnlyEmail = data?.user.email ?? user?.email ?? "";
  const readOnlyUsername = data?.user.username ?? user?.username ?? "";
  const canChangeEmail = Boolean(data?.authMethods?.hasPassword);

  const deleteButtonDisabled = deleteLoading || loading || authLoading || !user;

  const isDirty = useMemo(() => {
    if (!data) return false;
    const baseFirst = data.account.firstName ?? "";
    const baseLast = data.account.lastName ?? "";
    const baseLoc = data.profile.location ?? "";
    const basePhone = data.profile.phone ?? "";
    const baseWeb = data.profile.website ?? "";
    const baseBio = data.profile.bio ?? "";
    const baseAvatar = data.profile.avatarUrl ?? "";

    if (firstName !== baseFirst) return true;
    if (lastName !== baseLast) return true;
    if (location !== baseLoc) return true;
    if (phone !== basePhone) return true;
    if (website !== baseWeb) return true;
    if (bio !== baseBio) return true;

    if (avatarDraftFile) return true;
    if (avatarRemovePending && normNullable(baseAvatar)) return true;
    return false;
  }, [avatarDraftFile, avatarRemovePending, bio, data, firstName, lastName, location, phone, website]);

  return (
    <div className="min-h-full">
      <Header maxWidth="7xl" />
      <main className="mx-auto max-w-7xl px-4 py-6">
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
                <div className="mb-1 text-xs font-semibold text-slate-700">First name</div>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                  maxLength={80}
                  disabled={loading}
                  autoComplete="given-name"
                  required
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Last name</div>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                  maxLength={80}
                  disabled={loading}
                  autoComplete="family-name"
                  required
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-700">Email</div>
                <div className="flex items-stretch gap-2">
                  <input
                    value={readOnlyEmail}
                    readOnly
                    className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    disabled={loading || emailBusy}
                    autoComplete="email"
                  />
                  {canChangeEmail ? (
                    <button
                      type="button"
                      onClick={() => setEmailOpen(true)}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
                      disabled={loading || emailBusy}
                      aria-label="Change email"
                      title="Change email"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
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
                <div className="block sm:col-span-2">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Avatar</div>
                  <div className="flex items-center gap-3">
                    {avatarPreview ? (
                      <img
                        src={avatarPreview}
                        alt="Avatar"
                        className="h-[84px] w-[84px] rounded-full border border-slate-200 object-cover"
                      />
                    ) : (
                      <DefaultAvatar sizeClassName="h-[84px] w-[84px]" />
                    )}

                    <input
                      ref={avatarFileInputRef}
                      type="file"
                      accept="image/*"
                      disabled={loading || avatarBusy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.currentTarget.value = "";
                        if (f) stageAvatarFile(f);
                      }}
                      className="hidden"
                    />

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setAvatarErr(null);
                          avatarFileInputRef.current?.click();
                        }}
                        disabled={loading || avatarBusy}
                        className="grid h-10 w-10 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        aria-label="Upload or replace avatar"
                        title="Upload / replace"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-5 w-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M12 16V4" />
                          <path d="M7 9l5-5 5 5" />
                          <path d="M4 20h16" />
                        </svg>
                      </button>

                      <button
                        type="button"
                        onClick={() => stageAvatarRemove()}
                        disabled={loading || avatarBusy || avatarRemovePending || (!normNullable(avatarUrl) && !avatarDraftFile)}
                        className="grid h-10 w-10 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        aria-label="Remove avatar"
                        title="Remove"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-5 w-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M4 7h16" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                          <path d="M9 7l1-2h4l1 2" />
                          <path d="M6 7l1 14h10l1-14" />
                        </svg>
                      </button>
                    </div>

                    <div className="min-w-0 text-[11px] font-semibold text-slate-500">
                      JPG/PNG/WebP up to {MAX_AVATAR_MB}MB.
                    </div>
                  </div>

                  {avatarErr && (
                    <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                      {avatarErr}
                    </div>
                  )}
                </div>

                <label className="block">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Location</div>
                  <LocationTypeaheadAU value={location} onChange={setLocation} disabled={loading} debounceMs={220} />
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
                    maxLength={MAX_BIO_LEN}
                    disabled={loading}
                  />
                  <div className="mt-1 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                    <div>
                      {bio.length}/{MAX_BIO_LEN}
                    </div>
                  </div>
                </label>
              </div>

              {isDirty && (
                <div className="mt-5 flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={loading || authLoading || !user}
                    className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {loading ? "Saving..." : "Save changes"}
                  </button>

                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      if (!data) return;
                      setFirstName(data.account.firstName ?? "");
                      setLastName(data.account.lastName ?? "");
                      setAvatarUrl(data.profile.avatarUrl ?? "");
                      setLocation(data.profile.location ?? "");
                      setPhone(data.profile.phone ?? "");
                      setWebsite(data.profile.website ?? "");
                      setBio(data.profile.bio ?? "");
                      setErr(null);
                      setAvatarErr(null);
                      if (avatarDraftUrl) URL.revokeObjectURL(avatarDraftUrl);
                      setAvatarDraftUrl("");
                      setAvatarDraftFile(null);
                      setAvatarRemovePending(false);
                      setSavedMsg(null);
                    }}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Reset
                  </button>
                </div>
              )}

              <div className="mt-8 border-t border-slate-100 pt-6">
                <div className="text-sm font-bold text-slate-900">Delete account</div>
                <div className="mt-2 text-sm text-slate-600">
                  Permanently delete you account.
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
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt="Avatar preview"
                  className="h-[84px] w-[84px] rounded-full border border-slate-200 object-cover"
                />
              ) : (
                <DefaultAvatar sizeClassName="h-[84px] w-[84px]" />
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-extrabold text-slate-900">@{readOnlyUsername || "username"}</div>
                <div className="truncate text-xs font-semibold text-slate-600">
                  {location.trim() || "Location"}
                </div>
              </div>
            </div>

            <div className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-xs text-slate-700">
              {bio.trim() || "Your bio will appear here."}
            </div>
          </aside>
        </form>
      </main>

      {emailOpen && canChangeEmail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Change email"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setEmailOpen(false);
          }}
        >
          <div className="w-full max-w-md max-h-[85dvh] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="text-base font-extrabold text-slate-900">Change email</div>
              <div className="mt-1 text-sm text-slate-600">Enter your new email and your password to confirm.</div>
            </div>

            <form
              className="px-5 py-4"
              onSubmit={(e) => {
                e.preventDefault();
                onConfirmEmailChange();
              }}
            >
              {emailErr && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
                  {emailErr}
                </div>
              )}

              <div className="grid gap-3">
                <label className="block">
                  <div className="mb-1 text-xs font-semibold text-slate-700">New email</div>
                  <input
                    ref={emailFocusRef}
                    type="email"
                    required
                    value={emailDraft}
                    onChange={(e) => setEmailDraft(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    autoComplete="email"
                    disabled={emailBusy}
                  />
                </label>

                <label className="block">
                  <div className="mb-1 text-xs font-semibold text-slate-700">Password</div>
                  <input
                    type="password"
                    value={emailDraftPassword}
                    onChange={(e) => setEmailDraftPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    autoComplete="current-password"
                    disabled={emailBusy}
                  />
                </label>
              </div>

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEmailOpen(false)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-50"
                  disabled={emailBusy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
                  disabled={emailBusy || !emailDraft.trim()}
                >
                  {emailBusy ? "Saving..." : "Update email"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
          <form
            className="w-full max-w-md max-h-[85dvh] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xl"
            onSubmit={(e) => {
              e.preventDefault();
              onConfirmDelete();
            }}
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="text-base font-extrabold text-slate-900">Confirm account deletion</div>
              {Boolean(data?.authMethods?.hasGoogle) && !Boolean(data?.authMethods?.hasPassword) ? null : (
                <div className="mt-1 text-sm text-slate-600">Enter your password to permanently delete your account.</div>
              )}
            </div>

            <div className="px-5 py-4">
              {deleteErr && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
                  {deleteErr}
                </div>
              )}

              <div className="grid gap-3">
                {Boolean(data?.authMethods?.hasGoogle) && !Boolean(data?.authMethods?.hasPassword) ? null : (
                  <label className="block">
                    <div className="mb-1 text-xs font-semibold text-slate-700">Password</div>
                    <input
                      ref={initialFocusRef}
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                      type="password"
                      autoComplete="current-password"
                      disabled={deleteLoading}
                    />
                  </label>
                )}

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
                type="submit"
                disabled={deleteLoading}
                className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleteLoading ? "Deleting..." : "Delete account"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
