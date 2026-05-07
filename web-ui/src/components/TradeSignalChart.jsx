import React, { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";
import { asNumValue, showDateTime } from "../utils/format";
import { chartFetchManager } from "../services/chartFetchManager";

const parsePosNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

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
  createdAt = null,
  openedAt = null,
  closedAt = null,
  analysisSnapshot = null,
  showPrimaryPlan = true,
  showExtraPlans = true,
  showPdArrays = true,
  showKeyLevels = true,
  onPlanLevelChange = null,
  syncedCrosshair = null,
  onCrosshairSync = null,
}) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const suppressCrosshairSyncRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [dataSource, setDataSource] = useState("");

  useEffect(() => {
    if (!chartContainerRef.current) return;
    const container = chartContainerRef.current;
    if (!container.clientWidth || !container.clientHeight) return;

    let isMounted = true;
    let chart;

    try {
      // 1. Initialize Chart
      chart = createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight || height,
        layout: {
          background: { color: "#0d1117" },
          textColor: "#d1d4dc",
        },
        grid: {
          vertLines: { color: "rgba(42, 46, 57, 0.1)" },
          horzLines: { color: "rgba(42, 46, 57, 0.1)" },
        },
        timeScale: {
          borderColor: "rgba(197, 203, 206, 0.4)",
          timeVisible: true,
          secondsVisible: false,
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

      let resizeObserver = null;
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(chartContainerRef.current);
      }
      window.addEventListener("resize", handleResize);

      const candleSeries = chart.addCandlestickSeries({
        upColor: "#26a69a",
        downColor: "#ef5350",
        borderVisible: false,
        wickUpColor: "#26a69a",
        wickDownColor: "#ef5350",
      });

      chartRef.current = chart;
      seriesRef.current = candleSeries;

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
      const dragState = { activeKey: null };
      let removeDragListeners = () => {};

      // 3. Fetch History + Start Live
      async function initData() {
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
              snapshot = { ...snapshot, bar_start: cachedEntry.bar_start, bar_end: cachedEntry.bar_end };
              snapshotBars = candles;
              hasSnapshotBars = true;
              setDataSource("cache");
            } else {
            // Try Twelve Data on-demand (for old trades without stored snapshot)
            try {
              // FALLBACK: 'ENTRY' is not a real timeframe for API. Use signal interval or '15m'
              const apiTf =
                String(interval).toUpperCase() === "ENTRY" ? "15m" : interval;
              // NORMALIZE SYMBOL: Twelve Data usually wants BTCUSD not BTC/USD
              const apiSym = String(symbol || "").replace(/[\/\s:]/g, "");

              if (!apiSym) {
                setLoading(false);
                return;
              }
              const r = await fetch(
                `/v2/chart/twelve/candles?symbol=${encodeURIComponent(apiSym)}&timeframe=${encodeURIComponent(apiTf || "15m")}&bars=300`,
                {
                  credentials: "include",
                  cache: "no-store",
                },
              );
              const j = await r.json().catch(() => ({}));
              const snap =
                j?.snapshot && typeof j.snapshot === "object"
                  ? j.snapshot
                  : null;
              const bars = parseSnapshotBars(snap);
              if (r.ok && bars.length > 0) {
                // Merge: keep original snapshot analysis (plans, levels) but use new bars
                snapshot = { ...snapshot, ...(snap || {}) };
                snapshotBars = bars;
                hasSnapshotBars = true;
                candles = bars;
                setDataSource("twelve");
              }
            } catch {
              // Twelve fetch failed
            }
            } // end cache-check else
          }

          if (!candles.length) {
            console.warn(
              "No snapshot/Twelve bars available for this symbol/timeframe.",
            );
            setLoading(false);
            return;
          }

          if (isMounted) {
            candleSeries.setData(candles);

            // --- MARKERS: creation/open/close arrows, NO text overlays ---
            const markers = [];
            let createdTs = null;
            if (createdAt) {
              createdTs = Math.floor(new Date(createdAt).getTime() / 1000);
              if (Number.isFinite(createdTs)) {
                markers.push({
                  time: createdTs,
                  position: "belowBar",
                  color: "#9ca3af",
                  shape: "arrowUp",
                  text: "",
                });
              }
            }
            if (openedAt) {
              const openTs = Math.floor(new Date(openedAt).getTime() / 1000);
              const nearCreated =
                Number.isFinite(createdTs) &&
                Math.abs(openTs - createdTs) <= 60;
              if (!nearCreated) {
                markers.push({
                  time: openTs,
                  position: "belowBar",
                  color: "#2196f3",
                  shape: "arrowUp",
                  text: "",
                });
              }

              // Vertical line at creation
              const creationLine = new SignalCreationLinePrimitive(
                openTs,
                "rgba(33, 150, 243, 0.5)",
              );
              candleSeries.attachPrimitive(creationLine);
            }
            if (closedAt) {
              const closeTs = Math.floor(new Date(closedAt).getTime() / 1000);
              markers.push({
                time: closeTs,
                position: "aboveBar",
                color: "#f68410",
                shape: "arrowDown",
                text: "",
              });
            }
            if (markers.length > 0) candleSeries.setMarkers(markers);

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
              if (!ep) return;

              const isPrimary = index === 0;
              const isBuy =
                String(p.direction || "").toUpperCase() === "SELL"
                  ? false
                  : true;
              const actionLabel = isBuy ? "Buy" : "Sell";
              const pNum = index + 1;

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
                title: `${actionLabel}${pNum}`,
              });
              if (isPrimary) levelPriceMap.entry = ep;
              // SL line: dashed, always RED
              if (sp)
                candleSeries.createPriceLine({
                  price: sp,
                  color: `rgba(239, 83, 80, ${alpha})`,
                  lineWidth,
                  lineStyle: 2,
                  axisLabelVisible: true,
                  title: `SL${pNum}`,
                });
              if (isPrimary && sp) levelPriceMap.sl = sp;
              // TP line: dotted, always GREEN
              if (tp)
                candleSeries.createPriceLine({
                  price: tp,
                  color: `rgba(38, 166, 154, ${alpha})`,
                  lineWidth,
                  lineStyle: 1,
                  axisLabelVisible: true,
                  title: `TP${pNum}`,
                });
              if (isPrimary && tp) levelPriceMap.tp = tp;

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
              const primary = {
                entry: entryPrice,
                sl: slPrice,
                tp: tpPrice,
                direction: tpPrice > entryPrice ? "BUY" : "SELL",
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

            const enableLevelDrag =
              typeof onPlanLevelChange === "function" &&
              Number.isFinite(levelPriceMap.entry) &&
              Number.isFinite(levelPriceMap.tp) &&
              Number.isFinite(levelPriceMap.sl);

            const pickNearestLevel = (mouseY) => {
              const candidates = [
                { key: "entry", price: levelPriceMap.entry },
                { key: "tp", price: levelPriceMap.tp },
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

            // --- FIT VIEW ---
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
                : rangeStart + 86400; // fallback: +1 day
              const dur = Math.max(rangeEnd - rangeStart, 3600);
              chart.timeScale().setVisibleRange({
                from: rangeStart - dur * 0.1,
                to: rangeEnd + dur * 0.1,
              });
            } else if (openedAt && closedAt) {
              const rangeStart = Math.floor(
                new Date(openedAt).getTime() / 1000,
              );
              const rangeEnd = Math.floor(new Date(closedAt).getTime() / 1000);
              const dur = rangeEnd - rangeStart;
              chart.timeScale().setVisibleRange({
                from: rangeStart - dur * 0.2,
                to: rangeEnd + dur * 0.2,
              });
            }
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
        window.removeEventListener("resize", handleResize);
        if (resizeObserver) resizeObserver.disconnect();
        try {
          chart.unsubscribeCrosshairMove(handleCrosshairMove);
        } catch {}
        removeDragListeners();
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
    entryPrice,
    slPrice,
    tpPrice,
    showPrimaryPlan,
    showExtraPlans,
    showPdArrays,
    showKeyLevels,
    onPlanLevelChange,
    JSON.stringify(analysisSnapshot),
    JSON.stringify(historicalData),
    live,
  ]);

  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;
    if (!syncedCrosshair || syncedCrosshair.sourceId === chartId) return;

    if (!syncedCrosshair.active || !syncedCrosshair.time) {
      suppressCrosshairSyncRef.current = true;
      chartRef.current.clearCrosshairPosition();
      return;
    }

    if (!Number.isFinite(Number(syncedCrosshair.price))) return;

    suppressCrosshairSyncRef.current = true;
    chartRef.current.setCrosshairPosition(
      Number(syncedCrosshair.price),
      syncedCrosshair.time,
      seriesRef.current,
    );
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
    </div>
  );
}
