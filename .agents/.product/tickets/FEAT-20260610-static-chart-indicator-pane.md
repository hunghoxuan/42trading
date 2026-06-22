# Sample Feature Ticket

## Meta
- ID: `FEAT-20260610-STATIC-INDICATOR-PANE`
- Owner: `Codex`
- Mode: `Feature-Pod`
- Status: `ACTIVE`

## Outcome
- Extend the existing static chart in 42Trade with:
- an indicator sub-pane under the price chart
- an indicator visibility panel
- dummy indicator data wiring for first delivery

## Scope
- `src/ui/src/components/TradeSignalChart.jsx`
- `src/ui/src/pages/ai/ChartSnapshotsPage.jsx`
- optional new helper files under `src/ui/src/components/chart/` or `src/ui/src/utils/` if needed for indicator config and dummy-series generation

## Out Of Scope
- Replacing 42Trade chart with ChronosTrade chart
- Rewriting current 42Trade data-fetch / snapshot / plan-line behavior
- Real indicator persistence or DB schema
- Live indicator calculation from backend
- Trading logic changes

## Product Requirement
- ONLY extend the current static chart in 42Trade.
- Keep current chart behavior working as-is.
- Do not delete or replace the current 42Trade chart implementation with ChronosTrade code.
- Add the missing UX shown in Chronos screenshots:
- bottom oscillator pane
- indicator side panel / popover with visibility toggles
- first version uses dummy indicator data

## Current 42Trade Baseline
- Main chart renderer is [`TradeSignalChart.jsx`](/Users/macmini/Projects/moza/42trade/src/ui/src/components/TradeSignalChart.jsx:439).
- Chart bootstraps a single `lightweight-charts` candlestick chart via `createChart(...)` at [`TradeSignalChart.jsx`](/Users/macmini/Projects/moza/42trade/src/ui/src/components/TradeSignalChart.jsx:523).
- The current implementation adds one candlestick series and many overlays / primitives, but no indicator pane and no indicator toggle UI.
- The AI trade screen mounts this chart directly in [`ChartSnapshotsPage.jsx`](/Users/macmini/Projects/moza/42trade/src/ui/src/pages/ai/ChartSnapshotsPage.jsx:8535).

## ChronosTrade Reference Findings
- ChronosTrade has a dedicated multi-pane chart component in [`MultiPaneChart.tsx`](/Users/macmini/Tech/ChronosTrade/web/src/components/chart/MultiPaneChart.tsx:65).
- It separates chart plumbing into a small wrapper hook in [`useChartEngine.ts`](/Users/macmini/Tech/ChronosTrade/web/src/hooks/useChartEngine.ts:24).
- The engine wrapper explicitly supports pane layout heights at [`useChartEngine.ts`](/Users/macmini/Tech/ChronosTrade/web/src/hooks/useChartEngine.ts:73) and [`useChartEngine.ts`](/Users/macmini/Tech/ChronosTrade/web/src/hooks/useChartEngine.ts:162).
- Chronos populates these indicator series:
- `rsi`
- `rsi_ema9`
- `rsi_wma45`
- `sma20`
- `sma50`
- `sma200`
- Full indicator set is recalculated on initial load and when more candles or latest candles arrive at [`MultiPaneChart.tsx`](/Users/macmini/Tech/ChronosTrade/web/src/components/chart/MultiPaneChart.tsx:594) and [`MultiPaneChart.tsx`](/Users/macmini/Tech/ChronosTrade/web/src/components/chart/MultiPaneChart.tsx:660).
- Tail updates for real-time behavior are handled at [`MultiPaneChart.tsx`](/Users/macmini/Tech/ChronosTrade/web/src/components/chart/MultiPaneChart.tsx:721).

## Gap Summary
- 42Trade already has a strong custom static chart with candle rendering, markers, price lines, primitives, crosshair sync, viewport sync, and snapshot/cache loading.
- 42Trade is missing only the indicator visualization layer:
- no secondary pane
- no indicator series registration
- no indicator visibility state
- no indicator panel entrypoint
- no indicator legend chips / right-edge values for oscillator lines

## Tech - Solution

### Principle
- Preserve `TradeSignalChart` as the owner of chart lifecycle.
- Add indicator support incrementally inside the current component instead of swapping in ChronosTrade architecture.
- Borrow the idea, not the code: pane split, indicator registry, visibility toggles, and line-series setup.

### Proposed 42Trade implementation
1. Add local indicator config inside 42Trade.
- Define a lightweight config list for:
- `RSI (14)`
- `RSI EMA (9)`
- `RSI WMA (45)`
- `SMA (20)`
- `SMA (50)`
- `SMA (200)`
- Include keys, colors, pane target, label text, and default visibility.

2. Extend `TradeSignalChart` props safely.
- Add optional props such as:
- `showIndicatorsPanel = true`
- `defaultIndicatorVisibility`
- `indicatorMode = "dummy"`
- Keep all new props optional so existing callers do not break.

3. Keep one chart instance, add multi-pane support.
- Use the current `createChart(...)` path in `TradeSignalChart`.
- Apply pane layout options to split price and oscillator pane rather than introducing a new chart wrapper immediately.
- Target layout similar to Chronos:
- price pane about `80%`
- oscillator pane about `20%`

4. Register extra line series after candle series init.
- Main price pane:
- `SMA 20`
- `SMA 50`
- `SMA 200`
- Lower oscillator pane:
- `RSI 14`
- `RSI EMA 9`
- `RSI WMA 45`
- Keep references in local refs/maps so visibility can be toggled without chart recreation.

