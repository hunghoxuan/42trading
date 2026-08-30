import * as artifactDetection from "./detectArtifacts.js";
import { buildMultiTfAnalysis } from "./realtimeAnalysis.js";

const REPLAY_INCREMENTAL_TAIL_BARS = 240;

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeTfKey(value = "") {
  return String(value || "").trim().toLowerCase();
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
    )
    .sort((left, right) => left.time - right.time);
}

function buildStableCoverageId(parts = []) {
  return parts
    .map((part) => String(part ?? "").trim())
    .join("|");
}

function barsFingerprint(bars = []) {
  const list = Array.isArray(bars) ? bars : [];
  const firstTime = Number(list?.[0]?.time || 0) || 0;
  const lastTime = Number(list?.[list.length - 1]?.time || 0) || 0;
  return {
    length: list.length,
    firstTime,
    lastTime,
    key: `${list.length}:${firstTime}:${lastTime}`,
  };
}

function barsCoverageWindow(bars = [], timeframe = "") {
  const normalizedBars = normalizeBars(bars);
  const start = Number(normalizedBars?.[0]?.time || 0) || 0;
  const end =
    Number(normalizedBars?.[normalizedBars.length - 1]?.time || 0) || 0;
  return {
    timeframe: normalizeTfKey(timeframe),
    start_bar: start || null,
    end_bar: end || null,
  };
}

