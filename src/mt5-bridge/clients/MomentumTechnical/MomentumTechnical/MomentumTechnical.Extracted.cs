using System;
using System.Linq;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Globalization;
using cAlgo.API;
using cAlgo.API.Internals;
using cAlgo.API.Indicators;
using cAlgo.Indicators;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Text;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace cAlgo.Robots
{
    public partial class MomentumTechnical
    {
        private EmaIndicatorConfig _resolvedEmaOverlayConfig;
        private EmaIndicatorConfig _resolvedEmaEventConfig;
        private VwapIndicatorConfig _resolvedVwapOverlayConfig;
        private VwapIndicatorConfig _resolvedVwapEventConfig;
        private BollingerIndicatorConfig _resolvedBollingerOverlayConfig;
        private BollingerIndicatorConfig _resolvedBollingerEventConfig;
        private IchimokuIndicatorConfig _resolvedIchimokuOverlayConfig;
        private DonchianIndicatorConfig _resolvedDonchianOverlayConfig;
        private RsiIndicatorConfig _resolvedRsiEventConfig;
        private StochasticIndicatorConfig _resolvedStochasticEventConfig;
        private MacdIndicatorConfig _resolvedMacdEventConfig;
        private AdxIndicatorConfig _resolvedAdxConfig;
        private ChartIndicator _chartRsiIndicator;
        private ChartIndicator _chartStochasticIndicator;
        private ChartIndicator _chartStochRsiHostIndicator;
        private ChartIndicator _chartMacdIndicator;
        private ChartIndicator _chartTickVolumeIndicator;
        private readonly HashSet<string> _managedDivergenceIndicatorObjectNames = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> _managedStochRsiIndicatorObjectNames = new HashSet<string>(StringComparer.Ordinal);
        private string _lastStochRsiDrawKey = "";
        private string _chartOscillatorSignature = "";
        private string _nativeIndicatorChartContextKey = "";
        // Native price-panel overlays (EMA / VWAP / Bollinger / Ichimoku / Donchian). When these exist,
        // the expensive per-bar custom drawing is skipped; if an Add fails (null), the custom
        // path is kept as a fallback.
        private ChartIndicator _chartEmaFastIndicator;
        private ChartIndicator _chartEmaMidIndicator;
        private ChartIndicator _chartEmaSlowIndicator;
        private ChartIndicator _chartVwapIndicator;
        private ChartIndicator _chartBollingerIndicator;
        private ChartIndicator _chartIchimokuIndicator;
        private ChartIndicator _chartDonchianIndicator;
        // Display-only native calculations. Never share these full-feed instances with
        // signal/confluence/protection analysis, which uses explicit DecisionBar prefixes.
        private ExponentialMovingAverage _displayEmaFast;
        private ExponentialMovingAverage _displayEmaMid;
        private ExponentialMovingAverage _displayEmaSlow;
        private IchimokuKinkoHyo _displayIchimoku;
        private string _chartTechnicalOverlaySignature = "";
        private string _lastAppliedDirectionalPaletteKey = "";

        public enum EmaVisualMode
        {
            Auto,
            Off,
            trend_9_21 = 5,
            trend_20_50 = 6,
            trend_50_200 = 7,
            scalp_5_13 = 8,
            scalp_8_21 = 9,
            scalp_13_34 = 10,
            swing_21_55 = 11,
            swing_34_89 = 4,
            swing_50_100 = 12,
            triple_9_21_55 = 2,
            triple_8_21_55 = 13,
            triple_20_50_200 = 3
        }

        public enum VwapVisualMode
        {
            Auto,
            Off,
            V20,
            V30,
            V50
        }

        public enum BollingerVisualMode
        {
            Auto,
            Off,
            BB20_2,
            BB20_25,
            BB34_2
        }

        public enum IchimokuVisualMode
        {
            Auto,
            Off,
            I9_26_52,
            I7_22_44,
            I20_60_120
        }

        public enum DonchianVisualMode
        {
            Auto,
            Off,
            D20,
            D55
        }

        public enum RsiVisualMode
        {
            Auto,
            Off,
            R14,
            R21
        }

        public enum StochasticVisualMode
        {
            Auto,
            Off,
            S14_3_3,
            S9_3_3,
            S21_5_5
        }

        public enum StochRsiVisualMode
        {
            Auto,
            Off,
            SR14_14_3_3,
            SR21_21_3_3
        }

        public enum MacdVisualMode
        {
            Auto,
            Off,
            M12_26_9,
            M8_21_5,
            M5_34_5
        }

        public enum AdxVisualMode
        {
            Auto,
            Off,
            A14,
            A21
        }

        public enum MomentumTechnicalComboMode
        {
            All,
            None,
            PerItem,
            Ema,
            Vwap,
            Bollinger,
            Ichimoku,
            Donchian,
            Rsi,
            Stochastic,
            StochRsi,
            Macd
        }

        [Parameter("EMA", Group = "Momentum Technical", DefaultValue = EmaVisualMode.Auto)]
        public EmaVisualMode DrawEmaOverlay { get; set; }

        [Parameter("VWAP", Group = "Momentum Technical", DefaultValue = VwapVisualMode.Auto)]
        public VwapVisualMode DrawVwapOverlay { get; set; }

        [Parameter("Bollinger", Group = "Momentum Technical", DefaultValue = BollingerVisualMode.Off)]
        public BollingerVisualMode DrawBollingerOverlay { get; set; }

        [Parameter("Ichimoku", Group = "Momentum Technical", DefaultValue = IchimokuVisualMode.Auto)]
        public IchimokuVisualMode DrawIchimokuOverlay { get; set; }

        [Parameter("Donchian", Group = "Momentum Technical", DefaultValue = DonchianVisualMode.Auto)]
        public DonchianVisualMode DrawDonchianOverlay { get; set; }

        [Parameter("RSI", Group = "Momentum Technical", DefaultValue = RsiVisualMode.Auto)]
        public RsiVisualMode DrawRsiMode { get; set; }

        [Parameter("Stoch", Group = "Momentum Technical", DefaultValue = StochasticVisualMode.Auto)]
        public StochasticVisualMode DrawStochasticMode { get; set; }

        [Parameter("Stoch RSI", Group = "Momentum Technical", DefaultValue = StochRsiVisualMode.Auto)]
        public StochRsiVisualMode DrawStochRsiMode { get; set; }

        [Parameter("MACD", Group = "Momentum Technical", DefaultValue = MacdVisualMode.Auto)]
        public MacdVisualMode DrawMacdMode { get; set; }

        [Parameter("ADX", Group = "Momentum Technical", DefaultValue = AdxVisualMode.Auto)]
        public AdxVisualMode DrawAdxMode { get; set; }

        private void ApplyMomentumTechnicalCombo()
        {
            var ema = false; var vwap = false; var bb = false; var ichi = false; var donchian = false;
            switch (MomentumTechnicalCombo)
            {
                case MomentumTechnicalComboMode.None:
                    break;
                case MomentumTechnicalComboMode.All:
                    ema = true; vwap = true; bb = true; ichi = true; donchian = true;
                    break;
                case MomentumTechnicalComboMode.PerItem:
                    ema = DrawEmaOverlay != EmaVisualMode.Off;
                    vwap = DrawVwapOverlay != VwapVisualMode.Off;
                    bb = DrawBollingerOverlay != BollingerVisualMode.Off;
                    ichi = DrawIchimokuOverlay != IchimokuVisualMode.Off;
                    donchian = DrawDonchianOverlay != DonchianVisualMode.Off;
                    break;
                case MomentumTechnicalComboMode.Ema:
                    ema = true;
                    break;
                case MomentumTechnicalComboMode.Vwap:
                    vwap = true;
                    break;
                case MomentumTechnicalComboMode.Bollinger:
                    bb = true;
                    break;
                case MomentumTechnicalComboMode.Ichimoku:
                    ichi = true;
                    break;
                case MomentumTechnicalComboMode.Donchian:
                    donchian = true;
                    break;
                case MomentumTechnicalComboMode.Rsi:
                case MomentumTechnicalComboMode.Stochastic:
                case MomentumTechnicalComboMode.StochRsi:
                case MomentumTechnicalComboMode.Macd:
                    break;
                default:
                    return;
            }
            _toggleEmaOverlay = ema;
            _toggleVwapOverlay = vwap;
            _toggleBollingerOverlay = bb;
            _toggleIchimokuOverlay = ichi;
            _toggleDonchianOverlay = donchian;
        }

        // The RSI/Stoch/MACD sub-panels are driven by their mode params directly, so they need a
        // live effective check on top of the Momentum Technical combo.
        private bool EffectiveMomentumOscillatorEnabled(bool individualEnabled, MomentumTechnicalComboMode item)
        {
            switch (MomentumTechnicalCombo)
            {
                case MomentumTechnicalComboMode.None:
                    return false;
                case MomentumTechnicalComboMode.All:
                    return individualEnabled;
                case MomentumTechnicalComboMode.PerItem:
                    return individualEnabled;
                default:
                    return MomentumTechnicalCombo == item;
            }
        }

        private EmaIndicatorConfig ResolveEmaIndicatorConfig(EmaVisualMode mode, bool forEvents)
        {
            switch (mode)
            {
                case EmaVisualMode.trend_9_21:
                    return new EmaIndicatorConfig { PriceCrossPeriod = 9, FastPeriod = 9, MidPeriod = 21, SlowPeriod = 21 };
                case EmaVisualMode.trend_20_50:
                    return new EmaIndicatorConfig { PriceCrossPeriod = 20, FastPeriod = 20, MidPeriod = 50, SlowPeriod = 50 };
                case EmaVisualMode.trend_50_200:
                    return new EmaIndicatorConfig { PriceCrossPeriod = 50, FastPeriod = 50, MidPeriod = 200, SlowPeriod = 200 };
                case EmaVisualMode.scalp_5_13:
                    return new EmaIndicatorConfig { PriceCrossPeriod = 5, FastPeriod = 5, MidPeriod = 13, SlowPeriod = 13 };
                case EmaVisualMode.scalp_8_21:
                    return new EmaIndicatorConfig { PriceCrossPeriod = 8, FastPeriod = 8, MidPeriod = 21, SlowPeriod = 21 };
                case EmaVisualMode.scalp_13_34:
                    return new EmaIndicatorConfig { PriceCrossPeriod = 13, FastPeriod = 13, MidPeriod = 34, SlowPeriod = 34 };
                case EmaVisualMode.swing_21_55:
                    return new EmaIndicatorConfig { PriceCrossPeriod = 21, FastPeriod = 21, MidPeriod = 55, SlowPeriod = 55 };
                case EmaVisualMode.swing_34_89:
                    return new EmaIndicatorConfig { PriceCrossPeriod = 34, FastPeriod = 34, MidPeriod = 89, SlowPeriod = 89 };
                case EmaVisualMode.swing_50_100:
                    return new EmaIndicatorConfig { PriceCrossPeriod = 50, FastPeriod = 50, MidPeriod = 100, SlowPeriod = 100 };
                case EmaVisualMode.triple_9_21_55:
                    return new EmaIndicatorConfig { PriceCrossPeriod = 9, FastPeriod = 9, MidPeriod = 21, SlowPeriod = 55 };
                case EmaVisualMode.triple_8_21_55:
                    return new EmaIndicatorConfig { PriceCrossPeriod = 8, FastPeriod = 8, MidPeriod = 21, SlowPeriod = 55 };
                case EmaVisualMode.triple_20_50_200:
                    return new EmaIndicatorConfig { PriceCrossPeriod = 20, FastPeriod = 20, MidPeriod = 50, SlowPeriod = 200 };
                case EmaVisualMode.Off:
                    return new EmaIndicatorConfig();
                case EmaVisualMode.Auto:
                    // Pair presets repeat the second EMA as SlowPeriod. The renderer avoids
                    // drawing a duplicate line, while PriceSlowEmaCross and EMA confluence
                    // still use the second configured EMA instead of an unavailable value.
                    return forEvents
                        ? new EmaIndicatorConfig { PriceCrossPeriod = 20, FastPeriod = 9, MidPeriod = 21, SlowPeriod = 21 }
                        : new EmaIndicatorConfig { PriceCrossPeriod = 20, FastPeriod = 20, MidPeriod = 50, SlowPeriod = 50 };
                default:
                    return forEvents
                        ? new EmaIndicatorConfig { PriceCrossPeriod = 20, FastPeriod = 9, MidPeriod = 21, SlowPeriod = 21 }
                        : new EmaIndicatorConfig { PriceCrossPeriod = 20, FastPeriod = 20, MidPeriod = 50, SlowPeriod = 50 };
            }
        }

        private VwapIndicatorConfig ResolveVwapIndicatorConfig(VwapVisualMode mode)
        {
            switch (mode)
            {
                case VwapVisualMode.V30:
                    return new VwapIndicatorConfig { Length = 30 };
                case VwapVisualMode.V50:
                    return new VwapIndicatorConfig { Length = 50 };
                case VwapVisualMode.Off:
                    return new VwapIndicatorConfig();
                case VwapVisualMode.V20:
                case VwapVisualMode.Auto:
                default:
                    return new VwapIndicatorConfig { Length = 20 };
            }
        }

        private BollingerIndicatorConfig ResolveBollingerIndicatorConfig(BollingerVisualMode mode)
        {
            switch (mode)
            {
                case BollingerVisualMode.BB20_25:
                    return new BollingerIndicatorConfig { Period = 20, StdDevMultiplier = 2.5 };
                case BollingerVisualMode.BB34_2:
                    return new BollingerIndicatorConfig { Period = 34, StdDevMultiplier = 2.0 };
                case BollingerVisualMode.Off:
                    return new BollingerIndicatorConfig();
                case BollingerVisualMode.BB20_2:
                case BollingerVisualMode.Auto:
                default:
                    return new BollingerIndicatorConfig { Period = 20, StdDevMultiplier = 2.0 };
            }
        }

        private IchimokuIndicatorConfig ResolveIchimokuIndicatorConfig(IchimokuVisualMode mode)
        {
            switch (mode)
            {
                case IchimokuVisualMode.I7_22_44:
                    return new IchimokuIndicatorConfig { ConversionPeriod = 7, BasePeriod = 22, SpanBPeriod = 44 };
                case IchimokuVisualMode.I20_60_120:
                    return new IchimokuIndicatorConfig { ConversionPeriod = 20, BasePeriod = 60, SpanBPeriod = 120 };
                case IchimokuVisualMode.Off:
                    return new IchimokuIndicatorConfig();
                case IchimokuVisualMode.I9_26_52:
                case IchimokuVisualMode.Auto:
                default:
                    return new IchimokuIndicatorConfig { ConversionPeriod = 9, BasePeriod = 26, SpanBPeriod = 52 };
            }
        }

        private DonchianIndicatorConfig ResolveDonchianIndicatorConfig(DonchianVisualMode mode)
        {
            switch (mode)
            {
                case DonchianVisualMode.D55:
                    return new DonchianIndicatorConfig { Period = 55 };
                case DonchianVisualMode.Off:
                    return new DonchianIndicatorConfig();
                case DonchianVisualMode.D20:
                case DonchianVisualMode.Auto:
                default:
                    return new DonchianIndicatorConfig { Period = 20 };
            }
        }

        private RsiIndicatorConfig ResolveRsiIndicatorConfig(RsiVisualMode mode)
        {
            switch (mode)
            {
                case RsiVisualMode.R21:
                    return new RsiIndicatorConfig { Period = 21, Midline = 50.0, Oversold = 30.0, Overbought = 70.0 };
                case RsiVisualMode.Off:
                    return new RsiIndicatorConfig();
                case RsiVisualMode.R14:
                case RsiVisualMode.Auto:
                default:
                    return new RsiIndicatorConfig { Period = 14, Midline = 50.0, Oversold = 30.0, Overbought = 70.0 };
            }
        }

        private StochasticIndicatorConfig ResolveStochasticIndicatorConfig(StochasticVisualMode mode)
        {
            switch (mode)
            {
                case StochasticVisualMode.S9_3_3:
                    return new StochasticIndicatorConfig { KPeriod = 9, KSlowingPeriod = 3, DPeriod = 3, OversoldLevel = 20, OverboughtLevel = 80 };
                case StochasticVisualMode.S21_5_5:
                    return new StochasticIndicatorConfig { KPeriod = 21, KSlowingPeriod = 5, DPeriod = 5, OversoldLevel = 20, OverboughtLevel = 80 };
                case StochasticVisualMode.Off:
                    return new StochasticIndicatorConfig();
                case StochasticVisualMode.S14_3_3:
                case StochasticVisualMode.Auto:
                default:
                    return new StochasticIndicatorConfig { KPeriod = 14, KSlowingPeriod = 3, DPeriod = 3, OversoldLevel = 20, OverboughtLevel = 80 };
            }
        }

        private MacdIndicatorConfig ResolveMacdIndicatorConfig(MacdVisualMode mode)
        {
            switch (mode)
            {
                case MacdVisualMode.M8_21_5:
                    return new MacdIndicatorConfig { FastPeriod = 8, SlowPeriod = 21, SignalPeriod = 5 };
                case MacdVisualMode.M5_34_5:
                    return new MacdIndicatorConfig { FastPeriod = 5, SlowPeriod = 34, SignalPeriod = 5 };
                case MacdVisualMode.Off:
                    return new MacdIndicatorConfig();
                case MacdVisualMode.M12_26_9:
                case MacdVisualMode.Auto:
                default:
                    return new MacdIndicatorConfig { FastPeriod = 12, SlowPeriod = 26, SignalPeriod = 9 };
            }
        }

        private AdxIndicatorConfig ResolveAdxIndicatorConfig(AdxVisualMode mode)
        {
            switch (mode)
            {
                case AdxVisualMode.A21:
                    return new AdxIndicatorConfig { Period = 21, MinimumStrength = 25.0 };
                case AdxVisualMode.Off:
                    return new AdxIndicatorConfig();
                case AdxVisualMode.A14:
                case AdxVisualMode.Auto:
                default:
                    return new AdxIndicatorConfig { Period = 14, MinimumStrength = 25.0 };
            }
        }

        private string GetEmaOverlayPairLabel()
        {
            return "EMA";
        }

        private string GetVwapOverlayPairLabel()
        {
            return "VWAP";
        }

        private string GetBollingerOverlayPairLabel()
        {
            return "BB";
        }

        private string GetIchimokuOverlayPairLabel()
        {
            return "ICHI";
        }

        // Technical indicators always use cTrader's native indicator implementation.
        private bool ShouldUseNativeEmaOverlay()
        {
            return DrawEmaOverlay != EmaVisualMode.Off;
        }

        private bool ShouldUseNativeVwapOverlay()
        {
            return DrawVwapOverlay != VwapVisualMode.Off;
        }

        private bool ShouldUseNativeBollingerOverlay()
        {
            return DrawBollingerOverlay != BollingerVisualMode.Off;
        }

        private bool ShouldUseNativeIchimokuOverlay()
        {
            return DrawIchimokuOverlay != IchimokuVisualMode.Off;
        }

        private bool ShouldUseNativeDonchianOverlay()
        {
            return DrawDonchianOverlay != DonchianVisualMode.Off;
        }

        private bool ShouldUseNativeRsiIndicator()
        {
            return DrawRsiMode != RsiVisualMode.Off;
        }

        private bool ShouldUseNativeStochasticIndicator()
        {
            return DrawStochasticMode != StochasticVisualMode.Off;
        }

        private bool ShouldDrawStochRsiIndicator()
        {
            return DrawStochRsiMode != StochRsiVisualMode.Off;
        }

        private bool ShouldUseNativeMacdIndicator()
        {
            return DrawMacdMode != MacdVisualMode.Off;
        }


        private string BuildOscillatorPanelSignature()
        {
            return string.Join(
                "|",
                new[]
                {
                    GetChartSymbolKey(),
                    GetChartTimeFrameKey(),
                    DrawRsiMode.ToString(),
                    DrawStochasticMode.ToString(),
                    DrawStochRsiMode.ToString(),
                    DrawMacdMode.ToString(),
                    ShouldUseNativeRsiIndicator() ? "rsi:native" : "rsi:custom",
                    ShouldUseNativeStochasticIndicator() ? "sto:native" : "sto:custom",
                    ShouldDrawStochRsiIndicator() ? "stochrsi:custom" : "stochrsi:off",
                    ShouldUseNativeMacdIndicator() ? "macd:native" : "macd:custom",
                    "tickvolume:native",
                    _resolvedRsiEventConfig.Period.ToString(CultureInfo.InvariantCulture),
                    _resolvedStochasticEventConfig.KPeriod.ToString(CultureInfo.InvariantCulture),
                    _resolvedStochasticEventConfig.KSlowingPeriod.ToString(CultureInfo.InvariantCulture),
                    _resolvedStochasticEventConfig.DPeriod.ToString(CultureInfo.InvariantCulture),
                    _resolvedMacdEventConfig.FastPeriod.ToString(CultureInfo.InvariantCulture),
                    _resolvedMacdEventConfig.SlowPeriod.ToString(CultureInfo.InvariantCulture),
                    _resolvedMacdEventConfig.SignalPeriod.ToString(CultureInfo.InvariantCulture)
                });
        }

        private void SyncChartOscillatorIndicators()
        {
            if (ChartIndicators == null)
                return;
            var chartBars = GetNativeChartIndicatorBars();
            if (chartBars == null || chartBars.Count < 5)
                return;
            var indicatorSeriesOsc = chartBars.ClosePrices;

            var rsiEnabled =
                EffectiveMomentumOscillatorEnabled(DrawRsiMode != RsiVisualMode.Off, MomentumTechnicalComboMode.Rsi) &&
                ShouldUseNativeRsiIndicator();
            var stochasticEnabled =
                EffectiveMomentumOscillatorEnabled(DrawStochasticMode != StochasticVisualMode.Off, MomentumTechnicalComboMode.Stochastic) &&
                ShouldUseNativeStochasticIndicator();
            var stochRsiEnabled =
                EffectiveMomentumOscillatorEnabled(DrawStochRsiMode != StochRsiVisualMode.Off, MomentumTechnicalComboMode.StochRsi) &&
                ShouldDrawStochRsiIndicator();
            var macdEnabled =
                EffectiveMomentumOscillatorEnabled(DrawMacdMode != MacdVisualMode.Off, MomentumTechnicalComboMode.Macd) &&
                ShouldUseNativeMacdIndicator();
            var tickVolumeEnabled =
                rsiEnabled || stochasticEnabled || stochRsiEnabled || macdEnabled || ResolveLastExistingIndicatorPanelIndex() > 0;

            var signature = BuildOscillatorPanelSignature();
            if (string.Equals(_chartOscillatorSignature, signature, StringComparison.Ordinal) &&
                ((_chartRsiIndicator != null) == rsiEnabled) &&
                ((_chartStochasticIndicator != null) == stochasticEnabled) &&
                (!stochRsiEnabled || _chartRsiIndicator != null || _chartStochasticIndicator != null || _chartStochRsiHostIndicator != null) &&
                (!(_chartStochRsiHostIndicator != null) || stochRsiEnabled) &&
                ((_chartMacdIndicator != null) == macdEnabled) &&
                ((_chartTickVolumeIndicator != null) == tickVolumeEnabled))
            {
                // A timer refresh with unchanged configuration must not touch indicator
                // properties or remove/recreate level lines; cTrader repaints the entire
                // indicator area for those operations, which causes periodic chart flicker.
                RefreshManagedStochRsiSeries(false);
                return;
            }

            RemoveManagedOscillatorIndicators();

            var nextPanelIndex = ResolveOscillatorBasePanelIndex();
            var sharedRsiStochasticPanelIndex = nextPanelIndex;
            var sharedRsiStochasticPanelUsed = false;

            if (rsiEnabled)
            {
                _chartRsiIndicator = ChartIndicators.Add(
                    "Relative Strength Index",
                    new object[] { indicatorSeriesOsc, _resolvedRsiEventConfig.Period });
                if (_chartRsiIndicator != null)
                {
                    _chartRsiIndicator.PanelIndex = sharedRsiStochasticPanelIndex;
                    sharedRsiStochasticPanelUsed = true;
                }
            }

            if (stochasticEnabled)
            {
                _chartStochasticIndicator = ChartIndicators.Add(
                    "Stochastic Oscillator",
                    new object[]
                    {
                        _resolvedStochasticEventConfig.KPeriod,
                        _resolvedStochasticEventConfig.KSlowingPeriod,
                        _resolvedStochasticEventConfig.DPeriod,
                        MovingAverageType.Simple
                    });
                if (_chartStochasticIndicator != null)
                {
                    _chartStochasticIndicator.PanelIndex = sharedRsiStochasticPanelIndex;
                    sharedRsiStochasticPanelUsed = true;
                }
            }

            // Stoch RSI is calculated and drawn by this robot because cTrader has no
            // built-in Stochastic RSI indicator. If RSI/Stochastic did not already create
            // the shared oscillator pane, attach a transparent RSI solely as its host.
            if (stochRsiEnabled && !sharedRsiStochasticPanelUsed)
            {
                _chartStochRsiHostIndicator = ChartIndicators.Add(
                    "Relative Strength Index",
                    new object[] { indicatorSeriesOsc, 14 });
                if (_chartStochRsiHostIndicator != null)
                {
                    _chartStochRsiHostIndicator.PanelIndex = sharedRsiStochasticPanelIndex;
                    sharedRsiStochasticPanelUsed = true;
                }
            }

            if (sharedRsiStochasticPanelUsed)
                nextPanelIndex++;

            if (macdEnabled)
            {
                _chartMacdIndicator = ChartIndicators.Add(
                    "Macd Histogram",
                    new object[]
                    {
                        indicatorSeriesOsc,
                        _resolvedMacdEventConfig.SlowPeriod,
                        _resolvedMacdEventConfig.FastPeriod,
                        _resolvedMacdEventConfig.SignalPeriod
                    });
                if (_chartMacdIndicator != null)
                    _chartMacdIndicator.PanelIndex = nextPanelIndex++;
            }

            // Native cTrader Tick Volume shares the last occupied indicator pane. If the
            // chart has no subpanel, skip it instead of allocating a volume-only panel.
            var tickVolumePanelIndex = ResolveLastExistingIndicatorPanelIndex();
            if (tickVolumePanelIndex > 0)
            {
                try
                {
                    _chartTickVolumeIndicator = ChartIndicators.Add("Tick Volume", new object[0]);
                    if (_chartTickVolumeIndicator != null)
                        _chartTickVolumeIndicator.PanelIndex = tickVolumePanelIndex;
                }
                catch (Exception ex)
                {
                    SafePrint("[Visuals] Native Tick Volume unavailable: {0}", ex.Message);
                }
            }

            _chartOscillatorSignature = signature;
            ApplyManagedIndicatorLineStyles();
            SyncManagedOscillatorLevelLines();
            RefreshManagedStochRsiSeries(true);
        }

        private int ResolveOscillatorBasePanelIndex()
        {
            // PanelIndex 0 is the price chart; PanelIndex 1 is the second chart panel
            // (the first indicator pane). Reuse the lowest existing indicator pane so
            // RSI and Stochastic join panel 2 instead of allocating a new pane whenever
            // another indicator is already present.
            var existingPanelIndex = int.MaxValue;
            if (ChartIndicators != null)
            {
                foreach (var indicator in ChartIndicators)
                {
                    if (indicator != null && indicator.PanelIndex > 0)
                        existingPanelIndex = Math.Min(existingPanelIndex, indicator.PanelIndex);
                }
            }

            if (existingPanelIndex != int.MaxValue)
                return existingPanelIndex;

            // An IndicatorArea can exist before its ChartIndicator is exposed through the
            // collection. In that case, target its first pane explicitly; otherwise this
            // same index creates panel 2 exactly once.
            return 1;
        }

        private int ResolveLastExistingIndicatorPanelIndex()
        {
            var lastPanelIndex = 0;
            if (ChartIndicators == null)
                return lastPanelIndex;

            foreach (var indicator in ChartIndicators)
            {
                if (indicator == null || ReferenceEquals(indicator, _chartTickVolumeIndicator))
                    continue;
                if (indicator.PanelIndex > lastPanelIndex)
                    lastPanelIndex = indicator.PanelIndex;
            }

            return lastPanelIndex;
        }

        private void RemoveManagedOscillatorIndicators()
        {
            RemoveManagedStochRsiSeries();
            RemoveManagedOscillatorLevelLines();
            TryRemoveManagedChartIndicator(ref _chartRsiIndicator);
            TryRemoveManagedChartIndicator(ref _chartStochasticIndicator);
            TryRemoveManagedChartIndicator(ref _chartStochRsiHostIndicator);
            TryRemoveManagedChartIndicator(ref _chartMacdIndicator);
            TryRemoveManagedChartIndicator(ref _chartTickVolumeIndicator);
            RemoveStaleManagedOscillatorIndicators();
            _chartOscillatorSignature = "";
        }

        private bool IsStochRsiEffectivelyEnabled()
        {
            return EffectiveMomentumOscillatorEnabled(
                    DrawStochRsiMode != StochRsiVisualMode.Off,
                    MomentumTechnicalComboMode.StochRsi) &&
                ShouldDrawStochRsiIndicator();
        }

        private IndicatorArea ResolveManagedOscillatorIndicatorArea()
        {
            if (Chart == null || Chart.IndicatorAreas == null)
                return null;
            var indicator = _chartRsiIndicator ?? _chartStochasticIndicator ?? _chartStochRsiHostIndicator;
            if (indicator == null)
                return null;
            var areaIndex = indicator.PanelIndex - 1;
            return areaIndex >= 0 && areaIndex < Chart.IndicatorAreas.Count
                ? Chart.IndicatorAreas[areaIndex]
                : null;
        }

        private void ResolveStochRsiPeriods(out int rsiPeriod, out int stochasticPeriod, out int kSmoothing, out int dSmoothing)
        {
            var useSlow = DrawStochRsiMode == StochRsiVisualMode.SR21_21_3_3;
            rsiPeriod = useSlow ? 21 : 14;
            stochasticPeriod = useSlow ? 21 : 14;
            kSmoothing = 3;
            dSmoothing = 3;
        }

        private void RefreshManagedStochRsiSeries(bool force)
        {
            if (!IsStochRsiEffectivelyEnabled())
            {
                RemoveManagedStochRsiSeries();
                return;
            }
            var area = ResolveManagedOscillatorIndicatorArea();
            if (area == null || Bars == null || Bars.Count < 40)
                return;

            var lastIndex = Bars.Count - 2;
            var stateKey = string.Join(
                "|",
                new[]
                {
                    GetChartSymbolKey(),
                    GetChartTimeFrameKey(),
                    DrawStochRsiMode.ToString(),
                    Bars.OpenTimes[lastIndex].Ticks.ToString(CultureInfo.InvariantCulture),
                    BuildDirectionalPaletteStateKey()
                });
            if (!force && string.Equals(_lastStochRsiDrawKey, stateKey, StringComparison.Ordinal))
                return;

            RemoveManagedStochRsiSeries();
            int rsiPeriod;
            int stochasticPeriod;
            int kSmoothing;
            int dSmoothing;
            ResolveStochRsiPeriods(out rsiPeriod, out stochasticPeriod, out kSmoothing, out dSmoothing);
            var displayStart = Math.Max(rsiPeriod + stochasticPeriod + kSmoothing + dSmoothing, lastIndex - 220);
            var calculationStart = Math.Max(rsiPeriod, displayStart - stochasticPeriod - kSmoothing - dSmoothing - 4);
            var rsiValues = Enumerable.Repeat(double.NaN, Bars.Count).ToArray();
            var rawValues = Enumerable.Repeat(double.NaN, Bars.Count).ToArray();
            var kValues = Enumerable.Repeat(double.NaN, Bars.Count).ToArray();
            var dValues = Enumerable.Repeat(double.NaN, Bars.Count).ToArray();

            for (var index = calculationStart; index <= lastIndex; index++)
                rsiValues[index] = ComputeRelativeStrengthIndex(Bars, index, rsiPeriod);
            for (var index = calculationStart + stochasticPeriod - 1; index <= lastIndex; index++)
            {
                var window = rsiValues.Skip(index - stochasticPeriod + 1).Take(stochasticPeriod)
                    .Where(IsFiniteNumber).ToList();
                if (window.Count != stochasticPeriod)
                    continue;
                var minimum = window.Min();
                var maximum = window.Max();
                rawValues[index] = maximum > minimum
                    ? 100.0 * (rsiValues[index] - minimum) / (maximum - minimum)
                    : 50.0;
            }
            for (var index = calculationStart; index <= lastIndex; index++)
            {
                if (index - kSmoothing + 1 < 0)
                    continue;
                var values = rawValues.Skip(index - kSmoothing + 1).Take(kSmoothing).Where(IsFiniteNumber).ToList();
                if (values.Count == kSmoothing)
                    kValues[index] = values.Average();
            }
            for (var index = calculationStart; index <= lastIndex; index++)
            {
                if (index - dSmoothing + 1 < 0)
                    continue;
                var values = kValues.Skip(index - dSmoothing + 1).Take(dSmoothing).Where(IsFiniteNumber).ToList();
                if (values.Count == dSmoothing)
                    dValues[index] = values.Average();
            }

            var kColor = Color.FromArgb(230, 56, 189, 248);
            var dColor = Color.FromArgb(230, 250, 204, 21);
            for (var index = Math.Max(displayStart + 1, 1); index <= lastIndex; index++)
            {
                if (IsFiniteNumber(kValues[index - 1]) && IsFiniteNumber(kValues[index]))
                {
                    var name = "TVB_STOCHRSI_K_" + index.ToString(CultureInfo.InvariantCulture);
                    var line = CTraderChartEngine.Track(area, area.DrawTrendLine(name, Bars.OpenTimes[index - 1], kValues[index - 1], Bars.OpenTimes[index], kValues[index], kColor));
                    TrySetPropertyValue(line, "Thickness", 1);
                    TrySetPropertyValue(line, "ZIndex", 95);
                    _managedStochRsiIndicatorObjectNames.Add(name);
                }
                if (IsFiniteNumber(dValues[index - 1]) && IsFiniteNumber(dValues[index]))
                {
                    var name = "TVB_STOCHRSI_D_" + index.ToString(CultureInfo.InvariantCulture);
                    var line = CTraderChartEngine.Track(area, area.DrawTrendLine(name, Bars.OpenTimes[index - 1], dValues[index - 1], Bars.OpenTimes[index], dValues[index], dColor));
                    TrySetPropertyValue(line, "Thickness", 1);
                    TrySetEnumPropertyValue(line, "LineStyle", "Dots");
                    TrySetPropertyValue(line, "ZIndex", 95);
                    _managedStochRsiIndicatorObjectNames.Add(name);
                }
            }
            _lastStochRsiDrawKey = stateKey;
        }

        private void RemoveManagedStochRsiSeries()
        {
            if (Chart != null && Chart.IndicatorAreas != null)
            {
                foreach (var area in Chart.IndicatorAreas)
                {
                    if (area == null)
                        continue;
                    foreach (var name in _managedStochRsiIndicatorObjectNames)
                    {
                        try { area.RemoveObject(name); } catch { }
                    }
                }
            }
            _managedStochRsiIndicatorObjectNames.Clear();
            _lastStochRsiDrawKey = "";
        }

        private void SyncManagedOscillatorLevelLines()
        {
            RemoveManagedOscillatorLevelLines();
            if (Chart == null || Chart.IndicatorAreas == null)
                return;

            var panelIndex = _chartRsiIndicator != null
                ? _chartRsiIndicator.PanelIndex
                : _chartStochasticIndicator != null
                    ? _chartStochasticIndicator.PanelIndex
                    : _chartStochRsiHostIndicator != null
                        ? _chartStochRsiHostIndicator.PanelIndex
                    : -1;
            var areaIndex = panelIndex - 1;
            if (areaIndex < 0 || areaIndex >= Chart.IndicatorAreas.Count)
                return;

            var area = Chart.IndicatorAreas[areaIndex];
            if (area == null)
                return;

            if (_chartRsiIndicator != null)
            {
                var rsiLevelColor = Color.FromArgb(ResolveSurroundingBoxAlpha(), 250, 204, 21);
                DrawManagedOscillatorLevelLine(area, "TVB_OSC_RSI_30", _resolvedRsiEventConfig.Oversold, rsiLevelColor);
                DrawManagedOscillatorLevelLine(area, "TVB_OSC_RSI_50", _resolvedRsiEventConfig.Midline, rsiLevelColor);
                DrawManagedOscillatorLevelLine(area, "TVB_OSC_RSI_70", _resolvedRsiEventConfig.Overbought, rsiLevelColor);
            }

            if (_chartStochasticIndicator != null)
            {
                DrawManagedOscillatorLevelLine(area, "TVB_OSC_STO_20", _resolvedStochasticEventConfig.OversoldLevel, GetTechnicalBullishColor(AlphaFromPercent(50)));
                DrawManagedOscillatorLevelLine(area, "TVB_OSC_STO_80", _resolvedStochasticEventConfig.OverboughtLevel, GetTechnicalBearishColor(AlphaFromPercent(50)));
            }


            if (IsStochRsiEffectivelyEnabled())
            {
                if (_chartStochRsiHostIndicator != null && _chartRsiIndicator == null)
                {
                    var mask30 = CTraderChartEngine.Track(area, area.DrawHorizontalLine("TVB_OSC_STOCHRSI_HOST_30_MASK", 30.0, Chart.ColorSettings.BackgroundColor, 3, LineStyle.Solid));
                    var mask70 = CTraderChartEngine.Track(area, area.DrawHorizontalLine("TVB_OSC_STOCHRSI_HOST_70_MASK", 70.0, Chart.ColorSettings.BackgroundColor, 3, LineStyle.Solid));
                    TrySetPropertyValue(mask30, "ZIndex", 92);
                    TrySetPropertyValue(mask70, "ZIndex", 92);
                }
                var guideColor = Color.FromArgb(ResolveSurroundingBoxAlpha(), 147, 197, 253);
                DrawManagedOscillatorLevelLine(area, "TVB_OSC_STOCHRSI_20", 20.0, guideColor);
                DrawManagedOscillatorLevelLine(area, "TVB_OSC_STOCHRSI_50", 50.0, guideColor);
                DrawManagedOscillatorLevelLine(area, "TVB_OSC_STOCHRSI_80", 80.0, guideColor);
            }
        }

        private void DrawManagedOscillatorLevelLine(IndicatorArea area, string objectName, double level, Color color)
        {
            if (area == null || Chart == null)
                return;

            // Native oscillator levels are fixed cyan and cannot be restyled through
            // ChartIndicator.LineOutputs. Cover each native guide first, then draw our thin
            // dotted colored guide above it.
            var mask = CTraderChartEngine.Track(area, area.DrawHorizontalLine(objectName + "_MASK", level, Chart.ColorSettings.BackgroundColor, 3, LineStyle.Solid));
            TrySetPropertyValue(mask, "ZIndex", 90);
            var line = CTraderChartEngine.Track(area, area.DrawHorizontalLine(objectName, level, color, 1, LineStyle.Dots));
            TrySetPropertyValue(line, "ZIndex", 91);
        }

        private void RemoveManagedOscillatorLevelLines()
        {
            if (Chart == null || Chart.IndicatorAreas == null)
                return;

            var names = new[]
            {
                "TVB_OSC_RSI_30",
                "TVB_OSC_RSI_30_MASK",
                "TVB_OSC_RSI_70",
                "TVB_OSC_RSI_70_MASK",
                "TVB_OSC_RSI_50",
                "TVB_OSC_RSI_50_MASK",
                "TVB_OSC_STO_20",
                "TVB_OSC_STO_20_MASK",
                "TVB_OSC_STO_80",
                "TVB_OSC_STO_80_MASK",
                "TVB_OSC_STOCHRSI_20",
                "TVB_OSC_STOCHRSI_20_MASK",
                "TVB_OSC_STOCHRSI_50",
                "TVB_OSC_STOCHRSI_50_MASK",
                "TVB_OSC_STOCHRSI_80",
                "TVB_OSC_STOCHRSI_80_MASK",
                "TVB_OSC_STOCHRSI_HOST_30_MASK",
                "TVB_OSC_STOCHRSI_HOST_70_MASK"
            };
            foreach (var area in Chart.IndicatorAreas)
            {
                if (area == null)
                    continue;
                foreach (var name in names)
                {
                    try { area.RemoveObject(name); } catch { }
                }
            }
        }

        // Hides/shows the native RSI/Stoch/MACD panels without removing them (when the API
        // supports it). Returns false when no visibility switch could be applied, so the caller
        // falls back to removing them.
        private bool SetManagedOscillatorIndicatorsVisible(bool visible)
        {
            var allApplied = true;
            allApplied &= SetManagedChartIndicatorVisible(_chartRsiIndicator, visible);
            allApplied &= SetManagedChartIndicatorVisible(_chartStochasticIndicator, visible);
            allApplied &= SetManagedChartIndicatorVisible(_chartStochRsiHostIndicator, visible);
            allApplied &= SetManagedChartIndicatorVisible(_chartMacdIndicator, visible);
            return allApplied;
        }

        private void TryRemoveManagedChartIndicator(ref ChartIndicator indicator)
        {
            if (indicator == null || ChartIndicators == null)
            {
                indicator = null;
                return;
            }

            try
            {
                ChartIndicators.Remove(indicator);
            }
            catch
            {
            }

            indicator = null;
        }


        private void SyncChartTechnicalOverlays()
        {
            if (ChartIndicators == null)
                return;
            var chartBars = GetNativeChartIndicatorBars();
            if (chartBars == null || chartBars.Count < 5)
                return;
            var indicatorSeries = chartBars.ClosePrices;

            var signature = BuildTechnicalOverlaySignature();
            if (string.Equals(_chartTechnicalOverlaySignature, signature, StringComparison.Ordinal))
            {
                // Keep an unchanged timer pass read-only. Reapplying visibility and line
                // styles forces a native chart repaint even when every value is identical.
                return;
            }

            RemoveManagedTechnicalOverlays();

            const int pricePanel = 0;

            if (_toggleEmaOverlay && ShouldUseNativeEmaOverlay())
            {
                _chartEmaFastIndicator = AttachCalculatedNativeEma(chartBars, _resolvedEmaOverlayConfig.FastPeriod, out _displayEmaFast);
                _chartEmaMidIndicator = AttachCalculatedNativeEma(chartBars, _resolvedEmaOverlayConfig.MidPeriod, out _displayEmaMid);
                if (_resolvedEmaOverlayConfig.SlowPeriod > 0 && _resolvedEmaOverlayConfig.SlowPeriod != _resolvedEmaOverlayConfig.MidPeriod)
                {
                    _chartEmaSlowIndicator = AttachCalculatedNativeEma(chartBars, _resolvedEmaOverlayConfig.SlowPeriod, out _displayEmaSlow);
                }
                foreach (var ind in new[] { _chartEmaFastIndicator, _chartEmaMidIndicator, _chartEmaSlowIndicator })
                {
                    if (ind != null)
                        ind.PanelIndex = pricePanel;
                }
            }

            if (_toggleVwapOverlay && ShouldUseNativeVwapOverlay())
            {
                _chartVwapIndicator = ChartIndicators.Add(
                    "VWAP",
                    new object[] { _resolvedVwapOverlayConfig.Length });
                if (_chartVwapIndicator != null)
                    _chartVwapIndicator.PanelIndex = pricePanel;
            }

            if (_toggleBollingerOverlay && ShouldUseNativeBollingerOverlay())
            {
                _chartBollingerIndicator = ChartIndicators.Add(
                    "Bollinger Bands",
                    new object[]
                    {
                        indicatorSeries,
                        _resolvedBollingerOverlayConfig.Period,
                        _resolvedBollingerOverlayConfig.StdDevMultiplier,
                        MovingAverageType.Simple
                    });
                if (_chartBollingerIndicator != null)
                    _chartBollingerIndicator.PanelIndex = pricePanel;
            }

            if (_toggleIchimokuOverlay && ShouldUseNativeIchimokuOverlay())
            {
                // Passing Bars explicitly binds all OHLC outputs to the visible chart,
                // unlike the name-only Add overload, which has no Bars argument.
                _displayIchimoku = Indicators.IchimokuKinkoHyo(chartBars,
                    _resolvedIchimokuOverlayConfig.ConversionPeriod,
                    _resolvedIchimokuOverlayConfig.BasePeriod,
                    _resolvedIchimokuOverlayConfig.SpanBPeriod);
                var lastIndex = chartBars.Count - 1;
                if (_displayIchimoku != null &&
                    IsFiniteNumber(_displayIchimoku.TenkanSen[lastIndex]) &&
                    IsFiniteNumber(_displayIchimoku.KijunSen[lastIndex]))
                {
                    _chartIchimokuIndicator = _displayIchimoku.AddToChart();
                    if (_chartIchimokuIndicator != null)
                        PrintBypassLogFilter("[NativeDisplay] Ichimoku chart={0}/{1} bar={2:O} Tenkan={3} Kijun={4}",
                            Chart.SymbolName, Chart.TimeFrame, chartBars.OpenTimes[lastIndex],
                            _displayIchimoku.TenkanSen[lastIndex], _displayIchimoku.KijunSen[lastIndex]);
                }
                if (_chartIchimokuIndicator != null)
                    _chartIchimokuIndicator.PanelIndex = pricePanel;
            }

            if (_toggleDonchianOverlay && ShouldUseNativeDonchianOverlay())
            {
                _chartDonchianIndicator = ChartIndicators.Add(
                    "Donchian Channel",
                    new object[] { _resolvedDonchianOverlayConfig.Period });
                if (_chartDonchianIndicator != null)
                    _chartDonchianIndicator.PanelIndex = pricePanel;
            }

            ApplyManagedIndicatorLineStyles();
            // Keep successful native attachments instead of tearing them all down
            // on every timer pass when one indicator (for example VWAP) is unavailable.
            // A settings or chart-context change still retries the missing indicator.
            _chartTechnicalOverlaySignature = signature;
        }

        private ChartIndicator AttachCalculatedNativeEma(Bars chartBars, int period, out ExponentialMovingAverage calculation)
        {
            calculation = Indicators.ExponentialMovingAverage(chartBars.ClosePrices, period);
            // Accessing Result triggers the native lazy calculation even when the
            // market is closed and no tick arrives after the indicator is attached.
            if (calculation == null || !IsFiniteNumber(calculation.Result[chartBars.Count - 1]))
                return null;
            var attached = calculation.AddToChart();
            if (attached != null)
                PrintBypassLogFilter("[NativeDisplay] EMA {0} chart={1}/{2} bar={3:O} value={4}",
                    period, Chart.SymbolName, Chart.TimeFrame, chartBars.OpenTimes[chartBars.Count - 1],
                    calculation.Result[chartBars.Count - 1]);
            return attached;
        }

        // Native chart indicators otherwise retain cTrader's per-chart line settings. Apply our
        // visual defaults after every add/refresh so their appearance is deterministic.
        private void ApplyManagedIndicatorLineStyles()
        {
            var emaColor = Color.FromArgb(ResolveSurroundingBoxAlpha(), 255, 255, 255);
            // EMA is white at the configured BG alpha. EMA 200 is emphasized with a solid 2px line.
            ApplyIndicatorLineStyle(_chartEmaFastIndicator, emaColor, null, -1, LineStyle.Solid, null, false);
            ApplyIndicatorLineStyle(_chartEmaMidIndicator, emaColor, null, -1, LineStyle.Dots, null, false);
            ApplyIndicatorLineStyle(_chartEmaSlowIndicator, emaColor, null, -1, LineStyle.Solid, null, false, 2);
            ApplyIndicatorLineStyle(_chartVwapIndicator, Color.FromArgb(ResolveSurroundingBoxAlpha(), 250, 204, 21));
            ApplyIndicatorLineStyle(_chartBollingerIndicator, null, ResolveBollingerLineColor);
            ApplyIndicatorLineStyle(_chartIchimokuIndicator, null, ResolveIchimokuLineColor, -1, LineStyle.Solid, ResolveIchimokuLineStyle, false, 1);
            ApplyIchimokuLineVisibility(_chartIchimokuIndicator);
            ApplyIndicatorLineStyle(
                _chartDonchianIndicator,
                null,
                ResolveDonchianLineColor,
                -1,
                LineStyle.Solid,
                ResolveDonchianLineStyle,
                false,
                1);

            // Oscillator curves are stronger than their horizontal threshold guides:
            // RSI curve=100% with its 50 guide at 30%; Stochastic K/D=60% with levels=50%.
            ApplyIndicatorLineStyle(_chartRsiIndicator, null, ResolveRsiLineColor, -1, LineStyle.Solid);
            ApplyIndicatorLineStyle(_chartStochasticIndicator, null, ResolveStochasticLineColor, -1, LineStyle.Solid);
            ApplyIndicatorLineStyle(_chartStochRsiHostIndicator, Color.FromArgb(0, 0, 0, 0), null, -1, LineStyle.Solid);
            ApplyIndicatorLineStyle(_chartMacdIndicator, null, ResolveMacdLineColor);
        }

        private Color GetTechnicalBullishColor(int alpha)
        {
            return WithAlpha(SurroundingBoxBullishColor, ResolveLineVisualAlpha());
        }

        private Color GetTechnicalBearishColor(int alpha)
        {
            return WithAlpha(SurroundingBoxBearishColor, ResolveLineVisualAlpha());
        }

        private static int AlphaFromPercent(int percent)
        {
            return (int)Math.Round(Math.Max(0, Math.Min(100, percent)) * 2.55, MidpointRounding.AwayFromZero);
        }

        private Color ResolveBollingerLineColor(string lineName)
        {
            var name = (lineName ?? "").ToLowerInvariant();
            if (name.Contains("top") || name.Contains("upper"))
                return GetChartLineColor(Color.FromArgb(255, 168, 85, 247));
            if (name.Contains("bottom") || name.Contains("lower"))
                return GetChartLineColor(Color.FromArgb(255, 168, 85, 247));
            // The middle/MA line is intentionally hidden: the cloud/background already
            // communicates the band centre and avoids an extra competing line.
            return Color.FromArgb(0, 0, 0, 0);
        }

        private Color ResolveDonchianLineColor(string lineName)
        {
            // Donchian is a neutral channel, not a directional bull/bear overlay. Keep all
            // three outputs orange at the configured BG alpha.
            return Color.FromArgb(ResolveDonchianLineAlpha(lineName), 250, 204, 21);
        }

        private int ResolveDonchianLineAlpha(string lineName)
        {
            return ResolveSurroundingBoxAlpha();
        }

        private static LineStyle ResolveDonchianLineStyle(string lineName)
        {
            var name = (lineName ?? "").ToLowerInvariant();
            return name.Contains("middle") || name.Contains("median") || name.Contains("center")
                ? LineStyle.Dots
                : LineStyle.Solid;
        }

        private Color ResolveStochasticLineColor(string lineName)
        {
            var name = (lineName ?? "").ToLowerInvariant();
            if (name.Contains("20") || name.Contains("oversold") || name.Contains("lower") || name.Contains("bottom"))
                return GetTechnicalBullishColor(AlphaFromPercent(50));
            if (name.Contains("80") || name.Contains("overbought") || name.Contains("upper") || name.Contains("top"))
                return GetTechnicalBearishColor(AlphaFromPercent(50));
            var isDLine = name == "d" || name.EndsWith(" d", StringComparison.Ordinal) ||
                name.Contains("%d") || name.Contains("percent d") || name.Contains("signal");
            return isDLine
                ? GetTechnicalBearishColor(AlphaFromPercent(60))
                : GetTechnicalBullishColor(AlphaFromPercent(60));
        }

        private Color ResolveRsiLineColor(string lineName)
        {
            var name = (lineName ?? "").ToLowerInvariant();
            var isLevel = name.Contains("30") || name.Contains("70") ||
                name.Contains("oversold") || name.Contains("overbought") ||
                name.Contains("lower") || name.Contains("upper") ||
                name.Contains("bottom") || name.Contains("top");
            return Color.FromArgb(ResolveSurroundingBoxAlpha(), 250, 204, 21);
        }

        private Color ResolveMacdLineColor(string lineName)
        {
            var name = (lineName ?? "").ToLowerInvariant();
            return name.Contains("signal")
                ? GetTechnicalBearishColor(120)
                : GetTechnicalBullishColor(120);
        }

        private Color ResolveIchimokuLineColor(string lineName)
        {
            var name = (lineName ?? "").ToLowerInvariant();
            var compactName = name.Replace(" ", "").Replace("_", "").Replace("-", "");
            if (name.Contains("tenkan") || name.Contains("conversion"))
                return Color.FromArgb(ResolveSurroundingBoxAlpha(), 0, 128, 0);
            if (name.Contains("kijun") || name.Contains("base"))
                return Color.FromArgb(ResolveSurroundingBoxAlpha(), 255, 0, 0);
            if (name.Contains("chikou") || name.Contains("lagging"))
                return Color.FromArgb(ResolveSurroundingBoxAlpha(), 56, 189, 248);
            if (compactName.Contains("spanb") || compactName.Contains("leadingb"))
                return WithAlpha(SurroundingBoxBearishColor, ResolveIchimokuCloudAlpha());
            if (compactName.Contains("spana") || compactName.Contains("leadinga"))
                return WithAlpha(SurroundingBoxBullishColor, ResolveIchimokuCloudAlpha());
            return Color.FromArgb(0, 0, 0, 0);
        }

        private static LineStyle ResolveIchimokuLineStyle(string lineName)
        {
            var name = (lineName ?? "").ToLowerInvariant();
            if (name.Contains("kijun") || name.Contains("base"))
                return LineStyle.Dots;
            if (name.Contains("chikou") || name.Contains("lagging"))
                return LineStyle.Lines;
            return LineStyle.Solid;
        }

        private int ResolveScaledBackgroundAlpha(double multiplier)
        {
            var backgroundPercent = Math.Max(0, Math.Min(100, SurroundingBoxBackgroundAlpha));
            var scaledPercent = (int)Math.Round(backgroundPercent * Math.Max(0.0, multiplier), MidpointRounding.AwayFromZero);
            return AlphaFromPercent(Math.Min(100, scaledPercent));
        }

        private static void ApplyIchimokuLineVisibility(ChartIndicator indicator)
        {
            if (indicator == null || indicator.LineOutputs == null)
                return;

            foreach (var line in indicator.LineOutputs)
            {
                if (line == null)
                    continue;

                var name = (line.Name ?? "").ToLowerInvariant();
                var compactName = name.Replace(" ", "").Replace("_", "").Replace("-", "");
                if (name.Contains("tenkan") || name.Contains("conversion") ||
                    name.Contains("kijun") || name.Contains("base") ||
                    name.Contains("chikou") || name.Contains("lagging"))
                {
                    TryApplyPropertyValue(line, "IsVisible", true);
                    line.Thickness = 1;
                }
                else if (compactName.Contains("spana") || compactName.Contains("spanb") ||
                         compactName.Contains("leadinga") || compactName.Contains("leadingb"))
                {
                    // cTrader keeps the native Kumo fill even when its two boundary outputs
                    // are hidden, matching the requested line-only Tenkan/Kijun/Chikou view.
                    TryApplyPropertyValue(line, "IsVisible", false);
                }
            }
        }

        private int ResolveIchimokuCloudAlpha()
        {
            // Native cTrader derives the Kumo fill from the Senkou line colours. Never
            // return alpha zero for those lines, even when another background visual is off.
            return Math.Max(AlphaFromPercent(20), ResolveSurroundingBoxAlpha());
        }

        private void ApplyIndicatorLineStyle(
            ChartIndicator indicator,
            Color color = null,
            Func<string, Color> colorSelector = null,
            int alpha = -1,
            LineStyle lineStyle = LineStyle.Dots,
            Func<string, LineStyle> lineStyleSelector = null,
            bool useSharedLineOpacity = true,
            int thickness = 1)
        {
            if (indicator == null || indicator.LineOutputs == null)
                return;

            foreach (var line in indicator.LineOutputs)
            {
                if (line == null)
                    continue;
                line.LineStyle = lineStyleSelector != null ? lineStyleSelector(line.Name) : lineStyle;
                line.Thickness = Math.Max(1, thickness);
                // Restore persistent per-output visibility when the bot owns the style.
                // Ichimoku's intentionally hidden span boundaries are applied afterwards.
                line.IsVisible = true;
                if (colorSelector != null)
                    line.Color = useSharedLineOpacity ? GetChartLineColor(colorSelector(line.Name)) : colorSelector(line.Name);
                else if (color != null)
                    line.Color = useSharedLineOpacity ? GetChartLineColor(color) : color;
                else if (alpha >= 0)
                    line.Color = useSharedLineOpacity ? GetChartLineColor(line.Color) : WithAlpha(line.Color, alpha);
            }
        }

        private void RemoveManagedTechnicalOverlays()
        {
            TryRemoveManagedChartIndicator(ref _chartEmaFastIndicator);
            TryRemoveManagedChartIndicator(ref _chartEmaMidIndicator);
            TryRemoveManagedChartIndicator(ref _chartEmaSlowIndicator);
            TryRemoveManagedChartIndicator(ref _chartVwapIndicator);
            TryRemoveManagedChartIndicator(ref _chartBollingerIndicator);
            TryRemoveManagedChartIndicator(ref _chartIchimokuIndicator);
            TryRemoveManagedChartIndicator(ref _chartDonchianIndicator);
            _displayEmaFast = null;
            _displayEmaMid = null;
            _displayEmaSlow = null;
            _displayIchimoku = null;
            _chartTechnicalOverlaySignature = "";
        }

        // Hides/shows the native EMA/VWAP/Bollinger/Ichimoku/Donchian indicators without removing them,
        // so All Custom can take over visually and switching back is instant and cheap. Returns
        // false when the API exposes no working visibility switch (caller then removes them).
        private bool SetManagedTechnicalOverlaysVisible(bool visible)
        {
            var allApplied = true;
            allApplied &= SetManagedChartIndicatorVisible(_chartEmaFastIndicator, visible);
            allApplied &= SetManagedChartIndicatorVisible(_chartEmaMidIndicator, visible);
            allApplied &= SetManagedChartIndicatorVisible(_chartEmaSlowIndicator, visible);
            allApplied &= SetManagedChartIndicatorVisible(_chartVwapIndicator, visible);
            allApplied &= SetManagedChartIndicatorVisible(_chartBollingerIndicator, visible);
            allApplied &= SetManagedChartIndicatorVisible(_chartIchimokuIndicator, visible);
            allApplied &= SetManagedChartIndicatorVisible(_chartDonchianIndicator, visible);
            return allApplied;
        }

        private static bool SetManagedChartIndicatorVisible(ChartIndicator indicator, bool visible)
        {
            if (indicator == null)
                return true;

            // Try every visibility mechanism the API may expose; the caller falls back to
            // removing the indicator if none of them can be applied.
            var applied = TryApplyPropertyValue(indicator, "IsVisible", visible);
            applied |= TryApplyPropertyValue(indicator, "Opacity", visible ? 1.0 : 0.0);
            applied |= TryApplyPropertyValue(indicator, "IsEnabled", visible);
            var chartObject = TryGetPropertyValue(indicator, "ChartObject");
            if (chartObject != null)
                applied |= TryApplyPropertyValue(chartObject, "IsVisible", visible);
            return applied;
        }

        private static bool TryApplyPropertyValue(object target, string propertyName, object value)
        {
            if (target == null || string.IsNullOrWhiteSpace(propertyName) || value == null)
                return false;
            try
            {
                var prop = target.GetType().GetProperty(propertyName);
                if (prop == null || !prop.CanWrite)
                    return false;
                var targetType = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;
                object converted = value;
                if (targetType != value.GetType())
                    converted = Convert.ChangeType(value, targetType, CultureInfo.InvariantCulture);
                prop.SetValue(target, converted, null);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private bool NativeEmaOverlayActive()
        {
            if (!_toggleEmaOverlay || !ShouldUseNativeEmaOverlay())
                return false;
            var slowRequired = _resolvedEmaOverlayConfig.SlowPeriod > 0 &&
                _resolvedEmaOverlayConfig.SlowPeriod != _resolvedEmaOverlayConfig.MidPeriod;
            return _chartEmaFastIndicator != null &&
                _chartEmaMidIndicator != null &&
                (!slowRequired || _chartEmaSlowIndicator != null);
        }

        private bool NativeVwapOverlayActive()
        {
            return _toggleVwapOverlay && ShouldUseNativeVwapOverlay() && _chartVwapIndicator != null;
        }

        private bool NativeBollingerOverlayActive()
        {
            return _toggleBollingerOverlay && ShouldUseNativeBollingerOverlay() && _chartBollingerIndicator != null;
        }

        private bool NativeIchimokuOverlayActive()
        {
            return _toggleIchimokuOverlay && ShouldUseNativeIchimokuOverlay() && _chartIchimokuIndicator != null;
        }

        private bool NativeDonchianOverlayActive()
        {
            return _toggleDonchianOverlay && ShouldUseNativeDonchianOverlay() && _chartDonchianIndicator != null;
        }

        // True when every enabled overlay is rendered by a native chart indicator, so the
        // per-bar custom drawing can be skipped. Any failed native Add falls back to custom.
        private bool NativeTechnicalOverlaysActive()
        {
            if (_toggleEmaOverlay && !NativeEmaOverlayActive())
                return false;
            if (_toggleVwapOverlay && !NativeVwapOverlayActive())
                return false;
            if (_toggleBollingerOverlay && !NativeBollingerOverlayActive())
                return false;
            if (_toggleIchimokuOverlay && !NativeIchimokuOverlayActive())
                return false;
            if (_toggleDonchianOverlay && !NativeDonchianOverlayActive())
                return false;
            return true;
        }

        private string BuildTechnicalOverlaySignature()
        {
            return string.Join("|",
                GetChartSymbolKey(),
                GetChartTimeFrameKey(),
                _toggleEmaOverlay,
                ShouldUseNativeEmaOverlay(),
                _resolvedEmaOverlayConfig.FastPeriod,
                _resolvedEmaOverlayConfig.MidPeriod,
                _resolvedEmaOverlayConfig.SlowPeriod,
                _toggleVwapOverlay,
                ShouldUseNativeVwapOverlay(),
                _resolvedVwapOverlayConfig.Length,
                _toggleBollingerOverlay,
                ShouldUseNativeBollingerOverlay(),
                _resolvedBollingerOverlayConfig.Period,
                _resolvedBollingerOverlayConfig.StdDevMultiplier,
                _toggleIchimokuOverlay,
                ShouldUseNativeIchimokuOverlay(),
                _resolvedIchimokuOverlayConfig.ConversionPeriod,
                _resolvedIchimokuOverlayConfig.BasePeriod,
                _resolvedIchimokuOverlayConfig.SpanBPeriod,
                _toggleDonchianOverlay,
                ShouldUseNativeDonchianOverlay(),
                _resolvedDonchianOverlayConfig.Period,
                BuildDirectionalPaletteStateKey());
        }

        // cTrader keeps ChartIndicator handles alive when the visible chart is switched to a
        // different symbol or timeframe, but their output series can become detached from the
        // new chart. The titles remain visible while every plotted value disappears. Detect that
        // context transition and recreate the managed native indicators against the visible bars.

        private string BuildDirectionalPaletteStateKey()
        {
            return string.Format(
                CultureInfo.InvariantCulture,
                "palette:{0}:{1}:a{2}",
                SurroundingBoxBullishColor,
                SurroundingBoxBearishColor,
                ResolveSurroundingBoxAlpha());
        }

        // cTrader applies parameter edits to the running robot without necessarily recreating
        // native chart indicators. Detect that edit explicitly, restyle/recreate the native
        // overlays, and force one full chart-object repaint immediately.

        private void RemoveStaleManagedOscillatorIndicators()
        {
            if (ChartIndicators == null)
                return;

            var removable = new List<ChartIndicator>();
            foreach (var indicator in ChartIndicators)
            {
                if (indicator == null)
                    continue;

                var name = (indicator.Name ?? string.Empty).Trim();
                if (string.Equals(name, "Relative Strength Index", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(name, "Stochastic Oscillator", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(name, "Macd Histogram", StringComparison.OrdinalIgnoreCase))
                {
                    removable.Add(indicator);
                }
            }

            foreach (var indicator in removable)
            {
                try
                {
                    ChartIndicators.Remove(indicator);
                }
                catch
                {
                }
            }
        }


        private struct EmaIndicatorConfig
        {
            public int PriceCrossPeriod;
            public int FastPeriod;
            public int MidPeriod;
            public int SlowPeriod;
        }

        private struct VwapIndicatorConfig
        {
            public int Length;
        }

        private struct BollingerIndicatorConfig
        {
            public int Period;
            public double StdDevMultiplier;
        }

        private struct IchimokuIndicatorConfig
        {
            public int ConversionPeriod;
            public int BasePeriod;
            public int SpanBPeriod;
        }

        private struct DonchianIndicatorConfig
        {
            public int Period;
        }

        private struct RsiIndicatorConfig
        {
            public int Period;
            public double Midline;
            public double Oversold;
            public double Overbought;
        }

        private struct StochasticIndicatorConfig
        {
            public int KPeriod;
            public int KSlowingPeriod;
            public int DPeriod;
            public int OversoldLevel;
            public int OverboughtLevel;
        }

        private struct MacdIndicatorConfig
        {
            public int FastPeriod;
            public int SlowPeriod;
            public int SignalPeriod;
        }

        private struct AdxIndicatorConfig
        {
            public int Period;
            public double MinimumStrength;
        }

        private Bars GetNativeChartIndicatorBars()
        {
            if (Chart == null)
                return base.Bars;
            var nativeBars = base.Bars;
            if (nativeBars != null && nativeBars.TimeFrame == Chart.TimeFrame &&
                string.Equals(NormalizeSymbolAlias(nativeBars.SymbolName),
                    NormalizeSymbolAlias(Chart.SymbolName), StringComparison.OrdinalIgnoreCase))
                return nativeBars;
            if (string.IsNullOrWhiteSpace(Chart.SymbolName) || Chart.TimeFrame == null)
                return null;
            return MarketData.GetBars(Chart.TimeFrame, Chart.SymbolName);
        }

    }
}
