"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const marketDataRepo = require("./marketDataRepo");
const { buildChartTopic, normalizeTimeframe } = require("../realtime/realtimeCore");
const { loadChartSnapshot } = require("../realtime/chartStreamService");
const { emitRealtimeTopic } = require("../realtime/realtimeTopicHub");

const ENCRYPTION_ALGO = "aes-256-gcm";
const ENCRYPTION_KEY_SECRET =
  process.env.ENCRYPTION_KEY || "a_very_secret_32_byte_key_placeholder_123";
const DEFAULT_INTERVAL_MS = 60 * 1000;
const DEFAULT_BATCH_SIZE = 8;
const DEFAULT_BATCH_OUTPUTSIZE = 4;
const DEFAULT_BATCH_PAUSE_MS = 350;
const DEFAULT_OFFSET_MS = 3500;
const TF_CHAIN = ["1", "5", "15", "60", "240", "1440"];
const REALTIME_TF_BY_STORAGE = {
  "1": "1m",
  "5": "5m",
  "15": "15m",
  "60": "1h",
  "240": "4h",
  "1440": "d",
};
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
const TWELVE_SYMBOL_MAP = {
  DE40: "GER40",
  GER40: "GER40",
  DAX: "DAX",
  NAS100: "NDX",
  US100: "NDX",
  SPX500: "SPX",
  US500: "SPX",
  US30: "DJI",
  UK100: "UK100",
  XAUUSD: "XAU/USD",
  XAUEUR: "XAU/EUR",
  XAUGBP: "XAU/GBP",
  XAUJPY: "XAU/JPY",
  XAGUSD: "XAG/USD",
  XTIUSD: "WTI/USD",
  BRENT: "BRENT/USD",
  USOIL: "WTI/USD",
  UKOIL: "BRENT/USD",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEncryptionKey() {
  return crypto.createHash("sha256").update(ENCRYPTION_KEY_SECRET).digest();
}

function decryptData(cipherText) {
  if (!cipherText) return "";
  const parts = String(cipherText).split(":");
  if (parts.length !== 3) return String(cipherText);
  try {
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGO,
      getEncryptionKey(),
      iv,
    );
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return String(cipherText);
  }
}

function normalizeSymbol(rawSymbol = "") {
  return String(rawSymbol || "").trim().toUpperCase();
}

function normalizeSymbolForTwelve(rawSymbol = "") {
  const base = normalizeSymbol(rawSymbol);
  if (!base) return "";
  const noProvider = base.includes(":")
    ? base.split(":").slice(1).join(":")
    : base;
  const compact = noProvider.replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";
  if (TWELVE_SYMBOL_MAP[compact]) return TWELVE_SYMBOL_MAP[compact];
  if (/^[A-Z]{6}$/.test(compact)) {
    return `${compact.slice(0, 3)}/${compact.slice(3)}`;
  }
  if (/^[A-Z]{3,5}USD$/.test(compact)) {
    return `${compact.slice(0, -3)}/USD`;
  }
  return compact;
}

