# Files-tab snapshots and Info chart TP2/TP3 reset regression

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `Done`
- Owner: `Codex`
- Updated: `2026-05-21 13:56 UTC`

## Problem
Three user-visible regressions remain in AI Trade detail flow:

1. **Snapshots used by AI placement**
   - Current: shown in response area/card header.
   - Required: move/show inside `Files` tab (screen 1), so all file artifacts are centralized.

2. **Info chart missing TP2/TP3**
   - TradePlan editor shows TP1/TP2/TP3 values (screen 2).
   - Info chart overlay shows only TP1 line/label (screen 3).
   - Required: render TP1 + TP2 + TP3 consistently on Info chart.

3. **Plan edits keep resetting**
   - User changes SL/TP/RR; state reverts back to original values.
   - Required: edits must persist and not be overwritten by stale normalization/effect loops unless value is truly invalid per constraints.

## Investigation
- Evidence:
  - Screen 1: `/var/folders/86/hf00kffn707fh322gxgvlcc00000gn/T/TemporaryItems/NSIRD_screencaptureui_m2qnOH/Screenshot 2026-05-21 at 15.46.23.png`
  - Screen 2: `/var/folders/86/hf00kffn707fh322gxgvlcc00000gn/T/TemporaryItems/NSIRD_screencaptureui_PVfgMT/Screenshot 2026-05-21 at 15.46.59.png`
  - Screen 3: `/var/folders/86/hf00kffn707fh322gxgvlcc00000gn/T/TemporaryItems/NSIRD_screencaptureui_ImDX4h/Screenshot 2026-05-21 at 15.47.07.png`
- Findings:
  - Snapshot placement was hard-coded directly below the trade-plan card in `SignalDetailCard`, so it appeared in the response area instead of the centralized Files tab.
  - Info/chart overlay path passed TP2/TP3 through `TradeSignalChart` as possibly-string props, but the primary plan builder used `Number.isFinite(rawValue)`, which rejects numeric strings and dropped TP2/TP3 before drawing lines.
  - Plan resets came from `SignalDetailCard` draft rehydration. Its merge helper preferred non-empty source plan values over previous draft values for editable fields on every render, overwriting valid user edits.
- Open questions:
  - None blocking implementation.

## Solution
Implemented three focused fixes:

1. **Files tab snapshots**
   - Moved snapshot traceability rendering into `TradeFilesTab`.
   - Passed `snapshotsUsed` / `snapshotFiles` from `SignalDetailCard` into the Files tab.
   - Kept submitted-file fallback when the AI-used list is unavailable.

2. **TP2/TP3 in Info chart**
   - Added `normalizePlanLinePrice` so numeric string prices are accepted for chart lines.
   - Used the normalized TP1/TP2/TP3 values when building the primary chart plan.
   - Updated `InfoTabChart` to pass TP1/TP2/TP3 and enable primary plan overlays.

3. **Stop edit reset**
   - Added `mergePlanPreservingEdits` and wired draft hydration through it.
   - Editable fields (`entry`, `sl`, `tp`, `tp1`, `tp2`, `tp3`, `rr`, etc.) now preserve previous draft/user edits across rerenders instead of being replaced by non-empty source values.
   - Raw JSON payloads remain untouched; changes affect normalized UI drafts only.

## Expected Output / Verification
- [x] `Snapshots used by AI` appears inside `Files` tab by component placement.
- [x] Info chart shows TP1, TP2, TP3 lines when values exist and arrive as numbers or numeric strings.
- [x] Editing SL/TP/RR does not revert to original values after rerender per focused unit coverage.
- [x] Selected plan retains its own edits without cross-plan overwrite per draft merge behavior.
- [x] `rtk npm --prefix web-ui run test:unit -- tests/unit/tradePlanDrafts.test.mjs`
- [x] `rtk npm --prefix web-ui run build`
- [ ] Browser verification with screenshots for protected trade detail screen. Local Vite started, but clean in-app browser stopped at authentication.

## Handoff Prompt
```text
Tag: TICKET
Read:
- .agents/.product/tickets/1-backlog/2026-05-21-files-tab-snapshots-and-info-chart-tp23-reset-regression.md
- AI.md
- .agents/BOOTSTRAP.md
- .agents/rules/ui.md
- .agents/rules/testing.md
- .agents/rules/safety.md

Task:
Fix 3 regressions: move snapshots-used UI into Files tab, render TP2/TP3 on Info chart with TP1, and stop SL/TP/RR edits from resetting to original values.

Constraints:
- Preserve canonical raw JSON contract.
- Keep scope to these 3 UI/state issues.
- No fallback overwrite of valid user edits.

Return:
- ticket name
- root cause per issue
- files changed
- checks run
- deploy status
```
