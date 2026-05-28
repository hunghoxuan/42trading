import { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../../api";
import { showToast } from "../../components/ToastContainer";
import { parseTextList } from "../../utils/textList";
import MasterDetailLayout from "../../components/MasterDetailLayout";
import SidebarListItem from "../../components/SidebarListItem";
import { useConfirmDialog } from "../../components/ConfirmDialog";

// ── Constants ───────────────────────────────────────────────────────────────

const API_KEY_NAME_OPTIONS = [
  { value: "GEMINI_API_KEY", label: "Gemini API Key" },
  { value: "OPENAI_API_KEY", label: "OpenAI API Key" },
  { value: "DEEPSEEK_API_KEY", label: "DeepSeek API Key" },
  { value: "CLAUDE_API_KEY", label: "Claude API Key" },
  { value: "OPENROUTER_API_KEY", label: "OpenRouter API Key" },
  { value: "TWELVE_DATA_API_KEY", label: "Twelve Data API Key" },
];

const TIMEFRAME_OPTIONS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];

const DISPLAY_TIMEZONE_OPTIONS = [
  { value: "Local", label: "Local (Browser)" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "New York (America/New_York)" },
];

const CADENCE_OPTIONS = [
  { label: "15s", seconds: 15 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "30m", seconds: 1800 },
  { label: "1h", seconds: 3600 },
  { label: "4h", seconds: 14400 },
  { label: "1d", seconds: 86400 },
];

const CRON_TYPE_LABELS = {
  SNAPSHOT_CRON: "Snapshots",
  MARKET_DATA_CRON: "Market Data",
  ANALYSIS_CRON: "AI Analysis",
};

const CRON_TYPES = [
  {
    value: "MARKET_DATA_CRON",
    label: "Market Data",
    description: "Fetch market data on a schedule",
  },
  {
    value: "ANALYSIS_CRON",
    label: "AI Analysis",
    description: "Run AI analysis on a schedule",
  },
  {
    value: "SNAPSHOT_CRON",
    label: "Snapshots",
    description: "Take chart snapshots on a schedule",
  },
];

const ORDER_TYPE_OPTIONS = ["market", "limit", "stop"];

const DIRECTION_OPTIONS = ["BUY", "SELL"];

const SNAPSHOT_FORMAT_OPTIONS = ["png", "jpeg", "webp"];

const SNAPSHOT_THEME_OPTIONS = ["dark", "light"];

const SNAPSHOT_QUALITY_OPTIONS = [
  { label: "Low (30)", value: 30 },
  { label: "Medium (70)", value: 70 },
  { label: "High (90)", value: 90 },
];

const SYMBOLS_GROUP_PRESETS = {
  watchlist: [],
  all: [], // filled at runtime — all symbols from market_data
  crypto: [
    "BTCUSD", "ETHUSD", "XRPUSD", "SOLUSD", "DOGEUSD", "ADAUSD", "LTCUSD",
  ],
  forex: [
    "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF",
    "GBPJPY", "EURJPY", "EURGBP",
  ],
  indices: ["US30", "NAS100", "SPX500", "GER40", "UK100", "JPN225"],
  metals: ["XAUUSD", "XAGUSD", "XPTUSD", "XPDUSD"],
};

