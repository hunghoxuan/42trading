# System Database Schema (v2.3)

All tables use PostgreSQL with JSONB for flexible metadata.

## 1. Identity & Access

### `users`
| Column | Type | Notes |
|--------|------|-------|
| `user_id` | TEXT PK | |
| `name` | TEXT | |
| `email` | TEXT UNIQUE | |
| `password_hash` | TEXT | |
| `password_salt` | TEXT | |
| `role` | TEXT | |
| `is_active` | BOOLEAN | DEFAULT TRUE |
| `metadata` | JSONB | |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `id` | BIGSERIAL | migration |
| `sid` | TEXT | migration |

### `user_accounts`
| Column | Type | Notes |
|--------|------|-------|
| `account_id` | TEXT PK | |
| `user_id` | TEXT FK → users | NOT NULL, ON DELETE CASCADE |
| `name` | TEXT | |
| `balance` | DOUBLE PRECISION | |
| `api_key_hash` | TEXT | |
| `api_key_last4` | TEXT | |
| `api_key_rotated_at` | TIMESTAMPTZ | |
| `source_ids_cache` | JSONB | |
| `metadata` | JSONB | |
| `status` | TEXT | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| `id` | BIGSERIAL | migration |
| `sid` | TEXT | migration |

## 2. Configuration

### `user_settings`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | DEFAULT gen_random_uuid() |
| `user_id` | TEXT FK → users | NOT NULL, ON DELETE CASCADE |
| `type` | TEXT | NOT NULL — api_key, symbols, cron, system_config, others |
| `name` | TEXT | NOT NULL DEFAULT 'default' |
| `data` | JSONB | NOT NULL |
| `value` | TEXT | migration |
| `status` | TEXT | DEFAULT 'ACTIVE' |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() |
| **UNIQUE** | (user_id, type, name) | |

### `user_templates`
| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `user_id` | TEXT FK → users | ON DELETE CASCADE |
| `name` | TEXT | NOT NULL |
| `data` | JSONB | NOT NULL |
| `status` | TEXT | DEFAULT 'ACTIVE' |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() |

## 3. Trading Engine

### `signals`
| Column | Type | Notes |
|--------|------|-------|
| `signal_id` | TEXT PK | |
| `sid` | TEXT | migration |
| `created_at` | TIMESTAMPTZ | NOT NULL |
| `user_id` | TEXT FK → users | NOT NULL, ON DELETE CASCADE |
| `source` | TEXT | |
| `source_id` | TEXT | |
| `symbol` | TEXT | NOT NULL |
| `side` | TEXT | NOT NULL — BUY/SELL |
| `order_type` | TEXT | market, limit, stop |
| `entry` | DOUBLE PRECISION | |
| `entry_model` | TEXT | |
| `sl` | DOUBLE PRECISION | |
| `tp` | DOUBLE PRECISION | |
| `signal_tf` | TEXT | |
| `chart_tf` | TEXT | |
| `rr_planned` | DOUBLE PRECISION | |
| `risk_money_planned` | DOUBLE PRECISION | |
| `risk_pct_planned` | DOUBLE PRECISION | |
| `note` | TEXT | |
| `rejection_reason` | TEXT | |
| `strategy` | TEXT | |
| `profile` | TEXT | |
| `confidence_pct` | FLOAT8 | |
| `estimated_bars` | INT | |
| `be_trigger` | FLOAT8 | |
| `raw_json` | JSONB | |
| `status` | TEXT | NOT NULL DEFAULT 'NEW' |
| `id` | BIGSERIAL | migration |

