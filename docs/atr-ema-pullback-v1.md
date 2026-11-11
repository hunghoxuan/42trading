# ATR EMA Pullback V1

cTrader selector: **AtrEmaPullbackV1**. Native detector: `src/mt5-bridge/clients/TVBridge_CTrader.AtrEmaPullback.cs`. Strategy definition: `src/config/strategies/atr_ema_pullback_v1.json`.

## Signal rules

XAUUSD M5 only; broker suffixes are accepted. Periods and thresholds are read from the strategy JSON, with these defaults:

1. BUY: EMA20 > EMA50 > EMA200; confirmation close above EMA200. SELL mirrors the comparisons.
2. Within the previous five completed bars, price approached from the trend side and touched the EMA20–EMA50 band while trend ordering remained intact.
3. The first later bullish close above EMA20 confirms a BUY; SELL requires a bearish close below EMA20. The touch candle is not its own confirmation.
4. ATR14 must exceed its 50-bar simple average. Confirmation full range must not exceed 2 ATR.

EMA and ATR use the shared bounded caches without depending on CustomTrade display/detector switches. ATR is the existing native simple mean of true range, not Wilder smoothing. Only completed decision-time data is eligible.

## Shared Trade Config — v177 onward

The ATR detector produces a qualified signal. It uses the ordinary tvbridge execution, chart planning and management path. It has **no dedicated fixed-risk or fixed-exit adapter**.

The selected cTrader parameters control:

- Trade Plan slots, Entry, Split Entries and configured direction.
- SL, SL Buffer and TP/RR, including TP No or trail-only behavior supported by the shared engine. Invalid/missing protective SL still rejects creation.
- Base Risk, adaptive risk/direction, margin and account risk checks.
- Exit Management, Trailing Method and Partial Close Plan, with their ordinary shared semantics. Exit Management Off does not run the former 1R partial exit.
- Trading days/hours, shared news protection, account/prop rules and Profit Control.

There is no hidden 0.25% risk, fixed ATR/swing SL, forced 2R target, 50%-at-1R partial, three-loss daily stop, mandatory dated-calendar filter or single-order override. The confirmation candle's close/wick and a provisional 1R target merely seed a valid internal signal; the shared resolver replaces them according to Trade Config before charting or submission. Selecting market Entry therefore permits market execution rather than imposing the old breakout stop.

Strategy-owned confluences remain explicitly disabled: the EMA/ATR detector supplies its own signal qualification independently of CustomTrade filters. Future explicit strategy setting overrides follow the existing catalog precedence; the shipped ATR config supplies no order, sizing, scheduling or exit overrides.

## Configurable signal parameters

| Parameter | Default |
| --- | --- |
| `fast_period`, `mid_period`, `slow_period` | 20, 50, 200 |
| `atr_period`, `atr_mean_period`, `atr_relative_min` | 14, 50, 1.0 |
| `pullback_bars`, `max_candle_atr` | 5, 2.0 |

## Evidence and verification

A durable JSONL audit under `<BaseServerPath>/backtest-evidence/atr_ema_pullback_v1/` stores accepted first and split legs, indicator/pullback context, confirmation OHLC/tick volume, planned prices, risk, volume and effective Trade Config. Native position/order events and history supply fills, partials and completed net outcomes. This audit is independent of native text-log trimming.

V177 checks cover shared SL/TP changes, market Entry, inherited split/exit/direction/trailing/partial selections, symmetric signals, full versus truncated/mutated-future replay, and durable journal writes. Shared strategy-data and FTMO projected-stop contracts pass. The active native deployment is the original **tvbridge** cBot, including the ATR partial and its `AtrEmaPullbackV1` selector. The separate `_Study` cBots and their runner were retired on 26 October 2026; their source packages and historical evidence are archived for recovery.

The shared-config win-rate study lives under `.local/atr-ema-improve-20261025/`. Legacy results below use a different execution policy and must not serve as a like-for-like baseline for v177. The fixed-exit ATR13 experiment was aborted when the user requested shared config; its partial evidence is retained and is not a completed result.

## V177 shared-config comparison — preliminary

January 2025 native smoke tests use identical settings except the visible TP selection: market Entry, Auto SL with 0.1SL buffer, Base Risk 0.1%, Risk Sizing Off, one entry and Exit Management Off. XAUUSD M5, accurate server ticks, $10,000 capital, 1:30 leverage and $30 commission per million USD volume. Custom DD10/total10/idea5; News Pause No; all Profit Control None.

| Config TP | Net completed win rate | Completed | Realised net | Equity DD | Profit factor |
| --- | ---: | ---: | ---: | ---: | ---: |
| RR2 | 41.32% | 121 | +$176.51 | 1.70% | 1.27 |
| RR1 | 56.20% | 121 | +$66.70 | 1.04% | 1.14 |

All 121 entry signals match: 18 baseline losses become candidate wins; no baseline win becomes a candidate loss. RR1 raises win rate by 14.88 percentage points but earns $109.81 less. This is an execution smoke test, not a strategy promotion or an annual result. Both have complete entry evidence and zero protection/config audit violations. Turning chart visuals off reproduces every January RR1 trade exactly.

The later RR1 run reached the end of 2025 with 873 completed positions, 47.77% win rate, −$677.17 realised net, 8.04% equity DD and 0.82 profit factor. Its final log retains an `unhandled_InvalidOperationException` flag; this run is descriptive evidence requiring runtime review, not a promotion result. The RR2 annual comparison was interrupted by the user's profile change. Both are preserved under `.local/atr-ema-improve-20261025/`. The study validates native parameter snapshots against each run's durable entry journal. Saved trading profiles differ only in TP and the isolated evidence path; no experimental setting is made a hardcoded strategy default.

