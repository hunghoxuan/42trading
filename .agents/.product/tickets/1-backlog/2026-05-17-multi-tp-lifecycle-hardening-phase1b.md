# Ticket: Multi-TP Lifecycle Hardening (Phase-1B)

## Status
- BACKLOG (HOTFIX PRIORITY)

## Summary
Stabilize deployed Multi-TP implementation after initial rollout. Current VPS runtime shows broker sync failures (`hasPartial` scope bug). This ticket closes production safety and validation gaps while preserving backward compatibility.

## Links
- Feature baseline: `../features/1-plan/multi_tp_trade_lifecycle.md`
- Status contract: `../features/1-plan/multi_tp_trade_lifecycle_status_and_contract.md`
- Original implementation ticket: `./2026-05-17-multi-tp-trade-lifecycle.md`

## Scope
- `webhook/server.js`
- `web-ui/src/components/SignalDetailCard.jsx`
- `web-ui/src/components/TradePlanEditor.jsx`
- `web-ui/src/utils/signalDetailUtils.jsx`
- `bridge-clients/TVBridgeEA.mq5`
- `bridge-clients/TVBridge_CTrader.cs`
- deploy/version + mailbox proof

## Mandatory Fixes
- [ ] **P0 runtime fix**: resolve `ReferenceError: hasPartial is not defined` in `brokerSyncV2`.
- [ ] Ensure partial-close status guard is deterministic:
  - if `remaining_volume > 0` => execution status must remain `OPEN`.
- [ ] Ensure TP normalization always enforces:
  - canonical ordering by side
  - dedupe
  - `tp = tp1` alias sync
- [ ] Ensure pull payload always includes `tp`, `tp1`, `tp2`, `tp3`, `tp_targets`.

## Validation Matrix (must capture evidence)
- [ ] `webhook/server.js` syntax check passes.
- [ ] `web-ui` build passes.
- [ ] Create trade plan with only `tp` => reload shows `tp1==tp`, `tp2/tp3 null`.
- [ ] Add TP from chart context menu repeatedly:
  - BUY -> ascending slots
  - SELL -> descending slots
- [ ] Input mixed TP fields (`tp != tp3`) -> normalization rewrites and keeps `tp == tp1`.
- [ ] Simulate partial-close sync payload:
  - status remains `OPEN` until remaining volume zero
  - realized PnL progresses via partial/total fields.
- [ ] Legacy single-TP create/edit/sync regression passes.

## Deploy / Ops (mandatory)
- [ ] Bump versions (`SERVER_VERSION`, `EA_BUILD_VERSION` both bridge clients).
- [ ] Push to `origin/main`.
- [ ] Deploy using project SOP.
- [ ] Verify:
  - `/health` shows expected version.
  - PM2 logs contain no `hasPartial` runtime errors.
  - `/v2/broker/sync` loop processes without exceptions.

## Acceptance Criteria
- No runtime sync exceptions post-deploy.
- Multi-TP and legacy TP behaviors both stable.
- Verification evidence posted in mailbox with commit SHA + versions + endpoint/log proof.
