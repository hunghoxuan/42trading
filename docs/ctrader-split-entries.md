# Split Entries — v185

Parameter: **Trade Slots & Entries → Split Entries**.

Options: `Auto`, `_1`, and the following families for **2–5 total trades**:

- `_x_AutoEntries_SameTPSL`
- `_x_AutoEntries_SameDistance`
- `_x_EqualEntries_SameTPSL`
- `_x_EqualEntries_SameDistance`

`x` is 2, 3, 4 or 5. `Auto` remains the existing automatic retest mode. AutoEntries are the previous candidate-based fixed-count modes, renamed from `_x_Same_TPSL` / `_x_Same_Distance`. Their numeric ordinals stay 2–5 / 12–15; EqualEntries use new ordinals 22–25 / 32–35. Shared strategy JSON accepts the former names and `_2`–`_5` as aliases for AutoEntries/SameTPSL, plus `_x_Equal_SameTPSL` as an alias for EqualEntries/SameTPSL.

## Near final SL

`_2_NearSL_SameDistance` adds one limit order just inside the base trade's **final SL after its SL Buffer**. No indicator/structure/fraction candidates are read. The safety offset toward the base entry is `max(engine minimum clearance, two ticks)` (the existing clearance includes its risk-mode, spread and ATR floors); symbol precision is rounded toward entry when needed. SL Buffer is not added twice. If no distinct valid entry fits, only the base remains.

The child retains the base trade's SL and TP price distances, so both child SL and TP shift with its entry. For BUY base Entry 100, final SL 80 and TP 140, with offset 0.02: child Entry 80.02, SL 60.02, TP 120.02. SELL is symmetric. Market execution recalculates from the accepted base fill and final SL; chart replay uses the planned base. All legs share the parent risk budget and configured pending-order expiry.

## Equal entries

EqualEntries skips EMA, swing, Ichimoku and other entry candidates. For total count `N`, additional limit entries use:

`entry[k] = baseEntry + (finalBaseSL - baseEntry) × k / N`, for `k = 1..N−1`.

`finalBaseSL` already includes the selected SL Buffer, applied once. No inward entry buffer is applied to this ladder. Examples with base Entry 100 and final SL 80:

| Total trades | Base and additional entries |
| --- | --- |
| 2 | 100, 90 |
| 3 | 100, 93.33, 86.67 |
| 4 | 100, 95, 90, 85 |
| 5 | 100, 96, 92, 88, 84 |

SELL uses the same formula toward its higher final SL. Prices are normalized to symbol precision. Broker minimum distances, distinct ticks, affordability and risk gates can omit a leg; remaining legs are not moved to different fractions. For market entries, the remaining equal ladder is recalculated from the accepted base fill and final SL before affordability checks, retaining the already allocated parent risk budget. All legs share the existing parent risk budget. Strategy execution and analytical chart plans use the same selector; chart trade buttons also dispatch according to the selected entry family.

## Auto entries

AutoEntries modes create the base entry and up to N−1 additional limit orders toward its SL. Candidates combine existing EMA/Ichimoku, five-candle extreme and confirmed swing levels with Entry–final buffered SL fractions **1/2, 1/3, 1/4 and 1/5**. All candidates compete by distance from the base entry.

Fractional candidates are exact divisions of the distance to the **final base SL after SL Buffer**, normalized to symbol precision; no additional entry buffer is applied to fractions. For BUY Entry 100, raw SL 90 and SL Buffer 1SL, final SL is 80: fractional candidates are 96 (1/5), 95 (1/4), 93.33 (1/3), 90 (1/2). SELL is symmetric. The SL buffer is applied once by the protection resolver, never again by split planning.

The existing entry buffer moves an indicator/structure candidate toward the base entry, opposite to the SL buffer direction. Its multiplier is capped at 0.5 for entry placement. After any applicable buffering and price normalization, a child must remain between base entry and base SL, at least **20% of the base Entry–final buffered SL distance** from the base entry and outside the broker minimum-distance exclusion. Distinct child entries must be at least **5% of that distance or two ticks**, whichever is larger, apart. Invalid/duplicate/too-close candidates are skipped. Fractional candidates are available even when no structural artifact qualifies; N remains a maximum, not a forced fill count.

`_1` creates only the base entry. `Auto` retains its existing automatic retest behavior rather than becoming an equal-entry ladder. Each enabled Trade Plan has its own split count; all enabled plans and legs share the parent risk budget.

## Protection modes

| Mode | Child SL/TP |
| --- | --- |
| SameTPSL | Exact absolute prices of the base trade. |
| SameDistance | Shift both SL and TP by `child entry − base entry`, preserving the base trade's price distances. Disabled TP stays disabled. |

Example BUY: base Entry 100, SL 90, TP 120; child Entry 95:

| Mode | Child SL | Child TP | Risk distance | Reward distance |
| --- | ---: | ---: | ---: | ---: |
| SameTPSL | 90 | 120 | 5 | 25 |
| SameDistance | 85 | 115 | 10 | 20 |

Sell protection is symmetric. Market children use the accepted base fill as their distance anchor; analytical chart plans use the causal planned entry. Prices are normalized to symbol precision. Children are skipped if broker adjustment would change the selected geometry or if translated prices are invalid.

Position sizing, minimum-volume affordability, creation/risk gates, order SL/TP, audit prices and chart guides use each leg's own protection. SameTPSL generally produces different lots at different entries; SameDistance preserves the base risk distance. Cash risk remains allocated across the planned legs rather than multiplied by the split count. Unaffordable or rejected legs can reduce the executed count.

## SL Buffer menu

Retain `_0_1SL` through `_0_9SL`, `_1SL`, `_2SL`; add `_3SL`, `_4SL`, `_5SL`. Remove `_1_1SL` through `_1_9SL` from the menu. Existing retained numeric ordinals remain stable, especially `_2SL = 19`, so it is not silently remapped to a new multiplier. Old fractional presets are no longer selectable; strategy JSON using removed names must select a supported value.

The buffer multiplier keeps its original meaning: it is the extra distance added beyond the unbuffered SL artifact, not the final total Entry–SL distance.
