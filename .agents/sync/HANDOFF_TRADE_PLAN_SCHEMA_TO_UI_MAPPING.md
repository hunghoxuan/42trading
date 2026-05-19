# Handoff: trade_plan_schema.json → UI Full Field Mapping

## Source of Truth
- `config/trade_plan_schema.json` — the canonical AI output contract
- AI response format: `[{...trade_plan...}]` (bare array, stored as `{ trade_plan: [...] }` in DB `raw_json`)
- No middle parsing — exact AI JSON is stored directly

## Complete Field Mapping (Schema → UI)

### ROOT LEVEL

| Schema Path | UI Field | Notes |
|---|---|---|
| `symbol` | `symbol` | Direct |
| `direction` | `direction` | BUY/SELL |
| `order_type` | `trade_type` | Limit/Stop_Limit→limit, Market→market |
| `profile` | `profile` | Position/Swing/Intraday/Scalp |
| `session` | `session` | Direct |
| `strategy` | `strategy` | Direct |
| `entry_model` | `entry_model` | Direct |

### context.*

| Schema Path | UI Field | Notes |
|---|---|---|
| `context.htf_bias` | (stored in raw_json only) | Not in editor currently |
| `context.htf` | (stored in raw_json only) | Not in editor currently |
| `context.entry_tf` | (stored in raw_json only) | Not in editor currently |
| `context.ltf_structure` | (stored in raw_json only) | Not in editor currently |
| `context.macro` | (stored in raw_json only) | Not in editor currently |
| `context.draw_on_liquidity` | (stored in raw_json only) | Not in editor currently |
| `context.daily_bias_note` | (stored in raw_json only) | Not in editor currently |

### analysis.* (stored in raw_json only — not displayed in editor)

All `analysis.htf_context.*`, `analysis.market_structure.*`, `analysis.poi_quality.*`, `analysis.ltf_trigger.*`, `analysis.risk_filters.*`, `analysis.sl_validity.*` are stored in `raw_json` but NOT mapped to TradePlan editor fields.

### execution_plan.entry.*

| Schema Path | UI Field | Notes |
|---|---|---|
| `execution_plan.entry.price` | **entry** | Primary entry price |
| `execution_plan.entry.reference` | **entry_condition** | What zone/model triggered entry |
| `execution_plan.entry.invalidation_note` | **invalidation** (first choice) | When entry becomes invalid |

### execution_plan.stop_loss.*

| Schema Path | UI Field | Notes |
|---|---|---|
| `execution_plan.stop_loss.price` | **sl** | Stop loss price |
| `execution_plan.stop_loss.pips` | (stored in raw_json only) | SL distance in pips |
| `execution_plan.stop_loss.reference` | (stored in raw_json only) | What structure SL is behind |
| `execution_plan.stop_loss.invalidation_note` | **invalidation** (second choice) | When SL logic breaks |

### execution_plan (flat fields)

| Schema Path | UI Field | Notes |
|---|---|---|
| `execution_plan.risk_reward` | **rr** | Overall RR ratio |
| `execution_plan.breakeven_trigger.condition` | **be_trigger** | After_TP1/At_1R/Manual |
| `execution_plan.breakeven_trigger.price` | (stored in raw_json only) | BE price level |

### execution_plan.tp1 / tp2 / tp3

| Schema Path | UI Field | Notes |
|---|---|---|
| `execution_plan.tp1.price` | **tp** + **tp1** | Primary TP = tp1 |
| `execution_plan.tp1.rr` | (stored in raw_json only) | RR to tp1 |
| `execution_plan.tp1.pct` | **partial_tps[0].size_pct** | Position % at tp1 |
| `execution_plan.tp1.logic` | (stored in raw_json only) | Reasoning |
| `execution_plan.tp1.move_sl_to` | (stored in raw_json only) | SL management |
| `execution_plan.tp2.price` | **tp2** | |
| `execution_plan.tp2.rr` | (stored in raw_json only) | |
| `execution_plan.tp2.pct` | **partial_tps[1].size_pct** | |
| `execution_plan.tp2.logic` | (stored in raw_json only) | |
| `execution_plan.tp2.move_sl_to` | (stored in raw_json only) | |
| `execution_plan.tp3.price` | **tp3** | |
| `execution_plan.tp3.rr` | (stored in raw_json only) | |
| `execution_plan.tp3.pct` | **partial_tps[2].size_pct** | |
| `execution_plan.tp3.logic` | (stored in raw_json only) | |
| `execution_plan.tp3.note` | **note** | Trail-or-let-run note |

