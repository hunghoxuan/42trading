CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  password_hash TEXT,
  password_salt TEXT,
  roles TEXT,
  permissions TEXT,
  role TEXT,
  is_active INTEGER DEFAULT 1,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS trades (
  sid TEXT PRIMARY KEY,
  account_id TEXT,
  user_id TEXT NOT NULL,
  trade_id TEXT,
  source_id TEXT,
  strategy TEXT,
  entry_model TEXT,
  trade_tf TEXT,
  chart_tf TEXT,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL,
  order_type TEXT,
  volume REAL,
  entry REAL,
  sl REAL,
  tp REAL,
  tp1 REAL,
  tp2 REAL,
  tp3 REAL,
  rr_planned REAL,
  risk_pct_planned REAL,
  risk_money_planned REAL,
  confidence_pct REAL,
  estimated_bars INTEGER,
  be_trigger REAL,
  profile TEXT,
  invalidation TEXT,
  entry_condition TEXT,
  exit_condition TEXT,
  confluence_checklist TEXT,
  skip_recommendation TEXT,
  risk_management TEXT,
  note TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  dispatch_status TEXT NOT NULL DEFAULT 'NEW',
  execution_status TEXT NOT NULL DEFAULT 'PENDING',
  close_reason TEXT,
  rejection_reason TEXT,
  broker_trade_id TEXT,
  entry_exec REAL,
  broker_pips REAL,
  broker_lots REAL,
  broker_commission REAL,
  broker_swap REAL,
  broker_volume REAL,
  broker_pnl REAL,
  broker_margin REAL,
  planned_tp_pnl REAL,
  planned_sl_pnl REAL,
  broker_tp_pnl REAL,
  broker_sl_pnl REAL,
  opened_at TEXT,
  closed_at TEXT,
  pnl_realized REAL,
  metadata TEXT,
  raw_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_user_created
  ON trades(user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_created_at
  ON trades(created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_symbol
  ON trades(symbol);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_exec_status
  ON trades(execution_status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_account
  ON trades(account_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_dispatch_queue
  ON trades(account_id, dispatch_status, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_trade_id
  ON trades(trade_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_broker_ticket
  ON trades(broker_trade_id);
--> statement-breakpoint
INSERT OR IGNORE INTO users (user_id, email, roles, permissions, role)
VALUES ('default', 'System', '["admin"]', '[]', 'system');
