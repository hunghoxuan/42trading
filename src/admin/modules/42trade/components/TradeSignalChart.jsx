import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as LightweightCharts from "lightweight-charts";
import { api } from "../../../app/api";
import {
  asNumValue,
  formatChartDateTime,
  getEffectiveDisplayTimezone,
  resolveDisplayTimezone,
} from "../../../shared/utils/format";
import { chartFetchManager } from "../services/chartFetchManager";
import { normalizePlanLinePrice } from "../../../shared/utils/tradePlanDrafts";
import { getUiThemeColors } from "../../../shared/utils/uiTheme";
import {
  BACKTEST_CHART_THEME,
  buildTradeCreatedLabel,
  buildTradeCloseLabel,
  buildTradeOpenedLabel,
  computePriceBoundsFromBars,
  findTradeBarIndexForEpochSec,
  inferTradeSide,
  isPriceCompatibleWithBarBounds,
  normalizeTradeRowsForChart,
  resolveTradeFocusedWindow,
  resolveTradeBadgeMeta,
  resolveClosedTradeLineStyle,
  resolveTradeCloseDisplayPrice,
  resolveTradeLevelRLabel,
  resolveTradeLinePalette,
  resolveTradeMarkerPresentation,
} from "./charts/backtestChartTheme";
import {
  KILL_ZONE_WINDOWS_UTC,
  SESSION_WINDOWS_UTC,
} from "./sessionTimeWindows";

const {
  createChart,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  HistogramSeries,
  CandlestickSeries,
} =
  LightweightCharts;

const INDICATOR_LINE_STYLE = {
  dotted: LineStyle.Dotted,
  width: 1.2,
  accentWidth: 1,
  histogramWidth: 1,
  colors: {
    sma20: "rgba(96, 165, 250, 0.28)",
    sma50: "rgba(249, 115, 22, 0.26)",
    sma200: "rgba(34, 197, 94, 0.24)",
    ema20: "rgba(56, 189, 248, 0.36)",
    ema50: "rgba(251, 113, 133, 0.32)",
    ema200: "rgba(132, 204, 22, 0.28)",
    vwap: "rgba(14, 165, 233, 0.28)",
    bbMid: "rgba(148, 163, 184, 0.24)",
    bbUpper: "rgba(244, 114, 182, 0.22)",
    bbLower: "rgba(244, 114, 182, 0.22)",
    ichiTenkan: "rgba(239, 68, 68, 0.26)",
    ichiKijun: "rgba(37, 99, 235, 0.26)",
    ichiSpanA: "rgba(34, 197, 94, 0.2)",
    ichiSpanB: "rgba(245, 158, 11, 0.2)",
    ichiChikou: "rgba(168, 85, 247, 0.16)",
    zigzag: "rgba(250, 204, 21, 0.62)",
    rsi: "rgba(168, 85, 247, 0.24)",
    rsiEma9: "rgba(250, 204, 21, 0.22)",
    rsiWma45: "rgba(52, 211, 153, 0.22)",
    stochK: "rgba(59, 130, 246, 0.26)",
    stochD: "rgba(245, 158, 11, 0.26)",
    macd: "rgba(34, 197, 94, 0.26)",
    macdSignal: "rgba(239, 68, 68, 0.26)",
    macdHistogramUp: "rgba(34, 197, 94, 0.32)",
    macdHistogramDown: "rgba(239, 68, 68, 0.32)",
    levelMain: "rgba(168, 85, 247, 0.3)",
    levelMid: "rgba(226, 232, 240, 0.22)",
  },
};

const RSI_PANE_HEIGHT = 72;
const MACD_PANE_HEIGHT = 68;
const TRADINGVIEW_CHART_URL = "https://www.tradingview.com/chart/N6SBLK6M/";
const CHART_FETCH_ERROR_LOG_THROTTLE_MS = 15000;
const recentChartFetchErrorLogs = new Map();
const TRADE_MARKER_YELLOW = "#facc15";
const COMPACT_VIEWPORT_MIN_BARS = 50;
const COMPACT_VIEWPORT_STEP_BARS = 50;
const COMPACT_VIEWPORT_DEFAULT_BARS = 50;
const SHOW_ALL_LOADED_VIEWPORT_MAX_BARS = 2000;
const ARTIFACT_LINE_DASH = [1.5, 3.5];
const ARTIFACT_LINE_WIDTH = 0.2;
const ARTIFACT_ZONE_LINE_WIDTH = 0.18;
const ARTIFACT_LABEL_FONT_SIZE = 9;
const TRADE_ENTRY_VIBRANT = "#22d3ee";
const TRADE_TP_DARK = "#166534";
const TRADE_SL_DARK = "#7f1d1d";
const TIMELINE_TRADE_ACTIVE_REWARD_FILL = "rgba(34, 197, 94, 0.08)";
const TIMELINE_TRADE_ACTIVE_RISK_FILL = "rgba(239, 68, 68, 0.07)";
const TIMELINE_TRADE_PENDING_REWARD_FILL = "rgba(59, 130, 246, 0.08)";
const TIMELINE_TRADE_PENDING_RISK_FILL = "rgba(245, 158, 11, 0.08)";
const PLAN_COLORS = {
  buy: {
    entry: TRADE_ENTRY_VIBRANT,
    entryMuted: "rgba(34, 211, 238, 0.58)",
    tp: TRADE_TP_DARK,
    tpMuted: "rgba(22, 101, 52, 0.68)",
    sl: TRADE_SL_DARK,
    slMuted: "rgba(127, 29, 29, 0.68)",
  },
  sell: {
    entry: TRADE_ENTRY_VIBRANT,
    entryMuted: "rgba(34, 211, 238, 0.58)",
    tp: TRADE_TP_DARK,
    tpMuted: "rgba(22, 101, 52, 0.68)",
    sl: TRADE_SL_DARK,
    slMuted: "rgba(127, 29, 29, 0.68)",
  },
};

function shouldLogArtifactZoneDebug() {
  try {
    if (typeof window === "undefined") return false;
    if (window.__DEBUG_ARTIFACT_ZONES__ === true) return true;
    return window.localStorage?.getItem("debug_artifact_zones") === "1";
  } catch {
    return false;
  }
}

const parsePosNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function normalizeBrokerHistoryBars(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((bar) => ({
      time: Number(bar?.t ?? bar?.time),
      open: Number(bar?.o ?? bar?.open),
      high: Number(bar?.h ?? bar?.high),
      low: Number(bar?.l ?? bar?.low),
      close: Number(bar?.c ?? bar?.close),
      volume: Number(bar?.v ?? bar?.volume ?? 0),
    }))
    .filter(
      (bar) =>
        Number.isFinite(bar.time) &&
        Number.isFinite(bar.open) &&
        Number.isFinite(bar.high) &&
        Number.isFinite(bar.low) &&
        Number.isFinite(bar.close),
    )
    .sort((left, right) => left.time - right.time);
}

const samePriceWithinTolerance = (a, b, precision = 4) => {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const safePrecision = Math.max(0, Math.min(8, Number(precision) || 0));
  const epsilon = 1 / 10 ** (safePrecision + 2);
  return Math.abs(left - right) <= epsilon;
};

function shouldLogChartFetchError(errorKey = "") {
  const key = String(errorKey || "").trim();
  if (!key) return true;
  const now = Date.now();
  const lastLoggedAt = Number(recentChartFetchErrorLogs.get(key) || 0);
  if (Number.isFinite(lastLoggedAt) && now - lastLoggedAt < CHART_FETCH_ERROR_LOG_THROTTLE_MS) {
    return false;
  }
  recentChartFetchErrorLogs.set(key, now);
  if (recentChartFetchErrorLogs.size > 200) {
    for (const [entryKey, loggedAt] of recentChartFetchErrorLogs.entries()) {
      if (now - Number(loggedAt || 0) > CHART_FETCH_ERROR_LOG_THROTTLE_MS * 4) {
        recentChartFetchErrorLogs.delete(entryKey);
      }
    }
  }
  return true;
}

function compactAxisLabel(date, timezone, options) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    ...options,
  }).format(date);
}

function toTradingViewInterval(tfRaw) {
  const tf = String(tfRaw || "").trim().toLowerCase();
  if (tf === "1m") return "1";
  if (tf === "3m") return "3";
  if (tf === "5m") return "5";
  if (tf === "15m") return "15";
  if (tf === "30m") return "30";
  if (tf === "45m") return "45";
  if (tf === "1h") return "60";
  if (tf === "2h") return "120";
  if (tf === "4h") return "240";
  if (tf === "1d" || tf === "d") return "D";
  if (tf === "1w" || tf === "w") return "W";
  if (tf === "1mth" || tf === "m") return "M";
  return "60";
}

function displayIntervalLabel(tfRaw) {
  const tf = String(tfRaw || "").trim().toLowerCase();
  if (tf === "1" || tf === "1m") return "1m";
  if (tf === "3" || tf === "3m") return "3m";
  if (tf === "5" || tf === "5m") return "5m";
  if (tf === "15" || tf === "15m") return "15m";
  if (tf === "30" || tf === "30m") return "30m";
  if (tf === "45" || tf === "45m") return "45m";
  if (tf === "60" || tf === "1h") return "1h";
  if (tf === "120" || tf === "2h") return "2h";
  if (tf === "240" || tf === "4h") return "4h";
  if (tf === "1d" || tf === "d") return "1d";
  if (tf === "1w" || tf === "w") return "1w";
  return String(tfRaw || "");
}

function artifactPaletteColorForTf(tfRaw = "") {
  const label = displayIntervalLabel(tfRaw);
  if (label === "1d") return "#facc15";
  if (label === "4h") return "#a855f7";
  if (label === "1h") return "#60a5fa";
  if (label === "15m") return "#3b82f6";
  if (label === "5m") return "#9ca3af";
  if (label === "1m") return "#6b7280";
  return "#94a3b8";
}

function withAlpha(color, alphaHex = "22", fallback = "rgba(148, 163, 184, 0.14)") {
  const value = String(color || "").trim();
  const alpha = String(alphaHex || "22").trim();
  if (/^#[0-9a-f]{6}$/i.test(value) && /^[0-9a-f]{2}$/i.test(alpha)) {
    return `${value}${alpha}`;
  }
  if (/^#[0-9a-f]{8}$/i.test(value) && /^[0-9a-f]{2}$/i.test(alpha)) {
    return `${value.slice(0, 7)}${alpha}`;
  }
  return fallback;
}

function intervalToSeconds(tfRaw) {
  const tf = String(tfRaw || "").trim().toLowerCase();
  if (tf === "1" || tf === "1m") return 60;
  if (tf === "3" || tf === "3m") return 180;
  if (tf === "5" || tf === "5m") return 300;
  if (tf === "15" || tf === "15m") return 900;
  if (tf === "30" || tf === "30m") return 1800;
  if (tf === "45" || tf === "45m") return 2700;
  if (tf === "60" || tf === "1h") return 3600;
  if (tf === "120" || tf === "2h") return 7200;
  if (tf === "240" || tf === "4h") return 14400;
  if (tf === "1d" || tf === "d") return 86400;
  if (tf === "1w" || tf === "w") return 604800;
  return 60;
}

function toTradingViewSymbol(symbolRaw, provider = "") {
  const symbol = String(symbolRaw || "").trim().toUpperCase();
  if (!symbol) return "";
  if (symbol.includes(":")) return symbol;
  const normalizedProvider = String(provider || "").trim().toUpperCase();
  return normalizedProvider ? `${normalizedProvider}:${symbol}` : symbol;
}

function formatChronosAxisTime(val, timezone, intervalRaw = "1h") {
  if (!val) return "-";
  const date = new Date(val);
  if (Number.isNaN(date.getTime())) return String(val);
  const tz =
    String(timezone || "").trim() === "Local"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      : String(timezone || "UTC").trim();
  const interval = String(intervalRaw || "").trim().toLowerCase();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const getPart = (type) => parts.find((part) => part.type === type)?.value || "";
  const dd = getPart("day");
  const mm = getPart("month");
  const yyyy = getPart("year");
  const hh = getPart("hour");
  const min = getPart("minute");
  if (interval === "1d" || interval === "d") return `${dd}.${mm}`;
  if (interval === "1w" || interval === "w") return `${dd}.${mm}.${yyyy}`;
  if (interval === "4h" || interval === "2h" || interval === "1h") {
    return `${dd}.${mm} ${hh}:${min}`;
  }
  return `${hh}:${min}`;
}

