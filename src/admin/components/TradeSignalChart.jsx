import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as LightweightCharts from "lightweight-charts";
import {
  asNumValue,
  formatChartDateTime,
  getEffectiveDisplayTimezone,
} from "../utils/format";
import { chartFetchManager } from "../services/chartFetchManager";
import { normalizePlanLinePrice } from "../utils/tradePlanDrafts";
import { getUiThemeColors } from "../utils/uiTheme";
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
    sma20: "rgba(96, 165, 250, 0.6)",
    sma50: "rgba(249, 115, 22, 0.58)",
    sma200: "rgba(34, 197, 94, 0.56)",
    vwap: "rgba(14, 165, 233, 0.7)",
    bbMid: "rgba(148, 163, 184, 0.55)",
    bbUpper: "rgba(244, 114, 182, 0.5)",
    bbLower: "rgba(244, 114, 182, 0.5)",
    ichiTenkan: "rgba(239, 68, 68, 0.62)",
    ichiKijun: "rgba(37, 99, 235, 0.62)",
    ichiSpanA: "rgba(34, 197, 94, 0.45)",
    ichiSpanB: "rgba(245, 158, 11, 0.45)",
    ichiChikou: "rgba(168, 85, 247, 0.35)",
    zigzag: "rgba(250, 204, 21, 0.62)",
    rsi: "rgba(168, 85, 247, 0.62)",
    rsiEma9: "rgba(250, 204, 21, 0.56)",
    rsiWma45: "rgba(52, 211, 153, 0.56)",
    stochK: "rgba(59, 130, 246, 0.7)",
    stochD: "rgba(245, 158, 11, 0.7)",
    macd: "rgba(34, 197, 94, 0.7)",
    macdSignal: "rgba(239, 68, 68, 0.7)",
    macdHistogramUp: "rgba(34, 197, 94, 0.32)",
    macdHistogramDown: "rgba(239, 68, 68, 0.32)",
    levelMain: "rgba(168, 85, 247, 0.3)",
    levelMid: "rgba(226, 232, 240, 0.22)",
  },
};

const RSI_PANE_HEIGHT = 72;
const MACD_PANE_HEIGHT = 68;
const TRADINGVIEW_CHART_URL = "https://www.tradingview.com/chart/N6SBLK6M/";
const TRADE_MARKER_YELLOW = "#facc15";
const TRADE_ENTRY_VIBRANT = "#22d3ee";
const TRADE_TP_DARK = "#166534";
const TRADE_SL_DARK = "#7f1d1d";
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

const parsePosNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const samePriceWithinTolerance = (a, b, precision = 4) => {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const safePrecision = Math.max(0, Math.min(8, Number(precision) || 0));
  const epsilon = 1 / 10 ** (safePrecision + 2);
  return Math.abs(left - right) <= epsilon;
};

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
  const clean = [];
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
    if (!Number.isFinite(t) || t <= 0) {
      // check for BusinessDay object
      if (typeof rawTime === "object" && rawTime !== null) {
        if (Number.isFinite(Number(rawTime.year)) && Number.isFinite(Number(rawTime.month)) && Number.isFinite(Number(rawTime.day))) {
          clean.push({ time: rawTime, open: o, high: h, low: l, close: c });
        }
      }
      continue;
    }
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    clean.push({ time: t, open: o, high: h, low: l, close: c });
  }
  const min = Number.isFinite(minBars) && minBars > 1 ? minBars : 2;
  return clean.length >= min ? clean : [];
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
  const interval = String(intervalRaw || "").trim().toLowerCase();
  return (
    interval === "1m" ||
    interval === "1" ||
    interval === "5m" ||
    interval === "5" ||
    interval === "15m" ||
    interval === "15"
  );
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
  const rightPaddingBars = Math.max(2, Math.round(range.requestedVisibleBars * 0.05));
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
  const rightPaddingBars = Math.max(2, Math.round(range.requestedVisibleBars * 0.05));
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

