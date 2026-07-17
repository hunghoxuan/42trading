"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const DEFAULT_DATA_ROOT = path.join(PROJECT_ROOT, "data");
const LEGACY_DATA_ROOT = path.join(path.resolve(__dirname, "..", "..", ".."), "data");
const DUCKDB_WORKER_PATH = path.join(
  __dirname,
  "providers",
  "marketDataDuckdbWorker.js",
);
const MAX_BARS_PER_FILE = 3000;
const MAX_READ_BARS_LIMIT = 5000;
const CANONICAL_SOURCE_TF = Object.freeze({
  "5": "1",
  "15": "5",
  "60": "15",
  "240": "60",
  "1440": "60",
});
const DEFAULT_BARS_STORAGE_PROVIDER = "parquet_duckdb";
const SUPPORTED_BARS_STORAGE_PROVIDERS = new Set([
  "csv",
  "parquet_duckdb",
  "postgres",
]);
const CFD_SYMBOLS = new Set([
  "XAUUSD",
  "XAUEUR",
  "XAUGBP",
  "XAUJPY",
  "XAGUSD",
  "XTIUSD",
  "USOIL",
  "UKOIL",
  "BRENT",
  "DE40",
  "GER40",
  "DAX",
  "NAS100",
  "US100",
  "SPX500",
  "US500",
  "US30",
  "UK100",
]);
const CRYPTO_BASES = new Set([
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "ADA",
  "DOGE",
  "BNB",
  "AVAX",
  "MATIC",
  "LTC",
  "DOT",
  "LINK",
  "TRX",
  "BCH",
  "XLM",
  "ATOM",
  "TON",
  "SHIB",
]);

function getDataRoot(options = {}) {
  const explicit = String(options.dataRoot || "").trim();
  if (explicit) return explicit;
  const envRoot = String(process.env.DATA_ROOT || "").trim();
  if (envRoot) return envRoot;
  if (fs.existsSync(DEFAULT_DATA_ROOT)) return DEFAULT_DATA_ROOT;
  if (fs.existsSync(LEGACY_DATA_ROOT)) return LEGACY_DATA_ROOT;
  return DEFAULT_DATA_ROOT;
}

function getMarketDataRoot(options = {}) {
  return path.join(getDataRoot(options), "market_data");
}

function getDuckDbPath(options = {}) {
  const explicit = String(options.duckdbPath || "").trim();
  if (explicit) return explicit;
  const envPath = String(process.env.BARS_DUCKDB_PATH || "").trim();
  if (envPath) return envPath;
  return path.join(getDataRoot(options), "bars.duckdb");
}

function normalizeBarsStorageProvider(provider, fallback = DEFAULT_BARS_STORAGE_PROVIDER) {
  const raw = String(provider || "")
    .trim()
    .toLowerCase();
  if (SUPPORTED_BARS_STORAGE_PROVIDERS.has(raw)) return raw;
  return fallback;
}

function getBarsStorageProvider(options = {}) {
  return normalizeBarsStorageProvider(
    options.provider || process.env.BARS_STORAGE_PROVIDER,
  );
}

function getPrimaryBarsExtension(provider = getBarsStorageProvider()) {
  const normalized = normalizeBarsStorageProvider(provider);
  if (normalized === "parquet_duckdb") return ".parquet";
  if (normalized === "csv") return ".csv";
  return "";
}

function normalizeCsvTfKey(tf) {
  const raw = String(tf || "").trim().toLowerCase();
  if (!raw) return "";
  if (
    raw === "d" ||
    raw === "1d" ||
    raw === "day" ||
    raw === "1440" ||
    raw === "1day"
  ) {
    return "1440";
  }
  if (raw === "w" || raw === "1w" || raw === "week") return "1w";
  if (raw === "4h" || raw === "240") return "240";
  if (raw === "1h" || raw === "60" || raw === "60m" || raw === "60min") {
    return "60";
  }
  if (raw === "15m" || raw === "15" || raw === "15min") return "15";
  if (raw === "5m" || raw === "5" || raw === "5min") return "5";
  if (raw === "1m" || raw === "1" || raw === "1min") return "1";
  return raw;
}

function csvTfAliases(tf) {
  const key = normalizeCsvTfKey(tf);
  if (!key) return [];
  const out = new Set([key]);
  if (key === "1440") out.add("1d");
  if (key === "1w") out.add("w");
  if (key === "240") out.add("4h");
  if (key === "60") out.add("1h");
  if (key === "15") out.add("15m");
  if (key === "5") out.add("5m");
  if (key === "1") out.add("1m");
  return [...out];
}

function parseTfTokenToSeconds(tfToken) {
  const s = String(tfToken || "").trim().toLowerCase();
  if (!s) return 60;
  const m = s.match(/^(\d+)\s*(min|m|hour|h|day|d|week|w|month|mo)$/i);
  if (m) {
    const v = Math.max(1, Number(m[1]) || 1);
    const unit = m[2].toLowerCase();
    if (unit === "min" || unit === "m") return v * 60;
    if (unit === "hour" || unit === "h") return v * 3600;
    if (unit === "day" || unit === "d") return v * 86400;
    if (unit === "week" || unit === "w") return v * 86400 * 7;
    return v * 86400 * 30;
  }
  const n = Number(s.replace(/[^\d]/g, ""));
  if (Number.isFinite(n) && n > 0) return n * 60;
  return 60;
}

function normalizeMarketDataSymbol(raw = "") {
  return String(raw || "").trim().toUpperCase();
}

function isCryptoLikeSymbol(symbol = "") {
  const sym = normalizeMarketDataSymbol(symbol);
  if (!sym) return false;
  if (sym.endsWith("USDT")) return true;
  const compact = sym.replace(/[^A-Z0-9]/g, "");
  if (compact.length < 6) return false;
  return CRYPTO_BASES.has(compact.slice(0, 3));
}