## Direct tvbridge signal-filter screen — 26 October 2026

All six native source files match the repository; the original tvbridge project compiles with no errors. Two existing stopped tvbridge instances run the same shared order configuration above with RR2. The experimental strategy JSON changes only `params.atr_relative_min` from 1.0 to 1.3. Each has a separate runtime/evidence path. All 165 native parameters match its saved profile, and every closed position has durable entry context and native protection/outcome evidence.

| ATR / recent ATR mean minimum | January 2025 completed | Wins / losses | Win rate | Realised net | Equity DD | Profit factor |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| 1.0 baseline | 121 | 50 / 71 | 41.32% | +$176.51 | 1.70% | 1.27 |
| 1.3 candidate | 49 | 26 / 23 | 53.06% | +$237.78 | 0.68% | 2.16 |

All 49 candidate signals also appear in the baseline, with identical planned entry, SL and TP prices. The 72 excluded baseline trades include 24 winners and together lose $54.30. Two shared signals have different rounded position volumes because the same percentage risk follows different account balances.

Both profiles have completed full 2025 directly in tvbridge:

| ATR minimum | Closed | Wins / losses | Win rate | Realised net | Equity DD | Profit factor |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| 1.0 baseline | 878 | 279 / 599 | 31.78% | −$790.88 | 11.21% | 0.84 |
| 1.3 candidate | 313 | 114 / 199 | 36.42% | +$82.34 | 3.55% | 1.05 |

The observed gain is 4.64 percentage points in win rate and $873.22 in realised net, with 7.66 percentage points less reported drawdown. Both runs have no open positions, missing entry records, audit violations or runtime exception flags. Extending the native backtest end from January to December exactly preserves all 121 baseline and 49 candidate January signals, planned prices, risk, sizes, fills and completed outcomes. The full-year entry comparison finds 308 common signals with identical planned prices/execution settings, 28 differences in rounded volume, five extra candidate executions and 570 excluded baseline trades worth −$910.15 on the baseline account.

January's 53.06% candidate win rate does not persist across the full year: its other 264 closed trades win 33.33% and lose $155.44 combined. The annual edge is small and does not meet the study's five-percentage-point win-rate promotion threshold.

The 2023 baseline stopped at the configured 10% reference-equity loss rule on **2 May 2023**: 436 closed positions, 25.92% win rate, −$1,000.85 realised net, 10.88% peak-equity DD and 0.64 profit factor. All entries and protection pass the audit, with no runtime exception flag. This is a partial annual window caused by the mandatory account rule, not a completed full-year result. The rule measures loss from $10,000 reference capital; the report's peak-equity drawdown uses a different reference.

The frozen 1.3 candidate completed 2023: **693 closed positions, 236 wins / 457 losses, 34.05% win rate, −$252.19 realised net, 6.87% equity DD and 0.94 profit factor**. It has no open positions, missing entry records, audit violations or runtime exception flags. The baseline stopped on 2 May, so raw differences between these runs describe unequal realised windows and do not establish a matched full-year improvement.

Testing and migration are complete. The candidate improves observed 2025 outcomes and survives the 2023 year, but loses money on the independent confirmation and misses the predeclared five-percentage-point 2025 win-rate gate. It is **not promoted**; the repository default remains 1.0. The 1.3 JSON and complete saved native profiles remain available as experimental configurations.

Full-year 2025 results are archived from tvbridge instances 2 and 3, and frozen 2023 results from instances 5 and 6. All 165 native parameters match the saved profiles. Existing completed native reports were backed up before replacement. Native reports, complete entry patterns, saved profiles, strategy JSON and the final decision are in `.local/atr-tvbridge-20261026/`. UI-launched and plugin-launched performance are kept separate because a prior plugin trial reproduced fills but used different commission rounding.

## Legacy v176 fixed-exit results — 25 October 2026

XAUUSD M5, accurate server ticks, Silent mode, $10,000 initial balance, 1:30 leverage, commission $30 per million USD volume, 0.25% strategy risk. Profit Control is disabled. Custom account controls retain a 10% initial-capital loss limit, 10% total risk and 5% idea risk. **News filtering was disabled only in the isolated research copy.**

| Test | Realised return | Maximum equity DD | Profit factor | Positions | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| January 2025 smoke, v175 | +0.62% | 1.39% | 1.08 | 58 | Complete |
| 2024 validation, v175 | −10.02% | 11.40% | 0.72 | 194 | Account loss rule stopped it on 9 May |
| Full 2025, v176 | −7.94% | 10.53% | 0.89 | 532 | Complete; one runner open at year end |

The v176 full-year rerun exactly reproduces v175 performance while preserving all entry evidence. All 532 positions have entry context; all 215 partial exits retain the original SL/TP. Checks found no submitted-price, protection, trend/ATR or daily-loss-stop violations. In 2024 all 194 positions have entry evidence, with 68 verified partial exits.

The account loss rule measures equity against initial capital; the report's equity drawdown measures a decline from a prior peak. They therefore need not show the same percentage. Native fills can also cross attached SL/TP levels on price jumps, so nominal planned risk is not a guaranteed maximum realised loss.

The core v1 failed to establish a profitable baseline. These tests do not validate the news filter. Full settings, individual entry patterns, strongest winners and comparable losses, native reports, checksums and the audit journal are preserved in `.local/atr-ema-study-20261025/`; see `research-report.md` and `manifest.json` there. No parameters were optimised against these results.
