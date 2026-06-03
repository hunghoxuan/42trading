# DB Schema (v2.6)

> Updated 2026-05-17. 11 tables, PostgreSQL with JSONB.

## Tables

| # | Table | Purpose |
|---|-------|---------|
| 1 | `users` | Auth users (email, password, role) |
| 2 | `user_accounts` | Broker accounts linked to users |
| 3 | `user_settings` | All settings: api_key, notification_config, ai_template, cron, trade, system_config, symbols |
| 4 | `signals` | Trade signals (sid PK, status, signal_tf, chart_tf) |
| 5 | `trades` | Executed/fanned-out trades (sid PK, signal_id FK, broker_trade_id) |
| 6 | `logs` | Event log (object_id, object_table, event_type, metadata JSONB, user_id) |
| 7 | `sources` | Signal sources (source_id PK, kind, auth_mode) |
| 8 | `execution_profiles` | Per-user source subscriptions (source_ids JSONB) |
| 9 | `market_data` | Cached bar data (symbol, tf, timestamp) |
| 10 | `ea_logs` | Expert Advisor telemetry |

## Key Notes

- **`user_settings`** — used for ALL settings types: `api_key`, `notification_config`, `ai_template`, `cron`, `trade`, `system_config`, `symbols`. Replaces old `user_templates` (dropped 2026-05-09).
- **`user_templates`** — DROPPED. Templates now in `user_settings` with type='ai_template'.
- **`ai_templates`** — DROPPED long ago. Migrated then removed.
- **`ai_analysis`** — NOT a table. A `user_settings` row (type='cron', name='ai_analysis') for cron schedule.
- **`user_accounts`** — Canonical broker account table. Legacy `accounts` has been removed from local active schema and should be removed from any remaining old environments via migration.
- **`logs` metadata** — Structure: `{ status, error, data: {...}, payload, response }`. Status defaults to "OK", "ERROR" if error present.
- **`trades` TP ladder** — `tp` remains legacy alias; new nullable `tp1`, `tp2`, `tp3` store multi-target planning.