function isForexOrCfdSymbol(symbol = "") {
  const sym = normalizeMarketDataSymbol(symbol);
  if (!sym || isCryptoLikeSymbol(sym)) return false;
  if (CFD_SYMBOLS.has(sym)) return true;
  return /^[A-Z]{6}$/.test(sym);
}

function shouldDropZeroVolumeDerivedBar(symbol = "", tfKey = "", volume = 0) {
  const normalizedTf = normalizeCsvTfKey(tfKey);
  if (!normalizedTf || normalizedTf === "1" || normalizedTf === "1w") return false;
  if (!isForexOrCfdSymbol(symbol)) return false;
  return Number(volume || 0) <= 0;
}

function normalizeBarTimeToUTC(time, tfSeconds) {
  if (!Number.isFinite(time) || !tfSeconds || tfSeconds < 60) return time;
  return Math.floor(time / tfSeconds) * tfSeconds;
}

function normalizeOhlcRow(row = {}) {
  const t = Number(row.t ?? row.time);
  const o = Number(row.o ?? row.open);
  const h = Number(row.h ?? row.high);
  const l = Number(row.l ?? row.low);
  const c = Number(row.c ?? row.close);
  const v = Number(row.v ?? row.volume ?? 0);
  if (
    !Number.isFinite(t) ||
    !Number.isFinite(o) ||
    !Number.isFinite(h) ||
    !Number.isFinite(l) ||
    !Number.isFinite(c)
  ) {
    return null;
  }
  if (o <= 0 || h <= 0 || l <= 0 || c <= 0) {
    return null;
  }
  return {
    t,
    o,
    h: Math.max(h, o, c),
    l: Math.min(l, o, c),
    c,
    v: Number.isFinite(v) ? v : 0,
  };
}

function normalizeReadLimit(limit, options = {}) {
  if (options && options.fullFile) return null;
  const requested = Number(limit);
  if (!Number.isFinite(requested) || requested <= 0) {
    return Math.max(50, Math.min(300, MAX_READ_BARS_LIMIT));
  }
  return Math.max(1, Math.min(requested, MAX_READ_BARS_LIMIT));
}

function sliceRowsForRead(rows = [], limit = 300, options = {}) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const endTimeSec = Number(options?.endTimeSec);
  const scopedRows =
    Number.isFinite(endTimeSec) && endTimeSec > 0
      ? rows.filter((row) => Number(row?.time) <= endTimeSec)
      : rows;
  if (!scopedRows.length) return [];
  const normalizedLimit = normalizeReadLimit(limit, options);
  if (normalizedLimit === null) return scopedRows;
  return scopedRows.slice(-normalizedLimit);
}

function uniqueSortedBars(rows = [], timeKey = "time") {
  if (!Array.isArray(rows) || !rows.length) return [];
  const sorted = [...rows].sort(
    (a, b) => Number(a?.[timeKey] || 0) - Number(b?.[timeKey] || 0),
  );
  const dedup = new Map();
  for (const row of sorted) {
    const time = Number(row?.[timeKey]);
    if (!Number.isFinite(time)) continue;
    dedup.set(time, row);
  }
  return [...dedup.values()].sort(
    (a, b) => Number(a?.[timeKey] || 0) - Number(b?.[timeKey] || 0),
  );
}

function sanitizeShiftedZeroVolumeDuplicates(rows = [], tfSeconds = 60) {
  const sorted = [...rows].sort((a, b) => a.t - b.t);
  const byTime = new Map(sorted.map((row) => [row.t, row]));
  const drop = new Set();
  const offsets = [3600, 7200, 10800].filter((off) => off % tfSeconds === 0);
  const sameShape = (a, b) => {
    const base = Math.max(
      Math.abs(Number(a.c) || 0),
      Math.abs(Number(b.c) || 0),
      1,
    );
    const tol = Math.max(base * 0.0015, 0.00025);
    return (
      Math.abs(a.o - b.o) <= tol &&
      Math.abs(a.h - b.h) <= tol &&
      Math.abs(a.l - b.l) <= tol &&
      Math.abs(a.c - b.c) <= tol
    );
  };

  for (const offset of offsets) {
    let run = [];
    for (const row of sorted) {
      if (drop.has(row.t) || Number(row.v || 0) > 0) {
        if (run.length >= 2) run.forEach((t) => drop.add(t));
        run = [];
        continue;
      }
      const peer = byTime.get(row.t + offset);
      if (peer && Number(peer.v || 0) > 0 && sameShape(row, peer)) {
        run.push(row.t);
        continue;
      }
      if (run.length >= 2) run.forEach((t) => drop.add(t));
      run = [];
    }
    if (run.length >= 2) run.forEach((t) => drop.add(t));
  }

  return sorted.filter((row) => !drop.has(row.t));
}

function repairSuspiciousFrozenOpenSequences(rows = [], tfSeconds = 60) {
  if (!Array.isArray(rows) || rows.length < 2) return rows;
  if (tfSeconds < 5 * 60) return rows;
  const repaired = rows.map((row) => ({ ...row }));
  const minRunLength =
    tfSeconds >= 15 * 60
      ? 5
      : 8;
  let index = 0;

  while (index < repaired.length) {
    const runStart = index;
    const frozenOpen = Number(repaired[index]?.o);
    if (!Number.isFinite(frozenOpen)) {
      index += 1;
      continue;
    }
    index += 1;
    while (
      index < repaired.length &&
      Number.isFinite(Number(repaired[index]?.o)) &&
      Math.abs(Number(repaired[index].o) - frozenOpen) <= 0.0000001
    ) {
      index += 1;
    }
    const runEnd = index - 1;
    const runLength = runEnd - runStart + 1;
    if (runLength < minRunLength) continue;

    const closeSet = new Set(
      repaired
        .slice(runStart, runEnd + 1)
        .map((row) => Number(row.c).toFixed(5)),
    );
    if (closeSet.size < 3) continue;

    const previous = repaired[runStart - 1];
    if (!previous || !Number.isFinite(Number(previous.c))) continue;

    let currentOpen = Number(previous.c);
    for (let cursor = runStart; cursor <= runEnd; cursor += 1) {
      const row = repaired[cursor];
      row.o = currentOpen;
      row.h = Math.max(Number(row.h), Number(row.o), Number(row.c));
      row.l = Math.min(Number(row.l), Number(row.o), Number(row.c));
      currentOpen = Number(row.c);
    }
  }

  return repaired;
}

