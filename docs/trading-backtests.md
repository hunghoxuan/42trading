# Trading, Strategies, Multi-Timeframes, And Backtests

## Trading Domain Summary

| Concern | Main files | Role |
|---|---|---|
| Trade lifecycle | `src/api/modules/42trade/trades/tradesCore.js`, `tradesRepo.js` | Trade creation, updates, provider-backed access |
| Trade routes and orchestration | `src/api/server.js` | Current HTTP integration point |
| Strategy config | `src/api/modules/42trade/strategies/strategyConfigService.js` | Validate, normalize, and persist strategies |
| Backtest engine | `src/api/modules/42trade/backtests/backtestService.js` | Simulate strategies against bar history |
| UI | `src/admin/modules/42trade/pages/trades/TradesPage.jsx`, `BacktestsPage.jsx` | Operator-facing trading and backtest screens |

## Strategy System

| Part | Source | What it does |
|---|---|---|
| Strategy schema | `src/config/schema/strategy.json` | Declares required structure for custom strategies |
| Strategy functions | `src/config/strategyFunctions.json` | Declares supported operators/functions for expressions |
| Strategy presets | `src/config/strategies/*.json` | Built-in strategy definitions |
| Strategy service | `src/api/modules/42trade/strategies/strategyConfigService.js` | Loads assets, validates expressions, normalizes rules/actions |
| Rule builder UI | `src/admin/components/RuleBuilder.jsx` | Admin editing surface for strategy logic |

## Strategy Action Model

| Action type | Meaning |
|---|---|
| `trade` | Create a trade plan or trade signal |
| `draw` | Produce chart annotations/notes |
| `notify.toast` | UI-facing notification |
| `notify.notification` | System notification path |
| `webhook.post` | Send outbound webhook |

## Multi-Timeframe Trading Model

| Layer | Current representation |
|---|---|
| Analysis context | HTF, setup TF, entry TF, trigger TF in `analysis.json` |
| Trade row | `signal_tf` and `chart_tf` columns |
| Bars engine | Canonical storage TFs in market-data core |
| Realtime charts | Topic + snapshot normalization via realtime core and chart stream service |
| Strategy/backtest inputs | Symbol + timeframe + execution options inside backtest runs |

## Backtest Engine Summary

| Capability | Evidence in code | Notes |
|---|---|---|
| Built-in strategy loading | `loadBuiltInStrategies()` | Uses config store to load presets |
| Custom strategy support | `listAvailableStrategies()` | Merges stored custom strategies with presets |
| Run fingerprinting | dataset, execution, and strategy hash helpers | Used to compare/dedupe runs |
| JSON run persistence | `manifest.json`, `summary.json`, `trades.json`, `events.json` | Stored per run directory |
| Object-store persistence | `objectStore.listObjectsByType()` for `backtests` | Newer storage path coexists with legacy folders |
| Strategy events in simulation | `strategyEventFunctions.cjs` and shared artifact detection | Enables event/rule-driven simulation |

## Backtest Storage Model

| Item | Location | Purpose |
|---|---|---|
| Legacy run root | user-root `backtests/` folder | Historical file-backed backtest runs |
| Nested strategy runs | per-strategy run folders | Structured grouping by strategy |
| Object-store records | object store type `backtests` | Repo-backed persisted records |
| Run artifacts | `manifest.json`, `summary.json`, `trades.json`, `events.json` | Inputs and outputs for each simulation |

## cTrader Result Import

`POST /api/backtests/save` (and its `/v2` alias) accepts either the native
42trade result contract or a cTrader `JsonReport`. Supply the cTrader report in
`ctrader_report`, `cTraderReport`, `json_report`, `jsonReport`, or `report`; the
value may be an object or a JSON string. Include a `run` object when the caller
has authoritative strategy/configuration metadata.

The cTrader adapter normalizes the report before object-store persistence:

| cTrader field | Dashboard field |
|---|---|
| `history.items[].id` | `sid`, `trade_id`, `broker_trade_id` |
| `direction` | `action`, `side` |
| `entryTime`, `closeTime` | ISO and Unix entry/exit timestamps |
| `entryPrice`, `closePrice` | `entry`, `exit_price` |
| `net`, `gross` | `pnl_realized`, `pnl_gross` |
| `commissions`, `swaps` | `commission`, `swap` |
| report period/symbol plus supplied run metadata | canonical TF, symbol, strategy, and selection fields |

The saved summary includes PnL, win rate, profit factor, drawdown, costs, data
range, and breakdowns by month, UTC entry hour, UTC weekday, trading session,
direction, symbol, timeframe, and strategy. The complete launch configuration
remains under `run.config`. Planned SL/TP/R values are recovered from the bridge
trade comment when present; a structured bridge trade snapshot remains the
preferred source for these fields.

Native queued cTrader runs also persist `run.config.ctrader_launch` with the
testing context and a `resolved_parameters` array. Each entry records the cBot
parameter display name, cTrader type, effective value, and whether it came from
an explicit override or the cBot default. Backtest History exposes this complete
snapshot through the **All parameters** control on each cTrader run.

## Why Backtests Live Beside Trading

| Reason | Explanation |
|---|---|
| Shared contracts | Strategies, bars, and trade plans are shared across live trading and simulation |
| Shared artifacts | Chart artifact detection and strategy event functions are reused |
| Shared operator workflow | Admin users compare strategy definitions, runs, and live trade logic in one toolset |

## Trading Lifecycle At A Glance

| Phase | Typical data |
|---|---|
| Signal/analysis | Strategy, symbol, session, multi-timeframe bias, execution plan |
| Planned trade | Entry, stop, targets, risk settings, confidence |
| Queued/leased trade | Dispatch status, lease token, lease expiry |
| Broker execution | Broker IDs, fills, commissions, swaps, live PnL |
| Closed trade | Close reason, realized PnL, archived context |

## Cross-Reference

| Need | Read next |
|---|---|
| Schema details | [schema-reference.md](./schema-reference.md) |
| Realtime bars and chart transport | [runtime-realtime.md](./runtime-realtime.md) |
| MT5 bridge, object store, and connectors | [integrations-storage.md](./integrations-storage.md) |
