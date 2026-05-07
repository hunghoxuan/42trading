# Ticket: MT5 EA Parity Update (Sync-V2)

**Status**: IN_PROGRESS
**Assigned**: Antigravity
**Priority**: High

## Objective
Enhance the MT5 bridge (`TVBridgeEA.mq5`) synchronization logic to match the data density of the cTrader bridge. This ensures the dashboard has accurate margin, commission, and pending order data for MT5 accounts.

## Requirements

### 1. Detailed Position Sync
Update the position loop in `SyncV2` to include:
- [ ] `lots` (Standard lots)
- [ ] `volume` (Raw volume)
- [ ] `commission`
- [ ] `swap`
- [ ] `margin`
- [ ] `sl` (Current Stop Loss)
- [ ] `tp` (Current Take Profit)
- [ ] `pips` (PnL in pips)

### 2. Detailed Order Sync
Update the order loop in `SyncV2` to include:
- [ ] `lots`
- [ ] `volume`
- [ ] `target_price` (Entry price)
- [ ] `sl`
- [ ] `tp`

### 3. Account Metadata
Include the following in the root of the sync payload:
- [ ] `broker_name`
- [ ] `leverage`

### 4. Symbol Metrics Sync
Implement the `symbol_metrics` collection for active symbols:
- [ ] `pip_value`
- [ ] `spread`
- [ ] `min_vol`
- [ ] `step_vol`
- [ ] `pip_size`
- [ ] `digits`

## Implementation Plan
1.  Modify `SyncV2()` in `TVBridgeEA.mq5`.
2.  Add a helper function `CollectSymbolMetrics()` or integrate it into the existing loops.
3.  Ensure `IsoTime()` or raw timestamps are handled consistently.
4.  Verify JSON construction for MQL5 (manual string building).