function dropIsolatedZeroVolumeBridgeSpikes(rows = [], tfSeconds = 60) {
  if (!Array.isArray(rows) || rows.length < 3) return rows;
  const out = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (index === 0 || index === rows.length - 1) {
      out.push(row);
      continue;
    }
    const previous = rows[index - 1];
    const next = rows[index + 1];
    const rowVolume = Number(row?.v || row?.volume || 0);
    const prevTime = Number(previous?.t ?? previous?.time);
    const rowTime = Number(row?.t ?? row?.time);
    const nextTime = Number(next?.t ?? next?.time);
    if (
      rowVolume > 0 ||
      !Number.isFinite(prevTime) ||
      !Number.isFinite(rowTime) ||
      !Number.isFinite(nextTime) ||
      rowTime - prevTime !== tfSeconds ||
      nextTime - rowTime !== tfSeconds
    ) {
      out.push(row);
      continue;
    }
    const prevClose = Number(previous?.c ?? previous?.close);
    const rowOpen = Number(row?.o ?? row?.open);
    const rowClose = Number(row?.c ?? row?.close);
    const nextOpen = Number(next?.o ?? next?.open);
    if (
      !Number.isFinite(prevClose) ||
      !Number.isFinite(rowOpen) ||
      !Number.isFinite(rowClose) ||
      !Number.isFinite(nextOpen)
    ) {
      out.push(row);
      continue;
    }
    const base = Math.max(
      Math.abs(prevClose),
      Math.abs(rowOpen),
      Math.abs(rowClose),
      Math.abs(nextOpen),
      1,
    );
    const threshold = Math.max(base * 0.004, base >= 100 ? 8 : 0.008);
    const jumpIn = Math.abs(rowOpen - prevClose);
    const jumpOut = Math.abs(nextOpen - rowClose);
    const directJump = Math.abs(nextOpen - prevClose);
    if (
      jumpIn >= threshold &&
      jumpOut >= threshold &&
      directJump <= threshold * 0.5
    ) {
      continue;
    }
    out.push(row);
  }
  return out;
}

function dropDisconnectedSyntheticPrefix(rows = [], tfSeconds = 60) {
  if (!Array.isArray(rows) || rows.length < 24) return rows;
  let candidate = -1;
  for (let index = 12; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    const prevTime = Number(previous?.t ?? previous?.time);
    const currentTime = Number(current?.t ?? current?.time);
    const prevClose = Number(previous?.c ?? previous?.close);
    const currentOpen = Number(current?.o ?? current?.open);
    if (
      !Number.isFinite(prevTime) ||
      !Number.isFinite(currentTime) ||
      !Number.isFinite(prevClose) ||
      !Number.isFinite(currentOpen)
    ) {
      continue;
    }
    const gap = currentTime - prevTime;
    if (gap < tfSeconds * 12) continue;
    const base = Math.max(Math.abs(prevClose), Math.abs(currentOpen), 1);
    const jumpThreshold = Math.max(base * 0.008, base >= 100 ? 15 : 0.015);
    const jump = Math.abs(currentOpen - prevClose);
    if (jump < jumpThreshold) continue;

    const olderWindow = rows.slice(Math.max(0, index - 12), index);
    const newerWindow = rows.slice(index, Math.min(rows.length, index + 12));
    const olderZeroRatio =
      olderWindow.filter((row) => Number(row?.v ?? row?.volume ?? 0) <= 0)
        .length / Math.max(1, olderWindow.length);
    const newerPositiveRatio =
      newerWindow.filter((row) => Number(row?.v ?? row?.volume ?? 0) > 0)
        .length / Math.max(1, newerWindow.length);
    if (olderZeroRatio >= 0.75 && newerPositiveRatio >= 0.5) {
      candidate = index;
    }
  }
  if (candidate <= 0) return rows;
  const tailLength = rows.length - candidate;
  if (tailLength >= 60) return rows.slice(candidate);
  const newerTail = rows.slice(candidate);
  const newerPositiveRatio =
    newerTail.filter((row) => Number(row?.v ?? row?.volume ?? 0) > 0).length /
    Math.max(1, newerTail.length);
  if (tailLength >= 3 && newerPositiveRatio >= 0.66) {
    return newerTail;
  }
  return rows;
}

function runDuckDbWorker(command, payload = {}) {
  const payloadFile = path.join(
    os.tmpdir(),
    `bars-worker-payload-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  fs.writeFileSync(payloadFile, JSON.stringify(payload), "utf8");
  try {
    const result = spawnSync(
      process.execPath,
      [DUCKDB_WORKER_PATH, command, `@file:${payloadFile}`],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    if (result.status !== 0) {
      let message =
        result.stderr || result.stdout || `DuckDB worker failed: ${command}`;
      try {
        const parsed = JSON.parse(result.stderr || "{}");
        message = parsed.error || message;
      } catch {}
      throw new Error(String(message).trim());
    }
    const parsed = JSON.parse(result.stdout || "{}");
    return parsed.result;
  } finally {
    fs.rmSync(payloadFile, { force: true });
  }
}

async function runDuckDbWorkerAsync(command, payload = {}) {
  const payloadFile = path.join(
    os.tmpdir(),
    `bars-worker-payload-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  await fs.promises.writeFile(payloadFile, JSON.stringify(payload), "utf8");
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [DUCKDB_WORKER_PATH, command, `@file:${payloadFile}`],
        {
          cwd: PROJECT_ROOT,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({ code, stdout, stderr });
      });
    });
    if (result.code !== 0) {
      let message =
        result.stderr || result.stdout || `DuckDB worker failed: ${command}`;
      try {
        const parsed = JSON.parse(result.stderr || "{}");
        message = parsed.error || message;
      } catch {}
      throw new Error(String(message).trim());
    }
    const parsed = JSON.parse(result.stdout || "{}");
    return parsed.result;
  } finally {
    await fs.promises.rm(payloadFile, { force: true }).catch(() => {});
  }
}

