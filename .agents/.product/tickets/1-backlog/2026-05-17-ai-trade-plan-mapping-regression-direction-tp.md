# Ticket: AI Trade Plan Mapping Regression (Direction + Multi-TP)

## Status
- BACKLOG (HOTFIX PRIORITY)

## Summary
AI payloads that include both flattened plan fields and `__raw_plan` are being mapped inconsistently in UI extraction:
- direction can flip (`SELL` -> `BUY`)
- TP ladder (`tp1/tp2/tp3`) can collapse to single TP
- rich risk/entry metadata can be dropped

This creates wrong prefilled order forms and invalid side/TP semantics.

## Scope
- `src/ui/src/utils/signalDetailUtils.jsx`

## Repro (from user report)
- `__raw_plan.direction = SELL`
- flattened `direction = BUY`
- UI prefill shows `BUY` with `entry 78280 / tp 77700 / sl 78620`
- `tp2/tp3` not populated though present in `__raw_plan.multiple_exits`

## Root Cause
- Extractor did not prioritize `__raw_plan` as canonical source when present.
- Side resolution preferred `signal.action`/flattened values over raw plan direction.
- TP-level extraction did not consistently map `multiple_exits.tp1/tp2/tp3/full_tp`.
- Checklist object shape (`entry_checklists` boolean map) was not normalized for UI consumption.

## Fix Plan
- [x] Read `__raw_plan` in first-plan extraction candidates.
- [x] Prefer plan direction over flattened/action fallback for side.
- [x] Resolve TP ladder from `multiple_exits` and legacy fields deterministically.
- [x] Normalize checklist object maps to arrays of passed keys.
- [x] Keep legacy fallbacks to avoid breaking older payload shapes.

## Acceptance Criteria
- For mixed payloads, UI form direction must match `__raw_plan.direction`.
- `tp1/tp2/tp3` must prefill when present in `multiple_exits`.
- `tp` alias remains coherent with primary TP (`tp1`) compatibility path.
- Checklist data from object-shaped fields is visible in UI model.

## Validation
- [ ] Unit/utility test case for mixed payload (`__raw_plan` + flattened conflict).
- [ ] Manual verify signal detail prefill with provided BTCUSD sample.
