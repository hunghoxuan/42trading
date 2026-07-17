import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../app/api";
import { parseTextList } from "../../../shared/utils/textList";
import MasterDetailLayout from "../../../shared/components/MasterDetailLayout";
import SidebarListItem from "../components/SidebarListItem";
import { useConfirmDialog } from "../../../shared/components/ConfirmDialog";
import CronInterval, {
  createDefaultScheduleRows,
  parseLegacyScheduleRows,
  resolveScheduleCadenceSeconds,
  summarizeScheduleRows,
} from "../components/CronInterval";
import SymbolTogglePicker from "../components/SymbolTogglePicker";
import CronSectionCard from "../components/CronSectionCard";
import LogsViewer from "../components/LogsViewer";
import GroupButtons from "../../../shared/components/GroupButtons";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import TabBar from "../../../shared/components/TabBar";
import ToggleButton from "../../../shared/components/ToggleButton";
import TimeframeSelector from "../components/TimeframeSelector";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import TimezoneComboSelect, {
  normalizeTimezoneSelection,
  resolveBrowserTimezone,
} from "../../../shared/components/TimezoneComboSelect";
import PageHeader from "../../../shared/components/PageHeader";
import { MasterDetailContentPanel } from "../../../shared/components/MasterDetailPanel";
import DateTimePicker from "../../../shared/components/DateTimePicker";
import { normalizeStrategyCatalog } from "../../../shared/utils/strategyCatalog";
import {
  getSymbolGroupsDataFromSettings,
  getSymbolGroupSymbols,
  normalizeSymbolList,
} from "../../../../config/symbolGroups.js";

// ── Constants ───────────────────────────────────────────────────────────────

const API_KEY_NAME_OPTIONS = [
  { value: "GEMINI", label: "Gemini" },
  { value: "OPENAI", label: "OpenAI" },
  { value: "DEEPSEEK", label: "DeepSeek" },
  { value: "CLAUDE", label: "Claude" },
  { value: "OPENROUTER", label: "OpenRouter" },
  { value: "TWELVE_DATA", label: "Twelve Data" },
];

const TIMEFRAME_OPTIONS = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
  { value: "4h", label: "4h" },
  { value: "1d", label: "1d" },
  { value: "1W", label: "1w" },
];

const CURRENT_TIMEZONE = resolveBrowserTimezone();

function normalizeFormTimezone(value) {
  return normalizeTimezoneSelection(value, CURRENT_TIMEZONE);
}

const CADENCE_OPTIONS = [
  { label: "15s", seconds: 15 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "30m", seconds: 1800 },
  { label: "1h", seconds: 3600 },
  { label: "2h", seconds: 7200 },
  { label: "3h", seconds: 10800 },
  { label: "4h", seconds: 14400 },
  { label: "6h", seconds: 21600 },
  { label: "8h", seconds: 28800 },
  { label: "12h", seconds: 43200 },
  { label: "1d", seconds: 86400 },
];

const CRON_TYPE_LABELS = {
  SNAPSHOT_CRON: "Snapshots",
  MARKET_DATA_CRON: "Market Data",
  DOWNLOAD_BARS_CRON: "Download Bars",
  ANALYSIS_CRON: "AI Analysis",
  STRATEGY_SCAN_CRON: "Strategy Scan",
  TRADES_BULK_ACTION: "Trades Bulk Action",
};

const CRON_TYPES = [
  {
    value: "MARKET_DATA_CRON",
    label: "Market Data",
    description: "Fetch market data on a schedule",
  },
  {
    value: "DOWNLOAD_BARS_CRON",
    label: "Download Bars",
    description: "Download latest or older bars into parquet/csv storage",
  },
  {
    value: "ANALYSIS_CRON",
    label: "AI Analysis",
    description: "Run AI analysis on a schedule",
  },
  {
    value: "STRATEGY_SCAN_CRON",
    label: "Strategy Scan",
    description: "Run the live strategy scan engine and create trades from matches",
  },
  {
    value: "SNAPSHOT_CRON",
    label: "Snapshots",
    description: "Take chart snapshots on a schedule",
  },
  {
    value: "TRADES_BULK_ACTION",
    label: "Trades Bulk Action",
    description: "Run bulk trade actions with guarded filters",
  },
];

const ORDER_TYPE_OPTIONS = ["market", "limit", "stop"];

const DIRECTION_OPTIONS = ["BUY", "SELL"];
const DOWNLOAD_DIRECTION_OPTIONS = [
  { value: "latest", label: "Latest bars" },
  { value: "history", label: "History bars" },
];

const PROMPT_TEMPLATES = {
  smc: `Analyze the chart using Smart Money Concepts (SMC).
Identify: market structure (BOS/CHoCH), liquidity sweeps, order blocks, FVGs, premium/discount zones.
Return a trade plan with entry at the most recent valid order block, stop loss behind structure, and take profit at the nearest liquidity pool.`,
  pa: `Analyze the chart using Price Action.
Identify: key support/resistance levels, candlestick patterns (engulfing, pin bar, inside bar), trend structure (HH/HL or LH/LL).
Return a trade plan with entry at the pattern confirmation level, stop loss beyond the pattern extreme, and take profit at the next S/R level.`,
  ict: `Analyze the chart using ICT concepts.
Identify: killzone session, liquidity sweep, market structure shift (MSS), fair value gap (FVG), optimal trade entry (OTE).
Return a trade plan with entry at OTE within the FVG, stop loss beyond the recent swing, and take profit at the opposite liquidity pool.`,
  scalp: `Analyze the chart for a scalp trade setup.
Focus on the lowest timeframe (5m or 1m). Look for quick momentum moves with tight stops.
Return a trade plan with entry at breakout/retest, stop loss 5-10 pips, take profit 1:1.5 to 1:2 RR.`,
};

const SNAPSHOT_FORMAT_OPTIONS = ["png", "jpeg", "webp"];

const cronPageCache = {
  settings: null,
  accounts: null,
  sources: null,
  strategies: null,
};

const SNAPSHOT_THEME_OPTIONS = ["dark", "light"];

const SNAPSHOT_QUALITY_OPTIONS = [
  { label: "Low (30)", value: 30 },
  { label: "Medium (70)", value: 70 },
  { label: "High (90)", value: 90 },
];

const TRADE_STATUS_OPTIONS = [
  { value: "DRAFT", label: "DRAFT" },
  { value: "PENDING", label: "PENDING" },
  { value: "FILLED", label: "FILLED" },
  { value: "CLOSED", label: "CLOSED" },
  { value: "CANCELLED", label: "CANCELLED" },
  { value: "REJECTED", label: "REJECTED" },
  { value: "ERROR", label: "ERROR" },
];

const TRADE_PNL_STATE_OPTIONS = [
  { value: "", label: "All" },
  { value: "win", label: "Win" },
  { value: "lose", label: "Lose" },
];

