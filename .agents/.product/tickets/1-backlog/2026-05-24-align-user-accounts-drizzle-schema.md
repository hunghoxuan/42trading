# Fix Schema Drift: Align `db/schema.js` `user_accounts` with real DB table

## Meta
- Ticket Type: `Fix bug / schema alignment`
- Ticket Status: `Open`
- Severity: `P1`
- Owner: `Codex`
- Updated: `2026-05-24`
- Related:
  - `1-backlog/2026-05-24-unify-accounts-and-user-accounts.md`

## Problem
`db/schema.js` defines `user_accounts`, but the runtime/real SQL table contains additional columns that are not represented in the Drizzle schema.

This creates ORM/schema drift and increases risk for:
- incomplete query results
- wrong assumptions in future migrations
- silent omission of account metrics in new code
- inconsistent type contract across DB layers

## Current Drift Found
Real SQL `user_accounts` includes fields that are missing in `db/schema.js`:
- `equity`
- `margin`
- `free_margin`
- `leverage`
- `broker_name`

Potentially other differences should be audited as part of implementation.

## Goal
Make `db/schema.js` accurately reflect the actual `user_accounts` table used by the live app/runtime.

## Detailed Solution

### 1) Audit actual DB contract
Compare these sources:
- `db/schema/mt5_schema.sql`
- `webhook/server.js` bootstrap table creation
- `db/schema.js`

Confirm exact live `user_accounts` shape and field types.

### 2) Update Drizzle schema
Extend `userAccounts` in `db/schema.js` to include missing fields with correct types.

Expected additions at minimum:
- `equity`
- `margin`
- `freeMargin`
- `leverage`
- `brokerName`

Naming should follow existing camelCase JS mapping pattern.

### 3) Verify no conflicting assumptions
Search for all `userAccounts` consumers and confirm:
- no naming collision
- no broken destructuring
- no assumptions that schema is intentionally minimal

### 4) Optional follow-up
If `accounts` legacy table is still present, do not solve that here.
This ticket is schema alignment only.

## Acceptance Criteria
- [ ] `db/schema.js` `userAccounts` includes all real live columns needed from `user_accounts`
- [ ] Types match DB semantics closely enough for Drizzle queries
- [ ] No diagnostics/errors introduced
- [ ] Existing DB code still imports and runs correctly
- [ ] Any drift still left is documented explicitly in ticket notes

## Validation Plan
1. Compare SQL dump vs Drizzle schema field-by-field
2. Run syntax/diagnostics on `db/schema.js`
3. Run any DB query tests if available
4. Smoke-check any account query path that uses Drizzle schema

## Impacted Files
- `db/schema.js`
- optionally docs if schema contract is documented elsewhere

## Risk
Low to moderate:
- isolated schema file change
- but can affect future typed queries and runtime assumptions if done incorrectly

## Recommendation
Implement this first before larger `accounts` vs `user_accounts` consolidation work. It is small, safe, and reduces ambiguity for follow-up cleanup.