function parseCsvBarsText(raw = "", tfSeconds = 60, limit = 300, options = {}) {
  const lines = String(raw || "").trim().split(/\r?\n/);
  const dedup = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const cols = String(lines[i] || "").split(",");
    if (cols.length < 5) continue;
    const rawTime = Number(cols[0]);
    const o = Number(cols[1]);
    const h = Number(cols[2]);
    const l = Number(cols[3]);
    const c = Number(cols[4]);
    const v = Number(cols[5]) || 0;
    const normalized = normalizeOhlcRow({
      t: normalizeBarTimeToUTC(rawTime, tfSeconds),
      o,
      h,
      l,
      c,
      v,
    });
    if (!normalized) continue;
    dedup.set(normalized.t, {
      time: normalized.t,
      open: normalized.o,
      high: normalized.h,
      low: normalized.l,
      close: normalized.c,
      volume: normalized.v,
    });
  }
  const rows = uniqueSortedBars([...dedup.values()], "time");
  return sliceRowsForRead(rows, limit, options);
}

function aggregateBarsFromLowerTimeframe(
  rows = [],
  targetTfSeconds = 15 * 60,
  sourceTfSeconds = 5 * 60,
  limit = 300,
  options = {},
) {
  const sorted = Array.isArray(rows)
    ? rows
        .map((row) => ({
          time: Number(row.time),
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: Number(row.volume || 0),
        }))
        .filter(
          (row) =>
            Number.isFinite(row.time) &&
            Number.isFinite(row.open) &&
            Number.isFinite(row.high) &&
            Number.isFinite(row.low) &&
            Number.isFinite(row.close),
        )
        .sort((a, b) => a.time - b.time)
    : [];
  if (!sorted.length) return [];
  if (!targetTfSeconds || !sourceTfSeconds || targetTfSeconds <= sourceTfSeconds) {
    return sliceRowsForRead(sorted, limit);
  }

  const out = [];
  let currentBucket = null;
  let bucketRows = [];
  const flush = () => {
    if (!bucketRows.length || currentBucket === null) return;
    const volume = bucketRows.reduce((sum, row) => sum + Number(row.volume || 0), 0);
    if (
      shouldDropZeroVolumeDerivedBar(
        options.symbol || "",
        options.targetTf || "",
        volume,
      )
    ) {
      return;
    }
    out.push({
      time: currentBucket,
      open: bucketRows[0].open,
      high: Math.max(...bucketRows.map((row) => row.high)),
      low: Math.min(...bucketRows.map((row) => row.low)),
      close: bucketRows[bucketRows.length - 1].close,
      volume,
    });
  };

  for (const row of sorted) {
    const bucket = normalizeBarTimeToUTC(row.time, targetTfSeconds);
    if (currentBucket === null || bucket !== currentBucket) {
      flush();
      currentBucket = bucket;
      bucketRows = [row];
      continue;
    }
    bucketRows.push(row);
  }
  flush();

  const normalized = uniqueSortedBars(out, "time");
  if (!Number.isFinite(Number(limit)) || Number(limit) > 0) {
    return sliceRowsForRead(normalized, limit);
  }
  return normalized;
}

function getBarsPathCandidatesForProvider(symbol, tf, providerName, options = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return [];
  const baseDir = path.join(getMarketDataRoot(options), sym, "bars");
  const aliases = csvTfAliases(tf);
  const normalizedProvider = normalizeBarsStorageProvider(providerName);
  if (normalizedProvider === "postgres") return [];
  const extensionOrder =
    normalizedProvider === "parquet_duckdb"
      ? [".parquet", ".csv"]
      : [".csv", ".parquet"];
  const out = [];
  for (const alias of aliases) {
    for (const ext of extensionOrder) {
      out.push(path.join(baseDir, `${alias}${ext}`));
    }
  }
  return [...new Set(out)];
}

function resolveBarsPathForProvider(symbol, tf, providerName, options = {}) {
  const candidates = getBarsPathCandidatesForProvider(
    symbol,
    tf,
    providerName,
    options,
  );
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const sym = String(symbol || "").trim().toUpperCase();
  const tfKey = normalizeCsvTfKey(tf);
  const ext = getPrimaryBarsExtension(providerName);
  if (!sym || !tfKey || !ext) return "";
  return path.join(getMarketDataRoot(options), sym, "bars", `${tfKey}${ext}`);
}

function readStoredBarsForProvider(providerName, symbol, tf, limit = 300, options = {}) {
  const filePath = resolveBarsPathForProvider(symbol, tf, providerName, options);
  if (!filePath || !fs.existsSync(filePath)) return [];
  return readBarsFile(filePath, tf, limit, options);
}

async function readStoredBarsForProviderAsync(
  providerName,
  symbol,
  tf,
  limit = 300,
  options = {},
) {
  const filePath = resolveBarsPathForProvider(symbol, tf, providerName, options);
  if (!filePath || !fs.existsSync(filePath)) return [];
  return readBarsFileAsync(filePath, tf, limit, options);
}

