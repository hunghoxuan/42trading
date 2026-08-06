# Trading Event Parity Spec

## Purpose

This document defines the canonical event contract that TradingView Pine, Node.js, and cTrader should converge to.

The goal is parity in:

- event naming
- direction meaning
- reason vocabulary
- action guidance
- timeframe labeling
- timeframe colors
- expected output payloads

This document starts with the `CHOCH` event family because it is one of the highest-signal reversal events and already exists in all three systems.

## Canonical Runtime Terms

- `RuleEvent`: one detected market event on one symbol/timeframe/bar
- `StrategySignal`: a higher-level decision derived from one or more rule events
- `ActionGuidance`: the recommended trade posture after an event

This matches the existing repo direction in [docs/rules-engine-refactor.md](/Users/macmini/Projects/moza/42trade/docs/rules-engine-refactor.md:172).

## Canonical Event Schema

```json
{
  "event_key": "bullish_choch",
  "event_type": "choch",
  "direction": "bullish",
  "reason": "key_level_rejection",
  "action": "buy",
  "symbol": "BTCUSD",
  "timeframe": "15m",
  "tf_color": "#00BFFF",
  "bar_time": 0,
  "source_platform": "tradingview",
  "source_system": "mss",
  "price_ref": 0,
  "price_zone_low": 0,
  "price_zone_high": 0,
  "confidence": 0,
  "score": 0,
  "meta": {}
}
```

## Canonical Enums

### `event_type`

```text
choch
bos
sweep_reclaim
pullback
continuation
impulse
rejection
breakout
```

### `direction`

```text
bullish
bearish
neutral
```

### `reason`

Use a small shared enum instead of free text for dashboard and API parity.

```text
structure_break
structure_reclaim
liquidity_sweep
key_level_rejection
order_block_rejection
fvg_rejection
ema_cross
ema_reclaim
vwap_reclaim
candle_pattern
divergence
momentum_shift
bias_alignment
unknown
```

### `action`

```text
buy
sell
wait
skip
```

## Timeframe Labels And Colors

These should be identical everywhere for dashboard display.

Current cTrader mapping in [TVBridge_CTrader.cs](/Users/macmini/Projects/moza/42trade/src/mt5-bridge/clients/TVBridge_CTrader.cs:1468) is the cleanest existing source, so we use it as the canonical color map for now.

| Timeframe | Label | Color name | Hex |
|---|---|---|---|
| 1m | `1m` | `WhiteSmoke` | `#F5F5F5` |
| 5m | `5m` | `Gainsboro` | `#DCDCDC` |
| 15m | `15m` | `DeepSkyBlue` | `#00BFFF` |
| 1h | `1h` | `SlateBlue` | `#6A5ACD` |
| 4h | `4h` | `MediumPurple` | `#9370DB` |
| 1D | `1D` | `Gold` | `#FFD700` |

## Strict Direction Matrix

This matrix is intentionally stricter than the descriptive sections below.

It answers only:

- does the event imply `reverse` or `continue`
- what is the default `buy/sell` guideline

| Event key | Event type | Direction | Market meaning | Direction class | Default action |
|---|---|---|---|---|---|
| `bullish_choch` | `choch` | `bullish` | bearish structure likely ended | `reverse_up` | `buy` |
| `bearish_choch` | `choch` | `bearish` | bullish structure likely ended | `reverse_down` | `sell` |
| `bullish_bos` | `bos` | `bullish` | bullish structure continues | `continue_up` | `buy` |
| `bearish_bos` | `bos` | `bearish` | bearish structure continues | `continue_down` | `sell` |
| `bullish_sweep_reclaim` | `sweep_reclaim` | `bullish` | downside liquidity taken then reclaimed up | `reverse_up` | `buy` |
| `bearish_sweep_reclaim` | `sweep_reclaim` | `bearish` | upside liquidity taken then reclaimed down | `reverse_down` | `sell` |
| `bullish_rejection` | `rejection` | `bullish` | support or value held by buyers | `reverse_up_or_continue_up` | `buy` |
| `bearish_rejection` | `rejection` | `bearish` | resistance or value held by sellers | `reverse_down_or_continue_down` | `sell` |
| `bullish_breakout` | `breakout` | `bullish` | price escaped above a key ceiling | `continue_up_or_reverse_up` | `buy` |
| `bearish_breakout` | `breakout` | `bearish` | price escaped below a key floor | `continue_down_or_reverse_down` | `sell` |
| `bullish_pullback` | `pullback` | `bullish` | bullish retrace into value | `continue_up_pending` | `wait` |
| `bearish_pullback` | `pullback` | `bearish` | bearish retrace into value | `continue_down_pending` | `wait` |
| `bullish_continuation` | `continuation` | `bullish` | bullish trend resumed | `continue_up` | `buy` |
| `bearish_continuation` | `continuation` | `bearish` | bearish trend resumed | `continue_down` | `sell` |
| `bullish_impulse` | `impulse` | `bullish` | aggressive bullish expansion | `continue_up` | `buy` |
| `bearish_impulse` | `impulse` | `bearish` | aggressive bearish expansion | `continue_down` | `sell` |