function normalizeCoverageNumber(...candidates) {
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function normalizeHybridCoverageWindow(
  value = {},
  fallbackTimeframe = "",
  fallbackStart = null,
  fallbackEnd = null,
) {
  const timeframe = normalizeTfKey(
    value?.timeframe ?? value?.tf ?? fallbackTimeframe,
  );
  const start_bar = normalizeCoverageNumber(
    value?.start_bar,
    value?.startBar,
    value?.bar_start,
    value?.barStart,
    value?.from_bar,
    value?.fromBar,
    fallbackStart,
  );
  const end_bar = normalizeCoverageNumber(
    value?.end_bar,
    value?.endBar,
    value?.bar_end,
    value?.barEnd,
    value?.to_bar,
    value?.toBar,
    fallbackEnd,
  );
  return {
    timeframe,
    start_bar,
    end_bar,
  };
}

function itemCoverageWindow(
  item = {},
  fallbackTimeframe = "",
  fallbackStart = null,
  fallbackEnd = null,
) {
  return normalizeHybridCoverageWindow(item, fallbackTimeframe, fallbackStart, fallbackEnd);
}

function isCoverageComplete(window = {}) {
  return Number.isFinite(Number(window?.start_bar)) && Number.isFinite(Number(window?.end_bar));
}

function isItemCoveredByWindows(item = {}, windows = [], fallbackTimeframe = "") {
  const itemWindow = itemCoverageWindow(item, fallbackTimeframe);
  if (!isCoverageComplete(itemWindow)) return false;
  const itemTf = normalizeTfKey(itemWindow.timeframe || fallbackTimeframe);
  return (Array.isArray(windows) ? windows : []).some((window) => {
    const normalized = normalizeHybridCoverageWindow(window, fallbackTimeframe);
    if (!isCoverageComplete(normalized)) return false;
    if (itemTf && normalized.timeframe && normalized.timeframe !== itemTf) return false;
    return (
      Number(normalized.start_bar) <= Number(itemWindow.start_bar) &&
      Number(normalized.end_bar) >= Number(itemWindow.end_bar)
    );
  });
}

function shouldDropLegacyArtifactItem(item = {}) {
  const family = String(item?.family || item?.artifact_family || "")
    .trim()
    .toLowerCase();
  const type = String(item?.type || item?.artifact_type || "")
    .trim()
    .toLowerCase();
  const label = String(item?.label || "").trim().toLowerCase();
  const text = [family, type, label].filter(Boolean).join(" ");

  if (
    (type.includes("swing_high") || type.includes("swing_low") || label.includes("swing")) &&
    type.includes("segment")
  ) {
    return true;
  }
  if ((type.includes("bos") || type.includes("choch")) && type.includes("source")) {
    return true;
  }
  if (family === "structure" && (type.endsWith("_segment") || type.endsWith("_source"))) {
    return true;
  }
  if (family === "level" && type.endsWith("_segment")) {
    return true;
  }
  if (/swing (high|low) segment/.test(text)) return true;
  return false;
}

export function normalizeHybridArtifacts(
  items = [],
  timeframe = "",
  coverage = null,
) {
  const normalizedTf = normalizeTfKey(timeframe);
  const coverageWindow = normalizeHybridCoverageWindow(coverage, normalizedTf);
  return dedupeArtifacts(
    (Array.isArray(items) ? items : [])
      .filter((item) => item && typeof item === "object")
      .filter((item) => !shouldDropLegacyArtifactItem(item))
      .map((item) => {
        const normalizedItem = {
          ...clone(item),
          timeframe: normalizeTfKey(item?.timeframe ?? item?.tf ?? normalizedTf),
          tf: normalizeTfKey(item?.tf ?? item?.timeframe ?? normalizedTf),
        };
        const itemWindow = itemCoverageWindow(
          normalizedItem,
          normalizedTf,
          coverageWindow.start_bar,
          coverageWindow.end_bar,
        );
        return {
          ...normalizedItem,
          timeframe: itemWindow.timeframe || normalizedTf,
          tf: itemWindow.timeframe || normalizedTf,
          start_bar: itemWindow.start_bar,
          end_bar: itemWindow.end_bar,
          bar_start:
            normalizeCoverageNumber(
              normalizedItem?.bar_start,
              normalizedItem?.start_bar,
              itemWindow.start_bar,
            ) ?? null,
          bar_end:
            normalizeCoverageNumber(
              normalizedItem?.bar_end,
              normalizedItem?.end_bar,
              itemWindow.end_bar,
            ) ?? null,
          bars_width:
            (() => {
              const explicit = Number(
                normalizedItem?.bars_width ??
                  normalizedItem?.barsWidth ??
                  normalizedItem?.metrics?.bars_width ??
                  normalizedItem?.payload?.bars_width,
              );
              if (Number.isFinite(explicit) && explicit > 0) {
                return Math.max(1, Math.round(explicit));
              }
              const start = normalizeCoverageNumber(
                normalizedItem?.bar_start,
                normalizedItem?.start_bar,
                itemWindow.start_bar,
              );
              const end = normalizeCoverageNumber(
                normalizedItem?.bar_end,
                normalizedItem?.end_bar,
                itemWindow.end_bar,
              );
              if (Number.isFinite(start) && Number.isFinite(end)) {
                return Math.max(1, Math.abs(Number(end) - Number(start)) + 1);
              }
              return null;
            })(),
        };
      }),
  );
}

export function normalizeHybridTradePlans(
  plans = [],
  timeframe = "",
  coverage = null,
) {
  const normalizedTf = normalizeTfKey(timeframe);
  const coverageWindow = normalizeHybridCoverageWindow(coverage, normalizedTf);
  return (Array.isArray(plans) ? plans : [])
    .filter((plan) => plan && typeof plan === "object")
    .map((plan, index) => {
      const start_bar = normalizeCoverageNumber(
        plan?.start_bar,
        plan?.startBar,
        plan?.opened_at_unix,
        plan?.opened_at,
        plan?.open_time_unix,
        plan?.open_time,
        coverageWindow.start_bar,
      );
      const end_bar = normalizeCoverageNumber(
        plan?.end_bar,
        plan?.endBar,
        plan?.closed_at_unix,
        plan?.closed_at,
        plan?.close_time_unix,
        plan?.close_time,
        coverageWindow.end_bar,
      );
      const tfKey = normalizeTfKey(plan?.timeframe ?? plan?.tf ?? normalizedTf);
      return {
        ...clone(plan),
        id:
          String(plan?.id || "").trim() ||
          buildStableCoverageId([
            "trade-plan",
            tfKey,
            start_bar,
            end_bar,
            plan?.strategy || "",
            plan?.entry || "",
            plan?.tp || "",
            plan?.sl || "",
            index,
          ]),
        timeframe: tfKey,
        tf: tfKey,
        start_bar,
        end_bar,
      };
    });
}

export function mergeHybridTradePlansForTf({
  timeframe = "",
  bars = [],
  serverPlans = [],
  clientPlans = [],
  serverCoverage = null,
} = {}) {
  const normalizedTf = normalizeTfKey(timeframe);
  const barsCoverage = barsCoverageWindow(bars, normalizedTf);
  const fallbackCoverage = normalizeHybridCoverageWindow(
    serverCoverage,
    normalizedTf,
    barsCoverage.start_bar,
    barsCoverage.end_bar,
  );
  const normalizedServerPlans = normalizeHybridTradePlans(
    serverPlans,
    normalizedTf,
    fallbackCoverage,
  );
  const normalizedClientPlans = normalizeHybridTradePlans(
    clientPlans,
    normalizedTf,
    barsCoverage,
  );
  const serverWindows = [];
  if (isCoverageComplete(fallbackCoverage)) {
    serverWindows.push(fallbackCoverage);
  }
  for (const plan of normalizedServerPlans) {
    const planWindow = itemCoverageWindow(plan, normalizedTf);
    if (isCoverageComplete(planWindow)) serverWindows.push(planWindow);
  }
  const uncoveredClientPlans = normalizedClientPlans.filter(
    (plan) => !isItemCoveredByWindows(plan, serverWindows, normalizedTf),
  );
  const merged = new Map();
  [...normalizedServerPlans, ...uncoveredClientPlans].forEach((plan, index) => {
    const key =
      String(plan?.id || "").trim() ||
      buildStableCoverageId([
        normalizedTf,
        plan?.strategy_id || plan?.strategy || "",
        plan?.event_id || plan?.rule_name || "",
        plan?.start_bar || "",
        plan?.direction || "",
        plan?.entry || "",
        plan?.tp || "",
        plan?.sl || "",
        index,
      ]);
    merged.set(key, plan);
  });
  return {
    plans: [...merged.values()].sort(
      (left, right) => Number(left?.start_bar || 0) - Number(right?.start_bar || 0),
    ),
    coverage: {
      timeframe: normalizedTf,
      start_bar:
        normalizeCoverageNumber(fallbackCoverage?.start_bar, barsCoverage.start_bar) ?? null,
      end_bar:
        normalizeCoverageNumber(fallbackCoverage?.end_bar, barsCoverage.end_bar) ?? null,
    },
    meta: {
      server_plan_count: normalizedServerPlans.length,
      client_plan_count: normalizedClientPlans.length,
      merged_plan_count: merged.size,
    },
  };
}

export function mergeHybridArtifactItemsForTf({
  timeframe = "",
  bars = [],
  serverItems = [],
  clientItems = [],
  serverCoverage = null,
} = {}) {
  // Temporary compatibility gate while cTrader becomes the canonical artifact producer.
  // Do not display the parallel 42trade detector output during this migration.
  const CTRADER_SHARED_ARTIFACTS_ONLY = true;
  const normalizedTf = normalizeTfKey(timeframe);
  const normalizedBars = normalizeBars(bars);
  const fallbackCoverage =
    normalizeHybridCoverageWindow(serverCoverage, normalizedTf) ||
    barsCoverageWindow(normalizedBars, normalizedTf);
  const normalizedServerItems = normalizeHybridArtifacts(
    serverItems,
    normalizedTf,
    fallbackCoverage,
  );
  const normalizedClientItems = normalizeHybridArtifacts(
    clientItems,
    normalizedTf,
    barsCoverageWindow(normalizedBars, normalizedTf),
  );
  const cTraderItems = normalizedServerItems.filter(
    (item) => String(item?.source || "").trim().toLowerCase() === "ctrader" ||
      String(item?.payload?.source || "").trim().toLowerCase() === "ctrader",
  );
  // Shared cTrader/server artifacts are authoritative. Client-side detection is only a
  // fallback when no shared snapshot exists; otherwise it can replace cTrader's names,
  // prices, and bar anchors with a second implementation.
  const serverHasArtifacts = CTRADER_SHARED_ARTIFACTS_ONLY
    ? cTraderItems.length > 0
    : normalizedServerItems.length > 0;
  const authoritativeItems = serverHasArtifacts
    ? CTRADER_SHARED_ARTIFACTS_ONLY
      ? cTraderItems
      : normalizedServerItems
    : CTRADER_SHARED_ARTIFACTS_ONLY
      ? []
      : normalizedClientItems;
  const serverWindows = [];
  if (isCoverageComplete(fallbackCoverage)) {
    serverWindows.push(fallbackCoverage);
  }
  for (const item of authoritativeItems) {
    const itemWindow = itemCoverageWindow(item, normalizedTf);
    if (isCoverageComplete(itemWindow)) serverWindows.push(itemWindow);
  }
  const uncoveredClientItems = serverHasArtifacts || CTRADER_SHARED_ARTIFACTS_ONLY
    ? []
    : normalizedClientItems;
  const mergedItems = artifactDetection.limitArtifactsNearLastBarByType(
    dedupeArtifacts([
      ...authoritativeItems,
      ...uncoveredClientItems,
    ]),
    normalizedBars,
  );
  return {
    items: mergedItems,
    coverage: {
      timeframe: normalizedTf,
      start_bar:
        normalizeCoverageNumber(
          fallbackCoverage?.start_bar,
          barsCoverageWindow(normalizedBars, normalizedTf)?.start_bar,
        ) ?? null,
      end_bar:
        normalizeCoverageNumber(
          fallbackCoverage?.end_bar,
          barsCoverageWindow(normalizedBars, normalizedTf)?.end_bar,
        ) ?? null,
    },
    meta: {
      server_item_count: normalizedServerItems.length,
      server_item_count_after_filter: authoritativeItems.length,
      ctrader_item_count: cTraderItems.length,
      client_item_count: normalizedClientItems.length,
      merged_item_count: mergedItems.length,
      authority: serverHasArtifacts ? "ctrader_shared_snapshot" : "ctrader_shared_snapshot_waiting",
    },
  };
}

function artifactAnchorTime(item = {}) {
  return Number(
    item?.anchor_time ??
      item?.bar_start ??
      item?.time ??
      item?.bar_end ??
      item?.payload?.source_swing_time ??
      item?.payload?.swept_swing_time ??
      0,
  ) || 0;
}

function dedupeArtifacts(items = []) {
  const next = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = String(item?.id || "").trim();
    const fallbackKey = [
      item?.family || item?.artifact_family || "",
      item?.type || item?.artifact_type || "",
      item?.timeframe || item?.tf || "",
      artifactAnchorTime(item),
      item?.price ?? item?.price_low ?? item?.price_high ?? "",
    ].join("|");
    next.set(id || fallbackKey, item);
  }
  return [...next.values()].sort((left, right) => artifactAnchorTime(left) - artifactAnchorTime(right));
}

