# Trade Chart Overlay Handoff

## Purpose

This document records the final display rules, data rules, viewport rules, and regression fixes for the trade chart overlays used in:

- backtest trades
- real trades
- Chart mode
- SVG mode

The goal is simple: if the chart breaks again, we should be able to either restore the behavior quickly or reimplement it without rediscovering the same bugs.

## Current UX Rules

### Modes

- `Chart` is the default mode.
- `SVG` remains available as the alternate static mode.
- `Play` was renamed to `Replay`.

### Visible trade levels

Only these planned levels should be shown on the chart:

- `SL`
- `Entry`
- `TP1`

Do not show:

- `TP2`
- `TP3`

This rule now applies to both backtest and real-trade charts.

### Price-line styling

- `SL`: dotted red line, red price badge, white text
- `TP1`: dotted green line, green price badge, white text
- `Entry`: dotted white line, white price badge, dark text if needed for contrast

If contrast is poor, it is acceptable to use vivid badge backgrounds for markers and keep marker text white.

### Event markers

- `Created`: marker label only, no white vertical created line
- `Opened`: white solid line only if `openedAt` is truly present
- `Closed`: solid line at the actual resolved close/exit display price

Marker text rules:

- `Created`: `B | <strategy>` or `S | <strategy>`
- `Opened`: `opened`
- `Closed`: `TP | <pnl>` or `SL | <pnl>` or `Closed | <pnl>` depending on close type

Color rules:

- `B` markers should use the buy color treatment
- `S` markers should use the sell red treatment
- close markers should use green for profit and red for loss

## Viewport Rules

### Default intent

When a trade is selected and the chart is not replaying, the viewport should focus on the trade itself, not the latest market bars.

That means:

- show bars around the trade time
- keep `SL`, `Entry`, and `TP1` inside the visible price window
- keep the relevant trade bar visible inside the chart window
- avoid pinning the active bar to the far right edge

### Pending and filled trades

For active trades, the window should still include the relevant current bar, but the chart must be auto-fit so:

- `SL`
- `Entry`
- `TP1`
- the active last bar

all stay visible together as much as possible.

### Closed trades

For closed trades, the viewport must respect the `closed_at` bar instead of drifting to the latest live/current market bar.

## Auto-fit Behavior

The current viewport helper is:

- [src/admin/components/TradeSignalChart.jsx](/Users/macmini/Projects/moza/42trade/src/admin/components/TradeSignalChart.jsx)
  - `autoFitWindow()`

### What `autoFitWindow()` currently does

1. Enables chart auto-scaling with `priceScale().setAutoScale(true)`.
2. Sets a focused logical time range so the relevant trade bar is visible.
3. Keeps the trade window slightly left of the right edge instead of hard-sticking the last bar to the edge.
4. For closed trades, targets the `closed_at` bar.
5. For pending/filled trades, targets the active/latest relevant bar.
6. Expands the price range when needed so `SL`, `Entry`, and `TP1` are included.

### Important note

The user observed that manually double-clicking the price scale gives a good fit. We could not rely on a true `priceScale().fitContent()` API for this workflow, so the current implementation mimics that behavior using:

- `priceScale().setAutoScale(true)`
- custom logical range control
- custom price-range expansion when key levels are outside the current range

## Data Rules

### Executed values must win over planned values

When present, use execution values before planned values:

- `entry_exec` before `entry`
- `sl_exec` before `sl`
- `tp_exec` before `tp`
- `exit_price` before inferred fallback

This was necessary because some trades had a planned entry different from the actual filled entry, which made markers and lines look wrong even when the chart bars were correct.

The main mapping lives in:

- [src/admin/components/SignalDetailCard.jsx](/Users/macmini/Projects/moza/42trade/src/admin/components/SignalDetailCard.jsx)

### Time field rules

Use the real timestamp fields:

- `createdAt`
- `openedAt`
- `closedAt`

Use the `*Sec` values only as normalized derived values after validation.

Do not treat:

- `null`
- `""`
- `0`

as a real event time.

This matters because an invalid `0` was previously being treated like a real timestamp and snapped to the first candle, which created fake markers.

## Key Bugs We Hit

### 1. Chart showed the same latest bars for different trades

Symptom:

- selecting different trades still showed almost the same viewport
- `Entry`, `TP`, and `SL` did not match the visible trade area

Root cause:

