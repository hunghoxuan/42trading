# Ticket: Local VPS <-> cTrader Sync Correctness

Date: 2026-05-28
Environment: local VPS + local Postgres only
Area: `webhook/server.js`, `webhook/syncGuards.js`, `bridge-clients/TVBridge_CTrader.cs`
Severity: High
Status: Partially fixed in code; remaining protocol work listed below

## Goal

Make sync between the local VPS database and the cTrader bridge deterministic, source-aware, and idempotent:

- A VPS-authored trade change is sent to cTrader once.
- A broker-authored trade change is applied to VPS once.
- Broker-origin updates must not echo back to broker.
- VPS-origin updates must be confirmed by broker ack/snapshot, not replayed forever.
- Active counts and fields must converge: pending count, filled count, status, PnL, volume, entry, TP, SL.

## Final Finding From Local Debugging

The reported `XAGGBP` loop was not an active trade execution loop.

Local checks showed:

- Local Postgres had no active `XAGGBP` `PENDING` or `FILLED` trade.
- `/webhook/v2/broker/pull?account_id=10869460&max_items=50` returned `items: []`.
- `/webhook/v2/broker/tracked-symbols?account=10869460` still included `XAGGBP` from the watchlist merge.

So cTrader was polling/handling an old unsupported watchlist symbol, not executing an old active trade.

## Fixes Applied

### 1. Stop unsupported inactive watchlist symbols from reaching cTrader

Server-side:

- `/v2/broker/tracked-symbols` now keeps active position/order symbols.
- Watchlist symbols are included only when local broker bar coverage exists.
- Dropped symbols are reported in `sources.dropped_watchlist`.

Client-side:

- cTrader now validates each tracked symbol through `Symbols.GetSymbol()`.
- Unsupported symbols are skipped before being stored in `_trackedSymbols`.
- Bridge logs skipped unsupported symbols.

Result verified locally:

- `XAGGBP` is no longer returned in `symbols`.
- `XAGGBP` appears in `sources.dropped_watchlist`.

### 2. Fix `/v2/broker/sync` JSON-string snapshot crash

Root cause:

- cTrader sends snapshot entries as JSON strings in arrays.
- `brokerSyncV2.pushItems()` parsed the string and reassigned a `const raw`, causing `TypeError: Assignment to constant variable`.
- That meant broker-origin position/order changes could fail before reaching VPS.

Fix:

- `pushItems()` now parses JSON-string items into a separate `raw` value and skips invalid parsed entries.

Result verified locally:

- cTrader posted `/v2/broker/sync`.
- Server processed the request without the old const-assignment crash.

### 3. Make VPS -> broker pull task type explicit

Root cause:

- Normal VPS-created pending trades were emitted as `type:"FILLED"` by `/v2/broker/pull`.
- cTrader happened to treat unknown/non-control types as open, so create worked by accident.

Fix:

- Added `syncGuards.brokerTaskTypeForTrade()`.
- Normal create tasks now emit `OPEN`.
- `PENDING_MOD`, `PENDING_CLOSE`, and `PENDING_CANCEL` still map to `MODIFY`, `CLOSE`, and `CANCEL`.

### 4. Prevent stale local tasks from executing much later

Root cause:

- A stale `NEW` + `PENDING` row could be leased later and executed even if it was no longer intended.

Fix:

- Added `MT5_V2_BROKER_PULL_MAX_AGE_HOURS`, default `24`.
- Stale unexecuted create tasks are auto-rejected with:
  - `execution_status='REJECTED'`
  - `dispatch_status='CONSUMED'`
  - `rejection_reason='stale broker pull task'`
  - `BROKER_PULL_STALE_REJECT` log

### 5. Harden lease retry behavior

Root cause:

- Expired leases could be repeatedly re-leased until retry rejection, but the logic was embedded and hard to audit.

Fix:

- Added guard helpers for lease expiry/retry count.
- Expired leases reject after retry budget with:
  - `execution_status='REJECTED'`
  - `dispatch_status='CONSUMED'`
  - `rejection_reason='broker ack lease retry limit exceeded'`
  - `BROKER_PULL_RETRY_REJECT` log

### 6. Enforce lease-token validation on ACK

Root cause:

- `/v2/broker/ack` required `lease_token`, but `ackTradeV2()` updated rows by `sid + account_id` only.
- A stale or duplicate ACK could consume a newer lease.

Fix:

- ACK update now requires:
  - matching `sid`
  - matching `account_id`
  - `dispatch_status='LEASED'`
  - exact `lease_token`
- Duplicate already-applied ACKs return `ok:true, duplicate:true`.
- Wrong/stale ACKs return an error and log `TRADE_ACK_FAILED`.

### 7. Preserve DeepSeek cTrader SID fallback and bump bridge version

DeepSeek fix kept:

- If cTrader recreates a pending order and loses the SID comment, bridge can use a same-symbol/same-side position SID fallback.
- New OID -> SID is cached in `_ticketSidMap`.

Additional client fix added:

