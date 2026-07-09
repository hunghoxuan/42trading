import { formatPnlValue } from "../MetricValue.jsx";

export const BACKTEST_CHART_THEME = {
  surface:
    "linear-gradient(180deg, rgba(19,26,39,0.98) 0%, rgba(14,20,31,0.98) 100%)",
  panelStroke: "rgba(58, 78, 110, 0.7)",
  grid: "rgba(94, 116, 150, 0.14)",
  gridStrong: "rgba(94, 116, 150, 0.18)",
  axisText: "rgba(189, 200, 220, 0.88)",
  axisMuted: "rgba(148, 163, 184, 0.84)",
  candleUp: "rgba(37, 191, 156, 0.72)",
  candleDown: "rgba(236, 100, 96, 0.68)",
  wickUp: "rgba(37, 191, 156, 0.56)",
  wickDown: "rgba(236, 100, 96, 0.52)",
  buy: "#166534",
  sell: "#991b1b",
  profit: "#166534",
  loss: "#991b1b",
  plannedTp: "#16a34a",
  plannedSl: "#dc2626",
  badgeText: "#f8fafc",
  tradeBoxProfit: "rgba(32, 201, 151, 0.12)",
  tradeBoxLoss: "rgba(239, 93, 93, 0.12)",
  tradeBoxProfitBorder: "rgba(32, 201, 151, 0.28)",
  tradeBoxLossBorder: "rgba(239, 93, 93, 0.3)",
};

export function toTradePriceNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function unixSecToIso(value) {
  const sec = Number(value);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  try {
    return new Date(sec * 1000).toISOString();
  } catch {
    return null;
  }
}

function toNullableNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function inferTradeSide({
  side = null,
  action = null,
  isBuy = null,
  entryPrice = null,
  tpPrice = null,
  slPrice = null,
}) {
  if (typeof isBuy === "boolean") return isBuy ? "BUY" : "SELL";
  const explicit = String(side || action || "").trim().toUpperCase();
  if (explicit === "BUY" || explicit === "LONG") return "BUY";
  if (explicit === "SELL" || explicit === "SHORT") return "SELL";
  const entry = toTradePriceNumber(entryPrice);
  const tp = toTradePriceNumber(tpPrice);
  const sl = toTradePriceNumber(slPrice);
  if (entry != null && tp != null && tp > entry) return "BUY";
  if (entry != null && sl != null && sl < entry) return "BUY";
  if (entry != null && tp != null && tp < entry) return "SELL";
  if (entry != null && sl != null && sl > entry) return "SELL";
  return "BUY";
}

export function resolveTradeLinePalette(side = "BUY") {
  const isSell = String(side || "").toUpperCase() === "SELL";
  return {
    entry: isSell ? BACKTEST_CHART_THEME.sell : BACKTEST_CHART_THEME.buy,
    tp: BACKTEST_CHART_THEME.plannedTp,
    sl: BACKTEST_CHART_THEME.plannedSl,
  };
}

