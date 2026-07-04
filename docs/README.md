# 42Trade Docs

This folder is the current documentation hub for the 42Trade codebase.

## Entry Points

| Doc | Purpose | When to read |
|---|---|---|
| [architecture.md](./architecture.md) | System overview, tech stack, and why the stack exists | Start here for onboarding |
| [project-structure.md](./project-structure.md) | Folder boundaries and file-placement rules | Read before moving or adding files |
| [schema-reference.md](./schema-reference.md) | Database schema and JSON contract reference | Read before changing data models |
| [runtime-realtime.md](./runtime-realtime.md) | Runtime providers, realtime topics, Socket.IO, SSE, and bars updates | Read before touching live delivery |
| [trading-backtests.md](./trading-backtests.md) | Trading flow, strategy system, multi-timeframe logic, and backtests | Read before touching trading or simulation |
| [integrations-storage.md](./integrations-storage.md) | Remote APIs, MT5 bridge, object storage, cache, and JSON/config readers | Read before touching integrations or persistence seams |
| [api-domain-architecture.md](./api-domain-architecture.md) | Canonical `src/api` domain split target | Read when refactoring API boundaries |

## Coverage Map

| Requested topic | Primary doc |
|---|---|
| Architecture | [architecture.md](./architecture.md) |
| Schema | [schema-reference.md](./schema-reference.md) |
| Project folders and rules | [project-structure.md](./project-structure.md) |
| Realtime / Socket.IO | [runtime-realtime.md](./runtime-realtime.md) |
| Backtest engines | [trading-backtests.md](./trading-backtests.md) |
| Remote APIs and connectors | [integrations-storage.md](./integrations-storage.md) |
| Realtime bars update | [runtime-realtime.md](./runtime-realtime.md) |
| Strategy | [trading-backtests.md](./trading-backtests.md) |
| Multi-timeframes | [trading-backtests.md](./trading-backtests.md) |
| Trading | [trading-backtests.md](./trading-backtests.md) |
| MT5 bridge features | [integrations-storage.md](./integrations-storage.md) |
| Object storage | [integrations-storage.md](./integrations-storage.md) |
| Facade/providers | [runtime-realtime.md](./runtime-realtime.md) |
| Cache | [integrations-storage.md](./integrations-storage.md) |
| JSON reader | [integrations-storage.md](./integrations-storage.md) |

## Source-of-Truth Notes

| Source | Role |
|---|---|
| `src/api/server.js` | Current HTTP composition root and route gateway |
| `src/api/shared/runtime/**` | Runtime provider/facade layer |
| `src/api/modules/42trade/marketData/**` | Canonical bars storage and market-data ingestion |
| `src/api/modules/42trade/backtests/backtestService.js` | Current backtest engine |
| `src/api/modules/42trade/strategies/strategyConfigService.js` | Strategy validation and normalization |
| `src/api/shared/objects/**` | Object store and user object persistence |
| `src/config/schema/*.json` | JSON contracts used by API and UI |
| `src/db/schema*.js` | Drizzle DB schema reference |