## Strict Action Policy

Use this to keep TradingView, Node.js, and cTrader aligned.

| Direction class | Meaning | Buy guideline | Sell guideline | Default action |
|---|---|---|---|---|
| `reverse_up` | market likely changing from down to up | allowed | avoid | `buy` |
| `reverse_down` | market likely changing from up to down | avoid | allowed | `sell` |
| `continue_up` | uptrend remains valid | allowed | avoid | `buy` |
| `continue_down` | downtrend remains valid | avoid | allowed | `sell` |
| `continue_up_pending` | bullish pullback exists but continuation not confirmed | wait for reclaim or rejection | avoid | `wait` |
| `continue_down_pending` | bearish pullback exists but continuation not confirmed | avoid | wait for reclaim or rejection | `wait` |
| `reverse_up_or_continue_up` | bullish rejection can be either reversal or continuation depending on prior structure | allowed after level response confirmation | avoid | `buy` |
| `reverse_down_or_continue_down` | bearish rejection can be either reversal or continuation depending on prior structure | avoid | allowed after level response confirmation | `sell` |
| `continue_up_or_reverse_up` | bullish breakout can be continuation or major reversal depending on prior regime | allowed after breakout confirmation | avoid unless breakout fails | `buy` |
| `continue_down_or_reverse_down` | bearish breakout can be continuation or major reversal depending on prior regime | avoid unless breakout fails | allowed after breakout confirmation | `sell` |

## Machine Guidance Contract

Each runtime should be able to derive the same coarse decision fields from a canonical event.

```json
{
  "event_key": "bullish_choch",
  "event_type": "choch",
  "direction": "bullish",
  "direction_class": "reverse_up",
  "reason": "structure_reclaim",
  "buy_allowed": true,
  "sell_allowed": false,
  "default_action": "buy",
  "needs_confirmation": true
}
```

### Confirmation defaults

| Event type | needs_confirmation | Notes |
|---|---|---|
| `choch` | `true` | require close through opposing pivot and prefer reclaim/displacement |
| `bos` | `true` | require body-close break and duplicate-break filtering |
| `sweep_reclaim` | `true` | require reclaim after sweep, not sweep only |
| `rejection` | `true` | require clear response candle from valid level |
| `breakout` | `true` | require follow-through, displacement, or retest |
| `pullback` | `true` | event is informational until continuation confirms |
| `continuation` | `true` | require post-pullback reclaim or aligned trigger |
| `impulse` | `true` | require real displacement, not noise |

## Canonical CHOCH Event Pair

### `bullish_choch`

#### Meaning

Price shows the first meaningful structure shift from bearish order flow to bullish order flow.

This is a reversal event, not a continuation event.

#### Canonical output

```json
{
  "event_key": "bullish_choch",
  "event_type": "choch",
  "direction": "bullish",
  "reason": "structure_reclaim",
  "action": "buy"
}
```

#### Guidance meaning

- `buy`: when the event is confirmed and aligned with context
- `wait`: when the event is detected but lacks confluence
- `skip`: when higher-timeframe bias directly invalidates it

### `bearish_choch`

#### Meaning

Price shows the first meaningful structure shift from bullish order flow to bearish order flow.

This is a reversal event, not a continuation event.

#### Canonical output

```json
{
  "event_key": "bearish_choch",
  "event_type": "choch",
  "direction": "bearish",
  "reason": "structure_reclaim",
  "action": "sell"
}
```

#### Guidance meaning

- `sell`: when the event is confirmed and aligned with context
- `wait`: when the event is detected but lacks confluence
- `skip`: when higher-timeframe bias directly invalidates it

## Current Logic Comparison: CHOCH

