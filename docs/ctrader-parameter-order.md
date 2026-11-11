# Parameter dropdown order — v188

## Group layout update — 5 November 2026

The group sequence is **Trading Hours → Trade Plans → Risk Control → Profit Control → Custom Rules → Adaptive Risk with Rules**.

**Trade Plans** (formerly Trade Slots & Entries): Trade Plan 1, Trade Plan 2, Trade Plan 3, Split Entries, Entry, SL, SL Buffer and TP.

**Risk Control** (formerly Trade Risk & Exits): Base Risk, Max Manual Risk, Max Total Risk, Max Idea Risk, Orders Expiry, Exit Management, Trailing Method and Partial Close Plan.

The three protection selections belong to the trade plan. Saved property identities, selected values, defaults and enum choices are unchanged. Generated native metadata verifies all 167 parameters and the requested adjacent group order. This is a presentation change; execution logic is unchanged.

Reviewed **58 enum types used by 129 parameters**. Reordered **40 types**; the other 18 already had a suitable order. All 1,617 option names, descriptions and numeric values remain unchanged, along with every parameter default, name and group.

## Ordering policy

- Related choices stay together; named families use alphabetical order, while amounts, RR, periods and thresholds ascend numerically.
- No/None/Off, Auto and whole-menu controls stay first. Calendar days and timeframes use chronological order.
- Strategies: Off and CustomTrade first, then alphabetical families. EMA and Ichimoku directional variants stay beside their parent.
- Split Entries: Auto and single entry, then AutoEntries, EqualEntries and NearSL; protection families and counts stay together.
- Trade Plans: No, Now, Wait; within each, entry/protection family, entry offset, then ascending RR.
- Risk: None, percentages ascending, then cash ascending. Profit limits group account and idea scopes.
- SL/TP: disabled/automatic controls first, then contiguous ATR, candle, indicator, swing/structure or RR families.
- Sessions: region families, overlap/combination options, then European time blocks chronologically.
- Indicator presets: Off, Auto, then family/period order.

## Future additions

All parameter enum members now have explicit numeric values. Allocate a new unused numeric value, then insert its declaration beside its family. Never renumber existing choices for display order. cTrader EnumValues metadata preserves declaration order independently of the numeric identity used by saved selections and runtime Enum.GetValues. Verify generated native metadata and defaults after compiling.

## Reviewed dropdown types

| Type | Parameters | Choices | Order changed |
| --- | ---: | ---: | --- |
| EnableTradeMode | 1 | 4 | Already ordered |
| YesNoMode | 5 | 2 | Yes |
| StrategyMatchMode | 1 | 6 | Yes |
| BacktestStrategyMode | 5 | 42 | Yes |
| StrategyDaysPreset | 1 | 15 | Yes |
| StrategySessionsPreset | 1 | 26 | Yes |
| RiskLimitPreset | 10 | 29 | Yes |
| OrdersExpiryMode | 1 | 5 | Already ordered |
| StrategyTradeChainMode | 3 | 948 | Yes |
| StrategyOrderCountMode | 1 | 19 | Already ordered |
| StrategyEntryType | 1 | 29 | Yes |
| TotalWinPreset | 1 | 22 | Already ordered |
| StrategyStopLossMode | 1 | 50 | Yes |
| StrategyStopLossBufferMode | 1 | 14 | Already ordered |
| StrategyTakeProfitMode | 1 | 52 | Yes |
| StrategyExitMode | 1 | 7 | Yes |
| RrLadderSlStep | 1 | 20 | Already ordered |
| RrLadderClosePlan | 1 | 4 | Yes |
| AdaptiveRiskMode | 1 | 5 | Already ordered |
| StrategyTradeDirectionMode | 1 | 3 | Yes |
| AdaptiveBiasMode | 1 | 13 | Yes |
| AdaptiveWinRiskMode | 1 | 7 | Already ordered |
| RiskTemplate | 1 | 10 | Yes |
| TradeBlockScopeMode | 2 | 4 | Yes |
| NewsBlockPreset | 1 | 5 | Already ordered |
| ConfluenceApplicationScope | 1 | 3 | Yes |
| MinimumConfluenceCountMode | 1 | 10 | Already ordered |
| ConfluenceScopeMode | 32 | 8 | Yes |
| StructureEventToggleMode | 16 | 8 | Yes |
| BiasAlignmentEventScope | 1 | 8 | Already ordered |
| RejectionWickDominanceMode | 1 | 5 | Already ordered |
| VolumeSurgeMode | 1 | 5 | Already ordered |
| CandlePatternToggleMode | 5 | 8 | Yes |
| StructureEventComboMode | 1 | 4 | Yes |
| SwingVisualMode | 1 | 29 | Yes |
| ClosedTradeVisualMode | 1 | 36 | Yes |
| SmcZoneComboMode | 1 | 10 | Yes |
| ZoneLookbackPreset | 1 | 13 | Already ordered |
| MomentumTechnicalComboMode | 1 | 12 | Yes |
| CandleComboMode | 1 | 17 | Yes |
| ChartMarkerFontSizeMode | 1 | 5 | Already ordered |
| ChartMarkerSymbolMode | 1 | 2 | Already ordered |
| ChartLabelVisibilityMode | 1 | 2 | Yes |
| ChartEventsPerTypeMode | 1 | 7 | Already ordered |
| HtfMiniChartMode | 1 | 4 | Yes |
| HtfSlotMode | 2 | 7 | Yes |
| KillerZoneVisualMode | 1 | 9 | Yes |
| SplitterGridMode | 1 | 9 | Already ordered |
| EmaVisualMode | 1 | 14 | Yes |
| VwapVisualMode | 1 | 5 | Yes |
| BollingerVisualMode | 1 | 5 | Yes |
| IchimokuVisualMode | 1 | 5 | Yes |
| DonchianVisualMode | 1 | 4 | Yes |
| RsiVisualMode | 1 | 4 | Yes |
| StochasticVisualMode | 1 | 5 | Yes |
| StochRsiVisualMode | 1 | 4 | Yes |
| MacdVisualMode | 1 | 5 | Yes |
| AdxVisualMode | 1 | 4 | Yes |

## Verification

An isolated build confirmed declaration ordering in cTrader EnumValues metadata. Reflection verifies all option identities and descriptions; generated metadata verifies every parameter default and attribute. All 129 dropdown orders match the saved ordering plan. An AST audit checks that executable tokens outside parameter enums and the build version remain unchanged. Final native source checksums and the active DLL are verified after full-source sync/build.
