# Universal Store Design

## Goal

Introduce a compact, switchable data platform for multi-tenant features without exploding the schema into many domain tables.

The target design uses four universal tables:

- `object_entities`
- `object_links`
- `object_journal`
- `object_processes`

This supports:

- flexible entity CRUD
- tenant/user filtering
- global/tenant/module/user scoping
- public/private/internal visibility control
- links/graph traversal
- audit and financial journals
- background jobs, reminders, retries, and sync
- SQLite and Postgres through adapter-backed facades

## Two Approaches Considered

### Approach 1

Rename old `object_store` to `object_entities` and add the other three tables.

Pros:

- naming becomes aligned with the four-table model
- easier to explain the platform to new contributors

Cons:

- higher migration risk
- touches existing legacy object-store code paths
- needs a harder cut-over

### Approach 2

Keep the legacy `object_store` as-is and add a new universal-store layer using:

- `object_entities`
- `object_links`
- `object_journal`
- `object_processes`

Pros:

- lower risk
- legacy modules can continue to run during migration
- 42Pay can be migrated independently

Cons:

- temporary duplication during transition

## Recommended Implementation

Use **Approach 2** first.

That is what the current implementation does:

- legacy object-store code remains available for migrations
- new universal-store code writes to the new four-table schema
- 42Pay storage is moved onto the universal-store facade

## Table Roles

### `object_entities`

Current state and flexible entity payloads.

Use for:

- products
- offers
- orders as current records
- user accounts / wallets
- LMS courses, lessons, enrollments
- CMS pages, posts, menus
- marketplace listings
- trip requests / trips
- calendar bookings / appointments

Core fields:

- `tenant_id`
- `entity_type`
- `entity_key`
- `scope_type`
- `scope_tenant_id`
- `scope_module`
- `scope_user_id`
- `visibility`
- `access_level`
- `user_id`
- `owner_id`
- `owner_team_id`
- `title`
- `subtitle`
- `status`
- `state`
- `category`
- `subtype`
- `priority`
- `lang`
- `locale`
- `country_code`
- `sort_order`
- `currency`
- `amount`
- `quantity`
- `price`
- `balance`
- `image_url`
- `icon`
- `source_system`
- `source_id`
- `sync_status`
- `scheduled_at`
- `due_at`
- `effective_from`
- `effective_to`
- `published_at`
- `archived_at`
- `search_text`
- `meta`
- `data`

Suggested row example:

```json
{
  "tenant_id": "demo",
  "entity_type": "user_account",
  "entity_key": "wallet:user_demo",
  "scope_type": "USER",
  "scope_tenant_id": "demo",
  "scope_module": "wallet",
  "scope_user_id": "user_demo",
  "visibility": "PRIVATE",
  "access_level": "OWNER_ONLY",
  "user_id": "user_demo",
  "owner_id": "user_demo",
  "owner_team_id": null,
  "title": "Main USD Wallet",
  "status": "ACTIVE",
  "state": "open",
  "category": "wallet",
  "subtype": "cash",
  "currency": "USD",
  "balance": 1200,
  "lang": "",
  "locale": "en-US",
  "sort_order": 0,
  "search_text": "wallet user_demo usd main",
  "data": {
    "account_type": "wallet",
    "ledger_type": "cash"
  }
}
```

### `object_entities v2` Governance

`object_entities` now treats scope and visibility as first-class indexed columns, not JSON-only metadata.

Recommended meaning:

- `scope_type`
  - `GLOBAL`
  - `TENANT`
  - `MODULE`
  - `USER`
  - `TEAM`
- `visibility`
  - `PRIVATE`
  - `INTERNAL`
  - `TENANT`
  - `PUBLIC`
  - `UNLISTED`
- `access_level`
  - `OWNER_ONLY`
  - `TEAM_ONLY`
  - `TENANT_READ`
  - `TENANT_WRITE`
  - `PUBLIC_READ`

Precedence rule for overrides:

- `USER > MODULE > TENANT > GLOBAL`

This is enough to support:

- global templates overridden by tenants
- tenant defaults overridden by module records
- user-private drafts and wallets
- public catalog/listing rows with private admin drafts

Recommended account conventions:

- user profile/account identity -> `entity_type = user`
- wallet/cash/margin/points account -> `entity_type = user_account`
- wallet key format -> `wallet:{currency}:{user_id}` or `wallet:{ledger_type}:{user_id}`
- current balance snapshot -> `object_entities.data`
- authoritative balance history -> `object_journal`

### `object_links`

Graph and ownership edges.

Use for:

