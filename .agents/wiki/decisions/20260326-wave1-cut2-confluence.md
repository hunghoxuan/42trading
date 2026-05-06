# Wave-1 Cut #2: Confluence De-dup

## Goal
Reduce double-gating in trade creation by making trade-score the primary trade gate.

## Changes

1. SMC
- `limCfg.signalMinConfluenceScore` pinned to `1` (minimal guard).
- For trade-type flows, confluence floor no longer blocks trade conversion:
  - barrier touch trade path
  - break-retest confirmed trade path
  - pdarray retest register when `trigger_type == Trade`

2. MSS
- `limCfg.signalMinConfluenceScore` pinned to `1` (minimal guard).

## Rationale
- Previously a candidate could be blocked by both confluence floor and trade-score floor.
- Trade-score already includes risk/quality context; keeping both created over-filtering.

## Expected Effect
- Fewer missed valid trades due to redundant gating.
- Lower branch complexity in event-to-trade flow.
