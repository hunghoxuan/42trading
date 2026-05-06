# Ticket: Chart Sync Cards (Componentized Async Tiles)

## Meta
- ID: `FEAT-20260502-ASYNC-CHART-TILES`
- Status: `COMPLETE`
- Priority: `P1`
- Requested by: `User`
- Implementer: `Deepseek`
- Reviewer/Release: `Codex`

## Decisions Made During Implementation
1. Cache key: `{SYMBOL}_{TF}` (per-TF) — not giant master or `{SYMBOL}` only
2. Provider removed from cache key
3. Refresh fetches ALL TFs, ALL types in single API call
4. Modes share cache — mode controls display only
5. Component: `SymbolChart` (file: `ChartTile.jsx`)
6. Snapshot naming: `SYMBOL_TF.png` (simple, overwrites)
7. `allTfs` prop with default `["D","4H","15M","5M"]`
8. `includeSnapshots: false` in analyze path (fixed 180s timeout)
9. TradePlan mode: `skipFetch=true` — TradeSignalChart handles own data
10. Log config stored in `data.prefixes` (JSONB), not `value` (TEXT)

## Completed
- [x] SymbolChart component with multi-TF, Live/Cache/Snapshots/TradePlan modes
- [x] Per-TF cache (`chartFetchManager` + backend `MARKET_DATA_TF_CACHE`)
- [x] Page warmup reads from chartFetchManager before API calls
- [x] Analyze timeout fixed (60s context build, 30s per-worker, 10s DB query)
- [x] Trade Plan selection with highlight, Entry Model in header
- [x] SmartContent component for JSON/HTML/text display
- [x] Info tab: PD Arrays, Key Levels, Per-TF Bias/Trend cards
- [x] Trace logging with event type toggles on Logs page
- [x] Cron exclude_symbols + status-based enable
- [x] Pulse expanded (per-item-type, per-action)
- [x] All builds pass, deployed to VPS