function isAppendOrTailUpdate(previousBars = [], nextBars = []) {
  const prev = Array.isArray(previousBars) ? previousBars : [];
  const next = Array.isArray(nextBars) ? nextBars : [];
  if (!prev.length || !next.length) return false;
  if (Number(prev[0]?.time) !== Number(next[0]?.time)) return false;
  if (next.length < prev.length) return false;
  const prevLastTime = Number(prev[prev.length - 1]?.time || 0);
  const nextLastTime = Number(next[next.length - 1]?.time || 0);
  if (!Number.isFinite(prevLastTime) || !Number.isFinite(nextLastTime)) return false;
  if (nextLastTime < prevLastTime) return false;
  const delta = next.length - prev.length;
  const overlap = Math.min(8, prev.length, next.length);
  if (!overlap) return false;
  const prevStart = prev.length - overlap;
  for (let index = 0; index < overlap; index += 1) {
    const prevTime = Number(prev[prevStart + index]?.time || 0);
    const nextTime = Number(next[prevStart + index + delta]?.time || 0);
    if (prevTime !== nextTime) return false;
  }
  return true;
}

function computeTailStartIndex(previousBars = [], nextBars = [], tailBars = REPLAY_INCREMENTAL_TAIL_BARS) {
  const prevLength = Array.isArray(previousBars) ? previousBars.length : 0;
  const nextLength = Array.isArray(nextBars) ? nextBars.length : 0;
  if (!prevLength || !nextLength) return 0;
  const safeTailBars = Math.max(40, Number(tailBars) || REPLAY_INCREMENTAL_TAIL_BARS);
  if (nextLength <= prevLength) {
    return Math.max(0, nextLength - safeTailBars);
  }
  return Math.max(0, prevLength - safeTailBars);
}

