# Unify chart artifacts: indicators + objects + key levels + zones + candle patterns

## Meta
- Status: `BACKLOG`
- Priority: `P1`
- Tags: `TICKET`, `ARCHITECTURE`, `CHART`, `MARKET_DATA`, `STORAGE`, `SMC`
- Created: `2026-06-20`
- Author: `GPT-5`
- Related:
  - `1-backlog/2026-06-08-object-storage-refactor-cron-provider-per-object-folders.md`
  - `1-backlog/2026-05-23-multi-cron-support-and-snapshot-improvements.md`
  - `1-backlog/2026-05-28-design-system-and-performance-refactor.md`

## Problem
Chart-related state is currently split across multiple storage models and code paths:

1. **Indicators** are computed from bars and stored in market-data metadata sidecars.
2. **Chart objects** (`TP`, `SL`, `Entry`, manual lines, boxes) are saved separately per trade in `chart_objects.json`.
3. **Key levels / PD arrays / reference zones** are parsed out of AI payloads in `server.js`, but they are not stored as first-class chart artifacts in the same contract as indicators or objects.
4. **Candle patterns / bar-structure detections** are not yet part of the canonical storage model.

This creates 5 concrete problems:

1. **No single source of truth for chart overlays**.
2. **Different file contracts for data that appears on the same chart**.
3. **Different calculation paths for conceptually related outputs**.
4. **Harder UI composition** because the frontend has to merge bars, indicators, chart objects, and AI-derived structure from unrelated payload shapes.
5. **No clean path for SMC-style derived artifacts** like liquidity, swing highs/lows, MSS, OB, FVG, and candle patterns.

## Verified current state
### 1. Bars are stored separately and should remain canonical OHLCV only
Bars are provider-neutral OHLCV rows managed by:
- `src/api/services/barsStorage.js`

Canonical row shape:
- `time`
- `open`
- `high`
- `low`
- `close`
- `volume`

Parquet is already used as the preferred storage backend for bars. That file should remain the canonical bar table and should **not** be overloaded with unrelated overlay tables or ad hoc JSON payloads.

### 2. Indicators are written into market-data metadata sidecars
Current metadata helpers live in:
- `src/api/server.js`

Verified functions:
- `readMarketDataMetadata(symbol, tf)`
- `writeMarketDataMetadata(symbol, tf, metadata)`
- `buildIndicatorSeriesForBars(bars)`
- `attachIndicatorDataToMarketSnapshot(snapshot)`
- `marketDataFileUpsert(symbolNorm, tfNorm, snapshot)`

Current metadata path pattern:
- `data/market_data/{SYMBOL}/metadata/{TF}.json`

Indicators are currently saved under metadata, typically as:
- `metadata.indicators`
- `metadata.indicator_source`
- `metadata.indicator_updated_at`

### 3. Chart objects are stored separately per trade
Trade chart objects are currently persisted directly by `server.js`:
- `chartObjectsPath(sid, symbol)`

Current file:
- `trades/{sid}/chart_objects.json`

Current routes:
- `POST /v2/trades/:tradeRef/chart-objects`
- `GET /v2/trades/:tradeRef/chart-objects`

Frontend load path:
- `src/admin/components/charts/SymbolChart.jsx`

Verified current behavior:
- chart loads saved `chart_objects`
- when none exist, it auto-generates a tradeplan overlay from trade entry/tp/sl fields

### 4. AI structure data exists, but is not persisted in the same chart contract
`server.js` already parses and normalizes structure-oriented fields from AI payloads:
- `parseSnapshotPdArrays(payload)`
- `parseSnapshotKeyLevels(payload)`

It also maps newer AI schemas into:
- `market_analysis.pd_arrays`
- `market_analysis.key_levels`
- HTF `reference_zones`

This means the repo already has a semantic bridge for:
- premium/discount arrays
- zones
- key levels
- reference zones

But that information is still not stored in the same canonical artifact file/service as indicators or chart objects.

### 5. Shared object storage primitives already exist
There is already a reusable object storage direction in:
- `src/api/storage/objectStore.js`
- `src/api/storage/userObjectStore.js`
- `src/api/services/objectLogService.js`

This is a strong signal that the chart domain should not add yet another one-off storage model.

## Goal
Create **one canonical chart artifact contract** and **one shared chart artifact service** that owns:

- indicators
- chart objects (`TP`, `SL`, `Entry`, manual lines, boxes)
- key levels
- zones
- candle patterns
- future structure detections:
  - swing high
  - swing low
  - liquidity pools / sweeps
  - MSS / CHoCH / BOS
  - OB
  - FVG

### Core rule
All chart overlays must be:
1. calculated through the same service layer
2. persisted through the same serializer
3. stored with the same envelope/schema
4. read by the UI through the same loader

