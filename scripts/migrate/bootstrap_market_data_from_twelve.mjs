import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const barsStorage = require("../../src/api/services/barsStorage");

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const DATA_ROOT = process.env.DATA_ROOT || path.join(PROJECT_ROOT, "data");
const MARKET_DATA_ROOT = path.join(DATA_ROOT, "market_data");
const DUCKDB_PATH =
  process.env.BARS_DUCKDB_PATH || path.join(DATA_ROOT, "bars.duckdb");
const PROVIDER_FILE = path.join(
  DATA_ROOT,
  "users",
  "default",
  "providers",
  "TWELVE_DATA",
  "data.json",
);
const TF_CONFIG = [
  { tfKey: "1", interval: "1min", targetBars: 5000 },
  { tfKey: "5", interval: "5min", targetBars: 5000 },
  { tfKey: "15", interval: "15min", targetBars: 5000 },
  { tfKey: "60", interval: "1h", targetBars: 5000 },
  { tfKey: "240", interval: "4h", targetBars: 5000 },
  { tfKey: "1440", interval: "1day", targetBars: 5000 },
];
const YAHOO_USER_AGENT =
  process.env.YAHOO_USER_AGENT || "Mozilla/5.0";
const ENCRYPTION_ALGO = "aes-256-gcm";
const ENCRYPTION_KEY_SECRET =
  process.env.ENCRYPTION_KEY || "a_very_secret_32_byte_key_placeholder_123";

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

function parseTimeToUnixSec(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  let ms = Date.parse(text);
  if (!Number.isFinite(ms)) ms = Date.parse(text.replace(" ", "T") + "Z");
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

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
  BTCUSD: "BTC/USD",
  ETHUSD: "ETH/USD",
};

const YAHOO_SYMBOL_MAP = {
  DE40: "^GDAXI",
  NAS100: "^NDX",
  SPX500: "^GSPC",
  UK100: "^FTSE",
  US30: "^DJI",
  MATICUSD: "MATIC-USD",
  XRPUSD: "XRP-USD",
  XAGUSD: "SI=F",
  XTIUSD: "CL=F",
};

const BINANCE_SYMBOL_MAP = {
  XRPUSD: "XRPUSDT",
  MATICUSD: "MATICUSDT",
};

const DERIVED_SYMBOL_MAP = {
  XAUEUR: { left: "XAUUSD", right: "EURUSD", op: "divide" },
  XAUGBP: { left: "XAUUSD", right: "GBPUSD", op: "divide" },
  XAUJPY: { left: "XAUUSD", right: "USDJPY", op: "multiply" },
};

function normalizeSymbolForTwelve(rawSymbol) {
  const base = String(rawSymbol || "").trim().toUpperCase();
  if (!base) return "";
  const noProvider = base.includes(":")
    ? base.split(":").slice(1).join(":")
    : base;
  const compact = noProvider.replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";
  if (TWELVE_SYMBOL_MAP[compact]) return TWELVE_SYMBOL_MAP[compact];
  if (compact.endsWith("USDT") && compact.length > 4) {
    return `${compact.slice(0, -4)}/USD`;
  }
  if (/^[A-Z]{6}$/.test(compact)) {
    return `${compact.slice(0, 3)}/${compact.slice(3)}`;
  }
  if (/^[A-Z]{3,5}USD$/.test(compact)) {
    return `${compact.slice(0, -3)}/USD`;
  }
  return compact;
}

