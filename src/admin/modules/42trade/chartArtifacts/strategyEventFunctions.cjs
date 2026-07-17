"use strict";

const artifactDetection = require("./detectArtifacts.cjs");
const { buildTfAnalysis } = require("./realtimeAnalysis.cjs");
const {
  buildSuggestedTradeLevels,
  resolveSuggestedTradeTimeframes,
} = require("../../../shared/utils/suggestedTradeLevels.cjs");

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

function isAllTimeframesSelection(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "all" || normalized === "all_tfs";
}

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function isArtifactResult(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.kind === "artifact_result" &&
    Array.isArray(value.matches)
  );
}

function ruleResultTruthy(value) {
  if (isArtifactResult(value)) return value.matches.length > 0;
  return Boolean(value);
}

function resultMatches(value) {
  if (!isArtifactResult(value)) return [];
  return Array.isArray(value.matches) ? value.matches : [];
}

function artifactTime(item = {}) {
  return Number(item?.anchor_time ?? item?.bar_end ?? item?.bar_start ?? item?.time ?? 0) || 0;
}

function buildArtifactResult(functionName = "", matches = [], extra = {}) {
  const normalizedMatches = (Array.isArray(matches) ? matches : []).filter(Boolean);
  if (!normalizedMatches.length) return false;
  return {
    kind: "artifact_result",
    functionName: String(functionName || "").trim().toLowerCase(),
    matches: normalizedMatches,
    latest: normalizedMatches[normalizedMatches.length - 1] || null,
    timeframe: String(extra.timeframe || normalizedMatches[normalizedMatches.length - 1]?.timeframe || "").trim(),
    meta: extra && typeof extra === "object" ? clone(extra) : {},
  };
}

function mergeArtifactResults(operator = "and", values = []) {
  const normalized = Array.isArray(values) ? values : [];
  if (operator === "and" || operator === "then") {
    if (!normalized.every(ruleResultTruthy)) return false;
  } else if (!normalized.some(ruleResultTruthy)) {
    return false;
  }
  if (operator === "then") {
    let previousTime = 0;
    for (const value of normalized) {
      const matches = resultMatches(value);
      if (!matches.length) continue;
      const latestTime = Math.max(...matches.map((item) => artifactTime(item)));
      if (latestTime < previousTime) return false;
      previousTime = latestTime;
    }
  }
  const mergedMatches = normalized.flatMap((value) => resultMatches(value));
  if (!mergedMatches.length) return true;
  const deduped = [];
  const seen = new Set();
  for (const match of mergedMatches) {
    const key = String(match?.id || `${match?.type || "artifact"}:${match?.anchor_time || match?.time || ""}:${match?.price || ""}`);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(match);
  }
  return buildArtifactResult(operator, deduped, { operator });
}

function currentTimeframe(ctx = {}) {
  return normalizeTfKey(
    ctx?.tf ||
      ctx?.timeframe ||
      ctx?.market?.tf ||
      ctx?.strategy?.market?.tf ||
      "",
  );
}

function resolveFunctionTimeframe(evaluatedArgs = [], ctx = {}) {
  const rawTf = evaluatedArgs.length > 1 ? evaluatedArgs[evaluatedArgs.length - 1] : "";
  if (isAllTimeframesSelection(rawTf)) return "all";
  const requested = normalizeTfKey(rawTf);
  const current = currentTimeframe(ctx);
  if (!requested) return current;
  return requested;
}

function availableRequestedTimeframesForAll(ctx = {}) {
  const current = currentTimeframe(ctx);
  const currentWeight = timeframeWeight(current);
  const available = [
    current,
    ...Object.keys(ctx?.multiTf && typeof ctx.multiTf === "object" ? ctx.multiTf : {}),
  ]
    .map((tf) => normalizeTfKey(tf))
    .filter(Boolean)
    .filter((tf) => timeframeWeight(tf) >= currentWeight);
  return Array.from(new Set(available)).sort(
    (left, right) => timeframeWeight(left) - timeframeWeight(right),
  );
}

function contextAnchorTime(ctx = {}) {
  const time = Number(ctx?.bar?.time);
  if (Number.isFinite(time) && time > 0) return time;
  const bars = Array.isArray(ctx?.bars) ? ctx.bars : [];
  const index = Number(ctx?.index);
  if (Number.isInteger(index) && index >= 0 && index < bars.length) {
    const barTime = Number(bars[index]?.time);
    if (Number.isFinite(barTime) && barTime > 0) return barTime;
  }
  return 0;
}

