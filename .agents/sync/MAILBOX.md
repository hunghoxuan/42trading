# Multi-Agent Deployment Ledger (Read First)

Use this section for parallel-agent safety and deploy ordering.

## Current Deploy Lock

- lock_status: `UNLOCKED`
- deploy_owner: `NONE`
- since_utc: ``
- note: `Set lock_status=LOCKED before deploy; release after verification.`

## Required Entry Template

Copy and fill:

```md
### [YYYY-MM-DD HH:mm UTC] AGENT:<name>
- status: DOING | DONE | DEPLOYED | DEPLOY_BLOCKED
- branch: <branch>
- commit: <sha>
- scope: <files/modules>
- merge_to_main: NO | YES (sha)
- deploy:
  - owner: <name>
  - server_version: <value>
  - ea_version: <value>
  - result: PASS | FAIL
- verify:
  - /health:
  - /ui asset:
  - key endpoint:
- handoff_next: <agent/none>
```

## Parallel Agents Rule (A -> B -> C)

- Agent A merge -> deploy -> verify -> post ledger.
- Agent B must pull latest main after A deploy, then merge/deploy/verify.
- Agent C repeats only after B posts success.
- If any deploy fails, set `DEPLOY_BLOCKED` and stop next deployer.

# Handoff — 2026-05-08

> From: Codex session
> To: Next agent / Self

## What Was Done

### Broker Sync SSE Fixes
- **PnL not updating**: SDK SSE `tradeUpdates` only had `pnl_realized`, but UI reads `broker_pnl` first. Added `broker_pnl: it.pnl` to SSE payload.
- **SID mismatch**: `tradeKeyOf(r)` returned `r.id` (integer), but SSE map was keyed by `u.sid` (UUID). Fixed to match by `r.sid`.
- **Event listener churn**: `useRealtimeData` re-registered on every render. Fixed with `useRef`.

### Per-Value Flash Animation
- CSS `.value-flash` — very subtle accent pulse (`rgba(accent, 0.06)`, 0.8s fade)
- Tracks per-field changes via `changedFields` Map<sid, Set<fieldName>>
- `StatusPnlCell` accepts `flashFields` prop, applies `.value-flash` to pips/PnL divs

### Toast Fix (Add Trade from Signal)
- Root cause: `mt5Log` key was `event_type` but function checks `metadata.event`
- Fix: Changed `event_type` → `event` so `NotificationManager.handle` fires

### Signal Auto-Close
- After `+Trade` from signal, queries `execution_profiles` for other subscribers
- If none → `UPDATE signals SET status = 'CLOSED'`
- UI: `showAddTradeButton` hidden for CLOSED/FILLED/CANCELLED/etc signals

### Claude Files Cleanup
- 0 files on Anthropic API — already clean
- Cleared 373 stale entries from `.claude-files.json` + `.claude-context-files.json`

### Logs Page UI
- TYPE filter moved to same row as "Logs" title, right-aligned
- Bottom-sticky TickerBar added to Logs page

### ChartSnapshotsPage Refactor
- Removed Snapshots button + warming process (~350 lines)
- Removed status text display
- AI provider/model selects + Analyze button moved to right side
- Toolbar: `flexWrap: "nowrap"` keeps all controls on one row

### GPT-4o 404 Fix
- Backend: `gpt4o` → `openai` provider alias in `callAiProvider()`
- Frontend: `aiSourceFromModel` returns `"ai_gpt4o"` for GPT models

### Async Multi-Image Upload
- `attachedTradeImage` → `attachedTradeImages` (single to array)
- `attachTradeImageFile` → `addTradeImageFiles` (multi-file support)
- File input: `multiple` attribute
- Each image has individual `x` remove, + "Clear all" button
- `payload.attached_images` array sent to AI analyze endpoint

### Desktop Auth Fix
- Backend: `getUiSessionFromReq` reads `x-session-token` header in addition to cookies
- Login endpoint returns `token` in JSON response
- v3 API client bridges `tvbridge_api_base` + `tvbridge_api_key` localStorage keys

### V3 Desktop App (Phase 1)
- Tauri v2 + React + TypeScript in `app/ui/`
- Imports all v2 pages via `@v2/*` alias (Trades, Signals, Logs, Analyze, Settings)
- API URL + admin key inputs in header
- HomePage: dual auth (API key tab + Login tab)
- Health check with green/red dot
- 8.2MB bundle size
- Zed tasks: `.zed/tasks.json` (Launch, Restart, Build, Deploy, V3 Dev)
- Build script: `scripts/build_desktop.sh`
- Restart script: `scripts/restart_desktop.sh`

## Key Files Changed

