using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using cAlgo.API;
using cAlgo.API.Internals;

namespace cAlgo.Plugins
{
    [Plugin(AccessRights = AccessRights.None)]
    public class BacktestWorkerPlugin : Plugin
    {
        [Parameter("42trade API", DefaultValue = "http://127.0.0.1:3001")]
        public string ApiBase { get; set; }

        [Parameter("API Key", DefaultValue = "")]
        public string ApiKey { get; set; }

        [Parameter("Worker ID", DefaultValue = "ctrader-local")]
        public string WorkerId { get; set; }

        [Parameter("Max Parallel", DefaultValue = 3, MinValue = 1, MaxValue = 10)]
        public int MaxParallel { get; set; }

        [Parameter("Poll Seconds", DefaultValue = 3, MinValue = 1, MaxValue = 60)]
        public int PollSeconds { get; set; }

        private readonly object _sync = new object();
        private readonly Dictionary<BacktestingProcess, JobContext> _active =
            new Dictionary<BacktestingProcess, JobContext>();
        private static readonly Dictionary<string, string> ParameterAliases =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["rulesprofile"] = "SelectedRiskTemplate",
                ["mdayloss"] = "MaxDailyLossPreset",
                ["mdaywin"] = "MaxDailyWinPreset",
                ["mdd"] = "MaxEquityDrawdownPreset",
                ["mriskcbottrade"] = "MaxRiskPreset",
                ["symbols"] = "StrategySymbols",
                ["timeframes"] = "StrategyTimeframes",
                ["newsblock"] = "SelectedNewsBlockPreset",
                ["1sttrade"] = "FirstTradeMode",
                ["2ndtrade"] = "SecondTradeMode",
                ["3rdtrade"] = "ThirdTradeMode",
                ["ntrades"] = "StrategyOrderCount",
                ["entry"] = "SelectedStrategyEntryType",
                ["sl"] = "SelectedStrategyStopLossMode",
                ["tp"] = "SelectedStrategyTakeProfitMode",
                ["exitmode"] = "SelectedStrategyExitMode",
                ["enabletrade"] = "EnableLiveStrategyTrading",
                ["enabledebug"] = "EnableStrategyDebug",
                ["strategy"] = "SelectedBacktestStrategy",
                ["strategy2"] = "SelectedBacktestStrategy2",
                ["strategy3"] = "SelectedBacktestStrategy3",
                ["strategy4"] = "SelectedBacktestStrategy4",
                ["strategy5"] = "SelectedBacktestStrategy5"
            };
        private static readonly Dictionary<string, string[]> KnownEnumValues =
            new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
            {
                ["SelectedRiskTemplate"] = new[]
                {
                    "Custom", "FTMO_1Step", "FTMO_2Step", "The5ers_HighStakes",
                    "FundedNext_Stellar_2Step", "FundedNext_Stellar_1Step",
                    "FundedNext_Stellar_Lite", "FTPlus_1Step_Express"
                },
                ["MaxDailyLossPreset"] = RiskLimitPresetNames(),
                ["MaxDailyWinPreset"] = RiskLimitPresetNames(),
                ["MaxEquityDrawdownPreset"] = RiskLimitPresetNames(),
                ["MaxRiskPreset"] = RiskLimitPresetNames(),
                ["StrategyOrderCount"] = new[] { "Auto", "_1", "_2", "_3", "_4", "_5" },
                ["SelectedStrategyEntryType"] = new[]
                {
                    "market", "L0", "L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08",
                    "L00_025R", "L00_05R", "L00_075R", "candle_mid", "candle_retest",
                    "ltf_Key_levels", "HTF_Key_levels", "fvg_mid", "ob_mid", "breakout_close",
                    "reclaim_retest", "L00_01", "L00_03", "L00_05", "L00_07", "S01", "S03", "S05", "S07"
                },
                ["SelectedStrategyStopLossMode"] = new[]
                {
                    "No", "Auto", "ATR5", "ATR12", "ATR24", "ATR48", "Body", "candle_body",
                    "candle_extreme_5", "candle_extreme_10", "candle_range", "candle_wick", "candle_wick_07",
                    "candle_wick_1_5", "candle_wick_2", "candle_wick_13", "event", "event_invalidation",
                    "furthest_invalidation", "fvg_edge", "HTF_Key_levels", "ltf_Key_levels", "ob_edge", "pattern",
                    "protective_swing", "Range24", "session_high_low", "structure", "swing", "Swing1H", "Swing4H",
                    "Swing15m", "SwingHTF", "SwingLTF", "wick", "Wick05", "Wick07", "Wick11", "Wick13", "Wick15", "Wick2"
                },
                ["SelectedStrategyTakeProfitMode"] = new[]
                {
                    "No", "Auto", "candle", "RR_0_3", "RR_0_5", "RR_0_7", "RR_1", "RR_1_3", "RR_1_5",
                    "RR_1_7", "RR_2", "RR_2_5", "RR_3", "ltf_Key_levels", "HTF_Key_levels", "next_liquidity",
                    "session_high_low", "ob_edge", "fvg_edge", "vwap", "ema_mid", "atr_1", "atr_2", "atr_3",
                    "trail_only", "event", "structure"
                },
                ["SelectedStrategyExitMode"] = new[]
                {
                    "Off", "Trailing_Stop", "Break_Even", "Reversed_when_SL",
                    "Trailing_Stop_Reversed_when_SL", "Break_Even_Reversed_when_SL"
                },
                ["EnableLiveStrategyTrading"] = new[] { "No", "Yes", "Buy", "Sell" },
                ["EnableStrategyDebug"] = new[] { "Yes", "No" },
                ["SelectedBacktestStrategy"] = BacktestStrategyNames(),
                ["SelectedBacktestStrategy2"] = BacktestStrategyNames(),
                ["SelectedBacktestStrategy3"] = BacktestStrategyNames(),
                ["SelectedBacktestStrategy4"] = BacktestStrategyNames(),
                ["SelectedBacktestStrategy5"] = BacktestStrategyNames()
            };
        private bool _polling;
        private bool _stopping;

