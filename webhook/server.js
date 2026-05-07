"use strict";

const crypto = require("crypto");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
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
const SERVER_VERSION = envStr(process.env.WEBHOOK_SERVER_VERSION, "v2026.05.07 19:21 - 6da791c"); // fix broker sync SSE missing broker_pnl

const SERVER_LOG_DIR = envStr(
  process.env.SERVER_LOG_DIR,
  path.join(__dirname, "logs"),
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
  for (const res of targets) {
    try {
      res.write(data);
    } catch (e) {
      /* client disconnected */
    }
  }
}

function appendEventLog(eventType, payload) {
  if (!SERVER_LOG_DIR) return;
  try {
    const logDir = SERVER_LOG_DIR;
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const filePath = path.join(logDir, "events_" + date + ".log");
    const line =
      "[" +
      new Date().toISOString() +
      "] [" +
      eventType +
      "] " +
      JSON.stringify(payload) +
      "\n";
    fs.appendFileSync(filePath, line);
  } catch (e) {
    /* ignore file log errors */
  }
}

// --- NotificationManager (unified notification routing) ---
const DEFAULT_NOTIFICATION_SETTINGS = {
  TRADE_FILLED: {
    toast: true,
    console_log: false,
    ticker: true,
    db_log: true,
    sound: "TRADE_FILLED",
  },
  TRADE_CLOSED: {
    toast: true,
    console_log: false,
    ticker: true,
    db_log: true,
    sound: "TRADE_CLOSED",
  },
  SIGNAL_ADDED: {
    toast: true,
    console_log: false,
    ticker: true,
    db_log: true,
    sound: "NEW_SIGNAL",
  },
  BROKER_POLL: {
    toast: false,
    console_log: false,
    ticker: false,
    db_log: true,
  },
  BROKER_SYNC: { toast: false, console_log: false, ticker: true, db_log: true },
  SYSTEM_EVENT: {
    toast: false,
    console_log: true,
    ticker: false,
    db_log: true,
  },
  REMOTE_API_CALL: {
    toast: false,
    console_log: false,
    ticker: false,
    db_log: true,
  },
};

class NotificationManager {
  constructor() {
    this.settingsCache = new Map();
    this.queue = [];
    this._pool = null;
    this._flushTimer = null;
    this._flushPromise = null;
    this._settingsLoaded = false;
  }

  /** Call after DB pool is ready, e.g. from _mt5InitBackendInternal */
  async init(poolRef) {
    this._pool = poolRef;
    await this.loadSettings();
    if (this._flushTimer) clearInterval(this._flushTimer);
    this._flushTimer = setInterval(() => this.flushQueue(), 1000);
    if (this._flushTimer.unref) this._flushTimer.unref();
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
      sound: payload.sound || settings.sound || null,
      notification: payload.notification !== false,
    };

    // 1) console_log channel
    if (settings.console_log) {
      console.log(
        `[NOTIFICATION][${eventType}] ${merged.message || ""}`,
        JSON.stringify(merged),
      );
      appendEventLog(eventType, merged);
    }

    // 2) SSE delivery (toast / ticker / sound)
    // Force flags override settings (used by test button)
    const hasSSE =
      settings.toast ||
      settings.ticker ||
      settings.sound ||
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
    }

    // 3) db_log channel → enqueue for batch INSERT
    if (settings.db_log || payload._force_db_log) {
      const userId = payload.user_id || null;
      this.queue.push({
        object_id: null,
        object_table: eventType,
        symbol: null,
        event_type: subType || eventType,
        metadata: JSON.stringify({
          event: eventType,
          sub_type: subType,
          message: merged.message || "",
          ...payload,
        }),
        user_id: userId,
      });
    }
  }

  /**
   * Flush queued db_log entries to logs table in a single batch INSERT.
   * Called automatically every 1s via setInterval.
   */
  async flushQueue() {
    if (!this.queue.length) return;
    if (this._flushPromise) return;

    const batch = this.queue.splice(0, this.queue.length);
    this._flushPromise = (async () => {
      if (!this._pool) {
        console.warn(
          "[NotificationManager] No pool available for db_log flush",
        );
        return;
      }
      try {
        const placeholders = [];
        const values = [];
        let idx = 1;
        for (const row of batch) {
          placeholders.push(
            `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, NOW())`,
          );
          values.push(
            row.object_id,
            row.object_table,
            row.symbol,
            row.event_type,
            row.metadata,
            row.user_id,
          );
          idx += 6;
        }
        await this._pool.query(
          `INSERT INTO logs (object_id, object_table, symbol, event_type, metadata, user_id, created_at) VALUES ${placeholders.join(", ")}`,
          values,
        );
      } catch (e) {
        console.warn("[NotificationManager] db_log flush error:", e.message);
        // Re-queue on failure to avoid data loss
        this.queue.unshift(...batch);
      } finally {
        this._flushPromise = null;
      }
    })();
  }
}

