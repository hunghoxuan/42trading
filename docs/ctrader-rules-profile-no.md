# Rules Profile: No

Select `Custom Rules → Rules Profile → No` to disable the cBot's account/profile rule enforcement.

Disabled rules:

- Mandatory account-risk stops. Base Risk and Max Manual Risk are sizing inputs and no longer have policy gates under any profile.
- Max Total Risk and Max Idea Risk enforcement. Max Trades and all its gates have been removed under every profile.
- Max Daily Loss, Max Daily Win and balance/equity drawdown enforcement.
- FTMO reference/floor and projected-stop rules.
- News Pause, Overnight Rule, Weekend Rule and market-close restrictions/forced liquidation, for both cBot and manual scope.

No ignores these rule settings even if a strategy overrides an overnight/weekend/news value. The dashboard displays `Rules disabled; risk sizing active`.

Trade construction still uses Base Risk and the selected Risk Sizing algorithm to calculate volume. Adaptive modes retain their pool/allocation calculations; Adaptive Reference DD and Adaptive Peak Equity DD use the configured Custom drawdown limit as a sizing input. The peak mode applies percentage limits to observed peak equity; reference mode keeps the previous initial/profile reference. Both are described in [Drawdown risk sizing](./ctrader-drawdown-sizing.md). No skips the extra daily/drawdown rule reservation of adaptive capacity. Order-size fitting to the requested risk budget remains part of sizing.

Strategy signals, Trading Days/Trading Hours, entry/exit management, required valid SL, broker volume/price constraints and free-margin affordability checks remain active. No does not force a signal, disable SL, or force a broker to accept an invalid order.

## Compatibility and verification

- `No = 9` is appended to `RiskTemplate`; all existing profile ordinals and the default `Custom` remain unchanged.
- The internal parameter remains `SelectedRiskTemplate`.
- Build v165 is synced to the active cTrader source and compiles with zero errors and two existing CS0649 warnings.
- Published `.algo` metadata includes No and retains Custom as the default.
- The active Release DLL passes 46 focused checks using `.local/causal-replay-check/Check.csproj --no-rules`: profile compatibility, risk/day/news/hold gates, no forced market-close action, required SL, and the reproduced instance-1 position #80 boundary. That boundary still breaches under Custom and passes under No. FTMO profiles still require their references.
- No full-period native market backtest was run for this option. Existing instance settings were not changed; restart and select No explicitly to use it.

## Sizing-control correction (v166)

Base Risk and Max Manual Risk remain order-size inputs. They no longer reject policy evaluation or stop the instance when current balance changes after a trade was opened. Max Trades and the `MaxPositionsTotal` property are removed, including strategy, split-leg, creation and broker-submit count gates. Adaptive pooled allocation retains an internal divisor of 20; this is not an exposure-count limit. Mandatory total/idea/day/drawdown enforcement remains active for enabled profiles. Max Daily Win is retained as requested.
