# Object Storage Refactor: move Cron + Providers out of `settings/` into per-object folders

## Meta
- Status: `BACKLOG`
- Priority: `P1`
- Tags: `TICKET`, `ARCHITECTURE`, `STORAGE`, `CRON`, `PROVIDERS`, `LOGGING`
- Created: `2026-06-08`
- Author: `GPT-5.4`
- Related:
  - `1-backlog/plan-update-feature-unified-user-data-static-json-dynamic-sqlite.md`
  - `1-backlog/2026-05-23-multi-cron-support-and-snapshot-improvements.md`

## Problem
Current user-scoped object storage is still centered on `settings/`:
- cron configs live under `data/users/{user_id}/settings/cron/{cron_name}.json`
- provider/api-key configs live under `data/users/{user_id}/settings/api_key/{name}.json`
- cron activity logs live separately under global log root:
  - `data/logs/CRON/{cron_name}.log`
- provider-related activity is scattered across system/trade logs and is not colocated with provider config

This creates 4 problems:
1. **Object shape mismatch** — active objects like cron are stored like flat settings rows even though they behave like first-class objects.
2. **Config/log split** — cron config lives under user settings, but cron logs live under global logs, so one object is split across unrelated roots.
3. **Weak root abstraction** — `settingsStore` is still the main DAL for objects that now need richer per-object folder layout and colocated logs/artifacts.
4. **No scalable pattern for high-activity objects** — future objects with frequent activity need one standard shape instead of ad hoc `settings/...` + `logs/...` + special-case readers.

## Verified current state
### Current DAL
File-backed settings DAL exists in:
- `webhook/settingsStore.js`

Current path pattern:
- `data/users/{user_id}/settings/{type}/{name}.json`

Main methods:
- `settingsDirForUser(userId)`
- `settingFilePath(userId, type, name)`
- `listUserSettingsByType(userId, type)`
- `getUserSetting(userId, type, name)`
- `getUserSettingData(userId, type, name)`
- `upsertUserSetting(userId, type, name, data, status, meta)`
- `deleteUserSetting(userId, type, name)`

### Current cron config storage
Examples:
- `data/users/default/settings/cron/CRON_AI_BTCUSD.json`
- `data/users/default/settings/cron/CRON_AI_DEFAULT.json`
- `data/users/default/settings/cron/CRON_MD_DEFAULT.json`
- `data/users/default/settings/cron/SNAPSHOTS_CRON.json`

### Current provider/api-key storage
Verified code path still reads/writes type `api_key` through settings DAL and `/v2/settings`.
Current persisted location pattern:
- `data/users/{user_id}/settings/api_key/{name}.json`

### Current cron logs
Shared log BAL exists inside `webhook/server.js`:
- `EVENT_FILE_MAP`
- `resolveLogFile(...)`
- `fileLog(...)`
- `mt5Log(...)`
- `parseLogLine(...)`

Current cron log output path:
- `data/logs/CRON/{cron_name}.log`

### Architectural observation
There is already a broader storage direction ticket:
- `1-backlog/plan-update-feature-unified-user-data-static-json-dynamic-sqlite.md`

This new ticket narrows that direction into an implementable first-class object-folder contract for:
- `cron`
- `providers` (replacing legacy `api_key` naming/model)

## Goal
Move object-style, activity-heavy user data out of `settings/` into a per-object folder model under:
- `data/users/{user_id}/{object_type}/{object_id}/`

Execution is split into child implementation tickets:
- `1-backlog/2026-06-08-cron-object-folder-storage-and-local-logs.md`
- `1-backlog/2026-06-08-providers-object-folder-storage-and-local-logs.md`

Each object folder must contain:
- `data.json`
- `logs/`

Examples:
- `data/users/default/cron/CRON_AI_BTCUSD/data.json`
- `data/users/default/cron/CRON_AI_BTCUSD/logs/ai_analysis.log`
- `data/users/default/providers/OPENAI_API_KEY/data.json`
- `data/users/default/providers/OPENAI_API_KEY/logs/api_calls.log`