function formatTradingViewLikeTickMark(time, tickMarkType, locale, timezone) {
  const millis = Number(time) * 1000;
  if (!Number.isFinite(millis) || millis <= 0) return null;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;
  const tz =
    String(timezone || "").trim() === "Local"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      : String(timezone || "UTC").trim();
  if (tickMarkType === LightweightCharts.TickMarkType.Year) {
    return compactAxisLabel(date, tz, { year: "numeric" });
  }
  if (tickMarkType === LightweightCharts.TickMarkType.Month) {
    return compactAxisLabel(date, tz, { month: "short" });
  }
  if (tickMarkType === LightweightCharts.TickMarkType.DayOfMonth) {
    return compactAxisLabel(date, tz, { day: "numeric" });
  }
  if (tickMarkType === LightweightCharts.TickMarkType.TimeWithSeconds) {
    return compactAxisLabel(date, tz, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }
  return compactAxisLabel(date, tz, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function parseSnapshotBars(snapshot) {
  const bars = Array.isArray(snapshot?.bars) ? snapshot.bars : [];
  return bars
    .map((x) => {
      const t = Number(x?.time);
      const o = Number(x?.open);
      const h = Number(x?.high);
      const l = Number(x?.low);
      const c = Number(x?.close);
      if (
        !Number.isFinite(t) ||
        !Number.isFinite(o) ||
        !Number.isFinite(h) ||
        !Number.isFinite(l) ||
        !Number.isFinite(c)
      )
        return null;
      return { time: t, open: o, high: h, low: l, close: c };
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

// Guard against malformed bars from any source (historical prop, snapshot, TwelveData).
// lightweight-charts requires valid time on every bar; invalid time causes crash.
// Also normalizes broker bar field names ({t,o,h,l,c} -> {time,open,high,low,close}).
function ensureValidBars(bars, minBars) {
  if (!Array.isArray(bars)) return [];
  const numericBarsByTime = new Map();
  const businessDayBars = [];
  for (const b of bars) {
    if (b == null || typeof b !== "object") continue;
    const rawTime = b?.time ?? b?.t;
    const rawOpen = b?.open ?? b?.o;
    const rawHigh = b?.high ?? b?.h;
    const rawLow = b?.low ?? b?.l;
    const rawClose = b?.close ?? b?.c;
    const t = Number(rawTime);
    const o = Number(rawOpen);
    const h = Number(rawHigh);
    const l = Number(rawLow);
    const c = Number(rawClose);
    const v = Number(b?.volume ?? b?.v ?? 0);
    if (!Number.isFinite(t) || t <= 0) {
      // check for BusinessDay object
      if (typeof rawTime === "object" && rawTime !== null) {
        if (Number.isFinite(Number(rawTime.year)) && Number.isFinite(Number(rawTime.month)) && Number.isFinite(Number(rawTime.day))) {
          if (
            Number.isFinite(o) &&
            Number.isFinite(h) &&
            Number.isFinite(l) &&
            Number.isFinite(c)
          ) {
            businessDayBars.push({
              time: rawTime,
              open: o,
              high: h,
              low: l,
              close: c,
              volume: Number.isFinite(v) ? v : 0,
            });
          }
        }
      }
      continue;
    }
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    const maxBody = Math.max(o, c);
    const minBody = Math.min(o, c);
    if (h < maxBody || l > minBody || h < l) continue;
    numericBarsByTime.set(t, {
      time: t,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: Number.isFinite(v) ? v : 0,
    });
  }
  const clean = [
    ...Array.from(numericBarsByTime.values()).sort((left, right) => left.time - right.time),
    ...businessDayBars,
  ];
  const min = Number.isFinite(minBars) && minBars > 1 ? minBars : 2;
  return clean.length >= min ? clean : [];
}

function isAlignedIntervalStep(deltaSec, intervalSec) {
  const delta = Number(deltaSec);
  const base = Math.max(1, Number(intervalSec) || 0);
  if (!Number.isFinite(delta) || delta <= 0 || !Number.isFinite(base) || base <= 0) {
    return false;
  }
  const multiple = delta / base;
  return Math.abs(multiple - Math.round(multiple)) < 1e-9;
}

function barsPassIntervalSanity(bars = [], interval = "") {
  const tfSeconds = intervalToSeconds(interval);
  const list = Array.isArray(bars) ? bars : [];
  if (tfSeconds < 60 || list.length < 3) return true;
  let checked = 0;
  let invalid = 0;
  for (let idx = 1; idx < list.length; idx += 1) {
    const prevTime = Number(list[idx - 1]?.time);
    const nextTime = Number(list[idx]?.time);
    if (!Number.isFinite(prevTime) || !Number.isFinite(nextTime)) continue;
    checked += 1;
    if (!isAlignedIntervalStep(nextTime - prevTime, tfSeconds)) {
      invalid += 1;
      if (invalid >= 3) return false;
    }
  }
  if (!checked) return true;
  return invalid / checked <= 0.02;
}

function chooseSafeChartBars(candidateBars = [], previousBars = [], interval = "") {
  const candidate = Array.isArray(candidateBars) ? candidateBars : [];
  const previous = Array.isArray(previousBars) ? previousBars : [];
  if (!candidate.length) return candidate;
  if (barsPassIntervalSanity(candidate, interval)) return candidate;
  return previous.length ? previous : candidate;
}

function normalizeChartSymbol(raw = "") {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

function isCryptoLikeChartSymbol(symbol = "") {
  const sym = normalizeChartSymbol(symbol);
  if (!sym) return false;
  if (sym.endsWith("USDT")) return true;
  return [
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
  ].includes(sym.slice(0, 3));
}

function filterRenderableBarsForSymbol(bars = [], symbol = "", interval = "") {
  const cleaned = ensureValidBars(bars);
  if (!cleaned.length) return cleaned;
  const tfSeconds = intervalToSeconds(interval);
  if (isCryptoLikeChartSymbol(symbol) || tfSeconds >= 86400) {
    return cleaned;
  }
  const filtered = cleaned.filter((bar) => Number(bar?.volume ?? 0) > 0);
  return filtered.length >= 2 ? filtered : cleaned;
}

function insertWhitespacePoints(series = [], timeframeSec = 0) {
  const tfSeconds = Math.max(60, Number(timeframeSec) || 0);
  const gapThresholdSec = tfSeconds * 2;
  const output = [];
  let previousTime = null;
  for (const point of Array.isArray(series) ? series : []) {
    if (!point || typeof point !== "object") continue;
    const time = Number(point?.time);
    if (Number.isFinite(previousTime) && Number.isFinite(time) && time - previousTime > gapThresholdSec) {
      output.push({ time: previousTime + tfSeconds });
    }
    output.push(point);
    previousTime = time;
  }
  return output;
}

function buildRenderableCandleSeriesData(bars = [], symbol = "", interval = "") {
  const filteredBars = filterRenderableBarsForSymbol(bars, symbol, interval);
  const tfSeconds = intervalToSeconds(interval);
  if (!filteredBars.length) return [];
  if (isCryptoLikeChartSymbol(symbol) || tfSeconds >= 86400) {
    return filteredBars;
  }
  return insertWhitespacePoints(filteredBars, tfSeconds);
}

function buildRenderableIndicatorSeriesData(series = [], symbol = "", interval = "") {
  const normalized = Array.isArray(series) ? series.filter(Boolean) : [];
  const tfSeconds = intervalToSeconds(interval);
  if (!normalized.length) return normalized;
  if (isCryptoLikeChartSymbol(symbol) || tfSeconds >= 86400) {
    return normalized;
  }
  return insertWhitespacePoints(normalized, tfSeconds);
}

function barsPriceBounds(bars = []) {
  let min = Infinity;
  let max = -Infinity;
  for (const bar of Array.isArray(bars) ? bars : []) {
    const low = Number(bar?.low);
    const high = Number(bar?.high);
    if (Number.isFinite(low)) min = Math.min(min, low);
    if (Number.isFinite(high)) max = Math.max(max, high);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return { min, max, span: max - min };
}

function buildBarsSignature(bars = []) {
  const list = Array.isArray(bars) ? bars : [];
  if (!list.length) return "0";
  const first = list[0] || {};
  const last = list[list.length - 1] || {};
  return [
    list.length,
    Number(first?.time) || 0,
    Number(last?.time) || 0,
    Number(last?.open) || 0,
    Number(last?.high) || 0,
    Number(last?.low) || 0,
    Number(last?.close) || 0,
  ].join("|");
}

function isIntradayFocusInterval(intervalRaw = "") {
  return intervalToSeconds(intervalRaw) < 86400;
}

function isDailyInterval(intervalRaw = "") {
  return intervalToSeconds(intervalRaw) === 86400;
}

function isSessionOverlayInterval(intervalRaw = "") {
  return intervalToSeconds(intervalRaw) < 14400;
}

const SESSION_OVERLAY_DEFS = [
  ...SESSION_WINDOWS_UTC.filter((item) => item.id === "ny").map((item) => ({
    kind: "session",
    id: item.id,
    label: item.label,
    startHourUtc: item.start,
    endHourUtc: item.end,
    color: "rgba(249, 115, 22, 0.016)",
    shadow: "rgba(249, 115, 22, 0.035)",
  })),
  ...KILL_ZONE_WINDOWS_UTC.filter((item) => item.id === "ny_kz").map((item) => ({
    kind: "killzone",
    id: item.id,
    label: item.label,
    startHourUtc: item.start,
    endHourUtc: item.end,
    color: "rgba(249, 115, 22, 0.01)",
    shadow: "rgba(249, 115, 22, 0.025)",
  })),
];

function getIntlTimezone(timezone) {
  return resolveDisplayTimezone(timezone).intlTimeZone;
}

function getZonedDatePartsFromUnixSec(timeSec = null, timezone = "UTC") {
  const epochMs = Number(timeSec || 0) * 1000;
  if (!Number.isFinite(epochMs) || epochMs <= 0) return null;
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const intlTimezone = getIntlTimezone(timezone);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: intlTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const monthShortFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: intlTimezone,
      month: "short",
    });
    const monthShort = String(monthShortFmt.format(date) || "").trim();
    const parts = fmt.formatToParts(date);
    const getPart = (type) =>
      String(parts.find((part) => part.type === type)?.value || "").trim();
    const year = getPart("year");
    const month = getPart("month");
    const day = getPart("day");
    const hour = Number(getPart("hour"));
    const minute = Number(getPart("minute"));
    const weekday = getPart("weekday");
    if (!year || !month || !day || !weekday || !Number.isFinite(hour) || !Number.isFinite(minute)) {
      return null;
    }
    return {
      year,
      monthShort,
      month,
      day,
      weekday,
      hour,
      minute,
      hourFloat: hour + minute / 60,
    };
  } catch {
    return null;
  }
}

function zonedDayKeyFromUnixSec(timeSec = null, timezone = "UTC") {
  const parts = getZonedDatePartsFromUnixSec(timeSec, timezone);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function zonedWeekdayLabelFromUnixSec(timeSec = null, timezone = "UTC") {
  const parts = getZonedDatePartsFromUnixSec(timeSec, timezone);
  return parts?.weekday || "";
}

function zonedWeekKeyFromUnixSec(timeSec = null, timezone = "UTC") {
  const parts = getZonedDatePartsFromUnixSec(timeSec, timezone);
  if (!parts) return "";
  const syntheticDate = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)),
  );
  if (Number.isNaN(syntheticDate.getTime())) return "";
  const weekday = syntheticDate.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  syntheticDate.setUTCDate(syntheticDate.getUTCDate() + mondayOffset);
  const year = syntheticDate.getUTCFullYear();
  const month = String(syntheticDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(syntheticDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function zonedWeekLabelFromUnixSec(timeSec = null, timezone = "UTC") {
  const parts = getZonedDatePartsFromUnixSec(timeSec, timezone);
  if (!parts) return "";
  return `${parts.day} ${parts.monthShort || ""}`.trim();
}

function matchesSessionHour(hourFloat = 0, startHourUtc = 0, endHourUtc = 0) {
  if (!Number.isFinite(hourFloat)) return false;
  const start = Number(startHourUtc);
  const end = Number(endHourUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (end < start) {
    return hourFloat >= start || hourFloat < end;
  }
  return hourFloat >= start && hourFloat < end;
}

function buildIntradayDayDividerEntries(candles = [], intervalRaw = "", timezone = "UTC") {
  const useDailyBoundaries = isIntradayFocusInterval(intervalRaw);
  const useWeeklyBoundaries = isDailyInterval(intervalRaw);
  if (!useDailyBoundaries && !useWeeklyBoundaries) return [];
  const list = Array.isArray(candles) ? candles : [];
  if (list.length < 2) return [];
  const entries = [];
  let previousDayKey = "";
  for (let index = 0; index < list.length; index += 1) {
    const timeSec = Number(list[index]?.time);
    if (!Number.isFinite(timeSec)) continue;
    const dayKey = useWeeklyBoundaries
      ? zonedWeekKeyFromUnixSec(timeSec, timezone)
      : zonedDayKeyFromUnixSec(timeSec, timezone);
    if (!dayKey) continue;
    if (!previousDayKey) {
      previousDayKey = dayKey;
      continue;
    }
    if (dayKey === previousDayKey) continue;
    previousDayKey = dayKey;
    const label = useWeeklyBoundaries
      ? zonedWeekLabelFromUnixSec(timeSec, timezone)
      : zonedWeekdayLabelFromUnixSec(timeSec, timezone);
    if (!label) continue;
    entries.push({
      timeSec,
      label,
    });
  }
  return entries;
}

function buildSessionOverlayEntries(candles = [], intervalRaw = "", timezone = "UTC") {
  if (!isSessionOverlayInterval(intervalRaw)) return [];
  const list = Array.isArray(candles) ? candles : [];
  if (!list.length) return [];
  const intervalSec = Math.max(60, Number(intervalToSeconds(intervalRaw)) || 60);
  const timeline = list
    .map((bar) => Number(bar?.time))
    .filter((timeSec) => Number.isFinite(timeSec));
  const lastTimeSec = timeline[timeline.length - 1];
  const lastDayKey = zonedDayKeyFromUnixSec(lastTimeSec, timezone);
  if (lastDayKey && Number.isFinite(lastTimeSec)) {
    const maxFutureSteps = Math.max(1, Math.ceil(86400 / intervalSec) + 2);
    let nextTimeSec = lastTimeSec + intervalSec;
    let guard = 0;
    while (
      guard < maxFutureSteps &&
      zonedDayKeyFromUnixSec(nextTimeSec, timezone) === lastDayKey
    ) {
      timeline.push(nextTimeSec);
      nextTimeSec += intervalSec;
      guard += 1;
    }
  }
  const entries = [];
  let active = null;
  const flush = () => {
    if (!active) return;
    entries.push(active);
    active = null;
  };

  for (let index = 0; index < timeline.length; index += 1) {
    const timeSec = Number(timeline[index]);
    const parts = getZonedDatePartsFromUnixSec(timeSec, timezone);
    if (!parts) {
      flush();
      continue;
    }
    const session = SESSION_OVERLAY_DEFS.find((item) =>
      matchesSessionHour(parts.hourFloat, item.startHourUtc, item.endHourUtc),
    );
    if (!session) {
      flush();
      continue;
    }
    const nextTimeSec = Number(timeline[index + 1]);
    const segmentEndSec =
      Number.isFinite(nextTimeSec) && nextTimeSec > timeSec
        ? nextTimeSec
        : timeSec + intervalSec;
    if (
      active &&
      active.sessionId === session.id &&
      active.endTimeSec === timeSec
    ) {
      active.endTimeSec = segmentEndSec;
      continue;
    }
    flush();
    active = {
      sessionId: session.id,
      label: session.label,
      startTimeSec: timeSec,
      endTimeSec: segmentEndSec,
      color: session.color,
      shadow: session.shadow,
    };
  }
  flush();
  return entries;
}

function findBarIndexForEpochSec(candles = [], epochSec = 0) {
  return findTradeBarIndexForEpochSec(candles, epochSec);
}

function resolveTradeWindowIndices(
  candles = [],
  visibleBarsCount = 0,
  anchors = {},
) {
  return resolveTradeFocusedWindow(candles, visibleBarsCount, anchors);
}

function applyIntradayPlanPriceRange(
  candleSeries,
  candles = [],
  visibleBarsCount = 0,
  levelPriceMap = {},
  anchors = {},
  extraPrices = [],
) {
  if (!candleSeries) return false;
  const windowRange = resolveTradeWindowIndices(
    candles,
    visibleBarsCount,
    anchors,
  );
  const levelValues = [
    levelPriceMap?.entry,
    levelPriceMap?.sl,
    levelPriceMap?.tp,
    levelPriceMap?.tp1,
    ...(Array.isArray(extraPrices) ? extraPrices : []),
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!levelValues.length) {
    return false;
  }
  const windowBars = Array.isArray(candles)
    ? candles.slice(
        windowRange ? windowRange.from : 0,
        (windowRange ? windowRange.to : candles.length - 1) + 1,
      )
    : [];
  const barBounds = computePriceBoundsFromBars(windowBars);
  if (!barBounds) return false;

  const barSpan = Math.max(
    barBounds.max - barBounds.min,
    Math.abs(levelValues[0]) * 0.0008,
    1e-6,
  );
  const lastClose = Number(windowBars[windowBars.length - 1]?.close);
  const centerPrice = Number.isFinite(lastClose) ? lastClose : levelValues[0];
  const maxLevelDistance = Math.max(
    barSpan * 8,
    Math.abs(centerPrice) * 0.005,
    1e-4,
  );
  const nearbyLevels = levelValues.filter((price) => {
    const n = Number(price);
    if (!Number.isFinite(n)) return false;
    if (n >= barBounds.min && n <= barBounds.max) return true;
    const distanceToRange =
      n < barBounds.min ? barBounds.min - n : n - barBounds.max;
    return distanceToRange <= Math.max(maxLevelDistance, Math.abs(n) * 0.02);
  });
  const visibleLevels = nearbyLevels.length ? nearbyLevels : levelValues;
  const anchorMin = Math.min(barBounds.min, ...visibleLevels);
  const anchorMax = Math.max(barBounds.max, ...visibleLevels);
  const span = Math.max(anchorMax - anchorMin, barSpan, 1e-6);
  const padding = span * 0.06;

  try {
    candleSeries.priceScale().setVisibleRange({
      from: anchorMin - padding,
      to: anchorMax + padding,
    });
    return true;
  } catch {
    return false;
  }
}

function applyTradeAnchoredViewport(
  chart,
  candles = [],
  _interval = "",
  visibleBarsCount = 0,
  anchors = {},
) {
  if (!chart || !Array.isArray(candles) || !candles.length) return false;
  const range = resolveTradeWindowIndices(candles, visibleBarsCount, anchors);
  if (!range) return false;
  const rightPaddingBars = Math.max(6, Math.round(range.requestedVisibleBars * 0.05));
  const from = range.from;
  const to = Math.min(candles.length - 1 + rightPaddingBars, range.to);

  try {
    const chartElement =
      typeof chart.chartElement === "function" ? chart.chartElement() : null;
    const chartWidth = Number(
      chartElement?.clientWidth ||
        chartElement?.getBoundingClientRect?.().width ||
        0,
    );
    if (chartWidth > 0) {
      const targetBarSpacing = Math.max(
        0.5,
        chartWidth / Math.max(to - from, 1),
      );
      chart.applyOptions({
        timeScale: {
          barSpacing: targetBarSpacing,
          minBarSpacing: 0.5,
          rightOffset: 0,
          lockVisibleTimeRangeOnResize: true,
        },
      });
    }
    chart.timeScale().setVisibleLogicalRange({ from, to });
    return true;
  } catch {
    return false;
  }
}

function resolveTradeAnchoredLogicalRange(
  candles = [],
  _interval = "",
  visibleBarsCount = 0,
  anchors = {},
) {
  if (!Array.isArray(candles) || !candles.length) return null;
  const range = resolveTradeWindowIndices(candles, visibleBarsCount, anchors);
  if (!range) return null;
  const rightPaddingBars = Math.max(6, Math.round(range.requestedVisibleBars * 0.05));
  const from = range.from;
  const to = Math.min(candles.length - 1 + rightPaddingBars, range.to);
  return {
    from,
    to,
    rightPaddingBars,
    totalLogicalBars: Math.max(to - from, range.requestedVisibleBars),
  };
}

function animateVisibleLogicalRange(chart, nextRange, durationMs = 220) {
  if (!chart || !nextRange) return false;
  let currentRange = null;
  try {
    currentRange = chart.timeScale().getVisibleLogicalRange();
  } catch {
    currentRange = null;
  }
  if (
    !currentRange ||
    !Number.isFinite(Number(currentRange.from)) ||
    !Number.isFinite(Number(currentRange.to))
  ) {
    try {
      chart.timeScale().setVisibleLogicalRange({
        from: nextRange.from,
        to: nextRange.to,
      });
      return true;
    } catch {
      return false;
    }
  }

  const startFrom = Number(currentRange.from);
  const startTo = Number(currentRange.to);
  const deltaFrom = Number(nextRange.from) - startFrom;
  const deltaTo = Number(nextRange.to) - startTo;
  if (Math.abs(deltaFrom) < 0.5 && Math.abs(deltaTo) < 0.5) {
    try {
      chart.timeScale().setVisibleLogicalRange({
        from: nextRange.from,
        to: nextRange.to,
      });
      return true;
    } catch {
      return false;
    }
  }

  const startTs = performance.now();
  const easeOut = (t) => 1 - (1 - t) * (1 - t);
  let frameId = 0;
  const tick = (now) => {
    const progress = Math.min(1, (now - startTs) / Math.max(1, durationMs));
    const eased = easeOut(progress);
    try {
      chart.timeScale().setVisibleLogicalRange({
        from: startFrom + deltaFrom * eased,
        to: startTo + deltaTo * eased,
      });
    } catch {
      return;
    }
    if (progress < 1) {
      frameId = window.requestAnimationFrame(tick);
    }
  };
  frameId = window.requestAnimationFrame(tick);
  return () => window.cancelAnimationFrame(frameId);
}

function rememberLogicalRange(chart, range) {
  if (
    !chart ||
    !range ||
    !Number.isFinite(Number(range.from)) ||
    !Number.isFinite(Number(range.to))
  ) {
    return;
  }
  try {
    chart.__codexLastLogicalRange = {
      from: Number(range.from),
      to: Number(range.to),
    };
  } catch {}
}

function applyLatestBarsViewport(
  chart,
  candles = [],
  visibleBarsCount = 0,
  options = {},
) {
  if (!chart || !Array.isArray(candles) || !candles.length) return false;
  const fallbackVisibleBars = Math.min(180, candles.length);
  const requestedVisibleBarsRaw = Math.max(
    2,
    Math.round(Number(visibleBarsCount) || fallbackVisibleBars || 2),
  );
  try {
    const chartElement =
      typeof chart.chartElement === "function" ? chart.chartElement() : null;
    const chartWidth = Number(
      chartElement?.clientWidth ||
        chartElement?.getBoundingClientRect?.().width ||
        0,
    );
    const minBarSpacing = 0.5;
    // Clamp the visible window to something the current tile can physically fit.
    // Otherwise a large fetch-count (e.g. 1000 bars) can pin the viewport to the
    // first loaded bars instead of anchoring the latest end.
    const maxBarsThatFit =
      chartWidth > 0
        ? Math.max(20, Math.floor(chartWidth / minBarSpacing) - 12)
        : fallbackVisibleBars;
    const requestedVisibleBars = Math.max(
      2,
      Math.min(requestedVisibleBarsRaw, maxBarsThatFit, candles.length),
    );
    const lastIndex = candles.length - 1;
    const firstIndex = Math.max(0, candles.length - requestedVisibleBars);
    const requestedAnchorRatio = Number(options.anchorRatio);
    const anchorRatio = Number.isFinite(requestedAnchorRatio)
      ? Math.min(0.9, Math.max(0.1, requestedAnchorRatio))
      : 0.8;
    // Reserve space to the right so the latest bar lands at the requested
    // anchor position. Replay mode passes 0.5 to keep the active bar centered.
    const rightPaddingBars = Math.max(
      6,
      Math.round(requestedVisibleBars * Math.max(0.02, 1 - anchorRatio)),
    );
    const totalLogicalBars = requestedVisibleBars + rightPaddingBars;
    if (chartWidth > 0) {
      const targetBarSpacing = Math.max(
        minBarSpacing,
        chartWidth / Math.max(totalLogicalBars, 1),
      );
      chart.applyOptions({
        timeScale: {
          barSpacing: targetBarSpacing,
          minBarSpacing,
          rightOffset: rightPaddingBars,
          lockVisibleTimeRangeOnResize: true,
        },
      });
    }
    const nextRange = {
      from: firstIndex,
      to: lastIndex + rightPaddingBars,
    };
    chart.timeScale().setVisibleLogicalRange(nextRange);
    rememberLogicalRange(chart, nextRange);
    return true;
  } catch {
    return false;
  }
}

function ensureLatestReplayBarVisible(
  chart,
  candles = [],
  visibleBarsCount = 0,
  options = {},
) {
  if (!chart || !Array.isArray(candles) || !candles.length) return false;
  const lastIndex = candles.length - 1;
  let logicalRange = null;
  try {
    logicalRange = chart.timeScale().getVisibleLogicalRange?.() || null;
  } catch {
    logicalRange = null;
  }
  const from = Number(logicalRange?.from);
  const to = Number(logicalRange?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return applyLatestBarsViewport(chart, candles, visibleBarsCount, options);
  }
  const span = Math.max(20, Math.round(to - from));
  const desiredRightPadding = Math.max(6, Math.round(span * 0.12));
  const requiredTo = lastIndex + desiredRightPadding;
  if (to >= requiredTo && lastIndex >= from) {
    return false;
  }
  const nextRange = {
    from: Math.max(0, requiredTo - span),
    to: requiredTo,
  };
  try {
    chart.applyOptions({
      timeScale: {
        rightOffset: desiredRightPadding,
        lockVisibleTimeRangeOnResize: true,
      },
    });
    chart.timeScale().setVisibleLogicalRange(nextRange);
    rememberLogicalRange(chart, nextRange);
    return true;
  } catch {
    return applyLatestBarsViewport(chart, candles, visibleBarsCount, options);
  }
}

function applyFirstBarsViewport(chart, candles = [], visibleBarsCount = 0) {
  if (!chart || !Array.isArray(candles) || !candles.length) return false;
  const requestedVisibleBars = Math.max(
    20,
    Math.min(candles.length, Math.round(Number(visibleBarsCount) || 100)),
  );
  const rightPaddingBars = Math.max(6, Math.round(requestedVisibleBars * 0.2));
  const nextRange = {
    from: 0,
    to: Math.min(
      candles.length - 1 + rightPaddingBars,
      requestedVisibleBars - 1 + rightPaddingBars,
    ),
  };
  rememberLogicalRange(chart, nextRange);
  return Boolean(
    animateVisibleLogicalRange(chart, nextRange),
  );
}

function applyShowAllLoadedViewport(chart, candleSeries, candles = []) {
  if (!chart || !candleSeries || !Array.isArray(candles) || !candles.length) {
    return false;
  }
  const lastIndex = candles.length - 1;
  const rightPaddingBars = Math.max(
    6,
    Math.min(32, Math.round(candles.length * 0.08)),
  );
  try {
    candleSeries.priceScale().setAutoScale(true);
  } catch {}
  try {
    chart.applyOptions({
      timeScale: {
        rightOffset: rightPaddingBars,
        lockVisibleTimeRangeOnResize: true,
      },
    });
    const nextRange = {
      from: 0,
      to: lastIndex + rightPaddingBars,
    };
    chart.timeScale().setVisibleLogicalRange(nextRange);
    rememberLogicalRange(chart, nextRange);
    // Match the native double-click-on-price-scale behavior by leaving the
    // vertical range on autoscale instead of pinning a manual visible range.
    try {
      candleSeries.priceScale().setAutoScale(true);
      window.requestAnimationFrame(() => {
        try {
          candleSeries.priceScale().setAutoScale(true);
        } catch {}
      });
    } catch {}
    return true;
  } catch {
    return false;
  }
}

function resolvePresetTradeViewportWindow(
  candles = [],
  interval = "",
  requestedBars = 100,
  anchors = {},
) {
  if (!Array.isArray(candles) || !candles.length) return null;
  const tfSec = Math.max(60, Number(intervalToSeconds(interval)) || 60);
  const lastBarSec = Number(candles[candles.length - 1]?.time);
  if (!Number.isFinite(lastBarSec) || lastBarSec <= 0) return null;
  const closedAtSec = Number(anchors?.lastAnchorTimeSec);
  const createdAtSec = Number(anchors?.firstAnchorTimeSec);
  const endTimeSec =
    Number.isFinite(closedAtSec) && closedAtSec > 0
      ? Math.min(lastBarSec, closedAtSec)
      : lastBarSec;
  const requestedWindowBars = Math.max(20, Math.round(Number(requestedBars) || 100));
  const trailingStartSec = endTimeSec - requestedWindowBars * tfSec;
  const startTimeSec =
    Number.isFinite(createdAtSec) && createdAtSec > 0
      ? createdAtSec
      : trailingStartSec;

  let fromIndex = candles.findIndex((bar) => Number(bar?.time) >= startTimeSec);
  if (fromIndex < 0) fromIndex = 0;
  let toIndex = findBarIndexForEpochSec(candles, endTimeSec);
  if (!Number.isFinite(toIndex) || toIndex < 0) {
    toIndex = candles.length - 1;
  }
  if (toIndex < fromIndex) {
    toIndex = Math.min(candles.length - 1, fromIndex + requestedWindowBars - 1);
  }
  const windowBars = candles.slice(fromIndex, toIndex + 1);
  return {
    fromIndex,
    toIndex,
    endTimeSec,
    startTimeSec,
    requestedWindowBars,
    windowBars,
  };
}

function applyPresetTradeViewport(
  chart,
  candleSeries,
  candles = [],
  interval = "",
  requestedBars = 100,
  anchors = {},
  priceOptions = {},
) {
  if (!chart || !candleSeries) return false;
  const window = resolvePresetTradeViewportWindow(
    candles,
    interval,
    requestedBars,
    anchors,
  );
  if (!window) return false;
  const { fromIndex, toIndex, requestedWindowBars, windowBars } = window;
  const chartElement =
    typeof chart.chartElement === "function" ? chart.chartElement() : null;
  const chartWidth = Number(
    chartElement?.clientWidth || chartElement?.getBoundingClientRect?.().width || 0,
  );
  const minBarSpacing = 0.5;
  const rightPaddingBars = Math.max(6, Math.round(requestedWindowBars * 0.05));
  const totalLogicalBars = Math.max(1, toIndex - fromIndex + 1 + rightPaddingBars);
  try {
    if (chartWidth > 0) {
      const targetBarSpacing = Math.max(
        minBarSpacing,
        chartWidth / Math.max(totalLogicalBars, 1),
      );
      chart.applyOptions({
        timeScale: {
          barSpacing: targetBarSpacing,
          minBarSpacing,
          rightOffset: rightPaddingBars,
          lockVisibleTimeRangeOnResize: true,
        },
      });
    }
    const nextRange = {
      from: fromIndex,
      to: toIndex + rightPaddingBars,
    };
    chart.timeScale().setVisibleLogicalRange(nextRange);
    rememberLogicalRange(chart, nextRange);

    const barBounds = computePriceBoundsFromBars(windowBars);
    if (barBounds) {
      const extraPrices = [priceOptions?.tpPrice, priceOptions?.slPrice]
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
      const nextMin = extraPrices.length
        ? Math.min(Number(barBounds.min), ...extraPrices)
        : Number(barBounds.min);
      const nextMax = extraPrices.length
        ? Math.max(Number(barBounds.max), ...extraPrices)
        : Number(barBounds.max);
      const span = Math.max(nextMax - nextMin, Math.abs(nextMax || 0) * 0.001, 1e-6);
      const padding = span * 0.025;
      candleSeries.priceScale().setVisibleRange({
        from: nextMin - padding,
        to: nextMax + padding,
      });
    }
    return true;
  } catch {
    return false;
  }
}

function applyCompactBarsViewport(
  chart,
  candleSeries,
  candles = [],
  interval = "",
  visibleBarsCount = 100,
  anchors = {},
  priceOptions = {},
) {
  return applyPresetTradeViewport(
    chart,
    candleSeries,
    candles,
    interval,
    Math.max(
      20,
      Math.min(
        candles.length,
        Math.round(Number(visibleBarsCount) || 100),
      ),
    ),
    anchors,
    priceOptions,
  );
}

function panVisibleLogicalRange(chart, candles = [], barsDelta = 0) {
  if (!chart || !Array.isArray(candles) || !candles.length) return false;
  const currentRange = chart.timeScale().getVisibleLogicalRange?.();
  if (
    !currentRange ||
    !Number.isFinite(Number(currentRange.from)) ||
    !Number.isFinite(Number(currentRange.to))
  ) {
    return false;
  }
  const delta = Math.round(Number(barsDelta) || 0);
  if (!delta) return false;
  const span = Math.max(2, Number(currentRange.to) - Number(currentRange.from));
  const lastIndex = candles.length - 1;
  const inferredRightPadding = Math.max(2, Math.round(span * 0.2));
  const maxTo = lastIndex + inferredRightPadding;
  let from = Number(currentRange.from) + delta;
  let to = Number(currentRange.to) + delta;
  if (from < 0) {
    to += Math.abs(from);
    from = 0;
  }
  if (to > maxTo) {
    from -= to - maxTo;
    to = maxTo;
  }
  if (from < 0) from = 0;
  const nextRange = {
    from,
    to: Math.max(from + 2, to),
  };
  rememberLogicalRange(chart, nextRange);
  return Boolean(
    animateVisibleLogicalRange(chart, nextRange),
  );
}

function autoFitWindow(
  chart,
  candleSeries,
  candles = [],
  visibleBarsCount = 0,
  anchors = {},
  options = {},
) {
  if (!chart || !candleSeries || !Array.isArray(candles) || !candles.length) {
    return false;
  }
  const requestedVisibleBars = Math.max(
    40,
    Math.round(Number(visibleBarsCount) || candles.length || 40),
  );
  const lastAnchorTimeSec = Number(anchors?.lastAnchorTimeSec);
  const hasClosedAnchor =
    Number.isFinite(lastAnchorTimeSec) && lastAnchorTimeSec > 0;
  const focusRange = resolveTradeWindowIndices(candles, visibleBarsCount, anchors);
  const focusLastIndex = hasClosedAnchor
    ? findBarIndexForEpochSec(candles, lastAnchorTimeSec)
    : candles.length - 1;
  const desiredRightRatio = Number.isFinite(Number(options.rightRatio))
    ? Number(options.rightRatio)
    : 1 / 12;
  const requiredPrices = (Array.isArray(options.requiredPrices)
    ? options.requiredPrices
    : []
  )
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const rightPaddingBars = Math.max(
    1,
    Math.round(requestedVisibleBars * Math.max(0.02, desiredRightRatio)),
  );
  const from = focusRange
    ? focusRange.from
    : Math.max(0, focusLastIndex - requestedVisibleBars + 1);
  const to = Math.min(
    candles.length - 1 + rightPaddingBars,
    (focusRange ? Math.max(focusRange.to, focusLastIndex) : focusLastIndex) +
      rightPaddingBars,
  );
  try {
    candleSeries.priceScale().setAutoScale(true);
  } catch {}
  try {
    chart.applyOptions({
      timeScale: {
        rightOffset: rightPaddingBars,
        lockVisibleTimeRangeOnResize: true,
      },
    });
    chart.timeScale().setVisibleLogicalRange({ from, to });
    if (requiredPrices.length) {
      const windowBars = candles.slice(from, Math.min(candles.length, to + 1));
      const autoRange =
        typeof candleSeries.priceScale().getVisibleRange === "function"
          ? candleSeries.priceScale().getVisibleRange()
          : null;
      const autoMin = Number(autoRange?.from);
      const autoMax = Number(autoRange?.to);
      const barBounds = computePriceBoundsFromBars(windowBars);
      const baseMin =
        Number.isFinite(autoMin)
          ? autoMin
          : Number.isFinite(Number(barBounds?.min))
            ? Number(barBounds.min)
            : null;
      const baseMax =
        Number.isFinite(autoMax)
          ? autoMax
          : Number.isFinite(Number(barBounds?.max))
            ? Number(barBounds.max)
            : null;
      if (Number.isFinite(baseMin) && Number.isFinite(baseMax)) {
        const missingRequiredPrice = requiredPrices.some(
          (price) => price < baseMin || price > baseMax,
        );
        if (missingRequiredPrice) {
          const nextMin = Math.min(baseMin, ...requiredPrices);
          const nextMax = Math.max(baseMax, ...requiredPrices);
          const span = Math.max(nextMax - nextMin, Math.abs(nextMax) * 0.002, 1e-6);
          const padding = span * 0.06;
          candleSeries.priceScale().setVisibleRange({
            from: nextMin - padding,
            to: nextMax + padding,
          });
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

function applyStoredPriceScale(series, viewport) {
  return false;
}

function applyStoredViewport(chart, series, viewport) {
  if (!chart || !series || !viewport || typeof viewport !== "object") return false;
  const timeStartMs = Number(viewport.timeStartMs);
  const timeEndMs = Number(viewport.timeEndMs);
  let appliedTimeRange = false;
  let appliedPriceRange = false;
  if (
    Number.isFinite(timeStartMs) &&
    Number.isFinite(timeEndMs) &&
    timeStartMs !== timeEndMs
  ) {
    try {
      chart.timeScale().setVisibleRange({
        from: Math.round(Math.min(timeStartMs, timeEndMs) / 1000),
        to: Math.round(Math.max(timeStartMs, timeEndMs) / 1000),
      });
      appliedTimeRange = true;
    } catch {}
  }
  const priceTop = Number(viewport.priceTop);
  const priceBottom = Number(viewport.priceBottom);
  if (
    Number.isFinite(priceTop) &&
    Number.isFinite(priceBottom) &&
    priceTop !== priceBottom
  ) {
    try {
      series.priceScale().setAutoScale(false);
    } catch {}
    try {
      series.priceScale().setVisibleRange({
        from: Math.min(priceTop, priceBottom),
        to: Math.max(priceTop, priceBottom),
      });
      appliedPriceRange = true;
    } catch {}
  }
  return appliedTimeRange || appliedPriceRange;
}

function countPriceDecimals(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const normalized = n.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  const idx = normalized.indexOf(".");
  return idx >= 0 ? normalized.length - idx - 1 : 0;
}

function inferPricePrecision(values = []) {
  let precision = 0;
  for (const value of values) {
    precision = Math.max(precision, countPriceDecimals(value));
  }
  return Math.min(Math.max(precision, 0), 8);
}

function coercePrecisionValue(value) {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.round(n), 0), 8);
}

function extractExplicitPricePrecision(symbol, snapshot, cachedEntry) {
  const sym = String(symbol || "").trim().toUpperCase();
  const base = sym.slice(0, 3);
  const quote = sym.endsWith("USDT") ? "USDT" : sym.slice(-3);
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
  const candidates = [
    cachedEntry?.price_precision,
    cachedEntry?.pricePrecision,
    cachedEntry?.metadata?.price_precision,
    cachedEntry?.metadata?.pricePrecision,
    cachedEntry?.metadata?.digits,
    cachedEntry?.metadata?.symbol_digits,
    snapshot?.price_precision,
    snapshot?.pricePrecision,
    snapshot?.metadata?.price_precision,
    snapshot?.metadata?.pricePrecision,
    snapshot?.metadata?.digits,
    snapshot?.metadata?.symbol_digits,
    snapshot?.symbol_digits,
    snapshot?.digits,
  ];
  for (const candidate of candidates) {
    const value = coercePrecisionValue(candidate);
    if (value != null) return value;
  }
  if ((quote === "USD" || quote === "USDT") && !forexCurrencies.has(base)) {
    return 2;
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
  if (sym.endsWith("USD") || sym.endsWith("USDT")) return 2;
  return null;
}

function resolveChartPricePrecision(symbol, values = [], snapshot = null, cachedEntry = null) {
  const explicit = extractExplicitPricePrecision(symbol, snapshot, cachedEntry);
  if (explicit != null) return explicit;
  const inferred = inferPricePrecision(values);
  const sym = String(symbol || "").trim().toUpperCase();
  const base = sym.slice(0, 3);
  const quote = sym.endsWith("USDT") ? "USDT" : sym.slice(-3);
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
  if (sym.startsWith("XAU") || sym.startsWith("XAG")) {
    return Math.min(Math.max(inferred, 2), 2);
  }
  if (
    /^[A-Z]{6}$/.test(sym) &&
    forexCurrencies.has(base) &&
    forexCurrencies.has(quote)
  ) {
    return sym.endsWith("JPY") ? 3 : 5;
  }
  if ((quote === "USD" || quote === "USDT") && !forexCurrencies.has(base)) {
    return Math.min(Math.max(inferred, 2), 2);
  }
  return inferred;
}

function formatPriceWithPrecision(value, precision) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const safePrecision = Math.min(Math.max(Number(precision) || 0, 0), 8);
  return n.toFixed(safePrecision);
}

function normalizeTradeStatusKey(status) {
  return String(status || "").trim().toUpperCase();
}

function isClosedTradeStatus(status) {
  const key = normalizeTradeStatusKey(status);
  return [
    "CLOSED",
    "TP",
    "SL",
    "WIN",
    "LOSS",
    "PROFIT",
    "STOPPED",
    "REJECTED",
    "CANCELLED",
    "EXPIRED",
    "MANUAL",
    "MANUAL_CLOSE",
    "CLOSE_MANUAL",
    "BREAKEVEN",
    "BREAK_EVEN",
    "BE",
  ].includes(key);
}

function isPendingTradeStatus(status) {
  const key = normalizeTradeStatusKey(status);
  return [
    "PENDING",
    "NEW",
    "PLACED",
    "ORDERED",
    "DRAFT",
  ].includes(key);
}

function escapeTooltipHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function compactTooltipText(value, fallback = "n/a") {
  if (value == null) return fallback;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : fallback;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => compactTooltipText(item, ""))
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    return parts.length ? parts.join(", ") : fallback;
  }
  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      return json && json !== "{}" ? json : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function formatArtifactTypeBadgeLabel(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.replaceAll("_", " ").toUpperCase();
}

function stripArtifactTitleTfSuffix(titleRaw = "", tfRaw = "") {
  const title = String(titleRaw || "").trim();
  const tfLabel = displayIntervalLabel(tfRaw);
  if (!title || !tfLabel) return title;
  const escapedTf = tfLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return title.replace(new RegExp(`\\s+${escapedTf}$`, "i"), "").trim() || title;
}

function renderArtifactTooltipMetaHtml(tfRaw = "", typeRaw = "") {
  const tfLabel = displayIntervalLabel(tfRaw);
  const tfColor = artifactPaletteColorForTf(tfRaw);
  const typeLabel = formatArtifactTypeBadgeLabel(typeRaw);
  const mergedLabel = [typeLabel, tfLabel].filter(Boolean).join(" ");
  if (!mergedLabel) return "";
  return (
    `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;">` +
    `<span style="display:inline-flex;align-items:center;padding:2px 6px;border-radius:999px;border:1px solid ${withAlpha(tfColor, "55", "rgba(148,163,184,0.35)")};background:${withAlpha(tfColor, "18", "rgba(148,163,184,0.12)")};color:${tfColor};font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">${escapeTooltipHtml(mergedLabel)}</span>` +
    `</div>`
  );
}

function mapEventKeyToTooltipToken(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "reject") return "REJ";
  if (raw === "breakout") return "BRK";
  return raw.replaceAll("_", " ").toUpperCase();
}

function isGenericEventTooltipToken(value = "") {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "EVENT" || normalized === "ARTIFACT";
}

function resolveCompactArtifactTokens({
  label = "",
  tf = "",
  type = "",
  group = "",
  family = "",
  direction = "",
  markerText = "",
  eventKey = "",
  isEvent = false,
} = {}) {
  const rawLabel = compactTooltipText(label, "");
  const fallbackArtifact = compactTooltipText(
    formatSharedObjectLabel(type || group || family || "", rawLabel || markerText || ""),
    "Artifact",
  );
  const markerToken = compactTooltipText(markerText, "").toUpperCase();
  const eventTokenFromKey = mapEventKeyToTooltipToken(eventKey);
  const normalizedFamily = String(family || "").trim().toLowerCase();
  const normalizedGroup = String(group || "").trim().toLowerCase();
  const normalizedType = String(type || "").trim().toLowerCase();
  let artifactToken = fallbackArtifact;
  if (markerToken && artifactToken.toUpperCase().endsWith(` ${markerToken}`)) {
    artifactToken = artifactToken.slice(0, -markerToken.length).trim();
  }
  if (!artifactToken || artifactToken.toUpperCase() === markerToken) {
    artifactToken = compactTooltipText(
      formatSharedObjectLabel(type || group || family || "", ""),
      artifactToken || markerToken || "Artifact",
    );
  }

  let eventToken = "";
  if (normalizedFamily === "pattern" || normalizedGroup === "patterns") {
    eventToken = "PATTERN";
  } else if (markerToken && markerToken !== artifactToken.toUpperCase()) {
    eventToken = markerToken;
  } else if (eventTokenFromKey && eventTokenFromKey !== artifactToken.toUpperCase()) {
    eventToken = eventTokenFromKey;
  } else {
    if (
      normalizedGroup === "ob" ||
      normalizedGroup === "fvg" ||
      normalizedGroup === "ifvg" ||
      normalizedGroup === "bb" ||
      normalizedGroup === "support" ||
      normalizedGroup === "resistance" ||
      normalizedGroup === "demand" ||
      normalizedGroup === "supply" ||
      normalizedType.includes("ob") ||
      normalizedType.includes("fvg")
    ) {
      eventToken = isEvent ? "EVENT" : "ZONE";
    } else if (normalizedGroup === "trendline") {
      eventToken = "TL";
    } else if (normalizedGroup === "divergence") {
      eventToken = "DIV";
    } else if (normalizedFamily === "structure") {
      eventToken = "STRUCT";
    }
  }

  if (isGenericEventTooltipToken(eventToken)) {
    eventToken = "";
  }
  if (eventToken && eventToken === artifactToken.toUpperCase()) {
    eventToken = "";
  }

  const tfToken = displayIntervalLabel(tf);
  const tfColor = artifactPaletteColorForTf(tf);
  const biasVisual = resolveArtifactBiasVisual(direction, type || group);
  return {
    artifactToken: compactTooltipText(artifactToken, "Artifact"),
    eventToken: compactTooltipText(eventToken, ""),
    tfToken: compactTooltipText(tfToken, ""),
    tfColor,
    directionIcon: String(biasVisual?.icon || "").trim(),
    directionColor: String(biasVisual?.fg || "#94a3b8").trim(),
  };
}

function renderCompactArtifactTooltipHtml(meta = {}) {
  const {
    artifactToken,
    eventToken,
    tfToken,
    tfColor,
    directionIcon,
    directionColor,
  } = resolveCompactArtifactTokens(meta);
  const segments = [
    `<span style="color:#f8fafc;font-size:10px;font-weight:700;line-height:1.05;">${escapeTooltipHtml(artifactToken)}</span>`,
    eventToken
      ? `<span style="color:#f8fafc;font-size:10px;font-weight:700;line-height:1.05;">${escapeTooltipHtml(eventToken)}</span>`
      : "",
    tfToken
      ? `<span style="color:${tfColor};font-size:10px;font-weight:700;line-height:1.05;">${escapeTooltipHtml(tfToken)}</span>`
      : "",
    directionIcon
      ? `<span style="color:${directionColor};font-size:10px;font-weight:700;line-height:1.05;">${escapeTooltipHtml(directionIcon)}</span>`
      : "",
  ].filter(Boolean);
  return (
    `<div style="min-width:0;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">` +
    segments.join(`<span style="color:#64748b;font-size:10px;font-weight:700;line-height:1.05;"> · </span>`) +
    `</div>`
  );
}

function shouldShowSharedPriceScaleLabel(
  { sourceTf = "", artifactType = "", artifactGroup = "", label = "" } = {},
  chartTfRaw = "",
) {
  const chartTf = displayIntervalLabel(chartTfRaw);
  const source = displayIntervalLabel(sourceTf);
  const typeText = String(artifactType || "").trim().toLowerCase();
  const groupText = String(artifactGroup || "").trim().toLowerCase();
  const labelText = String(label || "").trim().toUpperCase();
  const isStructureLike =
    groupText === "swings" ||
    typeText.includes("swing_high") ||
    typeText.includes("swing_low") ||
    typeText.includes("liquidity_high") ||
    typeText.includes("liquidity_low") ||
    ["HH", "HL", "LH", "LL"].includes(labelText);
  if (!isStructureLike) return true;
  if (!chartTf || !source) return true;
  return source === chartTf;
}

function renderTooltipCardHtml({ title = "", subtitle = "", subtitleHtml = "", sections = [] } = {}) {
  const safeTitle = escapeTooltipHtml(title || "Marker");
  const safeSubtitleHtml = String(subtitleHtml || "").trim();
  const safeSubtitle = String(subtitle || "").trim()
    ? `<div style="margin-top:2px;font-size:11px;color:#94a3b8;">${escapeTooltipHtml(subtitle)}</div>`
    : "";
  const safeSections = (Array.isArray(sections) ? sections : [])
    .map((section) => {
      const label = String(section?.label || "").trim();
      const valueHtml = String(section?.valueHtml || "").trim();
      const value = String(section?.value || "").trim();
      const renderedValue = valueHtml
        ? valueHtml
        : value
          ? escapeTooltipHtml(value)
          : "";
      if (!label || !renderedValue) return "";
      return (
        `<div style="margin-top:6px;">` +
        `<div style="font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">${escapeTooltipHtml(label)}</div>` +
        `<div style="margin-top:2px;font-size:12px;line-height:1.4;color:#e2e8f0;white-space:pre-wrap;word-break:break-word;">${renderedValue}</div>` +
        `</div>`
      );
    })
    .filter(Boolean)
    .join("");
  return (
    `<div style="min-width:220px;max-width:360px;">` +
    `<div style="font-size:12px;font-weight:700;color:#f8fafc;">${safeTitle}</div>` +
    safeSubtitle +
    safeSubtitleHtml +
    safeSections +
    `</div>`
  );
}

function formatCompactRuleValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  if (Math.abs(numeric) >= 1000) {
    return numeric.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }
  if (Math.abs(numeric) >= 1) {
    return numeric.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    });
  }
  return numeric.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function buildCompactRuleDetail(hit = {}) {
  const ruleEvent = hit?.ruleEvent && typeof hit.ruleEvent === "object" ? hit.ruleEvent : {};
  const eventId = String(hit?.eventId || ruleEvent?.rule_id || "").trim().toLowerCase();
  const family = String(ruleEvent?.family || "").trim().toLowerCase();
  const priceText = formatCompactRuleValue(ruleEvent?.price);

  if (eventId.includes("breaks_below_key_level")) {
    return priceText ? `Crossed below ${priceText}` : "Crossed below key level";
  }
  if (eventId.includes("breaks_key_level")) {
    return priceText ? `Crossed ${priceText}` : "Crossed key level";
  }
  if (eventId.includes("rejected_key_level")) {
    return priceText ? `Rejected ${priceText}` : "Rejected key level";
  }
  if (eventId.includes("retests_key_level")) {
    return priceText ? `Retested ${priceText}` : "Retested key level";
  }
  if (eventId.includes("ema_fast_crosses_ema_slow")) return "EMA fast crossed EMA slow";
  if (eventId.includes("price_crosses_ema")) return "Crossed EMA";
  if (eventId.includes("price_rejected_ema")) return "Rejected EMA";
  if (eventId.includes("price_crosses_below_vwap")) return "Crossed below VWAP";
  if (eventId.includes("price_crosses_vwap")) return "Crossed VWAP";
  if (eventId.includes("price_rejected_vwap")) return "Rejected VWAP";
  if (eventId.includes("macd_cross_down")) return "MACD crossed down";
  if (eventId.includes("macd_cross")) return "MACD crossed";
  if (family === "key_level") return priceText ? `Level ${priceText}` : "Key level";
  if (family === "moving_average") return "Moving-average signal";
  if (family === "vwap") return "VWAP signal";
  if (family === "momentum") return "Momentum signal";

  return compactTooltipText(hit?.eventName || ruleEvent?.name, "");
}

function renderCompactRuleTooltipHtml({ title = "", detail = "" } = {}) {
  const safeTitle = escapeTooltipHtml(title || "Rule");
  const safeDetail = String(detail || "").trim()
    ? `<div style="margin-top:2px;font-size:11px;line-height:1.2;color:#94a3b8;">${escapeTooltipHtml(detail)}</div>`
    : "";
  return (
    `<div style="min-width:0;max-width:210px;">` +
    `<div style="font-size:12px;font-weight:700;line-height:1.1;color:#f8fafc;">${safeTitle}</div>` +
    safeDetail +
    `</div>`
  );
}

function renderCompactTradeTooltipCardHtml({
  title = "",
  subtitleHtml = "",
  rows = [],
} = {}) {
  const safeTitle = escapeTooltipHtml(title || "Trade");
  const safeSubtitleHtml = String(subtitleHtml || "").trim();
  const safeRows = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const valueHtml = String(row?.valueHtml || "").trim();
      const value = String(row?.value || "").trim();
      const renderedValue = valueHtml ? valueHtml : value ? escapeTooltipHtml(value) : "";
      if (!renderedValue) return "";
      return (
        `<div style="margin-top:3px;font-size:11px;line-height:1.2;color:#e2e8f0;white-space:pre-wrap;word-break:break-word;">` +
        `${renderedValue}` +
        `</div>`
      );
    })
    .filter(Boolean)
    .join("");
  return (
    `<div style="min-width:180px;max-width:300px;">` +
    `<div style="font-size:12px;font-weight:700;line-height:1.15;color:#f8fafc;">${safeTitle}</div>` +
    safeSubtitleHtml +
    safeRows +
    `</div>`
  );
}

function renderTooltipBadgeHtml(
  text,
  {
    fg = "#e2e8f0",
    bg = "rgba(30, 41, 59, 0.9)",
    border = "rgba(148, 163, 184, 0.24)",
  } = {},
) {
  const label = String(text || "").trim();
  if (!label) return "";
  return (
    `<span style="display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;` +
    `font-size:10px;font-weight:700;letter-spacing:0.03em;color:${fg};background:${bg};border:1px solid ${border};">` +
    `${escapeTooltipHtml(label)}` +
    `</span>`
  );
}

function formatArtifactLifecycleLabel(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.replaceAll("_", " ");
}

function resolveArtifactStatusVisual(statusRaw = "", lifecycleStateRaw = "") {
  const status = String(statusRaw || "").trim().toLowerCase();
  const lifecycleState = String(lifecycleStateRaw || "").trim().toLowerCase();
  if (status === "active") {
    return {
      label: "Active",
      icon: "●",
      fg: "#4ade80",
      bg: "rgba(20, 83, 45, 0.42)",
      border: "rgba(74, 222, 128, 0.38)",
    };
  }
  if (status === "inactive") {
    return {
      label: "Inactive",
      icon: "○",
      fg: "#cbd5e1",
      bg: "rgba(51, 65, 85, 0.58)",
      border: "rgba(148, 163, 184, 0.3)",
    };
  }
  if (status === "touched" || lifecycleState.includes("touched")) {
    return {
      label: "Touched",
      icon: "◐",
      fg: "#facc15",
      bg: "rgba(113, 63, 18, 0.42)",
      border: "rgba(250, 204, 21, 0.34)",
    };
  }
  return {
    label: status ? status.replaceAll("_", " ") : "Artifact",
    icon: "•",
    fg: "#93c5fd",
    bg: "rgba(30, 41, 59, 0.9)",
    border: "rgba(148, 163, 184, 0.24)",
  };
}

function resolveArtifactBiasVisual(directionRaw = "", typeRaw = "") {
  const direction = String(directionRaw || "").trim().toLowerCase();
  const type = String(typeRaw || "").trim().toLowerCase();
  if (direction === "buy" || direction === "bullish") {
    return {
      label: "Bullish",
      icon: "▲",
      fg: "#4ade80",
      bg: "rgba(20, 83, 45, 0.38)",
      border: "rgba(74, 222, 128, 0.3)",
    };
  }
  if (direction === "sell" || direction === "bearish") {
    return {
      label: "Bearish",
      icon: "▼",
      fg: "#f87171",
      bg: "rgba(127, 29, 29, 0.38)",
      border: "rgba(248, 113, 113, 0.3)",
    };
  }
  if (type === "swing_high" || type === "liquidity_high" || type === "sweep_high") {
    return {
      label: "High",
      icon: "↑",
      fg: "#60a5fa",
      bg: "rgba(30, 64, 175, 0.34)",
      border: "rgba(96, 165, 250, 0.28)",
    };
  }
  if (type === "swing_low" || type === "liquidity_low" || type === "sweep_low") {
    return {
      label: "Low",
      icon: "↓",
      fg: "#38bdf8",
      bg: "rgba(12, 74, 110, 0.34)",
      border: "rgba(56, 189, 248, 0.28)",
    };
  }
  return null;
}

function compactTooltipStatChip({
  icon = "",
  value = "",
  fg = "#e2e8f0",
  bg = "rgba(30, 41, 59, 0.5)",
  border = "rgba(148, 163, 184, 0.2)",
} = {}) {
  const text = String(value || "").trim();
  if (!text) return "";
  const glyph = String(icon || "").trim();
  return (
    `<span style="display:inline-flex;align-items:center;gap:3px;padding:0 4px;border-radius:999px;` +
    `font-size:8px;font-weight:700;line-height:1.2;color:${fg};background:${bg};border:none;">` +
    `${glyph ? `<span style="opacity:0.9;">${escapeTooltipHtml(glyph)}</span>` : ""}` +
    `<span>${escapeTooltipHtml(text)}</span>` +
    `</span>`
  );
}

function renderTooltipInlineStatsHtml(items = []) {
  const list = (Array.isArray(items) ? items : [])
    .map((item) => ({
      label: String(item?.label || "").trim(),
      value: String(item?.value || "").trim(),
      tone: String(item?.tone || "#e2e8f0").trim(),
    }))
    .filter((item) => item.label && item.value);
  if (!list.length) return "";
  return (
    `<div style="display:flex;flex-wrap:wrap;gap:8px 10px;">` +
    list
      .map(
        (item) =>
          `<span style="display:inline-flex;gap:4px;align-items:baseline;">` +
          `<span style="font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;">${escapeTooltipHtml(item.label)}</span>` +
          `<span style="font-size:12px;font-weight:600;color:${item.tone};">${escapeTooltipHtml(item.value)}</span>` +
          `</span>`,
      )
      .join("") +
    `</div>`
  );
}

function buildTradeBoxSpecs({
  entryPrice = null,
  tpPrice = null,
  slPrice = null,
  status = "",
  pnlRealized = null,
  startTimeSec = null,
  closedTimeSec = null,
  latestBarTimeSec = null,
} = {}) {
  const entry = Number(entryPrice);
  if (!Number.isFinite(entry)) return [];

  const start = Number(startTimeSec);
  if (!Number.isFinite(start) || start <= 0) return [];

  const latest = Number(latestBarTimeSec);
  const closed = Number(closedTimeSec);
  const safeEnd =
    Number.isFinite(closed) && closed > 0
      ? closed
      : Number.isFinite(latest) && latest > 0
        ? latest
        : null;
  if (!Number.isFinite(safeEnd) || safeEnd <= 0) return [];

  const endTimeSec = Math.max(start, safeEnd);
  const statusKey = normalizeTradeStatusKey(status);
  const isPending = isPendingTradeStatus(statusKey);
  const isClosed =
    isClosedTradeStatus(statusKey) && Number.isFinite(closed) && closed > 0;
  const pnl = Number(pnlRealized);
  const closedWithProfit =
    isClosed &&
    ((Number.isFinite(pnl) && pnl > 0) ||
      ["TP", "WIN", "PROFIT"].includes(statusKey));
  const closedWithLoss =
    isClosed &&
    ((Number.isFinite(pnl) && pnl < 0) ||
      ["SL", "LOSS", "STOPPED"].includes(statusKey));

  const dotLineDash = [1.5, 2.5];
  const pendingRewardFill = TIMELINE_TRADE_PENDING_REWARD_FILL;
  const pendingRiskFill = TIMELINE_TRADE_PENDING_RISK_FILL;
  const activeRewardFill = TIMELINE_TRADE_ACTIVE_REWARD_FILL;
  const activeRiskFill = TIMELINE_TRADE_ACTIVE_RISK_FILL;
  const rewardInactiveFill = isPending ? pendingRewardFill : activeRewardFill;
  const riskInactiveFill = isPending ? pendingRiskFill : activeRiskFill;

  const specs = [];
  const tp = Number(tpPrice);
  if (Number.isFinite(tp) && tp !== entry) {
    specs.push({
      key: "tp",
      startTimeSec: start,
      endTimeSec,
      priceLow: Math.min(entry, tp),
      priceHigh: Math.max(entry, tp),
      lineColor: BACKTEST_CHART_THEME.plannedTp,
      fillColor: closedWithProfit
        ? BACKTEST_CHART_THEME.tradeBoxProfit
        : closedWithLoss
          ? "rgba(34, 197, 94, 0.035)"
          : rewardInactiveFill,
      lineWidth: closedWithProfit ? 0.5 : 0.25,
      lineDash: closedWithProfit ? [] : dotLineDash,
      shadowBlur: 0,
      label: "",
    });
  }

  const sl = Number(slPrice);
  if (Number.isFinite(sl) && sl !== entry) {
    specs.push({
      key: "sl",
      startTimeSec: start,
      endTimeSec,
      priceLow: Math.min(entry, sl),
      priceHigh: Math.max(entry, sl),
      lineColor: BACKTEST_CHART_THEME.plannedSl,
      fillColor: closedWithLoss
        ? BACKTEST_CHART_THEME.tradeBoxLoss
        : closedWithProfit
          ? "rgba(239, 68, 68, 0.035)"
          : riskInactiveFill,
      lineWidth: closedWithLoss ? 0.5 : 0.25,
      lineDash: closedWithLoss ? [] : dotLineDash,
      shadowBlur: 0,
      label: "",
    });
  }

  if (!specs.length) {
    const fallbackHeight = Math.max(Math.abs(entry) * 0.0015, 1e-6);
    specs.push({
      key: "entry",
      startTimeSec: start,
      endTimeSec,
      priceLow: entry - fallbackHeight,
      priceHigh: entry + fallbackHeight,
      lineColor: BACKTEST_CHART_THEME.buy,
      fillColor: "rgba(56, 189, 248, 0.05)",
      lineWidth: 0.25,
      lineDash: dotLineDash,
      shadowBlur: 0,
      label: "",
    });
  }

  return specs;
}

function attachTradeBoxSpecs(series, primitivesRef, specs = []) {
  if (!series || !primitivesRef || !Array.isArray(specs) || !specs.length) return;
  for (const spec of specs) {
    if (!spec || !Number.isFinite(Number(spec.startTimeSec))) continue;
    if (!Number.isFinite(Number(spec.endTimeSec))) continue;
    const primitive = new TimeRangeBoxPrimitive(spec);
    series.attachPrimitive(primitive);
    primitivesRef.current.push(primitive);
  }
}

function buildSummaryTexts(snapshot) {
  const s =
    snapshot?.summary && typeof snapshot.summary === "object"
      ? snapshot.summary
      : {};
  const parts = [];
  if (s.bias) parts.push(`Bias: ${s.bias}`);
  if (s.trend) parts.push(`Trend: ${s.trend}`);
  if (Number.isFinite(Number(s.confidence_pct)))
    parts.push(`Conf: ${Number(s.confidence_pct)}%`);
  if (s.profile) parts.push(`Profile: ${s.profile}`);
  const rows = [];
  if (parts.length) rows.push(parts.join(" | "));
  if (s.invalidation)
    rows.push(`Invalidation: ${String(s.invalidation).slice(0, 80)}`);
  if (s.note) rows.push(String(s.note).slice(0, 110));
  return rows.slice(0, 3);
}

function checklistText(snapshot) {
  const arr = Array.isArray(snapshot?.checklist) ? snapshot.checklist : [];
  const selected = arr
    .filter((x) => x?.checked)
    .slice(0, 4)
    .map((x) => `${x.strategy || "Rule"}:${x.condition || "ok"}`);
  if (!selected.length) return "";
  return `Checklist: ${selected.join(", ").slice(0, 140)}`;
}

function extractAnalysisSnapshot(analysisSnapshot) {
  if (analysisSnapshot && typeof analysisSnapshot === "object")
    return analysisSnapshot;
  return null;
}

function pickChartRelevantSnapshot(snapshot) {
  const source =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? snapshot
      : null;
  if (!source) return null;
  const marketAnalysis =
    source.market_analysis &&
    typeof source.market_analysis === "object" &&
    !Array.isArray(source.market_analysis)
      ? source.market_analysis
      : null;
  return {
    bars: Array.isArray(source.bars) ? source.bars : [],
    bar_start: source.bar_start ?? null,
    bar_end: source.bar_end ?? null,
    summary:
      source.summary && typeof source.summary === "object"
        ? source.summary
        : null,
    checklist: Array.isArray(source.checklist) ? source.checklist : [],
    trade_plan: Array.isArray(source.trade_plan)
      ? source.trade_plan
      : Array.isArray(source.trade_plans)
        ? source.trade_plans
        : Array.isArray(source.tradePlans)
          ? source.tradePlans
          : source.trade_plan &&
              typeof source.trade_plan === "object" &&
              !Array.isArray(source.trade_plan)
            ? [source.trade_plan]
            : [],
    pd_arrays: Array.isArray(source.pd_arrays)
      ? source.pd_arrays
      : Array.isArray(source.pdArrays)
        ? source.pdArrays
        : [],
    key_levels: Array.isArray(source.key_levels) ? source.key_levels : [],
    htf_tfs: Array.isArray(source.htf_tfs) ? source.htf_tfs : [],
    market_analysis: marketAnalysis
      ? {
          pd_arrays: Array.isArray(marketAnalysis.pd_arrays)
            ? marketAnalysis.pd_arrays
            : [],
          key_levels: Array.isArray(marketAnalysis.key_levels)
            ? marketAnalysis.key_levels
            : [],
        }
      : null,
  };
}

function toEpochSec(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return null;
    return value > 100000000000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 100000000000
      ? Math.floor(numeric / 1000)
      : Math.floor(numeric);
  }
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed / 1000);
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

function lwTimeToEpochSec(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (value && typeof value === "object") {
    if (Number.isFinite(Number(value.timestamp)) && Number(value.timestamp) > 0) {
      return Math.floor(Number(value.timestamp));
    }
    if (
      Number.isFinite(Number(value.year)) &&
      Number.isFinite(Number(value.month)) &&
      Number.isFinite(Number(value.day))
    ) {
      const ms = Date.UTC(
        Number(value.year),
        Number(value.month) - 1,
        Number(value.day),
      );
      return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    }
  }
  return null;
}

function lineStyleToChartValue(styleRaw) {
  const style = String(styleRaw || "").trim().toLowerCase();
  if (style === "dotted" || style === "dot") return 1;
  if (style === "dashed" || style === "dash") return 2;
  return 0;
}

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

function getCandleSeriesOptions({ candlesVisible = true, zigzagVisible = true } = {}) {
  const muted = Boolean(zigzagVisible);
  return {
    visible: Boolean(candlesVisible),
    upColor: muted ? "rgba(125, 211, 252, 0.30)" : BACKTEST_CHART_THEME.candleUp,
    downColor: muted ? "rgba(251, 191, 36, 0.24)" : BACKTEST_CHART_THEME.candleDown,
    borderVisible: false,
    wickUpColor: muted ? "rgba(203, 213, 225, 0.34)" : BACKTEST_CHART_THEME.wickUp,
    wickDownColor: muted ? "rgba(203, 213, 225, 0.34)" : BACKTEST_CHART_THEME.wickDown,
    priceLineColor: "#9ca3af",
  };
}

function buildLineSeriesFromBars(bars, period) {
  if (!Array.isArray(bars) || bars.length < period) return [];
  const out = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const close = Number(bars[i]?.close);
    if (!Number.isFinite(close)) continue;
    sum += close;
    if (i >= period) sum -= Number(bars[i - period]?.close) || 0;
    if (i >= period - 1) {
      out.push({ time: bars[i].time, value: sum / period });
    }
  }
  return out;
}

function buildEmaSeriesFromBars(bars, period = 20) {
  if (!Array.isArray(bars) || bars.length < period) return [];
  const seed = buildLineSeriesFromBars(bars, period);
  if (!seed.length) return [];
  const multiplier = 2 / (period + 1);
  let ema = Number(seed[0]?.value);
  const out = [{ time: seed[0].time, value: ema }];
  const startIndex = bars.findIndex((bar) => Number(bar?.time) === Number(seed[0]?.time));
  for (let i = Math.max(startIndex + 1, period); i < bars.length; i += 1) {
    const close = Number(bars[i]?.close);
    if (!Number.isFinite(close)) continue;
    ema = (close - ema) * multiplier + ema;
    out.push({ time: bars[i].time, value: ema });
  }
  return out;
}

function buildRsiSeriesFromBars(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length <= period) return [];
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = Number(bars[i]?.close) - Number(bars[i - 1]?.close);
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const out = [];
  const firstRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  out.push({ time: bars[period].time, value: 100 - 100 / (1 + firstRs) });
  for (let i = period + 1; i < bars.length; i += 1) {
    const delta = Number(bars[i]?.close) - Number(bars[i - 1]?.close);
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out.push({
      time: bars[i].time,
      value: Math.max(0, Math.min(100, 100 - 100 / (1 + rs))),
    });
  }
  return out;
}

function buildEmaSeries(lineData, period = 9) {
  if (!Array.isArray(lineData) || !lineData.length) return [];
  const multiplier = 2 / (period + 1);
  let ema = Number(lineData[0]?.value);
  if (!Number.isFinite(ema)) return [];
  const out = [{ time: lineData[0].time, value: ema }];
  for (let i = 1; i < lineData.length; i += 1) {
    const value = Number(lineData[i]?.value);
    if (!Number.isFinite(value)) continue;
    ema = (value - ema) * multiplier + ema;
    out.push({ time: lineData[i].time, value: ema });
  }
  return out;
}

function buildWmaSeries(lineData, period = 45) {
  if (!Array.isArray(lineData) || lineData.length < period) return [];
  const denominator = (period * (period + 1)) / 2;
  const out = [];
  for (let i = period - 1; i < lineData.length; i += 1) {
    let total = 0;
    for (let j = 0; j < period; j += 1) {
      total += Number(lineData[i - period + 1 + j]?.value) * (j + 1);
    }
    out.push({ time: lineData[i].time, value: total / denominator });
  }
  return out;
}

function buildVwapSeriesFromBars(bars = []) {
  if (!Array.isArray(bars) || !bars.length) return [];
  const out = [];
  let cumulativePv = 0;
  let cumulativeVolume = 0;
  for (const bar of bars) {
    const high = Number(bar?.high);
    const low = Number(bar?.low);
    const close = Number(bar?.close);
    const volume = Math.max(0, Number(bar?.volume) || 0);
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue;
    const typical = (high + low + close) / 3;
    cumulativePv += typical * Math.max(volume, 1);
    cumulativeVolume += Math.max(volume, 1);
    out.push({ time: bar.time, value: cumulativePv / Math.max(cumulativeVolume, 1) });
  }
  return out;
}

function buildBollingerSeriesFromBars(bars = [], period = 20, multiplier = 2) {
  if (!Array.isArray(bars) || bars.length < period) {
    return { bbMid: [], bbUpper: [], bbLower: [] };
  }
  const outMid = [];
  const outUpper = [];
  const outLower = [];
  for (let i = period - 1; i < bars.length; i += 1) {
    const window = bars.slice(i - period + 1, i + 1).map((bar) => Number(bar?.close));
    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    const variance =
      window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(Math.max(variance, 0));
    outMid.push({ time: bars[i].time, value: mean });
    outUpper.push({ time: bars[i].time, value: mean + stdDev * multiplier });
    outLower.push({ time: bars[i].time, value: mean - stdDev * multiplier });
  }
  return { bbMid: outMid, bbUpper: outUpper, bbLower: outLower };
}

function rollingMidpoint(bars = [], period = 9) {
  if (!Array.isArray(bars) || bars.length < period) return [];
  const out = [];
  for (let i = period - 1; i < bars.length; i += 1) {
    let high = -Infinity;
    let low = Infinity;
    for (let j = i - period + 1; j <= i; j += 1) {
      high = Math.max(high, Number(bars[j]?.high));
      low = Math.min(low, Number(bars[j]?.low));
    }
    out.push({ time: bars[i].time, value: (high + low) / 2 });
  }
  return out;
}

function buildIchimokuSeriesFromBars(bars = []) {
  const ichiTenkan = rollingMidpoint(bars, 9);
  const ichiKijun = rollingMidpoint(bars, 26);
  const tenkanMap = new Map(ichiTenkan.map((point) => [Number(point.time), Number(point.value)]));
  const kijunMap = new Map(ichiKijun.map((point) => [Number(point.time), Number(point.value)]));
  const ichiSpanA = [];
  const ichiSpanB = [];
  const ichiChikou = [];
  const spanBBase = rollingMidpoint(bars, 52);
  for (const bar of bars) {
    const time = Number(bar?.time);
    if (tenkanMap.has(time) && kijunMap.has(time)) {
      ichiSpanA.push({ time, value: (tenkanMap.get(time) + kijunMap.get(time)) / 2 });
    }
  }
  for (const point of spanBBase) ichiSpanB.push(point);
  for (let i = 0; i < bars.length; i += 1) {
    if (i < 26) continue;
    const close = Number(bars[i]?.close);
    if (!Number.isFinite(close)) continue;
    ichiChikou.push({ time: bars[i - 26].time, value: close });
  }
  return { ichiTenkan, ichiKijun, ichiSpanA, ichiSpanB, ichiChikou };
}

function buildStochasticSeriesFromBars(bars = [], period = 14, smooth = 3) {
  if (!Array.isArray(bars) || bars.length < period) return { stochK: [], stochD: [] };
  const kRaw = [];
  for (let i = period - 1; i < bars.length; i += 1) {
    let high = -Infinity;
    let low = Infinity;
    for (let j = i - period + 1; j <= i; j += 1) {
      high = Math.max(high, Number(bars[j]?.high));
      low = Math.min(low, Number(bars[j]?.low));
    }
    const close = Number(bars[i]?.close);
    const denom = Math.max(high - low, 0.0000001);
    kRaw.push({ time: bars[i].time, value: Math.max(0, Math.min(100, ((close - low) / denom) * 100)) });
  }
  const stochD = buildLineSeriesFromBars(
    kRaw.map((point) => ({ time: point.time, close: point.value })),
    smooth,
  );
  return { stochK: kRaw, stochD };
}

function buildMacdSeriesFromBars(bars = [], fast = 12, slow = 26, signalPeriod = 9) {
  const fastEma = buildEmaSeriesFromBars(bars, fast);
  const slowEma = buildEmaSeriesFromBars(bars, slow);
  if (!fastEma.length || !slowEma.length) {
    return { macd: [], macdSignal: [], macdHistogram: [] };
  }
  const slowMap = new Map(slowEma.map((point) => [Number(point.time), Number(point.value)]));
  const macd = fastEma
    .map((point) => {
      const slowValue = slowMap.get(Number(point.time));
      if (!Number.isFinite(slowValue)) return null;
      return { time: point.time, value: Number(point.value) - slowValue };
    })
    .filter(Boolean);
  const macdSignal = buildEmaSeries(macd, signalPeriod);
  const signalMap = new Map(macdSignal.map((point) => [Number(point.time), Number(point.value)]));
  const macdHistogram = macd
    .map((point) => {
      const signalValue = signalMap.get(Number(point.time));
      if (!Number.isFinite(signalValue)) return null;
      const value = Number(point.value) - signalValue;
      return {
        time: point.time,
        value,
        color:
          value >= 0
            ? INDICATOR_LINE_STYLE.colors.macdHistogramUp
            : INDICATOR_LINE_STYLE.colors.macdHistogramDown,
      };
    })
    .filter(Boolean);
  return { macd, macdSignal, macdHistogram };
}

function buildZigZagSeriesFromBars(bars = [], pivot = 5) {
  if (!Array.isArray(bars) || bars.length < pivot * 2 + 1) return [];
  const points = [];
  for (let i = pivot; i < bars.length - pivot; i += 1) {
    const bar = bars[i];
    let isHigh = true;
    let isLow = true;
    for (let offset = 1; offset <= pivot; offset += 1) {
      const left = bars[i - offset];
      const right = bars[i + offset];
      if (Number(bar?.high) <= Number(left?.high) || Number(bar?.high) <= Number(right?.high)) {
        isHigh = false;
      }
      if (Number(bar?.low) >= Number(left?.low) || Number(bar?.low) >= Number(right?.low)) {
        isLow = false;
      }
    }
    if (isHigh) points.push({ time: bar.time, value: Number(bar.high) });
    else if (isLow) points.push({ time: bar.time, value: Number(bar.low) });
  }
  return points;
}

function buildFallbackOscillatorSeries(bars, amplitude = 12, phase = 0) {
  if (!Array.isArray(bars) || !bars.length) return [];
  return bars.map((bar, index) => ({
    time: bar.time,
    value: Math.max(
      0,
      Math.min(100, 50 + Math.sin(index / 6 + phase) * amplitude),
    ),
  }));
}

function buildIndicatorSeries(bars) {
  const rsi = buildRsiSeriesFromBars(bars, 14);
  const safeRsi = rsi.length ? rsi : buildFallbackOscillatorSeries(bars, 14, 0);
  const rsiEma9 = buildEmaSeries(safeRsi, 9);
  const rsiWma45 = buildWmaSeries(safeRsi, 45);
  const { stochK, stochD } = buildStochasticSeriesFromBars(bars, 14, 3);
  const { bbMid, bbUpper, bbLower } = buildBollingerSeriesFromBars(bars, 20, 2);
  const { ichiTenkan, ichiKijun, ichiSpanA, ichiSpanB, ichiChikou } =
    buildIchimokuSeriesFromBars(bars);
  const { macd, macdSignal, macdHistogram } = buildMacdSeriesFromBars(bars, 12, 26, 9);
  return {
    sma20: buildLineSeriesFromBars(bars, 20),
    sma50: buildLineSeriesFromBars(bars, 50),
    sma200: buildLineSeriesFromBars(bars, 200),
    ema20: buildEmaSeriesFromBars(bars, 20),
    ema50: buildEmaSeriesFromBars(bars, 50),
    ema200: buildEmaSeriesFromBars(bars, 200),
    vwap: buildVwapSeriesFromBars(bars),
    bbMid,
    bbUpper,
    bbLower,
    ichiTenkan,
    ichiKijun,
    ichiSpanA,
    ichiSpanB,
    ichiChikou,
    zigzag: buildZigZagSeriesFromBars(bars, 5),
    rsi: safeRsi,
    rsiEma9: rsiEma9.length
      ? rsiEma9
      : buildFallbackOscillatorSeries(bars, 9, 0.75),
    rsiWma45: rsiWma45.length
      ? rsiWma45
      : buildFallbackOscillatorSeries(bars, 7, 1.35),
    stochK,
    stochD,
    macd,
    macdSignal,
    macdHistogram,
  };
}

function normalizeIndicatorLineSeries(rawSeries, { min = null, max = null } = {}) {
  return (Array.isArray(rawSeries) ? rawSeries : [])
    .map((point) => {
      const time = Number(point?.time);
      const value = Number(point?.value);
      if (!Number.isFinite(time) || !Number.isFinite(value)) return null;
      let nextValue = value;
      if (Number.isFinite(min)) nextValue = Math.max(min, nextValue);
      if (Number.isFinite(max)) nextValue = Math.min(max, nextValue);
      return { time, value: nextValue };
    })
    .filter(Boolean);
}

function normalizeIndicatorPayload(rawIndicators) {
  if (!rawIndicators || typeof rawIndicators !== "object") return null;
  const next = {
    sma20: normalizeIndicatorLineSeries(rawIndicators.sma20),
    sma50: normalizeIndicatorLineSeries(rawIndicators.sma50),
    sma200: normalizeIndicatorLineSeries(rawIndicators.sma200),
    ema20: normalizeIndicatorLineSeries(rawIndicators.ema20),
    ema50: normalizeIndicatorLineSeries(rawIndicators.ema50),
    ema200: normalizeIndicatorLineSeries(rawIndicators.ema200),
    vwap: normalizeIndicatorLineSeries(rawIndicators.vwap),
    bbMid: normalizeIndicatorLineSeries(rawIndicators.bbMid),
    bbUpper: normalizeIndicatorLineSeries(rawIndicators.bbUpper),
    bbLower: normalizeIndicatorLineSeries(rawIndicators.bbLower),
    ichiTenkan: normalizeIndicatorLineSeries(rawIndicators.ichiTenkan),
    ichiKijun: normalizeIndicatorLineSeries(rawIndicators.ichiKijun),
    ichiSpanA: normalizeIndicatorLineSeries(rawIndicators.ichiSpanA),
    ichiSpanB: normalizeIndicatorLineSeries(rawIndicators.ichiSpanB),
    ichiChikou: normalizeIndicatorLineSeries(rawIndicators.ichiChikou),
    zigzag: normalizeIndicatorLineSeries(rawIndicators.zigzag),
    rsi: normalizeIndicatorLineSeries(rawIndicators.rsi, { min: 0, max: 100 }),
    rsiEma9: normalizeIndicatorLineSeries(rawIndicators.rsiEma9, {
      min: 0,
      max: 100,
    }),
    rsiWma45: normalizeIndicatorLineSeries(rawIndicators.rsiWma45, {
      min: 0,
      max: 100,
    }),
    stochK: normalizeIndicatorLineSeries(rawIndicators.stochK, { min: 0, max: 100 }),
    stochD: normalizeIndicatorLineSeries(rawIndicators.stochD, { min: 0, max: 100 }),
    macd: normalizeIndicatorLineSeries(rawIndicators.macd),
    macdSignal: normalizeIndicatorLineSeries(rawIndicators.macdSignal),
    macdHistogram: (Array.isArray(rawIndicators.macdHistogram) ? rawIndicators.macdHistogram : [])
      .map((point) => {
        const time = Number(point?.time);
        const value = Number(point?.value);
        if (!Number.isFinite(time) || !Number.isFinite(value)) return null;
        return {
          time,
          value,
          color: String(point?.color || (value >= 0
            ? INDICATOR_LINE_STYLE.colors.macdHistogramUp
            : INDICATOR_LINE_STYLE.colors.macdHistogramDown)),
        };
      })
      .filter(Boolean),
  };
  const hasAny = Object.values(next).some(
    (series) => Array.isArray(series) && series.length > 0,
  );
  return hasAny ? next : null;
}

function sliceIndicatorPayloadToBars(indicators, bars = []) {
  if (!indicators || typeof indicators !== "object") return null;
  const firstTime = Number(bars?.[0]?.time);
  const lastTime = Number(bars?.[bars.length - 1]?.time);
  if (!Number.isFinite(firstTime) || !Number.isFinite(lastTime)) {
    return indicators;
  }
  const filterSeries = (series = []) =>
    (Array.isArray(series) ? series : []).filter((point) => {
      const time = Number(point?.time);
      return Number.isFinite(time) && time >= firstTime && time <= lastTime;
    });
  const next = Object.fromEntries(
    Object.entries(indicators).map(([key, series]) => [key, filterSeries(series)]),
  );
  const hasAny = Object.values(next).some(
    (series) => Array.isArray(series) && series.length > 0,
  );
  return hasAny ? next : null;
}

function getLastSeriesValue(series) {
  if (!Array.isArray(series) || !series.length) return null;
  const value = Number(series[series.length - 1]?.value);
  return Number.isFinite(value) ? value : null;
}

function formatSharedObjectLabel(type, rawLabel) {
  const typeText = String(type || "").trim().toLowerCase();
  const labelText = String(rawLabel || "").trim();
  const combined = `${typeText} ${labelText}`.toLowerCase();
  if (combined.includes("liquidity high") || combined.includes("liquidity_high")) {
    return "BSL";
  }
  if (combined.includes("liquidity low") || combined.includes("liquidity_low")) {
    return "SSL";
  }
  if (
    combined.includes("swing high event") ||
    combined.includes("swing high level") ||
    combined.includes("swing_high_event") ||
    combined.includes("swing_high")
  ) {
    return "SH";
  }
  if (
    combined.includes("swing low event") ||
    combined.includes("swing low level") ||
    combined.includes("swing_low_event") ||
    combined.includes("swing_low")
  ) {
    return "SL";
  }
  if (combined.includes("sweep high") || combined.includes("sweep low") || combined.includes("sweep")) {
    return "SW";
  }
  if (combined.includes("choch")) return "CH";
  if (combined.includes("demand")) return "DEM";
  if (combined.includes("supply")) return "SPLY";
  if (combined.includes("support")) return "SUP";
  if (combined.includes("resistance")) return "RES";
  if (combined.includes("liquidity")) return "LIQ";
  if (combined.includes("divergence")) return "DIV";
  if (combined.includes("trendline")) return "TL";
  if (!labelText) return "";
  const normalized = labelText.replace(/^All\s+/i, "").trim();
  return normalized;
}

function snapTimeToNearestCandle(candles = [], targetSec = null) {
  const target = Number(targetSec);
  if (!Array.isArray(candles) || !candles.length || !Number.isFinite(target)) {
    return Number.isFinite(target) ? target : null;
  }
  let bestTime = null;
  let bestDistance = Infinity;
  for (const candle of candles) {
    const time = Number(candle?.time);
    if (!Number.isFinite(time)) continue;
    const distance = Math.abs(time - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTime = time;
    }
  }
  return Number.isFinite(bestTime) ? bestTime : target;
}

function resolveEventMarkerTimeSec(
  candles = [],
  targetSec = null,
  interval = "",
) {
  const target = Number(targetSec);
  if (!Array.isArray(candles) || !candles.length || !Number.isFinite(target)) {
    return null;
  }
  const intervalSec = Math.max(60, intervalToSeconds(interval));
  const minTime = Number(candles[0]?.time);
  const maxTime = Number(candles[candles.length - 1]?.time);
  if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) return null;
  const outsideTolerance = Math.max(intervalSec, 60);
  if (target < minTime - outsideTolerance || target > maxTime + outsideTolerance) {
    return null;
  }
  for (let index = 0; index < candles.length; index += 1) {
    const currentBarTime = Number(candles[index]?.time);
    if (!Number.isFinite(currentBarTime)) continue;
    const nextBarTime = Number(candles[index + 1]?.time);
    const effectiveBarEnd =
      Number.isFinite(nextBarTime) && nextBarTime > currentBarTime
        ? nextBarTime
        : currentBarTime + intervalSec;
    if (target >= currentBarTime && target < effectiveBarEnd) {
      return currentBarTime;
    }
  }
  let nearestBarTime = null;
  let nearestDistance = Infinity;
  for (const candle of candles) {
    const barTime = Number(candle?.time);
    if (!Number.isFinite(barTime)) continue;
    const distance = Math.abs(barTime - target);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestBarTime = barTime;
    }
  }
  if (!Number.isFinite(nearestBarTime)) return null;
  const snapTolerance = Math.max(60, intervalSec);
  return nearestDistance <= snapTolerance ? nearestBarTime : null;
}

