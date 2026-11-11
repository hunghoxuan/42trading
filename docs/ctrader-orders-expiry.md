# Orders Expiry (v182)

`Trade Config → Orders Expiry` applies to pending limit and stop orders submitted by tvbridge, including all split-entry modes, chart orders and bridge requests. Market positions are unaffected. Default: **5 bars**.

| Option | Deadline |
| --- | --- |
| No | No automatic pending-order deadline |
| 5 bars | Submission time + 5 source-timeframe periods |
| 10 bars | Submission time + 10 source-timeframe periods |
| EndOfDay | Next midnight UTC |
| EndOfWeek | End of Friday UTC, Saturday 00:00; weekend submissions rejected |

For example, M5 five-bar expiry is 25 elapsed minutes from submission. Market closures count toward elapsed time. Source timeframe comes from the explicit request, then its entry-event comment; chart orders fall back to the visible chart timeframe, and bridge requests without timeframe metadata use the instance timeframe. Unsupported non-time frames fail closed for bar expiry.

The deadline is attached at broker submission and uses the simulated server clock in backtests. It remains effective when strategy entry gates block new trades or the bot disconnects. Broker order replacements and SL/TP updates retain the original deadline. An earlier explicitly supplied deadline is retained. `No` does not erase an existing broker deadline. Unfilled orders expire; filled positions keep their SL/TP and exit management.

Strategy-specific settings may override `OrdersExpiry` through `settings.parameters` or `settings.trade_config.orders_expiry`; omitted settings inherit the shared parameter. Internal Wait-confirm setup expiry remains separate.

The strategy cleanup fallback covers older orders without broker deadlines using the current effective expiry setting and cTrader's `SubmittedTime`. It cancels at `now >= deadline` and retries failed cancellations on subsequent strategy scans. Other symbols, source timeframes and unmanaged orders are isolated.

## Cause of the old failure

The old cleanup searched `CreatedTime`, `CreationTime`, `OpenTime`, and `Time`, but cTrader exposes `SubmittedTime`. Missing timestamps silently skipped cancellation. The comparison also allowed five bars and cancelled only after more than five. Most pending orders had no broker expiration; only Auto split retests set one.

## Suggested starting point

Use 5 bars for M5 scalp setups, 10 bars for slower pullbacks, and EndOfDay for intraday setups. EndOfWeek permits longer-lived setups; the separate market-close protection remains applicable. No is for deliberately persistent orders. These are starting settings to compare in backtests, not a claim of improved returns.
