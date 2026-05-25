# Trade Close Archival: Copy Bars + Snapshots to Trade Folder

**Ticket ID**: `TRADE-CLOSE-ARCHIVE-001`
**Status**: IN PROGRESS
**Tags**: `FEATURE`
**Created**: 2026-05-24
**Agent**: DeepSeek

## Problem

When a trade closes, its bars and snapshots remain scattered in `market_data/{symbol}/`. No snapshot of market context at close time. If the trade folder is later moved to `trade_closed/`, the data is lost.

## Solution

### 1. On trade status → CLOSED
Hook into trade status update flow (`/v2/ea/trades/sync-bulk`, `/v2/trades/{id}/status`, etc.). When `execution_status` changes to `CLOSED`:

```js
archiveTradeData(sid, symbol) {
  // Copy all bars CSV files for symbol
  for each tf in market_data/{symbol}/bars/*.csv:
    cp → trade_files/trade-{sid}/bars/{tf}.csv

  // Copy all snapshots for symbol
  for each file in market_data/{symbol}/*.jpg,*.png:
    cp → trade_files/trade-{sid}/snapshots/{file}

  // Move trade folder to closed
  mv trade_files/trade-{sid} → trade_closed/trade-{sid}
}
```

### 2. Trade Info Tab bar priority
When SymbolChart renders static bars in Info tab:

```
Priority:
1. trade_closed/{sid}/bars/{tf}.csv     (archived closed trades)
2. trade_files/{sid}/bars/{tf}.csv      (active trades)
3. market_data/{symbol}/bars/{tf}.csv   (live market data)
```

### 3. API endpoint (for Info Tab)
`GET /v2/trades/{sid}/bars?tf=15` — reads bars from trade folder first, falls back to market_data.

## Files
- `webhook/server.js` — `archiveTradeData()`, hook into CLOSED status, new API endpoint, bar priority logic
