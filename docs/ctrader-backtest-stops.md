# Diagnosing cTrader backtest stops

## Instance 1: 19 October 2026

Instance directory: `12579d05-0970-42ef-a1b2-02e3b67c4ff1-Default`.

The XAUUSD m5 backtest stopped at `2026-01-16 13:16:40.120 UTC`, although the requested period ended on 17 October. Replaying the same v163 binary and unchanged parameter set reproduced the exact final tick and identical `events.json`, without sending a stop command.

The account risk guard rechecks existing bot positions against `MaxRiskPreset` (displayed as Base Risk), using the **current account balance**. It allows a $0.01 comparison tolerance.

| State | Balance | 0.2% cap | Cap + tolerance | Position #80 risk |
| --- | ---: | ---: | ---: | ---: |
| Before the final loss | $9,730.89 | $19.46178 | $19.47178 | $19.47: passes |
| After the final loss | $9,713.80 | $19.42760 | $19.43760 | $19.47: breaches |

Position #80 is a BUY of 1 XAUUSD unit, entry 4599.24, SL 4579.77. Its remaining entry-to-SL risk is $19.47. The last SL close reduces the balance enough to cross the cap, so `TryGetAccountRiskBreach` selects `MaxRiskPerTrade`. `EnforceAccountRiskRulesIfNeeded` requests a bot stop. This rule cancels pending orders and stops the bot; it does not close existing positions for a per-trade cap breach.

The report still has positive equity ($10,038.44), six open positions, used margin $612.55 and margin level about 1639%. The cached tick stream contains later ticks and continues to 21:56:59 UTC on the same day. Neither bankruptcy nor an exhausted cached day explains this stop.

## Missing stop-reason messages

`SafePrint` and `PrintAlways` marshal output through `BeginInvokeOnMainThread`. An immediate `Stop()` can cancel the queued log actions. Consequently a risk stop could lose its reason and leave only cTrader's generic stopped line.

Build v164 prints the stop request and `OnStop` diagnostic synchronously from the cBot lifecycle thread. The request includes the exact rule, ticket, risk, cap, preset, entry and SL. This logging correction does not change risk settings or enforcement.

Do not interpret “stopped by user” as proof of a physical click. The installed platform also has fallback paths that classify a missing stop reason as `UserRequest`; normal completion and self-stop messages can simply say “stopped.” Preserve the report, parameter set, events and complete log before reproducing.

Diagnostic artifacts and original/replayed run files are preserved under `.local/instance1-stop-20261019/`.

## Verified diagnostic replay

The v164 native replay reproduced the same event stream and unchanged parameters. Its final tick now logs:

```text
[BotStop] Requesting stop: risk_rule_breach: rule=MaxRiskPerTrade; position_id=80; symbol=XAUUSD; side=Buy; risk=19.47>19.43; preset=_0_2pct; entry=4599.24000; sl=4579.77000
```

The subsequent `OnStop` line confirms the same reason. The Release build passed with zero errors and two existing CS0649 warnings. Verified run artifacts are in `.local/instance1-stop-20261019/verified-run/`. No risk parameters or risk enforcement behavior were changed.

## Corrected enforcement in v166

The sizing recheck described above was incorrect. Base Risk and Max Manual Risk now size new orders only; neither has a policy gate or an existing-position/pending-order stop check. The removed Max Trades parameter no longer limits submissions or stops the bot. Max Daily Win, Max Idea Risk, Max Total Risk, daily loss and drawdown retain enforcement under enabled profiles. The #80 balance-change regression now passes under Custom, without selecting Rules Profile No. The historical reproduction and logs above describe the older build.

Verification of v166: Release build passed (zero errors, two existing CS0649 warnings). The active DLL passes 58 focused checks (`.local/causal-replay-check/Check.csproj --risk-sizing-only`), covering Base Risk/Max Manual Risk sizing-only behavior for existing bot/manual positions and pending orders, the #80 balance boundary, 25 positions without a count stop, removal of parameter/gate symbols, No profile behavior, and retained Max Daily Win/Max Idea Risk/Max Total Risk/daily loss/drawdown rules. Published cTrader metadata confirms Max Trades is removed and the four retained parameters remain. No native full-period backtest was run for v166.

## Close and recheck account rules (5 November 2026)

Build `v2026.11.05 - risk-close-recheck` replaces the unconditional near-limit stop with a recovery cycle shared by all entry adapters and sizing modes:

1. At an actual account-rule breach, or the existing **95%** warning threshold while positions/orders exist, block new entries.
2. Cancel internal wait entries and account pending orders, then close account positions. Failed broker actions keep the bot in recovery with entries blocked; later checks retry.
3. After flattening succeeds, wait for a later simulated/live quote time, invalidate the daily-history cache and rebuild the account state from live position/order collections.
4. Recheck **every actual (100%) account limit**, not only the original triggering rule. An actual remaining breach stops the cBot. Unavailable/invalid account or Auto sizing state also fails closed.
5. If every actual rule passes, clear the recovery flags and resume on the next quote. A flat account that is only near a limit does not repeatedly trigger an empty flatten cycle.

The rule references and percentages are unchanged: daily profit/loss, equity drawdown, Custom balance drawdown, aggregate open risk, per-idea risk, protective-stop/symbol checks and Auto's selected risk budget retain their existing predicates. Rules Profile `No` skips configurable rule enforcement. Base Risk and Max Manual Risk remain sizing controls, not existing-position stop gates. A terminal `Max Total Win = All_*` completion remains terminal, including when it occurs during a recovery close.

Closing positions realizes floating P&L; it does not erase an equity loss or reset initial, daily or drawdown anchors. Closing costs or slippage may leave an actual loss/drawdown rule breached. Existing account-wide close scope is retained, including manual/other-bot account exposure. This change does not establish that an external prop firm will disregard a limit crossed before liquidation.

Audit messages distinguish `[RiskRules][NEAR_LIMIT]`/`[BREACH]`, `[RECHECK_WAIT]`, `[RECOVERED]`, `[STILL_BREACHED]` and `[CHECK_FAILED]`. A stop request is logged only once a terminal stop is selected; recovery has a separate reason. Synchronous broker results and remaining collections are checked before proceeding ([cTrader ClosePosition API](https://help.ctrader.com/ctrader-algo/references/General/Robot/ClosePosition/)).

Verification artifacts: `.local/risk-close-recheck-20261105/`. Release compilation passed with zero errors and two existing CS0649 warnings. The four production lifecycle methods, extracted unchanged into a fake broker/account adapter, passed 176 assertions covering recovery, persistent and different-rule breaches, closing costs, pending-only exposure, failed/throwing broker actions, fresh-state waits, reentrant callbacks, terminal profit-target precedence, Rules Profile `No` and Auto `None` budget. Reflection checks against the compiled native DLL passed the existing seven-sizing-mode rule/95% threshold and `None` budget regressions. This is functional lifecycle verification, not a full-period market-performance backtest.
