CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
DROP TABLE IF EXISTS ai_configs;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS trades (
  sid TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  signal_id TEXT NULL,
  source_id TEXT NULL,
  strategy TEXT NULL,
  entry_model TEXT NULL,
  signal_tf TEXT NULL,
  chart_tf TEXT NULL,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL,
  order_type TEXT NULL,
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
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS profile TEXT;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS confidence_pct FLOAT8;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS estimated_bars INT;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS be_trigger FLOAT8;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp1 FLOAT8 NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp2 FLOAT8 NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp3 FLOAT8 NULL;
--> statement-breakpoint
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_account_id_fkey;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS order_type TEXT NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy TEXT NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS rr_planned DOUBLE PRECISION NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_money_planned DOUBLE PRECISION NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_pct_planned DOUBLE PRECISION NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS planned_tp_pnl DOUBLE PRECISION NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS planned_sl_pnl DOUBLE PRECISION NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'user_name'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'name'
  ) THEN
    ALTER TABLE users RENAME COLUMN user_name TO name;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE users DROP COLUMN IF EXISTS balance_start;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS sid TEXT NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS id BIGSERIAL;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS id BIGSERIAL;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS sid TEXT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'accounts'
  ) THEN
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS id BIGSERIAL;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'accounts'
  ) THEN
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sid TEXT NULL;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'accounts'
  ) THEN
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS name TEXT;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'accounts'
  ) THEN
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance DOUBLE PRECISION NULL;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'accounts'
  ) THEN
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS api_key_hash TEXT NULL;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'accounts'
  ) THEN
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS api_key_last4 TEXT NULL;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'accounts'
  ) THEN
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS api_key_rotated_at TIMESTAMPTZ NULL;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'accounts'
  ) THEN
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS source_ids_cache JSONB NULL;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'accounts'
  ) THEN
    ALTER TABLE accounts DROP COLUMN IF EXISTS broker_id;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'side'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'action'
  ) THEN
    ALTER TABLE trades RENAME COLUMN side TO action;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'signal_sid'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'signal_id'
  ) THEN
    ALTER TABLE trades RENAME COLUMN signal_sid TO signal_id;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'broker_sid'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'broker_trade_id'
  ) THEN
    ALTER TABLE trades RENAME COLUMN broker_sid TO broker_trade_id;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'intent_entry'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'entry'
  ) THEN
    ALTER TABLE trades RENAME COLUMN intent_entry TO entry;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'intent_sl'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'sl'
  ) THEN
    ALTER TABLE trades RENAME COLUMN intent_sl TO sl;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'intent_tp'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'tp'
  ) THEN
    ALTER TABLE trades RENAME COLUMN intent_tp TO tp;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'intent_note'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'note'
  ) THEN
    ALTER TABLE trades RENAME COLUMN intent_note TO note;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS volume FLOAT8 NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS user_id TEXT NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_model TEXT NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS signal_tf TEXT NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS chart_tf TEXT NULL;
--> statement-breakpoint
ALTER TABLE trades DROP COLUMN IF EXISTS origin_kind;
--> statement-breakpoint
ALTER TABLE trades DROP COLUMN IF EXISTS intent_volume;
--> statement-breakpoint
ALTER TABLE trades DROP COLUMN IF EXISTS broker_order_id;
--> statement-breakpoint
ALTER TABLE trades DROP COLUMN IF EXISTS pulled_at;
--> statement-breakpoint
ALTER TABLE trades DROP COLUMN IF EXISTS error_code;
--> statement-breakpoint
ALTER TABLE trades DROP COLUMN IF EXISTS error_message;
--> statement-breakpoint
ALTER TABLE trades DROP COLUMN IF EXISTS broker_id;
--> statement-breakpoint
ALTER TABLE trades DROP COLUMN IF EXISTS sl_exec;
--> statement-breakpoint
ALTER TABLE trades DROP COLUMN IF EXISTS tp_exec;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS raw_json JSONB NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_pips DOUBLE PRECISION NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_lots DOUBLE PRECISION NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_commission DOUBLE PRECISION NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_swap DOUBLE PRECISION NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_volume DOUBLE PRECISION NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_pnl DOUBLE PRECISION NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_margin DOUBLE PRECISION NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_tp_pnl DOUBLE PRECISION NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS broker_sl_pnl DOUBLE PRECISION NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp1 DOUBLE PRECISION NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp2 DOUBLE PRECISION NULL;
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp3 DOUBLE PRECISION NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_exec_status ON trades(execution_status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_dispatch_queue ON trades(account_id, dispatch_status, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_signal_id ON trades(signal_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_broker_ticket ON trades(broker_trade_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id);
