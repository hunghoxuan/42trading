# Handoff: AI Trade Detail UI Fixes

## Read First
- `AI.md`
- `.agents/BOOTSTRAP.md`
- `.agents/.product/tickets/1-backlog/plan-fix-bug-ai-trade-detail-chart-info-context-menu.md`
- `.agents/rules/ui.md`
- `.agents/rules/testing.md`
- `.agents/rules/deploy.md`

## User Request
Implement the screenshot-driven UI fixes:

1. Remove `Raw Analysis`.
2. If a symbol is already selected, show two charts per row by default.
3. In the Info tab, show two charts per row by default.
4. Right-click chart context menu:
   - `Buy` / `Sell` must not add a new trade plan.
   - `Buy` / `Sell` should update the active trade direction and entry price.
   - Rename TP2/TP3 context-menu labels/actions clearly.
5. Display TP1, TP2, TP3 together in the chart, with green family styling and slightly different opacity/background.
6. Show `strategy | entry_model` and `risk_management.grade`, `risk_percent`, `confidence_pct`, `estimated_entry_mins`, `suggested_action` as badges.
7. Display all useful `analysis` and `risk_management` information in the Info tab as structured UI, not just JSON.

## Screenshot Evidence
- Screen 1: `Raw Analysis` label appears above JSON; remove it.
- Screen 2: Selected `GBPJPY` currently shows `d`, `4h`, `15m`, `5m` in one row; change default layout.
- Screen 3: Desired selected-symbol chart grid is two-by-two.
- Screen 4: Context menu currently has `Buy`, `Sell`, `Entry`, `TP`, `SL`; Buy/Sell must update active plan instead of creating plans. Chart currently displays `P1 TP` only.
- Screen 5: Header only shows `SMC 0.0%`; expand to badges with strategy, entry model, risk grade/percent/confidence/timing/action.

## Likely Files
- `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`
- `web-ui/src/components/SignalDetailCard.jsx`
- `web-ui/src/components/TradeSignalChart.jsx`
- `web-ui/src/components/charts/SymbolChart.jsx`
- `web-ui/src/utils/signalDetailUtils.jsx`

## Constraints
- Current/future v3 schema only.
- Preserve exact raw AI payload. Derive UI fields, do not mutate `raw_json`.
- No legacy middle transform.
- No new trade plan row/card from context-menu Buy/Sell.
- Scope tightly to requested UI behavior.

## Required Checks
- `rtk npm --prefix web-ui run test:unit`
- `rtk npm --prefix web-ui run build`
- Browser/screenshot verification for:
  - no Raw Analysis block
  - selected-symbol chart grid two columns
  - Info tab chart grid two columns
  - Buy/Sell context menu updates active plan
  - TP1/TP2/TP3 render together
  - Info tab structured badges/sections

## Deploy Notes
If implementation changes UI/backend/scripts:
- Run `rtk bash scripts/deploy/bump_build_versions.sh`
- Commit and push `origin/main`
- Follow `.agents/rules/deploy.md` lock/SOP
- Verify live `/health` and `/ui` asset

## Expected Return Format
- Root cause / change summary
- Files changed
- Checks run
- Browser verification notes
- Deploy status/version
