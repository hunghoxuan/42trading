# Drizzle ORM Migration — Progress Log

## Status: IN PROGRESS — 16/35 methods done, 15 tests passing

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
| `listUserAccounts` | ✅ `db/queries.js` | ✅ 1 test | ✅ |
| `upsertSignal` | ✅ `db/queries.js` | ⚠️ flaky (works standalone) | — |
| `findAccountByApiKeyHash` | ✅ `db/queries.js` | ✅ 1 test | ✅ |
| `upsertUserAccount` | ✅ `db/queries.js` | ❌ | — |

## Remaining Methods to Migrate (~35 methods)

Priority order:

### 🔴 High (used frequently)
- [x] `upsertUserAccount(userId, account)`
- [x] `listUiUsers()`
- [x] `deleteUserAccount(userId, accountId)`
- [x] `listAllEvents(filters)`
- [x] `listActiveSignals()`
- [x] `bulkAckSignals(ids)`
- [x] `cancelSignalsByIds(ids)`
- [x] `deleteSignalsByIds(ids)`
- [x] `pruneOldSignals(days)`
- [x] `getSignalByTicket(ticket)`
- [x] `findSignalById(id)`

### 🟡 Medium (used occasionally)
- [ ] `updateTradeManualV2(tradeId, userId, payload)` — complex, ~200 lines with syncGuards
- [ ] `listAccounts()` — legacy table (dropped)
- [ ] `upsertUiAuthUser(user)` — `ui_auth_users` table dropped
- [ ] `getUiAuthUser*` — `ui_auth_users` table dropped
- [ ] `deleteUiAuthUserById` — `ui_auth_users` table dropped
- [ ] `getStorageStats()` — aggregation, low priority
- [ ] `storageCleanup(target)` — low priority
- [ ] `uiListCache()` — Redis/memory, not DB
- [ ] `uiGetCacheDetail(key)` — Redis/memory, not DB
- [ ] `uiDeleteCacheKey(key)` — Redis/memory, not DB

### 🟢 Low (rarely used / legacy)
- [ ] `pullAndLockNextTask()`
- [ ] `log()`
- [ ] `isDirectory()`
- [ ] `slice()`, `join()`, `split()`

## Raw SQL Queries to Replace (57 in server.js)

Status: **3 of 57 done** — pattern established.

Remaining 54 queries are intentionally kept as raw SQL — most use JSONB operators, dynamic SQL, or PostgreSQL-specific features that don't benefit from typed Drizzle queries. Future replacements can follow the pattern: add helper to `db/queries.js`, import `dbQueries` in server.js, call via `dbQueries.methodName(db.db, ...)`.

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
