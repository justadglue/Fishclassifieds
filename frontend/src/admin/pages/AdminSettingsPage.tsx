import { useEffect, useState } from "react";
import { adminGetSettings, adminUpdateSettings, type AdminSiteSettings } from "../../api";
import { useAuth } from "../../auth";

export default function AdminSettingsPage() {
  const { user } = useAuth();
  const isSuper = Boolean(user?.isSuperadmin);

  const [settings, setSettings] = useState<AdminSiteSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    setOk(false);
    try {
      const res = await adminGetSettings();
      setSettings(res.settings);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isSuper) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuper]);

  if (!isSuper) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="text-sm font-extrabold text-slate-900">Superadmin only</div>
        <div className="mt-1 text-sm text-slate-600">You don’t have permission to edit site settings.</div>
      </div>
    );
  }

  async function save() {
    if (!settings) return;
    setLoading(true);
    setErr(null);
    setOk(false);
    try {
      await adminUpdateSettings(settings);
      setOk(true);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save settings");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900">Site settings</div>
          <div className="mt-1 text-sm text-slate-600">Runtime settings stored in the database.</div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={save}
            disabled={loading || !settings}
            className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </div>

      {err ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div> : null}
      {ok ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">Saved.</div> : null}

      {!settings ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">{loading ? "Loading…" : "No settings loaded."}</div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-extrabold text-slate-900">Moderation</div>
            <label className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input
                type="checkbox"
                checked={settings.requireApproval}
                onChange={(e) => setSettings((prev) => (prev ? { ...prev, requireApproval: e.target.checked } : prev))}
              />
              Require approval for non-admin posts
            </label>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-extrabold text-slate-900">Listings</div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-700">Listing TTL (days)</div>
              <input
                type="number"
                min={1}
                max={365}
                value={settings.listingTtlDays}
                onChange={(e) => setSettings((prev) => (prev ? { ...prev, listingTtlDays: Number(e.target.value) } : prev))}
                className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-slate-400"
              />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-700">Featured max days</div>
              <input
                type="number"
                min={1}
                max={3650}
                value={settings.featuredMaxDays}
                onChange={(e) => setSettings((prev) => (prev ? { ...prev, featuredMaxDays: Number(e.target.value) } : prev))}
                className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-slate-400"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 md:col-span-2">
            <div className="text-sm font-extrabold text-slate-900">Rate limiting</div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-700">Window (ms)</div>
                <input
                  type="number"
                  min={5000}
                  max={300000}
                  value={settings.rateLimitWindowMs}
                  onChange={(e) => setSettings((prev) => (prev ? { ...prev, rateLimitWindowMs: Number(e.target.value) } : prev))}
                  className="w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-slate-400"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-700">Max requests / window</div>
                <input
                  type="number"
                  min={10}
                  max={10000}
                  value={settings.rateLimitMax}
                  onChange={(e) => setSettings((prev) => (prev ? { ...prev, rateLimitMax: Number(e.target.value) } : prev))}
                  className="w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-slate-400"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

