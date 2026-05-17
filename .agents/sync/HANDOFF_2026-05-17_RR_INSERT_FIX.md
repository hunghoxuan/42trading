# Handoff: RR Display + Save INSERT Fix

Date: 2026-05-17
Owner: codex-gpt5
Status: DONE (local validated, not deployed in this step)

## User Requests Closed
1. RR display should show 1 decimal.
2. Fix save error: `INSERT has more expressions than target columns`.
3. Add unit-test coverage for canonical raw-plan precedence.

## Root Causes
- `fanoutSignalTradeV2` had placeholder/typing mismatch in `INSERT INTO trades`:
  - `note` bound as numeric
  - value list used one extra placeholder index
- RR form values were not normalized to 1-decimal consistently.
- `TradePlanSchema` missed canonical `__raw_plan` precedence and missed `multiple_exits.tp3.price`.

## Code Changes
- `webhook/server.js`
  - Fixed `INSERT INTO trades` values mapping in `fanoutSignalTradeV2`:
    - `note` now text-bound
    - placeholder indexes aligned with column count (removes expression mismatch)
- `web-ui/src/utils/signalDetailUtils.jsx`
  - RR text display now `toFixed(1)`
  - `applyLinkedPlanChange` now rounds `rr` field to 1 decimal
- `web-ui/src/components/SignalDetailCard.jsx`
  - `normalizeRawPlan` now rounds RR field to 1 decimal
- `web-ui/src/services/TradePlanSchema.js`
  - `extractPlans` now prioritizes `__raw_plan`
  - `tp3` resolver now supports `multiple_exits.tp3.price`
- `web-ui/tests/unit/tradePlanSchema.test.mjs` (new)
  - Regression test: canonical `__raw_plan` overrides conflicting flattened fields and preserves TP ladder

## Validation Run
- `rtk node --check webhook/server.js` ✅
- `rtk npm --prefix web-ui run test:unit` ✅ (7/7 pass)
- `rtk npm --prefix web-ui run build` ✅

## Notes for Next Agent
- If user asks deploy, deploy from current `main` and verify:
  - `/health` expected version after next bump
  - Signal detail form shows `RR` with 1 decimal
  - Save flow no longer throws INSERT expression mismatch
