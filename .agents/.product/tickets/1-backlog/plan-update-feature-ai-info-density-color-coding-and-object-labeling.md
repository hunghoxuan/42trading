# AI info density, semantic color coding, and object label composition

## Meta
- Ticket Type: `Update Feature`
- Ticket Status: `Plan`
- Owner: `Codex`
- Updated: `2026-05-20 11:55 UTC`

## Problem
Current AI detail and object editor UI is readable but low-density and low-signal for fast decisioning:

1. Screen 1 badge info (strategy/entry/grade/risk/confidence/eta/action) is not mirrored in Screen 2 summary area.
2. Critical semantic fields (yes/no, true/false, high/low, proceed/danger/warning/normal) are plain text instead of color-coded status cues.
3. Context/info blocks are too sparse and consume too much vertical space.
4. Object editor form layout is too wide and low-density.
5. Chart object line label does not include both Type and Label after Type changes.

## User Requirements (from screenshots)
- Screen 1 -> Screen 2: display same key decision badges in Screen 2 with semantic colors:
  - Green: most OK, can proceed
  - Red: danger
  - Yellow: warning
  - White: normal/neutral
- Screen 3: render info in `4` or `5` columns to save space.
- Screen 4: colorize `[Yes/No]`, `[True/False]`, `[High/Low]` and similar status values using the same semantic palette.
- Screen 5:
  - use `6` columns layout to save space.
  - when Type changes, chart line label format must be: `type + label`.

## Investigation
- Likely primary files:
  - `src/ui/src/components/SignalDetailCard.jsx`
  - `src/ui/src/components/charts/SymbolChart.jsx`
  - `src/ui/src/components/TradePlanEditor.jsx`
  - object/overlay editor component(s) under `src/ui/src/components/charts/` or related object panel modules.
- Existing UI already has badge primitives and chart object controls, so this should be a focused layout/formatting pass, not a new system.

## Solution
1. Replicate Screen 1 decision badges into Screen 2 summary/header zone.
2. Add semantic badge/text class mapping for categorical values:
   - positive/proceed/yes/true/high-confidence -> green
   - danger/no/false/block/reject/high-risk -> red
   - warning/caution/medium/needs-check -> yellow
   - neutral/unknown/normal -> white
3. Convert Screen 3 context/info cards to responsive dense grid:
   - desktop: 5 columns target, fallback 4 when width constrained
   - tablet/mobile: reduce columns responsively without overlap.
4. Apply semantic color mapping inside Screen 4 risk filter rows and similar boolean/enum fields.
5. Convert Screen 5 object editor controls to 6-column dense layout on desktop with responsive collapse on smaller viewports.
6. Update object label computation so rendered chart label is always:
   - `<type> <label>`
   - recomputed when Type changes
   - avoid duplicate prefix (if label already starts with type, keep one prefix only).

## Expected Output / Verification
- [ ] Screen 2 shows the same key decision badges as Screen 1 (strategy, entry, grade, risk, confidence, eta, action).
- [ ] Badge/status colors follow semantic mapping: green/red/yellow/white.
- [ ] Screen 3 info layout renders in 4-5 columns on desktop, with no overlap/clipping.
- [ ] Screen 4 Yes/No, True/False, High/Low and similar fields are semantically colorized.
- [ ] Screen 5 object editor uses 6-column dense layout on desktop and remains readable on smaller widths.
- [ ] Changing object Type updates displayed chart label to `type + label`.
- [ ] Duplicate type prefixes are not shown in label text.
- [ ] `rtk npm --prefix src/ui run build`
- [ ] Visual verification with provided screenshots 1-5 parity goals.

## Constraints
- Keep scope to UI presentation/layout/label composition only.
- Do not change backend schema or API contracts.
- Preserve existing behavior outside requested surfaces.
- Keep color contrast accessible on dark background.

## Handoff Prompt
```text
Read:
- .agents/.product/tickets/1-backlog/plan-update-feature-ai-info-density-color-coding-and-object-labeling.md
- AI.md
- .agents/BOOTSTRAP.md
- .agents/rules/ui.md
- .agents/rules/testing.md

Implement:
1) Mirror Screen-1 decision badges into Screen-2 summary.
2) Add semantic color coding for statuses (green/red/yellow/white).
3) Make Screen-3 info section dense 4-5 columns desktop.
4) Colorize Screen-4 boolean/level values with same semantic map.
5) Make Screen-5 object editor 6-column layout desktop.
6) Ensure line/object label is `type + label` and updates when Type changes.

Checks:
- rtk npm --prefix src/ui run build
- visual verification against the 5 referenced screenshots

Return:
- changed files
- mapping rules used for color semantics
- layout breakpoints used
- verification notes and any remaining edge cases
```
