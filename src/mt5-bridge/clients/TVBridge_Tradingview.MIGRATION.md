# TVBridge TradingView Migration Matrix

Source: `TVBridge_CTrader.cs`.

Scope: migrate chart-compatible analysis, state, scoring, strategy signal calculation, and visuals to `TVBridge_Tradingview.pine`. Exclude broker execution, position/account management, server sync, and local persistence.

| Area | cTrader source | Pine status | Acceptance |
| --- | --- | --- | --- |
| Shared candle utilities | `Open` through `BodyRatio` | partial | Same values and thresholds on the same completed bar. |
| Candle patterns | `BuildEnabledCandlePatternDefinitions`, `DetectCandlePatterns`, `DetectThreeCandlePatterns` | partial | Same enabled pattern, direction, span, reversal wick, confluence, and follow-up result. |
| Pattern confirmation/reversal | `TryResolveCandlePatternVisualFollowUp`, `HasDirectionalReversalWick` | ported; runtime validation pending | Same `.c` / `.r` result on the next completed bars. |
| Canonical structure | `DetectStructures`, `BuildCanonicalMarketEvent` | partial | Per-event `No` / `Yes` / `Yes_c` / `Yes_r`, BOS/CHOCH separation, strict rejection core, and follow-up markers are ported. Full candidate-level breakout, pullback, continuation, and volume qualification remain. |
| Swings and bias | `DetectSwings`, `DetectStructureBiasScore`, `BuildStructureSnapshotV2` | partial | Same pivot confirmation, bias, and score. |
| FVG | `DetectZones`, `IsQualifiedFvg`, `ResolveZoneLifecycle` | ported core; runtime validation pending | Same qualified bounds, state, revisit, invalidation endpoint, and iFVG creation. Historical reconstruction remains pending. |
| Order blocks and breakers | `DetectZones`, `FindOppositeCandle`, `ResolveZoneLifecycle` | ported core; runtime validation pending | Same structure-confirmed origin, bounds, touch, invalidation, and breaker creation. Origin de-duplication and historical reconstruction remain pending. |
| Supply, demand, liquidity | `AddClusterZones`, `DrawLiquidityLevelsOnChart` | partial | Confirmed-swing BSL/SSL, EQH/EQL guides, pivot S/D, and h4/d1/w1 liquidity projection are present. The full cTrader cluster-tolerance detector and cross-TF artifact inventory remain. |
| Key levels | `DetectKeyLevels`, `DrawKeyLevelsOnChart` | partial | Confirmed swing, completed session, and previous h1/h4/d1/w1 levels now respect the higher-source-TF projection rule. Historical range/SR reconstruction remains. |
| Scored price zones | `DetectScoredPriceZones`, `DrawScoredPriceZones` | ported core; runtime validation pending | Same ATR-scaled bins, close/touch/rejection/swing scores, non-adjacent ranking, role flip, and nearest two zones per side. cTrader cache and cross-TF scoring are excluded/pending. |
| Confluence | `ShouldKeepCandlePatternInline`, `IsCandleNear*Confluence` | partial | One best active zone/key candidate is selected for near/touch, now including scored Demand and Supply candidates. Full cTrader cross-TF artifact scoring remains pending. |
| Technical overlays | `DrawIndicatorOverlaysOnChart`, `RenderIchimokuOverlay` | partial | Same EMA, VWAP, BB, RSI, Stoch, MACD, Ichimoku appearance. |
| Technical events | `BuildIndicatorEventDefinitions`, `BuildIndicatorEventSnapshot` | partial | Same crossings, position events, and event names. |
| Divergence | `DrawDivergenceOnChart` | partial | Same confirmed pivot pairs and direction. |
| Trendlines | `DrawTrendlinesOnChart`, `IsSwingTrendlineStillValid` | partial | Same candidate scoring, touches, validation, and endpoints. |
| Killer zones | `DrawConfiguredKillerZones`, `DrawSessionContextBox` | partial | Asia/London/New York sessions use their own DST-aware local timezone; KZ is the first three local hours and full-session mode is selectable. Historical range boxes, dotted boundaries, labels, and weekend context remain. |
| HTF visuals | `DrawHtfMiniCharts`, `DrawHigherTimeframeZonesOnChart`, background methods | partial | Confirmed HTF data, zones, and mini strips use four-bar slots, borderless translucent bodies, centered wicks, shared baseline labels, and a dotted divider. Event overlays and source chart-time anchoring remain. |
| Chart labels and frames | `BuildChartEventDisplayLabel`, pattern marker renderers | partial | Same compact TF naming, direction neutrality, labels, boxes, and object limits. |
| Visual strategy | `EvaluateSharedConfigDefinition`, confluence score methods, visual strategy methods | partial | Same trigger/rule outcome, direction, score, entry/SL/TP plan, and alert. |
| Chart trade plan | `BuildChartLimitPlanV2`, split-entry methods | missing | Same non-executing entry, SL, TP, RR, and split-leg drawings. |
| Dashboard | dashboard builders and chart panel methods | partial | Same chart-compatible current-TF/HTF/event/score display. |
| Object lifecycle/performance | visual overlay state keys and draw caps | missing | Stable performance with bounded labels, lines, boxes, and no stale objects. |

Pine adaptations required:

- Pine has no file/database cache, server sync, account history, or cTrader chart controls.
- Pine supports finite `request.security` calls and drawing limits; the implementation must expose explicit symbol/TF limits and reuse/delete objects.
- Pine visual strategy produces chart drawings and alerts only. It never submits broker orders.
