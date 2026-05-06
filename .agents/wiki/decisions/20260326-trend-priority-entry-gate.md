# Trend > Bias Entry Gate (SMC/MSS)

## Goal
Apply `Trend > Bias` priority in direction gating for trade entry decisions.

## Rule
For each TF filter (LTF/HTF1/HTF2):
- if trend direction is known (`!= 0`), use trend for direction match.
- else fallback to bias direction.

## Applied In
- `Hung - SMC.pine`
- `Hung - MSS.pine`

## Scope
- Direction gate only (`direction_allowed_raw` path).
- No dashboard visual change in this step.

## Expected Effect
- Entries become more consistent with market structure direction when trend/bias conflict.
