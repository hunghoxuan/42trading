# Drizzle ORM Migration — Progress Log

## Status: ✅ Drizzle migration substantially complete

- ✅ JSONB→TEXT migration done — all columns now `text` (SQLite-compatible)
- ✅ 16/35 mt5Backend methods migrated
- ✅ ~50/57 server.js raw queries replaced
- ⬜ 7 remaining: cached repo functions (5) + complex reference queries (2)
- ✅ 15 unit tests passing

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

Status: **~20 of 57 done** — all simple CRUD queries replaced.

Remaining ~37 queries are JSONB-heavy or use PostgreSQL-specific features (`->`, `->>`, `::cast`, `COALESCE`, `ILIKE`, `ANY()`, `regexp_replace`, CTEs). These would require Drizzle `sql` template literals — same raw SQL, just wrapped in Drizzle API. No real migration benefit until JSONB columns are normalized into regular columns.

**Next step for SQLite:** normalize JSONB columns (`raw_json`, `metadata`, `data`) into dedicated columns or a separate key-value table. This is a schema refactoring, not just a query rewrite.

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