## Required architecture
## Canonical object folder contract
```text
data/users/{user_id}/
  cron/
    {cron_name}/
      data.json
      logs/
        *.log
  providers/
    {provider_id}/
      data.json
      logs/
        *.log
```

### Rules
1. `data.json` is the canonical persisted config/metadata payload for that object.
2. `logs/` contains only logs/artifacts for that object.
3. Object path is derived from `(user_id, object_type, object_id)`.
4. Path sanitization rules must stay centralized in DAL.
5. Writes must stay atomic.
6. Folder-based objects must be readable/listable without needing separate settings-table semantics.

## Scope
### In scope
1. Create common DAL/BAL for object-folder storage.
2. Migrate `cron` objects from `settings/cron/*.json` to `cron/{cron_name}/data.json`.
3. Migrate `api_key` objects into `providers/{provider_id}/data.json`.
4. Move cron log routing from global `data/logs/CRON/*.log` to object-local:
   - `data/users/{user_id}/cron/{cron_name}/logs/*.log`
5. Create provider log routing foundation:
   - provider API usage / response / credit-refresh logs should be able to route into provider-local `logs/`
6. Keep compatibility read-paths during migration/cutover window.
7. Update log discovery/read APIs so colocated object logs still appear in UI/system log tooling where required.

### Out of scope (phase 1)
- trades folder redesign
- account object migration
- generic migration of all settings types
- redesign of notification history format
- changing AI raw JSON contract

## Root-level implementation requirement
This must **not** be implemented as scattered one-off path rewrites.

Required approach:
- add one common **object storage DAL**
- add one common **object log resolver/BAL**
- route cron/provider callers through those shared functions

### Do not do
- hardcode new cron paths directly in 5 different places
- special-case providers in one route and cron in another without common abstraction
- leave global log resolver as source-of-truth for cron after object-folder migration

## Proposed DAL/BAL split
### DAL: object folder store
Create a new shared file-backed object store, suggested module:
- `webhook/objectStore.js`

Suggested responsibilities:
- `userRootDir(userId)`
- `objectTypeDir(userId, objectType)`
- `objectDir(userId, objectType, objectId)`
- `objectDataPath(userId, objectType, objectId)`
- `objectLogsDir(userId, objectType, objectId)`
- `listObjectsByType(userId, objectType)`
- `getObject(userId, objectType, objectId)`
- `getObjectData(userId, objectType, objectId)`
- `upsertObject(userId, objectType, objectId, data, status, meta)`
- `deleteObject(userId, objectType, objectId)`
- path sanitization
- atomic writes to `data.json`
- optional backward-compatible fallback read from legacy settings paths during migration

### BAL: object log routing
Extract/introduce shared object log resolver layer, suggested module:
- `webhook/objectLogService.js`

Suggested responsibilities:
- resolve object-local log path from `(user_id, object_type, object_id, event_type, metadata)`
- write log line
- parse object log line
- list object logs
- keep compatibility with existing system/global logs where still needed

### Required object-type semantics
Canonical object types for this ticket:
- `cron`
- `providers`

Explicit migration rule:
- legacy `api_key` storage type becomes object type `providers`
- compatibility aliases may exist temporarily, but all new writes must use `providers`

## Data model
### Cron object
Path:
- `data/users/{user_id}/cron/{cron_name}/data.json`

`data.json` shape should remain equivalent to today’s cron row envelope where practical:
```json
{
  "id": "...",
  "user_id": "default",
  "userId": "default",
  "type": "cron",
  "name": "CRON_AI_BTCUSD",
  "data": { "...": "existing cron payload" },
  "value": null,
  "status": "ACTIVE",
  "created_at": "...",
  "updated_at": "..."
}
```

Reason:
- easier compatibility with existing API callers
- less UI/route churn in phase 1

### Provider object
Path:
- `data/users/{user_id}/providers/{provider_id}/data.json`

Provider ID candidates:
- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `CLAUDE_API_KEY`
- `TWELVE_DATA_API_KEY`