        protected override void OnStart()
        {
            if (string.IsNullOrWhiteSpace(ApiKey))
            {
                Print("42trade Backtest Worker idle: API Key is required. Stop it, set the key, and start it again.");
                return;
            }

            Timer.Start(TimeSpan.FromSeconds(Math.Max(1, PollSeconds)));
            Print($"42trade Backtest Worker started. Parallel slots: {MaxParallel}.");
            PollQueue();
        }

        protected override void OnTimer()
        {
            PollQueue();
        }

        protected override void OnStop()
        {
            _stopping = true;
            Timer.Stop();
            BacktestingProcess[] processes;
            lock (_sync)
                processes = _active.Keys.ToArray();
            foreach (var process in processes)
            {
                try { process.Terminate(); }
                catch (Exception error) { Print($"Could not terminate backtest: {error.Message}"); }
            }
        }

        protected override void OnException(Exception exception)
        {
            Print($"42trade Backtest Worker error: {exception.Message}");
        }

        private void PollQueue()
        {
            if (_stopping || _polling)
                return;

            int freeSlots;
            lock (_sync)
                freeSlots = Math.Max(0, Math.Max(1, MaxParallel) - _active.Count);
            if (freeSlots == 0)
                return;

            _polling = true;
            try
            {
                var response = Post("/api/backtests/ctrader/worker/claim", new
                {
                    worker_id = WorkerId,
                    limit = freeSlots,
                    execution_mode = "plugin"
                });
                if (!response.IsSuccessful)
                {
                    Print($"Queue claim failed ({response.StatusCode}): {response.Body}");
                    return;
                }

                var claim = JsonSerializer.Deserialize<ClaimResponse>(response.Body, JsonOptions());
                foreach (var job in claim?.Jobs ?? new List<BacktestJob>())
                    StartJob(job);
            }
            catch (Exception error)
            {
                Print($"Queue poll failed: {error.Message}");
            }
            finally
            {
                _polling = false;
            }
        }

