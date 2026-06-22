# Trade UI Layout + Static Chart Action Fix + Close Snapshot + Object Persistence

## Meta
- Ticket Type: `Extend Feature`
- Ticket Status: `Done`
- Owner: `DeepSeek`
- Updated: `2026-05-19 09:07 UTC`
- Commit: `81bf521e`

## Implemented

### A) UI layout and slider behavior
- Removed "Strategic Note" label text (SmartContent editor remains)
- RR, RR2, RR3 changed from read-only `NumericNoSlider` to interactive `NumericInline` with sliders
- `calcTpFromRr(entry, sl, rr, direction)` computes TP from RR slider changes
- RR2 → TP2, RR3 → TP3 recalculation on slider change
- Left grid column: `minWidth: 0`, `overflow: hidden` to prevent overlap

### B) Static/fixed chart action wiring
- Bars dropdown (Q), +/- grid buttons now render in cache mode regardless of `showPerCardLayoutControls`
- Buy/Sell quick action: always calls `onQuickTradeIntent` (removed `!(hasTradePlan && hasAnalysis)` guard)
- Context menu Entry/TP/SL: calls both `onPlanLevelChange` AND `onQuickTradeIntent` when available

### C) Auto snapshot on close
- `brokerSyncV2`: after snapshot-close, auto-captures chart snapshots for closed trades
- Uses `captureTradingViewSnapshotsBatch()` with TFs ["15m", "1h", "4h", "1D"]
- Calls `persistTradeSnapshotFiles()` to attach filenames to metadata
- Non-blocking (failures logged, don't block sync)

### D) Object persistence
- `POST /v2/trades/{tradeRef}/chart-objects` — saves `{ objects: [...] }` to `metadata->'chart_objects'`
- `GET /v2/trades/{tradeRef}/chart-objects` — returns stored objects
- `api.saveChartObjects()`, `api.loadChartObjects()` in api.js

## Files Changed
- `src/ui/src/components/TradePlanEditor.jsx` — RR sliders, note removal, layout fix
- `src/ui/src/components/charts/SymbolChart.jsx` — static controls, quick trade wiring
- `src/ui/src/api.js` — chart objects API functions
- `webhook/server.js` — close auto-snapshot, chart objects routes

