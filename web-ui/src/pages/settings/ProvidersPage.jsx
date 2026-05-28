import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { showToast } from "../../components/ToastContainer";

// ── Provider definitions ──────────────────────────────────────────────────

const PROVIDERS = [
  {
    name: "GEMINI_API_KEY",
    label: "Gemini",
    models: [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
    ],
  },
  {
    name: "OPENAI_API_KEY",
    label: "OpenAI",
    models: ["gpt-4o", "gpt-4.1", "gpt-4o-mini", "o3-mini"],
  },
  {
    name: "DEEPSEEK_API_KEY",
    label: "DeepSeek",
    models: ["deepseek-chat", "deepseek-r1"],
  },
  {
    name: "CLAUDE_API_KEY",
    label: "Claude",
    models: [
      "claude-sonnet-4-0",
      "claude-sonnet-4-20250514",
      "claude-3.5-sonnet",
    ],
  },
  {
    name: "OPENROUTER_API_KEY",
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
    name: "TWELVE_DATA_API_KEY",
    label: "Twelve Data",
    models: [],
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function maskSecretPreview(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (raw.length <= 8) return `${raw.slice(0, 1)}****${raw.slice(-1)}`;
  return `${raw.slice(0, 4)}****${raw.slice(-4)}`;
}

function normalizeProviderName(raw) {
  const s = String(raw || "").toUpperCase().replace(/\s+/g, "_");
  // Map old names
  if (s === "GEMINI" || s === "GOOGLE_GEMINI") return "GEMINI_API_KEY";
  if (s === "OPENAI") return "OPENAI_API_KEY";
  if (s === "DEEPSEEK") return "DEEPSEEK_API_KEY";
  if (s === "CLAUDE" || s === "ANTHROPIC") return "CLAUDE_API_KEY";
  if (s === "OPENROUTER") return "OPENROUTER_API_KEY";
  if (s === "TWELVE_DATA" || s === "TWELVEDATA") return "TWELVE_DATA_API_KEY";
  return s;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ProvidersPage() {
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [revealedValues, setRevealedValues] = useState({});
  const [selectedProvider, setSelectedProvider] = useState("GEMINI_API_KEY");
  const [saveBusy, setSaveBusy] = useState(false);

  // ── Derived ─────────────────────────────────────────────────────────────

  const apiKeySettings = useMemo(
    () =>
      settings.filter(
        (s) => String(s.type || "").toLowerCase() === "api_key",
      ),
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

  const [form, setForm] = useState({ models: [], api_key: "", remain_credits: 0 });

  useEffect(() => {
    if (currentProvider) {
      const dbModels = currentProvider.data.models || [];
      const defaultModels = currentProvDef?.models || [];
      setForm({
        models: dbModels.length > 0 ? [...dbModels] : [...defaultModels],
        api_key: currentProvider.data.api_key,
        remain_credits: currentProvider.data.remain_credits,
      });
    }
  }, [selectedProvider, currentProvider?.data?.api_key]);

  // ── Reveal helpers ──────────────────────────────────────────────────────

  const getRevealKey = () => `api_key::${selectedProvider}::api_key`;
  const isRevealed = () => Boolean(revealedValues[getRevealKey()]);
  const getRevealedValue = () => revealedValues[getRevealKey()] || "";

  const showRevealed = (plainValue) => {
    setRevealedValues((prev) => ({ ...prev, [getRevealKey()]: plainValue }));
  };
  const hideRevealed = () => {
    setRevealedValues((prev) => {
      const key = getRevealKey();
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const copySecretToClipboard = async (value, keyName = "Secret") => {
    const text = String(value || "");
    if (!text) {
      setMsg(`${keyName}: empty value, nothing copied.`);
      return;
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
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
      setMsg(`${keyName} copied to clipboard.`);
    } catch (err) {
      setMsg(`${keyName} copy failed: ${err?.message || "clipboard error"}`);
    }
  };

  const revealApiKey = async () => {
    try {
      const out = await api.getSettingSecret(
        "api_key",
        selectedProvider,
        "api_key",
      );
      const plain = String(out?.value || "");
      showRevealed(plain);
      return plain;
    } catch (err) {
      setMsg(err?.message || "Failed to reveal secret.");
      return "";
    }
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
      setMsg(err?.message || "Failed to load settings.");
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
        api_key: String(form.api_key || ""),
        remain_credits: Number(form.remain_credits || 0),
      },
      status: currentProvider?.status || "ACTIVE",
    };
    try {
      await api.upsertSetting(payload);
      showToast({
        message: `${currentProvDef.label} settings saved.`,
        type: "success",
      });
      await loadData();
    } catch (err) {
      const errMsg = err?.message || String(err || "Unknown error");
      setMsg(errMsg);
      showToast({ message: errMsg, type: "error" });
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
      showToast({
        message: `${currentProvDef.label} ${newStatus}`,
        type: "success",
      });
      await loadData();
    } catch (err) {
      setMsg(err?.message || "Failed to update status.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function deleteProvider() {
    if (
      !window.confirm(
        `Delete ${currentProvDef.label} settings? This cannot be undone.`,
      )
    )
      return;
    setSaveBusy(true);
    try {
      const existing = currentProvider?.setting;
      if (existing) {
        await api.deleteSetting("api_key", existing.name);
      }
      showToast({
        message: `${currentProvDef.label} deleted.`,
        type: "success",
      });
      await loadData();
    } catch (err) {
      setMsg(err?.message || "Failed to delete.");
    } finally {
      setSaveBusy(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const visible = isRevealed();
  const showApiKey = visible ? getRevealedValue() : form.api_key;

  const isActive = String(currentProvider?.status || "").toUpperCase() === "ACTIVE";

  return (
    <div className="stack-layout fadeIn" style={{ paddingBottom: 40 }}>
      <h2 className="page-title">Providers</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "280px 1fr",
          gap: 24,
          marginTop: 12,
        }}
      >
        {/* Left: Provider list */}
        <div className="panel stack-layout" style={{ gap: 2, padding: 12 }}>
          <div className="panel-label" style={{ marginBottom: 8 }}>
            PROVIDERS
          </div>
          {PROVIDERS.map((prov) => {
            const info = providerMap[prov.name];
            const ok =
              String(info?.status || "").toUpperCase() === "ACTIVE";
            return (
              <button
                key={prov.name}
                className={`sidebar-item-v2 ${selectedProvider === prov.name ? "active" : ""}`}
                onClick={() => setSelectedProvider(prov.name)}
                style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 6, padding: "8px 12px" }}
              >
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: ok ? "#22c55e" : "#666", flexShrink: 0 }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontWeight: 700, fontSize: 12 }}>{prov.label}</span>
                  <span className="minor-text" style={{ fontSize: 9 }}>{prov.name}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: Edit form */}
        <div className="panel stack-layout" style={{ gap: 16, padding: 24 }}>
          {loading ? (
            <div className="minor-text">Loading...</div>
          ) : (
            <>
              {/* Header */}
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{currentProvDef.label}</div>
                <span className="minor-text" style={{ fontSize: 11 }}>{currentProvDef.name}</span>
              </div>

              {/* Models */}
              <div className="stack-layout" style={{ gap: 6 }}>
                <span className="panel-label" style={{ fontSize: 10 }}>MODELS (COMMA OR NEWLINE)</span>
                <textarea
                  rows={4}
                  value={form.models.join("\n")}
                  onChange={(e) => setForm((prev) => ({ ...prev, models: e.target.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) }))}
                />
              </div>

              {/* API Key */}
              <div className="stack-layout" style={{ gap: 6 }}>
                <span className="panel-label" style={{ fontSize: 10 }}>API KEY</span>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <input
                    type={visible ? "text" : "password"}
                    value={showApiKey}
                    readOnly={visible}
                    onChange={
                      visible
                        ? undefined
                        : (e) =>
                            setForm((prev) => ({
                              ...prev,
                              api_key: e.target.value,
                            }))
                    }
                    style={{ flex: 1 }}
                    placeholder="Enter API key..."
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ padding: "4px 8px", fontSize: 11 }}
                    onClick={async () => {
                      if (!visible) {
                        await revealApiKey();
                      } else {
                        hideRevealed();
                      }
                    }}
                    title={visible ? "Hide" : "Reveal"}
                  >
                    {visible ? "Hide" : "Eye"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ padding: "4px 8px", fontSize: 11 }}
                    onClick={async () => {
                      const plain = await revealApiKey();
                      if (plain) {
                        await copySecretToClipboard(plain, "API Key");
                      } else {
                        setMsg("API Key: empty value, nothing copied.");
                      }
                    }}
                    title="Copy decrypted value"
                  >
                    Copy
                  </button>
                </div>
                {!visible && form.api_key && (
                  <span
                    className="minor-text"
                    style={{ fontSize: 10, opacity: 0.9 }}
                  >
                    {maskSecretPreview(form.api_key)}
                  </span>
                )}
              </div>

              {/* Remain Credits */}
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

              {/* Actions */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  paddingTop: 20,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <button
                  className={isActive ? "secondary-button" : "primary-button"}
                  style={{ padding: "12px 24px", fontSize: 14 }}
                  onClick={toggleStatus}
                  disabled={saveBusy}
                >
                  {isActive ? "DEACTIVATE" : "ACTIVATE"}
                </button>
                <button
                  className="danger-button"
                  style={{ padding: "12px 24px", fontSize: 14 }}
                  onClick={deleteProvider}
                  disabled={saveBusy || !currentProvider?.setting}
                >
                  DELETE
                </button>
                <div style={{ flex: 1 }} />
                <button
                  className="primary-button"
                  style={{ padding: "12px 32px", fontSize: 14 }}
                  onClick={saveProvider}
                  disabled={saveBusy}
                >
                  {saveBusy ? "SAVING..." : "SAVE"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Global message */}
      {msg && (
        <div
          className="minor-text"
          style={{ color: "var(--success)", marginTop: 12 }}
        >
          {msg}
        </div>
      )}
    </div>
  );
}
