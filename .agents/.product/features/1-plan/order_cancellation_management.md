# Order Cancellation Management (Pre-Entry Guard)

**Status**: Plan  
**Date**: 2026-05-17  
**Author**: Codex

## Problem

When brokers place pending orders (limit/stop), the order sits in the market waiting for entry price to be hit. During this waiting period, price may move past TP or SL levels before the entry is ever reached. The pending order becomes "stale" — the setup it was based on is no longer valid, but the order remains active and could execute later at a bad time.

### Example Scenarios

| Order Type | Entry | SL | TP | Invalidated When |
|------------|-------|----|----|------------------|
| Limit Buy | 1.1640 (below market) | 1.1670 | 1.1600 | Price rises to 1.1670 (SL hit before entry) or drops to 1.1600 (TP hit before entry) |
| Limit Sell | 1.1700 (above market) | 1.1670 | 1.1750 | Price drops to 1.1670 (SL before entry) or rises to 1.1750 (TP before entry) |
| Stop Buy | 1.1720 (above market) | 1.1690 | 1.1780 | Price drops to 1.1690 (SL before entry) or rises to 1.1780 (TP before entry) |
| Stop Sell | 1.1620 (below market) | 1.1650 | 1.1550 | Price rises to 1.1650 (SL before entry) or drops to 1.1550 (TP before entry) |

### Current Behavior

- Orders are placed and left open indefinitely
- No monitoring of price relative to TP/SL before entry
- If price blows past SL before entry, the order still executes later at a losing position
- User must manually cancel stale orders

### Desired Behavior

- After placing a pending order, monitor current price
- If price reaches TP level before entry is met → cancel order (setup missed, opportunity gone)
- If price reaches SL level before entry is met → cancel order (setup invalidated, would be instant loss)
- Cancel should happen automatically on the broker side (EA/cBot)
- Server should be notified via ACK with status `CANCELLED` and reason `sl_hit_before_entry` or `tp_hit_before_entry`

## Solution Design

### Flow

```
1. Server → POLL → Bridge receives task with entry/SL/TP
2. Bridge places pending order (limit/stop)
3. Bridge starts monitoring current price vs entry/SL/TP
4. On each tick/timer:
   a. If price crosses SL (in the wrong direction before entry) → cancel order → ACK "CANCELLED" sl_hit_before_entry
   b. If price crosses TP (in the target direction before entry) → cancel order → ACK "CANCELLED" tp_hit_before_entry
   c. If price reaches entry → order fills → normal flow
5. Server receives ACK, updates trade status, logs event
```

### Logic Per Order Type

```
LIMIT BUY  (entry < current):  bid <= sl  → cancel (sl_hit_before_entry)
                                ask >= tp  → cancel (tp_hit_before_entry)
                                ask <= entry → fill (normal)

LIMIT SELL (entry > current):  ask >= sl  → cancel (sl_hit_before_entry)
                                bid <= tp  → cancel (tp_hit_before_entry)
                                bid >= entry → fill (normal)

STOP BUY   (entry > current):  bid <= sl  → cancel (sl_hit_before_entry)
                                ask >= tp  → cancel (tp_hit_before_entry)
                                ask >= entry → fill (normal)

STOP SELL  (entry < current):  ask >= sl  → cancel (sl_hit_before_entry)
                                bid <= tp  → cancel (tp_hit_before_entry)
                                bid <= entry → fill (normal)
```

### Implementation Plan

#### cTrader (TVBridge_CTrader.cs)

1. Add `PendingOrderGuard` class to track:
   - `orderId` / `ticket`
   - `sid`
   - `entry`, `sl`, `tp`
   - `orderType` (limit/stop)
   - `action` (BUY/SELL)

2. In `ExecuteSignal`: after placing limit/stop order, register in `_pendingOrders` dictionary

3. In `OnTimer` / `ManagePositions`: iterate `_pendingOrders`, check current bid/ask vs SL/TP

4. If cancellation condition met:
   - Cancel the order via `CancelPendingOrder(orderId)`
   - Remove from `_pendingOrders`
   - Send ACK with status `CANCELLED`, error `sl_hit_before_entry` or `tp_hit_before_entry`

5. If order fills naturally, remove from `_pendingOrders`

#### MT5 EA (TVBridgeEA.mq5)

1. Add `SPendingOrder` struct + `g_pendingOrders[]` array
2. After `OrderSend` for limit/stop, register in `g_pendingOrders`
3. In `OnTimer`, iterate and check prices
4. If cancellation needed: `OrderDelete(ticket)`, send ACK
5. On fill detection (via `OnTrade` or position tracking), remove from pending

### ACK Payload

```json
{
  "trade_id": "TFxxx",
  "status": "CANCELLED",
  "ticket": "123456",
  "error": "sl_hit_before_entry",
  "note": "SL 1.1670 hit before entry 1.1640 reached"
}
```

### Server Changes (Optional)

- Handle `sl_hit_before_entry` / `tp_hit_before_entry` cancellation reasons in ACK handler
- Update trade status to `CANCELLED` with appropriate reason
- Log event for audit trail

## Edge Cases

| Case | Behavior |
|------|----------|
| SL=0 or not set | Skip SL guard, only monitor TP |
| TP=0 or not set | Skip TP guard, only monitor SL |
| Market order (not limit/stop) | No guard needed — fills immediately |
| Order fills before guard triggers | Remove from pending, normal flow |
| Connection lost | Pending orders remain on broker; guard resumes on reconnect |
| Partial fill then price reverses | Already filled — guard stops monitoring |

## Open Questions

1. Should TP-hit-before-entry always cancel, or only for limit orders? (For stop orders, price passing through TP in the wrong direction means the breakout failed — should cancel)
2. Should we add a configurable buffer (e.g., SL + 2 pips) before cancelling?
3. Should the user be able to disable this per-trade?
4. Should the cancellation use a market-close or just delete the pending order?

## Recommendation

- Always cancel for both SL and TP breach before entry (conservative approach)
- No buffer — cancel at exact level
- Always enabled (no per-trade toggle needed for v1)
- Delete pending order (no market close needed since position doesn't exist yet)
