# Ticket: Multi-Backend Storage — SQLite / PostgreSQL / File-Based Adapter

## Status
- **IDEA** — Design phase.

## Goal
Support 3 storage backends via a unified adapter interface, so the system can run on SQLite (local dev), PostgreSQL (production), or pure file-based storage (no DB dependency).

## Architecture

```
┌─────────────────────────────────┐
│         Business Logic          │
│  (server.js, bridge, scripts)   │
└──────────────┬──────────────────┘
               │  uses
┌──────────────▼──────────────────┐
│       Storage Interface         │
│  (abstract contract)            │
│  - query(sql, params)           │
│  - insert(table, record)        │
│  - update(table, id, patch)     │
│  - delete(table, id)            │
│  - list(table, filters)         │
│  - upsert(table, record)        │
│  - transaction(fn)              │
│  - health()                     │
└──────┬────────┬────────┬────────┘
       │        │        │
┌──────▼──┐ ┌──▼────┐ ┌─▼──────────┐
│PostgreSQL│ │SQLite │ │ File-Based  │
│ Adapter  │ │Adapter│ │  Adapter    │
└──────────┘ └───────┘ └────────────┘
```

## Storage Interface (Contract)

```js
class StorageAdapter {
  async query(sql, params)           // raw SQL (required)
  async list(table, filters)         // SELECT with optional WHERE
  async get(table, id)               // single row by id
  async insert(table, record)        // INSERT
  async update(table, id, patch)     // UPDATE
  async upsert(table, record, conflictKey) // INSERT ON CONFLICT
  async delete(table, id)            // DELETE
  async transaction(fn)              // atomic batch
  async health()                     // { ok, backend, latency_ms }
  async migrate(schema)              // run DDL
}
```

## Adapters

### 1. PostgreSQL Adapter
- Uses `pg` (node-postgres)
- Parameterized queries (`$1`, `$2`)
- Connection pool with configurable min/max
- Migrations via SQL files
- Current implementation (already exists, needs formal interface)

### 2. SQLite Adapter
- Uses `better-sqlite3` (sync) or `sql.js` (WASM, zero native deps)
- Single-file database, no server process
- Parameterized queries (`?`)
- Migrations via SQL files (same schema, SQLite-compatible DDL)
- Ideal for: local dev, single-user deployments, embedded use

### 3. File-Based Adapter
- **No database process.** Entirely disk-based.
- Folder structure mirrors tables:
  ```
  data/
    trades/
      PENDING/           ← sub-folder = status
        TFHYJL5X8.json   ← one record per file
        TFI20028M.json
      FILLED/
        TF91C0MXC.md     ← can be .md (human-readable) or .json
      CLOSED/
        TFXX12345.json
    users/
      default.json
      admin.json
    settings/
      WATCHLIST.json
      AI_MODELS.json
  ```
- Each record = one file (`.json` or `.md`)
- Status-based sub-folders for tables with `execution_status` column
- `list()` = `fs.readdirSync` + `JSON.parse` on matching files
- `insert()` = `fs.writeFileSync(path, JSON.stringify(record))`
- `update()` = read → merge → write
- `delete()` = move to `data/.trash/` (soft delete) or `fs.unlinkSync`
- `query()` = limited SQL subset parsing or fallback to list/filter
- `transaction()` = write to temp folder → atomic rename

## Implementation Plan

### Phase 1 — Interface + Adapter Registry
- [ ] Define `StorageAdapter` interface (abstract class or JSDoc contract)
- [ ] Create `AdapterRegistry` — loads adapter by config:
  ```js
  { storage: { backend: "postgres" | "sqlite" | "file", ... }
  ```
- [ ] All current `mt5Backend()` calls route through registry

### Phase 2 — PostgreSQL Adapter (formalize existing)
- [ ] Wrap existing `pg` calls behind the interface
- [ ] Add `health()` with latency check
- [ ] Add `migrate(schema)` function

### Phase 3 — SQLite Adapter
- [ ] Install `better-sqlite3`
- [ ] Implement all interface methods
- [ ] Write SQLite-compatible migrations (same schema, different DDL syntax where needed)
- [ ] Test with local dev setup

### Phase 4 — File-Based Adapter
- [ ] Implement folder-based CRUD
- [ ] JSON file format: `{ id, data: {...}, created_at, updated_at }`
- [ ] MD file format (optional): YAML frontmatter + markdown body
- [ ] Status-based sub-folder routing for `trades`, `signals` tables
- [ ] Search via `fs.readdirSync` + filter (no SQL parsing needed initially)
- [ ] `transaction()` via atomic folder rename

### Phase 5 — Migration Tool
- [ ] Export from one backend → import to another
- [ ] `scripts/storage/migrate.js --from postgres --to file`
- [ ] Schema diff checker

## Config

```json
{
  "storage": {
    "backend": "sqlite",
    "postgres": {
      "host": "127.0.0.1",
      "port": 5432,
      "database": "trading",
      "user": "macmini",
      "pool": { "min": 2, "max": 10 }
    },
    "sqlite": {
      "path": "data/trading.db"
    },
    "file": {
      "root": "data",
      "format": "json",
      "soft_delete": true
    }
  }
}
```

## Affected Files
- `webhook/server.js` — all `mt5Backend()` call sites
- `webhook/mt5Backend.js` — PostgreSQL implementation
- `webhook/syncGuards.js` — DB access
- `scripts/daemons/ctrader_downstream_server.js`
- `scripts/daemons/ctrader_executor_bridge.js`
- `scripts/test/syncGuards.test.mjs`
- New: `storage/adapter.js`, `storage/postgres.js`, `storage/sqlite.js`, `storage/file.js`, `storage/registry.js`

## Constraints
- PostgreSQL adapter must pass all existing tests
- SQLite must use same table schemas (DDL differences handled in adapter)
- File adapter must survive process crashes (atomic writes)
- No breaking API changes to `server.js` consumer code
- Backward-compatible config format

## Verification
- [ ] All existing tests pass with PostgreSQL adapter
- [ ] Same tests pass with SQLite adapter (shared test suite)
- [ ] File adapter: insert → read → update → delete cycle
- [ ] File adapter: list with filters (status, date range)
- [ ] File adapter: concurrent writes don't corrupt data
- [ ] Migration: PostgreSQL → SQLite → File round-trip preserves all data
- [ ] `health()` returns `{ ok: true, backend: "sqlite" }` for each adapter
