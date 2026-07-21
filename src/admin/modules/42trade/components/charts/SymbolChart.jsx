import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { api } from "../../../../app/api";
import { useSymbolChartData } from "../../hooks/useChartTileData";
import { useRealtimeSymbolChartMatrix } from "../../hooks/useRealtimeSymbolChartMatrix";
import { chartStreamStore, realtimeTransport } from "../../realtime/realtimeClientSingleton";
import TradeSignalChart from "../TradeSignalChart";
import ChartSVG from "./ChartSVG";
import TradingViewLoginModal from "../modals/TradingViewLoginModal";
import ImageViewer from "../../../../shared/components/ImageViewer";
import BooleanButton from "../../../../shared/components/BooleanButton";
import GroupButtons from "../../../../shared/components/GroupButtons";
import ResponsivePanel from "../../../../shared/components/ResponsivePanel";
import { StatusDisplay } from "../../../../shared/components/StatusBadge";
import { showToast } from "../../../../shared/components/ToastContainer";
import { resolveAdjusterValue, toNumLoose } from "./numberUtils";
import TimeframePresetPicker from "../TimeframePresetPicker";
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
  resolveTradeChartRenderBars,
  resolveTradeFetchBarsCount,
  resolveTradeFetchEndTimeSec,
  resolveTradeViewportEndTimeSec,
} from "../../../../shared/utils/tradeAnchor";
import {
  collectContextualStrategyTradePlans,
  evaluateChartStrategies,
  resolveConfirmedPostEventDirection,
} from "../../../../shared/utils/chartStrategyChecks";
import {
  mergeStrategiesById,
  normalizeStrategyCatalog,
} from "../../../../shared/utils/strategyCatalog";
import {
  buildClientChartArtifactEnvelope,
  buildClientChartMultiTfAnalysis,
  createClientReplayArtifactEngineState,
  mergeHybridArtifactItemsForTf,
  mergeHybridTradePlansForTf,
  normalizeHybridTradePlans,
  updateClientReplayArtifactEngineState,
} from "../../chartArtifacts/clientChartAnalysis.js";
import {
  buildSuggestedTradeLevels as sharedBuildSuggestedTradeLevels,
} from "../../../../shared/utils/suggestedTradeLevels.js";
import { listPredefinedRules } from "../../../../../shared/rules-engine/predefinedRules.js";

const BASE_MODES = ["live", "cache", "svg"];
const REPLAY_MODE = "replay";
const TRADINGVIEW_EMBED_AUTLOAD_PREF_KEY = "tv_embed_autoload_enabled";
const HISTORY_BARS_ACTION_COUNT = 2000;
const MAX_HISTORY_BARS = 20000;
const SYMBOL_CHART_MIN_LOADED_BARS = 5000;
const POST_LOAD_RECENTER_VISIBLE_BARS = 1500;
const MANUAL_VIEWPORT_SUPPRESS_MS = 12000;
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
  { value: "chart", label: <LayersTabChartIcon />, title: "Charts" },
  { value: "artifacts", label: <LayersTabArtifactsIcon />, title: "Artifacts" },
  { value: "events", label: <LayersTabEventsIcon />, title: "Events" },
  { value: "momentum", label: <LayersTabMomentumIcon />, title: "Momentum" },
  { value: "trend", label: <LayersTabTrendIcon />, title: "Trend" },
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
function normalizeRuleEventKey(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function ruleEventKeyFromDefinition(rule = {}) {
  return normalizeRuleEventKey(
    rule?.abbr || rule?.short_name || rule?.marker_text || rule?.id || rule?.name || "",
  );
}

function ruleDirectionFromDefinition(rule = {}) {
  const raw = String(rule?.outputs?.bias || rule?.params?.bias || "").trim().toLowerCase();
  if (raw === "bullish" || raw === "buy" || raw === "long") return "buy";
  if (raw === "bearish" || raw === "sell" || raw === "short") return "sell";
  return "neutral";
}

function mergeEventPanelCatalog(entries = []) {
  const groups = new Map();
  for (const entry of entries) {
    const eventKey = normalizeRuleEventKey(entry?.eventKey);
    if (!eventKey || groups.has(eventKey)) continue;
    groups.set(eventKey, {
      eventKey,
      direction: String(entry?.direction || "neutral").trim().toLowerCase() || "neutral",
    });
  }
  return Array.from(groups.values());
}

function resolveAllowedRuleEventKey(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const direct = normalizeRuleEventKey(raw);
  const normalized = raw.toLowerCase();
  const predefined = listPredefinedRules().find((rule) =>
    [
      rule?.id,
      rule?.abbr,
      rule?.short_name,
      rule?.name,
    ]
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
      .includes(normalized),
  );
  return ruleEventKeyFromDefinition(predefined) || direct;
}

function resolveAllowedRuleEventKeys(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const keys = new Set();
  const direct = normalizeRuleEventKey(raw);
  if (direct) keys.add(direct);
  const normalized = raw.toLowerCase();
  const predefined = listPredefinedRules().find((rule) =>
    [
      rule?.id,
      rule?.abbr,
      rule?.short_name,
      rule?.name,
    ]
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
      .includes(normalized),
  );
  if (predefined) {
    [
      predefined?.abbr,
      predefined?.short_name,
      predefined?.id,
      predefined?.name,
      predefined?.marker_text,
    ].forEach((item) => {
      const key = normalizeRuleEventKey(item);
      if (key) keys.add(key);
    });
  }
  return Array.from(keys);
}

function buildAllowedRuleEventSet(...groups) {
  const values = groups.flatMap((group) => {
    if (group == null) return [];
    return Array.isArray(group) ? group : [group];
  });
  if (!values.length) return null;
  const set = new Set();
  for (const value of values) {
    const keys =
      value && typeof value === "object"
        ? [
            value.abbr,
            value.short_name,
            value.eventKey,
            value.event_key,
            value.rule_id,
            value.id,
            value.name,
          ].flatMap((item) => resolveAllowedRuleEventKeys(item))
        : resolveAllowedRuleEventKeys(value);
    keys.forEach((key) => {
      if (key) set.add(key);
    });
  }
  return set.size ? set : null;
}

function allowedRuleEventSetHas(allowedSet, eventKey = "") {
  if (!allowedSet) return true;
  const keys = resolveAllowedRuleEventKeys(eventKey);
  if (!keys.length) return true;
  return keys.some((key) => allowedSet.has(key));
}

const PREDEFINED_RULE_EVENT_CATALOG = listPredefinedRules()
  .map((rule) => ({
    eventKey: ruleEventKeyFromDefinition(rule),
    direction: ruleDirectionFromDefinition(rule),
  }))
  .filter((entry) => entry.eventKey);

const EVENT_PANEL_CATALOG = mergeEventPanelCatalog([
  ...PREDEFINED_RULE_EVENT_CATALOG,
  { eventKey: "CH", direction: "sell" },
  { eventKey: "SW", direction: "sell" },
  { eventKey: "SH", direction: "sell" },
  { eventKey: "SL", direction: "buy" },
  { eventKey: "DIV", direction: "neutral" },
]);
const LAYER_BOOLEAN_GRID_STYLE = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 6,
};

function LayerBooleanGrid({ items = [] }) {
  return (
    <div style={LAYER_BOOLEAN_GRID_STYLE}>
      {(Array.isArray(items) ? items : []).map((item) => (
        <BooleanButton
          key={item.key}
          checked={item.checked}
          onChange={item.onChange}
          label={item.label}
          description={item.description}
          count={item.count}
          tone={item.tone}
          title={item.title}
          mode="toggle_button"
          compact
        />
      ))}
    </div>
  );
}
let SYMBOL_CHART_STRATEGY_CACHE = null;
let SYMBOL_CHART_STRATEGY_CACHE_PROMISE = null;
let SYMBOL_CHART_NEWS_CACHE = null;
let SYMBOL_CHART_NEWS_CACHE_PROMISE = null;
let SYMBOL_CHART_NEWS_CACHE_AT = 0;
const SYMBOL_CHART_STRATEGY_SCAN_CACHE = new Map();
const SYMBOL_CHART_STRATEGY_SCAN_CACHE_TTL_MS = 5 * 60 * 1000;

async function loadSymbolChartStrategyCache() {
  if (Array.isArray(SYMBOL_CHART_STRATEGY_CACHE)) {
    return SYMBOL_CHART_STRATEGY_CACHE;
  }
  if (SYMBOL_CHART_STRATEGY_CACHE_PROMISE) {
    return SYMBOL_CHART_STRATEGY_CACHE_PROMISE;
  }
  SYMBOL_CHART_STRATEGY_CACHE_PROMISE = api
    .listStrategies()
    .then((response) => {
      const items = normalizeStrategyCatalog(response?.items);
      const next = items.filter((item) => {
        const status = String(item?.status || "").trim().toLowerCase();
        return status !== "archived";
      });
      SYMBOL_CHART_STRATEGY_CACHE = next;
      return next;
    })
    .finally(() => {
      SYMBOL_CHART_STRATEGY_CACHE_PROMISE = null;
    });
  return SYMBOL_CHART_STRATEGY_CACHE_PROMISE;
}

async function loadSymbolChartNewsCache() {
  if (
    Array.isArray(SYMBOL_CHART_NEWS_CACHE) &&
    Number.isFinite(SYMBOL_CHART_NEWS_CACHE_AT) &&
    Date.now() - SYMBOL_CHART_NEWS_CACHE_AT < SYMBOL_CHART_STRATEGY_SCAN_CACHE_TTL_MS
  ) {
    return SYMBOL_CHART_NEWS_CACHE;
  }
  if (SYMBOL_CHART_NEWS_CACHE_PROMISE) {
    return SYMBOL_CHART_NEWS_CACHE_PROMISE;
  }
  SYMBOL_CHART_NEWS_CACHE_PROMISE = api
    .calendarWeek()
    .then((response) => {
      const events = Array.isArray(response?.events) ? response.events : [];
      SYMBOL_CHART_NEWS_CACHE = events;
      SYMBOL_CHART_NEWS_CACHE_AT = Date.now();
      return events;
    })
    .catch(() => {
      if (Array.isArray(SYMBOL_CHART_NEWS_CACHE)) return SYMBOL_CHART_NEWS_CACHE;
      return [];
    })
    .finally(() => {
      SYMBOL_CHART_NEWS_CACHE_PROMISE = null;
    });
  return SYMBOL_CHART_NEWS_CACHE_PROMISE;
}

function resolveContextMenuTf(ctxMenu = null, activeChartId = "") {
  const rawTf =
    ctxMenu?.interval ||
    ctxMenu?.tf ||
    String(ctxMenu?.chartId || activeChartId || "")
      .split("-")
      .slice(-1)[0];
  return String(rawTf || "").trim().toLowerCase();
}

function resolveTradesNamespaceBase(pathname = "") {
  const path = String(pathname || "").trim().toLowerCase();
  return "/trades";
}

function buildContextStrategyScanCacheKey({ symbol = "", tf = "", tfSet = [] } = {}) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const normalizedTf = String(tf || "").trim().toLowerCase();
  const normalizedTfSet = [...new Set((Array.isArray(tfSet) ? tfSet : []).map((item) =>
    String(item || "").trim().toLowerCase(),
  ).filter(Boolean))].sort();
  const timeBucket = Math.floor(Date.now() / SYMBOL_CHART_STRATEGY_SCAN_CACHE_TTL_MS);
  return [normalizedSymbol, normalizedTf, normalizedTfSet.join(","), timeBucket].join("|");
}

