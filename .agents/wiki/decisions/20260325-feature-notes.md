# Feature Notes (2026-03-25)

Source: user rapid notes for upcoming roadmap work.

## Candidate Features

1. Gate/score/limitation reduction
- Problem: too many gates and scoring layers, unclear measurable benefit, runtime overhead.
- Direction: audit each gate; keep only gates with clear purpose + observed benefit.

2. Events vs Signals model
- Problem: queue semantics overlap is unclear.
- Direction: define signal taxonomy (reaction, buy/sell, reversal, sweep, candle, bullish/bearish) and use signals as trade inputs.
- Constraint: signals should be pruned and keep only recent capped set.

3. HTF1-priority direction policy
- Problem: trend and bias can conflict; aggregate score may be unstable.
- Direction: evaluate simpler rule:
  - prioritize HTF1 trend over LTF.
  - optional strict mode: only allow when trend and bias align.

4. Trade "size/length" minimum
- Problem: tiny trades are risky and hard to read on chart.
- Direction: introduce minimum trade geometry constraints before add-trade.

5. Contextual risk by leg phase
- Problem: counter-leg entries at early leg phase are high risk.
- Direction: leg-phase/risk model:
  - early up leg: avoid sell, prefer buy.
  - mature up leg + HTF1 obstacle: sell becomes more acceptable.

## Implementation Policy Reminder
- If requested as feature exploration: discuss and backlog first.
- If requested as fix/urgent: implement immediately.