        private void StartJob(BacktestJob job)
        {
            try
            {
                var launch = job.LaunchConfig ?? throw new InvalidOperationException("launch_config is missing");
                if (!(AlgoRegistry.Get(launch.RobotName, AlgoKind.Robot) is RobotType robotType))
                    throw new InvalidOperationException($"Robot '{launch.RobotName}' is not installed");

                var settings = new BacktestingSettings
                {
                    StartTimeUtc = ParseUtc(launch.StartTimeUtc),
                    EndTimeUtc = ParseUtc(launch.EndTimeUtc),
                    Balance = launch.Balance,
                    DataMode = ParseDataMode(launch.DataMode),
                    SpreadPips = launch.SpreadPips
                };
                ConfigureCommission(settings, launch);
                ConfigurePreciseConversion(settings);
                var parameterSet = BuildParameterValues(robotType, launch.Parameters);
                var process = Backtesting.Start(
                    robotType,
                    launch.Symbol,
                    ParseTimeFrame(launch.Timeframe),
                    settings,
                    parameterSet.Values);
                var context = new JobContext
                {
                    Job = job,
                    Process = process,
                    LastReportedProgress = -1,
                    ResolvedParameters = parameterSet.Snapshot
                };
                lock (_sync)
                    _active[process] = context;

                process.ProgressChanged += OnProgressChanged;
                process.Completed += OnCompleted;
                PostProgress(context, 0, "Starting");
                Print($"Started {job.JobId}: {launch.Symbol} {launch.Timeframe} / {launch.RobotName}");

                if (process.IsCompleted)
                    FinishProcess(process, process.JsonReport, process.HtmlReport);
            }
            catch (Exception error)
            {
                Print($"Could not start {job?.JobId}: {error.Message}");
                FailJob(job?.JobId, error.Message);
            }
        }

        private void OnProgressChanged(BacktestingProgressChangedEventArgs args)
        {
            JobContext context;
            lock (_sync)
            {
                if (!_active.TryGetValue(args.Process, out context))
                    return;
            }
            var rounded = Math.Max(0, Math.Min(100, (int)Math.Floor(args.Progress)));
            if (rounded < 100 && rounded - context.LastReportedProgress < 2)
                return;
            PostProgress(context, rounded, args.Operation);
        }

        private void PostProgress(JobContext context, int progress, string operation)
        {
            context.LastReportedProgress = progress;
            try
            {
                var response = Post($"/api/backtests/ctrader/worker/jobs/{Uri.EscapeDataString(context.Job.JobId)}/progress", new
                {
                    worker_id = WorkerId,
                    progress_pct = progress,
                    operation = operation ?? "",
                    resolved_parameters = context.ResolvedParameters
                });
                if (response.StatusCode == 409 || response.Body.IndexOf("cancelled", StringComparison.OrdinalIgnoreCase) >= 0)
                    context.Process.Terminate();
            }
            catch (Exception error)
            {
                Print($"Progress sync failed for {context.Job.JobId}: {error.Message}");
            }
        }

        private void OnCompleted(BacktestingCompletedEventArgs args)
        {
            FinishProcess(args.Process, args.JsonReport, args.HtmlReport);
        }

        private void FinishProcess(BacktestingProcess process, string jsonReport, string htmlReport)
        {
            JobContext context;
            lock (_sync)
            {
                if (!_active.TryGetValue(process, out context))
                    return;
                _active.Remove(process);
            }

            try
            {
                if (string.IsNullOrWhiteSpace(jsonReport))
                {
                    var backtestingError = process.BacktestingError.ToString();
                    throw new InvalidOperationException(
                        string.IsNullOrWhiteSpace(backtestingError) ||
                        string.Equals(backtestingError, "None", StringComparison.OrdinalIgnoreCase)
                        ? "cTrader returned no JSON report"
                        : backtestingError);
                }
                var response = Post($"/api/backtests/ctrader/worker/jobs/{Uri.EscapeDataString(context.Job.JobId)}/complete", new
                {
                    worker_id = WorkerId,
                    ctrader_report = jsonReport,
                    html_report = htmlReport,
                    resolved_parameters = context.ResolvedParameters
                }, TimeSpan.FromMinutes(3));
                if (!response.IsSuccessful)
                    throw new InvalidOperationException($"42trade rejected result ({response.StatusCode}): {response.Body}");
                Print($"Completed {context.Job.JobId}; report stored in 42trade.");
            }
            catch (Exception error)
            {
                Print($"Completion sync failed for {context.Job.JobId}: {error.Message}");
                FailJob(context.Job.JobId, error.Message);
            }
            finally
            {
                if (!_stopping)
                    PollQueue();
            }
        }

