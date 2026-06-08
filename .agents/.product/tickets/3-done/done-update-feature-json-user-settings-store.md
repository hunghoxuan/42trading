# JSON User Settings Store

## Meta
- Ticket Type: `Update Feature`
- Ticket Status: `Done`
- Owner: `Codex`
- Updated: `2026-06-08 00:00 UTC`

## Problem
User settings were stored in the `user_settings` database table. The requested change is to keep the UI/API flow the same while moving settings persistence from DB rows to JSON files under each user's data folder, using `/{username}/settings` as a folder-based layout. Existing VPS `user_settings` rows must be migrated to JSON and the DB table should not remain the runtime source of truth.

## Investigation
- Evidence:
  - `web-ui/src/api.js` uses stable `/v2/settings`, `/v2/settings/secret`, and `DELETE /v2/settings/:type/:name` endpoints.
  - `webhook/server.js` had centralized settings read/write routes and several runtime consumers for API keys, cron configs, notification config, and execution profiles.
  - Backend startup created/maintained `user_settings`, so it would recreate the table unless removed.
- Findings:
  - The UI can remain unchanged if backend returns DB-row-compatible setting objects.
  - Runtime settings consumers must use the same storage abstraction, not direct DB calls.
  - Migration must export DB rows before deleting/dropping the table.
- Open questions:
  - Production/VPS migration command must be run explicitly against the target VPS environment before dropping the table.

## Solution
Completed implementation:
- Added file-backed settings store at `webhook/settingsStore.js`.
- Storage layout: `data/{user_id}/settings/{type}/{name}.json`.
- JSON store supports list/get/upsert/delete with atomic writes and per-file write queues.
- Rewired runtime settings flows in `webhook/server.js` to use JSON settings:
  - `/v2/settings` GET/POST/DELETE
  - `/v2/settings/secret`
  - AI config/API-key loading
  - Notification settings/cache loading
  - Cron config reads and last-sync updates
  - Execution profile settings
  - System settings helper
- Stopped backend startup from creating/altering `user_settings`.
- Removed `user_settings` from active backend table listing and SQLite bootstrap/test expectations.
- Added migration script: `scripts/migrate/migrate_user_settings_to_json.js`.
  - Exports current DB rows to JSON.
  - Supports `--delete-db` and `--drop-table` for final cleanup.

## Expected Output / Verification
- [x] `node --check webhook/server.js`
- [x] `node --check webhook/settingsStore.js`
- [x] `node --check scripts/migrate/migrate_user_settings_to_json.js`
- [x] Settings store smoke test with `SETTINGS_DATA_ROOT=.local/settings-store-smoke`
- [x] `bash scripts/start/reset_stack_once.sh`
- [x] `bash scripts/test/verify_webhook_local.sh`

## Handoff Prompt
Read:
- `.agents/.product/tickets/3-done/done-update-feature-json-user-settings-store.md`
- `AI.md`
- `.agents/BOOTSTRAP.md`
- `.agents/rules/deploy.md` before any VPS/prod deploy

Task:
Review/deploy the JSON user settings store migration. Run the migration against the target VPS DB only after confirming the correct environment, then restart backend and verify `/v2/settings` and cron/API-key paths.

Constraints:
- Keep UI unchanged.
- Do not store plaintext API keys; JSON files preserve encrypted payloads.
- Use `data/{user_id}/settings/{type}/{name}.json`.
- Run required backend checks after any `webhook/` edit.
- Do not deploy/drop DB table without explicit confirmation and a verified backup.

Return:
- ticket name
- files changed
- migration command used
- checks run
- deploy status