Phase-1 safe move:
- preserve current encrypted payload schema in `data.json`
- preserve current UI/API response shape where possible
- rename storage root from `api_key` to `providers` at DAL level

## Logging contract
### Cron logs
Current:
- `data/logs/CRON/{cron_name}.log`

Target:
- `data/users/{user_id}/cron/{cron_name}/logs/{file}.log`

Suggested file split:
- `activity.log` for generic cron lifecycle
- `ai_analysis.log` for AI analysis cron events
- `snapshots.log` for snapshot cron events
- `tasks.log` for fetch/task events

Minimum requirement for phase 1:
- colocate cron logs under the cron object folder
- keep existing event-type formatting contract
- keep `object_type/object_id` on each line

### Provider logs
Add provider-local logging foundation, examples:
- `api_calls.log`
- `credits.log`
- `errors.log`

Use for:
- provider credit refresh
- provider API request/response summaries
- provider auth/config validation failures

### Compatibility
For a temporary migration period, read APIs may need to read from both:
- old global cron log paths
- new object-local cron log paths

## API impact
### Existing settings APIs
Current settings APIs use `/v2/settings` with type-based storage.

Required direction:
1. keep old API contract working during migration
2. internally route `cron` and `api_key/providers` through new object DAL
3. do not force immediate UI contract breakage

### Recommended follow-up API cleanup
After storage cutover is stable:
- add dedicated APIs
  - `/v2/crons`
  - `/v2/providers`
- reduce dependency on generic settings routes for object-style resources

But this is **not mandatory** for phase 1 if compatibility risk is too high.

## UI impact
### Cron page
Current page:
- `web-ui/src/pages/settings/CronPage.jsx`

Expected phase-1 UI impact:
- ideally none in behavior
- save/list/delete/status actions continue to work
- UI should not need to know storage moved from settings file to object folder

### Provider / API key UI
Current provider key management still uses generic settings patterns.
Expected phase-1 UI impact:
- ideally none in behavior
- internal storage path changes only

## Files likely affected
### New modules
- `webhook/objectStore.js`
- `webhook/objectLogService.js`

### Existing modules likely to change
- `webhook/settingsStore.js` (either shrink scope or delegate selected types)
- `webhook/server.js`
- `web-ui/src/pages/settings/CronPage.jsx` (only if endpoint contract needs minor adaptation)
- `web-ui/src/api.js` (only if dedicated APIs are introduced)
- scripts/tests that read legacy cron/settings paths

## Migration plan
### Phase 1 — foundation
- [ ] Create object folder DAL
- [ ] Create object log BAL
- [ ] Add object path helpers for `data.json` and `logs/`
- [ ] Add compatibility read support for legacy settings path

### Phase 2 — cron cutover
- [ ] Route cron reads/writes through object DAL
- [ ] Route cron log writes through object log BAL
- [ ] Move existing cron files:
  - `settings/cron/{name}.json` -> `cron/{name}/data.json`
- [ ] Move existing cron logs:
  - `data/logs/CRON/{name}.log` -> `data/users/{user_id}/cron/{name}/logs/...`
- [ ] Keep log readers compatible during transition

### Phase 3 — provider cutover
- [ ] Route provider/api-key reads/writes through object DAL
- [ ] Rename storage root concept from `api_key` to `providers`
- [ ] Move existing files:
  - `settings/api_key/{name}.json` -> `providers/{name}/data.json`
- [ ] Add provider-local log writers for API/credits/errors events

### Phase 4 — cleanup
- [ ] Remove cron/provider dependence on `settings/` layout
- [ ] Restrict `settingsStore` to true settings only
- [ ] Update docs and health/source diagnostics to reflect new storage roots

## Backward compatibility requirements
- old persisted cron/provider files must still be readable during migration window
- old UI flows must continue to function
- existing cron runtime behavior must not regress
- old global cron logs should remain readable until migration finishes
- encrypted provider key payloads must remain encrypted; no plaintext regression

