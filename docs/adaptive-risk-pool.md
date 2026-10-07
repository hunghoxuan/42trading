# cTrader adaptive risk pool

> **Historical mode note (2026-09-30):** This document describes the legacy pool behavior now exposed as `Adaptive Risk = Per Chain`. The current UI also supports `Off` and `Balance Recovery`, and the former advanced parameters are hidden with code defaults. For the current contract and formulas, read [ctrader-ai-agent-handoff.md](./ctrader-ai-agent-handoff.md#11-adaptive-risk).

Enabled by `Adaptive Risk = Yes`. The initial pool is `M. risk total` evaluated
against the balance when the pool is first activated. Its anchor and ledger are
stored by broker/account/Pool ID under the bridge config directory. Restarting
does not replenish the pool. Live state is separate from each simulated backtest.

With the default 100% profit participation:

    pool = clamp(initial pool + completed setup net PnL, 0, initial pool × 150%)
    target risk per setup = min(pool / risk slots, anchor balance × 1%)

The final allocation is also limited by free pool capacity, daily-loss allowance,
drawdown allowance, and the existing per-direction, margin and broker gates.
Risk slots default to `M. trades total` (20); an explicit override is available.
The existing broker-position count limit remains an additional ceiling: three
legs share one risk allocation but still occupy three broker-position slots.

When adaptive mode is enabled the computed allocation replaces the fixed
`M. risk / cBot trade` sizing rate. `Per-idea hard cap %` is measured against the
persisted anchor balance. Manual sizing continues to use its separate parameter.
When disabled, existing fixed-percentage sizing applies.

All chain slots and split legs of the same strategy/symbol/timeframe/trigger/side
carry the same `ar` parent token. Closed-deal IDs deduplicate history, including
partial closes. The pool credits net PnL only after the complete parent has no
open positions, pending orders or local waiting entries. Unfinished net losses
consume reserve immediately. Reversals receive a separate parent token.
Only tagged bridge setups contribute PnL; manual trades, other bots, deposits and
withdrawals do not. Positions that predate activation are not retroactively tagged.
Their open risk still consumes capacity. Existing positions are never resized.

Total capacity includes stop-loss risk on account positions and pending orders.
An unprotected position/order or unavailable symbol blocks new adaptive exposure.
Unreadable/corrupt state fails closed; a new pool initializes only when no
state exists. Final broker submission is serialized by account/pool on this host.
All instances sharing a Pool ID must use the same pool/reset settings. This local
file lock does not coordinate separate machines trading the same account.

Defaults: 150% pool ceiling, 1% anchor-balance per-idea cap, 100% profit
participation, manual reset. Losses always count in full; reduced participation
only discounts positive cumulative PnL. Increment `Manual reset version` to
intentionally re-anchor. Optional Daily/Weekly reset uses the strategy clock's
UTC day / Monday week; the first refresh in the new period starts its new ledger.
Reducing risk to zero blocks new cBot trades; it does not liquidate existing ones.

The risk dashboard displays CURRENT M.risk/trade and CURRENT M.risk total in
account currency and as percentages of current balance, plus pool, realized PnL,
open risk, free capacity, last completed outcome and streak. Current trade risk
is the available pre-confluence parent allowance, before splitting among legs.
The streak is informational; there is no additional streak sizing multiplier.

`[AdaptiveRisk]` logs explain submission and rejection calculations and respect
the normal Log Filter. SL risk is an estimate; execution slippage, gaps and fees
can make realized loss differ from the planned allowance.

## Market-close gap protection

`Overnight block` and `Weekend block` now default to `Cbot`. When `Overnight
block` includes `Cbot`, `Market close buffer (min)` uses the
broker's cTrader `Symbol.MarketHours` schedule. During the buffer (15 minutes by
default), new cBot orders are rejected, strategy-managed pending orders are
canceled, and strategy-managed open positions are closed. `Both` applies the
same behavior to bridge-tagged manual trades; unrelated account positions are
never touched. The action runs before the strategy scheduler and daily-loss
enforcement. It reduces scheduled rollover/weekend gap exposure, but cannot
guarantee an exact exit price during an unscheduled market halt or a quote gap
that begins before the protection window.

Verification harness: `.local/adaptive-risk-check/Check.csproj` invokes production
methods from the rebuilt DLL. It tests sizing, clamps, partials, parent grouping,
duplicate deals, persistence round trips, invalid state and sizing-slot selection.
Synthetic fixed/adaptive outcome comparisons are included. They are not a
historical performance backtest or evidence that adaptive sizing improves returns.
