# Broker Bars Sync Package — Implementation Summary & Handoff

Status: Done
Date: 2026-05-24
Builds: `v2026.05.24 13:05 - first-full-sync`

## Scope

3-ticket linked package that provides coverage-driven incremental OHLC bar sync from broker clients (cTrader + MQ5) to VPS webhook server.

---

## Tickets

### Ticket 1: Coverage API (`GET /v2/broker/symbols`)

**File:** `webhook/server.js`

Returns bar coverage metadata per symbol+TF from `market_data` DB table.

**Filters:** `symbol` | `symbols` | `group` | `all` (default)

**Response fields:**
| Field | Meaning |
|:---|:---|
| `existing_bars` | Actual bar count in DB |
| `bars_number` | Target count (500 default, max of existing_bars and 500) |
| `start` | Earliest bar timestamp (null if empty) |
| `end` | Latest bar timestamp (null if empty) |

**Sample:**
```json
{
  "symbol": "EURUSD",
  "bars_info": [
    { "tf": "15", "existing_bars": 120, "bars_number": 500, "start": 1779618000, "end": 1779696000 }
  ]
}
```

---

### Ticket 2: Incremental Prices Sync (`POST /v2/broker/prices-sync`)

**File:** `webhook/server.js`

Accepts bulk multi-symbol multi-TF OHLC bars, upserts with duplicate accounting.

**Request:**
```json
{
  "source_id": "Ctrader",
  "sync_mode": "incremental",
  "items": [
    { "symbol": "EURUSD", "tf": "15",
      "bars": [
        { "time": 1779696000, "open": 1.0850, "high": 1.0855, "low": 1.0845, "close": 1.0852, "volume": 100 }
      ]
    }
  ]
}
```

**Response:**
```json
{
  "ok": true, "sync_id": "sync_abc123",
  "summary": { "items": 1, "received": 1, "inserted": 1, "duplicated": 0, "rejected": 0 },
  "results": [
    { "symbol": "EURUSD", "tf": "15min", "received": 1, "inserted": 1, "duplicated": 0, "rejected": 0,
      "latest_timestamp_after_sync": 1779696000 }
  ]
}
```

**Dedup:** `ON CONFLICT (symbol, tf, bar_start, bar_end) DO NOTHING` — duplicate bars counted as `duplicated`.

---

### Ticket 3: Broker Client Loop

**Files:** `TVBridge_CTrader.cs` + `TVBridgeEA.mq5`

Coverage-driven sync loop:

```
1. GET /v2/broker/symbols  →  coverage (existing_bars, bars_number, end)
2. For each symbol×TF:
     If existingBars == 0: compute missing = min(timeNeeded, 500)  → full backfill
     If existingBars > 0:   compute missing = 1                     → latest candle only
     CopyRates/MarketData.GetBars() to fetch needed bars
3. POST /v2/broker/prices-sync  →  upsert with duplicate accounting
4. Print: "[IncBars] sync=N bars=N ins=N dup=N"
```

**First sync:** unlimited cap (10,000 total bars). Pushes up to 500 bars per TF.
**Subsequent syncs:** capped at 200 total bars per cycle. Pushes 1 bar per TF.

**Parameters (cTrader):**
- `EnableIncrementalBars` = true (Group: Bar Sync)
- `IncrementalBarsSeconds` = 120
- `IncrementalBarsMaxPerPost` = 200

**Parameters (MQ5):**
- `InpEnableIncrementalBars` = true
- `InpIncrementalBarsSeconds` = 120
- `InpIncrementalBarsMaxPerPost` = 200

---

## Files Changed

| File | What |
|:---|:---|
| `webhook/server.js` | `GET /v2/broker/symbols` — coverage API |
| `webhook/server.js` | `POST /v2/broker/prices-sync` — incremental upsert |
| `bridge-clients/TVBridge_CTrader.cs` | `SyncBarsIncrementalAsync()` + params + debug panel |
| `bridge-clients/TVBridgeEA.mq5` | `SyncBarsIncremental()` + `JsonGetArray()` + params |

---

## Verification

Run this SQL on VPS after broker starts pushing:
```sql
SELECT symbol, tf, count(*) as bars, MIN(bar_start), MAX(bar_start)
FROM market_data
GROUP BY 1,2 ORDER BY 1,2;
```

Expected after first full sync: 36 symbols × 6 TFs × ~500 bars.

## Deploy Status

- VPS: deployed `94ce5577`, webhook online
- cTrader: recompile `v2026.05.24 13:05 - first-full-sync`
- MQ5: recompile `v2026.05.24 13:05 - first-full-sync`

## Handoff

No outstanding work. cBot/EA recompilation is the only remaining step.