- the viewport logic was following recent/live bars instead of the selected trade anchors

Fix:

- trade-focused viewport logic was restored
- `autoFitWindow()` now anchors the chart around the selected trade window
- closed trades now respect `closed_at`

### 2. `opened` marker appeared even when opened time was null

Symptom:

- the chart showed an `opened` marker
- `/info` showed `Opened = -` or `null`

Root causes:

- `null`/empty values were being normalized into bad fallback values
- some event times were snapping to the first visible candle
- `0` could survive normalization and behave like a valid timestamp

Fixes:

- normalization now rejects `0` as a valid event second
- `opened` is only drawn when there is a real `openedAt` or validated `openedAtSec`
- marker time resolution now refuses to snap outside tolerance/range

Relevant files:

- [src/admin/components/charts/backtestChartTheme.js](/Users/macmini/Projects/moza/42trade/src/admin/components/charts/backtestChartTheme.js)
- [src/admin/components/TradeSignalChart.jsx](/Users/macmini/Projects/moza/42trade/src/admin/components/TradeSignalChart.jsx)

### 3. Stale drawings remained on the chart

Symptom:

- old overlay lines or markers stayed visible
- switching trade or timeframe could leave broken artifacts behind

Root cause:

- old overlay artifacts were not being fully cleared before re-render

Fix:

- `clearTradeOverlayArtifacts()` now clears overlay primitives, lines, and markers before redrawing

Relevant file:

- [src/admin/components/TradeSignalChart.jsx](/Users/macmini/Projects/moza/42trade/src/admin/components/TradeSignalChart.jsx)

### 4. Markers pinned to the top or bottom of the chart

Symptom:

- `opened`, `TP`, or `S/B` badge appeared far from the expected price
- some markers sat at the bottom edge even though the real trade price was elsewhere

Root causes:

- marker time snapped to the wrong candle
- close display price sometimes fell back to the wrong business meaning
- price range did not include the relevant level

Fixes:

- added stricter event-to-candle resolution
- improved close display price resolution
- expanded auto-fit price range to include `SL`, `Entry`, and `TP1`

### 5. Manual close trades looked like they hit TP/SL

Symptom:

- a manually closed profitable trade could display a TP-style close line even though `exit_price` was actually missing

Root cause:

- frontend fallback logic was too aggressive and could treat planned TP/SL as if it were the actual close price

Fix:

- for `MANUAL`, `MANUAL_CLOSE`, `CANCEL`, `CANCELLED`, if `exit_price` is missing, do not invent a fake close price from TP/SL

Relevant function:

- `resolveTradeCloseDisplayPrice(...)`

Relevant file:

- [src/admin/components/charts/backtestChartTheme.js](/Users/macmini/Projects/moza/42trade/src/admin/components/charts/backtestChartTheme.js)

### 6. Real trades and backtest trades diverged

Symptom:

- one mode would show markers correctly while the other would not
- user expected both to behave the same

Fix:

- normalized trade-to-chart mapping was pushed into shared helpers
- both `Chart` and `SVG` now consume the same core trade semantics for created/opened/closed/close-label behavior

Relevant files:

- [src/admin/components/charts/backtestChartTheme.js](/Users/macmini/Projects/moza/42trade/src/admin/components/charts/backtestChartTheme.js)
- [src/admin/components/charts/ChartSVG.jsx](/Users/macmini/Projects/moza/42trade/src/admin/components/charts/ChartSVG.jsx)
- [src/admin/components/TradeSignalChart.jsx](/Users/macmini/Projects/moza/42trade/src/admin/components/TradeSignalChart.jsx)

## Backend Fixes

Some chart problems were not frontend-only. We also had to stop the backend from manufacturing misleading trade fields.

### API/server work

Relevant file:

- [src/api/server.js](/Users/macmini/Projects/moza/42trade/src/api/server.js)

Important helpers:

- `mt5ResolveOpenedAtFromPayload(...)`
- `mt5ResolveClosedAtFromPayload(...)`
- `mt5ResolveExitPriceFromPayload(...)`

What changed:

- broker sync now maps real `opened_at`
- broker sync now maps real `closed_at`
- broker sync now maps real `exit_price`
- chart payloads no longer fake `opened_at` from create/ack time

### Repository work

Relevant file:

