# AI Response Schema Migration Skill

Use this skill whenever `config/ai_response_schema.json` changes (version bump or structure change).

## Goal

Keep `raw_response -> parsed_json -> DB -> API -> UI` fully aligned with the new schema, with no data loss.

## Trigger

- Any edit to:
  - `config/ai_response_schema.json`
  - `config/schema_enums.json`
  - `config/response_mapping.json`
  - `config/guide_system.md`
- Any AI-output parsing bug where fields disappear or fallback plan replaces valid content.

## Mandatory Ownership Scope

1. Contract source of truth:
   - `config/ai_response_schema.json`
2. Backend parse + normalize:
   - `webhook/server.js`
3. Frontend normalize + render mapping:
   - `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`
   - `web-ui/src/services/TradePlanSchema.js`
4. Prompt/rules alignment:
   - `config/guide_system.md`
   - `config/schema_enums.json`
   - `config/response_mapping.json`

## Required Flow

1. Diff the schema change first.
2. Build a field mapping table (old key -> new key, type, default, required/optional).
3. Update backend normalize/parser functions.
4. Update backend fallback coverage logic (do not overwrite valid parsed fields).
5. Update frontend normalize and resolver mapping.
6. Verify DB save path still writes both raw and parsed forms correctly.
7. Verify API response shape used by UI still includes required keys.
8. Run checks, bump versions, deploy, verify runtime.

## Canonical Parse Locations (Current Project)

- Backend:
  - `normalizeAiAnalysisContract(...)` in `webhook/server.js`
  - `ensureTradePlanCoverageBySymbol(...)` in `webhook/server.js`
  - Helper mappers like `planDecisionText(...)`, `planSkipReasons(...)`
- Frontend:
  - `normalizeAnalysisContract(...)` in `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`
  - Resolver in `web-ui/src/services/TradePlanSchema.js`

## Field-Mapping Checklist

For each schema section (example: `trade_plan[]`, `risk_management`, `analysis_data[]`):

1. Presence:
   - Parser reads it from raw JSON.
2. Type:
   - String/number/boolean/object/array preserved.
3. Name migration:
   - New field names mapped from old where needed.
4. Fallback:
   - Fallback only when field missing, never when field exists but falsy-valid.
5. UI binding:
   - UI reads the new key path.
6. DB:
   - Saved parsed JSON still contains new field.

## Anti-Regressions

- Never drop to minimal `trade_plan` when rich `analysis_data` exists.
- Never force "Plan" label when real symbol is present.
- Never run a second auto-analyze that wipes first result.
- Never reduce detailed `raw_response` data into an over-trimmed parsed object.

## Verification Commands

Run scoped checks after changes:

1. Backend syntax:
   - `node --check webhook/server.js`
2. UI build:
   - `npm --prefix web-ui run build`
3. Optional targeted search:
   - `rg -n "normalizeAiAnalysisContract|ensureTradePlanCoverageBySymbol|normalizeAnalysisContract|resolveField" webhook/server.js web-ui/src/pages/ai/ChartSnapshotsPage.jsx web-ui/src/services/TradePlanSchema.js`

## Deploy Gate

If backend/UI touched:

1. Bump build versions:
   - `bash scripts/deploy/bump_build_versions.sh`
2. Push to `origin/main` first.
3. Merge/rebase latest `origin/main` (other-agent commits).
4. Deploy:
   - `bash scripts/deploy/deploy_webhook.sh`
5. Confirm:
   - VPS running expected commit hash
   - `config/ai_response_schema.json` version on VPS
   - webhook process online

## Done Definition

- New schema version visible in server config and UI schema panel.
- Parsed output preserves all critical fields from raw response.
- UI renders symbol, direction colors, entry/SL/TP, and decision fields correctly.
- No duplicate analyze call regression.
- Deployment verified on VPS runtime.
