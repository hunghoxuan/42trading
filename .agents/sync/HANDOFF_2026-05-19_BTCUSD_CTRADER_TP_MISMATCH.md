# Handoff: BTCUSD cTrader TP Mismatch / Unexpected Auto-Close

## Status: RESOLVED (2026-05-19)

Root cause confirmed. No code changes needed — diagnostic logging already deployed in e56e7b53. See ticket for full details.

## Resolution Summary
- **Root cause**: SL=77367.79 only 0.01 above entry=77367.80 for BTCUSD SELL. cTrader rejected ModifyPosition (minimum stop distance). Position left naked with no SL/TP. Closed ~4h later by cBot at 77315.00.
- **Already fixed**: Commit e56e7b53 added `[Order] SL/TP set` / `[Error] SL/TP Modification failed` logging in ExecuteSignal, and old→new SL logging in BE/Trailing. These will make future occurrences visible in cTrader Experts tab.
- **Future**: Add backend minimum SL distance validation guard (separate ticket).

## Read First
- Ticket: `.agents/.product/tickets/1-backlog/2026-05-19-btcusd-ctrader-tp-mismatch-auto-close.md` (updated)
- Rules: `AI.md`, `.agents/BOOTSTRAP.md`

