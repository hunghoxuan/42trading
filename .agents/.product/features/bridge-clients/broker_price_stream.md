# Broker Live Price Stream → VPS Market Data

Status: Design
Type: Feature / Core Data
Date: 2026-05-20

## Problem

Market data (`last_price`) on charts is only updated by the Twelve Data cron job (every few minutes). Between cron runs, the chart shows stale last-close prices. The broker bridge clients (cTrader + MQ5) already have access to real-time bid/ask for every symbol in Market Watch — but they only send PnL/position sync data, not raw prices.

## Solution

Bridge clients push live bid/ask prices to VPS on a configurable timer. VPS updates `last_price`/`last_price_at` on all timeframes for each symbol in a single DB query, patches the in-memory L1 cache, and async-flushes to Redis. SSE notifies the UI.

---

## 1. Symbol Tracking Strategy

Three sources merged, no TF in payload:

| Priority | Source | Mechanism |
|:---|:---|:---|
| 1 (always) | Active positions + pending orders | Bridge auto-collects symbols from open trades |
| 2 (config) | `users.metadata.watchlist` | JSONB array on users table, cached in `USR:WTL:{uid}` |
| 3 (chart) | Current chart symbol | Bridge's attached chart instrument |

**Delivery:** `GET /v2/broker/tracked-symbols?account=X`

Bridge calls this on startup + every 5 minutes. VPS merges all three sources, deduplicates, returns:

```json
{
  "symbols": ["EURUSD", "XAUUSD", "BTCUSD", "GBPUSD"]
}
```

Why API instead of hardcoded constants:
- Watchlist is user-editable from UI — no bridge redeploy
- Positions come and go dynamically
- Symbols can be added/removed without touching EA/cBot code

---

## 2. Price Push Architecture

### Flow

```
Bridge (every PricePushSeconds)     VPS
  │                                   │
  ├─ GET /v2/broker/tracked           │
  │   -symbols?account=X              │  merge: positions + watchlist + chart
  │   (startup + every 5m)            │  → return deduplicated symbol list
  │                                   │
  ├─ every PricePushSeconds:          │
  │   for each symbol:                │
  │     bid = Symbol.Bid              │
  │     ask = Symbol.Ask              │
  │                                   │
  ├─ POST /v2/broker/prices ──────►   │
  │   {source_id, ts,                │  1× UPDATE market_data (all TFs, all symbols)
  │    p:[{s,b,a},...]}              │  N× L1 memory patch (per symbol, per TF)
  │                                   │  N× Redis SETEX async (per symbol)
  │                                   │  1× SSE pulse → UI ticker
```

### Why no TF in payload

`last_price` is the current tick midpoint — same value regardless of timeframe. The VPS fans it out to all TF entries in Redis/DB. Bars (OHLC) are not touched — those come from Twelve Data cron.

### Data structures affected

**Redis** `market_data:{SYMBOL}`:
```json
{
  "symbol": "EURUSD",
  "updated_time": 1716163200,
  "data": [
    { "tf": "15m", "bars": [...], "last_price": 1.08520, "last_price_at": "..." },
    { "tf": "1H",  "bars": [...], "last_price": 1.08520, "last_price_at": "..." },
    { "tf": "4H",  "bars": [...], "last_price": 1.08520, "last_price_at": "..." }
  ]
}
```
`last_price` stored per-TF entry (same value duplicated). Update: iterate `root.data[]`, patch each entry's `last_price` + `last_price_at`, one `SETEX` per symbol.

**PostgreSQL** `market_data`:
```
(symbol, tf, bar_start, bar_end) UNIQUE
last_price DOUBLE, last_price_at TIMESTAMPTZ
```
Multiple rows per symbol (one per bar chunk per TF). Update: single bulk UPDATE by symbol (no TF filter), hits all rows.

**L1 Memory** `MARKET_DATA_MEMORY_CACHE`:
Same structure as Redis, in-process Map, 30min TTL. Update: direct object property mutation (zero IO).

---

## 3. Endpoints

### `GET /v2/broker/tracked-symbols?account=X`

Returns merged deduplicated symbol list.

**Auth:** EA API key (same as sync/pull).

**Response:**
```json
{
  "ok": true,
  "symbols": ["EURUSD", "XAUUSD", "BTCUSD"],
  "sources": {
    "positions": ["EURUSD", "XAUUSD"],
    "watchlist": ["BTCUSD"],
    "chart": []
  }
}
```

### `POST /v2/broker/prices`

Receives live bid/ask for tracked symbols.

**Auth:** EA API key.

**Payload:**
```json
{
  "source_id": "MT5",
  "ts": 1716163200,
  "p": [
    {"s": "EURUSD", "b": 1.08523, "a": 1.08531},
    {"s": "XAUUSD", "b": 2415.30, "a": 2415.80}
  ]
}
```

Short keys (`s`, `b`, `a`) minimize payload size for frequent pushes.

**Response:**
```json
{
  "ok": true,
  "updated": 2,
  "elapsed_ms": 3
}
```

### Existing endpoints (unchanged)