| Platform | What exists now | Current strength | Current mismatch |
|---|---|---|---|
| TradingView | MSS / structure-event pipeline and sweep-followed-by-CHoCH logic, including origin retest workflows in [Hung - SMC.pine](/Users/macmini/Projects/moza/42trade/src/mt5-bridge/tradingview/Hung%20-%20SMC.pine:1506) | Most context-aware | Output naming is not yet canonicalized into one shared payload |
| Node.js | `choch` predicate, predefined rule ids, and reversal/phase interpretation in [predefinedRules.js](/Users/macmini/Projects/moza/42trade/src/shared/rules-engine/predefinedRules.js:333) and [realtimeAnalysis.js](/Users/macmini/Projects/moza/42trade/src/shared/rules-engine/features/realtimeAnalysis.js:875) | Good event API shape | Logic depends heavily on upstream artifacts and is simpler than Pine |
| cTrader | Structure event collection now emits canonical CHOCH events into the dashboard event cache while still feeding local bias scoring in [TVBridge_CTrader.cs](/Users/macmini/Projects/moza/42trade/src/mt5-bridge/clients/TVBridge_CTrader.cs:1502) | Good local fallback with dashboard output | Context layers are still lighter than Pine |

## Best Combined CHOCH Logic

This should become the target parity formula.

### Core formula

A `CHOCH` is confirmed when all of the following are true:

1. There is a prior directional structure state:
   - bearish before `bullish_choch`
   - bullish before `bearish_choch`
2. Price breaks the most recent opposing structural pivot:
   - above the latest lower high for `bullish_choch`
   - below the latest higher low for `bearish_choch`
3. The break is confirmed by candle body close, not wick-only by default
4. The break happens after either:
   - direct structure pressure
   - liquidity sweep
   - key-level rejection
5. If higher-timeframe bias strongly opposes the event, downgrade action from `buy/sell` to `wait/skip`

### Preferred confluence upgrades

These do not create CHOCH by themselves, but they improve confidence:

- prior liquidity sweep
- rejection from OB / FVG / SD
- displacement candle body expansion
- EMA or VWAP reclaim in event direction
- aligned candle pattern
- divergence in reversal direction

### Reason mapping

When emitting a canonical CHOCH event:

- use `structure_reclaim` when it is a clean structure flip without stronger context
- use `liquidity_sweep` when a sweep directly precedes the break
- use `key_level_rejection` when rejection at a known level is the main trigger
- use `order_block_rejection` or `fvg_rejection` when zone respect is the main trigger
- use `candle_pattern` or `divergence` only when those are explicit confirmation layers

### Action mapping

| State | Action |
|---|---|
| CHOCH confirmed + HTF aligned + valid reclaim/displacement | `buy` or `sell` |
| CHOCH confirmed but no reclaim/retest/confluence | `wait` |
| CHOCH weak, wick-only, or directly against dominant HTF bias | `skip` |

## Platform Implementation Notes For CHOCH

### TradingView

- Keep current structure engine as primary detector.
- Normalize output into canonical fields:
  - `event_type = "choch"`
  - `direction = "bullish" | "bearish"`
  - `reason`
  - `action`
- Emit this in the same style as webhook-ready event payloads.

### Node.js

- Keep `choch` as a `RuleEvent`.
- Upgrade the detector so it does not rely only on simplified recent-bar structure or sparse artifacts.
- Port pivot-based structure logic from Pine/cTrader so Node can independently confirm:
  - prior trend
  - opposing pivot break
  - body-close confirmation
  - optional sweep context

### cTrader

- Keep current structure event and sweep-first bias logic as the local fallback engine.
- Current repo implementation already emits `bullish_choch` and `bearish_choch` into the per-symbol, per-timeframe dashboard event cache.
- Next refinement should focus on richer context tagging for the `reason` field, not basic event availability.

## Canonical BOS Event Pair

### `bullish_bos`

#### Meaning

Price breaks prior bullish continuation structure to the upside.

Unlike `bullish_choch`, this is not the first reversal away from bearish structure. It is a continuation event inside an already-bullish or already-flipped market structure regime.

#### Canonical output

```json
{
  "event_key": "bullish_bos",
  "event_type": "bos",
  "direction": "bullish",
  "reason": "structure_break",
  "action": "buy"
}
```

### `bearish_bos`

#### Meaning

Price breaks prior bearish continuation structure to the downside.

Unlike `bearish_choch`, this is not the first reversal away from bullish structure. It is a continuation event inside an already-bearish or already-flipped market structure regime.

