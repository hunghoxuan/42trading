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
                    limit = freeSlots
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
                    Commission = launch.CommissionUsdPerMillion,
                    CommissionType = SymbolCommissionType.UsdPerMillionUsdVolume,
                    ApplyCommissionAutomatically = launch.ApplyCommissionAutomatically,
                    SpreadPips = launch.SpreadPips,
                    PreciseConversion = true
                };
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
                    throw new InvalidOperationException(
                        process.BacktestingError.ToString() ?? "cTrader returned no JSON report");
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

        private static ResolvedParameterSet BuildParameterValues(
            RobotType robotType,
            Dictionary<string, JsonElement> overrides)
        {
            var values = new List<object>();
            var snapshot = new List<ParameterSnapshot>();
            var named = overrides ?? new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
            foreach (var parameter in robotType.Parameters)
            {
                var hasOverride = TryGetOverride(named, parameter.Name, out var element);
                var resolved = hasOverride
                    ? ConvertParameter(element, parameter.DefaultValue)
                    : parameter.DefaultValue;
                values.Add(resolved);
                snapshot.Add(new ParameterSnapshot
                {
                    Name = parameter.Name,
                    Type = parameter.Type.ToString(),
                    Value = ToJsonSafeValue(parameter.Name, resolved),
                    Source = hasOverride ? "override" : "default"
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
                if (CompactKey(pair.Key) == compactName)
                {
                    element = pair.Value;
                    return true;
                }
            }
            element = default(JsonElement);
            return false;
        }

        private static string CompactKey(string value)
        {
            return new string((value ?? "").Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());
        }

        private static object ConvertParameter(JsonElement element, object defaultValue)
        {
            if (element.ValueKind == JsonValueKind.Null)
                return defaultValue;
            if (defaultValue == null)
                return element.ValueKind == JsonValueKind.String ? element.GetString() : element.ToString();

            var type = defaultValue.GetType();
            var text = element.ValueKind == JsonValueKind.String ? element.GetString() : element.ToString();
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