const TRADE_TIME_RANGE_OPTIONS = [
  { value: "all", label: "All times" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_week", label: "Last week" },
  { value: "last_month", label: "Last month" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

const TRADE_BULK_ACTION_OPTIONS = [
  { value: "", label: "Select action..." },
  { value: "close_all", label: "Close All" },
  { value: "cancel_all", label: "Cancel All" },
  { value: "delete_all", label: "Delete All" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function symbolsToText(arr) {
  return Array.isArray(arr) ? arr.join("\n") : "";
}

function isValidTimeValue(value) {
  return /^\d{2}:\d{2}$/.test(String(value || "").trim());
}

function timeToMinutes(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d{2}):(\d{2})$/);
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function validateScheduleRows(rows = []) {
  const activeRows = (Array.isArray(rows) ? rows : []).filter(
    (row) => row?.enabled,
  );
  if (!activeRows.length) {
    return "Select at least 1 active day in the schedule.";
  }
  for (const row of activeRows) {
    const dayLabel = String(row?.day || "Day");
    const windows = Array.isArray(row?.windows) ? row.windows : [row];
    if (!windows.length) {
      return `${dayLabel}: add at least 1 window.`;
    }
    for (const [index, window] of windows.entries()) {
      const windowLabel = `${dayLabel} window ${index + 1}`;
      if (String(window?.mode || "interval").trim().toLowerCase() === "exact") {
        const exactTimes = Array.isArray(window?.exact_times)
          ? window.exact_times
          : String(window?.exact_times || "")
              .split(/[\n,;]+/)
              .map((item) => item.trim())
              .filter(Boolean);
        if (!exactTimes.length) {
          return `${windowLabel}: add at least 1 exact time.`;
        }
        for (const exactTime of exactTimes) {
          if (!isValidTimeValue(exactTime)) {
            return `${windowLabel}: invalid exact time.`;
          }
        }
        continue;
      }
      if (!isValidTimeValue(window?.from) || !isValidTimeValue(window?.to)) {
        return `${windowLabel}: invalid time range.`;
      }
      const fromMinutes = timeToMinutes(window.from);
      const toMinutes = timeToMinutes(window.to);
      if (!Number.isFinite(fromMinutes) || !Number.isFinite(toMinutes)) {
        return `${windowLabel}: invalid time range.`;
      }
      if (fromMinutes >= toMinutes) {
        return `${windowLabel}: "From" must be earlier than "To".`;
      }
      if (
        !Number.isFinite(Number(window?.interval_seconds)) ||
        Number(window.interval_seconds) <= 0
      ) {
        return `${windowLabel}: interval is required.`;
      }
    }
  }
  return "";
}

function getSelectValues(event) {
  return Array.from(event?.target?.selectedOptions || [])
    .map((option) => String(option.value || "").trim())
    .filter(Boolean);
}

function CheckboxMultiGroup({
  options = [],
  values = [],
  onToggle,
  minWidth = 140,
}) {
  return (
    <GroupButtons
      type="checkbox"
      itemsLayout="row"
      items={options.map((option) => ({
        value: String(option?.value || ""),
        label: String(option?.label || option?.value || ""),
        style: { minWidth },
      }))}
      selectedItems={Array.isArray(values) ? values : []}
      selectionMode="multiple"
      onChange={(nextValues, _nextItems) => {
        const prevValues = new Set(Array.isArray(values) ? values : []);
        const nextSet = new Set(nextValues);
        const changedValue = options
          .map((option) => String(option?.value || ""))
          .find((value) => prevValues.has(value) !== nextSet.has(value));
        if (changedValue) onToggle(changedValue);
      }}
      border_type="none"
      size="compact"
      buttonStyle={{ fontSize: 13, padding: "2px 0" }}
      ariaLabel="Checkbox multi select"
    />
  );
}

// ── Default forms per cron type ─────────────────────────────────────────────

function defaultForm(type) {
  const base = {
    cron_type: type,
    cadence_seconds: 60,
    timezone: CURRENT_TIMEZONE,
    active_from: "",
    active_to: "",
    cooldown_seconds: 0,
    symbols: "",
    timeframes: [],
    schedule: "",
    schedule_rows: createDefaultScheduleRows(60),
    avoid_news: false,
  };
  switch (type) {
    case "MARKET_DATA_CRON":
      return {
        ...base,
        provider: "twelvedata",
        batch_size: 8,
        exclude_symbols: "",
      };
    case "DOWNLOAD_BARS_CRON":
      return {
        ...base,
        provider: "auto",
        batch_size: 8,
        exclude_symbols: "",
        direction: "latest",
        bars_count: 1000,
      };
    case "ANALYSIS_CRON":
      return {
        ...base,
        pickup_mode: "all",
        refresh_snapshot: false,
        directions: ["BUY", "SELL"],
        order_types: ["market", "limit", "stop"],
        model: "claude-sonnet-4-0",
        profile: "",
        entry_models: "",
        prompt: "",
        auto_save: "trades",
      };
    case "STRATEGY_SCAN_CRON":
      return {
        ...base,
        pickup_mode: "all",
        strategy_ids: [],
        bars_count: 300,
        auto_save: "trades",
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
        symbols_per_tick: 0,
      };
    case "TRADES_BULK_ACTION":
      return {
        ...base,
        symbols: "",
        timeframes: [],
        execution_statuses: [],
        pnl_state: "",
        directions: [],
        time_range: "all",
        account_ids: [],
        source_ids: [],
        bulk_action: "",
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
    timezone: normalizeFormTimezone(data?.timezone),
    active_from: String(data?.active_from || ""),
    active_to: String(data?.active_to || ""),
    cooldown_seconds: Math.max(0, Number(data?.cooldown_seconds || 0) || 0),
    symbols: symbolsToText(data?.symbols),
    timeframes: Array.isArray(data?.timeframes) ? data.timeframes : [],
    schedule: String(data?.schedule || ""),
    schedule_rows: Array.isArray(data?.schedule_rows)
      ? data.schedule_rows
      : parseLegacyScheduleRows(data?.schedule, data?.cadence_seconds || 60),
    avoid_news: data?.avoid_news === true,
  };
  const autoSaveForForm = normalizeCronAutoSaveForForm(data?.auto_save);
  switch (cronType) {
    case "MARKET_DATA_CRON":
      return {
        ...base,
        provider: String(data?.provider || "twelvedata"),
        batch_size: Number(data?.batch_size || 8),
        exclude_symbols: symbolsToText(data?.exclude_symbols),
      };
    case "DOWNLOAD_BARS_CRON":
      return {
        ...base,
        provider: String(data?.provider || "auto"),
        batch_size: Number(data?.batch_size || 8),
        exclude_symbols: symbolsToText(data?.exclude_symbols),
        direction: String(data?.direction || "latest"),
        bars_count: Number(data?.bars_count || 1000),
      };
    case "ANALYSIS_CRON":
      return {
        ...base,
        pickup_mode: String(data?.pickup_mode || "all"),
        refresh_snapshot:
          data?.refresh_snapshot === true || data?.snapshot_refresh === true,
        directions: Array.isArray(data?.directions)
          ? data.directions
          : ["BUY", "SELL"],
        order_types: Array.isArray(data?.order_types)
          ? data.order_types
          : ["market", "limit", "stop"],
        model: String(data?.model || "claude-sonnet-4-0"),
        profile: String(data?.profile || ""),
        entry_models: Array.isArray(data?.entry_models)
          ? data.entry_models.join("\n")
          : "",
        prompt: String(data?.prompt || ""),
        auto_save: autoSaveForForm,
      };
    case "STRATEGY_SCAN_CRON":
      return {
        ...base,
        pickup_mode: String(data?.pickup_mode || "all"),
        strategy_ids: Array.isArray(data?.strategy_ids)
          ? data.strategy_ids
          : Array.isArray(data?.strategies)
            ? data.strategies
            : [],
        bars_count: Number(data?.bars_count || 300),
        auto_save: autoSaveForForm,
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
        symbols_per_tick: Number.isFinite(Number(data?.symbols_per_tick))
          ? Number(data.symbols_per_tick)
          : 0,
      };
    case "TRADES_BULK_ACTION":
      return {
        ...base,
        symbols: symbolsToText(data?.symbols),
        execution_statuses: Array.isArray(data?.execution_statuses)
          ? data.execution_statuses
          : [],
        pnl_state: String(data?.pnl_state || ""),
        directions: Array.isArray(data?.directions) ? data.directions : [],
        time_range: String(data?.time_range || "all"),
        account_ids: Array.isArray(data?.account_ids) ? data.account_ids : [],
        source_ids: Array.isArray(data?.source_ids) ? data.source_ids : [],
        bulk_action: String(data?.bulk_action || ""),
      };
    default:
      return base;
  }
}

function formToDataPayload(form) {
  const symbols = parseTextList(form.symbols, true);
  const data = {
    cron_type: form.cron_type,
    timezone: String(form.timezone || CURRENT_TIMEZONE),
    active_from: String(form.active_from || ""),
    active_to: String(form.active_to || ""),
    cooldown_seconds: Math.max(0, Number(form.cooldown_seconds || 0) || 0),
    symbols,
    symbols_group: null,
    timeframes: form.timeframes,
    schedule: summarizeScheduleRows(form.schedule_rows) || form.schedule || "",
    schedule_rows: Array.isArray(form.schedule_rows) ? form.schedule_rows : [],
    avoid_news: form.avoid_news === true,
    cadence_seconds: form.cadence_seconds,
  };
  switch (form.cron_type) {
    case "MARKET_DATA_CRON":
      return {
        ...data,
        provider: form.provider,
        batch_size: form.batch_size,
        exclude_symbols: parseTextList(form.exclude_symbols, true),
      };
    case "DOWNLOAD_BARS_CRON":
      return {
        ...data,
        provider: form.provider,
        batch_size: form.batch_size,
        exclude_symbols: parseTextList(form.exclude_symbols, true),
        direction: String(form.direction || "latest"),
        bars_count: Number(form.bars_count || 1000),
      };
    case "ANALYSIS_CRON":
      return {
        ...data,
        pickup_mode: form.pickup_mode || "all",
        refresh_snapshot: form.refresh_snapshot === true,
        directions: form.directions,
        order_types: form.order_types,
        model: form.model,
        profile: form.profile,
        entry_models: parseTextList(form.entry_models),
        prompt: form.prompt,
        auto_save: normalizeCronAutoSaveForPayload(form.auto_save),
      };
    case "STRATEGY_SCAN_CRON":
      return {
        ...data,
        pickup_mode: form.pickup_mode || "all",
        strategy_ids: Array.isArray(form.strategy_ids) ? form.strategy_ids : [],
        bars_count: Math.max(50, Number(form.bars_count || 300) || 300),
        auto_save: normalizeCronAutoSaveForPayload(form.auto_save),
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
    case "TRADES_BULK_ACTION":
      return {
        ...data,
        symbols,
        execution_statuses: Array.isArray(form.execution_statuses)
          ? form.execution_statuses
          : [],
        pnl_state: String(form.pnl_state || "")
          .trim()
          .toLowerCase(),
        directions: Array.isArray(form.directions) ? form.directions : [],
        time_range: String(form.time_range || "all")
          .trim()
          .toLowerCase(),
        account_ids: Array.isArray(form.account_ids) ? form.account_ids : [],
        source_ids: Array.isArray(form.source_ids) ? form.source_ids : [],
        bulk_action: String(form.bulk_action || "")
          .trim()
          .toLowerCase(),
      };
    default:
      return data;
  }
}

function normalizeCronAutoSaveForForm(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "signals" || normalized === "trades") return normalized;
  return "none";
}

function normalizeCronAutoSaveForPayload(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "signals" || normalized === "trades") return normalized;
  return null;
}

// ── Component ───────────────────────────────────────────────────────────────

function MasterCronToggle() {
  const [active, setActive] = useState(null);
  const [message, setMessage] = useState("");

  const fetchStatus = async () => {
    try {
      const r = await (await fetch("/health")).json();
      setActive(r.cron !== "paused");
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const toggle = async () => {
    try {
      const r = await (
        await fetch("/api/cron/master/toggle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).json();
      setActive(r.active);
      setMessage(r.active ? "Cron master ACTIVATED" : "Cron master PAUSED");
    } catch (e) {
      setMessage("Toggle failed: " + e.message);
    }
  };

  if (active === null) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span
        className="minor-text"
        style={{ fontSize: 11, whiteSpace: "nowrap" }}
      >
        Master Scheduler
      </span>
      <ToggleButton
        active={active}
        onClick={toggle}
        labelActive="Running"
        labelInActive="Paused"
        classActive="secondary-button"
        classInActive="secondary-button"
        colorActive="#22c55e"
        colorInActive="#94a3b8"
        style={{ marginLeft: 0 }}
        title={active ? "Running" : "Paused"}
      />
      {message ? (
        <span className="minor-text" style={{ fontSize: 11 }}>
          {message}
        </span>
      ) : null}
    </div>
  );
}

export default function CronPage() {
  const confirm = useConfirmDialog();
  const navigate = useNavigate();
  const { cronName: routeCronName } = useParams();
  const [settings, setSettings] = useState(() =>
    Array.isArray(cronPageCache.settings) ? cronPageCache.settings : [],
  );
  const [loading, setLoading] = useState(
    () => !Array.isArray(cronPageCache.settings),
  );
  const [loadError, setLoadError] = useState("");
  const [selectedCronName, setSelectedCronName] = useState(null);
  const [cronName, setCronName] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [showNewCronPicker, setShowNewCronPicker] = useState(false);
  const [isCronSidebarOpen, setIsCronSidebarOpen] = useState(true);
  const [form, setForm] = useState(defaultForm("MARKET_DATA_CRON"));
  const [detailTab, setDetailTab] = useState("settings");
  const [accounts, setAccounts] = useState(() =>
    Array.isArray(cronPageCache.accounts) ? cronPageCache.accounts : [],
  );
  const [sources, setSources] = useState(() =>
    Array.isArray(cronPageCache.sources) ? cronPageCache.sources : [],
  );
  const [strategies, setStrategies] = useState(() =>
    Array.isArray(cronPageCache.strategies) ? cronPageCache.strategies : [],
  );

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

  const symbolGroupsData = useMemo(
    () => getSymbolGroupsDataFromSettings(settings),
    [settings],
  );

  const tradeBulkActionHasFilters = useMemo(() => {
    if (form.cron_type !== "TRADES_BULK_ACTION") return true;
    return Boolean(
      parseTextList(form.symbols, true).length > 0 ||
      (Array.isArray(form.execution_statuses) &&
        form.execution_statuses.length > 0) ||
      String(form.pnl_state || "").trim() ||
      (Array.isArray(form.directions) && form.directions.length > 0) ||
      String(form.time_range || "all")
        .trim()
        .toLowerCase() !== "all" ||
      (Array.isArray(form.account_ids) && form.account_ids.length > 0) ||
      (Array.isArray(form.source_ids) && form.source_ids.length > 0),
    );
  }, [form]);

  const reloadSettings = useCallback(
    async ({ preserveSelection = true, showSpinner = true } = {}) => {
      if (showSpinner) setLoading(true);
      setLoadError("");
      try {
        const res = await api.getSettings();
        const list = Array.isArray(res?.settings) ? res.settings : [];
        cronPageCache.settings = list;
        setSettings(list);
        const crons = list.filter((s) => s?.type === "cron");
        if (!preserveSelection) return list;
        setSelectedCronName((prev) => {
          if (prev && crons.some((s) => s.name === prev)) return prev;
          if (prev) return prev;
          return crons.length > 0 ? crons[0].name : null;
        });
        return list;
      } catch (err) {
        setLoadError(err?.message || String(err || "Failed to load settings"));
        return [];
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [],
  );

  // ── Load settings & watchlist ───────────────────────────────────────────

  useEffect(() => {
    void reloadSettings({ showSpinner: true });
  }, [reloadSettings]);

  useEffect(() => {
    if (routeCronName) {
      setSelectedCronName((prev) => (prev === routeCronName ? prev : routeCronName));
      return;
    }
    setSelectedCronName((prev) => {
      if (prev && cronSettings.some((s) => s.name === prev)) return prev;
      return cronSettings.length > 0 ? cronSettings[0].name : null;
    });
  }, [routeCronName, cronSettings]);

  useEffect(() => {
    let cancelled = false;
    async function loadTradeMeta() {
      try {
        const [accountsRes, sourcesRes, strategiesRes] = await Promise.all([
          api.v2Accounts(),
          api.v2Sources(),
          api.listStrategies(),
        ]);
        if (cancelled) return;
        const nextAccounts = Array.isArray(accountsRes?.items)
          ? accountsRes.items
          : [];
        const nextSources = Array.isArray(sourcesRes?.items)
          ? sourcesRes.items
          : [];
        const nextStrategies = normalizeStrategyCatalog(strategiesRes?.items)
          .filter((item) => {
            const status = String(item?.status || "").trim().toLowerCase();
            return status !== "archived";
          });
        cronPageCache.accounts = nextAccounts;
        cronPageCache.sources = nextSources;
        cronPageCache.strategies = nextStrategies;
        setAccounts(nextAccounts);
        setSources(nextSources);
        setStrategies(nextStrategies);
      } catch {
        if (cancelled) return;
        cronPageCache.accounts = [];
        cronPageCache.sources = [];
        cronPageCache.strategies = [];
        setAccounts([]);
        setSources([]);
        setStrategies([]);
      }
    }
    loadTradeMeta();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Populate form when selected cron changes ───────────────────────────

  useEffect(() => {
    if (!selectedCronName) {
      setForm(defaultForm("MARKET_DATA_CRON"));
      return;
    }
    if (isNewCron) {
      return;
    }
    if (selectedCron) {
      const d =
        typeof selectedCron.data === "string"
          ? JSON.parse(selectedCron.data)
          : selectedCron.data || {};
      const baseForm = formFromCronData(d);
      if (
        (!baseForm.symbols || !String(baseForm.symbols).trim()) &&
        d.symbols_group
      ) {
        baseForm.symbols = normalizeSymbolList(
          getSymbolGroupSymbols(symbolGroupsData, d.symbols_group),
        ).join("\n");
      }
      setForm(baseForm);
      setCronName(selectedCron.name || "");
    }
  }, [selectedCronName, selectedCron, isNewCron, symbolGroupsData]);

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
      navigate(`/settings/crons/${encodeURIComponent(name)}`);
      setSaveMsg("");
    },
    [navigate],
  );

  const handleSave = useCallback(async () => {
    console.log("[cron-save] start, selectedCronName=", selectedCronName);
    if (!selectedCronName) return;
    setSaveLoading(true);
    setSaveMsg("");
    try {
      const scheduleError = validateScheduleRows(form.schedule_rows);
      if (scheduleError) throw new Error(scheduleError);
      const data = formToDataPayload(form);
      const existing = cronSettings.find((s) => s.name === selectedCronName);
      const status = existing ? existing.status || "ACTIVE" : "INACTIVE";
      // Auto-rename if another cron already has this name (avoid duplicates)
      let finalName = cronName;
      if (!selectedCronName || selectedCronName !== cronName) {
        const others = cronSettings.filter((s) => s.name !== selectedCronName);
        let suffix = 2;
        while (others.some((s) => s.name === finalName)) {
          finalName = `${cronName}_${suffix}`;
          suffix++;
        }
      }
      const payload = {
        type: "cron",
        name: finalName,
        data,
        status,
      };
      // If renaming, delete old row first
      if (selectedCronName && selectedCronName !== finalName) {
        await api.deleteSetting("cron", selectedCronName).catch(() => {});
      }
      await api.upsertSetting(payload);
      setSelectedCronName(finalName);
      navigate(`/settings/crons/${encodeURIComponent(finalName)}`);
      const msg = `${CRON_TYPE_LABELS[form.cron_type] || form.cron_type} saved.`;
      setSaveMsg(msg);
      // Reload
      await reloadSettings({ showSpinner: false });
    } catch (err) {
      console.error("[cron-save]", err);
      const errMsg = err?.message || String(err || "Save failed");
      setSaveMsg(errMsg);
    } finally {
      setSaveLoading(false);
      setTimeout(() => setSaveMsg(""), 5000);
    }
  }, [selectedCronName, cronName, form, cronSettings, navigate, reloadSettings]);

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
      setSaveMsg("Cron deleted.");
      const list = await reloadSettings({
        preserveSelection: false,
        showSpinner: false,
      });
      // Select next cron or clear
      const crons = list.filter((s) => s?.type === "cron");
      const nextCronName = crons.length > 0 ? crons[0].name : null;
      setSelectedCronName(nextCronName);
      if (nextCronName) {
        navigate(`/settings/crons/${encodeURIComponent(nextCronName)}`, {
          replace: true,
        });
      } else {
        navigate(`/settings/crons`, { replace: true });
      }
      if (crons.length === 0) {
        setForm(defaultForm("MARKET_DATA_CRON"));
      }
    } catch (err) {
      setSaveMsg(err?.message || "Delete failed.");
    } finally {
      setSaveLoading(false);
    }
  }, [selectedCron, isNewCron, confirm, navigate, reloadSettings]);

  const handleToggleStatus = useCallback(async () => {
    console.log("[cron-toggle] start, selectedCron=", selectedCron?.name);
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
      setSaveMsg(`Cron ${newStatus}.`);
      await reloadSettings({ showSpinner: false });
    } catch (err) {
      console.error("[cron-toggle]", err);
      setSaveMsg(err?.message || "Toggle failed.");
    } finally {
      setSaveLoading(false);
    }
  }, [selectedCron, reloadSettings]);

  const handleCheckboxToggle = useCallback((field, value) => {
    setForm((prev) => {
      const arr = prev[field] || [];
      const next = arr.includes(value)
        ? arr.filter((x) => x !== value)
        : [...arr, value];
      return { ...prev, [field]: next };
    });
  }, []);

  const handleRunCron = useCallback(async () => {
    if (!selectedCron || isNewCron) return;
    setRunLoading(true);
    try {
      await api.runCron(selectedCron.name);
      setDetailTab("logs");
    } catch (_) {
    } finally {
      setRunLoading(false);
    }
  }, [isNewCron, selectedCron]);

  // ── Render helpers ────────────────────────────────────────────────────────

  const isActive =
    selectedCron &&
    String(selectedCron.status || "").toUpperCase() === "ACTIVE";

  const cronTypeLabel = CRON_TYPE_LABELS[form.cron_type] || form.cron_type;

  useEffect(() => {
    if (!selectedCronName) {
      setDetailTab("settings");
    }
  }, [selectedCronName]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading && settings.length === 0) {
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
      <PageHeader
        title="Cron Jobs"
        actions={<MasterCronToggle />}
        titleTag="h1"
      />

      <MasterDetailLayout
        sidebarWidth={280}
        sidebarCollapsed={!isCronSidebarOpen}
        collapsedSidebarWidth={40}
      >
        {/* ── Left: Cron List ─────────────────────────────── */}
        <ResponsivePanel
          title="CRONS"
          width="100%"
          open={isCronSidebarOpen}
          onOpenChange={setIsCronSidebarOpen}
          collapseDirection="left-right"
          headerActions={
            <button
              className="secondary-button"
              onClick={() => setShowNewCronPicker((v) => !v)}
            >
              + New
            </button>
          }
          bodyClassName="stack-layout"
          style={{ minWidth: 0 }}
        >
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
              const ctLabel =
                CRON_TYPE_LABELS[data.cron_type] || data.cron_type || "Unknown";
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
                    navigate(
                      `/settings/crons/${encodeURIComponent(cron.name)}`,
                    );
                    setShowNewCronPicker(false);
                  }}
                />
              );
            })
          )}
        </ResponsivePanel>

        {/* ── Right: Edit Form ───────────────────────────── */}
        <MasterDetailContentPanel key={selectedCronName || "empty"}>
          {!selectedCronName ? (
            <div className="minor-text" style={{ padding: "12px 0" }}>
              Select a cron from the list or create a new one.
            </div>
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
                  <input
                    value={cronName}
                    onChange={(e) => setCronName(e.target.value)}
                    placeholder="Cron name..."
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      border: "none",
                      background: "transparent",
                      color: "inherit",
                      width: "100%",
                      outline: "none",
                      paddingLeft: 0,
                    }}
                  />
                  {isNewCron && (
                    <span
                      className="minor-text"
                      style={{ fontSize: 10, fontWeight: 400 }}
                    >
                      (new)
                    </span>
                  )}
                  <span className="minor-text" style={{ fontSize: 11 }}>
                    Type: {cronTypeLabel}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {selectedCron && (
                    <ToggleButton
                      active={isActive}
                      classActive="secondary-button"
                      classInActive="secondary-button"
                      labelActive="Enabled"
                      labelInActive="Disabled"
                      colorActive="#22c55e"
                      colorInActive="#94a3b8"
                      onClick={handleToggleStatus}
                      disabled={saveLoading || runLoading}
                    />
                  )}
                  {selectedCron && !isNewCron && detailTab === "settings" && (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleRunCron}
                      disabled={saveLoading || runLoading}
                    >
                      {runLoading ? "RUNNING..." : "RUN"}
                    </button>
                  )}
                  <TabBar
                    value={detailTab}
                    options={[
                      { label: "Settings", value: "settings" },
                      { label: "Logs", value: "logs" },
                    ]}
                    onChange={setDetailTab}
                    ariaLabel="Cron detail tab"
                  />
                </div>
              </div>

              {detailTab === "settings" ? (
                <>
                  <div className="stack-layout" style={{ gap: 12 }}>
                    <CronSectionCard title="CRON SCHEDULE">
                      <CronInterval
                        rows={form.schedule_rows}
                        avoidNews={form.avoid_news === true}
                        timezone={form.timezone || CURRENT_TIMEZONE}
                        headerControls={
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "minmax(140px, 160px) minmax(180px, 1fr) minmax(180px, 1fr) minmax(120px, 140px)",
                              gap: 12,
                            }}
                          >
                            <label className="stack-layout" style={{ gap: 6 }}>
                              <span className="minor-text">Timezone</span>
                              <TimezoneComboSelect
                                value={form.timezone || CURRENT_TIMEZONE}
                                onChange={(e) =>
                                  updateForm({ timezone: e.target.value })
                                }
                              />
                            </label>
                            <label className="stack-layout" style={{ gap: 6 }}>
                              <span className="minor-text">Active From</span>
                              <DateTimePicker
                                mode="datetime"
                                value={form.active_from}
                                onChange={(e) =>
                                  updateForm({
                                    active_from: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="stack-layout" style={{ gap: 6 }}>
                              <span className="minor-text">Active To</span>
                              <DateTimePicker
                                mode="datetime"
                                value={form.active_to}
                                onChange={(e) =>
                                  updateForm({
                                    active_to: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="stack-layout" style={{ gap: 6 }}>
                              <span className="minor-text">Cooldown</span>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={form.cooldown_seconds || 0}
                                onChange={(e) =>
                                  updateForm({
                                    cooldown_seconds: Math.max(
                                      0,
                                      Number(e.target.value) || 0,
                                    ),
                                  })
                                }
                              />
                            </label>
                          </div>
                        }
                        onChange={({ rows, avoid_news }) =>
                          updateForm({
                            schedule_rows: rows,
                            avoid_news,
                            schedule: summarizeScheduleRows(rows),
                            cadence_seconds: resolveScheduleCadenceSeconds(
                              rows,
                              form.cadence_seconds || 60,
                            ),
                          })
                        }
                      />
                    </CronSectionCard>

                    {form.cron_type !== "TRADES_BULK_ACTION" && (
                      <>
                        <SymbolTogglePicker
                          value={parseTextList(form.symbols, true)}
                          onChange={(next) =>
                            updateForm({ symbols: symbolsToText(next) })
                          }
                          symbolGroups={symbolGroupsData.groups}
                          compact
                        />

                        <CronSectionCard
                          title="TIMEFRAMES"
                          subtitle={`ADVANCED SETTINGS — ${cronTypeLabel.toUpperCase()}`}
                        >
                          <TimeframeSelector
                            value={form.timeframes}
                            onChange={(next) =>
                              updateForm({ timeframes: next })
                            }
                            options={TIMEFRAME_OPTIONS}
                            multiple
                            ariaLabel="Cron timeframes"
                          />
                        </CronSectionCard>
                      </>
                    )}

                    {form.cron_type === "TRADES_BULK_ACTION" && (
                      <CronSectionCard
                        title="FILTER TRADES"
                        subtitle="No filters selected means no action will run."
                      >
                        <div className="stack-layout" style={{ gap: 14 }}>
                          <SymbolTogglePicker
                            value={parseTextList(form.symbols, true)}
                            onChange={(next) =>
                              updateForm({ symbols: symbolsToText(next) })
                            }
                            symbolGroups={symbolGroupsData.groups}
                            compact
                          />

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
                                STATUS
                              </span>
                              <CheckboxMultiGroup
                                options={TRADE_STATUS_OPTIONS}
                                values={form.execution_statuses}
                                onToggle={(value) =>
                                  handleCheckboxToggle(
                                    "execution_statuses",
                                    value,
                                  )
                                }
                              />
                            </div>

                            <div className="stack-layout" style={{ gap: 6 }}>
                              <span
                                className="panel-label"
                                style={{ fontSize: 10, marginBottom: 0 }}
                              >
                                DIRECTION
                              </span>
                              <CheckboxMultiGroup
                                options={DIRECTION_OPTIONS.map((item) => ({
                                  value: item,
                                  label: item,
                                }))}
                                values={form.directions}
                                onToggle={(value) =>
                                  handleCheckboxToggle("directions", value)
                                }
                              />
                            </div>
                          </div>

                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr 1fr",
                              gap: 12,
                            }}
                          >
                            <label className="stack-layout" style={{ gap: 6 }}>
                              <span className="minor-text">
                                Current Win/Lose
                              </span>
                              <InputComboSelect
                                value={form.pnl_state || ""}
                                onChange={(e) =>
                                  updateForm({ pnl_state: e.target.value })
                                }
                              >
                                {TRADE_PNL_STATE_OPTIONS.map((opt) => (
                                  <option
                                    key={opt.value || "all"}
                                    value={opt.value}
                                  >
                                    {opt.label}
                                  </option>
                                ))}
                              </InputComboSelect>
                            </label>

                            <label className="stack-layout" style={{ gap: 6 }}>
                              <span className="minor-text">Times</span>
                              <InputComboSelect
                                value={form.time_range || "all"}
                                onChange={(e) =>
                                  updateForm({ time_range: e.target.value })
                                }
                              >
                                {TRADE_TIME_RANGE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </InputComboSelect>
                            </label>

                            <label className="stack-layout" style={{ gap: 6 }}>
                              <span className="minor-text">Bulk Action</span>
                              <InputComboSelect
                                value={form.bulk_action || ""}
                                onChange={(e) =>
                                  updateForm({ bulk_action: e.target.value })
                                }
                              >
                                {TRADE_BULK_ACTION_OPTIONS.map((opt) => (
                                  <option
                                    key={opt.value || "none"}
                                    value={opt.value}
                                  >
                                    {opt.label}
                                  </option>
                                ))}
                              </InputComboSelect>
                            </label>
                          </div>

                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 12,
                            }}
                          >
                            <label className="stack-layout" style={{ gap: 6 }}>
                              <span className="minor-text">Accounts</span>
                              <InputComboSelect
                                multiple
                                value={
                                  Array.isArray(form.account_ids)
                                    ? form.account_ids
                                    : []
                                }
                                onChange={(e) =>
                                  updateForm({
                                    account_ids: getSelectValues(e),
                                  })
                                }
                                style={{ minHeight: 120 }}
                              >
                                {accounts.map((account) => {
                                  const accountId = String(
                                    account?.account_id ||
                                      account?.object_id ||
                                      "",
                                  ).trim();
                                  if (!accountId) return null;
                                  const name = String(
                                    account?.name || "",
                                  ).trim();
                                  return (
                                    <option key={accountId} value={accountId}>
                                      {name
                                        ? `${name} (${accountId})`
                                        : accountId}
                                    </option>
                                  );
                                })}
                              </InputComboSelect>
                            </label>

                            <label className="stack-layout" style={{ gap: 6 }}>
                              <span className="minor-text">Sources</span>
                              <InputComboSelect
                                multiple
                                value={
                                  Array.isArray(form.source_ids)
                                    ? form.source_ids
                                    : []
                                }
                                onChange={(e) =>
                                  updateForm({
                                    source_ids: getSelectValues(e),
                                  })
                                }
                                style={{ minHeight: 120 }}
                              >
                                {sources.map((source) => {
                                  const sourceId = String(
                                    source?.source_id || "",
                                  ).trim();
                                  if (!sourceId) return null;
                                  const label = String(
                                    source?.name || source?.label || sourceId,
                                  ).trim();
                                  return (
                                    <option key={sourceId} value={sourceId}>
                                      {label}
                                    </option>
                                  );
                                })}
                              </InputComboSelect>
                            </label>
                          </div>

                          {!tradeBulkActionHasFilters ? (
                            <div
                              className="minor-text"
                              style={{ color: "#f59e0b" }}
                            >
                              This cron is safe-by-default: with no selected
                              filters, manual run and scheduled run will skip
                              without touching any trades.
                            </div>
                          ) : null}
                        </div>
                      </CronSectionCard>
                    )}

                    {/* MARKET_DATA_CRON fields */}
                    {(form.cron_type === "MARKET_DATA_CRON" ||
                      form.cron_type === "DOWNLOAD_BARS_CRON") && (
                      <>
                        {/* Row: Provider / Batch Size / Download Bars extras */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              form.cron_type === "DOWNLOAD_BARS_CRON"
                                ? "1fr 1fr 1fr 1fr"
                                : "1fr 1fr",
                            gap: 12,
                          }}
                        >
                          <label className="stack-layout" style={{ gap: 6 }}>
                            <span className="minor-text">Provider</span>
                            <InputComboSelect
                              value={form.provider}
                              onChange={(e) =>
                                updateForm({ provider: e.target.value })
                              }
                            >
                              <option value="auto">Auto</option>
                              <option value="twelvedata">Twelve Data</option>
                              <option value="binance">Binance</option>
                            </InputComboSelect>
                          </label>

                          <label className="stack-layout" style={{ gap: 6 }}>
                            <span className="minor-text">Batch Size</span>
                            <input
                              type="number"
                              min="1"
                              max="50"
                              value={form.batch_size}
                              onChange={(e) =>
                                updateForm({
                                  batch_size: Number(e.target.value),
                                })
                              }
                            />
                          </label>

                          {form.cron_type === "DOWNLOAD_BARS_CRON" && (
                            <>
                              <label
                                className="stack-layout"
                                style={{ gap: 6 }}
                              >
                                <span className="minor-text">Direction</span>
                                <InputComboSelect
                                  value={form.direction}
                                  onChange={(e) =>
                                    updateForm({ direction: e.target.value })
                                  }
                                >
                                  {DOWNLOAD_DIRECTION_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </InputComboSelect>
                              </label>

                              <label
                                className="stack-layout"
                                style={{ gap: 6 }}
                              >
                                <span className="minor-text">Bars / call</span>
                                <input
                                  type="number"
                                  min="50"
                                  max="5000"
                                  value={form.bars_count}
                                  onChange={(e) =>
                                    updateForm({
                                      bars_count: Number(e.target.value),
                                    })
                                  }
                                />
                              </label>
                            </>
                          )}
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

                        {form.cron_type === "DOWNLOAD_BARS_CRON" && (
                          <div className="minor-text" style={{ fontSize: 12 }}>
                            `latest` downloads the newest bars for each TF.
                            `history` downloads older bars backward from the
                            earliest bar already stored in the file. Provider
                            caps: Twelve Data up to 5000 bars per call, Binance
                            up to 1000 per call.
                          </div>
                        )}
                      </>
                    )}

                    {/* ANALYSIS_CRON fields */}
                    {form.cron_type === "ANALYSIS_CRON" && (
                      <>
                        {/* Pickup Mode */}
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
                              PICKUP MODE
                            </span>
                            <InputComboSelect
                              value={form.pickup_mode || "all"}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  pickup_mode: e.target.value,
                                }))
                              }
                            >
                              <option value="all">
                                All — run on every selected symbol
                              </option>
                              <option value="random">
                                Random — pick 1 random symbol
                              </option>
                            </InputComboSelect>
                          </div>
                        </div>

                        {/* Snapshot behavior */}
                        <div className="stack-layout" style={{ gap: 6 }}>
                          <span
                            className="panel-label"
                            style={{ fontSize: 10, marginBottom: 0 }}
                          >
                            SNAPSHOT SETTING
                          </span>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={form.refresh_snapshot === true}
                              onChange={(e) =>
                                updateForm({
                                  refresh_snapshot: e.target.checked,
                                })
                              }
                            />
                            <span style={{ fontSize: 13 }}>
                              Always refresh snapshot before analysis
                            </span>
                          </label>
                          <div className="minor-text" style={{ fontSize: 11 }}>
                            Off: use existing snapshot only if age is 5m or
                            less; otherwise auto-refresh before analysis.
                          </div>
                        </div>

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
                                    checked={form.directions.includes(
                                      direction,
                                    )}
                                    onChange={() =>
                                      handleCheckboxToggle(
                                        "directions",
                                        direction,
                                      )
                                    }
                                  />
                                  <span style={{ fontSize: 13 }}>
                                    {direction}
                                  </span>
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

                        {/* Model / Profile / Auto Save — compact row */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr 1fr",
                            gap: 12,
                          }}
                        >
                          <div className="stack-layout" style={{ gap: 6 }}>
                            <span
                              className="panel-label"
                              style={{ fontSize: 10, marginBottom: 0 }}
                            >
                              MODEL
                            </span>
                            <InputComboSelect
                              value={form.model}
                              onChange={(e) =>
                                updateForm({ model: e.target.value })
                              }
                            >
                              {API_KEY_NAME_OPTIONS.map((opt) => (
                                <option
                                  key={opt.value}
                                  value={opt.value.toLowerCase()}
                                >
                                  {opt.label}
                                </option>
                              ))}
                            </InputComboSelect>
                          </div>
                          <div className="stack-layout" style={{ gap: 6 }}>
                            <span
                              className="panel-label"
                              style={{ fontSize: 10, marginBottom: 0 }}
                            >
                              PROFILE
                            </span>
                            <input
                              value={form.profile}
                              onChange={(e) =>
                                updateForm({ profile: e.target.value })
                              }
                              placeholder="Profile name"
                            />
                          </div>
                          <div className="stack-layout" style={{ gap: 6 }}>
                            <span
                              className="panel-label"
                              style={{ fontSize: 10, marginBottom: 0 }}
                            >
                              AUTO SAVE
                            </span>
                            <InputComboSelect
                              value={form.auto_save || "trades"}
                              onChange={(e) =>
                                updateForm({ auto_save: e.target.value })
                              }
                            >
                              <option value="none">None (files)</option>
                              <option value="signals">Trade (Draft)</option>
                              <option value="trades">Trade (Pending)</option>
                              <option value="trades">Trades (Object Store)</option>
                            </InputComboSelect>
                          </div>
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
                            PROMPT TEMPLATE
                          </span>
                          <InputComboSelect
                            value={form.prompt_template || "custom"}
                            onChange={(e) => {
                              const tpl = e.target.value;
                              updateForm({
                                prompt_template: tpl,
                                prompt:
                                  tpl === "custom"
                                    ? form.prompt
                                    : PROMPT_TEMPLATES[tpl] || "",
                              });
                            }}
                          >
                            <option value="custom">Custom</option>
                            <option value="smc">SMC Default</option>
                            <option value="pa">Price Action</option>
                            <option value="ict">ICT</option>
                            <option value="scalp">Scalping</option>
                          </InputComboSelect>
                        </div>

                        {/* Prompt Text */}
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
                            onChange={(e) => {
                              updateForm({
                                prompt: e.target.value,
                                prompt_template: "custom",
                              });
                            }}
                            placeholder="Instructions for AI setup detection..."
                          />
                        </div>
                      </>
                    )}

                    {form.cron_type === "STRATEGY_SCAN_CRON" && (
                      <>
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
                              PICKUP MODE
                            </span>
                            <InputComboSelect
                              value={form.pickup_mode || "all"}
                              onChange={(e) =>
                                updateForm({ pickup_mode: e.target.value })
                              }
                            >
                              <option value="all">
                                All — run on every selected symbol
                              </option>
                              <option value="random">
                                Random — pick 1 random symbol
                              </option>
                            </InputComboSelect>
                          </div>

                          <div className="stack-layout" style={{ gap: 6 }}>
                            <span
                              className="panel-label"
                              style={{ fontSize: 10, marginBottom: 0 }}
                            >
                              AUTO SAVE
                            </span>
                            <InputComboSelect
                              value={form.auto_save || "trades"}
                              onChange={(e) =>
                                updateForm({ auto_save: e.target.value })
                              }
                            >
                              <option value="none">None</option>
                              <option value="signals">Trade (Draft)</option>
                              <option value="trades">Trade (Pending)</option>
                              <option value="trades">Trades (Object Store)</option>
                            </InputComboSelect>
                          </div>
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 12,
                          }}
                        >
                          <label className="stack-layout" style={{ gap: 6 }}>
                            <span className="minor-text">Latest Bars Window</span>
                            <input
                              type="number"
                              min="50"
                              max="5000"
                              value={form.bars_count}
                              onChange={(e) =>
                                updateForm({
                                  bars_count: Number(e.target.value),
                                })
                              }
                            />
                          </label>

                          <div className="stack-layout" style={{ gap: 6 }}>
                            <span className="minor-text">Engine</span>
                            <div className="minor-text" style={{ fontSize: 11 }}>
                              Runs the shared live strategy scan on the most
                              recent bar only, while still respecting active
                              status, timeframe filters, symbol filters, and
                              news/session conditions.
                            </div>
                          </div>
                        </div>

                        <label className="stack-layout" style={{ gap: 6 }}>
                          <span className="minor-text">Strategies</span>
                          <InputComboSelect
                            multiple
                            searchable
                            value={
                              Array.isArray(form.strategy_ids)
                                ? form.strategy_ids
                                : []
                            }
                            onChange={(e) =>
                              updateForm({
                                strategy_ids: getSelectValues(e),
                              })
                            }
                            style={{ minHeight: 180 }}
                          >
                            {strategies.map((strategy) => {
                              const strategyId = String(
                                strategy?.id || strategy?.key || "",
                              ).trim();
                              if (!strategyId) return null;
                              const name = String(
                                strategy?.name || strategyId,
                              ).trim();
                              const kind = String(
                                strategy?.kind || "",
                              ).trim();
                              const status = String(
                                strategy?.status || "",
                              ).trim();
                              const marketTf = String(
                                strategy?.market?.tf || "",
                              ).trim();
                              const meta = [kind, status, marketTf]
                                .filter(Boolean)
                                .join(" · ");
                              return (
                                <option key={strategyId} value={strategyId}>
                                  {meta ? `${name} (${meta})` : name}
                                </option>
                              );
                            })}
                          </InputComboSelect>
                        </label>
                      </>
                    )}

                    {/* SNAPSHOT_CRON fields */}
                    {form.cron_type === "SNAPSHOT_CRON" && (
                      <>
                        {/* Broker Select */}
                        <div className="stack-layout" style={{ gap: 6 }}>
                          <span
                            className="panel-label"
                            style={{ fontSize: 10, marginBottom: 0 }}
                          >
                            BROKER (optional)
                          </span>
                          <InputComboSelect
                            value={form.broker || ""}
                            onChange={(e) =>
                              updateForm({ broker: e.target.value })
                            }
                          >
                            <option value="">Auto (no prefix)</option>
                            <option value="ICMARKETS">IC Markets</option>
                            <option value="OANDA">OANDA</option>
                            <option value="FOREXCOM">Forex.com</option>
                            <option value="PEPPERSTONE">Pepperstone</option>
                            <option value="FXCM">FXCM</option>
                            <option value="BINANCE">Binance</option>
                            <option value="BYBIT">Bybit</option>
                          </InputComboSelect>
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
                            <InputComboSelect
                              value={form.format}
                              onChange={(e) =>
                                updateForm({ format: e.target.value })
                              }
                            >
                              {SNAPSHOT_FORMAT_OPTIONS.map((f) => (
                                <option key={f} value={f}>
                                  {f.toUpperCase()}
                                </option>
                              ))}
                            </InputComboSelect>
                          </label>

                          <label className="stack-layout" style={{ gap: 6 }}>
                            <span className="minor-text">Quality</span>
                            <InputComboSelect
                              value={form.quality}
                              onChange={(e) =>
                                updateForm({
                                  quality: Number(e.target.value),
                                })
                              }
                            >
                              {SNAPSHOT_QUALITY_OPTIONS.map((q) => (
                                <option key={q.value} value={q.value}>
                                  {q.label}
                                </option>
                              ))}
                            </InputComboSelect>
                          </label>

                          <label className="stack-layout" style={{ gap: 6 }}>
                            <span className="minor-text">Theme</span>
                            <InputComboSelect
                              value={form.theme}
                              onChange={(e) =>
                                updateForm({ theme: e.target.value })
                              }
                            >
                              {SNAPSHOT_THEME_OPTIONS.map((t) => (
                                <option key={t} value={t}>
                                  {t.charAt(0).toUpperCase() + t.slice(1)}
                                </option>
                              ))}
                            </InputComboSelect>
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
                                updateForm({
                                  lookback_bars: Number(e.target.value),
                                })
                              }
                            />
                          </label>

                          <label className="stack-layout" style={{ gap: 6 }}>
                            <span className="minor-text">
                              Symbols Per Tick (0 = All)
                            </span>
                            <input
                              type="number"
                              min="0"
                              max="50"
                              value={form.symbols_per_tick}
                              onChange={(e) =>
                                updateForm({
                                  symbols_per_tick: Number(e.target.value),
                                })
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
                </>
              ) : (
                <LogsViewer
                  source="cron"
                  objectId={selectedCronName}
                  fileName=""
                  logFormat={null}
                  limit={200}
                  emptyText="No log files found for this cron yet."
                  useCrudContainer
                />
              )}

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
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {selectedCron && !isNewCron && (
                    <button
                      className="danger-button"
                      onClick={handleDelete}
                      disabled={saveLoading || runLoading}
                    >
                      DELETE
                    </button>
                  )}
                </div>
                <button
                  className="primary-button"
                  onClick={handleSave}
                  disabled={saveLoading || runLoading}
                >
                  {saveLoading ? "SAVING..." : "SAVE"}
                </button>
              </div>

              {saveMsg && (
                <div
                  className="minor-text"
                  style={{
                    color: saveMsg.toLowerCase().includes("fail")
                      ? "var(--danger)"
                      : "var(--text)",
                  }}
                >
                  {saveMsg}
                </div>
              )}
            </>
          )}
        </MasterDetailContentPanel>
      </MasterDetailLayout>
    </div>
  );
}
