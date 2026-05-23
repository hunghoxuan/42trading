# WEBHOOK: Receive and Store Broker OHLC Bars

**Ticket ID**: `WEBHOOK-BARS-001`
**Status**: BACKLOG
**Tags**: `FEATURE`
**Created**: 2026-05-23
**Agent**: DeepSeek

## Scope

New endpoint `POST /v2/broker/bars` on webhook server to receive, store, cache, and serve broker OHLC bars.

## What

1. **Endpoint** `POST /v2/broker/bars` — accept bars from EA
2. **Append to CSV** — `market_data/{SYMBOL}/bars/{TF}.csv`
3. **Update Redis cache** — merge into `market_data:{symbol}` L2 cache and L1 memory cache
4. **Return bars for Info tab** — existing `GET /v2/market-data/bars?symbol=X&tf=Y` reads from file cache, not just DB

## Payload (from EA)

```json
{
  "source_id": "MT5",
  "account_id": "12345",
  "bars": [
    { "s": "EURUSD", "tf": "15", "t": 1712345678, "o": 1.0500, "h": 1.0505, "l": 1.0495, "c": 1.0502, "v": 1234 }
  ]
}
```

## Implementation

### 1. Receive & Validate
- Auth via `requireEaKey()`
- Validate OHLC values are finite numbers
- Skip duplicate bars (same `s+tf+t`)

### 2. Append to CSV
- Path: `{ROOT_FOLDER}/market_data/{SYMBOL}/bars/{TF}.csv`
- Format: `time,open,high,low,close,volume`
- Header auto-written if new file
- Append one line per bar

### 3. Update Redis Cache
- Read existing `market_data:{symbol}` from Redis
- For the matching TF entry, extend `bars` array with new bar
- If bar already exists (same time), replace
- Keep max 1000 bars per TF in Redis
- Update `last_price` from latest bar close
- `SETEX` with TTL 3600

### 4. Update L1 Memory Cache
- Same merge logic as Redis but into `MARKET_DATA_MEMORY_CACHE`

### 5. Return Data for Info Tab
- Existing `GET /v2/market-data/bars` already reads from Redis cache
- With broker bars in Redis, it auto-serves them
- Add fallback: if cache miss, read from CSV file

## Files

- `webhook/server.js` — new endpoint + cache merge logic
