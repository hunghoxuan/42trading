# Shared Rule, Event, and Strategy Catalog

## Purpose

The shared catalog is the source of truth for definitions used by cTrader, 42 Trade charts,
replay, and backtests. The runtimes share configuration files and expression semantics, but
they retain independent execution engines:

- cTrader parses and executes definitions in C#.
- 42 Trade parses and executes definitions in JavaScript.
- The admin edits the same files through authenticated API endpoints.

The source folders are:

```text
src/config/rules/*.json
src/config/events/*.json
src/config/strategies/*.json
```

Writes are atomic. cTrader reloads the folders on a short interval when a shared strategy is
configured. Existing per-user strategies remain in the object store and continue to work.

## Expression Formats

Rule and event expressions may be JSON objects, JSON strings, or readable text. Both engines
normalize text into the established JSON expression tree before evaluation.

```text
ema20 > ema9 and rsi < 70
price crosses_above ema20
not (rsi > 70 or rsi < 30)
pin_bar("bullish") or engulfing("bullish")
```

Supported syntax includes:

- Boolean operators: `and`, `or`, `not`, `&&`, `||`, `!`
- Comparisons: `>`, `<`, `>=`, `<=`, `==`, `!=`
- Arithmetic: `+`, `-`, `*`, `/`
- Market operators: `crosses_above`, `crosses_below`, `touches`, `retest`, `rejected`,
  `holds_above`, `holds_below`, `sweeps_above`, `sweeps_below`
- Parentheses and supported engine functions

Convenience aliases are normalized before execution:

```text
price       -> bar.close
close       -> bar.close
ema20       -> indicators.ema_20
sma50       -> indicators.sma_50
rsi         -> indicators.rsi
```

Explicit paths such as `indicators.ema_fast`, `params.max_rsi`, and `levels.key` are left
unchanged.

## Definition Types

A rule or event can use a built-in handler or an expression:

```json
{
  "id": "pin_bar_bullish",
  "name": "Bullish Pin Bar",
  "implementation": {
    "type": "builtin",
    "handler": "pin_bar"
  }
}
```

```json
{
  "id": "ema_rsi_bullish",
  "name": "EMA and RSI Bullish Filter",
  "implementation": {
    "type": "expression"
  },
  "condition": "ema9 > ema20 and rsi < 70"
}
```

Strategies can embed definitions or reference shared files with `rule_id` and `event_id`.
Actions on a strategy reference override actions from the shared definition.

## Admin API

The shared catalog API supports listing, reading, saving, and deleting each definition type:

```text
GET    /api/shared-catalog/rules
GET    /api/shared-catalog/events
GET    /api/shared-catalog/strategies
GET    /api/shared-catalog/{kind}/{id}
POST   /api/shared-catalog/{kind}
PUT    /api/shared-catalog/{kind}/{id}
DELETE /api/shared-catalog/{kind}/{id}
```

The 42 Trade navigation exposes these operations under **Engine Catalog**. Rules and events
have a simple expression editor and a full JSON editor. Strategies use the full document
editor because they also contain indicators, actions, market constraints, and risk settings.

## cTrader Runtime

Set the cBot `Shared Strategy IDs` parameter to a comma-separated list of strategy IDs. `*`
selects every active shared strategy. Leaving the parameter blank preserves the existing enum
strategy behavior.

When shared IDs are configured, cTrader:

1. Loads rules, events, and strategies from the base server config path.
2. Resolves `rule_id` and `event_id` references.
3. Builds its own bar, indicator, parameter, and market context.
4. Evaluates built-in handlers or text/JSON expressions with the C# engine.
5. Sends matched trade actions through the existing risk and protected-order pipeline.

Invalid, missing, inactive, or unmatched shared definitions do not fall back to legacy enum
rules. This prevents an invalid edit from unexpectedly enabling a different strategy.

## 42 Trade Runtime

The server hydrates shared references before returning available strategies. Backtests compile
text expressions before simulation. The browser chart/replay scanner uses the same shared
compiler through `chartStrategyChecks`, so live chart context and replay use the same rule tree
as server simulations.

## Compatibility

- Existing JSON expressions remain valid.
- Existing preset strategy files remain valid.
- Existing predefined JavaScript rules remain available through the legacy rules endpoint.
- Existing per-user custom strategies remain available and can reference shared definitions.
- cTrader legacy enums remain the default when `Shared Strategy IDs` is blank.
