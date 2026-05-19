# Chart Snapshots: Componentized Async Chart Tiles (Plan)

## Status: COMPLETE

## Goal
Replace monolithic all-timeframe bars/context fetch flow with independent per-chart tiles so each symbol/timeframe chart can load, refresh, and report status without blocking others.

## What Was Built

### SymbolChart Component
- File: `web-ui/src/components/charts/SymbolChart.jsx`
- Multi-TF per symbol: one card shows all TFs in a horizontal row
- Props: `symbol`, `timeframes[]`, `defaultMode`, `onAnalyze`, `onRemove`, `entryPrice`, `slPrice`, `tpPrice`, `analysisSnapshot`, `hasTradePlan`, `hasAnalysis`, `skipFetch`
- Modes: Live TV (iframe), Cache (TradeSignalChart), Snapshots (bars + snapshot pipeline)
- After analysis: shows Live + TradePlan buttons, hides Cache/Snapshots
- Auto-switches to TradePlan mode when hasTradePlan + bars ready
- Status indicators: per-button color (green=ready, amber=loading, red=error, gray=idle)
- Hover tooltip shows cached time or error message
- TfHeader shows trend/bias with color next to each TF

### Data Layer
- `chartFetchManager.js` — per-TF cache (`EURUSD_4H`), TTL = TF duration
- `useSymbolChartData.js` — hook with cache-first, parallel fetch, skipFetch support
- Backend: per-TF `MARKET_DATA_TF_CACHE` with `tfCacheGet/tfCacheSet`, TTL-based expiry
- Snapshot naming: `EURUSD_4H.png` (simple, overwrites)
- Removed: giant master cache, UnifiedCache wrapper, legacy fallback chain

### APIs
- `api.chartRefresh()` — one call for ALL TFs, ALL types
- Claude upload optional (VPS files sufficient for snapshot readiness)
- `includeSnapshots: false` in analyze path (avoids Playwright hang)
- 60s timeout on `buildAiContextBundle`, 30s per-worker, 10s per DB query

### Trade Plan Integration
- Trade Plan cards with click-to-select, highlighted border
- Entry Model displayed in PlanHeader (text, not textbox)
- Strategic Note uses SmartContent (view/edit toggle, copy, auto-format)
- Skip reasons + severity displayed below Strategic Note
- Per-TF Bias/Trend cards in Info tab (colored by direction)

### Logging & Observability
- Trace logging: `genTraceId`, `logEvent`, `logApiCall`
- Event types: CRON_MD, FETCH_API, CHART_API, ANALYZE, CACHE, DB
- Log toggles on `/system/logs` page (persisted to `data.prefixes` in user_settings)
- Pulse expanded: per-item-type + per-action (created/updated/deleted)

### Cron
- Fixed: cron checks `status = 'ACTIVE'` (not JSON `enabled` field)
- Added: `exclude_symbols` support with UI textarea in Settings
- Market data cron: 60s cadence, batch processing, BullMQ support

### SmartContent Component
- `web-ui/src/components/SmartContent.jsx`
- Auto-detects: JSON → pretty-print, HTML → render, text → split by ". " or newline
- Modes: readonly | editable (with ✏️/👁 toggle + 📋 copy)
- Applied to: JSON tab, Strategic Note, Info tab NOTE section

## Files Created/Modified
| File | Change |
|------|--------|
| `web-ui/src/components/charts/SymbolChart.jsx` | SymbolChart component |
| `web-ui/src/hooks/useChartTileData.js` | useSymbolChartData hook |
| `web-ui/src/services/chartFetchManager.js` | Per-TF fetch manager |
| `web-ui/src/components/SmartContent.jsx` | Smart content renderer |
| `web-ui/src/components/TradePlanEditor.jsx` | Entry Model, SmartContent note, slider fixes |
| `web-ui/src/components/SignalDetailCard.jsx` | PlanHeader, plan selection, Info tab sections |
| `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | SymbolChart integration, warmup cache check |
| `web-ui/src/pages/system/LogsPage.jsx` | Log type toggles |
| `web-ui/src/pages/system/CachePage.jsx` | Renamed to CACHE |
| `web-ui/src/pages/settings/SettingsPage.jsx` | Exclude symbols, TRADE→OTHERS rename |
| `webhook/server.js` | Per-TF cache, trace logging, analyze timeout fix, cron fixes |

## Acceptance
1. [x] Independent tile load/refresh/status works
2. [x] Failed tile does not block other tiles
3. [x] Manual refresh updates shared cache
4. [x] Live TV / Fixed Data / Snapshot / TradePlan modes
5. [x] No regression in symbol/timeframe workflows
6. [x] Cache key is per-TF (`{SYMBOL}_{TF}`)
7. [x] Page warmup reads from chartFetchManager
8. [x] Backend stores file_id in market_data.metadata
9. [x] Analyze timeout fixed (60s buildAiContextBundle, 30s per-worker)
10. [x] Trade Plan selection, Info tab, SmartContent
11. [x] Logging with event type toggles
12. [x] Cron exclude symbols + status-based enable
