# Schema Reference

## Schema Inventory

| Type | Primary source | Purpose |
|---|---|---|
| Trade payload | `src/config/schema/trade.json` | Trade analysis and execution-plan JSON contract |
| Strategy payload | `src/config/schema/strategy.json` | Custom strategy definition contract |
| Analysis payload | `src/config/schema/analysis.json` | Top-down multi-timeframe analysis contract |
| Relational DB schema | `src/db/schema.pg.js`, `src/db/schema.sqlite.js` | Users and trades relational model |
| Strategy presets | `src/config/strategies/*.json` | Built-in strategies loaded by the config store |
| Strategy functions | `src/config/strategyFunctions.json` | Supported operators/functions for strategy expressions |
| Rule variables | `src/config/ruleVariables.json` | Strategy/rule-builder variable catalog |

## Relational DB Schema

### Tables

| Table | Backend(s) | Key fields | Notes |
|---|---|---|---|
| `users` | Postgres, SQLite | `user_id`, `email`, `role`, `is_active`, timestamps | `user_id` is the primary key in current Drizzle schema |
| `trades` | Postgres, SQLite | `sid`, `account_id`, `user_id`, `symbol`, `action`, `execution_status`, `dispatch_status` | `sid` is the primary trade key in current Drizzle schema |

### `trades` Key Column Groups

| Group | Columns | Meaning |
|---|---|---|
| Identity | `sid`, `account_id`, `user_id`, `signal_id`, `source_id`, `broker_trade_id` | Stable IDs and cross-system linking |
| Strategy context | `strategy`, `entry_model`, `signal_tf`, `chart_tf`, `profile` | How the trade was derived |
| Planned execution | `action`, `order_type`, `volume`, `entry`, `sl`, `tp`, `tp1`, `tp2`, `tp3`, `be_trigger` | Planned trade setup |
| Risk planning | `rr_planned`, `risk_pct_planned`, `risk_money_planned`, `confidence_pct`, `estimated_bars` | Planned risk and confidence |
| Status lifecycle | `dispatch_status`, `execution_status`, `close_reason`, `rejection_reason`, `lease_token`, `lease_expires_at` | Queue and broker lifecycle |
| Broker realized data | `entry_exec`, `broker_pips`, `broker_lots`, `broker_commission`, `broker_swap`, `broker_volume`, `broker_pnl`, `broker_margin` | Broker-side execution and PnL |
| PnL projections | `planned_tp_pnl`, `planned_sl_pnl`, `broker_tp_pnl`, `broker_sl_pnl`, `pnl_realized` | Planned vs actual PnL |
| Audit payloads | `metadata`, `raw_json`, `note`, `confluence_checklist`, `risk_management` | Raw/derived JSON kept alongside the row |

## JSON Contract Summary

### Trade JSON

| Section | Required/expected fields | Meaning |
|---|---|---|
| Trade header | `symbol`, `direction`, `order_type`, `strategy`, `profile`, `session`, `entry_model`, `broker_name` | Identity and setup metadata |
| `analysis` | free-form object | Detailed analysis payload attached to the trade |
| `risk_management` | `risk`, `volumn`, `suggested_action` | High-level risk decision output |
| `execution_plan.pre_entry_invalidation` | `when_price`, `price` | Rule to invalidate before fill |
| `execution_plan.entry` | `price`, `reference`, `invalidation_note` | Entry definition |
| `execution_plan.stop_loss` | `price`, `reference` | Stop placement |
| `execution_plan.breakeven_trigger` | `condition`, `price` | Breakeven logic |
| `execution_plan.tp1..tp3` | `price`, `rr`, `pct`, `logic` | Multi-target exit plan |

### Strategy JSON

| Section | Meaning | Notes |
|---|---|---|
| Identity | `id`, `name`, `engine_version`, `kind`, `status` | Current schema expects `42trade.strategy.v1` or `.v2` |
| Market scope | `market.symbol`, `market.tf` | Optional strategy market binding |
| Params | `params` | Loose scalar bag for indicator/risk params |
| Indicators | `indicators[]` | Typed indicator definitions such as `ema`, `rsi`, `macd`, `bollinger` |
| Events | `events[]` | Event-driven actions including `trade`, notifications, notes, webhooks |
| Rules | `rules[]` | Rule-triggered actions with `when` expression trees |
| Risk | `risk` | `rr_target`, `stop_lookback`, `max_open_trades`, fallback stops/targets |
| Metadata | `metadata` | Free-form extension bag |

### Analysis JSON

| Section | Meaning |
|---|---|
| `context` | Trading profile, HTF/LTF bias, timeframe matrix, macro environment |
| `top_down_analysis.step_1_htf_structural_mapping` | Higher-timeframe structure and liquidity sweep |
| `top_down_analysis.step_2_setup_tf_confluence` | Setup timeframe confluence and freshness |
| `top_down_analysis.step_3_ltf_entry_and_risk_parameters` | LTF shift and invalidation logic |
| `top_down_analysis.step_4_trigger_tf_execution` | Trigger timeframe confirmation |
| `institutional_safety_filters` | Pre-entry checklist and execution constraints |
| `execution_verdict` | Go/no-go result, grade, size, and entry timing |

## Multi-Timeframe Contract

| Area | Current source | How timeframe data is represented |
|---|---|---|
| Analysis schema | `src/config/schema/analysis.json` | Explicit matrix: `htf`, `setup_tf`, `entry_tf`, `trigger_tf` |
| Trade row | `signal_tf`, `chart_tf`, `estimated_bars` | Normalized timeframe references on saved trades |
| Realtime core | `src/api/modules/42trade/realtime/realtimeCore.js` | Normalizes `1m`, `5m`, `15m`, `1h`, `4h`, `d` |
| Bars storage | `src/api/modules/42trade/marketData/marketDataCore.js` | Canonical storage keys like `1`, `5`, `15`, `60`, `240`, `1440` |

## Validation Flow

| Payload | Validator/loader | Notes |
|---|---|---|
| Strategy config | `src/api/modules/42trade/strategies/strategyConfigService.js` | Loads schema + function catalog, normalizes events/rules, validates expression trees |
| Built-in strategy preset | `src/api/shared/config/configStore.js` | Reads from `src/config/strategies/*.json` and caches via object store |
| Backtest strategy snapshot | `src/api/modules/42trade/backtests/backtestService.js` | Uses built-in or custom strategy payloads during simulation |

## Cross-Reference

| Need | Read next |
|---|---|
| Folder rules for schemas/configs | [project-structure.md](./project-structure.md) |
| Runtime and realtime use of bars/timeframes | [runtime-realtime.md](./runtime-realtime.md) |
| Strategy and backtest behavior | [trading-backtests.md](./trading-backtests.md) |

