"use strict";

const fs = require("fs");
const path = require("path");

const barsStorage = require("../marketData/marketDataRepo");
const backtestService = require("../backtests/backtestService");

const { normalizeBarRows } = backtestService.__test;

const DERIVATION_SOURCE_TF = Object.freeze({
  "5": "1",
  "15": "5",
  "60": "15",
  "240": "60",
  "1440": "60",
});
const MAX_SUSPICIOUS_ITEMS = 12;

function summarizeSeries(bars = []) {
  if (!Array.isArray(bars) || !bars.length) {
    return {
      bar_count: 0,
      first_bar_at: null,
      last_bar_at: null,
    };
  }
  return {
    bar_count: bars.length,
    first_bar_at: new Date(Number(bars[0].time) * 1000).toISOString(),
    last_bar_at: new Date(Number(bars[bars.length - 1].time) * 1000).toISOString(),
  };
}

function compareBarSeries(expected = [], actual = []) {
  const expectedMap = new Map(
    (Array.isArray(expected) ? expected : []).map((bar) => [Number(bar.time), bar]),
  );
  const actualMap = new Map(
    (Array.isArray(actual) ? actual : []).map((bar) => [Number(bar.time), bar]),
  );
  const timestamps = [...new Set([...expectedMap.keys(), ...actualMap.keys()])]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const mismatches = [];
  for (const time of timestamps) {
    const left = expectedMap.get(time);
    const right = actualMap.get(time);
    if (!left || !right) {
      mismatches.push({
        time,
        reason: left ? "missing_actual" : "missing_expected",
      });
      continue;
    }
    const diff = {};
    for (const field of ["open", "high", "low", "close", "volume"]) {
      const a = Number(left[field] || 0);
      const b = Number(right[field] || 0);
      if (Math.abs(a - b) > 1e-9) {
        diff[field] = { expected: a, actual: b };
      }
    }
    if (Object.keys(diff).length) {
      mismatches.push({ time, diff });
    }
  }
  return {
    expected_bars: expected.length,
    actual_bars: actual.length,
    mismatch_count: mismatches.length,
    mismatches: mismatches.slice(0, 20),
  };
}

function deriveTimeframeFromLowerBars(lowerBars = [], targetTf = "15", lowerTf = "5") {
  return barsStorage.aggregateBarsFromLowerTimeframe(
    lowerBars,
    Math.max(60, barsStorage.parseTfTokenToSeconds(targetTf)),
    Math.max(60, barsStorage.parseTfTokenToSeconds(lowerTf)),
    0,
  );
}

function inspectRawCsvFile(filePath, tf = "15") {
  const diagnostics = {
    input_rows: 0,
    dropped_invalid_rows: 0,
    duplicate_timestamps: 0,
    non_monotonic_input: 0,
    corrected_ohlc_rows: 0,
  };
  if (!filePath || path.extname(filePath).toLowerCase() !== ".csv" || !fs.existsSync(filePath)) {
    return diagnostics;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = String(raw || "").trim().split(/\r?\n/);
  let previousTime = null;
  const seenTimes = new Set();
  const tfSeconds = Math.max(60, barsStorage.parseTfTokenToSeconds(tf));
  for (let index = 1; index < lines.length; index += 1) {
    const cols = String(lines[index] || "").split(",");
    if (cols.length < 5) {
      diagnostics.dropped_invalid_rows += 1;
      continue;
    }
    const time = barsStorage.normalizeBarTimeToUTC(Number(cols[0]), tfSeconds);
    const open = Number(cols[1]);
    const high = Number(cols[2]);
    const low = Number(cols[3]);
    const close = Number(cols[4]);
    diagnostics.input_rows += 1;
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      diagnostics.dropped_invalid_rows += 1;
      continue;
    }
    if (previousTime !== null && time < previousTime) {
      diagnostics.non_monotonic_input += 1;
    }
    previousTime = time;
    if (seenTimes.has(time)) {
      diagnostics.duplicate_timestamps += 1;
    }
    seenTimes.add(time);
    const boundedHigh = Math.max(high, open, close, low);
    const boundedLow = Math.min(low, open, close, high);
    if (boundedHigh !== high || boundedLow !== low) {
      diagnostics.corrected_ohlc_rows += 1;
    }
  }
  return diagnostics;
}

