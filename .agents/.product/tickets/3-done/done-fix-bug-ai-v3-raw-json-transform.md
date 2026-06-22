# Fix AI v3 raw JSON transform

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `Done`
- Owner: `Codex`
- Updated: `2026-05-19 17:35 UTC`

## Problem
Current/future Claude AI v3 trade-plan responses were still being collapsed into a legacy flat editor shape in the UI path. The user showed `AI_RESPONSE.raw_json` for log `609933` containing full CADJPY fields (`context`, `analysis`, `execution_plan`, `risk_management`), while the UI JSON tab showed a compact `__raw_plan` containing only legacy fields like `entry`, `sl`, `tp`, `tp2`, `tp3`, `rr`, and empty checklist fields.

Screenshot evidence:
- Image #1: Raw Analysis panel shows `trade_plan` object with flattened fields for `CADJPY`, including `direction: SELL`, `entry: 115.65`, `sl: 116.15`, `tp: 115.13`, `tp2: 114.8`, `tp3: 114.2`, `rr: 3.4`.
- Image #2: Trade editor JSON tab shows `__raw_plan` with the same flattened CADJPY object, proving the UI presented derived editor state as raw data.

## Investigation
- Evidence:
  - `/system/logs/609933` `AI_RESPONSE.raw_json` contains the rich Claude v3 object.
  - `src/ui/src/pages/ai/ChartSnapshotsPage.jsx` ran `normalizeAnalysisContract(parsed)` inside `enrichParsedAnalysis()`.
  - `normalizeAnalysisContract()` mapped `trade_plan` into old flat fields when no legacy `market_analysis` existed.
  - `src/ui/src/components/SignalDetailCard.jsx` displayed `selectedPlanRaw` in AI JSON mode, not guaranteed full raw response.
  - `src/ui/src/utils/signalDetailUtils.jsx` did not recognize a direct v3 plan whose prices live under `execution_plan`.
- Findings:
  - Raw AI data was not lost in the AI_RESPONSE log, but the active UI/editor path could still flatten it and label the flattened object as `__raw_plan`.
  - Direct v3 plan objects were not recognized by the shared trade-plan extractor before this fix.
- Open questions:
  - Existing historical rows already saved with flattened `raw_json` cannot be reconstructed unless their original `AI_RESPONSE` log is used.

## Solution
- Added a regression test proving direct v3 AI plan objects are extracted as the exact same object.
- Updated current/future v3 detection so direct AI plan objects with nested `execution_plan` pass through as raw payloads.
- Stopped current v3 plans from going through the legacy flat trade-plan mapper in the AI analysis UI path.
- Updated trade detail extraction/rendering to derive editor fields from nested `execution_plan` while preserving the original raw object.
- Disabled the old server `normalizeAiAnalysisContract()` body so it cannot reshape AI payloads if accidentally called.

## Expected Output / Verification
- [x] `rtk npm --prefix src/ui run test:unit -- tradePlanSchema.test.mjs`
- [x] `rtk npm --prefix src/ui run test:unit`
- [x] `rtk node --check webhook/server.js`
- [x] `rtk npm --prefix src/ui run build`
- [ ] Version bump committed
- [ ] Deploy completed
- [ ] Live `/health` and UI asset verified

## Handoff Prompt
```text
Read:
- .agents/.product/tickets/3-done/done-fix-bug-ai-v3-raw-json-transform.md
- AI.md
- .agents/BOOTSTRAP.md
- .agents/rules/deploy.md

Task:
Verify current/future AI v3 responses are stored and displayed without flattening. Use a fresh analyze response and confirm `raw_json`/JSON tab keeps `context`, `analysis`, `execution_plan`, and `risk_management`.

Constraints:
- Do not reintroduce legacy `trade_plan` flattening for v3 AI schema.
- Editor/display fields may be derived, but raw payload must remain exact.
- Preserve deployment SOP and version checks.

Return:
- root cause / change summary
- files changed
- checks run
- deploy status
```
