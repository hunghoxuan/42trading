# Trade Info chart TP lines and TradePlan edit revert regression

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `Plan`
- Owner: `N/A`
- Updated: `2026-05-21 10:15 UTC`

## Problem
On AI Trade detail (`Info` tab chart + TradePlan editor), three regressions are reported:

1. TP2 and TP3 do not show on the Info chart.
2. Price-line labels include unwanted text (`P1` and percent/price-change text). Required labels are only:
   - `Sell`
   - `SL`
   - `TP1`
   - `TP2`
   - `TP3`
3. When SL/TP1/TP2/TP3 lines are changed on chart, the Info chart reflects updates, but TradePlan Edit inputs snap back to original values instead of keeping edited values.

## Investigation
- Evidence:
  - User screenshot: `/var/folders/86/hf00kffn707fh322gxgvlcc00000gn/T/TemporaryItems/NSIRD_screencaptureui_P5k7h0/Screenshot 2026-05-21 at 12.15.22.png`
  - Visible line label includes `P1 TP1 +-1.6%` on chart; this conflicts with requested label-only format.
  - TradePlan editor shows fields for `ENTRY`, `TP1`, `TP2`, `TP3`, and `SL`, indicating expected multi-TP editable flow.
- Findings:
  - Likely regression boundary is sync contract between chart overlay edits and TradePlan Edit form state (source-of-truth mismatch or effect overwrite).
  - Constraints/guards likely re-normalize values back to original payload after chart change event.
  - Label formatting layer currently appends performance/change suffix and P-index prefix (`P1`) to TP lines.
- Open questions:
  - None blocking. Requested behavior is explicit.

## Solution
Implement bugfix in three parts:

1. **Render parity for TP ladder in Info chart**
   - Ensure TP1/TP2/TP3 line overlays are all rendered when values exist.
   - Keep ordering and visibility consistent for Sell direction.

2. **Simplify line labels**
   - Remove plan index prefix (`P1`) from line labels in this view.
   - Remove price/percent change suffix from line labels in this view.
   - Keep labels exactly: `Sell`, `SL`, `TP1`, `TP2`, `TP3`.

3. **Fix edit-state persistence**
   - Make chart line edits the same canonical source used by TradePlan Edit inputs.
   - Prevent post-edit effects/constraints from reverting SL/TP1/TP2/TP3 to original values.
   - Revalidate all constraints so valid edits persist and only truly invalid edits are corrected with clear rule handling.

## Expected Output / Verification
- [ ] Info chart renders TP1, TP2, TP3 lines when provided.
- [ ] Line labels in Info chart are exactly `Sell`, `SL`, `TP1`, `TP2`, `TP3`.
- [ ] No `P1` prefix or price-change suffix appears in those labels.
- [ ] Editing SL/TP1/TP2/TP3 via chart updates corresponding TradePlan Edit inputs and values do not revert.
- [ ] Constraint logic still blocks/adjusts only invalid values (no silent reset for valid edits).
- [ ] `rtk npm --prefix web-ui run build`
- [ ] Relevant UI tests (if present) pass.
- [ ] Browser verification screenshot for edited lines + synced inputs.

## Handoff Prompt
```text
Tag: TICKET
Read:
- .agents/.product/tickets/1-backlog/2026-05-21-trade-info-chart-tp-lines-and-edit-revert-regression.md
- AI.md
- .agents/BOOTSTRAP.md
- .agents/rules/ui.md
- .agents/rules/testing.md

Task:
Fix Info chart and TradePlan edit sync regressions for TP ladder and line labels. Ensure TP2/TP3 render, labels are exactly Sell/SL/TP1/TP2/TP3 (no P1 or price-change text), and chart edits for SL/TP1/TP2/TP3 persist into TradePlan Edit inputs without reverting.

Constraints:
- No new branch required for this tag.
- Keep compatibility with existing trade_plan/raw_json contract.
- Keep validation constraints, but do not reset valid user edits.
- Scope only to the described regression.

Return:
- ticket name
- root cause summary
- files changed
- checks run
- deploy status
```
