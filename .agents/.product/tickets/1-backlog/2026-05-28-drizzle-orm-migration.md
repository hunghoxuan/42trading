# Ticket: Migrate from raw `pg` queries to Drizzle ORM

## Status
- **IN PROGRESS** — Schema definition + query migration.

## Goal
Replace 296 raw `b.query()` SQL calls with Drizzle ORM. Same PostgreSQL backend. Type-safe queries. Foundation for future SQLite support.

## Scope

| What | Count | Plan |
|------|-------|------|
| Tables | 11 | Define Drizzle schemas |
| Raw SQL in `server.js` | 57 `b.query()` calls | Replace with Drizzle queries |
| Custom methods on `mt5Backend` | ~40 methods | Rewrap with Drizzle (keep same API) |
| PostgreSQL features (JSONB, ILIKE, `::cast`) | ~49 uses | Drizzle supports JSONB, `ilike`, casting |

## Tables to Migrate

| Table | Rows (approx) | Key columns |
|-------|---------------|-------------|
| `trades` | ~200 | `sid`, `symbol`, `entry`, `tp`, `sl`, `execution_status`, `pnl_realized`, `raw_json` (JSONB), `metadata` (JSONB) |
| `signals` | ~500 | `sid`, `symbol`, `action`, `status`, `metadata` (JSONB) |
| `logs` | ~5000 | `id`, `event_type`, `created_at`, `metadata` (JSONB) |
| `users` | ~5 | `id`, `name`, `email`, `role`, `metadata` (JSONB) |
| `user_accounts` | ~10 | `user_id`, `account_id`, `api_key_hash`, `metadata` (JSONB) |
| `user_settings` | ~20 | `user_id`, `type`, `name`, `data` (JSONB) |
| `user_templates` | ~10 | `user_id`, `id`, `name`, `config` (JSONB) |
| `market_data` | ~1000 | `symbol`, `timeframe`, `bars` (JSONB), `created_at` |
| `accounts` | (legacy) | `account_id`, `name`, `balance` |
| `ai_templates` | ~10 | `id`, `name`, `config` (JSONB) |
| `ui_auth_users` | ~5 | `email`, `password_hash`, `role` |

## Implementation Plan

### Phase 1 — Schema (1 file)
- [ ] Create `webhook/src/db/schema.js` — Drizzle schema for all 11 tables
- [ ] Create `webhook/src/db/index.js` — Drizzle instance (`drizzle(pool)`)
- [ ] Export typed `db` + schema objects

### Phase 2 — Custom methods (wrap existing API)
- [ ] Rewrite `mt5Backend` methods to use Drizzle internally
- [ ] Keep same method signatures — no API change to `server.js`
- [ ] Order: `listTradesV2`, `listSignals`, `upsertSignal`, `listUserAccounts`, `upsertUserAccount`, etc.

### Phase 3 — Raw queries in server.js (57 calls)
- [ ] Replace each `b.query(\`SELECT ...\`)` with Drizzle query builder
- [ ] Priority: CRUD operations first, complex JOINs last
- [ ] Use `db.select().from(schema.trades).where(eq(...))` pattern

### Phase 4 — Cleanup
- [ ] Remove old `pg` pool creation (keep pool for Drizzle)
- [ ] Verify all tests pass
- [ ] Remove dead code

## Example: Before / After

**Before (raw SQL):**
```js
const rows = await b.query(
  `SELECT sid, symbol, entry, tp, sl, execution_status
   FROM trades
   WHERE user_id = $1 AND execution_status = $2
   ORDER BY created_at DESC
   LIMIT $3 OFFSET $4`,
  [userId, status, limit, offset]
);
```

**After (Drizzle):**
```js
const rows = await db
  .select({
    sid: schema.trades.sid,
    symbol: schema.trades.symbol,
    entry: schema.trades.entry,
    tp: schema.trades.tp,
    sl: schema.trades.sl,
    executionStatus: schema.trades.executionStatus,
  })
  .from(schema.trades)
  .where(and(
    eq(schema.trades.userId, userId),
    eq(schema.trades.executionStatus, status)
  ))
  .orderBy(desc(schema.trades.createdAt))
  .limit(limit)
  .offset(offset);
```

## Affected Files
- `webhook/server.js` — 57 query replacements
- `webhook/mt5Backend.js` — PostgreSQL implementation → Drizzle
- New: `webhook/src/db/schema.js`, `webhook/src/db/index.js`
- `scripts/daemons/ctrader_*.js` — if they access DB directly

## Constraints
- Zero API change to `server.js` consumers
- All existing tests must pass
- JSONB columns preserved (Drizzle supports `jsonb()` type)
- Same PostgreSQL backend — no driver change
- Backward-compatible config

## Verification
- [ ] `node --check webhook/src/db/schema.js`
- [ ] All existing integration tests pass
- [ ] Trade create → read → update → delete cycle
- [ ] Signal create → ack → cancel cycle
- [ ] Dashboard query returns same results
- [ ] No new console errors
