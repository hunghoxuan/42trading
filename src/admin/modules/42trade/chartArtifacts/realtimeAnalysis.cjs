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

function computeBias(bars = [], artifacts = []) {
  const latestStructural = latestByTypes(artifacts, ["bos", "choch", "sweep_high", "sweep_low"]);
  const structuralBias = artifactBias(latestStructural);
  if (structuralBias !== "neutral") {
    return {
      bias: structuralBias,
      source: String(latestStructural?.type || "structure").trim().toLowerCase(),
      item: latestStructural,
    };
  }
  const window = bars.slice(-5);
  if (window.length < 2) return { bias: "neutral", source: "insufficient_bars", item: null };
  const firstClose = Number(window[0]?.close);
  const lastClose = Number(window[window.length - 1]?.close);
  if (!Number.isFinite(firstClose) || !Number.isFinite(lastClose) || firstClose === lastClose) {
    return { bias: "neutral", source: "flat_close", item: null };
  }
  return {
    bias: lastClose > firstClose ? "bullish" : "bearish",
    source: "price_slope",
    item: null,
  };
}

function computeTrend(bars = [], biasInfo = {}) {
  if (bars.length < 4) return { trend: "range", source: "insufficient_bars" };
  const closes = bars.slice(-8).map((bar) => Number(bar?.close)).filter((value) => Number.isFinite(value));
  const firstClose = closes[0];
  const lastClose = closes[closes.length - 1];
  const recentRanges = bars.slice(-8).map((bar) => candleRange(bar)).filter((value) => Number.isFinite(value) && value > 0);
  const avgRange = median(recentRanges) || 0;
  const drift = Number.isFinite(firstClose) && Number.isFinite(lastClose) ? lastClose - firstClose : 0;
  if (Math.abs(drift) <= Math.max(avgRange * 0.35, Math.abs(lastClose || 0) * 0.0004)) {
    return { trend: "range", source: "compression" };
  }
  if (biasInfo?.bias === "bullish") return { trend: "up", source: biasInfo.source || "bias" };
  if (biasInfo?.bias === "bearish") return { trend: "down", source: biasInfo.source || "bias" };
  return { trend: drift > 0 ? "up" : "down", source: "price_drift" };
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
  const recentRanges = bars.slice(-8).map((bar) => candleRange(bar)).filter((value) => Number.isFinite(value) && value > 0);
  const avgRange = median(recentRanges) || 0;
  const currentRange = candleRange(currentBar);
  const body = Math.abs(Number(currentBar?.close) - Number(currentBar?.open));
  const displacement = currentRange > 0 && body / currentRange >= 0.6 && currentRange >= avgRange * 1.1;
  const bullishZones = artifacts.filter((item) => {
    const type = String(item?.type || "").trim().toLowerCase();
    return artifactBias(item) === "bullish" && ["demand", "fvg", "ob", "support"].includes(type);
  });
  const bearishZones = artifacts.filter((item) => {
    const type = String(item?.type || "").trim().toLowerCase();
    return artifactBias(item) === "bearish" && ["supply", "fvg", "ob", "resistance"].includes(type);
  });
  const inBullishZone = bullishZones.some((item) => activeZoneHit(item, lastClose));
  const inBearishZone = bearishZones.some((item) => activeZoneHit(item, lastClose));

  if (String(latestStructural?.type || "").trim().toLowerCase() === "choch") {
    return { phase: "reversal", source: "choch" };
  }
  if (String(latestStructural?.type || "").trim().toLowerCase() === "bos" && displacement) {
    return { phase: "impulse", source: "bos" };
  }
  if (bias === "bullish" && (inBullishZone || String(latestStructural?.type || "") === "sweep_low")) {
    return { phase: "pullback", source: inBullishZone ? "bullish_zone" : "sweep_low" };
  }
  if (bias === "bearish" && (inBearishZone || String(latestStructural?.type || "") === "sweep_high")) {
    return { phase: "pullback", source: inBearishZone ? "bearish_zone" : "sweep_high" };
  }
  if (latestPattern && artifactBias(latestPattern) === bias && bias !== "neutral") {
    return { phase: "continuation", source: String(latestPattern?.type || "pattern").trim().toLowerCase() };
  }
  if (trend === "range") return { phase: "consolidation", source: "range" };
  if (bias === "neutral") return { phase: "consolidation", source: "neutral_bias" };
  return { phase: "continuation", source: "trend_bias" };
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
    supports: sortSummariesByDistance([...(byType.support || []), ...(byType.swing_low || [])]).slice(0, 4),
    resistances: sortSummariesByDistance([...(byType.swing_high || []), ...(byType.pdh || []), ...(byType.liquidity_high || [])]).slice(0, 4),
    demands: sortSummariesByDistance(byType.demand || []).slice(0, 4),
    supplies: sortSummariesByDistance(
      summaries.filter((item) => item.type === "ob" && item.bias === "bearish"),
    ).slice(0, 4),
    key_levels: sortSummariesByDistance(
      summaries.filter((item) =>
        ["support", "demand", "swing_high", "swing_low", "pdh", "pdl", "liquidity_high", "liquidity_low"].includes(item.type),
      ),
    ).slice(0, 8),
    liquidity: sortSummariesByDistance([...(byType.liquidity_high || []), ...(byType.liquidity_low || [])]).slice(0, 6),
    sweeps: sortSummariesByDistance([...(byType.sweep_high || []), ...(byType.sweep_low || [])]).slice(0, 6),
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
    structure: sortSummariesByDistance([...(byType.bos || []), ...(byType.choch || []), ...(byType.sweep_high || []), ...(byType.sweep_low || [])]).slice(0, 6),
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
  const artifactSummary = summarizeArtifacts(artifacts, lastClose);
  return {
    timeframe: normalizedTf,
    bias: biasInfo.bias,
    bias_source: biasInfo.source,
    trend: trendInfo.trend,
    trend_source: trendInfo.source,
    phase: phaseInfo.phase,
    phase_source: phaseInfo.source,
    structure_state: String(latestStructural?.type || "").trim().toLowerCase() || "",
    last_bar_time: Number(currentBar?.time || 0) || null,
    last_close: lastClose,
    last_range: Number.isFinite(candleRange(currentBar)) ? candleRange(currentBar) : null,
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
    divergence: { rsi: null, macd: null },
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
    .map(([tfRaw, bars]) => ({ tf: normalizeTfKey(tfRaw), bars: Array.isArray(bars) ? bars : [] }))
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
