# Fix Bug: Analyze still fails locally + SymbolChart max-depth console spam

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `Open`
- Owner: `Codex`
- Updated: `2026-05-22 UTC`

## Problem
1) Clicking Analyze from localhost still returns `No snapshots found for analysis.`
2) Console is spammed with `Warning: Maximum update depth exceeded` from `SymbolChart.jsx`.

## Root Causes
- `SymbolChart` bootstrap effect depended on `entryPrice/tpPrice/slPrice`, causing repeated parent-child update feedback and render-loop warnings.
- Analyze backend fallback was too strict (session+provider+symbol match). If provider differs but symbol snapshots exist, pool became empty and returned no snapshots.

## Fix Scope
- `src/ui/src/components/charts/SymbolChart.jsx`
  - Make chart-object bootstrap run on `tradeSid` change only.
  - Guard `onTradePlanGroupChange` callback to fire only when plan group actually changes.
  - Remove noisy debug logs.
- `webhook/server.js`
  - Add provider-agnostic symbol fallback and final all-snapshots fallback before returning "No snapshots found".
- `src/ui/src/pages/ai/ChartSnapshotsPage.jsx`
  - If analyze returns `No snapshots found for analysis`, fetch recent snapshots and retry once with symbol-matched files.

## Validation Checklist
- [ ] Local Analyze works when snapshots exist (even with provider prefix mismatch).
- [ ] Local Analyze still works on strict provider match.
- [ ] Console no longer spams max-depth warning when opening Analyze/SignalDetail flows.
- [ ] No regression on chart object load/save for existing trades.
