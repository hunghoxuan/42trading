"use strict";

const artifactDetection = require("./detectArtifacts.cjs");

function normalizeTfKey(tfRaw = "") {
  const raw = String(tfRaw || "").trim().toLowerCase();
  if (!raw) return "";
  if (["1m", "1min", "m1", "1"].includes(raw)) return "1m";
  if (["5m", "5min", "m5", "5"].includes(raw)) return "5m";
  if (["15m", "15min", "m15", "15"].includes(raw)) return "15m";
  if (["1h", "60", "h1"].includes(raw)) return "1h";
  if (["4h", "240", "h4"].includes(raw)) return "4h";
  if (["1d", "d", "day", "1440"].includes(raw)) return "1d";
  if (["1w", "w", "week", "10080"].includes(raw)) return "1w";
  return raw;
}

function timeframeWeight(tfRaw = "") {
  const tf = normalizeTfKey(tfRaw);
  if (tf === "1m") return 1;
  if (tf === "5m") return 5;
  if (tf === "15m") return 15;
  if (tf === "1h") return 60;
  if (tf === "4h") return 240;
  if (tf === "1d") return 1440;
  if (tf === "1w") return 10080;
  return 0;
}

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeBars(bars = []) {
  return (Array.isArray(bars) ? bars : [])
    .map((bar) => ({
      time: Number(bar?.time),
      open: Number(bar?.open),
      high: Number(bar?.high),
      low: Number(bar?.low),
      close: Number(bar?.close),
      volume: Number(bar?.volume || 0),
    }))
    .filter(
      (bar) =>
        Number.isFinite(bar.time) &&
        Number.isFinite(bar.open) &&
        Number.isFinite(bar.high) &&
        Number.isFinite(bar.low) &&
        Number.isFinite(bar.close),
    );
}

function artifactTime(item = {}) {
  return Number(item?.anchor_time ?? item?.bar_end ?? item?.bar_start ?? item?.time ?? 0) || 0;
}

function artifactBias(item = {}) {
  const raw = String(
    item?.payload?.bias || item?.subtype || item?.direction || item?.type || "",
  )
    .trim()
    .toLowerCase();
  if (["bull", "bullish", "buy", "long", "up"].includes(raw)) return "bullish";
  if (["bear", "bearish", "sell", "short", "down"].includes(raw)) return "bearish";
  return "neutral";
}

function artifactRefPrice(item = {}) {
  return (
    finiteNumber(item?.price) ??
    finiteNumber(item?.price_high) ??
    finiteNumber(item?.price_low) ??
    finiteNumber(item?.payload?.source_swing_price) ??
    finiteNumber(item?.payload?.swept_swing_price)
  );
}

function candleRange(bar = {}) {
  const high = Number(bar?.high);
  const low = Number(bar?.low);
  return Number.isFinite(high) && Number.isFinite(low) ? Math.max(0, high - low) : 0;
}

function median(values = []) {
  const normalized = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!normalized.length) return 0;
  const middle = Math.floor(normalized.length / 2);
  if (normalized.length % 2) return normalized[middle];
  return (normalized[middle - 1] + normalized[middle]) / 2;
}

function average(values = []) {
  const normalized = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!normalized.length) return 0;
  return normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeEmaSeries(values = [], length = 20) {
  const normalized = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!normalized.length) return [];
  const safeLength = Math.max(1, Math.round(Number(length) || 1));
  const multiplier = 2 / (safeLength + 1);
  const out = [];
  let ema = normalized[0];
  out.push(ema);
  for (let index = 1; index < normalized.length; index += 1) {
    ema = normalized[index] * multiplier + ema * (1 - multiplier);
    out.push(ema);
  }
  return out;
}

function latestFromSeries(values = []) {
  if (!Array.isArray(values) || !values.length) return null;
  const value = Number(values[values.length - 1]);
  return Number.isFinite(value) ? value : null;
}

function computeAnchoredVwap(bars = []) {
  let cumulativeVolume = 0;
  let cumulativeValue = 0;
  for (const bar of Array.isArray(bars) ? bars : []) {
    const high = Number(bar?.high);
    const low = Number(bar?.low);
    const close = Number(bar?.close);
    const volume = Math.max(0, Number(bar?.volume || 0));
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue;
    const typical = (high + low + close) / 3;
    const effectiveVolume = volume > 0 ? volume : 1;
    cumulativeVolume += effectiveVolume;
    cumulativeValue += typical * effectiveVolume;
  }
  if (cumulativeVolume <= 0) return null;
  return cumulativeValue / cumulativeVolume;
}

function slopeDirection(series = [], lookback = 3) {
  if (!Array.isArray(series) || series.length <= lookback) return "flat";
  const latest = Number(series[series.length - 1]);
  const previous = Number(series[series.length - 1 - lookback]);
  if (!Number.isFinite(latest) || !Number.isFinite(previous) || latest === previous) {
    return "flat";
  }
  return latest > previous ? "up" : "down";
}

function computeIndicatorSnapshot(bars = []) {
  const closes = (Array.isArray(bars) ? bars : [])
    .map((bar) => Number(bar?.close))
    .filter((value) => Number.isFinite(value));
  const lastClose = closes.length ? closes[closes.length - 1] : null;
  const ema20Series = computeEmaSeries(closes, 20);
  const ema50Series = computeEmaSeries(closes, 50);
  const ema20 = latestFromSeries(ema20Series);
  const ema50 = latestFromSeries(ema50Series);
  const vwap = computeAnchoredVwap(bars);
  return {
    close: Number.isFinite(lastClose) ? lastClose : null,
    ema_20: ema20,
    ema_50: ema50,
    ema_20_slope: slopeDirection(ema20Series, 3),
    ema_50_slope: slopeDirection(ema50Series, 5),
    vwap,
    above_ema_20:
      Number.isFinite(lastClose) && Number.isFinite(ema20) ? lastClose > ema20 : null,
    above_ema_50:
      Number.isFinite(lastClose) && Number.isFinite(ema50) ? lastClose > ema50 : null,
    above_vwap:
      Number.isFinite(lastClose) && Number.isFinite(vwap) ? lastClose > vwap : null,
    ema_stack:
      Number.isFinite(ema20) && Number.isFinite(ema50)
        ? ema20 > ema50
          ? "bullish"
          : ema20 < ema50
            ? "bearish"
            : "flat"
        : "flat",
  };
}