| File | What |
|---|---|
| `webhook/server.js` | broker_pnl SSE, session token header, toast fix, signal auto-close, gpt4o fix |
| `web-ui/src/pages/trades/TradesPage.jsx` | SID matching, value-flash, changedFields |
| `web-ui/src/hooks/useRealtimeData.js` | useRef stabilization |
| `web-ui/src/components/TradeSignalListCells.jsx` | flashFields prop |
| `web-ui/src/styles.css` | .value-flash animation |
| `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | Multi-image, remove snapshots/warmup, UI layout |
| `web-ui/src/pages/signals/SignalsPage.jsx` | showAddTradeButton conditional |
| `web-ui/src/pages/system/LogsPage.jsx` | TYPE filter move, bottom TickerBar |
| `app/ui/*` | New V3 desktop app |

## VPS Status
- Webhook: `v2026.05.08 18:38 - 45b9d87` — online, PM2
- Desktop app: built at `app/ui/src-tauri/target/release/bundle/macos/Antigravity.app`

## Outstanding / Next
- [ ] CHART_API logging (event type button exists, no code emits it)
- [ ] Desktop app "Disconnected" issue — CORS or Tauri WebView fetch problem, try `credentials: "omit"` + API key
- [ ] Tauri DMG bundling fails (`.app` works, need `create-dmg` or similar)
- [ ] Windows/Linux Tauri cross-compile
- [ ] V3 Phase 2: Hono + Drizzle backend migration (only if needed)

# Handoff — 2026-05-13

> From: DeepSeek
> To: Next agent

## What Was Done

### AI Response Parsing Fixes (multi-symbol XAGUSD+US30)
- **Root cause**: AI returns JSON-escaped string (`"{\"version\":...}"`) with malformed/truncated JSON. `extractJsonFromAiText` + `normalizeAiAnalysisContract` loses trade plans → "No valid setup" fallback.
- **Server fix**: `recoverTradePlansFromRawAiText` unescapes JSON-string wrappers, extracts plans via balanced bracket parsing, falls back to regex when truncated.
- **Client fix**: `recoverTradePlansFromRaw` in ChartSnapshotsPage.jsx — same logic client-side, always preferred over bad `tryParseJsonLoose` results.
- **`max_tokens`**: bumped 4500 → 32000 (Claude requires it, model stops when done).
- **TP resolution**: `planPrimaryTpNumber` now checks `tp1.price` (was skipping `tp1` entirely).

### Schema v2.7 + Response Mapping
- `config/ai_response_schema.json` → v2.7 deployed.
- `config/response_mapping.json` → version-aware (`versions.2.7.ui_fields`) with paths per UI section:
  - `trade_header`: confidence_pct, risk_percent, skip_decision, grade
  - `plan_basic`: symbol, direction, order_type, profile, timeframe, session, strategy, entry_model
  - `plan_prices`: entry, sl, tp (tp1.price > tp > take_profit), tp2, tp3, rr, be_trigger
  - `plan_meta`: entry_checklists, entry_trigger, invalidation, mid_invalidation, skip_reasons, note
  - `htf_context`, `ltf_analysis`: per-TF trend/bias/phase/narrative
  - `confluence`: sell/buy scores + passed/failed items
  - `events_patterns`, `pd_arrays`: full raw pass-through

### SymbolChart Buttons Refactor
- Unified `[Live] [C] [S]` buttons, removed TradePlan + Refresh.
- `C` = fetch bars via `api.chartTwelveCandles` per TF (bypassed Claude-dependent `/chart/refresh`).
- `S` = list existing VPS snapshots via `api.chartSnapshots`.
- Per-TF status badges in TfHeader (MEM/DB/API, snapshot ✅/📷).
- Snapshot mode shows `<img>` tiles.

### Trade File Attachments
- Drag-drop upload below Note textarea, stored in `trade_files/trade-{sid}/`.
- Image preview, download button, delete.

### NotificationHub
- `no_data` status → ⚠️ yellow warning (was green ✅).
- Single icon per notification (removed duplicate type icon).
- Per-action messages ("- 1 added", "- no data").

## Deploy Status
- commit: `ade8c6e9`
- server_version: `v2026.05.12 21:30 - max-tokens-8k`
- UI: 200 ✅
- config: `response_mapping.json` + `ai_response_schema.json` synced to VPS

## Key Files
| File | Purpose |
|------|---------|
| `config/response_mapping.json` | Schema→UI field paths per version |
| `config/ai_response_schema.json` | AI prompt schema v2.7 |
| `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | `recoverTradePlansFromRaw`, `planPrimaryTpNumber` |
| `webhook/server.js` | `recoverTradePlansFromRawAiText`, `planPrimaryTpNumber` |
| `web-ui/src/components/charts/SymbolChart.jsx` | [Live][C][S] buttons, TfHeader badges |
| `web-ui/src/hooks/useChartTileData.js` | Direct Twelve Data + snapshot list calls |

## TODO / Known Issues
- `events_patterns` and `pd_arrays` in UI not yet rendered — mapping paths exist, need UI components.
- `entry_checklists` (boolean object) needs check/uncheck UI widget.
- Twelve Data daily limit exhausted (800 credits/day).

# Handoff — 2026-05-13 (session end)

> From: DeepSeek
> To: Codex

## Deployed & Verified on VPS
- commit: `cdc97b9e`
- version: `v2026.05.13 13:30 - binance-redis-cache-colors`
- All code pushed to `origin/main`, VPS in sync

## What Was Done

### 1. SymbolChart Button Refactor
- Unified `[Live] [C] [S]` buttons for ALL contexts
- Removed separate TradePlan button, Refresh ↻ button
- Overlay toggles (P1/P2/PD/KL) appear when `hasTradePlan && mode==="cache" && hasBars`
- Short labels: "C", "S"

### 2. Cache/Data Pipeline
- `useChartTileData.js` → `fetchAll()` calls `api.chartTwelveCandles` per TF (parallel via Promise.allSettled)
- Server: `buildAnalysisSnapshotFromTwelve()` → Redis → DB → Twelve Data
- **Binance free API** for crypto: BTC,ETH,SOL,DOGE... → `api.binance.com/v3/klines`
- Snapshot file naming: stripped provider prefix (`ICMARKETS_BTCUSD` → `BTCUSD`)

### 3. Schema v2.7 + Response Mapping
- `config/ai_response_schema.json` v2.7 deployed
- `config/response_mapping.json` with version-aware paths (`versions.2.7.ui_fields`)
- Client-side `recoverTradePlansFromRaw()` extracts plans from raw AI text when JSON parse fails
- `max_tokens` bumped to 32000

### 4. Bug Fixes
- `planPrimaryTpNumber`: added `tp1.price` priority (was missing)
- `tfToMs`: handles `1DAY`, `1WEEK`, `1MIN` formats (was only `D`, `W`, etc.)
- Crosshair sync disabled (`syncedCrosshair={null}`) to prevent TradeSignalChart null crash
- [S] snapshot list: 15s timeout to prevent forever loading
- [S] stays on snapshot mode on ERROR instead of auto-switching to Live
- Body margin: `0` for fullscreen dashboard

## What Still Needs Fixing

### [C] TradeSignalChart "Value is null" crash
- `SymbolChart.jsx` line ~568: `hasBars` check prevents TradeSignalChart during LOADING
- But AFTER loading (status=READY), TradeSignalChart renders and crashes
- crash is in `setCrosshairPosition` → syncedCrosshair already set to null
- **Need to find the actual null value inside TradeSignalChart** — file `web-ui/src/components/TradeSignalChart.jsx`, function `v` at line ~2204 (minified)

### [S] still not showing snapshot images
- `useChartTileData.js` `fetchAll()` snapshot mode calls `api.chartSnapshots(100)` 
- Filters by symbol, matches TF by file_name pattern `_15m_` / `_15M_`
- If found: sets `entry.snapshot = { file_name, url }` → `master.snapshots[tf]` → `<img>` in SymbolChart
- **Check if snapshot files actually exist on VPS** at `/opt/trading/webhook/snapshots/`
- **Check if `/v2/chart/snapshots/` GET endpoint returns files**
- **Check if SymbolChart snapshot `<img>` URL is correct** — uses `/v2/chart/snapshots/{file_name}`

### Cache source labels not updating in UI
- `SymbolChart.jsx` TfHeader badge shows: "Redis" / "DB" / "Binance" / "Twelve"
- Color: green for remote API, grey for cached
- **Check if `context.cache_source` is being passed correctly from `useSymbolChartData` → `master.context[tf].cache_source`**

### All TFs show same chart data
- Each TradeSignalChart tile has `chartId = ${symbol}-${tf}`
- TradeSignalChart has its own `chartFetchManager.get(symbol, interval)` call
- **Since `chartFetchManager.set()` was removed from the hook, TradeSignalChart fetches its own data**
- **Need to either: restore `chartFetchManager.set()` in fetchAll, or make TradeSignalChart use passed bars data**

### Dashboard
- Body margin set to 0 in CSS
- Dashboard grid: removed 20% sidebar column
- Removed Direction and Chart TF filters
- **User reports not seeing changes** — verify `body{margin:0}` in `/opt/trading/web-ui/dist/assets/index-*.css`

