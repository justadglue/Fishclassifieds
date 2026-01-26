import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import {
  adminGeneratePopularSearchDraft,
  adminGetPopularSearchLlmSettings,
  adminGetLatestPublishedPopularSearchSet,
  adminGetLatestPopularSearchDraft,
  adminPublishPopularSearchSet,
  adminSavePopularSearchLlmSettings,
  adminUpdatePopularSearchSet,
  adminGetSettings,
  adminUpdateSettings,
  fetchListings,
  type AdminPopularSearchDraftItem,
  type AdminPopularSearchLlmSettings,
  type AdminPopularSearchSet,
  type AdminSiteSettings,
  type PopularSearchLlmProvider,
} from "../../api";
import { useAuth } from "../../auth";

function moveItem<T>(arr: T[], from: number, to: number) {
  const next = arr.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
}

const OPENAI_MODEL_PRESETS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"] as const;
const GEMINI_MODEL_PRESETS = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"] as const;
const CUSTOM_MODEL_VALUE = "__custom__";

export default function AdminSettingsPage() {
  const { user } = useAuth();
  const isSuper = Boolean(user?.isSuperadmin);

  const [settings, setSettings] = useState<AdminSiteSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const [llm, setLlm] = useState<AdminPopularSearchLlmSettings | null>(null);
  const [llmProvider, setLlmProvider] = useState<PopularSearchLlmProvider>("openai");
  const [llmModelPreset, setLlmModelPreset] = useState<string>(OPENAI_MODEL_PRESETS[0]);
  const [llmModelCustom, setLlmModelCustom] = useState<string>("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmMetaPrompt, setLlmMetaPrompt] = useState("");
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmMsg, setLlmMsg] = useState<string | null>(null);

  const [draftSet, setDraftSet] = useState<AdminPopularSearchSet | null>(null);
  const [draftItems, setDraftItems] = useState<AdminPopularSearchDraftItem[]>([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftGenerating, setDraftGenerating] = useState(false);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);
  const [latestPublishedSet, setLatestPublishedSet] = useState<AdminPopularSearchSet | null>(null);
  const [expandedRaw, setExpandedRaw] = useState<Set<string>>(() => new Set());
  const [inputSummary, setInputSummary] = useState<{ windowHours: number; candidatesTotal: number; candidatesUsed: number; candidatesDropped: number } | null>(
    null
  );
  const [generateWindowValue, setGenerateWindowValue] = useState<string>("24");
  const [generateWindowUnit, setGenerateWindowUnit] = useState<"hours" | "days" | "weeks">("hours");
  const [saleMatchCounts, setSaleMatchCounts] = useState<Record<string, { loading: boolean; count: number | null; q: string; category?: string }>>({});
  const [unmatchedOverrides, setUnmatchedOverrides] = useState<Set<string>>(() => new Set());
  const [customLabelDraft, setCustomLabelDraft] = useState<string>("");
  const [customLabelOpen, setCustomLabelOpen] = useState(false);
  const customLabelInputRef = useRef<HTMLInputElement | null>(null);

  function parseLabelToSaleSearch(label: string): { q: string; category?: string } {
    const raw = String(label ?? "").trim();
    if (!raw) return { q: "" };
    const m = raw.match(/^(.*)\s+\(([^)]+)\)\s*$/);
    if (!m) return { q: raw };
    const q = (m[1] ?? "").trim();
    const category = (m[2] ?? "").trim();
    return { q, category: category || undefined };
  }

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
    (async () => {
      try {
        const s = await adminGetPopularSearchLlmSettings();
        setLlm(s);
        const prov: PopularSearchLlmProvider = s.provider === "gemini" ? "gemini" : "openai";
        setLlmProvider(prov);
        setLlmMetaPrompt(String(s.metaPrompt ?? ""));

        const presets = prov === "gemini" ? (GEMINI_MODEL_PRESETS as readonly string[]) : (OPENAI_MODEL_PRESETS as readonly string[]);
        const m = s.model ? String(s.model).trim() : "";
        if (m && presets.includes(m)) {
          setLlmModelPreset(m);
          setLlmModelCustom("");
        } else if (m) {
          setLlmModelPreset(CUSTOM_MODEL_VALUE);
          setLlmModelCustom(m);
        } else {
          setLlmModelPreset(presets[0] ?? "");
          setLlmModelCustom("");
        }
      } catch {
        // ignore
      }
    })();

    (async () => {
      try {
        const d = await adminGetLatestPopularSearchDraft();
        if (d.set && d.set.status === "draft") {
          setDraftSet(d.set);
          setDraftItems(d.items ?? []);
          setDraftMsg("Loaded latest saved draft.");
        }
      } catch {
        // ignore
      }
    })();

    (async () => {
      try {
        const p = await adminGetLatestPublishedPopularSearchSet();
        setLatestPublishedSet(p.set ?? null);
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuper]);

  function timeAgoLabel(iso: string) {
    const t = Date.parse(String(iso ?? ""));
    if (!Number.isFinite(t)) return null;
    const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 48) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
  }

  function windowDurationLabel(startIso: string, endIso: string) {
    const a = Date.parse(String(startIso ?? ""));
    const b = Date.parse(String(endIso ?? ""));
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
    const hours = Math.max(1, Math.round((b - a) / (60 * 60 * 1000)));
    if (hours % 168 === 0) return `${hours / 168}w`;
    if (hours % 24 === 0) return `${hours / 24}d`;
    return `${hours}h`;
  }

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

  async function saveLlm() {
    setLlmSaving(true);
    setLlmMsg(null);
    try {
      const effectiveModel = (llmModelPreset === CUSTOM_MODEL_VALUE ? llmModelCustom : llmModelPreset).trim();
      await adminSavePopularSearchLlmSettings({
        provider: llmProvider,
        model: effectiveModel,
        apiKey: llmApiKey ? llmApiKey : undefined,
        metaPrompt: llmMetaPrompt ? llmMetaPrompt : undefined,
      });
      const s = await adminGetPopularSearchLlmSettings();
      setLlm(s);
      setLlmApiKey("");
      setLlmMsg("Saved LLM settings.");
    } catch (e: any) {
      setLlmMsg(e?.message ?? "Failed to save LLM settings");
    } finally {
      setLlmSaving(false);
    }
  }

  async function generateDraft() {
    setDraftGenerating(true);
    setDraftMsg(null);
    try {
      const parsed = Number.parseInt(generateWindowValue, 10);
      const value = Number.isFinite(parsed) ? Math.max(1, Math.min(52, Math.floor(parsed))) : 24;
      const factor = generateWindowUnit === "weeks" ? 168 : generateWindowUnit === "days" ? 24 : 1;
      const windowHours = Math.max(1, Math.min(24 * 365, value * factor));
      const res = await adminGeneratePopularSearchDraft({ windowHours, candidateLimit: 200, outputLimit: 12 });
      setDraftSet(res.set as any);
      setDraftItems(res.items ?? []);
      setInputSummary(res.inputSummary ?? null);
      setDraftMsg("Draft generated. Review and publish when ready.");
    } catch (e: any) {
      setDraftMsg(e?.message ?? "Failed to generate draft");
    } finally {
      setDraftGenerating(false);
    }
  }

  const canSaveDraft = Boolean(draftSet && draftSet.status === "draft");
  const hasAnyEnabled = useMemo(() => (draftItems ?? []).some((x) => x.enabled), [draftItems]);

  async function saveDraftEdits() {
    if (!draftSet) return;
    setDraftLoading(true);
    setDraftMsg(null);
    try {
      await adminUpdatePopularSearchSet(draftSet.id, {
        items: draftItems.map((x) => ({ id: x.id, label: x.label, enabled: x.enabled })),
      });
      setDraftMsg("Draft saved.");
    } catch (e: any) {
      setDraftMsg(e?.message ?? "Failed to save draft");
    } finally {
      setDraftLoading(false);
    }
  }

  async function publishDraft() {
    if (!draftSet) return;
    setDraftLoading(true);
    setDraftMsg(null);
    try {
      // Persist current edits before publishing (so auto-disabled unmatched items are excluded).
      await adminUpdatePopularSearchSet(draftSet.id, {
        items: draftItems.map((x) => ({ id: x.id, label: x.label, enabled: x.enabled })),
      });
      await adminPublishPopularSearchSet(draftSet.id);
      setDraftMsg("Published. Homepage will now use this curated list.");
      const nowIso = new Date().toISOString();
      setDraftSet((prev) => (prev ? { ...prev, status: "published", updatedAt: nowIso } : prev));
      setLatestPublishedSet((prev) => {
        if (!draftSet) return prev;
        return { ...draftSet, status: "published", updatedAt: nowIso };
      });
    } catch (e: any) {
      setDraftMsg(e?.message ?? "Failed to publish");
    } finally {
      setDraftLoading(false);
    }
  }

  function moveDraftItemBy(id: string, delta: number) {
    setDraftItems((prev) => {
      const fromIdx = prev.findIndex((x) => x.id === id);
      if (fromIdx < 0) return prev;
      const toIdx = fromIdx + delta;
      if (toIdx < 0 || toIdx >= prev.length) return prev;

      const isUnmatched = (itemId: string) => {
        const s = saleMatchCounts[itemId];
        return Boolean(s && !s.loading && s.q && s.count === 0 && !unmatchedOverrides.has(itemId));
      };
      const firstUnmatchedIdx = prev.findIndex((x) => isUnmatched(x.id));
      if (firstUnmatchedIdx >= 0) {
        const movingIsUnmatched = isUnmatched(id);
        // Keep unmatched items at the bottom segment.
        if (movingIsUnmatched && toIdx < firstUnmatchedIdx) return prev;
        if (!movingIsUnmatched && toIdx >= firstUnmatchedIdx) return prev;
      }

      return moveItem(prev, fromIdx, toIdx);
    });
  }

  // Fetch "for sale browse" match counts for each draft label (shows how many results would appear on /browse/for-sale).
  const saleCountsKey = useMemo(() => draftItems.map((it) => `${it.id}:${it.label}`).join("\n"), [draftItems]);
  useEffect(() => {
    if (!draftItems.length) return;

    const t = window.setTimeout(() => {
      (async () => {
        // mark loading for current items
        setSaleMatchCounts((prev) => {
          const next: Record<string, { loading: boolean; count: number | null; q: string; category?: string }> = { ...prev };
          for (const it of draftItems) {
            const { q, category } = parseLabelToSaleSearch(it.label);
            next[it.id] = { loading: Boolean(q), count: q ? (prev[it.id]?.q === q && prev[it.id]?.category === category ? prev[it.id]?.count ?? null : null) : null, q, category };
          }
          return next;
        });

        const results = await Promise.allSettled(
          draftItems.map(async (it) => {
            const { q, category } = parseLabelToSaleSearch(it.label);
            if (!q) return { id: it.id, q, category, total: null as number | null };
            const res = await fetchListings({ q, category, limit: 1, offset: 0 });
            return { id: it.id, q, category, total: res.total ?? 0 };
          })
        );

        setSaleMatchCounts((prev) => {
          const next = { ...prev };
          for (const r of results) {
            if (r.status !== "fulfilled") continue;
            const { id, q, category, total } = r.value;
            const cur = next[id];
            // Only apply if the label-derived query still matches (avoid stale updates while typing).
            if (!cur || cur.q !== q || cur.category !== category) continue;
            next[id] = { ...cur, loading: false, count: total };
          }
          return next;
        });
      })().catch(() => {
        // ignore (counts are best-effort UI)
      });
    }, 400);

    return () => window.clearTimeout(t);
  }, [saleCountsKey]);

  useEffect(() => {
    if (!customLabelOpen) return;
    const t = window.setTimeout(() => customLabelInputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [customLabelOpen]);

  // Auto-move unmatched labels (0 sale matches) to the bottom and disable them so they won't publish.
  const saleCountsSignature = useMemo(() => {
    return draftItems
      .map((it) => {
        const s = saleMatchCounts[it.id];
        const l = s?.loading ? "1" : "0";
        const c = s?.count == null ? "n" : String(s.count);
        const q = s?.q ?? "";
        const cat = s?.category ?? "";
        return `${it.id}:${l}:${c}:${q}:${cat}`;
      })
      .join("|");
  }, [draftItems, saleMatchCounts]);

  useEffect(() => {
    if (!draftItems.length) return;
    setDraftItems((prev) => {
      const isZero = (itemId: string) => {
        const s = saleMatchCounts[itemId];
        return Boolean(s && !s.loading && s.q && s.count === 0);
      };
      const isUnmatched = (itemId: string) => isZero(itemId) && !unmatchedOverrides.has(itemId);
      const isOverridden = (itemId: string) => isZero(itemId) && unmatchedOverrides.has(itemId);

      const hasAnyUnmatched = prev.some((x) => isUnmatched(x.id));
      const hasAnyOverridden = prev.some((x) => isOverridden(x.id));
      if (!hasAnyUnmatched && !hasAnyOverridden) return prev;

      const withEnabled = prev.map((x) => {
        if (isUnmatched(x.id)) return { ...x, enabled: false };
        if (isOverridden(x.id)) return { ...x, enabled: true };
        return x;
      });

      // Stable partition: matched first, then overridden-zero, then unmatched-zero.
      const matched = withEnabled.filter((x) => !isZero(x.id));
      const overridden = withEnabled.filter((x) => isOverridden(x.id));
      const unmatched = withEnabled.filter((x) => isUnmatched(x.id));
      return [...matched, ...overridden, ...unmatched];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleCountsSignature, unmatchedOverrides]);

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

      <div className="mt-10">
        <div className="text-sm font-bold text-slate-900">Popular searches (LLM curated)</div>
        <div className="mt-1 text-sm text-slate-600">
          Superadmin-only workflow: configure provider + key, generate a draft from the last 24h of searches, then edit and publish.
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-extrabold text-slate-900">LLM settings</div>
            <div className="mt-2 text-xs text-slate-600">
              API keys are stored encrypted server-side and are never returned to the browser after saving.
            </div>

            <div className="mt-4 grid gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="text-sm font-semibold text-slate-700">Provider</div>
                <select
                  value={llmProvider}
                  onChange={(e) => {
                    const next = e.target.value as PopularSearchLlmProvider;
                    setLlmProvider(next);
                    const presets = next === "gemini" ? (GEMINI_MODEL_PRESETS as readonly string[]) : (OPENAI_MODEL_PRESETS as readonly string[]);
                    setLlmModelPreset(presets[0] ?? "");
                    setLlmModelCustom("");
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-slate-400 sm:w-48"
                >
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Gemini</option>
                </select>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="text-sm font-semibold text-slate-700">Model</div>
                <div className="flex items-center gap-2">
                  <select
                    value={llmModelPreset}
                    onChange={(e) => setLlmModelPreset(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-slate-400 sm:w-56"
                  >
                    {(llmProvider === "gemini" ? GEMINI_MODEL_PRESETS : OPENAI_MODEL_PRESETS).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    <option value={CUSTOM_MODEL_VALUE}>Custom…</option>
                  </select>

                  {llmModelPreset === CUSTOM_MODEL_VALUE ? (
                    <input
                      value={llmModelCustom}
                      onChange={(e) => setLlmModelCustom(e.target.value)}
                      placeholder={llmProvider === "gemini" ? "gemini-2.0-flash" : "gpt-4o-mini"}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-slate-400 sm:w-64"
                    />
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="text-sm font-semibold text-slate-700">API key</div>
                <input
                  type="password"
                  value={llmApiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
                  placeholder={llm && llm.apiKeySet ? "•••••••• (set)" : "Enter API key"}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-slate-400 sm:w-64"
                />
              </div>

              <div className="mt-2">
                <div className="flex items-end justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-700">Meta-prompt</div>
                  <div className="text-xs text-slate-500">{llmMetaPrompt.length.toLocaleString()} chars</div>
                </div>
                <textarea
                  value={llmMetaPrompt}
                  onChange={(e) => setLlmMetaPrompt(e.target.value)}
                  rows={10}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm font-medium text-slate-900 outline-none focus:border-slate-400"
                  placeholder="Instructions passed to the model (system prompt)."
                />
                <div className="mt-2 text-xs text-slate-600">
                  This is the “system” instruction used for generation. Keep it strict about returning JSON only.
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="text-xs text-slate-600">{llm ? `Saved provider: ${llm.provider ?? "—"} • model: ${llm.model ?? "—"}` : ""}</div>
                <button
                  type="button"
                  onClick={saveLlm}
                  disabled={
                    llmSaving ||
                    !(llmModelPreset === CUSTOM_MODEL_VALUE ? llmModelCustom.trim() : llmModelPreset.trim()) ||
                    (!llmApiKey && !(llm?.apiKeySet ?? false)) ||
                    llmMetaPrompt.trim().length < 10
                  }
                  className="w-full rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60 sm:w-auto"
                >
                  Save LLM settings
                </button>
              </div>

              {llmMsg ? (
                <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{llmMsg}</div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-extrabold text-slate-900">Generate draft</div>
            <div className="mt-2 text-sm text-slate-600">
              Generates a draft list from the last 24 hours of search events. You can edit, reorder, and publish the final list.
            </div>

            {inputSummary ? (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                Window: {inputSummary.windowHours}h • Candidates: {inputSummary.candidatesTotal} • Used: {inputSummary.candidatesUsed} • Dropped:{" "}
                {inputSummary.candidatesDropped}
              </div>
            ) : null}

            {draftSet ? (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                {(() => {
                  const status = String((draftSet as any).status ?? "");
                  const startIso = String((draftSet as any).windowStartIso ?? "");
                  const endIso = String((draftSet as any).windowEndIso ?? "");
                  const updatedAt = String((draftSet as any).updatedAt ?? "");
                  const windowLabel = (() => {
                    const a = Date.parse(startIso);
                    const b = Date.parse(endIso);
                    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
                    const hours = Math.max(1, Math.round((b - a) / (60 * 60 * 1000)));
                    if (hours % 168 === 0) return `${hours / 168}w`;
                    if (hours % 24 === 0) return `${hours / 24}d`;
                    return `${hours}h`;
                  })();

                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <div>
                        Set: <span className="font-mono">{draftSet.id}</span>
                      </div>
                      <div className="text-slate-400">•</div>
                      <div>
                        Status: <span className="font-extrabold">{status}</span>
                      </div>
                      {windowLabel ? (
                        <>
                          <div className="text-slate-400">•</div>
                          <div>
                            Window: <span className="font-extrabold">{windowLabel}</span>
                          </div>
                        </>
                      ) : null}
                      {status === "published" && updatedAt ? (
                        <>
                          <div className="text-slate-400">•</div>
                          <div>
                            Published at: <span className="font-extrabold">{new Date(updatedAt).toLocaleString()}</span>
                          </div>
                        </>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            ) : null}

            {latestPublishedSet ? (
              <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                {(() => {
                  const ago = timeAgoLabel(latestPublishedSet.updatedAt);
                  const dur = windowDurationLabel(latestPublishedSet.windowStartIso, latestPublishedSet.windowEndIso);
                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-extrabold">Latest published</div>
                      <div className="text-emerald-700">{ago ? `• ${ago}` : ""}</div>
                      {dur ? <div className="text-emerald-700">• Window {dur}</div> : null}
                    </div>
                  );
                })()}
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="flex w-full gap-2 sm:w-auto">
                <button
                  type="button"
                  onClick={generateDraft}
                  disabled={draftLoading || draftGenerating || !(llm?.apiKeySet ?? false)}
                  className="flex h-10 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-60 sm:flex-none"
                >
                  {draftGenerating ? "Generating…" : "Generate"}
                </button>
                <div className="flex h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
                  <select
                    value={generateWindowUnit}
                    onChange={(e) => setGenerateWindowUnit(e.target.value as any)}
                    className="h-10 border-0 bg-transparent py-0 text-sm font-bold leading-10 text-slate-700 outline-none"
                    aria-label="Window units"
                    title="Window units"
                  >
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                    <option value="weeks">Weeks</option>
                  </select>
                  <input
                    type="text"
                    value={generateWindowValue}
                    onChange={(e) => setGenerateWindowValue(e.target.value.replace(/[^\d]/g, ""))}
                    className="h-10 w-16 border-0 bg-transparent py-0 text-sm font-bold leading-10 text-slate-900 outline-none"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label="Window value"
                    title="Window value"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={saveDraftEdits}
                disabled={draftLoading || draftGenerating || !canSaveDraft}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-60 sm:w-auto"
              >
                Save draft
              </button>
              <button
                type="button"
                onClick={publishDraft}
                disabled={draftLoading || draftGenerating || !canSaveDraft || !hasAnyEnabled}
                className="h-10 w-full rounded-xl border border-slate-900 bg-slate-900 px-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60 sm:w-auto"
              >
                Publish
              </button>
            </div>

            {draftMsg ? (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{draftMsg}</div>
            ) : null}



            {/* Draft editor (inline) */}
            <div className="mt-5">
              {draftGenerating ? (
                <div className="text-sm text-slate-600">Generating…</div>
              ) : !draftSet ? (
                <div className="text-sm text-slate-600">No draft loaded. Click “Generate”.</div>
              ) : draftItems.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed border-collapse">
                    <thead>
                      <tr className="text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                        <th className="pb-2">Label</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draftItems.map((it, idx) => {
                        const isExpanded = expandedRaw.has(it.id);
                        const canDelete = true;
                        const canMoveUp = idx > 0;
                        const canMoveDown = idx < draftItems.length - 1;

                        return (
                          <Fragment key={it.id}>
                            <tr className="border-t border-slate-200 align-top">
                              <td className="py-2 pr-3">
                                <div className="flex w-full min-w-0 flex-col gap-1">
                                  {/* Row 1: Label + (sm+: Eye + Delete) + Move buttons (right) */}
                                  <div className="flex w-full min-w-0 items-center justify-between gap-2">
                                    {/* Left group: label + inline buttons (can shrink) */}
                                    <div className="flex min-w-0 flex-1 items-center gap-2">
                                      <input
                                        value={it.label}
                                        onChange={(e) =>
                                          setDraftItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)))
                                        }
                                        className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-slate-400"
                                        style={{ maxWidth: "18rem" }}
                                      />

                                      {/* On sm+ screens, eye + delete appear inline after label */}
                                      <div className="hidden shrink-0 items-center gap-1 sm:flex">
                                        {(() => {
                                          const s = saleMatchCounts[it.id];
                                          const isZero = Boolean(s && !s.loading && s.q && s.count === 0);
                                          const isOverridden = isZero && unmatchedOverrides.has(it.id);
                                          const cls = isZero
                                            ? isOverridden
                                              ? "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-xs font-extrabold text-amber-800"
                                              : "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-xs font-extrabold text-red-700"
                                            : "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-xs font-extrabold text-slate-700";
                                          return (
                                            <button
                                              type="button"
                                              className={cls}
                                              title={
                                                isZero
                                                  ? isOverridden
                                                    ? "0 matches (overridden to include)"
                                                    : "0 matches (click to include anyway)"
                                                  : "For sale matches (if searched on browse)"
                                              }
                                              onClick={() => {
                                                if (!isZero) return;
                                                setUnmatchedOverrides((prev) => {
                                                  const next = new Set(prev);
                                                  if (next.has(it.id)) next.delete(it.id);
                                                  else next.add(it.id);
                                                  return next;
                                                });
                                              }}
                                            >
                                              {saleMatchCounts[it.id]?.loading
                                                ? "…"
                                                : saleMatchCounts[it.id]?.count == null
                                                  ? "—"
                                                  : saleMatchCounts[it.id]!.count!.toLocaleString()}
                                              {isOverridden ? <Check className="ml-0.5 h-3.5 w-3.5" aria-hidden="true" /> : null}
                                            </button>
                                          );
                                        })()}
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setExpandedRaw((prev) => {
                                              const next = new Set(prev);
                                              if (next.has(it.id)) next.delete(it.id);
                                              else next.add(it.id);
                                              return next;
                                            })
                                          }
                                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                                          aria-expanded={isExpanded}
                                          aria-label={isExpanded ? "Hide Merged raw queries" : "Show Merged raw queries"}
                                          title={isExpanded ? "Hide Merged raw queries" : "Show Merged raw queries"}
                                        >
                                          {isExpanded ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                                        </button>

                                        <button
                                          type="button"
                                          disabled={!canDelete}
                                          onClick={() => {
                                            setDraftItems((prev) => prev.filter((x) => x.id !== it.id));
                                            setExpandedRaw((prev) => {
                                              const next = new Set(prev);
                                              next.delete(it.id);
                                              return next;
                                            });
                                          }}
                                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
                                          aria-label="Delete item"
                                          title={canDelete ? "Delete item" : "At least one item is required"}
                                        >
                                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                                        </button>
                                      </div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-1">
                                      <button
                                        type="button"
                                        disabled={!canMoveUp}
                                        onClick={() => moveDraftItemBy(it.id, -1)}
                                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
                                        aria-label="Move up"
                                        title="Move up"
                                      >
                                        <ChevronUp className="h-4 w-4" aria-hidden="true" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!canMoveDown}
                                        onClick={() => moveDraftItemBy(it.id, 1)}
                                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
                                        aria-label="Move down"
                                        title="Move down"
                                      >
                                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                                      </button>
                                    </div>
                                  </div>

                                  {/* Row 2 (small screens only): Eye + Delete, left-aligned under label */}
                                  <div className="flex items-center gap-2 sm:hidden">
                                    {(() => {
                                      const s = saleMatchCounts[it.id];
                                      const isZero = Boolean(s && !s.loading && s.q && s.count === 0);
                                      const isOverridden = isZero && unmatchedOverrides.has(it.id);
                                      const cls = isZero
                                        ? isOverridden
                                          ? "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-xs font-extrabold text-amber-800"
                                          : "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-xs font-extrabold text-red-700"
                                        : "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-xs font-extrabold text-slate-700";
                                      return (
                                        <button
                                          type="button"
                                          className={cls}
                                          title={
                                            isZero
                                              ? isOverridden
                                                ? "0 matches (overridden to include)"
                                                : "0 matches (tap to include anyway)"
                                              : "For sale matches (if searched on browse)"
                                          }
                                          onClick={() => {
                                            if (!isZero) return;
                                            setUnmatchedOverrides((prev) => {
                                              const next = new Set(prev);
                                              if (next.has(it.id)) next.delete(it.id);
                                              else next.add(it.id);
                                              return next;
                                            });
                                          }}
                                        >
                                          {saleMatchCounts[it.id]?.loading
                                            ? "…"
                                            : saleMatchCounts[it.id]?.count == null
                                              ? "—"
                                              : saleMatchCounts[it.id]!.count!.toLocaleString()}
                                          {isOverridden ? <Check className="ml-0.5 h-3.5 w-3.5" aria-hidden="true" /> : null}
                                        </button>
                                      );
                                    })()}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedRaw((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(it.id)) next.delete(it.id);
                                          else next.add(it.id);
                                          return next;
                                        })
                                      }
                                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                                      aria-expanded={isExpanded}
                                      aria-label={isExpanded ? "Hide Merged raw queries" : "Show Merged raw queries"}
                                      title={isExpanded ? "Hide Merged raw queries" : "Show Merged raw queries"}
                                    >
                                      {isExpanded ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                                    </button>

                                    <button
                                      type="button"
                                      disabled={!canDelete}
                                      onClick={() => {
                                        setDraftItems((prev) => prev.filter((x) => x.id !== it.id));
                                        setExpandedRaw((prev) => {
                                          const next = new Set(prev);
                                          next.delete(it.id);
                                          return next;
                                        });
                                      }}
                                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
                                      aria-label="Delete item"
                                      title={canDelete ? "Delete item" : "At least one item is required"}
                                    >
                                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    </button>
                                  </div>

                                  {/* Row 3: Merged raw queries count (always below label) */}
                                  <div className="text-[11px] font-semibold text-slate-500">
                                    Merged raw queries: {(it.includedTerms ?? []).length}
                                  </div>
                                </div>
                              </td>
                            </tr>

                            {isExpanded ? (
                              <tr className="border-t border-slate-200">
                                <td className="py-3">
                                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
                                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Merged raw queries</div>
                                    <div className="mt-2 grid gap-1">
                                      {(it.includedTerms ?? []).map((x, i) => {
                                        if (typeof x === "string") return <div key={`${it.id}-t-${i}`}>{x}</div>;
                                        const term = String((x as any).term ?? "");
                                        const saleU = Number((x as any).saleUnique ?? 0);
                                        const wantedU = Number((x as any).wantedUnique ?? 0);
                                        const saleC = Number((x as any).saleCount ?? 0);
                                        const wantedC = Number((x as any).wantedCount ?? 0);
                                        const cat = (x as any).topCategory != null ? String((x as any).topCategory) : null;
                                        const uniq = saleU + wantedU;
                                        const cnt = saleC + wantedC;
                                        return (
                                          <div key={`${it.id}-t-${i}`} className="flex flex-wrap items-center gap-2">
                                            <span className="font-semibold">{term}</span>
                                            <span className="text-slate-600">Unique searchers {uniq.toLocaleString()} • Total searches {cnt.toLocaleString()}</span>
                                            {cat ? <span className="text-slate-600">• {cat}</span> : null}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {draftSet && draftSet.status === "draft" ? (
                <div className="mt-3 pr-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                  {customLabelOpen ? (
                    <>
                      <input
                        ref={customLabelInputRef}
                        value={customLabelDraft}
                        onChange={(e) => setCustomLabelDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          const label = customLabelDraft.trim();
                          if (!label) return;
                          const id = (globalThis.crypto as any)?.randomUUID?.() ? (globalThis.crypto as any).randomUUID() : `custom-${Date.now()}`;
                          setDraftItems((prev) => [
                            ...prev,
                            { id, rank: prev.length + 1, label, includedTerms: [], confidence: null, enabled: true },
                          ]);
                          setCustomLabelDraft("");
                          setCustomLabelOpen(false);
                        }}
                        placeholder="Custom label…"
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-slate-400 sm:w-72"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const label = customLabelDraft.trim();
                          if (!label) return;
                          const id = (globalThis.crypto as any)?.randomUUID?.() ? (globalThis.crypto as any).randomUUID() : `custom-${Date.now()}`;
                          setDraftItems((prev) => [
                            ...prev,
                            { id, rank: prev.length + 1, label, includedTerms: [], confidence: null, enabled: true },
                          ]);
                          setCustomLabelDraft("");
                          setCustomLabelOpen(false);
                        }}
                        className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-60 sm:w-auto"
                        disabled={!customLabelDraft.trim() || draftGenerating || draftLoading}
                        title="Add"
                        aria-label="Add"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="text-xs font-semibold text-slate-500 sm:mr-2">Add label</div>
                      <button
                        type="button"
                        onClick={() => setCustomLabelOpen(true)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                        title="Add label"
                        aria-label="Add label"
                        disabled={draftGenerating || draftLoading}
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

