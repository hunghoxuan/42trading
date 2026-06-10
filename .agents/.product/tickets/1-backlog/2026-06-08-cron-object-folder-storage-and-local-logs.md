# Cron Object Folder Storage + Local Logs

## Meta
- Status: `BACKLOG`
- Priority: `P1`
- Tags: `TICKET`, `ARCHITECTURE`, `STORAGE`, `CRON`, `LOGGING`
- Created: `2026-06-08`
- Author: `GPT-5.4`
- Parent:
  - `1-backlog/2026-06-08-object-storage-refactor-cron-provider-per-object-folders.md`
- Related:
  - `1-backlog/2026-05-23-multi-cron-support-and-snapshot-improvements.md`

## Summary
Move `cron` out of `settings/` into per-object folders under:
- `data/users/{user_id}/cron/{cron_name}/data.json`

Each cron folder must also contain:
- `logs/`

Cron logs must move from global:
- `data/logs/CRON/{cron_name}.log`

to object-local:
- `data/users/{user_id}/cron/{cron_name}/logs/*.log`

This ticket is the **first execution phase** of the broader object-storage refactor.

## Verified current state
Current cron config storage:
- `data/users/{user_id}/settings/cron/{cron_name}.json`

Current cron write/read DAL:
- `webhook/settingsStore.js`
  - `listUserSettingsByType(..., "cron")`
  - `getUserSettingData(..., "cron", ...)`
  - `upsertUserSetting(..., "cron", ...)`
  - `deleteUserSetting(..., "cron", ...)`

Current cron log path:
- `data/logs/CRON/{cron_name}.log`

Current cron log routing BAL in `webhook/server.js`:
- `EVENT_FILE_MAP`
- `resolveLogFile(...)`
- `fileLog(...)`
- `mt5Log(...)`

## Goal
Create root-level shared DAL/BAL for first-class cron object folders, then route all cron config + cron log paths through it.

## Target contract
```text
data/users/{user_id}/cron/
  {cron_name}/
    data.json
    logs/
      activity.log
      ai_analysis.log
      snapshots.log
      tasks.log
```

## Scope
### In scope
- shared object-folder DAL for cron
- shared object-local log BAL for cron
- migrate cron reads/writes from `settings/cron/*.json` to `cron/{name}/data.json`
- migrate cron log writes from global `data/logs/CRON/*.log` to cron-local `logs/`
- compatibility reads for legacy cron config/log locations during migration
- update log readers/source scanners so cron logs still appear in diagnostics/UI

### Out of scope
- providers/api-key migration
- accounts migration
- settings redesign beyond cron routing
- notification history redesign

## Required implementation approach
Must use shared abstraction, not scattered path rewrites.

### DAL
Suggested module:
- `webhook/objectStore.js`

Required cron-facing methods:
- `listObjectsByType(userId, "cron")`
- `getObject(userId, "cron", cronName)`
- `getObjectData(userId, "cron", cronName)`
- `upsertObject(userId, "cron", cronName, data, status, meta)`
- `deleteObject(userId, "cron", cronName)`
- `objectLogsDir(userId, "cron", cronName)`

### BAL
Suggested module:
- `webhook/objectLogService.js`

Required cron-facing behaviors:
- resolve cron-local log file path by event type
- preserve existing log line schema
- preserve `object_type/object_id`
- support reading both old and new cron log paths during migration

## API compatibility
Existing UI/API flows should continue to work.

Phase-1 safe rule:
- `/v2/settings` can continue to accept `type="cron"`
- internal persistence for `cron` routes through object DAL
- no forced frontend contract change in this ticket

## Data shape
Keep current row envelope in `data.json` for safety:
```json
{
  "id": "...",
  "user_id": "default",
  "userId": "default",
  "type": "cron",
  "name": "CRON_AI_BTCUSD",
  "data": { "...": "cron payload" },
  "value": null,
  "status": "ACTIVE",
  "created_at": "...",
  "updated_at": "..."
}
```

## Implementation plan
### Phase 1 — shared cron object DAL
- [ ] add `objectStore` with generic object-folder helpers
- [ ] support `cron/{cron_name}/data.json`
- [ ] support compatibility fallback reads from `settings/cron/{cron_name}.json`

### Phase 2 — shared cron log BAL
- [ ] add object-local log resolver for cron
- [ ] map cron event types to cron-local files
- [ ] support compatibility reads from old global cron log path

### Phase 3 — route cron callers
- [ ] route cron save/list/get/delete through object DAL
- [ ] route cron log writes through object log BAL
- [ ] keep existing cron scheduling behavior intact

### Phase 4 — migrate persisted files
- [ ] move existing cron JSON files into object folders
- [ ] move existing cron logs into object-local `logs/`
- [ ] define precedence if both legacy + new copies exist

### Phase 5 — cleanup
- [ ] reduce direct `settingsStore` responsibility for cron
- [ ] update diagnostics/log source scanners for cron-local storage

## Risks
1. cron log discovery/UI regressions
2. duplicate legacy/new cron rows during migration
3. hidden direct path dependencies in cron runtime/read APIs
4. cron health/status pages assuming global `CRON/` log path

## Verification
- [ ] cron rows save under `data/users/{user_id}/cron/{cron_name}/data.json`
- [ ] active cron execution still works
- [ ] cron logs write under object-local `logs/`
- [ ] old cron rows still readable during migration
- [ ] old cron logs still readable during migration
- [ ] `/health` and cron diagnostics still show expected sources/status
- [ ] webhook validation flow passes

## Handoff Prompt
Tag: `TICKET`

Read:
- `.agents/.product/tickets/1-backlog/2026-06-08-cron-object-folder-storage-and-local-logs.md`
- `.agents/.product/tickets/1-backlog/2026-06-08-object-storage-refactor-cron-provider-per-object-folders.md`
- `AI.md`
- `.agents/BOOTSTRAP.md`
- `.agents/rules/safety.md`
- `.agents/rules/testing.md`

Task:
Implement cron-first object-folder storage refactor.

Requirements:
1. move cron config from `settings/cron/*.json` to `cron/{cron_name}/data.json`
2. move cron logs from global `data/logs/CRON/*.log` to cron-local `logs/`
3. use shared DAL/BAL only
4. keep existing UI/API behavior working
5. keep migration compatibility during cutover

Deliver:
- shared object DAL
- shared cron log BAL
- migrated cron config/log paths
- verification results