function createFileBarsProvider(providerName, extension) {
  const shouldTrimOnMerge = providerName !== "parquet_duckdb";
  return {
    name: providerName,
    kind: "file",
    extension,
    shouldTrimOnMerge,
    getPathCandidates(symbol, tf, options = {}) {
      return getBarsPathCandidatesForProvider(symbol, tf, providerName, options);
    },
    resolvePath(symbol, tf, options = {}) {
      return resolveBarsPathForProvider(symbol, tf, providerName, options);
    },
    readBars(symbol, tf, limit = 300, options = {}) {
      const tfKey = normalizeCsvTfKey(tf);
      const stored = readStoredBarsForProvider(
        providerName,
        symbol,
        tfKey,
        limit,
        options,
      );
      if (stored.length) {
        return stored;
      }
      if (tfKey === "15") {
        const sourceRows = readStoredBarsForProvider(
          providerName,
          symbol,
          "5",
          Math.max(5000, (Number(limit) || 300) * 3),
          options,
        );
        const derived = aggregateBarsFromLowerTimeframe(
          sourceRows,
          15 * 60,
          5 * 60,
          limit,
        );
        if (derived.length) return derived;
      }
      return [];
    },
    overwriteBars(symbol, tf, rows = [], options = {}) {
      const tfKey = normalizeCsvTfKey(tf);
      const sym = String(symbol || "").trim().toUpperCase();
      if (!sym || !tfKey) return 0;
      const targetPath = path.join(
        getMarketDataRoot(options),
        sym,
        "bars",
        `${tfKey}${extension}`,
      );
      const tfSeconds = Math.max(60, parseTfTokenToSeconds(tfKey));
      const normalizedRows = uniqueSortedBars(
        (Array.isArray(rows) ? rows : [])
          .map((bar) => toMergeRow(bar, tfSeconds))
          .filter(Boolean),
        "t",
      );
      rewriteBarsFile(targetPath, normalizedRows, {
        ...options,
        provider: providerName,
      });
      return normalizedRows.length;
    },
    mergeBars(symbol, tf, newBars, options = {}) {
      if (!symbol || !tf || !Array.isArray(newBars) || !newBars.length) return 0;
      const tfKey = normalizeCsvTfKey(tf);
      const tfSeconds = Math.max(60, parseTfTokenToSeconds(tfKey));
      const sym = String(symbol || "").trim().toUpperCase();
      if (!sym || !tfKey) return 0;
      const targetPath = path.join(
        getMarketDataRoot(options),
        sym,
        "bars",
        `${tfKey}${extension}`,
      );
      const existingPath = resolveBarsPathForProvider(
        sym,
        tfKey,
        providerName,
        options,
      );
      const existingBars =
        existingPath && fs.existsSync(existingPath)
          ? readBarsFile(
              existingPath,
              tfKey,
              shouldTrimOnMerge ? MAX_BARS_PER_FILE : 0,
              {
                ...options,
                fullFile: !shouldTrimOnMerge,
              },
            )
          : [];
      const merged = mergeBarRows(existingBars, newBars, tfSeconds, {
        provider: providerName,
      });
      if (merged.added === 0) return 0;
      rewriteBarsFile(targetPath, merged.rows, {
        ...options,
        provider: providerName,
      });
      return merged.added;
    },
  };
}

const POSTGRES_BARS_PROVIDER = {
  name: "postgres",
  kind: "database",
  extension: "",
  getPathCandidates() {
    return [];
  },
  resolvePath() {
    return "";
  },
  readBars() {
    throw new Error("Bars provider `postgres` is not implemented yet");
  },
  overwriteBars() {
    throw new Error("Bars provider `postgres` is not implemented yet");
  },
  mergeBars() {
    throw new Error("Bars provider `postgres` is not implemented yet");
  },
};

const BARS_PROVIDERS = Object.freeze({
  csv: createFileBarsProvider("csv", ".csv"),
  parquet_duckdb: createFileBarsProvider("parquet_duckdb", ".parquet"),
  postgres: POSTGRES_BARS_PROVIDER,
});

function getBarsProvider(provider = getBarsStorageProvider()) {
  const normalized = normalizeBarsStorageProvider(provider);
  const resolved = BARS_PROVIDERS[normalized];
  if (!resolved) {
    throw new Error(`Unsupported bars provider: ${provider}`);
  }
  return resolved;
}

function readBarsFile(filePath, tf, limit = 300, options = {}) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  const tfKey = normalizeCsvTfKey(tf);
  const tfSeconds = Math.max(60, parseTfTokenToSeconds(tfKey));
  if (!filePath || !fs.existsSync(filePath)) return [];
  if (ext === ".parquet") {
    const rows = runDuckDbWorker("readParquet", {
      duckdbPath: getDuckDbPath(options),
      parquetPath: filePath,
      limit: normalizeReadLimit(limit, options),
      endTimeSec:
        Number.isFinite(Number(options?.endTimeSec)) && Number(options.endTimeSec) > 0
          ? Number(options.endTimeSec)
          : null,
    });
    const parsed = rows
      .map((row) =>
        normalizeOhlcRow({
          t: normalizeBarTimeToUTC(Number(row.time), tfSeconds),
          o: Number(row.open),
          h: Number(row.high),
          l: Number(row.low),
          c: Number(row.close),
          v: Number(row.volume || 0),
        }),
      )
      .filter(Boolean)
      .map((row) => ({
        time: row.t,
        open: row.o,
        high: row.h,
        low: row.l,
        close: row.c,
        volume: row.v,
    }));
    const normalized = uniqueSortedBars(parsed, "time");
    return sliceRowsForRead(normalized, limit, options);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return parseCsvBarsText(raw, tfSeconds, limit, options);
}