async function resolveTwelveSymbol(rawSymbol, apiKey) {
  const base = String(rawSymbol || "").trim().toUpperCase();
  if (!base) return [];
  const noProvider = base.includes(":")
    ? base.split(":").slice(1).join(":").trim().toUpperCase()
    : base;
  const compact = noProvider.replace(/[^A-Z0-9]/g, "");
  const normalized = normalizeSymbolForTwelve(noProvider);
  const candidates = [];
  const add = (value) => {
    const symbol = String(value || "").trim().toUpperCase();
    if (symbol && !candidates.includes(symbol)) candidates.push(symbol);
  };
  add(normalized);
  add(compact);
  if (/^[A-Z]{6}$/.test(compact)) add(`${compact.slice(0, 3)}/${compact.slice(3)}`);
  if (/^[A-Z]{3,5}USD$/.test(compact)) add(`${compact.slice(0, -3)}/USD`);
  if (String(process.env.BOOTSTRAP_ENABLE_SYMBOL_SEARCH || "") === "1") {
    try {
      const url = new URL("https://api.twelvedata.com/symbol_search");
      url.searchParams.set("symbol", noProvider);
      url.searchParams.set("apikey", apiKey);
      const res = await fetch(String(url));
      const data = await res.json().catch(() => ({}));
      const rows = Array.isArray(data?.data) ? data.data : [];
      for (const row of rows) {
        add(row?.symbol);
        if (row?.symbol && row?.exchange) add(`${row.symbol}:${row.exchange}`);
      }
    } catch {}
  }
  return candidates;
}

function formatUnixSecForProvider(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  return new Date(sec * 1000).toISOString().replace(".000Z", "");
}

function isMinuteCreditLimitError(message = "") {
  const text = String(message || "").toLowerCase();
  return text.includes("current minute") || text.includes("api credits");
}

async function waitForNextMinuteWindow() {
  const now = Date.now();
  const nextMinute = Math.ceil(now / 60000) * 60000;
  const waitMs = Math.max(5000, nextMinute - now + 3000);
  console.log(`[bootstrap] twelve throttled, waiting ${Math.ceil(waitMs / 1000)}s`);
  await sleep(waitMs);
}

async function fetchTwelveBarsPaged(symbol, interval, barsNeeded, apiKey) {
  const target = Math.max(50, Math.min(Number(barsNeeded) || 1000, 15000));
  const candidates = await resolveTwelveSymbol(symbol, apiKey);
  const dedup = new Map();
  let usedSymbol = symbol;
  let lastError = "";
  let endDate = "";
  let throttleRetries = 0;
  while (dedup.size < target) {
    const outputsize = Math.max(1, Math.min(5000, target - dedup.size));
    let pageBars = [];
    let sawThrottle = false;
    for (const candidate of candidates) {
      const url = new URL("https://api.twelvedata.com/time_series");
      url.searchParams.set("symbol", candidate);
      url.searchParams.set("interval", interval);
      url.searchParams.set("outputsize", String(outputsize));
      url.searchParams.set("timezone", "UTC");
      url.searchParams.set("order", "ASC");
      url.searchParams.set("apikey", apiKey);
      if (endDate) url.searchParams.set("end_date", endDate);
      const res = await fetch(String(url));
      const text = await res.text();
      let parsed = {};
      try {
        parsed = JSON.parse(text);
      } catch {}
      if (!res.ok) {
        lastError = `http_${res.status}: ${text.slice(0, 120)}`;
        if (res.status === 429 || isMinuteCreditLimitError(text)) {
          sawThrottle = true;
        }
        continue;
      }
      if (String(parsed?.status || "").toLowerCase() === "error") {
        lastError = String(parsed?.message || "provider error");
        if (isMinuteCreditLimitError(lastError)) {
          sawThrottle = true;
        }
        continue;
      }
      const values = Array.isArray(parsed?.values) ? parsed.values : [];
      pageBars = values
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
      if (pageBars.length) {
        usedSymbol = candidate;
        lastError = "";
        break;
      }
    }
    if (!pageBars.length && sawThrottle && throttleRetries < 5) {
      throttleRetries += 1;
      await waitForNextMinuteWindow();
      continue;
    }
    if (!pageBars.length) break;
    throttleRetries = 0;
    for (const bar of pageBars) dedup.set(bar.time, bar);
    const earliest = pageBars[0]?.time;
    if (!Number.isFinite(earliest) || pageBars.length < outputsize) break;
    endDate = formatUnixSecForProvider(earliest - 1);
  }
  return {
    bars: [...dedup.values()].sort((a, b) => a.time - b.time).slice(-target),
    usedSymbol,
    lastError,
  };
}

