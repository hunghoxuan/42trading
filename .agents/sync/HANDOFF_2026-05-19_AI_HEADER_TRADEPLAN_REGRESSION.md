# Handoff: AI header + TradePlan layout regression

## Read
- `/Users/macmini/Trade/Bot/trading/.agents/.product/tickets/1-backlog/plan-fix-bug-ai-header-and-tradeplan-layout-regression.md`
- `/Users/macmini/Trade/Bot/trading/web-ui/src/pages/ai/ChartSnapshotsPage.jsx`
- `/Users/macmini/Trade/Bot/trading/web-ui/src/components/TradePlanEditor.jsx`
- `/Users/macmini/Trade/Bot/trading/web-ui/src/pages/system/HealthPage.jsx`

## Objective
Resolve UI regressions:
1. Restore Analyze action behavior in AI header context.
2. Fix TradePlan row overlap/clipping for SL/RR/RR2/RR3 controls.
3. Unify health page style consistency with app baseline.

## Provenance note
Analyze replacement trace identified in commit:
- `81bf521e0dda6feba4fa7edb22ee8da1633e02c2` by Hung Ho.

## Constraints
- Preserve new features from 81bf where not in conflict.
- Reintroduce Analyze action without breaking `< List` navigation.
- No backend/schema changes needed for this ticket.

## Required checks
- `rtk npm --prefix web-ui run build`
- manual screenshot parity checks for screen-2 clipping/overlap and screen-3 Analyze restore

## Return format
- root cause summary
- exact files changed
- verification evidence
- deploy status/version if deployed