async function readBarsFileAsync(filePath, tf, limit = 300, options = {}) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  const tfKey = normalizeCsvTfKey(tf);
  const tfSeconds = Math.max(60, parseTfTokenToSeconds(tfKey));
  if (!filePath || !fs.existsSync(filePath)) return [];
  if (ext === ".parquet") {
    const rows = await runDuckDbWorkerAsync("readParquet", {
      duckdbPath: getDuckDbPath(options),
      parquetPath: filePath,
      limit: normalizeReadLimit(limit, options),
      endTimeSec:
        Number.isFinite(Number(options?.endTimeSec)) && Number(options.endTimeSec) > 0
          ? Number(options.endTimeSec)
          : null,
    });
    const parsed = rows
      .map((row) =>
        normalizeOhlcRow({
          t: normalizeBarTimeToUTC(Number(row.time), tfSeconds),
          o: Number(row.open),
          h: Number(row.high),
          l: Number(row.low),
          c: Number(row.close),
          v: Number(row.volume || 0),
        }),
      )
      .filter(Boolean)
      .map((row) => ({
        time: row.t,
        open: row.o,
        high: row.h,
        low: row.l,
        close: row.c,
        volume: row.v,
      }));
    const normalized = uniqueSortedBars(parsed, "time");
    return sliceRowsForRead(normalized, limit, options);
  }
  const raw = await fs.promises.readFile(filePath, "utf8");
  return parseCsvBarsText(raw, tfSeconds, limit, options);
}

function getBrokerBarsPathCandidates(symbol, tf, options = {}) {
  return getBarsProvider(getBarsStorageProvider(options)).getPathCandidates(
    symbol,
    tf,
    options,
  );
}

function resolveBrokerBarsFilePath(symbol, tf, options = {}) {
  return getBarsProvider(getBarsStorageProvider(options)).resolvePath(
    symbol,
    tf,
    options,
  );
}

function readBrokerBarsFromFile(symbol, tf, limit = 300, options = {}) {
  return getBarsProvider(getBarsStorageProvider(options)).readBars(
    symbol,
    tf,
    limit,
    options,
  );
}

function getCanonicalSourceTimeframe(tf) {
  const tfKey = normalizeCsvTfKey(tf);
  return CANONICAL_SOURCE_TF[tfKey] || "";
}

function reconcileDerivedBarsWithStored(
  storedBars = [],
  lowerBars = [],
  targetTf = "",
  sourceTf = "",
  options = {},
) {
  const targetTfKey = normalizeCsvTfKey(targetTf);
  const sourceTfKey = normalizeCsvTfKey(sourceTf);
  if (!targetTfKey || !sourceTfKey) return [];
  const derived = aggregateBarsFromLowerTimeframe(
    lowerBars,
    Math.max(60, parseTfTokenToSeconds(targetTfKey)),
    Math.max(60, parseTfTokenToSeconds(sourceTfKey)),
    0,
    {
      symbol: options.symbol || "",
      targetTf: targetTfKey,
    },
  );
  if (!derived.length) return [];
  const derivedStartTime = Number(derived[0]?.time);
  const prefix = Number.isFinite(derivedStartTime)
    ? (Array.isArray(storedBars) ? storedBars : []).filter(
        (bar) => Number(bar?.time) < derivedStartTime,
      )
    : [];
  const cleanedPrefix = prefix.filter(
    (bar) =>
      !shouldDropZeroVolumeDerivedBar(
        options.symbol || "",
        targetTfKey,
        Number(bar?.volume || 0),
      ),
  );
  return uniqueSortedBars([...cleanedPrefix, ...derived], "time");
}

function rebuildBrokerBarsFromCanonicalSource(symbol, tf, options = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  const targetTfKey = normalizeCsvTfKey(tf);
  const sourceTfKey = getCanonicalSourceTimeframe(targetTfKey);
  const provider = getBarsProvider(getBarsStorageProvider(options));
  if (!sym || !targetTfKey || !sourceTfKey) {
    return { rewritten: false, rows: 0, reason: "unsupported_tf" };
  }
  const sourcePath = provider.resolvePath(sym, sourceTfKey, options);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { rewritten: false, rows: 0, reason: "missing_source_file" };
  }
  const sourceBars = readBarsFile(sourcePath, sourceTfKey, 0, {
    ...options,
    fullFile: true,
  });
  if (!sourceBars.length) {
    return { rewritten: false, rows: 0, reason: "empty_source_file" };
  }
  const targetPath = provider.resolvePath(sym, targetTfKey, options);
  const storedBars =
    targetPath && fs.existsSync(targetPath)
      ? readBarsFile(targetPath, targetTfKey, 0, {
          ...options,
          fullFile: true,
        })
      : [];
  const reconciled = reconcileDerivedBarsWithStored(
    storedBars,
    sourceBars,
    targetTfKey,
    sourceTfKey,
    { symbol: sym },
  );
  if (!reconciled.length) {
    return { rewritten: false, rows: 0, reason: "empty_reconciled_series" };
  }
  const before = JSON.stringify(storedBars);
  const after = JSON.stringify(reconciled);
  if (before === after) {
    return { rewritten: false, rows: reconciled.length, reason: "unchanged" };
  }
  const rows = provider.overwriteBars(sym, targetTfKey, reconciled, options);
  return { rewritten: true, rows, reason: "reconciled_from_canonical_source" };
}

function rebuildBrokerTimeframeChain(symbol, startTf = "1", options = {}) {
  const startTfKey = normalizeCsvTfKey(startTf);
  const chain = ["5", "15", "60", "240", "1440"];
  let startIndex = 0;
  if (startTfKey && startTfKey !== "1") {
    startIndex = Math.max(0, chain.indexOf(startTfKey));
  }
  const out = {};
  for (const tfKey of chain.slice(startIndex)) {
    out[tfKey] = rebuildBrokerBarsFromCanonicalSource(symbol, tfKey, options);
  }
  return out;
}

function normalizeInputBars(newBars = [], tfSeconds = 60) {
  const out = [];
  for (const bar of Array.isArray(newBars) ? newBars : []) {
    const rawTime = Number(bar.t ?? bar.time);
    const o = Number(bar.o ?? bar.open);
    const h = Number(bar.h ?? bar.high);
    const l = Number(bar.l ?? bar.low);
    const c = Number(bar.c ?? bar.close);
    const v = Number(bar.v ?? bar.volume ?? 0);
    const t = normalizeBarTimeToUTC(rawTime, tfSeconds);
    const normalized = normalizeOhlcRow({
      t,
      o,
      h,
      l,
      c,
      v,
    });
    if (!normalized) continue;
    out.push(normalized);
  }
  return out;
}

