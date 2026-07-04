# Project Structure And Placement Rules

## Top-Level Layout

| Path | Purpose | Put files here when | Avoid putting here when |
|---|---|---|---|
| `agents/` | Agent boot and working rules | The file exists only to guide coding agents | The file is product or architecture knowledge |
| `docs/` | Human-readable project docs | You are documenting architecture, specs, plans, contracts, or handoff notes | The file is executable code or temporary scratch output |
| `src/admin/` | React admin app | The code is UI, client-side state, or browser interactions | The logic is backend-only or bridge-only |
| `src/api/` | Node API and runtime logic | The code handles HTTP, orchestration, integrations, runtime services | The code is UI-only or low-level DB package code |
| `src/config/` | Shared JSON config/contracts | The artifact must be read by API and UI as data | The artifact is executable orchestration code |
| `src/db/` | DB package and schema helpers | The file is DB-centric and backend-agnostic | The file belongs to one API domain’s orchestration layer |
| `src/mt5-bridge/` | MT5 and broker bridge code | The code depends on MT5 host/runtime concerns | The code is general API business logic |
| `scripts/` | Repeatable operational scripts | The command is a maintained operational tool | The file is scratch or one-off debugging |
| `tests/` | Repo-level tests and smoke checks | The test is cross-package or canonical top-level verification | The test belongs naturally inside `src/admin/tests` or `src/api/tests` |
| `.local/` | Scratch and one-off files | The file is temporary, AI-only, or throwaway | The file is part of the product |

## `src/api` Placement Rules

| Rule | Use it for | Example |
|---|---|---|
| Split by domain first | Business areas with their own orchestration | `src/api/modules/42trade/marketData`, `src/api/modules/42trade/trades`, `src/api/shared/objects` |
| Keep integration clients separate | Remote-service client wrappers | `src/api/shared/clients/mt5PythonBridgeClient.js` |
| Keep runtime infrastructure under `runtime/` | Provider/facade seams, environment-dependent runtime behavior | `src/api/shared/runtime/providers/cache/RedisCacheProvider.js` |
| Keep pure helpers in `utils/` | Normalization and stateless helper logic | `src/api/shared/utils/tradeRef.js` |
| Avoid new top-level technical buckets | Prefer domain ownership over generic `services/` growth | Put trade orchestration under `trades/`, not a new global helper folder |

## `src/api` Domain Shape

| Folder | Role | Typical file pattern |
|---|---|---|
| `marketData/` | Bars, ingestion, audits, storage provider selection | `marketDataCore.js`, `marketDataRepo.js`, `providers/*.js` |
| `trades/` | Trade lifecycle and repo/provider seams | `tradesCore.js`, `tradesRepo.js` |
| `backtests/` | Backtest engine and run persistence | `backtestService.js` |
| `strategies/` | Strategy validation, normalization, storage | `strategyConfigService.js` |
| `objects/` | Object store, user object access, logs | `objectStore.js`, `objectStoreRepo.js`, `userObjectStore.js` |
| `realtime/` | Topic model, socket server, stream snapshots | `realtimeCore.js`, `realtimeSocketServer.js`, `chartStreamService.js` |
| `runtime/` | Providers and facades for automation/cache/pubsub/streaming | `facades/*.js`, `providers/**/*.js`, `bootstrap/createAppRuntime.js` |

## UI Placement Rules

| Path | Put code here when | Example |
|---|---|---|
| `src/admin/modules/*/pages/` | It is a route-level screen | `BacktestsPage.jsx`, `TradesPage.jsx` |
| `src/admin/components/` | It is a reusable feature-level component | `RuleBuilder.jsx`, `StrategyEditorPanel.jsx` |
| `src/admin/hooks/` | It is client-side reusable state or side-effect logic | `useChartTileData.js` |
| `src/admin/realtime/` | It manages client realtime transport and stores | `realtimeClientSingleton.js`, `ChartStreamStore.js` |
| `src/admin/shared/components/` | It is cross-app UI infrastructure | `ResponsivePanel.jsx`, `InputComboSelect.jsx` |

## Shared Config Placement Rules

| Path | What belongs here |
|---|---|
| `src/config/schema/` | JSON schema-like contracts such as trade, strategy, analysis |
| `src/config/strategies/` | Preset strategy definitions |
| `src/config/*.json` | Shared non-code config data such as apps, strategy functions, rule variables |

## Practical Placement Guide

| If you are adding... | Put it in... | Reason |
|---|---|---|
| A new broker-bars persistence provider | `src/api/modules/42trade/marketData/providers/` | It belongs to market data and is swappable |
| A new trading rule normalization helper | `src/api/modules/42trade/strategies/strategyConfigService.js` or a focused sibling under `strategies/` | It belongs to strategy-domain orchestration |
| A new realtime topic parser | `src/api/modules/42trade/realtime/realtimeCore.js` | Topic naming is centralized there |
| A new chart stream transport | `src/api/shared/runtime/providers/streaming/` | Transport is infrastructure, not domain logic |
| A new schema for a shared JSON payload | `src/config/schema/` | API and UI can share it directly |
| A one-off debug script | `.local/` | Keep the repo clean |

## Cross-Reference

| Need | Read next |
|---|---|
| Overall architecture | [architecture.md](./architecture.md) |
| API domain target | [api-domain-architecture.md](./api-domain-architecture.md) |
| Schemas | [schema-reference.md](./schema-reference.md) |
