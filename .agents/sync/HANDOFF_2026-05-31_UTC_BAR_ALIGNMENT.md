# Handoff: 2026-05-31 UTC Bar Alignment + Draft Approve Button

## Agent
Codex

## Status
Code complete, build verified, localhost tested. **Not yet deployed to prod.**

---

## Changes Summary

### 1. Market Data Bars — UTC Normalization & Source Guarding

**Problem**: cTrader pushed bars with broker-local timestamps (not UTC) and CFD prices for crypto pairs, causing:
- Duplicate daily bars (same day, different timezone timestamps)
- Price discontinuities on 5m charts (cTrader CFD prices vs Binance real exchange)
- cTrader overwriting clean Binance bars via UPSERT in `mergeBarsIntoCSV`

**Fixes** (`webhook/server.js`):
| # | Fix | Location |
|---|---|---|
| 1 | `normalizeBarTimeToUTC()` — snap all bar timestamps to UTC TF boundaries | L474-480 |
| 2 | `mergeBarsIntoCSV` — normalize existing bars on read, UTC-align new bars on write | L484, L523-533, L549-552 |
| 3 | `readBrokerBarsFromCsv` — normalize + dedupe on read | L432-470 |
| 4 | `/v2/market-data/broker-bars` — normalize + dedupe on read | L21052-21067 |
| 5 | `/v2/broker/bars` — batch bars by (symbol,tf), single merge call | L25843-25867 |
| 6 | `/v2/broker/bars` — `appendOnly: true` mode, never overwrite existing | L25865 |
| 7 | `/v2/broker/bars` — skip crypto pairs entirely (`isCryptoPair`) | L25849-25852 |
| 8 | `pullLeasedTradesV2` — fix `param $3` type ambiguity (PostgreSQL) | L9325-9340 |
| 9 | Remove duplicate `const sessionId` (Node v25 crash) | L27826 |
| 10 | `promoteDraftTrade` — case-insensitive status check | L24815-24818 |

### 2. Draft Trade — Approve Button

**Problem**: Draft trade detail page had a green "+ Trade" button that promoted directly to live/FILLED. User wanted a two-step flow: Draft → Approve → PENDING.

**Fixes** (`web-ui/src/pages/trades/V2TradeDetailPage.jsx`):
- Added `useNavigate` import
- Replaced green "+ Trade" button with cyan `#06b6d4` "Approve" button
- Uses existing `isDraft` flag (case-insensitive `=== "DRAFT"`)
- On success: `navigate(/trades/pending/${tradeId}, { replace: true })`
- Server-side promote check now case-insensitive too

### 3. Cleaned Contaminated CSVs
- `data/market_data/BTCUSD/bars/5.csv` — removed cTrader bars after 1780227300
- `data/market_data/BNBUSD/bars/5.csv` — removed cTrader bars after 1780227300

---

## Files Changed

| File | Changes |
|---|---|
| `webhook/server.js` | 426 insertions, 344 deletions |
| `web-ui/src/pages/trades/V2TradeDetailPage.jsx` | Added Approve button + navigate redirect |

## Build

- Webhook: `node --check` ✅
- UI: `npm --prefix web-ui run build` ✅
- Server health: `ok:true` ✅

## Deploy Status

- Committed: `fae0b7b24` — `codex: fix(market_data): UTC bar time alignment, append-only cTrader push, crypto skip, pull $3 param fix`
- Pushed: `origin/main` ✅
- **NOT DEPLOYED to prod** — only localhost tested

## Remaining

- Prod deploy (user must request explicitly)
- After deploy, force-refresh charts to re-download clean UTC bars
- Binance cron will auto-fill gaps in BNBUSD/BTCUSD after cleaned CSV bars

## Verification Checklist

- [ ] `/health` returns `ok:true`
- [ ] `/v2/broker/bars` with crypto pair → bars skipped, `skipped_crypto` logged
- [ ] `/v2/broker/bars` with forex pair → bars merged with appendOnly
- [ ] `/v2/market-data/broker-bars?symbol=EURUSD&tf=5m` → UTC-aligned timestamps
- [ ] `/v2/broker/pull` → no `could not determine data type of parameter $3` error
- [ ] Draft trade page → cyan "Approve" button visible
- [ ] Click Approve → status changes to PENDING → redirect to `/trades/pending/{id}`

## Next Agent Instructions

```
Read: .agents/sync/HANDOFF_2026-05-31_UTC_BAR_ALIGNMENT.md
Task: Deploy to prod when user requests.
Before deploy:
  1. git fetch origin && git checkout main && git pull --ff-only origin main
  2. Verify commit fae0b7b24 is at HEAD
  3. bash scripts/deploy/bump_build_versions.sh
  4. bash scripts/deploy/deploy_webhook.sh
  5. Verify /health shows bumped version
  6. Verify /health shows ok:true
After deploy:
  7. User should force-refresh charts (crypto pairs especially)
  8. Check broker-bars API for any symbol to confirm UTC-aligned timestamps
```
