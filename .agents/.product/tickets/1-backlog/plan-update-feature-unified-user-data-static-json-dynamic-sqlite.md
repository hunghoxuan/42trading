# Unified User Data Refactor — Static JSON + Dynamic SQLite

## Meta
- Ticket Type: `Update Feature`
- Ticket Status: `Plan`
- Owner: `Codex`
- Updated: `2026-06-08 00:30 UTC`

## Problem
Current storage is split inconsistently across project areas:
- user settings were recently moved from DB rows to JSON files under `data/{user_id}/settings/{type}/{name}.json`
- broker accounts and other user-scoped entities remain in DB tables such as `user_accounts`
- cache behavior is not consistently abstracted behind one BAL/DAL pattern
- DB source switching now affects some user-scoped entities but not file-backed settings, which can be confusing during local/VPS DB switching

Requested target direction:
1. **Static user-scoped data** should be stored in JSON files
2. **Frequent sync/update user-scoped data** should be stored in per-user SQLite:
   - `data/users/{user_id}/data.db`
3. Do not keep old entity-specific tables like `user_accounts` for the new dynamic model
4. Use a single generic table:
   - `user_data`
   - `object_type` (example: `user_accounts`)
   - `object_id` (example: `account_id`)
   - `metadata` JSON
5. Common BAL/DAL should:
   - write-through to memory + Redis when saving dynamic objects
   - read-through from memory + Redis before SQLite
6. API assembly layer should combine:
   - static JSON object data
   - dynamic Redis/SQLite object data

Goal: one consistent user-data architecture with clear static-vs-dynamic boundaries, common cache flow, and no hard dependency on entity-specific relational tables for dynamic user objects.

## Investigation
### Current state observed
- Settings API already reads/writes file-backed JSON under `data/{user_id}/settings/...`
- Broker accounts currently remain in DB and are updated from broker sync logic
- `POST /v2/broker/sync` can upsert account balance/status/metadata into `user_accounts`
- `StateRepo` already provides memory + Redis caching patterns for many domains
- Current backend still mixes direct DB entity reads with file-backed settings reads

### Architectural findings
- A generic object model can reduce schema churn for user-scoped runtime objects
- Per-user SQLite provides local durable dynamic storage without depending on central Postgres for those objects
- Static JSON + dynamic SQLite gives a cleaner separation than using JSON only for everything
- Combining static + dynamic fragments at the BAL layer is feasible, but object merge rules must be explicit

### Main design tradeoff
This proposal improves consistency across machine-local user data, but it also changes the persistence model significantly:
- dynamic user objects become machine-local unless replicated/synced separately
- DB source switching semantics change again because some entities stop living in Postgres entirely
- generic-table flexibility comes at the cost of weaker relational constraints and harder ad hoc SQL reporting

### AI decisions / assumptions that are not yet confirmed
1. **Assumption: `user_accounts` is the first entity to migrate into `user_data`**
   - Tradeoff: largest practical value because broker sync touches it now
   - Risk: can break account-dependent API and execution flows if merge rules are incomplete
2. **Assumption: static JSON and dynamic SQLite are both under `data/{user_id}/`**
   - Tradeoff: easy portability and per-user isolation
   - Risk: local/VPS divergence if multiple machines operate on the same logical user without sync policy
3. **Assumption: `metadata` JSON in `user_data` is the full dynamic payload for each object**
   - Tradeoff: flexible, schema-light
   - Risk: less validation and weaker field-level query ergonomics
4. **Assumption: Redis + memory cache should be authoritative only as cache, not source-of-truth**
   - Tradeoff: safe durability remains in SQLite
   - Risk: stale reads if invalidation/write-through is incomplete
5. **Assumption: API response assembly should be `static_json + dynamic_runtime`, with dynamic fields taking precedence on key collision**
   - Tradeoff: current runtime state wins
   - Risk: static config could be accidentally shadowed by noisy runtime metadata unless merge boundaries are explicit

