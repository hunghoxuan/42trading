# Shared cTrader execution management

Build: `v2026.11.03 - shared-execution`.

## Execution sources and shared state

Strategy signals, Now/Wait plans, chart trades and exit follow-ups use the
strategy execution stage. Legacy SL reversal now produces a signal for that same
stage. Direct bridge adapters join the same action journal at `AutoExecuteTrade`.
Market/limit/stop submissions remain centralized, with an SL attached on creation.

`ExecutionActionState` records the action key, status, UTC update, broker ticket,
reason and resolved configuration reference. Statuses are Waiting, Ready,
Submitting, Accepted, Blocked, RetryableFailure and Failed. Chart-event caches do
not consume these actions. The wait engine's terminal keys remain a compatibility
projection for queue synchronization.

Normal setup identity includes Strategy + Symbol + TF + slot + trigger bar. This
preserves deduplication between scanners for one strategy while allowing separate
strategies to trade the same bar. Old accepted keys without strategy identity are
honored during migration. Exit identity is parent ticket + symbol + TF + slot.

## Position settings and new actions

An interned configuration snapshot is saved before a managed order is submitted.
The `cfg` comment token references it; pending fills and instance restarts reuse
the same snapshot. Existing positions preserve these management settings:

- Exit Management;
- Trailing Method;
- Break Even Offset;
- Partial Close Plan;
- Orders Expiry, for fallback management of orders without a broker deadline.

New exit-triggered orders resolve the strategy's **current** configuration at the
exit event, including the shared fallback settings. Their resolved action snapshot
is reused for a short retry, so an attempt cannot silently switch protection or
filters. Disabling an OnExit slot therefore stops future follow-ups; existing
positions keep their original exit management. Mandatory account risk and profit
rules always use their current account settings.

Positions with the same policy share one management scope per pass. A missing or
invalid policy is logged and skipped without blocking management of other groups.
Positions from older builds without `cfg` use the current strategy configuration.

## Ownership and broker reconciliation

The cached `TradeIdentity` parses strategy, timeframe and metadata once and is
reused by management, pending expiry and follow-up handling. The cache is bounded.
Instance operations reject a foreign `owner` token. Legacy untagged managed
exposures retain compatibility handling; OnExit requires verified instance ownership.
Account-wide profit/risk enforcement retains its account scope.

Broker comments contain readable plan names and compact recovery references:
`owner`, `cfg`, `action`, and, for exit follow-ups, `exit_slot`, `from`, `exit`.
`action` identifies the journal action for reconciliation against positions,
pending orders and closed history. It is not another entry condition.

## Exit scheduler and failure handling

Close callbacks record work in a durable queue; they do not submit a replacement
inside the broker callback. The tick/timer scheduler handles at most twelve due
exit jobs per pass. The normal creation, market, session, confluence, protection,
margin, direction and risk gates still decide whether each new order is allowed.

OnExit direction mappings retain their existing meaning. Each fully closed
original position can seed each matching exit slot once. Exit-created children
never seed any further exit trade or legacy reversal. Queue recovery and the
final execution stage require original-parent evidence. Replacements remain one
order, rather than recursively splitting.

Legacy SL reversal retains its net-loss policy and one-reversal guard, but uses
the shared entry/protection/sizing pipeline instead of a separate fixed-volume
broker route. It also respects current session and strategy gates.

Definite TechnicalError/Disconnected failures can retry at two- then four-second
backoff, with at most three attempts, within the original current source-bar
window. Missing completed source data can use the same bounded retry. Blocked
entries and permanent broker errors terminate the exit action. A new confirmed
bar does not reopen an old blocked exit.

The journal reserves a broker attempt before submission and records acceptance
before post-fill protection/audit work. An interrupted submission restores as
uncertain: broker positions/orders/history are checked before any retry. If its
outcome cannot be confirmed, it remains terminal rather than blindly resubmitting.
Ambiguous timeouts are not automatically retried.

## Persistence and cost controls

Instance-local storage keys:

- `Execution Actions v2` — accepted and recovery-relevant actions;
- `Execution Policies v1` — interned resolved settings;
- `Execution Exit Jobs v1` — pending exit work.

Journal retention uses explicit UTC timestamps, rather than sorting timestamp
ticks and position IDs together. Persistent records are bounded to 2,000; active
queued work is retained separately. Unchanged JSON is not rewritten. Broker
acceptance invalidates account snapshots so later legs see the changed exposure.

The native build must contain the main source and all seven companion partials,
including `TVBridge_CTrader.Execution.cs` and `TVBridge_CTrader.TradePlans.cs`.
