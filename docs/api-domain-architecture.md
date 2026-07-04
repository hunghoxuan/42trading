# API Domain Architecture

This document defines the target `src/api` domain structure and the canonical HTTP route groups.

Goal:
- domain folder name matches API group name
- persistence facades are domain-owned
- provider-specific implementations live under `providers/`
- remove legacy top-level `repositories/`, `services/`, and `storage/` as final architecture concepts

## Naming Rules

- Folder names use `camelCase`
- API groups use `kebab-case`
- Repo facade name is `<domainName>Repo.js`
- Provider implementations live under `<domain>/providers/`
- Domain orchestration logic stays inside the domain folder

Examples:
- `src/api/modules/42trade/marketData/marketDataRepo.js` -> `/api/market-data`
- `src/api/modules/42trade/trades/tradesRepo.js` -> `/api/trades`
- `src/api/mt5Bridge/mt5BridgeService.js` -> `/api/mt5-bridge`

## Canonical Domains

| Domain | Folder | API Base | Purpose |
|---|---|---|---|
| Market Data | `marketData` | `/api/market-data` | OHLCV, time-series, broker bars, audits, repairs, symbol price-data snapshots |
| Trades | `trades` | `/api/trades` | Trade lifecycle, plans, executions, sync, trade-linked artifacts |
| Accounts | `accounts` | `/api/accounts` | Broker accounts, subscriptions, secrets, bridge readiness |
| Users | `users` | `/api/users` | User records, profiles, roles, user management |
| Auth | `auth` | `/api/auth` | Login, logout, session, password, me |
| Chat | `chat` | `/api/chat` | AI chat, conversations, streaming, templates, generation |
| Charts | `charts` | `/api/charts` | Chart snapshots, refresh, chart artifacts, chart UI endpoints |
| Objects | `objects` | `/api/objects` | Chart objects, annotations, overlays, user-drawn structures |
| News | `news` | `/api/news` | Calendar and news events plus related filtering |
| Settings | `settings` | `/api/settings` | App settings, provider settings, execution profiles |
| Sources | `sources` | `/api/sources` | Upstream signal/news/source definitions and source events |
| System | `system` | `/api/system` | Health, logs, cache, storage stats, cron, ops |
| MT5 Bridge | `mt5Bridge` | `/api/mt5-bridge` | MT5 poll/pull, ack, heartbeat, sync, and bridge protocol endpoints |
| Notifications | `notifications` | `/api/notifications` | Stream, pulse, emit, clear, and notification settings |
| Strategies | `strategies` | `/api/strategies` | Strategy configs and strategy catalog |
| Backtests | `backtests` | `/api/backtests` | Backtest runs and results |

## Domain Boundary Notes

### `marketData`

`marketData` is the canonical symbol price-data domain.

It includes:
- OHLCV bar persistence
- CSV / Parquet / DuckDB / future Postgres providers
- broker bar ingestion
- bar repair and audit flows
- price-data snapshots and symbol/timeframe reads used by chart and analysis flows

`marketData` replaces the older `bars` naming.

### `trades`

`trades` owns trade lifecycle logic:
- trade creation
- updates
- broker sync status
- trade artifacts
- trade-linked chart/context data

### `mt5Bridge`

`mt5Bridge` is for MT5 bridge protocol operations, not general trade business logic.

It should own endpoints such as:
- pull
- ack
- heartbeat
- sync
- sync-bulk

Trade business rules stay in `trades`; bridge transport/protocol stays in `mt5Bridge`.

## Preferred Folder Shape

Example domain layout:

```text
src/api/
  marketData/
    marketDataRepo.js
    marketDataCore.js
    providers/
      csvMarketDataProvider.js
      parquetDuckdbMarketDataProvider.js
      postgresMarketDataProvider.js
  trades/
    tradesRepo.js
    tradesCore.js
    providers/
      sqliteTradesProvider.js
      postgresTradesProvider.js
```

For other domains:

```text
src/api/
  auth/
  accounts/
  backtests/
  charts/
  chat/
  mt5Bridge/
  news/
  notifications/
  objects/
  settings/
  sources/
  strategies/
  system/
  users/
```

## Route Normalization Direction

These route groups should converge toward the canonical bases above:

- `/auth/...` -> `/api/auth/...`
- `/api/ai/chat/...` -> `/api/chat/...`
- `/api/chart/...` -> `/api/charts/...`
- `/api/calendar/...` -> `/api/news/...`
- `/mt5/ea/...` -> `/api/mt5-bridge/...`
- `/mt5/...` operational bridge endpoints -> `/api/mt5-bridge/...`

Compatibility routes can remain temporarily during migration, but new code should target the canonical route groups.

## Migration Principle

When moving a feature:
- move code into its domain folder
- update imports to domain-local paths
- expose one domain-owned facade
- hide provider-specific details behind the domain facade
- avoid creating new top-level technical buckets

This document is the canonical target structure for ongoing API refactors.
