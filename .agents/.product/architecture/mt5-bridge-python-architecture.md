# MT5 bridge architecture for 42trade

## Decision

Keep `42trade` Node src/api as the product backend and add a separate Python MT5 adapter service behind it.

## Why

`42trade` already has live MT5/broker behavior in Node:
- broker pull/ack/sync routes in `webhook/server.js`
- market-data cron and snapshot cron in `webhook/server.js`
- trade storage in Postgres plus JSON/file settings
- EA and cTrader clients already targeting the Node webhook

ChronosTrade does not replace Node with Python.
It uses Python narrowly for MT5 terminal access and market-data sync, while Node owns orchestration and product APIs.

## Current 42trade MT5 surface

Node src/api currently owns:
- broker task leasing: `/v2/broker/pull`
- broker ack: `/v2/broker/ack`
- broker price push: `/v2/broker/prices`
- broker price sync: `/v2/broker/prices-sync`
- broker bars push: `/v2/broker/bars`
- broker snapshot sync/reconcile: `/v2/broker/sync`, `/v2/broker/reconcile`, `/mt5/ea/sync-v2`
- legacy EA pull/ack/heartbeat/log: `/mt5/ea/pull`, `/mt5/ea/ack`, `/mt5/ea/heartbeat`, `/mt5/ea/log-v2`
- market-data cron: `mt5RunMarketDataCron`
- cron scheduler: `mt5CronLoop`

## ChronosTrade Python bridge surface

Python bridge exposes typed local adapter endpoints:
- `GET /bridge/health`
- `POST /bridge/account/summary`
- `POST /bridge/account/readiness`
- `POST /bridge/account/positions`
- `POST /bridge/account/orders`
- `POST /bridge/account/deals`
- `POST /bridge/market/quote`
- `POST /bridge/command/open-market`
- `POST /bridge/command/place-pending`
- `POST /bridge/command/close-position`
- `POST /bridge/command/partial-close`
- `POST /bridge/command/modify-position`
- `POST /bridge/command/cancel-order`

## Recommended 42trade target shape

### Layer 1: broker clients
- folder: `src/mt5-bridge-clients/`
- keep MT5 EA, cTrader bot, and TradingView assets here
- these clients continue talking to Node during migration

### Layer 2: Node orchestration
- existing `src/api/server.js` remains public/API layer
- Node keeps current external contracts intact
- Node can later proxy selected broker operations to Python without changing frontend or EA contracts

### Layer 3: Python adapter
- folder: `src/mt5-bridge-python/`
- local-only service on port `3002`
- owns MT5 terminal session rules, broker credential handling, and command execution translation

## What already exists in 42trade and should not be duplicated yet

Already present in Node:
- candle/bar ingestion endpoint
- incremental price sync endpoint
- cron-driven market-data fetching
- trade leasing and ack lifecycle
- sync guard logic for leased/open/close/cancel workflows

Because of that, ChronosTrade-style startup sync and scheduled fetch should not be copied first.
We first need to isolate whether the missing value is MT5 terminal execution adapter, not candle sync.

## DB mapping principle

Do not replace existing 42trade schema.
Only extend via additive fields/tables if Python bridge needs its own state.

Use existing storage first:
- `users`
- `user_accounts`
- `trades`
- user settings JSON files under `data/users/.../settings`
- metadata JSON fields on `user_accounts` and `trades`

## Port plan

- current Node app: `3000`
- planned Python MT5 bridge: `3002`

## Migration rule

No existing `42trade` route, table, JSON shape, or cron contract should be broken during the MT5 bridge rollout.
