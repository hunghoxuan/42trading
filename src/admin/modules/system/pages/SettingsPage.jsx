import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../../../app/api";
import { showToast } from "../../../shared/components/ToastContainer";
import { formatRelativeDurationMs } from "../../../shared/utils/format";
import { parseTextList } from "../../../shared/utils/textList";
import { maskSecretPreview } from "../../../shared/utils/secrets";
import {
  normalizeSymbolGroupsData,
  makeSymbolGroupId,
  RESERVED_SYMBOL_GROUP_IDS,
} from "../../../../config/symbolGroups.js";
import MasterDetailLayout from "../../../shared/components/MasterDetailLayout";
import SymbolTogglePicker from "../components/SymbolTogglePicker";
import SidebarListItem from "../components/SidebarListItem";
import GroupButtons from "../../../shared/components/GroupButtons";
import { useConfirmDialog } from "../../../shared/components/ConfirmDialog";
import { EventsPageContent } from "./EventsPage";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import PageHeader from "../../../shared/components/PageHeader";
import {
  MasterDetailContentPanel,
  MasterDetailSidebarPanel,
} from "../../../shared/components/MasterDetailPanel";

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
  if (t === "system_config" && n === "write_logs") return "write_logs";
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
  if (t === "system_config" && n === "write_logs")
    return "/settings/write_logs";
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
  const symbolGroupsDirtyIdsRef = useRef(new Set());
  const symbolGroupsRemovedIdsRef = useRef(new Set());
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
    try {
      let nextData = dataOverride ?? s.data;
      if (
        String(s?.type || "").toLowerCase() === "symbol_groups" &&
        String(s?.name || "") === "default"
      ) {
        const latest = await api.getSettings();
        const latestSetting = (Array.isArray(latest?.settings)
          ? latest.settings
          : []
        ).find(
          (item) => item?.type === "symbol_groups" && item?.name === "default",
        );
        const latestData = normalizeSymbolGroupsData(latestSetting?.data || {});
        const localData = normalizeSymbolGroupsData(nextData || {});
        const dirtyIds = symbolGroupsDirtyIdsRef.current;
        const removedIds = symbolGroupsRemovedIdsRef.current;
        const mergedById = new Map(
          (latestData.groups || [])
            .filter((group) => !removedIds.has(group.id))
            .map((group) => [group.id, group]),
        );
        for (const group of localData.groups || []) {
          if (!dirtyIds.has(group.id) && !dirtyIds.has("*")) continue;
          mergedById.set(group.id, group);
        }
        nextData = normalizeSymbolGroupsData({
          ...latestData,
          groups: Array.from(mergedById.values()),
        });
        setSettings((prev) =>
          prev.map((item) =>
            getSettingKey(item) === settingKey
              ? { ...item, data: nextData }
              : item,
          ),
        );
      }
      const payload = {
        type: s.type,
        name: s.name,
        data: nextData,
        status: statusOverride ?? s.status ?? "active",
      };
      await api.upsertSetting(payload);
      symbolGroupsDirtyIdsRef.current = new Set();
      symbolGroupsRemovedIdsRef.current = new Set();
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
      symbolGroupsDirtyIdsRef.current = new Set();
      symbolGroupsRemovedIdsRef.current = new Set();
      setSelectedSymbolGroupId("watchlist");
      return;
    }
    if (!symbolGroupsDirtyIdsRef.current.size && !symbolGroupsRemovedIdsRef.current.size) {
      symbolGroupsDirtyIdsRef.current = new Set();
      symbolGroupsRemovedIdsRef.current = new Set();
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
    symbolGroupsDirtyIdsRef.current.add(id);
    setSelectedSymbolGroupId(id);
  }

  async function removeSymbolGroup(groupToRemove = currentSymbolGroup) {
    if (!groupToRemove || RESERVED_SYMBOL_GROUP_IDS.has(groupToRemove.id))
      return;
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
    symbolGroupsRemovedIdsRef.current.add(groupToRemove.id);
    symbolGroupsDirtyIdsRef.current.delete(groupToRemove.id);
    if (selectedSymbolGroupId === groupToRemove.id) {
      setSelectedSymbolGroupId("watchlist");
    }
  }

  function renameCurrentSymbolGroup(nextName) {
    if (
      !currentSymbolGroup ||
      RESERVED_SYMBOL_GROUP_IDS.has(currentSymbolGroup.id)
    )
      return;
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
    symbolGroupsDirtyIdsRef.current.add(currentSymbolGroup.id);
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
    symbolGroupsDirtyIdsRef.current.add(currentSymbolGroup.id);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="stack-layout fadeIn" style={{ paddingBottom: 40 }}>
      <PageHeader title="Settings" />

      <MasterDetailLayout className="settings-layout-v2">
        {/* ── Left: Sidebar ──────────────────────────────────────────────── */}
        <MasterDetailSidebarPanel
          label="SETTINGS"
          actions={
            <button
              className="secondary-button"
              onClick={() => {
                setNewSettingForm({ type: "note", name: "", value: "" });
                setShowAddForm(true);
              }}
            >
              + New
            </button>
          }
        >
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
                <InputComboSelect
                  style={{ width: "100%" }}
                  value={newSettingForm.type}
                  onChange={(e) =>
                    setNewSettingForm((p) => ({ ...p, type: e.target.value }))
                  }
                >
                  <option value="note">note</option>
                  <option value="symbols">symbols</option>
                  <option value="symbol_groups">symbol_groups</option>
                </InputComboSelect>
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
        </MasterDetailSidebarPanel>

        {/* ── Right: Detail ──────────────────────────────────────────────── */}
        <MasterDetailContentPanel>
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
                    "system_config" &&
                  String(selectedSetting.name || "") === "write_logs" ? (
                <label className="stack-layout" style={{ gap: 6 }}>
                  <span className="minor-text">Write server logs</span>
                  <select
                    value={
                      String(selectedSetting.data?.enabled || "NO").toUpperCase() ===
                      "YES"
                        ? "YES"
                        : "NO"
                    }
                    onChange={(event) =>
                      updateSetting(
                        getSettingKey(selectedSetting),
                        "enabled",
                        event.target.value,
                      )
                    }
                  >
                    <option value="NO">NO</option>
                    <option value="YES">YES</option>
                  </select>
                  <span className="minor-text">
                    NO disables persistent server, notification, audit, broker,
                    and AI analysis log writes. Console output remains available.
                  </span>
                </label>
              ) : String(selectedSetting.type || "").toLowerCase() ===
                "symbol_groups" ? (
                <div className="stack-layout" style={{ gap: 14 }}>
                  <div className="stack-layout" style={{ gap: 8 }}>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                        <GroupButtons
                          items={symbolGroupsList.map((group) => ({
                            label: group.name,
                            value: group.id,
                          }))}
                          selectedItems={[currentSymbolGroup?.id || ""]}
                          selectionMode="single"
                          onChange={([nextGroupId]) =>
                            setSelectedSymbolGroupId(nextGroupId)
                          }
                          border_type="single"
                          buttonStyle={{ padding: "6px 10px", fontSize: 11 }}
                          ariaLabel="Symbol groups"
                        />
                      </div>
                      {currentSymbolGroup &&
                      !RESERVED_SYMBOL_GROUP_IDS.has(currentSymbolGroup.id) ? (
                        <div
                          style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
                        >
                          <button
                            className="secondary-button"
                            title={`Edit ${currentSymbolGroup.name}`}
                            onClick={() =>
                              openRenameSymbolGroupDialog(currentSymbolGroup)
                            }
                          >
                            ✎
                          </button>
                          <button
                            className="danger-button"
                            title={`Delete ${currentSymbolGroup.name}`}
                            onClick={() =>
                              removeSymbolGroup(currentSymbolGroup)
                            }
                          >
                            ✕
                          </button>
                        </div>
                      ) : null}
                      <button
                        className="secondary-button"
                        onClick={addSymbolGroup}
                      >
                        + Add Group
                      </button>
                    </div>

                    {currentSymbolGroup && (
                      <div className="stack-layout" style={{ gap: 10 }}>
                        <SymbolTogglePicker
                          value={currentSymbolGroup.symbols || []}
                          onChange={setCurrentSymbolGroupSymbols}
                          symbolGroups={symbolGroupsList}
                          useResponsivePanel={false}
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
                      "symbol_groups" &&
                    !(
                      String(selectedSetting.type || "").toLowerCase() ===
                        "system_config" &&
                      String(selectedSetting.name || "") === "write_logs"
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
                <button
                  className="primary-button"
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
        </MasterDetailContentPanel>
      </MasterDetailLayout>
    </div>
  );
}