function applyLatestBarsViewport(chart, candles = [], visibleBarsCount = 0) {
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
    // Keep the latest bar near 5/6 of the chart width by reserving ~20%
    // of the visible window as space on the right side.
    const rightPaddingBars = Math.max(
      2,
      Math.round(requestedVisibleBars * 0.2),
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
    chart.timeScale().setVisibleLogicalRange({
      from: firstIndex,
      to: lastIndex + rightPaddingBars,
    });
    return true;
  } catch {
    return false;
  }
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
  if (!chart || !viewport || typeof viewport !== "object") return false;
  const timeStartMs = Number(viewport.timeStartMs);
  const timeEndMs = Number(viewport.timeEndMs);
  let appliedTimeRange = false;
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
  return appliedTimeRange;
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
  if (sym.startsWith("XAU") || sym.startsWith("XAG")) {
    return Math.min(Math.max(inferred, 2), 2);
  }
  if (sym.endsWith("USD") || sym.endsWith("USDT")) {
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

function parsePdZoneBounds(item) {
  const localAsNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const lowRaw = localAsNum(
    item?.low ?? item?.bottom ?? item?.price_bottom ?? item?.bot,
  );
  const highRaw = localAsNum(item?.high ?? item?.top ?? item?.price_top);
  if (lowRaw != null && highRaw != null) {
    return { low: Math.min(lowRaw, highRaw), high: Math.max(lowRaw, highRaw) };
  }
  const zone = String(item?.zone || "").trim();
  if (!zone) return null;
  const nums = zone.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const a = Number(nums[0]);
  const b = Number(nums[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

function parseKeyLevels(snapshot) {
  const arr = Array.isArray(snapshot?.key_levels) ? snapshot.key_levels : [];
  return arr
    .map((x) => {
      const price = Number(x?.price ?? x?.level ?? x?.value);
      if (!Number.isFinite(price)) return null;
      return {
        name: String(x?.name || x?.label || "Key").trim() || "Key",
        price,
        kind: String(x?.kind || "generic"),
      };
    })
    .filter(Boolean)
    .slice(0, 20);
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
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 100000000000 ? Math.floor(n / 1000) : Math.floor(n);
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
  rsiPanel: true,
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

function getCandleSeriesOptions({ candlesVisible = true, zigzagVisible = true } = {}) {
  const muted = Boolean(zigzagVisible);
  return {
    visible: Boolean(candlesVisible),
    upColor: muted ? "rgba(45, 212, 191, 0.38)" : BACKTEST_CHART_THEME.candleUp,
    downColor: muted ? "rgba(248, 113, 113, 0.34)" : BACKTEST_CHART_THEME.candleDown,
    borderVisible: false,
    wickUpColor: muted ? "rgba(148, 163, 184, 0.38)" : BACKTEST_CHART_THEME.wickUp,
    wickDownColor: muted ? "rgba(148, 163, 184, 0.38)" : BACKTEST_CHART_THEME.wickDown,
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
  const labelText = String(rawLabel || "").trim();
  if (!labelText) return "";
  const normalized = labelText.replace(/^All\s+/i, "").trim();
  const key = normalized.toLowerCase().replace(/[\s_-]+/g, " ");
  if (key === "swing high") return "SH";
  if (key === "swing low") return "SL";
  if (key === "liquidity high") return "LQH";
  if (key === "liquidity low") return "LQL";
  if (key === "bullish engulfing") return "Bull Eng";
  if (key === "bearish engulfing") return "Bear Eng";
  if (key === "bullish pin bar") return "Bull Pin";
  if (key === "bearish pin bar") return "Bear Pin";
  if (key === "inside bar") return "Inside";
  if (key === "outside bar") return "Outside";
  if (key === "order block" || key === "ob") return "OB";
  if (key === "fair value gap" || key === "fvg") return "FVG";
  if (key === "previous day high" || key === "pdh") return "PDH";
  if (key === "previous day low" || key === "pdl") return "PDL";
  if (key === "support") return "Support";
  if (key === "demand") return "Demand";
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
  return target;
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

class TimeRangeBoxPrimitive {
  constructor({
    startTimeSec,
    endTimeSec = null,
    priceLow,
    priceHigh,
    lineColor = "#60a5fa",
    fillColor = "rgba(96,165,250,0.14)",
    extendRight = false,
    lineDash = [],
    lineWidth = 1,
    shadowBlur = 0,
    label = "",
  }) {
    this._startTime = startTimeSec;
    this._endTime = endTimeSec;
    this._priceLow = priceLow;
    this._priceHigh = priceHigh;
    this._lineColor = lineColor;
    this._fillColor = fillColor;
    this._extendRight = extendRight;
    this._lineDash = Array.isArray(lineDash) ? lineDash : [];
    this._lineWidth = Number.isFinite(Number(lineWidth)) ? Number(lineWidth) : 1;
    this._shadowBlur = Number.isFinite(Number(shadowBlur)) ? Number(shadowBlur) : 0;
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
                const visibleStartTime = Number(timeAtLogicalStart);
                const visibleEndTime = Number(timeAtLogicalEnd);
                const rawXStart = ts.timeToCoordinate(self._startTime);
                const xEnd = self._endTime
                  ? ts.timeToCoordinate(self._endTime)
                  : null;
                const pixelRatioX = scope.horizontalPixelRatio || 1;
                const pixelRatioY = scope.verticalPixelRatio || 1;
                const x0 =
                  rawXStart == null
                    ? Number.isFinite(visibleStartTime) && self._startTime < visibleStartTime
                      ? 0
                      : null
                    : Math.max(0, Math.round(rawXStart * pixelRatioX));
                const x1 =
                  self._extendRight || xEnd == null
                    ? Number.isFinite(visibleEndTime) &&
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
                  ctx.shadowColor = self._lineColor;
                  ctx.shadowBlur = self._shadowBlur;
                }
                ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
                if (self._lineWidth > 0) {
                  ctx.strokeStyle = self._lineColor;
                  ctx.lineWidth = self._lineWidth;
                  if (self._lineDash.length) ctx.setLineDash(self._lineDash);
                  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
                }
                if (self._label && x1 - x0 >= 36) {
                  ctx.setLineDash([]);
                  ctx.shadowBlur = 0;
                  const fontPx = Math.max(11, Math.round(11 * pixelRatioY));
                  ctx.font = `${fontPx}px sans-serif`;
                  ctx.textBaseline = "top";
                  const textWidth = ctx.measureText(self._label).width;
                  const padX = Math.max(4, Math.round(4 * pixelRatioX));
                  const padY = Math.max(2, Math.round(2 * pixelRatioY));
                  const chipX = x0 + padX;
                  const chipY = Math.max(0, y0 + padY);
                  const chipH = fontPx + padY * 2;
                  const chipW = Math.min(
                    x1 - x0 - padX * 2,
                    Math.ceil(textWidth + padX * 2),
                  );
                  if (chipW >= 24) {
                    ctx.fillStyle = "rgba(2, 6, 23, 0.82)";
                    ctx.fillRect(chipX, chipY, chipW, chipH);
                    ctx.fillStyle = self._lineColor;
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
  }) {
    this._timeSec = Number(timeSec);
    this._price = Number(price);
    this._color = String(color || "#facc15");
    this._text = String(text || "").trim();
    this._placement = String(placement || "aboveBar");
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
                const x = Math.round(xCoord * ratioX);
                const baseY = Math.round(priceY * ratioY);
                const direction = self._placement === "belowBar" ? 1 : -1;
                const markerOffset = Math.round(26 * ratioY);
                const markerY = baseY + direction * markerOffset;
                const diamondRadius = Math.max(3, Math.round(3 * ratioY));
                const lineTop = Math.min(baseY, markerY);
                const lineBottom = Math.max(baseY, markerY);
                const textOffsetX = Math.round(8 * ratioX);
                const textOffsetY = direction < 0 ? -6 : 12;

                ctx.save();
                ctx.strokeStyle = `${self._color}99`;
                ctx.lineWidth = Math.max(1, Math.round(ratioX));
                ctx.beginPath();
                ctx.moveTo(x, lineTop);
                ctx.lineTo(x, lineBottom);
                ctx.stroke();

                ctx.fillStyle = self._color;
                ctx.beginPath();
                ctx.moveTo(x, markerY - diamondRadius);
                ctx.lineTo(x + diamondRadius, markerY);
                ctx.lineTo(x, markerY + diamondRadius);
                ctx.lineTo(x - diamondRadius, markerY);
                ctx.closePath();
                ctx.fill();

                if (self._text) {
                  ctx.fillStyle = self._color;
                  ctx.font = `${Math.max(10, Math.round(10 * ratioY))}px sans-serif`;
                  ctx.textAlign = "left";
                  ctx.textBaseline = direction < 0 ? "bottom" : "top";
                  ctx.fillText(
                    self._text,
                    x + textOffsetX,
                    markerY + Math.round(textOffsetY * ratioY),
                  );
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
    lineDash = [4, 4],
    lineWidth = 1,
    background = "rgba(2, 6, 23, 0.82)",
  }) {
    this._price = Number(price);
    this._label = String(label || "").trim();
    this._color = color;
    this._lineDash = Array.isArray(lineDash) ? lineDash : [4, 4];
    this._lineWidth = Number.isFinite(Number(lineWidth))
      ? Math.max(1, Number(lineWidth))
      : 1;
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
                ctx.lineWidth = self._lineWidth;
                if (self._lineDash.length) ctx.setLineDash(self._lineDash);
                ctx.beginPath();
                ctx.moveTo(0, yPos);
                ctx.lineTo(r.width, yPos);
                ctx.stroke();

                if (self._label) {
                  ctx.setLineDash([]);
                  const fontPx = Math.max(10, Math.round(10 * pixelRatioY));
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
    color = "#60a5fa",
    lineDash = [4, 4],
    lineWidth = 1,
    background = "rgba(2, 6, 23, 0.82)",
  }) {
    this._price = Number(price);
    this._startTime = Number(startTimeSec);
    this._endTime = Number(endTimeSec);
    this._label = String(label || "").trim();
    this._color = color;
    this._lineDash = Array.isArray(lineDash) ? lineDash : [4, 4];
    this._lineWidth = Number.isFinite(Number(lineWidth))
      ? Math.max(1, Number(lineWidth))
      : 1;
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
                const visibleRange =
                  typeof ts.getVisibleLogicalRange === "function"
                    ? ts.getVisibleLogicalRange()
                    : null;
                const logicalStart =
                  visibleRange && Number.isFinite(Number(visibleRange.from))
                    ? Number(visibleRange.from)
                    : null;
                const visibleStartTime =
                  Number.isFinite(logicalStart) &&
                  typeof ts.coordinateToTime === "function"
                    ? Number(ts.coordinateToTime(logicalStart))
                    : null;
                const rawXStart = ts.timeToCoordinate(self._startTime);
                if (y == null) return;
                const xStart =
                  rawXStart == null
                    ? Number.isFinite(visibleStartTime) && self._startTime < visibleStartTime
                      ? 0
                      : null
                    : rawXStart;
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

                ctx.save();
                ctx.strokeStyle = self._color;
                ctx.lineWidth = self._lineWidth;
                if (self._lineDash.length) ctx.setLineDash(self._lineDash);
                ctx.beginPath();
                ctx.moveTo(x0, yPos);
                ctx.lineTo(x1, yPos);
                ctx.stroke();

                if (self._label && x1 - x0 >= 18) {
                  ctx.setLineDash([]);
                  const fontPx = Math.max(9, Math.round(9 * pixelRatioY));
                  const padX = Math.max(3, Math.round(3 * pixelRatioX));
                  const padY = Math.max(1, Math.round(1 * pixelRatioY));
                  ctx.font = `${fontPx}px sans-serif`;
                  const textWidth = ctx.measureText(self._label).width;
                  const chipW = Math.ceil(textWidth + padX * 2);
                  const chipH = fontPx + padY * 2;
                  const chipX = x0 + padX;
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
  showPdArrays = true,
  showKeyLevels = true,
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
}) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const currentBarsRef = useRef([]);
  const indicatorSeriesRefs = useRef({});
  const indicatorDataRef = useRef({});
  const suppressCrosshairSyncRef = useRef(false);
  const runtimeViewportRef = useRef(null);
  const lastRenderedBarsSignatureRef = useRef("");
  const lastAutoFitSignatureRef = useRef("");
  const pricePrecisionRef = useRef(5);
  const hoverPriceLinesRef = useRef({ lines: [] });
  const planPriceLinesRef = useRef([]);
  const tradeOverlayPriceLinesRef = useRef([]);
  const tradeOverlayPrimitivesRef = useRef([]);
  const sharedOverlayPriceLinesRef = useRef([]);
  const sharedOverlayPrimitivesRef = useRef([]);
  const seriesMarkersRef = useRef(null);
  const candleHoverPriceLineRef = useRef(null);
  const indicatorHoverPriceLinesRef = useRef({});
  const levelPriceMapRef = useRef({
    entry: null,
    tp: null,
    tp1: null,
    sl: null,
  });
  const [loading, setLoading] = useState(false);
  const debugChartEnabled = useMemo(() => {
    if (typeof window === "undefined") return false;
    const path = String(window.location.pathname || "");
    const hash = String(window.location.hash || "").toLowerCase();
    const sid = String(selectedTradeSid || "").trim();
    if (!sid) return false;
    return (
      hash.includes("chart-analysis") &&
      path.includes("/trades/") &&
      path.includes(sid)
    );
  }, [selectedTradeSid]);
  const debugChartLog = useCallback((label, payload = null) => {
    if (!debugChartEnabled) return;
    if (payload == null) {
      console.log(`[chart-debug][${selectedTradeSid}][${chartId || interval}] ${label}`);
      return;
    }
    console.log(`[chart-debug][${selectedTradeSid}][${chartId || interval}] ${label}`, payload);
  }, [chartId, debugChartEnabled, interval, selectedTradeSid]);
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
  const effectiveClosedAtEpochSec =
    overlayTrade?.closedAtSec ?? closedAtEpochSec;
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
        normalizedCreatedAtEpochSec,
      lastAnchorTimeSec:
        effectiveClosedAtEpochSec > 0
          ? effectiveClosedAtEpochSec
          : null,
    }),
    [
      effectiveClosedAtEpochSec,
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
  const effectiveIndicatorVisibility =
    indicatorVisibilityConfig || indicatorVisibility;
  const showRsiPanel = effectiveIndicatorVisibility.rsiPanel !== false;
  const showMacdPanel = showRsiPanel;
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
    hoverPriceLinesRef.current.lines = hoverPriceLinesRef.current.lines.filter(
      (line) => line?.overlayType !== "plan",
    );
    levelPriceMapRef.current = {
      entry: null,
      tp: null,
      tp1: null,
      sl: null,
    };
  }, []);

  const clearTradeOverlayArtifacts = useCallback(() => {
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
  }, []);

  const clearSharedOverlayArtifacts = useCallback(() => {
    const series = seriesRef.current;
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
  }, []);

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
      try {
        candleHoverPriceLineRef.current = candleSeries.createPriceLine({
          price: nextValue,
          color: "#9ca3af",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          axisLabelColor: "#9ca3af",
          axisLabelTextColor: "#ffffff",
          title: "",
        });
      } catch {}
    },
    [clearCandleHoverPriceLine],
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
          color: INDICATOR_LINE_STYLE.colors.zigzag,
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
        if (!visibleBars && Array.isArray(currentBarsRef.current)) {
          visibleBars = currentBarsRef.current.filter((bar) => {
            const timeMs = Number(bar?.time) * 1000;
            return (
              Number.isFinite(timeMs) &&
              (t0 == null || timeMs >= t0) &&
              (t1 == null || timeMs <= t1)
            );
          }).length;
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
        debugChartLog("viewport-emitted", runtimeViewportRef.current);
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
          onCrosshairSync({ sourceId: chartId, active: false });
          return;
        }

        const candleData = param.seriesData?.get?.(candleSeries);
        const rawPrice =
          candleData?.close ??
          candleData?.value ??
          (param.point ? candleSeries.coordinateToPrice(param.point.y) : null);
        const price = Number(rawPrice);
        if (!Number.isFinite(price)) return;
        setCandleHoverGuide(price);

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

      // --- Price line tooltip ---
      const tooltipEl = document.createElement("div");
      tooltipEl.style.cssText =
        `display:none;position:absolute;z-index:100;background:${theme.panel};color:${theme.text};padding:4px 8px;border-radius:4px;font-size:11px;pointer-events:none;white-space:nowrap;border:1px solid ${theme.border};`;
      chartElement.appendChild(tooltipEl);

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
          tooltipEl.style.left = param.point.x + 10 + "px";
          tooltipEl.style.top = closest.y - 20 + "px";
          tooltipEl.textContent = `${closest.label} ${closest.priceText}`;
        } else {
          tooltipEl.style.display = "none";
        }
      };

      chart.subscribeCrosshairMove((param) => {
        handlePriceLineHover(param);
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
              // No cached data available. Don't auto-call TwelveData —
              // user must click Refresh button in Info tab to fetch.
              setLoading(false);
              return;
            } // end cache-check else
          }

          // Validate bar data before passing to lightweight-charts.
          // Malformed time values (undefined/null/non-finite) crash the chart.
          candles = ensureValidBars(candles);
          currentBarsRef.current = candles;

          if (!candles.length) {
            console.warn(
              "No valid snapshot/Twelve bars available for this symbol/timeframe.",
            );
            setLoading(false);
            return;
          }

          const nextBarsSignature = buildBarsSignature(candles);
          const barsChanged =
            nextBarsSignature !== lastRenderedBarsSignatureRef.current;
          lastRenderedBarsSignatureRef.current = nextBarsSignature;
          if (barsChanged) {
            runtimeViewportRef.current = null;
          }
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
              candleSeries.setData(candles);
            } catch (e) {
              console.error("Chart setData failed:", e?.message || e);
              setLoading(false);
              return;
            }
            if (typeof onBarsLoaded === "function") {
              onBarsLoaded(interval, candles.length);
            }

            if (showIndicators && showRsiPanel) {
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
              Object.entries(builtIndicators).forEach(([key, data]) => {
                const targetSeries = indicatorSeriesRefs.current?.[key];
                if (!targetSeries || !Array.isArray(data) || !data.length) return;
                try {
                  targetSeries.setData(data);
                  targetSeries.applyOptions({
                    visible: Boolean(effectiveIndicatorVisibility[key]),
                  });
                } catch {}
              });
              indicatorDataRef.current = builtIndicators;
              setIndicatorValues({
                rsi: getLastSeriesValue(builtIndicators.rsi),
                rsiEma9: getLastSeriesValue(builtIndicators.rsiEma9),
                rsiWma45: getLastSeriesValue(builtIndicators.rsiWma45),
                stochK: getLastSeriesValue(builtIndicators.stochK),
                stochD: getLastSeriesValue(builtIndicators.stochD),
              });
            } else {
              indicatorDataRef.current = {};
              setIndicatorValues({});
            }

            // --- ENTRY / TP / SL for all plans ---
            updatePlanOverlays(snapshot);

            // --- MARKERS: creation/open/close markers ---
            const markers = [];
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
                const openedMarkerPrice = resolveEventMarkerAnchorPrice(
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
                tpPrice: tpPrice ?? tp1Price,
                slPrice,
              });
              const closeLine = resolveClosedTradeLineStyle(
                {
                  closeStatus: effectiveCloseStatus,
                  pnlRealized: effectivePnlRealized,
                  exitPrice: effectiveExitPrice,
                  tpPrice: tpPrice ?? tp1Price,
                  slPrice,
                },
                computePriceBoundsFromBars(candles),
              );
              const resolvedCloseBadgePrice = Number.isFinite(Number(effectiveExitPrice))
                ? Number(effectiveExitPrice)
                : closeLine?.value ?? resolvedCloseLinePrice;
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
                const closeMarkerPrice = resolveEventMarkerAnchorPrice(
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

            // Shared horizontal lines (added from context menu, replicated per TF)
            if (Array.isArray(sharedLines) && sharedLines.length > 0) {
              sharedLines.forEach((ln, idx) => {
                const p = Number(ln?.price);
                if (!Number.isFinite(p)) return;
                candleSeries.createPriceLine({
                  price: p,
                  color: String(ln?.color || "#60a5fa"),
                  lineWidth: 1,
                  lineStyle: 2,
                  axisLabelVisible: true,
                  title: ln?.label || `L${idx + 1}`,
                });
                hoverPriceLinesRef.current.lines.push({
                  overlayType: "shared",
                  price: p,
                  label: ln?.label || `L${idx + 1}`,
                  priceText: formatPriceWithPrecision(
                    p,
                    pricePrecisionRef.current,
                  ),
                });
              });
            }

            clearSharedOverlayArtifacts();
            if (Array.isArray(sharedObjects) && sharedObjects.length > 0) {
              const firstCandleTime = candles.length
                ? toEpochSec(candles[0]?.time)
                : null;
              const lastCandleTime = candles.length
                ? toEpochSec(candles[candles.length - 1]?.time)
                : null;
              sharedObjects.forEach((obj, idx) => {
                if (!obj || obj.visible === false) return;
                const label = formatSharedObjectLabel(obj.type, obj.label || "");
                const lineColor = String(obj.color || "#60a5fa");
                const lineWidth = Math.max(1, Number(obj.line_width) || 1);
                const lineStyle = lineStyleToChartValue(obj.line_style);
                if (obj.kind === "line") {
                  const price = Number(obj.price ?? obj.anchorPrice);
                  if (!Number.isFinite(price)) return;
                  const startTimeSec = toEpochSec(obj.anchorTimeMs ?? obj.time);
                  const endTimeSec = toEpochSec(obj.anchorTimeMs2);
                  const linePrimitive =
                    Number.isFinite(startTimeSec)
                      ? new HorizontalPriceSegmentPrimitive({
                          price,
                          startTimeSec,
                          endTimeSec,
                          label,
                          color: lineColor,
                          lineDash: obj.line_style === "dot" ? [4, 4] : [],
                          lineWidth: 1,
                        })
                      : new HorizontalPriceLinePrimitive({
                          price,
                          label,
                          color: lineColor,
                          lineDash: obj.line_style === "dot" ? [4, 4] : [],
                          lineWidth: 1,
                        });
                  candleSeries.attachPrimitive(linePrimitive);
                  sharedOverlayPrimitivesRef.current.push(linePrimitive);
                  const sharedLine = candleSeries.createPriceLine({
                    price,
                    color: lineColor,
                    lineWidth,
                    lineStyle,
                    axisLabelVisible: false,
                    title: "",
                  });
                  sharedOverlayPriceLinesRef.current.push(sharedLine);
                  hoverPriceLinesRef.current.lines.push({
                    overlayType: "shared",
                    price,
                    label: label || obj.type || `L${idx + 1}`,
                    priceText: formatPriceWithPrecision(
                      price,
                      pricePrecisionRef.current,
                    ),
                  });
                  return;
                }
                if (obj.kind === "point") {
                  const timeSec = toEpochSec(obj.time ?? obj.anchorTimeMs);
                  const price = Number(obj.price ?? obj.anchorPrice);
                  if (Number.isFinite(price) && Number.isFinite(timeSec)) {
                    markers.push({
                      time: timeSec,
                      position: "inBar",
                      color: lineColor,
                      shape: String(obj.marker_shape || "circle"),
                      text: String(obj.marker_text ?? "").trim(),
                    });
                  } else if (Number.isFinite(price)) {
                    const pointPrimitive = new HorizontalPriceLinePrimitive({
                        price,
                        label: label || obj.type || `P${idx + 1}`,
                        color: lineColor,
                        lineDash: obj.line_style === "dot" ? [4, 4] : [],
                        lineWidth: 1,
                      });
                    candleSeries.attachPrimitive(pointPrimitive);
                    sharedOverlayPrimitivesRef.current.push(pointPrimitive);
                    const sharedLine = candleSeries.createPriceLine({
                      price,
                      color: lineColor,
                      lineWidth,
                      lineStyle,
                      axisLabelVisible: false,
                      title: "",
                    });
                    sharedOverlayPriceLinesRef.current.push(sharedLine);
                    hoverPriceLinesRef.current.lines.push({
                      overlayType: "shared",
                      price,
                      label: label || obj.type || `P${idx + 1}`,
                      priceText: formatPriceWithPrecision(
                        price,
                        pricePrecisionRef.current,
                      ),
                    });
                  }
                  return;
                }
                if (obj.kind === "zone") {
                  const top = Number(
                    obj.price_top ?? obj.anchorPrice ?? obj.price,
                  );
                  const bottom = Number(
                    obj.price_bottom ?? obj.anchorPrice2 ?? obj.price,
                  );
                  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return;
                  const startTimeSec =
                    toEpochSec(obj.anchorTimeMs ?? obj.time) || firstCandleTime;
                  const endTimeSec =
                    toEpochSec(obj.anchorTimeMs2) || lastCandleTime || null;
                  if (!Number.isFinite(startTimeSec)) return;
                  const isFvg = obj.artifact_group === "fvg";
                  const zonePrimitive = new TimeRangeBoxPrimitive({
                      startTimeSec,
                      endTimeSec,
                      priceLow: Math.min(top, bottom),
                      priceHigh: Math.max(top, bottom),
                      lineColor,
                      fillColor:
                        String(obj.bg_color || "").trim() || `${lineColor}22`,
                      extendRight: !Number.isFinite(endTimeSec),
                      lineDash: isFvg ? [] : obj.line_style === "dot" ? [4, 3] : [],
                      lineWidth: isFvg ? 0 : 1,
                      shadowBlur: isFvg ? 3 : obj.artifact_group === "ob" ? 8 : 0,
                      label,
                    });
                  candleSeries.attachPrimitive(zonePrimitive);
                  sharedOverlayPrimitivesRef.current.push(zonePrimitive);
                  return;
                }
              });
            }

            if (markers.length > 0) {
              seriesMarkersRef.current = createSeriesMarkers(candleSeries, markers);
            }

            const enableLevelDrag =
              typeof onPlanLevelChange === "function" &&
              Number.isFinite(levelPriceMapRef.current.entry) &&
              (Number.isFinite(levelPriceMapRef.current.tp) ||
               Number.isFinite(levelPriceMapRef.current.tp1)) &&
              Number.isFinite(levelPriceMapRef.current.sl);

            const pickNearestLevel = (mouseY) => {
              const candidates = [
                { key: "entry", price: levelPriceMapRef.current.entry },
                {
                  key: "tp1",
                  price:
                    levelPriceMapRef.current.tp1 ?? levelPriceMapRef.current.tp,
                },
                { key: "sl", price: levelPriceMapRef.current.sl },
              ]
                .map((x) => ({
                  ...x,
                  y: candleSeries.priceToCoordinate(x.price),
                }))
                .filter((x) => Number.isFinite(x.y))
                .map((x) => ({ ...x, dist: Math.abs(x.y - mouseY) }))
                .sort((a, b) => a.dist - b.dist);
              if (!candidates.length || candidates[0].dist > 12) return null;
              return candidates[0].key;
            };

            const emitLevelAtMouse = (evt) => {
              if (!dragState.activeKey) return;
              const rect = chartElement.getBoundingClientRect();
              const y = evt.clientY - rect.top;
              const nextPrice = candleSeries.coordinateToPrice(y);
              if (!Number.isFinite(nextPrice)) return;
              onPlanLevelChange(dragState.activeKey, Number(nextPrice));
            };

            const onMouseMove = (evt) => {
              if (!dragState.activeKey || !enableLevelDrag) return;
              emitLevelAtMouse(evt);
            };

            const onMouseUp = () => {
              dragState.activeKey = null;
              window.removeEventListener("mousemove", onMouseMove);
              window.removeEventListener("mouseup", onMouseUp);
            };

            const onMouseDown = (evt) => {
              if (!enableLevelDrag) return;
              const rect = chartElement.getBoundingClientRect();
              const y = evt.clientY - rect.top;
              const nearest = pickNearestLevel(y);
              if (!nearest) return;
              dragState.activeKey = nearest;
              window.addEventListener("mousemove", onMouseMove);
              window.addEventListener("mouseup", onMouseUp);
              evt.preventDefault();
            };

            chartElement.addEventListener("mousedown", onMouseDown);
            removeDragListeners = () => {
              onMouseUp();
              chartElement.removeEventListener("mousedown", onMouseDown);
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
              const price = candleSeries.coordinateToPrice(y);
              const time = chart.timeScale().coordinateToTime(x);
              if (!Number.isFinite(Number(price))) return;
              evt.preventDefault();
              onContextRequest({
                chartId,
                symbol,
                interval,
                price: Number(price),
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

            // --- PD ARRAYS as boxes ---
            // Support both old signal format (nested under market_analysis) and new (top-level)
            const rawPdArrays = Array.isArray(snapshot?.pd_arrays)
              ? snapshot.pd_arrays
              : Array.isArray(snapshot?.pdArrays)
                ? snapshot.pdArrays
                : Array.isArray(snapshot?.market_analysis?.pd_arrays)
                  ? snapshot.market_analysis.pd_arrays
                  : [];

            // HTF tfs from snapshot or fall back to timeframe magnitude ordering
            const htfTfsRaw = Array.isArray(snapshot?.htf_tfs)
              ? snapshot.htf_tfs
              : [];
            const normTf = (v) =>
              String(v || "")
                .trim()
                .toUpperCase()
                .replace(/\s+/g, "");

            // Color by TF magnitude when htf_tfs not stored:
            // D/W/M → yellow (HTF1), 4H/1H/2H → purple (HTF2), else blue
            const tfToMagnitudeMinutes = (tf) => {
              const t = normTf(tf);
              if (t === "M" || t === "1M" || t === "MN") return 43200;
              if (t === "W" || t === "1W") return 10080;
              if (t === "D" || t === "1D") return 1440;
              if (t === "4H") return 240;
              if (t === "2H") return 120;
              if (t === "1H") return 60;
              if (t === "30M") return 30;
              if (t === "15M") return 15;
              if (t === "5M") return 5;
              if (t === "1M") return 1;
              const m = t.match(/^(\d+)M$/);
              if (m) return Number(m[1]);
              const h = t.match(/^(\d+)H$/);
              if (h) return Number(h[1]) * 60;
              return 15;
            };

            const COLOR_HTF1 = "#f59e0b"; // yellow
            const COLOR_HTF2 = "#a855f7"; // purple
            const COLOR_EXEC = "#60a5fa"; // blue

            const colorForTf = (pdTf) => {
              if (htfTfsRaw.length > 0) {
                // Use stored htf_tfs list
                if (normTf(htfTfsRaw[0]) === normTf(pdTf)) return COLOR_HTF1;
                if (
                  htfTfsRaw.length > 1 &&
                  normTf(htfTfsRaw[1]) === normTf(pdTf)
                )
                  return COLOR_HTF2;
                return COLOR_EXEC;
              }
              // Fallback: color by magnitude
              const mag = tfToMagnitudeMinutes(pdTf);
              if (mag >= 1440) return COLOR_HTF1; // D and above → yellow
              if (mag >= 60) return COLOR_HTF2; // 1H–4H → purple
              return COLOR_EXEC; // sub-hour → blue
            };

            const activePdArrays = rawPdArrays.filter((pd) => {
              const status = String(pd?.status || "")
                .toLowerCase()
                .trim();
              return (
                status === "active" ||
                status === "fresh" ||
                status === "tested" ||
                status === ""
              );
            });

            if (showPdArrays) {
              activePdArrays.slice(0, 50).forEach((pd) => {
                const bounds = parsePdZoneBounds(pd);
                if (!bounds || bounds.low == null || bounds.high == null)
                  return;
                if (bounds.low === bounds.high) return; // skip degenerate

                const color = colorForTf(pd?.timeframe || "");

                const barStartRaw = Number(pd?.bar_start);
                const barStart =
                  Number.isFinite(barStartRaw) && barStartRaw > 100000
                    ? barStartRaw
                    : candles.length
                      ? Number(candles[0]?.time)
                      : null;

                if (!barStart) return;

                const primitive = new PdArrayBoxPrimitive(
                  barStart,
                  bounds.low,
                  bounds.high,
                  color,
                );
                candleSeries.attachPrimitive(primitive);
              });
            }

            // --- KEY LEVELS as orange dotted lines ---
            const keyLevels = parseKeyLevels(
              snapshot?.key_levels
                ? snapshot
                : snapshot?.market_analysis
                  ? snapshot.market_analysis
                  : snapshot,
            );
            if (showKeyLevels) {
              keyLevels.forEach((k) => {
                candleSeries.createPriceLine({
                  price: k.price,
                  color: "#f97316",
                  lineWidth: 1,
                  lineStyle: 4,
                  axisLabelVisible: false,
                  title: "",
                });
              });
            }

            // Prefer the user's current viewport during plan/overlay updates.
            const viewportToRestore = preferTradeAnchoredViewport
              ? null
              : barsChanged
                ? initialViewport
                : runtimeViewportRef.current || initialViewport;
            const shouldAutoFitOnLoad =
              autoFitNonce > 0 ||
              !viewportToRestore ||
              barsChanged;
            const restoredViewport = applyStoredViewport(
              chart,
              candleSeries,
              viewportToRestore,
            );
            debugChartLog("viewport-pre-apply", {
              barsChanged,
              restoredViewport,
              shouldAutoFitOnLoad,
              viewportToRestore,
              preferTradeAnchoredViewport,
              tradeViewportAnchors,
              loadedBars: candles.length,
              loadedFirst: candles[0]?.time || null,
              loadedLast: candles[candles.length - 1]?.time || null,
            });
            if (!restoredViewport || shouldAutoFitOnLoad) {
              const anchoredLastBarTimeSec =
                Number.isFinite(Number(tradeViewportAnchors.lastAnchorTimeSec)) &&
                Number(tradeViewportAnchors.lastAnchorTimeSec) > 0
                  ? Number(tradeViewportAnchors.lastAnchorTimeSec)
                  : Number(candles[candles.length - 1]?.time) || null;
              const usedTradeViewport = preferTradeAnchoredViewport
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
              debugChartLog("viewport-apply-primary", {
                mode: usedTradeViewport ? "trade-anchor" : "latest-bars",
                anchoredLastBarTimeSec,
                preferTradeAnchoredViewport,
              });
              if (!usedTradeViewport) {
                applyLatestBarsViewport(chart, candles, visibleBarsCount);
              }
              requestAnimationFrame(() => {
                const reappliedTradeViewport = preferTradeAnchoredViewport
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
                debugChartLog("viewport-apply-raf", {
                  mode: reappliedTradeViewport ? "trade-anchor" : "latest-bars",
                  anchoredLastBarTimeSec,
                  preferTradeAnchoredViewport,
                });
                if (!reappliedTradeViewport) {
                  applyLatestBarsViewport(chart, candles, visibleBarsCount);
                }
                emitViewport();
              });
            } else {
              requestAnimationFrame(() => {
                emitViewport();
              });
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
        clearCandleHoverPriceLine();
        clearIndicatorHoverPriceLines();
        hoverPriceLinesRef.current.lines = [];
        chartRef.current = null;
        seriesRef.current = null;
        indicatorSeriesRefs.current = {};
        indicatorDataRef.current = {};
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
    historicalDataSignature,
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
    sharedLinesSignature,
    sharedObjectsSignature,
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
    clearCandleHoverPriceLine,
    clearIndicatorHoverPriceLines,
    setCandleHoverGuide,
    setIndicatorHoverGuides,
    isReplayActive,
    replayClockTimeSec,
    autoFitNonce,
  ]);

  useEffect(() => {
    if (!chartRef.current || !currentBarsRef.current?.length) return;
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
    debugChartLog("viewport-effect-reapply", {
      appliedTradeViewport,
      preferTradeAnchoredViewport,
      targetAnchors,
      bars: currentBarsRef.current.length,
      first: currentBarsRef.current[0]?.time || null,
      last: currentBarsRef.current[currentBarsRef.current.length - 1]?.time || null,
    });
    if (!appliedTradeViewport) {
      applyLatestBarsViewport(
        chartRef.current,
        currentBarsRef.current,
        visibleBarsCount,
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
    debugChartLog,
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
          borderRadius: "8px",
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
      <button
        type="button"
        aria-label={`Open ${tvSymbol} ${displayIntervalLabel(interval)} in TradingView`}
        title={`Open ${tvSymbol} ${displayIntervalLabel(interval)} in TradingView`}
        onClick={() => {
          const url = `${TRADINGVIEW_CHART_URL}?symbol=${encodeURIComponent(tvSymbol)}&interval=${encodeURIComponent(tvInterval)}`;
          window.open(url, "_blank", "noopener,noreferrer");
        }}
        style={{
          position: "absolute",
          left: 8,
          bottom: 8,
          width: 34,


          border: "none",

          background: "transparent",
          cursor: "pointer",
          zIndex: 12,
        }}
      />
    </div>
  );
}
