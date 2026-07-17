import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../app/api";
import MasterDetailLayout from "../../../shared/components/MasterDetailLayout";
import SidebarListItem from "../components/SidebarListItem";
import { useConfirmDialog } from "../../../shared/components/ConfirmDialog";
import LogsViewer from "../components/LogsViewer";
import ToggleButton from "../../../shared/components/ToggleButton";
import TabBar from "../../../shared/components/TabBar";
import PageHeader from "../../../shared/components/PageHeader";
import {
  MasterDetailContentPanel,
  MasterDetailSidebarPanel,
} from "../../../shared/components/MasterDetailPanel";

// ── Provider definitions ──────────────────────────────────────────────────

const PROVIDERS = [
  {
    name: "GEMINI",
    label: "Gemini",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  },
  {
    name: "OPENAI",
    label: "OpenAI",
    models: ["gpt-4o", "gpt-4.1", "gpt-4o-mini", "o3-mini"],
  },
  {
    name: "DEEPSEEK",
    label: "DeepSeek",
    models: ["deepseek-chat", "deepseek-r1"],
  },
  {
    name: "CLAUDE",
    label: "Claude",
    models: [
      "claude-sonnet-4-0",
      "claude-sonnet-4-20250514",
      "claude-3.5-sonnet",
    ],
  },
  {
    name: "OPENROUTER",
    label: "OpenRouter",
    models: [
      "openai/gpt-4o",
      "openai/gpt-4.1",
      "openai/o3-mini",
      "anthropic/claude-sonnet-4-20250514",
      "google/gemini-2.5-flash",
      "deepseek/deepseek-chat",
      "meta-llama/llama-4-maverick",
    ],
  },
  {
    name: "OLLAMA",
    label: "Local AI (Ollama)",
    models: ["qwen2.5vl:3b", "llava:latest"],
  },
  {
    name: "TWELVE_DATA",
    label: "Twelve Data",
    models: [],
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeProviderName(raw) {
  const s = String(raw || "")
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (s === "GEMINI" || s === "GOOGLE_GEMINI" || s === "GEMINI_API_KEY")
    return "GEMINI";
  if (s === "OPENAI" || s === "OPENAI_API_KEY") return "OPENAI";
  if (s === "DEEPSEEK" || s === "DEEPSEEK_API_KEY") return "DEEPSEEK";
  if (s === "CLAUDE" || s === "ANTHROPIC" || s === "CLAUDE_API_KEY")
    return "CLAUDE";
  if (s === "OPENROUTER" || s === "OPENROUTER_API_KEY") return "OPENROUTER";
  if (s === "OLLAMA" || s === "OLLAMA_API_KEY" || s === "LOCAL_AI")
    return "OLLAMA";
  if (s === "TWELVE_DATA" || s === "TWELVEDATA" || s === "TWELVE_DATA_API_KEY")
    return "TWELVE_DATA";
  return s.replace(/_API_KEY$/i, "");
}

function createEmptyKeyRow() {
  return {
    id: `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    api_key: "",
    status: "active",
    invalid: false,
    invalid_reason: null,
    last_checked_at: null,
    last_success_at: null,
    last_error: null,
  };
}

function isMaskedKeyLike(value = "") {
  return String(value || "").includes("****");
}

async function copyText(text) {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const tmp = document.createElement("textarea");
  tmp.value = text;
  tmp.style.position = "fixed";
  tmp.style.opacity = "0";
  document.body.appendChild(tmp);
  tmp.focus();
  tmp.select();
  document.execCommand("copy");
  document.body.removeChild(tmp);
}

function normalizeProviderKeyRows(data = {}) {
  const keyEntries = Array.isArray(data?.key_entries) ? data.key_entries : [];
  if (keyEntries.length) {
    return keyEntries.map((entry, index) => ({
      id: String(entry?.id || `row_${index + 1}`),
      api_key: String(entry?.api_key || ""),
      status: String(entry?.status || (entry?.invalid ? "invalid" : "active")).toLowerCase(),
      invalid: entry?.invalid === true,
      invalid_reason: entry?.invalid_reason || null,
      last_checked_at: entry?.last_checked_at || null,
      last_success_at: entry?.last_success_at || null,
      last_error: entry?.last_error || null,
    }));
  }
  const apiKeys = Array.isArray(data?.api_keys)
    ? data.api_keys
    : String(data?.api_key || data?.value || "")
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
  return apiKeys.map((apiKey, index) => ({
    id: `row_${index + 1}`,
    api_key: String(apiKey || ""),
    status: "active",
    invalid: false,
    invalid_reason: null,
    last_checked_at: null,
    last_success_at: null,
    last_error: null,
  }));
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ProvidersPage() {
  const confirm = useConfirmDialog();
  const navigate = useNavigate();
  const { providerName: routeProviderName } = useParams();
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("GEMINI");
  const [saveBusy, setSaveBusy] = useState(false);
  const [detailTab, setDetailTab] = useState("settings");

  // ── Derived ─────────────────────────────────────────────────────────────

  const apiKeySettings = useMemo(
    () =>
      settings.filter((s) => String(s.type || "").toLowerCase() === "api_key"),
    [settings],
  );

  // Build provider map from settings
  const providerMap = useMemo(() => {
    const map = {};
    for (const prov of PROVIDERS) {
      const setting = apiKeySettings.find(
        (s) => normalizeProviderName(s.name) === prov.name,
      );
      const data =
        setting?.data && typeof setting.data === "object" ? setting.data : {};
      map[prov.name] = {
        setting: setting || null,
        data: {
          models: Array.isArray(data.models) ? data.models : [],
          api_key: String(data.api_key || data.value || ""),
          api_keys: normalizeProviderKeyRows(data).map((entry) =>
            String(entry?.api_key || ""),
          ),
          key_entries: normalizeProviderKeyRows(data),
          remain_credits: Number.isFinite(Number(data.remain_credits))
            ? Number(data.remain_credits)
            : 0,
        },
        status: setting?.status || "INACTIVE",
      };
    }
    return map;
  }, [apiKeySettings]);

  const currentProvider = useMemo(
    () => providerMap[selectedProvider] || null,
    [providerMap, selectedProvider],
  );

  const currentProvDef = useMemo(
    () => PROVIDERS.find((p) => p.name === selectedProvider) || PROVIDERS[0],
    [selectedProvider],
  );

  // ── Local form state for current provider ──────────────────────────────

  const [form, setForm] = useState({
    models: [],
    key_entries: [],
    remain_credits: 0,
  });

  useEffect(() => {
    if (currentProvider) {
      const dbModels = currentProvider.data.models || [];
      const defaultModels = currentProvDef?.models || [];
      setForm({
        models: dbModels.length > 0 ? [...dbModels] : [...defaultModels],
        key_entries:
          currentProvider.data.key_entries.length > 0
            ? currentProvider.data.key_entries.map((entry) => ({ ...entry }))
            : [createEmptyKeyRow()],
        remain_credits: currentProvider.data.remain_credits,
      });
    }
  }, [
    selectedProvider,
    currentProvider?.data?.api_key,
    currentProvider?.data?.api_keys,
    currentProvider?.data?.key_entries,
  ]);

  useEffect(() => {
    const normalizedRouteProvider = routeProviderName
      ? normalizeProviderName(routeProviderName)
      : "";
    if (
      normalizedRouteProvider &&
      PROVIDERS.some((prov) => prov.name === normalizedRouteProvider) &&
      normalizedRouteProvider !== selectedProvider
    ) {
      setSelectedProvider(normalizedRouteProvider);
      return;
    }
    if (!routeProviderName && selectedProvider) {
      return;
    }
  }, [routeProviderName, selectedProvider]);

  useEffect(() => {
    setDetailTab("settings");
  }, [selectedProvider]);

  // ── Reveal helpers ──────────────────────────────────────────────────────

  const revealApiKeys = async () => {
    try {
      const out = await api.getSettingSecret(
        "api_key",
        selectedProvider,
        "api_keys",
      );
      const plain = String(out?.value || "");
      return plain;
    } catch (err) {
      setMsg(err?.message || "Failed to reveal secret.");
      return "";
    }
  };

  const revealKeyAtIndex = async (index) => {
    const plain = await revealApiKeys();
    const keys = plain
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const resolved = String(keys[index] || "");
    if (!resolved) return "";
    setForm((prev) => ({
      ...prev,
      key_entries: (prev.key_entries || []).map((entry, rowIndex) =>
        rowIndex === index ? { ...entry, api_key: resolved } : entry,
      ),
    }));
    return resolved;
  };

  const updateKeyRow = (rowId, patch = {}) => {
    setForm((prev) => ({
      ...prev,
      key_entries: (prev.key_entries || []).map((entry) =>
        entry.id === rowId ? { ...entry, ...patch } : entry,
      ),
    }));
  };

  const addKeyRow = () => {
    setForm((prev) => ({
      ...prev,
      key_entries: [...(prev.key_entries || []), createEmptyKeyRow()],
    }));
  };

  const removeKeyRow = (rowId) => {
    setForm((prev) => {
      const nextRows = (prev.key_entries || []).filter((entry) => entry.id !== rowId);
      return {
        ...prev,
        key_entries: nextRows.length ? nextRows : [createEmptyKeyRow()],
      };
    });
  };

  // ── Data loading ────────────────────────────────────────────────────────

  async function loadData() {
    setLoading(true);
    try {
      const res = await api.getSettings();
      if (res?.settings) {
        const list = Array.isArray(res.settings) ? res.settings : [];
        setSettings(list);
      }
      setMsg("");
    } catch (err) {
      console.error(err);
      if (err?.apiResponse?.permission_denied) {
        setMsg("You don't have permission to access this component.");
      } else {
        setMsg(err?.message || "Failed to load settings.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // ── Mutations ───────────────────────────────────────────────────────────

  const toggleModel = (model) => {
    setForm((prev) => {
      const exists = prev.models.includes(model);
      return {
        ...prev,
        models: exists
          ? prev.models.filter((m) => m !== model)
          : [...prev.models, model],
      };
    });
  };

  async function saveProvider() {
    setSaveBusy(true);
    setMsg("");
    const existing = currentProvider?.setting;
    const payload = {
      type: "api_key",
      name: existing?.name || selectedProvider,
      data: {
        models: form.models,
        key_entries: (form.key_entries || [])
          .map((entry) => ({
            ...entry,
            api_key: String(entry?.api_key || "").trim(),
            status:
              String(entry?.status || "active").toLowerCase() === "inactive"
                ? "inactive"
                : String(entry?.status || "active").toLowerCase() === "invalid"
                  ? "invalid"
                  : "active",
          }))
          .filter((entry) => entry.api_key),
        remain_credits: Number(form.remain_credits || 0),
      },
      status: currentProvider?.status || "ACTIVE",
    };
    try {
      await api.upsertSetting(payload);
      setMsg(`${currentProvDef.label} settings saved.`);
      await loadData();
    } catch (err) {
      const errMsg = err?.message || String(err || "Unknown error");
      setMsg(errMsg);
    } finally {
      setSaveBusy(false);
    }
  }

  async function toggleStatus() {
    const newStatus =
      String(currentProvider?.status || "").toUpperCase() === "ACTIVE"
        ? "INACTIVE"
        : "ACTIVE";
    setSaveBusy(true);
    try {
      const existing = currentProvider?.setting;
      if (existing) {
        await api.upsertSetting({
          type: "api_key",
          name: existing.name,
          data: existing.data,
          status: newStatus,
        });
      }
      setMsg(`${currentProvDef.label} ${newStatus}`);
      await loadData();
    } catch (err) {
      setMsg(err?.message || "Failed to update status.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function deleteProvider() {
    if (
      !(await confirm({
        title: "Delete provider settings?",
        message: `Delete ${currentProvDef.label} settings? This cannot be undone.`,
        confirmLabel: "Delete",
        tone: "danger",
      }))
    )
      return;
    setSaveBusy(true);
    try {
      const existing = currentProvider?.setting;
      if (existing) {
        await api.deleteSetting("api_key", existing.name);
      }
      setMsg(`${currentProvDef.label} deleted.`);
      await loadData();
    } catch (err) {
      setMsg(err?.message || "Failed to delete.");
    } finally {
      setSaveBusy(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const isActive =
    String(currentProvider?.status || "").toUpperCase() === "ACTIVE";

  return (
    <div className="stack-layout fadeIn" style={{ paddingBottom: 40 }}>
      <PageHeader title="Providers" />

      <MasterDetailLayout>
        {/* Left: Provider list */}
        <MasterDetailSidebarPanel label="PROVIDERS">
          {PROVIDERS.map((prov) => {
            const info = providerMap[prov.name];
            const ok = String(info?.status || "").toUpperCase() === "ACTIVE";
            return (
              <SidebarListItem
                key={prov.name}
                active={selectedProvider === prov.name}
                enabled={ok}
                title={prov.label}
                subtitle={prov.name}
                onClick={() => {
                  setSelectedProvider(prov.name);
                  navigate(
                    `/settings/providers/${encodeURIComponent(prov.name)}`,
                  );
                }}
              />
            );
          })}
        </MasterDetailSidebarPanel>

        {/* Right: Detail */}
        <MasterDetailContentPanel>
          {loading ? (
            <div className="minor-text">Loading...</div>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div className="stack-layout" style={{ gap: 2, flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>
                    {currentProvDef.label}
                  </div>
                  <span className="minor-text" style={{ fontSize: 11 }}>
                    {currentProvDef.name}
                  </span>
                </div>
                <TabBar
                  value={detailTab}
                  options={[
                    { label: "Settings", value: "settings" },
                    { label: "Logs", value: "logs" },
                  ]}
                  onChange={setDetailTab}
                  ariaLabel="Provider detail tab"
                />
              </div>

              {detailTab === "settings" ? (
                <>
                  <div className="stack-layout" style={{ gap: 6 }}>
                    <span className="panel-label" style={{ fontSize: 10 }}>
                      MODELS (COMMA OR NEWLINE)
                    </span>
                    <textarea
                      rows={4}
                      value={form.models.join("\n")}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          models: e.target.value
                            .split(/[\n,]/)
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }))
                      }
                    />
                  </div>

                  <div className="stack-layout" style={{ gap: 6 }}>
                    <span className="panel-label" style={{ fontSize: 10 }}>
                      API KEYS
                    </span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={async () => {
                          const plain = await revealApiKeys();
                          if (plain) {
                            const rows = plain
                              .split(/[\n,]/)
                              .map((item) => item.trim())
                              .filter(Boolean)
                              .map((apiKey, index) => ({
                                ...(form.key_entries?.[index] || createEmptyKeyRow()),
                                api_key: apiKey,
                              }));
                            setForm((prev) => ({
                              ...prev,
                              key_entries: rows.length ? rows : [createEmptyKeyRow()],
                            }));
                            setMsg(`${currentProvDef.label} keys revealed.`);
                          }
                        }}
                        disabled={saveBusy}
                      >
                        REVEAL ALL
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={addKeyRow}
                        disabled={saveBusy}
                      >
                        ADD KEY
                      </button>
                      <span className="minor-text" style={{ fontSize: 11 }}>
                        `active` joins rotation, `inactive` is skipped, `invalid` is auto-marked by runtime.
                      </span>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      {(form.key_entries || []).map((entry, index) => {
                        const status = String(entry?.status || "active").toLowerCase();
                        const invalid = status === "invalid" || entry?.invalid === true;
                        return (
                          <div
                            key={entry?.id || `${selectedProvider}-${index}`}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "minmax(0, 1fr) 120px 148px 90px",
                              gap: 8,
                              alignItems: "start",
                              padding: 10,
                              border: "1px solid var(--border)",
                              borderRadius: 10,
                            }}
                          >
                            <div className="stack-layout" style={{ gap: 4 }}>
                              <input
                                type="text"
                                value={String(entry?.api_key || "")}
                                placeholder={`API key ${index + 1}`}
                                onChange={(e) =>
                                  updateKeyRow(entry.id, { api_key: e.target.value })
                                }
                              />
                              {(entry?.invalid_reason || entry?.last_error || entry?.last_success_at) && (
                                <span
                                  className="minor-text"
                                  style={{
                                    fontSize: 11,
                                    color: invalid ? "var(--danger)" : undefined,
                                  }}
                                >
                                  {invalid
                                    ? String(entry?.invalid_reason || entry?.last_error || "Invalid key")
                                    : `Last success: ${String(entry?.last_success_at || entry?.last_checked_at || "")}`}
                                </span>
                              )}
                            </div>
                            <select
                              value={invalid ? "invalid" : status === "inactive" ? "inactive" : "active"}
                              onChange={(e) =>
                                updateKeyRow(entry.id, {
                                  status: e.target.value,
                                  invalid: e.target.value === "invalid",
                                })
                              }
                            >
                              <option value="active">active</option>
                              <option value="inactive">inactive</option>
                              <option value="invalid">invalid</option>
                            </select>
                            <div
                              style={{
                                display: "flex",
                                gap: 8,
                              }}
                            >
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={async () => {
                                  const resolved = isMaskedKeyLike(entry?.api_key)
                                    ? await revealKeyAtIndex(index)
                                    : String(entry?.api_key || "");
                                  if (resolved) {
                                    setMsg(`Revealed key ${index + 1}.`);
                                  }
                                }}
                                disabled={saveBusy}
                                title="Reveal key"
                              >
                                EYE
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={async () => {
                                  const resolved = isMaskedKeyLike(entry?.api_key)
                                    ? await revealKeyAtIndex(index)
                                    : String(entry?.api_key || "");
                                  if (!resolved) {
                                    setMsg(`Key ${index + 1} is empty.`);
                                    return;
                                  }
                                  await copyText(resolved);
                                  setMsg(`Copied key ${index + 1}.`);
                                }}
                                disabled={saveBusy}
                                title="Copy key"
                              >
                                COPY
                              </button>
                            </div>
                            <button
                              type="button"
                              className="danger-button"
                              onClick={() => removeKeyRow(entry.id)}
                              disabled={saveBusy}
                            >
                              REMOVE
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="stack-layout" style={{ gap: 6 }}>
                    <span className="panel-label">Remain Credits</span>
                    <input
                      type="number"
                      min="0"
                      value={form.remain_credits}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          remain_credits: Number(e.target.value),
                        }))
                      }
                      style={{ width: 160 }}
                    />
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      paddingTop: 20,
                      borderTop: "1px solid var(--border)",
                    }}
                  >
                    <ToggleButton
                      active={isActive}
                      classActive="secondary-button"
                      classInActive="primary-button"
                      labelActive="DEACTIVATE"
                      labelInActive="ACTIVATE"
                      onClick={toggleStatus}
                      disabled={saveBusy}
                    />
                    <button
                      className="danger-button"
                      onClick={deleteProvider}
                      disabled={saveBusy || !currentProvider?.setting}
                    >
                      DELETE
                    </button>
                    <div style={{ flex: 1 }} />
                    <button
                      className="primary-button"
                      onClick={saveProvider}
                      disabled={saveBusy}
                    >
                      {saveBusy ? "SAVING..." : "SAVE"}
                    </button>
                  </div>
                </>
              ) : (
                <LogsViewer
                  source="providers"
                  objectId={selectedProvider}
                  fileName=""
                  logFormat={null}
                  limit={200}
                  emptyText="No provider logs found."
                />
              )}
            </>
          )}
        </MasterDetailContentPanel>
      </MasterDetailLayout>

      {/* Global message */}
      {msg && (
        <div className="minor-text status-success" style={{ marginTop: 12 }}>
          {msg}
        </div>
      )}
    </div>
  );
}
