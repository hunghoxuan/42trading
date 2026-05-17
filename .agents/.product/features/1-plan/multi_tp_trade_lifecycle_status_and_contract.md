# Feature: Multi-TP Trade Lifecycle - Status Audit + Canonical Contract

Date: 2026-05-17
Owner: Platform/Execution
Related:
- Feature: `../features/1-plan/multi_tp_trade_lifecycle.md`
- Ticket (original): `../tickets/1-backlog/2026-05-17-multi-tp-trade-lifecycle.md`

## 1) Executive Status

Current state is PARTIAL IMPLEMENTATION / DEPLOY_BLOCKED.

What is done:
- UI editor has `TP`, `TP1`, `TP2`, `TP3` fields.
- Backend includes DB migration statements for `trades.tp1/tp2/tp3`.
- Backend added compatibility helpers for TP normalization and `tp_targets` emission.
- Bridge clients added fallback parse (`tp1` when `tp` missing).
- Version bump/deploy attempted and reached VPS.

What is not done cleanly:
- Broker sync code has a runtime scope bug causing VPS errors:
  - `ReferenceError: hasPartial is not defined`
  - In `webhook/server.js`, `hasPartial` is defined in `pushItems(...)` scope but used later in SQL update parameter arrays.
- End-to-end validation matrix from ticket is not fully closed (especially live partial-close lifecycle proof).

## 2) Canonical Data Contract (Recommended)

### 2.1 Source of truth
- Canonical TP model: `tp_targets[]` (ordered list, max 3).
- DB projection: `tp1`, `tp2`, `tp3`.
- Legacy alias: `tp` is compatibility field only and MUST mirror `tp1`.

### 2.2 Normalization rules
On every write path (`create`, `trade-plan save`, broker fanout input):
1. Collect candidates from: `tp_targets`, `tp1`, `tp2`, `tp3`, `tp`, `take_profit`.
2. Coerce finite positive numbers only.
3. De-duplicate.
4. Sort by side:
   - BUY ascending
   - SELL descending
5. Keep first 3 -> map to `tp1,tp2,tp3`.
6. Set `tp = tp1` (or null).

### 2.3 Read rules
- Always return: `tp`, `tp1`, `tp2`, `tp3`, `tp_targets`.
- For legacy clients, `tp` remains stable.

## 3) Broker / Execution Semantics

### 3.1 Payload to bridge
- Keep legacy field `tp`.
- Include `tp1`, `tp2`, `tp3`, and `tp_targets`.

### 3.2 Status lifecycle (must)
- `PENDING -> OPEN` on first fill.
- During partial close, trade remains `OPEN` while `remaining_volume > 0`.
- `CLOSED` only when remaining volume is zero.

### 3.3 Sync metadata (must retain)
- `tp_hit_index`
- `closed_volume_partial`
- `remaining_volume`
- `realized_pnl_partial`
- `realized_pnl_total`

## 4) RR Policy (Architectural Recommendation)

- Do NOT store derived RR as authoritative DB field for ongoing truth.
- Store primitives (`entry`, `sl`, `tp1..tp3`) and compute RR in FE/BE when displaying.
- Optional audit snapshot fields may be added later if product needs frozen-at-submit RR.

Display recommendation:
- `rr_primary` = RR using `tp1`.
- `rr_max` = RR using farthest target.

## 5) Gap List vs Original Ticket

- [x] DB columns added in migration code.
- [x] TP compatibility alias intent implemented.
- [x] UI TP1/TP2/TP3 fields exposed.
- [x] Context-menu TP assignment logic added (SignalDetail flow).
- [x] Bridge fallback for `tp1` parse added.
- [ ] Runtime-safe broker sync not complete (scope bug blocks production safety).
- [ ] Full required validation evidence incomplete (create/edit/save/reload + partial-close simulation).
- [ ] Deploy verification incomplete due runtime errors after restart.

## 6) Immediate Remediation Order

1. Fix `hasPartial` scope bug in `brokerSyncV2`.
2. Re-run syntax/build checks.
3. Re-deploy to VPS.
4. Verify `/health`, `/v2/broker/sync` logs, and absence of `ReferenceError` in PM2 logs.
5. Run ticket validation matrix and capture evidence.

## 7) Definition of Done (for this feature)

- No runtime errors in sync loop.
- `tp/tp1/tp2/tp3/tp_targets` stable across create->save->reload.
- BUY TP ordering asc, SELL desc, deduped.
- Partial-close keeps status `OPEN` until `remaining_volume == 0`.
- Legacy single-TP path unchanged.
