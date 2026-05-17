# Feature: Multi-TP Trade Lifecycle (TP1/TP2/TP3)

## Overview
Enable partial take-profit planning and execution across Web UI, backend, and bridge clients by introducing `tp1`, `tp2`, `tp3` as first-class fields in the trade lifecycle.

This feature must preserve backward compatibility with current single-TP behavior while adding deterministic handling for multi-TP entry, sync, and PnL/status updates.

## 1. Objective
- Support planning and execution with up to 3 take-profit targets.
- Keep current `tp` field as compatibility alias and primary display fallback.
- Ensure broker sync/poll logic correctly reflects partial closes and final close.
- Avoid breaking existing signals/trades, existing bridges, and current DB rows.

## 2. UX / Product Requirements
- Add `tp1`, `tp2`, `tp3` columns in trades table.
- In `TradePlan Edit` component, add fields in order: `TP`, `TP1`, `TP2`, `TP3` (after current TP).
- Right-click chart context menu behavior:
  - On TP click, auto-fill next available TP slot.
  - Enforce ascending target order:
    - BUY: `entry < tp1 < tp2 < tp3`
    - SELL: `entry > tp1 > tp2 > tp3`
  - `tp` must mirror `tp1` (or first valid TP) for compatibility.
- In bridge sync displays/events, reflect partial-close progression without forcing `CLOSED` too early.

## 3. Data Model
### 3.1 Database
- `trades` table: add nullable numeric columns:
  - `tp1`
  - `tp2`
  - `tp3`

### 3.2 Backward Compatibility
- Keep existing `tp`.
- Compatibility rule:
  - If only `tp` exists, map to `tp1`.
  - If `tp1` exists and `tp` is empty, set `tp = tp1`.
  - Existing reads continue to work with `tp` while UI/editor upgrades to multi-TP.

## 4. API / Backend Contract
### 4.1 Write paths
- All create/update/save trade-plan endpoints accept and validate:
  - `tp1`, `tp2`, `tp3`, and legacy `tp`.
- Normalization pipeline:
  - Coerce numbers/null.
  - Sort by side direction.
  - De-duplicate equal targets.
  - Set canonical `tp = first target`.

### 4.2 Read paths
- Return `tp1`, `tp2`, `tp3` in trade payloads.
- Return `tp` for legacy clients.

## 5. Bridge / Execution Semantics
## 5.1 Bridge payload
- Extend downstream payload schema to include optional `tp_targets: [tp1,tp2,tp3]`.
- Keep legacy `tp` for old bridge compatibility until both bridges upgraded.

## 5.2 MT5/cTrader bridge behavior
- If platform supports native multi-target decomposition:
  - Split one logical trade into child exit levels while preserving parent SID linkage.
- If not supported natively:
  - Keep single position and manage partial close triggers in bridge logic.

## 5.3 PnL and status sync policy
- Status transitions:
  - `PENDING` -> `OPEN` (first fill)
  - `OPEN` remains `OPEN` during TP1/TP2 partial closes
  - `CLOSED` only when position size reaches zero
- New sync metadata fields (in event payload/log JSON, not necessarily new DB columns in phase-1):
  - `tp_hit_index` (1..3)
  - `closed_volume_partial`
  - `remaining_volume`
  - `realized_pnl_partial`
  - `realized_pnl_total`

## 6. UI Components Impact
- `web-ui/src/components/TradePlanEditor.jsx`
  - Add TP1/TP2/TP3 input rows + validators.
- `web-ui/src/components/charts/SymbolChart.jsx`
  - Context menu TP click should route to ordered TP slots.
- `web-ui/src/components/SignalDetailCard.jsx` and trade/signal pages
  - Display multi-TP values where relevant.

## 7. Validation Rules
- Direction-aware ordering:
  - BUY: strictly increasing.
  - SELL: strictly decreasing.
- Max 3 targets, null-safe.
- Optional but recommended:
  - Prevent TP crossing SL for direction.
  - Prevent TP equal to entry (within epsilon).

## 8. Rollout Strategy
### Phase 1 (safe compatibility)
- DB columns + backend normalization + UI editor fields + chart TP slot assignment.
- Bridge payload includes both `tp` and `tp_targets`.
- Keep old bridge behavior as fallback.

### Phase 2 (full execution parity)
- Bridge partial-close execution and synchronization events.
- UI reflects TP hit progression and partial realized PnL.

## 9. Risks
- Premature `CLOSED` when partial-close interpreted as full close.
- Inconsistent TP ordering if side changes after manual edit.
- Legacy clients writing only `tp` can overwrite structured targets.

## 10. Success Criteria
- User can set TP1/TP2/TP3 and save/reload without data loss.
- Context menu TP placement consistently assigns ordered slots.
- Partial-close events do not close trade until remaining volume is zero.
- Legacy single-TP flows continue working unchanged.
