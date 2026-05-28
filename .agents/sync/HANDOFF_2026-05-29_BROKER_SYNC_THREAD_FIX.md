# Handoff — 2026-05-29: Broker Sync Overhaul + cTrader Thread Fix

## Summary

Major session spanning broker sync correctness, dispatch/execution separation, cTrader bridge crash fix, and UI improvements.

### 1. cTrader Bridge Thread Crash Fix
- **Root cause**: cTrader platform update made `OnTimer()` API access crash on Timer thread
- **Fix**: `OnTimer()` → stub (just timestamps). `DoTimerWork()` (original body) called from `OnTick()` (guaranteed main thread). Removed `Task.Run` for `FetchTrackedSymbolsAsync`/`PushBarsAsync` (now run on main thread)
- **Build**: `v2026.05.29 00:30 - tick-main-thread`

### 2. dispatch_status Refactor
- **Goal**: Separate trade state from sync action
- **Before**: `execution_status` carried both (PENDING_MOD, PENDING_CLOSE, PENDING_CANCEL)
- **After**: `execution_status` = pure trade state (PENDING/FILLED/CLOSED). `dispatch_status` = sync action (OPEN/MODIFY/CLOSE/CANCEL/LEASED/CONSUMED/REJECTED)
- **Impact**: Trade always shows correct state regardless of sync status

### 3. Broker Sync Hardening
- Auto-reject sets `dispatch_status='REJECTED'` (not `execution_status`). Broker errors keep `execution_status` unchanged
- Snapshot hash cleared on REJECTED to force next broker sync convergence
- `ackTradeV2`: ERROR/FAIL → keeps `execution_status`, only updates `dispatch_status`
- `brokerLinkedManualStatus` returns `{execution_status, dispatch_status}` object
- Pull filter simplified: `dispatch_status IN ('OPEN','MODIFY','CLOSE','CANCEL')`
- `mt5CloseReasonFromSync`: when status=CLOSED, prioritizes `close_reason` field
- `brokerSnapshotFingerprint/Hash` prevents re-application of identical snapshots

### 4. Price Push Endpoint
- Added `POST /v2/broker/prices` handler (was missing, bridge got 404)
- Route uses regex pattern `/^\/(webhook\/)?v2\/broker\/prices$/` for `/webhook/` prefix

### 5. Data Directory Migration
- `trade_files`, `trade_active`, `trade_closed`, `market_data` moved from `webhook/` to `../data/`
- `.gitignore` updated with `data/`
- Old `webhook/` directories deleted

### 6. UI Broker Tab + Sync Status
- `AiTradeDetailCard`: full broker tab matching `TradesPage` (identity, pnl, sizing groups)
- `SignalDetailCard.PlanHeader`: sync status icons (⏳🔄❌) with dispatch-based broker ticket border color
- `V2TradeDetailPage`: entry shows `entry_price_exec`, dispatch icon in header
- `extractTradePlanFromTrade`: `trade.entry_price_exec` and `trade.tp1/tp2/tp3` take priority over stale plan values

### 7. cTrader Bridge Features
- `close_reason` field in closed deal JSON (MANUAL_CLOSE)
- `spread`, `distance_sl/tp`, `balance_sl/tp` broker metadata in position JSON
- `SafeAck` for MODIFY in `ExecuteSignal` (was fire-and-forget `AckAsync`)
- `TRADE_PLAN_SAVED`: `dispatch_status='MODIFY'` for PENDING orders too (was FILLED only)

### 8. Safety Rule
- Added to `.agents/rules/safety.md`: NEVER use `git checkout` or `git revert` without explicit permission

---

## Files Changed

| File | Key Changes |
|---|---|
| `bridge-clients/TVBridge_CTrader.cs` | OnTimer stub, DoTimerWork via OnTick, SafeAck MODIFY, close_reason, broker metadata, SID fallback, BuildVersion |
| `webhook/server.js` | dispatch_status refactor, ackTradeV2 ERROR handling, auto-reject REJECTED fix, brokerLinkedManualStatus, price endpoint, data dirs, mt5MapDbRow dispatch_status/rejection_reason |
| `webhook/syncGuards.js` | brokerLinkedManualStatus returns object, brokerTaskTypeForTrade reads dispatch_status, brokerSnapshotHash |
| `scripts/test/syncGuards.test.mjs` | Updated for new API |
| `scripts/start/start_webhook.sh` | New — webhook-only launchd launcher |
| `scripts/start/start_vite.sh` | New — vite launchd launcher |
| `scripts/install/com.trading.webhook.local.plist` | New — launchd plist for webhook auto-restart |
| `.agents/rules/safety.md` | Added git checkout/revert rule |
| `.gitignore` | Added `data/` |
| `web-ui/src/components/AiTradeDetailCard.jsx` | Broker tab with dispatch/entry_price_exec |
| `web-ui/src/components/SignalDetailCard.jsx` | Sync status icons, broker ticket border color |
| `web-ui/src/pages/trades/V2TradeDetailPage.jsx` | entry_price_exec, dispatch icon |
| `web-ui/src/utils/signalDetailUtils.jsx` | entry_price_exec/tp1/tp2/tp3 priority |

---

## Build Version

`v2026.05.29 00:30 - tick-main-thread`

---

## Deploy Status

- **cTrader**: NOT_DEPLOYED — must recompile `TVBridge_CTrader.cs`
- **Webhook**: Running via launchd (`com.trading.webhook.local`, port 3001)
- **Web-UI**: Running via launchd (`com.trading.webui.local`, port 3000)

---

## What's Working

| Feature | Status |
|---|---|
| cTrader sync (positions/orders/closed) | ✅ |
| Broker metadata in sync | ✅ |
| Price push endpoint | ✅ |
| SID fallback for pending orders | ✅ |
| SafeAck for MODIFY | ✅ |
| close_reason in closed deals | ✅ |
| dispatch_status separation | ✅ |
| Broker tab in UI (both /trades and /ai/trade) | ✅ |
| Auto-restart via launchd | ✅ |

## Remaining

- `trailing_stop` field removed (cTrader API `pos.TrailingStop` not available)
- `entry` column no longer synced from broker (only `entry_exec`) — correct by design