### risk_management.*

| Schema Path | UI Field | Notes |
|---|---|---|
| `risk_management.grade` | **risk_level** + **risk_management** | A/B/C/NoTrade |
| `risk_management.risk_percent` | **risk_pct** | |
| `risk_management.confidence_pct` | **confidence_pct** | |
| `risk_management.estimated_entry_mins` | **estimated_bars** | Mins → bars display |
| `risk_management.suggested_action` | **skip_recommendation** | Proceed/Skip_* |
| `risk_management.skip_reasons` | **reasons_to_skip** | String → array if non-empty |
| `risk_management.grade_criteria` | (stored in raw_json only) | Internal docs |
| `risk_management.risk_by_grade` | (stored in raw_json only) | Internal config |
| `risk_management.estimated_entry_window_mins` | (stored in raw_json only) | |
| `risk_management.max_wait_before_cancel_mins` | (stored in raw_json only) | |

### Computed / Derived Fields

| UI Field | Derivation |
|---|---|
| **rr2** | `calcRrByTarget(entry, sl, tp2, direction)` |
| **rr3** | `calcRrByTarget(entry, sl, tp3, direction)` |
| **risk_money** | Not in AI schema — computed from risk_pct × balance in UI |
| **confluence_checklist** | Not in AI schema at plan level — stored in `analysis.poi_quality` |
| **exit_condition** | `analysis.sl_validity.sl_behind_structure.invalidation_logic` |

### Fields Not in Schema (UI-only / Trade-row derived)

| UI Field | Source |
|---|---|
| `note` | `execution_plan.tp3.note` OR `trade.note` (DB column) |
| `rr_planned` | `trade.rr_planned` (DB column) |
| `volume` | `trade.volume` (DB column) |
| `entry_model` (DB) | `trade.entry_model` (DB column) |
| `source_id` | `trade.source_id` (DB column) |
| `execution_status` | `trade.execution_status` (DB column) |
| `broker_trade_id` | `trade.broker_trade_id` (DB column) |
| `account_id` | `trade.account_id` (DB column) |
| `created_at` | `trade.created_at` (DB column) |
| `opened_at` | `trade.opened_at` (DB column) |
| `closed_at` | `trade.closed_at` (DB column) |
| `pnl_realized` | `trade.pnl_realized` (DB column) |
| `chart_tf` | `trade.chart_tf` (DB column) |
| `signal_tf` | `trade.signal_tf` (DB column) |

## Extraction Priority (per field)

For each field, the extraction order is:
1. `raw_json` (stored AI response) — the new schema paths above
2. Flat trade columns (`trade.entry`, `trade.sl`, etc.) — fallback
3. Legacy paths (`plan.entry`, `plan.entry_price`, `plan.tp`) — backward compat
4. `metadata.broker_data` — last resort

## Files to Update

| File | What |
|---|---|
| `web-ui/src/utils/signalDetailUtils.jsx` | `extractTradePlanFromTrade` — add new schema paths |
| `web-ui/src/utils/signalDetailUtils.jsx` | `extractTradePlanFromSignal` — add new schema paths |
| `web-ui/src/utils/signalDetailUtils.jsx` | `planPrimaryTp` — read from `execution_plan.tp1.price` |
| `web-ui/src/utils/signalDetailUtils.jsx` | `planTpLevel` — read from `execution_plan.tp{N}.price` |
| `webhook/server.js` | `planPrimaryTpNumber` — same update |
