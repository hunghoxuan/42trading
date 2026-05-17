# HANDOFF: Multi-TP Lifecycle (2026-05-17)

## Context
Initial Multi-TP rollout was deployed, but VPS logs show runtime sync failure:
- `ReferenceError: hasPartial is not defined`
- Location: `webhook/server.js` in `brokerSyncV2` path.

## Current Reality
- Multi-TP fields are partially integrated (UI + backend + bridge fallback parse).
- Deployment happened.
- Production is not clean due to runtime broker sync exception.

## Must-Do Next (in order)
1. Fix `hasPartial` scope bug in `brokerSyncV2`.
2. Run local checks:
   - `rtk node --check webhook/server.js`
   - `rtk npm --prefix web-ui run build`
3. Bump aligned versions and commit.
4. Push `main`.
5. Deploy to VPS.
6. Verify:
   - `/health` version
   - PM2 `webhook-error.log` has no `hasPartial` errors
   - broker sync requests succeed without exception.

## Risk Notes
- Broker sync loop is hot path; runtime error can stall state convergence.
- TP alias consistency (`tp == tp1`) must not regress legacy clients.
- Partial-close logic must never mark `CLOSED` while `remaining_volume > 0`.

## Evidence to capture in final report
- Commit SHA
- Server/EA versions
- `/health` response
- PM2 log tail (no `ReferenceError`)
- Example payload showing `tp`, `tp1`, `tp2`, `tp3`, `tp_targets`.

## Suggested Owner
- Next execution agent on `main` with deploy lock ownership in `MAILBOX.md`.
