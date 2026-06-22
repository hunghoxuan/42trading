# Multi-Cron Support + Snapshot Improvements

## Meta
- Ticket Type: `Feature + Fix`
- Ticket Status: `Done (local), pending deploy`
- Owner: `DeepSeek`
- Updated: `2026-05-23`

## Changes

### 1. Fix: Cron Loop Stall (P0)
**Problem:** `CRON_STATE.isRunning` was set to `true` but never reset. The master cron loop ran once then silently died forever. Health API lied — `scheduler_running: true` but no ticks happened.

**Fix:** Added `CRON_STATE.isRunning = false` at end of each tick in `mt5CronLoop()`.

**File:** `webhook/server.js` (line ~23670)

### 2. Fix: Cron Ticks Invisible in UI
**Problem:** `cron_tick` SSE events fired but had no `ticker` flag. `NotificationManager.handle()` overrides `ticker` from `SYSTEM_EVENT` defaults (`ticker: false`).

**Fix:** Added `_force_ticker: true` + `user_id: "*"` to cron_tick payload. Added `sseRegisterClient("*", res)` in SSE stream handler so all clients receive global broadcasts.

**File:** `webhook/server.js`

### 3. Feature: Multi-Cron Support (per-type, many crons)
**Problem:** Only 3 fixed crons by `name` (MARKET_DATA_CRON, ANALYSIS_CRON, SNAPSHOTS_CRON). Users couldn't create multiple crons per type (e.g., 1 SNAPSHOTS for crypto at 1min + 1 for forex at 15min).

**Fix:**
- **Backend:** Changed cron queries from `s.name = 'XXX_CRON'` to `s.data->>'cron_type' = 'XXX_CRON'`. Removed user metadata toggle checks (use `s.status = 'ACTIVE'`). Each cron has a unique `name` (e.g., `CRON_SNAPSHOTS_CRON_lrx3k2`). Added `cadence_seconds` support.
- **Frontend:** Rewrote CronPage with left panel (cron list) + right panel (unified edit form). New Cron button, delete, status toggle. Symbols group selector (Watchlist/Crypto/Forex/Indices/Metals/Custom). Interval: 15s/30s/1m/5m/15m/30m/1h/4h/1d.
- **DB migration:** Backfilled existing rows with `cron_type` in `data` JSONB.

**Files:** `webhook/server.js`, `src/ui/src/pages/settings/CronPage.jsx`

### 4. Change: Snapshots Folder Structure
**Problem:** All snapshots saved flat in `/snapshots/` (e.g., `XAUUSD_1H.png`, `EURUSD_MASTER.png`). Messy with many symbols.

**Fix:** New structure `/snapshots/{SYMBOL}/{SYMBOL}_TF.png`. Added `snapshotSymbolDir(symbol)` helper. Updated all save paths, list functions, find functions, and serve route. Serve route backward-compatible with old flat paths.

**Files:** `webhook/server.js`

### 5. Fix: Consistent PNG Format
**Problem:** Mixed `.jpg` and `.png` usage across capture paths.

**Fix:** Changed all hardcoded `"jpg"` defaults to `"png"` in `ensureAiTfContext` and API handler. DB and frontend already used `png`.

**Files:** `webhook/server.js`

### 6. Fix: Duplicate + Unsorted Timeframes in Master Grid
**Problem:** Master snapshot grid showed duplicate TFs and random order.

**Fix:** Dedup + sort (high→low via `parseTfTokenToSeconds`) in both `captureTradingViewSnapshotsBatch` and `/v2/chart/snapshots-grid/` route. Applies to both cron and manual snapshots (same function).

**Files:** `webhook/server.js`

### 7. Fix: Playwright macOS Path
**Problem:** `resolvePlaywrightChromiumExecutablePath()` hardcoded `/root/.cache/ms-playwright` (Linux only). Failed on macOS.

**Fix:** Added macOS cache path (`~/Library/Caches/ms-playwright`) and `chrome-mac-arm64` binary search. Linux paths kept as fallback.

**Files:** `webhook/server.js`

### 8. Security: Removed Hardcoded API Key
**Problem:** `scripts/daemons/mt5_csv_sync.sh` had a real API key hardcoded as fallback value.

**Fix:** Changed to `API_KEY="${API_KEY:?must set API_KEY env var}"`. Updated installer to pass `API_KEY` as LaunchAgent `EnvironmentVariables`.

**Files:** `scripts/daemons/mt5_csv_sync.sh`, `scripts/install/install_mt5_csv_sync_launchd.sh`

## Files Changed
| File | Summary |
|------|---------|
| `webhook/server.js` | Cron loop fix, multi-cron, snapshot folder, PNG format, TF dedup/sort, Playwright macOS path |
| `src/ui/src/pages/settings/CronPage.jsx` | Full rewrite: left list + right form, multi-cron, symbols groups, intervals |
| `scripts/daemons/mt5_csv_sync.sh` | Removed hardcoded API key |
| `scripts/install/install_mt5_csv_sync_launchd.sh` | API_KEY env var in LaunchAgent plist |
| `webhook/README.md` | Updated usage with API_KEY requirement |

## Verification
- [x] Cron loop cycles every 60s (6+ ticks confirmed on VPS and localhost)
- [x] `scheduler_running: false` after each tick
- [x] `cronEvents` growing in `/health`
- [x] SSE `cron_tick` events received with `ticker: true`
- [x] Multi-cron queries work: `data->>'cron_type' = 'SNAPSHOTS_CRON'`
- [x] Snapshots saved to `snapshots/{SYMBOL}/`
- [x] Master grid TFs deduplicated and sorted high→low
- [x] All snapshot paths use `.png`
- [x] Playwright finds chromium on macOS
- [x] `node --check server.js` passes
- [x] `npx vite build` passes
- [x] Localhost server starts and health returns OK

## Deploy Status
- Not deployed to VPS yet.
- Localhost tested and verified.