function timeframeToYahoo(tfKey) {
  switch (String(tfKey || "")) {
    case "1":
      return { interval: "1m", range: "7d", direct: true };
    case "5":
      return { interval: "5m", range: "60d", direct: true };
    case "15":
      return { interval: "15m", range: "60d", direct: true };
    case "60":
      return { interval: "60m", range: "730d", direct: true };
    case "240":
      return { interval: "60m", range: "730d", direct: false, deriveFrom: "60" };
    case "1440":
      return { interval: "1d", range: "max", direct: true };
    default:
      return { interval: "1d", range: "max", direct: true };
  }
}

async function fetchYahooChart(yahooSymbol, interval, range) {
  let url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${encodeURIComponent(interval)}&includePrePost=false&events=div%2Csplits`;
  if (range === "max" && interval === "1d") {
    url += `&period1=0&period2=${Math.floor(Date.now() / 1000)}`;
  } else {
    url += `&range=${encodeURIComponent(range)}`;
  }
  const res = await fetch(url, {
    headers: { "User-Agent": YAHOO_USER_AGENT },
  });
  const text = await res.text();
  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    throw new Error(`yahoo_http_${res.status}: ${text.slice(0, 160)}`);
  }
  const result = parsed?.chart?.result?.[0];
  const error = parsed?.chart?.error;
  if (error) {
    throw new Error(`yahoo_${error.code || "error"}: ${error.description || "unknown"}`);
  }
  if (!result) {
    throw new Error("yahoo_empty_result");
  }
  return result;
}

function normalizeYahooBars(chartResult = {}) {
  const timestamps = Array.isArray(chartResult?.timestamp)
    ? chartResult.timestamp
    : [];
  const quote = chartResult?.indicators?.quote?.[0] || {};
  const out = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const time = Number(timestamps[index]);
    const open = Number(quote.open?.[index]);
    const high = Number(quote.high?.[index]);
    const low = Number(quote.low?.[index]);
    const close = Number(quote.close?.[index]);
    const volume = Number(quote.volume?.[index] || 0);
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      continue;
    }
    out.push({
      time,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

async function fetchYahooBars(symbol, tfKey, targetBars) {
  const yahooSymbol = YAHOO_SYMBOL_MAP[String(symbol || "").trim().toUpperCase()];
  if (!yahooSymbol) {
    return { bars: [], provider: "yahoo", reason: "no_yahoo_mapping" };
  }
  const cfg = timeframeToYahoo(tfKey);
  const chart = await fetchYahooChart(yahooSymbol, cfg.interval, cfg.range);
  let bars = normalizeYahooBars(chart);
  if (!cfg.direct && cfg.deriveFrom === "60") {
    bars = barsStorage.aggregateBarsFromLowerTimeframe(
      bars,
      4 * 60 * 60,
      60 * 60,
      5000,
    );
  }
  return {
    bars: bars.slice(-Math.max(50, Number(targetBars) || 5000)),
    provider: "yahoo",
    yahoo_symbol: yahooSymbol,
    interval: cfg.interval,
  };
}

function timeframeToBinance(tfKey) {
  switch (String(tfKey || "")) {
    case "1":
      return "1m";
    case "5":
      return "5m";
    case "15":
      return "15m";
    case "60":
      return "1h";
    case "240":
      return "4h";
    case "1440":
      return "1d";
    default:
      return "1d";
  }
}

async function fetchBinanceBars(symbol, tfKey, targetBars) {
  const binanceSymbol = BINANCE_SYMBOL_MAP[String(symbol || "").trim().toUpperCase()];
  if (!binanceSymbol) {
    return { bars: [], provider: "binance", reason: "no_binance_mapping" };
  }
  const interval = timeframeToBinance(tfKey);
  const target = Math.max(50, Math.min(Number(targetBars) || 1000, 15000));
  const dedup = new Map();
  let endTimeMs = null;
  while (dedup.size < target) {
    const limit = Math.max(1, Math.min(1000, target - dedup.size));
    const url = new URL("https://api.binance.com/api/v3/klines");
    url.searchParams.set("symbol", binanceSymbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", String(limit));
    if (Number.isFinite(endTimeMs) && endTimeMs > 0) {
      url.searchParams.set("endTime", String(endTimeMs));
    }
    const res = await fetch(String(url));
    const text = await res.text();
    let parsed = [];
    try {
      parsed = JSON.parse(text);
    } catch {}
    if (!res.ok || !Array.isArray(parsed)) {
      return {
        bars: [],
        provider: "binance",
        reason: `binance_http_${res.status}: ${text.slice(0, 160)}`,
      };
    }
    const bars = parsed
      .map((row) => ({
        time: Math.floor(Number(row[0]) / 1000),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5] || 0),
      }))
      .filter(
        (bar) =>
          Number.isFinite(bar.time) &&
          Number.isFinite(bar.open) &&
          Number.isFinite(bar.high) &&
          Number.isFinite(bar.low) &&
          Number.isFinite(bar.close),
      )
      .sort((a, b) => a.time - b.time);
    if (!bars.length) break;
    for (const bar of bars) dedup.set(bar.time, bar);
    const earliest = bars[0]?.time;
    if (!Number.isFinite(earliest) || bars.length < limit) break;
    endTimeMs = earliest * 1000 - 1;
  }
  return {
    bars: [...dedup.values()].sort((a, b) => a.time - b.time).slice(-target),
    provider: "binance",
    used_symbol: binanceSymbol,
  };
}

function alignSeriesByTime(leftBars = [], rightBars = []) {
  const rightMap = new Map(
    rightBars.map((bar) => [Number(bar.time), bar]),
  );
  return leftBars
    .map((left) => {
      const right = rightMap.get(Number(left.time));
      if (!right) return null;
      return { left, right };
    })
    .filter(Boolean);
}

function combineBarsByFormula(leftBars = [], rightBars = [], op = "divide") {
  const aligned = alignSeriesByTime(leftBars, rightBars);
  const out = [];
  for (const pair of aligned) {
    const a = pair.left;
    const b = pair.right;
    const divisorOpen = Number(b.open);
    const divisorHigh = Number(b.high);
    const divisorLow = Number(b.low);
    const divisorClose = Number(b.close);
    if (op === "divide") {
      if (
        !Number.isFinite(divisorOpen) ||
        !Number.isFinite(divisorHigh) ||
        !Number.isFinite(divisorLow) ||
        !Number.isFinite(divisorClose) ||
        divisorOpen === 0 ||
        divisorHigh === 0 ||
        divisorLow === 0 ||
        divisorClose === 0
      ) {
        continue;
      }
      out.push({
        time: a.time,
        open: a.open / divisorOpen,
        high: a.high / divisorLow,
        low: a.low / divisorHigh,
        close: a.close / divisorClose,
        volume: Number(a.volume || 0),
      });
      continue;
    }
    out.push({
      time: a.time,
      open: a.open * divisorOpen,
      high: a.high * divisorHigh,
      low: a.low * divisorLow,
      close: a.close * divisorClose,
      volume: Number(a.volume || 0),
    });
  }
  return out;
}

function readLocalBars(symbol, tfKey) {
  return barsStorage.readBrokerBarsFromFile(symbol, tfKey, 0, {
    dataRoot: DATA_ROOT,
    duckdbPath: DUCKDB_PATH,
    fullFile: true,
  });
}

async function deriveSymbolBars(symbol, tfKey, targetBars) {
  const spec = DERIVED_SYMBOL_MAP[String(symbol || "").trim().toUpperCase()];
  if (!spec) {
    return { bars: [], provider: "derived", reason: "no_derived_mapping" };
  }
  const leftBars = readLocalBars(spec.left, tfKey);
  const rightBars = readLocalBars(spec.right, tfKey);
  if (!leftBars.length || !rightBars.length) {
    return {
      bars: [],
      provider: "derived",
      reason: `missing_dependency_${!leftBars.length ? spec.left : spec.right}`,
    };
  }
  const combined = combineBarsByFormula(leftBars, rightBars, spec.op);
  return {
    bars: combined.slice(-Math.max(50, Number(targetBars) || 5000)),
    provider: "derived",
    derived_from: [spec.left, spec.right],
  };
}

async function fetchFallbackBars(symbol, tfKey, targetBars) {
  const symbolNorm = String(symbol || "").trim().toUpperCase();
  if (DERIVED_SYMBOL_MAP[symbolNorm]) {
    return deriveSymbolBars(symbolNorm, tfKey, targetBars);
  }
  if (BINANCE_SYMBOL_MAP[symbolNorm]) {
    const binance = await fetchBinanceBars(symbolNorm, tfKey, targetBars);
    if (binance.bars.length) return binance;
  }
  return fetchYahooBars(symbolNorm, tfKey, targetBars);
}

function shouldPreferFallback(symbol) {
  const symbolNorm = String(symbol || "").trim().toUpperCase();
  return Boolean(
    DERIVED_SYMBOL_MAP[symbolNorm] ||
      BINANCE_SYMBOL_MAP[symbolNorm] ||
      YAHOO_SYMBOL_MAP[symbolNorm],
  );
}

function loadTwelveApiKey() {
  if (!fs.existsSync(PROVIDER_FILE)) {
    throw new Error(`Missing Twelve provider file: ${PROVIDER_FILE}`);
  }
  const parsed = JSON.parse(fs.readFileSync(PROVIDER_FILE, "utf8") || "{}");
  const data = parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
  const apiKey = String(
    decryptData(
      data.api_key ||
        data.value ||
        parsed.api_key ||
        parsed.value ||
        parsed.key ||
        "",
    ),
  ).trim();
  if (!apiKey) {
    throw new Error("TWELVE_DATA api_key is empty");
  }
  return apiKey;
}

function listSymbols() {
  if (!fs.existsSync(MARKET_DATA_ROOT)) return [];
  const symbols = fs
    .readdirSync(MARKET_DATA_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name.trim().toUpperCase())
    .filter(Boolean)
    .sort();
  const only = String(process.env.BOOTSTRAP_SYMBOLS || "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  if (!only.length) return symbols;
  const allow = new Set(only);
  return symbols.filter((symbol) => allow.has(symbol));
}

function ensureMetadataDir(symbol) {
  const dir = path.join(MARKET_DATA_ROOT, symbol, "metadata");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeBootstrapMetadata(symbol, payload) {
  const metadataDir = ensureMetadataDir(symbol);
  const filePath = path.join(metadataDir, "bars_bootstrap_twelve.json");
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  process.env.BARS_STORAGE_PROVIDER = "parquet_duckdb";
  process.env.DATA_ROOT = DATA_ROOT;
  process.env.BARS_DUCKDB_PATH = DUCKDB_PATH;

  const apiKey = loadTwelveApiKey();
  const symbols = listSymbols();
  const onlyTf = new Set(
    String(process.env.BOOTSTRAP_ONLY_TF || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const tfConfig = onlyTf.size
    ? TF_CONFIG.filter((item) => onlyTf.has(item.tfKey))
    : TF_CONFIG;
  const startedAt = new Date().toISOString();
  const summary = [];

  console.log(
    `[bootstrap] start symbols=${symbols.length} provider=parquet_duckdb duckdb=${DUCKDB_PATH}`,
  );

  for (const symbol of symbols) {
    const symbolResult = {
      symbol,
      started_at: new Date().toISOString(),
      timeframes: {},
    };
    for (const config of tfConfig) {
      const label = `${symbol} ${config.tfKey}`;
      try {
        const existing = barsStorage.readBrokerBarsFromFile(
          symbol,
          config.tfKey,
          0,
          {
            dataRoot: DATA_ROOT,
            duckdbPath: DUCKDB_PATH,
            fullFile: true,
          },
        );
        if (existing.length >= Math.max(1, config.targetBars - 5)) {
          symbolResult.timeframes[config.tfKey] = {
            ok: true,
            skipped_existing: true,
            stored_bars: existing.length,
            first_bar: existing[0]?.time || null,
            last_bar: existing.at(-1)?.time || null,
          };
          console.log(`[bootstrap] keep ${label} stored=${existing.length}`);
          continue;
        }
        let fetched = { bars: [], usedSymbol: symbol, lastError: "" };
        let finalBars = [];
        let providerInfo = { provider: "", used_symbol: null };
        if (!shouldPreferFallback(symbol)) {
          fetched = await fetchTwelveBarsPaged(
            symbol,
            config.interval,
            config.targetBars,
            apiKey,
          );
          finalBars = fetched.bars;
          providerInfo = {
            provider: "twelve",
            used_symbol: fetched.usedSymbol,
          };
        }
        if (!finalBars.length) {
          const fallback = await fetchFallbackBars(
            symbol,
            config.tfKey,
            config.targetBars,
          ).catch((error) => ({
            bars: [],
            provider: "fallback",
            reason: String(error?.message || error || "fallback_failed"),
          }));
          if (fallback.bars.length) {
            finalBars = fallback.bars;
            providerInfo = {
              provider: String(fallback.provider || "fallback"),
              used_symbol:
                fallback.used_symbol ||
                fallback.yahoo_symbol ||
                (Array.isArray(fallback.derived_from)
                  ? fallback.derived_from.join("+")
                  : null),
            };
          } else {
            if (!shouldPreferFallback(symbol)) {
              fetched = await fetchTwelveBarsPaged(
                symbol,
                config.interval,
                config.targetBars,
                apiKey,
              );
              finalBars = fetched.bars;
              providerInfo = {
                provider: "twelve",
                used_symbol: fetched.usedSymbol,
              };
            }
          }
        }
        if (!finalBars.length) {
          if (shouldPreferFallback(symbol)) {
            symbolResult.timeframes[config.tfKey] = {
              ok: false,
              error: fetched.lastError || "empty_response",
            };
          }
          symbolResult.timeframes[config.tfKey] = {
            ok: false,
            error: fetched.lastError || "empty_response",
          };
          console.warn(
            `[bootstrap] skip ${label} ${symbolResult.timeframes[config.tfKey].error}`,
          );
          await sleep(250);
          continue;
        }
        const written = barsStorage.mergeBrokerBarsIntoFile(
          symbol,
          config.tfKey,
          finalBars,
          {
            dataRoot: DATA_ROOT,
            duckdbPath: DUCKDB_PATH,
          },
        );
        const stored = barsStorage.readBrokerBarsFromFile(
          symbol,
          config.tfKey,
          0,
          {
            dataRoot: DATA_ROOT,
            duckdbPath: DUCKDB_PATH,
            fullFile: true,
          },
        );
        symbolResult.timeframes[config.tfKey] = {
          ok: true,
          interval: config.interval,
          requested_bars: config.targetBars,
          fetched_bars: finalBars.length,
          written_bars: written,
          stored_bars: stored.length,
          first_bar: stored[0]?.time || null,
          last_bar: stored.at(-1)?.time || null,
          used_symbol: providerInfo.used_symbol,
          provider: providerInfo.provider,
        };
        console.log(
          `[bootstrap] ok ${label} provider=${providerInfo.provider} fetched=${finalBars.length} stored=${stored.length} used=${providerInfo.used_symbol}`,
        );
      } catch (error) {
        symbolResult.timeframes[config.tfKey] = {
          ok: false,
          error: String(error?.message || error || "bootstrap_failed"),
        };
        console.error(`[bootstrap] fail ${label} ${symbolResult.timeframes[config.tfKey].error}`);
      }
      await sleep(250);
    }
    symbolResult.finished_at = new Date().toISOString();
    writeBootstrapMetadata(symbol, symbolResult);
    summary.push(symbolResult);
  }

  const output = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    symbols: summary,
  };
  const summaryPath = path.join(DATA_ROOT, "market_data_bootstrap_twelve_summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(output, null, 2));
  console.log(`[bootstrap] done summary=${summaryPath}`);
}

main().catch((error) => {
  console.error(`[bootstrap] fatal ${String(error?.message || error)}`);
  process.exitCode = 1;
});
