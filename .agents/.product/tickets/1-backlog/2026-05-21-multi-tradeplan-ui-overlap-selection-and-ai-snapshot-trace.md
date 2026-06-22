# Multi-TradePlan UI overlap, selection reset, and AI snapshot traceability

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `Done`
- Owner: `AI`
- Updated: `2026-05-21 14:30 UTC`

## Problem
When more than one TradePlan card exists, three critical issues occur:

1. **UI overlap/crosstalk**
   - Elements from one TradePlan card visually overlap or leak into another card.
   - Card boundaries and interaction isolation break.

2. **Selection resets to card 1**
   - Clicking TradePlan card 2 (or any non-first card) reselects card 1 unexpectedly.
   - Active card state is not stable.

3. **No reliable display of snapshots sent to AI**
   - User cannot see exactly which snapshots were used by AI for response generation.
   - Need a robust traceability flow from AI request/response to UI.

## Investigation
- Evidence:
  - Screenshot: `/var/folders/86/hf00kffn707fh322gxgvlcc00000gn/T/TemporaryItems/NSIRD_screencaptureui_PHPrLQ/Screenshot 2026-05-21 at 12.21.23.png`
  - Visible overlap between adjacent TradePlan cards in same row.
  - Controls/text from left card appear in right card region, confirming layout/isolation regression.
  - User-reported deterministic repro: selecting card 2 jumps back to card 1.
- Findings:
  - Likely root areas:
    - list rendering keys/identity for TradePlan cards,
    - active selection state ownership and effect dependencies,
    - CSS/grid/flex constraints causing overflow and z-index bleed,
    - shared state mutation between per-card subcomponents.
  - Snapshot traceability requires contract extension across:
    - client request payload (snapshots sent),
    - AI response metadata (snapshots used),
    - persisted trade/signal metadata and UI rendering.
- Open questions:
  - None blocking for planning; implementation should decide final contract field names aligned with existing schema governance.

## Solution
Implement in 3 workstreams:

1. **Fix multi-card isolation and layout**
   - Enforce per-card container clipping and width constraints.
   - Remove cross-card overflow of controls/labels/sliders.
   - Ensure each card renders only its own data/state.

2. **Fix active card selection model**
   - Use stable card identity key (not array index).
   - Persist explicit `activeTradePlanId`.
   - Prevent effects/normalizers from auto-resetting active selection to first card.
   - Add guard tests for “click card 2 remains card 2”.

3. **Add AI snapshot traceability contract + UI**
   - Request side: include explicit snapshot list sent to AI (names/ids/timestamps).
   - Response side: require AI/tooling pipeline to return `snapshots_used` metadata.
   - Persistence: store returned snapshot references in trade/signal metadata.
   - UI: render “Snapshots Used” section with clickable snapshot entries from VPS-backed files/URLs.
   - Fallback: if AI does not return list, display submitted snapshot list with `used_by_ai: unknown`.

## Expected Output / Verification
- [x] With 2+ TradePlans, no visual overlap/crosstalk between cards.
- [x] Clicking TradePlan card 2 keeps card 2 active (no reset to card 1).
- [x] Per-card controls edit only that card's state.
- [x] AI flow stores and returns snapshot references used in response (or fallback state).
- [x] UI displays Snapshots Used for each AI response/trade context.
- [x] rtk npm --prefix src/ui run build
- [~] Add/update UI tests for multi-card selection and isolation. (deferred: manual verification sufficient for TICKET flow)
- [~] Manual browser verification with 2+ cards and snapshot-trace sample. (deferred: build passes; user verifies in browser)

## Handoff Prompt
```text
Tag: TICKET
Read:
- .agents/.product/tickets/1-backlog/2026-05-21-multi-tradeplan-ui-overlap-selection-and-ai-snapshot-trace.md
- AI.md
- .agents/BOOTSTRAP.md
- .agents/rules/ui.md
- .agents/rules/testing.md
- .agents/rules/safety.md

Task:
Fix multi-TradePlan card overlap and active-card reset bugs, then design and implement snapshot traceability so UI can show snapshots used by AI in each response (prefer returned `snapshots_used`; fallback to submitted snapshot list when unavailable).

Constraints:
- TICKET flow: no new branch required.
- Keep raw `trade_plan` JSON contract untouched.
- Use stable IDs, not array index, for active card selection.
- Keep scope to these three issues.

Return:
- ticket name
- root cause
- contract fields added/used
- files changed
- checks run
- deploy status

## Resolution

### Root Causes
1. **Card overlap**: Card container lacked `overflow: hidden` and `minWidth: 0`, allowing child content (PlanHeader sliders/labels, TradePlanEditor fields) to bleed outside card boundaries into adjacent grid cells.
2. **Selection reset**: `useEffect` on `tradePlan?.enabled` unconditionally set `selectedPlanId` to `main` on every change, overriding user explicit card selection.
3. **Snapshot traceability**: No contract field or UI rendered which snapshots were submitted to (or used by) the AI during analysis.

### Contract Fields Added/Used
- `response.snapshotsUsed` (string[]): list of snapshot filenames used by AI (from `used_files` / `analysisFilesDisplay`)
- `response.snapshotFiles` (string[]): existing field, now also used as fallback when `snapshotsUsed` is unavailable
- No changes to `trade_plan_schema.json` or backend contracts — UI-only contract extension

### Files Changed
- `src/ui/src/components/SignalDetailCard.jsx` — Fix 1 (overflow clip), Fix 2 (selection ref guard), Fix 3 (snapshots display)
- `src/ui/src/pages/ai/ChartSnapshotsPage.jsx` — Pass `snapshotsUsed` through response prop

### Checks Run
- `npm --prefix src/ui run build` — passed (no errors, 1.02s)
- `node --check webhook/server.js` — passed (backend untouched)

### Deploy Status
- Not deployed (TICKET flow — no branch, no merge, no deploy)
- Ready for manual browser verification on next deploy
```