function resolveTfContext(requestedTf = "", ctx = {}) {
  const normalizedTf = normalizeTfKey(requestedTf || currentTimeframe(ctx));
  const currentTf = currentTimeframe(ctx);
  if (!normalizedTf || normalizedTf === currentTf) {
    return {
      timeframe: currentTf,
      bars: Array.isArray(ctx?.bars) ? ctx.bars : [],
      derivedArtifacts: Array.isArray(ctx?.derivedArtifacts) ? ctx.derivedArtifacts : [],
      currentIndex: resolveCurrentIndex(ctx),
      currentBar: resolveCurrentBar(ctx),
    };
  }
  const multiTf = ctx?.multiTf && typeof ctx.multiTf === "object" ? ctx.multiTf : {};
  const tfEntry = multiTf[normalizedTf];
  const bars = Array.isArray(tfEntry?.bars) ? tfEntry.bars : [];
  if (!bars.length) {
    return {
      timeframe: normalizedTf,
      bars: [],
      derivedArtifacts: [],
      currentIndex: -1,
      currentBar: null,
    };
  }
  const anchorTime = contextAnchorTime(ctx);
  let currentIndex = -1;
  for (let index = 0; index < bars.length; index += 1) {
    const barTime = Number(bars[index]?.time);
    if (!Number.isFinite(barTime) || barTime > anchorTime) break;
    currentIndex = index;
  }
  return {
    timeframe: normalizedTf,
    bars,
    derivedArtifacts: Array.isArray(tfEntry?.derivedArtifacts) ? tfEntry.derivedArtifacts : [],
    currentIndex,
    currentBar: currentIndex >= 0 ? bars[currentIndex] : null,
  };
}

function resolveCurrentBar(ctx = {}) {
  if (ctx?.bar && typeof ctx.bar === "object") return ctx.bar;
  const bars = Array.isArray(ctx?.bars) ? ctx.bars : [];
  const index = Number(ctx?.index);
  return Number.isInteger(index) && index >= 0 && index < bars.length ? bars[index] : null;
}

function resolveCurrentIndex(ctx = {}) {
  const bars = Array.isArray(ctx?.bars) ? ctx.bars : [];
  const index = Number(ctx?.index);
  if (Number.isInteger(index) && index >= 0) return Math.min(index, bars.length - 1);
  return bars.length - 1;
}

function resolveBars(ctx = {}) {
  return Array.isArray(ctx?.bars) ? ctx.bars : [];
}

function parseSuggestedTfSelection(value, ctx = {}) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeTfKey(item)).filter(Boolean);
  }
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "all" || raw === "all_tfs") {
    return availableRequestedTimeframesForAll(ctx);
  }
  return raw
    .split(/[,\s|]+/)
    .map((item) => normalizeTfKey(item))
    .filter(Boolean);
}

function buildArtifactItemsByTfForSuggestedLevels(ctx = {}) {
  const artifactItemsByTf = {};
  const currentTf = currentTimeframe(ctx);
  if (currentTf && Array.isArray(ctx?.derivedArtifacts)) {
    artifactItemsByTf[currentTf] = ctx.derivedArtifacts;
  }
  const multiTf = ctx?.multiTf && typeof ctx.multiTf === "object" ? ctx.multiTf : {};
  Object.entries(multiTf).forEach(([tfRaw, entry]) => {
    const tfKey = normalizeTfKey(tfRaw);
    if (!tfKey) return;
    const items = Array.isArray(entry?.derivedArtifacts) ? entry.derivedArtifacts : [];
    if (items.length) artifactItemsByTf[tfKey] = items;
  });
  return artifactItemsByTf;
}

function resolveSuggestedTradeLevelsForContext(
  direction = "buy",
  tfSelection = "all",
  minRr = 1.5,
  ctx = {},
) {
  const entry = resolvePriceActionEntry(ctx);
  if (!Number.isFinite(entry) || entry <= 0) return { sl: null, tp: null };
  const artifactItemsByTf = buildArtifactItemsByTfForSuggestedLevels(ctx);
  const selectedTfs = resolveSuggestedTradeTimeframes(
    currentTimeframe(ctx),
    parseSuggestedTfSelection(tfSelection, ctx),
    artifactItemsByTf,
  );
  return buildSuggestedTradeLevels({
    side: String(direction || "").trim().toUpperCase() === "SELL" ? "SELL" : "BUY",
    entryPrice: entry,
    referencePrice: entry,
    activeTf: currentTimeframe(ctx),
    selectedTfs,
    artifactItemsByTf,
    minRr,
  });
}

function matchArtifactBias(item = {}, requestedBias = "") {
  const wanted = String(requestedBias || "").trim().toLowerCase();
  if (!wanted) return true;
  const subtype = String(item?.subtype || "").trim().toLowerCase();
  const type = String(item?.type || "").trim().toLowerCase();
  const bias = String(item?.payload?.bias || item?.direction || subtype || type || "").trim().toLowerCase();
  if (!bias) return false;
  if (["buy", "bull", "bullish", "long", "up"].includes(wanted)) {
    return ["buy", "bull", "bullish", "long", "up"].includes(bias);
  }
  if (["sell", "bear", "bearish", "short", "down"].includes(wanted)) {
    return ["sell", "bear", "bearish", "short", "down"].includes(bias);
  }
  return bias === wanted;
}

