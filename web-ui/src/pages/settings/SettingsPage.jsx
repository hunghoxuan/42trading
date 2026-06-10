import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api";
import { showToast } from "../../components/ToastContainer";
import { formatRelativeDurationMs } from "../../utils/format";
import { parseTextList } from "../../utils/textList";
import { maskSecretPreview } from "../../utils/secrets";
import {
  normalizeSymbolGroupsData,
  makeSymbolGroupId,
  RESERVED_SYMBOL_GROUP_IDS,
} from "../../utils/symbolGroups";
import MasterDetailLayout from "../../components/MasterDetailLayout";
import SymbolTogglePicker from "../../components/SymbolTogglePicker";
import SidebarListItem from "../../components/SidebarListItem";
import { useConfirmDialog } from "../../components/ConfirmDialog";
import { EventsPageContent } from "../system/EventsPage";

// Types excluded from Settings page (have their own dedicated pages)
const EXCLUDED_TYPES = new Set(["api_key", "cron", "notification_config"]);

// Display labels for setting types
const TYPE_LABELS = { trade: "symbols", symbol_groups: "symbols" };
function typeLabel(t) {
  return TYPE_LABELS[String(t || "").toLowerCase()] || t;
}

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

function displaySettingName(type, name) {
  const t = String(type || "").trim();
  const n = String(name || "").trim();
  if (t === "settings" && n === "ANALYSE_SETTINGS") return "analyse";
  if (t === "system_config" && n === "enabled_log_prefixes")
    return "log_prefixes";
  if (t === "execution_profile" && n === "default") return "execution_profile";
  if (t === "symbol_groups" && n === "default") return "symbol_groups";
  return n || t;
}

function canonicalSettingPath(type, name) {
  const t = String(type || "").trim();
  const n = String(name || "").trim();
  if (t === "settings" && n === "ANALYSE_SETTINGS") return "/settings/analyse";
  if (t === "system_config" && n === "enabled_log_prefixes")
    return "/settings/log_prefixes";
  if (t === "execution_profile" && n === "default")
    return "/settings/execution_profile";
  if (t === "symbol_groups" && n === "default")
    return "/settings/symbol_groups";
  return `/settings/${encodeURIComponent(t)}/${encodeURIComponent(n)}`;
}

