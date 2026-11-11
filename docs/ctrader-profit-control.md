# Account Profit Control

`Profit Control` contains Max Daily Win, Max Total Win and two percentage-only basket exit settings.

| Parameter | Meaning |
| --- | --- |
| Max Daily Win | Existing daily profit rule; its accounting, Rules Profile scope and stop behavior are unchanged. |
| Max Total Win | Existing cumulative account or strategy + symbol + timeframe profit cap; unchanged. |
| Profit Lock | `None` disables the basket exit. A percentage sets the profit threshold that closes immediately with zero giveback, or activates trailing with positive giveback. Default: `None`. |
| Profit Giveback | The allowed decrease from the basket profit peak after activation, in percentage points of the basket-start balance. Default: `_0pct` (close at the Profit Lock threshold). Ignored while Profit Lock is `None`. |

The old Open Profit Target setting has been removed. Both zero and positive giveback use the same basket accounting: net realised profit from tracked basket members plus their remaining floating net profit, including losses, commission and swaps. Percentages use the account balance captured when the basket starts; that balance stays fixed through partial closes, deposits and withdrawals. Currency choices are not offered for these two controls. Max Daily Win and other risk menus retain their own existing choices.

## Examples

With a $10,000 basket-start balance:

| Profit Lock | Profit Giveback | Exit |
| --- | --- | --- |
| None | Any value | Basket exit disabled. |
| 8% | 0% | Close the account basket when its net profit reaches $800. |
| 8% | 0.5% | Activate at $800. If that is the peak, close at $750; if profit rises to $1,000, close at $950. |

Profit Giveback is a continuous trailing distance, not a stepped promotion interval. Prices are observed when the cBot runs; trigger thresholds do not guarantee the final closing profit.

## Saved settings

- The existing `ProfitLockStartPreset` key now displays as **Profit Lock**; `ProfitGivebackPreset` retains its key and display name.
- All percentage numeric IDs are preserved, in numeric percentage order. The old Giveback `None` ID (0) now displays as `_0pct`.
- Existing percentage Lock Start/Giveback pairs retain their settings and trailing behavior. Live basket membership, net-profit baselines, peak and unfinished exit state retain their existing storage format.
- To replace an old Open Profit Target profile, select its percentage under Profit Lock and set Profit Giveback to `_0pct`. Its former floating-only accounting is now unified with basket net profit, so partial-close results count toward the threshold.
- Retired currency IDs are not interpreted as percentage choices. An enabled control with an invalid old currency selection reports the configuration error and blocks new entries until a valid percentage is selected; it does not liquidate or stop solely because of that configuration error.

## Max Total Win — v179

Located immediately after **Max Daily Win**. Default **None**.

- `All_5pct` through `All_100pct` in 5% increments.
- `Idea_1pct` through `Idea_10pct`, then `Idea_15pct`, `Idea_20pct`, `Idea_25pct`, and `Idea_55pct` through `Idea_100pct` in 5% increments.

Both scopes use the **original account balance captured when this control first starts**, not a changing balance or the daily/basket balance. With $10,000 original balance, All_5pct is $500 cumulative account net profit and Idea_3pct is $300 cumulative net profit for each strategy + symbol + source timeframe. Wins and losses offset each other. Partial-close net results are included once, together with the remaining floating net profit. Commission and swaps are included through cTrader's NetProfit. Deposits and withdrawals do not count as trading profit.

`All_*` includes every account position, including manual trades and other bots, plus account trades closed since the start anchor. On reaching the target, it latches the exit, cancels all broker pending orders and internal wait-confirm routes, closes all positions, and stops the cBot/backtest **after flattening succeeds**. Failed actions are retried even if profit later falls below the target.

`Idea_*` aggregates both directions and all split legs sharing the exact **strategy + symbol + entry source timeframe**. For example AtrEmaPullbackV1/XAUUSD/m5, EmaCrossV1/XAUUSD/m5 and AtrEmaPullbackV1/XAUUSD/m15 are three separate ideas. Strategy identity comes from the broker label with its per-setup chain suffix removed; different setups and split legs of the same strategy share the total. A higher-timeframe SL or confluence does not change ownership. Reaching the target permanently blocks new bridge orders for that idea, cancels its pending orders and wait-confirm routes, and closes only its positions. Other ideas and the cBot continue. Broker failures retry on later passes. External bots cannot be prevented from submitting new trades; matching positions are closed on subsequent checks.

Strategy and entry-time source timeframe are read from broker trade metadata. Unattributed manual/external trades count in All mode but are not guessed into an idea. Bridge submissions missing strategy or source timeframe are rejected in Idea mode. Reducing existing volume is still allowed.

There is **no daily or flat-basket reset**. Live instance storage retains the original balance, start time and stopped scopes across restarts; old closed history before that anchor is excluded. None disables enforcement; selecting an enabled preset again restores the existing instance's lifetime state. A new instance establishes a new lifetime anchor. Each backtest starts fresh without reading or modifying live state. Corrupt/unavailable state or unsettled close history blocks new entries until reconciled, while existing protection can continue.

V179 migrates the prior symbol/TF storage format while keeping the original balance, lifetime start, All stop latch and volume reconciliation state. Old aggregate idea latches cannot identify a strategy and are discarded; strategy-specific totals are rebuilt from the same lifetime trade history, then evaluated against the selected limit. New strategy-specific latches survive restarts.

Max Total Win is optional profit exit management and remains active with **Rules Profile = No**. Mandatory account rules retain priority. Max Daily Win keeps its existing profile-dependent behavior and still actually stops the cBot when hit; its log wording does not implement automatic next-day restart.

### V180 entry-gate correction

