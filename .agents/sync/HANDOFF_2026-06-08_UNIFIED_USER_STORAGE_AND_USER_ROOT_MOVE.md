# Handoff — 2026-06-08: Unified `user_accounts` storage + `data/users/{user_id}` root move

## Scope completed
Two related backend/storage tasks were completed locally:

1. **First-wave unified storage for `user_accounts` only**
   - static JSON: `data/users/{user_id}/user_accounts/{account_id}.json`
   - dynamic SQLite: `data/users/{user_id}/data.db` table `user_data`
   - cache policy implemented:
     - read: `memory -> redis -> sqlite`
     - write: `sqlite -> redis -> memory`
   - API output kept flat/compatible
   - UI contract kept unchanged

2. **Root move for existing user-scoped folders**
   - moved logic from `data/{user_id}/...`
   - to `data/users/{user_id}/...`
   - covered folders:
     - `settings`
     - `trade_active`
     - `trade_closed`
     - `trade_files`

## Files changed
### New
- `webhook/userObjectStore.js`
- `scripts/migrate/migrate_user_accounts_unified_storage.mjs`
- `.agents/sync/HANDOFF_2026-06-08_UNIFIED_USER_STORAGE_AND_USER_ROOT_MOVE.md`

### Updated
- `webhook/server.js`
- `webhook/settingsStore.js`
- `scripts/ops/cleanup_stale_trade_active_dirs.sh`

## What changed exactly
### A. `user_accounts` storage
- Added common BAL/DAL in `webhook/userObjectStore.js`
- `webhook/server.js` account paths now use unified store for:
  - account list/read
  - account create/update/archive
  - UI user account CRUD
  - account API-key lookup/rotate/revoke/update
  - broker sync / broker heartbeat runtime account updates
- Kept a **temporary legacy Postgres shadow write** for `user_accounts`
  - purpose: avoid breaking non-migrated `trades` / FK/runtime assumptions
  - important: **accounts are read from unified storage now**, not from legacy table

### B. Static vs dynamic split used for `user_accounts`
#### Static JSON
- `account_id`
- `user_id`
- `name`
- `broker_name`
- admin/user-edited `status`
- `api_key_hash`
- `api_key_last4`
- `api_key_rotated_at`
- static account metadata

#### Dynamic SQLite `user_data.metadata`
- `balance`
- `equity`
- `margin`
- `free_margin`
- `leverage`
- `source_ids_cache`
- `symbol_metrics`
- `provider_code`
- `build_version`
- `health_updated_at`
- runtime/broker metadata

### C. User-scoped root move
#### Code paths changed
- `webhook/settingsStore.js`
  - from `data/{user_id}/settings/...`
  - to `data/users/{user_id}/settings/...`
- `webhook/server.js`
  - trade roots now use:
    - `data/users/{user_id}/trade_active`
    - `data/users/{user_id}/trade_closed`
    - `data/users/{user_id}/trade_files`
- `scripts/ops/cleanup_stale_trade_active_dirs.sh`
  - updated to `data/users/default/...`

#### Local data moved
Moved existing local folders:
- `data/default/settings` -> `data/users/default/settings`
- `data/default/trade_active` -> `data/users/default/trade_active`
- `data/default/trade_closed` -> `data/users/default/trade_closed`
- `data/default/trade_files` -> `data/users/default/trade_files`

Then cleaned legacy empty root:
- `data/default` removed locally

## Important non-changes
### Trades
- **No trades migration was done**
- **No trades storage split was done**
- **No trades schema migration was done**
- only trade **folder root paths** changed to `data/users/{user_id}/...`

### UI
- no frontend contract change intended
- no UI logic migration intended

## Validation completed
### Diagnostics
- `webhook/server.js` ✅
- `webhook/userObjectStore.js` ✅
- `scripts/migrate/migrate_user_accounts_unified_storage.mjs` ✅
- `webhook/settingsStore.js` ✅
- `scripts/ops/cleanup_stale_trade_active_dirs.sh` ✅

### Required webhook recovery flow
- `rtk bash scripts/start/reset_stack_once.sh` ✅
- `rtk bash scripts/test/verify_webhook_local.sh` ✅

### Local API checks
- `/health` ✅
- `/v2/accounts` ✅
- `/auth/me` ✅
- `/v2/settings` ✅

### Cache verification
Direct store test confirmed:
- write path: `sqlite -> redis -> memory` ✅
- read path: `memory -> redis -> sqlite` ✅
- sqlite re-populates redis + memory ✅

### Path verification
Direct module/runtime checks confirmed:
- `data/users/default/data.db` exists ✅
- `data/users/default/settings` exists ✅
- `data/users/default/trade_active` exists ✅
- `data/users/default/trade_closed` exists ✅
- `data/users/default/trade_files` exists ✅
- `data/users/default/user_accounts` exists ✅
- legacy `data/default` removed locally ✅

## Known caveats / risks
1. **Legacy Postgres `user_accounts` shadow still exists**
   - intentional temporary compatibility bridge
   - remove later only when `trades` no longer depends on it

2. **Standalone migration script needs DB env in terminal**
   - `scripts/migrate/migrate_user_accounts_unified_storage.mjs`
   - app boot migration still works from runtime env path

3. **`rtk` wrapper shows local conda noise**
   - `CondaError: Run 'conda init' before 'conda activate'`
   - scripts still executed and passed

4. **Launchctl local service may run from a slightly different runtime context than direct file-tool view**
   - direct Node/module verification was used to prove the checked-in code writes under `data/users/...`

## What's next
### Highest priority
1. **Audit remaining hardcoded `data/default/...` references outside production runtime**
   - especially docs, archived notes, utility scripts
   - production code path is updated; there may still be stale references in docs/tickets

2. **Broader trade folder regression pass**
   - verify these still work on new root:
     - trade create
     - archive/move active->closed
     - chart snapshots copy
     - bars lookup priority
     - trade logs pathing

3. **Run UI smoke around account + trade pages**
   - system accounts page
   - manual order panel
   - size calculator
   - trade detail pages using trade folders

### Later
4. **Remove legacy `user_accounts` shadow write**
   - only after `trades` compatibility dependency is eliminated

5. **If approved later: do separate `trades` architecture plan**
   - but not as part of this work

## Recommended next-agent checks
1. Create one new trade locally and confirm files land under:
   - `data/users/default/trade_files/...`
2. Close/archive one trade and confirm move/copy behavior under:
   - `data/users/default/trade_closed/...`
3. Open system Accounts page and confirm:
   - account list loads
   - save status/name works
   - key rotation still works
4. Search repo for stale root references:
   - `data/default/`
   - `data/{user_id}/`

## Return format for next agent
- git branch
- done
- remaining
- validation run
- blockers / risks
- deploy status

## Deploy status
- **Not deployed**
- no VPS action taken
- wait for explicit confirmation before any deploy
