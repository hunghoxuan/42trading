using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using cAlgo.API;

namespace cAlgo.Robots
{
    public partial class TVBridgeCBot
    {
        // Strategy data requirements shadow inputs only for the synchronous analysis/order
        // operation. The stored cTrader parameters and other strategy slots never change.
        private sealed class StrategyDataProfile
        {
            public Dictionary<string, object> Values = new Dictionary<string, object>(StringComparer.Ordinal);
            public string Key;
            public string StrategyId;
            public Dictionary<string, object> Params;
        }

        private static readonly HashSet<string> StrategyDataParameterNames = new HashSet<string>(StringComparer.Ordinal)
        {
            nameof(SelectedNewsBlockPreset),
            nameof(FirstTradeMode),
            nameof(SecondTradeMode),
            nameof(ThirdTradeMode),
            nameof(OrdersExpiry),
            nameof(StrategyOrderCount),
            nameof(AutoRetestDistanceAtr),
            nameof(SelectedStrategyEntryType),
            nameof(SelectedStrategyStopLossMode),
            nameof(SelectedStrategyStopLossBufferMode),
            nameof(SelectedStrategyTakeProfitMode),
            nameof(SelectedStrategyExitMode),
            nameof(SelectedRrLadderSlStep),
            nameof(BreakEvenOffsetPips),
            nameof(SelectedRrLadderClosePlan),
            nameof(SelectedTradeDirectionMode),
            nameof(AdaptiveBiasMinStopLossPercent),
            nameof(AdaptiveBiasReducedRiskPercent),
            nameof(SelectedAdaptiveBiasReduceScope),
            nameof(SelectedAdaptiveWinRiskMode),
            nameof(AdaptiveWinRiskPercent),
            nameof(ConfluenceScope),
            nameof(StrategyDaysPresetValue),
            nameof(StrategySessionsPresetValue),
            nameof(OvernightBlockMode),
            nameof(MarketCloseProtectionMinutes),
            nameof(WeekendBlockMode),
            nameof(MinimumConfluences),
            nameof(ConfluenceVolumeSurge),
            nameof(TrendBiasStructure),
            nameof(TrendBiasEma),
            nameof(TrendBiasRsi),
            nameof(TrendBiasMacd),
            nameof(TrendBiasAdx),
            nameof(TrendBiasIchimoku),
            nameof(TrendBiasIchimokuStrict),
            nameof(ConfluenceTrendBias),
            nameof(ConfluencePremiumDiscount),
            nameof(ConfluenceOpposingLevelClearance),
            nameof(ConfluenceBarDirection),
            nameof(DrawSweepDetections),
            nameof(DrawRejectionDetections),
            nameof(DrawCrossDetections),
            nameof(DrawBreakoutDetections),
            nameof(DrawEarlyRejectionDetections),
            nameof(DrawChochDetections),
            nameof(DrawBosDetections),
            nameof(BiasAlignmentEvent),
            nameof(RejectionWickDominance),
            nameof(ConfluenceOrderBlock),
            nameof(ConfluenceFairValueGap),
            nameof(DrawEmaEvents),
            nameof(DrawIchimokuEvents),
            nameof(DrawDonchianEvents),
            nameof(DrawVwapEvents),
            nameof(DrawBollingerEvents),
            nameof(DrawRsiEvents),
            nameof(DrawStochasticEvents),
            nameof(DrawMacdEvents),
            nameof(DrawAdxEvents),
            nameof(ConfluenceKeyLevels),
            nameof(ConfluenceSwing),
            nameof(ConfluenceEqualHighLow),
            nameof(ConfluenceTrendline),
            nameof(ConfluenceSupply),
            nameof(ConfluenceDemand),
            nameof(ConfluenceEma),
            nameof(ConfluenceVwap),
            nameof(ConfluenceBollinger),
            nameof(ConfluenceRsi),
            nameof(ConfluenceStochastic),
            nameof(ConfluenceMacd),
            nameof(ConfluenceIchimoku),
            nameof(ConfluenceIchimokuStrict),
            nameof(DrawLiquidityLevels),
            nameof(DrawOrderBlocks),
            nameof(DrawFvgZones),
            nameof(DrawKeyLevels),
            nameof(DrawSupplyDemand),
            nameof(ZoneVolumeSurgePreset),
            nameof(DrawPinBarPatterns),
            nameof(DrawEngulfingPatterns),
            nameof(DrawBigCandlePatterns),
            nameof(DrawThreeWhiteSoldiersPatterns),
            nameof(DrawHaramiPatterns),
            nameof(SwingVisuals),
            nameof(ZoneLookback),
            nameof(DrawTrendlines),
            nameof(DrawHigherTimeframeTrendlines),
            nameof(DrawEmaOverlay),
            nameof(DrawVwapOverlay),
            nameof(DrawBollingerOverlay),
            nameof(DrawIchimokuOverlay),
            nameof(DrawDonchianOverlay),
            nameof(DrawRsiMode),
            nameof(DrawStochasticMode),
            nameof(DrawStochRsiMode),
            nameof(DrawMacdMode),
            nameof(DrawAdxMode),
        };