## Solution
## Proposed architecture

### 1) Storage split
#### Static store
Confirmed path root:
- `data/users/{user_id}/`

Confirmed static object layout:
- `data/users/{user_id}/{object_type}/{object_id}.json`

Examples:
- `data/users/default/user_accounts/icmarkets-demo.json`
- `data/users/default/providers/openai.json`
- `data/users/default/profile/default.json`

Use for:
- user-edited configuration
- stable labels/defaults/flags/routing config
- provider setup
- account definition/config that should not change on every broker sync

#### Dynamic store
Confirmed path:
- `data/users/{user_id}/data.db`

SQLite table:
```sql
CREATE TABLE user_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  metadata TEXT NOT NULL,
  status TEXT DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, object_type, object_id)
);
```

Use for:
- frequent broker/runtime sync state
- live account state
- high-churn per-object metadata
- any user-scoped entity that changes often and should not rewrite static JSON constantly

### 2) BAL / DAL layers
#### DAL static
Responsibilities:
- read/write JSON object files
- path sanitization
- atomic writes
- list/get/upsert/delete by `(user_id, object_type, object_id)`

#### DAL dynamic
Responsibilities:
- open/create per-user SQLite `data.db`
- CRUD for `user_data`
- list/get/upsert/delete by `(user_id, object_type, object_id)`
- minimal indexes and migration bootstrap

#### DAL cache
Responsibilities:
- memory L1
- Redis L2
- unified key namespace example:
  - `USR:DYN:{user_id}:{object_type}:{object_id}`

#### BAL unified object service
Suggested methods:
- `getStaticObject(userId, objectType, objectId)`
- `upsertStaticObject(userId, objectType, objectId, data)`
- `getDynamicObject(userId, objectType, objectId)`
- `upsertDynamicObject(userId, objectType, objectId, metadata, status)`
- `getUnifiedObject(userId, objectType, objectId)`
- `listUnifiedObjects(userId, objectType)`
- `deleteUnifiedObject(userId, objectType, objectId)`

### 3) Cache policy
#### Dynamic writes
When saving to `user_data`:
1. write SQLite
2. write Redis cache
3. write memory cache

This keeps SQLite as durable truth and memory/Redis as read accelerators.

#### Dynamic reads
1. read memory cache
2. fallback Redis
3. fallback SQLite
4. repopulate Redis + memory

#### Static reads
- direct file read or optional cache depending on object size/frequency
- recommended: memory cache only, Redis optional

### 4) Unified object assembly
Confirmed default merge order:
```text
base = static JSON object
runtime = dynamic metadata object
unified = deepMerge(base, runtime)
```

Confirmed rule:
- API returns **flat merged object only**
- dynamic runtime fields override static fields on key collision
- frontend/UI must not need response-shape changes

### 5) Entity migration target candidates
#### First-wave candidate
- `user_accounts` only

#### Explicitly out of scope for first implementation
- `trades`
- `users` auth identity rows
- broader provider/profile migrations

Note:
- after `user_accounts` is verified stable, the same architecture may later be applied to `trades`

### 6) Suggested phased rollout
#### Phase 0 — design freeze
- confirm boundaries for static vs dynamic fields
- confirm cache invalidation policy
- confirm local/VPS multi-machine expectations
- confirm encryption policy for static secrets

#### Phase 1 — infrastructure
- add env routing flags, example:
  - `USER_STATIC_STORE=json`
  - `USER_DYNAMIC_STORE=sqlite`
  - `USER_STATIC_ROOT=data`
- create generic BAL/DAL modules
- add per-user SQLite bootstrap/migration helpers

#### Phase 2 — migrate broker accounts
- map existing `user_accounts` fields into static vs dynamic
- migrate read paths first behind BAL
- hard cutover (no dual-read mode)
- migrate writes
- then remove direct `user_accounts` dependencies where safe

