# FEAT-20260611 MT5 bridge Python migration plan

## Goal

Introduce a dedicated Python MT5 adapter into `42trade` without changing existing Node behavior or current external contracts.

## Scope

In scope:
- rename `bridge-clients` to `src/mt5-bridge-clients`
- scaffold `src/mt5-bridge-python` on port `3002`
- map ChronosTrade MT5 bridge concepts onto `42trade`
- define additive DB/JSON extension strategy
- define route compatibility plan

Out of scope:
- replacing `src/api/server.js`
- moving UI/web features
- rewriting existing cron/snapshot/AI flows in Python
- breaking current EA/cTrader/webhook contracts

## Findings

### ChronosTrade MT5 focus
- Python bridge is an adapter, not the main backend
- typed local endpoints separate read operations from execution commands
- market-data sync jobs are MT5-specific and scheduler-driven

### 42trade MT5 focus
- Node already owns broker pull/ack/sync lifecycle
- Node already has market-data cron and bars ingestion
- EA/cTrader clients already integrate directly with Node

## Route mapping

### ChronosTrade Python bridge -> 42trade existing Node equivalents
- `/bridge/account/readiness` -> no exact public equivalent; closest future fit is a new internal readiness proxy under Node
- `/bridge/account/summary` -> partial overlap with `/mt5/dashboard/summary`
- `/bridge/account/positions` -> partial overlap with `/v2/trades` plus broker sync payloads
- `/bridge/account/orders` -> partial overlap with pending trade views in `/v2/trades`
- `/bridge/account/deals` -> partial overlap with closed trade state in `/v2/trades`
- `/bridge/market/quote` -> partial overlap with `/v2/broker/prices` cache consumers
- `/bridge/command/open-market` -> maps conceptually to Node trade dispatch + broker ack flow
- `/bridge/command/place-pending` -> maps conceptually to Node leased task open flow with order type
- `/bridge/command/close-position` -> maps to close/cancel trade actions in Node
- `/bridge/command/modify-position` -> maps to modify dispatch path in Node
- `/bridge/command/cancel-order` -> maps to cancel dispatch path in Node

### 42trade routes that must stay stable
- `/v2/broker/pull`
- `/v2/broker/ack`
- `/v2/broker/prices`
- `/v2/broker/prices-sync`
- `/v2/broker/bars`
- `/v2/broker/sync`
- `/v2/broker/reconcile`
- `/mt5/ea/pull`
- `/mt5/ea/ack`
- `/mt5/ea/heartbeat`
- `/mt5/ea/log-v2`

## DB mapping

### ChronosTrade concepts worth mapping into current 42trade
- account readiness snapshot -> `user_accounts.metadata`
- terminal/account execution blockers -> `user_accounts.metadata`
- broker order/position/deal raw payloads -> `trades.metadata`
- bridge execution failure classification -> `trades.metadata` or new append-only event table later
- bridge sync run audit -> new additive table later if needed

### Do not change existing 42trade structures
- `users`
- `user_accounts`
- `trades`
- current JSON settings files
- current cron object format

## Delivery order

1. Scaffold Python bridge and keep it local-only.
2. Add Node health visibility for Python bridge reachability.
3. Add a Node internal client for `src/mt5-bridge-python`.
4. Add optional feature flag to proxy selected MT5 execution/readiness calls from Node to Python.
5. Add readiness snapshot endpoint and diagnostics.
6. Only after that, evaluate whether any MT5-specific sync job should move from Node to Python.

## First feature to copy from ChronosTrade

Copy first:
- account readiness and execution blocker model
- typed command adapter boundary

Copy later:
- command execution transport
- optional raw MT5 summary/positions/orders/deals snapshots

Do not copy first:
- startup historical sync
- scheduler-based candle fetch
- full ChronosTrade trading workspace model

## Acceptance criteria

- existing Node routes keep working unchanged
- existing EA/cTrader clients keep working unchanged
- Python bridge can run independently on `3002`
- architecture clearly states Node remains source of truth
