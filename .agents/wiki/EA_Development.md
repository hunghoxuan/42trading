# EA Development Summary

Last updated: 2026-04-14

## 1) Scope
This document summarizes what we discovered, what broke, and what we fixed across:
- `mql5/TVBridgeEA.mq5` (MT5 EA)
- `webhook/server.js` (signal API + status/event pipeline)
- `webhook-ui` (dashboard/trades UX and diagnostics)

## 2) Main Issues Found

1. Compile/runtime issues in EA
- Compile errors around string parsing and `WebRequest` args.
- Runtime `HTTP_PULL_FAIL` and payload parse failures.

2. MT5 execution failures
- `retcode=10016` invalid stops.
- `retcode=10027` auto trading disabled by client.
- `retcode=10014` invalid volume (symbol-specific lot constraints).
- `no connection` errors when terminal account/permissions/network state was bad.

3. Signal lifecycle confusion
- Legacy and new webhook endpoints behaved differently in status/event semantics.
- `EA_PULLED` quickly followed by `EA_ACK_FAIL` looked suspicious but is actually expected in one poll cycle.

4. UI/data consistency gaps
- Status badges and filters not fully aligned with backend lifecycle.
- Symbol filter list and card fields were not always reflecting full data context (chart TF vs HTF).

5. Backtest/live workflow friction
- Strategy Tester optimization mode accidentally enabled.
- CSV refresh/deployment workflow needed automation and clear scripts.

## 3) Root Causes (What Actually Happened)

1. Invalid stops
- Broker minimum stop distance (`SYMBOL_TRADE_STOPS_LEVEL`) and freeze constraints were violated at modify time.
- Fast markets changed distance between entry and requested SL/TP.

2. Auto trading disabled
- MT5 terminal-side permissions/state (Algo button, EA common tab permissions, account mode/login state).

3. Invalid volume
- Fixed volume `0.01` not valid for some symbols (indices/metals/etc.) where min/step differ.

4. Expired signals
- EA intentionally drops old signals when `InpIgnoreOlderSec > 0`; ack returned failure for stale entries.

5. `no connection`
- Usually terminal/account/network state, not webhook API state.
- Seen especially when account authorization/terminal environment was unstable.

## 4) Fixes Implemented

## 4.1 EA (`mql5/TVBridgeEA.mq5`)
- Added/strengthened symbol resolution guard:
  - If symbol cannot be resolved: warn/log and ignore (no fallback to current chart symbol).
- Added duplicate signal-id gate + cache.
- Added signal age gate (ignore old signals).
- Added cleaner on-chart debug panel (poll stats + queue + open positions summary).
- Added build/version constant shown in panel so running version is visible.
- Added pull summary log each poll cycle.
- Added stop normalization + safer stop handling flow.
- Added stop retry mechanism after market execution.
- Increased default stop buffer to reduce invalid stop failures.
- Added automatic volume normalization using symbol min/max/step to fix invalid volume.
- Added virtual SL/TP guard framework (configurable) to manage exits when broker-side TP/SL set/modify is unreliable.
- Added backtest mode support (CSV replay path in Strategy Tester).
- Added `EXPIRED` ack status when signal is stale (instead of generic FAIL).

## 4.2 Server (`webhook/server.js`)
- Standardized status lifecycle handling and mapping.
- Added/normalized statuses including:
  - `NEW`, `LOCKED`, `OK`, `FAIL`, `TP`, `SL`, `CANCEL`, `EXPIRED`
- Added bulk cancel endpoint behavior to set `CANCEL`.
- Improved lifecycle event logging (timeline clarity).
- Ensured legacy endpoint compatibility while moving toward consistent logic.
- Added/maintained CSV download support for backtest feed.

## 4.3 UI (`webhook-ui`)
- Trade card compact redesign and data cleanup.
- Status color mapping expanded (`CANCEL`, `EXPIRED`).
- Filter/status controls improved (combo-based status selection).
- Pagination controls improved (first/prev/next/last + page size).
- Bulk action workflow refined (action combo + confirm action).
- Timeline/event visibility improved for pull/ack diagnosis.

## 5) Current Status Lifecycle (Practical)