function mergeArtifactEnvelopes(previousItems = [], nextItems = [], cutoffTimeSec = 0) {
  const safeCutoff = Number(cutoffTimeSec) || 0;
  const retained = (Array.isArray(previousItems) ? previousItems : []).filter(
    (item) => artifactAnchorTime(item) < safeCutoff,
  );
  return dedupeArtifacts([...retained, ...(Array.isArray(nextItems) ? nextItems : [])]);
}

function fullRecomputeTfArtifacts(bars = [], timeframe = "", replaceExisting = true) {
  const envelope = buildClientChartArtifactEnvelope(bars, timeframe, {
    replaceExisting,
  });
  return {
    envelope,
    meta: {
      strategy: "full",
      barsFingerprint: barsFingerprint(bars),
      cutoffTimeSec: Number(bars?.[0]?.time || 0) || 0,
    },
  };
}

function incrementalRecomputeTfArtifacts(previousTfState = null, bars = [], timeframe = "") {
  const previousBars = Array.isArray(previousTfState?.bars) ? previousTfState.bars : [];
  const tailStartIndex = computeTailStartIndex(previousBars, bars);
  const tailBars = bars.slice(tailStartIndex);
  const tailEnvelope = buildClientChartArtifactEnvelope(tailBars, timeframe, {
    replaceExisting: true,
  });
  const cutoffTimeSec = Number(tailBars?.[0]?.time || 0) || 0;
  return {
    envelope: {
      ...tailEnvelope,
      items: mergeArtifactEnvelopes(previousTfState?.envelope?.items, tailEnvelope?.items, cutoffTimeSec),
      meta: {
        ...(tailEnvelope?.meta || {}),
        replay_update_strategy: "incremental",
        replay_tail_start_time: cutoffTimeSec || null,
        replay_tail_bars: tailBars.length,
      },
    },
    meta: {
      strategy: "incremental",
      barsFingerprint: barsFingerprint(bars),
      cutoffTimeSec,
    },
  };
}

