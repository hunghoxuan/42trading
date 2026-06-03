// Multi-backend DB — PostgreSQL or SQLite via Drizzle
const schema = require("./schema.js");

let _db = null;
let _backend = null;
let _raw = null;

const _dbInstances = new Map();

function initDb(config) {
  const backend = config?.storage?.backend || "postgres";
  const key = backend === "sqlite"
    ? `sqlite:${config?.storage?.sqlite?.path || "./trading.db"}`
    : `postgres:${config?.pool?.options?.connectionString || ""}`;
  if (_dbInstances.has(key)) return _dbInstances.get(key);

  if (backend === "sqlite") {
    const Database = require("better-sqlite3");
    const { drizzle } = require("drizzle-orm/better-sqlite3");
    const dbPath = config?.storage?.sqlite?.path || "./trading.db";
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    _raw = sqlite;
    const inst = drizzle(sqlite, { schema });
    _dbInstances.set(key, inst);
    if (!_db) _db = inst;
    _backend = "sqlite";
    _runSqliteMigration(sqlite);
    console.log(`[DB] SQLite connected: ${dbPath}`);
    return inst;
  } else {
    // PostgreSQL (default)
    const { drizzle } = require("drizzle-orm/node-postgres");
    const { Pool } = require("pg");
    const pool =
      config?.pool ||
      new Pool({
        connectionString:
          config?.storage?.postgres?.url || process.env.POSTGRES_URL,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
    const inst = drizzle(pool, { schema });
    _dbInstances.set(key, inst);
    if (!_db) _db = inst;
    _backend = "postgres";
    console.log("[DB] PostgreSQL connected");
    return inst;
  }
}

function getDb() {
  if (!_db) throw new Error("DB not initialized. Call initDb(config) first.");
  return _db;
}

function getBackend() {
  return _backend;
}

// SQLite schema migration (internal)
function _runSqliteMigration(raw) {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE,
      password_hash TEXT, password_salt TEXT, role TEXT,
      is_active INTEGER DEFAULT 1, metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_accounts (
      account_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      name TEXT, balance REAL, api_key_hash TEXT, api_key_last4 TEXT,
      api_key_rotated_at TEXT, source_ids_cache TEXT, metadata TEXT, status TEXT,
      equity REAL, margin REAL, free_margin REAL, leverage REAL, broker_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
      name TEXT NOT NULL, data TEXT NOT NULL, status TEXT DEFAULT 'ACTIVE',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_settings (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'default', type TEXT NOT NULL, data TEXT NOT NULL,
      status TEXT DEFAULT 'ACTIVE',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, type, name)
    );
    CREATE TABLE IF NOT EXISTS trades (
      sid TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES user_accounts(account_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      signal_id TEXT,
      source_id TEXT, strategy TEXT, entry_model TEXT, signal_tf TEXT, chart_tf TEXT,
      symbol TEXT NOT NULL, action TEXT NOT NULL, order_type TEXT,
      volume REAL, entry REAL, sl REAL, tp REAL, tp1 REAL, tp2 REAL, tp3 REAL,
      rr_planned REAL, risk_pct_planned REAL, risk_money_planned REAL,
      confidence_pct REAL, estimated_bars INTEGER, be_trigger REAL, profile TEXT,
      invalidation TEXT, entry_condition TEXT, exit_condition TEXT,
      confluence_checklist TEXT, skip_recommendation TEXT, risk_management TEXT,
      note TEXT, lease_token TEXT, lease_expires_at TEXT,
      dispatch_status TEXT NOT NULL DEFAULT 'NEW', execution_status TEXT NOT NULL DEFAULT 'PENDING',
      close_reason TEXT, rejection_reason TEXT, broker_trade_id TEXT,
      entry_exec REAL, broker_pips REAL, broker_lots REAL, broker_commission REAL,
      broker_swap REAL, broker_volume REAL, broker_pnl REAL, broker_margin REAL,
      planned_tp_pnl REAL, planned_sl_pnl REAL,
      broker_tp_pnl REAL, broker_sl_pnl REAL, opened_at TEXT, closed_at TEXT,
      pnl_realized REAL, metadata TEXT, raw_json TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_trades_exec ON trades(execution_status);
    CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id);
  `);

  // Seed default user
  raw.exec(
    "INSERT OR IGNORE INTO users (user_id, email, role) VALUES ('default', 'System', 'system')",
  );
  console.log("[DB] SQLite schema migrated");
}

module.exports = { initDb, getDb, getBackend, schema };