function computeRecentStructureState(bars = []) {
  const normalized = Array.isArray(bars) ? bars : [];
  if (normalized.length < 8) return { state: "range", source: "insufficient_swings", score: 0 };
  const recent = normalized.slice(-4);
  const previous = normalized.slice(-8, -4);
  const recentHigh = Math.max(...recent.map((bar) => Number(bar?.high)).filter((value) => Number.isFinite(value)));
  const recentLow = Math.min(...recent.map((bar) => Number(bar?.low)).filter((value) => Number.isFinite(value)));
  const previousHigh = Math.max(...previous.map((bar) => Number(bar?.high)).filter((value) => Number.isFinite(value)));
  const previousLow = Math.min(...previous.map((bar) => Number(bar?.low)).filter((value) => Number.isFinite(value)));
  if (![recentHigh, recentLow, previousHigh, previousLow].every((value) => Number.isFinite(value))) {
    return { state: "range", source: "invalid_swings", score: 0 };
  }
  if (recentHigh > previousHigh && recentLow > previousLow) {
    return { state: "up", source: "hh_hl", score: 2 };
  }
  if (recentHigh < previousHigh && recentLow < previousLow) {
    return { state: "down", source: "ll_lh", score: -2 };
  }
  return { state: "range", source: "mixed_swings", score: 0 };
}

function zoneContext(artifacts = [], close = null) {
  const summary = {
    in_bullish_zone: false,
    in_bearish_zone: false,
    nearest_bullish_zone: null,
    nearest_bearish_zone: null,
  };
  const summaries = (Array.isArray(artifacts) ? artifacts : []).map((item) => toItemSummary(item, close));
  const bullish = summaries.filter((item) =>
    item.bias === "bullish" &&
    ["demand", "fvg", "ob", "support"].includes(item.type),
  );
  const bearish = summaries.filter((item) =>
    item.bias === "bearish" &&
    ["supply", "fvg", "ob", "resistance"].includes(item.type),
  );
  const sortByProximity = (items = []) =>
    [...items].sort((left, right) => {
      const leftDistance = Math.abs(Number(left?.distance));
      const rightDistance = Math.abs(Number(right?.distance));
      return leftDistance - rightDistance;
    });
  summary.nearest_bullish_zone = sortByProximity(bullish)[0] || null;
  summary.nearest_bearish_zone = sortByProximity(bearish)[0] || null;
  summary.in_bullish_zone = bullish.some((item) => activeZoneHit(item, close));
  summary.in_bearish_zone = bearish.some((item) => activeZoneHit(item, close));
  return summary;
}

function toItemSummary(item = {}, lastClose = null) {
  const low = finiteNumber(item?.price_low);
  const high = finiteNumber(item?.price_high);
  const refPrice = artifactRefPrice(item);
  const anchorPrice = Number.isFinite(refPrice)
    ? refPrice
    : Number.isFinite(low) && Number.isFinite(high)
      ? (low + high) / 2
      : Number.isFinite(low)
        ? low
        : Number.isFinite(high)
          ? high
          : null;
  const distance = Number.isFinite(lastClose) && Number.isFinite(anchorPrice)
    ? anchorPrice - lastClose
    : null;
  return {
    id: String(item?.id || ""),
    family: String(item?.family || "").trim().toLowerCase(),
    type: String(item?.type || "").trim().toLowerCase(),
    subtype: String(item?.subtype || "").trim().toLowerCase(),
    label: String(item?.label || "").trim(),
    timeframe: normalizeTfKey(item?.timeframe || item?.tf || ""),
    bias: artifactBias(item),
    anchor_time: artifactTime(item),
    price: Number.isFinite(anchorPrice) ? anchorPrice : null,
    price_low: Number.isFinite(low) ? low : null,
    price_high: Number.isFinite(high) ? high : null,
    distance,
    payload: clone(item?.payload || {}),
  };
}

function sortSummariesByDistance(items = []) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const leftDistance = Math.abs(Number(left?.distance));
    const rightDistance = Math.abs(Number(right?.distance));
    if (Number.isFinite(leftDistance) && Number.isFinite(rightDistance)) {
      return leftDistance - rightDistance;
    }
    return Number(right?.anchor_time || 0) - Number(left?.anchor_time || 0);
  });
}

function latestByTypes(artifacts = [], types = []) {
  const wanted = new Set((Array.isArray(types) ? types : []).map((value) => String(value || "").trim().toLowerCase()));
  return [...(Array.isArray(artifacts) ? artifacts : [])]
    .filter((item) => wanted.has(String(item?.type || "").trim().toLowerCase()))
    .sort((left, right) => artifactTime(left) - artifactTime(right))
    .pop() || null;
}

function summaryPrice(item = {}) {
  const directPrice = finiteNumber(item?.price);
  if (Number.isFinite(directPrice)) return directPrice;
  const low = finiteNumber(item?.price_low);
  const high = finiteNumber(item?.price_high);
  if (Number.isFinite(low) && Number.isFinite(high)) return (low + high) / 2;
  if (Number.isFinite(low)) return low;
  if (Number.isFinite(high)) return high;
  return null;
}

function summaryBounds(item = {}) {
  const low = finiteNumber(item?.price_low);
  const high = finiteNumber(item?.price_high);
  if (Number.isFinite(low) && Number.isFinite(high)) {
    return {
      low: Math.min(low, high),
      high: Math.max(low, high),
    };
  }
  const price = summaryPrice(item);
  if (Number.isFinite(price)) {
    return {
      low: price,
      high: price,
    };
  }
  return {
    low: null,
    high: null,
  };
}

