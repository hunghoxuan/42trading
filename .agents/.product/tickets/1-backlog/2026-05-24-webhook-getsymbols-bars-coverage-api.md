# Webhook getSymbols bars coverage API (foundation)

## Meta
- Ticket Type: `New Feature`
- Ticket Status: `Plan`
- Owner: `N/A`
- Updated: `2026-05-24 11:16 UTC`
- Related:
  - `1-backlog/2026-05-24-webhook-prices-sync-incremental-contract.md`
  - `1-backlog/2026-05-24-broker-client-incremental-bulk-bars-sync.md`

## Problem
Broker clients need a deterministic way to discover what bars already exist on webhook before pushing updates. Current flow does not expose per-symbol/per-timeframe coverage (start/end/count), so clients may resend unnecessary data or miss gaps.

## Goal
Add a webhook API that returns bar coverage metadata for requested symbols and all configured TFs.

## Endpoint
`GET /v2/broker/symbols` (or alias under existing webhook namespace, keep one canonical route)

## Request Contract
- Filters:
  - `symbol` = single symbol
  - `symbols` = csv list (e.g. `BTCUSD,ETHUSD`)
  - `group` = symbol group (e.g. `Watchlist`)
- Default behavior:
  - if no filter is passed, use `all`
- Precedence:
  - `symbols` > `symbol` > `group` > `all`

## Response Contract
```json
{
  "ok": true,
  "mode": "symbols",
  "filters": { "symbol": null, "symbols": ["ADAUSD"], "group": null, "default": "all" },
  "items": [
    {
      "symbol": "ADAUSD",
      "bars_info": [
        { "tf": "1", "bars_number": 1000, "start": 1779618480, "end": 1779620760 },
        { "tf": "5", "bars_number": 850, "start": 1779617000, "end": 1779620600 },
        { "tf": "15", "bars_number": 0, "start": null, "end": null }
      ]
    }
  ]
}
```

## Data Rules
1. Return each requested symbol and all tracked TFs.
2. `bars_number` = number of valid bars in TF file.
3. `start` = timestamp at earliest valid bar from file scan.
   - if file parser requires skipping first row/data row, use first valid row after parser normalization.
4. `end` = latest valid bar timestamp.
5. `start` and `end` may be `null`.
6. If symbol/TF file missing, return empty coverage (`bars_number=0`, `start=null`, `end=null`).

## Implementation Notes
1. Build reusable helper:
   - `getBarsCoverageForSymbolTf(symbol, tf)` => `{bars_number, start, end}`
2. Keep ordering stable:
   - symbols ascending
   - TF order from existing canonical TF ordering
3. Include optional `warnings[]` for malformed rows, without failing entire response.
4. Keep endpoint read-only and lightweight for bulk all-symbol requests.

## Acceptance Criteria
- [ ] Works for `symbol`, `symbols`, `group`, and default `all`.
- [ ] Returns one item per resolved symbol with all TFs.
- [ ] `bars_number/start/end` are correct and nullable when data missing.
- [ ] Response order is deterministic.
- [ ] Endpoint runtime is acceptable for bulk mode.

## Handoff Prompt
```text
Implement GET symbols coverage API.

Read:
- .agents/.product/tickets/1-backlog/2026-05-24-webhook-getsymbols-bars-coverage-api.md

Deliver:
1) Endpoint + filter handling (`symbol|symbols|group|all`)
2) Per-symbol/per-TF coverage (`bars_number,start,end`)
3) Stable ordering + null-safe behavior + warnings

Return:
- changed files
- sample request/response for 4 filter modes
- validation notes
```