        private void FailJob(string jobId, string error)
        {
            if (string.IsNullOrWhiteSpace(jobId))
                return;
            try
            {
                Post($"/api/backtests/ctrader/worker/jobs/{Uri.EscapeDataString(jobId)}/fail", new
                {
                    worker_id = WorkerId,
                    error = error ?? "Unknown cTrader worker error"
                });
            }
            catch (Exception syncError)
            {
                Print($"Failure sync failed for {jobId}: {syncError.Message}");
            }
        }

        private void ConfigureCommission(BacktestingSettings settings, LaunchConfig launch)
        {
            // cTrader 5.9 currently hosts the legacy BacktestingSettings API even
            // though newer Automate NuGet packages expose Commission and
            // ApplyCommissionAutomatically. Reflection keeps one plugin binary
            // compatible with both API generations and avoids MissingMethodException.
            var settingsType = settings.GetType();
            var autoProperty = settingsType.GetProperty("ApplyCommissionAutomatically");
            var commissionProperty = settingsType.GetProperty("Commission");
            var commissionTypeProperty = settingsType.GetProperty("CommissionType");
            if (autoProperty != null && commissionProperty != null && commissionTypeProperty != null)
            {
                autoProperty.SetValue(settings, launch.ApplyCommissionAutomatically);
                commissionProperty.SetValue(settings, launch.CommissionUsdPerMillion);
                commissionTypeProperty.SetValue(settings, SymbolCommissionType.UsdPerMillionUsdVolume);
                return;
            }

            var legacyCommissionProperty = settingsType.GetProperty("CommissionUsdPerMillionUsd");
            if (legacyCommissionProperty == null)
                throw new NotSupportedException("This cTrader version exposes no supported backtesting commission setting.");

            legacyCommissionProperty.SetValue(settings, launch.CommissionUsdPerMillion);
            if (launch.ApplyCommissionAutomatically)
                Print("This cTrader runtime cannot apply broker commission automatically; using the queued USD-per-million value.");
        }

        private static void ConfigurePreciseConversion(BacktestingSettings settings)
        {
            var property = settings.GetType().GetProperty("PreciseConversion");
            if (property != null)
                property.SetValue(settings, true);
        }

        private HttpResponse Post(string path, object payload, TimeSpan? timeout = null)
        {
            var request = new HttpRequest(new Uri($"{ApiBase.TrimEnd('/')}{path}"))
            {
                Method = HttpMethod.Post,
                Body = JsonSerializer.Serialize(payload, JsonOptions()),
                Timeout = timeout ?? TimeSpan.FromSeconds(30)
            };
            request.Headers.Add("Content-Type", "application/json");
            request.Headers.Add("x-api-key", ApiKey);
            return Http.Send(request);
        }

        private ResolvedParameterSet BuildParameterValues(
            RobotType robotType,
            Dictionary<string, JsonElement> overrides)
        {
            var values = new List<object>();
            var snapshot = new List<ParameterSnapshot>();
            var named = overrides ?? new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
            foreach (var parameter in robotType.Parameters)
            {
                var hasOverride = TryGetOverride(named, parameter.Name, out var element);
                object resolved;
                var source = hasOverride ? "override" : "default";
                if (IsSensitiveParameterName(parameter.Name))
                {
                    resolved = "";
                    source = "redacted";
                }
                else if (hasOverride)
                {
                    resolved = ConvertParameter(parameter.Name, element, parameter.DefaultValue, parameter.Type);
                }
                else if (parameter.Type == AlgoParameterType.Color)
                {
                    resolved = parameter.DefaultValue?.ToString() ?? "";
                }
                else
                {
                    resolved = parameter.DefaultValue;
                }
                values.Add(resolved);
                snapshot.Add(new ParameterSnapshot
                {
                    Name = parameter.Name,
                    Type = parameter.Type.ToString(),
                    Value = ToJsonSafeValue(parameter.Name, resolved),
                    Source = source
                });
            }
            return new ResolvedParameterSet
            {
                Values = values.ToArray(),
                Snapshot = snapshot
            };
        }

        private static object ToJsonSafeValue(string name, object value)
        {
            if (IsSensitiveParameterName(name)) return "[REDACTED]";
            if (value == null) return null;
            if (value is string || value is bool || value is int || value is long ||
                value is double || value is decimal || value is float)
                return value;
            if (value is DateTime dateTime)
                return dateTime.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
            return value.ToString();
        }

