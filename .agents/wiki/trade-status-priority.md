# Trade Status Priority System

## Priority Order
```
NEW (0) < PENDING/PENDING_MOD (1) < PENDING_CLOSE/PENDING_CANCEL (2) < OPEN/FILLED (3) < CLOSED (5) < CANCELLED/REJECTED (6)
```

## Rule
When updating `execution_status` on any trade, if new status rank < current status rank → **skip**.

This prevents broker sync from overwriting `CANCELLED` back to `PENDING`.

## Enforced In
- Broker sync UPDATEs (EA bulk history + position updates)
- `updateTradeManualV2`
- `bulkActionTradesV2`
- Cancel endpoint

## SQL Guard
```sql
AND execution_status NOT IN ('CANCELLED', 'CLOSED', 'REJECTED')
-- OR more granular:
AND (CASE execution_status
  WHEN 'CANCELLED' THEN FALSE
  WHEN 'CLOSED' THEN $1::text NOT IN ('PENDING','PENDING_MOD','OPEN','FILLED')
  WHEN 'REJECTED' THEN $1::text NOT IN ('PENDING','PENDING_MOD','OPEN','FILLED','CLOSED')
  ELSE TRUE
END)
```
