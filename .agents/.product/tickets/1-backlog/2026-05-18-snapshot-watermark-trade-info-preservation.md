# Ticket: Snapshot Watermark + Trade Info Preservation + Info Tab Empty

## Status
- BACKLOG (HIGH PRIORITY)

## Owner
- Deepseek (implementation)

## Summary
Three user-visible regressions remain after recent deploy:
1. Snapshot images captured from chart `[S]` still do not clearly show `symbol + snapshot time` overlay in rendered image.
2. Trade detail `Info` tab can render empty even when AI response has rich data.
3. AI raw analysis payload loses important nested fields when parsed/stored to DB, causing missing data in trade `Info`/`Json` views.

This must be fixed end-to-end: capture path -> storage path -> DB payload retention -> detail rendering.

---

## User Repro (confirmed)

### A) Snapshot storage and labeling confusion
- In normal/analyze mode (not trade detail), user clicks `[S]`.
- User asks where snapshots are stored.
- Snapshot modal shows `XAUUSD_MASTER.JPG` but overlay does not show clear `symbol + timestamp`.

### B) Info tab empty
- Trade detail `Info` tab shows almost nothing (blank panel) for some trades.
- User-provided screenshot confirms empty tab despite non-empty parsed/raw data.

### C) Data loss after parse/save
- Raw AI response contains rich nested structures:
  - `analysis_data[].multi_timeframes_analysis`
  - `confluence_checklist` details
  - `pd_arrays_key_levels`
  - full `trade_plan[]`
- Stored `raw_json` shown in trade UI keeps only reduced/flattened fields and loses key analysis context.

---

## Current Behavior (as-is)

- Global snapshots are written to:
  - `webhook/snapshots/`
- Trade-scoped copy path intended:
  - `webhook/trade_files/trade-<sid>/snapshots/`
- But user still reports missing visible watermark and missing info in trade detail.

---

## Expected Behavior

1. **Snapshot watermark**
- Every snapshot image (single and MASTER grid) must visibly show:
  - `SYMBOL`
  - `TF` (for each pane / tile)
  - snapshot `UTC timestamp`
- Overlay must be legible against bright/dark chart zones.

2. **Storage semantics**
- If click `[S]` in normal/analyze mode: store in `webhook/snapshots/`.
- If click `[S]` in trade detail mode with known trade SID:
  - store/copy snapshot into `webhook/trade_files/trade-<sid>/snapshots/`
  - persist snapshot file names into trade metadata (`snapshot_files`) for retrieval.

3. **Data preservation**
- Persist full AI payload (or full symbol-slice payload) without losing:
  - `analysis_data[]`
  - `multi_timeframes_analysis`
  - detailed confluence items
  - `pd_arrays_key_levels`
  - full `trade_plan[]` object fields
- Keep normalized convenience fields, but do not replace/drop canonical raw blocks.

4. **Info tab rendering**
- `Info` must render robustly when values are objects/arrays/strings/null.
- If field exists in `trade.raw_json` or `trade.metadata.raw_json`, show it.
- Never render blank tab silently due to parser/render guard mismatch.

---

## Scope (files likely involved)

### Backend
- `webhook/server.js`
  - `/v2/chart/snapshot`
  - `/v2/chart/snapshot/batch`
  - `/v2/chart/refresh`
  - snapshot capture overlay logic (`captureTradingViewSnapshotWithBrowser`, grid HTML builder)
  - trade create/save raw payload and metadata persistence

### Frontend
- `src/ui/src/hooks/useChartTileData.js`
  - `trade_sid` propagation on snapshot refresh/capture
- `src/ui/src/components/charts/SymbolChart.jsx`
  - `[S]` path and mode usage
- `src/ui/src/pages/trades/V2TradeDetailPage.jsx`
  - Info tab item construction / merged raw display
- `src/ui/src/components/SignalDetailCard.jsx`
  - robust object rendering in Info tab
- `src/ui/src/pages/ai/ChartSnapshotsPage.jsx`
  - canonical raw payload preservation helper

---

## Root-Cause Hypotheses to Verify

1. Watermark overlay exists in code but is hidden/covered in final capture frame (z-index/clip/crop/layout mismatch).
2. MASTER snapshot route overlays only TF badges; symbol/time badge may be outside crop or low-contrast.
3. Trade `Info` tab empty due to rendering guard expecting primitive values or missing selected raw source when `response` shape differs.
4. Parse/save flow stores reduced `raw_json` instead of complete response branch used by UI.

---

## Required Fix Plan

- [ ] Add deterministic watermark renderer for both single and grid captures with forced high-contrast background.
- [ ] Add automated post-capture assertion: watermark pixel region not blank (basic heuristic).
- [ ] Ensure `trade_sid` path copies snapshots and writes `snapshot_files` into trade metadata.
- [ ] Preserve full canonical raw analysis block in DB (`raw_json.__analysis_full_raw` or equivalent canonical key).
- [ ] Make Info tab renderer tolerant and explicit for object/array fields (stringify with monospace block).
- [ ] Add fallback merge precedence: `metadata.raw_json` + `raw_json` + canonical full block.

---

## Acceptance Criteria

- [ ] Clicking `[S]` in analyze mode creates files in `webhook/snapshots/` and overlays `symbol + time + tf` visibly.
- [ ] Clicking `[S]` in trade detail creates/copies files under `webhook/trade_files/trade-<sid>/snapshots/`.
- [ ] Trade detail `Info` tab is non-empty for provided XAUUSD case and includes multi-timeframe analysis sections.
- [ ] Stored DB raw JSON still contains full AI nested fields after parse/save.
- [ ] No regression in `/v2/chart/refresh`, `/v2/trades/create`, `/v2/trades/:id/trade-plan/save`.

---

## Verification Checklist

- [ ] `curl /health` shows expected version.
- [ ] Manual screenshot test for 1D/4H/15m/5m grid confirms watermark visible in saved image.
- [ ] DB inspect selected trade row: `raw_json` contains full nested analysis fields.
- [ ] Open `/trades/:sid` Info tab and verify key blocks render:
  - `multi_timeframes_analysis`
  - `confluence_checklist`
  - `trade_plan` + `multiple_exits`

---

## Notes for Implementer

- Do not overwrite canonical raw plan/analysis with flattened convenience schema.
- Keep backward compatibility for existing readers.
- Keep file/path sanitization and security constraints unchanged.