        private static bool IsSensitiveParameterName(string value)
        {
            var compact = CompactKey(value);
            return compact.Contains("apikey") || compact.Contains("password") ||
                compact.Contains("passwd") || compact.Contains("secret") ||
                compact.Contains("token") || compact.Contains("credential") ||
                compact.Contains("authorization") || compact.Contains("authkey");
        }

        private static bool TryGetOverride(Dictionary<string, JsonElement> values, string name, out JsonElement element)
        {
            if (values.TryGetValue(name, out element))
                return true;
            var compactName = CompactKey(name);
            foreach (var pair in values)
            {
                var requestedName = ResolveParameterName(pair.Key);
                if (CompactKey(requestedName) == compactName)
                {
                    element = pair.Value;
                    return true;
                }
            }
            element = default(JsonElement);
            return false;
        }

        private static string ResolveParameterName(string value)
        {
            var compact = CompactKey(value);
            return ParameterAliases.TryGetValue(compact, out var internalName)
                ? internalName
                : value;
        }

        private static string CompactKey(string value)
        {
            return new string((value ?? "").Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());
        }

        private static object ConvertParameter(
            string parameterName,
            JsonElement element,
            object defaultValue,
            AlgoParameterType parameterType)
        {
            if (element.ValueKind == JsonValueKind.Null)
                return defaultValue;
            var text = element.ValueKind == JsonValueKind.String ? element.GetString() : element.ToString();
            if (TryResolveKnownEnum(parameterName, text, out var enumOrdinal))
                return defaultValue == null
                    ? (long)enumOrdinal
                    : Convert.ChangeType(enumOrdinal, defaultValue.GetType(), CultureInfo.InvariantCulture);
            if (parameterType == AlgoParameterType.Enum || parameterType == AlgoParameterType.MultiEnum ||
                parameterType == AlgoParameterType.Color || parameterType == AlgoParameterType.Symbol ||
                parameterType == AlgoParameterType.MultiSymbol)
                return text;
            if (parameterType == AlgoParameterType.TimeFrame)
                return ParseTimeFrame(text);
            if (defaultValue == null)
                return text;

            var type = defaultValue.GetType();
            if (type == typeof(string)) return text;
            if (type == typeof(bool)) return element.ValueKind == JsonValueKind.True ||
                (element.ValueKind != JsonValueKind.False && bool.Parse(text));
            if (type == typeof(int)) return int.Parse(text, CultureInfo.InvariantCulture);
            if (type == typeof(long)) return long.Parse(text, CultureInfo.InvariantCulture);
            if (type == typeof(double)) return double.Parse(text, CultureInfo.InvariantCulture);
            if (type == typeof(decimal)) return decimal.Parse(text, CultureInfo.InvariantCulture);
            if (type == typeof(TimeFrame)) return ParseTimeFrame(text);
            if (type.IsEnum) return Enum.Parse(type, text, true);
            return JsonSerializer.Deserialize(element.GetRawText(), type, JsonOptions());
        }

        private static bool TryResolveKnownEnum(string parameterName, string value, out int ordinal)
        {
            ordinal = -1;
            if (!KnownEnumValues.TryGetValue(parameterName ?? "", out var names))
                return false;
            ordinal = Array.FindIndex(names, name => string.Equals(name, value, StringComparison.OrdinalIgnoreCase));
            if (ordinal < 0)
                throw new ArgumentException($"Unknown value '{value}' for cBot parameter '{parameterName}'.");
            return true;
        }

        private static string[] RiskLimitPresetNames()
        {
            return new[]
            {
                "None", "_0_05pct", "_0_1pct", "_0_2pct", "_0_5pct", "_1pct", "_2pct", "_3pct",
                "_4pct", "_5pct", "_10pct", "_15pct", "_20pct", "_25usd", "_50usd", "_100usd",
                "_200usd", "_500usd", "_1000usd", "_2000usd"
            };
        }

