# Execution Hub V2

Status: design contract.

## Goal
- Split immutable `signals` from executable `trades`.
- Support many sources and many accounts.
- Move broker auth ownership to accounts.
- Use lease-based delivery for reliability.

## Entities
- `sources`: TradingView/API/manual/bot signal producers.
- `signals`: immutable upstream intent.
- `accounts`: user-owned broker accounts.
- `brokers`: EA/API/manual executor identity.
- `account_sources`: source subscriptions per account.
- `trades`: account-scoped execution ledger.
- `logs`: unified audit trail.

## Status Model
- `dispatch_status`:
  - `NEW`
  - `LEASED`
  - `CONSUMED`
- `execution_status`:
  - `PENDING`
  - `OPEN`
  - `CLOSED`
  - `REJECTED`
- `close_reason`:
  - `TP`
  - `SL`
  - `MANUAL`
  - `CANCEL`
  - `EXPIRED`
  - `FAIL`

## Flow
1. Source posts signal.
2. Server writes immutable signal.
3. Server finds subscribed accounts.
4. Server creates one trade per account.
5. Broker pulls `NEW` trades.
6. Server leases trade with token + expiry.
7. Broker ACK updates execution state.
8. Server appends audit log.

## Broker-Originated Trades
- `signal_id` nullable.
- `source_id` nullable.
- `origin_kind='BROKER'`.
- `dispatch_status='CONSUMED'`.

## Reliability
- Pull is lease-based.
- Expired leases can be re-delivered.
- ACK must be idempotent.
- Broker sync reconciles active positions/orders.

## Migration
1. Prepare schema.
2. Backfill sources/account subscriptions.
3. Dual-write signal + trades.
4. Canary one broker/account.
5. Cut over V2 broker routes.
6. Remove old auth/status paths after stable.

## API Shape
- `POST /v2/sources/:source_id/signals`
- `POST /v2/broker/pull`
- `POST /v2/broker/ack`
- `POST /v2/broker/sync`
- `POST /v2/broker/heartbeat`

