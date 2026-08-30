# src/mt5-bridge/clients

Client-side MT5 bridge artifacts used by broker/runtime integrations.

Contents:
- `TVBridgeEA.mq5`
- `TVBridge_CTrader.cs`
- TradingView Pine helpers and references

Naming rule:
- keep all terminal/client artifacts under `src/mt5-bridge/clients`
- keep Python bridge runtime under `src/mt5-bridge/python`

## Shared market analysis boundary

`TVBridge_CTrader.cs` remains a single deployable cTrader source file, but shared
analysis lives in the platform-neutral `FortyTwo.Trading.Analysis` namespace.

- `MarketAnalysisRequest` is the only service input. It contains normalized symbol
  details, one or more candle/timeframe series, grouped analysis parameters,
  confluence and event catalogs, and strategy configuration.
- `MarketAnalysisService` returns information only: swings, structures, events,
  zones, key levels, candle patterns, confluences, and proposed trade plans.
- The service must not reference cTrader chart, order, position, network, timer, or
  file APIs. Platform adapters own data conversion and all side effects.
- cTrader compatibility wrappers map service results back to the existing private
  DTOs so chart rendering, strategy evaluation, sync, and execution call sites do
  not need to change together.
- When extracting a standalone library later, move the namespace unchanged and
  replace only the platform adapter that creates `MarketAnalysisRequest`.