function medianNumber(values = []) {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function formatUnixSec(sec) {
  const value = Number(sec);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function detectGapWindows(bars = [], tfNorm = "1") {
  const tfSeconds = Math.max(60, barsStorage.parseTfTokenToSeconds(tfNorm));
  const rows = Array.isArray(bars) ? bars : [];
  const gaps = [];
  for (let index = 1; index < rows.length; index += 1) {
    const previous = Number(rows[index - 1]?.time);
    const current = Number(rows[index]?.time);
    if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
    const missingBars = Math.round((current - previous) / tfSeconds) - 1;
    if (missingBars <= 0) continue;
    gaps.push({
      after_time: previous,
      after_at: formatUnixSec(previous),
      before_time: current,
      before_at: formatUnixSec(current),
      missing_bars: missingBars,
    });
  }
  return gaps;
}

function detectSuspiciousSpikeBars(bars = []) {
  const rows = (Array.isArray(bars) ? bars : [])
    .map((bar) => {
      const open = Number(bar?.open);
      const high = Number(bar?.high);
      const low = Number(bar?.low);
      const close = Number(bar?.close);
      const time = Number(bar?.time);
      if (
        !Number.isFinite(time) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        return null;
      }
      return {
        time,
        at: formatUnixSec(time),
        open,
        high,
        low,
        close,
        volume: Number(bar?.volume || 0),
        range: high - low,
        body: Math.abs(close - open),
      };
    })
    .filter(Boolean);
  if (!rows.length) return { median_range: 0, items: [] };
  const medianRange = medianNumber(rows.map((row) => row.range));
  const threshold = Math.max(medianRange * 4, medianRange + 2);
  const suspicious = rows
    .filter((row) => Number.isFinite(row.range) && row.range >= threshold)
    .sort((left, right) => right.range - left.range)
    .slice(0, MAX_SUSPICIOUS_ITEMS)
    .map((row) => ({
      ...row,
      range_multiple: medianRange > 0 ? Number((row.range / medianRange).toFixed(2)) : null,
    }));
  return {
    median_range: medianRange,
    threshold,
    items: suspicious,
  };
}

function detectZeroVolumeRuns(bars = []) {
  const rows = Array.isArray(bars) ? bars : [];
  const runs = [];
  let cursor = 0;
  while (cursor < rows.length) {
    const volume = Number(rows[cursor]?.volume || 0);
    if (volume > 0) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < rows.length && Number(rows[cursor]?.volume || 0) <= 0) {
      cursor += 1;
    }
    const end = cursor - 1;
    const length = end - start + 1;
    if (length < 5) continue;
    runs.push({
      start_time: Number(rows[start]?.time || 0),
      start_at: formatUnixSec(rows[start]?.time),
      end_time: Number(rows[end]?.time || 0),
      end_at: formatUnixSec(rows[end]?.time),
      bars: length,
    });
  }
  return runs.slice(0, MAX_SUSPICIOUS_ITEMS);
}

function buildIssueReport({
  symbol,
  tf,
  normalizedBars = [],
  diagnostics = {},
  derivation = null,
}) {
  const gapWindows = detectGapWindows(normalizedBars, tf);
  const spikeBars = detectSuspiciousSpikeBars(normalizedBars);
  const zeroVolumeRuns = detectZeroVolumeRuns(normalizedBars);
  const reasons = [];
  if (Number(diagnostics?.duplicate_timestamps || 0) > 0) {
    reasons.push(`duplicate_timestamps:${Number(diagnostics.duplicate_timestamps)}`);
  }
  if (Number(diagnostics?.non_monotonic_input || 0) > 0) {
    reasons.push(`non_monotonic_input:${Number(diagnostics.non_monotonic_input)}`);
  }
  if (Number(diagnostics?.corrected_ohlc_rows || 0) > 0) {
    reasons.push(`corrected_ohlc_rows:${Number(diagnostics.corrected_ohlc_rows)}`);
  }
  if (gapWindows.length > 0) {
    reasons.push(`gap_windows:${gapWindows.length}`);
  }
  if (spikeBars.items.length > 0) {
    reasons.push(`spike_bars:${spikeBars.items.length}`);
  }
  if (zeroVolumeRuns.length > 0) {
    reasons.push(`zero_volume_runs:${zeroVolumeRuns.length}`);
  }
  const derivationMismatchCount = Number(
    derivation?.comparison?.mismatch_count || 0,
  );
  if (derivationMismatchCount > 0) {
    reasons.push(`derivation_mismatches:${derivationMismatchCount}`);
  }
  const suspicious = reasons.length > 0;
  return {
    symbol: String(symbol || "").trim().toUpperCase(),
    tf: String(tf || "").trim(),
    suspicious,
    reasons,
    suspicious_places: {
      gap_windows: gapWindows.slice(0, MAX_SUSPICIOUS_ITEMS),
      spike_bars: spikeBars.items,
      zero_volume_runs: zeroVolumeRuns,
    },
    metrics: {
      gap_count: gapWindows.length,
      median_bar_range: spikeBars.median_range,
      zero_volume_run_count: zeroVolumeRuns.length,
      derivation_mismatch_count: derivationMismatchCount,
    },
  };
}

function auditMarketData(symbol, tf, options = {}) {
  const symbolNorm = String(symbol || "").trim().toUpperCase();
  const tfNorm = barsStorage.normalizeCsvTfKey(tf);
  if (!symbolNorm || !tfNorm) {
    throw new Error("symbol and tf are required");
  }

  const filePath = barsStorage.resolveBrokerBarsFilePath(symbolNorm, tfNorm, options);
  const rawBars =
    filePath && String(filePath).trim()
      ? barsStorage.readBarsFile(filePath, tfNorm, 0, {
          ...options,
          fullFile: true,
        })
      : [];
  const normalized = normalizeBarRows(rawBars, tfNorm);
  const rawDiagnostics = inspectRawCsvFile(filePath, tfNorm);
  const sourceTf = DERIVATION_SOURCE_TF[tfNorm] || "";
  const sourcePath = sourceTf
    ? barsStorage.resolveBrokerBarsFilePath(symbolNorm, sourceTf, options)
    : "";

  let derivation = null;
  if (sourceTf && sourcePath) {
    const lowerBars = barsStorage.readBarsFile(sourcePath, sourceTf, 0, {
      ...options,
      fullFile: true,
    });
    const derived = deriveTimeframeFromLowerBars(lowerBars, tfNorm, sourceTf);
    const alignedStored =
      derived.length && normalized.bars.length > derived.length
        ? normalized.bars.slice(-derived.length)
        : normalized.bars;
    derivation = {
      target_tf: tfNorm,
      source_tf: sourceTf,
      source_path: sourcePath || null,
      source_summary: summarizeSeries(lowerBars),
      derived_summary: summarizeSeries(derived),
      comparison: compareBarSeries(derived, alignedStored),
    };
  }

  return {
    ok: true,
    symbol: symbolNorm,
    tf: tfNorm,
    provider: barsStorage.getBarsStorageProvider(),
    file_path: filePath || null,
    summary: summarizeSeries(normalized.bars),
    diagnostics: {
      ...normalized.diagnostics,
      input_rows: rawDiagnostics.input_rows || normalized.diagnostics.input_rows,
      dropped_invalid_rows:
        rawDiagnostics.dropped_invalid_rows || normalized.diagnostics.dropped_invalid_rows,
      duplicate_timestamps:
        rawDiagnostics.duplicate_timestamps || normalized.diagnostics.duplicate_timestamps,
      non_monotonic_input:
        rawDiagnostics.non_monotonic_input || normalized.diagnostics.non_monotonic_input,
      corrected_ohlc_rows:
        rawDiagnostics.corrected_ohlc_rows || normalized.diagnostics.corrected_ohlc_rows,
    },
    derivation,
    issue_report: buildIssueReport({
      symbol: symbolNorm,
      tf: tfNorm,
      normalizedBars: normalized.bars,
      diagnostics: {
        ...normalized.diagnostics,
        ...rawDiagnostics,
      },
      derivation,
    }),
  };
}

function inspectAndRepairMarketData(symbol, tf, options = {}) {
  const symbolNorm = String(symbol || "").trim().toUpperCase();
  const tfNorm = barsStorage.normalizeCsvTfKey(tf);
  if (!symbolNorm || !tfNorm) {
    throw new Error("symbol and tf are required");
  }
  const action = String(options.action || "inspect").trim().toLowerCase();
  const filePath = barsStorage.resolveBrokerBarsFilePath(symbolNorm, tfNorm, options);
  const before = auditMarketData(symbolNorm, tfNorm, options);
  const out = {
    ok: true,
    symbol: symbolNorm,
    tf: tfNorm,
    action,
    file_path: filePath || null,
    before,
    operations: [],
  };

  if (action === "inspect") {
    out.after = before;
    return out;
  }

  if (action === "repair" || action === "auto_fix") {
    const repairResult = barsStorage.repairBarsFile(filePath, tfNorm, options);
    out.operations.push({
      type: "repair_file",
      applied: Boolean(repairResult?.repaired),
      rows: Number(repairResult?.rows || 0),
    });
  }

  if (action === "rebuild" || action === "auto_fix") {
    if (tfNorm === "1") {
      const rebuildChain = barsStorage.rebuildBrokerTimeframeChain(symbolNorm, "1", options);
      out.operations.push({
        type: "rebuild_chain_from_1m",
        applied: true,
        result: rebuildChain,
      });
    } else {
      const rebuildCurrent = barsStorage.rebuildBrokerBarsFromCanonicalSource(
        symbolNorm,
        tfNorm,
        options,
      );
      out.operations.push({
        type: "rebuild_from_canonical_source",
        applied: Boolean(rebuildCurrent?.rewritten),
        result: rebuildCurrent,
      });
    }
  }

  out.after = auditMarketData(symbolNorm, tfNorm, options);
  return out;
}

module.exports = {
  DERIVATION_SOURCE_TF,
  summarizeSeries,
  compareBarSeries,
  deriveTimeframeFromLowerBars,
  auditMarketData,
  inspectAndRepairMarketData,
};
