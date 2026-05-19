# Handoff: RR2/RR3 explosion + Entry/TP/SL drift in trade plan UI

## Read
- `.agents/.product/tickets/1-backlog/done-fix-bug-rr2-rr3-entry-tp-sl-drift.md`
- `web-ui/src/utils/signalDetailUtils.jsx`
- `web-ui/src/components/TradePlanEditor.jsx`
- `web-ui/src/components/SignalDetailCard.jsx`

## Task
Fix UI plan-value precedence and normalization so broker sync updates cannot produce invalid SELL/BUY SL placement and absurd RR2/RR3 values in editor.

## Constraints
- Keep backward compatibility (`tp`, `tp1/tp2/tp3`).
- Keep raw AI trade plan integrity (do not mutate raw source contract).
- Do not deploy if build/checks fail.

## Verify
- Build web UI.
- Confirm SELL example cannot show `SL < Entry`.
- Confirm RR2/RR3 stays blank/sane when risk denominator is invalid.