#### Canonical output

```json
{
  "event_key": "bearish_bos",
  "event_type": "bos",
  "direction": "bearish",
  "reason": "structure_break",
  "action": "sell"
}
```

## Current Logic Comparison: BOS

| Platform | What exists now | Current strength | Current mismatch |
|---|---|---|---|
| TradingView | MSS/BOS model and structure visuals already distinguish BOS from MSS/CHOCH in [Hung - MSS.pine](/Users/macmini/Projects/moza/42trade/src/mt5-bridge/tradingview/Hung%20-%20MSS.pine:656) | Good chart-native structure continuity | Event payload is not standardized across systems |
| Node.js | Native BOS artifact generation from pivot breaks in [detectArtifacts.js](/Users/macmini/Projects/moza/42trade/src/shared/rules-engine/features/detectArtifacts.js:1526) and predefined `bos` rule ids in [predefinedRules.js](/Users/macmini/Projects/moza/42trade/src/shared/rules-engine/predefinedRules.js:303) | Best explicit event-object output shape | Depends on local pivot inference rules that may not match Pine exactly |
| cTrader | Structure event collection differentiates BOS from CHOCH and now emits canonical BOS rows into the dashboard cache | Good fallback and dashboard-friendly local detection | Still simpler than Pine around retest quality and continuation context |

## Best Combined BOS Logic

### Core formula

A `BOS` is confirmed when all of the following are true:

1. There is already an active structure bias:
   - bullish before `bullish_bos`
   - bearish before `bearish_bos`
2. Price closes through the most recent continuation swing level:
   - above prior swing high for `bullish_bos`
   - below prior swing low for `bearish_bos`
3. The break is confirmed by candle body close, not wick-only by default
4. The broken level is not just a duplicate micro-break at essentially the same price within the same short repeat window
5. The break does not qualify as the first opposite-side transition. If it does, classify it as `CHOCH` instead

### Preferred confluence upgrades

- displacement candle body expansion
- break from a pullback base
- break after sweep reclaim in same direction
- HTF bias already aligned
- break followed by valid retest

### Reason mapping

- use `structure_break` by default
- use `liquidity_sweep` if the continuation break follows a same-direction sweep/reclaim sequence
- use `bias_alignment` when higher-timeframe agreement is the main strengthener

### Action mapping

| State | Action |
|---|---|
| BOS confirmed + HTF aligned + displacement or retest support | `buy` or `sell` |
| BOS confirmed but breakout quality is weak | `wait` |
| BOS is duplicate/noisy or directly invalidated by higher timeframe context | `skip` |

## Platform Implementation Notes For BOS

### TradingView

- Keep BOS as a distinct event from CHOCH in MSS/SMC output.
- Emit canonical fields:
  - `event_type = "bos"`
  - `direction`
  - `reason`
  - `action`

### Node.js

- Keep the current pivot-break artifact generator because it already emits a clean normalized event object.
- Align pivot selection and duplicate-break filtering with Pine/cTrader so BOS classification is stable across platforms.

### cTrader

- Reuse the existing local `CollectStructureEvents()` classification.
- Current repo implementation already promotes BOS events into the same canonical dashboard event cache.

## Canonical Sweep Reclaim Event Pair

### `bullish_sweep_reclaim`

#### Meaning

Price sweeps sell-side liquidity below a reference low, then closes back above the swept level or reclaim threshold.

This is usually a reversal event and a `buy` guideline.

#### Canonical output

```json
{
  "event_key": "bullish_sweep_reclaim",
  "event_type": "sweep_reclaim",
  "direction": "bullish",
  "reason": "liquidity_sweep",
  "action": "buy"
}
```

### `bearish_sweep_reclaim`

#### Meaning

Price sweeps buy-side liquidity above a reference high, then closes back below the swept level or reclaim threshold.

This is usually a reversal event and a `sell` guideline.

#### Canonical output

```json
{
  "event_key": "bearish_sweep_reclaim",
  "event_type": "sweep_reclaim",
  "direction": "bearish",
  "reason": "liquidity_sweep",
  "action": "sell"
}
```

## Current Logic Comparison: Sweep Reclaim

