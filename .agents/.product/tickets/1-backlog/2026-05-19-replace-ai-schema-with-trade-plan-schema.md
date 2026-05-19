# Ticket: Replace ai_response_schema.json with trade_plan_schema.json, flatten trade_plan to AI response root

## Meta
- Ticket Type: `Refactor`
- Ticket Status: `Done`
- Owner: `DeepSeek`
- Updated: `2026-05-19 10:15 UTC`
- Commit: `eb328458`

## Summary
Delete `config/ai_response_schema.json`. Build AI response schema dynamically from `config/trade_plan_schema.json` using `json_encode`. Change `trade_plan` access path from `root.analysis_data[0].trade_plan[0]` to `root.trade_plan[0]` (same level as `analysis_data`).

## Changes

### Delete
- `config/ai_response_schema.json`

### Backend (`webhook/server.js`)
- Remove `loadAiResponseSchema()` or equivalent that reads `ai_response_schema.json`
- Build AI response schema by loading `trade_plan_schema.json` and wrapping it:
  ```js
  const tradePlanSchema = JSON.parse(fs.readFileSync("config/trade_plan_schema.json"));
  const aiResponseSchema = JSON.stringify({
    analysis_data: [{
      symbol: "",
      multi_timeframes_analysis: { /* keep analysis fields */ },
      trade_plan: [tradePlanSchema]
    }]
  });
  ```
- Update all code that parses AI responses:
  - `firstTradePlan(response)` → read `response.trade_plan[0]` instead of `response.analysis_data[0].trade_plan[0]`
  - Any `raw.analysis_data[0].trade_plan` references → `raw.trade_plan`
  - `buildAiSchemaPromptText()` → generate from trade_plan_schema.json at runtime
- Keep analysis_data path for multi_timeframes_analysis (unchanged)

### UI
- `signalDetailUtils.jsx`: `firstTradePlan()` → prefer `raw.trade_plan[0]`, fallback to old path for backward compat
- Any other `analysis_data[0].trade_plan` references → update

## Non-Goals
- Do not change trade_plan_schema.json structure
- Do not change how trade plans are stored in DB

## Verification
- [ ] `node --check webhook/server.js`
- [ ] `npm run build` (web-ui)
- [ ] AI analysis response parses correctly with new path
- [ ] Trade plans extract correctly from AI responses