export function artifactGroupKeyForItem(item = {}) {
  const family = String(item?.family || item?.artifact_family || "")
    .trim()
    .toLowerCase();
  const type = String(item?.type || item?.artifact_type || "")
    .trim()
    .toLowerCase();
  const label = String(item?.label || "").trim().toLowerCase();
  const subtype = String(item?.subtype || "").trim().toLowerCase();
  const patternType = String(item?.payload?.pattern_type || "")
    .trim()
    .toLowerCase();
  const text = [family, type, label, subtype, patternType]
    .filter(Boolean)
    .join(" ");
  if (/\bpdh\b/.test(text)) return "pdh";
  if (/\bpdl\b/.test(text)) return "pdl";
  if (type.includes("support") || label.includes("support")) return "support";
  if (type.includes("demand") || label.includes("demand")) return "demand";
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
  if (type === "bos" || label.includes("bos")) return "bos";
  if (type === "choch" || label.includes("choch")) return "choch";
  if (type.includes("sweep") || label.includes("sweep")) return "sweep";
  if (
    type.includes("swing_high") ||
    type.includes("swing_low") ||
    label.includes("swing")
  ) {
    return "swings";
  }
  if (
    family === "trendline" ||
    type.includes("trendline") ||
    label.includes("trendline")
  ) {
    return "trendline";
  }
  if (
    family === "divergence" ||
    type.includes("divergence") ||
    label.includes("divergence")
  ) {
    return "divergence";
  }
  if (family === "pattern") return "patterns";
  return type || family || "other";
}

export function shouldRenderClientChartArtifact(item = {}) {
  const groupKey = artifactGroupKeyForItem(item);
  return [
    "fvg",
    "ifvg",
    "ob",
    "bb",
    "support",
    "demand",
    "liquidity",
    "bos",
    "choch",
    "sweep",
    "hh",
    "hl",
    "lh",
    "ll",
    "swings",
    "trendline",
    "divergence",
    "patterns",
    "pdh",
    "pdl",
  ].includes(groupKey);
}

export function buildClientChartArtifactEnvelope(
  bars = [],
  timeframe = "",
  { replaceExisting = false } = {},
) {
  const items = artifactDetection
    .buildDerivedItemsFromBars(Array.isArray(bars) ? bars : [], timeframe)
    .filter((item) => shouldRenderClientChartArtifact(item));
  return {
    items,
    meta: {
      artifact_source: "client_shared_detector",
      calculated_at: new Date().toISOString(),
      replace_existing: Boolean(replaceExisting),
    },
  };
}

