# Integrations, Storage, Cache, And JSON Readers

## Remote APIs And Connectors

| Connector / API | Main files | Role |
|---|---|---|
| MT5 Python bridge client | `src/api/shared/clients/mt5PythonBridgeClient.js` | Node-side HTTP client for bridge health, readiness, positions, orders, deals, and quotes |
| MT5 Python bridge server | `src/mt5-bridge/python/bridge_server.py` | HTTP service exposing bridge endpoints on MT5-capable host |
| MT5 connector | `src/mt5-bridge/python/mt5_connector.py` | Direct MetaTrader5 runtime integration and account/market reads |
| Twelve Data / live market data | `src/api/modules/42trade/marketData/forexLiveIngestorService.js` | Live market-data ingest and realtime publish path |
| cTrader downstream integration | `src/api/modules/42trade/backtests/backtestService.js` env usage + scripts documented in `src/api/README.md` | External execution/downstream hooks |

## MT5 Bridge Features

| Feature | Where implemented | Notes |
|---|---|---|
| Health and readiness | Python bridge `GET /health`, `GET /ready` | Reports runtime availability and auth requirements |
| Account summary | `POST /bridge/account/summary` | Returns balance/equity/margin snapshot |
| Execution readiness | `POST /bridge/account/readiness` | Checks terminal/account blockers before execution |
| Positions | `POST /bridge/account/positions` | Returns current open positions |
| Orders | `POST /bridge/account/orders` | Returns pending/current broker orders |
| Deals/history | `POST /bridge/account/deals` | Returns recent broker deals |
| Quotes | `POST /bridge/market/quote` | Returns current quote for a symbol |

## Object Storage Model

| Layer | Main file | Role |
|---|---|---|
| High-level user object store | `src/api/shared/objects/userObjectStore.js` | Unified access to static and dynamic user objects |
| Repo seam | `src/api/shared/objects/objectStoreRepo.js` | Provider selection plus cache-backed reads |
| Provider implementations | `src/api/shared/objects/providers/*.js` | `json`, `sqlite`, `postgres` object persistence backends |
| Static DAL | `RepoBackedStaticObjectDal` in `userObjectStore.js` | Stable objects like settings/config-like records |
| Dynamic DAL | `RepoBackedDynamicObjectDal` in `userObjectStore.js` | Runtime/dynamic object variants |

## Object Store Provider Strategy

| Provider | When it fits | Trade-off |
|---|---|---|
| JSON | Easy local/debug storage and file transparency | Harder to query at scale |
| SQLite | Lightweight structured persistence | Single-node local DB model |
| Postgres | Shared structured persistence | Higher operational dependency |

## Cache Model

| Cache layer | File | What it caches |
|---|---|---|
| Generic API cache facade | `src/api/shared/cache/createCacheFacade.js`, `CacheFacade.js` | Swappable provider-backed key/value cache |
| Object-store cache | `src/api/shared/objects/objectStoreRepo.js` | Object rows, object data, and list queries |
| User object store memory/Redis mix | `src/api/shared/objects/userObjectStore.js` | Static and dynamic object projections |
| Runtime cache facade | `src/api/shared/runtime/facades/CacheFacade.js` | Runtime-level provider seam for broader app usage |

## JSON Reader And Config Loader Paths

| Reader path | File | Purpose |
|---|---|---|
| Config store | `src/api/shared/config/configStore.js` | Canonical JSON reader/writer for `src/config` assets |
| Settings store | `src/api/modules/system/settings/settingsStore.js` | Reads and merges settings JSON payloads |
| Chart artifact repo | `src/api/modules/42trade/charts/chartArtifactRepo.js` | Reads stored chart artifact JSON envelopes |
| Backtest service | `src/api/modules/42trade/backtests/backtestService.js` | Reads persisted backtest run JSON files |
| Chat store | `src/api/modules/42trade/chat/chatStore.js` | Reads conversation item JSON files |
| Object-store JSON provider | `src/api/shared/objects/providers/jsonObjectStoreProvider.js` | File-backed object row persistence |

## Why Config Store Matters

| Asset type | Location | Why it is centralized |
|---|---|---|
| Root app config | `src/config/config.json`, `apps.json`, `ruleVariables.json`, `strategyFunctions.json` | Shared by API flows and admin tooling |
| Schemas | `src/config/schema/*.json` | One source of truth for contracts |
| Built-in strategies | `src/config/strategies/*.json` | Editable presets loaded by API and backtests |

## Storage Choices In Practice

| Data kind | Current primary pattern |
|---|---|
| Relational trade/user records | Drizzle schema with SQLite/Postgres backends |
| Bars and time series | Provider-backed CSV / Parquet+DuckDB / Postgres |
| Backtest runs | File-backed JSON plus object-store records |
| User settings and objects | Object store with JSON/SQLite/Postgres providers |
| Runtime caches | Memory or Redis |

## Cross-Reference

| Need | Read next |
|---|---|
| Overall architecture | [architecture.md](./architecture.md) |
| Folder placement rules | [project-structure.md](./project-structure.md) |
| Runtime and realtime behavior | [runtime-realtime.md](./runtime-realtime.md) |
| Trade and strategy flows | [trading-backtests.md](./trading-backtests.md) |
