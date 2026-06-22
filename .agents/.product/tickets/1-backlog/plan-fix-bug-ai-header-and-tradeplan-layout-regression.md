# AI Header + TradePlan Layout Regression (Analyze button + slider overlap)

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `Plan`
- Owner: `N/A`
- Updated: `2026-05-19 10:05 UTC`

## Problem
Multiple UI regressions reported after recent AI/trade header and editor updates:

1. Header consistency regression (screen 1):
   - Health page / general UI density and spacing feel inconsistent with current app style.
   - Need unified visual rhythm (cards, row spacing, typography hierarchy, status labels).

2. TradePlan slider clipping/overlap regression (screen 2):
   - Right-side slider handles and plus buttons are clipped/cut off.
   - SL/RR/RR2/RR3 labels overlap with Entry/TP/TP2/TP3 slider tracks.
   - Control row width and grid structure are not robust for current viewport/content.

3. Analyze action regression (screen 3):
   - Analyze button behavior changed/replaced by `< List` + `Trade` pairing in this context.
   - User requested restore: **Analyze button should call AI like before**.

## Investigation

### Screenshot evidence
- Screen 1: health page with compact cards and section spacing mismatch concerns.
- Screen 2: trade editor rows showing clipped right controls and overlapping center labels.
- Screen 3: AI bar shows `< List` and `Trade`; expected Analyze action path missing in this placement.

### Change trace (who replaced Analyze)
- Git history confirms commit:
  - `81bf521e0dda6feba4fa7edb22ee8da1633e02c2`
  - Author: `Hung Ho <classondev@gmail.com>`
  - Date: `Tue May 19 11:07:33 2026 +0200`
  - Message: `feat: AI nav buttons, TradePlan RR sliders, static chart wiring, close auto-snapshot, chart objects API`
- Files touched include:
  - `src/ui/src/pages/ai/ChartSnapshotsPage.jsx`
  - `src/ui/src/components/TradePlanEditor.jsx`
  - `src/ui/src/components/charts/SymbolChart.jsx`

## Solution
1. **Restore Analyze behavior in target context**
   - Bring back explicit `Analyze` button where user initiates AI call.
   - Keep `< List` as secondary navigation action.
   - Ensure Analyze route/action triggers same AI workflow as pre-regression path.

2. **Fix TradePlan editor layout**
   - Refactor row grid widths to prevent clipping on right-side controls.
   - Separate label column from slider track with minimum width constraints.
   - Ensure SL/RR/RR2/RR3 labels never overlap Entry/TP/TP2/TP3 sliders.
   - Validate on common viewport widths shown in screenshots.

3. **Health/UI consistency pass**
   - Harmonize section spacing, typography weights/sizes, and row density.
   - Keep existing information architecture; adjust styling only.

## Expected Output / Verification
- [ ] Analyze button restored in requested context and triggers AI call.
- [ ] `< List` remains available and works.
- [ ] TradePlan slider tracks/labels/plus controls are fully visible (no clipping) on screenshot-size viewport.
- [ ] SL/RR/RR2/RR3 labels do not overlap neighboring controls.
- [ ] Health page visual rhythm matches app-wide style conventions.
- [ ] `rtk npm --prefix src/ui run build` passes.

