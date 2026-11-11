# cTrader Backtest Optimisation Plan

## Objective

Find robust symbol, timeframe, session, stop-loss, buffer, and take-profit combinations for the cTrader strategy without overfitting or relying on inaccurate bar-based execution.

The final result must be reproducible, use accurate server tick data, include realistic costs, and be saved in both cTrader and 42trade formats.

## Protected reference instances

Do not change, stop, restart, or overwrite instances 1 and 2 unless the user explicitly authorises it.

Current best reference configuration reported by the user:

- Symbol: `DE40`
- Strategy timeframe: `m15`
- Stop loss: `Auto`
- SL buffer: `1.3`
- Take profit: `RR_3`
- Session: `Asia`

Before optimisation, preserve the following from each reference instance:

- Parameter `.cbotset`
- cBot source version and checksum
- cTrader JSON and HTML reports
- 42trade-format result
- Complete trade list
- Date range
- Backtest data mode
- Spread and commission settings

## Important operational rules

1. Use **Tick data from server (accurate)** for every scored run. Do not rank results produced with M1/M5 opening-price simulation.
2. cTrader snapshots parameters when a backtest starts. After changing parameters, stop and restart the backtest.
3. Change only the intended test factors. Keep all other settings identical to the current control.
4. Store successful, losing, failed, cancelled, and zero-trade runs. Omitting poor runs creates selection bias.
5. Do not select a winner from net profit alone.
6. Keep instances 1 and 2 available as untouched visual references.
7. Start with four test workers. Expand only if cTrader and the machine remain responsive.

## Parallel instance allocation

| Instance | Responsibility |
|---|---|
| 1 | Protected reference — do not alter |
| 2 | Protected reference — do not alter |
| 3 | Test worker A / baseline reproduction |
| 4 | Test worker B |
| 5 | Test worker C |
| 6 | Test worker D |
| 7–8 | Optional workers after stability check |

## Globally fixed test conditions

Unless a condition is the factor being tested, keep these fixed:

- Accurate server tick data
- Starting balance
- Commission model
- Spread model
- Risk per trade
- Adaptive Risk mode
- Maximum total risk
- Entry type
- Pending-order expiry
- Strategy version
- Date range
- cBot build/source checksum

Record all fixed conditions in every result.

## Phase 1 — reproduce the control

Use instance 3 to reproduce the protected reference configuration without modifying instances 1–2.

Do not proceed until the reproduction is reasonably consistent. If it differs, compare:

- Tick versus bar data mode
- Symbol and chart timeframe
- Strategy timeframe
- Date range
- Spread and commission
- Account/broker feed
- cBot source version
- Loaded `.cbotset`
- Session and timezone interpretation

## Phase 2 — one-factor screening

Start every test from the reproduced control and vary one factor only.

### Symbol

Fixed: `m15 · Auto · Buffer 1.3 · RR_3 · Asia`

Test initially:

- `DE40`
- `BTCUSD`
- `XAUUSD`
- `EURUSD`
- Optionally `US500` and `US100` when available

### Strategy timeframe

Fixed: `DE40 · Auto · Buffer 1.3 · RR_3 · Asia`

Test:

- `m5`
- `m15`
- `m30`
- `h1`

### Session

Fixed: `DE40 · m15 · Auto · Buffer 1.3 · RR_3`

Test:

- Asia
- London
- New York
- London–New York overlap
- All sessions

### Stop-loss mode

Fixed: `DE40 · m15 · Buffer 1.3 · RR_3 · Asia`

Test every relevant visible mode, initially:

- Auto
- Candle wick
- Protective swing
- ATR-based, if supported

### SL buffer

Fixed: `DE40 · m15 · Auto · RR_3 · Asia`

Test:

- `1.0`
- `1.15`
- `1.3`
- `1.5`
- `2.0`

### Take profit

Fixed: `DE40 · m15 · Auto · Buffer 1.3 · Asia`

Test:

- `RR_1.5`
- `RR_2`
- `RR_2.5`
- `RR_3`
- `RR_4`

Expected Phase 2 size: approximately 25–30 runs, processed four to six at a time.

