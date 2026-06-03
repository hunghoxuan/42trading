"use strict";

const crypto = require("crypto");

// Configuration for snapshot strategy - can be overridden by request body merge_snapshots
const ALL_SNAPSHOTS_IN_1_FILE_DEFAULT = true;
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");
const dbQueries = require("../db/queries");
const {
  eq,
  and,
  or,
  desc,
  asc,
  sql,
  inArray,
  ilike,
  gte,
  lte,
  count,
} = require("drizzle-orm");
const schema = require("../db/schema.js");
const syncGuards = require("./syncGuards");
const { execFileSync, spawnSync } = require("child_process");
const { URL, URLSearchParams } = require("url");
let createRedisClient = null;
let BullQueue = null;
let BullWorker = null;
try {
  ({ createClient: createRedisClient } = require("redis"));
} catch {
  createRedisClient = null;
}
try {
  ({ Queue: BullQueue, Worker: BullWorker } = require("bullmq"));
} catch {
  BullQueue = null;
  BullWorker = null;
}

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

let GLOBAL_API_STATS = {
  last_updates: [],
  counters: {
    twelve_data: 0,
    claude: 0,
    openai: 0,
    deepseek: 0,
  },
};

function trackApiCall(apiName) {
  const name = String(apiName || "unknown").toLowerCase();
  if (GLOBAL_API_STATS.counters[name] !== undefined) {
    GLOBAL_API_STATS.counters[name]++;
  } else {
    GLOBAL_API_STATS.counters[name] = 1;
  }
  GLOBAL_API_STATS.last_updates.unshift({
    api: apiName,
    time: Date.now(),
  });
  if (GLOBAL_API_STATS.last_updates.length > 50) {
    GLOBAL_API_STATS.last_updates.pop();
  }
  // Route through NotificationManager
  if (notificationManager) {
    notificationManager.handle("REMOTE_API_CALL", "call", {
      api: apiName,
      message: name,
    });
  }
}

function asBool(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const raw = String(value).trim();
  if (raw === "") {
    return fallback;
  }
  const v = raw.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function asNum(value, fallback = NaN) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "string" && value.trim() === "") {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseKeySet(value) {
  return new Set(
    envStr(value)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function envStr(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }
  const s = String(value).trim();
  return s === "" ? fallback : s;
}

function clipForLog(value, maxLen = 4000) {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const text = String(raw || "");
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen))} …[truncated ${text.length - maxLen} chars]`;
}

function hashForLog(value) {
  const text = String(value || "");
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function normalizeIsoTimestamp(value, fallback = new Date().toISOString()) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return fallback;
  return new Date(ms).toISOString();
}

loadEnvFile();
// ROOT_FOLDER overrides __dirname for all data/snapshot/log paths
const ROOT_DIR = envStr(process.env.ROOT_FOLDER, __dirname);
// Global data dirs (not user-specific)
const GLOBAL_DATA_DIR = path.resolve(ROOT_DIR, "..", "data");
const CONFIG_GUIDE_DIR = path.resolve(ROOT_DIR, "..", "config", "guide");
// Load the AI system guide + strategy templates — used as default prompt
// for cron AI analysis when no custom prompt is provided (matches manual UI).
let DEFAULT_AI_SYSTEM_PROMPT = "";
let DEFAULT_AI_STRATEGIES = "";
try {
  DEFAULT_AI_SYSTEM_PROMPT = fs.readFileSync(
    path.join(CONFIG_GUIDE_DIR, "system.md"),
    "utf8",
  );
  DEFAULT_AI_STRATEGIES = fs.readFileSync(
    path.join(CONFIG_GUIDE_DIR, "strategies.md"),
    "utf8",
  );
} catch (_) {
  console.warn(
    "[startup] Could not load config/guide/system.md or strategies.md — default AI prompt will be bare",
  );
}

// Build a rich default prompt matching what the manual UI produces.
// Used when no custom prompt is provided (e.g., cron AI analysis).
function buildDefaultRichPrompt(symbol, tfs) {
  const tfList = (tfs || ["D", "4H", "15m", "5m"]).map((x) =>
    String(x).toUpperCase(),
  );
  return `## SESSION CONFIG
Asset: Auto detect | Session: Any | Profile: daily
Symbols: ${symbol}
MinTrades: 0 | MaxTrades: 2 | MinRR: 2 | MaxRisk: 1% | NarrativeLanguage: English
HTF: D, 4H
Execution: 15M
Confirmation: 5M
Active Strategies: SMC, Price Action, Market Structure

${DEFAULT_AI_STRATEGIES}

## ANALYSIS INSTRUCTIONS
${DEFAULT_AI_SYSTEM_PROMPT}

## PRICE PRECISION RULE (MANDATORY)
For each symbol, detect the market price precision from the provided chart/current price values and keep it consistent.
If current price uses N decimals, all price outputs in trade_plan must also use exactly N decimals:
- entry_price / entry
- stop_loss / sl
- take_profit / tp
- multiple_exits.tp1.price / tp2.price / tp3.price
- breakeven_trigger / be_trigger
Do not round to fewer decimals than the symbol precision.`;
}

const SERVER_VERSION = envStr(
  process.env.WEBHOOK_SERVER_VERSION,
  "v2026.05.28 12:18 - d008212f",
); // broker live price stream, tracked-symbols api, timer-split sync+price

const SERVER_LOG_DIR = envStr(
  process.env.SERVER_LOG_DIR,
  path.join(GLOBAL_DATA_DIR, "logs"),
);

// --- SSE Notification Bus ---
const SSE_CLIENTS = new Map(); // userId -> Set<res>
function sseRegisterClient(userId, res) {
  if (!SSE_CLIENTS.has(userId)) SSE_CLIENTS.set(userId, new Set());
  SSE_CLIENTS.get(userId).add(res);
}
function sseRemoveClient(userId, res) {
  const set = SSE_CLIENTS.get(userId);
  if (set) {
    set.delete(res);
    if (!set.size) SSE_CLIENTS.delete(userId);
  }
}
function emitNotification(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  const targets = new Set();
  // user-specific clients
  if (payload.user_id) {
    const userClients = SSE_CLIENTS.get(payload.user_id);
    if (userClients) userClients.forEach((r) => targets.add(r));
  }
  // global clients (admin/system listeners)
  const globalClients = SSE_CLIENTS.get("*");
  if (globalClients) globalClients.forEach((r) => targets.add(r));
  // optional broadcast to all connected users (used for cross-surface events)
  if (payload && payload.broadcast_all === true) {
    for (const set of SSE_CLIENTS.values()) {
      set.forEach((r) => targets.add(r));
    }
  }
  for (const res of targets) {
    try {
      res.write(data);
    } catch (e) {
      /* client disconnected */
    }
  }
}

// --- File-based notification persistence ---
const NOTIFICATIONS_LOG_PATH = path.join(
  SERVER_LOG_DIR,
  "system",
  "notifications.log",
);

function appendNotificationToFile(payload) {
  try {
    const dir = path.dirname(NOTIFICATIONS_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const line =
      JSON.stringify({
        t: new Date().toISOString(),
        event: payload.event || "",
        message: payload.message || "",
        type: payload.type || "info",
        user_id: payload.user_id || null,
        symbol: payload.symbol || null,
      }) + "\n";
    // Read existing, append, trim to max 500 lines
    let lines = [];
    if (fs.existsSync(NOTIFICATIONS_LOG_PATH)) {
      lines = fs
        .readFileSync(NOTIFICATIONS_LOG_PATH, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
    }
    lines.push(line);
    // Keep last 500 lines
    if (lines.length > 500) lines = lines.slice(-500);
    fs.writeFileSync(NOTIFICATIONS_LOG_PATH, lines.join("\n") + "\n");
  } catch (_) {}
}

function readNotificationsFromFile(limit = 100) {
  if (!fs.existsSync(NOTIFICATIONS_LOG_PATH)) return [];
  try {
    const raw = fs.readFileSync(NOTIFICATIONS_LOG_PATH, "utf8");
    const lines = raw.trim().split("\n");
    // Return last N lines, reversed (newest first)
    const sliced = lines.slice(-Math.max(1, Math.min(limit, 500)));
    return sliced
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch (_) {
    return [];
  }
}

function clearNotificationsFile() {
  try {
    if (fs.existsSync(NOTIFICATIONS_LOG_PATH)) {
      fs.truncateSync(NOTIFICATIONS_LOG_PATH, 0);
    }
    return true;
  } catch (_) {
    return false;
  }
}

// --- File-based logging ---

// --- Unified bar merge ---
// Merges new bars into CSV (sorted by time, upsert, dedup).
// CSV path: market_data/{SYMBOL}/bars/{TF}.csv
// Format: time,open,high,low,close,volume
// Also updates L1 memory cache + Redis L2.
function normalizeCsvTfKey(tf) {
  const raw = String(tf || "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  if (
    raw === "d" ||
    raw === "1d" ||
    raw === "day" ||
    raw === "1440" ||
    raw === "1day"
  )
    return "1440";
  if (raw === "w" || raw === "1w" || raw === "week") return "1w";
  if (raw === "4h" || raw === "240") return "240";
  if (raw === "1h" || raw === "60" || raw === "60m" || raw === "60min")
    return "60";
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

// Discover all symbols with market_data directories
function discoverAllMarketSymbols() {
  const dir = path.join(GLOBAL_DATA_DIR, "market_data");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((d) => fs.statSync(path.join(dir, d)).isDirectory())
    .filter((d) => d === d.toUpperCase())
    .sort();
}

// Resolve symbols_group to actual symbol list
const SYMBOLS_GROUP_MAP = {
  crypto: [
    "BTCUSD",
    "ETHUSD",
    "XRPUSD",
    "SOLUSD",
    "DOGEUSD",
    "ADAUSD",
    "LTCUSD",
    "BNBUSD",
    "DOTUSD",
    "MATICUSD",
    "ATOMUSD",
    "ETCUSD",
    "NEARUSD",
  ],
  forex: [
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "AUDUSD",
    "NZDUSD",
    "USDCAD",
    "USDCHF",
    "GBPJPY",
    "EURJPY",
    "EURGBP",
    "EURAUD",
    "EURCAD",
    "GBPAUD",
    "GBPCAD",
    "AUDCAD",
    "AUDCHF",
    "AUDJPY",
    "AUDNZD",
    "CADJPY",
    "NZDCAD",
    "EURSGD",
    "USDSGD",
  ],
  indices: ["US30", "NAS100", "SPX500", "GER40", "UK100", "JPN225", "DE40"],
  metals: [
    "XAUUSD",
    "XAGUSD",
    "XPTUSD",
    "XPDUSD",
    "XAUEUR",
    "XAUGBP",
    "XAUJPY",
    "XTIUSD",
  ],
};

// Parse cron schedule string and check if it should fire now.
// Schedule formats:
//   "every 5m" → interval-based (handled by cadence_seconds fallback)
//   "at 11:20 on Mon,Wed,Fri" → specific days + time
function cronScheduleShouldRun(schedule, nowMs, lastRunMs) {
  const s = String(schedule || "").trim();
  if (!s) return false;

  // Event mode: "at HH:MM on Day1,Day2,..."
  const atMatch = s.match(/^at (\d{1,2}):(\d{2})\s+on\s+(.+)$/i);
  if (atMatch) {
    const targetHour = parseInt(atMatch[1], 10);
    const targetMin = parseInt(atMatch[2], 10);
    const targetDays = atMatch[3].split(",").map((d) => d.trim().toLowerCase());

    const now = new Date(nowMs);
    const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const currentDay = dayNames[now.getDay()];
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();

    // Check day
    if (!targetDays.includes(currentDay)) return false;

    // Check time: within the past minute (cron loop runs every 60s)
    const targetTotalMins = targetHour * 60 + targetMin;
    const currentTotalMins = currentHour * 60 + currentMin;
    if (currentTotalMins < targetTotalMins) return false;
    if (currentTotalMins - targetTotalMins > 1) return false;

    // Don't re-run if already ran in the last 2 minutes
    if (lastRunMs && nowMs - lastRunMs < 120000) return false;

    return true;
  }

  // Interval mode: handled by cadence_seconds fallback, not here
  return false;
}

function resolveCronSymbols(data = {}) {
  const group = String(data.symbols_group || "").trim();
  if (group === "all") return discoverAllMarketSymbols();
  if (group && SYMBOLS_GROUP_MAP[group]) {
    const preset = SYMBOLS_GROUP_MAP[group];
    const all = discoverAllMarketSymbols();
    return preset.filter((s) => all.includes(s)); // only return symbols that exist in market_data
  }
  // Fallback to stored symbols or auto-discover all
  const syms =
    Array.isArray(data.symbols) && data.symbols.length
      ? data.symbols
      : discoverAllMarketSymbols();
  return syms;
}

function resolveBrokerCsvPath(symbol, tf) {
  const sym = String(symbol || "")
    .trim()
    .toUpperCase();
  if (!sym) return "";
  const baseDir = path.join(GLOBAL_DATA_DIR, "market_data", sym, "bars");
  const aliases = csvTfAliases(tf);
  for (const alias of aliases) {
    const p = path.join(baseDir, `${alias}.csv`);
    if (fs.existsSync(p)) return p;
  }
  const primary = aliases[0] || normalizeCsvTfKey(tf);
  return primary ? path.join(baseDir, `${primary}.csv`) : "";
}

// ── Metadata sidecar (replaces market_data.metadata column) ──
function resolveMetadataPath(symbol, tf) {
  const sym = String(symbol || "")
    .trim()
    .toUpperCase();
  if (!sym) return "";
  const tfKey = normalizeCsvTfKey(tf);
  const dir = path.join(GLOBAL_DATA_DIR, "market_data", sym, "metadata");
  return path.join(dir, `${tfKey}.json`);
}
function readMarketDataMetadata(symbol, tf) {
  const p = resolveMetadataPath(symbol, tf);
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
function writeMarketDataMetadata(symbol, tf, metadata) {
  if (!metadata || typeof metadata !== "object") return;
  const p = resolveMetadataPath(symbol, tf);
  if (!p) return;
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(p, JSON.stringify(metadata));
  } catch {}
}

function readBrokerBarsFromCsv(symbol, tf, limit = 300) {
  const sym = String(symbol || "")
    .trim()
    .toUpperCase();
  const tfKey = normalizeCsvTfKey(tf);
  const tfSeconds = Math.max(60, parseTfTokenToSeconds(tfKey));
  if (!sym || !tfKey) return [];
  const csvPath = resolveBrokerCsvPath(sym, tfKey);
  if (!csvPath || !fs.existsSync(csvPath)) return [];
  try {
    const raw = fs.readFileSync(csvPath, "utf8");
    const lines = raw.trim().split(/\r?\n/);
    const dedup = new Map(); // normalize + dedupe by UTC-aligned time
    for (let i = 1; i < lines.length; i += 1) {
      const cols = String(lines[i] || "").split(",");
      if (cols.length < 5) continue;
      const rawTime = Number(cols[0]);
      const o = Number(cols[1]);
      const h = Number(cols[2]);
      const l = Number(cols[3]);
      const c = Number(cols[4]);
      const v = Number(cols[5]) || 0;
      if (
        !Number.isFinite(rawTime) ||
        !Number.isFinite(o) ||
        !Number.isFinite(h) ||
        !Number.isFinite(l) ||
        !Number.isFinite(c)
      )
        continue;
      // Align to UTC boundary (source-of-truth: UTC)
      const t = normalizeBarTimeToUTC(rawTime, tfSeconds);
      dedup.set(t, {
        time: t,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: v,
      });
    }
    const rows = [...dedup.values()].sort((a, b) => a.time - b.time);
    return rows.slice(-Math.max(50, Math.min(Number(limit) || 300, 5000)));
  } catch {
    return [];
  }
}

// Snap bar timestamp to UTC-aligned boundary for the timeframe.
// No matter the source, bar timestamps MUST be UTC epoch aligned to their
// timeframe period (e.g. daily bars at midnight UTC, 1m at minute boundaries).
// This prevents timezone-offset duplicates when cTrader sends broker-local times.
function normalizeBarTimeToUTC(time, tfSeconds) {
  if (!Number.isFinite(time) || !tfSeconds || tfSeconds < 60) return time;
  const aligned = Math.floor(time / tfSeconds) * tfSeconds;
  return aligned;
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

function mergeBarsIntoCSV(symbol, tf, newBars) {
  if (!symbol || !tf || !newBars.length) return 0;
  const sym = String(symbol).toUpperCase();
  const tfKey = normalizeCsvTfKey(tf);
  const tfSeconds = Math.max(60, parseTfTokenToSeconds(tfKey));
  const csvDir = path.join(GLOBAL_DATA_DIR, "market_data", sym, "bars");
  if (!fs.existsSync(csvDir)) fs.mkdirSync(csvDir, { recursive: true });
  // Always use canonical path ({tfKey}.csv), never alias
  const csvPath = path.join(csvDir, `${tfKey}.csv`);

  // Migrate bars from alias files into canonical file, then remove aliases
  const aliases = csvTfAliases(tf);
  for (const alias of aliases) {
    if (alias === tfKey) continue;
    const aliasPath = path.join(csvDir, `${alias}.csv`);
    if (fs.existsSync(aliasPath)) {
      try {
        const aliasLines = fs
          .readFileSync(aliasPath, "utf8")
          .trim()
          .split("\n");
        for (let i = 1; i < aliasLines.length; i++) {
          const parts = aliasLines[i].split(",");
          const t = Number(parts[0]);
          if (Number.isFinite(t)) {
            const n = `time,open,high,low,close,volume`; // skip header
            if (aliasLines[i] !== n)
              newBars.push({
                t,
                o: Number(parts[1]),
                h: Number(parts[2]),
                l: Number(parts[3]),
                c: Number(parts[4]),
                v: Number(parts[5] || 0),
              });
          }
        }
        fs.unlinkSync(aliasPath);
      } catch {}
    }
  }

  // Read existing bars into Map (time -> csv line).
  // Normalize existing times to UTC boundaries — cleans up stale non-aligned bars
  // from before the UTC normalization fix.
  const existing = new Map();
  if (fs.existsSync(csvPath)) {
    const lines = fs.readFileSync(csvPath, "utf8").trim().split("\n");
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      const rawTime = Number(parts[0]);
      if (Number.isFinite(rawTime)) {
        const t = normalizeBarTimeToUTC(rawTime, tfSeconds);
        const o = Number(parts[1]);
        const h = Number(parts[2]);
        const l = Number(parts[3]);
        const c = Number(parts[4]);
        const v = Number(parts[5] || 0);
        if (
          !Number.isFinite(o) ||
          !Number.isFinite(h) ||
          !Number.isFinite(l) ||
          !Number.isFinite(c)
        ) {
          continue;
        }
        existing.set(t, { t, o, h, l, c, v });
      }
    }
  }

  let added = 0;
  for (const b of newBars) {
    const rawTime = Number(b.t || b.time);
    // Align to UTC timeframe boundary (source-of-truth: UTC)
    const t = normalizeBarTimeToUTC(rawTime, tfSeconds);
    const o = Number(b.o || b.open);
    const h = Number(b.h || b.high);
    const l = Number(b.l || b.low);
    const c = Number(b.c || b.close);
    const v = Number(b.v || b.volume || 0);
    const current = existing.get(t);
    if (
      !Number.isFinite(t) ||
      !Number.isFinite(o) ||
      !Number.isFinite(h) ||
      !Number.isFinite(l) ||
      !Number.isFinite(c)
    )
      continue;
    if (current) {
      const currentVol = Number(current.v || 0);
      const nextVol = Number(v || 0);
      const keepCurrent =
        currentVol > 0 &&
        nextVol <= 0 &&
        Number.isFinite(current.o) &&
        Number.isFinite(current.h) &&
        Number.isFinite(current.l) &&
        Number.isFinite(current.c);
      if (keepCurrent) continue;
    }
    existing.set(t, { t, o, h, l, c, v });
    added++;
  }

  if (added === 0) return 0;

  // Sort by time, keep last MAX_BARS_PER_CSV (oldest bars trimmed)
  const MAX_BARS_PER_CSV = 3000;
  const sorted = sanitizeShiftedZeroVolumeDuplicates(
    Array.from(existing.values()),
    tfSeconds,
  );
  const trimmed =
    sorted.length > MAX_BARS_PER_CSV ? sorted.slice(-MAX_BARS_PER_CSV) : sorted;
  const csv =
    "time,open,high,low,close,volume\n" +
    trimmed
      .map((row) => `${row.t},${row.o},${row.h},${row.l},${row.c},${row.v}`)
      .join("\n") +
    "\n";
  fs.writeFileSync(csvPath, csv);

  // Build merged bar objects for cache
  const mergedBars = trimmed.map((row) => ({
    time: row.t,
    open: row.o,
    high: row.h,
    low: row.l,
    close: row.c,
    volume: row.v,
  }));
  const lastBar = mergedBars[mergedBars.length - 1];

  // Update L1 memory cache
  const symNorm = normalizeMarketDataSymbol(sym);
  const key = marketDataCacheKey(symNorm);
  const root = MARKET_DATA_MEMORY_CACHE.get(key);
  if (root && Array.isArray(root.data)) {
    for (const tfEntry of root.data) {
      if (String(tfEntry.tf || "").toLowerCase() === tfKey) {
        tfEntry.bars = mergedBars.slice(-1000);
        if (lastBar) {
          tfEntry.last_price = lastBar.close;
          tfEntry.last_price_at = new Date(lastBar.time * 1000).toISOString();
        }
        break;
      }
    }
    root.updated_time = Math.floor(Date.now() / 1000);
  }

  // Async Redis L2
  getRedisClient()
    .then(async (client) => {
      if (!client) return;
      try {
        const raw = await client.get(key).catch(() => "");
        let redisRoot = null;
        if (raw) {
          try {
            redisRoot = JSON.parse(raw);
          } catch {}
        }
        if (redisRoot && Array.isArray(redisRoot.data)) {
          for (const tfEntry of redisRoot.data) {
            if (String(tfEntry.tf || "").toLowerCase() === tfKey) {
              tfEntry.bars = mergedBars.slice(-1000);
              if (lastBar) {
                tfEntry.last_price = lastBar.close;
                tfEntry.last_price_at = new Date(
                  lastBar.time * 1000,
                ).toISOString();
              }
              break;
            }
          }
          redisRoot.updated_time = Math.floor(Date.now() / 1000);
          await client
            .setEx(key, 3600, JSON.stringify(redisRoot))
            .catch(() => {});
        }
      } catch {}
    })
    .catch(() => {});

  return added;
}

async function ingestBrokerBarsPayload(payload = {}) {
  const bars = Array.isArray(payload?.bars) ? payload.bars : [];
  if (!bars.length) {
    return { inserted: 0, skippedCrypto: 0, symbolsSeen: new Set() };
  }

  const grouped = new Map();
  let skippedCrypto = 0;
  for (const bar of bars) {
    const symbol = String(bar.s || bar.symbol || "")
      .trim()
      .toUpperCase();
    const tf = String(bar.tf || bar.timeframe || "").trim();
    if (!symbol || !tf) continue;
    if (isCryptoPair(symbol)) {
      skippedCrypto++;
      continue;
    }
    const key = `${symbol}|${tf}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(bar);
  }

  let inserted = 0;
  const symbolsSeen = new Set();
  for (const [key, groupBars] of grouped) {
    const [symbol, tf] = key.split("|");
    const added = mergeBarsIntoCSV(symbol, tf, groupBars);
    inserted += added;
    if (added > 0) {
      symbolsSeen.add(symbol);
      await upsertSymbolActivity(symbol, {
        bars: {
          last_time: new Date().toISOString(),
          tf: String(tf || ""),
          inserted: added,
        },
      });
    }
  }

  if (inserted > 0) {
    const pushAccountId = payload.account_id || "unknown";
    await mt5Log(
      pushAccountId,
      "accounts",
      {
        event: "BAR_PUSH",
        source_id: payload.source_id || "unknown",
        bar_count: inserted,
        symbols: [...symbolsSeen],
        skipped_crypto: skippedCrypto,
      },
      CFG.mt5DefaultUserId,
    );
  }
  if (skippedCrypto > 0) {
    console.log(
      `[broker/bars] Skipped ${skippedCrypto} crypto bars (Binance handles these)`,
    );
  }

  return { inserted, skippedCrypto, symbolsSeen };
}

// Search all trade category dirs for existing {sid}-* folder
function findExistingTradeDir(safeSid) {
  for (const cat of ["active", "closed", "files"]) {
    const baseDir = TRADE_CATEGORY_DIRS[cat];
    if (!fs.existsSync(baseDir)) continue;
    try {
      const entries = fs.readdirSync(baseDir);
      let match = entries.find(
        (e) =>
          e.startsWith(safeSid + "-") &&
          fs.statSync(path.join(baseDir, e)).isDirectory(),
      );
      if (!match) {
        match = entries.find(
          (e) =>
            e === safeSid && fs.statSync(path.join(baseDir, e)).isDirectory(),
        );
      }
      if (match === safeSid) {
        return repairBareTradeDirSync(
          baseDir,
          safeSid,
          path.join(baseDir, match),
        );
      }
      if (match) return path.join(baseDir, match);
    } catch {}
  }
  return null;
}

// Log routing — one file per event type, grouped by source (see .local/log_routing.js)
const EVENT_FILE_MAP = {
  SYSTEM_EVENT: ["SYSTEM", "events"],
  REMOTE_API_CALL: ["SYSTEM", "events"],
  ACCOUNT_HEARTBEAT: ["accounts", "broker_sync"],
  ACCOUNT_SYNC: ["accounts", "broker_sync"],
  PRICES_SYNC: ["accounts", "broker_prices_sync"],
  PRICE_PUSH: ["accounts", "broker_prices_sync"],
  BAR_PUSH: ["accounts", "broker_bars"],
  EA: ["accounts", "ea"],
  TRADE_FILLED: ["trades", "trade_filled"],
  TRADE_CLOSED: ["trades", "trade_closed"],
  TRADE_CLOSE: ["trades", "trade_closed"],
  SL_CHANGED: ["trades", "sl_changed"],
  PARTIAL_CLOSE: ["trades", "partial_close"],
  TRADE_FAILED: ["trades", "trade_failed"],
  SIGNAL_EA_SYNC_PUSH: ["accounts", "sync"],
  BROKER_SYNC: ["accounts", "broker_sync"],
  broker_sync: ["accounts", "broker_sync"],
  BROKER_POLL: ["accounts", "broker_pull"],
  TRADE_ACTIVITY: ["accounts", "sync"],
  SIGNAL_ACTIVITY: ["accounts", "sync"],
  TRADE_ACK: ["trades", "ack"],
  TRADE_ACK_DUPLICATE: ["trades", "ack"],
  TRADE_ACK_FAILED: ["trades", "ack"],
  TRADE_SYNC_UPDATE: ["trades", "sync"],
  TRADE_SYNC_CLOSE: ["trades", "sync"],
  TRADE_SYNC_UNMATCHED: ["trades", "sync"],
  TRADE_MANUAL_EDIT: ["trades", "manual"],
  TRADE_PLAN_SAVED: ["trades", "manual"],
  TRADE_PROMOTED: ["trades", "manual"],
  BROKER_PULL_STALE_REJECT: ["trades", "broker_pull"],
  BROKER_PULL_RETRY_REJECT: ["trades", "broker_pull"],
  SIGNAL_FANOUT: ["trades", "fanout"],
  DIRECT_TRADE_CREATE: ["trades", "fanout"],
  FANOUT_COMPLETED: ["trades", "fanout"],
  FANOUT_FAILED: ["trades", "fanout"],
  FANOUT_SKIPPED_ONLY_SIGNAL: ["trades", "fanout"],
  SIGNAL_EA_ACK: ["trades", "signal"],
  SIGNAL_EA_REQUEUE: ["trades", "signal"],
  SIGNAL_MANUAL_CANCEL: ["trades", "signal"],
  SIGNAL_TRADE_PLAN_SAVED: ["trades", "signal"],
  SIGNAL_CREATE_TRADE: ["trades", "signal"],
  ea_to_trade: ["trades", "ea_update"],
  AI_ANALYSIS: ["trades", "ai_analyze"],
  AI_ANALYZE_REQUEST: ["trades", "ai_analyze"],
  AI_ANALYZE_RESPONSE: ["trades", "ai_analyze"],
  AI_ANALYZE_ERROR: ["trades", "ai_analyze"],
  AI_API_CALL_REQUEST: ["trades", "ai_api_call"],
  AI_API_CALL_RESPONSE: ["trades", "ai_api_call"],
  AI_RESPONSE: ["trades", "ai_response"],
  AI_ANALYZE_AUTO_SAVE_SIGNAL: ["trades", "ai_auto_save"],
  AI_ANALYZE_AUTO_SAVE_TRADE: ["trades", "ai_auto_save"],
  TASK_FETCH: ["CRON"],
  CRON_AI_ANALYSIS: ["CRON"],
  CRON_SNAPSHOT: ["CRON"],
  SNAPSHOT_CREATED: ["API", "chart_snapshots"],
  snapshot_created: ["API", "chart_snapshots"],
  CHART_SNAPSHOTS: ["API", "chart_snapshots"],
  chart_snapshots: ["API", "chart_snapshots"],
  UI_CREATE_TRADE_DIRECT: ["ui", "direct"],
  UI_DB_CREATE: ["ui", "direct"],
  UI_MANUAL_LOG: ["ui", "direct"],
};

function resolveLogFile(objectId, metadata) {
  const ev = String(metadata.event || metadata.event_type || "").toUpperCase();

  // Extract source_id — check top-level first, then nested data (object or JSON string)
  let metaSource = metadata.source_id || metadata.provider || metadata.account;
  if (!metaSource && metadata.data) {
    const d =
      typeof metadata.data === "string"
        ? (() => {
            try {
              return JSON.parse(metadata.data);
            } catch (_) {
              return null;
            }
          })()
        : metadata.data;
    if (d && typeof d === "object") metaSource = d.source_id || d.provider;
  }

  let entry;
  if (ev.startsWith("SIGNAL_EA_SYNC_")) entry = ["accounts", "sync"];
  else if (ev.startsWith("SIGNAL_EA_ACK_")) entry = ["trades", "signal"];
  else if (ev.startsWith("CRON_SNAPSHOT_")) entry = ["cron"];
  else entry = EVENT_FILE_MAP[ev];
  if (!entry) return null;
  const source = entry[0];
  const idOrFile = entry[1];

  // Flat sources: filename is the 2nd element, or derived from metadata (cron)
  if (source === "CRON" || source === "cron") {
    const name = metadata.cron_name || metadata.cron || "unknown";
    const safeName = String(name)
      .trim()
      .replace(/[^A-Za-z0-9_.-]/g, "_");
    return "CRON/" + safeName + ".log";
  }
  if (
    source === "API" ||
    source === "api" ||
    source === "SYSTEM" ||
    source === "system" ||
    source === "ui"
  ) {
    const folder = source.toUpperCase();
    const safeFile = String(idOrFile || "unknown").replace(
      /[^A-Za-z0-9_.-]/g,
      "_",
    );
    return folder + "/" + safeFile + ".log";
  }
  if (source === "accounts") {
    // Accounts log under accounts/{source_name}/ to group by broker
    const accSource = metaSource || "unknown";
    const safeSrc = String(accSource).replace(/[^A-Za-z0-9_.-]/g, "_");
    const safeFile = String(idOrFile || "unknown").replace(
      /[^A-Za-z0-9_.-]/g,
      "_",
    );
    return "accounts/" + safeSrc + "/" + safeFile + ".log";
  }

  // Hierarchical: only trades remain (written to trade folder, not SERVER_LOG_DIR)
  if (source === "trades") {
    const tradeSid =
      metadata.trade_sid || metadata.trade_id || objectId || "unknown";
    const tradeSym = metadata.trade_symbol || metadata.symbol || "";
    const safeTradeSid = String(tradeSid || "")
      .trim()
      .replace(/[^A-Za-z0-9_.-]/g, "_");
    const tradeDir = tradeSym
      ? resolveTradeDir(tradeSid, tradeSym)
      : findExistingTradeDir(safeTradeSid);
    const safeTradeFile = String(idOrFile || "unknown").replace(
      /[^A-Za-z0-9_.-]/g,
      "_",
    );
    if (tradeDir) return path.join(tradeDir, "logs", safeTradeFile + ".log");
    return path.join("trades", safeTradeSid, safeTradeFile + ".log");
  }

  // Fallback: hierarchical subdir by ID
  const dirId = objectId || "unknown";
  const safeId = String(dirId || "unknown")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "_");
  return source + "/" + safeId + "/" + safeFile + ".log";
}

function fileLog(objectId, objectTable, metadata = {}, userId = null) {
  if (!SERVER_LOG_DIR) return;
  const evt = String(
    metadata.event || metadata.event_type || "INFO",
  ).toUpperCase();
  const level = metadata.error
    ? "ERROR"
    : (metadata.level || "INFO").toUpperCase();
  const iso = new Date().toISOString();
  // Message: use explicit message, or generate from event + source + object
  const autoMsg = (() => {
    const src = metadata.source_id || metadata.provider || "";
    const srcPart = src ? ` [${src}]` : "";
    const st = metadata.status || metadata.level || "";
    const stPart = st ? ` (${st})` : "";
    return `${evt.replace(/_/g, " ").toLowerCase()}${srcPart}: ${objectId}${stPart}`;
  })();
  const msg = String(metadata.message || "").trim() || autoMsg;
  // New format: [ISO] [LEVEL] [EVENT_TYPE] message, key=val, ...
  const extra = [];
  if (msg) extra.push(msg);
  extra.push("object_type=" + objectTable, "object_id=" + objectId);
  if (metadata && typeof metadata === "object") {
    for (const [k, v] of Object.entries(metadata)) {
      if (v === undefined || v === null) continue;
      if (
        k === "event" ||
        k === "event_type" ||
        k === "message" ||
        k === "level" ||
        k === "error"
      )
        continue;
      const val = typeof v === "object" ? JSON.stringify(v) : String(v);
      if (val === "" || val === "[object Object]") continue;
      extra.push(k + "=" + (val.includes(" ") ? '"' + val + '"' : val));
    }
  }
  const line =
    "[" + iso + "] [" + level + "] [" + evt + "] " + extra.join(", ") + "\n";
  const logTarget = resolveLogFile(objectId, metadata);
  if (!logTarget) return;
  // Support absolute paths (trades log to trade dir) or relative paths (under SERVER_LOG_DIR)
  const isAbs = path.isAbsolute(logTarget);
  const fullPath = isAbs ? logTarget : path.join(SERVER_LOG_DIR, logTarget);
  try {
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(fullPath, line);
  } catch (_) {}
  // Duplicate errors to system/error.log (skip if already writing there)
  if (level === "ERROR" && !isAbs && !logTarget.startsWith("system/error")) {
    try {
      const errPath = path.join(SERVER_LOG_DIR, "system", "error.log");
      const errDir = path.dirname(errPath);
      if (!fs.existsSync(errDir)) fs.mkdirSync(errDir, { recursive: true });
      fs.appendFileSync(errPath, line);
    } catch (_) {}
  }
}

// Scan SERVER_LOG_DIR and return structured source tree with last-modified times
function scanLogSources() {
  const result = {};
  if (!SERVER_LOG_DIR || !fs.existsSync(SERVER_LOG_DIR)) return result;
  const FLAT_SOURCES = new Set(["cron", "api", "ui", "system", "snapshots"]);
  try {
    for (const src of fs.readdirSync(SERVER_LOG_DIR, { withFileTypes: true })) {
      if (!src.isDirectory()) continue;
      const srcName = src.name.toLowerCase();
      const srcPath = path.join(SERVER_LOG_DIR, src.name);
      const sourceEntry = {};

      if (FLAT_SOURCES.has(srcName)) {
        // Flat: files directly in source dir, each file is one "ID"
        for (const f of fs.readdirSync(srcPath, { withFileTypes: true })) {
          if (!f.isFile() || !f.name.endsWith(".log")) continue;
          try {
            const stat = fs.statSync(path.join(srcPath, f.name));
            const key = f.name.replace(/\.log$/, "");
            sourceEntry[key] = {
              files: {
                [key]: {
                  last_modified: stat.mtime.toISOString(),
                  size_bytes: stat.size,
                },
              },
              last_activity: stat.mtime.toISOString(),
            };
          } catch (_) {}
        }
      } else {
        // Hierarchical: subdirectories are IDs, files inside
        for (const sub of fs.readdirSync(srcPath, { withFileTypes: true })) {
          if (!sub.isDirectory()) continue;
          const subPath = path.join(srcPath, sub.name);
          const files = {};
          for (const f of fs.readdirSync(subPath, { withFileTypes: true })) {
            if (!f.isFile() || !f.name.endsWith(".log")) continue;
            try {
              const stat = fs.statSync(path.join(subPath, f.name));
              files[f.name.replace(/\.log$/, "")] = {
                last_modified: stat.mtime.toISOString(),
                size_bytes: stat.size,
              };
            } catch (_) {}
          }
          if (Object.keys(files).length) {
            sourceEntry[sub.name] = {
              files,
              last_activity: getLatestTime(files),
            };
          }
        }
      }
      if (Object.keys(sourceEntry).length) {
        result[srcName] = sourceEntry;
      }
    }
  } catch (_) {}
  return result;
}

function getLatestTime(files) {
  let latest = null;
  for (const info of Object.values(files)) {
    if (!latest || info.last_modified > latest) latest = info.last_modified;
  }
  return latest;
}

// --- NotificationManager (unified notification routing) ---
const DEFAULT_NOTIFICATION_SETTINGS = {
  TRADE_FILLED: {
    toast: true,
    console_log: false,
    ticker: true,
    db_log: true,
    hub: true,
    sound: "TRADE_FILLED",
  },
  TRADE_CLOSED: {
    toast: true,
    console_log: false,
    ticker: true,
    db_log: true,
    hub: true,
    sound: "TRADE_CLOSED",
  },
  SIGNAL_ADDED: {
    toast: true,
    console_log: false,
    ticker: true,
    db_log: true,
    hub: true,
    sound: "NEW_SIGNAL",
  },
  BROKER_POLL: {
    toast: false,
    console_log: false,
    ticker: false,
    db_log: true,
    hub: true,
  },
  BROKER_SYNC: {
    toast: false,
    console_log: false,
    ticker: true,
    db_log: true,
    hub: true,
  },
  SYSTEM_EVENT: {
    toast: false,
    console_log: true,
    ticker: false,
    db_log: true,
    hub: false,
  },
  REMOTE_API_CALL: {
    toast: false,
    console_log: false,
    ticker: false,
    db_log: true,
    hub: false,
  },
  CRON_SNAPSHOT: {
    toast: false,
    console_log: false,
    ticker: true,
    db_log: true,
    hub: true,
    sound: null,
  },
  SNAPSHOT_CREATED: {
    toast: false,
    console_log: false,
    ticker: true,
    db_log: true,
    hub: true,
    sound: null,
  },
};

class NotificationManager {
  constructor() {
    this.settingsCache = new Map();
    this._pool = null;
    this._settingsLoaded = false;
  }

  /** Call after DB pool is ready, e.g. from _mt5InitBackendInternal */
  async init(poolRef) {
    this._pool = poolRef;
    await this.loadSettings();
  }

  /** Load notification_config rows from user_settings into cache */
  async loadSettings() {
    if (!this._pool) return;
    try {
      const { rows } = await this._pool.query(
        `SELECT name, data FROM user_settings WHERE type = 'notification_config'`,
      );
      this.settingsCache.clear();
      for (const row of rows) {
        const eventType = row.name;
        const settings = row.data;
        if (eventType && settings && typeof settings === "object") {
          this.settingsCache.set(eventType, settings);
        }
      }
      this._settingsLoaded = true;
    } catch (e) {
      console.warn("[NotificationManager] loadSettings error:", e.message);
      this._settingsLoaded = true;
    }
  }

  /** Reload settings from DB (called externally after settings change) */
  async reloadSettings() {
    await this.loadSettings();
  }

  /** Get effective settings for an event type (merged with defaults) */
  _getSettings(eventType) {
    const defaults = DEFAULT_NOTIFICATION_SETTINGS[eventType] || {};
    const custom = this.settingsCache.get(eventType) || {};
    return { ...defaults, ...custom };
  }

  /**
   * Route a notification to all enabled channels based on settings for eventType.
   *
   * @param {string} eventType - One of TRADE_ACTIVITY, SIGNAL_ACTIVITY, BROKER_POLL, BROKER_SYNC, SYSTEM_EVENT, REMOTE_API_CALL
   * @param {string} subType - Sub-type like "added", "updated", "deleted", or free-form
   * @param {object} payload - Event payload (user_id, message, type, notification, need_refresh, comp_refresh, action, position, sound, event, etc.)
   */
  handle(eventType, subType, payload = {}, settingsOverride = null) {
    // If settingsOverride is provided (e.g. from Test button), use it directly
    const settings = settingsOverride || this._getSettings(eventType);
    const evName =
      payload.event || `${eventType}${subType ? "_" + subType : ""}`;

    const merged = {
      ...payload,
      event: evName,
      console_log: settings.console_log,
      ticker: settings.ticker,
      hub: settings.hub !== false,
      sound: payload.sound || settings.sound || null,
      notification: payload.notification !== false,
    };

    // 1) console_log channel
    if (settings.console_log) {
      console.log(
        `[NOTIFICATION][${eventType}] ${merged.message || ""}`,
        JSON.stringify(merged),
      );
    }

    // 2) SSE delivery (toast / ticker / sound / hub) + file persistence
    const hasSSE =
      settings.toast ||
      settings.ticker ||
      settings.sound ||
      settings.hub ||
      payload._force_toast ||
      payload._force_ticker ||
      payload._force_sound;
    if (hasSSE) {
      merged.toast = payload._force_toast ? true : settings.toast;
      merged.ticker = payload._force_ticker ? true : settings.ticker;
      merged.sound = merged.sound || settings.sound || null;
      try {
        emitNotification(merged);
      } catch (e) {
        console.warn(
          "[NotificationManager] emitNotification error:",
          e.message,
        );
      }
      // Persist to file for history (appended to end, reads reversed)
      appendNotificationToFile(merged);
    }

    // 3) db_log channel → direct file-based log
    if (settings.db_log || payload._force_db_log) {
      const userId = payload.user_id || null;
      const objectId =
        payload.object_id ||
        payload.position ||
        payload.signal_id ||
        (eventType === "SYSTEM_EVENT"
          ? "system"
          : eventType === "REMOTE_API_CALL"
            ? "api"
            : eventType === "BROKER_POLL" || eventType === "BROKER_SYNC"
              ? "broker"
              : eventType === "CRON_SNAPSHOT"
                ? "cron"
                : eventType === "CHART_SNAPSHOTS"
                  ? "API"
                  : null);
      if (objectId) {
        fileLog(objectId, eventType, payload, userId);
      }
    }
  }
}

const notificationManager = new NotificationManager();

function emitSnapshotCreatedNotification({
  userId = null,
  symbol = "",
  timeframe = "",
  fileName = "",
  reused = false,
} = {}) {
  if (reused) return;
  const sym = normalizeMarketDataSymbol(symbol) || "UNKNOWN";
  const tf = String(timeframe || "").trim();
  notificationManager.handle("CHART_SNAPSHOTS", "created", {
    user_id: userId || null,
    event: "chart_snapshots",
    message: `Snapshot: ${sym}${tf ? ` ${tf}` : ""}`,
    type: "info",
    notification: true,
    need_refresh: false,
    comp_refresh: false,
    action: null,
    sound: null,
    position: "bottom-right",
    symbol: sym,
    timeframe: tf || null,
    file_name: fileName || null,
    broadcast_all: true,
  });
}

// Legacy: keep NOTIFICATION_PULSE for backward compat during migration
const NOTIFICATION_PULSE = { global: 0, user: {} };
function bumpPulse(userId = null, action = "updated", itemType = "general") {
  NOTIFICATION_PULSE.global += 1;
  if (userId && userId !== "default") {
    if (!NOTIFICATION_PULSE.user[userId]) NOTIFICATION_PULSE.user[userId] = {};
    NOTIFICATION_PULSE.user[userId].total =
      (NOTIFICATION_PULSE.user[userId].total || 0) + 1;
    const typeKey = `${itemType}_${action}`;
    NOTIFICATION_PULSE.user[userId][typeKey] = Date.now();
  }
  // Also emit SSE via NotificationManager
  const eventType =
    itemType === "trade"
      ? "TRADE_ACTIVITY"
      : itemType === "signal"
        ? "SIGNAL_ACTIVITY"
        : "SYSTEM_EVENT";
  notificationManager.handle(eventType, action, {
    user_id: userId || null,
    page: null,
    event:
      itemType === "trade"
        ? "trade_added"
        : itemType === "signal"
          ? "signal_added"
          : "system_event",
    message: `${itemType} ${action}`,
    type: "info",
    notification: true,
    need_refresh: false,
    comp_refresh: false,
    action: null,
    sound: itemType === "signal" ? "NEW_SIGNAL" : null,
    position: "bottom-right",
  });
}
const CHART_SNAPSHOT_DIR = path.resolve(GLOBAL_DATA_DIR, "market_data");
const CHART_SNAPSHOT_CLAUDE_MAP_FILE = path.join(
  CHART_SNAPSHOT_DIR,
  ".claude-files.json",
);
const AI_CONTEXT_FILE_DIR = path.resolve(ROOT_DIR, "ai_context_files");
const AI_CONTEXT_CLAUDE_MAP_FILE = path.join(
  AI_CONTEXT_FILE_DIR,
  ".claude-context-files.json",
);
const TRADE_USER =
  String(process.env.MT5_DEFAULT_USER_ID || "default").trim() || "default";
const TRADE_BASE_DIR = path.resolve(GLOBAL_DATA_DIR, TRADE_USER);
const TRADE_FILES_DIR = path.join(TRADE_BASE_DIR, "trade_files");
const TRADE_ACTIVE_DIR = path.join(TRADE_BASE_DIR, "trade_active");
const TRADE_CLOSED_DIR = path.join(TRADE_BASE_DIR, "trade_closed");
// ── Trade Status Constants (single source of truth) ──
const TRADE_STATUS = {
  DRAFT: "Draft",
  PENDING: "PENDING",
  LIVE: "FILLED", // canonical live status
  FILLED: "FILLED", // alias for LIVE
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
  REJECTED: "REJECTED",
};

const BROKER_BARS_DIR = path.resolve(GLOBAL_DATA_DIR, "market_data");

for (const d of [BROKER_BARS_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const TRADE_CATEGORY_DIRS = {
  files: TRADE_FILES_DIR,
  active: TRADE_ACTIVE_DIR,
  closed: TRADE_CLOSED_DIR,
};

for (const d of [TRADE_FILES_DIR, TRADE_ACTIVE_DIR, TRADE_CLOSED_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// Clean up duplicated trade folder names (TFSGP0AFD-BNBUSD-BNBUSD-...)
try {
  for (const catDir of [TRADE_FILES_DIR, TRADE_ACTIVE_DIR, TRADE_CLOSED_DIR]) {
    if (!fs.existsSync(catDir)) continue;
    for (const name of fs.readdirSync(catDir)) {
      // Match folders like SID-SYM-SYM-SYM (symbol repeated at least once)
      const m = name.match(/^([A-Z0-9]{8,12})-([A-Z0-9]+)((?:-[A-Z0-9]+)+)$/);
      if (!m) continue;
      const sid = m[1];
      const sym = m[2];
      const correct = `${sid}-${sym}`;
      if (correct === name) continue;
      const src = path.join(catDir, name);
      const dst = path.join(catDir, correct);
      try {
        if (!fs.statSync(src).isDirectory()) continue;
        if (fs.existsSync(dst)) {
          // Merge: copy contents from src to dst
          for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            const s = path.join(src, entry.name);
            const d = path.join(dst, entry.name);
            if (!fs.existsSync(d)) fs.cpSync(s, d, { recursive: true });
          }
          fs.rmSync(src, { recursive: true });
        } else {
          fs.renameSync(src, dst);
        }
        console.log("[trade-folder] deduplicated:", name, "->", correct);
      } catch (e) {
        console.error("[trade-folder] dedup error:", name, e.message);
      }
    }
  }
} catch (_) {}

// File-based chart objects: read/write to trades/{sid}/chart_objects.json
function chartObjectsPath(sid, symbol = "") {
  const dir = resolveTradeDirForCreate(sid, symbol, "files");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "chart_objects.json");
}

const ANTHROPIC_FILES_BETA = "files-api-2025-04-14";

// Toggle: upload context files + snapshots to Claude Files API (file_id refs)
// false = use base64 inline images + text blocks (no Claude Files dependency)
const UPLOAD_TO_CLAUDE = false;

function readDiskStats(mountPath = "/") {
  try {
    const out = execFileSync("df", ["-Pk", mountPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = String(out || "")
      .trim()
      .split(/\r?\n/);
    const row = String(lines[lines.length - 1] || "")
      .trim()
      .split(/\s+/);
    if (row.length < 6) return null;
    const totalKb = Number(row[1] || 0);
    const usedKb = Number(row[2] || 0);
    const availKb = Number(row[3] || 0);
    const usePctRaw = String(row[4] || "").replace("%", "");
    const mount = String(row[5] || mountPath);
    return {
      mount,
      total_bytes: Number.isFinite(totalKb) ? totalKb * 1024 : null,
      used_bytes: Number.isFinite(usedKb) ? usedKb * 1024 : null,
      avail_bytes: Number.isFinite(availKb) ? availKb * 1024 : null,
      use_pct: Number.isFinite(Number(usePctRaw)) ? Number(usePctRaw) : null,
    };
  } catch {
    return null;
  }
}

function readPathSizeBytes(absPath) {
  try {
    if (!absPath || !fs.existsSync(absPath)) return 0;
    const out = execFileSync("du", ["-sk", absPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const kb = Number(
      String(out || "")
        .trim()
        .split(/\s+/)[0] || 0,
    );
    return Number.isFinite(kb) ? kb * 1024 : 0;
  } catch {
    return 0;
  }
}

function cleanupSystemStorageArtifacts() {
  const before = readDiskStats("/") || {};
  const report = {
    actions: [],
    warnings: [],
    before,
  };
  const addAction = (name, ok, detail = "") => {
    report.actions.push({
      name,
      ok: Boolean(ok),
      detail: String(detail || ""),
    });
  };

  // 1) Flush PM2 logs
  try {
    const r = spawnSync("pm2", ["flush"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 20000,
    });
    addAction(
      "pm2_flush",
      r.status === 0,
      r.status === 0 ? "ok" : String(r.stderr || r.stdout || "failed"),
    );
  } catch (e) {
    addAction("pm2_flush", false, String(e?.message || e));
  }

  // 2) Truncate PostgreSQL file logs if present
  try {
    const pgDir = "/var/log/postgresql";
    let truncated = 0;
    if (fs.existsSync(pgDir)) {
      const files = fs
        .readdirSync(pgDir)
        .filter((f) => /\.log(\.\d+)?$/i.test(f));
      for (const fileName of files) {
        const abs = path.join(pgDir, fileName);
        try {
          fs.truncateSync(abs, 0);
          truncated += 1;
        } catch {
          const run = spawnSync(
            "sudo",
            ["-u", "postgres", "truncate", "-s", "0", abs],
            {
              stdio: ["ignore", "pipe", "pipe"],
              encoding: "utf8",
              timeout: 15000,
            },
          );
          if (run.status === 0) truncated += 1;
        }
      }
    }
    addAction("postgres_logs_truncate", true, `files=${truncated}`);
  } catch (e) {
    addAction("postgres_logs_truncate", false, String(e?.message || e));
  }

  // 3) Apt cache cleanup
  try {
    const r = spawnSync("apt-get", ["clean"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 30000,
    });
    addAction(
      "apt_clean",
      r.status === 0,
      r.status === 0 ? "ok" : String(r.stderr || r.stdout || "failed"),
    );
  } catch (e) {
    addAction("apt_clean", false, String(e?.message || e));
  }

  // 4) Remove npm cache blobs
  try {
    const cacheDir = "/root/.npm/_cacache";
    if (fs.existsSync(cacheDir))
      fs.rmSync(cacheDir, { recursive: true, force: true });
    addAction(
      "npm_cache_cleanup",
      true,
      fs.existsSync(cacheDir) ? "partial" : "ok",
    );
  } catch (e) {
    addAction("npm_cache_cleanup", false, String(e?.message || e));
  }

  // 5) Remove stale /tmp files (>2d)
  try {
    const now = Date.now();
    const tmpDir = "/tmp";
    let removed = 0;
    if (fs.existsSync(tmpDir)) {
      const entries = fs.readdirSync(tmpDir);
      for (const name of entries) {
        const abs = path.join(tmpDir, name);
        try {
          const st = fs.statSync(abs);
          const ageMs = now - Number(st.mtimeMs || now);
          if (ageMs > 2 * 24 * 60 * 60 * 1000) {
            fs.rmSync(abs, { recursive: true, force: true });
            removed += 1;
          }
        } catch {}
      }
    }
    addAction("tmp_cleanup", true, `removed=${removed}`);
  } catch (e) {
    addAction("tmp_cleanup", false, String(e?.message || e));
  }

  // 6) Prune old chart snapshots (>14d)
  try {
    let removed = 0;
    if (fs.existsSync(CHART_SNAPSHOT_DIR)) {
      const now = Date.now();
      const files = fs.readdirSync(CHART_SNAPSHOT_DIR);
      for (const fileName of files) {
        const abs = path.join(CHART_SNAPSHOT_DIR, fileName);
        try {
          const st = fs.statSync(abs);
          const ageMs = now - Number(st.mtimeMs || now);
          if (ageMs > 14 * 24 * 60 * 60 * 1000) {
            fs.unlinkSync(abs);
            removed += 1;
          }
        } catch {}
      }
    }
    addAction("old_snapshots_prune", true, `removed=${removed}`);
  } catch (e) {
    addAction("old_snapshots_prune", false, String(e?.message || e));
  }

  const after = readDiskStats("/") || {};
  report.after = after;
  if (
    Number.isFinite(before?.avail_bytes) &&
    Number.isFinite(after?.avail_bytes)
  ) {
    report.freed_bytes = Math.max(
      0,
      Number(after.avail_bytes) - Number(before.avail_bytes),
    );
  } else {
    report.freed_bytes = null;
  }
  return report;
}

const CFG = {
  port: asNum(process.env.PORT, 80),
  httpsEnabled: asBool(process.env.HTTPS_ENABLED, false),
  httpsPort: asNum(process.env.HTTPS_PORT, 443),
  httpsKeyPath: envStr(process.env.HTTPS_KEY_PATH),
  httpsCertPath: envStr(process.env.HTTPS_CERT_PATH),
  httpsCaPath: envStr(process.env.HTTPS_CA_PATH),
  httpsRedirectHttp: asBool(process.env.HTTPS_REDIRECT_HTTP, true),
  signalApiKey: envStr(process.env.SIGNAL_API_KEY),
  adminKey: envStr(process.env.ADMIN_KEY || process.env.SIGNAL_API_KEY),

  telegramBotToken: envStr(process.env.TELEGRAM_BOT_TOKEN),
  telegramChatId: envStr(process.env.TELEGRAM_CHAT_ID),

  allowSymbols: envStr(process.env.ALLOW_SYMBOLS)
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),

  binanceEnabled: !!envStr(process.env.BINANCE_MODE),
  binanceEnabled: !!envStr(process.env.BINANCE_MODE),
  binanceMode: envStr(process.env.BINANCE_MODE).toLowerCase(),
  binanceProduct: envStr(process.env.BINANCE_PRODUCT, "spot").toLowerCase(),
  binanceApiKey: envStr(process.env.BINANCE_API_KEY),
  binanceApiSecret: envStr(process.env.BINANCE_API_SECRET),
  binanceRecvWindow: asNum(process.env.BINANCE_RECV_WINDOW, 5000),
  binanceDefaultQty: asNum(process.env.BINANCE_DEFAULT_QTY, NaN),
  binanceDefaultQuoteQty: asNum(process.env.BINANCE_DEFAULT_QUOTE_QTY, NaN),

  ctraderEnabled: !!envStr(process.env.CTRADER_MODE),
  ctraderEnabled: !!envStr(process.env.CTRADER_MODE),
  ctraderMode: envStr(process.env.CTRADER_MODE).toLowerCase(),
  ctraderExecutorUrl: envStr(process.env.CTRADER_EXECUTOR_URL),
  ctraderExecutorApiKey: envStr(process.env.CTRADER_EXECUTOR_API_KEY),
  ctraderClientId: envStr(process.env.CTRADER_CLIENT_ID),
  ctraderSecret: envStr(process.env.CTRADER_SECRET),

  maxRiskPct: asNum(process.env.MAX_RISK_PCT, NaN),

  // MT5 bridge (merged into this same server.js)
  mt5Enabled: asBool(process.env.MT5_ENABLED, true),
  mt5Storage: "postgres",
  mt5TvAlertApiKeys: parseKeySet(process.env.MT5_TV_ALERT_API_KEYS),
  mt5TvWebhookTokens: parseKeySet(
    process.env.MT5_TV_WEBHOOK_TOKENS || process.env.TV_WEBHOOK_TOKENS,
  ),
  mt5EaApiKeys: parseKeySet(process.env.MT5_EA_API_KEYS),
  mt5AuthAllowLegacyPayloadKey: asBool(
    process.env.MT5_AUTH_ALLOW_LEGACY_PAYLOAD_KEY,
    true,
  ),
  mt5AuthAllowLegacyQueryKey: asBool(
    process.env.MT5_AUTH_ALLOW_LEGACY_QUERY_KEY,
    true,
  ),
  mt5V2DualWriteEnabled: asBool(process.env.MT5_V2_DUAL_WRITE_ENABLED, false),
  mt5V2BrokerApiEnabled: asBool(process.env.MT5_V2_BROKER_API_ENABLED, true),
  mt5V2LeaseSeconds: asNum(process.env.MT5_V2_LEASE_SECONDS, 30),
  mt5V2BrokerPullMaxAgeHours: asNum(
    process.env.MT5_V2_BROKER_PULL_MAX_AGE_HOURS,
    24,
  ),
  mt5DefaultLot: asNum(process.env.MT5_DEFAULT_LOT, 0.01),
  mt5DefaultUserId: envStr(process.env.MT5_DEFAULT_USER_ID, "default"),
  mt5PruneEnabled: asBool(process.env.MT5_PRUNE_ENABLED, true),
  mt5PruneDays: asNum(process.env.MT5_PRUNE_DAYS, 14),
  mt5PruneIntervalMinutes: asNum(process.env.MT5_PRUNE_INTERVAL_MINUTES, 60),
  twelveDataApiKey: envStr(process.env.TWELVE_DATA_API_KEY),
  mt5PostgresUrl:
    envStr(process.env.MT5_POSTGRES_URL) ||
    envStr(process.env.POSTGRES_URL) ||
    envStr(process.env.POSTGRE_URL),
  mt5StorageBackend: envStr(process.env.MT5_STORAGE, "postgres"),
  mt5SqlitePath: envStr(process.env.MT5_SQLITE_PATH, "db/trading.db"),
  redisEnabled: asBool(process.env.REDIS_ENABLED, true),
  redisUrl: envStr(process.env.REDIS_URL, "redis://127.0.0.1:6379"),
  marketDataCronEnabled: true, // always enabled — toggled per-cron via status field
  snapshotsCronEnabled: true, // always enabled — toggled per-cron via status field
  marketDataCronQueueEnabled: asBool(
    process.env.MARKET_DATA_CRON_QUEUE_ENABLED,
    true,
  ),
  marketDataCronConcurrency: Math.max(
    1,
    Math.min(
      16,
      Math.round(asNum(process.env.MARKET_DATA_CRON_CONCURRENCY, 4)),
    ),
  ),
  marketDataCronBatchSize: Math.max(
    1,
    Math.min(50, Math.round(asNum(process.env.MARKET_DATA_CRON_BATCH_SIZE, 8))),
  ),
  marketDataChunkMaxBars: Math.max(
    50,
    Math.min(
      1000,
      Math.round(asNum(process.env.MARKET_DATA_CHUNK_MAX_BARS, 500)),
    ),
  ),
  marketDataDefaultTimezone: envStr(
    process.env.MARKET_DATA_DEFAULT_TIMEZONE,
    "America/New_York",
  ),
  uiAuthEnabled: asBool(process.env.UI_AUTH_ENABLED, true),
  uiBootstrapEmail: envStr(
    process.env.UI_BOOTSTRAP_EMAIL,
    "hung.hoxuan@gmail.com",
  ).toLowerCase(),
  uiBootstrapPassword: envStr(
    process.env.UI_BOOTSTRAP_PASSWORD,
    "BceTzkUuznrX7WDLTODBh077",
  ),
  uiSessionTtlSeconds: asNum(
    process.env.UI_SESSION_TTL_SECONDS,
    60 * 60 * 24 * 7,
  ),
};

// ── App Config (in-memory cache, hot-reload safe via delete require.cache) ──
let _APP_CONFIG = null;
let _APP_CONFIG_MTIME = 0;
function getAppConfig() {
  try {
    const p = require("path").join(ROOT_DIR, "..", "config", "config.json");
    const st = require("fs").statSync(p);
    const mtime = Number(st.mtimeMs || 0);
    if (!_APP_CONFIG || mtime > _APP_CONFIG_MTIME) {
      delete require.cache[require.resolve("../config/config.json")];
      _APP_CONFIG = require("../config/config.json");
      _APP_CONFIG_MTIME = mtime;
    }
    return _APP_CONFIG;
  } catch (e) {
    console.warn("[config] config.json load failed, using empty");
    return {};
  }
}

const AI_SCHEMA_SPEC = (() => {
  try {
    const planSchema = require("../config/schema/trade.json");
    try {
      const analysisSchema = require("../config/schema/analysis.json");
      planSchema.analysis = analysisSchema;
    } catch {
      /* analysis.json optional */
    }
    return {
      version: "3.1",
      schema: [planSchema],
    };
  } catch (e) {
    console.warn("[schema] system.json not found");
    return { version: "3.1", schema: [{}] };
  }
})();
const AI_RESPONSE_SCHEMA_VERSION = String(AI_SCHEMA_SPEC.version || "3.0");
const AI_RESPONSE_SCHEMA = AI_SCHEMA_SPEC.schema || {};

// Legacy checklist bank kept for reference
const AI_CHECKLIST_BANK = [];

function buildAiSchemaPromptText() {
  return `You are an expert ICT technical analyst.
Respond ONLY in valid minified JSON matching schema exactly. No prose, markdown, or trailing commas.
All fields required. Enums must match. Use null only where price data is unavailable.
Array limits: htf_context<=2, ltf_analysis<=2, pd_arrays<=6/tf, key_levels<=6, reference_zones<=6.
Trade plans must be actionable and internally consistent.
IMPORTANT: You MUST include execution_plan with entry, stop_loss, tp1/tp2/tp3 populated. Never return empty execution_plan.
schema_version=${AI_RESPONSE_SCHEMA_VERSION}
SCHEMA=${JSON.stringify(AI_RESPONSE_SCHEMA)}`;
}

CFG.binanceEnabled = ["paper", "live"].includes(CFG.binanceMode);
CFG.ctraderEnabled = ["demo", "live"].includes(CFG.ctraderMode);

// Convenience fallback: if MT5 keys are not set, reuse SIGNAL_API_KEY.
if (CFG.signalApiKey) {
  if (CFG.mt5TvAlertApiKeys.size === 0) {
    CFG.mt5TvAlertApiKeys = new Set([CFG.signalApiKey]);
  }
  if (CFG.mt5EaApiKeys.size === 0) {
    CFG.mt5EaApiKeys = new Set([CFG.signalApiKey]);
  }
  if (CFG.mt5TvWebhookTokens.size === 0) {
    CFG.mt5TvWebhookTokens = new Set([CFG.signalApiKey]);
  }
}

// Standard 9-char SID generator: [TimePart (6)] + [RandomPart (3)]
function mt5GenerateTimeSid() {
  const seconds = Math.floor(Date.now() / 1000)
    .toString(36)
    .toUpperCase();
  const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
  return (seconds + rand).padEnd(9, "X").substring(0, 9);
}

// Deprecated: use mt5GenerateTimeSid
function mt5GenerateId(prefix = "ID") {
  return mt5GenerateTimeSid();
}

function mt5NormalizeSymbol(s) {
  const val = typeof s === "string" ? s : s?.symbol || s?.s || "";
  return String(val)
    .toUpperCase()
    .replace(/[\/\-\_\.]/g, "")
    .trim();
}

async function mt5Log(objectId, objectTable, metadata = {}, userId = null) {
  // Route through NotificationManager for matching event types (handles db_log + SSE)
  let eventType = null;
  if (notificationManager && metadata?.event) {
    const ev = String(metadata.event || "").toUpperCase();
    let subType = "";
    if (
      ev === "TRADE_FILLED" ||
      ev === "TRADE_SYNC_UPDATE" ||
      ev === "SL_CHANGED" ||
      ev === "PARTIAL_CLOSE"
    ) {
      eventType = "TRADE_FILLED";
      subType = ev.toLowerCase();
    } else if (ev === "TRADE_CLOSED" || ev === "TRADE_CLOSE") {
      eventType = "TRADE_CLOSED";
      subType = "closed";
    } else if (ev.startsWith("SIGNAL_")) {
      eventType = "SIGNAL_ADDED";
      subType = ev.replace("SIGNAL_", "").toLowerCase();
    } else if (ev === "PRICE_PUSH") {
      eventType = "BROKER_POLL";
      subType = "price_push";
    }
    if (eventType) {
      try {
        notificationManager.handle(eventType, subType, {
          object_id: objectId,
          object_table: objectTable,
          user_id: userId || null,
          message: metadata.event || "",
          ...metadata,
        });
      } catch (e) {
        // Log failed — still record as error
        notificationManager.handle(eventType, subType, {
          object_id: objectId,
          object_table: objectTable,
          user_id: userId || null,
          message: metadata.event || "",
          status: "ERROR",
          error: e.message || String(e),
          ...metadata,
        });
      }
    }
  }
  fileLog(objectId, objectTable, metadata, userId);
  // If this EA event is about a specific trade, also log to trade folder
  const tradeSid = metadata.signal_id || metadata.trade_id;
  if (tradeSid) fileLog(tradeSid, "ea_to_trade", metadata, userId);
}

function json(res, statusCode, data) {
  if (!res || res.destroyed || res.writableEnded) return false;
  const body = JSON.stringify(data);
  try {
    if (!res.headersSent) {
      res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
      });
    }
    if (!res.writableEnded && !res.destroyed) {
      res.end(body);
      return true;
    }
  } catch {
    // Ignore write-after-end or socket-closed races on aborted/malformed requests.
  }
  return false;
}

const UI_SESSIONS = new Map();
const UI_ROLE_SYSTEM = "System";
const MARKET_DATA_MEMORY_CACHE = new Map();
const MARKET_DATA_TF_CACHE = new Map(); // key: "EURUSD_4H" → { bars, bar_start, bar_end, last_price, created_at, snapshot }

// ── Trace ID generation ──────────────────────────────────────────
function genTraceId(prefix = "") {
  return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function tfCacheKey(symbol, tf) {
  return `${String(symbol).toUpperCase()}_${String(tf).toUpperCase()}`;
}
function tfToMs(tf) {
  const t = String(tf).toUpperCase();
  const s = {
    D: 86400000,
    "1D": 86400000,
    "1DAY": 86400000,
    W: 604800000,
    "1W": 604800000,
    "1WEEK": 604800000,
    "4H": 14400000,
    "1H": 3600000,
    "15M": 900000,
    "15MIN": 900000,
    "5M": 300000,
    "5MIN": 300000,
    "1M": 60000,
    "1MIN": 60000,
    MN: 2592000000,
    "1MN": 2592000000,
    "1MONTH": 2592000000,
  };
  return (
    s[t] ||
    (() => {
      const m = t.match(/^(\d+)(MIN|H|DAY|WEEK|MONTH|M)$/);
      if (m) {
        const n = Number(m[1]);
        const u = m[2];
        if (u === "MIN" || u === "M") return n * 60000;
        if (u === "H") return n * 3600000;
        if (u === "DAY") return n * 86400000;
        if (u === "WEEK") return n * 604800000;
        if (u === "MONTH") return n * 2592000000;
      }
      return 3600000;
    })()
  );
}
function tfToMinutesForHierarchy(tf) {
  const t = String(tf || "").toUpperCase();
  if (t === "1M") return 1;
  if (t === "5M" || t === "5MIN") return 5;
  if (t === "15M" || t === "15MIN") return 15;
  if (t === "1H" || t === "60") return 60;
  if (t === "4H" || t === "240") return 240;
  if (t === "D" || t === "1D" || t === "DAY") return 1440;
  if (t === "W" || t === "1W" || t === "WEEK") return 10080;
  if (t === "MN" || t === "1MN" || t === "1MONTH") return 43200;
  return null;
}
async function propagateLowerTfToHigherTfCache(symbol, srcTf, snapshot) {
  try {
    const bars = Array.isArray(snapshot?.bars) ? snapshot.bars : [];
    if (!bars.length) return;
    const last = bars[bars.length - 1] || {};
    const srcMin = tfToMinutesForHierarchy(srcTf);
    const hi = Number(last.high);
    const lo = Number(last.low);
    const cl = Number(last.close);
    const tm = Number(last.time);
    if (
      !Number.isFinite(srcMin) ||
      !Number.isFinite(hi) ||
      !Number.isFinite(lo)
    )
      return;
    const targets = ["15M", "1H", "4H", "D", "W", "MN"];
    for (const tgt of targets) {
      const tgtMin = tfToMinutesForHierarchy(tgt);
      if (!Number.isFinite(tgtMin) || tgtMin <= srcMin) continue;
      const existing = await tfCacheGet(symbol, tgt);
      if (!existing || !Array.isArray(existing.bars) || !existing.bars.length)
        continue;
      const next = { ...existing, bars: [...existing.bars] };
      const idx = next.bars.length - 1;
      const b = { ...(next.bars[idx] || {}) };
      const bHigh = Number(b.high);
      const bLow = Number(b.low);
      b.high = Number.isFinite(bHigh) ? Math.max(bHigh, hi) : hi;
      b.low = Number.isFinite(bLow) ? Math.min(bLow, lo) : lo;
      if (Number.isFinite(cl)) b.close = cl;
      b.synthetic_recent = true;
      b.synthetic_source_tf = String(srcTf || "").toUpperCase();
      if (Number.isFinite(tm)) b.synthetic_source_time = tm;
      next.bars[idx] = b;
      next.bar_end = b.time || next.bar_end;
      next.last_price = Number.isFinite(cl) ? cl : next.last_price;
      next.cache_source = next.cache_source || "memory";
      next.synthetic_recent = {
        source_tf: String(srcTf || "").toUpperCase(),
        high: hi,
        low: lo,
        close: Number.isFinite(cl) ? cl : null,
        time: Number.isFinite(tm) ? tm : null,
      };
      await tfCacheSet(symbol, tgt, { ...next, _skip_propagate: true });
    }
  } catch (_) {}
}
async function tfCacheGet(symbol, tf) {
  const key = tfCacheKey(symbol, tf);
  const e = MARKET_DATA_TF_CACHE.get(key);
  if (e) {
    if (Date.now() - e.created_at > tfToMs(tf)) {
      MARKET_DATA_TF_CACHE.delete(key);
    } else {
      return e;
    }
  }
  // Fallback to Redis
  try {
    if (CFG.redisEnabled) {
      const client = await getRedisClient();
      if (client) {
        const raw = await client.get(`tf:${key}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Date.now() - parsed.created_at <= tfToMs(tf)) {
            MARKET_DATA_TF_CACHE.set(key, parsed); // promote to L1
            return parsed;
          }
        }
      }
    }
  } catch (_) {}
  return null;
}
async function tfCacheSet(symbol, tf, data) {
  const key = tfCacheKey(symbol, tf);
  const entry = { ...data, created_at: Date.now() };
  MARKET_DATA_TF_CACHE.set(key, entry);
  // Write to Redis for persistence across restarts
  try {
    if (CFG.redisEnabled) {
      const client = await getRedisClient();
      if (client) {
        await client.set(`tf:${key}`, JSON.stringify(entry), {
          EX: Math.ceil(tfToMs(tf) / 1000),
        });
      }
    }
  } catch (_) {}
  if (!data?._skip_propagate) {
    await propagateLowerTfToHigherTfCache(
      String(symbol || "").toUpperCase(),
      String(tf || "").toUpperCase(),
      { bars: Array.isArray(data?.bars) ? data.bars : [] },
    );
  }
}

/**
 * Multi-Tiered Cache Utility (Memory -> Redis -> Fallback)
 */
const UnifiedCache = {
  pendingFetches: new Map(),

  async get(key, options = {}) {
    const { l1Map, l2Prefix, ttlSec, validator, onHitL2, fallback } = options;
    const now = Date.now();

    // 1. L1 Memory
    if (l1Map) {
      const val = l1Map.get(key);
      if (val && Number(val.expires_at_ms || 0) > now) {
        if (!validator || validator(val.data)) return val.data;
      }
    }

    // 2. L2 Redis
    if (CFG.redisEnabled && l2Prefix) {
      try {
        const client = await getRedisClient();
        if (client) {
          const fullKey = `${l2Prefix}:${key}`;
          const cached = await client.get(fullKey);
          if (cached) {
            const data = JSON.parse(cached);
            if (!validator || validator(data)) {
              if (onHitL2) onHitL2(data);
              if (l1Map)
                l1Map.set(key, { data, expires_at_ms: now + ttlSec * 1000 });
              return data;
            }
          }
        }
      } catch (e) {}
    }

    // 3. Fallback (DB or API) with Request Collapsing
    if (fallback) {
      const fetchKey = l2Prefix ? `${l2Prefix}:${key}` : key;
      if (this.pendingFetches.has(fetchKey)) {
        return await this.pendingFetches.get(fetchKey);
      }

      const fetchPromise = (async () => {
        try {
          const data = await fallback();
          if (data !== undefined && (!validator || validator(data))) {
            await this.set(key, data, options);
            return data;
          }
          return null;
        } finally {
          this.pendingFetches.delete(fetchKey);
        }
      })();

      this.pendingFetches.set(fetchKey, fetchPromise);
      return await fetchPromise;
    }

    return null;
  },

  async set(key, data, options = {}) {
    const { l1Map, l2Prefix, ttlSec } = options;
    const now = Date.now();
    const expires_at_ms = now + ttlSec * 1000;

    if (l1Map) l1Map.set(key, { data, expires_at_ms });

    if (CFG.redisEnabled && l2Prefix) {
      const client = await getRedisClient();
      if (client) {
        const fullKey = `${l2Prefix}:${key}`;
        await client
          .set(fullKey, JSON.stringify(data), { EX: ttlSec })
          .catch(() => {});
      }
    }
  },
};
const MARKET_DATA_MEMORY_MAX_KEYS = 500;

/**
 * StateRepo: Standardized Bucket Repository
 * Centrally manages Cache Key patterns, Prefixes, and TTLs.
 */
const StateRepo = {
  BUCKETS: {
    SYSTEM_SETTINGS: { prefix: "SYS:CFG", ttl: 3600 * 24 }, // 1 day
    USER_PROFILE: { prefix: "USR:PRO", ttl: 3600 * 12 }, // 12 hours
    USER_ACCOUNTS: { prefix: "USR:ACC", ttl: 3600 * 1 }, // 1 hour
    USER_WATCHLIST: { prefix: "USR:WTL", ttl: 3600 * 24 }, // 1 day
    USER_TEMPLATES: { prefix: "USR:TPL", ttl: 3600 * 6 }, // 6 hours
    SIGNALS_PENDING: { prefix: "SIG:PEN", ttl: 600 }, // 10 mins (dynamic)
    MARKET_LATEST: { prefix: "MKT:LAT", ttl: 300 }, // 5 mins
    MARKET_DATA_UNIFIED: { prefix: "MARKET_DATA", ttl: 3600 }, // 1 hour unified symbol cache
    SIGNAL_DETAIL: { prefix: "SIG:DET", ttl: 3600 * 24 }, // 1 day
    TRADE_DETAIL: { prefix: "TRD:DET", ttl: 3600 * 24 }, // 1 day
    TRADE_LIST: { prefix: "TRD:LST", ttl: 30 }, // 30 seconds (dynamic, short TTL)
    USER_SETTINGS: { prefix: "USR:SET", ttl: 3600 * 6 }, // 6 hours
    NEWS_CALENDAR: { prefix: "NEWS:CAL", ttl: 3600 },
  },

  getL1Map(bucketName) {
    if (bucketName === "MARKET_LATEST" || bucketName === "MARKET_DATA_UNIFIED")
      return MARKET_DATA_MEMORY_CACHE;
    return null; // Shared L1 not strictly needed for non-high-frequency keys yet
  },

  async get(bucketKey, id, fallback) {
    const bucket = this.BUCKETS[bucketKey];
    if (!bucket) throw new Error(`Unknown bucket: ${bucketKey}`);

    return await UnifiedCache.get(id, {
      l1Map: this.getL1Map(bucketKey),
      l2Prefix: bucket.prefix,
      ttlSec: bucket.ttl,
      fallback,
    });
  },

  async set(bucketKey, id, data) {
    const bucket = this.BUCKETS[bucketKey];
    if (!bucket) throw new Error(`Unknown bucket: ${bucketKey}`);

    return await UnifiedCache.set(id, data, {
      l1Map: this.getL1Map(bucketKey),
      l2Prefix: bucket.prefix,
      ttlSec: bucket.ttl,
    });
  },

  async del(bucketKey, id) {
    const bucket = this.BUCKETS[bucketKey];
    if (!bucket) return;

    // Clear L1
    const l1 = this.getL1Map(bucketKey);
    if (l1) l1.delete(id);

    // Clear L2
    if (CFG.redisEnabled) {
      const client = await getRedisClient();
      if (client) await client.del(`${bucket.prefix}:${id}`).catch(() => {});
    }
  },

  // Clear ALL keys for a bucket (used when underlying data is wiped)
  async flushBucket(bucketKey) {
    const bucket = this.BUCKETS[bucketKey];
    if (!bucket) return;
    // Clear L1: iterate and delete all matching keys
    const l1 = this.getL1Map(bucketKey);
    if (l1 instanceof Map) {
      for (const key of l1.keys()) {
        if (key.startsWith(`${bucket.prefix}:`)) l1.delete(key);
      }
    }
    // Clear L2: Redis SCAN + DEL (best-effort)
    if (CFG.redisEnabled) {
      try {
        const client = await getRedisClient();
        if (!client) return;
        let cursor = "0";
        do {
          const [nextCursor, keys] = await client.scan(
            cursor,
            "MATCH",
            `${bucket.prefix}:*`,
            "COUNT",
            100,
          );
          cursor = nextCursor;
          if (keys.length) await client.del(keys).catch(() => {});
        } while (cursor !== "0");
      } catch {}
    }
  },
};

/**
 * StateRepo Loaders (Eager & Lazy)
 */
async function repoGetSystemSettings() {
  return await StateRepo.get("SYSTEM_SETTINGS", "global", async () => {
    const db = await mt5InitBackend();
    const raw = await dbQueries.getUserSettingData(
      db.db,
      CFG.mt5DefaultUserId,
      "api_key",
      "default",
    );
    try {
      return decryptObject(raw);
    } catch {
      return raw;
    }
  });
}

async function refreshEconomicCalendar() {
  try {
    // ForexFactory JSON feed ( industry standard )
    const url = "https://nfs.forexfactory.com/ff_calendar_thisweek.json";
    const resp = await fetch(url, { timeout: 10000 }).catch(() => null);
    if (!resp || !resp.ok) return;

    const data = await resp.json();
    if (!Array.isArray(data)) return;

    // Filter for today's high impact events
    const today = new Date().toISOString().split("T")[0];
    const filtered = data.filter((item) => {
      // item.date format is usually "MM-DD-YYYY"
      const dateParts = item.date.split("-");
      if (dateParts.length !== 3) return false;
      const itemDate = `${dateParts[2]}-${dateParts[0]}-${dateParts[1]}`;

      return itemDate === today && item.impact === "High";
    });

    await StateRepo.set("NEWS_CALENDAR", "today", filtered);

    console.log(
      `[news] Refreshed economic calendar: ${filtered.length} high-impact events today.`,
    );
  } catch (e) {
    console.error("[news] Failed to refresh economic calendar:", e.message);
  }
}

// Start news worker
setInterval(refreshEconomicCalendar, 3600000); // Hourly
setTimeout(refreshEconomicCalendar, 5000); // Initial boot

async function repoGetUserAccounts(userId) {
  return await StateRepo.get("USER_ACCOUNTS", userId, async () => {
    const db = await mt5InitBackend();
    return await dbQueries.listUserAccounts(db.db, userId);
  });
}

/**
 * Unified Market Data Upsert (Read-Modify-Write)
 * Consolidates all timeframes and analysis for a symbol into a single cache key.
 */
async function repoUpsertUnifiedMarketData(symbol, tf, dataUpdate) {
  const symbolNorm = normalizeMarketDataSymbol(symbol);
  if (!symbolNorm) return null;

  // Read-Modify-Write pattern
  let current = (await StateRepo.get("MARKET_DATA_UNIFIED", symbolNorm)) || {};
  if (!current.symbol) current.symbol = symbolNorm;
  if (!Array.isArray(current.data)) current.data = [];
  if (!current.updated_time) current.updated_time = 0;

  const tfNorm = normalizeMarketDataTf(tf);
  const existingIdx = current.data.findIndex(
    (d) => normalizeMarketDataTf(d.tf) === tfNorm,
  );
  const existingSnapshot =
    existingIdx >= 0 ? current.data[existingIdx]?.snapshot : null;

  const timeframeData = {
    tf: tfNorm,
    market_analysis:
      dataUpdate.market_analysis ||
      dataUpdate.metadata ||
      dataUpdate.summary ||
      null,
    snapshot: dataUpdate.snapshot
      ? { ...(existingSnapshot || {}), ...dataUpdate.snapshot }
      : existingSnapshot || null,
    bars: Array.isArray(dataUpdate.bars) ? dataUpdate.bars : [],
    last_price:
      dataUpdate.last_price ??
      (Array.isArray(dataUpdate.bars) && dataUpdate.bars.length
        ? dataUpdate.bars[dataUpdate.bars.length - 1]?.close
        : null),
    last_price_at:
      dataUpdate.last_price_at ??
      (Array.isArray(dataUpdate.bars) && dataUpdate.bars.length
        ? dataUpdate.bars[dataUpdate.bars.length - 1]?.time
        : null),
  };

  // Update or Add timeframe (reuse existingIdx from above)
  if (existingIdx >= 0) {
    current.data[existingIdx] = timeframeData;
  } else {
    current.data.push(timeframeData);
  }

  // Global metadata calculation
  current.updated_time = Date.now();
  let minStart = Infinity;
  let maxEnd = 0;
  for (const d of current.data) {
    if (d.bars && d.bars.length) {
      const s = Number(d.bars[0].time);
      const e = Number(d.bars[d.bars.length - 1].time);
      if (s < minStart) minStart = s;
      if (e > maxEnd) maxEnd = e;
    }
  }

  if (minStart !== Infinity) {
    current.bar_start = minStart;
    current.bar_end = maxEnd;
    try {
      const startStr = new Date(minStart * 1000).toISOString().slice(11, 16);
      const endStr = new Date(maxEnd * 1000).toISOString().slice(11, 16);
      current.utc_time_range = `${startStr}-${endStr}`;
    } catch (e) {
      current.utc_time_range = "unknown";
    }
  }

  // Persist back to L1 and L2
  await StateRepo.set("MARKET_DATA_UNIFIED", symbolNorm, current);
  return current;
}

async function repoGetPendingSignals(userId = "all") {
  return []; // signals table removed
}

async function repoGetUserWatchlist(userId) {
  return await StateRepo.get("USER_WATCHLIST", userId, async () => {
    const db = await mt5InitBackend();
    const meta = await dbQueries.getUserMetadata(db.db, userId);
    const d = dbQueries.parseJsonField(meta);
    return d?.watchlist || [];
  });
}

async function repoGetUserTemplates(userId) {
  return await StateRepo.get("USER_TEMPLATES", userId, async () => {
    const db = await mt5InitBackend();
    const rows = await db.db
      .select({
        templateId: schema.userTemplates.id,
        name: schema.userTemplates.name,
        data: schema.userTemplates.data,
      })
      .from(schema.userTemplates)
      .where(eq(schema.userTemplates.userId, userId))
      .orderBy(
        desc(schema.userTemplates.updatedAt),
        desc(schema.userTemplates.createdAt),
      );
    return rows.map((r) => ({
      template_id: r.templateId,
      name: r.name,
      ...dbQueries.parseJsonField(r.data),
    }));
  });
}

async function repoListUserSettings(userId) {
  const db = await mt5InitBackend();
  const rows = await dbQueries.listUserSettingsByType(db.db, userId, null);
  return rows.map((r) => ({
    type: r.type,
    name: r.name,
    data: r.data,
    value: null,
    status: r.status,
    created_at: r.createdAt,
  }));
}

let REDIS_CLIENT = null;
let REDIS_CONNECTING = null;

function nowUnixSec() {
  return Math.floor(Date.now() / 1000);
}

function normalizeMarketDataSymbol(rawSymbol) {
  const base = String(rawSymbol || "")
    .trim()
    .toUpperCase();
  if (!base) return "";
  const noProvider = base.includes(":")
    ? base.split(":").slice(1).join(":").trim().toUpperCase()
    : base;
  return noProvider.replace(/[^A-Z0-9]/g, "");
}

function normalizeMarketDataTf(tfRaw) {
  const interval = String(timeframeToTwelve(tfRaw || "15m") || "15min")
    .trim()
    .toLowerCase();
  return interval || "15min";
}

function parseTfTokenToSeconds(tfToken) {
  const s = String(tfToken || "")
    .trim()
    .toLowerCase();
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

// --- Snapshot timeframe canonicalization ---
// Single source of truth: canonical TF token -> { seconds, label, tvInterval }
const SNAPSHOT_TF_MAP = {
  "1W": { seconds: 604800, label: "1W", tv: "W" },
  "1D": { seconds: 86400, label: "1D", tv: "D" },
  "4H": { seconds: 14400, label: "4h", tv: "240" },
  "1H": { seconds: 3600, label: "1h", tv: "60" },
  "30m": { seconds: 1800, label: "30m", tv: "30" },
  "15m": { seconds: 900, label: "15m", tv: "15" },
  "5m": { seconds: 300, label: "5m", tv: "5" },
  "1m": { seconds: 60, label: "1m", tv: "1" },
};

function normalizeSnapshotTfToken(raw) {
  const s = String(raw || "")
    .trim()
    .toUpperCase();
  if (!s) return "";
  // Direct canonical matches
  if (s === "1W" || s === "W" || s === "1WEEK" || s === "WEEK") return "1W";
  if (s === "1D" || s === "D" || s === "DAY" || s === "1DAY") return "1D";
  if (s === "4H" || s === "240" || s === "H4" || s === "4HOUR") return "4H";
  if (s === "1H" || s === "60" || s === "H1" || s === "1HOUR" || s === "HOUR")
    return "1H";
  if (s === "30M" || s === "30" || s === "M30" || s === "30MIN") return "30m";
  if (s === "15M" || s === "15" || s === "M15" || s === "15MIN") return "15m";
  if (s === "5M" || s === "5" || s === "M5" || s === "5MIN") return "5m";
  if (s === "1M" || s === "1" || s === "M1" || s === "1MIN" || s === "MIN")
    return "1m";
  // Numeric fallback: bare number = minutes
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) {
    if (n >= 10080) return "1W";
    if (n >= 1440) return "1D";
    if (n >= 240) return "4H";
    if (n >= 60) return "1H";
    if (n >= 30) return "30m";
    if (n >= 15) return "15m";
    if (n >= 5) return "5m";
    return "1m";
  }
  return "";
}

function snapshotTfToSeconds(canonical) {
  return SNAPSHOT_TF_MAP[canonical]?.seconds || 60;
}
function snapshotTfToLabel(canonical) {
  return SNAPSHOT_TF_MAP[canonical]?.label || canonical;
}
function snapshotTfToTVInterval(canonical) {
  return SNAPSHOT_TF_MAP[canonical]?.tv || canonical;
}

function normalizeTvTimezone(raw, fallback = "Etc/UTC") {
  const s = String(raw || "").trim();
  if (!s) return fallback;
  const up = s.toUpperCase();
  if (up === "UTC" || up === "ETC/UTC") return "Etc/UTC";
  if (up === "NY" || up === "NEW_YORK" || up === "AMERICA/NEW_YORK")
    return "America/New_York";
  if (up === "LOCAL") return "LOCAL";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: s }).format(new Date());
    return s;
  } catch {
    return fallback;
  }
}

function sessionKillerZoneLabelUTC(d = new Date()) {
  const h = Number(d.getUTCHours());
  if (h >= 0 && h < 6) return "Asia Session / Asia Range";
  if (h >= 6 && h < 8) return "London Pre-open / Frankfurt Kill Zone";
  if (h >= 8 && h < 12) return "London Session / London Kill Zone";
  if (h >= 12 && h < 17) return "New York Session / New York Kill Zone";
  if (h >= 17 && h < 22) return "NY PM Session / Reversal Zone";
  return "Late Session / Rollover Zone";
}

// Canonicalize, dedup, sort descending
function canonicalizeTfList(tfList) {
  const canonicals = tfList
    .map((t) => normalizeSnapshotTfToken(t))
    .filter(Boolean);
  return [...new Set(canonicals)].sort(
    (a, b) => snapshotTfToSeconds(b) - snapshotTfToSeconds(a),
  );
}

function estimateRequestedBarsRange({ tfNorm, bars, nowSec = nowUnixSec() }) {
  const sec = Math.max(60, parseTfTokenToSeconds(tfNorm));
  const count = Math.max(1, Number(bars) || 300);
  const alignedEnd = Math.floor(Math.max(1, nowSec) / sec) * sec;
  const start = alignedEnd - (count - 1) * sec;
  return { start, end: alignedEnd, sec };
}

function normalizeMarketDataTimezone(rawTimezone) {
  const tz =
    String(
      rawTimezone || CFG?.marketDataDefaultTimezone || "America/New_York",
    ).trim() || "America/New_York";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return "America/New_York";
  }
}

function normalizeMarketDataBar(rawBar) {
  if (!rawBar || typeof rawBar !== "object") return null;
  const time = Number(
    rawBar.time ?? rawBar.t ?? rawBar.bar_start ?? rawBar.bar_start_unix,
  );
  const open = Number(rawBar.open ?? rawBar.o);
  const high = Number(rawBar.high ?? rawBar.h);
  const low = Number(rawBar.low ?? rawBar.l);
  const close = Number(rawBar.close ?? rawBar.c);
  const volume = Number(rawBar.volume ?? rawBar.v);
  if (
    !Number.isFinite(time) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  )
    return null;
  const out = {
    time: Math.floor(time),
    open,
    high,
    low,
    close,
  };
  if (Number.isFinite(volume)) out.volume = volume;
  return out;
}

function normalizeMarketDataBars(rawBars = []) {
  const dedup = new Map();
  for (const raw of Array.isArray(rawBars) ? rawBars : []) {
    const bar = normalizeMarketDataBar(raw);
    if (bar) dedup.set(bar.time, bar);
  }
  return [...dedup.values()].sort((a, b) => a.time - b.time);
}

function detectMarketDataGapCandidates(bars = [], tfNorm = "1min") {
  const sec = Math.max(60, parseTfTokenToSeconds(tfNorm));
  const out = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = Number(bars[i - 1]?.time);
    const cur = Number(bars[i]?.time);
    if (!Number.isFinite(prev) || !Number.isFinite(cur)) continue;
    const missing = Math.round((cur - prev) / sec) - 1;
    if (missing > 0)
      out.push({ after: prev, before: cur, missing_bars: missing });
  }
  return out;
}

function serializeSnapshotForDb(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return "";
  const bars = normalizeMarketDataBars(snapshot.bars);
  return JSON.stringify({
    version: 2,
    timezone: "UTC",
    provider: snapshot.provider || "unknown",
    bars,
    sl: snapshot.sl ?? null,
    tp: snapshot.tp ?? null,
  });
}

function deserializeSnapshotFromDb(dbData) {
  if (!dbData) return { bars: [] };
  if (typeof dbData === "object" && Array.isArray(dbData.bars)) {
    return { ...dbData, bars: normalizeMarketDataBars(dbData.bars) };
  }
  const raw = String(dbData || "");
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return { ...parsed, bars: normalizeMarketDataBars(parsed.bars) };
    }
  } catch {}
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  return {
    timezone: "UTC",
    bars: lines
      .map((s) => {
        const parts = s.split(",");
        if (parts.length < 5) return null;
        return normalizeMarketDataBar({
          low: Number(parts[0]),
          high: Number(parts[1]),
          open: Number(parts[2]),
          time: Number(parts[3]),
          close: Number(parts[4]),
        });
      })
      .filter(Boolean),
  };
}

function chunkBarsForLastPrice(dbData) {
  try {
    const snap = deserializeSnapshotFromDb(dbData);
    const bars = Array.isArray(snap?.bars) ? snap.bars : [];
    return bars.length ? bars[bars.length - 1] : null;
  } catch {
    return null;
  }
}

function marketDataCacheKey(symbolNorm) {
  return `market_data:${symbolNorm}`;
}

function marketDataTtlSecByTf(tfNorm) {
  const sec = parseTfTokenToSeconds(tfNorm);
  if (sec <= 5 * 60) return 120;
  if (sec <= 15 * 60) return 300;
  if (sec <= 60 * 60) return 900;
  if (sec <= 4 * 60 * 60) return 3600;
  return 6 * 3600;
}

function marketDataMemoryRead(symbolNorm, tfNorm, reqStart, reqEnd) {
  const key = marketDataCacheKey(symbolNorm);
  const root = UnifiedCache.get(key, { l1Map: MARKET_DATA_MEMORY_CACHE });
  if (!root || typeof root !== "object" || !Array.isArray(root.data))
    return null;
  const tfData = root.data.find((d) => d && d.tf === tfNorm);
  if (!tfData || !Array.isArray(tfData.bars) || !tfData.bars.length)
    return null;
  const s = Number(tfData.bar_start ?? tfData.bars[0]?.time);
  const e = Number(tfData.bar_end ?? tfData.bars[tfData.bars.length - 1]?.time);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  if (s <= reqStart && e >= reqEnd) return JSON.parse(JSON.stringify(tfData));
  return null;
}

function marketDataFileRead(symbolNorm, tfNorm, reqStart, reqEnd) {
  const bars = readBrokerBarsFromCsv(symbolNorm, tfNorm, 1000);
  if (!bars.length) return null;
  const barStart = bars[0].time;
  const barEnd = bars[bars.length - 1].time;
  if (barStart > reqEnd || barEnd < reqStart) return null;
  const tfSec = Math.max(60, parseTfTokenToSeconds(tfNorm));
  return {
    symbol: symbolNorm,
    timeframe: tfNorm,
    bar_start: barStart,
    bar_end: barEnd + tfSec,
    bars,
    metadata: readMarketDataMetadata(symbolNorm, tfNorm),
    last_price: bars[bars.length - 1].close,
    last_price_at: null,
  };
}

function marketDataFileWrite(symbolNorm, tfNorm, data) {
  // Merge bars into CSV (deduplicates by time)
  if (Array.isArray(data.bars) && data.bars.length) {
    mergeBarsIntoCSV(symbolNorm, tfNorm, data.bars);
  }
  // Write metadata sidecar
  if (data.metadata && typeof data.metadata === "object") {
    writeMarketDataMetadata(symbolNorm, tfNorm, data.metadata);
  }
  // Update L1 memory cache
  marketDataMemoryWrite(symbolNorm, tfNorm, data);
}

async function notifyPulse(userId, type = "general") {
  if (!CFG.redisEnabled) return;
  try {
    const client = await getRedisClient();
    if (!client) return;
    const now = Date.now();
    const key = `NOTIF_PULSE:${userId || "global"}`;
    await client.hSet(key, type, String(now));
    await client.expire(key, 3600); // 1 hour is enough for pulse
    await client.set("NOTIF_PULSE:GLOBAL", String(now), { EX: 3600 });
  } catch (err) {}
}

async function updateHealthActivity(objectType, objectId, value = {}) {
  if (!CFG.redisEnabled) return;
  try {
    const client = await getRedisClient();
    if (!client) return;
    const type = String(objectType || "")
      .trim()
      .toUpperCase();
    const id = String(objectId || "").trim();
    if (!type || !id) return;
    const field = `${type}:${id}`;
    const ts = Date.now();
    const payload = {
      object_type: type,
      object_id: id,
      key: field,
      updated_at: new Date(ts).toISOString(),
      ts,
      ...(value && typeof value === "object" ? value : { value }),
    };
    await client.hSet("HEALTH_ACTIVITY", field, JSON.stringify(payload));
    await client.zAdd("HEALTH_ACTIVITY_TS", [{ score: ts, value: field }]);
    await client.expire("HEALTH_ACTIVITY", 86400 * 14);
    await client.expire("HEALTH_ACTIVITY_TS", 86400 * 14);
  } catch {}
}

async function getHealthActivity(limit = 50, prefix = "") {
  if (!CFG.redisEnabled) return [];
  try {
    const client = await getRedisClient();
    if (!client) return [];
    const max = Math.max(1, Math.min(500, Number(limit) || 50));
    const filter = String(prefix || "")
      .trim()
      .toUpperCase();
    const members = await client.zRange("HEALTH_ACTIVITY_TS", 0, max * 5, {
      REV: true,
    });
    if (!Array.isArray(members) || !members.length) return [];
    const filtered = filter
      ? members.filter((m) =>
          String(m || "")
            .toUpperCase()
            .startsWith(filter),
        )
      : members;
    const picked = [...new Set(filtered)].slice(0, max);
    if (!picked.length) return [];
    const values = await client.hmGet("HEALTH_ACTIVITY", picked);
    return picked
      .map((k, i) => {
        const raw = values[i];
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return { key: k, raw };
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function upsertSymbolActivity(symbolRaw, patch = {}) {
  if (!CFG.redisEnabled) return null;
  const symbol = normalizeMarketDataSymbol(symbolRaw);
  if (!symbol) return null;
  try {
    const client = await getRedisClient();
    if (!client) return null;
    const field = symbol;
    const existingRaw = await client.hGet("HEALTH_SYMBOL_ACTIVITY", field);
    let existing = {};
    if (existingRaw) {
      try {
        existing = JSON.parse(existingRaw) || {};
      } catch {
        existing = {};
      }
    }
    const ts = Date.now();
    const next = {
      symbol,
      updated_at: new Date(ts).toISOString(),
      ts,
      ...existing,
      ...patch,
    };
    await client.hSet("HEALTH_SYMBOL_ACTIVITY", field, JSON.stringify(next));
    await client.zAdd("HEALTH_SYMBOL_ACTIVITY_TS", [
      { score: ts, value: field },
    ]);
    await client.expire("HEALTH_SYMBOL_ACTIVITY", 86400 * 14);
    await client.expire("HEALTH_SYMBOL_ACTIVITY_TS", 86400 * 14);
    return next;
  } catch {
    return null;
  }
}

async function getSymbolActivity(limit = 200) {
  if (!CFG.redisEnabled) return [];
  try {
    const client = await getRedisClient();
    if (!client) return [];
    const max = Math.max(1, Math.min(1000, Number(limit) || 200));
    const members = await client.zRange(
      "HEALTH_SYMBOL_ACTIVITY_TS",
      0,
      max - 1,
      {
        REV: true,
      },
    );
    if (!Array.isArray(members) || !members.length) return [];
    const values = await client.hmGet("HEALTH_SYMBOL_ACTIVITY", members);
    return members
      .map((symbol, i) => {
        const raw = values[i];
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return { symbol, raw };
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function getRedisClient() {
  if (!CFG.redisEnabled || !createRedisClient || !CFG.redisUrl) return null;
  if (REDIS_CLIENT?.isOpen) return REDIS_CLIENT;
  if (REDIS_CONNECTING) return REDIS_CONNECTING;
  REDIS_CONNECTING = (async () => {
    try {
      const client = createRedisClient({ url: CFG.redisUrl });
      client.on("error", (err) => {
        const msg =
          err instanceof Error ? err.message : String(err || "unknown");
        console.warn("[Redis] client error:", msg);
      });
      await client.connect();
      REDIS_CLIENT = client;
      return REDIS_CLIENT;
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : String(error || "connect_failed");
      console.warn("[Redis] connect failed:", msg);
      REDIS_CLIENT = null;
      return null;
    } finally {
      REDIS_CONNECTING = null;
    }
  })();
  return REDIS_CONNECTING;
}

// ── Provider code resolver ──
function resolveProviderCode(brokerName) {
  if (!brokerName) return null;
  const name = String(brokerName).toLowerCase();
  // IC Markets
  if (name.includes("ic market") || name.includes("icmarkets"))
    return "ICMARKETS";
  // OANDA
  if (name.includes("oanda")) return "OANDA";
  // EightCap
  if (name.includes("eightcap") || name.includes("8cap")) return "EIGHTCAP";
  // Pepperstone
  if (name.includes("pepperstone")) return "PEPPERSTONE";
  // Forex.com
  if (
    name.includes("forex.com") ||
    name.includes("forexcom") ||
    name.includes("gain capital")
  )
    return "FOREXCOM";
  // FXCM
  if (name.includes("fxcm")) return "FXCM";
  // XM
  if (name.includes("xm group") || name.includes("xm.com")) return "XM";
  // Exness
  if (name.includes("exness")) return "EXNESS";
  // RoboForex
  if (name.includes("roboforex")) return "ROBOFOREX";
  // FP Markets
  if (name.includes("fp market")) return "FPMARKETS";
  // Admiral Markets
  if (name.includes("admiral")) return "ADMIRAL";
  // Vantage
  if (name.includes("vantage")) return "VANTAGE";
  // Tickmill
  if (name.includes("tickmill")) return "TICKMILL";
  // Fusion Markets
  if (name.includes("fusion")) return "FUSIONMARKETS";
  // Darwinex
  if (name.includes("darwinex")) return "DARWINEX";
  return null;
}

// ── Trade List Redis Cache (Pending / Filled) ──
const TRADE_LIST_CACHE_TTL = 300; // 5 minutes

async function invalidateTradeListCaches() {
  if (!CFG.redisEnabled) return;
  try {
    const client = await getRedisClient();
    if (client) {
      await Promise.all([
        client.del("trades:pending").catch(() => {}),
        client.del("trades:filled").catch(() => {}),
      ]);
    }
  } catch (err) {
    console.warn("[TradeCache] invalidate failed:", err.message);
  }
}

async function getTradeListFromCache(status) {
  if (!CFG.redisEnabled) return null;
  try {
    const client = await getRedisClient();
    if (!client) return null;
    const src = resolveMt5DbSource(currentMt5DbSourceId());
    const srcId = src?.id || "active";
    const cacheKey = `trades:${status.toLowerCase()}:${srcId}`;
    const raw = await client.get(cacheKey);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

async function setTradeListCache(status, items) {
  if (!CFG.redisEnabled) return;
  try {
    const client = await getRedisClient();
    if (!client) return;
    const src = resolveMt5DbSource(currentMt5DbSourceId());
    const srcId = src?.id || "active";
    const cacheKey = `trades:${status.toLowerCase()}:${srcId}`;
    await client
      .set(cacheKey, JSON.stringify(Array.isArray(items) ? items : []), {
        EX: TRADE_LIST_CACHE_TTL,
      })
      .catch(() => {});
  } catch (err) {
    console.warn("[TradeCache] set failed:", err.message);
  }
}

async function marketDataRedisRead(symbolNorm, tfNorm, reqStart, reqEnd) {
  const client = await getRedisClient();
  if (!client) return null;
  const key = marketDataCacheKey(symbolNorm);
  const raw = await client.get(key).catch(() => "");
  if (!raw) return null;

  let root = null;
  try {
    root = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!root || !Array.isArray(root.data)) return null;

  // Find the specific timeframe in the data array
  const tfData = root.data.find((d) => d.tf === tfNorm);
  if (!tfData || !Array.isArray(tfData.bars) || !tfData.bars.length)
    return null;

  const s = Number(tfData.bar_start);
  const e = Number(tfData.bar_end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;

  if (s <= reqStart && e >= reqEnd) {
    return tfData;
  }
  return null;
}

function marketDataMemoryWrite(symbolNorm, tfNorm, data) {
  const key = marketDataCacheKey(symbolNorm);
  const ttl = 1800; // Unified TTL for symbol (30m)

  let root = UnifiedCache.get(key, { l1Map: MARKET_DATA_MEMORY_CACHE });
  if (!root || typeof root !== "object") {
    root = {
      symbol: symbolNorm,
      updated_time: Math.floor(Date.now() / 1000),
      data: [],
    };
  }

  // Update or Add TF
  const existingIdx = Array.isArray(root.data)
    ? root.data.findIndex((d) => d.tf === tfNorm)
    : -1;
  const tfEntry = {
    ...data,
    tf: tfNorm,
    updated_time: Math.floor(Date.now() / 1000),
  };
  if (existingIdx >= 0) {
    root.data[existingIdx] = tfEntry;
  } else {
    root.data.push(tfEntry);
  }
  root.updated_time = tfEntry.updated_time;

  UnifiedCache.set(key, root, {
    l1Map: MARKET_DATA_MEMORY_CACHE,
    l2Prefix: "market_data",
    ttlSec: ttl,
  });
}

async function marketDataRedisWrite(symbolNorm, tfNorm, snapshot) {
  const client = await getRedisClient();
  if (!client) return;
  const key = marketDataCacheKey(symbolNorm);
  const ttl = 3600; // Unified TTL for symbol (1h)

  // Atomic-ish update: Get, Merge, Set
  const raw = await client.get(key).catch(() => "");
  let root = null;
  try {
    if (raw) root = JSON.parse(raw);
  } catch {}

  if (!root || typeof root !== "object") {
    root = {
      symbol: symbolNorm,
      updated_time: Math.floor(Date.now() / 1000),
      data: [],
    };
  }

  const tfEntry = {
    ...snapshot,
    tf: tfNorm,
    updated_time: Math.floor(Date.now() / 1000),
    source: snapshot.source || "remote_api",
  };

  const existingIdx = Array.isArray(root.data)
    ? root.data.findIndex((d) => d.tf === tfNorm)
    : -1;
  if (existingIdx >= 0) {
    root.data[existingIdx] = tfEntry;
  } else {
    root.data.push(tfEntry);
  }
  root.updated_time = tfEntry.updated_time;

  await client.setEx(key, ttl, JSON.stringify(root)).catch(() => {});
}

async function marketDataFileUpsert(symbolNorm, tfNorm, snapshot) {
  const bars = normalizeMarketDataBars(snapshot?.bars);
  if (!bars.length) return;

  // Merge bars into CSV (deduplicates by time, updates L1 + Redis cache)
  mergeBarsIntoCSV(symbolNorm, tfNorm, bars);

  // Update cron state (keeps tracking for monitoring)
  await marketDataUpdateCronState({
    userId: snapshot.user_id || CFG.mt5DefaultUserId,
    settingName: snapshot.setting_name || "default",
    symbol: symbolNorm,
    tf: tfNorm,
    patch: {
      last_success_at: new Date().toISOString(),
      last_bar_start: bars[bars.length - 1]?.time || null,
      chunk_count: 1,
      bar_count: bars.length,
      gap_candidates: detectMarketDataGapCandidates(bars, tfNorm).slice(0, 20),
    },
  }).catch(() => {});
}

function normalizeEmail(emailRaw) {
  return String(emailRaw || "")
    .trim()
    .toLowerCase();
}

function normalizeUserRole(roleRaw) {
  const role = String(roleRaw || "")
    .trim()
    .toLowerCase();
  if (role === "system") return "System";
  if (role === "admin") return "Admin";
  if (role === "user") return "User";
  if (role === "guest") return "Guest";
  return "User";
}

function normalizeUserActive(activeRaw, fallback = true) {
  if (typeof activeRaw === "boolean") return activeRaw;
  if (
    activeRaw === 1 ||
    activeRaw === "1" ||
    String(activeRaw || "").toLowerCase() === "true"
  )
    return true;
  if (
    activeRaw === 0 ||
    activeRaw === "0" ||
    String(activeRaw || "").toLowerCase() === "false"
  )
    return false;
  return Boolean(fallback);
}

function isSystemRole(roleRaw) {
  return normalizeUserRole(roleRaw) === UI_ROLE_SYSTEM;
}

function isValidEmail(emailRaw) {
  const email = normalizeEmail(emailRaw);
  return Boolean(email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
}

function uiPublicUserView(user) {
  return {
    user_id: String(user?.user_id || ""),
    name: String(user?.name || ""),
    email: normalizeEmail(user?.email),
    role: normalizeUserRole(user?.role),
    is_active: normalizeUserActive(user?.is_active, true),
    updated_at: String(user?.updated_at || ""),
    created_at: String(user?.created_at || ""),
  };
}

function uiPublicAccountView(row) {
  return {
    account_id: String(row?.account_id || ""),
    user_id: String(row?.user_id || ""),
    name: String(row?.name || ""),
    balance:
      row?.balance === null || row?.balance === undefined
        ? null
        : Number(row.balance),
    status: String(row?.status || ""),
    metadata:
      row?.metadata && typeof row.metadata === "object"
        ? row.metadata
        : row?.metadata
          ? row.metadata
          : null,
    created_at: String(row?.created_at || ""),
    updated_at: String(row?.updated_at || ""),
  };
}

function fallbackNameFromEmail(emailRaw) {
  const email = normalizeEmail(emailRaw);
  if (!email) return "System";
  return String(email.split("@")[0] || "System");
}

function makeSaltHex() {
  return crypto.randomBytes(16).toString("hex");
}

const UUID_V4ISH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeCompactId(prefix = "ID", chars = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const size = Math.max(4, Number(chars) || 8);
  const bytes = crypto.randomBytes(size);
  let body = "";
  for (let i = 0; i < size; i += 1)
    body += alphabet[bytes[i] % alphabet.length];
  return `${String(prefix || "ID").toUpperCase()}_${body}`;
}

// --- Security & Encryption ---

const ENCRYPTION_ALGO = "aes-256-gcm";
const ENCRYPTION_KEY_SECRET = envStr(
  process.env.ENCRYPTION_KEY,
  "a_very_secret_32_byte_key_placeholder_123",
); // 32 bytes for aes-256

function getEncryptionKey() {
  // Ensure the key is exactly 32 bytes
  return crypto.createHash("sha256").update(ENCRYPTION_KEY_SECRET).digest();
}

/**
 * Encrypt sensitive data (API keys, secrets) using AES-256-GCM
 */
function encryptData(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  // Format: iv:tag:encrypted
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

/**
 * Decrypt sensitive data (original plaintext)
 */
function decryptData(cipherText) {
  if (!cipherText) return null;
  const parts = cipherText.split(":");
  if (parts.length !== 3) return cipherText; // Return as is if not encrypted format (legacy support)

  try {
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const encrypted = parts[2];
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.warn(
      "[security] Decryption failed, returning raw string (might be plaintext or bad key)",
      err.message,
    );
    return cipherText;
  }
}

/**
 * Encrypt/Decrypt object values (for JSONB data containing multiple keys)
 */
function encryptObject(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = encryptData(String(v || ""));
  }
  return out;
}

function decryptObject(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = decryptData(String(v || ""));
  }
  return out;
}

/**
 * Mask an API key for display: first 4 chars + **** + last 4 chars of the real decrypted key.
 * Example: sk-ant-api03-abcdef123456789 → sk-a****6789
 */
function maskApiKeyForDisplay(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (raw.length <= 8) return raw.slice(0, 1) + "****" + raw.slice(-1);
  return raw.slice(0, 4) + "****" + raw.slice(-4);
}

function isMaskedApiKeyLike(value) {
  const v = String(value || "").trim();
  return v.includes("****");
}

function hashPassword(passwordRaw, saltHex) {
  return crypto
    .scryptSync(String(passwordRaw || ""), saltHex, 64)
    .toString("hex");
}

const ALLOWED_AI_API_KEY_NAMES = new Set([
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "CLAUDE_API_KEY",
  "TWELVE_DATA_API_KEY",
  "OPENROUTER_API_KEY",
]);

function normalizeAiApiKeyName(rawName) {
  const name = String(rawName || "")
    .trim()
    .toUpperCase();
  if (name === "GEMINI" || name === "GOOGLE_GEMINI" || name === "GEMINI_KEY")
    return "GEMINI_API_KEY";
  if (name === "OPENAI" || name === "OPENAI_KEY") return "OPENAI_API_KEY";
  if (name === "DEEPSEEK" || name === "DEEPSEEK_KEY") return "DEEPSEEK_API_KEY";
  if (name === "OPENROUTER" || name === "OPENROUTER_KEY")
    return "OPENROUTER_API_KEY";
  if (
    name === "CLAUDE" ||
    name === "ANTHROPIC" ||
    name === "ANTHROPIC_API_KEY" ||
    name === "CLAUDE_KEY"
  )
    return "CLAUDE_API_KEY";
  if (
    name === "TWELVE" ||
    name === "TWELVEDATA" ||
    name === "TWELVE_DATA" ||
    name === "TWELVE_DATA_KEY"
  )
    return "TWELVE_DATA_API_KEY";
  return name;
}

function hashApiKey(raw) {
  return crypto
    .createHash("sha256")
    .update(String(raw || ""), "utf8")
    .digest("hex");
}

function timingSafeEqHex(aHex, bHex) {
  try {
    const a = Buffer.from(String(aHex || ""), "hex");
    const b = Buffer.from(String(bHex || ""), "hex");
    if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function uiDefaultAuthState(emailOverride = "") {
  const salt = makeSaltHex();
  const email = normalizeEmail(emailOverride || CFG.uiBootstrapEmail);
  return {
    email,
    name: fallbackNameFromEmail(email),
    role: UI_ROLE_SYSTEM,
    is_active: true,
    password_salt: salt,
    password_hash: hashPassword(CFG.uiBootstrapPassword, salt),
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}

function parseLegacyUiAuthStateFromFile() {
  if (!fs.existsSync(CFG.uiAuthStatePath)) return null;
  try {
    const raw = fs.readFileSync(CFG.uiAuthStatePath, "utf8");
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object") return null;
    const email = normalizeEmail(parsed.email || CFG.uiBootstrapEmail);
    const passwordSalt = String(parsed.password_salt || "");
    const passwordHash = String(parsed.password_hash || "");
    if (!email || !passwordSalt || !passwordHash) return null;
    return {
      email,
      name: fallbackNameFromEmail(email),
      role: UI_ROLE_SYSTEM,
      is_active: true,
      password_salt: passwordSalt,
      password_hash: passwordHash,
      updated_at: parsed.updated_at || new Date().toISOString(),
      created_at:
        parsed.created_at || parsed.updated_at || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function uiReadAuthStateByEmail(emailRaw) {
  const email = normalizeEmail(emailRaw);
  if (!email) return null;
  const b = await mt5Backend();
  if (!b.getUiAuthUser) return null;
  const row = await b.getUiAuthUser(email);
  if (!row) return null;
  return {
    user_id: String(row.user_id || CFG.mt5DefaultUserId),
    email: normalizeEmail(row.email),
    name: String(row.name || ""),
    role: normalizeUserRole(row.role || UI_ROLE_SYSTEM),
    is_active: normalizeUserActive(row.is_active, true),
    password_salt: String(row.password_salt || ""),
    password_hash: String(row.password_hash || ""),
    updated_at: normalizeIsoTimestamp(row.updated_at, new Date().toISOString()),
    created_at: normalizeIsoTimestamp(row.created_at, mt5NowIso()),
    metadata: row.metadata || {},
  };
}

async function uiReadAuthStateByName(nameRaw) {
  const name = String(nameRaw || "").trim();
  if (!name) return null;
  const b = await mt5Backend();
  if (!b.getUiAuthUserByName) return null;
  const row = await b.getUiAuthUserByName(name);
  if (!row) return null;
  return {
    user_id: String(row.user_id || CFG.mt5DefaultUserId),
    email: normalizeEmail(row.email),
    name: String(row.name || ""),
    role: normalizeUserRole(row.role || UI_ROLE_SYSTEM),
    is_active: normalizeUserActive(row.is_active, true),
    password_salt: String(row.password_salt || ""),
    password_hash: String(row.password_hash || ""),
    updated_at: normalizeIsoTimestamp(row.updated_at, new Date().toISOString()),
    created_at: normalizeIsoTimestamp(row.created_at, mt5NowIso()),
    metadata: row.metadata || {},
  };
}

async function uiReadAuthStateByUserId(userIdRaw) {
  const userId = String(userIdRaw || "").trim();
  if (!userId) return null;
  const b = await mt5Backend();
  if (!b.getUiAuthUserById) return null;
  const row = await b.getUiAuthUserById(userId);
  if (!row) return null;
  return {
    user_id: String(row.user_id || CFG.mt5DefaultUserId),
    email: normalizeEmail(row.email),
    name: String(row.name || ""),
    role: normalizeUserRole(row.role || UI_ROLE_SYSTEM),
    is_active: normalizeUserActive(row.is_active, true),
    password_salt: String(row.password_salt || ""),
    password_hash: String(row.password_hash || ""),
    updated_at: normalizeIsoTimestamp(row.updated_at, new Date().toISOString()),
    created_at: normalizeIsoTimestamp(row.created_at, mt5NowIso()),
    metadata: row.metadata || {},
  };
}

async function uiWriteAuthState(nextState) {
  const b = await mt5Backend();
  if (!b.upsertUiAuthUser)
    throw new Error("UI auth storage is not supported by the current backend");
  await b.upsertUiAuthUser({
    user_id: String(nextState.user_id || CFG.mt5DefaultUserId),
    email: normalizeEmail(nextState.email),
    name: String(nextState.name || fallbackNameFromEmail(nextState.email)),
    role: normalizeUserRole(nextState.role || UI_ROLE_SYSTEM),
    is_active: normalizeUserActive(nextState.is_active, true),
    password_salt: String(nextState.password_salt || ""),
    password_hash: String(nextState.password_hash || ""),
    updated_at: normalizeIsoTimestamp(
      nextState.updated_at,
      new Date().toISOString(),
    ),
    created_at: normalizeIsoTimestamp(nextState.created_at, mt5NowIso()),
  });
}

async function uiAuthUpdateProfile(sess, patch = {}) {
  const state =
    (await uiReadAuthStateByUserId(sess.user_id)) ||
    (await uiReadAuthStateByEmail(sess.email));
  if (!state) return { ok: false, error: "User not found" };
  const nextName = String(patch.name ?? patch.name ?? state.name ?? "").trim();
  const nextEmail = normalizeEmail(patch.email ?? state.email);
  if (!nextName) return { ok: false, error: "Name is required" };
  if (!isValidEmail(nextEmail))
    return { ok: false, error: "Valid email is required" };

  const duplicate = await uiReadAuthStateByEmail(nextEmail);
  if (
    duplicate &&
    String(duplicate.user_id || "") !== String(state.user_id || "")
  ) {
    return { ok: false, error: "Email is already used by another user" };
  }

  const duplicateName = await uiReadAuthStateByName(nextName);
  if (
    duplicateName &&
    String(duplicateName.user_id || "") !== String(state.user_id || "")
  ) {
    return { ok: false, error: "Name is already taken" };
  }

  const next = {
    user_id: String(state.user_id || CFG.mt5DefaultUserId),
    name: nextName,
    email: nextEmail,
    role: normalizeUserRole(state.role || UI_ROLE_SYSTEM),
    is_active: normalizeUserActive(state.is_active, true),
    password_salt: String(state.password_salt || ""),
    password_hash: String(state.password_hash || ""),
    updated_at: new Date().toISOString(),
    created_at: String(state.created_at || mt5NowIso()),
  };
  await uiWriteAuthState(next);
  return { ok: true, user: uiPublicUserView(next) };
}

async function uiListUsers() {
  const b = await mt5Backend();
  if (!b.listUiUsers)
    throw new Error("User listing is not supported by the current backend");
  const rows = await b.listUiUsers();
  return (Array.isArray(rows) ? rows : []).map(uiPublicUserView);
}

async function uiCreateUser(payload = {}) {
  const name = String(payload.name ?? payload.name ?? "").trim();
  const email = normalizeEmail(payload.email);
  const role = normalizeUserRole(payload.role || "User");
  const password = String(payload.password || "");
  if (!name) return { ok: false, error: "Name is required" };
  if (!isValidEmail(email))
    return { ok: false, error: "Valid email is required" };
  if (password.length < 8)
    return { ok: false, error: "Password must be at least 8 characters" };
  const duplicateEmail = await uiReadAuthStateByEmail(email);
  if (duplicateEmail)
    return { ok: false, error: "Email is already used by another user" };
  const duplicateName = await uiReadAuthStateByName(name);
  if (duplicateName) return { ok: false, error: "Name is already taken" };
  let userId = String(payload.user_id || "").trim();
  if (!userId || UUID_V4ISH_RE.test(userId)) {
    for (let i = 0; i < 8; i += 1) {
      const candidate = makeCompactId("USR", 8);
      const exists = await uiReadAuthStateByUserId(candidate);
      if (!exists) {
        userId = candidate;
        break;
      }
    }
  }
  if (!userId) return { ok: false, error: "Unable to allocate user_id" };
  const salt = makeSaltHex();
  const now = mt5NowIso();
  await uiWriteAuthState({
    user_id: userId,
    name: name,
    email,
    role,
    is_active: true,
    password_salt: salt,
    password_hash: hashPassword(password, salt),
    updated_at: now,
    created_at: now,
  });
  return {
    ok: true,
    user: uiPublicUserView({
      user_id: userId,
      name: name,
      email,
      role,
      is_active: true,
      updated_at: now,
      created_at: now,
    }),
  };
}

async function uiUpdateUserById(userIdRaw, payload = {}) {
  const userId = String(userIdRaw || "").trim();
  if (!userId) return { ok: false, error: "user_id is required" };
  const current = await uiReadAuthStateByUserId(userId);
  if (!current) return { ok: false, error: "User not found" };
  const nextName = String(
    payload.name ?? payload.name ?? current.name ?? "",
  ).trim();
  const nextEmail = normalizeEmail(payload.email ?? current.email);
  const nextRole = normalizeUserRole(payload.role ?? current.role);
  const nextActive = normalizeUserActive(
    payload.is_active ?? payload.isActive ?? current.is_active,
    true,
  );
  if (!nextName) return { ok: false, error: "Name is required" };
  if (!isValidEmail(nextEmail))
    return { ok: false, error: "Valid email is required" };
  const duplicate = await uiReadAuthStateByEmail(nextEmail);
  if (duplicate && String(duplicate.user_id || "") !== userId) {
    return { ok: false, error: "Email is already used by another user" };
  }
  const duplicateName = await uiReadAuthStateByName(nextName);
  if (duplicateName && String(duplicateName.user_id || "") !== userId) {
    return { ok: false, error: "Name is already taken" };
  }
  const isDefaultUser = userId === String(CFG.mt5DefaultUserId);
  const password =
    payload.password === undefined ? "" : String(payload.password || "");
  if (payload.password !== undefined && password && password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters" };
  }
  const salt = payload.password
    ? makeSaltHex()
    : String(current.password_salt || "");
  const hash = payload.password
    ? hashPassword(password, salt)
    : String(current.password_hash || "");
  const next = {
    user_id: userId,
    name: nextName,
    email: nextEmail,
    role: isDefaultUser ? UI_ROLE_SYSTEM : nextRole,
    is_active: isDefaultUser ? true : nextActive,
    password_salt: salt,
    password_hash: hash,
    updated_at: mt5NowIso(),
    created_at: String(current.created_at || mt5NowIso()),
  };
  await uiWriteAuthState(next);
  return { ok: true, user: uiPublicUserView(next) };
}

async function uiDeleteUserById(userIdRaw) {
  const userId = String(userIdRaw || "").trim();
  if (!userId) return { ok: false, error: "user_id is required" };
  const b = await mt5Backend();
  if (!b.deleteUiAuthUserById)
    return {
      ok: false,
      error: "User deletion is not supported by the current backend",
    };
  return b.deleteUiAuthUserById(userId);
}

async function uiGetUserDetail(userIdRaw) {
  const userId = String(userIdRaw || "").trim();
  if (!userId) return { ok: false, error: "user_id is required" };
  const user = await uiReadAuthStateByUserId(userId);
  if (!user) return { ok: false, error: "User not found" };
  const b = await mt5Backend();
  const accounts = b.listUserAccounts ? await b.listUserAccounts(userId) : [];
  return {
    ok: true,
    user: uiPublicUserView(user),
    accounts: (accounts || []).map(uiPublicAccountView),
    api_keys: [],
  };
}

async function uiUpsertUserAccount(userIdRaw, payload = {}) {
  const userId = String(userIdRaw || "").trim();
  if (!userId) return { ok: false, error: "user_id is required" };
  const user = await uiReadAuthStateByUserId(userId);
  if (!user) return { ok: false, error: "User not found" };
  const accountId = String(
    payload.account_id || payload.accountId || crypto.randomUUID(),
  ).trim();
  const name = String(payload.name || "").trim();
  if (!accountId) return { ok: false, error: "account_id is required" };
  if (!name) return { ok: false, error: "Account name is required" };
  const b = await mt5Backend();
  if (!b.upsertUserAccount)
    return {
      ok: false,
      error: "Account management is not supported by this backend",
    };
  const row = await b.upsertUserAccount(userId, {
    account_id: accountId,
    name,
    balance:
      payload.balance === null ||
      payload.balance === undefined ||
      payload.balance === ""
        ? null
        : Number(payload.balance),
    status: String(payload.status || ""),
    metadata:
      payload.metadata && typeof payload.metadata === "object"
        ? payload.metadata
        : null,
  });
  return {
    ok: true,
    account: uiPublicAccountView(
      row || { account_id: accountId, user_id: userId, name },
    ),
  };
}

async function uiDeleteUserAccount(userIdRaw, accountIdRaw) {
  const userId = String(userIdRaw || "").trim();
  const accountId = String(accountIdRaw || "").trim();
  if (!userId || !accountId)
    return { ok: false, error: "user_id and account_id are required" };
  const b = await mt5Backend();
  if (!b.deleteUserAccount)
    return {
      ok: false,
      error: "Account management is not supported by this backend",
    };
  await b.deleteUserAccount(userId, accountId);
  return { ok: true };
}

async function uiEnsureAuthBootstrap() {
  const targetEmail = normalizeEmail(CFG.uiBootstrapEmail);
  const existing = await uiReadAuthStateByEmail(targetEmail);
  if (existing && existing.password_salt && existing.password_hash)
    return existing;

  const legacy = parseLegacyUiAuthStateFromFile();
  const seed = legacy || uiDefaultAuthState(targetEmail);
  seed.user_id = String(seed.user_id || CFG.mt5DefaultUserId);
  seed.name = String(seed.name || fallbackNameFromEmail(seed.email));
  seed.role = normalizeUserRole(seed.role || UI_ROLE_SYSTEM);
  seed.is_active = normalizeUserActive(seed.is_active, true);
  seed.created_at = String(seed.created_at || seed.updated_at || mt5NowIso());
  await uiWriteAuthState(seed);
  return seed;
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  const out = {};
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function isLocalhostOrigin(req) {
  const origin = String(req.headers.origin || req.headers.referer || "");
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function setUiSessionCookie(req, res, token) {
  const ttl = Math.max(
    300,
    Number.isFinite(CFG.uiSessionTtlSeconds)
      ? CFG.uiSessionTtlSeconds
      : 60 * 60 * 24 * 7,
  );
  // Use SameSite=None for localhost cross-origin dev (Vite on :5174 → backend on :80)
  // Browsers allow None without Secure on localhost. Use Lax for prod (CSRF protection).
  const sameSite = isLocalhostOrigin(req) ? "None" : "Lax";
  res.setHeader(
    "Set-Cookie",
    `tvb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${ttl}`,
  );
}

function clearUiSessionCookie(req, res) {
  const sameSite = isLocalhostOrigin(req) ? "None" : "Lax";
  res.setHeader(
    "Set-Cookie",
    `tvb_session=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0`,
  );
}

function createUiSession(user) {
  const ttl = Math.max(
    300,
    Number.isFinite(CFG.uiSessionTtlSeconds)
      ? CFG.uiSessionTtlSeconds
      : 60 * 60 * 24 * 7,
  );
  const token = crypto.randomBytes(32).toString("hex");
  const email = normalizeEmail(user?.email || "");
  const userId = String(user?.user_id || CFG.mt5DefaultUserId);
  const name = String(user?.name || fallbackNameFromEmail(email));
  const role = normalizeUserRole(user?.role || UI_ROLE_SYSTEM);
  const isActive = normalizeUserActive(user?.is_active, true);
  UI_SESSIONS.set(token, {
    email,
    user_id: userId,
    name: name,
    role,
    is_active: isActive,
    created_at: nowUnixSec(),
    expires_at: nowUnixSec() + ttl,
    metadata: user?.metadata || {},
  });
  return token;
}

function getUiSessionFromReq(req) {
  if (!CFG.uiAuthEnabled) {
    return {
      ok: true,
      token: "",
      email: normalizeEmail(CFG.uiBootstrapEmail),
      user_id: CFG.mt5DefaultUserId,
      name: fallbackNameFromEmail(CFG.uiBootstrapEmail),
      role: UI_ROLE_SYSTEM,
      is_active: true,
      metadata: {},
    };
  }
  const cookies = parseCookies(req);
  const token = String(
    cookies.tvb_session || req.headers["x-session-token"] || "",
  );
  if (!token)
    return {
      ok: false,
      email: "",
      token: "",
      user_id: "",
      name: "",
      role: "",
      is_active: false,
    };
  const sess = UI_SESSIONS.get(token);
  if (!sess)
    return {
      ok: false,
      email: "",
      token,
      user_id: "",
      name: "",
      role: "",
      is_active: false,
    };
  if (Number(sess.expires_at || 0) <= nowUnixSec()) {
    UI_SESSIONS.delete(token);
    return {
      ok: false,
      email: "",
      token,
      user_id: "",
      name: "",
      role: "",
      is_active: false,
    };
  }
  if (!normalizeUserActive(sess.is_active, true)) {
    UI_SESSIONS.delete(token);
    return {
      ok: false,
      email: "",
      token,
      user_id: "",
      name: "",
      role: "",
      is_active: false,
    };
  }
  return {
    ok: true,
    token,
    email: normalizeEmail(sess.email),
    user_id: String(sess.user_id || CFG.mt5DefaultUserId),
    name: String(sess.name || fallbackNameFromEmail(sess.email)),
    role: normalizeUserRole(sess.role || UI_ROLE_SYSTEM),
    is_active: true,
    metadata: sess.metadata || {},
  };
}

async function uiAuthGetVerifiedUser(emailRaw, passwordRaw) {
  const email = normalizeEmail(emailRaw);
  const bootstrapPasswordOk =
    email === normalizeEmail(CFG.uiBootstrapEmail) &&
    String(passwordRaw || "") === String(CFG.uiBootstrapPassword || "");
  const state = await uiReadAuthStateByEmail(email);
  if (bootstrapPasswordOk) {
    const bootstrapState = state || (await uiEnsureAuthBootstrap());
    if (!bootstrapState) return null;
    return {
      user_id: String(bootstrapState.user_id || CFG.mt5DefaultUserId),
      name: String(
        bootstrapState.name ||
          fallbackNameFromEmail(bootstrapState.email || email),
      ),
      email: normalizeEmail(bootstrapState.email || email),
      role: normalizeUserRole(bootstrapState.role || UI_ROLE_SYSTEM),
      is_active: true,
      metadata: bootstrapState.metadata || {},
    };
  }
  if (!state) return null;
  if (!normalizeUserActive(state.is_active, true)) return null;
  if (!email || email !== normalizeEmail(state.email)) return null;
  const actualHash = hashPassword(
    String(passwordRaw || ""),
    state.password_salt,
  );
  const dbPasswordOk = timingSafeEqHex(actualHash, state.password_hash);
  if (!dbPasswordOk) return null;
  return {
    user_id: String(state.user_id || CFG.mt5DefaultUserId),
    name: String(state.name || fallbackNameFromEmail(state.email)),
    email: normalizeEmail(state.email),
    role: normalizeUserRole(state.role || UI_ROLE_SYSTEM),
    is_active: normalizeUserActive(state.is_active, true),
    metadata: state.metadata || {},
  };
}

async function uiAuthChangePassword(emailRaw, currentPassword, newPassword) {
  const state = await uiReadAuthStateByEmail(emailRaw);
  if (!state) return { ok: false, error: "User not found" };
  const currentHash = hashPassword(
    String(currentPassword || ""),
    state.password_salt,
  );
  if (!timingSafeEqHex(currentHash, state.password_hash))
    return { ok: false, error: "Current password is incorrect" };
  if (String(newPassword || "").length < 8)
    return { ok: false, error: "New password must be at least 8 characters" };
  const nextSalt = makeSaltHex();
  const next = {
    user_id: String(state.user_id || CFG.mt5DefaultUserId),
    email: state.email,
    name: String(state.name || fallbackNameFromEmail(state.email)),
    role: normalizeUserRole(state.role || UI_ROLE_SYSTEM),
    is_active: normalizeUserActive(state.is_active, true),
    password_salt: nextSalt,
    password_hash: hashPassword(String(newPassword || ""), nextSalt),
    updated_at: new Date().toISOString(),
    created_at: String(state.created_at || mt5NowIso()),
  };
  await uiWriteAuthState(next);
  return { ok: true };
}

function ensureChartSnapshotDir() {
  if (!fs.existsSync(CHART_SNAPSHOT_DIR)) {
    fs.mkdirSync(CHART_SNAPSHOT_DIR, { recursive: true });
  }
}

function snapshotSymbolDir(symbol) {
  const sym = String(symbol || "")
    .trim()
    .toUpperCase();
  if (!sym) return CHART_SNAPSHOT_DIR;
  const dir = path.join(CHART_SNAPSHOT_DIR, sym);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function inferSymbolFromSnapshotFile(fileNameRaw) {
  const safe = String(fileNameRaw || "").trim();
  if (!safe) return "";
  const base = path
    .basename(safe)
    .replace(/\.(png|jpe?g)$/i, "")
    .toUpperCase();
  const parts = base.split("_").filter(Boolean);
  if (parts.length >= 2 && parts[parts.length - 1] === "MASTER") {
    const sub = parts.slice(0, -1);
    const KNOWN_PROVIDERS = new Set([
      "ICMARKETS",
      "OANDA",
      "FOREXCOM",
      "EIGHTCAP",
      "PEPPERSTONE",
      "FXCM",
      "BINANCE",
      "BYBIT",
    ]);
    if (sub.length >= 2 && KNOWN_PROVIDERS.has(sub[0]))
      return sub.slice(1).join("_");
    return sub.join("_");
  }
  if (parts.length < 3) return parts[0] || "";
  let symbolParts = [];
  if (
    parts.length >= 5 &&
    /^\d{8}$/.test(parts[0]) &&
    /^\d{2}$/.test(parts[1]) &&
    /^\d{2}$/.test(parts[2])
  ) {
    const rest = parts.slice(3);
    const hasDup = rest.length >= 3 && /^\d+$/.test(rest[rest.length - 1]);
    symbolParts = rest.slice(0, hasDup ? -2 : -1);
  } else {
    if (parts.length === 3) {
      symbolParts = parts.slice(0, 2);
    } else {
      const hasDup = parts.length >= 4 && /^\d+$/.test(parts[parts.length - 1]);
      symbolParts = parts.slice(0, hasDup ? -3 : -2);
    }
  }
  if (!symbolParts.length) return "";
  const KNOWN_PROVIDERS = new Set([
    "ICMARKETS",
    "OANDA",
    "FOREXCOM",
    "EIGHTCAP",
    "PEPPERSTONE",
    "FXCM",
    "BINANCE",
    "BYBIT",
  ]);
  if (symbolParts.length >= 2 && KNOWN_PROVIDERS.has(symbolParts[0])) {
    return symbolParts.slice(1).join("_");
  }
  return symbolParts.join("_");
}

function ensureAiContextFileDir() {
  if (!fs.existsSync(AI_CONTEXT_FILE_DIR)) {
    fs.mkdirSync(AI_CONTEXT_FILE_DIR, { recursive: true });
  }
}

function ensureTradeDir(sid, symbol = "", category = "files") {
  let safeSid = String(sid || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "_");
  const safeSymbol = String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Za-z0-9]/g, "");
  const baseDir = TRADE_CATEGORY_DIRS[category] || TRADE_FILES_DIR;
  if (!safeSid) return baseDir;
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  // Strip trailing -{symbol} from SID if already present (prevents -BTCUSD-BTCUSD-... duplication)
  if (safeSymbol && safeSid.endsWith("-" + safeSymbol)) {
    safeSid = safeSid.slice(0, -(safeSymbol.length + 1));
  }

  // If we know the symbol, use {sid}-{symbol}
  if (safeSymbol) {
    const dir = path.join(baseDir, `${safeSid}-${safeSymbol}`);
    if (!fs.existsSync(dir)) {
      // Migrate from old, unknown, or sid-only folder — check ALL categories
      for (const [catKey, catBase] of Object.entries(TRADE_CATEGORY_DIRS)) {
        if (!fs.existsSync(catBase)) continue;
        for (const oldName of [
          `trade-${safeSid}`,
          `${safeSid}-UNKNOWN`,
          safeSid,
        ]) {
          const oldDir = path.join(catBase, oldName);
          if (!fs.existsSync(oldDir)) continue;
          try {
            // Merge contents from old to new (if different categories), then remove old
            if (catBase !== baseDir) {
              for (const entry of fs.readdirSync(oldDir, { withFileTypes: true })) {
                const s = path.join(oldDir, entry.name);
                const d = path.join(dir, entry.name);
                if (!fs.existsSync(d)) {
                  if (entry.isDirectory()) {
                    fs.cpSync(s, d, { recursive: true });
                  } else {
                    fs.copyFileSync(s, d);
                  }
                }
              }
              fs.rmSync(oldDir, { recursive: true });
            } else {
              fs.renameSync(oldDir, dir);
            }
            console.log("[trade-folder] migrated bare", oldName, "->", `${safeSid}-${safeSymbol}`);
            break;
          } catch {}
        }
      }
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  // No symbol: find any existing {sid}-* folder first.
  try {
    const entries = fs.readdirSync(baseDir);
    const match = entries.find(
      (e) =>
        e.startsWith(safeSid + "-") &&
        fs.statSync(path.join(baseDir, e)).isDirectory(),
    );
    if (match) return path.join(baseDir, match);
  } catch {}

  // No symbol and no existing folder: try to infer from existing folders across all categories
  const inferred = inferSymbolFromTradeFolder(safeSid);
  if (inferred) return ensureTradeDir(safeSid, inferred, category);
  // Last resort: caller must pass/resolve symbol before creating this path.
  return path.join(baseDir, safeSid);
}

// Backward compat alias
function ensureTradeFilesDir(sid, symbol = "") {
  return resolveTradeDirForCreate(sid, symbol, "files");
}

function normalizeTradeFolderSymbol(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_-]+:/, "")
    .replace(/[^A-Z0-9]/g, "");
}

function safeTradeFolderSid(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "_");
}

function resolveTradeDirForCreate(sid, symbol = "", category = "files") {
  const safeSid = safeTradeFolderSid(sid);
  if (!safeSid) return TRADE_CATEGORY_DIRS[category] || TRADE_FILES_DIR;
  const sym = normalizeTradeFolderSymbol(symbol || inferSymbolFromTradeFolder(safeSid));
  if (sym) return ensureTradeDir(safeSid, sym, category);
  const existing = findExistingTradeDir(safeSid);
  if (existing) return existing;
  throw new Error(`trade folder symbol not found for sid ${safeSid}`);
}

function tradeLogsDir(sid, symbol = "") {
  const dir = path.join(resolveTradeDirForCreate(sid, symbol, "files"), "logs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tradeSnapshotDir(sid, symbol = "") {
  const dir = path.join(resolveTradeDirForCreate(sid, symbol, "files"), "snapshots");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readTradeSymbolFromPayloadFileSync(tradeDir) {
  const payloadPath = path.join(tradeDir, "logs", "payload.json");
  if (!fs.existsSync(payloadPath)) return "";
  try {
    const data = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
    return normalizeTradeFolderSymbol(
      data?.symbol ||
        data?.symbols?.[0] ||
        data?.parsed_json?.symbol ||
        data?.trade_plan?.symbol ||
        "",
    );
  } catch {
    return "";
  }
}

function readTradeSymbolFromDbSync(safeSid) {
  if (!safeSid || !CFG.mt5PostgresUrl || CFG.mt5StorageBackend === "sqlite") {
    return "";
  }
  try {
    const script = `
      const { Pool } = require("pg");
      const pool = new Pool({ connectionString: process.env.MT5_POSTGRES_URL_SYNC, max: 1, connectionTimeoutMillis: 1000 });
      (async () => {
        try {
          const { rows } = await pool.query("select symbol from trades where sid = $1 limit 1", [process.env.TRADE_SID_SYNC]);
          process.stdout.write(String(rows[0]?.symbol || ""));
        } finally {
          await pool.end().catch(() => {});
        }
      })().catch(() => process.exit(1));
    `;
    const out = execFileSync(process.execPath, ["-e", script], {
      cwd: __dirname,
      encoding: "utf8",
      timeout: 1500,
      env: {
        ...process.env,
        MT5_POSTGRES_URL_SYNC: CFG.mt5PostgresUrl,
        TRADE_SID_SYNC: safeSid,
      },
      stdio: ["ignore", "pipe", "ignore"],
    });
    return normalizeTradeFolderSymbol(out);
  } catch {
    return "";
  }
}

function mergeTradeFolderSync(src, dst) {
  if (src === dst) return true;
  if (!fs.existsSync(src)) return false;
  if (!fs.existsSync(dst)) {
    fs.renameSync(src, dst);
    return true;
  }
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (fs.existsSync(d)) continue;
    if (entry.isDirectory()) fs.cpSync(s, d, { recursive: true });
    else fs.copyFileSync(s, d);
  }
  fs.rmSync(src, { recursive: true, force: true });
  return true;
}

function repairBareTradeDirSync(baseDir, safeSid, bareDir) {
  const sym =
    readTradeSymbolFromDbSync(safeSid) ||
    readTradeSymbolFromPayloadFileSync(bareDir);
  if (!sym) return bareDir;
  const fixedDir = path.join(baseDir, `${safeSid}-${sym}`);
  try {
    mergeTradeFolderSync(bareDir, fixedDir);
    console.log("[trade-folder] repaired bare", safeSid, "->", `${safeSid}-${sym}`);
    return fixedDir;
  } catch (error) {
    console.error("[trade-folder] repair bare error:", error.message);
    return bareDir;
  }
}

// Search all categories for an existing trade folder
function resolveTradeDir(sid, symbol = "") {
  const sym = String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Za-z0-9]/g, "");
  for (const cat of ["active", "closed", "files"]) {
    const baseDir = TRADE_CATEGORY_DIRS[cat];
    if (!fs.existsSync(baseDir)) continue;
    try {
      let safeSid = String(sid || "")
        .trim()
        .replace(/[^A-Za-z0-9_.-]/g, "_");
      // Strip trailing -{symbol} from SID if already present
      if (sym && safeSid.endsWith("-" + sym)) {
        safeSid = safeSid.slice(0, -(sym.length + 1));
      }
      const entries = fs.readdirSync(baseDir);
      let match = entries.find(
        (e) =>
          e.startsWith(safeSid + "-") &&
          fs.statSync(path.join(baseDir, e)).isDirectory(),
      );
      if (!match) {
        match = entries.find(
          (e) =>
            e === safeSid && fs.statSync(path.join(baseDir, e)).isDirectory(),
        );
      }
      if (match === safeSid && sym) return ensureTradeDir(safeSid, sym, cat);
      if (match === safeSid) {
        return repairBareTradeDirSync(
          baseDir,
          safeSid,
          path.join(baseDir, match),
        );
      }
      if (match) return path.join(baseDir, match);
    } catch {}
  }
  // Not found in any category, create in files
  return ensureTradeDir(sid, symbol, "files");
}

// Move trade folder between categories
// Copy bars + snapshots from market_data into trade folder before archival
// Read bars for a trade: priority closed > active > market_data
function readTradeBars(safeSid, tf, symbol = "") {
  const dirs = [];
  // Try resolved trade dir (any category)
  const resolvedSymbol = symbol || inferSymbolFromTradeFolder(safeSid);
  const resolved = resolvedSymbol
    ? resolveTradeDir(safeSid, resolvedSymbol)
    : findExistingTradeDir(safeSid);
  if (resolved) dirs.push(path.join(resolved, "bars"));
  // Fallbacks
  dirs.push(path.join(TRADE_CLOSED_DIR, "trade-" + safeSid, "bars"));
  dirs.push(path.join(TRADE_FILES_DIR, "trade-" + safeSid, "bars"));

  for (const dir of dirs) {
    const csvPath = path.join(dir, tf + ".csv");
    if (fs.existsSync(csvPath)) {
      const lines = fs.readFileSync(csvPath, "utf8").trim().split("\n");
      const bars = [];
      for (let i = 1; i < lines.length; i++) {
        const p = lines[i].split(",");
        const t = Number(p[0]);
        if (!Number.isFinite(t)) continue;
        bars.push({
          time: t,
          open: Number(p[1]),
          high: Number(p[2]),
          low: Number(p[3]),
          close: Number(p[4]),
          volume: Number(p[5]),
        });
      }
      if (bars.length) return bars;
    }
  }

  // Fallback: market_data
  const marketPath = path.join(GLOBAL_DATA_DIR, "market_data");
  // Need symbol — try all symbol dirs
  if (fs.existsSync(marketPath)) {
    for (const sym of fs.readdirSync(marketPath)) {
      const csvPath = path.join(marketPath, sym, "bars", tf + ".csv");
      if (fs.existsSync(csvPath)) {
        const lines = fs.readFileSync(csvPath, "utf8").trim().split("\n");
        const bars = [];
        for (let i = 1; i < lines.length; i++) {
          const p = lines[i].split(",");
          const t = Number(p[0]);
          if (!Number.isFinite(t)) continue;
          bars.push({
            time: t,
            open: Number(p[1]),
            high: Number(p[2]),
            low: Number(p[3]),
            close: Number(p[4]),
            volume: Number(p[5]),
          });
        }
        return bars;
      }
    }
  }

  return [];
}

function archiveTradeStats(sid, symbol) {
  if (!sid || !symbol) return;
  const sym = String(symbol).toUpperCase();
  const srcBarsDir = path.join(GLOBAL_DATA_DIR, "market_data", sym, "bars");
  const srcSnapDir = path.join(GLOBAL_DATA_DIR, "market_data", sym);
  // Use existing trade folder (any category) or create in trade_files
  let tradeDir = resolveTradeDir(sid, symbol);
  if (!tradeDir) {
    tradeDir = path.join(
      TRADE_FILES_DIR,
      "trade-" +
        String(sid)
          .trim()
          .replace(/[^A-Za-z0-9_.-]/g, "_"),
    );
    if (!fs.existsSync(tradeDir)) fs.mkdirSync(tradeDir, { recursive: true });
  }

  // Copy bars CSV files
  if (fs.existsSync(srcBarsDir)) {
    const dstBarsDir = path.join(tradeDir, "bars");
    if (!fs.existsSync(dstBarsDir))
      fs.mkdirSync(dstBarsDir, { recursive: true });
    const barFiles = fs
      .readdirSync(srcBarsDir)
      .filter((f) => f.endsWith(".csv"));
    for (const f of barFiles) {
      try {
        fs.copyFileSync(path.join(srcBarsDir, f), path.join(dstBarsDir, f));
      } catch {}
    }
  }

  // Copy snapshots (jpg/png files that are NOT in bars/ subdir)
  if (fs.existsSync(srcSnapDir)) {
    const dstSnapDir = path.join(tradeDir, "snapshots");
    if (!fs.existsSync(dstSnapDir))
      fs.mkdirSync(dstSnapDir, { recursive: true });
    const snapFiles = fs
      .readdirSync(srcSnapDir)
      .filter((f) => /.(jpg|jpeg|png)$/i.test(f));
    for (const f of snapFiles) {
      try {
        fs.copyFileSync(path.join(srcSnapDir, f), path.join(dstSnapDir, f));
      } catch {}
    }
  }
}

function moveTradeFolder(sid, fromCategory, toCategory, symbol = "") {
  const fromDir = TRADE_CATEGORY_DIRS[fromCategory];
  const toDir = TRADE_CATEGORY_DIRS[toCategory];
  if (!fromDir || !toDir) return false;
  if (!fs.existsSync(fromDir)) return false;
  try {
    const safeSid = String(sid || "")
      .trim()
      .replace(/[^A-Za-z0-9_.-]/g, "_");
    const safeSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Za-z0-9]/g, "");
    const entries = fs.readdirSync(fromDir);
    // Match {sid}-SYMBOL first, then exact {sid} (no symbol suffix)
    let match = entries.find(
      (e) =>
        e.startsWith(safeSid + "-") &&
        fs.statSync(path.join(fromDir, e)).isDirectory(),
    );
    if (!match) {
      match = entries.find(
        (e) =>
          e === safeSid && fs.statSync(path.join(fromDir, e)).isDirectory(),
      );
    }
    if (!match) return false;
    const src = path.join(fromDir, match);
    const dstName =
      match === safeSid && safeSymbol ? `${safeSid}-${safeSymbol}` : match;
    const dst = path.join(toDir, dstName);
    if (fs.existsSync(dst)) {
      // Merge: copy missing files from src to dst, then remove src
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (!fs.existsSync(d)) {
          if (entry.isDirectory()) {
            fs.cpSync(s, d, { recursive: true });
          } else {
            fs.copyFileSync(s, d);
          }
        }
      }
      fs.rmSync(src, { recursive: true });
      console.log(
        "[trade-folder] merged",
        match,
        fromCategory,
        "->",
        toCategory,
        dstName,
      );
      return true;
    }
    if (!fs.existsSync(toDir)) fs.mkdirSync(toDir, { recursive: true });
    fs.renameSync(src, dst);
    console.log("[trade-folder] moved", match, fromCategory, "->", toCategory, dstName);
    return true;
  } catch (e) {
    console.error("[trade-folder] move error:", e.message);
    return false;
  }
}

// Periodic reconciliation: move trade folders to correct category based on DB status
// Runs at broker sync time to fix any folders stuck in wrong category
async function reconcileTradeFolders(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT sid, symbol, execution_status FROM trades`,
    );
    const statusMap = new Map();
    for (const r of rows) {
      statusMap.set(r.sid, {
        symbol: r.symbol,
        execution_status: r.execution_status,
      });
    }

    let moved = 0;
    for (const [cat, catDir] of Object.entries(TRADE_CATEGORY_DIRS)) {
      if (!fs.existsSync(catDir)) continue;
      for (const name of fs.readdirSync(catDir)) {
        const full = path.join(catDir, name);
        if (!fs.statSync(full).isDirectory()) continue;
        const m = name.match(/^([A-Za-z0-9_.]+?)(?:-([A-Za-z0-9]+))?$/);
        const cleanSid = m ? m[1] : name;
        const rowInfo = statusMap.get(cleanSid);
        if (!rowInfo) continue; // orphan folder — skip
        const s = String(rowInfo.execution_status || "").toUpperCase();
        let target = "files";
        if (["FILLED", "PENDING"].includes(s)) target = "active";
        else if (["CLOSED", "CANCELLED", "REJECTED", "TP", "SL"].includes(s))
          target = "closed";
        if (cat === target) continue;
        try {
          moveTradeFolder(cleanSid, cat, target, rowInfo.symbol || "");
          moved++;
        } catch {}
      }
    }
    if (moved > 0) console.log("[trade-folder] reconciled", moved, "folders");
  } catch (e) {
    console.error("[trade-folder] reconcile error:", e.message);
  }
}

function legacyTradeSnapshotDir(sid) {
  ensureChartSnapshotDir();
  const safeSid = String(sid || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "_");
  const dir = path.join(CHART_SNAPSHOT_DIR, safeSid);
  if (!dir || dir === CHART_SNAPSHOT_DIR) return CHART_SNAPSHOT_DIR;
  return dir;
}

async function captureStatusSnapshot(tradeSid, symbol, status) {
  if (!tradeSid || !symbol) return;
  const statusLower = String(status || "").toLowerCase();
  if (!["filled", "closed"].includes(statusLower)) return;
  const safeSymbol = String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_-]+:/, "")
    .replace(/[^A-Z0-9]/g, "");
  if (!safeSymbol) return;
  try {
    const created = await captureTradingViewSnapshotsBatch({
      symbols: [symbol],
      provider: "ICMARKETS",
      tfs: ["D", "240", "15", "5"],
      format: "png",
      theme: "dark",
      trade_sid: tradeSid,
    });
    // Rename master file to include status
    const items = Array.isArray(created) ? created : [];
    for (const item of items) {
      const fn = String(item?.file_name || "");
      if (!fn.toUpperCase().includes("_MASTER.")) continue;
      const destDir = tradeSnapshotDir(tradeSid, safeSymbol);
      const newName = `${safeSymbol}_${statusLower}.png`;
      const oldPath = path.join(destDir, fn);
      const newPath = path.join(destDir, newName);
      if (fs.existsSync(oldPath)) {
        try {
          if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
          fs.renameSync(oldPath, newPath);
        } catch {}
      }
    }
  } catch (e) {
    console.error("[status-snapshot] error:", e.message);
  }
}

function migrateLegacyTradeSnapshots(sid, symbol = "") {
  const legacyDir = legacyTradeSnapshotDir(sid);
  if (!legacyDir || !fs.existsSync(legacyDir)) return { copied: 0 };
  const sym = String(symbol || inferSymbolFromTradeFolder(sid) || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_-]+:/, "")
    .replace(/[^A-Z0-9]/g, "");
  if (!sym) return { copied: 0 };
  const destDir = tradeSnapshotDir(sid, sym);
  let copied = 0;
  try {
    for (const entry of fs.readdirSync(legacyDir)) {
      const safe = normalizeSnapshotFileName(entry);
      if (!safe) continue;
      const src = path.join(legacyDir, safe);
      const dest = path.join(destDir, safe);
      try {
        if (!fs.statSync(src).isFile() || fs.existsSync(dest)) continue;
        fs.copyFileSync(src, dest);
        copied += 1;
      } catch {}
    }
  } catch {}
  return { copied };
}

function inferSymbolFromTradeFolder(sid) {
  const safeSid = String(sid || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "_");
  if (!safeSid) return "";
  // Search all categories WITHOUT creating any folder (read-only)
  for (const cat of ["active", "closed", "files"]) {
    const baseDir = TRADE_CATEGORY_DIRS[cat];
    if (!fs.existsSync(baseDir)) continue;
    try {
      const entries = fs.readdirSync(baseDir);
      const match = entries.find(
        (e) =>
          (e === safeSid || e.startsWith(safeSid + "-")) &&
          fs.statSync(path.join(baseDir, e)).isDirectory(),
      );
      if (match && match !== safeSid) {
        // Extract symbol from {sid}-SYMBOL
        const raw = String(match.slice(safeSid.length + 1) || "")
          .trim()
          .toUpperCase();
        return raw.replace(/[^A-Z0-9]/g, "");
      }
    } catch {}
  }
  return "";
}

function listLatestSnapshotFilesForSymbol(symbol = "", limit = 12) {
  ensureChartSnapshotDir();
  const sym = String(symbol || "")
    .trim()
    .toUpperCase();
  if (!sym) return [];

  const symDir = path.join(CHART_SNAPSHOT_DIR, sym);
  if (!fs.existsSync(symDir)) return [];

  const files = fs
    .readdirSync(symDir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .map((f) => {
      let t = 0;
      try {
        t = Number(fs.statSync(path.join(symDir, f)).mtimeMs || 0);
      } catch {}
      return { file_name: f, mtime_ms: t };
    });
  // Group by capture batch (files from same capture share timestamp prefix).
  // Return only the most recent batch to avoid mixing MASTER + individual TFs.
  const byBatch = new Map();
  for (const f of files) {
    // Extract batch key: first 13 chars of the timestamp token in filename
    const m = String(f.file_name || "").match(/_(\d{8}_\d{4})/);
    const batchKey = m ? m[1] : String(f.mtime_ms);
    if (!byBatch.has(batchKey)) byBatch.set(batchKey, []);
    byBatch.get(batchKey).push(f);
  }
  // Sort batches by max mtime (most recent first), take the first batch
  const batches = [...byBatch.entries()]
    .map(([key, items]) => ({
      key,
      items,
      maxTime: Math.max(...items.map((x) => x.mtime_ms)),
    }))
    .sort((a, b) => b.maxTime - a.maxTime);
  const latestBatch = batches[0]?.items || [];
  const sorted = latestBatch
    .sort((a, b) => b.mtime_ms - a.mtime_ms)
    .slice(0, Math.max(1, Number(limit) || 12));
  return sorted.map((x) => x.file_name);
}

function snapshotTimestampToken(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "_")
    .replace("Z", "UTC")
    .replace(".", "_");
}

function copySnapshotsToTradeSidFolder(
  tradeSid,
  files = [],
  symbol = "",
  status = "pending",
) {
  const sid = String(tradeSid || "").trim();
  if (!sid) return [];
  ensureChartSnapshotDir();
  const sym = String(symbol || inferSymbolFromTradeFolder(sid) || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_-]+:/, "")
    .replace(/[^A-Z0-9]/g, "");
  if (!sym) return [];
  const destDir = tradeSnapshotDir(sid, sym);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const requested = (Array.isArray(files) ? files : [])
    .map((f) => normalizeSnapshotFileName(f))
    .filter(Boolean);
  const fallback = requested.length
    ? []
    : listLatestSnapshotFilesForSymbol(symbol, 12);
  const sourceFiles = requested.length ? requested : fallback;
  const copied = [];
  const srcDir = snapshotSymbolDir(symbol);
  for (const fileName of sourceFiles) {
    const safe = normalizeSnapshotFileName(fileName);
    if (!safe) continue;
    const src = path.join(srcDir, safe);
    if (!src || !fs.existsSync(src)) continue;
    const ext = path.extname(safe);
    const base = path.basename(safe, ext);
    const destName = `${base}_${snapshotTimestampToken()}_${status}${ext}`;
    const dest = path.join(destDir, destName);
    try {
      fs.copyFileSync(src, dest);
      copied.push(destName);
    } catch {}
  }
  return copied;
}

function copyAnalyzeSnapshotToTradeSession(tradeSid, symbol = "") {
  const sid = String(tradeSid || "").trim();
  const inferred = inferSymbolFromTradeFolder(sid);
  const sym = String(symbol || inferred || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_-]+:/, "")
    .replace(/[^A-Z0-9]/g, "");
  if (!sid || !sym) return "";
  const srcDir = snapshotSymbolDir(sym);
  const tradeDir = tradeSnapshotDir(sid, sym);
  // If trade folder already has any snapshot, skip
  if (fs.existsSync(tradeDir)) {
    const existing = fs
      .readdirSync(tradeDir)
      .filter((f) => /\.(png|jpe?g)$/i.test(f));
    if (existing.length) return existing[0];
  }
  const sourceDirs = [srcDir, tradeDir];
  let candidates = [];
  for (const dir of sourceDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    try {
      const list = fs
        .readdirSync(dir)
        .filter((f) => /\.(png|jpe?g)$/i.test(f))
        .map((f) => {
          const abs = path.join(dir, f);
          let mtimeMs = 0;
          try {
            mtimeMs = Number(fs.statSync(abs).mtimeMs || 0);
          } catch {}
          return { f, abs, mtimeMs };
        });
      candidates.push(...list);
    } catch {}
  }
  candidates = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!candidates.length) return "";
  const preferred =
    candidates.find((x) => String(x.f).toUpperCase().includes("_MASTER.")) ||
    candidates[0];
  if (!preferred?.abs || !fs.existsSync(preferred.abs)) return "";
  const ext = (path.extname(preferred.f) || ".png").toLowerCase();
  const destName = `${sym}_MASTER_${snapshotTimestampToken()}_pending${ext}`;
  const destDir = tradeDir;
  const dest = path.join(destDir, destName);
  try {
    fs.copyFileSync(preferred.abs, dest);
    return destName;
  } catch {
    return "";
  }
}

async function persistTradeSnapshotFiles(tradeSid, files = [], symbol = "") {
  const sid = String(tradeSid || "").trim();
  const safeFiles = [
    ...new Set(
      (Array.isArray(files) ? files : [])
        .map((f) => normalizeSnapshotFileName(f))
        .filter(Boolean),
    ),
  ];
  if (!sid || !safeFiles.length) return { updated: 0, files: safeFiles };
  const resolvedSymbol = await mt5ResolveTradeFolderSymbol(sid, symbol);
  const safeSym = String(resolvedSymbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Za-z0-9]/g, "");
  const folder = safeSym
    ? `${sid}-${safeSym}/snapshots`
    : `trade-${sid}/snapshots`;
  try {
    const db = await mt5Backend();
    const { eq } = require("drizzle-orm");
    const schema = db.schema || require("../db/schema");

    // Fetch existing trade metadata
    const existing = await db.db
      .select({
        metadata: schema.trades.metadata,
        rawJson: schema.trades.rawJson,
      })
      .from(schema.trades)
      .where(eq(schema.trades.sid, sid))
      .limit(1);

    const existingMeta = dbQueries.parseJsonField(existing[0]?.metadata) || {};
    const existingRaw = dbQueries.parseJsonField(existing[0]?.rawJson) || {};

    // Merge snapshot_files: deduplicate and sort
    const existingFiles = Array.isArray(existingMeta.snapshot_files)
      ? existingMeta.snapshot_files
      : [];
    const mergedSet = new Set([...existingFiles, ...safeFiles].map(String));
    const mergedFiles = [...mergedSet].sort();

    // Build updated objects
    const updatedMeta = {
      ...existingMeta,
      snapshot_files: mergedFiles,
      snapshot_folder: folder,
    };
    const updatedRaw = {
      ...existingRaw,
      snapshot_files: mergedFiles,
      snapshot_folder: folder,
    };

    const { rowCount } = await db.db
      .update(schema.trades)
      .set({
        metadata: dbQueries.jsonField(updatedMeta),
        rawJson: dbQueries.jsonField(updatedRaw),
        updatedAt: new Date(),
      })
      .where(eq(schema.trades.sid, sid));

    return { updated: rowCount || 0, files: safeFiles, folder };
  } catch (error) {
    console.warn(
      "[snapshot] failed to persist trade snapshot refs:",
      error?.message || error,
    );
    return {
      updated: 0,
      files: safeFiles,
      folder,
      error: String(error?.message || error),
    };
  }
}

function cloneJsonForStorage(value) {
  if (!value || typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return Array.isArray(value) ? [...value] : { ...value };
  }
}

function attachCanonicalAiRaw(parsed, canonicalRaw) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const canonical =
    canonicalRaw && typeof canonicalRaw === "object"
      ? cloneJsonForStorage(canonicalRaw)
      : null;
  if (canonical && !parsed.__analysis_full_raw) {
    parsed.__analysis_full_raw = canonical;
  }
  const exactPlans = [];
  const pushPlans = (plans) => {
    if (Array.isArray(plans))
      exactPlans.push(...plans.filter((x) => x && typeof x === "object"));
    else if (plans && typeof plans === "object") exactPlans.push(plans);
  };
  pushPlans(canonical?.trade_plan);
  for (const entry of Array.isArray(canonical?.analysis_data)
    ? canonical.analysis_data
    : []) {
    pushPlans(entry?.trade_plan);
  }
  if (exactPlans.length && !parsed.__ai_trade_plan_raw_exact) {
    parsed.__ai_trade_plan_raw_exact = cloneJsonForStorage(exactPlans);
  }
  return parsed;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseTradeFileName(raw) {
  // Sanitize: keep only safe chars, collapse whitespace, max 200 chars
  return (
    String(raw || "file")
      .replace(/[^a-zA-Z0-9._\-\s]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .substring(0, 200)
      .replace(/^_+|_+$/g, "") || "file"
  );
}

async function parseMultipartFile(req) {
  const contentType = String(req.headers["content-type"] || "");
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!boundaryMatch) throw new Error("No multipart boundary found");
  const boundary = boundaryMatch[1] || boundaryMatch[2];

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);

  const parts = raw.toString("binary").split(`--${boundary}`);
  for (const part of parts) {
    if (!part.includes("Content-Disposition") || part.startsWith("--"))
      continue;

    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headerSection = part.substring(0, headerEnd);
    const bodyStart = headerEnd + 4;
    let body = part.substring(bodyStart);
    // Remove trailing \r\n
    if (body.endsWith("\r\n")) body = body.substring(0, body.length - 2);

    const nameMatch = headerSection.match(/name="([^"]+)"/);
    const filenameMatch = headerSection.match(/filename="([^"]+)"/);
    if (nameMatch && filenameMatch) {
      return {
        fieldName: nameMatch[1],
        fileName: parseTradeFileName(filenameMatch[1]),
        data: Buffer.from(body, "binary"),
      };
    }
  }
  throw new Error("No file found in multipart body");
}

function sanitizeSnapshotToken(value, fallback = "chart") {
  const raw = String(value || fallback)
    .trim()
    .toUpperCase();
  const token = raw
    .replace(/[^A-Z0-9:_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token || fallback;
}

function sanitizeSnapshotFileToken(value, fallback = "chart") {
  let raw = String(value || fallback)
    .trim()
    .toUpperCase();
  // Strip provider prefix: "ICMARKETS:BTCUSD" → "BTCUSD"
  if (raw.includes(":")) {
    raw = raw.split(":").pop().trim();
  }
  const token = raw
    .replace(/[^A-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token || fallback;
}

function sanitizeSessionPrefix(value, fallback = "") {
  const raw = String(value || "")
    .trim()
    .toUpperCase();
  const token = raw
    .replace(/[^A-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (token) return token.slice(0, 32);
  return String(fallback || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "_")
    .slice(0, 32);
}

function normalizePublicSidBase(raw, fallbackPrefix = "ID") {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();

  // If it's already a valid 9-char alphanumeric ID, keep it.
  // Otherwise, ignore the messy input and generate a clean 9-char SID.
  if (cleaned.length === 9) return cleaned;

  return mt5GenerateTimeSid();
}

function snapshotTimestampToken(dateLike = Date.now()) {
  const d = new Date(dateLike);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}:${mi}`;
}

function toTradingViewInterval(tfRaw) {
  const tf = String(tfRaw || "5")
    .trim()
    .toLowerCase();
  if (!tf) return "5";
  if (/^\d+$/.test(tf)) return tf;
  if (tf.endsWith("m")) return tf.slice(0, -1) || "5";
  if (tf.endsWith("h")) return String(Number(tf.slice(0, -1) || "1") * 60);
  if (tf.endsWith("d")) return "D";
  if (tf.endsWith("w")) return "W";
  if (tf.endsWith("mo") || tf.endsWith("mth")) return "M";
  return tf.toUpperCase();
}

function toTradingViewSymbol(inputSymbol, provider) {
  const raw = String(inputSymbol || "")
    .trim()
    .toUpperCase();
  if (!raw) return "BTCUSD";
  if (raw.includes(":")) return raw;
  const prov = String(provider || "")
    .trim()
    .toUpperCase();
  // If provider is not explicitly passed, keep symbol untouched.
  if (!prov) return raw;
  const isForex = /^[A-Z]{6}$/.test(raw);
  const isMetal = raw.startsWith("XAU") || raw.startsWith("XAG");
  const isCrypto =
    raw.endsWith("USDT") ||
    raw.endsWith("USD") ||
    [
      "BTC",
      "ETH",
      "SOL",
      "XRP",
      "ADA",
      "DOGE",
      "BNB",
      "DOT",
      "MATIC",
      "NEAR",
      "ATOM",
      "ETC",
    ].some((x) => raw.startsWith(x));
  if (prov === "BINANCE")
    return `BINANCE:${raw.endsWith("USD") ? raw.replace(/USD$/, "USDT") : raw}`;
  if (prov === "OANDA") return `OANDA:${raw}`;
  if (prov === "ICMARKETS") {
    // Keep raw symbol for broker feed to let TradingView auto-resolve
    // the best exchange for instruments like XAUGBP/XAUJPY/etc.
    return raw;
  }
  // Default fallback: avoid hard-forcing exchange prefixes.
  return raw;
}

function cleanTvHtmlMarker(text) {
  return String(text || "")
    .replace(/<\/?em>/gi, "")
    .trim();
}

async function fetchTradingViewSymbolSearch(
  textRaw,
  exchangeRaw = "",
  limitRaw = 10,
) {
  const text = String(textRaw || "").trim();
  if (!text) return [];
  const exchange = String(exchangeRaw || "")
    .trim()
    .toUpperCase();
  const limit = Math.max(1, Math.min(Number(limitRaw || 10) || 10, 50));
  const qs = new URLSearchParams({
    text,
    hl: "1",
    lang: "en",
    domain: "production",
  });
  if (exchange) qs.set("exchange", exchange);
  const endpoint = `https://symbol-search.tradingview.com/symbol_search/?${qs.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(endpoint, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Origin: "https://www.tradingview.com",
        Referer: "https://www.tradingview.com/",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!res.ok) return [];
    const out = await res.json().catch(() => []);
    if (!Array.isArray(out)) return [];
    return out.slice(0, limit).map((row) => {
      const prefix = String(
        row?.prefix || row?.source_id || row?.exchange || "",
      ).toUpperCase();
      const symbol = cleanTvHtmlMarker(row?.symbol || "");
      return {
        symbol,
        prefix,
        full_symbol: prefix && symbol ? `${prefix}:${symbol}` : symbol,
        exchange: String(
          row?.exchange || row?.source2?.name || row?.source_id || "",
        ).trim(),
        description: cleanTvHtmlMarker(row?.description || ""),
        type: String(row?.type || ""),
        provider_id: String(row?.provider_id || ""),
        source_id: String(row?.source_id || ""),
      };
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTradingViewSymbolForCapture(inputSymbol, broker) {
  const sym = String(inputSymbol || "")
    .trim()
    .toUpperCase();
  if (!sym) return "BTCUSD";
  const brk = String(broker || "")
    .trim()
    .toUpperCase();
  if (!brk) return sym;
  const normalize = (v) =>
    String(v || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  try {
    const items = await fetchTradingViewSymbolSearch(sym, brk, 20);
    const exact = items.find((it) => normalize(it?.symbol) === normalize(sym));
    if (exact?.full_symbol) return String(exact.full_symbol).toUpperCase();
  } catch {}
  // Fallback: do not force broker prefix for unresolved broker-symbol pairs.
  return brk === "ICMARKETS" ? sym : `${brk}:${sym}`;
}

function loadPlaywrightMaybe() {
  try {
    return require("playwright");
  } catch {}
  try {
    return require(
      path.join(__dirname, "..", "web-ui", "node_modules", "playwright"),
    );
  } catch {}
  return null;
}

async function loginToTradingView(username, password) {
  const playwright = loadPlaywrightMaybe();
  if (!playwright) throw new Error("Playwright not installed");

  const executablePath = resolvePlaywrightChromiumExecutablePath();
  const browser = await playwright.chromium.launch({
    executablePath: executablePath || undefined,
    headless: true,
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);

    console.log("[tv-login] Navigating to signin...");
    await page.goto("https://www.tradingview.com/signin/", {
      waitUntil: "networkidle",
    });

    // Wait for any 'Email' login button or the actual form
    try {
      await page.waitForTimeout(2000); // Give it a moment to settle

      // Try to dismiss potential cookie banners that might block interaction
      try {
        const cookieBtn = page
          .locator(
            'button:has-text("Accept"), button:has-text("Agree"), button:has-text("I agree")',
          )
          .first();
        if (await cookieBtn.isVisible()) {
          await cookieBtn.click();
          await page.waitForTimeout(500);
        }
      } catch (e) {}

      const emailOptions = [
        'button:has-text("Email")',
        'span:has-text("Email")',
        'div[name="Email"]',
        ".tv-signin-dialog__social-button--email",
        'a[href*="email"]',
      ];

      let clicked = false;
      for (const sel of emailOptions) {
        const loc = page.locator(sel).first();
        if (await loc.isVisible()) {
          console.log(`[tv-login] Clicking email option: ${sel}`);
          await loc.click();
          clicked = true;
          await page.waitForLoadState("networkidle");
          break;
        }
      }
      if (!clicked) {
        console.log(
          "[tv-login] No explicit 'Email' button found, checking for inputs directly...",
        );
      }
    } catch (e) {
      console.log(
        "[tv-login] Search for email button failed/timed out:",
        e.message,
      );
    }

    // Wait for inputs to be available
    console.log("[tv-login] Waiting for username input...");
    await page.waitForSelector('input[name="username"]', {
      state: "visible",
      timeout: 20000,
    });

    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', password);

    console.log("[tv-login] Submitting credentials...");
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForURL(
        (url) =>
          url.origin === "https://www.tradingview.com" &&
          !url.pathname.includes("signin"),
        { timeout: 60000 },
      ),
    ]);

    const cookies = await context.cookies();
    const sessionPath = path.join(ROOT_DIR, "tv_session.json");
    fs.writeFileSync(sessionPath, JSON.stringify(cookies));
    console.log("[tv-login] Session saved to", sessionPath);

    return { ok: true, message: "Login successful" };
  } catch (err) {
    console.error("[tv-login] Error:", err.message);
    try {
      if (page) {
        const debugPath = path.join(
          CHART_SNAPSHOT_DIR,
          `login_error_latest.png`,
        );
        await page.screenshot({ path: debugPath, fullPage: true });
        console.log("[tv-login] Latest error screenshot saved to:", debugPath);
        err.message += ` (Debug screenshot saved: login_error_latest.png)`;
      }
    } catch (e) {
      console.error("[tv-login] Failed to take error screenshot:", e.message);
    }
    throw err;
  } finally {
    await browser.close();
  }
}

function resolvePlaywrightChromiumExecutablePath() {
  const fromEnv = String(
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
      "",
  ).trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  try {
    // Resolve platform-appropriate cache dir
    const home = process.env.HOME || process.env.USERPROFILE || "/root";
    const cacheDirs = [
      path.join(home, "Library", "Caches", "ms-playwright"), // macOS
      path.join(home, ".cache", "ms-playwright"), // Linux
      "/root/.cache/ms-playwright", // Linux root
    ];
    const base = cacheDirs.find((d) => fs.existsSync(d));
    if (!base) return "";
    const entries = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^chromium-\d+$/.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => {
        const na = Number(a.split("-")[1] || 0);
        const nb = Number(b.split("-")[1] || 0);
        return nb - na;
      });
    for (const name of entries) {
      const candidates = [
        path.join(
          base,
          name,
          "chrome-mac-arm64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        path.join(
          base,
          name,
          "chrome-mac",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        path.join(base, name, "chrome-linux64", "chrome"),
        path.join(base, name, "chrome-linux", "chrome"),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch {}
  return "";
}

async function captureTradingViewSnapshotWithBrowser(browser, opts = {}) {
  ensureChartSnapshotDir();
  const symbolRaw = normalizeMarketDataSymbol(opts.symbol || "");
  const symbol = symbolRaw || "BTCUSD";
  const tvSymbol = await resolveTradingViewSymbolForCapture(
    symbol,
    opts.provider,
  );
  const interval = toTradingViewInterval(opts.timeframe || opts.tf);
  const width = Math.max(480, Math.min(Number(opts.width || 960) || 960, 2400));
  const height = Math.max(
    270,
    Math.min(Number(opts.height || 540) || 540, 1600),
  );
  const theme =
    String(opts.theme || "dark").toLowerCase() === "light" ? "light" : "dark";
  const tz = normalizeTvTimezone(opts.timezone, "Etc/UTC");
  const lookbackBars = Math.max(
    50,
    Math.min(Number(opts.lookbackBars || 300) || 300, 5000),
  );
  const outFormatRaw = String(opts.format || "png").toLowerCase();
  const outFormat =
    outFormatRaw === "jpg" || outFormatRaw === "jpeg" ? "jpg" : "png";
  const jpgQuality = Math.max(
    20,
    Math.min(Number(opts.quality || 90) || 90, 95),
  );

  const ts = Date.now();
  const symbolToken = sanitizeSnapshotFileToken(symbol);
  const tfToken = sanitizeSnapshotFileToken(interval, "TF");
  const userId = sanitizeSnapshotFileToken(opts.userId || "default");

  // Simple naming: SYMBOL_TF.png — overwrites on re-capture
  const fileName = `${symbolToken}_${tfToken}.${outFormat}`;
  const outPath = path.join(snapshotSymbolDir(symbol), fileName);

  // Reuse existing snapshot if it was captured within the last 60 seconds
  // (cron takes snapshots every minute — no need to re-capture)
  if (fs.existsSync(outPath)) {
    try {
      const st = fs.statSync(outPath);
      const ageMs = Date.now() - Number(st.mtimeMs || 0);
      const maxAge = Number(opts.maxReuseAgeMs || 60000);
      if (ageMs < maxAge) {
        return {
          file_name: fileName,
          symbol: opts.symbol,
          timeframe: opts.timeframe || opts.tf,
          reused: true,
        };
      }
    } catch (_) {}
  }
  const sessionPath = path.join(ROOT_DIR, "tv_session.json");
  let savedCookies = [];
  if (fs.existsSync(sessionPath)) {
    try {
      savedCookies = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
    } catch (e) {}
  }

  const context = await browser.newContext({
    viewport: { width: width, height: height },
    deviceScaleFactor: 1,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  if (savedCookies.length > 0) {
    await context.addCookies(savedCookies);
  }
  try {
    const page = await context.newPage();

    const embedUrl = new URL("https://s.tradingview.com/widgetembed/");
    embedUrl.searchParams.set("symbol", tvSymbol);
    embedUrl.searchParams.set("interval", interval);
    embedUrl.searchParams.set("theme", theme);
    embedUrl.searchParams.set("style", "1");
    embedUrl.searchParams.set("timezone", tz === "LOCAL" ? "Etc/UTC" : tz);
    embedUrl.searchParams.set("hide_side_toolbar", "1");
    embedUrl.searchParams.set("hide_top_toolbar", "1");
    embedUrl.searchParams.set("hide_legend", "1");
    embedUrl.searchParams.set("withdateranges", "0");
    embedUrl.searchParams.set("allow_symbol_change", "0");
    embedUrl.searchParams.set("save_image", "0");
    embedUrl.searchParams.set("show_popup_button", "0");
    embedUrl.searchParams.set("locale", "en");

    console.log(`[snapshot] Navigating to ${embedUrl.toString()}`);
    await page.goto(embedUrl.toString(), { waitUntil: "networkidle" });

    // Wait for the chart to stabilize
    await page.waitForTimeout(8000);

    // Nuke UI elements that don't respect the URL parameters
    await page.evaluate(() => {
      const hideTags = (tags) => {
        tags.forEach((t) => {
          document.querySelectorAll(t).forEach((el) => {
            el.style.setProperty("display", "none", "important");
            el.style.setProperty("visibility", "hidden", "important");
            el.style.setProperty("opacity", "0", "important");
            el.style.setProperty("pointer-events", "none", "important");
            el.style.setProperty("height", "0", "important");
          });
        });
      };

      // Comprehensive list of selectors for the public widgetembed
      hideTags([
        ".header-chart-panel",
        ".left-panel",
        ".legend",
        ".chart-controls",
        ".tv-floating-toolbar",
        ".tv-market-status",
        ".widgetbar-wrap",
        '[class*="header-chart-panel"]',
        '[class*="left-panel"]',
        '[class*="legend-"]',
        '[class*="chart-controls"]',
        '[class*="toolbar-"]',
        '[class*="button-"]',
        '[class*="menu-"]',
        "#page-pi-loading",
      ]);

      // Ensure the chart container takes the whole space if it was offset
      const mainContainer =
        document.querySelector(".chart-container") ||
        document.querySelector('[class*="chart-container"]');
      if (mainContainer) {
        mainContainer.style.setProperty("top", "0", "important");
        mainContainer.style.setProperty("left", "0", "important");
        mainContainer.style.setProperty("width", "100%", "important");
        mainContainer.style.setProperty("height", "100%", "important");
        mainContainer.style.setProperty("margin", "0", "important");
        mainContainer.style.setProperty("padding", "0", "important");
      }

      const chartGui = document.querySelector(".chart-gui-wrapper");
      if (chartGui) {
        chartGui.style.setProperty("top", "0", "important");
      }
    });

    await page.evaluate(
      ({ wmSymbol, wmTf }) => {
        try {
          const existing = document.getElementById("snapshot-watermark-top");
          if (existing) existing.remove();
          const watermark = document.createElement("div");
          watermark.id = "snapshot-watermark-top";
          watermark.textContent = `${wmSymbol} | ${wmTf}`;
          watermark.style.position = "fixed";
          watermark.style.left = "10px";
          watermark.style.top = "8px";
          watermark.style.zIndex = "2147483647";
          watermark.style.padding = "7px 10px";
          watermark.style.borderRadius = "6px";
          watermark.style.fontSize = "15px";
          watermark.style.fontFamily = "monospace";
          watermark.style.fontWeight = "900";
          watermark.style.letterSpacing = "0";
          watermark.style.background = "rgba(255,255,255,0.94)";
          watermark.style.color = "#07111f";
          watermark.style.border = "2px solid rgba(0,0,0,0.88)";
          watermark.style.boxShadow =
            "0 0 0 2px rgba(255,255,255,0.65), 0 4px 16px rgba(0,0,0,0.65)";
          watermark.style.textShadow = "0 1px 0 rgba(255,255,255,0.9)";
          watermark.style.pointerEvents = "none";
          document.body.appendChild(watermark);
        } catch {}
      },
      { wmSymbol: symbol, wmTf: interval },
    );

    await page.waitForTimeout(1000);
    const watermarkVisible = await page.evaluate(() => {
      const el = document.getElementById("snapshot-watermark-top");
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const styles = window.getComputedStyle(el);
      return (
        r.width > 40 &&
        r.height > 14 &&
        styles.visibility !== "hidden" &&
        styles.display !== "none"
      );
    });
    if (!watermarkVisible) {
      throw new Error("snapshot_watermark_not_visible_before_capture");
    }

    const root = page;

    let shotOk = false;
    let lastShotErr = null;
    // Retry element screenshot once; Playwright can timeout waiting for "stable" element under load.
    for (let i = 0; i < 2 && !shotOk; i += 1) {
      try {
        if (outFormat === "png") {
          await root.screenshot({
            path: outPath,
            type: "png",
            animations: "disabled",
            timeout: 20000,
          });
        } else {
          await root.screenshot({
            path: outPath,
            type: "jpeg",
            quality: jpgQuality,
            animations: "disabled",
            timeout: 20000,
          });
        }
        shotOk = true;
      } catch (e) {
        lastShotErr = e;
        await page.waitForTimeout(500);
      }
    }
    if (!shotOk) {
      // Fallback: clip from page screenshot (avoids locator stability checks/scroll actions).
      const box = await page.evaluate(() => {
        const el = document.querySelector("#tv-root");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: Math.max(0, Math.floor(r.left)),
          y: Math.max(0, Math.floor(r.top)),
          width: Math.max(1, Math.floor(r.width)),
          height: Math.max(1, Math.floor(r.height)),
        };
      });
      if (!box)
        throw lastShotErr || new Error("Chart root not found for screenshot");
      if (outFormat === "png") {
        await page.screenshot({
          path: outPath,
          type: "png",
          clip: box,
          animations: "disabled",
          timeout: 20000,
        });
      } else {
        await page.screenshot({
          path: outPath,
          type: "jpeg",
          quality: jpgQuality,
          clip: box,
          animations: "disabled",
          timeout: 20000,
        });
      }
    }

    // Anti-blank safeguard: small files are often blank/failed iframe frames. Retry once with extra wait.
    try {
      const st1 = fs.statSync(outPath);
      const minBytes = outFormat === "png" ? 16000 : 12000;
      if (Number(st1.size || 0) < minBytes) {
        await page.waitForTimeout(2200);
        const box = await page.evaluate(() => {
          const el = document.querySelector("#tv-root");
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            x: Math.max(0, Math.floor(r.left)),
            y: Math.max(0, Math.floor(r.top)),
            width: Math.max(1, Math.floor(r.width)),
            height: Math.max(1, Math.floor(r.height)),
          };
        });
        if (box) {
          try {
            if (outFormat === "png") {
              await page.screenshot({
                path: outPath,
                type: "png",
                clip: box,
                animations: "disabled",
                timeout: 20000,
              });
            } else {
              await page.screenshot({
                path: outPath,
                type: "jpeg",
                quality: jpgQuality,
                clip: box,
                animations: "disabled",
                timeout: 20000,
              });
            }
          } catch (screenErr) {
            lastShotErr = screenErr;
          }
        }
      }
    } catch {
      // ignore fallback failure
    }

    // Last-resort fallback for cases where Playwright screenshot hangs on "waiting for fonts to load".
    try {
      const st = fs.statSync(outPath);
      const minBytes = outFormat === "png" ? 12000 : 9000;
      if (Number(st.size || 0) < minBytes) {
        throw new Error("screenshot_too_small");
      }
    } catch {
      const box = await page.evaluate(() => {
        const el = document.querySelector("#tv-root");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: Math.max(0, Number(r.left || 0)),
          y: Math.max(0, Number(r.top || 0)),
          width: Math.max(1, Number(r.width || 0)),
          height: Math.max(1, Number(r.height || 0)),
        };
      });
      if (!box)
        throw (
          lastShotErr || new Error("Chart root not found for CDP screenshot")
        );
      const cdp = await context.newCDPSession(page);
      const shot = await cdp.send("Page.captureScreenshot", {
        format: outFormat === "png" ? "png" : "jpeg",
        quality: outFormat === "png" ? undefined : jpgQuality,
        fromSurface: true,
        captureBeyondViewport: false,
        clip: {
          x: Number(box.x),
          y: Number(box.y),
          width: Number(box.width),
          height: Number(box.height),
          scale: 1,
        },
      });
      if (!shot?.data)
        throw lastShotErr || new Error("CDP screenshot returned empty payload");
      fs.writeFileSync(outPath, Buffer.from(String(shot.data), "base64"));
    }
  } finally {
    try {
      await context.close();
    } catch {}
  }

  const st = fs.statSync(outPath);
  const result = {
    id: fileName.replace(/\.(png|jpe?g)$/i, ""),
    file_name: fileName,
    symbol,
    tv_symbol: tvSymbol,
    timeframe: interval,
    provider: String(opts.provider || ""),
    theme,
    width,
    height,
    lookback_bars: lookbackBars,
    format: outFormat,
    created_at: new Date(st.mtimeMs || Date.now()).toISOString(),
    size_bytes: Number(st.size || 0),
    url: `/v2/chart/snapshots/${encodeURIComponent(symbol)}/${encodeURIComponent(fileName)}`,
  };
  emitSnapshotCreatedNotification({
    userId: opts.userId || null,
    symbol: result.symbol,
    timeframe: result.timeframe,
    fileName: result.file_name,
    reused: false,
  });
  return result;
}

function isLikelyChromiumCrash(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    msg.includes("target crashed") ||
    msg.includes("page crashed") ||
    msg.includes("browser has been closed") ||
    msg.includes("target page, context or browser has been closed")
  );
}

async function captureTradingViewSnapshot(opts = {}) {
  const playwright = loadPlaywrightMaybe();
  if (!playwright || !playwright.chromium) {
    throw new Error(
      "Playwright not found. Install in webhook or web-ui workspace.",
    );
  }
  const executablePath = resolvePlaywrightChromiumExecutablePath();
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const browser = await playwright.chromium.launch({
      headless: true,
      executablePath: executablePath || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
      ],
    });
    try {
      return await captureTradingViewSnapshotWithBrowser(browser, opts);
    } catch (error) {
      lastErr = error;
      if (attempt === 0 && isLikelyChromiumCrash(error)) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      throw error;
    } finally {
      await browser.close();
    }
  }
  throw lastErr || new Error("snapshot_failed");
}

async function captureTradingViewSnapshotsBatch(opts = {}) {
  const playwright = loadPlaywrightMaybe();
  if (!playwright || !playwright.chromium) {
    throw new Error(
      "Playwright not found. Install in webhook or web-ui workspace.",
    );
  }
  const inputTfs = Array.isArray(opts.timeframes)
    ? opts.timeframes
    : Array.isArray(opts.tfs)
      ? opts.tfs
      : [];
  const normalized = inputTfs
    .map((tf) => String(tf || "").trim())
    .filter(Boolean)
    .slice(0, 10);
  const timeframes = normalized.length ? normalized : ["15m", "4h", "1D"];
  const symbols = (
    Array.isArray(opts.symbols) && opts.symbols.length
      ? opts.symbols
      : [opts.symbol]
  )
    .map((s) => {
      const raw = String(s || "").trim();
      if (/^\[object\s+promise\]$/i.test(raw)) return "";
      return normalizeMarketDataSymbol(raw);
    })
    .filter(Boolean)
    .slice(0, 50);
  if (!symbols.length) {
    throw new Error("symbol or symbols is required");
  }
  const tasks = [];
  for (const symbol of symbols) {
    for (const tf of timeframes) tasks.push({ symbol, tf });
  }
  const requestedConcurrency = Math.max(
    1,
    Math.min(
      3,
      Math.floor(
        asNum(
          opts.captureConcurrency,
          asNum(process.env.SNAPSHOT_CAPTURE_CONCURRENCY, 1),
        ),
      ),
    ),
  );
  const concurrency = Math.min(requestedConcurrency, tasks.length);
  const executablePath = resolvePlaywrightChromiumExecutablePath();
  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: executablePath || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
  try {
    const mergeSnapshots =
      opts.merge_snapshots !== undefined
        ? Boolean(opts.merge_snapshots)
        : ALL_SNAPSHOTS_IN_1_FILE_DEFAULT;
    if (mergeSnapshots) {
      // Deduplicate and sort timeframes: highest TF first
      const uniqueTfs = canonicalizeTfList(timeframes);
      // Keep grid capture single-threaded per batch to avoid Chromium context
      // instability under cron load ("Target page/context/browser closed").
      const maxConcurrent = 1;
      const results = new Array(symbols.length);
      let nextIdx = 0;

      const captureOne = async (symbol) => {
        const ext =
          opts.format === "jpg" || opts.format === "jpeg" ? "jpg" : "png";
        const brokerSymbol = await resolveTradingViewSymbolForCapture(
          symbol,
          opts.provider,
        );
        const outFileName = `${symbol}_MASTER.${ext}`;
        const outPath = path.join(snapshotSymbolDir(symbol), outFileName);
        const tz = encodeURIComponent(
          normalizeTvTimezone(opts.timezone, "Etc/UTC"),
        );
        const providerQ = encodeURIComponent(String(opts.provider || ""));
        const gridUrl = `http://localhost:${CFG.port}/v2/chart/snapshots-grid/${encodeURIComponent(brokerSymbol)}?tfs=${uniqueTfs.join(",")}&theme=${opts.theme || "dark"}&tz=${tz}&provider=${providerQ}&capture=1`;

        const context = await browser.newContext({
          viewport: { width: 1920, height: 1080 },
          deviceScaleFactor: 2,
          ignoreHTTPSErrors: true,
        });
        try {
          const page = await context.newPage();
          console.log(`[snapshot-grid] Capturing master grid for ${symbol}`);
          const renderWaitMs = Math.max(
            3000,
            Math.floor(asNum(process.env.SNAPSHOT_GRID_RENDER_WAIT_MS, 9000)),
          );
          const readyTimeoutMs = Math.max(
            10000,
            Math.floor(
              asNum(process.env.SNAPSHOT_GRID_READY_TIMEOUT_MS, 30000),
            ),
          );
          await page.goto(gridUrl, { waitUntil: "load", timeout: 90000 });
          await page.waitForTimeout(renderWaitMs);
          await page
            .waitForLoadState("networkidle", { timeout: 15000 })
            .catch(() => {});
          // Wait for at least one TradingView iframe to render chart canvas
          try {
            await page.waitForFunction(
              () => {
                const iframes = document.querySelectorAll("iframe");
                return [...iframes].some((f) => {
                  try {
                    return f.contentDocument?.querySelector?.(
                      "canvas, .chart-markup-table",
                    );
                  } catch {
                    return false;
                  }
                });
              },
              { timeout: readyTimeoutMs },
            );
            // Extra wait for bars to render after canvas appears
            await page.waitForTimeout(5000);
          } catch {
            /* continue even if not fully loaded */
          }
          const ok = await page.evaluate(() => {
            const badges = [
              ...document.querySelectorAll(".grid-meta-badge,.tf-badge"),
            ];
            if (!badges.length) return false;
            return badges.every((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            });
          });
          if (!ok)
            throw new Error(
              "snapshot_grid_watermark_not_visible_before_capture",
            );
          await page.screenshot({
            path: outPath,
            type:
              opts.format === "jpeg" || opts.format === "jpg" ? "jpeg" : "png",
            quality:
              opts.format === "jpeg" || opts.format === "jpg" ? 90 : undefined,
            fullPage: true,
          });
          emitSnapshotCreatedNotification({
            userId: opts.userId || null,
            symbol,
            timeframe: uniqueTfs.join(","),
            fileName: outFileName,
            reused: false,
          });
          return {
            symbol,
            timeframe: uniqueTfs.join(","),
            status: "ok",
            file_name: outFileName,
            url: `/v2/chart/snapshots/${encodeURIComponent(symbol)}/${outFileName}`,
            master: true,
          };
        } catch (e) {
          console.error(`[snapshot-grid] Failed ${symbol}:`, e.message);
          return { symbol, status: "error", error: e.message };
        } finally {
          await context.close();
        }
      };

      const worker = async () => {
        while (nextIdx < symbols.length) {
          const idx = nextIdx++;
          results[idx] = await captureOne(symbols[idx]);
        }
      };

      await Promise.all(Array.from({ length: maxConcurrent }, () => worker()));
      return results.filter(Boolean);
    }

    const items = new Array(tasks.length);
    let cursor = 0;

    async function worker() {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= tasks.length) return;
        const task = tasks[idx];
        try {
          const one = await captureTradingViewSnapshotWithBrowser(browser, {
            ...opts,
            symbol: task.symbol,
            timeframe: task.tf,
            tf: task.tf,
          });
          items[idx] = one;
        } catch (error) {
          if (isLikelyChromiumCrash(error)) {
            const one = await captureTradingViewSnapshot({
              ...opts,
              symbol: task.symbol,
              timeframe: task.tf,
              tf: task.tf,
            });
            items[idx] = one;
          } else {
            throw error;
          }
        }
      }
    }

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
    return items;
  } finally {
    await browser.close();
  }
}

function snapshotMimeByFileName(fileName) {
  const n = String(fileName || "").toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  return "";
}

function fileMimeByName(fileName, fallback = "") {
  return (
    snapshotMimeByFileName(fileName) ||
    contentTypeByExt(fileName) ||
    fallback ||
    "application/octet-stream"
  );
}

function readClaudeSnapshotFileMap() {
  ensureChartSnapshotDir();
  try {
    if (!fs.existsSync(CHART_SNAPSHOT_CLAUDE_MAP_FILE)) return {};
    const parsed = JSON.parse(
      fs.readFileSync(CHART_SNAPSHOT_CLAUDE_MAP_FILE, "utf8"),
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function writeClaudeSnapshotFileMap(map = {}) {
  ensureChartSnapshotDir();
  const tmp = `${CHART_SNAPSHOT_CLAUDE_MAP_FILE}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify(map && typeof map === "object" ? map : {}, null, 2),
  );
  fs.renameSync(tmp, CHART_SNAPSHOT_CLAUDE_MAP_FILE);
}

function getMappedClaudeSnapshotFile(fileName, absPath) {
  const safeName = normalizeSnapshotFileName(fileName);
  if (!safeName || !absPath || !fs.existsSync(absPath)) return null;
  const map = readClaudeSnapshotFileMap();
  const item = map[safeName];
  if (!item || typeof item !== "object" || !item.file_id) return null;
  try {
    const st = fs.statSync(absPath);
    if (Number(item.size_bytes || 0) !== Number(st.size || 0)) return null;
    if (Number(item.mtime_ms || 0) !== Number(st.mtimeMs || 0)) return null;
    return item;
  } catch {
    return null;
  }
}

function setMappedClaudeSnapshotFile(fileName, absPath, uploaded = {}) {
  const safeName = normalizeSnapshotFileName(fileName);
  if (!safeName || !uploaded?.id || !absPath || !fs.existsSync(absPath))
    return null;
  const st = fs.statSync(absPath);
  const map = readClaudeSnapshotFileMap();
  const item = {
    local_file: safeName,
    file_id: String(uploaded.id || ""),
    filename: String(uploaded.filename || safeName),
    mime_type: String(
      uploaded.mime_type || snapshotMimeByFileName(safeName) || "",
    ),
    size_bytes: Number(uploaded.size_bytes || st.size || 0),
    mtime_ms: Number(st.mtimeMs || 0),
    created_at: String(uploaded.created_at || new Date().toISOString()),
    uploaded_at: new Date().toISOString(),
    source: "chart_snapshot",
  };
  map[safeName] = item;
  writeClaudeSnapshotFileMap(map);
  return item;
}

function removeMappedClaudeSnapshotFiles(fileNames = []) {
  const map = readClaudeSnapshotFileMap();
  let changed = false;
  for (const fileNameRaw of fileNames || []) {
    const safe = normalizeSnapshotFileName(fileNameRaw);
    if (safe && map[safe]) {
      delete map[safe];
      changed = true;
    }
  }
  if (changed) writeClaudeSnapshotFileMap(map);
}

let _claudeFilesCache = { data: [], expiresAt: 0 };
function bustClaudeFilesCache() {
  _claudeFilesCache = { data: [], expiresAt: 0 };
}
async function anthropicListFiles(apiKey) {
  if (!apiKey) return [];
  try {
    const res = await anthropicFilesRequest({ apiKey, pathName: "/v1/files" });
    const list = Array.isArray(res.data) ? res.data : [];
    return list;
  } catch (e) {
    console.error("[anthropic] Failed to list files:", e.message);
    return [];
  }
}

async function loadClaudeApiKeyForUser(userId) {
  const db = await mt5InitBackend();
  // Try specific userId first, then fallback to null (global keys)
  for (const uid of [userId, null]) {
    const cfgRows = await db.query(
      "SELECT name, data FROM user_settings WHERE " +
        (uid === null ? "user_id IS NULL" : "user_id = $1") +
        " AND type = 'api_key'",
      uid === null ? [] : [uid],
    );
    for (const row of cfgRows.rows || []) {
      const name = normalizeAiApiKeyName(row?.name);
      if (name !== "CLAUDE_API_KEY") continue;
      const dec = decryptObject(
        row?.data && typeof row.data === "object" ? row.data : {},
      );
      const value = String(dec?.value || dec?.api_key || "").trim();
      if (value) return value;
    }
  }
  return "";
}

async function anthropicFilesRequest({
  apiKey,
  method = "GET",
  pathName = "/v1/files",
  body = undefined,
  timeoutMs = 30000,
}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers = {
    "x-api-key": String(apiKey || ""),
    "anthropic-version": "2023-06-01",
    "anthropic-beta": ANTHROPIC_FILES_BETA,
  };
  try {
    const res = await fetch(`https://api.anthropic.com${pathName}`, {
      method,
      signal: ctrl.signal,
      headers,
      body,
    });
    const text = await res.text().catch(() => "");
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) {
      const msg =
        parsed?.error?.message ||
        parsed?.message ||
        text ||
        `${res.status} ${res.statusText}`;
      throw new Error(`Claude Files API Error (${res.status}): ${msg}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function anthropicFilesRawRequest({
  apiKey,
  method = "GET",
  pathName = "/v1/files",
  timeoutMs = 30000,
}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers = {
    "x-api-key": String(apiKey || ""),
    "anthropic-version": "2023-06-01",
    "anthropic-beta": ANTHROPIC_FILES_BETA,
  };
  try {
    const res = await fetch(`https://api.anthropic.com${pathName}`, {
      method,
      signal: ctrl.signal,
      headers,
    });
    const contentType = String(
      res.headers.get("content-type") || "application/octet-stream",
    );
    const disposition = String(res.headers.get("content-disposition") || "");
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      let parsed = {};
      const text = buffer.toString("utf8");
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = { raw: text };
      }
      const msg =
        parsed?.error?.message ||
        parsed?.message ||
        text ||
        `${res.status} ${res.statusText}`;
      throw new Error(`Claude Files API Error (${res.status}): ${msg}`);
    }
    return { buffer, contentType, disposition };
  } finally {
    clearTimeout(timer);
  }
}

async function uploadSnapshotToClaudeFile({
  apiKey,
  fileName,
  absPath,
  mediaType,
}) {
  const cached = getMappedClaudeSnapshotFile(fileName, absPath);
  if (cached?.file_id) return { ...cached, reused: true };
  const safeName = normalizeSnapshotFileName(fileName);
  if (!safeName || !absPath || !fs.existsSync(absPath))
    throw new Error("Invalid snapshot file for Claude upload.");
  const bytes = fs.readFileSync(absPath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mediaType }), safeName);
  const uploaded = await anthropicFilesRequest({
    apiKey,
    method: "POST",
    pathName: "/v1/files",
    body: form,
    timeoutMs: 45000,
  });
  const mapped = setMappedClaudeSnapshotFile(safeName, absPath, uploaded);
  return { ...(mapped || uploaded), reused: false };
}

function buildBase64SnapshotContent(snapshotFiles = []) {
  const content = [];
  const usedFiles = [];
  for (const item of snapshotFiles || []) {
    const b64 = fs.readFileSync(item.abs).toString("base64");
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: item.mediaType,
        data: b64,
      },
    });
    usedFiles.push(item.fileName);
  }
  return { content, usedFiles };
}

async function buildClaudeFileSnapshotContent({ apiKey, snapshotFiles = [] }) {
  const content = [];
  const usedFiles = [];
  const claudeFiles = [];
  for (const item of snapshotFiles || []) {
    const uploaded = await uploadSnapshotToClaudeFile({
      apiKey,
      fileName: item.fileName,
      absPath: item.abs,
      mediaType: item.mediaType,
    });
    content.push({
      type: "image",
      source: {
        type: "file",
        file_id: uploaded.file_id || uploaded.id,
      },
    });
    usedFiles.push(item.fileName);
    claudeFiles.push({
      local_file: item.fileName,
      file_id: uploaded.file_id || uploaded.id,
      filename: uploaded.filename || item.fileName,
      mime_type: uploaded.mime_type || item.mediaType,
      size_bytes: Number(uploaded.size_bytes || 0),
      reused: uploaded.reused === true,
    });
  }
  return { content, usedFiles, claudeFiles };
}

function readClaudeContextFileMap() {
  ensureAiContextFileDir();
  try {
    if (!fs.existsSync(AI_CONTEXT_CLAUDE_MAP_FILE)) return {};
    const parsed = JSON.parse(
      fs.readFileSync(AI_CONTEXT_CLAUDE_MAP_FILE, "utf8"),
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function writeClaudeContextFileMap(map = {}) {
  ensureAiContextFileDir();
  const tmp = `${AI_CONTEXT_CLAUDE_MAP_FILE}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify(map && typeof map === "object" ? map : {}, null, 2),
  );
  fs.renameSync(tmp, AI_CONTEXT_CLAUDE_MAP_FILE);
}

function readClaudeLocalFileMap() {
  const out = {};
  const snapshotMap = readClaudeSnapshotFileMap();
  for (const [localFile, meta] of Object.entries(snapshotMap || {})) {
    if (!meta || typeof meta !== "object") continue;
    out[localFile] = {
      ...meta,
      local_file: localFile,
      vps_file: localFile,
      vps_path: path.join(CHART_SNAPSHOT_DIR, localFile),
      local_source: "snapshots",
    };
  }
  const contextMap = readClaudeContextFileMap();
  for (const [key, meta] of Object.entries(contextMap || {})) {
    if (!meta || typeof meta !== "object") continue;
    const localFile = String(meta.vps_file || meta.filename || key).trim();
    if (!localFile) continue;
    out[localFile] = {
      ...meta,
      local_file: localFile,
      local_source: "ai_context",
    };
  }
  return out;
}

function findClaudeLocalFileById(fileId) {
  const id = String(fileId || "").trim();
  if (!id) return null;
  const map = readClaudeLocalFileMap();
  for (const [localFile, meta] of Object.entries(map || {})) {
    if (String(meta?.file_id || "") !== id) continue;
    const safeName = path.basename(
      String(meta?.vps_file || meta?.filename || localFile || ""),
    );
    const abs =
      String(meta?.vps_path || "").trim() ||
      (meta?.local_source === "snapshots"
        ? path.join(CHART_SNAPSHOT_DIR, safeName)
        : path.join(AI_CONTEXT_FILE_DIR, safeName));
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return {
      ...meta,
      local_file: localFile,
      vps_file: safeName || localFile,
      vps_path: abs,
      mime_type: String(
        meta?.mime_type || mimeByFileName(safeName || localFile),
      ),
    };
  }
  return null;
}

function aiContextToken(value, fallback = "CTX") {
  return (
    sanitizeSnapshotFileToken(value, fallback)
      .replace(/_+/g, "_")
      .slice(0, 96) || fallback
  );
}

function aiContextFileName({ userId, symbol, tf, barEnd, type, ext = "json" }) {
  const u = sanitizeSnapshotFileToken(userId || "default");
  const s = sanitizeSnapshotFileToken(symbol);
  const t = sanitizeSnapshotFileToken(tf, "TF");
  const end = Number(barEnd || 0);
  const stamp =
    Number.isFinite(end) && end > 0
      ? new Date(end * 1000)
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}Z$/, "Z")
      : new Date()
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}Z$/, "Z");
  return `UID_${u}_${s}_${t}_${stamp}_${type.toLowerCase()}.${ext}`;
}

function displayTfFromNorm(tfNorm) {
  const s = String(tfNorm || "")
    .trim()
    .toLowerCase();
  if (s === "1day" || s === "day" || s === "1d") return "D";
  if (s === "1week" || s === "week" || s === "1w") return "W";
  if (s === "1month" || s === "month" || s === "1mo") return "MN";
  const m = s.match(/^(\d+)\s*(min|m|hour|h)$/i);
  if (!m) return String(tfNorm || "").toUpperCase();
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith("hour") || unit === "h") return `${n}H`;
  return `${n}M`;
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function mimeByFileName(fileName) {
  const n = String(fileName || "").toLowerCase();
  if (n.endsWith(".json")) return "text/plain";
  if (n.endsWith(".csv")) return "text/csv";
  if (n.endsWith(".txt") || n.endsWith(".md")) return "text/plain";
  return snapshotMimeByFileName(n) || "application/octet-stream";
}

async function uploadFileToClaude({ apiKey, absPath, fileName, mediaType }) {
  if (!absPath || !fs.existsSync(absPath) || !fs.statSync(absPath).isFile())
    throw new Error("Claude upload file does not exist.");
  const bytes = fs.readFileSync(absPath);
  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes], { type: mediaType || mimeByFileName(fileName) }),
    fileName,
  );
  return anthropicFilesRequest({
    apiKey,
    method: "POST",
    pathName: "/v1/files",
    body: form,
    timeoutMs: 45000,
  });
}

async function upsertClaudeContextFile({
  apiKey,
  contextKey,
  type,
  absPath,
  fileName,
  symbol,
  tf,
  barEnd,
}) {
  // Skip Claude Files upload when toggle is off — file still written to disk for inline use
  if (!UPLOAD_TO_CLAUDE) {
    return {
      context_key: contextKey,
      symbol,
      tf,
      type,
      bar_end: barEnd || null,
      vps_file: fileName,
      vps_path: absPath,
      file_id: null,
      reused: false,
      skipped: true,
    };
  }
  const map = readClaudeContextFileMap();
  const key = `${contextKey}:${type}`;
  const hash = sha256File(absPath);
  const prev = map[key];
  const nextMime = mimeByFileName(fileName);
  if (
    prev?.file_id &&
    prev?.sha256 === hash &&
    String(prev?.mime_type || "") === nextMime
  ) {
    return { ...prev, reused: true };
  }
  const uploaded = await uploadFileToClaude({
    apiKey,
    absPath,
    fileName,
    mediaType: nextMime,
  });
  const item = {
    context_key: contextKey,
    symbol: normalizeMarketDataSymbol(symbol),
    tf: displayTfFromNorm(tf),
    type,
    bar_end: Number(barEnd || 0) || null,
    vps_file: fileName,
    vps_path: absPath,
    file_id: String(uploaded?.id || ""),
    filename: String(uploaded?.filename || fileName),
    mime_type: String(uploaded?.mime_type || nextMime),
    size_bytes: Number(uploaded?.size_bytes || fs.statSync(absPath).size || 0),
    sha256: hash,
    uploaded_at: new Date().toISOString(),
  };
  map[key] = item;
  writeClaudeContextFileMap(map);
  const oldFileId = String(prev?.file_id || "");
  if (oldFileId && oldFileId !== item.file_id) {
    anthropicFilesRequest({
      apiKey,
      method: "DELETE",
      pathName: `/v1/files/${encodeURIComponent(oldFileId)}`,
      timeoutMs: 15000,
    }).catch(() => {});
  }
  return { ...item, reused: false };
}

function writeAiContextJsonFile(fileName, data) {
  ensureAiContextFileDir();
  const safe = path.basename(String(fileName || ""));
  if (!safe || safe !== fileName || !/\.json$/i.test(safe))
    throw new Error("Invalid AI context file name.");
  const abs = path.join(AI_CONTEXT_FILE_DIR, safe);
  fs.writeFileSync(abs, JSON.stringify(data, null, 2));
  return abs;
}

function summarizeBarsForAi(bars = [], tfNorm = "") {
  const arr = normalizeMarketDataBars(bars);
  if (!arr.length) return { bars_count: 0 };
  const highs = arr.map((b) => Number(b.high)).filter(Number.isFinite);
  const lows = arr.map((b) => Number(b.low)).filter(Number.isFinite);
  const closes = arr.map((b) => Number(b.close)).filter(Number.isFinite);
  const last = arr[arr.length - 1];
  const recent = arr.slice(-30);
  const recentHigh = Math.max(
    ...recent.map((b) => Number(b.high)).filter(Number.isFinite),
  );
  const recentLow = Math.min(
    ...recent.map((b) => Number(b.low)).filter(Number.isFinite),
  );
  let trSum = 0;
  let trCount = 0;
  for (let i = Math.max(1, arr.length - 14); i < arr.length; i += 1) {
    const cur = arr[i];
    const prev = arr[i - 1];
    const tr = Math.max(
      Number(cur.high) - Number(cur.low),
      Math.abs(Number(cur.high) - Number(prev.close)),
      Math.abs(Number(cur.low) - Number(prev.close)),
    );
    if (Number.isFinite(tr)) {
      trSum += tr;
      trCount += 1;
    }
  }
  return {
    tf: displayTfFromNorm(tfNorm),
    bars_count: arr.length,
    bar_start: arr[0].time,
    bar_end: Number(last.time) + Math.max(60, parseTfTokenToSeconds(tfNorm)),
    last_price: Number(last.close),
    last_close: Number(last.close),
    range_high: highs.length ? Math.max(...highs) : null,
    range_low: lows.length ? Math.min(...lows) : null,
    recent_high: Number.isFinite(recentHigh) ? recentHigh : null,
    recent_low: Number.isFinite(recentLow) ? recentLow : null,
    atr_14: trCount ? trSum / trCount : null,
    close_change_20:
      closes.length >= 21
        ? closes[closes.length - 1] - closes[closes.length - 21]
        : null,
  };
}

function makeAiContextDocumentBlock(fileId, title) {
  void title;
  return {
    type: "document",
    source: { type: "file", file_id: fileId },
  };
}

function makeAiContextTextBlock(file = {}, title = "context") {
  const filePath = String(file?.vps_path || "").trim();
  const fileName = path.basename(
    String(file?.vps_file || file?.filename || title || "context.txt"),
  );
  let text = "";
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    text = fs.readFileSync(filePath, "utf8");
  } else if (
    fileName &&
    fileName === String(file?.vps_file || file?.filename || fileName)
  ) {
    const abs = path.join(AI_CONTEXT_FILE_DIR, fileName);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile())
      text = fs.readFileSync(abs, "utf8");
  }
  if (!text) return null;
  const maxChars = 180000;
  const clipped =
    text.length > maxChars
      ? `${text.slice(0, maxChars)}\n\n[TRUNCATED ${text.length - maxChars} chars]`
      : text;
  return {
    type: "text",
    text: `\n\n### ${title}\nFile: ${fileName}\n\n${clipped}`,
  };
}

function marketDataFreshness(snapshot = {}, tfNorm = "") {
  const tfSec = Math.max(
    60,
    parseTfTokenToSeconds(tfNorm || snapshot.tf_norm || snapshot.timeframe),
  );
  const barEnd = Number(snapshot.bar_end || 0);
  const now = nowUnixSec();
  const tolerance = Math.min(Math.max(90, Math.floor(tfSec * 0.25)), 900);
  const nextBarDue = barEnd + tfSec;
  const fresh = Boolean(barEnd && now < nextBarDue + tolerance);
  return {
    fresh,
    status: fresh ? "fresh" : "stale",
    bar_end: barEnd || null,
    next_bar_due: barEnd ? nextBarDue : null,
    age_sec: barEnd ? Math.max(0, now - barEnd) : null,
  };
}

async function loadTradePlansForAiContext(userId, symbolNorm) {
  try {
    const db = await mt5InitBackend();
    const rows = await db.db
      .select()
      .from(schema.signals)
      .where(
        and(
          eq(schema.signals.userId, userId),
          inArray(schema.signals.status, ["NEW", "PENDING", "ACTIVE"]),
        ),
      )
      .limit(100);
    // Filter in JS: regexp_replace-equivalent
    const filtered = rows
      .filter((r) => {
        const sym = String(r.symbol || "")
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "");
        return sym === symbolNorm;
      })
      .slice(0, 20);
    return filtered.map((r) => ({
      sid: r.sid,
      created_at: r.createdAt,
      symbol: r.symbol,
      side: r.side,
      order_type: r.orderType,
      entry: r.entry,
      sl: r.sl,
      tp: r.tp,
      signal_tf: r.signalTf,
      chart_tf: r.chartTf,
      rr_planned: r.rrPlanned,
      risk_pct_planned: r.riskPctPlanned,
      status: r.status,
      note: r.note,
      metadata: dbQueries.parseJsonField(r.metadata),
    }));
  } catch {
    return [];
  }
}

async function ensureAiTfContext({
  userId,
  apiKey,
  symbol,
  tf,
  bars = 300,
  provider = "ICMARKETS",
  forceRefresh = false,
  forceSnapshot = false,
  includeSnapshots = true,
}) {
  const symbolNorm = normalizeMarketDataSymbol(symbol);
  const tfNorm = normalizeMarketDataTf(tf);
  const snapshot = await buildAnalysisSnapshotFromTwelve({
    userId,
    payload: { bars, force_refresh: forceRefresh },
    symbol,
    timeframe: tf,
  });
  if (String(snapshot?.status || "").toLowerCase() !== "ok") {
    return {
      tf: displayTfFromNorm(tfNorm),
      status: "error",
      error: snapshot?.reason || "market_data_failed",
      snapshot,
    };
  }
  const freshness = marketDataFreshness(snapshot, tfNorm);
  const barsArr = normalizeMarketDataBars(snapshot.bars);
  const summary = summarizeBarsForAi(barsArr, tfNorm);
  const barEnd = Number(snapshot.bar_end || summary.bar_end || 0);
  const contextKey = `${symbolNorm}:${displayTfFromNorm(tfNorm)}:${barEnd || "latest"}`;
  const lastPrice = Number(snapshot.last_price ?? summary.last_price);
  const barsFileName = aiContextFileName({
    userId,
    symbol: symbolNorm,
    tf: tfNorm,
    barEnd,
    type: "bars",
  });
  const analysisFileName = aiContextFileName({
    userId,
    symbol: symbolNorm,
    tf: tfNorm,
    barEnd,
    type: "analysis",
  });
  const tradePlansFileName = aiContextFileName({
    userId,
    symbol: symbolNorm,
    tf: tfNorm,
    barEnd,
    type: "tradeplans",
  });

  const barsAbs = writeAiContextJsonFile(barsFileName, {
    kind: "bars",
    symbol: symbolNorm,
    tf: displayTfFromNorm(tfNorm),
    bar_start: snapshot.bar_start,
    bar_end: barEnd,
    last_price: Number.isFinite(lastPrice) ? lastPrice : null,
    cache_source: snapshot.cache_source || "provider",
    freshness,
    summary,
    bars: barsArr,
  });
  const analysisAbs = writeAiContextJsonFile(analysisFileName, {
    kind: "prior_analysis",
    symbol: symbolNorm,
    tf: displayTfFromNorm(tfNorm),
    bar_end: barEnd,
    analysis:
      snapshot.metadata || snapshot.market_analysis || snapshot.summary || {},
  });
  const tradePlans = await loadTradePlansForAiContext(userId, symbolNorm);
  const tradePlansAbs = writeAiContextJsonFile(tradePlansFileName, {
    kind: "tradeplans",
    symbol: symbolNorm,
    tf: displayTfFromNorm(tfNorm),
    bar_end: barEnd,
    plans: tradePlans,
  });

  const barsFile = await upsertClaudeContextFile({
    apiKey,
    contextKey,
    type: "bars",
    absPath: barsAbs,
    fileName: barsFileName,
    symbol: symbolNorm,
    tf: tfNorm,
    barEnd,
  });
  const analysisFile = await upsertClaudeContextFile({
    apiKey,
    contextKey,
    type: "analysis",
    absPath: analysisAbs,
    fileName: analysisFileName,
    symbol: symbolNorm,
    tf: tfNorm,
    barEnd,
  });
  const tradePlansFile = await upsertClaudeContextFile({
    apiKey,
    contextKey,
    type: "tradeplans",
    absPath: tradePlansAbs,
    fileName: tradePlansFileName,
    symbol: symbolNorm,
    tf: tfNorm,
    barEnd,
  });

  const contextMap = readClaudeContextFileMap();
  const snapshotKey = `${contextKey}:snapshot`;
  let snapshotFile = contextMap[snapshotKey] || null;
  const snapshotFresh =
    snapshotFile?.file_id && Number(snapshotFile.bar_end || 0) >= barEnd;
  if (includeSnapshots && (forceSnapshot || !snapshotFresh)) {
    const shot = await captureTradingViewSnapshot({
      userId,
      symbol,
      provider,
      timeframe: displayTfFromNorm(tfNorm),
      session_prefix: `${symbolNorm}_${displayTfFromNorm(tfNorm)}_${barEnd || "latest"}`,
      lookbackBars: bars,
      format: "png",
      quality: 55,
    });
    const shotAbs = path.join(CHART_SNAPSHOT_DIR, shot.file_name);
    snapshotFile = await upsertClaudeContextFile({
      apiKey,
      contextKey,
      type: "snapshot",
      absPath: shotAbs,
      fileName: aiContextFileName({
        userId,
        symbol: symbolNorm,
        tf: tfNorm,
        barEnd,
        type: "snapshot",
        ext: "jpg",
      }),
      symbol: symbolNorm,
      tf: tfNorm,
      barEnd,
    });
    snapshotFile.local_snapshot_file = shot.file_name;
  }

  return {
    context_key: contextKey,
    symbol: symbolNorm,
    tf: displayTfFromNorm(tfNorm),
    tf_norm: tfNorm,
    status: "ok",
    freshness,
    cache_source: snapshot.cache_source || "provider",
    bar_start: snapshot.bar_start,
    bar_end: barEnd,
    last_price: Number.isFinite(lastPrice) ? lastPrice : null,
    summary,
    analysis:
      snapshot.metadata || snapshot.market_analysis || snapshot.summary || {},
    files: {
      snapshot: snapshotFile,
      bars: barsFile,
      analysis: analysisFile,
      tradeplans: tradePlansFile,
    },
  };
}

async function buildAiContextBundle({
  userId,
  apiKey,
  symbol,
  timeframes = [],
  bars = 300,
  provider = "ICMARKETS",
  forceRefresh = false,
  forceSnapshot = false,
  includeSnapshots = true,
}) {
  const tfs = (
    Array.isArray(timeframes) ? timeframes : String(timeframes || "").split(",")
  )
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 6);
  const wanted = tfs.length ? tfs : ["D", "4H", "1H", "15M"];

  const maxParallel = 3;
  const items = new Array(wanted.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < wanted.length) {
      const idx = cursor;
      cursor += 1;
      const tf = wanted[idx];
      console.log(`[context] worker start tf=${tf} idx=${idx}`);
      const tStart = Date.now();
      try {
        items[idx] = await Promise.race([
          ensureAiTfContext({
            userId,
            apiKey,
            symbol,
            tf,
            bars,
            provider,
            forceRefresh,
            forceSnapshot,
            includeSnapshots,
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`ensureAiTfContext timeout tf=${tf}`)),
              30000,
            ),
          ),
        ]);
        console.log(
          `[context] worker done tf=${tf} idx=${idx} ms=${Date.now() - tStart}`,
        );
      } catch (error) {
        console.error(
          `[context] worker fail tf=${tf} idx=${idx} ms=${Date.now() - tStart} err=${error.message}`,
        );
        items[idx] = {
          tf: displayTfFromNorm(normalizeMarketDataTf(tf)),
          tf_norm: normalizeMarketDataTf(tf),
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : String(error || "context_failed"),
        };
      }
    }
  };
  const runners = Array.from(
    { length: Math.max(1, Math.min(maxParallel, wanted.length)) },
    () => worker(),
  );
  console.log(
    `[context] buildAiContextBundle START symbol=${symbol} tfs=${wanted.join(",")} maxParallel=${maxParallel}`,
  );
  await Promise.all(runners);
  console.log(`[context] buildAiContextBundle runners DONE`);
  for (let i = 0; i < items.length; i += 1) {
    if (!items[i]) {
      const tf = wanted[i];
      items[i] = {
        tf: displayTfFromNorm(normalizeMarketDataTf(tf)),
        tf_norm: normalizeMarketDataTf(tf),
        status: "error",
        error: "context_missing",
      };
    }
  }
  const okItems = items.filter((x) => x?.status === "ok");
  const allClaudeFiles = await anthropicListFiles(apiKey).catch(() => []);
  const validIds = new Set(allClaudeFiles.map((f) => f.id));

  for (const item of items) {
    if (item.files) {
      for (const type of Object.keys(item.files)) {
        const fid = item.files[type]?.file_id;
        if (fid && !validIds.has(fid)) {
          console.log(
            `[context] Removing stale file reference: ${fid} (${type})`,
          );
          delete item.files[type].file_id;
        }
      }
    }
  }

  return {
    symbol: normalizeMarketDataSymbol(symbol),
    generated_at: new Date().toISOString(),
    timeframes: items,
    current_price:
      okItems.find((x) => Number.isFinite(Number(x.last_price)))?.last_price ??
      null,
    context_files: okItems.flatMap((item) =>
      Object.entries(item.files || {})
        .map(([type, file]) => ({
          tf: item.tf,
          type,
          file_id: file?.file_id || "",
          filename: file?.filename || file?.vps_file || "",
          reused: file?.reused === true,
        }))
        .filter((x) => x.file_id && validIds.has(x.file_id)),
    ),
  };
}

function normalizeSnapshotFileName(fileNameRaw) {
  const raw = String(fileNameRaw || "").trim();
  if (!raw) return "";
  const safe = path.basename(raw);
  if (!safe || safe !== raw) return "";
  if (!/\.(png|jpe?g)$/i.test(safe)) return "";
  return safe;
}

function normalizeChartFileName(fileNameRaw) {
  const raw = String(fileNameRaw || "").trim();
  if (!raw) return "";
  const safe = path.basename(raw);
  if (!safe || safe !== raw || safe.startsWith(".")) return "";
  return safe;
}

function collectSnapshotFilesFromValue(value, out = new Set(), depth = 0) {
  if (depth > 7 || value === null || value === undefined) return out;
  if (typeof value === "string") {
    const safe = normalizeSnapshotFileName(value);
    if (safe) out.add(safe);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value)
      collectSnapshotFilesFromValue(item, out, depth + 1);
    return out;
  }
  if (typeof value === "object") {
    const obj = value;
    const focusedKeys = [
      "files",
      "used_files",
      "snapshot_files",
      "analysis_files",
      "images",
      "screenshots",
    ];
    for (const k of focusedKeys) {
      if (Object.prototype.hasOwnProperty.call(obj, k))
        collectSnapshotFilesFromValue(obj[k], out, depth + 1);
    }
    // Also scan nested structures to support legacy payload shapes.
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object")
        collectSnapshotFilesFromValue(v, out, depth + 1);
    }
    return out;
  }
  return out;
}

function deleteSnapshotFilesByName(fileNames = []) {
  ensureChartSnapshotDir();
  let deleted = 0;
  for (const fileNameRaw of fileNames || []) {
    const safe = normalizeSnapshotFileName(fileNameRaw);
    if (!safe) continue;
    const abs = path.join(CHART_SNAPSHOT_DIR, safe);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        fs.unlinkSync(abs);
        deleted += 1;
      }
    } catch {
      // best effort cleanup
    }
  }
  return deleted;
}

function findRecentChartSnapshots({
  symbol = "",
  provider = "",
  timeframes = [],
  sessionPrefix = "",
  maxAgeMs = 15 * 60 * 1000,
} = {}) {
  ensureChartSnapshotDir();
  const nowMs = Date.now();
  const symbolRaw = String(symbol || "")
    .trim()
    .toUpperCase();
  if (!symbolRaw)
    return { items: [], missing_timeframes: [], target_timeframes: [] };

  const symDir = path.join(CHART_SNAPSHOT_DIR, symbolRaw);
  if (!fs.existsSync(symDir))
    return { items: [], missing_timeframes: [], target_timeframes: [] };
  const wanted = (
    Array.isArray(timeframes) ? timeframes : String(timeframes || "").split(",")
  )
    .map((tf) => toTradingViewInterval(tf).toUpperCase())
    .filter(Boolean);
  const wantedSet = new Set(wanted);
  const prefix = sanitizeSessionPrefix(sessionPrefix || "");
  const byTf = new Map();
  const files = fs
    .readdirSync(symDir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .map((f) => {
      const abs = path.join(symDir, f);
      try {
        const st = fs.statSync(abs);
        if (!st.isFile()) return null;
        return {
          file_name: f,
          abs,
          mtimeMs: Number(st.mtimeMs || 0),
          size_bytes: Number(st.size || 0),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((x) => !maxAgeMs || Math.abs(nowMs - x.mtimeMs) <= Number(maxAgeMs))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const item of files) {
    const base = item.file_name.replace(/\.(png|jpe?g)$/i, "");
    const parts = base
      .split("_")
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    const tfToken = sanitizeSnapshotFileToken(
      parts[parts.length - 1] || "",
    ).toUpperCase();
    if (!wantedSet.has(tfToken)) continue;
    if (prefix && !base.includes(`_${prefix}_`)) continue;

    if (byTf.has(tfToken)) continue;
    byTf.set(tfToken, {
      id: base,
      file_name: item.file_name,
      timeframe: tfToken,
      created_at: new Date(item.mtimeMs || nowMs).toISOString(),
      size_bytes: item.size_bytes,
      mime_type: fileMimeByName(item.file_name),
      url: `/v2/chart/snapshots/${encodeURIComponent(symbolRaw)}/${encodeURIComponent(item.file_name)}`,
      symbol: symbolRaw,
      reused: true,
    });
  }

  return {
    items: wanted.map((tf) => byTf.get(tf)).filter(Boolean),
    missing_timeframes: wanted.filter((tf) => !byTf.has(tf)),
    target_timeframes: wanted,
  };
}

function extractJsonFromAiText(rawText) {
  // Repair Claude-generated JSON where check_lists/risk_management/execution_plan
  // are placed outside the main trade plan object (after premature closing }).
  // Claude sometimes generates an extra } inside analysis, causing depth mismatch.
  const repairOrphanedKeys = (text) => {
    // Claude sometimes generates an extra } before risk_management/execution_plan
    // or check_lists, making them orphans outside the main object.
    // Pattern to fix: }}},"risk_management": → }},"risk_management":
    const orphanKeys = [
      '"risk_management"',
      '"execution_plan"',
      '"check_lists"',
    ];
    for (const key of orphanKeys) {
      const idx = text.indexOf(`,${key}:`);
      if (idx < 0) continue;
      const before = text.slice(Math.max(0, idx - 5), idx);
      // Fix }}},"key": (3 braces) → }}"key": (remove one extra })
      if (before.endsWith("}}}")) {
        const fixed = text.slice(0, idx - 3) + text.slice(idx - 2);
        try {
          JSON.parse(fixed);
          return fixed;
        } catch (_) {}
      }
      // Fix }},"key": (2 braces — orphan key outside parent) → },"key":
      if (before.endsWith("}}")) {
        const fixed = text.slice(0, idx - 2) + text.slice(idx - 1);
        try {
          JSON.parse(fixed);
          return fixed;
        } catch (_) {}
      }
    }
    return text;
  };

  const extractBalancedJsonObject = (text) => {
    const src = String(text || "");
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") {
        if (depth === 0) start = i;
        depth += 1;
        continue;
      }
      if (ch === "}") {
        if (depth > 0) depth -= 1;
        if (depth === 0 && start >= 0) {
          return src.slice(start, i + 1);
        }
      }
    }
    return "";
  };
  const raw = String(rawText || "");
  let clean = raw.trim();
  if (clean.includes("```")) {
    const match = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) clean = match[1];
  }
  clean = clean
    .replace(/^```json/, "")
    .replace(/```$/, "")
    .trim();
  // Apply repair after markdown strip — Claude sometimes generates extra braces
  clean = repairOrphanedKeys(clean);
  const tryParse = (value) => {
    try {
      return JSON.parse(String(value || "").trim());
    } catch {
      return null;
    }
  };
  let parsed = tryParse(clean);
  // Some providers return a JSON string whose contents are another JSON object.
  for (let i = 0; i < 2; i += 1) {
    if (typeof parsed !== "string") break;
    const reparsed = tryParse(parsed);
    if (reparsed == null) break;
    parsed = reparsed;
  }
  if (parsed == null) {
    const balanced =
      extractBalancedJsonObject(clean) || extractBalancedJsonObject(raw);
    if (balanced) {
      parsed = tryParse(balanced);
      for (let i = 0; i < 2; i += 1) {
        if (typeof parsed !== "string") break;
        const reparsed = tryParse(parsed);
        if (reparsed == null) break;
        parsed = reparsed;
      }
    }
  }
  if (parsed == null) {
    // Try repairing Claude's orphaned keys (check_lists/risk_management/execution_plan
    // placed outside the main object after premature }} closing).
    const repaired = repairOrphanedKeys(clean);
    if (repaired !== clean) {
      parsed = tryParse(repaired);
      for (let i = 0; i < 2; i += 1) {
        if (typeof parsed !== "string") break;
        const reparsed = tryParse(parsed);
        if (reparsed == null) break;
        parsed = reparsed;
      }
    }
  }
  if (parsed == null) {
    const trimmed = clean.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      const inner = trimmed.slice(1, -1);
      const unescaped = inner
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\\\/g, "\\");
      parsed = tryParse(unescaped);
      for (let i = 0; i < 2; i += 1) {
        if (typeof parsed !== "string") break;
        const reparsed = tryParse(parsed);
        if (reparsed == null) break;
        parsed = reparsed;
      }
    }
  }
  return { parsed, clean };
}

function recoverTradePlansFromRawAiText(rawText) {
  const raw = String(rawText || "");
  let clean = raw.trim();
  if (clean.includes("```")) {
    const match = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) clean = match[1];
  }
  clean = clean
    .replace(/^```json/, "")
    .replace(/```$/, "")
    .trim();
  // Unescape JSON-string-wrapped responses (AI sometimes returns JSON as a quoted string)
  if (clean.startsWith('"') && clean.endsWith('"') && clean.length > 2) {
    const inner = clean.slice(1, -1);
    const unescaped = inner
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
    clean = unescaped.trim();
  }
  if (!clean) return [];

  const extractBalancedArray = (text, startIndex) => {
    const src = String(text || "");
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = startIndex; i < src.length; i += 1) {
      const ch = src[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "[") {
        depth += 1;
        continue;
      }
      if (ch === "]") {
        if (depth > 0) depth -= 1;
        if (depth === 0) return src.slice(startIndex, i + 1);
      }
    }
    return "";
  };

  const out = [];
  const seen = new Set();
  const symbolRe = /"symbol"\s*:\s*"([^"]+)"/g;
  for (let m = symbolRe.exec(clean); m; m = symbolRe.exec(clean)) {
    const sym = String(m[1] || "")
      .trim()
      .toUpperCase();
    if (!sym) continue;
    const lookahead = clean.slice(
      m.index,
      Math.min(clean.length, m.index + 20000),
    );
    const tpIdx = lookahead.search(/"trade_plan"\s*:/);
    if (tpIdx < 0) continue;
    const absTpIdx = m.index + tpIdx;
    const bracketIdx = clean.indexOf("[", absTpIdx);
    if (bracketIdx < 0) continue;
    const arrText = extractBalancedArray(clean, bracketIdx);
    if (!arrText) continue;
    let arr = null;
    try {
      arr = JSON.parse(arrText);
    } catch {
      arr = null;
    }
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      if (!p || typeof p !== "object") continue;
      const plan = { ...(p || {}) };
      if (!plan.symbol) plan.symbol = sym;
      const key = JSON.stringify([
        String(plan.symbol || "").toUpperCase(),
        String(plan.trade_id || ""),
        Number(plan.entry_price ?? plan.entry ?? NaN),
        Number(plan.stop_loss ?? plan.sl ?? NaN),
        Number(plan.take_profit ?? plan.tp ?? plan.tp3 ?? NaN),
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(plan);
    }
  }
  return out;
}

async function anthropicListModels(apiKey) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      signal: ctrl.signal,
      headers: {
        "x-api-key": String(apiKey || ""),
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) return [];
    const out = await res.json().catch(() => ({}));
    const rows = Array.isArray(out?.data) ? out.data : [];
    return rows.map((x) => String(x?.id || "").trim()).filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function pickPreferredAnthropicModel(ids = [], preferred = "") {
  const list = Array.isArray(ids)
    ? ids.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const want = String(preferred || "").trim();
  if (want && list.includes(want)) return want;
  const priority = [
    "claude-sonnet-4-0",
    "claude-sonnet-4-20250514",
    "claude-3-7-sonnet-latest",
    "claude-3-7-sonnet-20250219",
    "claude-3-5-sonnet-latest",
    "claude-3-5-sonnet-20241022",
  ];
  for (const p of priority) {
    if (list.includes(p)) return p;
  }
  const sonnet = list.find((x) => x.includes("sonnet"));
  if (sonnet) return sonnet;
  return list[0] || want;
}

async function anthropicMessagesWithFallback({
  apiKey,
  model,
  messages,
  maxTokens = 1600,
  timeoutMs = 90000,
  beta = "",
}) {
  const requestOnce = async (useModel) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": String(apiKey || ""),
      "anthropic-version": "2023-06-01",
    };
    if (beta) headers["anthropic-beta"] = String(beta);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ctrl.signal,
        headers,
        body: JSON.stringify({
          model: useModel,
          max_tokens: Number(maxTokens || 1600),
          messages: Array.isArray(messages) ? messages : [],
        }),
      });
      return res;
    } finally {
      clearTimeout(timer);
    }
  };

  let useModel =
    String(model || "claude-sonnet-4-0").trim() || "claude-sonnet-4-0";
  let res = await requestOnce(useModel);
  if (!res.ok && res.status === 404) {
    const errText = await res.text().catch(() => "");
    const modelNotFound = String(errText || "")
      .toLowerCase()
      .includes("model");
    if (modelNotFound) {
      const ids = await anthropicListModels(apiKey);
      const fallbackModel = pickPreferredAnthropicModel(ids, useModel);
      if (fallbackModel && fallbackModel !== useModel) {
        useModel = fallbackModel;
        res = await requestOnce(useModel);
      } else {
        const fake = new Response(errText, {
          status: 404,
          statusText: "Not Found",
        });
        return { ok: false, response: fake, modelUsed: useModel };
      }
    } else {
      const isFileNotFound =
        String(errText || "").includes("not_found_error") &&
        String(errText || "").includes("file_");

      if (isFileNotFound && (_retryCount || 0) < 3) {
        const match = String(errText || "").match(/file_[a-zA-Z0-9]+/);
        if (match) {
          const missingId = match[0];
          console.log(
            `[anthropic] File ${missingId} not found. Retrying without it...`,
          );
          const filteredMessages = (messages || []).map((m) => {
            if (!Array.isArray(m.content)) return m;
            return {
              ...m,
              content: m.content.filter((c) => c.source?.file_id !== missingId),
            };
          });
          return await anthropicMessagesWithFallback({
            apiKey,
            model,
            messages: filteredMessages,
            maxTokens,
            timeoutMs,
            beta,
            _retryCount: (_retryCount || 0) + 1,
          });
        }
      }

      const fake = new Response(errText, {
        status: res.status,
        statusText: res.statusText,
      });
      return { ok: false, response: fake, modelUsed: useModel };
    }
  }
  return { ok: res.ok, response: res, modelUsed: useModel };
}

// Multi-provider AI call — routes to Claude, OpenAI, DeepSeek, or Gemini based on model name
function sanitizeRuntimeApiKey(raw) {
  const v = String(raw || "").trim();
  if (!v) return "";
  // Masked keys from UI display should never be used for real API calls.
  if (v.includes("****")) return "";
  return v;
}

async function loadAiConfig(userId = "") {
  const db = await mt5InitBackend();
  const uid =
    String(userId || CFG.mt5DefaultUserId).trim() || CFG.mt5DefaultUserId;
  const rows = await dbQueries.listUserSettingsByType(db.db, uid, "api_key");
  const cfg = {};
  for (const row of rows) {
    const name = normalizeAiApiKeyName(row?.name);
    const dec = decryptObject(
      row?.data && typeof row.data === "object" ? row.data : {},
    );
    // New provider schema: { models, api_key, remain_credits }
    cfg[name] = sanitizeRuntimeApiKey(dec?.api_key || dec?.value || "");
  }
  // Fallback to env vars for providers not yet saved in UI settings
  if (!cfg.OPENROUTER_API_KEY)
    cfg.OPENROUTER_API_KEY = sanitizeRuntimeApiKey(
      envStr(process.env.OPENROUTER_API_KEY),
    );
  if (!cfg.DEEPSEEK_API_KEY)
    cfg.DEEPSEEK_API_KEY = sanitizeRuntimeApiKey(
      envStr(process.env.DEEPSEEK_API_KEY),
    );
  if (!cfg.ANTHROPIC_API_KEY)
    cfg.ANTHROPIC_API_KEY = sanitizeRuntimeApiKey(
      envStr(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY),
    );
  if (!cfg.OPENAI_API_KEY)
    cfg.OPENAI_API_KEY = sanitizeRuntimeApiKey(
      envStr(process.env.OPENAI_API_KEY),
    );
  if (!cfg.GEMINI_API_KEY)
    cfg.GEMINI_API_KEY = sanitizeRuntimeApiKey(
      envStr(process.env.GEMINI_API_KEY),
    );
  return cfg;
}

async function callAiProvider({
  model,
  messages,
  maxTokens = 32000,
  timeoutMs = 180000,
  provider: explicitProvider = "",
  apiKey: callerApiKey = "",
  userId = "",
}) {
  // If explicit provider is given (for OpenRouter), use it directly
  if (explicitProvider) {
    // Passthrough to appropriate handler below — model-based detection is overridden
  }
  const modelLower = String(model || "").toLowerCase();

  // Claude → use Anthropic Messages API
  if (modelLower.includes("claude")) {
    trackApiCall("Claude");
    const claudeKey =
      callerApiKey || (await loadClaudeApiKeyForUser(CFG.mt5DefaultUserId));
    if (!claudeKey) throw new Error("CLAUDE_API_KEY is missing in Settings.");
    const out = await anthropicMessagesWithFallback({
      apiKey: claudeKey,
      model: model || "claude-sonnet-4-0",
      messages,
      maxTokens,
      timeoutMs,
    });
    if (!out.response.ok) {
      const errText = await out.response.text();
      throw new Error(`Claude API Error (${out.response.status}): ${errText}`);
    }
    const json = await out.response.json();
    const rawText = Array.isArray(json?.content)
      ? json.content
          .filter((x) => x?.type === "text")
          .map((x) => String(x?.text || ""))
          .join("")
      : String(json?.content || "");
    return { rawText, modelUsed: out.modelUsed || model, provider: "claude" };
  }

  // OpenAI / DeepSeek / Gemini → use OpenAI-compatible chat/completions
  // Determine provider: explicit overrides model-based detection
  let provider = explicitProvider
    ? explicitProvider.toLowerCase()
    : modelLower.includes("openrouter") || modelLower.includes("open-router")
      ? "openrouter"
      : modelLower.includes("gpt") || modelLower.includes("openai")
        ? "openai"
        : modelLower.includes("deepseek")
          ? "deepseek"
          : "gemini";

  // Normalize provider aliases (e.g. frontend sends ai_gpt4o → stripped to "gpt4o")
  if (provider === "gpt4o" || provider === "gpt-4o" || provider === "chatgpt") {
    provider = "openai";
  }

  trackApiCall(provider.charAt(0).toUpperCase() + provider.slice(1));
  let apiKey = sanitizeRuntimeApiKey(callerApiKey || "");
  if (!apiKey) {
    const cfg = await loadAiConfig(userId);
    apiKey =
      provider === "deepseek"
        ? cfg.DEEPSEEK_API_KEY
        : provider === "openrouter"
          ? cfg.OPENROUTER_API_KEY || ""
          : provider === "openai"
            ? cfg.OPENAI_API_KEY
            : cfg.GEMINI_API_KEY;
  }
  if (!sanitizeRuntimeApiKey(apiKey))
    throw new Error(
      `${provider.toUpperCase()}_API_KEY is missing in Settings.`,
    );

  const endpoint =
    provider === "openrouter"
      ? "https://openrouter.ai/api/v1/chat/completions"
      : provider === "deepseek"
        ? "https://api.deepseek.com/chat/completions"
        : provider === "openai"
          ? "https://api.openai.com/v1/chat/completions"
          : "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

  // Convert image format: Anthropic base64 → OpenAI image_url
  // DeepSeek does NOT support images — strip them and warn
  const isDeepSeek = provider === "deepseek";
  let imageCount = 0;
  const convertedMessages = messages.map((m) => {
    if (typeof m.content === "string") return m;
    if (!Array.isArray(m.content)) return m;
    const parts = m.content.map((block) => {
      if (block?.type === "image" && block?.source?.type === "base64") {
        imageCount++;
        if (isDeepSeek) {
          return {
            type: "text",
            text: "[Chart image attached — analyze based on the symbol/timeframe context above]",
          };
        }
        return {
          type: "image_url",
          image_url: {
            url: `data:${block.source.media_type || "image/jpeg"};base64,${block.source.data}`,
          },
        };
      }
      return block;
    });
    return { ...m, content: parts };
  });

  const body = JSON.stringify({
    model:
      model ||
      (provider === "deepseek"
        ? "deepseek-chat"
        : provider === "openai"
          ? "gpt-4o"
          : provider === "openrouter"
            ? "openai/gpt-4o"
            : "gemini-2.0-flash"),
    messages: convertedMessages,
    max_tokens: maxTokens,
    response_format:
      provider !== "gemini" ? { type: "json_object" } : undefined,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(provider === "openrouter"
          ? {
              "HTTP-Referer": "https://trade.mozasolution.com",
              "X-Title": "Trading Bot",
            }
          : {}),
      },
      body,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${provider} API Error (${res.status}): ${errText}`);
    }
    const json = await res.json();
    const rawText = json.choices?.[0]?.message?.content || "";
    return { rawText, modelUsed: model, provider };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeHostHeader(hostRaw) {
  return String(hostRaw || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

function stripWebhookPrefix(pathname) {
  const p = String(pathname || "");
  if (p === "/webhook") return "/";
  if (p.startsWith("/webhook/")) return p.slice("/webhook".length) || "/";
  return p;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function normalizeSide(sideRaw) {
  const s = String(sideRaw || "").toUpperCase();
  if (s === "BUY" || s === "LONG") return "BUY";
  if (s === "SELL" || s === "SHORT") return "SELL";
  throw new Error("Invalid side");
}

const ENTRY_MODEL_NORMALIZE_RULES = [
  { label: "ICT Turtle Soup", patterns: ["turtle soup", "turtlesoup"] },
  { label: "ICT", patterns: ["ict"] },
  { label: "SMC", patterns: ["smc", "smart money"] },
  { label: "Fibo", patterns: ["fibo", "fibonacci"] },
  { label: "Retracement", patterns: ["retracement", "pullback"] },
  { label: "Order Block", patterns: ["order block", "ob retest", "ob"] },
  { label: "FVG", patterns: ["fvg", "fair value gap"] },
  { label: "Breaker", patterns: ["breaker"] },
  { label: "Mitigation", patterns: ["mitigation"] },
  { label: "Price Action", patterns: ["price action"] },
];

function mt5CollapseWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function mt5EntryModelLooksVerbose(value) {
  const raw = mt5CollapseWhitespace(value);
  if (!raw) return false;
  if (raw.length > 42) return true;
  if ((raw.match(/\s+/g) || []).length >= 5) return true;
  return /[.,;:!?]/.test(raw);
}

function mt5NormalizeEntryModel(value, opts = {}) {
  const raw = mt5CollapseWhitespace(value);
  const fallbackRaw = mt5CollapseWhitespace(opts.fallback || "MANUAL");
  const normalizedFallback = fallbackRaw ? fallbackRaw.slice(0, 32) : "MANUAL";
  const source = raw || fallbackRaw;
  if (!source) return "MANUAL";
  const lower = source.toLowerCase();
  for (const rule of ENTRY_MODEL_NORMALIZE_RULES) {
    if (rule.patterns.some((p) => lower.includes(p))) return rule.label;
  }
  if (!mt5EntryModelLooksVerbose(source) && /^[a-z0-9 _/+-]+$/i.test(source)) {
    return source.slice(0, 32);
  }
  return normalizedFallback || "MANUAL";
}

function mt5MergeNote(base, addition) {
  const baseText = mt5CollapseWhitespace(base);
  const extraText = mt5CollapseWhitespace(addition);
  if (!extraText) return baseText;
  if (!baseText) return extraText;
  if (baseText.toLowerCase().includes(extraText.toLowerCase())) return baseText;
  return `${extraText} | ${baseText}`;
}

function mt5DeriveEntryModelAndNote(payload = {}, opts = {}) {
  const rawEntryModel = mt5CollapseWhitespace(
    payload.entry_model ??
      payload.entryModel ??
      payload.model ??
      payload.strategy ??
      opts.fallbackModel ??
      "",
  );
  const entryModel = mt5NormalizeEntryModel(rawEntryModel, {
    fallback: opts.fallbackModel || payload.source || "MANUAL",
  });
  const baseNote = mt5BuildNote(payload);
  const note = mt5EntryModelLooksVerbose(rawEntryModel)
    ? mt5MergeNote(baseNote, rawEntryModel)
    : baseNote;
  return { entryModel, note, entryModelRaw: rawEntryModel || null };
}

function normalizeSignal(payload) {
  const strategy = String(
    payload.strategy || payload.source || payload.system || "UnknownStrategy",
  );
  const symbol = String(payload.symbol || payload.ticker || "").toUpperCase();
  const side = normalizeSide(payload.side || payload.action);
  const tradeIdRaw = envStr(
    payload.sid ?? payload.id ?? payload.trade_id ?? payload.tradeId,
  );
  const tradeId = normalizePublicSidBase(tradeIdRaw, "TRD");
  const timeframe = String(payload.timeframe || payload.tf || "n/a");
  const orderTypeRaw = envStr(payload.order_type ?? payload.orderType);
  const orderType = orderTypeRaw ? mt5NormalizeOrderType(payload) : "limit";
  const chartTf = envStr(
    payload.chart_tf ?? payload.chartTf ?? payload.timeframe ?? payload.tf,
  );
  const signalTf = envStr(payload.signal_tf ?? payload.signalTf);
  const price = asNum(payload.price ?? payload.entry, NaN);
  const sl = asNum(payload.stop_loss ?? payload.sl, NaN);
  const tp = asNum(payload.take_profit ?? payload.tp, NaN);
  const derived = mt5DeriveEntryModelAndNote(payload, {
    fallbackModel: strategy || "UnknownStrategy",
  });
  const note = derived.note || String(payload.note || payload.comment || "");
  const signalTime =
    payload.time || payload.timestamp || new Date().toISOString();
  const quantity = asNum(payload.quantity ?? payload.qty, NaN);
  const userId = envStr(
    payload.user_id ?? payload.userId ?? payload.user ?? CFG.mt5DefaultUserId,
    CFG.mt5DefaultUserId,
  );
  const rrPlanned = asNum(payload.rr ?? payload.risk_reward, NaN);
  const riskMoneyPlanned = asNum(
    payload.risk_money ?? payload.money_risk ?? payload.riskMoney,
    NaN,
  );

  if (!symbol) throw new Error("Missing symbol");
  if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid price");

  return {
    strategy,
    symbol,
    side,
    sid: tradeId || "-",
    timeframe,
    price,
    sl: Number.isFinite(sl) ? sl : null,
    tp: Number.isFinite(tp) ? tp : null,
    note,
    signalTime,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
    order_type: orderType,
    chart_tf: chartTf || null,
    signal_tf: signalTf || null,
    user_id: userId,
    entry_model: derived.entryModel || null,
    rr_planned: Number.isFinite(rrPlanned) ? rrPlanned : null,
    risk_money_planned: Number.isFinite(riskMoneyPlanned)
      ? riskMoneyPlanned
      : null,
    risk_pct_planned: asNum(payload.risk_pct ?? payload.riskPct ?? 1.0, 1.0),
    rejection_reason: null,
    raw: payload,
  };
}

function formatSignal(signal) {
  return [
    `${signal.symbol} | ${signal.side} | ${signal.sid || "-"} | ${signal.timeframe || "n/a"}`,
    `Entry:${signal.price} SL:${signal.sl ?? "n/a"} TP:${signal.tp ?? "n/a"} | ${signal.strategy || "-"} | ${signal.note || "-"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendTelegram(text) {
  if (!CFG.telegramBotToken || !CFG.telegramChatId) {
    return {
      ok: false,
      skipped: true,
      reason: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID",
    };
  }
  const endpoint = `https://api.telegram.org/bot${CFG.telegramBotToken}/sendMessage`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CFG.telegramChatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram API error: ${JSON.stringify(data)}`);
  }
  return data;
}

function binanceBaseUrl() {
  if (CFG.binanceProduct === "um_futures") {
    return CFG.binanceMode === "live"
      ? "https://fapi.binance.com"
      : "https://testnet.binancefuture.com";
  }
  return CFG.binanceMode === "live"
    ? "https://api.binance.com"
    : "https://testnet.binance.vision";
}

function signQuery(query, secret) {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

async function binanceSignedRequest(method, route, params) {
  const timestamp = Date.now();
  const allParams = {
    ...params,
    recvWindow: CFG.binanceRecvWindow,
    timestamp,
  };
  const query = new URLSearchParams(allParams).toString();
  const signature = signQuery(query, CFG.binanceApiSecret);
  const url = `${binanceBaseUrl()}${route}?${query}&signature=${signature}`;

  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": CFG.binanceApiKey },
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    throw new Error(
      `Binance ${route} failed ${res.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

function resolveBinanceSizing(signal) {
  if (signal.quantity && signal.quantity > 0) {
    return { quantity: String(signal.quantity) };
  }
  if (Number.isFinite(CFG.binanceDefaultQty) && CFG.binanceDefaultQty > 0) {
    return { quantity: String(CFG.binanceDefaultQty) };
  }
  if (
    CFG.binanceProduct === "spot" &&
    signal.side === "BUY" &&
    Number.isFinite(CFG.binanceDefaultQuoteQty) &&
    CFG.binanceDefaultQuoteQty > 0
  ) {
    return { quoteOrderQty: String(CFG.binanceDefaultQuoteQty) };
  }
  throw new Error(
    "No valid quantity. Provide signal.quantity or BINANCE_DEFAULT_QTY (or BINANCE_DEFAULT_QUOTE_QTY for spot BUY)",
  );
}

function buildExecSummary(execResults) {
  return execResults
    .map((r) => {
      const broker = r.broker || "broker";
      const status = r.status || "unknown";
      const detail = r.reason
        ? `(${r.reason})`
        : r.orderId
          ? `(#${r.orderId})`
          : "";
      return `${broker}:${status}${detail ? " " + detail : ""}`;
    })
    .join(" | ");
}

async function handleSignal(payload) {
  const signal = normalizeSignal(payload);

  // Store as signal in DB, no auto-execution
  const text = formatSignal(signal);
  const telegram = await sendTelegram(text);

  return {
    ok: true,
    signal,
    telegram,
  };
}

// ==================== MT5 bridge (merged routes) ====================
function mt5NowIso() {
  return new Date().toISOString();
}

async function healthCronConfigDiagnostics() {
  const empty = {
    market_data_active: 0,
    analysis_active: 0,
    snapshots_active: 0,
    db_error: null,
  };
  try {
    const b = await mt5Backend();
    if (!b?.db) return empty;
    const rows = await dbQueries.listUserSettingsByType(b.db, null, "cron");
    let md = 0,
      ai = 0,
      snap = 0;
    for (const r of rows) {
      const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data || {};
      const ct = d.cron_type || "";
      if (String(r.status || "").toUpperCase() !== "ACTIVE") continue;
      if (ct === "MARKET_DATA_CRON") md++;
      else if (ct === "ANALYSIS_CRON") ai++;
      else if (ct === "SNAPSHOTS_CRON" || ct === "SNAPSHOT_CRON") snap++;
    }
    return {
      market_data_active: md,
      analysis_active: ai,
      snapshots_active: snap,
      db_error: null,
    };
  } catch (err) {
    return {
      ...empty,
      db_error: err instanceof Error ? err.message : String(err || "error"),
    };
  }
}

async function healthCronStatusesByName() {
  try {
    const b = await mt5Backend();
    if (!b?.db) return {};
    const rows = await dbQueries.listUserSettingsByType(b.db, null, "cron");
    const out = {};
    for (const r of rows || []) {
      const name = String(r?.name || "").trim();
      if (!name) continue;
      const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data || {};
      out[name] = {
        status: String(r?.status || "").toUpperCase() || "UNKNOWN",
        cron_type: String(d?.cron_type || ""),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function mt5ParsePriceOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mt5ResolvePlannedPnlValue(rawValue, fallbackValue) {
  const direct = Number(rawValue);
  if (Number.isFinite(direct) && Math.abs(direct) > 0.000001) return direct;
  if (rawValue === 0 || rawValue === "0" || rawValue === "0.0") return 0;
  const fallback = Number(fallbackValue);
  return Number.isFinite(fallback) ? Number(fallback.toFixed(2)) : 0;
}

function mt5ResolveStoredPlannedPnlValue(rawValue, fallbackValue) {
  const direct = Number(rawValue);
  if (Number.isFinite(direct) && Math.abs(direct) > 0.000001) return direct;
  const fallback = Number(fallbackValue);
  if (Number.isFinite(fallback)) return Number(fallback.toFixed(2));
  return Number.isFinite(direct) ? direct : 0;
}

function mt5ExtractBrokerPlannedPnlOverride(rawValue) {
  const direct = Number(rawValue);
  if (!Number.isFinite(direct) || Math.abs(direct) <= 0.000001) return null;
  return Number(direct.toFixed(2));
}

function mt5ComputePlannedPnlFromMetrics(item = {}, symbolMetric = null) {
  const entry = mt5ParsePriceOrNull(
    item.entry ?? item.entry_price ?? item.target_price ?? item.price,
  );
  const side = String(item.action ?? item.side ?? "")
    .trim()
    .toUpperCase();
  const volume = Number(item.volume);
  const pipSize = Number(symbolMetric?.pip_size);
  const pipValue = Number(symbolMetric?.pip_value);
  if (
    entry == null ||
    !["BUY", "SELL"].includes(side) ||
    !Number.isFinite(volume) ||
    volume <= 0 ||
    !Number.isFinite(pipSize) ||
    pipSize <= 0 ||
    !Number.isFinite(pipValue) ||
    pipValue <= 0
  ) {
    return { tpPnl: NaN, slPnl: NaN };
  }
  const signedPnlForTarget = (targetRaw) => {
    const target = mt5ParsePriceOrNull(targetRaw);
    if (target == null) return NaN;
    let pips = (target - entry) / pipSize;
    if (side === "SELL") pips = -pips;
    return pips * pipValue * volume;
  };
  return {
    tpPnl: signedPnlForTarget(item.tp ?? item.take_profit ?? item.tp1),
    slPnl: signedPnlForTarget(item.sl ?? item.stop_loss),
  };
}

function mt5ParseAccountMetadata(rawMeta) {
  if (rawMeta && typeof rawMeta === "object") return rawMeta;
  if (typeof rawMeta !== "string" || !rawMeta.trim()) return {};
  try {
    const parsed = JSON.parse(rawMeta);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function mt5FindSymbolMetric(accountMeta = {}, symbol = "") {
  const want = String(symbol || "")
    .trim()
    .toUpperCase();
  if (!want) return null;
  const metrics = Array.isArray(accountMeta?.symbol_metrics)
    ? accountMeta.symbol_metrics
    : [];
  return (
    metrics.find(
      (metric) =>
        String(metric?.symbol || "")
          .trim()
          .toUpperCase() === want,
    ) || null
  );
}

function mt5NormalizeTpTargets(input = [], sideRaw = "") {
  const side = String(sideRaw || "").toUpperCase();
  const isSell = side === "SELL";
  const vals = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const n = mt5ParsePriceOrNull(raw);
    if (n != null) vals.push(n);
  }
  const uniq = Array.from(new Set(vals.map((x) => Number(x.toFixed(8)))));
  uniq.sort((a, b) => (isSell ? b - a : a - b));
  return uniq.slice(0, 3);
}

function mt5NormalizeTpFields(payload = {}, sideRaw = "") {
  const cands = [
    payload.tp1,
    payload.tp2,
    payload.tp3,
    payload.tp,
    payload.take_profit,
  ];
  if (Array.isArray(payload.tp_targets)) cands.push(...payload.tp_targets);
  const targets = mt5NormalizeTpTargets(cands, sideRaw);
  return {
    tp1: targets[0] ?? null,
    tp2: targets[1] ?? null,
    tp3: targets[2] ?? null,
    tp: targets[0] ?? null,
    tp_targets: targets,
  };
}

function mt5ParseNumericId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function mt5RenewSignalIdBase(oldId = "") {
  const cleaned = String(oldId || "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  if (cleaned.length === 9) return cleaned;
  return mt5GenerateTimeSid();
}

function mt5RenewSignalIdFromExisting(baseId, existingIds) {
  const base = mt5RenewSignalIdBase(baseId);
  let max = 0;
  const ids = Array.isArray(existingIds) ? existingIds : [];
  for (const idRaw of ids) {
    const id = String(idRaw || "");
    if (id === base) {
      max = Math.max(max, 0);
      continue;
    }
    const match = id.match(
      new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(\\d+)$`),
    );
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${base}.${max + 1}`;
}

let MT5_BACKEND = null;

// In-memory broker price cache (real-time bid/ask from cTrader)
const brokerPriceCache = {};
let lastBrokerPricePush = 0;

function mt5MapDbRow(row) {
  if (!row) return null;
  const rawInput = row.raw_json || {};
  const raw =
    typeof rawInput === "object" && rawInput !== null ? { ...rawInput } : {};
  const rawPrice = Number(raw.price);
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    raw.price = null;
  }
  const rawEntry = Number(raw.entry);
  if (!Number.isFinite(rawEntry) || rawEntry <= 0) {
    raw.entry = null;
  }
  const execEntry =
    row.entry_exec === null || row.entry_exec === undefined
      ? null
      : Number(row.entry_exec);
  const execSl =
    asNum(row.sl_exec) ??
    asNum(row.metadata?.sl_exec) ??
    asNum(row.metadata?.broker_data?.sl) ??
    null;
  const execTp =
    asNum(row.tp_exec) ??
    asNum(row.metadata?.tp_exec) ??
    asNum(row.metadata?.broker_data?.tp) ??
    null;
  const rowEntry =
    row.entry === null || row.entry === undefined ? null : Number(row.entry);
  const entryFromRaw = Number(raw.entry ?? raw.price);
  const resolvedEntry =
    Number.isFinite(rowEntry) && rowEntry > 0
      ? rowEntry
      : Number.isFinite(entryFromRaw) && entryFromRaw > 0
        ? entryFromRaw
        : null;
  const normalizedModel = mt5NormalizeEntryModel(
    row.entry_model ||
      raw.entry_model ||
      raw.entryModel ||
      raw.model ||
      raw.strategy ||
      "",
    { fallback: row.source_id || row.source || "manual" },
  );
  const tfFallback = String(
    row.signal_tf ||
      raw.signal_tf ||
      raw.signalTf ||
      raw.sourceTf ||
      raw.timeframe ||
      "",
  );
  return {
    id: row.id === null || row.id === undefined ? null : Number(row.id),
    sid: String(row.sid || row.sid || ""),
    sid: String(row.sid),
    created_at: String(row.created_at),
    user_id: String(row.user_id || CFG.mt5DefaultUserId || "default"),
    source: String(row.source || ""),
    source_id: String(row.source_id || ""),
    action: String(row.action || row.side || ""),
    side: String(row.side || row.action || ""),
    symbol: String(row.symbol || ""),
    volume: Number(row.volume),
    volume_basis_lots:
      row.volume_basis_lots === null || row.volume_basis_lots === undefined
        ? asNum(row.metadata?.volume_basis_lots) ?? null
        : Number(row.volume_basis_lots),
    broker_lots:
      row.broker_lots === null || row.broker_lots === undefined
        ? asNum(row.metadata?.broker_lots) ??
          asNum(row.metadata?.broker_data?.lots) ??
          null
        : Number(row.broker_lots),
    sl: row.sl === null || row.sl === undefined ? null : Number(row.sl),
    tp: row.tp === null || row.tp === undefined ? null : Number(row.tp),
    tp1: row.tp1 === null || row.tp1 === undefined ? null : Number(row.tp1),
    tp2: row.tp2 === null || row.tp2 === undefined ? null : Number(row.tp2),
    tp3: row.tp3 === null || row.tp3 === undefined ? null : Number(row.tp3),
    tp_targets: [row.tp1, row.tp2, row.tp3]
      .map((x) => (x === null || x === undefined ? null : Number(x)))
      .filter((x) => Number.isFinite(x)),
    entry: resolvedEntry,
    rr_planned:
      row.rr_planned === null || row.rr_planned === undefined
        ? null
        : Number(row.rr_planned),
    planned_tp_pnl:
      row.planned_tp_pnl === null || row.planned_tp_pnl === undefined
        ? null
        : Number(row.planned_tp_pnl),
    planned_sl_pnl:
      row.planned_sl_pnl === null || row.planned_sl_pnl === undefined
        ? null
        : Number(row.planned_sl_pnl),
    broker_tp_pnl:
      row.broker_tp_pnl === null || row.broker_tp_pnl === undefined
        ? null
        : Number(row.broker_tp_pnl),
    broker_sl_pnl:
      row.broker_sl_pnl === null || row.broker_sl_pnl === undefined
        ? null
        : Number(row.broker_sl_pnl),
    risk_money_planned:
      row.risk_money_planned === null || row.risk_money_planned === undefined
        ? null
        : Number(row.risk_money_planned),
    pnl_money_realized:
      row.pnl_money_realized === null || row.pnl_money_realized === undefined
        ? null
        : Number(row.pnl_money_realized),
    entry_price_exec:
      Number.isFinite(execEntry) && execEntry > 0 ? execEntry : null,
    sl_exec: Number.isFinite(execSl) && execSl > 0 ? execSl : null,
    tp_exec: Number.isFinite(execTp) && execTp > 0 ? execTp : null,
    note: String(row.note || ""),
    raw_json: raw,
    signal_tf: tfFallback,
    chart_tf: String(
      row.chart_tf ||
        raw.chart_tf ||
        raw.chartTf ||
        raw.chartTimeframe ||
        tfFallback ||
        "",
    ),
    entry_model: normalizedModel,
    status: String(row.status || ""),
    execution_status: String(row.execution_status || ""),
    dispatch_status: String(row.dispatch_status || ""),
    close_reason: row.close_reason || row.closeReason || null,
    rejection_reason: row.rejection_reason || null,
    locked_at: row.locked_at ?? null,
    ack_at: row.ack_at ?? null,
    opened_at: row.opened_at ?? null,
    closed_at: row.closed_at ?? null,
    ack_status: row.ack_status ?? null,
    ack_ticket: row.ack_ticket ?? null,
    ack_error: row.ack_error ?? null,
  };
}

let MT5_INIT_PROMISE = null;
const MT5_BACKENDS = new Map();
const MT5_INIT_PROMISES = new Map();
const MT5_DB_SOURCE_CONTEXT = new AsyncLocalStorage();

function maskDbUrl(url) {
  return String(url || "").replace(/:[^:@/]+@/, ":***@");
}

function sameDbTarget(a, b) {
  try {
    const ua = new URL(String(a || ""));
    const ub = new URL(String(b || ""));
    return (
      ua.protocol === ub.protocol &&
      ua.hostname === ub.hostname &&
      (ua.port || "5432") === (ub.port || "5432") &&
      ua.pathname === ub.pathname &&
      ua.username === ub.username
    );
  } catch {
    return false;
  }
}

function mt5DbSources() {
  const out = [];
  const add = (id, name, url, note = "") => {
    const cleanId = envStr(id).toLowerCase();
    const cleanUrl = envStr(url);
    if (!cleanId || !cleanUrl) return;
    if (out.some((s) => s.id === cleanId || sameDbTarget(s.url, cleanUrl))) {
      return;
    }
    out.push({ id: cleanId, name, url: cleanUrl, note });
  };
  const dbManagerConfig = path.resolve(
    __dirname,
    "../db/.local/db-manager/connections.json",
  );
  if (fs.existsSync(dbManagerConfig)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(dbManagerConfig, "utf8"));
      for (const conn of parsed?.connections || []) {
        add(conn?.id, conn?.name || conn?.id, conn?.connectionString, conn?.note);
      }
    } catch (err) {
      console.warn("[db-source] failed to read db-manager config:", err.message);
    }
  }
  add("local", "Local DB", process.env.MT5_POSTGRES_URL_LOCAL, "Local Postgres");
  add(
    "vps",
    "VPS DB",
    process.env.MT5_POSTGRES_URL_REMOTE,
    "VPS Postgres via local tunnel",
  );
  add("active", "Active DB", CFG.mt5PostgresUrl, "Webhook default DB");
  return out;
}

function resolveMt5DbSource(sourceId = "") {
  const sources = mt5DbSources();
  const id = envStr(sourceId).toLowerCase();
  console.log("[db-source] resolveMt5DbSource id=", id, "sources=", sources.map(s => s.id));
  const found = sources.find((s) => s.id === id);
  if (found) return found;
  const active =
    sources.find((s) => sameDbTarget(s.url, CFG.mt5PostgresUrl)) || sources[0];
  if (active) return active;
  return CFG.mt5PostgresUrl
    ? {
        id: "active",
        name: "Active DB",
        url: CFG.mt5PostgresUrl,
        note: "Webhook default DB",
      }
    : null;
}

function currentMt5DbSourceId() {
  return envStr(
    MT5_DB_SOURCE_CONTEXT.getStore()?.sourceId || global._requestDbSource,
  ).toLowerCase();
}

async function mt5InitBackend(sourceId = currentMt5DbSourceId()) {
  const source = resolveMt5DbSource(sourceId);
  const cacheKey =
    CFG.mt5StorageBackend === "sqlite"
      ? `sqlite:${CFG.mt5SqlitePath || "data/trading.db"}`
      : source?.id || "active";
  if (MT5_BACKENDS.has(cacheKey)) return MT5_BACKENDS.get(cacheKey);
  if (MT5_INIT_PROMISES.has(cacheKey)) return MT5_INIT_PROMISES.get(cacheKey);
  const promise = _mt5InitBackendInternal(source)
    .then((backend) => {
      MT5_BACKENDS.set(cacheKey, backend);
      if (!MT5_BACKEND || !sourceId) MT5_BACKEND = backend;
      return backend;
    })
    .catch((e) => {
      MT5_INIT_PROMISES.delete(cacheKey);
      if (!sourceId) MT5_INIT_PROMISE = null;
      throw e;
    });
  MT5_INIT_PROMISES.set(cacheKey, promise);
  if (!sourceId) MT5_INIT_PROMISE = promise;
  return promise;
}

async function _mt5InitBackendInternal(source = null) {
  const postgresUrl = source?.url || CFG.mt5PostgresUrl;
  console.log("[db-source] _mt5InitBackendInternal url=", postgresUrl?.replace(/:[^:@]+@/, ":***@"));
  // SQLite mode — skip all PostgreSQL DDL, use Drizzle directly
  if (CFG.mt5StorageBackend === "sqlite") {
    const { initDb } = require("../db");
    const s = require("../db/schema.js");
    const db = initDb({
      storage: {
        backend: "sqlite",
        sqlite: { path: CFG.mt5SqlitePath || "data/trading.db" },
      },
    });
    return {
      storage: "sqlite",
      source_id: source?.id || "sqlite",
      source_name: source?.name || "SQLite",
      db,
      schema: s,
      query: (q, p) => {
        throw new Error("raw SQL not supported in SQLite mode");
      },
      info: { url: `sqlite:${CFG.mt5SqlitePath || "data/trading.db"}` },
      pool: null,
    };
  }

  if (!postgresUrl) {
    throw new Error(
      "MT5_STORAGE=postgres but POSTGRES_URL/POSTGRE_URL/MT5_POSTGRES_URL is empty",
    );
  }
  let pgModule;

  try {
    pgModule = require("pg");
  } catch {
    throw new Error(
      "MT5 postgres backend requires `pg` package. Run: npm install pg",
    );
  }

  const { Pool } = pgModule;
  const pool = new Pool({
    connectionString: postgresUrl,
    max: 20, // Allow up to 20 concurrent connections
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on("error", (err) => {
    console.error("[Postgres Pool Error]", err);
  });

  // NEW UNIFIED SCHEMA (v2.2 simplified)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      password_hash TEXT,
      password_salt TEXT,
      role TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_accounts (
      account_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      name TEXT,
      balance DOUBLE PRECISION NULL,
      api_key_hash TEXT NULL,
      api_key_last4 TEXT NULL,
      api_key_rotated_at TIMESTAMPTZ NULL,
      source_ids_cache JSONB NULL,
      metadata JSONB,
      status TEXT,
      equity NUMERIC NULL,
      margin NUMERIC NULL,
      free_margin NUMERIC NULL,
      leverage NUMERIC NULL,
      broker_name TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_templates (
        id SERIAL PRIMARY KEY,
        user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        data JSONB NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      name TEXT,
      type TEXT NOT NULL,
      data JSONB NOT NULL,
      status TEXT DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );


    -- DDL Migration for existing installations
    ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS equity NUMERIC NULL;
    ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS margin NUMERIC NULL;
    ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS free_margin NUMERIC NULL;
    ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS leverage NUMERIC NULL;
    ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS broker_name TEXT NULL;

    ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'default';
    ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE';
    ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS value TEXT;
    DROP INDEX IF EXISTS idx_user_settings_singleton;
    DROP INDEX IF EXISTS idx_user_settings_user_type_name;
    ALTER TABLE user_settings DROP CONSTRAINT IF EXISTS user_settings_user_type_name_key;
    ALTER TABLE user_settings ADD CONSTRAINT user_settings_user_type_name_key UNIQUE (user_id, type, name);

    -- Keep old tables for safe migration then drop
    DROP TABLE IF EXISTS ai_configs;

    CREATE TABLE IF NOT EXISTS trades (
      sid TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES user_accounts(account_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      signal_id TEXT NULL,
      source_id TEXT NULL,
      strategy TEXT NULL,
      entry_model TEXT NULL,
      signal_tf TEXT NULL,
      chart_tf TEXT NULL,
      symbol TEXT NOT NULL,
      action TEXT NOT NULL,
      order_type TEXT NULL, -- market, limit, stop
      volume FLOAT8 NULL,
      entry FLOAT8 NULL,
      sl FLOAT8 NULL,
      tp FLOAT8 NULL,
      note TEXT NULL,
      lease_token TEXT NULL,
      lease_expires_at TIMESTAMPTZ NULL,
      dispatch_status TEXT NOT NULL DEFAULT 'NEW',
      execution_status TEXT NOT NULL DEFAULT 'PENDING',
      close_reason TEXT NULL,
      rejection_reason TEXT NULL,
      broker_trade_id TEXT NULL,
      entry_exec FLOAT8 NULL,
      broker_pips FLOAT8 NULL,
      broker_lots FLOAT8 NULL,
      broker_commission FLOAT8 NULL,
      broker_swap FLOAT8 NULL,
      broker_volume FLOAT8 NULL,
      broker_pnl FLOAT8 NULL,
      broker_margin FLOAT8 NULL,
      planned_tp_pnl FLOAT8 NULL,
      planned_sl_pnl FLOAT8 NULL,
      broker_tp_pnl FLOAT8 NULL,
      broker_sl_pnl FLOAT8 NULL,
      opened_at TIMESTAMPTZ NULL,
      closed_at TIMESTAMPTZ NULL,
      pnl_realized FLOAT8 NULL,
      metadata JSONB NULL,
      raw_json JSONB NULL,
      last_price DOUBLE PRECISION NULL,
      last_price_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      profile TEXT NULL,
      confidence_pct FLOAT8 NULL,
      estimated_bars INT NULL,
      be_trigger FLOAT8 NULL
    );

    ALTER TABLE trades ADD COLUMN IF NOT EXISTS profile TEXT;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS confidence_pct FLOAT8;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS estimated_bars INT;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS be_trigger FLOAT8;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp1 FLOAT8 NULL;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp2 FLOAT8 NULL;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp3 FLOAT8 NULL;



    -- DDL Migrations
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS order_type TEXT NULL;
  `);

  await pool.query(
    `ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy TEXT NULL`,
  );
  await pool.query(
    `ALTER TABLE trades ADD COLUMN IF NOT EXISTS rr_planned DOUBLE PRECISION NULL`,
  );
  await pool.query(
    `ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_money_planned DOUBLE PRECISION NULL`,
  );
  await pool.query(
    `ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_pct_planned DOUBLE PRECISION NULL`,
  );
  await pool.query(
    `ALTER TABLE trades ADD COLUMN IF NOT EXISTS planned_tp_pnl DOUBLE PRECISION NULL`,
  );
  await pool.query(
    `ALTER TABLE trades ADD COLUMN IF NOT EXISTS planned_sl_pnl DOUBLE PRECISION NULL`,
  );

  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`).catch(() => {});
  await pool
    .query(
      `
    CREATE OR REPLACE FUNCTION gen_sid(prefix TEXT DEFAULT '', chars_limit INT DEFAULT 8)
    RETURNS TEXT
    LANGUAGE plpgsql
    AS $$
    DECLARE
      p TEXT := UPPER(COALESCE(prefix, ''));
      n INT := GREATEST(4, LEAST(COALESCE(chars_limit, 8), 32));
      rnd TEXT;
    BEGIN
      rnd := UPPER(SUBSTRING(ENCODE(GEN_RANDOM_BYTES(24), 'hex') FROM 1 FOR n));
      IF p = '' THEN
        RETURN rnd;
      END IF;
      RETURN p || '_' || rnd;
    END;
    $$;
  `,
    )
    .catch(() => {});

  const legacyTables = [
    "signal_events",
    "trade_events",
    "source_events",
    "mt5_signals",
    "ui_auth_users",
    "user_api_keys",
    "brokers",
  ];
  for (const t of legacyTables) {
    await pool.query(`DROP TABLE IF EXISTS ${t} CASCADE`).catch(() => {});
  }

  // Migration: Rename user_name to name in users table if it exists
  await pool
    .query(`ALTER TABLE users RENAME COLUMN user_name TO name`)
    .catch(() => {});

  // Migration: keep schema simple and aligned with v2.2 fields.
  await pool
    .query(`ALTER TABLE users DROP COLUMN IF EXISTS balance_start`)
    .catch(() => {});

  await pool
    .query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS sid TEXT NULL`)
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL`,
    )
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS id BIGSERIAL`)
    .catch(() => {});

  await pool
    .query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS id BIGSERIAL`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sid TEXT NULL`)
    .catch(() => {});

  await pool
    .query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS id BIGSERIAL`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sid TEXT NULL`)
    .catch(() => {});

  await pool
    .query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS name TEXT`)
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance DOUBLE PRECISION NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS api_key_hash TEXT NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS api_key_last4 TEXT NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS api_key_rotated_at TIMESTAMPTZ NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS source_ids_cache JSONB NULL`,
    )
    .catch(() => {});
  await pool
    .query(`ALTER TABLE accounts DROP COLUMN IF EXISTS broker_id`)
    .catch(() => {});

  // Compatibility migration: absorb legacy AI templates from both the old
  // physical table and deprecated user_settings rows into user_templates.
  try {
    const legacyAiTemplatesTable = await pool.query(
      `SELECT to_regclass('public.ai_templates') AS table_name`,
    );
    if (legacyAiTemplatesTable.rows?.[0]?.table_name) {
      await pool
        .query(
          `
        INSERT INTO user_templates (user_id, name, data, status, created_at, updated_at)
        SELECT
          COALESCE(NULLIF(t.user_id, ''), $1) AS user_id,
          COALESCE(NULLIF(t.name, ''), 'Legacy Template ' || COALESCE(t.id::text, substr(md5(random()::text), 1, 6))) AS name,
          (to_jsonb(t) - 'id' - 'user_id' - 'name' - 'status' - 'created_at' - 'updated_at') AS data,
          COALESCE(NULLIF(t.status, ''), 'ACTIVE') AS status,
          COALESCE(t.created_at, NOW()) AS created_at,
          COALESCE(t.updated_at, NOW()) AS updated_at
        FROM ai_templates t
      `,
          [CFG.mt5DefaultUserId],
        )
        .catch(() => {});
      await pool.query(`DROP TABLE IF EXISTS ai_templates`).catch(() => {});
    }
  } catch (e) {
    console.warn(
      "[mt5-db] legacy ai_templates migration skipped:",
      e?.message || e,
    );
  }

  try {
    await pool.query(`
      INSERT INTO user_templates (user_id, name, data, status, created_at, updated_at)
      SELECT
        s.user_id,
        COALESCE(NULLIF(s.name, ''), 'Migrated Template ' || substr(md5(s.id::text), 1, 6)) AS name,
        COALESCE(s.data, '{}'::jsonb) AS data,
        COALESCE(NULLIF(s.status, ''), 'ACTIVE') AS status,
        COALESCE(s.created_at, NOW()) AS created_at,
        COALESCE(s.updated_at, NOW()) AS updated_at
      FROM user_settings s
      WHERE s.type = 'ai_template'
        AND NOT EXISTS (
          SELECT 1
          FROM user_templates ut
          WHERE ut.user_id = s.user_id
            AND ut.name = COALESCE(NULLIF(s.name, ''), 'Migrated Template ' || substr(md5(s.id::text), 1, 6))
        )
    `);
    await pool
      .query(`DELETE FROM user_settings WHERE type = 'ai_template'`)
      .catch(() => {});
  } catch (e) {
    console.warn(
      "[mt5-db] user_settings ai_template migration skipped:",
      e?.message || e,
    );
  }

  await pool
    .query(`ALTER TABLE trades RENAME COLUMN side TO action`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades RENAME COLUMN signal_sid TO signal_id`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades RENAME COLUMN broker_sid TO broker_trade_id`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades RENAME COLUMN intent_entry TO entry`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades RENAME COLUMN intent_sl TO sl`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades RENAME COLUMN intent_tp TO tp`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades RENAME COLUMN intent_note TO note`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS volume FLOAT8 NULL`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS user_id TEXT NULL`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_model TEXT NULL`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS signal_tf TEXT NULL`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS chart_tf TEXT NULL`)
    .catch(() => {});
  await pool.query(`SELECT 1`).catch(() => {});
  await pool
    .query(
      `
    ALTER TABLE trades
    -- trades_execution_status_check removed
    -- removed
  `,
    )
    .catch(() => {});
  await pool.query(`SELECT 1`).catch(() => {});
  // trades_close_reason_check removed
  await pool
    .query(`ALTER TABLE trades DROP COLUMN IF EXISTS origin_kind`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades DROP COLUMN IF EXISTS intent_volume`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades DROP COLUMN IF EXISTS broker_order_id`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades DROP COLUMN IF EXISTS pulled_at`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades DROP COLUMN IF EXISTS error_code`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades DROP COLUMN IF EXISTS error_message`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades DROP COLUMN IF EXISTS broker_id`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades DROP COLUMN IF EXISTS sl_exec`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades DROP COLUMN IF EXISTS tp_exec`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS raw_json JSONB NULL`)
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_pips DOUBLE PRECISION NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_lots DOUBLE PRECISION NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_commission DOUBLE PRECISION NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_swap DOUBLE PRECISION NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_volume DOUBLE PRECISION NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_pnl DOUBLE PRECISION NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_margin DOUBLE PRECISION NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_tp_pnl DOUBLE PRECISION NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_sl_pnl DOUBLE PRECISION NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp1 DOUBLE PRECISION NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp2 DOUBLE PRECISION NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp3 DOUBLE PRECISION NULL`,
    )
    .catch(() => {});

  // Performance Indexes
  const idxSql = [
    // Trades
    `CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_exec_status ON trades(execution_status)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_signal_id ON trades(signal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_broker_ticket ON trades(broker_trade_id)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id)`,
  ];
  for (const sql of idxSql) {
    await pool
      .query(sql)
      .catch((e) => console.error(`[db-idx] failed: ${sql}`, e.message));
  }
  const idSidMigrations = [
    { table: "users", legacy: "user_id", prefix: "USR" },
    { table: "accounts", legacy: "account_id", prefix: "ACC" },
  ];
  const UUID_REGEX_SQL =
    "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
  for (const { table, legacy, prefix } of idSidMigrations) {
    await pool
      .query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS id BIGSERIAL`)
      .catch(() => {});
    await pool
      .query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS sid TEXT`)
      .catch(() => {});
    await pool
      .query(
        `ALTER TABLE ${table} ALTER COLUMN sid SET DEFAULT gen_sid('${prefix}', 8)`,
      )
      .catch(() => {});
    await pool
      .query(
        `
      UPDATE ${table}
      SET sid = CASE
        WHEN COALESCE(NULLIF(${legacy}, ''), '') <> ''
             AND ${legacy} !~* '${UUID_REGEX_SQL}'
             AND length(${legacy}) <= 24 THEN ${legacy}
      ELSE mt5GenerateTimeSid()
END
      WHERE sid IS NULL OR sid = ''
    `,
      )
      .catch(() => {});
    // Normalize old UUID-style sids into compact custom SIDs.
    await pool
      .query(
        `
      UPDATE ${table}
      SET sid = gen_sid('${prefix}', 8)
      WHERE sid ~* '${UUID_REGEX_SQL}'
    `,
      )
      .catch(() => {});
    await pool
      .query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_${table}_id ON ${table}(id)`)
      .catch(() => {});
    await pool
      .query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${table}_sid ON ${table}(sid)`,
      )
      .catch(() => {});
    await pool
      .query(`ALTER TABLE ${table} ALTER COLUMN sid SET NOT NULL`)
      .catch(() => {});
  }
  // Normalize legacy UUID-style users.user_id into compact IDs when safe.
  const legacyUuidUsers = await pool
    .query(
      `
    SELECT user_id
    FROM users
    WHERE user_id ~* '${UUID_REGEX_SQL}'
  `,
    )
    .catch(() => ({ rows: [] }));
  for (const row of legacyUuidUsers.rows || []) {
    const oldUserId = String(row?.user_id || "").trim();
    if (!oldUserId) continue;
    if (oldUserId === String(CFG.mt5DefaultUserId || "")) continue;
    const refRes = await pool
      .query(
        `
      SELECT
        (SELECT COUNT(*) FROM user_accounts WHERE user_id = $1) AS accounts_count,
        (SELECT COUNT(*) FROM signals WHERE user_id = $1) AS signals_count,
        (SELECT COUNT(*) FROM trades WHERE user_id = $1) AS trades_count,
        (SELECT COUNT(*) FROM user_settings WHERE user_id = $1) AS settings_count
    `,
        [oldUserId],
      )
      .catch(() => ({ rows: [] }));
    const refRow = refRes.rows?.[0] || {};
    const totalRefs =
      Number(refRow.accounts_count || 0) +
      Number(refRow.signals_count || 0) +
      Number(refRow.trades_count || 0) +
      Number(refRow.settings_count || 0) +
      Number(refRow.profiles_count || 0);
    if (totalRefs > 0) continue;
    let nextUserId = "";
    for (let i = 0; i < 8; i += 1) {
      const genRes = await pool
        .query(`SELECT 'USR' || mt5GenerateTimeSid() AS v`)
        .catch(() => ({ rows: [] }));
      const candidate = String(genRes.rows?.[0]?.v || "").trim();
      if (!candidate) continue;
      const exists = await pool
        .query(`SELECT 1 FROM users WHERE user_id = $1 LIMIT 1`, [candidate])
        .catch(() => ({ rows: [{ ok: 1 }] }));
      if (!exists.rows?.length) {
        nextUserId = candidate;
        break;
      }
    }
    if (!nextUserId) continue;
    await pool
      .query(
        `UPDATE users SET user_id = $1, updated_at = NOW() WHERE user_id = $2`,
        [nextUserId, oldUserId],
      )
      .catch(() => {});
  }

  // Ensure default user
  const now = mt5NowIso();
  await pool.query(
    `
    INSERT INTO users (user_id, email, password_hash, role, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id) DO UPDATE SET
      role = EXCLUDED.role,
      updated_at = EXCLUDED.updated_at
  `,
    [
      CFG.mt5DefaultUserId,
      "System",
      "",
      UI_ROLE_SYSTEM,
      mt5NowIso(),
      mt5NowIso(),
    ],
  );
  await pool
    .query(
      `
    WITH legacy AS (
      SELECT email, password_salt, password_hash, updated_at
      FROM ui_auth_users
      ORDER BY updated_at DESC
      LIMIT 1
    )
    UPDATE users u
    SET name = COALESCE(NULLIF(u.name, ''), split_part(legacy.email, '@', 1)),
        email = lower(legacy.email),
        password_salt = legacy.password_salt,
        password_hash = legacy.password_hash,
        role = $2,
        updated_at = COALESCE(legacy.updated_at, NOW())
    FROM legacy
    WHERE u.user_id = $1
  `,
      [CFG.mt5DefaultUserId, UI_ROLE_SYSTEM],
    )
    .catch(() => {
      // Legacy table may not exist; safe to ignore.
    });

  // Legacy migration paths removed; using Postgres-exclusive storage.

  async function allocateUniqueSid(
    client,
    table,
    baseRaw,
    fallbackPrefix = "ID",
  ) {
    // Use preferred SID if it's a valid 9-char base36 string (e.g., from analyze session).
    const preferred =
      baseRaw && typeof baseRaw === "string" && baseRaw.length === 9
        ? baseRaw
        : null;
    if (preferred) return preferred;
    return mt5GenerateTimeSid();
  }

  const backendLog = async (
    objectId,
    objectTable,
    metadata = {},
    userId = null,
  ) => {
    fileLog(objectId, objectTable, metadata, userId);
  };

  // Initialize NotificationManager (loads notification_config from user_settings)
  await notificationManager.init(pool);
  global.__notificationManager = notificationManager;

  const storage = "postgres";

  // Drizzle ORM — multi-backend (PostgreSQL or SQLite)
  const { initDb } = require("../db");
  const db = initDb({ pool });
  const schema = require("../db/schema.js");

  // Migration: JSONB → TEXT for SQLite compatibility
  await pool
    .query(
      `
    ALTER TABLE users ALTER COLUMN metadata TYPE TEXT USING metadata::text;
    ALTER TABLE user_accounts ALTER COLUMN metadata TYPE TEXT USING metadata::text;
    ALTER TABLE user_accounts ALTER COLUMN source_ids_cache TYPE TEXT USING source_ids_cache::text;
    ALTER TABLE user_templates ALTER COLUMN data TYPE TEXT USING data::text;
    ALTER TABLE user_settings ALTER COLUMN data TYPE TEXT USING data::text;
    ALTER TABLE trades ALTER COLUMN raw_json TYPE TEXT USING raw_json::text;
    ALTER TABLE trades ALTER COLUMN metadata TYPE TEXT USING metadata::text;
    ALTER TABLE trades ALTER COLUMN confluence_checklist TYPE TEXT USING confluence_checklist::text;
    ALTER TABLE trades ALTER COLUMN risk_management TYPE TEXT USING risk_management::text;
  `,
    )
    .catch(() => {}); // ignore if already TEXT

  const backend = {
    storage,
    source_id: source?.id || "active",
    source_name: source?.name || "Active DB",
    pool,
    db,
    schema,
    query: (q, p) => pool.query(q, p),
    info: { url: maskDbUrl(postgresUrl) },
    async log(objectId, objectTable, metadata = {}, userId = null) {
      return backendLog(objectId, objectTable, metadata, userId);
    },
    async upsertSignal(signal) {
      const signalSid = await allocateUniqueSid(
        pool,
        "signals",
        signal.sid,
        "SIG",
      );
      const nowVal = new Date();
      const values = {
        sid: signalSid,
        createdAt: signal.created_at ? new Date(signal.created_at) : nowVal,
        userId: signal.user_id,
        source: signal.source || null,
        sourceId: signal.source_id || null,
        symbol: signal.symbol,
        side: signal.side,
        orderType: signal.order_type || null,
        entry: signal.entry != null ? Number(signal.entry) : null,
        sl: signal.sl != null ? Number(signal.sl) : null,
        tp: signal.tp != null ? Number(signal.tp) : null,
        strategy: signal.strategy || null,
        entryModel: signal.entry_model || null,
        signalTf: signal.signal_tf || null,
        chartTf: signal.chart_tf || null,
        rrPlanned: signal.rr_planned != null ? Number(signal.rr_planned) : null,
        riskMoneyPlanned:
          signal.risk_money_planned != null
            ? Number(signal.risk_money_planned)
            : null,
        riskPctPlanned:
          signal.risk_pct_planned != null
            ? Number(signal.risk_pct_planned)
            : null,
        note: signal.note || null,
        rejectionReason: signal.rejection_reason || null,
        rawJson: (() => {
          const rj = signal.raw_json || {};
          if (rj && typeof rj === "object" && rj.prompt) {
            const { prompt: _, ...rest } = rj;
            return JSON.stringify(rest);
          }
          return JSON.stringify(rj);
        })(),
        status: signal.status || "NEW",
        profile: signal.profile || null,
        confidencePct:
          signal.confidence_pct != null ? Number(signal.confidence_pct) : null,
        estimatedBars:
          signal.estimated_bars != null ? Number(signal.estimated_bars) : null,
        beTrigger: signal.be_trigger != null ? Number(signal.be_trigger) : null,
      };
      try {
        await db.insert(schema.signals).values(values);
        bumpPulse(signal.user_id);
        return { inserted: true };
      } catch (e) {
        if (e.message?.includes("duplicate key") || e.code === "23505") {
          return { inserted: false };
        }
        throw e;
      }
    },
    async findSignalById(signalId) {
      const sid = String(signalId || "").trim();
      if (!sid) return null;
      const rows = await db
        .select()
        .from(schema.signals)
        .where(
          or(
            eq(schema.signals.sid, sid),
            eq(sql`${schema.signals.rawJson}->>'id'`, sid),
            eq(sql`${schema.signals.rawJson}->>'sid'`, sid),
          ),
        )
        .orderBy(
          sql`CASE WHEN ${schema.signals.sid} = ${sid} THEN 0 ELSE 1 END`,
          desc(schema.signals.createdAt),
        )
        .limit(1);
      const row = rows?.[0] || null;
      if (!row) return null;
      let raw = {};
      try {
        raw = JSON.parse(row.rawJson || "{}");
      } catch {}
      const side = String(
        row.side || raw.action || raw.side || "BUY",
      ).toUpperCase();
      const volumeRaw = Number(raw.volume ?? raw.lots ?? CFG.mt5DefaultLot);
      return {
        ...row,
        action: side,
        volume:
          Number.isFinite(volumeRaw) && volumeRaw > 0
            ? volumeRaw
            : CFG.mt5DefaultLot,
      };
    },
    async getSignalByTicket(ticket) {
      const tk = String(ticket || "").trim();
      if (!tk) return null;
      const rows = await db
        .select()
        .from(schema.trades)
        .leftJoin(
          schema.signals,
          eq(schema.signals.sid, schema.trades.signalId),
        )
        .where(eq(schema.trades.brokerTradeId, tk))
        .orderBy(desc(schema.trades.updatedAt), desc(schema.trades.createdAt))
        .limit(1);
      const row = rows?.[0];
      if (!row || !row.signals) return null;
      const sig = row.signals;
      let raw = {};
      try {
        raw = JSON.parse(sig.rawJson || "{}");
      } catch {}
      const side = String(
        sig.side || raw.action || raw.side || "BUY",
      ).toUpperCase();
      const volumeRaw = Number(raw.volume ?? raw.lots ?? CFG.mt5DefaultLot);
      return {
        ...sig,
        action: side,
        volume:
          Number.isFinite(volumeRaw) && volumeRaw > 0
            ? volumeRaw
            : CFG.mt5DefaultLot,
      };
    },

    async pullAndLockNextTask(accountId = null) {
      const aid = String(accountId || "").trim();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // 0. Re-pick expired leased trades first (broker ack never arrived)
        const selExpired = await client.query(
          `
          SELECT * FROM trades
          WHERE account_id = $1::TEXT
            AND execution_status = 'PENDING'
            AND dispatch_status = 'LEASED'
            AND lease_expires_at < NOW()
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `,
          [aid],
        );

        if (selExpired.rows.length > 0) {
          const row = selExpired.rows[0];
          const leaseToken = mt5GenerateTimeSid();
          await client.query(
            `UPDATE trades SET dispatch_status = 'LEASED', lease_token = $1, lease_expires_at = NOW() + INTERVAL '1 minute', updated_at = NOW() WHERE sid = $2`,
            [leaseToken, row.sid],
          );
          await client.query("COMMIT");
          console.log(
            `[Poll] Re-leasing expired trade ${row.sid} (was stuck at LEASED)`,
          );
          return {
            task_id: row.sid,
            type: "OPEN",
            symbol: row.symbol,
            action: row.action,
            volume: row.volume,
            price: row.entry,
            sl: row.sl,
            tp: row.tp,
            risk_money_planned: row.risk_money_planned,
            sid: row.sid,
            ticket: row.broker_trade_id,
            raw_json: row.raw_json,
          };
        }

        // 1. Unified Trades table: Pending Actions (Mod/Close/Cancel) OR New Signals
        const selTrd = await client.query(
          `
          SELECT * FROM trades
          WHERE dispatch_status IN ('OPEN', 'MODIFY', 'CLOSE', 'CANCEL')
            AND (
              execution_status IN ('PENDING','FILLED')
              OR (dispatch_status IN ('CANCEL','CLOSE') AND execution_status IN ('CANCELLED','CLOSED'))
            )
            AND (account_id = $1::TEXT OR account_id IS NULL OR account_id = '')
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `,
          [aid],
        );

        if (selTrd.rows.length > 0) {
          const row = selTrd.rows[0];

          const taskType = syncGuards.brokerTaskTypeForTrade(row);

          await client.query(
            `
            UPDATE trades
            SET dispatch_status = 'LEASED',
                lease_token = $1,
                lease_expires_at = NOW() + INTERVAL '1 minute',
                updated_at = NOW()
            WHERE sid = $2
          `,
            [mt5GenerateTimeSid(), row.sid],
          );

          await client.query("COMMIT");

          return {
            task_id: row.sid,
            type: taskType,
            symbol: row.symbol,
            action: row.action,
            volume: row.volume,
            price: row.entry,
            sl: row.sl,
            tp: row.tp,
            risk_money_planned: row.risk_money_planned,
            sid: row.sid,
            ticket: row.broker_trade_id,
            raw_json: row.raw_json,
          };
        }

        // 2. Legacy Signals table fallback
        const selSig = await client.query(`
          SELECT * FROM signals
          WHERE status = 'NEW'
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);

        if (selSig.rows.length > 0) {
          const row = selSig.rows[0];
          await client.query(
            `UPDATE signals SET status = 'LEASED' WHERE sid = $1`,
            [row.sid],
          );
          await client.query("COMMIT");

          return {
            task_id: row.sid,
            type: "OPEN",
            symbol: row.symbol,
            action: row.side,
            volume: row.volume || 0.01,
            price: row.price,
            sl: row.sl,
            tp: row.tp,
            sid: row.sid,
          };
        }

        await client.query("COMMIT");
        return null;
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("[MT5 Backend] pullAndLockNextTask error:", e);
        throw e;
      } finally {
        client.release();
      }
    },

    async fanoutSignalTradeV2(payload = {}) {
      const signalIdRaw = String(payload.sid || "").trim();
      const signalId = signalIdRaw || null;
      const sourceId = String(payload.source_id || "").trim();
      const userId = String(payload.user_id || CFG.mt5DefaultUserId).trim();
      if (!sourceId || !userId) return { created: 0, account_ids: [] };
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const accounts = await client.query(
          `SELECT account_id, metadata FROM user_accounts WHERE user_id = $1 AND status != 'ARCHIVED'`,
          [userId],
        );
        let created = 0;
        const accountIds = [];
        const sids = [];
        for (const row of accounts.rows || []) {
          const aid = String(row.account_id || "").trim();
          if (!aid) continue; // skip accounts with null/empty account_id
          const accountMeta = mt5ParseAccountMetadata(row.metadata);
          const symbolMetric = mt5FindSymbolMetric(accountMeta, payload.symbol);
          const plannedPnlFallback = mt5ComputePlannedPnlFromMetrics(
            payload,
            symbolMetric,
          );
          const plannedTpPnl = mt5ResolveStoredPlannedPnlValue(
            payload.planned_tp_pnl,
            plannedPnlFallback.tpPnl,
          );
          const plannedSlPnl = mt5ResolveStoredPlannedPnlValue(
            payload.planned_sl_pnl,
            plannedPnlFallback.slPnl,
          );
          const tradeSid = await allocateUniqueSid(client, "trades", signalId);
          // Skip if trade with this SID already exists
          const existing = await client.query(
            "SELECT 1 FROM trades WHERE sid = $1",
            [tradeSid],
          );
          if (existing.rows.length) continue;
          const ins = await client.query(
            `
            INSERT INTO trades (
              sid, account_id, user_id, source_id,
              strategy, entry_model, signal_tf, chart_tf,
              symbol, action, order_type, entry, sl, tp, tp1, tp2, tp3, volume, note,
              dispatch_status, execution_status, metadata, raw_json, created_at, updated_at,
              profile, confidence_pct, estimated_bars, be_trigger,
              rr_planned, risk_money_planned, risk_pct_planned,
              planned_tp_pnl, planned_sl_pnl
            ) VALUES ($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::text,$11::text,$12::numeric,$13::numeric,$14::numeric,$15::numeric,$16::numeric,$17::numeric,$18::numeric,$19::text,$30::text,$31::text,$20::jsonb,$21::jsonb,$22::timestamptz,$22::timestamptz,$23::text,$24::numeric,$25::numeric,$26::numeric,$27::numeric,$28::numeric,$29::numeric,$32::numeric,$33::numeric)
          `,
            [
              tradeSid,
              aid,
              userId,
              sourceId,
              payload.strategy || null,
              payload.entry_model || null,
              payload.signal_tf || null,
              payload.chart_tf || null,
              payload.symbol,
              payload.action,
              payload.order_type || "limit",
              payload.entry,
              payload.sl,
              payload.tp,
              payload.tp1,
              payload.tp2,
              payload.tp3,
              payload.volume,
              payload.note,
              JSON.stringify(
                (() => {
                  const m = { ...(payload.metadata || {}) };
                  m.tp_targets = mt5NormalizeTpTargets(
                    payload.tp_targets || [
                      payload.tp1,
                      payload.tp2,
                      payload.tp3,
                      payload.tp,
                    ],
                    payload.action,
                  );
                  delete m.raw_json;
                  if (signalId && !m.signal_sid) m.signal_sid = signalId;
                  return m;
                })(),
              ),
              JSON.stringify(
                (() => {
                  const rj =
                    payload.metadata?.raw_json || payload.raw_json || {};
                  // Strip prompt from raw_json — it's massive (~20KB) and redundant with schema files
                  if (rj && typeof rj === "object" && rj.prompt) {
                    const { prompt: _, ...rest } = rj;
                    return rest;
                  }
                  return rj;
                })(),
              ),
              mt5NowIso(),
              payload.profile || null,
              payload.confidence_pct || null,
              payload.estimated_bars || null,
              payload.be_trigger || null,
              payload.rr_planned || null,
              payload.risk_money_planned || null,
              payload.risk_pct_planned || null,
              payload.dispatch_status ||
                (payload.execution_status === "DRAFT" ? "NEW" : "OPEN"),
              payload.execution_status || "PENDING",
              Number.isFinite(plannedTpPnl) ? plannedTpPnl : null,
              Number.isFinite(plannedSlPnl) ? plannedSlPnl : null,
            ],
          );
          if ((ins.rowCount || 0) > 0) {
            created++;
            accountIds.push(aid);
            sids.push(tradeSid);
          }
        }
        await client.query("COMMIT");
        // Log fanout events AFTER commit (uses pool, not transaction client)
        for (const sid of sids) {
          await this.log(
            sid,
            "trades",
            signalId
              ? { event: "SIGNAL_FANOUT", signal_id: signalId }
              : { event: "DIRECT_TRADE_CREATE" },
            userId,
          ).catch(() => {});
          // Move folder from trade_files to trade_active
          moveTradeFolder(sid, "files", "active", payload.symbol || "");
        }
        bumpPulse(userId);
        return { created, account_ids: accountIds, sids };
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async pullLeasedTradesV2(
      accountId,
      maxItems = 1,
      leaseSeconds = 30,
      taskTypeFilter = null,
      sourceId = null,
    ) {
      const aid = String(accountId || "").trim();
      const leaseSec = Math.max(5, Math.min(300, Number(leaseSeconds) || 30));
      if (!aid) return [];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const sel = await client.query(
          `
          SELECT * FROM trades
          WHERE (account_id = $1 OR account_id = '' OR account_id IS NULL)
            AND (
              execution_status IN ('PENDING','FILLED')
              OR (dispatch_status IN ('CANCEL','CLOSE') AND execution_status IN ('CANCELLED','CLOSED'))
            )
            AND (
              dispatch_status IN ('OPEN', 'MODIFY', 'CLOSE', 'CANCEL')
              OR (dispatch_status = 'LEASED' AND lease_expires_at < NOW())
            )
            AND (
              $3::text IS NULL OR $3::text = '' OR dispatch_status = $3::text
            )
          ORDER BY
            CASE WHEN dispatch_status = 'LEASED' THEN 1 ELSE 0 END ASC,
            created_at ASC
          LIMIT $2 FOR UPDATE SKIP LOCKED
        `,
          [
            aid,
            Math.max(1, Math.min(100, Number(maxItems) || 1)),
            taskTypeFilter && String(taskTypeFilter).trim()
              ? String(taskTypeFilter).trim()
              : "",
          ],
        );
        const out = [];
        for (const row of sel.rows || []) {
          const staleNew = syncGuards.isNewTradeTooOld(
            row,
            CFG.mt5V2BrokerPullMaxAgeHours,
          );
          if (staleNew) {
            await client.query(
              `
              UPDATE trades
              SET dispatch_status = 'REJECTED',
                  execution_status = 'REJECTED',
                  rejection_reason = COALESCE(rejection_reason, $2),
                  metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || $3::jsonb - 'last_broker_snapshot_hash',
                  updated_at = NOW()
              WHERE sid = $1
            `,
              [
                row.sid,
                "stale broker pull task",
                JSON.stringify({
                  stale_pull_rejected_at: mt5NowIso(),
                  stale_pull_max_age_hours: CFG.mt5V2BrokerPullMaxAgeHours,
                }),
              ],
            );
            await this.log(
              row.sid,
              "trades",
              {
                event: "BROKER_PULL_STALE_REJECT",
                symbol: row.symbol || null,
                execution_status: row.execution_status || null,
                dispatch_status: row.dispatch_status || null,
                max_age_hours: CFG.mt5V2BrokerPullMaxAgeHours,
                account: sourceId || accountId,
              },
              row.user_id || CFG.mt5DefaultUserId,
            ).catch(() => {});
            console.log(
              `[Pull] Auto-rejected stale broker task ${row.sid} ${row.symbol || ""}`,
            );
            // Move folder to closed + archive stats
            if (row.symbol) {
              archiveTradeStats(row.sid, row.symbol);
              moveTradeFolder(row.sid, "active", "closed", row.symbol);
            }
            continue;
          }

          // Auto-reject trades that have been re-leased too many times without ack.
          // Skip if broker already has the order (broker_trade_id from sync).
          const retryCount = syncGuards.nextLeaseRetryCount(row);
          if (
            syncGuards.shouldAutoRejectLeasedTrade(row, 3) &&
            !(
              row.broker_trade_id &&
              String(row.broker_trade_id || "").trim() !== ""
            )
          ) {
            const hasBroker =
              row.broker_trade_id &&
              String(row.broker_trade_id || "").trim() !== "";
            await client.query(
              `
              UPDATE trades
              SET dispatch_status = $4::text,
                  execution_status = CASE WHEN $4::text = 'CANCEL' THEN 'CANCELLED' ELSE 'REJECTED' END,
                  rejection_reason = COALESCE(rejection_reason, $2),
                  metadata = (COALESCE(metadata::jsonb, '{}'::jsonb) || $3::jsonb) - 'last_broker_snapshot_hash',
                  updated_at = NOW()
              WHERE sid = $1
            `,
              [
                row.sid,
                "broker ack lease retry limit exceeded",
                JSON.stringify({
                  stale_pull_rejected_at: mt5NowIso(),
                  stale_pull_max_age_hours: CFG.mt5V2BrokerPullMaxAgeHours,
                }),
                hasBroker ? "CANCEL" : "REJECTED",
              ],
            );
            await this.log(
              row.sid,
              "trades",
              {
                event: "BROKER_PULL_RETRY_REJECT",
                symbol: row.symbol || null,
                execution_status: row.execution_status || null,
                dispatch_status: row.dispatch_status || null,
                retry_count: retryCount,
                account: sourceId || accountId,
              },
              row.user_id || CFG.mt5DefaultUserId,
            ).catch(() => {});
            console.log(
              `[Pull] Auto-rejected ${row.sid} after ${retryCount} failed lease retries`,
            );
            // Move folder to closed + archive stats
            if (row.symbol) {
              archiveTradeStats(row.sid, row.symbol);
              moveTradeFolder(row.sid, "active", "closed", row.symbol);
            }
            continue;
          }
          const leaseToken = mt5GenerateTimeSid();
          const leaseExpiresAt = new Date(
            Date.now() + leaseSec * 1000,
          ).toISOString();
          const rowDispatch = String(row.dispatch_status || "")
            .trim()
            .toUpperCase();
          const currentLeasedDispatch =
            rowDispatch === "LEASED"
              ? row.metadata?.leased_dispatch_status
              : rowDispatch;
          const updatedMeta = {
            ...(row.metadata || {}),
            lease_retry_count: retryCount,
            leased_dispatch_status: syncGuards.brokerTaskTypeForTrade({
              dispatch_status: currentLeasedDispatch,
            }),
          };
          await client.query(
            `UPDATE trades SET dispatch_status = 'LEASED', lease_token = $1, lease_expires_at = $2, metadata = $3, updated_at = NOW() WHERE sid = $4`,
            [leaseToken, leaseExpiresAt, JSON.stringify(updatedMeta), row.sid],
          );
          out.push({
            ...row,
            lease_token: leaseToken,
            lease_expires_at: leaseExpiresAt,
          });
        }
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async ackTradeV2(accountId, payload = {}) {
      trackSourceActivity(payload?.source_id || "unknown", true);
      // Normalize broker statuses to DB-allowed values
      const rawStatus = String(payload.execution_status || "").toUpperCase();
      let execStatus = rawStatus;
      if (execStatus === "FAIL") execStatus = "REJECTED";
      if (execStatus === "EXPIRED") execStatus = "REJECTED";
      if (execStatus === "START" || execStatus === "PLACED")
        execStatus = "PENDING";
      payload.execution_status = execStatus;
      const now = mt5NowIso();
      const openedAt = syncGuards.nullableIsoTimestamp(
        payload.opened_at || payload.openedAt,
      );
      const closedAt = syncGuards.nullableIsoTimestamp(
        payload.closed_at || payload.closedAt,
      );
      const isClosed = ["CLOSED", "TP", "SL", "CANCELLED", "REJECTED"].includes(
        String(payload.execution_status || "").toUpperCase(),
      );
      const usedVolumeRaw = Number(
        payload.used_volume ??
          payload.usedVolume ??
          payload.volume ??
          payload.requested_volume ??
          payload.requestedVolume,
      );
      const usedVolume =
        Number.isFinite(usedVolumeRaw) && usedVolumeRaw > 0
          ? usedVolumeRaw
          : null;
      const riskMoneyPlannedAck = asNum(payload.risk_money_planned, NaN);
      const telemetryPatch = {
        requested_volume:
          payload.requested_volume ?? payload.requestedVolume ?? null,
        used_volume: usedVolume,
        requested_sl: payload.requested_sl ?? payload.requestedSl ?? null,
        requested_tp: payload.requested_tp ?? payload.requestedTp ?? null,
        used_sl: payload.used_sl ?? payload.usedSl ?? null,
        used_tp: payload.used_tp ?? payload.usedTp ?? null,
        margin_req: payload.margin_req ?? payload.marginReq ?? null,
        margin_budget: payload.margin_budget ?? payload.marginBudget ?? null,
        free_margin: payload.free_margin ?? payload.freeMargin ?? null,
        balance: payload.balance ?? null,
        equity: payload.equity ?? null,
        pip_value_per_lot:
          payload.pip_value_per_lot ?? payload.pipValuePerLot ?? null,
        sl_pips: payload.sl_pips ?? payload.slPips ?? null,
        tp_pips: payload.tp_pips ?? payload.tpPips ?? null,
        risk_money_actual:
          payload.risk_money_actual ?? payload.riskMoneyActual ?? null,
        reward_money_planned:
          payload.reward_money_planned ?? payload.rewardMoneyPlanned ?? null,
        entry_price_exec:
          payload.entry_price_exec ??
          payload.entry_exec ??
          payload.entryExec ??
          null,
        signal_ts: payload.signal_ts ?? payload.signalTs ?? null,
        exec_ts: payload.exec_ts ?? payload.execTs ?? null,
        ack_result: payload.result ?? payload.retcode ?? payload.code ?? null,
        ack_message: payload.message ?? payload.msg ?? null,
        ack_note: payload.note ?? null,
      };
      const telemetryMeta = Object.fromEntries(
        Object.entries(telemetryPatch).filter(([, v]) => {
          if (v === null || v === undefined) return false;
          return String(v).trim() !== "";
        }),
      );

      const tradeId = payload.sid || payload.trade_id;
      const leaseToken = String(payload.lease_token || "").trim();
      // Broker FAIL/ERROR means the order could not be executed on broker side (e.g.
      // symbol not found, no quotes). Treat as REJECTED with the error message.
      const isBrokerFail = ["ERROR", "FAIL"].includes(
        String(payload.execution_status || "").toUpperCase(),
      );
      const failReason = isBrokerFail
        ? String(
            payload.message || payload.msg || payload.note || "Broker failed",
          ).trim()
        : null;
      const res = await db
        .update(schema.trades)
        .set({
          dispatchStatus: sql`CASE WHEN ${payload.release_only === true} = TRUE THEN 'NEW' ELSE 'CONSUMED' END`,
          executionStatus: sql`CASE WHEN ${isBrokerFail} = TRUE THEN 'REJECTED' WHEN ${isClosed} = TRUE THEN ${payload.execution_status} ELSE ${payload.execution_status} END`,
          rejectionReason: sql`CASE WHEN ${isBrokerFail} = TRUE THEN ${failReason || "Broker failed"} ELSE ${schema.trades.rejectionReason} END`,
          brokerTradeId: sql`CASE WHEN ${payload.broker_trade_id}::text IN ('MANUAL', '') THEN ${schema.trades.brokerTradeId} ELSE ${payload.broker_trade_id} END`,
          entryExec:
            payload.entry_exec != null ? Number(payload.entry_exec) : undefined,
          pnlRealized: sql`CASE WHEN ${isClosed} = TRUE THEN ${payload.pnl_realized != null ? Number(payload.pnl_realized) : null} ELSE ${schema.trades.pnlRealized} END`,
          volume:
            usedVolume != null
              ? sql`COALESCE(${usedVolume}, ${schema.trades.volume})`
              : undefined,
          riskMoneyPlanned:
            Number.isFinite(riskMoneyPlannedAck)
              ? sql`COALESCE(${riskMoneyPlannedAck}, ${schema.trades.riskMoneyPlanned})`
              : undefined,
          orderType: payload.order_type
            ? sql`COALESCE(${payload.order_type}, ${schema.trades.orderType})`
            : undefined,
          metadata: sql`CASE
            WHEN ${JSON.stringify(telemetryMeta)}::jsonb = '{}'::jsonb THEN ${schema.trades.metadata}
            ELSE COALESCE(${schema.trades.metadata}::jsonb, '{}'::jsonb) || ${JSON.stringify(telemetryMeta)}::jsonb
          END`,
          openedAt: sql`COALESCE(${openedAt}::timestamptz, ${schema.trades.openedAt}, CASE WHEN ${payload.execution_status} IN ('FILLED','OPEN') THEN ${now}::timestamptz ELSE NULL END)`,
          closedAt: sql`COALESCE(${closedAt}::timestamptz, CASE WHEN ${isClosed} = TRUE THEN ${now}::timestamptz ELSE NULL END)`,
          updatedAt: new Date(now),
        })
        .where(
          and(
            eq(schema.trades.sid, tradeId),
            eq(schema.trades.accountId, accountId),
            eq(schema.trades.dispatchStatus, "LEASED"),
            eq(schema.trades.leaseToken, leaseToken),
          ),
        )
        .returning();
      const rowCount = res.length;
      if (rowCount > 0) {
        await this.log(
          payload.sid || payload.trade_id,
          "trades",
          {
            event: "TRADE_ACK",
            status: payload.execution_status,
            pnl: isClosed ? payload.pnl_realized : null,
            requested_volume:
              payload.requested_volume ?? payload.requestedVolume ?? null,
            used_volume: usedVolume,
            sl_pips: telemetryMeta.sl_pips ?? null,
            tp_pips: telemetryMeta.tp_pips ?? null,
            risk_money_actual: telemetryMeta.risk_money_actual ?? null,
            ack_message:
              telemetryMeta.ack_message || telemetryMeta.ack_note || null,
            ack_result: telemetryMeta.ack_result || null,
          },
          res[0].userId,
        );
        invalidateTradeListCaches().catch(() => {});
        // Migrate trade folder based on status
        const newStatus = String(payload.execution_status || "").toUpperCase();
        const tradeSid = tradeId;
        const tradeSymbol = res[0]?.symbol || payload.symbol || "";
        if (["PENDING", "FILLED"].includes(newStatus)) {
          moveTradeFolder(tradeSid, "files", "active", tradeSymbol);
        } else if (
          ["CLOSED", "CANCELLED", "REJECTED", "TP", "SL"].includes(newStatus)
        ) {
          // Copy bars + snapshots from market_data before moving to closed
          archiveTradeStats(tradeSid, tradeSymbol);
          moveTradeFolder(tradeSid, "active", "closed", tradeSymbol);
        }
        // Auto-capture master snapshot on FILLED/CLOSED
        if (["FILLED", "CLOSED"].includes(newStatus)) {
          captureStatusSnapshot(tradeSid, res[0]?.symbol, newStatus).catch(
            () => {},
          );
        }
      } else {
        // Fallback log for tracking orphan/failed acks
        const existingRows = await db
          .select()
          .from(schema.trades)
          .where(
            and(
              eq(schema.trades.sid, tradeId),
              eq(schema.trades.accountId, accountId),
            ),
          )
          .limit(1);
        const row = existingRows?.[0] || null;
        const alreadyApplied =
          row &&
          String(row.dispatchStatus || "").toUpperCase() === "CONSUMED" &&
          String(row.executionStatus || "").toUpperCase() ===
            String(payload.execution_status || "").toUpperCase() &&
          (!payload.broker_trade_id ||
            String(row.brokerTradeId || "") ===
              String(payload.broker_trade_id || ""));

        if (alreadyApplied) {
          await this.log(
            tradeId,
            "trades",
            {
              event: "TRADE_ACK_DUPLICATE",
              status: payload.execution_status,
              broker_trade_id: payload.broker_trade_id || null,
            },
            row.userId || CFG.mt5DefaultUserId,
          ).catch(() => {});
          return {
            ok: true,
            duplicate: true,
            dispatch_status: row.dispatchStatus,
            execution_status: row.executionStatus,
          };
        }

        await this.log(
          tradeId,
          "trades",
          {
            event: "TRADE_ACK_FAILED",
            reason: row ? "stale or mismatched lease token" : "trade not found",
            payload_status: payload.execution_status || payload.status,
            account_id: accountId,
            dispatch_status: row?.dispatchStatus || null,
            execution_status: row?.executionStatus || null,
            broker_trade_id: row?.brokerTradeId || null,
            lease_token_present: Boolean(leaseToken),
          },
          row?.userId || CFG.mt5DefaultUserId,
        ).catch(() => {});
        return {
          ok: false,
          error: row ? "stale or mismatched lease token" : "trade not found",
        };
      }
      return {
        ok: true,
        dispatch_status: res[0]?.dispatchStatus,
        execution_status: res[0]?.executionStatus,
      };
    },
    async ackSignal(signalId, status, ticket, error, extra = {}) {
      const s = String(status || "").toUpperCase();
      const isClosed = [
        "CLOSED",
        "TP",
        "SL",
        "CANCEL",
        "CANCELLED",
        "EXPIRED",
        "FAIL",
      ].includes(s);
      let tradeExec = TRADE_STATUS.LIVE;
      if (["NEW", "LOCKED", "PLACED"].includes(s)) tradeExec = "PENDING";
      else if (["TP", "SL", "CLOSED"].includes(s)) tradeExec = "CLOSED";
      else if (["CANCEL", "CANCELLED", "EXPIRED"].includes(s))
        tradeExec = "CANCELLED";
      else if (s === "FAIL") tradeExec = "REJECTED";

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const res = await client.query(
          `
          UPDATE signals
          SET status = $1
          WHERE sid = $2
          RETURNING user_id
        `,
          [s, signalId],
        );

        await client.query(
          `
          UPDATE trades
          SET execution_status = $1,
              broker_trade_id = COALESCE(NULLIF($3, ''), broker_trade_id),
              pnl_realized = CASE WHEN $4 = TRUE THEN COALESCE($5, pnl_realized) ELSE pnl_realized END,
              order_type = COALESCE($7, order_type),
              metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || $6::jsonb,
              closed_at = CASE WHEN $4 = TRUE THEN NOW() ELSE closed_at END,
              updated_at = NOW()
          WHERE sid = $2
        `,
          [
            tradeExec,
            signalId,
            ticket || "",
            isClosed,
            extra.pnl_money_realized ?? null,
            JSON.stringify({
              sl_pips: extra.sl_pips ?? null,
              tp_pips: extra.tp_pips ?? null,
              pip_value_per_lot: extra.pip_value_per_lot ?? null,
              risk_money_actual: extra.risk_money_actual ?? null,
              reward_money_planned: extra.reward_money_planned ?? null,
              entry_price_exec: extra.entry_price_exec ?? null,
              sl_exec: extra.sl_exec ?? null,
              tp_exec: extra.tp_exec ?? null,
              last_ack_telemetry_at: new Date().toISOString(),
            }),
            extra.order_type || null,
          ],
        );

        await client.query("COMMIT");
        if (res.rowCount > 0) {
          await this.log(
            signalId,
            "signals",
            {
              event: "SIGNAL_EA_ACK",
              status: s,
              trade_execution_status: tradeExec,
              ticket,
              error,
            },
            res.rows[0].user_id,
          );
          invalidateTradeListCaches().catch(() => {});
        }
        return { ok: res.rowCount > 0 };
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async brokerSyncV2(accountId, payload = {}) {
      trackSourceActivity(payload?.source_id || "unknown", true);
      const aid = String(accountId || "").trim();
      if (!aid) return { ok: false, error: "account_id is required" };
      const accRows = await db
        .select({
          userId: schema.userAccounts.userId,
          metadata: schema.userAccounts.metadata,
          status: schema.userAccounts.status,
          resolvedUserId: schema.users.userId,
        })
        .from(schema.userAccounts)
        .leftJoin(
          schema.users,
          eq(schema.users.userId, schema.userAccounts.userId),
        )
        .where(eq(schema.userAccounts.accountId, aid))
        .limit(1);
      const accountUserId = String(accRows[0]?.userId || "").trim();
      let uid = String(
        accRows[0]?.resolvedUserId || accountUserId || CFG.mt5DefaultUserId,
      ).trim();
      let existingMeta = {};
      try {
        existingMeta = JSON.parse(accRows[0]?.metadata || "{}");
      } catch {}

      // Legacy datasets can contain account rows whose user_id no longer exists.
      if (!uid) uid = String(CFG.mt5DefaultUserId || "default").trim();
      await db
        .insert(schema.users)
        .values({
          userId: uid,
          role: uid === CFG.mt5DefaultUserId ? UI_ROLE_SYSTEM : UI_ROLE_USER,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.users.userId,
          set: { updatedAt: new Date() },
        });
      if (accountUserId !== uid) {
        await db
          .update(schema.userAccounts)
          .set({ userId: uid, updatedAt: new Date() })
          .where(eq(schema.userAccounts.accountId, aid));
      }

      // Update metadata and explicit columns
      const newMeta = {
        ...existingMeta,
        balance: Number(payload.balance || existingMeta.balance || 0),
        equity: Number(payload.equity || existingMeta.equity || 0),
        margin: Number(payload.margin || existingMeta.margin || 0),
        free_margin: Number(
          payload.free_margin || existingMeta.free_margin || 0,
        ),
        leverage: Number(payload.leverage || existingMeta.leverage || 0),
        broker_name: String(
          payload.broker_name || existingMeta.broker_name || "",
        ),
        provider_code: String(
          payload.provider_code ||
            existingMeta.provider_code ||
            resolveProviderCode(payload.broker_name) ||
            "",
        ),
        build_version: String(
          payload.build_version || existingMeta.build_version || "",
        ),
        symbol_metrics: (() => {
          const incoming = Array.isArray(payload.symbol_metrics)
            ? payload.symbol_metrics
            : [];
          const existing = Array.isArray(existingMeta.symbol_metrics)
            ? existingMeta.symbol_metrics
            : [];
          const map = new Map();
          existing.forEach((m) => {
            if (m.symbol) map.set(m.symbol.toUpperCase(), m);
          });
          incoming.forEach((m) => {
            if (m.symbol) {
              map.set(m.symbol.toUpperCase(), {
                ...map.get(m.symbol.toUpperCase()),
                ...m,
                updated_at: new Date().toISOString(),
              });
            }
          });
          return Array.from(map.values());
        })(),
        health_updated_at: new Date().toISOString(),
      };

      // Only bump updated_at when status actually changes
      const oldStatus = String(accRows[0]?.status || "").toUpperCase();
      const newStatus = payload.status
        ? String(payload.status).toUpperCase()
        : oldStatus || "ACTIVE";

      await db
        .insert(schema.userAccounts)
        .values({
          accountId: aid,
          userId: uid,
          metadata: JSON.stringify(newMeta),
          balance: newMeta.balance,
          status: newStatus,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.userAccounts.accountId,
          set: {
            userId: sql`EXCLUDED.user_id`,
            metadata: sql`EXCLUDED.metadata`,
            balance: sql`EXCLUDED.balance`,
            status: sql`EXCLUDED.status`,
            updatedAt: sql`CASE
              WHEN ${schema.userAccounts.status} IS DISTINCT FROM EXCLUDED.status THEN NOW()
              ELSE ${schema.userAccounts.updatedAt}
            END`,
          },
        });
      await StateRepo.del("USER_ACCOUNTS", uid);
      await this.log(
        aid,
        "accounts",
        { event: "ACCOUNT_SYNC", data: payload },
        uid,
      );

      const merged = new Map();
      const seenTickets = new Set();
      const symbolMetricsMap = new Map(
        (Array.isArray(newMeta.symbol_metrics) ? newMeta.symbol_metrics : [])
          .filter((m) => m && m.symbol)
          .map((m) => [String(m.symbol).trim().toUpperCase(), m]),
      );
      const hasPositionsSnapshot = Array.isArray(payload?.positions);
      const hasOrdersSnapshot = Array.isArray(payload?.orders);
      const snapshotComplete = hasPositionsSnapshot && hasOrdersSnapshot;
      const statusRank = (s) => {
        if (s === "CLOSED") return 3;
        if (s === "FILLED") return 2;
        return 1;
      };
      const pushItems = (arr = []) => {
        for (const item of Array.isArray(arr) ? arr : []) {
          // cTrader sends positions as JSON strings — parse them
          const raw =
            item && typeof item === "string"
              ? (() => {
                  try {
                    return JSON.parse(item);
                  } catch {
                    return null;
                  }
                })()
              : item;
          if (!raw || typeof raw !== "object") continue;
          const signalId = String(raw.sid || raw.signal_id || "").trim();
          const ticketCandidates = mt5TicketCandidates(raw);
          const ticket = ticketCandidates[0] || null;
          if (!signalId && !ticketCandidates.length) continue;
          for (const candidate of ticketCandidates) seenTickets.add(candidate);
          const pnlRaw = Number(raw.pnl);
          const pnl = Number.isFinite(pnlRaw) ? pnlRaw : null;
          const volumeRaw = Number(raw.volume || raw.lots);
          const volume = Number.isFinite(volumeRaw) ? volumeRaw : null;
          const entryRaw = Number(
            raw.entry ??
              raw.entry_price ??
              raw.target_price ??
              raw.price ??
              raw.entry_exec,
          );
          const entry =
            Number.isFinite(entryRaw) && entryRaw > 0 ? entryRaw : null;
          const slRaw = Number(raw.sl ?? raw.stop_loss ?? raw.sl_price);
          const sl = Number.isFinite(slRaw) && slRaw > 0 ? slRaw : null;
          const tpRaw = Number(
            raw.tp ?? raw.take_profit ?? raw.tp_price ?? raw.target_tp,
          );
          const tp = Number.isFinite(tpRaw) && tpRaw > 0 ? tpRaw : null;
          const symbol = String(raw.symbol || "")
            .trim()
            .toUpperCase();
          const action = String(raw.action || raw.side || "")
            .trim()
            .toUpperCase();
          const orderTypeRaw = String(raw.order_type || raw.type || "")
            .trim()
            .toUpperCase();
          const reasonRaw = String(raw.reason || raw.close_reason || "")
            .trim()
            .toUpperCase();
          const closeReason = mt5CloseReasonFromSync(raw);
          const openedAt = mt5SyncTime(raw.opened_at || raw.openedAt || null);
          const closedAt = mt5SyncTime(raw.closed_at || raw.closedAt || null);
          let statusRaw = String(raw.status || "")
            .trim()
            .toUpperCase();
          if (!statusRaw) {
            if (reasonRaw === "TP" || reasonRaw === "DEAL_REASON_TP")
              statusRaw = "TP";
            else if (
              reasonRaw === "SL" ||
              reasonRaw === "SO" ||
              reasonRaw === "DEAL_REASON_SL" ||
              reasonRaw === "DEAL_REASON_SO"
            )
              statusRaw = "SL";
            else if (
              reasonRaw === "CLIENT" ||
              reasonRaw === "MOBILE" ||
              reasonRaw === "EXPERT" ||
              reasonRaw === "MANUAL"
            )
              statusRaw = "CANCEL";
            else if (raw.closed_at || raw.close_reason) statusRaw = "CLOSED";
            else if (pnl !== null && raw.execution_status === "CLOSED")
              statusRaw = "CLOSED";
            else statusRaw = "FILLED";
          }
          let executionStatus = "PENDING";
          const s = String(statusRaw || "").toUpperCase();
          const remainingVolume = Number(
            raw.remaining_volume ?? raw.volume_remaining ?? NaN,
          );
          const closedVolumePartial = Number(
            raw.closed_volume_partial ?? raw.partial_closed_volume ?? NaN,
          );
          const hasPartial =
            Number.isFinite(remainingVolume) ||
            Number.isFinite(closedVolumePartial) ||
            Number.isFinite(Number(raw.realized_pnl_partial ?? NaN)) ||
            Number.isFinite(Number(raw.realized_pnl_total ?? NaN));

          if (["START", "ACTIVE", "OPEN", "FILLED", "EXECUTED"].includes(s)) {
            executionStatus = TRADE_STATUS.LIVE;
          } else if (
            ["PLACED", "NEW", "PENDING", "SUBMITTED", "PARTIAL"].includes(s)
          ) {
            executionStatus = "PENDING";
          } else if (
            [
              "TP",
              "SL",
              "CANCEL",
              "FAIL",
              "CLOSED",
              "EXPIRED",
              "REJECTED",
              "DELETED",
            ].includes(s)
          ) {
            executionStatus = "CLOSED";
          }
          if (
            executionStatus === "CLOSED" &&
            Number.isFinite(remainingVolume) &&
            remainingVolume > 0
          ) {
            executionStatus = TRADE_STATUS.LIVE;
          }
          const commission = Number(raw.commission ?? 0);
          const swap = Number(raw.swap ?? 0);
          const pipsVal = Number(raw.pips ?? 0);
          const pnlVal = Number(
            raw.realized_pnl_total ?? raw.pnl ?? raw.net_pnl ?? 0,
          );
          const brokerVolumeVal = Number(raw.volume || 0);
          const lotsVal = Number(
            raw.lots ??
              (Number.isFinite(brokerVolumeVal) && brokerVolumeVal > 0
                ? brokerVolumeVal / 100000
                : 0),
          );
          const volumeVal = lotsVal;
          const brokerComment = String(raw.comment || "").trim();
          const brokerLabel = String(raw.label || "").trim();
          const note = brokerComment || brokerLabel;

          // Extract SID from comment or label (cTrader stores SID in label field)
          const sidText = brokerLabel || brokerComment;
          const brokerSidCandidate = String(sidText || signalId)
            .replace(/[^a-zA-Z0-9]/g, "")
            .toUpperCase();
          const effectiveSignalId =
            brokerSidCandidate.length === 9 ? brokerSidCandidate : "";

          const key = ticket ? `tk:${ticket}` : `sig:${effectiveSignalId}`;
          const prev = merged.get(key);
          if (!prev) {
            merged.set(key, {
              sid: effectiveSignalId || null,
              signal_id: effectiveSignalId || null,
              ticket,
              ticket_candidates: ticketCandidates,
              pnl: pnlVal,
              net_pnl: pnlVal,
              pnl_realized: raw.status === "CLOSED" ? pnlVal : null,
              commission,
              swap,
              pips: pipsVal,
              lots: lotsVal,
              volume: volumeVal,
              broker_volume: brokerVolumeVal,
              symbol,
              action,
              order_type: orderTypeRaw || null,
              entry,
              sl,
              tp,
              tp1:
                tp !== null && !Number.isFinite(Number(raw.tp1))
                  ? tp
                  : Number.isFinite(Number(raw.tp1))
                    ? Number(raw.tp1)
                    : null,
              tp2: Number.isFinite(Number(raw.tp2)) ? Number(raw.tp2) : null,
              tp3: Number.isFinite(Number(raw.tp3)) ? Number(raw.tp3) : null,
              note,
              status_raw: statusRaw || "UNKNOWN",
              execution_status: executionStatus,
              close_reason: closeReason,
              opened_at: openedAt,
              closed_at: closedAt,
              has_partial: hasPartial,
              margin: Number(raw.margin) || 0,
              tp_pnl: Number.isFinite(Number(raw.tp_pnl ?? raw.pnl_tp))
                ? Number(raw.tp_pnl ?? raw.pnl_tp)
                : null,
              sl_pnl: Number.isFinite(Number(raw.sl_pnl ?? raw.pnl_sl))
                ? Number(raw.sl_pnl ?? raw.pnl_sl)
                : null,
            });
          } else {
            // Keep existing fields and merge new ones
            Object.assign(prev, raw);
            if (!prev.sid && effectiveSignalId) prev.sid = effectiveSignalId;
            prev.ticket_candidates = Array.from(
              new Set([...(prev.ticket_candidates || []), ...ticketCandidates]),
            );
            if (
              statusRank(executionStatus) > statusRank(prev.execution_status)
            ) {
              prev.execution_status = executionStatus;
              prev.status_raw = statusRaw || prev.status_raw;
            }
            if (pnlVal !== 0) prev.pnl = pnlVal;
            if (pnlVal !== 0) prev.net_pnl = pnlVal;
            if (commission !== 0) prev.commission = commission;
            if (swap !== 0) prev.swap = swap;
            if (pipsVal !== 0) prev.pips = pipsVal;
            if (lotsVal !== 0) prev.lots = lotsVal;
            if (volumeVal !== 0) prev.volume = volumeVal;
            if (brokerVolumeVal !== 0) prev.broker_volume = brokerVolumeVal;
            if (symbol) prev.symbol = symbol;
            if (action) prev.action = action;
            if (orderTypeRaw) prev.order_type = orderTypeRaw;
            if (entry !== null) prev.entry = entry;
            if (sl !== null) prev.sl = sl;
            if (tp !== null) prev.tp = tp;
            if (
              tp !== null &&
              !Number.isFinite(Number(raw.tp1)) &&
              !Number.isFinite(Number(prev.tp1))
            )
              prev.tp1 = tp;
            if (note) prev.note = note;
            if (closeReason) prev.close_reason = closeReason;
            if (openedAt) prev.opened_at = openedAt;
            if (closedAt) prev.closed_at = closedAt;
            prev.has_partial = Boolean(prev.has_partial) || hasPartial;
            // Force numeric: cTrader may send boolean false for unused numeric fields
            prev.pips = Number(prev.pips) || 0;
            prev.lots = Number(prev.lots) || 0;
            prev.commission = Number(prev.commission) || 0;
            prev.swap = Number(prev.swap) || 0;
            prev.volume = Number(prev.volume) || 0;
            prev.margin = Number(prev.margin) || 0;
            prev.tp_pnl = Number.isFinite(Number(prev.tp_pnl ?? prev.pnl_tp))
              ? Number(prev.tp_pnl ?? prev.pnl_tp)
              : null;
            prev.sl_pnl = Number.isFinite(Number(prev.sl_pnl ?? prev.pnl_sl))
              ? Number(prev.sl_pnl ?? prev.pnl_sl)
              : null;
          }
        }
      };

      pushItems(payload.positions);
      pushItems(payload.orders);
      pushItems(payload.closed);
      pushItems(payload.closed_positions);
      pushItems(payload.deals);
      const items = Array.from(merged.values());

      let matched = 0;
      let synced = 0;
      const results = [];
      // Batch-query old state for change detection and broker snapshot idempotency.
      const oldStatusMap = new Map();
      const oldTicketMap = new Map();
      {
        const sids = items.map((it) => it.sid).filter(Boolean);
        const tickets = Array.from(
          new Set(
            items
              .flatMap((it) =>
                Array.isArray(it.ticket_candidates) &&
                it.ticket_candidates.length
                  ? it.ticket_candidates
                  : it.ticket
                    ? [it.ticket]
                    : [],
              )
              .map((t) => String(t || "").trim())
              .filter(Boolean),
          ),
        );
        if (sids.length || tickets.length) {
          const oldRows = await db
            .select({
              sid: schema.trades.sid,
              brokerTradeId: schema.trades.brokerTradeId,
              executionStatus: schema.trades.executionStatus,
              dispatchStatus: schema.trades.dispatchStatus,
              rejectionReason: schema.trades.rejectionReason,
              sl: schema.trades.sl,
              tp: schema.trades.tp,
              pnl: schema.trades.brokerPnl,
              metadata: schema.trades.metadata,
            })
            .from(schema.trades)
            .where(
              or(
                sids.length ? inArray(schema.trades.sid, sids) : undefined,
                tickets.length
                  ? inArray(schema.trades.brokerTradeId, tickets)
                  : undefined,
              ),
            );
          for (const r of oldRows) {
            let metaParsed = {};
            try {
              metaParsed = JSON.parse(r.metadata || "{}");
            } catch {}
            const rowData = {
              sid: r.sid,
              broker_trade_id: r.brokerTradeId,
              execution_status: r.executionStatus,
              dispatch_status: r.dispatchStatus,
              rejection_reason: r.rejectionReason,
              sl: r.sl,
              tp: r.tp,
              pnl: r.pnl,
              metadata: r.metadata,
              has_partial: String(metaParsed.has_partial || "false"),
              last_broker_snapshot_hash: String(
                metaParsed.last_broker_snapshot_hash || "",
              ),
            };
            oldStatusMap.set(r.sid, rowData);
            const brokerTradeId = String(r.brokerTradeId || "").trim();
            if (brokerTradeId) oldTicketMap.set(brokerTradeId, rowData);
          }
        }
      }
      for (const it of items) {
        try {
          // Normalize all numeric-like fields that cTrader might send as boolean.
          // Explicit list + catch-all: iterate all keys and convert any boolean to 0.
          const numFields = new Set([
            "pnl",
            "net_pnl",
            "pips",
            "lots",
            "commission",
            "swap",
            "volume",
            "margin",
            "tp_pnl",
            "sl_pnl",
            "entry",
            "sl",
            "tp",
            "tp1",
            "tp2",
            "tp3",
            "has_partial",
          ]);
          for (const f of numFields) {
            if (typeof it[f] === "boolean") it[f] = Number(it[f]);
          }
          // Catch-all: any other boolean field we didn't list explicitly
          for (const [k, v] of Object.entries(it)) {
            if (typeof v === "boolean" && !numFields.has(k)) {
              console.error(
                `[sync-bool-field-NEW] ${k} = ${v} (type=${typeof v})`,
              );
              it[k] = Number(v);
            }
          }
          let res = { rowCount: 0 };
          const ticketCandidates =
            Array.isArray(it.ticket_candidates) && it.ticket_candidates.length
              ? it.ticket_candidates
              : it.ticket
                ? [it.ticket]
                : [];
          const snapshotHash = syncGuards.brokerSnapshotHash(it);
          const oldForItem =
            (it.sid && oldStatusMap.get(it.sid)) ||
            ticketCandidates
              .map((tk) => oldTicketMap.get(String(tk)))
              .find(Boolean) ||
            null;
          const oldSnapshotHash = String(
            oldForItem?.last_broker_snapshot_hash ||
              oldForItem?.metadata?.last_broker_snapshot_hash ||
              "",
          ).trim();
          const clearRejectedDispatch =
            syncGuards.shouldClearRejectedDispatchFromBrokerSnapshot(
              oldForItem || {},
              it,
            );
          if (
            oldForItem &&
            oldSnapshotHash &&
            oldSnapshotHash === snapshotHash &&
            !clearRejectedDispatch
          ) {
            results.push({
              ticket: it.ticket,
              sid: oldForItem.sid || it.sid || null,
              status: "NoChange",
              symbol: it.symbol,
              action: it.action,
            });
            continue;
          }

          const syncMeta = JSON.stringify({
            order_type: mt5NormalizeOrderTypeValue(it.order_type, "limit"),
            broker_name: existingMeta.broker_name || "",
            provider_code: existingMeta.provider_code || "",
            last_change_origin: "broker",
            last_inbound_event_id: `broker:${aid}:${snapshotHash}`,
            last_broker_snapshot_hash: snapshotHash,
            broker_data: {
              ...it, // Spread all processed fields (pips, lots, commission, etc.)
              position_id: ticketCandidates[0] || null,
              ticket_candidates: ticketCandidates,
              status: it.status_raw || null,
              snapshot_hash: snapshotHash,
              last_sync_at: new Date().toISOString(),
            },
            last_sync_source: "broker_sync_v2",
          });
          const syncSymbol = String(it.symbol || "")
            .trim()
            .toUpperCase();
          const syncAction = String(it.action || "")
            .trim()
            .toUpperCase();
          const brokerTpPnlOverride = mt5ExtractBrokerPlannedPnlOverride(
            it.tp_pnl ?? it.pnl_tp,
          );
          const brokerSlPnlOverride = mt5ExtractBrokerPlannedPnlOverride(
            it.sl_pnl ?? it.pnl_sl,
          );
          it.tp_pnl = brokerTpPnlOverride;
          it.sl_pnl = brokerSlPnlOverride;
          console.log(
            `[sync-item] ticket=${it.ticket} sid=${it.sid} status=${it.execution_status} pnl=${it.pnl} pips=${it.pips} lots=${it.lots} margin=${it.margin} tp_pnl=${brokerTpPnlOverride} sl_pnl=${brokerSlPnlOverride}`,
          );
          if (ticketCandidates.length) {
            const openedAt = it.opened_at || null;
            const closedAt = it.closed_at || null;
            if (syncSymbol) {
              await pool.query(
                `
              UPDATE trades
              SET broker_trade_id = NULL,
                  execution_status = CASE WHEN execution_status = 'FILLED' THEN 'PENDING' ELSE execution_status END,
                  metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || $4::jsonb,
                  updated_at = CASE WHEN execution_status IS DISTINCT FROM $1::text THEN NOW() ELSE updated_at END
              WHERE account_id = $1
                AND broker_trade_id = ANY($2::text[])
                AND symbol <> $3
                AND execution_status IN ('PENDING','FILLED')
            `,
                [
                  aid,
                  ticketCandidates,
                  syncSymbol,
                  JSON.stringify({
                    broker_ticket_mismatch_cleared: ticketCandidates,
                    broker_ticket_mismatch_symbol: syncSymbol,
                    broker_ticket_mismatch_at: new Date().toISOString(),
                  }),
                ],
              );
            }
            // Link CANCELLED VPS trades to cTrader positions by SID (for tracking)
            if (it.sid) {
              await pool
                .query(
                  `UPDATE trades SET broker_trade_id = COALESCE(NULLIF($1::text, ''), broker_trade_id), updated_at = NOW() WHERE sid = $2 AND execution_status IN ('CANCELLED','REJECTED') AND (broker_trade_id IS NULL OR broker_trade_id = '')`,
                  [ticketCandidates[0] || it.ticket || "", it.sid],
                )
                .catch(() => {});
            }
            res = await pool.query(
              `
            UPDATE trades
            SET execution_status = CASE
                  WHEN $1::text = 'CLOSED' AND execution_status IN ('FILLED','PENDING') THEN $1::text
                  WHEN $1::text = 'FILLED' AND execution_status = 'PENDING' THEN $1::text
                  ELSE execution_status
                END,
                pnl_realized = CASE
                  WHEN $26::boolean = TRUE OR $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($2::numeric, pnl_realized)
                  ELSE pnl_realized
                END,
                broker_pnl = $2::numeric,
                volume = COALESCE($7::numeric, volume),
                broker_pips = $13::numeric,
                broker_lots = $14::numeric,
                broker_commission = $15::numeric,
                broker_swap = $16::numeric,
                broker_volume = $17::numeric,
                broker_margin = $19::numeric,
                broker_tp_pnl = $20::numeric,
                broker_sl_pnl = $21::numeric,
                entry_exec = COALESCE($22::numeric, entry_exec),
                order_type = COALESCE($12::text, order_type),
                close_reason = CASE WHEN $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($8::text, close_reason) WHEN $1::text IN ('FILLED','PENDING') THEN NULL ELSE close_reason END,
                broker_trade_id = COALESCE(NULLIF($9::text, ''), broker_trade_id),
                sl = COALESCE(NULLIF(NULLIF($23::numeric, 0), -1), sl),
                tp = COALESCE(NULLIF(NULLIF($24::numeric, 0), -1), tp),
                tp1 = COALESCE($27::numeric, tp1),
                tp2 = COALESCE($28::numeric, tp2),
                tp3 = COALESCE($29::numeric, tp3),
                dispatch_status = CASE WHEN $30::boolean OR dispatch_status = 'LEASED' THEN 'CONSUMED' ELSE dispatch_status END,
                rejection_reason = CASE WHEN $30::boolean THEN NULL ELSE rejection_reason END,
                note = COALESCE(NULLIF($25::text, ''), note),
                metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || $10::jsonb,
                opened_at = COALESCE($5::timestamptz, opened_at, CASE WHEN $1::text IN ('FILLED','OPEN') THEN NOW() ELSE NULL END),
                closed_at = CASE WHEN $1::text IN ('FILLED','PENDING') THEN NULL ELSE COALESCE($6::timestamptz, CASE WHEN $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN NOW() ELSE closed_at END) END,
                updated_at = CASE WHEN execution_status IS DISTINCT FROM $1::text OR $30::boolean THEN NOW() ELSE updated_at END
            WHERE account_id = $3
              AND ($11::text = '' OR symbol = $11::text)
              AND (
                sid = ANY($4::text[])
                OR (sid = $18::text AND $18::text <> '')
                OR broker_trade_id = ANY($4::text[])
                OR metadata::jsonb->>'broker_position_id' = ANY($4::text[])
                OR metadata::jsonb->>'position_ticket' = ANY($4::text[])
              )
            AND execution_status NOT IN ('CANCELLED', 'PENDING_CANCEL')
          RETURNING sid, pnl_realized
          `,
              [
                it.execution_status,
                it.pnl,
                aid,
                ticketCandidates,
                openedAt,
                closedAt,
                it.volume,
                it.close_reason,
                ticketCandidates[0] || "",
                syncMeta,
                syncSymbol,
                it.order_type || null,
                Number(it.pips) || 0,
                Number(it.lots) || 0,
                Number(it.commission) || 0,
                Number(it.swap) || 0,
                Number(it.broker_volume) || 0,
                it.sid || "",
                Number(it.margin) || 0,
                brokerTpPnlOverride,
                brokerSlPnlOverride,
                it.entry,
                it.sl,
                it.tp,
                it.note || "",
                Boolean(it.has_partial),
                mt5ParsePriceOrNull(it.tp1),
                mt5ParsePriceOrNull(it.tp2),
                mt5ParsePriceOrNull(it.tp3),
                clearRejectedDispatch,
              ],
            );
          }
          if (it.sid) {
            if (res.rowCount === 0) {
              res = await pool.query(
                `
            UPDATE trades
            SET execution_status = CASE
                  WHEN $1::text = 'CLOSED' AND execution_status IN ('FILLED','PENDING') THEN $1::text
                  WHEN $1::text = 'FILLED' AND execution_status = 'PENDING' THEN $1::text
                  ELSE execution_status
                END,
                broker_trade_id = COALESCE(NULLIF($2::text, ''), broker_trade_id),
                pnl_realized = CASE
                  WHEN $25::boolean = TRUE OR $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($3::numeric, pnl_realized)
                  ELSE pnl_realized
                END,
                broker_pnl = $3::numeric,
                volume = COALESCE($6::numeric, volume),
                broker_pips = $12::numeric,
                broker_lots = $13::numeric,
                broker_commission = $14::numeric,
                broker_swap = $15::numeric,
                broker_volume = $16::numeric,
                broker_margin = $18::numeric,
                broker_tp_pnl = $19::numeric,
                broker_sl_pnl = $20::numeric,
                entry_exec = COALESCE($21::numeric, entry_exec),
                sl = COALESCE($22::numeric, sl),
                tp = COALESCE($23::numeric, tp),
                tp1 = COALESCE($26::numeric, tp1),
                tp2 = COALESCE($27::numeric, tp2),
                tp3 = COALESCE($28::numeric, tp3),
                dispatch_status = CASE WHEN $29::boolean THEN 'CONSUMED' ELSE dispatch_status END,
                rejection_reason = CASE WHEN $29::boolean THEN NULL ELSE rejection_reason END,
                note = COALESCE(NULLIF($24::text, ''), note),
                order_type = COALESCE($11::text, order_type),
                close_reason = CASE WHEN $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($7::text, close_reason) ELSE close_reason END,
                metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || $8::jsonb,
                opened_at = COALESCE($9::timestamptz, opened_at, CASE WHEN $1::text IN ('FILLED','OPEN') THEN NOW() ELSE NULL END),
                closed_at = CASE WHEN $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($10::timestamptz, closed_at, NOW()) ELSE closed_at END,
                updated_at = CASE WHEN execution_status IS DISTINCT FROM $1::text OR $29::boolean THEN NOW() ELSE updated_at END
            WHERE sid = (
              SELECT sid
              FROM trades
              WHERE account_id = $4::text
                AND (
                  (sid = $5::text AND $5::text <> '')
                  OR (broker_trade_id = $2::text AND $2::text <> '')
                  OR (broker_trade_id = ANY($17::text[]))
                )
              ORDER BY
                CASE WHEN broker_trade_id IS NULL OR broker_trade_id = '' THEN 0 ELSE 1 END,
                created_at ASC
              LIMIT 1
            )
            RETURNING sid
            `,
                [
                  it.execution_status,
                  it.ticket,
                  it.pnl,
                  aid,
                  it.sid,
                  it.volume,
                  it.close_reason,
                  syncMeta,
                  it.opened_at || null,
                  it.closed_at || null,
                  it.order_type || null,
                  Number(it.pips) || 0,
                  Number(it.lots) || 0,
                  Number(it.commission) || 0,
                  Number(it.swap) || 0,
                  Number(it.broker_volume) || 0,
                  ticketCandidates,
                  Number(it.margin) || 0,
                  brokerTpPnlOverride,
                  brokerSlPnlOverride,
                  it.entry,
                  it.sl,
                  it.tp,
                  it.note || "",
                  Boolean(it.has_partial),
                  mt5ParsePriceOrNull(it.tp1),
                  mt5ParsePriceOrNull(it.tp2),
                  mt5ParsePriceOrNull(it.tp3),
                  clearRejectedDispatch,
                ],
              );
            }
          }
          if (res.rowCount === 0 && ticketCandidates.length) {
            // Last-resort fallback: bind ticket to oldest unresolved trade for this account.
            res = await pool.query(
              `
            UPDATE trades
            SET execution_status = CASE
                  WHEN $1::text = 'CLOSED' AND execution_status IN ('FILLED','PENDING') THEN $1::text
                  WHEN $1::text = 'FILLED' AND execution_status = 'PENDING' THEN $1::text
                  ELSE execution_status
                END,
                broker_trade_id = COALESCE(NULLIF($2::text, ''), broker_trade_id),
                pnl_realized = CASE
                  WHEN $24::boolean = TRUE OR $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($3::numeric, pnl_realized)
                  ELSE pnl_realized
                END,
                broker_pnl = $3::numeric,
                volume = COALESCE($5::numeric, volume),
                broker_pips = $12::numeric,
                broker_lots = $13::numeric,
                broker_commission = $14::numeric,
                broker_swap = $15::numeric,
                broker_volume = $16::numeric,
                broker_margin = $17::numeric,
                broker_tp_pnl = $18::numeric,
                broker_sl_pnl = $19::numeric,
                entry_exec = COALESCE($20::numeric, entry_exec),
                sl = COALESCE($21::numeric, sl),
                tp = COALESCE($22::numeric, tp),
                tp1 = COALESCE($25::numeric, tp1),
                tp2 = COALESCE($26::numeric, tp2),
                tp3 = COALESCE($27::numeric, tp3),
                note = COALESCE(NULLIF($23::text, ''), note),
                order_type = COALESCE($11::text, order_type),
                close_reason = CASE WHEN $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($6::text, close_reason) ELSE close_reason END,
                metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || $7::jsonb,
                closed_at = CASE WHEN $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($8::timestamptz, closed_at, NOW()) ELSE closed_at END,
                updated_at = CASE WHEN execution_status IS DISTINCT FROM $1::text THEN NOW() ELSE updated_at END
            WHERE sid = (
              SELECT sid
              FROM trades
              WHERE account_id = $4::text
                AND execution_status IN ('PENDING','FILLED')
                AND (broker_trade_id IS NULL OR broker_trade_id = '')
                AND $9::text <> ''
                AND symbol = $9::text
                AND ($10::text = '' OR action = $10::text)
                AND (
                  $1::text NOT IN ('CLOSED', 'CANCELLED', 'TP', 'SL')
                  OR created_at <= COALESCE($8::timestamptz, NOW())
                )
              ORDER BY created_at ASC
              LIMIT 1
            )
            RETURNING sid
          `,
              [
                it.execution_status,
                it.ticket,
                it.pnl,
                aid,
                it.volume,
                it.close_reason,
                syncMeta,
                it.closed_at || null,
                syncSymbol,
                syncAction,
                it.order_type || null,
                Number(it.pips) || 0,
                Number(it.lots) || 0,
                Number(it.commission) || 0,
                Number(it.swap) || 0,
                Number(it.broker_volume) || 0,
                Number(it.margin) || 0,
                brokerTpPnlOverride,
                brokerSlPnlOverride,
                it.entry,
                it.sl,
                it.tp,
                it.note || "",
                Boolean(it.has_partial),
                mt5ParsePriceOrNull(it.tp1),
                mt5ParsePriceOrNull(it.tp2),
                mt5ParsePriceOrNull(it.tp3),
              ],
            );
          }

          if (res.rowCount > 0) {
            matched += res.rowCount;
            synced++;
            const tid = String(res.rows?.[0]?.sid || "").trim();
            results.push({
              ticket: it.ticket,
              sid: tid,
              status: "Ok",
              symbol: it.symbol,
              action: it.action,
            });
            if (tid) {
              const oldRow = oldStatusMap.get(tid) || {};
              // Only log TRADE_SYNC_UPDATE if something actually changed
              const oldExecStatus = oldRow.execution_status || null;
              const oldSl = Number.isFinite(Number(oldRow.sl))
                ? Number(oldRow.sl)
                : null;
              const oldTp = Number.isFinite(Number(oldRow.tp))
                ? Number(oldRow.tp)
                : null;
              const oldPnl = Number.isFinite(Number(oldRow.pnl))
                ? Number(oldRow.pnl)
                : null;
              const statusChanged =
                !oldExecStatus || oldExecStatus !== it.execution_status;
              const slChanged =
                oldSl !== null &&
                it.sl != null &&
                Math.abs(oldSl - Number(it.sl)) > 0.000001;
              const tpChanged =
                oldTp !== null &&
                it.tp != null &&
                Math.abs(oldTp - Number(it.tp)) > 0.000001;
              const pnlChanged =
                oldPnl !== null &&
                Number.isFinite(Number(it.pnl)) &&
                Math.abs(oldPnl - Number(it.pnl)) > 0.01;
              const hasPartialChanged =
                Boolean(it.has_partial) !==
                Boolean(
                  oldRow.has_partial === "true" || oldRow.has_partial === true,
                );
              if (
                statusChanged ||
                slChanged ||
                tpChanged ||
                hasPartialChanged
              ) {
                await this.log(
                  tid,
                  "trades",
                  {
                    event: "TRADE_SYNC_UPDATE",
                    status_raw: it.status_raw,
                    execution_status: it.execution_status,
                    ticket: it.ticket || null,
                    signal_id: it.sid || null,
                    pnl: it.pnl,
                    pips: it.pips,
                    lots: it.lots,
                    commission: it.commission,
                    swap: it.swap,
                    volume: it.volume,
                    margin: it.margin,
                    tp_pnl: it.tp_pnl,
                    sl_pnl: it.sl_pnl,
                    sl_before: Number.isFinite(Number(oldRow.sl))
                      ? Number(oldRow.sl)
                      : null,
                    sl_after: it.sl ?? null,
                    tp_before: Number.isFinite(Number(oldRow.tp))
                      ? Number(oldRow.tp)
                      : null,
                    tp_after: it.tp ?? null,
                    has_partial: Boolean(it.has_partial),
                    close_reason: it.close_reason || null,
                    entry: it.entry ?? null,
                  },
                  uid,
                );
              }
            }
          } else if (
            it.execution_status === "FILLED" ||
            it.execution_status === "PENDING"
          ) {
            // Before creating M_ duplicate, try to link to existing trade by SID
            // (from broker comment/label, or from note field fallback)
            const noteSid = String(it.note || "")
              .replace(/[^a-zA-Z0-9]/g, "")
              .toUpperCase();
            const resolvedSid = it.sid || (noteSid.length === 9 ? noteSid : "");
            if (resolvedSid && ticketCandidates[0]) {
              // Try to link to any existing trade with this SID (not just CANCELLED/REJECTED)
              const linked = await pool.query(
                `UPDATE trades SET broker_trade_id = COALESCE(NULLIF($1::text, ''), broker_trade_id), execution_status = CASE WHEN $4::text IN ('FILLED','PENDING') AND execution_status IN ('CANCELLED','REJECTED') THEN $4::text ELSE execution_status END, metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || $2::jsonb, updated_at = NOW() WHERE sid = $3 AND (broker_trade_id IS NULL OR broker_trade_id = '' OR broker_trade_id != $1) RETURNING sid`,
                [
                  ticketCandidates[0],
                  syncMeta,
                  resolvedSid,
                  it.execution_status,
                ],
              );
              if (linked.rowCount > 0) {
                results.push({
                  ticket: it.ticket,
                  sid: resolvedSid,
                  status: "Linked",
                  symbol: it.symbol,
                  action: it.action,
                });
                continue;
              }
            }
            if (!syncSymbol || !syncAction) {
              results.push({
                ticket: it.ticket,
                sid: null,
                status: "Skip",
                symbol: it.symbol,
                action: it.action,
                reason: "missing_symbol_or_action",
              });
              continue;
            }
            const discoverySid = String(
              resolvedSid ||
                (ticketCandidates[0]
                  ? `M_${ticketCandidates[0]}`
                  : mt5GenerateTimeSid()),
            ).trim();
            // Dedup by broker_trade_id — never create duplicate for the same ticket
            if (ticketCandidates[0]) {
              const dupCheck = await pool.query(
                `SELECT sid, execution_status FROM trades WHERE broker_trade_id = $1 AND account_id = $2 LIMIT 1`,
                [ticketCandidates[0], aid],
              );
              if (dupCheck.rowCount > 0) {
                const existing = dupCheck.rows[0];
                results.push({
                  ticket: it.ticket,
                  sid: existing.sid,
                  status: "Skip",
                  symbol: it.symbol,
                  action: it.action,
                  reason: `duplicate_broker_ticket_${existing.execution_status}`,
                });
                continue;
              }
            }

            const brokerSource = (payload.broker_name || "BROKER")
              .toUpperCase()
              .replace(/\s+/g, "_");
            const discoveryPlannedFallback = mt5ComputePlannedPnlFromMetrics(
              it,
              symbolMetricsMap.get(syncSymbol) || null,
            );
            const discoveryPlannedTpPnl = mt5ResolveStoredPlannedPnlValue(
              null,
              discoveryPlannedFallback.tpPnl,
            );
            const discoveryPlannedSlPnl = mt5ResolveStoredPlannedPnlValue(
              null,
              discoveryPlannedFallback.slPnl,
            );

            try {
              await db.insert(schema.trades).values({
                sid: discoverySid,
                accountId: aid,
                userId: uid,
                symbol: syncSymbol,
                action: syncAction,
                orderType: it.order_type || null,
                volume: it.lots || 0,
                entry: it.entry || 0,
                sl: it.sl || null,
                tp: it.tp || null,
                tp1: mt5ParsePriceOrNull(it.tp1 ?? it.tp),
                tp2: mt5ParsePriceOrNull(it.tp2),
                tp3: mt5ParsePriceOrNull(it.tp3),
                note: it.note || "",
                executionStatus: it.execution_status,
                dispatchStatus: "CONSUMED",
                sourceId: brokerSource,
                metadata: syncMeta,
                brokerTradeId: ticketCandidates[0] || "",
                brokerPips: Number(it.pips) || 0,
                brokerLots: Number(it.lots) || 0,
                brokerCommission: Number(it.commission) || 0,
                brokerSwap: Number(it.swap) || 0,
                brokerVolume: Number(it.broker_volume) || 0,
                brokerPnl: Number(it.pnl) || 0,
                brokerMargin: Number(it.margin) || 0,
                plannedTpPnl: Number.isFinite(discoveryPlannedTpPnl)
                  ? discoveryPlannedTpPnl
                  : null,
                plannedSlPnl: Number.isFinite(discoveryPlannedSlPnl)
                  ? discoveryPlannedSlPnl
                  : null,
                brokerTpPnl: brokerTpPnlOverride,
                brokerSlPnl: brokerSlPnlOverride,
                createdAt: new Date(),
                updatedAt: new Date(),
              });
            } catch (e) {
              if (!e.message?.includes("duplicate key") && e.code !== "23505")
                throw e;
            }
            matched++;
            results.push({
              ticket: it.ticket,
              sid: discoverySid,
              suggested_sid: discoverySid,
              status: "Added",
              symbol: it.symbol,
              action: it.action,
            });
          } else {
            results.push({
              ticket: it.ticket,
              sid: null,
              status: "Skip",
              symbol: it.symbol,
              action: it.action,
            });
          }
        } catch (err) {
          console.error(
            `[brokerSyncV2] Error processing item ticket=${it.ticket}`,
            err,
          );
          // Log boolean fields to find the culprit
          for (const [k, v] of Object.entries(it)) {
            if (typeof v === "boolean")
              console.error(`[sync-bool-field] ${k} = ${v} (type=${typeof v})`);
          }
          results.push({
            ticket: it.ticket,
            sid: it.sid || it.signal_id || null,
            status: "Error",
            error: err.message,
            symbol: it.symbol,
            action: it.action,
          });
          await this.log(
            it.sid || it.signal_id || it.ticket || "unknown",
            "trades",
            {
              event: "TRADE_SYNC_UPDATE",
              status_raw: it.status_raw,
              execution_status: it.execution_status,
              ticket: it.ticket || null,
              signal_id: it.sid || it.signal_id || null,
              error: err.message,
              status: "ERROR",
            },
            uid,
          );
        }
      }
      const finalizeSnapshotClosures = async (rows = []) => {
        const items = Array.isArray(rows) ? rows : [];
        for (const row of items) {
          const tradeId = String(row?.sid || "").trim();
          if (!tradeId) continue;
          let resolvedPnl = Number(row?.pnlRealized ?? row?.pnl_realized);
          await this.log(
            tradeId,
            "trades",
            {
              event: "TRADE_SYNC_CLOSE",
              ticket: (row?.brokerTradeId ?? row?.broker_trade_id) || null,
              execution_status:
                (row?.executionStatus ?? row?.execution_status) || null,
              close_reason: (row?.closeReason ?? row?.close_reason) || null,
              pnl_inferred: Number.isFinite(resolvedPnl) ? resolvedPnl : null,
            },
            uid,
          );

          // Archive bars + snapshots + move folder to closed
          const tradeSymbol = row?.symbol || "";
          if (tradeSymbol) {
            archiveTradeStats(tradeId, tradeSymbol);
            moveTradeFolder(tradeId, "active", "closed", tradeSymbol);
            captureStatusSnapshot(tradeId, tradeSymbol, "CLOSED").catch(
              () => {},
            );
          }
        }
      };
      let closed_by_snapshot = 0;
      if (snapshotComplete) {
        const closeBase = {
          executionStatus: sql`CASE WHEN ${schema.trades.executionStatus} = 'PENDING' THEN 'CANCELLED' ELSE 'CLOSED' END`,
          closeReason: sql`COALESCE(${schema.trades.closeReason}, CASE WHEN ${schema.trades.executionStatus} = 'PENDING' THEN 'CANCEL' ELSE 'MANUAL' END)`,
          closedAt: sql`COALESCE(${schema.trades.closedAt}, NOW())`,
        };
        if (seenTickets.size > 0) {
          const closeRes = await db
            .update(schema.trades)
            .set(closeBase)
            .where(
              and(
                eq(schema.trades.accountId, aid),
                inArray(schema.trades.executionStatus, ["FILLED", "PENDING"]),
                sql`${schema.trades.brokerTradeId} IS NOT NULL`,
                sql`${schema.trades.brokerTradeId} <> ''`,
                sql`${schema.trades.brokerTradeId} NOT IN (${sql.join(
                  Array.from(seenTickets).map((t) => sql`${t}`),
                  sql`, `,
                )})`,
              ),
            )
            .returning();
          closed_by_snapshot = closeRes.length;
          await finalizeSnapshotClosures(closeRes);
        } else {
          // No active cTrader positions — close ALL pending/filled trades (with or without broker_trade_id)
          const closeRes = await db
            .update(schema.trades)
            .set(closeBase)
            .where(
              and(
                eq(schema.trades.accountId, aid),
                inArray(schema.trades.executionStatus, ["FILLED", "PENDING"]),
              ),
            )
            .returning();
          closed_by_snapshot = closeRes.length;
          await finalizeSnapshotClosures(closeRes);
        }
      }

      // Move trade folders: newly opened/filled → active
      if (Array.isArray(items) && items.length > 0) {
        for (const it of items) {
          const sid = String(it.sid || "").trim();
          const st = String(it.execution_status || "").toUpperCase();
          const sym = String(it.symbol || "").trim();
          if (sid && ["PENDING", "FILLED"].includes(st)) {
            moveTradeFolder(sid, "files", "active", sym);
          }
        }
      }

      // Auto-capture chart snapshots for trades closed by this sync
      if (closed_by_snapshot > 0) {
        const closedRows = [];
        // Collect rows from the inner scope — re-query to get symbol & user_id
        try {
          const snapshotRows = await db
            .select({
              sid: schema.trades.sid,
              symbol: schema.trades.symbol,
              userId: schema.trades.userId,
            })
            .from(schema.trades)
            .where(
              and(
                eq(schema.trades.accountId, aid),
                inArray(schema.trades.executionStatus, ["CLOSED", "CANCELLED"]),
                gte(schema.trades.closedAt, sql`NOW() - INTERVAL '5 minutes'`),
                sql`${schema.trades.brokerTradeId} IS NOT NULL`,
                sql`${schema.trades.brokerTradeId} <> ''`,
                sql`${schema.trades.symbol} IS NOT NULL`,
              ),
            )
            .orderBy(desc(schema.trades.closedAt))
            .limit(Math.min(closed_by_snapshot + 5, 100));
          if (snapshotRows?.length) {
            closedRows.push(...snapshotRows);
          }
        } catch {
          /* non-blocking */
        }

        if (closedRows.length) {
          // Dedupe by sid
          const seen = new Set();
          const unique = closedRows.filter((r) => {
            const sid = String(r?.sid || "").trim();
            if (!sid || seen.has(sid)) return false;
            seen.add(sid);
            return true;
          });
          for (const row of unique) {
            try {
              const snapshots = await captureTradingViewSnapshotsBatch({
                symbol: row.symbol,
                timeframes: ["15m", "1h", "4h", "1D"],
                theme: "dark",
                format: "png",
                userId: row.user_id || CFG.mt5DefaultUserId,
              });
              const files = snapshots.map((s) => s.file_name).filter(Boolean);
              await persistTradeSnapshotFiles(row.sid, files, row.symbol || "");
            } catch {
              /* non-blocking */
            }
            // Copy bars + snapshots from market_data before moving to closed
            try {
              archiveTradeStats(row.sid, row.symbol);
            } catch {}
            // Move folder from active to closed
            try {
              moveTradeFolder(row.sid, "active", "closed", row.symbol || "");
            } catch {}
          }
        }
      }

      // Collect trade diffs for realtime UI (status + SL/TP/volume changes)
      const tradeUpdates = [];
      for (const it of items) {
        if (!it.sid) continue;
        const matchedResult = results.find((r) => r.sid === it.sid);
        if (!matchedResult || matchedResult.status === "Skip") continue;
        const oldRow = oldStatusMap.get(it.sid) || {};
        const oldStatus = oldRow.execution_status || null;
        const statusChanged = !oldStatus || oldStatus !== it.execution_status;
        const oldSl = Number.isFinite(Number(oldRow.sl))
          ? Number(oldRow.sl)
          : null;
        const newSl = it.sl ?? null;
        const slChanged =
          oldSl !== null &&
          newSl !== null &&
          Math.abs(oldSl - newSl) > 0.000001;
        const oldTp = Number.isFinite(Number(oldRow.tp))
          ? Number(oldRow.tp)
          : null;
        const newTp = it.tp ?? null;
        const tpChanged =
          oldTp !== null &&
          newTp !== null &&
          Math.abs(oldTp - newTp) > 0.000001;
        const oldHasPartial =
          oldRow.has_partial === "true" || oldRow.has_partial === true;
        const partialChanged =
          Boolean(it.has_partial) !== Boolean(oldHasPartial);
        if (statusChanged || slChanged || tpChanged || partialChanged) {
          tradeUpdates.push({
            sid: it.sid,
            symbol: it.symbol,
            pnl_realized: it.pnl,
            broker_pnl: it.pnl,
            broker_pips: it.pips,
            execution_status: it.execution_status,
            sl: newSl,
            sl_before: oldSl,
            tp: newTp,
            tp_before: oldTp,
            has_partial: Boolean(it.has_partial),
            last_price: it.last_price,
            status_changed: statusChanged,
            sl_changed: slChanged,
            tp_changed: tpChanged,
            partial_changed: partialChanged,
          });
        }
      }

      // Emit SSE via NotificationManager (on any trade field change)
      if (tradeUpdates.length > 0) {
        notificationManager.handle("BROKER_SYNC", "sync", {
          user_id: uid,
          page_id: "trades",
          event: "broker_sync",
          data: tradeUpdates,
          message: (() => {
            const changedSymbols = [
              ...new Set(
                (tradeUpdates || []).map((u) => u.symbol).filter(Boolean),
              ),
            ].slice(0, 3);
            const symbolSummary = changedSymbols.length
              ? changedSymbols.join(", ")
              : "none";
            const extra =
              (tradeUpdates || []).length > 3
                ? ` +${(tradeUpdates || []).length - 3} more`
                : "";
            return `BROKER SYNC: ${symbolSummary}${extra} (${matched} updated)`;
          })(),
          type: "info",
          need_refresh: false,
          comp_refresh: matched > 0,
        });
      }

      // Reconcile folders to correct category after sync
      reconcileTradeFolders(pool).catch(() => {});

      return {
        ok: true,
        synced,
        matched,
        received: items.length,
        closed_by_snapshot,
        results,
      };
    },
    async brokerHeartbeatV2(accountId, payload = {}) {
      trackSourceActivity(payload?.source_id || "unknown", true);
      const aid = String(accountId || "").trim();
      const now = mt5NowIso();
      const balance = asNum(payload.balance, null);
      const equity = asNum(payload.equity, null);
      const margin = asNum(payload.margin, null);
      const freeMargin = asNum(payload.free_margin, null);

      const accRows = await db
        .select({
          userId: schema.userAccounts.userId,
          metadata: schema.userAccounts.metadata,
        })
        .from(schema.userAccounts)
        .where(eq(schema.userAccounts.accountId, aid))
        .limit(1);
      const uid = accRows[0]?.userId || CFG.mt5DefaultUserId;
      let oldMeta = {};
      try {
        oldMeta = JSON.parse(accRows[0]?.metadata || "{}");
      } catch {}

      await db
        .update(schema.userAccounts)
        .set({
          balance:
            balance != null
              ? sql`COALESCE(${balance}, ${schema.userAccounts.balance})`
              : undefined,
          metadata: JSON.stringify({
            ...oldMeta,
            equity,
            margin,
            free_margin: freeMargin,
            health_updated_at: now,
          }),
        })
        .where(eq(schema.userAccounts.accountId, aid));

      await this.log(
        aid,
        "accounts",
        { event: "ACCOUNT_HEARTBEAT", payload },
        uid,
      );
      return { ok: true };
    },
    async listSignals(limit, filters = {}, userId = null) {
      const conditions = [];
      conditions.push(sql`${schema.signals.sid} NOT LIKE 'SYSTEM_%'`);
      if (typeof filters === "string") {
        if (filters) {
          conditions.push(eq(schema.signals.status, filters));
        }
      } else {
        if (filters.status) {
          conditions.push(eq(schema.signals.status, filters.status));
        }
        if (filters.symbol) {
          conditions.push(eq(schema.signals.symbol, filters.symbol));
        }
        if (filters.q) {
          const q = `%${String(filters.q)}%`;
          conditions.push(
            sql`(${schema.signals.sid} ILIKE ${q} OR ${schema.signals.symbol} ILIKE ${q} OR ${schema.signals.note} ILIKE ${q})`,
          );
        }
      }
      if (userId) {
        conditions.push(eq(schema.signals.userId, userId));
      }
      const rows = await db
        .select()
        .from(schema.signals)
        .where(and(...conditions))
        .orderBy(desc(schema.signals.createdAt))
        .limit(Number(limit) || 200);
      return rows.map((r) => mt5MapDbRow(r)).filter(Boolean);
    },
    async listTradesV2(filters = {}, page = 1, pageSize = 50) {
      return dbQueries.listTradesV2(db, filters, page, pageSize);
    },
    async updateTradeManualV2(tradeId, userId = null, payload = {}) {
      try {
        const tid = String(tradeId || "").trim();
        if (!tid) return { ok: false, error: "sid (trade_id) is required" };
        const stRaw = String(payload.execution_status || payload.status || "")
          .trim()
          .toUpperCase();
        const accountOnly = !stRaw && String(payload.account_id || "").trim();
        if (accountOnly) {
          await pool.query(`UPDATE trades SET account_id = $1 WHERE sid = $2`, [
            String(payload.account_id || "").trim(),
            tid,
          ]);
          return { ok: true, sid: tid, account_id: payload.account_id };
        }
        if (!stRaw) {
          return {
            ok: false,
            error: "execution_status or account_id is required",
          };
        }
        const allowed = new Set([
          "PENDING",
          "FILLED",
          "CLOSED",
          "CANCELLED",
          "REJECTED",
        ]);
        if (!allowed.has(stRaw)) {
          return {
            ok: false,
            error:
              "execution_status must be one of: PENDING, FILLED, CLOSED, CANCELLED, REJECTED",
          };
        }
        const currentRows = await pool
          .query(`SELECT * FROM trades WHERE sid = $1 LIMIT 1`, [tid])
          .then((r) => r.rows);
        if (currentRows.length === 0)
          return { ok: false, error: "trade not found" };
        const currentRow = currentRows[0];
        const newAccountId =
          String(payload.account_id || "").trim() || undefined;
        const syncResult = syncGuards.brokerLinkedManualStatus(
          {
            sid: currentRow.sid,
            execution_status: currentRow.execution_status,
            broker_trade_id: currentRow.broker_trade_id,
          },
          stRaw,
        );
        const appliedExecutionStatus = syncResult.execution_status;
        const newDispatchStatus = syncResult.dispatch_status;
        const queuedBrokerAction = newDispatchStatus !== null;
        const pnlRaw = payload.pnl_realized ?? payload.pnl;
        const pnlNum = Number(pnlRaw);
        const pnl =
          appliedExecutionStatus === "PENDING"
            ? 0
            : Number.isFinite(pnlNum)
              ? pnlNum
              : null;
        const closeReasonRaw = String(
          payload.close_reason || payload.reason || "",
        ).trim();
        const closeReason = closeReasonRaw || null;
        const manualMeta = JSON.stringify({
          manual_requested_status: stRaw,
          manual_applied_execution_status: appliedExecutionStatus,
          manual_new_dispatch_status: newDispatchStatus || null,
          manual_edit_source: "vps",
          manual_edit_at: mt5NowIso(),
        });
        const udRes = await db
          .update(schema.trades)
          .set({
            executionStatus: appliedExecutionStatus,
            ...(newAccountId != null ? { accountId: newAccountId } : {}),
            ...(pnl != null
              ? {
                  pnlRealized: sql`CASE WHEN ${pnl}::double precision IS NULL THEN ${schema.trades.pnlRealized} ELSE ${pnl}::double precision END`,
                }
              : {}),
            ...(closeReason != null
              ? {
                  closeReason: sql`COALESCE(${closeReason}::text, ${schema.trades.closeReason})`,
                }
              : {}),
            ...(newDispatchStatus != null
              ? {
                  dispatchStatus: newDispatchStatus,
                  leaseToken: null,
                  leaseExpiresAt: null,
                }
              : {}),
            metadata: sql`COALESCE(${schema.trades.metadata}::jsonb, '{}'::jsonb) || ${manualMeta}::jsonb`,
            ...(newDispatchStatus != null
              ? {}
              : {
                  closedAt: sql`CASE
              WHEN ${appliedExecutionStatus}::text IN ('CLOSED', 'CANCELLED', 'REJECTED') THEN COALESCE(${schema.trades.closedAt}, NOW())
              ELSE ${schema.trades.closedAt}
            END`,
                }),
          })
          .where(eq(schema.trades.sid, currentRow.sid))
          .returning();
        const row = udRes[0];
        const tradeSymbol = row.symbol || currentRow.symbol || "";

        // Archive bars + snapshots on CLOSED/CANCELLED/REJECTED
        const newStatus = String(row.executionStatus || "").toUpperCase();
        if (["FILLED", "CLOSED"].includes(newStatus)) {
          captureStatusSnapshot(row.sid, tradeSymbol, newStatus).catch((e) =>
            console.error("[status-snapshot] manual update failed:", e.message),
          );
        }
        if (["CLOSED", "CANCELLED", "REJECTED"].includes(newStatus)) {
          archiveTradeStats(row.sid, tradeSymbol);
          moveTradeFolder(row.sid, "active", "closed", tradeSymbol);
        }

        await this.log(
          row.sid,
          "trades",
          {
            event: "TRADE_MANUAL_EDIT",
            requested_status: stRaw,
            execution_status: row.executionStatus,
            queued_broker_action: queuedBrokerAction,
            pnl_realized: row.pnlRealized,
            close_reason: row.closeReason || null,
          },
          row.userId || CFG.mt5DefaultUserId,
        );
        return {
          ok: true,
          queued_broker_action: queuedBrokerAction,
          item: row,
        };
      } catch (e) {
        console.error(
          "[updateTradeManualV2] error:",
          e?.message || e,
          e?.stack,
        );
        return { ok: false, error: e?.message || String(e) };
      }
    },
    async bulkActionTradesV2(action, filters = {}) {
      const act = String(action || "")
        .trim()
        .toLowerCase();
      if (!act) return { ok: false, error: "action is required" };
      if (!["close_all", "cancel_all", "delete_all"].includes(act)) {
        return { ok: false, error: "unsupported action" };
      }
      const isDelete = act === "delete_all";
      const closeReason = act === "cancel_all" ? "CANCEL" : "MANUAL";
      const nextDispatch = act === "cancel_all" ? "CANCEL" : "CLOSE";
      const conditions = [];
      const tradeIds = Array.isArray(filters.sids)
        ? filters.sids.map((v) => String(v || "").trim()).filter(Boolean)
        : [];
      if (tradeIds.length) {
        const idConds = [];
        if (tradeIds.length) {
          idConds.push(inArray(schema.trades.sid, tradeIds));
        }
        conditions.push(or(...idConds));
      }
      if (filters.user_id)
        conditions.push(eq(schema.trades.userId, filters.user_id));
      if (filters.account_id)
        conditions.push(eq(schema.trades.accountId, filters.account_id));
      if (filters.source_id)
        conditions.push(eq(schema.trades.sourceId, filters.source_id));
      if (filters.execution_status)
        conditions.push(
          eq(schema.trades.executionStatus, filters.execution_status),
        );
      if (filters.created_from)
        conditions.push(
          gte(schema.trades.createdAt, new Date(filters.created_from)),
        );
      if (filters.created_to)
        conditions.push(
          lte(schema.trades.createdAt, new Date(filters.created_to)),
        );
      if (filters.q) {
        const q = `%${String(filters.q)}%`;
        conditions.push(
          sql`(${schema.trades.sid} ILIKE ${q}
            OR ${schema.trades.brokerTradeId} ILIKE ${q}
            OR ${schema.trades.symbol} ILIKE ${q}
            OR ${schema.trades.accountId} ILIKE ${q}
            OR ${schema.trades.sourceId} ILIKE ${q}
            OR ${schema.trades.action} ILIKE ${q}
            OR ${schema.trades.entryModel} ILIKE ${q}
            OR ${schema.trades.note} ILIKE ${q})`,
        );
      }
      if (act === "close_all")
        conditions.push(
          inArray(schema.trades.executionStatus, ["FILLED", "PENDING"]),
        );
      if (act === "cancel_all")
        conditions.push(eq(schema.trades.executionStatus, "PENDING"));
      const where = conditions.length ? and(...conditions) : undefined;
      if (act === "delete_all") {
        const delRes = await db.delete(schema.trades).where(where).returning({
          sid: schema.trades.sid,
          signalId: schema.trades.signalId,
        });
        const rows = delRes || [];
        return {
          ok: true,
          updated: rows.length,
          action: act,
          sids: rows.map((r) => String(r?.sid || "")).filter(Boolean),
          signal_ids: rows.map((r) => String(r?.sid || "")).filter(Boolean),
        };
      }
      const upRes = await db
        .update(schema.trades)
        .set({
          dispatchStatus: nextDispatch,
          closeReason: sql`COALESCE(${schema.trades.closeReason}, ${closeReason})`,
          closedAt: sql`COALESCE(${schema.trades.closedAt}, NOW())`,
          updatedAt: sql`NOW()`,
        })
        .where(where)
        .returning({
          sid: schema.trades.sid,
          signalId: schema.trades.signalId,
        });
      const rows = upRes || [];
      return {
        ok: true,
        updated: rows.length,
        action: act,
        sids: rows.map((r) => String(r?.sid || "")).filter(Boolean),
        signal_ids: rows.map((r) => String(r?.sid || "")).filter(Boolean),
      };
    },
    async rotateSourceSecretV2(sourceId) {
      const sid = String(sourceId || "").trim();
      if (!sid) return null;
      const secretPlain = `src_${crypto.randomBytes(18).toString("hex")}`;
      const secretHash = hashApiKey(secretPlain);
      const secretLast4 = secretPlain.slice(-4);
      const res = await pool.query(
        `
            updated_at = NOW()
        WHERE source_id = $3
        RETURNING source_id
      `,
        [secretHash, secretLast4, sid],
      );
      if (!res.rows[0]) return null;
      return {
        source_id: sid,
        source_secret_plaintext: secretPlain,
        source_secret_last4: secretLast4,
      };
    },
    async revokeSourceSecretV2(sourceId) {
      const sid = String(sourceId || "").trim();
      if (!sid) return { ok: false, error: "source_id is required" };
      const res = await pool.query(
        `
            updated_at = NOW()
        WHERE source_id = $1
      `,
        [sid],
      );
      if ((res.rowCount || 0) === 0)
        return { ok: false, error: "source not found" };
      return { ok: true };
    },
    async createAccountV2(payload = {}) {
      const accountId = String(payload.account_id || "").trim();
      if (!accountId) return { ok: false, error: "account_id is required" };
      const now = new Date();
      const plainApiKey = `acc_${crypto.randomBytes(18).toString("hex")}`;
      const apiKeyHash = hashApiKey(plainApiKey);
      const apiKeyLast4 = plainApiKey.slice(-4);
      const rows = await db
        .insert(schema.userAccounts)
        .values({
          accountId,
          userId: String(payload.user_id || CFG.mt5DefaultUserId),
          name: String(payload.name || accountId),
          balance:
            payload.balance === null ||
            payload.balance === undefined ||
            Number.isNaN(Number(payload.balance))
              ? null
              : Number(payload.balance),
          status: String(payload.status || "ACTIVE"),
          metadata:
            payload.metadata && typeof payload.metadata === "object"
              ? JSON.stringify(payload.metadata)
              : "{}",
          apiKeyHash,
          apiKeyLast4,
          apiKeyRotatedAt: now,
          sourceIdsCache:
            payload.source_ids_cache &&
            typeof payload.source_ids_cache === "object"
              ? JSON.stringify(payload.source_ids_cache)
              : "[]",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.userAccounts.accountId,
          set: {
            userId: sql`EXCLUDED.user_id`,
            name: sql`EXCLUDED.name`,
            balance: sql`EXCLUDED.balance`,
            status: sql`EXCLUDED.status`,
            metadata: sql`EXCLUDED.metadata`,
            updatedAt: sql`EXCLUDED.updated_at`,
          },
        })
        .returning();
      return {
        ok: true,
        item: rows[0] || null,
        api_key_plaintext: plainApiKey,
      };
    },
    async listAccountsV2(userId = null) {
      const conditions = [];
      if (userId) {
        conditions.push(eq(schema.userAccounts.userId, String(userId || "")));
      }
      const where = conditions.length ? and(...conditions) : undefined;
      const rows = await db
        .select({
          accountId: schema.userAccounts.accountId,
          userId: schema.userAccounts.userId,
          name: schema.userAccounts.name,
          balance: schema.userAccounts.balance,
          status: schema.userAccounts.status,
          metadata: schema.userAccounts.metadata,
          createdAt: schema.userAccounts.createdAt,
          updatedAt: schema.userAccounts.updatedAt,
        })
        .from(schema.userAccounts)
        .where(where)
        .orderBy(
          asc(schema.userAccounts.createdAt),
          asc(schema.userAccounts.accountId),
        );
      return rows || [];
    },

    async updateAccountV2(accountId, patch = {}) {
      const targetId = String(accountId || "").trim();
      if (!targetId) return { ok: false, error: "account_id is required" };
      const prevRows = await db
        .select()
        .from(schema.userAccounts)
        .where(eq(schema.userAccounts.accountId, targetId))
        .limit(1);
      const prev = prevRows[0];
      if (!prev) return { ok: false, error: "account not found" };
      const rows = await db
        .update(schema.userAccounts)
        .set({
          userId: String(patch.user_id ?? prev.userId ?? CFG.mt5DefaultUserId),
          name: String(patch.name ?? prev.name ?? targetId),
          balance:
            patch.balance === undefined
              ? prev.balance === null || prev.balance === undefined
                ? null
                : Number(prev.balance)
              : patch.balance === null ||
                  patch.balance === "" ||
                  Number.isNaN(Number(patch.balance))
                ? null
                : Number(patch.balance),
          status: String(patch.status ?? prev.status ?? "ACTIVE"),
          metadata:
            patch.metadata && typeof patch.metadata === "object"
              ? JSON.stringify(patch.metadata)
              : prev.metadata && typeof prev.metadata === "object"
                ? JSON.stringify(prev.metadata)
                : "{}",
          updatedAt: new Date(),
        })
        .where(eq(schema.userAccounts.accountId, targetId))
        .returning();
      return { ok: true, item: rows[0] || null };
    },
    async archiveAccountV2(accountId) {
      const targetId = String(accountId || "").trim();
      if (!targetId) return { ok: false, error: "account_id is required" };
      const rows = await db
        .update(schema.userAccounts)
        .set({ status: "ARCHIVED", updatedAt: new Date() })
        .where(eq(schema.userAccounts.accountId, targetId))
        .returning();
      if (!rows[0]) return { ok: false, error: "account not found" };
      return { ok: true, item: rows[0] };
    },
    async findAccountByApiKeyHash(apiKeyHash) {
      const h = String(apiKeyHash || "").trim();
      if (!h) return null;
      return dbQueries.findAccountByApiKeyHash(db, h);
    },
    async rotateAccountApiKeyV2(accountId) {
      const targetId = String(accountId || "").trim();
      if (!targetId) return null;
      const plainApiKey = `acc_${crypto.randomBytes(18).toString("hex")}`;
      const apiKeyHash = hashApiKey(plainApiKey);
      const apiKeyLast4 = plainApiKey.slice(-4);
      const res = await pool.query(
        `
        UPDATE user_accounts
        SET api_key_hash = $1, api_key_last4 = $2, api_key_rotated_at = NOW(), updated_at = NOW()
        WHERE account_id = $3
        RETURNING account_id
      `,
        [apiKeyHash, apiKeyLast4, targetId],
      );
      if (!res.rows[0]) return null;
      return { account_id: targetId, api_key_plaintext: plainApiKey };
    },
    async revokeAccountApiKeyV2(accountId) {
      const targetId = String(accountId || "").trim();
      if (!targetId) return { ok: false, error: "account_id is required" };
      const res = await pool.query(
        `
        UPDATE user_accounts
        SET api_key_hash = NULL, api_key_last4 = NULL, api_key_rotated_at = NOW(), updated_at = NOW()
        WHERE account_id = $1
      `,
        [targetId],
      );
      if ((res.rowCount || 0) === 0)
        return { ok: false, error: "account not found" };
      return { ok: true, account_id: targetId };
    },
    async updateAccountApiKeyV2(accountId, plainApiKey) {
      const targetId = String(accountId || "").trim();
      const plain = String(plainApiKey || "").trim();
      if (!targetId || !plain) return null;
      const apiKeyHash = hashApiKey(plain);
      const apiKeyLast4 = plain.slice(-4);
      const res = await pool.query(
        `
        UPDATE user_accounts
        SET api_key_hash = $1, api_key_last4 = $2, api_key_rotated_at = NOW(), updated_at = NOW()
        WHERE account_id = $3
        RETURNING account_id
      `,
        [apiKeyHash, apiKeyLast4, targetId],
      );
      return res.rowCount > 0
        ? { account_id: targetId, api_key_last4: apiKeyLast4 }
        : null;
    },
    async getAccountSubscriptionsV2(accountId) {
      const targetId = String(accountId || "").trim();
      if (!targetId) return [];
      const res = await pool.query(
        `SELECT source_ids_cache FROM user_accounts WHERE account_id = $1 LIMIT 1`,
        [targetId],
      );
      const cache = res.rows?.[0]?.source_ids_cache;
      const arr = Array.isArray(cache) ? cache : [];
      return arr
        .map((sourceId) => ({
          source_id: String(sourceId || ""),
          is_active: true,
        }))
        .filter((x) => x.source_id);
    },
    async replaceAccountSubscriptionsV2(accountId, items = []) {
      const targetId = String(accountId || "").trim();
      if (!targetId) return { ok: false, error: "account_id is required" };
      const sourceIds = (Array.isArray(items) ? items : [])
        .filter((x) => x && x.is_active !== false)
        .map((x) => String(x.source_id || "").trim())
        .filter(Boolean);
      await pool.query(
        `UPDATE user_accounts SET source_ids_cache = $1::jsonb, updated_at = NOW() WHERE account_id = $2`,
        [JSON.stringify(sourceIds), targetId],
      );
      return { ok: true };
    },
    async getTableSchema(table) {
      const allowed = await this.listTables();
      if (!allowed.includes(table))
        throw new Error(`Access denied to table: ${table}`);
      const res = await pool.query(
        `
        SELECT column_name, data_type, is_nullable, character_maximum_length, column_default
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `,
        [table],
      );
      return res.rows;
    },
    async getTablePrimaryKey(table) {
      const allowed = await this.listTables();
      if (!allowed.includes(table))
        throw new Error(`Access denied to table: ${table}`);
      const res = await pool.query(
        `
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.table_name = $1
          AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position
        LIMIT 1
      `,
        [table],
      );
      return res.rows[0]?.column_name || null;
    },
    async listTables() {
      return [
        "users",
        "user_accounts",
        "trades",
        "user_settings",
        "user_templates",
      ];
    },
    async listTableRows(
      table,
      limit = 50,
      offset = 0,
      query = "",
      sortCol = "",
      sortDir = "DESC",
    ) {
      const allowed = await this.listTables();
      if (!allowed.includes(table))
        throw new Error(`Access denied to table: ${table}`);
      const schema = await this.getTableSchema(table);
      const validCols = schema.map((c) => c.column_name);
      let where = "";
      const params = [limit, offset];
      if (query && validCols.length) {
        // SID/id columns: prefix match. Other columns: substring match.
        const idCols = ["sid", "id", "broker_trade_id"].filter((c) =>
          validCols.includes(c),
        );
        const otherCols = validCols.filter((c) => !idCols.includes(c));
        const clauses = [];
        if (idCols.length) {
          params.push(`${query}%`);
          clauses.push(
            `(${idCols.map((c) => `"${c}"::text ILIKE $${params.length}`).join(" OR ")})`,
          );
        }
        if (otherCols.length) {
          params.push(`%${query}%`);
          clauses.push(
            `(${otherCols.map((c) => `"${c}"::text ILIKE $${params.length}`).join(" OR ")})`,
          );
        }
        where = `WHERE ${clauses.join(" OR ")}`;
      }
      // Validate sort column against schema to prevent SQL injection
      let orderClause = "ORDER BY 1 DESC";
      if (sortCol) {
        if (validCols.includes(sortCol)) {
          const dir = sortDir.toUpperCase() === "ASC" ? "ASC" : "DESC";
          orderClause = `ORDER BY "${sortCol}" ${dir}`;
        }
      }
      const res = await pool.query(
        `SELECT * FROM ${table} ${where} ${orderClause} LIMIT $1 OFFSET $2`,
        params,
      );
      // Count query: reuse main query's where but with $1,$2 params
      let countWhere = "";
      if (query && validCols.length) {
        const cIdCols = ["sid", "id", "broker_trade_id"].filter((c) =>
          validCols.includes(c),
        );
        const cOtherCols = validCols.filter((c) => !cIdCols.includes(c));
        const cClauses = [];
        if (cIdCols.length)
          cClauses.push(
            `(${cIdCols.map((c) => `"${c}"::text ILIKE $1`).join(" OR ")})`,
          );
        if (cOtherCols.length)
          cClauses.push(
            `(${cOtherCols.map((c) => `"${c}"::text ILIKE $2`).join(" OR ")})`,
          );
        countWhere = `WHERE ${cClauses.join(" OR ")}`;
      }
      // Count query params: $1=query prefix, $2=query substring (if other cols present)
      const countParams = [];
      if (query && validCols.length) {
        const cIdCols = ["sid", "id", "broker_trade_id"].filter((c) =>
          validCols.includes(c),
        );
        const cOtherCols = validCols.filter((c) => !cIdCols.includes(c));
        if (cIdCols.length) countParams.push(`${query}%`);
        if (cOtherCols.length) countParams.push(`%${query}%`);
      }
      const totalRes = await pool.query(
        `SELECT COUNT(*) FROM ${table} ${countWhere}`,
        countParams,
      );
      return { rows: res.rows, total: parseInt(totalRes.rows[0].count) };
    },
    async updateTableRow(table, row) {
      const allowed = await this.listTables();
      if (!allowed.includes(table))
        throw new Error(`Access denied to table: ${table}`);
      if (!row || typeof row !== "object")
        throw new Error("row object is required");
      const schema = await this.getTableSchema(table);
      const pkCol =
        (await this.getTablePrimaryKey(table)) ||
        schema[0]?.column_name ||
        "id";
      const idVal = row[pkCol];
      if (idVal == null) throw new Error(`row must contain ${pkCol} column`);
      // Only allow updating columns that exist in schema
      const validCols = new Set(schema.map((c) => c.column_name));
      const setClauses = [];
      const params = [];
      let paramIdx = 1;
      for (const [k, v] of Object.entries(row)) {
        if (!validCols.has(k)) continue;
        if (k === pkCol) continue; // skip PK
        setClauses.push(`"${k}" = $${paramIdx}`);
        // parse JSON fields properly
        const colType = (
          schema.find((c) => c.column_name === k)?.data_type || ""
        ).toLowerCase();
        if (colType.includes("json")) {
          params.push(typeof v === "string" ? v : JSON.stringify(v));
        } else {
          params.push(v);
        }
        paramIdx++;
      }
      if (!setClauses.length) throw new Error("no valid columns to update");
      params.push(idVal);
      const hasUpdatedAt = validCols.has("updated_at");
      const updateFragments = hasUpdatedAt
        ? [...setClauses, `updated_at = NOW()`]
        : setClauses;
      const query = `UPDATE ${table} SET ${updateFragments.join(", ")} WHERE "${pkCol}" = $${paramIdx}`;
      await pool.query(query, params);
      return { ok: true, table, updated: idVal };
    },
    async getAccountByIdV2(accountId) {
      const res = await pool.query(
        `SELECT * FROM user_accounts WHERE account_id = $1 LIMIT 1`,
        [accountId],
      );
      return res.rows[0] || null;
    },
    async getUiAuthUser(email) {
      const target = normalizeEmail(email);
      if (!target) return null;
      const res = await pool.query(
        `
        SELECT user_id, name, email, role, is_active, password_salt, password_hash, metadata, updated_at, created_at
        FROM users
        WHERE lower(email) = $1
        LIMIT 1
      `,
        [target],
      );
      return res.rows[0] || null;
    },
    async getUiAuthUserByName(name) {
      const target = String(name || "").trim();
      if (!target) return null;
      const res = await pool.query(
        `
        SELECT user_id, name, email, role, is_active, password_salt, password_hash, metadata, updated_at, created_at
        FROM users
        WHERE lower(name) = lower($1)
        LIMIT 1
      `,
        [target],
      );
      return res.rows[0] || null;
    },
    async getUiAuthUserById(userId) {
      const target = String(userId || "").trim();
      if (!target) return null;
      const res = await pool.query(
        `
        SELECT user_id, name, email, role, is_active, password_salt, password_hash, metadata, updated_at, created_at
        FROM users
        WHERE user_id = $1
        LIMIT 1
      `,
        [target],
      );
      return res.rows[0] || null;
    },
    async deleteUiAuthUserById(userId) {
      const target = String(userId || "").trim();
      if (!target) return { ok: false, error: "user_id is required" };
      if (target === CFG.mt5DefaultUserId)
        return { ok: false, error: "Cannot delete system default user" };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Delete user (cascades to accounts, trades, signals, settings, profiles)
        const res = await client.query(
          "DELETE FROM users WHERE user_id = $1 RETURNING user_id",
          [target],
        );
        await client.query("COMMIT");
        return { ok: res.rowCount > 0 };
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async listUiUsers() {
      const res = await pool.query(`
        SELECT user_id, name, email, role, is_active, updated_at, created_at
        FROM users
        ORDER BY created_at ASC, user_id ASC
      `);
      return res.rows || [];
    },
    async upsertUiAuthUser(user) {
      const target = normalizeEmail(user?.email);
      if (!target) throw new Error("email is required");
      const userId = String(user?.user_id || CFG.mt5DefaultUserId);
      await pool.query(
        `
        INSERT INTO users (user_id, name, email, role, is_active, password_salt, password_hash, updated_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (user_id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          role = EXCLUDED.role,
          is_active = EXCLUDED.is_active,
          password_salt = EXCLUDED.password_salt,
          password_hash = EXCLUDED.password_hash,
          updated_at = EXCLUDED.updated_at
      `,
        [
          userId,
          String(user?.name || fallbackNameFromEmail(target)),
          target,
          normalizeUserRole(user?.role || UI_ROLE_SYSTEM),
          normalizeUserActive(user?.is_active, true),
          String(user?.password_salt || ""),
          String(user?.password_hash || ""),
          normalizeIsoTimestamp(user?.updated_at, new Date().toISOString()),
          normalizeIsoTimestamp(user?.created_at, mt5NowIso()),
        ],
      );
      return { ok: true };
    },
    async listUserAccounts(userId) {
      const res = await pool.query(
        `
        SELECT account_id, user_id, name, balance, status, metadata,
               equity, margin, free_margin, leverage, broker_name,
               created_at, updated_at
        FROM user_accounts
        WHERE user_id = $1
        ORDER BY created_at ASC, account_id ASC
      `,
        [String(userId || "")],
      );
      return res.rows || [];
    },
    async upsertUserAccount(userId, account) {
      const targetUser = String(userId || "");
      const accountId = String(account?.account_id || "");
      if (!accountId) return { ok: false, error: "account_id is required" };
      const now = mt5NowIso();
      const res = await pool.query(
        `
        INSERT INTO user_accounts (
          account_id, user_id, name, balance, status, metadata,
          equity, margin, free_margin, leverage, broker_name,
          created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (account_id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          name = EXCLUDED.name,
          balance = EXCLUDED.balance,
          status = EXCLUDED.status,
          metadata = COALESCE(user_accounts.metadata::jsonb, '{}'::jsonb) || EXCLUDED.metadata,
          equity = COALESCE(EXCLUDED.equity, user_accounts.equity),
          margin = COALESCE(EXCLUDED.margin, user_accounts.margin),
          free_margin = COALESCE(EXCLUDED.free_margin, user_accounts.free_margin),
          leverage = COALESCE(EXCLUDED.leverage, user_accounts.leverage),
          broker_name = COALESCE(NULLIF(EXCLUDED.broker_name, ''), user_accounts.broker_name),
          updated_at = EXCLUDED.updated_at
        RETURNING account_id, user_id, name, balance, status, metadata,
                  equity, margin, free_margin, leverage, broker_name,
                  created_at, updated_at
      `,
        [
          accountId,
          targetUser,
          String(account?.name || ""),
          account?.balance === null ||
          account?.balance === undefined ||
          Number.isNaN(Number(account.balance))
            ? null
            : Number(account.balance),
          String(account?.status || ""),
          account?.metadata && typeof account.metadata === "object"
            ? JSON.stringify(account.metadata)
            : null,
          account?.equity == null || Number.isNaN(Number(account.equity))
            ? null
            : Number(account.equity),
          account?.margin == null || Number.isNaN(Number(account.margin))
            ? null
            : Number(account.margin),
          account?.free_margin == null ||
          Number.isNaN(Number(account.free_margin))
            ? null
            : Number(account.free_margin),
          account?.leverage == null || Number.isNaN(Number(account.leverage))
            ? null
            : Number(account.leverage),
          String(account?.broker_name || ""),
          now,
          now,
        ],
      );
      return res.rows[0] || null;
    },
    async deleteUserAccount(userId, accountId) {
      await pool.query(
        `DELETE FROM user_accounts WHERE user_id = $1 AND account_id = $2`,
        [String(userId || ""), String(accountId || "")],
      );
    },
    async pruneOldSignals(days) {
      const res = await pool.query(
        `
        WITH signals_del AS (DELETE FROM signals WHERE created_at < NOW() - $1 * INTERVAL '1 day' RETURNING sid),
             trades_del AS (DELETE FROM trades WHERE created_at < NOW() - $1 * INTERVAL '1 day' RETURNING sid)
        SELECT (SELECT COUNT(*) FROM signals_del) as signals_count,
               (SELECT COUNT(*) FROM trades_del) as trades_count
      `,
        [days],
      );
      const counts = res.rows[0];
      return {
        removed: parseInt(counts.signals_count) + parseInt(counts.trades_count),
        remaining: 0,
      };
    },
    async listActiveSignals() {
      const res = await pool.query(`
        SELECT
          s.*,
          t.broker_trade_id AS ack_ticket,
          t.pnl_realized AS pnl_money_realized
        FROM signals s
        LEFT JOIN LATERAL (
          SELECT broker_trade_id, pnl_realized
          FROM trades
          WHERE sid = s.sid
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
          LIMIT 1
        ) t ON TRUE
        WHERE s.status IN ('NEW', 'LOCKED', 'PLACED', 'START')
        ORDER BY s.created_at DESC
      `);
      return res.rows || [];
    },
    async bulkAckSignals(updates) {
      let count = 0;
      for (const u of updates) {
        const rawStatus = String(u?.status || "")
          .trim()
          .toUpperCase();
        const isClosed = [
          "CLOSED",
          "TP",
          "SL",
          "CANCEL",
          "CANCELLED",
          "FAIL",
          "EXPIRED",
        ].includes(rawStatus);
        const pnlRaw = Number(u?.pnl);
        const hasPnl = Number.isFinite(pnlRaw);
        const pnlVal = hasPnl ? pnlRaw : null;
        let tradeExec = TRADE_STATUS.LIVE;
        if (["NEW", "LOCKED", "PLACED"].includes(rawStatus))
          tradeExec = "PENDING";
        else if (["TP", "SL", "CLOSED"].includes(rawStatus))
          tradeExec = "CLOSED";
        else if (["CANCEL", "CANCELLED", "EXPIRED"].includes(rawStatus))
          tradeExec = "CANCELLED";
        else if (rawStatus === "FAIL") tradeExec = "REJECTED";
        const res = await pool.query(
          `
          UPDATE signals
          SET status = $1
          WHERE sid = $2
        `,
          [u.status, u.sid],
        );
        await pool.query(
          `
          UPDATE trades
          SET execution_status = $1,
              broker_trade_id = COALESCE(NULLIF($2, ''), broker_trade_id),
              pnl_realized = CASE WHEN $4 = TRUE THEN $3 ELSE pnl_realized END,
              closed_at = CASE WHEN $5 = TRUE THEN NOW() ELSE closed_at END,
              updated_at = NOW()
          WHERE sid = $6
        `,
          [tradeExec, String(u.ticket || ""), pnlVal, hasPnl, isClosed, u.sid],
        );
        count += res.rowCount;
      }
      return { updated: count };
    },
    async getStorageStats(userId = "") {
      const u = userId || "";
      const sWhere = u ? " AND user_id = $1" : "";
      const tWhere = u ? " AND user_id = $1" : "";
      const params = u ? [u] : [];

      const signalCancelRes = await pool.query(
        `SELECT COUNT(*) as c FROM signals WHERE status IN ('CANCEL', 'ERROR', 'CANCELLED')${sWhere}`,
        params,
      );
      const tradeCancelRes = await pool.query(
        `SELECT COUNT(*) as c FROM trades WHERE execution_status IN ('REJECTED', 'CANCELLED')${tWhere}`,
        params,
      );

      const signalTestRes = await pool.query(
        `SELECT COUNT(*) as c FROM signals WHERE symbol = 'TEST'${sWhere}`,
        params,
      );
      const tradeTestRes = await pool.query(
        `SELECT COUNT(*) as c FROM trades WHERE symbol = 'TEST'${tWhere}`,
        params,
      );

      const fs = require("fs");
      const path = require("path");
      let snapshotsSize = 0;
      let snapshotsCount = 0;
      if (fs.existsSync(CHART_SNAPSHOT_DIR)) {
        const userPrefix = u ? `UID_${u}_` : "";
        const files = fs
          .readdirSync(CHART_SNAPSHOT_DIR)
          .filter((f) => !userPrefix || f.startsWith(userPrefix));
        snapshotsCount = files.length;
        for (const f of files) {
          try {
            snapshotsSize += fs.statSync(path.join(CHART_SNAPSHOT_DIR, f)).size;
          } catch (e) {}
        }
      }

      const disk = readDiskStats("/") || {};
      const pgLogsBytes = readPathSizeBytes("/var/log/postgresql");
      const aptCacheBytes = readPathSizeBytes("/var/cache/apt");
      const playwrightCacheBytes = readPathSizeBytes(
        "/root/.cache/ms-playwright",
      );
      const npmCacheBytes = readPathSizeBytes("/root/.npm");
      return {
        cancelled_error_count:
          parseInt(signalCancelRes.rows[0].c) +
          parseInt(tradeCancelRes.rows[0].c),
        test_trades_count:
          parseInt(signalTestRes.rows[0].c) + parseInt(tradeTestRes.rows[0].c),
        snapshots_count: snapshotsCount,
        snapshots_size_bytes: snapshotsSize,
        disk_mount: disk.mount || "/",
        disk_total_bytes: Number(disk.total_bytes || 0),
        disk_used_bytes: Number(disk.used_bytes || 0),
        disk_avail_bytes: Number(disk.avail_bytes || 0),
        disk_use_pct: Number.isFinite(Number(disk.use_pct))
          ? Number(disk.use_pct)
          : null,
        system_postgres_logs_size_bytes: pgLogsBytes,
        system_apt_cache_size_bytes: aptCacheBytes,
        system_playwright_cache_size_bytes: playwrightCacheBytes,
        system_npm_cache_size_bytes: npmCacheBytes,
      };
    },
    async storageCleanup(target, userId = "") {
      const u = userId || "";
      if (target === "hard_disk") {
        const report = cleanupSystemStorageArtifacts();
        return { ok: true, target, ...report };
      }
      if (target === "snapshots") {
        const fs = require("fs");
        const path = require("path");
        let deletedFiles = 0;
        if (fs.existsSync(CHART_SNAPSHOT_DIR)) {
          const userPrefix = u ? `UID_${u}_` : "";
          const files = fs
            .readdirSync(CHART_SNAPSHOT_DIR)
            .filter((f) => !userPrefix || f.startsWith(userPrefix));
          for (const f of files) {
            try {
              fs.unlinkSync(path.join(CHART_SNAPSHOT_DIR, f));
              deletedFiles++;
            } catch (e) {}
          }
        }
        return { ok: true, target, deleted_files: deletedFiles };
      } else if (target === "reset_user_data") {
        if (!u) throw new Error("userId is required for reset_user_data");
        const tDel = await pool.query(`DELETE FROM trades WHERE user_id = $1`, [
          u,
        ]);
        const sDel = await pool.query(
          `DELETE FROM signals WHERE user_id = $1`,
          [u],
        );
        return {
          ok: true,
          target,
          trades_deleted: tDel.rowCount,
          signals_deleted: sDel.rowCount,
        };
      } else if (target === "cancelled_error" || target === "test_trades") {
        const sWhereUser = u ? " AND user_id = $1" : "";
        const tWhereUser = u ? " AND user_id = $1" : "";
        const params = u ? [u] : [];

        const signalWhere =
          target === "cancelled_error"
            ? `status IN ('CANCEL', 'ERROR', 'CANCELLED')${sWhereUser}`
            : `symbol = 'TEST'${sWhereUser}`;
        const tradeWhere =
          target === "cancelled_error"
            ? `execution_status IN ('REJECTED', 'CANCELLED')${tWhereUser}`
            : `symbol = 'TEST'${tWhereUser}`;

        // 1. Collect signals and their IDs
        const sQ = await pool.query(
          `SELECT * FROM signals WHERE ${signalWhere}`,
          params,
        );
        const sRows = sQ.rows;
        const sIds = sRows.map((r) => String(r.sid));

        // 2. Collect trades and their IDs
        const tQ = await pool.query(
          `SELECT * FROM trades WHERE ${tradeWhere}`,
          params,
        );
        const tRows = tQ.rows;
        const tIds = tRows.map((r) => String(r.sid));

        // 3. Delete from trades first
        let tradesDeleted = 0;
        if (tIds.length > 0) {
          const tDel = await pool.query(
            `DELETE FROM trades WHERE sid = ANY($1)`,
            [tIds],
          );
          tradesDeleted = tDel.rowCount;
        }

        // 4. Delete from signals
        let signalsDeleted = 0;
        if (sIds.length > 0) {
          const sDel = await pool.query(
            `DELETE FROM signals WHERE sid = ANY($1)`,
            [sIds],
          );
          signalsDeleted = sDel.rowCount;
        }

        // 5. Cleanup artifacts
        const cleanup = await mt5CleanupSignalTradeArtifacts({
          signalRows: sRows,
          signalIds: sIds,
          tradeRows: tRows,
          tradeIds: tIds,
        });

        return {
          ok: true,
          target,
          deleted_signals: signalsDeleted,
          deleted_trades: tradesDeleted,
          files_deleted: cleanup.files_deleted,
        };
      } else if (target === "cache") {
        const results = { redis: false, db_market_data: false };
        if (CFG.redisEnabled) {
          const client = await getRedisClient();
          if (client) {
            await client.flushAll().catch(() => {});
            results.redis = true;
          }
        }
        await pool.query(`TRUNCATE TABLE market_data`);
        results.db_market_data = true;
        // Also clear memory cache if applicable
        MARKET_DATA_MEMORY_CACHE.clear();
        return { ok: true, target, ...results };
      }
    },
    async uiListCache() {
      const items = [];
      const now = Date.now();

      // 1. Memory Cache (Market Data)
      for (const [key, entry] of MARKET_DATA_TF_CACHE.entries()) {
        const ttlMs = tfToMs(entry.tf || key.split("_").pop() || "4H");
        const expired = now - entry.created_at > ttlMs;
        items.push({
          key,
          source: "memory",
          data: {
            symbol: key.split("_")[0] || key,
            tf: entry.tf || key.split("_").pop() || "?",
            bars: entry.bars?.length || 0,
            updated_at: entry.created_at
              ? new Date(entry.created_at).toISOString()
              : null,
          },
          ttl_ms: ttlMs,
          expired,
        });
      }

      // 2. Redis Cache (Market Data)
      if (CFG.redisEnabled) {
        try {
          const client = await getRedisClient();
          if (client) {
            const keys = await client.keys("tf:*");
            for (const rKey of keys) {
              if (items.some((it) => it.key === rKey)) continue;
              const parts = rKey.replace("tf:", "").split("_");
              const symbol = parts[0] || "?";
              const tf = parts[1] || "?";
              items.push({
                key: rKey,
                source: "redis",
                data: { symbol, tf, bars: "?" },
                ttl_ms: null,
                expired: false,
              });
            }
            // Also legacy market_data:* keys
            const legacyKeys = await client.keys("market_data:*");
            for (const rKey of legacyKeys) {
              if (items.some((it) => it.key === rKey)) continue;
              const symbol = rKey.replace("market_data:", "");
              items.push({
                key: rKey,
                source: "redis",
                data: { symbol, tf: "MULTI" },
                ttl_ms: null,
                expired: false,
              });
            }
          }
        } catch (e) {
          console.warn("[Cache] Failed to list redis keys:", e.message);
        }
      }

      return items;
    },
    async uiGetCacheDetail(key, source) {
      if (source === "memory") {
        const val =
          MARKET_DATA_TF_CACHE.get(key) || MARKET_DATA_MEMORY_CACHE.get(key);
        return { ok: true, data: val };
      }
      if (source === "redis" && CFG.redisEnabled) {
        const client = await getRedisClient();
        if (client) {
          const val = await client.get(key).catch(() => null);
          try {
            return { ok: true, data: JSON.parse(val) };
          } catch {
            return { ok: true, data: val };
          }
        }
      }
      return { ok: false, error: "source not found or disabled" };
    },
    async uiDeleteCacheKey(key, source) {
      if (source === "memory") {
        MARKET_DATA_TF_CACHE.delete(key);
        MARKET_DATA_MEMORY_CACHE.delete(key);
        return { ok: true };
      }
      if (source === "redis" && CFG.redisEnabled) {
        const client = await getRedisClient();
        if (client) {
          await client.del(key).catch(() => {});
          return { ok: true };
        }
      }
      return { ok: false, error: "source not found or disabled" };
    },
    async deleteSignalsByIds(ids) {
      const refs = Array.isArray(ids)
        ? ids.map((v) => String(v || "").trim()).filter(Boolean)
        : [];
      if (!refs.length) return { deleted: 0 };
      const numericIds = refs
        .map((v) => mt5ParseNumericId(v))
        .filter((v) => v != null);

      // Delete trades first (due to foreign key or just clean association)
      await pool.query(
        `
        DELETE FROM trades
        WHERE sid = ANY($1::text[])
      `,
        [refs],
      );

      const res = await pool.query(
        `
        DELETE FROM signals
        WHERE sid = ANY($1::text[])
           OR sid = ANY($1::text[])
           OR id = ANY($2::bigint[])
      `,
        [refs, numericIds],
      );
      return { deleted: res.rowCount };
    },
    async cancelSignalsByIds(ids) {
      const refs = Array.isArray(ids)
        ? ids.map((v) => String(v || "").trim()).filter(Boolean)
        : [];
      if (!refs.length) return { updated: 0, updated_ids: [] };
      const numericIds = refs
        .map((v) => mt5ParseNumericId(v))
        .filter((v) => v != null);
      const res = await pool.query(
        `
        UPDATE signals
        SET status = 'CANCEL'
        WHERE sid = ANY($1::text[])
           OR sid = ANY($1::text[])
           OR id = ANY($2::bigint[])
        RETURNING sid
      `,
        [refs, numericIds],
      );
      return {
        updated: res.rowCount,
        updated_ids: res.rows.map((r) => r.sid),
      };
    },
    async renewSignalsByIds(signalIds) {
      const ids = Array.isArray(signalIds)
        ? signalIds.map((s) => String(s || "")).filter(Boolean)
        : [];
      if (!ids.length) return { updated: 0, updated_ids: [] };
      const numericIds = ids
        .map((v) => mt5ParseNumericId(v))
        .filter((v) => v != null);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const selected = await client.query(
          `
          SELECT *
          FROM signals
          WHERE sid = ANY($1::text[])
             OR sid = ANY($1::text[])
             OR id = ANY($2::bigint[])
          FOR UPDATE
        `,
          [ids, numericIds],
        );
        const updatedIds = [];
        for (const row of selected.rows || []) {
          const oldId = String(row.sid || "");
          const cur = mt5CanonicalStoredStatus(row.status);
          if (cur === "NEW" || cur === "LOCKED") continue;

          const base = mt5RenewSignalIdBase(oldId);
          const existingRows = await client.query(
            `SELECT sid FROM signals WHERE sid = $1 OR sid LIKE $2`,
            [base, `${base}.%`],
          );
          const renewedId = mt5RenewSignalIdFromExisting(
            base,
            (existingRows.rows || []).map((r) => String(r.sid || "")),
          );

          const ins = await client.query(
            `
            INSERT INTO signals (
              sid, created_at, user_id, source, source_id, side, symbol, entry, entry_model, sl, tp,
              signal_tf, chart_tf, rr_planned, note, raw_json, status
            )
            VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'NEW')
            ON CONFLICT DO NOTHING
          `,
            [
              renewedId,
              row.user_id,
              row.source,
              row.source_id,
              row.side || row.action,
              row.symbol,
              row.entry,
              row.entry_model || row.raw_json?.entry_model || null,
              row.sl,
              row.tp,
              row.signal_tf,
              row.chart_tf,
              row.rr_planned,
              row.note,
              row.raw_json,
            ],
          );

          if ((ins.rowCount || 0) > 0) {
            await client.query(`DELETE FROM signals WHERE sid = $1`, [oldId]);
            updatedIds.push(renewedId);
          }
        }
        await client.query("COMMIT");
        return { updated: updatedIds.length, updated_ids: updatedIds };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
  // Run provider schema migration on startup
  migrateProviderSchema().catch((err) =>
    console.warn(
      "[Migration] Provider schema startup migration error:",
      err.message,
    ),
  );
  return backend;
}

async function mt5Backend() {
  const srcId = currentMt5DbSourceId();
  console.log("[db-source] mt5Backend called, source=", srcId || "default");
  return mt5InitBackend();
}

function mt5NormalizeAction(payload) {
  const raw = String(payload.action || payload.side || "")
    .trim()
    .toUpperCase();
  if (!["BUY", "SELL", "CLOSE"].includes(raw)) {
    throw new Error(`Unsupported action/side: ${raw}`);
  }
  return raw;
}

function mt5NormalizeSymbol(payload) {
  const raw = String(payload.symbol || "")
    .trim()
    .toUpperCase();
  const symbol = raw.includes(":")
    ? raw.split(":").slice(1).join(":").trim().toUpperCase()
    : raw;
  if (!symbol) {
    throw new Error("symbol is required");
  }
  return symbol;
}

function mt5NormalizeVolume(payload) {
  const v = payload.lots ?? payload.volume;
  if (v === undefined || v === null || v === "") {
    return CFG.mt5DefaultLot;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("v2026.05.09 19:31 - 728f356");
  }
  return n;
}

function mt5NormalizeOrderTypeValue(rawInput, fallback = "limit") {
  const fallbackNorm = String(fallback || "limit")
    .trim()
    .toLowerCase();
  const raw = String(rawInput ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (!raw)
    return ["limit", "stop", "market"].includes(fallbackNorm)
      ? fallbackNorm
      : "limit";
  if (raw === "limit" || raw === "stop" || raw === "market") return raw;
  if (raw.endsWith(" limit") || raw.startsWith("limit ")) return "limit";
  if (raw.endsWith(" stop") || raw.startsWith("stop ")) return "stop";
  if (raw.endsWith(" market") || raw.startsWith("market ")) return "market";
  if (raw.includes("limit")) return "limit";
  if (raw.includes("stop")) return "stop";
  if (raw.includes("market")) return "market";
  return ["limit", "stop", "market"].includes(fallbackNorm)
    ? fallbackNorm
    : "limit";
}

function mt5NormalizeOrderType(payload) {
  const normalized = mt5NormalizeOrderTypeValue(
    payload.order_type ?? payload.orderType,
    "limit",
  );
  if (
    normalized === "limit" ||
    normalized === "stop" ||
    normalized === "market"
  )
    return normalized;
  throw new Error("order_type must be one of: limit, stop, market");
}

function mt5BuildSignalId(payload, fallbackPrefix = "tv") {
  const provided = String(payload.id || "").trim();
  if (provided) {
    return provided.replace(/[^a-zA-Z0-9_:-]/g, "_").slice(0, 96);
  }
  return `${fallbackPrefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function mt5BuildNote(payload) {
  const noteParts = [
    payload.source,
    payload.signal_tf,
    payload.reason,
    payload.note,
  ].filter(Boolean);
  return noteParts.join(" | ");
}

function mt5SlugId(input, fallback = "default") {
  const raw = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return raw || fallback;
}

function mt5MapActionToSide(action) {
  const a = String(action || "")
    .trim()
    .toUpperCase();
  if (a === "BUY" || a === "LONG") return "BUY";
  if (a === "SELL" || a === "SHORT") return "SELL";
  return a || "BUY";
}

function mt5NormalizeBrokerTicket(item = {}) {
  const candidates = [
    item.broker_trade_id,
    item.brokerTradeId,
    item.sid,
    item.tradeId,
    item.ticket,
    item.position_id,
    item.positionId,
    item.order_id,
    item.orderId,
    item.id,
  ];
  for (const c of candidates) {
    const v = String(c || "").trim();
    if (v) return v;
  }
  return "";
}

function mt5NormalizeExecutionStatusV2(value) {
  const s = String(value || "")
    .trim()
    .toUpperCase();
  if (s === "CANCEL" || s === "CANCELED" || s === "CANCELLED")
    return "CANCELLED";
  if (
    s === "PENDING" ||
    s === "FILLED" ||
    s === "CLOSED" ||
    s === "REJECTED" ||
    s === "CANCELLED"
  )
    return s;
  return "FILLED";
}

function mt5TfToMinutes(tf) {
  if (!tf) return null;
  const s = String(tf).toLowerCase().trim();
  if (s === "1" || s === "1m") return "1";
  if (s === "2" || s === "2m") return "2";
  if (s === "3" || s === "3m") return "3";
  if (s === "5" || s === "5m") return "5";
  if (s === "10" || s === "10m") return "10";
  if (s === "15" || s === "15m") return "15";
  if (s === "30" || s === "30m") return "30";
  if (s === "60" || s === "1h") return "60";
  if (s === "120" || s === "2h") return "120";
  if (s === "240" || s === "4h") return "240";
  if (s === "1440" || s === "1d" || s === "d") return "1440";
  if (s === "10080" || s === "1w" || s === "w") return "10080";
  if (s === "43200" || s === "1m" || s === "1mn" || s === "mn" || s === "1mo")
    return "43200";

  const m = s.match(/^(\d+)([mhdwm])$/);
  if (m) {
    const val = parseInt(m[1]);
    const unit = m[2];
    if (unit === "m") return String(val);
    if (unit === "h") return String(val * 60);
    if (unit === "d") return String(val * 1440);
    if (unit === "w") return String(val * 10080);
    if (unit === "m") return String(val * 43200);
  }
  const n = parseInt(s);
  return isNaN(n) ? s : String(n);
}

const TWELVE_SYMBOL_MAP = {
  // Indices
  UK100: "UK100",
  "UK 100": "UK100",
  FTSE: "UK100",
  FTSE100: "UK100",
  US30: "DJI",
  DOW: "DJI",
  DJI: "DJI",
  NAS100: "NDX",
  USTEC: "NDX",
  US100: "NDX",
  NASDAQ: "NDX",
  SPX500: "SPX",
  US500: "SPX",
  SPX: "SPX",
  DE40: "GER40",
  GER40: "GER40",
  GER30: "DAX",
  DAX: "DAX",
  DAX40: "GER40",
  HK33: "HSI",
  HSI: "HSI",
  HKG33: "HSI",
  HK50: "HSI",
  JPN225: "NI225",
  JP225: "NI225",
  NI225: "NI225",
  N225: "NI225",
  FRA40: "FRA40",
  CAC40: "FRA40",
  EUSTX50: "STX50",
  XAUUSD: "XAU/USD",
  GOLD: "XAU/USD",
  XAGUSD: "XAG/USD",
  SILVER: "XAG/USD",
  XPDUSD: "XPD/USD",
  XPTUSD: "XPT/USD",
  WTI: "WTI/USD",
  BRENT: "BRENT/USD",
  USOIL: "WTI/USD",
  UKOIL: "BRENT/USD",
  // Crypto Fallbacks (if regex fails)
  BTCUSD: "BTC/USD",
  ETHUSD: "ETH/USD",
};

function normalizeSymbolForTwelve(rawSymbol) {
  const base = String(rawSymbol || "")
    .trim()
    .toUpperCase();
  if (!base) return "";
  const noProvider = base.includes(":")
    ? base.split(":").slice(1).join(":")
    : base;
  const compact = noProvider.replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";

  if (TWELVE_SYMBOL_MAP[compact]) return TWELVE_SYMBOL_MAP[compact];

  if (compact.endsWith("USDT") && compact.length > 4) {
    const left = compact.slice(0, -4);
    return `${left}/USD`;
  }
  if (/^[A-Z]{6}$/.test(compact)) {
    return `${compact.slice(0, 3)}/${compact.slice(3)}`;
  }
  if (/^[A-Z]{3,5}USD$/.test(compact)) {
    return `${compact.slice(0, -3)}/USD`;
  }
  return compact;
}

async function resolveTwelveSymbol(rawSymbol, apiKey = "") {
  const base = String(rawSymbol || "")
    .trim()
    .toUpperCase();
  if (!base) return [];
  const noProvider = base.includes(":")
    ? base.split(":").slice(1).join(":").trim().toUpperCase()
    : base;
  const normalized = normalizeSymbolForTwelve(noProvider);
  const compact = noProvider.replace(/[^A-Z0-9]/g, "");
  const candidates = [];
  const add = (v) => {
    const s = String(v || "")
      .trim()
      .toUpperCase();
    if (!s) return;
    if (!candidates.includes(s)) candidates.push(s);
  };
  add(normalized);
  add(compact);
  if (/^[A-Z]{6}$/.test(compact))
    add(`${compact.slice(0, 3)}/${compact.slice(3)}`);
  if (/^[A-Z]{3,5}USD$/.test(compact)) add(`${compact.slice(0, -3)}/USD`);

  // Try Twelve symbol search to pick a provider-accepted symbol variant.
  try {
    const searchUrl = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(noProvider)}${apiKey ? `&apikey=${encodeURIComponent(apiKey)}` : ""}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(searchUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    const out = await res.json().catch(() => ({}));
    const arr = Array.isArray(out?.data) ? out.data : [];
    for (const row of arr) {
      add(row?.symbol);
      if (row?.symbol && row?.exchange) {
        add(`${row.symbol}:${row.exchange}`);
      }
    }
  } catch {
    // ignore and fallback to static candidates
  }

  return candidates;
}

function timeframeToTwelve(tfRaw) {
  const s = String(tfRaw || "")
    .trim()
    .toLowerCase();
  if (!s || s === "manual") return "15min";
  if (s === "d") return "1day";
  if (s === "w") return "1week";
  if (s === "mn" || s === "mo" || s === "month") return "1month";
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return "15min";
    if (n < 60) return `${n}min`;
    if (n % 60 === 0 && n < 1440) return `${n / 60}h`;
    if (n === 1440) return "1day";
    if (n === 10080) return "1week";
    if (n === 43200) return "1month";
    return `${Math.max(1, Math.round(n / 60))}h`;
  }
  const m = s.match(/^(\d+)(m|min|h|d|w)$/);
  if (m) {
    const n = Math.max(1, Number(m[1] || 1));
    const unit = m[2];
    if (unit === "m" || unit === "min") return `${n}min`;
    if (unit === "h") return `${n}h`;
    if (unit === "d") return `${n}day`;
    if (unit === "w") return `${n}week`;
  }
  return s;
}

function parseSnapshotPdArrays(payload = {}) {
  const fromTradePlan = payload?.market_analysis?.pd_arrays;
  const direct = payload?.pd_arrays || payload?.pdArrays;
  const arr = Array.isArray(fromTradePlan)
    ? fromTradePlan
    : Array.isArray(direct)
      ? direct
      : [];
  return arr
    .map((x) => (x && typeof x === "object" ? x : null))
    .filter(Boolean)
    .map((x) => ({
      id: Number.isFinite(Number(x.id)) ? Number(x.id) : null,
      type: String(x.type || "").trim(),
      direction: String(x.direction || "").trim(),
      strength: String(x.strength || "").trim(),
      timeframe: String(x.timeframe || x.tf || "").trim(),
      zone: x.zone,
      low: x.low ?? x.bottom ?? x.price_bottom ?? null,
      high: x.high ?? x.top ?? x.price_top ?? null,
      bar_start: Number.isFinite(Number(x.bar_start_unix ?? x.bar_start))
        ? Number(x.bar_start_unix ?? x.bar_start)
        : null,
      status: String(x.status || "").trim(),
      touched: Number.isFinite(Number(x.touched)) ? Number(x.touched) : null,
      mitigation_type: String(x.mitigation_type || "").trim(),
      note: String(x.note || "").trim(),
    }));
}

function parseSnapshotKeyLevels(payload = {}) {
  const out = [];
  const pushLevel = (item) => {
    if (!item) return;
    if (typeof item === "number") {
      if (Number.isFinite(item))
        out.push({ name: "Key Level", price: item, kind: "generic" });
      return;
    }
    if (typeof item === "string") {
      const nums = item.match(/-?\d+(?:\.\d+)?/g);
      if (nums && nums[0] && Number.isFinite(Number(nums[0]))) {
        out.push({
          name: item.slice(0, 30),
          price: Number(nums[0]),
          kind: "generic",
        });
      }
      return;
    }
    if (typeof item === "object") {
      const name = String(
        item.name || item.label || item.type || "Key Level",
      ).slice(0, 40);
      const p = Number(item.price ?? item.level ?? item.value);
      const barStart = Number(item.bar_start_unix ?? item.bar_start);
      if (Number.isFinite(p))
        out.push({
          name,
          price: p,
          kind: String(item.kind || item.type || "generic"),
          type: String(item.type || "").trim(),
          zone_type: String(item.zone_type || "").trim(),
          swept: Boolean(item.swept),
          bar_start: Number.isFinite(barStart) ? barStart : null,
        });
    }
  };
  const keyLevels = Array.isArray(payload?.market_analysis?.key_levels)
    ? payload.market_analysis.key_levels
    : payload?.key_levels || payload?.keyLevels;
  if (Array.isArray(keyLevels)) keyLevels.forEach(pushLevel);
  if (payload?.key_level) pushLevel(payload.key_level);
  if (Array.isArray(payload?.risk_management?.key_levels))
    payload.risk_management.key_levels.forEach(pushLevel);
  const pd = parseSnapshotPdArrays(payload);
  pd.forEach((x) => {
    const low = Number(x.low);
    const high = Number(x.high);
    if (Number.isFinite(low))
      out.push({ name: `${x.type || "PD"} low`, price: low, kind: "pd" });
    if (Number.isFinite(high))
      out.push({ name: `${x.type || "PD"} high`, price: high, kind: "pd" });
  });
  const dedup = new Map();
  out.forEach((x) => {
    if (!Number.isFinite(Number(x.price))) return;
    const k = `${x.name}|${Number(x.price).toFixed(6)}`;
    if (!dedup.has(k)) dedup.set(k, { ...x, price: Number(x.price) });
  });
  return [...dedup.values()].slice(0, 40);
}

function parseSnapshotChecklist(payload = {}) {
  const raw =
    payload?.market_analysis?.confluence_checklist ??
    payload?.confluence_checklist ??
    payload?.market_analysis?.checklist ??
    payload?.checklist;
  const arr = Array.isArray(raw)
    ? raw
    : [
        ...(Array.isArray(raw?.buy)
          ? raw.buy.map((x) => ({ side: "buy", ...x }))
          : []),
        ...(Array.isArray(raw?.buy?.items)
          ? raw.buy.items.map((x) => ({ side: "buy", ...x }))
          : []),
        ...(Array.isArray(raw?.sell)
          ? raw.sell.map((x) => ({ side: "sell", ...x }))
          : []),
        ...(Array.isArray(raw?.sell?.items)
          ? raw.sell.items.map((x) => ({ side: "sell", ...x }))
          : []),
      ];
  return arr
    .map((x) => ({
      side: String(x?.side || "").trim(),
      strategy: String(x?.strategy || "").trim(),
      condition: String(x?.condition || x?.item || "").trim(),
      weight: String(x?.weight || "").trim(),
      checked: Boolean(x?.checked ?? x?.passed),
      pd_array_ref: Number.isFinite(Number(x?.pd_array_ref ?? x?.pdRef))
        ? Number(x.pd_array_ref ?? x.pdRef)
        : null,
      note: String(x?.note || "").trim(),
    }))
    .filter((x) => x.strategy || x.condition || x.note);
}

function confidenceLevelToPct(level) {
  const v = String(level || "")
    .trim()
    .toLowerCase();
  if (v === "high") return 80;
  if (v === "normal") return 60;
  if (v === "low") return 40;
  return null;
}

function planTakeProfitsRaw(plan = {}) {
  const list = Array.isArray(plan?.take_profits) ? [...plan.take_profits] : [];
  if (!list.length) {
    const mx = plan?.multiple_exits || {};
    if (mx?.tp2) list.push(mx.tp2);
    if (mx?.full_tp) list.push(mx.full_tp);
  }
  return list;
}

function planTakeProfitValue(tpLike) {
  if (tpLike && typeof tpLike === "object") return tpLike.price ?? null;
  return tpLike ?? null;
}

function planPartialTps(plan = {}) {
  const fromTakeProfits = planTakeProfitsRaw(plan).map((t) => ({
    price: t?.price ?? null,
    size_pct: t?.close_position_pct ?? null,
    rr: t?.reward_to_risk ?? null,
  }));
  if (fromTakeProfits.length) return fromTakeProfits;
  const mx = plan?.multiple_exits || {};
  return ["break_even", "tp2", "full_tp"]
    .filter((k) => mx && typeof mx[k] === "object")
    .map((k) => ({
      price: mx[k]?.price ?? null,
      size_pct: mx[k]?.position_pct ?? null,
      rr: mx[k]?.risk_reward ?? null,
    }));
}

function planDecisionText(plan = {}) {
  const decision =
    plan?.risk_management?.skip_decision ||
    plan?.trade_decision ||
    plan?.position_management?.trade_decision ||
    "";
  return decision === "Proceed" ? "" : String(decision || "");
}

function planSkipReasons(plan = {}) {
  const normalizeReasons = (value) => {
    if (Array.isArray(value)) {
      return value.map((r) => ({
        reason: r?.reason || String(r || ""),
        severity: r?.severity || "",
      }));
    }
    const text = String(value || "").trim();
    return text ? [{ reason: text, severity: "" }] : [];
  };
  const rmReasons = normalizeReasons(plan?.risk_management?.skip_reasons);
  if (rmReasons.length) return rmReasons;
  if (Array.isArray(plan?.skip_reasons)) {
    return plan.skip_reasons.map((r) => ({
      reason: r?.reason || "",
      severity: r?.severity || "",
    }));
  }
  const text = String(
    plan?.position_management?.skips_reasons ||
      plan?.position_management?.skip_reasons ||
      "",
  ).trim();
  return text ? [{ reason: text, severity: "" }] : [];
}

const RESPONSE_MAPPING_PATH = path.join(
  __dirname,
  "..",
  "config",
  "response_mapping.json",
);

function loadResponseMappingRules() {
  try {
    if (!fs.existsSync(RESPONSE_MAPPING_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(RESPONSE_MAPPING_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const RESPONSE_MAPPING_RULES = loadResponseMappingRules();
const DEFAULT_TRADE_PLAN_PATHS = ["trade_plan", "analysis_data[].trade_plan"];

function extractByRulePath(root, rulePath) {
  const pathText = String(rulePath || "").trim();
  if (!pathText) return [];
  const steps = pathText
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
  let current = [root];
  for (const step of steps) {
    const isArrayStep = step.endsWith("[]");
    const key = isArrayStep ? step.slice(0, -2) : step;
    const next = [];
    for (const node of current) {
      if (!node || typeof node !== "object") continue;
      const value = node[key];
      if (isArrayStep) {
        if (Array.isArray(value)) next.push(...value);
      } else {
        if (value !== undefined && value !== null) next.push(value);
      }
    }
    current = next;
    if (!current.length) break;
  }
  return current;
}

function collectTradePlansByRules(root) {
  const paths = Array.isArray(RESPONSE_MAPPING_RULES?.trade_plan_paths)
    ? RESPONSE_MAPPING_RULES.trade_plan_paths
    : DEFAULT_TRADE_PLAN_PATHS;
  const out = [];
  for (const p of paths) {
    const hits = extractByRulePath(root, p);
    for (const item of hits) {
      if (Array.isArray(item)) {
        for (const x of item) if (x && typeof x === "object") out.push(x);
      } else if (item && typeof item === "object") {
        out.push(item);
      }
    }
  }
  return out;
}

function dedupeTradePlans(plans = []) {
  const list = Array.isArray(plans) ? plans : [];
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== "object") continue;
    const key = [
      String(p.symbol || "")
        .trim()
        .toUpperCase(),
      String(p.direction || p.dir || "")
        .trim()
        .toUpperCase(),
      Number(p.entry ?? p.entry_price ?? NaN),
      Number(p.sl ?? p.stop_loss ?? NaN),
      Number(
        p.tp ?? p.take_profit ?? p.tp3 ?? p.multiple_exits?.tp3?.price ?? NaN,
      ),
      String(p.entry_model || "")
        .trim()
        .toUpperCase(),
      String(p.strategy || "")
        .trim()
        .toUpperCase(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function resolvePlanTakeProfit(plan = {}) {
  const candidates = [
    plan?.tp,
    plan?.take_profit,
    plan?.breakeven_trigger,
    plan?.tp3,
    plan?.tp2,
    plan?.tp1,
    plan?.multiple_exits?.full_tp?.price,
    plan?.multiple_exits?.tp3?.price,
    plan?.multiple_exits?.tp2?.price,
    plan?.multiple_exits?.tp1?.price,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function planPrimaryTpNumber(plan = {}) {
  return Number(resolvePlanTakeProfit(plan) ?? NaN);
}

function hasNumericEntrySlTp(plan = {}) {
  const entry = Number(plan?.entry ?? plan?.entry_price ?? NaN);
  const sl = Number(plan?.sl ?? plan?.stop_loss ?? NaN);
  const tp = planPrimaryTpNumber(plan);
  return Number.isFinite(entry) && Number.isFinite(sl) && Number.isFinite(tp);
}

function enforceActionableTradePlans(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return payload;
  const out = { ...payload };
  if (!Array.isArray(out.trade_plan)) return out;
  out.trade_plan = dedupeTradePlans(out.trade_plan).map((plan) => {
    if (!plan || typeof plan !== "object") return plan;
    const hasPrices = hasNumericEntrySlTp(plan);
    const decisionRaw = String(
      plan?.skip_recommendation ||
        plan?.trade_decision ||
        plan?.risk_management?.skip_decision ||
        "",
    )
      .trim()
      .toLowerCase();
    const proceeding =
      !decisionRaw ||
      decisionRaw === "proceed" ||
      decisionRaw === "trade" ||
      decisionRaw === "enter";
    if (hasPrices || !proceeding) return plan;
    const reasonText =
      "Missing entry/stop-loss/take-profit in AI response. Auto-marked as Skip.";
    const reasons = Array.isArray(plan?.reasons_to_skip)
      ? [...plan.reasons_to_skip]
      : [];
    if (
      !reasons.some((r) => String(r?.reason || "").includes("Missing entry"))
    ) {
      reasons.push({ reason: reasonText, severity: "warning" });
    }
    return {
      ...plan,
      skip_recommendation: "Skip",
      trade_decision: "Skip",
      reasons_to_skip: reasons,
      risk_management:
        plan?.risk_management && typeof plan.risk_management === "object"
          ? {
              ...plan.risk_management,
              skip_decision: "Skip",
              skip_reasons: plan.risk_management.skip_reasons || reasonText,
            }
          : {
              skip_decision: "Skip",
              skip_reasons: reasonText,
            },
      note: String(plan?.note || "").trim() || reasonText,
    };
  });
  return out;
}

function normalizeAiAnalysisContract(input = {}) {
  return input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const out = { ...input };
  const indexedRootPlans = Object.keys(out)
    .filter((k) => /^\d+$/.test(String(k)))
    .map((k) => out[k])
    .filter((x) => x && typeof x === "object" && !Array.isArray(x))
    .filter(
      (x) =>
        x.execution_plan ||
        x.risk_management ||
        x.entry != null ||
        x.entry_price != null ||
        x.stop_loss != null ||
        x.sl != null,
    )
    .map((x) => ({ ...(x || {}) }));
  const mappedPlans = collectTradePlansByRules(out).map((p) => ({
    ...(p || {}),
  }));
  const mergedMappedPlans = [...mappedPlans, ...indexedRootPlans];
  if (
    mergedMappedPlans.length &&
    (!Array.isArray(out.trade_plan) || out.trade_plan.length === 0)
  ) {
    out.trade_plan = mergedMappedPlans;
  }
  // Alternate schema variant: analyses[] with per-symbol trade_plan
  if (Array.isArray(out.analyses) && out.analyses.length > 0) {
    const entries = out.analyses.filter((x) => x && typeof x === "object");
    const analysisPlans = entries.flatMap((e) =>
      Array.isArray(e.trade_plan)
        ? e.trade_plan.map((p) => ({
            ...(p || {}),
            symbol: String(p?.symbol || e?.symbol || "").trim(),
          }))
        : [],
    );
    if (analysisPlans.length) {
      const rootPlans = Array.isArray(out.trade_plan)
        ? out.trade_plan
            .filter((p) => p && typeof p === "object")
            .map((p) => ({ ...(p || {}) }))
        : [];
      out.trade_plan = [...rootPlans, ...analysisPlans];
    }
    if (!out.ai_full_analysis) {
      const first = entries[0] || {};
      out.symbol = String(first?.symbol || out?.symbol || "").trim();
      out.ai_full_analysis = {
        htf_context: Array.isArray(first?.htf_context) ? first.htf_context : [],
        ltf_analysis: Array.isArray(first?.ltf_analysis)
          ? first.ltf_analysis
          : [],
        confluence_checklist:
          first?.confluence_checklist &&
          typeof first.confluence_checklist === "object"
            ? first.confluence_checklist
            : {},
      };
    }
  }
  // Alternate schema variant: symbols[] with per-symbol trade_plan
  if (Array.isArray(out.symbols) && out.symbols.length > 0) {
    const entries = out.symbols.filter((x) => x && typeof x === "object");
    const symbolPlans = entries.flatMap((e) =>
      Array.isArray(e.trade_plan)
        ? e.trade_plan.map((p) => ({
            ...(p || {}),
            symbol: String(p?.symbol || e?.symbol || "").trim(),
          }))
        : [],
    );
    if (symbolPlans.length) {
      const rootPlans = Array.isArray(out.trade_plan)
        ? out.trade_plan
            .filter((p) => p && typeof p === "object")
            .map((p) => ({ ...(p || {}) }))
        : [];
      out.trade_plan = [...rootPlans, ...symbolPlans];
    }
    if (!out.ai_full_analysis) {
      const first = entries[0] || {};
      out.symbol = String(first?.symbol || out?.symbol || "").trim();
      out.ai_full_analysis = {
        htf_context: Array.isArray(first?.htf_context) ? first.htf_context : [],
        ltf_analysis: Array.isArray(first?.ltf_analysis)
          ? first.ltf_analysis
          : [],
        confluence_checklist:
          first?.confluence_checklist &&
          typeof first.confluence_checklist === "object"
            ? first.confluence_checklist
            : {},
      };
    }
  }
  // NEW schema (v2.6): analysis_data[] root
  if (Array.isArray(out.analysis_data) && out.analysis_data.length > 0) {
    const entries = out.analysis_data.filter((x) => x && typeof x === "object");
    const nestedPlans = entries.flatMap((e) =>
      Array.isArray(e.trade_plan)
        ? e.trade_plan.map((p) => ({
            ...(p || {}),
            symbol: String(p?.symbol || e?.symbol || "").trim(),
          }))
        : [],
    );
    const rootPlans = Array.isArray(out.trade_plan)
      ? out.trade_plan
          .filter((p) => p && typeof p === "object")
          .map((p) => ({ ...(p || {}) }))
      : [];
    const first = entries[0] || {};
    const mtf =
      first?.multi_timeframes_analysis &&
      typeof first.multi_timeframes_analysis === "object"
        ? first.multi_timeframes_analysis
        : {};
    out.symbol = String(first?.symbol || out?.symbol || "").trim();
    out.ai_full_analysis = mtf;
    // Keep root trade_plan too. Some providers put plans at root, not per analysis_data item.
    out.trade_plan = [...rootPlans, ...nestedPlans];
  }

  // BARE trade_plan: AI returned trade_plan directly (no ai_full_analysis wrapper)
  // Normalize old field names → legacy market_analysis format
  if (
    !out.ai_full_analysis &&
    Array.isArray(out.trade_plan) &&
    !out.market_analysis
  ) {
    out.trade_plan = out.trade_plan.map((x) => ({
      symbol: String(x?.symbol || out?.symbol || "").trim(),
      direction: x?.direction || x?.dir || "",
      profile: x?.profile || "",
      type: x?.order_type || x?.type || "",
      session_entry: x?.session || "",
      strategy: x?.strategy || "",
      entry_model: x?.entry_model || "",
      entry: x?.entry_price ?? x?.entry ?? null,
      sl: x?.stop_loss ?? x?.sl ?? null,
      be_trigger: x?.breakeven_trigger ?? x?.be ?? null,
      tp: resolvePlanTakeProfit(x),
      tp2:
        planTakeProfitValue(planTakeProfitsRaw(x)[1]) ??
        x?.multiple_exits?.tp2?.price ??
        x?.tp2 ??
        null,
      tp3:
        planTakeProfitValue(planTakeProfitsRaw(x)[2]) ??
        x?.multiple_exits?.full_tp?.price ??
        x?.tp3 ??
        null,
      estimated_bars: x?.estimated_candles_to_tp1 ?? x?.estimated_bars ?? null,
      rr: x?.risk_reward ?? x?.rr ?? null,
      risk_pct: x?.risk_percent ?? x?.risk_pct ?? null,
      partial_tps: planPartialTps(x),
      confidence_pct:
        x?.confidence_pct ?? confidenceLevelToPct(x?.confidence_level),
      skip_recommendation: planDecisionText(x),
      reasons_to_skip: planSkipReasons(x),
      entry_condition:
        x?.entry_trigger || x?.position_management?.entry_trigger || "",
      exit_condition:
        x?.mid_trade_invalidation ||
        x?.position_management?.mid_trade_invalidation ||
        "",
      invalidation:
        x?.pre_entry_invalidation ||
        x?.position_management?.pre_entry_invalidation ||
        "",
      note: x?.note || "",
    }));
    return enforceActionableTradePlans(out);
  }

  // NEW schema (v2.2): ai_full_analysis wrapper
  if (out.ai_full_analysis && typeof out.ai_full_analysis === "object") {
    const a = out.ai_full_analysis;
    // Flatten HTF + LTF timeframes
    const htfTfs = Array.isArray(a.htf_context) ? a.htf_context : [];
    const ltfTfs = Array.isArray(a.ltf_analysis) ? a.ltf_analysis : [];
    const allTfs = [...htfTfs, ...ltfTfs];
    // Merge PD arrays and key levels from LTF only
    const pdArrays = ltfTfs.flatMap((t) =>
      Array.isArray(t.pd_arrays)
        ? t.pd_arrays.map((p) => ({ ...p, timeframe: t.timeframe }))
        : [],
    );
    const keyLevels = ltfTfs.flatMap((t) =>
      Array.isArray(t.key_levels) ? t.key_levels : [],
    );
    // HTF reference zones → key levels with type prefix
    const htfZones = htfTfs.flatMap((t) =>
      Array.isArray(t.reference_zones)
        ? t.reference_zones.map((z) => ({
            ...z,
            name: `HTF_${z.type}_${z.id || ""}`,
            zone_type: z.type,
          }))
        : [],
    );
    const allKeyLevels = [...keyLevels, ...htfZones];
    // First HTF DOL
    const dol =
      htfTfs.find((t) => t.draw_on_liquidity?.target_price)
        ?.draw_on_liquidity || null;

    out.market_analysis = {
      timeframes: allTfs.map((t) => ({
        tf: t.timeframe || "",
        trend: t.trend || "",
        structure: t.structure || "",
        market_phase: t.phase || "",
        bias: t.bias || "",
        poi_alignment: Boolean(t.poi_aligned),
        price_action_summary: {
          recent_move: t.what_price_just_did || "",
          key_breaks: (Array.isArray(t.key_events) ? t.key_events : []).map(
            (e) => ({
              event: e.event || "",
              price_level: e.price,
              direction:
                e.direction === "Bull"
                  ? "Bullish"
                  : e.direction === "Bear"
                    ? "Bearish"
                    : e.direction || "",
            }),
          ),
        },
        price_prediction: {
          narrative: t.what_price_likely_does_next || "",
          expected_path: (Array.isArray(t.expected_path)
            ? t.expected_path
            : []
          ).map((p) => ({
            step: p.step,
            action: p.action || "",
            target_price: p.target_price,
            condition: p.required_condition || "",
          })),
        },
      })),
      pd_arrays: pdArrays.map((p) => ({
        id: p.id,
        type: p.type || "",
        direction:
          p.direction === "Bull"
            ? "Bullish"
            : p.direction === "Bear"
              ? "Bearish"
              : p.direction || "",
        strength: p.strength || "",
        price_top: p.zone_top,
        price_bottom: p.zone_bottom,
        status: p.status || "",
        touched: p.times_touched || 0,
        timeframe: p.timeframe || "",
        note: p.note || "",
      })),
      key_levels: allKeyLevels.map((k) => ({
        name: k.name || "",
        price: k.price,
        type: k.zone_type || k.type || "",
        swept: Boolean(k.already_swept),
      })),
      institutional_filters: {
        draw_on_liquidity: {
          target: dol?.narrative || "",
          price: dol?.target_price,
          type: dol?.target_type || "",
        },
      },
      confluence_checklist: {
        buy: {
          items: (Array.isArray(a.confluence_checklist?.buy?.passed_items)
            ? a.confluence_checklist.buy.passed_items
            : []
          ).map((c) => ({
            category: c.category || "",
            item: c.description || "",
            weight: c.weight || "",
            checked: true,
            pd_array_ref: c.linked_array_id || null,
          })),
          score: a.confluence_checklist?.buy?.weighted_score ?? 0,
          total: 100,
          high_weight_passed:
            a.confluence_checklist?.buy?.high_weight_passed ?? 0,
          high_weight_total:
            a.confluence_checklist?.buy?.high_weight_total ?? 0,
        },
        sell: {
          items: (Array.isArray(a.confluence_checklist?.sell?.passed_items)
            ? a.confluence_checklist.sell.passed_items
            : []
          ).map((c) => ({
            category: c.category || "",
            item: c.description || "",
            weight: c.weight || "",
            checked: true,
            pd_array_ref: c.linked_array_id || null,
          })),
          score: a.confluence_checklist?.sell?.weighted_score ?? 0,
          total: 100,
          high_weight_passed:
            a.confluence_checklist?.sell?.high_weight_passed ?? 0,
          high_weight_total:
            a.confluence_checklist?.sell?.high_weight_total ?? 0,
        },
      },
    };

    // Normalize trade_plan
    if (!out.trade_plan && Array.isArray(out.tradePlan)) {
      out.trade_plan = out.tradePlan;
    }
    if (Array.isArray(out.trade_plan)) {
      out.trade_plan = out.trade_plan.map((x) => ({
        symbol: String(x?.symbol || out?.symbol || "").trim(),
        direction: x?.direction || x?.dir || "",
        profile: x?.profile || "",
        type: x?.order_type || x?.type || "",
        session_entry: x?.session || "",
        strategy: x?.strategy || "",
        entry_model: x?.entry_model || "",
        entry: x?.entry_price ?? x?.entry ?? null,
        sl: x?.stop_loss ?? x?.sl ?? null,
        be_trigger: x?.breakeven_trigger ?? x?.be ?? null,
        tp: resolvePlanTakeProfit(x),
        tp2:
          planTakeProfitValue(planTakeProfitsRaw(x)[1]) ??
          x?.multiple_exits?.tp2?.price ??
          x?.tp2 ??
          null,
        tp3:
          planTakeProfitValue(planTakeProfitsRaw(x)[2]) ??
          x?.multiple_exits?.full_tp?.price ??
          x?.tp3 ??
          null,
        estimated_bars:
          x?.estimated_candles_to_tp1 ?? x?.estimated_bars ?? null,
        risk_pct: x?.risk_percent ?? x?.risk_pct ?? null,
        rr: x?.risk_reward ?? x?.rr ?? null,
        partial_tps: planPartialTps(x),
        confluence_checklist: Array.isArray(x?.confluence_checklist)
          ? x.confluence_checklist
          : [],
        reasons_to_skip: planSkipReasons(x),
        skip_recommendation: planDecisionText(x),
        entry_condition:
          x?.entry_trigger || x?.position_management?.entry_trigger || "",
        exit_condition:
          x?.mid_trade_invalidation ||
          x?.position_management?.mid_trade_invalidation ||
          "",
        risk_management:
          x?.grade === "A" ? "normal" : x?.grade === "B" ? "low" : "high",
        invalidation:
          x?.pre_entry_invalidation ||
          x?.position_management?.pre_entry_invalidation ||
          "",
        confidence_pct:
          x?.confidence_pct ??
          x?.confluence_score ??
          confidenceLevelToPct(x?.confidence_level),
        note: x?.note || "",
      }));
    }

    // Remove raw wrapper to avoid duplication
    delete out.ai_full_analysis;
    return enforceActionableTradePlans(out);
  }

  // OLD schema (flat format)
  if (
    !out.market_analysis &&
    (Array.isArray(out.timeframes) ||
      Array.isArray(out.pdArrays) ||
      Array.isArray(out.keyLevels) ||
      out.checklist ||
      out.dol)
  ) {
    out.market_analysis = {
      timeframes: (Array.isArray(out.timeframes) ? out.timeframes : []).map(
        (x) => ({
          tf: x?.tf ?? "",
          trend: x?.trend ?? "",
          structure: x?.structure ?? "",
          market_phase: x?.phase ?? x?.market_phase ?? "",
          bias: x?.bias ?? "",
          poi_alignment: Boolean(x?.poiAlign ?? x?.poi_alignment),
          price_action_summary: {
            recent_move: String(
              x?.did ?? x?.price_action_summary?.recent_move ?? "",
            ),
            key_breaks: (Array.isArray(x?.keyBreaks)
              ? x.keyBreaks
              : x?.price_action_summary?.key_breaks || []
            ).map((b) => ({
              event: b?.event ?? "",
              price_level: b?.price ?? b?.price_level ?? null,
              direction:
                b?.direction === "Bull"
                  ? "Bullish"
                  : b?.direction === "Bear"
                    ? "Bearish"
                    : (b?.direction ?? ""),
              bar_ref: b?.bar_ref ?? null,
            })),
          },
          price_prediction: {
            narrative: String(x?.next ?? x?.price_prediction?.narrative ?? ""),
            expected_path: (Array.isArray(x?.path)
              ? x.path
              : x?.price_prediction?.expected_path || []
            ).map((p) => ({
              step: p?.step ?? null,
              action: p?.action ?? "",
              target_price: p?.target ?? p?.target_price ?? null,
              condition: p?.condition ?? "",
            })),
          },
          note: x?.note ?? "",
        }),
      ),
      pd_arrays: (Array.isArray(out.pdArrays) ? out.pdArrays : []).map((x) => ({
        id: x?.id ?? null,
        type: x?.type ?? "",
        direction:
          x?.dir === "Bull"
            ? "Bullish"
            : x?.dir === "Bear"
              ? "Bearish"
              : (x?.direction ?? ""),
        strength: x?.strength ?? "",
        bar_start: x?.bar_start ?? null,
        price_top: x?.top ?? x?.price_top ?? null,
        price_bottom: x?.bot ?? x?.price_bottom ?? null,
        status: x?.status ?? "",
        touched: x?.touched ?? 0,
        mitigation_type: x?.mitigation_type ?? "",
        timeframe: x?.tf ?? x?.timeframe ?? "",
        note: x?.note ?? "",
      })),
      key_levels: (Array.isArray(out.keyLevels) ? out.keyLevels : []).map(
        (x) => ({
          name: x?.name ?? "",
          price: x?.price ?? null,
          type: x?.type ?? "",
          zone_type: x?.zone_type ?? "",
          swept: Boolean(x?.swept),
          bar_start: x?.bar_start ?? null,
        }),
      ),
      institutional_filters: {
        draw_on_liquidity: {
          target: out.dol?.target ?? "",
          price: out.dol?.price ?? null,
          type: out.dol?.type ?? "",
          timeframe: out.dol?.tf ?? "",
        },
      },
      confluence_checklist: {
        buy: (Array.isArray(out.checklist?.buy?.items)
          ? out.checklist.buy.items
          : []
        ).map((x) => ({
          category: x?.category ?? "",
          item: x?.item ?? "",
          weight: x?.weight ?? "",
          checked: Boolean(x?.passed ?? x?.checked),
          pd_array_ref: x?.pdRef ?? x?.pd_array_ref ?? null,
          note: x?.note ?? "",
        })),
        sell: (Array.isArray(out.checklist?.sell?.items)
          ? out.checklist.sell.items
          : []
        ).map((x) => ({
          category: x?.category ?? "",
          item: x?.item ?? "",
          weight: x?.weight ?? "",
          checked: Boolean(x?.passed ?? x?.checked),
          pd_array_ref: x?.pdRef ?? x?.pd_array_ref ?? null,
          note: x?.note ?? "",
        })),
        buy_score: {
          checked: out.checklist?.buy?.score ?? 0,
          total: 100,
          high_weight_passed: out.checklist?.buy?.highPassed ?? 0,
          high_weight_total: out.checklist?.buy?.highTotal ?? 0,
        },
        sell_score: {
          checked: out.checklist?.sell?.score ?? 0,
          total: 100,
          high_weight_passed: out.checklist?.sell?.highPassed ?? 0,
          high_weight_total: out.checklist?.sell?.highTotal ?? 0,
        },
      },
    };
  }

  // Catch-all: normalize raw trade_plan if it still has schema-native field names
  // (e.g. Claude 3.5 Sonnet returns entry_price/stop_loss/take_profits from schema)
  if (Array.isArray(out.trade_plan) && out.trade_plan.length > 0) {
    const first = out.trade_plan[0];
    if (
      first?.entry_price !== undefined ||
      first?.stop_loss !== undefined ||
      first?.take_profits !== undefined ||
      first?.take_profit !== undefined ||
      first?.multiple_exits !== undefined
    ) {
      out.trade_plan = out.trade_plan.map((x) => ({
        symbol: String(x?.symbol || out?.symbol || "").trim(),
        direction: x?.direction || x?.dir || "",
        profile: x?.profile || "",
        type: x?.order_type || x?.type || "limit",
        session_entry: x?.session || "",
        strategy: x?.strategy || "",
        entry_model: x?.entry_model || "",
        entry: x?.entry_price ?? x?.entry ?? null,
        sl: x?.stop_loss ?? x?.sl ?? null,
        tp: resolvePlanTakeProfit(x),
        tp2:
          planTakeProfitValue(planTakeProfitsRaw(x)[1]) ??
          x?.multiple_exits?.tp2?.price ??
          x?.tp2 ??
          null,
        tp3:
          planTakeProfitValue(planTakeProfitsRaw(x)[2]) ??
          x?.multiple_exits?.full_tp?.price ??
          x?.tp3 ??
          null,
        estimated_bars:
          x?.estimated_candles_to_tp1 ?? x?.estimated_bars ?? null,
        rr: x?.risk_reward ?? x?.rr ?? null,
        risk_pct: x?.risk_percent ?? x?.risk_pct ?? null,
        partial_tps: planPartialTps(x),
        confidence_pct:
          x?.confidence_pct ?? confidenceLevelToPct(x?.confidence_level),
        skip_recommendation: planDecisionText(x),
        reasons_to_skip: planSkipReasons(x),
        entry_condition:
          x?.entry_trigger || x?.position_management?.entry_trigger || "",
        exit_condition:
          x?.mid_trade_invalidation ||
          x?.position_management?.mid_trade_invalidation ||
          "",
        invalidation:
          x?.pre_entry_invalidation ||
          x?.position_management?.pre_entry_invalidation ||
          "",
        note: x?.note || "",
        risk_management: x?.risk_management || "",
      }));
    }
  }

  if (!out.trade_plan && out.tradePlan) {
    const tradePlans = Array.isArray(out.tradePlan)
      ? out.tradePlan
      : out.tradePlan && typeof out.tradePlan === "object"
        ? [out.tradePlan]
        : [];
    out.trade_plan = tradePlans.map((x) => ({
      symbol: String(x?.symbol || out?.symbol || "").trim(),
      direction: x?.direction ?? x?.dir ?? "",
      profile: x?.profile ?? "",
      type: x?.type ?? "",
      session_entry: x?.session ?? "",
      strategy: x?.strategy ?? "",
      entry_model: x?.entry_model ?? x?.model ?? "",
      entry: x?.entry ?? null,
      sl: x?.sl ?? null,
      be_trigger: x?.be ?? null,
      tp:
        resolvePlanTakeProfit(x) ??
        (Array.isArray(x?.tps) && x.tps[2]
          ? (x.tps[2].price ?? null)
          : Array.isArray(x?.tps) && x.tps.length
            ? (x.tps[x.tps.length - 1]?.price ?? null)
            : null),
      tp2:
        x?.tp2 ??
        (Array.isArray(x?.tps) && x.tps[1] ? (x.tps[1].price ?? null) : null),
      tp3:
        x?.tp3 ??
        (Array.isArray(x?.tps) && x.tps[2] ? (x.tps[2].price ?? null) : null),
      estimated_bars: x?.estimated_bars ?? null,
      risk_pct: x?.riskPct ?? x?.risk_pct ?? null,
      rr: x?.rr ?? null,
      partial_tps: (Array.isArray(x?.tps) ? x.tps : []).map((t) => ({
        price: t?.price ?? null,
        size_pct: t?.pct ?? null,
        rr: t?.rr ?? null,
      })),
      confluence_checklist: Array.isArray(x?.confluence_checklist)
        ? x.confluence_checklist
        : [],
      reasons_to_skip: (Array.isArray(x?.skipReasons)
        ? x.skipReasons
        : Array.isArray(x?.reasons_to_skip)
          ? x.reasons_to_skip
          : []
      ).map((r) => ({ reason: r?.reason ?? "", severity: r?.severity ?? "" })),
      skip_recommendation:
        x?.skip_recommendation ?? x?.skip ?? x?.action?.recommendation ?? "",
      entry_condition: x?.action?.entry_condition ?? "",
      exit_condition: x?.action?.exit_condition ?? "",
      risk_management: x?.action?.risk_management ?? "",
      invalidation: x?.invalidation ?? out.verdict?.invalidation ?? "",
      confidence_pct: x?.confidence_pct ?? x?.confidence ?? null,
      note: x?.note ?? "",
    }));
  }

  if (!out.final_verdict && out.verdict && typeof out.verdict === "object") {
    out.final_verdict = {
      action: out.verdict.action ?? "",
      risk_tier: out.verdict.tier ?? "",
      confidence: out.verdict.confidence ?? 0,
      bias_shift_invalidation: out.verdict.invalidation ?? "",
      next_poi: {
        price: out.verdict.nextPoi?.price ?? null,
        timeframe: out.verdict.nextPoi?.tf ?? "",
        type: out.verdict.nextPoi?.type ?? "",
      },
      note: out.verdict.note ?? "",
    };
  }
  if (Array.isArray(out.trade_plan)) {
    out.trade_plan = dedupeTradePlans(out.trade_plan);
  }
  return enforceActionableTradePlans(out);
}

function parseSnapshotBarsLimit(payload = {}) {
  const n = Number(
    payload.lookbackBars ?? payload.lookback_bars ?? payload.bars ?? 300,
  );
  if (!Number.isFinite(n)) return 300;
  return Math.max(50, Math.min(1000, Math.round(n)));
}

function parseTimeToUnixSec(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  let ms = Date.parse(s);
  if (!Number.isFinite(ms)) {
    ms = Date.parse(s.replace(" ", "T") + "Z");
  }
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

async function loadUserApiKeysMap(userId) {
  const db = await mt5InitBackend();
  const out = {};
  const rows = await dbQueries.listUserSettingsByType(db.db, userId, "api_key");
  for (const row of rows || []) {
    const name = normalizeAiApiKeyName(row?.name);
    const dec = decryptObject(
      row?.data && typeof row.data === "object" ? row.data : {},
    );
    if (ALLOWED_AI_API_KEY_NAMES.has(name)) {
      // New provider schema: { models, api_key, remain_credits }
      if (dec?.api_key) {
        out[name] = String(dec.api_key || "");
      } else if (dec?.value) {
        // Legacy format: { value: "sk-xxx" }
        out[name] = String(dec.value || "");
      }
    }
    if (dec && typeof dec === "object") {
      Object.assign(out, dec);
    }
  }
  return out;
}

// ── Provider schema migration ──
async function migrateProviderSchema() {
  try {
    const db = await mt5InitBackend();
    const { and, eq } = require("drizzle-orm");
    const rows = await dbQueries.listUserSettingsByType(db.db, null, "api_key");
    const filtered = (rows || []).filter((r) => {
      const d = dbQueries.parseJsonField(r.data) || {};
      return !d.api_key;
    });
    let migrated = 0;
    for (const row of filtered) {
      const parsed = dbQueries.parseJsonField(row.data) || {};
      const dec = decryptObject(parsed);
      const oldKey = String(dec?.value || dec?.api_key || "").trim();
      const newData = {
        models: Array.isArray(dec?.models) ? dec.models : [],
        api_key: oldKey,
        remain_credits: Number.isFinite(Number(dec?.remain_credits))
          ? Number(dec.remain_credits)
          : 0,
      };
      const enc = encryptObject(newData);
      await db.db
        .update(db.schema.userSettings)
        .set({ data: dbQueries.jsonField(enc), updatedAt: new Date() })
        .where(
          and(
            eq(db.schema.userSettings.userId, row.userId),
            eq(db.schema.userSettings.type, "api_key"),
            eq(db.schema.userSettings.name, row.name),
          ),
        );
      migrated++;
    }
    if (migrated > 0) {
      console.log(
        `[Migration] Provider schema: migrated ${migrated} api_key settings to new format`,
      );
    }
  } catch (err) {
    console.warn("[Migration] Provider schema migration failed:", err.message);
  }
}

function isCryptoPair(symbol) {
  const s = String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  // Common crypto base assets
  const cryptoBases = [
    "BTC",
    "ETH",
    "SOL",
    "BNB",
    "XRP",
    "ADA",
    "DOGE",
    "DOT",
    "MATIC",
    "LTC",
    "LINK",
    "UNI",
    "AVAX",
    "ATOM",
    "ETC",
    "FIL",
    "APT",
    "ARB",
    "OP",
    "NEAR",
    "PEPE",
    "SUI",
    "SEI",
    "TIA",
    "WIF",
    "BONK",
  ];
  for (const base of cryptoBases) {
    if (s.startsWith(base) && (s.endsWith("USD") || s.endsWith("USDT"))) {
      return { base: base, quote: s.slice(base.length) };
    }
  }
  return null;
}

function timeframeToBinance(tf) {
  const t = String(tf || "")
    .trim()
    .toLowerCase();
  const map = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "4h": "4h",
    "1d": "1d",
    "1w": "1w",
    "1month": "1M",
    "1mo": "1M",
    "1min": "1m",
    "5min": "5m",
    "15min": "15m",
    "30min": "30m",
    "1day": "1d",
    "1week": "1w",
  };
  return map[t] || "15m";
}

function binanceKlineToBar(k) {
  return {
    time: Math.floor(Number(k[0]) / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  };
}

async function fetchBinanceBars(symbolNorm, tfNorm, bars) {
  const pair = isCryptoPair(symbolNorm);
  if (!pair) return null;
  const binanceSymbol =
    pair.base + (pair.quote === "USD" ? "USDT" : pair.quote);
  const interval = timeframeToBinance(tfNorm);
  const limit = Math.max(50, Math.min(bars || 300, 1000));
  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`;
  console.log(
    `[binance] FETCH sym=${binanceSymbol} interval=${interval} limit=${limit}`,
  );
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
    const raw = await res.json();
    if (!Array.isArray(raw) || !raw.length)
      throw new Error("Binance empty response");
    const bars = raw
      .map(binanceKlineToBar)
      .filter((b) => Number.isFinite(b.time));
    console.log(`[binance] OK sym=${binanceSymbol} bars=${bars.length}`);
    trackSourceActivity("binance", true);
    return {
      provider: "binance",
      status: "ok",
      symbol: symbolNorm,
      symbol_norm: symbolNorm,
      timeframe: tfNorm,
      tf_norm: tfNorm,
      bars,
      bar_start: bars[0]?.time || null,
      bar_end: bars[bars.length - 1]?.time || null,
      last_price: bars[bars.length - 1]?.close || null,
      cache_source: "binance",
      api_url: url,
      api_interval: interval,
    };
  } catch (e) {
    console.warn(`[binance] FAIL sym=${binanceSymbol}: ${e.message}`);
    trackSourceActivity("binance", false);
    return null;
  }
}

// Merge live last_price into last bar's close for TV chart real-time display
function mergeLastPriceIntoBars(result) {
  if (!result || !Array.isArray(result.bars) || !result.bars.length)
    return result;
  const lp = Number(result.last_price);
  if (!Number.isFinite(lp) || lp <= 0) return result;
  const lastBar = result.bars[result.bars.length - 1];
  if (!lastBar || typeof lastBar !== "object") return result;
  const barTime = Number(lastBar.time);
  const lpTime = result.last_price_at
    ? Math.floor(new Date(result.last_price_at).getTime() / 1000)
    : 0;
  if (lpTime > 0 && lpTime < barTime) return result;
  const updated = { ...lastBar, close: lp };
  if (lp > (Number(lastBar.high) || 0)) updated.high = lp;
  if (lp < (Number(lastBar.low) || Infinity)) updated.low = lp;
  return { ...result, bars: [...result.bars.slice(0, -1), updated] };
}

async function buildAnalysisSnapshotFromTwelve({
  userId,
  payload = {},
  symbol,
  timeframe,
  traceId,
}) {
  const outputsize = parseSnapshotBarsLimit(payload);
  const forceRefresh = asBool(
    payload?.force_refresh ?? payload?.forceRefresh ?? false,
    false,
  );
  const symbolNorm = normalizeMarketDataSymbol(symbol);
  const tfNorm = normalizeMarketDataTf(timeframe);
  const reqRange = estimateRequestedBarsRange({ tfNorm, bars: outputsize });

  // Prefer locally persisted broker bars when available (market_data/{SYMBOL}/bars/{TF}.csv)
  // so static charts can render from broker-fed data without external API dependency.
  // BUT: on force refresh, skip broker CSV and go through full API pipeline to get fresh data.
  if (!forceRefresh) {
    const brokerBars = readBrokerBarsFromCsv(symbolNorm, tfNorm, outputsize);
    if (brokerBars.length) {
      const barStart = brokerBars[0]?.time || null;
      const barEnd = brokerBars.length
        ? Number(brokerBars[brokerBars.length - 1].time) +
          Math.max(60, parseTfTokenToSeconds(tfNorm))
        : null;
      const brokerSnapshot = {
        provider: "broker_csv",
        status: "ok",
        timezone: "UTC",
        symbol: String(symbol || "").toUpperCase(),
        symbol_norm: symbolNorm,
        timeframe: String(timeframe || ""),
        tf_norm: tfNorm,
        fetched_at: new Date().toISOString(),
        bar_start: barStart,
        bar_end: barEnd,
        last_price: brokerBars.length
          ? brokerBars[brokerBars.length - 1].close
          : null,
        last_price_at: brokerBars.length
          ? new Date(
              Number(brokerBars[brokerBars.length - 1].time) * 1000,
            ).toISOString()
          : null,
        bars: brokerBars,
        cache_source: "broker_csv",
        gap_candidates: detectMarketDataGapCandidates(brokerBars, tfNorm).slice(
          0,
          20,
        ),
      };
      tfCacheSet(symbolNorm, tfNorm, brokerSnapshot);
      await marketDataFileUpsert(symbolNorm, tfNorm, brokerSnapshot).catch(
        () => {},
      );
      return mergeLastPriceIntoBars(brokerSnapshot);
    }
  }

  const tid = traceId || genTraceId("twelve_");
  console.log(
    `[twelve] START sym=${symbolNorm} tf=${tfNorm} force=${forceRefresh}`,
  );
  if (!symbolNorm)
    return {
      provider: "twelvedata",
      status: "skipped",
      reason: "invalid symbol",
    };

  if (!forceRefresh) {
    // Check per-TF memory cache (TTL = TF duration)
    const cached = await tfCacheGet(symbolNorm, tfNorm);
    if (cached && cached.bars && cached.bars.length) {
      const s = Number(cached.bar_start || cached.bars[0].time);
      const e = Number(
        cached.bar_end || cached.bars[cached.bars.length - 1].time,
      );
      if (s <= reqRange.start && e >= reqRange.end) {
        return mergeLastPriceIntoBars({
          ...cached,
          symbol: symbolNorm,
          symbol_norm: symbolNorm,
          timeframe: tfNorm,
          tf_norm: tfNorm,
          bar_start: s,
          bar_end: e,
          status: "ok",
          cache_source: "memory",
        });
      }
    }
    // Fallback to CSV files
    console.log(`[twelve] FILE_READ sym=${symbolNorm} tf=${tfNorm}`);
    const dbHit = await marketDataFileRead(
      symbolNorm,
      tfNorm,
      reqRange.start,
      reqRange.end,
    ).catch((e) => {
      console.error(`[twelve] FILE_ERROR: ${e.message}`);
      return null;
    });

    if (dbHit && Array.isArray(dbHit.bars) && dbHit.bars.length) {
      tfCacheSet(symbolNorm, tfNorm, dbHit);
      return mergeLastPriceIntoBars({
        ...dbHit,
        cache_source: "db",
        symbol_norm: symbolNorm,
        tf_norm: tfNorm,
      });
    }
  }

  // Crypto symbols: use Binance free API instead of Twelve Data
  const binanceResult = await fetchBinanceBars(symbolNorm, tfNorm, outputsize);
  if (binanceResult) {
    if (notificationManager) {
      notificationManager.handle("REMOTE_API_CALL", "binance_success", {
        message: `Binance OK ${symbolNorm} ${tfNorm} ${binanceResult.bars.length} bars`,
        api: "Binance",
        symbol: symbolNorm,
        tf: tfNorm,
        bars_count: binanceResult.bars.length,
      });
    }
    tfCacheSet(symbolNorm, tfNorm, binanceResult);
    await marketDataFileUpsert(symbolNorm, tfNorm, binanceResult).catch(
      () => {},
    );
    return mergeLastPriceIntoBars(binanceResult);
  }

  const keys = await loadUserApiKeysMap(userId).catch(() => ({}));
  const twelveKey = String(
    keys.TWELVE_DATA_API_KEY || CFG.twelveDataApiKey || "",
  ).trim();
  if (!twelveKey)
    return {
      provider: "twelvedata",
      status: "skipped",
      reason: "TWELVE_DATA_API_KEY missing",
    };

  trackApiCall("TwelveData");

  const tvCandidates = await resolveTwelveSymbol(symbol, twelveKey);
  if (!tvCandidates || !tvCandidates.length)
    return {
      provider: "twelvedata",
      status: "skipped",
      reason: "invalid symbol",
    };
  const interval = timeframeToTwelve(timeframe);
  const primaryCandidates = [...tvCandidates];
  const rawNoProvider = String(symbol || "")
    .trim()
    .toUpperCase()
    .includes(":")
    ? String(symbol || "")
        .trim()
        .toUpperCase()
        .split(":")
        .slice(1)
        .join(":")
        .trim()
        .toUpperCase()
    : String(symbol || "")
        .trim()
        .toUpperCase();
  const normalizedFallback = normalizeSymbolForTwelve(rawNoProvider);
  if (normalizedFallback && !primaryCandidates.includes(normalizedFallback))
    primaryCandidates.push(normalizedFallback);
  const compactFallback = rawNoProvider.replace(/[^A-Z0-9]/g, "");
  if (compactFallback && !primaryCandidates.includes(compactFallback))
    primaryCandidates.push(compactFallback);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 14000);
  try {
    let data = {};
    let usedSymbol = symbol;
    let lastError = "";
    console.log(
      `[twelve-fetch] symbol=${symbol} candidates=${primaryCandidates.join(",")} interval=${interval} bars=${outputsize}`,
    );

    const t0 = Date.now();
    for (const candidate of primaryCandidates) {
      const endpoint = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(candidate)}&interval=${encodeURIComponent(interval)}&outputsize=${outputsize}&timezone=UTC&order=ASC&apikey=${encodeURIComponent(twelveKey)}`;
      const res = await fetch(endpoint, { signal: ctrl.signal });
      const txt = await res.text();
      let parsed = {};
      try {
        parsed = JSON.parse(txt);
      } catch {}

      if (!res.ok) {
        lastError = `http_${res.status}: ${txt.slice(0, 100)}`;
        console.warn(
          `[twelve-candidate-fail] candidate=${candidate} error=${lastError}`,
        );
        continue;
      }
      if (String(parsed?.status || "").toLowerCase() === "error") {
        lastError = String(parsed?.message || "provider error");
        console.warn(
          `[twelve-candidate-error] candidate=${candidate} msg=${lastError}`,
        );
        continue;
      }
      const vals = Array.isArray(parsed?.values) ? parsed.values : [];
      if (!vals.length) {
        lastError = "empty values";
        console.warn(`[twelve-candidate-empty] candidate=${candidate}`);
        continue;
      }
      data = parsed;
      usedSymbol = candidate;
      lastError = "";
      console.log(`[twelve-success] candidate=${candidate}`);
      if (notificationManager) {
        notificationManager.handle("REMOTE_API_CALL", "twelve_success", {
          message: `TwelveData OK ${symbolNorm} ${tfNorm} ${vals.length} bars`,
          api: "TwelveData",
          symbol: symbolNorm,
          tf: tfNorm,
          bars_count: vals.length,
        });
      }
      break;
    }
    if (!data || !Array.isArray(data?.values) || !data.values.length) {
      if (notificationManager) {
        notificationManager.handle("REMOTE_API_CALL", "twelve_error", {
          message: `TwelveData FAIL ${symbolNorm} ${tfNorm} ${lastError || "provider error"}`,
          api: "TwelveData",
          symbol: symbolNorm,
          tf: tfNorm,
          error: lastError,
        });
      }
      return {
        provider: "twelvedata",
        status: "error",
        reason: lastError || "provider error",
        tried_candidates: primaryCandidates,
      };
    }
    const values = Array.isArray(data?.values) ? data.values : [];
    const dedup = new Map();
    values
      .map((v) => {
        const t = parseTimeToUnixSec(v?.datetime);
        const o = Number(v?.open);
        const h = Number(v?.high);
        const l = Number(v?.low);
        const c = Number(v?.close);
        const volume = Number(v?.volume);
        if (
          !Number.isFinite(t) ||
          !Number.isFinite(o) ||
          !Number.isFinite(h) ||
          !Number.isFinite(l) ||
          !Number.isFinite(c)
        )
          return null;
        if (t > reqRange.end + reqRange.sec * 2) return null;
        const bar = { time: t, open: o, high: h, low: l, close: c };
        if (Number.isFinite(volume)) bar.volume = volume;
        return bar;
      })
      .filter(Boolean)
      .forEach((bar) => {
        dedup.set(bar.time, bar);
      });
    const bars = [...dedup.values()].sort((a, b) => a.time - b.time);
    const barStart = bars.length ? bars[0].time : null;
    const barEnd = bars.length
      ? bars[bars.length - 1].time + reqRange.sec
      : null;
    const snapshot = {
      provider: "twelvedata",
      status: "ok",
      timezone: "UTC",
      display_timezone: normalizeMarketDataTimezone(
        payload?.timezone || payload?.display_timezone,
      ),
      user_id: userId,
      setting_name: String(
        payload?.setting_name || payload?.settingName || "default",
      ),
      symbol: String(symbol || "").toUpperCase(),
      symbol_norm: symbolNorm,
      normalized_symbol: usedSymbol,
      timeframe: String(timeframe || ""),
      tf_norm: tfNorm,
      interval,
      fetched_at: new Date().toISOString(),
      bar_start: barStart,
      bar_end: barEnd,
      last_price: bars.length ? bars[bars.length - 1].close : null,
      last_price_at: bars.length
        ? new Date(Number(bars[bars.length - 1].time) * 1000).toISOString()
        : null,
      bars,
      gap_candidates: detectMarketDataGapCandidates(bars, tfNorm).slice(0, 20),
      entry: Number.isFinite(Number(payload?.entry ?? payload?.price))
        ? Number(payload?.entry ?? payload?.price)
        : null,
      sl: Number.isFinite(Number(payload?.sl)) ? Number(payload?.sl) : null,
      tp: Number.isFinite(Number(payload?.tp)) ? Number(payload?.tp) : null,
      pd_arrays: parseSnapshotPdArrays(payload),
      key_levels: parseSnapshotKeyLevels(payload),
      summary: {
        profile: String(payload?.profile || "").trim(),
        bias: String(payload?.market_analysis?.bias || "").trim(),
        trend: String(payload?.market_analysis?.trend || "").trim(),
        confidence_pct: Number.isFinite(Number(payload?.confidence_pct))
          ? Number(payload.confidence_pct)
          : null,
        invalidation: String(payload?.invalidation || "").trim(),
        note: String(payload?.trade_plan?.note || payload?.note || "").trim(),
      },
      checklist: parseSnapshotChecklist(payload),
    };

    // Update Unified Cache
    tfCacheSet(symbolNorm, tfNorm, snapshot);
    await marketDataFileUpsert(symbolNorm, tfNorm, snapshot).catch(() => {});
    return mergeLastPriceIntoBars(snapshot);
  } catch (error) {
    const reason =
      error?.name === "AbortError"
        ? "timeout"
        : String(error?.message || error || "fetch_failed");
    return { provider: "twelvedata", status: "error", reason };
  } finally {
    clearTimeout(timer);
  }
}

async function mt5EnqueueSignalFromPayload(payload, opts = {}) {
  const source = String(payload.source || opts.source || "tradingview");
  const eventType = String(opts.eventType || "QUEUED");
  const sourceId = mt5SlugId(source, "tradingview");

  const action = mt5NormalizeAction(payload);
  const symbol = mt5NormalizeSymbol(payload);
  const volume = mt5NormalizeVolume(payload);
  const orderType = mt5NormalizeOrderType(payload);
  const signalId = mt5GenerateTimeSid();
  const userId = envStr(
    payload.user_id ?? payload.userId ?? payload.user ?? CFG.mt5DefaultUserId,
    CFG.mt5DefaultUserId,
  );
  const rrPlanned = asNum(payload.rr ?? payload.risk_reward, null);
  const riskMoneyPlanned = asNum(
    payload.risk_money ?? payload.money_risk ?? payload.riskMoney,
    null,
  );
  const riskPctPlanned = asNum(
    payload.risk_pct ??
      payload.riskPct ??
      payload.risk_percent ??
      payload.riskPercent ??
      payload.vol ??
      payload.volume ??
      payload.lots ??
      payload.volume_pct ??
      payload.volumePct,
    null,
  );
  const signalTf = mt5TfToMinutes(
    payload.signal_tf ??
      payload.signalTf ??
      payload.sourceTf ??
      payload.timeframe ??
      payload.tf,
  );
  const chartTf = mt5TfToMinutes(
    payload.chart_tf ??
      payload.chartTf ??
      payload.chartTimeframe ??
      payload.chart_tf_period,
  );
  const rawJson = payload.raw_json || payload;
  const strategy =
    String(
      payload.strategy || rawJson?.strategy || opts.strategy || "",
    ).trim() || null;
  const derived = mt5DeriveEntryModelAndNote(payload, {
    fallbackModel: strategy || source || "MANUAL",
  });
  const entryModel = derived.entryModel;
  const note = derived.note;
  const onlySignal = Boolean(
    payload.only_signal ??
    payload.onlySignal ??
    payload.raw_json?.only_signal ??
    payload.raw_json?.onlySignal,
  );

  const plannedEntry = asNum(payload.entry ?? payload.price, NaN);
  const plannedSl = asNum(payload.sl, NaN);
  const plannedTp = asNum(payload.tp, NaN);
  const duplicate = await mt5FindDuplicateSignal({
    user_id: userId,
    symbol,
    entry: plannedEntry,
    sl: plannedSl,
    tp: plannedTp,
  });
  if (duplicate?.sid) {
    throw new Error("Already added");
  }
  const sessionPrefix = sanitizeSessionPrefix(
    payload.session_prefix ||
      payload.sessionPrefix ||
      rawJson?.session_prefix ||
      rawJson?.sessionPrefix ||
      "",
  );
  const sidBaseFromPayload = String(
    payload.sid ||
      payload.signal_id ||
      rawJson?.sid ||
      rawJson?.signal_id ||
      "",
  ).trim();
  const signalSid = sidBaseFromPayload
    ? normalizePublicSidBase(sidBaseFromPayload, "SIG")
    : mt5GenerateTimeSid();
  let rawJsonNormalized = {
    ...rawJson,
    session_prefix: sessionPrefix || undefined,
    order_type: orderType,
    entry_model:
      entryModel ||
      mt5NormalizeEntryModel(rawJson.entry_model ?? rawJson.entryModel ?? "", {
        fallback: source,
      }),
    entry_model_raw:
      derived.entryModelRaw ||
      mt5CollapseWhitespace(rawJson.entry_model ?? rawJson.entryModel ?? "") ||
      null,
  };

  const hasRisk =
    rawJsonNormalized.riskPct != null ||
    rawJsonNormalized.risk_pct != null ||
    rawJsonNormalized.volumePct != null ||
    rawJsonNormalized.volume_pct != null;
  if (!hasRisk) {
    rawJsonNormalized.riskPct = 1.0;
  }
  // Strip sensitive credentials before persisting to DB.
  delete rawJsonNormalized.apiKey;
  delete rawJsonNormalized.api_key;
  delete rawJsonNormalized.password;
  delete rawJsonNormalized.token;
  const upsertResult = await mt5UpsertSignal({
    signal_id: signalId,
    sid: signalSid,
    created_at: mt5NowIso(),
    user_id: userId,
    source,
    source_id: sourceId,
    symbol,
    side: mt5MapActionToSide(action),
    entry: plannedEntry,
    strategy: strategy,
    entry_model: entryModel || null,
    sl: payload.sl ?? null,
    tp: payload.tp ?? null,
    rr_planned: Number.isFinite(rrPlanned) ? rrPlanned : null,
    signal_tf: signalTf || null,
    chart_tf: chartTf || null,
    note,
    order_type: orderType,
    raw_json: rawJsonNormalized,
    status: "NEW",
  });

  if (upsertResult?.inserted) {
    // Sanitize event payload — never persist API keys to signal_events.
    const sanitizedPayload = { ...(payload.raw_json || payload) };
    delete sanitizedPayload.apiKey;
    delete sanitizedPayload.api_key;
    delete sanitizedPayload.password;
    delete sanitizedPayload.token;
    await mt5Log(
      signalId,
      "signals",
      { event_type: eventType, data: sanitizedPayload },
      userId,
    );

    if (CFG.mt5V2DualWriteEnabled && !onlySignal) {
      const sourceId = mt5SlugId(source, "tradingview");
      try {
        await mt5UpsertSourceV2({
          source_id: sourceId,
          name: source,
          kind: sourceId.includes("tv") ? "tv" : "api",
          auth_mode: "token",
          is_active: true,
          metadata: {
            migrated_from: "legacy_signal_ingest",
            signal_source: source,
          },
        });
        const fanout = await mt5FanoutSignalTradeV2({
          signal_id: signalId,
          source_id: sourceId,
          user_id: userId,
          entry_model: entryModel || null,
          signal_tf: signalTf || null,
          chart_tf: chartTf || null,
          symbol,
          action: mt5MapActionToSide(action),
          entry:
            Number.isFinite(plannedEntry) && plannedEntry > 0
              ? plannedEntry
              : null,
          sl: payload.sl ?? null,
          tp: payload.tp ?? null,
          volume: volume ?? null,
          rr_planned: Number.isFinite(rrPlanned) ? rrPlanned : null,
          risk_money_planned: Number.isFinite(riskMoneyPlanned)
            ? riskMoneyPlanned
            : null,
          risk_pct_planned: Number.isFinite(riskPctPlanned)
            ? riskPctPlanned
            : null,
          note: note || null,
          sid: signalSid,
          session_prefix: sessionPrefix || null,
          metadata: {
            event_type: eventType,
            order_type: orderType,
            signal_tf: signalTf || null,
            chart_tf: chartTf || null,
            provider: payload.provider || null,
            entry_model_raw: derived.entryModelRaw || null,
            session_prefix: sessionPrefix || null,
            analysis_snapshot:
              rawJsonNormalized?.analysis_snapshot &&
              typeof rawJsonNormalized.analysis_snapshot === "object"
                ? rawJsonNormalized.analysis_snapshot
                : null,
            raw_json: rawJsonNormalized,
          },
        });
        await mt5Log(
          signalId,
          "signals",
          {
            event: "FANOUT_COMPLETED",
            trades_created: fanout?.created || 0,
            account_ids: fanout?.account_ids || [],
          },
          userId,
        );
      } catch (error) {
        await mt5Log(
          signalId,
          "signals",
          {
            event: "FANOUT_FAILED",
            error: error instanceof Error ? error.message : String(error),
          },
          userId,
        );
      }
    } else if (onlySignal) {
      await mt5Log(
        signalId,
        "signals",
        { event: "FANOUT_SKIPPED_ONLY_SIGNAL" },
        userId,
      );
    }

    await StateRepo.del("SIGNALS_PENDING", "all");
    if (userId) await StateRepo.del("SIGNALS_PENDING", userId);
  }

  return {
    signal_id: signalId,
    action,
    symbol,
    status: upsertResult?.inserted ? "NEW" : "DUPLICATE",
  };
}

function mt5NormalizeUiSource(rawSource, fallback = "ui_manual") {
  const input = String(rawSource || "")
    .trim()
    .toLowerCase();
  if (!input) return fallback;
  if (input === "ai") return "ai_claude";
  if (input.startsWith("ai_")) return input;
  if (input === "ui" || input === "manual" || input === "ui_manual")
    return "ui_manual";
  return (
    input
      .replace(/[^a-z0-9_/-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || fallback
  );
}

function mt5NormalizeAckStatus(value) {
  const s = String(value || "")
    .trim()
    .toUpperCase();
  if (!s) throw new Error("status is required");
  const legacyToCurrent = {
    DONE: "PLACED",
    FAILED: "FAIL",
    PENDING: "PLACED",
    STARTED: "START",
    CANCELED: "CANCEL",
    CANCELLED: "CANCEL",
    CLOSED_TP: "TP",
    CLOSED_SL: "SL",
    CLOSED_MANUAL: "CANCEL",
    CLOSED: "PLACED",
  };
  const normalized = legacyToCurrent[s] || s;
  const allowed = [
    "FAIL",
    "START",
    "TP",
    "SL",
    "CANCEL",
    "EXPIRED",
    "PLACED",
    "SL_CHANGED",
    "PARTIAL_CLOSE",
  ];
  if (!allowed.includes(normalized)) {
    throw new Error(
      "status must be one of: FAIL, START, TP, SL, CANCEL, EXPIRED, PLACED, SL_CHANGED, PARTIAL_CLOSE",
    );
  }
  return normalized;
}

function mt5StatusToInternal(status) {
  return mt5NormalizeAckStatus(status);
}

function mt5CanonicalStoredStatus(value) {
  const s = String(value || "")
    .trim()
    .toUpperCase();
  if (!s) return "";
  const legacyToCurrent = {
    DONE: "PLACED",
    FAILED: "FAIL",
    CANCELED: "CANCEL",
    CANCELLED: "CANCEL",
    CLOSED_TP: "TP",
    CLOSED_SL: "SL",
    CLOSED_MANUAL: "CANCEL",
    OK: "PLACED",
  };
  return legacyToCurrent[s] || s;
}

function mt5TicketCandidates(raw = {}) {
  const out = [];
  const push = (value) => {
    const v = String(value ?? "").trim();
    if (v && !out.includes(v)) out.push(v);
  };
  push(raw.ticket);
  push(raw.ticket_number);
  push(raw.broker_trade_id);
  push(raw.position_ticket);
  push(raw.position_id);
  push(raw.broker_position_id);
  push(raw.deal_ticket);
  push(raw.deal_id);
  push(raw.broker_deal_id);
  push(raw.order_ticket);
  push(raw.order_id);
  push(raw.broker_order_id);
  return out;
}

function mt5CloseReasonFromSync(raw = {}) {
  const status = String(raw.status || raw.execution_status || "")
    .trim()
    .toUpperCase();
  // When status is generic CLOSED, use close_reason/reason for specificity (e.g. cTrader bridge sends close_reason=TP|SL|MANUAL_CLOSE)
  const s =
    status === "CLOSED" || !status
      ? String(raw.close_reason || raw.reason || status || "")
          .trim()
          .toUpperCase()
      : status;
  if (s === "TP" || s === "DEAL_REASON_TP") return "TP";
  if (
    s === "SL" ||
    s === "SO" ||
    s === "DEAL_REASON_SL" ||
    s === "DEAL_REASON_SO"
  )
    return "SL";
  if (
    [
      "CANCEL",
      "CANCELLED",
      "CLIENT",
      "MOBILE",
      "EXPERT",
      "MANUAL",
      "MANUAL_CLOSE",
      "DEAL_REASON_CLIENT",
      "DEAL_REASON_MOBILE",
      "DEAL_REASON_EXPERT",
    ].includes(s)
  )
    return "MANUAL";
  if (s === "EXPIRED") return "EXPIRED";
  if (s === "FAIL" || s === "FAILED") return "FAIL";
  return null;
}

function mt5SyncTime(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value))
    return new Date(value * 1000).toISOString();
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return new Date(Number(s) * 1000).toISOString();
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function mt5IsRetryableConnectivityFail(status, errorText) {
  const st = mt5CanonicalStoredStatus(status);
  if (st !== "FAIL") return false;
  const msg = String(errorText || "").toLowerCase();
  return (
    msg.includes("retcode=10031") ||
    msg.includes("no connection") ||
    msg.includes("trade server") ||
    msg.includes("off quotes")
  );
}

function mt5PublicState(row) {
  const status = mt5CanonicalStoredStatus(row.status);
  const ackStatus = row.ack_status
    ? mt5CanonicalStoredStatus(row.ack_status)
    : null;
  const updatedAt = [
    row.closed_at,
    row.opened_at,
    row.ack_at,
    row.locked_at,
    row.created_at,
  ]
    .map((v) => {
      const t = Date.parse(String(v || ""));
      return Number.isFinite(t) ? t : NaN;
    })
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a)[0];
  let stage = "unknown";
  if (status === "NEW") stage = "queued";
  else if (status === "LOCKED") stage = "pulled_by_mt5";
  else if (status === "START") stage = "position_active";
  else if (status === "PLACED") stage = "ack_placed";
  else if (status === "FAIL") stage = "execute_failed";
  else if (status === "TP") stage = "take_profit_hit";
  else if (status === "SL") stage = "stop_loss_hit";
  else if (status === "CANCEL") stage = "manually_cancelled";
  else if (status === "EXPIRED") stage = "expired_ignored";

  return {
    ...row,
    status,
    ack_status: ackStatus,
    updated_at: Number.isFinite(updatedAt)
      ? new Date(updatedAt).toISOString()
      : null,
    stage,
    is_open_candidate:
      status === "NEW" ||
      status === "LOCKED" ||
      status === "START" ||
      status === "PLACED",
    dedupe_safe: status !== "NEW",
  };
}

function mt5TerminalStatuses() {
  return ["FAIL", "TP", "SL", "CANCEL", "EXPIRED"];
}

async function mt5UpsertSignal(signal) {
  const b = await mt5Backend();
  return b.upsertSignal(signal);
}

async function mt5FindSignalById(signalId) {
  const b = await mt5Backend();
  return b.findSignalById(signalId);
}

async function mt5FindDuplicateSignal(payload = {}) {
  const userId = String(payload.user_id || "").trim();
  const symbol = String(payload.symbol || "")
    .trim()
    .toUpperCase();
  const entry = Number(payload.entry);
  const sl = Number(payload.sl);
  const tp = Number(payload.tp);
  if (
    !userId ||
    !symbol ||
    !Number.isFinite(entry) ||
    !Number.isFinite(sl) ||
    !Number.isFinite(tp)
  )
    return null;
  const b = await mt5Backend();
  if (!b?.db) return null;
  const { sql, eq, and, desc } = require("drizzle-orm");
  const schema = b.schema || require("../db/schema");
  const rows = await b.db
    .select()
    .from(schema.signals)
    .where(
      and(eq(schema.signals.userId, userId), eq(schema.signals.symbol, symbol)),
    )
    .orderBy(
      desc(
        sql`COALESCE(${schema.signals.closedAt}, ${schema.signals.updatedAt})`,
      ),
      desc(schema.signals.createdAt),
    )
    .limit(500);
  const EPS = 1e-8;
  for (const row of rows) {
    if (row.sl == null || row.tp == null) continue;
    if (Math.abs(Number(row.sl) - sl) > EPS) continue;
    if (Math.abs(Number(row.tp) - tp) > EPS) continue;
    let rawJson;
    try {
      rawJson = JSON.parse(row.rawJson || "{}");
    } catch {
      rawJson = {};
    }
    const rowEntry = Number(
      rawJson.entry ?? rawJson.price ?? rawJson.entry_price,
    );
    if (Number.isFinite(rowEntry) && Math.abs(rowEntry - entry) <= EPS)
      return row;
  }
  return null;
}

async function mt5GetSignalByTicket(ticket) {
  const b = await mt5Backend();
  return b.getSignalByTicket(ticket);
}

async function mt5AckSignal(signalId, status, ticket, error, extra = {}) {
  const b = await mt5Backend();
  return b.ackSignal(signalId, status, ticket, error, extra);
}

async function mt5ListSignals(limit, statusFilter) {
  const b = await mt5Backend();
  return b.listSignals(limit, statusFilter);
}

async function mt5CleanupSignalTradeArtifacts({
  signalRows = [],
  tradeRows = [],
  signalIds = [],
  tradeIds = [],
} = {}) {
  const sigIdSet = new Set(
    (Array.isArray(signalIds) ? signalIds : [])
      .map((x) => String(x || "").trim())
      .filter(Boolean),
  );
  const trdIdSet = new Set(
    (Array.isArray(tradeIds) ? tradeIds : [])
      .map((x) => String(x || "").trim())
      .filter(Boolean),
  );
  const signalRowsArr = Array.isArray(signalRows) ? signalRows : [];
  const tradeRowsArr = Array.isArray(tradeRows) ? tradeRows : [];

  for (const row of signalRowsArr) {
    const sid = String(row?.sid || "").trim();
    if (sid) sigIdSet.add(sid);
  }
  for (const row of tradeRowsArr) {
    const tid = String(row?.sid || "").trim();
    const sid = String(row?.sid || "").trim();
    if (tid) trdIdSet.add(tid);
    if (sid) sigIdSet.add(sid);
  }

  const b = await mt5Backend();
  if (!b?.query) return { logs_deleted: 0, files_deleted: 0 };

  const signalIdList = [...sigIdSet];
  const tradeIdList = [...trdIdSet];

  const fileSet = new Set();
  for (const row of signalRowsArr) {
    collectSnapshotFilesFromValue(row?.raw_json, fileSet);
  }
  for (const row of tradeRowsArr) {
    collectSnapshotFilesFromValue(row?.metadata, fileSet);
  }

  if (signalIdList.length > 0) {
    try {
      const { inArray } = require("drizzle-orm");
      const schema = b.schema || require("../db/schema");
      const res = await b.db
        .select({ rawJson: schema.signals.rawJson })
        .from(schema.signals)
        .where(inArray(schema.signals.sid, signalIdList));
      for (const row of res || [])
        collectSnapshotFilesFromValue(row?.rawJson, fileSet);
    } catch {
      // ignore fetch failure; continue best effort
    }
    try {
      const { inArray } = require("drizzle-orm");
      const schema = b.schema || require("../db/schema");
      const res = await b.db
        .select({ sid: schema.trades.sid })
        .from(schema.trades)
        .where(inArray(schema.trades.sid, signalIdList));
      for (const row of res || []) {
        const tid = String(row?.sid || "").trim();
        if (tid) trdIdSet.add(tid);
      }
    } catch {
      // ignore fetch failure
    }
  }

  const allTradeIds = [...trdIdSet];
  if (allTradeIds.length > 0) {
    try {
      const { inArray } = require("drizzle-orm");
      const schema = b.schema || require("../db/schema");
      const res = await b.db
        .select({ metadata: schema.trades.metadata })
        .from(schema.trades)
        .where(inArray(schema.trades.sid, allTradeIds));
      for (const row of res || [])
        collectSnapshotFilesFromValue(row?.metadata, fileSet);
    } catch {
      // ignore fetch failure
    }
  }

  const filesDeleted = deleteSnapshotFilesByName([...fileSet]);

  return { logs_deleted: 0, files_deleted: filesDeleted };
}

async function mt5AppendSignalEvent(signalId, eventType, payload = {}) {
  try {
    const b = await mt5Backend();
    const userId =
      payload.user_id || payload.created_by || CFG.mt5DefaultUserId;
    await b.log(
      signalId,
      "signals",
      { ...payload, event_type: eventType },
      userId,
    );
  } catch (err) {
    console.error(`[SIG_EVENT_FAIL] ${signalId} ${eventType}:`, err.message);
  }
}

async function mt5FanoutSignalTradeV2(payload) {
  const b = await mt5Backend();
  if (!b.fanoutSignalTradeV2) return { created: 0, account_ids: [] };
  return b.fanoutSignalTradeV2(payload);
}

async function mt5FindAccountByApiKeyHash(apiKeyHash) {
  const b = await mt5Backend();
  if (!b.findAccountByApiKeyHash) return null;
  return b.findAccountByApiKeyHash(apiKeyHash);
}

async function mt5PullLeasedTradesV2(
  accountId,
  maxItems = 1,
  leaseSeconds = 30,
  taskTypeFilter = null,
  sourceId = null,
) {
  const b = await mt5Backend();
  if (!b.pullLeasedTradesV2) return [];
  return b.pullLeasedTradesV2(
    accountId,
    maxItems,
    leaseSeconds,
    taskTypeFilter,
    sourceId,
  );
}

async function mt5AckTradeV2(accountId, payload) {
  const b = await mt5Backend();
  if (!b.ackTradeV2) return { ok: false, error: "not supported" };
  return b.ackTradeV2(accountId, payload);
}

async function mt5RotateAccountApiKeyV2(accountId) {
  const b = await mt5Backend();
  if (!b.rotateAccountApiKeyV2) return null;
  return b.rotateAccountApiKeyV2(accountId);
}

async function mt5RevokeAccountApiKeyV2(accountId) {
  const b = await mt5Backend();
  if (!b.revokeAccountApiKeyV2) return { ok: false, error: "not supported" };
  return b.revokeAccountApiKeyV2(accountId);
}

async function mt5BrokerSyncV2(accountId, payload) {
  const b = await mt5Backend();
  if (!b.brokerSyncV2) return { ok: false, error: "not supported" };
  return b.brokerSyncV2(accountId, payload);
}

async function mt5CreateBrokerTradeV2(accountId, payload) {
  const b = await mt5Backend();
  if (!b.createBrokerTradeV2) return { ok: false, error: "not supported" };
  return b.createBrokerTradeV2(accountId, payload);
}

async function mt5BrokerHeartbeatV2(accountId, payload) {
  const b = await mt5Backend();
  if (!b.brokerHeartbeatV2) return { ok: false, error: "not supported" };
  return b.brokerHeartbeatV2(accountId, payload);
}

async function mt5CreateAccountV2(payload = {}) {
  const b = await mt5Backend();
  if (!b.createAccountV2) return { ok: false, error: "not supported" };
  return b.createAccountV2(payload);
}

async function mt5UpdateAccountV2(accountId, patch = {}) {
  const b = await mt5Backend();
  if (!b.updateAccountV2) return { ok: false, error: "not supported" };
  return b.updateAccountV2(accountId, patch);
}

async function mt5ArchiveAccountV2(accountId) {
  const b = await mt5Backend();
  if (!b.archiveAccountV2) return { ok: false, error: "not supported" };
  return b.archiveAccountV2(accountId);
}

async function mt5ListSourceEventsV2(sourceId, limit = 100) {
  const b = await mt5Backend();
}

async function mt5ListTradesV2(filters = {}, page = 1, pageSize = 50) {
  const b = await mt5Backend();
  if (!b.listTradesV2)
    return {
      items: [],
      total: 0,
      page: 1,
      page_size: Math.max(1, Number(pageSize) || 50),
    };
  return b.listTradesV2(filters, page, pageSize);
}

async function mt5BulkActionTradesV2(action, filters = {}) {
  const b = await mt5Backend();
  if (!b.bulkActionTradesV2) return { ok: false, error: "not supported" };
  return b.bulkActionTradesV2(action, filters);
}

async function mt5UpdateTradeManualV2(tradeId, userId = null, payload = {}) {
  const b = await mt5Backend();
  if (!b.updateTradeManualV2) return { ok: false, error: "not supported" };
  return b.updateTradeManualV2(tradeId, userId, payload);
}

// Parse a single log line into an event object for backward-compat APIs.
function parseLogLine(line, fallbackObjectId) {
  // New format: [ISO] [LEVEL] [EVENT_TYPE] message, key=val, ...
  const m = line.match(/^\[([^\]]+)\]\s+\[(\w+)\]\s+\[(\S+)\]\s+(.*)/);
  if (!m) return null;
  const [, ts, level, eventType, rest] = m;
  // Extract message (first segment before "object_type=")
  const objIdx = rest.indexOf("object_type=");
  const msg =
    objIdx > 0
      ? rest.slice(0, objIdx - 2).trim() // -2 for ", " before object_type
      : "";
  const kvStr = objIdx > 0 ? rest.slice(objIdx) : rest;
  const payload = { level, message: msg };
  const kvRe = /(\w+)=("([^"]*)"|(\S+))/g;
  let kvMatch;
  while ((kvMatch = kvRe.exec(kvStr)) !== null) {
    payload[kvMatch[1]] = kvMatch[3] !== undefined ? kvMatch[3] : kvMatch[4];
  }
  return {
    log_id: `${ts}_${eventType}`,
    object_id: payload.object_id || fallbackObjectId,
    event_type: eventType,
    event_time: ts,
    created_at: ts,
    metadata: payload,
    payload_json: payload,
  };
}

async function mt5ListTradeEventsV2(tradeId, limit = 200) {
  const safeSid = String(tradeId || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "_");
  const events = [];

  // Read from both old (TRADE_FILES_DIR) and new (SERVER_LOG_DIR) locations
  const dirsToScan = [];
  const existingTradeDir = findExistingTradeDir(safeSid);
  const oldDir = existingTradeDir ? path.join(existingTradeDir, "logs") : "";
  if (oldDir && fs.existsSync(oldDir)) dirsToScan.push(oldDir);
  const newDir = path.join(SERVER_LOG_DIR, "trades", safeSid);
  if (fs.existsSync(newDir)) dirsToScan.push(newDir);

  for (const logDir of dirsToScan) {
    if (events.length >= limit) break;
    const files = fs
      .readdirSync(logDir)
      .filter((f) => f.endsWith(".log"))
      .sort()
      .reverse();
    for (const file of files) {
      if (events.length >= limit) break;
      const lines = fs
        .readFileSync(path.join(logDir, file), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const line of lines.reverse()) {
        if (events.length >= limit) break;
        const ev = parseLogLine(line, tradeId);
        if (ev) events.push(ev);
      }
    }
  }
  return events;
}

async function mt5ResolveTradeRefV2(tradeRef, userId = null) {
  const ref = String(tradeRef || "").trim();
  if (!ref) return null;
  const b = await mt5Backend();
  if (!b?.pool) return null;
  const numericId = mt5ParseNumericId(ref);
  const params = [ref];
  let idClause = "";
  if (numericId != null) {
    idClause = "OR id = $2::bigint";
    params.push(numericId);
  }
  let userClause = "";
  if (userId) {
    userClause = "AND user_id = $" + (params.length + 1) + "::text";
    params.push(userId);
  }
  const rows = await b.pool.query(
    `SELECT id, sid, user_id, execution_status, action, entry, sl, tp, tp1, tp2, tp3, symbol, order_type, broker_trade_id, note, dispatch_status FROM trades WHERE (sid = $1::text ${idClause}) ${userClause} ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
    params,
  );
  return rows.rows[0] || null;
}

async function mt5ResolveTradeFolderSymbol(tradeRef, fallbackSymbol = "") {
  const direct = String(fallbackSymbol || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_-]+:/, "")
    .replace(/[^A-Z0-9]/g, "");
  if (direct) return direct;
  const ref = String(tradeRef || "").trim();
  if (!ref) return "";
  const resolved = await mt5ResolveTradeRefV2(ref, null).catch(() => null);
  const fromDb = String(resolved?.symbol || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_-]+:/, "")
    .replace(/[^A-Z0-9]/g, "");
  if (fromDb) return fromDb;
  return inferSymbolFromTradeFolder(ref);
}

async function mt5ResolveSignalRefV2(signalRef, userId = null) {
  const ref = String(signalRef || "").trim();
  if (!ref) return null;
  const b = await mt5Backend();
  if (!b?.db) return null;
  const numericId = mt5ParseNumericId(ref);
  return dbQueries.resolveSignalRef(b.db, numericId, ref, userId || null);
}

async function mt5ListAccountsV2(userId = null) {
  const b = await mt5Backend();
  if (!b.listAccountsV2) return [];
  return b.listAccountsV2(userId);
}

async function mt5ListExecutionProfilesV2(userId) {
  const b = await mt5Backend();
  if (!userId) return [];
  const rows = await dbQueries.listUserSettingsByType(
    b.db,
    userId,
    "execution_profiles",
  );
  return (rows || []).map(mt5NormalizeExecutionProfileRow);
}

async function mt5GetActiveExecutionProfileV2(userId) {
  const b = await mt5Backend();
  if (!userId) return null;
  const rows = await dbQueries.listUserSettingsByType(
    b.db,
    userId,
    "execution_profile",
  );
  const active = (rows || []).find((r) => {
    const d = dbQueries.parseJsonField(r.data) || {};
    return d.is_active;
  });
  return active ? mt5NormalizeExecutionProfileRow(active) : null;
}

function mt5NormalizeExecutionProfileRow(row = {}) {
  const data = dbQueries.parseJsonField(row?.data) || {};
  return {
    profile_id:
      String(row?.name || row?.profile_id || "default").trim() || "default",
    user_id: String(row?.userId || row?.user_id || "").trim(),
    profile_name:
      String(
        data?.profile_name || row?.profile_name || row?.name || "default",
      ).trim() || "default",
    route:
      String(data?.route || row?.route || "ea")
        .trim()
        .toLowerCase() || "ea",
    account_id: String(data?.account_id || row?.account_id || "").trim(),
    source_ids: Array.isArray(data?.source_ids)
      ? data.source_ids.map((v) => String(v || "").trim()).filter(Boolean)
      : [],
    ctrader_mode:
      String(data?.ctrader_mode || row?.ctrader_mode || "")
        .trim()
        .toLowerCase() || "",
    ctrader_account_id: String(
      data?.ctrader_account_id || row?.ctrader_account_id || "",
    ).trim(),
    is_active:
      data?.is_active === undefined
        ? Boolean(row?.is_active)
        : Boolean(data.is_active),
    metadata:
      data?.metadata && typeof data.metadata === "object" ? data.metadata : {},
    raw: row,
    created_at: row?.createdAt || row?.created_at || null,
    updated_at: row?.updatedAt || row?.updated_at || null,
  };
}

async function mt5SaveExecutionProfileV2(payload = {}) {
  const b = await mt5Backend();
  const db = b?.query ? b : await mt5InitBackend();
  const profileId = String(payload.profile_id || "default").trim() || "default";
  const userId =
    String(payload.user_id || CFG.mt5DefaultUserId).trim() ||
    CFG.mt5DefaultUserId;
  const profileName =
    String(payload.profile_name || profileId).trim() || profileId;
  const routeRaw = String(payload.route || "")
    .trim()
    .toLowerCase();
  const route = ["ea", "v2026.05.09 19:31 - 728f356", "ctrader"].includes(
    routeRaw,
  )
    ? routeRaw
    : "ea";
  const accountId = String(payload.account_id || "").trim() || null;
  const sourceIds = (
    Array.isArray(payload.source_ids) ? payload.source_ids : []
  )
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  const ctraderModeRaw = String(payload.ctrader_mode || "")
    .trim()
    .toLowerCase();
  const ctraderMode = ["demo", "live"].includes(ctraderModeRaw)
    ? ctraderModeRaw
    : null;
  const ctraderAccountId =
    String(payload.ctrader_account_id || "").trim() || null;
  const isActive =
    payload.is_active === undefined ? true : Boolean(payload.is_active);
  const metadata =
    payload.metadata && typeof payload.metadata === "object"
      ? payload.metadata
      : {};

  const backend = await mt5Backend();
  const be = backend?.db ? backend : await mt5InitBackend();
  const { eq, and } = require("drizzle-orm");
  const schema = be.schema || require("../db/schema");

  if (isActive) {
    // Set all other execution_profiles for this user to inactive
    const existingRows = await dbQueries.listUserSettingsByType(
      b.db,
      userId,
      "execution_profile",
    );
    for (const row of existingRows || []) {
      const d = dbQueries.parseJsonField(row.data) || {};
      if (d.is_active) {
        const updated = { ...d, is_active: false };
        await b.db
          .update(schema.userSettings)
          .set({
            data: dbQueries.jsonField(updated),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.userSettings.userId, userId),
              eq(schema.userSettings.type, "execution_profile"),
              eq(schema.userSettings.name, row.name),
            ),
          );
      }
    }
  }

  const data = {
    profile_name: profileName,
    route,
    account_id: accountId,
    source_ids: sourceIds,
    ctrader_mode: ctraderMode,
    ctrader_account_id: ctraderAccountId,
    is_active: isActive,
    metadata,
  };

  await dbQueries.upsertUserSetting(
    b.db,
    userId,
    "execution_profile",
    profileId,
    data,
    "ACTIVE",
  );

  return {
    ok: true,
    item: mt5NormalizeExecutionProfileRow({
      userId: userId,
      name: profileId,
      data: data,
    }),
  };
}

async function mt5UpsertSourceV2(source) {
  return null;
}
async function mt5ListSourcesV2() {
  return [];
}
async function mt5GetSourceByIdV2(sourceId) {
  return null;
}
async function mt5RotateSourceSecretV2(sourceId) {
  return { ok: false, error: "removed" };
}
async function mt5RevokeSourceSecretV2(sourceId) {
  return { ok: false, error: "removed" };
}

async function mt5GetAccountSubscriptionsV2(accountId) {
  return [];
}

async function mt5ReplaceAccountSubscriptionsV2(accountId, items) {
  return { ok: true };
}

async function mt5ListSignalEvents(signalId, limit = 200) {
  const safeSid = String(signalId || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "_");
  const logDir = path.join(SERVER_LOG_DIR, "SIGNAL");
  const events = [];
  if (fs.existsSync(logDir)) {
    const files = fs
      .readdirSync(logDir)
      .filter((f) => f.startsWith(safeSid) && f.endsWith(".log"))
      .sort()
      .reverse();
    for (const file of files) {
      if (events.length >= limit) break;
      const lines = fs
        .readFileSync(path.join(logDir, file), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const line of lines.reverse()) {
        if (events.length >= limit) break;
        const ev = parseLogLine(line, signalId);
        if (ev) events.push(ev);
      }
    }
  }
  return events;
}

async function mt5ListActiveSignals() {
  const b = await mt5Backend();
  return b.listActiveSignals();
}

async function mt5BulkAckSignals(updates) {
  const b = await mt5Backend();
  return b.bulkAckSignals(updates);
}

async function mt5DeleteAllEvents() {
  // Delete all .log files from SERVER_LOG_DIR only (trade artifacts untouched)
  let deleted = 0;
  const baseDir = SERVER_LOG_DIR;
  if (fs.existsSync(baseDir)) {
    const walkDir = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(full);
        } else if (entry.name.endsWith(".log")) {
          fs.unlinkSync(full);
          deleted++;
        }
      }
    };
    walkDir(baseDir);
  }
  // Invalidate caches so History tab doesn't show stale data
  await StateRepo.flushBucket("TRADE_DETAIL");
  await StateRepo.flushBucket("SIGNAL_DETAIL");
  return { deleted };
}

async function mt5PruneSignals(days) {
  const safeDays = Math.max(
    1,
    Math.min(3650, Number.isFinite(days) ? days : 14),
  );
  const b = await mt5Backend();
  return b.pruneOldSignals(safeDays);
}

async function mt5DeleteSignalsByIds(signalIds) {
  const ids = Array.isArray(signalIds)
    ? signalIds.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
  if (!ids.length) return { deleted: 0 };
  const b = await mt5Backend();
  if (!b.deleteSignalsByIds) return { deleted: 0 };
  return b.deleteSignalsByIds(ids);
}

async function mt5CancelSignalsByIds(signalIds) {
  const ids = Array.isArray(signalIds)
    ? signalIds.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
  if (!ids.length) return { updated: 0, updated_ids: [] };
  const b = await mt5Backend();
  if (!b.cancelSignalsByIds) return { updated: 0, updated_ids: [] };
  return b.cancelSignalsByIds(ids);
}

async function mt5RenewSignalsByIds(signalIds) {
  const ids = Array.isArray(signalIds)
    ? signalIds.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
  if (!ids.length) return { updated: 0, updated_ids: [] };
  const b = await mt5Backend();
  if (!b.renewSignalsByIds) return { updated: 0, updated_ids: [] };
  return b.renewSignalsByIds(ids);
}

function mt5CsvTimestamp(value) {
  const d = new Date(String(value || ""));
  if (!Number.isFinite(d.getTime())) {
    return "";
  }
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function csvField(v) {
  if (v === undefined || v === null) return "";
  const s = String(v);
  if (/[;"\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function mt5SignalsToBacktestCsv(rows, includeHeader = true) {
  const lines = [];
  if (includeHeader) {
    lines.push("timestamp;sid;action;symbol;volume;sl;tp;note");
  }
  for (const r of rows) {
    lines.push(
      [
        csvField(mt5CsvTimestamp(r.created_at)),
        csvField(r.sid || ""),
        csvField(r.action || ""),
        csvField(r.symbol || ""),
        csvField(r.volume ?? ""),
        csvField(r.sl ?? ""),
        csvField(r.tp ?? ""),
        csvField(r.note || ""),
      ].join(";"),
    );
  }
  return lines.join("\n");
}

function mt5PeriodRange(period) {
  const now = new Date();
  const end = now.toISOString();

  if (period === "all") {
    return { start: null, end: null };
  }
  if (period === "today") {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString();
    return { start, end };
  }
  if (period === "yesterday") {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
    ).toISOString();
    const endY = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString();
    return { start, end: endY };
  }
  if (period === "week") {
    const day = now.getUTCDay() || 7; // Monday=1 ... Sunday=7
    const startDate = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - (day - 1),
      ),
    );
    return { start: startDate.toISOString(), end };
  }
  if (period === "last_week") {
    const day = now.getUTCDay() || 7;
    const start = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - (day - 1) - 7,
      ),
    ).toISOString();
    const endLW = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - (day - 1),
      ),
    ).toISOString();
    return { start, end: endLW };
  }
  if (period === "month") {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString();
    return { start, end };
  }
  if (period === "last_month") {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    ).toISOString();
    const endLM = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString();
    return { start, end: endLM };
  }
  if (period === "year") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
    return { start, end };
  }
  return { start: null, end };
}

// Dashboard view should align with local calendar buckets (same basis as pnl_series keys).
function mt5LocalPeriodRange(period) {
  const now = new Date();
  const end = now.toISOString();

  if (period === "all") return { start: null, end: null };
  if (period === "today") {
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).toISOString();
    return { start, end };
  }
  if (period === "yesterday") {
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
    ).toISOString();
    const endY = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).toISOString();
    return { start, end: endY };
  }
  if (period === "week") {
    const day = now.getDay() || 7; // Monday=1 ... Sunday=7
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (day - 1),
    ).toISOString();
    return { start, end };
  }
  if (period === "last_week") {
    const day = now.getDay() || 7;
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (day - 1) - 7,
    ).toISOString();
    const endLW = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (day - 1),
    ).toISOString();
    return { start, end: endLW };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    return { start, end };
  }
  if (period === "last_month") {
    const start = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    ).toISOString();
    const endLM = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    return { start, end: endLM };
  }
  if (period === "year") {
    const start = new Date(now.getFullYear(), 0, 1).toISOString();
    return { start, end };
  }
  return { start: null, end: null };
}

function mt5ToMs(value) {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : NaN;
}

function mt5FilterRows(rows, opts = {}) {
  const userId = envStr(opts.userId);
  const symbol = envStr(opts.symbol).toUpperCase();
  const source = envStr(opts.source);
  const entryModel = envStr(opts.entryModel);
  const chartTf = envStr(opts.chartTf);
  const signalTf = envStr(opts.signalTf);
  const statuses = Array.isArray(opts.statuses)
    ? opts.statuses.map((s) => mt5CanonicalStoredStatus(s)).filter(Boolean)
    : [];
  const fromMs = opts.from ? mt5ToMs(opts.from) : NaN;
  const toMs = opts.to ? mt5ToMs(opts.to) : NaN;
  return rows.filter((r) => {
    const rs = mt5CanonicalStoredStatus(r.status);
    if (userId && String(r.user_id || "") !== userId) return false;
    if (symbol && String(r.symbol || "").toUpperCase() !== symbol) return false;
    if (source && mt5SourceIdFromRow(r) !== source) return false;
    if (entryModel && mt5EntryModelLabelFromRow(r) !== entryModel) return false;
    if (
      chartTf &&
      String(
        r.chart_tf || r.raw_json?.chart_tf || r.raw_json?.chartTf || "",
      ) !== chartTf
    )
      return false;
    if (
      signalTf &&
      String(
        r.signal_tf ||
          r.raw_json?.signal_tf ||
          r.raw_json?.sourceTf ||
          r.raw_json?.timeframe ||
          "",
      ) !== signalTf
    )
      return false;
    if (statuses.length > 0 && !statuses.includes(rs)) return false;
    // Prefer closed_at for trades PnL accuracy, fallback to created_at
    const tRaw = r.closed_at || r.ack_at || r.created_at;
    const t = mt5ToMs(tRaw);
    if (Number.isFinite(fromMs) && (!Number.isFinite(t) || t < fromMs))
      return false;
    if (Number.isFinite(toMs) && (!Number.isFinite(t) || t > toMs))
      return false;
    return true;
  });
}

function mt5ResolveTradeFilters(url, payload = null) {
  const pick = (key, fallback = "") => {
    const fromPayload =
      payload && payload[key] !== undefined && payload[key] !== null
        ? payload[key]
        : "";
    const fromUrl = url.searchParams.get(key);
    return envStr(fromPayload || fromUrl || fallback);
  };
  const statuses = pick("status")
    .toUpperCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const range = pick("range").toLowerCase();
  const period = mt5PeriodRange(range);
  return {
    userId: pick("user_id"),
    symbol: pick("symbol"),
    source: pick("source"),
    entryModel: pick("entry_model"),
    chartTf: pick("chart_tf"),
    signalTf: pick("signal_tf"),
    statuses,
    from: pick("from") || period.start,
    to: pick("to") || period.end,
    q: pick("q").toLowerCase(),
  };
}

function mt5ResolveSignalIds(url, payload = null) {
  const fromPayload =
    payload && payload.sids !== undefined && payload.sids !== null
      ? payload.sids
      : payload && payload.ids !== undefined && payload.ids !== null
        ? payload.ids
        : null;
  const fromQuery =
    url.searchParams.get("sids") ||
    url.searchParams.get("signal_ids") ||
    url.searchParams.get("ids") ||
    "";
  const raw = fromPayload !== null ? fromPayload : fromQuery;
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((s) => String(s || "").trim()).filter(Boolean))];
  }
  if (typeof raw === "string") {
    return [
      ...new Set(
        raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
  }
  return [];
}

async function mt5GetFilteredTrades(url, payload = null, limitDefault = 10000) {
  const limitRaw = Number(
    (payload && payload.limit) ?? url.searchParams.get("limit") ?? limitDefault,
  );
  const limit = Math.max(
    100,
    Math.min(200000, Number.isFinite(limitRaw) ? limitRaw : limitDefault),
  );
  const filters = mt5ResolveTradeFilters(url, payload);
  // Use v2 trades list (not old signals table)
  const b = await mt5Backend();
  const tradeFilter = {};
  if (filters.statuses && filters.statuses.length)
    tradeFilter.status = filters.statuses[0];
  if (filters.symbol) tradeFilter.symbol = filters.symbol;
  if (filters.q) tradeFilter.q = filters.q;
  if (filters.userId) tradeFilter.userId = filters.userId;
  const tradeResult = await b.listTradesV2(tradeFilter, 1, limit);
  let rows = (tradeResult?.rows || []).map((r) => ({
    ...r,
    sid: r.sid || r.id,
    id: r.id || r.sid,
    status: r.execution_status || r.status,
  }));
  if (filters.q) {
    const q = String(filters.q).toLowerCase();
    rows = rows.filter(
      (r) =>
        String(r.sid || "")
          .toLowerCase()
          .includes(q) ||
        String(r.id || "")
          .toLowerCase()
          .includes(q) ||
        String(r.sid || "")
          .toLowerCase()
          .includes(q) ||
        String(r.raw_json?.id || "")
          .toLowerCase()
          .includes(q) ||
        String(r.raw_json?.sid || r.raw_json?.trade_id || "")
          .toLowerCase()
          .includes(q) ||
        String(r.note || "")
          .toLowerCase()
          .includes(q) ||
        String(r.symbol || "")
          .toLowerCase()
          .includes(q) ||
        String(r.ack_ticket || "")
          .toLowerCase()
          .includes(q) ||
        String(r.entry_model || "")
          .toLowerCase()
          .includes(q) ||
        String(r.source || "")
          .toLowerCase()
          .includes(q) ||
        String(r.source_id || "")
          .toLowerCase()
          .includes(q) ||
        String(r.account_id || "")
          .toLowerCase()
          .includes(q) ||
        String(r.action || r.side || "")
          .toLowerCase()
          .includes(q),
    );
  }
  const signalIds = mt5ResolveSignalIds(url, payload);
  if (signalIds.length > 0) {
    const idSet = new Set(signalIds);
    rows = rows.filter(
      (r) =>
        idSet.has(String(r.sid || "")) ||
        idSet.has(String(r.sid || "")) ||
        idSet.has(String(r.id || "")),
    );
  }
  filters.sids = signalIds;
  return { rows, filters, limit };
}

function mt5ComputeMetrics(rows) {
  const closed = rows.filter((r) => {
    const s = mt5CanonicalStoredStatus(
      r.execution_status || r.status || r.close_reason,
    );
    const res = String(r?.close_reason || r?.reason || "").toUpperCase();
    const pnl = Number(r?.pnl_realized ?? r?.pnl_money_realized);
    return (
      s === "CLOSED" ||
      s === "TP" ||
      s === "SL" ||
      res === "TP" ||
      res === "SL" ||
      (s === "CANCEL" && Number.isFinite(pnl))
    );
  });
  const wins = closed.filter((r) => {
    const pnl = Number(r.pnl_money_realized);
    return Number.isFinite(pnl) && pnl > 0;
  });
  const losses = closed.filter((r) => {
    const pnl = Number(r.pnl_money_realized);
    return Number.isFinite(pnl) && pnl < 0;
  });
  const pnl = closed.reduce((acc, r) => {
    const v = Number(r.pnl_money_realized);
    return Number.isFinite(v) ? acc + v : acc;
  }, 0);
  return {
    total_trades: closed.length,
    closed_trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    win_rate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    pnl_money_realized: pnl,
  };
}

function mt5CountBy(rows, pick, { sortDesc = true, limit = 0 } = {}) {
  const map = new Map();
  for (const row of rows || []) {
    const key = String(pick(row) || "").trim();
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  let entries = [...map.entries()].map(([key, count]) => ({ key, count }));
  entries.sort((a, b) => {
    if (sortDesc) return b.count - a.count || (a.key < b.key ? -1 : 1);
    return a.key < b.key ? -1 : 1;
  });
  if (limit > 0) entries = entries.slice(0, limit);
  return entries;
}

function mt5StatusTier(statusRaw) {
  const s = mt5CanonicalStoredStatus(statusRaw);
  if (["NEW", "LOCKED", "PLACED", "START"].includes(s)) return "FILLED";
  if (["TP", "SL"].includes(s)) return "WINS_LOSSES";
  return "CLOSED";
}

const MT5_TRADE_STATUSES = new Set(["TP", "SL", "START", "PLACED"]);

function mt5IsTradeStatus(statusRaw) {
  return MT5_TRADE_STATUSES.has(mt5CanonicalStoredStatus(statusRaw));
}

function mt5ComputeRMultiple(row) {
  const pnl = Number(row?.pnl_realized ?? row?.pnl_money_realized);
  if (!Number.isFinite(pnl) || Math.abs(pnl) < 0.001) return 0;

  // Standard Rule: Any loss is -1R
  if (pnl < 0) return -1;

  // For wins: Use planned RR if available, otherwise default to 1R
  const planned = Number(
    row?.rr_planned || row?.metadata?.rr_planned || row?.metadata?.rrPlanned,
  );
  if (Number.isFinite(planned) && planned > 0) return planned;

  return 1;
}

function mt5ComputeTopWinrateRows(
  rows,
  keyPicker,
  { limit = 10, includeDirection = false } = {},
) {
  const map = new Map();
  for (const row of rows || []) {
    const baseKey = String(keyPicker(row) || "").trim();
    if (!baseKey) continue;
    const direction = String(row?.action || "").toUpperCase();
    const directionSafe =
      direction === "BUY" || direction === "SELL" ? direction : "-";
    const key = includeDirection ? `${baseKey} | ${directionSafe}` : baseKey;
    const status = mt5CanonicalStoredStatus(
      row.execution_status || row.status || row.close_reason,
    );
    const rr = mt5ComputeRMultiple(row);
    const pnl = Number(row?.pnl_realized ?? row?.pnl_money_realized);
    const closeReason = String(row?.close_reason || "").toUpperCase();
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: baseKey,
        direction: directionSafe,
        wins: 0,
        losses: 0,
        trades: 0,
        pnl_total: 0,
        rr_total: 0,
        rr_sum: 0,
        rr_count: 0,
      });
    }
    const st = map.get(key);
    // DASHBOARD FILTER: Only count CLOSED/TP/SL for stats
    if (
      status === "CLOSED" ||
      status === "TP" ||
      status === "SL" ||
      closeReason === "TP" ||
      closeReason === "SL"
    ) {
      st.trades++;
      if (status === "TP" || closeReason === "TP") st.wins++;
      else if (status === "SL" || closeReason === "SL") st.losses++;
      else if (Number.isFinite(pnl) && pnl > 0) st.wins++;
      else if (Number.isFinite(pnl) && pnl < 0) st.losses++;
      if (Number.isFinite(pnl)) st.pnl_total += pnl;
      if (Number.isFinite(rr)) {
        st.rr_sum += rr;
        st.rr_count++;
        st.rr_total = st.rr_sum; // the total RR is the sum
      }
    }
  }
  let entries = [...map.values()];
  for (const st of entries) {
    const closed = st.wins + st.losses;
    st.win_rate = closed > 0 ? (st.wins / closed) * 100 : 0;
  }

  // DASHBOARD FILTER: Do not display items with PnL=0 & WR = 0 & W=0 & L=0
  entries = entries.filter(
    (st) =>
      Math.abs(st.pnl_total) > 0.001 ||
      st.win_rate > 0 ||
      st.wins > 0 ||
      st.losses > 0,
  );

  entries.sort(
    (a, b) =>
      b.win_rate - a.win_rate ||
      b.trades - a.trades ||
      (a.key < b.key ? -1 : 1),
  );
  if (limit > 0) entries = entries.slice(0, limit);
  return entries;
}

function mt5EntryModelFromRow(row) {
  const direct = mt5NormalizeEntryModel(envStr(row?.entry_model), {
    fallback: row?.source_id || row?.source || "manual",
  });
  if (direct) return direct;
  const raw = row?.raw_json || {};
  return mt5NormalizeEntryModel(
    raw.entry_model ||
      raw.entryModel ||
      raw.model ||
      raw.strategy ||
      row?.source_id ||
      row?.source ||
      "manual",
  );
}

function mt5StrategyFromRow(row) {
  const sourceId = envStr(row?.source_id || row?.source);
  if (sourceId) return sourceId;
  const raw = row?.raw_json || {};
  return envStr(
    raw.source ||
      raw.source_id ||
      raw.strategy ||
      raw.model ||
      raw.entry_model ||
      raw.entryModel,
  );
}

function mt5StrategyLabelFromRow(row) {
  const raw = row?.raw_json || {};
  return envStr(row?.strategy || raw?.strategy);
}

function mt5SourceIdFromRow(row) {
  const raw = row?.raw_json || {};
  return envStr(row?.source_id || raw?.source_id || row?.source || raw?.source);
}

function mt5EntryModelLabelFromRow(row) {
  const raw = row?.raw_json || {};
  const firstPlan = Array.isArray(raw?.trade_plan)
    ? raw.trade_plan[0] || {}
    : raw?.trade_plan && typeof raw.trade_plan === "object"
      ? raw.trade_plan
      : {};
  const firstAnalysisPlan = Array.isArray(raw?.analysis_data)
    ? raw.analysis_data.find(
        (x) => Array.isArray(x?.trade_plan) && x.trade_plan.length > 0,
      )?.trade_plan?.[0] || {}
    : {};
  const metadataPlan =
    row?.metadata?.trade_plan && typeof row.metadata.trade_plan === "object"
      ? row.metadata.trade_plan
      : {};
  const candidate = envStr(
    firstPlan?.entry_model ||
      firstAnalysisPlan?.entry_model ||
      metadataPlan?.entry_model ||
      raw?.entry_model ||
      raw?.entryModel ||
      row?.entry_model,
  );
  // Avoid provider ids in this card (ai_claude, ai_gpt4o, ...).
  if (/^ai[_-]/i.test(candidate)) return "";
  return candidate;
}

function mt5OrderTypeFromRow(row) {
  const raw = row?.raw_json || {};
  const metadata = row?.metadata || {};
  const firstPlan = Array.isArray(raw?.trade_plan)
    ? raw.trade_plan[0] || {}
    : raw?.trade_plan && typeof raw.trade_plan === "object"
      ? raw.trade_plan
      : {};
  const orderTypeRaw = envStr(
    row?.order_type ||
      metadata?.order_type ||
      raw?.order_type ||
      raw?.orderType ||
      firstPlan?.order_type,
    "LIMIT",
  ).toLowerCase();
  if (orderTypeRaw.includes("market")) return "market";
  if (orderTypeRaw.includes("stop")) return "stop";
  return "limit";
}

function mt5ComputeTradeMetrics(rows) {
  const all = Array.isArray(rows) ? rows : [];

  // Count by status tiers using all rows
  // trades table uses: PENDING, FILLED, CLOSED, CANCELLED
  const countPending = all.filter((r) => {
    const s = mt5CanonicalStoredStatus(
      r.execution_status || r.status || r.close_reason,
    );
    return ["PENDING", "NEW", "LOCKED", "START"].includes(s);
  }).length;

  const countFilled = all.filter((r) => {
    const s = mt5CanonicalStoredStatus(
      r.execution_status || r.status || r.close_reason,
    );
    return ["PLACED", "FILLED"].includes(s);
  }).length;

  const countClosed = all.filter((r) => {
    const s = mt5CanonicalStoredStatus(
      r.execution_status || r.status || r.close_reason,
    );
    return ["CLOSED", "TP", "SL", "CANCEL", "CANCELLED"].includes(s);
  }).length;

  // DASHBOARD FILTER: Only calculate PnL/WR/RR by Closed trades
  const trades = all.filter((r) => {
    const s = mt5CanonicalStoredStatus(
      r.execution_status || r.status || r.close_reason,
    );
    const res = String(r?.close_reason || r?.reason || "").toUpperCase();
    const pnl = Number(r?.pnl_realized ?? r?.pnl_money_realized);
    return (
      ["CLOSED", "TP", "SL"].includes(s) ||
      res === "TP" ||
      res === "SL" ||
      (s === "CANCEL" && Number.isFinite(pnl))
    );
  });

  const wins = trades.filter((r) => {
    const s = mt5CanonicalStoredStatus(
      r.execution_status || r.status || r.close_reason,
    );
    const res = String(r.close_reason || "").toUpperCase();
    if (s === "TP" || res === "TP") return true;
    const pnl = Number(r?.pnl_realized ?? r?.pnl_money_realized);
    return Number.isFinite(pnl) && pnl > 0;
  }).length;

  const losses = trades.filter((r) => {
    const s = mt5CanonicalStoredStatus(
      r.execution_status || r.status || r.close_reason,
    );
    const res = String(r.close_reason || "").toUpperCase();
    if (s === "SL" || res === "SL") return true;
    const pnl = Number(r?.pnl_realized ?? r?.pnl_money_realized);
    return Number.isFinite(pnl) && pnl < 0;
  }).length;

  const rrRows = trades.filter((r) => {
    const s = mt5CanonicalStoredStatus(
      r.execution_status || r.status || r.close_reason,
    );
    const res = String(r.close_reason || "").toUpperCase();
    return s === "TP" || s === "SL" || res === "TP" || res === "SL";
  });

  const winBase = wins + losses;
  let totalPnl = 0;
  let buyPnl = 0;
  let sellPnl = 0;
  let winSumPnl = 0;
  let loseSumPnl = 0;

  for (const r of trades) {
    const pnl = Number(r?.pnl_realized ?? r?.pnl_money_realized ?? 0);
    if (Number.isFinite(pnl)) {
      totalPnl += pnl;
      if (pnl > 0) winSumPnl += pnl;
      else if (pnl < 0) loseSumPnl += pnl;
    }
  }

  const totalRr = rrRows.reduce((acc, r) => {
    const mapped = {
      ...r,
      price: r.entry ?? r.intent_entry ?? r.price,
      sl: r.sl ?? r.intent_sl ?? null,
      tp: r.tp ?? r.intent_tp ?? null,
      pnl_money_realized: r.pnl_realized ?? r.pnl_money_realized,
    };
    const rr = mt5ComputeRMultiple(mapped);
    return Number.isFinite(rr) ? acc + rr : acc;
  }, 0);

  return {
    total_signals: all.length,
    total_trades: all.length,
    wins,
    losses,
    win_rate: winBase > 0 ? (wins / winBase) * 100 : 0,
    total_pnl: totalPnl,
    buy_pnl: buyPnl,
    sell_pnl: sellPnl,
    win_sum_pnl: winSumPnl,
    lose_sum_pnl: loseSumPnl,
    total_rr: totalRr,
    count_pending: countPending,
    count_filled: countFilled,
    count_closed: countClosed,
  };
}

function getHeaderApiKey(req) {
  return String(
    req.headers["x-api-key"] ||
      req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
      "",
  );
}

function getPayloadApiKey(payload = null) {
  if (!payload) return "";
  return String(payload.apiKey || payload.api_key || "");
}

function getQueryApiKey(urlObj = null) {
  if (!urlObj) return "";
  return String(
    urlObj.searchParams.get("apiKey") ||
      urlObj.searchParams.get("api_key") ||
      "",
  );
}

function getApiKeyFromReq(req, payload = null, urlObj = null) {
  const headerKey = getHeaderApiKey(req);
  if (headerKey) return headerKey;
  const payloadKey = getPayloadApiKey(payload);
  if (payloadKey) return payloadKey;
  return getQueryApiKey(urlObj);
}

function resolveEaApiKey(req, payload = null, urlObj = null) {
  const headerKey = getHeaderApiKey(req);
  if (headerKey) return { key: headerKey, source: "header" };
  if (CFG.mt5AuthAllowLegacyPayloadKey) {
    const payloadKey = getPayloadApiKey(payload);
    if (payloadKey) return { key: payloadKey, source: "payload" };
  }
  if (CFG.mt5AuthAllowLegacyQueryKey) {
    const queryKey = getQueryApiKey(urlObj);
    if (queryKey) return { key: queryKey, source: "query" };
  }
  return { key: "", source: "none" };
}

async function requireEaKey(req, res, urlObj, payload = null) {
  const { key, source } = resolveEaApiKey(req, payload, urlObj);
  if (!key) {
    if (CFG.mt5EaApiKeys.size === 0) return true; // Allow all if no keys configured
    json(res, 401, { ok: false, error: "missing ea api key" });
    return false;
  }
  // 1. Check static config
  if (CFG.mt5EaApiKeys.size === 0 || CFG.mt5EaApiKeys.has(key)) {
    return true;
  }
  // 2. Check Database
  const account = await mt5FindAccountByApiKeyHash(hashApiKey(key));
  if (account) return true;

  json(res, 401, { ok: false, error: "invalid ea api key" });
  return false;
}

async function requireV2BrokerAccount(req, res, urlObj, payload = null) {
  const { key } = resolveEaApiKey(req, payload, urlObj);
  if (!key) {
    json(res, 401, { ok: false, error: "missing api key" });
    return null;
  }
  const account = await mt5FindAccountByApiKeyHash(hashApiKey(key));
  if (account === null) {
    const b = await mt5Backend();
    if (!b.findAccountByApiKeyHash) {
      json(res, 400, {
        ok: false,
        error: "v2026.05.09 19:31 - 728f356",
      });
      return null;
    }
  }
  if (!account) {
    json(res, 401, { ok: false, error: "invalid account api key" });
    return null;
  }
  return account;
}

function formatBrokerSyncError(error) {
  if (!error) return "unknown broker sync error";
  const message =
    error instanceof Error ? String(error.message || "") : String(error);
  const code = String(error?.code || "").trim();
  const table = String(error?.table || "").trim();
  const constraint = String(error?.constraint || "").trim();
  const detail = String(error?.detail || "").trim();

  if (code === "23503") {
    return `FK_VIOLATION table=${table || "unknown"} constraint=${constraint || "unknown"}${detail ? ` detail=${detail}` : ""}`;
  }
  if (code === "23505") {
    return `UNIQUE_VIOLATION constraint=${constraint || "unknown"}${detail ? ` detail=${detail}` : ""}`;
  }
  if (code === "23502") {
    return `NOT_NULL_VIOLATION column=${String(error?.column || "unknown").trim() || "unknown"} table=${table || "unknown"}`;
  }
  return message || "unknown broker sync error";
}

function getTvTokenFromPath(pathname = "") {
  const m = String(pathname).match(/^\/(?:signal|mt5\/tv\/webhook)\/([^/]+)$/);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1] || "").trim();
  } catch {
    return String(m[1] || "").trim();
  }
}

function isTvWebhookPath(pathname = "") {
  const p = String(pathname || "");
  return (
    p === "/signal" ||
    p === "/mt5/tv/webhook" ||
    /^\/signal\/[^/]+$/.test(p) ||
    /^\/mt5\/tv\/webhook\/[^/]+$/.test(p)
  );
}

function requireTvAuth(req, res, urlObj, payload = null) {
  const hasAuthConfig = Boolean(
    CFG.signalApiKey ||
    CFG.mt5TvAlertApiKeys.size > 0 ||
    CFG.mt5TvWebhookTokens.size > 0,
  );
  if (!hasAuthConfig) return true;

  const tokenFromPath = getTvTokenFromPath(urlObj?.pathname || "");
  if (tokenFromPath) {
    if (CFG.mt5TvWebhookTokens.has(tokenFromPath)) return true;
    json(res, 401, { ok: false, error: "invalid tv webhook token" });
    return false;
  }

  const headerKey = getHeaderApiKey(req);
  if (
    headerKey &&
    ((CFG.signalApiKey && headerKey === CFG.signalApiKey) ||
      CFG.mt5TvAlertApiKeys.has(headerKey))
  ) {
    return true;
  }

  if (CFG.mt5AuthAllowLegacyPayloadKey) {
    const payloadKey = getPayloadApiKey(payload);
    if (
      payloadKey &&
      ((CFG.signalApiKey && payloadKey === CFG.signalApiKey) ||
        CFG.mt5TvAlertApiKeys.has(payloadKey))
    ) {
      console.warn(
        `[Auth] Legacy TV auth key source="payload" path="${urlObj?.pathname || ""}"`,
      );
      return true;
    }
  }

  json(res, 401, { ok: false, error: "Unauthorized" });
  return false;
}

function requireAdminKey(req, res, urlObj, payload = null) {
  const uiSess = getUiSessionFromReq(req);
  if (uiSess.ok) return true;
  if (!CFG.signalApiKey) return true;
  const incoming = getApiKeyFromReq(req, payload, urlObj);
  if (incoming === CFG.signalApiKey) return true;
  json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
  return false;
}

/**
 * Returns the effective user_id for UI requests.
 * If user is not an admin, always returns their session user_id.
 * If user is admin, returns the requested user_id from query/payload if any.
 */
function uiEffectiveUserId(req, urlObj = null, payload = null) {
  const sess = getUiSessionFromReq(req);
  if (!sess.ok) return null;
  if (isSystemRole(sess.role)) {
    // Admins can see specific users if requested via header, payload, or query
    const target = (
      req.headers["x-active-user-id"] ??
      payload?.user_id ??
      urlObj?.searchParams?.get("user_id") ??
      ""
    ).trim();
    // Use target, or default to their own user_id if they want to act as themselves
    return target || sess.user_id;
  }
  return sess.user_id;
}

function requireSystemRoleForUi(req, res) {
  const uiSess = getUiSessionFromReq(req);
  if (!uiSess.ok) {
    json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    return false;
  }
  if (!isSystemRole(uiSess.role)) {
    json(res, 403, { ok: false, error: "FORBIDDEN_SYSTEM_ROLE_REQUIRED" });
    return false;
  }
  return true;
}

function requireAuthForUi(req, res) {
  const uiSess = getUiSessionFromReq(req);
  if (!uiSess.ok) {
    json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    return false;
  }
  return true;
}

function mt5DashboardHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="v2026.05.09 19:31 - 728f356" content="width=device-width, initial-scale=1" />
  <title>MT5 Trades</title>
  <style>
    body { font-family: Arial, sans-serif; background:#0b0f14; color:#e6edf3; margin:0; }
    .logs-list-pane { flex: 0 0 40%; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
    .wrap { max-width:1200px; margin:0 auto; padding:14px; }
    .top { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
    input, select, button { background:#121821; color:#e6edf3; border:1px solid #263244; padding:8px; border-radius:8px; }
    button { cursor:pointer; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th, td { border-bottom:1px solid #1f2a37; padding:7px; text-align:left; }
    th { color:#9fb0c4; position:sticky; top:0; background:#0b0f14; }
    .badge { border-radius:999px; padding:2px 8px; font-size:11px; font-weight:bold; display:inline-block; }
    .NEW { background:#1f2937; color:#d1d5db; }
    .LOCKED { background:#1d4ed8; color:#dbeafe; }
    .PLACED { background:#065f46; color:#d1fae5; }
    .START { background:#0f766e; color:#ccfbf1; }
    .FAIL, .SL { background:#7f1d1d; color:#fee2e2; }
    .TP { background:#14532d; color:#dcfce7; }
    .CANCEL { background:#9a3412; color:#ffedd5; }
    .EXPIRED { background:#78350f; color:#fef3c7; }
    .muted { color:#8b9db2; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <strong>MT5 Trades Monitor</strong>
      <span class="muted" id="meta"></span>
      <select id="status">
        <option value="">All statuses</option>
        <option>NEW</option><option>LOCKED</option><option>PLACED</option><option>START</option>
        <option>FAIL</option><option>TP</option><option>SL</option><option>CANCEL</option><option>EXPIRED</option>
      </select>
      <input id="limit" type="number" min="10" max="1000" value="200" />
      <input id="apiKey" type="password" placeholder="apiKey (if required)" />
      <button id="refresh">Refresh</button>
    </div>
    <table>
      <thead>
        <tr>
          <th>Created</th><th>Signal ID</th><th>Symbol</th><th>Action</th><th>Volume</th>
          <th>SL/TP</th><th>Status</th><th>Stage</th><th>Dup Safe</th><th>Ack</th><th>Note</th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
  <script>
    const qs = new URLSearchParams(location.search);
    if (qs.get("apiKey")) document.getElementById("apiKey").value = qs.get("apiKey");
    async function load() {
      const status = document.getElementById("status").value;
      const limit = document.getElementById("limit").value || "200";
      const apiKey = document.getElementById("apiKey").value || "";
      const p = new URLSearchParams({ limit });
      if (status) p.set("status", status);
      if (apiKey) p.set("apiKey", apiKey);
      const res = await fetch("/mt5/trades?" + p.toString(), { headers: apiKey ? { "x-api-key": apiKey } : {} });
      const data = await res.json();
      if (!data.ok) {
        document.getElementById("meta").textContent = "Error: " + (data.error || "unknown");
        document.getElementById("rows").innerHTML = "";
        return;
      }
      document.getElementById("meta").textContent = "Total: " + data.count + " | Storage: " + data.storage + " | Updated: " + new Date().toLocaleTimeString();
      const tbody = document.getElementById("rows");
      tbody.innerHTML = data.trades.map(t => {
        const created = new Date(t.created_at).toLocaleString();
        const ack = [t.ack_status || "", t.ack_ticket || "", t.ack_error || ""].filter(Boolean).join(" | ");
        return "<tr>"
          + "<td>" + created + "</td>"
          + "<td class='muted'>" + (t.sid || "") + "</td>"
          + "<td>" + (t.symbol || "") + "</td>"
          + "<td>" + (t.action || "") + "</td>"
          + "<td>" + (t.volume ?? "") + "</td>"
          + "<td>" + (t.sl ?? "-") + " / " + (t.tp ?? "-") + "</td>"
          + "<td><span class='badge " + (t.status || "") + "'>" + (t.status || "") + "</span></td>"
          + "<td>" + (t.stage || "") + "</td>"
          + "<td>" + (t.dedupe_safe ? "YES" : "NO") + "</td>"
          + "<td class='muted'>" + ack + "</td>"
          + "<td class='muted'>" + (t.note || "") + "</td>"
          + "</tr>";
      }).join("");
    }
    document.getElementById("refresh").onclick = load;
    load();
    setInterval(load, 2500);
  </script>
</body>
</html>`;
}

const appHandler = async (req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, x-api-key, x-active-user-id, x-db-source, Cache-Control, Pragma",
    );
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const proto = req?.socket?.encrypted ? "https" : "http";
  const incomingUrl = new URL(
    req.url,
    `${proto}://${req.headers.host || "localhost"}`,
  );
  const isWebhookBasePath = incomingUrl.pathname === "/webhook";

  // NORMALIZE PATH: Support both /webhook/path and /path for routing
  if (incomingUrl.pathname.startsWith("/webhook/")) {
    incomingUrl.pathname = incomingUrl.pathname.substring(8);
  } else if (isWebhookBasePath) {
    incomingUrl.pathname = ["GET", "HEAD"].includes(req.method)
      ? "/health"
      : "/";
  }

  // Optimization: Any incoming webhook/POST potentially changes state
  if (req.method === "POST") {
    notifyPulse(null, "webhook");
  }
  const url = incomingUrl;
  const requestedDbSource =
    envStr(req.headers["x-db-source"]) ||
    envStr(url.searchParams.get("db_source")) ||
    envStr(url.searchParams.get("dbSource"));
  MT5_DB_SOURCE_CONTEXT.enterWith({ sourceId: requestedDbSource });
  // Also set global for async callbacks that lose the context
  global._requestDbSource = requestedDbSource;
  console.log("[db-source] request set global._requestDbSource =", requestedDbSource || "(empty)");
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  console.log(
    `[REQUEST] ${req.method} ${req.url} -> ${url.pathname} (IP: ${ip})`,
  );

  if (req.method === "GET" && url.pathname === "/v2/notifications/stream") {
    const sess = getUiSessionFromReq(req);
    const userId = sess.user_id || "*";
    // SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(":ok\n\n"); // initial comment to establish connection
    sseRegisterClient(userId, res);
    sseRegisterClient("*", res);
    // heartbeat every 30s
    const heartbeat = setInterval(() => {
      try {
        res.write(":ping\n\n");
      } catch (e) {
        clearInterval(heartbeat);
      }
    }, 30000);
    req.on("close", () => {
      clearInterval(heartbeat);
      sseRemoveClient(userId, res);
      sseRemoveClient("*", res);
    });
    return; // do not call json() — SSE is raw
  }

  if (req.method === "GET" && url.pathname === "/v2/notifications/pulse") {
    const sess = getUiSessionFromReq(req);
    const userId = sess.user_id;
    return json(res, 200, {
      ok: true,
      global: NOTIFICATION_PULSE.global,
      user: userId ? NOTIFICATION_PULSE.user[userId] || 0 : 0,
    });
  }

  if (req.method === "GET" && url.pathname === "/api/proxy/binance") {
    const target =
      "https://api.binance.com/api/v3/klines?" +
      incomingUrl.searchParams.toString();
    https
      .get(target, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        proxyRes.pipe(res);
      })
      .on("error", (err) => {
        json(res, 500, { error: err.message });
      });
    return;
  }

  const hostname = normalizeHostHeader(req.headers.host);

  if (
    req.method === "POST" &&
    /^\/v2\/broker\/accounts\/[^/]+\/apiKey$/.test(incomingUrl.pathname)
  ) {
    try {
      const accountId = decodeURIComponent(incomingUrl.pathname.split("/")[4]);
      const body = await readJson(req);
      const out = await (
        await mt5Backend()
      ).updateAccountApiKeyV2(accountId, body.api_key_plaintext);
      if (!out)
        return json(res, 404, { ok: false, error: "Account not found" });
      return json(res, 200, { ok: true, ...out });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (
    req.method === "DELETE" &&
    /^\/v2\/broker\/accounts\/[^/]+\/apiKey$/.test(incomingUrl.pathname)
  ) {
    try {
      const accountId = decodeURIComponent(incomingUrl.pathname.split("/")[4]);
      const out = await (
        await mt5Backend()
      ).updateAccountApiKeyV2(accountId, null);
      if (!out)
        return json(res, 404, { ok: false, error: "Account not found" });
      return json(res, 200, { ok: true, ...out });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/auth/me") {
    try {
      const sess = getUiSessionFromReq(req);
      if (!sess.ok)
        return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });

      // Eager Load common data for the SPA - catch individual errors to remain resilient
      const [sysCfg, accounts, watchlist, pendingSignals] = await Promise.all([
        repoGetSystemSettings().catch((e) => {
          console.error("[authMe] system settings fail:", e);
          return {};
        }),
        repoGetUserAccounts(sess.user_id).catch((e) => {
          console.error("[authMe] accounts fail:", e);
          return [];
        }),
        repoGetUserWatchlist(sess.user_id).catch((e) => {
          console.error("[authMe] watchlist fail:", e);
          return [];
        }),
        repoGetPendingSignals("all").catch((e) => {
          console.error("[authMe] signals fail:", e);
          return [];
        }),
      ]);

      return json(res, 200, {
        ok: true,
        user: {
          user_id: sess.user_id,
          name: sess.name,
          email: sess.email,
          role: sess.role,
          is_active: normalizeUserActive(sess.is_active, true),
          metadata: {
            ...(sess.metadata || {}),
            watchlist: watchlist || sess.metadata?.watchlist || [],
            default_provider_code:
              (Array.isArray(accounts) &&
                accounts[0]?.metadata?.provider_code) ||
              sess.metadata?.default_provider_code ||
              "ICMARKETS",
          },
        },
        eager_data: {
          system_settings: sysCfg || {},
          user_accounts: accounts || [],
          pending_signals: pendingSignals || [],
        },
      });
    } catch (err) {
      console.error("[authMe] fatal error:", err);
      return json(res, 500, {
        ok: false,
        error: "Internal Server Error during hydration",
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/auth/profile") {
    const sess = getUiSessionFromReq(req);
    if (!sess.ok) return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    const state =
      (await uiReadAuthStateByUserId(sess.user_id)) ||
      (await uiReadAuthStateByEmail(sess.email));
    if (!state)
      return json(res, 404, { ok: false, error: "Profile not found" });
    return json(res, 200, {
      ok: true,
      user: {
        user_id: state.user_id,
        name: state.name,
        email: state.email,
        role: state.role,
        is_active: normalizeUserActive(state.is_active, true),
        metadata: state.metadata || {},
      },
    });
  }

  if (req.method === "PUT" && url.pathname === "/auth/profile") {
    const sess = getUiSessionFromReq(req);
    if (!sess.ok) return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const payload = await readJson(req);
      const out = await uiAuthUpdateProfile(sess, payload || {});
      if (!out.ok)
        return json(res, 400, {
          ok: false,
          error: out.error || "Failed to update profile",
        });
      if (sess.token && UI_SESSIONS.has(sess.token)) {
        const cur = UI_SESSIONS.get(sess.token) || {};
        UI_SESSIONS.set(sess.token, {
          ...cur,
          email: out.user.email,
          name: out.user.name,
          role: out.user.role,
          user_id: out.user.user_id,
          is_active: normalizeUserActive(out.user.is_active, true),
        });
      }
      return json(res, 200, { ok: true, user: out.user });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "PUT" && url.pathname === "/auth/metadata") {
    const sess = getUiSessionFromReq(req);
    if (!sess.ok) return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const payload = await readJson(req);
      const db = await mt5InitBackend();
      const userId = sess.user_id;

      const current = (await dbQueries.getUserMetadata(db.db, userId)) || {};
      const next = { ...current, ...payload };
      if (
        current?.settings &&
        typeof current.settings === "object" &&
        payload?.settings &&
        typeof payload.settings === "object"
      ) {
        next.settings = {
          ...current.settings,
          ...payload.settings,
        };
      }

      await dbQueries.updateUserMetadata(db.db, userId, next);

      // Update session cache
      const token = sess.token;
      if (token && UI_SESSIONS.has(token)) {
        const s = UI_SESSIONS.get(token);
        s.metadata = next;
        UI_SESSIONS.set(token, s);
      }

      await StateRepo.del("USER_PROFILE", userId);
      await StateRepo.del("USER_WATCHLIST", userId);

      return json(res, 200, { ok: true, metadata: next });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/charts/multi") {
    const sess = getUiSessionFromReq(req);
    if (!sess.ok) return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    const symbol = url.searchParams.get("symbol");
    const tfsRaw = url.searchParams.get("tfs") || "";
    const tfs = tfsRaw.split(",").filter(Boolean);
    if (!symbol || !tfs.length)
      return json(res, 400, { ok: false, error: "Missing symbol or tfs" });
    const results = {};
    const tasks = tfs.map(async (tf) => {
      try {
        const data = await buildAnalysisSnapshotFromTwelve({
          userId: sess.user_id,
          symbol,
          timeframe: tf,
          payload: Object.fromEntries(url.searchParams),
        });
        results[tf] = data;
      } catch (e) {
        results[tf] = { status: "error", reason: e.message };
      }
    });
    await Promise.all(tasks);
    return json(res, 200, { ok: true, symbol, data: results });
  }

  if (req.method === "GET" && url.pathname === "/auth/users") {
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const users = await uiListUsers();
      return json(res, 200, { ok: true, users });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/auth/users") {
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const payload = await readJson(req);
      const out = await uiCreateUser(payload || {});
      if (!out.ok)
        return json(res, 400, {
          ok: false,
          error: out.error || "Failed to create user",
        });
      return json(res, 200, { ok: true, user: out.user });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (
    req.method === "GET" &&
    /^\/auth\/users\/[^/]+\/detail$/.test(url.pathname)
  ) {
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const userId = decodeURIComponent(
        url.pathname.slice("/auth/users/".length, -"/detail".length),
      );
      const out = await uiGetUserDetail(userId);
      if (!out.ok)
        return json(res, 400, {
          ok: false,
          error: out.error || "Failed to load user detail",
        });
      return json(res, 200, out);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (
    req.method === "POST" &&
    /^\/auth\/users\/[^/]+\/accounts$/.test(url.pathname)
  ) {
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const userId = decodeURIComponent(
        url.pathname.slice("/auth/users/".length, -"/accounts".length),
      );
      const payload = await readJson(req);
      const out = await uiUpsertUserAccount(userId, payload || {});
      if (!out.ok)
        return json(res, 400, {
          ok: false,
          error: out.error || "Failed to save account",
        });
      return json(res, 200, out);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (
    req.method === "PUT" &&
    /^\/auth\/users\/[^/]+\/accounts\/[^/]+$/.test(url.pathname)
  ) {
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const parts = url.pathname.split("/").filter(Boolean);
      const userId = decodeURIComponent(parts[2] || "");
      const accountId = decodeURIComponent(parts[4] || "");
      const payload = await readJson(req);
      const out = await uiUpsertUserAccount(userId, {
        ...(payload || {}),
        account_id: accountId,
      });
      if (!out.ok)
        return json(res, 400, {
          ok: false,
          error: out.error || "Failed to update account",
        });
      return json(res, 200, out);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (
    req.method === "DELETE" &&
    /^\/auth\/users\/[^/]+\/accounts\/[^/]+$/.test(url.pathname)
  ) {
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const parts = url.pathname.split("/").filter(Boolean);
      const userId = decodeURIComponent(parts[2] || "");
      const accountId = decodeURIComponent(parts[4] || "");
      const out = await uiDeleteUserAccount(userId, accountId);
      if (!out.ok)
        return json(res, 400, {
          ok: false,
          error: out.error || "Failed to delete account",
        });
      return json(res, 200, out);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (
    req.method === "POST" &&
    /^\/auth\/users\/[^/]+\/api-keys$/.test(url.pathname)
  ) {
    return json(res, 410, {
      ok: false,
      error:
        "User API key endpoints are removed. Use account API key rotation.",
    });
  }

  if (
    req.method === "PUT" &&
    /^\/auth\/users\/[^/]+\/api-keys\/[^/]+$/.test(url.pathname)
  ) {
    return json(res, 410, {
      ok: false,
      error:
        "User API key endpoints are removed. Use account API key rotation.",
    });
  }

  if (
    req.method === "DELETE" &&
    /^\/auth\/users\/[^/]+\/api-keys\/[^/]+$/.test(url.pathname)
  ) {
    return json(res, 410, {
      ok: false,
      error:
        "User API key endpoints are removed. Use account API key rotation.",
    });
  }

  if (req.method === "PUT" && /^\/auth\/users\/[^/]+$/.test(url.pathname)) {
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const userId = decodeURIComponent(
        url.pathname.slice("/auth/users/".length),
      );
      if (!userId)
        return json(res, 400, { ok: false, error: "user_id is required" });
      const payload = await readJson(req);
      const out = await uiUpdateUserById(userId, payload || {});
      if (!out.ok)
        return json(res, 400, {
          ok: false,
          error: out.error || "Failed to update user",
        });
      for (const [token, session] of UI_SESSIONS.entries()) {
        if (String(session?.user_id || "") !== String(userId)) continue;
        if (!normalizeUserActive(out.user?.is_active, true)) {
          UI_SESSIONS.delete(token);
          continue;
        }
        UI_SESSIONS.set(token, {
          ...session,
          name: out.user.name,
          email: out.user.email,
          role: out.user.role,
          is_active: normalizeUserActive(out.user.is_active, true),
        });
      }
      return json(res, 200, { ok: true, user: out.user });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "DELETE" && /^\/auth\/users\/[^/]+$/.test(url.pathname)) {
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const userId = decodeURIComponent(
        url.pathname.slice("/auth/users/".length),
      );
      if (!userId)
        return json(res, 400, { ok: false, error: "user_id is required" });
      const out = await uiDeleteUserById(userId);
      if (!out.ok)
        return json(res, 400, {
          ok: false,
          error: out.error || "Failed to delete user",
        });

      // Logout active sessions for this user
      for (const [token, session] of UI_SESSIONS.entries()) {
        if (String(session?.user_id || "") === String(userId)) {
          UI_SESSIONS.delete(token);
        }
      }
      return json(res, 200, { ok: true, message: "User deleted successfully" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (
    req.method === "POST" &&
    /^\/auth\/users\/[^/]+\/deactivate$/.test(url.pathname)
  ) {
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const base = url.pathname.slice(
        "/auth/users/".length,
        -"/deactivate".length,
      );
      const userId = decodeURIComponent(base.replace(/\/+$/, ""));
      if (!userId)
        return json(res, 400, { ok: false, error: "user_id is required" });
      const out = await uiUpdateUserById(userId, {
        is_active: false,
        role: "Guest",
      });
      if (!out.ok)
        return json(res, 400, {
          ok: false,
          error: out.error || "Failed to deactivate user",
        });
      for (const [token, session] of UI_SESSIONS.entries()) {
        if (String(session?.user_id || "") === String(userId))
          UI_SESSIONS.delete(token);
      }
      return json(res, 200, { ok: true, user: out.user });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/auth/login") {
    try {
      const payload = await readJson(req);
      const email = normalizeEmail(payload.email);
      const password = String(payload.password || "");
      if (!email || !password)
        return json(res, 400, {
          ok: false,
          error: "Email and password are required",
        });
      const authUser = await uiAuthGetVerifiedUser(email, password);
      if (!authUser)
        return json(res, 401, {
          ok: false,
          error: "Invalid email or password",
        });
      const token = createUiSession(authUser);
      setUiSessionCookie(req, res, token);
      return json(res, 200, { ok: true, user: authUser, token });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/auth/logout") {
    const sess = getUiSessionFromReq(req);
    if (sess.ok && sess.token) UI_SESSIONS.delete(sess.token);
    clearUiSessionCookie(req, res);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/auth/password") {
    const sess = getUiSessionFromReq(req);
    if (!sess.ok) return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const payload = await readJson(req);
      const currentPassword = String(payload.currentPassword || "");
      const newPassword = String(payload.newPassword || "");
      const changed = await uiAuthChangePassword(
        sess.email,
        currentPassword,
        newPassword,
      );
      if (!changed.ok)
        return json(res, 400, {
          ok: false,
          error: changed.error || "Failed to update password",
        });
      return json(res, 200, { ok: true, message: "Password updated" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (["GET", "HEAD"].includes(req.method) && url.pathname === "/") {
    res.writeHead(302, { Location: "/v2/chart/snapshots-grid/" });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/v2/db-sources") {
    const active = resolveMt5DbSource(currentMt5DbSourceId());
    const sources = mt5DbSources().map((source) => ({
      id: source.id,
      name: source.name,
      note: source.note,
      active: Boolean(active && source.id === active.id),
    }));
    return json(res, 200, {
      ok: true,
      active: active?.id || "",
      sources,
    });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res.setHeader("Cache-Control", "no-store");
    let postgresOk = false;
    let redisOk = false;
    let storageBackend = "unknown";
    try {
      const b = await mt5Backend();
      storageBackend = b?.storage || "unknown";
      if (b?.pool) {
        const pgRes = await b.pool.query("SELECT 1 AS ok");
        postgresOk = pgRes?.rows?.[0]?.ok === 1;
      } else if (b?.db) {
        // SQLite — just check db is accessible
        postgresOk = true;
      }
    } catch {}
    try {
      if (createRedisClient) {
        const rc = createRedisClient({
          url: CFG.redisUrl || "redis://127.0.0.1:6379",
        });
        await rc.connect();
        redisOk = (await rc.ping()) === "PONG";
        await rc.disconnect();
      }
    } catch {}
    const cronConfigs = await healthCronConfigDiagnostics();
    const cronStatusByName = await healthCronStatusesByName();
    const bullmq = await getBullmqStatus();
    const overallOk = postgresOk && (redisOk || !CFG.redisEnabled);
    const cronDiag = {
      scheduler_running: Boolean(CRON_STATE.isRunning),
      loop_status: global._cronStatus || "unknown",
      interval_seconds: 60,
      queue_mode: MARKET_DATA_QUEUE ? "bullmq" : "inline_or_disabled",
      queue_ready: Boolean(MARKET_DATA_QUEUE && MARKET_DATA_WORKER),
      queue_enabled:
        Boolean(CFG.marketDataCronEnabled) &&
        Boolean(CFG.marketDataCronQueueEnabled) &&
        Boolean(CFG.redisEnabled),
      last_run_trackers: {
        market_data_keys: Object.keys(CRON_STATE.lastMarketDataRun || {})
          .length,
        analysis_keys: Object.keys(CRON_STATE.lastAiAnalysisRun || {}).length,
        snapshots_keys: Object.keys(CRON_STATE.lastSnapshotsRun || {}).length,
      },
      configs: cronConfigs,
      recent_events_count: Array.isArray(global._cronEvents)
        ? global._cronEvents.length
        : 0,
    };
    return json(res, 200, {
      ok: overallOk,
      service: "telegram-trading-bot",
      version: SERVER_VERSION,
      binanceEnabled: CFG.binanceEnabled,
      binanceMode: CFG.binanceMode || null,
      ctraderEnabled: CFG.ctraderEnabled,
      ctraderMode: CFG.ctraderMode || null,
      mt5Enabled: CFG.mt5Enabled,
      postgres: postgresOk ? "ok" : "error",
      storage: storageBackend,
      redis: redisOk ? "ok" : CFG.redisEnabled ? "error" : "disabled",
      redisEnabled: CFG.redisEnabled || false,
      cron: global._cronStatus || "unknown",
      cronMarketDataEnabled: CFG.marketDataCronEnabled || false,
      cronAiEnabled: true,
      cronSnapshotsEnabled: true,
      cronDetails: global._cronDetails || {},
      cronEvents: global._cronEvents || [],
      cronStatusByName,
      bullmq,
      log_sources: scanLogSources(),
      sources: {
        ctrader: {
          id: "Ctrader",
          connected: SOURCE_STATUS.ctrader.connected,
          enabled: SOURCE_STATUS.ctrader.enabled,
          lastActivity: SOURCE_STATUS.ctrader.lastActivity,
        },
        mt5: {
          id: "MT5",
          connected: SOURCE_STATUS.mt5.connected,
          enabled: SOURCE_STATUS.mt5.enabled,
          lastActivity: SOURCE_STATUS.mt5.lastActivity,
        },
        binance: {
          id: "Binance",
          connected: SOURCE_STATUS.binance.connected,
          enabled: SOURCE_STATUS.binance.enabled,
          lastActivity: SOURCE_STATUS.binance.lastActivity,
        },
      },
      diagnostics: {
        cron: cronDiag,
        endpoints: {
          health: { path: "/health", auth: "none", included_in_health: true },
          mt5Health: {
            path: "/mt5/health",
            auth: "none",
            included_in_health: true,
            summary: {
              mt5_enabled: CFG.mt5Enabled,
              has_tv_api_keys: CFG.mt5TvAlertApiKeys.size > 0,
              has_ea_api_keys: CFG.mt5EaApiKeys.size > 0,
            },
          },
          dashboardSummary: {
            path: "/mt5/dashboard/summary",
            auth: "admin_key",
            included_in_health: false,
          },
          dashboardAdvanced: {
            path: "/mt5/dashboard/advanced",
            auth: "admin_key",
            included_in_health: false,
          },
        },
      },
    });
  }

  if (req.method === "GET" && url.pathname === "/v2/bullmq/status") {
    const bullmq = await getBullmqStatus();
    return json(res, 200, bullmq);
  }

  if (req.method === "POST" && url.pathname === "/v2/cron/master/toggle") {
    const body = await readJson(req);
    if (typeof body.active === "boolean") {
      CRON_STATE.masterActive = body.active;
      console.log("[Cron] Master", body.active ? "ACTIVATED" : "PAUSED");
    } else {
      CRON_STATE.masterActive = !CRON_STATE.masterActive;
      console.log("[Cron] Master toggled:", CRON_STATE.masterActive ? "ACTIVE" : "PAUSED");
    }
    return json(res, 200, { ok: true, active: CRON_STATE.masterActive });
  }

  if (req.method === "GET" && url.pathname === "/v2/cron/snapshots/latest") {
    const limit = Math.max(
      1,
      Math.min(50, Number(url.searchParams.get("limit") || 5) || 5),
    );
    const runs = await getHealthActivity(limit, "CRON:");
    return json(res, 200, {
      ok: true,
      count: runs.length,
      runs,
    });
  }

  if (req.method === "GET" && url.pathname === "/v2/system/sources") {
    const sources = scanLogSources();
    return json(res, 200, { ok: true, sources });
  }

  if (req.method === "GET" && url.pathname === "/v2/system/logs/file") {
    const source = String(url.searchParams.get("source") || "").replace(
      /[^a-z]/g,
      "",
    );
    const id = String(url.searchParams.get("id") || "").replace(
      /[^A-Za-z0-9_.-]/g,
      "_",
    );
    const file = String(url.searchParams.get("file") || "").replace(
      /[^A-Za-z0-9_.-]/g,
      "_",
    );
    const limit = Math.max(
      1,
      Math.min(500, Number(url.searchParams.get("limit") || 100)),
    );
    if (!source || !id || !file)
      return json(res, 400, { ok: false, error: "source, id, file required" });
    // Try nested path first, then flat (source/file.log)
    let filePath = path.join(SERVER_LOG_DIR, source, id, file + ".log");
    if (!fs.existsSync(filePath)) {
      filePath = path.join(SERVER_LOG_DIR, source, file + ".log");
    }
    if (!fs.existsSync(filePath))
      return json(res, 404, { ok: false, error: "file not found" });
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const lines = raw.split("\n").filter(Boolean);
      const tail = lines.slice(-limit);
      return json(res, 200, {
        ok: true,
        source,
        id,
        file,
        total_lines: lines.length,
        lines: tail,
      });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/health/activity") {
    const limit = Math.max(
      1,
      Math.min(500, Number(url.searchParams.get("limit") || 100) || 100),
    );
    const prefix = String(url.searchParams.get("prefix") || "").trim();
    const items = await getHealthActivity(limit, prefix);
    return json(res, 200, { ok: true, count: items.length, items });
  }

  if (req.method === "GET" && url.pathname === "/v2/health/symbol-activity") {
    const limit = Math.max(
      1,
      Math.min(1000, Number(url.searchParams.get("limit") || 200) || 200),
    );
    const items = await getSymbolActivity(limit);
    return json(res, 200, { ok: true, count: items.length, items });
  }

  if (req.method === "GET" && url.pathname === "/mt5/health") {
    if (!CFG.mt5Enabled) {
      return json(res, 200, {
        ok: true,
        service: "mt5-bridge",
        version: SERVER_VERSION,
        enabled: false,
        storage: "postgres",
        hasTvApiKeys: CFG.mt5TvAlertApiKeys.size > 0,
        hasEaApiKeys: CFG.mt5EaApiKeys.size > 0,
        pruneEnabled: CFG.mt5PruneEnabled,
        pruneDays: CFG.mt5PruneDays,
        pruneIntervalMinutes: CFG.mt5PruneIntervalMinutes,
      });
    }
    const b = await mt5Backend();
    return json(res, 200, {
      ok: true,
      service: "mt5-bridge",
      version: SERVER_VERSION,
      enabled: CFG.mt5Enabled,
      storage: b.storage,
      hasTvApiKeys: CFG.mt5TvAlertApiKeys.size > 0,
      hasEaApiKeys: CFG.mt5EaApiKeys.size > 0,
      dbPath: b.info.path || null,
      postgresConfigured: b.storage === "postgres",
      pruneEnabled: CFG.mt5PruneEnabled,
      pruneDays: CFG.mt5PruneDays,
      pruneIntervalMinutes: CFG.mt5PruneIntervalMinutes,
    });
  }

  if (req.method === "GET" && url.pathname === "/mt5/dashboard/summary") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const limitRaw = Number(url.searchParams.get("limit") || 5000);
      const limit = Math.max(
        100,
        Math.min(50000, Number.isFinite(limitRaw) ? limitRaw : 5000),
      );
      const userId = uiEffectiveUserId(req, url);
      const rows = await mt5ListSignals(limit, "", userId);

      const metrics = mt5ComputeMetrics(rows);
      return json(res, 200, {
        ok: true,
        version: SERVER_VERSION,
        user_id: userId || null,
        metrics,
        benefit: {
          today: mt5ComputeMetrics(
            mt5FilterRows(rows, { from: mt5PeriodRange("today").start }),
          ).pnl_money_realized,
          week: mt5ComputeMetrics(
            mt5FilterRows(rows, { from: mt5PeriodRange("week").start }),
          ).pnl_money_realized,
          month: mt5ComputeMetrics(
            mt5FilterRows(rows, { from: mt5PeriodRange("month").start }),
          ).pnl_money_realized,
        },
        status_counts: mt5CountBy(rows, (r) =>
          mt5CanonicalStoredStatus(r.status),
        ),
        action_counts: mt5CountBy(rows, (r) =>
          String(r.action || "").toUpperCase(),
        ),
        order_type_counts: mt5CountBy(rows, (r) =>
          String(r.raw_json?.order_type || "limit").toUpperCase(),
        ),
        top_symbols: mt5CountBy(
          rows,
          (r) => String(r.symbol || "").toUpperCase(),
          { limit: 10 },
        ),
        latest_unprocessed: rows
          .filter((r) => ["NEW", "LOCKED"].includes(r.status))
          .slice(0, 20)
          .map(mt5PublicState),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "GET" && url.pathname === "/mt5/dashboard/advanced") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const limitRaw = Number(url.searchParams.get("limit") || 100000);
      const limit = Math.max(
        500,
        Math.min(200000, Number.isFinite(limitRaw) ? limitRaw : 100000),
      );
      const userId = uiEffectiveUserId(req, url);
      const accountId = envStr(url.searchParams.get("account_id"));
      const symbol = envStr(url.searchParams.get("symbol")).toUpperCase();
      const sourceId = envStr(
        url.searchParams.get("source_id") ||
          url.searchParams.get("source") ||
          url.searchParams.get("strategy"),
      );
      const model = envStr(
        url.searchParams.get("entry_model") || url.searchParams.get("model"),
      );
      const chartTf = envStr(
        url.searchParams.get("chart_tf") || url.searchParams.get("chartTf"),
      );
      const signalTf = envStr(
        url.searchParams.get("signal_tf") || url.searchParams.get("timeframe"),
      );
      const direction = envStr(url.searchParams.get("direction")).toUpperCase();
      const range = envStr(url.searchParams.get("range"), "all").toLowerCase();

      // Use V2 trades ledger for authoritative dashboard stats.
      // listTradesV2 is capped at 200/page; page through results to avoid dropping older losses.
      const baseTradeFilter = {
        user_id: userId,
        account_id: accountId,
        symbol: symbol,
        source_id: sourceId,
        side: direction === "BUY" ? "BUY" : direction === "SELL" ? "SELL" : "",
      };
      const fetchLimit = Math.max(500, Math.min(limit, 200000));
      const pageSize = 200;
      const allRows = [];
      let page = 1;
      while (allRows.length < fetchLimit) {
        const tradesRes = await mt5ListTradesV2(
          baseTradeFilter,
          page,
          pageSize,
        );
        const items = Array.isArray(tradesRes?.items) ? tradesRes.items : [];
        if (!items.length) break;
        allRows.push(...items);
        if (items.length < pageSize) break;
        if (allRows.length >= Number(tradesRes?.total || 0)) break;
        page += 1;
      }
      const rowsByDimension = allRows.filter((r) => {
        const m = r.metadata || {};
        const rowModel = String(r.entry_model || r.metadata?.entry_model || "");
        if (model && rowModel !== model) return false;
        const rowChartTf = String(r.chart_tf || r.metadata?.chart_tf || "");
        if (chartTf && rowChartTf !== chartTf) return false;
        const rowSignalTf = String(r.signal_tf || r.metadata?.signal_tf || "");
        if (signalTf && rowSignalTf !== signalTf) return false;
        return true;
      });

      const period = mt5LocalPeriodRange(range);
      const selectedRows = mt5FilterRows(rowsByDimension, {
        from: period.start,
        to: period.end,
      });

      const periods = [
        "all",
        "today",
        "yesterday",
        "last_week",
        "last_month",
        "week",
        "month",
        "year",
      ];
      const periodTotals = {};
      for (const p of periods) {
        const pr = mt5LocalPeriodRange(p);
        const scopedRows = mt5FilterRows(rowsByDimension, {
          from: pr.start,
          to: pr.end,
        });
        const metrics = mt5ComputeTradeMetrics(scopedRows);
        periodTotals[p] = {
          total_pnl: metrics.total_pnl,
          total_rr: metrics.total_rr,
          total_trades: metrics.total_trades,
          total_wins: metrics.wins,
          total_losses: metrics.losses,
          win_sum_pnl: metrics.win_sum_pnl,
          lose_sum_pnl: metrics.lose_sum_pnl,
        };
      }

      const seriesBucket = range === "today" ? "hour" : "day";
      const seriesMap = new Map();
      for (const r of selectedRows) {
        const s = mt5CanonicalStoredStatus(
          r.execution_status || r.status || r.close_reason,
        );
        const res = String(r?.close_reason || r?.reason || "").toUpperCase();
        // Use unified PnL field (pnl_realized for trades, pnl_money_realized for signals)
        const pnl = Number(r.pnl_realized ?? r.pnl_money_realized);
        if (
          !["CLOSED", "TP", "SL"].includes(s) &&
          res !== "TP" &&
          res !== "SL" &&
          !(s === "CANCEL" && Number.isFinite(pnl))
        )
          continue;
        if (!Number.isFinite(pnl)) continue;
        const d = new Date(r.closed_at || r.ack_at || r.created_at);
        if (!Number.isFinite(d.getTime())) continue;
        const key =
          seriesBucket === "hour"
            ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00`
            : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        seriesMap.set(key, (seriesMap.get(key) || 0) + pnl);
      }
      const pnlSeries = [...seriesMap.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([x, y]) => ({ x, y }));

      const symbols = [
        ...new Set(
          rowsByDimension
            .map((r) => String(r.symbol || "").toUpperCase())
            .filter(Boolean),
        ),
      ].sort();
      const accounts = [
        ...new Set(allRows.map((r) => envStr(r.account_id)).filter(Boolean)),
      ].sort();

      const accountsSummary = await mt5ListAccountsV2(userId);

      return json(res, 200, {
        ok: true,
        version: SERVER_VERSION,
        accounts_summary: accountsSummary || [],
        filters: {
          user_id: userId || "",
          symbol,
          source: sourceId,
          entry_model: model,
          chart_tf: chartTf,
          signal_tf: signalTf,
          direction,
          range,
          accounts,
          symbols,
          sources: [
            ...new Set(
              allRows.map((r) => mt5SourceIdFromRow(r)).filter(Boolean),
            ),
          ].sort(),
          strategies: [
            ...new Set(
              allRows.map((r) => mt5StrategyLabelFromRow(r)).filter(Boolean),
            ),
          ].sort(),
          entry_models: [
            ...new Set(
              allRows.map((r) => mt5EntryModelLabelFromRow(r)).filter(Boolean),
            ),
          ].sort(),
          chart_tfs: [
            ...new Set(
              allRows
                .map((r) =>
                  String(
                    r.chart_tf ||
                      r.raw_json?.chart_tf ||
                      r.raw_json?.chartTf ||
                      r.raw_json?.chartTimeframe ||
                      r.signal_tf ||
                      r.raw_json?.signal_tf ||
                      r.raw_json?.sourceTf ||
                      r.raw_json?.timeframe ||
                      "",
                  ),
                )
                .filter(Boolean),
            ),
          ].sort(),
          signal_tfs: [
            ...new Set(
              allRows
                .map((r) =>
                  String(
                    r.signal_tf ||
                      r.raw_json?.signal_tf ||
                      r.raw_json?.sourceTf ||
                      r.raw_json?.timeframe ||
                      "",
                  ),
                )
                .filter(Boolean),
            ),
          ].sort(),
        },
        metrics: mt5ComputeTradeMetrics(selectedRows),
        period_totals: periodTotals,
        top_winrate: {
          symbols: mt5ComputeTopWinrateRows(
            selectedRows,
            (r) => String(r.symbol || "").toUpperCase(),
            { limit: 100, includeDirection: false },
          ),
          entry_models: mt5ComputeTopWinrateRows(
            selectedRows,
            (r) => mt5EntryModelLabelFromRow(r),
            { limit: 100, includeDirection: false },
          ),
          strategies: mt5ComputeTopWinrateRows(
            selectedRows,
            (r) => mt5StrategyLabelFromRow(r),
            { limit: 100, includeDirection: false },
          ),
          accounts: mt5ComputeTopWinrateRows(
            selectedRows,
            (r) => envStr(r.account_id),
            { limit: 100, includeDirection: false },
          ),
          sources: mt5ComputeTopWinrateRows(
            selectedRows,
            (r) => mt5SourceIdFromRow(r),
            { limit: 100, includeDirection: false },
          ),
          directional: mt5ComputeTopWinrateRows(
            selectedRows,
            (r) => {
              const dir = String(r.action || r.side || "BUY").toLowerCase();
              const typeRaw = mt5OrderTypeFromRow(r);
              const capitalize = (s) =>
                s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
              return `${capitalize(dir)} ${capitalize(typeRaw)}`;
            },
            { limit: 100, includeDirection: false },
          ),
        },
        pnl_series: pnlSeries,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "GET" && url.pathname === "/mt5/dashboard/pnl-series") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const limitRaw = Number(url.searchParams.get("limit") || 5000);
      const limit = Math.max(
        100,
        Math.min(50000, Number.isFinite(limitRaw) ? limitRaw : 5000),
      );
      const period = envStr(
        url.searchParams.get("period"),
        "month",
      ).toLowerCase();
      const userId = uiEffectiveUserId(req, url);
      const range = mt5PeriodRange(period);
      const rows = await mt5ListSignals(limit, "", userId);
      const filtered = mt5FilterRows(rows, {
        from: range.start,
        to: range.end,
      });
      const bucket = period === "today" ? "hour" : "day";
      const map = new Map();
      for (const r of filtered) {
        const s = mt5CanonicalStoredStatus(
          r.execution_status || r.status || r.close_reason,
        );
        if (!["CLOSED", "TP", "SL"].includes(s)) continue;
        const pnl = Number(r.pnl_money_realized);
        if (!Number.isFinite(pnl)) continue;
        const d = new Date(r.closed_at || r.ack_at || r.created_at);
        if (!Number.isFinite(d.getTime())) continue;
        const key =
          bucket === "hour"
            ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:00`
            : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        map.set(key, (map.get(key) || 0) + pnl);
      }
      const points = [...map.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([x, y]) => ({ x, y }));
      return json(res, 200, { ok: true, period, points });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "GET" && url.pathname === "/mt5/filters/advanced") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const userId = uiEffectiveUserId(req, url);
      const limitRaw = Number(url.searchParams.get("limit") || 20000);
      const limit = Math.max(
        1000,
        Math.min(100000, Number.isFinite(limitRaw) ? limitRaw : 20000),
      );
      const rows = await mt5ListSignals(limit, "", userId);
      const symbols = [
        ...new Set(rows.map((r) => String(r.symbol || "").toUpperCase())),
      ]
        .filter(Boolean)
        .sort();
      const sources = [...new Set(rows.map((r) => mt5StrategyFromRow(r)))]
        .filter(Boolean)
        .sort();
      const models = [...new Set(rows.map((r) => mt5EntryModelFromRow(r)))]
        .filter(Boolean)
        .sort();
      const chartTfs = [
        ...new Set(
          rows.map((r) =>
            String(
              r.chart_tf ||
                r.raw_json?.chart_tf ||
                r.raw_json?.chartTf ||
                r.raw_json?.chartTimeframe ||
                r.signal_tf ||
                r.raw_json?.signal_tf ||
                r.raw_json?.sourceTf ||
                r.raw_json?.timeframe ||
                "",
            ),
          ),
        ),
      ]
        .filter(Boolean)
        .sort();
      const signalTfs = [
        ...new Set(
          rows.map((r) =>
            String(
              r.signal_tf ||
                r.raw_json?.signal_tf ||
                r.raw_json?.sourceTf ||
                r.raw_json?.timeframe ||
                "",
            ),
          ),
        ),
      ]
        .filter(Boolean)
        .sort();
      return json(res, 200, {
        ok: true,
        symbols,
        sources,
        entry_models: models,
        chart_tfs: chartTfs,
        signal_tfs: signalTfs,
      });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/mt5/filters/symbols") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const limitRaw = Number(url.searchParams.get("limit") || 10000);
      const limit = Math.max(
        100,
        Math.min(50000, Number.isFinite(limitRaw) ? limitRaw : 10000),
      );
      const userId = uiEffectiveUserId(req, url);
      const rows = await mt5ListSignals(limit, "", userId);
      const symbols = [
        ...new Set(
          rows.map((r) => String(r.symbol || "").toUpperCase()).filter(Boolean),
        ),
      ].sort();
      return json(res, 200, { ok: true, symbols });
    } catch (error) {
      console.error(
        "[mt5/filters/symbols] ERROR",
        error instanceof Error ? error.message : String(error),
      );
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "GET" && url.pathname === "/mt5/trades/search") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const pageRaw = Number(url.searchParams.get("page") || 1);
      const pageSizeRaw = Number(url.searchParams.get("pageSize") || 20);
      const page = Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1);
      const pageSize = Math.max(
        5,
        Math.min(200, Number.isFinite(pageSizeRaw) ? pageSizeRaw : 20),
      );
      const { rows } = await mt5GetFilteredTrades(url, null, 10000);

      const total = rows.length;
      const start = (page - 1) * pageSize;
      const data = rows.slice(start, start + pageSize).map(mt5PublicState);
      return json(res, 200, {
        ok: true,
        page,
        pageSize,
        total,
        pages: Math.max(1, Math.ceil(total / pageSize)),
        trades: data,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (false && req.method === "POST" && url.pathname === "/v2/signals/create") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    const sess = getUiSessionFromReq(req);
    if (!requireAdminKey(req, res, url)) return;

    try {
      const payload = await readJson(req);
      const source = mt5NormalizeUiSource(payload.source, "ui_manual");
      const timeframe = String(payload.timeframe || payload.tf || "").trim();
      const strategy = String(
        payload.strategy || (source.startsWith("ai_") ? source : "Manual"),
      ).trim();
      const effectiveUserId =
        uiEffectiveUserId(req, url, payload) ||
        sess.user_id ||
        CFG.mt5DefaultUserId;
      const rawPayload =
        payload && typeof payload === "object" ? { ...payload } : {};
      const existingSnapshot =
        rawPayload.analysis_snapshot &&
        typeof rawPayload.analysis_snapshot === "object"
          ? rawPayload.analysis_snapshot
          : null;
      if (
        existingSnapshot &&
        String(existingSnapshot?.status || "").toLowerCase() === "ok" &&
        Array.isArray(existingSnapshot?.bars) &&
        existingSnapshot.bars.length
      ) {
        rawPayload.analysis_snapshot = existingSnapshot;
      } else {
        const analysisSnapshot = await buildAnalysisSnapshotFromTwelve({
          userId: effectiveUserId,
          payload: rawPayload,
          symbol: payload.symbol,
          timeframe: timeframe || "15m",
        }).catch(() => null);
        if (analysisSnapshot && typeof analysisSnapshot === "object") {
          rawPayload.analysis_snapshot = analysisSnapshot;
        }
      }
      const enqueue = await mt5EnqueueSignalFromPayload(
        {
          id: payload.sid || payload.id || "",
          action: payload.action,
          symbol: payload.symbol,
          volume: payload.volume ?? payload.lots,
          sl: payload.sl ?? null,
          tp: payload.tp ?? null,
          rr: payload.rr ?? payload.risk_reward ?? null,
          risk_money: payload.risk_money ?? payload.money_risk ?? null,
          risk_pct: payload.risk_pct ?? payload.riskPct ?? null,
          price: payload.price ?? payload.entry ?? null,
          strategy,
          entry_model:
            payload.entry_model ?? payload.model ?? payload.strategy ?? null,
          timeframe: timeframe || "manual",
          note: payload.note || "",
          user_id: effectiveUserId,
          order_type: payload.order_type || "limit",
          provider: source.startsWith("ai_") ? source : "ui",
          only_signal: Boolean(payload.only_signal ?? payload.onlySignal),
          raw_json:
            rawPayload.raw_json && typeof rawPayload.raw_json === "object"
              ? rawPayload.raw_json
              : rawPayload,
        },
        {
          source,
          eventType: "UI_CREATE_TRADE",
          fallbackIdPrefix: "ui",
        },
        null,
      );

      notifyPulse(effectiveUserId, "signals");

      return json(res, 200, { ok: true, trade: enqueue, signal: enqueue });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/trades/create") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    const sess = getUiSessionFromReq(req);
    if (!requireAdminKey(req, res, url)) return;
    try {
      const payload = await readJson(req);
      const source = mt5NormalizeUiSource(payload.source, "ui_manual");
      const sourceId = mt5SlugId(source, "tradingview");
      const effectiveUserId =
        uiEffectiveUserId(req, url, payload) ||
        sess.user_id ||
        CFG.mt5DefaultUserId;
      const action = mt5NormalizeAction(payload);
      const symbol = mt5NormalizeSymbol(payload);
      const volume = mt5NormalizeVolume(payload);
      const derived = mt5DeriveEntryModelAndNote(payload, {
        fallbackModel: payload.strategy || source || "MANUAL",
      });
      const entryModel = derived.entryModel || null;
      const signalTf =
        mt5TfToMinutes(
          payload.signal_tf ??
            payload.signalTf ??
            payload.sourceTf ??
            payload.timeframe ??
            payload.tf,
        ) || null;
      const chartTf =
        mt5TfToMinutes(
          payload.chart_tf ??
            payload.chartTf ??
            payload.chartTimeframe ??
            payload.chart_tf_period,
        ) || null;
      const entry = asNum(payload.entry ?? payload.price, NaN);
      const sl = asNum(payload.sl, NaN);
      const note = String(derived.note || payload.note || "").trim();
      const tpNorm = mt5NormalizeTpFields(payload, mt5MapActionToSide(action));
      const tp = asNum(tpNorm.tp, NaN);
      const rawPayload =
        payload && typeof payload === "object" ? { ...payload } : {};
      const sessionPrefix = sanitizeSessionPrefix(
        payload.session_prefix ||
          payload.sessionPrefix ||
          rawPayload?.session_prefix ||
          rawPayload?.sessionPrefix ||
          "",
      );
      const sidBaseRaw = String(
        payload.sid ||
          payload.trade_sid ||
          rawPayload?.sid ||
          rawPayload?.trade_sid ||
          "",
      ).trim();
      const tradeSidBase = sidBaseRaw
        ? normalizePublicSidBase(sidBaseRaw, "TRD")
        : normalizePublicSidBase(
            sessionPrefix ? `${symbol}_${sessionPrefix}` : `${symbol}_TRD`,
            "TRD",
          );
      if (!symbol)
        return json(res, 400, { ok: false, error: "symbol is required" });
      if (
        !Number.isFinite(entry) ||
        !Number.isFinite(sl) ||
        !Number.isFinite(tp)
      ) {
        return json(res, 400, {
          ok: false,
          error: "entry/sl/tp are required numeric values",
        });
      }

      await mt5UpsertSourceV2({
        source_id: sourceId,
        name: source,
        kind: sourceId.includes("tv") ? "tv" : "api",
        auth_mode: "token",
        is_active: true,
        metadata: {
          migrated_from: "ui_trade_direct",
          signal_source: source,
        },
      }).catch(() => null);

      const fanout = await mt5FanoutSignalTradeV2({
        signal_id: null,
        source_id: sourceId,
        user_id: effectiveUserId,
        entry_model: entryModel,
        signal_tf: signalTf,
        chart_tf: chartTf,
        symbol,
        action: mt5MapActionToSide(action),
        entry,
        sl: Number.isFinite(sl) ? sl : null,
        tp: Number.isFinite(tpNorm.tp) ? tpNorm.tp : null,
        tp1: tpNorm.tp1,
        tp2: tpNorm.tp2,
        tp3: tpNorm.tp3,
        tp_targets: tpNorm.tp_targets,
        volume: volume ?? null,
        rr_planned: asNum(
          payload.rr_planned ?? payload.rr ?? payload.risk_reward,
        ),
        risk_money_planned: asNum(
          payload.risk_money_planned ??
            payload.risk_money ??
            payload.money_risk,
        ),
        risk_pct_planned: asNum(
          payload.risk_pct_planned ??
            payload.risk_pct ??
            payload.riskPct ??
            payload.vol ??
            payload.volume ??
            payload.lots,
        ),
        note: note || null,
        sid: tradeSidBase,
        trade_sid: tradeSidBase,
        session_prefix: sessionPrefix || null,
        execution_status: payload.execution_status || undefined,
        metadata: {
          event_type: "UI_CREATE_TRADE_DIRECT",
          order_type: payload.order_type || "limit",
          signal_tf: signalTf,
          chart_tf: chartTf,
          provider: payload.provider || null,
          session_prefix: sessionPrefix || null,
          entry_model_raw: derived.entryModelRaw || null,
          snapshot_files: Array.isArray(payload?.snapshot_files)
            ? payload.snapshot_files
                .map((f) => normalizeSnapshotFileName(f))
                .filter(Boolean)
            : [],
          raw_json:
            rawPayload?.raw_json && typeof rawPayload.raw_json === "object"
              ? rawPayload.raw_json
              : rawPayload,
          analysis_snapshot:
            rawPayload?.analysis_snapshot &&
            typeof rawPayload.analysis_snapshot === "object"
              ? rawPayload.analysis_snapshot
              : null,
        },
      });
      notifyPulse(effectiveUserId, "trades");
      invalidateTradeListCaches().catch(() => {});
      const actualSid =
        Array.isArray(fanout?.sids) && fanout.sids.length > 0
          ? fanout.sids[0]
          : tradeSidBase;
      const createdSids = Array.isArray(fanout?.sids)
        ? fanout.sids
        : [actualSid];
      const copiedBySid = {};
      const persistedBySid = {};
      for (const sid of createdSids) {
        const copied = copySnapshotsToTradeSidFolder(
          sid,
          Array.isArray(payload?.snapshot_files) ? payload.snapshot_files : [],
          symbol,
        );
        const analyzeFile = copyAnalyzeSnapshotToTradeSession(sid, symbol);
        // Copy session files from analyze session folder if SIDs differ
        const sessionSid = String(
          payload?.session_id || payload?.sid || "",
        ).trim();
        if (sessionSid) {
          moveTradeFolder(sessionSid, "files", "active", symbol);
          if (sessionSid !== sid) {
            const srcDir =
              findExistingTradeDir(
                String(sessionSid || "")
                  .trim()
                  .replace(/[^A-Za-z0-9_.-]/g, "_"),
              ) || "";
            if (fs.existsSync(srcDir)) {
              const destDir = ensureTradeFilesDir(sid, symbol);
              if (!fs.existsSync(destDir))
                fs.mkdirSync(destDir, { recursive: true });
              for (const entry of fs.readdirSync(srcDir, {
                withFileTypes: true,
              })) {
                const src = path.join(srcDir, entry.name);
                const dest = path.join(destDir, entry.name);
                try {
                  fs.cpSync(src, dest, { recursive: true });
                } catch {}
              }
            }
          }
        }
        const mergedCopied = [
          ...new Set(
            [
              ...(Array.isArray(copied) ? copied : []),
              ...(analyzeFile ? [analyzeFile] : []),
            ].filter(Boolean),
          ),
        ];
        copiedBySid[sid] = mergedCopied;
        persistedBySid[sid] = await persistTradeSnapshotFiles(
          sid,
          mergedCopied,
          symbol,
        );
      }
      return json(res, 200, {
        ok: true,
        created: fanout?.created || 0,
        sid: actualSid,
        trade: { sid: actualSid },
        snapshot_folder: `trade-${actualSid}/snapshots`,
        snapshot_copied: copiedBySid[actualSid] || [],
        snapshot_copied_by_sid: copiedBySid,
        snapshot_persisted_by_sid: persistedBySid,
        account_ids: fanout?.account_ids || [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/mt5/trades/delete") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const payload = await readJson(req);
      if (!requireAdminKey(req, res, url, payload)) return;
      const { rows, filters, limit } = await mt5GetFilteredTrades(
        url,
        payload,
        50000,
      );
      const ids = rows.map((r) => String(r.sid || "")).filter(Boolean);
      const removed = await mt5DeleteSignalsByIds(ids);
      const cleanup = await mt5CleanupSignalTradeArtifacts({
        signalRows: rows,
        signalIds: ids,
      });
      return json(res, 200, {
        ok: true,
        deleted: removed.deleted || 0,
        logs_deleted: cleanup.logs_deleted || 0,
        files_deleted: cleanup.files_deleted || 0,
        matched: ids.length,
        filters,
        scanned_limit: limit,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/mt5/trades/cancel") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const payload = await readJson(req);
      if (!requireAdminKey(req, res, url, payload)) return;
      const closeReason = String(
        payload?.cancel_reason ||
          payload?.close_reason ||
          payload?.reason ||
          "",
      ).trim();
      const effectiveCloseReason = closeReason || "CANCEL";
      const { rows, filters, limit } = await mt5GetFilteredTrades(
        url,
        payload,
        50000,
      );
      const ids = rows.map((r) => String(r.sid || "")).filter(Boolean);
      // Also check trades table for direct trade IDs
      if (payload.ids || payload.sids || payload.q) {
        const tradeRefs = Array.isArray(payload.ids || payload.sids)
          ? payload.ids || payload.sids
          : [String(payload.q || "").trim()].filter(Boolean);
        if (tradeRefs.length) {
          const b = await mt5Backend();
          const tradeRes = await b.pool.query(
            `UPDATE trades SET execution_status = CASE WHEN execution_status = 'PENDING' THEN 'CANCELLED' ELSE execution_status END, dispatch_status = CASE WHEN broker_trade_id IS NOT NULL AND broker_trade_id <> '' THEN 'CANCEL' ELSE 'CONSUMED' END, close_reason = COALESCE($2::text, close_reason), closed_at = COALESCE(closed_at, NOW()) WHERE sid = ANY($1::text[]) RETURNING sid, execution_status AS new_status`,
            [tradeRefs, effectiveCloseReason],
          );
          if (tradeRes.rowCount > 0) {
            const tradeSids = tradeRes.rows.map((r) => r.sid);
            ids.push(...tradeSids.filter((s) => !ids.includes(s)));
          }
        }
      }
      // Cancel trades directly (not through old signals table)
      let updated = 0;
      let updatedIds = [];
      if (ids.length) {
        const b2 = await mt5Backend();
        const cancelRes = await b2.pool.query(
          `UPDATE trades SET execution_status = 'CANCELLED', close_reason = COALESCE($2::text, close_reason), closed_at = COALESCE(closed_at, NOW()) WHERE sid = ANY($1::text[]) AND execution_status = 'PENDING' RETURNING sid`,
          [ids, effectiveCloseReason],
        );
        updated = cancelRes.rowCount;
        updatedIds = cancelRes.rows.map((r) => r.sid);
        invalidateTradeListCaches().catch(() => {});
      }
      const cleanup = await mt5CleanupSignalTradeArtifacts({
        signalRows: rows,
        signalIds: ids,
      });
      for (const signalId of updatedIds) {
        await mt5AppendSignalEvent(signalId, "SIGNAL_MANUAL_CANCEL", {
          via: "ui_bulk_cancel",
          close_reason: effectiveCloseReason,
        });
      }
      return json(res, 200, {
        ok: true,
        updated,
        updated_ids: updatedIds,
        logs_deleted: cleanup.logs_deleted || 0,
        files_deleted: cleanup.files_deleted || 0,
        matched: ids.length,
        filters,
        scanned_limit: limit,
        target_status: "CANCEL",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "GET" && url.pathname === "/mt5/db/schema") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const b = await mt5Backend();
      if (!b.getTableSchema)
        return json(res, 400, {
          ok: false,
          error: "Not supported by this backend",
        });
      const table = envStr(url.searchParams.get("table") || "trades");
      if (table.toLowerCase() === "ui_auth_users")
        return json(res, 403, { ok: false, error: "table access forbidden" });
      const schema = await b.getTableSchema(table);
      return json(res, 200, { ok: true, table, schema });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }

  if (
    req.method === "GET" &&
    (url.pathname === "/v2/system/storage/stats" ||
      url.pathname === "/system/storage/stats" ||
      url.pathname === "/mt5/storage/stats")
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAuthForUi(req, res)) return;
    try {
      const b = await mt5Backend();
      if (!b.getStorageStats)
        return json(res, 400, {
          ok: false,
          error: "Not supported by this backend",
        });
      const userId = uiEffectiveUserId(req, url);
      const stats = await b.getStorageStats(userId);
      const sess = getUiSessionFromReq(req);
      return json(res, 200, {
        ok: true,
        stats,
        can_hard_disk_cleanup: Boolean(sess?.ok && isSystemRole(sess.role)),
      });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }

  if (
    req.method === "GET" &&
    (url.pathname === "/v2/system/cache" || url.pathname === "/system/cache")
  ) {
    // API only — static UI serving removed, use nginx/Vite for frontend
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const b = await mt5Backend();
      const key = url.searchParams.get("key");
      const source = url.searchParams.get("source") || "memory";

      if (key) {
        const detail = await b.uiGetCacheDetail(key, source);
        return json(res, detail.ok ? 200 : 400, detail);
      }

      const items = await b.uiListCache();
      return json(res, 200, { ok: true, items });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (
    req.method === "DELETE" &&
    (url.pathname === "/v2/system/cache" || url.pathname === "/system/cache")
  ) {
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const b = await mt5Backend();
      const key = url.searchParams.get("key");
      const source = url.searchParams.get("source") || "memory";
      if (key) {
        const out = await b.uiDeleteCacheKey(key, source);
        return json(res, 200, out);
      } else {
        const out = await b.storageCleanup("cache");
        return json(res, 200, out);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (
    req.method === "POST" &&
    (url.pathname === "/v2/system/storage/cleanup" ||
      url.pathname === "/system/storage/cleanup" ||
      url.pathname === "/mt5/storage/cleanup")
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAuthForUi(req, res)) return;
    try {
      const payload = await readJson(req);
      const target = String(payload.target || "").trim();
      if (!target)
        return json(res, 400, { ok: false, error: "target is required" });
      if (target === "hard_disk" && !requireSystemRoleForUi(req, res)) return;
      const b = await mt5Backend();
      if (!b.storageCleanup)
        return json(res, 400, {
          ok: false,
          error: "Not supported by this backend",
        });
      const userId = uiEffectiveUserId(req, url, payload);
      const stats = await b.storageCleanup(target, userId);
      return json(res, 200, { ok: true, stats });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/mt5/db/tables") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const b = await mt5Backend();
      if (!b.listTables)
        return json(res, 400, {
          ok: false,
          error: "Not supported by this backend",
        });
      const tables = (await b.listTables()).filter(
        (t) => String(t || "").toLowerCase() !== "ui_auth_users",
      );
      return json(res, 200, { ok: true, tables });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/mt5/db/rows") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const b = await mt5Backend();
      if (!b.listTableRows)
        return json(res, 400, {
          ok: false,
          error: "Not supported by this backend",
        });

      const table = envStr(url.searchParams.get("table") || "trades");
      if (table.toLowerCase() === "ui_auth_users") {
        return json(res, 403, { ok: false, error: "table access forbidden" });
      }
      const q = envStr(url.searchParams.get("q"));
      const sortCol = envStr(url.searchParams.get("sortCol") || "");
      const sortDir = envStr(url.searchParams.get("sortDir") || "DESC");
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const pageSize = Math.max(
        5,
        Math.min(500, Number(url.searchParams.get("pageSize") || 50)),
      );
      const offset = (page - 1) * pageSize;

      const { rows, total } = await b.listTableRows(
        table,
        pageSize,
        offset,
        q,
        sortCol,
        sortDir,
      );
      return json(res, 200, {
        ok: true,
        table,
        total,
        rows,
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/mt5/db/rows/create") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const payload = await readJson(req);
      const table = String(payload.table || "")
        .trim()
        .toLowerCase();
      const row =
        payload.row && typeof payload.row === "object" ? payload.row : {};
      const sess = getUiSessionFromReq(req);
      if (!table)
        return json(res, 400, { ok: false, error: "table is required" });

      if (table === "signals") {
        const created = await mt5EnqueueSignalFromPayload(
          {
            id: row.sid || row.id || "",
            action: row.action,
            symbol: row.symbol,
            volume: row.volume ?? row.lots,
            sl: row.sl ?? null,
            tp: row.tp ?? null,
            rr: row.rr ?? row.risk_reward ?? null,
            risk_money: row.risk_money ?? row.money_risk ?? null,
            price: row.price ?? row.entry ?? null,
            strategy: row.strategy || "DB Insert",
            timeframe: row.timeframe || "manual",
            note: row.note || "",
            user_id: row.user_id || sess.user_id || CFG.mt5DefaultUserId,
            order_type: row.order_type || "limit",
            provider: "ui_db",
            raw_json: row,
          },
          {
            source: "ui_db",
            eventType: "UI_DB_INSERT_SIGNAL",
            fallbackIdPrefix: "db",
          },
        );
        return json(res, 200, { ok: true, table, created });
      }

      if (table === "signal_events") {
        const signalId = String(row.sid || "").trim();
        const eventType = String(row.event_type || "").trim();
        if (!signalId)
          return json(res, 400, {
            ok: false,
            error: "row.sid is required",
          });
        if (!eventType)
          return json(res, 400, {
            ok: false,
            error: "row.event_type is required",
          });
        const payloadJson =
          row.payload_json && typeof row.payload_json === "object"
            ? { ...row.payload_json }
            : row.payload && typeof row.payload === "object"
              ? { ...row.payload }
              : {};
        delete payloadJson.apiKey;
        delete payloadJson.api_key;
        delete payloadJson.password;
        delete payloadJson.token;
        payloadJson.via = "ui_db_create";
        payloadJson.created_by = sess.user_id || CFG.mt5DefaultUserId;
        await mt5AppendSignalEvent(signalId, eventType, payloadJson);
        return json(res, 200, {
          ok: true,
          table,
          created: { signal_id: signalId, event_type: eventType },
        });
      }

      if (table === "users") {
        const out = await uiCreateUser(row);
        if (!out.ok)
          return json(res, 400, {
            ok: false,
            error: out.error || "Failed to create user",
          });
        return json(res, 200, { ok: true, table, created: out.user });
      }

      if (table === "accounts" || table === "user_accounts") {
        const userId = String(row.user_id || "").trim();
        if (!userId)
          return json(res, 400, {
            ok: false,
            error: "row.user_id is required",
          });
        const out = await uiUpsertUserAccount(userId, row);
        if (!out.ok)
          return json(res, 400, {
            ok: false,
            error: out.error || "Failed to create account",
          });
        return json(res, 200, { ok: true, table, created: out.account });
      }

      if (table === "user_api_keys") {
        return json(res, 410, {
          ok: false,
          error: "user_api_keys is removed. Use accounts api-key rotation.",
        });
      }

      return json(res, 400, {
        ok: false,
        error: `Create is not supported for table: ${table}`,
      });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/mt5/db/rows/update") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const payload = await readJson(req);
      const table = String(payload.table || "")
        .trim()
        .toLowerCase();
      const row =
        payload.row && typeof payload.row === "object" ? payload.row : {};
      if (!table)
        return json(res, 400, { ok: false, error: "table is required" });
      if (table === "ui_auth_users")
        return json(res, 403, { ok: false, error: "table access forbidden" });
      const b = await mt5Backend();
      if (!b.updateTableRow)
        return json(res, 400, {
          ok: false,
          error: "Not supported by this backend",
        });
      const result = await b.updateTableRow(table, row);
      return json(res, 200, { ok: true, ...result });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/mt5/trades/renew") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const payload = await readJson(req);
      if (!requireAdminKey(req, res, url, payload)) return;
      const { rows, filters, limit } = await mt5GetFilteredTrades(
        url,
        payload,
        50000,
      );
      const ids = rows.map((r) => String(r.sid || "")).filter(Boolean);
      const updated = await mt5RenewSignalsByIds(ids);
      return json(res, 200, {
        ok: true,
        updated: updated.updated || 0,
        matched: ids.length,
        filters,
        scanned_limit: limit,
        target_status: "NEW",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/mt5/trades/")) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const signalId = decodeURIComponent(
        url.pathname.slice("/mt5/trades/".length),
      );
      if (!signalId)
        return json(res, 400, {
          ok: false,
          error: "sid (signal_id) is required",
        });
      const eventLimitRaw = Number(url.searchParams.get("event_limit") || 200);
      const eventLimit = Math.max(
        1,
        Math.min(2000, Number.isFinite(eventLimitRaw) ? eventLimitRaw : 200),
      );
      const detail = await StateRepo.get(
        "SIGNAL_DETAIL",
        signalId,
        async () => {
          try {
            const rows = await mt5ListSignals(50000, "");
            const trade = rows.find((r) => String(r.sid) === signalId);
            if (!trade) return null;
            const events = await mt5ListSignalEvents(signalId, eventLimit);
            return {
              trade: mt5PublicState(trade),
              events,
              chart: {
                symbol: trade.symbol,
                action: trade.action,
                entry: trade.entry_price_exec ?? null,
                sl:
                  asNum(trade.sl_exec) ??
                  asNum(trade.metadata?.sl_exec) ??
                  asNum(trade.sl) ??
                  null,
                tp:
                  asNum(trade.tp_exec) ??
                  asNum(trade.metadata?.tp_exec) ??
                  asNum(trade.tp) ??
                  null,
                opened_at: trade.opened_at ?? trade.ack_at ?? trade.created_at,
                closed_at: trade.closed_at ?? null,
              },
            };
          } catch {
            return null;
          }
        },
      );
      if (!detail || !detail.trade)
        return json(res, 404, { ok: false, error: "signal not found" });
      return json(res, 200, { ok: true, ...detail });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "GET" && url.pathname === "/mt5/trades") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const limitRaw = Number(url.searchParams.get("limit") || 200);
      const limit = Math.max(
        10,
        Math.min(1000, Number.isFinite(limitRaw) ? limitRaw : 200),
      );
      const status = String(url.searchParams.get("status") || "")
        .trim()
        .toUpperCase();
      const symbol = String(url.searchParams.get("symbol") || "").trim();
      const userId = uiEffectiveUserId(req, url);
      const trades = mt5FilterRows(
        await mt5ListSignals(limit, { symbol, status }, userId),
        { statuses: status ? [status] : [] },
      );
      const b = await mt5Backend();
      return json(res, 200, {
        ok: true,
        count: trades.length,
        storage: b.storage,
        trades: trades.map(mt5PublicState),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (
    req.method === "GET" &&
    (url.pathname === "/csv" || url.pathname === "/mt5/csv")
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const includeHeader =
        String(url.searchParams.get("header") || "1").toLowerCase() !== "0";
      const { rows } = await mt5GetFilteredTrades(url, null, 20000);
      const symbol = envStr(url.searchParams.get("symbol")).toUpperCase();
      const status = envStr(url.searchParams.get("status")).toUpperCase();
      const chronological = rows.slice().reverse();
      const csv = mt5SignalsToBacktestCsv(chronological, includeHeader);

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const suffixSymbol = symbol ? `-${symbol}` : "";
      const suffixStatus = status ? `-${mt5CanonicalStoredStatus(status)}` : "";
      const suffix = `${suffixSymbol}${suffixStatus}`;
      const filename = `mt5-backtest${suffix}-${stamp}.csv`;
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(csv),
      });
      res.end(csv);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (
    (req.method === "POST" || req.method === "GET") &&
    url.pathname === "/mt5/prune"
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      let payload = {};
      if (req.method === "POST") {
        payload = await readJson(req);
      }
      const daysRaw = Number(
        payload.days ?? url.searchParams.get("days") ?? CFG.mt5PruneDays,
      );
      const days = Math.max(
        1,
        Math.min(3650, Number.isFinite(daysRaw) ? daysRaw : CFG.mt5PruneDays),
      );
      const result = await mt5PruneSignals(days);
      return json(res, 200, { ok: true, days, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "GET" && url.pathname === "/mt5/ea/sync") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!(await requireEaKey(req, res, url))) return;
    try {
      const signals = await mt5ListActiveSignals();
      const data = signals.map((s) => ({
        sid: s.sid,
        status: s.status,
        symbol: s.symbol,
        action: s.action,
        ticket: s.ack_ticket || "",
        pnl: s.pnl_money_realized || 0,
        volume: s.volume,
        sl: s.sl,
        tp: s.tp,
      }));
      return json(res, 200, { ok: true, count: data.length, signals: data });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/mt5/api/events") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    const sess = getUiSessionFromReq(req);
    const userId = sess.ok
      ? sess.user_id
      : url.searchParams.get("user_id") || null;

    try {
      const limitRaw = Number(url.searchParams.get("limit") || 200);
      const limit = Math.max(
        1,
        Math.min(5000, Number.isFinite(limitRaw) ? limitRaw : 200),
      );
      const offsetRaw = Number(url.searchParams.get("offset") || 0);
      const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);
      const q = String(url.searchParams.get("q") || "")
        .trim()
        .toLowerCase();
      const typeFilter = String(url.searchParams.get("type") || "")
        .trim()
        .toLowerCase();
      const symbolFilter = String(url.searchParams.get("symbol") || "")
        .trim()
        .toUpperCase();
      const range = String(url.searchParams.get("range") || "all")
        .trim()
        .toLowerCase();
      const { start: rangeStart, end: rangeEnd } = mt5PeriodRange(range);
      // Collect all .log files from SERVER_LOG_DIR (recursive)
      const allLines = [];
      if (fs.existsSync(SERVER_LOG_DIR)) {
        try {
          const walkDir = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
              const full = path.join(dir, e.name);
              if (e.isDirectory()) {
                walkDir(full);
              } else if (e.name.endsWith(".log")) {
                try {
                  const content = fs.readFileSync(full, "utf8");
                  for (const line of content.split("\n")) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    const ev = parseLogLine(trimmed);
                    if (!ev) continue;
                    if (symbolFilter) {
                      const sym = String(
                        ev.metadata?.symbol || "",
                      ).toUpperCase();
                      if (sym && sym !== symbolFilter) continue;
                    }
                    allLines.push(ev);
                  }
                } catch (_) {}
              }
            }
          };
          walkDir(SERVER_LOG_DIR);
        } catch {}
      }

      // Apply remaining filters
      let events = allLines;
      if (rangeStart || rangeEnd || q) {
        events = events.filter((ev) => {
          if (rangeStart || rangeEnd) {
            const ts = mt5ToMs(ev.event_time);
            if (!Number.isFinite(ts)) return false;
            if (rangeStart && ts < mt5ToMs(rangeStart)) return false;
            if (rangeEnd && ts > mt5ToMs(rangeEnd)) return false;
          }
          if (q) {
            const haystack = [
              ev.object_id,
              ev.event_type,
              JSON.stringify(ev.metadata || ev.payload_json || {}),
            ]
              .join(" ")
              .toLowerCase();
            if (!haystack.includes(q)) return false;
          }
          return true;
        });
      }

      // Sort by time desc, apply offset/limit
      events.sort((a, b) =>
        String(b.event_time || "").localeCompare(String(a.event_time || "")),
      );
      events = events.slice(offset, offset + limit);

      // Enrich to match old schema
      events = events.map((ev) => ({
        ...ev,
        id: 0,
        object_table: String(ev.metadata?.object_type || ev.event_type || ""),
        content: "",
        signal_id: ev.object_id,
        symbol: String(ev.metadata?.symbol || "N/A"),
        updated_at: ev.event_time,
        ack_ticket: String(
          ev.metadata?.ticket || ev.metadata?.ack_ticket || "",
        ),
        status: ev.metadata?.status || null,
        error: ev.metadata?.error || null,
      }));
      return json(res, 200, { ok: true, events });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/mt5/api/events/create") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const payload = await readJson(req);
      const sess = getUiSessionFromReq(req);
      const signalId =
        String(payload.sid || payload.object_id || "").trim() ||
        `ui_note_${Date.now()}`;
      const eventType = String(payload.event_type || "").trim();
      if (!eventType)
        return json(res, 400, { ok: false, error: "event_type is required" });
      const payloadJson =
        payload.payload_json && typeof payload.payload_json === "object"
          ? { ...payload.payload_json }
          : payload.payload && typeof payload.payload === "object"
            ? { ...payload.payload }
            : {};
      delete payloadJson.apiKey;
      delete payloadJson.api_key;
      delete payloadJson.password;
      delete payloadJson.token;
      payloadJson.via = "ui_manual_log";
      payloadJson.created_by = sess.user_id || CFG.mt5DefaultUserId;
      await mt5AppendSignalEvent(signalId, eventType, payloadJson);
      return json(res, 200, {
        ok: true,
        event: { signal_id: signalId, event_type: eventType },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/mt5/api/events/delete") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const resVal = await mt5DeleteAllEvents();
      return json(res, 200, { ok: true, deleted: resVal.deleted });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/mt5/ea/sync") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const payload = await readJson(req);
      if (!(await requireEaKey(req, res, url, payload))) return;

      const activeSignals = payload.active_signals || [];

      const dbSignals = await mt5ListActiveSignals(); // NEW, LOCKED, PLACED, START
      const updates = [];
      const nowTs = Date.now();

      // 1. Reconcile EA Active Trades -> VPS
      for (const s of activeSignals) {
        const sid = String(s.sid || "");
        const ticket = String(s.ticket || "");
        const eaStatus = String(s.status || "");
        const eaPnl = Number(s.pnl);
        const hasEaPnl = Number.isFinite(eaPnl);

        // Find trade by sid + ticket
        let sig = dbSignals.find(
          (d) => String(d.sid) === sid && String(d.ack_ticket) === ticket,
        );
        if (!sig) {
          // Backup: find by ticket alone if mapping is loose
          sig = await mt5GetSignalByTicket(ticket);
        }

        if (sig) {
          const dbCan = mt5CanonicalStoredStatus(sig.status);
          const eaCan = mt5CanonicalStoredStatus(eaStatus);
          const dbPnl = Number(sig.pnl_money_realized);
          const pnlChanged =
            hasEaPnl &&
            (!Number.isFinite(dbPnl) || Math.abs(dbPnl - eaPnl) > 0.000001);

          // Sync if status changed OR pnl changed.
          if (dbCan !== eaCan || pnlChanged) {
            updates.push({
              sid: sig.sid,
              status: eaStatus || sig.status,
              ticket: ticket,
              pnl: hasEaPnl ? eaPnl : undefined,
              note:
                dbCan !== eaCan
                  ? `sync_status_diff_${dbCan}_to_${eaCan}`
                  : `sync_pnl_${Number.isFinite(dbPnl) ? dbPnl : "null"}_to_${eaPnl}`,
            });
          }
        }
      }

      // 2. Identify Ghost Signals (Optional, keeping simple as requested)
      // If needed, we can add logic here to mark trades as FAIL if they are in dbSignals but not in confirmedDbIds.
      // But the user's latest instruction focuses on the array processing.
      // I'll skip ghost closing for now to be strictly lean as per the request.

      if (updates.length > 0) {
        await mt5BulkAckSignals(updates);

        await mt5AppendSignalEvent("SYSTEM_SYNC_PUSH", "SIGNAL_EA_SYNC_PUSH", {
          account: payload.account_id,
          active_count: activeSignals.length,
          updates_count: updates.length,
          updates_details: updates,
        });
      }

      return json(res, 200, { ok: true, reconciled: updates.length, updates });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/mt5/ea/bulk-sync") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const payload = await readJson(req);
      if (!(await requireEaKey(req, res, url, payload))) return;
      const updates = payload.updates || [];
      if (!Array.isArray(updates))
        return json(res, 400, { ok: false, error: "updates array required" });
      const result = await mt5BulkAckSignals(updates);
      for (const u of updates) {
        await mt5AppendSignalEvent(u.sid, `SIGNAL_EA_SYNC_${u.status}`, {
          ticket: u.ticket,
          pnl: u.pnl,
          account: payload.account_id,
        });
      }
      return json(res, 200, { ok: true, updated: result.updated });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/accounts") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAuthForUi(req, res)) return;
    try {
      const userId = uiEffectiveUserId(req, url);
      const raw = await mt5ListAccountsV2(userId);
      const items = (raw || [])
        .filter((r) => (r.status || "").toUpperCase() !== "ARCHIVED")
        .map((r) => ({
          account_id: r.accountId || r.account_id || null,
          user_id: r.userId || r.user_id || null,
          name: r.name || null,
          balance: r.balance || null,
          status: r.status || null,
          metadata: r.metadata || {},
          created_at: r.createdAt || r.created_at || null,
          updated_at: r.updatedAt || r.updated_at || null,
        }));
      return json(res, 200, { ok: true, items });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/accounts") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const accountId = String(payload?.account_id || "").trim();
      if (!accountId)
        return json(res, 400, { ok: false, error: "account_id is required" });
      const out = await mt5CreateAccountV2({
        account_id: accountId,
        user_id: String(payload?.user_id || CFG.mt5DefaultUserId),
        name: String(payload?.name || accountId),
        balance: payload?.balance,
        status: String(payload?.status || "ACTIVE"),
        metadata:
          payload?.metadata && typeof payload.metadata === "object"
            ? payload.metadata
            : {},
      });
      if (!out?.ok)
        return json(res, 400, {
          ok: false,
          error: out?.error || "failed to create account",
        });
      const rows = await mt5ListAccountsV2();
      return json(res, 200, {
        ok: true,
        item: out.item || null,
        api_key_plaintext: out.api_key_plaintext || null,
        items: rows,
      });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "PUT" && /^\/v2\/accounts\/[^/]+$/.test(url.pathname)) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const m = url.pathname.match(/^\/v2\/accounts\/([^/]+)$/);
      const accountId = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!accountId)
        return json(res, 400, { ok: false, error: "account_id is required" });
      const out = await mt5UpdateAccountV2(accountId, payload || {});
      if (!out?.ok)
        return json(res, 400, {
          ok: false,
          error: out?.error || "failed to update account",
        });
      const rows = await mt5ListAccountsV2();
      return json(res, 200, { ok: true, item: out.item || null, items: rows });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "DELETE" && /^\/v2\/accounts\/[^/]+$/.test(url.pathname)) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAuthForUi(req, res)) return;
    try {
      const m = url.pathname.match(/^\/v2\/accounts\/([^/]+)$/);
      const accountId = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!accountId)
        return json(res, 400, { ok: false, error: "account_id is required" });
      const out = await mt5ArchiveAccountV2(accountId);
      if (!out?.ok) {
        const statusCode = out?.blocking_open_trades ? 409 : 400;
        return json(res, statusCode, {
          ok: false,
          error: out?.error || "failed to archive account",
          blocking_open_trades: Number(out?.blocking_open_trades || 0),
        });
      }
      const rows = await mt5ListAccountsV2();
      return json(res, 200, { ok: true, item: out.item || null, items: rows });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // =========================
  // AI HUB API
  // =========================
  // =========================
  // AI HUB API — Templates stored in user_settings (type='ai_template')
  if (req.method === "GET" && url.pathname === "/v2/ai/templates") {
    if (!requireAdminKey(req, res, url)) return;
    try {
      const db = await mt5InitBackend();
      const rows = await dbQueries.listUserSettingsByType(
        db.db,
        CFG.mt5DefaultUserId,
        "ai_template",
      );
      const templates = rows.map((r) => ({
        template_id: r.name,
        name: r.name,
        ...(r.data && typeof r.data === "object" ? r.data : {}),
      }));
      return json(res, 200, { ok: true, templates });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/ai/templates") {
    if (!requireAdminKey(req, res, url)) return;
    try {
      const payload = await readJson(req);
      const db = await mt5InitBackend();
      const { template_id, name, ...rest } = payload;
      const config = rest.config || rest;
      const templateName = String(name || config?.name || "Unnamed").trim();
      const settingData = {
        config,
        _guide: config._guide,
        _schema: config._schema,
        saved: rest.saved || new Date().toISOString(),
      };
      await dbQueries.upsertUserSetting(
        db.db,
        CFG.mt5DefaultUserId,
        "ai_template",
        templateName,
        settingData,
        "ACTIVE",
      );
      await StateRepo.del("USER_TEMPLATES", CFG.mt5DefaultUserId);
      return json(res, 201, {
        ok: true,
        template: { template_id: templateName, name: templateName, config },
      });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/v2/ai/templates/")) {
    if (!requireAdminKey(req, res, url)) return;
    try {
      const templateName = decodeURIComponent(url.pathname.split("/").pop());
      const db = await mt5InitBackend();
      await dbQueries.deleteUserSetting(
        db.db,
        CFG.mt5DefaultUserId,
        "ai_template",
        templateName,
      );
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/ai/config") {
    if (!requireAdminKey(req, res, url)) return;
    try {
      const body = await readJson(req);
      const db = await mt5InitBackend();
      const userId = CFG.mt5DefaultUserId;

      if (body.key && body.value !== undefined) {
        // Individual key update
        const keyName = normalizeAiApiKeyName(body.key);
        let rawVal = String(body.value || "").trim();
        if (
          ALLOWED_AI_API_KEY_NAMES.has(keyName) &&
          isMaskedApiKeyLike(rawVal)
        ) {
          rawVal = "";
          const existingData = await dbQueries.getUserSettingData(
            db.db,
            userId,
            "api_key",
            "default",
          );
          if (existingData) {
            const dec = decryptObject(
              typeof existingData === "string"
                ? JSON.parse(existingData)
                : existingData || {},
            );
            rawVal = String(dec?.[keyName] || "").trim();
          }
        }
        const encValue = encryptData(rawVal);
        // Merge with existing data
        const prevData = await dbQueries.getUserSettingData(
          db.db,
          userId,
          "api_key",
          "default",
        );
        const prev =
          prevData && typeof prevData === "string"
            ? JSON.parse(prevData)
            : prevData || {};
        const merged =
          typeof prev === "object"
            ? { ...prev, [body.key]: encValue }
            : { [body.key]: encValue };
        await dbQueries.upsertUserSetting(
          db.db,
          userId,
          "api_key",
          "default",
          merged,
          "ACTIVE",
        );
      } else {
        // Bulk settings update
        const settings = encryptObject(body.settings || body || {});
        await dbQueries.upsertUserSetting(
          db.db,
          userId,
          "api_key",
          "default",
          settings,
          "ACTIVE",
        );
      }

      await StateRepo.del("SYSTEM_SETTINGS", "global");
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }
  if (req.method === "GET" && url.pathname === "/v2/settings") {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });

    try {
      const db = await mt5InitBackend();
      const userId = sess.user_id || CFG.mt5DefaultUserId;
      console.log(
        `[Settings] GET /v2/settings: sess=${JSON.stringify(sess)}, userId=${userId}`,
      );
      await dbQueries.upsertUserSetting(
        db.db,
        userId,
        "cron",
        "CRON_MD_DEFAULT",
        {
          cron_type: "MARKET_DATA_CRON",
          enabled: false,
          provider: "twelvedata",
          timezone: CFG.marketDataDefaultTimezone,
          symbols: [],
          timeframes: ["1m", "5m", "15m"],
          batch_size: CFG.marketDataCronBatchSize,
          last_sync: {},
        },
        "INACTIVE",
      );
      await dbQueries.upsertUserSetting(
        db.db,
        userId,
        "cron",
        "CRON_AI_DEFAULT",
        {
          cron_type: "ANALYSIS_CRON",
          enabled: false,
          refresh_snapshot: false,
          symbols: [],
          timeframes: ["15m", "1h"],
          cadence_minutes: 60,
          model: "claude-sonnet-4-0",
          profile: "",
          entry_models: [],
          directions: ["BUY", "SELL"],
          order_types: ["market", "limit", "stop"],
          prompt: "",
          last_sync: {},
        },
        "INACTIVE",
      );
      const rows = await repoListUserSettings(userId);
      const settings = rows.map((r) => {
        let d = r.data;
        if ((!d || Object.keys(d).length === 0) && r.value) {
          try {
            d = JSON.parse(r.value);
            if (typeof d !== "object" || d === null) d = { value: r.value };
          } catch {
            d = { value: r.value };
          }
        }
        // For api_key type, decrypt and mask the api_key field for display
        if (r.type === "api_key" && d && typeof d === "object") {
          const decrypted = decryptObject(d);
          // Only mask the api_key field; models and remain_credits shown as-is
          const masked = { ...decrypted };
          if (masked.api_key) {
            masked.api_key = maskApiKeyForDisplay(String(masked.api_key || ""));
          }
          // Legacy: mask value field if present
          if (masked.value) {
            masked.value = maskApiKeyForDisplay(String(masked.value || ""));
          }
          return { ...r, data: masked };
        }
        return { ...r, data: d || {} };
      });
      return json(res, 200, { ok: true, settings });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/settings/secret") {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const type = String(url.searchParams.get("type") || "").trim();
      const name = String(url.searchParams.get("name") || "").trim();
      const field = String(
        url.searchParams.get("field") || "v2026.05.09 19:31 - 728f356",
      ).trim();
      if (!type || !name)
        return json(res, 400, { ok: false, error: "Missing type or name" });
      if (type !== "api_key")
        return json(res, 400, {
          ok: false,
          error: "Secret reveal is only supported for api_key type",
        });

      const db = await mt5InitBackend();
      const userId = sess.user_id || CFG.mt5DefaultUserId;
      const enc =
        (await dbQueries.getUserSettingData(db.db, userId, type, name)) || {};
      const dec = decryptObject(
        typeof enc === "string" ? JSON.parse(enc) : enc,
      );
      return json(res, 200, { ok: true, value: String(dec?.[field] || "") });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/settings") {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });

    try {
      const body = await readJson(req);
      if (!body.type)
        return json(res, 400, { ok: false, error: "Missing type" });
      const db = await mt5InitBackend();
      const userId = sess.user_id || CFG.mt5DefaultUserId;
      let payloadData = body.data;
      if (!payloadData || typeof payloadData !== "object") {
        if (body.value !== undefined && body.value !== null) {
          try {
            payloadData = JSON.parse(body.value);
            if (typeof payloadData !== "object" || payloadData === null) {
              payloadData = { value: body.value };
            }
          } catch {
            payloadData = { value: body.value };
          }
        } else {
          payloadData = {};
        }
      }

      let settingName = String(body.name || body.type || "").trim();
      let data = payloadData;

      if (body.type === "ai_template") {
        return json(res, 400, {
          ok: false,
          error: "ai_template moved to user_templates. Use /v2/ai/templates.",
        });
      }

      if (body.type === "api_key") {
        settingName = normalizeAiApiKeyName(settingName);
        if (!ALLOWED_AI_API_KEY_NAMES.has(settingName)) {
          return json(res, 400, {
            ok: false,
            error:
              "Invalid api_key name. Allowed: GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, CLAUDE_API_KEY, OPENROUTER_API_KEY, TWELVE_DATA_API_KEY",
          });
        }
        const incomingValue = String(
          payloadData.api_key ?? payloadData.value ?? "",
        ).trim();
        let rawValue = incomingValue;
        if (!rawValue || isMaskedApiKeyLike(rawValue)) {
          const existingData = await dbQueries.getUserSettingData(
            db.db,
            userId,
            "api_key",
            settingName,
          );
          if (existingData) {
            const dec = decryptObject(
              typeof existingData === "string"
                ? JSON.parse(existingData)
                : existingData || {},
            );
            rawValue = String(dec?.api_key || dec?.value || "").trim();
          }
        }
        data = encryptObject({ value: rawValue, api_key: rawValue });
      }

      const result = await dbQueries.upsertUserSetting(
        db.db,
        userId,
        body.type,
        settingName || body.type,
        data,
        body.status || "active",
      );
      await StateRepo.del("USER_SETTINGS", userId);
      return json(res, 200, { ok: true, item: result[0] });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/v2/settings/")) {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });

    try {
      const parts = url.pathname.split("/"); // ["", "v2026.05.09 19:31 - 728f356", "settings", type, name]
      const type = decodeURIComponent(parts[3] || "");
      const name = decodeURIComponent(parts[4] || "");

      if (!type || !name)
        return json(res, 400, { ok: false, error: "Missing type or name" });
      const db = await mt5InitBackend();
      const userId = sess.user_id || CFG.mt5DefaultUserId;
      await dbQueries.deleteUserSetting(db.db, userId, type, name);
      await StateRepo.del("USER_SETTINGS", userId);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/v2/ai/templates/")) {
    if (!requireAdminKey(req, res, url)) return;
    try {
      const templateId = url.pathname.split("/").pop();
      const db = await mt5InitBackend();
      await dbQueries.deleteUserTemplate(db.db, templateId);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/ai/generate") {
    if (!requireAdminKey(req, res, url)) return;
    try {
      const body = await readJson(req);
      const {
        templateId,
        customPrompt,
        service,
        provider: bodyProvider,
        model,
        context,
      } = body;
      const db = await mt5InitBackend();
      const sess = getUiSessionFromReq(req);
      const userId = sess?.user_id || CFG.mt5DefaultUserId;
      const sessionId = `ai_gen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await (
        await mt5Backend()
      ).log(sessionId, "ai", { event: "AI_ANALYSIS", payload: body }, userId);

      let finalPrompt = customPrompt || "";
      if (templateId) {
        const data = await dbQueries.getUserTemplateData(db.db, templateId);
        if (data) finalPrompt = data.prompt_text || data.prompt;
      }

      const config = await loadUserApiKeysMap(userId);

      const tData = templateId
        ? (await dbQueries.getUserTemplateData(db.db, templateId)) || {}
        : {};

      // Data for placeholders
      const symbol = body.symbol || tData.default_symbol || "BTCUSDT";
      const tf = body.timeframe || tData.default_tf || "1h";

      finalPrompt = finalPrompt
        .replace(/{SYMBOL}/g, symbol)
        .replace(/{TIMEFRAME: default 15m}/g, tf)
        .replace(/{TIMEFRAME}/g, tf)
        .replace(
          /{STRATEGY: default Price Action}/g,
          body.strategy || "Price Action",
        )
        .replace(/{STRATEGY}/g, body.strategy || "Price Action")
        .replace(
          /{INDICATORS\/STRATEGY}/g,
          body.indicators || "Technical Analysis",
        )
        .replace(/{RR}/g, body.rr || "1:2");

      const userLang = sess?.metadata?.settings?.language || "English";

      finalPrompt += `\n\n${buildAiSchemaPromptText()}`;

      if (userLang && userLang !== "English") {
        finalPrompt += `\n\nIMPORTANT: Keep enum values exactly as specified, but write narrative fields such as note, recent_move, narrative, condition, and reasons_to_skip.reason in ${userLang}.`;
      }

      let provider = (bodyProvider || service || "gemini").toLowerCase();
      if (
        requestModel &&
        (requestModel.includes("openrouter") ||
          requestModel.includes("open-router"))
      )
        provider = "openrouter";
      const apiKey =
        provider === "deepseek"
          ? config.DEEPSEEK_API_KEY
          : provider === "openrouter"
            ? config.OPENROUTER_API_KEY || ""
            : provider === "openai"
              ? config.OPENAI_API_KEY
              : provider === "claude"
                ? config.CLAUDE_API_KEY || config.ANTHROPIC_API_KEY
                : config.GEMINI_API_KEY;

      if (!apiKey) {
        return json(res, 400, {
          ok: false,
          error: `API Key for ${provider} is missing. Please configure it in the AI Hub.`,
        });
      }

      console.log(`[ai] invoking ${provider} with model ${model || "default"}`);

      let endpoint = "";
      let authHeader = "";
      let bodyData = {};
      let requestModel = String(model || "").trim();

      if (provider === "deepseek") {
        endpoint = "https://api.deepseek.com/chat/completions";
        authHeader = `Bearer ${apiKey}`;
        if (!requestModel) requestModel = "deepseek-chat";
        // Backward compatibility: deepseek-coder is deprecated in current API naming.
        if (requestModel === "deepseek-coder") requestModel = "deepseek-chat";
        bodyData = {
          model: requestModel,
          messages: [{ role: "user", content: finalPrompt }],
          response_format: { type: "json_object" },
        };
      } else if (provider === "openrouter") {
        endpoint = "https://openrouter.ai/api/v1/chat/completions";
        authHeader = `Bearer ${apiKey}`;
        if (!requestModel) requestModel = "openai/gpt-4o";
        bodyData = {
          model: requestModel,
          messages: [{ role: "user", content: finalPrompt }],
          response_format: { type: "json_object" },
        };
      } else if (provider === "openai") {
        endpoint = "https://api.openai.com/v1/chat/completions";
        authHeader = `Bearer ${apiKey}`;
        if (!requestModel) requestModel = "gpt-4o-mini";
        bodyData = {
          model: requestModel,
          messages: [{ role: "user", content: finalPrompt }],
          response_format: { type: "json_object" },
        };
      } else if (provider === "claude") {
        endpoint = "https://api.anthropic.com/v1/messages";
        authHeader = "";
        if (!requestModel) requestModel = "claude-sonnet-4-0";
        bodyData = {
          model: requestModel,
          max_tokens: 32000,
          messages: [{ role: "user", content: finalPrompt }],
        };
      } else {
        // Default to Gemini (OpenAI compatible route)
        endpoint =
          "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
        authHeader = `Bearer ${apiKey}`;
        if (!requestModel) requestModel = "gemini-2.0-flash";
        bodyData = {
          model: requestModel,
          messages: [{ role: "user", content: finalPrompt }],
        };
      }

      const aiCtrl = new AbortController();
      const aiTimer = setTimeout(() => aiCtrl.abort(), 45000);
      let aiRes;
      let aiModelUsed = requestModel;
      try {
        if (provider === "claude") {
          const out = await anthropicMessagesWithFallback({
            apiKey,
            model: requestModel,
            messages: bodyData.messages,
            maxTokens: bodyData.max_tokens,
            timeoutMs: 45000,
          });
          aiRes = out.response;
          aiModelUsed = out.modelUsed || requestModel;
        } else {
          aiRes = await fetch(endpoint, {
            method: "POST",
            signal: aiCtrl.signal,
            headers: {
              "Content-Type": "application/json",
              ...(authHeader ? { Authorization: authHeader } : {}),
            },
            body: JSON.stringify(bodyData),
          });
        }
      } catch (e) {
        if (e?.name === "AbortError") {
          throw new Error(
            `AI Provider Timeout (${provider}/${requestModel}) after 45s. Check provider status/network and retry.`,
          );
        }
        throw e;
      } finally {
        clearTimeout(aiTimer);
      }

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        throw new Error(`AI Provider Error (${aiRes.status}): ${errText}`);
      }

      const aiJson = await finalAiRes.json();

      // Robust JSON extraction
      let cleanJson = rawResponse.trim();
      if (cleanJson.includes("```")) {
        const match = cleanJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match) cleanJson = match[1];
      }

      // If it still has markdown prefix (sometimes LLMs ignore instructions), strip it manually
      cleanJson = cleanJson
        .replace(/^```json/, "")
        .replace(/```$/, "")
        .trim();

      await (
        await mt5Backend()
      ).log(
        sessionId,
        "ai",
        {
          event: "AI_RESPONSE",
          schema_version: AI_RESPONSE_SCHEMA_VERSION,
          raw_json: aiJson,
        },
        userId,
      );

      let signals = [];
      let analysisResult = null;
      try {
        const parsed = JSON.parse(cleanJson);
        if (
          parsed.bias ||
          parsed.analysis ||
          parsed.key_levels ||
          parsed.market_analysis ||
          parsed.trade_plan ||
          parsed.final_verdict
        ) {
          analysisResult = parsed;
          signals = parsed.signals || [];
        } else if (Array.isArray(parsed)) {
          signals = parsed;
        } else if (parsed.signals && Array.isArray(parsed.signals)) {
          signals = parsed.signals;
        } else if (parsed.symbol || parsed.direction || parsed.side) {
          signals = [parsed];
        } else {
          const values = Object.values(parsed);
          if (values.length > 0 && (values[0].symbol || values[0].direction)) {
            signals = values;
          }
        }

        // Persistence: If we have analysis and bars context, store in market_data metadata
        if (analysisResult && body.bars && body.bars.length > 0) {
          const bars = body.bars;
          const barStart = Number(bars[0].time || bars[0].bar_start);
          const barEnd = Number(
            bars[bars.length - 1].time || bars[bars.length - 1].bar_end,
          );
          if (barStart && barEnd) {
            const symbolNorm = normalizeMarketDataSymbol(body.symbol);
            const tfNorm = normalizeMarketDataTf(body.timeframe);
            await marketDataFileWrite(symbolNorm, tfNorm, {
              bar_start: barStart,
              bar_end: barEnd,
              bars: bars,
              metadata: analysisResult,
            }).catch((e) =>
              console.error("[ai-gen] File Write Failed:", e.message),
            );
          }
        }
      } catch (e) {
        console.error("[ai] failed to parse JSON from AI response:", cleanJson);
        // We still return ok: true but empty signals, showing the raw_response to user
      }

      return json(res, 200, {
        ok: true,
        model: aiModelUsed,
        schema_version: AI_RESPONSE_SCHEMA_VERSION,
        raw_response: rawResponse,
        signals: (signals || []).map((s) => {
          const rawEntryModel =
            s?.entry_model ||
            s?.model ||
            s?.strategy ||
            tData.name ||
            "AI_AGENT";
          const entryModel = mt5NormalizeEntryModel(rawEntryModel, {
            fallback: tData.name || "AI_AGENT",
          });
          const noteRaw = mt5CollapseWhitespace(s?.note || "");
          const note =
            noteRaw ||
            (mt5EntryModelLooksVerbose(rawEntryModel)
              ? mt5CollapseWhitespace(rawEntryModel)
              : "");
          return {
            ...s,
            symbol: s.symbol || symbol,
            side: s.direction || s.side || "BUY",
            entry: s.entry || s.price || 0,
            sl: s.sl || s.stop_loss,
            tp: s.tp || s.take_profit,
            timeframe: s.timeframe || tf,
            entry_model: entryModel,
            entry_model_raw: mt5CollapseWhitespace(rawEntryModel) || null,
            note,
          };
        }),
      });
    } catch (e) {
      console.error("[ai] generation error:", e);
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/tv/login") {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const body = await readJson(req);
      const result = await loginToTradingView(body.username, body.password);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/chart/snapshot") {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const body = await readJson(req);
      const item = await captureTradingViewSnapshot({
        userId: sess.user_id,
        symbol: body.symbol,
        provider: body.provider,
        session_prefix: body.session_prefix || body.sessionPrefix || "",
        timeframe: body.timeframe || body.tf,
        width: body.width,
        height: body.height,
        theme: body.theme,
        timezone: body.timezone || body.tz,
        lookbackBars: body.lookbackBars,
        format: body.format,
        quality: body.quality,
      });
      const tradeSid = String(
        body.trade_sid || body.tradeSid || body.sid || "",
      ).trim();
      if (tradeSid) {
        const tradeSymbol = await mt5ResolveTradeFolderSymbol(
          tradeSid,
          body.symbol || item?.symbol || "",
        );
        const copied = copySnapshotsToTradeSidFolder(
          tradeSid,
          [item?.file_name],
          tradeSymbol,
        );
        const persisted = await persistTradeSnapshotFiles(
          tradeSid,
          copied,
          tradeSymbol,
        );
        item.trade_sid = tradeSid;
        item.trade_snapshot_copied = copied;
        item.trade_snapshot_persisted = persisted;
      }
      return json(res, 200, { ok: true, item });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/chart/snapshot/batch") {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const body = await readJson(req);
      const items = await captureTradingViewSnapshotsBatch({
        userId: sess.user_id,
        symbol: body.symbol,
        symbols: body.symbols,
        provider: body.provider,
        session_prefix: body.session_prefix || body.sessionPrefix || "",
        timeframes: Array.isArray(body.timeframes) ? body.timeframes : body.tfs,
        tfs: body.tfs,
        width: body.width,
        height: body.height,
        theme: body.theme,
        timezone: body.timezone || body.tz,
        lookbackBars: body.lookbackBars,
        format: body.format,
        quality: body.quality,
        merge_snapshots: body.merge_snapshots,
      });
      const tradeSid = String(
        body.trade_sid || body.tradeSid || body.sid || "",
      ).trim();
      if (tradeSid) {
        const tradeSymbol = await mt5ResolveTradeFolderSymbol(
          tradeSid,
          body.symbol ||
            (Array.isArray(body.symbols) && body.symbols.length
              ? body.symbols[0]
              : ""),
        );
        const copied = copySnapshotsToTradeSidFolder(
          tradeSid,
          (Array.isArray(items) ? items : [])
            .map((x) => x?.file_name)
            .filter(Boolean),
          tradeSymbol,
        );
        const persisted = await persistTradeSnapshotFiles(
          tradeSid,
          copied,
          tradeSymbol,
        );
        for (const it of Array.isArray(items) ? items : []) {
          it.trade_sid = tradeSid;
        }
        return json(res, 200, {
          ok: true,
          items,
          trade_sid: tradeSid,
          copied,
          persisted,
        });
      }
      return json(res, 200, { ok: true, items });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "GET" &&
    url.pathname.startsWith("/v2/chart/snapshots-grid/")
  ) {
    const symbolRaw = url.pathname.split("/").pop() || "";
    const tfsFromForm = url.searchParams.getAll("tfs").filter(Boolean);
    const tfsExplicitRaw =
      url.searchParams.get("timeframes") ||
      (tfsFromForm.length ? tfsFromForm.join(",") : "") ||
      url.searchParams.get("tfs") ||
      "";
    const symbolsParam = String(
      url.searchParams.get("symbols") || url.searchParams.get("symbol") || "",
    ).trim();
    const provider = String(url.searchParams.get("provider") || "").trim();
    const decodedPathSymbol = decodeURIComponent(symbolRaw);
    const splitSymbols = (input) =>
      (/\[object\s+promise\]/i.test(String(input || ""))
        ? ""
        : String(input || "")
      )
        .split(/[\s,|;+]+|--|-/g)
        .map((s) => normalizeMarketDataSymbol(s))
        .filter(Boolean);
    const pathSymbols = splitSymbols(decodedPathSymbol);
    const querySymbols = splitSymbols(symbolsParam);
    const explicitSymbols = querySymbols.length ? querySymbols : pathSymbols;
    let symbols = [...new Set(explicitSymbols)];
    // If URL has no symbol list, use all symbols in current user's watchlist.
    const noSymbolInput = !explicitSymbols.length;
    let watchlistSymbols = [];
    try {
      const sess = getUiSessionFromReq(req);
      const wl = await repoGetUserWatchlist(
        sess?.ok ? sess.user_id : CFG.mt5DefaultUserId,
      );
      watchlistSymbols = [
        ...new Set(
          (Array.isArray(wl) ? wl : [])
            .map((s) => normalizeMarketDataSymbol(s))
            .filter(Boolean),
        ),
      ];
    } catch (_) {
      watchlistSymbols = [];
    }
    if (!symbols.length) {
      try {
        symbols = [...watchlistSymbols];
      } catch (_) {}
    }
    if (!symbols.length) {
      symbols = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"];
    }
    const allSymbolsPool = (() => {
      const set = new Set(symbols);
      try {
        const dataDir = path.join(GLOBAL_DATA_DIR, "market_data");
        if (fs.existsSync(dataDir)) {
          for (const d of fs.readdirSync(dataDir)) {
            try {
              if (fs.statSync(path.join(dataDir, d)).isDirectory()) {
                const s = normalizeMarketDataSymbol(d);
                if (s) set.add(s);
              }
            } catch (_) {}
          }
        }
      } catch (_) {}
      for (const s of watchlistSymbols) set.add(s);
      return [...set];
    })();
    const isForexSym = (s) =>
      /^[A-Z]{6}$/.test(s) && !s.startsWith("XAU") && !s.startsWith("XAG");
    const isMetalSym = (s) => /^(XAU|XAG|XPT|XPD)/.test(s);
    const isCryptoSym = (s) =>
      /^(BTC|ETH|BNB|SOL|XRP|ADA|DOGE|LTC|AVAX|DOT|LINK|MATIC)/.test(s) ||
      /(USDT|USDTPERP|PERP)$/.test(s);
    const isIndexSym = (s) =>
      /^(US30|DE40|UK100|NAS100|SPX500|US500|JP225|HK50)/.test(s) ||
      /\d/.test(s);
    const groupedSymbols = {
      all: [...allSymbolsPool].sort(),
      watchlist: [...watchlistSymbols].sort(),
      forex: allSymbolsPool.filter((s) => isForexSym(s)).sort(),
      crypto: allSymbolsPool.filter((s) => isCryptoSym(s)).sort(),
      metals: allSymbolsPool.filter((s) => isMetalSym(s)).sort(),
      indices: allSymbolsPool.filter((s) => isIndexSym(s)).sort(),
    };
    // In watchlist/no-symbol mode, default to single TF 4h unless explicitly provided.
    // For single-symbol mode, always force the 6-TF layout.
    const forcedSingleSymbolTfs = "1W,1D,4h,15m,5m,1m";
    const tfsRaw =
      symbols.length === 1
        ? forcedSingleSymbolTfs
        : tfsExplicitRaw || (noSymbolInput ? "4h" : "D,240,15,5");

    // Canonicalize, dedup, sort descending
    const tfs = canonicalizeTfList(tfsRaw.split(",").filter(Boolean));

    // Resolve broker-specific TV symbols for display/capture.
    const resolvedTvSymbols = {};
    for (const sym of symbols) {
      resolvedTvSymbols[sym] = await resolveTradingViewSymbolForCapture(
        sym,
        provider,
      );
    }

    // Derived mappings from single canonical source
    const tvIntervals = tfs.map((tf) => snapshotTfToTVInterval(tf));
    const displayTfs = tfs.map((tf) => snapshotTfToLabel(tf));

    const theme = url.searchParams.get("theme") || "dark";
    const captureMode =
      asBool(url.searchParams.get("save_image"), false) ||
      asBool(url.searchParams.get("capture"), false);
    const selectedTz = normalizeTvTimezone(
      url.searchParams.get("tz"),
      "Etc/UTC",
    );
    const effectiveTz =
      selectedTz === "LOCAL" && captureMode ? "Etc/UTC" : selectedTz;
    const gridStamp = new Date()
      .toISOString()
      .replace("T", " ")
      .replace("Z", " UTC");
    const gridStampEsc = htmlEscape(gridStamp);
    const sessionLabel = sessionKillerZoneLabelUTC(new Date());
    const cols = tfs.length > 2 ? 2 : tfs.length;
    const cellHeight = Math.max(
      280,
      Math.min(900, Number(url.searchParams.get("cell_h") || 420) || 420),
    );
    const tzLabel =
      selectedTz === "LOCAL"
        ? "Local"
        : selectedTz === "America/New_York"
          ? "NY"
          : "UTC";
    const sessionLabelShort = String(sessionLabel || "").replace(
      /Kill Zone/gi,
      "KZ",
    );
    const gridHeaderText = `${gridStampEsc} | ${htmlEscape(sessionLabelShort)} | ${tzLabel}`;
    const singleTfMode = tfs.length === 1;
    const singleTfCols = 4;
    const singleTfRows = Math.max(1, Math.ceil(symbols.length / singleTfCols));
    const singleGridGapPx = 8;
    const singleGridPadPx = 8;
    const singleHeaderHpx = 52;
    const singleCellHeightExpr = `calc((100vh - ${singleHeaderHpx}px - ${singleGridPadPx * 2}px - ${(singleTfRows - 1) * singleGridGapPx}px) / ${singleTfRows})`;
    const defaultGroupName = noSymbolInput
      ? "watchlist"
      : symbols.length > 1
        ? "group"
        : "";
    const tfChoices = ["1m", "5m", "15m", "1h", "4h", "1D", "1W"];

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <html>
        <head>
          <meta charset="utf-8">
          <title>Grid ${htmlEscape(symbols.join("-"))}</title>

          <style>
            body {
              margin: 0;
              background: ${theme === "dark" ? "#0b1220" : "#ffffff"};
              overflow: ${captureMode ? "visible" : "hidden"};
              font-family: sans-serif;
            }
            .grid-header {
              height: 52px;
              display: flex;
              align-items: center;
              gap: 10px;
              padding: 6px 12px 0 12px;
              box-sizing: border-box;
              background: ${theme === "dark" ? "#0b1220" : "#ffffff"};
            }
            .grid-meta-badge {
              background: rgba(255,255,255,0.95);
              color: #07111f;
              padding: 4px 7px;
              border-radius: 5px;
              font-size: 11px;
              font-family: monospace;
              font-weight: 800;
              letter-spacing: 0;
              border: 2px solid rgba(0,0,0,0.88);
              box-shadow: 0 0 0 2px rgba(255,255,255,0.65), 0 4px 16px rgba(0,0,0,0.65);
              pointer-events: none;
              max-width: 60vw;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .grid-controls {
              display: flex;
              align-items: center;
              margin-left: auto;
              justify-content: flex-end;
              gap: 8px;
              flex-wrap: wrap;
              opacity: 0;
              pointer-events: none;
              transform: translateY(-2px);
              transition: opacity 140ms ease, transform 140ms ease;
            }
            .grid-header:hover .grid-controls,
            .grid-controls:focus-within {
              opacity: 1;
              pointer-events: auto;
              transform: translateY(0);
            }
            body.capture-mode .grid-controls {
              opacity: 0 !important;
              pointer-events: none !important;
            }
            body.snapshot-capturing .grid-controls {
              opacity: 0 !important;
              pointer-events: none !important;
            }
            .grid-controls input[type="text"] {
              height: 28px;
              min-width: 220px;
              border-radius: 6px;
              border: 1px solid rgba(148,163,184,0.45);
              background: rgba(8,15,30,0.85);
              color: #e5e7eb;
              font-size: 12px;
              padding: 0 8px;
            }
            .tf-pills {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              flex-wrap: wrap;
            }
            .tf-pill {
              display: inline-flex;
              align-items: center;
              gap: 4px;
              font-size: 11px;
              color: #cbd5e1;
              border: 1px solid rgba(148,163,184,0.35);
              border-radius: 999px;
              padding: 2px 7px;
              background: rgba(15,23,42,0.7);
            }
            .tf-pill input {
              margin: 0;
            }
            .apply-btn {
              height: 28px;
              border-radius: 6px;
              border: 1px solid rgba(56,189,248,0.45);
              background: rgba(56,189,248,0.14);
              color: #bae6fd;
              font-size: 12px;
              font-weight: 700;
              padding: 0 10px;
              cursor: pointer;
            }
            .snapshot-btn {
              height: 28px;
              border-radius: 6px;
              border: 1px solid rgba(16,185,129,0.5);
              background: rgba(16,185,129,0.14);
              color: #a7f3d0;
              font-size: 12px;
              font-weight: 700;
              padding: 0 10px;
              cursor: pointer;
            }
            .snapshot-status {
              font-size: 11px;
              color: #94a3b8;
              min-width: 90px;
              text-align: right;
            }
            .symbols-stack {
              height: ${captureMode ? "auto" : "calc(100vh - 52px)"};
              overflow-y: ${captureMode ? "visible" : "auto"};
              padding: 8px;
              box-sizing: border-box;
              background: ${theme === "dark" ? "#1a2233" : "#e1e1e1"};
              display: flex;
              flex-direction: column;
              gap: 14px; /* visual separator between symbol groups */
            }
            .symbols-grid {
              display: grid;
              grid-template-columns: repeat(${singleTfCols}, minmax(0, 1fr));
              grid-auto-rows: ${singleCellHeightExpr};
              align-content: start;
              gap: 8px;
              padding: 8px;
              box-sizing: border-box;
              background: ${theme === "dark" ? "#1a2233" : "#e1e1e1"};
              height: ${captureMode ? "auto" : "calc(100vh - 52px)"};
            }
            .symbols-grid .chart-cell {
              height: 100%;
            }
            .symbol-group {
              border: 1px solid ${theme === "dark" ? "rgba(148,163,184,0.2)" : "rgba(15,23,42,0.2)"};
              border-radius: 6px;
              padding: 6px;
              background: ${theme === "dark" ? "rgba(11,18,32,0.55)" : "rgba(255,255,255,0.6)"};
            }
            .grid {
              display: grid;
              grid-template-columns: repeat(${cols}, 1fr);
              grid-auto-rows: minmax(${cellHeight}px, 1fr);
              width: 100%;
              min-height: ${captureMode ? "unset" : "calc(100vh - 74px)"};
              gap: 8px; /* Increased gap to help AI partition */
              background: transparent;
              padding: 0;
              box-sizing: border-box;
            }
            .chart-cell {
              position: relative;
              overflow: hidden;
              background: ${theme === "dark" ? "#0b1220" : "#ffffff"};
              border-radius: 4px; /* Slight rounding for clean edges */
            }
            .chart-cell iframe {
              position: absolute;
              top: -38px;
              left: -42px;
              width: calc(100% + 45px);
              height: calc(100% + 40px);
              border: none;
            }
            .tf-badge {
              position: absolute;
              top: 11px;
              left: 11px;
              background: rgba(255,255,255,0.95);
              color: #07111f;
              padding: 3px 6px;
              border-radius: 4px;
              font-size: 9px;
              font-family: monospace;
              font-weight: 800;
              letter-spacing: 0;
              z-index: 2147483647;
              pointer-events: none;
              border: 1px solid rgba(0,0,0,0.88);
              box-shadow: 0 0 0 1px rgba(255,255,255,0.65), 0 2px 8px rgba(0,0,0,0.65);
            }
          </style>
        </head>
        <body class="${captureMode ? "capture-mode" : ""}">
          <div class="grid-header">
            <div class="grid-meta-badge">${gridHeaderText}</div>
            <form id="grid-controls-form" class="grid-controls" method="GET" action="/v2/chart/snapshots-grid/${encodeURIComponent(symbolRaw)}">
              <input type="hidden" name="theme" value="${htmlEscape(theme)}" />
              <input type="hidden" name="tz" value="${htmlEscape(selectedTz)}" />
              <input type="hidden" name="group_name" value="${htmlEscape(defaultGroupName)}" />
              <select name="symbols_group" style="height:28px;border-radius:6px;border:1px solid rgba(148,163,184,0.45);background:rgba(8,15,30,0.85);color:#e5e7eb;font-size:12px;padding:0 8px;">
                <option value="custom">Custom</option>
                <option value="watchlist" ${defaultGroupName === "watchlist" ? "selected" : ""}>Watchlist</option>
                <option value="forex">Forex</option>
                <option value="crypto">Crypto</option>
                <option value="metals">Metals</option>
                <option value="indices">Indices</option>
                <option value="all">All</option>
              </select>
              <select name="provider" style="height:28px;border-radius:6px;border:1px solid rgba(148,163,184,0.45);background:rgba(8,15,30,0.85);color:#e5e7eb;font-size:12px;padding:0 8px;">
                <option value="" ${provider === "" ? "selected" : ""}>Empty</option>
                <option value="ICMARKETS" ${provider.toUpperCase() === "ICMARKETS" ? "selected" : ""}>IC Markets</option>
                <option value="OANDA" ${provider.toUpperCase() === "OANDA" ? "selected" : ""}>OANDA</option>
                <option value="BINANCE" ${provider.toUpperCase() === "BINANCE" ? "selected" : ""}>Binance</option>
              </select>
              <input type="text" name="symbols" value="${htmlEscape(symbols.join(","))}" placeholder="XAUUSD,BTCUSD" />
              <div class="tf-pills">
                ${tfChoices
                  .map((choice) => {
                    const checked = tfs.some(
                      (x) =>
                        String(x).toLowerCase() ===
                        String(choice).toLowerCase(),
                    )
                      ? "checked"
                      : "";
                    return `<label class="tf-pill"><input type="checkbox" name="tfs" value="${choice}" ${checked} />${choice}</label>`;
                  })
                  .join("")}
              </div>
              <button class="snapshot-btn" id="snapshot-browser-btn" type="button" title="Browser capture — screenshots your current viewport (zoom, bars, iframes)">📷 Browser</button>
              <button class="snapshot-btn" id="snapshot-api-btn" type="button" title="API capture — server-side Playwright snapshot">📷 API</button>
              <span class="snapshot-status" id="snapshot-status"></span>
            </form>
          </div>
          ${
            singleTfMode
              ? `<div class="symbols-grid">
            ${symbols
              .map(
                (sym) => `
              <div class="chart-cell">
                <div class="tf-badge">${htmlEscape(sym)} | ${htmlEscape(displayTfs[0])}${provider ? ` | ${htmlEscape(String(provider).toUpperCase())}` : ""}</div>
                <iframe src="https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(resolvedTvSymbols[sym] || toTradingViewSymbol(sym, provider))}&interval=${encodeURIComponent(tvIntervals[0])}&theme=${encodeURIComponent(theme)}&style=1&timezone=${encodeURIComponent(effectiveTz)}&hide_top_toolbar=1&hide_legend=1&hide_side_toolbar=1&allow_symbol_change=0&save_image=0"></iframe>
              </div>
            `,
              )
              .join("")}
          </div>`
              : `<div class="symbols-stack">
            ${symbols
              .map(
                (sym) => `
              <section class="symbol-group">
                <div class="grid">
                  ${tfs
                    .map(
                      (tf, i) => `
                    <div class="chart-cell">
                      <div class="tf-badge">${htmlEscape(sym)} | ${htmlEscape(displayTfs[i])}${provider ? ` | ${htmlEscape(String(provider).toUpperCase())}` : ""}</div>
                      <iframe src="https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(resolvedTvSymbols[sym] || toTradingViewSymbol(sym, provider))}&interval=${encodeURIComponent(tvIntervals[i])}&theme=${encodeURIComponent(theme)}&style=1&timezone=${encodeURIComponent(effectiveTz)}&hide_top_toolbar=1&hide_legend=1&hide_side_toolbar=1&allow_symbol_change=0&save_image=0"></iframe>
                    </div>
                  `,
                    )
                    .join("")}
                </div>
              </section>
            `,
              )
              .join("")}
          </div>`
          }
          <script>
            (function () {
              const form = document.getElementById("grid-controls-form");
              const browserBtn = document.getElementById("snapshot-browser-btn");
              const apiBtn = document.getElementById("snapshot-api-btn");
              const statusEl = document.getElementById("snapshot-status");
              const titleEl = document.querySelector(".grid-meta-badge");
              if (!form || !browserBtn || !apiBtn || !statusEl) return;
              const groupedSymbols = ${JSON.stringify(groupedSymbols)};
              const PREF_KEY = "snapshots-grid-prefs-v1";

              // LOCAL timezone must be resolved client-side for browser view.
              try {
                const tzSelect = form.querySelector('select[name="tz"]');
                const tzMode = String(tzSelect?.value || "").toUpperCase();
                if (tzMode === "LOCAL") {
                  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
                  document.querySelectorAll(".chart-cell iframe").forEach((fr) => {
                    const u = new URL(fr.src);
                    u.searchParams.set("timezone", localTz);
                    fr.src = u.toString();
                  });
                  if (titleEl) {
                    const now = new Date();
                    const time = now.toLocaleString("sv-SE", { timeZone: localTz, hour12: false }).replace(" ", " ");
                    titleEl.textContent = time + " " + localTz + " | ${sessionLabelShort} | Local";
                  }
                }
              } catch (_) {}

              function getSymbols() {
                const fd = new FormData(form);
                const symbolsRaw = String(fd.get("symbols") || "");
                return symbolsRaw
                  .split(/[\s,|;+]+|--|-/g)
                  .map((s) => String(s || "").trim().toUpperCase())
                  .filter(Boolean)
                  .slice(0, 8);
              }
              function getTfValues() {
                const fd = new FormData(form);
                const list = fd
                  .getAll("tfs")
                  .map((s) => String(s || "").trim())
                  .filter(Boolean);
                return list.length ? list : ["4h"];
              }
              function savePrefs() {
                try {
                  const fd = new FormData(form);
                  const prefs = {
                    tz: String(fd.get("tz") || "UTC"),
                    provider: String(fd.get("provider") || ""),
                    symbols: String(fd.get("symbols") || ""),
                    symbols_group: String(fd.get("symbols_group") || "custom"),
                    tfs: getTfValues(),
                  };
                  localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
                } catch (_) {}
              }
              function buildAutoUrl() {
                const fd = new FormData(form);
                const u = new URL(window.location.href);
                const firstSym = getSymbols()[0] || "";
                const basePath = "/v2/chart/snapshots-grid/" + encodeURIComponent(firstSym);
                u.pathname = basePath;
                u.searchParams.set("theme", String(fd.get("theme") || "dark"));
                u.searchParams.set("tz", String(fd.get("tz") || "UTC"));
                u.searchParams.set("provider", String(fd.get("provider") || ""));
                u.searchParams.set("symbols", getSymbols().join(","));
                u.searchParams.delete("tfs");
                for (const tf of getTfValues()) u.searchParams.append("tfs", tf);
                return u.toString();
              }
              let autoTimer = null;
              function autoApply(delayMs) {
                savePrefs();
                clearTimeout(autoTimer);
                autoTimer = setTimeout(() => {
                  window.location.assign(buildAutoUrl());
                }, delayMs);
              }

              // Load saved prefs if current URL has no explicit query controls.
              try {
                const hasExplicit =
                  window.location.search.includes("symbols=") ||
                  window.location.search.includes("tfs=") ||
                  window.location.search.includes("timeframes=") ||
                  window.location.search.includes("provider=") ||
                  window.location.search.includes("tz=");
                if (!hasExplicit) {
                  const raw = localStorage.getItem(PREF_KEY);
                  const p = raw ? JSON.parse(raw) : null;
                  if (p && typeof p === "object") {
                    const tzEl = form.querySelector('select[name="tz"]');
                    const providerEl = form.querySelector('select[name="provider"]');
                    const symbolsEl = form.querySelector('input[name="symbols"]');
                    const groupEl = form.querySelector('select[name="symbols_group"]');
                    if (tzEl && p.tz) tzEl.value = p.tz;
                    if (providerEl && p.provider != null) providerEl.value = p.provider;
                    if (symbolsEl && p.symbols) symbolsEl.value = p.symbols;
                    if (groupEl && p.symbols_group) groupEl.value = p.symbols_group;
                    const tfSet = new Set(
                      Array.isArray(p.tfs) ? p.tfs.map((x) => String(x || "").trim()).filter(Boolean) : [],
                    );
                    if (tfSet.size) {
                      form.querySelectorAll('input[name="tfs"]').forEach((cb) => {
                        cb.checked = tfSet.has(String(cb.value || ""));
                      });
                    }
                  }
                }
              } catch (_) {}

              function applyGroupSelection(group) {
                const symbolsEl = form.querySelector('input[name="symbols"]');
                const groupNameEl = form.querySelector('input[name="group_name"]');
                if (!symbolsEl || !groupNameEl) return;
                const g = String(group || "custom");
                if (g !== "custom" && Array.isArray(groupedSymbols[g]) && groupedSymbols[g].length) {
                  symbolsEl.value = groupedSymbols[g].join(",");
                  groupNameEl.value = g;
                } else {
                  groupNameEl.value = "group";
                }
                symbolsEl.readOnly = g !== "custom";
              }

              // Auto update charts when controls change (no Apply button).
              form.querySelectorAll('select[name="provider"], input[name="tfs"]').forEach((el) => {
                el.addEventListener("change", () => autoApply(150));
              });
              const groupSelect = form.querySelector('select[name="symbols_group"]');
              if (groupSelect) {
                applyGroupSelection(groupSelect.value);
                groupSelect.addEventListener("change", () => {
                  applyGroupSelection(groupSelect.value);
                  autoApply(150);
                });
              }
              const symbolsInput = form.querySelector('input[name="symbols"]');
              if (symbolsInput) {
                symbolsInput.addEventListener("input", () => {
                  const groupEl = form.querySelector('select[name="symbols_group"]');
                  const groupNameEl = form.querySelector('input[name="group_name"]');
                  if (groupEl && groupEl.value !== "custom") groupEl.value = "custom";
                  if (groupNameEl) groupNameEl.value = "group";
                  autoApply(500);
                });
              }

              function hideToolbar() {
                document.body.classList.add("snapshot-capturing");
              }

              function showToolbar() {
                document.body.classList.remove("snapshot-capturing");
              }

              // 📷 Browser: Screen Capture API — captures your actual viewport (zoom, bars, iframes)
              browserBtn.addEventListener("click", async () => {
                hideToolbar();
                const stack = document.querySelector(".symbols-stack");
                const origBodyOverflow = document.body.style.overflow;
                const origStackOverflow = stack?.style?.overflowY;
                const origStackHeight = stack?.style?.height;
                try {
                  statusEl.textContent = "Expanding page...";
                  // Expand page to show full grid content before capture
                  document.body.style.overflow = "visible";
                  if (stack) {
                    stack.style.overflowY = "visible";
                    stack.style.height = "auto";
                  }
                  await new Promise((r) => setTimeout(r, 200));
                  statusEl.textContent = "Capturing viewport...";
                  const symbols = getSymbols();
                  if (!symbols.length) {
                    statusEl.textContent = "Need symbols";
                    showToolbar();
                    return;
                  }
                  const symbol = symbols[0];
                  const groupNameRaw = String(new FormData(form).get("group_name") || "").trim();
                  const useGroup = symbols.length > 1 || !symbol;
                  const groupName = useGroup ? (groupNameRaw || "group") : "";
                  const stream = await navigator.mediaDevices.getDisplayMedia({
                    preferCurrentTab: true,
                    video: { frameRate: 1 },
                  });
                  const track = stream.getVideoTracks()[0];
                  const imageCapture = new ImageCapture(track);
                  const bitmap = await imageCapture.grabFrame();
                  const canvas = document.createElement("canvas");
                  canvas.width = bitmap.width;
                  canvas.height = bitmap.height;
                  canvas.getContext("2d").drawImage(bitmap, 0, 0);
                  track.stop();
                  statusEl.textContent = "Uploading...";
                  const dataUrl = canvas.toDataURL("image/png");
                  const res = await fetch("/v2/chart/snapshots-grid/upload", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      symbol,
                      symbols,
                      group_name: groupName,
                      image_data: dataUrl,
                    }),
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok || data?.ok === false) {
                    statusEl.textContent = "Failed";
                    showToolbar();
                    return;
                  }
                  statusEl.textContent = "Saved " + (data?.file_name || symbol);
                } catch (_) {
                  statusEl.textContent = "Failed";
                } finally {
                  // Restore original overflow styles
                  document.body.style.overflow = origBodyOverflow;
                  if (stack) {
                    stack.style.overflowY = origStackOverflow;
                    stack.style.height = origStackHeight;
                  }
                  showToolbar();
                }
              });

              // 📷 API: Server-side Playwright batch snapshot
              apiBtn.addEventListener("click", async () => {
                hideToolbar();
                try {
                  statusEl.textContent = "Sending to API...";
                  const fd = new FormData(form);
                  const symbols = getSymbols();
                  const tfs = fd
                    .getAll("tfs")
                    .map((s) => String(s || "").trim())
                    .filter(Boolean);
                  const theme = String(fd.get("theme") || "dark").trim() || "dark";
                  const tz = String(fd.get("tz") || "UTC").trim() || "UTC";
                  const provider = String(fd.get("provider") || "").trim();
                  if (!symbols.length || !tfs.length) {
                    statusEl.textContent = "Need symbols + TFs";
                    showToolbar();
                    return;
                  }
                  const body = {
                    symbols,
                    tfs,
                    theme,
                    timezone: tz,
                    provider,
                    merge_snapshots: true,
                  };
                  const res = await fetch("/v2/chart/snapshot/batch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok || data?.ok === false) {
                    statusEl.textContent = "Failed";
                    showToolbar();
                    return;
                  }
                  const count = Array.isArray(data?.items) ? data.items.length : 0;
                  statusEl.textContent = "Saved " + count + " via API";
                } catch (_) {
                  statusEl.textContent = "Failed";
                } finally {
                  showToolbar();
                }
              });
            })();
          </script>
        </body>
      </html>
    `);
    return;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/v2/chart/snapshots-grid/upload"
  ) {
    try {
      const body = await readJson(req);
      const symbol = String(body?.symbol || "")
        .trim()
        .toUpperCase();
      const symbols = Array.isArray(body?.symbols)
        ? body.symbols.map((s) => normalizeMarketDataSymbol(s)).filter(Boolean)
        : [];
      const groupNameRaw = String(body?.group_name || "")
        .trim()
        .toLowerCase();
      const imageData = String(body?.image_data || "").trim();
      if ((!symbol && !symbols.length) || !imageData) {
        return json(res, 400, {
          ok: false,
          error: "symbol/symbols and image_data required",
        });
      }
      // Decode base64 data URL: data:image/png;base64,XXXX
      const base64Match = imageData.match(/^data:image\/\w+;base64,(.+)$/);
      if (!base64Match) {
        return json(res, 400, {
          ok: false,
          error: "invalid image_data format, expected data URL",
        });
      }
      const buf = Buffer.from(base64Match[1], "base64");
      if (buf.length === 0) {
        return json(res, 400, { ok: false, error: "empty image data" });
      }
      const useGroup = symbols.length > 1 || !symbol;
      const safeGroup =
        String(groupNameRaw || "group")
          .replace(/[^a-z0-9_-]+/gi, "_")
          .replace(/_+/g, "_")
          .replace(/^_+|_+$/g, "")
          .toLowerCase() || "group";
      const outFileName = useGroup
        ? `${safeGroup}.png`
        : `${symbol}_MASTER.png`;
      const outDir = useGroup ? CHART_SNAPSHOT_DIR : snapshotSymbolDir(symbol);
      const outPath = path.join(outDir, outFileName);
      fs.writeFileSync(outPath, buf);
      return json(res, 200, {
        ok: true,
        symbol: symbol || null,
        group_name: useGroup ? safeGroup : null,
        file_name: outFileName,
        size_bytes: buf.length,
        url: useGroup
          ? null
          : `/v2/chart/snapshots/${encodeURIComponent(symbol)}/${encodeURIComponent(outFileName)}`,
      });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/chart/tv-tile") {
    const symbolRaw = normalizeMarketDataSymbol(
      url.searchParams.get("symbol") || "BTCUSD",
    );
    const provider = String(url.searchParams.get("provider") || "").trim();
    const symbol = await resolveTradingViewSymbolForCapture(
      symbolRaw,
      provider,
    );
    const interval = String(url.searchParams.get("interval") || "60").trim();
    const theme =
      String(url.searchParams.get("theme") || "dark").toLowerCase() === "light"
        ? "light"
        : "dark";
    const tz = normalizeTvTimezone(url.searchParams.get("tz"), "Etc/UTC");
    const symbolEsc = htmlEscape(symbol);
    const intervalEsc = htmlEscape(interval);
    const themeEsc = htmlEscape(theme);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: ${themeEsc === "dark" ? "#0b1220" : "#ffffff"}; overflow: hidden; }
    .tradingview-widget-container, .tradingview-widget-container__widget { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div class="tradingview-widget-container">
    <div class="tradingview-widget-container__widget"></div>
    <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>
      {
        "autosize": true,
        "symbol": "${symbolEsc}",
        "interval": "${intervalEsc}",
        "timezone": "${htmlEscape(tz === "LOCAL" ? "Etc/UTC" : tz)}",
        "theme": "${themeEsc}",
        "style": "1",
        "locale": "en",
        "hide_top_toolbar": true,
        "hide_side_toolbar": true,
        "hide_legend": true,
        "allow_symbol_change": false,
        "save_image": false
      }
    </script>
  </div>
</body>
</html>`);
    return;
  }

  if (req.method === "POST" && url.pathname === "/v2/chart/refresh") {
    const chartTraceId = genTraceId("chart_");
    const t0 = Date.now();
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const body = await readJson(req);
      const userId = sess.user_id || CFG.mt5DefaultUserId;
      const symbols = (
        Array.isArray(body.symbols) ? body.symbols : [body.symbol]
      )
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .slice(0, 8);
      if (!symbols.length)
        return json(res, 400, {
          ok: false,
          error: "symbol or symbols is required",
        });
      const timeframes = (
        Array.isArray(body.timeframes)
          ? body.timeframes
          : String(body.timeframes || body.tfs || "D,4H,1H,15M").split(",")
      )
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .slice(0, 8);
      const types = new Set(
        (Array.isArray(body.types)
          ? body.types
          : String(body.types || "context,snapshots").split(",")
        )
          .map((x) =>
            String(x || "")
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean),
      );
      const wantsContext = ["context", "bars", "analysis", "tradeplans"].some(
        (x) => types.has(x),
      );
      const wantsSnapshots = ["snapshot", "snapshots", "images"].some((x) =>
        types.has(x),
      );
      const bars = Math.max(
        50,
        Math.min(Number(body.bars || body.lookbackBars || 300) || 300, 1000),
      );
      const provider = String(body.provider || "ICMARKETS").trim();
      const force = body.force === true || asBool(body.refresh, false);
      const sessionPrefix = sanitizeSessionPrefix(
        body.session_prefix || body.sessionPrefix || "",
      );
      const tradeSid = String(
        body.trade_sid || body.tradeSid || body.sid || "",
      ).trim();
      const snapshotMaxAgeMs = Math.max(
        0,
        Number(
          body.snapshot_max_age_ms || body.snapshotMaxAgeMs || 15 * 60 * 1000,
        ) || 0,
      );
      const includeSnapshotsInContext =
        body.include_snapshots === true || body.includeSnapshots === true;
      const claudeKey = wantsContext
        ? await loadClaudeApiKeyForUser(userId)
        : "";
      if (wantsContext && !claudeKey)
        return json(res, 400, {
          ok: false,
          error: "CLAUDE_API_KEY is missing in Settings.",
        });

      const results = [];
      for (const symbol of symbols) {
        const row = {
          symbol: normalizeMarketDataSymbol(symbol),
          requested_symbol: symbol,
          provider,
          timeframes,
          types: [...types],
          context: null,
          snapshots: null,
          status: "ok",
          errors: [],
        };

        if (wantsContext && UPLOAD_TO_CLAUDE) {
          try {
            row.context = await buildAiContextBundle({
              userId,
              apiKey: claudeKey,
              symbol,
              timeframes,
              bars,
              provider,
              forceRefresh: force,
              forceSnapshot: false,
              includeSnapshots: includeSnapshotsInContext,
            });
          } catch (error) {
            row.status = "partial";
            row.errors.push({
              type: "context",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (wantsSnapshots) {
          try {
            const cached = force
              ? {
                  items: [],
                  missing_timeframes: timeframes.map((tf) =>
                    toTradingViewInterval(tf).toUpperCase(),
                  ),
                  target_timeframes: timeframes.map((tf) =>
                    toTradingViewInterval(tf).toUpperCase(),
                  ),
                }
              : findRecentChartSnapshots({
                  symbol,
                  provider,
                  timeframes,
                  sessionPrefix,
                  maxAgeMs: snapshotMaxAgeMs,
                });
            let created = [];
            if (cached.missing_timeframes.length) {
              created = await captureTradingViewSnapshotsBatch({
                userId,
                symbol,
                provider,
                session_prefix: sessionPrefix,
                timeframes: cached.missing_timeframes,
                lookbackBars: bars,
                format: body.format || "png",
                quality: body.quality || 90,
                captureConcurrency: body.captureConcurrency || 2,
              });
            }
            row.snapshots = {
              target_timeframes: cached.target_timeframes,
              cached: cached.items,
              created,
              items: [...cached.items, ...created],
              matched_count: cached.items.length + created.length,
              target_count: cached.target_timeframes.length,
              missing_timeframes: cached.target_timeframes.filter(
                (tf) =>
                  ![...cached.items, ...created].some(
                    (x) => String(x?.timeframe || "").toUpperCase() === tf,
                  ),
              ),
            };
            if (tradeSid && row.snapshots?.items?.length) {
              const tradeSymbol = await mt5ResolveTradeFolderSymbol(
                tradeSid,
                symbol,
              );
              const copied = copySnapshotsToTradeSidFolder(
                tradeSid,
                row.snapshots.items
                  .map((x) => String(x?.file_name || "").trim())
                  .filter(Boolean),
                tradeSymbol,
              );
              const persisted = await persistTradeSnapshotFiles(
                tradeSid,
                copied,
                tradeSymbol,
              );
              row.snapshots.trade_sid = tradeSid;
              row.snapshots.copied_to_trade = copied;
              row.snapshots.persisted_to_trade = persisted;
            }
          } catch (error) {
            row.status = row.status === "ok" ? "partial" : row.status;
            row.errors.push({
              type: "snapshots",
              error: error instanceof Error ? error.message : String(error),
            });
            row.snapshots = row.snapshots || {
              target_timeframes: timeframes,
              cached: [],
              created: [],
              items: [],
              matched_count: 0,
              target_count: timeframes.length,
              missing_timeframes: timeframes,
            };
          }
        }

        results.push(row);
      }

      if (notificationManager) {
        notificationManager.handle("SYSTEM_EVENT", "chart_refresh", {
          message: `Chart refresh: ${symbols.length} symbols, ${timeframes.length} TFs`,
          symbols: symbols.length,
          timeframes: timeframes.length,
          duration_ms: Date.now() - t0,
        });
      }
      return json(res, 200, {
        ok: true,
        generated_at: new Date().toISOString(),
        symbols: results,
        context: results.length === 1 ? results[0].context : undefined,
        snapshots: results.length === 1 ? results[0].snapshots : undefined,
      });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/chart/twelve/candles") {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const symbol = String(url.searchParams.get("symbol") || "").trim();
      const timeframe = String(
        url.searchParams.get("timeframe") ||
          url.searchParams.get("tf") ||
          "15m",
      ).trim();
      const bars = Math.max(
        50,
        Math.min(Number(url.searchParams.get("bars") || 300) || 300, 1000),
      );
      const forceRefresh = asBool(url.searchParams.get("refresh"), false);
      if (!symbol)
        return json(res, 400, { ok: false, error: "symbol is required" });
      const userId = sess.user_id || CFG.mt5DefaultUserId;
      const snapshot = await buildAnalysisSnapshotFromTwelve({
        userId,
        payload: { bars, force_refresh: forceRefresh },
        symbol,
        timeframe,
      });
      if (String(snapshot?.status || "").toLowerCase() !== "ok") {
        return json(res, 400, {
          ok: false,
          error: snapshot?.reason || "twelve_data_failed",
          snapshot,
        });
      }

      // Add UI metadata fields
      const updated_time =
        snapshot.updated_time ||
        (snapshot.fetched_at
          ? new Date(snapshot.fetched_at).getTime()
          : Date.now());
      const source = snapshot.cache_source || "remote_api";
      const auto_refresh = parseTfTokenToSeconds(timeframe) || 60; // Refresh based on timeframe

      // Normalize source label for UI
      const displaySource = snapshot.cache_source || source || "twelvedata";
      const tfNorm = normalizeMarketDataTf(timeframe);
      const redisKey = `tf:${tfCacheKey(normalizeMarketDataSymbol(symbol), tfNorm)}`;
      const ttlSec = Math.ceil(tfToMs(tfNorm) / 1000);
      return json(res, 200, {
        ok: true,
        snapshot,
        source: displaySource,
        updated_time,
        auto_refresh,
        cache_debug: {
          redis_key: redisKey,
          ttl_sec: ttlSec,
          timeframe_input: timeframe,
          timeframe_normalized: tfNorm,
          cache_source: displaySource,
          binance_api_url: snapshot?.api_url || null,
          binance_interval: snapshot?.api_interval || null,
        },
      });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/chart/symbols") {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const q = String(
        url.searchParams.get("q") || url.searchParams.get("text") || "",
      ).trim();
      const provider = String(
        url.searchParams.get("provider") || "ICMARKETS",
      ).trim();
      const limit = Math.max(
        1,
        Math.min(Number(url.searchParams.get("limit") || 20) || 20, 50),
      );
      if (!q) return json(res, 200, { ok: true, items: [] });
      const items = await fetchTradingViewSymbolSearch(q, provider, limit);
      return json(res, 200, { ok: true, symbols: items });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // GET /v2/market-data/snapshots/{symbol}/{filename}/content
  if (
    req.method === "GET" &&
    url.pathname.startsWith("/v2/market-data/snapshots/") &&
    url.pathname.endsWith("/content")
  ) {
    const parts = url.pathname
      .replace("/v2/market-data/snapshots/", "")
      .split("/");
    const symbol = decodeURIComponent(parts[0] || "").toUpperCase();
    const fileName = decodeURIComponent(parts.slice(1, -1).join("/") || "");
    if (!symbol || !fileName)
      return json(res, 400, {
        ok: false,
        error: "symbol and filename required",
      });
    const filePath = path.join(CHART_SNAPSHOT_DIR, symbol, fileName);
    if (!fs.existsSync(filePath))
      return json(res, 404, { ok: false, error: "file not found" });
    const ext = path.extname(fileName).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=3600",
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // GET /v2/market-data/snapshots/{symbol} — latest snapshots for a symbol
  if (
    req.method === "GET" &&
    url.pathname.startsWith("/v2/market-data/snapshots/")
  ) {
    const symbol = decodeURIComponent(
      url.pathname.replace("/v2/market-data/snapshots/", ""),
    ).toUpperCase();
    if (!symbol) return json(res, 400, { ok: false, error: "symbol required" });
    const limit = Math.max(
      1,
      Math.min(20, Number(url.searchParams.get("limit") || 5)),
    );
    const files = listLatestSnapshotFilesForSymbol(symbol, limit);
    const items = files.map((f) => ({
      name: typeof f === "string" ? f : f.file_name || f.name,
      url: `/v2/market-data/snapshots/${encodeURIComponent(symbol)}/${encodeURIComponent(typeof f === "string" ? f : f.file_name || f.name)}/content`,
      size_bytes: typeof f === "object" ? f.size || 0 : 0,
    }));
    return json(res, 200, { ok: true, symbol, files: items });
  }

  // GET /v2/market-data/broker-bars — read OHLCV bars from broker CSV
  if (req.method === "GET" && url.pathname === "/v2/market-data/broker-bars") {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const symbol = String(url.searchParams.get("symbol") || "")
        .trim()
        .toUpperCase();
      const tfInput = String(url.searchParams.get("tf") || "").trim();
      const tf = normalizeCsvTfKey(tfInput);
      const limit = Math.max(
        10,
        Math.min(5000, Number(url.searchParams.get("limit") || 300) || 300),
      );
      if (!symbol || !tf)
        return json(res, 400, { ok: false, error: "symbol and tf required" });
      const csvPath = path.join(BROKER_BARS_DIR, symbol, "bars", `${tf}.csv`);
      if (!fs.existsSync(csvPath)) {
        return json(res, 200, {
          ok: true,
          symbol,
          tf,
          bars: [],
          source: "cache",
        });
      }
      const raw = fs.readFileSync(csvPath, "utf8");
      const lines = raw.trim().split(/\r?\n/);
      const tfSeconds = Math.max(60, parseTfTokenToSeconds(tf));
      const bars = [];
      const dedup = new Map();
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        if (cols.length < 5) continue;
        const rawTime = Number(cols[0]);
        const o = Number(cols[1]);
        const h = Number(cols[2]);
        const l = Number(cols[3]);
        const c = Number(cols[4]);
        const v = Number(cols[5]) || 0;
        if (!Number.isFinite(rawTime) || !Number.isFinite(o)) continue;
        const t = normalizeBarTimeToUTC(rawTime, tfSeconds);
        // Deduplicate by UTC-aligned time, keep latest value per key
        dedup.set(t, { t, o, h, l, c, v });
      }
      for (const bar of [...dedup.values()].sort((a, b) => a.t - b.t)) {
        bars.push(bar);
      }
      const sliced = bars.slice(-limit);
      return json(res, 200, {
        ok: true,
        symbol,
        tf,
        bars: sliced,
        source: "broker",
      });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/chart/snapshots/analyze") {
    const analyzeTraceId = genTraceId("analyze_");
    const t0a = Date.now();
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const body = await readJson(req);
      const reqPrompt = String(body?.prompt || "");
      const tradesText = String(body?.Trades ?? body?.trades ?? "").trim();
      const analyzeReqSummary = {
        event: "AI_ANALYZE_REQUEST",
        schema_version: AI_RESPONSE_SCHEMA_VERSION,
        mode:
          body?.use_context_files === true ||
          String(body?.context_mode || "").toLowerCase() === "claude"
            ? "context_files"
            : "snapshot_files",
        model: String(body?.model || "claude-sonnet-4-0"),
        symbol: String(body?.symbol || ""),
        provider: String(body?.provider || "ICMARKETS"),
        timeframe: String(body?.timeframe || ""),
        timeframes: Array.isArray(body?.timeframes)
          ? body.timeframes
          : String(body?.tfs || body?.timeframes || "")
              .split(",")
              .filter(Boolean),
        session_prefix: String(
          body?.session_prefix || body?.sessionPrefix || "",
        ),
        bars_count: Number(
          body?.bars_count || body?.lookbackBars || body?.lookback_bars || 300,
        ),
        files_count: Array.isArray(body?.files) ? body.files.length : 0,
        context_files_count: Array.isArray(body?.context_files)
          ? body.context_files.length
          : 0,
        prompt_hash: hashForLog(reqPrompt),
        prompt_len: reqPrompt.length,
        prompt_preview: clipForLog(reqPrompt, 1000),
        trades_hash: hashForLog(tradesText),
        trades_len: tradesText.length,
        attached_images_count: Array.isArray(body?.attached_images)
          ? body.attached_images.length
          : 0,
      };
      const buildTradesReviewPrompt = (basePrompt, tradesRaw) => {
        const base = String(basePrompt || "").trim();
        const tradeText = String(tradesRaw || "").trim();
        if (!tradeText) return base;
        const reviewInstruction =
          "Extract Symbol, Entry, TP, SL from the Trades param text. Do your analysis with the guide and snapshots attached and response if the Trades correct then return the Trade Plan with your analysis with following response format.";
        return `${base}\n\nTRADES_PARAM_TEXT:\n${tradeText}\n\n${reviewInstruction}`;
      };
      const normalizeAttachedImageList = (rawList) => {
        if (!Array.isArray(rawList)) return [];
        const out = [];
        for (const item of rawList.slice(0, 3)) {
          const raw =
            typeof item === "string"
              ? item
              : String(item?.data_url || item?.dataUrl || "").trim();
          if (!raw) continue;
          const m = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
          if (!m) continue;
          const mediaType = String(m[1] || "").toLowerCase();
          if (!/^image\/(png|jpeg|jpg|webp|gif)$/.test(mediaType)) continue;
          const data = String(m[2] || "").trim();
          if (!data) continue;
          out.push({
            mediaType: mediaType === "image/jpg" ? "image/jpeg" : mediaType,
            data,
          });
        }
        return out;
      };
      const appendAttachedImages = (contentList, attachedList) => {
        const normalized = normalizeAttachedImageList(attachedList);
        for (const img of normalized) {
          contentList.push({
            type: "image",
            source: {
              type: "base64",
              media_type: img.mediaType,
              data: img.data,
            },
          });
        }
        return normalized.length;
      };
      const inferSymbolFromSnapshotFile = (fileNameRaw) => {
        const safe = String(fileNameRaw || "").trim();
        if (!safe) return "";
        const base = path
          .basename(safe)
          .replace(/\.(png|jpe?g)$/i, "")
          .toUpperCase();
        const parts = base.split("_").filter(Boolean);
        // Handle MASTER grid snapshots (SYMBOL_MASTER or PROVIDER_SYMBOL_MASTER)
        if (parts.length >= 2 && parts[parts.length - 1] === "MASTER") {
          const sub = parts.slice(0, -1);
          const KNOWN_PROVIDERS = new Set([
            "ICMARKETS",
            "OANDA",
            "FOREXCOM",
            "EIGHTCAP",
            "PEPPERSTONE",
            "FXCM",
            "BINANCE",
            "BYBIT",
          ]);
          if (sub.length >= 2 && KNOWN_PROVIDERS.has(sub[0]))
            return sub.slice(1).join("_");
          return sub.join("_");
        }
        if (parts.length < 3) return "";
        let symbolParts = [];
        if (
          parts.length >= 5 &&
          /^\d{8}$/.test(parts[0]) &&
          /^\d{2}$/.test(parts[1]) &&
          /^\d{2}$/.test(parts[2])
        ) {
          const rest = parts.slice(3);
          const hasDup =
            rest.length >= 3 && /^\d+$/.test(rest[rest.length - 1]);
          symbolParts = rest.slice(0, hasDup ? -2 : -1);
        } else {
          // Supported compact patterns:
          // - PROVIDER_SYMBOL_TF
          // - PROVIDER_SYMBOL_SESSION_TF
          // - PROVIDER_SYMBOL_SESSION_TF_DUP
          if (parts.length === 3) {
            // PROVIDER_SYMBOL_TF -> keep provider+symbol, strip tf
            symbolParts = parts.slice(0, 2);
          } else {
            const hasDup =
              parts.length >= 4 && /^\d+$/.test(parts[parts.length - 1]);
            symbolParts = parts.slice(0, hasDup ? -3 : -2);
          }
        }
        if (!symbolParts.length) return "";
        const KNOWN_PROVIDERS = new Set([
          "ICMARKETS",
          "OANDA",
          "FOREXCOM",
          "EIGHTCAP",
          "PEPPERSTONE",
          "FXCM",
          "BINANCE",
          "BYBIT",
        ]);
        if (symbolParts.length >= 2 && KNOWN_PROVIDERS.has(symbolParts[0])) {
          return symbolParts.slice(1).join("_");
        }
        return symbolParts.join("_");
      };
      const inferSymbolFromRecentSnapshots = () => {
        try {
          const files = fs
            .readdirSync(CHART_SNAPSHOT_DIR)
            .filter((f) => /\.(png|jpe?g)$/i.test(f))
            .map((f) => {
              const st = fs.statSync(path.join(CHART_SNAPSHOT_DIR, f));
              return { f, t: Number(st.mtimeMs || 0) };
            })
            .sort((a, b) => b.t - a.t);
          for (const item of files) {
            const inferred = inferSymbolFromSnapshotFile(item.f);
            if (inferred) return inferred;
          }
          return "";
        } catch {
          return "";
        }
      };
      const reqSessionPrefix = sanitizeSessionPrefix(
        body.session_prefix || body.sessionPrefix || "",
      );
      const autoSaveInput =
        body?.auto_save === undefined || body?.auto_save === null
          ? ""
          : String(body.auto_save).trim().toLowerCase();
      const autoSave =
        autoSaveInput === "signals" || autoSaveInput === "trades"
          ? autoSaveInput
          : "";
      if (
        body?.auto_save !== undefined &&
        body?.auto_save !== null &&
        autoSaveInput !== "null" &&
        !autoSave
      ) {
        return json(res, 400, {
          ok: false,
          error: "auto_save must be null, 'signals', or 'trades'",
        });
      }
      const normalizeDirectionToAction = (value) => {
        const dir = String(value || "")
          .trim()
          .toUpperCase();
        if (dir.includes("SELL") || dir === "SHORT") return "SELL";
        return "BUY";
      };
      const ensureTradePlanCoverageBySymbol = (
        parsed,
        requestedSymbolsRaw = [],
      ) => {
        const out = parsed && typeof parsed === "object" ? parsed : {};
        const requested = (
          Array.isArray(requestedSymbolsRaw) ? requestedSymbolsRaw : []
        )
          .map((x) => normalizeSymbolLoose(x))
          .filter(Boolean);
        if (!requested.length) return out;
        const parseTradePlanItem = (plan, fallbackSymbol = "") => {
          if (!plan || typeof plan !== "object") return null;
          const parsedPlan = {
            ...(plan || {}),
            symbol: String(plan?.symbol || fallbackSymbol || "").trim(),
            entry: plan?.entry ?? plan?.entry_price ?? null,
            sl: plan?.sl ?? plan?.stop_loss ?? null,
            tp: resolvePlanTakeProfit(plan),
          };
          return parsedPlan;
        };
        const collectAllTradePlans = () => {
          const result = [];
          const pushOne = (p, sym = "") => {
            const parsedOne = parseTradePlanItem(p, sym);
            if (parsedOne) result.push(parsedOne);
          };
          const rootPlans = Array.isArray(out.trade_plan)
            ? out.trade_plan
            : out?.trade_plan && typeof out.trade_plan === "object"
              ? [out.trade_plan]
              : [];
          for (const p of rootPlans) pushOne(p, out.symbol || "");
          const fromEntries = (entries) => {
            if (!Array.isArray(entries)) return;
            for (const e of entries) {
              if (!e || typeof e !== "object") continue;
              const rows = Array.isArray(e.trade_plan)
                ? e.trade_plan
                : e?.trade_plan && typeof e.trade_plan === "object"
                  ? [e.trade_plan]
                  : [];
              for (const p of rows) pushOne(p, e.symbol || "");
            }
          };
          fromEntries(out.analysis_data);
          fromEntries(out.symbols);
          fromEntries(out.analyses);
          return dedupeTradePlans(result);
        };
        const normalizedAllPlans = collectAllTradePlans();
        const plans = normalizedAllPlans.length
          ? [...normalizedAllPlans]
          : Array.isArray(out.trade_plan)
            ? [...out.trade_plan]
            : [];
        const collectNestedPlansForSymbol = (sym) => {
          const pickFromEntries = (entries) => {
            if (!Array.isArray(entries)) return [];
            return entries.flatMap((entry) => {
              if (!entry || typeof entry !== "object") return [];
              const entrySymbol = normalizeSymbolLoose(entry.symbol);
              if (entrySymbol !== sym) return [];
              const tp = entry.trade_plan;
              const rows = Array.isArray(tp)
                ? tp
                : tp && typeof tp === "object"
                  ? [tp]
                  : [];
              return rows
                .filter((p) => p && typeof p === "object")
                .map((p) => ({
                  ...(p || {}),
                  symbol: String(p?.symbol || entry?.symbol || sym).trim(),
                }));
            });
          };
          return [
            ...pickFromEntries(out.analysis_data),
            ...pickFromEntries(out.symbols),
            ...pickFromEntries(out.analyses),
          ];
        };
        const existing = new Set(
          plans.map((p) => normalizeSymbolLoose(p?.symbol)).filter(Boolean),
        );
        for (const sym of requested) {
          if (existing.has(sym)) continue;
          const recovered = collectNestedPlansForSymbol(sym);
          if (recovered.length) {
            plans.push(...recovered);
            existing.add(sym);
            continue;
          }
          plans.push({
            symbol: sym,
            direction: "BUY",
            profile: "Intraday",
            order_type: "Market",
            session: "Any",
            strategy: "SMC",
            entry_model: "No valid setup",
            entry_price: null,
            stop_loss: null,
            take_profits: [],
            risk_reward: null,
            risk_percent: null,
            estimated_candles_to_tp1: null,
            estimate_candles_that_entry_happens: null,
            entry_trigger: "",
            mid_trade_invalidation: "",
            pre_entry_invalidation: "",
            confluence_score: 0,
            trade_decision: "Skip",
            skip_reasons: [
              {
                reason: `No valid setup found for ${sym} from current chart files.`,
                severity: "info",
              },
            ],
            risk_management: {
              grade: "C",
              risk_percent: null,
              confidence_pct: 0,
              estimate_mins_that_entry_happens: null,
              skip_decision: "Skip",
              skip_reasons: `No valid setup found for ${sym} from current chart files.`,
              entry_trigger: "",
              mid_trade_invalidation: "",
              pre_entry_invalidation: "",
            },
            grade: "C",
            confidence_pct: 0,
            note: "Auto-added by server to ensure per-symbol coverage.",
          });
        }
        out.trade_plan = plans;
        return out;
      };
      const collectAutoSavableTradePlans = (
        parsed = {},
        fallbackSymbol = "",
      ) => {
        const plans = [];
        if (Array.isArray(parsed?.trade_plan)) {
          plans.push(...parsed.trade_plan);
        } else if (parsed?.execution_plan || parsed?.direction) {
          plans.push(parsed);
        }
        const out = [];
        for (const plan of plans) {
          const ep = plan?.execution_plan;
          const entry = Number(
            ep?.entry?.price ?? plan?.entry ?? plan?.entry_price,
          );
          const sl = Number(
            ep?.stop_loss?.price ?? plan?.sl ?? plan?.stop_loss,
          );
          const tp = Number(ep?.tp1?.price ?? resolvePlanTakeProfit(plan));
          if (
            Number.isFinite(entry) &&
            Number.isFinite(sl) &&
            Number.isFinite(tp)
          ) {
            out.push({
              plan,
              entry,
              sl,
              tp,
              symbol: String(
                plan?.symbol || parsed?.symbol || fallbackSymbol || "",
              )
                .trim()
                .toUpperCase(),
            });
          }
        }
        return out;
      };
      const autoSaveAnalyzeResult = async ({
        mode,
        parsedJson,
        sourceSymbol,
        providerRaw,
      }) => {
        if (!mode) return { enabled: false, mode: null };
        try {
          const picks = collectAutoSavableTradePlans(
            parsedJson,
            sourceSymbol || parsedJson?.symbol || body?.symbol || "",
          );
          if (!picks.length) {
            return {
              enabled: true,
              mode,
              saved: false,
              error: "No valid trade_plan entry with entry/sl/tp",
            };
          }
          const symbol = String(
            sourceSymbol || parsedJson?.symbol || body?.symbol || "",
          )
            .trim()
            .toUpperCase();
          if (!symbol) {
            return {
              enabled: true,
              mode,
              saved: false,
              error: "symbol is required for auto_save",
            };
          }
          const source = mt5NormalizeUiSource(
            `ai_${providerRaw || "claude"}`,
            "ai_claude",
          );
          const sharedRawJson = {
            source: "ai_analyze_auto_save",
            session_id: sessionId,
            auto_save: mode,
            analyze_mode: useContextFiles ? "context_files" : "snapshot_files",
            prompt: String(body?.prompt || ""),
            symbol,
            timeframe: String(body?.timeframe || ""),
            model: String(body?.model || ""),
            ai_provider: providerRaw || "claude",
            analysis_result: parsedJson,
            trade_plan: picks.map((x) => x.plan),
          };
          if (mode === "signals") {
            // Create trade with DRAFT status (no dispatch to broker)
            const savedTrades = [];
            for (const pick of picks) {
              const plan = pick.plan || {};
              const planSymbol = String(pick.symbol || symbol)
                .trim()
                .toUpperCase();
              if (!planSymbol) continue;
              const sourceId = mt5SlugId(source, "tradingview");
              const fanout = await mt5FanoutSignalTradeV2({
                signal_id: null,
                source_id: sourceId,
                user_id: userId,
                entry_model: String(plan?.entry_model || "").trim() || null,
                symbol: planSymbol,
                action: normalizeDirectionToAction(plan?.direction),
                entry: pick.entry,
                sl: pick.sl,
                tp: pick.tp,
                volume: asNum(body?.volume ?? body?.lots, null),
                rr_planned: asNum(plan?.rr, null),
                note: String(
                  plan?.note || parsedJson?.final_verdict?.note || "",
                ).trim(),
                sid: sessionId,
                execution_status: "DRAFT",
                metadata: {
                  event_type: "AI_ANALYZE_AUTO_SAVE_DRAFT",
                  raw_json: plan && typeof plan === "object" ? { ...plan } : {},
                  ...sharedRawJson,
                },
              });
              const tradeSid =
                Array.isArray(fanout?.sids) && fanout.sids[0]
                  ? fanout.sids[0]
                  : sessionId;
              savedTrades.push({ sid: tradeSid, symbol: planSymbol });
            }
            if (!savedTrades.length) {
              return {
                enabled: true,
                mode,
                saved: false,
                error: "No valid trade plan for draft",
              };
            }
            return {
              enabled: true,
              mode,
              saved: true,
              created: savedTrades.length,
              trades: savedTrades,
            };
          }
          const pick = picks[0];
          const plan = pick.plan || {};
          const tradePlanRawJson = { ...sharedRawJson };
          const action = normalizeDirectionToAction(plan?.direction);
          const sourceId = mt5SlugId(source, "tradingview");
          await mt5UpsertSourceV2({
            source_id: sourceId,
            name: source,
            kind: sourceId.includes("tv") ? "tv" : "api",
            auth_mode: "token",
            is_active: true,
            metadata: {
              migrated_from: "ai_analyze_auto_save",
              signal_source: source,
            },
          }).catch(() => null);
          const fanout = await mt5FanoutSignalTradeV2({
            signal_id: null,
            source_id: sourceId,
            user_id: userId,
            entry_model: String(plan?.entry_model || "").trim() || null,
            signal_tf: mt5TfToMinutes(body?.timeframe || body?.tf) || null,
            chart_tf: mt5TfToMinutes(body?.timeframe || body?.tf) || null,
            symbol,
            action,
            entry: pick.entry,
            sl: pick.sl,
            tp: pick.tp,
            volume: asNum(body?.volume ?? body?.lots, null),
            rr_planned: asNum(plan?.rr, null),
            risk_pct_planned: asNum(plan?.risk_pct, null),
            note: String(
              plan?.note || parsedJson?.final_verdict?.note || "",
            ).trim(),
            sid: sessionId,
            session_prefix: reqSessionPrefix || null,
            metadata: {
              event_type: "AI_ANALYZE_AUTO_SAVE_TRADE",
              order_type: mt5NormalizeOrderTypeValue(plan?.type, "limit"),
              session_prefix: reqSessionPrefix || null,
              analyze_session_id: sessionId,
              raw_json: tradePlanRawJson,
            },
          });
          // Move folder from files to active (trade is now PENDING, not draft)
          if (fanout?.created > 0) {
            moveTradeFolder(sessionId, "files", "active", symbol);
          }
          return {
            enabled: true,
            mode,
            saved: true,
            created: Number(fanout?.created || 0),
            account_ids: Array.isArray(fanout?.account_ids)
              ? fanout.account_ids
              : [],
          };
        } catch (error) {
          return {
            enabled: true,
            mode,
            saved: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      };
      ensureChartSnapshotDir();
      const userId = sess.user_id || CFG.mt5DefaultUserId;
      const sessionId = mt5GenerateTimeSid();
      await (
        await mt5Backend()
      ).log(sessionId, "ai", { event: "AI_ANALYSIS", payload: body }, userId);
      await (
        await mt5Backend()
      ).log(sessionId, "ai", analyzeReqSummary, userId);
      // Determine AI provider from request (default to claude for backward compat)
      const aiProviderRaw = String(body.ai_provider || "")
        .replace(/^ai_/i, "")
        .trim()
        .toLowerCase();
      const isClaudeProvider =
        !aiProviderRaw ||
        aiProviderRaw === "claude" ||
        aiProviderRaw === "anthropic";

      // Load all user API keys
      const userApiKeys = await loadUserApiKeysMap(userId).catch(() => ({}));

      // Resolve the required key based on provider
      let requiredKeyName = "CLAUDE_API_KEY";
      let requiredKeyValue = "";
      if (aiProviderRaw === "openrouter") {
        requiredKeyName = "OPENROUTER_API_KEY";
        requiredKeyValue = userApiKeys.OPENROUTER_API_KEY || "";
      } else if (aiProviderRaw === "openai" || aiProviderRaw === "gpt4o") {
        requiredKeyName = "OPENAI_API_KEY";
        requiredKeyValue = userApiKeys.OPENAI_API_KEY || "";
      } else if (aiProviderRaw === "deepseek") {
        requiredKeyName = "DEEPSEEK_API_KEY";
        requiredKeyValue = userApiKeys.DEEPSEEK_API_KEY || "";
      } else if (aiProviderRaw === "gemini") {
        requiredKeyName = "GEMINI_API_KEY";
        requiredKeyValue = userApiKeys.GEMINI_API_KEY || "";
      } else {
        // Claude / default
        requiredKeyValue = userApiKeys.CLAUDE_API_KEY || "";
      }

      if (!requiredKeyValue) {
        const providerLabel = requiredKeyName.replace(/_API_KEY$/, "");
        return json(res, 400, {
          ok: false,
          error: `${requiredKeyName} is missing. Please configure it in Settings → API_KEY.`,
        });
      }

      const claudeKey = isClaudeProvider ? requiredKeyValue : "";

      // Only Claude provider supports context-files mode
      let useContextFiles =
        isClaudeProvider &&
        (body.use_context_files === true ||
          String(body.context_mode || "").toLowerCase() === "claude");
      const contextSymbol =
        String(
          Array.isArray(body.symbols) && body.symbols.length
            ? body.symbols[0]
            : body.symbol || "",
        ).trim() ||
        (Array.isArray(body.files)
          ? body.files
              .map((f) => inferSymbolFromSnapshotFile(f))
              .find(Boolean) || ""
          : "") ||
        inferSymbolFromRecentSnapshots();
      // If symbol cannot be inferred, fall back to non-context analyze instead of hard-failing.
      if (useContextFiles && !contextSymbol) {
        useContextFiles = false;
      }
      if (useContextFiles) {
        let snapshotCaptureTriggered = false;
        let snapshotCaptureReason = "context_cache_hit";
        const symbol = contextSymbol;
        const timeframes = Array.isArray(body.timeframes)
          ? body.timeframes
          : String(body.tfs || body.timeframes || "D,4H,1H,15M").split(",");
        const contextBundle = await Promise.race([
          buildAiContextBundle({
            userId,
            apiKey: claudeKey,
            symbol,
            timeframes,
            bars:
              Number(
                body.bars_count ||
                  body.lookbackBars ||
                  body.lookback_bars ||
                  300,
              ) || 300,
            provider: String(body.provider || "ICMARKETS"),
            forceRefresh: body.force_refresh === true,
            forceSnapshot: body.snapshot_refresh === true,
            includeSnapshots: true,
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Context build timeout (60s)")),
              60000,
            ),
          ),
        ]);
        let finalPrompt =
          String(body.prompt || "").trim() ||
          "Analyze this chart context and return only JSON.";
        finalPrompt = buildTradesReviewPrompt(finalPrompt, tradesText);
        const manifest = {
          symbol: contextBundle.symbol,
          current_price: contextBundle.current_price,
          generated_at: contextBundle.generated_at,
          instruction:
            "Use the attached snapshot, bars, prior analysis, and tradeplans files. Reconcile prior analysis and explicitly flag invalid trade plans.",
          context_files: contextBundle.context_files,
          timeframe_summaries: (contextBundle.timeframes || []).map((x) => ({
            tf: x.tf,
            bar_end: x.bar_end,
            last_price: x.last_price,
            freshness: x.freshness,
            summary: x.summary,
          })),
        };
        finalPrompt += `\n\nCONTEXT_MANIFEST=${JSON.stringify(manifest)}\n\n${buildAiSchemaPromptText()}`;
        const content = [];
        const usedSnapshotFiles = [];
        for (const item of contextBundle.timeframes || []) {
          const filesForTf = item.files || {};
          if (filesForTf.snapshot?.file_id) {
            content.push({
              type: "image",
              source: { type: "file", file_id: filesForTf.snapshot.file_id },
            });
            if (filesForTf.snapshot?.local_snapshot_file) {
              usedSnapshotFiles.push(
                String(filesForTf.snapshot.local_snapshot_file),
              );
            }
          }
          for (const type of ["bars", "analysis", "tradeplans"]) {
            const block = makeAiContextTextBlock(
              filesForTf[type],
              `${item.tf} ${type}`,
            );
            if (block) content.push(block);
          }
        }
        if (!usedSnapshotFiles.length) {
          try {
            snapshotCaptureTriggered = true;
            snapshotCaptureReason = "context_auto_capture_fallback";
            const autoCreated = await captureTradingViewSnapshotsBatch({
              symbol: contextBundle.symbol,
              provider: String(body.provider || "ICMARKETS"),
              sessionPrefix: reqSessionPrefix || sanitizeSessionPrefix("auto"),
              tfs: (contextBundle.timeframes || [])
                .map((x) => toTradingViewInterval(x.tf))
                .filter(Boolean),
              lookbackBars:
                Number(
                  body.bars_count ||
                    body.lookbackBars ||
                    body.lookback_bars ||
                    300,
                ) || 300,
            });
            for (const created of autoCreated || []) {
              const fileName = String(created?.file_name || "").trim();
              if (!fileName) continue;
              const abs = path.join(CHART_SNAPSHOT_DIR, fileName);
              if (!fs.existsSync(abs)) continue;
              const mediaType = snapshotMimeByFileName(fileName);
              if (!mediaType) continue;
              content.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: fs.readFileSync(abs).toString("base64"),
                },
              });
              usedSnapshotFiles.push(fileName);
            }
          } catch (captureError) {
            console.warn(
              "[snapshot-analyze] context auto-capture fallback failed:",
              captureError?.message || captureError,
            );
          }
        }
        if (!usedSnapshotFiles.length) {
          return json(res, 400, {
            ok: false,
            error:
              "Snapshots are required for analysis, but no snapshot images were available.",
          });
        }
        appendAttachedImages(content, body?.attached_images);
        content.push({ type: "text", text: finalPrompt });
        const requestModel =
          String(body.model || "claude-sonnet-4-0").trim() ||
          "claude-sonnet-4-0";
        await (
          await mt5Backend()
        ).log(
          sessionId,
          "ai",
          {
            event: "AI_API_CALL_REQUEST",
            provider: "claude",
            mode: "context_files",
            model: requestModel,
            symbol: contextBundle.symbol,
            files_count: usedSnapshotFiles.length,
          },
          userId,
        );
        const out = await anthropicMessagesWithFallback({
          apiKey: claudeKey,
          model: requestModel,
          messages: [{ role: "user", content }],
          maxTokens: Number(body.max_tokens || 32000),
          timeoutMs: 180000,
          beta: ANTHROPIC_FILES_BETA,
        });
        const aiRes = out.response;
        const resolvedModel = out.modelUsed || requestModel;
        if (!aiRes.ok) {
          const errText = await aiRes.text();
          throw new Error(`Claude API Error (${aiRes.status}): ${errText}`);
        }
        await (
          await mt5Backend()
        ).log(
          sessionId,
          "ai",
          {
            event: "AI_API_CALL_RESPONSE",
            provider: "claude",
            mode: "context_files",
            model: resolvedModel,
            symbol: contextBundle.symbol,
            ok: true,
          },
          userId,
        );
        const aiJson = await aiRes.json();
        // Claude may split long JSON across multiple text blocks.
        // Joining with "" preserves JSON integrity (blocks are sequential fragments).
        const rawResponse = Array.isArray(aiJson?.content)
          ? aiJson.content
              .filter((x) => x?.type === "text")
              .map((x) => String(x?.text || ""))
              .join("")
          : String(aiJson?.content || "");
        const extracted = extractJsonFromAiText(rawResponse);
        let parsedJson =
          extracted.parsed && typeof extracted.parsed === "object"
            ? extracted.parsed
            : {};
        // AI returns [{trade_plan}]. Take first element as the plan.
        if (Array.isArray(parsedJson) && parsedJson.length > 0) {
          parsedJson = parsedJson[0];
        }
        // Log raw AI response
        console.log(
          "[ai-raw] len=" +
            rawResponse.length +
            " start=" +
            rawResponse.slice(0, 300),
        );
        console.log(
          "[ai-parsed] keys=" +
            (parsedJson && typeof parsedJson === "object"
              ? Object.keys(parsedJson).slice(0, 10).join(",")
              : "?"),
        );
        const autoSaveResult = await autoSaveAnalyzeResult({
          mode: autoSave,
          parsedJson,
          sourceSymbol: contextBundle.symbol,
          providerRaw: aiProviderRaw || "claude",
        });
        const usedSymbols = [
          ...new Set(
            usedSnapshotFiles
              .map((f) => normalizeSymbolLoose(inferSymbolFromSnapshotFile(f)))
              .filter(Boolean),
          ),
        ];
        const analysisFileUploads = [];
        try {
          const firstOk = (contextBundle.timeframes || []).find(
            (x) => x.status === "ok",
          );
          const analysisFileName = aiContextFileName({
            userId,
            symbol: contextBundle.symbol,
            tf: "ALL",
            barEnd: firstOk?.bar_end || nowUnixSec(),
            type: "analysis_result",
          });
          const analysisAbs = writeAiContextJsonFile(analysisFileName, {
            kind: "analysis_result",
            symbol: contextBundle.symbol,
            generated_at: new Date().toISOString(),
            timeframes: (contextBundle.timeframes || []).map((x) => ({
              tf: x.tf,
              bar_end: x.bar_end,
            })),
            analysis: parsedJson,
          });
          analysisFileUploads.push(
            await upsertClaudeContextFile({
              apiKey: claudeKey,
              contextKey: `${contextBundle.symbol}:ALL:${firstOk?.bar_end || "latest"}`,
              type: "analysis_result",
              absPath: analysisAbs,
              fileName: analysisFileName,
              symbol: contextBundle.symbol,
              tf: "ALL",
              barEnd: firstOk?.bar_end || nowUnixSec(),
            }),
          );
        } catch (e) {
          console.warn(
            "[snapshot-analyze] Failed to upload analysis result context file:",
            e?.message || e,
          );
        }
        await (
          await mt5Backend()
        ).log(
          sessionId,
          "ai",
          {
            event: "AI_RESPONSE",
            schema_version: AI_RESPONSE_SCHEMA_VERSION,
            raw_json: aiJson,
            context_files: contextBundle.context_files,
          },
          userId,
        );
        await (
          await mt5Backend()
        ).log(
          sessionId,
          "ai",
          {
            event: "AI_ANALYZE_RESPONSE",
            mode: "context_files",
            schema_version: AI_RESPONSE_SCHEMA_VERSION,
            model: resolvedModel,
            raw_response_hash: hashForLog(rawResponse),
            raw_response_len: String(rawResponse || "").length,
            raw_response: rawResponse,
            raw_response_preview: clipForLog(rawResponse, 6000),
            parsed_has_ai_full_analysis: Boolean(parsedJson?.ai_full_analysis),
            parsed_has_market_analysis: Boolean(parsedJson?.market_analysis),
            parsed_trade_plan_count: Array.isArray(parsedJson?.trade_plan)
              ? parsedJson.trade_plan.length
              : parsedJson?.trade_plan
                ? 1
                : 0,
            parsed_keys:
              parsedJson && typeof parsedJson === "object"
                ? Object.keys(parsedJson).slice(0, 50)
                : [],
          },
          userId,
        );
        return json(res, 200, {
          ok: true,
          model: resolvedModel,
          session_id: sessionId,
          schema_version: AI_RESPONSE_SCHEMA_VERSION,
          used_files: usedSnapshotFiles,
          used_symbols: usedSymbols,
          claude_files_mode: "context_files",
          claude_files: contextBundle.context_files,
          analysis_files: analysisFileUploads,
          context_bundle: contextBundle,
          raw_response: rawResponse,
          parsed_json: parsedJson,
          auto_save_result: autoSaveResult,
          snapshot_capture_triggered: snapshotCaptureTriggered,
          snapshot_capture_reason: snapshotCaptureReason,
          source: "claude_context_cache",
          updated_time: Date.now(),
          auto_refresh: 0,
        });
      }

      const normalizeTf = (value) => {
        const raw = String(value || "")
          .trim()
          .toUpperCase();
        if (!raw) return "";
        if (raw === "1D") return "D";
        if (raw === "1H") return "60";
        if (raw === "15") return "15";
        if (raw === "5") return "5";
        return raw;
      };
      const parseRequestedTimeframes = () => {
        if (Array.isArray(body.timeframes))
          return body.timeframes.map(normalizeTf).filter(Boolean);
        return String(
          body.tfs || body.timeframe || body.timeframes || "D,240,15,5",
        )
          .split(",")
          .map(normalizeTf)
          .filter(Boolean);
      };
      const normalizeSymbolLoose = (value) =>
        String(value || "")
          .trim()
          .toUpperCase()
          .replace(/^[A-Z0-9_-]+:/, "")
          .replace(/[^A-Z0-9]/g, "");
      const requestedSymbols = (
        Array.isArray(body.symbols) && body.symbols.length
          ? body.symbols
          : [body.symbol]
      )
        .map((x) => normalizeSymbolLoose(x))
        .filter(Boolean)
        .slice(0, 12);
      const requestedTfs = parseRequestedTimeframes();
      const requestedSymbol = requestedSymbols[0] || "";
      const requestedProvider = String(body.provider || "ICMARKETS")
        .trim()
        .toUpperCase();
      // Copy snapshots to trade folder (sessionId will become trade SID)
      copySnapshotsToTradeSidFolder(
        sessionId,
        listLatestSnapshotFilesForSymbol(requestedSymbol, 20),
        requestedSymbol,
      );
      const pickSnapshotFiles = (items) => {
        if (!items.length) return [];
        const maxFiles = Math.max(
          4,
          Math.min(
            24,
            Math.max(1, requestedSymbols.length) *
              Math.max(1, requestedTfs.length || 4),
          ),
        );
        if (!requestedTfs.length)
          return items.slice(0, maxFiles).map((x) => x.f);
        const out = [];
        const candidateSymbols = requestedSymbols.length
          ? requestedSymbols
          : Array.from(
              new Set(
                items
                  .map((x) =>
                    normalizeSymbolLoose(inferSymbolFromSnapshotFile(x.f)),
                  )
                  .filter(Boolean),
              ),
            );
        for (const sym of candidateSymbols) {
          const byTf = new Map();
          for (const item of items) {
            const f = String(item.f || "");
            const inferred = normalizeSymbolLoose(
              inferSymbolFromSnapshotFile(f),
            );
            if (sym && inferred && sym !== inferred) continue;

            // Handle MASTER file as matching everything
            if (f.toUpperCase().includes("_MASTER.")) {
              out.push(f);
              continue;
            }

            const parts = f.split("_");
            const tfRaw = parts.length >= 3 ? parts[2] : "";
            const tf = normalizeTf(tfRaw);
            if (!tf || byTf.has(tf)) continue;
            byTf.set(tf, f);
          }
          for (const tf of requestedTfs) {
            const f = byTf.get(tf);
            if (f) out.push(f);
          }
        }
        if (out.length) return out.slice(0, maxFiles);
        return items.slice(0, maxFiles).map((x) => x.f);
      };
      let files = Array.isArray(body.files)
        ? body.files.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      let snapshotCaptureTriggered = false;
      let snapshotCaptureReason = files.length
        ? "request_files"
        : "latest_snapshot_files";
      if (!files.length) {
        const allSnapshots = [];
        // Scan top-level snapshots/ and per-symbol subdirectory
        const scanDir = (dir) => {
          if (!fs.existsSync(dir)) return;
          for (const f of fs.readdirSync(dir)) {
            if (!/\.(png|jpg|jpeg)$/i.test(f)) continue;
            const st = fs.statSync(path.join(dir, f));
            if (st.isFile())
              allSnapshots.push({ f, t: Number(st.mtimeMs || 0) });
          }
        };
        scanDir(CHART_SNAPSHOT_DIR);
        if (requestedSymbol) scanDir(snapshotSymbolDir(requestedSymbol));
        allSnapshots.sort((a, b) => b.t - a.t);
        const sessionMatched = reqSessionPrefix
          ? allSnapshots.filter((x) => x.f.includes(`_${reqSessionPrefix}_`))
          : [];
        const symbolMatched = allSnapshots.filter((x) => {
          const parts = String(x.f || "").split("_");
          if (parts.length < 3) return false;
          const providerOk =
            String(parts[0] || "").toUpperCase() === requestedProvider;
          const symbolOk =
            normalizeSymbolLoose(parts[1] || "") === requestedSymbol;
          return providerOk && symbolOk;
        });
        const symbolMatchedAnyProvider = allSnapshots.filter((x) => {
          const parts = String(x.f || "").split("_");
          if (parts.length < 3) return false;
          return normalizeSymbolLoose(parts[1] || "") === requestedSymbol;
        });
        const pool = sessionMatched.length
          ? sessionMatched
          : symbolMatched.length
            ? symbolMatched
            : symbolMatchedAnyProvider.length
              ? symbolMatchedAnyProvider
              : allSnapshots;
        files = pickSnapshotFiles(pool);
      }
      if (!files.length && requestedSymbols.length) {
        try {
          snapshotCaptureTriggered = true;
          snapshotCaptureReason = "snapshot_auto_capture_fallback";
          const created = await captureTradingViewSnapshotsBatch({
            symbols: requestedSymbols,
            provider: requestedProvider,
            sessionPrefix: reqSessionPrefix || sanitizeSessionPrefix("auto"),
            tfs: requestedTfs.length ? requestedTfs : ["D", "240", "15", "5"],
            lookbackBars:
              Number(
                body.bars_count ||
                  body.lookbackBars ||
                  body.lookback_bars ||
                  300,
              ) || 300,
          });
          files = Array.isArray(created)
            ? created
                .map((x) => String(x.file_name || ""))
                .filter(Boolean)
                .slice(
                  0,
                  Math.max(
                    4,
                    Math.min(
                      24,
                      Math.max(1, requestedSymbols.length) *
                        Math.max(1, requestedTfs.length || 4),
                    ),
                  ),
                )
            : [];
        } catch (captureError) {
          console.warn(
            "[snapshot-analyze] auto-capture fallback failed:",
            captureError?.message || captureError,
          );
        }
      }
      files = files.slice(
        0,
        Math.max(
          4,
          Math.min(
            24,
            Math.max(1, requestedSymbols.length || 1) *
              Math.max(1, requestedTfs.length || 4),
          ),
        ),
      );
      if (!files.length) {
        console.warn("[snapshot-analyze] No snapshots found for analysis.");
        return json(res, 200, {
          ok: false,
          error: "No snapshots found for analysis.",
        });
      }

      const snapshotFiles = [];
      for (const fileNameRaw of files) {
        const safeName = path.basename(String(fileNameRaw || ""));
        if (
          !safeName ||
          safeName !== fileNameRaw ||
          !/\.(png|jpg|jpeg)$/i.test(safeName)
        )
          continue;
        // Check both top-level snapshots/ and snapshots/{SYMBOL}/ subdirectory
        let abs = path.join(CHART_SNAPSHOT_DIR, safeName);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          // Try per-symbol subdirectory: snapshots/{SYMBOL}/file.jpg
          const sym = normalizeSymbolLoose(
            inferSymbolFromSnapshotFile(safeName),
          );
          if (sym) {
            const symDir = snapshotSymbolDir(sym);
            const symAbs = path.join(symDir, safeName);
            if (fs.existsSync(symAbs) && fs.statSync(symAbs).isFile()) {
              abs = symAbs;
            } else {
              continue;
            }
          } else {
            continue;
          }
        }
        const mediaType = snapshotMimeByFileName(safeName);
        if (!mediaType) continue;
        snapshotFiles.push({ fileName: safeName, abs, mediaType });
      }
      if (!snapshotFiles.length) {
        console.warn(
          "[snapshot-analyze] No valid snapshot images available. Input files:",
          files,
        );
        return json(res, 200, {
          ok: false,
          error: "No valid snapshot images available.",
        });
      }
      const usedSymbols = [
        ...new Set(
          snapshotFiles
            .map((x) =>
              normalizeSymbolLoose(inferSymbolFromSnapshotFile(x.fileName)),
            )
            .filter(Boolean),
        ),
      ];
      const symbolFileMap = requestedSymbols.map((sym) => ({
        symbol: sym,
        files: snapshotFiles
          .map((x) => x.fileName)
          .filter(
            (f) => normalizeSymbolLoose(inferSymbolFromSnapshotFile(f)) === sym,
          ),
      }));

      let finalPrompt =
        String(body.prompt || "").trim() ||
        (DEFAULT_AI_SYSTEM_PROMPT && DEFAULT_AI_STRATEGIES
          ? buildDefaultRichPrompt(
              requestedSymbol,
              requestedTfs || ["D", "4H", "15m", "5m"],
            )
          : DEFAULT_AI_SYSTEM_PROMPT) ||
        "Analyze these chart snapshots and return only JSON.";
      finalPrompt = buildTradesReviewPrompt(finalPrompt, tradesText);
      finalPrompt += `\n\nMULTI_SYMBOL_INPUT=${JSON.stringify({
        requested_symbols: requestedSymbols,
        symbol_files: symbolFileMap,
        instruction:
          "Analyze EACH requested symbol using only its mapped files. Return at least 1 trade_plan item per requested symbol. If no valid setup for a symbol, return trade_decision='Skip' for that symbol with skip_reasons.",
      })}`;

      // For text-only models (DeepSeek), inject bar data as text since they can't see images
      const requestModel =
        String(body.model || "claude-sonnet-4-0").trim() || "claude-sonnet-4-0";
      if (requestModel.toLowerCase().includes("deepseek")) {
        try {
          const symbol = String(body.symbol || "").trim();
          if (symbol) {
            const symbolNorm = normalizeMarketDataSymbol(symbol);
            const commonTfs = ["1", "5", "15", "60", "240", "1440", "1w"];
            const rows = [];
            for (const tfRaw of commonTfs) {
              const tfNorm = normalizeMarketDataTf(tfRaw);
              const bars = readBrokerBarsFromCsv(symbolNorm, tfNorm, 300);
              if (bars.length) {
                const lastBar = bars[bars.length - 1];
                rows.push({
                  tf: tfNorm,
                  bar_count: bars.length,
                  last_price: lastBar.close,
                });
              }
            }
            if (rows.length) {
              const barLines = rows.map(
                (r) =>
                  `${r.tf}: ${r.bar_count} bars, latest close=${r.last_price}`,
              );
              finalPrompt += `\n\n## MARKET DATA (text-only model — chart images not visible)\nSymbol: ${symbol}\n${barLines.join("\n")}`;
            }
          }
        } catch (e) {
          console.warn("[deepseek] Failed to load bar data:", e.message);
        }
      }

      finalPrompt += `\n\n${buildAiSchemaPromptText()}`;

      let imagePayload = null;
      let claudeFilesMode = "base64";
      let claudeFilesError = "";
      // Only use Claude Files API when Claude provider is selected and key is available
      if (UPLOAD_TO_CLAUDE && isClaudeProvider && claudeKey) {
        try {
          imagePayload = await buildClaudeFileSnapshotContent({
            apiKey: claudeKey,
            snapshotFiles,
          });
          claudeFilesMode = "files_api";
        } catch (error) {
          claudeFilesError =
            error instanceof Error ? error.message : String(error);
          imagePayload = buildBase64SnapshotContent(snapshotFiles);
          claudeFilesMode = "fallback_base64";
        }
      } else {
        imagePayload = buildBase64SnapshotContent(snapshotFiles);
      }

      const content = [...imagePayload.content];
      appendAttachedImages(content, body?.attached_images);
      content.push({
        type: "text",
        text: finalPrompt,
      });

      // Use the ai_provider resolved earlier for callAiProvider
      await (
        await mt5Backend()
      ).log(
        sessionId,
        "ai",
        {
          event: "AI_API_CALL_REQUEST",
          provider: aiProviderRaw || "claude",
          mode: "snapshot_files",
          model: requestModel,
          symbol: requestedSymbol,
          files_count: snapshotFiles.length,
        },
        userId,
      );
      // Save analyze payload to trade_files/trade-{sid}/logs/payload.json
      try {
        const payloadLog = {
          timestamp: new Date().toISOString(),
          session_id: sessionId,
          model: requestModel,
          provider: aiProviderRaw || "claude",
          symbol: requestedSymbol,
          symbols: requestedSymbols,
          timeframe: body.timeframe || "",
          timeframes: requestedTfs || [],
          prompt_len: finalPrompt.length,
          prompt: finalPrompt,
          settings: {
            auto_save: autoSave,
            profile: body.profile || "",
            directions: body.directions || [],
            model: body.model || "",
          },
          files_count: snapshotFiles.length,
          files: snapshotFiles.map((f) => f.fileName || f),
        };
        const logsDir = tradeLogsDir(sessionId, requestedSymbol);
        fs.writeFileSync(
          path.join(logsDir, "payload.json"),
          JSON.stringify(payloadLog, null, 2),
        );
      } catch (_) {}

      const aiResult = await callAiProvider({
        model: requestModel,
        provider: aiProviderRaw || "",
        messages: [{ role: "user", content }],
        maxTokens: Number(body.max_tokens || 32000),
        timeoutMs: 180000,
        apiKey: requiredKeyValue,
        userId,
      });

      const rawResponse = aiResult.rawText;
      const resolvedModel = aiResult.modelUsed;
      await (
        await mt5Backend()
      ).log(
        sessionId,
        "ai",
        {
          event: "AI_API_CALL_RESPONSE",
          provider: aiResult.provider || aiProviderRaw || "claude",
          mode: "snapshot_files",
          model: resolvedModel,
          symbol: requestedSymbol,
          ok: true,
        },
        userId,
      );
      claudeFilesMode =
        aiResult.provider === "claude"
          ? claudeFilesMode || "base64"
          : aiResult.provider;
      const extracted = extractJsonFromAiText(rawResponse);
      let parsedJson =
        extracted.parsed && typeof extracted.parsed === "object"
          ? extracted.parsed
          : {};
      // AI returns [{trade_plan}]. Take first element as the plan.
      if (Array.isArray(parsedJson) && parsedJson.length > 0) {
        parsedJson = parsedJson[0];
      }
      // Save AI response to trade_files/trade-{sid}/logs/response.json
      try {
        const responseLog = {
          timestamp: new Date().toISOString(),
          session_id: sessionId,
          model: resolvedModel || requestModel,
          provider: aiResult.provider || aiProviderRaw || "claude",
          raw_response: rawResponse,
          parsed_json: parsedJson,
        };
        const logsDir = tradeLogsDir(sessionId, requestedSymbol);
        fs.writeFileSync(
          path.join(logsDir, "response.json"),
          JSON.stringify(responseLog, null, 2),
        );
        // Also save clean AI JSON directly — no parsing needed on read
        if (
          parsedJson &&
          typeof parsedJson === "object" &&
          Object.keys(parsedJson).length > 0
        ) {
          fs.writeFileSync(
            path.join(logsDir, "ai_response.json"),
            JSON.stringify(parsedJson, null, 2),
          );
        }
      } catch (_) {}

      // Log raw AI response (snapshot_files mode)
      console.log(
        "[ai-raw] len=" +
          rawResponse.length +
          " start=" +
          rawResponse.slice(0, 300),
      );
      console.log(
        "[ai-parsed] keys=" +
          (parsedJson && typeof parsedJson === "object"
            ? Object.keys(parsedJson).slice(0, 10).join(",")
            : "?"),
      );
      const autoSaveResult = await autoSaveAnalyzeResult({
        mode: autoSave,
        parsedJson,
        sourceSymbol: requestedSymbol,
        providerRaw: aiResult.provider || aiProviderRaw || "claude",
      });

      // Persistence: If we have analysis and bars context, store in market_data metadata
      // Persistence: If we have analysis and bars context, store in Unified Cache and DB
      if (
        (parsedJson.bias ||
          parsedJson.analysis ||
          parsedJson.market_analysis ||
          parsedJson.trade_plan ||
          parsedJson.final_verdict) &&
        body.bars &&
        body.bars.length > 0
      ) {
        try {
          const bars = body.bars;
          const symbolNorm = normalizeMarketDataSymbol(body.symbol);
          const tfNorm = normalizeMarketDataTf(body.timeframe);

          // Update Unified Cache (Read-Modify-Write)
          await repoUpsertUnifiedMarketData(symbolNorm, tfNorm, {
            bars: bars,
            market_analysis: parsedJson,
          }).catch((e) =>
            console.error(
              "[snapshot-analyze] Unified Cache Update Failed:",
              e.message,
            ),
          );

          // Legacy DB persistence
          const barStart = Number(bars[0].time || bars[0].bar_start);
          const barEnd = Number(
            bars[bars.length - 1].time || bars[bars.length - 1].bar_end,
          );
          if (barStart && barEnd) {
            await marketDataFileWrite(symbolNorm, tfNorm, {
              bar_start: barStart,
              bar_end: barEnd,
              bars: bars,
              metadata: parsedJson,
            }).catch((e) =>
              console.error("[snapshot-analyze] File Write Failed:", e.message),
            );
          }
        } catch (e) {
          console.warn(
            "[snapshot-analyze] Failed to persist metadata:",
            e.message,
          );
        }
      }

      await (
        await mt5Backend()
      ).log(
        sessionId,
        "ai",
        {
          event: "AI_RESPONSE",
          schema_version: AI_RESPONSE_SCHEMA_VERSION,
          raw_json: parsedJson,
        },
        userId,
      );
      await (
        await mt5Backend()
      ).log(
        sessionId,
        "ai",
        {
          event: "AI_ANALYZE_RESPONSE",
          mode: "snapshot_files",
          schema_version: AI_RESPONSE_SCHEMA_VERSION,
          model: resolvedModel,
          raw_response_hash: hashForLog(rawResponse),
          raw_response_len: String(rawResponse || "").length,
          raw_response: rawResponse,
          raw_response_preview: clipForLog(rawResponse, 6000),
          parsed_has_ai_full_analysis: Boolean(parsedJson?.ai_full_analysis),
          parsed_has_market_analysis: Boolean(parsedJson?.market_analysis),
          parsed_trade_plan_count: Array.isArray(parsedJson?.trade_plan)
            ? parsedJson.trade_plan.length
            : parsedJson?.trade_plan
              ? 1
              : 0,
          parsed_keys:
            parsedJson && typeof parsedJson === "object"
              ? Object.keys(parsedJson).slice(0, 50)
              : [],
        },
        userId,
      );
      return json(res, 200, {
        ok: true,
        model: resolvedModel,
        session_id: sessionId,
        schema_version: AI_RESPONSE_SCHEMA_VERSION,
        used_files:
          imagePayload.usedFiles || snapshotFiles.map((x) => x.fileName),
        used_symbols: usedSymbols,
        claude_files_mode: claudeFilesMode,
        claude_files: imagePayload.claudeFiles || [],
        claude_files_error: claudeFilesError,
        raw_response: rawResponse,
        parsed_json: parsedJson,
        auto_save_result: autoSaveResult,
        snapshot_capture_triggered: snapshotCaptureTriggered,
        snapshot_capture_reason: snapshotCaptureReason,
        source: "remote_api",
        updated_time: Date.now(),
        auto_refresh: 0,
        trade_sid: sessionId,
      });
    } catch (error) {
      try {
        const userId = sess.user_id || CFG.mt5DefaultUserId;
        await (
          await mt5Backend()
        ).log(
          `ai_analyze_error_${Date.now()}`,
          "ai",
          {
            event: "AI_ANALYZE_ERROR",
            schema_version: AI_RESPONSE_SCHEMA_VERSION,
            error: String(error?.message || error),
            stack_preview: clipForLog(error?.stack || "", 3000),
          },
          userId,
        );
      } catch {}
      if (
        error?.name === "AbortError" ||
        String(error?.message || "")
          .toLowerCase()
          .includes("aborted")
      ) {
        return json(res, 504, {
          ok: false,
          error:
            "AI provider timeout while analyzing snapshots. Try fewer charts or a shorter prompt.",
        });
      }
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/ai/claude/files") {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const userId = sess.user_id || CFG.mt5DefaultUserId;
      const claudeKey = await loadClaudeApiKeyForUser(userId);
      if (!claudeKey)
        return json(res, 400, {
          ok: false,
          error: "CLAUDE_API_KEY is missing in Settings.",
        });
      const limit = Math.max(
        1,
        Math.min(Number(url.searchParams.get("limit") || 100) || 100, 200),
      );
      const afterId = String(url.searchParams.get("after_id") || "").trim();
      const qs = new URLSearchParams({ limit: String(limit) });
      if (afterId) qs.set("after_id", afterId);
      const out = await anthropicFilesRequest({
        apiKey: claudeKey,
        pathName: `/v1/files?${qs.toString()}`,
      });
      return json(res, 200, {
        ok: true,
        ...out,
        local_map: readClaudeLocalFileMap(),
      });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "GET" &&
    url.pathname.startsWith("/v2/ai/claude/files/") &&
    url.pathname.endsWith("/content")
  ) {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const userId = sess.user_id || CFG.mt5DefaultUserId;
      const claudeKey = await loadClaudeApiKeyForUser(userId);
      if (!claudeKey)
        return json(res, 400, {
          ok: false,
          error: "CLAUDE_API_KEY is missing in Settings.",
        });
      const rawId = decodeURIComponent(
        url.pathname
          .replace("/v2/ai/claude/files/", "")
          .replace(/\/content$/, "") || "",
      ).trim();
      if (!rawId || rawId.includes("/") || rawId.includes("\\"))
        return json(res, 400, { ok: false, error: "Invalid Claude file id." });
      const meta = await anthropicFilesRequest({
        apiKey: claudeKey,
        pathName: `/v1/files/${encodeURIComponent(rawId)}`,
        timeoutMs: 30000,
      }).catch(() => ({}));
      let out = null;
      let contentError = null;
      try {
        out = await anthropicFilesRawRequest({
          apiKey: claudeKey,
          pathName: `/v1/files/${encodeURIComponent(rawId)}/content`,
          timeoutMs: 60000,
        });
      } catch (error) {
        contentError = error;
      }
      const local = contentError ? findClaudeLocalFileById(rawId) : null;
      if (contentError && !local) throw contentError;
      const fileName =
        String(meta?.filename || `${rawId}.bin`)
          .replace(/[^\w.\- ()[\]]+/g, "_")
          .slice(0, 180) || `${rawId}.bin`;
      const dispositionMode =
        url.searchParams.get("download") === "1" ? "attachment" : "inline";
      const body = local ? fs.readFileSync(local.vps_path) : out.buffer;
      const contentType = String(
        local?.mime_type ||
          meta?.mime_type ||
          out?.contentType ||
          "application/octet-stream",
      );
      const finalFileName =
        String(local?.vps_file || fileName)
          .replace(/[^\w.\- ()[\]]+/g, "_")
          .slice(0, 180) || fileName;
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Disposition": `${dispositionMode}; filename="${finalFileName}"`,
        "Cache-Control": "no-store",
        "Content-Length": body.length,
        "X-Claude-Content-Source": local
          ? "v2026.05.09 19:31 - 728f356"
          : "claude",
      });
      res.end(body);
      return;
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/v2/ai/claude/files/")) {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const userId = sess.user_id || CFG.mt5DefaultUserId;
      const claudeKey = await loadClaudeApiKeyForUser(userId);
      if (!claudeKey)
        return json(res, 400, {
          ok: false,
          error: "CLAUDE_API_KEY is missing in Settings.",
        });
      const fileId = decodeURIComponent(
        url.pathname.replace("/v2/ai/claude/files/", "") || "",
      ).trim();
      if (!fileId || fileId.includes("/") || fileId.includes("\\"))
        return json(res, 400, { ok: false, error: "Invalid Claude file id." });
      const out = await anthropicFilesRequest({
        apiKey: claudeKey,
        pathName: `/v1/files/${encodeURIComponent(fileId)}`,
        timeoutMs: 30000,
      });
      return json(res, 200, { ok: true, file: out });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "POST" &&
    url.pathname === "/v2/ai/claude/files/upload-snapshots"
  ) {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      ensureChartSnapshotDir();
      const body = await readJson(req);
      const userId = sess.user_id || CFG.mt5DefaultUserId;
      const claudeKey = await loadClaudeApiKeyForUser(userId);
      if (!claudeKey)
        return json(res, 400, {
          ok: false,
          error: "CLAUDE_API_KEY is missing in Settings.",
        });
      const reqSessionPrefix = sanitizeSessionPrefix(
        body?.session_prefix || body?.sessionPrefix || "",
      );
      let files = Array.isArray(body?.files)
        ? body.files.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      if (!files.length) {
        files = fs
          .readdirSync(CHART_SNAPSHOT_DIR)
          .filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
          .filter(
            (f) => !reqSessionPrefix || f.includes(`_${reqSessionPrefix}_`),
          )
          .slice(0, 20);
      }
      const uploaded = [];
      const failed = [];
      for (const fileNameRaw of files) {
        const safeName = normalizeSnapshotFileName(fileNameRaw);
        if (!safeName) {
          failed.push({
            file: fileNameRaw,
            error: "Invalid snapshot file name.",
          });
          continue;
        }
        const abs = path.join(CHART_SNAPSHOT_DIR, safeName);
        const mediaType = snapshotMimeByFileName(safeName);
        if (!mediaType || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          failed.push({ file: safeName, error: "Snapshot file not found." });
          continue;
        }
        try {
          uploaded.push(
            await uploadSnapshotToClaudeFile({
              apiKey: claudeKey,
              fileName: safeName,
              absPath: abs,
              mediaType,
            }),
          );
        } catch (error) {
          failed.push({
            file: safeName,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      for (const u of uploaded) {
        try {
          const fname = String(u?.filename || u?.local_file || "");
          const parts = fname.split("_");
          if (parts.length >= 2) {
            const sym = parts[0]?.toUpperCase?.() || "";
            const tf = parts[1]?.toLowerCase?.() || "";
            if (sym && tf && u?.id) {
              tfCacheSet(sym, tf, {
                snapshot: {
                  file_id: String(u.id),
                  file_name: fname,
                  uploaded_at: new Date().toISOString(),
                },
              });
            }
          }
        } catch (_) {}
      }
      return json(res, 200, {
        ok: true,
        uploaded_count: uploaded.length,
        failed_count: failed.length,
        uploaded,
        failed,
      });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    (req.method === "DELETE" &&
      url.pathname.startsWith("/v2/ai/claude/files/")) ||
    (req.method === "POST" && url.pathname === "/v2/ai/claude/files/delete")
  ) {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const userId = sess.user_id || CFG.mt5DefaultUserId;
      const claudeKey = await loadClaudeApiKeyForUser(userId);
      if (!claudeKey)
        return json(res, 400, {
          ok: false,
          error: "CLAUDE_API_KEY is missing in Settings.",
        });
      let fileIds = [];
      if (req.method === "DELETE") {
        const fileId = decodeURIComponent(
          url.pathname.replace("/v2/ai/claude/files/", "") || "",
        ).trim();
        if (fileId) fileIds.push(fileId);
      } else {
        const body = await readJson(req);
        fileIds = Array.isArray(body?.file_ids)
          ? body.file_ids.map((x) => String(x || "").trim()).filter(Boolean)
          : [];
        const localFiles = Array.isArray(body?.files)
          ? body.files.map((x) => String(x || "").trim()).filter(Boolean)
          : [];
        if (localFiles.length) {
          const map = readClaudeSnapshotFileMap();
          for (const localFile of localFiles) {
            const safe = normalizeSnapshotFileName(localFile);
            const fileId = safe ? String(map[safe]?.file_id || "") : "";
            if (fileId) fileIds.push(fileId);
          }
        }
      }
      fileIds = [...new Set(fileIds)];
      if (!fileIds.length)
        return json(res, 400, {
          ok: false,
          error: "No Claude file ids provided.",
        });
      const deleted = [];
      const failed = [];
      for (const fileId of fileIds) {
        try {
          const out = await anthropicFilesRequest({
            apiKey: claudeKey,
            method: "DELETE",
            pathName: `/v1/files/${encodeURIComponent(fileId)}`,
            timeoutMs: 30000,
          });
          deleted.push({ file_id: fileId, result: out });
        } catch (error) {
          failed.push({
            file_id: fileId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      // Clean both snapshot and context file maps
      const snapMap = readClaudeSnapshotFileMap();
      const ctxMap = readClaudeContextFileMap();
      let mapChanged = false;
      for (const [localFile, item] of Object.entries(snapMap)) {
        if (fileIds.includes(String(item?.file_id || ""))) {
          delete snapMap[localFile];
          mapChanged = true;
          // Also delete local file from disk
          const abs = path.join(
            CHART_SNAPSHOT_DIR,
            path.basename(String(item?.vps_file || localFile)),
          );
          try {
            if (fs.existsSync(abs)) fs.unlinkSync(abs);
          } catch {}
        }
      }
      for (const [key, item] of Object.entries(ctxMap)) {
        if (fileIds.includes(String(item?.file_id || ""))) {
          delete ctxMap[key];
          mapChanged = true;
          // Also delete local context file from disk
          const abs = String(item?.vps_path || "").trim();
          try {
            if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
          } catch {}
        }
      }
      if (mapChanged) {
        writeClaudeSnapshotFileMap(snapMap);
        writeClaudeContextFileMap(ctxMap);
      }
      bustClaudeFilesCache();
      return json(res, 200, {
        ok: true,
        deleted_count: deleted.length,
        failed_count: failed.length,
        deleted,
        failed,
      });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/chart/snapshots") {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      ensureChartSnapshotDir();
      const limit = Math.max(
        1,
        Math.min(Number(url.searchParams.get("limit") || 30) || 30, 200),
      );
      const reqSessionPrefix = sanitizeSessionPrefix(
        url.searchParams.get("session_prefix") || "",
      );
      const reqSymbol = String(url.searchParams.get("symbol") || "")
        .trim()
        .toUpperCase();

      // Scan top-level snapshots/ and per-symbol subdirectories
      const allFiles = [];
      const scanDir = (dir, symbolFromDir = "") => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!e.isFile() || !/\.(png|jpe?g)$/i.test(e.name)) continue;
          if (reqSessionPrefix && !e.name.includes(`_${reqSessionPrefix}_`))
            continue;
          const sym =
            symbolFromDir || inferSymbolFromSnapshotFile(e.name) || "";
          if (reqSymbol && sym !== reqSymbol) continue;
          const full = path.join(dir, e.name);
          const st = fs.statSync(full);
          allFiles.push({
            id: e.name.replace(/\.[^.]+$/i, ""),
            file_name: e.name,
            symbol: sym,
            created_at: new Date(st.mtimeMs || Date.now()).toISOString(),
            size_bytes: Number(st.size || 0),
            mime_type: fileMimeByName(e.name),
            url: sym
              ? `/v2/chart/snapshots/${encodeURIComponent(sym)}/${encodeURIComponent(e.name)}`
              : `/v2/chart/snapshots/${encodeURIComponent(e.name)}`,
          });
        }
      };
      // Scan top-level
      scanDir(CHART_SNAPSHOT_DIR);
      // Scan per-symbol subdirectories
      if (fs.existsSync(CHART_SNAPSHOT_DIR)) {
        for (const sub of fs.readdirSync(CHART_SNAPSHOT_DIR, {
          withFileTypes: true,
        })) {
          if (sub.isDirectory()) {
            const sym = inferSymbolFromSnapshotFile(sub.name) || sub.name;
            scanDir(path.join(CHART_SNAPSHOT_DIR, sub.name), sym);
          }
        }
      }

      const sorted = allFiles
        .sort((a, b) =>
          String(b.created_at).localeCompare(String(a.created_at)),
        )
        .slice(0, limit);
      return json(res, 200, { ok: true, items: sorted });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/notifications/emit") {
    // Internal endpoint for other processes/services to push SSE events
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const payload = await readJson(req);
      if (!payload.event)
        return json(res, 400, { ok: false, error: "event is required" });
      notificationManager.handle("REMOTE_API_CALL", payload.event, {
        user_id: payload.user_id || null,
        page: payload.page || null,
        event: payload.event,
        message: payload.message || "",
        type: payload.type || "info",
        notification: payload.notification !== false,
        need_refresh: payload.need_refresh || false,
        comp_refresh: payload.comp_refresh || false,
        action: payload.action || null,
        sound: payload.sound || null,
        position: payload.position || "bottom-right",
      });
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/notifications/test") {
    if (!requireAuthForUi(req, res)) return;
    try {
      const sess = getUiSessionFromReq(req);
      const payload = await readJson(req).catch(() => ({}));
      // If UI sent settings (from test button), use them as override - no force flags
      const testSettings = payload.settings
        ? {
            toast: payload.settings.toast !== false,
            console_log: payload.settings.console_log === true,
            ticker: payload.settings.ticker === true,
            db_log: payload.settings.db_log !== false,
            sound: payload.settings.sound || null,
          }
        : null;

      const nPayload = {
        user_id: sess.user_id,
        page: payload.page || null,
        event: payload.event || "system_event",
        message:
          payload.message || "🧪 Test notification — all channels firing",
        type: payload.type || "info",
        need_refresh: payload.need_refresh || false,
        comp_refresh: payload.comp_refresh || false,
        action: payload.action || null,
        position: payload.position || "bottom-right",
      };

      // Only force all when no per-event settings provided
      if (!testSettings) {
        nPayload._force_toast = true;
        nPayload._force_ticker = true;
        nPayload._force_sound = true;
        nPayload._force_db_log = true;
        nPayload.sound = payload.sound || null;
        nPayload.notification = payload.notification !== false;
      }

      notificationManager.handle(
        "SYSTEM_EVENT",
        payload.event || "system_event",
        nPayload,
        testSettings,
      );
      return json(res, 200, {
        ok: true,
        sent: {
          event: payload.event || "system_event",
          message:
            payload.message || "🧪 Test notification — all channels firing",
        },
      });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/notifications/events") {
    if (!requireAuthForUi(req, res)) return;
    try {
      const notificationsManager = global.__notificationManager;
      // Return all event types with merged settings (defaults + DB overrides)
      const events = Object.entries(DEFAULT_NOTIFICATION_SETTINGS).map(
        ([event, defaults]) => {
          const dbSettings =
            notificationsManager?.settingsCache?.get(event) || {};
          return {
            event,
            label: event
              .replace(/_/g, " ")
              .replace(/\w/g, (c) => c.toUpperCase()),
            toast:
              dbSettings.toast !== undefined
                ? dbSettings.toast
                : defaults.toast,
            console_log:
              dbSettings.console_log !== undefined
                ? dbSettings.console_log
                : defaults.console_log || false,
            ticker:
              dbSettings.ticker !== undefined
                ? dbSettings.ticker
                : defaults.ticker,
            sound:
              dbSettings.sound !== undefined
                ? dbSettings.sound
                : defaults.sound || null,
            db_log:
              dbSettings.db_log !== undefined
                ? dbSettings.db_log
                : defaults.db_log,
            hub:
              dbSettings.hub !== undefined
                ? dbSettings.hub
                : defaults.hub !== false,
          };
        },
      );
      return json(res, 200, { ok: true, events });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/notifications/settings") {
    if (!requireAuthForUi(req, res)) return;
    try {
      const sess = getUiSessionFromReq(req);
      const db = await mt5InitBackend();
      let data = {};
      const setting = await dbQueries.getUserSetting(
        db.db,
        sess.user_id,
        "notification_config",
        "preferences",
      );
      if (setting?.data && typeof setting.data === "object")
        data = setting.data;
      return json(res, 200, { ok: true, settings: data });
    } catch (e) {
      return json(res, 200, { ok: true, settings: {} });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/notifications/settings") {
    if (!requireAuthForUi(req, res)) return;
    try {
      const payload = await readJson(req);
      const sess = getUiSessionFromReq(req);
      const settings = payload.settings || payload;
      const db = await mt5InitBackend();
      // Save each event type as a separate notification_config row
      for (const [eventName, config] of Object.entries(settings)) {
        const eventKey = String(eventName)
          .toUpperCase()
          .replace(/[^A-Z_]/g, "");
        if (!eventKey) continue;
        await dbQueries.upsertUserSetting(
          db.db,
          sess.user_id,
          "notification_config",
          eventKey,
          config,
          "ACTIVE",
        );
      }
      // Reload NotificationManager cache
      if (global.__notificationManager) {
        await global.__notificationManager.reloadSettings();
      }
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/notifications/pulse") {
    const sess = getUiSessionFromReq(req);
    const userId = sess.user_id || CFG.mt5DefaultUserId || "global";
    try {
      const client = await getRedisClient();
      let userPulse = {};
      let globalPulse = 0;
      if (client) {
        userPulse = await client.hGetAll(`NOTIF_PULSE:${userId}`);
        globalPulse = Number((await client.get("NOTIF_PULSE:GLOBAL")) || 0);
      }
      return json(res, 200, {
        ok: true,
        user: userPulse,
        global: globalPulse,
        timestamp: Date.now(),
      });
    } catch (e) {
      return json(res, 200, {
        ok: true,
        user: {},
        global: 0,
        timestamp: Date.now(),
      });
    }
  }

  // Notification history list (from file, newest first)
  if (req.method === "GET" && url.pathname === "/v2/notifications/list") {
    if (!requireAuthForUi(req, res)) return;
    try {
      const limit = Math.max(
        10,
        Math.min(500, Number(url.searchParams.get("limit") || 50)),
      );
      const items = readNotificationsFromFile(limit);
      return json(res, 200, { ok: true, items, total: items.length });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  // Clear notification history (truncate file)
  if (req.method === "POST" && url.pathname === "/v2/notifications/clear") {
    if (!requireAuthForUi(req, res)) return;
    try {
      const ok = clearNotificationsFile();
      return json(res, 200, { ok });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/calendar/today") {
    try {
      const data = await StateRepo.get("NEWS_CALENDAR", "today", async () => {
        await refreshEconomicCalendar();
        const mem = MARKET_DATA_MEMORY_CACHE.get("economic_calendar:today");
        return mem?.data || [];
      });
      return json(res, 200, { ok: true, events: data || [] });
    } catch (error) {
      return json(res, 500, { ok: false, error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/chart/snapshots/delete") {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      ensureChartSnapshotDir();
      const body = await readJson(req);
      const reqSessionPrefix = sanitizeSessionPrefix(
        body?.session_prefix || body?.sessionPrefix || "",
      );
      const deleteAll = body?.all === true;
      const requestedFiles = Array.isArray(body?.files)
        ? body.files.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      const candidates = deleteAll
        ? fs
            .readdirSync(CHART_SNAPSHOT_DIR)
            .filter(
              (f) => !reqSessionPrefix || f.includes(`_${reqSessionPrefix}_`),
            )
        : reqSessionPrefix
          ? fs
              .readdirSync(CHART_SNAPSHOT_DIR)
              .filter((f) => f.includes(`_${reqSessionPrefix}_`))
          : requestedFiles;
      const deleted = [];
      const skipped = [];
      const claudeMap = readClaudeSnapshotFileMap();
      const claudeFileIdsToDelete = [];
      for (const fileNameRaw of candidates) {
        const safeName = normalizeChartFileName(fileNameRaw);
        if (!safeName) {
          skipped.push(fileNameRaw);
          continue;
        }
        const abs = path.join(CHART_SNAPSHOT_DIR, safeName);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          skipped.push(safeName);
          continue;
        }
        fs.unlinkSync(abs);
        deleted.push(safeName);
        const mappedClaudeFileId = String(claudeMap[safeName]?.file_id || "");
        if (mappedClaudeFileId) claudeFileIdsToDelete.push(mappedClaudeFileId);
      }
      removeMappedClaudeSnapshotFiles(deleted);
      const claudeDeleted = [];
      const claudeDeleteFailed = [];
      if (claudeFileIdsToDelete.length && body?.delete_claude !== false) {
        const userId = sess.user_id || CFG.mt5DefaultUserId;
        const claudeKey = await loadClaudeApiKeyForUser(userId).catch(() => "");
        if (claudeKey) {
          for (const fileId of [...new Set(claudeFileIdsToDelete)]) {
            try {
              await anthropicFilesRequest({
                apiKey: claudeKey,
                method: "DELETE",
                pathName: `/v1/files/${encodeURIComponent(fileId)}`,
                timeoutMs: 15000,
              });
              claudeDeleted.push(fileId);
            } catch (error) {
              claudeDeleteFailed.push({
                file_id: fileId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }
      bustClaudeFilesCache();
      return json(res, 200, {
        ok: true,
        deleted_count: deleted.length,
        deleted,
        skipped,
        claude_deleted: claudeDeleted,
        claude_delete_failed: claudeDeleteFailed,
      });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/v2/chart/snapshots/")) {
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      ensureChartSnapshotDir();
      const rawPath = decodeURIComponent(
        url.pathname.replace("/v2/chart/snapshots/", "") || "",
      );
      const parts = rawPath.split("/").filter(Boolean);
      let safeName, abs;
      if (parts.length >= 2) {
        const symDir = path.join(
          CHART_SNAPSHOT_DIR,
          normalizeChartFileName(parts[0]),
        );
        safeName = normalizeChartFileName(parts[parts.length - 1]);
        abs = path.join(symDir, safeName);
      } else {
        safeName = normalizeChartFileName(parts[0] || "");
        if (!safeName)
          return json(res, 400, { ok: false, error: "Invalid file" });
        const m = safeName.match(/^([A-Z]+)_/);
        if (m) {
          const guessDir = path.join(CHART_SNAPSHOT_DIR, m[1]);
          const guess = path.join(guessDir, safeName);
          if (fs.existsSync(guess)) {
            abs = guess;
          }
        }
        if (!abs) abs = path.join(CHART_SNAPSHOT_DIR, safeName);
      }
      if (!safeName) {
        return json(res, 400, { ok: false, error: "Invalid file" });
      }
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return json(res, 404, { ok: false, error: "File not found" });
      }
      const absPath = abs;
      const ext = path.extname(absPath).toLowerCase();
      const mimeTypes = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
      };
      const ct = mimeTypes[ext] || "application/octet-stream";
      const data = fs.readFileSync(absPath);
      res.writeHead(200, {
        "Content-Type": ct,
        "Content-Length": data.length,
        "Cache-Control": "public, max-age=3600",
      });
      res.end(data);
      return;
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // GET /v2/trades/:sid/response — load saved AI analysis response
  if (
    req.method === "GET" &&
    url.pathname.match(/^\/v2\/trades\/([^/]+)\/response$/)
  ) {
    const m = url.pathname.match(/^\/v2\/trades\/([^/]+)\/response$/);
    const respRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
    try {
      // Resolve symbol from DB to prevent bare {sid} folder
      const resolved = await mt5ResolveTradeRefV2(respRef, null).catch(
        () => null,
      );
      const sym = resolved?.symbol || "";
      const logsDir = tradeLogsDir(respRef, sym);
      const aiRespPath = path.join(logsDir, "ai_response.json");
      const respPath = path.join(logsDir, "response.json");
      let parsedJson = null;
      let rawResponse = "";
      let model = "";
      let timestamp = null;
      // Prefer clean ai_response.json — no parsing needed
      if (fs.existsSync(aiRespPath)) {
        const raw = fs.readFileSync(aiRespPath, "utf8");
        try {
          const obj = JSON.parse(raw);
          parsedJson = obj;
          rawResponse = obj.raw_response || "";
          model = obj.model || "";
          timestamp = obj.timestamp || null;
        } catch (_) {}
      }
      // Fallback: re-parse from raw_response in response.json
      if (!parsedJson && fs.existsSync(respPath)) {
        const raw = fs.readFileSync(respPath, "utf8");
        const data = JSON.parse(raw);
        rawResponse = data.raw_response || "";
        model = data.model || "";
        timestamp = data.timestamp || null;
        parsedJson = data.parsed_json;
        if (
          data.raw_response &&
          (!parsedJson || Object.keys(parsedJson).length < 5)
        ) {
          const extracted = extractJsonFromAiText(data.raw_response);
          if (extracted.parsed && typeof extracted.parsed === "object") {
            parsedJson =
              Array.isArray(extracted.parsed) && extracted.parsed.length > 0
                ? extracted.parsed[0]
                : extracted.parsed;
          }
        }
      }
      if (!parsedJson)
        return json(res, 404, { ok: false, error: "response not found" });
      const responseSymbol = String(parsedJson?.symbol || "").trim();
      const analyzeSnapshotFile = copyAnalyzeSnapshotToTradeSession(
        respRef,
        responseSymbol,
      );
      const snapshotDir = tradeSnapshotDir(respRef, responseSymbol);
      const snapshotFiles = fs.existsSync(snapshotDir)
        ? fs
            .readdirSync(snapshotDir)
            .filter((f) => /\.(png|jpe?g)$/i.test(String(f || "")))
            .sort()
        : [];
      return json(res, 200, {
        ok: true,
        session_id: respRef,
        sid: respRef,
        parsed_json: parsedJson || null,
        raw_response: rawResponse,
        model,
        timestamp,
        analyze_snapshot_file: analyzeSnapshotFile || null,
        snapshot_files: snapshotFiles,
      });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e.message || e) });
    }
  }

  // GET /v2/trades/temp — list unsaved trade_files folders (order by time DESC)
  if (req.method === "GET" && url.pathname === "/v2/trades/temp") {
    try {
      const entries = [];
      if (fs.existsSync(TRADE_FILES_DIR)) {
        const dirs = fs.readdirSync(TRADE_FILES_DIR);
        for (const name of dirs) {
          const full = path.join(TRADE_FILES_DIR, name);
          try {
            const st = fs.statSync(full);
            if (!st.isDirectory()) continue;
            const logsDir = path.join(full, "logs");
            const respPath = path.join(logsDir, "response.json");
            const aiRespPath = path.join(logsDir, "ai_response.json");
            let symbol = "";
            let model = "";
            let timestamp = "";
            if (fs.existsSync(aiRespPath)) {
              try {
                const j = JSON.parse(fs.readFileSync(aiRespPath, "utf8"));
                symbol = j.symbol || "";
              } catch (_) {}
            } else if (fs.existsSync(respPath)) {
              try {
                const j = JSON.parse(fs.readFileSync(respPath, "utf8"));
                symbol = j.parsed_json?.symbol || "";
                model = j.model || "";
                timestamp = j.timestamp || "";
              } catch (_) {}
            }
            entries.push({
              folder: name,
              symbol,
              model,
              timestamp: timestamp || st.mtime.toISOString(),
              mtime_ms: st.mtimeMs || st.mtime.getTime(),
              has_response:
                fs.existsSync(respPath) || fs.existsSync(aiRespPath),
            });
          } catch (_) {}
        }
      }
      entries.sort((a, b) => (b.mtime_ms || 0) - (a.mtime_ms || 0));
      return json(res, 200, { ok: true, entries });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e.message || e) });
    }
  }

  if (
    req.method === "GET" &&
    /^\/v2\/trades\/[^/]+\/snapshots$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const m = url.pathname.match(/^\/v2\/trades\/([^/]+)\/snapshots$/);
      const tradeRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!tradeRef)
        return json(res, 400, { ok: false, error: "trade sid is required" });
      const resolvedTrade = await mt5ResolveTradeRefV2(tradeRef, null).catch(
        () => null,
      );
      const sid = String(resolvedTrade?.sid || tradeRef || "").trim();
      const symbolHint = String(resolvedTrade?.symbol || "").trim();
      migrateLegacyTradeSnapshots(sid, symbolHint);
      const ensuredAnalyze = copyAnalyzeSnapshotToTradeSession(sid, symbolHint);
      const dir = tradeSnapshotDir(sid, symbolHint);
      const files = fs
        .readdirSync(dir)
        .map((entry) => {
          const safe = normalizeSnapshotFileName(entry);
          if (!safe) return null;
          const abs = path.join(dir, safe);
          try {
            const st = fs.statSync(abs);
            if (!st.isFile()) return null;
            return {
              id: safe.replace(/\.[^.]+$/i, ""),
              file_name: safe,
              name: safe,
              created_at: new Date(st.mtimeMs || Date.now()).toISOString(),
              size_bytes: Number(st.size || 0),
              mime_type: fileMimeByName(safe),
              trade_sid: sid,
              url: `/v2/trades/${encodeURIComponent(sid)}/snapshots/${encodeURIComponent(safe)}/content`,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) =>
          String(b.created_at).localeCompare(String(a.created_at)),
        );
      return json(res, 200, {
        ok: true,
        trade_sid: sid,
        ensured_analyze_snapshot: ensuredAnalyze || null,
        items: files,
        files,
      });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "GET" &&
    /^\/v2\/trades\/[^/]+\/snapshots\/.+\/content$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    const sess = getUiSessionFromReq(req);
    const isAdmin =
      (req.headers["x-api-key"] || url.searchParams.get("key")) ===
      CFG.adminKey;
    if (!sess.ok && !isAdmin)
      return json(res, 401, { ok: false, error: "AUTH_REQUIRED" });
    try {
      const m = url.pathname.match(
        /^\/v2\/trades\/([^/]+)\/snapshots\/(.+)\/content$/,
      );
      const tradeRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      const fileName = String(m?.[2] ? decodeURIComponent(m[2]) : "").trim();
      if (!tradeRef || !fileName)
        return json(res, 400, {
          ok: false,
          error: "trade sid and filename are required",
        });
      const resolvedTrade = await mt5ResolveTradeRefV2(tradeRef, null).catch(
        () => null,
      );
      const sid = String(resolvedTrade?.sid || tradeRef || "").trim();
      const safeName = normalizeSnapshotFileName(fileName);
      if (!safeName)
        return json(res, 400, { ok: false, error: "Invalid file" });
      migrateLegacyTradeSnapshots(
        sid,
        String(resolvedTrade?.symbol || "").trim(),
      );
      const abs = path.join(
        tradeSnapshotDir(sid, String(resolvedTrade?.symbol || "").trim()),
        safeName,
      );
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile())
        return json(res, 404, { ok: false, error: "file not found" });
      const absPath = abs;
      const ext2 = path.extname(absPath).toLowerCase();
      const mimeMap = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
      };
      const ct2 = mimeMap[ext2] || "application/octet-stream";
      const buf = fs.readFileSync(absPath);
      res.writeHead(200, {
        "Content-Type": ct2,
        "Content-Length": buf.length,
        "Cache-Control": "public, max-age=3600",
      });
      res.end(buf);
      return;
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "GET" &&
    url.pathname === "/v2/settings/execution-profiles"
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const userId = uiEffectiveUserId(req, url);
      const [items, active, accounts] = await Promise.all([
        mt5ListExecutionProfilesV2(userId),
        mt5GetActiveExecutionProfileV2(userId),
        mt5ListAccountsV2(userId),
      ]);
      return json(res, 200, {
        ok: true,
        items,
        active_profile: active || null,
        accounts: accounts || [],
      });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "POST" &&
    url.pathname === "/v2/settings/execution-profile"
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const userId = uiEffectiveUserId(req, url, payload);
      const route = String(payload?.route || "")
        .trim()
        .toLowerCase();
      if (!["ea", "v2026.05.09 19:31 - 728f356", "ctrader"].includes(route)) {
        return json(res, 400, {
          ok: false,
          error: "route must be one of: ea, v2, ctrader",
        });
      }
      const accountId = String(payload?.account_id || "").trim();
      if (!accountId)
        return json(res, 400, { ok: false, error: "account_id is required" });
      const sourceIds = (
        Array.isArray(payload?.source_ids) ? payload.source_ids : []
      )
        .map((v) => String(v || "").trim())
        .filter(Boolean);
      const save = await mt5SaveExecutionProfileV2({
        profile_id:
          String(payload?.profile_id || "default").trim() || "default",
        profile_name:
          String(payload?.profile_name || `profile_${route}`).trim() ||
          `profile_${route}`,
        user_id: userId,
        route,
        account_id: accountId,
        source_ids: sourceIds,
        ctrader_mode: String(payload?.ctrader_mode || "")
          .trim()
          .toLowerCase(),
        ctrader_account_id: String(payload?.ctrader_account_id || "").trim(),
        is_active: payload?.is_active !== false,
        metadata:
          payload?.metadata && typeof payload.metadata === "object"
            ? payload.metadata
            : {},
      });
      if (!save?.ok)
        return json(res, 400, {
          ok: false,
          error: save?.error || "failed to save execution profile",
        });
      const rows = await mt5ListExecutionProfilesV2(userId);
      return json(res, 200, { ok: true, item: save.item || null, items: rows });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "POST" &&
    url.pathname === "/v2/settings/execution-profile/apply"
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const userId = uiEffectiveUserId(req, url, payload);
      const route = String(payload?.route || "")
        .trim()
        .toLowerCase();
      if (!["ea", "v2026.05.09 19:31 - 728f356", "ctrader"].includes(route)) {
        return json(res, 400, {
          ok: false,
          error: "route must be one of: ea, v2, ctrader",
        });
      }
      const accountId = String(payload?.account_id || "").trim();
      if (!accountId)
        return json(res, 400, { ok: false, error: "account_id is required" });
      const sourceIds = (
        Array.isArray(payload?.source_ids)
          ? payload.source_ids
          : ["signal", "tradingview"]
      )
        .map((v) => String(v || "").trim())
        .filter(Boolean);
      const save = await mt5SaveExecutionProfileV2({
        profile_id:
          String(payload?.profile_id || "default").trim() || "default",
        profile_name:
          String(payload?.profile_name || `active_${route}`).trim() ||
          `active_${route}`,
        user_id: userId,
        route,
        account_id: accountId,
        source_ids: sourceIds,
        ctrader_mode: String(payload?.ctrader_mode || "")
          .trim()
          .toLowerCase(),
        ctrader_account_id: String(payload?.ctrader_account_id || "").trim(),
        is_active: true,
        metadata:
          payload?.metadata && typeof payload.metadata === "object"
            ? payload.metadata
            : {},
      });
      if (!save?.ok)
        return json(res, 400, {
          ok: false,
          error: save?.error || "failed to save execution profile",
        });

      // Route one-account-only by subscriptions to avoid duplicate fanout.
      const accounts = await mt5ListAccountsV2(userId);
      for (const acc of accounts || []) {
        const aid = String(acc?.account_id || "").trim();
        if (!aid) continue;
        const items =
          aid === accountId
            ? sourceIds.map((sid) => ({ source_id: sid, is_active: true }))
            : [];
        await mt5ReplaceAccountSubscriptionsV2(aid, items);
      }
      const active = await mt5GetActiveExecutionProfileV2(userId);
      return json(res, 200, {
        ok: true,
        active_profile: active || null,
        routed_account_id: accountId,
        route,
        note: "Signal fanout routed to selected account. Runtime process mode (EA/v2 daemon/cTrader bridge) is still managed outside server.",
      });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/sources") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const rows = await mt5ListSourcesV2();
      return json(res, 200, { ok: true, items: rows });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/brokers") {
    return json(res, 410, {
      ok: false,
      error: "Brokers endpoint removed. Broker metadata is account-scoped.",
    });
  }

  if (req.method === "GET" && url.pathname === "/v2/trades/counts") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const b = await mt5Backend();
      const userId = uiEffectiveUserId(req, url);
      const params = [];
      let userWhere = "";
      if (userId) {
        params.push(userId);
        userWhere = " WHERE user_id = $1";
      }
      const rows = await b.pool.query(
        `SELECT execution_status, COUNT(*) as c FROM trades${userWhere} GROUP BY execution_status`,
        params,
      );
      const counts = {};
      for (const r of rows.rows || []) {
        counts[r.execution_status] = Number(r.c);
      }
      return json(res, 200, { ok: true, counts });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/trades") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const pageRaw = Number(url.searchParams.get("page") || 1);
      const pageSizeRaw = Number(
        url.searchParams.get("pageSize") || url.searchParams.get("limit") || 50,
      );
      const page = Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1);
      const pageSize = Math.max(
        1,
        Math.min(200, Number.isFinite(pageSizeRaw) ? pageSizeRaw : 50),
      );
      const userId = uiEffectiveUserId(req, url);
      const filters = {
        user_id: userId,
        account_id: url.searchParams.get("account_id") || "",
        source_id: url.searchParams.get("source_id") || "",
        dispatch_status: url.searchParams.get("dispatch_status") || "",
        execution_status: url.searchParams.get("execution_status") || "",
        created_from: url.searchParams.get("created_from") || "",
        created_to: url.searchParams.get("created_to") || "",
        symbol: url.searchParams.get("symbol") || "",
        action:
          url.searchParams.get("action") || url.searchParams.get("side") || "",
        entry_model: url.searchParams.get("entry_model") || "",
        chart_tf: url.searchParams.get("chart_tf") || "",
        q: url.searchParams.get("q") || "",
      };

      // Only cache when there are no meaningful filters (just user_id + page/pageSize).
      // Filters beyond user_id would poison the cache with stale scoped results.
      const filterKeys = [
        "account_id",
        "source_id",
        "dispatch_status",
        "execution_status",
        "created_from",
        "created_to",
        "symbol",
        "action",
        "entry_model",
        "chart_tf",
        "q",
      ];
      const hasFilters = filterKeys.some((k) => filters[k]);

      const cacheKey = hasFilters
        ? null
        : JSON.stringify({ src: currentMt5DbSourceId(), userId, filters, page, pageSize });

      const buildResponse = async () => {
        const out = await mt5ListTradesV2(filters, page, pageSize);
        const total = Number(out?.total || 0);
        // Enrich trades with account broker_name (one batch query, not per-trade)
        const rawItems = Array.isArray(out?.items) ? out.items : [];
        const accountIds = [
          ...new Set(
            rawItems
              .map((t) => String(t.account_id || "").trim())
              .filter(Boolean),
          ),
        ];
        const accountMap = new Map(); // account_id -> { broker_name, provider_code, metadata }
        if (accountIds.length) {
          try {
            const b = await mt5Backend();
            const acctRows = await b.pool.query(
              `SELECT account_id, metadata FROM user_accounts WHERE account_id = ANY($1::text[])`,
              [accountIds],
            );
            for (const r of acctRows.rows || []) {
              let meta = {};
              try {
                meta =
                  r.metadata && typeof r.metadata === "object"
                    ? r.metadata
                    : typeof r.metadata === "string"
                      ? JSON.parse(r.metadata)
                      : {};
              } catch (_) {}
              accountMap.set(r.account_id, {
                broker_name:
                  meta.broker_name || meta.name || r.account_id || null,
                provider_code: resolveProviderCode(
                  meta.broker_name || meta.name || "",
                ),
                metadata: meta,
              });
            }
          } catch (_) {}
        }
        const items = rawItems.map((item) => {
          const acc = accountMap.get(String(item.account_id || "").trim());
          const metadata =
            item?.metadata && typeof item.metadata === "object"
              ? item.metadata
              : {};
          const rawEntryModel =
            item?.entry_model ||
            metadata?.entry_model ||
            metadata?.entry_model_raw ||
            "";
          const symbolMetric = mt5FindSymbolMetric(
            acc?.metadata || {},
            item?.symbol,
          );
          const plannedPnlFallback = mt5ComputePlannedPnlFromMetrics(
            item,
            symbolMetric,
          );
          const plannedTpPnl = mt5ResolveStoredPlannedPnlValue(
            item?.planned_tp_pnl,
            plannedPnlFallback.tpPnl,
          );
          const plannedSlPnl = mt5ResolveStoredPlannedPnlValue(
            item?.planned_sl_pnl,
            plannedPnlFallback.slPnl,
          );
          return {
            ...item,
            account_broker_name: acc?.broker_name || null,
            account_provider_code: acc?.provider_code || null,
            account_metadata: acc?.metadata || {},
            planned_tp_pnl: Number.isFinite(plannedTpPnl) ? plannedTpPnl : 0,
            planned_sl_pnl: Number.isFinite(plannedSlPnl) ? plannedSlPnl : 0,
            metadata: {
              ...metadata,
              provider_code:
                acc?.provider_code || metadata?.provider_code || null,
              broker_name: acc?.broker_name || metadata?.broker_name || null,
              order_type: mt5NormalizeOrderTypeValue(
                item?.order_type || metadata?.order_type,
                "limit",
              ),
            },
            entry_model: mt5NormalizeEntryModel(rawEntryModel, {
              fallback: item?.source_id || "manual",
            }),
          };
        });
        const result = {
          ok: true,
          items,
          page: Number(out?.page || page),
          pageSize: Number(out?.page_size || pageSize),
          total,
          pages: Math.max(
            1,
            Math.ceil(total / Math.max(1, Number(out?.page_size || pageSize))),
          ),
        };
        // Populate Redis cache for PENDING/OPEN lists
        const execStatus = String(filters.execution_status || "").toUpperCase();
        if (
          (execStatus === "PENDING" || execStatus === "FILLED") &&
          !hasFilters
        ) {
          setTradeListCache(
            execStatus === "PENDING" ? "PENDING" : "FILLED",
            items,
          ).catch(() => {});
        }
        return result;
      };

      // Fast path: try Redis cache first for unfiltered PENDING/OPEN lists
      const execStatus = String(filters.execution_status || "").toUpperCase();
      if (
        (execStatus === "PENDING" || execStatus === "FILLED") &&
        !hasFilters &&
        page === 1
      ) {
        const cached = await getTradeListFromCache(
          execStatus === "PENDING" ? "PENDING" : "FILLED",
        );
        if (cached && Array.isArray(cached)) {
          return json(res, 200, {
            ok: true,
            items: cached,
            page: 1,
            pageSize: cached.length,
            total: cached.length,
            pages: 1,
          });
        }
      }

      const result = cacheKey
        ? await StateRepo.get("TRADE_LIST", cacheKey, buildResponse)
        : await buildResponse();

      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/trades/bulk-action") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const userId = uiEffectiveUserId(req, url, payload);
      const action = String(payload.action || "")
        .trim()
        .toLowerCase();
      const filters = {
        user_id: userId,
        sids: Array.isArray(payload.sids || payload.trade_ids)
          ? payload.sids || payload.trade_ids
          : [],
        account_id: payload.account_id || "",
        source_id: payload.source_id || "",
        execution_status: payload.execution_status || "",
        created_from: payload.created_from || "",
        created_to: payload.created_to || "",
        q: payload.q || "",
      };
      const out = await mt5BulkActionTradesV2(action, filters);
      if (out?.ok && (action === "cancel_all" || action === "delete_all")) {
        const cleanup = await mt5CleanupSignalTradeArtifacts({
          signalIds: Array.isArray(out.sids) ? out.sids : [],
          tradeIds: Array.isArray(out.sids) ? out.sids : [],
        });
        out.logs_deleted = cleanup.logs_deleted || 0;
        out.files_deleted = cleanup.files_deleted || 0;
      }
      return json(res, out?.ok ? 200 : 400, out);
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "GET" &&
    /^\/v2\/trades\/[^/]+\/events$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const m = url.pathname.match(/^\/v2\/trades\/([^/]+)\/events$/);
      const tradeRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!tradeRef)
        return json(res, 400, {
          ok: false,
          error: "sid (trade_id) is required",
        });
      const userId = uiEffectiveUserId(req, url);
      const detail = await StateRepo.get("TRADE_DETAIL", tradeRef, async () => {
        try {
          const resolved = await mt5ResolveTradeRefV2(tradeRef, userId || null);
          if (!resolved?.sid) return null;
          const limitRaw = Number(url.searchParams.get("limit") || 200);
          const limit = Math.max(
            1,
            Math.min(1000, Number.isFinite(limitRaw) ? limitRaw : 200),
          );
          const rows = await mt5ListTradeEventsV2(resolved.sid, limit);
          return {
            sid: resolved.sid,
            id: resolved.id || null,
            items: rows,
          };
        } catch {
          return null;
        }
      });
      if (!detail)
        return json(res, 200, { ok: true, sid: tradeRef, items: [] });
      return json(res, 200, { ok: true, ...detail });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "POST" &&
    /^\/v2\/trades\/[^/]+\/update$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const m = url.pathname.match(/^\/v2\/trades\/([^/]+)\/update$/);
      const tradeRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!tradeRef)
        return json(res, 400, {
          ok: false,
          error: "sid (trade_id) is required",
        });
      const userId = uiEffectiveUserId(req, url, payload);
      const out = await mt5UpdateTradeManualV2(
        tradeRef,
        userId || null,
        payload || {},
      );
      StateRepo.del("SIGNAL_DETAIL", tradeRef);
      StateRepo.del("TRADE_DETAIL", tradeRef);
      if (out?.ok) {
        invalidateTradeListCaches().catch(() => {});
        StateRepo.flushBucket("TRADE_LIST").catch(() => {});
      }
      return json(res, out?.ok ? 200 : 400, out);
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    false &&
    req.method === "POST" &&
    /^\/v2\/signals\/[^/]+\/trade-plan\/save$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const m = url.pathname.match(
        /^\/v2\/signals\/([^/]+)\/trade-plan\/save$/,
      );
      const signalRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!signalRef)
        return json(res, 400, {
          ok: false,
          error: "sid (signal_id) is required",
        });
      const userId = uiEffectiveUserId(req, url, payload);
      const resolvedSignal = await mt5ResolveSignalRefV2(
        signalRef,
        userId || null,
      );
      if (!resolvedSignal?.sid)
        return json(res, 404, { ok: false, error: "signal not found" });
      const signalId = String(resolvedSignal.sid || "").trim();
      const sideRaw = String(payload.direction || payload.side || "")
        .trim()
        .toUpperCase();
      const side = sideRaw.includes("SELL")
        ? "SELL"
        : sideRaw.includes("BUY")
          ? "BUY"
          : null;
      const sl = asNum(payload.sl, NaN);
      const tp = asNum(payload.tp, NaN);
      const rr = asNum(payload.rr, NaN);
      const entry = asNum(payload.entry ?? payload.price, NaN);
      const tradeType = String(
        payload.trade_type || payload.order_type || "limit",
      )
        .trim()
        .toLowerCase();
      const note = String(payload.note || "").trim();
      const rawPatch = {};
      if (Number.isFinite(entry)) {
        rawPatch.entry = entry;
        rawPatch.price = entry;
      }
      rawPatch.order_type = ["limit", "market", "stop"].includes(tradeType)
        ? tradeType
        : "limit";
      rawPatch.trade_plan = {
        direction: side || null,
        order_type:
          tradeType === "stop"
            ? "Stop Limit"
            : tradeType === "market"
              ? "Market"
              : "Limit",
        entry: Number.isFinite(entry) ? entry : null,
        entry_price: Number.isFinite(entry) ? entry : null,
        sl: Number.isFinite(sl) ? sl : null,
        stop_loss: Number.isFinite(sl) ? sl : null,
        tp1: Number.isFinite(tpNorm.tp1) ? tpNorm.tp1 : null,
        tp2: Number.isFinite(tpNorm.tp2) ? tpNorm.tp2 : null,
        tp3: Number.isFinite(tpNorm.tp3) ? tpNorm.tp3 : null,
        take_profit: Number.isFinite(tp) ? tp : null,
        rr: Number.isFinite(rr) ? rr : null,
        risk_reward: Number.isFinite(rr) ? rr : null,
        type: rawPatch.order_type,
        note: note || null,
      };
      if (payload.invalidation) rawPatch.invalidation = payload.invalidation;
      if (payload.exit_condition)
        rawPatch.exit_condition = payload.exit_condition;
      if (payload.entry_condition)
        rawPatch.entry_condition = payload.entry_condition;
      if (payload.risk_management)
        rawPatch.risk_management = payload.risk_management;
      if (payload.skip_recommendation)
        rawPatch.skip_recommendation = payload.skip_recommendation;
      if (payload.confluence_checklist)
        rawPatch.confluence_checklist = payload.confluence_checklist;
      const b = await mt5Backend();
      const { eq, and } = require("drizzle-orm");
      const schema = b.schema || require("../db/schema");

      // Fetch existing raw_json to merge in JS
      const existingCond = [eq(schema.signals.sid, signalId)];
      if (userId) existingCond.push(eq(schema.signals.userId, userId));
      const existing = await b.db
        .select({ rawJson: schema.signals.rawJson })
        .from(schema.signals)
        .where(and(...existingCond))
        .limit(1);
      if (!existing.length)
        return json(res, 404, { ok: false, error: "signal not found" });
      const existingRaw = dbQueries.parseJsonField(existing[0].rawJson) || {};
      const mergedRaw = { ...existingRaw, ...rawPatch };

      const resUpd = await b.db
        .update(schema.signals)
        .set({
          side: side || undefined,
          sl: Number.isFinite(sl) ? sl : null,
          tp: Number.isFinite(tpNorm.tp) ? tpNorm.tp : null,
          tp1: Number.isFinite(tpNorm.tp1) ? tpNorm.tp1 : null,
          tp2: Number.isFinite(tpNorm.tp2) ? tpNorm.tp2 : null,
          tp3: Number.isFinite(tpNorm.tp3) ? tpNorm.tp3 : null,
          rrPlanned: Number.isFinite(rr) ? rr : null,
          note: note || null,
          rawJson: dbQueries.jsonField(mergedRaw),
          confidencePct: asNum(payload.confidence_pct) || null,
          estimatedBars: asNum(payload.estimated_bars) || null,
          profile: payload.profile || null,
          beTrigger: asNum(payload.be_trigger) || null,
          updatedAt: new Date(),
        })
        .where(and(...existingCond))
        .returning();

      const row = resUpd[0];
      await mt5Log(
        signalId,
        "signals",
        { event_type: "SIGNAL_TRADE_PLAN_SAVED", data: rawPatch },
        row.userId || userId || CFG.mt5DefaultUserId,
      );
      StateRepo.del("SIGNAL_DETAIL", signalRef);
      return json(res, 200, { ok: true, item: mt5MapDbRow(row) });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    false &&
    req.method === "POST" &&
    /^\/v2\/signals\/[^/]+\/trade$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const m = url.pathname.match(/^\/v2\/signals\/([^/]+)\/trade$/);
      const signalRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!signalRef)
        return json(res, 400, {
          ok: false,
          error: "sid (signal_id) is required",
        });
      const userId = uiEffectiveUserId(req, url, payload);
      const resolvedSignal = await mt5ResolveSignalRefV2(
        signalRef,
        userId || null,
      );
      if (!resolvedSignal?.sid)
        return json(res, 404, { ok: false, error: "signal not found" });
      const signalId = String(resolvedSignal.sid || "").trim();
      const b = await mt5Backend();
      const signal = await dbQueries.getSignalByTicket(b.db, signalId);
      if (!signal || (userId && signal.userId !== String(userId)))
        return json(res, 404, { ok: false, error: "signal not found" });
      const raw =
        signal.rawJson && typeof signal.rawJson === "object"
          ? signal.rawJson
          : {};
      const sideRaw = String(
        payload.direction || payload.side || signal.side || "",
      )
        .trim()
        .toUpperCase();
      const side = sideRaw.includes("SELL") ? "SELL" : "BUY";
      const entry = asNum(
        payload.entry ?? payload.price ?? raw.entry ?? raw.price,
        NaN,
      );
      const sl = asNum(payload.sl ?? signal.sl, NaN);
      const tpNorm = mt5NormalizeTpFields(
        {
          ...signalRawJson,
          tp: payload.tp ?? signal.tp,
          tp1: payload.tp1 ?? signal.tp1 ?? signalRawJson.tp1,
          tp2: payload.tp2 ?? signal.tp2 ?? signalRawJson.tp2,
          tp3: payload.tp3 ?? signal.tp3 ?? signalRawJson.tp3,
          tp_targets: payload.tp_targets ?? signalRawJson.tp_targets,
        },
        side,
      );
      const tp = asNum(tpNorm.tp, NaN);
      const rr = asNum(payload.rr ?? signal.rrPlanned, NaN);
      const note = String(payload.note || signal.note || "").trim();
      const tradeType = String(
        payload.trade_type || payload.order_type || raw.order_type || "limit",
      )
        .trim()
        .toLowerCase();
      const sourceId = String(
        signal.sourceId || mt5SlugId(signal.source || "signal", "signal"),
      ).trim();
      const signalRawJson =
        signal.rawJson && typeof signal.rawJson === "object"
          ? signal.rawJson
          : {};
      const copiedMetadata = {
        ...signalRawJson,
        confidence_pct: asNum(
          payload.confidence_pct ??
            signal.confidencePct ??
            signalRawJson.confidence_pct,
        ),
        invalidation:
          payload.invalidation ??
          signal.invalidation ??
          signalRawJson.invalidation,
        estimated_bars: asNum(
          payload.estimated_bars ??
            signal.estimatedBars ??
            signalRawJson.estimated_bars,
        ),
        profile: payload.profile ?? signal.profile ?? signalRawJson.profile,
        exit_condition:
          payload.exit_condition ??
          signal.exit_condition ??
          signalRawJson.exit_condition,
        entry_condition:
          payload.entry_condition ??
          signal.entry_condition ??
          signalRawJson.entry_condition,
        risk_management:
          payload.risk_management ??
          signal.risk_management ??
          signalRawJson.risk_management,
        skip_recommendation:
          payload.skip_recommendation ??
          signal.skip_recommendation ??
          signalRawJson.skip_recommendation,
        confluence_checklist:
          payload.confluence_checklist ??
          signal.confluence_checklist ??
          signalRawJson.confluence_checklist,
        be_trigger: asNum(
          payload.be_trigger ?? signal.beTrigger ?? signalRawJson.be_trigger,
        ),
      };
      if (!copiedMetadata.order_type && !copiedMetadata.orderType) {
        copiedMetadata.order_type = ["limit", "market", "stop"].includes(
          tradeType,
        )
          ? tradeType
          : "limit";
      }
      const fanout = await mt5FanoutSignalTradeV2({
        signal_id: signalId,
        source_id: sourceId,
        user_id: signal.userId || userId || CFG.mt5DefaultUserId,
        entry_model:
          mt5NormalizeEntryModel(
            signal.entryModel ||
              raw.entry_model ||
              raw.entryModel ||
              raw.model ||
              raw.strategy ||
              "",
            { fallback: signal.sourceId || signal.source || "manual" },
          ) || null,
        signal_tf: signal.signalTf || null,
        chart_tf: signal.chartTf || null,
        symbol: signal.symbol,
        action: side,
        entry: Number.isFinite(entry) ? entry : null,
        sl: Number.isFinite(sl) ? sl : null,
        tp: Number.isFinite(tp) ? tp : null,
        tp1: tpNorm.tp1,
        tp2: tpNorm.tp2,
        tp3: tpNorm.tp3,
        tp_targets: tpNorm.tp_targets,
        volume: asNum(payload.volume ?? raw.volume, NaN) || null,
        note: note || null,
        metadata: copiedMetadata,
      });
      await mt5Log(
        signalId,
        "signals",
        {
          event: "SIGNAL_CREATE_TRADE",
          data: { created: fanout?.created || 0 },
        },
        signal.user_id || userId || CFG.mt5DefaultUserId,
      );

      // If no other active users are subscribed to this source, mark signal CLOSED
      if (fanout?.created > 0 && sourceId) {
        try {
          const { and, eq, ne } = require("drizzle-orm");
          const schema = b.schema || require("../db/schema");
          const subRows = await b.db
            .select()
            .from(schema.userSettings)
            .where(
              and(
                eq(schema.userSettings.type, "execution_profile"),
                ne(
                  schema.userSettings.userId,
                  signal.userId || userId || CFG.mt5DefaultUserId,
                ),
              ),
            );
          const hasSubscribers = (subRows || []).some((r) => {
            const d = dbQueries.parseJsonField(r.data) || {};
            return (
              d.is_active &&
              Array.isArray(d.source_ids) &&
              d.source_ids.includes(sourceId)
            );
          });
          if (!hasSubscribers) {
            await dbQueries.closeSignal(b.db, signalId);
          }
        } catch (_) {
          // non-critical — don't fail the response
        }
      }

      return json(res, 200, {
        ok: true,
        signal_id: signalId,
        created: fanout?.created || 0,
        account_ids: fanout?.account_ids || [],
      });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "POST" &&
    /^\/v2\/trades\/[^/]+\/trade-plan\/save$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const m = url.pathname.match(/^\/v2\/trades\/([^/]+)\/trade-plan\/save$/);
      const tradeRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!tradeRef)
        return json(res, 400, {
          ok: false,
          error: "sid (trade_id) is required",
        });
      const userId = uiEffectiveUserId(req, url, payload);
      const resolvedTrade = await mt5ResolveTradeRefV2(
        tradeRef,
        userId || null,
      );
      if (!resolvedTrade?.sid)
        return json(res, 404, { ok: false, error: "trade not found" });
      const tradeId = String(resolvedTrade.sid || "").trim();
      const currentStatus = String(
        resolvedTrade.execution_status || "",
      ).toUpperCase();
      const lockCore = currentStatus === "FILLED";
      const lockAll =
        currentStatus === "CLOSED" || currentStatus === "CANCELLED";
      const sideRaw = String(payload.direction || payload.side || "")
        .trim()
        .toUpperCase();
      const side = sideRaw.includes("SELL")
        ? "SELL"
        : sideRaw.includes("BUY")
          ? "BUY"
          : null;
      const entry = asNum(payload.entry ?? payload.price, NaN);
      const sl = asNum(payload.sl, NaN);
      const tpNorm = mt5NormalizeTpFields(payload, side);
      const tp = asNum(tpNorm.tp, NaN);
      const rr = asNum(payload.rr, NaN);
      const confidencePct = asNum(payload.confidence_pct, NaN);
      const estimatedBars = asNum(payload.estimated_bars, NaN);
      const beTrigger = asNum(payload.be_trigger, NaN);
      const volume = asNum(payload.volume, NaN);
      const plannedLots = asNum(
        payload.lots ?? payload.volume_basis_lots ?? payload.display_lots,
        NaN,
      );
      const riskMoneyPlanned = asNum(
        payload.risk_money_planned ?? payload.risk_money,
        NaN,
      );
      const tradeType = String(
        payload.trade_type || payload.order_type || "limit",
      )
        .trim()
        .toLowerCase();
      const note = String(payload.note || "").trim();
      const strategy = String(payload.strategy || "").trim();
      const entryModel = String(payload.entry_model || "").trim();
      const sourceId = String(payload.source_id || "").trim();
      const editableSide = lockCore || lockAll ? null : side;
      const editableEntry = lockCore || lockAll ? NaN : entry;
      const editableTradeType = lockCore || lockAll ? "" : tradeType;
      const editableSl = lockAll ? NaN : sl;
      const editableTp = lockAll ? NaN : tpNorm.tp;
      const editableTp1 = lockAll ? NaN : tpNorm.tp1;
      const editableTp2 = lockAll ? NaN : tpNorm.tp2;
      const editableTp3 = lockAll ? NaN : tpNorm.tp3;
      const editableRr = lockAll ? NaN : rr;
      const editableRiskMoneyPlanned = lockAll ? NaN : riskMoneyPlanned;
      const editableVolume = lockAll ? NaN : volume;
      const metaPatch = {
        order_type: ["limit", "market", "stop"].includes(editableTradeType)
          ? editableTradeType
          : "limit",
        rr_planned: Number.isFinite(editableRr) ? editableRr : null,
        risk_money_planned: Number.isFinite(editableRiskMoneyPlanned)
          ? editableRiskMoneyPlanned
          : null,
        volume: Number.isFinite(editableVolume) ? editableVolume : null,
        volume_basis_lots: Number.isFinite(plannedLots) ? plannedLots : null,
        trade_plan: {
          direction: editableSide || null,
          order_type:
            editableTradeType === "stop"
              ? "Stop Limit"
              : editableTradeType === "market"
                ? "Market"
                : "Limit",
          entry: Number.isFinite(editableEntry) ? editableEntry : null,
          entry_price: Number.isFinite(editableEntry) ? editableEntry : null,
          sl: Number.isFinite(editableSl) ? editableSl : null,
          stop_loss: Number.isFinite(editableSl) ? editableSl : null,
          tp: Number.isFinite(editableTp) ? editableTp : null,
          tp1: Number.isFinite(editableTp1) ? editableTp1 : null,
          tp2: Number.isFinite(editableTp2) ? editableTp2 : null,
          tp3: Number.isFinite(editableTp3) ? editableTp3 : null,
          take_profit: Number.isFinite(editableTp) ? editableTp : null,
          rr: Number.isFinite(editableRr) ? editableRr : null,
          risk_reward: Number.isFinite(editableRr) ? editableRr : null,
          volume: Number.isFinite(editableVolume) ? editableVolume : null,
          lots: Number.isFinite(plannedLots) ? plannedLots : null,
          note: note || null,
        },
        tp_targets: tpNorm.tp_targets,
      };
      if (payload.invalidation) metaPatch.invalidation = payload.invalidation;
      if (payload.exit_condition)
        metaPatch.exit_condition = payload.exit_condition;
      if (payload.entry_condition)
        metaPatch.entry_condition = payload.entry_condition;
      if (payload.risk_management)
        metaPatch.risk_management = payload.risk_management;
      if (payload.skip_recommendation)
        metaPatch.skip_recommendation = payload.skip_recommendation;
      if (payload.confluence_checklist)
        metaPatch.confluence_checklist = payload.confluence_checklist;
      const b = await mt5Backend();

      // Fetch existing metadata to merge in JS
      const existingTrade = await b.pool.query(
        `SELECT metadata, account_id, symbol, action, volume, entry, sl, tp, tp1, planned_tp_pnl, planned_sl_pnl
         FROM trades WHERE sid = $1 LIMIT 1`,
        [tradeId],
      );
      if (!existingTrade.rows.length)
        return json(res, 404, { ok: false, error: "trade not found" });
      const existingTradeRow = existingTrade.rows[0];
      const existingMeta = dbQueries.parseJsonField(existingTradeRow.metadata) || {};
      const accountRes = await b.pool.query(
        `SELECT metadata FROM user_accounts WHERE account_id = $1 LIMIT 1`,
        [existingTradeRow.account_id],
      );
      const accountMeta = mt5ParseAccountMetadata(accountRes.rows?.[0]?.metadata);
      const symbolMetric = mt5FindSymbolMetric(
        accountMeta,
        existingTradeRow.symbol,
      );
      const plannedPnlFallback = mt5ComputePlannedPnlFromMetrics(
        {
          action:
            editableSide ||
            existingTradeRow.action ||
            resolvedTrade.action ||
            null,
          volume: Number.isFinite(editableVolume)
            ? editableVolume
            : existingTradeRow.volume,
          entry: Number.isFinite(editableEntry)
            ? editableEntry
            : existingTradeRow.entry,
          sl: Number.isFinite(editableSl) ? editableSl : existingTradeRow.sl,
          tp:
            Number.isFinite(editableTp1)
              ? editableTp1
              : Number.isFinite(editableTp)
                ? editableTp
                : existingTradeRow.tp1 ?? existingTradeRow.tp,
        },
        symbolMetric,
      );
      const plannedTpPnl = mt5ResolveStoredPlannedPnlValue(
        payload.planned_tp_pnl ?? existingTradeRow.planned_tp_pnl,
        plannedPnlFallback.tpPnl,
      );
      const plannedSlPnl = mt5ResolveStoredPlannedPnlValue(
        payload.planned_sl_pnl ?? existingTradeRow.planned_sl_pnl,
        plannedPnlFallback.slPnl,
      );
      if (Number.isFinite(plannedTpPnl)) metaPatch.planned_tp_pnl = plannedTpPnl;
      if (Number.isFinite(plannedSlPnl)) metaPatch.planned_sl_pnl = plannedSlPnl;
      const mergedMeta = { ...existingMeta, ...metaPatch };

      const resUpd = await b.pool.query(
        `UPDATE trades SET
          action = COALESCE($1::text, action),
          entry = COALESCE($2::double precision, entry),
          sl = COALESCE($3::double precision, sl),
          tp = COALESCE($4::double precision, tp),
          tp1 = COALESCE($5::double precision, tp1),
          tp2 = COALESCE($6::double precision, tp2),
          tp3 = COALESCE($7::double precision, tp3),
          note = COALESCE($8::text, note),
          metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || $9::jsonb,
          confidence_pct = COALESCE($10::double precision, confidence_pct),
          estimated_bars = COALESCE($11::double precision, estimated_bars),
          profile = COALESCE($12::text, profile),
          be_trigger = COALESCE($13::double precision, be_trigger),
          strategy = COALESCE($14::text, strategy),
          entry_model = COALESCE($15::text, entry_model),
          source_id = COALESCE($16::text, source_id),
          order_type = COALESCE($17::text, order_type),
          risk_money_planned = COALESCE($18::double precision, risk_money_planned),
          volume = COALESCE($19::double precision, volume),
          planned_tp_pnl = COALESCE($20::double precision, planned_tp_pnl),
          planned_sl_pnl = COALESCE($21::double precision, planned_sl_pnl),
          updated_at = NOW()
        WHERE sid = $22
        RETURNING *`,
        [
          editableSide || null,
          Number.isFinite(editableEntry) ? editableEntry : null,
          Number.isFinite(editableSl) ? editableSl : null,
          Number.isFinite(editableTp) ? editableTp : null,
          Number.isFinite(editableTp1) ? editableTp1 : null,
          Number.isFinite(editableTp2) ? editableTp2 : null,
          Number.isFinite(editableTp3) ? editableTp3 : null,
          note || null,
          JSON.stringify(mergedMeta),
          Number.isFinite(confidencePct) ? confidencePct : null,
          Number.isFinite(estimatedBars) ? estimatedBars : null,
          payload.profile || null,
          Number.isFinite(beTrigger) ? beTrigger : null,
          strategy || null,
          entryModel || null,
          sourceId || null,
          ["limit", "market", "stop"].includes(editableTradeType)
            ? editableTradeType
            : null,
          Number.isFinite(editableRiskMoneyPlanned)
            ? editableRiskMoneyPlanned
            : null,
          Number.isFinite(editableVolume) ? editableVolume : null,
          Number.isFinite(plannedTpPnl) ? plannedTpPnl : null,
          Number.isFinite(plannedSlPnl) ? plannedSlPnl : null,
          tradeId,
        ],
      );
      const row = resUpd.rows[0];
      await mt5Log(
        tradeId,
        "trades",
        { event_type: "TRADE_PLAN_SAVED", data: metaPatch },
        row.userId || row.user_id || userId || CFG.mt5DefaultUserId,
      );
      // If this is a pending order with a broker ticket, dispatch MODIFY so cBot updates it
      const newStatus = String(row.execution_status || "").toUpperCase();
      const hasBrokerTicket =
        row.broker_trade_id && String(row.broker_trade_id || "").trim() !== "";
      if (
        (newStatus === "PENDING" || newStatus === "FILLED") &&
        hasBrokerTicket
      ) {
        await b.pool.query(
          `UPDATE trades SET dispatch_status = 'MODIFY', updated_at = NOW() WHERE sid = $1 AND dispatch_status = 'CONSUMED'`,
          [tradeId],
        );
      }
      invalidateTradeListCaches().catch(() => {});
      return json(res, 200, { ok: true, item: row });
    } catch (error) {
      console.error(
        "[trade-plan/save] ERROR",
        error instanceof Error ? error.message : String(error),
      );
      if (error instanceof Error && error.stack) {
        console.error("[trade-plan/save] STACK", error.stack);
      }
      return json(res, 400, {
        ok: false,
        error:
          error instanceof Error
            ? error.message + " | " + (error.stack || "").split("\n")[1]
            : String(error),
      });
    }
  }

  // --- Promote Draft trade to PENDING ---

  if (
    req.method === "POST" &&
    /^\/v2\/trades\/[^/]+\/promote$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const m = url.pathname.match(/^\/v2\/trades\/([^/]+)\/promote$/);
      const tradeRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!tradeRef)
        return json(res, 400, {
          ok: false,
          error: "sid (trade_id) is required",
        });
      const userId = uiEffectiveUserId(req, url, payload);
      const resolvedTrade = await mt5ResolveTradeRefV2(
        tradeRef,
        userId || null,
      );
      if (!resolvedTrade?.sid)
        return json(res, 404, { ok: false, error: "trade not found" });
      if (
        String(resolvedTrade.execution_status || "").toUpperCase() !== "DRAFT"
      )
        return json(res, 400, {
          ok: false,
          error: "Only Draft trades can be promoted",
        });
      const b = await mt5Backend();
      const rows = await dbQueries.promoteDraftTrade(
        b.db,
        resolvedTrade.sid,
        userId || null,
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return json(res, 404, { ok: false, error: "trade not found" });
      // Move trade folder from files to active (same as cTrader ack flow)
      moveTradeFolder(resolvedTrade.sid, "files", "active", resolvedTrade.symbol || row.symbol || "");
      await mt5Log(
        resolvedTrade.sid,
        "trades",
        { event_type: "TRADE_PROMOTED", from: "Draft", to: "PENDING" },
        row.userId || userId || CFG.mt5DefaultUserId,
      );
      return json(res, 200, { ok: true, item: row });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --- Trade file attachments ---

  if (
    req.method === "POST" &&
    /^\/v2\/trades\/[^/]+\/files\/upload$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url, null)) return;
    try {
      const m = url.pathname.match(/^\/v2\/trades\/([^/]+)\/files\/upload$/);
      const tradeRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!tradeRef)
        return json(res, 400, { ok: false, error: "trade sid is required" });
      const resolvedTrade = await mt5ResolveTradeRefV2(tradeRef, null);
      if (!resolvedTrade?.sid)
        return json(res, 404, { ok: false, error: "trade not found" });
      const sid = String(resolvedTrade.sid || "").trim();
      const sym = String(resolvedTrade.symbol || "").trim();

      const file = await parseMultipartFile(req);
      const dir = ensureTradeFilesDir(sid, sym);
      const destPath = path.join(dir, file.fileName);
      // If file already exists, append a timestamp suffix
      let finalPath = destPath;
      if (fs.existsSync(destPath)) {
        const ext = path.extname(file.fileName);
        const base = path.basename(file.fileName, ext);
        finalPath = path.join(dir, `${base}_${Date.now()}${ext}`);
      }
      fs.writeFileSync(finalPath, file.data);

      return json(res, 200, {
        ok: true,
        file: {
          name: path.basename(finalPath),
          size: file.data.length,
        },
      });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "GET" &&
    /^\/v2\/trades\/[^/]+\/files$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url, null)) return;
    try {
      const m = url.pathname.match(/^\/v2\/trades\/([^/]+)\/files$/);
      const tradeRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!tradeRef)
        return json(res, 400, { ok: false, error: "trade sid is required" });
      const resolvedTrade = await mt5ResolveTradeRefV2(tradeRef, null).catch(
        () => null,
      );
      if (!resolvedTrade?.sid) return json(res, 200, { ok: true, files: [] });
      const sid = String(resolvedTrade.sid || "").trim();
      const sym = String(resolvedTrade.symbol || "").trim();
      const dir = ensureTradeFilesDir(sid, sym);
      const files = [];
      if (fs.existsSync(dir)) {
        for (const entry of fs.readdirSync(dir)) {
          const abs = path.join(dir, entry);
          try {
            const st = fs.statSync(abs);
            if (st.isFile()) {
              files.push({ name: entry, size: st.size });
            }
          } catch {}
        }
      }
      return json(res, 200, { ok: true, files });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "DELETE" &&
    /^\/v2\/trades\/[^/]+\/files\/.+$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url, null)) return;
    try {
      const m = url.pathname.match(/^\/v2\/trades\/([^/]+)\/files\/(.+)$/);
      const tradeRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      const fileName = String(m?.[2] ? decodeURIComponent(m[2]) : "").trim();
      if (!tradeRef || !fileName)
        return json(res, 400, {
          ok: false,
          error: "trade sid and filename are required",
        });
      const resolvedTrade = await mt5ResolveTradeRefV2(tradeRef, null);
      if (!resolvedTrade?.sid)
        return json(res, 404, { ok: false, error: "trade not found" });
      const sid = String(resolvedTrade.sid || "").trim();
      const sym = String(resolvedTrade.symbol || "").trim();
      const safeName = path.basename(fileName);
      // Check both files dir and snapshots subdir
      let abs = path.join(ensureTradeFilesDir(sid, sym), safeName);
      if (!fs.existsSync(abs)) {
        abs = path.join(tradeSnapshotDir(sid, sym), safeName);
      }
      if (!fs.existsSync(abs))
        return json(res, 404, { ok: false, error: "file not found" });
      fs.unlinkSync(abs);
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Serve file content for preview/download
  if (
    req.method === "GET" &&
    /^\/v2\/trades\/[^/]+\/files\/.+\/content$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const m = url.pathname.match(
        /^\/v2\/trades\/([^/]+)\/files\/(.+)\/content$/,
      );
      const tradeRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      const fileName = String(m?.[2] ? decodeURIComponent(m[2]) : "").trim();
      if (!tradeRef || !fileName)
        return json(res, 400, {
          ok: false,
          error: "trade sid and filename are required",
        });
      const resolvedTrade = await mt5ResolveTradeRefV2(tradeRef, null);
      if (!resolvedTrade?.sid)
        return json(res, 404, { ok: false, error: "trade not found" });
      const sid = String(resolvedTrade.sid || "").trim();
      const sym = String(resolvedTrade.symbol || "").trim();
      const safeName = path.basename(fileName);
      const abs = path.join(ensureTradeFilesDir(sid, sym), safeName);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile())
        return json(res, 404, { ok: false, error: "file not found" });
      const ext = path.extname(safeName).toLowerCase();
      const mimeTypes = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".bmp": "image/bmp",
        ".ico": "image/x-icon",
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".json": "application/json",
        ".csv": "text/csv",
      };
      const contentType = mimeTypes[ext] || "application/octet-stream";
      const data = fs.readFileSync(abs);
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": data.length,
        "Cache-Control": "private, max-age=3600",
      });
      res.end(data);
      return;
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Chart-object persistence: save/load chart objects as JSON files in trade folder
  if (
    req.method === "POST" &&
    /^\/v2\/trades\/[^/]+\/chart-objects$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const m = url.pathname.match(/^\/v2\/trades\/([^/]+)\/chart-objects$/);
      const tradeRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!tradeRef)
        return json(res, 400, {
          ok: false,
          error: "sid (trade_id) is required",
        });
      const resolvedTrade = await mt5ResolveTradeRefV2(tradeRef, null).catch(
        () => null,
      );
      if (!resolvedTrade?.sid && !/^[A-Za-z0-9]{9}$/.test(tradeRef)) {
        return json(res, 404, { ok: false, error: "trade not found" });
      }
      const sid = String(resolvedTrade?.sid || tradeRef).trim();
      const sym = String(resolvedTrade?.symbol || payload?.symbol || "").trim();
      const objects = Array.isArray(payload?.objects) ? payload.objects : [];
      const filePath = chartObjectsPath(sid, sym);
      fs.writeFileSync(filePath, JSON.stringify(objects, null, 2));
      return json(res, 200, { ok: true, sid, objects });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Trade bars — priority: closed > active > market_data
  if (
    req.method === "GET" &&
    /^\/v2\/trades\/[^/]+\/bars$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const m = url.pathname.match(/^\/v2\/trades\/([^/]+)\/bars$/);
      const tradeRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      const tf = String(url.searchParams.get("tf") || "15");
      if (!tradeRef)
        return json(res, 400, { ok: false, error: "sid required" });

      const resolvedTrade = await mt5ResolveTradeRefV2(tradeRef, null).catch(
        () => null,
      );
      const sid = String(resolvedTrade?.sid || tradeRef).trim();
      const sym = String(resolvedTrade?.symbol || "").trim();
      const safeSid = sid.replace(/[^A-Za-z0-9_.-]/g, "_");
      const bars = readTradeBars(safeSid, tf, sym);
      return json(res, 200, { ok: true, sid, tf, bars });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "GET" &&
    /^\/v2\/trades\/[^/]+\/chart-objects$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const m = url.pathname.match(/^\/v2\/trades\/([^/]+)\/chart-objects$/);
      const tradeRef = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!tradeRef)
        return json(res, 400, { ok: false, error: "sid is required" });
      const resolvedTrade = await mt5ResolveTradeRefV2(tradeRef, null).catch(
        () => null,
      );
      if (!resolvedTrade?.sid && !/^[A-Za-z0-9]{9}$/.test(tradeRef)) {
        return json(res, 200, { ok: true, sid: tradeRef, objects: [] });
      }
      const sid = String(resolvedTrade?.sid || tradeRef).trim();
      const sym = String(resolvedTrade?.symbol || "").trim();
      const filePath = chartObjectsPath(sid, sym);
      let chartObjects = [];
      if (fs.existsSync(filePath)) {
        try {
          chartObjects = JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch {
          chartObjects = [];
        }
      }
      return json(res, 200, {
        ok: true,
        sid,
        objects: Array.isArray(chartObjects) ? chartObjects : [],
      });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/sources") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const name = String(payload?.name || "").trim();
      if (!name)
        return json(res, 400, { ok: false, error: "name is required" });
      const sourceId =
        String(payload?.source_id || "").trim() || mt5SlugId(name, "source");
      await mt5UpsertSourceV2({
        source_id: sourceId,
        name,
        kind: String(payload?.kind || "api"),
        auth_mode: String(payload?.auth_mode || "token"),
        auth_secret_hash: payload?.auth_secret_hash ?? null,
        is_active: normalizeUserActive(payload?.is_active, true),
        metadata:
          payload?.metadata && typeof payload.metadata === "object"
            ? payload.metadata
            : {},
      });
      const rows = await mt5ListSourcesV2();
      const created =
        (rows || []).find((r) => String(r.source_id || "") === sourceId) ||
        null;
      return json(res, 200, { ok: true, item: created, items: rows });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "PUT" && /^\/v2\/sources\/[^/]+$/.test(url.pathname)) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const m = url.pathname.match(/^\/v2\/sources\/([^/]+)$/);
      const sourceId = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!sourceId)
        return json(res, 400, { ok: false, error: "source_id is required" });
      const rowsBefore = await mt5ListSourcesV2();
      const prev = (rowsBefore || []).find(
        (r) => String(r.source_id || "") === sourceId,
      );
      if (!prev)
        return json(res, 404, { ok: false, error: "source not found" });

      await mt5UpsertSourceV2({
        source_id: sourceId,
        name: String(payload?.name ?? prev.name ?? sourceId),
        kind: String(payload?.kind ?? prev.kind ?? "api"),
        auth_mode: String(payload?.auth_mode ?? prev.auth_mode ?? "token"),
        auth_secret_hash:
          payload?.auth_secret_hash ?? prev.auth_secret_hash ?? null,
        is_active:
          payload?.is_active === undefined
            ? normalizeUserActive(prev.is_active, true)
            : normalizeUserActive(payload?.is_active, true),
        metadata:
          payload?.metadata && typeof payload.metadata === "object"
            ? payload.metadata
            : prev?.metadata && typeof prev.metadata === "object"
              ? prev.metadata
              : {},
      });
      const rows = await mt5ListSourcesV2();
      const updated =
        (rows || []).find((r) => String(r.source_id || "") === sourceId) ||
        null;
      return json(res, 200, { ok: true, item: updated, items: rows });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "GET" &&
    /^\/v2\/sources\/[^/]+\/events$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const m = url.pathname.match(/^\/v2\/sources\/([^/]+)\/events$/);
      const sourceId = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!sourceId)
        return json(res, 400, { ok: false, error: "source_id is required" });
      const limitRaw = Number(url.searchParams.get("limit") || 100);
      const limit = Math.max(
        1,
        Math.min(1000, Number.isFinite(limitRaw) ? limitRaw : 100),
      );
      const rows = await mt5ListSourceEventsV2(sourceId, limit);
      return json(res, 200, { ok: true, source_id: sourceId, items: rows });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "POST" &&
    /^\/v2\/sources\/[^/]+\/auth-secret\/rotate$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const m = url.pathname.match(
        /^\/v2\/sources\/([^/]+)\/auth-secret\/rotate$/,
      );
      const sourceId = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!sourceId)
        return json(res, 400, { ok: false, error: "source_id is required" });
      const out = await mt5RotateSourceSecretV2(sourceId);
      if (!out)
        return json(res, 404, {
          ok: false,
          error: "source not found or backend unsupported",
        });
      return json(res, 200, {
        ok: true,
        source_id: out.source_id,
        source_secret_plaintext: out.source_secret_plaintext,
        source_secret_last4: out.source_secret_last4 || null,
      });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "POST" &&
    /^\/v2\/sources\/[^/]+\/auth-secret\/revoke$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const m = url.pathname.match(
        /^\/v2\/sources\/([^/]+)\/auth-secret\/revoke$/,
      );
      const sourceId = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!sourceId)
        return json(res, 400, { ok: false, error: "source_id is required" });
      const out = await mt5RevokeSourceSecretV2(sourceId);
      if (!out?.ok)
        return json(res, 400, {
          ok: false,
          error: out?.error || "failed to revoke source secret",
        });
      return json(res, 200, { ok: true, source_id: sourceId });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "GET" &&
    /^\/v2\/accounts\/[^/]+\/subscriptions$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireAdminKey(req, res, url)) return;
    try {
      const m = url.pathname.match(/^\/v2\/accounts\/([^/]+)\/subscriptions$/);
      const accountId = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!accountId)
        return json(res, 400, { ok: false, error: "account_id is required" });
      const rows = await mt5GetAccountSubscriptionsV2(accountId);
      return json(res, 200, { ok: true, account_id: accountId, items: rows });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "PUT" &&
    /^\/v2\/accounts\/[^/]+\/subscriptions$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const m = url.pathname.match(/^\/v2\/accounts\/([^/]+)\/subscriptions$/);
      const accountId = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!accountId)
        return json(res, 400, { ok: false, error: "account_id is required" });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const out = await mt5ReplaceAccountSubscriptionsV2(accountId, items);
      if (!out?.ok)
        return json(res, 400, {
          ok: false,
          error: out?.error || "failed to update subscriptions",
        });
      const rows = await mt5GetAccountSubscriptionsV2(accountId);
      return json(res, 200, { ok: true, account_id: accountId, items: rows });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    (req.method === "POST" || req.method === "GET") &&
    /^\/(webhook\/)?v2\/broker\/pull$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!CFG.mt5V2BrokerApiEnabled)
      return json(res, 404, {
        ok: false,
        error: "v2026.05.09 19:31 - 728f356",
      });
    try {
      const payload = req.method === "POST" ? await readJson(req) : null;
      const account = await requireV2BrokerAccount(req, res, url, payload);
      if (!account) return;
      const maxItemsRaw = Number(
        payload?.max_items ??
          payload?.maxItems ??
          url.searchParams.get("max_items") ??
          url.searchParams.get("maxItems") ??
          1,
      );
      const maxItems = Math.max(
        1,
        Math.min(100, Number.isFinite(maxItemsRaw) ? maxItemsRaw : 1),
      );
      const leaseSeconds = Math.max(
        5,
        Math.min(
          300,
          Number.isFinite(CFG.mt5V2LeaseSeconds) ? CFG.mt5V2LeaseSeconds : 30,
        ),
      );
      const taskTypeFilter =
        payload?.task_type || url.searchParams.get("task_type") || "";
      // Extract source_id from account metadata
      let sourceId = null;
      try {
        const cache = account.source_ids_cache || account.metadata;
        if (cache) {
          const parsed = typeof cache === "string" ? JSON.parse(cache) : cache;
          sourceId = Array.isArray(parsed)
            ? parsed[0]
            : parsed?.source_id || null;
        }
      } catch (_) {}
      const items = await mt5PullLeasedTradesV2(
        account.account_id,
        maxItems,
        leaseSeconds,
        String(taskTypeFilter).trim() || null,
        sourceId,
      );
      const resp = {
        ok: true,
        items: (items || []).map((t) => {
          const type = syncGuards.brokerTaskTypeForTrade(t);
          const plannedLots =
            asNum(t.metadata?.volume_basis_lots) ??
            asNum(t.metadata?.trade_plan?.lots) ??
            asNum(t.metadata?.trade_plan?.volume) ??
            null;
          const brokerLots =
            asNum(t.broker_lots) ??
            asNum(t.metadata?.broker_lots) ??
            asNum(t.metadata?.broker_data?.lots) ??
            null;
          const taskLots =
            type === "MODIFY"
              ? plannedLots ?? asNum(t.volume) ?? brokerLots
              : asNum(t.volume) ?? plannedLots ?? brokerLots;
          return {
            sid: t.sid,
            type,
            ticket: t.broker_trade_id ?? null,
            lease_token: t.lease_token,
            lease_expires_at: t.lease_expires_at,
            account_id: t.account_id,
            signal_id: t.sid ?? null,
            source_id: t.source_id ?? null,
            symbol: t.symbol,
            action: t.action ?? t.side ?? null,
            entry: t.entry ?? t.intent_entry ?? null,
            order_type: mt5NormalizeOrderTypeValue(
              t.order_type || t.metadata?.order_type,
              "limit",
            ),
            sl: t.sl ?? t.intent_sl ?? null,
            tp: t.tp ?? t.intent_tp ?? null,
            tp1: t.tp1 ?? null,
            tp2: t.tp2 ?? null,
            tp3: t.tp3 ?? null,
            tp_targets: [t.tp1, t.tp2, t.tp3]
              .map((x) => mt5ParsePriceOrNull(x))
              .filter((x) => x != null),
            volume: taskLots ?? t.intent_volume ?? null,
            lots: taskLots ?? null,
            risk_money: t.risk_money_planned ?? null,
            risk_pct: t.risk_pct_planned ?? null,
            note: t.note ?? t.intent_note ?? null,
            metadata:
              t.metadata && typeof t.metadata === "object" ? t.metadata : {},
          };
        }),
      };
      if (resp.items.length > 0) {
        console.log(
          `[v2/broker/pull] aid=${account.account_id} items=${resp.items.length} types=${resp.items.map((i) => `${i.sid}=${i.type}`).join(",")}`,
        );
        console.log(
          `[v2/broker/pull] BODY[0]: ${JSON.stringify(resp.items[0])}`,
        );
      } else {
        console.log(`[v2/broker/pull] aid=${account.account_id} items=0`);
      }
      return json(res, 200, resp);
    } catch (error) {
      console.error(
        "[v2/broker/pull] ERROR",
        error instanceof Error ? error.message : String(error),
      );
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "POST" &&
    /^\/(webhook\/)?v2\/broker\/ack$/.test(url.pathname)
  ) {
    console.log(`[v2/broker/ack] REQUEST from ${ip}`);
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!CFG.mt5V2BrokerApiEnabled)
      return json(res, 404, {
        ok: false,
        error: "v2026.05.09 19:31 - 728f356",
      });
    try {
      const payload = await readJson(req);
      const account = await requireV2BrokerAccount(req, res, url, payload);
      if (!account) return;
      const tradeId = String(payload.trade_id || "").trim();
      const leaseToken = String(payload.lease_token || "").trim();
      if (!tradeId || !leaseToken) {
        return json(res, 400, {
          ok: false,
          error: "sid and lease_token are required",
        });
      }
      const result = await mt5AckTradeV2(account.account_id, payload);
      if (!result?.ok)
        return json(res, 409, {
          ok: false,
          error: result?.error || "ack failed",
        });
      return json(res, 200, {
        ok: true,
        duplicate: Boolean(result.duplicate),
        dispatch_status: result.dispatch_status,
        execution_status: result.execution_status,
      });
    } catch (error) {
      console.error(
        "[v2/broker/ack] ERROR",
        error instanceof Error ? error.message : String(error),
      );
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --- Ticket 1: Coverage API (GET /v2/broker/symbols) ---
  if (req.method === "GET" && url.pathname === "/v2/broker/symbols") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const symbolParam = (url.searchParams.get("symbol") || "")
        .trim()
        .toUpperCase();
      const symbolsParam = (url.searchParams.get("symbols") || "")
        .trim()
        .toUpperCase();
      const groupParam = (url.searchParams.get("group") || "")
        .trim()
        .toLowerCase();

      let mode = "all";
      let resolvedSymbols = [];
      if (symbolsParam) {
        mode = "symbols";
        resolvedSymbols = symbolsParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (symbolParam) {
        mode = "symbol";
        resolvedSymbols = [symbolParam];
      } else if (groupParam === "watchlist") {
        mode = "group";
        const account = await requireV2BrokerAccount(req, res, url);
        if (!account) return;
        const uid = String(account.user_id || CFG.mt5DefaultUserId).trim();
        const wl = (await repoGetUserWatchlist(uid).catch(() => [])) || [];
        resolvedSymbols = wl.map((s) => String(s).toUpperCase());
      } else {
        mode = "all";
        const dataDir = path.join(GLOBAL_DATA_DIR, "market_data");
        if (fs.existsSync(dataDir)) {
          resolvedSymbols = fs
            .readdirSync(dataDir)
            .filter((d) => fs.statSync(path.join(dataDir, d)).isDirectory())
            .filter((d) => fs.existsSync(path.join(dataDir, d, "bars")))
            .map((d) => d.toUpperCase())
            .sort();
        }
      }

      if (!resolvedSymbols.length) {
        return json(res, 200, {
          ok: true,
          mode,
          filters: {
            symbol: symbolParam || null,
            symbols: symbolsParam ? resolvedSymbols : null,
            group: groupParam || null,
            default: "all",
          },
          items: [],
        });
      }

      const TFS = ["1", "5", "15", "60", "240", "1440"];
      const items = [];
      for (const sym of resolvedSymbols) {
        const barsInfo = [];
        for (const tf of TFS) {
          const bars = readBrokerBarsFromCsv(sym, tf, 0);
          const existing = bars.length;
          barsInfo.push({
            tf,
            existing_bars: existing,
            bars_number: Math.max(existing, 500),
            start: existing > 0 ? bars[0].time : null,
            end: existing > 0 ? bars[existing - 1].time : null,
          });
        }
        items.push({ symbol: sym, bars_info: barsInfo });
      }
      return json(res, 200, {
        ok: true,
        mode,
        filters: {
          symbol: symbolParam || null,
          symbols: symbolsParam ? resolvedSymbols : null,
          group: groupParam || null,
          default: "all",
        },
        items,
      });
    } catch (error) {
      console.error(
        "[v2/broker/symbols] ERROR",
        error instanceof Error ? error.message : String(error),
      );
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --- Price tick push (POST /v2/broker/prices) ---
  if (
    req.method === "POST" &&
    /^\/(webhook\/)?v2\/broker\/prices$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const payload = await readJson(req);
      const account = await requireV2BrokerAccount(req, res, url, payload);
      if (!account) return;
      const ticks = Array.isArray(payload.p) ? payload.p : [];
      let stored = 0;
      for (const t of ticks) {
        const sym = String(t.s || "").trim();
        const bid = Number(t.b);
        const ask = Number(t.a);
        if (!sym || !Number.isFinite(bid) || !Number.isFinite(ask)) continue;
        brokerPriceCache[sym] = { bid, ask, ts: Date.now() };
        stored++;
      }
      if (stored > 0) lastBrokerPricePush = Date.now();
      return json(res, 200, {
        ok: true,
        stored,
        source: payload.source_id || null,
      });
    } catch (error) {
      console.error(
        "[v2/broker/prices] ERROR",
        error instanceof Error ? error.message : String(error),
      );
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --- Ticket 2: Incremental prices sync (POST /v2/broker/prices-sync) ---
  if (req.method === "POST" && url.pathname === "/v2/broker/prices-sync") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const payload = await readJson(req);
      const account = await requireV2BrokerAccount(req, res, url, payload);
      if (!account) return;
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (!items.length)
        return json(res, 200, {
          ok: true,
          sync_id: genTraceId("sync_"),
          summary: {
            items: 0,
            received: 0,
            inserted: 0,
            duplicated: 0,
            rejected: 0,
          },
          results: [],
        });

      const syncId = genTraceId("sync_");
      let totalReceived = 0,
        totalInserted = 0,
        totalDuplicated = 0,
        totalRejected = 0;
      const results = [];

      for (const item of items) {
        const sym = normalizeMarketDataSymbol(item.symbol);
        const tf = String(item.tf || "").trim();
        const bars = Array.isArray(item.bars) ? item.bars : [];
        if (!sym || !tf) {
          results.push({
            symbol: item.symbol,
            tf,
            received: 0,
            inserted: 0,
            duplicated: 0,
            rejected: bars.length,
            reject_reason: "invalid_symbol_or_tf",
          });
          totalRejected += bars.length;
          continue;
        }

        const normalizedBars = [];
        let itemReceived = 0,
          itemInserted = 0,
          itemDuplicated = 0,
          itemRejected = 0,
          latestTs = null;

        for (const bar of bars) {
          const t = Number(bar.time ?? bar.t);
          const o = Number(bar.open ?? bar.o);
          const h = Number(bar.high ?? bar.h);
          const l = Number(bar.low ?? bar.l);
          const c = Number(bar.close ?? bar.c);
          const v = Number(bar.volume ?? bar.v);
          if (
            !Number.isFinite(t) ||
            !Number.isFinite(o) ||
            !Number.isFinite(h) ||
            !Number.isFinite(l) ||
            !Number.isFinite(c)
          ) {
            itemRejected++;
            continue;
          }
          itemReceived++;
          normalizedBars.push({
            time: Math.floor(t),
            open: o,
            high: h,
            low: l,
            close: c,
            volume: Number.isFinite(v) ? v : 0,
          });
          if (!latestTs || t > latestTs) latestTs = t;
        }

        // mergeBarsIntoCSV returns count of NEW bars inserted (deduplicates by time)
        const added = mergeBarsIntoCSV(sym, tf, normalizedBars);
        itemInserted = added;
        itemDuplicated = normalizedBars.length - added;

        totalReceived += itemReceived;
        totalInserted += itemInserted;
        totalDuplicated += itemDuplicated;
        totalRejected += itemRejected;
        results.push({
          symbol: sym,
          tf,
          received: itemReceived,
          inserted: itemInserted,
          duplicated: itemDuplicated,
          rejected: itemRejected,
          latest_timestamp_after_sync: latestTs,
        });
        if (itemInserted > 0) {
          await upsertSymbolActivity(sym, {
            bars: {
              last_time: new Date().toISOString(),
              tf: String(tf || ""),
              inserted: itemInserted,
              duplicated: itemDuplicated,
              rejected: itemRejected,
              latest_timestamp_after_sync: latestTs || null,
            },
          });
        }
      }

      if (totalInserted > 0) {
        await mt5Log(
          account.account_id,
          "accounts",
          {
            event: "PRICES_SYNC",
            sync_id: syncId,
            source_id: payload.source_id || "unknown",
            inserted: totalInserted,
            duplicated: totalDuplicated,
            rejected: totalRejected,
          },
          account.user_id || CFG.mt5DefaultUserId,
        );
      }

      return json(res, 200, {
        ok: true,
        sync_id: syncId,
        summary: {
          items: items.length,
          received: totalReceived,
          inserted: totalInserted,
          duplicated: totalDuplicated,
          rejected: totalRejected,
        },
        results,
      });
    } catch (error) {
      console.error(
        "[v2/broker/prices-sync] ERROR",
        error instanceof Error ? error.message : String(error),
      );
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/broker/bars") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const payload = await readJson(req);
      if (!(await requireEaKey(req, res, url, payload))) return;
      const { inserted } = await ingestBrokerBarsPayload(payload);
      return json(res, 200, { ok: true, inserted });
    } catch (error) {
      console.error(
        "[v2/broker/bars] ERROR",
        error instanceof Error ? error.message : String(error),
      );
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "POST" &&
    /^\/(webhook\/)?(v2\/broker\/(sync|reconcile)|mt5\/ea\/sync-v2)$/.test(
      url.pathname,
    )
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!CFG.mt5V2BrokerApiEnabled)
      return json(res, 404, {
        ok: false,
        error: "v2026.05.09 19:31 - 728f356",
      });
    try {
      const payload = await readJson(req);
      const account = await requireV2BrokerAccount(req, res, url, payload);
      if (!account) return;
      const result = await mt5BrokerSyncV2(account.account_id, payload || {});
      const statusCode = result?.ok ? 200 : 400;
      console.log(
        `[v2/broker/sync] aid=${account.account_id} items=${(payload.items || []).length} results=${(result.results || []).length}`,
      );
      return json(res, statusCode, result);
    } catch (error) {
      const formatted = formatBrokerSyncError(error);
      console.error("[v2/broker/sync] failed", {
        message: error instanceof Error ? error.message : String(error),
        formatted,
        code: error?.code || null,
        table: error?.table || null,
        constraint: error?.constraint || null,
        detail: error?.detail || null,
        stack: error instanceof Error ? error.stack : null,
      });
      return json(res, 400, {
        ok: false,
        error: formatted,
      });
    }
  }

  if (
    req.method === "POST" &&
    /^\/(webhook\/)?v2\/broker\/heartbeat$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!CFG.mt5V2BrokerApiEnabled)
      return json(res, 404, {
        ok: false,
        error: "v2026.05.09 19:31 - 728f356",
      });
    try {
      const payload = await readJson(req);
      const account = await requireV2BrokerAccount(req, res, url, payload);
      if (!account) return;
      const result = await mt5BrokerHeartbeatV2(
        account.account_id,
        payload || {},
      );
      const statusCode = result?.ok ? 200 : 400;
      return json(res, statusCode, result);
    } catch (error) {
      console.error(
        "[v2/broker/heartbeat] ERROR",
        error instanceof Error ? error.message : String(error),
      );
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "GET" &&
    /^\/(webhook\/)?v2\/broker\/tracked-symbols$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const account = await requireV2BrokerAccount(req, res, url);
      if (!account) return;
      const uid = String(account.user_id || CFG.mt5DefaultUserId).trim();
      const watchlist = (await repoGetUserWatchlist(uid).catch(() => [])) || [];
      // Merge: positions/orders from latest sync + watchlist
      const accMeta = account.metadata || {};
      const posSymbols = [];
      try {
        const b = await mt5Backend();
        const tradesRes = await b.listTradesV2({
          userId: uid,
          accountId: account.account_id,
          pageSize: 200,
          executionStatus: ["FILLED", "PENDING"],
        });
        for (const t of tradesRes.items || []) {
          if (t.symbol && !posSymbols.includes(t.symbol.toUpperCase()))
            posSymbols.push(t.symbol.toUpperCase());
        }
      } catch {}
      const watchlistSymbols = watchlist
        .map((s) => String(s).trim().toUpperCase())
        .filter(Boolean)
        .filter((s) => {
          if (posSymbols.includes(s)) return true;
          const barsDir = path.join(BROKER_BARS_DIR, s, "bars");
          return fs.existsSync(barsDir);
        });
      const droppedWatchlist = watchlist
        .map((s) => String(s).trim().toUpperCase())
        .filter(Boolean)
        .filter(
          (s) => !watchlistSymbols.includes(s) && !posSymbols.includes(s),
        );
      const merged = [...new Set([...posSymbols, ...watchlistSymbols])].sort();
      return json(res, 200, {
        ok: true,
        symbols: merged,
        sources: {
          positions: posSymbols,
          watchlist: watchlistSymbols,
          dropped_watchlist: droppedWatchlist,
        },
      });
    } catch (error) {
      console.error(
        "[v2/broker/tracked-symbols] ERROR",
        error instanceof Error ? error.message : String(error),
      );
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "POST" &&
    /^\/(webhook\/)?v2\/broker\/prices$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const payload = await readJson(req);
      const account = await requireV2BrokerAccount(req, res, url, payload);
      if (!account) return;
      const prices = Array.isArray(payload.p) ? payload.p : [];
      const ts = Number(payload.ts || Math.floor(Date.now() / 1000));
      if (!prices.length) return json(res, 200, { ok: true, updated: 0 });

      const t0 = Date.now();
      // L1 memory patch
      const iso = new Date(ts * 1000).toISOString();
      for (const p of prices) {
        const s = normalizeMarketDataSymbol(p.s);
        if (!s) continue;
        const b = Number(p.b);
        const a = Number(p.a);
        if (!Number.isFinite(b) || !Number.isFinite(a)) continue;
        const mid = (b + a) / 2;
        const key = marketDataCacheKey(s);
        const root = MARKET_DATA_MEMORY_CACHE.get(key);
        if (root && Array.isArray(root.data)) {
          for (const tfEntry of root.data) {
            tfEntry.last_price = mid;
            tfEntry.last_price_at = iso;
          }
          root.updated_time = Math.floor(Date.now() / 1000);
        }
      }

      // 3. Async Redis flush (fire-and-forget)
      getRedisClient()
        .then(async (client) => {
          if (!client) return;
          for (const p of prices) {
            const s = normalizeMarketDataSymbol(p.s);
            if (!s) continue;
            const b = Number(p.b);
            const a = Number(p.a);
            if (!Number.isFinite(b) || !Number.isFinite(a)) continue;
            const mid = (b + a) / 2;
            const key = marketDataCacheKey(s);
            try {
              const raw = await client.get(key).catch(() => "");
              let root = null;
              if (raw) {
                try {
                  root = JSON.parse(raw);
                } catch {}
              }
              if (root && Array.isArray(root.data)) {
                for (const tfEntry of root.data) {
                  tfEntry.last_price = mid;
                  tfEntry.last_price_at = iso;
                }
                root.updated_time = Math.floor(Date.now() / 1000);
                await client
                  .setEx(key, 3600, JSON.stringify(root))
                  .catch(() => {});
              }
            } catch {}
          }
        })
        .catch(() => {});

      // 4. Log event + SSE via notification manager
      const elapsed = Date.now() - t0;
      const uid = account.user_id || CFG.mt5DefaultUserId;
      const symbolsArr = prices.map((p) => String(p.s || "").toUpperCase());
      await mt5Log(
        account.account_id,
        "accounts",
        {
          event: "PRICE_PUSH",
          source_id: payload.source_id || "unknown",
          symbol_count: prices.length,
          symbols: symbolsArr,
          elapsed_ms: elapsed,
        },
        uid,
      );

      // 5. Update account metadata with last price push info
      try {
        const backend = await mt5Backend();
        const { eq } = require("drizzle-orm");
        const schema = backend.schema || require("../db/schema");
        const existingAcct = await backend.db
          .select({ metadata: schema.userAccounts.metadata })
          .from(schema.userAccounts)
          .where(eq(schema.userAccounts.accountId, account.account_id))
          .limit(1);
        const existingMeta =
          dbQueries.parseJsonField(existingAcct[0]?.metadata) || {};
        const mergedMeta = {
          ...existingMeta,
          last_price_push_at: new Date().toISOString(),
          last_price_push_symbols: prices.length,
          last_price_push_source: payload.source_id || "unknown",
          last_price_push_elapsed_ms: elapsed,
        };
        await backend.db
          .update(schema.userAccounts)
          .set({
            metadata: dbQueries.jsonField(mergedMeta),
            updatedAt: new Date(),
          })
          .where(eq(schema.userAccounts.accountId, account.account_id));
      } catch (e) {
        console.error("[broker/prices] metadata update failed:", e);
      }

      return json(res, 200, {
        ok: true,
        updated: prices.length,
        elapsed_ms: elapsed,
      });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "POST" &&
    /^\/(webhook\/)?v2\/broker\/bars$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const payload = await readJson(req);
      if (!(await requireEaKey(req, res, url, payload))) return;
      const { inserted } = await ingestBrokerBarsPayload(payload);
      return json(res, 200, { ok: true, stored: inserted });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "GET" &&
    /^\/(webhook\/)?v2\/broker\/prices\/status$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const account = await requireV2BrokerAccount(req, res, url);
      if (!account) return;
      const db = await mt5Backend();
      // Latest price push no longer tracked via DB logs table
      const latestPricePush = null;
      // Get a sample of updated prices from memory cache
      const recentPrices = [];
      for (const [key, root] of MARKET_DATA_MEMORY_CACHE) {
        if (!root || typeof root !== "object" || !Array.isArray(root.data))
          continue;
        for (const tfEntry of root.data) {
          if (tfEntry.last_price_at) {
            recentPrices.push({
              symbol: root.symbol || key,
              last_price: tfEntry.last_price,
              tf: tfEntry.tf || root.tf || "unknown",
              at: tfEntry.last_price_at,
            });
          }
        }
      }
      recentPrices.sort((a, b) =>
        (b.last_price_at || "").localeCompare(a.last_price_at || ""),
      );
      const topPrices = recentPrices.slice(0, 10);
      return json(res, 200, {
        ok: true,
        account_id: account.account_id,
        last_push: latestPricePush
          ? {
              at: latestPricePush.created_at,
              metadata: latestPricePush.metadata,
            }
          : null,
        recent_prices: topPrices,
      });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "POST" &&
    /^\/(webhook\/)?v2\/broker\/trades\/create$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!CFG.mt5V2BrokerApiEnabled)
      return json(res, 404, {
        ok: false,
        error: "v2026.05.09 19:31 - 728f356",
      });
    try {
      const payload = await readJson(req);
      const account = await requireV2BrokerAccount(req, res, url, payload);
      if (!account) return;
      const result = await mt5CreateBrokerTradeV2(
        account.account_id,
        payload || {},
      );
      const statusCode = result?.ok ? 200 : 400;
      return json(res, statusCode, result);
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "POST" &&
    /^\/v2\/accounts\/[^/]+\/api-key\/rotate$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const m = url.pathname.match(
        /^\/v2\/accounts\/([^/]+)\/api-key\/rotate$/,
      );
      const accountId = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!accountId)
        return json(res, 400, { ok: false, error: "account_id is required" });
      const rotated = await mt5RotateAccountApiKeyV2(accountId);
      if (!rotated)
        return json(res, 404, {
          ok: false,
          error: "account not found or backend unsupported",
        });
      return json(res, 200, {
        ok: true,
        account_id: rotated.account_id,
        api_key_plaintext: rotated.api_key_plaintext,
      });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    req.method === "POST" &&
    /^\/v2\/accounts\/[^/]+\/api-key\/revoke$/.test(url.pathname)
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    let payload = {};
    try {
      payload = await readJson(req);
    } catch {}
    if (!requireAdminKey(req, res, url, payload)) return;
    try {
      const m = url.pathname.match(
        /^\/v2\/accounts\/([^/]+)\/api-key\/revoke$/,
      );
      const accountId = String(m?.[1] ? decodeURIComponent(m[1]) : "").trim();
      if (!accountId)
        return json(res, 400, { ok: false, error: "account_id is required" });
      const out = await mt5RevokeAccountApiKeyV2(accountId);
      if (!out?.ok)
        return json(res, 400, {
          ok: false,
          error: out?.error || "failed to revoke api key",
        });
      return json(res, 200, { ok: true, account_id: accountId });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/ea/trades/sync-bulk") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const payload = await readJson(req);
      if (!(await requireEaKey(req, res, url, payload))) return;
      const updates = payload.updates || [];
      if (!Array.isArray(updates))
        return json(res, 400, { ok: false, error: "updates array required" });
      const b = await mt5Backend();
      let updatedCount = 0;
      let unmatchedCount = 0;
      for (const u of updates) {
        const ticketCandidates = mt5TicketCandidates(u);
        const ticket = ticketCandidates[0] || "";
        const signalId = String(u.sid || "").trim();
        if (!ticketCandidates.length && !signalId) continue;
        const stRaw = String(
          u.status || u.execution_status || "CLOSED",
        ).toUpperCase();
        const execStatus = ["TP", "SL", "CLOSED"].includes(stRaw)
          ? "CLOSED"
          : ["CANCEL", "CANCELLED", "EXPIRED"].includes(stRaw)
            ? "CANCELLED"
            : stRaw === "FAIL"
              ? "REJECTED"
              : stRaw;
        const pnl = Number(u.pnl ?? u.profit ?? 0);
        const closeTime = mt5SyncTime(u.closed_at ?? u.close_time ?? u.time);
        const closeReason = mt5CloseReasonFromSync(u);
        const accountId = String(
          payload.account_id || u.account_id || "",
        ).trim();
        const syncMeta = JSON.stringify({
          broker_ticket_candidates: ticketCandidates,
          broker_position_id:
            u.position_ticket || u.position_id || ticket || null,
          deal_ticket: u.deal_ticket || u.deal_id || null,
          order_ticket: u.order_ticket || u.order_id || null,
          close_reason: closeReason,
          last_sync_source: "ea_bulk_history",
        });

        const { and, eq, or, ne, inArray } = require("drizzle-orm");
        const schema = b.schema || require("../db/schema");

        // Build base conditions
        const baseConds = [ne(schema.trades.executionStatus, "CANCELLED")];
        if (accountId) baseConds.push(eq(schema.trades.accountId, accountId));

        // First try matching on broker_trade_id or signal_id (non-JSONB criteria)
        const orConds = [
          inArray(schema.trades.brokerTradeId, ticketCandidates),
        ];
        if (signalId) orConds.push(eq(schema.trades.signalId, signalId));

        let matchRow = null;
        const directMatches = await b.db
          .select()
          .from(schema.trades)
          .where(and(...baseConds, or(...orConds)))
          .limit(1);
        if (directMatches.length) {
          matchRow = directMatches[0];
        } else {
          // Try matching via metadata JSON fields
          const allRows = await b.db
            .select()
            .from(schema.trades)
            .where(and(...baseConds))
            .limit(200);
          const metaMatch = allRows.find((r) => {
            const m = dbQueries.parseJsonField(r.metadata) || {};
            return (
              ticketCandidates.includes(m.broker_position_id) ||
              ticketCandidates.includes(String(m.position_ticket)) ||
              ticketCandidates.includes(String(m.deal_ticket)) ||
              ticketCandidates.includes(String(m.order_ticket))
            );
          });
          if (metaMatch) matchRow = metaMatch;
        }

        if (matchRow) {
          // Merge metadata in JS
          const existingMeta =
            dbQueries.parseJsonField(matchRow.metadata) || {};
          const incomingMeta = JSON.parse(syncMeta);
          const mergedMeta = { ...existingMeta, ...incomingMeta };

          const resUpd = await b.db
            .update(schema.trades)
            .set({
              executionStatus: execStatus,
              pnlRealized: pnl,
              closedAt: matchRow.closedAt || closeTime || new Date(),
              closeReason: closeReason || matchRow.closeReason,
              symbol: u.symbol || matchRow.symbol,
              volume: u.volume || matchRow.volume,
              orderType: u.order_type || matchRow.orderType,
              brokerTradeId: ticket || matchRow.brokerTradeId,
              metadata: dbQueries.jsonField(mergedMeta),
              updatedAt: new Date(),
            })
            .where(eq(schema.trades.sid, matchRow.sid))
            .returning({
              sid: schema.trades.sid,
              userId: schema.trades.userId,
            });

          updatedCount++;
          const row = resUpd[0];
          await b.log(
            row.sid,
            "trades",
            {
              event: "TRADE_SYNC_UPDATE",
              ticket,
              ticket_candidates: ticketCandidates,
              status_raw: stRaw,
              execution_status: execStatus,
              close_reason: closeReason,
              pnl,
              source: "ea_bulk_sync",
            },
            row.userId || CFG.mt5DefaultUserId,
          );
        } else {
          unmatchedCount++;
          await b.log(
            signalId || ticket || "unknown",
            "trades",
            {
              event: "TRADE_SYNC_UNMATCHED",
              ticket,
              ticket_candidates: ticketCandidates,
              account_id: accountId || null,
              symbol: u.symbol || null,
              volume: u.volume || null,
              pnl,
              source: "ea_bulk_sync",
            },
            CFG.mt5DefaultUserId,
          );
        }
      }
      return json(res, 200, {
        ok: true,
        updated: updatedCount,
        unmatched: unmatchedCount,
      });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (
    req.method === "POST" &&
    (url.pathname === "/v2/ea/log" || url.pathname === "/mt5/ea/log-v2")
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const payload = await readJson(req);
      if (!(await requireEaKey(req, res, url, payload))) return;
      const accountId = String(payload.account_id || "unknown");
      const level = String(payload.level || "INFO").toUpperCase();
      const message = String(payload.message || "");
      const b = await mt5Backend();
      if (b.log) {
        await b.log(
          accountId,
          "ea",
          { event: "EA", level, message, account_id: accountId },
          CFG.mt5DefaultUserId,
        );
      }
      console.log(`[EA LOG] [${accountId}] [${level}] ${message}`);
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/mt5/ea/pull") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!(await requireEaKey(req, res, url))) return;

    const signalId = String(url.searchParams.get("signal_id") || "").trim();
    const account = String(url.searchParams.get("account") || "");
    const b = await mt5Backend();
    const task = await b.pullAndLockNextTask(account);
    if (!task) {
      return json(res, 200, { ok: true, task: null, signal: null });
    }
    const taskId = task.task_id || task.sid;
    await mt5AppendSignalEvent(taskId, "TASK_FETCH", {
      type: task.type,
      account: account || null,
    });

    // Flatten task for EA compatibility (top-level fields)
    return json(res, 200, {
      ok: true,
      ...task,
      // Backward compatibility
      signal: task.type === "OPEN" ? task : null,
    });
  }

  if (req.method === "POST" && url.pathname === "/mt5/ea/heartbeat") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const payload = await readJson(req);
      if (!(await requireEaKey(req, res, url, payload))) return;

      const accountId = String(payload.account_id || "");
      if (!accountId) {
        return json(res, 400, { ok: false, error: "account_id is required" });
      }

      const now = mt5NowIso();
      const b = await mt5Backend();
      if (b.brokerHeartbeatV2) {
        await b.brokerHeartbeatV2(accountId, {
          equity: payload.equity,
          free_margin: payload.free_margin || payload.margin,
          name: payload.account_name,
          broker_type: "mt5_legacy",
          now: payload.now || now,
        });
      }

      console.log(`[MT5 Heartbeat] Account=${accountId} Eq=${payload.equity}`);
      return json(res, 200, { ok: true, message: "heartbeat_received" });
    } catch (err) {
      console.error("[Webhook] EA heartbeat error:", err);
      return json(res, 500, { ok: false, error: "internal server error" });
    }
  }

  if (req.method === "POST" && url.pathname === "/mt5/ea/ack") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    try {
      const payload = await readJson(req);
      if (!(await requireEaKey(req, res, url, payload))) return;

      const status = mt5NormalizeAckStatus(payload.status);

      const signalId = String(payload.sid || "");
      if (!signalId) {
        return json(res, 400, {
          ok: false,
          error: "sid (signal_id) is required",
        });
      }

      const sig = await mt5FindSignalById(signalId);
      if (!sig) {
        return json(res, 404, { ok: false, error: "signal not found" });
      }

      const pnlRealized = asNum(
        payload.pnl_money_realized ?? payload.pnl ?? payload.profit,
        NaN,
      );
      const entryExecRaw = asNum(
        payload.entry_price_exec ?? payload.entry,
        NaN,
      );
      const slExecRaw = asNum(payload.sl_exec ?? payload.sl, NaN);
      const tpExecRaw = asNum(payload.tp_exec ?? payload.tp, NaN);
      const entryExec =
        Number.isFinite(entryExecRaw) && entryExecRaw > 0.0
          ? entryExecRaw
          : NaN;
      const slExec =
        Number.isFinite(slExecRaw) && slExecRaw > 0.0 ? slExecRaw : NaN;
      const tpExec =
        Number.isFinite(tpExecRaw) && tpExecRaw > 0.0 ? tpExecRaw : NaN;
      // Pip/lot telemetry from EA
      const slPipsFromPayload = asNum(payload.sl_pips, NaN);
      const tpPipsFromPayload = asNum(payload.tp_pips, NaN);
      const pipValuePerLotFromPayload = asNum(payload.pip_value_per_lot, NaN);
      const riskMoneyActualFromPayload = asNum(payload.risk_money_actual, NaN);
      const rewardMoneyPlannedFromPayload = asNum(
        payload.reward_money_planned,
        NaN,
      );
      const ackResult =
        payload.result ?? payload.retcode ?? payload.code ?? null;
      const ackMessage =
        payload.message ?? payload.msg ?? payload.comment ?? null;
      const ackNote = payload.note ?? payload.reason ?? null;

      // Smart Parsing: If direct fields are missing, try to extract from note string (e.g., risk$=100.29)
      const noteStr = String(ackNote || "").toLowerCase();
      let riskMoneyActual = riskMoneyActualFromPayload;
      if (!Number.isFinite(riskMoneyActual)) {
        const m = noteStr.match(/risk\$=([\d.]+)/);
        if (m) riskMoneyActual = parseFloat(m[1]);
      }
      let slPips = slPipsFromPayload;
      if (!Number.isFinite(slPips)) {
        const m = noteStr.match(/sl_pips=([\d.]+)/); // Hypothetical, but we can add more patterns
        if (m) slPips = parseFloat(m[1]);
      }

      const tpPips = tpPipsFromPayload;
      const pipValuePerLot = pipValuePerLotFromPayload;
      const rewardMoneyPlanned = rewardMoneyPlannedFromPayload;

      const ackSummary = [ackResult, ackMessage, ackNote]
        .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
        .join(" | ");
      const ackErrorCombined =
        [payload.error, ackSummary]
          .filter(
            (v) => v !== null && v !== undefined && String(v).trim() !== "",
          )
          .join(" | ") || null;
      const retryableConnectivityFail = mt5IsRetryableConnectivityFail(
        status,
        ackErrorCombined,
      );

      await mt5AckSignal(signalId, status, payload.ticket, ackErrorCombined, {
        pnl_money_realized: Number.isFinite(pnlRealized) ? pnlRealized : null,
        entry_price_exec: Number.isFinite(entryExec) ? entryExec : null,
        sl_exec: Number.isFinite(slExec) ? slExec : null,
        tp_exec: Number.isFinite(tpExec) ? tpExec : null,
        sl_pips: Number.isFinite(slPips) && slPips > 0 ? slPips : null,
        tp_pips: Number.isFinite(tpPips) && tpPips > 0 ? tpPips : null,
        pip_value_per_lot:
          Number.isFinite(pipValuePerLot) && pipValuePerLot > 0
            ? pipValuePerLot
            : null,
        risk_money_actual:
          Number.isFinite(riskMoneyActual) && riskMoneyActual > 0
            ? riskMoneyActual
            : null,
        reward_money_planned:
          Number.isFinite(rewardMoneyPlanned) && rewardMoneyPlanned > 0
            ? rewardMoneyPlanned
            : null,
      });
      const eventType = retryableConnectivityFail
        ? "SIGNAL_EA_REQUEUE"
        : `SIGNAL_EA_ACK_${status}`;
      await mt5AppendSignalEvent(signalId, eventType, {
        ticket: payload.ticket ?? null,
        error: ackErrorCombined,
        result: ackResult,
        message: ackMessage,
        note: ackNote,
        retryable: retryableConnectivityFail,
        pnl_money_realized: Number.isFinite(pnlRealized) ? pnlRealized : null,
        entry_price_exec: Number.isFinite(entryExec) ? entryExec : null,
        sl_exec: Number.isFinite(slExec) ? slExec : null,
        tp_exec: Number.isFinite(tpExec) ? tpExec : null,
        sl_pips: Number.isFinite(slPips) && slPips > 0 ? slPips : null,
        tp_pips: Number.isFinite(tpPips) && tpPips > 0 ? tpPips : null,
        pip_value_per_lot:
          Number.isFinite(pipValuePerLot) && pipValuePerLot > 0
            ? pipValuePerLot
            : null,
        risk_money_actual:
          Number.isFinite(riskMoneyActual) && riskMoneyActual > 0
            ? riskMoneyActual
            : null,
        reward_money_planned:
          Number.isFinite(rewardMoneyPlanned) && rewardMoneyPlanned > 0
            ? rewardMoneyPlanned
            : null,
      });

      if (status === "TP" || status === "SL") {
        try {
          const model = mt5EntryModelFromRow(sig);
          const tf = sig.signal_tf || sig.chart_tf || "n/a";
          const pnlStr = Number.isFinite(pnlRealized)
            ? pnlRealized >= 0
              ? `+$${pnlRealized.toFixed(2)}`
              : `-$${Math.abs(pnlRealized).toFixed(2)}`
            : "n/a";
          const telMsg = `[${sig.symbol}, ${sig.action}, ${signalId}, ${pnlStr}, ${model}, ${tf}, ${status}]`;
          await sendTelegram(telMsg);
        } catch (telErr) {
          console.error(
            "[Webhook] Telegram notification failed for TP/SL:",
            telErr,
          );
        }
      }

      if (status === "SL_CHANGED" || status === "PARTIAL_CLOSE") {
        try {
          const b2 = await mt5Backend();
          if (status === "SL_CHANGED" && Number.isFinite(slExec)) {
            await b2.pool.query(
              `UPDATE trades SET sl = COALESCE($2::numeric, sl), tp = COALESCE($3::numeric, tp), updated_at = NOW() WHERE sid = $1::text AND execution_status IN ('FILLED','PENDING')`,
              [
                signalId,
                slExec > 0 ? slExec : null,
                tpExec > 0 ? tpExec : null,
              ],
            );
            await mt5Log(signalId, "trades", {
              event: "SL_CHANGED",
              sl_exec: Number.isFinite(slExec) ? slExec : null,
              tp_exec: Number.isFinite(tpExec) ? tpExec : null,
              ticket: payload.ticket || null,
            });
          }
          if (status === "PARTIAL_CLOSE") {
            await mt5Log(signalId, "trades", {
              event: "PARTIAL_CLOSE",
              pnl_realized: Number.isFinite(pnlRealized) ? pnlRealized : null,
              ticket: payload.ticket || null,
              note: ackNote || null,
            });
          }
        } catch (e) {
          console.error(
            "[Webhook] SL_CHANGED/PARTIAL_CLOSE trade update failed:",
            e,
          );
        }
      }

      if (status === "FAIL") {
        // Broker rejected the trade (e.g. SL/TP too close) — cancel trade with error
        try {
          const b2 = await mt5Backend();
          const failReason =
            ackErrorCombined || ackMessage || "broker rejected";
          await b2.pool.query(
            `UPDATE trades SET execution_status = 'CANCEL', close_reason = $2, closed_at = COALESCE(closed_at, NOW()) WHERE sid = $1::text`,
            [signalId, failReason],
          );
          await mt5Log(signalId, "trades", {
            event: "TRADE_FAILED",
            error: failReason,
            ticket: payload.ticket || null,
          });
        } catch (e) {
          console.error("[Webhook] FAIL trade update failed:", e);
        }
      }

      return json(res, 200, {
        ok: true,
        signal_id: signalId,
        status,
        requeued: retryableConnectivityFail,
        ack: {
          ticket: payload.ticket ?? null,
          result: ackResult,
          message: ackMessage,
          note: ackNote,
          error: ackErrorCombined,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "POST" && isTvWebhookPath(url.pathname)) {
    try {
      const payload = await readJson(req);
      if (!requireTvAuth(req, res, url, payload)) return;

      const result = await handleSignal(payload);
      return json(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      try {
        await sendTelegram(`Signal processing failed: ${message}`);
      } catch {
        // ignore nested telegram failure
      }
      return json(res, 400, { ok: false, error: message });
    }
  }

  return json(res, 404, { ok: false, error: "Not found" });
};

async function start() {
  if (CFG.uiAuthEnabled) {
    const auth = await uiEnsureAuthBootstrap();
    console.log(
      `UI auth enabled=true, user=${auth.email}, storage=${(await mt5Backend()).storage}`,
    );
  } else {
    console.log("UI auth enabled=false");
  }

  if (CFG.mt5Enabled) {
    const b = await mt5Backend();
    const where = b.info.path || b.info.url || "configured";
    console.log(
      `MT5 bridge enabled=true, storage=${b.storage}, target=${where}`,
    );
    if (CFG.mt5PruneEnabled) {
      const safeDays = Math.max(
        1,
        Math.min(
          3650,
          Number.isFinite(CFG.mt5PruneDays) ? CFG.mt5PruneDays : 14,
        ),
      );
      const safeMins = Math.max(
        1,
        Math.min(
          1440,
          Number.isFinite(CFG.mt5PruneIntervalMinutes)
            ? CFG.mt5PruneIntervalMinutes
            : 60,
        ),
      );
      const runPrune = async () => {
        try {
          const out = await mt5PruneSignals(safeDays);
          if (out.removed > 0) {
            console.log(
              `MT5 prune removed=${out.removed}, remaining=${out.remaining}, days=${safeDays}`,
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`MT5 prune failed: ${msg}`);
        }
      };
      await runPrune();
      const handle = setInterval(runPrune, safeMins * 60 * 1000);
      handle.unref();
      console.log(
        `MT5 prune enabled=true, days=${safeDays}, intervalMinutes=${safeMins}`,
      );
    } else {
      console.log("MT5 prune enabled=false");
    }
  } else {
    console.log("MT5 bridge enabled=false");
  }

  function loadTlsOptions() {
    if (!CFG.httpsEnabled) return null;
    if (!CFG.httpsKeyPath || !CFG.httpsCertPath) {
      throw new Error(
        "HTTPS_ENABLED=true requires HTTPS_KEY_PATH and HTTPS_CERT_PATH",
      );
    }
    const keyPath = path.resolve(__dirname, CFG.httpsKeyPath);
    const certPath = path.resolve(__dirname, CFG.httpsCertPath);
    if (!fs.existsSync(keyPath))
      throw new Error(`HTTPS key file not found: ${keyPath}`);
    if (!fs.existsSync(certPath))
      throw new Error(`HTTPS cert file not found: ${certPath}`);
    const out = {
      key: fs.readFileSync(keyPath, "utf8"),
      cert: fs.readFileSync(certPath, "utf8"),
    };
    if (CFG.httpsCaPath) {
      const caPath = path.resolve(__dirname, CFG.httpsCaPath);
      if (!fs.existsSync(caPath))
        throw new Error(`HTTPS CA file not found: ${caPath}`);
      out.ca = fs.readFileSync(caPath, "utf8");
    }
    return out;
  }

  function attachClientErrorHandler(server) {
    server.on("clientError", (_err, socket) => {
      if (!socket) return;
      try {
        if (socket.writable)
          socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      } catch {
        // ignore
      }
      try {
        socket.destroy();
      } catch {}
    });
  }

  if (CFG.httpsEnabled) {
    const tlsOptions = loadTlsOptions();
    const httpsServer = https.createServer(tlsOptions, appHandler);
    attachClientErrorHandler(httpsServer);
    await new Promise((resolve, reject) => {
      httpsServer.once("error", reject);
      httpsServer.listen(CFG.httpsPort, "0.0.0.0", resolve);
    });
    console.log(
      `telegram-trading-bot listening on https://0.0.0.0:${CFG.httpsPort}`,
    );

    if (CFG.httpsRedirectHttp) {
      const httpRedirectServer = http.createServer((req, res) => {
        const hostHeader = String(req.headers.host || "localhost").replace(
          /:\d+$/,
          "",
        );
        const targetHost =
          CFG.httpsPort === 443 ? hostHeader : `${hostHeader}:${CFG.httpsPort}`;
        const location = `https://${targetHost}${req.url || "/"}`;
        res.writeHead(308, { Location: location });
        res.end();
      });
      attachClientErrorHandler(httpRedirectServer);
      await new Promise((resolve, reject) => {
        httpRedirectServer.once("error", reject);
        httpRedirectServer.listen(CFG.port, "0.0.0.0", resolve);
      });
      console.log(
        `HTTP redirect enabled on http://0.0.0.0:${CFG.port} -> https://0.0.0.0:${CFG.httpsPort}`,
      );
    }
  } else {
    const httpServer = http.createServer(appHandler);
    attachClientErrorHandler(httpServer);
    await new Promise((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.setTimeout(180000);
      httpServer.listen(CFG.port, "0.0.0.0", resolve);
    });
    console.log(`telegram-trading-bot listening on http://0.0.0.0:${CFG.port}`);
  }

  if (CFG.mt5Enabled) {
    // Start Cron Loop
    initMarketDataQueue();
    initAiAnalysisCronQueue();
    initSnapshotsCronQueue();
    mt5CronLoop().catch((err) =>
      console.error("[Cron] Loop failed to start:", err),
    );
  }

  console.log(
    `Binance mode=${CFG.binanceMode || "off"}, cTrader mode=${CFG.ctraderMode || "off"}`,
  );
}

const SOURCE_STATUS = {
  ctrader: {
    lastActivity: null,
    connected: false,
    enabled: CFG.ctraderEnabled,
  },
  mt5: { lastActivity: null, connected: false, enabled: CFG.mt5Enabled },
  binance: {
    lastActivity: null,
    connected: false,
    enabled: CFG.binanceEnabled,
  },
};
const CRON_STATE = {
  lastMarketDataRun: {}, // { [userId_name]: timestamp }
  lastAiAnalysisRun: {}, // { [userId_name]: timestamp }
  lastSnapshotsRun: {}, // { [userId_name]: timestamp }
  isRunning: false,
  masterActive: true,
};
let MARKET_DATA_QUEUE = null;
let MARKET_DATA_WORKER = null;
let SNAPSHOTS_CRON_QUEUE = null;
let SNAPSHOTS_CRON_WORKER = null;
let AI_ANALYSIS_CRON_QUEUE = null;
let AI_ANALYSIS_CRON_WORKER = null;

async function getBullmqStatus() {
  const queueName = "market-data-bars";
  const base = {
    ok: false,
    enabled: Boolean(
      CFG.marketDataCronEnabled &&
      CFG.marketDataCronQueueEnabled &&
      CFG.redisEnabled &&
      BullQueue &&
      BullWorker,
    ),
    queue_name: queueName,
    queue_initialized: Boolean(MARKET_DATA_QUEUE),
    worker_initialized: Boolean(MARKET_DATA_WORKER),
    redis_enabled: Boolean(CFG.redisEnabled),
    redis_url: CFG.redisUrl || "",
    counts: {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    },
    workers: [],
    error: null,
  };
  if (!base.enabled) return base;
  let queue = MARKET_DATA_QUEUE;
  let shouldClose = false;
  try {
    if (!queue) {
      queue = new BullQueue(queueName, {
        connection: bullConnectionFromRedisUrl(CFG.redisUrl),
      });
      shouldClose = true;
    }
    base.counts = await queue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
      "paused",
    );
    if (typeof queue.getWorkers === "function") {
      const workers = await queue.getWorkers();
      base.workers = Array.isArray(workers)
        ? workers.map((w) => ({
            id: w.id || "",
            addr: w.addr || "",
            name: w.name || "",
            age: Number(w.age || 0),
          }))
        : [];
    }
    base.ok = true;
    return base;
  } catch (error) {
    base.error = error instanceof Error ? error.message : String(error);
    return base;
  } finally {
    if (shouldClose && queue && typeof queue.close === "function") {
      try {
        await queue.close();
      } catch {}
    }
  }
}

function bullConnectionFromRedisUrl(redisUrl) {
  try {
    const u = new URL(redisUrl);
    return {
      host: u.hostname || "127.0.0.1",
      port: Number(u.port || 6379),
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      db:
        u.pathname && u.pathname !== "/" ? Number(u.pathname.slice(1)) || 0 : 0,
      maxRetriesPerRequest: null,
    };
  } catch {
    return { host: "127.0.0.1", port: 6379, maxRetriesPerRequest: null };
  }
}

function sanitizeBullJobIdPart(value) {
  return String(value || "default")
    .replace(/[:\s]+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 80);
}

function trackSourceActivity(sourceId, connected = true) {
  const key = String(sourceId || "").toLowerCase();
  if (!SOURCE_STATUS[key]) return;
  SOURCE_STATUS[key].lastActivity = new Date().toISOString();
  SOURCE_STATUS[key].connected = connected;
  SOURCE_STATUS[key].enabled = true;
}
function marketDataCronSettingEnabled(data = {}) {
  return asBool(data.enabled ?? true, true);
}

function marketDataCronTimezone(data = {}) {
  return normalizeMarketDataTimezone(
    data.timezone || CFG.marketDataDefaultTimezone,
  );
}

async function marketDataUpdateCronState({
  userId,
  settingName,
  symbol,
  tf,
  patch,
}) {
  const b = await mt5Backend();
  const key = `${normalizeMarketDataSymbol(symbol)}:${normalizeMarketDataTf(tf)}`;
  const setting = await dbQueries.getUserSetting(
    b.db,
    userId,
    "cron",
    settingName,
  );
  if (!setting) return;
  const data =
    setting.data && typeof setting.data === "object" ? setting.data : {};
  const sync =
    data.last_sync && typeof data.last_sync === "object" ? data.last_sync : {};
  sync[key] = { ...(sync[key] || {}), ...patch };
  await dbQueries.upsertUserSetting(
    b.db,
    userId,
    "cron",
    settingName,
    { ...data, last_sync: sync },
    "ACTIVE",
  );
}

async function marketDataFetchJob({
  userId,
  settingName,
  symbol,
  tf,
  timezone,
}) {
  const cronTraceId = genTraceId("cron_md_");
  if (notificationManager) {
    notificationManager.handle("SYSTEM_EVENT", "cron_md", {
      message: `Market data cron: ${symbol} ${tf}`,
      symbol,
      tf,
    });
  }
  const symbolNorm = normalizeMarketDataSymbol(symbol);
  const tfNorm = normalizeMarketDataTf(tf);
  if (!symbolNorm || !tfNorm)
    return { ok: false, reason: "invalid_symbol_or_tf" };
  try {
    const snapshot = await buildAnalysisSnapshotFromTwelve({
      userId,
      payload: {
        bars: CFG.marketDataChunkMaxBars,
        force_refresh: true,
        timezone: normalizeMarketDataTimezone(timezone),
        setting_name: settingName || "default",
      },
      symbol,
      timeframe: tf,
    });
    if (snapshot?.status === "ok")
      return {
        ok: true,
        symbol: symbolNorm,
        tf: tfNorm,
        bars: snapshot.bars?.length || 0,
      };
    await marketDataUpdateCronState({
      userId,
      settingName,
      symbol,
      tf,
      patch: {
        last_error_at: new Date().toISOString(),
        last_error: snapshot?.reason || "fetch_failed",
      },
    }).catch(() => {});
    return {
      ok: false,
      symbol: symbolNorm,
      tf: tfNorm,
      reason: snapshot?.reason || "fetch_failed",
    };
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : String(err || "fetch_failed");
    await marketDataUpdateCronState({
      userId,
      settingName,
      symbol,
      tf,
      patch: {
        last_error_at: new Date().toISOString(),
        last_error: reason,
      },
    }).catch(() => {});
    throw err;
  }
}

function initMarketDataQueue() {
  if (
    !CFG.marketDataCronEnabled ||
    !CFG.marketDataCronQueueEnabled ||
    !CFG.redisEnabled ||
    !BullQueue ||
    !BullWorker
  ) {
    console.log(`[Cron][MarketData] queue enabled=false`);
    return false;
  }
  if (MARKET_DATA_QUEUE || MARKET_DATA_WORKER) return true;
  const connection = bullConnectionFromRedisUrl(CFG.redisUrl);
  MARKET_DATA_QUEUE = new BullQueue("market-data-bars", {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    },
  });
  MARKET_DATA_WORKER = new BullWorker(
    "market-data-bars",
    async (job) => {
      return marketDataFetchJob(job.data || {});
    },
    { connection, concurrency: CFG.marketDataCronConcurrency },
  );
  MARKET_DATA_WORKER.on("failed", (job, err) => {
    console.error(
      `[Cron][MarketData] job failed id=${job?.id || ""}: ${err?.message || err}`,
    );
  });
  console.log(
    `[Cron][MarketData] BullMQ enabled=true concurrency=${CFG.marketDataCronConcurrency}`,
  );
  return true;
}

function initSnapshotsCronQueue() {
  if (!CFG.redisEnabled || !BullQueue || !BullWorker) {
    console.log(`[Cron][Snapshots] queue enabled=false`);
    return false;
  }
  if (SNAPSHOTS_CRON_QUEUE || SNAPSHOTS_CRON_WORKER) return true;
  const connection = bullConnectionFromRedisUrl(CFG.redisUrl);
  SNAPSHOTS_CRON_QUEUE = new BullQueue("snapshots-cron", {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    },
  });
  const concurrency = Math.max(
    1,
    Math.min(4, Math.round(asNum(process.env.SNAPSHOTS_CRON_CONCURRENCY, 1))),
  );
  SNAPSHOTS_CRON_WORKER = new BullWorker(
    "snapshots-cron",
    async () => mt5RunSnapshotsCronInline(),
    { connection, concurrency },
  );
  SNAPSHOTS_CRON_WORKER.on("failed", (job, err) => {
    console.error(
      `[Cron][Snapshots] BullMQ job failed id=${job?.id || ""}: ${err?.message || err}`,
    );
  });
  console.log(
    `[Cron][Snapshots] BullMQ enabled=true concurrency=${concurrency}`,
  );
  return true;
}

function initAiAnalysisCronQueue() {
  if (!CFG.redisEnabled || !BullQueue || !BullWorker) {
    console.log(`[Cron][AiAnalysis] queue enabled=false`);
    return false;
  }
  if (AI_ANALYSIS_CRON_QUEUE || AI_ANALYSIS_CRON_WORKER) return true;
  const connection = bullConnectionFromRedisUrl(CFG.redisUrl);
  AI_ANALYSIS_CRON_QUEUE = new BullQueue("ai-analysis-cron", {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    },
  });
  const concurrency = Math.max(
    1,
    Math.min(4, Math.round(asNum(process.env.AI_ANALYSIS_CRON_CONCURRENCY, 1))),
  );
  AI_ANALYSIS_CRON_WORKER = new BullWorker(
    "ai-analysis-cron",
    async () => mt5RunAiAnalysisCronInline(),
    { connection, concurrency },
  );
  AI_ANALYSIS_CRON_WORKER.on("failed", (job, err) => {
    console.error(
      `[Cron][AiAnalysis] BullMQ job failed id=${job?.id || ""}: ${err?.message || err}`,
    );
  });
  console.log(
    `[Cron][AiAnalysis] BullMQ enabled=true concurrency=${concurrency}`,
  );
  return true;
}

async function mt5RunSnapshotsCronInline() {
  const b = await mt5Backend();
  const rows = await dbQueries.listUserSettingsByType(b.db, null, "cron");
  const configs = (rows || []).filter((r) => {
    const d = dbQueries.parseJsonField(r.data) || {};
    return (
      ["SNAPSHOTS_CRON", "SNAPSHOT_CRON"].includes(d.cron_type) &&
      String(r.status || "").toUpperCase() === "ACTIVE"
    );
  });
  if (!configs.length) return null;
  const now = Date.now();
  const summary = {
    configs: 0,
    captured: 0,
    skipped: 0,
    symbols: [],
    errors: [],
  };
  for (const conf of configs) {
    const userId = conf.userId;
    const data = dbQueries.parseJsonField(conf.data) || {};
    if (!asBool(data.enabled ?? true, true)) continue;
    summary.configs++;
    const symbols = resolveCronSymbols(data);
    const excludeSymbols = new Set(
      (Array.isArray(data.exclude_symbols) ? data.exclude_symbols : [])
        .map((s) => String(s).toUpperCase().trim())
        .filter(Boolean),
    );
    const filteredSymbols = symbols.filter(
      (s) => !excludeSymbols.has(String(s).toUpperCase().trim()),
    );
    const tfs = Array.isArray(data.timeframes) ? data.timeframes : [];
    if (!filteredSymbols.length || !tfs.length) continue;
    const cadenceSec = Number(data.cadence_seconds || 3600);
    const schedule = String(data.schedule || "").trim();
    const batchSize = Math.max(1, Number(data.symbols_per_tick || 1));
    const stateKey = `${userId}_${conf.name}`;
    const lastRun = CRON_STATE.lastSnapshotsRun[stateKey] || 0;

    let shouldRun = false;
    if (schedule) {
      shouldRun = cronScheduleShouldRun(schedule, now, lastRun);
    }
    if (!shouldRun && !schedule) {
      if (now - lastRun < cadenceSec * 1000 - 5000) {
        summary.skipped++;
        continue;
      }
    }
    // Round-robin: rotate through symbols across ticks
    const rrKey = `${userId}_${conf.name}_rr`;
    let rrIdx = CRON_STATE.lastSnapshotsRun[rrKey] || 0;
    if (rrIdx >= filteredSymbols.length) rrIdx = 0;
    const tickSymbols = filteredSymbols.slice(rrIdx, rrIdx + batchSize);
    CRON_STATE.lastSnapshotsRun[rrKey] =
      (rrIdx + batchSize) % filteredSymbols.length;
    console.log(
      `[Cron][Snapshots] Running userId=${userId} name=${conf.name} symbols=${tickSymbols.length}/${filteredSymbols.length} (batch ${Math.floor(rrIdx / batchSize) + 1})`,
    );
    CRON_STATE.lastSnapshotsRun[stateKey] = now;
    try {
      const startedAt = Date.now();
      const broker = String(data.broker || "");
      const results = await captureTradingViewSnapshotsBatch({
        symbols: tickSymbols,
        timeframes: tfs,
        provider: broker,
        lookbackBars: Number(data.lookback_bars || 200),
        format: String(data.format || "png"),
        quality: Number(data.quality || 90),
        theme: String(data.theme || "dark"),
        width: Number(data.width || 1200),
        height: Number(data.height || 800),
        userId,
      });
      const created = [];
      if (Array.isArray(results)) {
        for (const r of results) {
          if (r && r.status === "ok") {
            summary.captured++;
            summary.symbols.push(`${r.symbol || "?"}:${r.timeframe || "?"}`);
            created.push({
              symbol: r.symbol || "",
              timeframe: r.timeframe || "",
              file_name: r.file_name || "",
              url: r.url || "",
            });
            await updateHealthActivity("SNAPSHOT", String(r.symbol || ""), {
              status: "ok",
              message: `${r.symbol || "?"} ${r.timeframe || ""}`,
              timeframe: r.timeframe || "",
              file_name: r.file_name || "",
              url: r.url || "",
              cron_name: conf.name,
            });
            await upsertSymbolActivity(String(r.symbol || ""), {
              snapshot: {
                last_time: new Date().toISOString(),
                timeframe: r.timeframe || "",
                file_name: r.file_name || "",
                url: r.url || "",
                cron_name: conf.name,
              },
            });
          }
        }
      }
      const createdSymbols = created
        .map((x) =>
          String(x.symbol || "")
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean);
      await updateHealthActivity(
        "CRON",
        String(conf.name || "SNAPSHOTS_CRON"),
        {
          status: "ok",
          message: `completed ${createdSymbols.join(", ") || "0 symbols"}`,
          user_id: userId,
          cron_type: String(data.cron_type || "SNAPSHOTS_CRON"),
          broker: broker || null,
          tick_symbols: tickSymbols,
          all_symbols_count: filteredSymbols.length,
          timeframes: Array.isArray(tfs) ? tfs : [],
          created_count: created.length,
          created,
          duration_ms: Date.now() - startedAt,
        },
      );
      notificationManager.handle("CRON_SNAPSHOT", "completed", {
        user_id: userId,
        event: "cron_snapshot",
        message: `Snapshots: ${created.length} symbols (${createdSymbols.slice(0, 3).join(", ")}${createdSymbols.length > 3 ? "..." : ""})`,
        type: "info",
        notification: true,
        symbols: createdSymbols,
        cron_name: String(conf.name || "SNAPSHOTS_CRON"),
        created_count: created.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(msg);
      await updateHealthActivity(
        "CRON",
        String(conf.name || "SNAPSHOTS_CRON"),
        {
          status: "error",
          message: msg,
          user_id: userId,
          cron_type: String(data.cron_type || "SNAPSHOTS_CRON"),
          broker: String(data.broker || "") || null,
          tick_symbols: tickSymbols,
          all_symbols_count: filteredSymbols.length,
          timeframes: Array.isArray(tfs) ? tfs : [],
          created_count: 0,
          created: [],
          errors: [msg],
        },
      );
      notificationManager.handle("CRON_SNAPSHOT", "failed", {
        user_id: userId,
        event: "cron_snapshot",
        message: `Snapshots FAILED (${String(conf.name || "SNAPSHOTS_CRON")}): ${msg}`,
        type: "error",
        notification: true,
        cron_name: String(conf.name || "SNAPSHOTS_CRON"),
        error: msg,
      });
      console.error(`[Cron][Snapshots] Failed userId=${userId}:`, msg);
    }
  }
  return summary;
}
async function mt5RunSnapshotsCron() {
  const queueReady = Boolean(SNAPSHOTS_CRON_QUEUE && SNAPSHOTS_CRON_WORKER);
  if (!queueReady) return mt5RunSnapshotsCronInline();
  try {
    const bucket = Math.floor(Date.now() / 60000);
    await SNAPSHOTS_CRON_QUEUE.add(
      "run-snapshots-cron",
      { bucket },
      { jobId: `snapshots_cron_${bucket}` },
    );
    return { queued: 1 };
  } catch (err) {
    console.error(
      `[Cron][Snapshots] BullMQ enqueue failed, fallback inline: ${err?.message || err}`,
    );
    return mt5RunSnapshotsCronInline();
  }
}
async function mt5CronLoop() {
  console.log("[Cron] Initializing master loop (1min cadence)");
  const intervalMs = 60 * 1000;
  global._cronStatus = "running";

  const run = async () => {
    if (!CRON_STATE.masterActive) {
      global._cronStatus = "paused";
      return;
    }
    if (CRON_STATE.isRunning) return;
    CRON_STATE.isRunning = true;
    const startMs = Date.now();
    const events = [];
    global._cronDetails = global._cronDetails || {};

    // Run each cron independently — one hanging won't block others
    const runOne = async (name, fn, okLabel) => {
      const t0 = Date.now();
      try {
        const res = await Promise.race([
          fn(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 300000),
          ),
        ]);
        const elapsed = Math.round((Date.now() - t0) / 1000);
        if (res) {
          global._cronDetails[name] = `ok (${elapsed}s, ${okLabel(res)})`;
          events.push(`${name}: done`);
        } else {
          global._cronDetails[name] = "no configs";
          events.push(`${name}: skipped`);
        }
      } catch (e) {
        global._cronDetails[name] = `error: ${e.message}`;
        events.push(`${name}: ERROR`);
        console.error(`[Cron] ${name} error:`, e.message);
      }
    };

    const cronTasks = [
      runOne(
        "marketData",
        mt5RunMarketDataCron,
        (r) => `${r.queued || 0} jobs`,
      ),
      runOne(
        "aiAnalysis",
        mt5RunAiAnalysisCron,
        (r) => `${r.triggered || 0} trig`,
      ),
    ];
    if (CFG.snapshotsCronEnabled) {
      cronTasks.push(
        runOne(
          "snapshots",
          mt5RunSnapshotsCron,
          (r) => `${r.captured || 0} img`,
        ),
      );
    } else {
      global._cronDetails.snapshots = "disabled";
      events.push("snapshots: disabled");
    }
    await Promise.all(cronTasks);

    const elapsed = Math.round((Date.now() - startMs) / 1000);
    global._cronStatus = `ok (${elapsed}s)`;
    global._cronEvents = global._cronEvents || [];
    global._cronEvents.unshift({
      time: new Date().toISOString(),
      elapsed,
      events,
      status: "ok",
    });
    if (global._cronEvents.length > 20) global._cronEvents.length = 20;
    if (notificationManager) {
      notificationManager.handle("SYSTEM_EVENT", "cron_tick", {
        message: `Cron OK (${elapsed}s): ${events.join("; ")}`,
        user_id: "*",
        ticker: true,
        console_log: true,
        notification: false,
        _force_ticker: true,
        metadata: {
          elapsed_sec: elapsed,
          events,
          details: global._cronDetails,
        },
      });
    }
    CRON_STATE.isRunning = false;
  };

  // Run immediately then on interval
  run();
  const handle = setInterval(run, intervalMs);
  handle.unref();
}

async function mt5RunMarketDataCron() {
  if (!CFG.marketDataCronEnabled) return;
  const b = await mt5Backend();
  const rows = await dbQueries.listUserSettingsByType(b.db, null, "cron");
  const configs = (rows || []).filter((r) => {
    const d = dbQueries.parseJsonField(r.data) || {};
    return (
      d.cron_type === "MARKET_DATA_CRON" &&
      String(r.status || "").toUpperCase() === "ACTIVE"
    );
  });
  if (!configs.length) return { triggered: 0 };

  const now = Date.now();

  for (const conf of configs) {
    const userId = conf.userId;
    const data = dbQueries.parseJsonField(conf.data) || {};
    if (!marketDataCronSettingEnabled(data)) continue;
    const symbols = resolveCronSymbols(data);
    const excludeSymbols = new Set(
      (Array.isArray(data.exclude_symbols) ? data.exclude_symbols : [])
        .map((s) => String(s).toUpperCase().trim())
        .filter(Boolean),
    );
    const filteredSymbols = symbols.filter(
      (s) => !excludeSymbols.has(String(s).toUpperCase().trim()),
    );
    const tfs = Array.isArray(data.timeframes) ? data.timeframes : [];
    if (!filteredSymbols.length || !tfs.length) continue;
    const timezone = marketDataCronTimezone(data);

    // Cadence: use cadence_seconds from config, fall back to first TF period
    const defaultCadence = tfs.length ? parseTfTokenToSeconds(tfs[0]) : 60;
    const cadenceSec = Number(data.cadence_seconds || defaultCadence);
    const schedule = String(data.schedule || "").trim();
    const stateKey = `${userId}_${conf.name}`;
    const lastRun = CRON_STATE.lastMarketDataRun[stateKey] || 0;

    let shouldRun = false;
    if (schedule) {
      shouldRun = cronScheduleShouldRun(schedule, now, lastRun);
    }
    if (!shouldRun && !schedule) {
      if (now - lastRun < cadenceSec * 1000 - 5000) continue;
    }

    CRON_STATE.lastMarketDataRun[stateKey] = now;

    for (const tf of tfs) {
      const tfSec = parseTfTokenToSeconds(tf);

      console.log(
        `[Cron][MarketData] Running userId=${userId} name=${conf.name} tf=${tf} symbols=${filteredSymbols.length}`,
      );

      // Batch symbols to avoid hitting Twelve Data limits
      const batchSize =
        Number(data.batch_size || CFG.marketDataCronBatchSize) || 8;
      for (let i = 0; i < filteredSymbols.length; i += batchSize) {
        const batch = filteredSymbols.slice(i, i + batchSize);
        if (MARKET_DATA_QUEUE) {
          const bucket = Math.floor(now / (tfSec * 1000));
          const results = await Promise.allSettled(
            batch.map((symbol) => {
              const symbolNorm = normalizeMarketDataSymbol(symbol);
              const tfNorm = normalizeMarketDataTf(tf);
              const jobId = `market_${sanitizeBullJobIdPart(userId)}_${sanitizeBullJobIdPart(conf.name || "default")}_${sanitizeBullJobIdPart(symbolNorm)}_${sanitizeBullJobIdPart(tfNorm)}_${sanitizeBullJobIdPart(bucket)}`;
              return MARKET_DATA_QUEUE.add(
                "fetch-bars",
                {
                  userId,
                  settingName: conf.name || "default",
                  symbol,
                  tf,
                  timezone,
                },
                { jobId },
              );
            }),
          );
          const failed = results.filter((r) => r.status === "rejected");
          if (failed.length) {
            console.error(
              `[Cron][MarketData] BullMQ add failed for ${failed.length} symbols: ${failed.map((f) => f.reason?.message || String(f.reason)).join("; ")}`,
            );
          }
        } else {
          await Promise.all(
            batch.map(async (symbol) => {
              try {
                await marketDataFetchJob({
                  userId,
                  settingName: conf.name || "default",
                  symbol,
                  tf,
                  timezone,
                });
              } catch (err) {
                console.error(
                  `[Cron][MarketData] Failed symbol=${symbol} tf=${tf}:`,
                  err.message,
                );
              }
            }),
          );
        }
      }
      await marketDataUpdateCronState({
        userId,
        settingName: conf.name || "default",
        symbol: "_cron",
        tf,
        patch: {
          timezone,
          queued_at: new Date().toISOString(),
          symbols_count: filteredSymbols.length,
          batch_size: batchSize,
          queue: MARKET_DATA_QUEUE ? "bullmq" : "inline",
        },
      }).catch(() => {});
    }
  }
  return { queued: 1 };
}

async function mt5RunAiAnalysisCronInline() {
  const b = await mt5Backend();
  const rows = await dbQueries.listUserSettingsByType(b.db, null, "cron");
  const configs = (rows || []).filter((r) => {
    const d = dbQueries.parseJsonField(r.data) || {};
    return (
      d.cron_type === "ANALYSIS_CRON" &&
      String(r.status || "").toUpperCase() === "ACTIVE"
    );
  });
  if (!configs.length) return { triggered: 0 };

  const now = Date.now();
  let triggered = 0;
  for (const conf of configs) {
    const userId = conf.userId;
    const data = dbQueries.parseJsonField(conf.data) || {};
    const confName = String(conf.name || "ANALYSIS_CRON");
    const symbols = resolveCronSymbols(data);
    const tfs = Array.isArray(data.timeframes) ? data.timeframes : [];
    const cadenceSec = Number(data.cadence_seconds || 3600);
    const schedule = String(data.schedule || "").trim();

    const stateKey = `${userId}_${conf.name}`;
    const lastRun = CRON_STATE.lastAiAnalysisRun[stateKey] || 0;

    // Check if this cron should run now
    let shouldRun = false;
    const hasSchedule = schedule && schedule.startsWith("at ");
    if (hasSchedule) {
      // Event mode: strict — only fire at scheduled time, no fallback
      shouldRun = cronScheduleShouldRun(schedule, now, lastRun);
    } else {
      // Interval mode: cadence-based
      if (now - lastRun >= cadenceSec * 1000 - 5000) {
        shouldRun = true;
      }
    }

    if (shouldRun) {
      console.log(
        `[Cron][AiAnalysis] Running userId=${userId} name=${conf.name} symbols=${symbols.length}`,
      );
      CRON_STATE.lastAiAnalysisRun[stateKey] = now;

      // Pickup mode: "random" picks 1 random symbol, "all" (default) runs all
      const pickupMode = String(data.pickup_mode || "all").toLowerCase();
      const runSymbols =
        pickupMode === "random"
          ? [symbols[Math.floor(Math.random() * symbols.length)]]
          : symbols;
      if (pickupMode === "random") {
        console.log(
          `[Cron][AiAnalysis] Random pickup: selected ${runSymbols[0]} from ${symbols.length} symbols`,
        );
      }

      for (const symbol of runSymbols) {
        // Call the same manual AI analyze endpoint — no code duplication.
        // When no custom prompt is in cron config, the endpoint will use
        // the rich system.md guide as default (same as manual UI).
        try {
          const runTimeframes = tfs.length ? tfs : ["D", "4H", "15m", "5m"];
          const forceRefreshSnapshots =
            data.refresh_snapshot === true || data.snapshot_refresh === true;
          let shouldRefreshSnapshots = forceRefreshSnapshots;
          if (!shouldRefreshSnapshots) {
            const recent = findRecentChartSnapshots({
              symbol,
              provider: String(data.broker || "ICMARKETS"),
              timeframes: runTimeframes,
              maxAgeMs: 5 * 60 * 1000,
            });
            shouldRefreshSnapshots =
              !Array.isArray(recent.items) ||
              recent.items.length < recent.target_timeframes.length;
          }
          if (shouldRefreshSnapshots) {
            await captureTradingViewSnapshotsBatch({
              symbol,
              provider: String(data.broker || "ICMARKETS"),
              timeframes: runTimeframes,
              lookbackBars: Number(data.lookback_bars || 300),
              format: "png",
              quality: 70,
              theme: "dark",
              merge_snapshots: false,
            });
          }
          const analyzePayload = JSON.stringify({
            symbol,
            timeframes: runTimeframes,
            model: data.model || "claude-sonnet-4-0",
            auto_save: data.auto_save || "trades",
            prompt: data.prompt || "",
            profile: data.profile || "",
            provider: data.broker || "ICMARKETS",
            snapshot_refresh: shouldRefreshSnapshots,
          });
          const http = require("http");
          const { statusCode, body } = await new Promise((resolve, reject) => {
            const req = http.request(
              {
                hostname: "127.0.0.1",
                port: 3001,
                path: "/v2/chart/snapshots/analyze",
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": CFG.signalApiKey || "",
                  "Content-Length": Buffer.byteLength(analyzePayload),
                },
                timeout: 180000,
              },
              (res) => {
                let b = "";
                res.on("data", (chunk) => (b += chunk));
                res.on("end", () =>
                  resolve({ statusCode: res.statusCode, body: b }),
                );
              },
            );
            req.on("error", (e) => reject(e));
            req.on("timeout", () => {
              req.destroy();
              reject(new Error("timeout"));
            });
            req.write(analyzePayload);
            req.end();
          });
          let created = 0;
          let createdTradeSid = "";
          try {
            const parsed = JSON.parse(body);
            created = Number(
              parsed?.auto_save_result?.created ||
                parsed?.auto_save?.created ||
                0,
            );
            createdTradeSid = String(
              parsed?.auto_save_result?.trade_sid ||
                parsed?.auto_save_result?.sid ||
                parsed?.auto_save?.trade_sid ||
                parsed?.auto_save?.sid ||
                parsed?.trade_sid ||
                parsed?.sid ||
                "",
            ).trim();
            if (!createdTradeSid) {
              const ids = parsed?.auto_save_result?.created_ids;
              if (Array.isArray(ids) && ids.length > 0) {
                createdTradeSid = String(ids[0] || "").trim();
              }
            }
          } catch (_) {}
          triggered++;
          const ok = statusCode >= 200 && statusCode < 300;
          console.log(
            `[Cron][AiAnalysis] ${symbol}: ${ok ? "OK" : "FAIL"} (${statusCode}) created=${created}`,
          );
          // Per-symbol log
          fileLog(
            symbol,
            "cron",
            {
              event: "CRON_AI_ANALYSIS",
              message: `AI Analysis: ${symbol} — ${ok ? "ok" : "FAIL (" + statusCode + ")"}${created > 0 ? ", " + created + " trades" : ", 0 trades"}`,
              cron_name: confName,
              symbol,
              status: ok ? "ok" : "error",
              created_trades: created,
              trade_sid: createdTradeSid || undefined,
              status_code: statusCode,
            },
            userId,
          );
          // Notify hub
          if (notificationManager) {
            notificationManager.handle("SYSTEM_EVENT", "cron_ai", {
              message: `AI Analysis: ${symbol} — ${ok ? "ok" : "failed"}${created > 0 ? " (" + created + " trades)" : ""}`,
              symbol,
            });
          }
        } catch (err) {
          console.error(`[Cron][AiAnalysis] Failed ${symbol}: ${err.message}`);
          fileLog(
            symbol,
            "cron",
            {
              event: "CRON_AI_ANALYSIS",
              message: `AI Analysis: ${symbol} — ERROR: ${err.message}`,
              level: "ERROR",
              error: err.message,
              cron_name: confName,
              symbol,
            },
            userId,
          );
        }
      }
    }
  }
  return { triggered };
}
async function mt5RunAiAnalysisCron() {
  const queueReady = Boolean(AI_ANALYSIS_CRON_QUEUE && AI_ANALYSIS_CRON_WORKER);
  if (!queueReady) return mt5RunAiAnalysisCronInline();
  try {
    const bucket = Math.floor(Date.now() / 60000);
    await AI_ANALYSIS_CRON_QUEUE.add(
      "run-ai-analysis-cron",
      { bucket },
      { jobId: `ai_analysis_cron_${bucket}` },
    );
    return { queued: 1 };
  } catch (err) {
    console.error(
      `[Cron][AiAnalysis] BullMQ enqueue failed, fallback inline: ${err?.message || err}`,
    );
    return mt5RunAiAnalysisCronInline();
  }
}

start().catch((err) => {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  console.error(`Failed to start server: ${message}`);
  process.exit(1);
});
