# Handoff: trade_plan_schema.json — Schema Migration Complete

## VPS Status
- Commit: `2e887d6` — `fix: buildSchemaString keeps array, AI response [0] direct plan, no wrapping`
- Health: `ok: True` (version string `v2026.05.19 10:45 - 1a183823` is stale, code is live)
- Date: 2026-05-19

## What Changed

### 1. Schema Source
- `config/ai_response_schema.json` — **DELETED**
- `config/trade_plan_schema.json` — **CANONICAL CONTRACT**. AI returns exactly this format.
- New rule in `.agents/rules/safety.md`: *No transform, normalize, wrap, or reshape. Store exact JSON. Read exact JSON.*

### 2. AI Prompt (Frontend)
- `web-ui/src/pages/ai/AiPromptBuilder.js` L852: `AI_RESPONSE_SCHEMA = [TRADE_PLAN_SCHEMA]` — array format
- `buildSchemaString()` L940 — **FIXED**: `Object.assign({}, arr)` was converting `[{...}]` to `{"0":{...}}`. Now keeps array as array.
- Prompt now sends `[{symbol: "", direction: "BUY|SELL", execution_plan: {...}}]`

### 3. AI Response Handler (Server)
- `webhook/server.js` L19175, L19654: AI returns `[{...}]` → takes `[0]` directly as the plan
- **NO** `normalizeAiAnalysisContract` — removed from both handlers
- **NO** `attachCanonicalAiRaw` — not called in AI flow
- **NO** `recoverTradePlansFromRawAiText` — not called in AI flow
- **NO** `ensureTradePlanCoverageBySymbol` — not called, no fake "Skip" plans
- Full raw AI response logged to DB: `raw_response` field in `AI_ANALYZE_RESPONSE` log

### 4. Auto-Save
- `collectAutoSavableTradePlans()` L18689 — reads from `execution_plan.entry.price`, `execution_plan.stop_loss.price`, `execution_plan.tp1.price`
- Handles both array `[{...}]` and single plan object

### 5. UI Extraction
- `web-ui/src/utils/signalDetailUtils.jsx`:
  - `planPrimaryTp()` — reads `execution_plan.tp1.price` first
  - `planTpLevel()` — reads `execution_plan.tp{N}.price` first
  - `extractTradePlanFromSignal()` — all fields mapped to new schema paths
  - `extractTradePlanFromTrade()` — all fields mapped to new schema paths
  - `firstTradePlan()` — handles bare arrays `[{...}]` at root

### 6. Field Mapping Document
- `.agents/sync/HANDOFF_TRADE_PLAN_SCHEMA_TO_UI_MAPPING.md` — complete field-by-field mapping

## Current Flow
```
AI prompt: [{...trade_plan_schema...}]  (array)
     ↓
Claude returns: [{symbol:"XAUUSD", execution_plan:{entry:{price:4522},...}}]
     ↓
Server: parsedJson = response[0]  (first plan, no wrapping)
     ↓
DB: trades.raw_json = parsedJson  (exact plan object)
     ↓
UI: firstTradePlan(raw_json) → extractTradePlanFromTrade()
     ↓
Editor: entry = plan.execution_plan.entry.price
```

## Files Touched (this session)
| File | Change |
|------|--------|
| `config/ai_response_schema.json` | DELETED |
| `config/trade_plan_schema.json` | Canonical schema |
| `webhook/server.js` | AI handler simplification, `{"0":{...}}` → `[{...}]`, raw response logging, autoSave fix |
| `web-ui/src/pages/ai/AiPromptBuilder.js` | `buildSchemaString` array fix, schema import from trade_plan_schema |
| `web-ui/src/utils/signalDetailUtils.jsx` | New schema path extraction |
| `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | Nav buttons, hide analysis on trade route |
| `web-ui/src/components/TradePlanEditor.jsx` | RR sliders, note removal |
| `web-ui/src/components/charts/SymbolChart.jsx` | Static chart wiring, quick trade |
| `web-ui/src/api.js` | Chart objects API, Draft trade API, signals→trades fix |
| `.agents/rules/safety.md` | Added schema contract rule |
| `.agents/sync/HANDOFF_TRADE_PLAN_SCHEMA_TO_UI_MAPPING.md` | Field mapping doc |

## Verification
- [ ] Run AI analysis → prompt shows `[{...}]` (array, not `{"0":{...}}`)
- [ ] AI response stored exact in `logs.metadata->>'raw_response'`
- [ ] `raw_json` on trade row = exact plan object (not wrapped)
- [ ] UI editor shows entry, sl, tp from `execution_plan.*.price`
- [ ] No `normalizeAiAnalysisContract` or `attachCanonicalAiRaw` in AI flow
