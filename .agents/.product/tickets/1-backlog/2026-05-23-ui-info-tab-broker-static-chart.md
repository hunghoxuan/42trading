# UI: Info Tab Static Chart from Broker Bars

**Ticket ID**: `UI-STATIC-BARS-001`
**Status**: BACKLOG
**Tags**: `FEATURE`
**Created**: 2026-05-23
**Agent**: DeepSeek

## Scope

Modify SymbolChart Info tab to display static OHLC bars from broker data (CSV/cache) instead of relying solely on Twelve Data API.

## What

1. In Info tab (cache mode), when bars load, check broker CSV first: `GET /v2/market-data/broker-bars?symbol=X&tf=Y`
2. If broker bars available → render static chart from them
3. If not → fallback to existing Redis/DB/Twelve Data path
4. Show source indicator: "Broker" vs "Twelve Data"
5. Auto-refresh when new broker bars arrive (SSE `data-update` event)

## API Changes

New endpoint: `GET /v2/market-data/broker-bars?symbol=EURUSD&tf=15&limit=300`

- Reads from `market_data/{SYMBOL}/bars/{TF}.csv`
- Returns `{ symbol, tf, bars: [{t,o,h,l,c,v}], source: "broker" }`
- Falls back to `{ source: "cache" }` if no CSV exists

## UI Changes

- In `SymbolChart.jsx`, add `brokerBars` state alongside existing `master` data
- When both broker bars and Twelve Data bars exist, prefer broker (more real-time)
- When broker bars load, show green "Broker" badge next to TF header
- SSE listener for `data-update` with `page_id: "broker_bars"` → auto-refresh

## Files

- `webhook/server.js` — new endpoint
- `src/ui/src/components/charts/SymbolChart.jsx` — broker source handling
