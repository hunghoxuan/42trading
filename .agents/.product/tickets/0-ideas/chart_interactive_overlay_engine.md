# Feature: Interactive Chart Overlay Engine (TradingView-Style)

## Goal
Add an interactive drawing/execution overlay on top of lightweight chart tiles for:
- PD Arrays
- Key levels
- Buy/Sell objects
- Zones/rectangles
- Future execution helpers

Core rule: objects are anchored by market coordinates (`time`, `price`) instead of screen ratios.

## Why
Current object rendering is ratio-based (`xRatio`, `yRatio`) which breaks expected behavior when:
- switching TF (5m to 4h)
- panning/zooming
- resizing chart tiles

We need TradingView-like behavior where objects stick to market coordinates and reproject to pixel space each render.

## Scope
- Target surface: `src/ui/src/components/charts/SymbolChart.jsx` and `TradeSignalChart` integration.
- No backend schema change in Phase 1-2.
- Keep existing C/S/Live chart modes compatible.

## Architecture
1. **Canonical object model (source of truth)**
   - Store anchors in market coordinates:
   - `anchorTimeMs`, `anchorPrice`
   - Optional second anchor for zones/segments:
   - `anchorTimeMs2`, `anchorPrice2`

2. **Projection layer**
   - Per chart tile/TF, map market anchors -> pixel positions.
   - Recompute on pan/zoom/resize/data refresh.

3. **Interaction layer**
   - Hit-test in pixel space.
   - Edit/drag updates canonical market anchors.
   - Distinct interaction mode: `Navigate` vs `Edit Objects`.

## Phased Plan

### Phase 0 (Hotfix Stability)
- Keep chart drag/zoom functional.
- Prevent overlay from blocking candle interactions by default.
- Status: completed (current production hotfix).

### Phase 1 (Start Now): Canonical Model + Anchor Capture
- Add chart object model helper module.
- Capture `time/price` anchors at object creation (line/point first).
- Preserve ratio fields for fallback rendering during migration.
- Keep existing UX unchanged.

Deliverables:
- object model utility file
- `SymbolChart` writes anchors on object create
- no regression in current object list/menu flows

### Phase 2: Full Projection & Cross-TF Consistency
- Render all objects from `time/price` anchors in every TF.
- Maintain visual consistency when switching TFs.
- Zone object uses two anchors.
- Crosshair + object overlays share same projection basis.

Deliverables:
- projection adapter API (chart data -> pixel map)
- migrate line/point/zone render path to projection
- fallback path removed once parity is verified

### Phase 3: Edit Lifecycle (TradingView-like)
- Add explicit mode toggle:
  - `Navigate` (pan/zoom)
  - `Edit` (select/drag/resize objects)
- Drag/resize updates anchors in market coordinates.
- Object inspector/list below chart supports focus/select/delete.

Deliverables:
- object selection state
- drag handles and resize handles for zones
- stable interaction arbitration

### Phase 4: Persistence + Rehydration
- Persist chart objects per scope (symbol + context: signal/trade/session).
- Restore objects on page reload and in related Signal/Trade views.
- Add versioned schema for forward-compatible object evolution.

Deliverables:
- API contract for load/save objects
- migration-safe object schema version field
- replay across all related views

## Risks
- Coordinate drift if projection uses stale bar domain.
- Event conflicts between chart pan and object edit.
- Zone rendering mismatch at TF boundaries.

## Test Strategy
- Manual:
  - create object on 5m, verify mapped placement on 15m/4h/D.
  - pan/zoom/resize and confirm object sticks to price/time.
  - drag object in edit mode and verify anchors update.
- Regression:
  - C and S mode fetch/status unaffected.
  - quick Buy/Sell intent unchanged.

## Rollout
- Ship Phase 1 behind existing behavior (safe additive).
- Ship Phase 2 with fallback guard.
- Enable Phase 3 UI toggle once projection parity passes QA.