        private static string[] BacktestStrategyNames()
        {
            return new[]
            {
                "Off", "CustomTrade", "HtfEventMarket", "LtfEventMarket", "EmaCrossV1", "SmaCrossV1",
                "GoldenCrossV1", "TripleEmaTrendV1", "RsiReversionV1", "BollingerReversionV1", "StochReversalV1",
                "MacdSignalV1", "RocMomentumV1", "DonchianBreakoutV1", "ichimoku_full_confirmation", "Trend",
                "Impulse", "PriceActionV1", "PriceActionEventDetectorV1", "PriceActionFvgContextV1",
                "ArtifactSuggestedLevelsV1", "ArtifactSuggestedLevelsV2", "ArtifactSuggestedLevelsV2LimitBodyMid",
                "AiSnapshotContextV1", "WickFlipContinuation", "candle_pattern_trend", "pinbar_structure_event",
                "engulfing_structure_event", "wick_flip", "reject_trendline", "sweep_reclaim", "london_trend_sweep",
                "ichimoku", "ichimoku_strict"
            };
        }

        private static DateTime ParseUtc(string value)
        {
            return DateTime.Parse(value, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
        }

        private static BacktestingDataMode ParseDataMode(string value)
        {
            switch ((value ?? "m1").Trim().ToLowerInvariant())
            {
                case "ticks": return BacktestingDataMode.Ticks;
                case "open": return BacktestingDataMode.OpenPrices;
                default: return BacktestingDataMode.M1;
            }
        }

        private static TimeFrame ParseTimeFrame(string value)
        {
            switch ((value ?? "").Trim().ToLowerInvariant())
            {
                case "m1": case "1": case "1m": return TimeFrame.Minute;
                case "m5": case "5": case "5m": return TimeFrame.Minute5;
                case "m15": case "15": case "15m": return TimeFrame.Minute15;
                case "m30": case "30": case "30m": return TimeFrame.Minute30;
                case "h1": case "60": case "1h": return TimeFrame.Hour;
                case "h4": case "240": case "4h": return TimeFrame.Hour4;
                case "d1": case "1440": case "1d": return TimeFrame.Daily;
                default: return TimeFrame.Parse(value);
            }
        }

        private static JsonSerializerOptions JsonOptions()
        {
            return new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
            };
        }

        private sealed class JobContext
        {
            public BacktestJob Job { get; set; }
            public BacktestingProcess Process { get; set; }
            public int LastReportedProgress { get; set; }
            public List<ParameterSnapshot> ResolvedParameters { get; set; }
        }

        private sealed class ResolvedParameterSet
        {
            public object[] Values { get; set; }
            public List<ParameterSnapshot> Snapshot { get; set; }
        }

        private sealed class ParameterSnapshot
        {
            [JsonPropertyName("name")]
            public string Name { get; set; }

            [JsonPropertyName("type")]
            public string Type { get; set; }

            [JsonPropertyName("value")]
            public object Value { get; set; }

            [JsonPropertyName("source")]
            public string Source { get; set; }
        }

        private sealed class ClaimResponse
        {
            [JsonPropertyName("jobs")]
            public List<BacktestJob> Jobs { get; set; }
        }

        private sealed class BacktestJob
        {
            [JsonPropertyName("job_id")]
            public string JobId { get; set; }

            [JsonPropertyName("launch_config")]
            public LaunchConfig LaunchConfig { get; set; }
        }

        private sealed class LaunchConfig
        {
            [JsonPropertyName("robot_name")]
            public string RobotName { get; set; }

            [JsonPropertyName("symbol")]
            public string Symbol { get; set; }

            [JsonPropertyName("timeframe")]
            public string Timeframe { get; set; }

            [JsonPropertyName("start_time_utc")]
            public string StartTimeUtc { get; set; }

            [JsonPropertyName("end_time_utc")]
            public string EndTimeUtc { get; set; }

            [JsonPropertyName("balance")]
            public double Balance { get; set; }

            [JsonPropertyName("data_mode")]
            public string DataMode { get; set; }

            [JsonPropertyName("spread_pips")]
            public double SpreadPips { get; set; }

            [JsonPropertyName("commission_usd_per_million")]
            public double CommissionUsdPerMillion { get; set; }

            [JsonPropertyName("apply_commission_automatically")]
            public bool ApplyCommissionAutomatically { get; set; }

            [JsonPropertyName("parameters")]
            public Dictionary<string, JsonElement> Parameters { get; set; }
        }
    }
}
