# Handoff — 2026-05-28

## Summary

Major broker sync overhaul. Two root causes fixed:

### 1. cTrader position sync was silently broken
- **Root cause**: cTrader sends positions as JSON **strings** in array, server expected objects
- **Fix**: `brokerSyncV2.pushItems` now JSON.parses string entries
- **Impact**: SL/TP/Volume/PnL changes from cTrader now actually sync to VPS

### 2. Periodic sync overwrote trade status
- **Root cause**: `brokerSyncV2` UPDATE unconditionally wrote `execution_status`, could re-open closed trades
- **Fix**: Forward-only guard — status can only advance (PENDING→FILLED→CLOSED), never backward
- **Secondary fix**: LEASED re-pick only for active statuses, not CLOSED/REJECTED

### 3. cTrader ack reliability
- **Root cause**: `_ = AckAsync()` fire-and-forget inside `BeginInvokeOnMainThread` — acks lost silently
- **Fix**: Added `SafeAck()` wrapper using `Task.Run` with error logging
- **Applied to**: CLOSE and CANCEL paths

### 4. CANCEL task infinite loop
- **Root cause**: Poll picked `PENDING_CANCEL` regardless of `dispatch_status`
- **Fix**: `PENDING_CANCEL/MOD/CLOSE` only polled when `dispatch_status = NEW`

### 5. CANCEL doesn't handle pending orders
- **Root cause**: CANCEL fallback only checked Positions, not PendingOrders (OID vs PID)
- **Fix**: Fallback now checks both Positions AND PendingOrders by comment/label

---

## Files Changed

| File | Key Changes |
|---|---|
| `webhook/server.js` | brokerSyncV2: JSON string parse, forward-only guard, LEASED filter, sl/tp in UPDATE |
| `webhook/server.js` | ackTradeV2: FAIL→REJECTED, EXPIRED→REJECTED mapping |
| `webhook/server.js` | pullLeasedTradesV2: auto-reject after 3 lease retries |
| `webhook/server.js` | listTradesV2: LEFT JOIN user_accounts for broker_name/provider_code |
| `webhook/server.js` | auth/me: default_provider_code from account metadata |
| `webhook/server.js` | resolveProviderCode() auto-maps "IC Markets EU Ltd" → "ICMARKETS" |
| `bridge-clients/TVBridge_CTrader.cs` | SafeAck helper, CANCEL PendingOrders fallback, ProviderCode param |
| `bridge-clients/TVBridgeEA.mq5` | risk_money_planned parsing, lots field, max_items, sid fallback |
| `web-ui/*` | Broker tab groups (identity/pnl/sizing), provider_code for TV iframe, Settings split into pages, Provider schema, slider logic, Watchlist fix |

---

## User MUST Do

**Recompile cTrader** — current build is `v2026.05.28 14:10 - 1f4f402a` (`bridge-clients/TVBridge_CTrader.cs`). Without recompile:
- CANCEL acks still lost (no SafeAck)
- OID orders can't be cancelled (no PendingOrders fallback)
- Position changes (SL/TP) won't sync (old params format)

**Restart local webhook** — kill PID on port 3001, run `node server.js` from `webhook/` directory.

---

## Remaining Issues

| Issue | Status |
|---|---|
| XAGGBP "Symbol not found" spam | Not fixed — remove from watchlist |
| cTrader BuildVersion not auto-bumped | Manual — needs process fix |
| Stuck LEASED trades (past) | Terminalized manually in DB |

---

## DB State (local)

- TFPFK6OJ1, TFI20028M → CANCELLED/CONSUMED
- TFPKOV6AS → CLOSED/CONSUMED
- TFDWREAMR, TFAT3RAZF → CANCELLED/CONSUMED
- TFJUC7VA5 → CLOSED/CONSUMED
