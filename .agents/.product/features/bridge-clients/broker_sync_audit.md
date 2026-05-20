# Broker Sync Audit: Change Detection & Sync Completeness

Status: Audit
Type: Core Reliability / Sync Integrity
Date: 2026-05-19

## Scope

Full audit of both bridge clients (cTrader + MQ5) and the VPS sync handler (`server.js` `brokerSyncV2`) covering **what broker-side changes are detected, synced to VPS, and logged** across these dimensions:

1. **SL changed** (trailing stop, break-even, manual)
2. **TP changed** (manual modification)
3. **Status changed** (OPEN → CLOSED, CLOSED → OPEN, etc.)
4. **PnL changed** (floating PnL, realized PnL)
5. **Partial closed** (partial TP fills, manual partial closes)
6. **Volume changed** (partial fills reducing position size)
7. **Commission/Swap changed**
8. **Order filled** (pending → live position)

---

## 1. cTrader Bridge (`TVBridge_CTrader.cs`)

### 1.1 Real-Time Events (Per-Tick via `ManagePositions`)

| Change Type | Detected? | Synced to VPS? | Ack Event? |
|:---|:---|:---|:---|
| **SL changed (BE)** | ✅ Yes — `ModifyPosition(pos, targetSL, pos.TakeProfit)` | ❌ **No** — only on next `SyncWithVpsAsync` cycle | ❌ No dedicated ack |
| **SL changed (Trail)** | ✅ Yes — `ModifyPosition(pos, targetSL, pos.TakeProfit)` | ❌ **No** — only on next `SyncWithVpsAsync` cycle | ❌ No dedicated ack |
| **Partial TP hit** | ✅ Yes — `ClosePosition(pos, volToClose)` | ❌ **No** — partial close status not explicitly flagged | ❌ No dedicated ack |
| **TP hit (full)** | N/A — broker auto-closes | ✅ On next sync via closed deals history | ❌ Not ack'd |

**Gap:** SL modifications (BE + Trail) change the broker-side SL **immediately** but the VPS only learns about it on the next poll cycle (default 2s). During market volatility, this could be 2s of stale SL data in the dashboard.

**Code locations:**
- BE SL move: `TVBridge_CTrader.cs` L148-165 (`ManagePositions`)
- Trail SL move: L169-193 (`ManagePositions`)
- Partial close: L197-248 (`ManagePositions`)

### 1.2 Periodic Sync (`OnTimer` → `SyncWithVpsAsync` every PollSeconds)

| Change Type | Included in Sync Payload? | Field(s) |
|:---|:---|:---|
| Current SL | ✅ | `sl` (from `pos.StopLoss`) |
| Current TP | ✅ | `tp` (from `pos.TakeProfit`) |
| Floating PnL | ✅ | `pnl` (from `pos.NetProfit`) |
| Pips | ✅ | `pips` (from `pos.Pips`) |
| Commission | ✅ | `commission` (from `pos.Commissions`) |
| Swap | ✅ | `swap` (from `pos.Swap`) |
| Margin | ✅ | `margin` (from `pos.Margin`) |
| Volume | ✅ | `volume` (from `pos.VolumeInUnits`) |
| TP PnL (projected) | ✅ | `tp_pnl` (calculated) |
| SL PnL (projected) | ✅ | `sl_pnl` (calculated) |
| Status | ✅ | hardcoded `"OPEN"` for all active positions |
| Closed deals | ✅ | `closedList` — last 2 days, max 20, with `status=CLOSED` |
| Pending orders | ✅ | `ordersList` — with `status=PENDING` |

**Partial Close Detection:**
- cTrader does NOT include `remaining_volume` or `closed_volume_partial` in position payload
- No `has_partial` flag in position JSON
- Volume is sent as current volume (after partial close reduces it), so the VPS can infer a volume change, but there's no explicit "this is a partial close" signal

**Code location:** `TVBridge_CTrader.cs` L256-459 (`OnTimer`)

### 1.3 VPS Handling of cTrader Sync

The VPS `brokerSyncV2` handler processes cTrader positions identically to MQ5 positions. Key behaviors:

