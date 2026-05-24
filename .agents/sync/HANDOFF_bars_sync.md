# Bars Sync Handoff

Status: Done
Date: 2026-05-24
Latest commit: 894519af

## Files

| File | Build |
|---|---|
| `bridge-clients/TVBridge_CTrader.cs` | `v2026.05.24 13:40 - backfill-until-target` |
| `bridge-clients/TVBridgeEA.mq5` | `v2026.05.24 13:05 - first-full-sync` |
| `webhook/server.js` | deployed |

## Storage

CSV files: `webhook/market_data/{SYMBOL}/bars/{TF}.csv`
TFs: 1, 5, 15, 60, 240, 1440 (all numeric)
Daily: 1440.csv (NOT 1d.csv — deleted)

## What works

- 35 symbols have 1440.csv with 332-501 bars (restored from snapshot export)
- Coverage API: `GET /v2/broker/symbols` — returns existing_bars, bars_number, start, end
- Prices-sync: `POST /v2/broker/prices-sync` — mergeBarsIntoCSV dedup by time
- cTrader incremental sync: all 36 symbols, backfill until existing_bars >= 500
- cTrader debug panel shows INCSYNC status

## What needs broker backfill

Other TFs (1,5,15,60,240) depend on broker history. EURAUD/EURCAD already at 360-501 bars.
Remaining symbols fill over multiple cycles (existing_bars < 500 → backfill mode).

## Verify

cTrader log: `[IncBars] sync=N bars=N ins=N dup=N`
VPS: `wc -l webhook/market_data/*/bars/*.csv | sort -t/ -k3`
