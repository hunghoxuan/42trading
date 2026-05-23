import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { showToast } from "../../components/ToastContainer";

// ── Constants (copied from SettingsPage) ────────────────────────────────────

const API_KEY_NAME_OPTIONS = [
  { value: "GEMINI_API_KEY", label: "Gemini API Key" },
  { value: "OPENAI_API_KEY", label: "OpenAI API Key" },
  { value: "DEEPSEEK_API_KEY", label: "DeepSeek API Key" },
  { value: "CLAUDE_API_KEY", label: "Claude API Key" },
  { value: "OPENROUTER_API_KEY", label: "OpenRouter API Key" },
  { value: "TWELVE_DATA_API_KEY", label: "Twelve Data API Key" },
];
const STANDARD_API_KEY_NAMES = API_KEY_NAME_OPTIONS.map((x) => x.value);

// ── Helpers ─────────────────────────────────────────────────────────────────

function maskSecretPreview(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (raw.length <= 8) return `${raw.slice(0, 1)}****${raw.slice(-1)}`;
  return `${raw.slice(0, 4)}****${raw.slice(-4)}`;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ProvidersPage() {
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [revealedValues, setRevealedValues] = useState({});
  const [newSettingForm, setNewSettingForm] = useState({
    type: "api_key",
    name: "GEMINI_API_KEY",
    value: "",
  });
  const [showAddForm, setShowAddForm] = useState(false);
  const [saveBusyKeys, setSaveBusyKeys] = useState({});

  // ── Derived ─────────────────────────────────────────────────────────────

  const apiKeySettings = useMemo(
    () => settings.filter((s) => String(s.type || "").toLowerCase() === "api_key"),
    [settings],
  );

  // ── Reveal helpers ──────────────────────────────────────────────────────

  const getSettingKey = (s) =>
    `${String(s?.type || "")}::${String(s?.name || "")}`;
  const getRevealKey = (settingKey, fieldKey) =>
    `${String(settingKey || "")}::${String(fieldKey || "")}`;
  const isRevealed = (settingKey, fieldKey) =>
    Boolean(revealedValues[getRevealKey(settingKey, fieldKey)]);
  const getRevealedValue = (settingKey, fieldKey) =>
    revealedValues[getRevealKey(settingKey, fieldKey)] || "";
  const showRevealed = (settingKey, fieldKey, plainValue) => {
    const key = getRevealKey(settingKey, fieldKey);
    setRevealedValues((prev) => ({ ...prev, [key]: plainValue }));
  };
  const hideRevealed = (settingKey, fieldKey) => {
    const key = getRevealKey(settingKey, fieldKey);
    setRevealedValues((prev) => {
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

  const revealApiKeyField = async (setting, fieldKey = "value") => {
    const settingKey = getSettingKey(setting);
    try {
      const out = await api.getSettingSecret(
        setting.type,
        setting.name,
        fieldKey,
      );
      const plain = String(out?.value || "");
      showRevealed(settingKey, fieldKey, plain);
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
        const existingApiNames = new Set(
          list
            .filter((x) => String(x?.type || "").toLowerCase() === "api_key")
            .map((x) => String(x?.name || "").toUpperCase()),
        );
        const missingApiRows = STANDARD_API_KEY_NAMES.filter(
          (name) => !existingApiNames.has(name),
        ).map((name) => ({
          type: "api_key",
          name,
          status: "INACTIVE",
          data: { value: "" },
        }));
        setSettings([...list, ...missingApiRows]);
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

  function updateSettingField(settingKey, field, value) {
    setSettings((prev) =>
      prev.map((x) =>
        getSettingKey(x) === settingKey
          ? { ...x, data: { ...x.data, [field]: value } }
          : x,
      ),
    );
  }

  async function saveSetting(s, statusOverride = null) {
    const key = getSettingKey(s);
    setSaveBusyKeys((prev) => ({ ...prev, [key]: true }));
    setMsg("");
    const payload = {
      type: s.type,
      name: s.name,
      data: s.data,
      status: statusOverride ?? s.status ?? "ACTIVE",
    };
    try {
      await api.upsertSetting(payload);
      const successMsg = `Settings for ${s.type}/${s.name} saved.`;
      showToast({ message: successMsg, type: "success" });
      await loadData();
    } catch (err) {
      const errMsg = err?.message || String(err || "Unknown error");
      setMsg(errMsg);
      showToast({ message: errMsg, type: "error" });
    } finally {
      setSaveBusyKeys((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  async function deleteSetting(s) {
    if (!window.confirm(`Delete setting ${s.type}/${s.name}?`)) return;
    setLoading(true);
    try {
      await api.deleteSetting(s.type, s.name);
      setMsg(`Setting ${s.type}/${s.name} deleted.`);
      await loadData();
    } catch (err) {
      setMsg(err?.message || "Failed to delete setting.");
    } finally {
      setLoading(false);
      window.setTimeout(() => setMsg(""), 3000);
    }
  }

  async function createSetting() {
    const { type, name, value } = newSettingForm;
    if (!type || !name) {
      setMsg("Type and Name are required.");
      return;
    }
    setLoading(true);
    try {
      const data = { value: String(value || "") };
      await api.upsertSetting({ type, name, data, status: "ACTIVE" });
      setMsg(`Setting ${type}/${name} created.`);
      setShowAddForm(false);
      setNewSettingForm({ type: "api_key", name: "GEMINI_API_KEY", value: "" });
      await loadData();
    } catch (err) {
      setMsg(err?.message || "Failed to create setting.");
    } finally {
      setLoading(false);
      window.setTimeout(() => setMsg(""), 3000);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="stack-layout fadeIn">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 className="page-title">Providers (API Keys)</h1>
        <button
          className={showAddForm ? "secondary-button active" : "primary-button"}
          style={{ padding: "10px 20px", fontSize: 13 }}
          onClick={() => setShowAddForm((prev) => !prev)}
        >
          {showAddForm ? "Cancel" : "+ Add API Key"}
        </button>
      </div>

      {/* ── Add new form ──────────────────────────────────────────────── */}
      {showAddForm && (
        <div
          className="panel stack-layout"
          style={{ gap: 12, padding: 20 }}
        >
          <span className="panel-label">New API Key</span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <label className="stack-layout" style={{ gap: 4 }}>
              <span className="minor-text">Type</span>
              <input
                type="text"
                value={newSettingForm.type}
                readOnly
              />
            </label>
            <label className="stack-layout" style={{ gap: 4 }}>
              <span className="minor-text">Name</span>
              <select
                value={newSettingForm.name}
                onChange={(e) =>
                  setNewSettingForm((prev) => ({
                    ...prev,
                    name: e.target.value,
                  }))
                }
              >
                {API_KEY_NAME_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="stack-layout" style={{ gap: 4 }}>
            <span className="minor-text">Value</span>
            <textarea
              rows={3}
              value={newSettingForm.value}
              onChange={(e) =>
                setNewSettingForm((prev) => ({
                  ...prev,
                  value: e.target.value,
                }))
              }
              placeholder="Enter API key value..."
            />
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              className="primary-button"
              style={{ padding: "8px 24px", fontSize: 13 }}
              onClick={createSetting}
              disabled={loading}
            >
              {loading ? "CREATING..." : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* ── Global message ────────────────────────────────────────────── */}
      {msg && (
        <div className="minor-text" style={{ color: "var(--success)" }}>
          {msg}
        </div>
      )}

      {/* ── Loading ───────────────────────────────────────────────────── */}
      {loading && apiKeySettings.length === 0 && (
        <div className="minor-text">Loading API keys...</div>
      )}

      {/* ── Grid of API key settings ──────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 20,
        }}
      >
        {apiKeySettings.map((s) => {
          const settingKey = getSettingKey(s);
          const isBusy = Boolean(saveBusyKeys[settingKey]);
          const isActive =
            String(s?.status || "").toUpperCase() === "ACTIVE";

          return (
            <div
              key={settingKey}
              className="panel stack-layout"
              style={{ gap: 12, padding: 20 }}
            >
              {/* Header row */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span className="panel-label" style={{ fontSize: 14 }}>
                  {s.name}
                </span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span
                    className="minor-text"
                    style={{
                      color: isActive ? "var(--success)" : "var(--muted)",
                      fontWeight: 600,
                    }}
                  >
                    {isActive ? "ACTIVE" : "INACTIVE"}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ padding: "4px 10px", fontSize: 11 }}
                    onClick={() => {
                      const nextStatus = isActive ? "INACTIVE" : "ACTIVE";
                      saveSetting(
                        { ...s, status: nextStatus },
                        nextStatus,
                      );
                    }}
                    title={isActive ? "Deactivate" : "Activate"}
                  >
                    {isActive ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>

              {/* Data fields */}
              {Object.entries(s.data || {}).map(([fieldKey, val]) => {
                const visible = isRevealed(settingKey, fieldKey);
                return (
                  <label
                    key={fieldKey}
                    className="stack-layout"
                    style={{ gap: 4 }}
                  >
                    <span className="minor-text" style={{ fontSize: 11 }}>
                      {fieldKey}
                    </span>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "center",
                      }}
                    >
                      <input
                        type={visible ? "text" : "password"}
                        value={
                          visible
                            ? getRevealedValue(settingKey, fieldKey)
                            : String(val || "")
                        }
                        readOnly={visible}
                        onChange={
                          visible
                            ? undefined
                            : (e) =>
                                updateSettingField(
                                  settingKey,
                                  fieldKey,
                                  e.target.value,
                                )
                        }
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ padding: "4px 8px", fontSize: 11 }}
                        onClick={async () => {
                          if (!visible) {
                            await revealApiKeyField(s, fieldKey);
                          } else {
                            hideRevealed(settingKey, fieldKey);
                          }
                        }}
                        title={visible ? "Hide value" : "Show value"}
                      >
                        {visible ? "Hide" : "Eye"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ padding: "4px 8px", fontSize: 11 }}
                        onClick={async () => {
                          const plain = await revealApiKeyField(s, fieldKey);
                          if (!plain) {
                            setMsg(`${fieldKey}: empty value, nothing copied.`);
                            return;
                          }
                          await copySecretToClipboard(plain, fieldKey);
                        }}
                        title="Copy decrypted value to clipboard"
                      >
                        Copy
                      </button>
                    </div>
                    {!visible && String(val || "").length > 0 && (
                      <span
                        className="minor-text"
                        style={{ fontSize: 10, opacity: 0.9 }}
                      >
                        {maskSecretPreview(val)}
                      </span>
                    )}
                  </label>
                );
              })}

              {/* If no data fields */}
              {Object.keys(s.data || {}).length === 0 && (
                <div className="minor-text">No data fields.</div>
              )}

              {/* Actions */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                  paddingTop: 8,
                  borderTop: "1px solid var(--border)",
                  marginTop: 4,
                }}
              >
                <button
                  type="button"
                  className="danger-button"
                  style={{ padding: "6px 16px", fontSize: 12 }}
                  onClick={() => deleteSetting(s)}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="primary-button"
                  style={{ padding: "6px 24px", fontSize: 12 }}
                  onClick={() => saveSetting(s)}
                  disabled={isBusy}
                >
                  {isBusy ? "SAVING..." : "Save"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Empty state ────────────────────────────────────────────────── */}
      {!loading && apiKeySettings.length === 0 && (
        <div className="minor-text">No API key settings found.</div>
      )}
    </div>
  );
}
