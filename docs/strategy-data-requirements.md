# Strategy data and setting precedence

Predefined cTrader strategies declare their required analysis inputs in their own file under `src/config/strategies/`.

The engine resolves each strategy independently:

1. `required_data.parameters` prepares its detector and technical indicator inputs, even when the corresponding shared detector or chart overlay is off.
2. Explicit `settings.parameters`, `settings.confluences` and `settings.trade_config` values override shared settings for this strategy.
3. An omitted setting uses the instance's shared value. CustomTrade continues to use the shared parameters directly.

Account-wide risk caps remain authoritative. A strategy cannot loosen them through this configuration.

For example, RejectTrendline requires trendline rejection and a directional candle pattern. Its data contract enables Trendline, Rejection and the candle families inside its evaluation context. Turning off the corresponding shared parameters does not remove these required inputs. Its opposite-structure exit also declares the structure inputs it needs.

```json
{
  "required_data": {
    "parameters": {
      "ConfluenceTrendline": "LTF",
      "DrawTrendlines": true,
      "DrawRejectionDetections": "LTF",
      "DrawPinBarPatterns": "LTF",
      "SwingVisuals": "LTF_9",
      "ZoneLookback": "Bars1000"
    }
  },
  "settings": {
    "trade_config": { "tp": "RR_3", "n_trades": "_2" },
    "confluences": { "bar_direction": true }
  }
}
```

`required_data.parameters` and `settings.parameters` use the C# parameter property names and enum members. Unknown names or invalid values are rejected. Supported inputs cover analysis, order and session parameters; credentials, strategy-slot selection and account risk caps are excluded. An explicit setting must be compatible with the strategy's required data.

`params` contains the strategy's numeric rule inputs. Native SMA, triple EMA, ROC and Donchian strategies read their declared periods from it. Native EMA, RSI, Bollinger, Stochastic, MACD and Ichimoku use their declared technical presets. File rules read their numeric inputs through `params.*`.

The existing `indicators` array declares additional rule values. It supports EMA, SMA, RSI, ROC, ATR, VWAP, MACD, Bollinger, Stochastic and rolling high/low. Indicator IDs name rule values; they do not create separate market feeds. Periods may reference `params` through a `var` expression.

Signal detection, historical chart replay, entry/protection planning, execution and automatic exits use the same strategy context. The context is restored when an operation finishes, including after an exception, so one strategy cannot change another slot's settings or the saved instance parameters.

Bars come from the shared causal market feeds. Indicator values are cached by the underlying feed, completed bar and calculation inputs, with no strategy ID in the calculation key. Matching data is reused; a different period produces a separate result. Structure and trendline geometry similarly reuse results for matching calculation inputs and decision cutoffs. No future candle data is available to an earlier decision.

Strategy files are loaded into the running bot's catalog at startup. Source changes require compilation and a restarted instance before they affect execution.

## Hidden execution defaults

Trade settings use short display names under Trading Hours, Trade Config, Trade Slots & Entries, Protection & Exits, and Adaptive Risk & Direction. Custom Rules contains Rules Profile, FTMO reference values, daily loss, drawdown, overnight/weekend restrictions and News Pause. Trade Config contains Max Daily Win, Base Risk, Max Manual Risk, Max Total Risk, Max Idea Risk and Max Trades. Base Risk sits beside Max Manual Risk. Custom Rules uses Max Daily Loss and Max Drawdown; the sync batch control is named Max Bars Per Post. C# property identifiers and saved enum values are retained. Five advanced controls are hidden from the cTrader parameter panel and use these code defaults:

| Property | Default |
| --- | --- |
| `AutoRetestDistanceAtr` | `1.0` ATR |
| `WaitConfirmMaxBars` | `5` bars |
| `MarketCloseProtectionMinutes` | `15` minutes |
| `BreakEvenOffsetPips` | `0` pips |
| `SelectedAdaptiveBiasReduceScope` | `MatchingSLDirection` |

A predefined strategy can override these through `settings.parameters`; absent values use the code defaults. CustomTrade uses those defaults. SL reversal is separately fixed to `Net_Loss_Only` and cannot be overridden. Partial Close Plan remains visible.

## Trailing methods

`Trailing Method` replaces `Trail Step (R)` in Protection & Exits. It offers exactly 20 choices:

- `Trail_Step_1R` through `Trail_Step_10R`: move SL to entry at +1R, then advance in the selected increments. `Trail_Step_5R` promotes at +1R → entry, +6R → +5R, +11R → +10R.
- `Trail_Distance_1R` through `Trail_Distance_10R`: activate at the selected profit distance, then follow price that many R behind. `Trail_Distance_5R` promotes at +5R → entry, +6R → +1R, +7R → +2R. It also follows fractional progress, e.g. +5.5R → +0.5R.

Both methods apply to Trailing Stop, Trailing Stop with reversal, and RR Ladder. SL only becomes more protective, including when the broker returns stale SL snapshots. Rejected changes remain retryable. RR Ladder partial-close milestones are independent of the trailing method; partial-close plans are unused for plain Trailing Stop. A strategy may still override `SelectedRrLadderSlStep` through `settings.parameters`; the internal property name is retained.

New instances default to `Trail_Step_1R`. Whole-R step numeric values retain their previous ordinals. Legacy numeric selections (0.5R–20R) and legacy strategy JSON names such as `_0_5R` preserve their original step behavior internally, although those old choices are absent from the new dropdown. Native cTrader saved sets containing old textual names may require reselection after rebuilding. Select `Trail_Distance_5R` explicitly for the new 5R-distance behavior.

The distance calculation uses the original entry-to-SL risk for the position. `BreakEvenOffsetPips` remains zero by default; a strategy-specific nonzero offset shifts the resulting stop by that offset. Broker minimum distances and price normalization still apply. Running instances must restart to load the rebuilt cBot.

The active Release DLL passes 772 focused trailing checks covering all 20 choices, BUY/SELL activation and fractional progress, RR Ladder partials, legacy selections, plus actual position-adapter duplicate suppression, retracements and failure retries. Published `.algo` metadata confirms the parameter label and all 20 choices.

## Verification

The earlier four-group layout passed 22 UI/default/strategy-override checks. The 2026-10-19 regrouping build passes; published `.algo` metadata confirms the exact Custom Rules, Trade Config and Risk & Trading Hours membership/order. Parameter identifiers, defaults and runtime implementations are unchanged by the regrouping.

The offline Release build passes. `.local/strategy-data-check/Check.csproj --strategy-data` checks requirement loading, disabled shared detectors, actual RejectTrendline and chart signals, CustomTrade isolation, setting precedence, indicator reuse, native strategy independence and future/truncated-prefix replay (149 checks). The existing structural split suite passes 10 checks. The JSON schema accepts all 22 native contracts and all 35 required-data declarations.

The older `--groups` harness fails its retired bias-only/EMA expectation on both the pre-change baseline and the updated source. The older `--native` chart harness lacks a broker Positions service in its fake API; the focused suite checks native signal independence without submitting orders. A complete market backtest has not been run for this change.