function nearestDirectionalTarget(items = [], lastClose = null, direction = "") {
  if (!Number.isFinite(lastClose)) return null;
  const normalizedDirection = String(direction || "").trim().toLowerCase();
  const candidates = (Array.isArray(items) ? items : [])
    .map((item) => {
      const price = summaryPrice(item);
      if (!Number.isFinite(price)) return null;
      const distance = price - Number(lastClose);
      if (normalizedDirection === "up" && distance <= 0) return null;
      if (normalizedDirection === "down" && distance >= 0) return null;
      return {
        item,
        price,
        distance: Math.abs(distance),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.distance - right.distance);
  return candidates[0] || null;
}

const PHASE_TARGET_MODEL = "phase_specific";
const LEGACY_PHASE_TARGET_RANGE_MODE = "swings";

function buildSwingBasedRange(artifactSummary = {}, lastClose = null) {
  if (!Number.isFinite(lastClose)) return null;
  const swingHigh = nearestDirectionalTarget(
    artifactSummary?.by_type?.swing_high || [],
    lastClose,
    "up",
  );
  const swingLow = nearestDirectionalTarget(
    artifactSummary?.by_type?.swing_low || [],
    lastClose,
    "down",
  );
  const low = Number(swingLow?.price);
  const high = Number(swingHigh?.price);
  if (!Number.isFinite(low) && !Number.isFinite(high)) return null;
  return {
    low: Number.isFinite(low) ? low : null,
    high: Number.isFinite(high) ? high : null,
    source:
      Number.isFinite(low) && Number.isFinite(high)
        ? "swings_range"
        : Number.isFinite(low)
          ? "swing_low"
          : "swing_high",
    label:
      Number.isFinite(low) && Number.isFinite(high)
        ? "Swings"
        : Number.isFinite(low)
          ? "Swing low"
          : "Swing high",
  };
}

function directionalCandidatesForDirection(artifactSummary = {}, direction = "") {
  const normalizedDirection = String(direction || "").trim().toLowerCase();
  if (normalizedDirection === "up") {
    return [
      ...(artifactSummary?.resistances || []),
      ...(artifactSummary?.supplies || []),
      ...(artifactSummary?.liquidity || []),
    ];
  }
  if (normalizedDirection === "down") {
    return [
      ...(artifactSummary?.supports || []),
      ...(artifactSummary?.demands || []),
      ...(artifactSummary?.liquidity || []),
    ];
  }
  return [];
}

function normalizeDirectionalDirection({ bias = "neutral", trend = "range" } = {}) {
  if (bias === "bullish" || trend === "up") return "up";
  if (bias === "bearish" || trend === "down") return "down";
  return "";
}

function directionalTargetReferencePrice(anchorPrice = null, lastClose = null, direction = "") {
  const anchor = finiteNumber(anchorPrice);
  const close = finiteNumber(lastClose);
  const normalizedDirection = String(direction || "").trim().toLowerCase();
  if (normalizedDirection === "up") {
    return Math.max(
      Number.isFinite(anchor) ? anchor : -Infinity,
      Number.isFinite(close) ? close : -Infinity,
    );
  }
  if (normalizedDirection === "down") {
    return Math.min(
      Number.isFinite(anchor) ? anchor : Infinity,
      Number.isFinite(close) ? close : Infinity,
    );
  }
  return Number.isFinite(close) ? close : anchor;
}

function buildAnchorTargetPayload({
  kind = "",
  direction = "",
  anchorPrice = null,
  target = null,
  artifactSummary = {},
  lastClose = null,
  source = "",
  label = "",
  anchorLabel = "",
  targetLabel = "",
} = {}) {
  const normalizedDirection = String(direction || "").trim().toLowerCase();
  const swingRange = buildSwingBasedRange(artifactSummary, lastClose);
  let anchor = finiteNumber(anchorPrice);
  let targetPrice = finiteNumber(target?.price);
  if (!Number.isFinite(anchor)) {
    if (normalizedDirection === "up") {
      anchor = finiteNumber(swingRange?.low) ?? finiteNumber(lastClose);
    } else if (normalizedDirection === "down") {
      anchor = finiteNumber(swingRange?.high) ?? finiteNumber(lastClose);
    }
  }
  if (!Number.isFinite(targetPrice)) {
    if (normalizedDirection === "up") {
      targetPrice = finiteNumber(swingRange?.high);
    } else if (normalizedDirection === "down") {
      targetPrice = finiteNumber(swingRange?.low);
    }
  }
  if (
    Number.isFinite(anchor) &&
    Number.isFinite(targetPrice) &&
    Math.abs(anchor - targetPrice) <= Math.max(Math.abs(anchor) * 0.0000001, 0.0000001)
  ) {
    if (normalizedDirection === "up" && Number.isFinite(finiteNumber(swingRange?.high))) {
      targetPrice = finiteNumber(swingRange?.high);
    } else if (normalizedDirection === "down" && Number.isFinite(finiteNumber(swingRange?.low))) {
      targetPrice = finiteNumber(swingRange?.low);
    }
  }
  const fallbackPrice = targetPrice ?? anchor;
  if (!Number.isFinite(fallbackPrice)) return null;
  const low =
    Number.isFinite(anchor) && Number.isFinite(targetPrice)
      ? Math.min(anchor, targetPrice)
      : fallbackPrice;
  const high =
    Number.isFinite(anchor) && Number.isFinite(targetPrice)
      ? Math.max(anchor, targetPrice)
      : fallbackPrice;
  return {
    kind: String(kind || "").trim().toLowerCase(),
    direction: String(direction || "").trim().toLowerCase(),
    price: targetPrice ?? anchor ?? fallbackPrice,
    anchor_price: anchor,
    target_price: targetPrice ?? anchor ?? fallbackPrice,
    low,
    high,
    source: String(source || target?.item?.type || "level").trim().toLowerCase(),
    label: String(label || target?.item?.label || target?.item?.type || "Target").trim(),
    anchor_label: String(anchorLabel || "").trim(),
    target_label: String(targetLabel || target?.item?.label || target?.item?.type || "").trim(),
    range_mode: "anchor_to_target",
  };
}

function buildLegacyPhaseTarget({
  phaseInfo = {},
  bias = "neutral",
  trend = "range",
  lastClose = null,
  indicators = {},
  zones = {},
  artifactSummary = {},
  latestStructural = null,
} = {}) {
  const phase = String(phaseInfo?.phase || "").trim().toLowerCase();
  const source = String(phaseInfo?.source || "").trim().toLowerCase();
  const lastStructuralPrice = summaryPrice(toItemSummary(latestStructural, lastClose));
  const continuationDirection = normalizeDirectionalDirection({ bias, trend });

  if (phase === "pullback") {
    if (bias === "bullish" && trend === "up") {
      const zonePrice = summaryPrice(zones?.nearest_bullish_zone);
      const ema20 = finiteNumber(indicators?.ema_20);
      const targetPrice =
        source === "bullish_zone"
          ? zonePrice
          : source === "ema20_retest"
            ? ema20
            : zonePrice ?? ema20 ?? lastStructuralPrice;
      if (Number.isFinite(targetPrice)) {
        const bounds = summaryBounds(zones?.nearest_bullish_zone);
        return {
          kind: "pullback",
          direction: "up",
          price: targetPrice,
          low: Number.isFinite(bounds.low) ? bounds.low : targetPrice,
          high: Number.isFinite(bounds.high) ? bounds.high : targetPrice,
          source: source || "bullish_pullback",
          label: source === "ema20_retest" ? "EMA20" : "Bullish zone",
        };
      }
    }
    if (bias === "bearish" && trend === "down") {
      const zonePrice = summaryPrice(zones?.nearest_bearish_zone);
      const ema20 = finiteNumber(indicators?.ema_20);
      const targetPrice =
        source === "bearish_zone"
          ? zonePrice
          : source === "ema20_retest"
            ? ema20
            : zonePrice ?? ema20 ?? lastStructuralPrice;
      if (Number.isFinite(targetPrice)) {
        const bounds = summaryBounds(zones?.nearest_bearish_zone);
        return {
          kind: "pullback",
          direction: "down",
          price: targetPrice,
          low: Number.isFinite(bounds.low) ? bounds.low : targetPrice,
          high: Number.isFinite(bounds.high) ? bounds.high : targetPrice,
          source: source || "bearish_pullback",
          label: source === "ema20_retest" ? "EMA20" : "Bearish zone",
        };
      }
    }
    return null;
  }

  if (phase === "continuation" || phase === "impulse" || phase === "reversal") {
    if (!continuationDirection) return null;
    const target = nearestDirectionalTarget(
      directionalCandidatesForDirection(artifactSummary, continuationDirection),
      lastClose,
      continuationDirection,
    );
    if (target) {
      const bounds = summaryBounds(target?.item);
      const swingRange =
        LEGACY_PHASE_TARGET_RANGE_MODE === "swings"
          ? buildSwingBasedRange(artifactSummary, lastClose)
          : null;
      const resolvedLow = Number.isFinite(Number(swingRange?.low))
        ? Number(swingRange.low)
        : Number.isFinite(bounds.low)
          ? bounds.low
          : target.price;
      const resolvedHigh = Number.isFinite(Number(swingRange?.high))
        ? Number(swingRange.high)
        : Number.isFinite(bounds.high)
          ? bounds.high
          : target.price;
      return {
        kind: phase,
        direction: continuationDirection,
        price: target.price,
        low: resolvedLow,
        high: resolvedHigh,
        source: String(
          swingRange?.source || target?.item?.type || source || "level",
        )
          .trim()
          .toLowerCase(),
        label: String(
          swingRange?.label || target?.item?.label || target?.item?.type || "Target",
        ).trim(),
      };
    }
  }

  return null;
}

function buildPhaseSpecificTarget({
  phaseInfo = {},
  bias = "neutral",
  trend = "range",
  lastClose = null,
  indicators = {},
  zones = {},
  artifactSummary = {},
  latestStructural = null,
  latestPattern = null,
} = {}) {
  const phase = String(phaseInfo?.phase || "").trim().toLowerCase();
  const source = String(phaseInfo?.source || "").trim().toLowerCase();
  const direction = normalizeDirectionalDirection({ bias, trend });
  const latestStructuralSummary = latestStructural
    ? toItemSummary(latestStructural, lastClose)
    : null;
  const latestPatternSummary = latestPattern
    ? toItemSummary(latestPattern, lastClose)
    : null;

  if (phase === "impulse") {
    const breakoutPrice = summaryPrice(latestStructuralSummary);
    const referencePrice = directionalTargetReferencePrice(
      breakoutPrice,
      lastClose,
      direction,
    );
    const target = direction
      ? nearestDirectionalTarget(
          directionalCandidatesForDirection(artifactSummary, direction),
          referencePrice,
          direction,
        )
      : null;
    return buildAnchorTargetPayload({
      kind: phase,
      direction,
      anchorPrice: breakoutPrice,
      target,
      artifactSummary,
      lastClose,
      source: source || "bos",
      label: "Breakout -> target",
      anchorLabel: "Breakout",
      targetLabel: "Target",
    });
  }

  if (phase === "continuation") {
    const continuationAnchor =
      source === "vwap_ema_reclaim"
        ? finiteNumber(indicators?.ema_20) ??
          finiteNumber(indicators?.vwap) ??
          summaryPrice(latestStructuralSummary)
        : summaryPrice(latestPatternSummary) ?? summaryPrice(latestStructuralSummary);
    const referencePrice = directionalTargetReferencePrice(
      continuationAnchor,
      lastClose,
      direction,
    );
    const target = direction
      ? nearestDirectionalTarget(
          directionalCandidatesForDirection(artifactSummary, direction),
          referencePrice,
          direction,
        )
      : null;
    return buildAnchorTargetPayload({
      kind: phase,
      direction,
      anchorPrice: continuationAnchor,
      target,
      artifactSummary,
      lastClose,
      source: source || "continuation",
      label: "Continuation -> target",
      anchorLabel: source === "vwap_ema_reclaim" ? "Reclaim" : "Continuation",
      targetLabel: "Target",
    });
  }

  if (phase === "consolidation") {
    const lowerTarget = nearestDirectionalTarget(
      [
        ...(artifactSummary?.supports || []),
        ...(artifactSummary?.demands || []),
        ...(artifactSummary?.by_type?.swing_low || []),
      ],
      lastClose,
      "down",
    );
    const upperTarget = nearestDirectionalTarget(
      [
        ...(artifactSummary?.resistances || []),
        ...(artifactSummary?.supplies || []),
        ...(artifactSummary?.by_type?.swing_high || []),
      ],
      lastClose,
      "up",
    );
    const low = finiteNumber(lowerTarget?.price);
    const high = finiteNumber(upperTarget?.price);
    if (!Number.isFinite(low) && !Number.isFinite(high)) return null;
    return {
      kind: phase,
      direction: "range",
      price:
        Number.isFinite(low) && Number.isFinite(high)
          ? (low + high) / 2
          : high ?? low,
      anchor_price: low,
      target_price: high,
      low: Number.isFinite(low) ? low : high,
      high: Number.isFinite(high) ? high : low,
      source: "range_box",
      label: "Base range",
      anchor_label: "Range low",
      target_label: "Range high",
      range_mode: "box_low_high",
    };
  }

  if (phase === "reversal") {
    const reversalPrice =
      summaryPrice(latestStructuralSummary) ??
      summaryPrice(
        direction === "up" ? zones?.nearest_bullish_zone : zones?.nearest_bearish_zone,
      );
    const referencePrice = directionalTargetReferencePrice(
      reversalPrice,
      lastClose,
      direction,
    );
    const target = direction
      ? nearestDirectionalTarget(
          directionalCandidatesForDirection(artifactSummary, direction),
          referencePrice,
          direction,
        )
      : null;
    return buildAnchorTargetPayload({
      kind: phase,
      direction,
      anchorPrice: reversalPrice,
      target,
      artifactSummary,
      lastClose,
      source: source || "choch",
      label: "Reversal -> target",
      anchorLabel: "Reversal",
      targetLabel: "Target",
    });
  }

  if (phase === "pullback") {
    const rejectionZone =
      direction === "up" ? zones?.nearest_bullish_zone : zones?.nearest_bearish_zone;
    const rejectionBounds = summaryBounds(rejectionZone);
    const rejectionPrice =
      source === "ema20_retest"
        ? finiteNumber(indicators?.ema_20)
        : direction === "up"
          ? finiteNumber(rejectionBounds.high) ?? summaryPrice(rejectionZone)
          : finiteNumber(rejectionBounds.low) ?? summaryPrice(rejectionZone);
    const referencePrice = directionalTargetReferencePrice(
      rejectionPrice,
      lastClose,
      direction,
    );
    const target = direction
      ? nearestDirectionalTarget(
          directionalCandidatesForDirection(artifactSummary, direction),
          referencePrice,
          direction,
        )
      : null;
    return buildAnchorTargetPayload({
      kind: phase,
      direction,
      anchorPrice: rejectionPrice,
      target,
      artifactSummary,
      lastClose,
      source: source || "rejection",
      label: source === "ema20_retest" ? "EMA20 rejection -> target" : "Rejected level -> target",
      anchorLabel: source === "ema20_retest" ? "EMA20" : "Rejected",
      targetLabel: "Target",
    });
  }

  return null;
}

function buildPhaseTarget({
  phaseInfo = {},
  bias = "neutral",
  trend = "range",
  lastClose = null,
  indicators = {},
  zones = {},
  artifactSummary = {},
  latestStructural = null,
  latestPattern = null,
} = {}) {
  if (PHASE_TARGET_MODEL === "phase_specific") {
    return buildPhaseSpecificTarget({
      phaseInfo,
      bias,
      trend,
      lastClose,
      indicators,
      zones,
      artifactSummary,
      latestStructural,
      latestPattern,
    });
  }
  return buildLegacyPhaseTarget({
    phaseInfo,
    bias,
    trend,
    lastClose,
    indicators,
    zones,
    artifactSummary,
    latestStructural,
  });
}

function computeBias(bars = [], artifacts = []) {
  const indicators = computeIndicatorSnapshot(bars);
  const zoneInfo = zoneContext(artifacts, indicators.close);
  const latestStructural = latestByTypes(artifacts, ["bos", "choch", "sweep_high", "sweep_low"]);
  const structuralBias = artifactBias(latestStructural);
  const components = [];
  let score = 0;
  if (structuralBias === "bullish") {
    score += 3;
    components.push({ name: "structure", value: "bullish", weight: 3 });
  } else if (structuralBias === "bearish") {
    score -= 3;
    components.push({ name: "structure", value: "bearish", weight: -3 });
  }
  if (indicators.above_vwap === true) {
    score += 1;
    components.push({ name: "vwap", value: "above", weight: 1 });
  } else if (indicators.above_vwap === false) {
    score -= 1;
    components.push({ name: "vwap", value: "below", weight: -1 });
  }
  if (indicators.above_ema_20 === true) {
    score += 1;
    components.push({ name: "ema20", value: "above", weight: 1 });
  } else if (indicators.above_ema_20 === false) {
    score -= 1;
    components.push({ name: "ema20", value: "below", weight: -1 });
  }
  if (indicators.above_ema_50 === true) {
    score += 1;
    components.push({ name: "ema50", value: "above", weight: 1 });
  } else if (indicators.above_ema_50 === false) {
    score -= 1;
    components.push({ name: "ema50", value: "below", weight: -1 });
  }
  if (indicators.ema_stack === "bullish") {
    score += 1;
    components.push({ name: "ema_stack", value: "bullish", weight: 1 });
  } else if (indicators.ema_stack === "bearish") {
    score -= 1;
    components.push({ name: "ema_stack", value: "bearish", weight: -1 });
  }
  if (indicators.ema_20_slope === "up") {
    score += 1;
    components.push({ name: "ema20_slope", value: "up", weight: 1 });
  } else if (indicators.ema_20_slope === "down") {
    score -= 1;
    components.push({ name: "ema20_slope", value: "down", weight: -1 });
  }
  if (zoneInfo.in_bullish_zone) {
    score += 1;
    components.push({ name: "active_zone", value: "bullish_zone", weight: 1 });
  } else if (zoneInfo.in_bearish_zone) {
    score -= 1;
    components.push({ name: "active_zone", value: "bearish_zone", weight: -1 });
  }
  const window = bars.slice(-5);
  if (window.length < 2) {
    return {
      bias: score >= 2 ? "bullish" : score <= -2 ? "bearish" : "neutral",
      source: structuralBias !== "neutral" ? String(latestStructural?.type || "structure").trim().toLowerCase() : "insufficient_bars",
      item: latestStructural,
      score,
      strength: Math.abs(score) >= 5 ? "strong" : Math.abs(score) >= 3 ? "medium" : Math.abs(score) >= 1 ? "weak" : "neutral",
      components,
      indicators,
      zones: zoneInfo,
    };
  }
  const firstClose = Number(window[0]?.close);
  const lastClose = Number(window[window.length - 1]?.close);
  if (Number.isFinite(firstClose) && Number.isFinite(lastClose) && firstClose !== lastClose) {
    if (lastClose > firstClose) {
      score += 1;
      components.push({ name: "price_slope", value: "up", weight: 1 });
    } else {
      score -= 1;
      components.push({ name: "price_slope", value: "down", weight: -1 });
    }
  }
  const bias = score >= 2 ? "bullish" : score <= -2 ? "bearish" : "neutral";
  return {
    bias,
    source:
      structuralBias !== "neutral"
        ? String(latestStructural?.type || "structure").trim().toLowerCase()
        : indicators.ema_stack !== "flat"
          ? "ema_stack"
          : score === 0
            ? "flat_close"
            : "score",
    item: latestStructural,
    score,
    strength:
      Math.abs(score) >= 5
        ? "strong"
        : Math.abs(score) >= 3
          ? "medium"
          : Math.abs(score) >= 1
            ? "weak"
            : "neutral",
    components,
    indicators,
    zones: zoneInfo,
  };
}

function computeTrend(bars = [], biasInfo = {}) {
  if (bars.length < 4) {
    return { trend: "range", source: "insufficient_bars", score: 0, strength: "neutral", components: [] };
  }
  const indicators = biasInfo?.indicators || computeIndicatorSnapshot(bars);
  const structureState = computeRecentStructureState(bars);
  const components = [];
  let score = 0;
  const closes = bars.slice(-8).map((bar) => Number(bar?.close)).filter((value) => Number.isFinite(value));
  const firstClose = closes[0];
  const lastClose = closes[closes.length - 1];
  const recentRanges = bars.slice(-8).map((bar) => candleRange(bar)).filter((value) => Number.isFinite(value) && value > 0);
  const avgRange = median(recentRanges) || 0;
  const drift = Number.isFinite(firstClose) && Number.isFinite(lastClose) ? lastClose - firstClose : 0;
  if (Math.abs(drift) <= Math.max(avgRange * 0.35, Math.abs(lastClose || 0) * 0.0004)) {
    return {
      trend: "range",
      source: "compression",
      score: 0,
      strength: "neutral",
      components: [{ name: "compression", value: "true", weight: 0 }],
      structure: structureState,
      indicators,
    };
  }
  if (biasInfo?.bias === "bullish") {
    score += 2;
    components.push({ name: "bias", value: "bullish", weight: 2 });
  } else if (biasInfo?.bias === "bearish") {
    score -= 2;
    components.push({ name: "bias", value: "bearish", weight: -2 });
  }
  if (structureState.state === "up") {
    score += 2;
    components.push({ name: "structure", value: "hh_hl", weight: 2 });
  } else if (structureState.state === "down") {
    score -= 2;
    components.push({ name: "structure", value: "ll_lh", weight: -2 });
  }
  if (indicators.ema_stack === "bullish") {
    score += 1;
    components.push({ name: "ema_stack", value: "bullish", weight: 1 });
  } else if (indicators.ema_stack === "bearish") {
    score -= 1;
    components.push({ name: "ema_stack", value: "bearish", weight: -1 });
  }
  if (indicators.ema_20_slope === "up" && indicators.ema_50_slope !== "down") {
    score += 1;
    components.push({ name: "ema_slope", value: "up", weight: 1 });
  } else if (indicators.ema_20_slope === "down" && indicators.ema_50_slope !== "up") {
    score -= 1;
    components.push({ name: "ema_slope", value: "down", weight: -1 });
  }
  if (drift > Math.max(avgRange * 0.8, Math.abs(lastClose || 0) * 0.0006)) {
    score += 1;
    components.push({ name: "drift", value: "up", weight: 1 });
  } else if (drift < -Math.max(avgRange * 0.8, Math.abs(lastClose || 0) * 0.0006)) {
    score -= 1;
    components.push({ name: "drift", value: "down", weight: -1 });
  }
  const trend = score >= 3 ? "up" : score <= -3 ? "down" : "range";
  return {
    trend,
    source:
      trend === "range"
        ? "mixed_signals"
        : Math.abs(structureState.score) >= 2
          ? structureState.source
          : indicators.ema_stack !== "flat"
            ? "ema_stack"
            : "price_drift",
    score,
    strength:
      Math.abs(score) >= 5
        ? "strong"
        : Math.abs(score) >= 3
          ? "medium"
          : trend === "range"
            ? "neutral"
            : "weak",
    components,
    structure: structureState,
    indicators,
  };
}

function activeZoneHit(item = {}, close = null) {
  const low = Number(item?.price_low);
  const high = Number(item?.price_high);
  if (!Number.isFinite(close) || !Number.isFinite(low) || !Number.isFinite(high)) return false;
  return close >= Math.min(low, high) && close <= Math.max(low, high);
}

function computePhase({ bars = [], artifacts = [], bias = "neutral", trend = "range" } = {}) {
  const latestStructural = latestByTypes(artifacts, ["bos", "choch", "sweep_high", "sweep_low"]);
  const latestPattern = latestByTypes(artifacts, ["bullish_engulfing", "bearish_engulfing", "bullish_pin_bar", "bearish_pin_bar"]);
  const currentBar = bars[bars.length - 1] || null;
  const lastClose = finiteNumber(currentBar?.close);
  const indicators = computeIndicatorSnapshot(bars);
  const zones = zoneContext(artifacts, lastClose);
  const recentRanges = bars.slice(-8).map((bar) => candleRange(bar)).filter((value) => Number.isFinite(value) && value > 0);
  const avgRange = median(recentRanges) || 0;
  const currentRange = candleRange(currentBar);
  const body = Math.abs(Number(currentBar?.close) - Number(currentBar?.open));
  const displacement = currentRange > 0 && body / currentRange >= 0.6 && currentRange >= avgRange * 1.1;
  const inBullishZone = zones.in_bullish_zone;
  const inBearishZone = zones.in_bearish_zone;
  const pullbackToEma20 =
    Number.isFinite(lastClose) &&
    Number.isFinite(indicators.ema_20) &&
    Math.abs(lastClose - indicators.ema_20) <= Math.max(avgRange * 0.6, Math.abs(lastClose) * 0.0006);
  const reclaimedVwapBullish =
    bias === "bullish" &&
    indicators.above_vwap === true &&
    indicators.above_ema_20 === true;
  const reclaimedVwapBearish =
    bias === "bearish" &&
    indicators.above_vwap === false &&
    indicators.above_ema_20 === false;

  if (String(latestStructural?.type || "").trim().toLowerCase() === "choch") {
    return { phase: "reversal", source: "choch", detail: bias === "bearish" ? "reversal_down" : bias === "bullish" ? "reversal_up" : "reversal" };
  }
  if (String(latestStructural?.type || "").trim().toLowerCase() === "bos" && displacement) {
    return {
      phase: "impulse",
      source: "bos",
      detail: trend === "down" || bias === "bearish" ? "impulse_down" : "impulse_up",
    };
  }
  if (
    bias === "bullish" &&
    trend === "up" &&
    (inBullishZone || pullbackToEma20 || String(latestStructural?.type || "").trim().toLowerCase() === "sweep_low")
  ) {
    return {
      phase: "pullback",
      source: inBullishZone ? "bullish_zone" : pullbackToEma20 ? "ema20_retest" : "sweep_low",
      detail: "pullback_uptrend",
    };
  }
  if (
    bias === "bearish" &&
    trend === "down" &&
    (inBearishZone || pullbackToEma20 || String(latestStructural?.type || "").trim().toLowerCase() === "sweep_high")
  ) {
    return {
      phase: "pullback",
      source: inBearishZone ? "bearish_zone" : pullbackToEma20 ? "ema20_retest" : "sweep_high",
      detail: "pullback_downtrend",
    };
  }
  if (latestPattern && artifactBias(latestPattern) === bias && bias !== "neutral") {
    return {
      phase: "continuation",
      source: String(latestPattern?.type || "pattern").trim().toLowerCase(),
      detail: bias === "bearish" ? "continuation_down" : "continuation_up",
    };
  }
  if (reclaimedVwapBullish || reclaimedVwapBearish) {
    return {
      phase: "continuation",
      source: "vwap_ema_reclaim",
      detail: reclaimedVwapBearish ? "continuation_down" : "continuation_up",
    };
  }
  if (trend === "range") return { phase: "consolidation", source: "range", detail: "consolidation" };
  if (bias === "neutral") return { phase: "consolidation", source: "neutral_bias", detail: "consolidation" };
  return {
    phase: "continuation",
    source: "trend_bias",
    detail: bias === "bearish" ? "continuation_down" : "continuation_up",
  };
}

function summarizeArtifacts(artifacts = [], lastClose = null) {
  const summaries = (Array.isArray(artifacts) ? artifacts : []).map((item) => toItemSummary(item, lastClose));
  const byType = {};
  summaries.forEach((item) => {
    const type = String(item?.type || "").trim().toLowerCase();
    if (!type) return;
    if (!Array.isArray(byType[type])) byType[type] = [];
    byType[type].push(item);
  });
  Object.keys(byType).forEach((key) => {
    byType[key] = sortSummariesByDistance(byType[key]).slice(0, 6);
  });
  return {
    supports: sortSummariesByDistance([
      ...(byType.support || []),
      ...(byType.swing_low || []),
    ]).slice(0, 4),
    resistances: sortSummariesByDistance([
      ...(byType.swing_high || []),
      ...(byType.pdh || []),
      ...(byType.liquidity_high || []),
    ]).slice(0, 4),
    demands: sortSummariesByDistance(byType.demand || []).slice(0, 4),
    supplies: sortSummariesByDistance(
      summaries.filter(
        (item) => item.type === "ob" && item.bias === "bearish",
      ),
    ).slice(0, 4),
    key_levels: sortSummariesByDistance(
      summaries.filter((item) =>
        ["support", "demand", "swing_high", "swing_low", "pdh", "pdl", "liquidity_high", "liquidity_low"].includes(item.type),
      ),
    ).slice(0, 8),
    liquidity: sortSummariesByDistance([
      ...(byType.liquidity_high || []),
      ...(byType.liquidity_low || []),
    ]).slice(0, 6),
    sweeps: sortSummariesByDistance([
      ...(byType.sweep_high || []),
      ...(byType.sweep_low || []),
    ]).slice(0, 6),
    fvgs: sortSummariesByDistance(byType.fvg || []).slice(0, 6),
    order_blocks: sortSummariesByDistance(byType.ob || []).slice(0, 6),
    patterns: sortSummariesByDistance(
      summaries.filter((item) =>
        [
          "bullish_engulfing",
          "bearish_engulfing",
          "bullish_pin_bar",
          "bearish_pin_bar",
          "inside_bar",
          "outside_bar",
        ].includes(item.type),
      ),
    ).slice(0, 6),
    structure: sortSummariesByDistance([
      ...(byType.bos || []),
      ...(byType.choch || []),
      ...(byType.sweep_high || []),
      ...(byType.sweep_low || []),
    ]).slice(0, 6),
    by_type: byType,
  };
}

function buildTfAnalysis({
  bars = [],
  timeframe = "",
  derivedArtifacts = null,
  rulesChecked = [],
  rulesMatched = [],
} = {}) {
  const normalizedTf = normalizeTfKey(timeframe);
  const normalizedBars = normalizeBars(bars);
  const artifacts = Array.isArray(derivedArtifacts)
    ? derivedArtifacts
    : artifactDetection.buildDerivedItemsFromBars(normalizedBars, normalizedTf);
  const currentBar = normalizedBars[normalizedBars.length - 1] || null;
  const lastClose = Number(currentBar?.close);
  const biasInfo = computeBias(normalizedBars, artifacts);
  const trendInfo = computeTrend(normalizedBars, biasInfo);
  const phaseInfo = computePhase({
    bars: normalizedBars,
    artifacts,
    bias: biasInfo.bias,
    trend: trendInfo.trend,
  });
  const latestStructural = latestByTypes(artifacts, ["bos", "choch", "sweep_high", "sweep_low"]);
  const latestPattern = latestByTypes(artifacts, ["bullish_engulfing", "bearish_engulfing", "bullish_pin_bar", "bearish_pin_bar"]);
  const artifactSummary = summarizeArtifacts(artifacts, lastClose);
  const phaseTarget = buildPhaseTarget({
    phaseInfo,
    bias: biasInfo.bias,
    trend: trendInfo.trend,
    lastClose,
    indicators: biasInfo?.indicators || trendInfo?.indicators || {},
    zones: biasInfo?.zones || zoneContext(artifacts, lastClose),
    artifactSummary,
    latestStructural,
    latestPattern,
  });
  return {
    timeframe: normalizedTf,
    bias: biasInfo.bias,
    bias_source: biasInfo.source,
    bias_score: Number(biasInfo?.score || 0),
    bias_strength: String(biasInfo?.strength || "neutral"),
    trend: trendInfo.trend,
    trend_source: trendInfo.source,
    trend_score: Number(trendInfo?.score || 0),
    trend_strength: String(trendInfo?.strength || "neutral"),
    phase: phaseInfo.phase,
    phase_source: phaseInfo.source,
    phase_detail: String(phaseInfo?.detail || phaseInfo?.phase || "").trim().toLowerCase(),
    phase_target: phaseTarget ? clone(phaseTarget) : null,
    phase_target_price: Number(phaseTarget?.price) || null,
    phase_target_source: String(phaseTarget?.source || "").trim().toLowerCase(),
    phase_target_label: String(phaseTarget?.label || "").trim(),
    structure_state: String(latestStructural?.type || "").trim().toLowerCase() || "",
    last_bar_time: Number(currentBar?.time || 0) || null,
    last_close: lastClose,
    last_range: Number.isFinite(candleRange(currentBar)) ? candleRange(currentBar) : null,
    indicators: clone(biasInfo?.indicators || trendInfo?.indicators || computeIndicatorSnapshot(normalizedBars)),
    score_components: {
      bias: clone(biasInfo?.components || []),
      trend: clone(trendInfo?.components || []),
    },
    supports: artifactSummary.supports,
    resistances: artifactSummary.resistances,
    demands: artifactSummary.demands,
    supplies: artifactSummary.supplies,
    key_levels: artifactSummary.key_levels,
    liquidity: artifactSummary.liquidity,
    sweeps: artifactSummary.sweeps,
    fvgs: artifactSummary.fvgs,
    order_blocks: artifactSummary.order_blocks,
    patterns: artifactSummary.patterns,
    structure: artifactSummary.structure,
    divergence: {
      rsi: null,
      macd: null,
    },
    rules_checked: Array.isArray(rulesChecked) ? clone(rulesChecked) : [],
    rules_matched: Array.isArray(rulesMatched) ? clone(rulesMatched) : [],
    artifacts: artifacts.map((item) => toItemSummary(item, lastClose)),
    artifacts_by_type: artifactSummary.by_type,
  };
}

function buildMultiTfAnalysis(barsByTf = {}, options = {}) {
  const entries = Object.entries(
    barsByTf && typeof barsByTf === "object" && !Array.isArray(barsByTf) ? barsByTf : {},
  )
    .map(([tfRaw, bars]) => ({
      tf: normalizeTfKey(tfRaw),
      bars: Array.isArray(bars) ? bars : [],
    }))
    .filter((entry) => entry.tf && entry.bars.length)
    .sort((left, right) => timeframeWeight(right.tf) - timeframeWeight(left.tf));
  const out = {};
  entries.forEach(({ tf, bars }) => {
    const entryOptions =
      options && typeof options === "object" && options[tf] && typeof options[tf] === "object"
        ? options[tf]
        : {};
    out[tf] = buildTfAnalysis({
      bars,
      timeframe: tf,
      derivedArtifacts: entryOptions.derivedArtifacts || null,
      rulesChecked: entryOptions.rulesChecked || [],
      rulesMatched: entryOptions.rulesMatched || [],
    });
  });
  return out;
}

module.exports = {
  buildMultiTfAnalysis,
  buildTfAnalysis,
  normalizeTfKey,
  timeframeWeight,
};