## Phase 3 — rotating-anchor combinations

Retain only the two strongest robust values from each Phase 2 category.

Test combinations in rotating anchored groups:

1. Fix the best symbol; combine timeframe × session × SL × buffer × TP.
2. Fix the best timeframe; combine symbol × session × SL × buffer × TP.
3. Fix the best session; combine symbol × timeframe × SL × buffer × TP.
4. Fix the best SL configuration; combine symbol × timeframe × session × TP.

Do not exhaustively test thousands of combinations. Use a balanced or fractional-factorial subset of approximately 32–64 combinations.

### Profit Control combinations (added 2026-10-23)

Include Profit Control in future combination studies using the v173 implementation or a verified later build. Use the current reproduced setup as the anchor; the older DE40 example above is not a replacement for the active study's baseline. Let running backtests finish and log their results before reusing an instance. Do not sync/rebuild a cBot while tests are running, because package reloads can restart them.

For each selected symbol, timeframe, strategy setup and date window, start with these four representative profiles. Preserve the baseline's Max Daily Win in all four:

| Profile | Open Profit Target | Profit Lock Start | Profit Giveback |
| --- | --- | --- | --- |
| PC0 — baseline | None | None | None |
| PC1 — target | _5pct | None | None |
| PC2 — lock | None | _2pct | _1pct |
| PC3 — target and lock | _5pct | _2pct | _1pct |

These are discovery values, not recommended live settings. Treat the paired lock settings as one coherent test factor. PC1 versus PC0 isolates the target; PC2 versus PC0 isolates the lock; PC3 versus PC1 adds the lock while keeping the target fixed. Keep per-position TP, Exit Management, Trailing Method, Partial Close, risk sizing, strategy slots/logic, sessions and costs unchanged. Hold the symbol/timeframe and period fixed within this four-case comparison. Count it within the active study's approximately four representative combinations per context, not as a multiplier across every existing run. Reuse only a matching, clean baseline from the same build and effective inputs.

If a context is worth further study, screen one threshold at a time: target 2%, 5%, 10%; lock start 1%, 2%, 5% with giveback fixed at 0.5%; then giveback 0.5%, 1%, 2% with start fixed at 5%. Avoid duplicate cases. Never generate an incomplete lock pair: Start and Giveback must both be None or both enabled. Do not run a Cartesian product of these lists.

Max Daily Win remains an independent combination parameter. After selecting a promising target/lock profile, compare the inherited Max Daily Win against None, 2% and 5%, changing only that parameter and skipping duplicates. Rules Profile No bypasses Max Daily Win; under that profile, record it as inactive and skip these ineffective variants. The three new exit controls remain active under Rules Profile No. Keep mandatory drawdown/total-risk controls fixed and active for scored studies; do not switch Rules Profile merely to enable a profit cap.

Before launch, save and read back these native properties in the effective parameter snapshot:

- `MaxDailyWinPreset`
- `OpenProfitTargetPreset`
- `ProfitLockStartPreset`
- `ProfitGivebackPreset`

Include all four, plus Rules Profile, in the full Combination Key and duplicate check. Append `PC0`, `PC1`, `PC2` or `PC3` to readable run names, but retain exact values in the key so later threshold changes cannot collide. Record Focus Parameter = Profit Control Profile (or Max Daily Win for its isolated screen), Changed Value, control run ID, selected mode, authoritative symbol/timeframe, date range, build/checksum and all fixed settings.

Log normal trade evidence plus `[ProfitControl]` EXIT/CLOSED/RETRY/WAIT events, trigger reason/time, floating profit, basket realised profit, peak and thresholds wherever emitted. Open Profit Target measures current floating net profit; the lock measures realised basket profit plus remaining floating net profit. Percent thresholds use the basket-start balance, so initial $10,000 examples do not imply fixed amounts across later baskets. Keep Max Daily Win's daily stop distinct from a target/lock basket exit, after which the bot may trade again. Mark unavailable fields explicitly; do not infer missing trigger evidence from the equity curve.

