# DB Schema (v2.5)

> Updated 2026-05-09. 11 tables, PostgreSQL with JSONB.

## Tables

| # | Table | Purpose |
|---|-------|---------|
| 1 | `users` | Auth users (email, password, role) |
| 2 | `user_accounts` | Broker accounts linked to users |
| 3 | `user_settings` | All settings: api_key, notification_config, ai_template, cron, trade, system_config, symbols |
| 4 | `accounts` | Legacy broker account data |
| 5 | `signals` | Trade signals (sid PK, status, signal_tf, chart_tf) |
| 6 | `trades` | Executed/fanned-out trades (sid PK, signal_id FK, broker_trade_id) |
| 7 | `logs` | Event log (object_id, object_table, event_type, metadata JSONB, user_id) |
| 8 | `sources` | Signal sources (source_id PK, kind, auth_mode) |
| 9 | `execution_profiles` | Per-user source subscriptions (source_ids JSONB) |
| 10 | `market_data` | Cached bar data (symbol, tf, timestamp) |
| 11 | `ea_logs` | Expert Advisor telemetry |

## Key Notes

- **`user_settings`** — used for ALL settings types: `api_key`, `notification_config`, `ai_template`, `cron`, `trade`, `system_config`, `symbols`. Replaces old `user_templates` (dropped 2026-05-09).
- **`user_templates`** — DROPPED. Templates now in `user_settings` with type='ai_template'.
- **`ai_templates`** — DROPPED long ago. Migrated then removed.
- **`ai_analysis`** — NOT a table. A `user_settings` row (type='cron', name='ai_analysis') for cron schedule.
- **`accounts`** — Legacy table, still present on VPS.
- **`logs` metadata** — Structure: `{ status, error, data: {...}, payload, response }`. Status defaults to "OK", "ERROR" if error present.
