# Handoff: 2026-06-01 — Bars, Logs, UI Fixes

## Agent: Codex (DeepSeek)
## Status: Code written, built, pushed. Local test mostly verified. Some items need verification.

---

## What's Done (Verified Working)

### Bars / Market Data
- `normalizeBarTimeToUTC()` — all bar timestamps snapped to UTC timeframe boundaries
- cTrader bar push: batch-merged, `appendOnly` mode (never overwrite API data), crypto pairs skipped
- `readBrokerBarsFromCsv` + `/v2/market-data/broker-bars`: UTC normalization on read

### cTrader Poll / Ack / Reject Flow
- `promoteDraftTrade`: `dispatch_status` changed from `NEW` to `OPEN` so poll picks it up
- `ackTradeV2`: FAIL → `execution_status = REJECTED` with `rejection_reason`
- `pullLeasedTradesV2`: auto-reject (stale/retry limit) now sets `execution_status = REJECTED`
- `upsertUserAccount`: metadata merged (not overwritten) to preserve `broker_name`/`provider_code`

### Cron AI Analysis
- Pickup mode: "All" (runs all symbols) / "Random" (picks 1 random)
- Rich default prompt loaded from `config/guide/system.md` + `config/guide/strategies.md`
- Per-symbol fileLog with message + created_trades count
- `mt5RunAiAnalysisCron` cleaned: no dead timeframe loop, reads API response body

### Logs Refactoring
- New format: `[ISO] [LEVEL] [EVENT_TYPE] message, key=val, ...`
- `parseLogLine` updated for new format
- `fileLog` auto-generates message when none provided
- EVENT_FILE_MAP renamed to match API routes: `broker_bars`, `broker_prices_sync`, `broker_sync`, `chart_snapshots`
- Folders: `API/`, `CRON/`, `SYSTEM/` (uppercase), `accounts/Ctrader/` (preserves source)
- Trades: logs go to `trade_active/{sid}-{SYMBOL}/logs/` (absolute path, no `data/logs/` prefix)
- `ensureTradeDir`: bare `{sid}` folder creation prevented, falls back to `{sid}-UNKNOWN`

### Notification Persistence
- `data/logs/system/notifications.log` — file-based, 500-line auto-trim
- API: `GET /v2/notifications/list`, `POST /v2/notifications/clear`

### UI
- Draft trade: **Approve** (cyan) + **Reject** (red danger-button) buttons
- Approve → PENDING → redirects to `/trades/pending/{id}`
- Reject → prompts for reason → REJECTED → redirects to `/trades/rejected/{id}`
- Sidebar: Pending, Filled, Closed, Rejected, **Cancelled**, Draft (all with counts)
- Status dropdown filter now navigates `/trades/{status}` instead of `?status=`
- REJECTED statusUi: red FAIL badge
- Info tab: "Reason" field shows `rejection_reason` when present
- Last 30 Days chart (replaced monthly Daily PnL)
- Provider/Broker Name from account metadata in Info tab + Live Chart
- Trade counts via single `GROUP BY` query (`/v2/trades/counts`)
- Cron intervals: added 2h, 3h, 6h, 8h, 12h; Timeframes: added 1W
- `account_broker_name` + `account_provider_code` enrichment in `/v2/trades`

### Server Fixes
- `pullLeasedTradesV2`: `$3` param type ambiguity fixed (PG error)
- Removed duplicate `const sessionId` (Node v25 crash)

---

## What Needs Verification / Remaining Work

1. **Bare `{sid}` folders still exist** — `mt5ListTradeEventsV2` at L15306 calls `tradeLogsDir(safeSid)` without symbol. This creates bare folders. Fix: pass symbol parameter or use `resolveTradeDir` without creating.
   File: `server.js` L15306

2. **Cron AI log message missing trade SID** — should add `trade_sid` to the per-symbol log so we can track which trade was created.
   File: `server.js` around L28190

3. **launchd plists** — deleted from `~/Library/LaunchAgents/`. If server auto-restarts, check for other auto-start mechanisms.

4. **Stale trade_active folders** — some folders like `TFXZ7LEP2` etc have no `-SYMBOL` suffix. These are crypto trades auto-rejected. Move them to `trade_closed/`.

---

## Completion Update (2026-06-01)

- ✅ Item 1 fixed: `mt5ListTradeEventsV2` now uses `findExistingTradeDir(safeSid)` and no longer calls `tradeLogsDir(safeSid)` in a way that can create bare SID folders.
- ✅ Item 2 fixed: Cron AI per-symbol fileLog now includes `trade_sid` when available from API response payload.
- ✅ Item 3 verified: no `com.trading.bot.local` launchd plist present in `~/Library/LaunchAgents`; only `com.local.mt5csvsync.plist` exists.
- ✅ Item 4 done: moved stale bare SID folders from `data/default/trade_active` to `data/default/trade_closed` using status-checked script:
  - `scripts/ops/cleanup_stale_trade_active_dirs.sh`
  - moved: `TFXZ7LEP2`, `TFY1UQ5AP`, `TFXZ92KBT`, `TFY03SEXC`, `TFXZNTDZG`

---

## Files Changed
- `webhook/server.js` — major refactor
- `web-ui/src/pages/trades/V2TradeDetailPage.jsx`
- `web-ui/src/pages/trades/TradesPage.jsx`
- `web-ui/src/App.jsx`
- `web-ui/src/api.js`
- `web-ui/src/components/CronInterval.jsx`
- `web-ui/src/pages/settings/CronPage.jsx`
- `web-ui/src/pages/DashboardPage.jsx`
- `web-ui/src/components/TradePlanEditor.jsx`
- `db/queries.js`
- `config/guide/strategies.md` (new)
- `.agents/wiki/lessons-learned-stale-launchd.md` (new)

## Git
- Committed: `4dbc9fe15` on `origin/main`
- Uncommitted changes exist — commit before deploy.

---

## Start Command
```
lsof -ti:3001 | xargs kill -9
lsof -ti:3000 | xargs kill -9
cd ~/Trade/Bot/trading
node webhook/server.js > /tmp/webhook-server.log 2>&1 &
cd web-ui && npx vite --port 3000 --strictPort --host 127.0.0.1 > /tmp/vite.log 2>&1 &
```