#### Phase 3 — cache hardening
- write-through / read-through integration with Redis + memory
- add cache invalidation metrics/logging
- add health/admin diagnostics for object cache source hits

#### Phase 4 — API assembly migration
- account list/detail endpoints use unified object assembly
- verify no UI contract changes
- verify broker sync still updates only dynamic portion

#### Phase 5 — cleanup
- deprecate old entity-specific runtime table usage where approved
- keep compatibility bridges only as long as needed

## Expected Output / Verification
### Confirmed design decisions
- [x] Static JSON path pattern: `data/users/{user_id}/{object_type}/{object_id}.json`
- [x] API returns flat merged view only
- [x] Merge precedence: dynamic overrides static
- [x] First implementation scope: `user_accounts` only
- [x] Broker/provider secrets belong to static storage
- [x] One SQLite per user: `data/users/{user_id}/data.db`
- [x] Migration mode: hard cutover
- [x] Conflict resolution: SQLite wins over Redis/memory

### Required implementation checks
- [ ] CRUD tests for static JSON DAL
- [ ] CRUD tests for dynamic SQLite DAL
- [ ] cache hit/miss tests for memory + Redis + SQLite fallthrough
- [ ] broker account API read/write parity tests
- [ ] local restart + `/health`
- [ ] local account list/detail API verification
- [ ] verify cache invalidation after broker sync writes
- [ ] verify no UI contract regression

### Risk checks
- [ ] local/VPS divergence policy documented
- [ ] SQLite corruption recovery / backup plan documented
- [ ] concurrent write behavior defined for per-user DB access
- [ ] fallback behavior if Redis unavailable documented
- [ ] encryption-at-rest policy for static secrets documented

## Clarified Decisions + Remaining Open Item
### Confirmed by user
1. Static object path should be under a user folder root, using object type and object id in path
2. API must return flat merged object only because frontend contract must not change
3. Dynamic data wins on field collision
4. First implementation applies to `user_accounts` only; `trades` may follow later after validation
5. One SQLite per user
6. Hard cutover
7. SQLite wins over Redis/memory disagreement
8. Preferred root is `data/users/{user_id}`

### Remaining open item (AI recommendation included)
**Broker account field split for first migration**
Recommended default split:
- static JSON:
  - `account_id`
  - `name`
  - `broker_name`
  - `status` if it is user-edited administrative status
  - static labels/defaults/provider config
  - credentials/secrets (encrypted at rest)
- dynamic SQLite (`user_data.metadata`):
  - `balance`
  - `equity`
  - `margin`
  - `free_margin`
  - `leverage` if broker-sourced at runtime
  - sync timestamps
  - live broker metadata
  - symbol metrics
  - source caches / runtime state

Unless user objects, this split should be treated as approved recommendation for implementation planning.

## Recommended next step
Do **not** implement yet until the questions above are answered. This refactor changes:
- persistence boundaries
- cache flow
- API assembly semantics
- machine-local vs DB-switched behavior

Most of the contract is now locked. Only the field-level `user_accounts` split needs final sign-off before implementation starts.

## Handoff Prompt
Read:
- `.agents/.product/tickets/1-backlog/plan-update-feature-unified-user-data-static-json-dynamic-sqlite.md`
- `AI.md`
- `.agents/BOOTSTRAP.md`
- `.agents/rules/planning.md`
- `.agents/rules/safety.md`

Task:
Use the clarified storage contract to finalize the field-level `user_accounts` split and prepare implementation steps for static JSON + dynamic per-user SQLite under `data/users/{user_id}`.

Constraints:
- no UI contract changes unless explicitly approved
- keep one clear source-of-truth per subdomain
- preserve cache consistency rules
- document merge precedence and machine-local storage implications
- no implementation until storage contract is confirmed

Return:
- ticket name
- clarified architecture decisions
- unresolved risks
- approved implementation phases