- user owns wallet
- seller owns listing
- product linked to offer
- course linked to lesson
- trip assigned to driver
- remote trade maps to internal trade

Suggested row example:

```json
{
  "tenant_id": "demo",
  "from_entity_id": "ent_wallet_user_demo",
  "to_entity_id": "ent_reminder_wallet_low",
  "from_type": "user_account",
  "to_type": "reminder_rule",
  "link_type": "has_reminder",
  "user_id": "user_demo",
  "status": "ACTIVE",
  "data": {
    "channel": "email"
  }
}
```

### `object_journal`

Append-only history.

Use for:

- wallet debits/credits
- payment lifecycle
- order lifecycle
- sync events
- audit trail
- booking status changes
- reminder delivery history

Suggested row example:

```json
{
  "tenant_id": "demo",
  "entity_id": "ent_wallet_user_demo",
  "entity_type": "user_account",
  "entity_key": "wallet:user_demo",
  "user_id": "user_demo",
  "entry_type": "wallet.debit",
  "direction": "debit",
  "amount": 49.99,
  "currency": "USD",
  "data": {
    "reason": "order payment",
    "order_sid": "ORD_123"
  }
}
```

### `object_processes`

Scheduled and async work.

Use for:

- sync pull/push jobs
- retry queues
- booking reminders
- publish/unpublish schedules
- webhook delivery
- settlement jobs

Suggested row example:

```json
{
  "tenant_id": "demo",
  "process_type": "reminder",
  "topic": "wallet.low_balance",
  "entity_id": "ent_wallet_user_demo",
  "entity_type": "user_account",
  "entity_key": "wallet:user_demo",
  "user_id": "user_demo",
  "status": "PENDING",
  "priority": 5,
  "attempt_count": 0,
  "max_attempts": 10,
  "payload": {
    "threshold": 100
  },
  "result": {}
}
```

## Adapter Pattern

The universal-store layer uses an adapter/facade split:

- adapters encapsulate SQLite/Postgres specifics
- `UniversalStoreFacade` provides a shared API

Current implementation:

- `src/api/shared/universal-store/adapterFactory.js`
- `src/api/shared/universal-store/facade.js`
- `src/api/shared/universal-store/service.js`

## API Surface

The facade and service support:

- entity CRUD
- entity listing with tenant/user/type/status/search/sort filters
- link CRUD
- user link lookup
- journal append/list
- user journal lookup
- process upsert/list

This is the base API for higher-level modules.

### HTTP Endpoints

The server exposes the universal-store service through:

- `GET /api/v2/universal-store/entities`
- `POST /api/v2/universal-store/entities`
- `GET /api/v2/universal-store/entities/:tenantId/:entityType/:entityKey`
- `PUT /api/v2/universal-store/entities/:tenantId/:entityType/:entityKey`
- `DELETE /api/v2/universal-store/entities/:tenantId/:entityType/:entityKey`
- `GET /api/v2/universal-store/links`
- `POST /api/v2/universal-store/links`
- `DELETE /api/v2/universal-store/links/:id`
- `GET /api/v2/universal-store/journal`
- `POST /api/v2/universal-store/journal`
- `GET /api/v2/universal-store/processes`
- `POST /api/v2/universal-store/processes`
- `GET /api/v2/universal-store/users/:userId/links`
- `GET /api/v2/universal-store/users/:userId/journal`

Typical query support:

- tenant filter
- user filter
- owner filter
- entity type filter
- scope filter
- visibility filter
- module filter
- category/subtype filter
- link type filter
- status filter
- search text
- sort column and direction
- limit and offset

Typical write flows:

- `POST /api/v2/universal-store/entities`
- `PUT /api/v2/universal-store/entities/:tenantId/:entityType/:entityKey`
- `POST /api/v2/universal-store/links`
- `POST /api/v2/universal-store/journal`
- `POST /api/v2/universal-store/processes`

### Suggested Row Semantics

Use the tables like this:

- `object_entities`
  - latest state
  - one row per canonical object version-in-place
- `object_links`
  - graph/ownership/mapping edges
- `object_journal`
  - append-only history
  - payment movements
  - sync events
  - audit entries
- `object_processes`
  - queue jobs
  - retry jobs
  - reminders
  - scheduled tasks
  - reconciliation jobs

### Sync Mapping Example

For a remote `ctrader` position synced to an internal trade:

- `object_entities`
  - `entity_type = remote_trade`
  - `entity_type = trade`
- `object_links`
  - `remote_trade --maps_to--> trade`
- `object_journal`
  - `sync.pull.received`
  - `sync.apply.updated`
  - `trade.reconciled`