- [src/api/repositories/tradeRepo.js](/Users/macmini/Projects/moza/42trade/src/api/repositories/tradeRepo.js)

What changed:

- removed synthetic `opened_at` fallback behavior
- preserved `exit_price` in merged trade metadata
- kept execution fields available for frontend mapping

## Files That Matter Most

If this breaks again, start here:

- [src/admin/components/TradeSignalChart.jsx](/Users/macmini/Projects/moza/42trade/src/admin/components/TradeSignalChart.jsx)
  - chart-mode overlays
  - viewport logic
  - marker placement
  - stale overlay cleanup
- [src/admin/components/charts/ChartSVG.jsx](/Users/macmini/Projects/moza/42trade/src/admin/components/charts/ChartSVG.jsx)
  - svg-mode overlays
  - shared label/close semantics
- [src/admin/components/charts/backtestChartTheme.js](/Users/macmini/Projects/moza/42trade/src/admin/components/charts/backtestChartTheme.js)
  - trade normalization
  - side inference
  - label builders
  - close display price logic
- [src/admin/components/SignalDetailCard.jsx](/Users/macmini/Projects/moza/42trade/src/admin/components/SignalDetailCard.jsx)
  - selected trade payload mapping
  - execution value precedence
- [src/admin/components/charts/SymbolChart.jsx](/Users/macmini/Projects/moza/42trade/src/admin/components/charts/SymbolChart.jsx)
  - mode switching
  - fix-button plumbing
  - `autoFitNonce` flow
- [src/api/server.js](/Users/macmini/Projects/moza/42trade/src/api/server.js)
  - broker payload normalization
- [src/api/repositories/tradeRepo.js](/Users/macmini/Projects/moza/42trade/src/api/repositories/tradeRepo.js)
  - persistent trade field merge rules

## Current Practical Rules To Preserve

If we ever refactor this again, preserve these rules together:

1. Chart mode opens by default.
2. Selecting a trade focuses on bars around that trade, not the latest market bars.
3. Pending/filled charts keep the active bar visible.
4. Closed charts stop at the closed trade window.
5. `SL`, `Entry`, and `TP1` must stay visible inside the chart price window.
6. `TP2` and `TP3` must not be rendered on-chart.
7. `opened` must never render when the source data is empty/null.
8. `exit_price` must not be fabricated from TP/SL for manual closes.
9. Execution prices must override planned prices when present.
10. Both Chart and SVG must follow the same event semantics.

## Known Limitation

If the broker/API truly does not provide `exit_price`, we cannot draw a mathematically exact close-price line. In that case the correct behavior is to avoid inventing one from TP/SL and instead show only what the real data supports.

## Regression Checklist

When validating a future fix, check these cases:

1. Pending trade with `created_at` only:
   - created marker visible
   - no opened marker
2. Filled trade with real `opened_at`:
   - opened marker visible on the correct candle
   - no snap to first candle
3. Closed winning trade:
   - close marker is green
   - close line sits on the actual close display price
4. Closed losing trade:
   - close marker is red
   - close line sits on the actual close display price
5. Trade with `entry_exec != entry`:
   - chart uses the executed entry
6. Trade switch across multiple rows:
   - viewport changes per trade
   - stale overlay artifacts do not remain
7. Timeframe changes:
   - `SL`, `Entry`, and `TP1` remain visible
   - the relevant event bar stays inside the chart window

## Suggested Recovery Plan If It Breaks Again

1. Check the selected trade payload in `SignalDetailCard` and confirm the real values passed down.
2. Confirm whether the problem is:
   - bad source data
   - bad normalization
   - bad event-time snapping
   - bad viewport logic
   - stale overlay cleanup
3. Re-test in both:
   - `Chart`
   - `SVG`
4. If behavior differs between modes, compare the mapping in:
   - `TradeSignalChart.jsx`
   - `ChartSVG.jsx`
   against the shared helpers in `backtestChartTheme.js`

## Final Notes

The hardest part of this work was that multiple different failures looked the same on screen:

- bad backend data
- invalid fallback values
- marker snapping to the wrong candle
- viewport drift to the latest bar
- stale overlay redraw bugs

The working solution was not a single fix. It required aligning:

- backend field truth
- frontend normalization
- close-price semantics
- event-marker time validation
- viewport auto-fit behavior
- overlay cleanup

If the UI ever starts feeling "messy" again, these six areas are the first places to inspect.
