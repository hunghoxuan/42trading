# EA Risk & Execution Telemetry (2026-04-24)

## Problem Summary
- Risk sizing in EA could diverge from intended 1% max loss when pending orders used planned entry but sizing logic used current tick entry.
- Trade telemetry (used lot, pips, risk money) existed in EA ACK payload but was not consistently persisted to `trades.metadata`, so UI could not reliably display it.
- Sync reliability issue occurred when close reason `SNAPSHOT` violated DB check constraint.

## Current Rules (Implemented)
1. Hard max-risk enforcement exists in EA before execution.
   - Inputs:
     - `InpUseRiskPercentSizing`
     - `InpRiskPercentOfBalance`
     - `InpEnforceHardRiskCap`
     - `InpRiskCapTolerancePct`
   - If expected SL loss exceeds cap, EA clamps lot (if possible) or rejects order (`HARD_RISK_BLOCKED`).

2. Risk math for pending orders uses planned `entry` when provided.
   - Prevents oversizing due to using live ask/bid instead of planned trigger entry.

3. Backend persists ACK telemetry into `trades.metadata`.
   - Example fields:
     - `requested_volume`, `used_volume`
     - `requested_sl`, `requested_tp`, `used_sl`, `used_tp`
     - `sl_pips`, `tp_pips`, `pip_value_per_lot`
     - `risk_money_actual`, `reward_money_planned`
     - `margin_req`, `margin_budget`, `free_margin`, `balance`, `equity`

4. Close reason constraint now allows `SNAPSHOT`.
   - Prevents v2 sync hard-failing on close-reason mismatch.

## UI Availability Rule
- Show execution telemetry only when execution status indicates broker execution:
  - `FILLED/CLOSED`
- For `PENDING`, do not show execution telemetry numbers.
- Prefer values from `trades.metadata` (`used_volume`, `risk_money_actual`, etc.) over planned values.

## Operational Reminder
- Backend deploy does NOT activate EA logic by itself.
- EA protections are active only after MT5 terminal runs latest EA build.