export function normalizeTradeRowsForChart(trades = [], defaultTradeLabel = "") {
  if (!Array.isArray(trades)) return [];
  return trades
    .map((trade, index) => {
      const side = inferTradeSide({
        side: trade?.side,
        action: trade?.action,
        entryPrice: trade?.entry,
        tpPrice: trade?.tp,
        slPrice: trade?.sl,
      });
      return {
        key: String(trade?.sid || trade?.id || `${index}`),
        sid: String(trade?.sid || trade?.id || `${index}`),
        side,
        entry: toTradePriceNumber(trade?.entry),
        exitPrice: toTradePriceNumber(trade?.exit_price ?? trade?.exitPrice),
        sl: toTradePriceNumber(trade?.sl),
        tp: toTradePriceNumber(trade?.tp),
        createdAt:
          trade?.created_at ??
          trade?.createdAt ??
          trade?.signal_bar_time ??
          trade?.signalBarTime ??
          unixSecToIso(
            trade?.signal_time_unix ??
              trade?.signalTimeUnix ??
              trade?.signal_bar_time_unix ??
              trade?.signalBarTimeUnix,
          ) ??
          null,
        openedAt:
          trade?.opened_at ??
          trade?.openedAt ??
          unixSecToIso(trade?.entry_time_unix ?? trade?.entryTimeUnix) ??
          null,
        closedAt:
          trade?.closed_at ??
          trade?.closedAt ??
          unixSecToIso(trade?.exit_time_unix ?? trade?.exitTimeUnix) ??
          null,
        openedAtSec:
          trade?.openedAtSec != null &&
          Number.isFinite(Number(trade?.openedAtSec)) &&
          Number(trade?.openedAtSec) > 0
            ? Number(trade?.openedAtSec)
            : Number.isFinite(Number(trade?.entry_time_unix ?? trade?.entryTimeUnix)) &&
                Number(trade?.entry_time_unix ?? trade?.entryTimeUnix) > 0
              ? Number(trade?.entry_time_unix ?? trade?.entryTimeUnix)
            : null,
        closedAtSec:
          trade?.closedAtSec != null &&
          Number.isFinite(Number(trade?.closedAtSec)) &&
          Number(trade?.closedAtSec) > 0
            ? Number(trade?.closedAtSec)
            : Number.isFinite(Number(trade?.exit_time_unix ?? trade?.exitTimeUnix)) &&
                Number(trade?.exit_time_unix ?? trade?.exitTimeUnix) > 0
              ? Number(trade?.exit_time_unix ?? trade?.exitTimeUnix)
            : null,
        createdAtSec:
          trade?.createdAtSec != null &&
          Number.isFinite(Number(trade?.createdAtSec)) &&
          Number(trade?.createdAtSec) > 0
            ? Number(trade?.createdAtSec)
            : Number.isFinite(
                  Number(
                    trade?.signal_time_unix ??
                      trade?.signalTimeUnix ??
                      trade?.signal_bar_time_unix ??
                      trade?.signalBarTimeUnix,
                  ),
                ) &&
                Number(
                  trade?.signal_time_unix ??
                    trade?.signalTimeUnix ??
                    trade?.signal_bar_time_unix ??
                    trade?.signalBarTimeUnix,
                ) > 0
              ? Number(
                  trade?.signal_time_unix ??
                    trade?.signalTimeUnix ??
                    trade?.signal_bar_time_unix ??
                    trade?.signalBarTimeUnix,
                )
            : null,
        pnlRealized: toNullableNumber(trade?.pnl_realized ?? trade?.pnlRealized),
        rMultiple: toNullableNumber(
          trade?.r_multiple ??
            trade?.rMultiple ??
            trade?.realizedR ??
            trade?.actualR ??
            trade?.actual_rr ??
            trade?.actualRr,
        ),
        closeStatus:
          trade?.result ??
          trade?.execution_status ??
          trade?.status ??
          trade?.closeStatus ??
          "",
        tradeLabel: String(trade?.tradeLabel || defaultTradeLabel || "").trim(),
        index,
      };
    })
    .filter((trade) => Number.isFinite(trade.entry));
}

export function buildSingleTradeForChart({
  side = null,
  action = null,
  isBuy = null,
  entryPrice = null,
  tpPrice = null,
  tp1Price = null,
  slPrice = null,
  exitPrice = null,
  openedAt = null,
  closedAt = null,
  createdAt = null,
  openedAtSec = null,
  closedAtSec = null,
  createdAtSec = null,
  pnlRealized = null,
  rMultiple = null,
  closeStatus = "",
  tradeLabel = "",
  sid = "single-trade",
} = {}) {
  const resolvedSide = inferTradeSide({
    side,
    action,
    isBuy,
    entryPrice,
    tpPrice: tpPrice ?? tp1Price,
    slPrice,
  });
  const entry = toTradePriceNumber(entryPrice);
  if (entry == null) return null;
  return {
    key: String(sid || "single-trade"),
    sid: String(sid || "single-trade"),
    side: resolvedSide,
    entry,
    exitPrice: toTradePriceNumber(exitPrice),
    sl: toTradePriceNumber(slPrice),
    tp: toTradePriceNumber(tpPrice ?? tp1Price),
    createdAt: createdAt || null,
    openedAt: openedAt || null,
    closedAt: closedAt || null,
    openedAtSec:
      openedAtSec != null &&
      Number.isFinite(Number(openedAtSec)) &&
      Number(openedAtSec) > 0
        ? Number(openedAtSec)
        : null,
    closedAtSec:
      closedAtSec != null &&
      Number.isFinite(Number(closedAtSec)) &&
      Number(closedAtSec) > 0
        ? Number(closedAtSec)
        : null,
    createdAtSec:
      createdAtSec != null &&
      Number.isFinite(Number(createdAtSec)) &&
      Number(createdAtSec) > 0
        ? Number(createdAtSec)
        : null,
    pnlRealized: toNullableNumber(pnlRealized),
    rMultiple: toNullableNumber(rMultiple),
    closeStatus,
    tradeLabel: String(tradeLabel || "").trim(),
    index: 0,
  };
}

