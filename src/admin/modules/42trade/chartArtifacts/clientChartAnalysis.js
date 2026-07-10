import * as artifactDetection from "./detectArtifacts.js";
import { buildMultiTfAnalysis } from "./realtimeAnalysis.js";

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
    "liquidity",
    "bos",
    "choch",
    "sweep",
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
