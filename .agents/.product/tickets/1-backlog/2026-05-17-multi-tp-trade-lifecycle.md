# Ticket: Multi-TP Trade Lifecycle (TP1/TP2/TP3)

## Status
- BACKLOG

## Summary
Implement end-to-end multi-take-profit support:
- DB: add `tp1`, `tp2`, `tp3` to trades table.
- UI: add TP1/TP2/TP3 in TradePlan Editor.
- Chart context menu: TP click auto-assigns ordered TP slots.
- Bridge + sync: handle partial closes, PnL progression, and final status closure correctly.

## Feature Link
- [../features/1-plan/multi_tp_trade_lifecycle.md]

## Scope
- Backend: `webhook/server.js` + related trade create/update/save paths.
- DB: migration for `trades.tp1/tp2/tp3`.
- UI: `TradePlanEditor`, chart TP interaction, detail display.
- Bridge clients: `bridge-clients/TVBridgeEA.mq5`, `bridge-clients/TVBridge_CTrader.cs`.

## Tasks
- [ ] **DB Migration**
  - Add nullable numeric columns `tp1`, `tp2`, `tp3` in `trades`.
  - Verify schema docs update in `.agents/.product/architecture/db-schema.md`.

- [ ] **Backend Normalization + Compatibility**
  - Accept `tp1/tp2/tp3` in all relevant API endpoints.
  - Normalize direction-aware order and deduplicate values.
  - Keep compatibility alias `tp = first valid TP target`.
  - Ensure reads return both legacy `tp` and new TP fields.

- [ ] **TradePlan Editor**
  - Add TP1/TP2/TP3 fields after existing TP.
  - Add validation and side-aware sort helper.
  - Persist via existing save flows.

- [ ] **Chart Context Menu TP Logic**
  - On TP click, fill next available TP slot.
  - Enforce ordered assignment by side:
    - BUY ascending
    - SELL descending
  - Keep `tp` synchronized to `tp1`.

- [ ] **Bridge Payload + Execution Handling**
  - Extend execution payload with `tp_targets` (while keeping `tp`).
  - MT5 and cTrader bridge parsing support for multiple targets.
  - Define fallback path when broker/platform cannot place multiple TPs directly.

- [ ] **Sync/Poll + PnL Status**
  - During partial close: status remains `OPEN`.
  - Only set `CLOSED` when remaining volume is zero.
  - Emit/store per-event metadata:
    - `tp_hit_index`
    - `closed_volume_partial`
    - `remaining_volume`
    - `realized_pnl_partial`
    - `realized_pnl_total`

- [ ] **Tests / Checks**
  - API contract tests for TP normalization.
  - UI interaction test for TP context menu sequencing.
  - Bridge dry-run simulation: partial TP1/TP2 then full close.
  - Regression checks for legacy single-TP create/edit/sync.

## Constraints
- Must not break existing single-TP trade lifecycle.
- Must preserve `tp` field behavior for backward compatibility.
- No premature close status during partial take profit.
- Keep deploy/version rules intact (server + EA version bump if code changes land).

## Non-goals (Phase 1)
- Rebuilding historical trade records with synthetic TP events.
- Advanced TP ladder strategy UI (percentage split controls) beyond fixed TP1/2/3 fields.

## Delivery / Report Format
- PR/change summary by layer:
  1. DB
  2. Backend
  3. UI
  4. Bridge
  5. Sync/PnL
- Include exact verification outputs and any known edge cases.
