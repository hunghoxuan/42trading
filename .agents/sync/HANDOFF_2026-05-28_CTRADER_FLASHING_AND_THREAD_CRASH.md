# Handoff — 2026-05-28: cTrader Flashing / Thread Crash + Sync Ticket Status

## Scope

This handoff captures:

1. Latest proposed sync solution (from ticket) and current implementation state.
2. Current status of `bridge-clients/TVBridge_CTrader.cs` after multiple rounds of edits (DeepSeek + later edits).
3. Immediate risk notes for the next agent before touching code again.

---

## 1) Latest Proposed Solution (Ticket) + Implementation State

Primary ticket:

- `.agents/sync/TICKET_2026-05-28_VPS_CTRADER_TRADE_SYNC_SOURCE_OF_TRUTH.md`

Latest proposal in ticket covers:

- strict VPS->broker action typing (`OPEN`/`MODIFY`/`CLOSE`/`CANCEL`)
- stale task rejection
- lease retry rejection
- lease-token strict ACK validation
- broker snapshot idempotency via hash
- manual terminal status queueing for broker-linked trades
- tracked-symbol cleanup (drop unsupported watchlist symbols like `XAGGBP`)

### What is currently implemented server-side

Implemented in `webhook/server.js` + `webhook/syncGuards.js` + tests:

- broker task type normalization to `OPEN` by default
- stale NEW/PENDING pull-task auto rejection
- lease retry auto rejection
- ACK update requires matching lease token and LEASED state
- broker snapshot hashing + skip unchanged item apply
- manual terminal edit mapping for broker-linked rows (`PENDING_CLOSE` / `PENDING_CANCEL`)

### What remains partial (from ticket)

- full revision/origin protocol (`vps_revision`, `broker_revision`, event table)
- complete MODIFY coverage for pending entry/volume/order-type changes
- robust TP/SL close reason fidelity from broker history payload
- full audit of all non-V2/legacy status endpoints

---

## 2) Current cTrader Code Status (read from latest file)

File:

- `bridge-clients/TVBridge_CTrader.cs`

Current build string in file:

- `v2026.05.28 19:05 - busy-timeout-recover`

### DeepSeek-origin changes still present

- pending-order SID fallback via position lookup (`posSidLookup`)
- `ResolveSid` + `_ticketSidMap` backfill logic for recreated pending order IDs
- `SafeAck(...)` helper exists and is used in key close/cancel branches
- tracked symbol filtering via `TryResolveBrokerSymbol(...)`

### Later edits currently present (post-DeepSeek)

- `OnTimer()` now dispatches `OnTimerCore` through `BeginInvokeOnMainThread(...)`
- `_isBusy` guard is present
- `_busySince` timeout recovery is present (15s reset if stuck busy)
- status staging logic still sets early `POLLING` / `SYNCING` on first cycles
- tracked symbol fetch uses HTTP async flow and symbol resolution logic

### Critical runtime symptom observed by user

- cTrader repeatedly flashes and/or remains in `BOOTING/STARTING` style states
- previous logs showed repeated:
  - `Unable to invoke target method in current thread. Use BeginInvokeOnMainThread...`
  - cBot crash-restart loops

### Important code-path risk still relevant

- `FetchTrackedSymbolsAsync()` executes in background task (`Task.Run(...)` from `OnTimerCore`).
- symbol API calls in this path must stay on main thread.
- this area has been edited repeatedly and is high risk for regressions.

---

## 3) Workspace State Right Now

From `git status --short` at handoff time:

- `M bridge-clients/TVBridge_CTrader.cs` (active local modifications)
- many generated runtime files under `data/logs/*` and `data/market_data/*`
- unrelated UI file also modified: `web-ui/src/pages/trades/TradesPage.jsx`
- untracked runtime file(s) in logs and `webhook/market_data/`

Notes:

- Worktree is dirty with runtime artifacts; do not treat them as code changes.
- Focus only on intentional code files unless user asks otherwise.

---

## 4) Recommended Next-Step Strategy (for next agent)

Do this in strict order:

1. Stabilize cTrader thread-safety first; no feature edits.
2. Ensure every cTrader API call (`Symbols`, `Positions`, `PendingOrders`, `Chart`, `ModifyPosition`, etc.) runs on main thread.
3. Minimize `Task.Run` usage around code that may indirectly touch cTrader API.
4. Keep debug panel logic simple; avoid complex redraw logic until crash loop is gone.
5. Verify with startup Journal sequence before any sync behavior tuning.

Minimal acceptance for cTrader stability:

- no `Unable to invoke target method in current thread` errors
- no auto crash-restart loop
- panel stays visible and updates at least every timer interval
- `/v2/broker/pull` and `/v2/broker/sync` continue to hit local webhook without bot restart

---

## 5) Operator Notes for User Context

- User is highly frustrated due to repeated regressions in cTrader behavior.
- Priority should be stabilization and rollback-safety, not additional enhancement.
- Keep any next patch very small and easy to revert.

