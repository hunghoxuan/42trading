# AI Analyze/Trade Navigation + Quick Direction Action Mapping

## Meta
- Ticket Type: `Update Feature`
- Ticket Status: `Done`
- Owner: `DeepSeek`
- Updated: `2026-05-19 09:07 UTC`
- Commit: `81bf521e`

## Implemented
- `/ai/analyze`: `[< List]` navigates to `/trades`, `[Trade]` navigates to `/ai/trade/{symbol}`
- `/ai/trade`: `[< List]` navigates to `/trades`, `[Analyze]` navigates to `/ai/analyze/{symbol}`
- Buy/Sell context click: always sets direction=BUY/SELL + entry=clicked price (removed `!(hasTradePlan && hasAnalysis)` guard)
- Context menu Entry/TP/SL: calls BOTH `onPlanLevelChange` and `onQuickTradeIntent` when available

## Files Changed
- `src/ui/src/pages/ai/ChartSnapshotsPage.jsx` — split nav buttons, toolbar condition
- `src/ui/src/components/charts/SymbolChart.jsx` — Buy/Sell always sets direction+entry, context menu dual-fire

