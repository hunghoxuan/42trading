# Signal vs Event Semantics (v1)

## Canonical Definitions

1. `Signal`
- Informational detection object.
- Represents reaction/state evidence (e.g., sweep, reversal hint, candle pattern, bullish/bearish indication).
- Can be pruned aggressively (max recent size + age window).
- Not required to create a trade directly.

2. `Event`
- Trade-trigger candidate object.
- Built from one or multiple signals (or direct structural confirmation).
- Enters trigger queue and passes entry policy checks (`when/type`, bias/side, score/risk gates).

## Pipeline
- Detect -> `signal`
- Aggregate/qualify -> `event`
- Confirm policy -> `trade`

## Practical Rule
- Use `signalHist` for memory/reference and directional context.
- Use `events` queue only for actionable trigger flow.
