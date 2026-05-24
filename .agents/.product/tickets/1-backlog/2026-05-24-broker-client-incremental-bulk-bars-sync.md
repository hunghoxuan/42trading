# Broker client incremental bulk bars sync using coverage API

## Meta
- Ticket Type: `Update Feature`
- Ticket Status: `Plan`
- Owner: `N/A`
- Updated: `2026-05-24 11:16 UTC`
- Depends On:
  - `1-backlog/2026-05-24-webhook-getsymbols-bars-coverage-api.md`
  - `1-backlog/2026-05-24-webhook-prices-sync-incremental-contract.md`

## Problem
Broker clients currently lack a standardized coverage-driven sync loop. Without server coverage metadata and incremental sync summary coupling, clients either overpush or under-sync bars across symbols/TFs.

## Goal
Implement broker client sync flow:
1. Fetch symbol/TF coverage from webhook.
2. Compute missing ranges per symbol/TF.
3. Push only remaining bars up to target `bars_number` and latest closed bar.
4. Support bulk mode (all symbols, all TFs).

## Client Flow
1. Call getSymbols coverage endpoint:
   - `GET /v2/broker/symbols` with `symbol|symbols|group|all`
2. For each `symbol/tf`:
   - read `start/end/bars_number`
   - compute missing segment from `end + tf_step` to latest closed bar
   - when `end` is null, fetch initial backfill up to configured cap
3. Pull bars from broker source.
4. Batch and push to prices sync endpoint:
   - `POST /v2/broker/prices-sync`
5. Reconcile summary and retry failed chunks.

## Required Modes
1. Single symbol sync.
2. Multi-symbol list sync.
3. Group sync (e.g. Watchlist).
4. Bulk all-symbol all-TF sync.

## Algorithm Constraints
1. Sync closed bars only.
2. Cap per-request bar size and per-post item size.
3. Preserve TF-step alignment.
4. Deduplicate before send if local source may emit repeats.
5. Retry transient failures with exponential backoff.

## Telemetry/Logs (must add)
Per sync cycle include:
- scope (`symbol|symbols|group|all`)
- items processed
- bars fetched
- bars sent
- inserted/duplicated/rejected from webhook response
- lag per symbol/TF (`latest_closed - remote_end`)

## Acceptance Criteria
- [ ] Client calls coverage endpoint before each sync cycle.
- [ ] Missing-range computation is correct for null and non-null `end`.
- [ ] Bulk mode syncs all symbols/all TFs with batching.
- [ ] Endpoint response reconciliation works (inserted/duplicate/rejected).
- [ ] Sync is resumable and idempotent after interruption.

## Handoff Prompt
```text
Implement broker client incremental bars sync loop.

Read:
- .agents/.product/tickets/1-backlog/2026-05-24-broker-client-incremental-bulk-bars-sync.md
- .agents/.product/tickets/1-backlog/2026-05-24-webhook-getsymbols-bars-coverage-api.md
- .agents/.product/tickets/1-backlog/2026-05-24-webhook-prices-sync-incremental-contract.md

Deliver:
1) Client orchestration: GET coverage -> compute missing -> POST incremental bars
2) Support scope modes: symbol, symbols, group, all
3) Batching + retry + reconciliation telemetry

Return:
- changed files
- sync flow summary
- sample cycle log for one symbol and bulk mode
```
