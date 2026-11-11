using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading;
using cAlgo.API;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    public partial class TVBridgeCBot
    {
        private const string AtrEmaStrategyId = "atr_ema_pullback_v1";
        private string _atrEmaOwnerToken;

        private void ResetAtrEmaRuntime() { _atrEmaOwnerToken = null; }

        private string GetAtrEmaOwnerToken()
        {
            if (_atrEmaOwnerToken != null) return _atrEmaOwnerToken;
            if (IsBacktestingRuntime()) return _atrEmaOwnerToken = Guid.NewGuid().ToString("N").Substring(0, 12);
            try
            {
                const string key = "atr-ema-owner-v1";
                var token = LocalStorage.GetString(key, LocalStorageScope.Instance);
                if (string.IsNullOrWhiteSpace(token))
                {
                    token = Guid.NewGuid().ToString("N").Substring(0, 12);
                    LocalStorage.SetString(key, token, LocalStorageScope.Instance);
                    LocalStorage.Flush(LocalStorageScope.Instance);
                }
                return _atrEmaOwnerToken = token;
            }
            catch (Exception ex)
            {
                SafePrint("[AtrEma] Owner identity unavailable: {0}", ex.Message);
                return _atrEmaOwnerToken = "";
            }
        }

        private static bool IsAtrEmaFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        private bool TryBuildAtrEmaPullbackSignal(Symbol symbol, Bars bars, TimeFrame frame, int index,
            out BacktestStrategySignal signal)
        {
            signal = default(BacktestStrategySignal);
            if (symbol == null || bars == null || TimeFrameToMinutes(frame) != 5 ||
                TimeFrameToMinutes(bars.TimeFrame) != 5 || bars.SymbolName != symbol.Name ||
                !symbol.Name.StartsWith("XAUUSD", StringComparison.OrdinalIgnoreCase)) return false;
            var fast = StrategyDataPeriod("fast_period", 20);
            var mid = StrategyDataPeriod("mid_period", 50);
            var slow = StrategyDataPeriod("slow_period", 200);
            var atrPeriod = StrategyDataPeriod("atr_period", 14);
            var meanPeriod = StrategyDataPeriod("atr_mean_period", 50);
            var window = StrategyDataPeriod("pullback_bars", 5);
            if (!(fast < mid && mid < slow) || index < Math.Max(slow, atrPeriod + meanPeriod) ||
                index >= bars.Count) return false;

            var emaFast = ComputeExponentialMovingAverage(bars, index, fast);
            var emaMid = ComputeExponentialMovingAverage(bars, index, mid);
            var emaSlow = ComputeExponentialMovingAverage(bars, index, slow);
            var close = bars.ClosePrices[index];
            var buy = emaFast > emaMid && emaMid > emaSlow && close > emaSlow;
            var sell = emaFast < emaMid && emaMid < emaSlow && close < emaSlow;
            if (!buy && !sell) return false;
            var side = buy ? TradeType.Buy : TradeType.Sell;
            if (!IsAtrEmaConfirmation(bars, index, emaFast, buy)) return false;

            // Same shared ATR/EMA cache as other native strategies: no display indicator dependency.
            var atr = ComputeAverageTrueRangeAtIndex(bars, index, atrPeriod);
            var atrMean = 0.0;
            for (var i = index - meanPeriod + 1; i <= index; i++)
            {
                var value = ComputeAverageTrueRangeAtIndex(bars, i, atrPeriod);
                if (!IsAtrEmaFinite(value) || value <= 0) return false;
                atrMean += value / meanPeriod;
            }
            if (!(atr > atrMean * StrategyDataNumber("atr_relative_min", 1.0))) return false;
            var maxRange = StrategyDataNumber("max_candle_atr", 2.0);
            if (!(maxRange > 0) || bars.HighPrices[index] - bars.LowPrices[index] > maxRange * atr)
                return false;

            // Find an earlier touch, approached from the trend side. Only the first
            // confirming close after that touch qualifies; later continuation bars do not.
            var touch = -1;
            for (var i = index - 1; i >= Math.Max(slow, index - window); i--)
            {
                var f = ComputeExponentialMovingAverage(bars, i, fast);
                var m = ComputeExponentialMovingAverage(bars, i, mid);
                var s = ComputeExponentialMovingAverage(bars, i, slow);
                if (buy ? !(f > m && m > s && bars.ClosePrices[i] > s)
                    : !(f < m && m < s && bars.ClosePrices[i] < s)) break;
                if (IsAtrEmaConfirmation(bars, i, f, buy)) return false;
                var previousFast = ComputeExponentialMovingAverage(bars, i - 1, fast);
                var approached = buy ? bars.ClosePrices[i - 1] > previousFast
                    : bars.ClosePrices[i - 1] < previousFast;
                if (approached && bars.LowPrices[i] <= Math.Max(f, m) &&
                    bars.HighPrices[i] >= Math.Min(f, m))
                { touch = i; break; }
            }
            if (touch < 0) return false;
            // Seed valid candle geometry only. The shared planner replaces entry,
            // SL and TP using the selected Trade Config before charting or submission.
            var entry = NormalizePriceToSymbol(symbol, close);
            var sl = NormalizePriceToSymbol(symbol, buy ? bars.LowPrices[index] : bars.HighPrices[index]);
            var risk = Math.Abs(entry - sl);
            if (!(risk > 0)) return false;
            signal = CTraderStrategyEngine.CreateSignal(AtrEmaStrategyId, BacktestStrategyMode.AtrEmaPullbackV1,
                symbol.Name, "m5.atr_ema_pullback", side, frame, bars.OpenTimes[index]);
            signal.EntryPrice = signal.OriginalEntryReference = entry;
            signal.StopLoss = signal.OriginalInvalidationPrice = sl;
            signal.TakeProfit = NormalizePriceToSymbol(symbol, entry + (buy ? risk : -risk));
            signal.OriginalRiskDistance = signal.EventSlDistance = risk;
            signal.ConfluenceRulesOverride = new List<StrategyCustomRuleOption>();
            PopulateIndicatorEventCandleBounds(bars, index, ref signal);
            signal.Note = signal.TriggerAudit = string.Format(CultureInfo.InvariantCulture,
                "ema={0:R}/{1:R}/{2:R};atr={3:R};atr_mean={4:R};pullback={5:O};trade_config=shared",
                emaFast, emaMid, emaSlow, atr, atrMean, bars.OpenTimes[touch]);
            return signal.IsValid;
        }

        private static bool IsAtrEmaConfirmation(Bars bars, int index, double emaFast, bool buy)
        {
            return buy ? bars.ClosePrices[index] > bars.OpenPrices[index] && bars.ClosePrices[index] > emaFast
                : bars.ClosePrices[index] < bars.OpenPrices[index] && bars.ClosePrices[index] < emaFast;
        }

        private void RecordAtrEmaSharedEntry(BacktestStrategySignal signal, TradeResult result,
            string symbolName, string label, double entry, double sl, double tp,
            double riskPercent, double riskMoney, double units, int leg)
        {
            if (signal.StrategyMode != BacktestStrategyMode.AtrEmaPullbackV1 || result == null ||
                !result.IsSuccessful || result.Position == null && result.PendingOrder == null) return;
            var preset = ResolveStrategyTradeChainPreset(signal);
            var json = SerializeJsonValue(new Dictionary<string, object>
            {
                {"version", 2}, {"kind", "entry"}, {"strategy", AtrEmaStrategyId}, {"build", BuildVersion},
                {"ticket", result.Position != null ? result.Position.Id : result.PendingOrder.Id},
                {"label", label}, {"symbol", symbolName}, {"leg", leg},
                {"signal_time_utc", signal.SignalTime.ToString("O")},
                {"submitted_time_utc", NormalizeBotTimeToUtc(Server.Time).ToString("O")},
                {"event", signal.SourceLabel}, {"side", signal.TradeType == TradeType.Buy ? "BUY" : "SELL"},
                {"entry", entry}, {"sl", sl}, {"tp", tp}, {"risk_percent", riskPercent},
                {"risk_money", riskMoney}, {"volume_units", units}, {"full_events", signal.TriggerAudit},
                {"source_timeframe", GetMiniChartLabel(signal.SourceTimeFrame)},
                {"event_candle_low", signal.EventCandleLow}, {"event_candle_high", signal.EventCandleHigh},
                {"event_candle_open", signal.EventCandleOpen}, {"event_candle_close", signal.EventCandleClose},
                {"event_candle_tick_volume", signal.EventCandleTickVolume},
                {"entry_mode", preset.EntryMode.ToString()},
                {"sl_mode", preset.StopLossMode.ToString()},
                {"sl_buffer", SelectedStrategyStopLossBufferMode.ToString()},
                {"tp_mode", preset.TakeProfitMode.ToString()},
                {"exit_mode", SelectedStrategyExitMode.ToString()},
                {"trailing_method", SelectedRrLadderSlStep.ToString()},
                {"partial_close_plan", SelectedRrLadderClosePlan.ToString()},
                {"split_count", preset.NumberOfTrades},
                {"trade_plan", preset.RawMode.ToString()},
                {"risk_sizing", SelectedAdaptiveRiskMode.ToString()},
                {"trade_config", "shared"}, {"volume_filter", "disabled"}, {"htf_filter", "not_required"}
            });
            AppendAtrEmaEvidence(json);
            PrintAlways("[TradeEvidenceJson] {0}", json);
        }

        private void AppendAtrEmaEvidence(string json)
        {
            try
            {
                var directory = Path.Combine(GetBaseServerRootPath(), "backtest-evidence", AtrEmaStrategyId);
                Directory.CreateDirectory(directory);
                // One durable audit per instance/run, independent of native log trimming.
                System.IO.File.AppendAllText(Path.Combine(directory, GetAtrEmaOwnerToken() + ".jsonl"), json + Environment.NewLine);
            }
            catch (Exception ex)
            {
                PrintAlways("[AtrEma][EvidenceError] {0}", ex.Message);
            }
        }

    }
}