function compactProviderSymbol(raw = "") {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function isCryptoLikeSymbol(symbol = "") {
  const sym = normalizeSymbol(symbol);
  if (!sym) return false;
  if (sym.endsWith("USDT")) return true;
  const compact = sym.replace(/[^A-Z0-9]/g, "");
  if (compact.length < 6) return false;
  const base = compact.slice(0, 3);
  return CRYPTO_BASES.has(base);
}

function isForexOrCfdSymbol(symbol = "") {
  const sym = normalizeSymbol(symbol);
  if (!sym || isCryptoLikeSymbol(sym)) return false;
  if (CFD_SYMBOLS.has(sym)) return true;
  return /^[A-Z]{6}$/.test(sym);
}

function parseTimeToUnixSec(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  let ms = Date.parse(text);
  if (!Number.isFinite(ms)) ms = Date.parse(text.replace(" ", "T") + "Z");
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

function barsEqual(left, right) {
  return (
    Number(left?.time) === Number(right?.time) &&
    Number(left?.open) === Number(right?.open) &&
    Number(left?.high) === Number(right?.high) &&
    Number(left?.low) === Number(right?.low) &&
    Number(left?.close) === Number(right?.close) &&
    Number(left?.volume || 0) === Number(right?.volume || 0)
  );
}

function buildEnvelope(topic, type, data, extra = {}) {
  return {
    topic: String(topic || "").trim(),
    type: String(type || "message").trim(),
    ts: Date.now(),
    version: Number(extra.version) || Date.now(),
    transport: "sse",
    ...extra,
    data,
  };
}

function findProviderFile(dataRoot) {
  return path.join(
    String(dataRoot || path.join(process.cwd(), "data")),
    "users",
    "default",
    "providers",
    "TWELVE_DATA",
    "data.json",
  );
}

function loadTwelveApiKey({ dataRoot } = {}) {
  const envKey = String(process.env.TWELVE_DATA_API_KEY || "").trim();
  if (envKey) return envKey;
  const providerFile = findProviderFile(dataRoot);
  if (!fs.existsSync(providerFile)) return "";
  try {
    const parsed = JSON.parse(fs.readFileSync(providerFile, "utf8") || "{}");
    const data = parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
    return String(
      decryptData(
        data.api_key ||
          data.value ||
          parsed.api_key ||
          parsed.value ||
          parsed.key ||
          "",
      ),
    ).trim();
  } catch {
    return "";
  }
}

function listConfiguredSymbols(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => normalizeSymbol(item))
    .filter(Boolean);
}

function listMarketDataSymbols(dataRoot) {
  const marketDataRoot = path.join(String(dataRoot || ""), "market_data");
  if (!marketDataRoot || !fs.existsSync(marketDataRoot)) return [];
  return fs
    .readdirSync(marketDataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => normalizeSymbol(entry.name))
    .filter(Boolean);
}

function parseBatchTimeSeriesResponse(parsed = {}) {
  const items = [];
  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray(parsed.values) &&
    (parsed.meta?.symbol || parsed.symbol)
  ) {
    items.push({
      providerSymbol: String(parsed.meta?.symbol || parsed.symbol || "").trim(),
      values: parsed.values,
      meta: parsed.meta || null,
      status: String(parsed.status || "ok").trim().toLowerCase(),
      message: String(parsed.message || "").trim(),
    });
    return items;
  }
  if (Array.isArray(parsed?.data)) {
    for (const row of parsed.data) {
      if (!row || typeof row !== "object") continue;
      items.push({
        providerSymbol: String(row.meta?.symbol || row.symbol || row.name || "").trim(),
        values: Array.isArray(row.values) ? row.values : [],
        meta: row.meta || null,
        status: String(row.status || "ok").trim().toLowerCase(),
        message: String(row.message || "").trim(),
      });
    }
    return items;
  }
  for (const [key, value] of Object.entries(parsed || {})) {
    if (!value || typeof value !== "object") continue;
    if (!Array.isArray(value.values) && !Array.isArray(value.data)) continue;
    items.push({
      providerSymbol: String(value.meta?.symbol || value.symbol || key || "").trim(),
      values: Array.isArray(value.values) ? value.values : [],
      meta: value.meta || null,
      status: String(value.status || "ok").trim().toLowerCase(),
      message: String(value.message || "").trim(),
    });
  }
  return items;
}