        private StrategyDataProfile _strategyDataProfile;
        private readonly Dictionary<Dictionary<string, object>, StrategyDataProfile> _strategyDataProfiles =
            new Dictionary<Dictionary<string, object>, StrategyDataProfile>();
        private static readonly FieldInfo[] StrategyDataRuntimeFields = typeof(TVBridgeCBot)
            .GetFields(BindingFlags.Instance | BindingFlags.NonPublic)
            .Where(field => field.Name.StartsWith("_toggle", StringComparison.Ordinal) ||
                field.Name.StartsWith("_resolved", StringComparison.Ordinal) && field.Name.EndsWith("Config", StringComparison.Ordinal) ||
                field.FieldType == typeof(StructureEventFollowUpFilter)).ToArray();

        private double StrategyDataNumber(string name, double fallback)
        {
            var value = ReadSharedStrategyNumber(_strategyDataProfile != null ? _strategyDataProfile.Params : null, name, fallback);
            return IsFiniteNumber(value) ? value : fallback;
        }

        private int StrategyDataPeriod(string name, int fallback)
        {
            return Math.Max(1, Math.Min(10000, (int)Math.Round(StrategyDataNumber(name, fallback))));
        }

        private T StrategyParameter<T>(string name, T sharedValue)
        {
            object value;
            return _strategyDataProfile != null && _strategyDataProfile.Values.TryGetValue(name, out value)
                ? (T)value : sharedValue;
        }

        private sealed class StrategyDataScope : IDisposable
        {
            private readonly TVBridgeCBot _owner;
            private readonly StrategyDataProfile _previous;
            private readonly object[] _runtime;
            private readonly CausalDecisionContext _decision;
            private readonly string _settingsKey;
            private bool _disposed;

            public StrategyDataScope(TVBridgeCBot owner, StrategyDataProfile profile)
            {
                if (ReferenceEquals(owner._strategyDataProfile, profile)) return;
                _owner = owner;
                _previous = owner._strategyDataProfile;
                _runtime = StrategyDataRuntimeFields.Select(field => field.GetValue(owner)).ToArray();
                _decision = owner._causalDecision;
                _settingsKey = _decision != null ? _decision.AnalysisSettingsKey : null;
                if (_decision != null) _decision.AnalysisSettingsKey = null;
                owner._strategyDataProfile = profile;
                try { owner.ResolveStrategyDataRuntime(); }
                catch { Dispose(); throw; }
            }

            public void Dispose()
            {
                if (_owner == null || _disposed) return;
                _disposed = true;
                _owner._strategyDataProfile = _previous;
                for (var i = 0; i < StrategyDataRuntimeFields.Length; i++)
                    StrategyDataRuntimeFields[i].SetValue(_owner, _runtime[i]);
                if (_decision != null) _decision.AnalysisSettingsKey = _settingsKey;
            }
        }

        private IDisposable BeginStrategyData(BacktestStrategyMode mode, string strategyId = null)
        {
            if (_activeExecutionPolicy != null) return new StrategyDataScope(this, _activeExecutionPolicy);
            return new StrategyDataScope(this, ResolveStrategyDataProfileForMode(mode, strategyId));
        }

