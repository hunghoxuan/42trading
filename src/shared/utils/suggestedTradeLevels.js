function artifactGroupKeyForItem(item = {}) {
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
  if (family === "pattern") return "patterns";
  return type || family || "other";
}

function timeframeToSeconds(tf = "") {
  const value = String(tf || "").trim().toLowerCase();
  if (value === "1m") return 60;
  if (value === "5m") return 300;
  if (value === "15m") return 900;
  if (value === "1h") return 3600;
  if (value === "4h") return 14400;
  if (value === "1d") return 86400;
  if (value === "1w") return 604800;
  return 0;
}

function sortTimeframes(values = [], direction = "asc") {
  const normalized = [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
  normalized.sort((left, right) => {
    const delta = timeframeToSeconds(left) - timeframeToSeconds(right);
    return direction === "desc" ? -delta : delta;
  });
  return normalized;
}

function artifactPriceBounds(item = {}) {
  const top = Number(
    item?.price_top ??
      item?.high ??
      item?.priceHigh ??
      item?.artifact_payload?.price_top,
  );
  const bottom = Number(
    item?.price_bottom ??
      item?.low ??
      item?.priceLow ??
      item?.artifact_payload?.price_bottom,
  );
  const price = Number(
    item?.price ??
      item?.level_price ??
      item?.anchorPrice ??
      item?.anchor_price ??
      item?.artifact_payload?.price,
  );
  if (Number.isFinite(top) && Number.isFinite(bottom)) {
    return {
      low: Math.min(top, bottom),
      high: Math.max(top, bottom),
    };
  }
  if (Number.isFinite(price)) return { low: price, high: price };
  return null;
}

function artifactTradeGroupWeight(groupKey = "", side = "BUY", kind = "tp") {
  const key = String(groupKey || "").trim().toLowerCase();
  const upperSide = String(side || "BUY").trim().toUpperCase();
  const stopWeights =
    upperSide === "BUY"
      ? {
          pdl: 10,
          demand: 9,
          support: 9,
          ob: 9,
          bb: 9,
          fvg: 8,
          ifvg: 8,
          swings: 7,
          liquidity: 6,
          bos: 4,
          choch: 4,
        }
      : {
          pdh: 10,
          supply: 9,
          resistance: 9,
          ob: 9,
          bb: 9,
          fvg: 8,
          ifvg: 8,
          swings: 7,
          liquidity: 6,
          bos: 4,
          choch: 4,
        };
  const targetWeights =
    upperSide === "BUY"
      ? {
          pdh: 10,
          liquidity: 9,
          bos: 8,
          choch: 8,
          bb: 8,
          ob: 7,
          fvg: 7,
          ifvg: 7,
          swings: 6,
          resistance: 6,
          supply: 6,
        }
      : {
          pdl: 10,
          liquidity: 9,
          bos: 8,
          choch: 8,
          bb: 8,
          ob: 7,
          fvg: 7,
          ifvg: 7,
          swings: 6,
          support: 6,
          demand: 6,
        };
  const table = kind === "sl" ? stopWeights : targetWeights;
  return Number(table[key] || 0);
}

function timeframePriorityWeight(tf = "", activeTf = "") {
  const tfSec = Math.max(1, Number(timeframeToSeconds(tf)) || 60);
  const activeSec = Math.max(1, Number(timeframeToSeconds(activeTf)) || 60);
  const ratio = Math.abs(Math.log(tfSec / activeSec));
  return Math.max(0, 3 - ratio);
}

export function resolveSuggestedTradeTimeframes(
  activeTf = "",
  selectedTfs = [],
  artifactItemsByTf = {},
) {
  const normalizedActiveTf = String(activeTf || "").trim().toLowerCase();
  const activeTfSeconds = Math.max(
    1,
    Number(timeframeToSeconds(normalizedActiveTf)) || 0,
  );
  const requestedTfs = Array.isArray(selectedTfs) ? selectedTfs : [];
  const configuredTfs = requestedTfs
    .map((tf) => String(tf || "").trim().toLowerCase())
    .filter(Boolean);
  const fallbackArtifactTfs = Object.keys(
    artifactItemsByTf && typeof artifactItemsByTf === "object"
      ? artifactItemsByTf
      : {},
  )
    .map((tf) => String(tf || "").trim().toLowerCase())
    .filter(Boolean);
  const candidateTfs = [
    ...new Set([
      ...configuredTfs,
      ...(normalizedActiveTf ? [normalizedActiveTf] : []),
      ...fallbackArtifactTfs,
    ]),
  ];
  if (!candidateTfs.length) {
    return normalizedActiveTf ? [normalizedActiveTf] : [];
  }
  const scopedTfs = candidateTfs.filter((tf) => {
    const tfSeconds = Math.max(1, Number(timeframeToSeconds(tf)) || 0);
    if (!activeTfSeconds || !tfSeconds) return true;
    return tfSeconds >= activeTfSeconds;
  });
  const sortedScopedTfs = sortTimeframes(
    scopedTfs.length ? scopedTfs : candidateTfs,
    "desc",
  );
  return sortedScopedTfs.length
    ? sortedScopedTfs
    : normalizedActiveTf
      ? [normalizedActiveTf]
      : [];
}

function applyTradeStopBuffer(entry = null, stop = null, side = "BUY") {
  const numericEntry = Number(entry);
  const numericStop = Number(stop);
  if (!Number.isFinite(numericEntry) || !Number.isFinite(numericStop)) {
    return numericStop;
  }
  const upperSide = String(side || "BUY").trim().toUpperCase();
  const rawRisk = Math.abs(numericEntry - numericStop);
  if (!(rawRisk > 0)) return numericStop;
  const buffer = Math.max(Math.abs(numericEntry) * 0.00025, rawRisk * 0.2);
  return upperSide === "BUY" ? numericStop - buffer : numericStop + buffer;
}

function applyTradeTargetTrim({
  entry = null,
  rawTarget = null,
  side = "BUY",
  risk = null,
  minRr = 1.5,
}) {
  const numericEntry = Number(entry);
  const numericTarget = Number(rawTarget);
  const numericRisk = Number(risk);
  if (
    !Number.isFinite(numericEntry) ||
    !Number.isFinite(numericTarget) ||
    !(numericRisk > 0)
  ) {
    return numericTarget;
  }
  const upperSide = String(side || "BUY").trim().toUpperCase();
  const rawReward = Math.abs(numericTarget - numericEntry);
  if (!(rawReward > 0)) return numericTarget;
  const minReward = numericRisk * Math.max(1, Number(minRr) || 1.5);
  const trim = Math.max(Math.abs(numericEntry) * 0.0001, numericRisk * 0.08);
  const trimmedReward = Math.max(minReward, rawReward - trim);
  return upperSide === "BUY"
    ? numericEntry + trimmedReward
    : numericEntry - trimmedReward;
}

function isReasonableArtifactPriceForTradeLevel(candidatePrice = null, entryPrice = null) {
  const candidate = Number(candidatePrice);
  const entry = Number(entryPrice);
  if (!Number.isFinite(candidate) || !(candidate > 0)) return false;
  if (!Number.isFinite(entry) || !(entry > 0)) return true;
  const ratio = candidate / entry;
  if (!Number.isFinite(ratio) || ratio <= 0) return false;
  return ratio >= 0.25 && ratio <= 4;
}

export function buildSuggestedTradeLevels({
  side = "BUY",
  entryPrice = null,
  referencePrice = null,
  activeTf = "",
  selectedTfs = [],
  artifactItemsByTf = {},
  minRr = 1.5,
}) {
  const entry = Number(entryPrice);
  if (!Number.isFinite(entry) || entry <= 0) return { tp: null, sl: null };
  const reference = Number(referencePrice);
  const anchor =
    Number.isFinite(reference) && reference > 0 ? reference : entry;
  const upperSide = String(side || "BUY").trim().toUpperCase();
  const targetMinRr = Math.max(1, Number(minRr) || 1.5);
  const stopCandidates = [];
  const targetCandidates = [];
  const tfList = Array.isArray(selectedTfs) ? selectedTfs : [];

  tfList.forEach((tfRaw) => {
    const tfKey = String(tfRaw || "").trim().toLowerCase();
    if (!tfKey) return;
    const tfItems = Array.isArray(artifactItemsByTf?.[tfKey])
      ? artifactItemsByTf[tfKey]
      : [];
    tfItems.forEach((item) => {
      const groupKey = artifactGroupKeyForItem(item);
      const bounds = artifactPriceBounds(item);
      if (!groupKey || !bounds) return;
      const low = Number(bounds.low);
      const high = Number(bounds.high);
      if (!Number.isFinite(low) || !Number.isFinite(high)) return;
      if (
        !isReasonableArtifactPriceForTradeLevel(low, entry) ||
        !isReasonableArtifactPriceForTradeLevel(high, entry)
      ) {
        return;
      }
      const tfWeight = timeframePriorityWeight(tfKey, activeTf);

      if (upperSide === "BUY") {
        if (low < anchor && low < entry) {
          const distance = anchor - low;
          if (distance > 0) {
            stopCandidates.push({
              tfKey,
              groupKey,
              price: low,
              score:
                artifactTradeGroupWeight(groupKey, upperSide, "sl") * 100 +
                tfWeight * 10 -
                distance,
            });
          }
        }
        if (high > anchor) {
          const targetPrice = low > anchor ? low : high;
          const distance = targetPrice - anchor;
          const rewardFromEntry = targetPrice - entry;
          if (distance > 0 && rewardFromEntry > 0) {
            targetCandidates.push({
              tfKey,
              groupKey,
              price: targetPrice,
              score:
                artifactTradeGroupWeight(groupKey, upperSide, "tp") * 100 +
                tfWeight * 10 -
                distance,
            });
          }
        }
      } else {
        if (high > anchor && high > entry) {
          const distance = high - anchor;
          if (distance > 0) {
            stopCandidates.push({
              tfKey,
              groupKey,
              price: high,
              score:
                artifactTradeGroupWeight(groupKey, upperSide, "sl") * 100 +
                tfWeight * 10 -
                distance,
            });
          }
        }
        if (low < anchor) {
          const targetPrice = high < anchor ? high : low;
          const distance = anchor - targetPrice;
          const rewardFromEntry = entry - targetPrice;
          if (distance > 0 && rewardFromEntry > 0) {
            targetCandidates.push({
              tfKey,
              groupKey,
              price: targetPrice,
              score:
                artifactTradeGroupWeight(groupKey, upperSide, "tp") * 100 +
                tfWeight * 10 -
                distance,
            });
          }
        }
      }
    });
  });

  const sortedStops = stopCandidates.sort((a, b) => b.score - a.score);
  const sortedTargets = targetCandidates.sort((a, b) => {
    const distanceDelta = Math.abs(a.price - entry) - Math.abs(b.price - entry);
    if (Math.abs(distanceDelta) > 0.000001) return distanceDelta;
    return b.score - a.score;
  });
  const chosenStop = sortedStops[0] || null;
  if (!chosenStop) return { tp: null, sl: null };
  const bufferedStop = applyTradeStopBuffer(entry, chosenStop.price, upperSide);
  const risk =
    upperSide === "BUY" ? entry - bufferedStop : bufferedStop - entry;
  if (!(risk > 0)) return { tp: null, sl: null };
  const chosenTarget =
    sortedTargets.find((candidate) => {
      const reward =
        upperSide === "BUY"
          ? candidate.price - entry
          : entry - candidate.price;
      return reward / risk >= targetMinRr;
    }) ||
    sortedTargets[0] ||
    null;
  const rawTarget = chosenTarget?.price ?? null;
  const finalTarget = applyTradeTargetTrim({
    entry,
    rawTarget,
    side: upperSide,
    risk,
    minRr: targetMinRr,
  });
  return {
    sl: bufferedStop,
    tp: finalTarget,
  };
}
