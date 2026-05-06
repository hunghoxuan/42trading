import { useEffect, useMemo, useState } from "react";
import { getRuntimeApiKey, setRuntimeApiKey, api } from "../../api";
import UserDetailSection from "../../components/UserDetailSection";
import { EventsPageContent } from "../system/EventsPage";
import { normalizeDisplayTimezone } from "../../utils/format";

const ROUTE_OPTIONS = [
  { value: "ea", label: "EA Client (MT5)" },
  { value: "v2", label: "v2 Broker Executor" },
  { value: "ctrader", label: "cTrader Bridge" },
];

const API_KEY_NAME_OPTIONS = [
  { value: "GEMINI_API_KEY", label: "Gemini API Key" },
  { value: "OPENAI_API_KEY", label: "OpenAI API Key" },
  { value: "DEEPSEEK_API_KEY", label: "DeepSeek API Key" },
  { value: "CLAUDE_API_KEY", label: "Claude API Key" },
  { value: "OPENROUTER_API_KEY", label: "OpenRouter API Key" },
  { value: "TWELVE_DATA_API_KEY", label: "Twelve Data API Key" },
];

const SYSTEM_SETTING_TYPES = new Set(["system_config"]);
const TIMEFRAME_OPTIONS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
const DISPLAY_TIMEZONE_OPTIONS = [
  { value: "Local", label: "Local (Browser)" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "New York (America/New_York)" },
];

function isSystemRole(user) {
  return (
    String(user?.role || "")
      .trim()
      .toLowerCase() === "system"
  );
}

function settingStatusClass(status) {
  return (
    String(status || "")
      .trim()
      .toLowerCase() || "inactive"
  );
}

function parseSymbolText(value) {
  return parseTextList(value, true);
}

function parseTextList(value, uppercase = false) {
  return [
    ...new Set(
      String(value || "")
        .split(/[\n,]/)
        .map((s) => {
          const trimmed = s.trim();
          return uppercase ? trimmed.toUpperCase() : trimmed;
        })
        .filter(Boolean),
    ),
  ];
}