function resolveEventMarkerAnchorPrice(
  candles = [],
  targetSec = null,
  placement = "aboveBar",
  fallbackPrice = null,
) {
  const target = Number(targetSec);
  const fallback = Number(fallbackPrice);
  if (!Array.isArray(candles) || !candles.length || !Number.isFinite(target)) {
    return Number.isFinite(fallback) ? fallback : null;
  }
  let bestCandle = null;
  let bestDistance = Infinity;
  for (const candle of candles) {
    const time = Number(candle?.time);
    if (!Number.isFinite(time)) continue;
    const distance = Math.abs(time - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCandle = candle;
    }
  }
  if (!bestCandle) return Number.isFinite(fallback) ? fallback : null;
  const high = Number(bestCandle?.high);
  const low = Number(bestCandle?.low);
  if (placement === "belowBar" && Number.isFinite(low)) return low;
  if (placement === "aboveBar" && Number.isFinite(high)) return high;
  if (Number.isFinite(fallback)) return fallback;
  return Number.isFinite(high) ? high : Number.isFinite(low) ? low : null;
}

/**
 * Lightweight Charts custom primitive that draws a filled semi-transparent rectangle
 * between two price levels from bar_start to the last visible bar.
 */
class PdArrayBoxPrimitive {
  constructor(barStartSec, priceLow, priceHigh, color) {
    this._barStart = barStartSec; // unix seconds
    this._priceLow = priceLow;
    this._priceHigh = priceHigh;
    this._color = color;
    this._series = null;
    this._chart = null;
  }

  attached({ series, chart }) {
    this._series = series;
    this._chart = chart;
  }

  detached() {
    this._series = null;
    this._chart = null;
  }

  updateAllViews() {}

  priceAxisViews() {
    return [];
  }

  paneViews() {
    const self = this;
    return [
      {
        renderer() {
          return {
            draw: (target) => {
              if (!self._series || !self._chart) return;
              target.useBitmapCoordinateSpace((scope) => {
                const ctx = scope.context;
                const r = scope.bitmapSize;
                const ts = self._chart.timeScale();
                const ps = self._series;

                // Convert prices to y-pixels
                const yHigh = ps.priceToCoordinate(self._priceHigh);
                const yLow = ps.priceToCoordinate(self._priceLow);
                if (yHigh == null || yLow == null) return;

                // Convert bar_start time to x-pixel
                const xStart = ts.timeToCoordinate(self._barStart);
                if (xStart == null) return;

                const pixelRatio = scope.horizontalPixelRatio || 1;
                const pixelRatioY = scope.verticalPixelRatio || 1;

                const x0 = Math.max(0, Math.round(xStart * pixelRatio));
                const x1 = r.width;
                const y0 = Math.round(Math.min(yHigh, yLow) * pixelRatioY);
                const y1 = Math.round(Math.max(yHigh, yLow) * pixelRatioY);
                const h = y1 - y0;
                if (h <= 0 || x1 - x0 <= 0) return;

                // Fill
                ctx.save();
                ctx.globalAlpha = 0.18;
                ctx.fillStyle = self._color;
                ctx.fillRect(x0, y0, x1 - x0, h);

                // Border lines (top & bottom)
                ctx.globalAlpha = 0.7;
                ctx.strokeStyle = self._color;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(x1, y0);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x0, y1);
                ctx.lineTo(x1, y1);
                ctx.stroke();
                ctx.restore();
              });
            },
          };
        },
      },
    ];
  }
}
class SignalCreationLinePrimitive {
  constructor(timeSec, color) {
    this._time = timeSec;
    this._color = color;
    this._series = null;
    this._chart = null;
  }
  attached({ series, chart }) {
    this._series = series;
    this._chart = chart;
  }
  detached() {
    this._series = null;
    this._chart = null;
  }
  updateAllViews() {}
  priceAxisViews() {
    return [];
  }
  paneViews() {
    const self = this;
    return [
      {
        renderer() {
          return {
            draw: (target) => {
              if (!self._series || !self._chart) return;
              target.useBitmapCoordinateSpace((scope) => {
                const ctx = scope.context;
                const r = scope.bitmapSize;
                const ts = self._chart.timeScale();
                const x = ts.timeToCoordinate(self._time);
                if (x == null) return;
                const pixelRatio = scope.horizontalPixelRatio || 1;
                const xPos = Math.round(x * pixelRatio);
                ctx.save();
                ctx.strokeStyle = self._color;
                ctx.setLineDash([5, 5]);
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(xPos, 0);
                ctx.lineTo(xPos, r.height);
                ctx.stroke();
                ctx.restore();
              });
            },
          };
        },
      },
    ];
  }
}

class IntradayDayDividerPrimitive {
  constructor(entries = []) {
    this._entries = Array.isArray(entries) ? entries : [];
    this._series = null;
    this._chart = null;
  }

  attached({ series, chart }) {
    this._series = series;
    this._chart = chart;
  }

  detached() {
    this._series = null;
    this._chart = null;
  }

  updateAllViews() {}

  priceAxisViews() {
    return [];
  }

  paneViews() {
    const self = this;
    return [
      {
        renderer() {
          return {
            draw: (target) => {
              if (!self._series || !self._chart || !self._entries.length) return;
              target.useBitmapCoordinateSpace((scope) => {
                const ctx = scope.context;
                const ts = self._chart.timeScale();
                const ratioX = scope.horizontalPixelRatio || 1;
                const ratioY = scope.verticalPixelRatio || 1;
                const width = scope.bitmapSize?.width ?? 0;
                const height = scope.bitmapSize?.height ?? 0;
                if (!width || !height) return;
                const fontPx = Math.max(7, Math.round(7 * ratioY));
                const bottomPad = Math.max(7, Math.round(7 * ratioY));
                let lastLabelX = -Infinity;
                self._entries.forEach((entry) => {
                  const xCoord = ts.timeToCoordinate(Number(entry?.timeSec));
                  if (xCoord == null) return;
                  const x = Math.round(xCoord * ratioX);
                  if (x < 0 || x > width) return;
                  ctx.save();
                  ctx.shadowColor = "rgba(148, 163, 184, 0.18)";
                  ctx.shadowBlur = Math.max(4, Math.round(4 * ratioX));
                  ctx.fillStyle = "rgba(148, 163, 184, 0.08)";
                  const colW = Math.max(1, Math.round(1 * ratioX));
                  ctx.fillRect(x, 0, colW, height);
                  ctx.restore();

                  if (x - lastLabelX < Math.max(18, Math.round(18 * ratioX))) return;
                  const text = String(entry?.label || "").trim();
                  if (!text) return;
                  ctx.save();
                  ctx.font = `${fontPx}px sans-serif`;
                  ctx.fillStyle = "rgba(148, 163, 184, 0.62)";
                  ctx.textAlign = "center";
                  ctx.textBaseline = "bottom";
                  ctx.fillText(text, x, height - bottomPad);
                  ctx.restore();
                  lastLabelX = x;
                });
              });
            },
          };
        },
      },
    ];
  }
}

class SessionOverlayPrimitive {
  constructor(entries = [], meta = {}) {
    this._entries = Array.isArray(entries) ? entries : [];
    this._intervalSec = Math.max(60, Number(meta?.intervalSec) || 60);
    this._lastBarTimeSec = Number.isFinite(Number(meta?.lastBarTimeSec))
      ? Number(meta.lastBarTimeSec)
      : NaN;
    this._prevBarTimeSec = Number.isFinite(Number(meta?.prevBarTimeSec))
      ? Number(meta.prevBarTimeSec)
      : NaN;
    this._series = null;
    this._chart = null;
  }

  attached({ series, chart }) {
    this._series = series;
    this._chart = chart;
  }

  detached() {
    this._series = null;
    this._chart = null;
  }

  updateAllViews() {}

  priceAxisViews() {
    return [];
  }

  paneViews() {
    const self = this;
    return [
      {
        renderer() {
          const resolveX = (timeScale, timeSec) => {
            const direct = timeScale.timeToCoordinate(Number(timeSec));
            if (direct != null) return direct;
            if (!Number.isFinite(self._lastBarTimeSec) || timeSec <= self._lastBarTimeSec) {
              return null;
            }
            const lastCoord = timeScale.timeToCoordinate(self._lastBarTimeSec);
            if (lastCoord == null) return null;
            const prevAnchorTime = Number.isFinite(self._prevBarTimeSec)
              ? self._prevBarTimeSec
              : self._lastBarTimeSec - self._intervalSec;
            const prevCoord = timeScale.timeToCoordinate(prevAnchorTime);
            const inferredSpacing =
              prevCoord != null
                ? lastCoord - prevCoord
                : null;
            if (!Number.isFinite(inferredSpacing) || Math.abs(inferredSpacing) < 0.01) {
              return null;
            }
            const deltaBars = (Number(timeSec) - self._lastBarTimeSec) / self._intervalSec;
            return lastCoord + inferredSpacing * deltaBars;
          };
          return {
            draw: (target) => {
              if (!self._series || !self._chart || !self._entries.length) return;
              target.useBitmapCoordinateSpace((scope) => {
                const ctx = scope.context;
                const ts = self._chart.timeScale();
                const ratioX = scope.horizontalPixelRatio || 1;
                const width = scope.bitmapSize?.width ?? 0;
                const height = scope.bitmapSize?.height ?? 0;
                if (!width || !height) return;
                self._entries.forEach((entry) => {
                  const startCoord = resolveX(ts, Number(entry?.startTimeSec));
                  const endCoord = resolveX(ts, Number(entry?.endTimeSec));
                  if (startCoord == null || endCoord == null) return;
                  const x1 = Math.round(Math.min(startCoord, endCoord) * ratioX);
                  const x2 = Math.round(Math.max(startCoord, endCoord) * ratioX);
                  const boxWidth = Math.max(1, x2 - x1);
                  if (x2 < 0 || x1 > width) return;
                  ctx.save();
                  ctx.fillStyle = entry?.color || "rgba(148, 163, 184, 0.05)";
                  ctx.shadowColor = entry?.shadow || "rgba(148, 163, 184, 0.12)";
                  ctx.shadowBlur = Math.max(14, Math.round(14 * ratioX));
                  ctx.fillRect(x1, 0, boxWidth, height);
                  ctx.restore();
                });
              });
            },
          };
        },
      },
    ];
  }
}