function buildSyntheticMatch({
  functionName = "",
  timeframe = "",
  bar = null,
  price = null,
  bias = "",
  level = null,
  payload = {},
}) {
  const time = Number(bar?.time);
  if (!bar || !Number.isFinite(time)) return null;
  const finalPrice = Number.isFinite(Number(price))
    ? Number(price)
    : Number(bar?.close);
  return {
    id: artifactDetection.buildItemId([
      "strategy_event",
      timeframe,
      functionName,
      bias,
      time,
      finalPrice,
      level,
    ]),
    family: "strategy_event",
    type: String(functionName || "").trim().toLowerCase(),
    subtype: String(bias || "").trim().toLowerCase(),
    label: String(functionName || "event").trim(),
    timeframe,
    source: "rule_function",
    origin: "strategy",
    direction:
      String(bias || "").trim().toLowerCase() === "bearish" ? "SELL" :
      String(bias || "").trim().toLowerCase() === "bullish" ? "BUY" :
      "",
    price: Number.isFinite(finalPrice) ? finalPrice : null,
    price_low: Number(bar?.low),
    price_high: Number(bar?.high),
    bar_start: time,
    bar_end: time,
    anchor_time: time,
    payload: {
      level: Number.isFinite(Number(level)) ? Number(level) : null,
      ...clone(payload),
    },
  };
}

function selectArtifactsForContext(ctx = {}) {
  if (Array.isArray(ctx?.derivedArtifacts)) return ctx.derivedArtifacts;
  return artifactDetection.buildDerivedItemsFromBars(resolveBars(ctx), currentTimeframe(ctx));
}

function filterArtifactsBeforeCurrentBar(items = [], ctx = {}) {
  const currentBar = resolveCurrentBar(ctx);
  const currentTime = Number(currentBar?.time || 0);
  return (Array.isArray(items) ? items : [])
    .filter((item) => Number(item?.anchor_time ?? item?.bar_end ?? item?.bar_start ?? 0) <= currentTime)
    .sort(
      (left, right) =>
        Number(left?.anchor_time ?? left?.bar_end ?? left?.bar_start ?? 0) -
        Number(right?.anchor_time ?? right?.bar_end ?? right?.bar_start ?? 0),
    );
}

function normalizeLevel(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toFiniteNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizePlanDirection(value = "", fallback = "buy") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["sell", "short", "bear", "bearish"].includes(normalized)) return "sell";
  if (["buy", "long", "bull", "bullish"].includes(normalized)) return "buy";
  return String(fallback || "buy").trim().toLowerCase() === "sell" ? "sell" : "buy";
}

function resolvePriceActionEntry(ctx = {}) {
  const bar = resolveCurrentBar(ctx);
  return toFiniteNumber(bar?.close) ?? toFiniteNumber(bar?.open);
}

function inferPipSize(entry = null, explicitPipSize = null) {
  const pipSize = toFiniteNumber(explicitPipSize);
  if (Number.isFinite(pipSize) && pipSize > 0) return pipSize;
  const price = Math.abs(toFiniteNumber(entry));
  if (!Number.isFinite(price) || price <= 0) return null;
  if (price >= 1000) return 1;
  if (price >= 10) return 0.01;
  return 0.0001;
}

function enforceMinimumStopDistance(
  entry = null,
  stop = null,
  direction = "buy",
  minStopPips = 0,
  pipSize = null,
) {
  const entryNum = toFiniteNumber(entry);
  const stopNum = toFiniteNumber(stop);
  const minPips = Math.max(0, Number(minStopPips) || 0);
  const resolvedPipSize = inferPipSize(entryNum, pipSize);
  if (
    !Number.isFinite(entryNum) ||
    !Number.isFinite(stopNum) ||
    !(minPips > 0) ||
    !Number.isFinite(resolvedPipSize) ||
    !(resolvedPipSize > 0)
  ) {
    return stopNum;
  }
  const minimumDistance = minPips * resolvedPipSize;
  if (!(minimumDistance > 0)) return stopNum;
  if (Math.abs(entryNum - stopNum) >= minimumDistance) return stopNum;
  const normalizedDirection = normalizePlanDirection(direction, "buy");
  return normalizedDirection === "sell"
    ? entryNum + minimumDistance
    : entryNum - minimumDistance;
}