export function buildClientChartMultiTfAnalysis(
  barsByTf = {},
  fallbackAnalysis = null,
) {
  const availableBarsByTf = Object.fromEntries(
    Object.entries(
      barsByTf && typeof barsByTf === "object" && !Array.isArray(barsByTf)
        ? barsByTf
        : {},
    ).filter(([, bars]) => Array.isArray(bars) && bars.length > 0),
  );
  if (Object.keys(availableBarsByTf).length) {
    return buildMultiTfAnalysis(availableBarsByTf);
  }
  if (
    fallbackAnalysis &&
    typeof fallbackAnalysis === "object" &&
    !Array.isArray(fallbackAnalysis)
  ) {
    return fallbackAnalysis;
  }
  return {};
}

export function createClientReplayArtifactEngineState() {
  return {
    byTf: {},
    analysisByTf: {},
    updatedAt: 0,
  };
}

export function updateClientReplayArtifactEngineState(
  previousState = null,
  barsByTf = {},
  {
    requestedTimeframes = null,
    fallbackAnalysis = null,
    fallbackWhenNull = true,
    allowIncremental = true,
  } = {},
) {
  const prev =
    previousState && typeof previousState === "object" && !Array.isArray(previousState)
      ? previousState
      : createClientReplayArtifactEngineState();
  const requestedTfs = Array.isArray(requestedTimeframes)
    ? requestedTimeframes
        .map((tf) => String(tf || "").trim().toLowerCase())
        .filter(Boolean)
    : Object.keys(
        barsByTf && typeof barsByTf === "object" && !Array.isArray(barsByTf)
          ? barsByTf
          : {},
      );
  const nextState = {
    byTf: { ...(prev?.byTf || {}) },
    analysisByTf: {},
    updatedAt: Date.now(),
  };
  const envelopesByTf = {};
  const barsSource =
    barsByTf && typeof barsByTf === "object" && !Array.isArray(barsByTf) ? barsByTf : {};

  for (const tfKey of requestedTfs) {
    const normalizedTf = String(tfKey || "").trim().toLowerCase();
    if (!normalizedTf) continue;
    const bars = normalizeBars(barsSource?.[normalizedTf]);
    if (!bars.length) {
      delete nextState.byTf[normalizedTf];
      continue;
    }
    const previousTfState =
      nextState?.byTf?.[normalizedTf] &&
      typeof nextState.byTf[normalizedTf] === "object"
        ? nextState.byTf[normalizedTf]
        : null;
    const hasPreviousEnvelope = Array.isArray(previousTfState?.envelope?.items);
    const canIncrementallyReuse =
      allowIncremental &&
      hasPreviousEnvelope &&
      isAppendOrTailUpdate(previousTfState?.bars, bars);
    const nextResult =
      !fallbackWhenNull && !hasPreviousEnvelope
        ? {
            envelope: previousTfState?.envelope || buildClientChartArtifactEnvelope([], normalizedTf),
            meta: {
              strategy: "noop",
              barsFingerprint: barsFingerprint(bars),
              cutoffTimeSec: 0,
            },
          }
        : canIncrementallyReuse
          ? incrementalRecomputeTfArtifacts(previousTfState, bars, normalizedTf)
          : fullRecomputeTfArtifacts(bars, normalizedTf, true);
    const envelope = {
      ...(nextResult?.envelope || {}),
      meta: {
        ...((nextResult?.envelope?.meta && typeof nextResult.envelope.meta === "object")
          ? nextResult.envelope.meta
          : {}),
        replay_source_tf: normalizedTf,
        replay_update_strategy: nextResult?.meta?.strategy || "full",
      },
    };
    nextState.byTf[normalizedTf] = {
      bars: clone(bars),
      envelope,
      barsFingerprint: nextResult?.meta?.barsFingerprint || barsFingerprint(bars),
      strategy: nextResult?.meta?.strategy || "full",
      cutoffTimeSec: Number(nextResult?.meta?.cutoffTimeSec || 0) || 0,
      updatedAt: Date.now(),
    };
    envelopesByTf[normalizedTf] = envelope;
  }

  const availableBarsByTf = Object.fromEntries(
    requestedTfs
      .map((tf) => [tf, nextState?.byTf?.[tf]?.bars || []])
      .filter(([, bars]) => Array.isArray(bars) && bars.length > 0),
  );
  nextState.analysisByTf = buildClientChartMultiTfAnalysis(availableBarsByTf, fallbackAnalysis);
  return {
    state: nextState,
    envelopesByTf,
    analysisByTf: nextState.analysisByTf,
  };
}
