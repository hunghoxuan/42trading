# AI Response Schema Migration Runbook

This runbook prevents parser/UI drift when AI response schema changes.

## Scope

When `config/ai_response_schema.json` changes, always update:

- `config/guide_system.md`
- `config/schema_enums.json`
- `config/response_mapping.json`
- `webhook/server.js` parser/normalizer
- `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` normalizer
- `web-ui/src/services/TradePlanSchema.js` resolver mapping

## Quick Procedure

1. Confirm new schema version and key paths.
2. Update backend parse mapping (`raw_response` to `parsed_json`).
3. Update backend fallback coverage logic for missing symbols.
4. Update frontend mapping/resolver to new paths.
5. Validate DB save path keeps `raw_response` intact and `parsed_json` aligned.
6. Build/test.
7. Bump versions, push, deploy, verify on VPS.

## Where Parse Mapping Lives

- Backend:
  - `/Users/macmini/Trade/Bot/trading/webhook/server.js`
    - `normalizeAiAnalysisContract(...)`
    - `ensureTradePlanCoverageBySymbol(...)`
    - helper decision/reason mappers
- Frontend:
  - `/Users/macmini/Trade/Bot/trading/web-ui/src/pages/ai/ChartSnapshotsPage.jsx`
  - `/Users/macmini/Trade/Bot/trading/web-ui/src/services/TradePlanSchema.js`

## Verification Checklist

- Schema version on server matches local file.
- UI Schema tab shows latest structure.
- First analyze result is not overwritten by a second auto-call.
- Parsed JSON retains critical raw fields (no truncation regression).
- Symbol labels display actual symbol (not fallback "Plan" when symbol exists).

## Commands

```bash
node --check webhook/server.js
npm --prefix web-ui run build
bash scripts/deploy/bump_build_versions.sh
bash scripts/deploy/deploy_webhook.sh
```

## Enforcement Tip

In task prompt, include:

`Use .agents/skills/ai-response-schema-migration.md and complete every checklist item before deploy.`