class TimeRangeBoxPrimitive {
  constructor({
    startTimeSec,
    endTimeSec = null,
    fallbackEndTimeSec = null,
    suppressWhenEndCoordinateMissing = false,
    priceLow,
    priceHigh,
    lineColor = "#60a5fa",
    fillColor = "rgba(96,165,250,0.14)",
    extendRight = false,
    lineDash = [],
    lineWidth = 1,
    shadowBlur = 0,
    shadowColor = "",
    label = "",
    labelFontSize = null,
    labelBackgroundColor = "rgba(2, 6, 23, 0.82)",
    labelColor = "",
  }) {
    this._startTime = startTimeSec;
    this._endTime = endTimeSec;
    this._fallbackEndTime =
      Number.isFinite(Number(fallbackEndTimeSec)) ? Number(fallbackEndTimeSec) : null;
    this._suppressWhenEndCoordinateMissing =
      suppressWhenEndCoordinateMissing === true;
    this._priceLow = priceLow;
    this._priceHigh = priceHigh;
    this._lineColor = lineColor;
    this._fillColor = fillColor;
    this._extendRight = extendRight;
    this._lineDash = Array.isArray(lineDash) ? lineDash : [];
    this._lineWidth = Number.isFinite(Number(lineWidth))
      ? Math.max(0.25, Number(lineWidth))
      : 0.25;
    this._shadowBlur = Number.isFinite(Number(shadowBlur)) ? Number(shadowBlur) : 0;
    this._shadowColor = String(shadowColor || "").trim();
    this._label = String(label || "").trim();
    this._labelFontSize = Number.isFinite(Number(labelFontSize))
      ? Math.max(6, Number(labelFontSize))
      : null;
    this._labelBackgroundColor = String(labelBackgroundColor || "rgba(2, 6, 23, 0.82)").trim();
    this._labelColor = String(labelColor || lineColor || "#e2e8f0").trim();
    this._series = null;
    this._chart = null;
  }

  attached({ series, chart }) {
    this._series = series;
    this._chart = chart;
  }

  detached() {
    this._series = null;
    this._chart = null;
  }

  updateAllViews() {}

  priceAxisViews() {
    return [];
  }

  paneViews() {
    const self = this;
    return [
      {
        renderer() {
          return {
            draw: (target) => {
              if (!self._series || !self._chart) return;
              target.useBitmapCoordinateSpace((scope) => {
                const ctx = scope.context;
                const r = scope.bitmapSize;
                const ts = self._chart.timeScale();
                const ps = self._series;
                const yHigh = ps.priceToCoordinate(self._priceHigh);
                const yLow = ps.priceToCoordinate(self._priceLow);
                if (yHigh == null || yLow == null) return;
                const visibleRange =
                  typeof ts.getVisibleLogicalRange === "function"
                    ? ts.getVisibleLogicalRange()
                    : null;
                const logicalStart =
                  visibleRange && Number.isFinite(Number(visibleRange.from))
                    ? Number(visibleRange.from)
                    : null;
                const logicalEnd =
                  visibleRange && Number.isFinite(Number(visibleRange.to))
                    ? Number(visibleRange.to)
                    : null;
                const timeAtLogicalStart =
                  Number.isFinite(logicalStart) &&
                  typeof ts.coordinateToTime === "function"
                    ? ts.coordinateToTime(logicalStart)
                    : null;
                const timeAtLogicalEnd =
                  Number.isFinite(logicalEnd) &&
                  typeof ts.coordinateToTime === "function"
                    ? ts.coordinateToTime(logicalEnd)
                    : null;
                const visibleStartTime = lwTimeToEpochSec(timeAtLogicalStart);
                const visibleEndTime = lwTimeToEpochSec(timeAtLogicalEnd);
                const rawXStart = ts.timeToCoordinate(self._startTime);
                const xEnd = self._endTime
                  ? ts.timeToCoordinate(self._endTime)
                  : null;
                const fallbackXEnd = self._fallbackEndTime
                  ? ts.timeToCoordinate(self._fallbackEndTime)
                  : null;
                if (
                  self._suppressWhenEndCoordinateMissing &&
                  xEnd == null &&
                  !Number.isFinite(fallbackXEnd)
                ) {
                  return;
                }
                const pixelRatioX = scope.horizontalPixelRatio || 1;
                const pixelRatioY = scope.verticalPixelRatio || 1;
                const x0 =
                  rawXStart == null
                    ? Number.isFinite(visibleStartTime)
                      ? self._startTime < visibleStartTime
                        ? 0
                        : null
                      : 0
                    : Math.max(0, Math.round(rawXStart * pixelRatioX));
                const x1 =
                  self._extendRight || xEnd == null
                    ? xEnd == null && Number.isFinite(fallbackXEnd)
                      ? Math.min(r.width, Math.round(fallbackXEnd * pixelRatioX))
                      : Number.isFinite(visibleEndTime) &&
                        Number.isFinite(self._endTime) &&
                        self._endTime < visibleStartTime
                        ? null
                        : r.width
                    : Math.min(r.width, Math.round(xEnd * pixelRatioX));
                if (!Number.isFinite(x0) || !Number.isFinite(x1)) return;
                const y0 = Math.round(Math.min(yHigh, yLow) * pixelRatioY);
                const y1 = Math.round(Math.max(yHigh, yLow) * pixelRatioY);
                if (x1 <= x0 || y1 <= y0) return;
                ctx.save();
                ctx.fillStyle = self._fillColor;
                if (self._shadowBlur > 0) {
                  ctx.shadowColor = self._shadowColor || self._lineColor;
                  ctx.shadowBlur = self._shadowBlur;
                }
                ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
                if (self._lineWidth > 0) {
                  ctx.strokeStyle = self._lineColor;
                  ctx.lineWidth = self._lineWidth;
                  if (self._lineDash.length) ctx.setLineDash(self._lineDash);
                  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
                }
                if (self._label && x1 - x0 >= 20) {
                  ctx.setLineDash([]);
                  ctx.shadowBlur = 0;
                  const baseFontSize = Number.isFinite(self._labelFontSize)
                    ? self._labelFontSize
                    : ARTIFACT_LABEL_FONT_SIZE;
                  const fontPx = Math.max(
                    baseFontSize,
                    Math.round(baseFontSize * pixelRatioY),
                  );
                  ctx.font = `${fontPx}px sans-serif`;
                  ctx.textBaseline = "top";
                  const textWidth = ctx.measureText(self._label).width;
                  const padX = Math.max(2, Math.round(2 * pixelRatioX));
                  const padY = Math.max(1, Math.round(1 * pixelRatioY));
                  const chipH = fontPx + padY * 2;
                  const chipW = Math.min(
                    x1 - x0 - padX * 2,
                    Math.ceil(textWidth + padX * 2),
                  );
                  if (chipW >= 12) {
                    const chipX = Math.max(x0 + padX, x1 - chipW - padX);
                    const chipY = Math.max(
                      0,
                      Math.min(y1 - chipH, Math.round((y0 + y1 - chipH) / 2)),
                    );
                    ctx.fillStyle = self._labelBackgroundColor;
                    ctx.fillRect(chipX, chipY, chipW, chipH);
                    ctx.fillStyle = self._labelColor || self._lineColor;
                    ctx.fillText(self._label, chipX + padX, chipY + padY);
                  }
                }
                ctx.restore();
              });
            },
          };
        },
      },
    ];
  }
}

class EventTimeMarkerPrimitive {
  constructor({
    timeSec,
    price,
    color = "#facc15",
    text = "",
    placement = "aboveBar",
    shape = "auto",
    markerSize = null,
  }) {
    this._timeSec = Number(timeSec);
    this._price = Number(price);
    this._color = String(color || "#facc15");
    this._text = String(text || "").trim();
    this._placement = String(placement || "aboveBar");
    this._shape = String(shape || "auto").trim().toLowerCase();
    this._markerSize = Number.isFinite(Number(markerSize))
      ? Math.max(1.5, Number(markerSize))
      : null;
    this._series = null;
    this._chart = null;
  }

  attached({ series, chart }) {
    this._series = series;
    this._chart = chart;
  }

  detached() {
    this._series = null;
    this._chart = null;
  }

  updateAllViews() {}

  priceAxisViews() {
    return [];
  }

  paneViews() {
    const self = this;
    return [
      {
        renderer() {
          return {
            draw: (target) => {
              if (!self._series || !self._chart) return;
              target.useBitmapCoordinateSpace((scope) => {
                const ctx = scope.context;
                const ts = self._chart.timeScale();
                const ps = self._series;
                const xCoord = ts.timeToCoordinate(self._timeSec);
                const priceY = ps.priceToCoordinate(self._price);
                if (xCoord == null || priceY == null) return;

                const ratioX = scope.horizontalPixelRatio || 1;
                const ratioY = scope.verticalPixelRatio || 1;
                const bitmapWidth = scope.bitmapSize?.width ?? null;
                const bitmapHeight = scope.bitmapSize?.height ?? null;
                const x = Math.round(xCoord * ratioX);
                const baseY = Math.round(priceY * ratioY);
                const shape =
                  self._shape === "auto"
                    ? self._placement === "inBar"
                      ? "circle"
                      : self._placement === "belowBar"
                        ? "arrowup"
                        : "arrowdown"
                    : self._shape;
                const isCircle = shape === "circle" || shape === "dot";
                const circleRadius = Math.max(
                  Math.round((self._markerSize || 2.5) * Math.max(ratioX, ratioY)),
                  2,
                );
                if (isCircle) {
                  ctx.save();
                  ctx.fillStyle = self._color;
                  ctx.beginPath();
                  ctx.arc(x, baseY, circleRadius, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.restore();
                  return;
                }
                const direction =
                  shape === "arrowup"
                    ? 1
                    : shape === "arrowdown"
                      ? -1
                      : self._placement === "belowBar"
                        ? 1
                        : -1;
                const markerOffset = Math.max(7, Math.round(8 * ratioY));
                const chartPaddingY = Math.max(14, Math.round(14 * ratioY));
                let effectiveDirection = direction;
                if (Number.isFinite(bitmapHeight)) {
                  const desiredMarkerY = baseY + effectiveDirection * markerOffset;
                  if (desiredMarkerY < chartPaddingY) effectiveDirection = 1;
                  if (desiredMarkerY > bitmapHeight - chartPaddingY) effectiveDirection = -1;
                }
                const markerY = Number.isFinite(bitmapHeight)
                  ? Math.max(
                      chartPaddingY,
                      Math.min(bitmapHeight - chartPaddingY, baseY + effectiveDirection * markerOffset),
                    )
                  : baseY + effectiveDirection * markerOffset;
                const arrowHeight = Math.max(4, Math.round(5 * ratioY));
                const arrowHalfWidth = Math.max(3, Math.round(3 * ratioX));
                const arrowCenterY = markerY;
                const arrowTipY = arrowCenterY + effectiveDirection * Math.round(arrowHeight * 0.6);
                const arrowBaseY = arrowCenterY - effectiveDirection * Math.round(arrowHeight * 0.55);
                const textOffsetX = Math.round(3 * ratioX);
                const textOffsetY = effectiveDirection < 0 ? -5 : 7;
                ctx.save();

                const artifactFontSize = Math.max(
                  ARTIFACT_LABEL_FONT_SIZE,
                  Math.round(ARTIFACT_LABEL_FONT_SIZE * ratioY),
                );
                let labelY = markerY + Math.round(textOffsetY * ratioY);
                if (self._text) {
                  ctx.font = `${artifactFontSize}px sans-serif`;
                  const measuredTextWidth = Math.ceil(ctx.measureText(self._text).width);
                  const safePadding = Math.round(8 * ratioX);
                  let labelX = x + textOffsetX;
                  let textAlign = "left";
                  if (
                    Number.isFinite(bitmapWidth) &&
                    labelX + measuredTextWidth + safePadding > bitmapWidth
                  ) {
                    labelX = x - textOffsetX;
                    textAlign = "right";
                  }
                  if (Number.isFinite(bitmapWidth)) {
                    const minX = safePadding;
                    const maxX = Math.max(minX, bitmapWidth - safePadding);
                    labelX = Math.min(Math.max(labelX, minX), maxX);
                  }
                  if (Number.isFinite(bitmapHeight)) {
                    const minY = artifactFontSize + safePadding;
                    const maxY = Math.max(minY, bitmapHeight - safePadding);
                    labelY = Math.min(Math.max(labelY, minY), maxY);
                  }

                  ctx.fillStyle = self._color;
                  ctx.textAlign = textAlign;
                  ctx.textBaseline = effectiveDirection < 0 ? "bottom" : "top";
                  ctx.fillText(self._text, labelX, labelY);
                }

                ctx.fillStyle = self._color;
                ctx.beginPath();
                if (shape === "arrowdown") {
                  ctx.moveTo(x, arrowTipY);
                  ctx.lineTo(x - arrowHalfWidth, arrowBaseY);
                  ctx.lineTo(x + arrowHalfWidth, arrowBaseY);
                } else {
                  ctx.moveTo(x, arrowTipY);
                  ctx.lineTo(x - arrowHalfWidth, arrowBaseY);
                  ctx.lineTo(x + arrowHalfWidth, arrowBaseY);
                }
                ctx.closePath();
                ctx.fill();
                ctx.restore();
              });
            },
          };
        },
      },
    ];
  }
}

class SegmentLinePrimitive {
  constructor({
    startTimeSec,
    endTimeSec,
    startPrice,
    endPrice,
    color = "#60a5fa",
    lineDash = [],
    lineWidth = 1,
    label = "",
  }) {
    this._startTimeSec = Number(startTimeSec);
    this._endTimeSec = Number(endTimeSec);
    this._startPrice = Number(startPrice);
    this._endPrice = Number(endPrice);
    this._color = String(color || "#60a5fa");
    this._lineDash = Array.isArray(lineDash) ? lineDash : [];
    this._lineWidth = Number.isFinite(Number(lineWidth))
      ? Math.max(0.2, Number(lineWidth))
      : ARTIFACT_LINE_WIDTH;
    this._label = String(label || "").trim();
    this._series = null;
    this._chart = null;
  }

  attached({ series, chart }) {
    this._series = series;
    this._chart = chart;
  }

  detached() {
    this._series = null;
    this._chart = null;
  }

  updateAllViews() {}

  priceAxisViews() {
    return [];
  }

  paneViews() {
    const self = this;
    return [
      {
        renderer() {
          return {
            draw: (target) => {
              if (!self._series || !self._chart) return;
              target.useBitmapCoordinateSpace((scope) => {
                const ts = self._chart.timeScale();
                const ps = self._series;
                const x1Coord = ts.timeToCoordinate(self._startTimeSec);
                const x2Coord = ts.timeToCoordinate(self._endTimeSec);
                const y1Coord = ps.priceToCoordinate(self._startPrice);
                const y2Coord = ps.priceToCoordinate(self._endPrice);
                if (x1Coord == null || x2Coord == null || y1Coord == null || y2Coord == null) return;
                const ctx = scope.context;
                const ratioX = scope.horizontalPixelRatio || 1;
                const ratioY = scope.verticalPixelRatio || 1;
                const x1 = Math.round(x1Coord * ratioX);
                const x2 = Math.round(x2Coord * ratioX);
                const y1 = Math.round(y1Coord * ratioY);
                const y2 = Math.round(y2Coord * ratioY);
                ctx.save();
                ctx.strokeStyle = self._color;
                ctx.lineWidth = Math.max(0.6, self._lineWidth * ratioY);
                if (self._lineDash.length) ctx.setLineDash(self._lineDash);
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
                if (self._label) {
                  const fontPx = Math.max(
                    ARTIFACT_LABEL_FONT_SIZE,
                    Math.round(ARTIFACT_LABEL_FONT_SIZE * ratioY),
                  );
                  ctx.setLineDash([]);
                  ctx.font = `${fontPx}px sans-serif`;
                  ctx.fillStyle = self._color;
                  ctx.textBaseline = y2 <= y1 ? "bottom" : "top";
                  ctx.textAlign = "left";
                  ctx.fillText(self._label, x2 + Math.round(6 * ratioX), y2);
                }
                ctx.restore();
              });
            },
          };
        },
      },
    ];
  }
}

class PriceTagPrimitive {
  constructor({
    price,
    label = "",
    color = "#60a5fa",
    background = "rgba(2, 6, 23, 0.82)",
  }) {
    this._price = Number(price);
    this._label = String(label || "").trim();
    this._color = color;
    this._background = background;
    this._series = null;
    this._chart = null;
  }

  attached({ series, chart }) {
    this._series = series;
    this._chart = chart;
  }

  detached() {
    this._series = null;
    this._chart = null;
  }

  updateAllViews() {}

  priceAxisViews() {
    return [];
  }

  paneViews() {
    const self = this;
    return [
      {
        renderer() {
          return {
            draw: (target) => {
              if (!self._series || !self._chart || !self._label) return;
              target.useBitmapCoordinateSpace((scope) => {
                const ctx = scope.context;
                const r = scope.bitmapSize;
                const y = self._series.priceToCoordinate(self._price);
                if (y == null) return;
                const pixelRatioX = scope.horizontalPixelRatio || 1;
                const pixelRatioY = scope.verticalPixelRatio || 1;
                const yPos = Math.round(y * pixelRatioY);
                if (yPos < 0 || yPos > r.height) return;
                const fontPx = Math.max(10, Math.round(10 * pixelRatioY));
                const padX = Math.max(4, Math.round(4 * pixelRatioX));
                const padY = Math.max(2, Math.round(2 * pixelRatioY));
                ctx.save();
                ctx.font = `${fontPx}px sans-serif`;
                const textWidth = ctx.measureText(self._label).width;
                const chipW = Math.ceil(textWidth + padX * 2);
                const chipH = fontPx + padY * 2;
                const chipX = Math.max(4, Math.round(6 * pixelRatioX));
                const chipY = Math.max(
                  0,
                  Math.min(r.height - chipH, yPos - Math.round(chipH / 2)),
                );
                ctx.fillStyle = self._background;
                ctx.fillRect(chipX, chipY, chipW, chipH);
                ctx.strokeStyle = self._color;
                ctx.lineWidth = 1;
                ctx.strokeRect(chipX, chipY, chipW, chipH);
                ctx.fillStyle = self._color;
                ctx.textBaseline = "top";
                ctx.fillText(self._label, chipX + padX, chipY + padY);
                ctx.restore();
              });
            },
          };
        },
      },
    ];
  }
}

class HorizontalPriceLinePrimitive {
  constructor({
    price,
    label = "",
    color = "#60a5fa",
    lineDash = ARTIFACT_LINE_DASH,
    lineWidth = ARTIFACT_LINE_WIDTH,
    background = "rgba(2, 6, 23, 0.82)",
  }) {
    this._price = Number(price);
    this._label = String(label || "").trim();
    this._color = color;
    this._lineDash = Array.isArray(lineDash) ? lineDash : ARTIFACT_LINE_DASH;
    this._lineWidth = Number.isFinite(Number(lineWidth))
      ? Math.max(0.2, Number(lineWidth))
      : ARTIFACT_LINE_WIDTH;
    this._background = background;
    this._series = null;
    this._chart = null;
  }

  attached({ series, chart }) {
    this._series = series;
    this._chart = chart;
  }

  detached() {
    this._series = null;
    this._chart = null;
  }

  updateAllViews() {}

  priceAxisViews() {
    return [];
  }

  paneViews() {
    const self = this;
    return [
      {
        renderer() {
          return {
            draw: (target) => {
              if (!self._series || !self._chart) return;
              target.useBitmapCoordinateSpace((scope) => {
                const ctx = scope.context;
                const r = scope.bitmapSize;
                const y = self._series.priceToCoordinate(self._price);
                if (y == null) return;
                const pixelRatioX = scope.horizontalPixelRatio || 1;
                const pixelRatioY = scope.verticalPixelRatio || 1;
                const yPos = Math.round(y * pixelRatioY);
                if (yPos < 0 || yPos > r.height) return;

                ctx.save();
                ctx.strokeStyle = self._color;
                const strokeWidth = Math.max(0.6, self._lineWidth * pixelRatioY);
                const strokeDash = self._lineDash.length
                  ? self._lineDash.map((part) =>
                      Math.max(1, Number(part || 0) * pixelRatioX),
                    )
                  : [];

                ctx.save();
                ctx.strokeStyle = self._color;
                ctx.lineWidth = strokeWidth;
                ctx.lineCap = "round";
                if (strokeDash.length) ctx.setLineDash(strokeDash);
                ctx.beginPath();
                ctx.moveTo(0, yPos);
                ctx.lineTo(r.width, yPos);
                ctx.stroke();

                if (self._label) {
                  ctx.setLineDash([]);
                  const fontPx = Math.max(
                    ARTIFACT_LABEL_FONT_SIZE,
                    Math.round(ARTIFACT_LABEL_FONT_SIZE * pixelRatioY),
                  );
                  const padX = Math.max(4, Math.round(4 * pixelRatioX));
                  const padY = Math.max(2, Math.round(2 * pixelRatioY));
                  ctx.font = `${fontPx}px sans-serif`;
                  const textWidth = ctx.measureText(self._label).width;
                  const chipW = Math.ceil(textWidth + padX * 2);
                  const chipH = fontPx + padY * 2;
                  const chipX = Math.max(4, Math.round(6 * pixelRatioX));
                  const chipY = Math.max(
                    0,
                    Math.min(r.height - chipH, yPos - chipH - Math.round(2 * pixelRatioY)),
                  );
                  ctx.fillStyle = self._background;
                  ctx.fillRect(chipX, chipY, chipW, chipH);
                  ctx.strokeStyle = self._color;
                  ctx.lineWidth = 1;
                  ctx.strokeRect(chipX, chipY, chipW, chipH);
                  ctx.fillStyle = self._color;
                  ctx.textBaseline = "top";
                  ctx.fillText(self._label, chipX + padX, chipY + padY);
                }
                ctx.restore();
              });
            },
          };
        },
      },
    ];
  }
}

class HorizontalPriceSegmentPrimitive {
  constructor({
    price,
    startTimeSec,
    endTimeSec = null,
    label = "",
    labelAlign = "left",
    color = "#60a5fa",
    lineDash = ARTIFACT_LINE_DASH,
    lineWidth = ARTIFACT_LINE_WIDTH,
    background = "rgba(2, 6, 23, 0.82)",
  }) {
    this._price = Number(price);
    this._startTime = Number(startTimeSec);
    this._endTime = Number.isFinite(Number(endTimeSec))
      ? Number(endTimeSec)
      : NaN;
    this._label = String(label || "").trim();
    this._labelAlign = String(labelAlign || "left").trim().toLowerCase() === "right"
      ? "right"
      : "left";
    this._color = color;
    this._lineDash = Array.isArray(lineDash) ? lineDash : ARTIFACT_LINE_DASH;
    this._lineWidth = Number.isFinite(Number(lineWidth))
      ? Math.max(0.2, Number(lineWidth))
      : ARTIFACT_LINE_WIDTH;
    this._background = background;
    this._series = null;
    this._chart = null;
  }

  attached({ series, chart }) {
    this._series = series;
    this._chart = chart;
  }

  detached() {
    this._series = null;
    this._chart = null;
  }

  updateAllViews() {}

  priceAxisViews() {
    return [];
  }