- Shared symbol resolver for execute and tracked-symbol filtering.
- Build version changed to `v2026.05.28 17:10 - sync-guards`.

### 8. Add broker snapshot fingerprints for idempotent broker -> VPS sync

Root cause:

- cTrader sends frequent full snapshots.
- Before this change, an unchanged broker item could still run through the trade update path repeatedly.
- The system had no stable inbound item fingerprint to identify duplicate snapshots.

Fix:

- Added `syncGuards.brokerSnapshotFingerprint()` and `syncGuards.brokerSnapshotHash()`.
- `brokerSyncV2()` now computes a stable hash for every normalized broker item.
- Existing rows are preloaded by SID and broker ticket.
- If the existing row already has the same `metadata.last_broker_snapshot_hash`, the item is skipped as `NoChange` before SQL mutation.
- Changed broker items write:
  - `metadata.last_change_origin='broker'`
  - `metadata.last_inbound_event_id='broker:{account}:{hash}'`
  - `metadata.last_broker_snapshot_hash={hash}`
  - `metadata.broker_data.snapshot_hash={hash}`

Result:

- Replayed identical broker snapshots no longer re-apply the same trade mutation.
- Broker-origin updates are now marked in metadata, which is the first concrete step toward the full revision/event protocol.

### 9. Prevent manual VPS terminal edits from bypassing broker queue

Root cause:

- `updateTradeManualV2()` could directly set `CLOSED`, `CANCELLED`, or `REJECTED`.
- For broker-linked active trades, that made VPS terminal before cTrader confirmed the broker-side action.

Fix:

- Added `syncGuards.brokerLinkedManualStatus()`.
- If a broker-linked `FILLED` trade is manually set to terminal status, VPS now applies `PENDING_CLOSE` and resets dispatch to `NEW`.
- If a broker-linked `PENDING` trade is manually set to terminal status, VPS now applies `PENDING_CANCEL` and resets dispatch to `NEW`.
- Local-only trades still allow direct terminal edits.
- Manual edit logs now include `requested_status` and `queued_broker_action`.

Result:

- Manual close/cancel from VPS now queues exactly one broker action instead of pretending the broker is already closed.

## Case Coverage After This Patch

### VPS -> broker

| Case | Current state after patch | Notes |
|---|---|---|
| 1. Create trade | Fixed/hardened | Pull now emits explicit `OPEN`. Stale creates auto-reject instead of executing much later. ACK requires exact lease token. |
| 2. Change status: Cancel / Close | Fixed for manual edit path | Broker-linked active trades now map direct terminal edits to `PENDING_CLOSE` or `PENDING_CANCEL` with `dispatch_status='NEW'`. Bulk action path already used queue statuses. |
| 3. Change trade info: entry, TP, SL, RR, volume | Partial | SL/TP modify exists. Pending entry/target price, volume, order type, RR-derived fields are not fully broker-modified yet. |

### Broker -> VPS

| Case | Current state after patch | Notes |
|---|---|---|
| 1. Manually create order / position | Mostly supported | Broker sync can discover unmatched broker trades. Still needs stronger inbound idempotency key/hash to avoid duplicates if broker ticket/SID mapping changes. |
| 2. Manually cancel order / close position | Mostly supported | Complete snapshots and closed deals can terminalize VPS rows. Needs consecutive snapshot/grace guard for missing-ticket closure. |
| 3. Auto update PnL and computed fields | Better guarded | Broker fields update from snapshots. Identical broker item hashes now skip mutation. Still needs intentional event/noise policy for meaningful PnL-only changes. |
| 4. Manually change order / position info | Partial | Broker -> VPS can update entry, SL, TP, order type, volume. RR is not broker-native and is not recomputed as first-class sync state. |
| 5. Auto status change: PENDING -> FILLED, TP/SL met | Partial | PENDING -> FILLED works. TP/SL closures currently become `CLOSED` plus optional reason; cTrader closed payload needs richer close reason for exact TP/SL distinction. |

## Remaining Issues

### A. No explicit source/revision protocol yet

Current code has `source_id` and metadata like `last_sync_source`, but not a strict change-origin contract.

Needed:

- `last_change_origin`
- `vps_revision`
- `broker_revision`
- `last_outbound_action_id`
- `last_inbound_event_id`
- `last_broker_snapshot_hash`

Without this, the system is improved but still relies on status/lease side effects rather than a formal "do not echo this source back" rule.

### B. More status endpoints should be audited

`updateTradeManualV2()` and bulk action paths are now queue-aware for broker-linked active trades. Remaining work is to audit every older route that can update trade status outside this V2 path.

Needed:

- Search and harden any non-V2 or legacy status update route.
- Terminal status should continue to be confirmed by ACK or broker snapshot.

### C. MODIFY is not complete

cTrader `MODIFY` currently handles SL/TP. It does not fully support:

- pending entry/target price changes
- pending volume changes
- order type changes
- RR-derived target updates
- risk/size recalculation

Needed:

- For pending orders: modify target price/entry, SL, TP, expiration, and supported volume/order fields.
- For filled positions: only allow broker-supported modifications, currently SL/TP.