function resolvePriceActionStop(
  direction = "buy",
  lookbackBars = 3,
  bufferPct = 0,
  minStopPips = 0,
  pipSize = null,
  ctx = {},
) {
  const bars = resolveBars(ctx);
  const currentIndex = resolveCurrentIndex(ctx);
  if (!bars.length || currentIndex < 0) return null;
  const windowSize = Math.max(1, Math.round(Number(lookbackBars) || 3));
  const startIndex = Math.max(0, currentIndex - windowSize + 1);
  const slice = bars.slice(startIndex, currentIndex + 1).filter(Boolean);
  if (!slice.length) return null;
  const normalizedDirection = normalizePlanDirection(direction, "buy");
  const pct = Math.max(0, Number(bufferPct) || 0);
  const entry = resolvePriceActionEntry(ctx);
  if (normalizedDirection === "sell") {
    const swingHigh = slice.reduce((max, bar) => {
      const value = toFiniteNumber(bar?.high);
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(swingHigh)) return null;
    return enforceMinimumStopDistance(
      entry,
      swingHigh + swingHigh * pct,
      normalizedDirection,
      minStopPips,
      pipSize,
    );
  }
  const swingLow = slice.reduce((min, bar) => {
    const value = toFiniteNumber(bar?.low);
    return Number.isFinite(value) ? Math.min(min, value) : min;
  }, Number.POSITIVE_INFINITY);
  if (!Number.isFinite(swingLow)) return null;
  return enforceMinimumStopDistance(
    entry,
    swingLow - swingLow * pct,
    normalizedDirection,
    minStopPips,
    pipSize,
  );
}

function resolvePriceActionTarget(
  direction = "buy",
  lookbackBars = 3,
  rrMultiple = 2,
  bufferPct = 0,
  minStopPips = 0,
  pipSize = null,
  ctx = {},
) {
  const entry = resolvePriceActionEntry(ctx);
  const stop = resolvePriceActionStop(
    direction,
    lookbackBars,
    bufferPct,
    minStopPips,
    pipSize,
    ctx,
  );
  if (!Number.isFinite(entry) || !Number.isFinite(stop)) return null;
  const risk = Math.abs(entry - stop);
  const rr = Math.max(0.1, Number(rrMultiple) || 2);
  if (!Number.isFinite(risk) || risk <= 0) return null;
  const normalizedDirection = normalizePlanDirection(direction, "buy");
  return normalizedDirection === "sell"
    ? entry - risk * rr
    : entry + risk * rr;
}

function roundLevelKey(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return num.toFixed(6);
}

function extractArtifactLevels(item = {}) {
  const candidates = [
    item?.price,
    item?.payload?.level,
    item?.payload?.source_swing_price,
    item?.payload?.swept_swing_price,
    item?.payload?.mitigation_price,
    item?.price_high,
    item?.price_low,
  ]
    .map(normalizeLevel)
    .filter((value) => Number.isFinite(value));
  return Array.from(new Set(candidates.map((value) => roundLevelKey(value))))
    .map((key) => Number(key))
    .filter((value) => Number.isFinite(value));
}

function resolveImplicitLevelEntries(ctx = {}) {
  const supportedTypes = new Set([
    "liquidity_high",
    "liquidity_low",
    "fvg",
    "ob",
    "support",
    "demand",
    "pdh",
    "pdl",
  ]);
  const recentArtifacts = filterArtifactsBeforeCurrentBar(
    selectArtifactsForContext(ctx),
    ctx,
  )
    .filter((item) =>
      supportedTypes.has(String(item?.type || "").trim().toLowerCase()),
    )
    .slice(-12)
    .reverse();
  const levels = [];
  const seen = new Set();
  for (const item of recentArtifacts) {
    for (const level of extractArtifactLevels(item)) {
      const key = roundLevelKey(level);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      levels.push({
        price: level,
        sourceId: String(item?.id || "").trim(),
        sourceType: String(item?.type || "").trim().toLowerCase(),
        sourceTime: Number(item?.anchor_time ?? item?.bar_end ?? item?.bar_start ?? item?.time) || 0,
      });
      if (levels.length >= 8) return levels;
    }
  }
  return levels;
}

function resolveImplicitLevels(ctx = {}) {
  return resolveImplicitLevelEntries(ctx)
    .map((entry) => Number(entry?.price))
    .filter((value) => Number.isFinite(value));
}

function findLevelMatches(functionName = "", level = null, ctx = {}, predicate = () => false) {
  const tfContext = resolveTfContext(currentTimeframe(ctx), ctx);
  const timeframe = tfContext.timeframe;
  const bars = tfContext.bars;
  const endIndex = tfContext.currentIndex;
  if (!bars.length || endIndex <= 0) return false;
  const explicitLevel = normalizeLevel(level);
  const candidateLevels = Number.isFinite(explicitLevel)
    ? [explicitLevel]
    : resolveImplicitLevels({
        ...ctx,
        tf: tfContext.timeframe,
        bars: tfContext.bars,
        bar: tfContext.currentBar,
        index: tfContext.currentIndex,
        derivedArtifacts: tfContext.derivedArtifacts,
      });
  if (!candidateLevels.length) return false;
  const matches = [];
  const seen = new Set();
  for (const candidateLevel of candidateLevels) {
    for (let index = 1; index <= endIndex; index += 1) {
      const bar = bars[index];
      const prev = bars[index - 1];
      if (!bar || !prev) continue;
      const result = predicate({ bar, prev, level: candidateLevel, index, bars });
      if (!result) continue;
      const bias =
        typeof result === "string" ? result :
        result?.bias || result?.subtype || "";
      const match = buildSyntheticMatch({
        functionName,
        timeframe,
        bar,
        price: candidateLevel,
        bias,
        level: candidateLevel,
        payload: typeof result === "object" && !Array.isArray(result) ? result : {},
      });
      const key = String(match?.id || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      matches.push(match);
    }
  }
  return buildArtifactResult(functionName, matches, {
    timeframe,
    level: Number.isFinite(explicitLevel) ? explicitLevel : null,
    inferred_levels: Number.isFinite(explicitLevel) ? [] : candidateLevels,
  });
}

function findCurrentBarLevelMatch(functionName = "", level = null, ctx = {}, predicate = () => false) {
  const tfContext = resolveTfContext(currentTimeframe(ctx), ctx);
  const timeframe = tfContext.timeframe;
  const bars = tfContext.bars;
  const endIndex = tfContext.currentIndex;
  if (!bars.length || endIndex <= 0) return false;
  const explicitLevel = normalizeLevel(level);
  const candidateEntries = Number.isFinite(explicitLevel)
    ? [
        {
          price: explicitLevel,
          sourceId: "",
          sourceType: "explicit_level",
          sourceTime: 0,
        },
      ]
    : resolveImplicitLevelEntries({
        ...ctx,
        tf: tfContext.timeframe,
        bars: tfContext.bars,
        bar: tfContext.currentBar,
        index: tfContext.currentIndex,
        derivedArtifacts: tfContext.derivedArtifacts,
      });
  if (!candidateEntries.length) return false;
  const bar = bars[endIndex];
  const prev = bars[endIndex - 1];
  if (!bar || !prev) return false;
  const currentClose = Number(bar?.close);
  let bestMatch = null;
  for (const entry of candidateEntries) {
    const candidateLevel = Number(entry?.price);
    if (!Number.isFinite(candidateLevel)) continue;
    const result = predicate({
      bar,
      prev,
      level: candidateLevel,
      index: endIndex,
      bars,
      sourceEntry: entry,
    });
    if (!result) continue;
    if (result?.first_hit_only === true) {
      const sourceTime = Number(entry?.sourceTime);
      let startIndex = 1;
      if (Number.isFinite(sourceTime) && sourceTime > 0) {
        const sourceBarIndex = bars.findIndex(
          (candidateBar) => Number(candidateBar?.time) >= sourceTime,
        );
        if (sourceBarIndex >= 1) startIndex = sourceBarIndex;
      }
      let alreadyMatched = false;
      for (let previousIndex = startIndex; previousIndex < endIndex; previousIndex += 1) {
        const previousBar = bars[previousIndex];
        const previousPrevBar = bars[previousIndex - 1];
        if (!previousBar || !previousPrevBar) continue;
        const previousResult = predicate({
          bar: previousBar,
          prev: previousPrevBar,
          level: candidateLevel,
          index: previousIndex,
          bars,
          sourceEntry: entry,
        });
        if (previousResult) {
          alreadyMatched = true;
          break;
        }
      }
      if (alreadyMatched) continue;
    }
    const distance = Number.isFinite(currentClose)
      ? Math.abs(currentClose - Number(candidateLevel))
      : Math.abs(Number(candidateLevel));
    if (!bestMatch || distance < bestMatch.distance) {
      bestMatch = {
        candidateLevel,
        result,
        distance,
        sourceEntry: entry,
      };
    }
  }
  if (!bestMatch) return false;
  const result = bestMatch.result;
  const bias =
    typeof result === "string" ? result :
    result?.bias || result?.subtype || "";
  const markerPriceRaw =
    result && typeof result === "object" && !Array.isArray(result)
      ? result.marker_price
      : null;
  const markerPrice = Number(markerPriceRaw);
  const match = buildSyntheticMatch({
    functionName,
    timeframe,
    bar,
    price: Number.isFinite(markerPrice) ? markerPrice : bestMatch.candidateLevel,
    bias,
    level: bestMatch.candidateLevel,
    payload: {
      ...(typeof result === "object" && !Array.isArray(result) ? result : {}),
      level: bestMatch.candidateLevel,
      marker_price: Number.isFinite(markerPrice) ? markerPrice : null,
      source_artifact_id: String(bestMatch?.sourceEntry?.sourceId || "").trim(),
      source_artifact_type: String(bestMatch?.sourceEntry?.sourceType || "").trim(),
      source_artifact_time: Number(bestMatch?.sourceEntry?.sourceTime) || null,
    },
  });
  if (!match?.id) return false;
  return buildArtifactResult(functionName, [match], {
    timeframe,
    level: Number.isFinite(explicitLevel) ? explicitLevel : null,
    source_artifact_id: String(bestMatch?.sourceEntry?.sourceId || "").trim(),
    source_artifact_type: String(bestMatch?.sourceEntry?.sourceType || "").trim(),
  });
}

function latestArtifactByType({ types = [], bias = "", ctx = {} }) {
  const items = filterArtifactsBeforeCurrentBar(selectArtifactsForContext(ctx), ctx).filter((item) =>
    (Array.isArray(types) ? types : [types]).includes(String(item?.type || "").trim().toLowerCase()) &&
    matchArtifactBias(item, bias),
  );
  return buildArtifactResult(
    Array.isArray(types) ? types.join("_") : String(types || ""),
    items,
    { timeframe: currentTimeframe(ctx), bias },
  );
}

function latestBreakoutMatch(level = null, ctx = {}) {
  const normalizedLevel = normalizeLevel(level);
  if (!Number.isFinite(normalizedLevel)) {
    const structural = latestArtifactByType({ types: ["bos"], ctx });
    return structural ? buildArtifactResult("breakout", structural.matches, structural.meta) : false;
  }
  return findLevelMatches("breakout", normalizedLevel, ctx, ({ bar, prev, level: target }) => {
    if (Number(prev.close) <= target && Number(bar.close) > target) {
      return { bias: "bullish", breakout_side: "above" };
    }
    if (Number(prev.close) >= target && Number(bar.close) < target) {
      return { bias: "bearish", breakout_side: "below" };
    }
    return false;
  });
}

function latestReversalMatch(level = null, ctx = {}) {
  const timeframe = currentTimeframe(ctx);
  const artifacts = filterArtifactsBeforeCurrentBar(selectArtifactsForContext(ctx), ctx);
  const patterns = new Map(
    artifacts
      .filter((item) =>
        ["bullish_pin_bar", "bearish_pin_bar", "bullish_engulfing", "bearish_engulfing"].includes(
          String(item?.type || "").trim().toLowerCase(),
        ),
      )
      .map((item) => [Number(item?.anchor_time || item?.bar_start || 0), item]),
  );
  if (Number.isFinite(normalizeLevel(level))) {
    const rejected = findCurrentBarLevelMatch("reversal", level, ctx, ({ bar, level: target }) => {
      if (Number(bar.low) <= target && Number(bar.close) > target) {
        return {
          bias: "bullish",
          reversal_kind: "level_reclaim",
          marker_price: Number(bar.low),
          first_hit_only: true,
        };
      }
      if (Number(bar.high) >= target && Number(bar.close) < target) {
        return {
          bias: "bearish",
          reversal_kind: "level_reject",
          marker_price: Number(bar.high),
          first_hit_only: true,
        };
      }
      return false;
    });
    if (!rejected) return false;
    const matches = rejected.matches.filter((item) => {
      const pattern = patterns.get(Number(item?.anchor_time || 0));
      if (!pattern) return false;
      return matchArtifactBias(pattern, item?.subtype || "");
    });
    return buildArtifactResult("reversal", matches, {
      timeframe,
      level,
      confirmation: "pattern",
    }) || buildArtifactResult("reversal", rejected.matches, {
      timeframe,
      level,
      confirmation: "rejection",
    });
  }
  const choch = latestArtifactByType({ types: ["choch"], ctx });
  if (choch) return buildArtifactResult("reversal", choch.matches, { timeframe, source: "choch" });
  const patternMatches = Array.from(patterns.values()).slice(-5);
  return buildArtifactResult("reversal", patternMatches, { timeframe, source: "pattern" });
}

function deriveStructureBias(ctx = {}) {
  const artifacts = filterArtifactsBeforeCurrentBar(selectArtifactsForContext(ctx), ctx);
  const structural = artifacts.filter((item) =>
    ["bos", "choch", "sweep_high", "sweep_low"].includes(String(item?.type || "").trim().toLowerCase()),
  );
  const latest = structural[structural.length - 1] || null;
  if (latest) {
    const bias = String(latest?.payload?.bias || latest?.subtype || "").trim().toLowerCase();
    if (bias) {
      return {
        bias,
        item: buildSyntheticMatch({
          functionName: "bias",
          timeframe: currentTimeframe(ctx),
          bar: resolveCurrentBar(ctx),
          price: latest?.price,
          bias,
          payload: {
            source_artifact_id: latest?.id || "",
            source_artifact_type: latest?.type || "",
          },
        }),
      };
    }
  }
  const bars = resolveBars(ctx);
  const endIndex = resolveCurrentIndex(ctx);
  const window = bars.slice(Math.max(0, endIndex - 4), endIndex + 1);
  if (!window.length) return { bias: "", item: null };
  const firstClose = Number(window[0]?.close);
  const lastClose = Number(window[window.length - 1]?.close);
  if (!Number.isFinite(firstClose) || !Number.isFinite(lastClose) || firstClose === lastClose) {
    return { bias: "neutral", item: null };
  }
  const bias = lastClose > firstClose ? "bullish" : "bearish";
  return {
    bias,
    item: buildSyntheticMatch({
      functionName: "bias",
      timeframe: currentTimeframe(ctx),
      bar: resolveCurrentBar(ctx),
      price: lastClose,
      bias,
      payload: {
        source_artifact_type: "price_slope",
      },
    }),
  };
}

function deriveTfAnalysisForContext(ctx = {}) {
  const bars = resolveBars(ctx);
  const endIndex = resolveCurrentIndex(ctx);
  if (!Array.isArray(bars) || endIndex < 0) return null;
  const scopedBars = bars.slice(0, endIndex + 1);
  const scopedArtifacts = filterArtifactsBeforeCurrentBar(selectArtifactsForContext(ctx), ctx);
  return buildTfAnalysis({
    bars: scopedBars,
    timeframe: currentTimeframe(ctx),
    derivedArtifacts: scopedArtifacts,
  });
}

function evaluateNamedFunction(functionName = "", rawArgs = [], ctx = {}, evaluateRule = null) {
  const lowerName = String(functionName || "").trim().toLowerCase();
  const resolve = typeof evaluateRule === "function"
    ? (node) => evaluateRule(node, ctx)
    : (node) => node;
  if (lowerName === "get_artifacts" || lowerName === "draw") {
    const result = rawArgs.length ? resolve(rawArgs[0]) : false;
    if (isArtifactResult(result)) return result;
    return ruleResultTruthy(result)
      ? buildArtifactResult(lowerName, [
          buildSyntheticMatch({
            functionName: lowerName,
            timeframe: currentTimeframe(ctx),
            bar: resolveCurrentBar(ctx),
            price: resolveCurrentBar(ctx)?.close,
          }),
        ])
      : false;
  }
  if (lowerName === "is_true") {
    const result = rawArgs.length ? resolve(rawArgs[0]) : false;
    return ruleResultTruthy(result);
  }
  if (lowerName === "price_action_sl") {
    const evaluatedArgs = (Array.isArray(rawArgs) ? rawArgs : []).map((arg) => resolve(arg));
    return resolvePriceActionStop(
      evaluatedArgs[0],
      evaluatedArgs[1],
      evaluatedArgs[2],
      evaluatedArgs[3],
      evaluatedArgs[4],
      ctx,
    );
  }
  if (lowerName === "price_action_tp") {
    const evaluatedArgs = (Array.isArray(rawArgs) ? rawArgs : []).map((arg) => resolve(arg));
    return resolvePriceActionTarget(
      evaluatedArgs[0],
      evaluatedArgs[1],
      evaluatedArgs[2],
      evaluatedArgs[3],
      evaluatedArgs[4],
      evaluatedArgs[5],
      ctx,
    );
  }
  if (lowerName === "suggested_trade_sl") {
    const evaluatedArgs = (Array.isArray(rawArgs) ? rawArgs : []).map((arg) => resolve(arg));
    return resolveSuggestedTradeLevelsForContext(
      evaluatedArgs[0],
      evaluatedArgs[1],
      evaluatedArgs[2],
      ctx,
    ).sl;
  }
  if (lowerName === "suggested_trade_tp") {
    const evaluatedArgs = (Array.isArray(rawArgs) ? rawArgs : []).map((arg) => resolve(arg));
    return resolveSuggestedTradeLevelsForContext(
      evaluatedArgs[0],
      evaluatedArgs[1],
      evaluatedArgs[2],
      ctx,
    ).tp;
  }

  const evaluatedArgs = (Array.isArray(rawArgs) ? rawArgs : []).map((arg) => resolve(arg));
  const requestedTfRaw =
    evaluatedArgs.length > 1 ? String(evaluatedArgs[evaluatedArgs.length - 1] || "").trim() : "";
  const level = evaluatedArgs.length ? normalizeLevel(evaluatedArgs[0]) : null;
  const firstArg = evaluatedArgs.length ? String(evaluatedArgs[0] || "").trim().toLowerCase() : "";
  const biasArg = firstArg;
  const phaseArg = firstArg;

  const evaluateForTimeframe = (forcedTf = "") => {
    const timeframe = String(forcedTf || resolveFunctionTimeframe(evaluatedArgs, ctx)).trim();
    if (!timeframe || timeframe === "all") return false;
    const tfContext = resolveTfContext(timeframe, ctx);
    if (!tfContext.currentBar || !tfContext.bars.length) return false;
    const nextCtx = {
      ...ctx,
      tf: tfContext.timeframe,
      bars: tfContext.bars,
      bar: tfContext.currentBar,
      index: tfContext.currentIndex,
      derivedArtifacts: tfContext.derivedArtifacts,
    };

    switch (lowerName) {
    case "touches":
      return findLevelMatches("touches", level, nextCtx, ({ bar, level: target }) =>
        Number(bar.low) <= target && Number(bar.high) >= target ? { bias: "" } : false,
      );
    case "retest":
      return findLevelMatches("retest", level, nextCtx, ({ bar, prev, level: target }) => {
        const touched = Number(bar.low) <= target && Number(bar.high) >= target;
        if (!touched) return false;
        if (Number(prev.close) > target && Number(bar.close) > target) return { bias: "bullish" };
        if (Number(prev.close) < target && Number(bar.close) < target) return { bias: "bearish" };
        return false;
      });
    case "rejected":
      return findCurrentBarLevelMatch("rejected", level, nextCtx, ({ bar, level: target }) => {
        if (Number(bar.low) <= target && Number(bar.close) > target) {
          return {
            bias: "bullish",
            rejection_side: "below",
            marker_price: Number(bar.low),
            first_hit_only: true,
          };
        }
        if (Number(bar.high) >= target && Number(bar.close) < target) {
          return {
            bias: "bearish",
            rejection_side: "above",
            marker_price: Number(bar.high),
            first_hit_only: true,
          };
        }
        return false;
      });
    case "holds_above":
      return findLevelMatches("holds_above", level, nextCtx, ({ bar, prev, level: target }) =>
        Number(prev.close) > target && Number(bar.close) > target ? { bias: "bullish" } : false,
      );
    case "holds_below":
      return findLevelMatches("holds_below", level, nextCtx, ({ bar, prev, level: target }) =>
        Number(prev.close) < target && Number(bar.close) < target ? { bias: "bearish" } : false,
      );
    case "sweeps_above":
      return findLevelMatches("sweeps_above", level, nextCtx, ({ bar, level: target }) =>
        Number(bar.high) > target && Number(bar.close) < target ? { bias: "bearish" } : false,
      );
    case "sweeps_below":
      return findLevelMatches("sweeps_below", level, nextCtx, ({ bar, level: target }) =>
        Number(bar.low) < target && Number(bar.close) > target ? { bias: "bullish" } : false,
      );
    case "sweep":
    case "has_sweep":
      return buildArtifactResult(
        lowerName,
        resultMatches(latestArtifactByType({ types: ["sweep_high", "sweep_low"], bias: biasArg, ctx: nextCtx })),
        { timeframe, bias: biasArg },
      );
    case "breakout":
      return latestBreakoutMatch(level, nextCtx);
    case "pin_bar":
      return buildArtifactResult(
        lowerName,
        resultMatches(
          latestArtifactByType({
            types: ["bullish_pin_bar", "bearish_pin_bar"],
            bias: biasArg,
            ctx: nextCtx,
          }),
        ),
        { timeframe, bias: biasArg },
      );
    case "engulfing":
      return buildArtifactResult(
        lowerName,
        resultMatches(
          latestArtifactByType({
            types: ["bullish_engulfing", "bearish_engulfing"],
            bias: biasArg,
            ctx: nextCtx,
          }),
        ),
        { timeframe, bias: biasArg },
      );
    case "inside_bar":
      return buildArtifactResult(
        lowerName,
        resultMatches(latestArtifactByType({ types: ["inside_bar"], ctx: nextCtx })),
        { timeframe },
      );
    case "outside_bar":
      return buildArtifactResult(
        lowerName,
        resultMatches(latestArtifactByType({ types: ["outside_bar"], ctx: nextCtx })),
        { timeframe },
      );
    case "bos":
    case "has_bos":
      return buildArtifactResult(
        lowerName,
        resultMatches(latestArtifactByType({ types: ["bos"], bias: biasArg, ctx: nextCtx })),
        { timeframe, bias: biasArg },
      );
    case "choch":
    case "has_choch":
      return buildArtifactResult(
        lowerName,
        resultMatches(latestArtifactByType({ types: ["choch"], bias: biasArg, ctx: nextCtx })),
        { timeframe, bias: biasArg },
      );
    case "reversal":
      return latestReversalMatch(level, nextCtx);
    case "trend":
    case "bias": {
      const analysis = deriveTfAnalysisForContext(nextCtx);
      const derived = deriveStructureBias(nextCtx);
      const effectiveBias = String(analysis?.bias || derived?.bias || "").trim().toLowerCase();
      if (!effectiveBias) return false;
      if (biasArg && !matchArtifactBias({ subtype: effectiveBias }, biasArg)) return false;
      const item = derived?.item || buildSyntheticMatch({
        functionName: lowerName,
        timeframe: currentTimeframe(nextCtx),
        bar: resolveCurrentBar(nextCtx),
        price: resolveCurrentBar(nextCtx)?.close,
        bias: effectiveBias,
        payload: {
          trend: analysis?.trend || "",
          phase: analysis?.phase || "",
          structure_state: analysis?.structure_state || "",
        },
      });
      return buildArtifactResult(lowerName, [item], {
        timeframe,
        bias: effectiveBias,
        trend: analysis?.trend || "",
        phase: analysis?.phase || "",
      });
    }
    case "phase": {
      const analysis = deriveTfAnalysisForContext(nextCtx);
      const phase = String(analysis?.phase || "").trim().toLowerCase();
      if (!phase) return false;
      if (phaseArg && phaseArg !== phase) return false;
      return buildArtifactResult(
        lowerName,
        [
          buildSyntheticMatch({
            functionName: "phase",
            timeframe: currentTimeframe(nextCtx),
            bar: resolveCurrentBar(nextCtx),
            price: resolveCurrentBar(nextCtx)?.close,
            bias: String(analysis?.bias || "").trim().toLowerCase(),
            payload: {
              phase,
              trend: analysis?.trend || "",
              structure_state: analysis?.structure_state || "",
            },
          }),
        ],
        {
          timeframe,
          bias: String(analysis?.bias || "").trim().toLowerCase(),
          phase,
          trend: analysis?.trend || "",
        },
      );
    }
    default:
      return null;
    }
  };

  if (isAllTimeframesSelection(requestedTfRaw)) {
    const requestedTfs = availableRequestedTimeframesForAll(ctx);
    const mergedMatches = [];
    const seen = new Set();
    requestedTfs.forEach((requestedTf) => {
      const result = evaluateForTimeframe(requestedTf);
      resultMatches(result).forEach((match) => {
        const key = String(
          match?.id ||
            `${match?.type || lowerName}:${match?.timeframe || requestedTf}:${match?.anchor_time || match?.time || ""}:${match?.price || ""}`,
        );
        if (seen.has(key)) return;
        seen.add(key);
        mergedMatches.push(match);
      });
    });
    return buildArtifactResult(lowerName, mergedMatches, {
      timeframe: currentTimeframe(ctx),
      bias: biasArg,
      source_timeframes: requestedTfs,
    });
  }

  return evaluateForTimeframe();
}

module.exports = {
  buildArtifactResult,
  evaluateNamedFunction,
  isArtifactResult,
  mergeArtifactResults,
  normalizeTfKey,
  ruleResultTruthy,
};