function normalizeProviderBars(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      const time = parseTimeToUnixSec(value?.datetime);
      const open = Number(value?.open);
      const high = Number(value?.high);
      const low = Number(value?.low);
      const close = Number(value?.close);
      const volume = Number(value?.volume);
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
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

async function fetchTwelveBatchBars(symbols = [], { apiKey, outputsize } = {}) {
  const requestedSymbols = [...new Set((symbols || []).map(normalizeSymbol).filter(Boolean))];
  if (!requestedSymbols.length) return new Map();
  const symbolMap = new Map(
    requestedSymbols.map((symbol) => [compactProviderSymbol(normalizeSymbolForTwelve(symbol)), symbol]),
  );
  const providerSymbols = requestedSymbols.map((symbol) => normalizeSymbolForTwelve(symbol));
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", providerSymbols.join(","));
  url.searchParams.set("interval", "1min");
  url.searchParams.set(
    "outputsize",
    String(Math.max(2, Math.min(Number(outputsize) || DEFAULT_BATCH_OUTPUTSIZE, 30))),
  );
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("order", "ASC");
  url.searchParams.set("apikey", String(apiKey || "").trim());
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let parsed = {};
  try {
    const res = await fetch(String(url), { signal: ctrl.signal });
    const text = await res.text();
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    if (!res.ok) {
      throw new Error(`Twelve HTTP ${res.status}: ${text.slice(0, 160)}`);
    }
    if (String(parsed?.status || "").trim().toLowerCase() === "error") {
      throw new Error(String(parsed?.message || "Twelve provider error"));
    }
  } finally {
    clearTimeout(timer);
  }

  const results = new Map();
  for (const item of parseBatchTimeSeriesResponse(parsed)) {
    const providerKey = compactProviderSymbol(item.providerSymbol);
    const localSymbol = symbolMap.get(providerKey);
    if (!localSymbol) continue;
    const bars = normalizeProviderBars(item.values);
    if (!bars.length) continue;
    results.set(localSymbol, {
      symbol: localSymbol,
      providerSymbol: item.providerSymbol,
      bars,
      status: item.status,
      message: item.message,
    });
  }
  return results;
}

function readLatestBar(symbol, tf, options = {}) {
  const rows = marketDataRepo.readBrokerBarsFromFile(symbol, tf, 2, options);
  return Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null;
}

function captureLatestBarsByTf(symbol, options = {}) {
  const out = {};
  for (const tf of TF_CHAIN) {
    out[tf] = readLatestBar(symbol, tf, options);
  }
  return out;
}

function publishChangedChartBars(symbol, beforeBars = {}, afterBars = {}, options = {}) {
  const dataRoot = options.dataRoot;
  const duckdbPath = options.duckdbPath;
  const publishRealtimeTopic =
    typeof options.publishRealtimeTopic === "function"
      ? options.publishRealtimeTopic
      : emitRealtimeTopic;
  for (const tf of TF_CHAIN) {
    const previous = beforeBars?.[tf] || null;
    const next = afterBars?.[tf] || null;
    if (!next || barsEqual(previous, next)) continue;
    const realtimeTf = REALTIME_TF_BY_STORAGE[tf];
    if (!realtimeTf) continue;
    const snapshot = loadChartSnapshot({
      symbol,
      timeframe: realtimeTf,
      bars: 2,
      dataRoot,
      duckdbPath,
    });
    const lastBar = Array.isArray(snapshot?.bars) ? snapshot.bars[snapshot.bars.length - 1] : null;
    if (!lastBar) continue;
    const topic = buildChartTopic(symbol);
    const payload = {
      symbol: snapshot.symbol,
      timeframe: normalizeTimeframe(realtimeTf),
      bar: lastBar,
      metadata: snapshot.metadata,
    };
    publishRealtimeTopic(topic, buildEnvelope(topic, "bar_update", payload));
    publishRealtimeTopic(
      buildChartTopic("*"),
      buildEnvelope(buildChartTopic("*"), "bar_update", payload),
    );
  }
}

class ForexLiveIngestorService {
  constructor(options = {}) {
    this.dataRoot = String(options.dataRoot || path.join(process.cwd(), "data"));
    this.duckdbPath =
      String(options.duckdbPath || process.env.BARS_DUCKDB_PATH || "").trim() ||
      path.join(this.dataRoot, "bars.duckdb");
    this.intervalMs = Math.max(
      10000,
      Number(options.intervalMs || process.env.FOREX_INGESTOR_INTERVAL_MS) || DEFAULT_INTERVAL_MS,
    );
    this.offsetMs = Math.max(
      0,
      Number(options.offsetMs || process.env.FOREX_INGESTOR_OFFSET_MS) || DEFAULT_OFFSET_MS,
    );
    this.batchSize = Math.max(
      1,
      Number(options.batchSize || process.env.FOREX_INGESTOR_BATCH_SIZE) || DEFAULT_BATCH_SIZE,
    );
    this.batchPauseMs = Math.max(
      0,
      Number(options.batchPauseMs || process.env.FOREX_INGESTOR_BATCH_PAUSE_MS) || DEFAULT_BATCH_PAUSE_MS,
    );
    this.outputsize = Math.max(
      2,
      Number(options.outputsize || process.env.FOREX_INGESTOR_OUTPUTSIZE) || DEFAULT_BATCH_OUTPUTSIZE,
    );
    this.logger = typeof options.logger === "function" ? options.logger : console.log;
    this.enabled = Boolean(options.enabled ?? String(process.env.FOREX_INGESTOR_ENABLED || "") === "1");
    this.publishRealtimeTopic =
      typeof options.publishRealtimeTopic === "function"
        ? options.publishRealtimeTopic
        : emitRealtimeTopic;
    this.timer = null;
    this.running = false;
    this.stopped = true;
    this.lastRun = null;
    this.lastSummary = null;
  }

  getSymbols() {
    const configured = listConfiguredSymbols(process.env.FOREX_INGESTOR_SYMBOLS);
    const discovered = configured.length ? configured : listMarketDataSymbols(this.dataRoot);
    return [...new Set(discovered.filter(isForexOrCfdSymbol))].sort();
  }

  getStatus() {
    return {
      enabled: this.enabled,
      running: this.running,
      lastRun: this.lastRun,
      lastSummary: this.lastSummary,
      intervalMs: this.intervalMs,
      batchSize: this.batchSize,
      symbols: this.getSymbols(),
    };
  }

  start() {
    if (!this.enabled || !this.stopped) return false;
    this.stopped = false;
    this.#scheduleNext();
    this.logger(
      `[forex-ingestor] enabled interval_ms=${this.intervalMs} batch_size=${this.batchSize}`,
    );
    return true;
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async runOnce() {
    if (this.running) {
      return { ok: false, skipped: true, reason: "already_running" };
    }
    this.running = true;
    const startedAt = new Date().toISOString();
    const summary = {
      ok: true,
      startedAt,
      finishedAt: null,
      symbols: 0,
      updatedSymbols: 0,
      batches: 0,
      errors: [],
    };
    try {
      const apiKey = loadTwelveApiKey({ dataRoot: this.dataRoot });
      if (!apiKey) {
        summary.ok = false;
        summary.errors.push("TWELVE_DATA_API_KEY missing");
        return summary;
      }
      const symbols = this.getSymbols();
      summary.symbols = symbols.length;
      if (!symbols.length) {
        return summary;
      }
      for (let index = 0; index < symbols.length; index += this.batchSize) {
        const batch = symbols.slice(index, index + this.batchSize);
        summary.batches += 1;
        let fetched = new Map();
        try {
          fetched = await fetchTwelveBatchBars(batch, {
            apiKey,
            outputsize: this.outputsize,
          });
        } catch (error) {
          summary.ok = false;
          summary.errors.push(
            `batch ${summary.batches}: ${error instanceof Error ? error.message : String(error)}`,
          );
          if (this.batchPauseMs > 0) await sleep(this.batchPauseMs);
          continue;
        }
        for (const symbol of batch) {
          const hit = fetched.get(symbol);
          if (!hit?.bars?.length) continue;
          const ioOptions = {
            dataRoot: this.dataRoot,
            duckdbPath: this.duckdbPath,
            publishRealtimeTopic: this.publishRealtimeTopic,
          };
          const beforeBars = captureLatestBarsByTf(symbol, ioOptions);
          marketDataRepo.mergeBrokerBarsIntoFile(symbol, "1", hit.bars, ioOptions);
          marketDataRepo.rebuildTimeframeChain(symbol, "1", ioOptions);
          const afterBars = captureLatestBarsByTf(symbol, ioOptions);
          const changed = TF_CHAIN.some((tf) => !barsEqual(beforeBars[tf], afterBars[tf]));
          if (!changed) continue;
          summary.updatedSymbols += 1;
          publishChangedChartBars(symbol, beforeBars, afterBars, ioOptions);
        }
        if (this.batchPauseMs > 0 && index + this.batchSize < symbols.length) {
          await sleep(this.batchPauseMs);
        }
      }
      return summary;
    } finally {
      summary.finishedAt = new Date().toISOString();
      this.lastRun = summary.finishedAt;
      this.lastSummary = summary;
      this.running = false;
    }
  }

  #scheduleNext() {
    if (this.stopped) return;
    const now = Date.now();
    const bucketMs = Math.max(10000, this.intervalMs);
    const nextAt = Math.ceil(now / bucketMs) * bucketMs + this.offsetMs;
    const delayMs = Math.max(250, nextAt - now);
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.runOnce();
      } catch (error) {
        this.lastSummary = {
          ok: false,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          errors: [error instanceof Error ? error.message : String(error)],
        };
      } finally {
        this.#scheduleNext();
      }
    }, delayMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }
}

module.exports = {
  ForexLiveIngestorService,
  fetchTwelveBatchBars,
  isForexOrCfdSymbol,
  loadTwelveApiKey,
};