| Platform | What exists now | Current strength | Current mismatch |
|---|---|---|---|
| TradingView | Direct sweep reclaim logic is used in strategy and SMC paths, including `sweep_reclaim_allowed()` and origin retests in [Hung - Core.pine](/Users/macmini/Projects/moza/42trade/src/mt5-bridge/tradingview/Hung%20-%20Core.pine:1712) and [Hung - SMC.pine](/Users/macmini/Projects/moza/42trade/src/mt5-bridge/tradingview/Hung%20-%20SMC.pine:1506) | Richest reclaim context | Output is not normalized to one shared event payload |
| Node.js | Sweep artifacts exist and are consumed in bias/phase logic; event family is present in predefined rules | Good artifact path | No single canonical `sweep_reclaim` runtime event name yet |
| cTrader | `TryMatchSweepPattern()` plus confirmed swings now emit canonical sweep-reclaim dashboard rows while preserving local sweep bias detection | Strong local fallback with dashboard output | Sweep context is still lighter than Pine's richer origin/retest flow |

## Best Combined Sweep Reclaim Logic

### Core formula

A `sweep_reclaim` is confirmed when all of the following are true:

1. Price trades beyond a known liquidity level:
   - below a valid swing low / SSL for bullish
   - above a valid swing high / BSL for bearish
2. The overshoot is small enough to still be a sweep, not a true breakout
3. The candle or next confirming candle closes back through the swept level or reclaim threshold
4. The event happens near a meaningful reference:
   - swing liquidity
   - PDH/PDL
   - OB/FVG/SD edge
5. Optional but preferred:
   - displacement away from the sweep
   - CHOCH follows within a short bar window

### Action mapping

| State | Action |
|---|---|
| sweep + reclaim + valid context | `buy` or `sell` |
| sweep only, reclaim not yet confirmed | `wait` |
| large break-through or no reclaim | `skip` |

## Canonical Rejection Event Pair

### `bullish_rejection`

#### Meaning

Price touches a meaningful support/value area and is rejected upward.

#### Canonical output

```json
{
  "event_key": "bullish_rejection",
  "event_type": "rejection",
  "direction": "bullish",
  "reason": "key_level_rejection",
  "action": "buy"
}
```

### `bearish_rejection`

#### Meaning

Price touches a meaningful resistance/value area and is rejected downward.

#### Canonical output

```json
{
  "event_key": "bearish_rejection",
  "event_type": "rejection",
  "direction": "bearish",
  "reason": "key_level_rejection",
  "action": "sell"
}
```

## Current Logic Comparison: Rejection

| Platform | What exists now | Current strength | Current mismatch |
|---|---|---|---|
| TradingView | PD-array retest, touch-respected, and zone response logic in [Hung - SMC.pine](/Users/macmini/Projects/moza/42trade/src/mt5-bridge/tradingview/Hung%20-%20SMC.pine:1477) and [Hung - SMC.pine](/Users/macmini/Projects/moza/42trade/src/mt5-bridge/tradingview/Hung%20-%20SMC.pine:1700) | Best explicit zone semantics | Rejection reason is often free text |
| Node.js | Zone lifecycle emits reject-style events via `rejected_touch` / `converted_rejected_touch` in [detectArtifacts.js](/Users/macmini/Projects/moza/42trade/src/shared/rules-engine/features/detectArtifacts.js:244) | Best normalized lifecycle model | Needs clearer canonical event naming and reason mapping |
| cTrader | Ranked structural levels now emit explicit rejection events from local level-touch and close-away response logic | Good local fallback with dashboard output | Level classification is still simpler than Pine zone semantics |

## Best Combined Rejection Logic

### Core formula

A `rejection` is confirmed when all of the following are true:

1. Price touches or marginally penetrates a meaningful zone or level
2. Candle closes back away from that zone in the opposite direction
3. The close is strong enough to show response, not just noise
4. The level type is known:
   - key level
   - order block
   - FVG
   - supply/demand
5. Event reason should reflect the strongest level class involved

### Reason mapping

- `key_level_rejection`
- `order_block_rejection`
- `fvg_rejection`
- `ema_reclaim` if the rejection is specifically against EMA support/resistance
- `vwap_reclaim` if the rejection is around VWAP value reclaim

### Action mapping

| State | Action |
|---|---|
| rejection at valid context level with aligned bias | `buy` or `sell` |
| rejection exists but no confluence | `wait` |
| touch without meaningful response | `skip` |

## Canonical Breakout Event Pair

### `bullish_breakout`

#### Meaning

Price breaks and confirms above a key level, zone, or range ceiling.

#### Canonical output

```json
{
  "event_key": "bullish_breakout",
  "event_type": "breakout",
  "direction": "bullish",
  "reason": "structure_break",
  "action": "buy"
}
```