Typical path:
1. `NEW` (signal stored from TV/webhook)
2. `LOCKED` (EA pulled/claimed for execution)
3. Result:
   - `OK` (ack success / accepted outcome)
   - `FAIL` (execution failed)
   - `EXPIRED` (ignored as stale)
   - `CANCEL` (manual/bulk cancel)
4. Position outcomes (if tracked/updated later):
   - `TP` / `SL`

Note:
- `EA_PULLED` then `EA_ACK_FAIL` in the same second is normal: pull and ack happen in one poll loop.

## 6) Key Inputs to Watch in EA

- `InpPollSeconds`
- `InpDeviationPts`
- `InpIgnoreUnknownSymbol` (should remain `true`)
- `InpIgnoreDuplicateId` (should remain `true`)
- `InpProcessedKeepSec`
- `InpIgnoreOlderSec` (set `0` to disable expiry; otherwise stale signals become `EXPIRED`)
- `InpStopBufferPts` (increased default to reduce invalid stops)
- Backtest:
  - `InpReplayFromFile` = `true` only in Strategy Tester
  - `InpBacktestCsv` path under `Common/Files`

## 7) Operational Checklist

Before live/demo run:
1. MT5 account logged in with trading permission (not read-only/investor mode).
2. Global `Algo Trading` button is green.
3. EA attached and allowed to trade (EA properties).
4. WebRequest allow-list includes server URL.
5. Symbol exists in broker market watch and is tradable.
6. Check terminal Journal for `10027`, `10016`, `10014`.
7. Confirm EA panel build version is latest.

Before backtest:
1. Strategy Tester in **Single test** mode (not optimization).
2. `InpReplayFromFile=true`.
3. CSV exists in MT5 `Common/Files`.
4. Disable old-signal gate if replaying older data (`InpIgnoreOlderSec=0`).

## 8) Known Remaining Risks / Open Items

1. Broker-specific execution constraints still vary by symbol/session.
2. Some TP/SL operations may still require fallback (virtual guard) when server-side stops are rejected.
3. Lifecycle completeness for `START`/position-open semantics can be expanded if needed.
4. Full automated end-to-end tests (TV push -> EA pull -> ack -> UI) are partly script-based; full deterministic test harness can be expanded further.

## 9) Recommended Next Steps

1. Recompile EA and verify no compile warnings/errors on current branch.
2. Run smoke test with one known-good symbol and one intentionally invalid symbol.
3. Run CSV replay backtest with `InpIgnoreOlderSec=0` and verify lifecycle transitions.
4. Validate volume normalization on non-FX symbols (e.g., indices/metals).
5. Lock final status contract and document exact transition rules in API docs.

## 10) Refactor-Safe Requirements (Do Not Break)

These are now product requirements, not optional implementation details.

1. TradingView webhook emission must remain realtime-only at final emitter gate.
- Final emit path uses `emit_trade_webhook_new_trade(..., realtimeOnly=true, ...)`.
- Effective contract: webhook alert can only be sent when `barstate.isrealtime=true`.
- `barstate.isconfirmed` alone is not enough to permit emission.

2. Two-layer gate model is intentional.
- High-level strategy code may process with `(barstate.isrealtime || barstate.isconfirmed)`.
- Final emitter gate still enforces realtime-only.
- This is not a conflict; it prevents historical/backfill webhook pushes.

3. Alert interval/frequency is not a scheduler for signal logic.
- Script condition evaluation controls whether alert() is called.
- Alert frequency setting controls throttling/duplication behavior, not creation of signal conditions.

4. Payload timeframe fields must remain explicit and stable.
- `chartTf` represents chart timeframe used for the alert context (LTF/source chart).
- `sourceTf`/HTF fields represent strategy higher-timeframe model context.
- UI should display both when available, e.g. `ChartTF: 1m, HTF: 60`.

5. Regression checklist for any refactor touching Pine emitter code.
- Verify all strategy call sites still pass `realtimeOnly=true` in production emit flow.
- Verify final emitter still checks realtime before `alert(...)`.
- Verify no historical bars produce outbound webhook after reload.
- Verify payload still includes expected TF fields (`chartTf`, `sourceTf`/HTF).