- **SL updates:** `sl = COALESCE($23::numeric, sl)` — updates SL unconditionally if a non-null value is received
- **TP updates:** `tp = COALESCE($24::numeric, tp)` — updates TP unconditionally
- **PnL updates:** `broker_pnl = $2::numeric` — always updates
- **Status:** Position status `"OPEN"` maps to `execution_status = "OPEN"`
- **has_partial:** Not captured because cTrader doesn't send `remaining_volume` or `closed_volume_partial`
- **Logging:** Each matched trade logs `TRADE_SYNC_UPDATE` with `status_raw`, `execution_status`, `pnl`, `pips`, `lots`, `commission`, `swap`, `volume`, `margin`, `tp_pnl`, `sl_pnl`

**Code location:** `server.js` L8093-9136 (`brokerSyncV2`)

---

## 2. MQ5 Bridge (`TVBridgeEA.mq5`)

### 2.1 Real-Time Events (`OnTradeTransaction`)

| Transaction Type | Detected? | Ack Sent? | Ack Status |
|:---|:---|:---|:---|
| `TRADE_TRANSACTION_ORDER_ADD` | ✅ | ✅ | `"PLACED"` |
| `TRADE_TRANSACTION_ORDER_DELETE` | ✅ | ✅ | `"CANCEL"` or `"EXPIRED"` |
| `TRADE_TRANSACTION_DEAL_ADD` (IN) | ✅ | ✅ | `"START"` |
| `TRADE_TRANSACTION_DEAL_ADD` (OUT/OUT_BY) | ✅ (full close only) | ✅ | `"TP"` / `"SL"` / `"CANCEL"` / `"FAIL"` |
| **`TRADE_TRANSACTION_POSITION`** | ❌ **NOT HANDLED** | ❌ | — |
| **Partial close (OUT/OUT_BY while position still exists)** | ❌ **EXPLICITLY IGNORED** | ❌ | — |