### D. Broker snapshot idempotency is partially implemented

Broker snapshots are frequent. This patch adds per-item hashes and skips unchanged existing rows. Remaining work is to broaden this into a formal event table and account-level snapshot hash.

Needed:

- Add `trade_sync_events` or durable inbound event records.
- Add account-level snapshot hash for full snapshot closure decisions.
- Apply field-level diffs so PnL-only updates are either intentionally logged or intentionally quiet.

### E. TP/SL close reason is incomplete

cTrader historical closed sync currently does not reliably send the deal close reason.

Needed:

- Include cTrader close/deal reason where available.
- Store exact `close_reason='TP'|'SL'|'MANUAL'|'CANCEL'`.
- Keep `execution_status='CLOSED'` or extend status enum only if the UI truly needs TP/SL as statuses.

## Recommended Final Architecture

Add a small sync-event layer instead of using raw trade status as the queue.

### New trade fields

- `vps_revision BIGINT NOT NULL DEFAULT 0`
- `broker_revision BIGINT NOT NULL DEFAULT 0`
- `last_change_origin TEXT NULL`
- `last_outbound_action_id TEXT NULL`
- `last_inbound_event_id TEXT NULL`
- `last_broker_snapshot_hash TEXT NULL`
- `sync_state TEXT NOT NULL DEFAULT 'IDLE'`
- `sync_error TEXT NULL`

### Optional `trade_sync_events` table

- `trade_sid`
- `account_id`
- `direction`: `vps_to_broker` or `broker_to_vps`
- `origin`: `vps`, `broker`, or `system`
- `event_type`: `CREATE`, `MODIFY`, `CANCEL`, `CLOSE`, `FILL`, `TP`, `SL`, `PNL_UPDATE`
- `idempotency_key UNIQUE`
- `payload_hash`
- `status`: `NEW`, `LEASED`, `APPLIED`, `IGNORED`, `FAILED`
- `lease_token`
- `created_at`
- `applied_at`

### Rule set

- VPS-created changes create outbound sync events with idempotency key `vps:{sid}:{revision}:{action}`.
- Broker-created changes create inbound event ids/hashes and never create outbound broker actions.
- ACK confirms an outbound event only when lease token and action id match.
- Broker snapshot confirms an outbound event when broker state matches desired VPS state.
- Duplicate ACKs/snapshots return success or skip without mutation.
- Stale ACKs never mutate current trade state.

## Acceptance Criteria

- VPS create creates exactly one broker order/position.
- VPS close/cancel creates exactly one broker action.
- VPS pending modify updates broker pending order fields exactly once.
- Broker manual create creates exactly one VPS trade.
- Broker manual close/cancel terminalizes VPS exactly once.
- Broker PENDING -> FILLED updates VPS exactly once.
- Broker TP/SL/manual close is distinguishable in `close_reason`.
- PnL/computed fields update VPS without creating outbound broker actions.
- Duplicate snapshots do not create duplicate logs or DB churn.
- Duplicate/stale ACKs do not consume newer leases.
- After a complete snapshot, VPS active pending/filled counts match cTrader.

## Verification Performed

Commands:

- `node --check webhook/server.js`
- `node --test scripts/test/syncGuards.test.mjs`
  - 8/8 passing, including broker snapshot hash tests and manual terminal-status queue mapping tests

Local endpoint verification through the existing web UI proxy:

- `GET http://127.0.0.1:3000/webhook/v2/broker/pull?account_id=10869460&max_items=50`
  - status `200`
  - `items.length = 0`
- `GET http://127.0.0.1:3000/webhook/v2/broker/tracked-symbols?account=10869460`
  - status `200`
  - `symbols` does not include `XAGGBP`
  - `sources.dropped_watchlist` includes `XAGGBP`

Runtime:

- Local webhook is listening on port `3001`.
- cTrader posted `/v2/broker/sync`.
- Server logged `items=0 results=2`.
- No `Assignment to constant variable` error after the patch.
- Local webhook was restarted after the idempotency code change and is listening on port `3001`.

## Files Changed For This Patch

- `webhook/server.js`
- `webhook/syncGuards.js`
- `scripts/test/syncGuards.test.mjs`
- `bridge-clients/TVBridge_CTrader.cs`
- `.agents/sync/TICKET_2026-05-28_VPS_CTRADER_TRADE_SYNC_SOURCE_OF_TRUTH.md`

## Deployment Notes

Required:

- Recompile/reload cTrader bridge so build `v2026.05.28 17:10 - sync-guards` is running.
- Keep local webhook connected to local Postgres (`mt5_bridge_local`).

Already started during verification:

- Local webhook is running via `launchctl submit -l trading-webhook-local`.

## Important Caution

This patch fixes the observed stale `XAGGBP` handling, broker sync crash, stale pull execution, and stale ACK mutation risk. It does not yet implement the full revision/event-table architecture. The sync is materially safer now, but the remaining protocol work above is still needed before calling the design complete.
