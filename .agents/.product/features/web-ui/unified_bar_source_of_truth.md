# Unified Bar Source of Truth

**Status**: Done
**Created**: 2026-05-23

## Problem

OHLC bars arrive from three sources at different times with overlapping ranges:

| Source | Trigger | Format |
|--------|---------|--------|
| Broker EA push | Every candle close | `POST /v2/broker/bars` |
| Twelve Data cron | Every 60s | Cron job |
| Twelve Data manual | User clicks refresh | API call |

Each wrote to different stores (DB, Redis, memory) independently. No single canonical source. Overlapping bars caused duplicates. Out-of-order arrivals broke time-series ordering.

## Solution

Single merge function `mergeBarsIntoCSV(symbol, tf, newBars)` that ALL three sources call.

```
Broker push ──┐
Cron fetch ───┼──→ mergeBarsIntoCSV() ──→ CSV (canonical)
Manual pull ──┘                            │
                                    ┌──────┴──────┐
                                    ▼             ▼
                                L1 Memory     Redis L2
```

## Algorithm

```
1. Read existing CSV → Map<time, csv_line>
2. For each new bar: if time not in Map → Map.set(time, line)
3. Sort entries by time ascending
4. Rewrite CSV (header + sorted lines)
5. Build bar objects → update L1 cache + async Redis L2
```

**Guarantees**: sorted by time, no duplicates, late arrivals slot correctly, max 1000 bars in cache.

## Files

- `webhook/server.js` — `mergeBarsIntoCSV()`, updated `/v2/broker/bars`, `marketDataDbWrite`