const INDICATOR_GROUPS = [
  {
    label: "MOMENTUM",
    items: [
      { key: "rsi", label: "RSI (14)", color: "#a855f7" },
      { key: "rsiEma9", label: "RSI EMA (9)", color: "#facc15" },
      { key: "rsiWma45", label: "RSI WMA (45)", color: "#34d399" },
      { key: "volume", label: "Volume", color: "#60a5fa" },
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
      { key: "ema20", label: "EMA (20)", color: "#38bdf8" },
      { key: "ema50", label: "EMA (50)", color: "#fb7185" },
      { key: "ema200", label: "EMA (200)", color: "#84cc16" },
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

const TREND_LAYER_GROUPS = [
  {
    key: "trend-sma",
    label: "SMA",
    itemKeys: ["sma20", "sma50", "sma200"],
    description: "20 / 50 / 200",
    tone: "#60a5fa",
  },
  {
    key: "trend-ema",
    label: "EMA",
    itemKeys: ["ema20", "ema50", "ema200"],
    description: "20 / 50 / 200",
    tone: "#38bdf8",
  },
  {
    key: "trend-vwap",
    label: "VWAP",
    itemKeys: ["vwap"],
    description: "VWAP",
    tone: "#0ea5e9",
  },
  {
    key: "trend-bb",
    label: "BB",
    itemKeys: ["bbMid", "bbUpper", "bbLower"],
    description: "Mid / Upper / Lower",
    tone: "#f472b6",
  },
  {
    key: "trend-ich",
    label: "Ich",
    itemKeys: ["ichiTenkan", "ichiKijun", "ichiSpanA", "ichiSpanB", "ichiChikou"],
    description: "Tenkan / Kijun / Span / Chikou",
    tone: "#a855f7",
  },
  {
    key: "trend-zigzag",
    label: "ZZ",
    itemKeys: ["zigzag"],
    description: "ZigZag",
    tone: "#facc15",
  },
];

const MOMENTUM_LAYER_GROUPS = [
  {
    key: "momentum-rsi",
    label: "RSI",
    itemKeys: ["rsi", "rsiEma9", "rsiWma45"],
    description: "14 / EMA9 / WMA45",
    tone: "#a855f7",
  },
  {
    key: "momentum-stoch",
    label: "Stoch",
    itemKeys: ["stochK", "stochD"],
    description: "%K / %D",
    tone: "#3b82f6",
  },
  {
    key: "momentum-macd",
    label: "MACD",
    itemKeys: ["macd", "macdSignal", "macdHistogram"],
    description: "Line / Signal / Hist",
    tone: "#22c55e",
  },
  {
    key: "momentum-volume",
    label: "Volume",
    itemKeys: ["volume"],
    description: "Volume",
    tone: "#60a5fa",
  },
];

const ARTIFACT_LAYER_GROUPS = [
  {
    key: "artifact-fvg",
    label: "FVG",
    groupKeys: ["fvg", "ifvg"],
    description: "FVG / iFVG",
  },
  {
    key: "artifact-ob-bb",
    label: "OB/BB",
    groupKeys: ["ob", "bb"],
    description: "OB / BB",
  },
  {
    key: "artifact-sup-dem",
    label: "Sup/Dem",
    groupKeys: ["support", "demand"],
    description: "Support / Demand",
  },
  {
    key: "artifact-res-supply",
    label: "Res/Sply",
    groupKeys: ["resistance", "supply"],
    description: "Resistance / Supply",
  },
  {
    key: "artifact-structure",
    label: "Struct",
    groupKeys: ["bos", "choch", "sweep", "swings"],
    description: "BOS / CH / SW / Swings",
  },
  {
    key: "artifact-levels",
    label: "Levels",
    groupKeys: ["pdh", "pdl", "liquidity"],
    description: "PDH / PDL / LIQ",
  },
  {
    key: "artifact-lines",
    label: "Lines",
    groupKeys: ["trendline", "divergence", "patterns"],
    description: "TL / DIV / Patterns",
  },
];

const EVENT_LAYER_GROUPS = [
  {
    key: "event-structure",
    label: "Struct",
    eventKeys: ["BOS", "BOS_B", "BOS_S", "CH", "CH_B", "CH_S", "SW", "SW_B", "SW_S", "SH", "SL"],
    description: "BOS / CH / SW",
  },
  {
    key: "event-candles",
    label: "Candles",
    eventKeys: ["ENG", "ENG_B", "ENG_S", "PIN", "INSI", "OUTS"],
    description: "ENG / PIN / INSI / OUTS",
  },
  {
    key: "event-rejection",
    label: "Reject",
    eventKeys: ["REJ", "RJ_EMA", "RJ_VWAP", "RJ_BB", "RJ_OB", "RJ_FVG", "RT_LVL"],
    description: "REJ / RJ_* / RT",
  },
  {
    key: "event-breakout",
    label: "Break",
    eventKeys: ["BRK", "BRK_DN"],
    description: "BRK / BRK_DN",
  },
  {
    key: "event-ma-vwap-bb",
    label: "MA/VWAP",
    eventKeys: ["PX_EMA", "EMA_X", "PX_VWAP", "PX_VWAP_DN", "PX_BB_MID"],
    description: "EMA / VWAP / BB",
  },
  {
    key: "event-momentum",
    label: "Momentum",
    eventKeys: ["MACD_X", "MACD_X_DN", "RSI_OS", "RSI_OB", "RSI_50_UP", "RSI_50_DN", "DIV"],
    description: "MACD / RSI / DIV",
  },
  {
    key: "event-trend-phase",
    label: "Trend",
    eventKeys: ["TREND_B", "TREND_S", "IMPULSE", "PULLBACK"],
    description: "Trend / Phase",
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

function formatAnalysisNumber(value = null, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "n/a";
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatAnalysisSignedNumber(value = null, decimals = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "n/a";
  const formatted = formatAnalysisNumber(Math.abs(numeric), decimals);
  if (numeric > 0) return `+${formatted}`;
  if (numeric < 0) return `-${formatted}`;
  return formatted;
}

function formatAnalysisTargetPrice(value = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) <= 0) return "";
  const magnitude = Math.abs(numeric);
  const decimals =
    magnitude >= 1000 ? 1 : magnitude >= 100 ? 2 : magnitude >= 1 ? 3 : 5;
  return formatAnalysisNumber(numeric, decimals);
}

function analysisPricesDiffer(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) > Math.max(Math.abs(a || b) * 0.00005, 0.00001);
}

function buildAnalysisTargetPair(startPrice, endPrice, tone) {
  const startText = formatAnalysisTargetPrice(startPrice);
  const endText = formatAnalysisTargetPrice(endPrice);
  if (!startText || !endText) return null;
  return {
    text: `${startText} ${Number(endPrice) < Number(startPrice) ? "↘" : "↗"} ${endText}`,
    tone,
    hasInlineDirection: true,
  };
}

function resolveAnalysisTargetVisual(entry = {}) {
  const currentPrice = Number(entry?.last_close);
  const bias = String(entry?.bias || "").trim().toLowerCase();
  const trend = String(entry?.trend || "").trim().toLowerCase();
  const rangeMode = String(entry?.phase_target?.range_mode || "").trim().toLowerCase();
  const phaseTargetKind = String(entry?.phase_target?.kind || "").trim().toLowerCase();
  if (phaseTargetKind === "range" || rangeMode === "surrounding_bounds") return null;
  const anchorPrice = Number(entry?.phase_target?.anchor_price);
  const explicitTargetPrice = Number(entry?.phase_target?.target_price);
  const low = Number(entry?.phase_target?.low);
  const high = Number(entry?.phase_target?.high);
  const targetPrice = Number(entry?.phase_target_price);
  const validLow = Number.isFinite(low) && Math.abs(low) > 0 ? low : null;
  const validHigh = Number.isFinite(high) && Math.abs(high) > 0 ? high : null;
  const fallbackPrice =
    Number.isFinite(targetPrice) && Math.abs(targetPrice) > 0 ? targetPrice : null;
  const rangeLow = validLow ?? fallbackPrice;
  const rangeHigh = validHigh ?? fallbackPrice;
  if (!Number.isFinite(rangeLow) && !Number.isFinite(rangeHigh) && !Number.isFinite(fallbackPrice)) {
    return null;
  }
  const lowPrice = Number.isFinite(rangeLow) ? rangeLow : fallbackPrice;
  const highPrice = Number.isFinite(rangeHigh) ? rangeHigh : fallbackPrice;
  const midPrice =
    Number.isFinite(lowPrice) && Number.isFinite(highPrice)
      ? (lowPrice + highPrice) / 2
      : Number.isFinite(fallbackPrice)
        ? fallbackPrice
        : null;
  if (!Number.isFinite(midPrice) || Math.abs(midPrice) <= 0) return null;
  const directionalBullish = bias === "bullish" || trend === "up";
  const directionalBearish = bias === "bearish" || trend === "down";
  const tone = directionalBullish
    ? "#22c55e"
    : directionalBearish
      ? "#ef4444"
      : Number.isFinite(currentPrice) && midPrice < currentPrice
        ? "#ef4444"
        : Number.isFinite(currentPrice) && midPrice > currentPrice
        ? "#22c55e"
          : "rgba(226, 232, 240, 0.92)";
  if (rangeMode === "anchor_to_target" && Number.isFinite(anchorPrice)) {
    const pairedTarget =
      Number.isFinite(explicitTargetPrice) && analysisPricesDiffer(anchorPrice, explicitTargetPrice)
        ? explicitTargetPrice
        : Number.isFinite(highPrice) && analysisPricesDiffer(anchorPrice, highPrice)
          ? highPrice
          : Number.isFinite(lowPrice) && analysisPricesDiffer(anchorPrice, lowPrice)
            ? lowPrice
            : Number.isFinite(fallbackPrice) && analysisPricesDiffer(anchorPrice, fallbackPrice)
              ? fallbackPrice
              : Number.isFinite(currentPrice) && analysisPricesDiffer(anchorPrice, currentPrice)
                ? currentPrice
                : null;
    const anchorPair = buildAnalysisTargetPair(anchorPrice, pairedTarget, tone);
    if (anchorPair) return anchorPair;
  }
  const hasRange =
    Number.isFinite(lowPrice) &&
    Number.isFinite(highPrice) &&
    analysisPricesDiffer(lowPrice, highPrice);
  if (!hasRange) {
    if (Number.isFinite(currentPrice) && Number.isFinite(midPrice) && analysisPricesDiffer(currentPrice, midPrice)) {
      const currentPair = buildAnalysisTargetPair(currentPrice, midPrice, tone);
      if (currentPair) return currentPair;
    }
    const single = formatAnalysisTargetPrice(midPrice);
    return single
      ? {
          text: single,
          tone,
          hasInlineDirection: false,
        }
      : null;
  }
  const descending = directionalBearish
    ? true
    : directionalBullish
      ? false
      : Number.isFinite(currentPrice)
        ? midPrice < currentPrice
        : lowPrice < highPrice;
  const start = descending ? highPrice : lowPrice;
  const end = descending ? lowPrice : highPrice;
  return buildAnalysisTargetPair(start, end, tone);
}

function formatAnalysisComponent(component = {}) {
  const name = formatAnalysisLabel(component?.name, "Signal");
  const value = formatAnalysisLabel(component?.value, "n/a");
  const weight = Number(component?.weight);
  const weightText = Number.isFinite(weight) ? ` (${formatAnalysisSignedNumber(weight, 0)})` : "";
  return `${name}: ${value}${weightText}`;
}

function phaseLogicText(entry = {}) {
  const phase = String(entry?.phase || "").trim().toLowerCase();
  const source = String(entry?.phase_source || "").trim().toLowerCase();
  const detail = String(entry?.phase_detail || "").trim().toLowerCase();
  if (phase === "reversal") {
    return "Triggered by CHOCH structure flip.";
  }
  if (phase === "impulse") {
    return "Triggered by BOS plus displacement candle expansion.";
  }
  if (phase === "pullback") {
    return "Triggered when trend stays aligned and price retests zone / EMA20 / liquidity sweep.";
  }
  if (phase === "continuation") {
    if (source === "vwap_ema_reclaim") return "Triggered by aligned reclaim of VWAP and EMA20 with bias intact.";
    return "Triggered when bias stays aligned and continuation evidence confirms trend resumption.";
  }
  if (phase === "consolidation") {
    if (detail === "consolidation") return "Triggered when signals are mixed, neutral, or compressed.";
    return "Triggered when trend is unclear and price is behaving like a range.";
  }
  return "Phase is derived from structure, trend, bias, and zone context.";
}

function buildBiasTooltip(entry = {}, tf = "") {
  const indicators = entry?.indicators || {};
  const components = Array.isArray(entry?.score_components?.bias) ? entry.score_components.bias : [];
  const lines = [
    `${displayTfLabel(tf)} Bias`,
    `State: ${formatAnalysisLabel(entry?.bias, "Neutral")}`,
    `Strength: ${formatAnalysisLabel(entry?.bias_strength, "Neutral")}`,
    `Score: ${formatAnalysisSignedNumber(entry?.bias_score, 0)}`,
    `Source: ${formatAnalysisLabel(entry?.bias_source, "Score")}`,
    "",
    "Logic:",
    "Bias combines structure, VWAP, EMA20, EMA50, EMA stack, EMA20 slope, active zone, and recent price slope.",
    ...(components.length
      ? ["", "Signals:", ...components.map((component) => `- ${formatAnalysisComponent(component)}`)]
      : []),
    "",
    "Technical values:",
    `- Close: ${formatAnalysisNumber(indicators?.close, 2)}`,
    `- VWAP: ${formatAnalysisNumber(indicators?.vwap, 2)} (${indicators?.above_vwap === true ? "price above" : indicators?.above_vwap === false ? "price below" : "n/a"})`,
    `- EMA20: ${formatAnalysisNumber(indicators?.ema_20, 2)} (${indicators?.above_ema_20 === true ? "price above" : indicators?.above_ema_20 === false ? "price below" : "n/a"})`,
    `- EMA50: ${formatAnalysisNumber(indicators?.ema_50, 2)} (${indicators?.above_ema_50 === true ? "price above" : indicators?.above_ema_50 === false ? "price below" : "n/a"})`,
    `- EMA stack: ${formatAnalysisLabel(indicators?.ema_stack, "Flat")}`,
    `- EMA20 slope: ${formatAnalysisLabel(indicators?.ema_20_slope, "Flat")}`,
    `- EMA50 slope: ${formatAnalysisLabel(indicators?.ema_50_slope, "Flat")}`,
    `- Structure state: ${formatAnalysisLabel(entry?.structure_state, "None")}`,
  ];
  return lines.join("\n");
}

function buildTrendTooltip(entry = {}, tf = "") {
  const indicators = entry?.indicators || {};
  const components = Array.isArray(entry?.score_components?.trend) ? entry.score_components.trend : [];
  const lines = [
    `${displayTfLabel(tf)} Trend`,
    `State: ${formatAnalysisLabel(entry?.trend, "Range")}`,
    `Strength: ${formatAnalysisLabel(entry?.trend_strength, "Neutral")}`,
    `Score: ${formatAnalysisSignedNumber(entry?.trend_score, 0)}`,
    `Source: ${formatAnalysisLabel(entry?.trend_source, "Mixed Signals")}`,
    "",
    "Logic:",
    "Trend combines bias direction, recent swing structure, EMA stack, EMA slopes, and recent price drift.",
    ...(components.length
      ? ["", "Signals:", ...components.map((component) => `- ${formatAnalysisComponent(component)}`)]
      : []),
    "",
    "Technical values:",
    `- Close: ${formatAnalysisNumber(indicators?.close, 2)}`,
    `- EMA20: ${formatAnalysisNumber(indicators?.ema_20, 2)}`,
    `- EMA50: ${formatAnalysisNumber(indicators?.ema_50, 2)}`,
    `- EMA stack: ${formatAnalysisLabel(indicators?.ema_stack, "Flat")}`,
    `- EMA20 slope: ${formatAnalysisLabel(indicators?.ema_20_slope, "Flat")}`,
    `- EMA50 slope: ${formatAnalysisLabel(indicators?.ema_50_slope, "Flat")}`,
    `- Structure state: ${formatAnalysisLabel(entry?.structure_state, "Mixed")}`,
  ];
  return lines.join("\n");
}

function buildPhaseTooltip(entry = {}, tf = "") {
  const targetVisual = resolveAnalysisTargetVisual(entry);
  const lines = [
    `${displayTfLabel(tf)} Phase`,
    `State: ${formatAnalysisLabel(entry?.phase, "Unknown")}`,
    `Detail: ${formatAnalysisLabel(entry?.phase_detail, formatAnalysisLabel(entry?.phase, "Unknown"))}`,
    `Source: ${formatAnalysisLabel(entry?.phase_source, "Derived")}`,
    ...(targetVisual?.text
      ? [
          `Target: ${targetVisual.text}`,
          `Target source: ${formatAnalysisLabel(entry?.phase_target_label || entry?.phase_target_source, "Derived")}`,
        ]
      : []),
    "",
    "Logic:",
    phaseLogicText(entry),
    "",
    "Inputs used:",
    `- Bias: ${formatAnalysisLabel(entry?.bias, "Neutral")} (${formatAnalysisLabel(entry?.bias_strength, "Neutral")}, score ${formatAnalysisSignedNumber(entry?.bias_score, 0)})`,
    `- Trend: ${formatAnalysisLabel(entry?.trend, "Range")} (${formatAnalysisLabel(entry?.trend_strength, "Neutral")}, score ${formatAnalysisSignedNumber(entry?.trend_score, 0)})`,
    `- Structure state: ${formatAnalysisLabel(entry?.structure_state, "None")}`,
  ];
  return lines.join("\n");
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

function phaseGlyph(phase = "") {
  const normalized = String(phase || "").trim().toLowerCase();
  if (normalized === "continuation") return "»";
  if (normalized === "consolidation") return "▭";
  if (normalized === "pullback") return "∿";
  if (normalized === "reversal") return "↻";
  if (normalized === "impulse") return "⚡";
  return "•";
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
  if (bias === "bullish" || trend === "up") return "↗";
  if (bias === "bearish" || trend === "down") return "↘";
  return "↔";
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

function targetDirectionGlyph(entry = {}) {
  const bias = String(entry?.bias || "").trim().toLowerCase();
  const trend = String(entry?.trend || "").trim().toLowerCase();
  if (bias === "bullish" || trend === "up") return "↗";
  if (bias === "bearish" || trend === "down") return "↘";
  return "↔";
}

function RealtimeTfAnalysisOverlay({
  analysisByTf = {},
  orderedTfs = [],
  activeTf = "",
  recentEventsByTf = {},
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
        top: 6,
        left: 8,
        zIndex: 11,
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 110,
        padding: "1px 2px",
        borderRadius: 0,
        background: "transparent",
        border: "none",
        boxShadow: "none",
        backdropFilter: "none",
      }}
    >
      {rows.map((tf) => {
        const entry = analysisByTf[tf];
        const isActive = String(activeTf || "").trim().toLowerCase() === tf;
        const tfColor = artifactTimeframeColor(tf);
        const accent = analysisAccentColor(entry);
        const biasTooltip = buildBiasTooltip(entry, tf);
        const trendTooltip = buildTrendTooltip(entry, tf);
        const phaseTooltip = buildPhaseTooltip(entry, tf);
        const phaseTargetVisual = resolveAnalysisTargetVisual(entry);
        const recentEvents = Array.isArray(recentEventsByTf?.[tf])
          ? recentEventsByTf[tf]
          : recentEventsByTf?.[tf]
            ? [recentEventsByTf[tf]]
            : [];
        return (
          <div
            key={tf}
            style={{
              display: "grid",
              gridTemplateColumns: "24px auto",
              alignItems: "start",
              columnGap: 5,
              fontSize: 10,
              lineHeight: 1.15,
              color: isActive ? "#f8fafc" : "rgba(226, 232, 240, 0.94)",
              fontWeight: isActive ? 700 : 600,
            }}
          >
            <span
              style={{ color: tfColor }}
              title={`${displayTfLabel(tf)} analysis summary`}
            >
              {displayTfLabel(tf)}
            </span>
            <span
              style={{
                minWidth: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: 4,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  color: accent,
                  borderRadius: 999,
                  padding: "0 3px",
                  letterSpacing: 0.1,
                  background: `${accent}12`,
                  cursor: "help",
                  pointerEvents: "auto",
                }}
                title={phaseTooltip}
              >
                <span>{phaseGlyph(entry?.phase)}</span>
                <span>{compactPhaseLabel(entry?.phase)}</span>
              </span>
              {phaseTargetVisual?.text ? (
                <span
                  style={{
                    color: phaseTargetVisual.tone,
                    borderRadius: 999,
                    padding: "0 3px",
                    letterSpacing: 0.08,
                    fontVariantNumeric: "tabular-nums",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 2,
                    background: "transparent",
                  }}
                  title={phaseTooltip}
                >
                  {phaseTargetVisual?.hasInlineDirection ? null : (
                    <span>{targetDirectionGlyph(entry)}</span>
                  )}
                  {phaseTargetVisual.text}
                </span>
              ) : null}
              {recentEvents.map((recentEvent, index) => {
                const eventKey = [
                  tf,
                  recentEvent?.eventId || recentEvent?.event_id || recentEvent?.id || "",
                  recentEvent?.markerText || "",
                  recentEvent?.direction || "",
                  recentEvent?.eventTime || recentEvent?.time || recentEvent?.bar_time_unix || "",
                  index,
                ].join("-");
                return (
                <span
                  key={eventKey}
                  style={{
                    color: recentEvent.color,
                    border: "none",
                    borderRadius: 999,
                    padding: "0 3px",
                    letterSpacing: 0.08,
                    fontVariantNumeric: "tabular-nums",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    background: `${recentEvent.color}12`,
                  }}
                  title={recentEvent.title}
                >
                  <span>
                    {recentEvent.direction === "sell"
                      ? "↓"
                      : recentEvent.direction === "buy"
                        ? "↑"
                        : "•"}
                  </span>
                  {recentEvent.markerText}
                </span>
                );
              })}
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
  volume: true,
  stochK: false,
  stochD: false,
  sma20: true,
  sma50: true,
  sma200: true,
  ema20: false,
  ema50: false,
  ema200: false,
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
const DEFAULT_SYMBOL_CHART_TFS = Object.freeze(["D", "4h", "15m", "5m"]);
const EMPTY_ARRAY = Object.freeze([]);

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

function normalizeArtifactEventVisibility(rawVisibility = {}) {
  if (
    !rawVisibility ||
    typeof rawVisibility !== "object" ||
    Array.isArray(rawVisibility)
  ) {
    return {};
  }
  const next = {};
  for (const [eventKeyRaw, value] of Object.entries(rawVisibility)) {
    const eventKey = String(eventKeyRaw || "").trim();
    if (!eventKey || typeof value !== "boolean") continue;
    next[eventKey] = value;
  }
  return next;
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

function tradeMatchesTimeframe(trade = {}, tf = "") {
  const chartTf = displayTfLabel(tf);
  const tradeTf = displayTfLabel(trade?.tf || trade?.timeframe || "");
  if (!chartTf || !tradeTf) return false;
  return chartTf === tradeTf;
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

function RefreshIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M10.75 3.25V5.9H8.1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.9 9.95V7.3H5.55"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.98 5.02C4.33 4.04 5.25 3.34 6.33 3.26C7.41 3.18 8.42 3.75 8.93 4.7L10.75 5.9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.02 7.98C8.67 8.96 7.75 9.66 6.67 9.74C5.59 9.82 4.58 9.25 4.07 8.3L2.25 7.1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReplayPlayIcon({ size = 14 }) {
  const iconSize = Math.max(10, Number(size) || 14);
  return (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5.5 3.75L12 8L5.5 12.25V3.75Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReplayPauseIcon({ size = 14 }) {
  const iconSize = Math.max(10, Number(size) || 14);
  return (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect x="4" y="3.5" width="2.5" height="9" rx="0.75" fill="currentColor" />
      <rect x="9.5" y="3.5" width="2.5" height="9" rx="0.75" fill="currentColor" />
    </svg>
  );
}

function ReplayStopIcon({ size = 14 }) {
  const iconSize = Math.max(10, Number(size) || 14);
  return (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="8" height="8" rx="1.25" fill="currentColor" />
    </svg>
  );
}

function LayersIcon({ size = 14 }) {
  const iconSize = Math.max(10, Number(size) || 14);
  return (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 2.75L13 5.5L8 8.25L3 5.5L8 2.75Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M3 8.25L8 11L13 8.25"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 11L8 13.75L13 11"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LayersTabChartIcon() {
  return <span style={{ fontSize: 11, fontWeight: 800, lineHeight: 1 }}>◫</span>;
}

function LayersTabArtifactsIcon() {
  return <span style={{ fontSize: 11, fontWeight: 800, lineHeight: 1 }}>◇</span>;
}

function LayersTabEventsIcon() {
  return <span style={{ fontSize: 11, fontWeight: 800, lineHeight: 1 }}>✦</span>;
}

function LayersTabMomentumIcon() {
  return <span style={{ fontSize: 11, fontWeight: 800, lineHeight: 1 }}>∿</span>;
}

function LayersTabTrendIcon() {
  return <span style={{ fontSize: 11, fontWeight: 800, lineHeight: 1 }}>↗</span>;
}

function SaveConfigIcon({ size = 13 }) {
  const iconSize = Math.max(10, Number(size) || 13);
  return (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 2.5H10.8L13 4.7V13.5H3V2.5Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M5 2.8H9.2V5.8H5V2.8Z" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5.2 10.1H10.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M5.2 12H10.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
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
  if (
    type === "swing_low_segment" ||
    type === "swing_low_level" ||
    type === "swing_low_source"
  ) {
    return "SL";
  }
  if (
    type === "swing_high_segment" ||
    type === "swing_high_level" ||
    type === "swing_high_source"
  ) {
    return "SH";
  }
  if (type === "trendline_support" || type === "trendline_resistance" || type === "trendline") {
    return "TL";
  }
  if (type === "bullish_divergence" || type === "bearish_divergence" || type === "divergence") {
    return "DIV";
  }
  if (type === "bullish_engulfing" || type === "bearish_engulfing") {
    return "ENG";
  }
  if (type === "bullish_pin_bar" || type === "bearish_pin_bar") {
    return "PIN";
  }
  if (type === "inside_bar") return "INSI";
  if (type === "outside_bar") return "OUTS";
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
  if (type === "liquidity_low") return "SSL";
  if (type === "liquidity_high") return "BSL";
  if (type === "support") return "SUP";
  if (type === "demand") return "DEM";
  if (type === "supply") return "SPLY";
  if (type === "pdh") return "PDH";
  if (type === "pdl") return "PDL";
  if (type === "fvg") return "FVG";
  if (type === "ob") return "OB";
  if (type === "bos") return "BOS";
  if (type === "choch") return "CHOCH";
  if (type === "sweep_high" || type === "sweep_low") return "SW";
  if (type === "key_level") return "KL";
  if (type === "strategy") return "STR";
  return type.replaceAll("_", " ");
}

function sanitizeChartText(value = "") {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const normalized = text.toLowerCase();
  if (normalized === "null" || normalized === "undefined") return "";
  return text;
}

function joinChartText(parts = [], separator = " · ") {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => sanitizeChartText(part))
    .filter(Boolean)
    .join(separator);
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
    (
      typeRaw === "swing_high" ||
      typeRaw === "swing_low" ||
      typeRaw === "swing_high_segment" ||
      typeRaw === "swing_low_segment" ||
      typeRaw === "swing_high_level" ||
      typeRaw === "swing_low_level"
    )
  ) {
    return "";
  }
  const groupKey = artifactGroupKeyForItem(item);
  if (groupKey === "fvg" || groupKey === "ifvg" || groupKey === "bb" || groupKey === "ob") {
    return artifactTypeAbbr(artifactDisplayTypeKey(item));
  }
  const type = artifactTypeAbbr(artifactDisplayTypeKey(item));
  return type;
}

function humanizeArtifactLabel(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  return raw
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function artifactFullLabel(item = {}) {
  if (item?.is_event) {
    const groupKey = artifactGroupKeyForItem(item);
    const eventKey = artifactMarkerText(item);
    const baseLabel =
      groupKey === "ob"
        ? "OB"
        : groupKey === "bb"
          ? "BB"
          : groupKey === "fvg"
            ? "FVG"
            : groupKey === "ifvg"
              ? "iFVG"
              : "";
    if (baseLabel && eventKey) return `${baseLabel} ${eventKey}`;
  }
  const candidates = [
    item?.label,
    item?.artifact_payload?.label,
    item?.payload?.pattern_type,
    item?.artifact_payload?.payload?.pattern_type,
    item?.type,
    item?.artifact_type,
  ];
  for (const candidate of candidates) {
    let value = humanizeArtifactLabel(candidate);
    value = value.replace(/^(Bullish|Bearish)\s+/i, "").trim();
    if (value) return value;
  }
  return "";
}

function artifactLevelLabel(item = {}, fallbackTf = "") {
  return artifactInlineLabel(item, fallbackTf);
}

function artifactEventSourceAbbr(item = {}) {
  const payload =
    item?.payload && typeof item.payload === "object"
      ? item.payload
      : item?.artifact_payload?.payload && typeof item.artifact_payload.payload === "object"
        ? item.artifact_payload.payload
        : {};
  const rawType =
    String(
      payload.converted_from ||
        payload.converted_to ||
        payload.source_artifact_type ||
        item?.type ||
        item?.artifact_type ||
        "",
    )
      .trim()
      .toLowerCase();
  if (!rawType) return "";
  return artifactTypeAbbr(rawType).slice(0, 6).toUpperCase();
}

function artifactMarkerText(item = {}) {
  const eventKey = String(item?.event_key || "").trim().toLowerCase();
  if (eventKey === "reject") return "REJ";
  if (eventKey === "breakout") return "BRK";
  const type = artifactDisplayTypeKey(item);
  if (type === "bos") return "BOS";
  if (type === "choch") return "CH";
  if (type === "sweep_high" || type === "sweep_low") return "SW";
  if (type === "inside_bar") return "INSI";
  if (type === "outside_bar") return "OUTS";
  if (type === "liquidity_high") return "BSL";
  if (type === "liquidity_low") return "SSL";
  if (type === "hh" || type === "hl" || type === "lh" || type === "ll") {
    return type.toUpperCase();
  }
  if (type === "swing_high_event") return "SH";
  if (type === "swing_low_event") return "SL";
  if (type === "bullish_divergence" || type === "bearish_divergence" || type === "divergence") {
    return "DIV";
  }
  return artifactTypeAbbr(type).slice(0, 4).toUpperCase();
}

function isTrueSignalEventItem(item = {}) {
  if (!item || typeof item !== "object" || item?.is_event !== true) return false;
  const type = artifactDisplayTypeKey(item);
  const groupKey = artifactGroupKeyForItem(item);
  if (
    type === "liquidity_high" ||
    type === "liquidity_low" ||
    type === "hh" ||
    type === "hl" ||
    type === "lh" ||
    type === "ll" ||
    groupKey === "support" ||
    groupKey === "resistance" ||
    groupKey === "demand" ||
    groupKey === "supply"
  ) {
    return false;
  }
  return true;
}

const DEFAULT_HIDDEN_SIGNAL_EVENT_KEYS = new Set(["INSI", "OUTS", "SH", "SL"]);
const DEFAULT_VISIBLE_SIGNAL_EVENT_KEYS = new Set([
  "SW",
  "BOS",
  "CH",
  "ENG",
  "PIN",
  "REJ",
  "BRK",
  "DIV",
]);
const DEFAULT_HIDDEN_ARTIFACT_GROUP_KEYS = new Set(["swings", "patterns"]);

function resolveArtifactEventDirection(item = {}, bars = [], timeframe = "") {
  if (Array.isArray(bars) && bars.length) {
    const eventTimeSec =
      Number(item?.event_time ?? item?.anchor_time ?? item?.bar_end ?? item?.bar_start ?? item?.time) ||
      null;
    const eventPrice =
      Number(item?.payload?.marker_price ?? item?.price ?? item?.payload?.level) || null;
    const confirmedDirection = resolveConfirmedPostEventDirection({
      bars,
      eventTimeSec,
      timeframe,
      eventPrice,
    });
    if (confirmedDirection === "buy" || confirmedDirection === "sell") {
      return confirmedDirection;
    }
    return "neutral";
  }
  const artifactPayload =
    item?.artifact_payload && typeof item.artifact_payload === "object"
      ? item.artifact_payload
      : {};
  const payload =
    item?.payload && typeof item.payload === "object"
      ? item.payload
      : item?.artifact_payload?.payload && typeof item.artifact_payload.payload === "object"
        ? item.artifact_payload.payload
        : {};
  const directionCandidates = [
    item?.event_direction,
    item?.direction,
    artifactPayload?.event_direction,
    artifactPayload?.direction,
    payload?.bias,
    item?.subtype,
    artifactPayload?.subtype,
    item?.type,
    artifactPayload?.type,
    item?.label,
    artifactPayload?.label,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  const direction = directionCandidates.find(Boolean) || "";
  if (direction === "sell" || direction === "bearish") return "sell";
  if (direction === "buy" || direction === "bullish") return "buy";
  if (directionCandidates.some((value) => value.includes("sell") || value.includes("bear"))) {
    return "sell";
  }
  if (directionCandidates.some((value) => value.includes("buy") || value.includes("bull"))) {
    return "buy";
  }
  return "neutral";
}

function markerShapeForConfirmedDirection(direction = "neutral") {
  if (direction === "sell") return "arrowDown";
  if (direction === "buy") return "arrowUp";
  return "circle";
}

function markerPositionForConfirmedDirection(direction = "neutral") {
  if (direction === "sell") return "aboveBar";
  return "belowBar";
}

function defaultArtifactEventVisible(item = {}) {
  if (!isTrueSignalEventItem(item)) return true;
  const eventKey = artifactMarkerText(item);
  if (!eventKey) return false;
  if (eventKey.startsWith("BRK ") || eventKey.startsWith("REJ ")) return true;
  if (DEFAULT_VISIBLE_SIGNAL_EVENT_KEYS.has(eventKey)) return true;
  if (DEFAULT_HIDDEN_SIGNAL_EVENT_KEYS.has(eventKey)) return false;
  return resolveArtifactEventDirection(item) !== "neutral";
}

function isSignalArtifactPanelItem(item = {}) {
  if (!item || typeof item !== "object") return false;
  const groupKey = artifactGroupKeyForItem(item);
  if (
    groupKey === "bos" ||
    groupKey === "choch" ||
    groupKey === "sweep" ||
    groupKey === "patterns" ||
    groupKey === "swings"
  ) {
    return true;
  }
  return isTrueSignalEventItem(item);
}

function defaultArtifactGroupVisible(groupKey = "") {
  return !DEFAULT_HIDDEN_ARTIFACT_GROUP_KEYS.has(
    String(groupKey || "").trim().toLowerCase(),
  );
}

function signalEventColorFromDirection(direction = "neutral") {
  if (direction === "sell") return "#ef4444";
  if (direction === "buy") return "#22c55e";
  return "rgba(148, 163, 184, 0.38)";
}

function eventMarkerSizeForConfirmedDirection(direction = "neutral") {
  return direction === "neutral" ? 2.2 : 4;
}

function eventPanelGroupRank(eventKey = "") {
  const key = String(eventKey || "").trim().toUpperCase();
  if (["ENG", "PIN", "INSI", "OUTS"].includes(key)) return 1;
  if (["BOS", "CH", "SW", "SH", "SL"].includes(key)) return 3;
  if (["REJ", "BRK"].includes(key)) return 4;
  if (["DIV"].includes(key)) return 5;
  return 9;
}

function resolveZoneEventMarkerPrice(item = {}, top = null, bottom = null, fallbackPrice = null) {
  const payload =
    item?.payload && typeof item.payload === "object"
      ? item.payload
      : item?.artifact_payload?.payload && typeof item.artifact_payload.payload === "object"
        ? item.artifact_payload.payload
        : {};
  const lifecycleState = String(payload.lifecycle_state || "").trim().toLowerCase();
  const eventKey = String(item?.event_key || "").trim().toLowerCase();
  const direction = String(
    item?.event_direction || item?.direction || payload?.bias || item?.subtype || "",
  )
    .trim()
    .toLowerCase();
  const bearish = direction === "sell" || direction === "bearish";
  const bullish = direction === "buy" || direction === "bullish";
  if (
    eventKey === "breakout" ||
    lifecycleState === "broken_through" ||
    lifecycleState === "converted_active" ||
    lifecycleState === "converted_touched_no_resolution"
  ) {
    if (bearish && Number.isFinite(bottom)) return bottom;
    if (bullish && Number.isFinite(top)) return top;
  }
  if (
    eventKey === "reject" ||
    lifecycleState === "rejected_touch" ||
    lifecycleState === "converted_rejected_touch"
  ) {
    if (bearish && Number.isFinite(top)) return top;
    if (bullish && Number.isFinite(bottom)) return bottom;
  }
  if (Number.isFinite(fallbackPrice)) return fallbackPrice;
  if (Number.isFinite(top) && Number.isFinite(bottom)) return (top + bottom) / 2;
  return Number.isFinite(top) ? top : bottom;
}

function strategyHitRuleEvent(hit = {}) {
  const event = hit?.ruleEvent || hit?.rule_event;
  return event && typeof event === "object" && !Array.isArray(event) ? event : {};
}

function strategyHitMarkerText(hit = {}) {
  const ruleEvent = strategyHitRuleEvent(hit);
  const ruleLabel = String(ruleEvent?.artifact?.label || ruleEvent?.abbr || "").trim();
  if (ruleLabel) return ruleLabel;
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
    String(ruleEvent?.name || ruleEvent?.rule_id || "").trim() ||
    String(hit?.eventName || hit?.event_name || "").trim() ||
    artifactTypeAbbr(eventName || "strategy").slice(0, 4).toUpperCase()
  );
}

function strategyHitToChartObject(hit = {}, fallbackTf = "") {
  const ruleEvent = strategyHitRuleEvent(hit);
  const timeSec = Number(ruleEvent?.time ?? hit?.barTimeUnix ?? hit?.bar_time_unix ?? 0);
  if (!Number.isFinite(timeSec) || timeSec <= 0) return null;
  const ruleId = String(ruleEvent?.rule_id || hit?.eventId || hit?.event_id || "strategy")
    .trim()
    .toLowerCase();
  const sourceTf = String(ruleEvent?.tf || hit?.sourceTf || hit?.source_tf || hit?.tf || fallbackTf || "").trim();
  const sourceTfColor = artifactTimeframeColor(sourceTf);
  const latestArtifactGroup = artifactGroupKeyForItem(hit?.latestArtifact || {});
  const baseMarkerColor = String(hit?.markerColor || sourceTfColor || "#38bdf8");
  const markerColor =
    latestArtifactGroup === "bb"
      ? brightenHexColor(baseMarkerColor, 0.3)
      : baseMarkerColor;
  const markerText = strategyHitMarkerText(hit);
  const price = Number(
    ruleEvent?.price ??
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
      ruleEvent?.id ||
        hit?.matchKey ||
        hit?.match_key ||
        `strategy-${String(hit?.strategyId || "strategy")}-${ruleId}-${timeSec}`,
    ),
    kind: "point",
    type: "STRATEGY",
    label:
      sanitizeChartText(ruleEvent?.name) ||
      sanitizeChartText(ruleEvent?.abbr) ||
      sanitizeChartText(hit?.eventName) ||
      sanitizeChartText(hit?.event_name) ||
      sanitizeChartText(hit?.strategyName) ||
      "",
    visible: true,
    tf: String(ruleEvent?.tf || hit?.tf || fallbackTf || "").trim(),
    color: markerColor,
    text_color: String(hit?.markerTextColor || markerColor),
    price: Number.isFinite(price) ? price : null,
    time: timeSec,
    anchorTimeMs: timeSec * 1000,
    anchorPrice: Number.isFinite(price) ? price : null,
    line_style: "dot",
    line_width: 0.1,
    marker_shape: String(hit?.markerShape || "circle"),
    marker_text: markerText,
    marker_position: String(hit?.markerPosition || "belowBar"),
    artifact_family: String(ruleEvent?.family || "strategy").trim().toLowerCase() || "strategy",
    artifact_type: ruleId || "strategy",
    artifact_group: "strategy",
    source_tf: sourceTf,
    is_event: true,
    event_key: markerText,
    event_direction: resolveArtifactEventDirection({
      direction: hit?.markerDirection,
      subtype: ruleEvent?.bias || hit?.eventBias,
      label: markerText,
      artifact_payload: hit,
    }),
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
  const ruleEvent = strategyHitRuleEvent(hit);
  const timeSec = Number(ruleEvent?.time ?? hit?.barTimeUnix ?? hit?.bar_time_unix ?? 0);
  if (!Number.isFinite(timeSec) || timeSec <= 0) return [];
  const tfKey = String(ruleEvent?.tf || hit?.tf || fallbackTf || "").trim().toLowerCase();
  const eventKey = String(ruleEvent?.rule_id || hit?.eventId || hit?.event_id || "strategy").trim().toLowerCase();
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

function canProjectArtifactAcrossTf(item = {}) {
  if (item?.is_event) return false;
  const groupKey = artifactGroupKeyForItem(item);
  return new Set([
    "fvg",
    "ifvg",
    "ob",
    "bb",
    "support",
    "demand",
    "pdh",
    "pdl",
  ]).has(groupKey);
}

function shouldShowArtifactOnChart(item = {}, sourceTf = "", chartTf = "") {
  const hasSourceTf = String(sourceTf || "").trim().length > 0;
  const hasChartTf = String(chartTf || "").trim().length > 0;
  if (!hasSourceTf || !hasChartTf) return true;
  const normalizedSourceTf = artifactSourceTfLabel(sourceTf);
  const normalizedChartTf = artifactSourceTfLabel(chartTf);
  if (normalizedSourceTf === normalizedChartTf) return true;
  const sourceSeconds = Number(timeframeToSeconds(normalizedSourceTf)) || 0;
  const chartSeconds = Number(timeframeToSeconds(normalizedChartTf)) || 0;
  if (!sourceSeconds || !chartSeconds) return true;
  if (sourceSeconds < chartSeconds) return false;
  return canProjectArtifactAcrossTf(item);
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

function buildRequestedDataTimeframes(timeframes = [], includeAnalysisTfs = false) {
  const visible = (Array.isArray(timeframes) ? timeframes : [])
    .map((tf) =>
      String(tf || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
  const merged = includeAnalysisTfs ? [...visible] : visible;
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

function withHexAlpha(color = "", alpha = "ff") {
  const base = String(color || "").trim();
  const normalized = /^#[0-9a-f]{8}$/i.test(base) ? base.slice(0, 7) : base;
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) return base;
  return `${normalized}${String(alpha || "ff").trim()}`;
}

function brightenHexColor(color = "", amount = 0.2) {
  const base = String(color || "").trim();
  const normalized = /^#[0-9a-f]{8}$/i.test(base) ? base.slice(0, 7) : base;
  const match = normalized.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return base;
  const mix = Math.max(0, Math.min(1, Number(amount) || 0));
  const nextChannel = (hex) => {
    const current = parseInt(hex, 16);
    const next = Math.round(current + (255 - current) * mix);
    return Math.max(0, Math.min(255, next))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${nextChannel(match[1])}${nextChannel(match[2])}${nextChannel(match[3])}`;
}

function artifactColorForItem(item = {}) {
  if (item?.is_event) {
    const direction = resolveArtifactEventDirection(item);
    return signalEventColorFromDirection(direction);
  }
  const timeframeColor = artifactTimeframeColor(item?.timeframe || item?.tf || item?.source_tf);
  const group = artifactGroupKeyForItem(item);
  if (group === "fvg" || group === "ifvg" || group === "ob" || group === "bb") {
    return withHexAlpha(timeframeColor, "55");
  }
  if (timeframeColor) return timeframeColor;
  if (group === "pdh" || group === "pdl") return "#94a3b8";
  if (
    group === "support" ||
    group === "resistance" ||
    group === "demand" ||
    group === "supply"
  ) {
    return "#94a3b8";
  }
  if (group === "fvg" || group === "ifvg") return "#94a3b8";
  if (group === "ob" || group === "bb") return "#f59e0b";
  if (group === "liquidity") return "#14b8a6";
  if (group === "swings") return "#60a5fa";
  if (group === "trendline") return "#22c55e";
  if (group === "divergence") return "#f472b6";
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
  if (type.includes("resistance") || label.includes("resistance")) return "resistance";
  if (type.includes("demand") || label.includes("demand")) return "demand";
  if (type.includes("supply") || label.includes("supply")) return "supply";
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
  if (type === "hh" || type === "hl" || type === "lh" || type === "ll") return "swings";
  if (
    type === "hh_level" ||
    type === "hl_level" ||
    type === "lh_level" ||
    type === "ll_level" ||
    type === "hh_pivot" ||
    type === "hl_pivot" ||
    type === "lh_pivot" ||
    type === "ll_pivot"
  ) {
    return "swings";
  }
  if (type === "bos" || label.includes("bos")) return "bos";
  if (type === "choch" || label.includes("choch")) return "choch";
  if (type.includes("sweep") || label.includes("sweep")) return "sweep";
  if (type.includes("swing_high") || type.includes("swing_low") || label.includes("swing")) {
    return "swings";
  }
  if (family === "trendline" || type.includes("trendline") || label.includes("trendline")) {
    return "trendline";
  }
  if (family === "divergence" || type.includes("divergence") || label.includes("divergence")) {
    return "divergence";
  }
  if (family === "pattern") return "patterns";
  return type || family || "other";
}

function artifactGroupLabel(groupKey = "") {
  const key = String(groupKey || "").trim().toLowerCase();
  if (key === "pdh") return "PDH";
  if (key === "pdl") return "PDL";
  if (key === "support") return "SUP";
  if (key === "resistance") return "RES";
  if (key === "demand") return "DEM";
  if (key === "supply") return "SUPL";
  if (key === "ifvg") return "iFVG";
  if (key === "fvg") return "FVG";
  if (key === "bb") return "BB";
  if (key === "ob") return "OB";
  if (key === "liquidity") return "LIQ";
  if (key === "bos") return "BOS";
  if (key === "choch") return "CHOCH";
  if (key === "sweep") return "SW";
  if (key === "swings") return "SWG";
  if (key === "trendline") return "TL";
  if (key === "divergence") return "DIV";
  if (key === "patterns") return "PAT";
  return key.toUpperCase() || "Other";
}

function artifactPanelGroupRank(groupKey = "") {
  const key = String(groupKey || "").trim().toLowerCase();
  if (["bb", "ob", "fvg", "ifvg"].includes(key)) return 1;
  if (
    ["support", "resistance", "demand", "supply", "liquidity", "pdh", "pdl"].includes(key)
  ) {
    return 2;
  }
  if (["hh", "hl", "lh", "ll", "swings", "bos", "choch", "sweep"].includes(key)) return 3;
  if (["trendline", "divergence"].includes(key)) return 4;
  if (["patterns"].includes(key)) return 5;
  return 9;
}

function layerGroupChecked(keys = [], visibility = {}) {
  const normalizedKeys = (Array.isArray(keys) ? keys : [])
    .map((key) => String(key || "").trim())
    .filter(Boolean);
  if (!normalizedKeys.length) return false;
  return normalizedKeys.every((key) => visibility?.[key] !== false);
}

function layerGroupDescription(labels = []) {
  return (Array.isArray(labels) ? labels : [])
    .map((label) => String(label || "").trim())
    .filter(Boolean)
    .join(" / ");
}

function summarizeGroupedLayerItems(items = [], groupDefs = [], keyName = "groupKeys") {
  const sourceItems = Array.isArray(items) ? items : [];
  const used = new Set();
  const grouped = [];
  for (const groupDef of Array.isArray(groupDefs) ? groupDefs : []) {
    const keys = (Array.isArray(groupDef?.[keyName]) ? groupDef[keyName] : [])
      .map((key) => String(key || "").trim())
      .filter(Boolean);
    const matches = sourceItems.filter((item) => keys.includes(String(item?.groupKey || item?.eventKey || item?.key || "").trim()));
    if (!matches.length) continue;
    matches.forEach((item) => used.add(String(item?.groupKey || item?.eventKey || item?.key || "").trim()));
    grouped.push({ groupDef, matches });
  }
  const ungrouped = sourceItems.filter((item) => {
    const key = String(item?.groupKey || item?.eventKey || item?.key || "").trim();
    return key && !used.has(key);
  });
  return { grouped, ungrouped };
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

function artifactItemToChartObject(item = {}, fallbackTf = "", barsByTf = null) {
  if (!item || typeof item !== "object") return null;
  const family = String(item.family || "").trim().toLowerCase();
  const type = String(item.type || "").trim();
  const label = String(item.label || item.type || "").trim();
  const tf = String(item.timeframe || fallbackTf || "").trim();
  const barsForTf = Array.isArray(barsByTf?.[tf]) ? barsByTf[tf] : [];
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
    const itemStatus = String(item?.status || "").trim().toLowerCase();
    const lifecycleState = String(item?.payload?.lifecycle_state || "")
      .trim()
      .toLowerCase();
    const explicitEndTimeSec =
      Number(item?.bar_end ?? item?.end_bar ?? item?.payload?.structure_break_time) || null;
    const extendUntouchedSwing =
      itemStatus === "active" && lifecycleState === "awaiting_break";
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
      anchorTimeMs2: extendUntouchedSwing
        ? null
        : Number.isFinite(explicitEndTimeSec)
          ? explicitEndTimeSec * 1000
          : null,
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
    const swingPivotPoint = {
      id: `${String(item.id || `${family}-${type}-${timeSec}`)}:pivot`,
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
      line_style: "solid",
      line_width: 0.1,
      marker_shape: "circle",
      marker_text: "",
      marker_position: "inBar",
      marker_size: 2.5,
      artifact_family: family,
      artifact_type: `${type}_pivot`,
      artifact_group: groupKey,
      source_tf: tf,
      artifact_payload: item,
    };
    return [swingLevelLine, swingPivotPoint];
  }

  if (groupKey === "trendline" || groupKey === "divergence") {
    const fromTimeSec = Number(
      item?.payload?.from_time ?? item?.bar_start ?? item?.anchor_time ?? item?.time,
    );
    const toTimeSec = Number(
      item?.payload?.to_time ?? item?.bar_end ?? item?.anchor_time ?? item?.time,
    );
    const fromPrice = Number(
      item?.payload?.from_price ?? item?.payload?.previous_same_type_price ?? item?.price,
    );
    const toPrice = Number(
      item?.payload?.to_price ?? item?.price,
    );
    if (
      !Number.isFinite(fromTimeSec) ||
      !Number.isFinite(toTimeSec) ||
      !Number.isFinite(fromPrice) ||
      !Number.isFinite(toPrice)
    ) {
      return null;
    }
    const segment = {
      id: String(item.id || `${family}-${type}-${fromTimeSec}-${toTimeSec}`),
      kind: "segment",
      type: type.toUpperCase() || "SEGMENT",
      label: groupKey === "divergence" ? artifactInlineLabel(item, tf) : "",
      visible: true,
      tf,
      color,
      time: fromTimeSec,
      time2: toTimeSec,
      price: fromPrice,
      price2: toPrice,
      anchorTimeMs: fromTimeSec * 1000,
      anchorTimeMs2: toTimeSec * 1000,
      anchorPrice: fromPrice,
      anchorPrice2: toPrice,
      line_style: groupKey === "divergence" ? "dot" : "solid",
      line_width: groupKey === "divergence" ? 1.25 : 1,
      artifact_family: family,
      artifact_type: type,
      artifact_group: groupKey,
      source_tf: tf,
      is_event: groupKey === "divergence",
      event_key: groupKey === "divergence" ? "DIV" : "",
      event_direction:
        groupKey === "divergence"
          ? resolveArtifactEventDirection(item, barsForTf, tf)
          : "",
      artifact_payload: item,
    };
    if (groupKey !== "divergence") return segment;
    const divergenceDirection = resolveArtifactEventDirection(item, barsForTf, tf);
    return [
      segment,
      {
        id: `${String(item.id || `${family}-${type}-${toTimeSec}`)}:point`,
        kind: "point",
        type: "",
        label: "",
        visible: true,
        tf,
        color,
        price: toPrice,
        time: toTimeSec,
        anchorTimeMs: toTimeSec * 1000,
        anchorPrice: toPrice,
        line_style: "dot",
        line_width: 0.1,
        marker_shape: markerShapeForConfirmedDirection(divergenceDirection),
        marker_text: "DIV",
        marker_position: markerPositionForConfirmedDirection(divergenceDirection),
        artifact_family: family,
        artifact_type: `${type}_point`,
        artifact_group: groupKey,
        source_tf: tf,
        is_event: true,
        event_key: "DIV",
        event_direction: divergenceDirection,
        artifact_payload: item,
      },
    ];
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
    const explicitEndTimeSec =
      Number(item?.bar_end ?? item?.end_bar ?? item?.payload?.end_time) || null;
    const tfSeconds = Math.max(1, Number(timeframeToSeconds(tf)) || 60);
    const shouldExtendZoneOneBar = groupKey === "fvg" || groupKey === "ob";
    const zoneExtensionBars = shouldExtendZoneOneBar ? 5 : 0;
    const zoneEndSource = Number.isFinite(explicitEndTimeSec)
      ? "explicit_end_plus_extension"
      : Number.isFinite(timeSec)
        ? "start_plus_extension"
        : "missing_end_time";
    const zoneEndTimeSec =
      Number.isFinite(explicitEndTimeSec)
        ? explicitEndTimeSec + tfSeconds * zoneExtensionBars
        : Number.isFinite(timeSec)
          ? timeSec + tfSeconds * zoneExtensionBars
          : null;
    const zoneObject = {
      id: String(item.id || `${family}-${type}-${timeSec || top}`),
      kind: "zone",
      type: type.toUpperCase() || "ZONE",
      label: artifactInlineLabel(item, tf),
      label_font_size:
        groupKey === "fvg" || groupKey === "ifvg" || groupKey === "bb" || groupKey === "ob"
          ? 8
          : undefined,
      visible: true,
      tf,
      color,
      bg_color:
        groupKey === "fvg" || groupKey === "ifvg" || groupKey === "bb" || groupKey === "ob"
          ? withHexAlpha(color, "05")
          : withHexAlpha(color, "0d"),
      label_bg_color:
        groupKey === "bb"
          ? "rgba(2, 6, 23, 0.94)"
          : undefined,
      label_color:
        groupKey === "bb"
          ? brightenHexColor(color, 0.24)
          : undefined,
      price_top: top,
      price_bottom: bottom,
      time: Number.isFinite(timeSec) ? timeSec : null,
      anchorTimeMs: Number.isFinite(timeSec) ? timeSec * 1000 : null,
      anchorTimeMs2: Number.isFinite(zoneEndTimeSec)
        ? zoneEndTimeSec * 1000
        : null,
      anchorPrice: top,
      anchorPrice2: bottom,
      line_style: groupKey === "ob" ? "solid" : "dot",
      line_width: 0.1,
      artifact_family: family,
      artifact_type: type,
      artifact_group: groupKey,
      source_tf: tf,
      artifact_debug: shouldExtendZoneOneBar
        ? {
            tf,
            groupKey,
            startTimeSec: Number.isFinite(timeSec) ? timeSec : null,
            explicitEndTimeSec: Number.isFinite(explicitEndTimeSec)
              ? explicitEndTimeSec
              : null,
            tfSeconds,
            zoneExtensionBars,
            zoneEndTimeSec: Number.isFinite(zoneEndTimeSec) ? zoneEndTimeSec : null,
            zoneEndSource,
            itemStatus: String(item?.status || "").trim().toLowerCase() || null,
            lifecycleState:
              String(item?.payload?.lifecycle_state || "").trim().toLowerCase() || null,
            eventTimeSec:
              Number.isFinite(Number(item?.event_time)) ? Number(item?.event_time) : null,
            barStart:
              Number.isFinite(Number(item?.bar_start)) ? Number(item?.bar_start) : null,
            barEnd:
              Number.isFinite(Number(item?.bar_end)) ? Number(item?.bar_end) : null,
          }
        : null,
      artifact_payload: item,
    };
    const eventTimeSec = Number(item?.event_time ?? item?.anchor_time ?? item?.bar_end) || null;
    const eventDirection = resolveArtifactEventDirection(item, barsForTf, tf);
    const zoneEventMarkerText = artifactMarkerText(item);
    const eventPrice = resolveZoneEventMarkerPrice(
      item,
      top,
      bottom,
      Number.isFinite(price) ? price : null,
    );
    if (
      item?.is_event &&
      zoneEventMarkerText &&
      Number.isFinite(eventTimeSec) &&
      Number.isFinite(eventPrice)
    ) {
      const eventColor = signalEventColorFromDirection(eventDirection);
      return [
        zoneObject,
        {
          id: `${String(item.id || `${family}-${type}-${eventTimeSec}`)}:event`,
          kind: "point",
          type: type.toUpperCase() || "POINT",
          label: artifactFullLabel({ ...item, artifact_type: `${type}_event`, is_event: true }),
          visible: true,
          tf,
          color: eventColor,
          price: eventPrice,
          time: eventTimeSec,
          anchorTimeMs: eventTimeSec * 1000,
          anchorPrice: eventPrice,
          line_style: "dot",
          line_width: 0.1,
          marker_shape: markerShapeForConfirmedDirection(eventDirection),
          marker_text: zoneEventMarkerText,
          marker_position: markerPositionForConfirmedDirection(eventDirection),
          marker_size: eventMarkerSizeForConfirmedDirection(eventDirection),
          artifact_family: family,
          artifact_type: `${type}_event`,
          artifact_group: groupKey,
          source_tf: tf,
          artifact_payload: item,
          is_event: true,
          event_key: item?.event_key || "",
          event_time: eventTimeSec,
        },
      ];
    }
    return zoneObject;
  }

  if (family === "pattern" || family === "structure") {
    if (!Number.isFinite(price) || !Number.isFinite(timeSec)) return null;
    const direction = resolveArtifactEventDirection(item, barsForTf, tf);
    const isEvent = item?.is_event !== false;
    const pointColor = isEvent ? signalEventColorFromDirection(direction) : color;
    const markerText = artifactMarkerText(item);
    const isStructureSegmentSignal =
      family === "structure" &&
      (type === "bos" ||
        type === "choch" ||
        type === "sweep_high" ||
        type === "sweep_low");
    const structureFromTimeSec = Number(
      item?.payload?.source_swing_time ??
        item?.payload?.swept_swing_time ??
        item?.bar_start,
    );
    const structureFromPrice = Number(
      item?.payload?.source_swing_price ??
        item?.payload?.swept_swing_price ??
        item?.price,
    );
    const basePoint = {
      id: String(item.id || `${family}-${type}-${timeSec}`),
      kind: "point",
      type: type.toUpperCase() || "POINT",
      label: artifactFullLabel(item),
      visible: true,
      tf,
      color: pointColor,
      price,
      time: timeSec,
      anchorTimeMs: timeSec * 1000,
      anchorPrice: price,
      line_style: "dot",
      line_width: 0.1,
      marker_shape:
        isEvent
          ? markerShapeForConfirmedDirection(direction)
          : "circle",
      marker_text: markerText,
      marker_position: markerPositionForConfirmedDirection(direction),
      marker_size: isEvent ? eventMarkerSizeForConfirmedDirection(direction) : 3,
      artifact_family: family,
      artifact_type: type,
      artifact_group: groupKey,
      source_tf: tf,
      artifact_payload: item,
      is_event: isEvent,
      event_key: item?.event_key || "",
      event_time: Number(item?.event_time) || null,
    };
    if (
      isStructureSegmentSignal &&
      Number.isFinite(structureFromTimeSec) &&
      Number.isFinite(structureFromPrice)
    ) {
      return [
        {
          id: `${String(item.id || `${family}-${type}-${timeSec}`)}:segment`,
          kind: "segment",
          type: type.toUpperCase() || "SEGMENT",
          label: artifactFullLabel(item),
          visible: true,
          tf,
          color,
          time: structureFromTimeSec,
          time2: timeSec,
          price: structureFromPrice,
          price2: price,
          anchorTimeMs: structureFromTimeSec * 1000,
          anchorTimeMs2: timeSec * 1000,
          anchorPrice: structureFromPrice,
          anchorPrice2: price,
          line_style: "dot",
          line_width: 1,
          artifact_family: family,
          artifact_type: `${type}_segment`,
          artifact_group: groupKey,
          source_tf: tf,
          artifact_payload: item,
        },
        basePoint,
      ];
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

function artifactEnvelopeToChartObjects(artifacts, fallbackTf = "", barsByTf = null) {
  const items = Array.isArray(artifacts?.items) ? artifacts.items : [];
  return items
    .flatMap((item) => {
      const mapped = artifactItemToChartObject(item, fallbackTf, barsByTf);
      return Array.isArray(mapped) ? mapped : [mapped];
    })
    .filter(Boolean);
}

function analysisSummaryItemPrice(item = {}) {
  const directPrice = Number(item?.price);
  if (Number.isFinite(directPrice)) return directPrice;
  const low = Number(item?.price_low);
  const high = Number(item?.price_high);
  if (Number.isFinite(low) && Number.isFinite(high)) return (low + high) / 2;
  if (Number.isFinite(low)) return low;
  if (Number.isFinite(high)) return high;
  return null;
}

function analysisSummaryItemBounds(item = {}) {
  const low = Number(item?.price_low);
  const high = Number(item?.price_high);
  if (Number.isFinite(low) && Number.isFinite(high)) {
    return {
      low: Math.min(low, high),
      high: Math.max(low, high),
    };
  }
  const price = analysisSummaryItemPrice(item);
  return Number.isFinite(price)
    ? { low: price, high: price }
    : { low: null, high: null };
}

function buildSvgSummaryObjectsFromAnalysisEntry(entry = {}, tf = "") {
  const tfKey = String(tf || entry?.timeframe || "").trim().toLowerCase();
  const bucketConfigs = [
    { key: "supports", groupKey: "support", label: "SUP", color: "#22c55e", kind: "line" },
    { key: "resistances", groupKey: "resistance", label: "RES", color: "#ef4444", kind: "line" },
    { key: "demands", groupKey: "demand", label: "DEM", color: "#14b8a6", kind: "zone" },
    { key: "supplies", groupKey: "supply", label: "SPLY", color: "#f97316", kind: "zone" },
  ];
  return bucketConfigs.flatMap((bucket) => {
    const items = Array.isArray(entry?.[bucket.key]) ? entry[bucket.key] : [];
    return items
      .map((item, index) => {
        const summaryId = String(
          item?.id || item?.source_id || `${tfKey}-${bucket.key}-${index + 1}`,
        ).trim();
        const bounds = analysisSummaryItemBounds(item);
        const price = analysisSummaryItemPrice(item);
        if (bucket.kind === "zone") {
          if (!Number.isFinite(bounds.low) || !Number.isFinite(bounds.high)) return null;
          return {
            id: `svg-summary-zone:${summaryId}`,
            kind: "zone",
            type: bucket.key.toUpperCase(),
            label: bucket.label,
            visible: true,
            tf: tfKey,
            source_tf: tfKey,
            color: bucket.color,
            bg_color: `${bucket.color}12`,
            price_top: bounds.high,
            price_bottom: bounds.low,
            anchorPrice: bounds.high,
            anchorPrice2: bounds.low,
            line_style: "dot",
            line_width: 0.1,
            artifact_family: "analysis_summary",
            artifact_group: bucket.groupKey,
            artifact_type: bucket.groupKey,
            artifact_payload: item,
          };
        }
        if (!Number.isFinite(price)) return null;
        return {
          id: `svg-summary-line:${summaryId}`,
          kind: "line",
          type: bucket.key.toUpperCase(),
          label: bucket.label,
          visible: true,
          tf: tfKey,
          source_tf: tfKey,
          color: bucket.color,
          price,
          anchorPrice: price,
          line_style: "dot",
          line_width: 0.8,
          line_scope: "segment_to_scale",
          artifact_family: "analysis_summary",
          artifact_group: bucket.groupKey,
          artifact_type: bucket.groupKey,
          artifact_payload: item,
        };
      })
      .filter(Boolean);
  });
}

function buildPhaseTargetBoundaryObjects(entry = {}, tf = "") {
  const tfKey = String(tf || entry?.timeframe || "").trim().toLowerCase();
  const low = Number(entry?.phase_target?.low);
  const high = Number(entry?.phase_target?.high);
  const lowStartTime =
    Number(entry?.phase_target?.lower_bound?.startTime ?? entry?.phase_target?.lower_bound?.anchorTime) ||
    null;
  const highStartTime =
    Number(entry?.phase_target?.upper_bound?.startTime ?? entry?.phase_target?.upper_bound?.anchorTime) ||
    null;
  const tfColor = artifactTimeframeColor(tfKey || "1m");
  const objects = [];
  if (Number.isFinite(low)) {
    objects.push({
      id: `phase-target-range-low:${tfKey}:${low}`,
      kind: "line",
      type: "PHASE_TARGET_LOW",
      label: "",
      visible: true,
      tf: tfKey,
      source_tf: tfKey,
      color: tfColor,
      price: low,
      anchorPrice: low,
      anchorTimeMs: lowStartTime,
      line_style: "dot",
      line_width: 1.15,
      line_scope: Number.isFinite(lowStartTime) ? "segment" : "full",
      artifact_family: "analysis_range",
      artifact_group: "phase_target_range",
      artifact_type: "phase_target_low",
      artifact_payload: entry?.phase_target || entry,
    });
  }
  if (Number.isFinite(high) && (!Number.isFinite(low) || Math.abs(high - low) > 1e-9)) {
    objects.push({
      id: `phase-target-range-high:${tfKey}:${high}`,
      kind: "line",
      type: "PHASE_TARGET_HIGH",
      label: "",
      visible: true,
      tf: tfKey,
      source_tf: tfKey,
      color: tfColor,
      price: high,
      anchorPrice: high,
      anchorTimeMs: highStartTime,
      line_style: "dot",
      line_width: 1.15,
      line_scope: Number.isFinite(highStartTime) ? "segment" : "full",
      artifact_family: "analysis_range",
      artifact_group: "phase_target_range",
      artifact_type: "phase_target_high",
      artifact_payload: entry?.phase_target || entry,
    });
  }
  return objects;
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

function artifactObjectReferenceEndTime(item = {}) {
  const timeSec = Number(item?.time2);
  if (Number.isFinite(timeSec)) return timeSec;
  const timeMs = Number(item?.anchorTimeMs2);
  return Number.isFinite(timeMs) ? Math.floor(timeMs / 1000) : null;
}

function projectArtifactObjectForReplay(item = {}, replayTimeSec = null) {
  if (!item || !Number.isFinite(replayTimeSec)) return item;
  const startTimeSec = artifactObjectReferenceTime(item);
  if (Number.isFinite(startTimeSec) && startTimeSec > replayTimeSec) return null;
  const endTimeSec = artifactObjectReferenceEndTime(item);
  if (!Number.isFinite(endTimeSec) || endTimeSec <= replayTimeSec) return item;

  if (String(item?.kind || "").trim().toLowerCase() === "segment") {
    const startPrice = Number(item?.anchorPrice ?? item?.price);
    const endPrice = Number(item?.anchorPrice2 ?? item?.price2);
    if (
      Number.isFinite(startTimeSec) &&
      Number.isFinite(endTimeSec) &&
      Number.isFinite(startPrice) &&
      Number.isFinite(endPrice) &&
      endTimeSec > startTimeSec
    ) {
      const ratio = Math.max(
        0,
        Math.min(1, (replayTimeSec - startTimeSec) / (endTimeSec - startTimeSec)),
      );
      return {
        ...item,
        anchorTimeMs2: replayTimeSec * 1000,
        time2: replayTimeSec,
        anchorPrice2: startPrice + (endPrice - startPrice) * ratio,
        price2: startPrice + (endPrice - startPrice) * ratio,
      };
    }
  }

  return {
    ...item,
    anchorTimeMs2: replayTimeSec * 1000,
    time2: replayTimeSec,
  };
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

function shouldCollapseArtifactHistory(item = {}) {
  const kind = String(item?.kind || "").trim().toLowerCase();
  if (kind !== "line") return false;
  const artifactGroup = String(
    item?.artifact_group || artifactGroupKeyForItem(item) || "",
  )
    .trim()
    .toLowerCase();
  const itemStatus = String(
    item?.artifact_payload?.status || item?.status || "",
  )
    .trim()
    .toLowerCase();
  const lifecycleState = String(
    item?.artifact_payload?.payload?.lifecycle_state ||
      item?.artifact_payload?.lifecycle_state ||
      "",
  )
    .trim()
    .toLowerCase();
  if (
    artifactGroup === "swings" &&
    itemStatus === "active" &&
    lifecycleState === "awaiting_break"
  ) {
    return false;
  }
  const lineScope = String(item?.line_scope || "").trim().toLowerCase();
  return lineScope !== "segment";
}

function isActiveSwingArtifactObject(item = {}) {
  const artifactGroup = String(
    item?.artifact_group || artifactGroupKeyForItem(item) || "",
  )
    .trim()
    .toLowerCase();
  const itemStatus = String(
    item?.artifact_payload?.status || item?.status || "",
  )
    .trim()
    .toLowerCase();
  const lifecycleState = String(
    item?.artifact_payload?.payload?.lifecycle_state ||
      item?.artifact_payload?.lifecycle_state ||
      "",
  )
    .trim()
    .toLowerCase();
  const kind = String(item?.kind || "").trim().toLowerCase();
  return (
    artifactGroup === "swings" &&
    kind === "line" &&
    itemStatus === "active" &&
    lifecycleState === "awaiting_break"
  );
}

function normalizeArtifactEventDirection(item = {}) {
  return resolveArtifactEventDirection(item);
}

function latestArtifactEventTimeSec(item = {}) {
  const eventTime = Number(item?.event_time);
  if (Number.isFinite(eventTime) && eventTime > 0) return eventTime;
  const anchorTime = Number(item?.anchor_time ?? item?.bar_end ?? item?.bar_start ?? item?.time);
  return Number.isFinite(anchorTime) && anchorTime > 0 ? anchorTime : null;
}

function latestArtifactEventPrice(item = {}) {
  const candidates = [
    item?.price,
    item?.anchorPrice,
    item?.anchor_price,
    item?.price_top,
    item?.price_high,
    item?.price_bottom,
    item?.price_low,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function artifactEventDedupeKey(entry = {}, tfKey = "") {
  const marker = String(entry?.markerText || "").trim().toUpperCase();
  const timeBucket = Math.round(Number(entry?.eventTime) || 0);
  const price = Number(entry?.price);
  const priceBucket = Number.isFinite(price) ? Math.round(price * 10000) : "na";
  return `${String(tfKey || "").trim().toLowerCase()}|${marker}|${timeBucket}|${priceBucket}`;
}

function dedupeSignalEventObjects(objects = []) {
  const seen = new Set();
  return (Array.isArray(objects) ? objects : []).filter((item) => {
    if (!isTrueSignalEventItem(item)) return true;
    const tfKey = artifactSourceTfLabel(item?.source_tf || item?.tf || "");
    const key = artifactEventDedupeKey(
      {
        markerText: item?.marker_text || artifactMarkerText(item?.artifact_payload || item),
        eventTime:
          item?.event_time ??
          item?.time ??
          (Number.isFinite(Number(item?.anchorTimeMs))
            ? Number(item.anchorTimeMs) / 1000
            : null),
        price: item?.price ?? item?.anchorPrice ?? item?.anchor_price,
      },
      tfKey,
    );
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildRecentArtifactEventsByTf({
  artifactObjectsByChartId = {},
  artifactItemsByTf = {},
  barsByTf = {},
  artifactTfVisibility = {},
  artifactEventVisibility = {},
  allowedRuleEventKeys = null,
}) {
  const output = {};
  const recentEventEntriesByTf = {};
  for (const [chartId, itemsRaw] of Object.entries(artifactObjectsByChartId || {})) {
    const fallbackTf = String(chartId || "").trim().toLowerCase().split("-").slice(-1)[0];
    const items = Array.isArray(itemsRaw) ? itemsRaw : [];
    for (const item of items) {
      const tfKey = String(item?.source_tf || item?.tf || fallbackTf || "")
        .trim()
        .toLowerCase();
      if (!item || typeof item !== "object" || item?.kind !== "point" || item?.is_event !== true) {
        continue;
      }
      if (item?.visible === false) continue;
      if (!tfKey) continue;
      const itemTfKey = artifactSourceTfLabel(item?.source_tf || item?.tf || tfKey);
      if (itemTfKey && artifactTfVisibility?.[itemTfKey] === false) continue;
      const eventKey = String(item?.marker_text || item?.event_key || "").trim().toUpperCase();
      if (!eventKey) continue;
      if (!allowedRuleEventSetHas(allowedRuleEventKeys, eventKey)) continue;
      const storedVisible = artifactEventVisibility?.[eventKey];
      const fallbackVisible = defaultArtifactEventVisible(item?.artifact_payload || item);
      if (typeof storedVisible === "boolean" ? !storedVisible : !fallbackVisible) continue;
      const eventTime = Number(
        item?.event_time ??
          item?.time ??
          (Number.isFinite(Number(item?.anchorTimeMs)) ? Number(item.anchorTimeMs) / 1000 : null),
      );
      if (!Number.isFinite(eventTime) || eventTime <= 0) continue;
      if (!Array.isArray(recentEventEntriesByTf[tfKey])) recentEventEntriesByTf[tfKey] = [];
      const fullLabel = artifactFullLabel(item?.artifact_payload || item) || eventKey;
      recentEventEntriesByTf[tfKey].push({
        markerText: eventKey,
        fullLabel,
        color: String(item?.color || artifactColorForItem(item?.artifact_payload || item)).trim(),
        direction: normalizeArtifactEventDirection(item?.artifact_payload || item),
        eventTime,
        price: Number(item?.price ?? item?.anchorPrice ?? item?.anchor_price),
        title: `${displayTfLabel(tfKey)} ${fullLabel} at ${new Date(eventTime * 1000).toLocaleString()}`,
      });
    }
  }
  for (const [tfKeyRaw, itemsRaw] of Object.entries(artifactItemsByTf || {})) {
    const tfKey = String(tfKeyRaw || "").trim().toLowerCase();
    if (
      !tfKey
    ) {
      continue;
    }
    const itemTfKey = artifactSourceTfLabel(tfKey);
    if (itemTfKey && artifactTfVisibility?.[itemTfKey] === false) continue;
    const entries = (Array.isArray(itemsRaw) ? itemsRaw : [])
      .filter((item) => isTrueSignalEventItem(item))
      .map((item) => {
        const eventKey = artifactMarkerText(item);
        if (!eventKey) return null;
        if (!allowedRuleEventSetHas(allowedRuleEventKeys, eventKey)) return null;
        const storedVisible = artifactEventVisibility?.[eventKey];
        const fallbackVisible = defaultArtifactEventVisible(item);
        if (typeof storedVisible === "boolean" ? !storedVisible : !fallbackVisible) return null;
        const eventTime = latestArtifactEventTimeSec(item);
        if (!Number.isFinite(eventTime) || eventTime <= 0) return null;
        const fullLabel = artifactFullLabel(item) || eventKey;
        return {
          markerText: eventKey,
          fullLabel,
          color: artifactColorForItem(item),
          direction: normalizeArtifactEventDirection(item),
          eventTime,
          price: latestArtifactEventPrice(item),
          title: `${displayTfLabel(tfKey)} ${fullLabel} at ${new Date(eventTime * 1000).toLocaleString()}`,
        };
      })
      .filter(Boolean);
    if (entries.length) {
      if (!Array.isArray(recentEventEntriesByTf[tfKey])) {
        recentEventEntriesByTf[tfKey] = [];
      }
      recentEventEntriesByTf[tfKey].push(...entries);
    }
  }
  for (const [tfKeyRaw, itemsRaw] of Object.entries(recentEventEntriesByTf || {})) {
    const tfKey = String(tfKeyRaw || "").trim().toLowerCase();
    if (!tfKey) continue;
    const bars = Array.isArray(barsByTf?.[tfKey]) ? barsByTf[tfKey] : [];
    const lastBarTime = Number(bars?.[bars.length - 1]?.time || 0);
    const tfSeconds = Math.max(1, Number(timeframeToSeconds(tfKey)) || 60);
    const recentCutoff = Number.isFinite(lastBarTime) && lastBarTime > 0
      ? lastBarTime - tfSeconds * 1.25
      : null;
    const recentEvents = (Array.isArray(itemsRaw) ? itemsRaw : [])
      .filter((entry) => Number.isFinite(Number(entry?.eventTime)))
      .filter((entry) => recentCutoff == null || Number(entry.eventTime) >= recentCutoff)
      .sort((left, right) => Number(left.eventTime) - Number(right.eventTime))
      .filter((entry, index, entries) => {
        const key = artifactEventDedupeKey(entry, tfKey);
        return entries.findIndex((candidate) => {
          const candidateKey = artifactEventDedupeKey(candidate, tfKey);
          return candidateKey === key;
        }) === index;
      })
      .slice(-5)
      .filter((entry) => entry?.markerText);
    if (!recentEvents.length) continue;
    output[tfKey] = recentEvents;
  }
  return output;
}

function artifactPriceBounds(item = {}) {
  const top = Number(
    item?.price_top ??
      item?.high ??
      item?.priceHigh ??
      item?.artifact_payload?.price_top,
  );
  const bottom = Number(
    item?.price_bottom ??
      item?.low ??
      item?.priceLow ??
      item?.artifact_payload?.price_bottom,
  );
  const price = Number(
    item?.price ??
      item?.level_price ??
      item?.anchorPrice ??
      item?.anchor_price ??
      item?.artifact_payload?.price,
  );
  if (Number.isFinite(top) && Number.isFinite(bottom)) {
    return {
      low: Math.min(top, bottom),
      high: Math.max(top, bottom),
    };
  }
  if (Number.isFinite(price)) {
    return { low: price, high: price };
  }
  return null;
}

function artifactTradeGroupWeight(groupKey = "", side = "BUY", kind = "tp") {
  const key = String(groupKey || "").trim().toLowerCase();
  const upperSide = String(side || "BUY").trim().toUpperCase();
  const stopWeights = upperSide === "BUY"
    ? {
        pdl: 10,
        demand: 9,
        support: 9,
        ob: 9,
        bb: 9,
        fvg: 8,
        ifvg: 8,
        swings: 7,
        liquidity: 6,
        bos: 4,
        choch: 4,
      }
    : {
        pdh: 10,
        supply: 9,
        resistance: 9,
        ob: 9,
        bb: 9,
        fvg: 8,
        ifvg: 8,
        swings: 7,
        liquidity: 6,
        bos: 4,
        choch: 4,
      };
  const targetWeights = upperSide === "BUY"
    ? {
        pdh: 10,
        liquidity: 9,
        bos: 8,
        choch: 8,
        bb: 8,
        ob: 7,
        fvg: 7,
        ifvg: 7,
        swings: 6,
        resistance: 6,
        supply: 6,
      }
    : {
        pdl: 10,
        liquidity: 9,
        bos: 8,
        choch: 8,
        bb: 8,
        ob: 7,
        fvg: 7,
        ifvg: 7,
        swings: 6,
        support: 6,
        demand: 6,
      };
  const table = kind === "sl" ? stopWeights : targetWeights;
  return Number(table[key] || 0);
}

function timeframePriorityWeight(tf = "", activeTf = "") {
  const tfSec = Math.max(1, Number(timeframeToSeconds(tf)) || 60);
  const activeSec = Math.max(1, Number(timeframeToSeconds(activeTf)) || 60);
  const ratio = Math.abs(Math.log(tfSec / activeSec));
  return Math.max(0, 3 - ratio);
}

function resolveSuggestedTradeTimeframes(
  activeTf = "",
  selectedTfs = [],
  artifactItemsByTf = {},
) {
  const normalizedActiveTf = String(activeTf || "").trim().toLowerCase();
  const activeTfSeconds = Math.max(
    1,
    Number(timeframeToSeconds(normalizedActiveTf)) || 0,
  );
  const requestedTfs = Array.isArray(selectedTfs) ? selectedTfs : [];
  const configuredTfs = requestedTfs
    .map((tf) => String(tf || "").trim().toLowerCase())
    .filter(Boolean);
  const fallbackArtifactTfs = Object.keys(
    artifactItemsByTf && typeof artifactItemsByTf === "object" ? artifactItemsByTf : {},
  )
    .map((tf) => String(tf || "").trim().toLowerCase())
    .filter(Boolean);
  const candidateTfs = [
    ...new Set([
      ...configuredTfs,
      ...(normalizedActiveTf ? [normalizedActiveTf] : []),
      ...fallbackArtifactTfs,
    ]),
  ];
  if (!candidateTfs.length) {
    return normalizedActiveTf ? [normalizedActiveTf] : [];
  }
  const scopedTfs = candidateTfs.filter((tf) => {
    const tfSeconds = Math.max(1, Number(timeframeToSeconds(tf)) || 0);
    if (!activeTfSeconds || !tfSeconds) return true;
    return tfSeconds >= activeTfSeconds;
  });
  const sortedScopedTfs = sortTimeframes(
    scopedTfs.length ? scopedTfs : candidateTfs,
    "desc",
  ).map((tf) => String(tf || "").trim().toLowerCase());
  return sortedScopedTfs.length
    ? sortedScopedTfs
    : normalizedActiveTf
      ? [normalizedActiveTf]
      : [];
}

function applyTradeStopBuffer(entry = null, stop = null, side = "BUY") {
  const numericEntry = Number(entry);
  const numericStop = Number(stop);
  if (!Number.isFinite(numericEntry) || !Number.isFinite(numericStop)) {
    return numericStop;
  }
  const upperSide = String(side || "BUY").trim().toUpperCase();
  const rawRisk = Math.abs(numericEntry - numericStop);
  if (!(rawRisk > 0)) return numericStop;
  const buffer = Math.max(Math.abs(numericEntry) * 0.00025, rawRisk * 0.2);
  return upperSide === "BUY" ? numericStop - buffer : numericStop + buffer;
}

function applyTradeTargetTrim({
  entry = null,
  rawTarget = null,
  side = "BUY",
  risk = null,
  minRr = 1.5,
}) {
  const numericEntry = Number(entry);
  const numericTarget = Number(rawTarget);
  const numericRisk = Number(risk);
  if (
    !Number.isFinite(numericEntry) ||
    !Number.isFinite(numericTarget) ||
    !(numericRisk > 0)
  ) {
    return numericTarget;
  }
  const upperSide = String(side || "BUY").trim().toUpperCase();
  const rawReward = Math.abs(numericTarget - numericEntry);
  if (!(rawReward > 0)) return numericTarget;
  const minReward = numericRisk * Math.max(1, Number(minRr) || 1.5);
  const trim = Math.max(Math.abs(numericEntry) * 0.0001, numericRisk * 0.08);
  const trimmedReward = Math.max(minReward, rawReward - trim);
  return upperSide === "BUY"
    ? numericEntry + trimmedReward
    : numericEntry - trimmedReward;
}

function isReasonableArtifactPriceForTradeLevel(candidatePrice = null, entryPrice = null) {
  const candidate = Number(candidatePrice);
  const entry = Number(entryPrice);
  if (!Number.isFinite(candidate) || !(candidate > 0)) return false;
  if (!Number.isFinite(entry) || !(entry > 0)) return true;
  const ratio = candidate / entry;
  if (!Number.isFinite(ratio) || ratio <= 0) return false;
  return ratio >= 0.25 && ratio <= 4;
}

function buildSuggestedTradeLevels({
  side = "BUY",
  entryPrice = null,
  referencePrice = null,
  activeTf = "",
  selectedTfs = [],
  artifactItemsByTf = {},
}) {
  return sharedBuildSuggestedTradeLevels({
    side,
    entryPrice,
    referencePrice,
    activeTf,
    selectedTfs,
    artifactItemsByTf,
  });
}

function toPositiveTradePlanPrice(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function resolveSuggestedTradeLevelsWithFallback({
  suggested = {},
  requestedSide = "BUY",
  clickedEntryPrice = null,
  currentSide = "",
  currentEntryPrice = null,
  currentTpPrice = null,
  currentSlPrice = null,
}) {
  const normalizedSide = String(requestedSide || "BUY").trim().toUpperCase();
  const clickedEntry = toPositiveTradePlanPrice(clickedEntryPrice);
  const currentEntry = toPositiveTradePlanPrice(currentEntryPrice);
  const sanityAnchor = clickedEntry ?? currentEntry;
  const sanitizeLevel = (value) => {
    const numeric = toPositiveTradePlanPrice(value);
    if (numeric == null) return null;
    if (!isReasonableArtifactPriceForTradeLevel(numeric, sanityAnchor)) {
      return null;
    }
    return numeric;
  };
  const suggestedTp = sanitizeLevel(suggested?.tp);
  const suggestedSl = sanitizeLevel(suggested?.sl);
  if (suggestedTp != null || suggestedSl != null) {
    return { tp: suggestedTp, sl: suggestedSl };
  }
  const activeSide = String(currentSide || "").trim().toUpperCase();
  if (
    activeSide !== normalizedSide ||
    clickedEntry == null ||
    currentEntry == null
  ) {
    return { tp: suggestedTp, sl: suggestedSl };
  }
  const proximityThreshold = Math.max(Math.abs(clickedEntry) * 0.00025, 0.01);
  if (Math.abs(clickedEntry - currentEntry) > proximityThreshold) {
    return { tp: suggestedTp, sl: suggestedSl };
  }
  return {
    tp: sanitizeLevel(currentTpPrice),
    sl: sanitizeLevel(currentSlPrice),
  };
}

function resolveTradePlanAnchorTimeSec(plan = {}) {
  const candidates = [
    plan?.start_bar,
    plan?.bar_start,
    plan?.opened_at_unix,
    plan?.openedAtSec,
    plan?.opened_at,
    plan?.time,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = toEpochSec(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function resolveTradePlanEndTimeSec(plan = {}) {
  const candidates = [
    plan?.end_bar,
    plan?.bar_end,
    plan?.closed_at_unix,
    plan?.closedAtSec,
    plan?.closed_at,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = toEpochSec(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function collectDefaultContextTradePlans({
  plansByTf = {},
  selectedTfs = [],
  contextualTf = "",
  contextualTimeSec = 0,
  contextualPrice = null,
  limit = 6,
}) {
  const tfList = Array.isArray(selectedTfs) ? selectedTfs : [];
  const normalizedContextTf = String(contextualTf || "").trim().toLowerCase();
  const normalizedContextTime = Number(contextualTimeSec);
  const normalizedContextPrice = Number(contextualPrice);
  const collected = tfList.flatMap((tfRaw) => {
    const tfKey = String(tfRaw || "").trim().toLowerCase();
    if (!tfKey) return [];
    const plans = Array.isArray(plansByTf?.[tfKey]) ? plansByTf[tfKey] : [];
    return plans
      .map((plan, index) => {
        const entry = toPositiveTradePlanPrice(plan?.entry ?? plan?.entry_price);
        const tp = toPositiveTradePlanPrice(plan?.tp ?? plan?.tp_price);
        const sl = toPositiveTradePlanPrice(plan?.sl ?? plan?.sl_price);
        const direction =
          String(plan?.direction || plan?.side || plan?.action || "")
            .trim()
            .toUpperCase() === "SELL"
            ? "SELL"
            : "BUY";
        if (entry == null || tp == null || sl == null) return null;
        const startSec = resolveTradePlanAnchorTimeSec(plan);
        const endSec = resolveTradePlanEndTimeSec(plan);
        const isActiveAtContext =
          Number.isFinite(normalizedContextTime) && normalizedContextTime > 0
            ? startSec > 0 &&
              startSec <= normalizedContextTime &&
              (!endSec || endSec >= normalizedContextTime)
            : false;
        const timeDistance =
          Number.isFinite(normalizedContextTime) && normalizedContextTime > 0 && startSec > 0
            ? Math.abs(normalizedContextTime - startSec)
            : Number.POSITIVE_INFINITY;
        const entryDistance =
          Number.isFinite(normalizedContextPrice) && normalizedContextPrice > 0
            ? Math.abs(normalizedContextPrice - entry)
            : Number.POSITIVE_INFINITY;
        return {
          ...plan,
          direction,
          entry,
          tp,
          sl,
          _menu_tf: tfKey,
          _menu_index: index,
          _menu_start_sec: startSec,
          _menu_end_sec: endSec,
          _menu_active: isActiveAtContext,
          _menu_time_distance: timeDistance,
          _menu_entry_distance: entryDistance,
          _menu_tf_priority: tfKey === normalizedContextTf ? 0 : 1,
        };
      })
      .filter(Boolean);
  });
  const deduped = [];
  const seen = new Set();
  collected
    .sort((left, right) => {
      if (Boolean(left?._menu_active) !== Boolean(right?._menu_active)) {
        return left?._menu_active ? -1 : 1;
      }
      const tfCompare =
        Number(left?._menu_tf_priority || 0) - Number(right?._menu_tf_priority || 0);
      if (tfCompare !== 0) return tfCompare;
      const timeCompare =
        Number(left?._menu_time_distance || 0) - Number(right?._menu_time_distance || 0);
      if (timeCompare !== 0) return timeCompare;
      const priceCompare =
        Number(left?._menu_entry_distance || 0) - Number(right?._menu_entry_distance || 0);
      if (priceCompare !== 0) return priceCompare;
      return String(left?.strategy_name || left?.strategy || "").localeCompare(
        String(right?.strategy_name || right?.strategy || ""),
      );
    })
    .forEach((plan) => {
      const dedupeKey = [
        String(plan?.strategy_id || plan?.strategy_name || plan?.strategy || "").trim(),
        String(plan?.event_id || plan?.rule_name || plan?.condition || "").trim(),
        String(plan?._menu_tf || "").trim(),
        String(plan?._menu_start_sec || "").trim(),
        String(plan?.direction || "").trim(),
      ].join("|");
      if (!dedupeKey || seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      deduped.push(plan);
  });
  return deduped.slice(0, Math.max(1, Number(limit) || 6));
}

function collectDefaultContextTradePlansFromList({
  plans = [],
  selectedTfs = [],
  contextualTf = "",
  contextualTimeSec = 0,
  contextualPrice = null,
  limit = 6,
}) {
  const groupedPlansByTf = {};
  (Array.isArray(plans) ? plans : []).forEach((plan) => {
    if (!plan || typeof plan !== "object") return;
    const tfKey = String(
      plan?._menu_tf ||
        plan?.timeframe ||
        plan?.tf ||
        plan?.chart_tf ||
        contextualTf ||
        "",
    )
      .trim()
      .toLowerCase();
    if (!tfKey) return;
    if (!Array.isArray(groupedPlansByTf[tfKey])) groupedPlansByTf[tfKey] = [];
    groupedPlansByTf[tfKey].push(plan);
  });
  return collectDefaultContextTradePlans({
    plansByTf: groupedPlansByTf,
    selectedTfs,
    contextualTf,
    contextualTimeSec,
    contextualPrice,
    limit,
  });
}

function limitArtifactObjectsNearLastBar(objects = [], bars = []) {
  const list = Array.isArray(objects) ? objects : [];
  const lastBar = Array.isArray(bars) && bars.length ? bars[bars.length - 1] : null;
  const lastClose = Number(lastBar?.close);
  if (!Number.isFinite(lastClose)) return list;
  const groups = new Map();
  const keepIds = new Set();
  for (const item of list) {
    if (!shouldCollapseArtifactHistory(item)) {
      if (item?.id) keepIds.add(String(item.id));
      continue;
    }
    const key = artifactObjectTypeKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const [groupKey, entries] of groups.entries()) {
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
  tradeCount = 0,
  showSymbolTfBadge = true,
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
  const loadedBars = allLoadedBars.length;
  const renderedBarsCount = headerBars.length;
  const loadedStartSec = Number(allLoadedBars?.[0]?.time);
  const loadedEndSec = Number(allLoadedBars?.[loadedBars - 1]?.time);
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
  const tradeCountLabel =
    Number.isFinite(Number(tradeCount)) && Number(tradeCount) > 0
      ? `${Math.round(Number(tradeCount))}T`
      : "";
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
    renderedBarsCount > 0 ? `${renderedBarsCount} bars currently rendered` : null,
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
    renderedBarsCount > 0 ? `Rendered bars: ${renderedBarsCount}` : null,
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
      {showSymbolTfBadge ? (
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            if (!tvUrl) return;
            window.open(tvUrl, "_blank", "noopener,noreferrer");
          }}
          style={{
            lineHeight: 1.2,
            minHeight: 18,
            padding: "1px 4px",
            minWidth: 24,
            fontSize: 10,
            fontWeight: 800,
            opacity: 0.95,
            cursor: tvUrl ? "pointer" : "default",
            border: "none",
            background: "transparent",
            borderRadius: 0,
            boxShadow: "none",
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
            {tradeCountLabel ? (
              <span
                style={{
                  color: "#94a3b8",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                }}
              >
                {tradeCountLabel}
              </span>
            ) : null}
          </span>
        </button>
      ) : shouldShowStatusBadge ? (
        <StatusDisplay
          status={liveBadge?.status || "neutral"}
          label=""
          size="mini"
          title={liveStatusTooltip || "Live status unavailable"}
          tooltipContent={liveStatusTooltip || "Live status unavailable"}
        />
      ) : null}
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
              className="secondary-button symbol-chart-toolbar-button"
              onClick={() => handleViewportNav(item.action)}
              style={{
                minHeight: 16,
                minWidth: item.iconOnly ? 18 : 16,
                padding: "0 3px",
                lineHeight: 1.1,
                fontSize: 10,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                background: "transparent",
                boxShadow: "none",
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
              className="secondary-button symbol-chart-toolbar-button"
              onClick={() => setShowDataMenu((prev) => !prev)}
              title={cacheLiveBadge?.title || "Toggle timeframe stats"}
              style={{
                lineHeight: 1.2,
                minHeight: 16,
                minWidth: cacheLiveBadge?.label ? 28 : 18,
                padding: cacheLiveBadge?.label ? "0 4px" : "0 3px",
                fontSize: 10,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                border: "none",
                background: "transparent",
                boxShadow: "none",
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
const ENTRY_PLAN_COLOR = "#38bdf8";
const TP_PLAN_COLOR = "#10b981";
const SL_PLAN_COLOR = "#ef4444";

function countTradePriceDecimals(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const normalized = n.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  const idx = normalized.indexOf(".");
  return idx >= 0 ? normalized.length - idx - 1 : 0;
}

function inferTradePricePrecision(values = []) {
  let precision = 0;
  for (const value of Array.isArray(values) ? values : []) {
    precision = Math.max(precision, countTradePriceDecimals(value));
  }
  return Math.min(Math.max(precision, 0), 8);
}

function inferMagnitudeBasedTradePricePrecision(values = []) {
  const finiteValues = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!finiteValues.length) return 2;
  const representative =
    finiteValues.find((value) => countTradePriceDecimals(value) > 0) ??
    finiteValues[0];
  if (representative >= 1) return 2;
  if (representative >= 0.1) return 3;
  if (representative >= 0.01) return 4;
  return 5;
}

function coerceTradePricePrecision(value) {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.round(n), 0), 8);
}

function resolveSymbolTradePricePrecision(symbol = "", values = [], explicitPrecision = null) {
  const direct = coerceTradePricePrecision(explicitPrecision);
  if (direct != null) return direct;
  const sym = String(symbol || "").trim().toUpperCase();
  const base = sym.slice(0, 3);
  const quote = sym.endsWith("USDT") ? "USDT" : sym.slice(-3);
  const inferredPrecision = inferTradePricePrecision(values);
  const forexCurrencies = new Set([
    "USD",
    "EUR",
    "GBP",
    "JPY",
    "AUD",
    "CAD",
    "CHF",
    "NZD",
    "SGD",
    "HKD",
    "CNH",
    "NOK",
    "SEK",
    "DKK",
    "ZAR",
    "TRY",
    "MXN",
    "PLN",
    "CZK",
    "HUF",
  ]);
  if ((quote === "USD" || quote === "USDT") && !forexCurrencies.has(base)) {
    return Math.max(
      2,
      Math.min(inferredPrecision, inferMagnitudeBasedTradePricePrecision(values)),
    );
  }
  if (/^[A-Z]{6}$/.test(sym) && forexCurrencies.has(base) && forexCurrencies.has(quote)) {
    return sym.endsWith("JPY") ? 3 : 5;
  }
  if (sym.startsWith("XAU") || sym.startsWith("XAG")) return 2;
  if (
    sym.startsWith("UK") ||
    sym.startsWith("US") ||
    sym.startsWith("DE") ||
    sym.startsWith("JP") ||
    sym.startsWith("AU")
  ) {
    return 3;
  }
  if (sym.endsWith("USD") || sym.endsWith("USDT")) {
    return Math.max(
      2,
      Math.min(inferredPrecision, inferMagnitudeBasedTradePricePrecision(values)),
    );
  }
  return inferredPrecision;
}

function formatTradePriceByPrecision(value, precision = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "n/a";
  const safePrecision = coerceTradePricePrecision(precision);
  if (safePrecision != null) return numeric.toFixed(safePrecision);
  return Math.abs(numeric) >= 1000 ? numeric.toFixed(2) : numeric.toFixed(5);
}

function resolvePreferredTradePrice(candidates = []) {
  const finiteValues = (Array.isArray(candidates) ? candidates : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!finiteValues.length) return null;
  const decimalValue = finiteValues.find(
    (value) => countTradePriceDecimals(value) > 0,
  );
  return decimalValue ?? finiteValues[0];
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
  timeframes = DEFAULT_SYMBOL_CHART_TFS,
  timeframePresets = EMPTY_ARRAY,
  timeframeOptions = EMPTY_ARRAY,
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
  attachedSnapshotFiles = EMPTY_ARRAY,
  tradeSid = "",
  apiScope = "",
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
  trades = EMPTY_ARRAY,
  backtestTrades = EMPTY_ARRAY,
  onReplayActiveTradeChange = null,
  backtestReplay = null,
  anchorToTradeTime = false,
  autoStartReplay = false,
  externalChartData = null,
  chartStrategies = EMPTY_ARRAY,
  strategyScanMode = "",
  showStrategyMarkersDefault = false,
  onStrategyMarkersChange = null,
  allowedRules = null,
  allowedEvents = null,
  allowed_rules = null,
  allowed_events = null,
  extraRequestedTimeframes = EMPTY_ARRAY,
  liveBars = true,
  bootstrapLiveBarsOnMount = false,
  showSymbolTfBadge = true,
}) {
  const rootRef = useRef(null);
  const gridRef = useRef(null);
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
  const [lastError, setLastError] = useState(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [availableViewportGridHeight, setAvailableViewportGridHeight] =
    useState(0);
  const [viewportAutoFitNonce, setViewportAutoFitNonce] = useState(0);
  const viewportAutoFitKeyRef = useRef("");
  const hasStickyManualViewportRef = useRef(false);
  const lastManualViewportActionRef = useRef({
    at: 0,
    action: "",
    source: "",
  });
  const bootstrapRepairRef = useRef({
    key: "",
    status: "idle",
  });
  const cleanSym = useMemo(() => normSym(symbol), [symbol]);
  const allowedRuleEventKeys = useMemo(
    () => buildAllowedRuleEventSet(allowedRules, allowedEvents, allowed_rules, allowed_events),
    [allowedRules, allowedEvents, allowed_rules, allowed_events],
  );
  const chartSessionTradeSid = useMemo(
    () =>
      String(
        backtestReplay?.enabled
          ? backtestReplay?.startTradeSid || tradeSid || ""
          : tradeSid || "",
      ).trim(),
    [backtestReplay?.enabled, backtestReplay?.startTradeSid, tradeSid],
  );
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
  const [rawArtifactObjectsByChartId, setRawArtifactObjectsByChartId] = useState({});
  const [sharedEngineAnalysisByTf, setSharedEngineAnalysisByTf] = useState({});
  const [sharedArtifactItemsByTf, setSharedArtifactItemsByTf] = useState({});
  const [sharedTradePlansByTf, setSharedTradePlansByTf] = useState({});
  const [artifactGroupVisibility, setArtifactGroupVisibility] = useState({});
  const [artifactTfVisibility, setArtifactTfVisibility] = useState({});
  const [artifactEventVisibility, setArtifactEventVisibility] = useState({});
  const [showStrategyMarkers, setShowStrategyMarkers] = useState(() =>
    Boolean(showStrategyMarkersDefault),
  );
  const [selectedObjectId, setSelectedObjectId] = useState(null);
  const [editObjects, setEditObjects] = useState(false);

  // Load chart objects from trade metadata when trade changes.
  // Important: do not depend on entry/tp/sl props to avoid parent-child setState ping-pong loops.
  useEffect(() => {
    if (!tradeSid) return;
    let cancelled = false;
    api
      .loadChartObjects(tradeSid, { scope: apiScope })
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
              color: ENTRY_PLAN_COLOR,
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
  }, [tradeSid, apiScope]);

  const handleSaveObjects = useCallback(() => {
    if (!tradeSid || !annotations.length) return;
    api.saveChartObjects(tradeSid, annotations, { scope: apiScope }).catch(() => {});
  }, [tradeSid, annotations, apiScope]);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [localReplayPlaying, setLocalReplayPlaying] = useState(false);
  const [localReplaySpeedMs, setLocalReplaySpeedMs] = useState(100);
  const [chartReplayCursorIndex, setChartReplayCursorIndex] = useState(-1);
  const [repairingTfKey, setRepairingTfKey] = useState("");
  const [viewports, setViewports] = useState({});
  const viewportsRef = useRef({});
  const [savedTfVisibleBars, setSavedTfVisibleBars] = useState({});
  const [manualTfVisibleBars, setManualTfVisibleBars] = useState({});
  const [savedTfViewportPrefs, setSavedTfViewportPrefs] = useState({});
  const [ctxMenu, setCtxMenu] = useState(null);
  const [menuStrategyScanState, setMenuStrategyScanState] = useState({
    cacheKey: "",
    status: "idle",
    plans: [],
    visibleCount: 6,
    scannedAt: 0,
  });
  const applyOverlayButtonImportantStyle = useCallback((node) => {
    if (!node) return;
    node.style.setProperty("font-size", "10px", "important");
    node.style.setProperty("font-weight", "400", "important");
    node.style.setProperty("line-height", "1.15", "important");
    node.style.setProperty("padding", "2px 4px", "important");
  }, []);
  const applyOverlayTradeButtonImportantStyle = useCallback((node) => {
    if (!node) return;
    node.style.setProperty("font-size", "10px", "important");
    node.style.setProperty("font-weight", "400", "important");
    node.style.setProperty("line-height", "1.15", "important");
    node.style.setProperty("padding", "2px 4px", "important");
    node.style.setProperty("text-align", "left", "important");
    node.style.setProperty("justify-content", "flex-start", "important");
  }, []);
  const [strategyCalendarEvents, setStrategyCalendarEvents] = useState([]);
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
  const [forceChartBootstrapLoad, setForceChartBootstrapLoad] = useState(false);
  const [hasCompletedLiveBarsBootstrap, setHasCompletedLiveBarsBootstrap] =
    useState(!shouldBootstrapLiveBars);
  const hasAutoExpandedBootstrapViewRef = useRef(false);
  const historyExhaustedNoticeRef = useRef({});
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
    hasStickyManualViewportRef.current = false;
    hasAutoExpandedBootstrapViewRef.current = false;
    missingTfBackfillKeyRef.current = "";
    lastRenderableBarsByChartIdRef.current = {};
    setArtifactLoadStateByTf({});
    setLoadedTfs({});
    setSavedTfVisibleBars({});
    setManualTfVisibleBars({});
    setSavedTfViewportPrefs({});
    setAnnotations([]);
    setArtifactObjectsByChartId({});
    setRawArtifactObjectsByChartId({});
    setSharedEngineAnalysisByTf({});
    setSharedArtifactItemsByTf({});
    setSharedTradePlansByTf({});
    setArtifactGroupVisibility({});
    setSelectedObjectId(null);
    setActivePlanGroup("P1");
    parentDrivenSelectionRef.current = null;
    lastIncomingPlanGroupRef.current = null;
    lastPropagatedPlanGroupRef.current = "";
  }, [cleanSym]);

  useEffect(() => {
    setActivePlanGroup("P1");
    setSelectedObjectId(null);
    parentDrivenSelectionRef.current = null;
    lastIncomingPlanGroupRef.current = null;
    lastPropagatedPlanGroupRef.current = "";
  }, [chartSessionTradeSid]);

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
      const nextArtifactEventVisibility = normalizeArtifactEventVisibility(
        cfg?.artifactEventVisibility,
      );
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
      setArtifactEventVisibility(nextArtifactEventVisibility);
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
  const hasReplayCursor = chartReplayCursorIndex >= 0;
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
          setLocalReplaySpeedMs(Math.max(100, Number(nextSpeedMs) || 100)),
        onToggle: () => setLocalReplayPlaying((prev) => !prev),
        onComplete: () => setLocalReplayPlaying(false),
      };
  const activeMode = pendingMode || mode;
  const isReplayMode = activeMode === REPLAY_MODE || mode === REPLAY_MODE;
  const activeDataMode = activeMode === REPLAY_MODE ? "cache" : activeMode;
  const isCacheLikeMode = mode === "cache" || mode === REPLAY_MODE;
  const canShowChartContextMenu =
    isCacheLikeMode ||
    (isStreamingMode &&
      (typeof onQuickTradeIntent === "function" ||
        typeof onPlanLevelChange === "function"));
  const isTradeAnchoredReplay = hasExternalReplayConfig && replayTrades.length > 0;
  const replayActiveMode = hasExternalReplayConfig ? "cache" : REPLAY_MODE;
  const replayEnabledInChart = Boolean(
    effectiveReplayConfig?.enabled &&
    activeMode === replayActiveMode &&
    (effectiveReplayConfig?.playing || hasReplayCursor) &&
    (isTradeAnchoredReplay || !hasExternalReplayConfig),
  );
  const shouldLoadTradeFocusedData = Boolean(
    tradeSid && (showEventMarkers || anchorToTradeTime || replayEnabledInChart),
  );
  const tradeRunStartTimeSec = useMemo(
    () =>
      showEventMarkers && replayTrades.length > 0
        ? resolveTradeRunStartSec(replayTrades)
        : null,
    [replayTrades, showEventMarkers],
  );
  const tradeRunEndTimeSec = useMemo(
    () =>
      showEventMarkers && replayTrades.length > 0
        ? resolveTradeRunEndSec(replayTrades, Math.floor(Date.now() / 1000))
        : null,
    [replayTrades, showEventMarkers],
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
  const replayBufferedBarsTarget = useMemo(() => {
    if (!hasExternalReplayConfig) return null;
    const analyzedBars = Math.max(0, Number(effectiveReplayConfig?.barsAnalyzed) || 0);
    const tfSeconds = Math.max(1, Number(replayPrimaryTfSeconds) || 60);
    const bufferBars = Math.max(1, Math.ceil(replayBufferSeconds / tfSeconds));
    if (analyzedBars <= 0) return null;
    return analyzedBars + bufferBars;
  }, [
    effectiveReplayConfig?.barsAnalyzed,
    hasExternalReplayConfig,
    replayBufferSeconds,
    replayPrimaryTfSeconds,
  ]);
  const replayManualBarsOverride = useMemo(() => {
    if (!hasExternalReplayConfig) return Number(localBarsCount) || 0;
    const localBars = Number(localBarsCount) || 0;
    return localBars > SYMBOL_CHART_MIN_LOADED_BARS ? localBars : 0;
  }, [hasExternalReplayConfig, localBarsCount]);
  const effectiveBarsCount =
    replayEnabledInChart && hasExternalReplayConfig
      ? Math.max(
          Number(replayBufferedBarsTarget) || 0,
          Number(replayRequestedBarsCount) || 0,
          replayManualBarsOverride,
        )
      : replayEnabledInChart && Number.isFinite(Number(replayRequestedBarsCount))
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
      hasExternalReplayConfig && replayEnabledInChart
        ? 0
        : SYMBOL_CHART_MIN_LOADED_BARS,
      Number(effectiveBarsCount) || 0,
    );
    for (const tfKey of requestedDataTimeframes) {
      next[tfKey] = Math.max(Number(next?.[tfKey]) || 0, fallbackBars);
    }
    return Object.keys(next).length ? next : null;
  }, [
    effectiveBarsCount,
    effectiveBarsCountByTf,
    hasExternalReplayConfig,
    replayEnabledInChart,
    requestedDataTimeframes,
  ]);

  const replayFrozenChartDataRef = useRef(null);
  const frozenLiveBarsChartDataRef = useRef(null);
  const lastChartDataWithBarsRef = useRef(null);
  const [replaySeedCaptured, setReplaySeedCaptured] = useState(false);
  const isGenericChartReplay = isReplayMode && !hasExternalReplayConfig;
  const replayDisablesLive = isReplayMode || replayEnabledInChart;
  const effectiveLiveBarsEnabled =
    (liveBarsEnabled || forceChartBootstrapLoad) && !replayDisablesLive;
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
  const missingTfBackfillKeyRef = useRef("");

  const sortedTfs = useMemo(
    () => sortTimeframes(timeframes, "desc"),
    [timeframes],
  );
  const defaultActiveTf = useMemo(() => {
    const configuredTfs = Array.isArray(timeframes)
      ? timeframes
          .map((tf) => String(tf || "").trim().toLowerCase())
          .filter(Boolean)
      : [];
    const orderedTfs = configuredTfs.length
      ? sortTimeframes(configuredTfs, "desc")
      : sortTimeframes(sortedTfs, "desc");
    return orderedTfs.find((tf) => tf === "d" || tf === "1d") || orderedTfs[0] || "";
  }, [sortedTfs, timeframes]);
  useEffect(() => {
    if (!cleanSym || !defaultActiveTf) {
      if (activeChartId !== null) setActiveChartId(null);
      return;
    }
    const nextChartId = `${cleanSym}-${defaultActiveTf}`;
    const activeTf = String(activeChartId || "")
      .split("-")
      .slice(-1)[0]
      .trim()
      .toLowerCase();
    const hasActiveTf =
      activeTf &&
      (Array.isArray(sortedTfs) ? sortedTfs : []).some(
        (tf) => String(tf || "").trim().toLowerCase() === activeTf,
      );
    if (!hasActiveTf && activeChartId !== nextChartId) {
      setActiveChartId(nextChartId);
    }
  }, [activeChartId, cleanSym, defaultActiveTf, sortedTfs]);
  const multiTfAnalysisByTf = useMemo(() => {
    if (replayDisablesLive) return {};
    const streamedAnalysis =
      master?.analysis && typeof master.analysis === "object" && !Array.isArray(master.analysis)
        ? master.analysis
        : null;
    return buildClientChartMultiTfAnalysis(master?.bars, streamedAnalysis);
  }, [master?.analysis, master?.bars, replayDisablesLive]);
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
  const requestedTfKeys = useMemo(
    () =>
      (Array.isArray(requestedSortedTfs) ? requestedSortedTfs : [])
        .map((tf) => String(tf || "").trim().toLowerCase())
        .filter(Boolean),
    [requestedSortedTfs],
  );
  const hasAllRequestedBars = useMemo(() => {
    if (!requestedTfKeys.length) return false;
    return requestedTfKeys.every((tf) => {
      const bars = Array.isArray(getTimeframeValue(master?.bars, tf))
        ? getTimeframeValue(master?.bars, tf)
        : [];
      return bars.length > 0;
    });
  }, [master?.bars, requestedTfKeys]);
  const hasAllRequestedSnapshots = useMemo(() => {
    if (!requestedTfKeys.length) return false;
    return requestedTfKeys.every((tf) => Boolean(getTimeframeValue(master?.snapshots, tf)));
  }, [master?.snapshots, requestedTfKeys]);
  const missingRequestedTfKeys = useMemo(
    () =>
      requestedTfKeys.filter((tf) => {
        const hasBars = Array.isArray(getTimeframeValue(master?.bars, tf))
          ? getTimeframeValue(master?.bars, tf).length > 0
          : false;
        const hasSnapshot = Boolean(getTimeframeValue(master?.snapshots, tf));
        return !hasBars && !hasSnapshot;
      }),
    [master?.bars, master?.snapshots, requestedTfKeys],
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
    if (!forceChartBootstrapLoad) return;
    if (hasVisibleBars && (status === "READY" || status === "STALE")) {
      setForceChartBootstrapLoad(false);
      return;
    }
    if (status === "ERROR") {
      setForceChartBootstrapLoad(false);
    }
  }, [forceChartBootstrapLoad, hasVisibleBars, status]);
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
      } else if (Object.prototype.hasOwnProperty.call(nextCache, chartId)) {
        delete nextCache[chartId];
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
  const primaryReplayTf = useMemo(
    () => String(primaryReplayBaseTf || "").trim().toLowerCase(),
    [primaryReplayBaseTf],
  );
  const primaryReplayBars = useMemo(() => {
    if (!primaryReplayTf) return [];
    return Array.isArray(getTimeframeValue(master?.bars, primaryReplayTf))
      ? getTimeframeValue(master?.bars, primaryReplayTf)
      : [];
  }, [master, primaryReplayTf]);
  const effectiveReplayStartTimeSec = useMemo(() => {
    if (
      requestedReplayStartTimeSec != null &&
      Number.isFinite(Number(requestedReplayStartTimeSec))
    ) {
      return Number(requestedReplayStartTimeSec);
    }
    const firstTime = Number(primaryReplayBars?.[0]?.time || 0);
    return Number.isFinite(firstTime) && firstTime > 0 ? firstTime : null;
  }, [primaryReplayBars, requestedReplayStartTimeSec]);
  const effectiveReplayEndTimeSec = useMemo(() => {
    if (
      requestedReplayEndTimeSec != null &&
      Number.isFinite(Number(requestedReplayEndTimeSec))
    ) {
      return Number(requestedReplayEndTimeSec);
    }
    const lastTime = Number(primaryReplayBars?.[primaryReplayBars.length - 1]?.time || 0);
    if (!Number.isFinite(lastTime) || lastTime <= 0) return null;
    return lastTime + Math.max(1, Number(replayPrimaryTfSeconds) || 1) - 1;
  }, [primaryReplayBars, replayPrimaryTfSeconds, requestedReplayEndTimeSec]);
  const isBacktestChartReplay = replayEnabledInChart;
  const effectiveStrategyScanMode = useMemo(() => {
    const normalized = String(strategyScanMode || "").trim().toLowerCase();
    if (normalized === "backtest" || normalized === "live") return normalized;
    return isBacktestChartReplay ? "backtest" : "live";
  }, [isBacktestChartReplay, strategyScanMode]);
  const effectiveMultiTfAnalysisByTf = useMemo(() => {
    if (isBacktestChartReplay) {
      return sharedEngineAnalysisByTf &&
        typeof sharedEngineAnalysisByTf === "object" &&
        !Array.isArray(sharedEngineAnalysisByTf)
        ? sharedEngineAnalysisByTf
        : {};
    }
    return multiTfAnalysisByTf &&
      typeof multiTfAnalysisByTf === "object" &&
      !Array.isArray(multiTfAnalysisByTf)
      ? multiTfAnalysisByTf
      : {};
  }, [isBacktestChartReplay, multiTfAnalysisByTf, sharedEngineAnalysisByTf]);
  const analysisOrderedTfs = useMemo(() => {
    const analysisKeys = Object.keys(
      effectiveMultiTfAnalysisByTf &&
        typeof effectiveMultiTfAnalysisByTf === "object" &&
        !Array.isArray(effectiveMultiTfAnalysisByTf)
        ? effectiveMultiTfAnalysisByTf
        : {},
    );
    if (analysisKeys.length) return sortTimeframes(analysisKeys, "desc");
    return sortedTfs;
  }, [effectiveMultiTfAnalysisByTf, sortedTfs]);
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

  const handleStopReplay = useCallback(() => {
    if (hasExternalReplayConfig) {
      if (effectiveReplayConfig?.playing) {
        effectiveReplayConfig?.onToggle?.();
      }
    } else {
      setLocalReplayPlaying(false);
    }
    setChartReplayCursorIndex(-1);
    setPendingMode(null);
    setLastError(null);
    setMode("cache");
  }, [effectiveReplayConfig, hasExternalReplayConfig]);

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
  }, [effectiveReplayConfig?.runKey, effectiveReplayConfig?.startTradeSid]);

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

  useEffect(() => {
    if (!isBacktestChartReplay) return;
    if (!effectiveReplayConfig?.playing) return;
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
    effectiveReplayConfig?.playing,
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
  const effectiveReplayBarsClockTimeSec = useMemo(() => {
    if (!isBacktestChartReplay) return null;
    if (Number.isFinite(Number(replayClockTimeSec))) {
      return Number(replayClockTimeSec);
    }
    if (Number.isFinite(Number(effectiveReplayStartTimeSec))) {
      return Number(effectiveReplayStartTimeSec);
    }
    return null;
  }, [effectiveReplayStartTimeSec, isBacktestChartReplay, replayClockTimeSec]);
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
  const replayCompletedBarsText = useMemo(() => {
    if (!replayBarProgressText) return "";
    return replayBarProgressText.replace(/\s+bars$/i, "");
  }, [replayBarProgressText]);
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
    effectiveOverlayTrade?.closeStatus || closeStatus || "",
  );
  const effectiveExitPrice = effectiveOverlayTrade?.exitPrice ?? exitPrice;
  const effectivePnlRealized =
    effectiveOverlayTrade?.pnlRealized ?? pnlRealized;
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
  const replayBarsByTf = useMemo(() => {
    if (!isBacktestChartReplay || !master?.bars) return {};
    if (!Number.isFinite(effectiveReplayBarsClockTimeSec)) return {};
    const output = {};
    (sortedTfs || []).forEach((tfRaw) => {
      const tf = String(tfRaw || "").trim().toLowerCase();
      const barsForTf = Array.isArray(getTimeframeValue(master?.bars, tf))
        ? getTimeframeValue(master?.bars, tf)
        : [];
      if (!barsForTf.length || !Number.isFinite(effectiveReplayBarsClockTimeSec)) return;
      const replayBars = buildReplayBarsForTf({
        bars: barsForTf,
        baseBars: primaryReplayBars,
        tf,
        replayClockTimeSec: effectiveReplayBarsClockTimeSec,
        replayStartTimeSec: effectiveReplayStartTimeSec,
        maxBars: BACKTEST_REPLAY_MAX_BARS,
      });
      if (!Array.isArray(replayBars) || replayBars.length < 1) return;
      output[tf] = replayBars;
    });
    return output;
  }, [
    effectiveReplayBarsClockTimeSec,
    effectiveReplayStartTimeSec,
    isBacktestChartReplay,
    master?.bars,
    primaryReplayBars,
    sortedTfs,
  ]);
  const recentArtifactEventsByTf = useMemo(
    () =>
      buildRecentArtifactEventsByTf({
        artifactObjectsByChartId: rawArtifactObjectsByChartId,
        artifactItemsByTf: sharedArtifactItemsByTf,
        barsByTf: isBacktestChartReplay ? replayBarsByTf : master?.bars,
        artifactTfVisibility,
        artifactEventVisibility,
        allowedRuleEventKeys,
      }),
    [
      rawArtifactObjectsByChartId,
      sharedArtifactItemsByTf,
      isBacktestChartReplay,
      replayBarsByTf,
      master?.bars,
      artifactTfVisibility,
      artifactEventVisibility,
      allowedRuleEventKeys,
    ],
  );
  const clientStrategyTradePlansByTf = useMemo(() => {
    const normalizedStrategies = (Array.isArray(chartStrategies) ? chartStrategies : [])
      .filter(Boolean);
    const barsByTfSource = isBacktestChartReplay ? replayBarsByTf : master?.bars;
    if (!normalizedStrategies.length || !barsByTfSource) return {};
    const output = {};
    Object.entries(barsByTfSource || {}).forEach(([tfKey, barsRaw]) => {
      const bars = Array.isArray(barsRaw) ? barsRaw : [];
      if (bars.length < 2) return;
      const evaluation = evaluateChartStrategies({
        bars,
        strategies: normalizedStrategies,
        lookbackBars: bars.length,
        symbol: cleanSym,
        tf: tfKey,
        multiTfBars: barsByTfSource,
        scanMode: effectiveStrategyScanMode,
        newsEvents: strategyCalendarEvents,
      });
      const plans = Array.isArray(evaluation?.latestTradePlans)
        ? evaluation.latestTradePlans
        : Array.isArray(evaluation?.tradePlans)
          ? evaluation.tradePlans
          : [];
      if (!plans.length) return;
      output[String(tfKey || "").trim().toLowerCase()] = plans;
    });
    return output;
  }, [
    chartStrategies,
    cleanSym,
      effectiveStrategyScanMode,
      isBacktestChartReplay,
    master?.bars,
    replayBarsByTf,
    strategyCalendarEvents,
  ]);
  const effectiveBarsByTfForPlans = useMemo(
    () => (isBacktestChartReplay ? replayBarsByTf : master?.bars || {}),
    [isBacktestChartReplay, master?.bars, replayBarsByTf],
  );
  const effectiveTradePlansByTf = useMemo(() => {
    const output = {};
    const tfKeys = [
      ...new Set([
        ...Object.keys(sharedTradePlansByTf || {}),
        ...Object.keys(clientStrategyTradePlansByTf || {}),
        ...Object.keys(effectiveBarsByTfForPlans || {}),
      ]),
    ];
    tfKeys.forEach((tfKeyRaw) => {
      const tfKey = String(tfKeyRaw || "").trim().toLowerCase();
      if (!tfKey) return;
      const bars = Array.isArray(effectiveBarsByTfForPlans?.[tfKey])
        ? effectiveBarsByTfForPlans[tfKey]
        : [];
      const merged = mergeHybridTradePlansForTf({
        timeframe: tfKey,
        bars,
        serverPlans: Array.isArray(sharedTradePlansByTf?.[tfKey])
          ? sharedTradePlansByTf[tfKey]
          : [],
        clientPlans: Array.isArray(clientStrategyTradePlansByTf?.[tfKey])
          ? clientStrategyTradePlansByTf[tfKey]
          : [],
        serverCoverage:
          master?.serverCoverageByTf?.[tfKey] &&
          typeof master.serverCoverageByTf[tfKey] === "object"
            ? master.serverCoverageByTf[tfKey]
            : null,
      });
      if (Array.isArray(merged?.plans) && merged.plans.length) {
        output[tfKey] = merged.plans;
      }
    });
    return output;
  }, [
    clientStrategyTradePlansByTf,
    effectiveBarsByTfForPlans,
    master?.serverCoverageByTf,
    sharedTradePlansByTf,
  ]);
  const flattenedEffectiveTradePlans = useMemo(
    () =>
      Object.values(effectiveTradePlansByTf || {})
        .flatMap((plans) => (Array.isArray(plans) ? plans : []))
        .sort(
          (left, right) =>
            Number(left?.start_bar || left?.bar_start || 0) -
            Number(right?.start_bar || right?.bar_start || 0),
        ),
    [effectiveTradePlansByTf],
  );
  const effectiveAnalysisSnapshot = useMemo(() => {
    const source =
      analysisSnapshot && typeof analysisSnapshot === "object" && !Array.isArray(analysisSnapshot)
        ? analysisSnapshot
        : {};
    const nextTradePlans = flattenedEffectiveTradePlans.length
      ? flattenedEffectiveTradePlans
      : Array.isArray(source?.trade_plan)
        ? source.trade_plan
        : Array.isArray(source?.trade_plans)
          ? source.trade_plans
          : [];
    return {
      ...source,
      trade_plan: nextTradePlans,
      trade_plans: nextTradePlans,
      tradePlans: nextTradePlans,
      market_analysis:
        source?.market_analysis &&
        typeof source.market_analysis === "object" &&
        !Array.isArray(source.market_analysis)
          ? source.market_analysis
          : {},
    };
  }, [analysisSnapshot, flattenedEffectiveTradePlans]);
  const effectiveHasTradePlan = Boolean(
    (Array.isArray(effectiveAnalysisSnapshot?.trade_plan) &&
      effectiveAnalysisSnapshot.trade_plan.length > 0) ||
      flattenedEffectiveTradePlans.length > 0 ||
      hasTradePlan,
  );
  const effectiveHasAnalysis = Boolean(
    hasAnalysis ||
      Object.keys(effectiveMultiTfAnalysisByTf || {}).length > 0 ||
      Object.keys(artifactObjectsByChartId || {}).length > 0,
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
    if (hasAllRequestedBars || hasAllRequestedSnapshots || status === "LOADING") return;
    const loadKey = [
      cleanSym,
      mode,
      chartSessionTradeSid,
      timeframes.join(","),
      localBarsCount,
      missingRequestedTfKeys.join(","),
    ].join("|");
    if (autoLoadKeyRef.current === loadKey) return;
    autoLoadKeyRef.current = loadKey;
    refresh().catch(() => {});
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
    chartSessionTradeSid,
    timeframes,
    localBarsCount,
    isCacheLikeMode,
    refresh,
    hasAllRequestedBars,
    hasAllRequestedSnapshots,
    missingRequestedTfKeys,
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
      chartSessionTradeSid,
      timeframes.join(","),
      localBarsCount,
    ].join("|");
    if (autoHydrateCacheKeyRef.current === cacheKey) return;
    autoHydrateCacheKeyRef.current = cacheKey;
    refresh().catch(() => {});
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
    chartSessionTradeSid,
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
      chartSessionTradeSid,
      timeframes.join(","),
      localBarsCount,
    ].join("|");
    if (backgroundRefreshKeyRef.current === refreshKey) return;
    backgroundRefreshKeyRef.current = refreshKey;
    refresh().catch(() => {});
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
    chartSessionTradeSid,
    timeframes,
    localBarsCount,
    refresh,
    hasVisibleBars,
  ]);

  useEffect(() => {
    if (
      (isReplayMode && canFreezeReplayChartData) ||
      !autoLoadOnMount ||
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
    if (!hasVisibleBars || !missingRequestedTfKeys.length) return;
    const backfillKey = [
      cleanSym,
      mode,
      chartSessionTradeSid,
      localBarsCount,
      missingRequestedTfKeys.join(","),
    ].join("|");
    if (missingTfBackfillKeyRef.current === backfillKey) return;
    missingTfBackfillKeyRef.current = backfillKey;
    Promise.all(
      missingRequestedTfKeys.map((tf) =>
        refreshTf?.(tf, { force: true }).catch(() => null),
      ),
    ).catch(() => {});
  }, [
    autoLoadOnMount,
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
    hasVisibleBars,
    missingRequestedTfKeys,
    chartSessionTradeSid,
    localBarsCount,
    refreshTf,
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
    if (hasStickyManualViewportRef.current) return;
    if (hasAutoExpandedBootstrapViewRef.current) return;
    if (!areAllRenderedChartsLoaded) return;
    if (!areBootstrapArtifactsLoaded) return;
    const manualViewportAge = Date.now() - Number(lastManualViewportActionRef.current.at || 0);
    if (manualViewportAge >= 0 && manualViewportAge < MANUAL_VIEWPORT_SUPPRESS_MS) return;
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
    if (isBacktestChartReplay || isReplayMode) return;
    if (!(status === "READY" || status === "STALE")) return;
    if (!hasAnyBars) return;
    if (!areAllRenderedChartsLoaded) return;
    if (hasStickyManualViewportRef.current) return;
    const manualViewportAge = Date.now() - Number(lastManualViewportActionRef.current.at || 0);
    if (manualViewportAge >= 0 && manualViewportAge < MANUAL_VIEWPORT_SUPPRESS_MS) return;
    const barsSignature = sortedTfs
      .map((tf) => {
        const key = String(tf || "").trim().toLowerCase();
        const bars = Array.isArray(master?.bars?.[key]) ? master.bars[key] : [];
        return `${key}:${bars.length}:${bars[bars.length - 1]?.time || 0}`;
      })
      .join("|");
    const fixKey = [
      cleanSym,
      chartSessionTradeSid || "",
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
    chartSessionTradeSid,
    areAllRenderedChartsLoaded,
    hasAnyBars,
    master,
    mode,
    isCacheLikeMode,
    isBacktestChartReplay,
    isReplayMode,
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
    if (!(effectiveHasTradePlan && effectiveHasAnalysis)) return;
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
    effectiveHasTradePlan,
    effectiveHasAnalysis,
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
    const plans = Array.isArray(effectiveAnalysisSnapshot?.trade_plan)
      ? effectiveAnalysisSnapshot.trade_plan
      : effectiveAnalysisSnapshot?.trade_plan &&
          typeof effectiveAnalysisSnapshot.trade_plan === "object"
        ? [effectiveAnalysisSnapshot.trade_plan]
        : [];
    return plans
      .map((p) => [p?.entry, p?.tp, p?.sl, p?.direction].join("|"))
      .join("::");
  }, [effectiveAnalysisSnapshot?.trade_plan]);

  useEffect(() => {
    if (!(effectiveHasTradePlan && effectiveHasAnalysis)) return;
    const rawPlans = Array.isArray(effectiveAnalysisSnapshot?.trade_plan)
      ? effectiveAnalysisSnapshot.trade_plan
      : effectiveAnalysisSnapshot?.trade_plan &&
          typeof effectiveAnalysisSnapshot.trade_plan === "object"
        ? [effectiveAnalysisSnapshot.trade_plan]
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
          color: ENTRY_PLAN_COLOR,
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
  }, [effectiveAnalysisSnapshot, effectiveHasAnalysis, effectiveHasTradePlan, tradePlanKey]);
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
    refresh().catch(() => {});
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

  const showControls = !(effectiveHasTradePlan && effectiveHasAnalysis);
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
    effectiveHasTradePlan &&
      effectiveHasAnalysis &&
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
    return String(defaultActiveTf || "d").trim();
  }, [activeChartId, defaultActiveTf]);
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
  const replayArtifactLoadKeyRef = useRef("");
  const artifactEngineStateRef = useRef(createClientReplayArtifactEngineState());
  const applySharedArtifactEngine = useCallback(
    (
      barsByTf = {},
      {
        requestedTimeframes = null,
        forceFull = false,
      } = {},
    ) => {
      if (!cleanSym) return { envelopesByTf: {}, analysisByTf: {} };
      const requestedTfs = Array.isArray(requestedTimeframes)
        ? requestedTimeframes
            .map((tf) => String(tf || "").trim().toLowerCase())
            .filter(Boolean)
        : Object.keys(
            barsByTf && typeof barsByTf === "object" && !Array.isArray(barsByTf)
              ? barsByTf
              : {},
          );
      if (!requestedTfs.length) return { envelopesByTf: {}, analysisByTf: {} };
      const fallbackAnalysis =
        master?.analysis && typeof master.analysis === "object" && !Array.isArray(master.analysis)
          ? master.analysis
          : null;
      const previousState = forceFull
        ? createClientReplayArtifactEngineState()
        : artifactEngineStateRef.current;
      const { state: nextState, envelopesByTf, analysisByTf } =
        updateClientReplayArtifactEngineState(previousState, barsByTf, {
          requestedTimeframes: requestedTfs,
          fallbackAnalysis,
          fallbackWhenNull: true,
          allowIncremental: !forceFull,
        });
      artifactEngineStateRef.current = nextState;
      const nextObjectsByChartId = {};
      const nextRawObjectsByChartId = {};
      const nextLoadStateByTf = {};
      const nextArtifactItemsByTf = {};
      const nextTradePlansByTf = {};
      requestedTfs.forEach((tfKey) => {
        const bars = Array.isArray(barsByTf?.[tfKey]) ? barsByTf[tfKey] : [];
        if (!bars.length) return;
        const envelope = envelopesByTf?.[tfKey];
        const serverArtifacts = Array.isArray(master?.serverArtifactsByTf?.[tfKey])
          ? master.serverArtifactsByTf[tfKey]
          : [];
        const serverTradePlans = Array.isArray(master?.serverTradePlansByTf?.[tfKey])
          ? master.serverTradePlansByTf[tfKey]
          : [];
        const serverCoverage =
          master?.serverCoverageByTf?.[tfKey] &&
          typeof master.serverCoverageByTf[tfKey] === "object"
            ? master.serverCoverageByTf[tfKey]
            : null;
        const hybridArtifacts = mergeHybridArtifactItemsForTf({
          timeframe: tfKey,
          bars,
          serverItems: serverArtifacts,
          clientItems: Array.isArray(envelope?.items) ? envelope.items : [],
          serverCoverage,
        });
        const mergedEnvelope = {
          ...(envelope || {}),
          items: Array.isArray(hybridArtifacts?.items) ? hybridArtifacts.items : [],
          coverage: hybridArtifacts?.coverage || serverCoverage || null,
          meta: {
            ...(envelope?.meta || {}),
            ...(hybridArtifacts?.meta || {}),
            hybrid_source: serverArtifacts.length ? "server+client" : "client",
          },
        };
        const chartId = `${cleanSym}-${tfKey}`;
        const rawObjects = artifactEnvelopeToChartObjects(mergedEnvelope, tfKey, barsByTf);
        const nextObjects = limitArtifactObjectsNearLastBar(rawObjects, bars);
        const nextRawObjects = rawObjects;
        nextArtifactItemsByTf[tfKey] = Array.isArray(mergedEnvelope.items)
          ? mergedEnvelope.items
          : [];
        nextTradePlansByTf[tfKey] = normalizeHybridTradePlans(
          serverTradePlans,
          tfKey,
          serverCoverage,
        );
        nextObjectsByChartId[chartId] = nextObjects;
        nextRawObjectsByChartId[chartId] = nextRawObjects;
        nextLoadStateByTf[tfKey] = {
          requestKey: [
            cleanSym,
            tfKey,
            Number(bars.length) || 0,
            Number(bars?.[0]?.time) || 0,
            Number(bars?.[bars.length - 1]?.time) || 0,
            forceFull ? "full" : "incremental",
          ].join("|"),
          itemCount: nextObjects.length,
          loadedAt: Date.now(),
          updateStrategy: String(nextState?.byTf?.[tfKey]?.strategy || (forceFull ? "full" : "incremental")),
        };
      });
      setSharedEngineAnalysisByTf(
        analysisByTf &&
          typeof analysisByTf === "object" &&
          !Array.isArray(analysisByTf)
          ? analysisByTf
          : {},
      );
      setSharedArtifactItemsByTf((prev) => ({
        ...(prev || {}),
        ...nextArtifactItemsByTf,
      }));
      setSharedTradePlansByTf((prev) => ({
        ...(prev || {}),
        ...nextTradePlansByTf,
      }));
      setArtifactObjectsByChartId((prev) => {
        const next = { ...(prev || {}) };
        for (const [chartId, items] of Object.entries(nextObjectsByChartId)) {
          next[chartId] = items;
        }
        return next;
      });
      setRawArtifactObjectsByChartId((prev) => {
        const next = { ...(prev || {}) };
        for (const [chartId, items] of Object.entries(nextRawObjectsByChartId)) {
          next[chartId] = items;
        }
        return next;
      });
      setArtifactLoadStateByTf((prev) => ({
        ...(prev || {}),
        ...nextLoadStateByTf,
      }));
      return { envelopesByTf, analysisByTf };
    },
    [
      cleanSym,
      master?.analysis,
      master?.serverArtifactsByTf,
      master?.serverCoverageByTf,
      master?.serverTradePlansByTf,
    ],
  );
  const loadArtifactsForTf = useCallback(
    async (tf, { force = false, scope = "visible", replaceExisting = false } = {}) => {
      const tfKey = String(tf || "").trim().toLowerCase();
      if (!tfKey || !cleanSym) return null;
      const bars = Array.isArray(master?.bars?.[tfKey]) ? master.bars[tfKey] : [];
      if (!bars.length) return null;
      const response = applySharedArtifactEngine(
        {
          [tfKey]: bars,
        },
        {
          requestedTimeframes: [tfKey],
          forceFull: force || replaceExisting || scope === "loaded",
        },
      );
      return {
        ok: true,
        symbol: cleanSym,
        timeframe: tfKey,
        start_time: Number(bars?.[0]?.time) || null,
        end_time: Number(bars?.[bars.length - 1]?.time) || null,
        artifacts:
          response?.envelopesByTf?.[tfKey] ||
          buildClientChartArtifactEnvelope(bars, tfKey, {
            replaceExisting,
          }),
      };
    },
    [applySharedArtifactEngine, cleanSym, master?.bars],
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
      hasStickyManualViewportRef.current = true;
      lastManualViewportActionRef.current = {
        at: Date.now(),
        action: String(action || "").trim(),
        source: `single-tf:${tfKey}`,
      };
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
    [cleanSym, handleLoadMoreTf, handleRefreshTf, liveBarsEnabled, master?.bars, mode, viewports],
  );

  const applyPostLoadRecenter = useCallback((targetTfs = []) => {
    const tfKeys = (Array.isArray(targetTfs) ? targetTfs : [])
      .map((tf) => String(tf || "").trim().toLowerCase())
      .filter(Boolean);
    if (!cleanSym || !tfKeys.length) return;
    if (hasStickyManualViewportRef.current) return;
    const manualViewportAge = Date.now() - Number(lastManualViewportActionRef.current.at || 0);
    if (manualViewportAge >= 0 && manualViewportAge < MANUAL_VIEWPORT_SUPPRESS_MS) return;
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
  }, [cleanSym, liveBarsEnabled, mode]);

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

  const handleViewportActionAllTimeframes = useCallback(
    (action) => {
      const targetTfs = (expectedLoadedTfKeys.length ? expectedLoadedTfKeys : sortedTfs || [])
        .map((tf) => String(tf || "").trim().toLowerCase())
        .filter(Boolean);
      if (!cleanSym || !targetTfs.length) return;
      hasStickyManualViewportRef.current = true;
      lastManualViewportActionRef.current = {
        at: Date.now(),
        action: String(action || "").trim(),
        source: "all-timeframes",
      };
      setViewportCommandByChartId((prev) => {
        const next = { ...(prev || {}) };
        const nonceBase = Date.now();
        targetTfs.forEach((tfKey, index) => {
          next[`${cleanSym}-${tfKey}`] = {
            action: String(action || "").trim(),
            nonce: nonceBase + index,
          };
        });
        return next;
      });
    },
    [cleanSym, expectedLoadedTfKeys, liveBarsEnabled, mode, sortedTfs],
  );

  const handleCompactAllTimeframes = useCallback(() => {
    handleViewportActionAllTimeframes("show_compact");
  }, [handleViewportActionAllTimeframes]);

  const handleEnlargeAllTimeframes = useCallback(() => {
    handleViewportActionAllTimeframes("show_all_loaded");
  }, [handleViewportActionAllTimeframes]);

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
      const firstLoadedBarSec =
        Number(master?.bars?.[requestedTf]?.[0]?.time || 0) || 0;
      const exhaustionKey = `${cleanSym}|${requestedTf}|${firstLoadedBarSec || "na"}`;
      const lastExhaustedAt = Number(historyExhaustedNoticeRef.current?.[exhaustionKey] || 0);
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
        const storageMergedBars = Math.max(
          0,
          Number(storageSummary?.addedBars) || 0,
        );
        const initialStoredBars = Math.max(
          0,
          Number(storageSummary?.previousStoredBars) || 0,
        );
        const storageExtendedBars = Math.max(
          0,
          Number(storageSummary?.historyExtendedBars) || 0,
        );
        const effectiveStorageExtendedBars = Math.max(
          storageExtendedBars,
          storageMergedBars,
        );
        const remainingBars = Math.max(0, requestedBars - effectiveStorageExtendedBars);
        const storageAdded =
          effectiveStorageExtendedBars > 0 ||
          storageMergedBars > 0 ||
          Number(storageSummary?.updatedBars) > 0;
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
        const remoteMergedBars = Math.max(
          0,
          Number(remoteSummary?.addedBars) || 0,
        );
        const remoteExtendedBars = Math.max(
          0,
          Number(remoteSummary?.historyExtendedBars) || 0,
        );
        const effectiveRemoteExtendedBars = Math.max(
          remoteExtendedBars,
          remoteMergedBars,
        );
        const remoteAdded =
          effectiveRemoteExtendedBars > 0 ||
          remoteMergedBars > 0 ||
          Number(remoteSummary?.updatedBars) > 0;
        const remoteAttempted =
          remoteResult != null ||
          remoteSummary?.remoteAttempted === true ||
          remoteSummary?.remote_attempted === true;
        const remoteReason = String(
          remoteSummary?.remoteReason ||
            remoteSummary?.remote_reason ||
            storageSummary?.remoteReason ||
            storageSummary?.remote_reason ||
            "",
        ).trim();
        if (storageAdded || remoteAdded) {
          delete historyExhaustedNoticeRef.current[exhaustionKey];
          handleLoadMoreTf(requestedTf, requestedBars);
          applyPostLoadRecenter(sortedTfs);
        }
        const extendedBars =
          effectiveStorageExtendedBars + effectiveRemoteExtendedBars;
        const finalStoredBars = Math.max(
          0,
          Number(remoteSummary?.storedBars ?? storageSummary?.storedBars) || 0,
        );
        const storedBarsDelta = Math.max(0, finalStoredBars - initialStoredBars);
        const sourceLabel =
          storageMergedBars > 0 && remoteMergedBars > 0
            ? `local storage (${storageMergedBars}) + remote history (${remoteMergedBars})`
            : storageMergedBars > 0
              ? "local storage"
              : remoteMergedBars > 0
                ? "remote history"
                : "remote history";
        if (extendedBars > 0) {
          showToast({
            message:
              `${cleanSym} ${formatTfForToast(requestedTf)} extended chart history by ${extendedBars} bars from ${sourceLabel}.` +
              (storedBarsDelta > 0 ? ` File +${storedBarsDelta} bars.` : ""),
            type: "success",
          });
        } else if (!storageAdded && remoteAttempted) {
          if (!(lastExhaustedAt > 0 && Date.now() - lastExhaustedAt < 30_000)) {
            historyExhaustedNoticeRef.current[exhaustionKey] = Date.now();
            showToast({
              message: remoteReason
                ? `${cleanSym} ${formatTfForToast(requestedTf)} has no more older remote bars (${remoteReason}).`
                : `${cleanSym} ${formatTfForToast(requestedTf)} has no more older remote bars.`,
              type: "info",
            });
          }
        }
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
      master?.bars,
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
    if (!isCacheLikeMode || !cleanSym || status === "LOADING") return undefined;
    if (isBacktestChartReplay || isReplayMode) return undefined;
    const timer = window.setTimeout(() => {
      const barsByTf = {};
      (requestedSortedTfs || []).forEach((tf) => {
        const tfKey = String(tf || "").trim().toLowerCase();
        const loadedBars = getTimeframeValue(master?.bars, tfKey);
        if (Array.isArray(loadedBars) && loadedBars.length > 0) {
          barsByTf[tfKey] = loadedBars;
        }
      });
      if (!Object.keys(barsByTf).length) return;
      applySharedArtifactEngine(barsByTf, {
        requestedTimeframes: Object.keys(barsByTf),
        forceFull: false,
      });
    }, ARTIFACT_AUTO_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    applySharedArtifactEngine,
    cleanSym,
    isBacktestChartReplay,
    isReplayMode,
    isCacheLikeMode,
    master?.bars,
    requestedSortedTfs,
    status,
  ]);

  const handleRefreshChartsAndArtifacts = useCallback(async (opts = {}) => {
    const silent = opts?.silent === true;
    const summaryToast = opts?.summaryToast !== false;
    const forceRefresh = opts?.force !== false;
    const targetTfs = Array.isArray(requestedSortedTfs) ? requestedSortedTfs : [];
    if (!targetTfs.length) return;
    if (!liveBarsEnabled && !hasVisibleBars) {
      setForceChartBootstrapLoad(true);
    }
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
          force: forceRefresh,
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
    liveBarsEnabled,
    manualTfVisibleBars,
    applyPostLoadRecenter,
    savedTfVisibleBars,
    requestedSortedTfs,
    showToast,
    hasVisibleBars,
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
    if (hasAllRequestedBars || hasAllRequestedSnapshots || status === "LOADING") return;
    const loadKey = [
      "fallback",
      cleanSym,
      mode,
      chartSessionTradeSid,
      timeframes.join(","),
      localBarsCount,
      missingRequestedTfKeys.join(","),
    ].join("|");
    if (autoLoadKeyRef.current === loadKey) return;
    autoLoadKeyRef.current = loadKey;
    handleRefreshChartsAndArtifacts({
      force: false,
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
    chartSessionTradeSid,
    hasAllRequestedBars,
    hasAllRequestedSnapshots,
    missingRequestedTfKeys,
  ]);

  const handleRecalcArtifacts = useCallback(async () => {
    const targetTfs = (Array.isArray(requestedSortedTfs) ? requestedSortedTfs : []).filter((tf) => {
      const tfKey = String(tf || "").trim().toLowerCase();
      const loadedBars = getTimeframeValue(master?.bars, tfKey);
      return Array.isArray(loadedBars) && loadedBars.length > 0;
    });
    artifactRequestKeyRef.current = {};
    artifactRequestSeqRef.current = {};
    artifactEngineStateRef.current = createClientReplayArtifactEngineState();
    setArtifactObjectsByChartId({});
    setRawArtifactObjectsByChartId({});
    setSharedEngineAnalysisByTf({});
    setSharedArtifactItemsByTf({});
    setSharedTradePlansByTf({});
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
    replayArtifactLoadKeyRef.current = "";
    artifactEngineStateRef.current = createClientReplayArtifactEngineState();
    setArtifactObjectsByChartId({});
    setSharedEngineAnalysisByTf({});
    setSharedArtifactItemsByTf({});
    setSharedTradePlansByTf({});
    setArtifactEventVisibility({});
  }, [cleanSym]);

  const artifactPanelGroups = useMemo(() => {
    const groups = new Map();
    const groupedSources = [
      ...Object.entries(rawArtifactObjectsByChartId || {}).map(([chartId, items]) => ({
        chartId,
        items,
      })),
      ...Object.entries(sharedEngineAnalysisByTf || {}).map(([tfKey, entry]) => ({
        chartId: `analysis-${tfKey}`,
        items: buildSvgSummaryObjectsFromAnalysisEntry(entry, tfKey),
      })),
    ];
    for (const { chartId, items } of groupedSources) {
      for (const item of Array.isArray(items) ? items : []) {
        if (isSignalArtifactPanelItem(item)) continue;
        if (!shouldShowArtifactOnChart(item, item?.source_tf || item?.tf, "5m")) {
          continue;
        }
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
            defaultVisible: defaultArtifactGroupVisible(groupKey),
          });
        }
        const group = groups.get(mapKey);
        group.chartIds.add(chartId);
        group.count += 1;
        const storedVisible = artifactGroupVisibility?.[mapKey];
        const nextVisible =
          typeof storedVisible === "boolean"
            ? storedVisible
            : group.defaultVisible;
        if (nextVisible !== false) group.visible = true;
      }
    }
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        chartIds: Array.from(group.chartIds || []),
      }))
      .sort((a, b) => {
        const rankDiff = artifactPanelGroupRank(a.groupKey) - artifactPanelGroupRank(b.groupKey);
        if (rankDiff !== 0) return rankDiff;
        return String(a.label || "").localeCompare(String(b.label || ""));
      });
  }, [rawArtifactObjectsByChartId, sharedEngineAnalysisByTf, cleanSym, artifactGroupVisibility]);

  const artifactPanelTimeframes = useMemo(() => {
    const groups = new Map();
    for (const items of Object.values(rawArtifactObjectsByChartId || {})) {
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
  }, [rawArtifactObjectsByChartId, artifactTfVisibility]);
  const artifactPanelEvents = useMemo(() => {
    const groups = new Map();
    for (const entry of EVENT_PANEL_CATALOG) {
      const eventKey = String(entry?.eventKey || "").trim();
      if (!eventKey) continue;
      if (!allowedRuleEventSetHas(allowedRuleEventKeys, eventKey)) continue;
      const direction = String(entry?.direction || "neutral").trim().toLowerCase();
      groups.set(eventKey, {
        eventKey,
        label: eventKey,
        color: signalEventColorFromDirection(direction),
        direction,
        count: 0,
        visible: false,
        defaultVisible:
          DEFAULT_VISIBLE_SIGNAL_EVENT_KEYS.has(eventKey) &&
          !DEFAULT_HIDDEN_SIGNAL_EVENT_KEYS.has(eventKey),
      });
    }
    for (const items of Object.values(sharedArtifactItemsByTf || {})) {
      for (const item of Array.isArray(items) ? items : []) {
        if (!isTrueSignalEventItem(item)) continue;
        const eventKey = artifactMarkerText(item);
        if (!eventKey) continue;
        if (!allowedRuleEventSetHas(allowedRuleEventKeys, eventKey)) continue;
        if (!groups.has(eventKey)) {
          groups.set(eventKey, {
            eventKey,
            label: eventKey,
            color: signalEventColorFromDirection(resolveArtifactEventDirection(item)),
            direction: resolveArtifactEventDirection(item),
            count: 0,
            visible: false,
            defaultVisible: defaultArtifactEventVisible(item),
          });
        }
        const group = groups.get(eventKey);
        const itemDirection = resolveArtifactEventDirection(item);
        group.count += 1;
        if (itemDirection === "sell") {
          group.direction = "sell";
          group.color = signalEventColorFromDirection("sell");
        } else if (itemDirection === "buy" && group.direction !== "sell") {
          group.direction = "buy";
          group.color = signalEventColorFromDirection("buy");
        }
        const storedVisible = artifactEventVisibility?.[eventKey];
        const nextVisible =
          typeof storedVisible === "boolean"
            ? storedVisible
            : group.defaultVisible;
        if (item?.visible !== false && nextVisible !== false) {
          group.visible = true;
        }
      }
    }
    return Array.from(groups.values()).sort((a, b) => {
      const rankDiff = eventPanelGroupRank(a.eventKey) - eventPanelGroupRank(b.eventKey);
      if (rankDiff !== 0) return rankDiff;
      return String(a.label || "").localeCompare(String(b.label || ""));
    });
  }, [allowedRuleEventKeys, artifactEventVisibility, sharedArtifactItemsByTf]);

  const strategyMarkerObjectsByTf = useMemo(() => {
    const normalizedStrategies = (Array.isArray(chartStrategies) ? chartStrategies : [])
      .filter(Boolean);
    const barsByTfSource = isBacktestChartReplay ? replayBarsByTf : master?.bars;
    if (!normalizedStrategies.length || !barsByTfSource) return {};
    const output = {};
    Object.entries(barsByTfSource || {}).forEach(([tfKey, barsRaw]) => {
      const bars = Array.isArray(barsRaw) ? barsRaw : [];
      if (bars.length < 2) return;
      const evaluation = evaluateChartStrategies({
        bars,
        strategies: normalizedStrategies,
        lookbackBars: bars.length,
        symbol: cleanSym,
        tf: tfKey,
        multiTfBars: barsByTfSource,
        scanMode: effectiveStrategyScanMode,
        newsEvents: strategyCalendarEvents,
      });
      const hits = Array.isArray(evaluation?.matches) ? evaluation.matches : [];
      if (!hits.length) return;
      output[String(tfKey || "").trim().toLowerCase()] = hits
        .flatMap((hit) => [
          strategyHitToChartObject(hit, tfKey),
          ...strategyHitContextToChartObjects(hit, tfKey),
        ])
        .filter(Boolean)
        .filter((item) =>
          allowedRuleEventSetHas(
            allowedRuleEventKeys,
            item?.marker_text || item?.event_key || item?.artifact_type || "",
          ),
        );
    });
    return output;
  }, [
    chartStrategies,
    allowedRuleEventKeys,
    cleanSym,
    effectiveStrategyScanMode,
    isBacktestChartReplay,
    master?.bars,
    replayBarsByTf,
    strategyCalendarEvents,
  ]);
  useEffect(() => {
    if (typeof onStrategyMarkersChange !== "function") return;
    const objectsByTf =
      strategyMarkerObjectsByTf && typeof strategyMarkerObjectsByTf === "object"
        ? strategyMarkerObjectsByTf
        : {};
    const total = Object.values(objectsByTf).reduce(
      (sum, items) => sum + (Array.isArray(items) ? items.length : 0),
      0,
    );
    const resultCount = Object.values(objectsByTf).reduce(
      (sum, items) =>
        sum +
        (Array.isArray(items)
          ? items.filter((item) => item?.kind === "point" && item?.type === "STRATEGY").length
          : 0),
      0,
    );
    onStrategyMarkersChange({ objectsByTf, total, resultCount });
  }, [onStrategyMarkersChange, strategyMarkerObjectsByTf]);
  useEffect(() => {
    if (Array.isArray(SYMBOL_CHART_STRATEGY_CACHE)) return;
    void loadSymbolChartStrategyCache().catch(() => {});
  }, []);
  useEffect(() => {
    let cancelled = false;
    void loadSymbolChartNewsCache()
      .then((events) => {
        if (!cancelled) setStrategyCalendarEvents(Array.isArray(events) ? events : []);
      })
      .catch(() => {
        if (!cancelled) setStrategyCalendarEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const resolveMenuStrategyScanCacheKey = useCallback(
    (menu) => {
      if (!menu) return "";
      const contextualTf = resolveContextMenuTf(menu, activeChartId);
      const availableTfKeys = Object.keys(effectiveBarsByTfForPlans || {})
        .map((tfKey) => String(tfKey || "").trim().toLowerCase())
        .filter((tfKey) => {
          const bars = Array.isArray(effectiveBarsByTfForPlans?.[tfKey])
            ? effectiveBarsByTfForPlans[tfKey]
            : [];
          return bars.length >= 2;
        });
      return buildContextStrategyScanCacheKey({
        symbol: cleanSym,
        tf: contextualTf,
        tfSet: availableTfKeys,
      });
    },
    [activeChartId, cleanSym, effectiveBarsByTfForPlans],
  );
  const resolveContextualScanTimeSec = useCallback((bars = [], contextualTimeSec) => {
    const fallback = Number(bars[bars.length - 1]?.time || 0);
    if (!Number.isFinite(Number(contextualTimeSec)) || Number(contextualTimeSec) <= 0) {
      return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
    }
    for (let index = bars.length - 1; index >= 0; index -= 1) {
      const candidate = Number(bars[index]?.time || 0);
      if (Number.isFinite(candidate) && candidate <= Number(contextualTimeSec)) {
        return candidate;
      }
    }
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
  }, []);
  useEffect(() => {
    if (!ctxMenu) {
      setMenuStrategyScanState({
        cacheKey: "",
        status: "idle",
        plans: [],
        visibleCount: 6,
        scannedAt: 0,
      });
      return;
    }
    const cacheKey = resolveMenuStrategyScanCacheKey(ctxMenu);
    const cachedEntry = cacheKey
      ? SYMBOL_CHART_STRATEGY_SCAN_CACHE.get(cacheKey)
      : null;
    if (
      cachedEntry &&
      Number.isFinite(Number(cachedEntry.cachedAt)) &&
      Date.now() - Number(cachedEntry.cachedAt) < SYMBOL_CHART_STRATEGY_SCAN_CACHE_TTL_MS
    ) {
      setMenuStrategyScanState({
        cacheKey,
        status: "done",
        plans: Array.isArray(cachedEntry.plans) ? cachedEntry.plans : [],
        visibleCount: 6,
        scannedAt: Number(cachedEntry.cachedAt) || Date.now(),
      });
      return;
    }
    setMenuStrategyScanState({
      cacheKey,
      status: "idle",
      plans: [],
      visibleCount: 6,
      scannedAt: 0,
    });
  }, [ctxMenu, resolveMenuStrategyScanCacheKey]);
  const handleScanMenuStrategies = useCallback(async () => {
    if (!ctxMenu) return;
    const contextualTf = resolveContextMenuTf(ctxMenu, activeChartId);
    const contextualPrice = Number(ctxMenu?.price);
    const contextualTimeSec = Number(ctxMenu?.time || 0);
    const availableTfKeys = Object.keys(effectiveBarsByTfForPlans || {})
      .map((tfKey) => String(tfKey || "").trim().toLowerCase())
      .filter((tfKey) => {
        const bars = Array.isArray(effectiveBarsByTfForPlans?.[tfKey])
          ? effectiveBarsByTfForPlans[tfKey]
          : [];
        return bars.length >= 2;
      });
    const cacheKey = buildContextStrategyScanCacheKey({
      symbol: cleanSym,
      tf: contextualTf,
      tfSet: availableTfKeys,
    });
    const cachedEntry = SYMBOL_CHART_STRATEGY_SCAN_CACHE.get(cacheKey);
    if (
      cachedEntry &&
      Number.isFinite(Number(cachedEntry.cachedAt)) &&
      Date.now() - Number(cachedEntry.cachedAt) < SYMBOL_CHART_STRATEGY_SCAN_CACHE_TTL_MS
    ) {
      setMenuStrategyScanState({
        cacheKey,
        status: "done",
        plans: Array.isArray(cachedEntry.plans) ? cachedEntry.plans : [],
        visibleCount: 6,
        scannedAt: Number(cachedEntry.cachedAt) || Date.now(),
      });
      return;
    }
    setMenuStrategyScanState((prev) => ({
      ...prev,
      cacheKey,
      status: "loading",
      plans: [],
      visibleCount: 6,
      scannedAt: 0,
    }));
    try {
      const [loadedStrategies, cachedNewsEvents] = await Promise.all([
        Array.isArray(SYMBOL_CHART_STRATEGY_CACHE)
          ? Promise.resolve(SYMBOL_CHART_STRATEGY_CACHE)
          : loadSymbolChartStrategyCache(),
        loadSymbolChartNewsCache(),
      ]);
      setStrategyCalendarEvents(Array.isArray(cachedNewsEvents) ? cachedNewsEvents : []);
      const mergedStrategies = normalizeStrategyCatalog(
        mergeStrategiesById(
          Array.isArray(chartStrategies) ? chartStrategies : [],
          Array.isArray(loadedStrategies) ? loadedStrategies : [],
        ),
      ).filter(Boolean);
      const plans = availableTfKeys
        .flatMap((tfKey) => {
          const tfBars = Array.isArray(effectiveBarsByTfForPlans?.[tfKey])
            ? effectiveBarsByTfForPlans[tfKey]
            : [];
          const targetTfTimeSec = resolveContextualScanTimeSec(
            tfBars,
            contextualTimeSec,
          );
          if (!Number.isFinite(targetTfTimeSec) || targetTfTimeSec <= 0) return [];
          return collectContextualStrategyTradePlans({
            barsByTf: effectiveBarsByTfForPlans,
            strategies: mergedStrategies,
            lookbackBars: Number.MAX_SAFE_INTEGER,
            symbol: cleanSym,
            tf: tfKey,
            timeSec: targetTfTimeSec,
            scanMode: effectiveStrategyScanMode,
            newsEvents: cachedNewsEvents,
          })
            .filter((plan) => {
              const triggeredAt = Number(plan?.start_bar || plan?.bar_start || 0);
              return Number.isFinite(triggeredAt) && triggeredAt === targetTfTimeSec;
            })
            .map((plan) => ({
              ...plan,
              _scan_tf: tfKey,
            }));
        })
        .map((plan) => ({
          ...plan,
          _entryDistance:
            Number.isFinite(contextualPrice) && Number.isFinite(Number(plan?.entry))
              ? Math.abs(Number(plan.entry) - contextualPrice)
              : Number.POSITIVE_INFINITY,
          _tfPriority:
            String(plan?._scan_tf || "").trim().toLowerCase() === contextualTf ? 0 : 1,
        }))
        .sort((left, right) => {
          const tfCompare =
            Number(left?._tfPriority || 0) - Number(right?._tfPriority || 0);
          if (tfCompare !== 0) return tfCompare;
          const distanceCompare =
            Number(left?._entryDistance || 0) - Number(right?._entryDistance || 0);
          if (distanceCompare !== 0) return distanceCompare;
          return String(left?.strategy_name || left?.strategy || "").localeCompare(
            String(right?.strategy_name || right?.strategy || ""),
          );
        });
      const cachedAt = Date.now();
      SYMBOL_CHART_STRATEGY_SCAN_CACHE.set(cacheKey, {
        cachedAt,
        plans,
      });
      setMenuStrategyScanState({
        cacheKey,
        status: "done",
        plans,
        visibleCount: 6,
        scannedAt: cachedAt,
      });
    } catch (error) {
      setMenuStrategyScanState({
        cacheKey,
        status: "error",
        plans: [],
        visibleCount: 6,
        scannedAt: 0,
      });
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "Failed to scan strategies for this chart context.",
        tone: "error",
      });
    }
  }, [
    activeChartId,
    chartStrategies,
    cleanSym,
    ctxMenu,
    effectiveStrategyScanMode,
    effectiveBarsByTfForPlans,
    resolveContextualScanTimeSec,
  ]);
  const handleLoadMoreMenuStrategies = useCallback(() => {
    setMenuStrategyScanState((prev) => ({
      ...prev,
      visibleCount: Math.min(
        Array.isArray(prev.plans) ? prev.plans.length : prev.visibleCount,
        Number(prev.visibleCount || 0) + 6,
      ),
    }));
  }, []);
  useEffect(() => {
    if (!isBacktestChartReplay || !cleanSym) return;
    const targetTfs = Object.keys(replayBarsByTf || {});
    if (!targetTfs.length) return;
    applySharedArtifactEngine(replayBarsByTf, {
      requestedTimeframes: targetTfs,
      forceFull: false,
    });
  }, [
    applySharedArtifactEngine,
    cleanSym,
    isBacktestChartReplay,
    replayBarsByTf,
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
  }, [artifactPanelGroups]);

  const toggleArtifactGroupKeysVisibility = useCallback((groupKeys = []) => {
    const keys = (Array.isArray(groupKeys) ? groupKeys : [])
      .map((key) => String(key || "").trim())
      .filter(Boolean);
    if (!keys.length) return;
    const keySet = new Set(keys);
    const matchingGroups = artifactPanelGroups.filter((group) =>
      keySet.has(String(group?.groupKey || "").trim()),
    );
    const nextVisible = matchingGroups.some((group) => group?.visible === false);
    setArtifactGroupVisibility((prev) => {
      const next = { ...(prev || {}) };
      keys.forEach((key) => {
        next[key] = nextVisible;
      });
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
  const toggleArtifactTfGroupVisibility = useCallback((tfKeys = []) => {
    const keys = (Array.isArray(tfKeys) ? tfKeys : [])
      .map((key) => String(key || "").trim())
      .filter(Boolean);
    if (!keys.length) return;
    const keySet = new Set(keys);
    const matchingGroups = artifactPanelTimeframes.filter((group) =>
      keySet.has(String(group?.tfKey || "").trim()),
    );
    const nextVisible = matchingGroups.some((group) => group?.visible === false);
    setArtifactTfVisibility((prev) => {
      const next = { ...(prev || {}) };
      keys.forEach((key) => {
        next[key] = nextVisible;
      });
      return next;
    });
  }, [artifactPanelTimeframes]);
  const toggleArtifactEventVisibility = useCallback((eventKey) => {
    setArtifactEventVisibility((prev) => {
      const current = prev?.[eventKey];
      const fallbackVisible = artifactPanelEvents.find((group) => group.eventKey === eventKey)?.visible;
      const nextVisible =
        typeof current === "boolean"
          ? !current
          : !(typeof fallbackVisible === "boolean" ? fallbackVisible : true);
      return { ...(prev || {}), [eventKey]: nextVisible };
    });
  }, [artifactPanelEvents]);
  const toggleArtifactEventKeysVisibility = useCallback((eventKeys = []) => {
    const keys = (Array.isArray(eventKeys) ? eventKeys : [])
      .map((key) => String(key || "").trim())
      .filter(Boolean);
    if (!keys.length) return;
    const keySet = new Set(keys);
    const matchingEvents = artifactPanelEvents.filter((group) =>
      keySet.has(String(group?.eventKey || "").trim()),
    );
    const nextVisible = matchingEvents.some((group) => group?.visible === false);
    setArtifactEventVisibility((prev) => {
      const next = { ...(prev || {}) };
      keys.forEach((key) => {
        next[key] = nextVisible;
      });
      return next;
    });
  }, [artifactPanelEvents]);
  const toggleIndicatorKeysVisibility = useCallback((keys = [], checked = true) => {
    const normalizedKeys = (Array.isArray(keys) ? keys : [])
      .map((key) => String(key || "").trim())
      .filter(Boolean);
    if (!normalizedKeys.length) return;
    setIndicatorVisibility((prev) => {
      const next = { ...(prev || {}) };
      normalizedKeys.forEach((key) => {
        next[key] = Boolean(checked);
      });
      return next;
    });
  }, []);
  const isArtifactEventVisible = useCallback(
    (item) => {
      if (!item?.is_event) return true;
      const eventKey = artifactMarkerText(item);
      if (!eventKey) return true;
      if (!allowedRuleEventSetHas(allowedRuleEventKeys, eventKey)) return false;
      const storedVisible = artifactEventVisibility?.[eventKey];
      if (typeof storedVisible === "boolean") return storedVisible;
      return defaultArtifactEventVisible(item);
    },
    [allowedRuleEventKeys, artifactEventVisibility],
  );

  const chartLayerToggleItems = useMemo(
    () => [
      ...(artifactPanelTimeframes.length
        ? [{
            key: "tf-all",
            checked: artifactPanelTimeframes.every((group) => group.visible !== false),
            onChange: (evt) =>
              toggleArtifactTfGroupVisibility(
                artifactPanelTimeframes.map((group) => group.tfKey),
                evt?.target?.checked,
              ),
            label: "TFs",
            description: layerGroupDescription(artifactPanelTimeframes.map((group) => group.label)),
            tone: "#38bdf8",
            title: "Toggle all loaded timeframe artifact layers",
          }]
        : []),
      {
        key: "chart-rsi-panel",
        checked: indicatorVisibility.rsiPanel !== false,
        onChange: (evt) =>
          setIndicatorVisibility((prev) => ({
            ...prev,
            rsiPanel: evt.target.checked,
          })),
        label: "RSI",
        description: "Momentum panel",
        tone: "#a855f7",
        title: "Toggle momentum panel",
      },
      {
        key: "chart-strategy-markers",
        checked: showStrategyMarkers,
        onChange: (evt) => setShowStrategyMarkers(evt.target.checked),
        label: "STRAT",
        description: "Buy/sell markers",
        tone: "#38bdf8",
        title: "Toggle strategy buy/sell markers",
      },
      {
        key: "chart-zigzag",
        checked: indicatorVisibility.zigzag !== false,
        onChange: (evt) =>
          setIndicatorVisibility((prev) => ({
            ...prev,
            zigzag: evt.target.checked,
            candles: true,
          })),
        label: "ZZ",
        description: "Zigzag/candles",
        tone: "#facc15",
        title: "Toggle zigzag and candle guidance",
      },
    ],
    [
      artifactPanelTimeframes,
      indicatorVisibility.rsiPanel,
      indicatorVisibility.zigzag,
      showStrategyMarkers,
      toggleArtifactTfGroupVisibility,
    ],
  );
  const artifactGroupToggleItems = useMemo(
    () =>
      artifactPanelGroups.map(({ groupKey, label, color, count, visible }) => ({
        key: groupKey,
        checked: visible,
        onChange: () => toggleArtifactGroupVisibility(groupKey),
        label,
        description: `${count} item${count === 1 ? "" : "s"}`,
        tone: color,
        title: label,
      })),
    [artifactPanelGroups, toggleArtifactGroupVisibility],
  );
  const eventToggleItems = useMemo(
    () =>
      artifactPanelEvents.map(({ eventKey, label, color, count, visible, direction }) => ({
        key: eventKey,
        checked: visible,
        onChange: () => toggleArtifactEventVisibility(eventKey),
        label,
        description: `${count} · ${direction === "sell" ? "bearish" : direction === "buy" ? "bullish" : "neutral"}`,
        tone: color,
        title: label,
      })),
    [artifactPanelEvents, toggleArtifactEventVisibility],
  );
  const momentumToggleItems = useMemo(
    () =>
      MOMENTUM_LAYER_GROUPS.map((group) => ({
        key: group.key,
        checked: layerGroupChecked(group.itemKeys, indicatorVisibility),
        onChange: (evt) =>
          toggleIndicatorKeysVisibility(group.itemKeys, evt?.target?.checked),
        label: group.label,
        description: group.description,
        tone: group.tone,
        title: group.description,
      })),
    [indicatorVisibility, toggleIndicatorKeysVisibility],
  );
  const trendToggleItems = useMemo(
    () =>
      TREND_LAYER_GROUPS.map((group) => ({
        key: group.key,
        checked: layerGroupChecked(group.itemKeys, indicatorVisibility),
        onChange: (evt) =>
          toggleIndicatorKeysVisibility(group.itemKeys, evt?.target?.checked),
        label: group.label,
        description: group.description,
        tone: group.tone,
        title: group.description,
      })),
    [indicatorVisibility, toggleIndicatorKeysVisibility],
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
    const nextArtifactEventVisibility = {};
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
    for (const group of artifactPanelEvents || []) {
      const eventKey = String(group?.eventKey || "").trim();
      if (!eventKey) continue;
      const storedVisible = artifactEventVisibility?.[eventKey];
      nextArtifactEventVisibility[eventKey] =
        typeof storedVisible === "boolean"
          ? storedVisible
          : group?.defaultVisible !== false;
    }
    const symbolConfig = {
      updatedAt: Date.now(),
      timeframes: timeframeConfig,
      artifactEventVisibility: nextArtifactEventVisibility,
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
    artifactEventVisibility,
    artifactPanelEvents,
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
    (side, explicitPrice = null, explicitCtx = null, options = null) => {
      const contextSnapshot =
        explicitCtx && typeof explicitCtx === "object" ? explicitCtx : ctxMenu;
      const normalizedOptions =
        options && typeof options === "object" ? options : {};
      const sourceChartId = String(
        contextSnapshot?.chartId || activeChartId || "",
      );
      const activeTf = sourceChartId.split("-").slice(-1)[0];
      const activeBars = master?.bars?.[activeTf] || [];
      const activeLastClose = Number(activeBars[activeBars.length - 1]?.close);
      const pricePrecision = resolveSymbolTradePricePrecision(
        cleanSym,
        activeBars.flatMap((bar) => [bar?.open, bar?.high, bar?.low, bar?.close]),
        normalizedOptions?.price_precision,
      );
      const usePrice = Number.isFinite(Number(explicitPrice))
        ? Number(explicitPrice)
        : Number.isFinite(Number(contextSnapshot?.price))
          ? Number(contextSnapshot?.price)
          : Number.isFinite(Number(hoverInfo?.price))
            ? Number(hoverInfo.price)
            : Number.isFinite(activeLastClose)
              ? activeLastClose
              : Number.isFinite(Number(latestCachedPrice))
                ? Number(latestCachedPrice)
                : null;
      if (!Number.isFinite(usePrice)) return;
      const pathname =
        typeof window !== "undefined"
          ? String(window.location.pathname || "").trim().toLowerCase()
          : "";
      const hash =
        typeof window !== "undefined"
          ? String(window.location.hash || "").trim().toLowerCase()
          : "";
      const tradesNamespaceBase = resolveTradesNamespaceBase(pathname);
      const isAnalyzeRoute = pathname.startsWith("/trades/analyze");
      const isManualRoute = pathname.startsWith("/trades/manual");
      const isManualChartAnalysisRoute =
        isManualRoute && hash === "#chart-analysis";
      const suggestionTfs = resolveSuggestedTradeTimeframes(
        activeTf,
        timeframes,
        sharedArtifactItemsByTf,
      );
      const tradeType =
        String(normalizedOptions?.trade_type || normalizedOptions?.order_type || "limit")
          .trim()
          .toLowerCase() === "market"
          ? "market"
          : "limit";
      const referencePrice = Number.isFinite(activeLastClose)
        ? activeLastClose
        : Number.isFinite(Number(latestCachedPrice))
          ? Number(latestCachedPrice)
          : usePrice;
      const suggestedLevels = buildSuggestedTradeLevels({
        side,
        entryPrice: usePrice,
        referencePrice: tradeType === "market" ? usePrice : referencePrice,
        activeTf,
        selectedTfs: suggestionTfs,
        artifactItemsByTf: sharedArtifactItemsByTf,
      });
      const resolvedSuggestedLevels = resolveSuggestedTradeLevelsWithFallback({
        suggested: suggestedLevels,
        requestedSide: side,
        clickedEntryPrice: usePrice,
        currentSide: side,
        currentEntryPrice: entryPrice,
        currentTpPrice: tp1Price ?? tpPrice,
        currentSlPrice: slPrice,
      });
      const suggestedTp = resolvedSuggestedLevels.tp;
      const suggestedSl = resolvedSuggestedLevels.sl;
      const entryPayloadPrice = usePrice;
      const baseChartIntentMeta = {
        strategy: "Price Action",
        entry_model: "Rejection",
        source_id: "auto_chart",
        source: "auto_chart",
      };
      if (isManualRoute && typeof onQuickTradeIntent === "function") {
        onQuickTradeIntent({
          symbol: cleanSym,
          side: String(side || "BUY").toUpperCase(),
          action: "ENTRY",
          plan_id: activePlanGroup,
          price: entryPayloadPrice,
          tp: suggestedTp,
          sl: suggestedSl,
          trade_type: tradeType,
          price_precision: pricePrecision,
          time: contextSnapshot?.time || null,
          interval: contextSnapshot?.interval || null,
          ...baseChartIntentMeta,
        });
        if (!isManualChartAnalysisRoute && typeof window !== "undefined") {
          const nextHref = `${window.location.pathname}${window.location.search}#chart-analysis`;
          window.history.replaceState(null, "", nextHref);
        }
        setCtxMenu(null);
        return;
      }
      if (typeof window !== "undefined") {
        const search = new URLSearchParams();
        search.set("direction", String(side || "BUY").toUpperCase());
        if (entryPayloadPrice != null) {
          search.set("entry", String(entryPayloadPrice));
        }
        if (suggestedTp != null) {
          search.set("tp", String(suggestedTp));
        }
        if (suggestedSl != null) {
          search.set("sl", String(suggestedSl));
        }
        search.set("trade_type", tradeType);
        search.set("price_precision", String(pricePrecision));
        search.set("chart_tf", String(activeTf || ""));
        search.set("source_id", "auto_chart");
        search.set("strategy", "Price Action");
        search.set("entry_model", "Rejection");
        window.location.href = `${tradesNamespaceBase}/manual/${encodeURIComponent(
          String(cleanSym || "").toUpperCase(),
        )}?${search.toString()}#chart-analysis`;
        setCtxMenu(null);
        return;
      }
      const payload = {
        symbol: cleanSym,
        side: String(side || "BUY").toUpperCase(),
        action: "ENTRY",
        plan_id: activePlanGroup,
        price: entryPayloadPrice,
        tp: suggestedTp,
        sl: suggestedSl,
        trade_type: tradeType,
        price_precision: pricePrecision,
        time: contextSnapshot?.time || null,
        interval: contextSnapshot?.interval || null,
        ...baseChartIntentMeta,
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
      side,
      entryPrice,
      tpPrice,
      tp1Price,
      slPrice,
      timeframes,
      sharedArtifactItemsByTf,
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
        strategy: "Price Action",
        entry_model: "Rejection",
        source_id: "auto_chart",
        source: "auto_chart",
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
              border: "1px solid rgba(34, 211, 238, 0.45)",
              background: "rgba(15, 23, 42, 0.68)",
              padding: "4px 8px",
              margin: 0,
              borderRadius: 8,
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
            <TimeframePresetPicker
              selectedTfs={timeframes}
              presetOptions={timeframePresets}
              timeframeOptions={timeframeOptions}
              align="right"
              buttonMinWidth={120}
              buttonHeight={30}
              title="Chart timeframes"
              onChange={(nextTfs) => onTimeframesChange(sortTimeframes(nextTfs, "desc"))}
            />
          ) : null}
          {isCacheLikeMode && (
            <div
              style={{ position: "relative", zIndex: showIndicatorsMenu ? 90 : "auto" }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className="secondary-button"
                style={{
                  lineHeight: 1,
                  fontWeight: 700,
                  minWidth: 38,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
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
                aria-label="Toggle layers, artifacts, and calculated indicators for all TF charts"
              >
                <LayersIcon />
              </button>
              {showIndicatorsMenu && (
                <div
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
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
                    pointerEvents: "auto",
                    isolation: "isolate",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ flex: "1 1 auto", minWidth: 0 }}>
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
                    </div>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        flex: "0 0 auto",
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
                            minWidth: 34,
                            width: 34,
                            height: 30,
                            padding: 0,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
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
                            ? "…"
                            : configSaveState === "saved"
                              ? "✓"
                              : <SaveConfigIcon />}
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
                  <div style={{ display: "grid", gap: 8 }}>
                    <div
                      style={{
                        display: "grid",
                        gap: 6,
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.06)",
                        background: "rgba(255,255,255,0.015)",
                        padding: 8,
                      }}
                    >
                      {activeLayersTab === "chart" ? (
                        <LayerBooleanGrid items={chartLayerToggleItems} />
                      ) : null}
                      {activeLayersTab === "artifacts" ? (
                        <>
                          <div style={{ display: "grid", gap: 6 }}>
                            {artifactPanelGroups.length ? (
                              <LayerBooleanGrid items={artifactGroupToggleItems} />
                            ) : (
                              <div style={{ fontSize: 11, color: "#64748b", padding: "2px 0 8px" }}>
                                Open or scroll a chart window to auto-load artifact layers, or use the
                                button above to rebuild them from scratch.
                              </div>
                            )}
                          </div>
                        </>
                      ) : null}
                      {activeLayersTab === "events" ? (
                        <>
                          <div style={{ display: "grid", gap: 6 }}>
                            {artifactPanelEvents.length ? (
                              <LayerBooleanGrid items={eventToggleItems} />
                            ) : (
                              <div style={{ fontSize: 11, color: "#64748b", padding: "2px 0 8px" }}>
                                Event markers appear here after artifacts are loaded for the visible chart
                                windows.
                              </div>
                            )}
                          </div>
                        </>
                      ) : null}
                      {activeLayersTab === "momentum" ? (
                        <>
                          <LayerBooleanGrid items={momentumToggleItems} />
                        </>
                      ) : null}
                      {activeLayersTab === "trend" ? (
                        <>
                          <LayerBooleanGrid items={trendToggleItems} />
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
              <button
                className="secondary-button"
                type="button"
                onClick={handleCompactAllTimeframes}
                title="Make all loaded timeframe charts smaller"
                style={{
                  fontWeight: 700,
                  minWidth: 38,
                }}
              >
                .
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={handleEnlargeAllTimeframes}
                title="Enlarge all loaded timeframe charts"
                style={{
                  fontWeight: 700,
                  minWidth: 38,
                }}
              >
                <ViewportNavIcon action="show_all_loaded" />
              </button>
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
                <RefreshIcon />
              </button>
            </>
          )}
          {(mode === "cache" || mode === REPLAY_MODE) && effectiveReplayConfig?.enabled ? (
            <>
              {replayCompletedBarsText ? (
                <span
                  className="minor-text"
                  title="Completed bars / total bars in this replay window"
                >
                  {replayCompletedBarsText}
                </span>
              ) : null}
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
                aria-label={
                  effectiveReplayConfig?.playing
                    ? "Pause replay for this chart set"
                    : "Start replay for this chart set"
                }
                style={{
                  minWidth: 38,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {effectiveReplayConfig?.playing ? (
                  <ReplayPauseIcon />
                ) : (
                  <ReplayPlayIcon />
                )}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleStopReplay}
                disabled={!hasReplayCursor && !effectiveReplayConfig?.playing}
                title="Stop replay and reset to the first bar"
                aria-label="Stop replay and reset to the first bar"
                style={{
                  minWidth: 38,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ReplayStopIcon />
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
              const tfTrades = replayTrades.filter((trade) =>
                tradeMatchesTimeframe(trade, tf),
              );
              const tfSelectedTrade =
                tfTrades.find(
                  (trade) => String(trade?.sid || "") === String(effectiveTradeSid || ""),
                ) ||
                tfTrades[0] ||
                null;
              const tfTradeSid = String(tfSelectedTrade?.sid || "");
              const tfTradeLabel = String(
                tfSelectedTrade?.tradeLabel ||
                  tfSelectedTrade?.strategy_name ||
                  tfSelectedTrade?.strategy_key ||
                  effectiveTradeLabel ||
                  "",
              ).trim();
              const tfTradeSide = String(
                tfSelectedTrade?.side || tfSelectedTrade?.action || effectiveTradeSide || "",
              ).trim();
              const tfCreatedAt = tfSelectedTrade?.createdAt ?? effectiveCreatedAt;
              const tfOpenedAt = tfSelectedTrade?.openedAt ?? effectiveOpenedAt;
              const tfClosedAt = tfSelectedTrade?.closedAt ?? effectiveClosedAt;
              const tfCreatedAtSec =
                tfSelectedTrade?.createdAtSec ?? toEpochSec(tfCreatedAt);
              const tfOpenedAtSec =
                tfSelectedTrade?.openedAtSec ?? toEpochSec(tfOpenedAt);
              const tfClosedAtSec =
                tfSelectedTrade?.closedAtSec ?? toEpochSec(tfClosedAt);
              const tfExitPrice =
                tfSelectedTrade?.exitPrice ?? effectiveExitPrice;
              const tfPnlRealized =
                tfSelectedTrade?.pnlRealized ?? effectivePnlRealized;
              const tfCloseStatus =
                tfSelectedTrade?.closeStatus || effectiveCloseStatus;
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
              const createdAtSec = tfCreatedAtSec;
              const openedAtSec = tfOpenedAtSec;
              const closedAtSec = tfClosedAtSec;
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
                !isLive &&
                !isBacktestChartReplay &&
                status === "LOADING"
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
              const currentArtifactObjectsByChartId =
                mode === "svg" ? rawArtifactObjectsByChartId : artifactObjectsByChartId;
              const artifactObjects = Object.entries(
                currentArtifactObjectsByChartId || {},
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
                return items
                  .filter((item) =>
                    shouldShowArtifactOnChart(
                      item,
                      item?.source_tf || item?.tf || sourceTf,
                      tf,
                    ),
                  )
                  .map((item) => {
                    const itemGroupKey = artifactGroupKeyForItem(item);
                    const isSignalEvent = isTrueSignalEventItem(item);
                    const storedGroupVisible = artifactGroupVisibility?.[itemGroupKey];
                    const groupVisible =
                      typeof storedGroupVisible === "boolean"
                        ? storedGroupVisible
                        : defaultArtifactGroupVisible(itemGroupKey);
                    const isHiddenByDefaultGroup =
                      typeof storedGroupVisible !== "boolean" &&
                      defaultArtifactGroupVisible(itemGroupKey) === false;
                    return {
                      ...item,
                      visible:
                        mode === "svg" && isActiveSwingArtifactObject(item)
                          ? true
                          : isSignalEvent
                            ? item?.visible !== false
                            : groupVisible !== false && !isHiddenByDefaultGroup,
                      color: artifactTimeframeColor(
                        item?.source_tf || item?.tf || sourceTf,
                      ),
                    };
                  })
                  .filter((item) => {
                    if (mode === "svg" && isActiveSwingArtifactObject(item)) return true;
                  const itemTfKey = artifactSourceTfLabel(
                    item?.source_tf || item?.tf || sourceTf,
                  );
                  if (!itemTfKey) return true;
                  return (
                    artifactTfVisibility?.[itemTfKey] !== false &&
                    isArtifactEventVisible(item)
                  );
                  });
              });
              const analysisSummaryObjects = buildSvgSummaryObjectsFromAnalysisEntry(
                effectiveMultiTfAnalysisByTf?.[String(tf).toLowerCase()] || {},
                tf,
              ).filter((item) => {
                const itemTfKey = artifactSourceTfLabel(
                  item?.source_tf || item?.tf || tf,
                );
                const itemGroupKey = String(
                  item?.artifact_group || artifactGroupKeyForItem(item) || "",
                ).trim().toLowerCase();
                const storedGroupVisible = artifactGroupVisibility?.[itemGroupKey];
                const groupVisible =
                  typeof storedGroupVisible === "boolean"
                    ? storedGroupVisible
                    : defaultArtifactGroupVisible(itemGroupKey);
                if (!itemTfKey) return true;
                return (
                  groupVisible !== false &&
                  artifactTfVisibility?.[itemTfKey] !== false &&
                  isArtifactEventVisible(item)
                );
              });
              const phaseTargetBoundaryObjects = buildPhaseTargetBoundaryObjects(
                effectiveMultiTfAnalysisByTf?.[String(tf).toLowerCase()] || {},
                tf,
              ).filter((item) => {
                const itemTfKey = artifactSourceTfLabel(
                  item?.source_tf || item?.tf || tf,
                );
                if (!itemTfKey) return true;
                return (
                  artifactTfVisibility?.[itemTfKey] !== false &&
                  isArtifactEventVisible(item)
                );
              });
              const strategyMarkerObjects =
                showStrategyMarkers &&
                Array.isArray(strategyMarkerObjectsByTf?.[tf.toLowerCase()])
                  ? strategyMarkerObjectsByTf[tf.toLowerCase()].filter((item) =>
                      isArtifactEventVisible(item),
                    )
                  : [];
              const replaySharedObjects = isBacktestChartReplay
                ? dedupeSignalEventObjects(
                    [
                      ...strategyMarkerObjects,
                      ...artifactObjects,
                      ...phaseTargetBoundaryObjects,
                      ...analysisSummaryObjects,
                      ...annotationObjects,
                    ]
                      .map((item) => projectArtifactObjectForReplay(item, replayCurrentBarTimeSec))
                      .filter(Boolean),
                  )
                : [];
              const sharedChartObjects = isBacktestChartReplay
                ? replaySharedObjects
                : dedupeSignalEventObjects([
                    ...strategyMarkerObjects,
                    ...artifactObjects,
                    ...phaseTargetBoundaryObjects,
                    ...analysisSummaryObjects,
                    ...annotationObjects,
                  ]);
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
                    borderRadius: 8,
                    overflow: "visible",
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
                    tradeCount={tfTrades.length}
                    showSymbolTfBadge={showSymbolTfBadge}
                    provider={provider}
                    context={context}
                    master={master}
                    renderedBars={barsToRender}
                    viewport={tfViewport}
                        mode={mode}
                    analysisSnapshot={effectiveAnalysisSnapshot}
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
                  <div
                    style={{
                      position: "relative",
                      border: "1px solid",
                      borderColor: isActiveTf ? "#22d3ee" : "rgba(148, 163, 184, 0.18)",
                      borderRadius: 8,
                      overflow: "hidden",
                    }}
                  >
                    {Object.keys(effectiveMultiTfAnalysisByTf || {}).length > 0 ? (
                      <RealtimeTfAnalysisOverlay
                        analysisByTf={effectiveMultiTfAnalysisByTf}
                        orderedTfs={analysisOrderedTfs}
                        activeTf={tf}
                        recentEventsByTf={recentArtifactEventsByTf}
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
                        {(() => {
                          const fallbackTradeEventTimeSec =
                            overlays.plan1 &&
                            tradeObjectsVisible &&
                            Number.isFinite(Number(effectiveEntryPrice)) &&
                            !Number.isFinite(Number(tfCreatedAtSec)) &&
                            !Number.isFinite(Number(tfOpenedAtSec)) &&
                            Array.isArray(barsToRender) &&
                            barsToRender.length > 0
                              ? Number(barsToRender[barsToRender.length - 1]?.time)
                              : null;
                          return (
                        <ChartSVG
                          key={`svg-${chartId}`}
                          bars={barsToRender}
                          side={tfTradeSide}
                          action={tfTradeSide}
                          tradeLabel={tfTradeLabel}
                          entryPrice={overlays.plan1 ? effectiveEntryPrice : null}
                          slPrice={overlays.plan1 ? effectiveSlPrice : null}
                          tpPrice={overlays.plan1 ? effectiveTpPrice : null}
                          tp1Price={overlays.plan1 ? tp1Price : null}
                          tp2Price={overlays.plan1 ? tp2Price : null}
                          tp3Price={overlays.plan1 ? tp3Price : null}
                          createdAt={showEventMarkers ? tfCreatedAt : null}
                          createdAtSec={
                            showEventMarkers
                              ? tfCreatedAtSec ?? fallbackTradeEventTimeSec
                              : null
                          }
                          openedAt={showEventMarkers ? tfOpenedAt : null}
                          openedAtSec={
                            showEventMarkers
                              ? tfOpenedAtSec ?? fallbackTradeEventTimeSec
                              : null
                          }
                          closedAt={showEventMarkers ? tfClosedAt : null}
                          closeStatus={showEventMarkers ? tfCloseStatus : ""}
                          exitPrice={showEventMarkers ? tfExitPrice : null}
                          pnlRealized={showEventMarkers ? tfPnlRealized : null}
                          trades={
                            showEventMarkers ? tfTrades : []
                          }
                          selectedTradeSid={tfTradeSid}
                          barsCount={initialVisibleBars}
                          height={chartHeight}
                          showLegend={false}
                          showIndicators={true}
                          indicatorVisibilityConfig={indicatorVisibility}
                          sharedObjects={sharedChartObjects}
                        />
                          );
                        })()}
                      </div>
                    ) : hasBars ? (
                      <>
                      {(() => {
                        const fallbackTradeEventTimeSec =
                          overlays.plan1 &&
                          tradeObjectsVisible &&
                          Number.isFinite(Number(effectiveEntryPrice)) &&
                          !Number.isFinite(Number(tfCreatedAtSec)) &&
                          !Number.isFinite(Number(tfOpenedAtSec)) &&
                          Array.isArray(barsToRender) &&
                          barsToRender.length > 0
                            ? Number(barsToRender[barsToRender.length - 1]?.time)
                            : null;
                        return (
                      <TradeSignalChart
                        key={`tsc-${chartId}-${effectiveTradeOverlayRenderKey}-${tfTradeSid || "none"}`}
                        chartId={chartId}
                        symbol={cleanSym}
                        provider={provider}
                        interval={tf}
                        historicalData={barsToRender}
                        visibleBarsCount={initialVisibleBars}
                        height={chartHeight}
                        analysisSnapshot={effectiveAnalysisSnapshot || null}
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
                          showEventMarkers && createdMarkerVisible ? tfCreatedAt : null
                        }
                        createdAtSec={
                          showEventMarkers && createdMarkerVisible
                            ? tfCreatedAtSec ?? fallbackTradeEventTimeSec
                            : null
                        }
                        openedAt={
                          showEventMarkers && openedMarkerVisible ? tfOpenedAt : null
                        }
                        openedAtSec={
                          showEventMarkers && openedMarkerVisible
                            ? tfOpenedAtSec ?? fallbackTradeEventTimeSec
                            : null
                        }
                        closedAt={
                          showEventMarkers && closedMarkerVisible ? tfClosedAt : null
                        }
                        closedAtSec={
                          showEventMarkers && closedMarkerVisible
                            ? tfClosedAtSec
                            : null
                        }
                        closeStatus={
                          showEventMarkers ? tfCloseStatus : ""
                        }
                        exitPrice={
                          showEventMarkers ? tfExitPrice : null
                        }
                        pnlRealized={showEventMarkers ? tfPnlRealized : null}
                        tradeLabel={tfTradeLabel}
                        trades={
                          showEventMarkers ? tfTrades : []
                        }
                        selectedTradeSid={tfTradeSid}
                        animateTradeViewport={
                          isBacktestChartReplay ? false : animateTradeViewport
                        }
                        autoFitNonce={viewportAutoFitNonce}
                        preserveViewportOnBarsChange={!isBacktestChartReplay}
                        preferTradeAnchoredViewport={preferTradeAnchoredViewport}
                        showPrimaryPlan={overlays.plan1}
                        showExtraPlans={overlays.plan2}
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
                          canShowChartContextMenu
                            ? handleContextRequest
                            : undefined
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
                        );
                      })()}
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
      {canShowChartContextMenu && ctxMenu && (
        <div
          style={{
            position: "fixed",
            left: (() => {
              const targetChartId = String(ctxMenu?.chartId || activeChartId || "").trim();
              const rect =
                targetChartId && chartTileRefs.current?.[targetChartId]
                  ? chartTileRefs.current[targetChartId].getBoundingClientRect?.()
                  : null;
              return Math.max(8, Number(rect?.left || 0) + 8);
            })(),
            top: (() => {
              const targetChartId = String(ctxMenu?.chartId || activeChartId || "").trim();
              const rect =
                targetChartId && chartTileRefs.current?.[targetChartId]
                  ? chartTileRefs.current[targetChartId].getBoundingClientRect?.()
                  : null;
              return Math.max(8, Number(rect?.top || 0) + 34);
            })(),
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
              fontSize: 12,
              color: "#94a3b8",
              borderBottom: "1px solid rgba(148,163,184,0.15)",
              fontFamily: "monospace",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 2,
            }}
          >
            <span style={{ whiteSpace: "nowrap" }}>
              {(() => {
                const timeMs = toEpochMs(ctxMenu?.time);
                return timeMs ? showDateTime(timeMs) : "n/a";
              })()}
            </span>
            <span style={{ whiteSpace: "nowrap" }}>
              {(() => {
                const contextualTf = String(ctxMenu?.chartId || activeChartId || "")
                  .split("-")
                  .slice(-1)[0];
                const contextualBars = master?.bars?.[contextualTf] || [];
                const contextualLastClose = Number(
                  contextualBars?.[contextualBars.length - 1]?.close,
                );
                const currentPrice = resolvePreferredTradePrice([
                  contextualLastClose,
                  latestCachedPrice,
                  ctxMenu?.currentPrice,
                ]);
                const clickedPrice = Number.isFinite(Number(ctxMenu?.price))
                  ? Number(ctxMenu.price)
                  : null;
                const precisionSourceValues = [
                  currentPrice,
                  clickedPrice,
                  contextualLastClose,
                ];
                const precision = resolveSymbolTradePricePrecision(
                  cleanSym,
                  [
                    ...contextualBars.flatMap((bar) => [bar?.open, bar?.high, bar?.low, bar?.close]),
                    ...precisionSourceValues,
                  ],
                );
                const clickedText = Number.isFinite(clickedPrice)
                  ? formatTradePriceByPrecision(clickedPrice, precision)
                  : "n/a";
                const currentText = Number.isFinite(currentPrice)
                  ? formatTradePriceByPrecision(currentPrice, precision)
                  : "n/a";
                return `Clicked: ${clickedText}  Current: ${currentText}`;
              })()}
            </span>
          </div>
          {(() => {
            const price = Number(ctxMenu?.price || 0);
            const contextualTf = resolveContextMenuTf(ctxMenu, activeChartId);
            const sourceChartId = String(ctxMenu?.chartId || activeChartId || "");
            const activeTf = sourceChartId.split("-").slice(-1)[0];
            const contextualBars = effectiveBarsByTfForPlans?.[contextualTf] || [];
            const activeBars = master?.bars?.[contextualTf] || master?.bars?.[activeTf] || [];
            const activeLastClose = Number(
              activeBars[activeBars.length - 1]?.close,
            );
            const effectiveCurrentPrice = resolvePreferredTradePrice([
              activeLastClose,
              Number(contextualBars[contextualBars.length - 1]?.close),
              latestCachedPrice,
              ctxMenu?.currentPrice,
            ]);
            const tradePricePrecision = resolveSymbolTradePricePrecision(
              cleanSym,
              [
                ...contextualBars.flatMap((bar) => [bar?.open, bar?.high, bar?.low, bar?.close]),
                price,
                effectiveCurrentPrice,
                activeLastClose,
                latestCachedPrice,
              ],
            );
            const formatTradeMenuPrice = (value) => {
              const numeric = toPositiveTradePlanPrice(value);
              if (numeric == null) return "n/a";
              return formatTradePriceByPrecision(numeric, tradePricePrecision);
            };
            const priceStr = formatTradeMenuPrice(price);
            const menuTfColor = artifactTimeframeColor(ctxMenu?.interval || ctxMenu?.tf || "");
            const pathname =
              typeof window !== "undefined"
                ? String(window.location.pathname || "").trim().toLowerCase()
                : "";
            const tradesNamespaceBase = resolveTradesNamespaceBase(pathname);
            const isAnalyzeRoute =
              pathname.startsWith("/trades/analyze");
            const isManualRoute =
              pathname.startsWith("/trades/manual");
            const quickTradeContext = {
              chartId: sourceChartId,
              price,
              time: ctxMenu?.time || null,
              interval: ctxMenu?.interval || null,
            };
            const suggestionTfs = resolveSuggestedTradeTimeframes(
              activeTf,
              timeframes,
              sharedArtifactItemsByTf,
            );
            const defaultContextTradePlansFromTf = collectDefaultContextTradePlans({
              plansByTf: effectiveTradePlansByTf,
              selectedTfs: suggestionTfs,
              contextualTf: activeTf,
              contextualTimeSec: Number(ctxMenu?.time || 0),
              contextualPrice: price,
              limit: 6,
            });
            const analysisSnapshotTradePlans = Array.isArray(
              effectiveAnalysisSnapshot?.trade_plan,
            )
              ? effectiveAnalysisSnapshot.trade_plan
              : effectiveAnalysisSnapshot?.trade_plan &&
                  typeof effectiveAnalysisSnapshot.trade_plan === "object"
                ? [effectiveAnalysisSnapshot.trade_plan]
                : Array.isArray(analysisSnapshot?.trade_plan)
                  ? analysisSnapshot.trade_plan
                  : analysisSnapshot?.trade_plan &&
                      typeof analysisSnapshot.trade_plan === "object"
                    ? [analysisSnapshot.trade_plan]
                    : [];
            const defaultContextTradePlans =
              defaultContextTradePlansFromTf.length > 0
                ? defaultContextTradePlansFromTf
                : collectDefaultContextTradePlansFromList({
                    plans: analysisSnapshotTradePlans,
                    selectedTfs: suggestionTfs,
                    contextualTf: activeTf,
                    contextualTimeSec: Number(ctxMenu?.time || 0),
                    contextualPrice: price,
                    limit: 6,
                  });
            const currentMarketPrice = resolvePreferredTradePrice([
              effectiveCurrentPrice,
              latestCachedPrice,
            ]);
            const effectiveMarketEntryPrice = Number.isFinite(currentMarketPrice)
              ? currentMarketPrice
              : price;
            const buyLimitSuggestedLevels = buildSuggestedTradeLevels({
              side: "BUY",
              entryPrice: price,
              referencePrice: effectiveMarketEntryPrice,
              activeTf,
              selectedTfs: suggestionTfs,
              artifactItemsByTf: sharedArtifactItemsByTf,
            });
            const sellLimitSuggestedLevels = buildSuggestedTradeLevels({
              side: "SELL",
              entryPrice: price,
              referencePrice: effectiveMarketEntryPrice,
              activeTf,
              selectedTfs: suggestionTfs,
              artifactItemsByTf: sharedArtifactItemsByTf,
            });
            const buyMarketSuggestedLevels = buildSuggestedTradeLevels({
              side: "BUY",
              entryPrice: effectiveMarketEntryPrice,
              referencePrice: effectiveMarketEntryPrice,
              activeTf,
              selectedTfs: suggestionTfs,
              artifactItemsByTf: sharedArtifactItemsByTf,
            });
            const sellMarketSuggestedLevels = buildSuggestedTradeLevels({
              side: "SELL",
              entryPrice: effectiveMarketEntryPrice,
              referencePrice: effectiveMarketEntryPrice,
              activeTf,
              selectedTfs: suggestionTfs,
              artifactItemsByTf: sharedArtifactItemsByTf,
            });
            const buyLimitResolvedSuggestedLevels =
              resolveSuggestedTradeLevelsWithFallback({
                suggested: buyLimitSuggestedLevels,
                requestedSide: "BUY",
                clickedEntryPrice: price,
                currentSide: side,
                currentEntryPrice: entryPrice,
                currentTpPrice: tp1Price ?? tpPrice,
                currentSlPrice: slPrice,
              });
            const sellLimitResolvedSuggestedLevels =
              resolveSuggestedTradeLevelsWithFallback({
                suggested: sellLimitSuggestedLevels,
                requestedSide: "SELL",
                clickedEntryPrice: price,
                currentSide: side,
                currentEntryPrice: entryPrice,
                currentTpPrice: tp1Price ?? tpPrice,
                currentSlPrice: slPrice,
              });
            const buyMarketResolvedSuggestedLevels =
              resolveSuggestedTradeLevelsWithFallback({
                suggested: buyMarketSuggestedLevels,
                requestedSide: "BUY",
                clickedEntryPrice: effectiveMarketEntryPrice,
                currentSide: side,
                currentEntryPrice: entryPrice,
                currentTpPrice: tp1Price ?? tpPrice,
                currentSlPrice: slPrice,
              });
            const sellMarketResolvedSuggestedLevels =
              resolveSuggestedTradeLevelsWithFallback({
                suggested: sellMarketSuggestedLevels,
                requestedSide: "SELL",
                clickedEntryPrice: effectiveMarketEntryPrice,
                currentSide: side,
                currentEntryPrice: entryPrice,
                currentTpPrice: tp1Price ?? tpPrice,
                currentSlPrice: slPrice,
              });
            const buyLimitSuggestedTp = toPositiveTradePlanPrice(
              buyLimitResolvedSuggestedLevels.tp,
            );
            const buyLimitSuggestedSl = toPositiveTradePlanPrice(
              buyLimitResolvedSuggestedLevels.sl,
            );
            const sellLimitSuggestedTp = toPositiveTradePlanPrice(
              sellLimitResolvedSuggestedLevels.tp,
            );
            const sellLimitSuggestedSl = toPositiveTradePlanPrice(
              sellLimitResolvedSuggestedLevels.sl,
            );
            const buyMarketSuggestedTp = toPositiveTradePlanPrice(
              buyMarketResolvedSuggestedLevels.tp,
            );
            const buyMarketSuggestedSl = toPositiveTradePlanPrice(
              buyMarketResolvedSuggestedLevels.sl,
            );
            const sellMarketSuggestedTp = toPositiveTradePlanPrice(
              sellMarketResolvedSuggestedLevels.tp,
            );
            const sellMarketSuggestedSl = toPositiveTradePlanPrice(
              sellMarketResolvedSuggestedLevels.sl,
            );
            const drawToolItems = [
              { label: "Line", color: menuTfColor, fn: handleDrawLine },
              { label: "Segment", color: menuTfColor, fn: handleDrawSegment },
              {
                label: "Zone",
                color: "#22c55e",
                fn: () => addObject("ZONE", "#22c55e", "zone"),
              },
            ];
            const ENTRY_MENU_COLOR = ENTRY_PLAN_COLOR;
            const suggestedEntryPrice = price;
            const suggestedTpPrice = buyLimitSuggestedTp;
            const suggestedSlPrice = buyLimitSuggestedSl;
            const displayedStrategyScanPlans = Array.isArray(menuStrategyScanState?.plans)
              ? menuStrategyScanState.plans.slice(
                  0,
                  Math.max(0, Number(menuStrategyScanState?.visibleCount) || 0),
                )
              : [];
            const applyDefaultMenuPlanSelection = (plan) => {
              const direction =
                String(plan?.direction || plan?.side || plan?.action || "")
                  .trim()
                  .toUpperCase() === "SELL"
                  ? "SELL"
                  : "BUY";
              const entry = toPositiveTradePlanPrice(plan?.entry ?? plan?.entry_price);
              const tp = toPositiveTradePlanPrice(plan?.tp ?? plan?.tp_price);
              const sl = toPositiveTradePlanPrice(plan?.sl ?? plan?.sl_price);
              const tradeType =
                String(plan?.trade_type || plan?.order_type || "limit")
                  .trim()
                  .toLowerCase() === "market"
                  ? "market"
                  : "limit";
              if (typeof onQuickTradeIntent === "function" && isManualRoute) {
                onQuickTradeIntent({
                  symbol: cleanSym,
                  side: direction,
                  action: "ENTRY",
                  plan_id: activePlanGroup,
                  price: entry,
                  tp,
                  sl,
                  trade_type: tradeType,
                  price_precision: tradePricePrecision,
                  time: ctxMenu?.time || null,
                  interval: String(plan?._menu_tf || plan?.tf || activeTf || "").trim(),
                  source_id: "auto_chart",
                  source: "auto_chart",
                  strategy: sanitizeChartText(
                    plan?.strategy_name || plan?.strategy || "",
                  ),
                  entry_model: sanitizeChartText(
                    plan?.entry_model || plan?.entryModel || "",
                  ),
                  rule_name: sanitizeChartText(
                    plan?.rule_name || plan?.event_name || "",
                  ),
                });
                setCtxMenu(null);
                return;
              }
              if (typeof window === "undefined") return;
              const search = new URLSearchParams();
              search.set("direction", direction);
              if (entry != null) search.set("entry", String(entry));
              if (tp != null) search.set("tp", String(tp));
              if (sl != null) search.set("sl", String(sl));
              search.set("trade_type", tradeType);
              search.set("price_precision", String(tradePricePrecision));
              search.set(
                "chart_tf",
                String(plan?._menu_tf || plan?.tf || activeTf || "").trim(),
              );
              search.set("source_id", "auto_chart");
              const strategyName = sanitizeChartText(
                plan?.strategy_name || plan?.strategy || "",
              );
              if (strategyName) {
                search.set(
                  "strategy",
                  strategyName,
                );
              }
              const entryModel = sanitizeChartText(
                plan?.entry_model || plan?.entryModel || "",
              );
              if (entryModel) {
                search.set(
                  "entry_model",
                  entryModel,
                );
              }
              window.location.href = `${tradesNamespaceBase}/manual/${encodeURIComponent(
                String(cleanSym || "").toUpperCase(),
              )}?${search.toString()}#chart-analysis`;
            };
            const hasMoreStrategyScanPlans =
              Array.isArray(menuStrategyScanState?.plans) &&
              menuStrategyScanState.plans.length >
                Math.max(0, Number(menuStrategyScanState?.visibleCount) || 0);
            const applyScannedPlanSelection = (plan) => {
              if (!plan) return;
              const direction = String(plan?.direction || "BUY").trim().toUpperCase();
              const tradeType =
                String(plan?.type || plan?.trade_type || "market").trim().toLowerCase() ===
                "limit"
                  ? "limit"
                  : "market";
              const entry = toPositiveTradePlanPrice(plan?.entry);
              const tp = toPositiveTradePlanPrice(plan?.tp);
              const sl = toPositiveTradePlanPrice(plan?.sl);
              if (typeof onQuickTradeIntent === "function") {
                onQuickTradeIntent({
                  symbol: cleanSym,
                  side: direction === "SELL" ? "SELL" : "BUY",
                  action: "ENTRY",
                  plan_id: activePlanGroup,
                  price: entry,
                  tp,
                  sl,
                  trade_type: tradeType,
                  price_precision: tradePricePrecision,
                  time: ctxMenu?.time || null,
                  interval: String(plan?._scan_tf || plan?.tf || contextualTf || "").trim(),
                  source_id: "auto_chart",
                  source: "auto_chart",
                  strategy: sanitizeChartText(
                    plan?.strategy_name || plan?.strategy || "",
                  ),
                  entry_model: "scan",
                  rule_name: sanitizeChartText(
                    plan?.rule_name || plan?.event_name || "",
                  ),
                });
                setCtxMenu(null);
                return;
              }
              if (typeof window === "undefined") return;
              const search = new URLSearchParams();
              search.set("direction", direction === "SELL" ? "SELL" : "BUY");
              if (entry != null) {
                search.set("entry", String(entry));
              }
              if (tp != null) {
                search.set("tp", String(tp));
              }
              if (sl != null) {
                search.set("sl", String(sl));
              }
              search.set("trade_type", tradeType);
              search.set("price_precision", String(tradePricePrecision));
              search.set(
                "chart_tf",
                String(plan?._scan_tf || plan?.tf || contextualTf || "").trim(),
              );
              search.set("source_id", "auto_chart");
              const scannedStrategyName = sanitizeChartText(
                plan?.strategy_name || plan?.strategy || "",
              );
              if (scannedStrategyName) {
                search.set(
                  "strategy",
                  scannedStrategyName,
                );
              }
              search.set("entry_model", "scan");
              window.location.href = `${tradesNamespaceBase}/manual/${encodeURIComponent(
                String(cleanSym || "").toUpperCase(),
              )}?${search.toString()}#chart-analysis`;
            };
            const buildTradeActionPayload = (actionSide, actionTradeType = "limit") => {
              const normalizedSide = String(actionSide || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
              const isMarketTrade = actionTradeType === "market";
              return {
                side: normalizedSide,
                tradeType: isMarketTrade ? "market" : "limit",
                entry: isMarketTrade ? effectiveMarketEntryPrice : price,
                tp: isMarketTrade
                  ? normalizedSide === "SELL"
                    ? sellMarketSuggestedTp
                    : buyMarketSuggestedTp
                  : normalizedSide === "SELL"
                    ? sellLimitSuggestedTp
                    : buyLimitSuggestedTp,
                sl: isMarketTrade
                  ? normalizedSide === "SELL"
                    ? sellMarketSuggestedSl
                    : buyMarketSuggestedSl
                  : normalizedSide === "SELL"
                    ? sellLimitSuggestedSl
                    : buyLimitSuggestedSl,
              };
            };
            const marketTradeActions = [
              {
                key: "buy-market",
                side: "BUY",
                tradeType: "market",
                fn: () =>
                  handleQuickTrade("BUY", effectiveMarketEntryPrice, {
                    ...quickTradeContext,
                    price: effectiveMarketEntryPrice,
                  }, {
                    trade_type: "market",
                    price_precision: tradePricePrecision,
                  }),
              },
              {
                key: "sell-market",
                side: "SELL",
                tradeType: "market",
                fn: () =>
                  handleQuickTrade("SELL", effectiveMarketEntryPrice, {
                    ...quickTradeContext,
                    price: effectiveMarketEntryPrice,
                  }, {
                    trade_type: "market",
                    price_precision: tradePricePrecision,
                  }),
              },
            ];
            const limitTradeActions = [
              {
                key: "buy-limit",
                side: "BUY",
                tradeType: "limit",
                fn: () =>
                  handleQuickTrade("BUY", price, quickTradeContext, {
                    trade_type: "limit",
                    price_precision: tradePricePrecision,
                  }),
              },
              {
                key: "sell-limit",
                side: "SELL",
                tradeType: "limit",
                fn: () =>
                  handleQuickTrade("SELL", price, quickTradeContext, {
                    trade_type: "limit",
                    price_precision: tradePricePrecision,
                  }),
              },
            ];
            const manualTradeActions = [
              {
                key: "entry",
                buttonLabel: "Entry",
                label: `Entry @ ${formatTradeMenuPrice(suggestedEntryPrice)}`,
                fn: () => {
                  const p = suggestedEntryPrice;
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
              ...[
                { key: "tp1", actionKey: "TP1", buttonLabel: "TP" },
                { key: "tp2", actionKey: "TP2", buttonLabel: "TP2" },
                { key: "tp3", actionKey: "TP3", buttonLabel: "TP3" },
              ].map(({ key, actionKey, buttonLabel }) => ({
                key,
                buttonLabel,
                label: `${actionKey} @ ${formatTradeMenuPrice(suggestedTpPrice)}`,
                fn: () => {
                  const p = suggestedTpPrice;
                  if (typeof onPlanLevelChange === "function") {
                    onPlanLevelChange(key, p);
                  }
                  if (typeof onQuickTradeIntent === "function") {
                    onQuickTradeIntent({
                      symbol: cleanSym,
                      side: actionKey,
                      action: actionKey,
                      plan_id: activePlanGroup,
                      price: p,
                    });
                  }
                  setCtxMenu(null);
                },
              })),
              {
                key: "sl",
                buttonLabel: "SL",
                label: `SL @ ${formatTradeMenuPrice(suggestedSlPrice)}`,
                fn: () => {
                  const p = suggestedSlPrice;
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
            ];
            const levelTradeActions = manualTradeActions;
            const renderTradeActionButton = (item) => {
              const payload = buildTradeActionPayload(item.side, item.tradeType);
              const isSell = payload.side === "SELL";
              const tradeLabel = `${payload.side === "SELL" ? "S" : "B"} ${
                payload.tradeType === "market" ? "mkt" : "lmt"
              }`;
              return (
                <button
                  key={item.key}
                  ref={applyOverlayTradeButtonImportantStyle}
                  type="button"
                  onClick={item.fn}
                  title={`Apply ${payload.side} ${payload.tradeType}`}
                  style={{
                    textAlign: "left",
                    background: "rgba(255,255,255,0.02)",
                    color: isSell ? "#ef4444" : "#10b981",
                    border: "1px solid rgba(148,163,184,0.14)",
                    borderRadius: 6,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    justifyContent: "center",
                    gap: 2,
                    padding: "4px 6px",
                    fontSize: 9,
                    fontWeight: 500,
                    lineHeight: 1.15,
                  }}
                >
                  <span style={{ color: isSell ? "#ef4444" : "#10b981", flex: "0 0 auto" }}>
                    {tradeLabel}
                  </span>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      flexWrap: "wrap",
                      fontSize: 8,
                      fontWeight: 500,
                      whiteSpace: "normal",
                    }}
                  >
                    <span style={{ color: ENTRY_MENU_COLOR }}>
                      {formatTradeMenuPrice(payload.entry)}
                    </span>
                    <span style={{ color: "rgba(226,232,240,0.58)" }}>-&gt;</span>
                    <span style={{ color: TP_PLAN_COLOR }}>
                      {formatTradeMenuPrice(payload.tp)}
                    </span>
                    <span style={{ color: "rgba(226,232,240,0.58)" }}>/</span>
                    <span style={{ color: SL_PLAN_COLOR }}>
                      {formatTradeMenuPrice(payload.sl)}
                    </span>
                  </span>
                </button>
              );
            };
            return (
              <div style={{ padding: 6, display: "grid", gap: 4 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 4,
                  }}
                >
                  {drawToolItems.map((it) => (
                    <button
                      key={it.label}
                      ref={applyOverlayButtonImportantStyle}
                      type="button"
                      onClick={it.fn}
                      title={`Add ${it.label} to the current chart`}
                      style={{
                        textAlign: "left",
                        background: "rgba(255,255,255,0.02)",
                        color: "#e2e8f0",
                        border: "1px solid rgba(148,163,184,0.14)",
                        borderRadius: 6,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "3px 5px",
                        fontSize: 6,
                        fontWeight: 400,
                        lineHeight: 1.05,
                      }}
                    >
                      <span
                        style={{
                          width: 12,
                          height: it.label === "Zone" ? 8 : 2,
                          borderRadius: 2,
                          border: `1px solid ${it.color}`,
                          background:
                            it.label === "Zone" ? `${it.color}33` : it.color,
                          display: "inline-block",
                          flex: "0 0 auto",
                        }}
                      />
                      <span>{it.label}</span>
                    </button>
                  ))}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                    gap: 4,
                  }}
                >
                  {levelTradeActions.map((it) => (
                    <button
                      key={it.key}
                      ref={applyOverlayButtonImportantStyle}
                      type="button"
                      onClick={it.fn}
                      title={it.label}
                      style={{
                        textAlign: "center",
                        background: "rgba(255,255,255,0.02)",
                        color:
                          it.key === "entry"
                            ? ENTRY_MENU_COLOR
                            : String(it.key).startsWith("tp")
                              ? TP_PLAN_COLOR
                              : SL_PLAN_COLOR,
                        border: "1px solid rgba(148,163,184,0.14)",
                        borderRadius: 6,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "2px 3px",
                        fontSize: 6,
                        fontWeight: 400,
                        lineHeight: 1.05,
                      }}
                    >
                      {it.buttonLabel}
                    </button>
                  ))}
                </div>

                {marketTradeActions.length > 0 && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: `repeat(${Math.max(
                          1,
                          marketTradeActions.length,
                        )}, minmax(0, 1fr))`,
                        gap: 4,
                      }}
                    >
                      {marketTradeActions.map(renderTradeActionButton)}
                    </div>
                  )}

                {limitTradeActions.length > 0 && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: `repeat(${Math.max(
                          1,
                          limitTradeActions.length,
                        )}, minmax(0, 1fr))`,
                        gap: 4,
                      }}
                    >
                      {limitTradeActions.map(renderTradeActionButton)}
                    </div>
                  )}
                {defaultContextTradePlans.length > 0 && (
                  <div style={{ display: "grid", gap: 4 }}>
                    {defaultContextTradePlans.map((plan) => {
                      const isSell =
                        String(plan?.direction || "").trim().toUpperCase() === "SELL";
                      return (
                        <button
                          key={String(
                            plan?.id ||
                              `${plan?.strategy_id || ""}-${plan?.event_id || ""}-${plan?._menu_tf || ""}-${plan?._menu_index || 0}`,
                          )}
                          ref={applyOverlayButtonImportantStyle}
                          type="button"
                          title={
                            joinChartText(
                              [
                                plan?.strategy_name || plan?.strategy || "",
                                String(plan?._menu_tf || plan?.tf || "")
                                  .trim()
                                  .toUpperCase(),
                              ],
                              " / ",
                            ) || undefined
                          }
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            minWidth: 0,
                            padding: "3px 5px",
                            background: "rgba(255,255,255,0.02)",
                            border: "1px solid rgba(148,163,184,0.14)",
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: 400,
                            lineHeight: 1.15,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                          onClick={() => applyDefaultMenuPlanSelection(plan)}
                        >
                          <span
                            style={{
                              color: isSell ? "#ef4444" : "#10b981",
                              flex: "0 1 auto",
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {sanitizeChartText(plan?.strategy_name || plan?.strategy || "")}
                          </span>
                          <span style={{ color: ENTRY_MENU_COLOR, flex: "0 0 auto" }}>
                            {formatTradeMenuPrice(plan?.entry)}
                          </span>
                          <span style={{ color: TP_PLAN_COLOR, flex: "0 0 auto" }}>
                            {formatTradeMenuPrice(plan?.tp)}
                          </span>
                          <span style={{ color: SL_PLAN_COLOR, flex: "0 0 auto" }}>
                            {formatTradeMenuPrice(plan?.sl)}
                          </span>
                          <span
                            style={{
                              color: "#94a3b8",
                              fontSize: 10,
                              fontWeight: 400,
                              flex: "0 0 auto",
                            }}
                          >
                            {String(plan?._menu_tf || plan?.tf || "").trim().toUpperCase()}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div style={{ display: "grid", gap: 4, paddingTop: 2 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      gap: 4,
                    }}
                  >
                    <button
                      ref={applyOverlayButtonImportantStyle}
                      type="button"
                      onClick={handleScanMenuStrategies}
                      disabled={menuStrategyScanState?.status === "loading"}
                      style={{
                        textAlign: "center",
                        background: "rgba(255,255,255,0.02)",
                        color: "#e2e8f0",
                        border: "1px solid rgba(148,163,184,0.14)",
                        borderRadius: 6,
                        cursor:
                          menuStrategyScanState?.status === "loading"
                            ? "progress"
                            : "pointer",
                        padding: "3px 5px",
                        fontSize: 10,
                        fontWeight: 400,
                        lineHeight: 1.15,
                      }}
                    >
                      {menuStrategyScanState?.status === "loading"
                        ? "Scanning Strategies..."
                        : "Scan Strategies"}
                    </button>
                    <button
                      ref={applyOverlayButtonImportantStyle}
                      type="button"
                      onClick={() => setCtxMenu(null)}
                      aria-label="Close menu"
                      title="Close"
                      style={{
                        textAlign: "center",
                        background: "rgba(255,255,255,0.02)",
                        color: "#94a3b8",
                        border: "1px solid rgba(148,163,184,0.14)",
                        borderRadius: 6,
                        cursor: "pointer",
                        padding: "3px 6px",
                        fontSize: 10,
                        fontWeight: 400,
                        lineHeight: 1.15,
                        minWidth: 28,
                      }}
                    >
                      X
                    </button>
                  </div>
                  {menuStrategyScanState?.status === "done" &&
                    displayedStrategyScanPlans.length > 0 && (
                      <div style={{ display: "grid", gap: 4 }}>
                        {displayedStrategyScanPlans.map((plan) => {
                          const isSell =
                            String(plan?.direction || "").trim().toUpperCase() === "SELL";
                          return (
                            <button
                              key={String(
                                plan?.id ||
                                  `${plan?.strategy_id || ""}-${plan?.event_id || ""}`,
                              )}
                              ref={applyOverlayButtonImportantStyle}
                              type="button"
                              title={
                                joinChartText(
                                  [
                                    plan?.strategy_name || plan?.strategy || "",
                                    plan?.rule_name || plan?.event_name || plan?.condition || "",
                                  ],
                                  " / ",
                                ) || undefined
                              }
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                                minWidth: 0,
                                padding: "3px 5px",
                                background: "rgba(255,255,255,0.02)",
                                border: "1px solid rgba(148,163,184,0.14)",
                                borderRadius: 6,
                                fontSize: 10,
                                fontWeight: 400,
                                lineHeight: 1.15,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                cursor: "pointer",
                              }}
                              onClick={() => applyScannedPlanSelection(plan)}
                            >
                              <span
                                style={{
                                  color: isSell ? "#ef4444" : "#10b981",
                                  flex: "0 1 auto",
                                  minWidth: 0,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {sanitizeChartText(plan?.strategy_name || plan?.strategy || "")}
                              </span>
                              <span style={{ color: ENTRY_MENU_COLOR, flex: "0 0 auto" }}>
                                {formatTradeMenuPrice(plan?.entry)}
                              </span>
                              <span style={{ color: TP_PLAN_COLOR, flex: "0 0 auto" }}>
                                {formatTradeMenuPrice(plan?.tp)}
                              </span>
                              <span style={{ color: SL_PLAN_COLOR, flex: "0 0 auto" }}>
                                {formatTradeMenuPrice(plan?.sl)}
                              </span>
                              <span
                                style={{
                                  color: "#94a3b8",
                                  fontSize: 10,
                                  fontWeight: 400,
                                  flex: "0 0 auto",
                                }}
                              >
                                {String(
                                  plan?._scan_tf || plan?.tf || plan?.timeframe || "",
                                )
                                  .trim()
                                  .toUpperCase()}
                              </span>
                            </button>
                          );
                        })}
                        {hasMoreStrategyScanPlans && (
                          <button
                            ref={applyOverlayButtonImportantStyle}
                            type="button"
                            onClick={handleLoadMoreMenuStrategies}
                            style={{
                              textAlign: "center",
                              background: "rgba(255,255,255,0.02)",
                              color: "#94a3b8",
                              border: "1px solid rgba(148,163,184,0.14)",
                              borderRadius: 6,
                              cursor: "pointer",
                              padding: "3px 5px",
                              fontSize: 10,
                              fontWeight: 400,
                              lineHeight: 1.15,
                            }}
                          >
                            Load More
                          </button>
                        )}
                      </div>
                    )}
                  {menuStrategyScanState?.status === "done" &&
                    !displayedStrategyScanPlans.length && (
                      <div
                        style={{
                          fontSize: 10,
                          color: "#64748b",
                          padding: "3px 5px",
                          border: "1px dashed rgba(148,163,184,0.18)",
                          borderRadius: 6,
                          lineHeight: 1.15,
                        }}
                      >
                        No strategy match at this candle.
                      </div>
                    )}
                </div>
              </div>
            );
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
