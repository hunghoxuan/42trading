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
        private const string BuildVersion = "v2026.07.20 17:16 - market-protection-refine-fix";
        private const string BridgeSourceId = "Ctrader";
        private const string BridgeSourceType = "ctrader_bridge";
        private const int TransientErrorLogThresholdCount = 10;
        private const int TransientErrorLogThresholdSeconds = 30;
        private bool _showProcessDebugPanel = true;
        private bool _showRiskGatePanel = true;
        private StackPanel _chartButtonPanel;
        private object _chartSymbolCombo;
        private string _chartSelectedSymbol = "";
        private string _chartSymbolsSignature = "";
        private bool _isRebuildingChartPanel = false;
        [Parameter("Server API Base URL", DefaultValue = "http://127.0.0.1:3001/api")]
        public string ServerBaseUrl { get; set; }

        [Parameter("EA API Key", DefaultValue = "acc_506cb604d10644736df6a7bf77c79fd30731")]
        public string EaApiKey { get; set; }

        [Parameter("Max Risk ($)", Group = "Risk Gate", DefaultValue = 50)]
        public double MaxRiskAmount { get; set; }

        [Parameter("Max Risk (%)", Group = "Risk Gate", DefaultValue = 0.5)]
        public double MaxRiskPercent { get; set; }

        [Parameter("Max Total Open Risk ($)", Group = "Risk Gate", DefaultValue = 150, MinValue = 0)]
        public double MaxTotalOpenRiskAmount { get; set; }

        [Parameter("Max Total Open Risk (%)", Group = "Risk Gate", DefaultValue = 1.5, MinValue = 0)]
        public double MaxTotalOpenRiskPercent { get; set; }

        [Parameter("Max Daily Loss ($)", Group = "Risk Gate", DefaultValue = 300, MinValue = 0)]
        public double MaxDailyLossAmount { get; set; }

        [Parameter("Max Daily Loss (%)", Group = "Risk Gate", DefaultValue = 3, MinValue = 0)]
        public double MaxDailyLossPercent { get; set; }

        [Parameter("Max Equity Drawdown ($)", Group = "Risk Gate", DefaultValue = 500, MinValue = 0)]
        public double MaxEquityDrawdownAmount { get; set; }

        [Parameter("Max Equity Drawdown (%)", Group = "Risk Gate", DefaultValue = 5, MinValue = 0)]
        public double MaxEquityDrawdownPercent { get; set; }

        [Parameter("Max Open Positions", Group = "Risk Gate", DefaultValue = 20, MinValue = 0)]
        public int HardMaxOpenPositions { get; set; }

        [Parameter("Max Pending Orders", Group = "Risk Gate", DefaultValue = 20, MinValue = 0)]
        public int HardMaxPendingOrders { get; set; }

        [Parameter("Margin Safety Cap (%)", Group = "Risk Gate", DefaultValue = 98, MinValue = 0, MaxValue = 100)]
        public double MarginSafetyPercent { get; set; }

        [Parameter("Polling Frequency (sec)", DefaultValue = 2, MinValue = 1)]
        public int PollSeconds { get; set; }

        [Parameter("Magic Number", DefaultValue = 20260411)]
        public int MagicNumber { get; set; }

        [Parameter("Provider Code", DefaultValue = "ICMARKETS")]
        public string ProviderCode { get; set; }

        [Parameter("Master Timer (sec)", Group = "Timer", DefaultValue = 1, MinValue = 1)]
        public int MasterTimerSeconds { get; set; }

        [Parameter("Poll Timeout (sec)", Group = "Timer", DefaultValue = 12, MinValue = 3)]
        public int PollTimeoutSeconds { get; set; }

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

        [Parameter("Min Stop Distance (pips)", Group = "Risk Gate", DefaultValue = 15, MinValue = 5)]
        public double MinStopPips { get; set; }

        [Parameter("Max Stop/Target Distance (pips)", Group = "Risk Gate", DefaultValue = 5000, MinValue = 50)]
        public double MaxProtectionPips { get; set; }

        [Parameter("Max Reward/Risk Ratio", Group = "Risk Gate", DefaultValue = 20, MinValue = 1)]
        public double MaxRewardRiskRatio { get; set; }

        [Parameter("On SL/TP Error", Group = "Risk Gate", DefaultValue = "Adjust")]
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
        private string _lastPanelMessage = "Ready";
        private bool _lastPanelMessageIsError = false;
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
        private double _peakEquitySeen = 0;
        private double _peakBalanceSeen = 0;
        private DateTime _riskAnchorStartedAt = DateTime.MinValue;


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
                foreach (var loaded in Symbols)
                {
                    if (loaded == null) continue;
                    var loadedName = loaded.ToString();
                    if (string.IsNullOrWhiteSpace(loadedName)) continue;
                    if (string.Equals(loadedName, resolvedName, StringComparison.OrdinalIgnoreCase))
                        return Symbols.GetSymbol(loadedName);
                }
            }
            catch
            {
            }
            return null;
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

        private static object TryGetPropertyValue(object target, string propertyName)
        {
            if (target == null || string.IsNullOrWhiteSpace(propertyName)) return null;
            try
            {
                var prop = target.GetType().GetProperty(propertyName);
                if (prop == null) return null;
                return prop.GetValue(target, null);
            }
            catch
            {
                return null;
            }
        }

        private static bool TryReadBoolMember(object target, string memberName, out bool value)
        {
            value = false;
            if (target == null || string.IsNullOrWhiteSpace(memberName)) return false;
            try
            {
                var prop = target.GetType().GetProperty(memberName);
                if (prop != null)
                {
                    var raw = prop.GetValue(target, null);
                    if (raw is bool b)
                    {
                        value = b;
                        return true;
                    }
                }
            }
            catch
            {
            }
            try
            {
                var method = target.GetType().GetMethod(memberName, Type.EmptyTypes);
                if (method != null)
                {
                    var raw = method.Invoke(target, null);
                    if (raw is bool b)
                    {
                        value = b;
                        return true;
                    }
                }
            }
            catch
            {
            }
            return false;
        }

        private static void TrySetPropertyValue(object target, string propertyName, object value)
        {
            if (target == null || string.IsNullOrWhiteSpace(propertyName) || value == null) return;
            try
            {
                var prop = target.GetType().GetProperty(propertyName);
                if (prop == null || !prop.CanWrite) return;
                var targetType = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;
                object converted = value;
                if (targetType != value.GetType())
                    converted = Convert.ChangeType(value, targetType, CultureInfo.InvariantCulture);
                prop.SetValue(target, converted, null);
            }
            catch
            {
            }
        }

        private static void TryStyleChartText(object chartText, int fontSize, string fontFamily, bool isBold)
        {
            if (chartText == null) return;
            TrySetPropertyValue(chartText, "FontSize", fontSize);
            TrySetPropertyValue(chartText, "FontFamily", fontFamily);
            TrySetPropertyValue(chartText, "IsBold", isBold);
        }

        private static bool TryInvokeVoidMethod(object target, string methodName, params object[] args)
        {
            if (target == null || string.IsNullOrWhiteSpace(methodName)) return false;
            try
            {
                var methods = target.GetType().GetMethods().Where(m => m.Name == methodName).ToList();
                foreach (var method in methods)
                {
                    var parameters = method.GetParameters();
                    if (parameters.Length != (args != null ? args.Length : 0)) continue;
                    method.Invoke(target, args);
                    return true;
                }
            }
            catch
            {
            }
            return false;
        }

        private static bool TryClearCollection(object target)
        {
            if (target == null) return false;
            try
            {
                var clearMethod = target.GetType().GetMethod("Clear", Type.EmptyTypes);
                if (clearMethod == null) return false;
                clearMethod.Invoke(target, null);
                return true;
            }
            catch
            {
            }
            return false;
        }

        private static bool TryAddToCollection(object collection, object item)
        {
            if (collection == null || item == null) return false;
            try
            {
                var addMethod = collection.GetType().GetMethod("Add");
                if (addMethod == null) return false;
                addMethod.Invoke(collection, new[] { item });
                return true;
            }
            catch
            {
            }
            return false;
        }

        private static string PadCell(string value, int width, bool alignRight = false)
        {
            var safe = string.IsNullOrEmpty(value) ? "" : value;
            if (safe.Length > width)
                safe = safe.Substring(0, width);
            return alignRight ? safe.PadLeft(width, ' ') : safe.PadRight(width, ' ');
        }

        private static string BuildTextTableRow(params string[] cells)
        {
            if (cells == null || cells.Length == 0) return "";
            return " " + string.Join("   ", cells) + " ";
        }

        private static string BuildOffsetText(int blankLines, string content)
        {
            if (blankLines <= 0) return content ?? "";
            return new string('\n', blankLines) + (content ?? "");
        }

        private static int CountTextLines(string text)
        {
            if (string.IsNullOrEmpty(text)) return 0;
            return text.Split(new[] { '\n' }, StringSplitOptions.None).Length;
        }

        private static string FormatDashboardNumber(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) return "-";
            var abs = Math.Abs(value);
            if (abs >= 1.0)
                return Math.Round(value, 0, MidpointRounding.AwayFromZero).ToString("0", CultureInfo.InvariantCulture);
            if (abs <= 0.0000001)
                return "0";
            return value.ToString("0.##", CultureInfo.InvariantCulture);
        }

        private static string FormatDashboardPercent(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) return "-";
            return value.ToString("0.00", CultureInfo.InvariantCulture);
        }

        private string DetectSymbolTradeAvailabilityReason(Symbol symbol)
        {
            if (symbol == null) return "SYMBOL_NULL";

            try
            {
                bool boolState;
                if (TryReadBoolMember(symbol, "IsTradingEnabled", out boolState) && !boolState)
                    return "SYMBOL_TRADING_DISABLED";
                if (TryReadBoolMember(symbol, "IsTradable", out boolState) && !boolState)
                    return "SYMBOL_NOT_TRADABLE";
            }
            catch
            {
            }

            try
            {
                var tradingMode = TryGetPropertyValue(symbol, "TradingMode");
                var tradingModeText = tradingMode != null ? Convert.ToString(tradingMode, CultureInfo.InvariantCulture).Trim().ToUpperInvariant() : "";
                if (!string.IsNullOrWhiteSpace(tradingModeText))
                {
                    if (tradingModeText.Contains("DISABLED")) return "SYMBOL_TRADING_DISABLED";
                    if (tradingModeText.Contains("CLOSEONLY")) return "SYMBOL_CLOSE_ONLY";
                }
            }
            catch
            {
            }

            try
            {
                var marketHours = TryGetPropertyValue(symbol, "MarketHours");
                if (marketHours != null)
                {
                    bool isOpen;
                    if (TryReadBoolMember(marketHours, "IsOpened", out isOpen) && !isOpen)
                        return "MARKET_CLOSED";
                    if (TryReadBoolMember(marketHours, "IsOpen", out isOpen) && !isOpen)
                        return "MARKET_CLOSED";
                }
            }
            catch
            {
            }

            if (!HasUsableQuotes(symbol)) return "NO_QUOTES";
            return "";
        }

        private string BuildSubmitContext(
            Symbol symbol,
            string action,
            string orderType,
            double entry,
            double executionPrice,
            double sl,
            double tp,
            double volumeUnits,
            double requestedRiskMoney,
            double finalRiskMoney)
        {
            var symbolName = symbol != null ? symbol.Name : "UNKNOWN";
            var bid = symbol != null && !double.IsNaN(symbol.Bid) ? symbol.Bid : 0;
            var ask = symbol != null && !double.IsNaN(symbol.Ask) ? symbol.Ask : 0;
            var spread = symbol != null && !double.IsNaN(symbol.Spread) ? symbol.Spread : 0;
            var minVol = symbol != null && !double.IsNaN(symbol.VolumeInUnitsMin) ? symbol.VolumeInUnitsMin : 0;
            var stepVol = symbol != null && !double.IsNaN(symbol.VolumeInUnitsStep) ? symbol.VolumeInUnitsStep : 0;
            var lots = 0.0;
            var estimatedMargin = 0.0;
            var marginBudget = 0.0;
            var marginSafetyMultiplier = Math.Max(0.0, Math.Min(1.0, MarginSafetyPercent / 100.0));
            try
            {
                if (symbol != null && volumeUnits > 0)
                {
                    lots = symbol.VolumeInUnitsToQuantity(volumeUnits);
                    estimatedMargin = symbol.GetEstimatedMargin(action == "BUY" ? TradeType.Buy : TradeType.Sell, volumeUnits);
                }
            }
            catch
            {
                lots = 0;
                estimatedMargin = 0;
            }
            marginBudget = Account != null ? Math.Max(0, Account.FreeMargin * marginSafetyMultiplier) : 0;

            var tradableReason = DetectSymbolTradeAvailabilityReason(symbol);
            var tradableState = string.IsNullOrWhiteSpace(tradableReason) ? "OK" : tradableReason;
            return string.Format(
                CultureInfo.InvariantCulture,
                "symbol={0}; side={1}; type={2}; bid={3:F5}; ask={4:F5}; spread={5:F2}; entry={6:F5}; exec={7:F5}; sl={8:F5}; tp={9:F5}; volume_units={10:F2}; lots={11:F4}; min_vol={12:F2}; step_vol={13:F2}; requested_risk={14:F2}; final_risk={15:F2}; free_margin={16:F2}; margin_budget={17:F2}; estimated_margin={18:F2}; tradable={19}",
                symbolName,
                action,
                orderType,
                bid,
                ask,
                spread,
                entry,
                executionPrice,
                sl,
                tp,
                volumeUnits,
                lots,
                minVol,
                stepVol,
                requestedRiskMoney,
                finalRiskMoney,
                Account != null ? Account.FreeMargin : 0,
                marginBudget,
                estimatedMargin,
                tradableState
            );
        }

        private bool TryFitVolumeToFreeMargin(
            Symbol symbol,
            TradeType tradeType,
            double requestedVolumeUnits,
            out double fittedVolumeUnits,
            out double estimatedMargin,
            out double marginBudget,
            out string note)
        {
            fittedVolumeUnits = 0;
            estimatedMargin = 0;
            var marginSafetyMultiplier = Math.Max(0.0, Math.Min(1.0, MarginSafetyPercent / 100.0));
            marginBudget = Account != null ? Math.Max(0, Account.FreeMargin * marginSafetyMultiplier) : 0;
            note = "";

            if (symbol == null)
            {
                note = "symbol_missing";
                return false;
            }

            if (marginBudget <= 0)
            {
                note = "free_margin<=0";
                return false;
            }

            var minVolume = !double.IsNaN(symbol.VolumeInUnitsMin) && symbol.VolumeInUnitsMin > 0
                ? symbol.VolumeInUnitsMin
                : 0;
            var stepVolume = !double.IsNaN(symbol.VolumeInUnitsStep) && symbol.VolumeInUnitsStep > 0
                ? symbol.VolumeInUnitsStep
                : minVolume;

            var candidate = symbol.NormalizeVolumeInUnits(requestedVolumeUnits, RoundingMode.Down);
            if (candidate < minVolume)
            {
                note = string.Format(
                    CultureInfo.InvariantCulture,
                    "volume_below_min requested={0:F2} min={1:F2}",
                    requestedVolumeUnits,
                    minVolume
                );
                return false;
            }

            try
            {
                estimatedMargin = symbol.GetEstimatedMargin(tradeType, candidate);
                if (estimatedMargin > 0 && estimatedMargin <= marginBudget)
                {
                    fittedVolumeUnits = candidate;
                    note = string.Format(
                        CultureInfo.InvariantCulture,
                        "margin_ok est={0:F2} budget={1:F2}",
                        estimatedMargin,
                        marginBudget
                    );
                    return true;
                }
            }
            catch (Exception ex)
            {
                note = "margin_estimate_failed: " + ex.Message;
                return false;
            }

            var previousCandidate = candidate;
            while (candidate > minVolume)
            {
                candidate -= stepVolume;
                candidate = symbol.NormalizeVolumeInUnits(candidate, RoundingMode.Down);
                if (candidate < minVolume) break;
                if (Math.Abs(candidate - previousCandidate) < 0.0000001) break;
                previousCandidate = candidate;
                try
                {
                    estimatedMargin = symbol.GetEstimatedMargin(tradeType, candidate);
                    if (estimatedMargin > 0 && estimatedMargin <= marginBudget)
                    {
                        fittedVolumeUnits = candidate;
                        note = string.Format(
                            CultureInfo.InvariantCulture,
                            "margin_fit est={0:F2} budget={1:F2}",
                            estimatedMargin,
                            marginBudget
                        );
                        return true;
                    }
                }
                catch (Exception ex)
                {
                    note = "margin_estimate_failed: " + ex.Message;
                    return false;
                }
            }

            try
            {
                estimatedMargin = symbol.GetEstimatedMargin(tradeType, minVolume);
            }
            catch
            {
                estimatedMargin = 0;
            }
            note = string.Format(
                CultureInfo.InvariantCulture,
                "margin_unaffordable requested={0:F2} min={1:F2} est={2:F2} budget={3:F2}",
                requestedVolumeUnits,
                minVolume,
                estimatedMargin,
                marginBudget
            );
            return false;
        }

        private class RiskGateState
        {
            public int OpenPositionsCount;
            public int PendingOrdersCount;
            public double UsedMarginAmount;
            public double ExistingOpenRiskAmount;
            public double CandidateRiskAmount;
            public double TotalOpenRiskAmount;
            public double TotalOpenRiskPercent;
            public double DailyClosedPnl;
            public double DailyFloatingPnl;
            public double DailyTotalPnl;
            public double CurrentWinAmount;
            public double CurrentLoseAmount;
            public double ClosedTodayWinAmount;
            public double ClosedTodayLoseAmount;
            public double PossibleWinAmount;
            public double PossibleLoseAmount;
            public double DailyClosedNetLossAmount;
            public double DailyLossAmount;
            public double DailyLossPercent;
            public double PeakEquitySeen;
            public double CurrentEquity;
            public double EquityDrawdownAmount;
            public double EquityDrawdownPercent;
            public double AccountBalance;
        }

        private void RefreshRiskAnchors()
        {
            var balance = Account != null ? Math.Max(0, Account.Balance) : 0;
            var equity = Account != null ? Math.Max(0, Account.Equity) : 0;
            if (_riskAnchorStartedAt == DateTime.MinValue)
                _riskAnchorStartedAt = DateTime.UtcNow;
            if (balance > _peakBalanceSeen) _peakBalanceSeen = balance;
            if (equity > _peakEquitySeen) _peakEquitySeen = equity;
            if (_peakBalanceSeen <= 0) _peakBalanceSeen = balance;
            if (_peakEquitySeen <= 0) _peakEquitySeen = equity;
        }

        private double EstimateRiskAmount(Symbol symbol, TradeType tradeType, double entryPrice, double stopLossPrice, double volumeUnits)
        {
            if (symbol == null || volumeUnits <= 0 || entryPrice <= 0 || stopLossPrice <= 0 || symbol.PipSize <= 0)
                return 0;
            var slPips = Math.Abs(entryPrice - stopLossPrice) / symbol.PipSize;
            if (double.IsNaN(slPips) || slPips <= 0) return 0;
            var pipValue = double.IsNaN(symbol.PipValue) ? 0 : symbol.PipValue;
            if (pipValue <= 0) return 0;
            var riskAmount = slPips * pipValue * volumeUnits;
            return double.IsNaN(riskAmount) || double.IsInfinity(riskAmount) ? 0 : Math.Max(0, riskAmount);
        }

        private double EstimatePnlFromPips(Symbol symbol, double pips, double volumeUnits)
        {
            if (symbol == null || volumeUnits <= 0) return 0;
            var pipValue = double.IsNaN(symbol.PipValue) ? 0 : symbol.PipValue;
            if (pipValue <= 0) return 0;
            var pnl = pips * pipValue * volumeUnits;
            return double.IsNaN(pnl) || double.IsInfinity(pnl) ? 0 : pnl;
        }

        private double NormalizePriceToSymbol(Symbol symbol, double price)
        {
            if (symbol == null || price <= 0) return price;
            return Math.Round(price, symbol.Digits, MidpointRounding.AwayFromZero);
        }

        private bool HasRequiredProtection(Position position, bool needsSl, bool needsTp)
        {
            if (position == null) return false;
            if (needsSl && !position.StopLoss.HasValue) return false;
            if (needsTp && !position.TakeProfit.HasValue) return false;
            return true;
        }

        private double EstimateOpenPositionRiskAmount(Position position)
        {
            if (position == null || !position.StopLoss.HasValue) return 0;
            var symbol = ResolveLoadedSymbol(position.SymbolName);
            if (symbol == null) return 0;
            return EstimateRiskAmount(symbol, position.TradeType, position.EntryPrice, position.StopLoss.Value, position.VolumeInUnits);
        }

        private double EstimatePendingOrderRiskAmount(PendingOrder order)
        {
            if (order == null || !order.StopLoss.HasValue) return 0;
            var symbol = ResolveLoadedSymbol(order.SymbolName);
            if (symbol == null) return 0;
            return EstimateRiskAmount(symbol, order.TradeType, order.TargetPrice, order.StopLoss.Value, order.VolumeInUnits);
        }

        private double EstimateOpenPositionTpAmount(Position position)
        {
            if (position == null || !position.TakeProfit.HasValue) return 0;
            var symbol = ResolveLoadedSymbol(position.SymbolName);
            if (symbol == null || symbol.PipSize <= 0) return 0;
            var pips = (position.TakeProfit.Value - position.EntryPrice) / symbol.PipSize;
            if (position.TradeType == TradeType.Sell) pips = -pips;
            return Math.Max(0, EstimatePnlFromPips(symbol, pips, position.VolumeInUnits));
        }

        private double EstimatePendingOrderTpAmount(PendingOrder order)
        {
            if (order == null || !order.TakeProfit.HasValue) return 0;
            var symbol = ResolveLoadedSymbol(order.SymbolName);
            if (symbol == null || symbol.PipSize <= 0) return 0;
            var pips = (order.TakeProfit.Value - order.TargetPrice) / symbol.PipSize;
            if (order.TradeType == TradeType.Sell) pips = -pips;
            return Math.Max(0, EstimatePnlFromPips(symbol, pips, order.VolumeInUnits));
        }

        private RiskGateState BuildRiskGateState(double candidateRiskAmount)
        {
            RefreshRiskAnchors();

            var state = new RiskGateState();
            state.OpenPositionsCount = Positions != null ? Positions.Count : 0;
            state.PendingOrdersCount = PendingOrders != null ? PendingOrders.Count : 0;
            state.UsedMarginAmount = Account != null && !double.IsNaN(Account.Margin) ? Math.Max(0, Account.Margin) : 0;
            state.ExistingOpenRiskAmount =
                (Positions != null ? Positions.Sum(EstimateOpenPositionRiskAmount) : 0) +
                (PendingOrders != null ? PendingOrders.Sum(EstimatePendingOrderRiskAmount) : 0);
            state.CandidateRiskAmount = Math.Max(0, candidateRiskAmount);
            state.TotalOpenRiskAmount = state.ExistingOpenRiskAmount + state.CandidateRiskAmount;
            state.AccountBalance = Account != null ? Math.Max(0, Account.Balance) : 0;
            state.CurrentEquity = Account != null ? Math.Max(0, Account.Equity) : 0;
            state.TotalOpenRiskPercent = state.AccountBalance > 0
                ? (state.TotalOpenRiskAmount / state.AccountBalance) * 100.0
                : 0;

            var dayStart = Server.Time.Date;
            state.DailyClosedPnl = History != null
                ? History.Where(d => d != null && d.ClosingTime >= dayStart).Sum(d => double.IsNaN(d.NetProfit) ? 0 : d.NetProfit)
                : 0;
            state.DailyFloatingPnl = Positions != null
                ? Positions.Sum(p => double.IsNaN(p.NetProfit) ? 0 : p.NetProfit)
                : 0;
            state.CurrentWinAmount = Positions != null
                ? Positions.Sum(p => Math.Max(0, double.IsNaN(p.NetProfit) ? 0 : p.NetProfit))
                : 0;
            state.CurrentLoseAmount = Positions != null
                ? Positions.Sum(p => Math.Max(0, -(double.IsNaN(p.NetProfit) ? 0 : p.NetProfit)))
                : 0;
            state.ClosedTodayWinAmount = History != null
                ? History.Where(d => d != null && d.ClosingTime >= dayStart).Sum(d => Math.Max(0, double.IsNaN(d.NetProfit) ? 0 : d.NetProfit))
                : 0;
            state.ClosedTodayLoseAmount = History != null
                ? History.Where(d => d != null && d.ClosingTime >= dayStart).Sum(d => Math.Max(0, -(double.IsNaN(d.NetProfit) ? 0 : d.NetProfit)))
                : 0;
            state.PossibleWinAmount =
                (Positions != null ? Positions.Sum(EstimateOpenPositionTpAmount) : 0) +
                (PendingOrders != null ? PendingOrders.Sum(EstimatePendingOrderTpAmount) : 0);
            state.PossibleLoseAmount = state.ExistingOpenRiskAmount;
            state.DailyClosedNetLossAmount = state.ClosedTodayLoseAmount - state.ClosedTodayWinAmount;
            state.DailyTotalPnl = state.DailyClosedPnl + state.DailyFloatingPnl;
            state.DailyLossAmount = Math.Max(0, state.DailyClosedNetLossAmount);
            state.DailyLossPercent = state.AccountBalance > 0
                ? (state.DailyLossAmount / state.AccountBalance) * 100.0
                : 0;

            state.PeakEquitySeen = Math.Max(_peakEquitySeen, state.CurrentEquity);
            state.EquityDrawdownAmount = Math.Max(0, state.PeakEquitySeen - state.CurrentEquity);
            state.EquityDrawdownPercent = state.PeakEquitySeen > 0
                ? (state.EquityDrawdownAmount / state.PeakEquitySeen) * 100.0
                : 0;
            return state;
        }

        private bool TryPassRiskFirewall(
            Symbol symbol,
            string action,
            string orderTypeStr,
            double entry,
            double executionPrice,
            double sl,
            double tp,
            double volumeUnits,
            double requestedRiskMoney,
            double finalRiskMoney,
            out string rejectReason)
        {
            rejectReason = "";
            var tradeType = action == "BUY" ? TradeType.Buy : TradeType.Sell;
            var submitReferencePrice = (orderTypeStr == "market" || entry <= 0) ? executionPrice : entry;
            var candidateRiskAmount = EstimateRiskAmount(symbol, tradeType, submitReferencePrice, sl, volumeUnits);
            var state = BuildRiskGateState(candidateRiskAmount);
            var perTradeRiskTolerance = Math.Max(1.0, finalRiskMoney * 0.02);

            if (finalRiskMoney > 0 && state.CandidateRiskAmount > finalRiskMoney + perTradeRiskTolerance)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "per_trade_risk {0:F2}>{1:F2}; requested={2:F2}; entry={3:F5}; sl={4:F5}",
                    state.CandidateRiskAmount,
                    finalRiskMoney,
                    requestedRiskMoney,
                    submitReferencePrice,
                    sl
                );
                return false;
            }

            if (HardMaxOpenPositions > 0 && state.OpenPositionsCount >= HardMaxOpenPositions)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "hard_open_positions_limit {0}/{1}; existing_open_risk={2:F2}; daily_pnl={3:F2}",
                    state.OpenPositionsCount,
                    HardMaxOpenPositions,
                    state.ExistingOpenRiskAmount,
                    state.DailyTotalPnl
                );
                return false;
            }

            if (HardMaxPendingOrders > 0 && state.PendingOrdersCount >= HardMaxPendingOrders)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "hard_pending_orders_limit {0}/{1}; existing_open_risk={2:F2}",
                    state.PendingOrdersCount,
                    HardMaxPendingOrders,
                    state.ExistingOpenRiskAmount
                );
                return false;
            }

            if (MaxTotalOpenRiskAmount > 0 && state.TotalOpenRiskAmount > MaxTotalOpenRiskAmount)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "total_open_risk_amount {0:F2}>{1:F2}; existing={2:F2}; candidate={3:F2}",
                    state.TotalOpenRiskAmount,
                    MaxTotalOpenRiskAmount,
                    state.ExistingOpenRiskAmount,
                    state.CandidateRiskAmount
                );
                return false;
            }

            if (MaxTotalOpenRiskPercent > 0 && state.TotalOpenRiskPercent > MaxTotalOpenRiskPercent)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "total_open_risk_pct {0:F2}>{1:F2}; total_open_risk={2:F2}; balance={3:F2}",
                    state.TotalOpenRiskPercent,
                    MaxTotalOpenRiskPercent,
                    state.TotalOpenRiskAmount,
                    state.AccountBalance
                );
                return false;
            }

            if (MaxDailyLossAmount > 0 && state.DailyLossAmount >= MaxDailyLossAmount)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "daily_loss_amount {0:F2}>={1:F2}; closed={2:F2}; floating={3:F2}",
                    state.DailyLossAmount,
                    MaxDailyLossAmount,
                    state.DailyClosedPnl,
                    state.DailyFloatingPnl
                );
                return false;
            }

            if (MaxDailyLossPercent > 0 && state.DailyLossPercent >= MaxDailyLossPercent)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "daily_loss_pct {0:F2}>={1:F2}; daily_loss={2:F2}; balance={3:F2}",
                    state.DailyLossPercent,
                    MaxDailyLossPercent,
                    state.DailyLossAmount,
                    state.AccountBalance
                );
                return false;
            }

            if (MaxEquityDrawdownAmount > 0 && state.EquityDrawdownAmount >= MaxEquityDrawdownAmount)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "equity_drawdown_amount {0:F2}>={1:F2}; peak={2:F2}; equity={3:F2}",
                    state.EquityDrawdownAmount,
                    MaxEquityDrawdownAmount,
                    state.PeakEquitySeen,
                    state.CurrentEquity
                );
                return false;
            }

            if (MaxEquityDrawdownPercent > 0 && state.EquityDrawdownPercent >= MaxEquityDrawdownPercent)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "equity_drawdown_pct {0:F2}>={1:F2}; peak={2:F2}; equity={3:F2}",
                    state.EquityDrawdownPercent,
                    MaxEquityDrawdownPercent,
                    state.PeakEquitySeen,
                    state.CurrentEquity
                );
                return false;
            }

            return true;
        }

        private bool TryValidateProtectionPrices(
            Symbol symbol,
            string action,
            double referencePrice,
            double sl,
            double tp,
            out string reason
        )
        {
            reason = "";

            if (referencePrice <= 0)
            {
                reason = "invalid_reference_price";
                return false;
            }

            var isBuy = string.Equals(action, "BUY", StringComparison.OrdinalIgnoreCase);
            var isSell = string.Equals(action, "SELL", StringComparison.OrdinalIgnoreCase);
            if (!isBuy && !isSell)
            {
                reason = "invalid_action";
                return false;
            }

            var minMove = symbol.PipSize > 0 ? symbol.PipSize * 0.5 : 0.0;

            if (sl > 0)
            {
                if (isBuy && sl >= referencePrice - minMove)
                {
                    reason = string.Format(
                        CultureInfo.InvariantCulture,
                        "sl_wrong_side ref={0:F5} sl={1:F5} side=BUY",
                        referencePrice,
                        sl
                    );
                    return false;
                }
                if (isSell && sl <= referencePrice + minMove)
                {
                    reason = string.Format(
                        CultureInfo.InvariantCulture,
                        "sl_wrong_side ref={0:F5} sl={1:F5} side=SELL",
                        referencePrice,
                        sl
                    );
                    return false;
                }
            }

            if (tp > 0)
            {
                if (isBuy && tp <= referencePrice + minMove)
                {
                    reason = string.Format(
                        CultureInfo.InvariantCulture,
                        "tp_wrong_side ref={0:F5} tp={1:F5} side=BUY",
                        referencePrice,
                        tp
                    );
                    return false;
                }
                if (isSell && tp >= referencePrice - minMove)
                {
                    reason = string.Format(
                        CultureInfo.InvariantCulture,
                        "tp_wrong_side ref={0:F5} tp={1:F5} side=SELL",
                        referencePrice,
                        tp
                    );
                    return false;
                }
            }

            if (symbol.PipSize > 0)
            {
                double? slDistPips = sl > 0 ? Math.Abs(referencePrice - sl) / symbol.PipSize : (double?)null;
                double? tpDistPips = tp > 0 ? Math.Abs(tp - referencePrice) / symbol.PipSize : (double?)null;

                if (slDistPips.HasValue && MaxProtectionPips > 0 && slDistPips.Value > MaxProtectionPips)
                {
                    reason = string.Format(
                        CultureInfo.InvariantCulture,
                        "sl_distance_too_large ref={0:F5} sl={1:F5} dist_pips={2:F1} max={3:F1}",
                        referencePrice,
                        sl,
                        slDistPips.Value,
                        MaxProtectionPips
                    );
                    return false;
                }

                if (tpDistPips.HasValue && MaxProtectionPips > 0 && tpDistPips.Value > MaxProtectionPips)
                {
                    reason = string.Format(
                        CultureInfo.InvariantCulture,
                        "tp_distance_too_large ref={0:F5} tp={1:F5} dist_pips={2:F1} max={3:F1}",
                        referencePrice,
                        tp,
                        tpDistPips.Value,
                        MaxProtectionPips
                    );
                    return false;
                }

                if (
                    slDistPips.HasValue &&
                    tpDistPips.HasValue &&
                    slDistPips.Value > 0 &&
                    MaxRewardRiskRatio > 0
                )
                {
                    var rewardRisk = tpDistPips.Value / slDistPips.Value;
                    if (rewardRisk > MaxRewardRiskRatio)
                    {
                        reason = string.Format(
                            CultureInfo.InvariantCulture,
                            "reward_risk_too_large rr={0:F2} tp_pips={1:F1} sl_pips={2:F1} max={3:F2}",
                            rewardRisk,
                            tpDistPips.Value,
                            slDistPips.Value,
                            MaxRewardRiskRatio
                        );
                        return false;
                    }
                }
            }

            return true;
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
            _lastPanelMessage = message;
            _lastPanelMessageIsError =
                string.Equals((level ?? "").Trim(), "ERROR", StringComparison.OrdinalIgnoreCase) ||
                message.IndexOf("[Error]", StringComparison.OrdinalIgnoreCase) >= 0 ||
                message.IndexOf(" failed", StringComparison.OrdinalIgnoreCase) >= 0 ||
                message.IndexOf(" rejected", StringComparison.OrdinalIgnoreCase) >= 0;
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
            RefreshRiskAnchors();
            int interval = Math.Max(1, MasterTimerSeconds);
            Timer.Start(TimeSpan.FromSeconds(interval));
            _lastTimerTickSeen = DateTime.Now;
            StartMasterWatchdog(interval);
            BuildChartButtonPanel();
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
                                    tpPnl = EstimatePnlFromPips(s, pips, pos.VolumeInUnits);
                                    distanceTp = Math.Abs(pips);
                                }
                                if (pos.StopLoss.HasValue)
                                {
                                    double pips = (pos.StopLoss.Value - pos.EntryPrice) / s.PipSize;
                                    if (pos.TradeType == TradeType.Sell) pips = -pips;
                                    slPnl = EstimatePnlFromPips(s, pips, pos.VolumeInUnits);
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
                                if (order.TakeProfit.HasValue) { double pp = Math.Abs(order.TargetPrice - order.TakeProfit.Value) / s2.PipSize; pnlTp = EstimatePnlFromPips(s2, pp, order.VolumeInUnits); }
                                if (order.StopLoss.HasValue) { double pp = Math.Abs(order.TargetPrice - order.StopLoss.Value) / s2.PipSize; pnlSl = -EstimatePnlFromPips(s2, pp, order.VolumeInUnits); }
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
                        foreach (var activeSymbol in GetActiveSymbols())
                            if (!string.IsNullOrWhiteSpace(activeSymbol)) symbolsToSync.Add(activeSymbol);

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
                                ",\"min_stop_pips\":" + MinStopPips.ToString("F2", CultureInfo.InvariantCulture) +
                                ",\"min_stop_price_distance\":" + ((double.IsNaN(s3.PipSize) ? 0 : s3.PipSize) * MinStopPips).ToString("F8", CultureInfo.InvariantCulture) +
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
            try { if (_chartButtonPanel != null) Chart.RemoveControl(_chartButtonPanel); } catch { }
        }

        private void BuildChartButtonPanel()
        {
            try
            {
                _isRebuildingChartPanel = true;
                if (_chartButtonPanel != null)
                {
                    try { Chart.RemoveControl(_chartButtonPanel); } catch { }
                }

                _chartButtonPanel = new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    HorizontalAlignment = HorizontalAlignment.Right,
                    VerticalAlignment = VerticalAlignment.Bottom,
                    Margin = 6,
                    Opacity = 0.85
                };
                _chartSymbolsSignature = "";

                TryAddChartSymbolCombo(_chartButtonPanel);

                var preferredToolbarSymbol = !string.IsNullOrWhiteSpace(_chartSelectedSymbol)
                    ? _chartSelectedSymbol
                    : (Chart != null ? Chart.SymbolName : "");
                var selectedToolbarSymbol = EnsureChartSelectedSymbol(preferredToolbarSymbol);
                var hasSelectedOpenPositions = SymbolHasOpenPositions(selectedToolbarSymbol);

                var refreshButton = BuildChartActionButton("↻", Color.White, Color.DimGray, 28);
                refreshButton.Click += _ =>
                {
                    RefreshChartToSelectedSymbol();
                    RebuildChartButtonPanel();
                    RefreshDebugPanel();
                };
                _chartButtonPanel.AddChild(refreshButton);

                var buyButton = BuildChartActionButton("Buy", Color.White, Color.ForestGreen, 40);
                buyButton.Click += _ => ExecuteChartQuickMarketOrder(TradeType.Buy);
                _chartButtonPanel.AddChild(buyButton);

                var sellButton = BuildChartActionButton("Sell", Color.White, Color.Firebrick, 40);
                sellButton.Click += _ => ExecuteChartQuickMarketOrder(TradeType.Sell);
                _chartButtonPanel.AddChild(sellButton);

                if (hasSelectedOpenPositions)
                {
                    var slMinusButton = BuildChartOutlineButton("SL -", Color.OrangeRed, 42);
                    slMinusButton.Click += _ => ShiftChartProtection(true, true);
                    _chartButtonPanel.AddChild(slMinusButton);

                    var slPlusButton = BuildChartOutlineButton("SL +", Color.SaddleBrown, 42);
                    slPlusButton.Click += _ => ShiftChartProtection(true, false);
                    _chartButtonPanel.AddChild(slPlusButton);

                    var tpMinusButton = BuildChartOutlineButton("TP -", Color.DeepSkyBlue, 42);
                    tpMinusButton.Click += _ => ShiftChartProtection(false, true);
                    _chartButtonPanel.AddChild(tpMinusButton);

                    var tpPlusButton = BuildChartOutlineButton("TP +", Color.MidnightBlue, 42);
                    tpPlusButton.Click += _ => ShiftChartProtection(false, false);
                    _chartButtonPanel.AddChild(tpPlusButton);

                    var beButton = BuildChartOutlineButton("BE", Color.Khaki, 34);
                    beButton.Click += _ => MoveChartPositionsToBreakEven();
                    _chartButtonPanel.AddChild(beButton);

                    var trailButton = BuildChartOutlineButton("Trail", Color.Teal, 42);
                    trailButton.Click += _ => ApplyChartTrailingStep();
                    _chartButtonPanel.AddChild(trailButton);

                    var syncButton = BuildChartOutlineButton("Sync", Color.SteelBlue, 40);
                    syncButton.Click += _ => SyncChartSymbolProtection();
                    _chartButtonPanel.AddChild(syncButton);

                    var closeHalfButton = BuildChartOutlineButton("C50", Color.Goldenrod, 38);
                    closeHalfButton.Click += _ => CloseChartSymbolPositions(50);
                    _chartButtonPanel.AddChild(closeHalfButton);

                    var closeAllButton = BuildChartOutlineButton("Close", Color.DarkRed, 46);
                    closeAllButton.Click += _ => CloseChartSymbolPositions(100);
                    _chartButtonPanel.AddChild(closeAllButton);

                    var cancelOrdersButton = BuildChartOutlineButton("COrd", Color.IndianRed, 44);
                    cancelOrdersButton.Click += _ => CancelChartSymbolPendingOrders();
                    _chartButtonPanel.AddChild(cancelOrdersButton);
                }

                Chart.AddControl(_chartButtonPanel);
                RefreshChartSymbolSelector();
            }
            catch (Exception ex)
            {
                SafePrint("[Panel] Button panel failed: {0}", ex.Message);
            }
            finally
            {
                _isRebuildingChartPanel = false;
            }
        }

        private void RebuildChartButtonPanel()
        {
            try
            {
                BuildChartButtonPanel();
            }
            catch (Exception ex)
            {
                SafePrint("[Panel] Rebuild failed: {0}", ex.Message);
            }
        }

        private void RefreshChartToSelectedSymbol()
        {
            try
            {
                var symbolName = ReadChartSymbolComboSelection();
                if (string.IsNullOrWhiteSpace(symbolName)) return;

                var timeFrame = Chart.TimeFrame;
                var changed = Chart.TryChangeTimeFrameAndSymbol(timeFrame, symbolName);
                if (!changed)
                    SafePrint("[Panel] Chart switch skipped for {0}", symbolName);
            }
            catch (Exception ex)
            {
                SafePrint("[Panel] Chart refresh failed: {0}", ex.Message);
            }
        }

        private Button BuildChartActionButton(string text, Color foreground, Color background, int width)
        {
            var button = new Button { Text = text, Margin = 2 };
            TrySetPropertyValue(button, "Width", width);
            TrySetPropertyValue(button, "MinWidth", width);
            TrySetPropertyValue(button, "Height", 22);
            TrySetPropertyValue(button, "FontSize", 9);
            TrySetPropertyValue(button, "BackgroundColor", background);
            TrySetPropertyValue(button, "ForegroundColor", foreground);
            TrySetPropertyValue(button, "TextColor", foreground);
            TrySetPropertyValue(button, "Opacity", 0.92);
            return button;
        }

        private Button BuildChartOutlineButton(string text, Color accent, int width)
        {
            var button = BuildChartActionButton(text, Color.White, Color.DimGray, width);
            TrySetPropertyValue(button, "BorderColor", accent);
            TrySetPropertyValue(button, "BorderThickness", 1);
            return button;
        }

        private List<string> GetChartToolbarSymbols()
        {
            var symbols = Positions != null
                ? Positions
                    .Where(p => p != null && !string.IsNullOrWhiteSpace(p.SymbolName))
                    .Select(p => p.SymbolName.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList()
                : new List<string>();

            var chartSymbolName = Chart != null && !string.IsNullOrWhiteSpace(Chart.SymbolName)
                ? Chart.SymbolName.Trim()
                : "";
            if (!string.IsNullOrWhiteSpace(chartSymbolName) && !symbols.Any(s => string.Equals(s, chartSymbolName, StringComparison.OrdinalIgnoreCase)))
                symbols.Add(chartSymbolName);

            return symbols
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(s => s, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        private bool SymbolHasOpenPositions(string symbolName)
        {
            return Positions != null &&
                !string.IsNullOrWhiteSpace(symbolName) &&
                Positions.Any(p => p != null && string.Equals(p.SymbolName, symbolName, StringComparison.OrdinalIgnoreCase));
        }

        private List<Position> GetChartSelectedPositions(string symbolName)
        {
            return Positions != null
                ? Positions
                    .Where(p => p != null && string.Equals(p.SymbolName, symbolName, StringComparison.OrdinalIgnoreCase))
                    .ToList()
                : new List<Position>();
        }

        private List<PendingOrder> GetChartSelectedPendingOrders(string symbolName)
        {
            return PendingOrders != null
                ? PendingOrders
                    .Where(o => o != null && string.Equals(o.SymbolName, symbolName, StringComparison.OrdinalIgnoreCase))
                    .ToList()
                : new List<PendingOrder>();
        }

        private bool TryGetChartSelectedSymbol(out string symbolName, out Symbol symbol)
        {
            symbolName = ReadChartSymbolComboSelection();
            symbol = null;

            if (string.IsNullOrWhiteSpace(symbolName))
            {
                SafePrint("[ChartTrade] No symbol selected.");
                return false;
            }

            symbol = ResolveLoadedSymbol(symbolName);
            if (symbol == null)
            {
                SafePrint("[ChartTrade] Symbol not loaded: {0}", symbolName);
                return false;
            }

            return true;
        }

        private string EnsureChartSelectedSymbol(string preferred = null)
        {
            var symbols = GetChartToolbarSymbols();
            if (!string.IsNullOrWhiteSpace(preferred))
            {
                var match = symbols.FirstOrDefault(s => string.Equals(s, preferred.Trim(), StringComparison.OrdinalIgnoreCase));
                if (!string.IsNullOrWhiteSpace(match))
                    _chartSelectedSymbol = match;
            }

            if (!string.IsNullOrWhiteSpace(_chartSelectedSymbol))
            {
                var existing = symbols.FirstOrDefault(s => string.Equals(s, _chartSelectedSymbol, StringComparison.OrdinalIgnoreCase));
                if (!string.IsNullOrWhiteSpace(existing))
                {
                    _chartSelectedSymbol = existing;
                    return _chartSelectedSymbol;
                }
            }

            _chartSelectedSymbol = symbols.FirstOrDefault() ?? "";
            return _chartSelectedSymbol;
        }

        private void RefreshChartSymbolSelector()
        {
            try
            {
                var selected = ReadChartSymbolComboSelection();
                var symbols = GetChartToolbarSymbols();
                var signature = string.Join("|", symbols);
                var normalizedSelected = EnsureChartSelectedSymbol(selected);

                if (_chartSymbolCombo == null) return;
                if (signature != _chartSymbolsSignature)
                {
                    var items = TryGetPropertyValue(_chartSymbolCombo, "Items");
                    if (items != null) TryClearCollection(items);

                    foreach (var symbol in symbols)
                    {
                        if (!(items != null && TryAddToCollection(items, symbol)))
                            TryInvokeVoidMethod(_chartSymbolCombo, "AddItem", symbol);
                    }

                    _chartSymbolsSignature = signature;
                }

                TrySetPropertyValue(_chartSymbolCombo, "SelectedItem", normalizedSelected);
                TrySetPropertyValue(_chartSymbolCombo, "SelectedValue", normalizedSelected);
                TrySetPropertyValue(_chartSymbolCombo, "SelectedIndex", symbols.FindIndex(s => string.Equals(s, normalizedSelected, StringComparison.OrdinalIgnoreCase)));
            }
            catch (Exception ex)
            {
                SafePrint("[Panel] Symbol selector refresh failed: {0}", ex.Message);
            }
        }

        private bool TryAddChartSymbolCombo(StackPanel panel)
        {
            try
            {
                _chartSymbolCombo = null;
                var assembly = typeof(StackPanel).Assembly;
                var comboType = assembly.GetType("cAlgo.API.ComboBox") ?? assembly.GetType("cAlgo.API.Controls.ComboBox");
                if (comboType == null) return false;

                var combo = Activator.CreateInstance(comboType);
                TrySetPropertyValue(combo, "Margin", 3);
                TrySetPropertyValue(combo, "Width", 110);
                TrySetPropertyValue(combo, "MinWidth", 110);
                TrySetPropertyValue(combo, "MaxWidth", 140);
                TrySetPropertyValue(combo, "SelectedIndex", 0);

                var changedEvent = comboType.GetEvent("SelectionChanged") ?? comboType.GetEvent("SelectedItemChanged");
                if (changedEvent != null)
                {
                    Action<object> handler = _ =>
                    {
                        var previousSymbol = _chartSelectedSymbol;
                        var selected = ReadChartSymbolComboSelection();
                        if (!string.IsNullOrWhiteSpace(selected))
                            _chartSelectedSymbol = selected;
                        if (!_isRebuildingChartPanel && !string.Equals(previousSymbol, _chartSelectedSymbol, StringComparison.OrdinalIgnoreCase))
                        {
                            RefreshChartToSelectedSymbol();
                            RebuildChartButtonPanel();
                            RefreshDebugPanel();
                        }
                    };
                    try
                    {
                        var del = Delegate.CreateDelegate(changedEvent.EventHandlerType, handler.Target, handler.Method);
                        changedEvent.AddEventHandler(combo, del);
                    }
                    catch
                    {
                    }
                }

                if (!TryInvokeVoidMethod(panel, "AddChild", combo))
                    return false;

                _chartSymbolCombo = combo;
                return true;
            }
            catch (Exception ex)
            {
                SafePrint("[Panel] Symbol combo unavailable: {0}", ex.Message);
                return false;
            }
        }

        private string ReadChartSymbolComboSelection()
        {
            try
            {
                if (_chartSymbolCombo == null) return EnsureChartSelectedSymbol();

                var raw =
                    TryGetPropertyValue(_chartSymbolCombo, "SelectedItem") ??
                    TryGetPropertyValue(_chartSymbolCombo, "SelectedValue") ??
                    TryGetPropertyValue(_chartSymbolCombo, "Text");
                var text = raw != null ? Convert.ToString(raw, CultureInfo.InvariantCulture) : "";
                if (!string.IsNullOrWhiteSpace(text))
                    return EnsureChartSelectedSymbol(text);
            }
            catch
            {
            }
            return EnsureChartSelectedSymbol();
        }

        private double ResolveChartTradeVolume(Symbol symbol, string symbolName)
        {
            if (symbol == null) return 0;

            var referenceVolume = Positions != null
                ? Positions
                    .Where(p => p != null && string.Equals(p.SymbolName, symbolName, StringComparison.OrdinalIgnoreCase) && p.VolumeInUnits > 0)
                    .Select(p => p.VolumeInUnits)
                    .DefaultIfEmpty(symbol.VolumeInUnitsMin)
                    .Min()
                : symbol.VolumeInUnitsMin;

            if (double.IsNaN(referenceVolume) || referenceVolume <= 0)
                referenceVolume = symbol.VolumeInUnitsMin;

            return symbol.NormalizeVolumeInUnits(referenceVolume, RoundingMode.Down);
        }

        private double? FindClosestChartProtectionPrice(string symbolName, TradeType tradeType, bool isStopLoss, double referencePrice)
        {
            if (Positions == null || referencePrice <= 0) return null;

            var candidates = Positions
                .Where(p => p != null && string.Equals(p.SymbolName, symbolName, StringComparison.OrdinalIgnoreCase))
                .Select(p => isStopLoss ? p.StopLoss : p.TakeProfit)
                .Where(v => v.HasValue && v.Value > 0)
                .Select(v => v.Value)
                .Distinct()
                .ToList();

            if (candidates.Count == 0) return null;

            IEnumerable<double> filtered;
            if (tradeType == TradeType.Buy)
                filtered = isStopLoss ? candidates.Where(v => v < referencePrice) : candidates.Where(v => v > referencePrice);
            else
                filtered = isStopLoss ? candidates.Where(v => v > referencePrice) : candidates.Where(v => v < referencePrice);

            var valid = filtered.ToList();
            if (valid.Count == 0) return null;

            return valid.OrderBy(v => Math.Abs(v - referencePrice)).FirstOrDefault();
        }

        private double? FindClosestChartLevel(string symbolName, bool wantBelowReference, double referencePrice)
        {
            if (referencePrice <= 0) return null;

            var candidates = new List<double>();
            if (Positions != null)
            {
                candidates.AddRange(
                    Positions
                        .Where(p => p != null && string.Equals(p.SymbolName, symbolName, StringComparison.OrdinalIgnoreCase))
                        .SelectMany(p => new[] { p.StopLoss, p.TakeProfit })
                        .Where(v => v.HasValue && v.Value > 0)
                        .Select(v => v.Value));
            }

            if (PendingOrders != null)
            {
                candidates.AddRange(
                    PendingOrders
                        .Where(o => o != null && string.Equals(o.SymbolName, symbolName, StringComparison.OrdinalIgnoreCase))
                        .SelectMany(o => new[] { o.StopLoss, o.TakeProfit })
                        .Where(v => v.HasValue && v.Value > 0)
                        .Select(v => v.Value));
            }

            candidates = candidates.Distinct().ToList();

            if (candidates.Count == 0) return null;

            var filtered = wantBelowReference
                ? candidates.Where(v => v < referencePrice).ToList()
                : candidates.Where(v => v > referencePrice).ToList();

            if (filtered.Count == 0) return null;
            return filtered.OrderBy(v => Math.Abs(v - referencePrice)).FirstOrDefault();
        }

        private Tuple<double, double> BuildFallbackChartProtectionPrices(Symbol symbol, TradeType tradeType, double executionPrice)
        {
            if (symbol == null || executionPrice <= 0 || symbol.PipSize <= 0) return null;

            var distancePips = Math.Max(1.0, MinStopPips);
            var distance = distancePips * symbol.PipSize;
            var sl = tradeType == TradeType.Buy
                ? executionPrice - distance
                : executionPrice + distance;
            var tp = tradeType == TradeType.Buy
                ? executionPrice + distance
                : executionPrice - distance;

            return Tuple.Create(
                NormalizePriceToSymbol(symbol, sl),
                NormalizePriceToSymbol(symbol, tp));
        }

        private double ResolveChartFinalRiskMoney()
        {
            var balance = Account != null ? Math.Max(0, Account.Balance) : 0;
            var requestedRiskMoney = balance * (MaxRiskPercent / 100.0);
            var maxRiskFromPct = requestedRiskMoney;
            var finalRiskMoney = requestedRiskMoney;

            if (MaxRiskAmount > 0) finalRiskMoney = finalRiskMoney <= 0 ? MaxRiskAmount : Math.Min(finalRiskMoney, MaxRiskAmount);
            if (maxRiskFromPct > 0) finalRiskMoney = finalRiskMoney <= 0 ? maxRiskFromPct : Math.Min(finalRiskMoney, maxRiskFromPct);

            return Math.Max(0, finalRiskMoney);
        }

        private void ExecuteChartQuickMarketOrder(TradeType tradeType)
        {
            try
            {
                var symbolName = ReadChartSymbolComboSelection();
                if (string.IsNullOrWhiteSpace(symbolName))
                {
                    SafePrint("[ChartTrade] No open-position symbol available for quick trade.");
                    return;
                }

                var symbol = ResolveLoadedSymbol(symbolName);
                if (symbol == null)
                {
                    SafePrint("[ChartTrade] Symbol not loaded: {0}", symbolName);
                    return;
                }

                var action = tradeType == TradeType.Buy ? "BUY" : "SELL";
                var executionPrice = tradeType == TradeType.Buy ? symbol.Ask : symbol.Bid;
                var sl = tradeType == TradeType.Buy
                    ? FindClosestChartLevel(symbolName, true, executionPrice)
                    : FindClosestChartLevel(symbolName, false, executionPrice);
                var tp = tradeType == TradeType.Buy
                    ? FindClosestChartLevel(symbolName, false, executionPrice)
                    : FindClosestChartLevel(symbolName, true, executionPrice);

                if (executionPrice <= 0)
                {
                    SafePrint("[ChartTrade] {0} {1} has no valid execution price.", action, symbolName);
                    return;
                }

                if (!sl.HasValue || !tp.HasValue)
                {
                    var fallback = BuildFallbackChartProtectionPrices(symbol, tradeType, executionPrice);
                    if (fallback != null)
                    {
                        sl = fallback.Item1;
                        tp = fallback.Item2;
                    }
                }

                if (!sl.HasValue || !tp.HasValue)
                {
                    SafePrint("[ChartTrade] {0} {1} could not derive fallback SL/TP.", action, symbolName);
                    return;
                }

                string protectionReason;
                if (!TryValidateProtectionPrices(symbol, action, executionPrice, sl.Value, tp.Value, out protectionReason))
                {
                    SafePrint("[ChartTrade] {0} {1} rejected: {2}", action, symbolName, protectionReason);
                    return;
                }

                var volumeUnits = ResolveChartTradeVolume(symbol, symbolName);
                if (volumeUnits < symbol.VolumeInUnitsMin)
                {
                    SafePrint("[ChartTrade] {0} {1} volume too small: {2}", action, symbolName, volumeUnits);
                    return;
                }

                var finalRiskMoney = ResolveChartFinalRiskMoney();
                string riskReason;
                if (!TryPassRiskFirewall(symbol, action, "market", 0, executionPrice, sl.Value, tp.Value, volumeUnits, finalRiskMoney, finalRiskMoney, out riskReason))
                {
                    SafePrint("[ChartTrade] {0} {1} blocked: {2}", action, symbolName, riskReason);
                    return;
                }

                var slPips = Math.Round(Math.Abs(executionPrice - sl.Value) / symbol.PipSize, 2);
                var tpPips = Math.Round(Math.Abs(tp.Value - executionPrice) / symbol.PipSize, 2);
                var label = MagicNumber.ToString(CultureInfo.InvariantCulture);
                var sid = "chart-" + DateTime.UtcNow.ToString("HHmmss", CultureInfo.InvariantCulture);
                var comment = BuildBrokerComment(sid);
                var result = ExecuteMarketOrder(tradeType, symbol.Name, volumeUnits, label, slPips, tpPips, comment);

                if (!result.IsSuccessful)
                {
                    SafePrint("[ChartTrade] {0} {1} failed: {2}", action, symbolName, result.Error);
                    return;
                }

                if (result.Position != null)
                {
                    var normalizedSl = NormalizePriceToSymbol(symbol, sl.Value);
                    var normalizedTp = NormalizePriceToSymbol(symbol, tp.Value);
                    var modify = ModifyPosition(result.Position, normalizedSl, normalizedTp);
                    if (!modify.IsSuccessful)
                        SafePrint("[ChartTrade] {0} {1} filled but exact SL/TP refine failed: {2}", action, symbolName, modify.Error);
                }

                SafePrint("[ChartTrade] {0} {1} sent with SL={2:F5} TP={3:F5}", action, symbolName, sl.Value, tp.Value);
                RebuildChartButtonPanel();
                RefreshDebugPanel();
            }
            catch (Exception ex)
            {
                SafePrint("[ChartTrade] Failed: {0}", ex.Message);
            }
        }

        private double GetChartProtectionStepPrice(Symbol symbol)
        {
            var pipDistance = symbol != null && symbol.PipSize > 0 ? symbol.PipSize : 0;
            var tickDistance = symbol != null && symbol.TickSize > 0 ? symbol.TickSize : 0;
            var step = Math.Max(pipDistance, tickDistance);
            if (step <= 0) step = 0.0001;
            return step;
        }

        private double BuildSharedProtectionTarget(Symbol symbol, TradeType tradeType, bool isStopLoss, bool moveCloser, double referencePrice, IEnumerable<double> existingLevels)
        {
            var step = GetChartProtectionStepPrice(symbol);
            var minDistance = symbol != null && symbol.PipSize > 0 ? symbol.PipSize * Math.Max(1.0, MinStopPips) : step;
            var levels = existingLevels != null ? existingLevels.Where(v => v > 0).Distinct().ToList() : new List<double>();

            Func<double, bool> validSide;
            Func<IEnumerable<double>, double?> nearestOnSide;
            double fallback;

            if (tradeType == TradeType.Buy && isStopLoss)
            {
                validSide = v => v < referencePrice;
                nearestOnSide = values => values.Where(validSide).OrderByDescending(v => v).Cast<double?>().FirstOrDefault();
                fallback = referencePrice - minDistance;
            }
            else if (tradeType == TradeType.Buy)
            {
                validSide = v => v > referencePrice;
                nearestOnSide = values => values.Where(validSide).OrderBy(v => v).Cast<double?>().FirstOrDefault();
                fallback = referencePrice + minDistance;
            }
            else if (isStopLoss)
            {
                validSide = v => v > referencePrice;
                nearestOnSide = values => values.Where(validSide).OrderBy(v => v).Cast<double?>().FirstOrDefault();
                fallback = referencePrice + minDistance;
            }
            else
            {
                validSide = v => v < referencePrice;
                nearestOnSide = values => values.Where(validSide).OrderByDescending(v => v).Cast<double?>().FirstOrDefault();
                fallback = referencePrice - minDistance;
            }

            var baseLevel = nearestOnSide(levels) ?? fallback;
            double nextTarget;

            if (tradeType == TradeType.Buy && isStopLoss)
                nextTarget = moveCloser ? baseLevel + step : baseLevel - step;
            else if (tradeType == TradeType.Buy)
                nextTarget = moveCloser ? baseLevel - step : baseLevel + step;
            else if (isStopLoss)
                nextTarget = moveCloser ? baseLevel - step : baseLevel + step;
            else
                nextTarget = moveCloser ? baseLevel + step : baseLevel - step;

            if (moveCloser)
            {
                if (tradeType == TradeType.Buy && isStopLoss)
                    nextTarget = Math.Min(nextTarget, referencePrice - (symbol.PipSize * 0.5));
                else if (tradeType == TradeType.Buy)
                    nextTarget = Math.Max(nextTarget, referencePrice + (symbol.PipSize * 0.5));
                else if (isStopLoss)
                    nextTarget = Math.Max(nextTarget, referencePrice + (symbol.PipSize * 0.5));
                else
                    nextTarget = Math.Min(nextTarget, referencePrice - (symbol.PipSize * 0.5));
            }
            else
            {
                if (tradeType == TradeType.Buy && isStopLoss)
                    nextTarget = Math.Min(nextTarget, referencePrice - minDistance);
                else if (tradeType == TradeType.Buy)
                    nextTarget = Math.Max(nextTarget, referencePrice + minDistance);
                else if (isStopLoss)
                    nextTarget = Math.Max(nextTarget, referencePrice + minDistance);
                else
                    nextTarget = Math.Min(nextTarget, referencePrice - minDistance);
            }

            return NormalizePriceToSymbol(symbol, nextTarget);
        }

        private int ApplySharedProtectionTarget(string symbolName, TradeType tradeType, bool isStopLoss, double targetPrice)
        {
            var modifiedCount = 0;
            var targets = Positions
                .Where(p => p != null && string.Equals(p.SymbolName, symbolName, StringComparison.OrdinalIgnoreCase) && p.TradeType == tradeType)
                .ToList();

            foreach (var position in targets)
            {
                var nextSl = isStopLoss ? (double?)targetPrice : position.StopLoss;
                var nextTp = isStopLoss ? position.TakeProfit : (double?)targetPrice;
                var result = ModifyPosition(position, nextSl, nextTp);
                if (result.IsSuccessful) modifiedCount++;
                else SafePrint("[ChartTrade] Modify failed for {0} #{1}: {2}", symbolName, position.Id, result.Error);
            }

            return modifiedCount;
        }

        private int ApplyChartBreakEvenForPositions(IEnumerable<Position> positions)
        {
            var modifiedCount = 0;
            foreach (var pos in positions ?? Enumerable.Empty<Position>())
            {
                var symbol = ResolveLoadedSymbol(pos.SymbolName);
                if (symbol == null || symbol.PipSize <= 0) continue;

                var targetSl = pos.TradeType == TradeType.Buy
                    ? pos.EntryPrice + (BE_Offset * symbol.PipSize)
                    : pos.EntryPrice - (BE_Offset * symbol.PipSize);

                var shouldMove = false;
                if (!pos.StopLoss.HasValue) shouldMove = true;
                else if (pos.TradeType == TradeType.Buy && pos.StopLoss.Value < targetSl - (0.1 * symbol.PipSize)) shouldMove = true;
                else if (pos.TradeType == TradeType.Sell && pos.StopLoss.Value > targetSl + (0.1 * symbol.PipSize)) shouldMove = true;

                if (!shouldMove) continue;

                var result = ModifyPosition(pos, NormalizePriceToSymbol(symbol, targetSl), pos.TakeProfit);
                if (result.IsSuccessful) modifiedCount++;
                else SafePrint("[ChartTrade] BE failed for {0} #{1}: {2}", pos.SymbolName, pos.Id, result.Error);
            }

            return modifiedCount;
        }

        private void MoveChartPositionsToBreakEven()
        {
            try
            {
                string symbolName;
                Symbol symbol;
                if (!TryGetChartSelectedSymbol(out symbolName, out symbol)) return;

                var positions = GetChartSelectedPositions(symbolName);
                if (positions.Count == 0)
                {
                    SafePrint("[ChartTrade] No open positions for {0}", symbolName);
                    return;
                }

                var modifiedCount = ApplyChartBreakEvenForPositions(positions);
                SafePrint("[ChartTrade] BE updated {0} position(s) for {1}", modifiedCount, symbolName);
                RebuildChartButtonPanel();
                RefreshDebugPanel();
            }
            catch (Exception ex)
            {
                SafePrint("[ChartTrade] BE failed: {0}", ex.Message);
            }
        }

        private int ApplyChartTrailingForPositions(IEnumerable<Position> positions)
        {
            var modifiedCount = 0;
            foreach (var pos in positions ?? Enumerable.Empty<Position>())
            {
                var symbol = ResolveLoadedSymbol(pos.SymbolName);
                if (symbol == null || symbol.PipSize <= 0) continue;

                var currentPrice = pos.TradeType == TradeType.Buy ? symbol.Bid : symbol.Ask;
                if (currentPrice <= 0) continue;

                var targetSl = pos.TradeType == TradeType.Buy
                    ? currentPrice - (Trail_Start * symbol.PipSize)
                    : currentPrice + (Trail_Start * symbol.PipSize);

                var shouldMove = false;
                if (!pos.StopLoss.HasValue) shouldMove = true;
                else
                {
                    var currentDiff = pos.TradeType == TradeType.Buy
                        ? (targetSl - pos.StopLoss.Value) / symbol.PipSize
                        : (pos.StopLoss.Value - targetSl) / symbol.PipSize;
                    if (currentDiff >= Math.Max(1, Trail_Step)) shouldMove = true;
                }

                if (!shouldMove) continue;

                var result = ModifyPosition(pos, NormalizePriceToSymbol(symbol, targetSl), pos.TakeProfit);
                if (result.IsSuccessful) modifiedCount++;
                else SafePrint("[ChartTrade] Trail failed for {0} #{1}: {2}", pos.SymbolName, pos.Id, result.Error);
            }

            return modifiedCount;
        }

        private void ApplyChartTrailingStep()
        {
            try
            {
                string symbolName;
                Symbol symbol;
                if (!TryGetChartSelectedSymbol(out symbolName, out symbol)) return;

                var positions = GetChartSelectedPositions(symbolName);
                if (positions.Count == 0)
                {
                    SafePrint("[ChartTrade] No open positions for {0}", symbolName);
                    return;
                }

                var modifiedCount = ApplyChartTrailingForPositions(positions);
                SafePrint("[ChartTrade] Trail updated {0} position(s) for {1}", modifiedCount, symbolName);
                RebuildChartButtonPanel();
                RefreshDebugPanel();
            }
            catch (Exception ex)
            {
                SafePrint("[ChartTrade] Trail failed: {0}", ex.Message);
            }
        }

        private void SyncChartSymbolProtection()
        {
            try
            {
                string symbolName;
                Symbol symbol;
                if (!TryGetChartSelectedSymbol(out symbolName, out symbol)) return;

                var positions = GetChartSelectedPositions(symbolName);
                if (positions.Count == 0)
                {
                    SafePrint("[ChartTrade] No open positions for {0}", symbolName);
                    return;
                }

                var modifiedCount = 0;
                foreach (var tradeType in new[] { TradeType.Buy, TradeType.Sell })
                {
                    var sidePositions = positions.Where(p => p.TradeType == tradeType).ToList();
                    if (sidePositions.Count == 0) continue;

                    var referencePrice = tradeType == TradeType.Buy ? symbol.Bid : symbol.Ask;
                    var sharedSl = FindClosestChartProtectionPrice(symbolName, tradeType, true, referencePrice);
                    var sharedTp = FindClosestChartProtectionPrice(symbolName, tradeType, false, referencePrice);

                    foreach (var pos in sidePositions)
                    {
                        var nextSl = sharedSl.HasValue ? (double?)NormalizePriceToSymbol(symbol, sharedSl.Value) : pos.StopLoss;
                        var nextTp = sharedTp.HasValue ? (double?)NormalizePriceToSymbol(symbol, sharedTp.Value) : pos.TakeProfit;
                        var result = ModifyPosition(pos, nextSl, nextTp);
                        if (result.IsSuccessful) modifiedCount++;
                        else SafePrint("[ChartTrade] Sync failed for {0} #{1}: {2}", symbolName, pos.Id, result.Error);
                    }
                }

                SafePrint("[ChartTrade] Sync updated {0} position(s) for {1}", modifiedCount, symbolName);
                RebuildChartButtonPanel();
                RefreshDebugPanel();
            }
            catch (Exception ex)
            {
                SafePrint("[ChartTrade] Sync failed: {0}", ex.Message);
            }
        }

        private void CloseChartSymbolPositions(double percentToClose)
        {
            try
            {
                string symbolName;
                Symbol symbol;
                if (!TryGetChartSelectedSymbol(out symbolName, out symbol)) return;

                var positions = GetChartSelectedPositions(symbolName);
                if (positions.Count == 0)
                {
                    SafePrint("[ChartTrade] No open positions for {0}", symbolName);
                    return;
                }

                var closedCount = 0;
                foreach (var pos in positions)
                {
                    TradeResult result;
                    if (percentToClose >= 100)
                    {
                        result = ClosePosition(pos);
                    }
                    else
                    {
                        var volumeToClose = pos.VolumeInUnits * (percentToClose / 100.0);
                        volumeToClose = symbol.NormalizeVolumeInUnits(volumeToClose, RoundingMode.Down);
                        if (volumeToClose < symbol.VolumeInUnitsMin) continue;
                        if (volumeToClose > pos.VolumeInUnits) volumeToClose = pos.VolumeInUnits;
                        result = ClosePosition(pos, volumeToClose);
                    }

                    if (result.IsSuccessful) closedCount++;
                    else SafePrint("[ChartTrade] Close failed for {0} #{1}: {2}", symbolName, pos.Id, result.Error);
                }

                SafePrint("[ChartTrade] Closed {0} position(s) for {1}", closedCount, symbolName);
                RebuildChartButtonPanel();
                RefreshDebugPanel();
            }
            catch (Exception ex)
            {
                SafePrint("[ChartTrade] Close failed: {0}", ex.Message);
            }
        }

        private void CancelChartSymbolPendingOrders()
        {
            try
            {
                string symbolName;
                Symbol symbol;
                if (!TryGetChartSelectedSymbol(out symbolName, out symbol)) return;

                var orders = GetChartSelectedPendingOrders(symbolName);
                if (orders.Count == 0)
                {
                    SafePrint("[ChartTrade] No pending orders for {0}", symbolName);
                    return;
                }

                var canceledCount = 0;
                foreach (var order in orders)
                {
                    var result = CancelPendingOrder(order);
                    if (result.IsSuccessful) canceledCount++;
                    else SafePrint("[ChartTrade] Cancel failed for {0} #{1}: {2}", symbolName, order.Id, result.Error);
                }

                SafePrint("[ChartTrade] Canceled {0} pending order(s) for {1}", canceledCount, symbolName);
                RebuildChartButtonPanel();
                RefreshDebugPanel();
            }
            catch (Exception ex)
            {
                SafePrint("[ChartTrade] Cancel failed: {0}", ex.Message);
            }
        }

        private void ShiftChartProtection(bool isStopLoss, bool moveCloser)
        {
            try
            {
                var symbolName = ReadChartSymbolComboSelection();
                if (string.IsNullOrWhiteSpace(symbolName))
                {
                    SafePrint("[ChartTrade] No symbol selected.");
                    return;
                }

                var symbol = ResolveLoadedSymbol(symbolName);
                if (symbol == null)
                {
                    SafePrint("[ChartTrade] Symbol not loaded: {0}", symbolName);
                    return;
                }

                var positions = Positions
                    .Where(p => p != null && string.Equals(p.SymbolName, symbolName, StringComparison.OrdinalIgnoreCase))
                    .ToList();
                if (positions.Count == 0)
                {
                    SafePrint("[ChartTrade] No open positions for {0}", symbolName);
                    return;
                }

                var totalModified = 0;
                foreach (var tradeType in new[] { TradeType.Buy, TradeType.Sell })
                {
                    var sidePositions = positions.Where(p => p.TradeType == tradeType).ToList();
                    if (sidePositions.Count == 0) continue;

                    var referencePrice = tradeType == TradeType.Buy ? symbol.Bid : symbol.Ask;
                    var existingLevels = sidePositions
                        .Select(p => isStopLoss ? p.StopLoss : p.TakeProfit)
                        .Where(v => v.HasValue && v.Value > 0)
                        .Select(v => v.Value)
                        .ToList();

                    var targetPrice = BuildSharedProtectionTarget(symbol, tradeType, isStopLoss, moveCloser, referencePrice, existingLevels);
                    string reason;
                    var action = tradeType == TradeType.Buy ? "BUY" : "SELL";
                    var validationReference = tradeType == TradeType.Buy ? symbol.Bid : symbol.Ask;
                    var existingSl = sidePositions.FirstOrDefault(p => p.StopLoss.HasValue && p.StopLoss.Value > 0)?.StopLoss ?? 0;
                    var existingTp = sidePositions.FirstOrDefault(p => p.TakeProfit.HasValue && p.TakeProfit.Value > 0)?.TakeProfit ?? 0;
                    var checkSl = isStopLoss ? targetPrice : existingSl;
                    var checkTp = isStopLoss ? existingTp : targetPrice;

                    if (!TryValidateProtectionPrices(symbol, action, validationReference, checkSl, checkTp, out reason))
                    {
                        SafePrint("[ChartTrade] {0} {1} {2} rejected: {3}", symbolName, action, isStopLoss ? "SL" : "TP", reason);
                        continue;
                    }

                    totalModified += ApplySharedProtectionTarget(symbolName, tradeType, isStopLoss, targetPrice);
                }

                SafePrint("[ChartTrade] {0} {1} updated {2} position(s) for {3}", isStopLoss ? "SL" : "TP", moveCloser ? "closer" : "farther", totalModified, symbolName);
                RefreshDebugPanel();
            }
            catch (Exception ex)
            {
                SafePrint("[ChartTrade] Protection shift failed: {0}", ex.Message);
            }
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
                    if (pos.TakeProfit.HasValue) { double pips = (pos.TakeProfit.Value - pos.EntryPrice) / s.PipSize; if (pos.TradeType == TradeType.Sell) pips = -pips; tpPnl = EstimatePnlFromPips(s, pips, pos.VolumeInUnits); distTp = Math.Abs(pips); }
                    if (pos.StopLoss.HasValue) { double pips = (pos.StopLoss.Value - pos.EntryPrice) / s.PipSize; if (pos.TradeType == TradeType.Sell) pips = -pips; slPnl = EstimatePnlFromPips(s, pips, pos.VolumeInUnits); distSl = Math.Abs(pips); }
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
                double pnlTp = 0, pnlSl = 0; if (s2 != null) { if (order.TakeProfit.HasValue) { double pp = Math.Abs(order.TargetPrice - order.TakeProfit.Value) / s2.PipSize; pnlTp = EstimatePnlFromPips(s2, pp, order.VolumeInUnits); } if (order.StopLoss.HasValue) { double pp = Math.Abs(order.TargetPrice - order.StopLoss.Value) / s2.PipSize; pnlSl = -EstimatePnlFromPips(s2, pp, order.VolumeInUnits); } }
                ol.Add("{\"sid\":\"" + sid3 + "\",\"comment\":\"" + sid3 + "\",\"ticket\":\"" + order.Id + "\",\"symbol\":\"" + order.SymbolName + "\",\"side\":\"" + order.TradeType.ToString().ToUpper() + "\",\"type\":\"" + order.OrderType.ToString().ToUpper() + "\",\"target_price\":" + order.TargetPrice.ToString("F5", CultureInfo.InvariantCulture) + ",\"entry\":" + order.TargetPrice.ToString("F5", CultureInfo.InvariantCulture) + ",\"sl\":" + (order.StopLoss ?? 0).ToString("F5", CultureInfo.InvariantCulture) + ",\"tp\":" + (order.TakeProfit ?? 0).ToString("F5", CultureInfo.InvariantCulture) + ",\"volume\":" + (double.IsNaN(order.VolumeInUnits) ? 0 : order.VolumeInUnits).ToString("F2", CultureInfo.InvariantCulture) + ",\"lots\":" + (double.IsNaN(lotsVal2) ? 0 : lotsVal2).ToString("F2", CultureInfo.InvariantCulture) + ",\"label\":\"" + order.Label + "\",\"status\":\"PENDING\",\"margin\":0.0,\"pnl_tp\":" + pnlTp.ToString("F2", CultureInfo.InvariantCulture) + ",\"pnl_sl\":" + pnlSl.ToString("F2", CultureInfo.InvariantCulture) + "}");
            }
            // Build closed list
            var cl = new List<string>();
            var hd = History.OrderByDescending(d => d.ClosingTime).ToList();
            var lim = DateTime.UtcNow.AddDays(-2);
            foreach (var deal in hd) { if (deal.ClosingTime < lim) continue; if (_syncedClosedTickets.Contains(deal.PositionId.ToString())) continue; if (cl.Count >= 20) break; var sid2 = ResolveSid(deal.PositionId.ToString(), deal.Comment).Replace("\"", "'"); cl.Add("{\"sid\":\"" + sid2 + "\",\"comment\":\"" + sid2 + "\",\"ticket\":\"" + deal.PositionId + "\",\"symbol\":\"" + deal.SymbolName + "\",\"side\":\"" + deal.TradeType.ToString().ToUpper() + "\",\"volume\":" + (double.IsNaN(deal.VolumeInUnits) ? 0 : deal.VolumeInUnits).ToString("F2", CultureInfo.InvariantCulture) + ",\"pnl\":" + (double.IsNaN(deal.NetProfit) ? 0 : deal.NetProfit).ToString("F2", CultureInfo.InvariantCulture) + ",\"pips\":0.0,\"commission\":" + (double.IsNaN(deal.Commissions) ? 0 : deal.Commissions).ToString("F2", CultureInfo.InvariantCulture) + ",\"swap\":" + (double.IsNaN(deal.Swap) ? 0 : deal.Swap).ToString("F2", CultureInfo.InvariantCulture) + ",\"status\":\"CLOSED\",\"close_reason\":\"MANUAL_CLOSE\",\"closed_at\":\"" + deal.ClosingTime.ToString("O") + "\",\"label\":\"" + deal.Label + "\"}"); }
            // Build metrics
            var ml = new List<string>();
            var ssm = new HashSet<string>();
            foreach (var activeSymbol in GetActiveSymbols())
                if (!string.IsNullOrWhiteSpace(activeSymbol)) ssm.Add(activeSymbol);
            foreach (var sn in ssm.Take(100))
            {
                var s3 = ResolveLoadedSymbol(sn);
                if (s3 == null) continue;
                ml.Add("{\"symbol\":\"" + s3.Name + "\",\"pip_value\":" + (double.IsNaN(s3.PipValue) ? 0 : s3.PipValue).ToString("F5", CultureInfo.InvariantCulture) + ",\"spread\":" + (double.IsNaN(s3.Spread) ? 0 : s3.Spread).ToString("F2", CultureInfo.InvariantCulture) + ",\"min_vol\":" + (double.IsNaN(s3.VolumeInUnitsMin) ? 0 : s3.VolumeInUnitsMin).ToString("F2", CultureInfo.InvariantCulture) + ",\"step_vol\":" + (double.IsNaN(s3.VolumeInUnitsStep) ? 0 : s3.VolumeInUnitsStep).ToString("F2", CultureInfo.InvariantCulture) + ",\"pip_size\":" + (double.IsNaN(s3.PipSize) ? 0 : s3.PipSize).ToString("F8", CultureInfo.InvariantCulture) + ",\"min_stop_pips\":" + MinStopPips.ToString("F2", CultureInfo.InvariantCulture) + ",\"min_stop_price_distance\":" + ((double.IsNaN(s3.PipSize) ? 0 : s3.PipSize) * MinStopPips).ToString("F8", CultureInfo.InvariantCulture) + ",\"digits\":" + s3.Digits + "}");
            }
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
                            string modifyProtectionReason;
                            if (!TryValidateProtectionPrices(symbol, action, pos.EntryPrice, sl, tp, out modifyProtectionReason))
                            {
                                var rejectMsg = "modify_protection_rejected: " + modifyProtectionReason;
                                RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATE_REJECTED", rejectMsg, "error");
                                SafeAck(id, leaseToken, "REJECTED", ticketStr, rejectMsg);
                                return;
                            }
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
                                    replaceRes = PlaceLimitOrder(
                                        ord.TradeType,
                                        symbol.Name,
                                        newVolumeUnits,
                                        nextTargetPrice,
                                        ord.Label,
                                        (RelativeStopLossProtection)null,
                                        (RelativeTakeProfitProtections)null,
                                        ord.ExpirationTime,
                                        replacementBrokerComment
                                    );
                                }
                                else
                                {
                                    replaceRes = PlaceStopOrder(
                                        ord.TradeType,
                                        symbol.Name,
                                        newVolumeUnits,
                                        nextTargetPrice,
                                        ord.Label,
                                        (RelativeStopLossProtection)null,
                                        (RelativeTakeProfitProtections)null,
                                        ord.ExpirationTime,
                                        replacementBrokerComment
                                    );
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
                        double slTicks = Math.Abs(executionPrice - sl) / symbol.TickSize;
                        double riskPerUnit = slTicks * symbol.TickValue;
                        if (riskPerUnit > 0)
                        {
                            volumeUnits = finalRiskMoney / riskPerUnit;
                            volumeUnits = symbol.NormalizeVolumeInUnits(volumeUnits, RoundingMode.Down);
                        }
                        else
                        {
                            var msg = string.Format(
                                CultureInfo.InvariantCulture,
                                "Unable to compute risk per unit for {0}: tick_size={1} tick_value={2}",
                                symbolCode,
                                symbol.TickSize,
                                symbol.TickValue
                            );
                            RecordPollEvent("", id, symbolCode, action, "REJECTED_RISK_MODEL", msg, "error");
                            SafeAck(id, leaseToken, "REJECTED", "", msg);
                            return;
                        }
                    }
                }
                else
                {
                    double explicitLots = ParseDouble(GetJsonValue(json, "lots"));
                    if (explicitLots > 0)
                    {
                        volumeUnits = symbol.QuantityToVolumeInUnits(explicitLots);
                        volumeUnits = symbol.NormalizeVolumeInUnits(volumeUnits, RoundingMode.Down);
                    }
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
                var requestedVolumeUnits = volumeUnits;
                var fittedMarginEstimate = 0.0;
                var fittedMarginBudget = 0.0;
                var fittedMarginNote = "";

                if (executionPrice <= 0)
                {
                    var msg = "Invalid execution price: " + executionPrice;
                    RecordPollEvent("", id, symbolCode, action, "REJECTED_PRICE", msg, "error");
                    SafeAck(id, leaseToken, "REJECTED", "", msg);
                    SafePrint("[Error] Cannot execute {0} {1}: Ask/Bid price is 0. Check connection.", action, symbolCode);
                    return;
                }

                var tradableRejectReason = DetectSymbolTradeAvailabilityReason(symbol);
                if (!string.IsNullOrWhiteSpace(tradableRejectReason))
                {
                    var rejectMsg = tradableRejectReason + " | " + BuildSubmitContext(
                        symbol,
                        action,
                        orderTypeStr,
                        entry,
                        executionPrice,
                        sl,
                        tp,
                        volumeUnits,
                        requestedRiskMoney,
                        finalRiskMoney
                    );
                    SafeLog("ERROR", "[Reject] {0}", rejectMsg);
                    RecordPollEvent("", id, symbolCode, action, "REJECTED_MARKET_STATE", rejectMsg, "error");
                    SafeAck(id, leaseToken, "REJECTED", "", rejectMsg);
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
                                    var cappedRiskVolPct = (Account.Equity * MaxRiskPercent / 100) / (reqPips * symbol.PipValue);
                                    if (cappedRiskVolPct < volumeUnits) newVolume = cappedRiskVolPct;
                                }
                                if (MaxRiskAmount > 0)
                                {
                                    var cappedRiskVolAbs = MaxRiskAmount / (reqPips * symbol.PipValue);
                                    if (cappedRiskVolAbs < newVolume) newVolume = cappedRiskVolAbs;
                                }
                                newVolume = symbol.NormalizeVolumeInUnits(newVolume, RoundingMode.Down);
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

                string protectionRejectReason;
                if (!TryValidateProtectionPrices(symbol, action, executionPrice, sl, tp, out protectionRejectReason))
                {
                    var rejectMsg = string.Format(
                        CultureInfo.InvariantCulture,
                        "HARD_RISK_GATE_REJECTED: {0} | {1}",
                        protectionRejectReason,
                        BuildSubmitContext(
                            symbol,
                            action,
                            orderTypeStr,
                            entry,
                            executionPrice,
                            sl,
                            tp,
                            volumeUnits,
                            requestedRiskMoney,
                            finalRiskMoney
                        )
                    );
                    SafeLog("ERROR", "[Reject] {0}", rejectMsg);
                    RecordPollEvent("", id, symbolCode, action, "REJECTED_PROTECTION_SANITY", rejectMsg, "error");
                    SafeAck(id, leaseToken, "REJECTED", "", rejectMsg);
                    return;
                }

                volumeUnits = symbol.NormalizeVolumeInUnits(volumeUnits, RoundingMode.Down);
                if (volumeUnits < symbol.VolumeInUnitsMin)
                {
                    var rejectMsg = string.Format(
                        CultureInfo.InvariantCulture,
                        "Volume normalized below minimum: {0:F2} < {1:F2}",
                        volumeUnits,
                        symbol.VolumeInUnitsMin
                    );
                    SafeLog("ERROR", "[Reject] {0}", rejectMsg);
                    RecordPollEvent("", id, symbolCode, action, "REJECTED_VOLUME", rejectMsg, "error");
                    SafeAck(id, leaseToken, "REJECTED", "", rejectMsg);
                    return;
                }

                double affordableVolumeUnits;
                if (!TryFitVolumeToFreeMargin(
                    symbol,
                    tradeType,
                    volumeUnits,
                    out affordableVolumeUnits,
                    out fittedMarginEstimate,
                    out fittedMarginBudget,
                    out fittedMarginNote
                ))
                {
                    var rejectMsg = string.Format(
                        CultureInfo.InvariantCulture,
                        "HARD_MARGIN_GATE_REJECTED: {0} | {1}",
                        fittedMarginNote,
                        BuildSubmitContext(
                            symbol,
                            action,
                            orderTypeStr,
                            entry,
                            executionPrice,
                            sl,
                            tp,
                            volumeUnits,
                            requestedRiskMoney,
                            finalRiskMoney
                        )
                    );
                    SafeLog("ERROR", "[Reject] {0}", rejectMsg);
                    RecordPollEvent("", id, symbolCode, action, "REJECTED_NO_MONEY", rejectMsg, "error");
                    SafeAck(id, leaseToken, "REJECTED", "", rejectMsg);
                    return;
                }
                if (affordableVolumeUnits < volumeUnits)
                {
                    SafePrint(
                        "[Adjust] Margin-fit volume reduced from {0:F2} to {1:F2} units for {2} (budget={3:F2}, est={4:F2})",
                        volumeUnits,
                        affordableVolumeUnits,
                        symbolCode,
                        fittedMarginBudget,
                        fittedMarginEstimate
                    );
                    volumeUnits = affordableVolumeUnits;
                }

                if (sl <= 0)
                {
                    var rejectMsg = "HARD_RISK_GATE_REJECTED: missing_stop_loss";
                    SafeLog("ERROR", "[Reject] {0}", rejectMsg);
                    RecordPollEvent("", id, symbolCode, action, "REJECTED_NO_SL", rejectMsg, "error");
                    SafeAck(id, leaseToken, "REJECTED", "", rejectMsg);
                    return;
                }

                string riskFirewallReason;
                if (!TryPassRiskFirewall(
                    symbol,
                    action,
                    orderTypeStr,
                    entry,
                    executionPrice,
                    sl,
                    tp,
                    volumeUnits,
                    requestedRiskMoney,
                    finalRiskMoney,
                    out riskFirewallReason
                ))
                {
                    var rejectMsg = string.Format(
                        CultureInfo.InvariantCulture,
                        "HARD_RISK_GATE_REJECTED:{0} | {1}",
                        riskFirewallReason,
                        BuildSubmitContext(
                            symbol,
                            action,
                            orderTypeStr,
                            entry,
                            executionPrice,
                            sl,
                            tp,
                            volumeUnits,
                            requestedRiskMoney,
                            finalRiskMoney
                        )
                    );
                    SafeLog("ERROR", "[Reject] {0}", rejectMsg);
                    RecordPollEvent("", id, symbolCode, action, "REJECTED_RISK_FIREWALL", rejectMsg, "error");
                    SafeAck(id, leaseToken, "REJECTED", "", rejectMsg);
                    return;
                }

                double submitReferencePrice = (orderTypeStr == "market" || entry <= 0) ? executionPrice : entry;
                double? submitSlPips = null;
                double? submitTpPips = null;
                if (symbol.PipSize > 0)
                {
                    if (sl > 0)
                    {
                        submitSlPips = Math.Round(Math.Abs(submitReferencePrice - sl) / symbol.PipSize, 2);
                    }
                    if (tp > 0)
                    {
                        submitTpPips = Math.Round(Math.Abs(tp - submitReferencePrice) / symbol.PipSize, 2);
                    }
                }

                if (!submitSlPips.HasValue || submitSlPips.Value <= 0)
                {
                    var rejectMsg = string.Format(
                        CultureInfo.InvariantCulture,
                        "HARD_RISK_GATE_REJECTED: invalid_stop_distance E={0:F5} SL={1:F5}",
                        submitReferencePrice,
                        sl
                    );
                    SafeLog("ERROR", "[Reject] {0}", rejectMsg);
                    RecordPollEvent("", id, symbolCode, action, "REJECTED_NO_SL", rejectMsg, "error");
                    SafeAck(id, leaseToken, "REJECTED", "", rejectMsg);
                    return;
                }

                // Submit with protective SL/TP attached so the max-risk gate is enforced
                // at order creation time, then optionally refine to exact absolute prices after fill.
                if (orderTypeStr == "limit")
                {
                    res = PlaceLimitOrder(tradeType, symbol.Name, volumeUnits, entry, label, submitSlPips, submitTpPips, null, brokerComment);
                }
                else if (orderTypeStr == "stop")
                {
                    res = PlaceStopOrder(tradeType, symbol.Name, volumeUnits, entry, label, submitSlPips, submitTpPips, null, brokerComment);
                }
                else
                {
                    res = ExecuteMarketOrder(tradeType, symbol.Name, volumeUnits, label, submitSlPips, submitTpPips, brokerComment);
                }

                if (
                    (res == null || !res.IsSuccessful) &&
                    res != null &&
                    res.Error == ErrorCode.NoMoney &&
                    volumeUnits > symbol.VolumeInUnitsMin
                )
                {
                    var retryInputVolume = Math.Max(symbol.VolumeInUnitsMin, volumeUnits - Math.Max(symbol.VolumeInUnitsStep, 1));
                    double retryVolumeUnits;
                    double retryMarginEstimate;
                    double retryMarginBudget;
                    string retryMarginNote;
                    if (
                        TryFitVolumeToFreeMargin(
                            symbol,
                            tradeType,
                            retryInputVolume,
                            out retryVolumeUnits,
                            out retryMarginEstimate,
                            out retryMarginBudget,
                            out retryMarginNote
                        ) &&
                        retryVolumeUnits > 0 &&
                        retryVolumeUnits < volumeUnits
                    )
                    {
                        SafePrint(
                            "[Retry] Broker returned NoMoney. Retrying {0} {1} with reduced volume {2:F2} -> {3:F2} units ({4})",
                            action,
                            symbolCode,
                            volumeUnits,
                            retryVolumeUnits,
                            retryMarginNote
                        );
                        volumeUnits = retryVolumeUnits;
                        if (orderTypeStr == "limit")
                        {
                            res = PlaceLimitOrder(tradeType, symbol.Name, volumeUnits, entry, label, submitSlPips, submitTpPips, null, brokerComment);
                        }
                        else if (orderTypeStr == "stop")
                        {
                            res = PlaceStopOrder(tradeType, symbol.Name, volumeUnits, entry, label, submitSlPips, submitTpPips, null, brokerComment);
                        }
                        else
                        {
                            res = ExecuteMarketOrder(tradeType, symbol.Name, volumeUnits, label, submitSlPips, submitTpPips, brokerComment);
                        }
                    }
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
                            var needsSl = sl > 0;
                            var needsTp = tp > 0;
                            var normalizedSl = needsSl ? NormalizePriceToSymbol(symbol, sl) : 0;
                            var normalizedTp = needsTp ? NormalizePriceToSymbol(symbol, tp) : 0;
                            string postFillProtectionReason;
                            if (!TryValidateProtectionPrices(symbol, action, res.Position.EntryPrice, normalizedSl, normalizedTp, out postFillProtectionReason))
                            {
                                var rejectMsg = "post_fill_protection_rejected: " + postFillProtectionReason;
                                SafePrint("[FATAL] {0} for {1} #{2}. Closing position.", rejectMsg, symbolCode, ticket);
                                var closeRes = ClosePosition(res.Position);
                                if (closeRes.IsSuccessful)
                                    SafePrint("[FATAL] Position closed after protection sanity failure for {0} #{1}", symbolCode, ticket);
                                else
                                    SafePrint("[CRITICAL] Close also failed for {0} #{1}: {2} - POSITION UNPROTECTED!", symbolCode, ticket, closeRes.Error);
                                RecordPollEvent(ticket, id, symbolCode, action, "CANCELLED_POSITION", rejectMsg, "closed");
                                SafeAck(id, leaseToken, "FAIL", ticket, rejectMsg);
                                return;
                            }

                            var currentSl = res.Position.StopLoss;
                            var currentTp = res.Position.TakeProfit;
                            var slCloseEnough = !needsSl || (currentSl.HasValue && Math.Abs(currentSl.Value - normalizedSl) <= symbol.PipSize * 0.5);
                            var tpCloseEnough = !needsTp || (currentTp.HasValue && Math.Abs(currentTp.Value - normalizedTp) <= symbol.PipSize * 0.5);

                            if (HasRequiredProtection(res.Position, needsSl, needsTp) && slCloseEnough && tpCloseEnough)
                            {
                                SafePrint("[Order] Broker-attached protection accepted SL={0} TP={1} for {2} #{3}", currentSl, currentTp, symbolCode, ticket);
                            }
                            else
                            {
                                var mRes = ModifyPosition(res.Position, (needsSl ? (double?)normalizedSl : (double?)null), (needsTp ? (double?)normalizedTp : (double?)null));
                                if (mRes.IsSuccessful)
                                {
                                    SafePrint("[Order] SL/TP set SL={0} TP={1} for {2} #{3}", normalizedSl, normalizedTp, symbolCode, ticket);
                                }
                                else
                                {
                                    var protectedAfterSubmit = HasRequiredProtection(res.Position, needsSl, needsTp);
                                    if (protectedAfterSubmit)
                                    {
                                        SafePrint(
                                            "[WARN] Exact SL/TP refinement failed but broker protection exists. Requested SL={0} TP={1}; current SL={2} TP={3}; error={4}",
                                            normalizedSl,
                                            normalizedTp,
                                            res.Position.StopLoss,
                                            res.Position.TakeProfit,
                                            mRes.Error
                                        );
                                        RecordPollEvent(ticket, id, symbolCode, action, "PROTECTED_POSITION", "exact_sl_tp_refine_failed", "open");
                                    }
                                    else
                                    {
                                        var errDetail = string.Format("SL/TP rejected: {0} (SL={1} TP={2})", mRes.Error, normalizedSl, normalizedTp);
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
                                            SafePrint("[WARN] SL/TP rejected but continuing: {0} for {1} #{2}", errDetail, symbolCode, ticket);
                                            var status = orderTypeStr == "limit" || orderTypeStr == "stop" ? "PLACED" : "START";
                                            SafeAck(id, leaseToken, status, ticket, "sl_tp_rejected: " + errDetail);
                                        }
                                    }
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
                        var brokerError = res != null ? Convert.ToString(res.Error, CultureInfo.InvariantCulture) : "unknown";
                        var failureDetail = string.Format(
                            CultureInfo.InvariantCulture,
                            "BROKER_SUBMIT_FAILED:{0} | requested_volume_units={1:F2}; submitted_volume_units={2:F2}; margin_note={3} | {4}",
                            brokerError,
                            requestedVolumeUnits,
                            volumeUnits,
                            string.IsNullOrWhiteSpace(fittedMarginNote) ? "-" : fittedMarginNote,
                            BuildSubmitContext(
                                symbol,
                                action,
                                orderTypeStr,
                                entry,
                                executionPrice,
                                sl,
                                tp,
                                volumeUnits,
                                requestedRiskMoney,
                                finalRiskMoney
                            )
                        );
                        RecordPollEvent("", id, symbolCode, action, "CREATE_FAILED", failureDetail, "error");
                        SafeLog("ERROR", "[CreateFailed] {0} :: {1}", id, failureDetail);
                        SafeAck(id, leaseToken, "REJECTED", "", failureDetail);
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
                RefreshChartSymbolSelector();
                Chart.RemoveObject("Panel_HEARTBEAT");
                Chart.RemoveObject("Panel_TR");
                Chart.RemoveObject("Panel_GATE");
                Chart.RemoveObject("Panel_DBG");
                Chart.RemoveObject("Panel_DBG");
                Chart.RemoveObject("Panel_DBG_HDR");
                Chart.RemoveObject("Panel_DBG_BODY");
                Chart.RemoveObject("Panel_DBG_MSG");
                Chart.RemoveObject("Panel_GATE_HDR");
                Chart.RemoveObject("Panel_GATE_BODY");
                Chart.RemoveObject("Panel_GATE_WIN");
                Chart.RemoveObject("Panel_GATE_LOSE");
                var riskState = BuildRiskGateState(0);
                var pollTimeStr = _lastPollTime == DateTime.MinValue ? "WAITING..." : _lastPollTime.ToString("HH:mm:ss");
                var pollHasHardError =
                    _serverStatus == "OFFLINE" ||
                    _apiStatus == "UNREACHABLE" ||
                    ((_pollStatus == "ERROR" || _pollStatus == "FAIL") && _pollConsecutiveFailures >= 2) ||
                    _lastPollErr != "None";

                var syncTimeStr = _lastSyncTime == DateTime.MinValue ? "WAITING..." : _lastSyncTime.ToString("HH:mm:ss");
                var syncHasHardError =
                    _serverStatus == "OFFLINE" ||
                    _apiStatus == "UNREACHABLE" ||
                    (((_syncStatus == "ERROR") || _syncStatus.StartsWith("FAIL", StringComparison.OrdinalIgnoreCase)) && _syncConsecutiveFailures >= 2) ||
                    _lastSyncErr != "None";

                Chart.RemoveObject("Panel_TL");
                Chart.RemoveObject("Panel_BL");
                Chart.RemoveObject("Panel_BR");

                Func<string, string> compactStatus = status =>
                {
                    if (string.IsNullOrWhiteSpace(status)) return "?";
                    var s = status.Trim().ToUpperInvariant();
                    if (s == "WAITING") return "WAIT";
                    if (s == "POLLING") return "POLL";
                    if (s == "SYNCING") return "SYNC";
                    if (s == "UNREACHABLE") return "DOWN";
                    if (s.StartsWith("FAIL", StringComparison.Ordinal)) return "FAIL";
                    return s;
                };

                var panelHeader = string.Format("v{0} {1}",
                    BuildVersion,
                    DateTime.Now.ToString("HH:mm:ss"));
                var panelBody = new StringBuilder();
                if (_showProcessDebugPanel)
                {
                    const int procMetricWidth = 5;
                    const int procStatusWidth = 4;
                    const int procTimeWidth = 8;
                    const int procMsWidth = 5;
                    const int procFailWidth = 2;
                    const int procCountWidth = 4;
                    const int procWideWidth = 4;
                    var procRule = new string('-', procMetricWidth + procStatusWidth + procTimeWidth + procMsWidth + procFailWidth + (procCountWidth * 6) + 27);
                    panelBody.AppendLine(BuildTextTableRow(
                        PadCell("PROC", procMetricWidth),
                        PadCell("ST", procStatusWidth),
                        PadCell("TIME", procTimeWidth),
                        PadCell("LAT", procMsWidth, true),
                        PadCell("F", procFailWidth, true),
                        PadCell("DO", procCountWidth, true),
                        PadCell("SKIP", procCountWidth, true),
                        PadCell("CHG", procCountWidth, true),
                        PadCell("NEW", procCountWidth, true),
                        PadCell("TRK", procWideWidth, true),
                        PadCell("SYM", procWideWidth, true)));
                    panelBody.AppendLine(procRule);
                    panelBody.AppendLine(BuildTextTableRow(
                        PadCell("PULL", procMetricWidth),
                        PadCell(compactStatus(_pollStatus), procStatusWidth),
                        PadCell(pollTimeStr, procTimeWidth),
                        PadCell((_lastPollLatencyMs >= 0 ? _lastPollLatencyMs.ToString(CultureInfo.InvariantCulture) : "-") + "ms", procMsWidth, true),
                        PadCell(_pollConsecutiveFailures.ToString(CultureInfo.InvariantCulture), procFailWidth, true),
                        PadCell(_lastPullServerTradeCount.ToString(CultureInfo.InvariantCulture), procCountWidth, true),
                        PadCell(_lastPollSummary.Unchanged.ToString(CultureInfo.InvariantCulture), procCountWidth, true),
                        PadCell(_lastPollSummary.Changed.ToString(CultureInfo.InvariantCulture), procCountWidth, true),
                        PadCell(_lastPollSummary.Created.ToString(CultureInfo.InvariantCulture), procCountWidth, true),
                        PadCell(_lastPullServerSymbolCount.ToString(CultureInfo.InvariantCulture), procWideWidth, true),
                        PadCell(_lastPullServerStrategyCount.ToString(CultureInfo.InvariantCulture), procWideWidth, true)));
                    panelBody.AppendLine(BuildTextTableRow(
                        PadCell("SYNC", procMetricWidth),
                        PadCell(compactStatus(_syncStatus), procStatusWidth),
                        PadCell(syncTimeStr, procTimeWidth),
                        PadCell((_lastSyncLatencyMs >= 0 ? _lastSyncLatencyMs.ToString(CultureInfo.InvariantCulture) : "-") + "ms", procMsWidth, true),
                        PadCell(_syncConsecutiveFailures.ToString(CultureInfo.InvariantCulture), procFailWidth, true),
                        PadCell((_lastPushPositionCount + _lastPushOrderCount + _lastPushClosedCount).ToString(CultureInfo.InvariantCulture), procCountWidth, true),
                        PadCell(_lastSyncSummary.Unchanged.ToString(CultureInfo.InvariantCulture), procCountWidth, true),
                        PadCell(_lastSyncSummary.Changed.ToString(CultureInfo.InvariantCulture), procCountWidth, true),
                        PadCell(_lastSyncSummary.Created.ToString(CultureInfo.InvariantCulture), procCountWidth, true),
                        PadCell(_lastPushOrderCount.ToString(CultureInfo.InvariantCulture), procWideWidth, true),
                        PadCell(_lastPushSymbolCount.ToString(CultureInfo.InvariantCulture), procWideWidth, true)));
                }

                if (_consecutiveErrors > 0 || _lastPollErr != "None" || _lastSyncErr != "None")
                {
                    var err = _lastSyncErr != "None" ? _lastSyncErr : _lastPollErr;
                    if (string.IsNullOrWhiteSpace(err) || err == "None")
                        panelBody.AppendLine(string.Format("E {0}", _consecutiveErrors));
                    else
                        AppendWrappedPanelLine(panelBody, "E ", err, 72, 1);
                }

                var procBodyText = panelBody.ToString().TrimEnd('\r', '\n');
                var leftPanel = new StringBuilder();
                leftPanel.AppendLine(panelHeader);
                leftPanel.AppendLine(string.Format(
                    CultureInfo.InvariantCulture,
                    "Server: {0}   API: {1}",
                    compactStatus(_serverStatus),
                    compactStatus(_apiStatus)));
                if (!string.IsNullOrWhiteSpace(procBodyText))
                    leftPanel.AppendLine(procBodyText);
                leftPanel.Append("MSG " + (_lastPanelMessage ?? "Ready"));
                var debugPanelColor =
                    (_serverStatus == "OFFLINE" ||
                     _serverStatus == "CLIENT_ERR" ||
                     _apiStatus == "UNREACHABLE" ||
                     _apiStatus == "PREP_ERR" ||
                     _pollStatus == "FAIL" ||
                     _pollStatus == "ERROR" ||
                     _syncStatus == "FAIL" ||
                     _syncStatus == "ERROR")
                        ? Color.Red
                        : Color.White;
                var debugPanel = Chart.DrawStaticText("Panel_DBG", leftPanel.ToString(), VerticalAlignment.Top, HorizontalAlignment.Left, debugPanelColor);
                TryStyleChartText(debugPanel, 10, "Courier New", false);

                var gateHeader = BuildTextTableRow(
                    PadCell("Metric", 12),
                    PadCell("CUR", 16, true),
                    PadCell("LIM", 16, true));
                var gateBody = new StringBuilder();
                const int metricWidth = 12;
                const int currentWidth = 16;
                const int limitWidth = 16;
                var tableWidth = metricWidth + currentWidth + limitWidth + 8;
                var rule = new string('-', tableWidth);
                var gateWinRow = "";
                var gateLoseRow = "";

                if (_showRiskGatePanel)
                {
                    gateWinRow = BuildTextTableRow(
                        PadCell("Win", metricWidth),
                        PadCell(FormatDashboardNumber(riskState.CurrentWinAmount), currentWidth, true),
                        PadCell(FormatDashboardNumber(riskState.PossibleWinAmount), limitWidth, true));
                    gateLoseRow = BuildTextTableRow(
                        PadCell("Lose", metricWidth),
                        PadCell(FormatDashboardNumber(riskState.CurrentLoseAmount), currentWidth, true),
                        PadCell(FormatDashboardNumber(riskState.PossibleLoseAmount), limitWidth, true));
                    gateBody.AppendLine(BuildTextTableRow(
                        PadCell("", metricWidth),
                        PadCell("", currentWidth, true),
                        PadCell("", limitWidth, true)));
                    gateBody.AppendLine(BuildTextTableRow(
                        PadCell("", metricWidth),
                        PadCell("", currentWidth, true),
                        PadCell("", limitWidth, true)));
                    gateBody.AppendLine(BuildTextTableRow(
                        PadCell("Day Loss", metricWidth),
                        PadCell(string.Format(CultureInfo.InvariantCulture, "${0} ({1}%)", FormatDashboardNumber(riskState.DailyLossAmount), FormatDashboardPercent(riskState.DailyLossPercent)), currentWidth, true),
                        PadCell(string.Format(CultureInfo.InvariantCulture, "${0} ({1}%)", MaxDailyLossAmount > 0 ? FormatDashboardNumber(MaxDailyLossAmount) : "-", MaxDailyLossPercent > 0 ? FormatDashboardPercent(MaxDailyLossPercent) : "-"), limitWidth, true)));
                    gateBody.AppendLine(BuildTextTableRow(
                        PadCell("Open Pos", metricWidth),
                        PadCell(riskState.OpenPositionsCount.ToString(CultureInfo.InvariantCulture), currentWidth, true),
                        PadCell(HardMaxOpenPositions > 0 ? HardMaxOpenPositions.ToString(CultureInfo.InvariantCulture) : "-", limitWidth, true)));
                    gateBody.AppendLine(BuildTextTableRow(
                        PadCell("Pend Ord", metricWidth),
                        PadCell(riskState.PendingOrdersCount.ToString(CultureInfo.InvariantCulture), currentWidth, true),
                        PadCell(HardMaxPendingOrders > 0 ? HardMaxPendingOrders.ToString(CultureInfo.InvariantCulture) : "-", limitWidth, true)));
                    gateBody.AppendLine(BuildTextTableRow(
                        PadCell("Used Margin", metricWidth),
                        PadCell(FormatDashboardNumber(riskState.UsedMarginAmount), currentWidth, true),
                        PadCell("-", limitWidth, true)));
                    gateBody.AppendLine(BuildTextTableRow(
                        PadCell("Open Risk", metricWidth),
                        PadCell(string.Format(CultureInfo.InvariantCulture, "${0} ({1}%)", FormatDashboardNumber(riskState.ExistingOpenRiskAmount), FormatDashboardPercent(riskState.TotalOpenRiskPercent)), currentWidth, true),
                        PadCell(string.Format(CultureInfo.InvariantCulture, "${0} ({1}%)", MaxTotalOpenRiskAmount > 0 ? FormatDashboardNumber(MaxTotalOpenRiskAmount) : "-", MaxTotalOpenRiskPercent > 0 ? FormatDashboardPercent(MaxTotalOpenRiskPercent) : "-"), limitWidth, true)));
                    gateBody.AppendLine(BuildTextTableRow(
                        PadCell("Drawdown", metricWidth),
                        PadCell(string.Format(CultureInfo.InvariantCulture, "${0} ({1}%)", FormatDashboardNumber(riskState.EquityDrawdownAmount), FormatDashboardPercent(riskState.EquityDrawdownPercent)), currentWidth, true),
                        PadCell(string.Format(CultureInfo.InvariantCulture, "${0} ({1}%)", MaxEquityDrawdownAmount > 0 ? FormatDashboardNumber(MaxEquityDrawdownAmount) : "-", MaxEquityDrawdownPercent > 0 ? FormatDashboardPercent(MaxEquityDrawdownPercent) : "-"), limitWidth, true)));
                }

                var gateHeaderColor = (pollHasHardError || syncHasHardError) ? Color.Red : Color.Aqua;
                var gateHeaderPanel = Chart.DrawStaticText("Panel_GATE_HDR", gateHeader, VerticalAlignment.Top, HorizontalAlignment.Right, gateHeaderColor);
                TryStyleChartText(gateHeaderPanel, 9, "Courier New", false);

                var gateBodyText = gateBody.ToString().TrimEnd('\r', '\n');
                var gateBodyPanel = Chart.DrawStaticText("Panel_GATE_BODY", BuildOffsetText(1, gateBodyText), VerticalAlignment.Top, HorizontalAlignment.Right, Color.White);
                TryStyleChartText(gateBodyPanel, 9, "Courier New", false);

                var winLineOffset = 1;
                var loseLineOffset = 2;
                var gateWinPanel = Chart.DrawStaticText("Panel_GATE_WIN", BuildOffsetText(winLineOffset, gateWinRow), VerticalAlignment.Top, HorizontalAlignment.Right, Color.LimeGreen);
                TryStyleChartText(gateWinPanel, 9, "Courier New", false);
                var gateLosePanel = Chart.DrawStaticText("Panel_GATE_LOSE", BuildOffsetText(loseLineOffset, gateLoseRow), VerticalAlignment.Top, HorizontalAlignment.Right, Color.Red);
                TryStyleChartText(gateLosePanel, 9, "Courier New", false);
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
