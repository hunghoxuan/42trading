# UI + Trade Model Notes (2026-03-26)

## Requested Backlog Items

1. Unified text placement on horizontal lines
- Scope: BOS/MSS/SWEEP labels and bottom-line trade visual labels.
- Rule: if line is bottom-context or downward-context, text should render below the line.
- Suggestion: create one shared placement helper method (line-label positioning policy).

2. Tooltip refactor (trade/pdarray/level/signal)
- Goal: short but information-dense format.
- PDArray tooltip target fields: index, created bar, state, volume/quality, source TF.
- Trade tooltip target fields: state, entry, TP, SL, RR, reason, created bar, direction.
- Level/signal tooltip: compact status + source + score.

3. MSS auto-fibo restore
- Restore drawing of nearest HTF1/HTF2 leg auto-fibo (feature existed before and was lost).

4. Bias dashboard behavior change
- Priority logic: `Trend > Bias`.
- Dashboard visual: background color follows trend, arrow indicates bias direction.
- Entry gating: prioritize trend over bias.

5. Liquidity label semantics and line-length consistency
- Clarify `$$$` vs `IDM` usage.
- Normalize line lengths:
  - all levels share same extension policy
  - all PD arrays share same extension policy
  - HTF can still use separate base constants but must be internally consistent.

6. Move trade config from global to entry-model level
- Candidate fields per entry model: RR (`0 => dynamic`), SL buffer profile, risk%.
- Reduce global Trade Config duplication where model behavior differs by design.

## Notes
- Implement in phased order: tooltip/placement first (low risk), then dashboard/fibo, then entry-model config migration (higher scope).