| Method | Path | Purpose | Timer |
|:---|:---|:---|:---|
| `GET` | `/v2/broker/pull` | Pull trade signals | `PollSeconds` |
| `POST` | `/v2/broker/sync` | PnL/status/sync positions | `SyncIntervalSeconds` |
| `POST` | `/v2/broker/ack` | Ack trade events | immediate |

---

## 4. VPS Update Logic

### DB — one bulk UPDATE

```sql
UPDATE market_data
SET last_price = p.mid,
    last_price_at = to_timestamp(p.ts)::timestamptz,
    updated_at = NOW()
FROM (VALUES
  ('EURUSD', 1.08527, 1716163200),
  ('XAUUSD', 2415.55, 1716163200)
) AS p(symbol, mid, ts)
WHERE market_data.symbol = p.symbol
```

- 1 query for all symbols × all TFs
- Existing index `idx_market_data_symbol_tf_bar` covers the WHERE
- No TF in WHERE — updates all chunk rows for each symbol

### L1 Memory — direct patch

```js
for (const {s, b, a} of prices) {
  const root = MARKET_DATA_MEMORY_CACHE.get(`market_data:${s}`);
  if (!root?.data) continue;
  const mid = (b + a) / 2;
  const iso = new Date(ts * 1000).toISOString();
  for (const tfEntry of root.data) {
    tfEntry.last_price = mid;
    tfEntry.last_price_at = iso;
  }
  root.updated_time = Math.floor(Date.now() / 1000);
}
```

Zero IO — pure in-memory object mutation.

### Redis — async flush

Same logic as L1 but against `redis.get`/`redis.setEx`. Can be debounced (batch every 5s instead of every price push) since Redis is a cache layer, not source of truth.

### SSE — UI pulse

After update, bump `NOTIFICATION_PULSE.global` with `type: "price_update"`, `symbols: [...]`. UI ticker component listens for this.

---

## 5. Bridge Parameters

### cTrader (`TVBridge_CTrader.cs`)

```
PricePushEnabled  = true           // Enable/disable price push
PricePushSeconds  = 60             // Push interval: 15, 30, 60, 120
SyncIntervalSeconds = 10           // PnL/status sync interval (replaces PollSeconds for sync)
PollSeconds       = 2              // Signal pull interval (unchanged)
```

### MQ5 (`TVBridgeEA.mq5`)

```
input bool   InpPricePushEnabled    = true;   // Enable/disable price push
input int    InpPricePushSeconds    = 60;     // Push interval: 15, 30, 60, 120
input int    InpSyncSeconds         = 10;     // PnL/status sync interval (was 60)
```

---

## 6. Timer Split

```
cTrader OnTimer():
  ├─ every PricePushSeconds:   PushPricesAsync()      → POST /v2/broker/prices
  ├─ every SyncIntervalSeconds: SyncWithVpsAsync()     → POST /v2/broker/sync
  └─ every PollSeconds:        PollSignalsAsync()      → GET  /v2/broker/pull

MQ5 OnTimer():
  ├─ every PricePushSeconds:   PushPrices()           → POST /v2/broker/prices
  ├─ every SyncSeconds:        SyncWithVps()           → POST /mt5/ea/sync-v2
  ├─ every 300s:               SyncClosedHistory()
  └─ every PollSeconds:        pull + execute signals  → GET  /mt5/ea/pull
```

Price push is independent — doesn't block signal polling, doesn't wait for sync.

---

## 7. Performance

| Metric | Value |
|:---|:---|
| Symbols per push | ~10-30 (positions + watchlist) |
| Push frequency | 60s default (min 15s) |
| DB queries per push | 1 |
| Redis writes per push | N symbols (async, debounce-able to every 5s) |
| L1 updates per push | N symbols × M TFs (in-memory, free) |
| Payload size (20 symbols) | ~800 bytes |
| DB write load (20 sym, 60s) | 1 query/min |
| DB write load (20 sym, 15s) | 4 queries/min |

PostgreSQL handles thousands of writes/sec. At 4 queries/min this is negligible.

---

## 8. Implementation Scope

| File | Changes |
|:---|:---|
| `server.js` | `GET /v2/broker/tracked-symbols` endpoint |
| `server.js` | `POST /v2/broker/prices` endpoint + DB/Redis/L1/SSE update |
| `TVBridge_CTrader.cs` | `PushPricesAsync()`, `FetchTrackedSymbolsAsync()`, new params, timer split |
| `TVBridgeEA.mq5` | `PushPrices()`, `FetchTrackedSymbols()`, new inputs, timer split |

---

## 9. Verification

- [ ] cTrader: `PricePushSeconds=15` pushes prices every 15s, UI ticker updates
- [ ] MQ5: `InpPricePushSeconds=60` pushes prices every 60s
- [ ] `GET /v2/broker/tracked-symbols` returns positions + watchlist merged
- [ ] DB `market_data.last_price` updated for all TFs of pushed symbols
- [ ] Redis `market_data:{SYMBOL}` has updated `last_price` in all TF entries
- [ ] SSE pulse fires on price update
- [ ] Price push doesn't block signal polling
- [ ] Price push recovers gracefully when VPS is unreachable
- [ ] `InpPricePushEnabled=false` disables the feature entirely