Compare net profit, maximum equity drawdown, expectancy, costs, trade count and exit reasons against PC0. Validate any preferred profile on a separate untouched year/window before promotion. Add these cases to the existing hourly backtest cycle; no source rebuild is required just to change the study plan.

## Phase 4 — time robustness and walk-forward validation

Test finalists over separate periods, subject to available broker tick history:

- July–December 2025
- January–June 2026
- July–September 2026
- Full available period

Use earlier windows for discovery and keep at least one later window locked as out-of-sample validation.

Reject combinations whose profit comes primarily from one short period or one exceptional trade.

## Phase 5 — execution stress tests

For the best 5–10 combinations, test:

- Normal configured spread
- Wider spread
- Variable/random spread where supported
- Higher commission
- Adverse entry slippage
- Adverse exit slippage
- Pending-order expiry of 1, 2, and 5 strategy bars

The purpose is to eliminate configurations that only work with ideal execution.

## Run naming convention

Use deterministic names:

```text
SYMBOL_TF_SESSION_SL-BUFFER_TP_PERIOD_DATAMODE
```

Example:

```text
DE40_m15_Asia_SL-Auto_Buf1.3_RR3_2025H2_ticks
```

If needed, append the cBot build or run number.

## Required result storage

After every run, store:

- Run identifier
- Status: completed, losing, failed, cancelled, or zero-trade
- Full effective parameter snapshot
- Symbol
- Chart timeframe
- Strategy timeframe
- Session
- Start/end dates
- Tick/bar data mode
- Spread settings
- Commission settings
- Starting and final balance
- Net and gross profit
- Commission and swap
- Number of trades
- Win rate
- Profit factor
- Expectancy
- Maximum balance drawdown
- Maximum equity drawdown
- Average winner and loser
- Largest winner and loser
- Buy-only statistics
- Sell-only statistics
- Maximum consecutive losses
- Monthly/period results
- Complete trade list
- cTrader JSON report
- cTrader HTML report
- 42trade-format result
- `.cbotset`
- cBot source build and checksum

Store results in the existing 42trade backtest/history system. Do not rely only on the visible cTrader History panel.

## Initial acceptance and ranking rules

Prefer configurations satisfying all or most of these:

- Profit factor at least `1.3`
- Positive expectancy after spread and commission
- Maximum equity drawdown preferably no more than `5%`
- No single trade contributes more than `20–25%` of total profit
- Sufficient trade count across all validation windows
- Positive or acceptable results in multiple time periods
- Survives worse spread, commission, and slippage
- Buy/sell behaviour is understood; direction-specific strategies are allowed when documented
- No FTMO daily-loss or total-loss breach

Rank using multiple views:

1. Net return
2. Return divided by maximum drawdown
3. Profit factor and expectancy
4. Stability across periods
5. Stress-test degradation
6. Trade-count confidence

The final winner must be chosen from locked out-of-sample results, not the discovery period.

## Final deliverable

Prepare:

1. Ranked table of every run.
2. Best net-return configuration.
3. Best return-to-drawdown configuration.
4. Most stable configuration across periods.
5. Best configuration per symbol.
6. Best configuration per session.
7. Rejected combinations and rejection reasons.
8. Recommended demo/live configuration.
9. Exact `.cbotset`, source snapshot/checksum, cTrader reports, and 42trade result for each finalist.

## Continuation checklist for another agent

1. Read `AGENTS.md`, `agents/BOOTSTRAP.md`, and `agents/rules/ctrader.md` before acting.
2. Inspect current cTrader state; do not infer instance numbers from stale screenshots.
3. Confirm instances 1 and 2 and leave them untouched.
4. Export and store the two reference configurations if not already done.
5. Verify accurate server tick data on every worker.
6. Reproduce the reference on instance 3.
7. Create the Phase 2 job manifest before launching runs.
8. Run workers in parallel, while keeping each run independently identifiable.
9. After each completion, persist all required artifacts immediately.
10. Update a cumulative comparison table after each batch.
11. Do not promote a combination until time robustness and stress testing are complete.
12. Present the final report with the exact reproducible winning parameters.
