using System;
using System.Globalization;
using cAlgo.API;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    // Chart-only host for the verbatim Momentum Technical code extracted from TVBridgeCBot.
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.None, AddIndicators = true)]
    public partial class MomentumTechnical : Robot
    {
        [Parameter("Momentum Technical", Group = "Chart Visuals", DefaultValue = MomentumTechnicalComboMode.PerItem)]
        public MomentumTechnicalComboMode MomentumTechnicalCombo { get; set; }

        [Parameter("Bearish color", Group = "Chart Visuals", DefaultValue = "#FFE53935")]
        public Color SurroundingBoxBearishColor { get; set; }

        [Parameter("Bullish color", Group = "Chart Visuals", DefaultValue = "#FF43A047")]
        public Color SurroundingBoxBullishColor { get; set; }

        [Parameter("BG alpha", Group = "Chart Visuals", DefaultValue = 50, MinValue = 0, MaxValue = 100, Step = 1)]
        public int SurroundingBoxBackgroundAlpha { get; set; }

        private bool _toggleEmaOverlay;
        private bool _toggleVwapOverlay;
        private bool _toggleBollingerOverlay;
        private bool _toggleIchimokuOverlay;
        private bool _toggleDonchianOverlay;
        private string _settingsKey = "";
        private string _chartKey = "";

        protected override void OnStart()
        {
            RefreshTechnicalSettings();
            SyncChartTechnicalOverlays();
            SyncChartOscillatorIndicators();
            Timer.Start(5);
        }

        protected override void OnTimer()
        {
            var chartKey = GetChartSymbolKey() + "|" + GetChartTimeFrameKey();
            if (!string.Equals(_chartKey, chartKey, StringComparison.Ordinal))
            {
                RemoveManagedTechnicalOverlays();
                RemoveManagedOscillatorIndicators();
                _chartKey = chartKey;
            }
            RefreshTechnicalSettings();
            SyncChartTechnicalOverlays();
            SyncChartOscillatorIndicators();
        }

        protected override void OnStop()
        {
            RemoveManagedTechnicalOverlays();
            RemoveManagedOscillatorIndicators();
        }

        private void RefreshTechnicalSettings()
        {
            var settingsKey = string.Join("|", MomentumTechnicalCombo, DrawEmaOverlay, DrawVwapOverlay,
                DrawBollingerOverlay, DrawIchimokuOverlay, DrawDonchianOverlay, DrawRsiMode,
                DrawStochasticMode, DrawStochRsiMode, DrawMacdMode, DrawAdxMode,
                SurroundingBoxBearishColor, SurroundingBoxBullishColor, SurroundingBoxBackgroundAlpha);
            if (string.Equals(_settingsKey, settingsKey, StringComparison.Ordinal))
                return;
            _settingsKey = settingsKey;
            _chartTechnicalOverlaySignature = "";
            _chartOscillatorSignature = "";
            ApplyMomentumTechnicalCombo();
            _resolvedEmaOverlayConfig = ResolveEmaIndicatorConfig(DrawEmaOverlay, false);
            _resolvedVwapOverlayConfig = ResolveVwapIndicatorConfig(DrawVwapOverlay);
            _resolvedBollingerOverlayConfig = ResolveBollingerIndicatorConfig(DrawBollingerOverlay);
            _resolvedIchimokuOverlayConfig = ResolveIchimokuIndicatorConfig(DrawIchimokuOverlay);
            _resolvedDonchianOverlayConfig = ResolveDonchianIndicatorConfig(DrawDonchianOverlay);
            _resolvedRsiEventConfig = ResolveRsiIndicatorConfig(DrawRsiMode);
            _resolvedStochasticEventConfig = ResolveStochasticIndicatorConfig(DrawStochasticMode);
            _resolvedMacdEventConfig = ResolveMacdIndicatorConfig(DrawMacdMode);
            _resolvedAdxConfig = ResolveAdxIndicatorConfig(DrawAdxMode);
        }

        private string GetChartSymbolKey() => Chart == null ? SymbolName : Chart.SymbolName;
        private string GetChartTimeFrameKey() => Chart == null ? TimeFrame.ToString() : Chart.TimeFrame.ToString();
        private static string NormalizeSymbolAlias(string value) => (value ?? "").Trim();
        private static bool IsFiniteNumber(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
        private void PrintBypassLogFilter(string format, params object[] values) => Print(format, values);
        private void SafePrint(string format, params object[] values) => Print(format, values);
        private int ResolveSurroundingBoxAlpha() => AlphaFromPercent(SurroundingBoxBackgroundAlpha);
        private int ResolveLineVisualAlpha() => 255;
        private static Color WithAlpha(Color color, int alpha) => Color.FromArgb(alpha, color.R, color.G, color.B);
        private static Color GetChartLineColor(Color color) => color;
        private static object TryGetPropertyValue(object target, string name)
        {
            try { return target?.GetType().GetProperty(name)?.GetValue(target, null); }
            catch { return null; }
        }
    }
}