### `bearish_breakout`

#### Meaning

Price breaks and confirms below a key level, zone, or range floor.

#### Canonical output

```json
{
  "event_key": "bearish_breakout",
  "event_type": "breakout",
  "direction": "bearish",
  "reason": "structure_break",
  "action": "sell"
}
```

## Current Logic Comparison: Breakout

| Platform | What exists now | Current strength | Current mismatch |
|---|---|---|---|
| TradingView | Break-retest event registration and BOS-style structure triggers in [Hung - SMC.pine](/Users/macmini/Projects/moza/42trade/src/mt5-bridge/tradingview/Hung%20-%20SMC.pine:1706) | Strong range/zone breakout context | No unified canonical event payload |
| Node.js | `breakout` runtime matching and converted zone breakout lifecycle exist in [strategyEventFunctions.js](/Users/macmini/Projects/moza/42trade/src/shared/rules-engine/features/strategyEventFunctions.js:767) and [detectArtifacts.js](/Users/macmini/Projects/moza/42trade/src/shared/rules-engine/features/detectArtifacts.js:432) | Best normalized event API | Needs explicit distinction between breakout and simple cross in every output path |
| cTrader | Chart structure levels now emit explicit breakout events from prior-close to current-close break logic | Practical local breakout fallback with dashboard output | Still simpler than Pine break-retest sequencing |

## Best Combined Breakout Logic

### Core formula

A `breakout` is confirmed when all of the following are true:

1. Price closes beyond a meaningful level or zone boundary
2. The break exceeds simple wick noise
3. There is either:
   - displacement
   - follow-through
   - retest confirmation
4. It is not merely a sweep that immediately reclaims back inside

### Action mapping

| State | Action |
|---|---|
| close beyond level + displacement/follow-through | `buy` or `sell` |
| break without confirmation yet | `wait` |
| failed break / instant reclaim | `skip` |

## Canonical Pullback Event Pair

### `bullish_pullback`

#### Meaning

Price is in a bullish trend but temporarily retraces into value before expected continuation.

#### Canonical output

```json
{
  "event_key": "bullish_pullback",
  "event_type": "pullback",
  "direction": "bullish",
  "reason": "ema_reclaim",
  "action": "wait"
}
```

### `bearish_pullback`

#### Meaning

Price is in a bearish trend but temporarily retraces upward into value before expected continuation.

#### Canonical output

```json
{
  "event_key": "bearish_pullback",
  "event_type": "pullback",
  "direction": "bearish",
  "reason": "ema_reclaim",
  "action": "wait"
}
```

## Current Logic Comparison: Pullback

| Platform | What exists now | Current strength | Current mismatch |
|---|---|---|---|
| TradingView | Explicit pullback strategies exist, including EMA21 and Fib pullback logic in [Hung - Core.pine](/Users/macmini/Projects/moza/42trade/src/mt5-bridge/tradingview/Hung%20-%20Core.pine:1672) and [Hung - Core.pine](/Users/macmini/Projects/moza/42trade/src/mt5-bridge/tradingview/Hung%20-%20Core.pine:1691) | Richest setup detail | Strategy-specific outputs are not normalized to one event family |
| Node.js | `computePhase()` directly emits pullback phase from zone / EMA20 / sweep context in [realtimeAnalysis.js](/Users/macmini/Projects/moza/42trade/src/shared/rules-engine/features/realtimeAnalysis.js:885) | Clean state-level output | Less precise than Pine strategy logic |
| cTrader | EMA20 retest logic now emits explicit pullback events after directional seed context | Usable local phase fallback with dashboard output | Does not yet use the richer Pine zone/Fib context |

## Best Combined Pullback Logic

### Core formula

A `pullback` is confirmed when all of the following are true:

1. Primary bias and trend already exist in one direction
2. Price retraces into a value zone:
   - EMA retest
   - FVG/OB/SD zone
   - Fib retrace area
3. Structure is not yet invalidated
4. Event should normally not auto-fire `buy/sell` yet unless confirmation appears

### Action mapping

| State | Action |
|---|---|
| pullback detected but no continuation trigger yet | `wait` |
| pullback + rejection / reclaim confirmation | `buy` or `sell` |
| pullback becomes invalidation | `skip` |

## Canonical Continuation Event Pair

### `bullish_continuation`

#### Meaning

Bullish trend is reaffirmed after pullback, reclaim, or aligned confirmation.

