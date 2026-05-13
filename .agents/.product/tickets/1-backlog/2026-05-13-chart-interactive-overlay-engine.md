# Ticket: Chart Interactive Overlay Engine (Time/Price Anchored Objects)

## Status
- Phase 1 in progress

## Problem
Current chart objects are mostly ratio-based and do not reliably preserve intent across TF changes, pan/zoom, and tile resize.

## Objective
Implement TradingView-like object behavior by storing and editing objects in market coordinates (`time`, `price`) and projecting to each chart TF.

## Scope
- `web-ui/src/components/charts/SymbolChart.jsx`
- `web-ui/src/components/TradeSignalChart*` projection integration (next phases)
- no DB/API persistence in Phase 1

## Phase Breakdown
1. **Phase 1 (current):**
   - Add canonical object model helper.
   - Capture `time/price` anchors at creation.
   - Keep ratio fallback for rendering safety.
2. **Phase 2:**
   - Render from anchors in all TF charts.
   - Add zone 2-anchor projection.
3. **Phase 3:**
   - Navigate/Edit mode split.
   - Drag/resize updates anchors.
4. **Phase 4:**
   - Persist/reload objects per symbol + context.

## Acceptance Criteria
- Objects created on one TF carry market anchors.
- No regression for chart loading modes (`Live`, `C`, `S`).
- Quick trade menu actions remain functional.

## Validation
- Manual TF-switch mapping checks.
- Pan/zoom/resize sanity checks.
- Existing snapshots/cache workflows unaffected.