const SYMBOLS_GROUP_LABELS = {
  watchlist: "Watchlist",
  crypto: "Crypto",
  forex: "Forex",
  indices: "Indices",
  metals: "Metals",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function symbolsToText(arr) {
  return Array.isArray(arr) ? arr.join("\n") : "";
}

function cadenceSecondsToOption(seconds) {
  const n = Number(seconds);
  return (
    CADENCE_OPTIONS.find((o) => o.seconds === n) ||
    CADENCE_OPTIONS.find((o) => o.label === "1m")
  );
}

function cadenceOptionToSeconds(opt) {
  return opt ? opt.seconds : 60;
}

// ── Default forms per cron type ─────────────────────────────────────────────

function defaultForm(type) {
  const base = {
    cron_type: type,
    cadence_seconds: 60,
    symbols: "",
    timeframes: [],
  };
  switch (type) {
    case "MARKET_DATA_CRON":
      return {
        ...base,
        provider: "twelvedata",
        timezone: "America/New_York",
        batch_size: 8,
        exclude_symbols: "",
      };
    case "ANALYSIS_CRON":
      return {
        ...base,
        directions: ["BUY", "SELL"],
        order_types: ["market", "limit", "stop"],
        model: "claude-sonnet-4-0",
        profile: "",
        entry_models: "",
        prompt: "",
      };
    case "SNAPSHOT_CRON":
      return {
        ...base,
        exclude_symbols: "",
        broker: "",
        lookback_bars: 300,
        format: "png",
        quality: 90,
        theme: "dark",
        width: 1920,
        height: 1080,
        symbols_per_tick: 1,
      };
    default:
      return base;
  }
}

function formFromCronData(data) {
  const cronType = data?.cron_type || "MARKET_DATA_CRON";
  const base = {
    cron_type: cronType,
    cadence_seconds: Number(data?.cadence_seconds || 60),
    symbols: symbolsToText(data?.symbols),
    timeframes: Array.isArray(data?.timeframes) ? data.timeframes : [],
  };
  switch (cronType) {
    case "MARKET_DATA_CRON":
      return {
        ...base,
        provider: String(data?.provider || "twelvedata"),
        timezone: String(data?.timezone || "America/New_York"),
        batch_size: Number(data?.batch_size || 8),
        exclude_symbols: symbolsToText(data?.exclude_symbols),
      };
    case "ANALYSIS_CRON":
      return {
        ...base,
        directions: Array.isArray(data?.directions) ? data.directions : ["BUY", "SELL"],
        order_types: Array.isArray(data?.order_types) ? data.order_types : ["market", "limit", "stop"],
        model: String(data?.model || "claude-sonnet-4-0"),
        profile: String(data?.profile || ""),
        entry_models: Array.isArray(data?.entry_models) ? data.entry_models.join("\n") : "",
        prompt: String(data?.prompt || ""),
      };
    case "SNAPSHOT_CRON":
      return {
        ...base,
        exclude_symbols: symbolsToText(data?.exclude_symbols),
        broker: String(data?.broker || ""),
        lookback_bars: Number(data?.lookback_bars || 300),
        format: String(data?.format || "png"),
        quality: Number(data?.quality || 90),
        theme: String(data?.theme || "dark"),
        width: Number(data?.width || 1920),
        height: Number(data?.height || 1080),
        symbols_per_tick: Number(data?.symbols_per_tick || 1),
      };
    default:
      return base;
  }
}

function formToDataPayload(form, symbolsGroup = "") {
  const symbols = parseTextList(form.symbols, true);
  const data = {
    cron_type: form.cron_type,
    symbols: symbolsGroup ? [] : symbols, // empty when group selected = dynamic
    symbols_group: symbolsGroup || null,
    timeframes: form.timeframes,
    cadence_seconds: form.cadence_seconds,
  };
  switch (form.cron_type) {
    case "MARKET_DATA_CRON":
      return {
        ...data,
        provider: form.provider,
        timezone: form.timezone,
        batch_size: form.batch_size,
        exclude_symbols: parseTextList(form.exclude_symbols, true),
      };
    case "ANALYSIS_CRON":
      return {
        ...data,
        directions: form.directions,
        order_types: form.order_types,
        model: form.model,
        profile: form.profile,
        entry_models: parseTextList(form.entry_models),
        prompt: form.prompt,
      };
    case "SNAPSHOT_CRON":
      return {
        ...data,
        exclude_symbols: parseTextList(form.exclude_symbols, true),
        broker: form.broker || "",
        lookback_bars: form.lookback_bars,
        format: form.format,
        quality: form.quality,
        theme: form.theme,
        width: form.width,
        height: form.height,
        symbols_per_tick: form.symbols_per_tick,
      };
    default:
      return data;
  }
}

// ── Component ───────────────────────────────────────────────────────────────

export default function CronPage() {
  const confirm = useConfirmDialog();
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedCronName, setSelectedCronName] = useState(null);
  const [cronName, setCronName] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [watchlistSymbols, setWatchlistSymbols] = useState([]);
  const [showNewCronPicker, setShowNewCronPicker] = useState(false);
  const [form, setForm] = useState(defaultForm("MARKET_DATA_CRON"));
  const [symbolsGroup, setSymbolsGroup] = useState("");

  // ── Derived ───────────────────────────────────────────────────────────────

  const cronSettings = useMemo(
    () => settings.filter((s) => s?.type === "cron"),
    [settings],
  );

  const selectedCron = useMemo(
    () =>
      selectedCronName
        ? cronSettings.find((s) => s.name === selectedCronName) || null
        : null,
    [cronSettings, selectedCronName],
  );

  const isNewCron =
    selectedCronName && !cronSettings.find((s) => s.name === selectedCronName);

  const availableGroupPresets = useMemo(() => {
    const wl = watchlistSymbols.length > 0 ? watchlistSymbols : [];
    return {
      ...SYMBOLS_GROUP_PRESETS,
      watchlist: wl,
    };
  }, [watchlistSymbols]);

  // ── Load settings & watchlist ───────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const res = await api.getSettings();
        if (cancelled) return;
        const list = Array.isArray(res?.settings) ? res.settings : [];
        setSettings(list);

        // Extract watchlist
        const watchlistEntry = list.find(
          (s) => s.type === "trade" && s.name === "WATCHLIST",
        );
        const wl = Array.isArray(watchlistEntry?.data?.symbols)
          ? watchlistEntry.data.symbols
          : [];
        setWatchlistSymbols(wl);

        // Auto-select first cron if none selected
        const crons = list.filter((s) => s?.type === "cron");
        if (crons.length > 0 && !selectedCronName) {
          setSelectedCronName(crons[0].name);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err?.message || String(err || "Failed to load settings"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Populate form when selected cron changes ───────────────────────────

  useEffect(() => {
    if (!selectedCronName) {
      setForm(defaultForm("MARKET_DATA_CRON"));
      setSymbolsGroup("");
      return;
    }
    if (isNewCron) {
      // Form already set by handleNewCron
      setSymbolsGroup("");
      return;
    }
    if (selectedCron) {
      const d = selectedCron.data || {};
      setForm(formFromCronData(d));
      setCronName(selectedCron.name || "");
      setSymbolsGroup(d.symbols_group || "");
    }
  }, [selectedCronName, selectedCron, isNewCron]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const updateForm = useCallback((updates) => {
    setForm((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleNewCron = useCallback(
    (type) => {
      setShowNewCronPicker(false);
      const name = `${CRON_TYPE_LABELS[type] || type}_${Date.now().toString(36)}`;
      const newForm = defaultForm(type);
      setForm(newForm);
      setCronName(name);
      setSelectedCronName(name);
      setSymbolsGroup("");
      setSaveMsg("");
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!selectedCronName) return;
    setSaveLoading(true);
    setSaveMsg("");
    const data = formToDataPayload(form, symbolsGroup);
    const existing = cronSettings.find((s) => s.name === selectedCronName);
    const status = existing ? existing.status || "ACTIVE" : "INACTIVE";
    const payload = {
      type: "cron",
      name: cronName,
      data,
      status,
    };
    try {
      // If renaming, delete old row first
      if (selectedCronName && selectedCronName !== cronName) {
        await api.deleteSetting("cron", selectedCronName).catch(() => {});
      }
      await api.upsertSetting(payload);
      setSelectedCronName(cronName);
      const msg = `${CRON_TYPE_LABELS[form.cron_type] || form.cron_type} saved.`;
      setSaveMsg(msg);
      showToast({ message: msg, type: "success" });
      // Reload
      const res = await api.getSettings();
      const list = Array.isArray(res?.settings) ? res.settings : [];
      setSettings(list);
      // Update watchlist
      const wl = list.find((s) => s.type === "trade" && s.name === "WATCHLIST");
      setWatchlistSymbols(
        Array.isArray(wl?.data?.symbols) ? wl.data.symbols : [],
      );
    } catch (err) {
      const errMsg = err?.message || String(err || "Save failed");
      setSaveMsg(errMsg);
      showToast({ message: errMsg, type: "error" });
    } finally {
      setSaveLoading(false);
      setTimeout(() => setSaveMsg(""), 5000);
    }
  }, [selectedCronName, form, cronSettings]);

  const handleDelete = useCallback(async () => {
    if (!selectedCron || isNewCron) return;
    if (
      !(await confirm({
        title: "Delete cron?",
        message: `Delete cron "${selectedCron.name}"? This cannot be undone.`,
        confirmLabel: "Delete",
        tone: "danger",
      }))
    )
      return;
    setSaveLoading(true);
    try {
      await api.deleteSetting("cron", selectedCron.name);
      showToast({ message: "Cron deleted.", type: "success" });
      const res = await api.getSettings();
      const list = Array.isArray(res?.settings) ? res.settings : [];
      setSettings(list);
      // Select next cron or clear
      const crons = list.filter((s) => s?.type === "cron");
      setSelectedCronName(crons.length > 0 ? crons[0].name : null);
      if (crons.length === 0) {
        setForm(defaultForm("MARKET_DATA_CRON"));
      }
    } catch (err) {
      showToast({ message: err?.message || "Delete failed.", type: "error" });
    } finally {
      setSaveLoading(false);
    }
  }, [selectedCron, isNewCron]);

  const handleToggleStatus = useCallback(async () => {
    if (!selectedCron) return;
    const newStatus =
      String(selectedCron.status || "").toUpperCase() === "ACTIVE"
        ? "INACTIVE"
        : "ACTIVE";
    setSaveLoading(true);
    try {
      await api.upsertSetting({
        type: selectedCron.type,
        name: selectedCron.name,
        data: selectedCron.data || {},
        status: newStatus,
      });
      showToast({ message: `Cron ${newStatus}.`, type: "success" });
      const res = await api.getSettings();
      setSettings(Array.isArray(res?.settings) ? res.settings : []);
    } catch (err) {
      showToast({ message: err?.message || "Toggle failed.", type: "error" });
    } finally {
      setSaveLoading(false);
    }
  }, [selectedCron]);

  const handleSymbolsGroupChange = useCallback(
    (group) => {
      setSymbolsGroup(group);
      if (group && availableGroupPresets[group]) {
        const symbols = availableGroupPresets[group];
        updateForm({ symbols: symbols.join("\n") });
      }
    },
    [availableGroupPresets, updateForm],
  );

  const handleCheckboxToggle = useCallback(
    (field, value) => {
      setForm((prev) => {
        const arr = prev[field] || [];
        const next = arr.includes(value)
          ? arr.filter((x) => x !== value)
          : [...arr, value];
        return { ...prev, [field]: next };
      });
    },
    [],
  );

  // ── Render helpers ────────────────────────────────────────────────────────

  const isActive =
    selectedCron &&
    String(selectedCron.status || "").toUpperCase() === "ACTIVE";

  const cronTypeLabel = CRON_TYPE_LABELS[form.cron_type] || form.cron_type;
  const cadenceOption = cadenceSecondsToOption(form.cadence_seconds);

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="stack-layout fadeIn" style={{ padding: 40 }}>
        <p className="minor-text">Loading cron settings…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="stack-layout fadeIn" style={{ padding: 40 }}>
        <p className="minor-text" style={{ color: "var(--danger)" }}>
          {loadError}
        </p>
      </div>
    );
  }

  return (
    <div className="stack-layout fadeIn" style={{ paddingBottom: 40 }}>
      <h1 className="page-title">Cron Jobs</h1>

      <MasterDetailLayout>
        {/* ── Left: Cron List ─────────────────────────────── */}
        <div className="panel stack-layout" style={{ gap: 2, padding: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <span className="panel-label">CRONS</span>
            <button
              className="secondary-button"
              style={{ padding: "3px 8px", fontSize: 10 }}
              onClick={() => setShowNewCronPicker((v) => !v)}
            >
              + New
            </button>
          </div>

          {showNewCronPicker && (
            <div
              className="stack-layout"
              style={{
                gap: 4,
                padding: "8px 12px",
                marginBottom: 4,
                background: "var(--accent-soft)",
                borderRadius: 8,
              }}
            >
              {CRON_TYPES.map((ct) => (
                <SidebarListItem
                  key={ct.value}
                  title={ct.label}
                  subtitle={ct.description}
                  style={{
                    fontSize: 10,
                    padding: "6px 10px",
                  }}
                  onClick={() => handleNewCron(ct.value)}
                />
              ))}
            </div>
          )}

          {cronSettings.length === 0 ? (
            <p className="minor-text" style={{ padding: "8px 12px" }}>
              No crons configured.
            </p>
          ) : (
            cronSettings.map((cron) => {
              const data = cron.data || {};
              const ctLabel = CRON_TYPE_LABELS[data.cron_type] || data.cron_type || "Unknown";
              const isCronActive =
                String(cron.status || "").toUpperCase() === "ACTIVE";

              return (
                <SidebarListItem
                  key={cron.name}
                  active={selectedCronName === cron.name}
                  enabled={isCronActive}
                  title={cron.name}
                  subtitle={ctLabel}
                  onClick={() => {
                    setSelectedCronName(cron.name);
                    setShowNewCronPicker(false);
                  }}
                />
              );
            })
          )}
        </div>

        {/* ── Right: Edit Form ───────────────────────────── */}
        <div className="panel stack-layout" style={{ gap: 16, padding: 24 }}>
          {!selectedCronName ? (
            <div className="minor-text" style={{ padding: "12px 0" }}>
              Select a cron from the list or create a new one.
            </div>
          ) : (
            <>
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div style={{ flex: 1 }}>
                  <input
                    value={cronName}
                    onChange={(e) => setCronName(e.target.value)}
                    placeholder="Cron name..."
                    style={{ fontSize: 16, fontWeight: 700, border: "none", background: "transparent", color: "inherit", width: "100%", outline: "none", paddingLeft: 0 }}
                  />
                  {isNewCron && (
                    <span className="minor-text" style={{ fontSize: 10, fontWeight: 400 }}>
                      (new)
                    </span>
                  )}
                  <span className="minor-text" style={{ fontSize: 11 }}>
                    Type: {cronTypeLabel}
                  </span>
                </div>
              </div>

              {/* ═══════════════════════════════════════════
                  Part 1 — Schedule (shared)
                  ═══════════════════════════════════════════ */}

              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 16,
                }}
              >
                <span
                  className="panel-label"
                  style={{ fontSize: 11, marginBottom: 12, display: "block" }}
                >
                  SCHEDULE
                </span>

                <div className="stack-layout" style={{ gap: 12 }}>
                  {/* Interval (Cadence) */}
                  <div className="stack-layout" style={{ gap: 6 }}>
                    <span
                      className="panel-label"
                      style={{ fontSize: 10, marginBottom: 0 }}
                    >
                      INTERVAL
                    </span>
                    <select
                      value={cadenceOption.label}
                      onChange={(e) => {
                        const opt = CADENCE_OPTIONS.find(
                          (o) => o.label === e.target.value,
                        );
                        updateForm({
                          cadence_seconds: opt ? opt.seconds : 60,
                        });
                      }}
                    >
                      {CADENCE_OPTIONS.map((opt) => (
                        <option key={opt.label} value={opt.label}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Symbols Group Selector */}
                  <div className="stack-layout" style={{ gap: 6 }}>
                    <span
                      className="panel-label"
                      style={{ fontSize: 10, marginBottom: 0 }}
                    >
                      SYMBOLS GROUP
                    </span>
                    <select
                      value={symbolsGroup}
                      onChange={(e) => handleSymbolsGroupChange(e.target.value)}
                    >
                      <option value="">Custom</option>
                      <option value="all">All</option>
                      {Object.keys(SYMBOLS_GROUP_LABELS).map((key) => (
                        <option key={key} value={key}>
                          {SYMBOLS_GROUP_LABELS[key]}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Symbols */}
                  <div className="stack-layout" style={{ gap: 6 }}>
                    <span
                      className="panel-label"
                      style={{ fontSize: 10, marginBottom: 0 }}
                    >
                      SYMBOLS (COMMA OR NEWLINE)
                    </span>
                    <textarea
                      rows={4}
                      value={form.symbols}
                      onChange={(e) => updateForm({ symbols: e.target.value })}
                      placeholder="e.g. XAUUSD, EURUSD, BTCUSD"
                      disabled={symbolsGroup !== ""}
                      style={symbolsGroup !== "" ? { opacity: 0.5 } : {}}
                    />
                  </div>

                  {/* Timeframes (shared) */}
                  <div className="stack-layout" style={{ gap: 6 }}>
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
                            checked={form.timeframes.includes(tf)}
                            onChange={() => handleCheckboxToggle("timeframes", tf)}
                          />
                          <span style={{ fontSize: 13 }}>{tf}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* ═══════════════════════════════════════════
                  Part 2 — Type-specific fields
                  ═══════════════════════════════════════════ */}

              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  paddingTop: 16,
                }}
              >
                <span
                  className="panel-label"
                  style={{
                    fontSize: 10,
                    marginBottom: 16,
                    display: "block",
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  ADVANCED SETTINGS — {cronTypeLabel.toUpperCase()}
                </span>

                <div className="stack-layout" style={{ gap: 12 }}>
                  {/* MARKET_DATA_CRON fields */}
                  {form.cron_type === "MARKET_DATA_CRON" && (
                    <>
                      {/* Row: Provider / Timezone / Batch Size */}
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
                            value={form.provider}
                            onChange={(e) => updateForm({ provider: e.target.value })}
                          >
                            <option value="twelvedata">Twelve Data</option>
                          </select>
                        </label>

                        <label className="stack-layout" style={{ gap: 6 }}>
                          <span className="minor-text">Display Timezone</span>
                          <select
                            value={form.timezone}
                            onChange={(e) => updateForm({ timezone: e.target.value })}
                          >
                            {DISPLAY_TIMEZONE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="stack-layout" style={{ gap: 6 }}>
                          <span className="minor-text">Batch Size</span>
                          <input
                            type="number"
                            min="1"
                            max="50"
                            value={form.batch_size}
                            onChange={(e) =>
                              updateForm({ batch_size: Number(e.target.value) })
                            }
                          />
                        </label>
                      </div>

                      {/* Exclude Symbols */}
                      <div className="stack-layout" style={{ gap: 6 }}>
                        <span
                          className="panel-label"
                          style={{ fontSize: 10, marginBottom: 0 }}
                        >
                          EXCLUDE SYMBOLS (COMMA OR NEWLINE)
                        </span>
                        <textarea
                          rows={2}
                          value={form.exclude_symbols}
                          onChange={(e) =>
                            updateForm({ exclude_symbols: e.target.value })
                          }
                          placeholder="e.g. XAUUSD (skip these)"
                        />
                      </div>
                    </>
                  )}

                  {/* ANALYSIS_CRON fields */}
                  {form.cron_type === "ANALYSIS_CRON" && (
                    <>
                      {/* Row: Directions / Order Types */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 12,
                        }}
                      >
                        <div className="stack-layout" style={{ gap: 6 }}>
                          <span
                            className="panel-label"
                            style={{ fontSize: 10, marginBottom: 0 }}
                          >
                            DIRECTIONS
                          </span>
                          <div style={{ display: "flex", gap: 12 }}>
                            {DIRECTION_OPTIONS.map((direction) => (
                              <label
                                key={direction}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={form.directions.includes(direction)}
                                  onChange={() =>
                                    handleCheckboxToggle("directions", direction)
                                  }
                                />
                                <span style={{ fontSize: 13 }}>{direction}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="stack-layout" style={{ gap: 6 }}>
                          <span
                            className="panel-label"
                            style={{ fontSize: 10, marginBottom: 0 }}
                          >
                            ORDER TYPES
                          </span>
                          <div style={{ display: "flex", gap: 12 }}>
                            {ORDER_TYPE_OPTIONS.map((ot) => (
                              <label
                                key={ot}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={form.order_types.includes(ot)}
                                  onChange={() =>
                                    handleCheckboxToggle("order_types", ot)
                                  }
                                />
                                <span style={{ fontSize: 13 }}>{ot}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Model */}
                      <div className="stack-layout" style={{ gap: 6 }}>
                        <span
                          className="panel-label"
                          style={{ fontSize: 10, marginBottom: 0 }}
                        >
                          MODEL
                        </span>
                        <select
                          value={form.model}
                          onChange={(e) => updateForm({ model: e.target.value })}
                        >
                          {API_KEY_NAME_OPTIONS.map((opt) => (
                            <option
                              key={opt.value}
                              value={opt.value.replace("_API_KEY", "").toLowerCase()}
                            >
                              {opt.label.replace(" API Key", "")}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Profile */}
                      <div className="stack-layout" style={{ gap: 6 }}>
                        <span
                          className="panel-label"
                          style={{ fontSize: 10, marginBottom: 0 }}
                        >
                          PROFILE
                        </span>
                        <input
                          value={form.profile}
                          onChange={(e) => updateForm({ profile: e.target.value })}
                          placeholder="Optional AI/profile name"
                        />
                      </div>

                      {/* Entry Models */}
                      <div className="stack-layout" style={{ gap: 6 }}>
                        <span
                          className="panel-label"
                          style={{ fontSize: 10, marginBottom: 0 }}
                        >
                          ENTRY MODELS (COMMA OR NEWLINE)
                        </span>
                        <textarea
                          rows={3}
                          value={form.entry_models}
                          onChange={(e) =>
                            updateForm({ entry_models: e.target.value })
                          }
                          placeholder="Order Block, FVG, ICT..."
                        />
                      </div>

                      {/* Prompt */}
                      <div className="stack-layout" style={{ gap: 6 }}>
                        <span
                          className="panel-label"
                          style={{ fontSize: 10, marginBottom: 0 }}
                        >
                          PROMPT
                        </span>
                        <textarea
                          rows={6}
                          value={form.prompt}
                          onChange={(e) => updateForm({ prompt: e.target.value })}
                          placeholder="Instructions for AI setup detection..."
                        />
                      </div>
                    </>
                  )}

                  {/* SNAPSHOT_CRON fields */}
                  {form.cron_type === "SNAPSHOT_CRON" && (
                    <>
                      {/* Broker Select */}
                      <div className="stack-layout" style={{ gap: 6 }}>
                        <span className="panel-label" style={{ fontSize: 10, marginBottom: 0 }}>BROKER (optional)</span>
                        <select value={form.broker || ""} onChange={(e) => updateForm({ broker: e.target.value })}>
                          <option value="">Auto (no prefix)</option>
                          <option value="ICMARKETS">IC Markets</option>
                          <option value="OANDA">OANDA</option>
                          <option value="FOREXCOM">Forex.com</option>
                          <option value="PEPPERSTONE">Pepperstone</option>
                          <option value="FXCM">FXCM</option>
                          <option value="BINANCE">Binance</option>
                          <option value="BYBIT">Bybit</option>
                        </select>
                      </div>

                      {/* Row: Format / Quality / Theme */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr",
                          gap: 12,
                        }}
                      >
                        <label className="stack-layout" style={{ gap: 6 }}>
                          <span className="minor-text">Format</span>
                          <select
                            value={form.format}
                            onChange={(e) => updateForm({ format: e.target.value })}
                          >
                            {SNAPSHOT_FORMAT_OPTIONS.map((f) => (
                              <option key={f} value={f}>
                                {f.toUpperCase()}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="stack-layout" style={{ gap: 6 }}>
                          <span className="minor-text">Quality</span>
                          <select
                            value={form.quality}
                            onChange={(e) => updateForm({ quality: Number(e.target.value) })}
                          >
                            {SNAPSHOT_QUALITY_OPTIONS.map((q) => (
                              <option key={q.value} value={q.value}>
                                {q.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="stack-layout" style={{ gap: 6 }}>
                          <span className="minor-text">Theme</span>
                          <select
                            value={form.theme}
                            onChange={(e) => updateForm({ theme: e.target.value })}
                          >
                            {SNAPSHOT_THEME_OPTIONS.map((t) => (
                              <option key={t} value={t}>
                                {t.charAt(0).toUpperCase() + t.slice(1)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      {/* Row: Width / Height / Lookback Bars / Symbols Per Tick */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr 1fr",
                          gap: 12,
                        }}
                      >
                        <label className="stack-layout" style={{ gap: 6 }}>
                          <span className="minor-text">Width (px)</span>
                          <input
                            type="number"
                            min="100"
                            max="3840"
                            value={form.width}
                            onChange={(e) =>
                              updateForm({ width: Number(e.target.value) })
                            }
                          />
                        </label>

                        <label className="stack-layout" style={{ gap: 6 }}>
                          <span className="minor-text">Height (px)</span>
                          <input
                            type="number"
                            min="100"
                            max="2160"
                            value={form.height}
                            onChange={(e) =>
                              updateForm({ height: Number(e.target.value) })
                            }
                          />
                        </label>

                        <label className="stack-layout" style={{ gap: 6 }}>
                          <span className="minor-text">Lookback Bars</span>
                          <input
                            type="number"
                            min="10"
                            max="10000"
                            value={form.lookback_bars}
                            onChange={(e) =>
                              updateForm({ lookback_bars: Number(e.target.value) })
                            }
                          />
                        </label>

                        <label className="stack-layout" style={{ gap: 6 }}>
                          <span className="minor-text">Symbols Per Tick</span>
                          <input
                            type="number"
                            min="1"
                            max="50"
                            value={form.symbols_per_tick}
                            onChange={(e) =>
                              updateForm({ symbols_per_tick: Number(e.target.value) })
                            }
                          />
                        </label>
                      </div>

                        {/* Exclude Symbols */}
                      <div className="stack-layout" style={{ gap: 6 }}>
                        <span
                          className="panel-label"
                          style={{ fontSize: 10, marginBottom: 0 }}
                        >
                          EXCLUDE SYMBOLS (COMMA OR NEWLINE)
                        </span>
                        <textarea
                          rows={2}
                          value={form.exclude_symbols}
                          onChange={(e) =>
                            updateForm({ exclude_symbols: e.target.value })
                          }
                          placeholder="e.g. XAUUSD (skip these)"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* ── Actions ────────────────────────── */}
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
                  {selectedCron && (
                    <button
                      className={isActive ? "secondary-button" : "primary-button"}
                      style={{ padding: "12px 24px", fontSize: 14 }}
                      onClick={handleToggleStatus}
                      disabled={saveLoading}
                    >
                      {isActive ? "DEACTIVATE" : "ACTIVATE"}
                    </button>
                  )}
                  {selectedCron && !isNewCron && (
                    <button
                      className="danger-button"
                      style={{ padding: "12px 24px", fontSize: 14 }}
                      onClick={handleDelete}
                      disabled={saveLoading}
                    >
                      DELETE
                    </button>
                  )}
                </div>
                <button
                  className="primary-button"
                  style={{ padding: "12px 32px", fontSize: 14 }}
                  onClick={handleSave}
                  disabled={saveLoading}
                >
                  {saveLoading
                    ? "SAVING..."
                    : isNewCron
                      ? "CREATE CRON"
                      : "SAVE CRON"}
                </button>
              </div>

              {saveMsg && (
                <div
                  className="minor-text"
                  style={{
                    color: saveMsg.toLowerCase().includes("fail")
                      ? "var(--danger)"
                      : "var(--success)",
                  }}
                >
                  {saveMsg}
                </div>
              )}
            </>
          )}
        </div>
      </MasterDetailLayout>
    </div>
  );
}
