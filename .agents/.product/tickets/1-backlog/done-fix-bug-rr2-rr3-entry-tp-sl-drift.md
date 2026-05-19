# Fix bug: RR2/RR3 explosion and Entry/TP/SL drift in Trade Plan panel

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `Done`
- Owner: `Codex`
- Updated: `2026-05-19 06:32 UTC`

## Problem
Trade Plan UI showed inconsistent price levels and unrealistic RR2/RR3 values.

Screenshot evidence (BTCUSD):
- Direction: `Sell`
- Entry: `77109,24`
- SL: `77109,23` (invalid for SELL; SL should be above Entry)
- TP2: `75800`
- TP3: `75200`
- RR2: `130924`
- RR3: `190924`

## Investigation
- RR2/RR3 were computed from `abs(target-entry)/abs(entry-sl)` in `TradePlanEditor`.
- With `entry=77109.24` and `sl=77109.23`, risk became `0.01`, causing huge RR values.
- In trade-plan extraction, mutable runtime fields could override planned contract values and surface direction-invalid SL/TP in editor.

## Solution
- Updated trade-plan extraction to prefer planned contract values first (`raw/plan`) before mutable runtime overlays.
- Applied direction-aware TP/SL normalization before editor rendering (`BUY: sl<entry,tp>entry`, `SELL: sl>entry,tp<entry`).
- Added RR2/RR3 guardrails:
  - hide RR2/RR3 when direction-invalid
  - hide RR2/RR3 when denominator risk is near-zero

## Expected Output / Verification
- [x] For SELL plans, SL displayed in editor is above Entry unless field is empty.
- [x] RR2/RR3 no longer explode from direction-invalid or near-zero-risk denominators.
- [x] Plan values in editor stay anchored to planned contract by precedence.
- [x] `rtk npm --prefix web-ui run build` passes.

