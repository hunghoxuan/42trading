# Handoff: Sync & Trade Lifecycle Fixes

## State as of 2026-05-30 15:30 UTC

### What was done

**Broker sync boolean→numeric error (ROUND 2 — FIXED):**
- Root cause: cTrader sync data contains `false` (boolean) for unused numeric fields. The initial fix (lines ~10013-10028) normalized 16 fields but missed `has_partial`.
- Fix 1 (lines 10013-10040): Added `has_partial` to explicit normalizer list + catch-all loop that normalizes ANY boolean field found on the sync item (logs as `sync-bool-field-NEW`).
- Fix 2 (line ~10334): Fallback UPDATE query had duplicate `$25` — used for both `has_partial` (boolean) and `tp1` (numeric). Changed `$25::boolean` → `$24::boolean` (correct position).
- Server restarted via launchd. Health check: ok, version `v2026.05.28 12:18`.
- To verify: `grep "sync-bool-field-NEW" .local/webhook.stderr.log` — if any appear, it means new boolean fields were caught and normalized.
- If no more `cannot cast type boolean to numeric` errors → sync fully fixed.

**Trade lifecycle fixes:**
- `order_type` defaults to `'limit'` in fanout (was `null`)
- `account_id` skips null accounts in fanout
- `ackTradeV2` fixed: `.returning()` without explicit fields (Drizzle bug causes crash)
- `ensureTradeDir` strips trailing `-SYMBOL` from SID to prevent `-BTCUSD-BTCUSD-...` duplication
- Trade folders moved to `data/default/trade_files/` (user-scoped)
- Cron AI: logs saved to correct trade SID folder, better prompt, stale snapshot check (3 min)
- Broker pull: includes null-account_id trades, excludes CANCELLED/CLOSED unless dispatch is CANCEL
- Cancel VPS→cTrader: pull query accepts CANCELLED trades with CANCEL dispatch

**UI changes:**
- AI menu: Analyze + Response sub-items
- SymbolChart toolbar: 📷 | Snapshots > | Trade > | AI > (all always visible)
- `/ai/response` page: split panel with trade_files folder list + embedded ChartSnapshotsPage
- Trade edit modal: account dropdown
- TradePlanEditor: account dropdown after Note, before Trade button
- TradesPage: build version in header; ProfilePage: username display

**Data cleanup:**
- Moved trade files from `data/trade_files/` → `data/default/trade_files/`
- Deduplicated `-BTCUSD-BTCUSD-` folder names
- CSV bars limited to 3000 per file

### Known issues / Not done

1. **cTrader cBot SL/TP corruption**: cBot creates order with correct SL/TP, then modifies with wrong values (13300/15100 instead of 73500/73784). Bug in `bridge-clients/TVBridge_CTrader.cs`.

2. **cTrader executor daemon not running**: `v2_broker_executor_daemon.js` requires `V2_BROKER_ACCOUNT_API_KEY` env var. Paper executor creates fake tickets. Real execution needs cTrader cBot running on desktop.

3. **Cross-account duplicates**: `fanoutSignalTradeV2` creates one trade per active account. If multiple active accounts exist, same signal creates multiple trades.

4. **Stale LEASED trades**: Trades stuck in LEASED if executor crashes. Lease expires after 1 minute but re-pull might fail if executor not running. Auto-rejected after 3 lease retry failures via `syncGuards.shouldAutoRejectLeasedTrade`.

5. **Sync "items=0" from cTrader**: cTrader sometimes sends empty sync payloads. Unknown why — possibly cBot timer/backoff issue. Server-side handles gracefully (returns ok).

### Files changed (main)
- `webhook/server.js` — broker sync, trade lifecycle, fanout, ack, pull, cron AI
- `web-ui/src/components/charts/SymbolChart.jsx` — toolbar buttons
- `web-ui/src/components/TradePlanEditor.jsx` — account dropdown
- `web-ui/src/pages/trades/TempTradesPage.jsx` — response page
- `web-ui/src/pages/trades/TradesPage.jsx` — build version, edit modal account
- `web-ui/src/pages/settings/ProfilePage.jsx` — username
- `web-ui/src/App.jsx` — AI menu, routes
- `web-ui/src/components/TradeFilesTab.jsx` — render loop fix
- `scripts/daemons/ctrader_downstream_server.js` — UTC timestamp fix
- `web-ui/vite.config.js` — proxy port fix

### Fixed this session (2026-05-30 15:30 UTC)
- `webhook/server.js` lines 10013-10040: Normalizer expanded (17 fields + catch-all)
- `webhook/server.js` line 10334: Fallback query `$25::boolean` → `$24::boolean`

### To verify
- Wait for cTrader sync cycle, check logs: `grep "sync-bool-field-NEW\|sync-item\|cannot cast type boolean" .local/webhook.stderr.log`
- If `sync-bool-field-NEW` appears → add field name to `numFields` Set in normalizer
- If no more `cannot cast type boolean to numeric` errors → sync is fully fixed ✅
- Then test: cancel trade on cTrader → should close in VPS
- Test: cancel trade with broker_trade_id in VPS → cBot should cancel on cTrader
