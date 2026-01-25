import { useEffect, useMemo, useState } from "react";
import {
  adminGeneratePopularSearchDraft,
  adminGetPopularSearchLlmSettings,
  adminPublishPopularSearchSet,
  adminSavePopularSearchLlmSettings,
  adminUpdatePopularSearchSet,
  adminGetSettings,
  adminUpdateSettings,
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
  const [draftMsg, setDraftMsg] = useState<string | null>(null);
  const [inputSummary, setInputSummary] = useState<{ windowHours: number; candidatesTotal: number; candidatesUsed: number; candidatesDropped: number } | null>(
    null
  );

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
    setDraftLoading(true);
    setDraftMsg(null);
    try {
      const res = await adminGeneratePopularSearchDraft({ windowHours: 24, candidateLimit: 200, outputLimit: 12 });
      setDraftSet(res.set as any);
      setDraftItems(res.items ?? []);
      setInputSummary(res.inputSummary ?? null);
      setDraftMsg("Draft generated. Review and publish when ready.");
    } catch (e: any) {
      setDraftMsg(e?.message ?? "Failed to generate draft");
    } finally {
      setDraftLoading(false);
    }
  }

  const canSaveDraft = Boolean(draftSet && draftSet.status === "draft" && draftItems.length);
  const hasAnyEnabled = useMemo(() => (draftItems ?? []).some((x) => x.enabled), [draftItems]);

  async function saveDraftEdits() {
    if (!draftSet) return;
    setDraftLoading(true);
    setDraftMsg(null);
    try {
      await adminUpdatePopularSearchSet(draftSet.id, {
        items: draftItems.map((x) => ({
          id: x.id,
          label: x.label,
          params: x.params,
          includedTerms: x.includedTerms,
          confidence: x.confidence,
          enabled: x.enabled,
        })) as any,
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
      await adminPublishPopularSearchSet(draftSet.id);
      setDraftMsg("Published. Homepage will now use this curated list.");
      setDraftSet((prev) => (prev ? { ...prev, status: "published" } : prev));
    } catch (e: any) {
      setDraftMsg(e?.message ?? "Failed to publish");
    } finally {
      setDraftLoading(false);
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
              <div className="flex items-center justify-between gap-3">
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
                  className="w-48 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-slate-400"
                >
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Gemini</option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-700">Model</div>
            <div className="flex items-center gap-2">
              <select
                value={llmModelPreset}
                onChange={(e) => setLlmModelPreset(e.target.value)}
                className="w-56 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-slate-400"
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
                  className="w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-slate-400"
                />
              ) : null}
            </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-700">API key</div>
                <input
                  type="password"
                  value={llmApiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
                  placeholder={llm && llm.apiKeySet ? "•••••••• (set)" : "Enter API key"}
                  className="w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-slate-400"
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

              <div className="flex items-center justify-between gap-3 pt-2">
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
                  className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
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
                Draft set: <span className="font-mono">{draftSet.id}</span> • Status: {draftSet.status}
              </div>
            ) : null}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={generateDraft}
                disabled={draftLoading || !(llm?.apiKeySet ?? false)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                Generate from last 24h
              </button>
              <button
                type="button"
                onClick={saveDraftEdits}
                disabled={draftLoading || !canSaveDraft}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                Save draft
              </button>
              <button
                type="button"
                onClick={publishDraft}
                disabled={draftLoading || !canSaveDraft || !hasAnyEnabled}
                className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                Publish
              </button>
            </div>

            {draftMsg ? (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{draftMsg}</div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-sm font-extrabold text-slate-900">Draft editor</div>
              <div className="mt-1 text-sm text-slate-600">Edit labels/params, toggle items, and reorder before publishing.</div>
            </div>
          </div>

          {!draftItems.length ? (
            <div className="mt-3 text-sm text-slate-600">No draft loaded. Click “Generate from last 24h”.</div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[900px] border-separate border-spacing-0">
                <thead>
                  <tr className="text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                    <th className="pb-2">On</th>
                    <th className="pb-2">Label</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Category</th>
                    <th className="pb-2">Mode</th>
                    <th className="pb-2">Value</th>
                    <th className="pb-2">Order</th>
                  </tr>
                </thead>
                <tbody>
                  {draftItems.map((it, idx) => {
                    const type = String(it.params?.type ?? "sale");
                    const category = String(it.params?.category ?? "");
                    const species = String(it.params?.species ?? "");
                    const q = String(it.params?.q ?? "");
                    const mode = species ? "species" : "q";
                    const value = species ? species : q;

                    return (
                      <tr key={it.id} className="border-t border-slate-100 align-top">
                        <td className="py-2 pr-3">
                          <input
                            type="checkbox"
                            checked={it.enabled}
                            onChange={(e) =>
                              setDraftItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, enabled: e.target.checked } : x)))
                            }
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <div className="w-72">
                            <input
                              value={it.label}
                              onChange={(e) =>
                                setDraftItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)))
                              }
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                            />
                            {(it.includedTerms ?? []).length ? (
                              <div className="mt-1 text-[11px] font-semibold text-slate-500" title={(it.includedTerms ?? []).join(", ")}>
                                Merged terms: {(it.includedTerms ?? []).length}
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <select
                            value={type}
                            onChange={(e) =>
                              setDraftItems((prev) =>
                                prev.map((x) => (x.id === it.id ? { ...x, params: { ...x.params, type: e.target.value } } : x))
                              )
                            }
                            className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                          >
                            <option value="sale">sale</option>
                            <option value="wanted">wanted</option>
                          </select>
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            value={category}
                            onChange={(e) =>
                              setDraftItems((prev) =>
                                prev.map((x) => (x.id === it.id ? { ...x, params: { ...x.params, category: e.target.value } } : x))
                              )
                            }
                            placeholder="(optional)"
                            className="w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <select
                            value={mode}
                            onChange={(e) => {
                              const m = e.target.value;
                              setDraftItems((prev) =>
                                prev.map((x) => {
                                  if (x.id !== it.id) return x;
                                  const next = { ...x, params: { ...x.params } } as any;
                                  if (m === "species") {
                                    delete next.params.q;
                                    next.params.species = value || "";
                                  } else {
                                    delete next.params.species;
                                    next.params.q = value || "";
                                  }
                                  return next;
                                })
                              );
                            }}
                            className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                          >
                            <option value="species">species</option>
                            <option value="q">q</option>
                          </select>
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            value={value}
                            onChange={(e) => {
                              const v = e.target.value;
                              setDraftItems((prev) =>
                                prev.map((x) => {
                                  if (x.id !== it.id) return x;
                                  const next = { ...x, params: { ...x.params } } as any;
                                  if (mode === "species") next.params.species = v;
                                  else next.params.q = v;
                                  return next;
                                })
                              );
                            }}
                            className="w-56 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
                          />
                        </td>
                        <td className="py-2">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setDraftItems((prev) => moveItem(prev, idx, Math.max(0, idx - 1)))}
                              disabled={idx === 0}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              onClick={() => setDraftItems((prev) => moveItem(prev, idx, Math.min(prev.length - 1, idx + 1)))}
                              disabled={idx === draftItems.length - 1}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                            >
                              Down
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

