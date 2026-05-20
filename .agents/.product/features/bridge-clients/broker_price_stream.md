# Broker Live Price Stream → VPS Market Data

Status: Done
Type: Feature / Core Data
Date: 2026-05-20

## Problem

Market data (`last_price`) on charts is only updated by the Twelve Data cron job (every few minutes). Between cron runs, the chart shows stale last-close prices. The broker bridge clients (cTrader + MQ5) already have access to real-time bid/ask for every symbol in Market Watch.

## Solution

Bridge clients push live bid/ask prices to VPS on a configurable timer. VPS updates `last_price`/`last_price_at` on only the latest bar row per symbol+TF (current open candle), patches the in-memory L1 cache, and async-flushes to Redis. At chart read time, `mergeLastPriceIntoBars()` overlays live price onto the last bar's close/high/low so the TradingView chart shows real-time candle movement.

## Key Design Decisions

- **Bars (`data` column) NEVER touched by price push** — Twelve Data cron owns OHLC
- **`last_price` targets only current candle** — `WHERE bar_end = MAX(bar_end) per symbol+TF`, completed candles preserved
- **New candle creation** — Twelve Data cron only (broker can't provide OHLC)
- **Chart live display** — `mergeLastPriceIntoBars()` at read time merges `last_price` → last bar's `close/high/low`
- **Prices read on main thread** — cTrader API not thread-safe, bid/ask collected in `OnTimer` before `Task.Run`
- **Logging unified** — all log events go through `b.log()` → `buildTraceBlock()` → TEXT in `content` column

---

## Endpoints

| Method | Path | Purpose |
|:---|:---|:---|
| `GET` | `/v2/broker/tracked-symbols?account=X` | Returns merged positions + watchlist symbols |
| `POST` | `/v2/broker/prices` | Receives `{ts, p:[{s,b,a},...]}`, updates market data |
| `GET` | `/v2/broker/prices/status` | Last push time + recent prices |

## DB Update (current candle only)

```sql
UPDATE market_data md
SET last_price = p.mid,
    last_price_at = to_timestamp(p.ts)::timestamptz,
    updated_at = NOW()
FROM (VALUES (...)) AS p(symbol, mid, ts)
WHERE md.symbol = p.symbol
  AND md.bar_end = (
    SELECT MAX(m2.bar_end) FROM market_data m2
    WHERE m2.symbol = p.symbol AND m2.tf = md.tf
  )
```

Correlated subquery ensures only the latest row per symbol+TF is updated. Completed candles preserved.

## Chart Read: mergeLastPriceIntoBars()

Before returning bars to TradingView chart, `last_price` is overlaid onto the last bar:
- Guard: only if `last_price_at >= last bar's time` (not stale)
- Updates: `close = last_price`, `high = max(high, lp)`, `low = min(low, lp)`
- Called from all 4 return paths in `buildAnalysisSnapshotFromTwelve`: memory, DB, Binance, Twelve Data

## Bridge Parameters

**cTrader:** `PricePushEnabled` (default true), `PricePushSeconds` (default 60), `SyncIntervalSeconds` (default 10)

**MQ5:** `InpPricePushEnabled` (default true), `InpPricePushSeconds` (default 60), `InpSyncSeconds` (default 10)

## Timer Split

```
OnTimer:
  ├─ PricePushSeconds:   PushPrices()      → POST /v2/broker/prices
  ├─ SyncSeconds:        SyncWithVps()     → POST /v2/broker/sync
  ├─ 5 min:              FetchSymbols()    → GET  /v2/broker/tracked-symbols
  └─ PollSeconds:        PollSignals()     → GET  /v2/broker/pull
```

Price push independent — doesn't block signal polling or sync.

## Verification

- [ ] cTrader log shows `[Price] First push OK: X symbols`
- [ ] DB: `SELECT symbol, tf, last_price, last_price_at FROM market_data WHERE last_price IS NOT NULL ORDER BY updated_at DESC LIMIT 5`
- [ ] `GET /v2/broker/prices/status` returns last push time + recent prices
- [ ] `logs` table has `PRICE_PUSH` events
- [ ] Chart shows live candle movement (last bar close updates with broker price)
- [ ] Completed candles' `last_price` unchanged (not overwritten by new pushes)