  paneViews() {
    const self = this;
    return [
      {
        renderer() {
          return {
            draw: (target) => {
              if (!self._series || !self._chart) return;
              if (!Number.isFinite(self._price) || !Number.isFinite(self._startTime)) return;
              target.useBitmapCoordinateSpace((scope) => {
                const ctx = scope.context;
                const r = scope.bitmapSize;
                const ts = self._chart.timeScale();
                const y = self._series.priceToCoordinate(self._price);
                const rawXStart = ts.timeToCoordinate(self._startTime);
                if (y == null) return;
                const xStart = rawXStart == null ? 0 : rawXStart;
                const xEnd = Number.isFinite(self._endTime)
                  ? ts.timeToCoordinate(self._endTime)
                  : r.width / (scope.horizontalPixelRatio || 1);
                if (xEnd == null) return;
                if (xStart == null) return;
                const pixelRatioX = scope.horizontalPixelRatio || 1;
                const pixelRatioY = scope.verticalPixelRatio || 1;
                const yPos = Math.round(y * pixelRatioY);
                const x0 = Math.max(0, Math.round(Math.min(xStart, xEnd) * pixelRatioX));
                const x1 = Math.min(r.width, Math.round(Math.max(xStart, xEnd) * pixelRatioX));
                if (yPos < 0 || yPos > r.height || x1 <= x0) return;

                const strokeWidth = Math.max(0.6, self._lineWidth * pixelRatioY);
                const strokeDash = self._lineDash.length
                  ? self._lineDash.map((part) =>
                      Math.max(1, Number(part || 0) * pixelRatioX),
                    )
                  : [];

                ctx.save();
                ctx.strokeStyle = self._color;
                ctx.lineWidth = strokeWidth;
                ctx.lineCap = "round";
                if (strokeDash.length) ctx.setLineDash(strokeDash);
                ctx.beginPath();
                ctx.moveTo(x0, yPos);
                ctx.lineTo(x1, yPos);
                ctx.stroke();

                if (self._label && x1 - x0 >= 18) {
                  ctx.setLineDash([]);
                  const fontPx = Math.max(
                    ARTIFACT_LABEL_FONT_SIZE,
                    Math.round(ARTIFACT_LABEL_FONT_SIZE * pixelRatioY),
                  );
                  const padX = Math.max(3, Math.round(3 * pixelRatioX));
                  const padY = Math.max(1, Math.round(1 * pixelRatioY));
                  ctx.font = `${fontPx}px sans-serif`;
                  const textWidth = ctx.measureText(self._label).width;
                  const chipW = Math.ceil(textWidth + padX * 2);
                  const chipH = fontPx + padY * 2;
                  const chipX = self._labelAlign === "right"
                    ? Math.max(x0 + padX, x1 - chipW - padX)
                    : x0 + padX;
                  const chipY = Math.max(0, yPos - chipH - padY);
                  ctx.fillStyle = self._background;
                  ctx.fillRect(chipX, chipY, chipW, chipH);
                  ctx.fillStyle = self._color;
                  ctx.textBaseline = "top";
                  ctx.fillText(self._label, chipX + padX, chipY + padY);
                }
                ctx.restore();
              });
            },
          };
        },
      },
    ];
  }
}

export default function TradeSignalChart({
  chartId = "",
  symbol = "BTCUSDT",
  provider = "",
  interval = "1h",
  height = 320,
  historicalData = [],
  visibleBarsCount = 0,
  live = true,
  side = null,
  action = null,
  entryPrice = null,
  slPrice = null,
  tpPrice = null,
  tp1Price = null,
  tp2Price = null,
  tp3Price = null,
  createdAt = null,
  createdAtSec = null,
  openedAt = null,
  openedAtSec = null,
  closedAt = null,
  closedAtSec = null,
  closeStatus = "",
  exitPrice = null,
  pnlRealized = null,
  tradeLabel = "",
  trades = [],
  selectedTradeSid = "",
  analysisSnapshot = null,
  showPrimaryPlan = true,
  showExtraPlans = true,
  onPlanLevelChange = null,
  syncedCrosshair = null,
  onCrosshairSync = null,
  onBarsLoaded = null,
  sharedLines = [],
  sharedObjects = [],
  onContextRequest = null,
  onViewportChange = null,
  initialViewport = null,
  showIndicators = false,
  showIndicatorPanel = false,
  showIndicatorButton = true,
  indicatorPanelOpen = null,
  onIndicatorPanelToggle = null,
  indicatorVisibilityConfig = null,
  onIndicatorVisibilityChange = null,
  isReplayActive = false,
  replayClockTimeSec = null,
  animateTradeViewport = false,
  preferTradeAnchoredViewport = true,
  autoFitNonce = 0,
  preserveViewportOnBarsChange = false,
  viewportCommand = null,
}) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const currentBarsRef = useRef([]);
  const lastCrosshairContextRef = useRef({
    time: null,
    price: null,
  });
  const preserveViewportOnBarsChangeRef = useRef(
    Boolean(preserveViewportOnBarsChange),
  );
  const lastHandledAutoFitNonceRef = useRef(null);
  const indicatorSeriesRefs = useRef({});
  const indicatorDataRef = useRef({});
  const suppressCrosshairSyncRef = useRef(false);
  const runtimeViewportRef = useRef(null);
  const lastRenderedBarsSignatureRef = useRef("");
  const lastSharedOverlayRenderSignatureRef = useRef("");
  const renderSharedOverlayArtifactsRef = useRef(() => false);
  const lastAutoFitSignatureRef = useRef("");
  const pricePrecisionRef = useRef(5);
  const hoverPriceLinesRef = useRef({ lines: [] });
  const planPriceLinesRef = useRef([]);
  const draggablePlanLineRefs = useRef({
    entry: null,
    tp1: null,
    sl: null,
  });
  const tradeOverlayPriceLinesRef = useRef([]);
  const tradeOverlayPrimitivesRef = useRef([]);
  const dayDividerPrimitivesRef = useRef([]);
  const sessionOverlayPrimitivesRef = useRef([]);
  const sharedOverlayPriceLinesRef = useRef([]);
  const sharedOverlayLineSeriesRef = useRef([]);
  const sharedOverlayPrimitivesRef = useRef([]);
  const hoverMarkersRef = useRef([]);
  const seriesMarkersRef = useRef(null);
  const candleHoverPriceLineRef = useRef(null);
  const indicatorHoverPriceLinesRef = useRef({});
  const levelPriceMapRef = useRef({
    entry: null,
    tp: null,
    tp1: null,
    sl: null,
  });
  const planHandleDragRef = useRef(null);
  const compactViewportBarsRef = useRef(COMPACT_VIEWPORT_DEFAULT_BARS);
  const explicitVisibleBarsTarget = Math.max(
    0,
    Math.round(Number(visibleBarsCount) || 0),
  );
  const [loading, setLoading] = useState(false);
  const [planDragHandles, setPlanDragHandles] = useState([]);
  const [dataSource, setDataSource] = useState("");
  const [isIndicatorPanelOpen, setIsIndicatorPanelOpen] = useState(false);
  const [indicatorVisibility, setIndicatorVisibility] = useState(
    DEFAULT_INDICATOR_VISIBILITY,
  );
  const [indicatorValues, setIndicatorValues] = useState({});
  const [indicatorOverlayHeight, setIndicatorOverlayHeight] = useState(RSI_PANE_HEIGHT);
  const [timezoneTick, setTimezoneTick] = useState(0);
  const displayTimezone = useMemo(
    () => getEffectiveDisplayTimezone(),
    [timezoneTick],
  );
  const createdAtEpochSec = useMemo(
    () =>
      (Number.isFinite(Number(createdAtSec)) && Number(createdAtSec) > 0
        ? Number(createdAtSec)
        : null) ?? toEpochSec(createdAt),
    [createdAt, createdAtSec],
  );
  const openedAtEpochSec = useMemo(
    () =>
      (Number.isFinite(Number(openedAtSec)) && Number(openedAtSec) > 0
        ? Number(openedAtSec)
        : null) ?? toEpochSec(openedAt),
    [openedAt, openedAtSec],
  );
  const closedAtEpochSec = useMemo(
    () =>
      (Number.isFinite(Number(closedAtSec)) && Number(closedAtSec) > 0
        ? Number(closedAtSec)
        : null) ?? toEpochSec(closedAt),
    [closedAt, closedAtSec],
  );
  const normalizedTrades = useMemo(() => {
    return normalizeTradeRowsForChart(trades, tradeLabel).map((trade) => ({
      ...trade,
      sourceTrade:
        trades?.find(
          (row) => String(row?.sid || row?.id || "") === String(trade.sid),
        ) || null,
      openedAtSec:
        trade.openedAtSec ??
        (trade?.openedAt ? toEpochSec(trade.openedAt) : null),
      closedAtSec:
        trade.closedAtSec ??
        (trade?.closedAt ? toEpochSec(trade.closedAt) : null),
      createdAtSec:
        trade.createdAtSec ??
        (() => {
          const source = trades?.find(
            (row) => String(row?.sid || row?.id || "") === String(trade.sid),
          );
          return source?.createdAt
            ? toEpochSec(source.createdAt)
            : source?.created_at
              ? toEpochSec(source.created_at)
              : null;
        })(),
    }));
  }, [trades, tradeLabel]);
  const formatMarkerTimeLabel = useCallback(
    (timeSec) => {
      const numeric = Number(timeSec);
      if (!Number.isFinite(numeric) || numeric <= 0) return "n/a";
      return formatChartDateTime(numeric * 1000, displayTimezone);
    },
    [displayTimezone],
  );
  const summarizeRuleExpression = useCallback((node) => {
    if (node == null) return "";
    if (Array.isArray(node)) {
      return node
        .map((item) => summarizeRuleExpression(item))
        .filter(Boolean)
        .join(" AND ");
    }
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
      return String(node);
    }
    if (typeof node !== "object") return "";
    const fn = String(node?.fn || "").trim();
    if (fn) {
      const args = Array.isArray(node?.args)
        ? node.args
            .map((arg) => {
              if (arg == null) return "";
              if (typeof arg === "string") return arg;
              if (typeof arg === "object") {
                const key = String(arg?.key || arg?.name || arg?.field || "").trim();
                const value = compactTooltipText(
                  arg?.value ?? arg?.tf ?? arg?.bias ?? arg?.level ?? "",
                  "",
                );
                return [key, value].filter(Boolean).join(": ");
              }
              return String(arg);
            })
            .filter(Boolean)
            .join(", ")
        : "";
      return `${fn}${args ? `(${args})` : "()"}`;
    }
    const op = String(node?.op || node?.operator || "").trim().toLowerCase();
    if (op && Array.isArray(node?.conditions) && node.conditions.length) {
      const parts = node.conditions
        .map((item) => summarizeRuleExpression(item))
        .filter(Boolean);
      return parts.length ? `(${parts.join(` ${op.toUpperCase()} `)})` : op.toUpperCase();
    }
    if (op === "not" && node?.condition) {
      return `NOT (${summarizeRuleExpression(node.condition)})`;
    }
    const left = summarizeRuleExpression(node?.left ?? node?.lhs ?? node?.a);
    const right = summarizeRuleExpression(node?.right ?? node?.rhs ?? node?.b);
    if (op && left && right) {
      return `${left} ${op} ${right}`;
    }
    const variable = String(node?.var || node?.field || node?.path || "").trim();
    if (variable) return variable;
    return compactTooltipText(node, "");
  }, []);
  const summarizeMarkerActions = useCallback((actions = []) => {
    const parts = (Array.isArray(actions) ? actions : [])
      .map((actionItem) => {
        const label = String(
          actionItem?.label ||
            actionItem?.message ||
            actionItem?.action ||
            actionItem?.type ||
            "",
        ).trim();
        const direction = String(actionItem?.trade_plan?.direction || "").trim();
        return [label, direction].filter(Boolean).join(" · ");
      })
      .filter(Boolean);
    return parts.length ? parts.join("\n") : "";
  }, []);
  const registerHoverMarker = useCallback((marker = {}) => {
    const timeSec = Number(marker?.timeSec);
    const price = Number(marker?.price);
    if (!Number.isFinite(timeSec) || !Number.isFinite(price)) return;
    hoverMarkersRef.current.push({
      id: String(marker?.id || `${marker?.overlayType || "marker"}-${timeSec}-${price}`),
      overlayType: String(marker?.overlayType || "marker"),
      timeSec,
      price,
      tooltipHtml: String(marker?.tooltipHtml || "").trim(),
      tooltipText: String(marker?.tooltipText || "").trim(),
    });
  }, []);
  const clearHoverMarkers = useCallback((overlayTypes = []) => {
    const blocked = new Set(
      (Array.isArray(overlayTypes) ? overlayTypes : [overlayTypes])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    );
    if (!blocked.size) {
      hoverMarkersRef.current = [];
      return;
    }
    hoverMarkersRef.current = hoverMarkersRef.current.filter(
      (item) => !blocked.has(String(item?.overlayType || "").trim()),
    );
  }, []);
  const buildTradeMarkerTooltipHtml = useCallback(
    ({
      trade = {},
      markerKind = "trade",
      markerLabel = "",
      eventTimeSec = null,
    } = {}) => {
      const source = trade?.sourceTrade && typeof trade.sourceTrade === "object"
        ? trade.sourceTrade
        : trade || {};
      const strategyName = compactTooltipText(
        source?.strategy_name ||
          source?.strategyName ||
          source?.tradeLabel ||
          trade?.tradeLabel ||
          "",
        "Trade",
      );
      const tradeDecision = compactTooltipText(
        source?.trade_decision ||
          source?.tradeDecision ||
          source?.action_decision ||
          source?.actionDecision ||
          source?.decision ||
          source?.position_management?.trade_decision ||
          source?.plan?.trade_decision ||
          "",
        "",
      );
      const rulesChecked = compactTooltipText(
        source?.rules_checked ||
          source?.rulesChecked ||
          source?.rule_checks ||
          source?.ruleChecks ||
          "",
        "",
      );
      const reasons = compactTooltipText(
        source?.close_reason ||
          source?.closeReason ||
          source?.rejection_reason ||
          source?.rejectionReason ||
          source?.reason ||
          source?.skip_reason ||
          source?.skipReason ||
          source?.reasons_to_skip ||
          source?.reasonsToSkip ||
          "",
        "",
      );
      const sideText = compactTooltipText(trade?.side || source?.side, "n/a");
      const markerText = compactTooltipText(markerLabel || markerKind, "Trade");
      const markerKindText = compactTooltipText(markerKind, "trade");
      const statusText = compactTooltipText(trade?.closeStatus, "");
      const sidText = compactTooltipText(trade?.sid || source?.sid || "", "");
      const entryText = Number.isFinite(Number(trade?.entry))
        ? formatPriceWithPrecision(trade?.entry, pricePrecisionRef.current)
        : "";
      const slText = Number.isFinite(Number(trade?.sl))
        ? formatPriceWithPrecision(trade?.sl, pricePrecisionRef.current)
        : "";
      const tpText = Number.isFinite(Number(trade?.tp))
        ? formatPriceWithPrecision(trade?.tp, pricePrecisionRef.current)
        : "";
      const exitText = Number.isFinite(Number(trade?.exitPrice))
        ? formatPriceWithPrecision(trade?.exitPrice, pricePrecisionRef.current)
        : "";
      const pnlValue = Number(trade?.pnlRealized);
      const rValue = Number(trade?.rMultiple);
      const pnlText = Number.isFinite(pnlValue) ? compactTooltipText(trade.pnlRealized, "") : "";
      const rText = Number.isFinite(rValue) ? compactTooltipText(trade.rMultiple, "") : "";
      const sideKey = sideText.toUpperCase();
      const isBuy = sideKey === "BUY";
      const isSell = sideKey === "SELL";
      const pnlTone =
        Number.isFinite(pnlValue) && pnlValue > 0
          ? "#22c55e"
          : Number.isFinite(pnlValue) && pnlValue < 0
            ? "#ef4444"
            : "#e2e8f0";
      const sideBadge = renderTooltipBadgeHtml(sideText, {
        fg: isBuy ? "#22c55e" : isSell ? "#f87171" : "#cbd5e1",
        bg: isBuy
          ? "rgba(34, 197, 94, 0.12)"
          : isSell
            ? "rgba(239, 68, 68, 0.12)"
            : "rgba(148, 163, 184, 0.12)",
        border: isBuy
          ? "rgba(34, 197, 94, 0.28)"
          : isSell
            ? "rgba(239, 68, 68, 0.28)"
            : "rgba(148, 163, 184, 0.24)",
      });
      const markerBadge = renderTooltipBadgeHtml(markerKindText, {
        fg: "#38bdf8",
        bg: "rgba(56, 189, 248, 0.12)",
        border: "rgba(56, 189, 248, 0.24)",
      });
      const statusBadge = statusText
        ? renderTooltipBadgeHtml(statusText, {
            fg:
              Number.isFinite(pnlValue) && pnlValue > 0
                ? "#22c55e"
                : Number.isFinite(pnlValue) && pnlValue < 0
                  ? "#f87171"
                  : "#facc15",
            bg:
              Number.isFinite(pnlValue) && pnlValue > 0
                ? "rgba(34, 197, 94, 0.12)"
                : Number.isFinite(pnlValue) && pnlValue < 0
                  ? "rgba(239, 68, 68, 0.12)"
                  : "rgba(250, 204, 21, 0.12)",
            border:
              Number.isFinite(pnlValue) && pnlValue > 0
                ? "rgba(34, 197, 94, 0.28)"
                : Number.isFinite(pnlValue) && pnlValue < 0
                  ? "rgba(239, 68, 68, 0.28)"
                  : "rgba(250, 204, 21, 0.28)",
          })
        : "";
      const metaBadges = [markerBadge, sideBadge, statusBadge]
        .filter(Boolean)
        .join('<span style="width:2px;"></span>');
      const metaSubtitleHtml = [
        metaBadges
          ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">${metaBadges}</div>`
          : "",
        sidText
          ? `<div style="margin-top:4px;font-size:10px;color:#64748b;letter-spacing:0.04em;">${escapeTooltipHtml(sidText)}</div>`
          : "",
      ]
        .filter(Boolean)
        .join("");
      const decisionNotes = [tradeDecision, rulesChecked, reasons]
        .map((value) => compactTooltipText(value, ""))
        .filter(
          (value) =>
            value &&
            !/^no (explicit trade decision stored|rules summary stored|stored reason)$/i.test(
              value,
            ),
        );
      const timingItems = [
        trade?.openedAtSec
          ? `Open ${formatMarkerTimeLabel(trade.openedAtSec)}`
          : trade?.createdAtSec
            ? `Created ${formatMarkerTimeLabel(trade.createdAtSec)}`
            : "",
        trade?.closedAtSec ? `Close ${formatMarkerTimeLabel(trade.closedAtSec)}` : "",
        eventTimeSec &&
        Number(eventTimeSec) !== Number(trade?.openedAtSec) &&
        Number(eventTimeSec) !== Number(trade?.createdAtSec)
          ? `Mark ${formatMarkerTimeLabel(eventTimeSec)}`
          : "",
      ].filter(Boolean);
      const rows = [
        {
          valueHtml: renderTooltipInlineStatsHtml([
            { label: "E", value: entryText, tone: "#e2e8f0" },
            { label: "SL", value: slText, tone: "#f87171" },
            { label: "TP", value: tpText, tone: "#22c55e" },
            { label: "X", value: exitText, tone: "#cbd5e1" },
          ]),
        },
        {
          valueHtml: renderTooltipInlineStatsHtml([
            { label: "$", value: pnlText, tone: pnlTone },
            { label: "R", value: rText, tone: pnlTone },
          ]),
        },
        {
          value: timingItems.join(" · "),
        },
        {
          value: decisionNotes.slice(0, 1).join(" · "),
        },
      ].filter((row) => String(row?.valueHtml || row?.value || "").trim());
      return renderCompactTradeTooltipCardHtml({
        title:
          strategyName && strategyName !== "Trade"
            ? `${markerText} · ${strategyName}`
            : markerText,
        subtitleHtml: metaSubtitleHtml,
        rows,
      });
    },
    [formatMarkerTimeLabel],
  );
  const buildStrategyMarkerTooltipHtml = useCallback(
    (payload = {}) => {
      const hit = payload?.hit && typeof payload.hit === "object"
        ? payload.hit
        : payload?.artifact_payload && typeof payload.artifact_payload === "object"
          ? payload.artifact_payload
          : payload || {};
      const shortName = compactTooltipText(
        hit?.ruleEvent?.abbr || hit?.markerText || hit?.eventName,
        "Rule",
      );
      return renderCompactRuleTooltipHtml({
        title: shortName,
        detail: buildCompactRuleDetail(hit),
      });
    },
    [],
  );
  const buildSharedArtifactTooltipHtml = useCallback(
    (obj = {}) => {
      const payload =
        obj?.artifact_payload && typeof obj.artifact_payload === "object"
          ? obj.artifact_payload
          : obj || {};
      const tf = obj?.source_tf || obj?.tf || payload?.timeframe || payload?.tf || "";
      const type = obj?.artifact_type || obj?.type || obj?.artifact_group || payload?.type || "";
      return renderCompactArtifactTooltipHtml({
        label: obj?.label || payload?.label || obj?.marker_text || obj?.type || payload?.type || "Artifact",
        tf,
        type,
        group: obj?.artifact_group || payload?.group || "",
        family: obj?.artifact_family || payload?.family || "",
        direction: payload?.event_direction || payload?.direction || payload?.subtype || payload?.payload?.bias || "",
        markerText: obj?.marker_text || payload?.marker_text || "",
        eventKey: obj?.event_key || payload?.event_key || "",
        isEvent:
          obj?.is_event === true ||
          payload?.is_event === true ||
          String(type).trim().toLowerCase().endsWith("_event"),
      });
    },
    [],
  );
  const overlayTrade = useMemo(() => {
    if (!normalizedTrades.length) return null;
    const selected = String(selectedTradeSid || "").trim();
    return (
      normalizedTrades.find((trade) => String(trade.sid) === selected) ||
      normalizedTrades[0]
    );
  }, [normalizedTrades, selectedTradeSid]);
  const effectiveSide =
    overlayTrade?.side ||
    inferTradeSide({
      side,
      action,
      entryPrice,
      tpPrice: tpPrice ?? tp1Price,
      slPrice,
    });
  const effectiveTradeLabel = overlayTrade?.tradeLabel || tradeLabel;
  const effectiveEntryPrice = overlayTrade?.entry ?? Number(entryPrice);
  const effectiveExitPrice =
    overlayTrade?.exitPrice ?? Number(exitPrice);
  const effectivePnlRealized =
    overlayTrade && Number.isFinite(Number(overlayTrade.pnlRealized))
      ? overlayTrade.pnlRealized
      : pnlRealized;
  const effectiveCloseStatus = overlayTrade?.closeStatus || closeStatus;
  const hasClosedTradeEvidence = useMemo(() => {
    const statusKey = normalizeTradeStatusKey(effectiveCloseStatus);
    return (
      isClosedTradeStatus(statusKey) ||
      Number.isFinite(Number(effectivePnlRealized))
    );
  }, [effectiveCloseStatus, effectivePnlRealized]);
  const effectiveCreatedAtEpochSec =
    overlayTrade?.createdAtSec ?? createdAtEpochSec;
  const hasExplicitOpenedEvent = useMemo(() => {
    if (overlayTrade) {
      return Boolean(
        overlayTrade.openedAt ||
          (Number.isFinite(Number(overlayTrade.openedAtSec)) &&
            Number(overlayTrade.openedAtSec) > 0),
      );
    }
    return Boolean(
      openedAt ||
        (Number.isFinite(Number(openedAtSec)) && Number(openedAtSec) > 0),
    );
  }, [openedAt, openedAtSec, overlayTrade]);
  const effectiveOpenedAtEpochSec =
    hasExplicitOpenedEvent
      ? overlayTrade?.openedAtSec ?? openedAtEpochSec
      : null;
  const hasExplicitClosedEvent = useMemo(() => {
    if (overlayTrade) {
      return Boolean(
        overlayTrade.closedAt ||
          (Number.isFinite(Number(overlayTrade.closedAtSec)) &&
            Number(overlayTrade.closedAtSec) > 0),
      );
    }
    return Boolean(
      closedAt ||
        (Number.isFinite(Number(closedAtSec)) && Number(closedAtSec) > 0),
    );
  }, [closedAt, closedAtSec, overlayTrade]);
  const fallbackClosedAtEpochSec = useMemo(() => {
    const opened = Number(effectiveOpenedAtEpochSec);
    if (Number.isFinite(opened) && opened > 0) return opened;
    const created = Number(effectiveCreatedAtEpochSec);
    if (Number.isFinite(created) && created > 0) return created;
    return null;
  }, [effectiveCreatedAtEpochSec, effectiveOpenedAtEpochSec]);
  const effectiveClosedAtEpochSec =
    hasExplicitClosedEvent
      ? overlayTrade?.closedAtSec ?? closedAtEpochSec
      : hasClosedTradeEvidence
        ? fallbackClosedAtEpochSec
        : null;
  const normalizedCreatedAtEpochSec = useMemo(() => {
    const created = Number(effectiveCreatedAtEpochSec);
    const opened = Number(effectiveOpenedAtEpochSec);
    if (!Number.isFinite(created) || created <= 0) return null;
    if (Number.isFinite(opened) && opened > 0 && created >= opened) {
      return null;
    }
    return created;
  }, [effectiveCreatedAtEpochSec, effectiveOpenedAtEpochSec]);
  const tradeViewportAnchors = useMemo(
    () => ({
      firstAnchorTimeSec:
        (Number.isFinite(Number(effectiveOpenedAtEpochSec)) &&
        Number(effectiveOpenedAtEpochSec) > 0
          ? Number(effectiveOpenedAtEpochSec)
          : null) ?? normalizedCreatedAtEpochSec,
      lastAnchorTimeSec:
        effectiveClosedAtEpochSec > 0
          ? effectiveClosedAtEpochSec
          : null,
      preferLatestWindow: !(effectiveClosedAtEpochSec > 0),
    }),
    [
      effectiveClosedAtEpochSec,
      effectiveOpenedAtEpochSec,
      normalizedCreatedAtEpochSec,
    ],
  );
  const effectiveAnalysisSnapshot = useMemo(
    () => pickChartRelevantSnapshot(extractAnalysisSnapshot(analysisSnapshot)),
    [analysisSnapshot],
  );
  const historicalDataSignature = useMemo(() => {
    const bars = Array.isArray(historicalData) ? historicalData : [];
    if (!bars.length) return "0";
    const first = bars[0] || {};
    const last = bars[bars.length - 1] || {};
    return [
      bars.length,
      Number(first?.time) || 0,
      Number(last?.time) || 0,
      Number(last?.open) || 0,
      Number(last?.high) || 0,
      Number(last?.low) || 0,
      Number(last?.close) || 0,
    ].join("|");
  }, [historicalData]);
  const analysisSnapshotSignature = useMemo(() => {
    try {
      return JSON.stringify(effectiveAnalysisSnapshot || null);
    } catch {
      return "null";
    }
  }, [effectiveAnalysisSnapshot]);
  const sharedLinesSignature = useMemo(() => {
    try {
      return JSON.stringify(sharedLines || []);
    } catch {
      return "[]";
    }
  }, [sharedLines]);
  const sharedObjectsSignature = useMemo(() => {
    try {
      return JSON.stringify(sharedObjects || []);
    } catch {
      return "[]";
    }
  }, [sharedObjects]);
  const tvSymbol = toTradingViewSymbol(symbol, provider);
  const tvInterval = toTradingViewInterval(interval);
  const uiTheme = getUiThemeColors();
  const isLightUi = uiTheme.mode === "light";
  const wrapperHeight =
    typeof height === "number" ? `${height}px` : height || "320px";
  const refreshPlanDragHandles = useCallback(() => {
    const candleSeries = seriesRef.current;
    const container = chartContainerRef.current;
    if (!candleSeries || !container || typeof onPlanLevelChange !== "function") {
      setPlanDragHandles([]);
      return;
    }
    const containerHeight = Number(container.clientHeight || 0);
    const levelMap = levelPriceMapRef.current || {};
    const handleDefs = [
      {
        key: "entry",
        label: "Entry",
        shortLabel: "E",
        price: levelMap.entry,
        color: TRADE_ENTRY_VIBRANT,
      },
      {
        key: "tp1",
        label: "TP",
        shortLabel: "",
        price: levelMap.tp1 ?? levelMap.tp,
        color: TRADE_TP_DARK,
      },
      {
        key: "sl",
        label: "SL",
        shortLabel: "",
        price: levelMap.sl,
        color: TRADE_SL_DARK,
      },
    ];
    const nextHandles = handleDefs
      .map((handle) => {
        const price = Number(handle.price);
        if (!Number.isFinite(price)) return null;
        const y = candleSeries.priceToCoordinate(price);
        if (!Number.isFinite(y)) return null;
        if (containerHeight > 0 && (y < -24 || y > containerHeight + 24)) {
          return null;
        }
        return {
          ...handle,
          price,
          y,
        };
      })
      .filter(Boolean);
    setPlanDragHandles((current) => {
      const currentSignature = JSON.stringify(current);
      const nextSignature = JSON.stringify(nextHandles);
      return currentSignature === nextSignature ? current : nextHandles;
    });
  }, [onPlanLevelChange]);
  const applyPlanLevelDragPreview = useCallback((handleKey, nextPrice) => {
    const price = Number(nextPrice);
    if (!Number.isFinite(price)) return;
    const normalizedKey = handleKey === "tp" ? "tp1" : String(handleKey || "");
    const targetLine = draggablePlanLineRefs.current?.[normalizedKey] || null;
    if (targetLine && typeof targetLine.applyOptions === "function") {
      try {
        targetLine.applyOptions({ price });
      } catch {}
    }
    if (normalizedKey === "entry") {
      levelPriceMapRef.current.entry = price;
    } else if (normalizedKey === "sl") {
      levelPriceMapRef.current.sl = price;
    } else if (normalizedKey === "tp1") {
      levelPriceMapRef.current.tp1 = price;
      levelPriceMapRef.current.tp = price;
    }
    hoverPriceLinesRef.current.lines = hoverPriceLinesRef.current.lines.map((line) => {
      if (line?.overlayType !== "plan") return line;
      const label = String(line?.label || "").trim().toUpperCase();
      const isEntry = normalizedKey === "entry" && label === "ENTRY";
      const isSl = normalizedKey === "sl" && label === "SL";
      const isTp =
        normalizedKey === "tp1" &&
        (label === "TP" || label === "TP1");
      if (!isEntry && !isSl && !isTp) return line;
      return {
        ...line,
        price,
        priceText: formatPriceWithPrecision(price, pricePrecisionRef.current),
      };
    });
    window.requestAnimationFrame(refreshPlanDragHandles);
  }, [refreshPlanDragHandles]);
  const handlePlanHandleMouseDown = useCallback((handleKey, event) => {
    event.preventDefault();
    event.stopPropagation();
    const candleSeries = seriesRef.current;
    const container = chartContainerRef.current;
    if (!candleSeries || !container || typeof onPlanLevelChange !== "function") {
      return;
    }
    const priceMap = levelPriceMapRef.current || {};
    const price =
      handleKey === "tp1"
        ? Number(priceMap.tp1 ?? priceMap.tp)
        : Number(priceMap[handleKey]);
    if (!Number.isFinite(price)) return;
    const chartRect = container.getBoundingClientRect();
    const updateFromClientY = (clientY) => {
      const nextPrice = candleSeries.coordinateToPrice(clientY - chartRect.top);
      if (!Number.isFinite(nextPrice)) return;
      applyPlanLevelDragPreview(handleKey, nextPrice);
      onPlanLevelChange(handleKey, Number(nextPrice));
    };
    const onMove = (moveEvent) => {
      if (!planHandleDragRef.current) return;
      updateFromClientY(moveEvent.clientY);
    };
    const onUp = () => {
      planHandleDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    planHandleDragRef.current = { key: handleKey };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    updateFromClientY(event.clientY);
  }, [applyPlanLevelDragPreview, onPlanLevelChange]);
  const effectiveIndicatorVisibility =
    indicatorVisibilityConfig || indicatorVisibility;
  const showRsiPanel = effectiveIndicatorVisibility.rsiPanel !== false;
  const showMacdPanel = showRsiPanel;

  useEffect(() => {
    preserveViewportOnBarsChangeRef.current = Boolean(
      preserveViewportOnBarsChange,
    );
  }, [preserveViewportOnBarsChange]);
  const visibleOscillatorIndicators = INDICATOR_GROUPS[0].items.filter(
    (item) =>
      showRsiPanel &&
      effectiveIndicatorVisibility[item.key] &&
      Number.isFinite(indicatorValues[item.key]),
  );
  const isPanelOpen =
    typeof indicatorPanelOpen === "boolean"
      ? indicatorPanelOpen
      : isIndicatorPanelOpen;
  const lwTimeToMs = useCallback((v) => {
    if (typeof v === "number" && Number.isFinite(v))
      return Math.round(v * 1000);
    if (v && typeof v === "object") {
      if (
        Number.isFinite(Number(v.year)) &&
        Number.isFinite(Number(v.month)) &&
        Number.isFinite(Number(v.day))
      ) {
        const d = new Date(
          Date.UTC(Number(v.year), Number(v.month) - 1, Number(v.day)),
        );
        const ms = d.getTime();
        return Number.isFinite(ms) ? ms : null;
      }
    }
    return null;
  }, []);

  const clearPlanPriceLines = useCallback(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of planPriceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {}
    }
    planPriceLinesRef.current = [];
    draggablePlanLineRefs.current = {
      entry: null,
      tp1: null,
      sl: null,
    };
    hoverPriceLinesRef.current.lines = hoverPriceLinesRef.current.lines.filter(
      (line) => line?.overlayType !== "plan",
    );
    levelPriceMapRef.current = {
      entry: null,
      tp: null,
      tp1: null,
      sl: null,
    };
    setPlanDragHandles([]);
  }, []);

  const clearTradeOverlayArtifacts = useCallback(() => {
    clearHoverMarkers(["timeline-trade", "trade-event"]);
    const series = seriesRef.current;
    if (!series) return;
    for (const line of tradeOverlayPriceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {}
    }
    tradeOverlayPriceLinesRef.current = [];
    for (const primitive of tradeOverlayPrimitivesRef.current) {
      try {
        series.detachPrimitive(primitive);
      } catch {}
    }
    tradeOverlayPrimitivesRef.current = [];
    if (seriesMarkersRef.current) {
      try {
        seriesMarkersRef.current.setMarkers([]);
      } catch {}
      try {
        seriesMarkersRef.current.detach();
      } catch {}
    }
    seriesMarkersRef.current = null;
  }, [clearHoverMarkers]);

  const clearDayDividerArtifacts = useCallback(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const primitive of dayDividerPrimitivesRef.current) {
      try {
        series.detachPrimitive(primitive);
      } catch {}
    }
    dayDividerPrimitivesRef.current = [];
  }, []);

  const clearSessionOverlayArtifacts = useCallback(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const primitive of sessionOverlayPrimitivesRef.current) {
      try {
        series.detachPrimitive(primitive);
      } catch {}
    }
    sessionOverlayPrimitivesRef.current = [];
  }, []);

  const clearSharedOverlayArtifacts = useCallback(() => {
    clearHoverMarkers(["shared-point"]);
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (chart) {
      for (const overlaySeries of sharedOverlayLineSeriesRef.current) {
        if (!overlaySeries) continue;
        try {
          chart.removeSeries(overlaySeries);
        } catch {}
      }
    }
    sharedOverlayLineSeriesRef.current = [];
    if (!series) return;
    for (const line of sharedOverlayPriceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {}
    }
    sharedOverlayPriceLinesRef.current = [];
    for (const primitive of sharedOverlayPrimitivesRef.current) {
      try {
        series.detachPrimitive(primitive);
      } catch {}
    }
    sharedOverlayPrimitivesRef.current = [];
  }, [clearHoverMarkers]);

  const formatTradePnlMarkerText = useCallback((value, fallback = "") => {
    const pnl = Number(value);
    if (!Number.isFinite(pnl)) return String(fallback || "").trim() || "Closed";
    const absValue = Math.abs(pnl);
    const decimals = absValue >= 10 ? 0 : absValue >= 1 ? 1 : 2;
    return `${pnl > 0 ? "+" : pnl < 0 ? "-" : ""}${absValue.toFixed(decimals)}`;
  }, []);

  const renderTimelineTradeBoxes = useCallback(
    (candles = []) => {
      const candleSeries = seriesRef.current;
      if (
        !candleSeries ||
        !Array.isArray(candles) ||
        !candles.length ||
        !normalizedTrades.length
      ) {
        return;
      }
      const selectedSid = String(selectedTradeSid || "").trim();
      const latestBarTimeSec = Number(candles[candles.length - 1]?.time || 0) || 0;
      const replayNowSec = Number(replayClockTimeSec);
      const visibleNowSec =
        isReplayActive && Number.isFinite(replayNowSec) && replayNowSec > 0
          ? replayNowSec
          : latestBarTimeSec;
      if (!latestBarTimeSec) return;

      for (const trade of normalizedTrades) {
        if (selectedSid && String(trade?.sid || "") === selectedSid) continue;

        const entry = Number(trade?.entry);
        const sl = Number(trade?.sl);
        const tp = Number(trade?.tp);
        if (!Number.isFinite(entry)) continue;

        const createdSec = resolveReplayTradeCreatedSec(trade);
        const openedSec = resolveReplayTradeOpenSec(trade);
        const closedSec = resolveReplayTradeCloseSec(trade);
        const statusUpper = normalizeTradeStatusKey(trade?.closeStatus);
        const isPendingStatus = isPendingTradeStatus(statusUpper);
        const isTerminalStatus = isClosedTradeStatus(statusUpper);
        const hasOpened =
          !isPendingStatus &&
          Number.isFinite(Number(openedSec)) &&
          Number(openedSec) > 0;
        const hasClosed =
          Boolean(isTerminalStatus || Number.isFinite(Number(trade?.pnlRealized))) &&
          Number.isFinite(Number(closedSec)) &&
          Number(closedSec) > 0;
        const closeAlreadyVisible =
          !isReplayActive ||
          !Number.isFinite(replayNowSec) ||
          Number(closedSec) <= replayNowSec;
        const effectiveHasClosed = hasClosed && closeAlreadyVisible;

        const startAnchorSec = hasOpened ? Number(openedSec) : Number(createdSec);
        if (!Number.isFinite(startAnchorSec) || startAnchorSec <= 0) continue;
        if (Number(startAnchorSec) > Number(visibleNowSec)) continue;
        const startTimeSec = resolveEventMarkerTimeSec(candles, startAnchorSec, interval);
        if (!Number.isFinite(startTimeSec) || startTimeSec <= 0) continue;
        const resolvedClosedTime = effectiveHasClosed
          ? resolveEventMarkerTimeSec(candles, Number(closedSec), interval) ||
            latestBarTimeSec
          : null;
        const tradeBoxSpecs = buildTradeBoxSpecs({
          entryPrice: entry,
          tpPrice: tp,
          slPrice: sl,
          status: trade?.closeStatus,
          pnlRealized: trade?.pnlRealized,
          startTimeSec,
          closedTimeSec: effectiveHasClosed ? resolvedClosedTime : null,
          latestBarTimeSec: visibleNowSec,
        });
        attachTradeBoxSpecs(
          candleSeries,
          tradeOverlayPrimitivesRef,
          tradeBoxSpecs,
        );
      }
    },
    [
      interval,
      isReplayActive,
      normalizedTrades,
      replayClockTimeSec,
      selectedTradeSid,
    ],
  );

  const buildTimelineTradeMarkers = useCallback(
    (candles = []) => {
      if (
        isReplayActive ||
        !Array.isArray(candles) ||
        !candles.length ||
        !normalizedTrades.length
      ) {
        return [];
      }
      const selectedSid = String(selectedTradeSid || "").trim();
      const replayNowSec = Number(replayClockTimeSec);
      const markers = [];
      for (const trade of normalizedTrades) {
        if (selectedSid && String(trade?.sid || "") === selectedSid) continue;
        const tradeSide = String(
          trade?.side ||
            inferTradeSide({
              side: trade?.side,
              action: trade?.action,
              entryPrice: trade?.entry,
              tpPrice: trade?.tp,
              slPrice: trade?.sl,
            }) ||
            "BUY",
        )
          .trim()
          .toUpperCase();
        const statusUpper = normalizeTradeStatusKey(trade?.closeStatus);
        const openedSec = resolveReplayTradeOpenSec(trade);
        if (
          !isPendingTradeStatus(statusUpper) &&
          Number.isFinite(openedSec) &&
          (!isReplayActive ||
            !Number.isFinite(replayNowSec) ||
            replayNowSec >= Number(openedSec))
        ) {
          const openedTs = resolveEventMarkerTimeSec(candles, openedSec, interval);
          if (Number.isFinite(openedTs)) {
            markers.push({
              id: `timeline-open-${String(trade?.sid || trade?.key || openedTs)}`,
              time: openedTs,
              position: tradeSide === "SELL" ? "aboveBar" : "belowBar",
              color: TRADE_MARKER_YELLOW,
              shape: tradeSide === "SELL" ? "arrowDown" : "arrowUp",
              text: tradeSide === "SELL" ? "S" : "B",
              markerKind: "trade_open",
              trade,
            });
          }
        }
        const closedSec = resolveReplayTradeCloseSec(trade);
        const hasClosedEvent = Boolean(
          isClosedTradeStatus(statusUpper) ||
            Number.isFinite(Number(trade?.pnlRealized)),
        );
        if (
          hasClosedEvent &&
          Number.isFinite(closedSec) &&
          (!isReplayActive ||
            !Number.isFinite(replayNowSec) ||
            replayNowSec >= Number(closedSec))
        ) {
          const closedTs = resolveEventMarkerTimeSec(candles, closedSec, interval);
          if (Number.isFinite(closedTs)) {
            const closeBadge = resolveTradeBadgeMeta({
              side: tradeSide,
              closeStatus: trade?.closeStatus,
              pnlRealized: trade?.pnlRealized,
              kind: "close",
            });
            const closeText = formatTradePnlMarkerText(
              trade?.pnlRealized,
              closeBadge.label || "Closed",
            );
            markers.push({
              id: `timeline-close-${String(trade?.sid || trade?.key || closedTs)}`,
              time: closedTs,
              position:
                Number(trade?.pnlRealized) > 0
                  ? "aboveBar"
                  : Number(trade?.pnlRealized) < 0
                    ? "belowBar"
                    : "inBar",
              color: closeBadge.color,
              shape: "circle",
              text: closeText,
              markerKind: "trade_close",
              trade,
            });
          }
        }
      }
      return markers;
    },
    [
      formatTradePnlMarkerText,
      interval,
      isReplayActive,
      normalizedTrades,
      replayClockTimeSec,
      selectedTradeSid,
    ],
  );

  const applyTimelineTradeMarkers = useCallback(
    (candles = []) => {
      const candleSeries = seriesRef.current;
      if (!candleSeries) return;
      renderTimelineTradeBoxes(candles);
      const markers = buildTimelineTradeMarkers(candles);
      clearHoverMarkers(["timeline-trade"]);
      if (!markers.length) {
        if (seriesMarkersRef.current) {
          try {
            seriesMarkersRef.current.setMarkers([]);
          } catch {}
          try {
            seriesMarkersRef.current.detach();
          } catch {}
        }
        seriesMarkersRef.current = null;
        return;
      }
      markers.forEach((marker) => {
        registerHoverMarker({
          id: marker?.id || `timeline-${marker?.time}-${marker?.text}`,
          overlayType: "timeline-trade",
          timeSec: Number(marker?.time),
          price: Number(
            marker?.trade?.entry ??
              marker?.trade?.exitPrice ??
              marker?.trade?.sl ??
              marker?.trade?.tp ??
              candles.find((bar) => Number(bar?.time) === Number(marker?.time))?.close,
          ),
          tooltipHtml: buildTradeMarkerTooltipHtml({
            trade: marker?.trade || {},
            markerKind: marker?.markerKind || "trade",
            markerLabel: marker?.text || marker?.markerKind || "Trade",
            eventTimeSec: Number(marker?.time),
          }),
        });
      });
      if (seriesMarkersRef.current) {
        try {
          seriesMarkersRef.current.setMarkers(markers);
          return;
        } catch {}
        try {
          seriesMarkersRef.current.detach();
        } catch {}
      }
      seriesMarkersRef.current = createSeriesMarkers(candleSeries, markers);
    },
    [
      buildTimelineTradeMarkers,
      buildTradeMarkerTooltipHtml,
      clearHoverMarkers,
      registerHoverMarker,
      renderTimelineTradeBoxes,
    ],
  );

  const renderSharedOverlayArtifacts = useCallback(
    ({
      sharedLinesList = [],
      sharedObjectsList = [],
      bars = [],
      renderSignature = "",
    } = {}) => {
      const candleSeries = seriesRef.current;
      if (!candleSeries) return false;
      const nextRenderSignature =
        String(renderSignature || "").trim() ||
        [
          buildBarsSignature(Array.isArray(bars) ? bars : []),
          sharedLinesSignature,
          sharedObjectsSignature,
        ].join("|");
      if (
        nextRenderSignature &&
        nextRenderSignature === lastSharedOverlayRenderSignatureRef.current
      ) {
        return false;
      }

      clearSharedOverlayArtifacts();
      hoverPriceLinesRef.current.lines = (
        hoverPriceLinesRef.current.lines || []
      ).filter((line) => line?.overlayType !== "shared");

      if (Array.isArray(sharedLinesList) && sharedLinesList.length > 0) {
        sharedLinesList.forEach((ln, idx) => {
          const p = Number(ln?.price);
          if (!Number.isFinite(p)) return;
          const lineColor = String(ln?.color || "#60a5fa");
          const showScaleLabel = shouldShowSharedPriceScaleLabel(
            {
              sourceTf: ln?.source_tf || ln?.tf || "",
              artifactType: ln?.artifact_type || ln?.type || "",
              artifactGroup: ln?.artifact_group || "",
              label: ln?.label || `L${idx + 1}`,
            },
            interval,
          );
          const artifactLinePrimitive = new HorizontalPriceLinePrimitive({
            price: p,
            label: ln?.label || `L${idx + 1}`,
            color: lineColor,
            lineDash: ARTIFACT_LINE_DASH,
            lineWidth: ARTIFACT_LINE_WIDTH,
          });
          candleSeries.attachPrimitive(artifactLinePrimitive);
          sharedOverlayPrimitivesRef.current.push(artifactLinePrimitive);
          const sharedLine = candleSeries.createPriceLine({
            price: p,
            color: lineColor,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            lineVisible: false,
            axisLabelVisible: showScaleLabel,
            title: showScaleLabel ? ln?.label || `L${idx + 1}` : "",
          });
          sharedOverlayPriceLinesRef.current.push(sharedLine);
          hoverPriceLinesRef.current.lines.push({
            overlayType: "shared",
            price: p,
            label: ln?.label || `L${idx + 1}`,
            priceText: formatPriceWithPrecision(p, pricePrecisionRef.current),
            sourceTf: ln?.source_tf || ln?.tf || "",
            artifactType: ln?.artifact_type || ln?.type || "",
            artifactGroup: ln?.artifact_group || "",
            artifactFamily: ln?.artifact_family || "",
            direction:
              ln?.artifact_payload?.event_direction ||
              ln?.artifact_payload?.direction ||
              ln?.direction ||
              "",
            markerText: ln?.marker_text || "",
            eventKey: ln?.event_key || "",
            isEvent:
              ln?.is_event === true ||
              String(ln?.artifact_type || ln?.type || "").trim().toLowerCase().endsWith("_event"),
          });
        });
      }

      if (!Array.isArray(sharedObjectsList) || sharedObjectsList.length <= 0) {
        lastSharedOverlayRenderSignatureRef.current = nextRenderSignature;
        return true;
      }

      const cleanBars = Array.isArray(bars) ? bars : [];
      const firstCandleTime = cleanBars.length
        ? toEpochSec(cleanBars[0]?.time)
        : null;
      const lastCandleTime = cleanBars.length
        ? toEpochSec(cleanBars[cleanBars.length - 1]?.time)
        : null;

      sharedObjectsList.forEach((obj, idx) => {
        if (!obj || obj.visible === false) return;
        const label = formatSharedObjectLabel(obj.type, obj.label || "");
        const lineColor = String(obj.color || "#60a5fa");
        const rawLineWidth = Math.max(
          ARTIFACT_LINE_WIDTH,
          Number(obj.line_width) || ARTIFACT_LINE_WIDTH,
        );
        const lineStyle = LineStyle.Dotted;
        const registerSharedArtifactHover = ({
          points = [],
          fallbackId = "",
        } = {}) => {
          const tooltipHtml = buildSharedArtifactTooltipHtml(obj);
          (Array.isArray(points) ? points : []).forEach((point, pointIndex) => {
            const timeSec = Number(point?.timeSec);
            const price = Number(point?.price);
            if (!Number.isFinite(timeSec) || !Number.isFinite(price)) return;
            registerHoverMarker({
              id: String(
                `${obj?.id || fallbackId || `shared-${obj?.kind || "artifact"}-${idx}`}:${pointIndex + 1}`,
              ),
              overlayType: "shared-artifact",
              timeSec,
              price,
              tooltipHtml,
            });
          });
        };
        if (obj.kind === "segment") {
          const baseStartTimeSec = toEpochSec(obj.anchorTimeMs ?? obj.time);
          const baseEndTimeSec = toEpochSec(obj.anchorTimeMs2 ?? obj.time2);
          const baseStartPrice = Number(obj.anchorPrice ?? obj.price);
          const baseEndPrice = Number(obj.anchorPrice2 ?? obj.price2);
          const isTrendlineArtifact =
            String(obj?.artifact_group || "").trim().toLowerCase() === "trendline";
          let startTimeSec = baseStartTimeSec;
          let endTimeSec = baseEndTimeSec;
          let startPrice = baseStartPrice;
          let endPrice = baseEndPrice;
          if (
            isTrendlineArtifact &&
            Number.isFinite(baseStartTimeSec) &&
            Number.isFinite(baseEndTimeSec) &&
            Number.isFinite(baseStartPrice) &&
            Number.isFinite(baseEndPrice) &&
            Number.isFinite(lastCandleTime) &&
            lastCandleTime > baseEndTimeSec
          ) {
            const timeSpan = Math.max(1, baseEndTimeSec - baseStartTimeSec);
            const slope =
              Number(obj?.artifact_payload?.metrics?.slope) ||
              (baseEndPrice - baseStartPrice) / timeSpan;
            endTimeSec = Number(lastCandleTime);
            endPrice = baseEndPrice + slope * (endTimeSec - baseEndTimeSec);
          }
          if (
            !Number.isFinite(startTimeSec) ||
            !Number.isFinite(endTimeSec) ||
            !Number.isFinite(startPrice) ||
            !Number.isFinite(endPrice)
          ) {
            return;
          }
          const segmentPrimitive = new SegmentLinePrimitive({
            startTimeSec,
            endTimeSec,
            startPrice,
            endPrice,
            color: lineColor,
            lineDash: ARTIFACT_LINE_DASH,
            lineWidth: rawLineWidth,
            label,
          });
          candleSeries.attachPrimitive(segmentPrimitive);
          sharedOverlayPrimitivesRef.current.push(segmentPrimitive);
          registerSharedArtifactHover({
            points: [
              { timeSec: startTimeSec, price: startPrice },
              {
                timeSec: Math.round((startTimeSec + endTimeSec) / 2),
                price: (startPrice + endPrice) / 2,
              },
              { timeSec: endTimeSec, price: endPrice },
            ],
            fallbackId: `shared-segment-${startTimeSec}-${endTimeSec}-${startPrice}`,
          });
          return;
        }
        if (obj.kind === "line") {
          const price = Number(obj.price ?? obj.anchorPrice);
          if (!Number.isFinite(price)) return;
          const startTimeSec = toEpochSec(obj.anchorTimeMs ?? obj.time);
          const endTimeSec = toEpochSec(obj.anchorTimeMs2);
          const lineScope = String(obj.line_scope || "full").trim().toLowerCase();
          const extendToPriceScale = lineScope === "segment_to_scale";
          const resolvedLineWidth =
            lineScope === "segment" || extendToPriceScale
              ? rawLineWidth
              : rawLineWidth;
          const linePrimitive = Number.isFinite(startTimeSec)
            ? new HorizontalPriceSegmentPrimitive({
                price,
                startTimeSec,
                endTimeSec: extendToPriceScale ? null : endTimeSec,
                label,
                labelAlign: "left",
                color: lineColor,
                lineDash: ARTIFACT_LINE_DASH,
                lineWidth: resolvedLineWidth,
              })
            : new HorizontalPriceLinePrimitive({
                price,
                label,
                color: lineColor,
                lineDash: ARTIFACT_LINE_DASH,
                lineWidth: resolvedLineWidth,
              });
          candleSeries.attachPrimitive(linePrimitive);
          sharedOverlayPrimitivesRef.current.push(linePrimitive);
          if (lineScope !== "segment") {
            const sharedLine = candleSeries.createPriceLine({
              price,
              color: lineColor,
              lineWidth: 1,
              lineStyle,
              lineVisible: false,
              axisLabelVisible: false,
              title: "",
            });
            sharedOverlayPriceLinesRef.current.push(sharedLine);
          }
          hoverPriceLinesRef.current.lines.push({
            overlayType: "shared",
            price,
            label: label || obj.type || `L${idx + 1}`,
            priceText: formatPriceWithPrecision(price, pricePrecisionRef.current),
            sourceTf: obj?.source_tf || obj?.tf || "",
            artifactType: obj?.artifact_type || obj?.type || obj?.artifact_group || "",
            artifactGroup: obj?.artifact_group || "",
            artifactFamily: obj?.artifact_family || "",
            direction:
              obj?.artifact_payload?.event_direction ||
              obj?.artifact_payload?.direction ||
              obj?.direction ||
              "",
            markerText: obj?.marker_text || "",
            eventKey: obj?.event_key || obj?.artifact_payload?.event_key || "",
            isEvent:
              obj?.is_event === true ||
              String(obj?.artifact_type || obj?.type || "").trim().toLowerCase().endsWith("_event"),
          });
          registerSharedArtifactHover({
            points: [
              Number.isFinite(startTimeSec) ? { timeSec: startTimeSec, price } : null,
              Number.isFinite(startTimeSec) && Number.isFinite(endTimeSec)
                ? { timeSec: Math.round((startTimeSec + endTimeSec) / 2), price }
                : null,
              Number.isFinite(endTimeSec)
                ? { timeSec: endTimeSec, price }
                : Number.isFinite(lastCandleTime)
                  ? { timeSec: lastCandleTime, price }
                  : null,
            ].filter(Boolean),
            fallbackId: `shared-line-${price}-${idx}`,
          });
          return;
        }
        if (obj.kind === "point") {
          const timeSec = toEpochSec(obj.time ?? obj.anchorTimeMs);
          const price = Number(obj.price ?? obj.anchorPrice);
          if (Number.isFinite(price) && Number.isFinite(timeSec)) {
            const tooltipPayload =
              obj?.artifact_family === "strategy"
                ? buildStrategyMarkerTooltipHtml(obj?.artifact_payload || obj)
                : buildSharedArtifactTooltipHtml(obj);
            const pointPrimitive = new EventTimeMarkerPrimitive({
              timeSec,
              price,
              color: lineColor,
              text: String(obj.marker_text || label || obj.type || "").trim(),
              placement: String(obj.marker_position || "belowBar"),
              shape: String(obj.marker_shape || "auto"),
              markerSize: obj.marker_size,
            });
            candleSeries.attachPrimitive(pointPrimitive);
            sharedOverlayPrimitivesRef.current.push(pointPrimitive);
            registerHoverMarker({
              id: String(obj?.id || `shared-point-${timeSec}-${price}`),
              overlayType: "shared-point",
              timeSec,
              price,
              tooltipHtml: tooltipPayload,
            });
          } else if (Number.isFinite(price)) {
            const pointPrimitive = new HorizontalPriceLinePrimitive({
              price,
              label: label || obj.type || `P${idx + 1}`,
              color: lineColor,
              lineDash: ARTIFACT_LINE_DASH,
              lineWidth: rawLineWidth,
            });
            candleSeries.attachPrimitive(pointPrimitive);
            sharedOverlayPrimitivesRef.current.push(pointPrimitive);
            const sharedLine = candleSeries.createPriceLine({
              price,
              color: lineColor,
              lineWidth: 1,
              lineStyle,
              lineVisible: false,
              axisLabelVisible: false,
              title: "",
            });
            sharedOverlayPriceLinesRef.current.push(sharedLine);
            hoverPriceLinesRef.current.lines.push({
              overlayType: "shared",
              price,
              label: label || obj.type || `P${idx + 1}`,
              priceText: formatPriceWithPrecision(price, pricePrecisionRef.current),
              sourceTf: obj?.source_tf || obj?.tf || "",
              artifactType: obj?.artifact_type || obj?.type || obj?.artifact_group || "",
            });
          }
          return;
        }
        if (obj.kind === "zone") {
          const top = Number(obj.price_top ?? obj.anchorPrice ?? obj.price);
          const bottom = Number(
            obj.price_bottom ?? obj.anchorPrice2 ?? obj.price,
          );
          if (!Number.isFinite(top) || !Number.isFinite(bottom)) return;
          const startTimeSec =
            toEpochSec(obj.anchorTimeMs ?? obj.time) || firstCandleTime;
          const endTimeSec =
            toEpochSec(obj.anchorTimeMs2 ?? obj.time2) || null;
          if (!Number.isFinite(startTimeSec)) return;
          const isFvg = obj.artifact_group === "fvg";
          const isOb = obj.artifact_group === "ob";
          const zoneFallbackEndTimeSec =
            Number.isFinite(lastCandleTime)
              ? lastCandleTime +
                Math.max(60, Number(intervalToSeconds(interval)) || 60) * 5
              : null;
          if ((isFvg || isOb) && shouldLogArtifactZoneDebug()) {
            const debugInfo = {
              id: obj?.id || null,
              label,
              tf: obj?.source_tf || obj?.tf || "",
              group: obj?.artifact_group || "",
              startTimeSec,
              endTimeSec: Number.isFinite(endTimeSec) ? endTimeSec : null,
              fallbackEndTimeSec:
                Number.isFinite(zoneFallbackEndTimeSec) ? zoneFallbackEndTimeSec : null,
              lastCandleTime: Number.isFinite(lastCandleTime) ? lastCandleTime : null,
              extendsPastLastBar:
                Number.isFinite(endTimeSec) &&
                Number.isFinite(lastCandleTime) &&
                endTimeSec > lastCandleTime,
              debug: obj?.artifact_debug || null,
              payload: obj?.artifact_payload || null,
            };
            try {
              console.info("[artifact-zone-debug]", debugInfo);
            } catch {}
          }
          const zoneFillColor = String(obj.bg_color || "").trim()
            || (isFvg
              ? withAlpha(lineColor, "08")
              : isOb
                ? withAlpha(lineColor, "0a")
                : withAlpha(lineColor, "12"));
          const zonePrimitive = new TimeRangeBoxPrimitive({
            startTimeSec,
            endTimeSec,
            fallbackEndTimeSec: zoneFallbackEndTimeSec,
            suppressWhenEndCoordinateMissing: isFvg || isOb,
            priceLow: Math.min(top, bottom),
            priceHigh: Math.max(top, bottom),
            lineColor,
            fillColor: zoneFillColor,
            extendRight: false,
            lineDash: isFvg ? [] : ARTIFACT_LINE_DASH,
            lineWidth: isFvg ? 0 : isOb ? ARTIFACT_ZONE_LINE_WIDTH : 0.25,
            shadowBlur: isFvg ? 8 : isOb ? 10 : 0,
            shadowColor: isFvg
              ? withAlpha(lineColor, "14")
              : isOb
                ? withAlpha(lineColor, "18")
                : "",
            label,
            labelFontSize: obj?.label_font_size,
            labelBackgroundColor: obj?.label_bg_color,
            labelColor: obj?.label_color,
          });
          candleSeries.attachPrimitive(zonePrimitive);
          sharedOverlayPrimitivesRef.current.push(zonePrimitive);
          const zoneMidPrice = (Math.min(top, bottom) + Math.max(top, bottom)) / 2;
          const zoneMidTimeSec =
            Number.isFinite(startTimeSec) && Number.isFinite(endTimeSec)
              ? Math.round((startTimeSec + endTimeSec) / 2)
              : Number.isFinite(startTimeSec)
                ? startTimeSec
                : lastCandleTime;
          registerSharedArtifactHover({
            points: [
              Number.isFinite(startTimeSec)
                ? { timeSec: startTimeSec, price: zoneMidPrice }
                : null,
              Number.isFinite(zoneMidTimeSec)
                ? { timeSec: zoneMidTimeSec, price: zoneMidPrice }
                : null,
              Number.isFinite(endTimeSec)
                ? { timeSec: endTimeSec, price: zoneMidPrice }
                : Number.isFinite(lastCandleTime)
                  ? { timeSec: lastCandleTime, price: zoneMidPrice }
                  : null,
            ].filter(Boolean),
            fallbackId: `shared-zone-${startTimeSec}-${zoneMidPrice}-${idx}`,
          });
        }
      });

      lastSharedOverlayRenderSignatureRef.current = nextRenderSignature;
      return true;
    },
    [
      buildSharedArtifactTooltipHtml,
      buildStrategyMarkerTooltipHtml,
      clearSharedOverlayArtifacts,
      formatMarkerTimeLabel,
      interval,
      registerHoverMarker,
      sharedLinesSignature,
      sharedObjectsSignature,
    ],
  );
  useEffect(() => {
    renderSharedOverlayArtifactsRef.current = renderSharedOverlayArtifacts;
  }, [renderSharedOverlayArtifacts]);

  const clearCandleHoverPriceLine = useCallback(() => {
    const candleSeries = seriesRef.current;
    if (!candleSeries || !candleHoverPriceLineRef.current) return;
    try {
      candleSeries.removePriceLine(candleHoverPriceLineRef.current);
    } catch {}
    candleHoverPriceLineRef.current = null;
  }, []);

  const setCandleHoverGuide = useCallback(
    (value) => {
      const candleSeries = seriesRef.current;
      const nextValue = Number(value);
      if (!candleSeries || !Number.isFinite(nextValue)) {
        clearCandleHoverPriceLine();
        return;
      }
      clearCandleHoverPriceLine();
      const hoverGuideColor = artifactPaletteColorForTf(interval);
      try {
        candleHoverPriceLineRef.current = candleSeries.createPriceLine({
          price: nextValue,
          color: hoverGuideColor,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          axisLabelColor: hoverGuideColor,
          axisLabelTextColor: "#ffffff",
          title: "",
        });
      } catch {}
    },
    [clearCandleHoverPriceLine, interval],
  );

  const clearIndicatorHoverPriceLines = useCallback(() => {
    for (const [key, line] of Object.entries(
      indicatorHoverPriceLinesRef.current || {},
    )) {
      const series = indicatorSeriesRefs.current?.[key];
      if (!series || !line) continue;
      try {
        series.removePriceLine(line);
      } catch {}
    }
    indicatorHoverPriceLinesRef.current = {};
  }, []);

  const setIndicatorHoverGuides = useCallback(
    (values = {}) => {
      clearIndicatorHoverPriceLines();
      const configs = [
        { key: "rsi", color: INDICATOR_LINE_STYLE.colors.rsi },
        { key: "rsiEma9", color: INDICATOR_LINE_STYLE.colors.rsiEma9 },
        { key: "rsiWma45", color: INDICATOR_LINE_STYLE.colors.rsiWma45 },
        { key: "stochK", color: INDICATOR_LINE_STYLE.colors.stochK },
        { key: "stochD", color: INDICATOR_LINE_STYLE.colors.stochD },
      ];
      const nextLines = {};
      for (const config of configs) {
        if (effectiveIndicatorVisibility?.[config.key] === false) continue;
        const series = indicatorSeriesRefs.current?.[config.key];
        const nextValue = Number(values?.[config.key]);
        if (!series || !Number.isFinite(nextValue)) continue;
        try {
          nextLines[config.key] = series.createPriceLine({
            price: nextValue,
            color: config.color,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            axisLabelColor: config.color,
            axisLabelTextColor: "#ffffff",
            title: "",
          });
        } catch {}
      }
      indicatorHoverPriceLinesRef.current = nextLines;
    },
    [clearIndicatorHoverPriceLines, effectiveIndicatorVisibility],
  );
  const rsiHoverPriceLineRef = indicatorHoverPriceLinesRef;
  const clearRsiHoverPriceLine = clearIndicatorHoverPriceLines;
  const setRsiHoverPriceLine = setIndicatorHoverGuides;

  const clearIndicatorSeriesData = useCallback(() => {
    Object.values(indicatorSeriesRefs.current || {}).forEach((series) => {
      if (!series) return;
      try {
        series.setData([]);
      } catch {}
    });
    indicatorDataRef.current = {};
    setIndicatorValues({});
  }, []);

  const updatePlanOverlays = useCallback(
    (snapshotOverride = effectiveAnalysisSnapshot) => {
      const candleSeries = seriesRef.current;
      if (!candleSeries) return;

      clearPlanPriceLines();

      const snapshot = snapshotOverride || effectiveAnalysisSnapshot;
      const nextHoverLines = [];
      const levelPriceMap = {
        entry: null,
        tp: null,
        tp1: null,
        sl: null,
      };

      const rawPlans = Array.isArray(snapshot?.trade_plan)
        ? snapshot.trade_plan
        : Array.isArray(snapshot?.trade_plans)
          ? snapshot.trade_plans
          : Array.isArray(snapshot?.tradePlans)
            ? snapshot.tradePlans
            : [];

      const isMatching = (p1, p2) => {
        const e1 = Number(p1.entry);
        const e2 = Number(p2.entry);
        const t1 = Number(p1.tp);
        const t2 = Number(p2.tp);
        if (!e1 || !e2) return false;
        const entryMatch = Math.abs(e1 - e2) / Math.max(e1, e2) < 0.0001;
        const tpMatch =
          t1 && t2 ? Math.abs(t1 - t2) / Math.max(t1, t2) < 0.0001 : true;
        return entryMatch && tpMatch;
      };

      const allPlans = [];
      if (showPrimaryPlan && entryPrice) {
        const primaryTp = normalizePlanLinePrice(tpPrice);
        const primaryTp1 = normalizePlanLinePrice(tp1Price) ?? primaryTp;
        const primaryTarget =
          primaryTp1 ?? primaryTp ?? null;
        const explicitTradeSide = String(effectiveSide || "")
          .trim()
          .toUpperCase();
        const explicitDirection = String(
          explicitTradeSide ||
            effectiveAnalysisSnapshot?.direction ||
            effectiveAnalysisSnapshot?.side ||
            snapshot?.direction ||
            snapshot?.side ||
            "",
        )
          .trim()
          .toUpperCase();
        const primaryDirection =
          explicitDirection === "BUY" || explicitDirection === "SELL"
            ? explicitDirection
            : Number.isFinite(Number(primaryTarget)) &&
                Number(primaryTarget) > Number(entryPrice)
              ? "BUY"
              : "SELL";
        allPlans.push({
          entry: entryPrice,
          sl: slPrice,
          tp: primaryTp,
          tp1: primaryTp1,
          direction: primaryDirection,
        });
      }

      if (showExtraPlans) {
        rawPlans.forEach((plan) => {
          const ep = Number(plan?.entry);
          if (!ep) return;
          const isDuplicate = allPlans.some((existing) =>
            isMatching(existing, plan),
          );
          if (!isDuplicate) allPlans.push(plan);
        });
      }

      allPlans.forEach((plan, index) => {
        const ep = parsePosNum(plan.entry);
        const sp = parsePosNum(plan.sl);
        const tp = parsePosNum(plan.tp);
        const tp1 = parsePosNum(plan.tp1) ?? tp;
        if (!ep) return;

        const isPrimary = index === 0;
        const dir = String(plan.direction || "").toUpperCase();
        const inferredBuy =
          Number.isFinite(ep) &&
          Number.isFinite(tp) &&
          Number.isFinite(sp)
            ? tp > ep && sp < ep
            : Number.isFinite(ep) && Number.isFinite(tp)
              ? tp > ep
              : Number.isFinite(ep) && Number.isFinite(sp)
                ? sp < ep
                : true;
        const isBuy =
          dir === "BUY" ? true : dir === "SELL" ? false : inferredBuy;
        const alpha = isPrimary ? 1.0 : 0.6;
        const palette = isBuy ? PLAN_COLORS.buy : PLAN_COLORS.sell;
        const lineWidth = 1;
        const closeStatusUpper = String(effectiveCloseStatus || "")
          .trim()
          .toUpperCase();
        const hasExplicitExitPrice =
          Number.isFinite(Number(effectiveExitPrice)) &&
          Number(effectiveExitPrice) > 0;
        const hasOpenedEventForPrimary =
          isPrimary && Number.isFinite(Number(effectiveOpenedAtEpochSec));
        const hasClosedEventForPrimary =
          isPrimary && Number.isFinite(Number(effectiveClosedAtEpochSec));
        const pnlNumber = Number(effectivePnlRealized);
        const closedWithProfit =
          hasClosedEventForPrimary &&
          Number.isFinite(pnlNumber) &&
          pnlNumber > 0;
        const closedWithLoss =
          hasClosedEventForPrimary &&
          Number.isFinite(pnlNumber) &&
          pnlNumber < 0;
        const resolvedClosePrice = Number.isFinite(Number(effectiveClosedAtEpochSec))
          ? resolveTradeCloseDisplayPrice({
              closeStatus: effectiveCloseStatus,
              pnlRealized: effectivePnlRealized,
              exitPrice: effectiveExitPrice,
              tpPrice: tpPrice ?? tp1Price,
              slPrice,
            })
          : null;
        const closeLineColor =
          closeStatusUpper === "TP" ||
          closeStatusUpper === "WIN" ||
          (Number.isFinite(Number(effectivePnlRealized)) &&
            Number(effectivePnlRealized) > 0)
            ? TRADE_TP_DARK
            : TRADE_SL_DARK;
        const hitsClosedSl =
          isPrimary &&
          !hasExplicitExitPrice &&
          Number.isFinite(sp) &&
          (["SL", "LOSS"].includes(closeStatusUpper) || closedWithLoss);
        const hitsClosedTp =
          isPrimary &&
          !hasExplicitExitPrice &&
          Number.isFinite(tp1 ?? tp) &&
          (["TP", "WIN"].includes(closeStatusUpper) || closedWithProfit);

        const entryLine = candleSeries.createPriceLine({
          price: ep,
          color: isPrimary ? palette.entry : palette.entryMuted,
          lineWidth,
          lineStyle:
            hasOpenedEventForPrimary ? LineStyle.Solid : LineStyle.Dotted,
          axisLabelVisible: true,
          title: isPrimary ? resolveTradeBadgeMeta({ side: effectiveSide, kind: "open" }).label : "",
          axisLabelColor: isPrimary ? palette.entry : undefined,
          axisLabelTextColor: isPrimary ? "#ffffff" : undefined,
        });
        planPriceLinesRef.current.push(entryLine);
        if (isPrimary) draggablePlanLineRefs.current.entry = entryLine;
        nextHoverLines.push({
          overlayType: "plan",
          price: ep,
          label: "Entry",
          priceText: formatPriceWithPrecision(ep, pricePrecisionRef.current),
        });
        if (isPrimary) levelPriceMap.entry = ep;

        if (sp) {
          const slAxisLabel = resolveTradeLevelRLabel({
            kind: "sl",
            entryPrice: ep,
            levelPrice: sp,
            slPrice: sp,
            tpPrice: tp1 ?? tp,
            side: effectiveSide,
          });
          const slLine = candleSeries.createPriceLine({
            price: sp,
            color: hitsClosedSl
              ? closeLineColor
              : isPrimary
                ? palette.sl
                : palette.slMuted,
            lineWidth,
            lineStyle: hitsClosedSl ? LineStyle.Solid : LineStyle.Dotted,
            axisLabelVisible: true,
            title:
              isPrimary
                ? slAxisLabel
                : "",
            axisLabelColor: hitsClosedSl
              ? closeLineColor
              : isPrimary
                ? palette.sl
                : undefined,
            axisLabelTextColor: isPrimary ? "#ffffff" : undefined,
          });
          planPriceLinesRef.current.push(slLine);
          if (isPrimary) draggablePlanLineRefs.current.sl = slLine;
          nextHoverLines.push({
            overlayType: "plan",
            price: sp,
            label: "SL",
            priceText: formatPriceWithPrecision(sp, pricePrecisionRef.current),
          });
        }
        if (isPrimary && sp) levelPriceMap.sl = sp;

        const tpLineLevels = [
          { key: "TP1", value: tp1 ?? tp, lineAlpha: alpha },
        ].filter((item) => Number.isFinite(item.value));

        tpLineLevels.forEach((level) => {
          const price = Number(level.value);
          const tpAxisLabel = resolveTradeLevelRLabel({
            kind: level.key,
            entryPrice: ep,
            levelPrice: price,
            tpPrice: tp1 ?? tp,
            slPrice: sp,
            side: effectiveSide,
          });
          const isClosedTpLine =
            hitsClosedTp &&
            samePriceWithinTolerance(
              price,
              resolvedClosePrice,
              pricePrecisionRef.current,
            );
          const tpLine = candleSeries.createPriceLine({
            price,
            color: isClosedTpLine
              ? closeLineColor
              : isPrimary
                ? palette.tp
                : palette.tpMuted,
            lineWidth,
            lineStyle: isClosedTpLine ? LineStyle.Solid : LineStyle.Dotted,
            axisLabelVisible: true,
            title:
              isPrimary
                ? tpAxisLabel
                : "",
            axisLabelColor: isClosedTpLine
              ? closeLineColor
              : isPrimary
                ? palette.tp
                : undefined,
            axisLabelTextColor: isPrimary ? "#ffffff" : undefined,
          });
          planPriceLinesRef.current.push(tpLine);
          if (isPrimary && level.key === "TP1") {
            draggablePlanLineRefs.current.tp1 = tpLine;
          }
          nextHoverLines.push({
            overlayType: "plan",
            price,
            label: level.key,
            priceText: formatPriceWithPrecision(
              price,
              pricePrecisionRef.current,
            ),
          });
        });

        if (isPrimary) {
          levelPriceMap.tp = tp1 ?? tp ?? levelPriceMap.tp;
          if (Number.isFinite(tp1 ?? tp)) levelPriceMap.tp1 = tp1 ?? tp;
        }
      });

      levelPriceMapRef.current = levelPriceMap;
      hoverPriceLinesRef.current.lines = [
        ...hoverPriceLinesRef.current.lines.filter(
          (line) => line?.overlayType !== "plan",
        ),
        ...nextHoverLines,
      ];
      window.requestAnimationFrame(refreshPlanDragHandles);
    },
    [
      clearPlanPriceLines,
      effectiveAnalysisSnapshot,
      effectiveCloseStatus,
      effectiveClosedAtEpochSec,
      effectiveExitPrice,
      effectivePnlRealized,
      effectiveSide,
      entryPrice,
      slPrice,
      showExtraPlans,
      showPrimaryPlan,
      tp1Price,
      tp2Price,
      tp3Price,
      tpPrice,
      refreshPlanDragHandles,
    ],
  );

  const renderTradeOverlays = useCallback(
    (candles = [], markers = [], options = {}) => {
      const candleSeries = seriesRef.current;
      if (!candleSeries || !Array.isArray(candles) || !candles.length) {
        return markers;
      }

      const canRenderOverlay = options?.canRenderTradeOverlay === true;
      const createdTs = resolveEventMarkerTimeSec(
        candles,
        normalizedCreatedAtEpochSec,
        interval,
      );
      const openedTs = hasExplicitOpenedEvent
        ? resolveEventMarkerTimeSec(candles, effectiveOpenedAtEpochSec, interval)
        : null;
      const replayNowSec = Number(replayClockTimeSec);
      const canShowCreatedEvent =
        !isReplayActive ||
        !Number.isFinite(replayNowSec) ||
        replayNowSec >= Number(normalizedCreatedAtEpochSec);
      const canShowOpenedEvent =
        !isReplayActive ||
        !Number.isFinite(replayNowSec) ||
        replayNowSec >= Number(effectiveOpenedAtEpochSec);
      const canShowClosedEvent =
        !isReplayActive ||
        !Number.isFinite(replayNowSec) ||
        replayNowSec >= Number(effectiveClosedAtEpochSec);
      const showStandaloneCreatedMarker =
        Number.isFinite(createdTs) &&
        (!Number.isFinite(openedTs) || Math.abs(openedTs - createdTs) > 60);

      if (showStandaloneCreatedMarker && canShowCreatedEvent) {
        const createdMarkerStyle = resolveTradeMarkerPresentation({
          side: effectiveSide,
          kind: "created",
        });
        const createdMarkerPrice = resolveEventMarkerAnchorPrice(
          candles,
          normalizedCreatedAtEpochSec,
          createdMarkerStyle.chartPosition,
          effectiveEntryPrice,
        );
        const createdMarkerPrimitive = new EventTimeMarkerPrimitive({
          timeSec: Number(createdTs),
          price: Number(createdMarkerPrice),
          color: TRADE_MARKER_YELLOW,
          text: buildTradeCreatedLabel(effectiveTradeLabel, effectiveSide),
          placement: createdMarkerStyle.chartPosition,
        });
        candleSeries.attachPrimitive(createdMarkerPrimitive);
        tradeOverlayPrimitivesRef.current.push(createdMarkerPrimitive);
        registerHoverMarker({
          id: `trade-created-${String(overlayTrade?.sid || effectiveTradeLabel || createdTs)}`,
          overlayType: "trade-event",
          timeSec: Number(createdTs),
          price: Number(createdMarkerPrice),
          tooltipHtml: buildTradeMarkerTooltipHtml({
            trade: overlayTrade || {
              side: effectiveSide,
              tradeLabel: effectiveTradeLabel,
              entry: effectiveEntryPrice,
              sl: slPrice,
              tp: tp1Price ?? tpPrice,
              createdAtSec: normalizedCreatedAtEpochSec,
            },
            markerKind: "trade_created",
            markerLabel: buildTradeCreatedLabel(effectiveTradeLabel, effectiveSide),
            eventTimeSec: Number(createdTs),
          }),
        });
      }

      if (Number.isFinite(openedTs)) {
        const openLineColor =
          String(effectiveSide || "").toUpperCase() === "SELL"
            ? PLAN_COLORS.sell.entry
            : PLAN_COLORS.buy.entry;
        if (Number.isFinite(Number(effectiveEntryPrice))) {
          const openedPriceLine = candleSeries.createPriceLine({
            price: Number(effectiveEntryPrice),
            color: openLineColor,
            lineWidth: 1,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: "",
            axisLabelColor: openLineColor,
            axisLabelTextColor: "#ffffff",
          });
          tradeOverlayPriceLinesRef.current.push(openedPriceLine);
        }
        if (
          canShowOpenedEvent &&
          (!showStandaloneCreatedMarker || Math.abs(openedTs - createdTs) > 60)
        ) {
          const openedMarkerStyle = resolveTradeMarkerPresentation({
            side: effectiveSide,
            kind: "opened",
          });
          const openedMarkerPrice =
            Number.isFinite(Number(effectiveEntryPrice))
              ? Number(effectiveEntryPrice)
              : resolveEventMarkerAnchorPrice(
                  candles,
                  effectiveOpenedAtEpochSec,
                  openedMarkerStyle.chartPosition,
                  effectiveEntryPrice,
                );
          const openedMarkerPrimitive = new EventTimeMarkerPrimitive({
            timeSec: Number(openedTs),
            price: Number(openedMarkerPrice),
            color: TRADE_MARKER_YELLOW,
            text: buildTradeOpenedLabel(),
            placement: openedMarkerStyle.chartPosition,
          });
          candleSeries.attachPrimitive(openedMarkerPrimitive);
          tradeOverlayPrimitivesRef.current.push(openedMarkerPrimitive);
          registerHoverMarker({
            id: `trade-opened-${String(overlayTrade?.sid || effectiveTradeLabel || openedTs)}`,
            overlayType: "trade-event",
            timeSec: Number(openedTs),
            price: Number(openedMarkerPrice),
            tooltipHtml: buildTradeMarkerTooltipHtml({
              trade: overlayTrade || {
                side: effectiveSide,
                tradeLabel: effectiveTradeLabel,
                entry: effectiveEntryPrice,
                sl: slPrice,
                tp: tp1Price ?? tpPrice,
                openedAtSec: effectiveOpenedAtEpochSec,
              },
              markerKind: "trade_opened",
              markerLabel: buildTradeOpenedLabel(),
              eventTimeSec: Number(openedTs),
            }),
          });
        }
      }

      const selectedStatusUpper = normalizeTradeStatusKey(effectiveCloseStatus);
      const selectedIsClosed =
        (isClosedTradeStatus(selectedStatusUpper) ||
          Number.isFinite(Number(effectivePnlRealized))) &&
        Number.isFinite(Number(effectiveClosedAtEpochSec)) &&
        Number(effectiveClosedAtEpochSec) > 0;
      const selectedProjectedStartTimeSec =
        Number.isFinite(Number(openedTs)) && Number(openedTs) > 0
          ? Number(openedTs)
          : Number.isFinite(Number(createdTs)) && Number(createdTs) > 0
            ? Number(createdTs)
            : null;
      const selectedLatestBarTimeSec =
        Number(candles[candles.length - 1]?.time || 0) || null;
      if (
        !selectedIsClosed &&
        Number.isFinite(Number(selectedProjectedStartTimeSec)) &&
        Number(selectedProjectedStartTimeSec) > 0
      ) {
        const selectedProjectedSpecs = buildTradeBoxSpecs({
          entryPrice: effectiveEntryPrice,
          tpPrice: tp1Price ?? tpPrice,
          slPrice,
          status: effectiveCloseStatus,
          pnlRealized: effectivePnlRealized,
          startTimeSec: Number(selectedProjectedStartTimeSec),
          latestBarTimeSec: selectedLatestBarTimeSec,
        });
        attachTradeBoxSpecs(
          candleSeries,
          tradeOverlayPrimitivesRef,
          selectedProjectedSpecs,
        );
      }

      if (Number.isFinite(effectiveClosedAtEpochSec)) {
        const closeTs = resolveEventMarkerTimeSec(
          candles,
          effectiveClosedAtEpochSec,
          interval,
        );
        const fallbackSelectedCloseTs =
          Number(candles[candles.length - 1]?.time || 0) || null;
        const resolvedSelectedCloseTs =
          Number.isFinite(Number(closeTs)) && Number(closeTs) > 0
            ? Number(closeTs)
            : Number.isFinite(Number(fallbackSelectedCloseTs)) &&
                Number(fallbackSelectedCloseTs) > 0
              ? Number(fallbackSelectedCloseTs)
              : null;
        const closeBadge = resolveTradeBadgeMeta({
          side: effectiveSide,
          closeStatus: effectiveCloseStatus,
          pnlRealized: effectivePnlRealized,
          kind: "close",
        });
        const closeLineColor =
          String(effectiveCloseStatus || "").toUpperCase() === "TP" ||
          (Number.isFinite(Number(effectivePnlRealized)) &&
            Number(effectivePnlRealized) > 0)
            ? TRADE_TP_DARK
            : TRADE_SL_DARK;
        const resolvedCloseLinePrice = resolveTradeCloseDisplayPrice({
          closeStatus: effectiveCloseStatus,
          pnlRealized: effectivePnlRealized,
          exitPrice: effectiveExitPrice,
          exitPriceRaw: overlayTrade?.exitPriceRaw,
          tpPrice: tpPrice ?? tp1Price,
          slPrice,
        });
        const closeLine = resolveClosedTradeLineStyle(
          {
            closeStatus: effectiveCloseStatus,
            pnlRealized: effectivePnlRealized,
            exitPrice: effectiveExitPrice,
            exitPriceRaw: overlayTrade?.exitPriceRaw,
            tpPrice: tpPrice ?? tp1Price,
            slPrice,
          },
          computePriceBoundsFromBars(candles),
        );
        const resolvedCloseBadgePrice =
          closeLine?.value ??
          resolvedCloseLinePrice ??
          (Number.isFinite(Number(effectiveExitPrice))
            ? Number(effectiveExitPrice)
            : Number.isFinite(Number(effectiveEntryPrice))
              ? Number(effectiveEntryPrice)
              : null);
        const closeAxisLabel = resolveTradeLevelRLabel({
          kind: "close",
          entryPrice: effectiveEntryPrice,
          levelPrice: closeLine?.value ?? resolvedCloseLinePrice,
          tpPrice: tp1Price ?? tpPrice,
          slPrice,
          side: effectiveSide,
          rMultiple: overlayTrade?.rMultiple,
          pnlRealized: effectivePnlRealized,
          closeStatus: effectiveCloseStatus,
          exitPrice: resolvedCloseBadgePrice,
        });

        if (Number.isFinite(closeTs) && canShowClosedEvent) {
          const closeMarkerStyle = resolveTradeMarkerPresentation({
            side: effectiveSide,
            closeStatus: effectiveCloseStatus,
            pnlRealized: effectivePnlRealized,
            kind: "close",
          });
          const closeMarkerPrice =
            Number.isFinite(Number(resolvedCloseBadgePrice))
              ? Number(resolvedCloseBadgePrice)
              : resolveEventMarkerAnchorPrice(
                  candles,
                  effectiveClosedAtEpochSec,
                  closeMarkerStyle.chartPosition,
                  resolvedCloseBadgePrice,
                );
          const closeMarkerPrimitive = new EventTimeMarkerPrimitive({
            timeSec: Number(closeTs),
            price: Number(closeMarkerPrice),
            color: closeBadge.color,
            text: buildTradeCloseLabel(
              effectivePnlRealized,
              effectiveCloseStatus,
              resolvedCloseLinePrice,
              {
                rMultiple: overlayTrade?.rMultiple,
                entryPrice: effectiveEntryPrice,
                exitPrice: resolvedCloseBadgePrice,
                tpPrice: tp1Price ?? tpPrice,
                slPrice,
                side: effectiveSide,
              },
            ),
            placement: closeMarkerStyle.chartPosition,
          });
          candleSeries.attachPrimitive(closeMarkerPrimitive);
          tradeOverlayPrimitivesRef.current.push(closeMarkerPrimitive);
          registerHoverMarker({
            id: `trade-closed-${String(overlayTrade?.sid || effectiveTradeLabel || closeTs)}`,
            overlayType: "trade-event",
            timeSec: Number(closeTs),
            price: Number(closeMarkerPrice),
            tooltipHtml: buildTradeMarkerTooltipHtml({
              trade: overlayTrade || {
                side: effectiveSide,
                tradeLabel: effectiveTradeLabel,
                entry: effectiveEntryPrice,
                exitPrice: resolvedCloseBadgePrice,
                sl: slPrice,
                tp: tp1Price ?? tpPrice,
                closedAtSec: effectiveClosedAtEpochSec,
                pnlRealized: effectivePnlRealized,
                closeStatus: effectiveCloseStatus,
              },
              markerKind: "trade_closed",
              markerLabel: closeBadge.label || "Closed",
              eventTimeSec: Number(closeTs),
            }),
          });
        }

        if (Number.isFinite(closeLine?.value)) {
          const closePriceLine = candleSeries.createPriceLine({
            price: closeLine.value,
            color: closeLine.color || closeLineColor,
            lineWidth: 1,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: closeAxisLabel || closeBadge.label || "Closed",
            axisLabelColor: closeLine.color || closeLineColor,
            axisLabelTextColor: "#ffffff",
          });
          tradeOverlayPriceLinesRef.current.push(closePriceLine);
        }

        if (
          selectedIsClosed &&
          Number.isFinite(Number(openedTs)) &&
          Number(openedTs) > 0 &&
          Number.isFinite(Number(resolvedSelectedCloseTs)) &&
          Number(resolvedSelectedCloseTs) > 0
        ) {
          const selectedClosedSpecs = buildTradeBoxSpecs({
            entryPrice: effectiveEntryPrice,
            tpPrice: tp1Price ?? tpPrice,
            slPrice,
            status: effectiveCloseStatus,
            pnlRealized: effectivePnlRealized,
            startTimeSec: Number(openedTs),
            closedTimeSec: Number(resolvedSelectedCloseTs),
            latestBarTimeSec: selectedLatestBarTimeSec,
          });
          attachTradeBoxSpecs(
            candleSeries,
            tradeOverlayPrimitivesRef,
            selectedClosedSpecs,
          );
        }

        if (
          canRenderOverlay &&
          Number.isFinite(Number(effectiveEntryPrice)) &&
          Number.isFinite(resolvedCloseBadgePrice) &&
          Number.isFinite(openedTs) &&
          Number.isFinite(closeTs)
        ) {
          const timeRangeBoxPrimitive = new TimeRangeBoxPrimitive({
            startTimeSec: openedTs,
            endTimeSec: closeTs,
            priceLow: Math.min(
              Number(effectiveEntryPrice),
              resolvedCloseBadgePrice,
            ),
            priceHigh: Math.max(
              Number(effectiveEntryPrice),
              resolvedCloseBadgePrice,
            ),
            lineColor: closeBadge.color,
            fillColor:
              closeBadge.color === BACKTEST_CHART_THEME.profit
                ? BACKTEST_CHART_THEME.tradeBoxProfit
                : BACKTEST_CHART_THEME.tradeBoxLoss,
          });
          candleSeries.attachPrimitive(timeRangeBoxPrimitive);
          tradeOverlayPrimitivesRef.current.push(timeRangeBoxPrimitive);
        }
      }

      return markers;
    },
    [
      effectiveClosedAtEpochSec,
      effectiveCloseStatus,
      effectiveEntryPrice,
      effectiveExitPrice,
      effectiveOpenedAtEpochSec,
      effectivePnlRealized,
      effectiveSide,
      effectiveTradeLabel,
      hasExplicitOpenedEvent,
      interval,
      isReplayActive,
      normalizedCreatedAtEpochSec,
      overlayTrade?.rMultiple,
      overlayTrade?.sid,
      buildTradeMarkerTooltipHtml,
      registerHoverMarker,
      replayClockTimeSec,
      slPrice,
      tp1Price,
      tpPrice,
    ],
  );

  useEffect(() => {
    const onTimezoneUiChanged = () => setTimezoneTick((n) => n + 1);
    window.addEventListener("ui-timezone-changed", onTimezoneUiChanged);
    return () =>
      window.removeEventListener("ui-timezone-changed", onTimezoneUiChanged);
  }, []);

  useEffect(() => {
    if (!chartContainerRef.current) return;
    const container = chartContainerRef.current;
    if (!container.clientWidth || !container.clientHeight) return;
    const theme = getUiThemeColors();
    const isLight = theme.mode === "light";

    let isMounted = true;
    let chart;
    try {
      // 1. Initialize Chart
      chart = createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight || height,
        layout: {
          background: {
            type: ColorType.Solid,
            color: isLight ? theme.surface : "#0d1117",
          },
          textColor: isLight ? theme.text : "#d1d4dc",
          fontSize: 9,
        },
        grid: {
          vertLines: {
            color: isLight
              ? "rgba(148,163,184,0.18)"
              : "rgba(42, 46, 57, 0.1)",
          },
          horzLines: {
            color: isLight
              ? "rgba(148,163,184,0.18)"
              : "rgba(42, 46, 57, 0.1)",
          },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: "rgba(148,163,184,0.18)",
            width: 1,
            style: LineStyle.Dotted,
            labelBackgroundColor: "rgba(15, 23, 42, 0.66)",
          },
          horzLine: {
            color: "rgba(148,163,184,0.18)",
            width: 1,
            style: LineStyle.Dotted,
            labelBackgroundColor: "rgba(15, 23, 42, 0.66)",
          },
        },
        timeScale: {
          borderColor: isLight
            ? "rgba(148,163,184,0.35)"
            : "rgba(197, 203, 206, 0.4)",
          timeVisible: true,
          visible: true,
          secondsVisible: false,
          ignoreWhitespaceIndices: true,
          tickMarkFormatter: (time, tickMarkType, locale) =>
            formatTradingViewLikeTickMark(
              time,
              tickMarkType,
              locale,
              displayTimezone,
            ),
        },
        rightPriceScale: {
          borderColor: isLight
            ? "rgba(148,163,184,0.28)"
            : "rgba(197, 203, 206, 0.3)",
          scaleMargins: { top: 0.05, bottom: 0.05 },
          entireTextOnly: true,
        },
        localization: {
          priceFormatter: (price) => {
            return formatPriceWithPrecision(price, pricePrecisionRef.current);
          },
          timeFormatter: (time) =>
            formatChronosAxisTime(
              Number(time) * 1000,
              displayTimezone,
              interval,
            ),
        },
      });

      const handleResize = () => {
        if (!chartContainerRef.current || !chart) return;
        // Use explicit resize for better reliability
        chart.resize(
          chartContainerRef.current.clientWidth,
          chartContainerRef.current.clientHeight || height,
        );
        window.requestAnimationFrame(refreshPlanDragHandles);
      };
      let emitViewport = () => {};
      let viewportEmitTimer = null;
      const scheduleEmitViewport = () => {
        if (viewportEmitTimer) window.clearTimeout(viewportEmitTimer);
        viewportEmitTimer = window.setTimeout(() => {
          viewportEmitTimer = null;
          emitViewport();
        }, 60);
      };

      let resizeObserver = null;
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          handleResize();
          emitViewport();
        });
        resizeObserver.observe(chartContainerRef.current);
      }
      const onWindowResize = () => {
        handleResize();
        emitViewport();
      };
      window.addEventListener("resize", onWindowResize);

      const candleSeries = chart.addSeries(
        CandlestickSeries,
        getCandleSeriesOptions({
          candlesVisible: effectiveIndicatorVisibility.candles !== false,
          zigzagVisible: effectiveIndicatorVisibility.zigzag !== false,
        }),
      );

      chartRef.current = chart;
      seriesRef.current = candleSeries;
      chart.applyOptions({
        layout: {
          panes: {
            separatorColor: isLight
              ? "rgba(148,163,184,0.28)"
              : "rgba(255,255,255,0.08)",
            separatorHoverColor: isLight
              ? "rgba(148,163,184,0.36)"
              : "rgba(255,255,255,0.12)",
          },
        },
      });

      const indicatorSeriesMap = {
        sma20: chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.sma20,
          lineWidth: INDICATOR_LINE_STYLE.width,
          lineStyle: INDICATOR_LINE_STYLE.dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.sma20),
          crosshairMarkerVisible: false,
        }),
        sma50: chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.sma50,
          lineWidth: INDICATOR_LINE_STYLE.width,
          lineStyle: INDICATOR_LINE_STYLE.dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.sma50),
          crosshairMarkerVisible: false,
        }),
        sma200: chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.sma200,
          lineWidth: INDICATOR_LINE_STYLE.width,
          lineStyle: INDICATOR_LINE_STYLE.dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.sma200),
          crosshairMarkerVisible: false,
        }),
        ema20: chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.ema20,
          lineWidth: INDICATOR_LINE_STYLE.width,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.ema20),
          crosshairMarkerVisible: false,
        }),
        ema50: chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.ema50,
          lineWidth: INDICATOR_LINE_STYLE.width,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.ema50),
          crosshairMarkerVisible: false,
        }),
        ema200: chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.ema200,
          lineWidth: INDICATOR_LINE_STYLE.width,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.ema200),
          crosshairMarkerVisible: false,
        }),
        vwap: chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.vwap,
          lineWidth: INDICATOR_LINE_STYLE.width,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.vwap),
          crosshairMarkerVisible: false,
        }),
        bbMid: chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.bbMid,
          lineWidth: INDICATOR_LINE_STYLE.accentWidth,
          lineStyle: INDICATOR_LINE_STYLE.dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.bbMid),
          crosshairMarkerVisible: false,
        }),
        bbUpper: chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.bbUpper,
          lineWidth: INDICATOR_LINE_STYLE.accentWidth,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.bbUpper),
          crosshairMarkerVisible: false,
        }),
        bbLower: chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.bbLower,
          lineWidth: INDICATOR_LINE_STYLE.accentWidth,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.bbLower),
          crosshairMarkerVisible: false,
        }),
        ichiTenkan: chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.ichiTenkan,
          lineWidth: INDICATOR_LINE_STYLE.accentWidth,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.ichiTenkan),
          crosshairMarkerVisible: false,
        }),
        ichiKijun: chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.ichiKijun,
          lineWidth: INDICATOR_LINE_STYLE.accentWidth,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.ichiKijun),
          crosshairMarkerVisible: false,
        }),
        ichiSpanA: chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.ichiSpanA,
          lineWidth: INDICATOR_LINE_STYLE.accentWidth,
          lineStyle: LineStyle.Dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.ichiSpanA),
          crosshairMarkerVisible: false,
        }),
        ichiSpanB: chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.ichiSpanB,
          lineWidth: INDICATOR_LINE_STYLE.accentWidth,
          lineStyle: LineStyle.Dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.ichiSpanB),
          crosshairMarkerVisible: false,
        }),
        ichiChikou: chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.ichiChikou,
          lineWidth: INDICATOR_LINE_STYLE.accentWidth,
          lineStyle: LineStyle.Dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.ichiChikou),
          crosshairMarkerVisible: false,
        }),
        zigzag: chart.addSeries(LineSeries, {
          color: artifactPaletteColorForTf(interval),
          lineWidth: INDICATOR_LINE_STYLE.accentWidth,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.zigzag),
          crosshairMarkerVisible: false,
        }),
      };

      if (showIndicators && showRsiPanel) {
        chart.addPane(true);
        try {
          const secondPane = chart.panes()[1];
          secondPane?.setHeight?.(RSI_PANE_HEIGHT);
          if (secondPane?.getHeight) {
            const nextHeight = Number(secondPane.getHeight());
            if (Number.isFinite(nextHeight) && nextHeight > 0) {
              setIndicatorOverlayHeight(nextHeight);
            }
          }
        } catch {}

        indicatorSeriesMap.rsi = chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.rsi,
          lineWidth: INDICATOR_LINE_STYLE.width,
          lineStyle: INDICATOR_LINE_STYLE.dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.rsi),
          crosshairMarkerVisible: false,
          priceFormat: {
            type: "price",
            precision: 0,
            minMove: 1,
          },
        }, 1);
        indicatorSeriesMap.rsiEma9 = chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.rsiEma9,
          lineWidth: INDICATOR_LINE_STYLE.accentWidth,
          lineStyle: INDICATOR_LINE_STYLE.dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.rsiEma9),
          crosshairMarkerVisible: false,
          priceFormat: {
            type: "price",
            precision: 0,
            minMove: 1,
          },
        }, 1);
        indicatorSeriesMap.rsiWma45 = chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.rsiWma45,
          lineWidth: INDICATOR_LINE_STYLE.accentWidth,
          lineStyle: INDICATOR_LINE_STYLE.dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.rsiWma45),
          crosshairMarkerVisible: false,
          priceFormat: {
            type: "price",
            precision: 0,
            minMove: 1,
          },
        }, 1);
        indicatorSeriesMap.stochK = chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.stochK,
          lineWidth: INDICATOR_LINE_STYLE.accentWidth,
          lineStyle: INDICATOR_LINE_STYLE.dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.stochK),
          crosshairMarkerVisible: false,
          priceFormat: { type: "price", precision: 0, minMove: 1 },
        }, 1);
        indicatorSeriesMap.stochD = chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.stochD,
          lineWidth: INDICATOR_LINE_STYLE.accentWidth,
          lineStyle: INDICATOR_LINE_STYLE.dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.stochD),
          crosshairMarkerVisible: false,
          priceFormat: { type: "price", precision: 0, minMove: 1 },
        }, 1);
        [60, 40].forEach((level) => {
          indicatorSeriesMap.rsi.createPriceLine({
            price: level,
            color: INDICATOR_LINE_STYLE.colors.levelMain,
            lineWidth: 1,
            lineStyle: INDICATOR_LINE_STYLE.dotted,
            axisLabelVisible: false,
            title: "",
          });
        });
      }

      if (showIndicators && showMacdPanel) {
        const macdPaneIndex = 1;
        try {
          const macdPane = chart.panes()[macdPaneIndex];
          macdPane?.setHeight?.(MACD_PANE_HEIGHT);
        } catch {}
        indicatorSeriesMap.macdHistogram = chart.addSeries(
          HistogramSeries,
          {
            priceLineVisible: false,
            lastValueVisible: false,
            visible: Boolean(effectiveIndicatorVisibility.macdHistogram),
            base: 0,
            color: INDICATOR_LINE_STYLE.colors.macdHistogramUp,
          },
          macdPaneIndex,
        );
        indicatorSeriesMap.macd = chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.macd,
          lineWidth: INDICATOR_LINE_STYLE.accentWidth,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.macd),
          crosshairMarkerVisible: false,
        }, macdPaneIndex);
        indicatorSeriesMap.macdSignal = chart.addSeries(LineSeries, {
          color: INDICATOR_LINE_STYLE.colors.macdSignal,
          lineWidth: INDICATOR_LINE_STYLE.accentWidth,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: Boolean(effectiveIndicatorVisibility.macdSignal),
          crosshairMarkerVisible: false,
        }, macdPaneIndex);
      }

      indicatorSeriesRefs.current = indicatorSeriesMap;

      emitViewport = () => {
        if (typeof onViewportChange !== "function") return;
        if (!chartContainerRef.current || !chart || !candleSeries) return;
        const w = chartContainerRef.current.clientWidth || 0;
        const h = chartContainerRef.current.clientHeight || height || 0;
        if (!w || !h) return;
        const t0 = lwTimeToMs(chart.timeScale().coordinateToTime(0));
        const t1 = lwTimeToMs(chart.timeScale().coordinateToTime(w));
        let visiblePriceRange = null;
        try {
          visiblePriceRange = candleSeries.priceScale().getVisibleRange();
        } catch {
          visiblePriceRange = null;
        }
        const pTop = Number(visiblePriceRange?.to);
        const pBottom = Number(visiblePriceRange?.from);
        let visibleBars = 0;
        try {
          const logicalRange = chart.timeScale().getVisibleLogicalRange();
          if (
            logicalRange &&
            Number.isFinite(Number(logicalRange.from)) &&
            Number.isFinite(Number(logicalRange.to))
          ) {
            const logicalFrom = Number(logicalRange.from);
            const logicalTo = Number(logicalRange.to);
            visibleBars = Math.max(
              0,
              Math.floor(logicalTo) - Math.ceil(logicalFrom) + 1,
            );
          }
        } catch {
          visibleBars = 0;
        }
        let actualVisibleBars = 0;
        if (Array.isArray(currentBarsRef.current)) {
          actualVisibleBars = currentBarsRef.current.filter((bar) => {
            const timeMs = Number(bar?.time) * 1000;
            return (
              Number.isFinite(timeMs) &&
              (t0 == null || timeMs >= t0) &&
              (t1 == null || timeMs <= t1)
            );
          }).length;
        }
        if (actualVisibleBars > 0) {
          visibleBars =
            visibleBars > 0
              ? Math.min(visibleBars, actualVisibleBars)
              : actualVisibleBars;
        }
        onViewportChange({
          chartId,
          interval,
          width: w,
          height: h,
          timeStartMs: Number.isFinite(t0) ? t0 : null,
          timeEndMs: Number.isFinite(t1) ? t1 : null,
          visibleBars: Number.isFinite(visibleBars) ? visibleBars : null,
          priceTop: Number.isFinite(Number(pTop)) ? Number(pTop) : null,
          priceBottom: Number.isFinite(Number(pBottom))
            ? Number(pBottom)
            : null,
        });
        runtimeViewportRef.current = {
          chartId,
          interval,
          width: w,
          height: h,
          timeStartMs: Number.isFinite(t0) ? t0 : null,
          timeEndMs: Number.isFinite(t1) ? t1 : null,
          visibleBars: Number.isFinite(visibleBars) ? visibleBars : null,
          priceTop: Number.isFinite(Number(pTop)) ? Number(pTop) : null,
          priceBottom: Number.isFinite(Number(pBottom))
            ? Number(pBottom)
            : null,
        };
      };

      const handleCrosshairMove = (param) => {
        if (suppressCrosshairSyncRef.current) {
          suppressCrosshairSyncRef.current = false;
          return;
        }
        if (typeof onCrosshairSync !== "function") return;
        if (!param?.point || !param?.time) {
          clearCandleHoverPriceLine();
          clearIndicatorHoverPriceLines();
          lastCrosshairContextRef.current = {
            ...lastCrosshairContextRef.current,
            time: null,
          };
          onCrosshairSync({ sourceId: chartId, active: false });
          return;
        }

        const candleData = param.seriesData?.get?.(candleSeries);
        const exactHoverPrice = param.point
          ? candleSeries.coordinateToPrice(param.point.y)
          : null;
        const fallbackPrice = candleData?.close ?? candleData?.value ?? null;
        const price = Number(
          Number.isFinite(Number(exactHoverPrice))
            ? exactHoverPrice
            : fallbackPrice,
        );
        if (!Number.isFinite(price)) return;
        setCandleHoverGuide(price);
        lastCrosshairContextRef.current = {
          time: Number(param.time) || null,
          price,
        };

        const indicatorHoverValues = {};
        for (const key of ["rsi", "rsiEma9", "rsiWma45", "stochK", "stochD"]) {
          const series = indicatorSeriesRefs.current?.[key];
          const seriesData = series ? param.seriesData?.get?.(series) : null;
          const seriesValue = Number(seriesData?.value);
          if (Number.isFinite(seriesValue)) {
            indicatorHoverValues[key] = seriesValue;
          }
        }
        setIndicatorHoverGuides(indicatorHoverValues);

        onCrosshairSync({
          sourceId: chartId,
          active: true,
          time: param.time,
          price,
          indicatorValues: indicatorHoverValues,
        });
      };

      chart.subscribeCrosshairMove(handleCrosshairMove);
      const chartElement = chart.chartElement();
      chartElement.addEventListener("wheel", scheduleEmitViewport, {
        passive: true,
      });
      chartElement.addEventListener("mouseup", scheduleEmitViewport);
      chartElement.addEventListener("touchend", scheduleEmitViewport, {
        passive: true,
      });

      // --- Fixed artifact note (top-right) ---
      const tooltipEl = document.createElement("div");
      tooltipEl.style.cssText =
        `display:none;position:absolute;z-index:100;top:6px;right:60px;left:auto;background:transparent;color:${theme.text};padding:0;border-radius:0;font-size:8px;pointer-events:none;white-space:normal;border:none;box-shadow:none;max-width:190px;`;
      chartElement.appendChild(tooltipEl);
      const handleVisibleRangeChange = () => {
        window.requestAnimationFrame(refreshPlanDragHandles);
      };
      try {
        chart.timeScale().subscribeVisibleLogicalRangeChange(
          handleVisibleRangeChange,
        );
      } catch {}

      const handleMarkerHover = (param) => {
        if (!param?.point || !candleSeries) return false;
        const markers = hoverMarkersRef.current;
        if (!Array.isArray(markers) || !markers.length) return false;
        const timeScale = chart.timeScale();
        let closest = null;
        let closestScore = Infinity;
        for (const marker of markers) {
          const x = timeScale.timeToCoordinate(Number(marker?.timeSec));
          const y = candleSeries.priceToCoordinate(Number(marker?.price));
          if (x == null || y == null) continue;
          const dx = Math.abs(Number(param.point.x) - Number(x));
          const dy = Math.abs(Number(param.point.y) - Number(y));
          if (dx > 24 || dy > 38) continue;
          const score = dx * 1.15 + dy;
          if (score < closestScore) {
            closestScore = score;
            closest = { ...marker, x, y };
          }
        }
        if (!closest) return false;
        tooltipEl.style.display = "block";
        tooltipEl.innerHTML =
          closest.tooltipHtml ||
          renderTooltipCardHtml({
            title: closest.tooltipText || "Marker",
          });
        return true;
      };

      const handlePriceLineHover = (param) => {
        if (!param?.point || !candleSeries) {
          tooltipEl.style.display = "none";
          return;
        }
        const lines = hoverPriceLinesRef.current.lines;
        let closest = null;
        let closestDist = 12; // pixels threshold
        for (const l of lines) {
          const y = candleSeries.priceToCoordinate(l.price);
          if (y == null) continue;
          const dist = Math.abs(param.point.y - y);
          if (dist < closestDist) {
            closestDist = dist;
            closest = { ...l, y };
          }
        }
        if (closest) {
          tooltipEl.style.display = "block";
          tooltipEl.innerHTML = renderCompactArtifactTooltipHtml({
            label: compactTooltipText(closest.label, "Artifact"),
            tf: closest.sourceTf || "",
            type: closest.artifactType || "",
            group: closest.artifactGroup || "",
            family: closest.artifactFamily || "",
            direction: closest.direction || "",
            markerText: closest.markerText || "",
            eventKey: closest.eventKey || "",
            isEvent: closest.isEvent === true,
          });
        } else {
          tooltipEl.style.display = "none";
        }
      };

      chart.subscribeCrosshairMove((param) => {
        const markerVisible = handleMarkerHover(param);
        if (!markerVisible) {
          handlePriceLineHover(param);
        }
        handleCrosshairMove(param);
      });
      // Remove the old subscription (replaced by combined one above)
      // Actually, subscribeCrosshairMove supports multiple subscribers, so both work.
      // But we use the combined one to avoid duplicate handling.

      const dragState = { activeKey: null };
      let removeDragListeners = () => {};
      let removeContextMenuListener = () => {};

      // 3. Fetch History + Start Live
      async function initData() {
        hoverPriceLinesRef.current.lines = [];
        hoverMarkersRef.current = [];
        clearPlanPriceLines();
        clearTradeOverlayArtifacts();
        let snapshot = effectiveAnalysisSnapshot;
        let snapshotBars = parseSnapshotBars(snapshot);
        let hasSnapshotBars = snapshotBars.length > 0;
        try {
          setLoading(false);
          let candles = [];
          const cachedEntry = chartFetchManager.get(symbol, interval);
          if (historicalData && historicalData.length > 0) {
            candles = historicalData;
            setDataSource("historical");
          } else if (hasSnapshotBars) {
            candles = snapshotBars;
            setDataSource("snapshot");
          } else {
            // Check in-memory cache first (populated by chartFetchManager across page loads)
            if (cachedEntry?.bars && cachedEntry.bars.length > 0) {
              candles = cachedEntry.bars;
              snapshot = {
                ...snapshot,
                bar_start: cachedEntry.bar_start,
                bar_end: cachedEntry.bar_end,
              };
              snapshotBars = candles;
              hasSnapshotBars = true;
              setDataSource("cache");
            } else {
              const tradeAnchorEndTimeSec = Math.max(
                0,
                Number(closedAtEpochSec) || 0,
                Number(openedAtEpochSec) || 0,
                Number(createdAtEpochSec) || 0,
              );
              const fallbackBarsRequest = Math.max(
                300,
                Math.min(
                  5000,
                  Math.round(Number(visibleBarsCount) || 0) || 0,
                ),
              );
              if (symbol && interval && tradeAnchorEndTimeSec > 0) {
                try {
                  const brokerOut = await api.brokerBars(
                    symbol,
                    interval,
                    fallbackBarsRequest,
                    tradeAnchorEndTimeSec,
                  );
                  const brokerBars = ensureValidBars(
                    normalizeBrokerHistoryBars(brokerOut?.bars),
                  );
                  if (brokerBars.length > 0) {
                    candles = brokerBars;
                    snapshot = {
                      ...snapshot,
                      bar_start: brokerBars[0]?.time || null,
                      bar_end: brokerBars[brokerBars.length - 1]?.time || null,
                      last_price: Number(
                        brokerBars[brokerBars.length - 1]?.close,
                      ) || null,
                      metadata:
                        brokerOut?.metadata && typeof brokerOut.metadata === "object"
                          ? brokerOut.metadata
                          : snapshot?.metadata && typeof snapshot.metadata === "object"
                            ? snapshot.metadata
                            : null,
                    };
                    snapshotBars = brokerBars;
                    hasSnapshotBars = true;
                    chartFetchManager.set(symbol, interval, {
                      bars: brokerBars,
                      bar_start: brokerBars[0]?.time || null,
                      bar_end: brokerBars[brokerBars.length - 1]?.time || null,
                      last_price: Number(
                        brokerBars[brokerBars.length - 1]?.close,
                      ) || null,
                      metadata:
                        brokerOut?.metadata && typeof brokerOut.metadata === "object"
                          ? brokerOut.metadata
                          : null,
                    });
                    setDataSource("broker-history");
                  }
                } catch {}
              }
              if (!candles.length) {
                // No cached local data available. Don't auto-call TwelveData —
                // user must click Refresh button in Info tab to fetch.
                setLoading(false);
                return;
              }
            } // end cache-check else
          }

          // Validate bar data before passing to lightweight-charts.
          // Malformed time values (undefined/null/non-finite) crash the chart.
          candles = chooseSafeChartBars(
            filterRenderableBarsForSymbol(candles, symbol, interval),
            currentBarsRef.current,
            interval,
          );
          currentBarsRef.current = candles;

          if (!candles.length) {
            currentBarsRef.current = [];
            clearPlanPriceLines();
            clearTradeOverlayArtifacts();
            clearSharedOverlayArtifacts();
            clearCandleHoverPriceLine();
            clearIndicatorHoverPriceLines();
            try {
              candleSeries.setData([]);
            } catch {}
            clearIndicatorSeriesData();
            console.warn(
              `No chart bars available for ${String(symbol || "").toUpperCase() || "symbol"} ${String(interval || "").trim() || "timeframe"} from historicalData, snapshot, or cache.`,
            );
            setLoading(false);
            return;
          }

          const nextBarsSignature = buildBarsSignature(candles);
          const barsChanged =
            nextBarsSignature !== lastRenderedBarsSignatureRef.current;
          lastRenderedBarsSignatureRef.current = nextBarsSignature;
          const candleBarBounds = computePriceBoundsFromBars(candles);
          const canRenderTradeOverlay =
            candleBarBounds &&
            [entryPrice, slPrice, tpPrice, tp1Price, exitPrice]
              .filter((price) => Number.isFinite(Number(price)))
              .every((price) =>
                isPriceCompatibleWithBarBounds(Number(price), candleBarBounds),
              );

          const precisionCandidates = [];
          for (const bar of candles) {
            precisionCandidates.push(bar?.open, bar?.high, bar?.low, bar?.close);
          }
          precisionCandidates.push(
            entryPrice,
            slPrice,
            tpPrice,
            tp1Price,
            tp2Price,
            tp3Price,
          );
          const nextPrecision = resolveChartPricePrecision(
            symbol,
            precisionCandidates,
            snapshot,
            cachedEntry,
          );
          pricePrecisionRef.current = nextPrecision;
          candleSeries.applyOptions({
            priceFormat: {
              type: "price",
              precision: nextPrecision,
              minMove: 1 / 10 ** nextPrecision,
            },
          });
          chart.applyOptions({
            localization: {
              priceFormatter: (price) =>
                formatPriceWithPrecision(price, pricePrecisionRef.current),
              timeFormatter: (time) =>
                formatChartDateTime(Number(time) * 1000, displayTimezone),
            },
          });

          if (isMounted) {
            try {
              candleSeries.setData(
                buildRenderableCandleSeriesData(candles, symbol, interval),
              );
            } catch (e) {
              console.error("Chart setData failed:", e?.message || e);
              setLoading(false);
              return;
            }
            if (typeof onBarsLoaded === "function") {
              onBarsLoaded(interval, candles.length);
            }

            if (showIndicators) {
              const cachedIndicators = normalizeIndicatorPayload(
                chartFetchManager.get(symbol, interval)?.indicators,
              );
              const replayIndicators =
                isReplayActive && cachedIndicators
                  ? sliceIndicatorPayloadToBars(cachedIndicators, candles)
                  : null;
              const computedIndicators = replayIndicators
                ? null
                : buildIndicatorSeries(candles);
              const builtIndicators = replayIndicators
                ? replayIndicators
                : cachedIndicators
                  ? { ...computedIndicators, ...cachedIndicators }
                  : computedIndicators;
              clearIndicatorSeriesData();
              Object.entries(builtIndicators).forEach(([key, data]) => {
                const targetSeries = indicatorSeriesRefs.current?.[key];
                if (!targetSeries || !Array.isArray(data) || !data.length) return;
                try {
                  targetSeries.setData(
                    buildRenderableIndicatorSeriesData(data, symbol, interval),
                  );
                  targetSeries.applyOptions({
                    visible: Boolean(effectiveIndicatorVisibility[key]),
                  });
                } catch {}
              });
              indicatorDataRef.current = builtIndicators;
              if (showRsiPanel) {
                setIndicatorValues({
                  rsi: getLastSeriesValue(builtIndicators.rsi),
                  rsiEma9: getLastSeriesValue(builtIndicators.rsiEma9),
                  rsiWma45: getLastSeriesValue(builtIndicators.rsiWma45),
                  stochK: getLastSeriesValue(builtIndicators.stochK),
                  stochD: getLastSeriesValue(builtIndicators.stochD),
                });
              } else {
                setIndicatorValues({});
              }
            } else {
              clearIndicatorSeriesData();
            }

            clearDayDividerArtifacts();
            clearSessionOverlayArtifacts();
            const dayDividerEntries = buildIntradayDayDividerEntries(
              candles,
              interval,
              displayTimezone,
            );
            if (dayDividerEntries.length) {
              const dayDividerPrimitive = new IntradayDayDividerPrimitive(dayDividerEntries);
              candleSeries.attachPrimitive(dayDividerPrimitive);
              dayDividerPrimitivesRef.current.push(dayDividerPrimitive);
            }
            const sessionOverlayEntries = buildSessionOverlayEntries(
              candles,
              interval,
              displayTimezone,
            );
            if (sessionOverlayEntries.length) {
              const sessionOverlayPrimitive = new SessionOverlayPrimitive(
                sessionOverlayEntries,
                {
                  intervalSec: intervalToSeconds(interval),
                  lastBarTimeSec: Number(candles[candles.length - 1]?.time),
                  prevBarTimeSec: Number(candles[candles.length - 2]?.time),
                },
              );
              candleSeries.attachPrimitive(sessionOverlayPrimitive);
              sessionOverlayPrimitivesRef.current.push(sessionOverlayPrimitive);
            }

            // --- ENTRY / TP / SL for all plans ---
            updatePlanOverlays(snapshot);

            // --- MARKERS: creation/open/close markers ---
            const createdTs = resolveEventMarkerTimeSec(
              candles,
              normalizedCreatedAtEpochSec,
              interval,
            );
            const openedTs = hasExplicitOpenedEvent
              ? resolveEventMarkerTimeSec(
                  candles,
                  effectiveOpenedAtEpochSec,
                  interval,
                )
              : null;
            const replayNowSec = Number(replayClockTimeSec);
            const canShowCreatedEvent =
              !isReplayActive ||
              !Number.isFinite(replayNowSec) ||
              replayNowSec >= Number(normalizedCreatedAtEpochSec);
            const canShowOpenedEvent =
              !isReplayActive ||
              !Number.isFinite(replayNowSec) ||
              replayNowSec >= Number(effectiveOpenedAtEpochSec);
            const canShowClosedEvent =
              !isReplayActive ||
              !Number.isFinite(replayNowSec) ||
              replayNowSec >= Number(effectiveClosedAtEpochSec);
            const showStandaloneCreatedMarker =
              Number.isFinite(createdTs) &&
              (!Number.isFinite(openedTs) || Math.abs(openedTs - createdTs) > 60);
            if (showStandaloneCreatedMarker && canShowCreatedEvent) {
              if (Number.isFinite(createdTs)) {
                const createdMarkerStyle = resolveTradeMarkerPresentation({
                  side: effectiveSide,
                  kind: "created",
                });
                const createdMarkerPrice = resolveEventMarkerAnchorPrice(
                  candles,
                  normalizedCreatedAtEpochSec,
                  createdMarkerStyle.chartPosition,
                  effectiveEntryPrice,
                );
                const createdMarkerPrimitive = new EventTimeMarkerPrimitive({
                  timeSec: Number(createdTs),
                  price: Number(createdMarkerPrice),
                  color: TRADE_MARKER_YELLOW,
                  text: buildTradeCreatedLabel(
                    effectiveTradeLabel,
                    effectiveSide,
                  ),
                  placement: createdMarkerStyle.chartPosition,
                });
                candleSeries.attachPrimitive(createdMarkerPrimitive);
                tradeOverlayPrimitivesRef.current.push(createdMarkerPrimitive);
              }
            }
            if (Number.isFinite(openedTs)) {
              const openLineColor =
                String(effectiveSide || "").toUpperCase() === "SELL"
                  ? PLAN_COLORS.sell.entry
                  : PLAN_COLORS.buy.entry;
              if (Number.isFinite(Number(effectiveEntryPrice))) {
                const openedPriceLine = candleSeries.createPriceLine({
                  price: Number(effectiveEntryPrice),
                  color: openLineColor,
                  lineWidth: 1,
                  lineStyle: LineStyle.Solid,
                  axisLabelVisible: true,
                  title: "",
                  axisLabelColor: openLineColor,
                  axisLabelTextColor: "#ffffff",
                });
                tradeOverlayPriceLinesRef.current.push(openedPriceLine);
              }
              if (
                canShowOpenedEvent &&
                (!showStandaloneCreatedMarker || Math.abs(openedTs - createdTs) > 60)
              ) {
                const openedMarkerStyle = resolveTradeMarkerPresentation({
                  side: effectiveSide,
                  kind: "opened",
                });
                const openedMarkerPrice =
                  Number.isFinite(Number(effectiveEntryPrice))
                    ? Number(effectiveEntryPrice)
                    : resolveEventMarkerAnchorPrice(
                        candles,
                        effectiveOpenedAtEpochSec,
                        openedMarkerStyle.chartPosition,
                        effectiveEntryPrice,
                      );
                const openedMarkerPrimitive = new EventTimeMarkerPrimitive({
                  timeSec: Number(openedTs),
                  price: Number(openedMarkerPrice),
                  color: TRADE_MARKER_YELLOW,
                  text: buildTradeOpenedLabel(),
                  placement: openedMarkerStyle.chartPosition,
                });
                candleSeries.attachPrimitive(openedMarkerPrimitive);
                tradeOverlayPrimitivesRef.current.push(openedMarkerPrimitive);
              }
            }
            if (Number.isFinite(effectiveClosedAtEpochSec)) {
              const closeTs = resolveEventMarkerTimeSec(
                candles,
                effectiveClosedAtEpochSec,
                interval,
              );
              const closeBadge = resolveTradeBadgeMeta({
                side: effectiveSide,
                closeStatus: effectiveCloseStatus,
                pnlRealized: effectivePnlRealized,
                kind: "close",
              });
              const closeLineColor =
                String(effectiveCloseStatus || "").toUpperCase() === "TP" ||
                (Number.isFinite(Number(effectivePnlRealized)) &&
                  Number(effectivePnlRealized) > 0)
                  ? TRADE_TP_DARK
                  : TRADE_SL_DARK;
              const resolvedCloseLinePrice = resolveTradeCloseDisplayPrice({
                closeStatus: effectiveCloseStatus,
                pnlRealized: effectivePnlRealized,
                exitPrice: effectiveExitPrice,
                exitPriceRaw: overlayTrade?.exitPriceRaw,
                tpPrice: tpPrice ?? tp1Price,
                slPrice,
              });
              const closeLine = resolveClosedTradeLineStyle(
                {
                  closeStatus: effectiveCloseStatus,
                  pnlRealized: effectivePnlRealized,
                  exitPrice: effectiveExitPrice,
                  exitPriceRaw: overlayTrade?.exitPriceRaw,
                  tpPrice: tpPrice ?? tp1Price,
                  slPrice,
                },
                computePriceBoundsFromBars(candles),
              );
              const resolvedCloseBadgePrice =
                closeLine?.value ??
                resolvedCloseLinePrice ??
                (Number.isFinite(Number(effectiveExitPrice))
                  ? Number(effectiveExitPrice)
                  : null);
              const closeAxisLabel = resolveTradeLevelRLabel({
                kind: "close",
                entryPrice: effectiveEntryPrice,
                levelPrice: closeLine?.value ?? resolvedCloseLinePrice,
                tpPrice: tp1Price ?? tpPrice,
                slPrice,
                side: effectiveSide,
                rMultiple: overlayTrade?.rMultiple,
                pnlRealized: effectivePnlRealized,
                closeStatus: effectiveCloseStatus,
                exitPrice: resolvedCloseBadgePrice,
              });
              if (Number.isFinite(closeTs) && canShowClosedEvent) {
                const closeMarkerStyle = resolveTradeMarkerPresentation({
                  side: effectiveSide,
                  closeStatus: effectiveCloseStatus,
                  pnlRealized: effectivePnlRealized,
                  kind: "close",
                });
                const closeMarkerPrice =
                  Number.isFinite(Number(resolvedCloseBadgePrice))
                    ? Number(resolvedCloseBadgePrice)
                    : resolveEventMarkerAnchorPrice(
                        candles,
                        effectiveClosedAtEpochSec,
                        closeMarkerStyle.chartPosition,
                        resolvedCloseBadgePrice,
                      );
                const closeMarkerPrimitive = new EventTimeMarkerPrimitive({
                  timeSec: Number(closeTs),
                  price: Number(closeMarkerPrice),
                  color: closeBadge.color,
                  text: buildTradeCloseLabel(
                    effectivePnlRealized,
                    effectiveCloseStatus,
                    resolvedCloseLinePrice,
                    {
                      rMultiple: overlayTrade?.rMultiple,
                      entryPrice: effectiveEntryPrice,
                      exitPrice: resolvedCloseBadgePrice,
                      tpPrice: tp1Price ?? tpPrice,
                      slPrice,
                      side: effectiveSide,
                    },
                  ),
                  placement: closeMarkerStyle.chartPosition,
                });
                candleSeries.attachPrimitive(closeMarkerPrimitive);
                tradeOverlayPrimitivesRef.current.push(closeMarkerPrimitive);
              }
              if (Number.isFinite(closeLine?.value)) {
                const closePriceLine = candleSeries.createPriceLine({
                  price: closeLine.value,
                  color: closeLine.color || closeLineColor,
                  lineWidth: 1,
                  lineStyle: LineStyle.Solid,
                  axisLabelVisible: true,
                  title: closeAxisLabel || closeBadge.label || "Closed",
                  axisLabelColor: closeLine.color || closeLineColor,
                  axisLabelTextColor: "#ffffff",
                });
                tradeOverlayPriceLinesRef.current.push(closePriceLine);
              }
              if (
                canRenderTradeOverlay &&
                Number.isFinite(Number(effectiveEntryPrice)) &&
                Number.isFinite(resolvedCloseBadgePrice) &&
                Number.isFinite(openedTs) &&
                Number.isFinite(closeTs)
              ) {
                const timeRangeBoxPrimitive = new TimeRangeBoxPrimitive({
                    startTimeSec: openedTs,
                    endTimeSec: closeTs,
                    priceLow: Math.min(
                      Number(effectiveEntryPrice),
                      resolvedCloseBadgePrice,
                    ),
                    priceHigh: Math.max(
                      Number(effectiveEntryPrice),
                      resolvedCloseBadgePrice,
                    ),
                    lineColor: closeBadge.color,
                    fillColor:
                      closeBadge.color === BACKTEST_CHART_THEME.profit
                        ? BACKTEST_CHART_THEME.tradeBoxProfit
                        : BACKTEST_CHART_THEME.tradeBoxLoss,
                  });
                candleSeries.attachPrimitive(timeRangeBoxPrimitive);
                tradeOverlayPrimitivesRef.current.push(timeRangeBoxPrimitive);
              }
            }

            renderSharedOverlayArtifactsRef.current({
              sharedLinesList: sharedLines,
              sharedObjectsList: sharedObjects,
              bars: candles,
            });

            applyTimelineTradeMarkers(candles);

            removeDragListeners = () => {
              dragState.activeKey = null;
            };

            const onContextMenu = (evt) => {
              if (typeof onContextRequest !== "function") return;
              const rect = chartElement.getBoundingClientRect();
              const x = evt.clientX - rect.left;
              const y = evt.clientY - rect.top;
              const xRatio = Math.max(
                0,
                Math.min(1, x / Math.max(rect.width, 1)),
              );
              const yRatio = Math.max(
                0,
                Math.min(1, y / Math.max(rect.height, 1)),
              );
              const primaryPaneHeight = Number(
                chart.panes?.()?.[0]?.getHeight?.() || rect.height,
              );
              const clickedInsidePricePane =
                Number.isFinite(primaryPaneHeight) &&
                primaryPaneHeight > 0 &&
                y >= 0 &&
                y <= primaryPaneHeight;
              const clampedPaneY = Math.max(
                0,
                Math.min(y, Math.max(primaryPaneHeight - 1, 0)),
              );
              const bars = Array.isArray(currentBarsRef.current)
                ? currentBarsRef.current
                : [];
              const fallbackPrice = Number(bars[bars.length - 1]?.close);
              const rawPrice = clickedInsidePricePane
                ? candleSeries.coordinateToPrice(clampedPaneY)
                : null;
              const candleBarBounds = computePriceBoundsFromBars(bars);
              const crosshairFallbackPrice = Number(
                lastCrosshairContextRef.current?.price,
              );
              const price = Number(
                Number.isFinite(Number(rawPrice)) &&
                  (!candleBarBounds ||
                    isPriceCompatibleWithBarBounds(Number(rawPrice), candleBarBounds))
                  ? rawPrice
                  : Number.isFinite(crosshairFallbackPrice) &&
                      (!candleBarBounds ||
                        isPriceCompatibleWithBarBounds(
                          crosshairFallbackPrice,
                          candleBarBounds,
                        ))
                    ? crosshairFallbackPrice
                    : Number.isFinite(fallbackPrice)
                      ? fallbackPrice
                      : candleSeries.coordinateToPrice(clampedPaneY),
              );
              const rawTime = chart.timeScale().coordinateToTime(x);
              const logicalIndex =
                typeof chart.timeScale().coordinateToLogical === "function"
                  ? Number(chart.timeScale().coordinateToLogical(x))
                  : null;
              const nearestBarTime =
                Number.isFinite(logicalIndex) && bars.length
                  ? Number(
                      bars[
                        Math.max(
                          0,
                          Math.min(bars.length - 1, Math.round(logicalIndex)),
                        )
                      ]?.time,
                    ) || null
                  : null;
              const crosshairFallbackTime = Number(
                lastCrosshairContextRef.current?.time,
              );
              const time =
                rawTime ||
                (Number.isFinite(nearestBarTime) ? nearestBarTime : null) ||
                (Number.isFinite(crosshairFallbackTime)
                  ? crosshairFallbackTime
                  : null);
              if (!Number.isFinite(Number(price))) return;
              evt.preventDefault();
              onContextRequest({
                chartId,
                symbol,
                interval,
                price: Number(price),
                currentPrice: Number.isFinite(fallbackPrice)
                  ? fallbackPrice
                  : Number.isFinite(crosshairFallbackPrice)
                    ? crosshairFallbackPrice
                    : Number(price),
                time: time || null,
                xRatio,
                yRatio,
                clientX: evt.clientX,
                clientY: evt.clientY,
              });
            };
            chartElement.addEventListener("contextmenu", onContextMenu);
            removeContextMenuListener = () => {
              chartElement.removeEventListener("contextmenu", onContextMenu);
            };
            try {
              chart.timeScale().subscribeVisibleTimeRangeChange(() => {
                emitViewport();
              });
            } catch {}

            // Prefer the user's current viewport during plan/overlay updates.
            const viewportToRestore = preferTradeAnchoredViewport
              ? null
              : runtimeViewportRef.current || initialViewport;
            const shouldForceAutoFitFromNonce =
              Number.isFinite(Number(autoFitNonce)) &&
              Number(autoFitNonce) > 0 &&
              Number(autoFitNonce) !== Number(lastHandledAutoFitNonceRef.current);
            const shouldAutoFitOnLoad =
              shouldForceAutoFitFromNonce ||
              !viewportToRestore;
            const restoredViewport = applyStoredViewport(
              chart,
              candleSeries,
              viewportToRestore,
            );
            if (!restoredViewport || shouldAutoFitOnLoad) {
              const anchoredLastBarTimeSec =
                Number.isFinite(Number(tradeViewportAnchors.lastAnchorTimeSec)) &&
                Number(tradeViewportAnchors.lastAnchorTimeSec) > 0
                  ? Number(tradeViewportAnchors.lastAnchorTimeSec)
                  : Number(candles[candles.length - 1]?.time) || null;
              const usedTradeViewport =
                explicitVisibleBarsTarget > 0
                  ? applyLatestBarsViewport(
                      chart,
                      candles,
                      explicitVisibleBarsTarget,
                      { anchorRatio: isReplayActive ? 0.5 : 0.8 },
                    )
                  : preferTradeAnchoredViewport
                    ? autoFitWindow(
                        chart,
                        candleSeries,
                        candles,
                        visibleBarsCount,
                        {
                          ...tradeViewportAnchors,
                          lastAnchorTimeSec: anchoredLastBarTimeSec,
                        },
                        {
                          rightRatio: 1 / 12,
                          requiredPrices: [
                            effectiveEntryPrice,
                            slPrice,
                            tp1Price ?? tpPrice,
                          ],
                        },
                      )
                    : false;
              if (!usedTradeViewport) {
                applyCompactBarsViewport(
                  chart,
                  candleSeries,
                  candles,
                  interval,
                  compactViewportBarsRef.current,
                  tradeViewportAnchors,
                  {
                    tpPrice: tp1Price ?? tpPrice,
                    slPrice,
                  },
                );
              }
              requestAnimationFrame(() => {
                const reappliedTradeViewport =
                  explicitVisibleBarsTarget > 0
                    ? applyLatestBarsViewport(
                        chart,
                        candles,
                        explicitVisibleBarsTarget,
                        { anchorRatio: isReplayActive ? 0.5 : 0.8 },
                      )
                    : preferTradeAnchoredViewport
                      ? autoFitWindow(
                          chart,
                          candleSeries,
                          candles,
                          visibleBarsCount,
                          {
                            ...tradeViewportAnchors,
                            lastAnchorTimeSec: anchoredLastBarTimeSec,
                          },
                          {
                            rightRatio: 1 / 12,
                            requiredPrices: [
                              effectiveEntryPrice,
                              slPrice,
                              tp1Price ?? tpPrice,
                            ],
                          },
                        )
                      : false;
                if (!reappliedTradeViewport) {
                  applyCompactBarsViewport(
                    chart,
                    candleSeries,
                    candles,
                    interval,
                    compactViewportBarsRef.current,
                    tradeViewportAnchors,
                    {
                      tpPrice: tp1Price ?? tpPrice,
                      slPrice,
                    },
                  );
                }
                emitViewport();
              });
            } else {
              requestAnimationFrame(() => {
                emitViewport();
              });
            }
            if (shouldForceAutoFitFromNonce) {
              lastHandledAutoFitNonceRef.current = Number(autoFitNonce);
            }
            lastAutoFitSignatureRef.current = [
              chartId,
              interval,
              candles.length,
              Number(candles[0]?.time) || 0,
              Number(candles[candles.length - 1]?.time) || 0,
              Number(tradeViewportAnchors.firstAnchorTimeSec) || 0,
              Number(tradeViewportAnchors.lastAnchorTimeSec) || 0,
              autoFitNonce,
            ].join("|");
          }
        } catch (err) {
          console.error("Chart data fetch failed:", err);
        } finally {
          if (isMounted) setLoading(false);
        }
      }

      initData();

      return () => {
        isMounted = false;
        try {
          emitViewport();
        } catch {}
        window.removeEventListener("resize", onWindowResize);
        if (resizeObserver) resizeObserver.disconnect();
        if (viewportEmitTimer) {
          window.clearTimeout(viewportEmitTimer);
          viewportEmitTimer = null;
        }
        try {
          chart.unsubscribeCrosshairMove(handleCrosshairMove);
        } catch {}
        try {
          chart.timeScale().unsubscribeVisibleLogicalRangeChange(
            handleVisibleRangeChange,
          );
        } catch {}
        try {
          chartElement.removeEventListener("wheel", scheduleEmitViewport);
          chartElement.removeEventListener("mouseup", scheduleEmitViewport);
          chartElement.removeEventListener("touchend", scheduleEmitViewport);
        } catch {}
        removeDragListeners();
        removeContextMenuListener();
        try {
          tooltipEl.remove();
        } catch {}
        clearPlanPriceLines();
        clearTradeOverlayArtifacts();
        clearDayDividerArtifacts();
        clearSessionOverlayArtifacts();
        clearSharedOverlayArtifacts();
        clearCandleHoverPriceLine();
        clearIndicatorHoverPriceLines();
        hoverPriceLinesRef.current.lines = [];
        hoverMarkersRef.current = [];
        chartRef.current = null;
        seriesRef.current = null;
        indicatorSeriesRefs.current = {};
        indicatorDataRef.current = {};
        lastSharedOverlayRenderSignatureRef.current = "";
        try {
          chart.remove();
        } catch {}
      };
    } catch (err) {
      console.error("TradeSignalChart init failed:", err);
      if (chart)
        try {
          chart.remove();
        } catch {}
    } finally {
      if (isMounted) setLoading(false);
    }
  }, [
    symbol,
    interval,
    live,
    chartId,
    lwTimeToMs,
    displayTimezone,
    getUiThemeColors().mode,
    showIndicators,
    showRsiPanel,
    showPrimaryPlan,
    showExtraPlans,
    analysisSnapshotSignature,
    side,
    action,
    entryPrice,
    slPrice,
    tpPrice,
    tp1Price,
    tp2Price,
    tp3Price,
    createdAt,
    openedAt,
    closedAt,
    closeStatus,
    exitPrice,
    pnlRealized,
    tradeLabel,
    tradeViewportAnchors,
    preferTradeAnchoredViewport,
    clearTradeOverlayArtifacts,
    clearDayDividerArtifacts,
    clearSessionOverlayArtifacts,
    clearSharedOverlayArtifacts,
    clearCandleHoverPriceLine,
    clearIndicatorHoverPriceLines,
    clearIndicatorSeriesData,
    setCandleHoverGuide,
    setIndicatorHoverGuides,
    isReplayActive,
  ]);

  useEffect(() => {
    const candles = currentBarsRef.current;
    if (!seriesRef.current || !Array.isArray(candles) || !candles.length) {
      return;
    }

    clearTradeOverlayArtifacts();
    const candleBarBounds = computePriceBoundsFromBars(candles);
    const canRenderTradeOverlay =
      candleBarBounds &&
      [entryPrice, slPrice, tpPrice, tp1Price, exitPrice]
        .filter((price) => Number.isFinite(Number(price)))
        .every((price) =>
          isPriceCompatibleWithBarBounds(Number(price), candleBarBounds),
        );
    renderTradeOverlays(candles, [], {
      canRenderTradeOverlay: canRenderTradeOverlay === true,
    });
    applyTimelineTradeMarkers(candles);
  }, [
    applyTimelineTradeMarkers,
    clearTradeOverlayArtifacts,
    historicalDataSignature,
    side,
    action,
    entryPrice,
    slPrice,
    tpPrice,
    tp1Price,
    exitPrice,
    createdAt,
    openedAt,
    closedAt,
    closeStatus,
    pnlRealized,
    tradeLabel,
    selectedTradeSid,
    renderTradeOverlays,
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = seriesRef.current;
    if (!chart || !candleSeries) return;

    const candles = chooseSafeChartBars(
      filterRenderableBarsForSymbol(historicalData, symbol, interval),
      currentBarsRef.current,
      interval,
    );
    if (!candles.length) return;

    const nextBarsSignature = buildBarsSignature(candles);
    if (nextBarsSignature === lastRenderedBarsSignatureRef.current) {
      return;
    }

    const previousBars = Array.isArray(currentBarsRef.current)
      ? currentBarsRef.current
      : [];
    const preserveViewport = preserveViewportOnBarsChangeRef.current;
    const runtimeViewport = runtimeViewportRef.current;
    let logicalRange = null;
    try {
      logicalRange = chart.timeScale().getVisibleLogicalRange();
    } catch {
      logicalRange = null;
    }

    const precisionCandidates = [];
    for (const bar of candles) {
      precisionCandidates.push(bar?.open, bar?.high, bar?.low, bar?.close);
    }
    precisionCandidates.push(entryPrice, slPrice, tpPrice, tp1Price, exitPrice);
    const nextPrecision = resolveChartPricePrecision(
      symbol,
      precisionCandidates,
      null,
      null,
    );
    pricePrecisionRef.current = nextPrecision;
    candleSeries.applyOptions({
      priceFormat: {
        type: "price",
        precision: nextPrecision,
        minMove: 1 / 10 ** nextPrecision,
      },
    });
    chart.applyOptions({
      localization: {
        priceFormatter: (price) =>
          formatPriceWithPrecision(price, pricePrecisionRef.current),
        timeFormatter: (time) =>
          formatChartDateTime(Number(time) * 1000, displayTimezone),
      },
    });

    const isSamePrefix =
      previousBars.length > 0 &&
      candles.length >= previousBars.length &&
      previousBars.every(
        (bar, idx) =>
          Number(bar?.time) === Number(candles[idx]?.time),
      );
    const canPatchLatest =
      isSamePrefix && candles.length <= previousBars.length + 1;
    const renderCandles = buildRenderableCandleSeriesData(candles, symbol, interval);

    try {
      if (canPatchLatest) {
        candleSeries.update(renderCandles[renderCandles.length - 1]);
      } else {
        candleSeries.setData(renderCandles);
      }
    } catch (err) {
      console.error("Chart incremental data update failed:", err?.message || err);
      try {
        candleSeries.setData(renderCandles);
      } catch {}
    }

    currentBarsRef.current = candles;
    lastRenderedBarsSignatureRef.current = nextBarsSignature;

    if (typeof onBarsLoaded === "function") {
      onBarsLoaded(interval, candles.length);
    }

    if (showIndicators) {
      const cachedIndicators = normalizeIndicatorPayload(
        chartFetchManager.get(symbol, interval)?.indicators,
      );
      const replayIndicators =
        isReplayActive && cachedIndicators
          ? sliceIndicatorPayloadToBars(cachedIndicators, candles)
          : null;
      const computedIndicators = replayIndicators
        ? null
        : buildIndicatorSeries(candles);
      const builtIndicators = replayIndicators
        ? replayIndicators
        : cachedIndicators
          ? { ...computedIndicators, ...cachedIndicators }
          : computedIndicators;
      clearIndicatorSeriesData();
      Object.entries(builtIndicators).forEach(([key, data]) => {
        const targetSeries = indicatorSeriesRefs.current?.[key];
        if (!targetSeries || !Array.isArray(data) || !data.length) return;
        try {
          targetSeries.setData(
            buildRenderableIndicatorSeriesData(data, symbol, interval),
          );
          targetSeries.applyOptions({
            visible: Boolean(effectiveIndicatorVisibility[key]),
          });
        } catch {}
      });
      indicatorDataRef.current = builtIndicators;
      if (showRsiPanel) {
        setIndicatorValues({
          rsi: getLastSeriesValue(builtIndicators.rsi),
          rsiEma9: getLastSeriesValue(builtIndicators.rsiEma9),
          rsiWma45: getLastSeriesValue(builtIndicators.rsiWma45),
          stochK: getLastSeriesValue(builtIndicators.stochK),
          stochD: getLastSeriesValue(builtIndicators.stochD),
        });
      } else {
        setIndicatorValues({});
      }
    } else {
      clearIndicatorSeriesData();
    }

    clearDayDividerArtifacts();
    clearSessionOverlayArtifacts();
    const dayDividerEntries = buildIntradayDayDividerEntries(
      candles,
      interval,
      displayTimezone,
    );
    if (dayDividerEntries.length) {
      const dayDividerPrimitive = new IntradayDayDividerPrimitive(dayDividerEntries);
      candleSeries.attachPrimitive(dayDividerPrimitive);
      dayDividerPrimitivesRef.current.push(dayDividerPrimitive);
    }
    const sessionOverlayEntries = buildSessionOverlayEntries(
      candles,
      interval,
      displayTimezone,
    );
    if (sessionOverlayEntries.length) {
      const sessionOverlayPrimitive = new SessionOverlayPrimitive(
        sessionOverlayEntries,
        {
          intervalSec: intervalToSeconds(interval),
          lastBarTimeSec: Number(candles[candles.length - 1]?.time),
          prevBarTimeSec: Number(candles[candles.length - 2]?.time),
        },
      );
      candleSeries.attachPrimitive(sessionOverlayPrimitive);
      sessionOverlayPrimitivesRef.current.push(sessionOverlayPrimitive);
    }

    renderSharedOverlayArtifacts({
      sharedLinesList: sharedLines,
      sharedObjectsList: sharedObjects,
      bars: candles,
      renderSignature: `${nextBarsSignature}|${sharedLinesSignature}|${sharedObjectsSignature}`,
    });

    if (!preserveViewport && isReplayActive) {
      const replayVisibleBarsTarget =
        explicitVisibleBarsTarget > 0
          ? explicitVisibleBarsTarget
          : visibleBarsCount;
      const restoreReplayViewport = () => {
        applyLatestBarsViewport(
          chart,
          candles,
          replayVisibleBarsTarget,
          { anchorRatio: 0.5 },
        );
      };
      restoreReplayViewport();
      requestAnimationFrame(restoreReplayViewport);
      return;
    }

    if (preserveViewport) {
      const restoreViewport = () => {
        if (
          logicalRange &&
          Number.isFinite(Number(logicalRange.from)) &&
          Number.isFinite(Number(logicalRange.to))
        ) {
          try {
            chart.timeScale().setVisibleLogicalRange(logicalRange);
          } catch {}
        }
        if (runtimeViewport) {
          applyStoredViewport(chart, candleSeries, runtimeViewport);
        }
        if (isReplayActive) {
          ensureLatestReplayBarVisible(
            chart,
            candles,
            explicitVisibleBarsTarget > 0
              ? explicitVisibleBarsTarget
              : visibleBarsCount,
            { anchorRatio: 0.5 },
          );
        }
      };
      restoreViewport();
      requestAnimationFrame(restoreViewport);
    }
  }, [
    applyPlanLevelDragPreview,
    clearDayDividerArtifacts,
    clearSessionOverlayArtifacts,
    clearIndicatorSeriesData,
    historicalData,
    historicalDataSignature,
    symbol,
    interval,
    displayTimezone,
    entryPrice,
    slPrice,
    tpPrice,
    tp1Price,
    exitPrice,
    explicitVisibleBarsTarget,
    showIndicators,
    showRsiPanel,
    effectiveIndicatorVisibility,
    isReplayActive,
    onBarsLoaded,
    renderSharedOverlayArtifacts,
    sharedLines,
    sharedObjects,
    visibleBarsCount,
  ]);

  useEffect(() => {
    renderSharedOverlayArtifacts({
      sharedLinesList: sharedLines,
      sharedObjectsList: sharedObjects,
      bars: currentBarsRef.current,
      renderSignature: `${buildBarsSignature(currentBarsRef.current || [])}|${sharedLinesSignature}|${sharedObjectsSignature}`,
    });
  }, [
    renderSharedOverlayArtifacts,
    sharedLines,
    sharedLinesSignature,
    sharedObjects,
    sharedObjectsSignature,
  ]);

  useEffect(() => {
    if (!chartRef.current || !currentBarsRef.current?.length) return;
    if (isReplayActive) return;
    const nextSignature = [
      chartId,
      interval,
      currentBarsRef.current.length,
      Number(currentBarsRef.current[0]?.time) || 0,
      Number(currentBarsRef.current[currentBarsRef.current.length - 1]?.time) || 0,
      Number(tradeViewportAnchors.firstAnchorTimeSec) || 0,
      Number(tradeViewportAnchors.lastAnchorTimeSec) || 0,
      autoFitNonce,
    ].join("|");
    if (lastAutoFitSignatureRef.current === nextSignature) return;
    const lastAnchorTimeSec =
      Number.isFinite(Number(tradeViewportAnchors.lastAnchorTimeSec)) &&
      Number(tradeViewportAnchors.lastAnchorTimeSec) > 0
        ? Number(tradeViewportAnchors.lastAnchorTimeSec)
        : Number(
            currentBarsRef.current[currentBarsRef.current.length - 1]?.time,
          ) || null;
    const targetAnchors = {
      ...tradeViewportAnchors,
      lastAnchorTimeSec,
    };
    const appliedTradeViewport =
      preferTradeAnchoredViewport &&
      autoFitWindow(
        chartRef.current,
        seriesRef.current,
        currentBarsRef.current,
        visibleBarsCount,
        targetAnchors,
        {
          rightRatio: 1 / 12,
          requiredPrices: [
            effectiveEntryPrice,
            slPrice,
            tp1Price ?? tpPrice,
          ],
        },
      );
    if (!appliedTradeViewport) {
      applyLatestBarsViewport(
        chartRef.current,
        currentBarsRef.current,
        visibleBarsCount,
        { anchorRatio: isReplayActive ? 0.5 : 0.8 },
      );
    }
    lastAutoFitSignatureRef.current = nextSignature;
  }, [
    chartId,
    interval,
    tradeViewportAnchors,
    visibleBarsCount,
    animateTradeViewport,
    preferTradeAnchoredViewport,
    autoFitNonce,
    isReplayActive,
  ]);

  useEffect(() => {
    if (!chartRef.current || !seriesRef.current || !currentBarsRef.current?.length) return;
    if (!viewportCommand || typeof viewportCommand !== "object") return;
    const action = String(viewportCommand.action || "").trim();
    if (!action) return;
    const bars = currentBarsRef.current;
    if (action === "jump_first") {
      applyFirstBarsViewport(chartRef.current, bars, visibleBarsCount);
      return;
    }
    if (action === "pan_left") {
      panVisibleLogicalRange(chartRef.current, bars, -150);
      return;
    }
    if (action === "show_all_loaded") {
      runtimeViewportRef.current = null;
      applyShowAllLoadedViewport(
        chartRef.current,
        seriesRef.current,
        bars,
      );
      return;
    }
    if (action === "fit_trade") {
      compactViewportBarsRef.current = 300;
      applyPresetTradeViewport(
        chartRef.current,
        seriesRef.current,
        bars,
        interval,
        300,
        tradeViewportAnchors,
        {
          tpPrice: tp1Price ?? tpPrice,
          slPrice,
        },
      );
      return;
    }
    if (action === "show_compact_less") {
      compactViewportBarsRef.current = Math.max(
        COMPACT_VIEWPORT_MIN_BARS,
        Number(compactViewportBarsRef.current || COMPACT_VIEWPORT_DEFAULT_BARS) -
          COMPACT_VIEWPORT_STEP_BARS,
      );
      applyCompactBarsViewport(
        chartRef.current,
        seriesRef.current,
        bars,
        interval,
        compactViewportBarsRef.current,
        tradeViewportAnchors,
        {
          tpPrice: tp1Price ?? tpPrice,
          slPrice,
        },
      );
      return;
    }
    if (action === "show_compact") {
      compactViewportBarsRef.current = COMPACT_VIEWPORT_DEFAULT_BARS;
      applyCompactBarsViewport(
        chartRef.current,
        seriesRef.current,
        bars,
        interval,
        compactViewportBarsRef.current,
        tradeViewportAnchors,
        {
          tpPrice: tp1Price ?? tpPrice,
          slPrice,
        },
      );
      return;
    }
    if (action === "show_compact_more") {
      compactViewportBarsRef.current = Math.min(
        Math.max(bars.length, COMPACT_VIEWPORT_MIN_BARS),
        Number(compactViewportBarsRef.current || COMPACT_VIEWPORT_DEFAULT_BARS) +
          COMPACT_VIEWPORT_STEP_BARS,
      );
      applyCompactBarsViewport(
        chartRef.current,
        seriesRef.current,
        bars,
        interval,
        compactViewportBarsRef.current,
        tradeViewportAnchors,
        {
          tpPrice: tp1Price ?? tpPrice,
          slPrice,
        },
      );
      return;
    }
    if (action === "pan_right") {
      panVisibleLogicalRange(chartRef.current, bars, 150);
      return;
    }
    if (action === "jump_latest") {
      applyLatestBarsViewport(chartRef.current, bars, visibleBarsCount, {
        anchorRatio: isReplayActive ? 0.5 : 0.8,
      });
    }
  }, [
    viewportCommand,
    visibleBarsCount,
    explicitVisibleBarsTarget,
    tradeViewportAnchors,
    effectiveEntryPrice,
    slPrice,
    tp1Price,
    tpPrice,
    interval,
    isReplayActive,
  ]);

  useEffect(() => {
    if (!seriesRef.current) return;
    applyStoredPriceScale(seriesRef.current, initialViewport);
  }, [initialViewport]);

  useEffect(() => {
    Object.entries(effectiveIndicatorVisibility).forEach(([key, isVisible]) => {
      if (key === "rsiPanel" || key === "macdPanel" || key === "candles") return;
      const series = indicatorSeriesRefs.current?.[key];
      if (!series) return;
      try {
        series.applyOptions({ visible: Boolean(isVisible) });
      } catch {}
    });
  }, [effectiveIndicatorVisibility]);

  useEffect(() => {
    if (!seriesRef.current) return;
    try {
      seriesRef.current.applyOptions(
        getCandleSeriesOptions({
          candlesVisible: effectiveIndicatorVisibility.candles !== false,
          zigzagVisible: effectiveIndicatorVisibility.zigzag !== false,
        }),
      );
    } catch {}
  }, [
    effectiveIndicatorVisibility.candles,
    effectiveIndicatorVisibility.zigzag,
  ]);

  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;
    if (!syncedCrosshair || syncedCrosshair.sourceId === chartId) return;

    if (!syncedCrosshair.active || !syncedCrosshair.time) {
      suppressCrosshairSyncRef.current = true;
      try { chartRef.current.clearCrosshairPosition(); } catch {}
      clearCandleHoverPriceLine();
      clearIndicatorHoverPriceLines();
      return;
    }

    if (!Number.isFinite(Number(syncedCrosshair.price))) return;

    suppressCrosshairSyncRef.current = true;
    try {
      if (seriesRef.current) {
        chartRef.current.setCrosshairPosition(
          Number(syncedCrosshair.price),
          syncedCrosshair.time,
          seriesRef.current,
        );
      }
      setCandleHoverGuide(Number(syncedCrosshair.price));
      setIndicatorHoverGuides(syncedCrosshair.indicatorValues || {});
    } catch {
      // chart may be in a torn-down state during rapid re-renders
    }
  }, [
    chartId,
    clearCandleHoverPriceLine,
    clearIndicatorHoverPriceLines,
    setCandleHoverGuide,
    setIndicatorHoverGuides,
    syncedCrosshair,
  ]);

  return (
    <div
      className="chart-wrapper"
      style={{
        position: "relative",
        width: "100%",
        height: wrapperHeight,
        borderRadius: 0,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
      }}
    >
      {loading && !isReplayActive && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(13, 17, 23, 0.7)",
            zIndex: 10,
            borderRadius: "8px",
          }}
        >
          <div className="loading-small">Loading Chart Data...</div>
        </div>
      )}
      {showIndicators && showIndicatorPanel && showIndicatorButton && (
        <>
          <button
            type="button"
            onClick={() => {
              if (typeof onIndicatorPanelToggle === "function") {
                onIndicatorPanelToggle(!isPanelOpen);
                return;
              }
              setIsIndicatorPanelOpen((open) => !open);
            }}
            style={{
              position: "absolute",
              top: 10,
              right: 12,
              zIndex: 14,
              border: `1px solid ${isLightUi ? "rgba(148,163,184,0.32)" : "rgba(255,255,255,0.14)"}`,
              background: isLightUi ? "rgba(255,255,255,0.92)" : "rgba(15,23,42,0.92)",
              color: isLightUi ? "#0f172a" : "#e5e7eb",



              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Indicators{" "}
            {
              INDICATOR_GROUPS.flatMap((group) => group.items).filter(
                (item) => indicatorVisibility[item.key],
              ).length
            }
          </button>
          {isPanelOpen && (
            <div
              style={{
                position: "absolute",
                top: 46,
                right: 12,
                width: 220,
                zIndex: 15,
                borderRadius: 14,
                border: `1px solid ${isLightUi ? "rgba(148,163,184,0.24)" : "rgba(255,255,255,0.08)"}`,
                background: isLightUi ? "rgba(255,255,255,0.98)" : "rgba(9,15,28,0.96)",
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
                  color: isLightUi ? "#334155" : "#cbd5e1",
                }}
              >
                <span>INDICATORS</span>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof onIndicatorPanelToggle === "function") {
                      onIndicatorPanelToggle(false);
                      return;
                    }
                    setIsIndicatorPanelOpen(false);
                  }}
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
              {INDICATOR_GROUPS.map((group) => (
                <div key={group.label} style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.18em",
                      color: "#64748b",
                      marginBottom: 8,
                    }}
                  >
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    const isVisible = Boolean(indicatorVisibility[item.key]);
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() =>
                          setIndicatorVisibility((current) => ({
                            ...current,
                            [item.key]: !current[item.key],
                          }))
                        }
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          marginBottom: 6,

                          border: `1px solid ${isVisible ? item.color : "transparent"}`,
                          background: isVisible
                            ? isLightUi
                              ? "rgba(241,245,249,0.95)"
                              : "rgba(30,41,59,0.9)"
                            : "transparent",
                          color: isLightUi ? "#0f172a" : "#e5e7eb",

                        cursor: "pointer",

                        fontWeight: 600,
                        }}
                      >
                        <span>{item.label}</span>
                        <span
                          style={{
                            color: isVisible ? item.color : isLightUi ? "#94a3b8" : "#64748b",
                            fontSize: 11,
                            fontWeight: 800,
                          }}
                        >
                          {isVisible ? "ON" : "OFF"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 0,
          overflow: "hidden",
          background: isLightUi ? uiTheme.surface : "#0d1117",
          position: "relative",
        }}
      >
        <div
          ref={chartContainerRef}
          style={{
            width: "100%",
            height: "100%",
            background: isLightUi ? uiTheme.surface : "#0d1117",
          }}
        />
        {planDragHandles.length > 0 ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 16,
            }}
          >
            {planDragHandles.map((handle) => (
              <button
                key={handle.key}
                type="button"
                onMouseDown={(event) =>
                  handlePlanHandleMouseDown(handle.key, event)
                }
                title={`Drag ${handle.label}`}
                aria-label={`Drag ${handle.label}`}
                style={{
                  position: "absolute",
                  top: `${Math.round(handle.y)}px`,
                  right: 62,
                  transform: "translateY(-50%)",
                  pointerEvents: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  color: handle.color,
                  fontSize: 9,
                  fontWeight: 700,
                  lineHeight: 1,
                  cursor: "ns-resize",
                  boxShadow: "none",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 8,
                    color: handle.color,
                    fontSize: 9,
                    letterSpacing: "-0.08em",
                  }}
                >
                  ::
                </span>
                {handle.shortLabel ? <span>{handle.shortLabel}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        {showIndicators && showRsiPanel && visibleOscillatorIndicators.length > 0 && (
          <div
            style={{
              position: "absolute",
              left: 54,
              bottom: 20,
              zIndex: 14,
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              justifyContent: "flex-start",
              maxWidth: "calc(100% - 72px)",
              pointerEvents: "none",
            }}
          >
            {visibleOscillatorIndicators.map((item) => {
              const value = indicatorValues[item.key];
              return (
                <div
                  key={item.key}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "1px 6px",
                    borderRadius: 999,
                    background: isLightUi
                      ? "rgba(255,255,255,0.48)"
                      : "rgba(15,23,42,0.22)",
                    border: `1px dotted ${item.color}55`,
                    color: isLightUi
                      ? "rgba(15,23,42,0.48)"
                      : "rgba(226,232,240,0.45)",
                    fontSize: 9,
                    fontWeight: 400,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ color: `${item.color}99` }}>{item.label}</span>
                  <span style={{ opacity: 0.66 }}>
                    {Number(value).toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
