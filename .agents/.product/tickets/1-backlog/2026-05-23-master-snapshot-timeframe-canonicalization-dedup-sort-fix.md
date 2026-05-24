# Fix Bug: MASTER Snapshot Timeframe Duplication + Wrong Ordering

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `Open`
- Severity: `P1`
- Owner: `Codex`
- Updated: `2026-05-23`
- Related: `1-backlog/2026-05-23-multi-cron-support-and-snapshot-improvements.md`

---

## Problem
MASTER snapshot image still shows duplicated timeframe tiles (notably `1D` and `4H`) and ordering is not consistently high→low.

Observed from attached evidence:
- duplicate `4h` tiles
- duplicate `1D` tiles
- grid order does not reflect strict descending timeframe hierarchy

Expected:
- unique timeframe tiles only
- canonical ordered sequence (example: `1D,4H,1H,15m,5m`)

---

## Investigation Summary

### 1) Dedup is performed on raw tokens, not canonical timeframe identity
Current code in `webhook/server.js` uses `new Set()` on raw strings in both places:
- `captureTradingViewSnapshotsBatch()` (`uniqueTfs` generation)
- `/v2/chart/snapshots-grid/:symbol` route (`tfs` generation)

This allows aliases to survive as distinct entries:
- `D` and `1D`
- `240` and `4H`
- `60` and `1H`

Later, display mapping collapses aliases to same label:
- `D` and `1D` both become `1D`
- `240` and `4H` both become `4h`

Result: visually duplicated tiles.

### 2) Sort comparator uses parser that does not normalize all alias forms first
`parseTfTokenToSeconds()` handles formats like `15m`, `4h`, `1d`, numeric minute tokens, etc. But bare alias tokens (e.g., `D`, `W`) are not first canonicalized, and can fall back to minute-like values.

Result: unstable/wrong ordering when mixed alias sets are supplied.

### 3) Format consistency side issue in MASTER capture path
In merge path, extension default is `.png` but screenshot `type` can default to `jpeg` if `opts.format` is not explicitly `png`.

Result: potential mismatch between file extension and encoded content path assumptions.

---

## Root Cause
No single canonical timeframe normalization pipeline is applied before:
1) dedup
2) sort
3) display/TV interval mapping

Each stage currently handles aliases independently and inconsistently.

---

## Detailed Solution

### A) Introduce canonical timeframe normalizer (single source of truth)
Add helper in `webhook/server.js`:
- `normalizeSnapshotTfToken(tf)`

Canonical outputs (example policy):
- `D`, `1D`, `day`, `1day` -> `1D`
- `W`, `1W` -> `1W`
- `H1`, `1H`, `60` -> `1H`
- `H4`, `4H`, `240` -> `4H`
- `M15`, `15M`, `15` -> `15m`
- `M5`, `5M`, `5` -> `5m`
- `M1`, `1M`, `1` -> `1m`

Unknown values: trim + uppercase fallback, but log warning once per request path.

### B) Canonicalize before dedup/sort in both code paths
Apply same helper in:
1. `captureTradingViewSnapshotsBatch()` when building `uniqueTfs`
2. `/v2/chart/snapshots-grid/:symbol` route when parsing `tfsRaw`

Pipeline required:
1) raw input list
2) canonicalize all tokens
3) filter invalid/empty
4) dedup canonical tokens
5) sort by seconds descending using canonical->seconds map

### C) Replace generic second parser for grid sorting with explicit canonical rank map
Prefer deterministic rank table for snapshot grids:
- `1W` > `1D` > `4H` > `1H` > `30m` > `15m` > `5m` > `1m`

This avoids fallback surprises from free-form parser.

### D) Use canonical mapping for TV interval and badge labels
From canonical token, derive both:
- TV interval (`D`, `240`, `60`, `15`, `5`, `1`)
- UI badge label (`1D`, `4h`, `1h`, `15m`, `5m`, `1m`)

No separate ad-hoc mapping branches.

### E) Fix MASTER image format consistency
In merge snapshot path:
- default to `png` for both extension and screenshot `type`
- only use jpeg when explicitly requested (`jpg`/`jpeg`)

---

## Acceptance Criteria
- [ ] Input `tfs=D,240,4H,1D,15,15m,5,5m` renders unique set only.
- [ ] No duplicated `1D` or `4h` badges in MASTER image.
- [ ] Order is deterministic high→low.
- [ ] Manual and cron snapshot paths produce same ordering behavior.
- [ ] `/v2/chart/snapshots-grid/:symbol` and `captureTradingViewSnapshotsBatch()` use same canonicalizer.
- [ ] MASTER output format defaults to true PNG when format omitted.

---

## Suggested Validation Plan
1. Unit-style quick check (if no test harness, temporary debug log in local only):
   - Input alias-heavy tf list
   - Log canonical list after dedup/sort
2. API check:
   - hit `/v2/chart/snapshots-grid/BTCUSD?tfs=D,1D,240,4H,60,1H,15,15m,5,5m`
   - confirm HTML includes each tf once
3. Capture check:
   - `POST /v2/chart/snapshot/batch` with `merge_snapshots=true` and same alias-heavy list
   - inspect generated MASTER image for duplicates/order
4. Regression:
   - standard `D,240,15,5` still renders correctly

---

## Impacted Files
- `webhook/server.js`
  - add canonical TF helper(s)
  - update batch merge dedup/sort path
  - update snapshots-grid parse/dedup/sort + mapping path
  - align MASTER screenshot format default

(Optional, if helper extraction desired)
- `webhook/utils/timeframe.js` (new helper module), then import into server

---

## Notes
Prior ticket claims dedup/sort done, but implementation currently dedups by raw token and maps display later, which is insufficient for alias-equivalent timeframe sets.