        private StrategyDataProfile ResolveStrategyDataProfileForMode(BacktestStrategyMode mode, string strategyId)
        {
            if (mode == BacktestStrategyMode.CustomTrade || mode == BacktestStrategyMode.Off) return null;
            EnsureSharedConfigCatalogLoaded();
            Dictionary<string, object> strategy;
            var id = string.IsNullOrWhiteSpace(strategyId) ? ResolveStrategyIdForMode(mode) : strategyId;
            if (!_sharedStrategyCatalog.TryGetValue(id, out strategy))
            {
                var baseMode = GetDirectionalStrategyBaseMode(mode);
                if (baseMode != mode)
                    _sharedStrategyCatalog.TryGetValue(ResolveStrategyIdForMode(baseMode), out strategy);
            }
            return strategy != null ? ResolveStrategyDataProfile(strategy) : null;
        }

        private StrategyDataProfile ResolveStrategyDataProfile(Dictionary<string, object> strategy)
        {
            StrategyDataProfile cached;
            if (_strategyDataProfiles.TryGetValue(strategy, out cached)) return cached;
            var profile = new StrategyDataProfile { StrategyId = ConvertToInvariantString(GetDictionaryValue(strategy, "id")) };
            profile.Params = GetDictionaryValue(strategy, "params") as Dictionary<string, object>;
            var required = GetDictionaryValue(strategy, "required_data") as Dictionary<string, object>;
            // Requirements prepare detector inputs regardless of display/CustomTrade switches.
            // Explicit strategy settings then define its optional filters and order settings.
            AddStrategyParameterValues(profile, GetDictionaryValue(required, "parameters") as Dictionary<string, object>);
            var settings = GetDictionaryValue(strategy, "settings") as Dictionary<string, object>;
            AddStrategyParameterValues(profile, GetDictionaryValue(settings, "parameters") as Dictionary<string, object>);
            AddStrategyPresetValues(profile, GetDictionaryValue(settings, "confluences") as Dictionary<string, object>, StrategyConfluenceParameters);
            AddStrategyPresetValues(profile, GetDictionaryValue(settings, "trade_config") as Dictionary<string, object>, StrategyOrderParameters);
            profile.Key = string.Join("|", profile.Values.OrderBy(pair => pair.Key, StringComparer.Ordinal)
                .Select(pair => pair.Key + "=" + Convert.ToString(pair.Value, CultureInfo.InvariantCulture)));
            _strategyDataProfiles[strategy] = profile;
            return profile;
        }

