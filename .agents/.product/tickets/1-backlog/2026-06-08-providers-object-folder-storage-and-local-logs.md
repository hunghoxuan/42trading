# Providers Object Folder Storage + Local Logs

## Meta
- Status: `BACKLOG`
- Priority: `P2`
- Tags: `TICKET`, `ARCHITECTURE`, `STORAGE`, `PROVIDERS`, `API_KEY`, `LOGGING`
- Created: `2026-06-08`
- Author: `GPT-5.4`
- Parent:
  - `1-backlog/2026-06-08-object-storage-refactor-cron-provider-per-object-folders.md`
- Depends On:
  - `1-backlog/2026-06-08-cron-object-folder-storage-and-local-logs.md`
  - or equivalent shared object DAL/BAL foundation

## Summary
Move provider/api-key storage out of `settings/api_key/` into per-object folders under:
- `data/users/{user_id}/providers/{provider_id}/data.json`

Each provider folder must also contain:
- `logs/`

This ticket is the **second execution phase** after cron-first object-folder infrastructure is in place.

## Verified current state
Current provider/api-key config storage:
- `data/users/{user_id}/settings/api_key/{name}.json`

Current provider read/write path:
- generic settings flow via `/v2/settings`
- `settingsStore` methods for type `api_key`

Current payload characteristics:
- encrypted object payload is persisted on disk
- existing key names include:
  - `OPENAI_API_KEY`
  - `OPENROUTER_API_KEY`
  - `CLAUDE_API_KEY`
  - `TWELVE_DATA_API_KEY`

Current provider-related logs:
- scattered across trade/system logs
- not colocated with provider config
- no provider-local log folder contract yet

## Goal
Use the shared object-folder DAL/BAL to migrate provider storage from flat settings rows into first-class provider object folders with local logs.

## Target contract
```text
data/users/{user_id}/providers/
  {provider_id}/
    data.json
    logs/
      api_calls.log
      credits.log
      errors.log
```

## Scope
### In scope
- route `api_key`/provider persistence through shared object DAL
- use canonical object type `providers`
- move provider config files into `providers/{provider_id}/data.json`
- add provider-local logs foundation
- preserve encrypted payloads and existing UI/API contract
- support compatibility reads from legacy `settings/api_key/` during migration

### Out of scope
- cron migration
- full provider registry redesign
- changing encryption scheme
- redesigning secrets UI
- all settings-type migrations

## Required implementation approach
Must reuse shared foundation from cron/object-store work.

### DAL
Reuse generic object-folder DAL.
Required provider-facing methods:
- `listObjectsByType(userId, "providers")`
- `getObject(userId, "providers", providerId)`
- `getObjectData(userId, "providers", providerId)`
- `upsertObject(userId, "providers", providerId, data, status, meta)`
- `deleteObject(userId, "providers", providerId)`

### BAL
Reuse shared object log BAL.
Required provider-facing behaviors:
- resolve provider-local log file path
- log provider API summaries / credit updates / auth errors
- avoid secret leakage in log lines

## API compatibility
Phase-1 safe rule:
- keep `/v2/settings` contract working for existing provider/api-key UI
- internally route `api_key` storage to object type `providers`
- do not break runtime callers expecting existing setting names

## Data shape
Keep current envelope row shape in `data.json` where possible:
```json
{
  "id": "...",
  "user_id": "default",
  "userId": "default",
  "type": "providers",
  "name": "OPENAI_API_KEY",
  "data": { "...": "encrypted provider payload" },
  "value": null,
  "status": "ACTIVE",
  "created_at": "...",
  "updated_at": "..."
}
```

Compatibility note:
- legacy callers may still pass `type="api_key"`
- canonical storage type after migration should be `providers`

## Logging contract
Suggested provider-local log files:
- `api_calls.log`
- `credits.log`
- `errors.log`

Minimum phase-1 requirement:
- at least one verified provider activity path must write to provider-local `logs/`
- no plaintext secret leakage in logs

## Implementation plan
### Phase 1 — route provider storage through object DAL
- [ ] map legacy `api_key` routes to canonical storage root `providers`
- [ ] support compatibility reads from `settings/api_key/*.json`
- [ ] preserve encrypted payload shape

### Phase 2 — provider-local log foundation
- [ ] add provider-local log path resolution
- [ ] add at least one provider activity log path (API call or credit refresh or error)
- [ ] redact secrets consistently

### Phase 3 — migrate persisted files
- [ ] move existing provider files into `providers/{provider_id}/data.json`
- [ ] define precedence if both legacy and new files exist

### Phase 4 — cleanup
- [ ] reduce direct `settingsStore` responsibility for provider objects
- [ ] document canonical storage type `providers`

## Risks
1. secret leakage during migration/logging
2. old callers still hardcoded to `api_key` semantics
3. mixed legacy/new provider path precedence bugs
4. provider logs may be incomplete if no shared event routing is added

## Verification
- [ ] provider save/get still works through existing UI/API
- [ ] provider payload remains encrypted on disk
- [ ] provider config persists under `data/users/{user_id}/providers/{provider_id}/data.json`
- [ ] compatibility reads from legacy `settings/api_key/` still work during migration
- [ ] provider-local logs are written for at least one provider activity path
- [ ] no secret appears in logs/UI responses
- [ ] webhook validation flow passes if backend changed

## Handoff Prompt
Tag: `TICKET`

Read:
- `.agents/.product/tickets/1-backlog/2026-06-08-providers-object-folder-storage-and-local-logs.md`
- `.agents/.product/tickets/1-backlog/2026-06-08-object-storage-refactor-cron-provider-per-object-folders.md`
- `.agents/.product/tickets/1-backlog/2026-06-08-cron-object-folder-storage-and-local-logs.md`
- `AI.md`
- `.agents/BOOTSTRAP.md`
- `.agents/rules/safety.md`
- `.agents/rules/testing.md`

Task:
Implement providers/api-key object-folder migration using the shared object-store foundation.

Requirements:
1. move provider storage from `settings/api_key/*.json` to `providers/{provider_id}/data.json`
2. add provider-local `logs/`
3. preserve encrypted payload behavior
4. use shared DAL/BAL only
5. keep existing UI/API contract working during migration

Deliver:
- migrated provider storage path
- provider-local log foundation
- compatibility migration/read path
- verification results