export function computePriceBoundsFromBars(bars = []) {
  let min = Infinity;
  let max = -Infinity;
  for (const bar of Array.isArray(bars) ? bars : []) {
    const low = Number(bar?.low);
    const high = Number(bar?.high);
    if (Number.isFinite(low)) min = Math.min(min, low);
    if (Number.isFinite(high)) max = Math.max(max, high);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max };
}

export function isPriceCompatibleWithBarBounds(price, barBounds) {
  const n = Number(price);
  if (!Number.isFinite(n) || !barBounds) return false;
  const min = Number(barBounds.min);
  const max = Number(barBounds.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return false;
  if (n >= min && n <= max) return true;
  const center = (min + max) / 2;
  const rawSpan = Math.max(max - min, 1e-6);
  const span = Math.max(rawSpan, Math.abs(center) * 0.002, 1e-6);
  const distanceToRange = n < min ? min - n : n - max;
  const relativeDistance = distanceToRange / Math.max(Math.abs(center), 1e-6);
  if (distanceToRange <= span * 2.5) return true;
  if (relativeDistance <= 0.015) return true;
  return false;
}

export function findTradeBarIndexForEpochSec(bars = [], epochSec = 0) {
  const target = Number(epochSec);
  if (!Array.isArray(bars) || !bars.length || !Number.isFinite(target)) {
    return -1;
  }
  for (let index = 0; index < bars.length; index += 1) {
    const barTime = Number(bars[index]?.time);
    if (Number.isFinite(barTime) && barTime >= target) {
      return index;
    }
  }
  return bars.length - 1;
}

export function resolveTradeFocusedWindow(
  bars = [],
  visibleBarsCount = 0,
  anchors = {},
) {
  if (!Array.isArray(bars) || !bars.length) return null;
  const requestedVisibleBars = Math.max(
    40,
    Math.round(Number(visibleBarsCount) || 0) || 2000,
  );
  const firstAnchorTimeSec = Number(anchors?.firstAnchorTimeSec);
  const lastAnchorTimeSec = Number(anchors?.lastAnchorTimeSec);
  const preferLatestWindow = anchors?.preferLatestWindow === true;
  const firstAnchorIndex = Number.isFinite(firstAnchorTimeSec)
    ? findTradeBarIndexForEpochSec(bars, firstAnchorTimeSec)
    : -1;
  if (firstAnchorIndex < 0) return null;
  const lastAnchorIndex = Number.isFinite(lastAnchorTimeSec)
    ? findTradeBarIndexForEpochSec(bars, lastAnchorTimeSec)
    : bars.length - 1;
  const anchorStart = Math.max(0, Math.min(firstAnchorIndex, lastAnchorIndex));
  const anchorEnd = Math.max(anchorStart, lastAnchorIndex);
  const anchorSpanBars = Math.max(1, anchorEnd - anchorStart + 1);
  const targetWindowBars = Math.max(
    anchorSpanBars + 8,
    Math.min(requestedVisibleBars, bars.length),
  );
  const rightContextPad = Math.max(
    8,
    Math.min(48, Math.round(targetWindowBars * 0.12)),
  );
  const desiredRightPad = Math.min(
    Math.max(0, bars.length - 1 - anchorEnd),
    Math.max(rightContextPad, Math.round(anchorSpanBars * 0.1)),
  );
  const desiredLeftPad = Math.min(
    anchorStart,
    Math.max(0, targetWindowBars - anchorSpanBars - desiredRightPad),
  );

  let from = anchorStart - desiredLeftPad;
  let to = anchorEnd + desiredRightPad;

  const currentWindowBars = () => Math.max(1, to - from + 1);
  if (currentWindowBars() < targetWindowBars) {
    const missingBars = targetWindowBars - currentWindowBars();
    const extraLeft = Math.min(from, missingBars);
    from -= extraLeft;
    to = Math.min(bars.length - 1, to + Math.max(0, missingBars - extraLeft));
  }
  if (from < 0) {
    to = Math.min(bars.length - 1, to - from);
    from = 0;
  }
  if (to > bars.length - 1) {
    const overflow = to - (bars.length - 1);
    from = Math.max(0, from - overflow);
    to = bars.length - 1;
  }
  if (to <= from) {
    to = Math.min(bars.length - 1, from + Math.max(2, anchorSpanBars));
  }
  if (preferLatestWindow && requestedVisibleBars > 0) {
    const maxBars = Math.max(1, Math.min(requestedVisibleBars, bars.length));
    const latestFrom = Math.max(0, anchorEnd - maxBars + 1);
    from = Math.max(from, latestFrom);
  }

  return {
    from,
    to,
    requestedVisibleBars,
    anchorStart,
    anchorEnd,
    anchorSpanBars,
  };
}

export function resolveTradeBadgeMeta({
  side = "BUY",
  closeStatus = "",
  pnlRealized = null,
  kind = "open",
}) {
  const isSell = String(side || "").toUpperCase() === "SELL";
  if (kind === "open") {
    return {
      label: isSell ? "↓ S" : "↑ B",
      color: isSell ? BACKTEST_CHART_THEME.sell : BACKTEST_CHART_THEME.buy,
    };
  }
  const status = String(closeStatus || "").trim().toUpperCase();
  const pnl = toNullableNumber(pnlRealized);
  const isTp =
    Number.isFinite(pnl)
      ? pnl >= 0
      : ["TP", "WIN"].includes(status);
  return {
    label: isTp ? "TP" : "SL",
    color:
      Number.isFinite(pnl) && pnl >= 0
        ? BACKTEST_CHART_THEME.plannedTp
        : status === "CANCEL" || status === "CANCELLED"
          ? BACKTEST_CHART_THEME.plannedSl
          : isTp
            ? BACKTEST_CHART_THEME.plannedTp
            : BACKTEST_CHART_THEME.plannedSl,
  };
}

export function resolveTradeMarkerPresentation({
  side = "BUY",
  closeStatus = "",
  pnlRealized = null,
  kind = "open",
}) {
  const normalizedSide = String(side || "").trim().toUpperCase();
  const isSell = normalizedSide === "SELL" || normalizedSide === "SHORT";
  const status = String(closeStatus || "").trim().toUpperCase();
  const pnl = toNullableNumber(pnlRealized);
  const isTp =
    kind === "close" &&
    (Number.isFinite(pnl) ? pnl >= 0 : ["TP", "WIN"].includes(status));
  const isSl = kind === "close" && !isTp;

  if (kind === "created") {
    return {
      chartPosition: isSell ? "aboveBar" : "belowBar",
      chartShape: isSell ? "arrowDown" : "arrowUp",
      svgAnchorShape: isSell ? "down" : "up",
      svgBadgePlacement: isSell ? "above" : "below",
    };
  }

  if (kind === "opened") {
    return {
      chartPosition: isSell ? "aboveBar" : "belowBar",
      chartShape: "circle",
      svgAnchorShape: "circle",
      svgBadgePlacement: isSell ? "above" : "below",
    };
  }

  if (kind === "close" && isTp) {
    return {
      chartPosition: isSell ? "belowBar" : "aboveBar",
      chartShape: "circle",
      svgAnchorShape: "none",
      svgBadgePlacement: isSell ? "below" : "above",
    };
  }

  if (kind === "close" && isSl) {
    return {
      chartPosition: isSell ? "aboveBar" : "belowBar",
      chartShape: "circle",
      svgAnchorShape: "none",
      svgBadgePlacement: isSell ? "above" : "below",
    };
  }

  return {
    chartPosition: isSell ? "aboveBar" : "belowBar",
    chartShape: "circle",
    svgAnchorShape: "circle",
    svgBadgePlacement: isSell ? "above" : "below",
  };
}

export function buildTradeOpenLabel(strategyName = "", fallbackSide = "BUY") {
  const name = String(strategyName || "").trim();
  const isSell = String(fallbackSide || "").toUpperCase() === "SELL";
  const prefix = isSell ? "↓ S" : "↑ B";
  if (name) return `${prefix} | ${name}`;
  return prefix;
}

export function buildTradeCreatedLabel(strategyName = "", fallbackSide = "BUY") {
  return buildTradeOpenLabel(strategyName, fallbackSide);
}

export function buildTradeOpenedLabel() {
  return "opened";
}

function countPriceDecimals(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const normalized = n.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  const idx = normalized.indexOf(".");
  return idx >= 0 ? normalized.length - idx - 1 : 0;
}

function formatTradePrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const decimals = Math.min(Math.max(countPriceDecimals(n), 2), 8);
  return n.toFixed(decimals);
}

