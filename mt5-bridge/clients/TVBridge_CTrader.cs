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

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.FullAccess)]
    public class TVBridgeCBot : Robot
    {
        [Parameter("Server Base URL", DefaultValue = "http://127.0.0.1:3000/webhook")]
        public string ServerBaseUrl { get; set; }

        [Parameter("EA API Key", DefaultValue = "acc_fab38ed32ecde9b28b3dd33d8be10a77da6a")]
        public string EaApiKey { get; set; }

        [Parameter("Master Timer (sec)", Group = "Timer", DefaultValue = 1, MinValue = 1)]
        public int MasterTimerSeconds { get; set; }

        [Parameter("Polling Frequency (sec)", DefaultValue = 2, MinValue = 1)]
        public int PollSeconds { get; set; }

        [Parameter("Magic Number", DefaultValue = 20260411)]
        public int MagicNumber { get; set; }

        [Parameter("Provider Code", DefaultValue = "ICMARKETS")]
        public string ProviderCode { get; set; }

        [Parameter("Max Risk ($)", DefaultValue = 100)]
        public double MaxRiskAmount { get; set; }

        [Parameter("Max Risk (%)", DefaultValue = 1.0)]
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

        [Parameter("Min Stop Distance (pips)", Group = "Safety", DefaultValue = 15, MinValue = 5)]
        public double MinStopPips { get; set; }

        [Parameter("On SL/TP Error", Group = "Safety", DefaultValue = "Adjust")]
        public string OnSlTpError { get; set; }  // "Reject" = cancel trade, "Adjust" = auto-widen to meet minimum, "Continue" = keep position without SL/TP

        [Parameter("Log Filter", Group = "Logging", DefaultValue = "Error,Reject")]
        public string LogFilter { get; set; }

        private const string BuildVersion = "v2026.05.30 18:45 - master-timer";

        private string _serverStatus = "WAITING";
        private string _apiStatus = "WAITING";
        private string _pollStatus = "IDLE";
        private string _syncStatus = "IDLE";
        private string _priceStatus = "IDLE";

        private string _lastPollErr = "None";
        private string _lastSyncErr = "None";
        private string _lastPriceErr = "None";

        private DateTime _lastPollTime = DateTime.MinValue;
        private DateTime _lastSyncTime = DateTime.MinValue;
        private DateTime _lastPriceTime = DateTime.MinValue;

        private int _pollCount = 0;
        private int _successPolls = 0;
        private int _syncCount = 0;
        private int _priceCount = 0;
        private int _consecutiveErrors = 0;
        private DateTime _lastErrorClearTime = DateTime.Now;
        private DateTime _lastTimerTickSeen = DateTime.MinValue;
        private DateTime _lastTickFallbackKick = DateTime.MinValue;

        // REGISTRY: Tracks all processed signals to prevent duplicates
        private HashSet<string> _processedSignalIds = new HashSet<string>();
        private HashSet<string> _processedLeases = new HashSet<string>(); // sid:lease_token
        private List<string> _signalHistory = new List<string>();
        private List<string> _lastSyncResults = new List<string>();
        private HashSet<string> _syncedClosedTickets = new HashSet<string>();

        private class PartialTP
        {
            public double Price;
            public double SizePct;
        }
        private Dictionary<string, List<PartialTP>> _tradePartials = new Dictionary<string, List<PartialTP>>();
        private HashSet<string> _executedPartials = new HashSet<string>(); // key: ticket_partialIdx
        private Dictionary<string, double> _partialClosedVolumes = new Dictionary<string, double>(); // ticket -> total closed volume from partials
        private Dictionary<string, string> _ticketSidMap = new Dictionary<string, string>(); // ticket -> sid backfill for empty comments

        private List<string> _trackedSymbols = new List<string>(); // price push symbol list
        private DateTime _lastTrackedFetch = DateTime.MinValue;

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


        private HttpClient _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
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
        private bool _busyTracked = false;

        private CancellationTokenSource _watchdogCts;

        private string ResolveSid(string ticket, string commentSid)
        {
            var sid = string.IsNullOrWhiteSpace(commentSid) ? "" : commentSid.Trim();
            if (!string.IsNullOrEmpty(sid)) return sid;
            var key = string.IsNullOrWhiteSpace(ticket) ? "" : ticket.Trim();
            if (string.IsNullOrEmpty(key)) return "";
            string mapped;
            if (_ticketSidMap.TryGetValue(key, out mapped) && !string.IsNullOrWhiteSpace(mapped))
                return mapped.Trim();
            return "";
        }

        private bool TryResolveBrokerSymbol(string rawSymbol, out string symbolName)
        {
            symbolName = "";
            var sym = string.IsNullOrWhiteSpace(rawSymbol) ? "" : rawSymbol.Trim();
            if (string.IsNullOrEmpty(sym)) return false;

            try
            {
                var direct = Symbols.GetSymbol(sym);
                if (direct != null)
                {
                    symbolName = direct.Name;
                    return true;
                }

                var compact = sym.Replace("/", "").Replace("-", "").Replace("_", "");
                if (compact.Length == 6)
                {
                    var slashName = compact.Substring(0, 3) + "/" + compact.Substring(3, 3);
                    var slash = Symbols.GetSymbol(slashName);
                    if (slash != null)
                    {
                        symbolName = slash.Name;
                        return true;
                    }
                }
            }
            catch { }

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
            _httpClient.Timeout = TimeSpan.FromSeconds(30);
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

                var symbol = Symbols.GetSymbol(pos.SymbolName);
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
            // Dispatch all cTrader API calls to main thread
            BeginInvokeOnMainThread(() => MasterTimerTick());
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

            // --- Tracked symbols (startup + every 5 min) ---
            if ((_lastTrackedFetch == DateTime.MinValue || (now - _lastTrackedFetch).TotalMinutes >= 5) && !_busyTracked)
            {
                _busyTracked = true; _lastTrackedFetch = now;
                Task.Run(async () => { try { await FetchTrackedSymbolsAsync(accId); } catch { } finally { _busyTracked = false; } });
            }

            // --- Price push ---
            if (PricePushEnabled && !_busyPrice && (_lastPriceTime == DateTime.MinValue || (now - _lastPriceTime).TotalSeconds >= PricePushSeconds))
            {
                _busyPrice = true; _priceStatus = "PUSHING";
                var syms = GetActiveSymbols();
                if (syms.Count > 0)
                {
                    // Read prices NOW on main thread before dispatching to background
                    var pd = ReadPricesOnMainThread(syms);
                    if (pd.Count > 0)
                    {
                        Task.Run(async () =>
                        {
                            try { await PushPricesAsync(accId, pd); }
                            catch (Exception ex) { _lastPriceErr = ex.Message; _priceStatus = "ERROR"; }
                            finally { _lastPriceTime = DateTime.Now; _busyPrice = false; }
                        });
                    }
                    else { _priceStatus = "IDLE"; _lastPriceTime = now; _busyPrice = false; }
                }
                else { _priceStatus = "IDLE"; _lastPriceTime = now; _busyPrice = false; }
            }

            // --- Bar push ---
            if (BarPushEnabled && !_busyBars && (_lastBarTime == DateTime.MinValue || (now - _lastBarTime).TotalSeconds >= BarPushSeconds))
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
            if (EnableIncrementalBars && !_busyIncSync && (_lastIncrementalSync == DateTime.MinValue || (now - _lastIncrementalSync).TotalSeconds >= IncrementalBarsSeconds))
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

            // --- Poll (every tick, non-blocking) ---
            if (!_busyPull)
            {
                _busyPull = true; _pollStatus = "POLLING"; _pollCount++;
                Task.Run(async () => { try { await PollSignalsAsync(accId); } catch { } finally { _busyPull = false; } });
            }

            // --- Sync (if interval elapsed, not busy) ---
            bool doSync = _lastSyncTime == DateTime.MinValue || (now - _lastSyncTime).TotalSeconds >= SyncIntervalSeconds;
            if (doSync && !_busySync)
            {
                _busySync = true; _syncStatus = "SYNCING";
                _syncOnly = true;
                DoTimerWork();
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
                    var s = Symbols.GetSymbol(sym);
                    if (s == null) continue;
                    double bid = double.IsNaN(s.Bid) ? 0 : s.Bid;
                    double ask = double.IsNaN(s.Ask) ? 0 : s.Ask;
                    if (bid > 0 && ask > 0) result.Add(Tuple.Create(sym, bid, ask));
                }
                catch { }
            }
            return result;
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
                        SafePrint("[Backoff] Delaying poll for {0}s due to {1} consecutive errors", backoffSeconds, _consecutiveErrors);
                        Task.Delay(backoffSeconds * 1000).Wait();
                    }
                }

                var accId = Account.UserId.ToString();

                if (!_syncOnly)
                {
                    // --- Fetch tracked symbols (startup + every 5 min) ---
                    if (_lastTrackedFetch == DateTime.MinValue ||
                        (DateTime.Now - _lastTrackedFetch).TotalMinutes >= 5)
                    {
                        _lastTrackedFetch = DateTime.Now;
                        _ = FetchTrackedSymbolsAsync(accId);
                    }

                    // --- Price push (every PricePushSeconds) ---
                    if (PricePushEnabled)
                    {
                        if (_lastPriceTime == DateTime.MinValue ||
                            (DateTime.Now - _lastPriceTime).TotalSeconds >= PricePushSeconds)
                        {
                            // Read prices on MAIN thread (cTrader API not thread-safe)
                            var priceData = new List<Tuple<string, double, double>>();
                            var syms = _trackedSymbols.Count > 0 ? _trackedSymbols : new List<string>();
                            if (syms.Count == 0)
                            {
                                // Fallback auto-detect
                                foreach (var pos in Positions)
                                    if (!string.IsNullOrWhiteSpace(pos.SymbolName) && !syms.Contains(pos.SymbolName))
                                        syms.Add(pos.SymbolName);
                                foreach (var order in PendingOrders)
                                    if (!string.IsNullOrWhiteSpace(order.SymbolName) && !syms.Contains(order.SymbolName))
                                        syms.Add(order.SymbolName);
                                if (Symbol != null && !string.IsNullOrWhiteSpace(Symbol.Name) && !syms.Contains(Symbol.Name))
                                    syms.Add(Symbol.Name);
                            }
                            foreach (var sym in syms)
                            {
                                try
                                {
                                    var s = Symbols.GetSymbol(sym);
                                    if (s == null) continue;
                                    double bid = double.IsNaN(s.Bid) ? 0 : s.Bid;
                                    double ask = double.IsNaN(s.Ask) ? 0 : s.Ask;
                                    if (bid > 0 && ask > 0)
                                        priceData.Add(Tuple.Create(sym, bid, ask));
                                }
                                catch { }
                            }
                            if (priceData.Count == 0)
                            {
                                _priceStatus = "IDLE"; _lastPriceTime = DateTime.Now;
                            }
                            else
                            {
                                _priceStatus = "PUSHING";
                                var pd = priceData; // capture for closure
                                Task.Run(async () => await PushPricesAsync(accId, pd));
                            }
                        }
                    }

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
                            var s = Symbols.GetSymbol(pos.SymbolName);
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

                        // Build position SID lookup for pending order SID fallback
                        var posSidLookup = new Dictionary<string, string>();
                        foreach (var pos in Positions)
                        {
                            var posSid = ResolveSid(pos.Id.ToString(), pos.Comment);
                            if (!string.IsNullOrEmpty(posSid))
                            {
                                var key = (pos.SymbolName + "_" + pos.TradeType.ToString()).ToUpper();
                                if (!posSidLookup.ContainsKey(key))
                                    posSidLookup[key] = posSid;
                            }
                        }

                        foreach (var order in PendingOrders)
                        {
                            var sid3 = ResolveSid(order.Id.ToString(), order.Comment).Replace("\"", "'");

                            // Fallback: cTrader may recreate order with new OID on modify, losing comment SID
                            if (string.IsNullOrEmpty(sid3))
                            {
                                var lookupKey = (order.SymbolName + "_" + order.TradeType.ToString()).ToUpper();
                                if (posSidLookup.TryGetValue(lookupKey, out var posSid))
                                {
                                    sid3 = posSid;
                                    // Cache new OID -> SID for future syncs
                                    var oidKey = order.Id.ToString();
                                    if (!_ticketSidMap.ContainsKey(oidKey))
                                        _ticketSidMap[oidKey] = posSid;
                                }
                            }
                            var s2 = Symbols.GetSymbol(order.SymbolName);
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
                            Symbol s3 = null;
                            try { s3 = Symbols.GetSymbol(symbolName); } catch { continue; }
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
                                await SyncWithVpsAsync(accId, b, e, m, brk, pl, ol, cl, ati, ml);
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
                var s = Symbols.GetSymbol(pos.SymbolName);
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
            var posSidLookup = new Dictionary<string, string>();
            foreach (var pos in Positions) { var psid = ResolveSid(pos.Id.ToString(), pos.Comment); if (!string.IsNullOrEmpty(psid)) { var k = (pos.SymbolName + "_" + pos.TradeType.ToString()).ToUpper(); if (!posSidLookup.ContainsKey(k)) posSidLookup[k] = psid; } }
            foreach (var order in PendingOrders)
            {
                var sid3 = ResolveSid(order.Id.ToString(), order.Comment).Replace("\"", "'");
                if (string.IsNullOrEmpty(sid3)) { var lk = (order.SymbolName + "_" + order.TradeType.ToString()).ToUpper(); string psid2; if (posSidLookup.TryGetValue(lk, out psid2)) { sid3 = psid2; var ok = order.Id.ToString(); if (!_ticketSidMap.ContainsKey(ok)) _ticketSidMap[ok] = psid2; } }
                var s2 = Symbols.GetSymbol(order.SymbolName); double lotsVal2 = (s2 != null) ? s2.VolumeInUnitsToQuantity(order.VolumeInUnits) : (order.VolumeInUnits / 100000.0);
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
            foreach (var sn in ssm.Take(100)) { Symbol s3 = null; try { s3 = Symbols.GetSymbol(sn); } catch { continue; } if (s3 == null) continue; ml.Add("{\"symbol\":\"" + s3.Name + "\",\"pip_value\":" + (double.IsNaN(s3.PipValue) ? 0 : s3.PipValue).ToString("F5", CultureInfo.InvariantCulture) + ",\"spread\":" + (double.IsNaN(s3.Spread) ? 0 : s3.Spread).ToString("F2", CultureInfo.InvariantCulture) + ",\"min_vol\":" + (double.IsNaN(s3.VolumeInUnitsMin) ? 0 : s3.VolumeInUnitsMin).ToString("F2", CultureInfo.InvariantCulture) + ",\"step_vol\":" + (double.IsNaN(s3.VolumeInUnitsStep) ? 0 : s3.VolumeInUnitsStep).ToString("F2", CultureInfo.InvariantCulture) + ",\"pip_size\":" + (double.IsNaN(s3.PipSize) ? 0 : s3.PipSize).ToString("F8", CultureInfo.InvariantCulture) + ",\"digits\":" + s3.Digits + "}"); }
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
                    await SyncWithVpsAsync(accId, b, e, m, brk, pl, ol, cl, ati, ml);
                }
                catch (Exception ex) { _lastSyncErr = FormatServerErrorForPanel(ex.Message); _syncStatus = "ERROR"; }
                finally { _busySync = false; RefreshDebugPanel(); }
            });
        }

        private async Task PollSignalsAsync(string accountId)
        {
            _pollCount++;
            _pollStatus = "POLLING";
            try
            {
                var url = ServerBaseUrl.TrimEnd('/') + "/v2/broker/pull?account_id=" + accountId + "&max_items=50";
                using (var request = new HttpRequestMessage(System.Net.Http.HttpMethod.Get, url))
                {
                    request.Headers.Add("x-api-key", EaApiKey);
                    var response = await _httpClient.SendAsync(request);

                    _serverStatus = (int)response.StatusCode < 500 ? "OK" : "SERVER_ERR";

                    if (response.IsSuccessStatusCode)
                    {
                        _apiStatus = "OK";
                        _successPolls++;
                        _lastPollTime = DateTime.Now;
                        _pollStatus = "OK";
                        _lastPollErr = "None";

                        // Reset error counter on successful poll
                        if (_consecutiveErrors > 0)
                        {
                            _consecutiveErrors = 0;
                            _lastErrorClearTime = DateTime.Now;
                            SafePrint("[Recovery] Error counter reset after successful poll");
                        }

                        var json = await response.Content.ReadAsStringAsync();
                        RunOnMainThread(() => ProcessResponse(json));
                    }
                    else
                    {
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
                _serverStatus = "OFFLINE";
                _apiStatus = "???";
                _pollStatus = "ERROR";
                _lastPollErr = ex.Message;

                // Increment error counter for exceptions
                _consecutiveErrors++;
                SafePrint("[Error] Poll exception: {0} (consecutive errors: {1})", ex.Message, _consecutiveErrors);
            }
            finally
            {
                RefreshDebugPanel();
            }
        }

        private void ProcessResponse(string json)
        {
            if (string.IsNullOrEmpty(json) || !json.Contains("\"items\"")) return;
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
            var leaseKey = id + ":" + (leaseToken ?? "");
            if (!string.IsNullOrEmpty(leaseToken) && _processedLeases.Contains(leaseKey)) return;
            if (!string.IsNullOrEmpty(leaseToken)) _processedLeases.Add(leaseKey);

            SafePrint("[Debug] Task Received: type={0} action={1} symbol={2} ticket={3} (ID: {4})", taskType, action, symbolCode, ticketNum, id);

            UpdateSignalHistory(id, taskType + " " + action + " " + symbolCode + " (PENDING)");

            BeginInvokeOnMainThread(() =>
            {
                string resolvedSymbolName;
                var symbol = TryResolveBrokerSymbol(symbolCode, out resolvedSymbolName) ? Symbols.GetSymbol(resolvedSymbolName) : null;

                if (symbol == null)
                {
                    var msg = "Symbol not found: " + symbolCode;
                    UpdateSignalHistory(id, taskType + " " + action + " " + symbolCode + " (" + msg + ")");
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
                                UpdateSignalHistory(id, taskType + " " + action + " " + symbolCode + " (CANCELLED)");
                                SafeAck(id, leaseToken, "CANCELLED", ticketStr, "cancel_close_ok");
                            }
                            else
                            {
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
                                    SafeAck(id, leaseToken, "CANCELLED", ticketStr, "cancel_order_ok");
                                }
                                else
                                {
                                    SafeAck(id, leaseToken, "ERROR", ticketStr, "cancel_order_fail: " + oRes.Error);
                                }
                            }
                            else
                            {
                                // Ticket not found as position or order — close by comment/label fallback
                                var targets = Positions.Where(p => p.SymbolName == symbolCode && (p.Comment == id || p.Label == MagicNumber.ToString())).ToList();
                                foreach (var p in targets)
                                {
                                    var pRes = ClosePosition(p);
                                    if (!pRes.IsSuccessful) SafePrint("[Error] Cancel close failed: {0}", pRes.Error);
                                }
                                var ordTargets = PendingOrders.Where(o => o.SymbolName == symbolCode && (o.Comment == id || o.Label == MagicNumber.ToString())).ToList();
                                foreach (var o in ordTargets)
                                {
                                    var oRes = CancelPendingOrder(o);
                                    if (!oRes.IsSuccessful) SafePrint("[Error] Cancel order failed: {0}", oRes.Error);
                                }
                                int totalClosed = targets.Count + ordTargets.Count;
                                SafeAck(id, leaseToken, "CANCELLED", ticketStr, totalClosed > 0 ? "cancel_ok" : "cancel_no_ticket");
                            }
                        }
                    }
                    else
                    {
                        // No ticket — close by comment/label fallback
                        var targets = Positions.Where(p => p.SymbolName == symbolCode && (p.Comment == id || p.Label == MagicNumber.ToString())).ToList();
                        foreach (var p in targets)
                        {
                            var pRes = ClosePosition(p);
                            if (!pRes.IsSuccessful) SafePrint("[Error] Cancel close failed: {0}", pRes.Error);
                        }
                        var ordTargets = PendingOrders.Where(o => o.SymbolName == symbolCode && (o.Comment == id || o.Label == MagicNumber.ToString())).ToList();
                        foreach (var o in ordTargets)
                        {
                            var oRes = CancelPendingOrder(o);
                            if (!oRes.IsSuccessful) SafePrint("[Error] Cancel order failed: {0}", oRes.Error);
                        }
                        int totalClosed = targets.Count + ordTargets.Count;
                        SafeAck(id, leaseToken, "CANCELLED", ticketStr, totalClosed > 0 ? "cancel_ok" : "cancel_no_pos");
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
                                SafeAck(id, leaseToken, "CLOSED", ticketStr, "close_ok");
                            }
                            else
                            {
                                SafeAck(id, leaseToken, "ERROR", ticketStr, "close_fail: " + cRes.Error);
                            }
                            return;
                        }
                    }
                    var targets = Positions.Where(p => p.SymbolName == symbolCode && (p.Comment == id || p.Label == MagicNumber.ToString())).ToList();
                    foreach (var p in targets)
                    {
                        var cRes = ClosePosition(p);
                        if (!cRes.IsSuccessful) SafePrint("[Error] Close failed: {0}", cRes.Error);
                    }
                    SafeAck(id, leaseToken, "CLOSED", ticketStr, "");
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
                                SafeAck(id, leaseToken, "FILLED", ticketStr, "");
                            }
                            else
                            {
                                SafeAck(id, leaseToken, "ERROR", ticketStr, "modify_fail: " + mRes.Error);
                            }
                            return;
                        }
                        var ord = PendingOrders.FirstOrDefault(o => o.Id == ticketNum);
                        if (ord != null)
                        {
                            double requestedLots = ParseDouble(GetJsonValue(json, "lots"));
                            if (requestedLots <= 0) requestedLots = ParseDouble(GetJsonValue(json, "volume"));
                            double currentLots = symbol.VolumeInUnitsToQuantity(ord.VolumeInUnits);
                            bool wantsVolumeChange = requestedLots > 0 && Math.Abs(requestedLots - currentLots) > 0.0001;

                            if (wantsVolumeChange)
                            {
                                double newVolumeUnits = symbol.QuantityToVolumeInUnits(requestedLots);
                                newVolumeUnits = symbol.NormalizeVolumeInUnits(newVolumeUnits, RoundingMode.Down);
                                if (newVolumeUnits < symbol.VolumeInUnitsMin)
                                {
                                    SafeAck(id, leaseToken, "ERROR", ticketStr, "modify_volume_too_small");
                                    return;
                                }

                                var cancelRes = CancelPendingOrder(ord);
                                if (!cancelRes.IsSuccessful)
                                {
                                    SafeAck(id, leaseToken, "ERROR", ticketStr, "modify_cancel_fail: " + cancelRes.Error);
                                    return;
                                }

                                TradeResult replaceRes = null;
                                if (ord.OrderType == PendingOrderType.Limit)
                                {
                                    replaceRes = PlaceLimitOrder(ord.TradeType, symbol.Name, newVolumeUnits, ord.TargetPrice, ord.Label, null, null, ord.ExpirationTime, id);
                                }
                                else
                                {
                                    replaceRes = PlaceStopOrder(ord.TradeType, symbol.Name, newVolumeUnits, ord.TargetPrice, ord.Label, null, null, ord.ExpirationTime, id);
                                }

                                if (!replaceRes.IsSuccessful || replaceRes.PendingOrder == null)
                                {
                                    SafeAck(id, leaseToken, "ERROR", ticketStr, "modify_replace_fail: " + (replaceRes != null ? replaceRes.Error.ToString() : "unknown"));
                                    return;
                                }

                                ord = replaceRes.PendingOrder;
                                ticketStr = ord.Id.ToString();
                            }

                            double? slPips = null;
                            double? tpPips = null;
                            if (sl > 0) slPips = Math.Round((action == "BUY" ? (ord.TargetPrice - sl) : (sl - ord.TargetPrice)) / symbol.PipSize, 2);
                            if (tp > 0) tpPips = Math.Round((action == "BUY" ? (tp - ord.TargetPrice) : (ord.TargetPrice - tp)) / symbol.PipSize, 2);
                            var mRes = ModifyPendingOrder(ord, ord.TargetPrice, slPips, tpPips, ord.ExpirationTime);
                            if (mRes.IsSuccessful)
                            {
                                SafeAck(id, leaseToken, "PENDING", ticketStr, "");
                            }
                            else
                            {
                                SafeAck(id, leaseToken, "ERROR", ticketStr, "modify_fail: " + mRes.Error);
                            }
                            return;
                        }
                    }
                    SafeAck(id, leaseToken, "ERROR", "", "modify_no_ticket");
                    return;
                }

                // --- OPEN (default): create new position/order ---
                if (Positions.Any(p => p.Comment == id))
                {
                    UpdateSignalHistory(id, action + " " + symbolCode + " (ALREADY_OPEN)");
                    SafeAck(id, leaseToken, "FILLED", "ALREADY_OPEN", "");
                    return;
                }
                if (PendingOrders.Any(o => o.Comment == id))
                {
                    UpdateSignalHistory(id, action + " " + symbolCode + " (ALREADY_PLACED)");
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
                    UpdateSignalHistory(id, action + " " + symbolCode + " (" + msg + ")");
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

                var label = MagicNumber.ToString();
                var tradeType = (action == "BUY") ? TradeType.Buy : TradeType.Sell;
                TradeResult res = null;

                if (executionPrice <= 0)
                {
                    var msg = "Invalid execution price: " + executionPrice;
                    UpdateSignalHistory(id, action + " " + symbolCode + " (" + msg + ")");
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
                                    UpdateSignalHistory(id, action + " " + symbolCode + " (REJECT: " + rejectMsg + ")");
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
                                UpdateSignalHistory(id, action + " " + symbolCode + " (REJECT: " + rejectMsg + ")");
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
                                UpdateSignalHistory(id, action + " " + symbolCode + " (REJECT: " + rejectMsg + ")");
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
                    res = PlaceLimitOrder(tradeType, symbol.Name, volumeUnits, entry, label, null, null, null, id);
                }
                else if (orderTypeStr == "stop")
                {
                    res = PlaceStopOrder(tradeType, symbol.Name, volumeUnits, entry, label, null, null, null, id);
                }
                else
                {
                    res = ExecuteMarketOrder(tradeType, symbol.Name, volumeUnits, label, null, null, id);
                }

                if (res.IsSuccessful)
                {
                    var ticket = (res.Position != null) ? res.Position.Id.ToString() : (res.PendingOrder != null ? res.PendingOrder.Id.ToString() : "OK");

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
                                    UpdateSignalHistory(id, action + " " + symbolCode + " (CANCEL: SL/TP rejected)");
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
                                    UpdateSignalHistory(id, action + " " + symbolCode + " (CANCEL: SL/TP rejected)");
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

                    UpdateSignalHistory(id, action + " " + symbolCode + " (FILLED)");
                    double lots = symbol.VolumeInUnitsToQuantity(volumeUnits);
                    SafeAck(id, leaseToken, (res.Position != null ? "OPEN" : "PENDING"), ticket, "", (res.Position != null ? res.Position.EntryPrice : (res.PendingOrder != null ? res.PendingOrder.TargetPrice : 0)), finalRiskMoney, lots);
                }
                else
                {
                    UpdateSignalHistory(id, action + " " + symbolCode + " (EXEC_FAIL: " + res.Error + ")");
                    SafeAck(id, leaseToken, "REJECTED", "", res.Error.ToString());
                }
            });
        }

        private void UpdateSignalHistory(string id, string text)
        {
            var entry = string.Format("{0}: {1}", id, text);
            _signalHistory.RemoveAll(x => x.StartsWith(id + ":"));
            _signalHistory.Insert(0, entry);
            if (_signalHistory.Count > 8) _signalHistory.RemoveAt(8);
            RefreshDebugPanel();
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
                _consecutiveErrors = 0;
                SafePrint("[Recovery] Error counter reset after 5 minutes of stable operation");
            }
        }

        private async Task SyncWithVpsAsync(string accId, double bal, double eq, double marg, string brokerName, List<string> posList, List<string> ordersList, List<string> closedList, HashSet<string> activeTicketIds, List<string> metricsList)
        {
            _syncStatus = "SYNCING";
            try
            {
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
                    + ",\"symbol_metrics\":[" + string.Join(",", metricsList ?? new List<string>()) + "]}";
                var content = new StringContent(payload, Encoding.UTF8, "application/json");
                content.Headers.Add("x-api-key", EaApiKey);
                var response = await _httpClient.PostAsync(ServerBaseUrl.TrimEnd('/') + "/v2/broker/sync", content);

                _serverStatus = (int)response.StatusCode < 500 ? "OK" : "SERVER_ERR";

                if (response.IsSuccessStatusCode)
                {
                    _apiStatus = "OK";
                    _syncCount++; _syncStatus = "OK"; _lastSyncTime = DateTime.Now; _lastSyncErr = "None";

                    // Reset error counter on successful sync
                    if (_consecutiveErrors > 0)
                    {
                        _consecutiveErrors = 0;
                        _lastErrorClearTime = DateTime.Now;
                        SafePrint("[Recovery] Error counter reset after successful sync");
                    }

                    var json = await response.Content.ReadAsStringAsync();
                    ParseSyncResults(json, activeTicketIds);
                }
                else
                {
                    _apiStatus = (response.StatusCode == HttpStatusCode.Unauthorized || response.StatusCode == HttpStatusCode.Forbidden) ? "KEY_INVALID" : "ERR_" + (int)response.StatusCode;
                    _syncStatus = "FAIL (" + (int)response.StatusCode + ")";
                    _lastSyncErr = FormatServerErrorForPanel(await response.Content.ReadAsStringAsync());
                    if (string.IsNullOrEmpty(_lastSyncErr)) _lastSyncErr = "Server Rejected Payload";

                    // Increment error counter for failed sync
                    _consecutiveErrors++;
                    SafePrint("[Error] Sync failed: {0} (consecutive errors: {1})", _lastSyncErr, _consecutiveErrors);
                }
            }
            catch (Exception ex)
            {
                _serverStatus = "OFFLINE";
                _apiStatus = "???";
                _syncStatus = "ERROR";
                _lastSyncErr = FormatServerErrorForPanel(ex.Message);

                // Increment error counter for sync exceptions
                _consecutiveErrors++;
                SafePrint("[Error] Sync exception: {0} (consecutive errors: {1})", ex.Message, _consecutiveErrors);
            }
            finally
            {
                RefreshDebugPanel();
            }
        }

        private async Task FetchTrackedSymbolsAsync(string accId)
        {
            try
            {
                var url = ServerBaseUrl.TrimEnd('/') + "/v2/broker/tracked-symbols?account=" + accId;
                var request = new HttpRequestMessage(System.Net.Http.HttpMethod.Get, url);
                request.Headers.Add("x-api-key", EaApiKey);
                var response = await _httpClient.SendAsync(request);
                if (response.IsSuccessStatusCode)
                {
                    var json = await response.Content.ReadAsStringAsync();
                    var symbolsMatch = Regex.Match(json, "\"symbols\"\\s*:\\s*\\[(.*?)\\]", RegexOptions.Singleline);
                    if (symbolsMatch.Success)
                    {
                        var items = Regex.Matches(symbolsMatch.Groups[1].Value, "\"([^\"]+)\"");
                        var requestedSymbols = new List<string>();
                        foreach (Match m in items)
                        {
                            var requested = m.Groups[1].Value;
                            if (!string.IsNullOrWhiteSpace(requested) && !requestedSymbols.Contains(requested))
                                requestedSymbols.Add(requested);
                        }

                        var resolved = await RunOnMainThreadAsync(() =>
                        {
                            var brokerSymbols = new List<string>();
                            var skippedSymbols = new List<string>();
                            foreach (var requested in requestedSymbols)
                            {
                                string brokerSymbol;
                                if (TryResolveBrokerSymbol(requested, out brokerSymbol))
                                {
                                    if (!brokerSymbols.Contains(brokerSymbol))
                                        brokerSymbols.Add(brokerSymbol);
                                }
                                else if (!skippedSymbols.Contains(requested))
                                {
                                    skippedSymbols.Add(requested);
                                }
                            }
                            return Tuple.Create(brokerSymbols, skippedSymbols);
                        });

                        _trackedSymbols.Clear();
                        foreach (var brokerSymbol in resolved.Item1)
                            _trackedSymbols.Add(brokerSymbol);

                        var skipped = resolved.Item2;
                        if (skipped.Count > 0)
                            SafePrint("[Price] Skipped {0} unsupported tracked symbols: {1}", skipped.Count, string.Join(",", skipped.Take(8)));
                        SafePrint("[Price] Fetched {0} tracked symbols", _trackedSymbols.Count);
                        RefreshDebugPanel();
                    }
                }
            }
            catch (Exception ex)
            {
                SafePrint("[Price] Fetch tracked symbols failed: {0}", ex.Message);
            }
        }

        private async Task PushPricesAsync(string accId, List<Tuple<string, double, double>> priceData)
        {
            _priceStatus = "PUSHING";
            try
            {
                var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                var priceList = new List<string>();
                foreach (var p in priceData)
                {
                    priceList.Add("{\"s\":\"" + p.Item1 + "\",\"b\":" + p.Item2.ToString("F5", CultureInfo.InvariantCulture) + ",\"a\":" + p.Item3.ToString("F5", CultureInfo.InvariantCulture) + "}");
                }

                var payload = "{\"source_id\":\"Ctrader\",\"account_id\":\"" + accId + "\",\"ts\":" + ts.ToString() + ",\"p\":[" + string.Join(",", priceList) + "]}";
                var content = new StringContent(payload, Encoding.UTF8, "application/json");
                content.Headers.Add("x-api-key", EaApiKey);
                var response = await _httpClient.PostAsync(ServerBaseUrl.TrimEnd('/') + "/v2/broker/prices", content);

                _serverStatus = "OK";
                if (response.IsSuccessStatusCode)
                {
                    _priceCount++; _priceStatus = "OK"; _lastPriceTime = DateTime.Now; _lastPriceErr = "None";
                    if (_priceCount == 1) SafePrint("[Price] First push OK: {0} symbols", priceData.Count);
                }
                else
                {
                    _priceStatus = "FAIL (" + (int)response.StatusCode + ")";
                    _lastPriceErr = FormatServerErrorForPanel(await response.Content.ReadAsStringAsync());
                    SafePrint("[Price] Push FAILED: {0}", _lastPriceErr);
                }
            }
            catch (Exception ex)
            {
                _priceStatus = "ERROR";
                _lastPriceErr = FormatServerErrorForPanel(ex.Message);
                if (_priceCount == 0) SafePrint("[Price] Push ERROR (first attempt): {0}", ex.Message);
            }
            if (_lastPriceTime == DateTime.MinValue)
                _lastPriceTime = DateTime.Now;
            RefreshDebugPanel();
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

                                var bars = MarketData.GetBars(tf, sym);
                                if (bars == null || bars.Count < 1) continue;

                                var lastBar = bars.LastBar;
                                long barTime = ToUnixTime(lastBar.OpenTime);

                                string key = sym + "_" + tfStr;
                                long lastKnown;
                                if (_barLastTime.TryGetValue(key, out lastKnown) && barTime <= lastKnown)
                                    continue;

                                _barLastTime[key] = barTime;

                                localBars.Add(
                                    "{\"s\":\"" + sym + "\"" +
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
                var response = await _httpClient.PostAsync(ServerBaseUrl.TrimEnd('/') + "/v2/broker/bars", content);

                if (response.IsSuccessStatusCode)
                {
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
                var covUrl = ServerBaseUrl.TrimEnd('/') + "/v2/broker/symbols?symbols=" + string.Join(",", symbols);
                var covRequest = new HttpRequestMessage(System.Net.Http.HttpMethod.Get, covUrl);
                covRequest.Headers.Add("x-api-key", EaApiKey);
                var covResponse = await _httpClient.SendAsync(covRequest);
                if (!covResponse.IsSuccessStatusCode)
                {
                    _incrementalStatus = "COV_FAIL";
                    _lastIncrementalErr = "HTTP " + (int)covResponse.StatusCode;
                    return;
                }
                var covJson = await covResponse.Content.ReadAsStringAsync();

                // 2. Fetch bars from broker for each symbol+TF with gaps
                string[] tfs = { "1", "5", "15", "60", "240", "1440" };

                var syncBuild = await RunOnMainThreadAsync(() =>
                {
                    var items = new List<string>();
                    int totalBars = 0;
                    bool isFirstSync = _incrementalSyncCount == 0;
                    int maxBars = isFirstSync ? 10000 : IncrementalBarsMaxPerPost;

                    foreach (var sym in symbols)
                    {
                        foreach (var tfStr in tfs)
                        {
                            if (totalBars >= maxBars) break;
                            try
                            {
                                // Parse remote end from coverage
                                var symUpper = sym.ToUpper();
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

                                var bars = MarketData.GetBars(tf, sym);
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
                var postResponse = await _httpClient.PostAsync(ServerBaseUrl.TrimEnd('/') + "/v2/broker/prices-sync", content);

                if (postResponse.IsSuccessStatusCode)
                {
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
            text = text.Replace("\\\"", "\"").Replace("\\\\", "\\").Trim();
            text = Regex.Replace(text, "\\s+", " ");
            text = text.Replace("insert or update on table", "DB write on");
            text = text.Replace("violates foreign key constraint", "FK");
            text = text.Replace("\"", "");
            text = text.Replace("\\", "");
            if (text.Length > 180) text = text.Substring(0, 180);
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
            var resList = new List<string>();
            var hasErrors = false;
            string firstError = null;
            var resultsMatch = Regex.Match(json, "\"results\"\\s*:\\s*\\[(.*?)\\]", RegexOptions.Singleline);
            if (resultsMatch.Success)
            {
                var objects = Regex.Matches(resultsMatch.Groups[1].Value, "\\{(.*?)\\}", RegexOptions.Singleline);
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

                    if (status == "Ok" || status == "Skip")
                    {
                        if (status == "Ok" && !activeTicketIds.Contains(ticket)) _syncedClosedTickets.Add(ticket);
                        continue;
                    }
                    if (string.Equals(status, "Error", StringComparison.OrdinalIgnoreCase))
                    {
                        hasErrors = true;
                        if (string.IsNullOrEmpty(firstError)) firstError = !string.IsNullOrEmpty(err) ? err : reason;
                    }
                    var displayTicket = string.IsNullOrEmpty(ticket) || ticket == "null" ? "-" : ticket;
                    var displaySid = string.IsNullOrEmpty(sid) || sid == "null" ? "NO_SID" : sid;
                    var detail = !string.IsNullOrEmpty(err) ? err : reason;
                    if (!string.IsNullOrEmpty(ticket) && !string.IsNullOrEmpty(sid) && sid != "null")
                    {
                        _ticketSidMap[ticket] = sid;
                    }
                    if (!string.IsNullOrEmpty(detail))
                    {
                        resList.Add(string.Format("{0} | {1} {2} {3} [{4}: {5}]", displayTicket, displaySid, act, sym, status, detail));
                    }
                    else
                    {
                        resList.Add(string.Format("{0} | {1} {2} {3} [{4}]", displayTicket, displaySid, act, sym, status));
                    }
                }
            }
            _lastSyncResults = resList;
            if (hasErrors)
            {
                _syncStatus = "PARTIAL";
                if (!string.IsNullOrEmpty(firstError)) _lastSyncErr = firstError;
            }
        }

        private async Task AckAsync(string sid, string token, string status, string ticket, string err, double entryExec = 0, double riskMoneyPlanned = 0, double volumeLots = 0)
        {
            var payload = "{\"trade_id\":\"" + sid
                + "\",\"lease_token\":\"" + (token ?? "") + "\""
                + ",\"execution_status\":\"" + status + "\""
                + ",\"broker_trade_id\":\"" + (ticket ?? "") + "\""
                + ",\"error\":\"" + (err ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""
                + ",\"message\":\"" + (err ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""
                + ",\"entry_exec\":" + entryExec.ToString("F5", CultureInfo.InvariantCulture)
                + ",\"risk_money_planned\":" + riskMoneyPlanned.ToString("F2", CultureInfo.InvariantCulture)
                + ",\"volume\":" + volumeLots.ToString("F2", CultureInfo.InvariantCulture) + "}";
            var content = new StringContent(payload, Encoding.UTF8, "application/json");
            content.Headers.Add("x-api-key", EaApiKey);
            var response = await _httpClient.PostAsync(ServerBaseUrl.TrimEnd('/') + "/v2/broker/ack", content);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                throw new Exception("HTTP " + ((int)response.StatusCode).ToString(CultureInfo.InvariantCulture) + " " + response.ReasonPhrase + (string.IsNullOrWhiteSpace(body) ? "" : (": " + body)));
            }
        }

        // Reliable ack: runs on thread pool so it completes even inside BeginInvokeOnMainThread
        private void SafeAck(string sid, string token, string status, string ticket, string err, double entryExec = 0, double riskMoneyPlanned = 0, double volumeLots = 0)
        {
            Task.Run(async () =>
            {
                try
                {
                    await AckAsync(sid, token, status, ticket, err, entryExec, riskMoneyPlanned, volumeLots);
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

                var tl = new StringBuilder();
                tl.AppendLine(string.Format("BUILD: {0}", BuildVersion));
                tl.AppendLine(string.Format("TIME: {0}", DateTime.Now.ToString("HH:mm:ss")));
                tl.AppendLine(string.Format("SERVER: {0} | API: {1}", _serverStatus, _apiStatus));
                Chart.DrawStaticText("Panel_TL", tl.ToString(), VerticalAlignment.Top, HorizontalAlignment.Left, Color.Aqua);

                // Top-Right: Price Push status
                var tr = new StringBuilder();
                var priceTimeStr = _lastPriceTime == DateTime.MinValue ? "WAITING..." : _lastPriceTime.ToString("HH:mm:ss");
                tr.AppendLine(string.Format("PRICE: {0} cnt={1}, {2}", _priceStatus, _priceCount, priceTimeStr));
                tr.AppendLine(string.Format("TRACK: {0} symbols", _trackedSymbols.Count));
                tr.AppendLine(string.Format("INTV: sync={0}s price={1}s", SyncIntervalSeconds, PricePushSeconds));
                if (_lastPriceErr != "None" && !string.IsNullOrEmpty(_lastPriceErr))
                    tr.AppendLine("ERR: " + (_lastPriceErr.Length > 40 ? _lastPriceErr.Substring(0, 40) : _lastPriceErr));
                // Show incremental sync status
                if (EnableIncrementalBars)
                {
                    var incTimeStr = _lastIncrementalSync == DateTime.MinValue ? "WAITING..." : _lastIncrementalSync.ToString("HH:mm:ss");
                    tr.AppendLine(string.Format("INCSYNC: {0} cnt={1} ins={2}, {3}", _incrementalStatus, _incrementalSyncCount, _incrementalTotalInserted, incTimeStr));
                }
                Color priceColor = _priceStatus == "OK" ? Color.Lime :
                                  (_priceStatus == "IDLE" || _priceStatus == "WAITING" ? Color.Gray :
                                  (_priceStatus == "PUSHING" ? Color.Yellow : Color.Red));
                Chart.DrawStaticText("Panel_TR", tr.ToString(), VerticalAlignment.Top, HorizontalAlignment.Right, priceColor);

                var bl = new StringBuilder();
                var pollTimeStr = _lastPollTime == DateTime.MinValue ? "WAITING..." : _lastPollTime.ToString("HH:mm:ss");
                bl.AppendLine(string.Format("EVENT POLL: {0}, {1}", _pollStatus, pollTimeStr));
                if (_consecutiveErrors > 0) bl.AppendLine(string.Format("ERR CNT: {0}", _consecutiveErrors));
                foreach (var sig in _signalHistory) bl.AppendLine("  " + sig);
                if (_lastPollErr != "None") bl.AppendLine("ERR: " + (_lastPollErr.Length > 50 ? _lastPollErr.Substring(0, 50) : _lastPollErr));

                Color pollColor = _pollStatus == "OK" ? Color.White :
                                 (_pollStatus == "IDLE" || _pollStatus == "WAITING" ? Color.Gray :
                                 (_pollStatus == "POLLING" ? Color.Yellow : Color.Red));
                Chart.DrawStaticText("Panel_BL", bl.ToString(), VerticalAlignment.Bottom, HorizontalAlignment.Left, pollColor);

                var br = new StringBuilder();
                var syncTimeStr = _lastSyncTime == DateTime.MinValue ? "WAITING..." : _lastSyncTime.ToString("HH:mm:ss");
                br.AppendLine(string.Format("EVENT SYNC: {0}, {1}", _syncStatus, syncTimeStr));
                foreach (var line in _lastSyncResults.Take(12)) br.AppendLine("  " + line);
                if (_lastSyncResults.Count > 12) br.AppendLine(string.Format("  ... +{0} more", _lastSyncResults.Count - 12));
                if (_lastSyncErr != "None") AppendWrappedPanelLine(br, "ERR: ", _lastSyncErr, 44, 3);

                Color syncColor = _syncStatus == "OK" ? Color.Lime :
                                 (_syncStatus == "IDLE" || _syncStatus == "WAITING" ? Color.Gray :
                                 (_syncStatus == "SYNCING" ? Color.Yellow :
                                 (_syncStatus == "PARTIAL" ? Color.Orange : Color.Red)));
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
        private double ParseDouble(string val) { double r; return double.TryParse(val, NumberStyles.Any, CultureInfo.InvariantCulture, out r) ? r : 0; }
    }
}
