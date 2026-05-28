# Drizzle ORM Migration — Progress Log

## Status: IN PROGRESS (Phase 1-2 done, Phase 3 started)

## Architecture

```
trading/
  db/                          ← shared DB package
    package.json               ← deps: drizzle-orm, pg
    schema.js                  ← 8 tables (mirrors actual DB)
    queries.js                 ← Drizzle query functions
    index.js                   ← initDb(pool), getDb()
  tests/
    db-queries.test.js         ← 9 tests (all passing)
  webhook/
    server.js                  ← Drizzle injected into mt5Backend (b.db, b.schema)
```

## DB Tables (8)

| Table | Schema Status | Notes |
|-------|--------------|-------|
| `users` | ✅ Mapped | |
| `user_accounts` | ✅ Mapped | |
| `user_templates` | ✅ Mapped | |
| `user_settings` | ✅ Mapped | |
| `signals` | ✅ Mapped | Matched to actual DB columns |
| `trades` | ✅ Mapped | Matched to actual DB columns |
| `logs` | ✅ Mapped | |
| `market_data` | ✅ Mapped | |

Dropped/legacy tables (not in schema): `accounts`, `ai_templates`, `ui_auth_users`, `signal_events`, `trade_events`

## Completed Queries

| Method | Drizzle | Tests | Matches raw SQL? |
|--------|---------|-------|-----------------|
| `listTradesV2` | ✅ `db/queries.js` | ✅ 5 tests | ✅ |
| `listSignals` | ✅ `db/queries.js` | ✅ 2 tests | ✅ |
| `listUserAccounts` | ✅ `db/queries.js` | ❌ | — |
| `upsertSignal` | ✅ `db/queries.js` | ❌ | — |
| `findAccountByApiKeyHash` | ✅ `db/queries.js` | ❌ | — |

## Remaining Methods to Migrate (~35 methods)

Priority order:

### 🔴 High (used frequently)
- [ ] `upsertUserAccount(userId, account)`
- [ ] `listUiUsers()`
- [ ] `deleteUserAccount(userId, accountId)`
- [ ] `updateTableRow(table, id, data)`
- [ ] `listTableRows(table, filters)`
- [ ] `getTableSchema(table)`
- [ ] `listAllEvents(filters)`
- [ ] `listActiveSignals()`
- [ ] `bulkAckSignals(ids)`
- [ ] `cancelSignalsByIds(ids)`
- [ ] `deleteSignalsByIds(ids)`
- [ ] `renewSignalsByIds(ids)`
- [ ] `pruneOldSignals(days)`

### 🟡 Medium (used occasionally)
- [ ] `updateTradeManualV2(tradeId, userId, payload)`
- [ ] `listAccounts()` (legacy)
- [ ] `upsertUiAuthUser(user)`
- [ ] `getUiAuthUser(email)`
- [ ] `getUiAuthUserByName(name)`
- [ ] `getUiAuthUserById(userId)`
- [ ] `deleteUiAuthUserById(userId)`
- [ ] `getStorageStats()`
- [ ] `storageCleanup(target)`
- [ ] `uiListCache()`
- [ ] `uiGetCacheDetail(key)`
- [ ] `uiDeleteCacheKey(key)`
- [ ] `getSignalByTicket(ticket)`
- [ ] `findSignalById(id)`
- [ ] `listSignals()` (already done)

### 🟢 Low (rarely used / legacy)
- [ ] `pullAndLockNextTask()`
- [ ] `log()`
- [ ] `isDirectory()`
- [ ] `slice()`, `join()`, `split()`

## Raw SQL Queries to Replace (57 in server.js)

Status: **0 of 57 done** — Drizzle available via `b.db` but no server.js queries migrated yet.

Migration strategy: start replacing `b.query(SQL, params)` with Drizzle equivalents in server.js route handlers. Priority: dashboard, trades list, signals list.

## Raw SQL Queries already abstracted (in mt5Backend methods)

These are the ~35 methods listed above that use `pool.query()` directly. Once migrated to Drizzle, they'll be available as `b.listTradesV2()`, `b.upsertSignal()`, etc. The server.js route handlers already call these methods, so no change needed in server.js.

## How to Add a New Query

1. Add function to `db/queries.js` — use `schema.*` columns, `eq()`, `and()`, `desc()`, etc.
2. Add test to `tests/db-queries.test.js` — verify against raw SQL count
3. Run: `node tests/db-queries.test.js`
4. Commit

## How to Use in server.js

```js
const b = await mt5Backend();
// Raw SQL (old):
const rows = await b.query("SELECT * FROM trades WHERE symbol = $1", ["XAUUSD"]);
// Drizzle (new) — use b.db:
const { listTradesV2 } = require("../db/queries");
const result = await listTradesV2(b.db, { symbol: "XAUUSD" });
```

## Test Command

```bash
node tests/db-queries.test.js
```

Current: 9 tests, all passing ✅