export default function SettingsPage({
  authUser,
  mode = "settings",
  onUserUpdate,
}) {
  const [profileLoading, setProfileLoading] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [profileForm, setProfileForm] = useState({
    name: "",
    email: "",
    role: "User",
    is_active: true,
  });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [settings, setSettings] = useState([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");
  const [secretVisibility, setSecretVisibility] = useState({});
  const [newSettingForm, setNewSettingForm] = useState({
    type: "api_key",
    name: "GEMINI_API_KEY",
    value: "",
  });
  const [showAddForm, setShowAddForm] = useState(false);
  const [jsonDetailText, setJsonDetailText] = useState("");
  const [symbolsDetailText, setSymbolsDetailText] = useState("");
  const [cronForm, setCronForm] = useState({
    symbols: "",
    exclude_symbols: "",
    timeframes: [],
    cadence_minutes: 60,
    provider: "twelvedata",
    timezone: "America/New_York",
    batch_size: 8,
    model: "claude-sonnet-4-0",
    profile: "",
    entry_models: "",
    directions: ["BUY", "SELL"],
    order_types: ["market", "limit", "stop"],
    prompt: "",
  });
  const [metadataForm, setMetadataForm] = useState({
    language: "English",
    display_timezone: "Local",
    market_data_cron: true,
    ai_analysis_cron: true,
  });
  const [metadataLoading, setMetadataLoading] = useState(false);

  const canManageExecution = isSystemRole(authUser);
  const [execLoading, setExecLoading] = useState(false);
  const [execMsg, setExecMsg] = useState("");
  const [execProfiles, setExecProfiles] = useState([]);
  const [execAccounts, setExecAccounts] = useState([]);
  const [execForm, setExecForm] = useState({
    profile_id: "default",
    profile_name: "default",
    route: "ea",
    account_id: "",
    source_ids_csv: "signal,tradingview",
    ctrader_account_id: "",
  });
  const [logConfig, setLogConfig] = useState([]);
  const [logBusy, setLogBusy] = useState(false);
  const LOG_GROUPS = ["OTHERS_", "SIGNAL_", "ACCOUNT_", "AI_", "SYSTEM_"];

  // Sidebar state
  const [activeTab, setActiveTab] = useState(
    mode === "profile" ? "PROFILE" : "PROFILE",
  );

  const getSettingKey = (s) =>
    `${String(s?.type || "")}::${String(s?.name || "")}`;
  const getSecretKey = (settingKey, fieldKey) =>
    `${String(settingKey || "")}::${String(fieldKey || "")}`;
  const isSecretVisible = (settingKey, fieldKey) =>
    Boolean(secretVisibility[getSecretKey(settingKey, fieldKey)]);
  const toggleSecretVisible = (settingKey, fieldKey) => {
    const key = getSecretKey(settingKey, fieldKey);
    setSecretVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const maskSecretPreview = (value) => {
    const raw = String(value || "");
    if (!raw) return "";
    if (raw.length <= 8) return `${raw.slice(0, 1)}****${raw.slice(-1)}`;
    return `${raw.slice(0, 4)}****${raw.slice(-4)}`;
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
  const revealApiKeyField = async (setting, fieldKey = "value") => {
    const settingKey = getSettingKey(setting);
    try {
      const out = await api.getSettingSecret(
        setting.type,
        setting.name,
        fieldKey,
      );
      const plain = String(out?.value || "");
      setSettings((prev) =>
        prev.map((x) => {
          if (getSettingKey(x) !== settingKey) return x;
          return { ...x, data: { ...(x.data || {}), [fieldKey]: plain } };
        }),
      );
      return plain;
    } catch (err) {
      setSettingsMsg(err?.message || "Failed to reveal secret.");
      return "";
    }
  };

  function renderSidebarItem(s) {
    const key = getSettingKey(s);
    const isCron = s.type === "cron" || s.type.endsWith("_cron");
    return (
      <button
        key={key}
        className={`sidebar-item-v2 ${activeTab === key ? "active" : ""}`}
        onClick={() => setActiveTab(key)}
        style={{ padding: "6px 10px", minHeight: "auto", marginBottom: 2 }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
          }}
        >
          <span style={{ fontWeight: isCron ? 700 : 500, fontSize: 12 }}>
            {s.name}
          </span>
        </div>
        <span
          className={`status-badge ${settingStatusClass(s.status)}`}
          style={{ fontSize: 8, padding: "2px 4px" }}
        >
          {s.status}
        </span>
      </button>
    );
  }

  async function loadData() {
    try {
      const [prof, exec, sets] = await Promise.all([
        api.authProfile(),
        canManageExecution ? api.v2ExecutionProfiles() : Promise.resolve(null),
        api.getSettings(),
      ]);

      if (prof?.user) {
        setProfileForm({
          name: String(prof.user.name || ""),
          email: String(prof.user.email || ""),
          role: String(prof.user.role || "User"),
          is_active: Boolean(prof.user.is_active),
        });
        const metaSettings = prof.user.metadata?.settings || {};
        const tz = normalizeDisplayTimezone(
          metaSettings.display_timezone || "Local",
        );
        localStorage.setItem("ui_display_timezone", tz);
        setMetadataForm({
          language: metaSettings.language || "English",
          display_timezone: tz,
          market_data_cron: metaSettings.market_data_cron !== false,
          ai_analysis_cron: metaSettings.ai_analysis_cron !== false,
        });
      }

      if (exec) {
        const accounts = Array.isArray(exec.accounts) ? exec.accounts : [];
        const items = Array.isArray(exec.items) ? exec.items : [];
        const active =
          exec.active_profile || items.find((x) => x?.is_active) || null;
        setExecAccounts(accounts);
        setExecProfiles(items);
        if (active) {
          const sourceIds = Array.isArray(active.source_ids)
            ? active.source_ids
            : [];
          setExecForm({
            profile_id: String(active.profile_id || "default"),
            profile_name: String(active.profile_name || "default"),
            route: String(active.route || "ea"),
            account_id: String(
              active.account_id || accounts?.[0]?.account_id || "",
            ),
            source_ids_csv: sourceIds.length
              ? sourceIds.join(",")
              : "signal,tradingview",
            ctrader_mode: String(active.ctrader_mode || "demo"),
            ctrader_account_id: String(active.ctrader_account_id || ""),
          });
        } else if (accounts.length > 0) {
          setExecForm((prev) => ({
            ...prev,
            account_id: String(accounts[0].account_id || ""),
          }));
        }
      }

      if (sets?.settings) {
        const list = Array.isArray(sets.settings) ? sets.settings : [];
        setSettings(list);
        const logSet = list.find(
          (x) =>
            x?.type === "system_config" && x?.name === "enabled_log_prefixes",
        );
        let val = logSet?.data?.prefixes;
        setLogConfig(Array.isArray(val) ? val : []);
      }
      setMsg("");
    } catch (err) {
      console.error(err);
      if (err.message !== "Not found") setMsg(err.message);
    }
  }

  useEffect(() => {
    loadData().then(() => {
      if (mode === "settings") {
        // If we have settings, pick the first one as default active tab
        api.getSettings().then((res) => {
          const list = Array.isArray(res?.settings) ? res.settings : [];
          if (list.length > 0) {
            setActiveTab(getSettingKey(list[0]));
          }
        });
      } else {
        setActiveTab("PROFILE");
      }
    });
  }, [authUser?.user_id, mode]);

  async function saveMyAccount() {
    const name = String(profileForm.name || "").trim();
    const mail = String(profileForm.email || "").trim();
    if (!name || !mail) {
      setMsg("Name and email are required.");
      return;
    }
    setProfileLoading(true);
    try {
      await api.updateAuthProfile(name, mail);
      if (onUserUpdate) {
        onUserUpdate({ ...authUser, name, email: mail });
      }
      setMsg("Profile updated.");
    } catch (err) {
      setMsg(err?.message || "Failed to update profile.");
    } finally {
      setProfileLoading(false);
      window.setTimeout(() => setMsg(""), 2500);
    }
  }

  async function resetPassword() {
    if (!currentPassword || !newPassword) {
      setMsg("Enter current and new password.");
      return;
    }
    if (newPassword.length < 4) {
      setMsg("New password must be at least 4 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMsg("New password and confirm password do not match.");
      return;
    }
    setPwdLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMsg("Password updated.");
    } catch (err) {
      setMsg(err?.message || "Failed to update password.");
    } finally {
      setPwdLoading(false);
      window.setTimeout(() => setMsg(""), 2500);
    }
  }

  async function savePreferences() {
    setMetadataLoading(true);
    try {
      const normalizedTz = normalizeDisplayTimezone(
        metadataForm.display_timezone,
      );
      const nextSettings = { ...metadataForm, display_timezone: normalizedTz };
      await api.updateMetadata({ settings: nextSettings });
      localStorage.setItem("ui_display_timezone", normalizedTz);
      setMetadataForm(nextSettings);
      if (onUserUpdate) {
        const nextUser = {
          ...authUser,
          metadata: { ...authUser.metadata, settings: nextSettings },
        };
        onUserUpdate(nextUser);
      }
      setMsg("Preferences saved.");
    } catch (err) {
      setMsg(err?.message || "Failed to save preferences.");
    } finally {
      setMetadataLoading(false);
      window.setTimeout(() => setMsg(""), 2500);
    }
  }

  async function updateSetting(settingKey, field, value) {
    const s = settings.find((x) => getSettingKey(x) === settingKey);
    if (!s) return;
    const nextData = { ...s.data, [field]: value };
    setSettings((prev) =>
      prev.map((x) =>
        getSettingKey(x) === settingKey ? { ...x, data: nextData } : x,
      ),
    );
  }

  async function saveSetting(
    settingKey,
    dataOverride = null,
    statusOverride = null,
  ) {
    const s = settings.find((x) => getSettingKey(x) === settingKey);
    if (!s) return;
    setSettingsLoading(true);
    setSettingsMsg("");
    try {
      await api.upsertSetting({
        type: s.type,
        name: s.name,
        data: dataOverride || s.data,
        status: statusOverride || s.status,
      });
      setSettingsMsg(`Settings for ${s.type}/${s.name} saved.`);
      await loadData();
    } catch (err) {
      setSettingsMsg(err.message);
    } finally {
      setSettingsLoading(false);
      window.setTimeout(() => setSettingsMsg(""), 3000);
    }
  }

  async function deleteSetting(type, name) {
    if (!window.confirm(`Delete setting ${type}?`)) return;
    setSettingsLoading(true);
    try {
      await api.deleteSetting(type, name || type);
      setSettingsMsg(`Setting ${type} deleted.`);
      setActiveTab("PROFILE");
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
      let data = { value: String(value || "") };
      if (
        String(type).toLowerCase() === "symbols" ||
        String(type).toLowerCase() === "trade"
      ) {
        const symbols = String(value || "")
          .split(/[\n,]/)
          .map((x) =>
            String(x || "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean);
        data = { symbols: [...new Set(symbols)] };
      } else if (String(type).toLowerCase() !== "api_key") {
        const parsed = JSON.parse(String(value || "{}"));
        data = parsed && typeof parsed === "object" ? parsed : {};
      }
      await api.upsertSetting({ type, name, data, status: "active" });
      setSettingsMsg(`Setting ${type} created.`);
      setShowAddForm(false);
      setNewSettingForm({ type: "api_key", name: "GEMINI_API_KEY", value: "" });
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

  async function applyExecutionProfile() {
    const route = String(execForm.route || "")
      .trim()
      .toLowerCase();
    const accountId = String(execForm.account_id || "").trim();
    if (!accountId) {
      setExecMsg("Select an account.");
      return;
    }
    const sourceIds = String(execForm.source_ids_csv || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    setExecLoading(true);
    try {
      await api.v2ApplyExecutionProfile({
        profile_id:
          String(execForm.profile_id || "default").trim() || "default",
        profile_name:
          String(execForm.profile_name || "default").trim() || "default",
        route,
        account_id: accountId,
        source_ids: sourceIds,
        ctrader_mode:
          route === "ctrader" ? String(execForm.ctrader_mode || "demo") : "",
        ctrader_account_id:
          route === "ctrader"
            ? String(execForm.ctrader_account_id || "").trim()
            : "",
      });
      setExecMsg("Profile applied.");
      await loadData();
    } catch (error) {
      setExecMsg(error?.message || "Failed to apply profile");
    } finally {
      setExecLoading(false);
      window.setTimeout(() => setExecMsg(""), 4000);
    }
  }

  async function saveLoggingConfig(next) {
    setLogBusy(true);
    try {
      await api.upsertSetting({
        type: "system_config",
        name: "enabled_log_prefixes",
        data: { prefixes: next },
        status: "active",
      });
      setLogConfig(next);
      setMsg("Logging configuration updated.");
    } catch (err) {
      setMsg(err.message);
    } finally {
      setLogBusy(false);
      window.setTimeout(() => setMsg(""), 3000);
    }
  }

  const selectedSetting = useMemo(
    () => settings.find((s) => getSettingKey(s) === activeTab),
    [settings, activeTab],
  );
  const marketDataCronSetting = useMemo(
    () =>
      settings.find((s) => s.type === "cron" && s.name === "MARKET_DATA_CRON"),
    [settings],
  );
  const aiAnalysisCronSetting = useMemo(
    () => settings.find((s) => s.type === "cron" && s.name === "ANALYSIS_CRON"),
    [settings],
  );

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
    if (type === "api_key") {
      setJsonDetailText("");
      setSymbolsDetailText("");
      return;
    }
    if (type === "cron") {
      const d = selectedSetting?.data || {};
      setCronForm({
        symbols: Array.isArray(d.symbols) ? d.symbols.join(", ") : "",
        exclude_symbols: Array.isArray(d.exclude_symbols)
          ? d.exclude_symbols.join(", ")
          : "",
        timeframes: Array.isArray(d.timeframes) ? d.timeframes : [],
        cadence_minutes: Number(d.cadence_minutes || 60),
        provider: String(d.provider || "twelvedata"),
        timezone: String(d.timezone || "America/New_York"),
        batch_size: Number(d.batch_size || 8),
        model: String(d.model || "claude-sonnet-4-0"),
        profile: String(d.profile || ""),
        entry_models: Array.isArray(d.entry_models)
          ? d.entry_models.join(", ")
          : "",
        directions: Array.isArray(d.directions)
          ? d.directions
          : ["BUY", "SELL"],
        order_types: Array.isArray(d.order_types)
          ? d.order_types
          : ["market", "limit", "stop"],
        prompt: String(d.prompt || ""),
      });
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

  return (
    <div className="stack-layout fadeIn" style={{ paddingBottom: 40 }}>
      <h2 className="page-title">
        {mode === "profile" ? "Profile" : "Settings"}
      </h2>

      <div
        className="settings-layout-v2"
        style={{
          display: "grid",
          gridTemplateColumns: "280px 1fr",
          gap: 24,
          marginTop: 12,
        }}
      >
        {/* Left: Sidebar */}
        <section className="panel" style={{ margin: 0 }}>
          <div className="panel-label">CATEGORIES</div>
          <div className="stack-layout" style={{ gap: 2 }}>
            <button
              className={`sidebar-item-v2 ${activeTab === "PROFILE" ? "active" : ""}`}
              onClick={() => setActiveTab("PROFILE")}
            >
              Profile
            </button>
            <button
              className={`sidebar-item-v2 ${activeTab === "NOTIFICATIONS" ? "active" : ""}`}
              onClick={() => setActiveTab("NOTIFICATIONS")}
            >
              Notifications
            </button>
          </div>

          <div
            style={{ height: 1, background: "var(--border)", margin: "16px 0" }}
          />

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
                  onChange={(e) => {
                    const nextType = e.target.value;
                    setNewSettingForm((p) => ({
                      ...p,
                      type: nextType,
                      name:
                        nextType === "api_key"
                          ? p.name || "GEMINI_API_KEY"
                          : p.name,
                    }));
                  }}
                >
                  <option value="api_key">api_key</option>
                  <option value="trade">trade</option>
                  <option value="cron">cron</option>
                  <option value="note">note</option>
                </select>
              </label>
              <label className="stack-layout" style={{ gap: 4 }}>
                <span className="minor-text" style={{ fontSize: 10 }}>
                  Name
                </span>
                {newSettingForm.type === "api_key" ? (
                  <select
                    value={newSettingForm.name}
                    onChange={(e) =>
                      setNewSettingForm((p) => ({ ...p, name: e.target.value }))
                    }
                  >
                    {API_KEY_NAME_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    placeholder="e.g. Watchlist"
                    value={newSettingForm.name}
                    onChange={(e) =>
                      setNewSettingForm((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                )}
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

          <div className="stack-layout" style={{ gap: 24, marginTop: 16 }}>
            {/* API KEYS GROUP */}
            <div className="stack-layout" style={{ gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div
                  className="panel-label"
                  style={{ margin: 0, opacity: 0.8 }}
                >
                  API_KEY
                </div>
                <button
                  className="secondary-button"
                  style={{ padding: "2px 8px", fontSize: 10 }}
                  onClick={() => {
                    setNewSettingForm({
                      type: "api_key",
                      name: "GEMINI_API_KEY",
                      value: "",
                    });
                    setShowAddForm(true);
                  }}
                >
                  + Add
                </button>
              </div>
              <div className="stack-layout" style={{ gap: 0 }}>
                {settings
                  .filter((s) => s.type === "api_key")
                  .map((s) => renderSidebarItem(s))}
              </div>
            </div>

            {/* CRONS GROUP */}
            <div className="stack-layout" style={{ gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div
                  className="panel-label"
                  style={{ margin: 0, opacity: 0.8 }}
                >
                  CRON
                </div>
                <button
                  className="secondary-button"
                  style={{ padding: "2px 8px", fontSize: 10 }}
                  onClick={() => {
                    setNewSettingForm({ type: "cron", name: "", value: "" });
                    setShowAddForm(true);
                  }}
                >
                  + Add
                </button>
              </div>
              <div className="stack-layout" style={{ gap: 0 }}>
                {settings
                  .filter(
                    (s) =>
                      (s.type === "cron" || s.type.endsWith("_cron")) &&
                      s.name !== "enabled_log_prefixes",
                  )
                  .map((s) => renderSidebarItem(s))}
              </div>
            </div>

            {/* WATCHLISTS GROUP */}
            <div className="stack-layout" style={{ gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div
                  className="panel-label"
                  style={{ margin: 0, opacity: 0.8 }}
                >
                  OTHERS
                </div>
                <button
                  className="secondary-button"
                  style={{ padding: "2px 8px", fontSize: 10 }}
                  onClick={() => {
                    setNewSettingForm({ type: "others", name: "", value: "" });
                    setShowAddForm(true);
                  }}
                >
                  + Add
                </button>
              </div>
              <div className="stack-layout" style={{ gap: 0 }}>
                {settings
                  .filter((s) => s.type === "trade" || s.type === "symbols")
                  .map((s) => renderSidebarItem(s))}
              </div>
            </div>

            {/* OTHERS GROUP */}
            {settings.filter(
              (s) =>
                ![
                  "api_key",
                  "cron",
                  "trade",
                  "symbols",
                  "system_config",
                ].includes(s.type) && !s.type.endsWith("_cron"),
            ).length > 0 && (
              <div className="stack-layout" style={{ gap: 8 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div
                    className="panel-label"
                    style={{ margin: 0, opacity: 0.8 }}
                  >
                    OTHERS
                  </div>
                  <button
                    className="secondary-button"
                    style={{ padding: "2px 8px", fontSize: 10 }}
                    onClick={() => {
                      setNewSettingForm({ type: "note", name: "", value: "" });
                      setShowAddForm(true);
                    }}
                  >
                    + Add
                  </button>
                </div>
                <div className="stack-layout" style={{ gap: 0 }}>
                  {settings
                    .filter(
                      (s) =>
                        !["api_key", "cron", "trade", "symbols"].includes(
                          s.type,
                        ) && !s.type.endsWith("_cron"),
                    )
                    .map((s) => renderSidebarItem(s))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right: Detail */}
        <section
          className="panel"
          style={{ margin: 0, minHeight: 600, overflowY: "auto" }}
        >
          {activeTab === "PROFILE" && (
            <div
              className="fadeIn"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 32,
              }}
            >
              {/* COLUMN 1: IDENTITY & SECURITY */}
              <div className="stack-layout" style={{ gap: 40 }}>
                {/* SECTION: IDENTITY */}
                <div className="stack-layout" style={{ gap: 16 }}>
                  <div className="panel-label">IDENTITY</div>
                  <UserDetailSection
                    title=""
                    form={profileForm}
                    setForm={setProfileForm}
                    roleOptions={[String(profileForm.role || "User")]}
                    showRole={false}
                    showActive={false}
                    showPassword={false}
                    primaryLabel={profileLoading ? "SAVING..." : "SAVE CHANGES"}
                    onPrimary={saveMyAccount}
                    primaryDisabled={profileLoading}
                  />
                  {msg && !pwdLoading && !metadataLoading && !execLoading && (
                    <div
                      className="fadeIn"
                      style={{
                        color: "var(--primary)",
                        fontSize: 13,
                        marginTop: -8,
                      }}
                    >
                      {msg}
                    </div>
                  )}
                </div>

                {/* SECTION: SECURITY */}
                <div className="stack-layout" style={{ gap: 16 }}>
                  <div className="panel-label">SECURITY</div>
                  <div className="stack-layout" style={{ gap: 16 }}>
                    <label className="stack-layout" style={{ gap: 6 }}>
                      <span className="minor-text">Current Password</span>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                    </label>
                    <label className="stack-layout" style={{ gap: 6 }}>
                      <span className="minor-text">New Password</span>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </label>
                    <label className="stack-layout" style={{ gap: 6 }}>
                      <span className="minor-text">Confirm New Password</span>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </label>
                    <button
                      className="primary-button"
                      style={{ width: "100%" }}
                      onClick={resetPassword}
                      disabled={pwdLoading}
                    >
                      {pwdLoading ? "UPDATING..." : "UPDATE PASSWORD"}
                    </button>
                  </div>
                </div>
              </div>

              {/* COLUMN 2: APP PREFERENCES & EXECUTION ENGINE */}
              <div className="stack-layout" style={{ gap: 40 }}>
                {/* SECTION: APP PREFERENCES */}
                <div className="stack-layout" style={{ gap: 16 }}>
                  <div className="panel-label">APP PREFERENCES</div>
                  <div className="stack-layout" style={{ gap: 20 }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 16,
                      }}
                    >
                      <label className="stack-layout" style={{ gap: 6 }}>
                        <span className="minor-text">Language</span>
                        <select
                          value={metadataForm.language}
                          onChange={(e) =>
                            setMetadataForm((p) => ({
                              ...p,
                              language: e.target.value,
                            }))
                          }
                        >
                          <option value="English">English</option>
                          <option value="Vietnamese">Vietnamese</option>
                          <option value="Deutsch">Deutsch</option>
                        </select>
                      </label>
                      <label className="stack-layout" style={{ gap: 6 }}>
                        <span className="minor-text">Display Timezone</span>
                        <select
                          value={metadataForm.display_timezone}
                          onChange={(e) =>
                            setMetadataForm((p) => ({
                              ...p,
                              display_timezone: e.target.value,
                            }))
                          }
                        >
                          {DISPLAY_TIMEZONE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 16,
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={metadataForm.market_data_cron}
                          onChange={(e) =>
                            setMetadataForm((p) => ({
                              ...p,
                              market_data_cron: e.target.checked,
                            }))
                          }
                        />
                        <span className="minor-text">Market Data Cron</span>
                      </label>
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={metadataForm.ai_analysis_cron}
                          onChange={(e) =>
                            setMetadataForm((p) => ({
                              ...p,
                              ai_analysis_cron: e.target.checked,
                            }))
                          }
                        />
                        <span className="minor-text">AI Analysis Cron</span>
                      </label>
                    </div>
                    <button
                      className="primary-button"
                      onClick={savePreferences}
                      disabled={metadataLoading}
                    >
                      {metadataLoading ? "SAVING..." : "SAVE PREFERENCES"}
                    </button>
                  </div>
                </div>

                {/* SECTION: EXECUTION ENGINE */}
                {canManageExecution && (
                  <div className="stack-layout" style={{ gap: 16 }}>
                    <div className="panel-label">EXECUTION ENGINE</div>
                    <div className="stack-layout" style={{ gap: 16 }}>
                      <label className="stack-layout" style={{ gap: 6 }}>
                        <span className="minor-text">Account</span>
                        <select
                          value={execForm.account_id}
                          onChange={(e) =>
                            setExecForm((p) => ({
                              ...p,
                              account_id: e.target.value,
                            }))
                          }
                        >
                          <option value="">Select account</option>
                          {execAccounts.map((a) => (
                            <option key={a.account_id} value={a.account_id}>
                              {a.name || a.account_id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 16,
                        }}
                      >
                        <label className="stack-layout" style={{ gap: 6 }}>
                          <span className="minor-text">Route</span>
                          <select
                            value={execForm.route}
                            onChange={(e) =>
                              setExecForm((p) => ({
                                ...p,
                                route: e.target.value,
                              }))
                            }
                          >
                            {ROUTE_OPTIONS.map((x) => (
                              <option key={x.value} value={x.value}>
                                {x.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="stack-layout" style={{ gap: 6 }}>
                          <span className="minor-text">Sources (CSV)</span>
                          <input
                            value={execForm.source_ids_csv}
                            onChange={(e) =>
                              setExecForm((p) => ({
                                ...p,
                                source_ids_csv: e.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>
                      <button
                        className="primary-button"
                        onClick={applyExecutionProfile}
                        disabled={execLoading}
                      >
                        {execLoading ? "APPLYING..." : "APPLY EXECUTION"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {selectedSetting && (
            <div className="fadeIn">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: 24,
                }}
              >
                <div>
                  <h3 style={{ margin: 0, textTransform: "uppercase" }}>
                    {selectedSetting.name}
                  </h3>
                  <div className="minor-text" style={{ marginTop: 4 }}>
                    Type: {selectedSetting.type}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <select
                    style={{
                      padding: "4px 8px",
                      fontSize: 11,
                      borderRadius: 4,
                      background: "var(--surface)",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                    }}
                    value={String(
                      selectedSetting.status || "INACTIVE",
                    ).toUpperCase()}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSettings((prev) =>
                        prev.map((s) =>
                          getSettingKey(s) === getSettingKey(selectedSetting)
                            ? { ...s, status: val }
                            : s,
                        ),
                      );
                    }}
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </select>

                  <button
                    className="primary-button"
                    onClick={() => {
                      if (selectedSetting.type === "cron") {
                        const nextData = {
                          ...selectedSetting.data,
                          provider: cronForm.provider,
                          timezone: cronForm.timezone,
                          batch_size: cronForm.batch_size,
                          symbols: parseSymbolText(cronForm.symbols),
                          exclude_symbols: parseSymbolText(
                            cronForm.exclude_symbols,
                          ),
                          timeframes: cronForm.timeframes,
                          cadence_minutes: cronForm.cadence_minutes,
                          model: cronForm.model,
                          profile: cronForm.profile,
                          entry_models: parseTextList(cronForm.entry_models),
                          directions: cronForm.directions,
                          order_types: cronForm.order_types,
                          prompt: cronForm.prompt,
                        };
                        saveSetting(
                          getSettingKey(selectedSetting),
                          nextData,
                          selectedSetting.status,
                        );
                      } else {
                        saveSetting(getSettingKey(selectedSetting));
                      }
                    }}
                    disabled={settingsLoading}
                  >
                    SAVE
                  </button>

                  {!SYSTEM_SETTING_TYPES.has(
                    String(selectedSetting.type || ""),
                  ) && (
                    <button
                      className="danger-button"
                      onClick={() =>
                        deleteSetting(
                          selectedSetting.type,
                          selectedSetting.name,
                        )
                      }
                      disabled={settingsLoading}
                    >
                      DELETE
                    </button>
                  )}
                </div>
              </div>

              {selectedSetting.type === "cron" ? (
                <div
                  className="stack-layout fadeIn"
                  style={{ gap: 20, maxWidth: 600 }}
                >
                  {selectedSetting.type === "cron" &&
                    selectedSetting.name === "MARKET_DATA_CRON" && (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr",
                          gap: 12,
                        }}
                      >
                        <label className="stack-layout" style={{ gap: 6 }}>
                          <span className="minor-text">Provider</span>
                          <select
                            value={cronForm.provider}
                            onChange={(e) =>
                              setCronForm((p) => ({
                                ...p,
                                provider: e.target.value,
                              }))
                            }
                          >
                            <option value="twelvedata">Twelve Data</option>
                          </select>
                        </label>
                        <label className="stack-layout" style={{ gap: 6 }}>
                          <span className="minor-text">Display Timezone</span>
                          <input
                            value={cronForm.timezone}
                            onChange={(e) =>
                              setCronForm((p) => ({
                                ...p,
                                timezone: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="stack-layout" style={{ gap: 6 }}>
                          <span className="minor-text">Batch Size</span>
                          <input
                            type="number"
                            min="1"
                            max="50"
                            value={cronForm.batch_size}
                            onChange={(e) =>
                              setCronForm((p) => ({
                                ...p,
                                batch_size: Number(e.target.value),
                              }))
                            }
                          />
                        </label>
                      </div>
                    )}

                  <div className="stack-layout" style={{ gap: 8 }}>
                    <span
                      className="panel-label"
                      style={{ fontSize: 10, marginBottom: 0 }}
                    >
                      SYMBOLS (COMMA OR NEWLINE)
                    </span>
                    <textarea
                      rows={3}
                      value={cronForm.symbols}
                      onChange={(e) =>
                        setCronForm((p) => ({ ...p, symbols: e.target.value }))
                      }
                      placeholder="e.g. XAUUSD, EURUSD, BTCUSD"
                    />
                  </div>

                  <div className="stack-layout" style={{ gap: 8 }}>
                    <span
                      className="panel-label"
                      style={{ fontSize: 10, marginBottom: 0 }}
                    >
                      EXCLUDE SYMBOLS (COMMA OR NEWLINE)
                    </span>
                    <textarea
                      rows={2}
                      value={cronForm.exclude_symbols}
                      onChange={(e) =>
                        setCronForm((p) => ({
                          ...p,
                          exclude_symbols: e.target.value,
                        }))
                      }
                      placeholder="e.g. XAUUSD (skip these)"
                    />
                  </div>

                  <div className="stack-layout" style={{ gap: 8 }}>
                    <span
                      className="panel-label"
                      style={{ fontSize: 10, marginBottom: 0 }}
                    >
                      TIMEFRAMES
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                      {TIMEFRAME_OPTIONS.map((tf) => (
                        <label
                          key={tf}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={cronForm.timeframes.includes(tf)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...cronForm.timeframes, tf]
                                : cronForm.timeframes.filter((x) => x !== tf);
                              setCronForm((p) => ({ ...p, timeframes: next }));
                            }}
                          />
                          <span style={{ fontSize: 13 }}>{tf}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {selectedSetting.type === "cron" &&
                    selectedSetting.name === "ANALYSIS_CRON" && (
                      <>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 12,
                          }}
                        >
                          <label className="stack-layout" style={{ gap: 8 }}>
                            <span
                              className="panel-label"
                              style={{ fontSize: 10, marginBottom: 0 }}
                            >
                              DIRECTIONS
                            </span>
                            <div style={{ display: "flex", gap: 12 }}>
                              {["BUY", "SELL"].map((direction) => (
                                <label
                                  key={direction}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={cronForm.directions.includes(
                                      direction,
                                    )}
                                    onChange={(e) => {
                                      const next = e.target.checked
                                        ? [...cronForm.directions, direction]
                                        : cronForm.directions.filter(
                                            (x) => x !== direction,
                                          );
                                      setCronForm((p) => ({
                                        ...p,
                                        directions: next,
                                      }));
                                    }}
                                  />
                                  <span style={{ fontSize: 13 }}>
                                    {direction}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </label>
                          <label className="stack-layout" style={{ gap: 8 }}>
                            <span
                              className="panel-label"
                              style={{ fontSize: 10, marginBottom: 0 }}
                            >
                              ORDER TYPES
                            </span>
                            <div style={{ display: "flex", gap: 12 }}>
                              {["market", "limit", "stop"].map((orderType) => (
                                <label
                                  key={orderType}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={cronForm.order_types.includes(
                                      orderType,
                                    )}
                                    onChange={(e) => {
                                      const next = e.target.checked
                                        ? [...cronForm.order_types, orderType]
                                        : cronForm.order_types.filter(
                                            (x) => x !== orderType,
                                          );
                                      setCronForm((p) => ({
                                        ...p,
                                        order_types: next,
                                      }));
                                    }}
                                  />
                                  <span style={{ fontSize: 13 }}>
                                    {orderType}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </label>
                        </div>
                        <div className="stack-layout" style={{ gap: 8 }}>
                          <span
                            className="panel-label"
                            style={{ fontSize: 10, marginBottom: 0 }}
                          >
                            CADENCE (MINUTES)
                          </span>
                          <input
                            type="number"
                            value={cronForm.cadence_minutes}
                            onChange={(e) =>
                              setCronForm((p) => ({
                                ...p,
                                cadence_minutes: Number(e.target.value),
                              }))
                            }
                          />
                        </div>
                        <div className="stack-layout" style={{ gap: 8 }}>
                          <span
                            className="panel-label"
                            style={{ fontSize: 10, marginBottom: 0 }}
                          >
                            MODEL
                          </span>
                          <select
                            value={cronForm.model}
                            onChange={(e) =>
                              setCronForm((p) => ({
                                ...p,
                                model: e.target.value,
                              }))
                            }
                          >
                            {API_KEY_NAME_OPTIONS.map((opt) => (
                              <option
                                key={opt.value}
                                value={opt.value
                                  .replace("_API_KEY", "")
                                  .toLowerCase()}
                              >
                                {opt.label.replace(" API Key", "")}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="stack-layout" style={{ gap: 8 }}>
                          <span
                            className="panel-label"
                            style={{ fontSize: 10, marginBottom: 0 }}
                          >
                            PROFILE
                          </span>
                          <input
                            value={cronForm.profile}
                            onChange={(e) =>
                              setCronForm((p) => ({
                                ...p,
                                profile: e.target.value,
                              }))
                            }
                            placeholder="Optional AI/profile name"
                          />
                        </div>
                        <div className="stack-layout" style={{ gap: 8 }}>
                          <span
                            className="panel-label"
                            style={{ fontSize: 10, marginBottom: 0 }}
                          >
                            ENTRY MODELS (COMMA OR NEWLINE)
                          </span>
                          <textarea
                            rows={3}
                            value={cronForm.entry_models}
                            onChange={(e) =>
                              setCronForm((p) => ({
                                ...p,
                                entry_models: e.target.value,
                              }))
                            }
                            placeholder="Order Block, FVG, ICT..."
                          />
                        </div>
                        <div className="stack-layout" style={{ gap: 8 }}>
                          <span
                            className="panel-label"
                            style={{ fontSize: 10, marginBottom: 0 }}
                          >
                            PROMPT
                          </span>
                          <textarea
                            rows={6}
                            value={cronForm.prompt}
                            onChange={(e) =>
                              setCronForm((p) => ({
                                ...p,
                                prompt: e.target.value,
                              }))
                            }
                            placeholder="Instructions for AI setup detection..."
                          />
                        </div>
                      </>
                    )}

                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      background: "var(--surface-deep)",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div className="panel-label" style={{ fontSize: 9 }}>
                      RAW DATA PREVIEW
                    </div>
                    <pre style={{ fontSize: 11, margin: 0 }}>
                      {JSON.stringify(
                        {
                          provider: cronForm.provider,
                          timezone: cronForm.timezone,
                          batch_size: cronForm.batch_size,
                          symbols: parseSymbolText(cronForm.symbols),
                          exclude_symbols: parseSymbolText(
                            cronForm.exclude_symbols,
                          ),
                          timeframes: cronForm.timeframes,
                          cadence_minutes: cronForm.cadence_minutes,
                          model: cronForm.model,
                          profile: cronForm.profile,
                          entry_models: parseTextList(cronForm.entry_models),
                          directions: cronForm.directions,
                          order_types: cronForm.order_types,
                          prompt: cronForm.prompt,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                  {selectedSetting?.data?.last_sync && (
                    <div
                      style={{
                        padding: 12,
                        background: "var(--surface-deep)",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                      }}
                    >
                      <div className="panel-label" style={{ fontSize: 9 }}>
                        LAST SYNC
                      </div>
                      <pre
                        style={{
                          fontSize: 11,
                          margin: 0,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {JSON.stringify(
                          selectedSetting.data.last_sync,
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  )}
                </div>
              ) : selectedSetting.type === "api_key" ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 20,
                  }}
                >
                  {Object.entries(selectedSetting.data || {}).map(
                    ([key, val]) => {
                      const settingKey = getSettingKey(selectedSetting);
                      const visible = isSecretVisible(settingKey, key);
                      return (
                        <label
                          key={key}
                          className="stack-layout"
                          style={{ gap: 6 }}
                        >
                          <span className="minor-text" style={{ fontSize: 11 }}>
                            {key}
                          </span>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                            }}
                          >
                            <input
                              type={visible ? "text" : "password"}
                              value={val || ""}
                              onChange={(e) =>
                                updateSetting(settingKey, key, e.target.value)
                              }
                            />
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ padding: "4px 8px", fontSize: 11 }}
                              onClick={async () => {
                                if (!visible) {
                                  await revealApiKeyField(selectedSetting, key);
                                }
                                toggleSecretVisible(settingKey, key);
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
                                const plain = await revealApiKeyField(
                                  selectedSetting,
                                  key,
                                );
                                if (!plain) {
                                  setSettingsMsg(
                                    `${key}: empty value, nothing copied.`,
                                  );
                                  return;
                                }
                                await copySecretToClipboard(plain, key);
                              }}
                              title="Copy decrypted value to clipboard"
                            >
                              Copy
                            </button>
                          </div>
                          {!visible && (
                            <span
                              className="minor-text"
                              style={{ fontSize: 10, opacity: 0.9 }}
                            >
                              {maskSecretPreview(val)}
                            </span>
                          )}
                        </label>
                      );
                    },
                  )}
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
                <div className="stack-layout" style={{ gap: 20 }}>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">JSON Configuration</span>
                    <textarea
                      rows={20}
                      value={jsonDetailText}
                      onChange={(e) => setJsonDetailText(e.target.value)}
                    />
                  </label>
                  <button
                    className="secondary-button"
                    style={{ alignSelf: "flex-start" }}
                    onClick={() => {
                      try {
                        const parsed = JSON.parse(
                          String(jsonDetailText || "{}"),
                        );
                        setSettings((prev) =>
                          prev.map((x) =>
                            getSettingKey(x) === getSettingKey(selectedSetting)
                              ? { ...x, data: parsed }
                              : x,
                          ),
                        );
                        setSettingsMsg("JSON applied. Click SAVE to persist.");
                      } catch (err) {
                        setSettingsMsg(`Invalid JSON: ${err?.message}`);
                      }
                    }}
                  >
                    APPLY JSON
                  </button>
                </div>
              )}

              {settingsMsg && (
                <div
                  className="minor-text"
                  style={{ marginTop: 16, color: "var(--success)" }}
                >
                  {settingsMsg}
                </div>
              )}
            </div>
          )}

          {activeTab === "NOTIFICATIONS" && <EventsPageContent />}

          {!activeTab && !selectedSetting && (
            <div className="empty-state">Select a setting to view details.</div>
          )}
        </section>
      </div>
    </div>
  );
}