**Critical Gap 1 — `TRADE_TRANSACTION_POSITION` not handled:**
When the broker modifies SL/TP on an existing position (e.g., trailing stop from another EA, manual SL edit, or the EA's own `PositionModify` from `ProcessStopRetryQueue`), MT5 fires `TRADE_TRANSACTION_POSITION` with `POSITION_SL` / `POSITION_TP`. The EA does NOT listen for this event. This means:
- Manual SL edits in the terminal are never ack'd
- Retry-based `PositionModify` SL changes are never individually ack'd
- Only the periodic 60s sync captures the updated SL/TP

**Code location:** `TVBridgeEA.mq5` L3132-3298 (`OnTradeTransaction`)

**Critical Gap 2 — Partial closes ignored:**
```cpp
// Ignore partial closes: wait until position is fully gone.
if(positionTicket > 0 && PositionSelectByTicket(positionTicket))
    return;
```
This means partial TP fills generate NO ack event. The VPS only learns about partial closes:
1. On the 60s sync if the SL/TP/volume changed
2. When the position is fully closed (final OUT deal)

**Code location:** `TVBridgeEA.mq5` L3268-3272

### 2.2 Virtual Guard Closes (`ProcessVirtualGuards`)

| Event | Ack Sent? | Ack Status |
|:---|:---|:---|
| Virtual SL hit | ✅ | `"SL"` |
| Virtual TP hit | ✅ | `"TP"` |
| Virtual timeout | ✅ | `"CANCEL"` |

Virtual guards also modify `g_vgSl[i]` for BE and trailing. These SL changes are **virtual-only** (tracked in `g_vgSl[]` arrays) and do NOT modify the broker-side SL. They are used only for exit decisions, not broker SL orders.

**Gap:** When a virtual BE/trail updates `g_vgSl`, there's no sync/ack to VPS because the broker SL hasn't actually changed. The dashboard cannot see the virtual trailing SL level.

### 2.3 Periodic Sync (`OnTimer` → `SyncWithVps` every 60s)

| Change Type | Included in Sync Payload? | Field(s) |
|:---|:---|:---|
| Current SL | ✅ | `sl` (from `POSITION_SL`) |
| Current TP | ✅ | `tp` (from `POSITION_TP`) |
| Floating PnL | ✅ | `pnl` (from `POSITION_PROFIT`) |
| Pips | ✅ | `pips` (calculated from price distance) |
| Commission | ✅ | `commission` (from `POSITION_COMMISSION`) |
| Swap | ✅ | `swap` (from `POSITION_SWAP`) |
| Volume | ✅ | `volume` / `lots` (from `POSITION_VOLUME`) |
| Entry | ✅ | `entry` (from `POSITION_PRICE_OPEN`) |
| Opened At | ✅ | `opened_at` (from `POSITION_TIME`) |
| Closed deals | ✅ | `closedUpdates` — since `g_lastClosedDealSyncTime` |
| Pending orders | ✅ | `ordUpdates` — SL, TP, volume, margin, pnl_tp, pnl_sl |

**State Hash Dedup:**
```cpp
string stateHash = posUpdates + "|" + ordUpdates + "|" + closedUpdates;
if(stateHash == g_lastStateHash) {
    g_lastSyncSummary = "SKIP stable (no changes)";
    return;  // Skip webhook entirely
}
```
This correctly captures SL/TP/volume/entry changes (they're in the JSON), but note that closed deals are ONLY included since `g_lastClosedDealSyncTime` — if a deal's close time is ≤ that timestamp, it won't be re-sent even if the hash changed.

**Code location:** `TVBridgeEA.mq5` L3300-3581 (`SyncWithVps`)

### 2.4 Ack Queue (`Ack` + `ProcessAckQueue`)

Each `Ack()` call queues a JSON payload with extensive telemetry:
- `requested_volume`, `used_volume`
- `requested_sl`, `requested_tp` ← planned SL/TP at signal time
- `used_sl`, `used_tp` ← actual SL/TP set on broker
- `entry_price_exec`
- `margin_req`, `margin_budget`, `free_margin`, `balance`, `equity`
- `pip_value_per_lot`, `sl_pips`, `tp_pips`
- `risk_money_actual`, `reward_money_planned`
- `pnl_money_realized` (only on close)

**Gap:** The ack includes `used_sl`/`used_tp` which are set once at execution time in `ExecuteSignal`. When SL is later modified by BE/trail/retry, `g_ackUsedSl`/`g_ackUsedTp` are NOT updated, so subsequent acks carry stale SL/TP values.

---

## 3. VPS Sync Handler (`server.js` `brokerSyncV2`)

### 3.1 What Gets Updated in DB Per Sync Item

| Field | Update Logic | Triggered By |
|:---|:---|:---|
| `execution_status` | Status machine (OPEN↔CLOSED↔PENDING) | Broker status field |
| `pnl_realized` | Only if CLOSED/CANCELLED/TP/SL or `has_partial=true` | PnL field |
| `broker_pnl` | Always | PnL field |
| `volume` | `COALESCE($7::numeric, volume)` | Volume field |
| `broker_pips` | Always | Pips field |
| `broker_lots` | Always | Lots field |
| `broker_commission` | Always | Commission field |
| `broker_swap` | Always | Swap field |
| `broker_volume` | Always | Volume field |
| `broker_margin` | Always | Margin field |
| `broker_tp_pnl` | Always | tp_pnl / pnl_tp field |
| `broker_sl_pnl` | Always | sl_pnl / pnl_sl field |
| `entry` / `entry_exec` | `COALESCE($22::numeric, entry)` | Entry field |
| **`sl`** | `COALESCE($23::numeric, sl)` | SL field |
| **`tp`** | `COALESCE($24::numeric, tp)` | TP field |
| `tp1`, `tp2`, `tp3` | `COALESCE` | tp1/tp2/tp3 fields |
| `note` | `COALESCE(NULLIF($25::text, ''), note)` | Broker comment |
| `order_type` | `COALESCE($12::text, order_type)` | type field |
| `close_reason` | Only if CLOSED/CANCELLED/TP/SL | reason field |
| `broker_trade_id` | `COALESCE(NULLIF($9::text, ''), broker_trade_id)` | ticket |
| `metadata` | Merged with syncMeta (full broker_data) | Full item payload |
| `opened_at` | `COALESCE($5::timestamptz, opened_at)` | opened_at field |
| `closed_at` | Conditional on CLOSED status | closed_at / NOW() |
| `has_partial` | Stored in `metadata` via syncMeta | remaining_volume / closed_volume_partial |

**Critical observation:** SL and TP use `COALESCE` — meaning they only update if the broker sends a non-null value. If the bridge client sends `sl: 0` (for no-SL positions), it will NOT overwrite a previously valid SL. This is good.

### 3.2 Logging Per Sync

Each matched/synced trade logs a `TRADE_SYNC_UPDATE` event via `mt5Log`:

```js
{
  event: "TRADE_SYNC_UPDATE",
  status_raw: it.status_raw,
  execution_status: it.execution_status,
  ticket: it.ticket || null,
  signal_id: it.sid || null,
  pnl: it.pnl,
  pips: it.pips,
  lots: it.lots,
  commission: it.commission,
  swap: it.swap,
  volume: it.volume,
  margin: it.margin,
  tp_pnl: it.tp_pnl,
  sl_pnl: it.sl_pnl,
}
```

**Not logged in TRADE_SYNC_UPDATE:**
- `sl` / `tp` — the old and new SL/TP values are NOT in the log
- `entry` — not logged
- `has_partial` — not logged
- `close_reason` — not logged

Snapshot-based closures log `TRADE_SYNC_CLOSE`:
```js
{
  event: "TRADE_SYNC_CLOSE",
  ticket: row?.broker_trade_id || null,
  execution_status: row?.execution_status || null,
  close_reason: row?.close_reason || null,
  pnl_inferred: Number.isFinite(resolvedPnl) ? resolvedPnl : null,
}
```

### 3.3 Manual Sync Endpoint (`/v2/broker/sync`)

The VPS also has a manual/manual sync endpoint at L22493 that accepts direct status/PnL updates with `last_sync_source` metadata. This is the same structure used by the EA's ack endpoint.

### 3.4 SSE Notifications

When `tradeUpdates` are detected (status changes only), the VPS emits a `BROKER_SYNC` notification via SSE with:
- Changed symbols summary
- Count of matched updates
- `need_refresh: false`, `comp_refresh: matched > 0`

**Gap:** Only status changes trigger SSE. SL/TP/PnL/volume changes without status changes are silent in the UI.

---

## 4. Gap Summary

### 4.1 SL Changes

| Bridge | Real-Time Detection | Immediate Ack to VPS | Periodic Sync | Logged with old→new diff |
|:---|:---|:---|:---|:---|
| cTrader | ✅ (BE/Trail via `ModifyPosition`) | ❌ | ✅ (2s cycle) | ❌ |
| MQ5 | ❌ (`OnTradeTransaction` missing `TRADE_TRANSACTION_POSITION`) | ❌ | ✅ (60s cycle) | ❌ |

**Risk:** Dashboard SL display can be stale for up to 2s (cTrader) or 60s (MQ5) after a trailing stop adjustment.

### 4.2 Partial Closes

| Bridge | Detection | Ack to VPS | Volume Remaining Sent | `has_partial` Flag |
|:---|:---|:---|:---|:---|
| cTrader | ✅ (executes partial close) | ❌ | ❌ (only current volume sent) | ❌ |
| MQ5 | ❌ (explicitly skipped in `OnTradeTransaction`) | ❌ | ❌ (only current volume sent) | ❌ |

**Risk:** VPS has no way to distinguish "position reduced from 0.10 to 0.07 via partial TP" vs "position was always 0.07 lots". Trade history in dashboard loses partial TP granularity.

### 4.3 TP Changes

| Bridge | Detection | Ack to VPS | Synced |
|:---|:---|:---|:---|
| cTrader | ❌ (no manual TP change tracking) | ❌ | ✅ (periodic sync) |
| MQ5 | ❌ (`TRADE_TRANSACTION_POSITION` not handled) | ❌ | ✅ (periodic sync) |

### 4.4 PnL Changes (Floating)

| Bridge | Detection | Ack | Synced |
|:---|:---|:---|:---|
| cTrader | N/A (always sent in periodic sync) | — | ✅ (2s cycle) |
| MQ5 | N/A (always sent in periodic sync) | — | ✅ (60s cycle) |

No gap — floating PnL is always current in sync payloads.

### 4.5 Status Changes

| Bridge | Detection | Ack | Synced |
|:---|:---|:---|:---|
| cTrader | ✅ (closed via history scan) | ❌ (no dedicated ack) | ✅ (periodic sync + closed list) |
| MQ5 | ✅ (`OnTradeTransaction` DEAL_ADD OUT) | ✅ (TP/SL/CANCEL/FAIL) | ✅ (periodic sync + closed list) |

Status changes are well-covered. MQ5 has the edge with real-time acks on deal events.

### 4.6 Commission/Swap

Both bridges send commission and swap in every sync cycle. No gaps.

---

## 5. Recommendations

### Priority 1 — SL Change Sync (Both Bridges)

**cTrader:**
- After `ModifyPosition` succeeds in BE/Trail, fire a lightweight `AckAsync("SL_CHANGED", ...)` to the VPS with the new SL value
- OR: reduce poll interval when SL was recently modified (adaptive sync)

**MQ5:**
- Handle `TRADE_TRANSACTION_POSITION` in `OnTradeTransaction` — when `POSITION_SL` or `POSITION_TP` changes, send an `Ack(signalId, "SL_CHANGED", ticket, ...)` with old/new values
- Update `g_ackUsedSl`/`g_ackUsedTp` after any SL/TP modification (including retries from `ProcessStopRetryQueue`)

### Priority 2 — Partial Close Tracking

**cTrader:**
- After `ClosePosition` in partial TP handler, send `AckAsync("PARTIAL_CLOSE", ...)` with closed volume and remaining volume
- Include `remaining_volume` and `closed_volume_partial` in position sync payload

**MQ5:**
- Remove the `PositionSelectByTicket` early-return for partial closes
- Instead, track partial closes: send `Ack(signalId, "PARTIAL_CLOSE", ticket, ...)` with realized PnL from the deal
- Include `remaining_volume` in position sync payload

### Priority 3 — Enhanced Logging

**VPS `brokerSyncV2`:**
- Include `sl_before`/`sl_after`, `tp_before`/`tp_after` diffs in `TRADE_SYNC_UPDATE` logs
- Add `has_partial` to log payload
- Log `SL_CHANGED` and `PARTIAL_CLOSE` as distinct event types in `mt5Log`

### Priority 4 — SSE for Non-Status Changes

- Emit SSE notifications when SL/TP/volume changes are detected (not just status changes)
- This would allow the dashboard to show real-time SL/TP updates from trailing stops

---

## 6. Verification Checklist

- [ ] cTrader: trailing stop SL change appears in dashboard within 1 sync cycle
- [ ] MQ5: `PositionModify` from retry queue correctly updates `g_ackUsedSl`/`g_ackUsedTp`
- [ ] MQ5: `TRADE_TRANSACTION_POSITION` fires ack on manual SL edit
- [ ] cTrader: partial TP close sends remaining volume to VPS
- [ ] MQ5: partial close deals generate `PARTIAL_CLOSE` ack instead of being ignored
- [ ] VPS logs show `sl_before`→`sl_after` diffs in sync update events
- [ ] SSE pushes SL/TP updates to UI without requiring page refresh

---

## 7. Technical Context

- **cTrader Bridge**: `/trading/bridge-clients/TVBridge_CTrader.cs`
  - `ManagePositions()` L127-254
  - `OnTimer()` L256-459
  - `SyncWithVpsAsync()` L1018-1071
- **MQ5 Bridge**: `/trading/bridge-clients/TVBridgeEA.mq5`
  - `OnTradeTransaction()` L3132-3298
  - `SyncWithVps()` L3300-3581
  - `Ack()` L1873-1978
  - `ProcessVirtualGuards()` L944-1060
- **VPS Sync Handler**: `/trading/webhook/server.js`
  - `brokerSyncV2()` L8093-9136
  - `mt5Log()` L887-930
  - Manual sync endpoint: L22493
  - Ack endpoint handler: L22711 (`mt5EaAck`)