5. Dummy indicator data only for v1.
- Build dummy series from the already-loaded candle timestamps.
- Requirements for dummy data:
- same time axis as candle bars
- visually stable
- no backend dependency
- no DB dependency
- Suggested dummy behavior:
- RSI lines: bounded between `20` and `80`, with seeded deterministic wave values so the chart looks realistic and repeatable.
- SMA lines: derive simple offset lines from candle close values or lightweight client-side moving averages if easier.
- Important:
- even if SMA/RSI values are synthetic, timestamps must align 1:1 with valid candle bars so `lightweight-charts` stays stable.

6. Add lower-pane guides.
- Draw fixed horizontal guide levels at:
- `70`
- `50`
- `30`
- Style them to match the Chronos screenshot feel.
- Show right-side labels for these levels if practical within current library options; otherwise render lightweight absolute-positioned labels as overlay DOM.

7. Add indicator panel UI without disturbing current chart container.
- Add a compact `Indicators` trigger/button in the chart header area closest to current trade chart controls.
- On click, open a small right-side panel/popover listing grouped indicators:
- `Momentum`
- `RSI (14)`
- `RSI EMA (9)`
- `RSI WMA (45)`
- `Trend`
- `SMA (20)`
- `SMA (50)`
- `SMA (200)`
- Each row toggles visibility via eye icon or simple active state.
- The panel can be local-state only in first version.

8. Add right-edge live value chips for visible oscillator lines.
- Mirror the Chronos screenshot behavior with small colored labels for visible RSI-series values.
- These can be rendered as DOM overlay positioned from `priceToCoordinate` on the oscillator pane series.
- If pane-specific coordinate mapping becomes awkward in v1, a simpler static legend block is acceptable for first pass, but the ticket target should remain right-edge chips.

9. Keep current chart features intact.
- Preserve:
- bar loading logic
- snapshot/cache usage
- entry/SL/TP price lines
- markers
- shared lines/objects
- viewport sync
- crosshair sync
- current theme handling

### Suggested file shape
- Keep most work in [`TradeSignalChart.jsx`](/Users/macmini/Projects/moza/42trade/src/ui/src/components/TradeSignalChart.jsx:439) for the first pass.
- If the file becomes too large, extract only these helpers:
- `indicatorConfig.js`
- `buildDummyIndicatorSeries.js`
- `IndicatorPanel.jsx`

## Data Contract For Dummy Indicators
- Input:
- validated candle bars already assembled by `TradeSignalChart`
- Output:
- `sma20`: `{ time, value }[]`
- `sma50`: `{ time, value }[]`
- `sma200`: `{ time, value }[]`
- `rsi`: `{ time, value }[]`
- `rsiEma9`: `{ time, value }[]`
- `rsiWma45`: `{ time, value }[]`
- Visibility state example:

```js
{
  rsi: true,
  rsiEma9: true,
  rsiWma45: true,
  sma20: false,
  sma50: false,
  sma200: false
}
```

## Implementation Notes
- Do not move chart ownership away from `TradeSignalChart`.
- Do not introduce backend calls for indicators in this ticket.
- Do not depend on Chronos state stores, hooks, or typings.
- If `lightweight-charts` version in 42Trade does not support the exact pane API used by Chronos, solve it in-place for 42Trade rather than forcing a broader refactor.
- If pane API friction is high, acceptable fallback for phase 1 is:
- single `TradeSignalChart` container with a chart pane plus a synchronized lower mini-chart pane stacked beneath it
- but only use this fallback if same-instance multi-pane is not possible with the existing package version

## Acceptance Criteria
- Existing `TradeSignalChart` still renders candles and current plan overlays with no feature loss.
- User can open an `Indicators` panel from the chart area.
- User can toggle visibility for:
- `RSI (14)`
- `RSI EMA (9)`
- `RSI WMA (45)`
- `SMA (20)`
- `SMA (50)`
- `SMA (200)`
- A lower indicator pane is visible under the main price chart.
- Lower pane renders dummy RSI-family lines on valid timestamps.
- Main pane renders dummy SMA-family lines on valid timestamps.
- No backend or DB dependency is required for the first release.
- The new feature is additive only; existing chart code path remains recognizable and intact.

## Dependency Gates
- Gate 1: indicator config + dummy data builder introduced
- Gate 2: chart registers extra series without breaking current overlays
- Gate 3: lower pane renders and guide levels display
- Gate 4: indicator panel toggles visibility
- Gate 5: chart page mount remains compatible in AI trade screen

## Suggested Delivery Order
1. Add indicator config + deterministic dummy data helpers.
2. Add series refs and register series in `TradeSignalChart`.
3. Add pane split and lower-pane guide levels.
4. Add indicator panel UI and visibility state.
5. Add right-edge indicator value labels.

## Risks
- `TradeSignalChart.jsx` is already large, so careless edits can destabilize current chart features.
- `lightweight-charts` pane support may differ from ChronosTrade’s version usage.
- Overlay DOM positioning for lower-pane labels may need extra care on resize and theme changes.

## Recommended Engineering Approach
- Keep the first PR narrow and additive.
- Avoid trying to port Chronos wholesale.
- Treat Chronos as a visual/structural reference only:
- multi-pane layout
- indicator registry
- visibility toggles
- line-series grouping by pane

## Checks
- Manual UI smoke test on the AI trade screen where `TradeSignalChart` is mounted.
- Confirm existing candles, entry/SL/TP lines, and snapshot-driven rendering still show.
- Confirm indicator toggles hide/show without chart re-init loops.

## Handoff Requirement
- Post final handoff in `.agents/sync/MAILBOX.md` using `agent-handoff.md`.
