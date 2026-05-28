import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { showToast } from "../../components/ToastContainer";
import { parseTextList } from "../../utils/textList";
import { maskSecretPreview } from "../../utils/secrets";
import MasterDetailLayout from "../../components/MasterDetailLayout";
import SidebarListItem from "../../components/SidebarListItem";
import { useConfirmDialog } from "../../components/ConfirmDialog";

// Types excluded from Settings page (have their own dedicated pages)
const EXCLUDED_TYPES = new Set(["api_key", "cron", "system_config", "notification_config"]);

// Display labels for setting types
const TYPE_LABELS = { trade: "symbols" };
function typeLabel(t) { return TYPE_LABELS[String(t || "").toLowerCase()] || t; }

function settingStatusClass(status) {
  return (
    String(status || "")
      .trim()
      .toLowerCase() || "inactive"
  );
}

function parseSymbolText(value) {
  return parseTextList(value, { uppercase: true });
}

export default function SettingsPage() {
  const confirm = useConfirmDialog();
  const [settings, setSettings] = useState([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");
  const [revealedValues, setRevealedValues] = useState({});
  const [newSettingForm, setNewSettingForm] = useState({
    type: "note",
    name: "",
    value: "",
  });
  const [showAddForm, setShowAddForm] = useState(false);
  const [jsonDetailText, setJsonDetailText] = useState("");
  const [symbolsDetailText, setSymbolsDetailText] = useState("");
  const [activeTab, setActiveTab] = useState("");

  // ── Reveal helpers ────────────────────────────────────────────────────────

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
      setSettingsMsg(`${keyName}: empty value, nothing copied.`);
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
      setSettingsMsg(`${keyName} copied to clipboard.`);
    } catch (err) {
      setSettingsMsg(
        `${keyName} copy failed: ${err?.message || "clipboard error"}`,
      );
    }
  };

  // ── Sidebar item renderer ─────────────────────────────────────────────────

  function renderSidebarItem(s) {
    const key = getSettingKey(s);
    const active = String(s.status || "").toUpperCase() === "ACTIVE";
    return (
      <SidebarListItem
        key={key}
        active={activeTab === key}
        enabled={active}
        title={s.name}
        subtitle={typeLabel(s.type)}
        onClick={() => setActiveTab(key)}
      />
    );
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  async function loadData() {
    try {
      const sets = await api.getSettings();
      if (sets?.settings) {
        setSettings(Array.isArray(sets.settings) ? sets.settings : []);
      }
      setSettingsMsg("");
    } catch (err) {
      console.error(err);
      if (err.message !== "Not found") setSettingsMsg(err.message);
    }
  }

  useEffect(() => {
    loadData().then(() => {
      // Pick the first visible setting as the default active tab
      api.getSettings().then((res) => {
        const list = Array.isArray(res?.settings) ? res.settings : [];
        const firstVisible = list.find(
          (s) =>
            String(s?.type || "").toLowerCase() !== "api_key" &&
            String(s?.type || "").toLowerCase() !== "cron" &&
            !String(s?.type || "").endsWith("_cron"),
        );
        if (firstVisible) {
          setActiveTab(getSettingKey(firstVisible));
        }
      });
    });
  }, []);

  // ── Setting CRUD ──────────────────────────────────────────────────────────

  function updateSetting(settingKey, field, value) {
    setSettings((prev) =>
      prev.map((s) =>
        getSettingKey(s) === settingKey
          ? { ...s, data: { ...s.data, [field]: value } }
          : s,
      ),
    );
  }

  async function saveSetting(
    settingKey,
    dataOverride = null,
    statusOverride = null,
  ) {
    const s = settings.find((x) => getSettingKey(x) === settingKey);
    if (!s) {
      setSettingsMsg("Setting not found. Please select a setting first.");
      return;
    }
    setSettingsLoading(true);
    setSettingsMsg("");
    const payload = {
      type: s.type,
      name: s.name,
      data: dataOverride ?? s.data,
      status: statusOverride ?? s.status ?? "active",
    };
    try {
      await api.upsertSetting(payload);
      const successMsg = `Settings for ${s.type}/${s.name} saved.`;
      setSettingsMsg(successMsg);
      showToast({ message: successMsg, type: "success" });
      await loadData();
    } catch (err) {
      const errMsg = err?.message || String(err || "Unknown error");
      console.error("[saveSetting] error:", errMsg, err);
      setSettingsMsg(errMsg);
      showToast({ message: errMsg, type: "error" });
    } finally {
      setSettingsLoading(false);
      window.setTimeout(() => setSettingsMsg(""), 5000);
    }
  }

  async function deleteSetting(type, name) {
    if (
      !(await confirm({
        title: "Delete setting?",
        message: `Delete setting ${type}/${name}?`,
        confirmLabel: "Delete",
        tone: "danger",
      }))
    )
      return;
    setSettingsLoading(true);
    try {
      await api.deleteSetting(type, name || type);
      setSettingsMsg(`Setting ${type}/${name} deleted.`);
      setActiveTab("");
      await loadData();
    } catch (err) {
      setSettingsMsg(err.message);
    } finally {
      setSettingsLoading(false);
      window.setTimeout(() => setSettingsMsg(""), 3000);
    }
  }

  async function createSetting() {
    const { type, name, value } = newSettingForm;
    if (!type || !name) {
      setSettingsMsg("Type and Name are required.");
      return;
    }
    setSettingsLoading(true);
    try {
      let data;
      const lcType = String(type).toLowerCase();
      if (lcType === "symbols" || lcType === "trade") {
        const symbols = String(value || "")
          .split(/[\n,]/)
          .map((x) =>
            String(x || "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean);
        data = { symbols: [...new Set(symbols)] };
      } else {
        const parsed = JSON.parse(String(value || "{}"));
        data = parsed && typeof parsed === "object" ? parsed : {};
      }
      await api.upsertSetting({ type, name, data, status: "active" });
      setSettingsMsg(`Setting ${type}/${name} created.`);
      setShowAddForm(false);
      setNewSettingForm({ type: "note", name: "", value: "" });
      const newKey = `${type}::${name}`;
      setActiveTab(newKey);
      await loadData();
    } catch (err) {
      setSettingsMsg(err.message);
    } finally {
      setSettingsLoading(false);
      window.setTimeout(() => setSettingsMsg(""), 3000);
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const selectedSetting = useMemo(
    () => settings.find((s) => getSettingKey(s) === activeTab),
    [settings, activeTab],
  );

  const sidebarSettings = useMemo(
    () => settings.filter((s) => !EXCLUDED_TYPES.has(String(s.type || "").toLowerCase())),
    [settings],
  );

  // ── Detail text sync ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedSetting) {
      setJsonDetailText("");
      setSymbolsDetailText("");
      return;
    }
    const type = String(selectedSetting.type || "").toLowerCase();
    if (type === "symbols" || type === "trade") {
      const arr = Array.isArray(selectedSetting?.data?.symbols)
        ? selectedSetting.data.symbols
        : [];
      setSymbolsDetailText(
        arr
          .map((x) => String(x || "").trim())
          .filter(Boolean)
          .join("\n"),
      );
      setJsonDetailText("");
      return;
    }
    try {
      setJsonDetailText(JSON.stringify(selectedSetting?.data || {}, null, 2));
    } catch {
      setJsonDetailText("{}");
    }
    setSymbolsDetailText("");
  }, [
    activeTab,
    selectedSetting?.type,
    selectedSetting?.name,
    selectedSetting?.data,
  ]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="stack-layout fadeIn" style={{ paddingBottom: 40 }}>
      <h2 className="page-title">Settings</h2>

      <MasterDetailLayout className="settings-layout-v2">
        {/* ── Left: Sidebar ──────────────────────────────────────────────── */}
        <div className="panel stack-layout" style={{ gap: 2, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span className="panel-label" style={{ marginBottom: 0 }}>SETTINGS</span>
            <button className="secondary-button" style={{ padding: "3px 8px", fontSize: 10 }} onClick={() => { setNewSettingForm({ type: "note", name: "", value: "" }); setShowAddForm(true); }}>+ New</button>
          </div>

          {/* Add new setting form */}
          {showAddForm && (
            <div
              className="stack-layout fadeIn"
              style={{
                gap: 10,
                paddingBottom: 16,
                borderBottom: "1px solid var(--border)",
                marginBottom: 16,
              }}
            >
              <label className="stack-layout" style={{ gap: 4 }}>
                <span className="minor-text" style={{ fontSize: 10 }}>
                  Type
                </span>
                <select
                  style={{ width: "100%" }}
                  value={newSettingForm.type}
                  onChange={(e) =>
                    setNewSettingForm((p) => ({ ...p, type: e.target.value }))
                  }
                >
                  <option value="note">note</option>
                  <option value="symbols">symbols</option>
                  <option value="trade">trade (watchlist)</option>
                </select>
              </label>
              <label className="stack-layout" style={{ gap: 4 }}>
                <span className="minor-text" style={{ fontSize: 10 }}>
                  Name
                </span>
                <input
                  placeholder="e.g. Watchlist"
                  value={newSettingForm.name}
                  onChange={(e) =>
                    setNewSettingForm((p) => ({ ...p, name: e.target.value }))
                  }
                />
              </label>
              <label className="stack-layout" style={{ gap: 4 }}>
                <span className="minor-text" style={{ fontSize: 10 }}>
                  Initial Value
                </span>
                <textarea
                  rows={3}
                  placeholder="JSON or text"
                  value={newSettingForm.value}
                  onChange={(e) =>
                    setNewSettingForm((p) => ({ ...p, value: e.target.value }))
                  }
                />
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="primary-button"
                  onClick={createSetting}
                  disabled={settingsLoading}
                >
                  CREATE
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setShowAddForm(false)}
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}

          {/* Settings list */}
          <div className="stack-layout" style={{ gap: 0 }}>
            {sidebarSettings.map((s) => renderSidebarItem(s))}
            {sidebarSettings.length === 0 && !settingsLoading && (
              <span className="minor-text" style={{ padding: "8px 12px" }}>
                No settings yet.
              </span>
            )}
          </div>
        </div>

        {/* ── Right: Detail ──────────────────────────────────────────────── */}
        <div className="panel stack-layout" style={{ gap: 16, padding: 24 }}>
          {/* Selected setting detail */}
          {selectedSetting && (
            <>
              <div>
                <input
                  value={selectedSetting.name}
                  readOnly
                  style={{ fontSize: 16, fontWeight: 700, border: "none", background: "transparent", color: "inherit", width: "100%", outline: "none", paddingLeft: 0, opacity: 0.7 }}
                />
                <span className="minor-text" style={{ fontSize: 11 }}>Type: {typeLabel(selectedSetting.type)}</span>
              </div>

              {/* Detail renderer by type */}
              {String(selectedSetting.type || "").toLowerCase() === "note" ? (
                <div className="stack-layout" style={{ gap: 10 }}>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Content</span>
                    <textarea
                      rows={20}
                      style={{
                        fontSize: 14,
                        lineHeight: 1.5,
                        padding: 16,
                        fontFamily: "inherit",
                      }}
                      value={String(selectedSetting.data?.value || "")}
                      onChange={(e) => {
                        updateSetting(
                          getSettingKey(selectedSetting),
                          "value",
                          e.target.value,
                        );
                      }}
                      placeholder="Write your notes here..."
                    />
                  </label>
                </div>
              ) : String(selectedSetting.type || "").toLowerCase() ===
                  "symbols" ||
                String(selectedSetting.type || "").toLowerCase() === "trade" ? (
                <div className="stack-layout" style={{ gap: 10 }}>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Symbols (one per line)</span>
                    <textarea
                      rows={15}
                      value={symbolsDetailText}
                      onChange={(e) => {
                        setSymbolsDetailText(e.target.value);
                      }}
                      onBlur={(e) => {
                        const text = e.target.value;
                        const arr = text
                          .split(/[\n,]/)
                          .map((x) =>
                            String(x || "")
                              .trim()
                              .toUpperCase(),
                          )
                          .filter(Boolean);
                        setSettings((prev) =>
                          prev.map((x) =>
                            getSettingKey(x) === getSettingKey(selectedSetting)
                              ? {
                                  ...x,
                                  data: {
                                    ...(x.data || {}),
                                    symbols: [...new Set(arr)],
                                  },
                                }
                              : x,
                          ),
                        );
                      }}
                    />
                  </label>
                </div>
              ) : (
                <div className="stack-layout" style={{ gap: 6 }}>
                  <span className="panel-label" style={{ fontSize: 10 }}>JSON CONFIGURATION</span>
                  <textarea
                    rows={16}
                    style={{ fontFamily: "monospace", fontSize: 11 }}
                    value={jsonDetailText}
                    onChange={(e) => {
                      setJsonDetailText(e.target.value);
                      try {
                        const parsed = JSON.parse(String(e.target.value || "{}"));
                        setSettings((prev) => prev.map((x) => getSettingKey(x) === getSettingKey(selectedSetting) ? { ...x, data: parsed } : x));
                      } catch {}
                    }}
                  />
                </div>
              )}

              {/* Actions */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingTop: 20,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className={String(selectedSetting.status).toUpperCase() === "ACTIVE" ? "secondary-button" : "primary-button"}
                    style={{ padding: "12px 24px", fontSize: 14 }}
                    onClick={() => {
                      const newStatus = String(selectedSetting.status).toUpperCase() === "ACTIVE" ? "INACTIVE" : "ACTIVE";
                      setSettings((prev) => prev.map((s) => getSettingKey(s) === getSettingKey(selectedSetting) ? { ...s, status: newStatus } : s));
                    }}
                    disabled={settingsLoading}
                  >
                    {String(selectedSetting.status).toUpperCase() === "ACTIVE" ? "DEACTIVATE" : "ACTIVATE"}
                  </button>
                  {!EXCLUDED_TYPES.has(String(selectedSetting.type || "")) && (
                    <button
                      className="danger-button"
                      style={{ padding: "12px 24px", fontSize: 14 }}
                      onClick={() => deleteSetting(selectedSetting.type, selectedSetting.name)}
                      disabled={settingsLoading}
                    >
                      DELETE
                    </button>
                  )}
                </div>
                <button
                  className="primary-button"
                  style={{ padding: "12px 32px", fontSize: 14 }}
                  onClick={() => saveSetting(getSettingKey(selectedSetting))}
                  disabled={settingsLoading}
                >
                  {settingsLoading ? "SAVING..." : "SAVE"}
                </button>
              </div>

              {settingsMsg && (
                <div
                  className="minor-text"
                  style={{ marginTop: 16, color: "var(--success)" }}
                >
                  {settingsMsg}
                </div>
              )}
            </>
          )}

          {!selectedSetting && (
            <span className="minor-text">Select a setting to view details.</span>
          )}
        </div>
      </MasterDetailLayout>
    </div>
  );
}