export function formatRMultiple(value) {
  const n = toNullableNumber(value);
  if (!Number.isFinite(n)) return "";
  const rounded = Math.abs(n);
  const decimals = rounded >= 10 ? 1 : 2;
  const text = rounded.toFixed(decimals).replace(/\.?0+$/, "");
  return `${text}r`;
}

export function resolveTradeRMultiple({
  rMultiple = null,
  entryPrice = null,
  exitPrice = null,
  tpPrice = null,
  slPrice = null,
  side = "BUY",
  pnlRealized = null,
  closeStatus = "",
} = {}) {
  const explicitR = toNullableNumber(rMultiple);
  if (Number.isFinite(explicitR)) return Math.abs(explicitR);

  const entry = toTradePriceNumber(entryPrice);
  const exit = toTradePriceNumber(exitPrice);
  const sl = toTradePriceNumber(slPrice);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || !Number.isFinite(sl)) {
    return null;
  }
  const riskPerUnit = Math.abs(entry - sl);
  if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) return null;

  const normalizedSide = String(side || "").trim().toUpperCase();
  const move =
    normalizedSide === "SELL" || normalizedSide === "SHORT"
      ? entry - exit
      : exit - entry;
  const computed = Math.abs(move) / riskPerUnit;
  if (Number.isFinite(computed) && computed > 0) return computed;

  const pnl = toNullableNumber(pnlRealized);
  const status = String(closeStatus || "").trim().toUpperCase();
  if (
    Number.isFinite(pnl) &&
    pnl < 0 &&
    ["SL", "LOSS", "FAIL", "STOPPED"].includes(status)
  ) {
    return 1;
  }
  return null;
}

