# Order Cancellation Management (Pre-Entry Guard)

- **Status**: Backlog
- **Feature Doc**: [../../features/1-plan/order_cancellation_management.md]
- **Priority**: Medium
- **Scope**: Both bridges (cTrader + MT5 EA)

## Summary

Cancel pending orders when price reaches TP or SL before entry is met.

## Tasks

### 1. cTrader Bridge
- [ ] Add `PendingOrderGuard` class with `orderId, sid, entry, sl, tp, orderType, action`
- [ ] Register pending orders in `_pendingOrders` dict after `ExecuteSignal`
- [ ] On each `OnTimer` tick: check bid/ask vs SL/TP for each pending order
- [ ] Cancel order + ACK with `sl_hit_before_entry` or `tp_hit_before_entry`
- [ ] Remove from `_pendingOrders` on fill or cancel

### 2. MT5 EA Bridge
- [ ] Add `SPendingOrder` struct + `g_pendingOrders[]` array
- [ ] Register pending orders after `OrderSend` for limit/stop types
- [ ] On each `OnTimer` tick: check prices vs SL/TP
- [ ] `OrderDelete(ticket)` + ACK with cancellation reason
- [ ] Remove from pending on fill detection

### 3. Server (optional)
- [ ] Handle `sl_hit_before_entry` / `tp_hit_before_entry` in ACK handler
- [ ] Update trade status to CANCELLED with reason
- [ ] Log event

## Acceptance Criteria
- [ ] Limit buy order cancelled when bid ≤ SL before entry reached
- [ ] Limit buy order cancelled when ask ≥ TP before entry reached
- [ ] Stop sell order cancelled when ask ≥ SL before entry reached
- [ ] Stop sell order cancelled when bid ≤ TP before entry reached
- [ ] Normal fills unaffected
- [ ] Market orders unaffected (skip guard)
- [ ] ACK sent with correct cancellation reason
- [ ] No memory leaks (orders cleaned up on fill/cancel/restart)