function toMergeRow(bar = {}, tfSeconds = 60) {
  return normalizeOhlcRow({
    t: normalizeBarTimeToUTC(Number(bar.time), tfSeconds),
    o: Number(bar.open),
    h: Number(bar.high),
    l: Number(bar.low),
    c: Number(bar.close),
    v: Number(bar.volume || 0),
  });
}

function mergeBarRows(existingBars = [], incomingBars = [], tfSeconds = 60, options = {}) {
  const existing = new Map();
  for (const bar of Array.isArray(existingBars) ? existingBars : []) {
    const row = toMergeRow(bar, tfSeconds);
    if (row) existing.set(row.t, row);
  }
  let added = 0;
  for (const row of normalizeInputBars(incomingBars, tfSeconds)) {
    const current = existing.get(row.t);
    if (current) {
      const currentVol = Number(current.v || 0);
      const nextVol = Number(row.v || 0);
      const keepCurrent =
        currentVol > 0 &&
        nextVol <= 0 &&
        Number.isFinite(current.o) &&
        Number.isFinite(current.h) &&
        Number.isFinite(current.l) &&
        Number.isFinite(current.c);
      if (keepCurrent) continue;
    }
    existing.set(row.t, row);
    added++;
  }
  const sorted = uniqueSortedBars(
    dropDisconnectedSyntheticPrefix(
    repairSuspiciousFrozenOpenSequences(
      dropIsolatedZeroVolumeBridgeSpikes(
        sanitizeShiftedZeroVolumeDuplicates(
          Array.from(existing.values()),
          tfSeconds,
        ),
        tfSeconds,
      ),
      tfSeconds,
    ),
    tfSeconds,
    ),
    "t",
  );
  const shouldTrimCsv = options.provider !== "parquet_duckdb";
  const trimmed =
    shouldTrimCsv && sorted.length > MAX_BARS_PER_FILE
      ? sorted.slice(-MAX_BARS_PER_FILE)
      : sorted;
  return { added, rows: trimmed };
}

function rewriteBarsFile(filePath, rows = [], options = {}) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".parquet") {
    writeParquetBars(filePath, rows, options);
    return;
  }
  writeCsvBars(filePath, rows);
}

async function rewriteBarsFileAsync(filePath, rows = [], options = {}) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".parquet") {
    await writeParquetBarsAsync(filePath, rows, options);
    return;
  }
  await writeCsvBarsAsync(filePath, rows);
}

function repairBarsFile(filePath, tf, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) return { repaired: false, rows: 0 };
  const tfKey = normalizeCsvTfKey(tf || path.basename(filePath, path.extname(filePath)));
  const tfSeconds = Math.max(60, parseTfTokenToSeconds(tfKey));
  const original = readBarsFile(filePath, tfKey, 0, {
    ...options,
    fullFile: true,
  });
  if (!original.length) return { repaired: false, rows: 0 };
  const mergedRows = uniqueSortedBars(
    original
    .map((bar) => toMergeRow(bar, tfSeconds))
    .filter(Boolean),
    "t",
  );
  const repairedRows = uniqueSortedBars(dropDisconnectedSyntheticPrefix(
    repairSuspiciousFrozenOpenSequences(
      dropIsolatedZeroVolumeBridgeSpikes(mergedRows, tfSeconds),
      tfSeconds,
    ),
    tfSeconds,
  ), "t");
  const changed = JSON.stringify(mergedRows) !== JSON.stringify(repairedRows);
  if (!changed) return { repaired: false, rows: repairedRows.length };
  rewriteBarsFile(filePath, repairedRows, options);
  return { repaired: true, rows: repairedRows.length };
}

function repairBarsTree(rootDir, options = {}) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return { scanned_files: 0, repaired_files: 0 };
  }
  let scannedFiles = 0;
  let repairedFiles = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(csv|parquet)$/i.test(entry.name)) continue;
      scannedFiles += 1;
      const tf = path.basename(entry.name, path.extname(entry.name));
      const result = repairBarsFile(full, tf, options);
      if (result.repaired) repairedFiles += 1;
    }
  };
  walk(rootDir);
  return { scanned_files: scannedFiles, repaired_files: repairedFiles };
}

function writeCsvBars(filePath, rows = []) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const csv =
    "time,open,high,low,close,volume\n" +
    rows.map((row) => `${row.t},${row.o},${row.h},${row.l},${row.c},${row.v}`).join("\n") +
    "\n";
  fs.writeFileSync(filePath, csv);
}

async function writeCsvBarsAsync(filePath, rows = []) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) await fs.promises.mkdir(dir, { recursive: true });
  const csv =
    "time,open,high,low,close,volume\n" +
    rows.map((row) => `${row.t},${row.o},${row.h},${row.l},${row.c},${row.v}`).join("\n") +
    "\n";
  await fs.promises.writeFile(filePath, csv);
}

function writeParquetBars(filePath, rows = [], options = {}) {
  const payload = {
    duckdbPath: getDuckDbPath(options),
    parquetPath: filePath,
    rows: rows.map((row) => ({
      time: row.t,
      open: row.o,
      high: row.h,
      low: row.l,
      close: row.c,
      volume: row.v,
    })),
  };
  return runDuckDbWorker("writeParquet", payload);
}

async function writeParquetBarsAsync(filePath, rows = [], options = {}) {
  const payload = {
    duckdbPath: getDuckDbPath(options),
    parquetPath: filePath,
    rows: rows.map((row) => ({
      time: row.t,
      open: row.o,
      high: row.h,
      low: row.l,
      close: row.c,
      volume: row.v,
    })),
  };
  return runDuckDbWorkerAsync("writeParquet", payload);
}

