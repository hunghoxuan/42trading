# AI trade detail chart, info, and context menu fixes

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `Plan`
- Owner: `Codex`
- Updated: `2026-05-19 18:12 UTC`

## Problem
The AI trade detail / analysis UI still has several current-flow UX and data presentation bugs:

1. The response panel shows a `Raw Analysis` block that should be removed.
2. When a symbol is already selected, the default chart layout shows four charts in one row instead of a two-by-two grid.
3. The Info tab chart layout should also default to two charts per row.
4. Right-click chart context menu actions incorrectly add new trade plans when clicking `Buy` or `Sell`; they should update the selected/current trade plan direction and entry only.
5. Chart context menu labels need clearer TP naming: rename TP2/TP3 actions in the context menu.
6. The chart should display TP1, TP2, and TP3 together, not only the primary TP.
7. TP1/TP2/TP3 chart lines/zones should share green family styling but use slightly different opacity/background so they are distinguishable.
8. The current Info tab summary is too thin. It should display structured AI fields from current/future v3 schema instead of dumping JSON.

## Investigation
- Evidence:
  - Screenshot 1: A `Raw Analysis` heading appears above a JSON panel containing a flattened `trade_plan`; user explicitly wants this block removed.
  - Screenshot 2: With `GBPJPY` selected, chart tiles `d`, `4h`, `15m`, `5m` render as four charts in one horizontal row.
  - Screenshot 3: Desired default layout is a two-column chart grid: `d` + `4h` on first row, `15m` + `5m` on second row.
  - Screenshot 4: Right-click menu on chart shows `Buy @ 4492.6`, `Sell @ 4492.6`, `Entry @ 4492.6`, `TP @ 4492.6`, `SL @ 4492.6`. User wants Buy/Sell to update the active plan, not create a new plan, and wants TP2/TP3 renamed in the context menu.
  - Screenshot 4: Chart currently labels `P1 TP` only; user wants TP1, TP2, TP3 displayed together with distinguishable green backgrounds/opacities.
  - Screenshot 5: Summary only shows `SMC 0.0%`; user wants `strategy | entry_model` and risk-management metrics/badges.
- Findings:
  - Required surfaces are likely `src/ui/src/components/SignalDetailCard.jsx`, `src/ui/src/pages/ai/ChartSnapshotsPage.jsx`, chart components under `src/ui/src/components/charts/`, and context-menu handling in `TradeSignalChart` / chart overlay code.
  - Current/future AI schema source fields should come from exact v3 raw payload:
    - `strategy`
    - `entry_model`
    - `risk_management.grade`
    - `risk_management.risk_percent`
    - `risk_management.confidence_pct`
    - `risk_management.estimated_entry_mins`
    - `risk_management.suggested_action`
    - `context.*`
    - `analysis.*`
    - `execution_plan.*`
- Open questions:
  - None blocking for first implementation pass; user gave exact UI direction.

## Solution
Implement current/future AI v3 UI behavior:

1. Remove the `Raw Analysis` block from the response/info panel.
2. Default selected-symbol charts to a responsive two-column grid at desktop widths, falling back to one column on narrow screens.
3. Apply the same two-column chart grid default inside the Info tab.
4. Change right-click chart context menu:
   - `Buy @ price`: update active trade plan `direction=BUY` and `entry=price`; do not create another plan.
   - `Sell @ price`: update active trade plan `direction=SELL` and `entry=price`; do not create another plan.
   - `Entry @ price`: update active plan entry only.
   - TP actions should target current plan TP fields instead of creating plan rows.
5. Rename TP context menu actions to explicit `TP1`, `TP2`, `TP3` labels.
6. Render TP1/TP2/TP3 together on chart when present:
   - read from `execution_plan.tp1.price`, `execution_plan.tp2.price`, `execution_plan.tp3.price`
   - fallback to current derived editor fields only when raw v3 fields are absent
   - draw each with green styling and slight opacity/background differences
7. Expand Info tab into structured sections, not raw JSON:
   - Header badges: `strategy | entry_model`, `grade`, `risk_percent`, `confidence_pct`, `estimated_entry_mins`, `suggested_action`
   - Context section: HTF, entry TF, HTF bias, LTF structure, macro, draw-on-liquidity, daily note
   - Execution section: entry, SL, TP1/TP2/TP3, RR, breakeven trigger, invalidation notes
   - Analysis section: market structure, POI quality, HTF context, LTF trigger, SL validity, risk filters
   - Risk management section: grade, confidence, risk percent, suggested action, timing/cancel window

## Expected Output / Verification
- [ ] No `Raw Analysis` label/panel appears in the AI response/info area.
- [ ] Selected-symbol chart view defaults to two charts per row on desktop.
- [ ] Info tab chart view defaults to two charts per row on desktop.
- [ ] Right-click `Buy`/`Sell` updates active plan direction and entry, and does not add a new trade plan card/row.
- [ ] Context menu uses explicit TP labels (`TP1`, `TP2`, `TP3`) for target assignment.
- [ ] Chart displays TP1/TP2/TP3 simultaneously when v3 `execution_plan` contains them.
- [ ] TP1/TP2/TP3 have distinct green opacity/background styling.
- [ ] Info tab shows structured v3 analysis and risk-management fields, including badges for strategy, entry model, grade, risk percent, confidence percent, estimated entry minutes, and suggested action.
- [ ] `rtk npm --prefix src/ui run test:unit`
- [ ] `rtk npm --prefix src/ui run build`
- [ ] Browser verification against local or deployed UI screenshots for the five requested areas.
- [ ] If deployed: live `/health` and `/ui` asset verified.

## Handoff Prompt
```text
Read:
- .agents/.product/tickets/1-backlog/plan-fix-bug-ai-trade-detail-chart-info-context-menu.md
- AI.md
- .agents/BOOTSTRAP.md
- .agents/rules/ui.md
- .agents/rules/testing.md
- .agents/rules/deploy.md

Task:
Implement the AI trade detail/chart/info fixes from the ticket. Focus only on current/future AI v3 schema. Remove the Raw Analysis panel, make selected-symbol and Info tab charts default to two columns, change chart context-menu Buy/Sell to update the active plan direction+entry instead of adding a new plan, rename TP context-menu actions, render TP1/TP2/TP3 together with distinguishable green styling, and replace raw JSON-style Info tab output with structured analysis/risk-management sections and badges.

Constraints:
- Do not reintroduce legacy raw-plan flattening.
- Do not create a new trade plan when context-menu Buy/Sell is clicked.
- Derive editor/display fields from exact v3 raw payload without mutating raw_json.
- Keep scope to the requested UI behavior.
- Run required UI checks.
- If code changes are deployed, follow deploy SOP and bump versions.

Return:
- root cause / change summary
- files changed
- checks run
- screenshots/browser verification notes
- deploy status and live version if deployed
```