#### Canonical output

```json
{
  "event_key": "bullish_continuation",
  "event_type": "continuation",
  "direction": "bullish",
  "reason": "bias_alignment",
  "action": "buy"
}
```

### `bearish_continuation`

#### Meaning

Bearish trend is reaffirmed after pullback, rejection, or aligned confirmation.

#### Canonical output

```json
{
  "event_key": "bearish_continuation",
  "event_type": "continuation",
  "direction": "bearish",
  "reason": "bias_alignment",
  "action": "sell"
}
```

## Current Logic Comparison: Continuation

| Platform | What exists now | Current strength | Current mismatch |
|---|---|---|---|
| TradingView | Hidden divergence, stack bias, MA/VWAP alignment, and post-pullback strategies all model continuation | Richest continuation nuance | Multiple strategy-specific outputs instead of one canonical event |
| Node.js | `computePhase()` emits continuation from aligned pattern, reclaim, or trend bias in [realtimeAnalysis.js](/Users/macmini/Projects/moza/42trade/src/shared/rules-engine/features/realtimeAnalysis.js:907) | Best unified state output | Simpler than Pine |
| cTrader | EMA20 plus rolling VWAP reclaim now emit explicit continuation events after directional seed context | Strong practical local fallback with dashboard output | Simpler than Pine and Node pattern-plus-bias logic |

## Best Combined Continuation Logic

### Core formula

A `continuation` is confirmed when all of the following are true:

1. Trend and bias are already aligned
2. Pullback or pause has completed
3. Price reclaims or confirms back in trend direction
4. Confirmation can come from:
   - pattern alignment
   - VWAP/EMA reclaim
   - level rejection
   - post-pullback BOS

### Action mapping

| State | Action |
|---|---|
| continuation confirmation present | `buy` or `sell` |
| trend aligned but continuation trigger not confirmed | `wait` |
| mixed continuation evidence | `skip` |

## Canonical Impulse Event Pair

### `bullish_impulse`

#### Meaning

Strong upward displacement shows aggressive bullish expansion.

#### Canonical output

```json
{
  "event_key": "bullish_impulse",
  "event_type": "impulse",
  "direction": "bullish",
  "reason": "momentum_shift",
  "action": "buy"
}
```

### `bearish_impulse`

#### Meaning

Strong downward displacement shows aggressive bearish expansion.

#### Canonical output

```json
{
  "event_key": "bearish_impulse",
  "event_type": "impulse",
  "direction": "bearish",
  "reason": "momentum_shift",
  "action": "sell"
}
```

## Current Logic Comparison: Impulse

| Platform | What exists now | Current strength | Current mismatch |
|---|---|---|---|
| TradingView | Impulse is present as a structural/filter concept and in momentum-rich setups, though not always emitted as one normalized event | Best context quality | No single canonical impulse event payload |
| Node.js | `computePhase()` defines impulse as `BOS + displacement` in [realtimeAnalysis.js](/Users/macmini/Projects/moza/42trade/src/shared/rules-engine/features/realtimeAnalysis.js:878) | Best explicit formula | Simpler than Pine |
| cTrader | Same-bar BOS/breakout plus displacement filter now emits explicit impulse events | Good local fallback with dashboard output | Uses price/range expansion only, without richer volume context |

## Best Combined Impulse Logic

### Core formula

An `impulse` is confirmed when all of the following are true:

1. A valid break or continuation event exists
2. Current candle or short event cluster shows displacement:
   - body/range dominance
   - range expansion versus recent median/ATR
3. Move is not just noise around a level
4. Optional strength upgrades:
   - high volume
   - aligned HTF bias
   - no immediate reclaim failure

### Action mapping

| State | Action |
|---|---|
| valid directional impulse with structure backing | `buy` or `sell` |
| expansion present but structure unclear | `wait` |
| expansion fails or is immediately reclaimed | `skip` |

## cTrader Dashboard Contract

Once the canonical event spec is implemented, cTrader should maintain a local rolling cache for each symbol and timeframe.

### Required shape

```json
{
  "symbol": "BTCUSD",
  "timeframe": "15m",
  "tf_color": "#00BFFF",
  "last_events": [
    {
      "event_key": "bullish_choch",
      "event_type": "choch",
      "direction": "bullish",
      "reason": "liquidity_sweep",
      "action": "buy",
      "bar_time": 0,
      "price_ref": 0,
      "score": 0,
      "confidence": 0
    }
  ]
}
```

