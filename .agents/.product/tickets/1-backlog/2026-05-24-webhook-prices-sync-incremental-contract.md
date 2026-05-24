# Webhook prices sync incremental contract (align to coverage API)

## Meta
- Ticket Type: `Update Feature`
- Ticket Status: `Plan`
- Owner: `N/A`
- Updated: `2026-05-24 11:16 UTC`
- Depends On:
  - `1-backlog/2026-05-24-webhook-getsymbols-bars-coverage-api.md`
- Related:
  - `1-backlog/2026-05-24-broker-client-incremental-bulk-bars-sync.md`

## Problem
Current prices sync endpoint is not explicitly modeled for “remaining bars only” upsert based on server coverage. We need a clear contract that supports bulk symbol/TF sync with deterministic insert/duplicate reporting.

## Goal
Update existing prices sync POST API (or add v2 endpoint) to accept incremental batches and return per-symbol/per-TF ingest summary for broker reconciliation.

## Endpoint
`POST /v2/broker/prices-sync` (or keep existing path with backward-compatible extension)

## Request Contract
```json
{
  "source_id": "MT5",
  "sync_mode": "incremental",
  "items": [
    {
      "symbol": "ADAUSD",
      "tf": "1",
      "bars": [
        { "time": 1779620820, "open": 0.54, "high": 0.55, "low": 0.53, "close": 0.54, "volume": 1234 },
        { "time": 1779620880, "open": 0.54, "high": 0.56, "low": 0.54, "close": 0.55, "volume": 1180 }
      ]
    }
  ]
}
```

## Response Contract
```json
{
  "ok": true,
  "sync_id": "uuid",
  "summary": { "items": 1, "received": 2, "inserted": 2, "duplicated": 0, "rejected": 0 },
  "results": [
    {
      "symbol": "ADAUSD",
      "tf": "1",
      "received": 2,
      "inserted": 2,
      "duplicated": 0,
      "rejected": 0,
      "latest_timestamp_after_sync": 1779620880
    }
  ]
}
```

## Data + Validation Rules
1. Required fields per item: `symbol`, `tf`, `bars[]`.
2. Required per bar: `time,open,high,low,close` (`volume` optional if existing contract allows).
3. Handle duplicates by `(symbol, tf, time)` unique identity.
4. Behavior for duplicate timestamp:
   - default: keep existing and count duplicate
   - optional strict mode: replace if payload has fresher record
5. Accept out-of-order bars by sorting in endpoint before upsert.
6. Return per-item reject reasons for invalid rows (non-numeric OHLC, bad time).

## Compatibility
1. If old payload path exists, keep compatibility shim.
2. Map old payload shape into new `items[]` shape internally.
3. Keep response additive (do not break old consumers relying on `ok` only).

## Acceptance Criteria
- [ ] Endpoint accepts bulk multi-symbol multi-TF incremental bars.
- [ ] Duplicate handling is deterministic and counted.
- [ ] Per-item result summary is returned and accurate.
- [ ] Backward compatibility path remains functional.
- [ ] Contract aligns with coverage output from Ticket 1.

## Handoff Prompt
```text
Implement incremental prices sync endpoint contract.

Read:
- .agents/.product/tickets/1-backlog/2026-05-24-webhook-prices-sync-incremental-contract.md
- .agents/.product/tickets/1-backlog/2026-05-24-webhook-getsymbols-bars-coverage-api.md

Deliver:
1) POST sync endpoint with `items[symbol,tf,bars[]]`
2) Upsert with duplicate accounting
3) Per-item + overall sync summary response
4) Backward-compat parsing for legacy payloads

Return:
- changed files
- sample request/response
- duplicate/invalid-row behavior notes
```
