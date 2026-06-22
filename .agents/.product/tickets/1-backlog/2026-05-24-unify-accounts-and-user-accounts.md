# Cleanup: Unify `accounts` and `user_accounts`

## Meta
- Ticket Type: `Cleanup / DB consistency`
- Ticket Status: `Open`
- Severity: `P1`
- Owner: `Codex`
- Updated: `2026-05-24`

## Problem
The database currently contains both `accounts` and `user_accounts` tables.
They represent nearly the same business concept: user-owned broker/execution accounts.

This creates confusion and risk:
- duplicate source-of-truth candidates
- migration/backfill logic still required at runtime
- schema drift between runtime ORM and actual DB
- future bugs from writing one table and reading the other

## Findings

### 1) Runtime already treats `user_accounts` as canonical
Current app/backend reads and writes primarily use `user_accounts`:
- list accounts
- get account by id
- upsert/delete account
- trade foreign keys reference `user_accounts`

### 2) `accounts` is explicitly treated as legacy
In `webhook/server.js`, there is a compatibility migration block that:
- checks if legacy `accounts` exists
- inserts/backfills rows into `user_accounts`
- updates `user_accounts` on conflict

The code comment explicitly describes `accounts` as a legacy source.

### 3) The two tables are near-duplicates
From current SQL dump, both tables hold overlapping account fields such as:
- `account_id`
- `user_id`
- `name`
- `balance`
- `status`
- `metadata`
- `api_key_hash`
- `api_key_last4`
- `api_key_rotated_at`
- `source_ids_cache`
- `equity`
- `margin`
- `free_margin`
- `leverage`
- `broker_name`

### 4) ORM/schema drift exists
`src/db/schema.js` defines `user_accounts`, but it is missing fields that exist in SQL dump / real table:
- `equity`
- `margin`
- `free_margin`
- `leverage`
- `broker_name`

So there are two related issues:
1. duplicate tables
2. incomplete schema definition for the canonical table

## Root Cause
Historical evolution:
- old system used `accounts`
- new ownership/account model moved toward `user_accounts`
- compatibility backfill was added
- cleanup/consolidation was never fully finished

## Goal
Make `user_accounts` the single canonical account table and remove dependency on legacy `accounts`.

## Detailed Solution

### Phase 1 — Audit
- Search entire repo for all reads/writes to `accounts`
- classify each usage:
  - active runtime dependency
  - migration-only compatibility path
  - docs/examples only

### Phase 2 — Canonical schema alignment
Update `src/db/schema.js` so `user_accounts` matches actual DB contract, including at least:
- `equity`
- `margin`
- `free_margin`
- `leverage`
- `broker_name`

If additional real columns exist, align them too.

### Phase 3 — Data migration hardening
Ensure one-time or idempotent migration from `accounts` -> `user_accounts` covers all required fields, including the account metrics above.

Verify:
- row counts
- account_id parity
- no important field loss

### Phase 4 — Runtime cutover
Remove all non-essential runtime dependence on `accounts`.

Keep only one of these approaches:
- temporary explicit migration script, or
- startup compatibility shim with clear removal plan

Preferred end state:
- no normal runtime logic depends on `accounts`
- only `user_accounts` is queried by app logic

### Phase 5 — Remove / deprecate legacy table
After verification:
- remove compatibility backfill block from `webhook/server.js`
- add migration note for dropping `accounts`
- optionally create DB migration SQL to:
  - archive/drop `accounts`
  - keep rollback note

## Acceptance Criteria
- [ ] All active runtime account logic uses only `user_accounts`
- [ ] `src/db/schema.js` matches actual `user_accounts` DB shape
- [ ] All legacy `accounts` rows are safely migrated to `user_accounts`
- [ ] No app feature requires `accounts` to function
- [ ] Compatibility/backfill logic is either removed or isolated with a removal note
- [ ] Docs/examples no longer present `accounts` as a live primary table
- [ ] If `accounts` is dropped, rollback steps are documented

## Validation Plan
1. Search repo for `accounts` vs `user_accounts` usage
2. Compare row counts and sample rows in DB
3. Verify account UI/API still works
4. Verify trade/account joins still work
5. Run diagnostics/build/tests relevant to DB access layer

## Impacted Areas
- `webhook/server.js`
- `src/db/schema.js`
- any DB migration/bootstrap SQL
- account-related docs / scripts / tests

## Risk
Moderate:
- account ownership/auth logic is sensitive
- dropping legacy compatibility too early could hide data from older installs

## Recommendation
Treat this as a structured cleanup, not an opportunistic refactor.
Do schema alignment first, then cut over runtime, then remove legacy table support.