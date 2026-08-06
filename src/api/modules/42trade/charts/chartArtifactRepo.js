"use strict";

const fs = require("fs");
const path = require("path");

const MARKET_DATA_DIRNAME = "market_data";
const CHART_DIRNAME = "chart";
const ARTIFACTS_FILENAME = "artifacts.json";
const LATEST_FILENAME = "latest.json";
const CANONICAL_EVENTS_CACHE_FILENAME = "canonical_events.tsv";
const CANONICAL_EVENTS_CACHE_VERSION = "1";

function safePathPart(value, fallback = "default") {
  const raw = String(value || "").trim() || fallback;
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+$/, "_");
  return safe || fallback;
}

function normalizeTf(tf) {
  const raw = String(tf || "").trim().toLowerCase();
  if (!raw) return "";
  if (["1", "1m", "1min"].includes(raw)) return "1";
  if (["5", "5m", "5min"].includes(raw)) return "5";
  if (["15", "15m", "15min"].includes(raw)) return "15";
  if (["60", "1h", "60m", "60min"].includes(raw)) return "60";
  if (["240", "4h"].includes(raw)) return "240";
  if (["1440", "1d", "d", "day"].includes(raw)) return "1440";
  return raw;
}

function normalizeUnixTime(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function buildMarketArtifactFileName(startTime = null, endTime = null) {
  const start = normalizeUnixTime(startTime);
  const end = normalizeUnixTime(endTime);
  if (start && end) return `${start}_${end}.json`;
  return LATEST_FILENAME;
}

function resolveMarketArtifactPath(symbol, timeframe, options = {}) {
  const dataRoot = String(options.dataRoot || "").trim();
  const root = dataRoot || path.resolve(__dirname, "..", "..", "..", "data");
  const sym = safePathPart(String(symbol || "").trim().toUpperCase(), "UNKNOWN");
  const tf = safePathPart(normalizeTf(timeframe), "default");
  const fileName = buildMarketArtifactFileName(
    options.startTime ?? options.start_time,
    options.endTime ?? options.end_time,
  );
  return path.join(root, MARKET_DATA_DIRNAME, sym, CHART_DIRNAME, tf, fileName);
}

function resolveMarketMetadataPath(symbol, timeframe, options = {}) {
  const dataRoot = String(options.dataRoot || "").trim();
  const root = dataRoot || path.resolve(__dirname, "..", "..", "..", "data");
  const sym = safePathPart(String(symbol || "").trim().toUpperCase(), "UNKNOWN");
  const tf = safePathPart(normalizeTf(timeframe), "default");
  return path.join(root, MARKET_DATA_DIRNAME, sym, "metadata", `${tf}.json`);
}

function resolveTradeArtifactPath(tradeDir) {
  return path.join(tradeDir, CHART_DIRNAME, ARTIFACTS_FILENAME);
}

function resolveCanonicalEventCachePath(symbol, timeframe, options = {}) {
  const dataRoot = String(options.dataRoot || "").trim();
  const root = dataRoot || path.resolve(__dirname, "..", "..", "..", "data");
  const sym = safePathPart(String(symbol || "").trim().toUpperCase(), "UNKNOWN");
  const tf = safePathPart(normalizeTf(timeframe), "default");
  return path.join(root, MARKET_DATA_DIRNAME, sym, CHART_DIRNAME, tf, CANONICAL_EVENTS_CACHE_FILENAME);
}

function resolveLegacyTradeObjectsPath(tradeDir) {
  return path.join(tradeDir, "chart_objects.json");
}

function readMarketArtifactEnvelope(symbol, timeframe, options = {}) {
  const filePath = resolveMarketArtifactPath(symbol, timeframe, options);
  let envelope = readJson(filePath, null);
  const hasExplicitRange =
    normalizeUnixTime(options.startTime ?? options.start_time) ||
    normalizeUnixTime(options.endTime ?? options.end_time);
  if (!envelope && !hasExplicitRange) {
    envelope = readJson(
      resolveMarketArtifactPath(symbol, timeframe, {
        dataRoot: options.dataRoot,
      }),
      null,
    );
  }
  return envelope;
}

function writeMarketArtifactEnvelope(symbol, timeframe, envelope, options = {}) {
  const filePath = resolveMarketArtifactPath(symbol, timeframe, options);
  writeJsonAtomic(filePath, envelope);
  const latestPath = resolveMarketArtifactPath(symbol, timeframe, {
    dataRoot: options.dataRoot,
  });
  if (latestPath !== filePath) {
    writeJsonAtomic(latestPath, envelope);
  }
  return envelope;
}

function readTradeArtifactEnvelope(tradeDir) {
  return readJson(resolveTradeArtifactPath(tradeDir), null);
}

function writeTradeArtifactEnvelope(tradeDir, envelope) {
  writeJsonAtomic(resolveTradeArtifactPath(tradeDir), envelope);
  return envelope;
}

function readLegacyTradeObjects(tradeDir) {
  return readJson(resolveLegacyTradeObjectsPath(tradeDir), []);
}

function readCanonicalEventCache(symbol, timeframe, options = {}) {
  const filePath = resolveCanonicalEventCachePath(symbol, timeframe, options);
  const result = {
    version: CANONICAL_EVENTS_CACHE_VERSION,
    symbol: String(symbol || "").trim().toUpperCase(),
    timeframe: normalizeTf(timeframe),
    computed_bar_times_unix: [],
    events: [],
  };

  try {
    if (!fs.existsSync(filePath)) return result;
    const lines = String(fs.readFileSync(filePath, "utf8") || "").split(/\r?\n/);
    const computed = new Set();
    const events = [];
    for (const rawLine of lines) {
      const line = String(rawLine || "").trim();
      if (!line) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      if (parts[1] !== CANONICAL_EVENTS_CACHE_VERSION) continue;
      const barTimeUnix = Number(parts[2]);
      if (!Number.isFinite(barTimeUnix) || barTimeUnix <= 0) continue;

      if (parts[0] === "BAR") {
        computed.add(Math.floor(barTimeUnix));
        continue;
      }

      if (parts[0] !== "EVT" || parts.length < 11) continue;
      events.push({
        bar_time_unix: Math.floor(barTimeUnix),
        event_key: String(parts[3] || ""),
        event_type: String(parts[4] || "").toLowerCase(),
        direction: String(parts[5] || "").toLowerCase(),
        reason: String(parts[6] || "").toLowerCase(),
        action: String(parts[7] || "").toLowerCase(),
        price_ref: Number(parts[8]) || 0,
        score: Number(parts[9]) || 0,
        confidence: Number(parts[10]) || 0,
      });
    }

    result.computed_bar_times_unix = [...computed].sort((a, b) => a - b);
    result.events = dedupeCanonicalEventRecords(events);
    return result;
  } catch {
    return result;
  }
}

function dedupeCanonicalEventRecords(events = []) {
  const seen = new Set();
  return [...events]
    .filter(Boolean)
    .sort((a, b) => {
      const ta = Number(a?.bar_time_unix || 0);
      const tb = Number(b?.bar_time_unix || 0);
      if (tb !== ta) return tb - ta;
      const sa = Number(a?.score || 0);
      const sb = Number(b?.score || 0);
      if (sb !== sa) return sb - sa;
      return Number(b?.price_ref || 0) - Number(a?.price_ref || 0);
    })
    .filter((event) => {
      const key = [
        String(event?.event_key || ""),
        String(event?.bar_time_unix || 0),
        Number(event?.price_ref || 0).toFixed(6),
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function writeCanonicalEventCache(symbol, timeframe, payload = {}, options = {}) {
  const filePath = resolveCanonicalEventCachePath(symbol, timeframe, options);
  ensureDir(path.dirname(filePath));
  const computed = [
    ...new Set(
      (Array.isArray(payload?.computed_bar_times_unix)
        ? payload.computed_bar_times_unix
        : []
      )
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value)),
    ),
  ].sort((a, b) => a - b);
  const events = dedupeCanonicalEventRecords(Array.isArray(payload?.events) ? payload.events : []);
  const lines = [];
  for (const barTimeUnix of computed) {
    lines.push(`BAR\t${CANONICAL_EVENTS_CACHE_VERSION}\t${barTimeUnix}`);
  }
  for (const event of events) {
    lines.push(
      [
        "EVT",
        CANONICAL_EVENTS_CACHE_VERSION,
        Math.floor(Number(event?.bar_time_unix || 0)),
        String(event?.event_key || ""),
        String(event?.event_type || ""),
        String(event?.direction || ""),
        String(event?.reason || ""),
        String(event?.action || ""),
        Number(event?.price_ref || 0),
        Math.floor(Number(event?.score || 0)),
        Math.floor(Number(event?.confidence || 0)),
      ].join("\t"),
    );
  }
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${lines.join("\n")}\n`);
  fs.renameSync(tmp, filePath);
  return {
    version: CANONICAL_EVENTS_CACHE_VERSION,
    symbol: String(symbol || "").trim().toUpperCase(),
    timeframe: normalizeTf(timeframe),
    computed_bar_times_unix: computed,
    events,
  };
}

module.exports = {
  ARTIFACTS_FILENAME,
  CANONICAL_EVENTS_CACHE_FILENAME,
  CANONICAL_EVENTS_CACHE_VERSION,
  CHART_DIRNAME,
  LATEST_FILENAME,
  MARKET_DATA_DIRNAME,
  buildMarketArtifactFileName,
  normalizeTf,
  normalizeUnixTime,
  readJson,
  readCanonicalEventCache,
  readLegacyTradeObjects,
  readMarketArtifactEnvelope,
  readTradeArtifactEnvelope,
  resolveCanonicalEventCachePath,
  resolveLegacyTradeObjectsPath,
  resolveMarketArtifactPath,
  resolveMarketMetadataPath,
  resolveTradeArtifactPath,
  safePathPart,
  writeCanonicalEventCache,
  writeMarketArtifactEnvelope,
  writeTradeArtifactEnvelope,
};
