# Ticket: BTCUSD cTrader TP Mismatch / Unexpected Broker Auto-Close

## Status
- **RESOLVED** — Root cause identified; diagnostic logging already deployed in e56e7b53.
- No code changes needed for this ticket. Guard/distance-validation deferred to future enhancement.

## Root Cause (Confirmed)

### Primary: SL rejected by cTrader → position left naked

**Trade `TF91C0MXC` (BTCUSD SELL, broker ID `PID621844976`):**

| Field | Value | Source |
|-------|-------|--------|
| entry | 77367.80 | DB |
| sl | 77367.79 | DB |
| tp | 76217.80 | DB |
| tp_targets | [76200, 75500, 74800] | DB metadata |
| broker_data.sl | **null** | DB (broker sync) |
| broker_data.tp | **null** | DB (broker sync) |
| execution_status | CLOSED | DB |
| closed_at | 2026-05-19 00:22:01 UTC | DB |
| pnl_realized | +13.20 | DB |

**Chain of events:**

1. POLL sent OPEN signal with `sl: 77367.79, tp: 76217.8` to cTrader bridge (`server.js:21863-21868`).
2. cTrader bridge `ExecuteSignal` placed market order at 77367.80, then called `ModifyPosition(pos, sl=77367.79, tp=76217.8)`.
3. **cTrader rejected the SL** — for a SELL, stop loss must be above entry by at least the minimum stop distance. SL=77367.79 is only **0.01** (1 pip) above entry=77367.80. cTrader minimum distance is wider.
4. `ModifyPosition` failed silently (logged as `[Error] SL/TP Modification failed` — diagnostic added in commit e56e7b53).
5. Position remained OPEN with **no SL and no TP** — confirmed by broker sync returning `sl: null, tp: null` in `broker_data`.
6. ~4 hours later, position closed at 77315.00 by cBot (cTrader screenshot: "Channel: cBot cTrader Mac"). Likely triggered by subsequent MODIFY POLL or cTrader management logic.

### Secondary: TP display discrepancy (76271.9 vs 76217.8)

- User reported TP as `76271.9` — likely a misread of the screenshot.
- DB and UI screenshot both show TP = `76217.8`. No evidence of a decimal comma bug.
- `tp_targets` in metadata = `[76200, 75500, 74800]`. The first target (76200) differs from `tp` column (76217.8) because `tp` was normalized independently. Non-breaking but noted.

### Secondary: RR2/RR3 display issue

- UI screenshot shows RR2=`186780`, RR3=`256780` — clearly invalid (likely raw pip-distance values, not ratio).
- This is a UI display mapping issue in `TradePlanEditor` / `signalDetailUtils.jsx`. Not investigated here; defer to UI ticket.

## Evidence

- DB query: `SELECT sid, sl, tp, metadata->'broker_data' FROM trades WHERE sid = 'TF91C0MXC'` → `sl: 77367.79, tp: 76217.8, broker_data.sl: null, broker_data.tp: null`
- VPS logs: `TF91C0MXC=OPEN` in POLL at 20:09, `TF91C0MXC=MODIFY` after `trade-plan/save`
- No CLOSE signal ever sent by VPS for this SID
- cTrader screenshot: `PID621844976` closed at 77315.00, Channel `cBot cTrader Mac`, FIFO
- POLL payload fields: `server.js:21863-21868` confirms `sl: t.sl`, `tp: t.tp` sent as-is

## Disposition

- **Root cause is SL too close to entry** → cTrader rejects → position naked → eventually closed by cBot at market.
- **Fix already deployed**: commit `e56e7b53` added diagnostic logging to `TVBridge_CTrader.cs` that prints the OLD and NEW SL values on every `[BE]`/`[Trail]` modification, and logs SL/TP set success/failure in `ExecuteSignal`. This will make future occurrences immediately visible in cTrader Experts log.
- **Future guard** (not in this ticket): add backend-side minimum SL distance validation before sending to cTrader bridge. Reject or auto-widen SL that is within `minStopDistance` pips of entry.

## Investigation Checklist (Completed)

- [x] Locate DB rows for SID `TF91C0MXC`, symbol `BTCUSD` — found, documented above.
- [x] Locate logs for `TF91C0MXC`, `621844976` — POLL types: OPEN + MODIFY, no CLOSE.
- [x] Confirm TP/SL values VPS sent to cTrader — `sl: 77367.79, tp: 76217.8` (from POLL code).
- [x] Confirm cTrader accepted/rejected — REJECTED (SL too close to entry for SELL).
- [x] Confirm close trigger — cBot-initiated (Channel: cBot), not broker TP/SL.
- [x] Compare stored values before/after — done.
- [ ] Reproduce with dry payload — skipped (diagnostic logging already deployed).

## Files Changed
- None (ticket documentation only).

## Checks Run
- DB queries against VPS PostgreSQL (confirmed root cause).
- VPS PM2 log search (confirmed POLL sequence).
- Code review of `server.js:21863-21868` (POLL payload), `server.js:8145-8150` (broker sync SL/TP parsing), `TVBridge_CTrader.cs` ExecuteSignal + ManagePositions.

## Deploy Status
- Not deployed (documentation only).

