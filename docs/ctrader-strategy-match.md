# Strategy Logic

`Strategies → Strategy Logic` appears immediately before `Strategy` and applies to the five selected strategy slots.

| Value | Timing | Directions | Trade side |
| --- | --- | --- | --- |
| `OR` (default) | Independent signals | Independent | Each qualifying signal |
| `AND` | Same completed candle | Must match | Matching direction |
| `SEQUENCE_SAME_SIDE` | Slot order, within 10 bars | Must match | Last selected strategy |
| `SEQUENCE_ANY_SIDE` | Slot order, within 10 bars | May match or differ | Last selected strategy's fresh signal |
| `SEQUENCE_REVERSE` | Strictly increasing bars in slot order, within 10 bars | Each next slot is opposite the previous slot | Last selected strategy's fresh signal |
| `WINDOW_SAME_SIDE` | Any order, within 10 bars | Must match | Fresh completion signal |
| `WINDOW_ANY_SIDE` | Any order, within 10 bars | May match or differ | Fresh completion signal |
| `WINDOW_REVERSE` | Any selected strategy can complete after the others, within 10 bars | Every prerequisite is opposite the fresh completion signal | Fresh completion signal |

ANY_SIDE does not force reversal. An earlier BUY followed by a fresh SELL qualifies as SELL; an earlier SELL followed by a fresh BUY qualifies as BUY. Same-direction signals also qualify. The completion strategy keeps its normal entry, SL/TP, risk and exit settings, subject to existing downstream direction/risk controls. Earlier strategies are prerequisites and do not submit orders themselves for that match.

Off slots are ignored. AND/WINDOW count repeated selections once; SEQUENCE preserves slot order and repeated slots. With one selected strategy, the modes behave like OR. All operands must be on the same symbol and source timeframe. Each operand is evaluated with its own settings, data requirements, confluences, time and volume gates, in its own detected direction. ANY_SIDE loosens only the requirement that prerequisite directions equal the completion direction.

For SEQUENCE, A time must be before or equal to B time. The entire first-to-last span fits within 10 bars (10 passes, 11 fails), rather than 10 bars per link. Only the last selected strategy's fresh signal triggers a trade. Matching searches backward for the most recent eligible prerequisite at or before each successive slot.

WINDOW accepts either chronological order, anchored by a fresh selected signal on the current completed candle. Each other strategy independently searches that candle and the preceding 10 bars. Historical evidence alone cannot trigger on unrelated later bars. A later fresh signal can complete another window while prerequisites remain recent, subject to normal trade deduplication.

In WINDOW_ANY_SIDE, simultaneous signals have no intrabar ordering in closed-bar data. The later selected slot wins the tie, preventing opposite trades from the same completion candle. Reordering the slots changes this same-bar tie-break. WINDOW_SAME_SIDE retains its prior behavior.

REVERSE modes require the prerequisite signals to occur on earlier completed bars; opposite signals on the same bar have no known order. SEQUENCE_REVERSE alternates sides across all selected slots (for example BUY → SELL → BUY). WINDOW_REVERSE accepts any completion slot, and each other selected strategy must have an opposite-side signal on one of the preceding 10 bars. When multiple strategies complete the reverse window on the same bar, the later configured slot wins the tie. The completion signal supplies the trade side and keeps its own entry, SL/TP, risk and exit settings.

Manual orders and OR/AND behavior remain unchanged. Live/backtest execution and reconstructed trade markers share matching logic. Every historical operand is replayed at its own candle close; future data or later confirmation cannot supply missing evidence. Same-side and any-side cache entries include the requested direction or its absence, plus configuration/feed/bar identity.

## Saved values and rename

`SEQUENCE` is renamed `SEQUENCE_SAME_SIDE` at numeric value 2; `WINDOW` is renamed `WINDOW_SAME_SIDE` at value 3. OR=0 and AND=1 are unchanged. ANY_SIDE modes use 4 and 5; REVERSE modes use 6 and 7. Numeric saved selections preserve their behavior. Text parameter sets containing the old names may require selecting the renamed equivalent when loaded by cTrader. Existing running instance selections are not changed manually.

## v186 verification

Native build and parameter metadata are checked after full-source sync. `.local/strategy-any-side-20261027/check/Check.csproj` exercises real ROC/CustomTrade conflicting signals in both directions, same-side acceptance, 1/5/10/11-bar spans, order rules, current-side validation, missing operands, simultaneous tie-breaks, live/backtest/chart parity and future mutation. The previous same-side SEQUENCE and WINDOW regression suites are retained with the renamed enum labels.

## v189 reverse-side verification

The full repo source was synced to the active cTrader compile file and built in Release with zero errors and two pre-existing CS0649 warnings. Published `.algo` metadata includes `SEQUENCE_REVERSE=6` and `WINDOW_REVERSE=7`. The `.local/strategy-reverse-20261028/check/Check.csproj` harness passed 107 reverse checks using real ROC/CustomTrade opposite signals in both directions, same-bar and 10/11-bar boundaries, slot ordering, same-side rejection, chart/execution parity, live/backtest state and future mutation. Existing suites also passed: sequence 51, window 54 and ANY_SIDE 173 checks. A full-period native backtest was not run.

The subsequent cTrader IDE build of the existing lowercase `tvbridge` source project succeeded with the same two warnings. Its Strategy Logic dropdown on a stopped XAUUSD/m5 instance visibly lists both reverse modes. The running backtest retained its earlier parameter view. During the IDE build, cTrader also warned that cloud synchronisation was disabled because it detected duplicated file names; that warning is separate from compilation and the local parameter menu.

## Earlier verification history

Build `v2026.10.21 - strategy-window-v171` is fully synced to the active cTrader source and compiles with zero errors and two existing CS0649 warnings. The internal property remains `SelectedStrategyMatch`; saved OR=0, AND=1 and SEQUENCE=2 retain their meanings, and WINDOW=3 is appended. Published `.algo` metadata confirms the label Strategy Logic, all four options, default OR and placement immediately before Strategy. WINDOW has a separate dispatch/method; existing mode branches are unchanged.

The active Release DLL passed 54 checks in `.local/causal-replay-check/Check.csproj --strategy-window`: real ROC/CustomTrade triggers, either slot order, 0/1/5/10/11-bar gaps, fresh completion requirements, missing/opposing evidence, chart/execution/live/backtest parity, routing isolation and causal future mutation. Existing suites passed 40 checks in `--strategy-match`, 51 in `--strategy-sequence`, and 149 in `--groups` (294 total).

`--logic-snapshot` compared the previous v170 DLL with v171 across 30 OR/AND/SEQUENCE fixture cases, including 16 nonempty signals and 16 trade plans. Both produced identical snapshots of decisions, rejection reasons, signal fields, entry/SL/TP and split-entry fields: SHA256 `179F4965B0DD315460F447671D0A1130F9ADA8FE72B960BB4CC1A1819A9D8FCD`. Baseline artifacts are in `.local/strategy-window-20261021/`. This comparison covers those fixtures, not every market history. A full-period native backtest was not run. Existing instance settings and running sessions are not changed.
