import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { api } from "../../../../app/api";
import { useSymbolChartData } from "../../hooks/useChartTileData";
import { useRealtimeSymbolChartMatrix } from "../../hooks/useRealtimeSymbolChartMatrix";
import { chartStreamStore, realtimeTransport } from "../../realtime/realtimeClientSingleton";
import TradeSignalChart from "../TradeSignalChart";
import ChartSVG from "./ChartSVG";
import TradingViewLoginModal from "../modals/TradingViewLoginModal";
import ImageViewer from "../../../../shared/components/ImageViewer";
import GroupButtons from "../../../../shared/components/GroupButtons";
import ResponsivePanel from "../../../../shared/components/ResponsivePanel";
import { StatusDisplay } from "../../../../shared/components/StatusBadge";
import { showToast } from "../../../../shared/components/ToastContainer";
import { resolveAdjusterValue, toNumLoose } from "./numberUtils";
import {
  createLineObject,
  createPointObject,
  clamp01,
} from "./chartObjectModel";
import InputComboSelect from "../../../../shared/components/InputComboSelect";
import {
  buildSingleTradeForChart,
  normalizeTradeRowsForChart,
  resolveTradeFocusedWindow,
} from "./backtestChartTheme";
import {
  formatRelativeDateTime,
  getEffectiveDisplayTimezone,
  showDateTime,
  sortTimeframes,
  asNumValue,
  formatNumValue,
} from "../../../../shared/utils/format";
import {
  mergeViewportArtifactObjects,
} from "../../../../shared/utils/symbolChartStreaming.js";
import {
  resolveTradeChartRenderBars,
  resolveTradeFetchBarsCount,
  resolveTradeFetchEndTimeSec,
  resolveTradeViewportEndTimeSec,
} from "../../../../shared/utils/tradeAnchor";
import { evaluateChartStrategies } from "../../../../shared/utils/chartStrategyChecks";
import * as sharedArtifactDetection from "../../chartArtifacts/detectArtifacts.js";
import { buildMultiTfAnalysis } from "../../chartArtifacts/realtimeAnalysis.js";

const BASE_MODES = ["live", "cache", "svg"];
const REPLAY_MODE = "replay";
const TRADINGVIEW_EMBED_AUTLOAD_PREF_KEY = "tv_embed_autoload_enabled";
const HISTORY_BARS_ACTION_COUNT = 2000;
const MAX_HISTORY_BARS = 20000;
const SYMBOL_CHART_MIN_LOADED_BARS = 5000;
const POST_LOAD_RECENTER_VISIBLE_BARS = 1500;
const MODE_LABELS = {
  live: "Live",
  cache: "Chart",
  replay: "Replay",
  svg: "SVG",
};
const GENERIC_REPLAY_SPEED_OPTIONS = [
  { value: 100, label: "0.1s" },
  { value: 200, label: "0.2s" },
  { value: 500, label: "0.5s" },
  { value: 1000, label: "1s" },
  { value: 2000, label: "2s" },
  { value: 5000, label: "5s" },
];
const LAYERS_TAB_ITEMS = [
  { value: "chart", label: "Charts" },
  { value: "artifacts", label: "Artifacts" },
  { value: "momentum", label: "Momentum" },
  { value: "trend", label: "Trend" },
];
const STATUS_COLORS = {
  IDLE: "var(--muted)",
  LOADING: "#f59e0b",
  READY: "#10b981",
  STALE: "#f59e0b",
  ERROR: "#ef4444",
};
const LIVE_DEBUG_CRYPTO_PREFIXES = [
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "ADA",
  "DOGE",
  "BNB",
  "AVAX",
  "MATIC",
  "LTC",
  "DOT",
  "LINK",
  "TRX",
  "BCH",
  "XLM",
  "ATOM",
  "TON",
  "SHIB",
];
const INDICATOR_GROUPS = [
  {
    label: "MOMENTUM",
    items: [
      { key: "rsi", label: "RSI (14)", color: "#a855f7" },
      { key: "rsiEma9", label: "RSI EMA (9)", color: "#facc15" },
      { key: "rsiWma45", label: "RSI WMA (45)", color: "#34d399" },
      { key: "stochK", label: "Stoch %K", color: "#3b82f6" },
      { key: "stochD", label: "Stoch %D", color: "#f59e0b" },
    ],
  },
  {
    label: "TREND",
    items: [
      { key: "sma20", label: "SMA (20)", color: "#60a5fa" },
      { key: "sma50", label: "SMA (50)", color: "#f97316" },
      { key: "sma200", label: "SMA (200)", color: "#22c55e" },
      { key: "vwap", label: "VWAP", color: "#0ea5e9" },
      { key: "bbMid", label: "BB Mid", color: "#94a3b8" },
      { key: "bbUpper", label: "BB Upper", color: "#f472b6" },
      { key: "bbLower", label: "BB Lower", color: "#f472b6" },
      { key: "ichiTenkan", label: "Ich Tenkan", color: "#ef4444" },
      { key: "ichiKijun", label: "Ich Kijun", color: "#2563eb" },
      { key: "ichiSpanA", label: "Ich Span A", color: "#22c55e" },
      { key: "ichiSpanB", label: "Ich Span B", color: "#f59e0b" },
      { key: "ichiChikou", label: "Ich Chikou", color: "#a855f7" },
      { key: "zigzag", label: "ZigZag", color: "#facc15" },
    ],
  },
  {
    label: "MACD",
    items: [
      { key: "macd", label: "MACD", color: "#22c55e" },
      { key: "macdSignal", label: "MACD Signal", color: "#ef4444" },
      { key: "macdHistogram", label: "MACD Hist", color: "#64748b" },
    ],
  },
];

function formatAnalysisTfMetric(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "N/A";
  if (normalized === "up") return "Up";
  if (normalized === "down") return "Down";
  if (normalized === "range") return "Range";
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatAnalysisLabel(value = "", fallback = "N/A") {
  const formatted = formatAnalysisTfMetric(value);
  return formatted === "N/A" ? fallback : formatted;
}

function compactPhaseLabel(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "NA";
  if (normalized === "continuation") return "Cont";
  if (normalized === "consolidation") return "Base";
  if (normalized === "pullback") return "PB";
  if (normalized === "reversal") return "Rev";
  if (normalized === "impulse") return "Imp";
  return formatAnalysisLabel(normalized, "NA");
}

function analysisAccentColor(entry = {}) {
  const bias = String(entry?.bias || "").trim().toLowerCase();
  const trend = String(entry?.trend || "").trim().toLowerCase();
  if (bias === "bullish" || trend === "up") return "#22c55e";
  if (bias === "bearish" || trend === "down") return "#ef4444";
  return "#94a3b8";
}

function analysisArrow(entry = {}) {
  const bias = String(entry?.bias || "").trim().toLowerCase();
  const trend = String(entry?.trend || "").trim().toLowerCase();
  if (bias === "bullish" || trend === "up") return "▲";
  if (bias === "bearish" || trend === "down") return "▼";
  return "•";
}

function trendGlyph(trend = "") {
  const normalized = String(trend || "").trim().toLowerCase();
  if (normalized === "up") return "↗";
  if (normalized === "down") return "↘";
  if (normalized === "range") return "↔";
  return "•";
}

function trendColor(trend = "") {
  const normalized = String(trend || "").trim().toLowerCase();
  if (normalized === "up") return "#38bdf8";
  if (normalized === "down") return "#f97316";
  return "#94a3b8";
}

function phaseColor(phase = "") {
  const normalized = String(phase || "").trim().toLowerCase();
  if (normalized === "continuation" || normalized === "impulse") return "#facc15";
  if (normalized === "pullback") return "#c084fc";
  if (normalized === "reversal") return "#fb7185";
  return "#94a3b8";
}

function RealtimeTfAnalysisOverlay({
  analysisByTf = {},
  orderedTfs = [],
  activeTf = "",
}) {
  const requestedRows = (Array.isArray(orderedTfs) ? orderedTfs : [])
    .map((tf) => String(tf || "").trim().toLowerCase())
    .filter(Boolean);
  const fallbackRows = sortTimeframes(Object.keys(analysisByTf || {}), "desc")
    .map((tf) => String(tf || "").trim().toLowerCase())
    .filter(Boolean);
  const rows = (requestedRows.length ? requestedRows : fallbackRows)
    .filter((tf) => analysisByTf?.[tf]);
  if (!rows.length) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 44,
        left: 8,
        zIndex: 11,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        minWidth: 124,
        padding: "6px 7px",
        borderRadius: 7,
        background: "rgba(15, 23, 42, 0.74)",
        border: "1px solid rgba(148, 163, 184, 0.26)",
        boxShadow: "0 10px 24px rgba(2, 6, 23, 0.24)",
        backdropFilter: "blur(10px)",
      }}
    >
      {rows.map((tf) => {
        const entry = analysisByTf[tf];
        const isActive = String(activeTf || "").trim().toLowerCase() === tf;
        const accent = analysisAccentColor(entry);
        return (
          <div
            key={tf}
            style={{
              display: "grid",
              gridTemplateColumns: "30px 12px 12px auto",
              alignItems: "center",
              gap: 5,
              fontSize: 10,
              lineHeight: 1.1,
              color: isActive ? "#f8fafc" : "rgba(226, 232, 240, 0.94)",
              fontWeight: isActive ? 700 : 600,
            }}
          >
            <span style={{ color: isActive ? "#f8fafc" : "#cbd5e1" }}>
              {displayTfLabel(tf)}
            </span>
            <span style={{ color: accent }}>{analysisArrow(entry)}</span>
            <span style={{ color: trendColor(entry?.trend) }}>
              {trendGlyph(entry?.trend)}
            </span>
            <span
              style={{
                minWidth: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: 4,
              }}
            >
              <span
                style={{
                  color: phaseColor(entry?.phase),
                  border: "1px solid rgba(148, 163, 184, 0.2)",
                  borderRadius: 999,
                  padding: "1px 5px",
                  letterSpacing: 0.15,
                }}
              >
                {compactPhaseLabel(entry?.phase)}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

const DEFAULT_INDICATOR_VISIBILITY = {
  candles: true,
  rsiPanel: false,
  macdPanel: true,
  rsi: true,
  rsiEma9: true,
  rsiWma45: true,
  stochK: false,
  stochD: false,
  sma20: true,
  sma50: true,
  sma200: true,
  vwap: false,
  bbMid: false,
  bbUpper: false,
  bbLower: false,
  ichiTenkan: false,
  ichiKijun: false,
  ichiSpanA: false,
  ichiSpanB: false,
  ichiChikou: false,
  zigzag: true,
  macd: false,
  macdSignal: false,
  macdHistogram: false,
};

function normalizeIndicatorVisibility(rawVisibility = {}) {
  const nextVisibility = { ...DEFAULT_INDICATOR_VISIBILITY };
  if (
    rawVisibility &&
    typeof rawVisibility === "object" &&
    !Array.isArray(rawVisibility)
  ) {
    for (const key of Object.keys(DEFAULT_INDICATOR_VISIBILITY)) {
      if (typeof rawVisibility[key] === "boolean") {
        nextVisibility[key] = rawVisibility[key];
      }
    }
  }
  const useZigzag = nextVisibility.zigzag !== false;
  nextVisibility.zigzag = useZigzag;
  nextVisibility.candles = true;
  return nextVisibility;
}

const DEFAULT_MASTER_CHART_CONFIG = {
  gridCols: 2,
  indicatorVisibility: { ...DEFAULT_INDICATOR_VISIBILITY },
  defaultVisibleBarsByTf: {
    d: 900,
    "4h": 900,
    "1h": 900,
    "15m": 900,
    "5m": 900,
  },
};

const BACKTEST_REPLAY_MAX_BARS = 400;
const MIN_REPLAY_BUFFER_SECONDS = 60 * 60;
const REPLAY_HISTORY_BUFFER_SECONDS = 24 * 60 * 60;
const ARTIFACT_AUTO_DEBOUNCE_MS = 350;

const MASTER_CHART_CONFIG_STORAGE_KEY = "market_chart_master_config";
const MASTER_CHART_SETTING_TYPE = "ui";
const MASTER_CHART_SETTING_NAME = "charts";
const TRADINGVIEW_CHART_URL = "https://www.tradingview.com/chart/N6SBLK6M/";
const MODE_HASH_BY_VALUE = {
  live: "#chart-live",
  cache: "#chart-analysis",
  replay: "#chart-replay",
  svg: "#chart-svg",
};
const MODE_VALUE_BY_HASH = Object.fromEntries(
  Object.entries(MODE_HASH_BY_VALUE).map(([modeValue, hashValue]) => [
    String(hashValue || "").toLowerCase(),
    modeValue,
  ]),
);
MODE_VALUE_BY_HASH["#chart"] = "live";
MODE_VALUE_BY_HASH["#chart-static"] = "cache";
MODE_VALUE_BY_HASH["#chart-replay"] = "replay";

function resolveModeFromHash(hashValue, availableModes = BASE_MODES, fallbackMode = "live") {
  const normalizedHash = String(hashValue || "").trim().toLowerCase();
  const requestedMode = MODE_VALUE_BY_HASH[normalizedHash] || "";
  const supportedModes = Array.isArray(availableModes) ? availableModes : BASE_MODES;
  if (requestedMode && supportedModes.includes(requestedMode)) return requestedMode;
  return supportedModes.includes(fallbackMode) ? fallbackMode : supportedModes[0] || "live";
}

function chartDataHasBars(chartData) {
  const barsByTf =
    chartData?.master?.bars && typeof chartData.master.bars === "object"
      ? chartData.master.bars
      : {};
  return Object.values(barsByTf).some(
    (bars) => Array.isArray(bars) && bars.length > 0,
  );
}

function timeframeToSeconds(tf) {
  const value = String(tf || "")
    .trim()
    .toLowerCase();
  if (!value) return null;
  if (value === "1" || value === "1m" || value === "1min" || value === "m1") return 60;
  if (value === "5" || value === "5m" || value === "5min" || value === "m5") return 5 * 60;
  if (value === "15" || value === "15m" || value === "15min" || value === "m15") return 15 * 60;
  if (value === "1h" || value === "60" || value === "h1") return 60 * 60;
  if (value === "4h" || value === "240" || value === "h4") return 4 * 60 * 60;
  if (value === "d" || value === "1d" || value === "day" || value === "1440") return 24 * 60 * 60;
  if (value === "w" || value === "1w" || value === "week") {
    return 7 * 24 * 60 * 60;
  }
  return null;
}

function expectedLatestClosedBarStartSec(tf, nowMs = Date.now()) {
  const tfSeconds = Number(timeframeToSeconds(tf)) || 0;
  if (!tfSeconds) return null;
  const nowSec = Math.floor(Number(nowMs || Date.now()) / 1000);
  if (!Number.isFinite(nowSec) || nowSec <= 0) return null;
  return Math.floor(Math.max(0, nowSec - 1) / tfSeconds) * tfSeconds;
}

function toHexColor(v) {
  if (!v) return "#60a5fa";
  const s = String(v).trim();
  if (s.startsWith("#")) {
    if (s.length === 4 || s.length === 7) return s;
    if (s.length === 9) return s.slice(0, 7);
    return "#60a5fa";
  }
  if (s.startsWith("rgb")) {
    const parts = s.match(/\d+/g);
    if (parts && parts.length >= 3) {
      const r = parseInt(parts[0]).toString(16).padStart(2, "0");
      const g = parseInt(parts[1]).toString(16).padStart(2, "0");
      const b = parseInt(parts[2]).toString(16).padStart(2, "0");
      return `#${r}${g}${b}`;
    }
  }
  return "#60a5fa";
}

function normSym(s) {
  return String(s || "")
    .toUpperCase()
    .replace("/", "")
    .replace(".", "");
}

function marketUiConfigLocalKey(symbol) {
  return `market_chart_ui_config:${normSym(symbol)}`;
}

function readLocalMarketUiConfig(symbol) {
  try {
    const raw = localStorage.getItem(marketUiConfigLocalKey(symbol));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalMarketUiConfig(symbol, config) {
  try {
    localStorage.setItem(
      marketUiConfigLocalKey(symbol),
      JSON.stringify(config || {}),
    );
  } catch {
    // ignore storage quota/private mode
  }
}

function normalizeMasterChartConfig(rawConfig = {}) {
  const raw =
    rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? rawConfig
      : {};
  const gridCols = Number(raw.gridCols);
  const rawIndicatorVisibility =
    raw.indicatorVisibility &&
    typeof raw.indicatorVisibility === "object" &&
    !Array.isArray(raw.indicatorVisibility)
      ? raw.indicatorVisibility
      : {};
  const rawDefaultVisibleBarsByTf =
    raw.defaultVisibleBarsByTf &&
    typeof raw.defaultVisibleBarsByTf === "object" &&
    !Array.isArray(raw.defaultVisibleBarsByTf)
      ? raw.defaultVisibleBarsByTf
      : {};

  const indicatorVisibility = normalizeIndicatorVisibility(rawIndicatorVisibility);

  const defaultVisibleBarsByTf = {
    ...DEFAULT_MASTER_CHART_CONFIG.defaultVisibleBarsByTf,
  };
  for (const [tfRaw, valueRaw] of Object.entries(rawDefaultVisibleBarsByTf)) {
    const tf = String(tfRaw || "").trim().toLowerCase();
    const value = Number(valueRaw);
    if (!tf || !Number.isFinite(value) || value <= 0) continue;
    defaultVisibleBarsByTf[tf] = Math.max(2, Math.round(value));
  }

  return {
    gridCols: Number.isFinite(gridCols)
      ? Math.max(1, Math.min(6, Math.round(gridCols)))
      : DEFAULT_MASTER_CHART_CONFIG.gridCols,
    indicatorVisibility,
    defaultVisibleBarsByTf,
  };
}

function readLocalMasterChartConfig() {
  try {
    const raw = localStorage.getItem(MASTER_CHART_CONFIG_STORAGE_KEY);
    return normalizeMasterChartConfig(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeMasterChartConfig({});
  }
}

function writeLocalMasterChartConfig(config) {
  const normalized = normalizeMasterChartConfig(config);
  try {
    localStorage.setItem(
      MASTER_CHART_CONFIG_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  } catch {
    // ignore storage failures
  }
  return normalized;
}

function visibleBarsDefaultForTf(masterChartConfig, tf) {
  const tfKey = String(tf || "").trim().toLowerCase();
  const defaults =
    masterChartConfig?.defaultVisibleBarsByTf &&
    typeof masterChartConfig.defaultVisibleBarsByTf === "object"
      ? masterChartConfig.defaultVisibleBarsByTf
      : DEFAULT_MASTER_CHART_CONFIG.defaultVisibleBarsByTf;
  const mapped =
    defaults[tfKey] ??
    defaults[tfKey.replace("1d", "d")] ??
    defaults[tfKey.replace("day", "d")] ??
    defaults[tfKey.replace("240", "4h")] ??
    defaults[tfKey.replace("60", "1h")] ??
    defaults[tfKey.replace("15", "15m")] ??
    defaults[tfKey.replace("5", "5m")];
  const normalized = Number(mapped);
  return Number.isFinite(normalized) && normalized > 0
    ? Math.max(2, Math.round(normalized))
    : HISTORY_BARS_ACTION_COUNT;
}

function normalizeStoredVisibleBars(masterChartConfig, tf, value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  const rounded = Math.max(2, Math.round(normalized));
  return rounded;
}

function clampTradeVisibleBars(value, tf) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return HISTORY_BARS_ACTION_COUNT;
  const tfKey = String(tf || "").trim().toLowerCase();
  const tradeCap =
    tfKey === "d" || tfKey === "1d"
      ? 80
      : tfKey === "4h" || tfKey === "240"
        ? 200
        : HISTORY_BARS_ACTION_COUNT;
  return Math.max(40, Math.min(Math.round(normalized), tradeCap));
}

function savedBarsCountForSymbol(symbol, fallback) {
  return fallback;
}

function savedGridColsForSymbol(symbol, fallback) {
  const saved = readLocalMarketUiConfig(symbol);
  const gridCols = Number(saved?.gridCols);
  if (Number.isFinite(gridCols) && gridCols > 0) {
    return Math.max(1, Math.min(6, Math.round(gridCols)));
  }
  return fallback;
}

function sanitizeViewportPayload(payload = {}) {
  if (!payload || typeof payload !== "object" || !payload.chartId) return null;
  const timeStartMs = Number(payload.timeStartMs);
  const timeEndMs = Number(payload.timeEndMs);
  const visibleBars = Number(payload.visibleBars);
  const priceTop = Number(payload.priceTop);
  const priceBottom = Number(payload.priceBottom);
  return {
    chartId: String(payload.chartId),
    interval: String(payload.interval || ""),
    width: Number.isFinite(Number(payload.width)) ? Number(payload.width) : null,
    height: Number.isFinite(Number(payload.height))
      ? Number(payload.height)
      : null,
    timeStartMs: Number.isFinite(timeStartMs) ? timeStartMs : null,
    timeEndMs: Number.isFinite(timeEndMs) ? timeEndMs : null,
    visibleBars: Number.isFinite(visibleBars) ? visibleBars : null,
    priceTop: Number.isFinite(priceTop) ? priceTop : null,
    priceBottom: Number.isFinite(priceBottom) ? priceBottom : null,
  };
}

function liveTfToTvInterval(tf) {
  const raw = String(tf || "").trim().toLowerCase();
  if (raw === "1" || raw === "1m") return "1";
  if (raw === "5" || raw === "5m") return "5";
  if (raw === "15" || raw === "15m") return "15";
  if (raw === "60" || raw === "1h") return "60";
  if (raw === "240" || raw === "4h") return "240";
  if (raw === "d" || raw === "1d" || raw === "day") return "D";
  if (raw === "w" || raw === "1w" || raw === "week") return "W";
  return "15";
}

function displayTfLabel(tf) {
  const raw = String(tf || "").trim().toLowerCase();
  if (raw === "1" || raw === "1m") return "1m";
  if (raw === "5" || raw === "5m") return "5m";
  if (raw === "15" || raw === "15m") return "15m";
  if (raw === "60" || raw === "1h") return "1h";
  if (raw === "240" || raw === "4h") return "4h";
  if (raw === "d" || raw === "1d") return "1d";
  if (raw === "w" || raw === "1w") return "1w";
  return String(tf || "");
}

function timeframeLookupKeys(tf) {
  const raw = String(tf || "").trim().toLowerCase();
  if (!raw) return [];
  const keys = [raw];
  if (raw === "1" || raw === "1m") keys.push("1", "1m");
  else if (raw === "5" || raw === "5m") keys.push("5", "5m");
  else if (raw === "15" || raw === "15m") keys.push("15", "15m");
  else if (raw === "60" || raw === "1h") keys.push("60", "1h");
  else if (raw === "240" || raw === "4h") keys.push("240", "4h");
  else if (raw === "d" || raw === "1d" || raw === "day") keys.push("d", "1d", "day");
  return [...new Set(keys)];
}

function getTimeframeValue(records, tf) {
  const source = records && typeof records === "object" ? records : null;
  if (!source) return undefined;
  for (const key of timeframeLookupKeys(tf)) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return source[key];
    }
  }
  return undefined;
}

function toTradingViewSymbol(symRaw, provider = "") {
  const s = String(symRaw || "")
    .trim()
    .toUpperCase();
  if (!s) return "";
  if (s.includes(":")) return s;
  const p = String(provider || "")
    .trim()
    .toUpperCase();
  return p ? `${p}:${s}` : s;
}

function toTradingViewTimezone() {
  const mode = localStorage.getItem("ui_display_timezone") || "UTC";
  if (mode === "UTC") return "Etc/UTC";
  if (mode === "Local")
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  return mode;
}

function timeAgo(ts) {
  if (!ts) return "";
  return formatRelativeDateTime(ts);
}

function formatHeaderTimeCompact(ts) {
  const ms = Number(ts);
  if (!Number.isFinite(ms) || ms <= 0) return "--";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatHeaderTimeExact(ts) {
  const ms = Number(ts);
  if (!Number.isFinite(ms) || ms <= 0) return "--";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "--";
  const timezone = getEffectiveDisplayTimezone();
  try {
    return date
      .toLocaleString("en-GB", {
        timeZone: timezone === "Local" ? undefined : timezone,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
      .replace(",", "");
  } catch {
    return formatHeaderTimeCompact(ms);
  }
}

function buildHeaderRangeLabel(startMs, endMs, barsCount, prefix) {
  const safeBars = Number(barsCount);
  const hasBars = Number.isFinite(safeBars) && safeBars > 0;
  const hasStart = Number.isFinite(Number(startMs)) && Number(startMs) > 0;
  const hasEnd = Number.isFinite(Number(endMs)) && Number(endMs) > 0;
  if (!hasBars && !hasStart && !hasEnd) return "";
  return [
    String(prefix || "").trim().toUpperCase() || null,
    `${formatHeaderTimeCompact(startMs)} -> ${formatHeaderTimeCompact(endMs)}`,
    hasBars ? `${safeBars}b` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function headerInfoButtonStyle(overrides = {}) {
  const {
    color = "var(--muted)",
    background = "rgba(0,0,0,0.2)",
    borderColor = "rgba(148,163,184,0.25)",
  } = overrides || {};
  return {
    fontSize: 9,
    color,
    background,
    borderColor,
    padding: "0 4px",
    borderRadius: 3,
    minHeight: 16,
    lineHeight: 1.2,
    fontWeight: 600,
    cursor: "default",
  };
}

function ViewportNavIcon({ action }) {
  const commonProps = {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": "true",
  };
  if (action === "show_all_loaded") {
    return (
      <svg {...commonProps}>
        <path d="M4 1.5H1.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 1.5H10.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 10.5H1.5V8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 10.5H10.5V8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (action === "show_compact") {
    return (
      <svg {...commonProps}>
        <path d="M5 3.5H1.5V1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 3.5H10.5V1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 8.5H1.5V10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 8.5H10.5V10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <rect x="1.75" y="2" width="8.5" height="8" rx="1.25" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.25 2V10" stroke="currentColor" strokeWidth="1" opacity="0.75" />
      <path d="M7.75 2V10" stroke="currentColor" strokeWidth="1" opacity="0.75" />
    </svg>
  );
}

function formatArtifactTimeDetail(value) {
  const sec = Number(value);
  if (!Number.isFinite(sec) || sec <= 0) return "--";
  const date = new Date(sec * 1000);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatArtifactPriceDetail(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return "";
  return formatNumValue(num);
}

function artifactPanelDetailLines(item = {}) {
  const payload = item?.artifact_payload && typeof item.artifact_payload === "object"
    ? item.artifact_payload
    : item || {};
  const startTime =
    Number(payload?.bar_start ?? payload?.anchor_time ?? item?.time) || null;
  const endTime =
    Number(payload?.bar_end ?? payload?.anchor_time ?? item?.time) || null;
  const topPrice = Number(
    payload?.price_high ?? item?.price_top ?? payload?.price ?? item?.price,
  );
  const lowPrice = Number(
    payload?.price_low ?? item?.price_bottom ?? payload?.price ?? item?.price,
  );
  const timeParts = [
    Number.isFinite(startTime) && startTime > 0 ? formatArtifactTimeDetail(startTime) : "",
    Number.isFinite(endTime) && endTime > 0 && endTime !== startTime
      ? formatArtifactTimeDetail(endTime)
      : "",
  ].filter(Boolean);
  const priceHighText = formatArtifactPriceDetail(topPrice);
  const priceLowText = formatArtifactPriceDetail(lowPrice);
  const priceParts = [priceHighText, priceLowText]
    .filter(Boolean)
    .filter((value, index, arr) => value && (index === 0 || value !== arr[0]));
  return [timeParts.join(" -> "), priceParts.join(" - ")].filter(Boolean).slice(0, 2);
}

function normalizeHeaderSourceLabel(rawSource = "", context = {}) {
  const source = String(rawSource || "").trim().toLowerCase();
  const cacheSource = String(context?.cache_source || "").trim().toLowerCase();
  const provider = String(context?.provider || "").trim().toLowerCase();
  if (source === "broker" || cacheSource.startsWith("broker")) return "local";
  if (source === "twelvedata" || source === "twelve" || provider === "twelvedata") {
    return "twelve";
  }
  if (source === "binance" || provider === "binance") return "binance";
  return source || "local";
}

function normalizeHeaderFileType(rawFileType = "", context = {}) {
  const fileType = String(rawFileType || "").trim().toLowerCase();
  const cacheSource = String(context?.cache_source || "").trim().toLowerCase();
  if (fileType === "json" || fileType === "parquet" || fileType === "csv") {
    return fileType;
  }
  if (cacheSource.includes("parquet")) return "parquet";
  if (cacheSource.includes("csv")) return "csv";
  if (fileType === "sqlite" || fileType === "postgres" || fileType === "postgresql") {
    return "db";
  }
  if (fileType === "db") return "db";
  if (cacheSource === "db") return "db";
  return fileType || "n/a";
}

function toEpochMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n > 1e12) return n;
  if (n > 1e9) return Math.round(n * 1000);
  return null;
}

function toEpochSec(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) return Math.round(value / 1000);
    if (value > 1e9) return Math.round(value);
    return null;
  }
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed / 1000);
}

function toPositivePrice(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function toNullableNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function findBarIndexAtOrAfter(bars = [], targetSec = null) {
  const target = Number(targetSec);
  if (!Array.isArray(bars) || !bars.length || !Number.isFinite(target)) return -1;
  for (let index = 0; index < bars.length; index += 1) {
    const barTime = Number(bars[index]?.time);
    if (Number.isFinite(barTime) && barTime >= target) return index;
  }
  return bars.length - 1;
}

function findBarIndexAtOrBefore(bars = [], targetSec = null) {
  const target = Number(targetSec);
  if (!Array.isArray(bars) || !bars.length || !Number.isFinite(target)) return -1;
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const barTime = Number(bars[index]?.time);
    if (Number.isFinite(barTime) && barTime <= target) return index;
  }
  return 0;
}

function inferBarSpacingSec(bars = []) {
  if (!Array.isArray(bars) || bars.length < 2) return 60;
  const deltas = [];
  for (let index = 1; index < bars.length; index += 1) {
    const prev = Number(bars[index - 1]?.time);
    const next = Number(bars[index]?.time);
    const delta = next - prev;
    if (Number.isFinite(delta) && delta > 0) deltas.push(delta);
  }
  if (!deltas.length) return 60;
  deltas.sort((left, right) => left - right);
  return Math.max(1, deltas[Math.floor(deltas.length / 2)] || 60);
}

export function resolveTradeFocusedBars(
  bars = [],
  {
    createdAt = null,
    openedAt = null,
    closedAt = null,
    createdAtSec = null,
    openedAtSec = null,
    closedAtSec = null,
    requestedBars = HISTORY_BARS_ACTION_COUNT,
  } = {},
) {
  if (!Array.isArray(bars) || !bars.length) return [];
  const normalizedRequested = Math.max(
    80,
    Math.round(Number(requestedBars) || HISTORY_BARS_ACTION_COUNT),
  );
  const barSpacingSec = inferBarSpacingSec(bars);
  const bufferBars = Math.max(
    6,
    Math.min(80, Math.round(normalizedRequested * 0.12) || 24),
  );
  const bufferSec = Math.max(barSpacingSec * bufferBars, barSpacingSec * 6);
  const createdSec =
    (Number.isFinite(Number(createdAtSec)) && Number(createdAtSec) > 0
      ? Number(createdAtSec)
      : null) ??
    toEpochSec(createdAt);
  const openedSec =
    (Number.isFinite(Number(openedAtSec)) && Number(openedAtSec) > 0
      ? Number(openedAtSec)
      : null) ??
    toEpochSec(openedAt);
  const focusStartSec =
    (Number.isFinite(openedSec) && openedSec > 0 ? openedSec : null) ??
    (Number.isFinite(createdSec) && createdSec > 0 ? createdSec : null);
  if (!Number.isFinite(focusStartSec)) {
    return bars.slice(-Math.min(normalizedRequested, bars.length));
  }
  const explicitCloseSec =
    (Number.isFinite(Number(closedAtSec)) && Number(closedAtSec) > 0
      ? Number(closedAtSec)
      : null) ??
    toEpochSec(closedAt);
  const latestBarSec = Number(bars[bars.length - 1]?.time);
  const fallbackNowSec = Number.isFinite(latestBarSec) && latestBarSec > 0
    ? latestBarSec
    : Math.floor(Date.now() / 1000);
  const startAnchorSec = Math.max(0, focusStartSec - bufferSec);
  const endBaseSec =
    explicitCloseSec != null
      ? explicitCloseSec
      : fallbackNowSec;
  const endAnchorSec = endBaseSec + bufferSec;
  const windowRange = resolveTradeFocusedWindow(bars, normalizedRequested, {
    firstAnchorTimeSec: startAnchorSec,
    lastAnchorTimeSec: endAnchorSec,
    preferLatestWindow: explicitCloseSec == null,
  });
  if (!windowRange) {
    return bars.slice(-Math.min(normalizedRequested, bars.length));
  }
  return bars.slice(windowRange.from, windowRange.to + 1);
}

function resolveReplayTradeCreatedSec(trade = {}) {
  return (
    (Number.isFinite(Number(trade?.createdAtSec)) && Number(trade.createdAtSec) > 0
      ? Number(trade.createdAtSec)
      : null) ??
    toEpochSec(trade?.createdAt) ??
    toEpochSec(trade?.signal_bar_time) ??
    toEpochSec(trade?.signalBarTime) ??
    (Number.isFinite(Number(trade?.openedAtSec)) && Number(trade.openedAtSec) > 0
      ? Number(trade.openedAtSec)
      : null) ??
    toEpochSec(trade?.openedAt) ??
    null
  );
}

function resolveReplayTradeOpenSec(trade = {}) {
  return (
    (Number.isFinite(Number(trade?.openedAtSec)) && Number(trade.openedAtSec) > 0
      ? Number(trade.openedAtSec)
      : null) ??
    toEpochSec(trade?.openedAt) ??
    resolveReplayTradeCreatedSec(trade)
  );
}

function resolveReplayTradeCloseSec(trade = {}) {
  return (
    (Number.isFinite(Number(trade?.closedAtSec)) && Number(trade.closedAtSec) > 0
      ? Number(trade.closedAtSec)
      : null) ??
    toEpochSec(trade?.closedAt) ??
    resolveReplayTradeOpenSec(trade)
  );
}

function resolveReplayTradeStatus(trade = {}) {
  return String(
    trade?.closeStatus ??
      trade?.execution_status ??
      trade?.status ??
      trade?.result ??
      "",
  )
    .trim()
    .toUpperCase();
}

function replayBufferSecondsForTf(tf) {
  return Math.max(MIN_REPLAY_BUFFER_SECONDS, REPLAY_HISTORY_BUFFER_SECONDS);
}

function replayRevealDelaySecondsForTf(tf) {
  const tfSeconds = Number(timeframeToSeconds(tf));
  if (!Number.isFinite(tfSeconds) || tfSeconds <= 60) return 0;
  if (tfSeconds <= 5 * 60) return 1;
  if (tfSeconds <= 15 * 60) return 2;
  if (tfSeconds <= 60 * 60) return 3;
  if (tfSeconds <= 4 * 60 * 60) return 4;
  return 5;
}

function buildReplayPartialBar(
  targetBar = null,
  baseBars = [],
  tf = "",
  replayClockTimeSec = null,
  replayStartTimeSec = null,
) {
  const barStartSec = Number(targetBar?.time);
  const tfSeconds = Math.max(1, Number(timeframeToSeconds(tf)) || 1);
  const replayTime = Number(replayClockTimeSec);
  const replayStart = Number(replayStartTimeSec);
  if (
    !targetBar ||
    !Number.isFinite(barStartSec) ||
    !Number.isFinite(replayTime) ||
    replayTime < barStartSec
  ) {
    return null;
  }
  const barEndSec = barStartSec + tfSeconds - 1;
  if (replayTime >= barEndSec) return null;

  const progressedBaseBars = (Array.isArray(baseBars) ? baseBars : []).filter((bar) => {
    const time = Number(bar?.time);
    return Number.isFinite(time) && time >= barStartSec && time <= replayTime;
  });

  const open = Number(targetBar?.open);
  const fallbackOpen = Number(progressedBaseBars[0]?.open);
  const nextOpen = Number.isFinite(open) ? open : fallbackOpen;
  if (!Number.isFinite(nextOpen)) return null;

  if (!progressedBaseBars.length) {
    const barEndSec = barStartSec + tfSeconds - 1;
    const startedInsideWindow =
      Number.isFinite(replayStart) &&
      replayStart >= barStartSec &&
      replayStart <= barEndSec;
    if (!startedInsideWindow) return null;
    return {
      ...targetBar,
      time: barStartSec,
      open: nextOpen,
      high: nextOpen,
      low: nextOpen,
      close: nextOpen,
      volume: 0,
    };
  }

  const highs = progressedBaseBars
    .map((bar) => Number(bar?.high))
    .filter((value) => Number.isFinite(value));
  const lows = progressedBaseBars
    .map((bar) => Number(bar?.low))
    .filter((value) => Number.isFinite(value));
  const closes = progressedBaseBars
    .map((bar) => Number(bar?.close))
    .filter((value) => Number.isFinite(value));
  const volumes = progressedBaseBars
    .map((bar) => Number(bar?.volume ?? 0))
    .filter((value) => Number.isFinite(value));

  const nextClose = closes.length ? closes[closes.length - 1] : nextOpen;
  const nextHigh = Math.max(nextOpen, nextClose, ...(highs.length ? highs : [nextOpen]));
  const nextLow = Math.min(nextOpen, nextClose, ...(lows.length ? lows : [nextOpen]));

  return {
    ...targetBar,
    time: barStartSec,
    open: nextOpen,
    high: nextHigh,
    low: nextLow,
    close: nextClose,
    volume: volumes.reduce((sum, value) => sum + value, 0),
  };
}

function buildReplayBarsForTf({
  bars = [],
  baseBars = [],
  tf = "",
  replayClockTimeSec = null,
  replayStartTimeSec = null,
  maxBars = BACKTEST_REPLAY_MAX_BARS,
}) {
  if (!Array.isArray(bars) || !bars.length || !Number.isFinite(Number(replayClockTimeSec))) {
    return [];
  }
  const tfSeconds = Math.max(1, Number(timeframeToSeconds(tf)) || 1);
  const anchorAtOrBefore = findBarIndexAtOrBefore(bars, replayStartTimeSec);
  const replayAnchorIndex = Math.max(
    0,
    anchorAtOrBefore >= 0
      ? anchorAtOrBefore
      : findBarIndexAtOrAfter(bars, replayStartTimeSec),
  );
  let completedEndIndex = replayAnchorIndex - 1;
  for (let index = replayAnchorIndex; index < bars.length; index += 1) {
    const barStartSec = Number(bars[index]?.time);
    if (!Number.isFinite(barStartSec) || barStartSec <= 0) continue;
    const barEndSec = barStartSec + tfSeconds - 1;
    if (barEndSec <= replayClockTimeSec) {
      completedEndIndex = index;
      continue;
    }
    break;
  }

  const nextFormingIndex = Math.max(replayAnchorIndex, completedEndIndex + 1);
  const partialBar =
    nextFormingIndex < bars.length
      ? buildReplayPartialBar(
          bars[nextFormingIndex],
          baseBars,
          tf,
          replayClockTimeSec,
          replayStartTimeSec,
        )
      : null;

  const completedBars =
    completedEndIndex >= replayAnchorIndex
      ? bars.slice(replayAnchorIndex, completedEndIndex + 1)
      : [];
  const combinedBars = partialBar ? [...completedBars, partialBar] : completedBars;
  if (!combinedBars.length) return [];
  const visibleCount = Math.max(
    20,
    Math.min(maxBars, combinedBars.length),
  );
  return combinedBars.slice(-visibleCount);
}

function resolveReplayWindowEndSec(trade = {}, fallbackNowSec = null) {
  const status = resolveReplayTradeStatus(trade);
  if (["PENDING", "FILLED"].includes(status)) {
    const nowSec = Number(fallbackNowSec);
    return Number.isFinite(nowSec) && nowSec > 0 ? nowSec : null;
  }
  if (["CLOSED", "REJECTED", "CANCEL", "CANCELLED"].includes(status)) {
    return resolveReplayTradeCloseSec(trade);
  }
  const closeSec = resolveReplayTradeCloseSec(trade);
  if (closeSec != null) return closeSec;
  const nowSec = Number(fallbackNowSec);
  return Number.isFinite(nowSec) && nowSec > 0 ? nowSec : null;
}

function compareReplayTradeOrder(left, right) {
  const leftCreated = resolveReplayTradeCreatedSec(left);
  const rightCreated = resolveReplayTradeCreatedSec(right);
  if (leftCreated !== rightCreated) return Number(leftCreated || 0) - Number(rightCreated || 0);
  const leftOpened = resolveReplayTradeOpenSec(left);
  const rightOpened = resolveReplayTradeOpenSec(right);
  if (leftOpened !== rightOpened) return Number(leftOpened || 0) - Number(rightOpened || 0);
  return String(left?.sid || "").localeCompare(String(right?.sid || ""));
}

function tradeWindowBufferBarsForTf(tf) {
  const tfSeconds = Math.max(1, Number(timeframeToSeconds(tf)) || 60);
  if (tfSeconds >= 24 * 60 * 60) return 2;
  if (tfSeconds >= 4 * 60 * 60) return 6;
  if (tfSeconds >= 60 * 60) return 10;
  if (tfSeconds >= 15 * 60) return 16;
  if (tfSeconds >= 5 * 60) return 24;
  return 40;
}

function resolveTradeRunStartSec(trades = []) {
  let earliestSec = null;
  for (const trade of Array.isArray(trades) ? trades : []) {
    const startSec =
      resolveReplayTradeOpenSec(trade) ?? resolveReplayTradeCreatedSec(trade);
    if (!Number.isFinite(Number(startSec)) || Number(startSec) <= 0) continue;
    if (earliestSec == null || Number(startSec) < earliestSec) {
      earliestSec = Number(startSec);
    }
  }
  return earliestSec;
}

function resolveTradeRunEndSec(trades = [], fallbackNowSec = null) {
  let latestSec = null;
  for (const trade of Array.isArray(trades) ? trades : []) {
    const endSec = resolveReplayWindowEndSec(trade, fallbackNowSec);
    if (!Number.isFinite(Number(endSec)) || Number(endSec) <= 0) continue;
    if (latestSec == null || Number(endSec) > latestSec) {
      latestSec = Number(endSec);
    }
  }
  return latestSec;
}

function barsRange(bars) {
  const arr = Array.isArray(bars) ? bars : [];
  if (!arr.length) return null;
  let minP = Infinity;
  let maxP = -Infinity;
  const times = [];
  for (const b of arr) {
    const t = toEpochMs(b?.time);
    if (t != null) times.push(t);
    const lo = Number(b?.low);
    const hi = Number(b?.high);
    if (Number.isFinite(lo)) minP = Math.min(minP, lo);
    if (Number.isFinite(hi)) maxP = Math.max(maxP, hi);
  }
  if (!times.length || !Number.isFinite(minP) || !Number.isFinite(maxP))
    return null;
  times.sort((a, b) => a - b);
  return {
    t0: times[0],
    t1: times[times.length - 1],
    pMin: minP,
    pMax: maxP,
  };
}

function ratioFromAnchorTime(anchorTimeMs, range) {
  if (!range || !Number.isFinite(anchorTimeMs)) return null;
  const span = Math.max(1, range.t1 - range.t0);
  return clamp01((anchorTimeMs - range.t0) / span);
}

function ratioFromAnchorPrice(anchorPrice, range) {
  if (!range || !Number.isFinite(anchorPrice)) return null;
  const span = Math.max(1e-9, range.pMax - range.pMin);
  return clamp01((range.pMax - anchorPrice) / span);
}
function ratioFromAnchorPriceUnclamped(anchorPrice, range) {
  if (!range || !Number.isFinite(anchorPrice)) return null;
  const span = Math.max(1e-9, range.pMax - range.pMin);
  return (range.pMax - anchorPrice) / span;
}

function anchorTimeFromRatio(r, range) {
  if (!range) return null;
  const rr = clamp01(r);
  return Math.round(range.t0 + rr * Math.max(1, range.t1 - range.t0));
}

function anchorPriceFromRatio(r, range) {
  if (!range) return null;
  const rr = clamp01(r);
  return range.pMax - rr * Math.max(1e-9, range.pMax - range.pMin);
}
function tfRankForLatest(tf) {
  const t = String(tf || "").toLowerCase();
  if (t === "5" || t === "5m") return 5;
  if (t === "15" || t === "15m") return 15;
  if (t === "60" || t === "1h") return 60;
  if (t === "240" || t === "4h") return 240;
  if (t === "1440" || t === "1d" || t === "d") return 1440;
  if (t === "1m") return 1;
  if (t === "w") return 10080;
  return Number.MAX_SAFE_INTEGER;
}

function artifactSourceTfLabel(tf = "") {
  const t = String(tf || "").trim().toLowerCase();
  if (t === "1440" || t === "1d" || t === "d" || t === "day" || t === "1day" || t === "daily") {
    return "1d";
  }
  if (t === "240" || t === "4h" || t === "4hour" || t === "4hours") return "4h";
  if (t === "60" || t === "1h" || t === "1hour" || t === "hourly") return "1h";
  if (t === "15" || t === "15m") return "15m";
  if (t === "5" || t === "5m") return "5m";
  if (t === "1" || t === "1m") return "1m";
  return t;
}

function artifactSourceTfTag(tf = "") {
  const label = artifactSourceTfLabel(tf);
  return label ? label.toUpperCase() : "";
}

function artifactTypeAbbr(typeRaw = "") {
  const type = String(typeRaw || "").trim().toLowerCase();
  if (!type) return "";
  if (type === "ifvg" || type === "i_fvg" || type === "inverse_fvg" || type === "inversion_fvg") {
    return "iFVG";
  }
  if (
    type === "bb" ||
    type === "breaker" ||
    type === "breaker_block" ||
    type === "breakerblock"
  ) {
    return "BB";
  }
  if (type === "swing_low") return "SL";
  if (type === "swing_high") return "SH";
  if (type === "liquidity_low") return "LL";
  if (type === "liquidity_high") return "LH";
  if (type === "support") return "SUP";
  if (type === "demand") return "DEM";
  if (type === "pdh") return "PDH";
  if (type === "pdl") return "PDL";
  if (type === "fvg") return "FVG";
  if (type === "ob") return "OB";
  if (type === "bos") return "BOS";
  if (type === "choch") return "CHOCH";
  if (type === "sweep_high" || type === "sweep_low") return "SWEEP";
  if (type === "key_level") return "KL";
  if (type === "strategy") return "STR";
  return type.replaceAll("_", " ");
}

function artifactDisplayTypeKey(item = {}) {
  const type = String(item?.type || item?.artifact_type || "")
    .trim()
    .toLowerCase();
  const subtype = String(item?.subtype || item?.artifact_payload?.subtype || "")
    .trim()
    .toLowerCase();
  const label = String(item?.label || item?.artifact_payload?.label || "")
    .trim()
    .toLowerCase();
  const patternType = String(
    item?.payload?.pattern_type ||
      item?.artifact_payload?.payload?.pattern_type ||
      "",
  )
    .trim()
    .toLowerCase();
  const text = [type, subtype, label, patternType].filter(Boolean).join(" ");

  if (
    /\bifvg\b/.test(text) ||
    /\bi_fvg\b/.test(text) ||
    /inverse\s*fvg/.test(text) ||
    /inversion\s*fvg/.test(text)
  ) {
    return "ifvg";
  }
  if (
    /\bbb\b/.test(text) ||
    /\bbreaker\b/.test(text) ||
    /\bbreaker block\b/.test(text) ||
    /\bbreaker_block\b/.test(text)
  ) {
    return "bb";
  }
  return type;
}

function artifactInlineLabel(item = {}, fallbackTf = "") {
  const structureLabel = String(
    item?.payload?.structure_label ||
      item?.artifact_payload?.payload?.structure_label ||
      "",
  )
    .trim()
    .toUpperCase();
  const typeRaw = String(item?.type || item?.artifact_type || "")
    .trim()
    .toLowerCase();
  if (
    structureLabel &&
    (typeRaw === "swing_high" || typeRaw === "swing_low")
  ) {
    return structureLabel;
  }
  const type = artifactTypeAbbr(artifactDisplayTypeKey(item));
  return type;
}

function artifactLevelLabel(item = {}, fallbackTf = "") {
  return artifactInlineLabel(item, fallbackTf);
}

function artifactMarkerText(item = {}) {
  const type = artifactDisplayTypeKey(item);
  if (type === "bos") return "BOS";
  if (type === "choch") return "CH";
  if (type === "sweep_high" || type === "sweep_low") return "SW";
  return artifactTypeAbbr(type).slice(0, 4).toUpperCase();
}

function strategyHitMarkerText(hit = {}) {
  const latestArtifactPayload =
    hit?.latestArtifact?.payload && typeof hit.latestArtifact.payload === "object"
      ? hit.latestArtifact.payload
      : {};
  const sourceType = String(latestArtifactPayload.source_artifact_type || "")
    .trim()
    .toLowerCase();
  if (sourceType) {
    const shortType = artifactTypeAbbr(sourceType).slice(0, 4).toUpperCase();
    if (shortType) return shortType;
  }
  const explicitLabel = (Array.isArray(hit?.actions) ? hit.actions : [])
    .map((action) => String(action?.label || "").trim())
    .find(Boolean);
  if (explicitLabel) return explicitLabel;
  const eventName = String(hit?.eventName || hit?.event_name || "")
    .trim()
    .toLowerCase();
  if (eventName.includes("choch")) return "CH";
  if (eventName.includes("bos")) return "BOS";
  if (eventName.includes("sweep")) return "SW";
  return (
    String(hit?.eventName || hit?.event_name || "").trim() ||
    artifactTypeAbbr(eventName || "strategy").slice(0, 4).toUpperCase()
  );
}

function strategyHitToChartObject(hit = {}, fallbackTf = "") {
  const timeSec = Number(hit?.barTimeUnix ?? hit?.bar_time_unix ?? 0);
  if (!Number.isFinite(timeSec) || timeSec <= 0) return null;
  const sourceTf = String(hit?.sourceTf || hit?.source_tf || hit?.tf || fallbackTf || "").trim();
  const sourceTfColor = artifactTimeframeColor(sourceTf);
  const price = Number(
    hit?.latestArtifact?.price ??
      hit?.latestArtifact?.payload?.level ??
      hit?.barClose ??
      hit?.bar_close ??
      hit?.barHigh ??
      hit?.bar_high ??
      hit?.barLow ??
      hit?.bar_low ??
      null,
  );
  return {
    id: String(
      hit?.matchKey ||
        hit?.match_key ||
        `strategy-${String(hit?.strategyId || "strategy")}-${String(hit?.eventId || "event")}-${timeSec}`,
    ),
    kind: "point",
    type: "STRATEGY",
    label:
      String(hit?.eventName || hit?.event_name || hit?.strategyName || "Strategy").trim() ||
      "Strategy",
    visible: true,
    tf: String(hit?.tf || fallbackTf || "").trim(),
    color: String(sourceTfColor || hit?.markerColor || "#38bdf8"),
    text_color: String(
      hit?.markerTextColor || sourceTfColor,
    ),
    price: Number.isFinite(price) ? price : null,
    time: timeSec,
    anchorTimeMs: timeSec * 1000,
    anchorPrice: Number.isFinite(price) ? price : null,
    line_style: "dot",
    line_width: 0.1,
    marker_shape: String(hit?.markerShape || "circle"),
    marker_text: strategyHitMarkerText(hit),
    marker_position: String(hit?.markerPosition || "belowBar"),
    artifact_family: "strategy",
    artifact_type: String(hit?.eventId || hit?.event_id || "strategy").trim().toLowerCase(),
    artifact_group: "strategy",
    source_tf: sourceTf,
    artifact_payload: hit,
  };
}

function collectStrategyHitLevelReferences(hit = {}) {
  const levels = [];
  const pushLevel = (value, source = "", sourceTime = 0, sourceType = "") => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) return;
    levels.push({
      price: nextValue,
      source: String(source || "").trim().toLowerCase(),
      sourceTime: Number(sourceTime) || 0,
      sourceType: String(sourceType || "").trim().toLowerCase(),
    });
  };

  const latestArtifactPayload =
    hit?.latestArtifact?.payload && typeof hit.latestArtifact.payload === "object"
      ? hit.latestArtifact.payload
      : {};
  const latestArtifactSourceTime = Number(latestArtifactPayload.source_artifact_time) || 0;
  const latestArtifactSourceType = String(latestArtifactPayload.source_artifact_type || "").trim().toLowerCase();
  if (Number.isFinite(Number(latestArtifactPayload.level))) {
    levels.push({
      price: Number(latestArtifactPayload.level),
      source: "artifact_level",
      sourceTime: latestArtifactSourceTime,
      sourceType: latestArtifactSourceType,
    });
  }

  const artifacts = Array.isArray(hit?.artifacts) ? hit.artifacts : [];
  artifacts.forEach((item) => {
    const payload = item?.payload && typeof item.payload === "object" ? item.payload : {};
    if (Number.isFinite(Number(payload.level))) {
      levels.push({
        price: Number(payload.level),
        source: "artifact_level",
        sourceTime: Number(payload.source_artifact_time) || 0,
        sourceType: String(payload.source_artifact_type || "").trim().toLowerCase(),
      });
    }
  });

  const ruleMeta = hit?.ruleMeta && typeof hit.ruleMeta === "object" ? hit.ruleMeta : {};
  pushLevel(
    ruleMeta.level,
    "rule_level",
    Number(ruleMeta.source_artifact_time) || 0,
    String(ruleMeta.source_artifact_type || "").trim().toLowerCase(),
  );
  const inferredLevels = Array.isArray(ruleMeta.inferred_levels) ? ruleMeta.inferred_levels : [];
  inferredLevels.forEach((value) => pushLevel(value, "inferred_level"));

  const deduped = [];
  const seen = new Set();
  levels.forEach((item) => {
    const rounded = Number(item?.price);
    const key = Number.isFinite(rounded)
      ? `${rounded.toFixed(8)}|${String(item?.sourceType || "").trim().toLowerCase()}|${Number(item?.sourceTime) || 0}`
      : "";
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });
  return deduped;
}

function strategyHitContextToChartObjects(hit = {}, fallbackTf = "") {
  const timeSec = Number(hit?.barTimeUnix ?? hit?.bar_time_unix ?? 0);
  if (!Number.isFinite(timeSec) || timeSec <= 0) return [];
  const tfKey = String(hit?.tf || fallbackTf || "").trim().toLowerCase();
  const eventKey = String(hit?.eventId || hit?.event_id || "strategy").trim().toLowerCase();
  const markerPrice = Number(
    hit?.latestArtifact?.payload?.marker_price ??
      hit?.latestArtifact?.price ??
      hit?.barClose ??
      hit?.bar_close ??
      null,
  );
  const markerPosition =
    Number.isFinite(markerPrice) && Number.isFinite(Number(hit?.barClose ?? hit?.bar_close))
      ? markerPrice <= Number(hit?.barClose ?? hit?.bar_close)
        ? "belowBar"
        : "aboveBar"
      : "aboveBar";
  return collectStrategyHitLevelReferences(hit).flatMap((level, index) => {
    const baseId = String(
      hit?.matchKey
        ? `${hit.matchKey}:ctx:${index + 1}`
        : `strategy-context-${eventKey}-${timeSec}-${index + 1}`,
    );
    const levelLabel =
      level.source === "artifact_level"
        ? String(level.sourceType || "Artifact level")
            .replaceAll("_", " ")
            .trim()
            .toUpperCase() || "ARTIFACT LEVEL"
        : level.source === "inferred_level"
          ? "INFERRED LEVEL"
          : "RULE LEVEL";
    const lineObject = {
      id: baseId,
      kind: "line",
      type: "RULE_LEVEL",
      label: levelLabel,
      visible: true,
      tf: tfKey,
      color: "rgba(125, 211, 252, 0.95)",
      price: Number(level.price),
      time: timeSec,
      anchorTimeMs:
        Number.isFinite(Number(level.sourceTime)) && Number(level.sourceTime) > 0
          ? Number(level.sourceTime) * 1000
          : timeSec * 1000,
      anchorTimeMs2: timeSec * 1000,
      anchorPrice: Number(level.price),
      line_style: "solid",
      line_width: 1.2,
      line_scope: "segment",
      artifact_family: "strategy",
      artifact_type: `${eventKey}_level`,
      artifact_group: "strategy_context",
      source_tf: tfKey,
      artifact_payload: {
        hit,
        level_source: level.source,
      },
    };
    const levelPointObject = {
      id: `${baseId}:target`,
      kind: "point",
      type: "RULE_LEVEL_TARGET",
      label: levelLabel,
      visible: true,
      tf: tfKey,
      color: "rgba(125, 211, 252, 1)",
      price: Number(level.price),
      time: timeSec,
      anchorTimeMs: timeSec * 1000,
      anchorPrice: Number(level.price),
      marker_shape: "circle",
      marker_text: "LVL",
      marker_position: markerPosition,
      artifact_family: "strategy",
      artifact_type: `${eventKey}_level_target`,
      artifact_group: "strategy_context",
      source_tf: tfKey,
      artifact_payload: {
        hit,
        level_source: level.source,
      },
    };
    return [lineObject, levelPointObject];
  });
}

function artifactTimeframeColor(tf = "") {
  const label = artifactSourceTfLabel(tf);
  if (label === "1d") return "#facc15";
  if (label === "4h") return "#a855f7";
  if (label === "1h") return "#60a5fa";
  if (label === "15m") return "#3b82f6";
  if (label === "5m") return "#9ca3af";
  if (label === "1m") return "#6b7280";
  return "#94a3b8";
}

function shouldShowArtifactSourceTf(sourceTf = "", chartTf = "") {
  const hasSourceTf = String(sourceTf || "").trim().length > 0;
  const hasChartTf = String(chartTf || "").trim().length > 0;
  if (!hasSourceTf || !hasChartTf) return true;
  return true;
}
function defaultTpSlFromEntry(entry, direction) {
  const e = Number(entry);
  const isSell = String(direction || "BUY").toUpperCase() === "SELL";
  if (!Number.isFinite(e)) return { tp: null, sl: null };
  return {
    tp: isSell ? e * 0.98 : e * 1.02,
    sl: isSell ? e * 1.02 : e * 0.98,
  };
}

function normalizeSnapshotGridTf(tf) {
  const raw = String(tf || "").trim();
  if (!raw) return "";
  const t = raw.toLowerCase();
  if (t === "1d" || t === "d" || t === "day") return "1D";
  if (t === "4h" || t === "240") return "4H";
  if (t === "15m" || t === "15") return "15m";
  if (t === "5m" || t === "5") return "5m";
  return raw;
}

function buildSnapshotGridTfs(timeframes = []) {
  const list = Array.isArray(timeframes) ? timeframes : [];
  const normalized = [
    ...new Set(list.map((tf) => normalizeSnapshotGridTf(tf)).filter(Boolean)),
  ];
  if (normalized.length > 0) return normalized;
  return ["1D", "4H", "15m", "5m"];
}

const CLIENT_ANALYSIS_ARTIFACT_TFS = ["1d", "4h", "15m"];

function buildRequestedDataTimeframes(timeframes = [], includeAnalysisTfs = false) {
  const visible = (Array.isArray(timeframes) ? timeframes : [])
    .map((tf) =>
      String(tf || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
  const merged = includeAnalysisTfs
    ? [...visible, ...CLIENT_ANALYSIS_ARTIFACT_TFS]
    : visible;
  return sortTimeframes([...new Set(merged)], "desc");
}

function formatTfForToast(tf = "") {
  return artifactSourceTfLabel(tf) || String(tf || "").trim() || "?";
}

function formatTfListForToast(timeframes = []) {
  const labels = [...new Set((Array.isArray(timeframes) ? timeframes : []).map((tf) => formatTfForToast(tf)).filter(Boolean))];
  return labels.join(", ");
}

function buildChartTopicKey(symbol = "") {
  const sym = String(symbol || "")
    .trim()
    .toUpperCase();
  return sym ? `chart:${sym}` : "";
}

function isCryptoLikeDebugSymbol(symbol = "") {
  const sym = String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!sym) return false;
  if (sym.endsWith("USDT")) return true;
  if (sym.length < 6) return false;
  const base = sym.slice(0, 3);
  return LIVE_DEBUG_CRYPTO_PREFIXES.includes(base);
}

function formatDebugAgeMinutes(lastSec) {
  const last = Number(lastSec || 0);
  if (!Number.isFinite(last) || last <= 0) return "n/a";
  return `${Math.max(0, (Date.now() / 1000 - last) / 60).toFixed(1)}m`;
}

function debugTone(active, warning = false) {
  if (warning) return "#f59e0b";
  return active ? "#10b981" : "#64748b";
}

function formatObjectLabel(type, rawLabel) {
  const typeText = String(type || "").trim();
  const labelText = String(rawLabel || "").trim();
  const base = typeText || labelText;
  if (!base) return "";
  const normalized = base.replace(/^All\s+/i, "").trim();
  return normalized ? `All ${normalized}` : "";
}

function artifactColorForItem(item = {}) {
  const timeframeColor = artifactTimeframeColor(item?.timeframe || item?.tf || item?.source_tf);
  if (timeframeColor) return timeframeColor;
  const group = artifactGroupKeyForItem(item);
  if (group === "pdh" || group === "pdl") return "#94a3b8";
  if (group === "support" || group === "demand") return "#94a3b8";
  if (group === "fvg" || group === "ifvg") return "#94a3b8";
  if (group === "ob" || group === "bb") return "#f59e0b";
  if (group === "liquidity") return "#14b8a6";
  if (group === "swings") return "#60a5fa";
  if (group === "patterns") return "#a855f7";
  return "#94a3b8";
}

function artifactGroupKeyForItem(item = {}) {
  const family = String(item?.family || item?.artifact_family || "").trim().toLowerCase();
  const type = String(item?.type || item?.artifact_type || "").trim().toLowerCase();
  const label = String(item?.label || "").trim().toLowerCase();
  const subtype = String(item?.subtype || "").trim().toLowerCase();
  const patternType = String(item?.payload?.pattern_type || "").trim().toLowerCase();
  const text = [family, type, label, subtype, patternType].filter(Boolean).join(" ");
  if (/\bpdh\b/.test(text)) return "pdh";
  if (/\bpdl\b/.test(text)) return "pdl";
  if (type.includes("support") || label.includes("support")) return "support";
  if (type.includes("demand") || label.includes("demand")) return "demand";
  if (
    /\bifvg\b/.test(text) ||
    /\bi_fvg\b/.test(text) ||
    /inverse\s*fvg/.test(text) ||
    /inversion\s*fvg/.test(text)
  ) {
    return "ifvg";
  }
  if (
    /\bbb\b/.test(text) ||
    /\bbreaker\b/.test(text) ||
    /\bbreaker block\b/.test(text) ||
    /\bbreaker_block\b/.test(text)
  ) {
    return "bb";
  }
  if (type.includes("fvg") || label.includes("fvg")) return "fvg";
  if (type.includes("ob") || /\border block\b/.test(text)) return "ob";
  if (type.includes("liquidity") || label.includes("liquidity")) return "liquidity";
  if (type === "bos" || label.includes("bos")) return "bos";
  if (type === "choch" || label.includes("choch")) return "choch";
  if (type.includes("sweep") || label.includes("sweep")) return "sweep";
  if (type.includes("swing_high") || type.includes("swing_low") || label.includes("swing")) {
    return "swings";
  }
  if (family === "pattern") return "patterns";
  return type || family || "other";
}

function artifactGroupLabel(groupKey = "") {
  const key = String(groupKey || "").trim().toLowerCase();
  if (key === "pdh") return "PDH";
  if (key === "pdl") return "PDL";
  if (key === "support") return "Support";
  if (key === "demand") return "Demand";
  if (key === "ifvg") return "iFVG";
  if (key === "fvg") return "FVG";
  if (key === "bb") return "BB";
  if (key === "ob") return "OB";
  if (key === "liquidity") return "Liquidity";
  if (key === "bos") return "BOS";
  if (key === "choch") return "CHOCH";
  if (key === "sweep") return "Sweep";
  if (key === "swings") return "Swings";
  if (key === "patterns") return "Candle Patterns";
  return key.toUpperCase() || "Other";
}

function resolveArtifactWindow(
  bars = [],
  viewport = null,
  tf = "",
  { scope = "visible" } = {},
) {
  const tfSec = Math.max(1, Number(timeframeToSeconds(tf)) || 60);
  const firstBarSec = Number(bars?.[0]?.time);
  const lastBarSec = Number(bars?.[bars.length - 1]?.time);
  if (!Number.isFinite(firstBarSec) || !Number.isFinite(lastBarSec)) return null;
  if (scope === "loaded") {
    return {
      startTime: firstBarSec,
      endTime: Math.max(firstBarSec, lastBarSec),
    };
  }
  const viewportStartSec = Number(viewport?.timeStartMs) / 1000;
  const viewportEndSec = Number(viewport?.timeEndMs) / 1000;
  const quantizedStart = Number.isFinite(viewportStartSec)
    ? Math.floor(viewportStartSec / tfSec) * tfSec
    : null;
  const quantizedEnd = Number.isFinite(viewportEndSec)
    ? Math.ceil(viewportEndSec / tfSec) * tfSec
    : null;
  const safeStart = Number.isFinite(quantizedStart)
    ? Math.max(firstBarSec, quantizedStart)
    : firstBarSec;
  const safeEnd = Number.isFinite(quantizedEnd)
    ? Math.min(lastBarSec, quantizedEnd)
    : lastBarSec;
  const startTime = Math.min(safeStart, safeEnd);
  const endTime = Math.max(
    startTime,
    safeEnd >= safeStart ? safeEnd : startTime + tfSec,
  );
  return {
    startTime,
    endTime,
  };
}

function artifactSourceTfSeconds(item = {}, fallbackTf = "") {
  const tf = String(
    item?.timeframe || item?.tf || item?.source_tf || fallbackTf || "",
  ).trim();
  return Math.max(1, Number(timeframeToSeconds(tf)) || 60);
}

function artifactSourceSpanBars(item = {}, startTimeSec = null, fallbackTf = "") {
  const startSec = Number(startTimeSec);
  if (!Number.isFinite(startSec)) return null;
  const tfSec = artifactSourceTfSeconds(item, fallbackTf);
  const payload =
    item?.payload && typeof item.payload === "object" ? item.payload : {};
  const explicitEndCandidates = [
    item?.bar_end,
    payload?.confirmation_bar_time,
    payload?.middle_bar_time,
    payload?.end_time,
    payload?.source_end_time,
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= startSec);
  if (!explicitEndCandidates.length) return null;
  const furthestEndSec = Math.max(...explicitEndCandidates);
  const deltaBars = Math.ceil(Math.max(0, furthestEndSec - startSec) / tfSec);
  return Math.max(1, deltaBars + 1);
}

function artifactSourceSpanEndTimeSec(item = {}, startTimeSec = null, fallbackTf = "") {
  const startSec = Number(startTimeSec);
  if (!Number.isFinite(startSec)) return null;
  const tfSec = artifactSourceTfSeconds(item, fallbackTf);
  const extensionBarsRaw =
    Number(item?.payload?.extension_bars ?? item?.metrics?.extension_bars) || null;
  if (Number.isFinite(extensionBarsRaw)) {
    const extensionBars = Math.max(1, Math.min(240, Math.round(extensionBarsRaw)));
    return startSec + tfSec * extensionBars;
  }
  const spanBars = artifactSourceSpanBars(item, startSec, fallbackTf);
  if (Number.isFinite(spanBars)) return startSec + tfSec * spanBars;
  return null;
}

function artifactItemToChartObject(item = {}, fallbackTf = "") {
  if (!item || typeof item !== "object") return null;
  const family = String(item.family || "").trim().toLowerCase();
  const type = String(item.type || "").trim();
  const label = String(item.label || item.type || "").trim();
  const tf = String(item.timeframe || fallbackTf || "").trim();
  const color = artifactColorForItem(item);
  const groupKey = artifactGroupKeyForItem(item);
  const timeSec =
    Number(
      groupKey === "fvg" || groupKey === "ob"
        ? item.bar_start ?? item.anchor_time ?? item.time
        : item.anchor_time ?? item.bar_start ?? item.time,
    ) || null;
  const endTimeSec = Number(item.bar_end) || null;
  const price = Number(item.price);
  const priceLow = Number(item.price_low);
  const priceHigh = Number(item.price_high);

  if (groupKey === "swings") {
    if (!Number.isFinite(price) || !Number.isFinite(timeSec)) return null;
    const tfSeconds = Math.max(1, Number(timeframeToSeconds(tf)) || 60);
    const swingLevelEndTimeSec = timeSec + tfSeconds * 20;
    const previousSameTypeTime = Number(
      item?.payload?.previous_same_type_time ??
        item?.payload?.previousSameTypeTime,
    );
    const previousSameTypePrice = Number(
      item?.payload?.previous_same_type_price ??
        item?.payload?.previousSameTypePrice,
    );
    const swingPoint = {
      id: String(item.id || `${family}-${type}-${timeSec}`),
      kind: "point",
      type: "",
      label: "",
      visible: true,
      tf,
      color,
      price,
      time: timeSec,
      anchorTimeMs: timeSec * 1000,
      anchorPrice: price,
      line_style: "dot",
      line_width: 0.1,
      marker_shape: "circle",
      marker_text: formatArtifactExactPrice(price),
      marker_position: "price",
      artifact_family: family,
      artifact_type: type,
      artifact_group: groupKey,
      source_tf: tf,
      artifact_payload: item,
    };
    const swingLevelLine = {
      id: `${String(item.id || `${family}-${type}-${timeSec}`)}:level`,
      kind: "line",
      type: "",
      label: artifactLevelLabel(item, tf),
      visible: true,
      tf,
      color,
      price,
      time: timeSec,
      anchorTimeMs: timeSec * 1000,
      anchorTimeMs2: swingLevelEndTimeSec * 1000,
      anchorPrice: price,
      anchorPrice2: price,
      line_style: "dot",
      line_width: 0.5,
      line_scope: "segment_to_scale",
      artifact_family: family,
      artifact_type: `${type}_level`,
      artifact_group: groupKey,
      source_tf: tf,
      artifact_payload: item,
    };
    const swingConnection =
      Number.isFinite(previousSameTypeTime) && Number.isFinite(previousSameTypePrice)
        ? {
            id: `${String(item.id || `${family}-${type}-${timeSec}`)}:segment`,
            kind: "line",
            type: "",
            label: "",
            visible: true,
            tf,
            color,
            price: previousSameTypePrice,
            time: previousSameTypeTime,
            anchorTimeMs: previousSameTypeTime * 1000,
            anchorTimeMs2: timeSec * 1000,
            anchorPrice: previousSameTypePrice,
            anchorPrice2: price,
            line_style: "dot",
            line_width: 0.6,
            line_scope: "segment",
            artifact_family: family,
            artifact_type: `${type}_segment`,
            artifact_group: groupKey,
            source_tf: tf,
            artifact_payload: item,
          }
        : null;
    return swingConnection
      ? [swingConnection, swingLevelLine, swingPoint]
      : [swingLevelLine, swingPoint];
  }

  if (Number.isFinite(priceLow) || Number.isFinite(priceHigh)) {
    const top = Number.isFinite(priceHigh)
      ? priceHigh
      : Number.isFinite(price)
        ? price
        : null;
    const bottom = Number.isFinite(priceLow)
      ? priceLow
      : Number.isFinite(price)
        ? price
        : null;
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
    const defaultZoneExtensionBars =
      groupKey === "fvg" || groupKey === "ifvg" ? 5 : groupKey === "ob" || groupKey === "bb" ? 28 : 20;
    const computedEndTimeSec =
      Number.isFinite(timeSec)
        ? artifactSourceSpanEndTimeSec(item, timeSec, tf) ??
          (timeSec + artifactSourceTfSeconds(item, tf) * defaultZoneExtensionBars)
        : null;
    return {
      id: String(item.id || `${family}-${type}-${timeSec || top}`),
      kind: "zone",
      type: type.toUpperCase() || "ZONE",
      label: artifactInlineLabel(item, tf),
      visible: true,
      tf,
      color,
      bg_color: `${color}0d`,
      price_top: top,
      price_bottom: bottom,
      time: Number.isFinite(timeSec) ? timeSec : null,
      anchorTimeMs: Number.isFinite(timeSec) ? timeSec * 1000 : null,
      anchorTimeMs2: Number.isFinite(computedEndTimeSec)
        ? computedEndTimeSec * 1000
        : Number.isFinite(timeSec)
          ? (timeSec + Math.max(1, Number(timeframeToSeconds(tf)) || 60) * zoneExtensionBars) * 1000
          : null,
      anchorPrice: top,
      anchorPrice2: bottom,
      line_style: groupKey === "ob" ? "solid" : "dot",
      line_width: 0.1,
      artifact_family: family,
      artifact_type: type,
      artifact_group: groupKey,
      source_tf: tf,
      artifact_payload: item,
    };
  }

  if (family === "pattern" || family === "structure") {
    if (!Number.isFinite(price) || !Number.isFinite(timeSec)) return null;
    const direction = String(
      item?.direction || item?.payload?.bias || item?.subtype || "",
    )
      .trim()
      .toLowerCase();
    const basePoint = {
      id: String(item.id || `${family}-${type}-${timeSec}`),
      kind: "point",
      type: type.toUpperCase() || "POINT",
      label: artifactInlineLabel(item, tf),
      visible: true,
      tf,
      color,
      price,
      time: timeSec,
      anchorTimeMs: timeSec * 1000,
      anchorPrice: price,
      line_style: "dot",
      line_width: 0.1,
      marker_shape:
        direction === "sell" || direction === "bearish" ? "arrowDown" : "arrowUp",
      marker_text: artifactMarkerText(item),
      marker_position:
        direction === "sell" || direction === "bearish" ? "aboveBar" : "belowBar",
      artifact_family: family,
      artifact_type: type,
      artifact_group: groupKey,
      source_tf: tf,
      artifact_payload: item,
    };
    if (type === "bos" || type === "choch") {
      const sourceSwingTime = Number(item?.payload?.source_swing_time);
      const sourceSwingPrice = Number(item?.payload?.source_swing_price);
      const connection =
        Number.isFinite(sourceSwingTime) && Number.isFinite(sourceSwingPrice)
          ? {
              id: `${String(item.id || `${family}-${type}-${timeSec}`)}:source`,
              kind: "line",
              type: `${type.toUpperCase()}_SOURCE`,
              label: "",
              visible: true,
              tf,
              color,
              price: sourceSwingPrice,
              time: sourceSwingTime,
              anchorTimeMs: sourceSwingTime * 1000,
              anchorTimeMs2: timeSec * 1000,
              anchorPrice: sourceSwingPrice,
              line_style: "dot",
              line_width: 0.5,
              line_scope: "segment",
              artifact_family: family,
              artifact_type: `${type}_source`,
              artifact_group: groupKey,
              source_tf: tf,
              artifact_payload: item,
            }
          : null;
      return connection ? [connection, basePoint] : basePoint;
    }
    return basePoint;
  }

  if (Number.isFinite(price)) {
    const normalizedType = String(type || "").trim().toLowerCase();
    const normalizedLabel = String(item?.label || "").trim().toLowerCase();
    const isKeyLevelArtifact =
      normalizedType === "key_level" || normalizedLabel.includes("key level");
    return {
      id: String(item.id || `${family}-${type}-${price}`),
      kind: "line",
      type: type.toUpperCase() || "LEVEL",
      label: artifactInlineLabel(item, tf),
      visible: true,
      tf,
      color,
      price,
      time: Number.isFinite(timeSec) ? timeSec : null,
      anchorTimeMs: Number.isFinite(timeSec) ? timeSec * 1000 : null,
      anchorTimeMs2: isKeyLevelArtifact ? null : undefined,
      anchorPrice: price,
      line_style: "dot",
      line_width: 0.5,
      line_scope: isKeyLevelArtifact ? "segment" : "full",
      artifact_family: family,
      artifact_type: type,
      artifact_group: groupKey,
      source_tf: tf,
      artifact_payload: item,
    };
  }
  return null;
}

function artifactEnvelopeToChartObjects(artifacts, fallbackTf = "") {
  const items = Array.isArray(artifacts?.items) ? artifacts.items : [];
  return items
    .flatMap((item) => {
      const mapped = artifactItemToChartObject(item, fallbackTf);
      return Array.isArray(mapped) ? mapped : [mapped];
    })
    .filter(Boolean);
}

function artifactObjectReferencePrice(item = {}) {
  const directPrice = Number(item?.price ?? item?.anchorPrice);
  const top = Number(item?.price_top ?? item?.anchorPrice);
  const bottom = Number(item?.price_bottom ?? item?.anchorPrice2);
  if (Number.isFinite(top) && Number.isFinite(bottom)) return (top + bottom) / 2;
  if (Number.isFinite(directPrice)) return directPrice;
  if (Number.isFinite(top)) return top;
  if (Number.isFinite(bottom)) return bottom;
  return null;
}

function artifactObjectReferenceTime(item = {}) {
  const timeSec = Number(item?.time);
  if (Number.isFinite(timeSec)) return timeSec;
  const timeMs = Number(item?.anchorTimeMs);
  return Number.isFinite(timeMs) ? Math.floor(timeMs / 1000) : null;
}

function artifactObjectTypeKey(item = {}) {
  const group = String(
    item?.artifact_group || artifactGroupKeyForItem(item) || "",
  )
    .trim()
    .toLowerCase();
  if (group) {
    const tf = artifactSourceTfLabel(
      item?.source_tf || item?.tf || item?.timeframe || "",
    );
    if (group === "swings") return `${group}|${tf || "na"}`;
    return group;
  }
  const family = String(item?.artifact_family || item?.family || "").trim().toLowerCase();
  const type = String(item?.artifact_type || item?.type || "").trim().toLowerCase();
  return `${family}|${type}`;
}

function limitArtifactObjectsNearLastBar(objects = [], bars = []) {
  const list = Array.isArray(objects) ? objects : [];
  const lastBar = Array.isArray(bars) && bars.length ? bars[bars.length - 1] : null;
  const lastClose = Number(lastBar?.close);
  if (!Number.isFinite(lastClose)) return list;
  const groups = new Map();
  for (const item of list) {
    const key = artifactObjectTypeKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const keepIds = new Set();
  for (const [groupKey, entries] of groups.entries()) {
    const normalizedGroupKey = String(groupKey || "").trim().toLowerCase();
    if (
      normalizedGroupKey === "bos" ||
      normalizedGroupKey === "choch" ||
      normalizedGroupKey.startsWith("bos|") ||
      normalizedGroupKey.startsWith("choch|")
    ) {
      entries.forEach((entry) => {
        if (entry?.id) keepIds.add(String(entry.id));
      });
      continue;
    }
    const ordered = [...entries].sort((a, b) => {
      const ta = artifactObjectReferenceTime(a) || 0;
      const tb = artifactObjectReferenceTime(b) || 0;
      return tb - ta;
    });
    let foundAbove = null;
    let foundBelow = null;
    for (const entry of ordered) {
      const refPrice = artifactObjectReferencePrice(entry);
      if (!Number.isFinite(refPrice)) continue;
      if (!foundAbove && refPrice >= lastClose) {
        foundAbove = entry;
        if (entry?.id) keepIds.add(String(entry.id));
      } else if (!foundBelow && refPrice < lastClose) {
        foundBelow = entry;
        if (entry?.id) keepIds.add(String(entry.id));
      }
      if (foundAbove && foundBelow) break;
    }
  }
  return list.filter((item) => keepIds.has(String(item?.id || "")));
}

function NumberAdjuster({
  value,
  onChange,
  min = -1000000000,
  max = 1000000000,
  step = 1,
  fallbackValue = null,
  placeholder = "",
  disabled = false,
  id = undefined,
  name = undefined,
}) {
  const safeVal = resolveAdjusterValue(value, fallbackValue);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        id={id}
        name={name || id}
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{ width: 120 }}
      />
      <button
        type="button"
        className="secondary-button"
        style={{

          width: 22,

          minWidth: 22,
        }}
        onClick={() => onChange(String(Math.max(min, safeVal - step)))}
        disabled={disabled}
        title={`Decrease value by ${step}`}
      >
        -
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.max(min, Math.min(max, safeVal))}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{ flex: 1, minWidth: 84 }}
      />
      <button
        type="button"
        className="secondary-button"
        style={{

          width: 22,

          minWidth: 22,
        }}
        onClick={() => onChange(String(Math.min(max, safeVal + step)))}
        disabled={disabled}
        title={`Increase value by ${step}`}
      >
        +
      </button>
    </div>
  );
}

function TfHeader({
  tf,
  symbol,
  provider,
  context,
  master,
  renderedBars = [],
  viewport,
  mode,
  analysisSnapshot,
  barsStatus,
  snapshotStatus,
  onRefreshTf,
  onLoadMoreTf,
  onRepairTf,
  onRefreshTfLatest,
  onLoadTfHistory,
  onViewportNavigate,
  repairBusy = false,
  forceRefresh,
  allowHistoryRefresh = true,
  showLiveStatus = true,
  liveStatusMode = "live",
}) {
  const snapInfo = master?.snapshots?.[tf.toLowerCase()] || null;
  const showSnapshotBadge = mode === "snapshots" && !!snapInfo?.file_name;
  const dataMenuRef = useRef(null);
  const [showDataMenu, setShowDataMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [actionBusyLabel, setActionBusyLabel] = useState("");
  const [loadMoreBarsInput, setLoadMoreBarsInput] = useState("2000");

  const htfBias = useMemo(() => {
    const rawBias = context?.bias || analysisSnapshot?.htf_context?.bias;
    if (!rawBias) return null;
    const b = String(rawBias).toUpperCase();
    if (b === "LONG" || b === "BULLISH")
      return { label: "BULL", color: "#10b981" };
    if (b === "SHORT" || b === "BEARISH")
      return { label: "BEAR", color: "#ef4444" };
    return { label: "NEUT", color: "var(--muted)" };
  }, [context, analysisSnapshot]);

  const barStat = barsStatus?.[tf] || barsStatus?.[tf.toLowerCase()];
  const snapStat = snapshotStatus?.[tf] || snapshotStatus?.[tf.toLowerCase()];
  const metadata =
    context?.metadata && typeof context.metadata === "object"
      ? context.metadata
      : {};
  const updatedAtValue =
    metadata?.file_updated_at ||
    context?.cached_at ||
    context?.fetched_at ||
    null;
  const cacheTimeText = updatedAtValue ? timeAgo(updatedAtValue) : "";
  const headerBars = Array.isArray(renderedBars)
    ? renderedBars
    : Array.isArray(master?.bars?.[tf.toLowerCase()])
      ? master.bars[tf.toLowerCase()]
      : [];
  const allLoadedBars = Array.isArray(master?.bars?.[tf.toLowerCase()])
    ? master.bars[tf.toLowerCase()]
    : headerBars;
  const loadedBars = headerBars.length;
  const loadedStartSec = Number(headerBars?.[0]?.time);
  const loadedEndSec = Number(headerBars?.[loadedBars - 1]?.time);
  const allLoadedEndSec = Number(allLoadedBars?.[allLoadedBars.length - 1]?.time);
  const allLoadedEndMs =
    Number.isFinite(allLoadedEndSec) && allLoadedEndSec > 0
      ? allLoadedEndSec * 1000
      : null;
  const loadedStartMs =
    Number.isFinite(loadedStartSec) && loadedStartSec > 0
      ? loadedStartSec * 1000
      : null;
  const loadedEndMs =
    Number.isFinite(loadedEndSec) && loadedEndSec > 0
      ? loadedEndSec * 1000
      : null;
  const visibleBars =
    Number(viewport?.visibleBars) > 0 ? Number(viewport.visibleBars) : null;
  const viewportStartMs =
    Number.isFinite(Number(viewport?.timeStartMs)) &&
    Number(viewport?.timeStartMs) > 0
      ? Number(viewport.timeStartMs)
      : null;
  const viewportEndMs =
    Number.isFinite(Number(viewport?.timeEndMs)) && Number(viewport?.timeEndMs) > 0
      ? Number(viewport.timeEndMs)
      : null;
  const visibleEndSec = Number.isFinite(Number(viewportEndMs))
    ? Math.floor(Number(viewportEndMs) / 1000)
    : loadedEndSec;
  const historyBarsActionCount = HISTORY_BARS_ACTION_COUNT;
  const tvSymbol = toTradingViewSymbol(symbol, provider);
  const tvInterval = liveTfToTvInterval(tf);
  const tvUrl =
    tvSymbol && tvInterval
      ? `${TRADINGVIEW_CHART_URL}?symbol=${encodeURIComponent(tvSymbol)}&interval=${encodeURIComponent(tvInterval)}`
      : "";
  const isStreamingMode = mode === "live";
  const normalizedLiveStatusMode = String(liveStatusMode || "live")
    .trim()
    .toLowerCase();
  const shouldShowStatusBadge =
    showLiveStatus &&
    mode === (normalizedLiveStatusMode === "cache" ? "cache" : "live");
  const sourceValue = normalizeHeaderSourceLabel(metadata?.source_kind, context);
  const fileTypeValue = normalizeHeaderFileType(metadata?.file_type, context);
  const streamSourceActive =
    context?.cache_source === "stream" ||
    context?.freshness === "stream" ||
    context?.reason === "realtime_stream";
  const streamConnected = metadata?.stream_connected === true;
  const liveBadge = streamSourceActive && streamConnected
    ? {
        status: "live",
        label: "Live",
        title: "This timeframe is receiving realtime stream updates.",
      }
    : {
        status: streamSourceActive ? "warning" : "neutral",
        label: streamSourceActive ? "No live" : "Static",
        title: streamSourceActive
          ? `${
              normalizedLiveStatusMode === "cache"
                ? "Chart Analysis"
                : "Live mode"
            } is selected, but the realtime stream is not currently connected.`
          : "This timeframe is not currently backed by realtime stream data.",
      };
  const symbolLabel = String(symbol || "")
    .trim()
    .toUpperCase();
  const tfLabel = displayTfLabel(tf);
  const tfColor = artifactTimeframeColor(tf);
  const updatedBars =
    Number(metadata?.updated_bars) > 0 ? Number(metadata.updated_bars) : null;
  const storedBars =
    Number(metadata?.stored_bars) > 0 ? Number(metadata.stored_bars) : null;
  const storedStartSec = Number(
    metadata?.bar_start ?? context?.bar_start ?? null,
  );
  const storedEndSec = Number(
    metadata?.bar_end ?? context?.bar_end ?? null,
  );
  const storedStartMs =
    Number.isFinite(storedStartSec) && storedStartSec > 0
      ? storedStartSec * 1000
      : null;
  const storedEndMs =
    Number.isFinite(storedEndSec) && storedEndSec > 0
      ? storedEndSec * 1000
      : null;
  const sourceInfoTitle = [
    sourceValue === "local"
      ? "source local cached bars from broker/imported history"
      : `source ${sourceValue}`,
    updatedBars ? `last refresh updated ${updatedBars} bars` : null,
    updatedAtValue
      ? `updated ${showDateTime(updatedAtValue)} (${cacheTimeText || "now"})`
      : null,
  ]
    .filter(Boolean)
    .join(" | ");
  const fileInfoLabel = [fileTypeValue, storedBars ? `${storedBars}b file` : null]
    .filter(Boolean)
    .join(" | ");
  const fileInfoTitle = [
    `storage ${fileTypeValue}`,
    storedBars ? `${storedBars} total bars in file` : null,
    loadedBars > 0 ? `${loadedBars} bars currently loaded in chart memory` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  const liveStatusTooltip = [
    `Status: ${liveBadge?.label || "Static"}`,
    liveBadge?.title || null,
    `Symbol: ${symbolLabel || "-"}`,
    `Timeframe: ${tfLabel}`,
    `Source: ${sourceValue || "unknown"}`,
    `Storage: ${fileTypeValue || "unknown"}`,
    `Stream source: ${streamSourceActive ? "yes" : "no"}`,
    `Stream connected: ${streamConnected ? "yes" : "no"}`,
    updatedAtValue
      ? `Updated: ${showDateTime(updatedAtValue)} (${cacheTimeText || "now"})`
      : null,
    storedBars ? `Stored bars: ${storedBars}` : null,
    loadedBars > 0 ? `Loaded bars: ${loadedBars}` : null,
    loadedStartMs && loadedEndMs
      ? `Loaded range: ${showDateTime(loadedStartMs)} -> ${showDateTime(loadedEndMs)}`
      : null,
    viewportStartMs && viewportEndMs
      ? `Visible range: ${showDateTime(viewportStartMs)} -> ${showDateTime(viewportEndMs)}`
      : null,
  ]
    .filter(Boolean)
    .join(" | ");
  const loadedRangeLabel = buildHeaderRangeLabel(
    loadedStartMs,
    loadedEndMs,
    loadedBars,
    "L",
  );
  const visibleRangeLabel = buildHeaderRangeLabel(
    viewportStartMs,
    viewportEndMs,
    visibleBars,
    "V",
  );
  const loadedRangeTitle = [
    "Loaded in chart",
    loadedStartMs ? `start ${showDateTime(loadedStartMs)}` : null,
    loadedEndMs ? `end ${showDateTime(loadedEndMs)}` : null,
    loadedBars > 0 ? `${loadedBars} bars loaded` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  const visibleRangeTitle = [
    "Visible in viewport",
    viewportStartMs ? `start ${showDateTime(viewportStartMs)}` : null,
    viewportEndMs ? `end ${showDateTime(viewportEndMs)}` : null,
    visibleBars ? `${visibleBars} bars visible` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  const fileStartMs = storedStartMs;
  const fileEndMs = storedEndMs;
  const storedBarsLabel =
    Number.isFinite(storedBars) && storedBars > 0 ? String(storedBars) : "n/a";
  const storageSummaryLabel = fileInfoLabel || fileTypeValue || "storage";
  const [syncNowMs, setSyncNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (mode !== "cache" && mode !== REPLAY_MODE) return undefined;
    const tfSeconds = Number(timeframeToSeconds(tf)) || 60;
    const tickMs = Math.max(1000, Math.min(tfSeconds * 1000, 15000));
    const timer = window.setInterval(() => {
      setSyncNowMs(Date.now());
    }, tickMs);
    return () => window.clearInterval(timer);
  }, [mode, tf]);
  const expectedLatestBarSec = useMemo(
    () => expectedLatestClosedBarStartSec(tf, syncNowMs),
    [syncNowMs, tf],
  );
  const expectedLatestBarMs =
    Number.isFinite(expectedLatestBarSec) && expectedLatestBarSec > 0
      ? expectedLatestBarSec * 1000
      : null;
  const missingLatestBars = useMemo(() => {
    const tfSeconds = Number(timeframeToSeconds(tf)) || 0;
    if (!tfSeconds) return null;
    const comparisonEndSec = loadedEndSec;
    if (!Number.isFinite(comparisonEndSec) || comparisonEndSec <= 0) return null;
    if (!Number.isFinite(expectedLatestBarSec) || expectedLatestBarSec <= comparisonEndSec) {
      return 0;
    }
    return Math.max(
      0,
      Math.floor((expectedLatestBarSec - comparisonEndSec) / tfSeconds),
    );
  }, [expectedLatestBarSec, loadedEndSec, tf, visibleEndSec]);
  const cacheLiveBadge = useMemo(() => {
    if (mode !== "cache" && mode !== REPLAY_MODE) return null;
    if (missingLatestBars == null) {
      return {
        status: "neutral",
        label: "",
        title: "No loaded bars available to compare with the latest expected bar.",
      };
    }
    if (missingLatestBars <= 0) {
      return {
        status: "live",
        label: "",
        title: expectedLatestBarMs
          ? `Static file is up to date through ${showDateTime(expectedLatestBarMs)}.`
          : "Static file is up to date.",
      };
    }
    return {
        status: "warning",
      label: `+${missingLatestBars}`,
      title: [
        `Static file is missing ${missingLatestBars} ${missingLatestBars === 1 ? "bar" : "bars"}.`,
        loadedEndMs
          ? `Last loaded bar ${showDateTime(loadedEndMs)}.`
          : null,
        expectedLatestBarMs ? `Expected latest ${showDateTime(expectedLatestBarMs)}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }, [
    expectedLatestBarMs,
    loadedEndMs,
    missingLatestBars,
    mode,
  ]);
  const normalizeRequestedHistoryBars = useCallback(() => {
    const nextBars = Math.max(
      50,
      Math.min(MAX_HISTORY_BARS, Math.round(Number(loadMoreBarsInput) || historyBarsActionCount)),
    );
    setLoadMoreBarsInput(String(nextBars));
    return nextBars;
  }, [historyBarsActionCount, loadMoreBarsInput]);

  const handleLoadMoreBars = useCallback(async (mode = "storage_only") => {
    if (typeof onRefreshTf !== "function") return;
    const nextBars = normalizeRequestedHistoryBars();
    try {
      setBusy(true);
      setActionBusyLabel("Loading...");
      await onRefreshTf(tf, {
        force: true,
        direction: "history",
        bars: nextBars,
        loadMode: mode,
      });
      if (typeof onLoadMoreTf === "function") {
        onLoadMoreTf(tf, nextBars);
      }
    } finally {
      setBusy(false);
      setActionBusyLabel("");
    }
  }, [normalizeRequestedHistoryBars, onLoadMoreTf, onRefreshTf, tf]);

  const handleLatestRefresh = useCallback(async () => {
    const nextBars = normalizeRequestedHistoryBars();
    try {
      setBusy(true);
      setBusyAction("refresh");
      setActionBusyLabel("Refreshing...");
      if (typeof onRefreshTfLatest === "function") {
        await onRefreshTfLatest(tf, { bars: nextBars });
        return;
      }
      if (typeof onRepairTf === "function") {
        await onRepairTf(tf, {
          syncViewportHistory: true,
          bars: nextBars,
        });
      }
    } finally {
      setBusy(false);
      setBusyAction("");
      setActionBusyLabel("");
    }
  }, [normalizeRequestedHistoryBars, onRefreshTfLatest, onRepairTf, tf]);

  const handleHistoryLoad = useCallback(async () => {
    const nextBars = normalizeRequestedHistoryBars();
    try {
      setBusy(true);
      setBusyAction("load");
      setActionBusyLabel("Loading...");
      if (typeof onLoadTfHistory === "function") {
        await onLoadTfHistory(tf, { bars: nextBars });
        return;
      }
      await handleLoadMoreBars("storage_only");
    } finally {
      setBusy(false);
      setBusyAction("");
      setActionBusyLabel("");
    }
  }, [handleLoadMoreBars, normalizeRequestedHistoryBars, onLoadTfHistory, tf]);

  useEffect(() => {
    if (!showDataMenu) return undefined;
    const handlePointerDown = (event) => {
      if (!dataMenuRef.current) return;
      if (!dataMenuRef.current.contains(event.target)) {
        setShowDataMenu(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showDataMenu]);
  const handleViewportNav = useCallback(
    (action) => {
      if (typeof onViewportNavigate !== "function") return;
      onViewportNavigate(tf, action);
    },
    [onViewportNavigate, tf],
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        marginBottom: 2,
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          if (!tvUrl) return;
          window.open(tvUrl, "_blank", "noopener,noreferrer");
        }}
        style={{
          lineHeight: 1.2,
          minHeight: 16,
          padding: "0 6px",
          minWidth: 34,
          fontSize: 11,
          fontWeight: 800,
          opacity: 0.95,
          cursor: tvUrl ? "pointer" : "default",
        }}
        title={
          tvUrl
            ? `Open ${tvSymbol} ${displayTfLabel(tf)} in TradingView`
            : `Timeframe ${displayTfLabel(tf)}`
        }
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {shouldShowStatusBadge ? (
            <StatusDisplay
              status={liveBadge?.status || "neutral"}
              label=""
              size="mini"
              title={liveStatusTooltip || "Live status unavailable"}
              tooltipContent={liveStatusTooltip || "Live status unavailable"}
            />
          ) : null}
          <span style={{ color: tfColor }}>
            {[symbolLabel, tfLabel].filter(Boolean).join(" ")}
          </span>
        </span>
      </button>
      {htfBias && (
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: htfBias.color,
            background: htfBias.color + "15",
            padding: "0 4px",
            borderRadius: 3,
            border: `1px solid ${htfBias.color}30`,
          }}
        >
          {htfBias.label}
        </span>
      )}
      {["cache", "replay"].includes(mode) && typeof onViewportNavigate === "function" ? (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginLeft: "auto",
          }}
        >
          {[
            { action: "show_compact", label: "Normal" },
            { action: "show_compact_less", label: "-" },
            { action: "show_compact_more", label: "+" },
            { action: "show_all_loaded", label: "Enlarge", iconOnly: true },
            { action: "jump_first", label: "<<" },
            { action: "pan_left", label: "<" },
            { action: "pan_right", label: ">" },
            { action: "jump_latest", label: ">>" },
          ].map((item) => (
            <button
              key={item.action}
              type="button"
              className="secondary-button"
              onClick={() => handleViewportNav(item.action)}
              style={{
                minHeight: 16,
                minWidth: item.iconOnly ? 28 : 24,
                padding: "0 5px",
                lineHeight: 1.1,
                fontSize: 10,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title={item.action === "show_compact" ? "Normal" : item.label}
            >
              {item.iconOnly ? <ViewportNavIcon action={item.action} /> : item.action === "show_compact" ? "." : item.label}
            </button>
          ))}
        </div>
      ) : null}
      {["cache", "replay"].includes(mode) &&
        (typeof onRefreshTf === "function" || typeof onRepairTf === "function") && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            minWidth: 0,
            flexWrap: "wrap",
          }}
        >
          <div
            ref={dataMenuRef}
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "flex-end",
              minWidth: 0,
            }}
          >
            <button
              type="button"
              className="secondary-button"
              onClick={() => setShowDataMenu((prev) => !prev)}
              title={cacheLiveBadge?.title || "Toggle timeframe stats"}
              style={{
                lineHeight: 1.2,
                minHeight: 16,
                minWidth: cacheLiveBadge?.label ? 40 : 28,
                padding: cacheLiveBadge?.label ? "0 8px" : "0 6px",
                fontSize: 11,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                borderColor:
                  cacheLiveBadge?.status === "live"
                    ? "rgba(16,185,129,0.45)"
                    : cacheLiveBadge?.status === "warning"
                      ? "rgba(251,191,36,0.45)"
                      : "rgba(148,163,184,0.28)",
                background:
                  cacheLiveBadge?.status === "live"
                    ? "rgba(16,185,129,0.14)"
                    : cacheLiveBadge?.status === "warning"
                      ? "rgba(251,191,36,0.14)"
                      : undefined,
                color:
                  cacheLiveBadge?.status === "live"
                    ? "#6ee7b7"
                    : cacheLiveBadge?.status === "warning"
                      ? "#fcd34d"
                      : undefined,
              }}
            >
              <span>{"\u2699"}</span>
              {cacheLiveBadge?.label ? (
                <span style={{ fontSize: 10, fontWeight: 900, lineHeight: 1 }}>
                  {cacheLiveBadge.label}
                </span>
              ) : null}
            </button>
            {showDataMenu ? (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  width: 338,
                  zIndex: 30,
                  borderRadius: 12,
                  border: "1px solid rgba(148,163,184,0.2)",
                  background: "rgba(9,15,28,0.97)",
                  boxShadow: "0 18px 48px rgba(0,0,0,0.28)",
                  padding: 10,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ display: "grid", gap: 6 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: "#e2e8f0",
                      letterSpacing: "0.02em",
                    }}
                  >
                    <span style={{ color: tfColor }}>
                      {[symbolLabel, tfLabel].filter(Boolean).join(" ")}
                    </span>
                    <span style={{ color: "#94a3b8" }}>
                      {` · ${storageSummaryLabel || "storage"}`}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "#cbd5e1", lineHeight: 1.45 }}>
                    {`${storedBarsLabel} bars in file: `}
                    <span style={{ color: "#94a3b8" }}>
                      {fileStartMs && fileEndMs
                        ? `${formatHeaderTimeExact(fileStartMs)} -> ${formatHeaderTimeExact(fileEndMs)} (${formatRelativeDateTime(fileEndMs)})`
                        : "n/a"}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "#cbd5e1", lineHeight: 1.45 }}>
                    {`${loadedBars} bars in chart: `}
                    <span style={{ color: "#94a3b8" }}>
                      {loadedStartMs && loadedEndMs
                        ? `${formatHeaderTimeExact(loadedStartMs)} -> ${formatHeaderTimeExact(loadedEndMs)} (${formatRelativeDateTime(loadedEndMs)})`
                        : "n/a"}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "#cbd5e1", lineHeight: 1.45 }}>
                    {`${visibleBars || 0} bars in view: `}
                    <span style={{ color: "#94a3b8" }}>
                      {viewportStartMs && viewportEndMs
                        ? `${formatHeaderTimeExact(viewportStartMs)} -> ${formatHeaderTimeExact(viewportEndMs)} (${formatRelativeDateTime(viewportEndMs)})`
                        : "n/a"}
                    </span>
                  </div>
                  {["cache", "replay"].includes(mode) ? (
                    <div style={{ fontSize: 10, color: "#cbd5e1", lineHeight: 1.45 }}>
                      {`Latest sync: `}
                      <span style={{ color: "#94a3b8" }}>
                        {missingLatestBars == null
                          ? "n/a"
                          : missingLatestBars > 0
                            ? `${missingLatestBars} missing · ${loadedEndMs ? `last ${formatHeaderTimeExact(loadedEndMs)}` : "last n/a"} · expected ${expectedLatestBarMs ? formatHeaderTimeExact(expectedLatestBarMs) : "n/a"}`
                            : `up to date · expected ${expectedLatestBarMs ? formatHeaderTimeExact(expectedLatestBarMs) : "n/a"}`}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  {typeof onRefreshTfLatest === "function" ||
                  typeof onRepairTf === "function" ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleLatestRefresh}
                      disabled={busy}
                      title={`Refresh latest ${tf} bars and repair/fix TF data`}
                      style={{ whiteSpace: "nowrap", justifyContent: "center" }}
                    >
                      {busy && busyAction === "refresh" ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span className="spinner" style={{ width: 12, height: 12 }} />
                          {actionBusyLabel || "Loading..."}
                        </span>
                      ) : (
                        "\u21bb"
                      )}
                    </button>
                  ) : null}
                  {typeof onLoadTfHistory === "function" ||
                  typeof onRefreshTf === "function" ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleHistoryLoad}
                      disabled={busy}
                      title={`Load older ${tf} bars from local storage first; fallback to remote history if local storage has no more bars`}
                      style={{ whiteSpace: "nowrap", justifyContent: "center" }}
                    >
                      {busy && busyAction === "load" ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span className="spinner" style={{ width: 12, height: 12 }} />
                          {actionBusyLabel || "Loading..."}
                        </span>
                      ) : (
                        "Load"
                      )}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
      {mode !== "cache" && mode !== REPLAY_MODE && barStat && barStat.status !== "none" && (
        <span
          style={{
            fontSize: 8,
            fontWeight: 600,
            color: barStat.status === "cached" ? "#10b981" : "#f59e0b",
            background: "rgba(0,0,0,0.2)",
            padding: "0 3px",
            borderRadius: 2,
            marginLeft: mode === "cache" || mode === REPLAY_MODE ? 0 : undefined,
          }}
          title={
            barStat.status === "cached"
              ? `Cached ${barStat.time || ""}`
              : "Loading..."
          }
        >
          {barStat.status === "cached" ? `✅ ${barStat.time || ""}` : "⏳"}
        </span>
      )}
      {snapStat && snapStat.status !== "none" && (
        <span
          style={{
            fontSize: 8,
            fontWeight: 600,
            color: snapStat.status === "snapshot" ? "#10b981" : "#f59e0b",
            background: "rgba(0,0,0,0.2)",
            padding: "0 3px",
            borderRadius: 2,
          }}
          title={
            snapStat.status === "snapshot"
              ? `Snapshot ${snapStat.time || ""}`
              : "Loading..."
          }
        >
          {snapStat.status === "snapshot" ? `${snapStat.time || ""}` : "⏳"}
        </span>
      )}
      {showSnapshotBadge && (
        <span
          style={{
            marginLeft: "auto",
            color: snapInfo.is_new ? "#10b981" : "var(--muted)",
            fontSize: 9,
            background: "rgba(0,0,0,0.2)",
            border: `1px solid ${snapInfo.is_new ? "#10b98140" : "rgba(148,163,184,0.25)"}`,
            padding: "0 4px",
            borderRadius: 3,
            maxWidth: 130,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={`mtime: ${showDateTime(snapInfo.mtime_ms)} | revalidate: ${showDateTime(snapInfo.expires_at_ms)} | ${snapInfo.is_new ? "new" : "cached"}`}
        >
          {snapInfo.file_name || "snapshot"}
        </span>
      )}
    </div>
  );
}

function normalizeLinePriceKey(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return num.toFixed(8);
}

function formatArtifactExactPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return Math.abs(num) >= 1000 ? num.toFixed(2) : num.toFixed(5);
}

function isDedupableManualLine(item = {}) {
  if (!item || typeof item !== "object") return false;
  if (String(item.kind || "").trim().toLowerCase() !== "line") return false;
  if (item.artifact_group || item.artifact_family || item.artifact_type) return false;
  if (String(item.kind || "").trim().toLowerCase() === "tradeplan") return false;
  return Boolean(normalizeLinePriceKey(item.price));
}

function dedupeManualLinesByPrice(items = [], preferredId = "") {
  const list = Array.isArray(items) ? items : [];
  const keepByPrice = new Map();
  const preferred = String(preferredId || "").trim();
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    if (!isDedupableManualLine(item)) continue;
    const priceKey = normalizeLinePriceKey(item.price);
    if (!priceKey) continue;
    const current = keepByPrice.get(priceKey);
    const isPreferred = preferred && String(item.id || "") === preferred;
    if (
      !current ||
      isPreferred ||
      (!current.isPreferred && index >= current.index)
    ) {
      keepByPrice.set(priceKey, {
        id: String(item.id || ""),
        index,
        isPreferred,
      });
    }
  }
  return list.filter((item) => {
    if (!isDedupableManualLine(item)) return true;
    const priceKey = normalizeLinePriceKey(item.price);
    const winner = keepByPrice.get(priceKey);
    return winner?.id === String(item.id || "");
  });
}

export default function SymbolChart({
  symbol,
  timeframes = ["D", "4h", "15m", "5m"],
  timeframePresets = [],
  timeframeOptions = [],
  onTimeframesChange = null,
  defaultMode = "live",
  initialGridCols = null,
  initialBarsCount = 0,
  onAnalyze,
  onRemove,
  isInWatchlist = false,
  isInSelected = false,
  onToggleWatchlist = null,
  onRemoveSelected = null,
  entryPrice = null,
  side = null,
  action = null,
  tpPrice = null,
  slPrice = null,
  tp1Price = null,
  tp2Price = null,
  tp3Price = null,
  createdAt = null,
  openedAt = null,
  closedAt = null,
  closeStatus = "",
  exitPrice = null,
  pnlRealized = null,
  tradeLabel = "",
  animateTradeViewport = false,
  onPlanLevelChange = null,
  onRequestPlanRefresh = null,
  planRefreshNonce = 0,
  planRefreshError = "",
  analysisSnapshot = null,
  enableChartObjects = false,
  showEventMarkers = false,
  hasTradePlan = false,
  hasAnalysis = false,
  barsStatus = null,
  snapshotStatus = null,
  skipFetch = false,
  provider = "ICMARKETS",
  sessionPrefix = "",
  profile = "day",
  attachedSnapshotFiles = [],
  tradeSid = "",
  onQuickTradeIntent = null,
  onTrade = null,
  showAnalyzeButton = true,
  showTradeButton = true,
  showEditButton = true,
  showSnapshotButton = true,
  showObjectInspector = false,
  onSnapshot = null,
  analyzeLabel = "Analyze",
  showPerCardLayoutControls = true,
  selectedTradePlanGroup = null,
  onTradePlanGroupChange = null,
  fillViewportForFourCharts = false,
  autoLoadOnMount = false,
  onModeChange = null,
  syncModeWithLocationHash = true,
  persistMarketUiConfig = true,
  analysisHeaderStatusMode = "live",
  trades = [],
  backtestTrades = [],
  onReplayActiveTradeChange = null,
  backtestReplay = null,
  anchorToTradeTime = false,
  autoStartReplay = false,
  externalChartData = null,
  chartStrategies = [],
  extraRequestedTimeframes = [],
  liveBars = true,
  bootstrapLiveBarsOnMount = false,
}) {
  const rootRef = useRef(null);
  const gridRef = useRef(null);
  const timeframeMenuRef = useRef(null);
  const defaultModeValue = String(defaultMode || "live")
    .trim()
    .toLowerCase();
  const replayRequestedFromHash =
    syncModeWithLocationHash &&
    typeof window !== "undefined" &&
    String(window.location.hash || "").trim().toLowerCase() === "#chart-replay";
  const effectiveAutoStartReplay = autoStartReplay || replayRequestedFromHash;
  const initialChartModes = useMemo(
    () => ["live", "cache", REPLAY_MODE, "svg"],
    [],
  );
  const [mode, setMode] = useState(() =>
    typeof window === "undefined"
      ? defaultModeValue
      : syncModeWithLocationHash
        ? resolveModeFromHash(
            window.location.hash,
            initialChartModes,
            defaultModeValue,
          )
        : defaultModeValue,
  );
  const isStreamingMode = mode === "live";
  const [pendingMode, setPendingMode] = useState(null); // mode we're loading
  const [timeframeMenuOpen, setTimeframeMenuOpen] = useState(false);
  const [lastError, setLastError] = useState(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [availableViewportGridHeight, setAvailableViewportGridHeight] =
    useState(0);
  const [viewportAutoFitNonce, setViewportAutoFitNonce] = useState(0);
  const viewportAutoFitKeyRef = useRef("");
  const bootstrapRepairRef = useRef({
    key: "",
    status: "idle",
  });
  const cleanSym = useMemo(() => normSym(symbol), [symbol]);
  const defaultGridCols = useMemo(() => {
    const maxCols = Math.max(1, timeframes?.length || 4);
    if (
      Number.isFinite(Number(initialGridCols)) &&
      Number(initialGridCols) > 0
    ) {
      return Math.min(maxCols, Math.max(1, Number(initialGridCols)));
    }
    return maxCols;
  }, [initialGridCols, timeframes?.length]);
  const [masterChartConfig, setMasterChartConfig] = useState(() =>
    readLocalMasterChartConfig(),
  );
  const configuredGridCols = masterChartConfig?.gridCols;
  const [gridCols, setGridCols] = useState(() =>
    Number.isFinite(Number(initialGridCols)) && Number(initialGridCols) > 0
      ? Math.min(
          Math.max(1, timeframes?.length || 1),
          Math.max(1, Number(initialGridCols)),
        )
      : Number(masterChartConfig?.gridCols) > 0
        ? Number(masterChartConfig.gridCols)
        : defaultGridCols,
  );
  const [overlays, setOverlays] = useState({
    plan1: true,
    plan2: false,
    pdArrays: false,
    keyLevels: false,
  });
  const [syncedCrosshair, setSyncedCrosshair] = useState(null);
  const [localBarsCount, setLocalBarsCount] = useState(() =>
    Math.max(
      SYMBOL_CHART_MIN_LOADED_BARS,
      savedBarsCountForSymbol(
        cleanSym,
        Number.isFinite(Number(initialBarsCount)) && Number(initialBarsCount) > 0
          ? Number(initialBarsCount)
          : 0,
      ),
    ),
  );
  const [annotations, setAnnotations] = useState([]);
  const [artifactObjectsByChartId, setArtifactObjectsByChartId] = useState({});
  const [artifactGroupVisibility, setArtifactGroupVisibility] = useState({});
  const [artifactTfVisibility, setArtifactTfVisibility] = useState({});
  const [showStrategyMarkers, setShowStrategyMarkers] = useState(false);
  const [selectedObjectId, setSelectedObjectId] = useState(null);
  const [editObjects, setEditObjects] = useState(false);

  // Load chart objects from trade metadata when trade changes.
  // Important: do not depend on entry/tp/sl props to avoid parent-child setState ping-pong loops.
  useEffect(() => {
    if (!tradeSid) return;
    let cancelled = false;
    api
      .loadChartObjects(tradeSid)
      .then((res) => {
        if (cancelled) return;
        const objs = Array.isArray(res?.chart_objects)
          ? res.chart_objects
          : Array.isArray(res?.objects)
            ? res.objects
            : [];
        if (objs.length) {
          setAnnotations(objs);
          return;
        }

        // Auto-generate tradeplan from trade fields when no saved chart_objects
        const ep = Number(entryPrice);
        if (Number.isFinite(ep) && ep > 0) {
          const tp = Number(tpPrice);
          const sl = Number(slPrice);
          const dir =
            Number.isFinite(tp) && tp > ep
              ? "BUY"
              : Number.isFinite(sl) && sl < ep
                ? "SELL"
                : "BUY";
          setAnnotations([
            {
              id: "tradeplan_P1",
              kind: "tradeplan",
              type: "TRADEPLAN",
              label: "TradePlan P1 (auto)",
              plan_id: "P1",
              direction: dir,
              entryPrice: ep,
              tpPrice: Number.isFinite(tp) && tp > 0 ? tp : null,
              slPrice: Number.isFinite(sl) && sl > 0 ? sl : null,
              visible: true,
              color: dir === "SELL" ? "#ef4444" : "#10b981",
              line_width: 0.1,
              line_style: "solid",
              bg_color: "transparent",
              tf: null,
              time: null,
            },
          ]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tradeSid]);

  const handleSaveObjects = useCallback(() => {
    if (!tradeSid || !annotations.length) return;
    api.saveChartObjects(tradeSid, annotations).catch(() => {});
  }, [tradeSid, annotations]);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [localReplayPlaying, setLocalReplayPlaying] = useState(false);
  const [localReplaySpeedMs, setLocalReplaySpeedMs] = useState(500);
  const [repairingTfKey, setRepairingTfKey] = useState("");
  const [viewports, setViewports] = useState({});
  const viewportsRef = useRef({});
  const [savedTfVisibleBars, setSavedTfVisibleBars] = useState({});
  const [manualTfVisibleBars, setManualTfVisibleBars] = useState({});
  const [savedTfViewportPrefs, setSavedTfViewportPrefs] = useState({});
  const [ctxMenu, setCtxMenu] = useState(null);
  const [activeChartId, setActiveChartId] = useState(null);
  const [showIndicatorsMenu, setShowIndicatorsMenu] = useState(false);
  const [showLiveDebugMenu, setShowLiveDebugMenu] = useState(false);
  const [activeLayersTab, setActiveLayersTab] = useState("chart");
  const [configSaveState, setConfigSaveState] = useState("");
  const [liveDebugHealth, setLiveDebugHealth] = useState(null);
  const [liveDebugHealthError, setLiveDebugHealthError] = useState("");
  const [liveDebugTopicState, setLiveDebugTopicState] = useState(null);
  const [indicatorVisibility, setIndicatorVisibility] = useState(
    normalizeIndicatorVisibility(masterChartConfig?.indicatorVisibility),
  );
  const [hoverInfo, setHoverInfo] = useState(null);
  const [activePlanGroup, setActivePlanGroup] = useState("P1");
  const [drawMode, setDrawMode] = useState(null);
  const shouldBootstrapLiveBars =
    bootstrapLiveBarsOnMount === true && liveBars === false;
  const [liveBarsEnabled, setLiveBarsEnabled] = useState(
    shouldBootstrapLiveBars ? true : liveBars !== false,
  );
  const [hasCompletedLiveBarsBootstrap, setHasCompletedLiveBarsBootstrap] =
    useState(!shouldBootstrapLiveBars);
  const hasAutoExpandedBootstrapViewRef = useRef(false);
  const dragRef = useRef(null);
  const liveDebugMenuRef = useRef(null);
  const parentDrivenSelectionRef = useRef(null);
  const lastIncomingPlanGroupRef = useRef(null);
  const lastPropagatedPlanGroupRef = useRef("");
  const onModeChangeRef = useRef(onModeChange);
  const onTradePlanGroupChangeRef = useRef(onTradePlanGroupChange);
  const onReplayActiveTradeChangeRef = useRef(onReplayActiveTradeChange);

  useEffect(() => {
    onModeChangeRef.current = onModeChange;
  }, [onModeChange]);

  useEffect(() => {
    onTradePlanGroupChangeRef.current = onTradePlanGroupChange;
  }, [onTradePlanGroupChange]);

  useEffect(() => {
    onReplayActiveTradeChangeRef.current = onReplayActiveTradeChange;
  }, [onReplayActiveTradeChange]);

  useEffect(() => {
    if (shouldBootstrapLiveBars && !hasCompletedLiveBarsBootstrap) {
      setLiveBarsEnabled(true);
      return;
    }
    setLiveBarsEnabled(liveBars !== false);
  }, [hasCompletedLiveBarsBootstrap, liveBars, shouldBootstrapLiveBars]);

  const [tvSettings, setTvSettings] = useState({
    sidebar: false,
    toolbar: false,
    legend: false,
  });
  const [showTvLogin, setShowTvLogin] = useState(false);
  const [showTvControls, setShowTvControls] = useState(true);
  const [snapshotModalFiles, setSnapshotModalFiles] = useState(null);
  const [snapshotGridModal, setSnapshotGridModal] = useState(null);
  const [capturingSnapshots, setCapturingSnapshots] = useState(false);
  const lastRenderableBarsByChartIdRef = useRef({});
  const [artifactLoadStateByTf, setArtifactLoadStateByTf] = useState({});
  const [viewportCommandByChartId, setViewportCommandByChartId] = useState({});
  const [tvEmbedAutoloadEnabled, setTvEmbedAutoloadEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(TRADINGVIEW_EMBED_AUTLOAD_PREF_KEY) === "1";
  });
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 900 : false,
  );
  const [browserSnapshotBusy, setBrowserSnapshotBusy] = useState(false);
  const debugChartLog = useCallback(() => {}, []);
  const chartTileRefs = useRef({});

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const update = () => setIsMobileViewport(window.innerWidth < 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || tvEmbedAutoloadEnabled) return undefined;
    const enableTradingViewEmbeds = () => {
      window.localStorage.setItem(TRADINGVIEW_EMBED_AUTLOAD_PREF_KEY, "1");
      setTvEmbedAutoloadEnabled(true);
    };
    const options = { passive: true };
    window.addEventListener("pointerdown", enableTradingViewEmbeds, options);
    window.addEventListener("keydown", enableTradingViewEmbeds, options);
    window.addEventListener("touchstart", enableTradingViewEmbeds, options);
    return () => {
      window.removeEventListener("pointerdown", enableTradingViewEmbeds, options);
      window.removeEventListener("keydown", enableTradingViewEmbeds, options);
      window.removeEventListener("touchstart", enableTradingViewEmbeds, options);
    };
  }, [tvEmbedAutoloadEnabled]);
  const [timezoneTick, setTimezoneTick] = useState(0);
  const canUseMarketUiConfig = Boolean(cleanSym && persistMarketUiConfig);
  const loadedMarketUiConfigRef = useRef(false);

  useEffect(() => {
    loadedMarketUiConfigRef.current = false;
    viewportAutoFitKeyRef.current = "";
    hasAutoExpandedBootstrapViewRef.current = false;
    lastRenderableBarsByChartIdRef.current = {};
    setArtifactLoadStateByTf({});
    setLoadedTfs({});
    setSavedTfVisibleBars({});
    setManualTfVisibleBars({});
    setSavedTfViewportPrefs({});
    setAnnotations([]);
    setArtifactObjectsByChartId({});
    setArtifactGroupVisibility({});
    setSelectedObjectId(null);
    setActivePlanGroup("P1");
    parentDrivenSelectionRef.current = null;
    lastIncomingPlanGroupRef.current = null;
    lastPropagatedPlanGroupRef.current = "";
  }, [cleanSym, tradeSid]);

  useEffect(() => {
    const onTimezoneUiChanged = () => setTimezoneTick((n) => n + 1);
    window.addEventListener("ui-timezone-changed", onTimezoneUiChanged);
    return () =>
      window.removeEventListener("ui-timezone-changed", onTimezoneUiChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((res) => {
        if (cancelled) return;
        const settings = Array.isArray(res?.settings) ? res.settings : [];
        const found = settings.find(
          (row) =>
            String(row?.type || "").trim().toLowerCase() ===
              MASTER_CHART_SETTING_TYPE &&
            String(row?.name || "").trim().toLowerCase() ===
              MASTER_CHART_SETTING_NAME,
        );
        const normalized = normalizeMasterChartConfig(found?.data || {});
        writeLocalMasterChartConfig(normalized);
        setMasterChartConfig(normalized);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleOverlay = (key) => setOverlays((p) => ({ ...p, [key]: !p[key] }));

  useEffect(() => {
    if (
      Number.isFinite(Number(initialGridCols)) &&
      Number(initialGridCols) > 0
    ) {
      setGridCols(
        Math.max(
          1,
          Math.min(
            Math.max(1, timeframes?.length || 1),
            Math.round(Number(initialGridCols)),
          ),
        ),
      );
      return;
    }
    const nextGridCols = Number(configuredGridCols);
    if (Number.isFinite(nextGridCols) && nextGridCols > 0) {
      setGridCols(Math.max(1, Math.min(6, Math.round(nextGridCols))));
    } else {
      setGridCols(Math.max(1, timeframes?.length || 1));
    }
  }, [configuredGridCols, initialGridCols, timeframes?.length]);

  useEffect(() => {
    setIndicatorVisibility(
      normalizeIndicatorVisibility(masterChartConfig?.indicatorVisibility),
    );
  }, [masterChartConfig]);

  useEffect(() => {
    if (loadedMarketUiConfigRef.current) return;
    if (
      Number.isFinite(Number(initialBarsCount)) &&
      Number(initialBarsCount) > 0
    ) {
      setLocalBarsCount(Math.max(SYMBOL_CHART_MIN_LOADED_BARS, Number(initialBarsCount)));
    }
  }, [cleanSym, initialBarsCount]);

  useEffect(() => {
    if (!canUseMarketUiConfig) return;
    let cancelled = false;
    const applyConfig = (cfg) => {
      const rawTimeframes =
        !anchorToTradeTime &&
        cfg?.timeframes &&
        typeof cfg.timeframes === "object" &&
        !Array.isArray(cfg.timeframes)
          ? cfg.timeframes
          : {};
      const nextSavedTfVisibleBars = {};
      const nextSavedTfViewportPrefs = {};
      loadedMarketUiConfigRef.current = true;
      setViewports((prev) => {
        let changed = false;
        const next = { ...(prev || {}) };
        for (const [tfRaw, tfCfg] of Object.entries(rawTimeframes)) {
          const tfKey = String(tfRaw || "").trim().toLowerCase();
          if (!tfKey) continue;
          const visibleBars = normalizeStoredVisibleBars(
            masterChartConfig,
            tfKey,
            tfCfg?.visibleBars,
          );
          if (!Number.isFinite(visibleBars) || visibleBars <= 0) continue;
          const chartId = `${cleanSym}-${tfKey}`;
          const current = next[chartId] || {};
          nextSavedTfVisibleBars[chartId] = visibleBars;
          if (current.visibleBars === visibleBars) continue;
          next[chartId] = {
            ...current,
            chartId,
            interval: tfKey,
            visibleBars,
          };
          changed = true;
        }
        return changed ? next : prev;
      });
      setSavedTfVisibleBars(nextSavedTfVisibleBars);
      setSavedTfViewportPrefs(nextSavedTfViewportPrefs);
    };
    applyConfig(readLocalMarketUiConfig(cleanSym));
    api
      .loadMarketDataUiConfig(cleanSym)
      .then((res) => {
        if (cancelled) return;
        const cfg = res?.config && typeof res.config === "object" ? res.config : {};
        applyConfig(cfg);
        writeLocalMarketUiConfig(cleanSym, cfg);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [anchorToTradeTime, canUseMarketUiConfig, cleanSym]);

  useEffect(() => {
    if (!rootRef.current) return;
    const updateWidth = () => {
      if (!rootRef.current) return;
      setContainerWidth(rootRef.current.clientWidth || 0);
    };
    updateWidth();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateWidth());
      observer.observe(rootRef.current);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  const normalizedTrades = useMemo(
    () => {
      const providedTrades =
        Array.isArray(trades) && trades.length > 0 ? trades : backtestTrades;
      return normalizeTradeRowsForChart(providedTrades, tradeLabel)
        .map((trade) => ({
          ...trade,
          createdAtSec: resolveReplayTradeCreatedSec(trade),
          openedAtSec: resolveReplayTradeOpenSec(trade),
          closedAtSec: resolveReplayTradeCloseSec(trade),
        }))
        .filter((trade) => Number.isFinite(Number(trade.createdAtSec || trade.openedAtSec || trade.closedAtSec)))
        .sort(compareReplayTradeOrder);
    },
    [backtestTrades, tradeLabel, trades],
  );
  const legacySingleTrade = useMemo(
    () =>
      buildSingleTradeForChart({
        sid: tradeSid || "selected-trade",
        side,
        action,
        entryPrice,
        tpPrice: tpPrice ?? tp1Price,
        tp1Price,
        slPrice,
        exitPrice,
        createdAt,
        openedAt,
        closedAt,
        closeStatus,
        pnlRealized,
        tradeLabel,
      }),
    [
      action,
      closeStatus,
      closedAt,
      createdAt,
      entryPrice,
      exitPrice,
      cleanSym,
      openedAt,
      pnlRealized,
      side,
      slPrice,
      tp1Price,
      tpPrice,
      tradeLabel,
      tradeSid,
    ],
  );
  const normalizedSelectedTrade = useMemo(() => {
    if (normalizedTrades.length > 0) {
      const requestedSid = String(tradeSid || "").trim();
      return (
        normalizedTrades.find((trade) => String(trade?.sid || "") === requestedSid) ||
        normalizedTrades[0] ||
        null
      );
    }
    return legacySingleTrade
      ? {
          ...legacySingleTrade,
          symbol: String(cleanSym || "").trim().toUpperCase(),
          createdAtSec: resolveReplayTradeCreatedSec(legacySingleTrade),
          openedAtSec: resolveReplayTradeOpenSec(legacySingleTrade),
          closedAtSec: resolveReplayTradeCloseSec(legacySingleTrade),
          pnlRealized: toNullableNumber(legacySingleTrade.pnlRealized),
          closeStatus: String(legacySingleTrade.closeStatus || ""),
          tradeLabel: String(legacySingleTrade.tradeLabel || "").trim(),
        }
      : null;
  }, [cleanSym, legacySingleTrade, normalizedTrades, tradeSid]);
  const replayTrades = useMemo(
    () =>
      normalizedTrades.length > 0
        ? normalizedTrades
        : normalizedSelectedTrade
          ? [normalizedSelectedTrade]
          : [],
    [normalizedSelectedTrade, normalizedTrades],
  );
  const hasExternalReplayConfig = Boolean(backtestReplay?.enabled);
  const effectiveReplayConfig = hasExternalReplayConfig
    ? backtestReplay
    : {
        enabled: true,
        playing: localReplayPlaying,
        speedMs: localReplaySpeedMs,
        speedOptions: GENERIC_REPLAY_SPEED_OPTIONS,
        runKey: [
          "generic",
          cleanSym,
          sortTimeframes(timeframes, "asc")?.[0] || timeframes?.[0] || "15m",
          Number(localBarsCount) || 0,
        ].join("|"),
        startTradeSid: "",
        currentTradeIndex: -1,
        totalTrades: 1,
        onSpeedChange: (nextSpeedMs) =>
          setLocalReplaySpeedMs(Math.max(100, Number(nextSpeedMs) || 500)),
        onToggle: () => setLocalReplayPlaying((prev) => !prev),
        onComplete: () => setLocalReplayPlaying(false),
      };
  const activeMode = pendingMode || mode;
  const isReplayMode = activeMode === REPLAY_MODE || mode === REPLAY_MODE;
  const activeDataMode = activeMode === REPLAY_MODE ? "cache" : activeMode;
  const isCacheLikeMode = mode === "cache" || mode === REPLAY_MODE;
  const isTradeAnchoredReplay = hasExternalReplayConfig && replayTrades.length > 0;
  const replayActiveMode = hasExternalReplayConfig ? "cache" : REPLAY_MODE;
  const replayEnabledInChart = Boolean(
    effectiveReplayConfig?.enabled &&
    effectiveReplayConfig?.playing &&
    activeMode === replayActiveMode &&
    (isTradeAnchoredReplay || !hasExternalReplayConfig),
  );
  const shouldLoadTradeFocusedData = Boolean(
    tradeSid && (showEventMarkers || anchorToTradeTime || replayEnabledInChart),
  );
  const tradeRunStartTimeSec = useMemo(
    () =>
      showEventMarkers && normalizedTrades.length > 0
        ? resolveTradeRunStartSec(normalizedTrades)
        : null,
    [normalizedTrades, showEventMarkers],
  );
  const tradeRunEndTimeSec = useMemo(
    () =>
      showEventMarkers && normalizedTrades.length > 0
        ? resolveTradeRunEndSec(normalizedTrades, Math.floor(Date.now() / 1000))
        : null,
    [normalizedTrades, showEventMarkers],
  );
  const selectedTradeViewportEndTimeSec = useMemo(() => {
    if (!anchorToTradeTime) return null;
    return resolveTradeViewportEndTimeSec({
      createdAt: normalizedSelectedTrade?.createdAt ?? createdAt,
      openedAt: normalizedSelectedTrade?.openedAt ?? openedAt,
      closedAt: normalizedSelectedTrade?.closedAt ?? closedAt,
      timeframes,
    });
  }, [
    anchorToTradeTime,
    closedAt,
    createdAt,
    normalizedSelectedTrade?.closedAt,
    normalizedSelectedTrade?.createdAt,
    normalizedSelectedTrade?.openedAt,
    openedAt,
    timeframes,
  ]);
  const selectedTradeFetchEndTimeSec = useMemo(() => {
    if (Number.isFinite(tradeRunEndTimeSec) && tradeRunEndTimeSec > 0) {
      return Number(tradeRunEndTimeSec);
    }
    if (!shouldLoadTradeFocusedData) return null;
    return resolveTradeFetchEndTimeSec({
      createdAt: normalizedSelectedTrade?.createdAt ?? createdAt,
      openedAt: normalizedSelectedTrade?.openedAt ?? openedAt,
      closedAt: normalizedSelectedTrade?.closedAt ?? closedAt,
    });
  }, [
    shouldLoadTradeFocusedData,
    closedAt,
    createdAt,
    normalizedSelectedTrade?.closedAt,
    normalizedSelectedTrade?.createdAt,
    normalizedSelectedTrade?.openedAt,
    openedAt,
    tradeRunEndTimeSec,
  ]);
  const selectedTradeFetchBarsCountByTf = useMemo(() => {
    if (!shouldLoadTradeFocusedData) return null;
    const next = {};
    for (const tf of Array.isArray(timeframes) ? timeframes : []) {
      const tfKey = String(tf || "").trim().toLowerCase();
      if (!tfKey) continue;
      const requestedBarsBase =
        Number(localBarsCount) > 0
          ? Number(localBarsCount)
          : visibleBarsDefaultForTf(masterChartConfig, tf);
      const tfSeconds = Math.max(1, Number(timeframeToSeconds(tfKey)) || 60);
      const bufferBars = tradeWindowBufferBarsForTf(tfKey);
      if (
        Number.isFinite(tradeRunStartTimeSec) &&
        tradeRunStartTimeSec > 0 &&
        Number.isFinite(tradeRunEndTimeSec) &&
        tradeRunEndTimeSec > 0 &&
        tradeRunEndTimeSec >= tradeRunStartTimeSec
      ) {
        const bufferSec = tfSeconds * bufferBars;
        const fetchStartSec = Math.max(0, Number(tradeRunStartTimeSec) - bufferSec);
        const fetchEndSec = Number(tradeRunEndTimeSec) + bufferSec;
        const spanBars =
          Math.ceil(Math.max(0, fetchEndSec - fetchStartSec) / tfSeconds) + 1;
        next[tfKey] = Math.max(requestedBarsBase, spanBars);
        continue;
      }
      const anchoredBars = resolveTradeFetchBarsCount({
        createdAt: normalizedSelectedTrade?.createdAt ?? createdAt,
        openedAt: normalizedSelectedTrade?.openedAt ?? openedAt,
        closedAt: normalizedSelectedTrade?.closedAt ?? closedAt,
        timeframes: [tf],
        requestedBars: requestedBarsBase,
      });
      if (!Number.isFinite(Number(anchoredBars))) continue;
      next[tfKey] = Math.max(requestedBarsBase, Number(anchoredBars));
    }
    return Object.keys(next).length ? next : null;
  }, [
    shouldLoadTradeFocusedData,
    closedAt,
    createdAt,
    localBarsCount,
    masterChartConfig,
    normalizedSelectedTrade?.closedAt,
    normalizedSelectedTrade?.createdAt,
    normalizedSelectedTrade?.openedAt,
    openedAt,
    timeframes,
    tradeRunEndTimeSec,
    tradeRunStartTimeSec,
  ]);
  const effectiveBarsCountByTf = useMemo(() => {
    const next = {
      ...((selectedTradeFetchBarsCountByTf &&
        typeof selectedTradeFetchBarsCountByTf === "object")
        ? selectedTradeFetchBarsCountByTf
        : {}),
    };
    for (const tf of Array.isArray(timeframes) ? timeframes : []) {
      const tfKey = String(tf || "").trim().toLowerCase();
      if (!tfKey) continue;
      const chartId = `${cleanSym}-${tfKey}`;
      const manualBars = Number(manualTfVisibleBars?.[chartId]);
      const savedBars = Number(savedTfVisibleBars?.[chartId]);
      const preferredBars =
        manualBars > 0
          ? manualBars
          : savedBars > 0
            ? savedBars
            : null;
      if (!Number.isFinite(preferredBars) || preferredBars <= 0) continue;
      next[tfKey] = Math.max(
        Number(next?.[tfKey]) || 0,
        Math.round(preferredBars),
      );
    }
    return Object.keys(next).length ? next : null;
  }, [
    cleanSym,
    manualTfVisibleBars,
    savedTfVisibleBars,
    selectedTradeFetchBarsCountByTf,
    timeframes,
  ]);
  const requestedReplayStartTradeIndex = useMemo(() => {
    if (!isTradeAnchoredReplay) return 0;
    const requestedSid = String(effectiveReplayConfig?.startTradeSid || "").trim();
    if (!replayTrades.length) return 0;
    if (!requestedSid) return 0;
    const index = replayTrades.findIndex(
      (trade) => String(trade?.sid || "") === requestedSid,
    );
    return index >= 0 ? index : 0;
  }, [effectiveReplayConfig?.startTradeSid, isTradeAnchoredReplay, replayTrades]);
  const requestedReplayStartTrade = useMemo(
    () => (isTradeAnchoredReplay ? replayTrades[requestedReplayStartTradeIndex] || null : null),
    [isTradeAnchoredReplay, replayTrades, requestedReplayStartTradeIndex],
  );
  const requestedReplayLastTrade = useMemo(
    () =>
      isTradeAnchoredReplay && replayTrades.length
        ? replayTrades[replayTrades.length - 1]
        : null,
    [isTradeAnchoredReplay, replayTrades],
  );
  const replayNowAnchorKey = useMemo(
    () =>
      [
        effectiveReplayConfig?.runKey || "",
        effectiveReplayConfig?.startTradeSid || "",
        requestedReplayLastTrade?.sid || "",
      ].join("|"),
    [
      effectiveReplayConfig?.runKey,
      effectiveReplayConfig?.startTradeSid,
      requestedReplayLastTrade?.sid,
    ],
  );
  const replayNowAnchorKeyRef = useRef("");
  const [replayNowAnchorSec, setReplayNowAnchorSec] = useState(null);
  useEffect(() => {
    if (effectiveReplayConfig?.enabled && effectiveReplayConfig?.playing) return;
    replayNowAnchorKeyRef.current = "";
    setReplayNowAnchorSec(null);
  }, [effectiveReplayConfig?.enabled, effectiveReplayConfig?.playing]);
  useEffect(() => {
    if (!effectiveReplayConfig?.enabled || !effectiveReplayConfig?.playing) return;
    if (!replayNowAnchorKey) return;
    if (replayNowAnchorKeyRef.current === replayNowAnchorKey) return;
    replayNowAnchorKeyRef.current = replayNowAnchorKey;
    setReplayNowAnchorSec(Math.floor(Date.now() / 1000));
  }, [
    effectiveReplayConfig?.enabled,
    effectiveReplayConfig?.playing,
    replayNowAnchorKey,
  ]);
  const primaryReplayBaseTf = useMemo(
    () => String(sortTimeframes(timeframes, "asc")?.[0] || timeframes?.[0] || "15m"),
    [timeframes],
  );
  const replayPrimaryTfSeconds = useMemo(
    () => Math.max(1, Number(timeframeToSeconds(primaryReplayBaseTf)) || 1),
    [primaryReplayBaseTf],
  );
  const replayBufferSeconds = useMemo(() => {
    if (!backtestReplay?.enabled) {
      return Math.max(1, replayPrimaryTfSeconds) * 5;
    }
    return replayBufferSecondsForTf(primaryReplayBaseTf);
  }, [backtestReplay?.enabled, primaryReplayBaseTf, replayPrimaryTfSeconds]);
  const requestedReplayStartTimeSec = useMemo(
    () => {
      if (!requestedReplayStartTrade) return null;
      const createdSec = Number(resolveReplayTradeCreatedSec(requestedReplayStartTrade) || 0);
      if (!Number.isFinite(createdSec) || createdSec <= 0) return null;
      return Math.max(0, createdSec - replayBufferSeconds);
    },
    [replayBufferSeconds, requestedReplayStartTrade],
  );
  const requestedReplayEndTimeSec = useMemo(
    () => {
      if (!requestedReplayLastTrade) return null;
      const nowSec = Number(replayNowAnchorSec) || Math.floor(Date.now() / 1000);
      const tradeEndSec = Number(
        resolveReplayWindowEndSec(requestedReplayLastTrade, nowSec) || 0,
      );
      if (!Number.isFinite(tradeEndSec) || tradeEndSec <= 0) return null;
      const status = resolveReplayTradeStatus(requestedReplayLastTrade);
      if (["PENDING", "FILLED"].includes(status)) return tradeEndSec;
      return tradeEndSec + replayBufferSeconds;
    },
    [replayBufferSeconds, replayNowAnchorSec, requestedReplayLastTrade],
  );
  const replayAnchorEndTimeSec = replayEnabledInChart ? requestedReplayEndTimeSec : null;
  const effectiveFetchEndTimeSec = replayAnchorEndTimeSec ?? selectedTradeFetchEndTimeSec;
  const replayRequestedBarsCount = useMemo(() => {
    if (!replayEnabledInChart) return null;
    const startSec = Number(requestedReplayStartTimeSec);
    const endSec = Number(requestedReplayEndTimeSec);
    if (
      !Number.isFinite(startSec) ||
      !Number.isFinite(endSec) ||
      !Number.isFinite(replayPrimaryTfSeconds) ||
      replayPrimaryTfSeconds <= 0
    ) {
      return null;
    }
    const spanBars = Math.ceil(Math.max(0, endSec - startSec) / replayPrimaryTfSeconds);
    return Math.max(150, Math.min(5000, spanBars + 1));
  }, [
    replayEnabledInChart,
    replayPrimaryTfSeconds,
    requestedReplayEndTimeSec,
    requestedReplayStartTimeSec,
  ]);
  const effectiveBarsCount =
    replayEnabledInChart && Number.isFinite(Number(replayRequestedBarsCount))
      ? Math.max(
          SYMBOL_CHART_MIN_LOADED_BARS,
          Number(localBarsCount) || 0,
          Number(replayRequestedBarsCount),
        )
      : Math.max(SYMBOL_CHART_MIN_LOADED_BARS, Number(localBarsCount) || 0);
  const requestedDataTimeframes = useMemo(
    () =>
      buildRequestedDataTimeframes(
        [
          ...(Array.isArray(timeframes) ? timeframes : []),
          ...(Array.isArray(extraRequestedTimeframes) ? extraRequestedTimeframes : []),
        ],
        true,
      ),
    [extraRequestedTimeframes, timeframes],
  );
  const internalRealtimeChartData = useRealtimeSymbolChartMatrix({
    enabled: isStreamingMode && !isReplayMode && !externalChartData && !replayEnabledInChart,
    symbol: cleanSym,
    timeframes: requestedDataTimeframes,
    bars: effectiveBarsCount,
  });
  const effectiveExternalChartData =
    externalChartData ||
    (isStreamingMode && !isReplayMode && !replayEnabledInChart ? internalRealtimeChartData : null);
  const requestedBarsCountByTf = useMemo(() => {
    const next =
      effectiveBarsCountByTf && typeof effectiveBarsCountByTf === "object"
        ? { ...effectiveBarsCountByTf }
        : {};
    const fallbackBars = Math.max(
      SYMBOL_CHART_MIN_LOADED_BARS,
      Number(effectiveBarsCount) || 0,
    );
    for (const tfKey of requestedDataTimeframes) {
      next[tfKey] = Math.max(Number(next?.[tfKey]) || 0, fallbackBars);
    }
    return Object.keys(next).length ? next : null;
  }, [effectiveBarsCount, effectiveBarsCountByTf, requestedDataTimeframes]);

  const replayFrozenChartDataRef = useRef(null);
  const frozenLiveBarsChartDataRef = useRef(null);
  const lastChartDataWithBarsRef = useRef(null);
  const [replaySeedCaptured, setReplaySeedCaptured] = useState(false);
  const isGenericChartReplay = isReplayMode && !hasExternalReplayConfig;
  const replayDisablesLive = isReplayMode || replayEnabledInChart;
  const effectiveLiveBarsEnabled = liveBarsEnabled && !replayDisablesLive;
  const canFreezeReplayChartData =
    isGenericChartReplay &&
    !externalChartData &&
    replaySeedCaptured &&
    replayFrozenChartDataRef.current;
  const internalChartData = useSymbolChartData({
    symbol: cleanSym,
    timeframes: requestedDataTimeframes,
    mode: activeDataMode,
    liveBars: effectiveLiveBarsEnabled,
    barsCount: effectiveBarsCount,
    barsCountByTf: replayEnabledInChart ? null : requestedBarsCountByTf,
    forceRefresh,
    skipFetch:
      skipFetch ||
      Boolean(effectiveExternalChartData) ||
      Boolean(canFreezeReplayChartData),
    provider,
    sessionPrefix,
    attachedSnapshotFiles,
    profile,
    tradeSid:
      shouldLoadTradeFocusedData ? tradeSid : "",
    endTimeSec: effectiveFetchEndTimeSec,
  });
  const liveChartData = effectiveExternalChartData || internalChartData;
  useEffect(() => {
    if (!liveChartData) return;
    if (!chartDataHasBars(liveChartData)) return;
    lastChartDataWithBarsRef.current = liveChartData;
  }, [liveChartData]);
  useEffect(() => {
    if (liveBarsEnabled) return;
    if (activeDataMode !== "cache") return;
    const nextFrozenChartData =
      chartDataHasBars(liveChartData) ? liveChartData : lastChartDataWithBarsRef.current;
    if (!nextFrozenChartData) return;
    if (!frozenLiveBarsChartDataRef.current) {
      frozenLiveBarsChartDataRef.current = nextFrozenChartData;
    }
  }, [activeDataMode, liveBarsEnabled, liveChartData]);
  useEffect(() => {
    if (!liveChartData) return;
    if (!isReplayMode) {
      replayFrozenChartDataRef.current = liveChartData;
      setReplaySeedCaptured(chartDataHasBars(liveChartData));
      return;
    }
    if (!isGenericChartReplay) return;
    if (externalChartData) return;
    if (replaySeedCaptured) return;
    if (!chartDataHasBars(liveChartData)) return;
    replayFrozenChartDataRef.current = liveChartData;
    setReplaySeedCaptured(true);
  }, [
    externalChartData,
    isGenericChartReplay,
    isReplayMode,
    liveChartData,
    replaySeedCaptured,
  ]);
  const resolvedChartData =
    canFreezeReplayChartData
      ? replayFrozenChartDataRef.current
      : !replayEnabledInChart &&
          !isReplayMode &&
          !effectiveLiveBarsEnabled &&
          activeDataMode === "cache" &&
          frozenLiveBarsChartDataRef.current
        ? frozenLiveBarsChartDataRef.current
        : liveChartData;
  const {
    status,
    master,
    error,
    cachedAt,
    refresh,
    refreshTf,
    liveKey,
    snapshotState,
  } = resolvedChartData;
  const autoLoadKeyRef = useRef("");
  const backgroundRefreshKeyRef = useRef("");

  const sortedTfs = useMemo(
    () => sortTimeframes(timeframes, "desc"),
    [timeframes],
  );
  const multiTfAnalysisFallbackSignature = useMemo(() => {
    const barsByTf =
      master?.bars && typeof master.bars === "object" && !Array.isArray(master.bars)
        ? master.bars
        : {};
    const tfKeys = sortTimeframes(Object.keys(barsByTf), "desc");
    return tfKeys
      .map((tf) => {
        const bars = Array.isArray(barsByTf?.[tf]) ? barsByTf[tf] : [];
        const firstTime = Number(bars?.[0]?.time || 0);
        const lastBar = bars.length ? bars[bars.length - 1] : null;
        const lastTime = Number(lastBar?.time || 0);
        const lastClose = Number(lastBar?.close || 0);
        return `${tf}:${bars.length}:${firstTime}:${lastTime}:${lastClose}`;
      })
      .join("|");
  }, [master?.bars]);
  const multiTfAnalysisByTf = useMemo(() => {
    if (replayDisablesLive) return {};
    const streamedAnalysis =
      master?.analysis && typeof master.analysis === "object" && !Array.isArray(master.analysis)
        ? master.analysis
        : null;
    if (streamedAnalysis && Object.keys(streamedAnalysis).length) {
      return streamedAnalysis;
    }
    const barsByTf =
      master?.bars && typeof master.bars === "object" && !Array.isArray(master.bars)
        ? master.bars
        : {};
    const availableBarsByTf = Object.fromEntries(
      Object.entries(barsByTf).filter(([, bars]) => Array.isArray(bars) && bars.length > 0),
    );
    if (!Object.keys(availableBarsByTf).length) return {};
    return buildMultiTfAnalysis(availableBarsByTf);
  }, [master?.analysis, master?.bars, multiTfAnalysisFallbackSignature, replayDisablesLive]);
  const analysisOrderedTfs = useMemo(() => {
    const analysisKeys = Object.keys(
      multiTfAnalysisByTf &&
        typeof multiTfAnalysisByTf === "object" &&
        !Array.isArray(multiTfAnalysisByTf)
        ? multiTfAnalysisByTf
        : {},
    );
    if (analysisKeys.length) return sortTimeframes(analysisKeys, "desc");
    return sortedTfs;
  }, [multiTfAnalysisByTf, sortedTfs]);
  const requestedSortedTfs = useMemo(
    () => sortTimeframes(requestedDataTimeframes, "desc"),
    [requestedDataTimeframes],
  );
  const chartTopicKey = useMemo(() => buildChartTopicKey(cleanSym), [cleanSym]);
  const primaryDebugTf = useMemo(
    () =>
      String(sortTimeframes(timeframes, "asc")?.[0] || timeframes?.[0] || "1m")
        .trim()
        .toLowerCase(),
    [timeframes],
  );
  const primaryDebugBars = Array.isArray(getTimeframeValue(master?.bars, primaryDebugTf))
    ? getTimeframeValue(master?.bars, primaryDebugTf)
    : [];
  const primaryDebugLastBarSec =
    Number(primaryDebugBars?.[primaryDebugBars.length - 1]?.time || 0) || 0;
  const hasVisibleBars = useMemo(
    () =>
      (sortedTfs || []).some((tf) => {
        const bars = Array.isArray(getTimeframeValue(master?.bars, tf))
          ? getTimeframeValue(master?.bars, tf)
          : [];
        return bars.length > 0;
      }),
    [master, sortedTfs],
  );
  const hasVisibleSnapshots = useMemo(
    () =>
      (sortedTfs || []).some((tf) => {
        return Boolean(getTimeframeValue(master?.snapshots, tf));
      }),
    [master, sortedTfs],
  );
  useEffect(() => {
    if (!shouldBootstrapLiveBars || hasCompletedLiveBarsBootstrap) return;
    if (!hasVisibleBars && primaryDebugLastBarSec <= 0) return;
    setLiveBarsEnabled(false);
    setHasCompletedLiveBarsBootstrap(true);
  }, [
    hasCompletedLiveBarsBootstrap,
    hasVisibleBars,
    primaryDebugLastBarSec,
    shouldBootstrapLiveBars,
  ]);
  useEffect(() => {
    if (!cleanSym) {
      lastRenderableBarsByChartIdRef.current = {};
      return;
    }
    const nextCache = { ...lastRenderableBarsByChartIdRef.current };
    let changed = false;
    (sortedTfs || []).forEach((tf) => {
      const chartId = `${cleanSym}-${String(tf || "").trim().toLowerCase()}`;
      const tfKey = String(tf || "").trim().toLowerCase();
      if (!chartId || !tfKey) return;
      const barsForTf = getTimeframeValue(master?.bars, tfKey) || [];
      if (barsForTf.length > 0) {
        nextCache[chartId] = barsForTf;
        changed = true;
      }
    });
    if (changed) {
      lastRenderableBarsByChartIdRef.current = nextCache;
    }
  }, [cleanSym, master?.bars, sortedTfs]);
  useEffect(() => {
    if (isReplayMode) {
      setLiveDebugTopicState(null);
      return undefined;
    }
    if (!chartTopicKey) {
      setLiveDebugTopicState(null);
      return undefined;
    }
    setLiveDebugTopicState(chartStreamStore.getState(chartTopicKey));
    return chartStreamStore.subscribe(chartTopicKey, (state) => {
      setLiveDebugTopicState(state);
    });
  }, [chartTopicKey, isReplayMode]);
  useEffect(() => {
    if (isReplayMode) {
      setLiveDebugHealth(null);
      setLiveDebugHealthError("");
      return undefined;
    }
    if (!cleanSym) {
      setLiveDebugHealth(null);
      setLiveDebugHealthError("");
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const response = await api.health();
        if (cancelled) return;
        setLiveDebugHealth(response || null);
        setLiveDebugHealthError("");
      } catch (error) {
        if (cancelled) return;
        setLiveDebugHealthError(String(error?.message || error || "Health check failed"));
      }
    };
    load().catch(() => {});
    const timer = window.setInterval(() => {
      load().catch(() => {});
    }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [cleanSym, isReplayMode]);
  useEffect(() => {
    if (!showLiveDebugMenu) return undefined;
    const handlePointerDown = (event) => {
      if (liveDebugMenuRef.current?.contains(event.target)) return;
      setShowLiveDebugMenu(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [showLiveDebugMenu]);
  const normalizedSelectedTfs = useMemo(
    () =>
      sortTimeframes(
        (Array.isArray(timeframes) ? timeframes : [])
          .map((tf) =>
            String(tf || "")
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean),
        "desc",
      ),
    [timeframes],
  );
  const activeTimeframePreset = useMemo(() => {
    const selectedKey = normalizedSelectedTfs.join("|");
    return (
      (Array.isArray(timeframePresets) ? timeframePresets : []).find((preset) => {
        const presetKey = sortTimeframes(
          (Array.isArray(preset?.tfs) ? preset.tfs : [])
            .map((tf) =>
              String(tf || "")
                .trim()
                .toLowerCase(),
            )
            .filter(Boolean),
          "desc",
        ).join("|");
        return presetKey && presetKey === selectedKey;
      }) || null
    );
  }, [normalizedSelectedTfs, timeframePresets]);
  const timeframeSummaryLabel = useMemo(() => {
    if (activeTimeframePreset?.label) return activeTimeframePreset.label;
    const labels = normalizedSelectedTfs.map((tf) => {
      const matched = (Array.isArray(timeframeOptions) ? timeframeOptions : []).find(
        (option) =>
          String(option?.value || "")
            .trim()
            .toLowerCase() === tf,
      );
      return matched?.label || tf;
    });
    return labels.length ? labels.join(" / ") : "Select TFs";
  }, [activeTimeframePreset, normalizedSelectedTfs, timeframeOptions]);

  useEffect(() => {
    if (!timeframeMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!timeframeMenuRef.current) return;
      if (timeframeMenuRef.current.contains(event.target)) return;
      setTimeframeMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [timeframeMenuOpen]);
  const primaryReplayTf = useMemo(
    () => String(primaryReplayBaseTf || "").trim().toLowerCase(),
    [primaryReplayBaseTf],
  );
  const primaryReplayBars = useMemo(() => {
    if (!primaryReplayTf) return [];
    return Array.isArray(master?.bars?.[primaryReplayTf])
      ? master.bars[primaryReplayTf]
      : [];
  }, [master, primaryReplayTf]);
  const effectiveReplayStartTimeSec = useMemo(() => {
    if (Number.isFinite(Number(requestedReplayStartTimeSec))) {
      return Number(requestedReplayStartTimeSec);
    }
    const firstTime = Number(primaryReplayBars?.[0]?.time || 0);
    return Number.isFinite(firstTime) && firstTime > 0 ? firstTime : null;
  }, [primaryReplayBars, requestedReplayStartTimeSec]);
  const effectiveReplayEndTimeSec = useMemo(() => {
    if (Number.isFinite(Number(requestedReplayEndTimeSec))) {
      return Number(requestedReplayEndTimeSec);
    }
    const lastTime = Number(primaryReplayBars?.[primaryReplayBars.length - 1]?.time || 0);
    if (!Number.isFinite(lastTime) || lastTime <= 0) return null;
    return lastTime + Math.max(1, Number(replayPrimaryTfSeconds) || 1) - 1;
  }, [primaryReplayBars, replayPrimaryTfSeconds, requestedReplayEndTimeSec]);
  const isBacktestChartReplay = replayEnabledInChart;
  const [chartReplayCursorIndex, setChartReplayCursorIndex] = useState(-1);
  const replayWindowIndices = useMemo(() => {
    if (!isBacktestChartReplay || !primaryReplayBars.length) {
      return {
        ready: false,
        startIndex: -1,
        endIndex: -1,
      };
    }
    const startIndex = Math.max(
      0,
      findBarIndexAtOrAfter(primaryReplayBars, effectiveReplayStartTimeSec),
    );
    const requestedEndIndex = findBarIndexAtOrBefore(
      primaryReplayBars,
      effectiveReplayEndTimeSec,
    );
    const endIndex =
      requestedEndIndex >= 0
        ? Math.max(startIndex, requestedEndIndex)
        : Math.max(primaryReplayBars.length - 1, startIndex);
    return {
      ready: endIndex >= startIndex && startIndex >= 0,
      startIndex,
      endIndex,
    };
  }, [
    isBacktestChartReplay,
    effectiveReplayEndTimeSec,
    effectiveReplayStartTimeSec,
    primaryReplayBars,
  ]);
  const chartModes = initialChartModes;

  useEffect(() => {
    if (typeof onModeChangeRef.current === "function") {
      onModeChangeRef.current(activeMode);
    }
  }, [activeMode]);

  useEffect(() => {
    if (!syncModeWithLocationHash) return undefined;
    if (typeof window === "undefined") return undefined;
    const applyHashMode = () => {
      const nextMode = resolveModeFromHash(
        window.location.hash,
        chartModes,
        defaultMode,
      );
      setMode((currentMode) => (currentMode === nextMode ? currentMode : nextMode));
      setPendingMode(null);
      setLastError(null);
    };
    applyHashMode();
    window.addEventListener("hashchange", applyHashMode);
    return () => window.removeEventListener("hashchange", applyHashMode);
  }, [chartModes, defaultMode, syncModeWithLocationHash]);

  useEffect(() => {
    if (!syncModeWithLocationHash) return;
    if (typeof window === "undefined") return;
    const nextHash = MODE_HASH_BY_VALUE[mode] || MODE_HASH_BY_VALUE[defaultMode] || "";
    if (!nextHash || window.location.hash === nextHash) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
  }, [defaultMode, mode, syncModeWithLocationHash]);

  const finalizeReplay = useCallback(() => {
    if (typeof effectiveReplayConfig?.onComplete === "function") {
      effectiveReplayConfig.onComplete();
    }
    setPendingMode(null);
    setLastError(null);
    setMode("cache");
  }, [effectiveReplayConfig]);

  const enterReplayMode = useCallback(() => {
    setPendingMode(null);
    setLastError(null);
    if (syncModeWithLocationHash && typeof window !== "undefined") {
      const replayHash = MODE_HASH_BY_VALUE[REPLAY_MODE] || "#chart-replay";
      const nextUrl = `${window.location.pathname}${window.location.search}${replayHash}`;
      if (window.location.hash !== replayHash) {
        window.history.replaceState(null, "", nextUrl);
      }
    }
    setMode(REPLAY_MODE);
  }, [syncModeWithLocationHash]);

  const replayAutoStartKeyRef = useRef("");
  useEffect(() => {
    if (!effectiveAutoStartReplay) return;
    if (!effectiveReplayConfig?.enabled) return;
    if (mode !== replayActiveMode) return;
    if (effectiveReplayConfig?.playing) return;
    const canAutoStartReplay = isTradeAnchoredReplay
      ? replayTrades.length > 0
      : primaryReplayBars.length > 1;
    if (!canAutoStartReplay) return;
    const autoStartKey = [
      effectiveReplayConfig?.runKey || "",
      effectiveReplayConfig?.startTradeSid || "",
    ].join("|");
    if (!autoStartKey) return;
    if (replayAutoStartKeyRef.current === autoStartKey) return;
    replayAutoStartKeyRef.current = autoStartKey;
    effectiveReplayConfig?.onToggle?.();
  }, [
    effectiveAutoStartReplay,
    effectiveReplayConfig,
    isTradeAnchoredReplay,
    mode,
    primaryReplayBars.length,
    replayActiveMode,
    replayTrades.length,
  ]);

  useEffect(() => {
    setChartReplayCursorIndex(-1);
  }, [effectiveReplayConfig?.runKey, effectiveReplayConfig?.startTradeSid, isBacktestChartReplay]);

  useEffect(() => {
    if (!isBacktestChartReplay) return;
    if (!replayWindowIndices.ready) return;
    setChartReplayCursorIndex(replayWindowIndices.startIndex);
  }, [
    effectiveReplayConfig?.runKey,
    isBacktestChartReplay,
    replayWindowIndices.ready,
    replayWindowIndices.startIndex,
  ]);

  const hasReplayCursor = chartReplayCursorIndex >= 0;

  useEffect(() => {
    if (!isBacktestChartReplay) return;
    if (!replayWindowIndices.ready) return;
    if (!hasReplayCursor) return;
    const lastReplayIndex = Math.max(0, replayWindowIndices.endIndex);
    let finalizeScheduled = false;

    const timer = window.setInterval(() => {
      setChartReplayCursorIndex((prev) => {
        const safePrev = Math.max(Number(prev) || 0, 0);
        if (safePrev >= lastReplayIndex) {
          if (!finalizeScheduled) {
            finalizeScheduled = true;
            window.setTimeout(() => {
              finalizeReplay();
            }, 0);
          }
          return safePrev;
        }
        const next = Math.min(safePrev + 1, lastReplayIndex);
        if (next >= lastReplayIndex && !finalizeScheduled) {
          finalizeScheduled = true;
          window.setTimeout(() => {
            finalizeReplay();
          }, 0);
        }
        return next;
      });
    }, Math.max(100, Number(effectiveReplayConfig?.speedMs) || 1000));

    return () => window.clearInterval(timer);
  }, [
    finalizeReplay,
    hasReplayCursor,
    isBacktestChartReplay,
    effectiveReplayConfig?.speedMs,
    replayWindowIndices.endIndex,
    replayWindowIndices.ready,
  ]);
  const wasReplayPlayingRef = useRef(false);
  useEffect(() => {
    const isPlaying = Boolean(
      effectiveReplayConfig?.enabled &&
        effectiveReplayConfig?.playing &&
        mode === replayActiveMode,
    );
    if (
      isPlaying &&
      !wasReplayPlayingRef.current &&
      replayWindowIndices.ready &&
      Number.isFinite(Number(replayWindowIndices.startIndex)) &&
      (
        chartReplayCursorIndex < 0 ||
        chartReplayCursorIndex >= Math.max(0, replayWindowIndices.endIndex)
      )
    ) {
      setChartReplayCursorIndex(Math.max(0, replayWindowIndices.startIndex));
    }
    wasReplayPlayingRef.current = isPlaying;
  }, [
    chartReplayCursorIndex,
    effectiveReplayConfig?.enabled,
    effectiveReplayConfig?.playing,
    mode,
    replayActiveMode,
    replayWindowIndices.endIndex,
    replayWindowIndices.ready,
    replayWindowIndices.startIndex,
  ]);

  const replayCurrentTimeSec = useMemo(() => {
    if (!isBacktestChartReplay) return null;
    if (!primaryReplayBars.length) return null;
    if (chartReplayCursorIndex < 0) return null;
    const currentBar =
      primaryReplayBars[
        Math.max(0, Math.min(chartReplayCursorIndex, primaryReplayBars.length - 1))
      ] || null;
    const currentTime = Number(currentBar?.time);
    return Number.isFinite(currentTime) ? currentTime : null;
  }, [chartReplayCursorIndex, isBacktestChartReplay, primaryReplayBars]);
  const replayClockTimeSec = useMemo(() => {
    if (!Number.isFinite(replayCurrentTimeSec)) return null;
    return (
      Number(replayCurrentTimeSec) +
      Math.max(1, Number(replayPrimaryTfSeconds) || 1) -
      1
    );
  }, [replayCurrentTimeSec, replayPrimaryTfSeconds]);
  const replayClockLabel = useMemo(() => {
    if (!Number.isFinite(replayClockTimeSec)) return "";
    return showDateTime(Number(replayClockTimeSec) * 1000);
  }, [replayClockTimeSec]);
  const replayBarProgressText = useMemo(() => {
    if (!isBacktestChartReplay || !replayWindowIndices.ready) return "";
    const startIndex = Math.max(0, Number(replayWindowIndices.startIndex) || 0);
    const endIndex = Math.max(
      startIndex,
      Number(replayWindowIndices.endIndex) || startIndex,
    );
    const currentIndex = Math.max(
      startIndex,
      Math.min(Number(chartReplayCursorIndex) || startIndex, endIndex),
    );
    return `${currentIndex - startIndex + 1}/${endIndex - startIndex + 1} bars`;
  }, [
    chartReplayCursorIndex,
    isBacktestChartReplay,
    replayWindowIndices.endIndex,
    replayWindowIndices.ready,
    replayWindowIndices.startIndex,
  ]);
  const activeReplayTrade = useMemo(() => {
    if (!isBacktestChartReplay) return null;
    if (!replayTrades.length) return null;
    const replayTime = Number(replayClockTimeSec);
    if (!Number.isFinite(replayTime) || replayTime <= 0) return null;
    let nextActiveTrade = null;
    for (let index = requestedReplayStartTradeIndex; index < replayTrades.length; index += 1) {
      const trade = replayTrades[index];
      const createdSec = resolveReplayTradeCreatedSec(trade);
      if (!Number.isFinite(createdSec) || createdSec <= 0) continue;
      if (createdSec <= replayTime) {
        nextActiveTrade = trade;
        continue;
      }
      break;
    }
    return nextActiveTrade;
  }, [
    isBacktestChartReplay,
    replayTrades,
    replayClockTimeSec,
    requestedReplayStartTradeIndex,
  ]);

  useEffect(() => {
    if (typeof onReplayActiveTradeChangeRef.current !== "function") return;
    if (!isBacktestChartReplay) return;
    onReplayActiveTradeChangeRef.current(activeReplayTrade?.sid || "");
  }, [activeReplayTrade?.sid, isBacktestChartReplay]);
  const lastTradeViewportFocusSidRef = useRef("");
  useEffect(() => {
    lastTradeViewportFocusSidRef.current = "";
  }, [cleanSym, tradeLabel]);

  const effectiveOverlayTrade =
    replayEnabledInChart
      ? activeReplayTrade
      : normalizedSelectedTrade;
  const effectiveTradeSid = String(
    effectiveOverlayTrade?.sid || tradeSid || "",
  );
  const effectiveTradeLabel = String(
    effectiveOverlayTrade?.tradeLabel || tradeLabel || "",
  ).trim();
  const effectiveTradeSide = String(
    effectiveOverlayTrade?.side || effectiveOverlayTrade?.action || action || side || "",
  ).trim();
  const effectiveEntryPrice = effectiveOverlayTrade?.entry ?? entryPrice;
  const effectiveTpPrice = effectiveOverlayTrade?.tp ?? tpPrice;
  const effectiveSlPrice = effectiveOverlayTrade?.sl ?? slPrice;
  const effectiveCreatedAt = effectiveOverlayTrade?.createdAt ?? createdAt;
  const effectiveOpenedAt = effectiveOverlayTrade?.openedAt ?? openedAt;
  const effectiveClosedAt = effectiveOverlayTrade?.closedAt ?? closedAt;
  const effectiveCreatedAtSec =
    effectiveOverlayTrade?.createdAtSec ?? toEpochSec(effectiveCreatedAt);
  const effectiveOpenedAtSec =
    effectiveOverlayTrade?.openedAtSec ?? toEpochSec(effectiveOpenedAt);
  const effectiveClosedAtSec =
    effectiveOverlayTrade?.closedAtSec ?? toEpochSec(effectiveClosedAt);
  const hasExplicitClosedEvent = Boolean(
    effectiveOverlayTrade?.closedAt ||
      (Number.isFinite(Number(effectiveOverlayTrade?.closedAtSec)) &&
        Number(effectiveOverlayTrade?.closedAtSec) > 0) ||
      effectiveClosedAt ||
      (Number.isFinite(Number(effectiveClosedAtSec)) &&
        Number(effectiveClosedAtSec) > 0),
  );
  const effectiveCloseStatus = String(
    hasExplicitClosedEvent
      ? effectiveOverlayTrade?.closeStatus || closeStatus || ""
      : "",
  );
  const effectiveExitPrice = hasExplicitClosedEvent
    ? effectiveOverlayTrade?.exitPrice ?? exitPrice
    : null;
  const effectivePnlRealized = hasExplicitClosedEvent
    ? effectiveOverlayTrade?.pnlRealized ?? pnlRealized
    : null;
  const preferTradeAnchoredViewport = useMemo(() => {
    if (isBacktestChartReplay || !anchorToTradeTime) return false;
    return (
      (Number.isFinite(Number(effectiveCreatedAtSec)) &&
        Number(effectiveCreatedAtSec) > 0) ||
      (Number.isFinite(Number(effectiveOpenedAtSec)) &&
        Number(effectiveOpenedAtSec) > 0) ||
      (Number.isFinite(Number(effectiveClosedAtSec)) &&
        Number(effectiveClosedAtSec) > 0)
    );
  }, [
    anchorToTradeTime,
    effectiveClosedAtSec,
    effectiveCreatedAtSec,
    effectiveOpenedAtSec,
    isBacktestChartReplay,
  ]);

  const effectiveTradeOverlayRenderKey = useMemo(
    () =>
      [
        effectiveTradeSid,
        effectiveCreatedAt || "",
        effectiveOpenedAt || "",
        effectiveClosedAt || "",
        effectiveExitPrice ?? "",
        effectiveCloseStatus || "",
        effectivePnlRealized ?? "",
      ].join("|"),
    [
      effectiveCloseStatus,
      effectiveClosedAt,
      effectiveCreatedAt,
      effectiveExitPrice,
      effectiveOpenedAt,
      effectivePnlRealized,
      effectiveTradeSid,
    ],
  );
  const disableViewportPersistence = Boolean(
    anchorToTradeTime && !isBacktestChartReplay,
  );

  useEffect(() => {
    if (isBacktestChartReplay || !showEventMarkers) return;
    const selectedSid = String(effectiveTradeSid || "").trim();
    if (!selectedSid) return;
    if (lastTradeViewportFocusSidRef.current === selectedSid) return;
    lastTradeViewportFocusSidRef.current = selectedSid;
    const tfKeys = (Array.isArray(timeframes) ? timeframes : [])
      .map((tf) => String(tf || "").trim().toLowerCase())
      .filter(Boolean);
    if (!cleanSym || !tfKeys.length) return;
    setViewportCommandByChartId((prev) => {
      const next = { ...(prev || {}) };
      const nonceBase = Date.now();
      tfKeys.forEach((tfKey, index) => {
        next[`${cleanSym}-${tfKey}`] = {
          action: "fit_trade",
          nonce: nonceBase + index,
        };
      });
      return next;
    });
  }, [
    cleanSym,
    effectiveTradeSid,
    isBacktestChartReplay,
    showEventMarkers,
    timeframes,
  ]);

  const barsCachedAt = useMemo(() => {
    const hasBars = Object.values(master?.bars || {}).some(
      (b) => Array.isArray(b) && b.length > 0,
    );
    return hasBars ? master?.cached_at || cachedAt : null;
  }, [master, cachedAt]);

  const snapsCachedAt = useMemo(() => {
    const hasSnaps = Object.values(master?.snapshots || {}).some(
      (s) => s?.uploaded_at,
    );
    if (!hasSnaps) return null;
    let latest = 0;
    for (const s of Object.values(master?.snapshots || {})) {
      if (s?.uploaded_at && s.uploaded_at > latest) latest = s.uploaded_at;
    }
    return latest || null;
  }, [master]);

  useEffect(() => {
    if (
      (isReplayMode && canFreezeReplayChartData) ||
      !autoLoadOnMount ||
      !cleanSym ||
      skipFetch ||
      isCacheLikeMode
    ) {
      return;
    }
    if (anchorToTradeTime && !isBacktestChartReplay) return;
    if (mode === "live" || pendingMode) return;
    if (hasVisibleBars || hasVisibleSnapshots || status === "LOADING") return;
    const loadKey = [
      cleanSym,
      mode,
      tradeSid,
      timeframes.join(","),
      localBarsCount,
    ].join("|");
    if (autoLoadKeyRef.current === loadKey) return;
    autoLoadKeyRef.current = loadKey;
    refresh({ force: true }).catch(() => {});
  }, [
    autoLoadOnMount,
    canFreezeReplayChartData,
    cleanSym,
    isReplayMode,
    anchorToTradeTime,
    isBacktestChartReplay,
    skipFetch,
    mode,
    pendingMode,
    master,
    status,
    tradeSid,
    timeframes,
    localBarsCount,
    isCacheLikeMode,
    refresh,
    hasVisibleBars,
    hasVisibleSnapshots,
  ]);

  const autoHydrateCacheKeyRef = useRef("");
  const hasAttemptedAutoLoad = Boolean(autoLoadKeyRef.current);
  useEffect(() => {
    if (
      (isReplayMode && canFreezeReplayChartData) ||
      !cleanSym ||
      skipFetch ||
      !isCacheLikeMode ||
      status === "LOADING"
    ) {
      return;
    }
    if (anchorToTradeTime && !isBacktestChartReplay) return;
    if (hasVisibleBars) return;
    const cacheKey = [
      cleanSym,
      tradeSid,
      timeframes.join(","),
      localBarsCount,
    ].join("|");
    if (autoHydrateCacheKeyRef.current === cacheKey) return;
    autoHydrateCacheKeyRef.current = cacheKey;
    refresh({ force: true }).catch(() => {});
  }, [
    cleanSym,
    canFreezeReplayChartData,
    isReplayMode,
    anchorToTradeTime,
    isBacktestChartReplay,
    skipFetch,
    mode,
    isCacheLikeMode,
    status,
    master,
    tradeSid,
    timeframes,
    localBarsCount,
    refresh,
    hasVisibleBars,
  ]);

  useEffect(() => {
    if (
      (isReplayMode && canFreezeReplayChartData) ||
      !cleanSym ||
      skipFetch ||
      !isCacheLikeMode ||
      mode === "live" ||
      pendingMode ||
      status === "LOADING"
    ) {
      return;
    }
    if (anchorToTradeTime && !isBacktestChartReplay) return;
    if (!hasVisibleBars) return;
    const refreshKey = [
      cleanSym,
      mode,
      tradeSid,
      timeframes.join(","),
      localBarsCount,
    ].join("|");
    if (backgroundRefreshKeyRef.current === refreshKey) return;
    backgroundRefreshKeyRef.current = refreshKey;
    refresh({ force: true }).catch(() => {});
  }, [
    cleanSym,
    canFreezeReplayChartData,
    isReplayMode,
    anchorToTradeTime,
    isBacktestChartReplay,
    skipFetch,
    isCacheLikeMode,
    mode,
    pendingMode,
    status,
    master,
    tradeSid,
    timeframes,
    localBarsCount,
    refresh,
    hasVisibleBars,
  ]);

  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "LOADING" && status !== "LOADING") {
      if (status === "READY" || status === "STALE") {
        if (pendingMode) {
          setMode(pendingMode);
          setPendingMode(null);
        }
        setLastError(null);
      } else if (status === "ERROR") {
        setLastError(error || "Fetch failed");
        if (pendingMode) {
          setMode(pendingMode);
          setPendingMode(null);
        }
      }
    }
    prevStatus.current = status;
  }, [status, error, pendingMode]);

  useEffect(() => {
    if (!isCacheLikeMode) setEditObjects(false);
  }, [isCacheLikeMode, mode]);

  const [loadedTfs, setLoadedTfs] = useState({}); // { tf: count }
  const handleBarsLoaded = useCallback((tf, count) => {
    const key = String(tf || "").toLowerCase();
    const nextCount = Number(count) || 0;
    setLoadedTfs((prev) =>
      Number(prev?.[key] || 0) === nextCount
        ? prev
        : { ...prev, [key]: nextCount },
    );
  }, []);

  const hasAnyBars = useMemo(() => {
    const fromMaster = Object.values(master?.bars || {}).some(
      (b) => Array.isArray(b) && b.length > 0,
    );
    const fromReports = Object.values(loadedTfs).some((c) => c > 0);
    return fromMaster || fromReports;
  }, [master, loadedTfs]);

  const expectedLoadedTfKeys = useMemo(
    () =>
      (sortedTfs || [])
        .map((tf) => String(tf || "").trim().toLowerCase())
        .filter((tf) => {
          const bars = Array.isArray(master?.bars?.[tf]) ? master.bars[tf] : [];
          return bars.length > 0;
        }),
    [master, sortedTfs],
  );

  const areAllRenderedChartsLoaded = useMemo(() => {
    if (!expectedLoadedTfKeys.length) return false;
    return expectedLoadedTfKeys.every((tf) => Number(loadedTfs?.[tf] || 0) > 0);
  }, [expectedLoadedTfKeys, loadedTfs]);

  const areBootstrapArtifactsLoaded = useMemo(() => {
    if (!expectedLoadedTfKeys.length) return false;
    return expectedLoadedTfKeys.every((tf) => {
      const loadedAt = artifactLoadStateByTf?.[tf]?.loadedAt;
      return Number.isFinite(Number(loadedAt)) && Number(loadedAt) > 0;
    });
  }, [artifactLoadStateByTf, expectedLoadedTfKeys]);

  useEffect(() => {
    if (!shouldBootstrapLiveBars || !hasCompletedLiveBarsBootstrap) return;
    if (liveBarsEnabled) return;
    if (hasAutoExpandedBootstrapViewRef.current) return;
    if (!areAllRenderedChartsLoaded) return;
    if (!areBootstrapArtifactsLoaded) return;
    const targetTfs = expectedLoadedTfKeys.filter(Boolean);
    if (!targetTfs.length) return;
    const timer = window.setTimeout(() => {
      hasAutoExpandedBootstrapViewRef.current = true;
      setViewportCommandByChartId((prev) => {
        const next = { ...(prev || {}) };
        targetTfs.forEach((tfKey, index) => {
          const chartId = `${cleanSym}-${tfKey}`;
          next[chartId] = {
            action: "show_all_loaded",
            nonce: Date.now() + index,
          };
        });
        return next;
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    areBootstrapArtifactsLoaded,
    areAllRenderedChartsLoaded,
    cleanSym,
    expectedLoadedTfKeys,
    hasCompletedLiveBarsBootstrap,
    liveBarsEnabled,
    shouldBootstrapLiveBars,
  ]);

  useEffect(() => {
    if (!isCacheLikeMode || pendingMode || !liveBarsEnabled) return;
    if (!(status === "READY" || status === "STALE")) return;
    if (!hasAnyBars) return;
    if (!areAllRenderedChartsLoaded) return;
    const barsSignature = sortedTfs
      .map((tf) => {
        const key = String(tf || "").trim().toLowerCase();
        const bars = Array.isArray(master?.bars?.[key]) ? master.bars[key] : [];
        return `${key}:${bars.length}:${bars[bars.length - 1]?.time || 0}`;
      })
      .join("|");
    const fixKey = [
      cleanSym,
      tradeSid || "",
      mode,
      pendingMode || "",
      status,
      barsCachedAt || 0,
      barsSignature,
    ].join("|");
    if (viewportAutoFitKeyRef.current === fixKey) return;
    viewportAutoFitKeyRef.current = fixKey;
    const timer = window.setTimeout(() => {
      setViewportAutoFitNonce((prev) => prev + 1);
    }, 40);
    return () => window.clearTimeout(timer);
  }, [
    barsCachedAt,
    cleanSym,
    tradeSid,
    areAllRenderedChartsLoaded,
    hasAnyBars,
    master,
    mode,
    isCacheLikeMode,
    liveBarsEnabled,
    pendingMode,
    sortedTfs,
    status,
  ]);

  const selectedObject = useMemo(
    () => (annotations || []).find((a) => a.id === selectedObjectId) || null,
    [annotations, selectedObjectId],
  );
  const editableAnnotations = useMemo(
    () => (annotations || []).filter((a) => a.kind !== "tradeplan"),
    [annotations],
  );
  useEffect(() => {
    if (!selectedObject || selectedObject.kind !== "tradeplan") return;
    const planId = String(selectedObject.plan_id || "P1").toUpperCase();
    const parentPlanGroup = String(selectedTradePlanGroup || "").toUpperCase();
    if (parentDrivenSelectionRef.current === selectedObject.id) {
      parentDrivenSelectionRef.current = null;
      lastPropagatedPlanGroupRef.current = planId;
      if (activePlanGroup !== planId) setActivePlanGroup(planId);
      return;
    }
    const changed = activePlanGroup !== planId;
    if (changed) setActivePlanGroup(planId);
    // Prevent parent-child setState ping-pong loops.
    if (
      changed &&
      planId !== parentPlanGroup &&
      lastPropagatedPlanGroupRef.current !== planId &&
      typeof onTradePlanGroupChangeRef.current === "function"
    ) {
      lastPropagatedPlanGroupRef.current = planId;
      onTradePlanGroupChangeRef.current(planId);
    }
    if (planId === parentPlanGroup) {
      lastPropagatedPlanGroupRef.current = planId;
    }
  }, [selectedObject, activePlanGroup, selectedTradePlanGroup]);

  useEffect(() => {
    if (!(hasTradePlan && hasAnalysis)) return;
    const incoming = String(selectedTradePlanGroup || "").toUpperCase();
    if (!incoming) return;
    const sameIncoming = lastIncomingPlanGroupRef.current === incoming;
    // Prevent selection ping-pong: only sync when parent group actually changes.
    if (sameIncoming) return;
    lastIncomingPlanGroupRef.current = incoming;
    lastPropagatedPlanGroupRef.current = incoming;
    if (incoming !== activePlanGroup) setActivePlanGroup(incoming);
    const target = (annotations || []).find(
      (a) =>
        a.kind === "tradeplan" &&
        String(a.plan_id || "P1").toUpperCase() === incoming,
    );
    if (target?.id && target.id !== selectedObjectId) {
      parentDrivenSelectionRef.current = target.id;
      setSelectedObjectId(target.id);
    }
  }, [
    selectedTradePlanGroup,
    hasTradePlan,
    hasAnalysis,
    annotations,
    selectedObjectId,
    activePlanGroup,
  ]);
  const updateSelectedObject = useCallback(
    (patch) => {
      if (!selectedObjectId) return;
      setAnnotations((prev) =>
        dedupeManualLinesByPrice(
          prev.map((a) =>
            a.id === selectedObjectId ? { ...a, ...patch } : a,
          ),
          selectedObjectId,
        ),
      );
    },
    [selectedObjectId],
  );
  const updateSelectedField = useCallback(
    (field, value) => {
      if (!selectedObjectId) return;
      const current =
        (annotations || []).find((a) => a.id === selectedObjectId) || null;
      const numericKeys = new Set([
        "price",
        "price_top",
        "price_bottom",
        "time",
        "line_width",
        "entryPrice",
        "tpPrice",
        "slPrice",
      ]);
      const next = numericKeys.has(field)
        ? value === "" || value == null
          ? null
          : toNumLoose(value)
        : value;
      if (field === "type") {
        const t = String(value || "").toUpperCase();
        const styleByType = {
          BUY: { line_style: "dot", color: "#10b981", line_width: 0.1 },
          SELL: { line_style: "dot", color: "#ef4444", line_width: 0.1 },
          LINE: { line_style: "dot", color: "#60a5fa", line_width: 0.1 },
          ZONE: {
            line_style: "dot",
            color: "#22c55e",
            line_width: 0.1,
            bg_color: "#22c55e",
          },
          TP: { line_style: "dot", color: "#10b981", line_width: 0.1 },
          SL: { line_style: "dot", color: "#ef4444", line_width: 0.1 },
          "S/R": { line_style: "dot", color: "#eab308", line_width: 0.1 },
          OB: {
            line_style: "dot",
            color: "#8b5cf6",
            line_width: 0.1,
            bg_color: "#8b5cf6",
          },
          BB: {
            line_style: "dot",
            color: "#8b5cf6",
            line_width: 0.1,
            bg_color: "#8b5cf6",
          },
          FVG: {
            line_style: "dot",
            color: "#f59e0b",
            line_width: 0.1,
            bg_color: "#f59e0b",
          },
          IFVG: {
            line_style: "dot",
            color: "#f59e0b",
            line_width: 0.1,
            bg_color: "#f59e0b",
          },
        };
        updateSelectedObject({
          type: t,
          label: formatObjectLabel(t, current?.label || ""),
          ...(styleByType[t] || {}),
        });
      } else if (field === "label") {
        const nextType = String(current?.type || "line").toUpperCase();
        updateSelectedObject({ label: formatObjectLabel(nextType, "") });
      } else {
        updateSelectedObject({ [field]: next });
      }
      if (
        current?.kind === "tradeplan" &&
        typeof onQuickTradeIntent === "function"
      ) {
        const planId = String(current.plan_id || "P1").toUpperCase();
        if (field === "entryPrice") {
          if (Number.isFinite(Number(next))) {
            onQuickTradeIntent({
              symbol: cleanSym,
              side: String(current.direction || "BUY").toUpperCase(),
              action: "ENTRY",
              plan_id: planId,
              price: Number(next),
            });
          }
        } else if (field === "tpPrice") {
          onQuickTradeIntent({
            symbol: cleanSym,
            side: "TP",
            action: Number.isFinite(Number(next)) ? "TP" : "CLEAR_TP",
            plan_id: planId,
            price: Number.isFinite(Number(next)) ? Number(next) : null,
          });
        } else if (field === "slPrice") {
          onQuickTradeIntent({
            symbol: cleanSym,
            side: "SL",
            action: Number.isFinite(Number(next)) ? "SL" : "CLEAR_SL",
            plan_id: planId,
            price: Number.isFinite(Number(next)) ? Number(next) : null,
          });
        } else if (field === "direction") {
          updateSelectedObject({
            color:
              String(next || "BUY").toUpperCase() === "SELL"
                ? "#ef4444"
                : "#10b981",
          });
          const entryNow = Number(current.entryPrice);
          if (Number.isFinite(entryNow)) {
            onQuickTradeIntent({
              symbol: cleanSym,
              side: String(next || "BUY").toUpperCase(),
              action: "ENTRY",
              plan_id: planId,
              price: entryNow,
            });
          }
        }
      }
    },
    [
      selectedObjectId,
      annotations,
      updateSelectedObject,
      onQuickTradeIntent,
      cleanSym,
    ],
  );

  const fallbackEntryRef = useRef(null);
  // Capture fallback entry once when bar data first arrives
  if (fallbackEntryRef.current === null && master?.bars) {
    const keys = Object.keys(master.bars);
    const sorted = keys.sort((a, b) => tfRankForLatest(a) - tfRankForLatest(b));
    for (const k of sorted) {
      const bars = master.bars[k] || [];
      if (!bars.length) continue;
      const close = Number(bars[bars.length - 1]?.close);
      if (Number.isFinite(close)) {
        fallbackEntryRef.current = close;
        break;
      }
    }
  }

  // Stable key for trade plan changes — only the fields the effect uses
  const tradePlanKey = useMemo(() => {
    const plans = Array.isArray(analysisSnapshot?.trade_plan)
      ? analysisSnapshot.trade_plan
      : analysisSnapshot?.trade_plan &&
          typeof analysisSnapshot.trade_plan === "object"
        ? [analysisSnapshot.trade_plan]
        : [];
    return plans
      .map((p) => [p?.entry, p?.tp, p?.sl, p?.direction].join("|"))
      .join("::");
  }, [analysisSnapshot?.trade_plan]);

  useEffect(() => {
    if (!(hasTradePlan && hasAnalysis)) return;
    const rawPlans = Array.isArray(analysisSnapshot?.trade_plan)
      ? analysisSnapshot.trade_plan
      : analysisSnapshot?.trade_plan &&
          typeof analysisSnapshot.trade_plan === "object"
        ? [analysisSnapshot.trade_plan]
        : [];
    if (!rawPlans.length) return;
    const fallbackEntry = fallbackEntryRef.current;
    setAnnotations((prev) => {
      const allowedPlanIds = new Set(
        rawPlans.slice(0, 2).map((_, idx) => (idx === 0 ? "P1" : "P2")),
      );
      let next = [...prev].filter((x) => {
        if (x.kind !== "tradeplan") return true;
        const pid = String(x.plan_id || "").toUpperCase();
        return allowedPlanIds.has(pid);
      });
      rawPlans.slice(0, 2).forEach((p, idx) => {
        const planId = idx === 0 ? "P1" : "P2";
        const id = `tradeplan_${planId}`;
        const existing =
          next.find((x) => x.id === id && x.kind === "tradeplan") || null;
        const direction =
          String(p?.direction || "BUY").toUpperCase() === "SELL"
            ? "SELL"
            : "BUY";
        const entry = toNumLoose(p?.entry ?? p?.entry_price);
        const tp = toNumLoose(p?.tp ?? p?.tp_price);
        const sl = toNumLoose(p?.sl ?? p?.sl_price);
        const effectiveEntry = Number.isFinite(entry)
          ? entry
          : Number.isFinite(existing?.entryPrice)
            ? Number(existing.entryPrice)
            : fallbackEntry;
        const defaults = defaultTpSlFromEntry(effectiveEntry, direction);
        const nextPlan = {
          id,
          kind: "tradeplan",
          type: "TRADEPLAN",
          label: String(p?.label || existing?.label || `TradePlan ${planId}`),
          plan_id: planId,
          direction,
          entryPrice: Number.isFinite(effectiveEntry) ? effectiveEntry : null,
          tpPrice: Number.isFinite(tp)
            ? tp
            : Number.isFinite(defaults.tp)
              ? defaults.tp
              : null,
          slPrice: Number.isFinite(sl)
            ? sl
            : Number.isFinite(defaults.sl)
              ? defaults.sl
              : null,
          visible: existing?.visible !== false,
          color: direction === "SELL" ? "#ef4444" : "#10b981",
          line_width: 0.1,
          line_style: "dot",
          bg_color: "transparent",
          tf: null,
          time: null,
        };
        if (existing) {
          const pos = next.findIndex(
            (x) => x.id === id && x.kind === "tradeplan",
          );
          next[pos] = { ...existing, ...nextPlan };
        } else {
          next.push(nextPlan);
        }
      });
      return next;
    });
  }, [hasTradePlan, hasAnalysis, tradePlanKey]);
  const selectedObjectTfPropsText = useMemo(() => {
    if (!selectedObject) return "";
    const parts = [];
    for (const tf of sortedTfs || []) {
      const tfKey = String(tf || "").toLowerCase();
      const chartId = `${cleanSym}-${tfKey}`;
      const vp = viewports?.[chartId] || null;
      const range =
        vp &&
        Number.isFinite(Number(vp.timeStartMs)) &&
        Number.isFinite(Number(vp.timeEndMs)) &&
        Number.isFinite(Number(vp.priceTop)) &&
        Number.isFinite(Number(vp.priceBottom))
          ? {
              t0: Math.min(Number(vp.timeStartMs), Number(vp.timeEndMs)),
              t1: Math.max(Number(vp.timeStartMs), Number(vp.timeEndMs)),
              pMin: Math.min(Number(vp.priceTop), Number(vp.priceBottom)),
              pMax: Math.max(Number(vp.priceTop), Number(vp.priceBottom)),
            }
          : barsRange(master?.bars?.[tfKey] || []);
      const t1 = toEpochMs(selectedObject.anchorTimeMs);
      const t2 = toEpochMs(selectedObject.anchorTimeMs2);
      const p1 = Number(selectedObject.anchorPrice);
      const p2 = Number(selectedObject.anchorPrice2);
      const rT1 = Number.isFinite(t1)
        ? t1
        : anchorTimeFromRatio(Number(selectedObject.xRatio ?? 0.5), range);
      const rT2 = Number.isFinite(t2)
        ? t2
        : anchorTimeFromRatio(Number(selectedObject.x2Ratio ?? 0.8), range);
      const rP1 = Number.isFinite(p1)
        ? p1
        : anchorPriceFromRatio(
            Number(selectedObject.yRatio ?? selectedObject.y1Ratio ?? 0.5),
            range,
          );
      const rP2 = Number.isFinite(p2)
        ? p2
        : anchorPriceFromRatio(Number(selectedObject.y2Ratio ?? 0.6), range);
      const xVal = Number.isFinite(rT1) ? rT1 : "n/a";
      const yVal = Number.isFinite(rP1) ? Number(rP1).toFixed(2) : "n/a";
      parts.push(
        `time_${tfKey}=${rT1 ?? "n/a"} | price_${tfKey}=${yVal} | x_${tfKey}=${xVal} | y_${tfKey}=${yVal} | time2_${tfKey}=${rT2 ?? "n/a"} | price2_${tfKey}=${Number.isFinite(rP2) ? rP2.toFixed(2) : "n/a"}`,
      );
    }
    return parts.join(" | ");
  }, [selectedObject, sortedTfs, cleanSym, viewports, master]);

  const openSnapshotFileList = useCallback(async () => {
    const attachedItems = (
      Array.isArray(attachedSnapshotFiles) ? attachedSnapshotFiles : []
    )
      .map((file) => String(file || "").trim())
      .filter(Boolean)
      .map((file) => ({
        name: file,
        file_name: file,
        url: tradeSid
          ? `/api/trades/${encodeURIComponent(tradeSid)}/snapshots/${encodeURIComponent(file)}/content`
          : `/api/chart/snapshots/${encodeURIComponent(file)}`,
      }));
    const listed = tradeSid
      ? await api.tradeSnapshots(tradeSid)
      : await api.chartSnapshots(200);
    const listedItems = Array.isArray(listed?.items) ? listed.items : [];
    const all = [...listedItems, ...attachedItems];
    if (all.length) {
      setSnapshotModalFiles(
        all.map((item) => ({
          name: item.name || item.file_name || "snapshot",
          url:
            item.url ||
            `/api/chart/snapshots/${encodeURIComponent(item.file_name || "")}`,
          size_bytes: item.size_bytes || 0,
        })),
      );
    }
    return all;
  }, [attachedSnapshotFiles, tradeSid]);

  const handleModeClick = useCallback(
    async (newMode) => {
      if (newMode === "live") {
        setMode("live");
        setPendingMode(null);
        setLastError(null);
        return;
      }
      if (newMode === "snapshots") {
        setMode("snapshots");
        setPendingMode(null);
        setLastError(null);
        setCapturingSnapshots(true);
        try {
          // Capture snapshots first, then list
          await refresh();
          await openSnapshotFileList();
        } catch (err) {
          setLastError(err?.message || "Failed to capture/load snapshots");
        } finally {
          setCapturingSnapshots(false);
        }
        return;
      }
      // Re-click same mode: force refresh
      if (mode === newMode && !pendingMode && status !== "LOADING") {
        refresh({ force: forceRefresh === true });
        return;
      }
      // Switch immediately so user sees mode change right away. For cache mode,
      // queue an immediate fetch so the panel does not sit in an empty state.
      setMode(newMode);
      setPendingMode(
        newMode === "cache" || newMode === REPLAY_MODE ? newMode : null,
      );
      setLastError(null);
    },
    [mode, pendingMode, status, refresh, forceRefresh, openSnapshotFileList],
  );

  useEffect(() => {
    if (pendingMode !== "cache" && pendingMode !== REPLAY_MODE) return;
    if (status === "LOADING") return;
    refresh({ force: true }).catch(() => {});
  }, [pendingMode, status, refresh]);

  const handleCaptureSnapshots = useCallback(async () => {
    if (!cleanSym || capturingSnapshots) return;
    try {
      setCapturingSnapshots(true);
      setLastError(null);
      const out = await api.chartSnapshotCreateBatch({
        symbol: cleanSym,
        timeframes,
        provider,
        session_prefix: sessionPrefix,
        trade_sid: tradeSid || undefined,
        lookbackBars: 2000,
        format: "png",
        quality: 80,
      });
      const copied = Array.isArray(out?.copied) ? out.copied : [];
      const capturedItems =
        tradeSid && copied.length
          ? copied.map((name) => ({
              name,
              file_name: name,
              url: `/api/trades/${encodeURIComponent(tradeSid)}/snapshots/${encodeURIComponent(name)}/content`,
            }))
          : Array.isArray(out?.items)
            ? out.items
            : [];
      if (capturedItems.length) {
        setSnapshotModalFiles(
          capturedItems.map((item) => ({
            name: item.name || item.file_name || "snapshot",
            url:
              item.url ||
              `/api/chart/snapshots/${encodeURIComponent(item.file_name || "")}`,
            size_bytes: item.size_bytes || 0,
          })),
        );
      }
      await refresh({ force: true });
    } catch (err) {
      setLastError(err?.message || "Snapshot capture failed");
    } finally {
      setCapturingSnapshots(false);
    }
  }, [
    cleanSym,
    capturingSnapshots,
    timeframes,
    provider,
    sessionPrefix,
    tradeSid,
    refresh,
  ]);
  const btnColor = (m) => {
    const active = pendingMode || mode;
    if (m !== active) return "var(--muted)";
    if (m === "live") return "var(--muted)";
    if (status === "LOADING") return STATUS_COLORS.LOADING;
    if (lastError || error) return STATUS_COLORS.ERROR;
    if ((m === "cache" || m === REPLAY_MODE || m === "svg") && barsCachedAt) {
      return STATUS_COLORS.READY;
    }
    if (m === "snapshots" && snapsCachedAt) return STATUS_COLORS.READY;
    return "var(--muted)";
  };

  const btnTitle = (m) => {
    const active = pendingMode || mode;
    if (m !== active) return MODE_LABELS[m];
    if (lastError || error) return lastError || error;
    if ((m === "cache" || m === REPLAY_MODE || m === "svg") && barsCachedAt)
      return "Bars cached " + timeAgo(barsCachedAt);
    if (m === "snapshots" && snapsCachedAt)
      return "Snapshots cached " + timeAgo(snapsCachedAt);
    if (status === "LOADING") return "Loading...";
    return MODE_LABELS[m] + " (no data)";
  };

  const chartModeItems = useMemo(
    () => {
      const modeItems = chartModes
        .filter((value) => value !== REPLAY_MODE)
        .map((value) => ({
        value,
        label: MODE_LABELS[value],
        title: btnTitle(value),
        style: {
          color: btnColor(value),
        },
      }));
      const actionItems = [];
      if (
        showPerCardLayoutControls ||
        mode === "cache" ||
        mode === REPLAY_MODE ||
        mode === "svg" ||
        mode === "live"
      ) {
        actionItems.push(
          {
            value: "__grid_larger__",
            label: "+",
            title: "Larger charts (fewer columns)",
            style: { fontWeight: 700, minWidth: 22 },
          },
          {
            value: "__grid_smaller__",
            label: "-",
            title: "Smaller charts (more columns)",
            style: { fontWeight: 700, minWidth: 22 },
          },
        );
      }
      if (showSnapshotButton) {
        actionItems.push({
          value: "__snapshots__",
          label: "📷",
          title: "Open snapshots grid",
          style: { fontWeight: 700 },
        });
      }
      if (showTradeButton) {
        actionItems.push({
          value: "__trade__",
          label: "Trade >",
          title: "Manual trade",
          style: { fontWeight: 700 },
        });
      }
      return [...modeItems, ...actionItems];
    },
    [btnColor, btnTitle, chartModes, mode, showPerCardLayoutControls, showSnapshotButton, showTradeButton],
  );

  const isMasterSnapshotMode = useMemo(() => {
    return (
      mode === "snapshots" &&
      master?.snapshots &&
      Object.values(master.snapshots).some((s) =>
        String(s?.file_name).toUpperCase().includes("_MASTER"),
      )
    );
  }, [mode, master?.snapshots]);
  const displayTfCount = useMemo(() => {
    const count =
      isMasterSnapshotMode && sortedTfs.length
        ? 1
        : sortedTfs.length;
    return Math.max(1, count || 1);
  }, [isMasterSnapshotMode, sortedTfs]);

  const activeGridCols = useMemo(() => {
    const maxColsByWidth =
      containerWidth > 0
        ? Math.max(1, Math.floor(containerWidth / 220))
        : 6;
    return Math.max(
      1,
      Math.min(
        isMasterSnapshotMode ? 1 : gridCols,
        maxColsByWidth,
        6,
      ),
    );
  }, [gridCols, isMasterSnapshotMode, containerWidth]);

  useEffect(() => {
    if (!fillViewportForFourCharts) {
      setAvailableViewportGridHeight(0);
      return;
    }
    const updateAvailableHeight = () => {
      if (!gridRef.current || typeof window === "undefined") return;
      const rect = gridRef.current.getBoundingClientRect();
      const viewportHeight =
        window.visualViewport?.height || window.innerHeight || 0;
      const bottomPadding = 12;
      setAvailableViewportGridHeight(
        Math.max(0, Math.round(viewportHeight - rect.top - bottomPadding)),
      );
    };
    updateAvailableHeight();
    const onViewportChange = () => updateAvailableHeight();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", onViewportChange);
    viewport?.addEventListener("scroll", onViewportChange);
    let observer = null;
    if (typeof ResizeObserver !== "undefined" && gridRef.current) {
      observer = new ResizeObserver(() => updateAvailableHeight());
      observer.observe(gridRef.current);
    }
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      viewport?.removeEventListener("resize", onViewportChange);
      viewport?.removeEventListener("scroll", onViewportChange);
      observer?.disconnect();
    };
  }, [fillViewportForFourCharts, displayTfCount, activeGridCols]);

  const chartHeight = useMemo(() => {
    const cols = Math.max(1, activeGridCols);
    const rows = Math.max(1, Math.ceil(displayTfCount / cols));
    const gapPx = 8;
    const usableWidth = Math.max(0, containerWidth - gapPx * (cols - 1));
    const tileWidth = usableWidth > 0 ? usableWidth / cols : 0;
    const isNarrowViewport = containerWidth > 0 && containerWidth < 768;
    const isSingleColumnChart = !isNarrowViewport && cols === 1;
    const targetAspectRatio = isNarrowViewport
      ? 1.02
      : isSingleColumnChart
        ? 2.18
        : cols <= 2
          ? 1.48
          : 1.32;
    const widthBasedHeight = !tileWidth
      ? isNarrowViewport
        ? 300
        : isSingleColumnChart
          ? 520
          : cols <= 2
          ? 410
          : 340
      : Math.round(
          Math.max(
            isNarrowViewport ? 280 : isSingleColumnChart ? 520 : 330,
            isSingleColumnChart
              ? tileWidth / targetAspectRatio
              : Math.min(
                  isNarrowViewport ? 380 : 520,
                  tileWidth / targetAspectRatio,
                ),
          ),
        );
    const shouldFillViewportForFourCharts =
      fillViewportForFourCharts &&
      !isNarrowViewport &&
      displayTfCount === 4 &&
      cols === 2 &&
      availableViewportGridHeight > 0;
    if (!shouldFillViewportForFourCharts) return widthBasedHeight;
    const viewportHeightPerTile = Math.floor(
      (availableViewportGridHeight - gapPx * (rows - 1)) / rows,
    );
    return Math.max(widthBasedHeight, viewportHeightPerTile);
  }, [
    activeGridCols,
    availableViewportGridHeight,
    containerWidth,
    displayTfCount,
    fillViewportForFourCharts,
  ]);

  const showControls = !(hasTradePlan && hasAnalysis);
  const replayProgressIndex = isTradeAnchoredReplay
    ? Number.isFinite(Number(effectiveReplayConfig?.currentTradeIndex)) &&
      Number(effectiveReplayConfig?.currentTradeIndex) >= 0
        ? Number(effectiveReplayConfig.currentTradeIndex) + 1
        : 0
    : replayWindowIndices.ready && chartReplayCursorIndex >= 0
      ? Math.max(
          0,
          Math.min(
            Number(chartReplayCursorIndex) - Number(replayWindowIndices.startIndex) + 1,
            Number(replayWindowIndices.endIndex) - Number(replayWindowIndices.startIndex) + 1,
          ),
        )
      : 0;
  const replayProgressTotal = isTradeAnchoredReplay
    ? Number.isFinite(Number(effectiveReplayConfig?.totalTrades)) &&
      Number(effectiveReplayConfig?.totalTrades) > 0
        ? Number(effectiveReplayConfig.totalTrades)
        : 0
    : replayWindowIndices.ready
      ? Math.max(
          0,
          Number(replayWindowIndices.endIndex) - Number(replayWindowIndices.startIndex) + 1,
        )
      : 0;
  const replaySpeedOptions = Array.isArray(effectiveReplayConfig?.speedOptions)
    ? effectiveReplayConfig.speedOptions
    : [];
  const replayCanStart = isTradeAnchoredReplay
    ? replayProgressTotal > 0
    : primaryReplayBars.length > 1;
  const tvTimezone = useMemo(() => toTradingViewTimezone(), [timezoneTick]);
  const uiThemeMode =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light"
      ? "light"
      : "dark";
  const overlayButtons = [
    { key: "plan1", label: "P1" },
    { key: "plan2", label: "P2" },
    { key: "pdArrays", label: "PD" },
    { key: "keyLevels", label: "KL" },
  ];
  const normalizedAnalysisHeaderStatusMode = String(
    analysisHeaderStatusMode || "live",
  )
    .trim()
    .toLowerCase();
  const showAnalysisHeaderLiveStatus = Boolean(
    hasTradePlan &&
      hasAnalysis &&
      !replayDisablesLive &&
      mode ===
        (normalizedAnalysisHeaderStatusMode === "cache" ? "cache" : "live"),
  );
  const analysisStatusTf = useMemo(() => {
    const activeTf = String(activeChartId || "")
      .split("-")
      .slice(-1)[0]
      ?.trim();
    if (activeTf) return activeTf;
    const configuredTfs = Array.isArray(timeframes) ? timeframes : [];
    return String(
      configuredTfs[configuredTfs.length - 1] ||
        sortedTfs[sortedTfs.length - 1] ||
        "5m",
    ).trim();
  }, [activeChartId, sortedTfs, timeframes]);
  const analysisStatusContext =
    analysisStatusTf && master?.context
      ? master.context[String(analysisStatusTf).toLowerCase()] || null
      : null;
  const analysisStatusMetadata =
    analysisStatusContext?.metadata &&
    typeof analysisStatusContext.metadata === "object"
      ? analysisStatusContext.metadata
      : {};
  const analysisStatusStreamSourceActive =
    analysisStatusContext?.cache_source === "stream" ||
    analysisStatusContext?.freshness === "stream" ||
    analysisStatusContext?.reason === "realtime_stream";
  const analysisStatusStreamConnected =
    analysisStatusMetadata?.stream_connected === true;
  const analysisLiveBadge = showAnalysisHeaderLiveStatus
    ? analysisStatusStreamSourceActive && analysisStatusStreamConnected
      ? {
          status: "live",
          label: "Live",
          title: "This timeframe is receiving realtime stream updates.",
        }
      : {
          status: analysisStatusStreamSourceActive ? "warning" : "neutral",
          label: analysisStatusStreamSourceActive ? "No live" : "Static",
          title: analysisStatusStreamSourceActive
            ? `${
                normalizedAnalysisHeaderStatusMode === "cache"
                  ? "Chart Analysis"
                  : "Live mode"
              } is selected, but the realtime stream is not currently connected.`
            : "This timeframe is not currently backed by realtime stream data.",
        }
    : null;
  const showLiveBarsToggle = mode === "cache" && !replayDisablesLive;

  useEffect(() => {
    const onDocClick = () => setCtxMenu(null);
    const onMove = (evt) => {
      if (!dragRef.current) return;
      const d = dragRef.current;
      const rect = d.rect;
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;
      const xr = Math.max(0, Math.min(1, x / Math.max(rect.width, 1)));
      const yr = Math.max(0, Math.min(1, y / Math.max(rect.height, 1)));
      const range = d.range || null;
      const nextAnchorTime = anchorTimeFromRatio(xr, range);
      const nextAnchorPrice = anchorPriceFromRatio(yr, range);
      setAnnotations((prev) =>
        prev.map((a) => {
          if (a.id !== d.id) return a;
          if (a.kind === "line")
            return {
              ...a,
              yRatio: yr,
              anchorPrice: Number.isFinite(nextAnchorPrice)
                ? Number(nextAnchorPrice)
                : a.anchorPrice,
            };
          if (a.kind === "point")
            return {
              ...a,
              xRatio: xr,
              yRatio: yr,
              anchorTimeMs: Number.isFinite(nextAnchorTime)
                ? Number(nextAnchorTime)
                : a.anchorTimeMs,
              anchorPrice: Number.isFinite(nextAnchorPrice)
                ? Number(nextAnchorPrice)
                : a.anchorPrice,
            };
          if (a.kind === "zone") {
            if (d.edge === "top")
              return {
                ...a,
                y1Ratio: yr,
                anchorPrice: Number.isFinite(nextAnchorPrice)
                  ? Number(nextAnchorPrice)
                  : a.anchorPrice,
              };
            if (d.edge === "bottom")
              return {
                ...a,
                y2Ratio: yr,
                anchorPrice2: Number.isFinite(nextAnchorPrice)
                  ? Number(nextAnchorPrice)
                  : a.anchorPrice2,
              };
          }
          return a;
        }),
      );
    };
    const onUp = () => {
      dragRef.current = null;
    };
    document.addEventListener("click", onDocClick);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("click", onDocClick);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const handleContextRequest = useCallback((payload) => {
    if (payload?.chartId) setActiveChartId(payload.chartId);
    setCtxMenu(payload || null);
  }, []);

  const handleViewportChange = useCallback((payload) => {
    const next = sanitizeViewportPayload(payload);
    if (!next?.chartId) return;
    setViewports((prev) => {
      const current = prev?.[next.chartId] || null;
      const unchanged =
        current &&
        current.timeStartMs === next.timeStartMs &&
        current.timeEndMs === next.timeEndMs &&
        current.visibleBars === next.visibleBars &&
        current.priceTop === next.priceTop &&
        current.priceBottom === next.priceBottom &&
        current.width === next.width &&
        current.height === next.height;
      if (unchanged) return prev;
      const merged = { ...prev, [next.chartId]: next };
      return merged;
    });
  }, []);

  useEffect(() => {
    viewportsRef.current = viewports || {};
  }, [viewports]);

  const handleLoadMoreTf = useCallback((tf, bars) => {
    const tfKey = String(tf || "").trim().toLowerCase();
    const chartId = `${cleanSym}-${tfKey}`;
    const nextBars = Math.max(50, Math.min(MAX_HISTORY_BARS, Math.round(Number(bars) || 0)));
    if (!chartId || !Number.isFinite(nextBars) || nextBars <= 0) return;
    setManualTfVisibleBars((prev) => ({ ...(prev || {}), [chartId]: nextBars }));
    setViewports((prev) => ({
      ...(prev || {}),
      [chartId]: {
        ...((prev || {})[chartId] || {}),
        chartId,
        interval: tfKey,
        visibleBars: nextBars,
      },
    }));
  }, [cleanSym]);

  const artifactRequestKeyRef = useRef({});
  const artifactRequestSeqRef = useRef({});
  const loadArtifactsForTf = useCallback(
    async (tf, { force = false, scope = "visible", replaceExisting = false } = {}) => {
      const tfKey = String(tf || "").trim().toLowerCase();
      if (!tfKey || !cleanSym) return null;
      const chartId = `${cleanSym}-${tfKey}`;
      const chartScopeKey = `${chartId}:${scope}`;
      const bars = Array.isArray(master?.bars?.[tfKey]) ? master.bars[tfKey] : [];
      if (!bars.length) return null;
      const viewport = viewportsRef.current?.[chartId] || null;
      const windowRange = resolveArtifactWindow(bars, viewport, tfKey, { scope });
      if (!windowRange) return null;
      const requestKey = [
        cleanSym,
        tfKey,
        windowRange.startTime,
        windowRange.endTime,
        scope,
        "client",
        force ? "force" : "auto",
      ].join("|");
      if (!force && artifactRequestKeyRef.current[chartScopeKey] === requestKey) {
        return null;
      }
      artifactRequestKeyRef.current[chartScopeKey] = requestKey;
      const nextSeq = (artifactRequestSeqRef.current[chartScopeKey] || 0) + 1;
      artifactRequestSeqRef.current[chartScopeKey] = nextSeq;
      const scopedBars = bars.filter((bar) => {
        const time = Number(bar?.time);
        if (!Number.isFinite(time)) return false;
        return time >= Number(windowRange.startTime) && time <= Number(windowRange.endTime);
      });
      const response = {
        ok: true,
        symbol: cleanSym,
        timeframe: tfKey,
        start_time: Number(windowRange.startTime) || null,
        end_time: Number(windowRange.endTime) || null,
        artifacts: {
          items: sharedArtifactDetection.buildDerivedItemsFromBars(scopedBars, tfKey),
          meta: {
            artifact_source: "client_shared_detector",
            calculated_at: new Date().toISOString(),
            replace_existing: Boolean(replaceExisting),
          },
        },
      };
      if (artifactRequestSeqRef.current[chartScopeKey] !== nextSeq) return null;
      const artifacts = response?.artifacts;
      const nextObjects = limitArtifactObjectsNearLastBar(
        artifactEnvelopeToChartObjects(artifacts, tfKey),
        bars,
      ).map((item) => {
        const groupKey = artifactGroupKeyForItem(item);
        const storedVisible = artifactGroupVisibility?.[groupKey];
        if (typeof storedVisible === "boolean") {
          return { ...item, visible: storedVisible };
        }
        return item;
      });
      setArtifactObjectsByChartId((prev) => {
        const current = prev?.[chartId] || [];
        const resolvedObjects =
          scope === "visible"
            ? mergeViewportArtifactObjects(current, nextObjects)
            : nextObjects;
        const currentSig = JSON.stringify(current);
        const nextSig = JSON.stringify(resolvedObjects);
        if (currentSig === nextSig) return prev;
        return { ...prev, [chartId]: resolvedObjects };
      });
      if (scope === "loaded") {
        setArtifactLoadStateByTf((prev) => {
          const nextLoadedAt = Date.now();
          const previous = prev?.[tfKey];
          if (
            previous?.requestKey === requestKey &&
            Number(previous?.itemCount) === nextObjects.length
          ) {
            return prev;
          }
          return {
            ...(prev || {}),
            [tfKey]: {
              requestKey,
              itemCount: nextObjects.length,
              loadedAt: nextLoadedAt,
            },
          };
        });
      }
      return response;
    },
    [artifactGroupVisibility, cleanSym, master?.bars],
  );

  const handleRefreshTf = useCallback(
    async (tf, opts = {}) => {
      if (!tf) return null;
      const result = await refreshTf?.(tf, { force: true, ...(opts || {}) });
      const summary =
        result?.refresh_result && typeof result.refresh_result === "object"
          ? result.refresh_result
          : null;
      const requestedTf = String(tf || "").trim().toLowerCase();
      const silent = opts?.silent === true;
      const background = opts?.background === true;
      const shouldJumpLatestAfterRefresh =
        !background &&
        String(summary?.direction || opts?.direction || "")
          .trim()
          .toLowerCase() !== "history";
      const jumpViewportToLatest = () => {
        if (!cleanSym || !shouldJumpLatestAfterRefresh) return;
        const chartId = `${cleanSym}-${requestedTf}`;
        setViewportCommandByChartId((prev) => ({
          ...prev,
          [chartId]: {
            action: "jump_latest",
            nonce: Date.now(),
          },
        }));
      };
      if (result?.ok === false || result?.error) {
        if (!silent) {
          showToast({
            message:
              result?.error ||
              `Failed to refresh ${cleanSym || "symbol"} ${formatTfForToast(requestedTf)} bars.`,
            type: "error",
          });
        }
        return {
          ok: false,
          chartUpdated: false,
          result,
          summary,
        };
      }
      if (!summary) {
        jumpViewportToLatest();
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            loadArtifactsForTf(requestedTf, {
              force: true,
              scope: "loaded",
            }).catch(() => {});
          }, 200);
        }
        if (!silent) {
          showToast({
            message: `Refreshed ${cleanSym || "symbol"} ${formatTfForToast(requestedTf)} bars.`,
            type: "success",
          });
        }
        return {
          ok: true,
          chartUpdated: true,
          result,
          summary: null,
        };
      }
      if (summary.direction === "history") {
        if (summary.addedBars > 0) {
          if (typeof window !== "undefined") {
            window.setTimeout(() => {
              loadArtifactsForTf(requestedTf, {
                force: true,
                scope: "loaded",
              }).catch(() => {});
            }, 200);
          }
          if (!silent) {
            showToast({
              message: `${cleanSym || "symbol"} ${formatTfForToast(requestedTf)}: added ${summary.addedBars} older bars. Stored: ${summary.storedBars}.`,
              type: "success",
            });
          }
          return {
            ok: true,
            chartUpdated: true,
            result,
            summary,
          };
        }
        if (summary.updatedBars > 0) {
          if (typeof window !== "undefined") {
            window.setTimeout(() => {
              loadArtifactsForTf(requestedTf, {
                force: true,
                scope: "loaded",
              }).catch(() => {});
            }, 200);
          }
          if (!silent) {
            showToast({
              message: `${cleanSym || "symbol"} ${formatTfForToast(requestedTf)}: no older bars added. Stored remains ${summary.storedBars}.`,
              type: "info",
            });
          }
          return {
            ok: true,
            chartUpdated: true,
            result,
            summary,
          };
        }
        if (!silent) {
          showToast({
            message:
              summary.remoteReason && String(summary.remoteReason).trim()
                ? `${cleanSym || "symbol"} ${formatTfForToast(requestedTf)}: no older bars available (${summary.remoteReason}).`
                : `${cleanSym || "symbol"} ${formatTfForToast(requestedTf)}: no older bars available.`,
            type: "info",
          });
        }
        return {
          ok: true,
          chartUpdated: false,
          result,
          summary,
        };
      }
      jumpViewportToLatest();
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          loadArtifactsForTf(requestedTf, {
            force: true,
            scope: "loaded",
          }).catch(() => {});
        }, 200);
      }
      if (!silent) {
        showToast({
          message: `${cleanSym || "symbol"} ${formatTfForToast(requestedTf)} refreshed. Stored: ${summary.storedBars}.`,
          type: "success",
        });
      }
      return {
        ok: true,
        chartUpdated: true,
        result,
        summary,
      };
    },
    [cleanSym, loadArtifactsForTf, refreshTf],
  );

  const runRefreshFixChain = useCallback(
    async (tf, opts = {}) => {
      const requestedTf = String(tf || "").trim().toLowerCase();
      const silent = opts?.silent === true;
      const background = opts?.background === true;
      const latestBars =
        Number(effectiveBarsCountByTf?.[requestedTf]) > 0
          ? Number(effectiveBarsCountByTf[requestedTf])
          : Number(localBarsCount) > 0
            ? Number(localBarsCount)
            : 1000;
      const result = await api.marketDataRefreshFixChain({
        symbol: cleanSym,
        target_tf: requestedTf,
        base_tf: "1",
        latest_bars: Math.max(300, Math.min(MAX_HISTORY_BARS, Math.round(latestBars))),
        repair_history_gaps: opts?.repairHistoryGaps === true,
        notification: background !== true,
      });
      const latestRefresh = await handleRefreshTf(requestedTf, {
        force: true,
        silent: true,
        background,
      });
      let chartUpdated = latestRefresh?.chartUpdated === true;
      const shouldSyncViewportHistory = opts?.syncViewportHistory !== false;
      if (shouldSyncViewportHistory) {
        const chartId = `${cleanSym}-${requestedTf}`;
        const viewport = viewports?.[chartId] || null;
        const tfBars = Array.isArray(master?.bars?.[requestedTf])
          ? master.bars[requestedTf]
          : [];
        const firstBarSec = Number(tfBars?.[0]?.time || 0) || 0;
        const viewportStartMs = Number(viewport?.timeStartMs || 0) || 0;
        const tfMs = Math.max(
          1000,
          (Number(timeframeToSeconds(requestedTf)) || 60) * 1000,
        );
        const firstBarMs =
          Number.isFinite(firstBarSec) && firstBarSec > 0
            ? firstBarSec * 1000
            : null;
        const needsOlderBars =
          tfBars.length > 0 &&
          Number.isFinite(firstBarMs) &&
          Number.isFinite(viewportStartMs) &&
          viewportStartMs < firstBarMs - tfMs;
        if (needsOlderBars) {
          const historyRefresh = await handleRefreshTf(requestedTf, {
            force: true,
            direction: "history",
            bars: HISTORY_BARS_ACTION_COUNT,
            silent: true,
            background,
          });
          chartUpdated = chartUpdated || historyRefresh?.chartUpdated === true;
        }
      }
      if (result?.ok === false || result?.error) {
        if (!silent) {
          if (chartUpdated) {
            showToast({
              message:
                `${cleanSym || "symbol"} ${formatTfForToast(requestedTf)} latest bars refreshed. ` +
                `Some deeper historical gaps may still remain.`,
              type: "info",
            });
          } else {
            showToast({
              message:
                result?.error ||
                `Failed to refresh & fix ${cleanSym || "symbol"} ${formatTfForToast(requestedTf)}.`,
              type: "error",
            });
          }
        }
        return { ...result, chart_updated: chartUpdated };
      }
      if (!silent) {
        showToast({
          message: `${cleanSym || "symbol"} ${formatTfForToast(requestedTf)} refresh & fix completed.`,
          type: "success",
        });
      }
      return { ...result, chart_updated: chartUpdated };
    },
    [cleanSym, effectiveBarsCountByTf, handleRefreshTf, localBarsCount, master?.bars, viewports],
  );

  const handleViewportNavigate = useCallback(
    async (tf, action) => {
      const tfKey = String(tf || "").trim().toLowerCase();
      if (!tfKey) return;
      const chartId = `${cleanSym}-${tfKey}`;
      if (action === "jump_first") {
        const viewport = viewports?.[chartId] || null;
        const bars = Array.isArray(master?.bars?.[tfKey]) ? master.bars[tfKey] : [];
        const firstBarSec = Number(bars?.[0]?.time);
        const viewportStartMs = Number(viewport?.timeStartMs);
        const tfMs = Math.max(
          1000,
          (Number(timeframeToSeconds(tfKey)) || 60) * 1000,
        );
        const firstBarMs =
          Number.isFinite(firstBarSec) && firstBarSec > 0 ? firstBarSec * 1000 : null;
        const atLoadedLeftEdge =
          Number.isFinite(firstBarMs) &&
          Number.isFinite(viewportStartMs) &&
          viewportStartMs <= firstBarMs + tfMs;
        if (atLoadedLeftEdge) {
          await handleRefreshTf(tfKey, {
            force: true,
            direction: "history",
            bars: HISTORY_BARS_ACTION_COUNT,
          });
          handleLoadMoreTf(tfKey, HISTORY_BARS_ACTION_COUNT);
          return;
        }
      }
      setViewportCommandByChartId((prev) => ({
        ...prev,
        [chartId]: {
          action: String(action || "").trim(),
          nonce: Date.now(),
        },
      }));
    },
    [cleanSym, handleLoadMoreTf, handleRefreshTf, master?.bars, viewports],
  );

  const applyPostLoadRecenter = useCallback((targetTfs = []) => {
    const tfKeys = (Array.isArray(targetTfs) ? targetTfs : [])
      .map((tf) => String(tf || "").trim().toLowerCase())
      .filter(Boolean);
    if (!cleanSym || !tfKeys.length) return;
    setManualTfVisibleBars((prev) => {
      const next = { ...(prev || {}) };
      tfKeys.forEach((tfKey) => {
        next[`${cleanSym}-${tfKey}`] = POST_LOAD_RECENTER_VISIBLE_BARS;
      });
      return next;
    });
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        setViewportCommandByChartId((prev) => {
          const next = { ...(prev || {}) };
          const nonceBase = Date.now();
          tfKeys.forEach((tfKey, index) => {
            next[`${cleanSym}-${tfKey}`] = {
              action: "show_all_loaded",
              nonce: nonceBase + index,
            };
          });
          return next;
        });
      }, 220);
    }
  }, [cleanSym]);

  const handleEnterFullscreen = useCallback(async (chartId) => {
    if (!chartId || typeof document === "undefined") return;
    const target = chartTileRefs.current?.[chartId];
    if (!target) return;
    setActiveChartId(chartId);
    try {
      if (document.fullscreenElement === target) return;
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen().catch(() => {});
      }
      if (typeof target.requestFullscreen === "function") {
        await target.requestFullscreen();
        return;
      }
      if (typeof target.webkitRequestFullscreen === "function") {
        target.webkitRequestFullscreen();
      }
    } catch {
      // Ignore fullscreen failures caused by browser permissions or unsupported contexts.
    }
  }, []);

  const handleRepairTf = useCallback(
    async (tf, opts = {}) => {
      const requestedTf = String(tf || "").trim().toLowerCase();
      if (!cleanSym || !requestedTf || repairingTfKey === requestedTf) return;
      setRepairingTfKey(requestedTf);
      try {
        await runRefreshFixChain(requestedTf, opts);
      } catch (err) {
        if (opts?.silent !== true) {
          showToast({
            message: err?.message || `Failed to repair ${cleanSym} ${requestedTf}.`,
            type: "error",
          });
        }
      } finally {
        setRepairingTfKey("");
      }
    },
    [cleanSym, repairingTfKey, runRefreshFixChain],
  );

  const handleRefreshTfLatest = useCallback(
    async (tf, opts = {}) => {
      const requestedTf = String(tf || "").trim().toLowerCase();
      if (!cleanSym || !requestedTf || repairingTfKey === requestedTf) return null;
      const requestedBars = Math.max(
        50,
        Math.min(
          MAX_HISTORY_BARS,
          Math.round(Number(opts?.bars) || HISTORY_BARS_ACTION_COUNT),
        ),
      );
      setRepairingTfKey(requestedTf);
      try {
        const repairResult = await runRefreshFixChain(requestedTf, {
          syncViewportHistory: false,
          silent: true,
          bars: requestedBars,
        });
        showToast({
          message: `${cleanSym} ${formatTfForToast(requestedTf)} refreshed and fixed.`,
          type: repairResult?.ok === false ? "info" : "success",
        });
        return repairResult;
      } catch (err) {
        showToast({
          message:
            err?.message ||
            `Failed to refresh ${cleanSym} ${formatTfForToast(requestedTf)}.`,
          type: "error",
        });
        throw err;
      } finally {
        setRepairingTfKey("");
      }
    },
    [cleanSym, repairingTfKey, runRefreshFixChain, showToast],
  );

  const handleLoadTfHistory = useCallback(
    async (tf, opts = {}) => {
      const requestedTf = String(tf || "").trim().toLowerCase();
      if (!cleanSym || !requestedTf || repairingTfKey === requestedTf) return null;
      const requestedBars = Math.max(
        50,
        Math.min(
          MAX_HISTORY_BARS,
          Math.round(Number(opts?.bars) || HISTORY_BARS_ACTION_COUNT),
        ),
      );
      setRepairingTfKey(requestedTf);
      try {
        const storageResult = await handleRefreshTf(requestedTf, {
          force: true,
          direction: "history",
          bars: requestedBars,
          loadMode: "storage_only",
          silent: true,
        });
        const storageSummary = storageResult?.summary || null;
        const storageAddedBars = Math.max(
          0,
          Number(storageSummary?.storedAddedBars ?? storageSummary?.addedBars) || 0,
        );
        const remainingBars = Math.max(0, requestedBars - storageAddedBars);
        const storageAdded =
          storageAddedBars > 0 || Number(storageSummary?.updatedBars) > 0;
        let remoteResult = null;
        if (remainingBars > 0) {
          remoteResult = await handleRefreshTf(requestedTf, {
            force: true,
            direction: "history",
            bars: remainingBars,
            loadMode: "remote_history",
            silent: true,
          });
        }
        const remoteSummary = remoteResult?.summary || null;
        const remoteAddedBars = Math.max(
          0,
          Number(remoteSummary?.storedAddedBars ?? remoteSummary?.addedBars) || 0,
        );
        const remoteAdded =
          remoteAddedBars > 0 || Number(remoteSummary?.updatedBars) > 0;
        if (storageAdded || remoteAdded) {
          handleLoadMoreTf(requestedTf, requestedBars);
          applyPostLoadRecenter(sortedTfs);
        }
        const addedBars = storageAddedBars + remoteAddedBars;
        const sourceLabel =
          storageAddedBars > 0 && remoteAddedBars > 0
            ? `local storage (${storageAddedBars}) + remote history (${remoteAddedBars})`
            : storageAddedBars > 0
              ? "local storage"
              : remoteAddedBars > 0
                ? "remote history"
                : "latest data";
        showToast({
          message:
            addedBars > 0
              ? `${cleanSym} ${formatTfForToast(requestedTf)} loaded ${addedBars} older bars from ${sourceLabel}.`
              : `${cleanSym} ${formatTfForToast(requestedTf)} has no older bars available.`,
          type: addedBars > 0 ? "success" : "info",
        });
        return {
          ok: storageResult?.ok !== false && remoteResult?.ok !== false,
          storageResult,
          remoteResult,
        };
      } catch (err) {
        showToast({
          message:
            err?.message ||
            `Failed to refresh ${cleanSym} ${formatTfForToast(requestedTf)}.`,
          type: "error",
        });
        throw err;
      } finally {
        setRepairingTfKey("");
      }
    },
    [
      cleanSym,
      applyPostLoadRecenter,
      handleLoadMoreTf,
      handleRefreshTf,
      repairingTfKey,
      showToast,
      sortedTfs,
    ],
  );

  const findStaleTailTimeframes = useCallback(
    (nowMs = Date.now()) => {
      const availableTfs = (Array.isArray(requestedSortedTfs) ? requestedSortedTfs : [])
        .map((tf) => String(tf || "").trim().toLowerCase())
        .filter(Boolean);
      if (!availableTfs.length) return [];
      const stale = availableTfs.filter((tfKey) => {
        const bars = Array.isArray(master?.bars?.[tfKey]) ? master.bars[tfKey] : [];
        const loadedEndSec = Number(bars[bars.length - 1]?.time || 0) || 0;
        const tfSeconds = Math.max(1, Number(timeframeToSeconds(tfKey)) || 0);
        const expectedLatestBarSec = expectedLatestClosedBarStartSec(tfKey, nowMs);
        if (!loadedEndSec || !tfSeconds || !expectedLatestBarSec) return false;
        return Number(expectedLatestBarSec) > Number(loadedEndSec);
      });
      return sortTimeframes(stale, "asc");
    },
    [master?.bars, requestedSortedTfs],
  );

  useEffect(() => {
    if (
      !cleanSym ||
      !isCacheLikeMode ||
      isBacktestChartReplay ||
      isReplayMode ||
      !liveBarsEnabled
    ) return;
    if (status === "LOADING") return;
    const availableTfs = (Array.isArray(requestedSortedTfs) ? requestedSortedTfs : [])
      .map((tf) => String(tf || "").trim().toLowerCase())
      .filter(Boolean);
    if (!availableTfs.length) return;

    const hasBars = availableTfs.some((tfKey) => {
      const bars = Array.isArray(master?.bars?.[tfKey]) ? master.bars[tfKey] : [];
      return bars.length > 0;
    });
    if (!hasBars) return;

    const bootstrapKey = `${cleanSym}|${availableTfs.join(",")}|${mode}`;
    if (bootstrapRepairRef.current.key !== bootstrapKey) {
      bootstrapRepairRef.current = { key: bootstrapKey, status: "idle" };
    }
    if (bootstrapRepairRef.current.status !== "idle") return;

    const staleTfs = findStaleTailTimeframes(Date.now());
    if (!staleTfs.length) {
      bootstrapRepairRef.current.status = "done";
      return;
    }

    const targetTf = String(staleTfs[0] || "").trim().toLowerCase();
    if (!targetTf) return;

    bootstrapRepairRef.current.status = "running";
    handleRepairTf(targetTf, {
      silent: true,
      background: true,
      repairHistoryGaps: false,
    })
      .catch(() => {})
      .finally(() => {
        bootstrapRepairRef.current.status = "done";
      });
  }, [
    cleanSym,
    handleRepairTf,
    isBacktestChartReplay,
    isReplayMode,
    isCacheLikeMode,
    findStaleTailTimeframes,
    master?.bars,
    liveBarsEnabled,
    mode,
    status,
    requestedSortedTfs,
  ]);

  useEffect(() => {
    if (
      !cleanSym ||
      !isCacheLikeMode ||
      isBacktestChartReplay ||
      isReplayMode ||
      !liveBarsEnabled
    ) return undefined;
    if (syncModeWithLocationHash !== true) return undefined;

    const runTailCatchup = () => {
      if (document?.visibilityState === "hidden") return;
      if (status === "LOADING" || repairingTfKey) return;
      const staleTfs = findStaleTailTimeframes(Date.now());
      if (!staleTfs.length) return;
      const targetTf = String(staleTfs[0] || "").trim().toLowerCase();
      if (!targetTf) return;

      handleRepairTf(targetTf, {
        silent: true,
        background: true,
        repairHistoryGaps: false,
      }).catch(() => {});
    };

    const timer = window.setInterval(runTailCatchup, 60_000);
    return () => window.clearInterval(timer);
  }, [
    cleanSym,
    handleRepairTf,
    isBacktestChartReplay,
    isReplayMode,
    isCacheLikeMode,
    findStaleTailTimeframes,
    master?.bars,
    repairingTfKey,
    requestedSortedTfs,
    status,
    syncModeWithLocationHash,
    liveBarsEnabled,
  ]);

  const findHistoryGapTimeframes = useCallback(() => {
    const nextTfs = [];
    for (const tf of sortedTfs || []) {
      const tfKey = String(tf || "").trim().toLowerCase();
      if (!tfKey) continue;
      const chartId = `${cleanSym}-${tfKey}`;
      const viewport = viewports?.[chartId] || null;
      const bars = Array.isArray(master?.bars?.[tfKey]) ? master.bars[tfKey] : [];
      const firstBarSec = Number(bars?.[0]?.time);
      const viewportStartMs = Number(viewport?.timeStartMs);
      const tfMs = Math.max(
        1000,
        (Number(timeframeToSeconds(tfKey)) || 60) * 1000,
      );
      if (
        !bars.length ||
        !Number.isFinite(firstBarSec) ||
        firstBarSec <= 0 ||
        !Number.isFinite(viewportStartMs)
      ) {
        continue;
      }
      const firstBarMs = firstBarSec * 1000;
      if (viewportStartMs < firstBarMs - tfMs) {
        nextTfs.push(tfKey);
      }
    }
    return nextTfs;
  }, [cleanSym, master?.bars, sortedTfs, viewports]);

  const handleManualChartFix = useCallback(async () => {
    const gapTfs = findHistoryGapTimeframes();
    if (gapTfs.length > 0) {
      for (const tf of gapTfs) {
        await handleRefreshTf(tf, {
          force: true,
          direction: "history",
          bars: HISTORY_BARS_ACTION_COUNT,
        });
      }
    }
    setViewportAutoFitNonce((prev) => prev + 1);
  }, [findHistoryGapTimeframes, handleRefreshTf]);

  const scheduleShowAllLoadedViewport = useCallback(
    (targetTfs = [], delayMs = 160) => {
      const run = () => {
        const tfKeys = (Array.isArray(targetTfs) ? targetTfs : [])
          .map((tf) => String(tf || "").trim().toLowerCase())
          .filter(Boolean);
        if (!cleanSym || !tfKeys.length) return;
        setViewportCommandByChartId((prev) => {
          const next = { ...(prev || {}) };
          const nonceBase = Date.now();
          tfKeys.forEach((tfKey, index) => {
            next[`${cleanSym}-${tfKey}`] = {
              action: "show_all_loaded",
              nonce: nonceBase + index,
            };
          });
          return next;
        });
      };
      if (typeof window === "undefined") {
        run();
        return;
      }
      window.setTimeout(run, Math.max(0, Number(delayMs) || 0));
    },
    [cleanSym],
  );

  useEffect(() => {
    if (!isCacheLikeMode || !cleanSym || status === "LOADING" || !liveBarsEnabled) return undefined;
    if (isBacktestChartReplay || isReplayMode) return undefined;
    const timer = window.setTimeout(() => {
      (sortedTfs || []).forEach((tf) => {
        loadArtifactsForTf(tf, { force: false, scope: "visible" }).catch(() => {});
      });
    }, ARTIFACT_AUTO_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    cleanSym,
    isBacktestChartReplay,
    isReplayMode,
    isCacheLikeMode,
    loadArtifactsForTf,
    sortedTfs,
    status,
    master?.bars,
    liveBarsEnabled,
  ]);

  useEffect(() => {
    if (!isCacheLikeMode || !cleanSym || !liveBarsEnabled) return;
    if (!(status === "READY" || status === "STALE")) return;
    if (isBacktestChartReplay || isReplayMode) return;
    (requestedSortedTfs || []).forEach((tf) => {
      const tfKey = String(tf || "").trim().toLowerCase();
      if (!tfKey) return;
      if (!(Array.isArray(master?.bars?.[tfKey]) && master.bars[tfKey].length > 0)) return;
      loadArtifactsForTf(tfKey, { force: false, scope: "loaded" }).catch(() => {});
    });
  }, [
    cleanSym,
    isCacheLikeMode,
    isBacktestChartReplay,
    isReplayMode,
    loadArtifactsForTf,
    master?.bars,
    requestedSortedTfs,
    status,
    liveBarsEnabled,
  ]);

  const handleRefreshChartsAndArtifacts = useCallback(async (opts = {}) => {
    const silent = opts?.silent === true;
    const summaryToast = opts?.summaryToast !== false;
    const targetTfs = Array.isArray(requestedSortedTfs) ? requestedSortedTfs : [];
    if (!targetTfs.length) return;
    await Promise.allSettled(
      targetTfs.map((tf) => {
        const tfKey = String(tf || "").trim().toLowerCase();
        if (!tfKey) return null;
        const chartId = `${cleanSym}-${tfKey}`;
        const requestedBars =
          Number(manualTfVisibleBars?.[chartId]) > 0
            ? Number(manualTfVisibleBars[chartId])
            : Number(savedTfVisibleBars?.[chartId]) > 0
              ? Number(savedTfVisibleBars[chartId])
              : Number(effectiveBarsCountByTf?.[tfKey]) > 0
                ? Number(effectiveBarsCountByTf[tfKey])
                : undefined;
        return handleRefreshTf(tfKey, {
          force: true,
          silent,
          ...(Number.isFinite(requestedBars) && requestedBars > 0
            ? { bars: requestedBars }
            : {}),
        });
      }),
    );
    if (typeof window !== "undefined") {
      window.setTimeout(async () => {
        const results = await Promise.allSettled(
          targetTfs.map((tf) =>
            loadArtifactsForTf(tf, { force: true, scope: "loaded" }),
          ),
        );
        const itemCount = results.reduce((sum, result) => {
          const items =
            result.status === "fulfilled"
              ? result.value?.artifacts?.items
              : null;
          return sum + (Array.isArray(items) ? items.length : 0);
        }, 0);
        applyPostLoadRecenter(targetTfs);
        if (!silent && summaryToast) {
          const tfList = formatTfListForToast(targetTfs);
          showToast({
            message: `${cleanSym || "symbol"} refreshed: ${tfList || `${targetTfs.length} TFs`} and artifacts${itemCount > 0 ? ` (${itemCount} items)` : ""}.`,
            type: "success",
          });
        }
      }, 250);
    }
  }, [
    cleanSym,
    effectiveBarsCountByTf,
    handleRefreshTf,
    loadArtifactsForTf,
    manualTfVisibleBars,
    applyPostLoadRecenter,
    savedTfVisibleBars,
    requestedSortedTfs,
    showToast,
  ]);

  useEffect(() => {
    if (
      (isReplayMode && canFreezeReplayChartData) ||
      !autoLoadOnMount ||
      !cleanSym ||
      skipFetch ||
      mode === "live" ||
      pendingMode
    ) {
      return;
    }
    if (hasVisibleBars || hasVisibleSnapshots || status === "LOADING") return;
    const loadKey = [
      "fallback",
      cleanSym,
      mode,
      tradeSid,
      timeframes.join(","),
      localBarsCount,
    ].join("|");
    if (autoLoadKeyRef.current === loadKey) return;
    autoLoadKeyRef.current = loadKey;
    handleRefreshChartsAndArtifacts({
      silent: true,
      summaryToast: false,
    }).catch(() => {});
  }, [
    autoLoadOnMount,
    canFreezeReplayChartData,
    cleanSym,
    handleRefreshChartsAndArtifacts,
    isReplayMode,
    localBarsCount,
    master,
    mode,
    pendingMode,
    skipFetch,
    status,
    timeframes,
    tradeSid,
    hasVisibleBars,
    hasVisibleSnapshots,
  ]);

  const handleRecalcArtifacts = useCallback(async () => {
    const targetTfs = (Array.isArray(requestedSortedTfs) ? requestedSortedTfs : []).filter((tf) => {
      const tfKey = String(tf || "").trim().toLowerCase();
      return Array.isArray(master?.bars?.[tfKey]) && master.bars[tfKey].length > 0;
    });
    artifactRequestKeyRef.current = {};
    artifactRequestSeqRef.current = {};
    setArtifactObjectsByChartId({});
    const results = await Promise.allSettled(
      targetTfs.map((tf) =>
        loadArtifactsForTf(tf, {
          force: true,
          scope: "loaded",
          replaceExisting: true,
        }),
      ),
    );
    const itemCount = results.reduce((sum, result) => {
      const items =
        result.status === "fulfilled" ? result.value?.artifacts?.items : null;
      return sum + (Array.isArray(items) ? items.length : 0);
    }, 0);
    const tfList = formatTfListForToast(targetTfs);
    showToast({
      message:
        targetTfs.length > 0
          ? `${cleanSym || "symbol"} artifacts rebuilt: ${tfList || `${targetTfs.length} TFs`}${itemCount > 0 ? ` (${itemCount} items)` : ""}.`
          : "No timeframes available for artifact recalculation.",
      type: "success",
    });
    if (targetTfs.length > 0) {
      applyPostLoadRecenter(targetTfs);
    }
  }, [
    requestedSortedTfs,
    master?.bars,
    loadArtifactsForTf,
    applyPostLoadRecenter,
    showToast,
  ]);

  useEffect(() => {
    artifactRequestKeyRef.current = {};
    artifactRequestSeqRef.current = {};
    setArtifactObjectsByChartId({});
  }, [cleanSym]);

  const artifactPanelGroups = useMemo(() => {
    const groups = new Map();
    for (const [chartId, items] of Object.entries(artifactObjectsByChartId || {})) {
      for (const item of Array.isArray(items) ? items : []) {
        if (!shouldShowArtifactSourceTf(item?.source_tf || item?.tf, "5m")) continue;
        const groupKey = artifactGroupKeyForItem(item);
        const mapKey = String(groupKey || "other");
        if (!groups.has(mapKey)) {
          groups.set(mapKey, {
            chartIds: new Set(),
            groupKey,
            label: artifactGroupLabel(groupKey),
            color: artifactColorForItem(item),
            count: 0,
            visible: false,
          });
        }
        const group = groups.get(mapKey);
        group.chartIds.add(chartId);
        group.count += 1;
        if (item?.visible !== false) group.visible = true;
      }
    }
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        chartIds: Array.from(group.chartIds || []),
      }))
      .sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
  }, [artifactObjectsByChartId, cleanSym]);

  const artifactPanelTimeframes = useMemo(() => {
    const groups = new Map();
    for (const items of Object.values(artifactObjectsByChartId || {})) {
      for (const item of Array.isArray(items) ? items : []) {
        const tfKey = artifactSourceTfLabel(item?.source_tf || item?.tf || item?.timeframe || "");
        if (!tfKey) continue;
        if (!groups.has(tfKey)) {
          groups.set(tfKey, {
            tfKey,
            label: tfKey.toUpperCase(),
            color: artifactTimeframeColor(tfKey),
            count: 0,
            visible: false,
          });
        }
        const group = groups.get(tfKey);
        group.count += 1;
        if (item?.visible !== false && artifactTfVisibility?.[tfKey] !== false) {
          group.visible = true;
        }
      }
    }
    return Array.from(groups.values()).sort(
      (a, b) =>
        Number(timeframeToSeconds(b.tfKey)) - Number(timeframeToSeconds(a.tfKey)),
    );
  }, [artifactObjectsByChartId, artifactTfVisibility]);

  const strategyMarkerObjectsByTf = useMemo(() => {
    const normalizedStrategies = (Array.isArray(chartStrategies) ? chartStrategies : [])
      .filter(Boolean);
    if (!normalizedStrategies.length || !master?.bars) return {};
    const output = {};
    Object.entries(master.bars || {}).forEach(([tfKey, barsRaw]) => {
      const bars = Array.isArray(barsRaw) ? barsRaw : [];
      if (bars.length < 2) return;
      const evaluation = evaluateChartStrategies({
        bars,
        strategies: normalizedStrategies,
        lookbackBars: bars.length,
        symbol: cleanSym,
        tf: tfKey,
        multiTfBars: master?.bars,
      });
      const hits = Array.isArray(evaluation?.matches) ? evaluation.matches : [];
      if (!hits.length) return;
      output[String(tfKey || "").trim().toLowerCase()] = hits
        .flatMap((hit) => [
          strategyHitToChartObject(hit, tfKey),
          ...strategyHitContextToChartObjects(hit, tfKey),
        ])
        .filter(Boolean);
    });
    return output;
  }, [chartStrategies, cleanSym, master?.bars]);
  const replayBarsByTf = useMemo(() => {
    if (!isBacktestChartReplay || !master?.bars) return {};
    if (!Number.isFinite(replayClockTimeSec)) return {};
    const output = {};
    (sortedTfs || []).forEach((tfRaw) => {
      const tf = String(tfRaw || "").trim().toLowerCase();
      const barsForTf = Array.isArray(master?.bars?.[tf]) ? master.bars[tf] : [];
      if (!barsForTf.length || !Number.isFinite(replayClockTimeSec)) return;
      const replayBars = buildReplayBarsForTf({
        bars: barsForTf,
        baseBars: primaryReplayBars,
        tf,
        replayClockTimeSec,
        replayStartTimeSec: effectiveReplayStartTimeSec,
        maxBars: BACKTEST_REPLAY_MAX_BARS,
      });
      if (!Array.isArray(replayBars) || replayBars.length < 1) return;
      output[tf] = replayBars;
    });
    return output;
  }, [
    effectiveReplayStartTimeSec,
    isBacktestChartReplay,
    master?.bars,
    primaryReplayBars,
    replayClockTimeSec,
    sortedTfs,
  ]);

  const toggleArtifactGroupVisibility = useCallback((groupKey) => {
    setArtifactGroupVisibility((prev) => {
      const current = prev?.[groupKey];
      const fallbackVisible = artifactPanelGroups.find(
        (group) => group.groupKey === groupKey,
      )?.visible;
      const nextVisible =
        typeof current === "boolean"
          ? !current
          : !(typeof fallbackVisible === "boolean" ? fallbackVisible : true);
      return { ...(prev || {}), [groupKey]: nextVisible };
    });
    setArtifactObjectsByChartId((prev) => {
      const next = { ...(prev || {}) };
      for (const [chartId, listRaw] of Object.entries(prev || {})) {
        const list = Array.isArray(listRaw) ? listRaw : [];
        const targetEntries = list.filter(
          (entry) => artifactGroupKeyForItem(entry) === groupKey,
        );
        if (!targetEntries.length) continue;
        const nextVisible = targetEntries.some((entry) => entry?.visible === false);
        next[chartId] = list.map((entry) =>
          artifactGroupKeyForItem(entry) === groupKey
            ? { ...entry, visible: nextVisible }
            : entry,
        );
      }
      return next;
    });
  }, [artifactPanelGroups]);

  const toggleArtifactTfVisibility = useCallback((tfKey) => {
    setArtifactTfVisibility((prev) => {
      const current = prev?.[tfKey];
      const fallbackVisible = artifactPanelTimeframes.find((group) => group.tfKey === tfKey)?.visible;
      const nextVisible =
        typeof current === "boolean"
          ? !current
          : !(typeof fallbackVisible === "boolean" ? fallbackVisible : true);
      return { ...(prev || {}), [tfKey]: nextVisible };
    });
  }, [artifactPanelTimeframes]);

  const momentumLayerItems = useMemo(
    () =>
      INDICATOR_GROUPS.filter((group) => group.label === "MOMENTUM" || group.label === "MACD")
        .flatMap((group) => group.items)
        .filter((item) => item.key !== "zigzag"),
    [],
  );

  const trendLayerItems = useMemo(
    () =>
      INDICATOR_GROUPS.filter((group) => group.label === "TREND")
        .flatMap((group) => group.items)
        .filter((item) => item.key !== "zigzag"),
    [],
  );
  const liveDebugRows = useMemo(() => {
    const cronInfo =
      liveDebugHealth?.diagnostics?.cron &&
      typeof liveDebugHealth.diagnostics.cron === "object"
        ? liveDebugHealth.diagnostics.cron
        : {};
    const topicState =
      liveDebugTopicState && typeof liveDebugTopicState === "object"
        ? liveDebugTopicState
        : {};
    const connectionState = String(
      topicState?.connectionState || realtimeTransport?.connectionState || "idle",
    )
      .trim()
      .toLowerCase();
    const streamConnected = topicState?.connected === true;
    const isCrypto = isCryptoLikeDebugSymbol(cleanSym);
    const analysisCatchupActive =
      isCacheLikeMode && syncModeWithLocationHash === true && !isBacktestChartReplay;
    const marketDataJobs = Number(
      cronInfo?.last_run_trackers?.market_data_keys ||
        liveDebugHealth?.cronDetails?.marketData?.match(/(\d+)\s+jobs/)?.[1] ||
        0,
    );
    return [
      {
        key: "socket",
        label: "Socket topic",
        active: streamConnected,
        detail: `${chartTopicKey || "chart:n/a"} · ${connectionState || "idle"}`,
      },
      {
        key: "bars",
        label: `Last ${primaryDebugTf || "1m"} bar`,
        active: primaryDebugLastBarSec > 0 && Date.now() / 1000 - primaryDebugLastBarSec < 120,
        warning:
          primaryDebugLastBarSec > 0 && Date.now() / 1000 - primaryDebugLastBarSec >= 120,
        detail:
          primaryDebugLastBarSec > 0
            ? `${showDateTime(primaryDebugLastBarSec * 1000)} · ${formatDebugAgeMinutes(primaryDebugLastBarSec)} old`
            : "No bars loaded",
      },
      {
        key: "client-catchup",
        label: "Client tail catch-up",
        active: analysisCatchupActive,
        detail: analysisCatchupActive
          ? "60s timer active in chart-analysis/cache mode"
          : "Off for current mode/page",
      },
      {
        key: "auto-load",
        label: "Auto load on mount",
        active: autoLoadOnMount === true,
        detail: autoLoadOnMount ? "Enabled for this chart" : "Disabled for this chart",
      },
      {
        key: "cron-loop",
        label: "Server cron loop",
        active: String(liveDebugHealth?.cron || "").toLowerCase().startsWith("ok"),
        warning: cronInfo?.scheduler_running === false,
        detail: liveDebugHealth?.cron || liveDebugHealthError || "No health data",
      },
      {
        key: "market-cron",
        label: "Market-data cron jobs",
        active: marketDataJobs > 0,
        detail: liveDebugHealth?.cronDetails?.marketData || "No active market-data jobs",
      },
      {
        key: "binance",
        label: "Binance live producer",
        active: liveDebugHealth?.binanceEnabled === true,
        detail:
          liveDebugHealth?.binanceEnabled === true
            ? "Enabled"
            : "Disabled",
      },
      {
        key: "forex-ingestor",
        label: "Forex ingestor",
        active: !isCrypto,
        detail: isCrypto
          ? `${cleanSym || "symbol"} is crypto-like, so forex ingestor does not feed it`
          : "Can feed forex/CFD chart bar_update events",
      },
    ];
  }, [
    autoLoadOnMount,
    chartTopicKey,
    cleanSym,
    isBacktestChartReplay,
    isCacheLikeMode,
    liveDebugHealth,
    liveDebugHealthError,
    liveDebugTopicState,
    primaryDebugLastBarSec,
    primaryDebugTf,
    syncModeWithLocationHash,
  ]);

  const handleSaveMarketUiConfig = useCallback(() => {
    if (!canUseMarketUiConfig) return;
    setConfigSaveState("saving");
    const timeframeConfig = {};
    const nextSavedTfVisibleBars = {};
    const nextSavedTfViewportPrefs = {};
    for (const tf of sortedTfs || []) {
      const tfKey = String(tf || "").trim().toLowerCase();
      if (!tfKey) continue;
      const chartId = `${cleanSym}-${tfKey}`;
      const visibleBars = Number(savedTfVisibleBars?.[chartId]);
      if (Number.isFinite(visibleBars) && visibleBars > 0) {
        const normalizedVisibleBars = Math.max(2, Math.round(visibleBars));
        timeframeConfig[tfKey] = {
          visibleBars: normalizedVisibleBars,
        };
        nextSavedTfVisibleBars[chartId] = normalizedVisibleBars;
      }
    }
    const symbolConfig = {
      updatedAt: Date.now(),
      timeframes: timeframeConfig,
    };
    const nextMasterChartConfig = writeLocalMasterChartConfig({
      ...masterChartConfig,
      gridCols,
      indicatorVisibility,
    });
    setMasterChartConfig(nextMasterChartConfig);
    writeLocalMarketUiConfig(cleanSym, symbolConfig);
    api
      .upsertSetting({
        type: MASTER_CHART_SETTING_TYPE,
        name: MASTER_CHART_SETTING_NAME,
        data: nextMasterChartConfig,
      })
      .then(() => api.saveMarketDataUiConfig(cleanSym, symbolConfig))
      .then(() => {
        setSavedTfVisibleBars(nextSavedTfVisibleBars);
        setSavedTfViewportPrefs(nextSavedTfViewportPrefs);
        setConfigSaveState("saved");
        window.setTimeout(() => setConfigSaveState(""), 1200);
      })
      .catch(() => {
        setConfigSaveState("error");
        window.setTimeout(() => setConfigSaveState(""), 1800);
      });
  }, [
    canUseMarketUiConfig,
    cleanSym,
    gridCols,
    indicatorVisibility,
    localBarsCount,
    masterChartConfig,
    sortedTfs,
    viewports,
  ]);

  const handleCrosshairSync = useCallback(
    (payload) => {
      setSyncedCrosshair(payload);
      if (!payload?.active) return;
      if (
        activeChartId &&
        payload?.sourceId &&
        payload.sourceId !== activeChartId
      ) {
        // Sync
      }
    },
    [activeChartId],
  );

  const toggleTvSetting = (key) => {
    setTvSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAllTvSettings = () => {
    setTvSettings((prev) => {
      const allEnabled = !!(prev.sidebar && prev.toolbar && prev.legend);
      const next = !allEnabled;
      return {
        ...prev,
        sidebar: next,
        toolbar: next,
        legend: next,
      };
    });
  };

  const handleTvLogin = async (username, password) => {
    const res = await fetch("/api/tv/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `TV login failed - server returned non-JSON (${res.status}): ${text.slice(0, 100)}`,
      );
    }
    if (!data.ok) throw new Error(data.error || "Login failed");
    return data;
  };

  const handleDrawLine = useCallback(() => {
    if (!ctxMenu || !Number.isFinite(Number(ctxMenu.yRatio))) return;
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const price = Number(ctxMenu?.price);
    const time = Number(ctxMenu?.time);
    const lineColor = artifactTimeframeColor(ctxMenu?.interval || ctxMenu?.tf || "");
    setAnnotations((prev) =>
      dedupeManualLinesByPrice(
        [
          ...prev,
          {
            ...createLineObject({
              id,
              type: "LINE",
              color: lineColor,
              yRatio: Number(ctxMenu.yRatio),
              ctxMenu,
            }),
            tf: null,
            price_top: Number.isFinite(price) ? price : null,
            price_bottom: Number.isFinite(price) ? price : null,
            price: Number.isFinite(price) ? price : null,
            time: Number.isFinite(time) ? time : null,
            line_style: "dot",
            line_width: 0.1,
            bg_color: `${lineColor}14`,
            label: "Line",
          },
        ],
        id,
      ),
    );
    setSelectedObjectId(id);
    setCtxMenu(null);
  }, [ctxMenu]);

  const handleDrawSegment = useCallback(() => {
    if (!ctxMenu || !Number.isFinite(Number(ctxMenu.yRatio))) return;
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const price = Number(ctxMenu?.price);
    const time = Number(ctxMenu?.time);
    const lineColor = artifactTimeframeColor(
      ctxMenu?.interval || activeChartId?.split("-").slice(-1)[0] || "",
    );
    setAnnotations((prev) =>
      dedupeManualLinesByPrice(
        [
          ...prev,
          {
            ...createLineObject({
              id,
              type: "SEGMENT",
              color: lineColor,
              yRatio: Number(ctxMenu.yRatio),
              ctxMenu,
            }),
            tf: null,
            price_top: Number.isFinite(price) ? price : null,
            price_bottom: Number.isFinite(price) ? price : null,
            price: Number.isFinite(price) ? price : null,
            time: Number.isFinite(time) ? time : null,
            line_style: "dot",
            line_width: 0.1,
            bg_color: `${lineColor}12`,
            label: "Segment",
            line_scope: "segment",
          },
        ],
        id,
      ),
    );
    setSelectedObjectId(id);
    setCtxMenu(null);
  }, [activeChartId, ctxMenu]);

  const addObject = useCallback(
    (type, color, kind = "line") => {
      if (!ctxMenu) return;
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const price = Number(ctxMenu?.price);
      const time = Number(ctxMenu?.time);
      if (kind === "point") {
        setAnnotations((prev) => [
          ...prev,
          createPointObject({
            id,
            type,
            color,
            xRatio: Number(ctxMenu.xRatio || 0.5),
            yRatio: Number(ctxMenu.yRatio || 0.5),
            ctxMenu,
          }),
        ]);
        setSelectedObjectId(id);
      } else if (kind === "zone") {
        setDrawMode("zone");
      } else {
        setAnnotations((prev) =>
          dedupeManualLinesByPrice(
            [
              ...prev,
              {
                ...createLineObject({
                  id,
                  type,
                  color,
                  yRatio: Number(ctxMenu.yRatio || 0.5),
                  ctxMenu,
                }),
                tf: null,
                price_top: Number.isFinite(price) ? price : null,
                price_bottom: Number.isFinite(price) ? price : null,
                price: Number.isFinite(price) ? price : null,
                time: Number.isFinite(time) ? time : null,
                line_style: "dot",
                line_width: 0.1,
                bg_color: "rgba(255,255,255,0.14)",
                label: type,
              },
            ],
            id,
          ),
        );
        setSelectedObjectId(id);
      }
      setCtxMenu(null);
    },
    [ctxMenu],
  );

  const latestCachedPrice = useMemo(() => {
    const keys = Object.keys(master?.bars || {});
    const sorted = keys.sort((a, b) => tfRankForLatest(a) - tfRankForLatest(b));
    for (const k of sorted) {
      const bars = master?.bars?.[k] || [];
      if (!bars.length) continue;
      const close = Number(bars[bars.length - 1]?.close);
      if (Number.isFinite(close)) return close;
    }
    return null;
  }, [master]);

  const handleQuickTrade = useCallback(
    (side, explicitPrice = null) => {
      const sourceChartId = String(ctxMenu?.chartId || activeChartId || "");
      const activeTf = sourceChartId.split("-").slice(-1)[0];
      const activeBars = master?.bars?.[activeTf] || [];
      const activeLastClose = Number(activeBars[activeBars.length - 1]?.close);
      const usePrice = Number.isFinite(Number(explicitPrice))
        ? Number(explicitPrice)
        : Number.isFinite(Number(ctxMenu?.price))
          ? Number(ctxMenu?.price)
          : Number.isFinite(Number(hoverInfo?.price))
            ? Number(hoverInfo.price)
            : Number.isFinite(activeLastClose)
              ? activeLastClose
              : Number.isFinite(Number(latestCachedPrice))
                ? Number(latestCachedPrice)
                : null;
      if (!Number.isFinite(usePrice)) return;
      const payload = {
        symbol: cleanSym,
        side: String(side || "BUY").toUpperCase(),
        action: "ENTRY",
        plan_id: activePlanGroup,
        price: usePrice,
        time: ctxMenu?.time || null,
        interval: ctxMenu?.interval || null,
      };
      if (typeof onQuickTradeIntent === "function") {
        onQuickTradeIntent(payload);
      }
      setCtxMenu(null);
    },
    [
      ctxMenu,
      cleanSym,
      onQuickTradeIntent,
      hoverInfo,
      latestCachedPrice,
      activeChartId,
      master,
      activePlanGroup,
    ],
  );

  const handleQuickLevel = useCallback(
    (kind) => {
      const sourceChartId = String(ctxMenu?.chartId || activeChartId || "");
      const activeTf = sourceChartId.split("-").slice(-1)[0];
      const activeBars = master?.bars?.[activeTf] || [];
      const activeLastClose = Number(activeBars[activeBars.length - 1]?.close);
      const levelPrice = Number.isFinite(Number(ctxMenu?.price))
        ? Number(ctxMenu.price)
        : Number.isFinite(Number(hoverInfo?.price))
          ? Number(hoverInfo.price)
          : Number.isFinite(activeLastClose)
            ? activeLastClose
            : Number.isFinite(Number(latestCachedPrice))
              ? Number(latestCachedPrice)
              : null;
      if (!Number.isFinite(levelPrice)) return;
      const payload = {
        symbol: cleanSym,
        side: String(kind || "").toUpperCase() === "SL" ? "SL" : "TP",
        action: String(kind || "").toUpperCase(),
        plan_id: activePlanGroup,
        price: levelPrice,
        time: ctxMenu.time || null,
        interval: ctxMenu.interval || null,
      };
      if (typeof onQuickTradeIntent === "function") onQuickTradeIntent(payload);
      const isTp = String(kind || "").toUpperCase() === "TP";
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setAnnotations((prev) =>
        dedupeManualLinesByPrice(
          [
            ...prev,
            {
              ...createLineObject({
                id,
                type: isTp ? "TP" : "SL",
                color: isTp ? "#10b981" : "#ef4444",
                yRatio: Number(ctxMenu?.yRatio || 0.5),
                ctxMenu,
              }),
              kind: "line",
              visible: true,
              tf: null,
              price_top: levelPrice,
              price_bottom: levelPrice,
              price: levelPrice,
              time: Number.isFinite(Number(ctxMenu?.time))
                ? Number(ctxMenu?.time)
                : null,
              line_style: "dot",
              line_width: 0.1,
              label: isTp ? "TP" : "SL",
              bg_color: "transparent",
            },
          ],
          id,
        ),
      );
      setSelectedObjectId(id);
      setCtxMenu(null);
    },
    [
      ctxMenu,
      cleanSym,
      onQuickTradeIntent,
      hoverInfo,
      latestCachedPrice,
      activeChartId,
      master,
      activePlanGroup,
    ],
  );

  const handleClearLevel = useCallback(
    (kind) => {
      const payload = {
        symbol: cleanSym,
        side: String(kind || "").toUpperCase(),
        action: `CLEAR_${String(kind || "").toUpperCase()}`,
        plan_id: activePlanGroup,
        price: null,
        time: null,
        interval: null,
      };
      if (typeof onQuickTradeIntent === "function") onQuickTradeIntent(payload);
    },
    [cleanSym, onQuickTradeIntent, activePlanGroup],
  );

  return (
    <div
      ref={rootRef}
      className="browser-card-v1"
      style={{ position: "relative", width: "100%" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            onClick={() =>
              window.open(
                `/trades/analyze/${encodeURIComponent(String(symbol || "").toUpperCase())}`,
                "_self",
              )
            }
            title="AI analyze"
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              margin: 0,
              fontWeight: 800,
              fontSize: 14,
              color: "inherit",
              cursor: "pointer",
            }}
          >
            {symbol} &gt;
          </button>
          {showControls && (onToggleWatchlist || onRemove) && (
            <button
              className="secondary-button"
              style={{
                width: 18,


                lineHeight: 1,
                minWidth: 18,

                color: isInWatchlist ? "rgba(239,68,68,0.7)" : "var(--muted)",
                borderColor: isInWatchlist
                  ? "rgba(239,68,68,0.35)"
                  : "rgba(255,255,255,0.08)",
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (typeof onToggleWatchlist === "function")
                  onToggleWatchlist(symbol);
                else if (typeof onRemove === "function") onRemove(symbol);
              }}
              title={
                isInWatchlist ? "Remove from watchlist" : "Add to watchlist"
              }
            >
              {isInWatchlist ? "-" : "+"}
            </button>
          )}
          <GroupButtons
            items={chartModeItems}
            selectedItems={[pendingMode || mode]}
            selectionMode="single"
            onChange={(values) => {
              const nextMode = String(values?.[0] || "").trim().toLowerCase();
              if (!nextMode) return;
              if (nextMode === "__grid_larger__") {
                setGridCols((prev) => Math.max(1, prev - 1));
                return;
              }
              if (nextMode === "__grid_smaller__") {
                setGridCols((prev) => Math.min(6, prev + 1));
                return;
              }
              if (nextMode === "__snapshots__") {
                const gridTfs = buildSnapshotGridTfs(timeframes);
                const snapshotGridUrl =
                  "/api/chart/snapshots-grid/" +
                  encodeURIComponent(String(symbol || "").toUpperCase()) +
                  "?provider=" +
                  encodeURIComponent(String(provider || "")) +
                  "&tfs=" +
                  encodeURIComponent(gridTfs.join(","));
                setSnapshotGridModal({
                  title: `${String(symbol || "").toUpperCase()} Snapshots`,
                  url: snapshotGridUrl,
                });
                return;
              }
              if (nextMode === "__trade__") {
                window.open(
                  `/trades/manual/${encodeURIComponent(String(symbol || "").toUpperCase())}`,
                  "_self",
                );
                return;
              }
              handleModeClick(nextMode);
            }}
            border_type="multiple"
            itemsLayout="row"
            size="compact"
            className="symbol-chart-mode-tabs"
            ariaLabel={`${symbol} chart mode`}
            buttonStyle={{ fontSize: 11 }}
          />
          {analysisLiveBadge ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginLeft: 2,
              }}
            >
              <StatusDisplay
                status={analysisLiveBadge.status}
                label={analysisLiveBadge.label}
                size="mini"
                title={`${displayTfLabel(analysisStatusTf)} • ${analysisLiveBadge.title}`}
                tooltipContent={`${displayTfLabel(analysisStatusTf)} • ${analysisLiveBadge.title}`}
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--muted)",
                }}
              >
                {displayTfLabel(analysisStatusTf)}
              </span>
            </div>
          ) : null}
          {showLiveBarsToggle ? (
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginLeft: 6,
                fontSize: 11,
                fontWeight: 700,
                color: "var(--muted)",
                userSelect: "none",
              }}
              title={
                liveBarsEnabled
                  ? "Live bars on: chart-analysis keeps syncing and refreshing bars."
                  : "Live bars off: chart-analysis freezes bars at the currently loaded snapshot."
              }
            >
              <input
                type="checkbox"
                checked={liveBarsEnabled}
                onChange={(event) => setLiveBarsEnabled(event.target.checked)}
              />
              <span>Live bars</span>
            </label>
          ) : null}
          {showControls &&
            isInSelected &&
            typeof onRemoveSelected === "function" && (
              <button
                className="secondary-button"
                style={{
                  width: 18,


                  lineHeight: 1,
                  minWidth: 18,

                  color: "#fca5a5",
                  borderColor: "rgba(248,113,113,0.4)",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveSelected(symbol);
                }}
                title="Remove from selected symbols"
              >
                x
              </button>
            )}
          {(pendingMode || mode) === "snapshots" &&
            snapshotState?.message &&
            snapshotState.stage === "error" && (
              <span
                className="minor-text"
                style={{
                  fontSize: 9,
                  color: "#ef4444",
                }}
              >
                {snapshotState.message}
              </span>
            )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {typeof onTimeframesChange === "function" &&
          Array.isArray(timeframeOptions) &&
          timeframeOptions.length > 0 ? (
            <div ref={timeframeMenuRef} style={{ position: "relative" }}>
              <button
                type="button"
                className="secondary-button"
                style={{
                  minWidth: 120,
                  height: "30px",
                  padding: "0 10px",
                  fontSize: "12px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  borderColor: timeframeMenuOpen
                    ? "rgba(34,211,238,0.45)"
                    : "var(--border)",
                  color: timeframeMenuOpen ? "#22d3ee" : "inherit",
                  background: timeframeMenuOpen
                    ? "rgba(34,211,238,0.10)"
                    : undefined,
                }}
                onClick={() => setTimeframeMenuOpen((open) => !open)}
                title="Chart timeframes"
              >
                <span>{timeframeSummaryLabel}</span>
                <span style={{ fontSize: 10, opacity: 0.8 }}>▼</span>
              </button>
              {timeframeMenuOpen ? (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    right: 0,
                    width: 260,
                    maxHeight: 420,
                    overflowY: "auto",
                    zIndex: 40,
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(9,15,28,0.96)",
                    boxShadow: "0 18px 48px rgba(0,0,0,0.28)",
                    padding: 12,
                  }}
                >
                  {Array.isArray(timeframePresets) && timeframePresets.length > 0 ? (
                    <>
                      <div
                        style={{
                          fontSize: 10,
                          textTransform: "uppercase",
                          letterSpacing: 0.08,
                          color: "var(--muted)",
                          marginBottom: 8,
                        }}
                      >
                        Templates
                      </div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {timeframePresets.map((preset) => {
                          const active = activeTimeframePreset?.value === preset.value;
                          return (
                            <button
                              key={preset.value}
                              type="button"
                              className="secondary-button"
                              style={{
                                width: "100%",
                                justifyContent: "flex-start",
                                borderColor: active
                                  ? "rgba(34,211,238,0.45)"
                                  : "rgba(255,255,255,0.08)",
                                color: active ? "#22d3ee" : "inherit",
                                background: active
                                  ? "rgba(34,211,238,0.10)"
                                  : undefined,
                              }}
                              onClick={() => {
                                const next = sortTimeframes(
                                  (Array.isArray(preset?.tfs) ? preset.tfs : [])
                                    .map((tf) =>
                                      String(tf || "")
                                        .trim()
                                        .toLowerCase(),
                                    )
                                    .filter(Boolean),
                                  "desc",
                                );
                                if (next.length) onTimeframesChange(next);
                              }}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                      <div
                        style={{
                          height: 1,
                          background: "rgba(255,255,255,0.08)",
                          margin: "12px 0",
                        }}
                      />
                    </>
                  ) : null}
                  <div
                    style={{
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: 0.08,
                      color: "var(--muted)",
                      marginBottom: 8,
                    }}
                  >
                    Individual TFs
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    {timeframeOptions.map((option) => {
                      const optionValue = String(option?.value || "")
                        .trim()
                        .toLowerCase();
                      const active = normalizedSelectedTfs.includes(optionValue);
                      return (
                        <button
                          key={optionValue}
                          type="button"
                          className="secondary-button"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minWidth: 44,
                            height: 28,
                            padding: "0 10px",
                            borderRadius: 999,
                            borderColor: active
                              ? "rgba(34,211,238,0.55)"
                              : "rgba(255,255,255,0.12)",
                            background: active
                              ? "rgba(34,211,238,0.10)"
                              : "rgba(15,23,42,0.55)",
                            color: active ? "#22d3ee" : "inherit",
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                          onClick={() => {
                            const nextSet = new Set(normalizedSelectedTfs);
                            if (nextSet.has(optionValue)) {
                              if (nextSet.size === 1) return;
                              nextSet.delete(optionValue);
                            } else {
                              nextSet.add(optionValue);
                            }
                            onTimeframesChange(sortTimeframes([...nextSet], "desc"));
                          }}
                        >
                          {option?.label || optionValue}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {isCacheLikeMode && (
            <div style={{ position: "relative" }}>
              <button
                className="secondary-button"
                style={{
                  lineHeight: 1,
                  fontWeight: 700,
                  borderColor: showIndicatorsMenu
                    ? "rgba(34,211,238,0.45)"
                    : "var(--border)",
                  color: showIndicatorsMenu ? "#22d3ee" : "inherit",
                  background: showIndicatorsMenu
                    ? "rgba(34,211,238,0.10)"
                    : undefined,
                }}
                onClick={() => setShowIndicatorsMenu((open) => !open)}
                title="Toggle layers, artifacts, and calculated indicators for all TF charts"
              >
                Layers
              </button>
              {showIndicatorsMenu && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 380,
                    maxWidth: "min(380px, calc(100vw - 24px))",
                    maxHeight: 520,
                    overflowY: "auto",
                    zIndex: 40,
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(9,15,28,0.96)",
                    boxShadow: "0 18px 48px rgba(0,0,0,0.28)",
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 10,
                      fontSize: 12,
                      fontWeight: 800,
                      letterSpacing: "0.12em",
                      color: "#cbd5e1",
                    }}
                  >
                    <span>LAYERS</span>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      {canUseMarketUiConfig ? (
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={handleSaveMarketUiConfig}
                          disabled={configSaveState === "saving"}
                          title="Save chart config"
                          style={{
                            fontWeight: 700,
                            minWidth: 42,
                            color:
                              configSaveState === "saved"
                                ? "#10b981"
                                : configSaveState === "error"
                                  ? "#ef4444"
                                  : "inherit",
                            borderColor:
                              configSaveState === "saved"
                                ? "rgba(16,185,129,0.45)"
                                : configSaveState === "error"
                                  ? "rgba(239,68,68,0.45)"
                                  : "var(--border)",
                          }}
                        >
                          {configSaveState === "saving"
                            ? "..."
                            : configSaveState === "saved"
                              ? "Saved"
                              : "Save"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setShowIndicatorsMenu(false)}
                        title="Close layers panel"
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "inherit",
                          cursor: "pointer",
                          lineHeight: 1,
                        }}
                      >
                        x
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 12 }}>
                    <GroupButtons
                      items={LAYERS_TAB_ITEMS}
                      selectedItems={[activeLayersTab]}
                      onChange={(values) => setActiveLayersTab(String(values?.[0] || "chart"))}
                      border_type="multiple"
                      itemsLayout="row"
                      size="md"
                      ariaLabel="Layers tabs"
                      style={{ width: "100%" }}
                    />
                    <div
                      style={{
                        display: "grid",
                        gap: 8,
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.06)",
                        background: "rgba(255,255,255,0.015)",
                        padding: 10,
                      }}
                    >
                      {activeLayersTab === "chart" ? (
                        <>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              letterSpacing: "0.08em",
                              color: "#94a3b8",
                              textTransform: "uppercase",
                            }}
                          >
                            Chart
                          </div>
                          {artifactPanelTimeframes.length ? (
                            <div style={{ display: "grid", gap: 6 }}>
                              <div
                                style={{
                                  fontSize: 10,
                                  fontWeight: 800,
                                  letterSpacing: "0.08em",
                                  color: "#64748b",
                                  textTransform: "uppercase",
                                }}
                              >
                                Timeframes
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 6,
                                }}
                              >
                                {artifactPanelTimeframes.map(({ tfKey, label, color, count, visible }) => (
                                  <button
                                    key={tfKey}
                                    type="button"
                                    onClick={() => toggleArtifactTfVisibility(tfKey)}
                                    title={`${label} artifacts · ${count} item${count === 1 ? "" : "s"}`}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 6,
                                      padding: "4px 8px",
                                      borderRadius: 999,
                                      border: `1px solid ${visible ? color : "rgba(148,163,184,0.28)"}`,
                                      background: visible ? `${color}1a` : "rgba(15,23,42,0.6)",
                                      color: visible ? "#e2e8f0" : "#94a3b8",
                                      fontSize: 11,
                                      fontWeight: 700,
                                      cursor: "pointer",
                                    }}
                                  >
                                    <span
                                      style={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: 999,
                                        background: color,
                                        boxShadow: visible ? `0 0 0 3px ${color}22` : "none",
                                      }}
                                    />
                                    <span>{label}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          <label
                            style={{
                              display: "grid",
                              gridTemplateColumns: "18px minmax(0, 1fr)",
                              alignItems: "center",
                              gap: 12,
                              padding: "6px 0",
                              fontSize: 12,
                              color: "#e2e8f0",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={indicatorVisibility.rsiPanel !== false}
                              onChange={(evt) =>
                                setIndicatorVisibility((prev) => ({
                                  ...prev,
                                  rsiPanel: evt.target.checked,
                                }))
                              }
                            />
                            <span>Momentum Panel</span>
                          </label>
                          <label
                            style={{
                              display: "grid",
                              gridTemplateColumns: "18px minmax(0, 1fr)",
                              alignItems: "center",
                              gap: 12,
                              padding: "6px 0",
                              fontSize: 12,
                              color: "#e2e8f0",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={showStrategyMarkers}
                              onChange={(evt) =>
                                setShowStrategyMarkers(evt.target.checked)
                              }
                            />
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <span
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: 999,
                                  background: "#38bdf8",
                                  boxShadow: "0 0 0 3px #38bdf822",
                                }}
                              />
                              Strategy Buy/Sell Markers
                            </span>
                          </label>
                          <label
                            style={{
                              display: "grid",
                              gridTemplateColumns: "18px minmax(0, 1fr)",
                              alignItems: "center",
                              gap: 12,
                              padding: "6px 0",
                              fontSize: 12,
                              color: "#e2e8f0",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={indicatorVisibility.zigzag !== false}
                              onChange={(evt) =>
                                setIndicatorVisibility((prev) => ({
                                  ...prev,
                                  zigzag: evt.target.checked,
                                  candles: true,
                                }))
                              }
                            />
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <span
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: 999,
                                  background: "#facc15",
                                  boxShadow: "0 0 0 3px #facc1522",
                                }}
                              />
                              Zigzag/Candles
                            </span>
                          </label>
                        </>
                      ) : null}
                      {activeLayersTab === "artifacts" ? (
                        <>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 800,
                                letterSpacing: "0.08em",
                                color: "#94a3b8",
                                textTransform: "uppercase",
                              }}
                            >
                              Artifacts
                            </div>
                            <div style={{ fontSize: 10, color: "#64748b" }}>
                              {artifactPanelGroups.length
                                ? `${artifactPanelGroups.length} types`
                                : "No artifacts loaded"}
                            </div>
                          </div>
                          <div style={{ display: "grid", gap: 6 }}>
                            {artifactPanelGroups.length ? (
                              artifactPanelGroups.map(({ groupKey, label, color, count, visible }) => {
                                const itemTitle = label;
                                const itemDetails = `${count} item${count === 1 ? "" : "s"}`;
                                return (
                                  <label
                                    key={groupKey}
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: "18px 12px minmax(0, 1fr)",
                                      gap: 12,
                                      alignItems: "start",
                                      padding: "6px 0",
                                      cursor: "pointer",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={visible}
                                      onChange={() => toggleArtifactGroupVisibility(groupKey)}
                                      style={{ marginTop: 1 }}
                                    />
                                    <span
                                      style={{
                                        width: 8,
                                        height: groupKey === "fvg" || groupKey === "ob" ? 8 : 2,
                                        borderRadius:
                                          groupKey === "swings" || groupKey === "patterns" ? 999 : 2,
                                        background:
                                          groupKey === "fvg" || groupKey === "ob" ? `${color}33` : color,
                                        border: `1px solid ${color}`,
                                        display: "inline-block",
                                        justifySelf: "center",
                                      }}
                                    />
                                    <span style={{ minWidth: 0 }}>
                                      <div
                                        style={{
                                          fontSize: 12,
                                          color: visible ? "#e2e8f0" : "#64748b",
                                          whiteSpace: "nowrap",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                        }}
                                        title={itemTitle}
                                      >
                                        {itemTitle}
                                      </div>
                                      <div
                                        style={{
                                          display: "grid",
                                          gap: 2,
                                          fontSize: 9,
                                          color: visible ? "#94a3b8" : "#475569",
                                          lineHeight: 1.3,
                                        }}
                                      >
                                        <div>{itemDetails}</div>
                                      </div>
                                    </span>
                                  </label>
                                );
                              })
                            ) : (
                              <div style={{ fontSize: 11, color: "#64748b", padding: "2px 0 8px" }}>
                                Open or scroll a chart window to auto-load artifact layers, or use the
                                button above to rebuild them from scratch.
                              </div>
                            )}
                          </div>
                        </>
                      ) : null}
                      {activeLayersTab === "momentum" ? (
                        <>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              letterSpacing: "0.08em",
                              color: "#94a3b8",
                              textTransform: "uppercase",
                            }}
                          >
                            Momentum
                          </div>
                          {momentumLayerItems.map((item) => {
                            const active = indicatorVisibility[item.key] !== false;
                            return (
                              <label
                                key={item.key}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "18px minmax(0, 1fr)",
                                  alignItems: "center",
                                  gap: 12,
                                  padding: "6px 0",
                                  fontSize: 12,
                                  color: "#e2e8f0",
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={active}
                                  onChange={(evt) =>
                                    setIndicatorVisibility((prev) => ({
                                      ...prev,
                                      [item.key]: evt.target.checked,
                                    }))
                                  }
                                />
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 8,
                                  }}
                                >
                                  <span
                                    style={{
                                      width: 8,
                                      height: 8,
                                      borderRadius: 999,
                                      background: item.color,
                                      boxShadow: `0 0 0 3px ${item.color}22`,
                                    }}
                                  />
                                  {item.label}
                                </span>
                              </label>
                            );
                          })}
                        </>
                      ) : null}
                      {activeLayersTab === "trend" ? (
                        <>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              letterSpacing: "0.08em",
                              color: "#94a3b8",
                              textTransform: "uppercase",
                            }}
                          >
                            Trend
                          </div>
                          {trendLayerItems.map((item) => {
                            const active = indicatorVisibility[item.key] !== false;
                            return (
                              <label
                                key={item.key}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "18px minmax(0, 1fr)",
                                  alignItems: "center",
                                  gap: 12,
                                  padding: "6px 0",
                                  fontSize: 12,
                                  color: "#e2e8f0",
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={active}
                                  onChange={(evt) =>
                                    setIndicatorVisibility((prev) => ({
                                      ...prev,
                                      [item.key]: evt.target.checked,
                                    }))
                                  }
                                />
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 8,
                                  }}
                                >
                                  <span
                                    style={{
                                      width: 8,
                                      height: 8,
                                      borderRadius: 999,
                                      background: item.color,
                                      boxShadow: `0 0 0 3px ${item.color}22`,
                                    }}
                                  />
                                  {item.label}
                                </span>
                              </label>
                            );
                          })}
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {isCacheLikeMode && (
            <>
              <div ref={liveDebugMenuRef} style={{ position: "relative" }}>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowLiveDebugMenu((open) => !open)}
                  title="Inspect live/socket/cron auto-update pipeline for this symbol"
                  style={{
                    fontWeight: 700,
                    minWidth: 32,
                    color: showLiveDebugMenu ? "#22d3ee" : "#94a3b8",
                    borderColor: showLiveDebugMenu
                      ? "rgba(34,211,238,0.45)"
                      : "rgba(148,163,184,0.28)",
                    background: showLiveDebugMenu
                      ? "rgba(34,211,238,0.12)"
                      : "rgba(15,23,42,0.58)",
                  }}
                >
                  Debug
                </button>
                {showLiveDebugMenu ? (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 8px)",
                      right: 0,
                      width: 360,
                      maxWidth: "min(360px, calc(100vw - 24px))",
                      zIndex: 55,
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(9,15,28,0.97)",
                      boxShadow: "0 18px 48px rgba(0,0,0,0.32)",
                      padding: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        marginBottom: 10,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            letterSpacing: "0.1em",
                            color: "#e2e8f0",
                          }}
                        >
                          LIVE DEBUG
                        </div>
                        <div
                          style={{
                            marginTop: 2,
                            fontSize: 11,
                            color: "#94a3b8",
                          }}
                        >
                          {String(cleanSym || symbol || "").toUpperCase()} · {displayTfLabel(primaryDebugTf || "1m")}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowLiveDebugMenu(false)}
                        title="Close live debug"
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "#94a3b8",
                          cursor: "pointer",
                          lineHeight: 1,
                          padding: 0,
                        }}
                      >
                        x
                      </button>
                    </div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {liveDebugRows.map((row) => {
                        const tone = debugTone(row.active, row.warning);
                        return (
                          <div
                            key={row.key}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "10px minmax(0, 1fr)",
                              gap: 10,
                              padding: "8px 10px",
                              borderRadius: 10,
                              border: "1px solid rgba(255,255,255,0.06)",
                              background: "rgba(255,255,255,0.02)",
                            }}
                          >
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                marginTop: 4,
                                borderRadius: 999,
                                background: tone,
                                boxShadow: `0 0 0 3px ${tone}22`,
                              }}
                            />
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 800,
                                  color: "#e2e8f0",
                                }}
                              >
                                {row.label}
                              </div>
                              <div
                                style={{
                                  marginTop: 2,
                                  fontSize: 11,
                                  lineHeight: 1.4,
                                  color: "#94a3b8",
                                  wordBreak: "break-word",
                                }}
                              >
                                {row.detail}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {liveDebugHealthError ? (
                        <div
                          style={{
                            padding: "8px 10px",
                            borderRadius: 10,
                            border: "1px solid rgba(239,68,68,0.18)",
                            background: "rgba(127,29,29,0.2)",
                            color: "#fca5a5",
                            fontSize: 11,
                            lineHeight: 1.45,
                            wordBreak: "break-word",
                          }}
                        >
                          Health check error: {liveDebugHealthError}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={handleRefreshChartsAndArtifacts}
                title="Refresh latest bars for all loaded chart timeframes and recalculate artifacts for those windows"
                style={{
                  fontWeight: 700,
                  minWidth: 32,
                  color: "#60a5fa",
                  borderColor: "#60a5fa66",
                  background: "#60a5fa22",
                }}
              >
                Refresh
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={handleManualChartFix}
                title="If you panned left beyond the first loaded bar, load older history for those charts; otherwise just re-draw and re-apply viewport/lines"
                style={{
                fontWeight: 700,
                minWidth: 38,
              }}
              >
                <ViewportNavIcon action="fit_trade" />
              </button>
            </>
          )}
          {(mode === "cache" || mode === REPLAY_MODE) && effectiveReplayConfig?.enabled ? (
            <>
              {replayClockLabel ? (
                <span
                  className="minor-text"
                  title={
                    replayBarProgressText
                      ? `${replayBarProgressText} elapsed in replay window`
                      : "Current replay time"
                  }
                >
                  {replayClockLabel}
                </span>
              ) : null}
              <InputComboSelect
                value={String(effectiveReplayConfig?.speedMs || "")}
                onChange={(event) =>
                  effectiveReplayConfig?.onSpeedChange?.(
                    Number(event.target.value) || 1000,
                  )
                }
                style={{ minWidth: 88 }}
                disabled={!replaySpeedOptions.length}
              >
                {replaySpeedOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </InputComboSelect>
              <button
                type="button"
                className={
                  effectiveReplayConfig?.playing ? "primary-button" : "secondary-button"
                }
                onClick={() => {
                  if (!hasExternalReplayConfig && mode !== REPLAY_MODE) {
                    enterReplayMode();
                    window.setTimeout(() => {
                      effectiveReplayConfig?.onToggle?.();
                    }, 0);
                    return;
                  }
                  effectiveReplayConfig?.onToggle?.();
                }}
                disabled={!replayCanStart}
                title={
                  effectiveReplayConfig?.playing
                    ? "Pause replay for this chart set"
                    : "Start replay for this chart set"
                }
              >
                {effectiveReplayConfig?.playing ? "Pause" : "Replay"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {(() => {
        const displayTfs =
          isMasterSnapshotMode && sortedTfs.length
            ? [String(sortTimeframes(sortedTfs, "asc")?.[0] || sortedTfs[0])]
            : sortedTfs;
        return (
          <div
            ref={gridRef}
            className="chart-grid-area"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${activeGridCols}, 1fr)`,
              gap: 8,
            }}
          >
            {displayTfs.map((tf) => {
              const isLive = mode === "live";
              const isSvg = mode === "svg";
              const context = getTimeframeValue(master?.context, tf);
              const chartId = `${cleanSym}-${String(tf).toLowerCase()}`;
              const manualVisibleBars = Number(manualTfVisibleBars?.[chartId]);
              const savedVisibleBars = Number(savedTfVisibleBars?.[chartId]);
              const fetchedVisibleBars = Number(selectedTradeFetchBarsCountByTf?.[String(tf).toLowerCase()]);
              const baseVisibleBars =
                manualVisibleBars > 0
                  ? manualVisibleBars
                  : shouldLoadTradeFocusedData &&
                      Number.isFinite(fetchedVisibleBars) &&
                      fetchedVisibleBars > 0
                    ? Math.max(savedVisibleBars > 0 ? savedVisibleBars : 0, fetchedVisibleBars)
                    : savedVisibleBars > 0
                      ? savedVisibleBars
                      : visibleBarsDefaultForTf(masterChartConfig, tf);
              const initialVisibleBars =
                manualVisibleBars > 0
                  ? manualVisibleBars
                  : baseVisibleBars;
              const barsForTf = Array.isArray(getTimeframeValue(master?.bars, tf))
                ? getTimeframeValue(master?.bars, tf)
                : [];
              const createdAtSec = effectiveCreatedAtSec;
              const openedAtSec = effectiveOpenedAtSec;
              const closedAtSec = effectiveClosedAtSec;
              const anchoredBarsForTf =
                shouldLoadTradeFocusedData &&
                !isBacktestChartReplay &&
                !(manualVisibleBars > 0) &&
                barsForTf.length > 0
                  ? resolveTradeFocusedBars(barsForTf, {
                      createdAt: effectiveCreatedAt,
                      openedAt: effectiveOpenedAt,
                      closedAt: effectiveClosedAt,
                      createdAtSec,
                      openedAtSec,
                      closedAtSec,
                      requestedBars: initialVisibleBars,
                    })
                  : barsForTf;
              const tradeFocusedBarsForTf =
                Array.isArray(anchoredBarsForTf) && anchoredBarsForTf.length > 0
                  ? anchoredBarsForTf
                  : barsForTf;
              const shouldRenderFullTradeRun =
                showEventMarkers &&
                normalizedTrades.length > 1 &&
                !isBacktestChartReplay;
              const replayBarsForTf =
                isBacktestChartReplay &&
                Array.isArray(replayBarsByTf?.[tf]) &&
                replayBarsByTf[tf].length > 0
                  ? replayBarsByTf[tf]
                  : tradeFocusedBarsForTf;
              const tradeChartBarsForTf = resolveTradeChartRenderBars({
                loadedBars:
                  shouldRenderFullTradeRun && Array.isArray(barsForTf)
                    ? barsForTf
                    : barsForTf,
                focusedBars:
                  shouldRenderFullTradeRun && Array.isArray(barsForTf)
                    ? barsForTf
                    : tradeFocusedBarsForTf,
                replayBars: replayBarsForTf,
                replayActive: isBacktestChartReplay,
              });
              const primaryBarsToRender =
                isSvg && !isBacktestChartReplay
                  ? tradeFocusedBarsForTf.length
                    ? tradeFocusedBarsForTf
                    : barsForTf
                  : tradeChartBarsForTf;
              const fallbackRenderableBars =
                !isLive && !isBacktestChartReplay
                  ? lastRenderableBarsByChartIdRef.current[chartId] || []
                  : [];
              const barsToRender =
                primaryBarsToRender.length > 0
                  ? primaryBarsToRender
                  : Array.isArray(fallbackRenderableBars) &&
                      fallbackRenderableBars.length > 0
                    ? fallbackRenderableBars
                    : primaryBarsToRender;
              const replayCurrentBarTimeSec = isBacktestChartReplay
                ? Number(replayClockTimeSec) || null
                : null;
              const tradeDisplayEventSec =
                (Number.isFinite(openedAtSec) && openedAtSec > 0
                  ? openedAtSec
                  : null) ||
                createdAtSec ||
                closedAtSec ||
                null;
              const tradeObjectsVisible =
                !isBacktestChartReplay ||
                !Number.isFinite(replayCurrentBarTimeSec) ||
                !Number.isFinite(tradeDisplayEventSec) ||
                replayCurrentBarTimeSec >= tradeDisplayEventSec;
              const createdMarkerVisible =
                !isBacktestChartReplay ||
                !Number.isFinite(createdAtSec) ||
                (Number.isFinite(replayCurrentBarTimeSec) &&
                  replayCurrentBarTimeSec >= createdAtSec);
              const openedMarkerVisible =
                !isBacktestChartReplay ||
                !Number.isFinite(openedAtSec) ||
                (Number.isFinite(replayCurrentBarTimeSec) &&
                  replayCurrentBarTimeSec >= openedAtSec);
              const closedMarkerVisible =
                !isBacktestChartReplay ||
                !Number.isFinite(closedAtSec) ||
                (Number.isFinite(replayCurrentBarTimeSec) &&
                  replayCurrentBarTimeSec >= closedAtSec);
              const hasBars = barsToRender.length > 0;
              const noData = !isLive && !hasBars && status !== "LOADING";
              const tfViewport = viewports[chartId] || null;
              const tfRange = barsRange(barsToRender);

              const projectedAnnotations = (annotations || [])
                .filter(
                  (a) =>
                    !a.tf ||
                    String(a.tf).toLowerCase() === String(tf).toLowerCase(),
                )
                .map((a) => {
                  const baseTime = Number(a.time);
                  const lineTime =
                    Number.isFinite(baseTime) && baseTime > 0
                      ? baseTime
                      : toEpochMs(a.anchorTimeMs);
                  const lineTop = Number(a.price ?? a.price_top);
                  const lineBottom = Number(
                    a.price ?? a.price_bottom ?? a.price_top,
                  );
                  const p1 = Number.isFinite(lineTop)
                    ? lineTop
                    : Number(a.anchorPrice);
                  const p2 = Number.isFinite(lineBottom)
                    ? lineBottom
                    : Number(a.anchorPrice2);
                  const timeRatio = ratioFromAnchorTime(lineTime, tfRange);
                  const priceRatio = ratioFromAnchorPrice(p1, tfRange);
                  const priceRatio2 = ratioFromAnchorPrice(p2, tfRange);
                  const x1TimeRatio = ratioFromAnchorTime(
                    toEpochMs(a.anchorTimeMs),
                    tfRange,
                  );
                  const x2TimeRatio = ratioFromAnchorTime(
                    toEpochMs(a.anchorTimeMs2),
                    tfRange,
                  );
                  return {
                    ...a,
                    _xRatio: Number.isFinite(timeRatio)
                      ? timeRatio
                      : clamp01(Number(a.xRatio ?? 0.5)),
                    _yRatio: Number.isFinite(priceRatio)
                      ? priceRatio
                      : clamp01(Number(a.yRatio ?? 0.5)),
                    _y1Ratio: Number.isFinite(priceRatio)
                      ? priceRatio
                      : clamp01(Number(a.y1Ratio ?? 0.4)),
                    _y2Ratio: Number.isFinite(priceRatio2)
                      ? priceRatio2
                      : clamp01(Number(a.y2Ratio ?? 0.6)),
                    _x1Ratio: Number.isFinite(x1TimeRatio)
                      ? x1TimeRatio
                      : clamp01(Number(a.x1Ratio ?? 0.2)),
                    _x2Ratio: Number.isFinite(x2TimeRatio)
                      ? x2TimeRatio
                      : clamp01(Number(a.x2Ratio ?? 0.8)),
                  };
                })
                .filter((a) => {
                  if (a.kind === "line") {
                    return (
                      Number.isFinite(Number(a._yRatio)) &&
                      Number(a._yRatio) >= 0 &&
                      Number(a._yRatio) <= 1
                    );
                  }
                  if (a.kind === "point") {
                    return (
                      Number.isFinite(Number(a._xRatio)) &&
                      Number.isFinite(Number(a._yRatio)) &&
                      Number(a._xRatio) >= 0 &&
                      Number(a._xRatio) <= 1 &&
                      Number(a._yRatio) >= 0 &&
                      Number(a._yRatio) <= 1
                    );
                  }
                  if (a.kind === "zone") {
                    const y1 = Number(a._y1Ratio);
                    const y2 = Number(a._y2Ratio);
                    const x1 = Number(a._x1Ratio);
                    const x2 = Number(a._x2Ratio);
                    const yIn =
                      Number.isFinite(y1) &&
                      Number.isFinite(y2) &&
                      !(Math.max(y1, y2) < 0 || Math.min(y1, y2) > 1);
                    const xIn =
                      Number.isFinite(x1) &&
                      Number.isFinite(x2) &&
                      !(Math.max(x1, x2) < 0 || Math.min(x1, x2) > 1);
                    return yIn && xIn;
                  }
                  return true;
                });

              const annotationObjects = (annotations || [])
                .filter(
                  (a) =>
                    a?.visible !== false &&
                    (!a.tf ||
                      String(a.tf).toLowerCase() === String(tf).toLowerCase()),
                )
                .map((a) => ({
                  ...a,
                  label: formatObjectLabel(a.type, a.label || ""),
                }));
              const artifactObjects = Object.entries(
                artifactObjectsByChartId || {},
              ).flatMap(([sourceChartId, itemsRaw]) => {
                const items = Array.isArray(itemsRaw) ? itemsRaw : [];
                if (!items.length) return [];
                const sourceTf =
                  String(items[0]?.source_tf || items[0]?.tf || "")
                    .trim()
                    .toLowerCase() ||
                  String(sourceChartId || "")
                    .split("-")
                    .slice(1)
                    .join("-")
                    .trim()
                    .toLowerCase();
                if (!shouldShowArtifactSourceTf(sourceTf, tf)) return [];
                return items.map((item) => ({
                  ...item,
                  color: artifactTimeframeColor(
                    item?.source_tf || item?.tf || sourceTf,
                  ),
                })).filter((item) => {
                  const itemTfKey = artifactSourceTfLabel(
                    item?.source_tf || item?.tf || sourceTf,
                  );
                  if (!itemTfKey) return true;
                  return artifactTfVisibility?.[itemTfKey] !== false;
                });
              });
              const sharedChartObjects = isBacktestChartReplay
                ? []
                : [
                    ...(
                      showStrategyMarkers &&
                      Array.isArray(strategyMarkerObjectsByTf?.[tf.toLowerCase()])
                        ? strategyMarkerObjectsByTf[tf.toLowerCase()]
                        : []
                    ),
                    ...artifactObjects,
                    ...annotationObjects,
                  ];
              const isActiveTf = activeChartId === chartId;

              return (
                <div
                  key={`${mode}-${tf}`}
                  ref={(node) => {
                    if (node) {
                      chartTileRefs.current[chartId] = node;
                    } else if (chartTileRefs.current?.[chartId]) {
                      delete chartTileRefs.current[chartId];
                    }
                  }}
                  style={{
                    minWidth: 0,
                    position: "relative",
                    border: "1px solid",
                    borderColor: isActiveTf ? "#22d3ee" : "transparent",
                    borderRadius: 8,
                    overflow: "hidden",
                    padding: 0,
                  }}
                  onMouseEnter={() => setActiveChartId(chartId)}
                  onMouseDown={() => setActiveChartId(chartId)}
                  onMouseMove={() => {
                    if (activeChartId !== chartId) setActiveChartId(chartId);
                  }}
                >
                  <TfHeader
                    tf={tf}
                    symbol={cleanSym}
                    provider={provider}
                    context={context}
                    master={master}
                    renderedBars={barsToRender}
                    viewport={tfViewport}
                        mode={mode}
                    analysisSnapshot={analysisSnapshot}
                    barsStatus={barsStatus}
                    snapshotStatus={snapshotStatus}
                    onRefreshTf={isCacheLikeMode ? handleRefreshTf : null}
                    onLoadMoreTf={isCacheLikeMode ? handleLoadMoreTf : null}
                    onRepairTf={isCacheLikeMode ? handleRepairTf : null}
                    onRefreshTfLatest={isCacheLikeMode ? handleRefreshTfLatest : null}
                    onLoadTfHistory={isCacheLikeMode ? handleLoadTfHistory : null}
                    onViewportNavigate={isCacheLikeMode ? handleViewportNavigate : null}
                    repairBusy={repairingTfKey === String(tf || "").trim().toLowerCase()}
                    forceRefresh={forceRefresh}
                    allowHistoryRefresh={!selectedTradeViewportEndTimeSec}
                    showLiveStatus={!showAnalysisHeaderLiveStatus && !replayDisablesLive}
                    liveStatusMode={analysisHeaderStatusMode}
                  />
                  {!replayDisablesLive ? (
                    <RealtimeTfAnalysisOverlay
                      analysisByTf={multiTfAnalysisByTf}
                      orderedTfs={analysisOrderedTfs}
                      activeTf={tf}
                    />
                  ) : null}
                  {isLive ? (
                    <div style={{ position: "relative", height: chartHeight }}>
                      {(() => {
                        const tvSymbol = toTradingViewSymbol(
                          cleanSym,
                          provider,
                        );
                        const tvInterval = liveTfToTvInterval(tf);
                        const tvUrl = `${TRADINGVIEW_CHART_URL}?symbol=${encodeURIComponent(tvSymbol)}&interval=${encodeURIComponent(tvInterval)}`;
                        return (
                          <button
                            type="button"
                            aria-label={`Open ${tvSymbol} ${displayTfLabel(tf)} in TradingView`}
                            title={`Open ${tvSymbol} ${displayTfLabel(tf)} in TradingView`}
                            onClick={() => {
                              window.open(
                                tvUrl,
                                "_blank",
                                "noopener,noreferrer",
                              );
                            }}
                            style={{
                              position: "absolute",
                              left: 13,
                              bottom: 42,
                              width: 34,

                              border: "none",

                              background: "transparent",
                              cursor: "pointer",
                              zIndex: 12,

                            }}
                          />
                        );
                      })()}
                      {tvEmbedAutoloadEnabled ? (
                        <iframe
                          key={`tv-${toTradingViewSymbol(cleanSym, provider)}-${liveTfToTvInterval(tf)}`}
                          title={`tv-${symbol}-${tf}`}
                          className="browser-chart-v1"
                          style={{
                            width: "100%",
                            height: "100%",
                            border: "none",
                          }}
                          src={`https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(toTradingViewSymbol(cleanSym, provider))}&interval=${encodeURIComponent(liveTfToTvInterval(tf))}&theme=${uiThemeMode}&style=1&locale=en&toolbarbg=${uiThemeMode === "light" ? "%23eef3f8" : "%230f1729"}&hide_side_toolbar=${tvSettings.sidebar ? "0" : "1"}&hide_top_toolbar=${tvSettings.toolbar ? "0" : "1"}&hide_legend=${tvSettings.legend ? "0" : "1"}&saveimage=0&timezone=${encodeURIComponent(tvTimezone)}`}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: 6,
                            border: "1px solid rgba(148, 163, 184, 0.18)",
                            background:
                              uiThemeMode === "light"
                                ? "linear-gradient(180deg, rgba(248,250,252,0.98), rgba(226,232,240,0.95))"
                                : "linear-gradient(180deg, rgba(15,23,42,0.92), rgba(2,6,23,0.98))",
                            color: "var(--muted)",
                            textAlign: "center",
                            padding: 18,
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                              TradingView will auto-load after your first interaction
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.85 }}>
                              Click, tap, or press any key once to enable embedded live charts.
                            </div>
                          </div>
                        </div>
                      )}
                      <button
                        className="secondary-button"
                        onClick={() => handleEnterFullscreen(chartId)}
                        style={{
                          position: "absolute",
                          top: 6,
                          right: 6,



                          background: "rgba(0,0,0,0.6)",
                          border: "1px solid rgba(255,255,255,0.15)",
                          color: "#fff",
                          zIndex: 10,
                        }}
                        title="Fullscreen"
                      >
                        ⛶
                      </button>
                    </div>
                  ) : mode === "snapshots" &&
                    master?.snapshots?.[tf.toLowerCase()] ? (
                    /* Snapshot image */
                    <div
                      style={{
                        position: "relative",
                        height: isMasterSnapshotMode ? 410 : chartHeight,
                        overflow: "hidden",
                        borderRadius: 6,
                      }}
                    >
                      <img
                        src={
                          master.snapshots[tf.toLowerCase()].url ||
                          `${window.location.origin}/api/chart/snapshots/${encodeURIComponent(master.snapshots[tf.toLowerCase()].file_name || "")}`
                        }
                        alt={`snapshot-${tf}`}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: isMasterSnapshotMode ? "fill" : "contain",
                          background: "#000",
                          cursor: "pointer",
                        }}
                        onError={(e) => {
                          e.target.style.display = "none";
                        }}
                        onClick={() => {
                          const snap = master?.snapshots?.[tf.toLowerCase()];
                          if (snap) {
                            const url =
                              snap.url ||
                              `${window.location.origin}/api/chart/snapshots/${encodeURIComponent(snap.file_name || "")}`;
                            setSnapshotModalFiles([
                              {
                                name: snap.file_name || `snapshot-${tf}`,
                                url,
                                size_bytes: snap.size_bytes || 0,
                              },
                            ]);
                          }
                        }}
                      />
                    </div>
                  ) : isSvg && hasBars ? (
                    <div
                      style={{
                        position: "relative",
                        height: chartHeight,
                        overflow: "hidden",
                        borderRadius: 6,
                      }}
                    >
                      <ChartSVG
                        key={`svg-${chartId}`}
                        bars={barsToRender}
                        side={effectiveTradeSide}
                        action={effectiveTradeSide}
                        tradeLabel={effectiveTradeLabel}
                        entryPrice={overlays.plan1 ? effectiveEntryPrice : null}
                        slPrice={overlays.plan1 ? effectiveSlPrice : null}
                        tpPrice={overlays.plan1 ? effectiveTpPrice : null}
                        tp1Price={overlays.plan1 ? tp1Price : null}
                        tp2Price={overlays.plan1 ? tp2Price : null}
                        tp3Price={overlays.plan1 ? tp3Price : null}
                        createdAt={showEventMarkers ? effectiveCreatedAt : null}
                        openedAt={showEventMarkers ? effectiveOpenedAt : null}
                        closedAt={showEventMarkers ? effectiveClosedAt : null}
                        closeStatus={showEventMarkers ? effectiveCloseStatus : ""}
                        exitPrice={showEventMarkers ? effectiveExitPrice : null}
                        pnlRealized={showEventMarkers ? effectivePnlRealized : null}
                        trades={
                          showEventMarkers ? normalizedTrades : []
                        }
                        selectedTradeSid={effectiveTradeSid}
                        barsCount={initialVisibleBars}
                        height={chartHeight}
                        showLegend={false}
                        showIndicators={true}
                        indicatorVisibilityConfig={indicatorVisibility}
                      />
                    </div>
                  ) : hasBars ? (
                    <>
                      <TradeSignalChart
                        key={`tsc-${chartId}-${effectiveTradeOverlayRenderKey}`}
                        chartId={chartId}
                        symbol={cleanSym}
                        provider={provider}
                        interval={tf}
                        historicalData={barsToRender}
                        visibleBarsCount={initialVisibleBars}
                        height={chartHeight}
                        analysisSnapshot={analysisSnapshot || null}
                        entryPrice={
                          overlays.plan1 && tradeObjectsVisible ? effectiveEntryPrice : null
                        }
                        slPrice={
                          overlays.plan1 && tradeObjectsVisible ? effectiveSlPrice : null
                        }
                        tpPrice={
                          overlays.plan1 && tradeObjectsVisible ? effectiveTpPrice : null
                        }
                        tp1Price={
                          overlays.plan1 && tradeObjectsVisible ? tp1Price : null
                        }
                        tp2Price={
                          overlays.plan1 && tradeObjectsVisible ? tp2Price : null
                        }
                        tp3Price={
                          overlays.plan1 && tradeObjectsVisible ? tp3Price : null
                        }
                        createdAt={
                          showEventMarkers && createdMarkerVisible ? effectiveCreatedAt : null
                        }
                        createdAtSec={
                          showEventMarkers && createdMarkerVisible
                            ? effectiveCreatedAtSec
                            : null
                        }
                        openedAt={
                          showEventMarkers && openedMarkerVisible ? effectiveOpenedAt : null
                        }
                        openedAtSec={
                          showEventMarkers && openedMarkerVisible
                            ? effectiveOpenedAtSec
                            : null
                        }
                        closedAt={
                          showEventMarkers && closedMarkerVisible ? effectiveClosedAt : null
                        }
                        closedAtSec={
                          showEventMarkers && closedMarkerVisible
                            ? effectiveClosedAtSec
                            : null
                        }
                        closeStatus={
                          showEventMarkers && closedMarkerVisible ? effectiveCloseStatus : ""
                        }
                        exitPrice={
                          showEventMarkers && closedMarkerVisible ? effectiveExitPrice : null
                        }
                        pnlRealized={showEventMarkers ? effectivePnlRealized : null}
                        tradeLabel={effectiveTradeLabel}
                        trades={
                          showEventMarkers ? normalizedTrades : []
                        }
                        selectedTradeSid={effectiveTradeSid}
                        animateTradeViewport={
                          isBacktestChartReplay ? false : animateTradeViewport
                        }
                        autoFitNonce={viewportAutoFitNonce}
                        preserveViewportOnBarsChange={!isBacktestChartReplay}
                        preferTradeAnchoredViewport={preferTradeAnchoredViewport}
                        showPrimaryPlan={overlays.plan1}
                        showExtraPlans={overlays.plan2}
                        showPdArrays={
                          isBacktestChartReplay ? false : overlays.pdArrays
                        }
                        showKeyLevels={
                          isBacktestChartReplay ? false : overlays.keyLevels
                        }
                        onPlanLevelChange={onPlanLevelChange}
                        syncedCrosshair={
                          isCacheLikeMode ? syncedCrosshair : null
                        }
                        onCrosshairSync={
                          isCacheLikeMode ? handleCrosshairSync : undefined
                        }
                        onBarsLoaded={
                          isBacktestChartReplay ? undefined : handleBarsLoaded
                        }
                        sharedObjects={sharedChartObjects}
                        onContextRequest={
                          isCacheLikeMode ? handleContextRequest : undefined
                        }
                        onViewportChange={
                          !isBacktestChartReplay &&
                          isCacheLikeMode &&
                          !disableViewportPersistence
                            ? handleViewportChange
                            : undefined
                        }
                        viewportCommand={viewportCommandByChartId[chartId] || null}
                        initialViewport={
                          disableViewportPersistence ||
                          anchorToTradeTime ||
                          selectedTradeViewportEndTimeSec ||
                          isStreamingMode
                            ? null
                            : savedTfViewportPrefs[chartId] || null
                        }
                        isReplayActive={isBacktestChartReplay}
                        replayClockTimeSec={isBacktestChartReplay ? replayClockTimeSec : null}
                        showIndicators={true}
                        showIndicatorPanel={false}
                        indicatorVisibilityConfig={indicatorVisibility}
                      />
                      {isCacheLikeMode && (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            zIndex: 25,
                            pointerEvents:
                              drawMode === "zone" || editObjects
                                ? "auto"
                                : "none",
                          }}
                          onMouseDown={(evt) => {
                            const rect =
                              evt.currentTarget.getBoundingClientRect();
                            const x = evt.clientX - rect.left;
                            const y = evt.clientY - rect.top;
                            const xr = Math.max(
                              0,
                              Math.min(1, x / Math.max(rect.width, 1)),
                            );
                            const yr = Math.max(
                              0,
                              Math.min(1, y / Math.max(rect.height, 1)),
                            );
                            if (drawMode === "zone") {
                              const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                              const start = { x: xr, y: yr };
                              const onUp = (upEvt) => {
                                const ux = upEvt.clientX - rect.left;
                                const uy = upEvt.clientY - rect.top;
                                const xr2 = Math.max(
                                  0,
                                  Math.min(1, ux / Math.max(rect.width, 1)),
                                );
                                const yr2 = Math.max(
                                  0,
                                  Math.min(1, uy / Math.max(rect.height, 1)),
                                );
                                const p1 = anchorPriceFromRatio(
                                  start.y,
                                  tfRange,
                                );
                                const p2 = anchorPriceFromRatio(yr2, tfRange);
                                const t1 = anchorTimeFromRatio(
                                  Math.min(start.x, xr2),
                                  tfRange,
                                );
                                setAnnotations((prev) => [
                                  ...prev,
                                  {
                                    id,
                                    kind: "zone",
                                    visible: true,
                                    type: "ZONE",
                                    color: "#22c55e",
                                    tf: null,
                                    price_top:
                                      Number.isFinite(Number(p1)) &&
                                      Number.isFinite(Number(p2))
                                        ? Math.max(Number(p1), Number(p2))
                                        : null,
                                    price_bottom:
                                      Number.isFinite(Number(p1)) &&
                                      Number.isFinite(Number(p2))
                                        ? Math.min(Number(p1), Number(p2))
                                        : null,
                                    price:
                                      Number.isFinite(Number(p1)) &&
                                      Number.isFinite(Number(p2))
                                        ? Number(p1)
                                        : null,
                                    time: Number.isFinite(Number(t1))
                                      ? Number(t1)
                                      : null,
                                    line_style: "dot",
                                    line_width: 0.1,
                                    bg_color: "rgba(34,197,94,0.18)",
                                    label: "Zone",
                                    x1Ratio: Math.min(start.x, xr2),
                                    x2Ratio: Math.max(start.x, xr2),
                                    y1Ratio: start.y,
                                    y2Ratio: yr2,
                                    anchorTimeMs: anchorTimeFromRatio(
                                      Math.min(start.x, xr2),
                                      tfRange,
                                    ),
                                    anchorTimeMs2: anchorTimeFromRatio(
                                      Math.max(start.x, xr2),
                                      tfRange,
                                    ),
                                    anchorPrice: anchorPriceFromRatio(
                                      start.y,
                                      tfRange,
                                    ),
                                    anchorPrice2: anchorPriceFromRatio(
                                      yr2,
                                      tfRange,
                                    ),
                                  },
                                ]);
                                setSelectedObjectId(id);
                                setDrawMode(null);
                                window.removeEventListener("mouseup", onUp);
                              };
                              window.addEventListener("mouseup", onUp);
                              evt.preventDefault();
                              return;
                            }
                            const hit = (projectedAnnotations || [])
                              .map((a) => {
                                if (a.kind === "line") {
                                  const ay = Number(a._yRatio) * rect.height;
                                  return { a, d: Math.abs(ay - y), edge: null };
                                }
                                if (a.kind === "point") {
                                  const ax = Number(a._xRatio) * rect.width;
                                  const ay = Number(a._yRatio) * rect.height;
                                  return {
                                    a,
                                    d: Math.hypot(ax - x, ay - y),
                                    edge: null,
                                  };
                                }
                                if (a.kind === "zone") {
                                  const y1 = Number(a._y1Ratio) * rect.height;
                                  const y2 = Number(a._y2Ratio) * rect.height;
                                  const lo = Math.min(y1, y2);
                                  const hi = Math.max(y1, y2);
                                  if (y < lo - 6 || y > hi + 6) return null;
                                  const dTop = Math.abs(y - lo);
                                  const dBot = Math.abs(y - hi);
                                  return {
                                    a,
                                    d: Math.min(dTop, dBot),
                                    edge: dTop < dBot ? "top" : "bottom",
                                  };
                                }
                                return null;
                              })
                              .filter(Boolean)
                              .sort((p, q) => p.d - q.d)[0];
                            if (hit && hit.d <= 10) {
                              dragRef.current = {
                                id: hit.a.id,
                                edge: hit.edge,
                                rect,
                                range: tfRange,
                              };
                              setSelectedObjectId(hit.a.id);
                              evt.preventDefault();
                            }
                          }}
                        >
                          {/* All annotations now rendered via createPriceLine API */}
                        </div>
                      )}
                    </>
                  ) : (
                    <div
                      style={{
                        height: chartHeight,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 10,
                        color: "var(--muted)",
                        fontSize: 11,
                      }}
                    >
                      <div>
                        {status === "LOADING"
                          ? "Loading..."
                          : mode === "snapshots"
                            ? "No saved snapshots"
                            : "Loading chart data..."}
                      </div>
                      {mode !== "live" &&
                      mode !== "snapshots" &&
                      status !== "LOADING" &&
                      (!autoLoadOnMount || hasAttemptedAutoLoad) ? (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={handleRefreshChartsAndArtifacts}
                          title="Load bars for the current symbol and visible chart windows, then rebuild artifacts"
                        >
                          Load chart data
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {(lastError || error) && (
        <div style={{ marginTop: 4, fontSize: 9, color: "#ef4444" }}>
          {lastError || error}
        </div>
      )}
      {!lastError && !error && planRefreshError && (
        <div style={{ marginTop: 4, fontSize: 9, color: "#ef4444" }}>
          {planRefreshError}
        </div>
      )}
      {snapshotGridModal?.url ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 6, 23, 0.96)",
            zIndex: 10000,
            display: "flex",
            alignItems: "stretch",
            justifyContent: "stretch",
            padding: 0,
          }}
          onClick={() => setSnapshotGridModal(null)}
        >
          <div
            style={{
              width: "100vw",
              height: "100vh",
              background: "#0f172a",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(evt) => evt.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 12,
                padding: "12px 14px",
                background: "transparent",
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                zIndex: 2,
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  pointerEvents: "auto",
                }}
              >
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    window.open(
                      snapshotGridModal.url,
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                  title="Open standalone"
                  aria-label="Open standalone"
                  style={{
                    width: 32,
                    minWidth: 32,
                    height: 32,
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 15,
                    lineHeight: 1,
                  }}
                >
                  ↗
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setSnapshotGridModal(null)}
                  title="Close"
                  aria-label="Close"
                  style={{
                    width: 32,
                    minWidth: 32,
                    height: 32,
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 15,
                    lineHeight: 1,
                  }}
                >
                  x
                </button>
              </div>
            </div>
            <iframe
              title={snapshotGridModal.title || "Snapshots"}
              src={snapshotGridModal.url}
              style={{
                width: "100%",
                height: "100%",
                border: "none",
                background: "#020617",
              }}
            />
          </div>
        </div>
      ) : null}
      {isCacheLikeMode && ctxMenu && (
        <div
          style={{
            position: "fixed",
            left: Math.max(8, Number(ctxMenu.clientX || 0)),
            top: Math.max(8, Number(ctxMenu.clientY || 0)),
            background: "#0f1729",
            border: "1px solid rgba(148,163,184,0.35)",
            borderRadius: 8,
            zIndex: 9999,
            minWidth: 140,
            boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Mouse time / price */}
          <div
            style={{
              padding: "4px 8px",
              fontSize: 10,
              color: "#94a3b8",
              borderBottom: "1px solid rgba(148,163,184,0.15)",
              fontFamily: "monospace",
              display: "grid",
              gap: 2,
            }}
          >
            <div>
              {(() => {
                const timeMs = toEpochMs(ctxMenu?.time);
                return timeMs ? showDateTime(timeMs) : "n/a";
              })()}
            </div>
            <div>
              {Number(ctxMenu?.price || 0).toFixed(
                Number(ctxMenu?.price) >= 1000
                  ? 1
                  : Number(ctxMenu?.price) >= 100
                    ? 2
                    : 3,
              )}
            </div>
          </div>
          {(() => {
            const price = Number(ctxMenu?.price || 0);
            const priceStr = price.toFixed(
              price >= 1000 ? 1 : price >= 100 ? 2 : 3,
            );
            const menuTfColor = artifactTimeframeColor(ctxMenu?.interval || ctxMenu?.tf || "");
            return [
              { label: "Line", color: menuTfColor, fn: handleDrawLine },
              { label: "Segment", color: menuTfColor, fn: handleDrawSegment },
              {
                label: "Zone",
                color: "#22c55e",
                fn: () => addObject("ZONE", "#22c55e", "zone"),
              },
              { label: `Buy @ ${priceStr}`, fn: () => handleQuickTrade("BUY") },
              {
                label: `Sell @ ${priceStr}`,
                fn: () => handleQuickTrade("SELL"),
              },
              {
                label: `Entry @ ${priceStr}`,
                fn: () => {
                  const p = Number(ctxMenu?.price);
                  if (typeof onPlanLevelChange === "function") {
                    onPlanLevelChange("entry", p);
                  }
                  if (typeof onQuickTradeIntent === "function") {
                    onQuickTradeIntent({
                      symbol: cleanSym,
                      side: "ENTRY",
                      action: "ENTRY",
                      plan_id: activePlanGroup,
                      price: p,
                    });
                  }
                  setCtxMenu(null);
                },
              },
              ...["TP1", "TP2", "TP3"].map((tpKey) => ({
                label: `${tpKey} @ ${priceStr}`,
                fn: () => {
                  const p = Number(ctxMenu?.price);
                  if (typeof onPlanLevelChange === "function") {
                    onPlanLevelChange(tpKey.toLowerCase(), p);
                  }
                  if (typeof onQuickTradeIntent === "function") {
                    onQuickTradeIntent({
                      symbol: cleanSym,
                      side: tpKey,
                      action: tpKey,
                      plan_id: activePlanGroup,
                      price: p,
                    });
                  }
                  setCtxMenu(null);
                },
              })),
              {
                label: `SL @ ${priceStr}`,
                fn: () => {
                  const p = Number(ctxMenu?.price);
                  if (typeof onPlanLevelChange === "function") {
                    onPlanLevelChange("sl", p);
                  }
                  if (typeof onQuickTradeIntent === "function") {
                    onQuickTradeIntent({
                      symbol: cleanSym,
                      side: "SL",
                      action: "SL",
                      plan_id: activePlanGroup,
                      price: p,
                    });
                  }
                  setCtxMenu(null);
                },
              },
            ].map((it) => (
              <button
                key={it.label}
                type="button"
                onClick={it.fn}
                title={`Add ${it.label} to the current chart`}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  color:
                    it.label.startsWith("Buy") ||
                    it.label.startsWith("Entry") ||
                    it.label.startsWith("TP")
                      ? "#10b981"
                      : it.label.startsWith("Sell") || it.label.startsWith("SL")
                        ? "#ef4444"
                        : "#e2e8f0",
                  border: "none",

                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {it.color ? (
                  <span
                    style={{
                      width: 16,
                      height: it.label === "Zone" ? 10 : 2,
                      borderRadius: 2,
                      border: `1px solid ${it.color}`,
                      background:
                        it.label === "Zone" ? `${it.color}33` : it.color,
                      display: "inline-block",
                    }}
                  />
                ) : null}
                {it.label}
              </button>
            ));
          })()}
        </div>
      )}
      {isCacheLikeMode && showObjectInspector && (
        <div
          style={{
            marginTop: 8,
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "6px 8px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {editableAnnotations.map((a) => (
            <span
              key={a.id}
              onClick={() => setSelectedObjectId(a.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border:
                  selectedObjectId === a.id
                    ? `1px solid ${a.visible === false ? "#94a3b8" : a.color || "#60a5fa"}`
                    : "1px solid var(--border)",
                color:
                  selectedObjectId === a.id
                    ? a.visible === false
                      ? "#94a3b8"
                      : a.color || "var(--foreground)"
                    : "var(--foreground)",
                borderRadius: 12,
                padding: "1px 6px",
                fontSize: 9,
                cursor: "pointer",
                background:
                  selectedObjectId === a.id
                    ? `${a.visible === false ? "#cbd5e1" : a.color || "#60a5fa"}22`
                    : "transparent",
              }}
              title={a.id}
            >
              {formatObjectLabel(a.type, a.label || "") || a.type}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setAnnotations((prev) =>
                    prev.map((x) =>
                      x.id === a.id
                        ? { ...x, visible: x.visible === false ? true : false }
                        : x,
                    ),
                  );
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "inherit",
                  cursor: "pointer",

                  lineHeight: 1,
                }}
                title={a.visible === false ? "Show" : "Hide"}
              >
                {a.visible === false ? "◌" : "👁"}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setAnnotations((prev) => prev.filter((x) => x.id !== a.id));
                  if (
                    a.kind === "tradeplan" &&
                    typeof onQuickTradeIntent === "function"
                  ) {
                    const planId = String(a.plan_id || "P1").toUpperCase();
                    onQuickTradeIntent({
                      symbol: cleanSym,
                      side: "ENTRY",
                      action: "CLEAR_ENTRY",
                      plan_id: planId,
                      price: null,
                    });
                    onQuickTradeIntent({
                      symbol: cleanSym,
                      side: "TP",
                      action: "CLEAR_TP",
                      plan_id: planId,
                      price: null,
                    });
                    onQuickTradeIntent({
                      symbol: cleanSym,
                      side: "SL",
                      action: "CLEAR_SL",
                      plan_id: planId,
                      price: null,
                    });
                  }
                  setSelectedObjectId((prev) => (prev === a.id ? null : prev));
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "inherit",
                  cursor: "pointer",

                  lineHeight: 1,
                }}
                title="Remove"
              >
                x
              </button>
            </span>
          ))}
          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            <button
              type="button"
              onClick={() => {
                setAnnotations([]);
                setSelectedObjectId(null);
              }}
              title="Clear all manual objects from the current chart session"
              style={{


                background: "rgba(220,38,38,0.15)",
                color: "#dc2626",
                border: "1px solid rgba(220,38,38,0.3)",

                cursor: "pointer",
              }}
            >
              X
            </button>
            <button
              type="button"
              onClick={handleSaveObjects}
              title="Save the current manual objects so they persist for this symbol and timeframe range"
              style={{

                background: "#3b82f6",
                color: "#fff",
                border: "none",

                cursor: "pointer",
              }}
            >
              Save
            </button>
          </div>
          {selectedObject ? (
            <div
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "repeat(6, minmax(120px, 1fr))",
                gap: 8,
              }}
            >
              {selectedObject.kind === "tradeplan" ? (
                <>
                  <div
                    className="minor-text"
                    style={{
                      gridColumn: "1 / -1",
                      fontSize: 10,
                      opacity: 0.9,
                    }}
                  >
                    TradePlan values are read-only here. Edit Trade Plan in the
                    top panel.
                  </div>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-label`}
                    style={{ display: "grid", gap: 4, fontSize: 10 }}
                  >
                    Label
                    <input
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-label`}
                      name="label"
                      value={selectedObject.label || ""}
                      readOnly
                      placeholder="TradePlan label"
                    />
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-direction`}
                    style={{ display: "grid", gap: 4, fontSize: 10 }}
                  >
                    Direction
                    <InputComboSelect
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-direction`}
                      name="direction"
                      value={String(
                        selectedObject.direction || "BUY",
                      ).toUpperCase()}
                      disabled
                    >
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                    </InputComboSelect>
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-entry`}
                    style={{ display: "grid", gap: 4, fontSize: 10 }}
                  >
                    Entry
                    <NumberAdjuster
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-entry`}
                      value={selectedObject.entryPrice ?? ""}
                      onChange={() => {}}
                      min={0}
                      max={200000}
                      step={1}
                      fallbackValue={latestCachedPrice}
                      placeholder="entry"
                      disabled
                    />
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-tp`}
                    style={{ display: "grid", gap: 4, fontSize: 10 }}
                  >
                    TP
                    <NumberAdjuster
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-tp`}
                      value={selectedObject.tpPrice ?? ""}
                      onChange={() => {}}
                      min={0}
                      max={200000}
                      step={1}
                      fallbackValue={latestCachedPrice}
                      placeholder="tp"
                      disabled
                    />
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-sl`}
                    style={{ display: "grid", gap: 4, fontSize: 10 }}
                  >
                    SL
                    <NumberAdjuster
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-sl`}
                      value={selectedObject.slPrice ?? ""}
                      onChange={() => {}}
                      min={0}
                      max={200000}
                      step={1}
                      fallbackValue={latestCachedPrice}
                      placeholder="sl"
                      disabled
                    />
                  </label>
                </>
              ) : (
                <>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-label`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 3",
                    }}
                  >
                    Label
                    <input
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-label`}
                      name="label"
                      value={formatObjectLabel(
                        selectedObject.type,
                        selectedObject.label,
                      )}
                      readOnly
                      placeholder="All label"
                    />
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-type`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 3",
                    }}
                  >
                    Type
                    <InputComboSelect
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-type`}
                      name="type"
                      value={selectedObject.type || "line"}
                      onChange={(e) =>
                        updateSelectedField("type", e.target.value)
                      }
                    >
                      {["buy", "sell", "line", "segment", "zone", "s/r", "ob", "bb", "fvg", "ifvg"].map(
                        (x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ),
                      )}
                    </InputComboSelect>
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-tf`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 2",
                    }}
                  >
                    TF
                    <InputComboSelect
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-tf`}
                      name="tf"
                      value={selectedObject.tf || ""}
                      onChange={(e) =>
                        updateSelectedField("tf", e.target.value || null)
                      }
                    >
                      <option value="">all TFs</option>
                      {(sortedTfs || []).map((tf) => (
                        <option key={tf} value={String(tf).toLowerCase()}>
                          {String(tf).toLowerCase()}
                        </option>
                      ))}
                    </InputComboSelect>
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-price`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 2",
                    }}
                  >
                    Price
                    <NumberAdjuster
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-price`}
                      value={
                        selectedObject.price ?? selectedObject.price_top ?? ""
                      }
                      onChange={(v) => {
                        updateSelectedField("price", v);
                        updateSelectedField("price_top", v);
                        updateSelectedField("price_bottom", v);
                      }}
                      min={0}
                      max={200000}
                      step={1}
                      placeholder="price"
                    />
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-style`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 2",
                    }}
                  >
                    Line Style
                    <InputComboSelect
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-style`}
                      name="line_style"
                      value={selectedObject.line_style || "dot"}
                      onChange={(e) =>
                        updateSelectedField("line_style", e.target.value)
                      }
                      disabled
                    >
                      {["dot"].map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </InputComboSelect>
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-width`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 3",
                    }}
                  >
                    Line Width
                    <InputComboSelect
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-width`}
                      name="line_width"
                      value={selectedObject.line_width || 0.1}
                      onChange={(e) =>
                        updateSelectedField("line_width", e.target.value)
                      }
                      disabled
                    >
                      {[0.1].map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </InputComboSelect>
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-color`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 1",
                    }}
                  >
                    Color
                    <input
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-color`}
                      name="color"
                      type="color"
                      value={toHexColor(selectedObject.color)}
                      onChange={(e) =>
                        updateSelectedField("color", e.target.value)
                      }
                    />
                  </label>
                  <label
                    htmlFor={`${symbol}-${activeChartId || cleanSym}-inspector-edit-bg`}
                    style={{
                      display: "grid",
                      gap: 4,
                      fontSize: 10,
                      gridColumn: "span 1",
                    }}
                  >
                    Background Color
                    <input
                      id={`${symbol}-${activeChartId || cleanSym}-inspector-edit-bg`}
                      name="bg_color"
                      type="color"
                      value={toHexColor(selectedObject.bg_color || "#22c55e")}
                      onChange={(e) =>
                        updateSelectedField("bg_color", e.target.value)
                      }
                    />
                  </label>
                </>
              )}
            </div>
          ) : null}
        </div>
      )}

      <TvLoginOverlay
        isOpen={showTvLogin}
        onClose={() => setShowTvLogin(false)}
        onLogin={handleTvLogin}
      />
    </div>
  );
}

function TvLoginOverlay({ isOpen, onClose, onLogin }) {
  return (
    <TradingViewLoginModal
      isOpen={isOpen}
      onClose={onClose}
      onLogin={onLogin}
    />
  );
}
