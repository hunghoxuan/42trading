# Source Tracking & Cron Status Dashboard

**Status**: Done  
**Date**: 2026-05-17

## Summary

Added per-source connectivity tracking (MT5, cTrader, Binance) with real-time status display on the Health page. Added per-cron status monitoring (MarketData, AI Analysis, Snapshots). Fixed critical bugs in risk sizing and trade plan direction parsing.

## Features

### 1. Source Tracking
- Every broker API call (sync/pull/ack/heartbeat) now includes `source_id` in payload
- Bridge clients hardcode source IDs: `CTrader` → `"Ctrader"`, `MT5 EA` → `"MT5"`
- Server tracks `SOURCE_STATUS` with: connectivity (connected boolean), enabled status, last activity timestamp
- Health page displays per-source: green/gray dot (connectivity), source name, Enabled/Disabled badge, "X ago" timestamp

### 2. Cron Status Dashboard
- Health endpoint returns `cronDetails` per cron: `marketData`, `aiAnalysis`, `snapshots`
- Each cron runs independently with 120s timeout — one hanging doesn't block others
- Health page shows per-cron status cards (MARKET DATA, AI ANALYSIS, SNAPSHOTS)
- Cron tick notification every 60s via `SYSTEM_EVENT`

### 3. SNAPSHOTS_CRON
- New cron type `SNAPSHOTS_CRON` in `user_settings` table
- Captures TradingView chart snapshots via Playwright for configured symbols/timeframes
- Configurable: symbols, timeframes, cadence (minutes), provider, format, quality, theme
- Results stored in `webhook/snapshots/` directory

### 4. Bug Fixes
- **Direction flip**: Root-level AI response `direction` was overriding plan-level `direction` (SELL→BUY)
- **Risk sizing**: `/v2/broker/pull` was missing `risk_money`/`risk_pct` fields — bridges always fell back to 1% default
- **BullMQ jobId**: Colons in job IDs caused queue failures — changed to underscores
- **updated_at conditional**: Only updates on status changes, not PnL-only syncs
- **Broker sync notifications**: Only fire when `execution_status` actually changes

### 5. OpenRouter Integration
- 11 models available: GPT-4o, GPT-4.1, o3 Mini, Claude Sonnet 4, Claude 3.5 Sonnet, Gemini 2.5 Flash/Pro, DeepSeek V3/R1, Llama 4 Maverick, Qwen3 235B
- OpenRouter-specific headers (`HTTP-Referer`, `X-Title`) for ranking
- Model fallback for OpenRouter provider

### 6. UI Enhancements
- Auto-reload on new deploy (polls `/health` version every 60s)
- Dashboard filter labels on top of selects (matching TOTAL/PENDING style)
- Notification items multi-line with errors on 2nd line
- Master snapshot: 410px height + `object-fit: fill`
- ImageViewer component: click-to-preview, download, delete, select mode
- Live chart fullscreen mode
- Input/select/button font-size 10px, toolbar-panel font-size 10px

## Files Changed

| File | Change |
|------|--------|
| `webhook/server.js` | SOURCE_STATUS tracker, trackSourceActivity(), cronDetails, SNAPSHOTS_CRON, risk_money/risk_pct in pull, independent cron loop, OpenRouter headers/fallback |
| `web-ui/src/pages/system/HealthPage.jsx` | Per-source display, per-cron status cards, notification item styling |
| `web-ui/src/pages/DashboardPage.jsx` | Filter labels on top of selects |
| `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | Direction fix, OpenRouter models, ImageViewer |
| `web-ui/src/components/charts/SymbolChart.jsx` | Fullscreen mode, snapshot click-to-preview |
| `web-ui/src/components/ImageViewer.jsx` | NEW: Reusable image viewer with modal, download, delete |
| `web-ui/src/styles.css` | Font-size 10px for inputs/selects/buttons/toolbar |
| `web-ui/index.html` | Auto-reload version poll script |
| `bridge-clients/TVBridge_CTrader.cs` | source_id="Ctrader" in payloads |
| `bridge-clients/TVBridgeEA.mq5` | source_id="MT5" in payloads |
| `config/response_mapping.json` | v2.7 schema mappings |

## DB Migrations
- `user_settings`: SNAPSHOTS_CRON row with symbols/timeframes config
- `users.metadata.settings.snapshots_cron`: boolean toggle

## Configuration
```env
# Enable cTrader source tracking
CTRADER_MODE=demo

# OpenRouter
OPENROUTER_API_KEY=sk-or-v1-...
```
