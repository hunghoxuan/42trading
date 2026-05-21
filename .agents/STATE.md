# STATE (Compiled Snapshot)

Purpose: fast, current context for AI/human startup. Keep short.

## Current Sprint Focus
- Source: .agents/plans/sprint.md
n/a

## Active Blockers
- Source: .agents/plans/bugs.md + latest worklog
n/a

## Latest Decisions
- Source: .agents/wiki/decisions/
n/a

## Deploy / Version Status
- SERVER_VERSION: v2026.05.21 18:47 - d1d485e1
- EA_BUILD_VERSION: v2026.05.21 18:47 - d1d485e1

## Open Risks
- Check top open bugs and unresolved sprint TODOs.

## Last Build
- Timestamp: 2026-05-04 14:49:19 UTC
- Builder: scripts/build_state_snapshot.sh

## Recent Worklog Tail
- **Work Accomplished**:
  - Fixed TradePlan form Entry=0, Direction=BUY despite valid AI JSON. Root cause: `mergePlanPreservingEdits` in `tradePlanDrafts.js` unconditionally overwrote valid base plan values with stale empty draft values for numeric editable keys.
  - Wired TP2/TP3 to Info Chart (`tp1Price`/`tp2Price`/`tp3Price` in chart props).
  - Wired `onPlanLevelChange` callback so right-click context menu Entry/SL/TP updates form.
  - Hardened `planEntryNumber`/`planStopLossNumber` extraction for `execution_plan.entry.price` and `execution_plan.entry` direct-number variants.
  - Added `execution_plan.direction` fallback to direction extraction.
  - Created comprehensive handoff document: `.agents/sync/HANDOFF_2026-05-21_CHART_SNAPSHOT_TRADEPLAN_ENTRY_FIX.md`
- **Changed Files**:
  - `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`
  - `web-ui/src/utils/tradePlanDrafts.js`
  - `.agents/sync/MAILBOX.md`
  - `.agents/sync/HANDOFF_2026-05-21_CHART_SNAPSHOT_TRADEPLAN_ENTRY_FIX.md`
  - `.agents/.product/tickets/1-backlog/_master-bugs.md`
- **Technical Decisions**:
  - `mergePlanPreservingEdits`: only preserve draft values if valid (>0); keep base otherwise.
  - Two-tier plan state in SignalDetailCard (tradePlan.value + planDrafts) — the sync gap was in the merge function.
- **Verification**:
  - Build pass ✅
  - Diagnostics clean ✅
  - Deploy health: ok:true, version v2026.05.21 18:47 ✅
- **Deploy Status**:
  - Deployed 8x (iterative debugging), final: v2026.05.21 18:47 - d1d485e1, commit 3dea4cb0

# Session Log: 2026-05-02 13:22
- **Starting Task**:
  - Move `FEAT-20260502-ASYNC-CHART-TILES` from backlog to idea due to immature scope.
- **Work Accomplished**:
  - Moved async-chart-tiles ticket from `2-backlog` to `1-ideas`.
  - Updated feature tracker reference to idea path and marked summary as parked/immature.
  - Removed backlog entry and updated mailbox handoff status to `PARKED_IDEA`.
- **Changed Files**:
  - `/Users/macmini/Trade/Bot/trading/.agents/.product/tickets/1-ideas/2026-05-02-chart-snapshots-componentized-async-chart-tiles.md`
  - `/Users/macmini/Trade/Bot/trading/.agents/.product/tickets/2-backlog/2026-05-02-chart-snapshots-componentized-async-chart-tiles.md` (deleted)
  - `/Users/macmini/Trade/Bot/trading/.agents/.product/tickets/feature_tracker.md`
  - `/Users/macmini/Trade/Bot/trading/.agents/.product/tickets/2-backlog/_master-backlog.md`
  - `/Users/macmini/Trade/Bot/trading/.agents/sync/MAILBOX.md`
  - `/Users/macmini/Trade/Bot/trading/.agents/worklog.md`
- **Technical Decisions**:
  - Park implementation until refresh pipeline and cache contract are finalized.
- **Verification**:
  - Manual link/path consistency check after move ✅
- **Deploy Status**:
  - Not deployed (documentation/ticket-state change only).