export function resolveTradeLevelRLabel({
  kind = "",
  entryPrice = null,
  levelPrice = null,
  tpPrice = null,
  slPrice = null,
  side = "BUY",
  rMultiple = null,
  pnlRealized = null,
  closeStatus = "",
  exitPrice = null,
} = {}) {
  const normalizedKind = String(kind || "").trim().toLowerCase();
  if (normalizedKind === "sl") return "1r";

  const rr = resolveTradeRMultiple({
    rMultiple,
    entryPrice,
    exitPrice:
      normalizedKind === "close"
        ? exitPrice
        : normalizedKind.startsWith("tp")
          ? levelPrice ?? tpPrice
          : levelPrice,
    tpPrice,
    slPrice,
    side,
    pnlRealized,
    closeStatus,
  });

  if (Number.isFinite(rr)) return formatRMultiple(rr);
  if (normalizedKind.startsWith("tp")) return "TP";
  if (normalizedKind === "close") {
    const status = String(closeStatus || "").trim().toUpperCase();
    if (status === "SL" || status === "LOSS") return "1r";
    if (status === "TP" || status === "WIN") return "TP";
  }
  return "";
}

export function buildTradeCloseLabel(
  pnlRealized = null,
  closeStatus = "",
  exitPrice = null,
  options = {},
) {
  const status = String(closeStatus || "").trim().toUpperCase();
  const pnl = toNullableNumber(pnlRealized);
  const rr = resolveTradeRMultiple({
    rMultiple: options?.rMultiple,
    entryPrice: options?.entryPrice,
    exitPrice: exitPrice ?? options?.exitPrice,
    tpPrice: options?.tpPrice,
    slPrice: options?.slPrice,
    side: options?.side,
    pnlRealized,
    closeStatus,
  });
  if (Number.isFinite(pnl)) {
    if (pnl >= 0) {
      const rrText = formatRMultiple(rr);
      return [formatPnlValue(pnl, 2), rrText].filter(Boolean).join(" ");
    }
    const rrText = formatRMultiple(rr) || "1r";
    return `${formatPnlValue(pnl, 2)} ${rrText}`;
  }
  const price = Number(exitPrice);
  if (Number.isFinite(price)) {
    if (status === "TP" || status === "WIN") return `TP | ${formatTradePrice(price)}`;
    if (status === "SL" || status === "LOSS") return `SL | ${formatTradePrice(price)}`;
  }
  if (status === "TP" || status === "WIN") return "TP";
  if (status === "SL" || status === "LOSS") return "SL";
  return "";
}