### `trades`
| Column | Type | Notes |
|--------|------|-------|
| `trade_id` | TEXT PK | |
| `sid` | TEXT | migration |
| `account_id` | TEXT FK → user_accounts | NOT NULL, ON DELETE CASCADE |
| `user_id` | TEXT FK → users | NOT NULL, ON DELETE CASCADE |
| `signal_id` | TEXT FK → signals | ON DELETE SET NULL |
| `source_id` | TEXT | |
| `strategy` | TEXT | |
| `entry_model` | TEXT | |
| `signal_tf` | TEXT | |
| `chart_tf` | TEXT | |
| `symbol` | TEXT | NOT NULL |
| `action` | TEXT | NOT NULL |
| `order_type` | TEXT | market, limit, stop |
| `volume` | FLOAT8 | |
| `entry` | FLOAT8 | |
| `sl` | FLOAT8 | |
| `tp` | FLOAT8 | |
| `rr_planned` | FLOAT8 | |
| `risk_money_planned` | FLOAT8 | |
| `risk_pct_planned` | FLOAT8 | |
| `note` | TEXT | |
| `profile` | TEXT | |
| `confidence_pct` | FLOAT8 | |
| `estimated_bars` | INT | |
| `be_trigger` | FLOAT8 | |
| `lease_token` | TEXT | |
| `lease_expires_at` | TIMESTAMPTZ | |
| `dispatch_status` | TEXT | NOT NULL DEFAULT 'NEW' |
| `execution_status` | TEXT | NOT NULL DEFAULT 'PENDING' |
| `close_reason` | TEXT | |
| `rejection_reason` | TEXT | |
| `broker_trade_id` | TEXT | |
| `entry_exec` | FLOAT8 | |
| `broker_pips` | FLOAT8 | |
| `broker_lots` | FLOAT8 | |
| `broker_commission` | FLOAT8 | |
| `broker_swap` | FLOAT8 | |
| `broker_volume` | FLOAT8 | |
| `broker_pnl` | FLOAT8 | |
| `broker_margin` | FLOAT8 | |
| `broker_tp_pnl` | FLOAT8 | |
| `broker_sl_pnl` | FLOAT8 | |
| `opened_at` | TIMESTAMPTZ | |
| `closed_at` | TIMESTAMPTZ | |
| `pnl_realized` | FLOAT8 | |
| `metadata` | JSONB | |
| `last_price` | DOUBLE PRECISION | |
| `last_price_at` | TIMESTAMPTZ | |
| `raw_json` | JSONB | |
| `profile` | TEXT | |
| `confidence_pct` | FLOAT8 | |
| `invalidation` | TEXT | |
| `estimated_bars` | INT | |
| `exit_condition` | TEXT | |
| `entry_condition` | TEXT | |
| `risk_management` | TEXT | |
| `skip_recommendation` | TEXT | |
| `confluence_checklist` | JSONB | |
| `be_trigger` | FLOAT8 | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| `id` | BIGSERIAL | migration |

## 4. Execution & Sources

### `execution_profiles`
| Column | Type | Notes |
|--------|------|-------|
| `profile_id` | TEXT PK | |
| `user_id` | TEXT FK → users | NOT NULL, ON DELETE CASCADE |
| `profile_name` | TEXT | NOT NULL |
| `route` | TEXT | NOT NULL |
| `account_id` | TEXT FK → user_accounts | ON DELETE SET NULL |
| `source_ids` | JSONB | |
| `ctrader_mode` | TEXT | |
| `ctrader_account_id` | TEXT | |
| `is_active` | BOOLEAN | NOT NULL DEFAULT TRUE |
| `metadata` | JSONB | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| `id` | BIGSERIAL | migration |
| `sid` | TEXT | migration |

### `sources`
| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGSERIAL PK | |
| `sid` | TEXT UNIQUE | |
| `source_id` | TEXT UNIQUE | |
| `user_id` | TEXT FK → users | ON DELETE CASCADE |
| `name` | TEXT | |
| `type` | TEXT | |
| `status` | TEXT | DEFAULT 'ACTIVE' |
| `metadata` | JSONB | |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() |

## 5. Audit & Logs

### `logs`
| Column | Type | Notes |
|--------|------|-------|
| `log_id` | SERIAL PK | |
| `object_id` | TEXT | |
| `object_table` | TEXT | |
| `symbol` | TEXT | migration |
| `event_type` | TEXT | migration |
| `metadata` | JSONB | |
| `user_id` | TEXT FK → users | ON DELETE SET NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

### `ea_logs`
| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `account_id` | TEXT | |
| `level` | TEXT | |
| `message` | TEXT | |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `user_id` | TEXT | |

## 6. Market Data

### `market_data`
| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGSERIAL PK | |
| `symbol` | TEXT | NOT NULL |
| `tf` | TEXT | NOT NULL |
| `bar_start` | BIGINT | NOT NULL |
| `bar_end` | BIGINT | NOT NULL |
| `data` | TEXT | NOT NULL — compressed bars |
| `metadata` | JSONB | snapshot file_id/file_name |
| `last_price` | DOUBLE PRECISION | |
| `last_price_at` | TIMESTAMPTZ | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| **UNIQUE** | (symbol, tf, bar_start, bar_end) | |
| **INDEX** | (symbol, tf, bar_start, bar_end) | |