### Cache rules

- key by `symbol + timeframe`
- keep latest 3 canonical events
- dedupe by `event_key + timeframe + bar_time + price_ref`
- newest first
- events should be available even when no order is placed

### Minimum timeframes for dashboard

- `1m`
- `5m`
- `15m`
- `1h`
- `4h`
- `1D`

### Current event families implemented in cTrader dashboard

1. `bullish_choch`
2. `bearish_choch`
3. `bullish_bos`
4. `bearish_bos`
5. `bullish_sweep_reclaim`
6. `bearish_sweep_reclaim`
7. `bullish_rejection`
8. `bearish_rejection`
9. `bullish_breakout`
10. `bearish_breakout`
11. `bullish_pullback`
12. `bearish_pullback`
13. `bullish_continuation`
14. `bearish_continuation`
15. `bullish_impulse`
16. `bearish_impulse`

### Current cTrader mapping details

The current cTrader implementation maps these event families from local chart logic as follows:

- `choch` / `bos`
  - source: `CollectStructureEvents(...)`
  - rule: pivot break with body-close confirmation and CHOCH-vs-BOS classification from prior structure state
- `sweep_reclaim`
  - source: `CollectConfirmedSwings(...)` + `TryMatchSweepPattern(...)`
  - rule: valid prior swing liquidity level is swept, then reclaimed by either:
    - single-bar reclaim
    - two-bar sweep then reclaim
  - direction:
    - sweep of low -> `bullish_sweep_reclaim`
    - sweep of high -> `bearish_sweep_reclaim`
- `rejection`
  - source: ranked structural levels built from:
    - previous completed period high/low
    - recent range support/resistance
    - confirmed swings
    - FVG midpoint levels
    - order block midpoint levels
  - rule:
    - bullish rejection when bar trades into/through level and closes back above it with meaningful response
    - bearish rejection when bar trades into/through level and closes back below it with meaningful response
- `breakout`
  - source: same ranked structural levels as rejection
  - rule:
    - bullish breakout when previous close is at/below level and current close finishes above it with bullish follow-through
    - bearish breakout when previous close is at/above level and current close finishes below it with bearish follow-through
- `pullback`
  - source: recent directional seed event + EMA20 retest
  - rule:
    - bullish pullback when bullish bias already exists, prior close stayed above EMA20, and current bar retests EMA20 then closes back above
    - bearish pullback when bearish bias already exists, prior close stayed below EMA20, and current bar retests EMA20 then closes back below
  - default action: `wait`
- `continuation`
  - source: recent directional seed event + EMA20 / rolling VWAP reclaim
  - rule:
    - bullish continuation when bullish bias exists and price reclaims both EMA20 and rolling VWAP from below
    - bearish continuation when bearish bias exists and price reclaims both EMA20 and rolling VWAP from above
- `impulse`
  - source: same-bar `bos` or `breakout` plus displacement filter
  - rule:
    - requires strong body/range dominance and range expansion above recent median range
    - bullish impulse requires bullish BOS or breakout seed on the same bar
    - bearish impulse requires bearish BOS or breakout seed on the same bar

This gives cTrader parity with the shared schema even though the exact APIs differ from Pine and Node.js.

### cTrader implementation status

Completed in repo source:

1. canonical event record class / enum set
2. symbol-timeframe event cache with last 3 events
3. CHOCH and BOS from existing structure logic
4. sweep reclaim from existing sweep detector
5. rejection and breakout from structural level logic
6. pullback, continuation, and impulse from local EMA / VWAP / displacement phase logic
7. dashboard rendering of last 3 events per symbol / TF

## Dashboard Requirement Prep

For the cTrader dashboard target, every symbol/timeframe row should eventually expose:

```json
{
  "symbol": "BTCUSD",
  "timeframe": "15m",
  "last_events": [
    {
      "event_key": "bullish_choch",
      "event_type": "choch",
      "direction": "bullish",
      "reason": "liquidity_sweep",
      "action": "buy",
      "bar_time": 0,
      "score": 0,
      "tf_color": "#00BFFF"
    }
  ]
}
```

The dashboard should store the last 3 canonical events for each symbol and timeframe.

## Remaining Verification Gap

The main remaining gap is not feature coverage in source, but verification:

1. compile the synced cTrader file inside cTrader
2. confirm the dashboard renders last 3 events correctly for each symbol / timeframe
3. tune thresholds if event density is too noisy or too sparse in live charts
