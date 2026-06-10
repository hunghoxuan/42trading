import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";
import {
  asNumValue,
  formatChartDateTime,
  getEffectiveDisplayTimezone,
} from "../utils/format";
import { chartFetchManager } from "../services/chartFetchManager";
import { normalizePlanLinePrice } from "../utils/tradePlanDrafts";
import { getUiThemeColors } from "../utils/uiTheme";

const parsePosNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

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

function toTradingViewSymbol(symbolRaw) {
  return String(symbolRaw || "").trim().toUpperCase();
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

function formatSharedObjectLabel(type, rawLabel) {
  const typeText = String(type || "").trim();
  const labelText = String(rawLabel || "").trim();
  const base = typeText || labelText;
  if (!base) return "";
  const normalized = base.replace(/^All\s+/i, "").trim();
  return normalized ? `All ${normalized}` : "";
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
  }) {
    this._startTime = startTimeSec;
    this._endTime = endTimeSec;
    this._priceLow = priceLow;
    this._priceHigh = priceHigh;
    this._lineColor = lineColor;
    this._fillColor = fillColor;
    this._extendRight = extendRight;
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
                const xStart = ts.timeToCoordinate(self._startTime);
                if (xStart == null) return;
                const xEnd = self._endTime
                  ? ts.timeToCoordinate(self._endTime)
                  : null;
                const pixelRatioX = scope.horizontalPixelRatio || 1;
                const pixelRatioY = scope.verticalPixelRatio || 1;
                const x0 = Math.max(0, Math.round(xStart * pixelRatioX));
                const x1 = self._extendRight || xEnd == null
                  ? r.width
                  : Math.min(r.width, Math.round(xEnd * pixelRatioX));
                const y0 = Math.round(Math.min(yHigh, yLow) * pixelRatioY);
                const y1 = Math.round(Math.max(yHigh, yLow) * pixelRatioY);
                if (x1 <= x0 || y1 <= y0) return;
                ctx.save();
                ctx.fillStyle = self._fillColor;
                ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
                ctx.strokeStyle = self._lineColor;
                ctx.lineWidth = 1;
                ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
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
  interval = "1h",
  height = 320,
  historicalData = [],
  live = true,
  entryPrice = null,
  slPrice = null,
  tpPrice = null,
  tp1Price = null,
  tp2Price = null,
  tp3Price = null,
  createdAt = null,
  openedAt = null,
  closedAt = null,
  closeStatus = "",
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
}) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const suppressCrosshairSyncRef = useRef(false);
  const pricePrecisionRef = useRef(5);
  const [loading, setLoading] = useState(false);
  const [dataSource, setDataSource] = useState("");
  const [timezoneTick, setTimezoneTick] = useState(0);
  const displayTimezone = useMemo(
    () => getEffectiveDisplayTimezone(),
    [timezoneTick],
  );
  const tvSymbol = toTradingViewSymbol(symbol);
  const tvInterval = toTradingViewInterval(interval);
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
          secondsVisible: false,
          tickMarkFormatter: (time) =>
            formatChartDateTime(Number(time) * 1000, displayTimezone),
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
            formatChartDateTime(Number(time) * 1000, displayTimezone),
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

      const candleSeries = chart.addCandlestickSeries({
        upColor: "#26a69a",
        downColor: "#ef5350",
        borderVisible: false,
        wickUpColor: "#26a69a",
        wickDownColor: "#ef5350",
      });

      chartRef.current = chart;
      seriesRef.current = candleSeries;

      emitViewport = () => {
        if (typeof onViewportChange !== "function") return;
        if (!chartContainerRef.current || !chart || !candleSeries) return;
        const w = chartContainerRef.current.clientWidth || 0;
        const h = chartContainerRef.current.clientHeight || height || 0;
        if (!w || !h) return;
        const t0 = lwTimeToMs(chart.timeScale().coordinateToTime(0));
        const t1 = lwTimeToMs(chart.timeScale().coordinateToTime(w));
        const pTop = candleSeries.coordinateToPrice(0);
        const pBottom = candleSeries.coordinateToPrice(h);
        onViewportChange({
          chartId,
          interval,
          width: w,
          height: h,
          timeStartMs: Number.isFinite(t0) ? t0 : null,
          timeEndMs: Number.isFinite(t1) ? t1 : null,
          priceTop: Number.isFinite(Number(pTop)) ? Number(pTop) : null,
          priceBottom: Number.isFinite(Number(pBottom))
            ? Number(pBottom)
            : null,
        });
      };

      const handleCrosshairMove = (param) => {
        if (suppressCrosshairSyncRef.current) {
          suppressCrosshairSyncRef.current = false;
          return;
        }
        if (typeof onCrosshairSync !== "function") return;
        if (!param?.point || !param?.time) {
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

        onCrosshairSync({
          sourceId: chartId,
          active: true,
          time: param.time,
          price,
        });
      };

      chart.subscribeCrosshairMove(handleCrosshairMove);
      const chartElement = chart.chartElement();

      // --- Price line tooltip ---
      const priceLinesRef = { lines: [] };
      const tooltipEl = document.createElement("div");
      tooltipEl.style.cssText =
        `display:none;position:absolute;z-index:100;background:${theme.panel};color:${theme.text};padding:4px 8px;border-radius:4px;font-size:11px;pointer-events:none;white-space:nowrap;border:1px solid ${theme.border};`;
      chartElement.appendChild(tooltipEl);

      const handlePriceLineHover = (param) => {
        if (!param?.point || !candleSeries) {
          tooltipEl.style.display = "none";
          return;
        }
        const lines = priceLinesRef.lines;
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
        priceLinesRef.lines = []; // Clear previous price lines
        let snapshot = extractAnalysisSnapshot(analysisSnapshot);
        let snapshotBars = parseSnapshotBars(snapshot);
        let hasSnapshotBars = snapshotBars.length > 0;
        try {
          setLoading(true);
          let candles = [];
          if (historicalData && historicalData.length > 0) {
            candles = historicalData;
            setDataSource("historical");
          } else if (hasSnapshotBars) {
            candles = snapshotBars;
            setDataSource("snapshot");
          } else {
            // Check in-memory cache first (populated by chartFetchManager across page loads)
            const cachedEntry = chartFetchManager.get(symbol, interval);
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

          if (!candles.length) {
            console.warn(
              "No valid snapshot/Twelve bars available for this symbol/timeframe.",
            );
            setLoading(false);
            return;
          }

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
          const nextPrecision = inferPricePrecision(precisionCandidates);
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

            // --- MARKERS: creation/open/close markers ---
            const markers = [];
            const normalizedCloseStatus = String(closeStatus || "")
              .trim()
              .toUpperCase();
            const closeMarkerColor = ["TP"].includes(normalizedCloseStatus)
              ? "#10b981"
              : ["SL", "REJECTED", "FAIL", "ERROR", "CANCELLED"].includes(
                    normalizedCloseStatus,
                  )
                ? "#ef4444"
                : "#f59e0b";
            let createdTs = null;
            if (createdAt) {
              createdTs = Math.floor(new Date(createdAt).getTime() / 1000);
              if (Number.isFinite(createdTs)) {
                markers.push({
                  time: createdTs,
                  position: "belowBar",
                  color: "#9ca3af",
                  shape: "arrowUp",
                  text: "Created",
                });
                candleSeries.attachPrimitive(
                  new SignalCreationLinePrimitive(
                    createdTs,
                    "rgba(156, 163, 175, 0.45)",
                  ),
                );
              }
            }
            if (openedAt) {
              const openTs = Math.floor(new Date(openedAt).getTime() / 1000);
              const nearCreated =
                Number.isFinite(createdTs) &&
                Math.abs(openTs - createdTs) <= 60;
              if (nearCreated && markers.length) {
                markers[markers.length - 1] = {
                  ...markers[markers.length - 1],
                  color: "#60a5fa",
                  text: "Created/Open",
                };
              } else {
                markers.push({
                  time: openTs,
                  position: "belowBar",
                  color: "#2196f3",
                  shape: "arrowUp",
                  text: "Opened",
                });
              }
              const openedLine = new SignalCreationLinePrimitive(
                openTs,
                "rgba(33, 150, 243, 0.5)",
              );
              candleSeries.attachPrimitive(openedLine);
            }
            if (closedAt) {
              const closeTs = Math.floor(new Date(closedAt).getTime() / 1000);
              markers.push({
                time: closeTs,
                position: "aboveBar",
                color: closeMarkerColor,
                shape: "arrowDown",
                text: "Close",
              });
              candleSeries.attachPrimitive(
                new SignalCreationLinePrimitive(
                  closeTs,
                  closeMarkerColor === "#10b981"
                    ? "rgba(16, 185, 129, 0.45)"
                    : closeMarkerColor === "#ef4444"
                      ? "rgba(239, 68, 68, 0.45)"
                      : "rgba(245, 158, 11, 0.45)",
                ),
              );
            }

            // --- ENTRY / TP / SL for all plans ---
            const boxAnchorTs = openedAt
              ? Math.floor(new Date(openedAt).getTime() / 1000)
              : candles.length
                ? Number(candles[0]?.time)
                : null;

            const PLAN_COLORS = [
              "#2196f3", // Blue (Primary)
              "#a855f7", // Purple
              "#f59e0b", // Amber
              "#ec4899", // Pink
              "#10b981", // Emerald
            ];

            const levelPriceMap = { entry: null, tp: null, sl: null };

            const drawPlan = (p, index = 0) => {
              const ep = parsePosNum(p.entry);
              const sp = parsePosNum(p.sl);
              const tp = parsePosNum(p.tp);
              const tp1 = parsePosNum(p.tp1) ?? tp;
              const tp2 = parsePosNum(p.tp2);
              const tp3 = parsePosNum(p.tp3);
              if (!ep) return;

              const isPrimary = index === 0;
              const dir = String(p.direction || "").toUpperCase();
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
              const actionLabel = isBuy ? "Buy" : "Sell";

              // Standard colors
              const greenColor = "#26a69a";
              const redColor = "#ef5350";

              const alpha = isPrimary ? 1.0 : 0.6;
              const lineWidth = isPrimary ? 2 : 1;

              // Entry line: solid
              candleSeries.createPriceLine({
                price: ep,
                color: isPrimary ? "#d1d4dc" : "rgba(209, 212, 220, 0.6)",
                lineWidth,
                lineStyle: 0,
                axisLabelVisible: true,
                title: actionLabel,
              });
              priceLinesRef.lines.push({
                price: ep,
                label: actionLabel,
                priceText: formatPriceWithPrecision(
                  ep,
                  pricePrecisionRef.current,
                ),
              });
              if (isPrimary) levelPriceMap.entry = ep;
              // SL line: dashed, always RED
              if (sp) {
                candleSeries.createPriceLine({
                  price: sp,
                  color: `rgba(239, 83, 80, ${alpha})`,
                  lineWidth,
                  lineStyle: 2,
                  axisLabelVisible: true,
                  title: "SL",
                });
                priceLinesRef.lines.push({
                  price: sp,
                  label: "SL",
                  priceText: formatPriceWithPrecision(
                    sp,
                    pricePrecisionRef.current,
                  ),
                });
              }
              if (isPrimary && sp) levelPriceMap.sl = sp;
              const tpLineLevels = [
                { key: "TP1", value: tp1 ?? tp, lineAlpha: alpha },
                { key: "TP2", value: tp2, lineAlpha: alpha * 0.78 },
                { key: "TP3", value: tp3, lineAlpha: alpha * 0.58 },
              ].filter((x) => Number.isFinite(x.value));
              tpLineLevels.forEach((lvl) => {
                candleSeries.createPriceLine({
                  price: Number(lvl.value),
                  color: `rgba(38, 166, 154, ${Math.max(0.28, Math.min(1, lvl.lineAlpha))})`,
                  lineWidth,
                  lineStyle: 1,
                  axisLabelVisible: true,
                  title: lvl.key,
                });
                priceLinesRef.lines.push({
                  price: Number(lvl.value),
                  label: lvl.key,
                  priceText: formatPriceWithPrecision(
                    Number(lvl.value),
                    pricePrecisionRef.current,
                  ),
                });
              });
              if (isPrimary)
                levelPriceMap.tp = tp1 ?? tp ?? tp2 ?? tp3 ?? levelPriceMap.tp;
              if (isPrimary) {
                if (Number.isFinite(tp1 ?? tp)) levelPriceMap.tp1 = tp1 ?? tp;
                if (Number.isFinite(tp2)) levelPriceMap.tp2 = tp2;
                if (Number.isFinite(tp3)) levelPriceMap.tp3 = tp3;
              }

              // Entry → TP zone box: Reward zone = Green
              if (ep && tp && boxAnchorTs) {
                const primitive = new PdArrayBoxPrimitive(
                  boxAnchorTs,
                  Math.min(ep, tp),
                  Math.max(ep, tp),
                  greenColor,
                );
                candleSeries.attachPrimitive(primitive);
              }
              // Entry → TP1, TP1 → TP2, TP2 → TP3 zones with decreasing opacity.
              if (boxAnchorTs && Number.isFinite(tp1)) {
                const tpZones = [
                  [ep, tp1, 0.24],
                  [tp1, tp2, 0.16],
                  [tp2, tp3, 0.1],
                ];
                tpZones.forEach(([a, b, zoneAlpha]) => {
                  if (!Number.isFinite(a) || !Number.isFinite(b)) return;
                  const primitive = new PdArrayBoxPrimitive(
                    boxAnchorTs,
                    Math.min(a, b),
                    Math.max(a, b),
                    `rgba(38, 166, 154, ${Math.max(0.05, Math.min(0.5, zoneAlpha * alpha))})`,
                  );
                  candleSeries.attachPrimitive(primitive);
                });
              }
              // Entry → SL zone box: Risk zone = Red
              if (ep && sp && boxAnchorTs) {
                const primitive = new PdArrayBoxPrimitive(
                  boxAnchorTs,
                  Math.min(ep, sp),
                  Math.max(ep, sp),
                  redColor,
                );
                candleSeries.attachPrimitive(primitive);
              }
            };

            // Get all plans: manual one + analysis ones
            const allPlans = [];

            const rawPlans = Array.isArray(snapshot?.trade_plan)
              ? snapshot.trade_plan
              : Array.isArray(snapshot?.trade_plans)
                ? snapshot.trade_plans
                : Array.isArray(snapshot?.tradePlans)
                  ? snapshot.tradePlans
                  : [];

            // Helper to check if a plan roughly matches an existing one
            const isMatching = (p1, p2) => {
              const e1 = Number(p1.entry),
                e2 = Number(p2.entry);
              const t1 = Number(p1.tp),
                t2 = Number(p2.tp);
              if (!e1 || !e2) return false;
              // Proximity check (0.01% difference allowed)
              const entryMatch = Math.abs(e1 - e2) / Math.max(e1, e2) < 0.0001;
              const tpMatch =
                t1 && t2 ? Math.abs(t1 - t2) / Math.max(t1, t2) < 0.0001 : true;
              return entryMatch && tpMatch;
            };

            if (showPrimaryPlan && entryPrice) {
              const primaryTp = normalizePlanLinePrice(tpPrice);
              const primaryTp1 =
                normalizePlanLinePrice(tp1Price) ?? primaryTp;
              const primaryTp2 = normalizePlanLinePrice(tp2Price);
              const primaryTp3 = normalizePlanLinePrice(tp3Price);
              const primary = {
                entry: entryPrice,
                sl: slPrice,
                tp: primaryTp,
                tp1: primaryTp1,
                tp2: primaryTp2 ?? undefined,
                tp3: primaryTp3 ?? undefined,
                direction: primaryTp > Number(entryPrice) ? "BUY" : "SELL",
              };
              allPlans.push(primary);
            }

            if (showExtraPlans) {
              rawPlans.forEach((p) => {
                const ep = Number(p.entry);
                if (!ep) return;
                // Avoid duplicate of primary if already added
                const isDuplicate = allPlans.some((x) => isMatching(x, p));
                if (!isDuplicate) allPlans.push(p);
              });
            }

            allPlans.forEach((p, idx) => drawPlan(p, idx));

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
              });
            }

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
                  candleSeries.createPriceLine({
                    price,
                    color: lineColor,
                    lineWidth,
                    lineStyle,
                    axisLabelVisible: true,
                    title: label || `L${idx + 1}`,
                  });
                  priceLinesRef.lines.push({
                    price,
                    label: label || `L${idx + 1}`,
                    priceText: price.toFixed(2),
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
                      shape: "circle",
                      text: label || obj.type || "Point",
                    });
                  } else if (Number.isFinite(price)) {
                    candleSeries.createPriceLine({
                      price,
                      color: lineColor,
                      lineWidth,
                      lineStyle,
                      axisLabelVisible: true,
                      title: label || obj.type || `P${idx + 1}`,
                    });
                    priceLinesRef.lines.push({
                      price,
                      label: label || obj.type || `P${idx + 1}`,
                      priceText: price.toFixed(2),
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
                  candleSeries.attachPrimitive(
                    new TimeRangeBoxPrimitive({
                      startTimeSec,
                      endTimeSec,
                      priceLow: Math.min(top, bottom),
                      priceHigh: Math.max(top, bottom),
                      lineColor,
                      fillColor:
                        String(obj.bg_color || "").trim() || `${lineColor}22`,
                      extendRight: !Number.isFinite(endTimeSec),
                    }),
                  );
                  return;
                }
              });
            }

            if (markers.length > 0) candleSeries.setMarkers(markers);

            const enableLevelDrag =
              typeof onPlanLevelChange === "function" &&
              Number.isFinite(levelPriceMap.entry) &&
              (Number.isFinite(levelPriceMap.tp) ||
               Number.isFinite(levelPriceMap.tp1) ||
               Number.isFinite(levelPriceMap.tp2) ||
               Number.isFinite(levelPriceMap.tp3)) &&
              Number.isFinite(levelPriceMap.sl);

            const pickNearestLevel = (mouseY) => {
              const candidates = [
                { key: "entry", price: levelPriceMap.entry },
                { key: "tp1", price: levelPriceMap.tp1 ?? levelPriceMap.tp },
                { key: "tp2", price: levelPriceMap.tp2 },
                { key: "tp3", price: levelPriceMap.tp3 },
                { key: "sl", price: levelPriceMap.sl },
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

            // --- VIEWPORT --- restore saved state if available, otherwise
            // default to the full loaded candle span. Snapshot bar_start/bar_end
            // can be intentionally tight around the event window, which makes
            // lower timeframes open zoomed into only a few bars even when we
            // already loaded a much larger broker/cache series.
            if (
              initialViewport &&
              Number.isFinite(Number(initialViewport.timeStartMs)) &&
              Number.isFinite(Number(initialViewport.timeEndMs))
            ) {
              const from = Number(initialViewport.timeStartMs) / 1000;
              const to = Number(initialViewport.timeEndMs) / 1000;
              if (from > 0 && to > from) {
                chart.timeScale().setVisibleRange({ from, to });
              }
            } else {
              const loadedStart = toEpochSec(candles[0]?.time);
              const loadedEnd = toEpochSec(candles[candles.length - 1]?.time);
              const prevLoadedEnd =
                candles.length > 1
                  ? toEpochSec(candles[candles.length - 2]?.time)
                  : null;
              if (
                Number.isFinite(loadedStart) &&
                Number.isFinite(loadedEnd) &&
                loadedEnd > loadedStart
              ) {
                const inferredBarSec =
                  Number.isFinite(prevLoadedEnd) && loadedEnd > prevLoadedEnd
                    ? loadedEnd - prevLoadedEnd
                    : Math.max(
                        60,
                        Math.round((loadedEnd - loadedStart) / Math.max(1, candles.length - 1)),
                      );
                const dur = loadedEnd - loadedStart;
                const pad = Math.max(inferredBarSec * 2, dur * 0.04);
                chart.timeScale().setVisibleRange({
                  from: loadedStart - pad,
                  to: loadedEnd + pad,
                });
              } else {
                const snapshotStart = Number(snapshot?.bar_start);
                const snapshotEnd = Number(snapshot?.bar_end);
                if (
                  Number.isFinite(snapshotStart) &&
                  Number.isFinite(snapshotEnd) &&
                  snapshotEnd > snapshotStart
                ) {
                  const dur = snapshotEnd - snapshotStart;
                  chart.timeScale().setVisibleRange({
                    from: snapshotStart - dur * 0.06,
                    to: snapshotEnd + dur * 0.06,
                  });
                } else if (createdAt) {
                const rangeStart = Math.floor(
                  new Date(createdAt).getTime() / 1000,
                );
                const rangeEndRaw = closedAt || openedAt;
                const rangeEnd = rangeEndRaw
                  ? Math.floor(new Date(rangeEndRaw).getTime() / 1000)
                  : rangeStart + 86400;
                const dur = Math.max(rangeEnd - rangeStart, 3600);
                chart.timeScale().setVisibleRange({
                  from: rangeStart - dur * 0.1,
                  to: rangeEnd + dur * 0.1,
                });
                } else if (openedAt && closedAt) {
                  const rangeStart = Math.floor(
                    new Date(openedAt).getTime() / 1000,
                  );
                  const rangeEnd = Math.floor(
                    new Date(closedAt).getTime() / 1000,
                  );
                  const dur = rangeEnd - rangeStart;
                  chart.timeScale().setVisibleRange({
                    from: rangeStart - dur * 0.2,
                    to: rangeEnd + dur * 0.2,
                  });
                } else {
                  chart.timeScale().fitContent();
                }
              }
            }
            requestAnimationFrame(() => {
              emitViewport();
            });
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
        window.removeEventListener("resize", onWindowResize);
        if (resizeObserver) resizeObserver.disconnect();
        try {
          chart.unsubscribeCrosshairMove(handleCrosshairMove);
        } catch {}
        removeDragListeners();
        removeContextMenuListener();
        try {
          tooltipEl.remove();
        } catch {}
        chartRef.current = null;
        seriesRef.current = null;
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
    height,
    openedAt,
    createdAt,
    closedAt,
    closeStatus,
    entryPrice,
    slPrice,
    tpPrice,
    tp1Price,
    tp2Price,
    tp3Price,
    showPrimaryPlan,
    showExtraPlans,
    showPdArrays,
    showKeyLevels,
    onPlanLevelChange,
    JSON.stringify(sharedLines || []),
    JSON.stringify(sharedObjects || []),
    JSON.stringify(analysisSnapshot),
    JSON.stringify(historicalData),
    live,
    onContextRequest,
    onViewportChange,
    chartId,
    lwTimeToMs,
    displayTimezone,
    getUiThemeColors().mode,
  ]);

  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;
    if (!syncedCrosshair || syncedCrosshair.sourceId === chartId) return;

    if (!syncedCrosshair.active || !syncedCrosshair.time) {
      suppressCrosshairSyncRef.current = true;
      try { chartRef.current.clearCrosshairPosition(); } catch {}
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
    } catch {
      // chart may be in a torn-down state during rapid re-renders
    }
  }, [chartId, syncedCrosshair]);

  return (
    <div
      className="chart-wrapper"
      style={{
        position: "relative",
        width: "100%",
        height: typeof height === "number" ? `${height}px` : height,
      }}
    >
      {loading && (
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
      <div
        ref={chartContainerRef}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      />
      <button
        type="button"
        aria-label={`Open ${tvSymbol} ${interval} in TradingView`}
        title={`Open ${tvSymbol} ${interval} in TradingView`}
        onClick={() => {
          const url = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}&interval=${encodeURIComponent(tvInterval)}`;
          window.open(url, "_blank", "noopener,noreferrer");
        }}
        style={{
          position: "absolute",
          left: 8,
          bottom: 8,
          width: 34,
          height: 24,
          padding: 0,
          border: "none",
          borderRadius: 4,
          background: "transparent",
          cursor: "pointer",
          zIndex: 12,
        }}
      />
    </div>
  );
}