        private static readonly Dictionary<string, string> StrategyConfluenceParameters = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "days", nameof(StrategyDaysPresetValue) }, { "time_range", nameof(StrategySessionsPresetValue) },
            { "overnight_block", nameof(OvernightBlockMode) }, { "weekend_block", nameof(WeekendBlockMode) },
            { "minimum_count", nameof(MinimumConfluences) }, { "volume_surge", nameof(ConfluenceVolumeSurge) },
            { "trend_bias", nameof(ConfluenceTrendBias) }, { "premium_discount", nameof(ConfluencePremiumDiscount) },
            { "opposing_level_clearance", nameof(ConfluenceOpposingLevelClearance) }, { "bar_direction", nameof(ConfluenceBarDirection) },
            { "ema", nameof(ConfluenceEma) }, { "vwap", nameof(ConfluenceVwap) }, { "bollinger", nameof(ConfluenceBollinger) },
            { "rsi", nameof(ConfluenceRsi) }, { "stochastic", nameof(ConfluenceStochastic) }, { "macd", nameof(ConfluenceMacd) },
            { "ichimoku", nameof(ConfluenceIchimoku) }, { "ichimoku_strict", nameof(ConfluenceIchimokuStrict) }
        };
        private static readonly Dictionary<string, string> StrategyOrderParameters = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "entry", nameof(SelectedStrategyEntryType) }, { "sl", nameof(SelectedStrategyStopLossMode) },
            { "sl_buffer", nameof(SelectedStrategyStopLossBufferMode) }, { "tp", nameof(SelectedStrategyTakeProfitMode) },
            { "n_trades", nameof(StrategyOrderCount) }, { "exit_mode", nameof(SelectedStrategyExitMode) },
            { "orders_expiry", nameof(OrdersExpiry) },
            { "first_trade", nameof(FirstTradeMode) }, { "second_trade", nameof(SecondTradeMode) }, { "third_trade", nameof(ThirdTradeMode) }
        };

        private void AddStrategyPresetValues(StrategyDataProfile profile, Dictionary<string, object> values, Dictionary<string, string> names)
        {
            if (values == null) return;
            foreach (var pair in values)
            {
                string name;
                if (!names.TryGetValue(pair.Key, out name))
                    throw new InvalidOperationException("Unsupported strategy setting: " + pair.Key);
                // Some native strategies describe geometry instead of a dropdown enum.
                // Their builders own those values; a symbolic description is not an override.
                var text = ConvertToInvariantString(pair.Value);
                if (name == nameof(SelectedStrategyEntryType) && text == "event_wick_tenkan_midpoint" ||
                    name == nameof(SelectedStrategyTakeProfitMode) && text == "visible_trade_config" ||
                    name == nameof(SelectedStrategyStopLossMode) && new[] {
                        "donchian_middle_atr_buffer", "event_wick_reference_half_distance",
                        "ichimoku_cloud_edge_atr_buffer", "mirrored_ichimoku_cloud_edge_atr_buffer" }.Contains(text)) continue;
                AddStrategyParameterValue(profile, name, pair.Value, true);
            }
        }

        private void AddStrategyParameterValues(StrategyDataProfile profile, Dictionary<string, object> values)
        {
            if (values == null) return;
            foreach (var pair in values) AddStrategyParameterValue(profile, pair.Key, pair.Value, true);
        }

        private void AddStrategyParameterValue(StrategyDataProfile profile, string name, object raw, bool strict)
        {
            var property = typeof(TVBridgeCBot).GetProperty(name);
            // Only inputs explicitly wired through StrategyParameter may be shadowed.
            // Account-wide risk caps and credentials cannot be loosened by a strategy file.
            if (property == null || !StrategyDataParameterNames.Contains(name))
            {
                if (strict) throw new InvalidOperationException("Unsupported strategy parameter: " + name);
                return;
            }
            try
            {
                var text = Convert.ToString(raw, CultureInfo.InvariantCulture);
                if (property.PropertyType == typeof(StrategyStopLossMode)) text = NormalizeStrategyStopLossModeName(text);
                if (property.PropertyType == typeof(StrategyTradePlanMode))
                {
                    StrategyTradePlanMode planMode;
                    if (!TryParseStrategyTradePlanMode(text, out planMode))
                        throw new ArgumentException("Unknown trade plan mode");
                    profile.Values[name] = planMode;
                    return;
                }
                if (property.PropertyType == typeof(RrLadderSlStep))
                {
                    RrLadderSlStep method;
                    if (!TryParseTrailingMethod(text, out method)) throw new ArgumentException("Unknown trailing method");
                    profile.Values[name] = method;
                    return;
                }
                // Preserve numeric ordinals and accept textual presets saved before the rename.
                if (property.PropertyType == typeof(StrategyOrderCountMode))
                {
                    if (new[] { "_2", "_3", "_4", "_5" }.Contains(text)) text += "_AutoEntries_SameTPSL";
                    text = text.Replace("_Same_TPSL", "_AutoEntries_SameTPSL")
                        .Replace("_Same_Distance", "_AutoEntries_SameDistance")
                        .Replace("_Equal_SameTPSL", "_EqualEntries_SameTPSL");
                }
                var value = property.PropertyType.IsEnum
                    ? Enum.Parse(property.PropertyType, text, true)
                    : Convert.ChangeType(raw, property.PropertyType, CultureInfo.InvariantCulture);
                if (property.PropertyType.IsEnum && !Enum.IsDefined(property.PropertyType, value))
                    throw new ArgumentException("Unknown enum value");
                profile.Values[name] = value;
            }
            catch (Exception ex)
            {
                if (strict) throw new InvalidOperationException("Invalid strategy parameter " + name + ": " + raw, ex);
            }
        }

        private void ResolveStrategyDataRuntime()
        {
            RefreshRuntimeEventToggleState();
            _toggleTrendlines = DrawTrendlines;
            _toggleLiquidityLevels = DrawLiquidityLevels != ConfluenceScopeMode.No;
            _toggleKeyLevels = DrawKeyLevels != ConfluenceScopeMode.No;
            _toggleOrderBlocks = DrawOrderBlocks != ConfluenceScopeMode.No;
            _toggleFvgZones = DrawFvgZones != ConfluenceScopeMode.No;
            _toggleSupplyDemand = DrawSupplyDemand != ConfluenceScopeMode.No;
            _resolvedEmaOverlayConfig = ResolveEmaIndicatorConfig(DrawEmaOverlay);
            _resolvedVwapOverlayConfig = ResolveVwapIndicatorConfig(DrawVwapOverlay);
            _resolvedBollingerOverlayConfig = ResolveBollingerIndicatorConfig(DrawBollingerOverlay);
            _resolvedIchimokuOverlayConfig = ResolveIchimokuIndicatorConfig(DrawIchimokuOverlay);
            _resolvedDonchianOverlayConfig = ResolveDonchianIndicatorConfig(DrawDonchianOverlay);
            _resolvedEmaEventConfig = ResolveEmaIndicatorConfig(DrawEmaOverlay == EmaVisualMode.Off ? EmaVisualMode.Auto : DrawEmaOverlay);
            _resolvedVwapEventConfig = ResolveVwapIndicatorConfig(DrawVwapOverlay == VwapVisualMode.Off ? VwapVisualMode.Auto : DrawVwapOverlay);
            _resolvedBollingerEventConfig = ResolveBollingerIndicatorConfig(DrawBollingerOverlay == BollingerVisualMode.Off ? BollingerVisualMode.Auto : DrawBollingerOverlay);
            _resolvedRsiEventConfig = ResolveRsiIndicatorConfig(DrawRsiMode == RsiVisualMode.Off ? RsiVisualMode.Auto : DrawRsiMode);
            _resolvedStochasticEventConfig = ResolveStochasticIndicatorConfig(DrawStochasticMode == StochasticVisualMode.Off ? StochasticVisualMode.Auto : DrawStochasticMode);
            _resolvedMacdEventConfig = ResolveMacdIndicatorConfig(DrawMacdMode == MacdVisualMode.Off ? MacdVisualMode.Auto : DrawMacdMode);
            _resolvedAdxConfig = ResolveAdxIndicatorConfig(DrawAdxMode == AdxVisualMode.Off ? AdxVisualMode.Auto : DrawAdxMode);
            _toggleEmaOverlay = DrawEmaOverlay != EmaVisualMode.Off;
            _toggleVwapOverlay = DrawVwapOverlay != VwapVisualMode.Off;
            _toggleBollingerOverlay = DrawBollingerOverlay != BollingerVisualMode.Off;
            _toggleIchimokuOverlay = DrawIchimokuOverlay != IchimokuVisualMode.Off;
            _toggleDonchianOverlay = DrawDonchianOverlay != DonchianVisualMode.Off;
            SetAllStructureEventFollowUpFilters(StructureEventFollowUpFilter.Any);
            SetAllCandlePatternFollowUpFilters(StructureEventFollowUpFilter.Any);
        }

        // Per-calculation identity, shared by CustomTrade, strategy declarations and native
        // builders. Different periods never reuse each other's value; equal periods do.
        private readonly Dictionary<string, double> _strategyIndicatorValues = new Dictionary<string, double>();
        private readonly Queue<string> _strategyIndicatorValueOrder = new Queue<string>();
        private readonly Dictionary<string, Tuple<double, double>> _strategyMacdValues = new Dictionary<string, Tuple<double, double>>();
        private readonly Queue<string> _strategyMacdValueOrder = new Queue<string>();
        private bool TryComputeMacdValues(Bars bars, int index, int fast, int slow, int signal, out double line, out double signalLine)
        {
            var key = bars != null && index >= 0 && index < bars.Count - 1
                ? BuildChartCacheKey(GetCausalFeedIdentity(bars), index, bars.OpenTimes[index].Ticks, fast, slow, signal) : null;
            Tuple<double, double> cached;
            if (key != null && _strategyMacdValues.TryGetValue(key, out cached))
            {
                line = cached.Item1;
                signalLine = cached.Item2;
                return true;
            }
            if (!TryComputeMacdValuesCore(bars, index, fast, slow, signal, out line, out signalLine)) return false;
            if (key != null)
                CTraderCacheEngine.StoreBoundedFifo(_strategyMacdValues, _strategyMacdValueOrder, key, Tuple.Create(line, signalLine), 8192);
            return true;
        }

        private double CalculateDeclaredStrategyIndicator(Dictionary<string, object> definition,
            Dictionary<string, object> context, Bars bars, int index, string type, int length)
        {
            switch (type)
            {
                case "ema": return ComputeExponentialMovingAverage(bars, index, length);
                case "sma": return ComputeSimpleMovingAverage(bars, index, length);
                case "rsi": return ComputeRelativeStrengthIndex(bars, index, length);
                case "roc": return ComputeRateOfChange(bars, index, length);
                case "atr": return ComputeAverageTrueRangeAtIndex(bars, index, length);
                case "vwap": return ComputeRollingVwapAtIndex(bars, length, index);
                case "highest_high":
                case "lowest_low":
                    return GetSharedIndicatorValue(bars, index, type + ":" + length,
                        () => SharedConfigHighest(bars, index, length, type == "highest_high"));
            }
            var field = ConvertToInvariantString(GetDictionaryValue(definition, "field")).ToLowerInvariant();
            var fast = Math.Max(1, (int)ResolveSharedConfigNumber(GetDictionaryValue(definition, "fast_length"), context, 12));
            var slow = Math.Max(1, (int)ResolveSharedConfigNumber(GetDictionaryValue(definition, "slow_length"), context, 26));
            var signal = Math.Max(1, (int)ResolveSharedConfigNumber(GetDictionaryValue(definition, "signal_length"), context, 9));
            var smooth = Math.Max(1, (int)ResolveSharedConfigNumber(GetDictionaryValue(definition, "smooth_period"), context, 3));
            var deviation = ResolveSharedConfigNumber(GetDictionaryValue(definition, "stddev"), context, 2);
            var key = BuildChartCacheKey(type, field, length, fast, slow, signal, smooth, deviation);
            return GetSharedIndicatorValue(bars, index, key, () =>
            {
                if (type == "macd")
                {
                    double line, signalLine;
                    if (!TryComputeMacdValues(bars, index, fast, slow, signal, out line, out signalLine)) return double.NaN;
                    return field == "signal" ? signalLine : field == "histogram" ? line - signalLine : line;
                }
                if (type == "bollinger")
                    return field == "upper" ? ComputeBollingerUpper(bars, index, length, deviation)
                        : field == "lower" ? ComputeBollingerLower(bars, index, length, deviation)
                        : ComputeSimpleMovingAverage(bars, index, length);
                if (type == "stochastic")
                    return field == "d" ? ComputeStochasticD(bars, index, length, smooth, signal)
                        : ComputeSmoothedStochasticK(bars, index, length, smooth);
                throw new InvalidOperationException("Unsupported strategy indicator: " + type);
            });
        }

        private double GetSharedIndicatorValue(Bars bars, int index, string calculation, Func<double> calculate)
        {
            if (bars == null || index < 0 || index >= bars.Count - 1) return calculate();
            var key = BuildChartCacheKey(GetCausalFeedIdentity(bars), index, bars.OpenTimes[index].Ticks, calculation);
            double value;
            if (_strategyIndicatorValues.TryGetValue(key, out value)) return value;
            value = calculate();
            CTraderCacheEngine.StoreBoundedFifo(_strategyIndicatorValues, _strategyIndicatorValueOrder, key, value, 8192);
            return value;
        }
    }
}