export function resolveTradeCloseDisplayPrice({
  closeStatus = "",
  pnlRealized = null,
  exitPrice = null,
  tpPrice = null,
  slPrice = null,
}) {
  const status = String(closeStatus || "").trim().toUpperCase();
  const pnl = toNullableNumber(pnlRealized);
  const tp = Number(tpPrice);
  const sl = Number(slPrice);
  const exit = Number(exitPrice);
  if (Number.isFinite(exit) && exit > 0) return exit;
  const hasCloseEvidence =
    [
      "TP",
      "WIN",
      "SL",
      "LOSS",
      "FAIL",
      "STOPPED",
      "REJECTED",
      "CLOSED",
      "MANUAL",
      "MANUAL_CLOSE",
      "CANCEL",
      "CANCELLED",
      "EXPIRED",
    ].includes(status) || Number.isFinite(pnl);
  if (!hasCloseEvidence) return null;
  if (
    status === "MANUAL" ||
    status === "MANUAL_CLOSE" ||
    status === "CANCEL" ||
    status === "CANCELLED"
  ) {
    return null;
  }
  const isTp =
    ["TP", "WIN"].includes(status) ||
    (!status && Number.isFinite(pnl) && pnl >= 0);
  const isSl =
    ["SL", "LOSS", "FAIL", "STOPPED", "CANCELLED", "REJECTED"].includes(status) ||
    (!status && Number.isFinite(pnl) && pnl < 0);
  if (isTp && Number.isFinite(tp) && tp > 0) return tp;
  if (isSl && Number.isFinite(sl) && sl > 0) return sl;
  if (Number.isFinite(tp) && tp > 0) return tp;
  if (Number.isFinite(sl) && sl > 0) return sl;
  return null;
}

export function resolveClosedTradeLineStyle(source = {}, barBounds = null) {
  const closeStatus = String(source?.closeStatus || source?.result || "")
    .trim()
    .toUpperCase();
  const pnlRealized = toNullableNumber(
    source?.pnlRealized ?? source?.pnl_realized,
  );
  const rawExitPrice = toTradePriceNumber(
    source?.exitPrice ?? source?.exit_price,
  );
  const exitPrice =
    rawExitPrice != null &&
    (!barBounds || isPriceCompatibleWithBarBounds(rawExitPrice, barBounds))
      ? rawExitPrice
      : null;
  if (!Number.isFinite(exitPrice)) return null;
  const badge = resolveTradeBadgeMeta({
    side: source?.side || "BUY",
    closeStatus,
    pnlRealized,
    kind: "close",
  });
  return {
    value: exitPrice,
    color: badge.color,
    dash: "0",
    title: "",
    text: "",
  };
}