## Risks
1. **Cron log discovery regression**
   - current system log tooling expects global `SERVER_LOG_DIR`
   - moving logs under user object roots may break Health/System log pages unless reader BAL is updated too

2. **Generic settings coupling**
   - many routes still assume `type/name` settings model
   - internal cutover must be hidden carefully behind BAL

3. **Provider secret handling**
   - moving api-key files must not accidentally expose or rewrite decrypted values

4. **Migration duplication / stale reads**
   - dual-read compatibility can accidentally read old + new copies if precedence is not explicit

5. **Future object taxonomy drift**
   - if `cron` and `providers` use object folders but others stay in `settings/`, boundaries must be documented clearly

## Decisions / assumptions needing confirmation during implementation
1. **Assumption: `cron` and `providers` are first-wave object-folder migrations**
   - Tradeoff: highest architectural value without touching all entities at once
   - Risk: mixed model remains for some time

2. **Assumption: keep current envelope row shape in `data.json`**
   - Tradeoff: lower compatibility risk
   - Risk: carries old `type/name/data` wrapper forward longer

3. **Assumption: provider object id stays equal to current api-key setting name**
   - Tradeoff: no secret/provider-id remap needed now
   - Risk: naming remains tied to legacy `*_API_KEY` identifiers

4. **Assumption: cron logs become object-local first, while system/global logs stay global**
   - Tradeoff: focused migration
   - Risk: split logging model persists temporarily

## Verification
### Storage verification
- [ ] `cron` objects save to `data/users/{user_id}/cron/{object_id}/data.json`
- [ ] `providers` objects save to `data/users/{user_id}/providers/{object_id}/data.json`
- [ ] no new cron/provider writes go to `settings/cron` or `settings/api_key`
- [ ] migration script/tool moves existing rows correctly

### Runtime verification
- [ ] cron list/get/save/delete still work through UI
- [ ] provider key get/save still work through UI
- [ ] active crons still execute after cutover
- [ ] cron normalization BAL still applies after storage move

### Logging verification
- [ ] cron log writes land in object-local `logs/`
- [ ] system log readers can still surface cron logs where expected
- [ ] provider-local logs are written for at least one provider activity path
- [ ] `object_type/object_id` format remains stable in log lines

### Safety verification
- [ ] provider encrypted payload remains encrypted on disk
- [ ] no secrets leaked to UI/log output
- [ ] restart + `/health` pass
- [ ] webhook validation flow passes after `webhook/` changes

## Suggested implementation order
1. implement child ticket: `1-backlog/2026-06-08-cron-object-folder-storage-and-local-logs.md`
2. implement child ticket: `1-backlog/2026-06-08-providers-object-folder-storage-and-local-logs.md`
3. complete umbrella cleanup/remove remaining legacy direct path dependencies

## Handoff Prompt
Tag: `TICKET`

Read:
- `.agents/.product/tickets/1-backlog/2026-06-08-object-storage-refactor-cron-provider-per-object-folders.md`
- `.agents/.product/tickets/1-backlog/plan-update-feature-unified-user-data-static-json-dynamic-sqlite.md`
- `AI.md`
- `.agents/BOOTSTRAP.md`
- `.agents/rules/safety.md`
- `.agents/rules/testing.md`

Task:
Implement root-level object storage refactor for `cron` and `providers`.

Requirements:
1. Move `cron` out of `settings/` into per-object folders under `data/users/{user_id}/cron/{cron_name}/data.json`
2. Move provider/api-key storage out of `settings/api_key/` into `data/users/{user_id}/providers/{provider_id}/data.json`
3. Add `logs/` subfolder for each migrated object
4. Route cron logs through object-local `logs/`
5. Use common DAL/BAL; do not scatter path rewrites
6. Keep old UI/API flows working during migration
7. Preserve encryption and no-secret-leak rules

Deliver:
- shared object storage DAL
- shared object log BAL
- migrated cron/provider read-write paths
- compatibility migration/read path
- focused verification results