export default function SettingsPage({
  routeAlias = null,
  showNotifications = false,
}) {
  const confirm = useConfirmDialog();
  const location = useLocation();
  const navigate = useNavigate();
  const { settingType: routeSettingType, settingName: routeSettingName } =
    useParams();
  const effectiveRouteType = routeAlias?.type || routeSettingType || "";
  const effectiveRouteName = routeAlias?.name || routeSettingName || "";
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
  const [selectedSymbolGroupId, setSelectedSymbolGroupId] =
    useState("watchlist");
  const [dynamicGroupState, setDynamicGroupState] = useState(null);

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

  function settingRoutePath(type, name) {
    return canonicalSettingPath(type, name);
  }

  function renderSidebarItem(s) {
    const key = getSettingKey(s);
    const active = String(s.status || "").toUpperCase() === "ACTIVE";
    return (
      <SidebarListItem
        key={key}
        active={activeTab === key}
        enabled={active}
        title={displaySettingName(s.type, s.name)}
        subtitle={typeLabel(s.type)}
        onClick={() => {
          setActiveTab(key);
          navigate(settingRoutePath(s.type, s.name));
        }}
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
    loadData();
  }, []);

  useEffect(() => {
    api
      .dynamicSymbolGroup()
      .then((res) => {
        if (res?.ok) setDynamicGroupState(res.group || null);
      })
      .catch(() => {});
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
      navigate(`/settings`, { replace: true });
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
      let nextName = name;
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
      } else if (lcType === "symbol_groups") {
        nextName = "default";
        const symbols = String(value || "")
          .split(/[\n,]/)
          .map((x) => normalizeSymbol(x))
          .filter(Boolean);
        data = normalizeSymbolGroupsData({
          groups: [{ id: "watchlist", name: "Watchlist", symbols }],
        });
      } else {
        const parsed = JSON.parse(String(value || "{}"));
        data = parsed && typeof parsed === "object" ? parsed : {};
      }
      await api.upsertSetting({ type, name: nextName, data, status: "active" });
      const finalName = nextName;
      setSettingsMsg(`Setting ${type}/${finalName} created.`);
      setShowAddForm(false);
      setNewSettingForm({ type: "note", name: "", value: "" });
      const newKey = `${type}::${finalName}`;
      setActiveTab(newKey);
      navigate(settingRoutePath(type, finalName));
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

  const symbolGroupsData = useMemo(() => {
    if (
      String(selectedSetting?.type || "").toLowerCase() !== "symbol_groups" ||
      String(selectedSetting?.name || "") !== "default"
    ) {
      return normalizeSymbolGroupsData({ groups: [] });
    }
    return normalizeSymbolGroupsData(selectedSetting?.data || {});
  }, [selectedSetting]);

  const symbolGroupsList = useMemo(
    () => symbolGroupsData.groups || [],
    [symbolGroupsData],
  );

  const currentSymbolGroup = useMemo(
    () =>
      symbolGroupsList.find((group) => group.id === selectedSymbolGroupId) ||
      symbolGroupsList[0] ||
      null,
    [symbolGroupsList, selectedSymbolGroupId],
  );

  const sidebarSettings = useMemo(
    () =>
      settings.filter((s) => {
        const type = String(s.type || "").toLowerCase();
        const name = String(s.name || "").toLowerCase();
        if (EXCLUDED_TYPES.has(type)) return false;
        if (type === "settings" && name === "default") return false;
        return true;
      }),
    [settings],
  );

  const notificationSidebarKey = "notification_config::preferences";

  useEffect(() => {
    if (!sidebarSettings.length) {
      setActiveTab("");
      return;
    }

    if (showNotifications) {
      if (activeTab !== notificationSidebarKey)
        setActiveTab(notificationSidebarKey);
      return;
    }

    if (location.pathname === "/settings") {
      const firstSettingKey = getSettingKey(sidebarSettings[0]);
      if (activeTab !== firstSettingKey) setActiveTab(firstSettingKey);
      return;
    }

    if (effectiveRouteType && effectiveRouteName) {
      const matched =
        sidebarSettings.find(
          (s) =>
            String(s.type || "") === String(effectiveRouteType || "") &&
            String(s.name || "") === String(effectiveRouteName || ""),
        ) || null;
      if (matched) {
        const nextKey = getSettingKey(matched);
        if (nextKey !== activeTab) setActiveTab(nextKey);
        return;
      }
    }

    if (!activeTab) {
      setActiveTab(getSettingKey(sidebarSettings[0]));
    }
  }, [
    sidebarSettings,
    effectiveRouteType,
    effectiveRouteName,
    activeTab,
    showNotifications,
    location.pathname,
  ]);

  // ── Detail text sync ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedSetting) {
      setJsonDetailText("");
      setSymbolsDetailText("");
      return;
    }
    const type = String(selectedSetting.type || "").toLowerCase();
    if (type === "symbol_groups") {
      setJsonDetailText("");
      setSymbolsDetailText("");
      return;
    }
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

  useEffect(() => {
    if (String(selectedSetting?.type || "").toLowerCase() !== "symbol_groups") {
      setSelectedSymbolGroupId("watchlist");
      return;
    }
    if (!currentSymbolGroup) {
      setSelectedSymbolGroupId("watchlist");
      return;
    }
    if (currentSymbolGroup.id !== selectedSymbolGroupId) {
      setSelectedSymbolGroupId(currentSymbolGroup.id);
    }
  }, [selectedSetting, currentSymbolGroup, selectedSymbolGroupId]);

  function updateSelectedSymbolGroups(mutator) {
    if (!selectedSetting) return;
    const nextData = normalizeSymbolGroupsData(
      typeof mutator === "function"
        ? mutator(symbolGroupsData)
        : symbolGroupsData,
    );
    setSettings((prev) =>
      prev.map((item) =>
        getSettingKey(item) === getSettingKey(selectedSetting)
          ? { ...item, data: nextData }
          : item,
      ),
    );
  }

  function addSymbolGroup() {
    const existingIds = new Set(symbolGroupsList.map((group) => group.id));
    let name = "New Group";
    let id = makeSymbolGroupId(name, "group");
    let suffix = 2;
    while (existingIds.has(id)) {
      name = `New Group ${suffix}`;
      id = makeSymbolGroupId(name, `group-${suffix}`);
      suffix += 1;
    }
    updateSelectedSymbolGroups((current) => ({
      ...current,
      groups: [...(current.groups || []), { id, name, symbols: [] }],
    }));
    setSelectedSymbolGroupId(id);
  }

  async function removeSymbolGroup(groupToRemove = currentSymbolGroup) {
    if (!groupToRemove || RESERVED_SYMBOL_GROUP_IDS.has(groupToRemove.id)) return;
    if (
      !(await confirm({
        title: "Remove symbol group?",
        message: `Delete symbol group \"${groupToRemove.name}\"?`,
        confirmLabel: "Delete",
        tone: "danger",
      }))
    ) {
      return;
    }
    const remaining = symbolGroupsList.filter(
      (group) => group.id !== groupToRemove.id,
    );
    updateSelectedSymbolGroups((current) => ({
      ...current,
      groups: remaining,
    }));
    if (selectedSymbolGroupId === groupToRemove.id) {
      setSelectedSymbolGroupId("watchlist");
    }
  }

  function renameCurrentSymbolGroup(nextName) {
    if (!currentSymbolGroup || RESERVED_SYMBOL_GROUP_IDS.has(currentSymbolGroup.id)) return;
    const trimmed = String(nextName || "")
      .replace(/^\s+/, "")
      .trim();
    if (!trimmed) return;
    updateSelectedSymbolGroups((current) => ({
      ...current,
      groups: (current.groups || []).map((group) =>
        group.id === currentSymbolGroup.id
          ? {
              ...group,
              name: trimmed,
            }
          : group,
      ),
    }));
  }

  async function openRenameSymbolGroupDialog(group) {
    if (!group || RESERVED_SYMBOL_GROUP_IDS.has(group.id)) return;
    const result = await confirm({
      title: "Rename symbol group",
      message: `Rename \"${group.name}\"`,
      confirmLabel: "OK",
      cancelLabel: "Cancel",
      input: true,
      inputPlaceholder: "Group name",
      inputDefaultValue: group.name,
    });
    if (!result?.ok) return;
    renameCurrentSymbolGroup(result.value);
  }

  function setCurrentSymbolGroupSymbols(nextSymbols) {
    if (!currentSymbolGroup) return;
    updateSelectedSymbolGroups((current) => ({
      ...current,
      groups: (current.groups || []).map((group) =>
        group.id === currentSymbolGroup.id
          ? { ...group, symbols: nextSymbols }
          : group,
      ),
    }));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="stack-layout fadeIn" style={{ paddingBottom: 40 }}>
      <h2 className="page-title">Settings</h2>

      <MasterDetailLayout className="settings-layout-v2">
        {/* ── Left: Sidebar ──────────────────────────────────────────────── */}
        <div className="panel stack-layout" style={{ gap: 2, padding: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <span className="panel-label" style={{ marginBottom: 0 }}>
              SETTINGS
            </span>
            <button
              className="secondary-button"
              style={{ padding: "3px 8px", fontSize: 10 }}
              onClick={() => {
                setNewSettingForm({ type: "note", name: "", value: "" });
                setShowAddForm(true);
              }}
            >
              + New
            </button>
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
                  <option value="symbol_groups">symbol_groups</option>
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
            <SidebarListItem
              key={notificationSidebarKey}
              active={activeTab === notificationSidebarKey}
              enabled
              title="notification"
              subtitle="notification_config"
              onClick={() => {
                setActiveTab(notificationSidebarKey);
                navigate("/settings/notification");
              }}
            />
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
          {showNotifications ? (
            <EventsPageContent embedded />
          ) : selectedSetting ? (
            <>
              <div>
                <input
                  value={displaySettingName(
                    selectedSetting.type,
                    selectedSetting.name,
                  )}
                  readOnly
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    border: "none",
                    background: "transparent",
                    color: "inherit",
                    width: "100%",
                    outline: "none",
                    paddingLeft: 0,
                    opacity: 0.7,
                  }}
                />
                <span className="minor-text" style={{ fontSize: 11 }}>
                  Type: {typeLabel(selectedSetting.type)}
                </span>
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
                "symbol_groups" ? (
                <div className="stack-layout" style={{ gap: 14 }}>
                  <div className="stack-layout" style={{ gap: 8 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {symbolGroupsList.map((group) => (
                        <div
                          key={group.id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <button
                            className={`secondary-button${currentSymbolGroup?.id === group.id ? " active" : ""}`}
                            style={{ padding: "6px 10px", fontSize: 11 }}
                            onClick={() => setSelectedSymbolGroupId(group.id)}
                          >
                            {group.name}
                          </button>
                          {!RESERVED_SYMBOL_GROUP_IDS.has(group.id) ? (
                            <>
                              <button
                                className="secondary-button"
                                style={{ padding: "4px 7px", fontSize: 10 }}
                                title={`Edit ${group.name}`}
                                onClick={() =>
                                  openRenameSymbolGroupDialog(group)
                                }
                              >
                                ✎
                              </button>
                              <button
                                className="danger-button"
                                style={{ padding: "4px 7px", fontSize: 10 }}
                                title={`Delete ${group.name}`}
                                onClick={() => removeSymbolGroup(group)}
                              >
                                ✕
                              </button>
                            </>
                          ) : null}
                        </div>
                      ))}
                      <button
                        className="secondary-button"
                        style={{ padding: "6px 10px", fontSize: 11 }}
                        onClick={addSymbolGroup}
                      >
                        + Add Group
                      </button>
                    </div>

                    {currentSymbolGroup && (
                      <div className="stack-layout" style={{ gap: 10 }}>
                        <div className="minor-text" style={{ fontSize: 11 }}>
                          {currentSymbolGroup.id === "watchlist"
                            ? "Protected watchlist group — editable symbols, no rename/delete."
                            : `${currentSymbolGroup.symbols.length} symbols in this group.`}
                        </div>
                        {currentSymbolGroup.id === "watchlist" &&
                        dynamicGroupState ? (
                          <div
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: 10,
                              padding: 12,
                              background: "rgba(255,255,255,0.02)",
                            }}
                          >
                            <div
                              className="panel-label"
                              style={{ fontSize: 10, marginBottom: 8 }}
                            >
                              DYNAMIC WATCHLIST SOURCES
                            </div>
                            <div className="minor-text" style={{ fontSize: 11 }}>
                              Updated:{" "}
                              {dynamicGroupState.updated_at
                                ? new Date(
                                    dynamicGroupState.updated_at,
                                  ).toLocaleString()
                                : "-"}
                            </div>
                            <div className="minor-text" style={{ fontSize: 11 }}>
                              Symbols:{" "}
                              {Array.isArray(dynamicGroupState.symbols)
                                ? dynamicGroupState.symbols.length
                                : 0}
                            </div>
                            <div className="minor-text" style={{ fontSize: 11 }}>
                              News signals:{" "}
                              {Array.isArray(dynamicGroupState?.sources?.news)
                                ? dynamicGroupState.sources.news.length
                                : 0}
                            </div>
                            <div className="minor-text" style={{ fontSize: 11 }}>
                              Market signals:{" "}
                              {Array.isArray(dynamicGroupState?.sources?.market)
                                ? dynamicGroupState.sources.market.length
                                : 0}
                            </div>
                            {Array.isArray(dynamicGroupState?.sources?.news) &&
                            dynamicGroupState.sources.news.length ? (
                              <div
                                className="stack-layout"
                                style={{ gap: 6, marginTop: 10 }}
                              >
                                <div
                                  className="minor-text"
                                  style={{ fontSize: 10, textTransform: "uppercase" }}
                                >
                                  Top news detections
                                </div>
                                {dynamicGroupState.sources.news
                                  .slice(0, 6)
                                  .map((item, index) => (
                                    <div
                                      key={`${item.title || item.news_type}-${item.start_at || index}`}
                                      className="minor-text"
                                      style={{ fontSize: 11 }}
                                    >
                                      {item.news_type || "News"} · {item.title} ·{" "}
                                      {item.phase}
                                      {Number.isFinite(Number(item.minutes_until_start))
                                        ? ` · ${formatRelativeDurationMs(
                                            Math.max(
                                              0,
                                              Number(item.minutes_until_start),
                                            ) *
                                              60 *
                                              1000,
                                          )}`
                                        : ""}
                                      {Array.isArray(item.symbols) &&
                                      item.symbols.length
                                        ? ` · ${item.symbols
                                            .slice(0, 6)
                                            .join(", ")}`
                                        : ""}
                                    </div>
                                  ))}
                              </div>
                            ) : null}
                            {Array.isArray(dynamicGroupState?.sources?.market) &&
                            dynamicGroupState.sources.market.length ? (
                              <div
                                className="stack-layout"
                                style={{ gap: 6, marginTop: 10 }}
                              >
                                <div
                                  className="minor-text"
                                  style={{ fontSize: 10, textTransform: "uppercase" }}
                                >
                                  Top market detections
                                </div>
                                {dynamicGroupState.sources.market
                                  .slice(0, 6)
                                  .map((item) => (
                                    <div
                                      key={`${item.symbol}-${item.timeframe}`}
                                      className="minor-text"
                                      style={{ fontSize: 11 }}
                                    >
                                      {item.symbol} · {item.timeframe} · score{" "}
                                      {item.score} ·{" "}
                                      {(item.reasons || []).join(", ")}
                                    </div>
                                  ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <SymbolTogglePicker
                          value={currentSymbolGroup.symbols || []}
                          onChange={setCurrentSymbolGroupSymbols}
                          symbolGroups={symbolGroupsList}
                        />
                      </div>
                    )}
                  </div>
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
                  <span className="panel-label" style={{ fontSize: 10 }}>
                    JSON CONFIGURATION
                  </span>
                  <textarea
                    rows={16}
                    style={{ fontFamily: "monospace", fontSize: 11 }}
                    value={jsonDetailText}
                    onChange={(e) => {
                      setJsonDetailText(e.target.value);
                      try {
                        const parsed = JSON.parse(
                          String(e.target.value || "{}"),
                        );
                        setSettings((prev) =>
                          prev.map((x) =>
                            getSettingKey(x) === getSettingKey(selectedSetting)
                              ? { ...x, data: parsed }
                              : x,
                          ),
                        );
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
                  {!EXCLUDED_TYPES.has(String(selectedSetting.type || "")) &&
                    String(selectedSetting.type || "").toLowerCase() !==
                      "symbol_groups" && (
                      <button
                        className="danger-button"
                        style={{ padding: "12px 24px", fontSize: 14 }}
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
                  className="minor-text status-success"
                  style={{ marginTop: 16 }}
                >
                  {settingsMsg}
                </div>
              )}
            </>
          ) : null}

          {!showNotifications && !selectedSetting && (
            <span className="minor-text">
              Select a setting to view details.
            </span>
          )}
        </div>
      </MasterDetailLayout>
    </div>
  );
}