- `object_processes`
  - `sync_pull`
  - `sync_push`
  - `sync_reconcile`

## 42Pay Mapping

42Pay now maps its record families into `object_entities`:

- `42pay_products`
- `42pay_product_offers`
- `42pay_product_orders`
- `42pay_wallet_topups`
- `42pay_users`
- `user_account` for 42Pay wallets

Wallet storage is now split by concern:

- wallet identity and current balance snapshot -> `object_entities`
- user owns wallet -> `object_links`
- topups and settlement movements -> `object_journal`
- topup record rows for UI/business history -> `42pay_wallet_topups`

The optional legacy account adapter can still be attached as a compatibility mirror, but the canonical 42Pay wallet state now lives in the universal-store tables.

### 42Pay Service Boundary

42Pay now has:

- storage/repo: `src/api/modules/42pay/repo.js`
- module service: `src/api/modules/42pay/service.js`
- HTTP handler mapping: `src/api/modules/42pay/httpHandlers.js`

The service keeps the HTTP layer decoupled from storage details while the repo owns persistence rules.

Current 42Pay entity mapping:

- products -> `entity_type = 42pay_products`
- offers -> `entity_type = 42pay_product_offers`
- orders -> `entity_type = 42pay_product_orders`
- topups -> `entity_type = 42pay_wallet_topups`
- user profile -> `entity_type = 42pay_users`
- wallet -> `entity_type = user_account`, `entity_key = wallet:usd:{user_id}`

Current 42Pay wallet journal mapping:

- opening balance -> `entry_type = wallet.opening_balance`
- buyer topup -> `entry_type = wallet.topup`
- buyer purchase -> `entry_type = wallet.order_debit`
- seller settlement -> `entry_type = wallet.order_credit`

## SQLite / Postgres

Both backends are supported through the same facade.

Setup/application path:

- app startup calls `initDb()` and `migrateDb()` from `src/db/provider.js`
- SQLite applies `src/db/migrations/sqlite/0002_universal_store.sql`
- Postgres applies `src/db/migrations/postgres/0002_universal_store.sql`
- the universal-store adapter bootstrap also runs `CREATE INDEX IF NOT EXISTS ...` for the universal tables so older existing databases self-heal on first boot after upgrade

That means the promoted universal-store indexes are now part of normal setup for both SQLite and Postgres, not a manual one-off DBA step.

Schema files:

- `src/db/migrations/sqlite/0002_universal_store.sql`
- `src/db/migrations/postgres/0002_universal_store.sql`

Drizzle schema entries:

- `src/db/schema.sqlite.js`
- `src/db/schema.pg.js`

Demo SQLite artifact:

- `.local/universal-store-demo.sqlite`

Self-test entrypoint:

- `src/api/shared/universal-store/selftest.js`
- `src/api/modules/42pay/selftest.js`

Run with:

```bash
node src/api/shared/universal-store/selftest.js
node src/api/modules/42pay/selftest.js
```

Current secondary index coverage includes:

- `object_entities`
  - parent traversal
  - status/state filtering
  - language/locale publishing queries
  - scope-user filtering
  - currency/country reporting
- `object_links`
  - `from_entity_id + status`
  - `to_entity_id + status`
- `object_journal`
  - `entity_id + created_at`
  - `entry_type + created_at`
- `object_processes`
  - `process_type`
  - `topic`

## Why This Design

This keeps the platform compact while still handling:

- multi-tenant
- multi-language
- scope-aware data ownership
- public/private/internal visibility rules
- generic entities
- historical data
- schedules and reminders
- transactional events
- sync workflows

## Common Problems Covered

The promoted `object_entities v2` columns are designed to prevent the most common generic-store failures:

- scope collisions between global, tenant, module, and user rows
- accidental exposure of private rows
- weak tenant isolation
- ownership ambiguity between user/team/tenant/system
- draft vs published confusion
- time-window validity and scheduled activation
- hidden vs archived vs deleted lifecycle drift
- localization and regional overrides
- source sync dedupe and remote ID mapping
- poor filtering/search when key fields live only in JSON
- expensive dashboard queries over JSON-only price/status/category data

Specialized tables can still be added later if a domain becomes performance-critical, but they are not required to get broad product coverage now.

## Current Limits

This implementation intentionally keeps the schema compact. Later specialization may still be useful for:

- high-volume ledger/reporting
- aggressive geospatial workloads
- heavy slot-overlap scheduling
- chat/message at very large volume
- feed/ranking pipelines

Those would be optimizations on top of the platform core, not a replacement for it.
