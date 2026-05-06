# Gate Inventory v1 (Core/SMC/MSS)

## Scope
- `/Users/macmini/Trade/Bot/Hung Bot/src/Hung - Core.pine`
- `/Users/macmini/Trade/Bot/Hung Bot/src/Hung - SMC.pine`
- `/Users/macmini/Trade/Bot/Hung Bot/src/Hung - MSS.pine`

## Quick Findings

1. `SMC` has the densest gate stack.
- Strictness profile + score profile + quality thresholds + confluence floor + bias filter + direction filter + entry mode + trigger type/when + max active + near-leg/HTF-only filters.

2. `MSS` is medium complexity.
- Similar architecture to SMC but smaller model set.
- Still has duplicated concepts: strict/profile thresholds + trigger mode + direction/bias gates.

3. `Core` has many strategy-specific gates.
- Per-strategy model toggles and trigger configs.
- Entry filters (bias/long/short), dynamic TP/SL, and several risk clamps.

## Current Gate Clusters

## A) Config-level hard gates
- `signalEntryMode` (`NO ENTRY` / `LIMIT` / `AFTER RETEST`)
- model enable + `trigger_type` + `trigger_when`
- side enable (`Long/Short`)
- bias toggles (LTF/HTF1/HTF2)
- max active/start entries

## B) Score/confluence gates
- `signalMinConfluenceScore`
- trade score minimum (`get_trade_score_min`)
- risk floors from score profile (`minRiskTicks/minRiskAtr/minRr`)
- zone quality thresholds (`entryZoneMinQualityPct`, `htfProjectionMinQualityPct`)

## C) Structural/limitation gates
- HTF-only filter (`entryFilterHtfOnlyEnable`, `entryFilterHtfMinRank`)
- near-leg filter (`entryFilterNearLegEnable`, sequence and direction checks)
- zone caps (`zoneCapPerType`, `zoneCapTotal`, `zoneCurrMaxPerTypeSide`)
- lookback pruning (`effectiveCurrLookbackBars`, htf lookback windows)
- cooldown/age decay pruning (`zonePriorityAgeDecay`, touch cooldowns in MSS/SMC helpers)

## D) Runtime context gates
- no-backfill emission (`runtimeCtx.tradeScanEnabled`)
- confirmed-bar checks / retest confirmation

## High-Probability Overlap (Cut Candidates)

1. Keep one of these as primary quality gate (not both heavy):
- `signalMinConfluenceScore`
- trade score floors (`tradeScoreMin + minRiskTicks/minRiskAtr/minRr`)

2. Strictness + Score profile currently both alter many thresholds.
- Candidate: freeze one axis, keep one axis configurable.

3. Near-leg + HTF-only + quality floor can over-filter together.
- Candidate: keep max 1 structural filter active by default.

4. Entry mode + trigger_when interaction can duplicate logic.
- Candidate: normalize into one effective “entry confirmation policy”.

## Proposed Cut Plan (Wave 1: safe)

1. Preserve correctness-first gates:
- direction allow (`Long/Short`)
- max active
- invalidation/retest confirmation integrity

2. Temporarily disable (or relax) these by default:
- near-leg filter family
- HTF-only filter family
- aggressive confluence floors for non-extreme profiles

3. Keep scoring but simplify:
- use one score floor + one risk floor set
- remove redundant per-profile branches where impact is unclear

## Required Before Code Cuts

1. Decide canonical semantics:
- `signal` = informational detection object
- `event` = trade-trigger candidate object (possibly derived from signal)

2. Decide bias policy:
- HTF1 trend priority only
or
- require trend+bias alignment

3. Define one measurement set:
- emitted signals count
- emitted events count
- added trades count
- blocked-by-gate counts (top 5 reasons)