V178/v179 incorrectly treated ordinary `B|m5.event|...` and `S|m5.event|...` comments as missing the source timeframe, rejecting normal entries whenever Idea mode was enabled. Flipped or risk-adjusted direction prefixes could pass, explaining the sparse executions. V180 uses the existing `GetStrategyCommentEventLabel` contract shared with the comment producer, covering ordinary Buy/Sell, flipped, risk-adjusted and legacy comments without guessing a timeframe from SL or confluence fields. The regression uses production-generated comments and compares actual broker-submit dispatch in None versus Idea_3pct below the target, then checks that only the reached strategy/symbol/TF is blocked.

V180 also normalizes closed-trade timestamps with the UTC cBot clock, preserving unspecified UTC timestamps rather than shifting them through the machine timezone. The earlier conversion could exclude initial closes from lifetime history and leave volume reconciliation waiting indefinitely, blocking all new entries after the first close. A regression closes a below-target position with an unspecified UTC timestamp and verifies that its net profit is counted and another order still reaches the broker dispatcher.

## Scope and lifecycle

The basket includes **all account positions**, across all symbols and including manual trades and other bots. New positions joining before the account becomes flat belong to the same basket. These are account controls, so configure one controlling instance per account. They are shared account settings, not shadowed by individual strategy JSON profiles.

On a trigger, the cBot latches the exit, cancels all broker pending orders, terminalizes its internal wait-confirm routes and closes every account position. These actions are not atomic. It blocks bridge submissions during closing, retries failures on later quotes/timer passes and continues closing even if profit subsequently falls below the original threshold. A fill racing cancellation is caught by the following pass. External bots can still submit their own orders; this cBot cannot gate their submissions.

After all positions and pending orders are gone, the latch/peak reset. New bridge orders may resume after the strategy clock advances beyond the completion quote. The new exits never set the mandatory account-stop flag or call Stop. Existing deduplication, entry-time, risk and strategy gates still apply; resuming permission does not force a new trade.

Mandatory rules are checked first. Max Daily Win is still subject to the existing Rules Profile switch: Rules Profile No bypasses it. Profit Lock are independent exit management and still run with Rules Profile No. Existing per-position TP, RR Ladder and trailing management continue until an account exit takes priority.

## Accounting and partial closes

Profit Lock measures:

```text
basket profit = realised net profit from tracked basket members
             + remaining positions' floating net profit
```

Each tracked position starts with a baseline of its already-closed deals. Subsequent partial/full closing deals count once through aggregated history. A partial close transfers PnL from floating to realised without creating an artificial giveback. Deposits/withdrawals are not deal profit and do not change this basket PnL. While position volume has decreased but closing history has not caught up, the bot waits for history: it blocks new entries, keeps normal per-position protection running and does not treat missing realised PnL as a drawdown.

The account becoming naturally flat resets the cycle before a same-event SL reversal or another trade starts. First activation on existing positions observes their current floating PnL; it cannot recover a peak that happened before tracking, and prior partial deals become the initial baseline.

## Persistence and runtime

- Live state persists under the same cBot instance and broker/account: members and baselines, basket-start balance, observed peak, armed status and exit latch.
- Live writes flush at most every five seconds during normal monitoring, and forcibly on exit trigger, completion and normal stop. A crash can lose recently unflushed observations. Tracking does not observe offline equity peaks.
- Restart restores an armed lock or unfinished exit. If the saved basket finished offline and current position IDs are entirely different, a new basket starts.
- Every backtest resets state and ignores/will not overwrite live persistence.
- Storage/history errors are logged and block new bridge orders while leaving normal position protection running. A latched exit continues retrying. Invalid saved state is not silently overwritten.
- Tick/bar/timer/strategy and final broker-submission paths check the exit. Thresholds are observed when the cBot runs, not guaranteed server-side fill prices. Slippage/costs may change the realised result.
- The account dashboard shows WATCHING / LOCK ACTIVE / CLOSING, floating/basket profit, peak and any waiting error. Logs use `[ProfitControl]` with EXIT/CLOSED/RETRY/WAIT events.

## Build and verification — unified controls

Build `v2026.11.02 - unified-profit-lock` requires both the main `TVBridge_CTrader.cs` and `TVBridge_CTrader.ProfitControl.cs`. The focused compiled-DLL fixture is `.local/profit-lock-two-params-20261102/check/Check.csproj --profit-control`.

The 133 focused checks cover disabled defaults, percentage-only menus and saved IDs, zero-giveback boundaries, 8%/0.5% trailing examples, netting across symbols/manual positions, repeated partials and full closes, settled/unsettled history, deposits and withdrawals, mandatory daily-rule priority, real broker-entry blocking during exits, cancel/close failures and retry latches, reentrant callbacks, internal waiter cancellation, new-basket resets, persistence recovery/errors and backtest isolation. Broker calls are simulated through the actual cTrader execution wrappers; this is not a new full-period strategy backtest.

## Additional percentages (2026-11-04)

- Profit Lock adds `_25pct` and `_30pct`, ordered after `_20pct`.
- Max Total Win adds `All_15pct`, `All_25pct`, `All_35pct`, `All_45pct`,
  and `Idea_25pct`, `Idea_35pct`, `Idea_45pct`; `Idea_15pct` already exists.
- Existing numeric IDs and defaults are preserved. These Profit Lock choices
  use the existing basket-balance percentage basis; Max Total Win retains its
  original-balance basis and All/Idea scope.

## Max Total Win menu update (2026-11-05)

- Remove `Idea_30pct`, `Idea_35pct`, `Idea_40pct`, `Idea_45pct`, and `Idea_50pct` from the selection menu. Their former numeric IDs are not reassigned; a saved selection using one of those values must be reselected before new entries are allowed.
- Keep the existing `All_60pct` through `All_100pct` choices, in 5% increments. Their IDs and cumulative account-profit behavior are unchanged.
