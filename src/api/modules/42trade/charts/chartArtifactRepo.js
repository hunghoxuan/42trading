"use strict";

const fs = require("fs");
const path = require("path");

const MARKET_DATA_DIRNAME = "market_data";
const CHART_DIRNAME = "chart";
const ARTIFACTS_FILENAME = "artifacts.json";
const LATEST_FILENAME = "latest.json";

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

module.exports = {
  ARTIFACTS_FILENAME,
  CHART_DIRNAME,
  LATEST_FILENAME,
  MARKET_DATA_DIRNAME,
  buildMarketArtifactFileName,
  normalizeTf,
  normalizeUnixTime,
  readJson,
  readLegacyTradeObjects,
  readMarketArtifactEnvelope,
  readTradeArtifactEnvelope,
  resolveLegacyTradeObjectsPath,
  resolveMarketArtifactPath,
  resolveMarketMetadataPath,
  resolveTradeArtifactPath,
  safePathPart,
  writeMarketArtifactEnvelope,
  writeTradeArtifactEnvelope,
};