## Architectural decision
### Keep Parquet for bars only
Do **not** attempt to store multiple logical overlay tables inside the bar parquet file.

Reason:
- bars are dense time-series data
- overlays are sparse annotations / derived artifacts / user-drawn objects
- mixing them increases coupling, complicates migrations, and makes manual debugging harder

### Introduce one chart artifact sidecar contract
Bars remain in:
- `data/market_data/{SYMBOL}/bars/{TF}.parquet`

Everything chart-overlay-related moves to one canonical sidecar contract, suggested path family:
- `data/market_data/{SYMBOL}/chart/{TF}.json`

Trade-specific chart state should use the **same envelope and same item schema**, suggested path family:
- `data/trades/{TRADE_REF}/chart/{TF}.json`

If the existing trade root helper cannot support that exact path cleanly, the implementation may keep the trade folder location under the existing trade dir resolver, but it must still use:
- the same filename family
- the same serializer
- the same envelope shape

### No more split between `metadata/*.json` and `chart_objects.json`
After migration, indicators and objects must no longer live in unrelated file contracts.

## Canonical chart artifact envelope
Suggested top-level shape:

```json
{
  "version": 1,
  "scope": {
    "scope_type": "market",
    "symbol": "BTCUSD",
    "timeframe": "15",
    "trade_sid": null,
    "user_id": "default"
  },
  "bars_ref": {
    "provider": "parquet_duckdb",
    "tf": "15",
    "first_bar_time": 1718006400,
    "last_bar_time": 1718010000,
    "bars_hash": "optional-stable-hash"
  },
  "series": {
    "indicators": {
      "ema20": [],
      "ema50": [],
      "sma200": [],
      "rsi": []
    }
  },
  "items": [],
  "meta": {
    "calculated_at": "2026-06-20T10:00:00.000Z",
    "artifact_source": "calculated_from_bars",
    "schema_source": "chartArtifactService"
  }
}
```

## Canonical item schema
All non-bar overlays must share one item contract:

```json
{
  "id": "unique-id",
  "family": "object",
  "type": "tp",
  "subtype": "horizontal_level",
  "label": "TP1",
  "timeframe": "15",
  "source": "user",
  "origin": "trade",
  "status": "active",
  "direction": "SELL",
  "price": 65500,
  "price_low": null,
  "price_high": null,
  "bar_start": null,
  "bar_end": null,
  "anchor_time": null,
  "geometry": {},
  "style": {},
  "tags": [],
  "metrics": {},
  "payload": {}
}
```

### `family` values
- `indicator`
- `object`
- `level`
- `zone`
- `pattern`
- `structure`

### Examples by family
#### `indicator`
- moving averages
- RSI
- derived oscillator lines

Note:
- indicator point arrays should remain in `series.indicators`
- indicator config / visibility / labeling can be represented in `items`

#### `object`
- entry
- stop loss
- take profit
- manual line
- box
- ray
- trend line
- tradeplan object

#### `level`
- key level
- PDH / PDL
- swing high / swing low
- equal highs / equal lows

#### `zone`
- OB
- FVG
- BB
- IFVG
- liquidity zone
- supply / demand zone
- premium / discount array

#### `pattern`
- engulfing
- pin bar
- inside bar
- outside bar
- morning star
- evening star

#### `structure`
- HH
- HL
- LH
- LL
- BOS
- CHoCH
- MSS
- liquidity sweep

## Required service split
### 1. One shared chart artifact service
Add one service responsible for:
- computing derived overlays from bars
- normalizing item schema
- reading existing artifact files
- merging user objects and derived items
- writing canonical artifact files

Suggested module:
- `src/api/services/chartArtifactService.js`

Suggested responsibilities:
- `buildChartArtifactEnvelope(...)`
- `buildIndicatorArtifactsFromBars(...)`
- `buildStructureArtifactsFromBars(...)`
- `normalizeChartArtifactItem(...)`
- `readChartArtifacts(...)`
- `writeChartArtifacts(...)`
- `mergeChartArtifacts(...)`
- `migrateLegacyChartArtifacts(...)`

### 2. One path resolver for chart artifact files
Do not keep direct path building scattered across `server.js`.

Suggested responsibilities:
- resolve market artifact file path
- resolve trade artifact file path
- return canonical read/write targets
- support migration fallback from:
  - `metadata/{tf}.json`
  - `chart_objects.json`

This can live inside `chartArtifactService` or a dedicated helper module.

## Required calculation rules
### Phase 1: unify what already exists
Must unify and persist together:
- indicators currently written via market metadata
- chart objects currently written via `chart_objects.json`
- existing AI-derived:
  - `pd_arrays`
  - `key_levels`
  - `reference_zones`