function overwriteBrokerBarsFile(symbol, tf, rows = [], options = {}) {
  return getBarsProvider(getBarsStorageProvider(options)).overwriteBars(
    symbol,
    tf,
    rows,
    options,
  );
}

function mergeBrokerBarsIntoFile(symbol, tf, newBars, options = {}) {
  return getBarsProvider(getBarsStorageProvider(options)).mergeBars(
    symbol,
    tf,
    newBars,
    options,
  );
}

function resolveBarsPath(symbol, tf, options = {}) {
  return getBarsProvider(getBarsStorageProvider(options)).resolvePath(
    symbol,
    tf,
    options,
  );
}

function readBars(symbol, tf, limit = 300, options = {}) {
  return getBarsProvider(getBarsStorageProvider(options)).readBars(
    symbol,
    tf,
    limit,
    options,
  );
}

function mergeBars(symbol, tf, rows = [], options = {}) {
  return getBarsProvider(getBarsStorageProvider(options)).mergeBars(
    symbol,
    tf,
    rows,
    options,
  );
}

function overwriteBars(symbol, tf, rows = [], options = {}) {
  return getBarsProvider(getBarsStorageProvider(options)).overwriteBars(
    symbol,
    tf,
    rows,
    options,
  );
}

function createBarsRepository(baseOptions = {}) {
  const withOptions = (options = {}) => ({ ...baseOptions, ...options });
  return {
    getProvider() {
      return getBarsProvider(getBarsStorageProvider(baseOptions));
    },
    getProviderName() {
      return getBarsStorageProvider(baseOptions);
    },
    getPrimaryExtension() {
      return getPrimaryBarsExtension(getBarsStorageProvider(baseOptions));
    },
    resolveBarsPath(symbol, tf, options = {}) {
      return resolveBarsPath(symbol, tf, withOptions(options));
    },
    readBars(symbol, tf, limit = 300, options = {}) {
      return readBars(symbol, tf, limit, withOptions(options));
    },
    mergeBars(symbol, tf, rows = [], options = {}) {
      return mergeBars(symbol, tf, rows, withOptions(options));
    },
    overwriteBars(symbol, tf, rows = [], options = {}) {
      return overwriteBars(symbol, tf, rows, withOptions(options));
    },
    rebuildFromCanonicalSource(symbol, tf, options = {}) {
      return rebuildBrokerBarsFromCanonicalSource(symbol, tf, withOptions(options));
    },
    rebuildTimeframeChain(symbol, tf = "1", options = {}) {
      return rebuildBrokerTimeframeChain(symbol, tf, withOptions(options));
    },
    repairBarsFile(filePath, tf, options = {}) {
      return repairBarsFile(filePath, tf, withOptions(options));
    },
    repairBarsTree(rootDir, options = {}) {
      return repairBarsTree(rootDir, withOptions(options));
    },
  };
}

async function migrateAllCsvBarsToParquet(options = {}) {
  const marketDataRoot = getMarketDataRoot(options);
  if (!fs.existsSync(marketDataRoot)) {
    return { scanned_files: 0, converted_files: 0 };
  }
  let scannedFiles = 0;
  let convertedFiles = 0;
  for (const symbol of fs.readdirSync(marketDataRoot)) {
    const barsDir = path.join(marketDataRoot, symbol, "bars");
    if (!fs.existsSync(barsDir)) continue;
    for (const entry of fs.readdirSync(barsDir)) {
      if (!/\.csv$/i.test(entry)) continue;
      scannedFiles++;
      const tfKey = normalizeCsvTfKey(path.basename(entry, ".csv"));
      const csvPath = path.join(barsDir, entry);
      const parquetPath = path.join(barsDir, `${tfKey}.parquet`);
      const bars = readBarsFile(csvPath, tfKey, 0, {
        ...options,
        fullFile: true,
      });
      if (!bars.length) continue;
      const rows = bars.map((bar) => toMergeRow(bar, Math.max(60, parseTfTokenToSeconds(tfKey))));
      writeParquetBars(
        parquetPath,
        rows.filter(Boolean),
        options,
      );
      convertedFiles++;
    }
  }
  return { scanned_files: scannedFiles, converted_files: convertedFiles };
}

module.exports = {
  CANONICAL_SOURCE_TF,
  DEFAULT_BARS_STORAGE_PROVIDER,
  MAX_BARS_PER_FILE,
  MAX_READ_BARS_LIMIT,
  aggregateBarsFromLowerTimeframe,
  csvTfAliases,
  dropDisconnectedSyntheticPrefix,
  dropIsolatedZeroVolumeBridgeSpikes,
  getBarsPathCandidatesForProvider,
  getBarsStorageProvider,
  getDataRoot,
  getDuckDbPath,
  getMarketDataRoot,
  getPrimaryBarsExtension,
  getCanonicalSourceTimeframe,
  mergeBarRows,
  normalizeBarTimeToUTC,
  normalizeBarsStorageProvider,
  normalizeCsvTfKey,
  normalizeInputBars,
  normalizeOhlcRow,
  normalizeReadLimit,
  parseCsvBarsText,
  parseTfTokenToSeconds,
  readBarsFile,
  readBarsFileAsync,
  readStoredBarsForProvider,
  readStoredBarsForProviderAsync,
  repairBarsFile,
  repairBarsTree,
  repairSuspiciousFrozenOpenSequences,
  reconcileDerivedBarsWithStored,
  resolveBarsPath,
  resolveBrokerBarsFilePath,
  resolveBarsPathForProvider,
  rewriteBarsFile,
  rewriteBarsFileAsync,
  runDuckDbWorker,
  runDuckDbWorkerAsync,
  sanitizeShiftedZeroVolumeDuplicates,
  sliceRowsForRead,
  toMergeRow,
  uniqueSortedBars,
  writeCsvBars,
  writeCsvBarsAsync,
  writeParquetBars,
  writeParquetBarsAsync,
};
