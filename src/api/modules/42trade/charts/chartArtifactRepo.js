"use strict";

const fs = require("fs");
const path = require("path");

const MARKET_DATA_DIRNAME = "market_data";
const CHART_DIRNAME = "chart";
const ARTIFACTS_FILENAME = "artifacts.json";
const LATEST_FILENAME = "latest.json";
const CANONICAL_EVENTS_CACHE_FILENAME = "canonical_events.tsv";
const CANONICAL_EVENTS_CACHE_VERSION = "1";
const DEFAULT_MARKET_ARTIFACT_MAX_BARS = 5000;

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

function acquireFileLock(lockPath) {
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, `${process.pid}\n`);
      return fd;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (ageMs > 30000) fs.unlinkSync(lockPath);
      } catch {}
      Atomics.wait(waitBuffer, 0, 0, 10);
    }
  }
  throw new Error(`Timed out acquiring artifact lock: ${lockPath}`);
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const lockPath = `${filePath}.lock`;
  const lockFd = acquireFileLock(lockPath);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    const fileFd = fs.openSync(tmp, "r");
    try { fs.fsyncSync(fileFd); } finally { fs.closeSync(fileFd); }
    fs.renameSync(tmp, filePath);
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    try { fs.closeSync(lockFd); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function buildMarketArtifactFileName(startTime = null, endTime = null) {
  return LATEST_FILENAME;
}

function getMarketArtifactMaxBars(options = {}) {
  const value = Number(
    options.maxBars ??
      options.max_bars ??
      process.env.CHART_ARTIFACT_MAX_BARS,
  );
  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_MARKET_ARTIFACT_MAX_BARS;
}

function inferTimeframeSeconds(timeframe) {
  const tf = normalizeTf(timeframe);
  const minutes = Number(tf);
  if (Number.isFinite(minutes) && minutes > 0) return Math.floor(minutes * 60);
  return 60;
}

function itemTime(item = {}) {
  return normalizeUnixTime(
    item.anchor_time ??
      item.bar_start ??
      item.bar_end ??
      item.time ??
      item.payload?.bar?.time,
  );
}

function mergeArtifactItems(existingItems = [], incomingItems = []) {
  const byId = new Map();
  for (const item of [...existingItems, ...incomingItems]) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || "").trim();
    if (id) byId.set(id, item);
  }
  return [...byId.values()];
}

function trimMarketArtifactEnvelope(envelope, timeframe, options = {}) {
  if (!envelope || typeof envelope !== "object") return envelope;
  const maxBars = getMarketArtifactMaxBars(options);
  const lastBarTime = normalizeUnixTime(envelope?.bars_ref?.last_bar_time);
  if (!lastBarTime || !maxBars) return envelope;

  const cutoff = lastBarTime - (maxBars - 1) * inferTimeframeSeconds(timeframe);
  const items = Array.isArray(envelope.items)
    ? envelope.items.filter((item) => {
        const time = itemTime(item);
        return !time || time >= cutoff;
      })
    : [];

  return {
    ...envelope,
    bars_ref: {
      ...(envelope.bars_ref || {}),
      first_bar_time: Math.max(
        normalizeUnixTime(envelope?.bars_ref?.first_bar_time) || cutoff,
        cutoff,
      ),
      retained_max_bars: maxBars,
    },
    items,
  };
}

function pruneLegacyMarketArtifactRangeFiles(symbol, timeframe, options = {}) {
  const latestPath = resolveMarketArtifactPath(symbol, timeframe, {
    dataRoot: options.dataRoot,
  });
  const dir = path.dirname(latestPath);
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!/^\d+_\d+\.json$/u.test(name)) continue;
      try { fs.unlinkSync(path.join(dir, name)); } catch {}
    }
  } catch {}
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
  const latestEnvelope = readJson(
    resolveMarketArtifactPath(symbol, timeframe, {
      dataRoot: options.dataRoot,
    }),
    null,
  );
  if (!envelope && latestEnvelope) {
    envelope = latestEnvelope;
  } else if (envelope && latestEnvelope && hasExplicitRange) {
    // Range files may predate the shared cTrader writer. Carry the latest cTrader
    // artifacts into the range response without reintroducing derived 42trade items.
    const latestShared = Array.isArray(latestEnvelope.items)
      ? latestEnvelope.items.filter(
          (item) => String(item?.source || "").trim().toLowerCase() === "ctrader",
        )
      : [];
    if (latestShared.length) {
      const seen = new Set(
        (Array.isArray(envelope.items) ? envelope.items : [])
          .map((item) => String(item?.id || "").trim())
          .filter(Boolean),
      );
      const sharedToAdd = latestShared.filter((item) => {
        const id = String(item?.id || "").trim();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      if (sharedToAdd.length) {
        envelope = { ...envelope, items: [...(envelope.items || []), ...sharedToAdd] };
      }
    }
  }
  return envelope;
}

function writeMarketArtifactEnvelope(symbol, timeframe, envelope, options = {}) {
  const filePath = resolveMarketArtifactPath(symbol, timeframe, options);
  const existing = readJson(filePath, null);
  const merged =
    existing && typeof existing === "object" && Number(existing.version) === Number(envelope?.version)
      ? {
          ...existing,
          ...envelope,
          items: mergeArtifactItems(existing.items, envelope.items),
          meta: {
            ...(existing.meta && typeof existing.meta === "object" ? existing.meta : {}),
            ...(envelope.meta && typeof envelope.meta === "object" ? envelope.meta : {}),
          },
        }
      : envelope;
  const trimmed = trimMarketArtifactEnvelope(merged, timeframe, options);
  writeJsonAtomic(filePath, trimmed);
  pruneLegacyMarketArtifactRangeFiles(symbol, timeframe, options);
  return trimmed;
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