const notificationManager = new NotificationManager();

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
const CHART_SNAPSHOT_DIR = path.resolve(__dirname, "snapshots");
const CHART_SNAPSHOT_CLAUDE_MAP_FILE = path.join(
  CHART_SNAPSHOT_DIR,
  ".claude-files.json",
);
const AI_CONTEXT_FILE_DIR = path.resolve(__dirname, "ai_context_files");
const AI_CONTEXT_CLAUDE_MAP_FILE = path.join(
  AI_CONTEXT_FILE_DIR,
  ".claude-context-files.json",
);
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

  binanceMode: envStr(process.env.BINANCE_MODE).toLowerCase(),
  binanceProduct: envStr(process.env.BINANCE_PRODUCT, "spot").toLowerCase(),
  binanceApiKey: envStr(process.env.BINANCE_API_KEY),
  binanceApiSecret: envStr(process.env.BINANCE_API_SECRET),
  binanceRecvWindow: asNum(process.env.BINANCE_RECV_WINDOW, 5000),
  binanceDefaultQty: asNum(process.env.BINANCE_DEFAULT_QTY, NaN),
  binanceDefaultQuoteQty: asNum(process.env.BINANCE_DEFAULT_QUOTE_QTY, NaN),

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
  redisEnabled: asBool(process.env.REDIS_ENABLED, true),
  redisUrl: envStr(process.env.REDIS_URL, "redis://127.0.0.1:6379"),
  marketDataCronEnabled: asBool(process.env.MARKET_DATA_CRON_ENABLED, true),
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
  uiDistPath: path.resolve(
    __dirname,
    envStr(
      process.env.WEB_UI_DIST_PATH || process.env.WEBHOOK_UI_DIST_PATH,
      "../web-ui/dist",
    ),
  ),
  landingDistPath: path.resolve(
    __dirname,
    envStr(process.env.WEB_LANDING_DIST_PATH, "../web"),
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

const AI_SCHEMA_SPEC = require("../shared/ai_response_schema.json");
const AI_RESPONSE_SCHEMA_VERSION = String(AI_SCHEMA_SPEC.version || "2.3");
const AI_RESPONSE_SCHEMA = AI_SCHEMA_SPEC.schema || {};

// Legacy checklist bank kept for reference
const AI_CHECKLIST_BANK = [];

function buildAiSchemaPromptText() {
  return `You are an expert ICT technical analyst.
Respond ONLY in valid minified JSON matching schema exactly. No prose, markdown, or trailing commas.
All fields required. Enums must match. Use null only where price data is unavailable.
Array limits: htf_context<=2, ltf_analysis<=2, trade_plan<=2, pd_arrays<=6/tf, key_levels<=6, reference_zones<=6.
Trade plans must be actionable and internally consistent.
IMPORTANT: You MUST include a trade_plan array with at least 1 actionable plan (direction, entry_price, stop_loss, take_profits). trade_plan is REQUIRED.
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
  if (notificationManager && metadata?.event) {
    const ev = String(metadata.event || "").toUpperCase();
    let eventType = null,
      subType = "";
    if (ev === "TRADE_FILLED" || ev === "TRADE_SYNC_UPDATE") {
      eventType = "TRADE_FILLED";
      subType = ev.toLowerCase();
    } else if (ev === "TRADE_CLOSED" || ev === "TRADE_CLOSE") {
      eventType = "TRADE_CLOSED";
      subType = "closed";
    } else if (ev.startsWith("SIGNAL_")) {
      eventType = "SIGNAL_ADDED";
      subType = ev.replace("SIGNAL_", "").toLowerCase();
    }
    if (eventType) {
      notificationManager.handle(eventType, subType, {
        object_id: objectId,
        object_table: objectTable,
        user_id: userId || null,
        message: metadata.event || "",
        ...metadata,
      });
    }
  }
  // Legacy DB insert — still needed for object-scoped queries (e.g. trade detail events page)
  const b = await mt5Backend();
  if (b.log)
    await b.log(objectId, objectTable, metadata, userId).catch(() => {});
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
  const s = {
    D: 86400000,
    W: 604800000,
    "4H": 14400000,
    "1H": 3600000,
    "15M": 900000,
    "5M": 300000,
    "1M": 60000,
  };
  return s[String(tf).toUpperCase()] || 3600000;
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
};

/**
 * StateRepo Loaders (Eager & Lazy)
 */
async function repoGetSystemSettings() {
  return await StateRepo.get("SYSTEM_SETTINGS", "global", async () => {
    const db = await mt5InitBackend();
    const { rows } = await db.query(
      "SELECT data FROM user_settings WHERE type = 'api_key' AND user_id = $1",
      [CFG.mt5DefaultUserId],
    );
    const raw = rows[0]?.data || {};
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
    const b = await mt5Backend();
    // Use the backend's existing listAccounts or direct query if not available
    if (b.listAccounts) return await b.listAccounts({ userId });
    const { rows } = await (
      await mt5InitBackend()
    ).query(
      "SELECT * FROM user_accounts WHERE user_id = $1 AND status != 'ARCHIVED'",
      [userId],
    );
    return rows;
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
  return await StateRepo.get("SIGNALS_PENDING", userId, async () => {
    const db = await mt5InitBackend();
    const where =
      userId === "all"
        ? "status IN ('NEW', 'PENDING')"
        : "status IN ('NEW', 'PENDING') AND user_id = $1";
    const params = userId === "all" ? [] : [userId];
    const { rows } = await db.query(
      `SELECT * FROM signals WHERE ${where} ORDER BY created_at DESC`,
      params,
    );
    return rows;
  });
}

async function repoGetUserWatchlist(userId) {
  return await StateRepo.get("USER_WATCHLIST", userId, async () => {
    const db = await mt5InitBackend();
    const { rows } = await db.query(
      "SELECT metadata->'watchlist' as watchlist FROM users WHERE user_id = $1",
      [userId],
    );
    return rows[0]?.watchlist || [];
  });
}

async function repoGetUserTemplates(userId) {
  return await StateRepo.get("USER_TEMPLATES", userId, async () => {
    const db = await mt5InitBackend();
    const { rows } = await db.query(
      "SELECT id as template_id, name, data FROM user_templates WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    return rows.map((r) => ({
      template_id: r.template_id,
      name: r.name,
      ...r.data,
    }));
  });
}

async function repoListUserSettings(userId) {
  return await StateRepo.get("USER_SETTINGS", userId, async () => {
    const db = await mt5InitBackend();
    const { rows } = await db.query(
      "SELECT type, name, data, value, status, created_at FROM user_settings WHERE user_id = $1 ORDER BY type ASC",
      [userId],
    );
    return rows;
  });
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

async function marketDataDbRead(symbolNorm, tfNorm, reqStart, reqEnd) {
  const db = await mt5InitBackend();
  const res = await Promise.race([
    db.query(
      `SELECT symbol, tf as timeframe, bar_start, bar_end, data, metadata, last_price, last_price_at
       FROM market_data
       WHERE symbol = $1 AND tf = $2 AND bar_start <= $3 AND bar_end >= $4
       ORDER BY bar_end DESC
       LIMIT 1`,
      [symbolNorm, tfNorm, reqStart, reqEnd],
    ),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("marketDataDbRead timeout")), 10000),
    ),
  ]);
  if (!res.rows?.length) return null;
  const row = res.rows[0];
  let bars = [];
  try {
    bars = typeof row.data === "string" ? JSON.parse(row.data) : row.data || [];
  } catch (e) {}
  return {
    symbol: row.symbol,
    timeframe: row.timeframe,
    bar_start: row.bar_start,
    bar_end: row.bar_end,
    bars,
    metadata: row.metadata,
    last_price:
      row.last_price === null || row.last_price === undefined
        ? null
        : Number(row.last_price),
    last_price_at: row.last_price_at || null,
  };
}

async function marketDataDbWrite(symbolNorm, tfNorm, data) {
  const db = await mt5InitBackend();
  const barsStr = JSON.stringify(data.bars || []);
  const lastBar =
    Array.isArray(data.bars) && data.bars.length
      ? data.bars[data.bars.length - 1]
      : null;
  const lastPrice = Number(data.last_price ?? lastBar?.close);
  const lastPriceAtSec = Number(data.last_price_at_sec ?? lastBar?.time);
  const lastPriceAtIso = Number.isFinite(lastPriceAtSec)
    ? new Date(lastPriceAtSec * 1000).toISOString()
    : null;
  const metadata =
    data.metadata && typeof data.metadata === "object"
      ? { ...data.metadata }
      : {};
  if (Number.isFinite(lastPrice)) metadata.last_price = lastPrice;
  if (lastPriceAtIso) metadata.last_price_at = lastPriceAtIso;
  const metaStr = Object.keys(metadata).length
    ? JSON.stringify(metadata)
    : null;
  await db.query(
    `INSERT INTO market_data (symbol, tf, bar_start, bar_end, data, metadata, last_price, last_price_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (symbol, tf, bar_start, bar_end) DO UPDATE SET
       data = EXCLUDED.data,
       metadata = COALESCE(EXCLUDED.metadata, market_data.metadata),
       last_price = COALESCE(EXCLUDED.last_price, market_data.last_price),
       last_price_at = COALESCE(EXCLUDED.last_price_at, market_data.last_price_at),
       updated_at = NOW()`,
    [
      symbolNorm,
      tfNorm,
      data.bar_start,
      data.bar_end,
      barsStr,
      metaStr,
      Number.isFinite(lastPrice) ? lastPrice : null,
      lastPriceAtIso,
    ],
  );
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

async function marketDataDbRead(symbolNorm, tfNorm, reqStart, reqEnd) {
  const db = await mt5InitBackend();
  const res = await Promise.race([
    db.query(
      `SELECT data
       FROM market_data
      WHERE symbol = $1
        AND tf = $2
        AND NOT (bar_end < $3 OR bar_start > $4)
      ORDER BY bar_start ASC`,
      [symbolNorm, tfNorm, reqStart, reqEnd],
    ),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("marketDataDbRead timeout")), 10000),
    ),
  ]);

  if (!res.rows.length) return null;

  // Merge all found rows
  const dedup = new Map();
  let firstSl = null;
  let firstTp = null;

  res.rows.forEach((row) => {
    const snap = deserializeSnapshotFromDb(row.data);
    if (!snap) return;
    if (firstSl === null) firstSl = snap.sl;
    if (firstTp === null) firstTp = snap.tp;
    snap.bars.forEach((b) => dedup.set(b.time, b));
  });

  const mergedBars = [...dedup.values()].sort((a, b) => a.time - b.time);
  if (!mergedBars.length) return null;

  return {
    symbol_norm: symbolNorm,
    tf_norm: tfNorm,
    bar_start: mergedBars[0].time,
    bar_end: mergedBars[mergedBars.length - 1].time + tfSec,
    bars: mergedBars,
    sl: firstSl,
    tp: firstTp,
    timezone: "UTC",
    gap_candidates: detectMarketDataGapCandidates(mergedBars, tfNorm).slice(
      0,
      20,
    ),
  };
}

async function marketDataDbUpsert(symbolNorm, tfNorm, snapshot) {
  const bars = normalizeMarketDataBars(snapshot?.bars);
  if (!bars.length) return;

  const db = await mt5InitBackend();
  const tfSec = Math.max(60, parseTfTokenToSeconds(tfNorm));
  const maxBars = Math.max(
    50,
    Math.min(1000, Number(CFG.marketDataChunkMaxBars) || 500),
  );

  // 1. Fetch existing overlapping or adjacent data to merge
  // We expand the range slightly to catch nearby segments
  const s = bars[0].time;
  const e = bars[bars.length - 1].time;
  const expand = tfSec * maxBars;

  const existing = await db.query(
    `SELECT id, data FROM market_data
      WHERE symbol = $1 AND tf = $2
        AND NOT (bar_end < $3 OR bar_start > $4)`,
    [symbolNorm, tfNorm, s - expand, e + expand],
  );

  const dedup = new Map();
  // Add existing bars
  existing.rows.forEach((row) => {
    const snap = deserializeSnapshotFromDb(row.data);
    if (snap?.bars) snap.bars.forEach((b) => dedup.set(b.time, b));
  });
  // Add new bars
  bars.forEach((b) => dedup.set(b.time, b));

  const mergedBars = [...dedup.values()].sort((a, b) => a.time - b.time);
  const chunks = [];
  for (let i = 0; i < mergedBars.length; i += maxBars) {
    const chunkBars = mergedBars.slice(i, i + maxBars);
    if (!chunkBars.length) continue;
    const chunkSnapshot = {
      provider: snapshot.provider || "unknown",
      sl: snapshot.sl,
      tp: snapshot.tp,
      bars: chunkBars,
    };
    chunks.push({
      bar_start: chunkBars[0].time,
      bar_end: chunkBars[chunkBars.length - 1].time + tfSec,
      data: serializeSnapshotForDb(chunkSnapshot),
    });
  }

  // 2. Replace old overlapping chunks with deterministic max-size chunks.
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (existing.rows.length > 0) {
      const ids = existing.rows.map((r) => r.id);
      await client.query("DELETE FROM market_data WHERE id = ANY($1)", [ids]);
    }
    for (const chunk of chunks) {
      const chunkLastBar = chunkBarsForLastPrice(chunk.data);
      await client.query(
        `INSERT INTO market_data (symbol, tf, bar_start, bar_end, data, last_price, last_price_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (symbol, tf, bar_start, bar_end)
         DO UPDATE SET data = EXCLUDED.data, last_price = EXCLUDED.last_price, last_price_at = EXCLUDED.last_price_at, updated_at = NOW()`,
        [
          symbolNorm,
          tfNorm,
          chunk.bar_start,
          chunk.bar_end,
          chunk.data,
          chunkLastBar?.close ?? null,
          chunkLastBar?.time
            ? new Date(Number(chunkLastBar.time) * 1000).toISOString()
            : null,
        ],
      );
    }
    await client.query("COMMIT");
    await marketDataUpdateCronState({
      userId: snapshot.user_id || CFG.mt5DefaultUserId,
      settingName: snapshot.setting_name || "default",
      symbol: symbolNorm,
      tf: tfNorm,
      patch: {
        last_success_at: new Date().toISOString(),
        last_bar_start: mergedBars[mergedBars.length - 1]?.time || null,
        chunk_count: chunks.length,
        bar_count: mergedBars.length,
        gap_candidates: detectMarketDataGapCandidates(mergedBars, tfNorm).slice(
          0,
          20,
        ),
      },
    }).catch(() => {});
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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

function setUiSessionCookie(res, token) {
  const ttl = Math.max(
    300,
    Number.isFinite(CFG.uiSessionTtlSeconds)
      ? CFG.uiSessionTtlSeconds
      : 60 * 60 * 24 * 7,
  );
  res.setHeader(
    "Set-Cookie",
    `tvb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttl}`,
  );
}

function clearUiSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    "tvb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
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
  const token = String(cookies.tvb_session || "");
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

function contentTypeByExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".ico":
      return "image/x-icon";
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function serveUiFile(res, filePath, method = "GET") {
  const body = fs.readFileSync(filePath);
  const headers = {
    "Content-Type": contentTypeByExt(filePath),
    "Content-Length": body.length,
    "Cache-Control": filePath.endsWith(".html")
      ? "no-store"
      : "public, max-age=86400",
  };
  res.writeHead(200, headers);
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

function ensureChartSnapshotDir() {
  if (!fs.existsSync(CHART_SNAPSHOT_DIR)) {
    fs.mkdirSync(CHART_SNAPSHOT_DIR, { recursive: true });
  }
}

function ensureAiContextFileDir() {
  if (!fs.existsSync(AI_CONTEXT_FILE_DIR)) {
    fs.mkdirSync(AI_CONTEXT_FILE_DIR, { recursive: true });
  }
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
  const raw = String(value || fallback)
    .trim()
    .toUpperCase();
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
  return `${yyyy}${mm}${dd}_${hh}_${mi}`;
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
  if (!raw) return "BINANCE:BTCUSDT";
  if (raw.includes(":")) return raw;
  const prov = String(provider || "")
    .trim()
    .toUpperCase();
  if (prov) return `${prov}:${raw}`;
  return `BINANCE:${raw}`;
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

async function resolveTradingViewSymbolForCapture(inputSymbol, provider) {
  const raw = String(inputSymbol || "")
    .trim()
    .toUpperCase();
  if (!raw) return "BINANCE:BTCUSDT";
  if (raw.includes(":")) return raw;
  const preferred = String(provider || "ICMARKETS")
    .trim()
    .toUpperCase();
  const exactInPreferred = await fetchTradingViewSymbolSearch(
    raw,
    preferred,
    8,
  );
  const preferredExact = exactInPreferred.find(
    (x) => String(x.symbol || "").toUpperCase() === raw,
  );
  if (preferredExact?.full_symbol)
    return preferredExact.full_symbol.toUpperCase();
  if (exactInPreferred[0]?.full_symbol)
    return String(exactInPreferred[0].full_symbol).toUpperCase();
  const anyMatches = await fetchTradingViewSymbolSearch(raw, "", 8);
  const anyExact = anyMatches.find(
    (x) => String(x.symbol || "").toUpperCase() === raw,
  );
  if (anyExact?.full_symbol) return anyExact.full_symbol.toUpperCase();
  if (anyMatches[0]?.full_symbol)
    return String(anyMatches[0].full_symbol).toUpperCase();
  return toTradingViewSymbol(raw, preferred || "ICMARKETS");
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

function resolvePlaywrightChromiumExecutablePath() {
  const fromEnv = String(
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
      "",
  ).trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  try {
    const base = "/root/.cache/ms-playwright";
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
  const symbol = await resolveTradingViewSymbolForCapture(
    opts.symbol,
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
  const lookbackBars = Math.max(
    50,
    Math.min(Number(opts.lookbackBars || 300) || 300, 5000),
  );
  const outFormatRaw = String(opts.format || "jpg").toLowerCase();
  const outFormat = outFormatRaw === "png" ? "png" : "jpg";
  const jpgQuality = Math.max(
    20,
    Math.min(Number(opts.quality || 55) || 55, 95),
  );

  const ts = Date.now();
  const symbolToken = sanitizeSnapshotFileToken(symbol);
  const tfToken = sanitizeSnapshotFileToken(interval, "TF");
  const userId = sanitizeSnapshotFileToken(opts.userId || "default");

  // Simple naming: SYMBOL_TF.png — overwrites on re-capture
  const fileName = `${symbolToken}_${tfToken}.${outFormat}`;
  const outPath = path.join(CHART_SNAPSHOT_DIR, fileName);
  const context = await browser.newContext({
    viewport: { width: width + 24, height: height + 64 },
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    await page.setContent(
      `
      <html>
        <head><meta charset="utf-8" /></head>
        <body style="margin:0;background:${theme === "dark" ? "#0b1220" : "#ffffff"};">
          <div id="tv-root" style="width:${width}px;height:${height}px;"></div>
          <script src="https://s3.tradingview.com/tv.js"></script>
          <script>
            window.__tvReady = false;
            function boot() {
              if (!window.TradingView || !window.TradingView.widget) {
                setTimeout(boot, 120);
                return;
              }
              new TradingView.widget({
                container_id: "tv-root",
                autosize: false,
                width: ${width},
                height: ${height},
                symbol: ${JSON.stringify(symbol)},
                interval: ${JSON.stringify(interval)},
                timezone: "Etc/UTC",
                theme: ${JSON.stringify(theme)},
                style: "1",
                locale: "en",
                withdateranges: false,
                hide_side_toolbar: true,
                allow_symbol_change: false,
                details: false,
                hotlist: false,
                calendar: false
              });
              window.__tvReady = true;
            }
            boot();
          </script>
        </body>
      </html>
      `,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForFunction(() => window.__tvReady === true, {
      timeout: 15000,
    });
    let intervalSec = 300;
    try {
      intervalSec = await page.evaluate((tvInterval) => {
        const upper = String(tvInterval || "").toUpperCase();
        if (upper === "D") return 86400;
        if (upper === "W") return 604800;
        if (upper === "M") return 2592000;
        const n = Number(upper);
        if (Number.isFinite(n) && n > 0) return n * 60;
        return 300;
      }, interval);
    } catch {
      intervalSec = 300;
    }
    try {
      await page.evaluate(
        ({ bars, sec }) => {
          function applyRange() {
            try {
              const chart = window?.TradingView?.widget?.activeChart
                ? window.TradingView.widget.activeChart()
                : null;
              if (!chart || typeof chart.setVisibleRange !== "function") {
                window.__tvShotReady = true;
                return;
              }
              const to = Math.floor(Date.now() / 1000);
              const from = Math.max(
                0,
                to -
                  Math.max(50, Number(bars) || 300) *
                    Math.max(60, Number(sec) || 300),
              );
              chart.setVisibleRange({ from, to });
              setTimeout(() => {
                window.__tvShotReady = true;
              }, 900);
            } catch {
              window.__tvShotReady = true;
            }
          }
          if (window?.TradingView?.widget?.onChartReady) {
            window.TradingView.widget.onChartReady(applyRange);
          } else {
            setTimeout(applyRange, 700);
          }
        },
        { bars: lookbackBars, sec: intervalSec },
      );
    } catch {
      // page may still be renderable even if evaluate step fails
    }
    try {
      await page.waitForFunction(() => window.__tvShotReady === true, {
        timeout: 12000,
      });
    } catch {
      await page.waitForTimeout(1800);
    }
    const root = page.locator("#tv-root");
    await page.waitForTimeout(900);
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
  return {
    id: fileName.replace(/\.(png|jpe?g)$/i, ""),
    file_name: fileName,
    symbol,
    timeframe: interval,
    provider: String(opts.provider || ""),
    theme,
    width,
    height,
    lookback_bars: lookbackBars,
    format: outFormat,
    created_at: new Date(st.mtimeMs || Date.now()).toISOString(),
    size_bytes: Number(st.size || 0),
    url: `/v2/chart/snapshots/${encodeURIComponent(fileName)}`,
  };
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
  const inputTfs = Array.isArray(opts.timeframes) ? opts.timeframes : [];
  const normalized = inputTfs
    .map((tf) => String(tf || "").trim())
    .filter(Boolean)
    .slice(0, 10);
  const timeframes = normalized.length ? normalized : ["15m", "4h", "1D"];
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
  const concurrency = Math.min(requestedConcurrency, timeframes.length);
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
    const items = new Array(timeframes.length);
    let cursor = 0;

    async function worker() {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= timeframes.length) return;
        const tf = timeframes[idx];
        try {
          const one = await captureTradingViewSnapshotWithBrowser(browser, {
            ...opts,
            timeframe: tf,
            tf,
          });
          items[idx] = one;
        } catch (error) {
          if (isLikelyChromiumCrash(error)) {
            const one = await captureTradingViewSnapshot({
              ...opts,
              timeframe: tf,
              tf,
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
  const cfgRows = await (
    await mt5InitBackend()
  ).query(
    "SELECT name, data FROM user_settings WHERE user_id = $1 AND type = 'api_key'",
    [userId],
  );
  for (const row of cfgRows.rows || []) {
    const name = normalizeAiApiKeyName(row?.name);
    if (name !== "CLAUDE_API_KEY") continue;
    const dec = decryptObject(
      row?.data && typeof row.data === "object" ? row.data : {},
    );
    const value = String(dec?.value || "").trim();
    if (value) return value;
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
    const rows = await db.query(
      `SELECT sid, created_at, symbol, side, order_type, entry, sl, tp, signal_tf, chart_tf, rr_planned, risk_pct_planned, note, status, metadata
       FROM signals
       WHERE user_id = $1 AND regexp_replace(upper(symbol), '[^A-Z0-9]', '', 'g') = $2
         AND status IN ('NEW','PENDING','ACTIVE')
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId, symbolNorm],
    );
    return (rows.rows || []).map((r) => ({
      sid: r.sid,
      created_at: r.created_at,
      symbol: r.symbol,
      side: r.side,
      order_type: r.order_type,
      entry: r.entry,
      sl: r.sl,
      tp: r.tp,
      signal_tf: r.signal_tf,
      chart_tf: r.chart_tf,
      rr_planned: r.rr_planned,
      risk_pct_planned: r.risk_pct_planned,
      status: r.status,
      note: r.note,
      metadata: r.metadata && typeof r.metadata === "object" ? r.metadata : {},
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
      format: "jpg",
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
  const providerRaw = String(provider || "")
    .trim()
    .toUpperCase();
  const fullSymbol = symbolRaw.includes(":")
    ? symbolRaw
    : `${providerRaw}:${symbolRaw}`;
  const symbolTokens = new Set(
    [symbolRaw, fullSymbol]
      .map((x) => sanitizeSnapshotFileToken(x || ""))
      .filter(Boolean),
  );
  const wanted = (
    Array.isArray(timeframes) ? timeframes : String(timeframes || "").split(",")
  )
    .map((tf) => toTradingViewInterval(tf).toUpperCase())
    .filter(Boolean);
  const wantedSet = new Set(wanted);
  const prefix = sanitizeSessionPrefix(sessionPrefix || "");
  const byTf = new Map();
  const files = fs
    .readdirSync(CHART_SNAPSHOT_DIR)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .map((f) => {
      const abs = path.join(CHART_SNAPSHOT_DIR, f);
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
    const hasSymbol = [...symbolTokens].some(
      (token) => token && base.includes(token),
    );
    if (!hasSymbol) continue;
    if (byTf.has(tfToken)) continue;
    byTf.set(tfToken, {
      id: base,
      file_name: item.file_name,
      timeframe: tfToken,
      created_at: new Date(item.mtimeMs || nowMs).toISOString(),
      size_bytes: item.size_bytes,
      mime_type: fileMimeByName(item.file_name),
      url: `/v2/chart/snapshots/${encodeURIComponent(item.file_name)}`,
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
  return { parsed, clean };
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
async function loadAiConfig() {
  const db = await mt5InitBackend();
  const { rows } = await db.query(
    "SELECT name, data FROM user_settings WHERE user_id = $1 AND type = 'api_key'",
    [CFG.mt5DefaultUserId],
  );
  const cfg = {};
  for (const row of rows) {
    const name = normalizeAiApiKeyName(row?.name);
    const dec = decryptObject(
      row?.data && typeof row.data === "object" ? row.data : {},
    );
    cfg[name] = String(dec?.value || "").trim();
  }
  return cfg;
}

async function callAiProvider({
  model,
  messages,
  maxTokens = 4500,
  timeoutMs = 180000,
  provider: explicitProvider = "",
}) {
  // If explicit provider is given (for OpenRouter), use it directly
  if (explicitProvider) {
    // Passthrough to appropriate handler below — model-based detection is overridden
  }
  const modelLower = String(model || "").toLowerCase();

  // Claude → use Anthropic Messages API
  if (modelLower.includes("claude")) {
    trackApiCall("Claude");
    const claudeKey = await loadClaudeApiKeyForUser(CFG.mt5DefaultUserId);
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
          .join("\n")
      : String(json?.content || "");
    return { rawText, modelUsed: out.modelUsed || model, provider: "claude" };
  }

  // OpenAI / DeepSeek / Gemini → use OpenAI-compatible chat/completions
  // Determine provider: explicit overrides model-based detection
  const provider = explicitProvider
    ? explicitProvider.toLowerCase()
    : modelLower.includes("openrouter") || modelLower.includes("open-router")
      ? "openrouter"
      : modelLower.includes("gpt") || modelLower.includes("openai")
        ? "openai"
        : modelLower.includes("deepseek")
          ? "deepseek"
          : "gemini";

  trackApiCall(provider.charAt(0).toUpperCase() + provider.slice(1));
  const cfg = await loadAiConfig();
  const apiKey =
    provider === "deepseek"
      ? cfg.DEEPSEEK_API_KEY
      : provider === "openrouter"
        ? cfg.OPENROUTER_API_KEY || ""
        : provider === "openai"
          ? cfg.OPENAI_API_KEY
          : cfg.GEMINI_API_KEY;
  if (!apiKey)
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

function isTradeHost(hostname) {
  return (
    hostname === "trade.mozasolution.com" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );
}

function isLandingHost(hostname) {
  return hostname === "mozasolution.com" || hostname === "www.mozasolution.com";
}

function isApiPath(pathname) {
  const p = String(pathname || "");
  return (
    p === "/health" ||
    p === "/mt5/health" ||
    p === "/csv" ||
    p === "/auth" ||
    p.startsWith("/auth/") ||
    p === "/signal" ||
    p.startsWith("/signal/") ||
    p === "/v2" ||
    p.startsWith("/v2/") ||
    p.startsWith("/mt5/") ||
    p.startsWith("/webhook") ||
    p === "/system/storage/stats" ||
    p === "/system/cache" ||
    p === "/system/storage/cleanup"
  );
}

function stripWebhookPrefix(pathname) {
  const p = String(pathname || "");
  if (p === "/webhook") return "/";
  if (p.startsWith("/webhook/")) return p.slice("/webhook".length) || "/";
  return p;
}

function tryServeLanding(url, req, res, hostname) {
  if (!["GET", "HEAD"].includes(req.method)) return false;
  if (!isLandingHost(hostname)) return false;
  if (!fs.existsSync(CFG.landingDistPath)) {
    return json(res, 404, {
      ok: false,
      error: `Landing dist folder not found: ${CFG.landingDistPath}`,
    });
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    const indexPath = path.join(CFG.landingDistPath, "index.html");
    if (fs.existsSync(indexPath)) {
      serveUiFile(res, indexPath, req.method);
      return true;
    }
    return json(res, 404, {
      ok: false,
      error: `Landing entry not found: ${indexPath}`,
    });
  }

  if (!url.pathname.startsWith("/landing-assets/")) return false;
  const rel = url.pathname.replace(/^\/landing-assets\/+/, "");
  if (!rel || rel.includes(".."))
    return json(res, 400, { ok: false, error: "Invalid landing asset path" });
  const requested = path.join(CFG.landingDistPath, "assets", rel);
  if (!fs.existsSync(requested) || !fs.statSync(requested).isFile()) {
    return json(res, 404, { ok: false, error: "Landing asset not found" });
  }
  serveUiFile(res, requested, req.method);
  return true;
}

function tryServeUi(url, req, res, hostname) {
  if (!["GET", "HEAD"].includes(req.method)) return false;
  const isTradeRootUiPath = isTradeHost(hostname) && !isApiPath(url.pathname);
  const isUiPath =
    url.pathname.startsWith("/ui") ||
    (url.pathname.startsWith("/system") && !isApiPath(url.pathname)) ||
    isTradeRootUiPath;
  const isUiAssetPath = url.pathname.startsWith("/assets/");
  if (!isUiPath && !isUiAssetPath) return false;
  if (!fs.existsSync(CFG.uiDistPath)) {
    return json(res, 404, {
      ok: false,
      error: `UI dist folder not found: ${CFG.uiDistPath}`,
    });
  }

  let rel;
  if (isUiAssetPath) {
    rel = url.pathname;
  } else if (isTradeRootUiPath) {
    rel = url.pathname;
    if (!rel || rel === "/") rel = "/index.html";
  } else {
    rel = url.pathname.slice("/ui".length);
    if (!rel || rel === "/") rel = "/index.html";
  }
  if (rel.includes("..")) {
    return json(res, 400, { ok: false, error: "Invalid UI path" });
  }

  const normalizedRel = rel.replace(/^\/+/, "");
  const requested = path.join(CFG.uiDistPath, normalizedRel);
  if (fs.existsSync(requested) && fs.statSync(requested).isFile()) {
    serveUiFile(res, requested, req.method);
    return true;
  }

  if (isUiAssetPath) {
    return json(res, 404, { ok: false, error: "UI asset not found" });
  }

  // SPA fallback
  const indexPath = path.join(CFG.uiDistPath, "index.html");
  if (fs.existsSync(indexPath)) {
    serveUiFile(res, indexPath, req.method);
    return true;
  }
  return json(res, 404, {
    ok: false,
    error: `UI entry not found: ${indexPath}`,
  });
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
  const orderType = orderTypeRaw ? mt5NormalizeOrderType(payload) : "market";
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

function enforceRiskAndPolicy(signal) {
  if (
    CFG.allowSymbols.length > 0 &&
    !CFG.allowSymbols.includes(signal.symbol)
  ) {
    throw new Error(`Symbol ${signal.symbol} is not in ALLOW_SYMBOLS`);
  }

  if (Number.isFinite(CFG.maxRiskPct) && signal.sl !== null) {
    const risk = Math.abs(signal.price - signal.sl);
    const riskPct = signal.price > 0 ? (risk / signal.price) * 100 : 0;
    if (riskPct > CFG.maxRiskPct) {
      throw new Error(
        `Risk ${riskPct.toFixed(2)}% exceeds MAX_RISK_PCT ${CFG.maxRiskPct}%`,
      );
    }
  }
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

async function executeBinance(signal) {
  if (!CFG.binanceEnabled) {
    const reason = CFG.binanceMode
      ? "BINANCE_MODE invalid (use paper|live, or empty to disable)"
      : "BINANCE_MODE empty (disabled)";
    return { broker: "binance", status: "skipped", reason };
  }
  if (!CFG.binanceApiKey || !CFG.binanceApiSecret) {
    return {
      broker: "binance",
      status: "skipped",
      reason: "Missing BINANCE_API_KEY/SECRET",
    };
  }
  if (!["spot", "um_futures"].includes(CFG.binanceProduct)) {
    throw new Error("BINANCE_PRODUCT must be spot|um_futures");
  }

  const clientOrderId = `tv_${signal.strategy}_${signal.symbol}_${Date.now()}`
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 36);
  const sizing = resolveBinanceSizing(signal);

  if (CFG.binanceProduct === "spot") {
    const order = await binanceSignedRequest("POST", "/api/v3/order", {
      symbol: signal.symbol,
      side: signal.side,
      type: "MARKET",
      newClientOrderId: clientOrderId,
      ...sizing,
    });

    return {
      broker: "binance",
      status: "submitted",
      product: "spot",
      orderId: order.orderId,
      clientOrderId,
    };
  }

  const entry = await binanceSignedRequest("POST", "/fapi/v1/order", {
    symbol: signal.symbol,
    side: signal.side,
    type: "MARKET",
    newClientOrderId: clientOrderId,
    quantity: sizing.quantity,
  });

  const protective = [];
  const closeSide = signal.side === "BUY" ? "SELL" : "BUY";

  if (signal.sl !== null) {
    const slRes = await binanceSignedRequest("POST", "/fapi/v1/order", {
      symbol: signal.symbol,
      side: closeSide,
      type: "STOP_MARKET",
      stopPrice: String(signal.sl),
      closePosition: "true",
      reduceOnly: "true",
      workingType: "MARK_PRICE",
    });
    protective.push({ type: "SL", orderId: slRes.orderId });
  }

  if (signal.tp !== null) {
    const tpRes = await binanceSignedRequest("POST", "/fapi/v1/order", {
      symbol: signal.symbol,
      side: closeSide,
      type: "TAKE_PROFIT_MARKET",
      stopPrice: String(signal.tp),
      closePosition: "true",
      reduceOnly: "true",
      workingType: "MARK_PRICE",
    });
    protective.push({ type: "TP", orderId: tpRes.orderId });
  }

  return {
    broker: "binance",
    status: "submitted",
    product: "um_futures",
    orderId: entry.orderId,
    clientOrderId,
    protective,
  };
}

async function executeCTrader(signal, opts = {}) {
  const mode = String(opts?.mode || CFG.ctraderMode || "")
    .trim()
    .toLowerCase();
  const modeEnabled = ["demo", "live"].includes(mode);
  const enabled = opts?.forceEnabled ? modeEnabled : CFG.ctraderEnabled;
  if (!enabled) {
    const reason = mode
      ? "CTRADER mode invalid (use demo|live, or empty to disable)"
      : "CTRADER mode empty (disabled)";
    return { broker: "ctrader", status: "skipped", reason };
  }
  if (!CFG.ctraderExecutorUrl) {
    return {
      broker: "ctrader",
      status: "skipped",
      reason: "Set CTRADER_EXECUTOR_URL",
    };
  }

  const headers = { "Content-Type": "application/json" };
  if (CFG.ctraderExecutorApiKey) {
    headers["x-api-key"] = CFG.ctraderExecutorApiKey;
  }

  const res = await fetch(CFG.ctraderExecutorUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      mode: mode || CFG.ctraderMode,
      signal,
      execution_profile: opts?.profile || null,
    }),
  });

  const bodyText = await res.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = { raw: bodyText };
  }

  if (!res.ok) {
    throw new Error(
      `cTrader executor failed ${res.status}: ${JSON.stringify(body)}`,
    );
  }

  return {
    broker: "ctrader",
    status: "submitted",
    mode: mode || CFG.ctraderMode,
    response: body,
  };
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

async function resolveExecutionPlan(signal) {
  const userId =
    String(signal?.user_id || CFG.mt5DefaultUserId).trim() ||
    CFG.mt5DefaultUserId;
  const profile = await mt5GetActiveExecutionProfileV2(userId).catch(
    () => null,
  );
  if (!profile) {
    return {
      kind: "legacy",
      runMt5: true,
      runBinance: true,
      runCTrader: true,
      profile: null,
    };
  }
  const route = String(profile.route || "")
    .trim()
    .toLowerCase();
  if (route === "ctrader") {
    return {
      kind: "profile",
      runMt5: false,
      runBinance: false,
      runCTrader: true,
      ctraderMode: String(
        profile.ctrader_mode || CFG.ctraderMode || "demo",
      ).toLowerCase(),
      profile,
    };
  }
  // `ea` and `v2` both route into MT5 queue. Consumer side differs externally.
  return {
    kind: "profile",
    runMt5: true,
    runBinance: false,
    runCTrader: false,
    profile,
  };
}

async function handleSignal(payload) {
  const signal = normalizeSignal(payload);
  enforceRiskAndPolicy(signal);

  const plan = await resolveExecutionPlan(signal);
  const execResults = [];
  if (plan.runMt5) {
    const mt5Res = await executeMt5(signal);
    execResults.push(mt5Res);
  } else {
    execResults.push({
      broker: "mt5",
      status: "skipped",
      reason: "Execution profile route != mt5",
    });
  }

  if (plan.runBinance) {
    const binanceRes = await executeBinance(signal);
    execResults.push(binanceRes);
  } else {
    execResults.push({
      broker: "binance",
      status: "skipped",
      reason: "Execution profile route disabled",
    });
  }

  if (plan.runCTrader) {
    const ctraderRes = await executeCTrader(signal, {
      mode: plan.ctraderMode,
      forceEnabled: plan.kind === "profile",
      profile: plan.profile,
    });
    execResults.push(ctraderRes);
  } else {
    execResults.push({
      broker: "ctrader",
      status: "skipped",
      reason: "Execution profile route disabled",
    });
  }

  const text = formatSignal(signal);
  const telegram = await sendTelegram(text);

  return {
    ok: true,
    signal,
    execution_plan: plan?.profile
      ? {
          profile_id: plan.profile.profile_id || null,
          route: plan.profile.route || null,
          account_id: plan.profile.account_id || null,
          ctrader_mode: plan.ctraderMode || null,
        }
      : null,
    execution: execResults,
    telegram,
  };
}

// ==================== MT5 bridge (merged routes) ====================
function mt5NowIso() {
  return new Date().toISOString();
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
    row.entry_price_exec === null || row.entry_price_exec === undefined
      ? null
      : Number(row.entry_price_exec);
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
    sl: row.sl === null || row.sl === undefined ? null : Number(row.sl),
    tp: row.tp === null || row.tp === undefined ? null : Number(row.tp),
    entry: resolvedEntry,
    rr_planned:
      row.rr_planned === null || row.rr_planned === undefined
        ? null
        : Number(row.rr_planned),
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

async function mt5InitBackend() {
  if (MT5_BACKEND) return MT5_BACKEND;
  if (MT5_INIT_PROMISE) return MT5_INIT_PROMISE;
  MT5_INIT_PROMISE = _mt5InitBackendInternal().catch((e) => {
    MT5_INIT_PROMISE = null;
    throw e;
  });
  return MT5_INIT_PROMISE;
}

async function _mt5InitBackendInternal() {
  if (!CFG.mt5PostgresUrl) {
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
    connectionString: CFG.mt5PostgresUrl,
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
      name TEXT, -- New field
      type TEXT NOT NULL, -- 'api_key', 'symbols', 'note', system/runtime settings
      data JSONB NOT NULL,
      status TEXT DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- DDL Migration for existing installations
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

    CREATE TABLE IF NOT EXISTS signals (
      sid TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      source TEXT,
      source_id TEXT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      order_type TEXT NULL, -- market, limit, stop
      entry DOUBLE PRECISION NULL,
      entry_model TEXT NULL,
      strategy TEXT NULL,
      sl DOUBLE PRECISION NULL,
      tp DOUBLE PRECISION NULL,
      signal_tf TEXT NULL,
      chart_tf TEXT NULL,
      rr_planned DOUBLE PRECISION NULL,
      risk_money_planned DOUBLE PRECISION NULL,
      risk_pct_planned DOUBLE PRECISION NULL,
      note TEXT,
      rejection_reason TEXT,
      raw_json JSONB,
      status TEXT NOT NULL DEFAULT 'NEW'
    );

    CREATE TABLE IF NOT EXISTS trades (
      sid TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES user_accounts(account_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      signal_id TEXT NULL REFERENCES signals(sid) ON DELETE SET NULL,
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
      invalidation TEXT NULL,
      estimated_bars INT NULL,
      exit_condition TEXT NULL,
      entry_condition TEXT NULL,
      risk_management TEXT NULL,
      skip_recommendation TEXT NULL,
      confluence_checklist JSONB NULL,
      be_trigger FLOAT8 NULL
    );

    ALTER TABLE signals ADD COLUMN IF NOT EXISTS profile TEXT;
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS confidence_pct FLOAT8;
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS invalidation TEXT;
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS estimated_bars INT;
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS exit_condition TEXT;
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS entry_condition TEXT;
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS risk_management TEXT;
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS skip_recommendation TEXT;
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS confluence_checklist JSONB;
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS be_trigger FLOAT8;

    ALTER TABLE trades ADD COLUMN IF NOT EXISTS profile TEXT;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS confidence_pct FLOAT8;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS invalidation TEXT;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS estimated_bars INT;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS exit_condition TEXT;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_condition TEXT;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_management TEXT;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS skip_recommendation TEXT;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS confluence_checklist JSONB;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS be_trigger FLOAT8;

    CREATE TABLE IF NOT EXISTS execution_profiles (
      profile_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      profile_name TEXT NOT NULL,
      route TEXT NOT NULL,
      account_id TEXT NULL REFERENCES user_accounts(account_id) ON DELETE SET NULL,
      source_ids JSONB NULL,
      ctrader_mode TEXT NULL,
      ctrader_account_id TEXT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      metadata JSONB NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sources (
      id BIGSERIAL PRIMARY KEY,
      sid TEXT UNIQUE,
      source_id TEXT UNIQUE,
      user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
      name TEXT,
      type TEXT,
      status TEXT DEFAULT 'ACTIVE',
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS logs (
      log_id SERIAL PRIMARY KEY,
      object_id TEXT NULL,
      object_table TEXT NULL,
      metadata JSONB,
      user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- DDL Migrations
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS order_type TEXT NULL;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS order_type TEXT NULL;
    ALTER TABLE logs ADD COLUMN IF NOT EXISTS symbol TEXT NULL;
    ALTER TABLE logs ADD COLUMN IF NOT EXISTS event_type TEXT NULL;
  `);

  await pool.query(
    `ALTER TABLE signals ADD COLUMN IF NOT EXISTS entry DOUBLE PRECISION NULL`,
  );
  await pool.query(
    `ALTER TABLE signals ADD COLUMN IF NOT EXISTS strategy TEXT NULL`,
  );
  await pool.query(
    `ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy TEXT NULL`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_data (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      tf TEXT NOT NULL,
      bar_start BIGINT NOT NULL,
      bar_end BIGINT NOT NULL,
      data TEXT NOT NULL,
      metadata JSONB NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT market_data_symbol_tf_range_key UNIQUE (symbol, tf, bar_start, bar_end)
    );
  `);
  await pool
    .query(
      `ALTER TABLE market_data ADD COLUMN IF NOT EXISTS metadata JSONB NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE market_data ADD COLUMN IF NOT EXISTS last_price DOUBLE PRECISION NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE market_data ADD COLUMN IF NOT EXISTS last_price_at TIMESTAMPTZ NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `CREATE INDEX IF NOT EXISTS idx_market_data_symbol_tf_bar ON market_data(symbol, tf, bar_start, bar_end)`,
    )
    .catch(() => {});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ea_logs (
      id SERIAL PRIMARY KEY,
      account_id TEXT,
      level TEXT,
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      user_id TEXT
    );
  `);

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

  // Migration: Merge legacy events into unified logs and drop old tables
  try {
    await pool
      .query(
        `
      INSERT INTO logs (object_id, object_table, metadata, created_at)
      SELECT sid, 'signals', payload_json || jsonb_build_object('legacy_event_type', event_type), event_time
      FROM signal_events
    `,
      )
      .catch(() => {});
    await pool
      .query(
        `
      INSERT INTO logs (object_id, object_table, metadata, created_at)
      SELECT sid, 'trades', payload_json || jsonb_build_object('legacy_event_type', event_type), event_time
      FROM trade_events
    `,
      )
      .catch(() => {});
  } catch (e) {
    // Legacy tables might already be gone
  }

  const legacyTables = [
    "signal_events",
    "trade_events",
    "source_events",
    "mt5_signals",
    "account_sources",
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

  // Migration: Strip legacy columns from signals/trades that Postgres persists despite IF NOT EXISTS definitions
  const legacySigCols = [
    "pnl_money_realized",
    "entry_price_exec",
    "sl_exec",
    "tp_exec",
    "sl_pips",
    "tp_pips",
    "pip_value_per_lot",
    "risk_money_actual",
    "reward_money_planned",
    "reward_money_actual",
    "ack_status",
    "ack_ticket",
    "ack_error",
    "locked_at",
    "ack_at",
    "opened_at",
    "closed_at",
  ];
  for (const col of legacySigCols) {
    await pool
      .query(`ALTER TABLE signals DROP COLUMN IF EXISTS ${col}`)
      .catch(() => {});
  }

  // Migration: keep schema simple and aligned with v2.2 fields.
  await pool
    .query(`ALTER TABLE users DROP COLUMN IF EXISTS balance_start`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE signals ADD COLUMN IF NOT EXISTS source_id TEXT NULL`)
    .catch(() => {});
  await pool
    .query(`ALTER TABLE signals ADD COLUMN IF NOT EXISTS sid TEXT NULL`)
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE signals ADD COLUMN IF NOT EXISTS risk_money_planned DOUBLE PRECISION NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE signals ADD COLUMN IF NOT EXISTS risk_pct_planned DOUBLE PRECISION NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE signals ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL`,
    )
    .catch(() => {});
  await pool
    .query(`ALTER TABLE signals ADD COLUMN IF NOT EXISTS id BIGSERIAL`)
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
    .query(
      `ALTER TABLE execution_profiles ADD COLUMN IF NOT EXISTS id BIGSERIAL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE execution_profiles ADD COLUMN IF NOT EXISTS sid TEXT NULL`,
    )
    .catch(() => {});

  await pool
    .query(`ALTER TABLE signals ADD COLUMN IF NOT EXISTS entry_model TEXT NULL`)
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
  await pool
    .query(
      `ALTER TABLE execution_profiles ADD COLUMN IF NOT EXISTS source_ids JSONB NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE execution_profiles ADD COLUMN IF NOT EXISTS ctrader_mode TEXT NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE execution_profiles ADD COLUMN IF NOT EXISTS ctrader_account_id TEXT NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE execution_profiles ADD COLUMN IF NOT EXISTS metadata JSONB NULL`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE execution_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`,
    )
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

  // Compatibility migration: many existing VPS installs still have the real
  // account rows only in legacy `accounts`. Backfill `user_accounts` so the
  // Accounts UI and EA API-key auth both see the same data.
  try {
    const legacyAccountsTable = await pool.query(
      `SELECT to_regclass('public.accounts') AS table_name`,
    );
    if (legacyAccountsTable.rows?.[0]?.table_name) {
      await pool.query(`
        INSERT INTO user_accounts (
          account_id, user_id, name, balance, api_key_hash, api_key_last4,
          api_key_rotated_at, source_ids_cache, metadata, status, created_at, updated_at
        )
        SELECT
          a.account_id,
          a.user_id,
          a.name,
          a.balance,
          a.api_key_hash,
          a.api_key_last4,
          a.api_key_rotated_at,
          COALESCE(a.source_ids_cache, '[]'::jsonb),
          COALESCE(a.metadata, '{}'::jsonb),
          COALESCE(a.status, 'ACTIVE'),
          COALESCE(a.created_at, NOW()),
          COALESCE(a.updated_at, NOW())
        FROM accounts a
        WHERE a.account_id IS NOT NULL
        ON CONFLICT (account_id) DO UPDATE SET
          user_id = COALESCE(EXCLUDED.user_id, user_accounts.user_id),
          name = COALESCE(NULLIF(EXCLUDED.name, ''), user_accounts.name),
          balance = COALESCE(EXCLUDED.balance, user_accounts.balance),
          api_key_hash = COALESCE(EXCLUDED.api_key_hash, user_accounts.api_key_hash),
          api_key_last4 = COALESCE(EXCLUDED.api_key_last4, user_accounts.api_key_last4),
          api_key_rotated_at = COALESCE(EXCLUDED.api_key_rotated_at, user_accounts.api_key_rotated_at),
          source_ids_cache = COALESCE(EXCLUDED.source_ids_cache, user_accounts.source_ids_cache),
          metadata = COALESCE(EXCLUDED.metadata, user_accounts.metadata),
          status = COALESCE(NULLIF(EXCLUDED.status, ''), user_accounts.status),
          updated_at = GREATEST(COALESCE(EXCLUDED.updated_at, user_accounts.updated_at), user_accounts.updated_at)
      `);
    }
  } catch (e) {
    console.warn("[mt5-db] legacy accounts backfill skipped:", e?.message || e);
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
  await pool
    .query(
      `ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_execution_status_check`,
    )
    .catch(() => {});
  await pool
    .query(
      `
    ALTER TABLE trades
    ADD CONSTRAINT trades_execution_status_check
    CHECK (execution_status = ANY (ARRAY['PENDING','OPEN','CLOSED','REJECTED','CANCELLED']))
  `,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_close_reason_check`,
    )
    .catch(() => {});
  await pool
    .query(
      `
    ALTER TABLE trades
    ADD CONSTRAINT trades_close_reason_check
    CHECK (close_reason IS NULL OR close_reason = ANY (ARRAY['TP','SL','MANUAL','CANCEL','EXPIRED','FAIL','SNAPSHOT']))
  `,
    )
    .catch(() => {});
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

  // Performance Indexes
  const idxSql = [
    // Signals
    `CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol)`,
    `CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status)`,
    `CREATE INDEX IF NOT EXISTS idx_signals_sid ON signals(sid)`,
    // Trades
    `CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_exec_status ON trades(execution_status)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_signal_id ON trades(signal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_broker_ticket ON trades(broker_trade_id)`,
    // Logs
    `CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_object ON logs(object_id, object_table)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_symbol ON logs(symbol)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_event_type ON logs(event_type)`,
    `CREATE INDEX IF NOT EXISTS idx_signals_user ON signals(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id)`,
  ];
  for (const sql of idxSql) {
    await pool
      .query(sql)
      .catch((e) => console.error(`[db-idx] failed: ${sql}`, e.message));
  }
  await pool
    .query(
      `
    UPDATE trades t
    SET entry_model = COALESCE(NULLIF(t.entry_model, ''), NULLIF(s.entry_model, ''), s.raw_json->>'entry_model'),
        signal_tf = COALESCE(NULLIF(t.signal_tf, ''), s.signal_tf),
        chart_tf = COALESCE(NULLIF(t.chart_tf, ''), s.chart_tf)
    FROM signals s
    WHERE t.signal_id = s.sid
  `,
    )
    .catch(() => {});

  const idSidMigrations = [
    { table: "users", legacy: "user_id", prefix: "USR" },
    { table: "accounts", legacy: "account_id", prefix: "ACC" },
    // { table: "signals", legacy: "signal_id", prefix: "SIG" } // REMOVED: signal_id column dropped,
    // { table: "trades", legacy: "trade_id", prefix: "TRD" } // REMOVED: trade_id column dropped,
    { table: "sources", legacy: "source_id", prefix: "SRC" },
    { table: "execution_profiles", legacy: "profile_id", prefix: "PRF" },
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
        ELSE gen_sid('${prefix}', 8)
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
        (SELECT COUNT(*) FROM user_settings WHERE user_id = $1) AS settings_count,
        (SELECT COUNT(*) FROM execution_profiles WHERE user_id = $1) AS profiles_count
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
        .query(`SELECT gen_sid('USR', 8) AS v`)
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
    // Standardize all system-wide identification to 9-character, prefix-free SIDs.
    // We ignore suggested bases and prefixes to ensure total consistency.
    return mt5GenerateTimeSid();
  }

  // Initialize NotificationManager (loads notification_config from user_settings)
  await notificationManager.init(pool);
  global.__notificationManager = notificationManager;

  const storage = "postgres";
  MT5_BACKEND = {
    storage,
    pool,
    query: (q, p) => pool.query(q, p),
    info: { url: CFG.mt5PostgresUrl.replace(/:[^:@/]+@/, ":***@") },
    async log(objectId, objectTable, metadata = {}, userId = null) {
      const eventType = String(
        metadata.event || metadata.event_type || "INFO",
      ).toUpperCase();
      const symbol = String(metadata.symbol || "").toUpperCase() || null;

      if (eventType === "TRADE_SYNC_UPDATE") {
        // Keep only 1 latest row per trade: delete old then insert new
        await pool.query(
          `DELETE FROM logs WHERE object_id = $1 AND event_type = $2`,
          [objectId, eventType],
        );
        await pool.query(
          `INSERT INTO logs (object_id, object_table, symbol, event_type, metadata, user_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            objectId,
            objectTable,
            symbol,
            eventType,
            JSON.stringify(metadata),
            userId,
          ],
        );
        return;
      }
      await pool.query(
        `
        INSERT INTO logs (object_id, object_table, symbol, event_type, metadata, user_id, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `,
        [
          objectId,
          objectTable,
          symbol,
          eventType,
          JSON.stringify(metadata),
          userId,
        ],
      );
    },
    async upsertSignal(signal) {
      const signalSid = await allocateUniqueSid(
        pool,
        "signals",
        signal.sid,
        "SIG",
      );
      const r = await pool.query(
        `
        INSERT INTO signals (
          sid, created_at, user_id, source, source_id, symbol, side, order_type, entry, sl, tp,
          strategy, entry_model, signal_tf, chart_tf, rr_planned, risk_money_planned, risk_pct_planned,
          note, rejection_reason, raw_json, status,
          profile, confidence_pct, invalidation, estimated_bars, exit_condition, entry_condition,
          risk_management, skip_recommendation, confluence_checklist, be_trigger
        ) VALUES ($1::text,$2::timestamptz,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::numeric,$10::numeric,$11::numeric,$12::text,$13::text,$14::text,$15::text,$16::numeric,$17::numeric,$18::numeric,$19::text,$20::text,$21::jsonb,$22::text,$23::text,$24::numeric,$25::text,$26::numeric,$27::text,$28::text,$29::jsonb,$30::jsonb,$31::jsonb,$32::numeric)
        ON CONFLICT (sid) DO NOTHING
        RETURNING sid
      `,
        [
          signalSid,
          signal.created_at,
          signal.user_id,
          signal.source,
          signal.source_id,
          signal.symbol,
          signal.side,
          signal.order_type || null,
          signal.entry,
          signal.sl,
          signal.tp,
          signal.strategy || null,
          signal.entry_model || null,
          signal.signal_tf,
          signal.chart_tf,
          signal.rr_planned,
          signal.risk_money_planned,
          signal.risk_pct_planned,
          signal.note,
          signal.rejection_reason,
          JSON.stringify(signal.raw_json || {}),
          signal.status || "NEW",
          signal.profile || null,
          signal.confidence_pct || null,
          signal.invalidation || null,
          signal.estimated_bars || null,
          signal.exit_condition || null,
          signal.entry_condition || null,
          signal.risk_management || null,
          signal.skip_recommendation || null,
          signal.confluence_checklist
            ? JSON.stringify(signal.confluence_checklist)
            : null,
          signal.be_trigger || null,
        ],
      );
      bumpPulse(signal.user_id);
      return { inserted: (r.rowCount || 0) > 0 };
    },
    async findSignalById(signalId) {
      const sid = String(signalId || "").trim();
      if (!sid) return null;
      const res = await pool.query(
        `
        SELECT *
        FROM signals
        WHERE sid = $1
           OR raw_json->>'id' = $1
           OR raw_json->>'sid' = $1
        ORDER BY CASE WHEN sid = $1 THEN 0 ELSE 1 END, created_at DESC
        LIMIT 1
      `,
        [sid],
      );
      const row = res.rows?.[0] || null;
      if (!row) return null;
      const raw =
        row.raw_json && typeof row.raw_json === "object" ? row.raw_json : {};
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
      const res = await pool.query(
        `
        SELECT s.*
        FROM trades t
        LEFT JOIN signals s ON s.sid = t.signal_id
        WHERE t.broker_trade_id = $1
        ORDER BY t.updated_at DESC, t.created_at DESC
        LIMIT 1
      `,
        [tk],
      );
      const row = res.rows?.[0] || null;
      if (!row) return null;
      const raw =
        row.raw_json && typeof row.raw_json === "object" ? row.raw_json : {};
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
    async pullAndLockSignalById(signalId) {
      const sid = String(signalId || "").trim();
      if (!sid) return null;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const sel = await client.query(
          `
          SELECT *
          FROM signals
          WHERE sid = $1
             OR raw_json->>'id' = $1
             OR raw_json->>'sid' = $1
          ORDER BY CASE WHEN sid = $1 THEN 0 ELSE 1 END, created_at DESC
          LIMIT 1
          FOR UPDATE
        `,
          [sid],
        );
        const row = sel.rows?.[0] || null;
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        const cur = mt5CanonicalStoredStatus(row.status);
        if (!["NEW", "LOCKED", "PLACED", "START"].includes(cur)) {
          await client.query("COMMIT");
          return null;
        }
        let outRow = row;
        if (cur === "NEW") {
          const upd = await client.query(
            `
            UPDATE signals
            SET status = 'LOCKED'
            WHERE sid = $1
            RETURNING *
          `,
            [sid],
          );
          outRow = upd.rows?.[0] || row;
        }
        await client.query("COMMIT");
        const raw =
          outRow.raw_json && typeof outRow.raw_json === "object"
            ? outRow.raw_json
            : {};
        const side = String(
          outRow.side || raw.action || raw.side || "BUY",
        ).toUpperCase();
        const volumeRaw = Number(raw.volume ?? raw.lots ?? CFG.mt5DefaultLot);
        return {
          ...outRow,
          action: side,
          volume:
            Number.isFinite(volumeRaw) && volumeRaw > 0
              ? volumeRaw
              : CFG.mt5DefaultLot,
        };
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async pullAndLockNextTask(accountId = null) {
      const aid = String(accountId || "").trim();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // 1. Unified Trades table: Pending Actions (Mod/Close/Cancel) OR New Signals
        const selTrd = await client.query(
          `
          SELECT * FROM trades
          WHERE (
            (execution_status IN ('PENDING_MOD', 'PENDING_CLOSE', 'PENDING_CANCEL'))
            OR (dispatch_status = 'NEW' AND execution_status = 'PENDING')
          )
          AND (account_id = $1::TEXT OR account_id IS NULL OR account_id = '')
          ORDER BY
            CASE WHEN dispatch_status = 'NEW' THEN 1 ELSE 2 END ASC,
            created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `,
          [aid],
        );

        if (selTrd.rows.length > 0) {
          const row = selTrd.rows[0];

          let taskType = "OPEN";
          if (row.execution_status === "PENDING_MOD") taskType = "MODIFY";
          else if (row.execution_status === "PENDING_CLOSE") taskType = "CLOSE";
          else if (row.execution_status === "PENDING_CANCEL")
            taskType = "CANCEL";

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
    async pullAndLockNextSignal() {
      // Compatibility wrapper
      const t = await this.pullAndLockNextTask();
      if (!t || t.type !== "OPEN") return null;
      return t;
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
          `SELECT account_id FROM user_accounts WHERE user_id = $1 AND status != 'ARCHIVED'`,
          [userId],
        );
        let created = 0;
        const accountIds = [];
        for (const row of accounts.rows || []) {
          const aid = row.account_id;
          const tradeSid = await allocateUniqueSid(client, "trades");
          const ins = await client.query(
            `
            INSERT INTO trades (
              sid, account_id, user_id, source_id,
              strategy, entry_model, signal_tf, chart_tf,
              symbol, action, order_type, entry, sl, tp, volume, note,
              dispatch_status, execution_status, metadata, raw_json, created_at, updated_at,
              profile, confidence_pct, invalidation, estimated_bars, exit_condition, entry_condition,
              risk_management, skip_recommendation, confluence_checklist, be_trigger
            ) VALUES ($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::text,$11::text,$12::numeric,$13::numeric,$14::numeric,$15::numeric,$16::text,'NEW','PENDING',$17::jsonb,$18::jsonb,$19::timestamptz,$19::timestamptz,$20::text,$21::numeric,$22::text,$23::numeric,$24::text,$25::text,$26::jsonb,$27::jsonb,$28::jsonb,$29::numeric)
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
              payload.order_type || null,
              payload.entry,
              payload.sl,
              payload.tp,
              payload.volume,
              payload.note,
              JSON.stringify(
                (() => {
                  const m = { ...(payload.metadata || {}) };
                  delete m.raw_json;
                  if (signalId && !m.signal_sid) m.signal_sid = signalId;
                  return m;
                })(),
              ),
              JSON.stringify(
                payload.metadata?.raw_json || payload.raw_json || {},
              ),
              mt5NowIso(),
              payload.profile || null,
              payload.confidence_pct || null,
              payload.invalidation || null,
              payload.estimated_bars || null,
              payload.exit_condition || null,
              payload.entry_condition || null,
              payload.risk_management || null,
              payload.skip_recommendation || null,
              payload.confluence_checklist
                ? JSON.stringify(payload.confluence_checklist)
                : null,
              payload.be_trigger || null,
            ],
          );
          if ((ins.rowCount || 0) > 0) {
            created++;
            accountIds.push(aid);
            await client.query(
              `INSERT INTO logs (object_id, object_table, metadata, user_id) VALUES ($1,'trades',$2,$3)`,
              [
                tradeSid,
                JSON.stringify(
                  signalId
                    ? { event: "SIGNAL_FANOUT", signal_id: signalId }
                    : { event: "DIRECT_TRADE_CREATE" },
                ),
                userId,
              ],
            );
          }
        }
        await client.query("COMMIT");
        bumpPulse(userId);
        return { created, account_ids: accountIds };
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async pullLeasedTradesV2(accountId, maxItems = 1, leaseSeconds = 30) {
      const aid = String(accountId || "").trim();
      const leaseSec = Math.max(5, Math.min(300, Number(leaseSeconds) || 30));
      if (!aid) return [];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const sel = await client.query(
          `
          SELECT * FROM trades
          WHERE account_id = $1 AND (dispatch_status = 'NEW' OR (dispatch_status = 'LEASED' AND lease_expires_at < NOW()))
          ORDER BY created_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED
        `,
          [aid, Math.max(1, Math.min(100, Number(maxItems) || 1))],
        );
        const out = [];
        for (const row of sel.rows || []) {
          const leaseToken = crypto.randomUUID();
          const leaseExpiresAt = new Date(
            Date.now() + leaseSec * 1000,
          ).toISOString();
          await client.query(
            `UPDATE trades SET dispatch_status = 'LEASED', lease_token = $1, lease_expires_at = $2, updated_at = NOW() WHERE sid = $3`,
            [leaseToken, leaseExpiresAt, row.sid],
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
      const now = mt5NowIso();
      const openedAt = payload.opened_at || payload.openedAt || null;
      const closedAt = payload.closed_at || payload.closedAt || null;
      const isClosed = ["CLOSED", "TP", "SL", "CANCELLED"].includes(
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

      const res = await pool.query(
        `
         UPDATE trades
         SET dispatch_status = 'CONSUMED',
             execution_status = $1,
             broker_trade_id = $2,
             entry_exec = $3,
             pnl_realized = CASE WHEN $10 = TRUE THEN $4 ELSE pnl_realized END,
             volume = COALESCE($11, volume),
             order_type = COALESCE($13, order_type),
             metadata = CASE
               WHEN $12::jsonb = '{}'::jsonb THEN metadata
               ELSE COALESCE(metadata, '{}'::jsonb) || $12::jsonb
             END,
             opened_at = COALESCE($5, opened_at, CASE WHEN $1 = 'OPEN' THEN $6 ELSE NULL END),
             closed_at = COALESCE($7, CASE WHEN $1 = 'CLOSED' THEN $6 ELSE NULL END),
             updated_at = $6
         WHERE sid = $8 AND account_id = $9 RETURNING user_id, opened_at, closed_at
       `,
        [
          payload.execution_status,
          payload.broker_trade_id,
          payload.entry_exec,
          payload.pnl_realized,
          openedAt,
          now,
          closedAt,
          payload.sid || payload.trade_id,
          accountId,
          isClosed,
          usedVolume,
          JSON.stringify(telemetryMeta),
          payload.order_type || null,
        ],
      );
      if (res.rowCount > 0) {
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
          res.rows[0].user_id,
        );
      } else {
        // Fallback log for tracking orphan/failed acks
        await this.log(payload.sid || payload.trade_id, "trades", {
          event: "TRADE_ACK_FAILED",
          reason: "Trade not found or update failed",
          payload_status: payload.execution_status || payload.status,
          account_id: accountId,
        });
      }
      return { ok: res.rowCount > 0 };
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
      let tradeExec = "OPEN";
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
              metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb,
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
      const aid = String(accountId || "").trim();
      const acc = await pool.query(
        `SELECT user_id, metadata FROM user_accounts WHERE account_id = $1`,
        [aid],
      );
      const uid = acc.rows[0]?.user_id || CFG.mt5DefaultUserId;
      const existingMeta = acc.rows[0]?.metadata || {};

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
        symbol_metrics: (() => {
          const incoming = Array.isArray(payload.symbol_metrics)
            ? payload.symbol_metrics
            : [];
          const existing = Array.isArray(existingMeta.symbol_metrics)
            ? existingMeta.symbol_metrics
            : [];

          // Create a map by symbol name for merging
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

      await pool.query(
        `
        INSERT INTO user_accounts (
          account_id, user_id, metadata, balance, equity, margin, free_margin, leverage, broker_name, status, updated_at
        ) VALUES ($1::text, $2::text, $3::jsonb, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9::text, 'ACTIVE', NOW())
        ON CONFLICT (account_id) DO UPDATE SET
          metadata = EXCLUDED.metadata,
          balance = EXCLUDED.balance,
          equity = EXCLUDED.equity,
          margin = EXCLUDED.margin,
          free_margin = EXCLUDED.free_margin,
          leverage = EXCLUDED.leverage,
          broker_name = EXCLUDED.broker_name,
          updated_at = NOW()
      `,
        [
          aid,
          uid,
          JSON.stringify(newMeta),
          newMeta.balance,
          newMeta.equity,
          newMeta.margin,
          newMeta.free_margin,
          newMeta.leverage,
          newMeta.broker_name,
        ],
      );
      await StateRepo.del("USER_ACCOUNTS", uid);
      await this.log(
        aid,
        "accounts",
        { event: "ACCOUNT_SYNC", data: payload },
        uid,
      );

      const merged = new Map();
      const seenTickets = new Set();
      const hasPositionsSnapshot = Array.isArray(payload?.positions);
      const hasOrdersSnapshot = Array.isArray(payload?.orders);
      const snapshotComplete = hasPositionsSnapshot && hasOrdersSnapshot;
      const statusRank = (s) => {
        if (s === "CLOSED") return 3;
        if (s === "OPEN") return 2;
        return 1;
      };
      const pushItems = (arr = []) => {
        for (const raw of Array.isArray(arr) ? arr : []) {
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
          const symbol = String(raw.symbol || "")
            .trim()
            .toUpperCase();
          const action = String(raw.action || raw.side || "")
            .trim()
            .toUpperCase();
          const reasonRaw = String(raw.reason || raw.close_reason || "")
            .trim()
            .toUpperCase();
          const closeReason = mt5CloseReasonFromSync(raw);
          const openedAt = raw.opened_at || raw.openedAt || null;
          const closedAt = raw.closed_at || raw.closedAt || null;
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
            else statusRaw = "OPEN";
          }
          let executionStatus = "PENDING";
          const s = String(statusRaw || "").toUpperCase();

          if (["START", "OPEN", "ACTIVE", "FILLED", "EXECUTED"].includes(s)) {
            executionStatus = "OPEN";
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
          const commission = Number(raw.commission ?? 0);
          const swap = Number(raw.swap ?? 0);
          const pipsVal = Number(raw.pips ?? 0);
          const pnlVal = Number(raw.pnl ?? raw.net_pnl ?? 0);
          const volumeVal = Number(raw.volume || raw.lots || 0);
          const lotsVal = Number(raw.lots ?? volumeVal / 100000);
          const brokerComment = String(raw.comment || "").trim();

          // Use broker comment as SID if it looks like an ID
          const effectiveSignalId = brokerComment || signalId;

          const key = ticket ? `tk:${ticket}` : `sig:${effectiveSignalId}`;
          const prev = merged.get(key);
          if (!prev) {
            merged.set(key, {
              ...raw, // Capture all raw fields from broker (pip_value, leverage, etc.)
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
              symbol,
              action,
              order_type: raw.order_type || null,
              status_raw: statusRaw || "UNKNOWN",
              execution_status: executionStatus,
              close_reason: closeReason,
              opened_at: openedAt,
              closed_at: closedAt,
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
            if (symbol) prev.symbol = symbol;
            if (action) prev.action = action;
            if (closeReason) prev.close_reason = closeReason;
            if (openedAt) prev.opened_at = openedAt;
            if (closedAt) prev.closed_at = closedAt;
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
      for (const it of items) {
        let res = { rowCount: 0 };
        const ticketCandidates =
          Array.isArray(it.ticket_candidates) && it.ticket_candidates.length
            ? it.ticket_candidates
            : it.ticket
              ? [it.ticket]
              : [];
        const syncMeta = JSON.stringify({
          broker_data: {
            ...it, // Spread all processed fields (pips, lots, commission, etc.)
            position_id: ticketCandidates[0] || null,
            ticket_candidates: ticketCandidates,
            status: it.status_raw || null,
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
        if (ticketCandidates.length) {
          const openedAt = it.opened_at || null;
          const closedAt = it.closed_at || null;
          if (syncSymbol) {
            await pool.query(
              `
              UPDATE trades
              SET broker_trade_id = NULL,
                  execution_status = CASE WHEN execution_status = 'OPEN' THEN 'PENDING' ELSE execution_status END,
                  metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
                  updated_at = NOW()
              WHERE account_id = $1
                AND broker_trade_id = ANY($2::text[])
                AND symbol <> $3
                AND execution_status IN ('PENDING','OPEN')
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
          res = await pool.query(
            `
            UPDATE trades
            SET dispatch_status = CASE
                  WHEN dispatch_status IN ('NEW','LEASED') THEN 'CONSUMED'
                  ELSE dispatch_status
                END,
                execution_status = CASE
                  WHEN execution_status IN ('CLOSED', 'CANCELLED') AND $1::text NOT IN ('CLOSED', 'CANCELLED') THEN
                    CASE WHEN broker_trade_id IS NOT NULL AND broker_trade_id <> '' THEN $1::text ELSE execution_status END
                  WHEN execution_status = 'OPEN' AND $1::text = 'PENDING' THEN execution_status
                  ELSE $1::text
                END,
                pnl_realized = CASE WHEN $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($2::numeric, pnl_realized) ELSE pnl_realized END,
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
                order_type = COALESCE($12::text, order_type),
                close_reason = CASE WHEN $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($8::text, close_reason) ELSE close_reason END,
                broker_trade_id = COALESCE(NULLIF($9::text, ''), broker_trade_id),
                metadata = COALESCE(metadata, '{}'::jsonb) || $10::jsonb,
                opened_at = COALESCE($5::timestamptz, opened_at),
                closed_at = COALESCE($6::timestamptz, CASE WHEN $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN NOW() ELSE closed_at END),
                updated_at = NOW()
            WHERE account_id = $3
              AND ($11::text = '' OR symbol = $11::text)
              AND (
                sid = ANY($4::text[])
                OR (sid = $18::text AND $18::text <> '')
                OR broker_trade_id = ANY($4::text[])
                OR metadata->>'broker_position_id' = ANY($4::text[])
                OR metadata->>'position_ticket' = ANY($4::text[])
              )
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
              it.pips || 0,
              it.lots || 0,
              it.commission || 0,
              it.swap || 0,
              it.volume || 0,
              it.sid || "",
              it.margin || 0,
              it.tp_pnl || it.pnl_tp || 0,
              it.sl_pnl || it.pnl_sl || 0,
            ],
          );
        }
        if (it.sid) {
          if (res.rowCount === 0) {
            res = await pool.query(
              `
            UPDATE trades
            SET dispatch_status = CASE
                  WHEN dispatch_status IN ('NEW','LEASED') THEN 'CONSUMED'
                  ELSE dispatch_status
                END,
                execution_status = CASE
                  WHEN execution_status IN ('CLOSED', 'CANCELLED') AND $1::text NOT IN ('CLOSED', 'CANCELLED') THEN $1::text
                  WHEN execution_status = 'OPEN' AND $1::text = 'PENDING' THEN execution_status
                  ELSE $1::text
                END,
                broker_trade_id = COALESCE(NULLIF($2::text, ''), broker_trade_id),
                pnl_realized = CASE WHEN $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($3::numeric, pnl_realized) ELSE pnl_realized END,
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
                order_type = COALESCE($11::text, order_type),
                close_reason = CASE WHEN $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($7::text, close_reason) ELSE close_reason END,
                metadata = COALESCE(metadata, '{}'::jsonb) || $8::jsonb,
                opened_at = COALESCE($9::timestamptz, opened_at),
                closed_at = CASE WHEN $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($10::timestamptz, closed_at, NOW()) ELSE closed_at END,
                updated_at = NOW()
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
                it.pips || 0,
                it.lots || 0,
                it.commission || 0,
                it.swap || 0,
                it.volume || 0,
                ticketCandidates,
                it.margin || 0,
                it.tp_pnl || it.pnl_tp || 0,
                it.sl_pnl || it.pnl_sl || 0,
              ],
            );
          }
        }
        if (res.rowCount === 0 && ticketCandidates.length) {
          // Last-resort fallback: bind ticket to oldest unresolved trade for this account.
          res = await pool.query(
            `
            UPDATE trades
            SET dispatch_status = CASE
                  WHEN dispatch_status IN ('NEW','LEASED') THEN 'CONSUMED'
                  ELSE dispatch_status
                END,
                execution_status = CASE
                  WHEN execution_status IN ('CLOSED', 'CANCELLED') AND $1::text NOT IN ('CLOSED', 'CANCELLED') THEN execution_status
                  WHEN execution_status = 'OPEN' AND $1::text = 'PENDING' THEN execution_status
                  ELSE $1::text
                END,
                broker_trade_id = COALESCE(NULLIF($2::text, ''), broker_trade_id),
                pnl_realized = CASE WHEN $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($3::numeric, pnl_realized) ELSE pnl_realized END,
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
                order_type = COALESCE($11::text, order_type),
                close_reason = CASE WHEN $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($6::text, close_reason) ELSE close_reason END,
                metadata = COALESCE(metadata, '{}'::jsonb) || $7::jsonb,
                closed_at = CASE WHEN $1::text IN ('CLOSED','CANCELLED','TP','SL') THEN COALESCE($8::timestamptz, closed_at, NOW()) ELSE closed_at END,
                updated_at = NOW()
            WHERE sid = (
              SELECT sid
              FROM trades
              WHERE account_id = $4::text
                AND execution_status IN ('PENDING','OPEN')
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
              it.pips || 0,
              it.lots || 0,
              it.commission || 0,
              it.swap || 0,
              it.volume || 0,
              it.margin || 0,
              it.tp_pnl || 0,
              it.sl_pnl || 0,
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
              },
              uid,
            );
          }
        } else if (it.execution_status === "OPEN") {
          const discoverySid = mt5GenerateTimeSid();
          const brokerSource = (payload.broker_name || "BROKER")
            .toUpperCase()
            .replace(/\s+/g, "_");

          await pool.query(
            `
            INSERT INTO trades (
              sid, account_id, user_id,
              symbol, action, volume, entry,
              execution_status, source_id, metadata, broker_trade_id,
              broker_pips, broker_lots, broker_commission, broker_swap, broker_volume,
              broker_pnl, broker_margin, broker_tp_pnl, broker_sl_pnl,
              created_at, updated_at
            ) VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::numeric, $7::numeric, 'OPEN', $8::text, $9::jsonb, $10::text, $11::numeric, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric, $17::numeric, $18::numeric, $19::numeric, NOW(), NOW())
            ON CONFLICT (sid) DO NOTHING
          `,
            [
              discoverySid,
              aid,
              uid,
              syncSymbol,
              syncAction,
              it.volume || 0,
              it.entry || 0,
              brokerSource,
              syncMeta,
              ticketCandidates[0] || "",
              it.pips || 0,
              it.lots || 0,
              it.commission || 0,
              it.swap || 0,
              it.volume || 0,
              it.pnl || 0,
              it.margin || 0,
              it.tp_pnl || 0,
              it.sl_pnl || 0,
            ],
          );
          matched++;
          results.push({
            ticket: it.ticket,
            sid: discoverySid,
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
      }
      const finalizeSnapshotClosures = async (rows = []) => {
        const items = Array.isArray(rows) ? rows : [];
        for (const row of items) {
          const tradeId = String(row?.sid || "").trim();
          if (!tradeId) continue;
          let resolvedPnl = Number(row?.pnl_realized);
          if (!Number.isFinite(resolvedPnl)) {
            const pnlRes = await pool.query(
              `
              SELECT metadata->>'pnl' AS pnl
              FROM logs
              WHERE object_table = 'trades'
                AND object_id = $1
                AND metadata->>'event' IN ('SYNC_UPDATE', 'TRADE_SYNC_UPDATE')
              ORDER BY created_at DESC, log_id DESC
              LIMIT 1
            `,
              [tradeId],
            );
            const raw = String(pnlRes.rows?.[0]?.pnl ?? "").trim();
            const inferred = Number(raw);
            if (Number.isFinite(inferred)) {
              resolvedPnl = inferred;
              await pool.query(
                `
                UPDATE trades
                SET pnl_realized = COALESCE(pnl_realized, $2::numeric),
                    updated_at = NOW()
                WHERE sid = $1::text
              `,
                [tradeId, inferred],
              );
            }
          }
          await this.log(
            tradeId,
            "trades",
            {
              event: "TRADE_SYNC_CLOSE",
              ticket: row?.broker_trade_id || null,
              execution_status: row?.execution_status || null,
              close_reason: row?.close_reason || null,
              pnl_inferred: Number.isFinite(resolvedPnl) ? resolvedPnl : null,
            },
            uid,
          );
        }
      };
      let closed_by_snapshot = 0;
      if (snapshotComplete) {
        if (seenTickets.size > 0) {
          const closeRes = await pool.query(
            `
            UPDATE trades
            SET execution_status = CASE WHEN execution_status = 'PENDING' THEN 'CANCELLED' ELSE 'CLOSED' END,
                close_reason = COALESCE(close_reason, CASE WHEN execution_status = 'PENDING' THEN 'CANCEL' ELSE 'MANUAL' END),
                closed_at = COALESCE(closed_at, NOW()),
                updated_at = NOW()
            WHERE account_id = $1::text
              AND execution_status IN ('OPEN','PENDING')
              AND broker_trade_id IS NOT NULL
              AND broker_trade_id <> ''
              AND NOT (broker_trade_id = ANY($2::text[]))
            RETURNING sid, broker_trade_id, execution_status, close_reason, pnl_realized
          `,
            [aid, Array.from(seenTickets)],
          );
          closed_by_snapshot = Number(closeRes.rowCount || 0);
          await finalizeSnapshotClosures(closeRes.rows || []);
        } else {
          const closeRes = await pool.query(
            `
            UPDATE trades
            SET execution_status = CASE WHEN execution_status = 'PENDING' THEN 'CANCELLED' ELSE 'CLOSED' END,
                close_reason = COALESCE(close_reason, CASE WHEN execution_status = 'PENDING' THEN 'CANCEL' ELSE 'MANUAL' END),
                closed_at = COALESCE(closed_at, NOW()),
                updated_at = NOW()
            WHERE account_id = $1::text
              AND execution_status IN ('OPEN','PENDING')
              AND broker_trade_id IS NOT NULL
              AND broker_trade_id <> ''
            RETURNING sid, broker_trade_id, execution_status, close_reason, pnl_realized
          `,
            [aid],
          );
          closed_by_snapshot = Number(closeRes.rowCount || 0);
          await finalizeSnapshotClosures(closeRes.rows || []);
        }
      }

      // Collect trade diffs for realtime UI
      const tradeUpdates = [];
      for (const it of items) {
        if (!it.sid) continue;
        const matchedResult = results.find((r) => r.sid === it.sid);
        if (!matchedResult || matchedResult.status === "Skip") continue;
        tradeUpdates.push({
          sid: it.sid,
          symbol: it.symbol,
          pnl_realized: it.pnl,
          broker_pnl: it.pnl,
          broker_pips: it.pips,
          execution_status: it.execution_status,
          last_price: it.last_price,
        });
      }

      // Emit SSE via NotificationManager
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
      const aid = String(accountId || "").trim();
      const now = mt5NowIso();
      const balance = asNum(payload.balance, null);
      const equity = asNum(payload.equity, null);
      const margin = asNum(payload.margin, null);
      const freeMargin = asNum(payload.free_margin, null);

      const acc = await pool.query(
        `SELECT user_id, metadata FROM user_accounts WHERE account_id = $1`,
        [aid],
      );
      const uid = acc.rows[0]?.user_id || CFG.mt5DefaultUserId;
      const oldMeta = acc.rows[0]?.metadata || {};

      await pool.query(
        `
        UPDATE user_accounts
        SET balance = COALESCE($1, balance),
            metadata = $2,
            updated_at = $3
        WHERE account_id = $4
      `,
        [
          balance,
          JSON.stringify({
            ...oldMeta,
            equity,
            margin,
            free_margin: freeMargin,
          }),
          now,
          aid,
        ],
      );

      await this.log(
        aid,
        "accounts",
        { event: "ACCOUNT_HEARTBEAT", payload },
        uid,
      );
      return { ok: true };
    },
    async listSignals(limit, filters = {}, userId = null) {
      const clauses = ["sid NOT LIKE 'SYSTEM_%'"];
      const params = [];
      if (typeof filters === "string") {
        // Legacy support
        if (filters) {
          params.push(filters);
          clauses.push(`status = $${params.length}`);
        }
      } else {
        if (filters.status) {
          params.push(filters.status);
          clauses.push(`status = $${params.length}`);
        }
        if (filters.symbol) {
          params.push(filters.symbol);
          clauses.push(`symbol = $${params.length}`);
        }
        if (filters.q) {
          params.push(`%${String(filters.q)}%`);
          const p = `$${params.length}`;
          clauses.push(`(
             sid ILIKE ${p}
             OR sid ILIKE ${p}
             OR symbol ILIKE ${p}
             OR note ILIKE ${p}
           )`);
        }
      }
      if (userId) {
        params.push(userId);
        clauses.push(`user_id = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      params.push(limit);
      const res = await pool.query(
        `
        SELECT
          s.*,
          t.broker_trade_id AS ack_ticket,
          t.pnl_realized AS pnl_money_realized,
          t.opened_at AS opened_at,
          t.closed_at AS closed_at,
          t.close_reason AS close_reason,
          t.execution_status AS execution_status
        FROM signals s
        LEFT JOIN LATERAL (
          SELECT broker_trade_id, pnl_realized, opened_at, closed_at, close_reason, execution_status, updated_at, created_at
          FROM trades
          WHERE sid = s.sid
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
          LIMIT 1
        ) t ON TRUE
        ${where}
        ORDER BY s.created_at DESC
        LIMIT $${params.length}
      `,
        params,
      );
      return (res.rows || []).map((r) => mt5MapDbRow(r)).filter(Boolean);
    },
    async listTradesV2(filters = {}, page = 1, pageSize = 50) {
      const safePage = Math.max(1, Number(page) || 1);
      const safePageSize = Math.max(1, Math.min(200, Number(pageSize) || 50));
      const offset = (safePage - 1) * safePageSize;
      const clauses = [];
      const params = [];
      const tradeIds = Array.isArray(filters.sids)
        ? filters.sids.map((v) => String(v || "").trim()).filter(Boolean)
        : [];
      if (tradeIds.length) {
        const numericIds = tradeIds
          .map((v) => mt5ParseNumericId(v))
          .filter((v) => v != null);
        const idParts = [];
        if (numericIds.length) {
          params.push(numericIds);
          idParts.push(`id = ANY($${params.length}::bigint[])`);
        }
        params.push(tradeIds);
        idParts.push(`sid = ANY($${params.length}::text[])`);
        idParts.push(`sid = ANY($${params.length}::text[])`);
        clauses.push(`(${idParts.join(" OR ")})`);
      }
      if (filters.user_id) {
        params.push(filters.user_id);
        clauses.push(`user_id = $${params.length}`);
      }
      if (filters.account_id) {
        params.push(filters.account_id);
        clauses.push(`account_id = $${params.length}`);
      }
      if (filters.source_id) {
        params.push(filters.source_id);
        clauses.push(`source_id = $${params.length}`);
      }
      if (filters.dispatch_status) {
        params.push(filters.dispatch_status);
        clauses.push(`dispatch_status = $${params.length}`);
      }
      if (filters.execution_status) {
        params.push(filters.execution_status);
        clauses.push(`execution_status = $${params.length}`);
      }
      if (filters.created_from) {
        params.push(filters.created_from);
        clauses.push(`created_at >= $${params.length}`);
      }
      if (filters.created_to) {
        params.push(filters.created_to);
        clauses.push(`created_at <= $${params.length}`);
      }
      if (filters.symbol) {
        params.push(filters.symbol);
        clauses.push(`symbol = $${params.length}`);
      }
      const actionFilter = filters.action || filters.side;
      if (actionFilter) {
        params.push(actionFilter);
        clauses.push(`action = $${params.length}`);
      }
      if (filters.entry_model) {
        params.push(filters.entry_model);
        clauses.push(`entry_model = $${params.length}`);
      }
      if (filters.chart_tf) {
        params.push(filters.chart_tf);
        clauses.push(`chart_tf = $${params.length}`);
      }
      if (filters.q) {
        params.push(`%${String(filters.q)}%`);
        const p = `$${params.length}`;
        clauses.push(`(
          sid ILIKE ${p}
          OR id::text ILIKE ${p}
          OR sid ILIKE ${p}
          OR sid ILIKE ${p}
          OR broker_trade_id ILIKE ${p}
          OR symbol ILIKE ${p}
          OR account_id ILIKE ${p}
          OR source_id ILIKE ${p}
          OR action ILIKE ${p}
          OR entry_model ILIKE ${p}
          OR note ILIKE ${p}
        )`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM trades ${where}`,
        params,
      );
      params.push(safePageSize, offset);
      const res = await pool.query(
        `SELECT * FROM trades ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        items: res.rows,
        total: parseInt(countRes.rows[0].count),
        page: safePage,
        pageSize: safePageSize,
      };
    },
    async updateTradeManualV2(tradeId, userId = null, payload = {}) {
      const tid = String(tradeId || "").trim();
      if (!tid) return { ok: false, error: "sid (trade_id) is required" };
      const numericId = mt5ParseNumericId(tid);
      const stRaw = String(payload.execution_status || payload.status || "")
        .trim()
        .toUpperCase();
      const allowed = new Set([
        "PENDING",
        "OPEN",
        "CLOSED",
        "CANCELLED",
        "REJECTED",
        "PENDING_MOD",
        "PENDING_CLOSE",
        "PENDING_CANCEL",
      ]);
      if (!allowed.has(stRaw)) {
        return {
          ok: false,
          error:
            "execution_status must be one of: PENDING, OPEN, CLOSED, CANCELLED, REJECTED, PENDING_MOD, PENDING_CLOSE, PENDING_CANCEL",
        };
      }
      const pnlRaw = payload.pnl_realized ?? payload.pnl;
      const pnlNum = Number(pnlRaw);
      const pnl =
        stRaw === "PENDING" ? 0 : Number.isFinite(pnlNum) ? pnlNum : null;
      const closeReasonRaw = String(
        payload.close_reason || payload.reason || "",
      )
        .trim()
        .toUpperCase();
      const closeReason = closeReasonRaw || null;
      const params = [stRaw, pnl, closeReason, numericId, tid];
      const clauses = [];
      if (userId) {
        params.push(String(userId));
        clauses.push(`user_id = $${params.length}`);
      }
      const whereUser = clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
      const res = await pool.query(
        `
        UPDATE trades
        SET execution_status = $1::text,
            pnl_realized = CASE WHEN $2::double precision IS NULL THEN pnl_realized ELSE $2::double precision END,
            close_reason = COALESCE($3::text, close_reason),
            closed_at = CASE
              WHEN $1::text IN ('CLOSED', 'CANCELLED', 'REJECTED') THEN COALESCE(closed_at, NOW())
              ELSE closed_at
            END,
            updated_at = NOW()
        WHERE (
          ($4::bigint IS NOT NULL AND id = $4::bigint)
          OR sid = $5
          OR sid = $5
        )
          ${whereUser}
        RETURNING id, sid, signal_id, user_id, execution_status, pnl_realized, close_reason, closed_at
      `,
        params,
      );
      if ((res.rowCount || 0) === 0)
        return { ok: false, error: "trade not found" };
      const row = res.rows[0];
      await this.log(
        row.sid,
        "trades",
        {
          event: "TRADE_MANUAL_EDIT",
          execution_status: row.execution_status,
          pnl_realized: row.pnl_realized,
          close_reason: row.close_reason || null,
        },
        row.user_id || CFG.mt5DefaultUserId,
      );
      return { ok: true, item: row };
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
      const baseOffset = isDelete ? 0 : 2;
      const clauses = [];
      const closeReason = act === "cancel_all" ? "CANCEL" : "MANUAL";
      // Change: Mark as PENDING_CLOSE/CANCEL so EA can pick it up
      const nextStatus =
        act === "cancel_all" ? "PENDING_CANCEL" : "PENDING_CLOSE";
      const params = isDelete ? [] : [closeReason, nextStatus];
      const tradeIds = Array.isArray(filters.sids)
        ? filters.sids.map((v) => String(v || "").trim()).filter(Boolean)
        : [];
      if (tradeIds.length) {
        const numericIds = tradeIds
          .map((v) => mt5ParseNumericId(v))
          .filter((v) => v != null);
        const parts = [];
        if (numericIds.length) {
          params.push(numericIds);
          parts.push(`id = ANY($${baseOffset + params.length}::bigint[])`);
        }
        params.push(tradeIds);
        parts.push(`sid = ANY($${baseOffset + params.length}::text[])`);
        parts.push(`sid = ANY($${baseOffset + params.length}::text[])`);
        clauses.push(`(${parts.join(" OR ")})`);
      }
      if (filters.user_id) {
        params.push(filters.user_id);
        clauses.push(`user_id = $${baseOffset + params.length}`);
      }
      if (filters.account_id) {
        params.push(filters.account_id);
        clauses.push(`account_id = $${baseOffset + params.length}`);
      }
      if (filters.source_id) {
        params.push(filters.source_id);
        clauses.push(`source_id = $${baseOffset + params.length}`);
      }
      if (filters.execution_status) {
        params.push(filters.execution_status);
        clauses.push(`execution_status = $${baseOffset + params.length}`);
      }
      if (filters.created_from) {
        params.push(filters.created_from);
        clauses.push(`created_at >= $${baseOffset + params.length}`);
      }
      if (filters.created_to) {
        params.push(filters.created_to);
        clauses.push(`created_at <= $${baseOffset + params.length}`);
      }
      if (filters.q) {
        params.push(`%${String(filters.q)}%`);
        const p = `$${baseOffset + params.length}`;
        clauses.push(`(
          sid ILIKE ${p}
          OR id::text ILIKE ${p}
          OR sid ILIKE ${p}
          OR sid ILIKE ${p}
          OR broker_trade_id ILIKE ${p}
          OR symbol ILIKE ${p}
          OR account_id ILIKE ${p}
          OR source_id ILIKE ${p}
          OR action ILIKE ${p}
          OR entry_model ILIKE ${p}
          OR note ILIKE ${p}
        )`);
      }
      if (act === "close_all")
        clauses.push(`execution_status IN ('OPEN','PENDING')`);
      if (act === "cancel_all") clauses.push(`execution_status = 'PENDING'`);
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      if (act === "delete_all") {
        const delRes = await pool.query(
          `
          DELETE FROM trades
          ${where}
          RETURNING sid, signal_id
        `,
          params,
        );
        const rows = delRes.rows || [];
        return {
          ok: true,
          updated: Number(delRes.rowCount || 0),
          action: act,
          sids: rows.map((r) => String(r?.sid || "")).filter(Boolean),
          signal_ids: rows.map((r) => String(r?.sid || "")).filter(Boolean),
        };
      }
      const res = await pool.query(
        `
        UPDATE trades
        SET execution_status = $2,
            close_reason = COALESCE(close_reason, $1),
            closed_at = COALESCE(closed_at, NOW()),
            updated_at = NOW()
        ${where}
        RETURNING sid, signal_id
      `,
        params,
      );
      const rows = res.rows || [];
      return {
        ok: true,
        updated: Number(res.rowCount || 0),
        action: act,
        sids: rows.map((r) => String(r?.sid || "")).filter(Boolean),
        signal_ids: rows.map((r) => String(r?.sid || "")).filter(Boolean),
      };
    },
    async listLogs(filters = {}, limit = 200, offset = 0) {
      const clauses = [];
      const params = [];
      if (filters.user_id) {
        params.push(filters.user_id);
        clauses.push(`user_id = $${params.length}`);
      }
      if (filters.object_id) {
        params.push(filters.object_id);
        clauses.push(`object_id = $${params.length}`);
      }
      if (filters.object_table) {
        params.push(filters.object_table);
        clauses.push(`object_table = $${params.length}`);
      }
      if (filters.symbol) {
        params.push(String(filters.symbol).toUpperCase());
        clauses.push(`symbol = $${params.length}`);
      }
      if (filters.event_type) {
        params.push(String(filters.event_type).toUpperCase());
        clauses.push(`event_type = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      params.push(limit, offset);
      const res = await pool.query(
        `SELECT * FROM logs ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return res.rows;
    },
    async deleteAllEvents() {
      return pool.query(`DELETE FROM logs`);
    },
    async listSourcesV2() {
      const res = await pool.query(`
        SELECT source_id, name, kind, auth_mode, auth_secret_hash, is_active, metadata, created_at, updated_at
        FROM sources
        ORDER BY created_at ASC, source_id ASC
      `);
      return res.rows || [];
    },
    async getSourceByIdV2(sourceId) {
      const sid = String(sourceId || "").trim();
      if (!sid) return null;
      const res = await pool.query(
        `
        SELECT source_id, name, kind, auth_mode, auth_secret_hash, is_active, metadata, created_at, updated_at
        FROM sources
        WHERE source_id = $1
        LIMIT 1
      `,
        [sid],
      );
      return res.rows[0] || null;
    },
    async upsertSourceV2(source = {}) {
      const sourceId = String(source.source_id || "").trim();
      if (!sourceId) return null;
      const now = mt5NowIso();
      const res = await pool.query(
        `
        INSERT INTO sources (
          source_id, name, kind, auth_mode, auth_secret_hash, is_active, metadata, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8)
        ON CONFLICT (source_id) DO UPDATE SET
          name = EXCLUDED.name,
          kind = EXCLUDED.kind,
          auth_mode = EXCLUDED.auth_mode,
          auth_secret_hash = EXCLUDED.auth_secret_hash,
          is_active = EXCLUDED.is_active,
          metadata = EXCLUDED.metadata,
          updated_at = EXCLUDED.updated_at
        RETURNING source_id, name, kind, auth_mode, auth_secret_hash, is_active, metadata, created_at, updated_at
      `,
        [
          sourceId,
          String(source.name || sourceId),
          String(source.kind || "api"),
          String(source.auth_mode || "token"),
          source.auth_secret_hash ? String(source.auth_secret_hash) : null,
          normalizeUserActive(source.is_active, true),
          source.metadata && typeof source.metadata === "object"
            ? JSON.stringify(source.metadata)
            : "{}",
          now,
        ],
      );
      return res.rows[0] || null;
    },
    async rotateSourceSecretV2(sourceId) {
      const sid = String(sourceId || "").trim();
      if (!sid) return null;
      const secretPlain = `src_${crypto.randomBytes(18).toString("hex")}`;
      const secretHash = hashApiKey(secretPlain);
      const secretLast4 = secretPlain.slice(-4);
      const res = await pool.query(
        `
        UPDATE sources
        SET auth_secret_hash = $1,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('auth_secret_last4', $2),
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
        UPDATE sources
        SET auth_secret_hash = NULL,
            metadata = (COALESCE(metadata, '{}'::jsonb) - 'auth_secret_last4'),
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
      const now = mt5NowIso();
      const plainApiKey = `acc_${crypto.randomBytes(18).toString("hex")}`;
      const apiKeyHash = hashApiKey(plainApiKey);
      const apiKeyLast4 = plainApiKey.slice(-4);
      const res = await pool.query(
        `
        INSERT INTO user_accounts (
          account_id, user_id, name, balance, status, metadata,
          api_key_hash, api_key_last4, api_key_rotated_at, source_ids_cache,
          created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11,$11)
        ON CONFLICT (account_id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          name = EXCLUDED.name,
          balance = EXCLUDED.balance,
          status = EXCLUDED.status,
          metadata = EXCLUDED.metadata,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
        [
          accountId,
          String(payload.user_id || CFG.mt5DefaultUserId),
          String(payload.name || accountId),
          payload.balance === null ||
          payload.balance === undefined ||
          Number.isNaN(Number(payload.balance))
            ? null
            : Number(payload.balance),
          String(payload.status || "ACTIVE"),
          payload.metadata && typeof payload.metadata === "object"
            ? JSON.stringify(payload.metadata)
            : "{}",
          apiKeyHash,
          apiKeyLast4,
          now,
          payload.source_ids_cache &&
          typeof payload.source_ids_cache === "object"
            ? JSON.stringify(payload.source_ids_cache)
            : "[]",
          now,
        ],
      );
      return {
        ok: true,
        item: res.rows[0] || null,
        api_key_plaintext: plainApiKey,
      };
    },
    async listAccountsV2(userId = null) {
      const params = [];
      let where = "";
      if (userId) {
        params.push(String(userId || ""));
        where = `WHERE user_id = $1`;
      }
      const res = await pool.query(
        `SELECT * FROM user_accounts ${where} ORDER BY created_at ASC, account_id ASC`,
        params,
      );
      return res.rows || [];
    },
    async listExecutionProfilesV2(userId = null) {
      const params = [];
      let where = "";
      if (userId) {
        params.push(String(userId || "").trim());
        where = `WHERE user_id = $1`;
      }
      const res = await pool.query(
        `
        SELECT profile_id, user_id, profile_name, route, account_id, source_ids, ctrader_mode, ctrader_account_id,
               is_active, metadata, created_at, updated_at
        FROM execution_profiles
        ${where}
        ORDER BY is_active DESC, updated_at DESC, created_at DESC
      `,
        params,
      );
      return res.rows || [];
    },
    async getActiveExecutionProfileV2(userId = null) {
      const params = [];
      let where = `WHERE is_active = TRUE`;
      if (userId) {
        params.push(String(userId || "").trim());
        where += ` AND user_id = $${params.length}`;
      }
      const res = await pool.query(
        `
        SELECT profile_id, user_id, profile_name, route, account_id, source_ids, ctrader_mode, ctrader_account_id,
               is_active, metadata, created_at, updated_at
        FROM execution_profiles
        ${where}
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
        params,
      );
      return res.rows?.[0] || null;
    },
    async saveExecutionProfileV2(payload = {}) {
      const profileId =
        String(payload.profile_id || "default").trim() || "default";
      const userId =
        String(payload.user_id || CFG.mt5DefaultUserId).trim() ||
        CFG.mt5DefaultUserId;
      const profileName =
        String(payload.profile_name || profileId).trim() || profileId;
      const routeRaw = String(payload.route || "")
        .trim()
        .toLowerCase();
      const route = ["ea", "v2", "ctrader"].includes(routeRaw)
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

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (isActive) {
          await client.query(
            `UPDATE execution_profiles SET is_active = FALSE, updated_at = NOW() WHERE user_id = $1`,
            [userId],
          );
        }
        const res = await client.query(
          `
          INSERT INTO execution_profiles (
            profile_id, user_id, profile_name, route, account_id, source_ids,
            ctrader_mode, ctrader_account_id, is_active, metadata, created_at, updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,NOW(),NOW())
          ON CONFLICT (profile_id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            profile_name = EXCLUDED.profile_name,
            route = EXCLUDED.route,
            account_id = EXCLUDED.account_id,
            source_ids = EXCLUDED.source_ids,
            ctrader_mode = EXCLUDED.ctrader_mode,
            ctrader_account_id = EXCLUDED.ctrader_account_id,
            is_active = EXCLUDED.is_active,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
          RETURNING profile_id, user_id, profile_name, route, account_id, source_ids, ctrader_mode, ctrader_account_id,
                    is_active, metadata, created_at, updated_at
        `,
          [
            profileId,
            userId,
            profileName,
            route,
            accountId,
            JSON.stringify(sourceIds),
            ctraderMode,
            ctraderAccountId,
            isActive,
            JSON.stringify(metadata),
          ],
        );
        await client.query("COMMIT");
        return { ok: true, item: res.rows?.[0] || null };
      } catch (error) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        client.release();
      }
    },
    async updateAccountV2(accountId, patch = {}) {
      const targetId = String(accountId || "").trim();
      if (!targetId) return { ok: false, error: "account_id is required" };
      const prevRes = await pool.query(
        `SELECT * FROM user_accounts WHERE account_id = $1 LIMIT 1`,
        [targetId],
      );
      const prev = prevRes.rows[0];
      if (!prev) return { ok: false, error: "account not found" };
      const res = await pool.query(
        `
        UPDATE user_accounts
        SET user_id = $1,
            name = $2,
            balance = $3,
            status = $4,
            metadata = $5::jsonb,
            updated_at = NOW()
        WHERE account_id = $6
        RETURNING *
      `,
        [
          String(patch.user_id ?? prev.user_id ?? CFG.mt5DefaultUserId),
          String(patch.name ?? prev.name ?? targetId),
          patch.balance === undefined
            ? prev.balance === null || prev.balance === undefined
              ? null
              : Number(prev.balance)
            : patch.balance === null ||
                patch.balance === "" ||
                Number.isNaN(Number(patch.balance))
              ? null
              : Number(patch.balance),
          String(patch.status ?? prev.status ?? "ACTIVE"),
          patch.metadata && typeof patch.metadata === "object"
            ? JSON.stringify(patch.metadata)
            : prev.metadata && typeof prev.metadata === "object"
              ? JSON.stringify(prev.metadata)
              : "{}",
          targetId,
        ],
      );
      return { ok: true, item: res.rows[0] || null };
    },
    async archiveAccountV2(accountId) {
      const targetId = String(accountId || "").trim();
      if (!targetId) return { ok: false, error: "account_id is required" };
      const res = await pool.query(
        `
        UPDATE user_accounts
        SET status = 'ARCHIVED', updated_at = NOW()
        WHERE account_id = $1
        RETURNING *
      `,
        [targetId],
      );
      if (!res.rows[0]) return { ok: false, error: "account not found" };
      return { ok: true, item: res.rows[0] };
    },
    async findAccountByApiKeyHash(apiKeyHash) {
      const h = String(apiKeyHash || "").trim();
      if (!h) return null;
      const res = await pool.query(
        `
        SELECT * FROM user_accounts
        WHERE api_key_hash = $1 AND status = 'ACTIVE'
        LIMIT 1
      `,
        [h],
      );
      return res.rows[0] || null;
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
        "signals",
        "trades",
        "logs",
        "sources",
        "execution_profiles",
        "user_settings",
        "market_data",
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
        params.push(`%${query}%`);
        where = `WHERE ${validCols.map((col) => `"${col}"::text ILIKE $3`).join(" OR ")}`;
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
      const totalRes = await pool.query(
        `SELECT COUNT(*) FROM ${table} ${where}`,
        query ? [params[2]] : [],
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
        // Delete logs associated with user
        await client.query("DELETE FROM logs WHERE user_id = $1", [target]);
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
        SELECT account_id, user_id, name, balance, status, metadata, created_at, updated_at
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
      const now = mt5NowIso();
      const res = await pool.query(
        `
        INSERT INTO user_accounts (account_id, user_id, name, balance, status, metadata, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
        ON CONFLICT (account_id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          name = EXCLUDED.name,
          balance = EXCLUDED.balance,
          status = EXCLUDED.status,
          metadata = EXCLUDED.metadata,
          updated_at = EXCLUDED.updated_at
        RETURNING account_id, user_id, name, balance, status, metadata, created_at, updated_at
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
             trades_del AS (DELETE FROM trades WHERE created_at < NOW() - $1 * INTERVAL '1 day' RETURNING sid),
             logs_del AS (DELETE FROM logs WHERE created_at < NOW() - $1 * INTERVAL '1 day' RETURNING object_id)
        SELECT (SELECT COUNT(*) FROM signals_del) as signals_count,
               (SELECT COUNT(*) FROM trades_del) as trades_count,
               (SELECT COUNT(*) FROM logs_del) as logs_count
      `,
        [days],
      );
      const counts = res.rows[0];
      return {
        removed: parseInt(counts.signals_count) + parseInt(counts.trades_count),
        logs_removed: parseInt(counts.logs_count),
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
        let tradeExec = "OPEN";
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

      const logsRes = await pool.query(
        `SELECT COUNT(*) as c FROM logs${u ? " WHERE user_id = $1" : ""}`,
        params,
      );

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
        logs_count: parseInt(logsRes.rows[0].c),
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
        const lDel = await pool.query(`DELETE FROM logs WHERE user_id = $1`, [
          u,
        ]);
        return {
          ok: true,
          target,
          trades_deleted: tDel.rowCount,
          signals_deleted: sDel.rowCount,
          logs_deleted: lDel.rowCount,
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
          logs_deleted: cleanup.logs_deleted,
          files_deleted: cleanup.files_deleted,
        };
      } else if (target === "logs") {
        const whereUser = u ? " WHERE user_id = $1" : "";
        const lDel = await pool.query(
          `DELETE FROM logs${whereUser}`,
          u ? [u] : [],
        );
        return { ok: true, target, logs_deleted: lDel.rowCount };
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
        SET status = 'CANCEL', updated_at = NOW()
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
  return MT5_BACKEND;
}

async function mt5Backend() {
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
    throw new Error("volume/lots must be > 0");
  }
  return n;
}

function mt5NormalizeOrderType(payload) {
  const raw = String(payload.order_type ?? payload.orderType ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return "limit";
  if (raw === "limit" || raw === "stop" || raw === "market") return raw;
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
    s === "OPEN" ||
    s === "CLOSED" ||
    s === "REJECTED" ||
    s === "CANCELLED"
  )
    return s;
  return "OPEN";
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

function normalizeAiAnalysisContract(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const out = { ...input };

  // BARE trade_plan: AI returned trade_plan directly (no ai_full_analysis wrapper)
  // Normalize old field names → legacy market_analysis format
  if (
    !out.ai_full_analysis &&
    Array.isArray(out.trade_plan) &&
    !out.market_analysis
  ) {
    out.trade_plan = out.trade_plan.map((x) => ({
      direction: x?.direction || x?.dir || "",
      profile: x?.profile || "",
      type: x?.order_type || x?.type || "",
      session_entry: x?.session || "",
      strategy: x?.strategy || "",
      entry_model: x?.entry_model || "",
      entry: x?.entry_price ?? x?.entry ?? null,
      sl: x?.stop_loss ?? x?.sl ?? null,
      be_trigger: x?.breakeven_trigger ?? x?.be ?? null,
      tp:
        Array.isArray(x?.take_profits) && x.take_profits[2]
          ? x.take_profits[2].price
          : Array.isArray(x?.take_profits) &&
              x.take_profits[x.take_profits.length - 1]
            ? x.take_profits[x.take_profits.length - 1].price
            : (x?.tp3 ?? x?.tp1 ?? x?.tp ?? null),
      tp2: Array.isArray(x?.take_profits)
        ? (x.take_profits[1]?.price ?? null)
        : (x?.tp2 ?? null),
      tp3: Array.isArray(x?.take_profits)
        ? (x.take_profits[2]?.price ?? null)
        : (x?.tp3 ?? null),
      estimated_bars: x?.estimated_candles_to_tp1 ?? x?.estimated_bars ?? null,
      rr: x?.risk_reward ?? x?.rr ?? null,
      risk_pct: x?.risk_percent ?? x?.risk_pct ?? null,
      partial_tps: (Array.isArray(x?.take_profits) ? x.take_profits : []).map(
        (t) => ({
          price: t?.price ?? null,
          size_pct: t?.close_position_pct ?? null,
          rr: t?.reward_to_risk ?? null,
        }),
      ),
      confidence_pct: x?.confidence_pct ?? null,
      skip_recommendation:
        x?.trade_decision === "Proceed" ? "" : x?.trade_decision || "",
      reasons_to_skip: (Array.isArray(x?.skip_reasons)
        ? x.skip_reasons
        : []
      ).map((r) => ({ reason: r?.reason || "", severity: r?.severity || "" })),
      entry_condition: x?.entry_trigger || "",
      exit_condition: x?.mid_trade_invalidation || "",
      invalidation: x?.pre_entry_invalidation || "",
      note: x?.note || "",
    }));
    return out;
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
        direction: x?.direction || x?.dir || "",
        profile: x?.profile || "",
        type: x?.order_type || x?.type || "",
        session_entry: x?.session || "",
        strategy: x?.strategy || "",
        entry_model: x?.entry_model || "",
        entry: x?.entry_price ?? x?.entry ?? null,
        sl: x?.stop_loss ?? x?.sl ?? null,
        be_trigger: x?.breakeven_trigger ?? x?.be ?? null,
        tp:
          Array.isArray(x?.take_profits) && x.take_profits[2]
            ? x.take_profits[2].price
            : Array.isArray(x?.take_profits) &&
                x.take_profits[x.take_profits.length - 1]
              ? x.take_profits[x.take_profits.length - 1].price
              : (x?.tp3 ?? x?.tp ?? null),
        tp2:
          Array.isArray(x?.take_profits) && x.take_profits[1]
            ? x.take_profits[1].price
            : (x?.tp2 ?? null),
        tp3:
          Array.isArray(x?.take_profits) && x.take_profits[2]
            ? x.take_profits[2].price
            : (x?.tp3 ?? null),
        estimated_bars:
          x?.estimated_candles_to_tp1 ?? x?.estimated_bars ?? null,
        risk_pct: x?.risk_percent ?? x?.risk_pct ?? null,
        rr: x?.risk_reward ?? x?.rr ?? null,
        partial_tps: (Array.isArray(x?.take_profits) ? x.take_profits : []).map(
          (t) => ({
            price: t.price,
            size_pct: t.close_position_pct,
            rr: t.reward_to_risk,
          }),
        ),
        confluence_checklist: Array.isArray(x?.confluence_checklist)
          ? x.confluence_checklist
          : [],
        reasons_to_skip: (Array.isArray(x?.skip_reasons)
          ? x.skip_reasons
          : []
        ).map((r) => ({ reason: r.reason || "", severity: r.severity || "" })),
        skip_recommendation:
          x?.trade_decision === "Proceed" ? "" : x?.trade_decision || "",
        entry_condition: x?.entry_trigger || "",
        exit_condition: x?.mid_trade_invalidation || "",
        risk_management:
          x?.grade === "A" ? "normal" : x?.grade === "B" ? "low" : "high",
        invalidation: x?.pre_entry_invalidation || "",
        confidence_pct: x?.confidence_pct ?? x?.confluence_score ?? null,
        note: x?.note || "",
      }));
    }

    // Remove raw wrapper to avoid duplication
    delete out.ai_full_analysis;
    return out;
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
      first?.take_profits !== undefined
    ) {
      out.trade_plan = out.trade_plan.map((x) => ({
        direction: x?.direction || x?.dir || "",
        profile: x?.profile || "",
        type: x?.order_type || x?.type || "limit",
        session_entry: x?.session || "",
        strategy: x?.strategy || "",
        entry_model: x?.entry_model || "",
        entry: x?.entry_price ?? x?.entry ?? null,
        sl: x?.stop_loss ?? x?.sl ?? null,
        tp:
          Array.isArray(x?.take_profits) && x.take_profits.length > 0
            ? (x.take_profits[x.take_profits.length - 1]?.price ?? null)
            : (x?.tp3 ?? x?.tp1 ?? x?.tp ?? null),
        tp2: Array.isArray(x?.take_profits)
          ? (x.take_profits[1]?.price ?? null)
          : (x?.tp2 ?? null),
        tp3: Array.isArray(x?.take_profits)
          ? (x.take_profits[2]?.price ?? null)
          : (x?.tp3 ?? null),
        estimated_bars:
          x?.estimated_candles_to_tp1 ?? x?.estimated_bars ?? null,
        rr: x?.risk_reward ?? x?.rr ?? null,
        risk_pct: x?.risk_percent ?? x?.risk_pct ?? null,
        partial_tps: (Array.isArray(x?.take_profits) ? x.take_profits : []).map(
          (t) => ({
            price: t?.price ?? null,
            size_pct: t?.close_position_pct ?? null,
            rr: t?.reward_to_risk ?? null,
          }),
        ),
        confidence_pct: x?.confidence_pct ?? null,
        skip_recommendation:
          x?.trade_decision === "Proceed" ? "" : x?.trade_decision || "",
        reasons_to_skip: (Array.isArray(x?.skip_reasons)
          ? x.skip_reasons
          : []
        ).map((r) => ({
          reason: r?.reason || "",
          severity: r?.severity || "",
        })),
        entry_condition: x?.entry_trigger || "",
        exit_condition: x?.mid_trade_invalidation || "",
        invalidation: x?.pre_entry_invalidation || "",
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
        x?.tp3 ??
        (Array.isArray(x?.tps) && x.tps[2]
          ? (x.tps[2].price ?? null)
          : Array.isArray(x?.tps) && x.tps.length
            ? (x.tps[x.tps.length - 1]?.price ?? null)
            : (x?.tp ?? null)),
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
  return out;
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
  const configRes = await db.query(
    "SELECT name, data FROM user_settings WHERE user_id = $1 AND type = 'api_key'",
    [userId],
  );
  for (const row of configRes.rows || []) {
    const name = normalizeAiApiKeyName(row?.name);
    const dec = decryptObject(
      row?.data && typeof row.data === "object" ? row.data : {},
    );
    if (ALLOWED_AI_API_KEY_NAMES.has(name) && dec?.value) {
      out[name] = String(dec.value || "");
    }
    if (dec && typeof dec === "object") {
      Object.assign(out, dec);
    }
  }
  return out;
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
        return {
          ...cached,
          symbol: symbolNorm,
          symbol_norm: symbolNorm,
          timeframe: tfNorm,
          tf_norm: tfNorm,
          bar_start: s,
          bar_end: e,
          status: "ok",
          cache_source: "memory",
        };
      }
    }
    // Fallback to DB
    console.log(`[twelve] DB_READ sym=${symbolNorm} tf=${tfNorm}`);
    const dbHit = await marketDataDbRead(
      symbolNorm,
      tfNorm,
      reqRange.start,
      reqRange.end,
    ).catch((e) => {
      console.error(`[twelve] DB_ERROR: ${e.message}`);
      return null;
    });

    if (dbHit && Array.isArray(dbHit.bars) && dbHit.bars.length) {
      tfCacheSet(symbolNorm, tfNorm, dbHit);
      return {
        ...dbHit,
        cache_source: "db",
        symbol_norm: symbolNorm,
        tf_norm: tfNorm,
      };
    }
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
    await marketDataDbUpsert(symbolNorm, tfNorm, snapshot).catch(() => {});
    return snapshot;
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
  const rrPlanned = asNum(payload.rr ?? payload.risk_reward, NaN);
  const riskMoneyPlanned = asNum(
    payload.risk_money ?? payload.money_risk ?? payload.riskMoney,
    NaN,
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
  const allowed = ["FAIL", "START", "TP", "SL", "CANCEL", "EXPIRED", "PLACED"];
  if (!allowed.includes(normalized)) {
    throw new Error(
      "status must be one of: FAIL, START, TP, SL, CANCEL, EXPIRED, PLACED",
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
  const s = String(
    raw.status || raw.execution_status || raw.reason || raw.close_reason || "",
  )
    .trim()
    .toUpperCase();
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

async function mt5PullAndLockNextSignal() {
  const b = await mt5Backend();
  return b.pullAndLockNextSignal();
}

async function mt5PullAndLockSignalById(signalId) {
  const b = await mt5Backend();
  return b.pullAndLockSignalById(signalId);
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
  if (!b?.query) return null;
  const rows = await b.query(
    `
    SELECT
      sid,
      raw_json->>'entry' AS entry_raw,
      raw_json->>'price' AS price_raw,
      raw_json->>'entry_price' AS entry_price_raw
    FROM signals
    WHERE user_id = $1
      AND symbol = $2
      AND sl IS NOT NULL
      AND tp IS NOT NULL
      AND ABS(sl - $3) <= 1e-8
      AND ABS(tp - $4) <= 1e-8
    ORDER BY created_at DESC
    LIMIT 500
  `,
    [userId, symbol, sl, tp],
  );
  const EPS = 1e-8;
  for (const row of rows.rows || []) {
    const rowEntry = Number(
      row.entry_raw ?? row.price_raw ?? row.entry_price_raw,
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
      const res = await b.query(
        `SELECT raw_json FROM signals WHERE sid = ANY($1::text[])`,
        [signalIdList],
      );
      for (const row of res.rows || [])
        collectSnapshotFilesFromValue(row?.raw_json, fileSet);
    } catch {
      // ignore fetch failure; continue best effort
    }
    try {
      const res = await b.query(
        `SELECT sid FROM trades WHERE sid = ANY($1::text[])`,
        [signalIdList],
      );
      for (const row of res.rows || []) {
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
      const res = await b.query(
        `SELECT metadata FROM trades WHERE sid = ANY($1::text[])`,
        [allTradeIds],
      );
      for (const row of res.rows || [])
        collectSnapshotFilesFromValue(row?.metadata, fileSet);
    } catch {
      // ignore fetch failure
    }
  }

  const filesDeleted = deleteSnapshotFilesByName([...fileSet]);

  const where = [];
  const params = [];
  if (signalIdList.length > 0) {
    params.push(signalIdList);
    const p = `$${params.length}::text[]`;
    where.push(`object_id = ANY(${p})`);
    where.push(`(metadata->>'signal_id') = ANY(${p})`);
  }
  if (allTradeIds.length > 0) {
    params.push(allTradeIds);
    const p = `$${params.length}::text[]`;
    where.push(`object_id = ANY(${p})`);
    where.push(`(metadata->>'trade_id') = ANY(${p})`);
  }

  let logsDeleted = 0;
  if (where.length > 0) {
    const del = await b.query(
      `DELETE FROM logs WHERE ${where.join(" OR ")}`,
      params,
    );
    logsDeleted = Number(del?.rowCount || 0);
  }

  return { logs_deleted: logsDeleted, files_deleted: filesDeleted };
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

async function mt5UpsertSourceV2(source) {
  const b = await mt5Backend();
  if (!b.upsertSourceV2) return null;
  return b.upsertSourceV2(source);
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
) {
  const b = await mt5Backend();
  if (!b.pullLeasedTradesV2) return [];
  return b.pullLeasedTradesV2(accountId, maxItems, leaseSeconds);
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

async function mt5ListSourcesV2() {
  const b = await mt5Backend();
  if (b.listSourcesV2) return b.listSourcesV2();
  const rows = await b.listLogs({ object_table: "sources" }, 100);
  return rows
    .map((r) => ({ ...r.metadata, source_id: r.object_id }))
    .filter((r) => String(r.source_id || "").trim());
}

async function mt5GetSourceByIdV2(sourceId) {
  const b = await mt5Backend();
  if (!b.getSourceByIdV2) return null;
  return b.getSourceByIdV2(sourceId);
}

async function mt5ListSourceEventsV2(sourceId, limit = 100) {
  const b = await mt5Backend();
  return b.listLogs({ object_table: "sources", object_id: sourceId }, limit);
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

async function mt5ListTradeEventsV2(tradeId, limit = 200) {
  const b = await mt5Backend();
  return b.listLogs({ object_id: tradeId }, limit);
}

async function mt5ResolveTradeRefV2(tradeRef, userId = null) {
  const ref = String(tradeRef || "").trim();
  if (!ref) return null;
  const b = await mt5Backend();
  if (!b?.query) return null;
  const numericId = mt5ParseNumericId(ref);
  const params = [numericId, ref];
  let whereUser = "";
  if (userId) {
    params.push(String(userId));
    whereUser = ` AND user_id = $${params.length}`;
  }
  const res = await b.query(
    `
    SELECT id, sid, user_id
    FROM trades
    WHERE (
      ($1::bigint IS NOT NULL AND id = $1::bigint)
      OR sid = $2
    )
    ${whereUser}
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 1
  `,
    params,
  );
  return res.rows?.[0] || null;
}

async function mt5ResolveSignalRefV2(signalRef, userId = null) {
  const ref = String(signalRef || "").trim();
  if (!ref) return null;
  const b = await mt5Backend();
  if (!b?.query) return null;
  const numericId = mt5ParseNumericId(ref);
  const params = [numericId, ref];
  let whereUser = "";
  if (userId) {
    params.push(String(userId));
    whereUser = ` AND user_id = $${params.length}`;
  }
  const res = await b.query(
    `
    SELECT id, sid, user_id
    FROM signals
    WHERE (
      ($1::bigint IS NOT NULL AND id = $1::bigint)
      OR sid = $2
    )
    ${whereUser}
    ORDER BY created_at DESC
    LIMIT 1
  `,
    params,
  );
  return res.rows?.[0] || null;
}

async function mt5ListAccountsV2(userId = null) {
  const b = await mt5Backend();
  if (!b.listAccountsV2) return [];
  return b.listAccountsV2(userId);
}

async function mt5ListExecutionProfilesV2(userId = null) {
  const b = await mt5Backend();
  if (!b.listExecutionProfilesV2) return [];
  return b.listExecutionProfilesV2(userId);
}

async function mt5GetActiveExecutionProfileV2(userId = null) {
  const b = await mt5Backend();
  if (!b.getActiveExecutionProfileV2) return null;
  return b.getActiveExecutionProfileV2(userId);
}

async function mt5SaveExecutionProfileV2(payload = {}) {
  const b = await mt5Backend();
  if (!b.saveExecutionProfileV2) return { ok: false, error: "not supported" };
  return b.saveExecutionProfileV2(payload);
}

async function mt5RotateSourceSecretV2(sourceId) {
  const b = await mt5Backend();
  if (!b.rotateSourceSecretV2) return null;
  return b.rotateSourceSecretV2(sourceId);
}

async function mt5RevokeSourceSecretV2(sourceId) {
  const b = await mt5Backend();
  if (!b.revokeSourceSecretV2) return { ok: false, error: "not supported" };
  return b.revokeSourceSecretV2(sourceId);
}

async function mt5GetAccountSubscriptionsV2(accountId) {
  const b = await mt5Backend();
  if (!b.getAccountSubscriptionsV2) return [];
  return b.getAccountSubscriptionsV2(accountId);
}

async function mt5ReplaceAccountSubscriptionsV2(accountId, items = []) {
  const b = await mt5Backend();
  if (!b.replaceAccountSubscriptionsV2)
    return { ok: false, error: "not supported" };
  return b.replaceAccountSubscriptionsV2(accountId, items);
}

async function mt5ListSignalEvents(signalId, limit = 200) {
  const b = await mt5Backend();
  return b.listLogs({ object_id: signalId }, limit);
}

async function mt5ListActiveSignals() {
  const b = await mt5Backend();
  return b.listActiveSignals();
}

async function mt5BulkAckSignals(updates) {
  const b = await mt5Backend();
  return b.bulkAckSignals(updates);
}

async function mt5ListAllEvents(limit = 1000, offset = 0, filters = {}) {
  const b = await mt5Backend();
  if (!b.listAllEvents) return [];
  return b.listAllEvents(limit, offset, filters);
}

async function mt5DeleteAllEvents() {
  const b = await mt5Backend();
  if (!b.deleteAllEvents) return { deleted: 0 };
  const res = await b.deleteAllEvents();
  // Postgres returns rowCount, SQLite returns changes
  return { deleted: res.rowCount ?? res.changes ?? 0 };
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
    if (source && mt5StrategyFromRow(r) !== source) return false;
    if (entryModel && mt5EntryModelFromRow(r) !== entryModel) return false;
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
  let rows = mt5FilterRows(await mt5ListSignals(limit, ""), {
    userId: filters.userId,
    symbol: filters.symbol,
    source: filters.source,
    entryModel: filters.entryModel,
    chartTf: filters.chartTf,
    signalTf: filters.signalTf,
    statuses: filters.statuses,
    from: filters.from,
    to: filters.to,
  });
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
    return s === "CLOSED" || s === "TP" || s === "SL";
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
  if (["NEW", "LOCKED", "PLACED", "START"].includes(s)) return "OPEN";
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

function mt5ComputeTradeMetrics(rows) {
  const all = Array.isArray(rows) ? rows : [];

  // Count by status tiers using all rows
  // trades table uses: PENDING, OPEN, CLOSED, CANCELLED
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
    return ["OPEN", "PLACED", "FILLED"].includes(s);
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
    return ["CLOSED", "TP", "SL"].includes(s);
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
        error: "v2 broker auth not supported by backend",
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
  <meta name="viewport" content="width=device-width, initial-scale=1" />
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

async function executeMt5(signal) {
  if (!CFG.mt5Enabled) {
    return { broker: "mt5", status: "skipped", reason: "MT5_ENABLED=false" };
  }
  if (CFG.mt5EaApiKeys.size === 0) {
    return {
      broker: "mt5",
      status: "skipped",
      reason: "Missing MT5_EA_API_KEYS (or SIGNAL_API_KEY fallback)",
    };
  }

  const enqueue = await mt5EnqueueSignalFromPayload(
    {
      id: signal.raw?.id || "",
      action: signal.side,
      symbol: signal.symbol,
      volume:
        signal.quantity && signal.quantity > 0
          ? signal.quantity
          : CFG.mt5DefaultLot,
      sl: signal.sl ?? null,
      tp: signal.tp ?? null,
      rr: signal.rr_planned ?? null,
      risk_money: signal.risk_money_planned ?? null,
      price: signal.price ?? null,
      strategy: signal.strategy || null,
      entry_model:
        signal.entry_model ||
        signal.raw?.entry_model ||
        signal.raw?.entryModel ||
        signal.strategy ||
        null,
      timeframe: signal.timeframe || null,
      sourceTf:
        signal.raw?.sourceTf ??
        signal.raw?.signal_tf ??
        signal.timeframe ??
        null,
      chartTf:
        signal.raw?.chartTf ??
        signal.raw?.chart_tf ??
        signal.raw?.chartTimeframe ??
        signal.raw?.chart_tf_period ??
        null,
      note: signal.note || "",
      user_id: signal.user_id || CFG.mt5DefaultUserId,
      order_type: signal.raw?.order_type ?? signal.raw?.orderType ?? "limit",
      provider: "signal",
      raw_json: signal.raw || {},
    },
    {
      source: "signal",
      eventType: "QUEUED_FROM_SIGNAL",
      fallbackIdPrefix: "sig",
    },
  );

  return {
    broker: "mt5",
    status: "queued",
    sid: enqueue.sid,
  };
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
      "Content-Type, x-api-key, x-active-user-id, Cache-Control, Pragma",
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

  // NORMALIZE PATH: Support both /webhook/path and /path for routing
  if (incomingUrl.pathname.startsWith("/webhook/")) {
    incomingUrl.pathname = incomingUrl.pathname.substring(8);
  } else if (incomingUrl.pathname === "/webhook") {
    incomingUrl.pathname = "/";
  }

  // Optimization: Any incoming webhook/POST potentially changes state
  if (req.method === "POST") {
    notifyPulse(null, "webhook");
  }
  const url = incomingUrl;
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

  if (tryServeLanding(incomingUrl, req, res, hostname)) {
    return;
  }

  if (tryServeUi(incomingUrl, req, res, hostname)) {
    return;
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

      const currentRes = await db.query(
        "SELECT metadata FROM users WHERE user_id = $1",
        [userId],
      );
      const current = currentRes.rows[0]?.metadata || {};
      const next = { ...current, ...payload };

      await db.query(
        "UPDATE users SET metadata = $1, updated_at = NOW() WHERE user_id = $2",
        [JSON.stringify(next), userId],
      );

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
      setUiSessionCookie(res, token);
      return json(res, 200, { ok: true, user: authUser });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (req.method === "POST" && url.pathname === "/auth/logout") {
    const sess = getUiSessionFromReq(req);
    if (sess.ok && sess.token) UI_SESSIONS.delete(sess.token);
    clearUiSessionCookie(res);
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
    return json(res, 200, {
      ok: true,
      service: "telegram-trading-bot",
      version: SERVER_VERSION,
      endpoints: {
        health: "/health",
        mt5Health: "/mt5/health",
        signal: "/signal",
      },
    });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res.setHeader("Cache-Control", "no-store");
    return json(res, 200, {
      ok: true,
      service: "telegram-trading-bot",
      version: SERVER_VERSION,
      binanceEnabled: CFG.binanceEnabled,
      binanceMode: CFG.binanceMode || null,
      ctraderEnabled: CFG.ctraderEnabled,
      ctraderMode: CFG.ctraderMode || null,
      mt5Enabled: CFG.mt5Enabled,
    });
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

      // Use V2 trades ledger for authoritative dashboard stats
      const tradesRes = await mt5ListTradesV2(
        {
          user_id: userId,
          account_id: accountId,
          symbol: symbol,
          source_id: sourceId,
          side:
            direction === "BUY" ? "BUY" : direction === "SELL" ? "SELL" : "",
        },
        1,
        limit,
      );

      const allRows = tradesRes.items || [];
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

      const period = mt5PeriodRange(range);
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
        const pr = mt5PeriodRange(p);
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
        if (!["CLOSED", "TP", "SL"].includes(s)) continue;
        // Use unified PnL field (pnl_realized for trades, pnl_money_realized for signals)
        const pnl = Number(r.pnl_realized ?? r.pnl_money_realized);
        if (!Number.isFinite(pnl)) continue;
        const d = new Date(r.closed_at || r.ack_at || r.created_at);
        if (!Number.isFinite(d.getTime())) continue;
        const key =
          seriesBucket === "hour"
            ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:00`
            : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
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
              allRows.map((r) => mt5StrategyFromRow(r)).filter(Boolean),
            ),
          ].sort(),
          entry_models: [
            ...new Set(
              allRows.map((r) => mt5EntryModelFromRow(r)).filter(Boolean),
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
            (r) => mt5EntryModelFromRow(r),
            { limit: 100, includeDirection: false },
          ),
          accounts: mt5ComputeTopWinrateRows(
            selectedRows,
            (r) => envStr(r.account_id),
            { limit: 100, includeDirection: false },
          ),
          sources: mt5ComputeTopWinrateRows(
            selectedRows,
            (r) => mt5StrategyFromRow(r),
            { limit: 100, includeDirection: false },
          ),
          directional: mt5ComputeTopWinrateRows(
            selectedRows,
            (r) => {
              const dir = String(r.action || r.side || "BUY").toLowerCase();
              const typeRaw = String(
                r.metadata?.type || r.raw_json?.type || r.order_type || "LIMIT",
              ).toLowerCase();
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
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (
    req.method === "GET" &&
    (url.pathname === "/v2/signals" || url.pathname === "/mt5/trades/search")
  ) {
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

  if (req.method === "POST" && url.pathname === "/v2/signals/create") {
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
        testSettings,
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
      const tp = asNum(payload.tp, NaN);
      const note = String(derived.note || payload.note || "").trim();
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
        tp: Number.isFinite(tp) ? tp : null,
        volume: volume ?? null,
        note: note || null,
        sid: tradeSidBase,
        trade_sid: tradeSidBase,
        session_prefix: sessionPrefix || null,
        metadata: {
          event_type: "UI_CREATE_TRADE_DIRECT",
          order_type: payload.order_type || "limit",
          signal_tf: signalTf,
          chart_tf: chartTf,
          provider: payload.provider || null,
          session_prefix: sessionPrefix || null,
          entry_model_raw: derived.entryModelRaw || null,
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
      return json(res, 200, {
        ok: true,
        created: fanout?.created || 0,
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
      const { rows, filters, limit } = await mt5GetFilteredTrades(
        url,
        payload,
        50000,
      );
      const ids = rows.map((r) => String(r.sid || "")).filter(Boolean);
      const updated = await mt5CancelSignalsByIds(ids);
      const cleanup = await mt5CleanupSignalTradeArtifacts({
        signalRows: rows,
        signalIds: ids,
      });
      for (const signalId of updated.updated_ids || []) {
        await mt5AppendSignalEvent(signalId, "SIGNAL_MANUAL_CANCEL", {
          via: "ui_bulk_cancel",
        });
      }
      return json(res, 200, {
        ok: true,
        updated: updated.updated || 0,
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
      const table = envStr(url.searchParams.get("table") || "signals");
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
    // If browser navigation (wants HTML), fall through to static server
    const accept = req.headers["accept"] || "";
    if (url.pathname === "/system/cache" && accept.includes("text/html")) {
      const indexPath = path.join(CFG.uiDistPath, "index.html");
      return serveUiFile(res, indexPath, req.method);
    } else {
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
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return json(res, 400, { ok: false, error: message });
      }
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

      const table = envStr(url.searchParams.get("table") || "signals");
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
      const hasExtraFilter = Boolean(
        q || typeFilter || symbolFilter || (range && range !== "all"),
      );

      const b = await mt5Backend();
      const fetchLimit = hasExtraFilter
        ? Math.max(limit + offset, 5000)
        : limit;
      const fetchOffset = hasExtraFilter ? 0 : offset;
      const rows = await b.listLogs(
        { user_id: userId },
        fetchLimit,
        fetchOffset,
      );
      let events = (rows || []).map((r) => {
        const payload =
          r?.metadata && typeof r.metadata === "object" ? r.metadata : {};
        const data =
          payload?.data && typeof payload.data === "object"
            ? payload.data
            : payload;
        const symbol = String(data?.symbol || payload?.symbol || "").trim();
        const eventType =
          String(payload.event_type || payload.event || "").trim() ||
          String(r.object_table || "LOG");
        const eventTime = String(r.created_at || "");
        const signalId = String(r.object_id || "");
        const ackTicket = String(
          data?.ticket ||
            payload?.ticket ||
            data?.ack_ticket ||
            payload?.ack_ticket ||
            "",
        );
        return {
          id: Number(r.log_id || 0),
          log_id: Number(r.log_id || 0),
          object_id: signalId,
          object_table: String(r.object_table || ""),
          created_at: eventTime,
          metadata: payload,
          event_time: eventTime,
          event_type: eventType,
          signal_id: signalId,
          ack_ticket: ackTicket,
          symbol: symbol || "N/A",
          payload_json: payload,
        };
      });
      if (hasExtraFilter) {
        events = events.filter((ev) => {
          if (
            symbolFilter &&
            String(ev.symbol || "").toUpperCase() !== symbolFilter
          )
            return false;
          if (
            typeFilter &&
            !String(ev.event_type || "")
              .toLowerCase()
              .includes(typeFilter)
          )
            return false;
          if (rangeStart || rangeEnd) {
            const ts = mt5ToMs(ev.event_time);
            if (!Number.isFinite(ts)) return false;
            if (rangeStart && ts < mt5ToMs(rangeStart)) return false;
            if (rangeEnd && ts > mt5ToMs(rangeEnd)) return false;
          }
          if (q) {
            const haystack = [
              ev.object_id,
              ev.signal_id,
              ev.ack_ticket,
              ev.symbol,
              ev.object_table,
              ev.event_type,
              JSON.stringify(ev.metadata || ev.payload_json || {}),
            ]
              .join(" ")
              .toLowerCase();
            if (!haystack.includes(q)) return false;
          }
          return true;
        });
        events = events.slice(offset, offset + limit);
      }
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
    if (!requireAdminKey(req, res, url)) return;
    try {
      const userId = uiEffectiveUserId(req, url);
      const items = await mt5ListAccountsV2(userId);
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
    if (!requireAdminKey(req, res, url)) return;
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
  // AI HUB API
  // =========================
  if (req.method === "GET" && url.pathname === "/v2/ai/templates") {
    if (!requireAdminKey(req, res, url)) return;
    try {
      const db = await mt5InitBackend();
      const { rows } = await db.query(
        "SELECT id as template_id, name, data FROM user_templates WHERE user_id = $1 ORDER BY created_at DESC",
        [CFG.mt5DefaultUserId],
      );
      // Flatten data for frontend compatibility
      const templates = rows.map((r) => ({
        template_id: r.template_id,
        name: r.name,
        ...r.data,
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
      const { template_id, name, ...data } = payload;
      let row;
      if (template_id) {
        const { rows } = await db.query(
          "UPDATE user_templates SET data = $1, name = $2, updated_at = NOW() WHERE id = $3 RETURNING id, name, data",
          [data, name || data.name || "Unnamed Template", template_id],
        );
        row = rows[0];
      } else {
        const { rows } = await db.query(
          "INSERT INTO user_templates (user_id, name, data) VALUES ($1, $2, $3) RETURNING id, name, data",
          [CFG.mt5DefaultUserId, name || data.name || "New Template", data],
        );
        row = rows[0];
      }

      await StateRepo.del("USER_TEMPLATES", CFG.mt5DefaultUserId);
      return json(res, 201, {
        ok: true,
        template: { template_id: row.id, name: row.name, ...row.data },
      });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/ai/config") {
    if (!requireAdminKey(req, res, url)) return;
    try {
      const db = await mt5InitBackend();
      const { rows } = await db.query(
        "SELECT data as settings FROM user_settings WHERE type = 'api_key' AND user_id = $1",
        [CFG.mt5DefaultUserId],
      );
      const rawSettings = rows[0]?.settings || {};
      const settings = decryptObject(rawSettings); // Decrypt for frontend
      return json(res, 200, { ok: true, config: { settings } });
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
        const encValue = encryptData(String(body.value));
        await db
          .query(
            `
          INSERT INTO user_settings (user_id, type, name, data)
          VALUES ($1, 'api_key', 'default', jsonb_build_object($2, $3))
          ON CONFLICT (user_id, type, name)
          DO UPDATE SET data = user_settings.data || jsonb_build_object($2, $3), updated_at = NOW()
        `,
            [userId, body.key, encValue],
          )
          .catch(async () => {
            // Fallback for systems without the partial unique index
            const existing = await db.query(
              "SELECT id, data FROM user_settings WHERE user_id=$1 AND type='api_key'",
              [userId],
            );
            if (existing.rows.length) {
              const oldData =
                existing.rows[0].data &&
                typeof existing.rows[0].data === "object"
                  ? existing.rows[0].data
                  : {};
              const newData = { ...oldData, [body.key]: encValue };
              await db.query(
                "UPDATE user_settings SET data=$1, updated_at=NOW() WHERE id=$2",
                [newData, existing.rows[0].id],
              );
            } else {
              await db.query(
                "INSERT INTO user_settings (user_id, type, data) VALUES ($1, 'api_key', $2)",
                [userId, { [body.key]: encValue }],
              );
            }
          });
      } else {
        // Bulk settings update
        const settings = encryptObject(body.settings || body || {});
        await db
          .query(
            `
          INSERT INTO user_settings (user_id, type, name, data)
          VALUES ($1, 'api_key', 'default', $2)
          ON CONFLICT (user_id, type, name)
          DO UPDATE SET data = $2, updated_at = NOW()
        `,
            [userId, settings],
          )
          .catch(async () => {
            const existing = await db.query(
              "SELECT id FROM user_settings WHERE user_id=$1 AND type='api_key'",
              [userId],
            );
            if (existing.rows.length) {
              await db.query(
                "UPDATE user_settings SET data=$1, updated_at=NOW() WHERE id=$2",
                [settings, existing.rows[0].id],
              );
            } else {
              await db.query(
                "INSERT INTO user_settings (user_id, type, data) VALUES ($1, 'api_key', $2)",
                [userId, settings],
              );
            }
          });
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
      await db.query(
        `
        INSERT INTO user_settings (user_id, type, name, data, status)
        VALUES
          ($1, 'cron', 'market_data', $2::jsonb, 'INACTIVE'),
          ($1, 'cron', 'ai_analysis', $3::jsonb, 'INACTIVE')
        ON CONFLICT (user_id, type, name) DO NOTHING
      `,
        [
          userId,
          JSON.stringify({
            enabled: false,
            provider: "twelvedata",
            timezone: CFG.marketDataDefaultTimezone,
            symbols: [],
            timeframes: ["1m", "5m", "15m"],
            batch_size: CFG.marketDataCronBatchSize,
            last_sync: {},
          }),
          JSON.stringify({
            enabled: false,
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
          }),
        ],
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
      const field = String(url.searchParams.get("field") || "value").trim();
      if (!type || !name)
        return json(res, 400, { ok: false, error: "Missing type or name" });
      if (type !== "api_key")
        return json(res, 400, {
          ok: false,
          error: "Secret reveal is only supported for api_key type",
        });

      const db = await mt5InitBackend();
      const userId = sess.user_id || CFG.mt5DefaultUserId;
      const rowRes = await db.query(
        "SELECT data FROM user_settings WHERE user_id = $1 AND type = $2 AND name = $3 LIMIT 1",
        [userId, type, name],
      );
      if (!rowRes.rows.length)
        return json(res, 404, { ok: false, error: "Setting not found" });

      const enc =
        rowRes.rows[0]?.data && typeof rowRes.rows[0].data === "object"
          ? rowRes.rows[0].data
          : {};
      const dec = decryptObject(enc);
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
        const rawValue = String(payloadData.value || "").trim();
        data = encryptObject({ value: rawValue });
      }

      const res2 = await db.query(
        `
        INSERT INTO user_settings (user_id, type, name, data, status)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, type, name)
        DO UPDATE SET data = EXCLUDED.data, status = EXCLUDED.status, updated_at = NOW()
        RETURNING *
      `,
        [
          userId,
          body.type,
          settingName || body.type,
          data,
          body.status || "active",
        ],
      );

      await StateRepo.del("USER_SETTINGS", userId);

      return json(res, 200, { ok: true, item: res2.rows[0] });
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
      const parts = url.pathname.split("/"); // ["", "v2", "settings", type, name]
      const type = decodeURIComponent(parts[3] || "");
      const name = decodeURIComponent(parts[4] || "");

      if (!type || !name)
        return json(res, 400, { ok: false, error: "Missing type or name" });
      const db = await mt5InitBackend();
      const userId = sess.user_id || CFG.mt5DefaultUserId;
      await db.query(
        "DELETE FROM user_settings WHERE user_id = $1 AND type = $2 AND name = $3",
        [userId, type, name],
      );
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
      await db.query("DELETE FROM user_templates WHERE id = $1", [templateId]);
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
      const userId = CFG.mt5DefaultUserId;
      const sessionId = `ai_gen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await (
        await mt5Backend()
      ).log(sessionId, "ai", { event: "AI_ANALYSIS", payload: body }, userId);

      let finalPrompt = customPrompt || "";
      if (templateId) {
        const { rows } = await db.query(
          "SELECT data FROM user_templates WHERE id = $1",
          [templateId],
        );
        if (rows.length)
          finalPrompt = rows[0].data.prompt_text || rows[0].data.prompt;
      }

      const configRes = await db.query(
        "SELECT name, data FROM user_settings WHERE user_id = $1 AND type = 'api_key'",
        [userId],
      );
      const config = {};
      for (const row of configRes.rows || []) {
        const name = normalizeAiApiKeyName(row?.name);
        const dec = decryptObject(
          row?.data && typeof row.data === "object" ? row.data : {},
        );
        if (ALLOWED_AI_API_KEY_NAMES.has(name) && dec?.value) {
          config[name] = String(dec.value || "");
        }
        // Backward compatibility: old payloads may store key/value directly in data object.
        if (dec && typeof dec === "object") {
          Object.assign(config, dec);
        }
      }

      const { rows: tRows } = templateId
        ? await db.query("SELECT data FROM user_templates WHERE id = $1", [
            templateId,
          ])
        : { rows: [] };
      const tData = tRows[0]?.data || {};

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

      const sess = getUiSessionFromReq(req);
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
          max_tokens: 4500,
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
        const parsed = normalizeAiAnalysisContract(JSON.parse(cleanJson));
        if (
          parsed.bias ||
          parsed.analysis ||
          parsed.key_levels ||
          parsed.market_analysis ||
          parsed.trade_plan ||
          parsed.final_verdict
        ) {
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            parsed.schema_version = AI_RESPONSE_SCHEMA_VERSION;
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
            await marketDataDbWrite(symbolNorm, tfNorm, {
              bar_start: barStart,
              bar_end: barEnd,
              bars: bars,
              metadata: analysisResult,
            }).catch((e) =>
              console.error("[ai-gen] DB Write Failed:", e.message),
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
        lookbackBars: body.lookbackBars,
        format: body.format,
        quality: body.quality,
      });
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
        provider: body.provider,
        session_prefix: body.session_prefix || body.sessionPrefix || "",
        timeframes: body.timeframes,
        width: body.width,
        height: body.height,
        theme: body.theme,
        lookbackBars: body.lookbackBars,
        format: body.format,
        quality: body.quality,
      });
      return json(res, 200, { ok: true, items });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
                format: body.format || "jpg",
                quality: body.quality || 55,
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

      return json(res, 200, {
        ok: true,
        snapshot,
        source,
        updated_time,
        auto_refresh,
      });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/v2/chart/context") {
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
      const symbol = String(url.searchParams.get("symbol") || "").trim();
      if (!symbol)
        return json(res, 400, { ok: false, error: "symbol is required" });
      const timeframes = String(
        url.searchParams.get("tfs") ||
          url.searchParams.get("timeframes") ||
          "D,4H,1H,15M",
      )
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      const bars = Math.max(
        50,
        Math.min(Number(url.searchParams.get("bars") || 300) || 300, 1000),
      );
      const provider = String(
        url.searchParams.get("provider") || "ICMARKETS",
      ).trim();
      const forceRefresh = asBool(url.searchParams.get("refresh"), false);
      const forceSnapshot = asBool(
        url.searchParams.get("snapshot_refresh"),
        false,
      );
      const includeSnapshots = asBool(
        url.searchParams.get("include_snapshots"),
        false,
      );
      const bundle = UPLOAD_TO_CLAUDE
        ? await buildAiContextBundle({
            userId,
            apiKey: claudeKey,
            symbol,
            timeframes,
            bars,
            provider,
            forceRefresh,
            forceSnapshot,
            includeSnapshots,
          })
        : { symbol, timeframes: [], context_files: [] };
      return json(res, 200, { ok: true, ...bundle });
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
      };
      const inferSymbolFromSnapshotFile = (fileNameRaw) => {
        const safe = String(fileNameRaw || "").trim();
        if (!safe) return "";
        const base = path
          .basename(safe)
          .replace(/\.(png|jpe?g)$/i, "")
          .toUpperCase();
        const parts = base.split("_").filter(Boolean);
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
          const hasDup =
            parts.length >= 4 && /^\d+$/.test(parts[parts.length - 1]);
          symbolParts = parts.slice(0, hasDup ? -3 : -2);
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
      ensureChartSnapshotDir();
      const userId = sess.user_id || CFG.mt5DefaultUserId;
      const sessionId = `ai_analyze_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await (
        await mt5Backend()
      ).log(sessionId, "ai", { event: "AI_ANALYSIS", payload: body }, userId);
      await (
        await mt5Backend()
      ).log(sessionId, "ai", analyzeReqSummary, userId);
      const claudeKey = await loadClaudeApiKeyForUser(userId);
      if (!claudeKey)
        return json(res, 400, {
          ok: false,
          error: "CLAUDE_API_KEY is missing in Settings.",
        });

      let useContextFiles =
        body.use_context_files === true ||
        String(body.context_mode || "").toLowerCase() === "claude";
      const contextSymbol =
        String(body.symbol || "").trim() ||
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
        content.push({ type: "text", text: finalPrompt });
        const requestModel =
          String(body.model || "claude-sonnet-4-0").trim() ||
          "claude-sonnet-4-0";
        const out = await anthropicMessagesWithFallback({
          apiKey: claudeKey,
          model: requestModel,
          messages: [{ role: "user", content }],
          maxTokens: Number(body.max_tokens || 4500),
          timeoutMs: 180000,
          beta: ANTHROPIC_FILES_BETA,
        });
        const aiRes = out.response;
        const resolvedModel = out.modelUsed || requestModel;
        if (!aiRes.ok) {
          const errText = await aiRes.text();
          throw new Error(`Claude API Error (${aiRes.status}): ${errText}`);
        }
        const aiJson = await aiRes.json();
        const rawResponse = Array.isArray(aiJson?.content)
          ? aiJson.content
              .filter((x) => x?.type === "text")
              .map((x) => String(x?.text || ""))
              .join("\n")
          : String(aiJson?.content || "");
        const extracted = extractJsonFromAiText(rawResponse);
        const parsedJson = normalizeAiAnalysisContract(extracted.parsed || {});
        console.log(
          "[ai-response] symbol=" +
            (parsedJson?.symbol || "?") +
            " plans=" +
            (Array.isArray(parsedJson?.trade_plan)
              ? parsedJson.trade_plan.length
              : 0) +
            " has_analysis=" +
            !!parsedJson?.market_analysis,
        );
        if (!parsedJson?.market_analysis && !parsedJson?.ai_full_analysis) {
          console.log(
            "[ai-response] WARN: bare trade_plan. raw:",
            rawResponse.slice(0, 500),
          );
        }
        if (
          parsedJson &&
          typeof parsedJson === "object" &&
          !Array.isArray(parsedJson)
        ) {
          parsedJson.schema_version = AI_RESPONSE_SCHEMA_VERSION;
        }
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
          schema_version: AI_RESPONSE_SCHEMA_VERSION,
          used_files: usedSnapshotFiles,
          claude_files_mode: "context_files",
          claude_files: contextBundle.context_files,
          analysis_files: analysisFileUploads,
          context_bundle: contextBundle,
          raw_response: rawResponse,
          parsed_json: parsedJson,
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
      const requestedTfs = parseRequestedTimeframes();
      const requestedSymbol = normalizeSymbolLoose(body.symbol || "");
      const requestedProvider = String(body.provider || "ICMARKETS")
        .trim()
        .toUpperCase();
      const pickSnapshotFiles = (items) => {
        if (!items.length) return [];
        if (!requestedTfs.length) return items.slice(0, 4).map((x) => x.f);
        const byTf = new Map();
        for (const item of items) {
          const parts = String(item.f || "").split("_");
          const tfRaw = parts.length >= 3 ? parts[2] : "";
          const tf = normalizeTf(tfRaw);
          if (!tf || byTf.has(tf)) continue;
          byTf.set(tf, item.f);
          if (byTf.size >= requestedTfs.length) break;
        }
        const ordered = requestedTfs.map((tf) => byTf.get(tf)).filter(Boolean);
        if (ordered.length) return ordered.slice(0, 4);
        return items.slice(0, 4).map((x) => x.f);
      };
      let files = Array.isArray(body.files)
        ? body.files.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      if (!files.length) {
        const allSnapshots = fs
          .readdirSync(CHART_SNAPSHOT_DIR)
          .filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
          .map((f) => {
            const st = fs.statSync(path.join(CHART_SNAPSHOT_DIR, f));
            return { f, t: Number(st.mtimeMs || 0) };
          })
          .sort((a, b) => b.t - a.t);
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
        const pool = sessionMatched.length
          ? sessionMatched
          : symbolMatched.length
            ? symbolMatched
            : allSnapshots;
        files = pickSnapshotFiles(pool);
      }
      if (!files.length && requestedSymbol) {
        try {
          const created = await captureTradingViewSnapshotsBatch({
            symbol: requestedSymbol,
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
                .slice(0, 4)
            : [];
        } catch (captureError) {
          console.warn(
            "[snapshot-analyze] auto-capture fallback failed:",
            captureError?.message || captureError,
          );
        }
      }
      files = files.slice(0, 4);
      if (!files.length)
        return json(res, 400, {
          ok: false,
          error: "No snapshots found for analysis.",
        });

      const snapshotFiles = [];
      for (const fileNameRaw of files) {
        const safeName = path.basename(String(fileNameRaw || ""));
        if (
          !safeName ||
          safeName !== fileNameRaw ||
          !/\.(png|jpg|jpeg)$/i.test(safeName)
        )
          continue;
        const abs = path.join(CHART_SNAPSHOT_DIR, safeName);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
        const mediaType = snapshotMimeByFileName(safeName);
        if (!mediaType) continue;
        snapshotFiles.push({ fileName: safeName, abs, mediaType });
      }
      if (!snapshotFiles.length)
        return json(res, 400, {
          ok: false,
          error: "No valid snapshot images available.",
        });

      let finalPrompt =
        String(body.prompt || "").trim() ||
        "Analyze these chart snapshots and return only JSON.";

      // For text-only models (DeepSeek), inject bar data as text since they can't see images
      const requestModel =
        String(body.model || "claude-sonnet-4-0").trim() || "claude-sonnet-4-0";
      if (requestModel.toLowerCase().includes("deepseek")) {
        try {
          const symbol = String(body.symbol || "").trim();
          if (symbol) {
            const db = await mt5InitBackend();
            const { rows } = await db.query(
              `SELECT symbol, tf, bar_start, bar_end, data FROM market_data
               WHERE symbol = $1 ORDER BY tf, bar_end DESC LIMIT 20`,
              [symbol],
            );
            if (rows.length) {
              const barLines = rows.map((r) => {
                const bars =
                  typeof r.data === "string"
                    ? JSON.parse(r.data)
                    : r.data?.bars || [];
                const lastBar = Array.isArray(bars)
                  ? bars[bars.length - 1]
                  : null;
                const lastPrice = lastBar?.c ?? lastBar?.close ?? null;
                return `${r.tf}: ${bars.length} bars, latest close=${lastPrice}`;
              });
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
      if (UPLOAD_TO_CLAUDE) {
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
      content.push({
        type: "text",
        text: finalPrompt,
      });

      // Map ai_provider (ai_claude/ai_openrouter/ai_*) to provider name for callAiProvider
      const aiProviderRaw = String(body.ai_provider || "")
        .replace(/^ai_/i, "")
        .trim()
        .toLowerCase();
      const aiResult = await callAiProvider({
        model: requestModel,
        provider: aiProviderRaw || "",
        messages: [{ role: "user", content }],
        maxTokens: Number(body.max_tokens || 4500),
        timeoutMs: 180000,
      });

      const rawResponse = aiResult.rawText;
      const resolvedModel = aiResult.modelUsed;
      claudeFilesMode =
        aiResult.provider === "claude"
          ? claudeFilesMode || "base64"
          : aiResult.provider;
      const extracted = extractJsonFromAiText(rawResponse);
      const parsedJson = normalizeAiAnalysisContract(extracted.parsed || {});
      console.log(
        "[ai-response] symbol=" +
          (parsedJson?.symbol || "?") +
          " plans=" +
          (Array.isArray(parsedJson?.trade_plan)
            ? parsedJson.trade_plan.length
            : 0) +
          " has_analysis=" +
          !!parsedJson?.market_analysis,
      );
      if (!parsedJson?.market_analysis && !parsedJson?.ai_full_analysis) {
        console.log(
          "[ai-response] WARN: bare trade_plan. raw:",
          rawResponse.slice(0, 500),
        );
      }
      if (
        parsedJson &&
        typeof parsedJson === "object" &&
        !Array.isArray(parsedJson)
      ) {
        parsedJson.schema_version = AI_RESPONSE_SCHEMA_VERSION;
      }

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
            await marketDataDbWrite(symbolNorm, tfNorm, {
              bar_start: barStart,
              bar_end: barEnd,
              bars: bars,
              metadata: parsedJson,
            }).catch((e) =>
              console.error("[snapshot-analyze] DB Write Failed:", e.message),
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
        schema_version: AI_RESPONSE_SCHEMA_VERSION,
        used_files:
          imagePayload.usedFiles || snapshotFiles.map((x) => x.fileName),
        claude_files_mode: claudeFilesMode,
        claude_files: imagePayload.claudeFiles || [],
        claude_files_error: claudeFilesError,
        raw_response: rawResponse,
        parsed_json: parsedJson,
        source: "remote_api",
        updated_time: Date.now(),
        auto_refresh: 0, // Analysis doesn't need auto-refresh by default
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
        "X-Claude-Content-Source": local ? "vps-local" : "claude",
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
      const files = fs
        .readdirSync(CHART_SNAPSHOT_DIR)
        .filter((f) => !reqSessionPrefix || f.includes(`_${reqSessionPrefix}_`))
        .map((f) => {
          const abs = path.join(CHART_SNAPSHOT_DIR, f);
          if (!fs.statSync(abs).isFile()) return null;
          const st = fs.statSync(abs);
          return {
            id: f.replace(/\.[^.]+$/i, ""),
            file_name: f,
            created_at: new Date(st.mtimeMs || Date.now()).toISOString(),
            size_bytes: Number(st.size || 0),
            mime_type: fileMimeByName(f),
            url: `/v2/chart/snapshots/${encodeURIComponent(f)}`,
          };
        })
        .filter(Boolean)
        .sort((a, b) =>
          String(b.created_at).localeCompare(String(a.created_at)),
        )
        .slice(0, limit);
      return json(res, 200, { ok: true, items: files });
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
      // If UI sent settings (from test button), use them directly
      const testSettings = payload.settings
        ? {
            toast: payload.settings.toast !== false,
            console_log: payload.settings.console_log === true,
            ticker: payload.settings.ticker === true,
            db_log: payload.settings.db_log !== false,
            sound: payload.settings.sound || null,
          }
        : null;
      notificationManager.handle(
        "SYSTEM_EVENT",
        payload.event || "system_event",
        {
          user_id: sess.user_id,
          page: payload.page || null,
          event: payload.event || "system_event",
          message:
            payload.message || "🧪 Test notification — all channels firing",
          type: payload.type || "info",
          notification: payload.notification !== false,
          need_refresh: payload.need_refresh || false,
          comp_refresh: payload.comp_refresh || false,
          action: payload.action || null,
          sound: payload.sound || null,
          position: payload.position || "bottom-right",
          _force_toast: true,
          _force_ticker: true,
          _force_sound: true,
          _force_db_log: true,
        },
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
      const { rows } = await db.query(
        "SELECT data FROM user_settings WHERE user_id = $1 AND type = 'notification' AND name = 'preferences'",
        [sess.user_id],
      );
      if (rows[0]?.data && typeof rows[0].data === "object")
        data = rows[0].data;
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
        await db.query(
          `INSERT INTO user_settings (user_id, type, name, data)
           VALUES ($1, 'notification_config', $2, $3)
           ON CONFLICT (user_id, type, name)
           DO UPDATE SET data = $3, updated_at = NOW()`,
          [sess.user_id, eventKey, JSON.stringify(config)],
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
      const fileName = decodeURIComponent(
        url.pathname.replace("/v2/chart/snapshots/", "") || "",
      );
      const safeName = normalizeChartFileName(fileName);
      if (!safeName) {
        return json(res, 400, { ok: false, error: "Invalid file" });
      }
      const abs = path.join(CHART_SNAPSHOT_DIR, safeName);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return json(res, 404, { ok: false, error: "File not found" });
      }
      serveUiFile(res, abs, req.method);
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
      if (!["ea", "v2", "ctrader"].includes(route)) {
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
      if (!["ea", "v2", "ctrader"].includes(route)) {
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
        : JSON.stringify({ userId, filters, page, pageSize });

      const buildResponse = async () => {
        const out = await mt5ListTradesV2(filters, page, pageSize);
        const total = Number(out?.total || 0);
        const items = Array.isArray(out?.items)
          ? out.items.map((item) => {
              const metadata =
                item?.metadata && typeof item.metadata === "object"
                  ? item.metadata
                  : {};
              const rawEntryModel =
                item?.entry_model ||
                metadata?.entry_model ||
                metadata?.entry_model_raw ||
                "";
              return {
                ...item,
                entry_model: mt5NormalizeEntryModel(rawEntryModel, {
                  fallback: item?.source_id || "manual",
                }),
              };
            })
          : [];
        return {
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
      };

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
        return json(res, 404, { ok: false, error: "trade not found" });
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
      return json(res, out?.ok ? 200 : 400, out);
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
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
        entry: Number.isFinite(entry) ? entry : null,
        sl: Number.isFinite(sl) ? sl : null,
        tp1: Number.isFinite(tp) ? tp : null,
        rr: Number.isFinite(rr) ? rr : null,
        type: rawPatch.order_type,
        note: note || null,
      };
      const b = await mt5Backend();
      const params = [
        side,
        Number.isFinite(sl) ? sl : null,
        Number.isFinite(tp) ? tp : null,
        Number.isFinite(rr) ? rr : null,
        note || null,
        JSON.stringify(rawPatch || {}),
        signalId,
        userId || null,
        asNum(payload.confidence_pct),
        payload.invalidation || null,
        asNum(payload.estimated_bars),
        payload.profile || null,
        payload.exit_condition || null,
        payload.entry_condition || null,
        payload.risk_management || null,
        payload.skip_recommendation || null,
        payload.confluence_checklist
          ? JSON.stringify(payload.confluence_checklist)
          : null,
        asNum(payload.be_trigger),
      ];
      const whereUser = userId ? "AND user_id = $8" : "";
      const resUpd = await b.query(
        `
        UPDATE signals
        SET side = COALESCE($1, side),
            sl = COALESCE($2, sl),
            tp = COALESCE($3, tp),
            rr_planned = COALESCE($4, rr_planned),
            note = COALESCE($5, note),
            raw_json = COALESCE(raw_json, '{}'::jsonb) || $6::jsonb,
            confidence_pct = COALESCE($9, confidence_pct),
            invalidation = COALESCE($10, invalidation),
            estimated_bars = COALESCE($11, estimated_bars),
            profile = COALESCE($12, profile),
            exit_condition = COALESCE($13, exit_condition),
            entry_condition = COALESCE($14, entry_condition),
            risk_management = COALESCE($15, risk_management),
            skip_recommendation = COALESCE($16, skip_recommendation),
            confluence_checklist = COALESCE($17::jsonb, confluence_checklist),
            be_trigger = COALESCE($18::numeric, be_trigger),
            updated_at = NOW()
        WHERE sid = $7
        ${whereUser}
        RETURNING *
      `,
        userId ? params : params.slice(0, 18), // userId is $8, so if it exists we need 18 params
      );
      const row = resUpd.rows?.[0];
      if (!row) return json(res, 404, { ok: false, error: "signal not found" });
      await mt5Log(
        signalId,
        "signals",
        { event_type: "SIGNAL_TRADE_PLAN_SAVED", data: rawPatch },
        row.user_id || userId || CFG.mt5DefaultUserId,
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
      const whereUser = userId ? "AND user_id = $2" : "";
      const signalRes = await b.query(
        `
        SELECT * FROM signals WHERE sid = $1 ${whereUser} LIMIT 1
      `,
        userId ? [signalId, userId] : [signalId],
      );
      const signal = signalRes.rows?.[0];
      if (!signal)
        return json(res, 404, { ok: false, error: "signal not found" });
      const raw =
        signal.raw_json && typeof signal.raw_json === "object"
          ? signal.raw_json
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
      const tp = asNum(payload.tp ?? signal.tp, NaN);
      const rr = asNum(payload.rr ?? signal.rr_planned, NaN);
      const note = String(payload.note || signal.note || "").trim();
      const tradeType = String(
        payload.trade_type || payload.order_type || raw.order_type || "limit",
      )
        .trim()
        .toLowerCase();
      const sourceId = String(
        signal.source_id || mt5SlugId(signal.source || "signal", "signal"),
      ).trim();
      const signalRawJson =
        signal.raw_json && typeof signal.raw_json === "object"
          ? signal.raw_json
          : {};
      const copiedMetadata = {
        ...signalRawJson,
        confidence_pct: asNum(
          payload.confidence_pct ??
            signal.confidence_pct ??
            signalRawJson.confidence_pct,
        ),
        invalidation:
          payload.invalidation ??
          signal.invalidation ??
          signalRawJson.invalidation,
        estimated_bars: asNum(
          payload.estimated_bars ??
            signal.estimated_bars ??
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
          payload.be_trigger ?? signal.be_trigger ?? signalRawJson.be_trigger,
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
        user_id: signal.user_id || userId || CFG.mt5DefaultUserId,
        entry_model:
          mt5NormalizeEntryModel(
            signal.entry_model ||
              raw.entry_model ||
              raw.entryModel ||
              raw.model ||
              raw.strategy ||
              "",
            { fallback: signal.source_id || signal.source || "manual" },
          ) || null,
        signal_tf: signal.signal_tf || null,
        chart_tf: signal.chart_tf || null,
        symbol: signal.symbol,
        action: side,
        entry: Number.isFinite(entry) ? entry : null,
        sl: Number.isFinite(sl) ? sl : null,
        tp: Number.isFinite(tp) ? tp : null,
        volume: asNum(payload.volume ?? raw.volume, NaN) || null,
        note: note || null,
        metadata: copiedMetadata,
      });
      await mt5Log(
        signalId,
        "signals",
        {
          event_type: "SIGNAL_CREATE_TRADE",
          data: { created: fanout?.created || 0 },
        },
        signal.user_id || userId || CFG.mt5DefaultUserId,
      );
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
      const tp = asNum(payload.tp, NaN);
      const rr = asNum(payload.rr, NaN);
      const tradeType = String(
        payload.trade_type || payload.order_type || "limit",
      )
        .trim()
        .toLowerCase();
      const note = String(payload.note || "").trim();
      const metaPatch = {
        order_type: ["limit", "market", "stop"].includes(tradeType)
          ? tradeType
          : "limit",
        rr_planned: Number.isFinite(rr) ? rr : null,
      };
      const params = [
        side,
        Number.isFinite(entry) ? entry : null,
        Number.isFinite(sl) ? sl : null,
        Number.isFinite(tp) ? tp : null,
        note || null,
        JSON.stringify(metaPatch || {}),
        tradeId,
        userId || null,
        asNum(payload.confidence_pct),
        payload.invalidation || null,
        asNum(payload.estimated_bars),
        payload.profile || null,
        payload.exit_condition || null,
        payload.entry_condition || null,
        payload.risk_management || null,
        payload.skip_recommendation || null,
        payload.confluence_checklist
          ? JSON.stringify(payload.confluence_checklist)
          : null,
        asNum(payload.be_trigger),
      ];
      const whereUser = userId ? "AND user_id = $8" : "";
      const resUpd = await (
        await mt5Backend()
      ).query(
        `
        UPDATE trades
        SET action = COALESCE($1, action),
            entry = COALESCE($2, entry),
            sl = $3,
            tp = $4,
            note = COALESCE($5, note),
            metadata = metadata || $6,
            confidence_pct = COALESCE($9, confidence_pct),
            invalidation = COALESCE($10, invalidation),
            estimated_bars = COALESCE($11, estimated_bars),
            profile = COALESCE($12, profile),
            exit_condition = COALESCE($13, exit_condition),
            entry_condition = COALESCE($14, entry_condition),
            risk_management = COALESCE($15, risk_management),
            skip_recommendation = COALESCE($16, skip_recommendation),
            confluence_checklist = COALESCE($17::jsonb, confluence_checklist),
            be_trigger = COALESCE($18::numeric, be_trigger),
            execution_status = CASE
              WHEN execution_status IN ('OPEN', 'PENDING') THEN 'PENDING_MOD'
              ELSE execution_status
            END,
            updated_at = NOW()
        WHERE sid = $7
          ${whereUser}
        RETURNING *
      `,
        userId ? params : params.slice(0, 18),
      );
      const row = resUpd.rows?.[0];
      if (!row) return json(res, 404, { ok: false, error: "trade not found" });
      await mt5Log(
        tradeId,
        "trades",
        { event_type: "TRADE_PLAN_SAVED", data: metaPatch },
        row.user_id || userId || CFG.mt5DefaultUserId,
      );
      return json(res, 200, { ok: true, item: row });
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
    url.pathname === "/v2/broker/pull"
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!CFG.mt5V2BrokerApiEnabled)
      return json(res, 404, { ok: false, error: "v2 broker api disabled" });
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
      const items = await mt5PullLeasedTradesV2(
        account.account_id,
        maxItems,
        leaseSeconds,
      );
      const resp = {
        ok: true,
        items: (items || []).map((t) => ({
          sid: t.sid,
          lease_token: t.lease_token,
          lease_expires_at: t.lease_expires_at,
          account_id: t.account_id,
          signal_id: t.sid ?? null,
          source_id: t.source_id ?? null,
          symbol: t.symbol,
          action: t.action ?? t.side ?? null,
          entry: t.entry ?? t.intent_entry ?? null,
          order_type: String(t.order_type || t.metadata?.order_type || "limit"),
          sl: t.sl ?? t.intent_sl ?? null,
          tp: t.tp ?? t.intent_tp ?? null,
          volume: t.volume ?? t.intent_volume ?? null,
          note: t.note ?? t.intent_note ?? null,
          metadata:
            t.metadata && typeof t.metadata === "object" ? t.metadata : {},
        })),
      };
      console.log(
        `[v2/broker/pull] aid=${account.account_id} items=${resp.items.length}`,
      );
      return json(res, 200, resp);
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/broker/ack") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!CFG.mt5V2BrokerApiEnabled)
      return json(res, 404, { ok: false, error: "v2 broker api disabled" });
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
        dispatch_status: result.dispatch_status,
        execution_status: result.execution_status,
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
    /^\/(webhook\/)?(v2\/broker\/(sync|reconcile)|mt5\/ea\/sync-v2)$/.test(
      url.pathname,
    )
  ) {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!CFG.mt5V2BrokerApiEnabled)
      return json(res, 404, { ok: false, error: "v2 broker api disabled" });
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
      console.error("[v2/broker/sync] failed", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      });
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/broker/heartbeat") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!CFG.mt5V2BrokerApiEnabled)
      return json(res, 404, { ok: false, error: "v2 broker api disabled" });
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
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/v2/broker/trades/create") {
    if (!CFG.mt5Enabled)
      return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!CFG.mt5V2BrokerApiEnabled)
      return json(res, 404, { ok: false, error: "v2 broker api disabled" });
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

        const resUpd = await b.query(
          `
          UPDATE trades
          SET execution_status = $1,
              pnl_realized = $2,
              closed_at = COALESCE(closed_at, $3, NOW()),
              close_reason = COALESCE($8, close_reason),
              symbol = COALESCE($5, symbol),
              volume = COALESCE($6, volume),
              order_type = COALESCE($12, order_type),
              broker_trade_id = COALESCE(NULLIF($10, ''), broker_trade_id),
              metadata = COALESCE(metadata, '{}'::jsonb) || $9::jsonb,
              updated_at = NOW()
          WHERE ($11::text = '' OR account_id = $11)
            AND (
              broker_trade_id = ANY($4::text[])
              OR metadata->>'broker_position_id' = ANY($4::text[])
              OR metadata->>'position_ticket' = ANY($4::text[])
              OR metadata->>'deal_ticket' = ANY($4::text[])
              OR metadata->>'order_ticket' = ANY($4::text[])
              OR ($7::text <> '' AND signal_id = $7)
            )
          RETURNING sid, user_id
        `,
          [
            execStatus,
            pnl,
            closeTime,
            ticketCandidates,
            u.symbol || null,
            u.volume || null,
            signalId,
            closeReason,
            syncMeta,
            ticket,
            accountId,
            u.order_type || null,
          ],
        );

        if (resUpd.rowCount > 0) {
          updatedCount++;
          const row = resUpd.rows[0];
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
            row.user_id || CFG.mt5DefaultUserId,
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
          null,
          "ea_logs",
          { level, message, account_id: accountId },
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
    mt5CronLoop().catch((err) =>
      console.error("[Cron] Loop failed to start:", err),
    );
  }

  console.log(
    `Binance mode=${CFG.binanceMode || "off"}, cTrader mode=${CFG.ctraderMode || "off"}`,
  );
}

const CRON_STATE = {
  lastMarketDataRun: {}, // { [userId_name_tf]: timestamp }
  lastAiAnalysisRun: {}, // { [userId_name_tf]: timestamp }
  isRunning: false,
};
let MARKET_DATA_QUEUE = null;
let MARKET_DATA_WORKER = null;

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
  const res = await b.query(
    `SELECT data FROM user_settings WHERE user_id = $1 AND type = 'cron' AND name = 'MARKET_DATA_CRON' LIMIT 1`,
    [userId],
  );
  if (!res.rows.length) return;
  const data =
    res.rows[0].data && typeof res.rows[0].data === "object"
      ? res.rows[0].data
      : {};
  const sync =
    data.last_sync && typeof data.last_sync === "object" ? data.last_sync : {};
  sync[key] = { ...(sync[key] || {}), ...patch };
  await b.query(
    `UPDATE user_settings
        SET data = $1::jsonb, updated_at = NOW()
      WHERE user_id = $2 AND type = 'cron' AND name = 'MARKET_DATA_CRON'`,
    [JSON.stringify({ ...data, last_sync: sync }), userId],
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

async function mt5CronLoop() {
  console.log("[Cron] Initializing master loop (1min cadence)");
  const intervalMs = 60 * 1000;

  const run = async () => {
    if (CRON_STATE.isRunning) return;
    CRON_STATE.isRunning = true;
    try {
      await mt5RunMarketDataCron();
      await mt5RunAiAnalysisCron();
    } catch (err) {
      console.error("[Cron] Run error:", err);
    } finally {
      CRON_STATE.isRunning = false;
    }
  };

  // Run immediately then on interval
  run();
  const handle = setInterval(run, intervalMs);
  handle.unref();
}

async function mt5RunMarketDataCron() {
  if (!CFG.marketDataCronEnabled) return;
  const b = await mt5Backend();
  const res = await b.query(`
    SELECT s.*
    FROM user_settings s
    JOIN users u ON s.user_id = u.user_id
    WHERE s.type = 'cron' AND s.name = 'MARKET_DATA_CRON'
      AND UPPER(s.status) = 'ACTIVE'
      AND (u.metadata->'settings'->>'data_cron')::boolean = true
  `);
  const configs = res.rows || [];
  if (!configs.length) return;

  const now = Date.now();

  for (const conf of configs) {
    const userId = conf.user_id;
    const data = conf.data || {};
    if (!marketDataCronSettingEnabled(data)) continue;
    const symbols = Array.isArray(data.symbols) ? data.symbols : [];
    const excludeSymbols = new Set(
      (Array.isArray(data.exclude_symbols) ? data.exclude_symbols : [])
        .map((s) => String(s).toUpperCase().trim())
        .filter(Boolean),
    );
    const filteredSymbols = symbols.filter(
      (s) => !excludeSymbols.has(String(s).toUpperCase().trim()),
    );
    const tfs = Array.isArray(data.timeframes) ? data.timeframes : [];
    const timezone = marketDataCronTimezone(data);

    for (const tf of tfs) {
      const tfSec = parseTfTokenToSeconds(tf);
      const stateKey = `${userId}_${conf.name}_${tf}`;
      const lastRun = CRON_STATE.lastMarketDataRun[stateKey] || 0;

      // Run if never run or if cadence passed
      if (now - lastRun >= tfSec * 1000 - 5000) {
        // 5s buffer
        console.log(
          `[Cron][MarketData] Running userId=${userId} name=${conf.name} tf=${tf} symbols=${filteredSymbols.length}`,
        );
        CRON_STATE.lastMarketDataRun[stateKey] = now;

        // Batch symbols to avoid hitting Twelve Data limits
        const batchSize =
          Number(data.batch_size || CFG.marketDataCronBatchSize) || 8;
        for (let i = 0; i < filteredSymbols.length; i += batchSize) {
          const batch = filteredSymbols.slice(i, i + batchSize);
          if (MARKET_DATA_QUEUE) {
            const bucket = Math.floor(now / (tfSec * 1000));
            await Promise.all(
              batch.map((symbol) => {
                const symbolNorm = normalizeMarketDataSymbol(symbol);
                const tfNorm = normalizeMarketDataTf(tf);
                return MARKET_DATA_QUEUE.add(
                  "fetch-bars",
                  {
                    userId,
                    settingName: conf.name || "default",
                    symbol,
                    tf,
                    timezone,
                  },
                  {
                    jobId: `market:${userId}:${conf.name || "default"}:${symbolNorm}:${tfNorm}:${bucket}`,
                  },
                );
              }),
            );
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
  }
}

async function mt5RunAiAnalysisCron() {
  const b = await mt5Backend();
  const res = await b.query(`
    SELECT s.*
    FROM user_settings s
    JOIN users u ON s.user_id = u.user_id
    WHERE s.type = 'cron' AND s.name = 'ANALYSIS_CRON'
      AND UPPER(s.status) = 'ACTIVE'
      AND (u.metadata->'settings'->>'analysis_cron')::boolean = true
  `);
  const configs = res.rows || [];
  if (!configs.length) return;

  const now = Date.now();

  for (const conf of configs) {
    const userId = conf.user_id;
    const data = conf.data || {};
    const symbols = Array.isArray(data.symbols) ? data.symbols : [];
    const tfs = Array.isArray(data.timeframes) ? data.timeframes : [];
    const cadenceMin = Number(data.cadence_minutes || 60);

    const stateKey = `${userId}_${conf.name}`;
    const lastRun = CRON_STATE.lastAiAnalysisRun[stateKey] || 0;

    if (now - lastRun >= cadenceMin * 60 * 1000 - 5000) {
      console.log(
        `[Cron][AiAnalysis] Running userId=${userId} name=${conf.name} symbols=${symbols.length}`,
      );
      CRON_STATE.lastAiAnalysisRun[stateKey] = now;

      for (const symbol of symbols) {
        for (const tf of tfs) {
          try {
            console.log(
              `[Cron][AiAnalysis] Triggering analysis for ${symbol} ${tf}`,
            );
            // Logic for automated analysis would go here.
            // Requires integration with screenshot capture or bar-only analysis.
          } catch (err) {
            console.error(
              `[Cron][AiAnalysis] Failed symbol=${symbol} tf=${tf}:`,
              err.message,
            );
          }
        }
      }
    }
  }
}

start().catch((err) => {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  console.error(`Failed to start server: ${message}`);
  process.exit(1);
});
