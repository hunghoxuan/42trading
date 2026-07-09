import { useEffect, useMemo, useRef, useState } from "react";
import {
  BACKTEST_CHART_THEME,
  buildSingleTradeForChart,
  buildTradeCreatedLabel,
  buildTradeCloseLabel,
  buildTradeOpenedLabel,
  computePriceBoundsFromBars,
  inferTradeSide,
  isPriceCompatibleWithBarBounds,
  normalizeTradeRowsForChart,
  resolveTradeFocusedWindow,
  resolveTradeBadgeMeta,
  resolveTradeCloseDisplayPrice,
  resolveClosedTradeLineStyle,
  resolveTradeLinePalette,
  resolveTradeMarkerPresentation,
  toTradePriceNumber,
} from "./backtestChartTheme";

function toUnixSec(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) return Math.floor(value / 1000);
    if (value > 1e9) return Math.floor(value);
  }
  const ms = new Date(value || 0).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms / 1000);
}

function ensureBars(bars = []) {
  if (!Array.isArray(bars)) return [];
  return bars
    .map((row) => {
      const time = Number(row?.time ?? row?.t);
      const open = Number(row?.open ?? row?.o);
      const high = Number(row?.high ?? row?.h);
      const low = Number(row?.low ?? row?.l);
      const close = Number(row?.close ?? row?.c);
      if (
        !Number.isFinite(time) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        return null;
      }
      return { time, open, high, low, close };
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

function buildLineSeriesFromBars(bars, period = 20) {
  if (!Array.isArray(bars) || bars.length < period) return [];
  const out = [];
  let sum = 0;
  for (let index = 0; index < bars.length; index += 1) {
    const close = Number(bars[index]?.close);
    if (!Number.isFinite(close)) continue;
    sum += close;
    if (index >= period) {
      sum -= Number(bars[index - period]?.close) || 0;
    }
    if (index >= period - 1) {
      out.push({
        time: bars[index].time,
        value: sum / period,
      });
    }
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
  const out = [
    {
      time: bars[period].time,
      value:
        avgLoss === 0
          ? 100
          : Math.max(0, Math.min(100, 100 - 100 / (1 + avgGain / avgLoss))),
    },
  ];
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
  return {
    sma20: buildLineSeriesFromBars(bars, 20),
    sma50: buildLineSeriesFromBars(bars, 50),
    sma200: buildLineSeriesFromBars(bars, 200),
    rsi: safeRsi,
    rsiEma9: rsiEma9.length ? rsiEma9 : buildFallbackOscillatorSeries(bars, 9, 0.75),
    rsiWma45: rsiWma45.length ? rsiWma45 : buildFallbackOscillatorSeries(bars, 7, 1.35),
  };
}

const INDICATOR_COLORS = {
  sma20: "#60a5fa",
  sma50: "#f97316",
  sma200: "#22c55e",
  rsi: "#a855f7",
  rsiEma9: "#facc15",
  rsiWma45: "#34d399",
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function intervalToSecondsFromBars(bars = []) {
  if (!Array.isArray(bars) || bars.length < 2) return 60;
  let best = null;
  for (let index = 1; index < bars.length; index += 1) {
    const prev = Number(bars[index - 1]?.time);
    const next = Number(bars[index]?.time);
    const delta = next - prev;
    if (Number.isFinite(delta) && delta > 0) {
      best = best == null ? delta : Math.min(best, delta);
    }
  }
  return Math.max(60, Number(best) || 60);
}

function snapTimeToNearestBar(bars = [], targetSec = null) {
  const target = Number(targetSec);
  if (!Array.isArray(bars) || !bars.length || !Number.isFinite(target)) {
    return null;
  }
  let bestTime = null;
  let bestDistance = Infinity;
  for (const bar of bars) {
    const time = Number(bar?.time);
    if (!Number.isFinite(time)) continue;
    const distance = Math.abs(time - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTime = time;
    }
  }
  return Number.isFinite(bestTime) ? bestTime : null;
}

function resolveEventMarkerTimeSec(bars = [], targetSec = null) {
  const target = Number(targetSec);
  if (!Array.isArray(bars) || !bars.length || !Number.isFinite(target)) {
    return null;
  }
  const intervalSec = intervalToSecondsFromBars(bars);
  const minTime = Number(bars[0]?.time);
  const maxTime = Number(bars[bars.length - 1]?.time);
  if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) return null;
  const outsideTolerance = Math.max(intervalSec, 60);
  if (target < minTime - outsideTolerance || target > maxTime + outsideTolerance) {
    return null;
  }
  const snapped = snapTimeToNearestBar(bars, target);
  if (!Number.isFinite(snapped)) return null;
  const snapTolerance = Math.max(60, Math.round(intervalSec * 0.75));
  return Math.abs(snapped - target) <= snapTolerance ? snapped : null;
}

function closeToneColor(closeStatus, pnl = null) {
  const status = String(closeStatus || "").trim().toUpperCase();
  if (["SL", "FAIL", "LOSS", "STOPPED", "CANCELLED", "REJECTED"].includes(status)) {
    return BACKTEST_CHART_THEME.loss;
  }
  if (["TP", "WIN", "CLOSED", "FILLED"].includes(status)) {
    return BACKTEST_CHART_THEME.profit;
  }
  const pnlNum = Number(pnl);
  if (Number.isFinite(pnlNum)) {
    return pnlNum >= 0
      ? BACKTEST_CHART_THEME.profit
      : BACKTEST_CHART_THEME.loss;
  }
  return "#cbd5e1";
}

function resolveSvgCloseDisplayPrice(source = {}, barBounds = null) {
  const rawExitPrice = toTradePriceNumber(source?.exitPrice ?? source?.exit_price);
  const exitLooksValid =
    rawExitPrice != null &&
    (!barBounds || isPriceCompatibleWithBarBounds(rawExitPrice, barBounds));
  return resolveTradeCloseDisplayPrice({
    closeStatus: source?.closeStatus ?? source?.result ?? "",
    pnlRealized: source?.pnlRealized ?? source?.pnl_realized ?? null,
    exitPrice: exitLooksValid ? rawExitPrice : null,
    tpPrice: source?.tpPrice ?? source?.tp ?? null,
    slPrice: source?.slPrice ?? source?.sl ?? null,
  });
}

function formatAxisPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return Math.abs(num) >= 1000 ? num.toFixed(2) : num.toFixed(5);
}

function resolveClosedTradeLine(trade = null, fallback = {}, barBounds = null) {
  const source = trade && typeof trade === "object" ? trade : fallback;
  const hasClosedEvent = Boolean(
    source?.closedAt ||
      source?.closed_at ||
      (Number.isFinite(Number(source?.closedAtSec)) &&
        Number(source?.closedAtSec) > 0) ||
      (Number.isFinite(Number(source?.closed_at_sec)) &&
        Number(source?.closed_at_sec) > 0),
  );
  if (!hasClosedEvent) return null;
  return resolveClosedTradeLineStyle(source, barBounds);
}

export default function ChartSVG({
  bars = [],
  side = null,
  action = null,
  isBuy = null,
  entryPrice = null,
  tpPrice = null,
  tp1Price = null,
  slPrice = null,
  barsCount = 300,
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
  height = 440,
  showLegend = true,
  showIndicators = false,
  indicatorVisibilityConfig = null,
  className = "",
  style = null,
}) {
  const rootRef = useRef(null);
  const [width, setWidth] = useState(900);
  const safeBars = useMemo(() => ensureBars(bars), [bars]);
  const normalizedTrades = useMemo(
    () => normalizeTradeRowsForChart(trades, tradeLabel),
    [tradeLabel, trades],
  );

  const singleTrade = useMemo(() => {
    if (normalizedTrades.length > 0) return null;
    return buildSingleTradeForChart({
      side,
      action,
      isBuy,
      entryPrice,
      tpPrice,
      tp1Price,
      slPrice,
      exitPrice,
      openedAt,
      closedAt,
      createdAt,
      openedAtSec,
      closedAtSec,
      createdAtSec,
      pnlRealized,
      closeStatus,
      tradeLabel,
    });
  }, [
    action,
    closeStatus,
    createdAt,
    createdAtSec,
    entryPrice,
    exitPrice,
    isBuy,
    normalizedTrades.length,
    openedAt,
    openedAtSec,
    closedAt,
    closedAtSec,
    pnlRealized,
    side,
    slPrice,
    tpPrice,
    tp1Price,
    tradeLabel,
  ]);

  const effectiveTrades = normalizedTrades.length > 0 ? normalizedTrades : singleTrade ? [singleTrade] : [];
  const indicatorVisibility = indicatorVisibilityConfig || {};
  const selectedTrade = useMemo(
    () =>
      effectiveTrades.find((trade) => String(trade.sid) === String(selectedTradeSid || "")) ||
      effectiveTrades[0] ||
      null,
    [effectiveTrades, selectedTradeSid],
  );

  useEffect(() => {
    if (!rootRef.current) return undefined;
    const updateWidth = () => {
      const nextWidth = rootRef.current?.clientWidth || 0;
      if (nextWidth > 0) setWidth(nextWidth);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  const visibleBars = useMemo(() => {
    if (!safeBars.length) return [];
    const requested = Math.max(40, Number(barsCount) || 300);
    if (!selectedTrade) return safeBars.slice(-requested);
    const createdSec =
      (Number.isFinite(Number(selectedTrade.createdAtSec)) &&
      Number(selectedTrade.createdAtSec) > 0
        ? Number(selectedTrade.createdAtSec)
        : null) ?? toUnixSec(selectedTrade.createdAt);
    const openedSec =
      (Number.isFinite(Number(selectedTrade.openedAtSec)) &&
      Number(selectedTrade.openedAtSec) > 0
        ? Number(selectedTrade.openedAtSec)
        : null) ?? toUnixSec(selectedTrade.openedAt);
    const closeSec =
      (Number.isFinite(Number(selectedTrade.closedAtSec)) &&
      Number(selectedTrade.closedAtSec) > 0
        ? Number(selectedTrade.closedAtSec)
        : null) ?? toUnixSec(selectedTrade.closedAt);
    const firstAnchorSec = createdSec ?? openedSec ?? closeSec;
    const lastAnchorSec = closeSec ?? null;
    const windowRange = resolveTradeFocusedWindow(safeBars, requested, {
      firstAnchorTimeSec: firstAnchorSec,
      lastAnchorTimeSec: lastAnchorSec,
    });
    if (!windowRange) return safeBars.slice(-requested);
    return safeBars.slice(windowRange.from, windowRange.to + 1);
  }, [safeBars, barsCount, selectedTrade]);

  const plottedBars = useMemo(() => {
    if (visibleBars.length <= 320) return visibleBars;
    const stride = Math.ceil(visibleBars.length / 320);
    return visibleBars.filter((_, index) => index % stride === 0 || index === visibleBars.length - 1);
  }, [visibleBars]);
  const plottedBarBounds = useMemo(
    () => computePriceBoundsFromBars(plottedBars),
    [plottedBars],
  );

  const markers = useMemo(() => {
    const all = [];
    effectiveTrades.forEach((trade, index) => {
      const created =
        (Number.isFinite(Number(trade.createdAtSec)) &&
        Number(trade.createdAtSec) > 0
          ? Number(trade.createdAtSec)
          : null) ?? toUnixSec(trade.createdAt);
      const hasOpenedEvent = Boolean(
        trade.openedAt ||
          (Number.isFinite(Number(trade.openedAtSec)) &&
            Number(trade.openedAtSec) > 0),
      );
      const opened =
        hasOpenedEvent
          ? (Number.isFinite(Number(trade.openedAtSec)) &&
            Number(trade.openedAtSec) > 0
              ? Number(trade.openedAtSec)
              : null) ?? toUnixSec(trade.openedAt)
          : null;
      const hasClosedEvent = Boolean(
        trade.closedAt ||
          (Number.isFinite(Number(trade.closedAtSec)) &&
            Number(trade.closedAtSec) > 0),
      );
      const closed =
        hasClosedEvent
          ? (Number.isFinite(Number(trade.closedAtSec)) &&
            Number(trade.closedAtSec) > 0
              ? Number(trade.closedAtSec)
              : null) ?? toUnixSec(trade.closedAt)
          : null;
      const isSelected = String(trade.sid) === String(selectedTradeSid || "");
      const closeBadge = resolveTradeBadgeMeta({
        side: trade.side,
        closeStatus: trade.closeStatus,
        pnlRealized: trade.pnlRealized,
        kind: "close",
      });
      const createdTs = resolveEventMarkerTimeSec(plottedBars, created);
      const openedTs = resolveEventMarkerTimeSec(plottedBars, opened);
      const resolvedClosePrice = resolveSvgCloseDisplayPrice(
        trade,
        plottedBarBounds,
      );
      const closedTs = resolveEventMarkerTimeSec(plottedBars, closed);
      if (
        createdTs &&
        Number.isFinite(Number(trade.entry)) &&
        (!openedTs || Math.abs(openedTs - createdTs) > 60)
      ) {
        const createdMarkerStyle = resolveTradeMarkerPresentation({
          side: trade.side,
          kind: "created",
        });
        all.push({
          key: `${trade.sid}-created`,
          time: createdTs,
          price: trade.entry,
          color: resolveTradeBadgeMeta({ side: trade.side, kind: "open" }).color,
          text: buildTradeCreatedLabel(trade.tradeLabel || tradeLabel, trade.side),
          shape: "badge",
          anchorShape: createdMarkerStyle.svgAnchorShape,
          placement: createdMarkerStyle.svgBadgePlacement,
          selected: isSelected,
        });
      }
      if (openedTs && Number.isFinite(Number(trade.entry))) {
        const openedMarkerStyle = resolveTradeMarkerPresentation({
          side: trade.side,
          kind: "opened",
        });
        all.push({
          key: `${trade.sid}-open`,
          time: openedTs,
          price: trade.entry,
          color: "#64748b",
          text: buildTradeOpenedLabel(),
          shape: "badge",
          anchorShape: openedMarkerStyle.svgAnchorShape,
          placement: openedMarkerStyle.svgBadgePlacement,
          selected: isSelected,
        });
      }
      if (closedTs && Number.isFinite(Number(resolvedClosePrice))) {
        const closeMarkerStyle = resolveTradeMarkerPresentation({
          side: trade.side,
          closeStatus: trade.closeStatus,
          pnlRealized: trade.pnlRealized,
          kind: "close",
        });
        all.push({
          key: `${trade.sid}-close`,
          time: closedTs,
          price: resolvedClosePrice,
          color: closeBadge.color,
          text: buildTradeCloseLabel(
            trade.pnlRealized,
            trade.closeStatus,
            resolvedClosePrice,
            {
              rMultiple: trade.rMultiple,
              entryPrice: trade.entry,
              exitPrice: resolvedClosePrice,
              tpPrice: trade.tp,
              slPrice: trade.sl,
              side: trade.side,
            },
          ),
          shape: "badge",
          anchorShape: closeMarkerStyle.svgAnchorShape,
          placement: closeMarkerStyle.svgBadgePlacement,
          selected: isSelected,
        });
      }
    });

    if (normalizedTrades.length === 0 && !singleTrade) {
      const resolvedSide = inferTradeSide({
        side,
        action,
        isBuy,
        entryPrice,
        tpPrice: tpPrice ?? tp1Price,
        slPrice,
      });
      const created =
        (Number.isFinite(Number(createdAtSec)) && Number(createdAtSec) > 0
          ? Number(createdAtSec)
          : null) ?? toUnixSec(createdAt);
      const hasOpenedEvent = Boolean(
        openedAt ||
          (Number.isFinite(Number(openedAtSec)) && Number(openedAtSec) > 0),
      );
      const opened =
        hasOpenedEvent
          ? (Number.isFinite(Number(openedAtSec)) && Number(openedAtSec) > 0
              ? Number(openedAtSec)
              : null) ?? toUnixSec(openedAt)
          : null;
      const hasClosedEvent = Boolean(
        closedAt ||
          (Number.isFinite(Number(closedAtSec)) && Number(closedAtSec) > 0),
      );
      const closed =
        hasClosedEvent
          ? (Number.isFinite(Number(closedAtSec)) && Number(closedAtSec) > 0
              ? Number(closedAtSec)
              : null) ?? toUnixSec(closedAt)
          : null;
      const entry = toTradePriceNumber(entryPrice);
      const closeBadge = resolveTradeBadgeMeta({
        side: resolvedSide,
        closeStatus,
        pnlRealized,
        kind: "close",
      });
      const resolvedExitPrice = resolveSvgCloseDisplayPrice(
        {
          closeStatus,
          pnlRealized,
          exitPrice,
          tpPrice: tpPrice ?? tp1Price,
          slPrice,
        },
        plottedBarBounds,
      );
      const createdTs = resolveEventMarkerTimeSec(plottedBars, created);
      const openedTs = resolveEventMarkerTimeSec(plottedBars, opened);
      const closedTs = resolveEventMarkerTimeSec(plottedBars, closed);
      if (
        createdTs &&
        entry != null &&
        (!openedTs || Math.abs(openedTs - createdTs) > 60)
      ) {
        const createdMarkerStyle = resolveTradeMarkerPresentation({
          side: resolvedSide,
          kind: "created",
        });
        all.push({
          key: "single-created",
          time: createdTs,
          price: entry,
          color: resolveTradeBadgeMeta({ side: resolvedSide, kind: "open" }).color,
          text: buildTradeCreatedLabel(tradeLabel, resolvedSide),
          shape: "badge",
          anchorShape: createdMarkerStyle.svgAnchorShape,
          placement: createdMarkerStyle.svgBadgePlacement,
          selected: true,
        });
      }
      if (openedTs && entry != null) {
        const openedMarkerStyle = resolveTradeMarkerPresentation({
          side: resolvedSide,
          kind: "opened",
        });
        all.push({
          key: "single-open",
          time: openedTs,
          price: entry,
          color: "#64748b",
          text: buildTradeOpenedLabel(),
          shape: "badge",
          anchorShape: openedMarkerStyle.svgAnchorShape,
          placement: openedMarkerStyle.svgBadgePlacement,
          selected: true,
        });
      }
      if (closedTs && resolvedExitPrice != null) {
        const closeMarkerStyle = resolveTradeMarkerPresentation({
          side: resolvedSide,
          closeStatus,
          pnlRealized,
          kind: "close",
        });
        all.push({
          key: "single-close",
          time: closedTs,
          price: resolvedExitPrice,
          color: closeBadge.color,
          text: buildTradeCloseLabel(
            pnlRealized,
            closeStatus,
            resolvedExitPrice,
            {
              entryPrice: entry,
              exitPrice: resolvedExitPrice,
              tpPrice: tpPrice ?? tp1Price,
              slPrice,
              side: resolvedSide,
            },
          ),
          shape: "badge",
          anchorShape: closeMarkerStyle.svgAnchorShape,
          placement: closeMarkerStyle.svgBadgePlacement,
          selected: true,
        });
      }
    }
    return all;
  }, [
    plottedBars,
    effectiveTrades,
    selectedTradeSid,
    normalizedTrades.length,
    singleTrade,
    side,
    action,
    isBuy,
    entryPrice,
    tpPrice,
    tp1Price,
    slPrice,
    openedAt,
    openedAtSec,
    createdAt,
    createdAtSec,
    closedAt,
    closedAtSec,
    closeStatus,
    exitPrice,
    pnlRealized,
    tradeLabel,
    plottedBarBounds,
  ]);

  const builtIndicators = useMemo(
    () => buildIndicatorSeries(plottedBars),
    [plottedBars],
  );
  const visibleTrendIndicators = useMemo(
    () =>
      ["sma20", "sma50", "sma200"].filter(
        (key) => indicatorVisibility[key] !== false,
      ),
    [indicatorVisibility],
  );
  const visibleOscillatorIndicators = useMemo(
    () =>
      ["rsi", "rsiEma9", "rsiWma45"].filter(
        (key) => indicatorVisibility[key] !== false,
      ),
    [indicatorVisibility],
  );
  const showRsiPanel =
    showIndicators &&
    indicatorVisibility.rsiPanel !== false &&
    visibleOscillatorIndicators.length > 0;
  const showCandles = indicatorVisibility.candles !== false;
  const showBlurCandles = showCandles && indicatorVisibility.zigzag !== false;
  const blurUpColor = "rgba(125, 211, 252, 0.30)";
  const blurDownColor = "rgba(251, 191, 36, 0.24)";
  const blurWickColor = "rgba(203, 213, 225, 0.34)";

  const chartModel = useMemo(() => {
    if (!plottedBars.length) return null;
    const padding = { top: 22, right: 72, bottom: 26, left: 12 };
    const innerWidth = Math.max(200, width - padding.left - padding.right);
    const indicatorPanelHeight = showRsiPanel ? Math.max(82, Math.round(height * 0.2)) : 0;
    const panelGap = showRsiPanel ? 12 : 0;
    const innerHeight = Math.max(
      160,
      height - padding.top - padding.bottom - indicatorPanelHeight - panelGap,
    );
    const priceValues = [];
    plottedBars.forEach((bar) => {
      priceValues.push(bar.high, bar.low);
    });
    if (showIndicators) {
      visibleTrendIndicators.forEach((key) => {
        (builtIndicators[key] || []).forEach((point) => {
          const num = Number(point?.value);
          if (Number.isFinite(num) && num > 0) priceValues.push(num);
        });
      });
    }
    const selectedLineLevels = selectedTrade
      ? [
          selectedTrade.entry,
          selectedTrade.sl,
          selectedTrade.tp,
          resolveSvgCloseDisplayPrice(selectedTrade, plottedBarBounds),
        ]
      : [
          toTradePriceNumber(entryPrice),
          toTradePriceNumber(slPrice),
          toTradePriceNumber(tp1Price ?? tpPrice),
          resolveSvgCloseDisplayPrice(
            {
              closeStatus,
              pnlRealized,
              exitPrice,
              tpPrice: tp1Price ?? tpPrice,
              slPrice,
            },
            plottedBarBounds,
          ),
        ];
    selectedLineLevels.forEach((value) => {
      const num = toTradePriceNumber(value);
      if (num != null) {
        priceValues.push(num);
      }
    });
    if (!priceValues.length) return null;
    const minPrice = Math.min(...priceValues);
    const maxPrice = Math.max(...priceValues);
    const span = Math.max(1e-9, maxPrice - minPrice);
    const paddedMin = minPrice - span * 0.08;
    const paddedMax = maxPrice + span * 0.08;
    const priceSpan = Math.max(1e-9, paddedMax - paddedMin);
    const firstTime = plottedBars[0].time;
    const lastTime = plottedBars[plottedBars.length - 1].time;
    const timeSpan = Math.max(1, lastTime - firstTime);

    const xForTime = (time) =>
      padding.left + ((Number(time) - firstTime) / timeSpan) * innerWidth;
    const yForPrice = (price) =>
      padding.top + ((paddedMax - Number(price)) / priceSpan) * innerHeight;

    return {
      padding,
      innerWidth,
      innerHeight,
      indicatorPanelHeight,
      indicatorPanelTop: padding.top + innerHeight + panelGap,
      xForTime,
      yForPrice,
      minPrice: paddedMin,
      maxPrice: paddedMax,
    };
  }, [
    plottedBars,
    width,
    height,
    entryPrice,
    tpPrice,
    tp1Price,
    slPrice,
    markers,
    selectedTrade,
    builtIndicators,
    showIndicators,
    showRsiPanel,
    visibleTrendIndicators,
    closeStatus,
    pnlRealized,
    exitPrice,
    plottedBarBounds,
  ]);

  const lineLevels = useMemo(() => {
    const resolvedSide = inferTradeSide({
      side,
      action,
      isBuy,
      entryPrice,
      tpPrice: tpPrice ?? tp1Price,
      slPrice,
    });
    const linePalette = resolveTradeLinePalette(resolvedSide);
    const levels = [];
    const addLevel = (key, value, color, dash = "0", title = "", text = "") => {
      const num = toTradePriceNumber(value);
      if (num != null) levels.push({ key, value: num, color, dash, title, text });
    };
    const effectiveTrade = selectedTrade || null;
    const effectivePnl = Number(effectiveTrade?.pnlRealized ?? pnlRealized);
    const hasOpenedEvent = Boolean(
      effectiveTrade?.openedAt ||
        (Number.isFinite(Number(effectiveTrade?.openedAtSec)) &&
          Number(effectiveTrade?.openedAtSec) > 0) ||
        openedAt ||
        (Number.isFinite(Number(openedAtSec)) && Number(openedAtSec) > 0),
    );
    const hasClosedEvent = Boolean(
      effectiveTrade?.closedAt ||
        (Number.isFinite(Number(effectiveTrade?.closedAtSec)) &&
          Number(effectiveTrade?.closedAtSec) > 0) ||
        closedAt ||
        (Number.isFinite(Number(closedAtSec)) && Number(closedAtSec) > 0),
    );
    const closedWithProfit =
      hasClosedEvent && Number.isFinite(effectivePnl) && effectivePnl > 0;
    const closedWithLoss =
      hasClosedEvent && Number.isFinite(effectivePnl) && effectivePnl < 0;
    const explicitExitPrice =
      toTradePriceNumber(selectedTrade?.exitPrice ?? exitPrice) != null;
    addLevel(
      "entry",
      selectedTrade?.entry ?? entryPrice,
      "#ffffff",
      hasOpenedEvent ? "0" : "2 5",
    );
    addLevel(
      "tp1",
      selectedTrade?.tp ?? tp1Price ?? tpPrice,
      closedWithProfit && !explicitExitPrice
        ? closeToneColor("TP", effectivePnl)
        : linePalette.tp,
      closedWithProfit && !explicitExitPrice ? "0" : "2 5",
      "TP1",
    );
    addLevel(
      "sl",
      selectedTrade?.sl ?? slPrice,
      closedWithLoss && !explicitExitPrice
        ? closeToneColor("SL", effectivePnl)
        : linePalette.sl,
      closedWithLoss && !explicitExitPrice ? "0" : "2 5",
      "SL",
    );
    if (selectedTrade?.openedAt || selectedTrade?.openedAtSec || openedAt || openedAtSec) {
      addLevel("opened", selectedTrade?.entry ?? entryPrice, "#ffffff", "0");
    }
    const closedLine = resolveClosedTradeLine(
      selectedTrade,
      {
        closeStatus,
        pnlRealized,
        exitPrice,
        tpPrice: tp1Price ?? tpPrice,
        slPrice,
      },
      plottedBarBounds,
    );
    if (closedLine) {
      addLevel(
        "close",
        closedLine.value,
        closedLine.color,
        "0",
        closedLine.title,
        closedLine.text,
      );
    }
    if (!levels.length && selectedTrade) {
      addLevel(
        "entry",
        selectedTrade.entry,
        "#ffffff",
        hasOpenedEvent ? "0" : "2 5",
      );
      if (selectedTrade.openedAt || selectedTrade.openedAtSec) {
        addLevel("opened", selectedTrade.entry, "#ffffff", "0");
      }
      addLevel(
        "tp1",
        selectedTrade.tp,
        closedWithProfit && !explicitExitPrice
          ? closeToneColor("TP", effectivePnl)
          : linePalette.tp,
        closedWithProfit && !explicitExitPrice ? "0" : "2 5",
        "TP1",
      );
      addLevel(
        "sl",
        selectedTrade.sl,
        closedWithLoss && !explicitExitPrice
          ? closeToneColor("SL", effectivePnl)
          : linePalette.sl,
        closedWithLoss && !explicitExitPrice ? "0" : "2 5",
        "SL",
      );
    }
    return levels;
  }, [
    action,
    openedAt,
    openedAtSec,
    entryPrice,
    isBuy,
    side,
    slPrice,
    selectedTrade,
    closedAt,
    closedAtSec,
    closeStatus,
    pnlRealized,
    exitPrice,
    tp1Price,
    tpPrice,
    plottedBarBounds,
  ]);

  if (!plottedBars.length || !chartModel) {
    return (
      <div
        className="empty-state"
        style={{ minHeight: height, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        No chart bars available.
      </div>
    );
  }

  const candleWidth = Math.max(2, Math.min(8, chartModel.innerWidth / Math.max(1, plottedBars.length) - 1));
  const guidePrices = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return chartModel.maxPrice - (chartModel.maxPrice - chartModel.minPrice) * ratio;
  });
  const xForTime = chartModel.xForTime;
  const oscillatorGuides = [30, 50, 70];
  const yForOscillator = (value) =>
    chartModel.indicatorPanelTop +
    ((100 - Number(value)) / 100) * chartModel.indicatorPanelHeight;

  const buildSvgPath = (series = [], yMapper) => {
    const points = (Array.isArray(series) ? series : [])
      .map((point) => {
        const x = xForTime(Number(point?.time));
        const y = yMapper(Number(point?.value));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return `${x},${y}`;
      })
      .filter(Boolean);
    if (!points.length) return "";
    return `M ${points.join(" L ")}`;
  };

  const tradeBoxes = effectiveTrades
    .map((trade) => {
      const opened =
        (Number.isFinite(Number(trade.openedAtSec)) &&
        Number(trade.openedAtSec) > 0
          ? Number(trade.openedAtSec)
          : null) ?? toUnixSec(trade.openedAt);
      const closed =
        (Number.isFinite(Number(trade.closedAtSec)) &&
        Number(trade.closedAtSec) > 0
          ? Number(trade.closedAtSec)
          : null) ?? toUnixSec(trade.closedAt);
      const closePrice = resolveSvgCloseDisplayPrice(trade, plottedBarBounds);
      if (!opened || !closed || !Number.isFinite(trade.entry) || !Number.isFinite(closePrice)) {
        return null;
      }
      const x1 = chartModel.xForTime(opened);
      const x2 = chartModel.xForTime(closed);
      const y1 = chartModel.yForPrice(trade.entry);
      const y2 = chartModel.yForPrice(closePrice);
      if (![x1, x2, y1, y2].every(Number.isFinite)) return null;
      const closeBadge = resolveTradeBadgeMeta({
        side: trade.side,
        closeStatus: trade.closeStatus,
        pnlRealized: trade.pnlRealized,
        kind: "close",
      });
      return {
        key: `trade-box-${trade.sid}`,
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.max(2, Math.abs(x2 - x1)),
        height: Math.max(2, Math.abs(y2 - y1)),
        color: closeBadge.color,
      };
    })
    .filter(Boolean);

  return (
    <div className={className ? `stack-layout ${className}` : "stack-layout"} style={{ gap: 10, ...(style || {}) }}>
      <div
        ref={rootRef}
        style={{
          width: "100%",
          height,
          borderRadius: 14,
          overflow: "hidden",
          border: `1px solid ${BACKTEST_CHART_THEME.panelStroke}`,
          background: BACKTEST_CHART_THEME.surface,
        }}
      >
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} role="img">
          <rect x="0" y="0" width={width} height={height} fill="transparent" />

          {guidePrices.map((price) => {
            const y = chartModel.yForPrice(price);
            return (
              <g key={price}>
                <line
                  x1={chartModel.padding.left}
                  x2={width - chartModel.padding.right}
                  y1={y}
                  y2={y}
                  stroke={BACKTEST_CHART_THEME.gridStrong}
                  strokeDasharray="4 6"
                />
                <text
                  x={width - chartModel.padding.right + 8}
                  y={y + 4}
                  fontSize="11"
                  fill={BACKTEST_CHART_THEME.axisMuted}
                >
                  {formatAxisPrice(price)}
                </text>
              </g>
            );
          })}

          {lineLevels.map((line) => {
            const y = chartModel.yForPrice(line.value);
            const priceText = String(line.text || formatAxisPrice(line.value));
            const textWidth = Math.max(42, priceText.length * 6.8 + 10);
            const titleWidth = line.title ? 16 : 0;
            const badgeX = width - chartModel.padding.right + 4;
            return (
              <g key={line.key}>
                <line
                  x1={chartModel.padding.left}
                  x2={width - chartModel.padding.right}
                  y1={y}
                  y2={y}
                  stroke={line.color}
                  strokeDasharray={line.dash}
                  strokeWidth="1.2"
                  opacity="0.85"
                />
                {line.title ? (
                  <rect
                    x={badgeX}
                    y={y - 9}
                    width={titleWidth}
                    height={18}
                    rx="3"
                    fill={line.color}
                  />
                ) : null}
                <rect
                  x={badgeX + titleWidth}
                  y={y - 9}
                  width={textWidth}
                  height={18}
                  rx="3"
                  fill={line.color}
                />
                {line.title ? (
                  <text
                    x={badgeX + titleWidth / 2}
                    y={y + 3.5}
                    fontSize="10"
                    fontWeight="700"
                    textAnchor="middle"
                    fill={BACKTEST_CHART_THEME.badgeText}
                  >
                    {line.title}
                  </text>
                ) : null}
                <text
                  x={badgeX + titleWidth + textWidth / 2}
                  y={y + 3.5}
                  fontSize="10"
                  fontWeight="700"
                  textAnchor="middle"
                  fill={BACKTEST_CHART_THEME.badgeText}
                >
                  {priceText}
                </text>
              </g>
            );
          })}

          {showIndicators &&
            visibleTrendIndicators.map((key) => {
              const path = buildSvgPath(
                builtIndicators[key],
                chartModel.yForPrice,
              );
              if (!path) return null;
              return (
                <path
                  key={key}
                  d={path}
                  fill="none"
                  stroke={INDICATOR_COLORS[key]}
                  strokeWidth="1.35"
                  opacity="0.72"
                />
              );
            })}

          {showCandles &&
            plottedBars.map((bar) => {
            const x = chartModel.xForTime(bar.time);
            const yOpen = chartModel.yForPrice(bar.open);
            const yClose = chartModel.yForPrice(bar.close);
            const yHigh = chartModel.yForPrice(bar.high);
            const yLow = chartModel.yForPrice(bar.low);
            const bodyTop = Math.min(yOpen, yClose);
            const bodyHeight = Math.max(1.5, Math.abs(yClose - yOpen));
            const color =
              bar.close >= bar.open
                ? showBlurCandles
                  ? blurUpColor
                  : BACKTEST_CHART_THEME.candleUp
                : showBlurCandles
                  ? blurDownColor
                  : BACKTEST_CHART_THEME.candleDown;
            const wickColor =
              bar.close >= bar.open
                ? showBlurCandles
                  ? blurWickColor
                  : BACKTEST_CHART_THEME.wickUp
                : showBlurCandles
                  ? blurWickColor
                  : BACKTEST_CHART_THEME.wickDown;
            return (
              <g key={bar.time}>
                <line
                  x1={x}
                  x2={x}
                  y1={yHigh}
                  y2={yLow}
                  stroke={wickColor}
                  strokeWidth="1.2"
                  opacity={showBlurCandles ? "0.88" : "0.92"}
                />
                <rect
                  x={x - candleWidth / 2}
                  y={bodyTop}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={color}
                  opacity={showBlurCandles ? "0.84" : "0.92"}
                  rx="1"
                />
              </g>
            );
          })}

          {showRsiPanel ? (
            <>
              <rect
                x={chartModel.padding.left}
                y={chartModel.indicatorPanelTop}
                width={chartModel.innerWidth}
                height={chartModel.indicatorPanelHeight}
                rx="8"
                fill="rgba(15,23,42,0.18)"
                stroke="rgba(148,163,184,0.1)"
              />
              {oscillatorGuides.map((value) => {
                const y = yForOscillator(value);
                return (
                  <g key={`osc-${value}`}>
                    <line
                      x1={chartModel.padding.left}
                      x2={width - chartModel.padding.right}
                      y1={y}
                      y2={y}
                      stroke={BACKTEST_CHART_THEME.grid}
                      strokeDasharray="4 6"
                    />
                    <text
                      x={width - chartModel.padding.right + 8}
                      y={y + 4}
                      fontSize="10"
                      fill={BACKTEST_CHART_THEME.axisMuted}
                    >
                      {value}
                    </text>
                  </g>
                );
              })}
              {visibleOscillatorIndicators.map((key) => {
                const path = buildSvgPath(
                  builtIndicators[key],
                  yForOscillator,
                );
                if (!path) return null;
                return (
                  <path
                    key={`osc-path-${key}`}
                    d={path}
                    fill="none"
                    stroke={INDICATOR_COLORS[key]}
                    strokeWidth={key === "rsi" ? "1.8" : "1.3"}
                    opacity={key === "rsi" ? "0.88" : "0.72"}
                  />
                );
              })}
            </>
          ) : null}

          {tradeBoxes.map((box) => (
            <g key={box.key}>
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                fill={box.color}
                opacity="0.12"
                rx="8"
              />
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                fill="none"
                stroke={box.color}
                strokeOpacity="0.28"
                rx="8"
              />
            </g>
          ))}

          {markers.map((marker) => {
            const x = chartModel.xForTime(marker.time);
            const y = chartModel.yForPrice(marker.price);
            if (marker.shape === "badge") {
              const badgeWidth = Math.max(46, marker.text.length * 5.6 + 12);
              const badgeHeight = 14;
              const badgeX = x + 8;
              const placement = marker.placement === "below" ? "below" : "above";
              const badgeY = placement === "below" ? y + 6 : y - badgeHeight - 6;
              const anchorShape =
                marker.anchorShape === "up" ||
                marker.anchorShape === "down" ||
                marker.anchorShape === "none"
                  ? marker.anchorShape
                  : "circle";
              const anchorSize = marker.selected ? 6.5 : 5;
              const anchorPoints =
                anchorShape === "up"
                  ? `${x},${y - anchorSize} ${x - anchorSize},${y + anchorSize} ${x + anchorSize},${y + anchorSize}`
                  : `${x},${y + anchorSize} ${x - anchorSize},${y - anchorSize} ${x + anchorSize},${y - anchorSize}`;
              return (
                <g key={marker.key}>
                  {anchorShape === "none" ? null : anchorShape === "circle" ? (
                    <circle
                      cx={x}
                      cy={y}
                      r={marker.selected ? 5.5 : 4}
                      fill={marker.color}
                      stroke={marker.selected ? "#ffffff" : "none"}
                      strokeWidth={marker.selected ? 1.2 : 0}
                    />
                  ) : (
                    <polygon
                      points={anchorPoints}
                      fill={marker.color}
                      stroke={marker.selected ? "#ffffff" : "none"}
                      strokeWidth={marker.selected ? 1.2 : 0}
                    />
                  )}
                  <rect
                    x={badgeX}
                    y={badgeY}
                    width={badgeWidth}
                    height={badgeHeight}
                    rx="6"
                    fill={marker.color}
                    opacity="0.94"
                  />
                  <text
                    x={badgeX + 6}
                    y={badgeY + 9.6}
                    fontSize="8.2"
                    fontWeight="600"
                    fill={BACKTEST_CHART_THEME.badgeText}
                  >
                    {marker.text}
                  </text>
                </g>
              );
            }
            if (marker.shape === "circle") {
              return (
                <g key={marker.key}>
                  <circle
                    cx={x}
                    cy={y}
                    r={marker.selected ? 6 : 4.5}
                    fill={marker.color}
                    stroke={marker.selected ? "#ffffff" : "none"}
                    strokeWidth={marker.selected ? 1.2 : 0}
                  />
                  <text
                    x={x + 7}
                    y={y - 7}
                    fontSize="10"
                    fill={marker.textColor || marker.color}
                  >
                    {marker.text}
                  </text>
                </g>
              );
            }
            const size = marker.selected ? 7 : 5.5;
            const points =
              marker.shape === "up"
                ? `${x},${y - size} ${x - size},${y + size} ${x + size},${y + size}`
                : `${x},${y + size} ${x - size},${y - size} ${x + size},${y - size}`;
            return (
              <g key={marker.key}>
                <polygon
                  points={points}
                  fill={marker.color}
                  stroke={marker.selected ? "#ffffff" : "none"}
                  strokeWidth={marker.selected ? 1.2 : 0}
                />
                <text
                  x={x + 7}
                  y={y - 7}
                  fontSize="10"
                  fill={marker.textColor || marker.color}
                >
                  {marker.text}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {showLegend ? (
        <div
          style={{
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            fontSize: 12,
          }}
        >
          <span className="minor-text">SVG fallback chart</span>
          <span className="minor-text">Open: green buy / red sell triangles</span>
          <span className="minor-text">Close: blue win / amber loss circles</span>
          {showIndicators && visibleTrendIndicators.length ? (
            <span className="minor-text">
              Trend: {visibleTrendIndicators.join(", ")}
            </span>
          ) : null}
          {showRsiPanel ? (
            <span className="minor-text">
              Oscillator: {visibleOscillatorIndicators.join(", ")}
            </span>
          ) : null}
          {selectedTrade ? (
            <span className="minor-text">
              Focused trade: {selectedTrade.sid}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