### Phase 2: derived structure from bars
Add first-class derived overlays from bars:
- swing high / swing low
- liquidity pools / equal highs / equal lows / sweeps
- MSS / BOS / CHoCH
- OB
- FVG
- candle patterns

### Important rule
All derived structure must be rule-driven and configurable. Do not hardcode opaque heuristics in multiple places.

Suggested config namespace:
- pivot length / swing window
- wick-vs-close break mode
- equal-high / equal-low tolerance
- minimum displacement thresholds
- FVG minimum size
- OB validation rules
- candle pattern enable/disable thresholds

## API changes
### Keep compatibility, but move to one artifact API
Current chart-object endpoints should become compatibility wrappers.

Target direction:
- add unified chart artifact read endpoint
- add unified chart artifact write endpoint

Suggested future routes:
- `GET /v2/chart/artifacts?symbol=...&tf=...`
- `GET /v2/trades/:tradeRef/chart-artifacts?tf=...`
- `POST /v2/trades/:tradeRef/chart-artifacts`

Compatibility requirement:
- existing `/chart-objects` endpoints must continue to work during migration
- existing frontend object loading should not break during cutover

## Migration requirements
### Read compatibility
During transition:
1. read canonical chart artifact file first
2. if missing:
   - read `metadata/{tf}.json` for indicators
   - read `chart_objects.json` for trade objects
   - map legacy AI fields into canonical items
3. write back canonical artifact file

### Write compatibility
After cutover:
- all new writes go through chart artifact service
- legacy files become read-only fallback, then removable in a later cleanup ticket

## UI requirements
Frontend chart code should no longer independently stitch unrelated payload shapes together.

Required direction:
- chart loader gets one artifact envelope
- candlestick bars stay separate
- overlays come from:
  - `series.indicators`
  - `items[]`

This applies especially to:
- `src/admin/components/charts/SymbolChart.jsx`
- chart snapshot flows
- trade detail charts
- AI chart visualization flows

## Acceptance criteria
1. A single canonical chart artifact schema exists and is documented in code.
2. Bars remain stored only as OHLCV parquet/csv and are not polluted with overlay payloads.
3. Indicators no longer depend on a special metadata-only contract.
4. Trade chart objects no longer depend on a separate one-off `chart_objects.json` contract.
5. Key levels, zones, and candle patterns are first-class chart artifacts.
6. Existing `pd_arrays`, `key_levels`, and `reference_zones` are normalized into the new contract.
7. One shared service owns read/write/merge/normalize logic.
8. UI reads one unified overlay payload.
9. Backward-compatible fallback exists for legacy files during migration.
10. Tests cover:
   - legacy migration
   - indicator persistence
   - trade object persistence
   - zone/level/pattern normalization
   - mixed derived + user-authored artifact merge

## Explicit non-goals
- Replacing parquet as the canonical bar storage
- Embedding sparse chart annotations inside the bar parquet file
- Redesigning every AI response schema in the same ticket
- Changing the visual design of chart overlays in phase 1

## Implementation notes
### Current files/functions this ticket must touch
- `src/api/server.js`
  - `readMarketDataMetadata`
  - `writeMarketDataMetadata`
  - `buildIndicatorSeriesForBars`
  - `attachIndicatorDataToMarketSnapshot`
  - `marketDataFileUpsert`
  - `parseSnapshotPdArrays`
  - `parseSnapshotKeyLevels`
  - chart-object save/load routes
- `src/api/services/barsStorage.js`
  - source for canonical bars
- `src/api/storage/objectStore.js`
  - storage/path conventions worth reusing
- `src/api/storage/userObjectStore.js`
  - shared persistence direction for object-like artifacts
- `src/admin/components/charts/SymbolChart.jsx`
  - current chart object load path

### Recommended sequencing
1. Introduce canonical artifact envelope + service
2. Move indicators into the new contract
3. Move trade chart objects into the same contract
4. Normalize AI `pd_arrays` / `key_levels` / `reference_zones`
5. Add derived structure + candle pattern calculators
6. Remove legacy direct readers after compatibility window

## Open questions
1. Should market-scope artifacts be global or user-scoped?
   - recommendation: market-derived structure should be global by symbol/timeframe; trade/user overlays can remain trade-scoped
2. Should indicator point arrays be stored in `series` and not `items`?
   - recommendation: yes
3. Should SMC detections be recalculated on every bar write or cached lazily?
   - recommendation: calculate on market-data upsert and allow forced refresh
4. Should manually drawn objects override or coexist with derived zones?
   - recommendation: coexist, with `source=user|derived|ai|trade_auto`

## Summary
This ticket establishes one canonical chart artifact model for:
- indicators
- trade objects
- key levels
- zones
- candle patterns
- future structure detections

The key architectural rule is:
- **bars stay in parquet**
- **all overlays move into one sidecar artifact contract**
- **one service owns calculation + normalization + storage**
