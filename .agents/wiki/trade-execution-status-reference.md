# Trade Execution Status Reference

## Canonical Status Table

| DB `execution_status` | Meaning | API Filter | UI Label | cTrader Status | MT5 EA Status |
|---|---|---|---|---|---|
| `Draft` | Template, not sent | `Draft` | DRAFT | — | — |
| `PENDING` | Sent, waiting broker | `PENDING` | PENDING | — | — |
| `PENDING_MOD` | Modify requested (internal) | — | — | — | — |
| `PENDING_CLOSE` | Close requested (internal) | — | — | — | — |
| `PENDING_CANCEL` | Cancel requested (internal) | — | — | — | — |
| `FILLED` | Live position (was OPEN) | `FILLED` | FILLED | position open | position exists |
| `CLOSED` | Closed (TP/SL/Manual) | `CLOSED` | CLOSED | position gone | position closed |
| `CANCELLED` | Cancelled/expired | `CANCELLED` | CANCELLED | — | order cancelled |
| `REJECTED` | Broker rejected | `ERROR` | ERROR | rejected by broker | `TRADE_RETCODE_ERROR` |

## Notes

- `OPEN` merged into `FILLED` — both mean live position. No functional difference in any code path.
- `FILLED` tab in UI sends `execution_status=FILLED` (was `OPEN` before merge).
- `PENDING_MOD`, `PENDING_CLOSE`, `PENDING_CANCEL` are internal only — used for EA task dispatch.
- `CLOSED` includes TP, SL, and manual closes.
- `CANCELLED` + `REJECTED` both display as error states in UI.

## Lifecycle

```
Draft → PENDING → FILLED → CLOSED
                         → CANCELLED
                         → REJECTED
```
