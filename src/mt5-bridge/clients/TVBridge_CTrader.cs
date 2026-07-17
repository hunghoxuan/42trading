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

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.FullAccess)]
    public class TVBridgeCBot : Robot
    {
        private const string BuildVersion = "v2026.06.25 12:28 - watchdog-hang-fixes";
        private const string BridgeSourceId = "Ctrader";
        private const string BridgeSourceType = "ctrader_bridge";
        private const int TransientErrorLogThresholdCount = 10;
        private const int TransientErrorLogThresholdSeconds = 30;

        [Parameter("Server API Base URL", DefaultValue = "http://127.0.0.1:3001/api")]
        public string ServerBaseUrl { get; set; }

        [Parameter("EA API Key", DefaultValue = "acc_506cb604d10644736df6a7bf77c79fd30731")]
        public string EaApiKey { get; set; }

        [Parameter("Master Timer (sec)", Group = "Timer", DefaultValue = 1, MinValue = 1)]
        public int MasterTimerSeconds { get; set; }

        [Parameter("Polling Frequency (sec)", DefaultValue = 2, MinValue = 1)]
        public int PollSeconds { get; set; }

        [Parameter("Poll Timeout (sec)", Group = "Timer", DefaultValue = 12, MinValue = 3)]
        public int PollTimeoutSeconds { get; set; }

        [Parameter("Magic Number", DefaultValue = 20260411)]
        public int MagicNumber { get; set; }

        [Parameter("Provider Code", DefaultValue = "ICMARKETS")]
        public string ProviderCode { get; set; }

        [Parameter("Max Risk ($)", DefaultValue = 50)]
        public double MaxRiskAmount { get; set; }

        [Parameter("Max Risk (%)", DefaultValue = 0.5)]
        public double MaxRiskPercent { get; set; }

        public enum ManagementStrategy
        {
            None,
            BreakEven,
            TrailingStop,
            Both
        }

        [Parameter("Management Strategy", Group = "Automation", DefaultValue = ManagementStrategy.None)]
        public ManagementStrategy SelectedStrategy { get; set; }

        [Parameter("BE Trigger (Pips)", Group = "Automation", DefaultValue = 15, MinValue = 1)]
        public double BE_Trigger { get; set; }

        [Parameter("BE Offset (Pips)", Group = "Automation", DefaultValue = 1)]
        public double BE_Offset { get; set; }

        [Parameter("Trailing Start (Pips)", Group = "Automation", DefaultValue = 20, MinValue = 1)]
        public double Trail_Start { get; set; }

        [Parameter("Trailing Step (Pips)", Group = "Automation", DefaultValue = 5, MinValue = 1)]
        public double Trail_Step { get; set; }

        [Parameter("Price Push Enabled", Group = "Price Stream", DefaultValue = true)]
        public bool PricePushEnabled { get; set; }

        [Parameter("Price Push Interval (sec)", Group = "Price Stream", DefaultValue = 60, MinValue = 15)]
        public int PricePushSeconds { get; set; }

        [Parameter("Bar Push Enabled", Group = "Price Stream", DefaultValue = true)]
        public bool BarPushEnabled { get; set; }

        [Parameter("Bar Push Interval (sec)", Group = "Price Stream", DefaultValue = 30, MinValue = 15)]
        public int BarPushSeconds { get; set; }

        [Parameter("Incremental Bars Sync", Group = "Bar Sync", DefaultValue = true)]
        public bool EnableIncrementalBars { get; set; }

        [Parameter("Incremental Sync Interval (sec)", Group = "Bar Sync", DefaultValue = 120, MinValue = 30)]
        public int IncrementalBarsSeconds { get; set; }

        [Parameter("Max Bars Per Post", Group = "Bar Sync", DefaultValue = 200, MinValue = 10)]
        public int IncrementalBarsMaxPerPost { get; set; }

        [Parameter("Sync Interval (sec)", Group = "Sync", DefaultValue = 10, MinValue = 5)]
        public int SyncIntervalSeconds { get; set; }

        [Parameter("Sync Timeout (sec)", Group = "Sync", DefaultValue = 20, MinValue = 5)]
        public int SyncTimeoutSeconds { get; set; }

        [Parameter("Min Stop Distance (pips)", Group = "Safety", DefaultValue = 15, MinValue = 5)]
        public double MinStopPips { get; set; }

        [Parameter("On SL/TP Error", Group = "Safety", DefaultValue = "Adjust")]
        public string OnSlTpError { get; set; }  // "Reject" = cancel trade, "Adjust" = auto-widen to meet minimum, "Continue" = keep position without SL/TP

        [Parameter("Log Filter", Group = "Logging", DefaultValue = "Error,Reject")]
        public string LogFilter { get; set; }


        private string _serverStatus = "WAITING";
        private string _apiStatus = "WAITING";
        private string _pollStatus = "IDLE";
        private string _syncStatus = "IDLE";
        private string _priceStatus = "IDLE";

        private string _lastPollErr = "None";
        private string _lastSyncErr = "None";
        private string _lastPriceErr = "None";
        private long _lastPollLatencyMs = -1;
        private long _lastSyncLatencyMs = -1;
        private int _pollConsecutiveFailures = 0;
        private int _syncConsecutiveFailures = 0;
        private string _lastPriceSymbolsText = "None";
        private int _lastPriceStoredCount = 0;
        private string _lastWatchlistSymbolsText = "None";
        private int _lastWatchlistSymbolCount = 0;
        private int _lastPullServerTradeCount = 0;
        private int _lastPullServerSymbolCount = 0;
        private int _lastPullServerStrategyCount = 0;
        private int _lastPushPositionCount = 0;
        private int _lastPushOrderCount = 0;
        private int _lastPushClosedCount = 0;
        private int _lastPushSymbolCount = 0;
        private int _lastPushPriceSymbolCount = 0;
        private bool _hasPullServerSummary = false;
        private DateTime _apiOfflineUntil = DateTime.MinValue;

        private DateTime _lastPollTime = DateTime.MinValue;
        private DateTime _lastPollAttemptTime = DateTime.MinValue;
        private DateTime _lastSyncTime = DateTime.MinValue;
        private DateTime _lastSyncAttemptTime = DateTime.MinValue;
        private DateTime _lastPriceTime = DateTime.MinValue;

        private int _pollCount = 0;
        private int _successPolls = 0;
        private int _syncCount = 0;
        private int _priceCount = 0;
        private int _consecutiveErrors = 0;
        private DateTime _lastErrorClearTime = DateTime.Now;
        private DateTime _errorStreakStartedAt = DateTime.MinValue;
        private DateTime _lastTransientErrorLogTime = DateTime.MinValue;
        private DateTime _lastTimerTickSeen = DateTime.MinValue;
        private DateTime _lastTickFallbackKick = DateTime.MinValue;
        private bool _errorStreakWasLogged = false;

        // REGISTRY: Tracks all processed signals to prevent duplicates
        private HashSet<string> _processedSignalIds = new HashSet<string>();
        private HashSet<string> _processedLeases = new HashSet<string>(); // sid:lease_token
        private List<PanelEventEntry> _pollEvents = new List<PanelEventEntry>();
        private List<PanelEventEntry> _syncEvents = new List<PanelEventEntry>();
        private PanelEventSummary _lastPollSummary = new PanelEventSummary();
        private PanelEventSummary _lastSyncSummary = new PanelEventSummary();
        private HashSet<string> _syncedClosedTickets = new HashSet<string>();

        private class PanelEventEntry
        {
            public string ItemId;
            public string Sid;
            public string Symbol;
            public string Action;
            public string EventCode;
            public string Detail;
            public string Bucket;
        }

        private class PanelEventSummary
        {
            public int Read;
            public int Unchanged;
            public int Changed;
            public int Closed;
            public int Created;
        }

        private class PartialTP
        {
            public double Price;
            public double SizePct;
        }
        private Dictionary<string, List<PartialTP>> _tradePartials = new Dictionary<string, List<PartialTP>>();
        private HashSet<string> _executedPartials = new HashSet<string>(); // key: ticket_partialIdx
        private Dictionary<string, double> _partialClosedVolumes = new Dictionary<string, double>(); // ticket -> total closed volume from partials
        private Dictionary<string, string> _ticketSidMap = new Dictionary<string, string>(); // ticket -> sid backfill for empty comments
        private Dictionary<string, string> _symbolResolveCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private HashSet<string> _notFoundSymbols = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private HashSet<string> _noQuoteSymbols = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        private List<string> _trackedSymbols = new List<string>(); // symbols learned from /api/broker/pull

        // Bar push tracking
        private DateTime _lastBarTime = DateTime.MinValue;
        private string _barStatus = "IDLE";
        private string _lastBarErr = "None";
        private int _barCount = 0;
        private Dictionary<string, long> _barLastTime = new Dictionary<string, long>(); // key: "SYMBOL_TF" -> unix time

        // Incremental bars sync tracking
        private DateTime _lastIncrementalSync = DateTime.MinValue;
        private string _incrementalStatus = "IDLE";
        private string _lastIncrementalErr = "None";
        private int _incrementalSyncCount = 0;
        private int _incrementalTotalInserted = 0;


        private HttpClient _httpClient = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        private bool _isBusy = false;
        private bool _syncOnly = false; // When true, DoTimerWork only does sync payload + dispatch

        // Master timer state
        private DateTime _masterTimerTick = DateTime.MinValue;
        private long _masterTickCount = 0;

        // Per-subsystem busy flags (one stuck subsystem can't block others)
        private bool _busyPull = false;
        private bool _busySync = false;
        private bool _busyPrice = false;
        private bool _busyBars = false;
        private bool _busyIncSync = false;

        private CancellationTokenSource _watchdogCts;

        private string ResolveSid(string ticket, string commentSid)
        {
            var sid = ExtractSidFromBrokerComment(commentSid);
            if (!string.IsNullOrEmpty(sid)) return sid;
            var key = string.IsNullOrWhiteSpace(ticket) ? "" : ticket.Trim();
            if (string.IsNullOrEmpty(key)) return "";
            string mapped;
            if (_ticketSidMap.TryGetValue(key, out mapped) && !string.IsNullOrWhiteSpace(mapped))
                return mapped.Trim();
            return "";
        }

        private string GetServerApiBaseUrl()
        {
            var baseUrl = string.IsNullOrWhiteSpace(ServerBaseUrl) ? "" : ServerBaseUrl.Trim();
            if (string.IsNullOrEmpty(baseUrl)) return "http://127.0.0.1:3001/api";

            try
            {
                var parsed = new Uri(baseUrl, UriKind.Absolute);
                var normalized = baseUrl.TrimEnd('/');
                var absPath = parsed.AbsolutePath ?? "/";
                if (string.IsNullOrWhiteSpace(absPath) || absPath == "/")
                    return normalized + "/api";
                return normalized;
            }
            catch
            {
                return baseUrl.TrimEnd('/');
            }
        }

        private string BuildServerApiUrl(string relativePath)
        {
            var baseUrl = GetServerApiBaseUrl();
            var suffix = string.IsNullOrWhiteSpace(relativePath)
                ? ""
                : "/" + relativePath.Trim().TrimStart('/');
            return baseUrl.TrimEnd('/') + suffix;
        }

        private string BuildBrokerComment(string sid)
        {
            var value = string.IsNullOrWhiteSpace(sid) ? "" : sid.Trim();
            if (string.IsNullOrEmpty(value)) return "";
            if (value.Length <= 16) return value;
            return "SID:" + value.Substring(0, 12);
        }

        private string ExtractSidFromBrokerComment(string comment)
        {
            var value = string.IsNullOrWhiteSpace(comment) ? "" : comment.Trim();
            if (string.IsNullOrEmpty(value)) return "";
            var pipeIndex = value.IndexOf('|');
            if (pipeIndex >= 0) value = value.Substring(0, pipeIndex).Trim();
            return value;
        }

        private string BuildBrokerLabel(string strategy, string entryModel)
        {
            var parts = new List<string>();
            var strategyValue = string.IsNullOrWhiteSpace(strategy) ? "" : Regex.Replace(strategy.Trim(), "\\s+", " ");
            var entryModelValue = string.IsNullOrWhiteSpace(entryModel) ? "" : Regex.Replace(entryModel.Trim(), "\\s+", " ");
            if (!string.IsNullOrEmpty(strategyValue)) parts.Add(strategyValue);
            if (!string.IsNullOrEmpty(entryModelValue) && !string.Equals(entryModelValue, strategyValue, StringComparison.OrdinalIgnoreCase)) parts.Add(entryModelValue);
            var value = string.Join(" / ", parts);
            if (string.IsNullOrEmpty(value)) return MagicNumber.ToString();
            if (value.Length <= 50) return value;
            return value.Substring(0, 50);
        }

        private string BuildBrokerComment(string sid, string note)
        {
            // Broker comments are identity fields for sync/dedupe. Notes belong in server data, not cTrader Comment.
            return BuildBrokerComment(sid);
        }

        private bool CommentMatchesSid(string commentValue, string sid)
        {
            var normalizedComment = string.IsNullOrWhiteSpace(commentValue) ? "" : commentValue.Trim();
            var commentSid = ExtractSidFromBrokerComment(commentValue);
            var normalizedSid = string.IsNullOrWhiteSpace(sid) ? "" : sid.Trim();
            if (string.IsNullOrEmpty(normalizedComment) || string.IsNullOrEmpty(normalizedSid)) return false;
            return normalizedComment == normalizedSid ||
                commentSid == normalizedSid ||
                normalizedComment == BuildBrokerComment(normalizedSid) ||
                commentSid == BuildBrokerComment(normalizedSid);
        }

        private static string PanelValue(string value, string fallback = "-")
        {
            var text = string.IsNullOrWhiteSpace(value) ? "" : value.Trim();
            return string.IsNullOrEmpty(text) ? fallback : text;
        }

        private string FormatPanelItemCore(PanelEventEntry entry)
        {
            return string.Format(
                "ID:{0} SID:{1} SYM:{2} ACT:{3}",
                PanelValue(entry != null ? entry.ItemId : "", "-"),
                PanelValue(entry != null ? entry.Sid : "", "NO_SID"),
                PanelValue(entry != null ? entry.Symbol : "", "?"),
                PanelValue(entry != null ? entry.Action : "", "?")
            );
        }

        private string FormatPanelEventLine(PanelEventEntry entry)
        {
            var core = FormatPanelItemCore(entry);
            var eventCode = PanelValue(entry != null ? entry.EventCode : "", "EVENT");
            var detail = string.IsNullOrWhiteSpace(entry != null ? entry.Detail : "") ? "" : ": " + entry.Detail.Trim();
            return string.Format("{0} [{1}{2}]", core, eventCode, detail);
        }

        private static bool JsonBool(string raw)
        {
            return string.Equals((raw ?? "").Trim(), "true", StringComparison.OrdinalIgnoreCase);
        }

        private void RecordPollEvent(string itemId, string sid, string symbol, string action, string eventCode, string detail, string bucket, bool showInDetail = true)
        {
            var summary = _lastPollSummary ?? new PanelEventSummary();
            switch ((bucket ?? "").Trim().ToLowerInvariant())
            {
                case "created":
                    summary.Created++;
                    break;
                case "changed":
                    summary.Changed++;
                    break;
                case "closed":
                    summary.Closed++;
                    break;
                case "unchanged":
                    summary.Unchanged++;
                    break;
            }
            _lastPollSummary = summary;

            if (!showInDetail) return;

            var entry = new PanelEventEntry
            {
                ItemId = PanelValue(itemId, "-"),
                Sid = PanelValue(sid, "NO_SID"),
                Symbol = PanelValue(symbol, "?"),
                Action = PanelValue(action, "?"),
                EventCode = PanelValue(eventCode, "EVENT"),
                Detail = string.IsNullOrWhiteSpace(detail) ? null : detail.Trim(),
                Bucket = bucket ?? "",
            };
            _pollEvents.RemoveAll(x => string.Equals(x.Sid ?? "", entry.Sid, StringComparison.OrdinalIgnoreCase));
            _pollEvents.Insert(0, entry);
            if (_pollEvents.Count > 8) _pollEvents.RemoveAt(8);
            RefreshDebugPanel();
        }

        private void ResetPollCycle(int readCount)
        {
            _lastPollSummary = new PanelEventSummary { Read = Math.Max(0, readCount) };
            _pollEvents = new List<PanelEventEntry>();
        }

        private void ResetSyncSummary()
        {
            _lastSyncSummary = new PanelEventSummary();
            _syncEvents = new List<PanelEventEntry>();
        }

        private string DeriveSyncEventCode(string executionStatus, bool statusChanged, bool slChanged, bool tpChanged, bool partialChanged)
        {
            var exec = (executionStatus ?? "").Trim().ToUpperInvariant();
            if (exec == "CLOSED") return "SNAPSHOT_CLOSED";
            if (exec == "CANCELLED") return "SNAPSHOT_CANCELLED";
            if (statusChanged && exec == "FILLED") return "STATUS_FILLED";
            if (statusChanged && exec == "PENDING") return "STATUS_PENDING";
            if (slChanged || tpChanged) return "PROTECTION_UPDATED";
            if (partialChanged) return "PARTIALS_UPDATED";
            if (statusChanged && !string.IsNullOrEmpty(exec)) return "STATUS_UPDATED";
            return "SYNC_UPDATED";
        }

        private void AddSyncEvent(string itemId, string sid, string symbol, string action, string eventCode, string detail, string bucket)
        {
            _syncEvents.Add(new PanelEventEntry
            {
                ItemId = PanelValue(itemId, "-"),
                Sid = PanelValue(sid, "NO_SID"),
                Symbol = PanelValue(symbol, "?"),
                Action = PanelValue(action, "?"),
                EventCode = PanelValue(eventCode, "SYNC_EVENT"),
                Detail = string.IsNullOrWhiteSpace(detail) ? null : detail.Trim(),
                Bucket = bucket ?? "",
            });
        }

        private void ApplyTrackedSymbolsFromServer(List<string> requestedSymbols)
        {
            var incoming = requestedSymbols ?? new List<string>();
            if (incoming.Count == 0) return;

            var brokerSymbols = new List<string>();
            var skippedSymbols = new List<string>();
            var newlySkippedSymbols = new List<string>();
            foreach (var requested in incoming)
            {
                var wasKnownMissing = _notFoundSymbols.Contains(requested);
                string brokerSymbol;
                if (TryResolveBrokerSymbol(requested, out brokerSymbol))
                {
                    if (!brokerSymbols.Contains(brokerSymbol))
                        brokerSymbols.Add(brokerSymbol);
                }
                else if (!skippedSymbols.Contains(requested))
                {
                    skippedSymbols.Add(requested);
                    if (!wasKnownMissing)
                    {
                        _notFoundSymbols.Add(requested);
                        newlySkippedSymbols.Add(requested);
                    }
                }
            }

            _trackedSymbols.Clear();
            foreach (var brokerSymbol in brokerSymbols)
                _trackedSymbols.Add(brokerSymbol);

            if (newlySkippedSymbols.Count > 0)
                SafePrint("[Price] Added {0} symbols to not_found_list: {1}", newlySkippedSymbols.Count, string.Join(",", newlySkippedSymbols.Take(8)));
        }

        private Symbol ResolveLoadedSymbol(string rawSymbol)
        {
            string resolvedName;
            if (!TryResolveBrokerSymbol(rawSymbol, out resolvedName)) return null;
            try
            {
                return Symbols.GetSymbol(resolvedName);
            }
            catch
            {
                return null;
            }
        }

        private bool HasUsableQuotes(Symbol symbol)
        {
            if (symbol == null) return false;
            try
            {
                double bid = double.IsNaN(symbol.Bid) ? 0 : symbol.Bid;
                double ask = double.IsNaN(symbol.Ask) ? 0 : symbol.Ask;
                return bid > 0 && ask > 0;
            }
            catch
            {
                return false;
            }
        }

        private bool TryResolveQuotedSymbol(string rawSymbol, out Symbol symbol)
        {
            symbol = ResolveLoadedSymbol(rawSymbol);
            if (symbol == null) return false;
            if (HasUsableQuotes(symbol))
            {
                _noQuoteSymbols.Remove(symbol.Name);
                return true;
            }

            _noQuoteSymbols.Add(symbol.Name);
            return false;
        }

        private bool TryResolveBrokerSymbol(string rawSymbol, out string symbolName)
        {
            symbolName = "";
            var sym = string.IsNullOrWhiteSpace(rawSymbol) ? "" : rawSymbol.Trim();
            if (string.IsNullOrEmpty(sym)) return false;

            try
            {
                string cached;
                if (_symbolResolveCache.TryGetValue(sym, out cached) && !string.IsNullOrWhiteSpace(cached))
                {
                    symbolName = cached;
                    return true;
                }
                if (_notFoundSymbols.Contains(sym)) return false;

                var compact = sym.Replace("/", "").Replace("-", "").Replace("_", "").ToUpperInvariant();
                foreach (var loaded in Symbols)
                {
                    var loadedName = loaded != null ? loaded.ToString() : "";
                    if (string.IsNullOrWhiteSpace(loadedName)) continue;

                    if (string.Equals(loadedName, sym, StringComparison.OrdinalIgnoreCase))
                    {
                        symbolName = loadedName;
                        _symbolResolveCache[sym] = symbolName;
                        return true;
                    }

                    var loadedCompact = loadedName.Replace("/", "").Replace("-", "").Replace("_", "").ToUpperInvariant();
                    if (loadedCompact == compact)
                    {
                        symbolName = loadedName;
                        _symbolResolveCache[sym] = symbolName;
                        return true;
                    }
                }
            }
            catch { }

            _notFoundSymbols.Add(sym);
            return false;
        }

        private bool IsErrorStatus(string status)
        {
            var normalized = string.IsNullOrWhiteSpace(status) ? "" : status.Trim().ToUpperInvariant();
            return normalized == "FAIL" || normalized == "ERROR" || normalized == "REJECTED";
        }

        private bool ShouldEmitLog(string level, string message)
        {
            if (string.IsNullOrWhiteSpace(LogFilter)) return true;

            var haystack = ((level ?? "") + " " + (message ?? "")).ToUpperInvariant();
            foreach (var rawToken in LogFilter.Split(','))
            {
                var token = (rawToken ?? "").Trim().ToUpperInvariant();
                if (token.Length == 0) continue;
                if (haystack.Contains(token)) return true;
            }
            return false;
        }

        private void SafeLog(string level, string format, params object[] args)
        {
            var message = (args != null && args.Length > 0)
                ? string.Format(CultureInfo.InvariantCulture, format, args)
                : format;
            if (!ShouldEmitLog(level, message)) return;
            BeginInvokeOnMainThread(() => Print(message));
        }

        private void SafePrint(string format, params object[] args)
        {
            SafeLog("INFO", format, args);
        }

        private void RunOnMainThread(Action fn)
        {
            BeginInvokeOnMainThread(() =>
            {
                try { fn(); }
                catch (Exception ex) { SafePrint("[MainThread] {0}", ex.Message); }
            });
        }

        private Task<T> RunOnMainThreadAsync<T>(Func<T> fn)
        {
            var tcs = new TaskCompletionSource<T>();
            BeginInvokeOnMainThread(() =>
            {
                try { tcs.SetResult(fn()); }
                catch (Exception ex) { tcs.SetException(ex); }
            });
            return tcs.Task;
        }

        protected override void OnStart()
        {
            if (!string.IsNullOrWhiteSpace(ServerBaseUrl) &&
                ServerBaseUrl.IndexOf("localhost", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                ServerBaseUrl = Regex.Replace(
                    ServerBaseUrl,
                    "localhost",
                    "127.0.0.1",
                    RegexOptions.IgnoreCase
                );
                SafePrint("[Bridge] Normalized ServerBaseUrl to {0}", ServerBaseUrl);
            }
            _serverStatus = "BOOTING";
            _apiStatus = "BOOTING";
            _pollStatus = "IDLE";
            _syncStatus = "IDLE";
            int interval = Math.Max(1, MasterTimerSeconds);
            Timer.Start(TimeSpan.FromSeconds(interval));
            _lastTimerTickSeen = DateTime.Now;
            StartMasterWatchdog(interval);
            SafePrint("[Bridge] Started. MasterTimer={0}s Ver={1}", interval, BuildVersion);
            RefreshDebugPanelNow();
        }

        private int ClampTimeoutSeconds(int seconds, int fallbackSeconds)
        {
            var safeFallback = Math.Max(1, fallbackSeconds);
            if (seconds <= 0) return safeFallback;
            return Math.Max(1, Math.Min(300, seconds));
        }

        private async Task<HttpResponseMessage> SendWithTimeoutAsync(HttpRequestMessage request, int timeoutSeconds)
        {
            var safeTimeout = ClampTimeoutSeconds(timeoutSeconds, 10);
            using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(safeTimeout)))
            {
                return await _httpClient.SendAsync(request, cts.Token);
            }
        }

        private bool IsApiOfflineCooldownActive(DateTime now)
        {
            return _apiOfflineUntil > now;
        }

        private void MarkApiReachable()
        {
            _apiOfflineUntil = DateTime.MinValue;
        }

        private void MarkApiOfflineCooldown()
        {
            var seconds = Math.Max(10, Math.Min(60, PollSeconds * 2));
            _apiOfflineUntil = DateTime.Now.AddSeconds(seconds);
            _serverStatus = "OFFLINE";
            _apiStatus = "UNREACHABLE";
        }

        private string BuildExceptionDetail(Exception ex)
        {
            if (ex == null) return "type=(null), message=(null)";

            var parts = new List<string>();
            parts.Add("type=" + ex.GetType().FullName);
            parts.Add("message=" + (string.IsNullOrWhiteSpace(ex.Message) ? "(empty)" : ex.Message));

            var baseEx = ex.GetBaseException();
            if (baseEx != null && !object.ReferenceEquals(baseEx, ex))
            {
                parts.Add("base_type=" + baseEx.GetType().FullName);
                parts.Add("base_message=" + (string.IsNullOrWhiteSpace(baseEx.Message) ? "(empty)" : baseEx.Message));
            }

            var innerParts = new List<string>();
            var depth = 0;
            for (var inner = ex.InnerException; inner != null && depth < 6; inner = inner.InnerException)
            {
                innerParts.Add(
                    "#" + depth.ToString(CultureInfo.InvariantCulture)
                    + ":" + inner.GetType().FullName
                    + ": " + (string.IsNullOrWhiteSpace(inner.Message) ? "(empty)" : inner.Message)
                );
                depth++;
            }
            if (innerParts.Count > 0)
                parts.Add("inner_chain=[" + string.Join(" | ", innerParts) + "]");

            if (!string.IsNullOrWhiteSpace(ex.StackTrace))
                parts.Add("stack=" + ex.StackTrace.Replace(Environment.NewLine, " | "));

            return string.Join(", ", parts);
        }

        private void LogHttpExceptionDetail(string operation, string accountId, HttpRequestMessage request, int timeoutSeconds, Exception ex)
        {
            var method = request != null && request.Method != null ? request.Method.Method : "(unknown)";
            var url = request != null && request.RequestUri != null ? request.RequestUri.ToString() : "(unknown)";
            var safeAccountId = string.IsNullOrWhiteSpace(accountId) ? "(empty)" : accountId;
            var safeProviderCode = string.IsNullOrWhiteSpace(ProviderCode) ? "(empty)" : ProviderCode;
            var detail = BuildExceptionDetail(ex);

            SafePrint(
                "[ErrorDetail] op={0}, source_id={1}, source_type={2}, account_id={3}, provider_code={4}, method={5}, url={6}, timeout_sec={7}, detail={8}",
                operation,
                BridgeSourceId,
                BridgeSourceType,
                safeAccountId,
                safeProviderCode,
                method,
                url,
                ClampTimeoutSeconds(timeoutSeconds, 10),
                detail
            );
        }

        private string ExtractJsonField(string raw, string fieldName)
        {
            if (string.IsNullOrWhiteSpace(raw) || string.IsNullOrWhiteSpace(fieldName))
                return "";
            var pattern = "\"" + Regex.Escape(fieldName) + "\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"";
            var match = Regex.Match(raw, pattern, RegexOptions.Singleline);
            if (!match.Success) return "";
            var value = match.Groups[1].Value;
            value = value.Replace("\\\"", "\"").Replace("\\\\", "\\").Replace("\\n", "\n").Replace("\\r", "\r").Trim();
            return value;
        }

        private void LogServerErrorDetail(string operation, string accountId, string rawResponse)
        {
            var safeAccountId = string.IsNullOrWhiteSpace(accountId) ? "(empty)" : accountId;
            var safeProviderCode = string.IsNullOrWhiteSpace(ProviderCode) ? "(empty)" : ProviderCode;
            var message = ExtractJsonField(rawResponse, "message");
            var code = ExtractJsonField(rawResponse, "code");
            var severity = ExtractJsonField(rawResponse, "severity");
            var table = ExtractJsonField(rawResponse, "table");
            var column = ExtractJsonField(rawResponse, "column");
            var constraint = ExtractJsonField(rawResponse, "constraint");
            var detail = ExtractJsonField(rawResponse, "detail");
            var where = ExtractJsonField(rawResponse, "where");
            var hint = ExtractJsonField(rawResponse, "hint");
            var schema = ExtractJsonField(rawResponse, "schema");
            var routine = ExtractJsonField(rawResponse, "routine");
            var summary = FormatServerErrorForPanel(rawResponse);
            SafePrint(
                "[ErrorDetail] op={0}, source_id={1}, source_type={2}, account_id={3}, provider_code={4}, server_error={5}, code={6}, severity={7}, table={8}, column={9}, constraint={10}, detail={11}, where={12}, hint={13}, schema={14}, routine={15}",
                operation,
                BridgeSourceId,
                BridgeSourceType,
                safeAccountId,
                safeProviderCode,
                string.IsNullOrWhiteSpace(message) ? summary : message,
                string.IsNullOrWhiteSpace(code) ? "(none)" : code,
                string.IsNullOrWhiteSpace(severity) ? "(none)" : severity,
                string.IsNullOrWhiteSpace(table) ? "(none)" : table,
                string.IsNullOrWhiteSpace(column) ? "(none)" : column,
                string.IsNullOrWhiteSpace(constraint) ? "(none)" : constraint,
                string.IsNullOrWhiteSpace(detail) ? "(none)" : detail,
                string.IsNullOrWhiteSpace(where) ? "(none)" : where,
                string.IsNullOrWhiteSpace(hint) ? "(none)" : hint,
                string.IsNullOrWhiteSpace(schema) ? "(none)" : schema,
                string.IsNullOrWhiteSpace(routine) ? "(none)" : routine
            );
        }

        private bool ShouldEmitTransientErrorLog()
        {
            var now = DateTime.Now;
            if (_errorStreakStartedAt == DateTime.MinValue)
                _errorStreakStartedAt = now;

            var streakSeconds = (now - _errorStreakStartedAt).TotalSeconds;
            var thresholdReached =
                _consecutiveErrors >= TransientErrorLogThresholdCount ||
                streakSeconds >= TransientErrorLogThresholdSeconds;

            if (!thresholdReached) return false;

            if (
                _lastTransientErrorLogTime != DateTime.MinValue &&
                (now - _lastTransientErrorLogTime).TotalSeconds < TransientErrorLogThresholdSeconds
            )
                return false;

            _lastTransientErrorLogTime = now;
            _errorStreakWasLogged = true;
            return true;
        }

        private void ResetTransientErrorTracking(string recoveryMessage)
        {
            var shouldLogRecovery = _consecutiveErrors > 0 && _errorStreakWasLogged;
            _consecutiveErrors = 0;
            _lastErrorClearTime = DateTime.Now;
            _errorStreakStartedAt = DateTime.MinValue;
            _lastTransientErrorLogTime = DateTime.MinValue;
            _errorStreakWasLogged = false;

            if (shouldLogRecovery)
                SafePrint(recoveryMessage);
        }

        private void StartMasterWatchdog(int intervalSec)
        {
            _watchdogCts = new CancellationTokenSource();
            var ct = _watchdogCts.Token;
            Task.Run(async () =>
            {
                while (!ct.IsCancellationRequested)
                {
                    try
                    {
                        await Task.Delay(TimeSpan.FromSeconds(Math.Max(2, intervalSec * 2)), ct);
                        if (ct.IsCancellationRequested) break;
                        var now = DateTime.Now;
                        var staleSec = Math.Max(5, intervalSec * 5);
                        if (_lastTimerTickSeen == DateTime.MinValue || (now - _lastTimerTickSeen).TotalSeconds >= staleSec)
                        {
                            SafePrint("[Watchdog] Master timer stale {0}s — kicking", (int)(now - _lastTimerTickSeen).TotalSeconds);
                            BeginInvokeOnMainThread(() => OnTimer());
                        }
                    }
                    catch (TaskCanceledException) { break; }
                    catch (Exception ex) { SafePrint("[Watchdog] Error: {0}", ex.Message); }
                }
            }, ct);
        }

        protected override void OnTick()
        {
            if (SelectedStrategy != ManagementStrategy.None)
                ManagePositions();
        }

        private void ManagePositions()
        {
            foreach (var pos in Positions)
            {
                // Only manage trades associated with our bridge (Comment or Label)
                if (pos.Label != "TVBridge" && string.IsNullOrEmpty(pos.Comment)) continue;

                var symbol = ResolveLoadedSymbol(pos.SymbolName);
                if (symbol == null) continue;

                double currentPrice = (pos.TradeType == TradeType.Buy) ? symbol.Bid : symbol.Ask;
                double pips = (pos.TradeType == TradeType.Buy)
                    ? (currentPrice - pos.EntryPrice) / symbol.PipSize
                    : (pos.EntryPrice - currentPrice) / symbol.PipSize;

                // 1. Break Even
                if (SelectedStrategy == ManagementStrategy.BreakEven || SelectedStrategy == ManagementStrategy.Both)
                {
                    if (pips >= BE_Trigger)
                    {
                        double targetSL = (pos.TradeType == TradeType.Buy)
                            ? pos.EntryPrice + (BE_Offset * symbol.PipSize)
                            : pos.EntryPrice - (BE_Offset * symbol.PipSize);

                        // Only move SL forward, never backward
                        bool needsMove = false;
                        if (!pos.StopLoss.HasValue) needsMove = true;
                        else if (pos.TradeType == TradeType.Buy && pos.StopLoss.Value < targetSL - (0.1 * symbol.PipSize)) needsMove = true;
                        else if (pos.TradeType == TradeType.Sell && pos.StopLoss.Value > targetSL + (0.1 * symbol.PipSize)) needsMove = true;

                        if (needsMove)
                        {
                            var oldSL = pos.StopLoss;
                            var result = ModifyPosition(pos, targetSL, pos.TakeProfit);
                            if (result.IsSuccessful)
                            {
                                SafePrint("[BE] Moved SL from {0:F5} to {1:F5} (Entry+{2} pips) for {3} #{4}", oldSL, targetSL, BE_Offset, pos.SymbolName, pos.Id);
                                // Immediate ack SL change to VPS
                                var beSid = ResolveSid(pos.Id.ToString(), pos.Comment);
                                if (!string.IsNullOrEmpty(beSid))
                                    SafeAck(beSid, "", "SL_CHANGED", pos.Id.ToString(), "", 0);
                            }
                            else
                                SafePrint("[BE] SL move FAILED for {0} #{1}: {2}", pos.SymbolName, pos.Id, result.Error);
                        }
                    }
                }

                // 2. Trailing Stop
                if (SelectedStrategy == ManagementStrategy.TrailingStop || SelectedStrategy == ManagementStrategy.Both)
                {
                    if (pips >= Trail_Start)
                    {
                        double targetSL = (pos.TradeType == TradeType.Buy)
                            ? currentPrice - (Trail_Start * symbol.PipSize)
                            : currentPrice + (Trail_Start * symbol.PipSize);

                        // If current SL is further away than targetSL by at least Trail_Step, move it
                        bool shouldMove = false;
                        if (!pos.StopLoss.HasValue) shouldMove = true;
                        else
                        {
                            double currentDiff = (pos.TradeType == TradeType.Buy)
                                ? (targetSL - pos.StopLoss.Value) / symbol.PipSize
                                : (pos.StopLoss.Value - targetSL) / symbol.PipSize;

                            if (currentDiff >= Trail_Step) shouldMove = true;
                        }

                        if (shouldMove)
                        {
                            var oldSL = pos.StopLoss;
                            var result = ModifyPosition(pos, targetSL, pos.TakeProfit);
                            if (result.IsSuccessful)
                            {
                                SafePrint("[Trail] Moved SL from {0:F5} to {1:F5} (trail={2} pips) for {3} #{4}", oldSL, targetSL, Trail_Start, pos.SymbolName, pos.Id);
                                // Immediate ack SL change to VPS
                                var trailSid = ResolveSid(pos.Id.ToString(), pos.Comment);
                                if (!string.IsNullOrEmpty(trailSid))
                                    SafeAck(trailSid, "", "SL_CHANGED", pos.Id.ToString(), "", 0);
                            }
                            else
                                SafePrint("[Trail] SL move FAILED for {0} #{1}: {2}", pos.SymbolName, pos.Id, result.Error);
                        }
                    }
                }

                // 3. Partial TPs
                var sid = pos.Comment;
                if (!string.IsNullOrEmpty(sid) && _tradePartials.ContainsKey(sid))
                {
                    var partials = _tradePartials[sid];
                    for (int i = 0; i < partials.Count; i++)
                    {
                        var p = partials[i];
                        string pKey = pos.Id + "_" + i;
                        if (_executedPartials.Contains(pKey)) continue;

                        bool hit = (pos.TradeType == TradeType.Buy) ? (currentPrice >= p.Price) : (currentPrice <= p.Price);
                        if (!hit) continue;  // price not reached yet, retry next tick

                        double volToClose = pos.VolumeInUnits * (p.SizePct / 100.0);
                        volToClose = symbol.NormalizeVolumeInUnits(volToClose, RoundingMode.Down);

                        // Only close if we can meet minimum volume; skip permanently if too small
                        if (volToClose >= symbol.VolumeInUnitsMin)
                        {
                            // Cap at current remaining size (never exceed position volume)
                            if (volToClose > pos.VolumeInUnits)
                                volToClose = pos.VolumeInUnits;

                            // Re-check min volume after capping
                            if (volToClose >= symbol.VolumeInUnitsMin)
                            {
                                var res = ClosePosition(pos, volToClose);
                                if (res.IsSuccessful)
                                {
                                    _executedPartials.Add(pKey);
                                    var ticketKey = pos.Id.ToString();
                                    if (_partialClosedVolumes.ContainsKey(ticketKey))
                                        _partialClosedVolumes[ticketKey] += volToClose;
                                    else
                                        _partialClosedVolumes[ticketKey] = volToClose;
                                    SafePrint("[Partial] Closed {0} units ({1}%) for {2} at {3}", volToClose, p.SizePct, pos.Id, p.Price);
                                    // Immediate ack partial close to VPS
                                    if (!string.IsNullOrEmpty(sid))
                                        SafeAck(sid, "", "PARTIAL_CLOSE", pos.Id.ToString(), "", 0);
                                }
                                else
                                {
                                    SafePrint("[Partial] Close failed for {0}: {1}", pos.Id, res.Error);
                                }
                            }
                            else
                            {
                                _executedPartials.Add(pKey);
                                SafePrint("[Partial] Skipped {0} idx {1} (post-cap too small: {2} < min {3})", pos.Id, i, volToClose, symbol.VolumeInUnitsMin);
                            }
                        }
                        else
                        {
                            _executedPartials.Add(pKey);
                            SafePrint("[Partial] Skipped {0} idx {1} (chunk too small: {2} < min {3})", pos.Id, i, volToClose, symbol.VolumeInUnitsMin);
                        }
                    }
                }
            }
        }

        protected override void OnTimer()
        {
            _lastTimerTickSeen = DateTime.Now;
            _masterTickCount++;
            _masterTimerTick = DateTime.Now;
            MasterTimerTick();
        }

        private void MasterTimerTick()
        {
            RefreshDebugPanelNow();

            if (_masterTickCount % 60 == 0) CleanupOldEntries();

            if (_consecutiveErrors > 0)
            {
                int bs = Math.Min(30, (int)Math.Pow(2, _consecutiveErrors - 1));
                if (bs > PollSeconds && _masterTickCount % Math.Max(1, bs / MasterTimerSeconds) != 0)
                    return;
            }

            var accId = Account.UserId.ToString();
            var now = DateTime.Now;
            var apiOffline = IsApiOfflineCooldownActive(now);
            var ancillaryReady = _successPolls > 0 || _syncCount > 0;

            // --- Sync / Pull first. Bars should not compete during startup or recovery. ---
            bool doSync = _lastSyncAttemptTime == DateTime.MinValue || (now - _lastSyncAttemptTime).TotalSeconds >= SyncIntervalSeconds;
            bool doPoll = _lastPollAttemptTime == DateTime.MinValue || (now - _lastPollAttemptTime).TotalSeconds >= PollSeconds;
            if (!apiOffline && doSync && !_busySync)
            {
                _lastSyncAttemptTime = now;
                _busySync = true; _syncStatus = "SYNCING";
                _syncOnly = true;
                DoTimerWork();
                return;
            }
            if (doPoll && !_busyPull && !_busySync)
            {
                _lastPollAttemptTime = now;
                _busyPull = true; _pollStatus = "POLLING"; _pollCount++;
                Task.Run(async () => { try { await PollSignalsAsync(accId); } catch { } finally { _busyPull = false; } });
                if (!ancillaryReady) return;
            }

            // --- Bar push ---
            if (!apiOffline && ancillaryReady && !_busyPull && !_busySync && BarPushEnabled && !_busyBars && (_lastBarTime == DateTime.MinValue || (now - _lastBarTime).TotalSeconds >= BarPushSeconds))
            {
                _busyBars = true; _barStatus = "PUSHING";
                var syms = GetActiveSymbols();
                if (syms.Count > 0)
                {
                    var bs = syms;
                    Task.Run(async () =>
                    {
                        try { await PushBarsAsync(accId, bs); }
                        catch (Exception ex) { _lastBarErr = ex.Message; _barStatus = "ERROR"; }
                        finally { _lastBarTime = DateTime.Now; _busyBars = false; }
                    });
                }
                else { _barStatus = "IDLE"; _lastBarTime = now; _busyBars = false; }
            }

            // --- Incremental bars ---
            if (!apiOffline && ancillaryReady && !_busyPull && !_busySync && !_busyBars && EnableIncrementalBars && !_busyIncSync && (_lastIncrementalSync == DateTime.MinValue || (now - _lastIncrementalSync).TotalSeconds >= IncrementalBarsSeconds))
            {
                _busyIncSync = true; _incrementalStatus = "SYNCING";
                var syms = GetActiveSymbols();
                if (syms.Count > 0)
                {
                    var iss = syms;
                    Task.Run(async () =>
                    {
                        try { await SyncBarsIncrementalAsync(accId, iss); }
                        catch (Exception ex) { _lastIncrementalErr = ex.Message; _incrementalStatus = "ERROR"; }
                        finally { _lastIncrementalSync = DateTime.Now; _busyIncSync = false; }
                    });
                }
                else { _incrementalStatus = "IDLE"; _lastIncrementalSync = now; _busyIncSync = false; }
            }

        }

        private List<string> GetActiveSymbols()
        {
            var syms = _trackedSymbols.Count > 0 ? new List<string>(_trackedSymbols) : new List<string>();
            if (syms.Count == 0)
            {
                foreach (var pos in Positions)
                    if (!string.IsNullOrWhiteSpace(pos.SymbolName) && !syms.Contains(pos.SymbolName)) syms.Add(pos.SymbolName);
                foreach (var order in PendingOrders)
                    if (!string.IsNullOrWhiteSpace(order.SymbolName) && !syms.Contains(order.SymbolName)) syms.Add(order.SymbolName);
                if (Symbol != null && !string.IsNullOrWhiteSpace(Symbol.Name) && !syms.Contains(Symbol.Name)) syms.Add(Symbol.Name);
            }
            return syms;
        }

        // Reads prices on main thread (cTrader API not thread-safe)
        private List<Tuple<string, double, double>> ReadPricesOnMainThread(List<string> symbols)
        {
            var result = new List<Tuple<string, double, double>>();
            foreach (var sym in symbols)
            {
                try
                {
                    Symbol s;
                    if (!TryResolveQuotedSymbol(sym, out s)) continue;
                    double bid = double.IsNaN(s.Bid) ? 0 : s.Bid;
                    double ask = double.IsNaN(s.Ask) ? 0 : s.Ask;
                    result.Add(Tuple.Create(s.Name, bid, ask));
                }
                catch { }
            }
            return result;
        }

        private bool ShouldPushPricesNow(DateTime now)
        {
            return PricePushEnabled && (_lastPriceTime == DateTime.MinValue || (now - _lastPriceTime).TotalSeconds >= PricePushSeconds);
        }

        private void DoTimerWork()
        {
            try
            {
                if (!_syncOnly)
                {
                    _pollCount++;
                    if (_pollCount <= 3) SafePrint("[Diag] OnTimer tick #" + _pollCount);
                    if (_pollCount % 10 == 0) CleanupOldEntries();
                }

                if (!_syncOnly && _consecutiveErrors > 0)
                {
                    int backoffSeconds = Math.Min(30, (int)Math.Pow(2, _consecutiveErrors - 1));
                    if (backoffSeconds > PollSeconds)
                    {
                        SafePrint("[Backoff] Skipping poll cycle for {0}s due to {1} consecutive errors", backoffSeconds, _consecutiveErrors);
                        return;
                    }
                }

                var accId = Account.UserId.ToString();

                if (!_syncOnly)
                {
                    // --- OHLC Bar push (every BarPushSeconds) ---
                    if (BarPushEnabled)
                    {
                        if (_lastBarTime == DateTime.MinValue ||
                            (DateTime.Now - _lastBarTime).TotalSeconds >= BarPushSeconds)
                        {
                            _barStatus = "PUSHING";
                            var syms = _trackedSymbols.Count > 0 ? _trackedSymbols : new List<string>();
                            if (syms.Count == 0)
                            {
                                foreach (var pos in Positions)
                                    if (!string.IsNullOrWhiteSpace(pos.SymbolName) && !syms.Contains(pos.SymbolName))
                                        syms.Add(pos.SymbolName);
                                foreach (var order in PendingOrders)
                                    if (!string.IsNullOrWhiteSpace(order.SymbolName) && !syms.Contains(order.SymbolName))
                                        syms.Add(order.SymbolName);
                                if (Symbol != null && !string.IsNullOrWhiteSpace(Symbol.Name) && !syms.Contains(Symbol.Name))
                                    syms.Add(Symbol.Name);
                            }
                            if (syms.Count > 0)
                                _ = PushBarsAsync(accId, syms);
                            else
                            {
                                _barStatus = "IDLE";
                                _lastBarTime = DateTime.Now;
                            }
                        }
                    }

                    // --- Incremental bars sync (every IncrementalBarsSeconds) ---
                    if (EnableIncrementalBars)
                    {
                        if (_lastIncrementalSync == DateTime.MinValue ||
                            (DateTime.Now - _lastIncrementalSync).TotalSeconds >= IncrementalBarsSeconds)
                        {
                            var incSyms = _trackedSymbols.Count > 0 ? _trackedSymbols : new List<string>();
                            if (incSyms.Count == 0)
                            {
                                foreach (var pos in Positions)
                                    if (!string.IsNullOrWhiteSpace(pos.SymbolName) && !incSyms.Contains(pos.SymbolName))
                                        incSyms.Add(pos.SymbolName);
                                if (Symbol != null && !string.IsNullOrWhiteSpace(Symbol.Name) && !incSyms.Contains(Symbol.Name))
                                    incSyms.Add(Symbol.Name);
                            }
                            if (incSyms.Count > 0)
                                Task.Run(async () => await SyncBarsIncrementalAsync(accId, incSyms));
                            _lastIncrementalSync = DateTime.Now;
                        }
                    }

                    // --- Sync: build payload + push to VPS (every SyncIntervalSeconds) ---
                    var now = DateTime.Now;
                    var doSync = _lastSyncTime == DateTime.MinValue ||
                        (now - _lastSyncTime).TotalSeconds >= SyncIntervalSeconds;
                    // Always pull signals on PollSeconds cadence

                    string balance = null, equity = null, margin = null, brokerName = null;
                    List<string> posList = null, ordersList = null, closedList = null, metricsList = null;
                    HashSet<string> activeTicketIds = null;

                    if (doSync)
                    {
                        balance = Account.Balance.ToString(CultureInfo.InvariantCulture);
                        equity = Account.Equity.ToString(CultureInfo.InvariantCulture);
                        margin = Account.Margin.ToString(CultureInfo.InvariantCulture);
                        brokerName = Account.BrokerName;
                        posList = new List<string>();
                        activeTicketIds = new HashSet<string>(Positions.Select(p => p.Id.ToString()));

                        foreach (var pos in Positions)
                        {
                            var sid = ResolveSid(pos.Id.ToString(), pos.Comment).Replace("\"", "'");
                            var s = ResolveLoadedSymbol(pos.SymbolName);
                            double lotsVal = (s != null) ? s.VolumeInUnitsToQuantity(pos.VolumeInUnits) : (pos.VolumeInUnits / 100000.0);

                            double tpPnl = 0;
                            double slPnl = 0;
                            double distanceTp = 0;
                            double distanceSl = 0;
                            double spreadVal = 0;
                            if (s != null)
                            {
                                spreadVal = double.IsNaN(s.Spread) ? 0 : s.Spread;
                                if (pos.TakeProfit.HasValue)
                                {
                                    double pips = (pos.TakeProfit.Value - pos.EntryPrice) / s.PipSize;
                                    if (pos.TradeType == TradeType.Sell) pips = -pips;
                                    tpPnl = pips * s.PipValue * pos.VolumeInUnits;
                                    distanceTp = Math.Abs(pips);
                                }
                                if (pos.StopLoss.HasValue)
                                {
                                    double pips = (pos.StopLoss.Value - pos.EntryPrice) / s.PipSize;
                                    if (pos.TradeType == TradeType.Sell) pips = -pips;
                                    slPnl = pips * s.PipValue * pos.VolumeInUnits;
                                    distanceSl = Math.Abs(pips);
                                }
                            }
                            double balanceTp = tpPnl;
                            double balanceSl = slPnl;

                            var ticketKey = pos.Id.ToString();
                            double partialClosedVol = 0;
                            _partialClosedVolumes.TryGetValue(ticketKey, out partialClosedVol);
                            double remainingVol = double.IsNaN(pos.VolumeInUnits) ? 0 : pos.VolumeInUnits;
                            bool hasPartial = partialClosedVol > 0;

                            posList.Add("{\"sid\":\"" + sid + "\"" +
                                ",\"comment\":\"" + sid + "\"" +
                                ",\"ticket\":\"" + pos.Id + "\"" +
                                ",\"symbol\":\"" + pos.SymbolName + "\"" +
                                ",\"side\":\"" + pos.TradeType.ToString().ToUpper() + "\"" +
                                ",\"type\":\"MARKET\"" +
                                ",\"entry\":" + (double.IsNaN(pos.EntryPrice) ? 0 : pos.EntryPrice).ToString("F5", CultureInfo.InvariantCulture) +
                                ",\"sl\":" + (pos.StopLoss ?? 0).ToString("F5", CultureInfo.InvariantCulture) +
                                ",\"tp\":" + (pos.TakeProfit ?? 0).ToString("F5", CultureInfo.InvariantCulture) +
                                ",\"volume\":" + (double.IsNaN(pos.VolumeInUnits) ? 0 : pos.VolumeInUnits).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"lots\":" + (double.IsNaN(lotsVal) ? 0 : lotsVal).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"pnl\":" + (double.IsNaN(pos.NetProfit) ? 0 : pos.NetProfit).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"pips\":" + (double.IsNaN(pos.Pips) ? 0 : pos.Pips).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"commission\":" + (double.IsNaN(pos.Commissions) ? 0 : pos.Commissions).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"swap\":" + (double.IsNaN(pos.Swap) ? 0 : pos.Swap).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"margin\":" + (double.IsNaN(pos.Margin) ? 0 : pos.Margin).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"tp_pnl\":" + (double.IsNaN(tpPnl) ? 0 : tpPnl).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"sl_pnl\":" + (double.IsNaN(slPnl) ? 0 : slPnl).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"spread\":" + spreadVal.ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"distance_sl\":" + distanceSl.ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"distance_tp\":" + distanceTp.ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"balance_sl\":" + balanceSl.ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"balance_tp\":" + balanceTp.ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"label\":\"" + pos.Label + "\"" +
                                ",\"status\":\"OPEN\"" +
                                ",\"remaining_volume\":" + remainingVol.ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"closed_volume_partial\":" + partialClosedVol.ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"has_partial\":" + (hasPartial ? "true" : "false") + "}");
                        }

                        closedList = new List<string>();
                        var historicalDeals = History.OrderByDescending(d => d.ClosingTime).ToList();
                        var limit = DateTime.UtcNow.AddDays(-2);
                        foreach (var deal in historicalDeals)
                        {
                            if (deal.ClosingTime < limit) continue;
                            if (_syncedClosedTickets.Contains(deal.PositionId.ToString())) continue;
                            if (closedList.Count >= 20) break;
                            var sid2 = ResolveSid(deal.PositionId.ToString(), deal.Comment).Replace("\"", "'");
                            string closeReason = "MANUAL_CLOSE";
                            closedList.Add("{\"sid\":\"" + sid2 + "\"" +
                                ",\"comment\":\"" + sid2 + "\"" +
                                ",\"ticket\":\"" + deal.PositionId + "\"" +
                                ",\"symbol\":\"" + deal.SymbolName + "\"" +
                                ",\"symbol_code\":\"" + deal.SymbolName + "\"" +
                                ",\"side\":\"" + deal.TradeType.ToString().ToUpper() + "\"" +
                                ",\"volume\":" + (double.IsNaN(deal.VolumeInUnits) ? 0 : deal.VolumeInUnits).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"pnl\":" + (double.IsNaN(deal.NetProfit) ? 0 : deal.NetProfit).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"pips\":0.0" +
                                ",\"commission\":" + (double.IsNaN(deal.Commissions) ? 0 : deal.Commissions).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"swap\":" + (double.IsNaN(deal.Swap) ? 0 : deal.Swap).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"status\":\"CLOSED\"" +
                                ",\"close_reason\":\"" + closeReason + "\"" +
                                ",\"closed_at\":\"" + deal.ClosingTime.ToString("O") + "\"" +
                                ",\"label\":\"" + deal.Label + "\"}");
                        }

                        ordersList = new List<string>();

                        foreach (var order in PendingOrders)
                        {
                            var sid3 = ResolveSid(order.Id.ToString(), order.Comment).Replace("\"", "'");
                            var s2 = ResolveLoadedSymbol(order.SymbolName);
                            double lotsVal2 = (s2 != null) ? s2.VolumeInUnitsToQuantity(order.VolumeInUnits) : (order.VolumeInUnits / 100000.0);
                            double pnlTp = 0, pnlSl = 0;
                            if (s2 != null)
                            {
                                if (order.TakeProfit.HasValue) { double pp = Math.Abs(order.TargetPrice - order.TakeProfit.Value) / s2.PipSize; pnlTp = pp * s2.PipValue * order.VolumeInUnits; }
                                if (order.StopLoss.HasValue) { double pp = Math.Abs(order.TargetPrice - order.StopLoss.Value) / s2.PipSize; pnlSl = -pp * s2.PipValue * order.VolumeInUnits; }
                            }
                            ordersList.Add("{\"sid\":\"" + sid3 + "\"" +
                                ",\"comment\":\"" + sid3 + "\"" +
                                ",\"ticket\":\"" + order.Id + "\"" +
                                ",\"symbol\":\"" + order.SymbolName + "\"" +
                                ",\"side\":\"" + order.TradeType.ToString().ToUpper() + "\"" +
                                ",\"type\":\"" + order.OrderType.ToString().ToUpper() + "\"" +
                                ",\"target_price\":" + order.TargetPrice.ToString("F5", CultureInfo.InvariantCulture) +
                                ",\"entry\":" + order.TargetPrice.ToString("F5", CultureInfo.InvariantCulture) +
                                ",\"sl\":" + (order.StopLoss ?? 0).ToString("F5", CultureInfo.InvariantCulture) +
                                ",\"tp\":" + (order.TakeProfit ?? 0).ToString("F5", CultureInfo.InvariantCulture) +
                                ",\"volume\":" + (double.IsNaN(order.VolumeInUnits) ? 0 : order.VolumeInUnits).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"lots\":" + (double.IsNaN(lotsVal2) ? 0 : lotsVal2).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"label\":\"" + order.Label + "\"" +
                                ",\"status\":\"PENDING\"" +
                                ",\"margin\":0.0" +
                                ",\"pnl_tp\":" + pnlTp.ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"pnl_sl\":" + pnlSl.ToString("F2", CultureInfo.InvariantCulture) + "}");
                        }

                        var symbolsToSync = new HashSet<string>();
                        if (Symbol != null && !string.IsNullOrWhiteSpace(Symbol.Name)) symbolsToSync.Add(Symbol.Name);
                        foreach (var pos in Positions) if (!string.IsNullOrWhiteSpace(pos.SymbolName)) symbolsToSync.Add(pos.SymbolName);
                        foreach (var order in PendingOrders) if (!string.IsNullOrWhiteSpace(order.SymbolName)) symbolsToSync.Add(order.SymbolName);

                        metricsList = new List<string>();
                        foreach (var symbolName in symbolsToSync.Take(100))
                        {
                            var s3 = ResolveLoadedSymbol(symbolName);
                            if (s3 == null) continue;
                            metricsList.Add("{\"symbol\":\"" + s3.Name + "\"" +
                                ",\"pip_value\":" + (double.IsNaN(s3.PipValue) ? 0 : s3.PipValue).ToString("F5", CultureInfo.InvariantCulture) +
                                ",\"spread\":" + (double.IsNaN(s3.Spread) ? 0 : s3.Spread).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"min_vol\":" + (double.IsNaN(s3.VolumeInUnitsMin) ? 0 : s3.VolumeInUnitsMin).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"step_vol\":" + (double.IsNaN(s3.VolumeInUnitsStep) ? 0 : s3.VolumeInUnitsStep).ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"pip_size\":" + (double.IsNaN(s3.PipSize) ? 0 : s3.PipSize).ToString("F8", CultureInfo.InvariantCulture) +
                                ",\"digits\":" + s3.Digits + "}");
                        }

                        // Show that a new cycle has started, but keep last successful stamps.
                        _pollStatus = _lastPollTime == DateTime.MinValue ? "POLLING" : _pollStatus;
                        _syncStatus = _lastSyncTime == DateTime.MinValue ? "SYNCING" : _syncStatus;
                    }
                    RefreshDebugPanelNow();

                    var bal = balance; var eq = equity; var mar = margin; var brk = brokerName;
                    var pl = posList; var ol = ordersList; var cl = closedList; var ml = metricsList;
                    var ati = activeTicketIds;
                    var syncSymbols = GetActiveSymbols();
                    var includePrices = ShouldPushPricesNow(DateTime.Now);
                    var priceData = includePrices ? ReadPricesOnMainThread(syncSymbols) : new List<Tuple<string, double, double>>();
                    if (includePrices && priceData.Count == 0)
                    {
                        _priceStatus = "IDLE";
                        _lastPriceErr = "No prices available";
                    }
                    var spd = priceData;
                    var ssl = syncSymbols;

                    Task.Run(async () =>
                    {
                        try
                        {
                            await PollSignalsAsync(accId);
                            if (doSync && pl != null)
                            {
                                double b, e, m;
                                if (!double.TryParse(bal, NumberStyles.Any, CultureInfo.InvariantCulture, out b)) b = 0;
                                if (!double.TryParse(eq, NumberStyles.Any, CultureInfo.InvariantCulture, out e)) e = 0;
                                if (!double.TryParse(mar, NumberStyles.Any, CultureInfo.InvariantCulture, out m)) m = 0;
                                await SyncWithVpsAsync(accId, b, e, m, brk, pl, ol, cl, ati, ml, spd, ssl);
                            }
                        }
                        catch (Exception ex)
                        {
                            _lastSyncErr = FormatServerErrorForPanel(ex.Message);
                            _syncStatus = "ERROR";
                        }
                        finally
                        {
                            _isBusy = false;
                            RefreshDebugPanel();
                        }
                    });
                }
                else
                {
                    // Sync-only: build full payload (positions + orders + closed + metrics)
                    BuildAndDispatchSync(accId);
                }
            }
            catch (Exception ex)
            {
                _serverStatus = "CLIENT_ERR";
                _apiStatus = "PREP_ERR";
                _pollStatus = "ERROR";
                _syncStatus = "ERROR";
                _lastPollErr = FormatServerErrorForPanel(ex.Message);
                _lastSyncErr = FormatServerErrorForPanel(ex.Message);
                _isBusy = false;
                RefreshDebugPanelNow();
            }
        }

        protected override void OnStop()
        {
            try { _watchdogCts?.Cancel(); } catch { }
            try { _watchdogCts?.Dispose(); } catch { }
        }

        // Full sync payload builder: positions + orders + closed + metrics
        private void BuildAndDispatchSync(string accId)
        {
            string bal = Account.Balance.ToString(CultureInfo.InvariantCulture);
            string eq = Account.Equity.ToString(CultureInfo.InvariantCulture);
            string mar = Account.Margin.ToString(CultureInfo.InvariantCulture);
            string brk = Account.BrokerName;
            var pl = new List<string>();
            var ati = new HashSet<string>(Positions.Select(p => p.Id.ToString()));
            foreach (var pos in Positions)
            {
                var sid = ResolveSid(pos.Id.ToString(), pos.Comment).Replace("\"", "'");
                var s = ResolveLoadedSymbol(pos.SymbolName);
                double lotsVal = (s != null) ? s.VolumeInUnitsToQuantity(pos.VolumeInUnits) : (pos.VolumeInUnits / 100000.0);
                double tpPnl = 0, slPnl = 0, distTp = 0, distSl = 0, spreadVal = 0;
                if (s != null)
                {
                    spreadVal = double.IsNaN(s.Spread) ? 0 : s.Spread;
                    if (pos.TakeProfit.HasValue) { double pips = (pos.TakeProfit.Value - pos.EntryPrice) / s.PipSize; if (pos.TradeType == TradeType.Sell) pips = -pips; tpPnl = pips * s.PipValue * pos.VolumeInUnits; distTp = Math.Abs(pips); }
                    if (pos.StopLoss.HasValue) { double pips = (pos.StopLoss.Value - pos.EntryPrice) / s.PipSize; if (pos.TradeType == TradeType.Sell) pips = -pips; slPnl = pips * s.PipValue * pos.VolumeInUnits; distSl = Math.Abs(pips); }
                }
                double balTp = tpPnl, balSl = slPnl;
                var tk = pos.Id.ToString(); double pcv = 0; _partialClosedVolumes.TryGetValue(tk, out pcv);
                double rv = double.IsNaN(pos.VolumeInUnits) ? 0 : pos.VolumeInUnits; bool hp = pcv > 0;
                pl.Add("{\"sid\":\"" + sid + "\",\"comment\":\"" + sid + "\",\"ticket\":\"" + pos.Id + "\",\"symbol\":\"" + pos.SymbolName + "\",\"side\":\"" + pos.TradeType.ToString().ToUpper() + "\",\"type\":\"MARKET\",\"entry\":" + (double.IsNaN(pos.EntryPrice) ? 0 : pos.EntryPrice).ToString("F5", CultureInfo.InvariantCulture) + ",\"sl\":" + (pos.StopLoss ?? 0).ToString("F5", CultureInfo.InvariantCulture) + ",\"tp\":" + (pos.TakeProfit ?? 0).ToString("F5", CultureInfo.InvariantCulture) + ",\"volume\":" + (double.IsNaN(pos.VolumeInUnits) ? 0 : pos.VolumeInUnits).ToString("F2", CultureInfo.InvariantCulture) + ",\"lots\":" + (double.IsNaN(lotsVal) ? 0 : lotsVal).ToString("F2", CultureInfo.InvariantCulture) + ",\"pnl\":" + (double.IsNaN(pos.NetProfit) ? 0 : pos.NetProfit).ToString("F2", CultureInfo.InvariantCulture) + ",\"pips\":" + (double.IsNaN(pos.Pips) ? 0 : pos.Pips).ToString("F2", CultureInfo.InvariantCulture) + ",\"commission\":" + (double.IsNaN(pos.Commissions) ? 0 : pos.Commissions).ToString("F2", CultureInfo.InvariantCulture) + ",\"swap\":" + (double.IsNaN(pos.Swap) ? 0 : pos.Swap).ToString("F2", CultureInfo.InvariantCulture) + ",\"margin\":" + (double.IsNaN(pos.Margin) ? 0 : pos.Margin).ToString("F2", CultureInfo.InvariantCulture) + ",\"tp_pnl\":" + (double.IsNaN(tpPnl) ? 0 : tpPnl).ToString("F2", CultureInfo.InvariantCulture) + ",\"sl_pnl\":" + (double.IsNaN(slPnl) ? 0 : slPnl).ToString("F2", CultureInfo.InvariantCulture) + ",\"spread\":" + spreadVal.ToString("F2", CultureInfo.InvariantCulture) + ",\"distance_sl\":" + distSl.ToString("F2", CultureInfo.InvariantCulture) + ",\"distance_tp\":" + distTp.ToString("F2", CultureInfo.InvariantCulture) + ",\"balance_sl\":" + balSl.ToString("F2", CultureInfo.InvariantCulture) + ",\"balance_tp\":" + balTp.ToString("F2", CultureInfo.InvariantCulture) + ",\"label\":\"" + pos.Label + "\",\"status\":\"OPEN\",\"remaining_volume\":" + rv.ToString("F2", CultureInfo.InvariantCulture) + ",\"closed_volume_partial\":" + pcv.ToString("F2", CultureInfo.InvariantCulture) + ",\"has_partial\":" + (hp ? "true" : "false") + "}");
            }
            // Build orders list
            var ol = new List<string>();
            foreach (var order in PendingOrders)
            {
                var sid3 = ResolveSid(order.Id.ToString(), order.Comment).Replace("\"", "'");
                var s2 = ResolveLoadedSymbol(order.SymbolName); double lotsVal2 = (s2 != null) ? s2.VolumeInUnitsToQuantity(order.VolumeInUnits) : (order.VolumeInUnits / 100000.0);
                double pnlTp = 0, pnlSl = 0; if (s2 != null) { if (order.TakeProfit.HasValue) { double pp = Math.Abs(order.TargetPrice - order.TakeProfit.Value) / s2.PipSize; pnlTp = pp * s2.PipValue * order.VolumeInUnits; } if (order.StopLoss.HasValue) { double pp = Math.Abs(order.TargetPrice - order.StopLoss.Value) / s2.PipSize; pnlSl = -pp * s2.PipValue * order.VolumeInUnits; } }
                ol.Add("{\"sid\":\"" + sid3 + "\",\"comment\":\"" + sid3 + "\",\"ticket\":\"" + order.Id + "\",\"symbol\":\"" + order.SymbolName + "\",\"side\":\"" + order.TradeType.ToString().ToUpper() + "\",\"type\":\"" + order.OrderType.ToString().ToUpper() + "\",\"target_price\":" + order.TargetPrice.ToString("F5", CultureInfo.InvariantCulture) + ",\"entry\":" + order.TargetPrice.ToString("F5", CultureInfo.InvariantCulture) + ",\"sl\":" + (order.StopLoss ?? 0).ToString("F5", CultureInfo.InvariantCulture) + ",\"tp\":" + (order.TakeProfit ?? 0).ToString("F5", CultureInfo.InvariantCulture) + ",\"volume\":" + (double.IsNaN(order.VolumeInUnits) ? 0 : order.VolumeInUnits).ToString("F2", CultureInfo.InvariantCulture) + ",\"lots\":" + (double.IsNaN(lotsVal2) ? 0 : lotsVal2).ToString("F2", CultureInfo.InvariantCulture) + ",\"label\":\"" + order.Label + "\",\"status\":\"PENDING\",\"margin\":0.0,\"pnl_tp\":" + pnlTp.ToString("F2", CultureInfo.InvariantCulture) + ",\"pnl_sl\":" + pnlSl.ToString("F2", CultureInfo.InvariantCulture) + "}");
            }
            // Build closed list
            var cl = new List<string>();
            var hd = History.OrderByDescending(d => d.ClosingTime).ToList();
            var lim = DateTime.UtcNow.AddDays(-2);
            foreach (var deal in hd) { if (deal.ClosingTime < lim) continue; if (_syncedClosedTickets.Contains(deal.PositionId.ToString())) continue; if (cl.Count >= 20) break; var sid2 = ResolveSid(deal.PositionId.ToString(), deal.Comment).Replace("\"", "'"); cl.Add("{\"sid\":\"" + sid2 + "\",\"comment\":\"" + sid2 + "\",\"ticket\":\"" + deal.PositionId + "\",\"symbol\":\"" + deal.SymbolName + "\",\"side\":\"" + deal.TradeType.ToString().ToUpper() + "\",\"volume\":" + (double.IsNaN(deal.VolumeInUnits) ? 0 : deal.VolumeInUnits).ToString("F2", CultureInfo.InvariantCulture) + ",\"pnl\":" + (double.IsNaN(deal.NetProfit) ? 0 : deal.NetProfit).ToString("F2", CultureInfo.InvariantCulture) + ",\"pips\":0.0,\"commission\":" + (double.IsNaN(deal.Commissions) ? 0 : deal.Commissions).ToString("F2", CultureInfo.InvariantCulture) + ",\"swap\":" + (double.IsNaN(deal.Swap) ? 0 : deal.Swap).ToString("F2", CultureInfo.InvariantCulture) + ",\"status\":\"CLOSED\",\"close_reason\":\"MANUAL_CLOSE\",\"closed_at\":\"" + deal.ClosingTime.ToString("O") + "\",\"label\":\"" + deal.Label + "\"}"); }
            // Build metrics
            var ml = new List<string>();
            var ssm = new HashSet<string>(); if (Symbol != null && !string.IsNullOrWhiteSpace(Symbol.Name)) ssm.Add(Symbol.Name); foreach (var pos in Positions) if (!string.IsNullOrWhiteSpace(pos.SymbolName)) ssm.Add(pos.SymbolName); foreach (var order in PendingOrders) if (!string.IsNullOrWhiteSpace(order.SymbolName)) ssm.Add(order.SymbolName);
            foreach (var sn in ssm.Take(100)) { var s3 = ResolveLoadedSymbol(sn); if (s3 == null) continue; ml.Add("{\"symbol\":\"" + s3.Name + "\",\"pip_value\":" + (double.IsNaN(s3.PipValue) ? 0 : s3.PipValue).ToString("F5", CultureInfo.InvariantCulture) + ",\"spread\":" + (double.IsNaN(s3.Spread) ? 0 : s3.Spread).ToString("F2", CultureInfo.InvariantCulture) + ",\"min_vol\":" + (double.IsNaN(s3.VolumeInUnitsMin) ? 0 : s3.VolumeInUnitsMin).ToString("F2", CultureInfo.InvariantCulture) + ",\"step_vol\":" + (double.IsNaN(s3.VolumeInUnitsStep) ? 0 : s3.VolumeInUnitsStep).ToString("F2", CultureInfo.InvariantCulture) + ",\"pip_size\":" + (double.IsNaN(s3.PipSize) ? 0 : s3.PipSize).ToString("F8", CultureInfo.InvariantCulture) + ",\"digits\":" + s3.Digits + "}"); }
            var syncSymbols = GetActiveSymbols();
            var includePrices = ShouldPushPricesNow(DateTime.Now);
            var priceData = includePrices ? ReadPricesOnMainThread(syncSymbols) : new List<Tuple<string, double, double>>();
            if (includePrices && priceData.Count == 0)
            {
                _priceStatus = "IDLE";
                _lastPriceErr = "No prices available";
            }
            // Dispatch
            _syncOnly = false;
            Task.Run(async () =>
            {
                try
                {
                    double b, e, m;
                    if (!double.TryParse(bal, NumberStyles.Any, CultureInfo.InvariantCulture, out b)) b = 0;
                    if (!double.TryParse(eq, NumberStyles.Any, CultureInfo.InvariantCulture, out e)) e = 0;
                    if (!double.TryParse(mar, NumberStyles.Any, CultureInfo.InvariantCulture, out m)) m = 0;
                    await SyncWithVpsAsync(accId, b, e, m, brk, pl, ol, cl, ati, ml, priceData, syncSymbols);
                }
                catch (Exception ex) { _lastSyncErr = FormatServerErrorForPanel(ex.Message); _syncStatus = "ERROR"; }
                finally { _busySync = false; RefreshDebugPanel(); }
            });
        }

        private async Task PollSignalsAsync(string accountId)
        {
            _pollCount++;
            _pollStatus = "POLLING";
            HttpRequestMessage request = null;
            var startedAt = DateTime.Now;
            try
            {
                var url = BuildServerApiUrl("broker/pull") + "?account_id=" + accountId + "&max_items=50";
                using (request = new HttpRequestMessage(System.Net.Http.HttpMethod.Get, url))
                {
                    request.Headers.Add("x-api-key", EaApiKey);
                    var response = await SendWithTimeoutAsync(
                        request,
                        PollTimeoutSeconds
                    );

                    _serverStatus = (int)response.StatusCode < 500 ? "OK" : "SERVER_ERR";

                    if (response.IsSuccessStatusCode)
                    {
                        _lastPollLatencyMs = Math.Max(0, (long)(DateTime.Now - startedAt).TotalMilliseconds);
                        _pollConsecutiveFailures = 0;
                        MarkApiReachable();
                        _apiStatus = "OK";
                        _successPolls++;
                        _lastPollTime = DateTime.Now;
                        _pollStatus = "OK";
                        _lastPollErr = "None";

                        // Reset error counter on successful poll
                        if (_consecutiveErrors > 0)
                        {
                            ResetTransientErrorTracking("[Recovery] Error counter reset after successful poll");
                        }

                        var json = await response.Content.ReadAsStringAsync();
                        RunOnMainThread(() => ProcessResponse(json));
                    }
                    else
                    {
                        _lastPollLatencyMs = Math.Max(0, (long)(DateTime.Now - startedAt).TotalMilliseconds);
                        _pollConsecutiveFailures++;
                        _hasPullServerSummary = false;
                        _apiStatus = (response.StatusCode == HttpStatusCode.Unauthorized || response.StatusCode == HttpStatusCode.Forbidden) ? "KEY_INVALID" : "ERR_" + (int)response.StatusCode;
                        _pollStatus = "FAIL";
                        _lastPollErr = await response.Content.ReadAsStringAsync();
                        if (string.IsNullOrEmpty(_lastPollErr)) _lastPollErr = "HTTP " + (int)response.StatusCode;

                        // Increment error counter for non-successful responses
                        _consecutiveErrors++;
                        SafePrint("[Error] Poll failed: {0} (consecutive errors: {1})", _lastPollErr, _consecutiveErrors);
                    }
                }
            }
            catch (Exception ex)
            {
                _lastPollLatencyMs = Math.Max(0, (long)(DateTime.Now - startedAt).TotalMilliseconds);
                _pollConsecutiveFailures++;
                _hasPullServerSummary = false;
                MarkApiOfflineCooldown();
                _pollStatus = "ERROR";
                _lastPollErr = ex.Message;

                // Increment error counter for exceptions
                _consecutiveErrors++;
                if (ShouldEmitTransientErrorLog())
                {
                    SafePrint("[Error] Poll exception: {0} (consecutive errors: {1})", ex.Message, _consecutiveErrors);
                    LogHttpExceptionDetail("poll", accountId, request, PollTimeoutSeconds, ex);
                }
            }
            finally
            {
                RefreshDebugPanel();
            }
        }

        private void ProcessResponse(string json)
        {
            ResetPollCycle(0);
            if (string.IsNullOrEmpty(json) || !json.Contains("\"items\"")) return;
            _hasPullServerSummary = true;
            var pullSummaryJson = GetJsonObject(json, "pull_summary");
            if (!string.IsNullOrEmpty(pullSummaryJson))
            {
                _lastPullServerTradeCount = GetJsonInt(pullSummaryJson, "trades");
                _lastPullServerSymbolCount = GetJsonInt(pullSummaryJson, "symbols");
                _lastPullServerStrategyCount = GetJsonInt(pullSummaryJson, "strategies");
            }

            var watchlistSymbols = GetJsonStringArray(json, "watchlist_symbols");
            _lastWatchlistSymbolCount = watchlistSymbols.Count;
            _lastWatchlistSymbolsText = watchlistSymbols.Count > 0 ? string.Join(",", watchlistSymbols.Take(12)) : "None";

            var requestedSymbols = GetJsonStringArray(json, "symbols");
            if (requestedSymbols.Count > 0)
            {
                ApplyTrackedSymbolsFromServer(requestedSymbols);
                if (_lastPullServerSymbolCount <= 0) _lastPullServerSymbolCount = requestedSymbols.Count;
            }
            var itemsMatch = Regex.Match(json, "\"items\"\\s*:\\s*\\[(.*)\\]", RegexOptions.Singleline);
            if (!itemsMatch.Success) return;
            var itemsBody = itemsMatch.Groups[1].Value;
            // Balanced bracket parser — handles nested JSON in metadata
            var objects = new List<string>();
            int depth = 0, start = -1;
            for (int i = 0; i < itemsBody.Length; i++)
            {
                if (itemsBody[i] == '{')
                {
                    if (depth == 0) start = i;
                    depth++;
                }
                else if (itemsBody[i] == '}')
                {
                    depth--;
                    if (depth == 0 && start >= 0)
                    {
                        objects.Add(itemsBody.Substring(start, i - start + 1));
                        start = -1;
                    }
                }
            }
            _lastPollSummary.Read = objects.Count;
            if (_lastPullServerTradeCount <= 0) _lastPullServerTradeCount = objects.Count;
            foreach (var obj in objects) ExecuteSignal(obj);
        }

        private void ExecuteSignal(string json)
        {
            var id = GetJsonValue(json, "sid");
            if (string.IsNullOrEmpty(id)) id = GetJsonValue(json, "signal_id");
            var leaseToken = GetJsonValue(json, "lease_token");
            var taskType = GetJsonValue(json, "type").ToUpper();
            if (string.IsNullOrEmpty(taskType)) taskType = "OPEN";
            var action = GetJsonValue(json, "action").ToUpper();
            var symbolCode = GetJsonValue(json, "symbol").ToUpper();
            var ticketStr = GetJsonValue(json, "ticket");
            long ticketNum = 0;
            if (!string.IsNullOrEmpty(ticketStr)) long.TryParse(ticketStr, out ticketNum);

            if (string.IsNullOrEmpty(id)) return;

            // Dedup by lease: skip if this exact (sid, lease_token) already processed
            var leaseKey = BuildLeaseKey(id, leaseToken);
            if (!string.IsNullOrEmpty(leaseToken) && _processedLeases.Contains(leaseKey)) return;
            if (!string.IsNullOrEmpty(leaseToken)) _processedLeases.Add(leaseKey);

            SafePrint("[Debug] Task Received: type={0} action={1} symbol={2} ticket={3} (ID: {4})", taskType, action, symbolCode, ticketNum, id);

            BeginInvokeOnMainThread(() =>
            {
                try
                {
                    var symbol = ResolveLoadedSymbol(symbolCode);

                    if (symbol == null)
                    {
                        var msg = "Symbol not found: " + symbolCode;
                        RecordPollEvent("", id, symbolCode, action, "REJECTED_SYMBOL", msg, "error");
                        SafeAck(id, leaseToken, "REJECTED", "", msg);
                        SafePrint("[Error] Symbol '{0}' not found in your platform.", symbolCode);
                        return;
                    }

                    symbolCode = symbol.Name;

                    // Shared variables for all task types
                    var sl = ParseDouble(GetJsonValue(json, "sl"));
                    var tp = ParseDouble(GetJsonValue(json, "tp"));
                    if (tp <= 0) tp = ParseDouble(GetJsonValue(json, "tp1"));

                // --- CANCEL: close position or delete order ---
                if (taskType == "CANCEL")
                {
                    if (ticketNum > 0)
                    {
                        // Try position close first (open positions)
                        var pos = Positions.FirstOrDefault(p => p.Id == ticketNum);
                        if (pos != null)
                        {
                            var cRes = ClosePosition(pos);
                            if (cRes.IsSuccessful)
                            {
                                RecordPollEvent(ticketStr, id, symbolCode, action, "CANCELLED_POSITION", "cancel_close_ok", "closed");
                                SafeAck(id, leaseToken, "CANCELLED", ticketStr, "cancel_close_ok");
                            }
                            else
                            {
                                RecordPollEvent(ticketStr, id, symbolCode, action, "CANCEL_CLOSE_FAILED", cRes.Error.ToString(), "error");
                                SafeAck(id, leaseToken, "ERROR", ticketStr, "cancel_close_fail: " + cRes.Error);
                            }
                        }
                        else
                        {
                            // Try order cancel (pending orders)
                            var ord = PendingOrders.FirstOrDefault(o => o.Id == ticketNum);
                            if (ord != null)
                            {
                                var oRes = CancelPendingOrder(ord);
                                if (oRes.IsSuccessful)
                                {
                                    RecordPollEvent(ticketStr, id, symbolCode, action, "CANCELLED_ORDER", "cancel_order_ok", "closed");
                                    SafeAck(id, leaseToken, "CANCELLED", ticketStr, "cancel_order_ok");
                                }
                                else
                                {
                                    RecordPollEvent(ticketStr, id, symbolCode, action, "CANCEL_ORDER_FAILED", oRes.Error.ToString(), "error");
                                    SafeAck(id, leaseToken, "ERROR", ticketStr, "cancel_order_fail: " + oRes.Error);
                                }
                            }
                            else
                            {
                                // Ticket not found as position or order — close by comment/label fallback
                                var targets = Positions.Where(p => p.SymbolName == symbolCode && (CommentMatchesSid(p.Comment, id) || p.Label == MagicNumber.ToString())).ToList();
                                int successfulPositionCancels = 0;
                                foreach (var p in targets)
                                {
                                    var pRes = ClosePosition(p);
                                    if (pRes.IsSuccessful) successfulPositionCancels++;
                                    else SafePrint("[Error] Cancel close failed: {0}", pRes.Error);
                                }
                                var ordTargets = PendingOrders.Where(o => o.SymbolName == symbolCode && (CommentMatchesSid(o.Comment, id) || o.Label == MagicNumber.ToString())).ToList();
                                int successfulOrderCancels = 0;
                                foreach (var o in ordTargets)
                                {
                                    var oRes = CancelPendingOrder(o);
                                    if (oRes.IsSuccessful) successfulOrderCancels++;
                                    else SafePrint("[Error] Cancel order failed: {0}", oRes.Error);
                                }
                                int totalCancelled = successfulPositionCancels + successfulOrderCancels;
                                if (totalCancelled > 0)
                                {
                                    RecordPollEvent(ticketStr, id, symbolCode, action, "CANCELLED_MATCHED_ITEMS", "matched=" + totalCancelled.ToString(CultureInfo.InvariantCulture), "closed");
                                    SafeAck(id, leaseToken, "CANCELLED", ticketStr, "cancel_ok");
                                }
                                else
                                {
                                    RecordPollEvent(ticketStr, id, symbolCode, action, "CANCEL_MATCHED_ITEMS_FAILED", "matched=0", "error");
                                    SafeAck(id, leaseToken, "ERROR", ticketStr, "cancel_no_ticket");
                                }
                            }
                        }
                    }
                    else
                    {
                        // No ticket — close by comment/label fallback
                        var targets = Positions.Where(p => p.SymbolName == symbolCode && (CommentMatchesSid(p.Comment, id) || p.Label == MagicNumber.ToString())).ToList();
                        int successfulPositionCancels = 0;
                        foreach (var p in targets)
                        {
                            var pRes = ClosePosition(p);
                            if (pRes.IsSuccessful) successfulPositionCancels++;
                            else SafePrint("[Error] Cancel close failed: {0}", pRes.Error);
                        }
                        var ordTargets = PendingOrders.Where(o => o.SymbolName == symbolCode && (CommentMatchesSid(o.Comment, id) || o.Label == MagicNumber.ToString())).ToList();
                        int successfulOrderCancels = 0;
                        foreach (var o in ordTargets)
                        {
                            var oRes = CancelPendingOrder(o);
                            if (oRes.IsSuccessful) successfulOrderCancels++;
                            else SafePrint("[Error] Cancel order failed: {0}", oRes.Error);
                        }
                        int totalCancelled = successfulPositionCancels + successfulOrderCancels;
                        if (totalCancelled > 0)
                        {
                            RecordPollEvent(ticketStr, id, symbolCode, action, "CANCELLED_MATCHED_ITEMS", "matched=" + totalCancelled.ToString(CultureInfo.InvariantCulture), "closed");
                            SafeAck(id, leaseToken, "CANCELLED", ticketStr, "cancel_ok");
                        }
                        else
                        {
                            RecordPollEvent(ticketStr, id, symbolCode, action, "CANCEL_MATCHED_ITEMS_FAILED", "matched=0", "error");
                            SafeAck(id, leaseToken, "ERROR", ticketStr, "cancel_no_pos");
                        }
                    }
                    return;
                }

                // --- CLOSE: close positions by comment/label ---
                if (taskType == "CLOSE")
                {
                    if (ticketNum > 0)
                    {
                        var pos = Positions.FirstOrDefault(p => p.Id == ticketNum);
                        if (pos != null)
                        {
                            var cRes = ClosePosition(pos);
                            if (cRes.IsSuccessful)
                            {
                                RecordPollEvent(ticketStr, id, symbolCode, action, "CLOSED_POSITION", "close_ok", "closed");
                                SafeAck(id, leaseToken, "CLOSED", ticketStr, "close_ok");
                            }
                            else
                            {
                                RecordPollEvent(ticketStr, id, symbolCode, action, "CLOSE_FAILED", cRes.Error.ToString(), "error");
                                SafeAck(id, leaseToken, "ERROR", ticketStr, "close_fail: " + cRes.Error);
                            }
                            return;
                        }
                    }
                    var targets = Positions.Where(p => p.SymbolName == symbolCode && (CommentMatchesSid(p.Comment, id) || p.Label == MagicNumber.ToString())).ToList();
                    int successfulCloses = 0;
                    foreach (var p in targets)
                    {
                        var cRes = ClosePosition(p);
                        if (cRes.IsSuccessful) successfulCloses++;
                        else SafePrint("[Error] Close failed: {0}", cRes.Error);
                    }
                    if (successfulCloses > 0)
                    {
                        RecordPollEvent(ticketStr, id, symbolCode, action, "CLOSED_MATCHED_ITEMS", "matched=" + successfulCloses.ToString(CultureInfo.InvariantCulture), "closed");
                        SafeAck(id, leaseToken, "CLOSED", ticketStr, "close_ok");
                    }
                    else
                    {
                        RecordPollEvent(ticketStr, id, symbolCode, action, "CLOSE_MATCHED_ITEMS_FAILED", "matched=0", "error");
                        SafeAck(id, leaseToken, "ERROR", ticketStr, "close_no_pos");
                    }
                    return;
                }

                // --- MODIFY: update SL/TP on position or order ---
                if (taskType == "MODIFY")
                {
                    if (ticketNum > 0)
                    {
                        var pos = Positions.FirstOrDefault(p => p.Id == ticketNum);
                        if (pos != null)
                        {
                            var mRes = ModifyPosition(pos, (sl > 0 ? sl : (double?)null), (tp > 0 ? tp : (double?)null));
                            if (mRes.IsSuccessful)
                            {
                                RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATED_POSITION", "sl_tp_modified", "changed");
                                SafeAck(id, leaseToken, "FILLED", ticketStr, "");
                            }
                            else
                            {
                                RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATE_FAILED", mRes.Error.ToString(), "error");
                                SafeAck(id, leaseToken, "ERROR", ticketStr, "modify_fail: " + mRes.Error);
                            }
                            return;
                        }
                        var ord = PendingOrders.FirstOrDefault(o => o.Id == ticketNum);
                        if (ord != null)
                        {
                            double requestedLots = ParseDouble(GetJsonValue(json, "lots"));
                            if (requestedLots <= 0) requestedLots = ParseDouble(GetJsonValue(json, "volume"));
                            double requestedTargetPrice = ParseDouble(GetJsonValue(json, "price"));
                            if (requestedTargetPrice <= 0) requestedTargetPrice = ParseDouble(GetJsonValue(json, "entry"));
                            double currentLots = symbol.VolumeInUnitsToQuantity(ord.VolumeInUnits);
                            bool wantsVolumeChange = requestedLots > 0 && Math.Abs(requestedLots - currentLots) > 0.0001;
                            double nextTargetPrice = requestedTargetPrice > 0 ? requestedTargetPrice : ord.TargetPrice;

                            if (wantsVolumeChange)
                            {
                                double newVolumeUnits = symbol.QuantityToVolumeInUnits(requestedLots);
                                newVolumeUnits = symbol.NormalizeVolumeInUnits(newVolumeUnits, RoundingMode.Down);
                                if (newVolumeUnits < symbol.VolumeInUnitsMin)
                                {
                                    RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATE_REJECTED", "modify_volume_too_small", "error");
                                    SafeAck(id, leaseToken, "ERROR", ticketStr, "modify_volume_too_small");
                                    return;
                                }

                                var cancelRes = CancelPendingOrder(ord);
                                if (!cancelRes.IsSuccessful)
                                {
                                    RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATE_FAILED", "modify_cancel_fail: " + cancelRes.Error, "error");
                                    SafeAck(id, leaseToken, "ERROR", ticketStr, "modify_cancel_fail: " + cancelRes.Error);
                                    return;
                                }

                                TradeResult replaceRes = null;
                                var replacementBrokerComment = BuildBrokerComment(id);
                                if (ord.OrderType == PendingOrderType.Limit)
                                {
                                    replaceRes = PlaceLimitOrder(ord.TradeType, symbol.Name, newVolumeUnits, nextTargetPrice, ord.Label, null, null, ord.ExpirationTime, replacementBrokerComment);
                                }
                                else
                                {
                                    replaceRes = PlaceStopOrder(ord.TradeType, symbol.Name, newVolumeUnits, nextTargetPrice, ord.Label, null, null, ord.ExpirationTime, replacementBrokerComment);
                                }

                                if (!replaceRes.IsSuccessful || replaceRes.PendingOrder == null)
                                {
                                    RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATE_FAILED", "modify_replace_fail", "error");
                                    SafeAck(id, leaseToken, "ERROR", ticketStr, "modify_replace_fail: " + (replaceRes != null ? replaceRes.Error.ToString() : "unknown"));
                                    return;
                                }

                                ord = replaceRes.PendingOrder;
                                ticketStr = ord.Id.ToString();
                                if (!string.IsNullOrWhiteSpace(ticketStr) && !string.IsNullOrWhiteSpace(id))
                                    _ticketSidMap[ticketStr] = id;
                            }

                            double? slPips = null;
                            double? tpPips = null;
                            if (sl > 0) slPips = Math.Round((action == "BUY" ? (nextTargetPrice - sl) : (sl - nextTargetPrice)) / symbol.PipSize, 2);
                            if (tp > 0) tpPips = Math.Round((action == "BUY" ? (tp - nextTargetPrice) : (nextTargetPrice - tp)) / symbol.PipSize, 2);
                            var mRes = ModifyPendingOrder(ord, nextTargetPrice, slPips, tpPips, ord.ExpirationTime);
                            if (mRes.IsSuccessful)
                            {
                                RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATED_ORDER", wantsVolumeChange ? "volume_and_sl_tp_modified" : "sl_tp_modified", "changed");
                                SafeAck(id, leaseToken, "PENDING", ticketStr, "");
                            }
                            else
                            {
                                RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATE_FAILED", mRes.Error.ToString(), "error");
                                SafeAck(id, leaseToken, "ERROR", ticketStr, "modify_fail: " + mRes.Error);
                            }
                            return;
                        }
                    }
                    RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATE_FAILED", "modify_no_ticket", "error");
                    SafeAck(id, leaseToken, "ERROR", "", "modify_no_ticket");
                    return;
                }

                // --- OPEN (default): create new position/order ---
                if (Positions.Any(p => CommentMatchesSid(p.Comment, id)))
                {
                    RecordPollEvent("ALREADY_OPEN", id, symbolCode, action, "UNCHANGED_OPEN_POSITION", "", "unchanged", false);
                    SafeAck(id, leaseToken, "FILLED", "ALREADY_OPEN", "");
                    return;
                }
                if (PendingOrders.Any(o => CommentMatchesSid(o.Comment, id)))
                {
                    RecordPollEvent("ALREADY_PLACED", id, symbolCode, action, "UNCHANGED_PENDING_ORDER", "", "unchanged", false);
                    SafeAck(id, leaseToken, "PENDING", "ALREADY_PLACED", "");
                    return;
                }

                var entry = ParseDouble(GetJsonValue(json, "entry"));
                var orderTypeStr = GetJsonValue(json, "order_type").ToLower();
                if (string.IsNullOrEmpty(orderTypeStr)) orderTypeStr = "market";

                var currentPrice = (action == "BUY") ? symbol.Ask : symbol.Bid;
                var executionPrice = (orderTypeStr == "market" || entry <= 0) ? currentPrice : entry;

                string volStr = GetJsonValue(json, "risk_pct");
                if (string.IsNullOrEmpty(volStr)) volStr = GetJsonValue(json, "volume");
                double signalRiskPct = ParseDouble(volStr);

                double riskMoneyRaw = ParseDouble(GetJsonValue(json, "risk_money_planned"));
                if (riskMoneyRaw <= 0) riskMoneyRaw = ParseDouble(GetJsonValue(json, "risk_money"));
                double requestedRiskMoney = 0;

                if (riskMoneyRaw > 0)
                {
                    requestedRiskMoney = riskMoneyRaw;
                }
                else if (signalRiskPct > 0)
                {
                    requestedRiskMoney = Account.Balance * (signalRiskPct / 100.0);
                }
                else
                {
                    requestedRiskMoney = Account.Balance * (MaxRiskPercent / 100.0);
                }

                double maxRiskFromPct = Account.Balance * (MaxRiskPercent / 100.0);
                double finalRiskMoney = Math.Min(requestedRiskMoney, maxRiskFromPct);
                finalRiskMoney = Math.Min(finalRiskMoney, MaxRiskAmount);

                double volumeUnits = symbol.VolumeInUnitsMin;

                if (sl > 0)
                {
                    double slPips = Math.Abs(executionPrice - sl) / symbol.PipSize;
                    if (slPips > 0)
                    {
                        try
                        {
                            // Use cTrader native risk model per symbol to keep sizing consistent across FX/indices/metals.
                            volumeUnits = symbol.VolumeForFixedRisk(finalRiskMoney, slPips);
                            volumeUnits = symbol.NormalizeVolumeInUnits(volumeUnits, RoundingMode.Down);
                        }
                        catch
                        {
                            // Fallback: legacy formula
                            double slTicks = Math.Abs(executionPrice - sl) / symbol.TickSize;
                            double riskPerUnit = slTicks * symbol.TickValue;
                            if (riskPerUnit > 0)
                            {
                                volumeUnits = finalRiskMoney / riskPerUnit;
                                volumeUnits = symbol.NormalizeVolumeInUnits(volumeUnits, RoundingMode.Down);
                            }
                        }
                    }
                }
                else
                {
                    double explicitLots = ParseDouble(GetJsonValue(json, "lots"));
                    if (explicitLots > 0) volumeUnits = symbol.QuantityToVolumeInUnits(explicitLots);
                    else volumeUnits = symbol.VolumeInUnitsMin;
                }

                if (volumeUnits < symbol.VolumeInUnitsMin)
                {
                    var msg = "Volume too small: " + volumeUnits;
                    RecordPollEvent("", id, symbolCode, action, "REJECTED_VOLUME", msg, "error");
                    SafeAck(id, leaseToken, "REJECTED", "", msg);
                    return;
                }

                // EXTRACT PARTIAL TPs — read tp_targets first, then fallback to raw_json.partial_tps
                var partials = new List<PartialTP>();

                // 1. Try tp_targets array from POLL response (preferred)
                var tpMatch = Regex.Match(json, "\"tp_targets\"\\s*:\\s*\\[([^\\]]*)\\]");
                if (tpMatch.Success)
                {
                    var tpVals = tpMatch.Groups[1].Value;
                    var tpPrices = Regex.Matches(tpVals, @"[\d]+\.?[\d]*");
                    var prices = new List<double>();
                    foreach (Match m in tpPrices)
                    {
                        var px = ParseDouble(m.Value);
                        if (px > 0) prices.Add(px);
                    }
                    if (prices.Count > 0)
                    {
                        // Safety filter: keep only targets that are true take-profit levels for side.
                        // BUY: TP above entry. SELL: TP below entry.
                        var filtered = prices
                            .Where(px => action == "BUY" ? px > executionPrice : px < executionPrice)
                            .Distinct()
                            .ToList();
                        if (action == "BUY") filtered = filtered.OrderBy(px => px).ToList();
                        else filtered = filtered.OrderByDescending(px => px).ToList();

                        prices = filtered;
                    }
                    if (prices.Count > 0)
                    {
                        double[] splits;
                        if (prices.Count >= 3) splits = new double[] { 50, 30, 20 };
                        else if (prices.Count == 2) splits = new double[] { 60, 40 };
                        else splits = new double[] { 100 };

                        for (int i = 0; i < prices.Count && i < splits.Length; i++)
                        {
                            partials.Add(new PartialTP { Price = prices[i], SizePct = splits[i] });
                        }
                    }
                }

                // 2. Fallback: raw_json.partial_tps (legacy)
                if (partials.Count == 0)
                {
                    var rawJson = GetJsonValue(json, "raw_json");
                    if (!string.IsNullOrEmpty(rawJson))
                    {
                        var pMatch = Regex.Match(rawJson, "\"partial_tps\"\\s*:\\s*\\[(.*?)\\]", RegexOptions.Singleline);
                        if (pMatch.Success)
                        {
                            var items = Regex.Matches(pMatch.Groups[1].Value, "\\{(.*?)\\}", RegexOptions.Singleline);
                            foreach (Match m in items)
                            {
                                var it = "{" + m.Groups[1].Value + "}";
                                var pPrice = ParseDouble(GetJsonValue(it, "price"));
                                var pPct = ParseDouble(GetJsonValue(it, "size_pct"));
                                if (pPrice > 0 && pPct > 0) partials.Add(new PartialTP { Price = pPrice, SizePct = pPct });
                            }
                        }
                    }
                }

                if (partials.Count > 0) _tradePartials[id] = partials;

                var strategyLabel = GetJsonValue(json, "strategy");
                var entryModelLabel = GetJsonValue(json, "entry_model");
                if (string.IsNullOrWhiteSpace(entryModelLabel)) entryModelLabel = GetJsonValue(json, "entryModel");
                var label = BuildBrokerLabel(strategyLabel, entryModelLabel);
                var brokerComment = BuildBrokerComment(id);
                var tradeType = (action == "BUY") ? TradeType.Buy : TradeType.Sell;
                TradeResult res = null;
                var requestedSl = sl;
                var requestedTp = tp;

                if (executionPrice <= 0)
                {
                    var msg = "Invalid execution price: " + executionPrice;
                    RecordPollEvent("", id, symbolCode, action, "REJECTED_PRICE", msg, "error");
                    SafeAck(id, leaseToken, "REJECTED", "", msg);
                    SafePrint("[Error] Cannot execute {0} {1}: Ask/Bid price is 0. Check connection.", action, symbolCode);
                    return;
                }

                SafePrint("[Debug] Executing {0} {1} at {2}. SL: {3}, TP: {4}, Vol: {5}", action, symbolCode, executionPrice, sl, tp, volumeUnits);

                // Pre-check: reject if SL/TP are too close to entry (broker will reject anyway)
                if (symbol.PipSize > 0)
                {
                    if (sl > 0)
                    {
                        double slDistPips = Math.Abs(executionPrice - sl) / symbol.PipSize;
                        if (slDistPips < MinStopPips)
                        {
                            var adj = String.Equals(OnSlTpError, "Adjust", StringComparison.OrdinalIgnoreCase);
                            if (adj)
                            {
                                var reqSl = action == "SELL" ? executionPrice + MinStopPips * symbol.PipSize : executionPrice - MinStopPips * symbol.PipSize;
                                var reqPips = Math.Abs(reqSl - executionPrice) / symbol.PipSize;
                                var newVolume = volumeUnits;
                                // Cap volume to respect MaxRisk settings after SL adjustment
                                if (MaxRiskPercent > 0)
                                {
                                    var maxRiskVol = Symbol.QuantityToVolumeInUnits((Account.Equity * MaxRiskPercent / 100) / (reqPips * symbol.PipValue));
                                    if (maxRiskVol < volumeUnits) newVolume = maxRiskVol;
                                }
                                if (MaxRiskAmount > 0)
                                {
                                    var maxRiskVol2 = Symbol.QuantityToVolumeInUnits(MaxRiskAmount / (reqPips * symbol.PipValue));
                                    if (maxRiskVol2 < newVolume) newVolume = maxRiskVol2;
                                }
                                if (newVolume < symbol.VolumeInUnitsMin)
                                {
                                    var rejectMsg = string.Format("SL adjusted ({0:F0} pips) exceeds max risk — volume would be below minimum", reqPips);
                                    SafeLog("ERROR", "[Reject] {0}", rejectMsg);
                                    RecordPollEvent("", id, symbolCode, action, "REJECTED_RISK_LIMIT", rejectMsg, "error");
                                    SafeAck(id, leaseToken, "FAIL", "", rejectMsg);
                                    return;
                                }
                                if (newVolume < volumeUnits)
                                    SafePrint("[Adjust] SL widened from {0:F5} to {1:F5} ({2:F1} → {3:F0} pips), vol reduced from {4} to {5} to respect max risk", sl, reqSl, slDistPips, reqPips, volumeUnits, newVolume);
                                else
                                    SafePrint("[Adjust] SL widened from {0:F5} to {1:F5} ({2:F1} → {3:F0} pips)", sl, reqSl, slDistPips, reqPips);
                                sl = reqSl;
                                volumeUnits = newVolume;
                            }
                            else
                            {
                                var rejectMsg = string.Format("SL too close: {0:F1} pips (min {1}). E={2:F5} SL={3:F5}", slDistPips, MinStopPips, executionPrice, sl);
                                SafeLog("ERROR", "[Reject] {0}", rejectMsg);
                                RecordPollEvent("", id, symbolCode, action, "REJECTED_SL_DISTANCE", rejectMsg, "error");
                                SafeAck(id, leaseToken, "FAIL", "", rejectMsg);
                                return;
                            }
                        }
                    }
                    if (tp > 0)
                    {
                        double tpDistPips = Math.Abs(tp - executionPrice) / symbol.PipSize;
                        if (tpDistPips < MinStopPips)
                        {
                            var adj = String.Equals(OnSlTpError, "Adjust", StringComparison.OrdinalIgnoreCase);
                            if (adj)
                            {
                                var newTp = action == "SELL" ? executionPrice - MinStopPips * symbol.PipSize : executionPrice + MinStopPips * symbol.PipSize;
                                SafePrint("[Adjust] TP widened from {0:F5} to {1:F5} ({2:F1} pips → {3:F0} min)", tp, newTp, tpDistPips, MinStopPips);
                                tp = newTp;
                            }
                            else
                            {
                                var rejectMsg = string.Format("TP too close: {0:F1} pips (min {1}). E={2:F5} TP={3:F5}", tpDistPips, MinStopPips, executionPrice, tp);
                                SafeLog("ERROR", "[Reject] {0}", rejectMsg);
                                RecordPollEvent("", id, symbolCode, action, "REJECTED_TP_DISTANCE", rejectMsg, "error");
                                SafeAck(id, leaseToken, "FAIL", "", rejectMsg);
                                return;
                            }
                        }
                    }
                }

                // We place the order without SL/TP pips first to avoid "price as pips" bugs,
                // then modify it with absolute prices immediately after success.
                if (orderTypeStr == "limit")
                {
                    res = PlaceLimitOrder(tradeType, symbol.Name, volumeUnits, entry, label, null, null, null, brokerComment);
                }
                else if (orderTypeStr == "stop")
                {
                    res = PlaceStopOrder(tradeType, symbol.Name, volumeUnits, entry, label, null, null, null, brokerComment);
                }
                else
                {
                    res = ExecuteMarketOrder(tradeType, symbol.Name, volumeUnits, label, null, null, brokerComment);
                }

                if (res.IsSuccessful)
                {
                    var ticket = (res.Position != null) ? res.Position.Id.ToString() : (res.PendingOrder != null ? res.PendingOrder.Id.ToString() : "OK");
                    if (!string.IsNullOrWhiteSpace(ticket) && !string.IsNullOrWhiteSpace(id))
                        _ticketSidMap[ticket] = id;

                    // Apply absolute SL/TP immediately after success to ensure 100% price accuracy
                    // If broker rejects SL/TP → close position, cancel trade. No naked positions.
                    if (sl > 0 || tp > 0)
                    {
                        if (res.Position != null)
                        {
                            var mRes = ModifyPosition(res.Position, (sl > 0 ? sl : (double?)null), (tp > 0 ? tp : (double?)null));
                            if (mRes.IsSuccessful)
                            {
                                SafePrint("[Order] SL/TP set SL={0} TP={1} for {2} #{3}", sl, tp, symbolCode, ticket);
                            }
                            else
                            {
                                var errDetail = string.Format("SL/TP rejected: {0} (SL={1} TP={2})", mRes.Error, sl, tp);
                                var reject = String.Equals(OnSlTpError, "Reject", StringComparison.OrdinalIgnoreCase) || String.Equals(OnSlTpError, "Adjust", StringComparison.OrdinalIgnoreCase);
                                if (reject)
                                {
                                    SafePrint("[FATAL] {0} for {1} #{2}. Closing position.", errDetail, symbolCode, ticket);
                                    var closeRes = ClosePosition(res.Position);
                                    if (closeRes.IsSuccessful)
                                        SafePrint("[FATAL] Position closed after SL/TP failure for {0} #{1}", symbolCode, ticket);
                                    else
                                        SafePrint("[CRITICAL] Close also failed for {0} #{1}: {2} - POSITION UNPROTECTED!", symbolCode, ticket, closeRes.Error);
                                    RecordPollEvent(ticket, id, symbolCode, action, "CANCELLED_POSITION", errDetail, "closed");
                                    SafeAck(id, leaseToken, "FAIL", ticket, errDetail);
                                    return;
                                }
                                else
                                {
                                    // Continue: keep position without SL/TP
                                    SafePrint("[WARN] SL/TP rejected but continuing: {0} for {1} #{2}", errDetail, symbolCode, ticket);
                                    var status = orderTypeStr == "limit" || orderTypeStr == "stop" ? "PLACED" : "START";
                                    SafeAck(id, leaseToken, status, ticket, "sl_tp_rejected: " + errDetail);
                                }
                            }
                        }
                        else if (res.PendingOrder != null)
                        {
                            double? slPips = null;
                            double? tpPips = null;
                            if (sl > 0)
                            {
                                slPips = Math.Round((action == "BUY" ? (res.PendingOrder.TargetPrice - sl) : (sl - res.PendingOrder.TargetPrice)) / symbol.PipSize, 2);
                            }
                            if (tp > 0)
                            {
                                tpPips = Math.Round((action == "BUY" ? (tp - res.PendingOrder.TargetPrice) : (res.PendingOrder.TargetPrice - tp)) / symbol.PipSize, 2);
                            }
                            var mRes = ModifyPendingOrder(res.PendingOrder, res.PendingOrder.TargetPrice, slPips, tpPips, res.PendingOrder.ExpirationTime);
                            if (mRes.IsSuccessful)
                            {
                                SafePrint("[Order] SL/TP set for pending order {0}", ticket);
                            }
                            else
                            {
                                var errDetail = string.Format("SL/TP rejected for pending order: {0}", mRes.Error);
                                var reject = String.Equals(OnSlTpError, "Reject", StringComparison.OrdinalIgnoreCase) || String.Equals(OnSlTpError, "Adjust", StringComparison.OrdinalIgnoreCase);
                                if (reject)
                                {
                                    SafePrint("[FATAL] {0}. Cancelling order.", errDetail);
                                    CancelPendingOrder(res.PendingOrder);
                                    RecordPollEvent(ticket, id, symbolCode, action, "CANCELLED_ORDER", errDetail, "closed");
                                    SafeAck(id, leaseToken, "FAIL", ticket, errDetail);
                                    return;
                                }
                                else
                                {
                                    SafePrint("[WARN] SL/TP rejected for pending order but continuing: {0}", errDetail);
                                    SafeAck(id, leaseToken, "PLACED", ticket, "sl_tp_rejected: " + errDetail);
                                }
                            }
                        }
                    }

                    RecordPollEvent(ticket, id, symbolCode, action, (res.Position != null ? "CREATED_POSITION" : "CREATED_ORDER"), "", "created");
                    double lots = symbol.VolumeInUnitsToQuantity(volumeUnits);
                    double ackEntry = (res.Position != null ? res.Position.EntryPrice : (res.PendingOrder != null ? res.PendingOrder.TargetPrice : 0));
                    double ackSlPips = 0;
                    double ackTpPips = 0;
                    if (symbol.PipSize > 0 && ackEntry > 0)
                    {
                        if (sl > 0) ackSlPips = Math.Abs(ackEntry - sl) / symbol.PipSize;
                        if (tp > 0) ackTpPips = Math.Abs(tp - ackEntry) / symbol.PipSize;
                    }
                    SafeAck(
                        id,
                        leaseToken,
                        (res.Position != null ? "OPEN" : "PENDING"),
                        ticket,
                        "",
                        ackEntry,
                        finalRiskMoney,
                        lots,
                        requestedSl,
                        sl,
                        requestedTp,
                        tp,
                        ackSlPips,
                        ackTpPips
                    );
                }
                    else
                    {
                        RecordPollEvent("", id, symbolCode, action, "CREATE_FAILED", res.Error.ToString(), "error");
                        SafeAck(id, leaseToken, "REJECTED", "", res.Error.ToString());
                    }
                }
                catch (Exception ex)
                {
                    var err = string.Format(
                        CultureInfo.InvariantCulture,
                        "execute_signal_failed: {0}",
                        ex.Message
                    );
                    RecordPollEvent(ticketStr, id, symbolCode, action, "EXECUTE_FAILED", err, "error");
                    SafeLog("ERROR", "[Error] ExecuteSignal failed for {0}: {1}", id, ex);
                    SafeAck(id, leaseToken, "ERROR", ticketStr, err);
                }
            });
        }

        private string BuildLeaseKey(string sid, string token)
        {
            return (sid ?? "") + ":" + (token ?? "");
        }

        private void ReleaseProcessedLease(string sid, string token)
        {
            if (string.IsNullOrWhiteSpace(sid) || string.IsNullOrWhiteSpace(token)) return;
            _processedLeases.Remove(BuildLeaseKey(sid, token));
        }

        private void CleanupOldEntries()
        {
            // Clean up old processed signal IDs to prevent memory growth
            if (_processedSignalIds.Count > 1000)
            {
                var toRemove = _processedSignalIds.Take(_processedSignalIds.Count - 500).ToList();
                foreach (var id in toRemove) _processedSignalIds.Remove(id);
                SafePrint("[Cleanup] Removed {0} old signal IDs from memory", toRemove.Count);
            }

            // Clean up old lease entries
            if (_processedLeases.Count > 1000)
            {
                var toRemove = _processedLeases.Take(_processedLeases.Count - 500).ToList();
                foreach (var l in toRemove) _processedLeases.Remove(l);
                SafePrint("[Cleanup] Removed {0} old lease entries from memory", toRemove.Count);
            }

            // Clean up old synced closed tickets
            if (_syncedClosedTickets.Count > 500)
            {
                var toRemove = _syncedClosedTickets.Take(_syncedClosedTickets.Count - 250).ToList();
                foreach (var ticket in toRemove)
                {
                    _syncedClosedTickets.Remove(ticket);
                }
                SafePrint("[Cleanup] Removed {0} old closed tickets from memory", toRemove.Count);
            }

            // Clean up old partial TP tracking
            if (_executedPartials.Count > 200)
            {
                var toRemove = _executedPartials.Take(_executedPartials.Count - 100).ToList();
                foreach (var key in toRemove)
                {
                    _executedPartials.Remove(key);
                }
                SafePrint("[Cleanup] Removed {0} old partial TP keys from memory", toRemove.Count);
            }

            // Auto-clear error state after 5 minutes of successful operation
            if (_consecutiveErrors > 0 && (DateTime.Now - _lastErrorClearTime).TotalMinutes > 5)
            {
                ResetTransientErrorTracking("[Recovery] Error counter reset after 5 minutes of stable operation");
            }
        }

        private async Task SyncWithVpsAsync(string accId, double bal, double eq, double marg, string brokerName, List<string> posList, List<string> ordersList, List<string> closedList, HashSet<string> activeTicketIds, List<string> metricsList, List<Tuple<string, double, double>> priceData, List<string> syncSymbols)
        {
            _syncStatus = "SYNCING";
            HttpRequestMessage request = null;
            var startedAt = DateTime.Now;
            try
            {
                var priceList = new List<string>();
                foreach (var p in priceData ?? new List<Tuple<string, double, double>>())
                    priceList.Add("{\"s\":\"" + p.Item1 + "\",\"b\":" + p.Item2.ToString("F5", CultureInfo.InvariantCulture) + ",\"a\":" + p.Item3.ToString("F5", CultureInfo.InvariantCulture) + "}");

                _lastPushPositionCount = posList != null ? posList.Count : 0;
                _lastPushOrderCount = ordersList != null ? ordersList.Count : 0;
                _lastPushClosedCount = closedList != null ? closedList.Count : 0;
                _lastPushSymbolCount = syncSymbols != null ? syncSymbols.Where(s => !string.IsNullOrWhiteSpace(s)).Distinct(StringComparer.OrdinalIgnoreCase).Count() : 0;
                _lastPushPriceSymbolCount = priceData != null ? priceData.Select(p => p.Item1).Where(s => !string.IsNullOrWhiteSpace(s)).Distinct(StringComparer.OrdinalIgnoreCase).Count() : 0;
                if (_lastPushPriceSymbolCount > 0) _priceStatus = "PUSHING";

                var payload = "{\"source_id\":\"Ctrader\",\"account_id\":\"" + accId
                    + "\",\"balance\":" + bal.ToString("F2", CultureInfo.InvariantCulture)
                    + ",\"equity\":" + eq.ToString("F2", CultureInfo.InvariantCulture)
                    + ",\"margin\":" + marg.ToString("F2", CultureInfo.InvariantCulture)
                    + ",\"broker_name\":\"" + (brokerName ?? "").Replace("\"", "'") + "\""
                    + ",\"provider_code\":\"" + (ProviderCode ?? "").Replace("\"", "'") + "\""
                    + ",\"build_version\":\"" + BuildVersion + "\""
                    + ",\"positions\":[" + string.Join(",", posList ?? new List<string>()) + "]"
                    + ",\"orders\":[" + string.Join(",", ordersList ?? new List<string>()) + "]"
                    + ",\"closed\":[" + string.Join(",", closedList ?? new List<string>()) + "]"
                    + ",\"symbol_metrics\":[" + string.Join(",", metricsList ?? new List<string>()) + "]"
                    + ",\"prices\":[" + string.Join(",", priceList) + "]}";
                var content = new StringContent(payload, Encoding.UTF8, "application/json");
                using (request = new HttpRequestMessage(System.Net.Http.HttpMethod.Post, BuildServerApiUrl("broker/sync")))
                {
                    request.Headers.Add("x-api-key", EaApiKey);
                    request.Content = content;
                    var response = await SendWithTimeoutAsync(
                        request,
                        SyncTimeoutSeconds
                    );

                    _serverStatus = (int)response.StatusCode < 500 ? "OK" : "SERVER_ERR";

                    if (response.IsSuccessStatusCode)
                    {
                        _lastSyncLatencyMs = Math.Max(0, (long)(DateTime.Now - startedAt).TotalMilliseconds);
                        _syncConsecutiveFailures = 0;
                        MarkApiReachable();
                        _apiStatus = "OK";
                        _syncCount++; _syncStatus = "OK"; _lastSyncTime = DateTime.Now; _lastSyncErr = "None";

                        // Reset error counter on successful sync
                        if (_consecutiveErrors > 0)
                        {
                            ResetTransientErrorTracking("[Recovery] Error counter reset after successful sync");
                        }

                        var json = await response.Content.ReadAsStringAsync();
                        ParseSyncResults(json, activeTicketIds);
                        if (_lastPushPriceSymbolCount > 0)
                        {
                            _priceCount++;
                            _priceStatus = "OK";
                            _lastPriceTime = DateTime.Now;
                            _lastPriceErr = "None";
                        }
                    }
                    else
                    {
                        _lastSyncLatencyMs = Math.Max(0, (long)(DateTime.Now - startedAt).TotalMilliseconds);
                        _syncConsecutiveFailures++;
                        _apiStatus = (response.StatusCode == HttpStatusCode.Unauthorized || response.StatusCode == HttpStatusCode.Forbidden) ? "KEY_INVALID" : "ERR_" + (int)response.StatusCode;
                        _syncStatus = "FAIL (" + (int)response.StatusCode + ")";
                        var responseBody = await response.Content.ReadAsStringAsync();
                        _lastSyncErr = FormatServerErrorForPanel(responseBody);
                        if (string.IsNullOrEmpty(_lastSyncErr)) _lastSyncErr = "Server Rejected Payload";

                        // Increment error counter for failed sync
                        _consecutiveErrors++;
                        SafePrint("[Error] Sync failed: {0} (consecutive errors: {1})", _lastSyncErr, _consecutiveErrors);
                        LogServerErrorDetail("sync", accId, responseBody);
                        if (_lastPushPriceSymbolCount > 0)
                        {
                            _priceStatus = "FAIL (" + (int)response.StatusCode + ")";
                            _lastPriceErr = _lastSyncErr;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _lastSyncLatencyMs = Math.Max(0, (long)(DateTime.Now - startedAt).TotalMilliseconds);
                _syncConsecutiveFailures++;
                MarkApiOfflineCooldown();
                _syncStatus = "ERROR";
                _lastSyncErr = FormatServerErrorForPanel(ex.Message);

                // Increment error counter for sync exceptions
                _consecutiveErrors++;
                if (ShouldEmitTransientErrorLog())
                {
                    SafePrint("[Error] Sync exception: {0} (consecutive errors: {1})", ex.Message, _consecutiveErrors);
                    LogHttpExceptionDetail("sync", accId, request, SyncTimeoutSeconds, ex);
                }
                if (_lastPushPriceSymbolCount > 0)
                {
                    _priceStatus = "ERROR";
                    _lastPriceErr = _lastSyncErr;
                }
            }
            finally
            {
                RefreshDebugPanel();
            }
        }

        private async Task PushBarsAsync(string accId, List<string> symbols)
        {
            _barStatus = "PUSHING";
            try
            {
                string[] tfs = { "1", "5", "15", "60", "240", "1440" };
                var barList = new List<string>();
                int newBars = 0;

                var barBuild = await RunOnMainThreadAsync(() =>
                {
                    var localBars = new List<string>();
                    var localNewBars = 0;
                    foreach (var sym in symbols)
                    {
                        Symbol resolvedSymbol;
                        if (!TryResolveQuotedSymbol(sym, out resolvedSymbol)) continue;
                        foreach (var tfStr in tfs)
                        {
                            try
                            {
                                TimeFrame tf;
                                switch (tfStr)
                                {
                                    case "1": tf = TimeFrame.Minute; break;
                                    case "5": tf = TimeFrame.Minute5; break;
                                    case "15": tf = TimeFrame.Minute15; break;
                                    case "60": tf = TimeFrame.Hour; break;
                                    case "240": tf = TimeFrame.Hour4; break;
                                    case "1440": tf = TimeFrame.Daily; break;
                                    default: continue;
                                }

                                var bars = MarketData.GetBars(tf, resolvedSymbol.Name);
                                if (bars == null || bars.Count < 1) continue;

                                var lastBar = bars.LastBar;
                                long barTime = ToUnixTime(lastBar.OpenTime);

                                string key = resolvedSymbol.Name + "_" + tfStr;
                                long lastKnown;
                                if (_barLastTime.TryGetValue(key, out lastKnown) && barTime <= lastKnown)
                                    continue;

                                _barLastTime[key] = barTime;

                                localBars.Add(
                                    "{\"s\":\"" + resolvedSymbol.Name + "\"" +
                                    ",\"tf\":\"" + tfStr + "\"" +
                                    ",\"t\":" + barTime.ToString() +
                                    ",\"o\":" + lastBar.Open.ToString("F5", CultureInfo.InvariantCulture) +
                                    ",\"h\":" + lastBar.High.ToString("F5", CultureInfo.InvariantCulture) +
                                    ",\"l\":" + lastBar.Low.ToString("F5", CultureInfo.InvariantCulture) +
                                    ",\"c\":" + lastBar.Close.ToString("F5", CultureInfo.InvariantCulture) +
                                    ",\"v\":" + lastBar.TickVolume.ToString() + "}"
                                );
                                localNewBars++;
                                if (localNewBars >= 10) break;
                            }
                            catch { }
                        }
                        if (localNewBars >= 10) break;
                    }
                    return Tuple.Create(localBars, localNewBars);
                });
                barList = barBuild.Item1;
                newBars = barBuild.Item2;

                if (newBars == 0)
                {
                    _barStatus = "IDLE"; _lastBarTime = DateTime.Now; _lastBarErr = "None";
                    return;
                }

                var payload = "{\"source_id\":\"Ctrader\",\"account_id\":\"" + accId + "\",\"bars\":[" + string.Join(",", barList) + "]}";
                var content = new StringContent(payload, Encoding.UTF8, "application/json");
                content.Headers.Add("x-api-key", EaApiKey);
                var response = await _httpClient.PostAsync(BuildServerApiUrl("broker/bars"), content);

                if (response.IsSuccessStatusCode)
                {
                    MarkApiReachable();
                    _barCount += newBars; _barStatus = "OK"; _lastBarTime = DateTime.Now; _lastBarErr = "None";
                    if (_barCount <= newBars) SafePrint("[Bar] First push OK: {0} bars from {1} symbols", newBars, symbols.Count);
                }
                else
                {
                    _barStatus = "FAIL (" + (int)response.StatusCode + ")";
                    _lastBarErr = FormatServerErrorForPanel(await response.Content.ReadAsStringAsync());
                    SafePrint("[Bar] Push FAILED: {0}", _lastBarErr);
                }
            }
            catch (Exception ex)
            {
                MarkApiOfflineCooldown();
                _barStatus = "ERROR";
                _lastBarErr = FormatServerErrorForPanel(ex.Message);
                if (_barCount == 0) SafePrint("[Bar] Push ERROR: {0}", ex.Message);
            }
            if (_lastBarTime == DateTime.MinValue) _lastBarTime = DateTime.Now;
        }

        private async Task SyncBarsIncrementalAsync(string accId, List<string> symbols)
        {
            if (!EnableIncrementalBars) return;
            _incrementalStatus = "FETCHING";
            try
            {
                // 1. Get coverage from webhook
                var covUrl = BuildServerApiUrl("broker/symbols") + "?symbols=" + string.Join(",", symbols);
                var covRequest = new HttpRequestMessage(System.Net.Http.HttpMethod.Get, covUrl);
                covRequest.Headers.Add("x-api-key", EaApiKey);
                var covResponse = await _httpClient.SendAsync(covRequest);
                if (!covResponse.IsSuccessStatusCode)
                {
                    _incrementalStatus = "COV_FAIL";
                    _lastIncrementalErr = "HTTP " + (int)covResponse.StatusCode;
                    return;
                }
                MarkApiReachable();
                var covJson = await covResponse.Content.ReadAsStringAsync();

                // 2. Fetch bars from broker for each symbol+TF with gaps
                string[] tfs = { "1", "5", "15", "60", "240", "1440" };

                var syncBuild = await RunOnMainThreadAsync(() =>
                {
                    var sw = Stopwatch.StartNew();
                    var items = new List<string>();
                    int totalBars = 0;
                    bool isFirstSync = _incrementalSyncCount == 0;
                    int maxBars = Math.Min(isFirstSync ? 500 : IncrementalBarsMaxPerPost, 500);
                    const int maxMainThreadMs = 250;

                    foreach (var sym in symbols)
                    {
                        if (sw.ElapsedMilliseconds >= maxMainThreadMs) break;
                        Symbol resolvedSymbol;
                        if (!TryResolveQuotedSymbol(sym, out resolvedSymbol)) continue;
                        var symUpper = resolvedSymbol.Name.ToUpperInvariant();
                        foreach (var tfStr in tfs)
                        {
                            if (sw.ElapsedMilliseconds >= maxMainThreadMs) break;
                            if (totalBars >= maxBars) break;
                            try
                            {
                                // Parse remote end from coverage
                                long remoteEnd = 0;
                                int existingBars = 0, targetBars = 500;
                                var symPattern = "\"symbol\":\"" + symUpper + "\"";
                                var symIdx = covJson.IndexOf(symPattern, StringComparison.OrdinalIgnoreCase);
                                if (symIdx >= 0)
                                {
                                    var tfPattern = "\"tf\":\"" + tfStr + "\"";
                                    var tfIdx = covJson.IndexOf(tfPattern, symIdx);
                                    if (tfIdx >= 0)
                                    {
                                        // Parse existing_bars
                                        var ebIdx = covJson.IndexOf("\"existing_bars\"", tfIdx);
                                        if (ebIdx >= 0)
                                        {
                                            var colIdx = covJson.IndexOf(':', ebIdx);
                                            if (colIdx >= 0)
                                            {
                                                var ns = colIdx + 1;
                                                while (ns < covJson.Length && (covJson[ns] == ' ' || covJson[ns] == '"')) ns++;
                                                int.TryParse(new string(covJson.Skip(ns).TakeWhile(c => char.IsDigit(c)).ToArray()), out existingBars);
                                            }
                                        }
                                        // Parse bars_number (target)
                                        var bnIdx = covJson.IndexOf("\"bars_number\"", tfIdx);
                                        if (bnIdx >= 0)
                                        {
                                            var colIdx2 = covJson.IndexOf(':', bnIdx);
                                            if (colIdx2 >= 0)
                                            {
                                                var ns2 = colIdx2 + 1;
                                                while (ns2 < covJson.Length && (covJson[ns2] == ' ' || covJson[ns2] == '"')) ns2++;
                                                int.TryParse(new string(covJson.Skip(ns2).TakeWhile(c => char.IsDigit(c)).ToArray()), out targetBars);
                                            }
                                        }
                                        // Parse end
                                        var endIdx = covJson.IndexOf("\"end\"", tfIdx);
                                        if (endIdx >= 0)
                                        {
                                            var colIdx3 = covJson.IndexOf(':', endIdx);
                                            if (colIdx3 >= 0)
                                            {
                                                var ns3 = colIdx3 + 1;
                                                while (ns3 < covJson.Length && (covJson[ns3] == ' ' || covJson[ns3] == '"' || covJson[ns3] == 'n')) ns3++;
                                                long.TryParse(new string(covJson.Skip(ns3).TakeWhile(c => char.IsDigit(c)).ToArray()), out remoteEnd);
                                            }
                                        }
                                    }
                                }

                                TimeFrame tf;
                                switch (tfStr)
                                {
                                    case "1": tf = TimeFrame.Minute; break;
                                    case "5": tf = TimeFrame.Minute5; break;
                                    case "15": tf = TimeFrame.Minute15; break;
                                    case "60": tf = TimeFrame.Hour; break;
                                    case "240": tf = TimeFrame.Hour4; break;
                                    case "1440": tf = TimeFrame.Daily; break;
                                    default: continue;
                                }

                                var bars = MarketData.GetBars(tf, resolvedSymbol.Name);
                                if (bars == null || bars.Count < 1) continue;
                                var latestBar = bars.LastBar;
                                long latestTime = ToUnixTime(latestBar.OpenTime);
                                int tfSec = int.Parse(tfStr) * 60;

                                long fetchStart = remoteEnd > 0 ? remoteEnd + tfSec : latestTime - 500 * tfSec;
                                if (fetchStart >= latestTime) continue;

                                int timeNeeded = (int)((latestTime - fetchStart) / tfSec) + 1;

                                // Compute needed bars. Backfill until target reached, then incremental 1 bar.
                                int needed;
                                if (existingBars < targetBars)
                                {
                                    needed = Math.Min(timeNeeded, targetBars - existingBars);
                                    if (needed > 500) needed = 500;
                                }
                                else
                                {
                                    needed = 1;
                                }
                                if (needed < 1) continue;

                                var barArr = new List<string>();
                                int sent = 0;
                                for (int i = bars.Count - 1; i >= 0 && sent < needed && (totalBars + sent) < maxBars; i--)
                                {
                                    if (sw.ElapsedMilliseconds >= maxMainThreadMs) break;
                                    var b = bars[i];
                                    long bt = ToUnixTime(b.OpenTime);
                                    if (bt < fetchStart) break;
                                    if (bt >= latestTime) continue;
                                    barArr.Add(
                                        "{\"time\":" + bt.ToString() +
                                        ",\"open\":" + b.Open.ToString("F5", CultureInfo.InvariantCulture) +
                                        ",\"high\":" + b.High.ToString("F5", CultureInfo.InvariantCulture) +
                                        ",\"low\":" + b.Low.ToString("F5", CultureInfo.InvariantCulture) +
                                        ",\"close\":" + b.Close.ToString("F5", CultureInfo.InvariantCulture) +
                                        ",\"volume\":" + b.TickVolume.ToString() + "}");
                                    sent++;
                                }
                                if (sent > 0)
                                {
                                    barArr.Reverse();
                                    items.Add("{\"symbol\":\"" + symUpper + "\",\"tf\":\"" + tfStr + "\",\"bars\":[" + string.Join(",", barArr) + "]}");
                                    totalBars += sent;
                                }
                            }
                            catch { }
                        }
                        if (totalBars >= maxBars) break;
                    }
                    return Tuple.Create(items, totalBars);
                });

                var syncItems = syncBuild.Item1;
                var totalBars = syncBuild.Item2;

                if (totalBars == 0)
                {
                    _incrementalStatus = "UP_TO_DATE"; _lastIncrementalErr = "None";
                    return;
                }

                // 3. POST to prices-sync
                _incrementalStatus = "POSTING";
                var payload = "{\"source_id\":\"Ctrader\",\"account_id\":\"" + accId
                    + "\",\"sync_mode\":\"incremental\",\"items\":[" + string.Join(",", syncItems) + "]}";
                var content = new StringContent(payload, Encoding.UTF8, "application/json");
                content.Headers.Add("x-api-key", EaApiKey);
                var postResponse = await _httpClient.PostAsync(BuildServerApiUrl("broker/prices-sync"), content);

                if (postResponse.IsSuccessStatusCode)
                {
                    MarkApiReachable();
                    var respJson = await postResponse.Content.ReadAsStringAsync();
                    int inserted = 0, duplicated = 0;
                    var insMatch = Regex.Match(respJson, "\"inserted\"\\s*:\\s*(\\d+)");
                    var dupMatch = Regex.Match(respJson, "\"duplicated\"\\s*:\\s*(\\d+)");
                    if (insMatch.Success) int.TryParse(insMatch.Groups[1].Value, out inserted);
                    if (dupMatch.Success) int.TryParse(dupMatch.Groups[1].Value, out duplicated);
                    _incrementalSyncCount++;
                    _incrementalTotalInserted += inserted;
                    _incrementalStatus = "OK"; _lastIncrementalErr = "None";
                    SafePrint("[IncBars] sync={0} bars={1} ins={2} dup={3}", _incrementalSyncCount, totalBars, inserted, duplicated);
                }
                else
                {
                    _incrementalStatus = "POST_FAIL";
                    _lastIncrementalErr = FormatServerErrorForPanel(await postResponse.Content.ReadAsStringAsync());
                    SafePrint("[IncBars] POST failed: {0}", _lastIncrementalErr);
                }
            }
            catch (Exception ex)
            {
                MarkApiOfflineCooldown();
                _incrementalStatus = "ERROR";
                _lastIncrementalErr = FormatServerErrorForPanel(ex.Message);
                if (_incrementalSyncCount == 0) SafePrint("[IncBars] ERROR: {0}", ex.Message);
            }
        }

        private long ToUnixTime(DateTime dt)
        {
            var normalized = dt.Kind == DateTimeKind.Unspecified
                ? DateTime.SpecifyKind(dt, DateTimeKind.Utc)
                : dt.ToUniversalTime();
            return new DateTimeOffset(normalized).ToUnixTimeSeconds();
        }

        private string FormatServerErrorForPanel(string raw)
        {
            var text = string.IsNullOrWhiteSpace(raw) ? "Server Rejected Payload" : raw.Trim();
            var m = Regex.Match(text, "\"error\"\\s*:\\s*\"([^\"]+)\"", RegexOptions.Singleline);
            if (m.Success) text = m.Groups[1].Value;
            var code = ExtractJsonField(raw, "code");
            var table = ExtractJsonField(raw, "table");
            var column = ExtractJsonField(raw, "column");
            var constraint = ExtractJsonField(raw, "constraint");
            var detail = ExtractJsonField(raw, "detail");
            text = text.Replace("\\\"", "\"").Replace("\\\\", "\\").Trim();
            text = text.Replace("\\n", " | ").Replace("\\r", " | ");
            text = Regex.Replace(text, "\\s+", " ");
            text = text.Replace("insert or update on table", "DB write on");
            text = text.Replace("violates foreign key constraint", "FK");
            text = text.Replace("\"", "");
            text = text.Replace("\\", "");
            if (!string.IsNullOrWhiteSpace(code)) text += " | code=" + code;
            if (!string.IsNullOrWhiteSpace(table)) text += " | table=" + table;
            if (!string.IsNullOrWhiteSpace(column)) text += " | column=" + column;
            if (!string.IsNullOrWhiteSpace(constraint)) text += " | constraint=" + constraint;
            if (!string.IsNullOrWhiteSpace(detail)) text += " | detail=" + Regex.Replace(detail, "\\s+", " ");
            if (text.Length > 420) text = text.Substring(0, 420);
            return text;
        }

        private void AppendWrappedPanelLine(StringBuilder sb, string prefix, string text, int lineWidth, int maxLines)
        {
            var value = string.IsNullOrWhiteSpace(text) ? "" : text.Trim();
            if (string.IsNullOrEmpty(value)) return;
            var width = Math.Max(24, lineWidth);
            var lines = 0;
            var head = string.IsNullOrEmpty(prefix) ? "" : prefix;
            while (value.Length > 0 && lines < maxLines)
            {
                var room = width - (lines == 0 ? head.Length : 0);
                if (room < 12) room = width;
                if (value.Length <= room)
                {
                    sb.AppendLine((lines == 0 ? head : "") + value);
                    break;
                }
                var split = value.LastIndexOf(' ', Math.Min(room, value.Length - 1));
                if (split < Math.Max(8, room / 2)) split = room;
                var chunk = value.Substring(0, split).Trim();
                sb.AppendLine((lines == 0 ? head : "") + chunk);
                value = value.Substring(Math.Min(split, value.Length)).TrimStart();
                lines++;
            }
            if (value.Length > 0 && lines >= maxLines)
            {
                sb.AppendLine("...");
            }
        }

        private void ParseSyncResults(string json, HashSet<string> activeTicketIds)
        {
            ResetSyncSummary();
            var hasErrors = false;
            string firstError = null;
            var addedSids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var hasServerSummary = false;
            var resultSummaryJson = GetJsonObject(json, "result_summary");
            if (!string.IsNullOrEmpty(resultSummaryJson))
            {
                hasServerSummary = true;
                _lastSyncSummary.Read = GetJsonInt(resultSummaryJson, "read");
                _lastSyncSummary.Unchanged = GetJsonInt(resultSummaryJson, "unchanged");
                _lastSyncSummary.Created = GetJsonInt(resultSummaryJson, "created");
                _lastSyncSummary.Changed = GetJsonInt(resultSummaryJson, "changed");
                _lastSyncSummary.Closed = GetJsonInt(resultSummaryJson, "closed");
            }
            var requestSummaryJson = GetJsonObject(json, "request_summary");
            if (!string.IsNullOrEmpty(requestSummaryJson))
            {
                _lastPushPositionCount = GetJsonInt(requestSummaryJson, "positions");
                _lastPushOrderCount = GetJsonInt(requestSummaryJson, "orders");
                _lastPushClosedCount = GetJsonInt(requestSummaryJson, "closed");
                _lastPushSymbolCount = GetJsonInt(requestSummaryJson, "symbols");
                _lastPushPriceSymbolCount = GetJsonInt(requestSummaryJson, "price_symbols");
            }
            var priceSummaryJson = GetJsonObject(json, "price_summary");
            if (!string.IsNullOrEmpty(priceSummaryJson))
            {
                var updatedSymbols = GetJsonStringArray(priceSummaryJson, "symbols");
                var storedCount = GetJsonInt(priceSummaryJson, "stored");
                if (_lastPushPriceSymbolCount > 0 || updatedSymbols.Count > 0 || storedCount > 0)
                {
                    _lastPriceStoredCount = storedCount;
                    _lastPriceSymbolsText = updatedSymbols.Count > 0 ? string.Join(",", updatedSymbols.Take(12)) : "None";
                }
            }
            var resultsMatch = Regex.Match(json, "\"results\"\\s*:\\s*\\[(.*?)\\]", RegexOptions.Singleline);
            if (resultsMatch.Success)
            {
                var objects = Regex.Matches(resultsMatch.Groups[1].Value, "\\{(.*?)\\}", RegexOptions.Singleline);
                if (!hasServerSummary) _lastSyncSummary.Read = objects.Count;
                foreach (Match objMatch in objects)
                {
                    var obj = "{" + objMatch.Groups[1].Value + "}";
                    var ticket = GetJsonValue(obj, "ticket");
                    var sid = GetJsonValue(obj, "sid");
                    var status = GetJsonValue(obj, "status");
                    var sym = GetJsonValue(obj, "symbol");
                    var act = GetJsonValue(obj, "action");
                    var err = GetJsonValue(obj, "error");
                    var reason = GetJsonValue(obj, "reason");

                    if (status == "Ok")
                    {
                        if (status == "Ok" && !activeTicketIds.Contains(ticket)) _syncedClosedTickets.Add(ticket);
                        continue;
                    }
                    if (status == "Skip")
                    {
                        continue;
                    }
                    if (string.Equals(status, "NoChange", StringComparison.OrdinalIgnoreCase))
                    {
                        if (!hasServerSummary) _lastSyncSummary.Unchanged++;
                        if (!string.IsNullOrEmpty(ticket) && !string.IsNullOrEmpty(sid) && sid != "null")
                            _ticketSidMap[ticket] = sid;
                        continue;
                    }
                    if (string.Equals(status, "Added", StringComparison.OrdinalIgnoreCase))
                    {
                        if (!hasServerSummary) _lastSyncSummary.Created++;
                        if (!string.IsNullOrWhiteSpace(sid) && sid != "null") addedSids.Add(sid.Trim());
                        AddSyncEvent(ticket, sid, sym, act, "DISCOVERED_TRADE", reason, "created");
                        if (!string.IsNullOrEmpty(ticket) && !string.IsNullOrEmpty(sid) && sid != "null")
                            _ticketSidMap[ticket] = sid;
                        continue;
                    }
                    if (string.Equals(status, "Error", StringComparison.OrdinalIgnoreCase))
                    {
                        hasErrors = true;
                        if (string.IsNullOrEmpty(firstError)) firstError = !string.IsNullOrEmpty(err) ? err : reason;
                        AddSyncEvent(ticket, sid, sym, act, "SYNC_ERROR", !string.IsNullOrEmpty(err) ? err : reason, "error");
                        continue;
                    }
                    if (!string.IsNullOrEmpty(ticket) && !string.IsNullOrEmpty(sid) && sid != "null")
                    {
                        _ticketSidMap[ticket] = sid;
                    }
                }
            }

            var updatesMatch = Regex.Match(json, "\"tradeUpdates\"\\s*:\\s*\\[(.*?)\\]", RegexOptions.Singleline);
            if (updatesMatch.Success)
            {
                var updates = Regex.Matches(updatesMatch.Groups[1].Value, "\\{(.*?)\\}", RegexOptions.Singleline);
                foreach (Match updateMatch in updates)
                {
                    var obj = "{" + updateMatch.Groups[1].Value + "}";
                    var sid = GetJsonValue(obj, "sid");
                    if (String.IsNullOrWhiteSpace(sid) || addedSids.Contains(sid.Trim())) continue;
                    var symbol = GetJsonValue(obj, "symbol");
                    var exec = GetJsonValue(obj, "execution_status");
                    var statusChanged = JsonBool(GetJsonValue(obj, "status_changed"));
                    var slChanged = JsonBool(GetJsonValue(obj, "sl_changed"));
                    var tpChanged = JsonBool(GetJsonValue(obj, "tp_changed"));
                    var partialChanged = JsonBool(GetJsonValue(obj, "partial_changed"));
                    var rejectionReason = GetJsonValue(obj, "rejection_reason");
                    var oldSl = GetJsonValue(obj, "sl_before");
                    var newSl = GetJsonValue(obj, "sl");
                    var oldTp = GetJsonValue(obj, "tp_before");
                    var newTp = GetJsonValue(obj, "tp");
                    var detailParts = new List<string>();
                    if (statusChanged && !string.IsNullOrWhiteSpace(exec))
                        detailParts.Add("state=" + exec.Trim().ToUpperInvariant());
                    if (slChanged) detailParts.Add("SL " + PanelValue(oldSl, "-") + "->" + PanelValue(newSl, "-"));
                    if (tpChanged) detailParts.Add("TP " + PanelValue(oldTp, "-") + "->" + PanelValue(newTp, "-"));
                    if (partialChanged) detailParts.Add("partials updated");
                    if (!string.IsNullOrWhiteSpace(rejectionReason)) detailParts.Add(rejectionReason.Trim());
                    var eventCode = DeriveSyncEventCode(exec, statusChanged, slChanged, tpChanged, partialChanged);
                    var execUpper = (exec ?? "").Trim().ToUpperInvariant();
                    var bucket = (execUpper == "CLOSED" || execUpper == "CANCELLED") ? "closed" : "changed";
                    if (!hasServerSummary)
                    {
                        if (bucket == "closed") _lastSyncSummary.Closed++;
                        else _lastSyncSummary.Changed++;
                    }
                    AddSyncEvent("", sid, symbol, "", eventCode, String.Join(", ", detailParts.Where(x => !String.IsNullOrWhiteSpace(x))), bucket);
                }
            }

            var closedRowsMatch = Regex.Match(json, "\"closedRows\"\\s*:\\s*\\[(.*?)\\]", RegexOptions.Singleline);
            if (closedRowsMatch.Success)
            {
                var closedRows = Regex.Matches(closedRowsMatch.Groups[1].Value, "\\{(.*?)\\}", RegexOptions.Singleline);
                foreach (Match rowMatch in closedRows)
                {
                    var obj = "{" + rowMatch.Groups[1].Value + "}";
                    var sid = GetJsonValue(obj, "sid");
                    if (String.IsNullOrWhiteSpace(sid)) continue;
                    if (_syncEvents.Any(x => string.Equals(x.Sid ?? "", sid.Trim(), StringComparison.OrdinalIgnoreCase) && string.Equals(x.Bucket ?? "", "closed", StringComparison.OrdinalIgnoreCase)))
                        continue;
                    var symbol = GetJsonValue(obj, "symbol");
                    var exec = GetJsonValue(obj, "execution_status");
                    var closeReason = GetJsonValue(obj, "close_reason");
                    if (!hasServerSummary) _lastSyncSummary.Closed++;
                    AddSyncEvent("", sid, symbol, "", (exec ?? "").Trim().ToUpperInvariant() == "CANCELLED" ? "SNAPSHOT_CANCELLED" : "SNAPSHOT_CLOSED", closeReason, "closed");
                }
            }

            if (hasErrors)
            {
                _syncStatus = "PARTIAL";
                if (!string.IsNullOrEmpty(firstError)) _lastSyncErr = firstError;
            }
        }

        private async Task AckAsync(
            string sid,
            string token,
            string status,
            string ticket,
            string err,
            double entryExec = 0,
            double riskMoneyPlanned = 0,
            double volumeLots = 0,
            double requestedSl = 0,
            double usedSl = 0,
            double requestedTp = 0,
            double usedTp = 0,
            double slPips = 0,
            double tpPips = 0
        )
        {
            var payload = "{\"trade_id\":\"" + sid
                + "\",\"lease_token\":\"" + (token ?? "") + "\""
                + ",\"execution_status\":\"" + status + "\""
                + ",\"broker_trade_id\":\"" + (ticket ?? "") + "\""
                + ",\"error\":\"" + (err ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""
                + ",\"message\":\"" + (err ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""
                + ",\"entry_exec\":" + entryExec.ToString("F5", CultureInfo.InvariantCulture)
                + ",\"risk_money_planned\":" + riskMoneyPlanned.ToString("F2", CultureInfo.InvariantCulture)
                + ",\"volume\":" + volumeLots.ToString("F2", CultureInfo.InvariantCulture)
                + ",\"requested_sl\":" + requestedSl.ToString("F5", CultureInfo.InvariantCulture)
                + ",\"sl_exec\":" + usedSl.ToString("F5", CultureInfo.InvariantCulture)
                + ",\"used_sl\":" + usedSl.ToString("F5", CultureInfo.InvariantCulture)
                + ",\"requested_tp\":" + requestedTp.ToString("F5", CultureInfo.InvariantCulture)
                + ",\"tp_exec\":" + usedTp.ToString("F5", CultureInfo.InvariantCulture)
                + ",\"used_tp\":" + usedTp.ToString("F5", CultureInfo.InvariantCulture)
                + ",\"sl_pips\":" + slPips.ToString("F2", CultureInfo.InvariantCulture)
                + ",\"tp_pips\":" + tpPips.ToString("F2", CultureInfo.InvariantCulture) + "}";
            var content = new StringContent(payload, Encoding.UTF8, "application/json");
            content.Headers.Add("x-api-key", EaApiKey);
            var response = await _httpClient.PostAsync(BuildServerApiUrl("broker/ack"), content);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                throw new Exception("HTTP " + ((int)response.StatusCode).ToString(CultureInfo.InvariantCulture) + " " + response.ReasonPhrase + (string.IsNullOrWhiteSpace(body) ? "" : (": " + body)));
            }
        }

        // Reliable ack: runs on thread pool so it completes even inside BeginInvokeOnMainThread
        private void SafeAck(
            string sid,
            string token,
            string status,
            string ticket,
            string err,
            double entryExec = 0,
            double riskMoneyPlanned = 0,
            double volumeLots = 0,
            double requestedSl = 0,
            double usedSl = 0,
            double requestedTp = 0,
            double usedTp = 0,
            double slPips = 0,
            double tpPips = 0
        )
        {
            Task.Run(async () =>
            {
                const int maxAttempts = 3;
                try
                {
                    for (int attempt = 1; attempt <= maxAttempts; attempt++)
                    {
                        try
                        {
                            await AckAsync(
                                sid,
                                token,
                                status,
                                ticket,
                                err,
                                entryExec,
                                riskMoneyPlanned,
                                volumeLots,
                                requestedSl,
                                usedSl,
                                requestedTp,
                                usedTp,
                                slPips,
                                tpPips
                            );
                            if (attempt > 1)
                            {
                                SafeLog(
                                    "INFO",
                                    "[Ack] {0} recovered for {1} on retry {2}/{3}",
                                    status,
                                    sid,
                                    attempt,
                                    maxAttempts
                                );
                            }
                            break;
                        }
                        catch (Exception ex)
                        {
                            if (attempt >= maxAttempts)
                            {
                                ReleaseProcessedLease(sid, token);
                                throw new Exception(
                                    string.Format(
                                        CultureInfo.InvariantCulture,
                                        "ack failed after {0} attempts: {1}",
                                        maxAttempts,
                                        ex.Message
                                    ),
                                    ex
                                );
                            }
                            await Task.Delay(400 * attempt);
                        }
                    }
                    SafeLog(
                        IsErrorStatus(status) ? "ERROR" : "INFO",
                        IsErrorStatus(status) ? "[Error] [Ack] {0} sent for {1}" : "[Ack] {0} sent for {1}",
                        status,
                        sid
                    );
                }
                catch (Exception ex)
                {
                    SafeLog("ERROR", "[Error] [Ack] {0} failed for {1}: {2}", status, sid, ex.Message);
                }
            });
        }

        private void RefreshDebugPanel()
        {
            RunOnMainThread(RefreshDebugPanelNow);
        }

        private void RefreshDebugPanelNow()
        {
            try
            {
                Chart.RemoveObject("Panel_HEARTBEAT");
                Chart.RemoveObject("Panel_TR");

                var tl = new StringBuilder();
                tl.AppendLine(string.Format("BUILD: {0}", BuildVersion));
                tl.AppendLine(string.Format("TIME: {0}", DateTime.Now.ToString("HH:mm:ss")));
                tl.AppendLine(string.Format("SERVER: {0} | API: {1}", _serverStatus, _apiStatus));
                Chart.DrawStaticText("Panel_TL", tl.ToString(), VerticalAlignment.Top, HorizontalAlignment.Left, Color.Aqua);

                var bl = new StringBuilder();
                var pollTimeStr = _lastPollTime == DateTime.MinValue ? "WAITING..." : _lastPollTime.ToString("HH:mm:ss");
                bl.AppendLine(string.Format("GET broker/pull: {0}, {1}", _pollStatus, pollTimeStr));
                bl.AppendLine(string.Format("NET: {0}ms FAILS:{1}",
                    _lastPollLatencyMs >= 0 ? _lastPollLatencyMs.ToString(CultureInfo.InvariantCulture) : "-",
                    _pollConsecutiveFailures));
                if ((!_hasPullServerSummary && _lastPollTime == DateTime.MinValue) || ((_pollStatus == "ERROR" || _pollStatus == "FAIL") && _pollConsecutiveFailures >= 2))
                    bl.AppendLine("SERVER: unavailable");
                else if (_lastPullServerTradeCount > 0 || _lastPullServerSymbolCount > 0 || _lastPullServerStrategyCount > 0)
                    bl.AppendLine(string.Format("SERVER: TASKS:{0} TRACKED:{1} STRATS:{2}",
                        _lastPullServerTradeCount,
                        _lastPullServerSymbolCount,
                        _lastPullServerStrategyCount));
                else
                    bl.AppendLine("SERVER: no queued tasks / no tracked symbols");
                bl.AppendLine(string.Format("CLIENT: SAME:{0} CREATED:{1} CHANGED:{2} CLOSED:{3}",
                    _lastPollSummary.Unchanged,
                    _lastPollSummary.Created,
                    _lastPollSummary.Changed,
                    _lastPollSummary.Closed));
                if (_consecutiveErrors > 0) bl.AppendLine(string.Format("ERR CNT: {0}", _consecutiveErrors));
                foreach (var sig in _pollEvents) AppendWrappedPanelLine(bl, "  ", FormatPanelEventLine(sig), 44, 2);
                if (_lastPollErr != "None") bl.AppendLine("ERR: " + (_lastPollErr.Length > 50 ? _lastPollErr.Substring(0, 50) : _lastPollErr));

                var pollHasHardError =
                    _serverStatus == "OFFLINE" ||
                    _apiStatus == "UNREACHABLE" ||
                    ((_pollStatus == "ERROR" || _pollStatus == "FAIL") && _pollConsecutiveFailures >= 2) ||
                    _lastPollErr != "None";
                Color pollColor = pollHasHardError ? Color.Red :
                                 (_pollStatus == "OK" ? Color.White :
                                 (_pollStatus == "IDLE" || _pollStatus == "WAITING" ? Color.Gray :
                                 (_pollStatus == "POLLING" ? Color.Yellow : Color.Red)));
                Chart.DrawStaticText("Panel_BL", bl.ToString(), VerticalAlignment.Bottom, HorizontalAlignment.Left, pollColor);

                var br = new StringBuilder();
                var syncTimeStr = _lastSyncTime == DateTime.MinValue ? "WAITING..." : _lastSyncTime.ToString("HH:mm:ss");
                br.AppendLine(string.Format("POST broker/sync: {0}, {1}", _syncStatus, syncTimeStr));
                br.AppendLine(string.Format("NET: {0}ms FAILS:{1}",
                    _lastSyncLatencyMs >= 0 ? _lastSyncLatencyMs.ToString(CultureInfo.InvariantCulture) : "-",
                    _syncConsecutiveFailures));
                br.AppendLine(string.Format("CLIENT: POS:{0} ORD:{1} CLOSED:{2} SYMS:{3}",
                    _lastPushPositionCount,
                    _lastPushOrderCount,
                    _lastPushClosedCount,
                    _lastPushSymbolCount));
                br.AppendLine(string.Format("SERVER: SAME:{0} CREATED:{1} CHANGED:{2} CLOSED:{3}",
                    _lastSyncSummary.Unchanged,
                    _lastSyncSummary.Created,
                    _lastSyncSummary.Changed,
                    _lastSyncSummary.Closed));
                foreach (var line in _syncEvents.Take(12)) AppendWrappedPanelLine(br, "  ", FormatPanelEventLine(line), 44, 2);
                if (_syncEvents.Count > 12) br.AppendLine(string.Format("  ... +{0} more", _syncEvents.Count - 12));
                if (_lastSyncErr != "None") AppendWrappedPanelLine(br, "ERR: ", _lastSyncErr, 44, 3);

                var syncHasHardError =
                    _serverStatus == "OFFLINE" ||
                    _apiStatus == "UNREACHABLE" ||
                    (((_syncStatus == "ERROR") || _syncStatus.StartsWith("FAIL", StringComparison.OrdinalIgnoreCase)) && _syncConsecutiveFailures >= 2) ||
                    _lastSyncErr != "None";
                Color syncColor = syncHasHardError ? Color.Red :
                                 (_syncStatus == "OK" ? Color.Lime :
                                 (_syncStatus == "IDLE" || _syncStatus == "WAITING" ? Color.Gray :
                                 (_syncStatus == "SYNCING" ? Color.Yellow :
                                 (_syncStatus == "PARTIAL" ? Color.Orange : Color.Red))));
                Chart.DrawStaticText("Panel_BR", br.ToString(), VerticalAlignment.Bottom, HorizontalAlignment.Right, syncColor);
            }
            catch (Exception ex)
            {
                SafePrint("[Panel] Draw failed: {0}", ex.Message);
            }
        }

        private string GetJsonValue(string json, string key)
        {
            var m = Regex.Match(json, string.Format("\"{0}\"\\s*:\\s*\"?([^,\"]*)\"?", key));
            return m.Success ? m.Groups[1].Value.Trim() : "";
        }

        private string GetJsonObject(string json, string key)
        {
            var m = Regex.Match(json, string.Format("\"{0}\"\\s*:\\s*\\{{(.*?)\\}}", key), RegexOptions.Singleline);
            return m.Success ? "{" + m.Groups[1].Value + "}" : "";
        }

        private int GetJsonInt(string json, string key)
        {
            int value;
            return int.TryParse(GetJsonValue(json, key), NumberStyles.Any, CultureInfo.InvariantCulture, out value) ? value : 0;
        }

        private List<string> GetJsonStringArray(string json, string key)
        {
            var result = new List<string>();
            var match = Regex.Match(json, string.Format("\"{0}\"\\s*:\\s*\\[(.*?)\\]", key), RegexOptions.Singleline);
            if (!match.Success) return result;
            var items = Regex.Matches(match.Groups[1].Value, "\"([^\"]+)\"");
            foreach (Match item in items)
            {
                var value = item.Groups[1].Value;
                if (!string.IsNullOrWhiteSpace(value) && !result.Contains(value))
                    result.Add(value);
            }
            return result;
        }
        private double ParseDouble(string val) { double r; return double.TryParse(val, NumberStyles.Any, CultureInfo.InvariantCulture, out r) ? r : 0; }
    }
}
