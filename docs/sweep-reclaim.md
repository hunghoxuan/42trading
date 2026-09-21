# Sweep Reclaim (cTrader)

`sweep_reclaim` is a completed, directional **Structure Event**, distinct from the existing single sweep `s`.

## Selection

- Set **Structure Events → Sweep Reclaim Chain** to `Yes`, `LTF`, or `HTF` (`No` by default).
- Select `sweep_reclaim` in any of the five strategy slots to trade this chain with the current Trade Config, time, symbol and risk gates. This strategy has no hidden entry/SL/TP override.
- Alternatively, select `CustomTrade` and choose `sweep_reclaim` in a Trigger slot. Existing AND/OR trigger rules still apply.
- Standard chart visibility controls apply. Qualified trade markers use the same confluence/direction/minimum-evidence candidates as the strategy. Raw-event display is diagnostic, not an order promise; broker/risk/symbol restrictions can still prevent execution.

## Detection

The first version uses confirmed **swing high/low liquidity**, not session levels or an arbitrary unrelated trendline. Bullish chains sweep a swing low and close back above it; bearish chains mirror this at a swing high.

1. Sweep and reclaim an already confirmed swing level.
2. Confirm rejection at that same level using the existing strict/multi-candle rejection detector. This can occur on the reclaim candle or within the next three bars.
3. A later, same-direction CHOCH within six bars of rejection.
4. A later, same-direction BOS within ten bars of CHOCH. Its reference swing must form at/after the CHOCH; the same break cannot count twice.
5. A later directional candle pattern within three bars of BOS, closing in the chain direction.

The total deadline is twenty bars after the first sweep bar. A close beyond the original sweep extreme, or an opposite CHOCH after the chain's CHOCH, invalidates it. The detector uses closed bars only. Component detection does not require enabling each component's separate display toggle.

## Markers and recovery

The completion candle receives the `sweep_reclaim` label. Its surrounding box starts at the first sweep candle and ends after the final confirmation candle, covering the full high/low range. The raw and qualified renderers share these bounds.

Chains are reconstructed deterministically by bounded historical replay; timestamps identify chain starts and swept swings, rather than unstable bar indexes. Each chain emits only its first completion. The standalone live strategy initializes its processed-bar watermark on attach, so a restart does not submit a previously completed latest-bar setup. Existing execution deduplication handles subsequent signals. This is not a separately persisted chain database.

## Verification

Scratch checks in `.local/sweep-chain-check/` run the production collector with supplied stage-detector fixtures: bullish/bearish completion, stage expiry, invalidation, distinct CHOCH/BOS, new structure, duplicate sweeps, replay, and closed-bar boundaries. These are state-machine tests, not an end-to-end live trading or profitability test.

The Release bridge build, sixteen chain fixture checks, native bullish/bearish predicates, enum compatibility, canonical mapping and structure contracts passed. The broader `ValidateStrategyEngineContracts` check fails on the WickFlip direction contract both before and after this change; it is not a clean regression-suite pass. Live chart rendering and order execution remain unverified.
