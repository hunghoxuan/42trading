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
        [Parameter("Server Base URL", DefaultValue = "https://trade.mozasolution.com/webhook")]
        public string ServerBaseUrl { get; set; }

        [Parameter("EA API Key", DefaultValue = "acc_fab38ed32ecde9b28b3dd33d8be10a77da6a")]
        public string EaApiKey { get; set; }

        [Parameter("Polling Frequency (sec)", DefaultValue = 2, MinValue = 1)]
        public int PollSeconds { get; set; }

        [Parameter("Magic Number", DefaultValue = 20260411)]
        public int MagicNumber { get; set; }

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

        private const string BuildVersion = "v2026.05.17 16:14 - ca4da650";

        private string _serverStatus = "WAITING";
        private string _apiStatus = "WAITING";
        private string _pollStatus = "IDLE";
        private string _syncStatus = "IDLE";

        private string _lastPollErr = "None";
        private string _lastSyncErr = "None";

        private DateTime _lastPollTime = DateTime.MinValue;
        private DateTime _lastSyncTime = DateTime.MinValue;

        private int _pollCount = 0;
        private int _successPolls = 0;
        private int _syncCount = 0;
        private int _consecutiveErrors = 0;
        private DateTime _lastErrorClearTime = DateTime.Now;

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
        private Dictionary<string, string> _ticketSidMap = new Dictionary<string, string>(); // ticket -> sid backfill for empty comments


        private HttpClient _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        private bool _isBusy = false;

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

        protected override void OnStart()
        {
            _httpClient.Timeout = TimeSpan.FromSeconds(30);
            Timer.Start(PollSeconds);
            Print("[Bridge] Robot Started. Version: {0}", BuildVersion);
            RefreshDebugPanel();
        }

        protected override void OnTick()
        {
            if (SelectedStrategy == ManagementStrategy.None) return;
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
                            var result = ModifyPosition(pos, targetSL, pos.TakeProfit);
                            if (result.IsSuccessful)
                                Print("[BE] Moved SL to Entry+{0} pips for {1} {2}", BE_Offset, pos.SymbolName, pos.Id);
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
                            var result = ModifyPosition(pos, targetSL, pos.TakeProfit);
                            if (result.IsSuccessful)
                                Print("[Trail] Moved SL to {0:F5} for {1} {2}", targetSL, pos.SymbolName, pos.Id);
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
                        if (hit)
                        {
                            double volToClose = pos.VolumeInUnits * (p.SizePct / 100.0);
                            volToClose = symbol.NormalizeVolumeInUnits(volToClose, RoundingMode.Down);

                            // Check if we can close at least the minimum volume
                            if (volToClose >= symbol.VolumeInUnitsMin)
                            {
                                // Also check that we're not trying to close more than the position size
                                if (volToClose <= pos.VolumeInUnits)
                                {
                                    var res = ClosePosition(pos, volToClose);
                                    if (res.IsSuccessful)
                                    {
                                        _executedPartials.Add(pKey);
                                        Print("[Partial] Closed {0} units ({1}%) for {2} at {3}", volToClose, p.SizePct, pos.Id, p.Price);
                                    }
                                    else
                                    {
                                        Print("[Partial] Close failed for {0}: {1}", pos.Id, res.Error);
                                    }
                                }
                                else
                                {
                                    // If partial would close more than position size, close entire position
                                    var res = ClosePosition(pos);
                                    if (res.IsSuccessful)
                                    {
                                        _executedPartials.Add(pKey);
                                        Print("[Partial] Closed entire position {0} ({1}% partial exceeded position size)", pos.Id, p.SizePct);
                                    }
                                }
                            }
                            else
                            {
                                // If remaining volume is too small to split, check if we should close entire position
                                if (pos.VolumeInUnits >= symbol.VolumeInUnitsMin)
                                {
                                    // Close entire position if partial is too small but position is valid
                                    var res = ClosePosition(pos);
                                    if (res.IsSuccessful)
                                    {
                                        _executedPartials.Add(pKey);
                                        Print("[Partial] Closed entire position {0} (partial too small: {1} units)", pos.Id, volToClose);
                                    }
                                }
                                else
                                {
                                    // If position itself is too small, just mark as done
                                    _executedPartials.Add(pKey);
                                    Print("[Partial] Skipped {0} (Position too small for any partial)", pos.Id);
                                }
                            }
                        }
                    }
                }
            }
        }

        protected override void OnTimer()
        {
            if (_isBusy) return;
            _isBusy = true;
            try
            {
                // Perform memory cleanup periodically
                if (_pollCount % 10 == 0) // Every 10 polls
                {
                    CleanupOldEntries();
                }

                // Apply exponential backoff for consecutive errors
                if (_consecutiveErrors > 0)
                {
                    int backoffSeconds = Math.Min(30, (int)Math.Pow(2, _consecutiveErrors - 1));
                    if (backoffSeconds > PollSeconds)
                    {
                        Print("[Backoff] Delaying poll for {0}s due to {1} consecutive errors", backoffSeconds, _consecutiveErrors);
                        Task.Delay(backoffSeconds * 1000).Wait();
                    }
                }

                var accId = Account.UserId.ToString();
                var balance = Account.Balance;
                var equity = Account.Equity;
                var margin = Account.Margin;
                var posList = new List<string>();
                var activeTicketIds = new HashSet<string>(Positions.Select(p => p.Id.ToString()));

                // Sync ALL positions for Manual Discovery / Auto-Adopt
                foreach (var pos in Positions)
                {
                    var sid = ResolveSid(pos.Id.ToString(), pos.Comment).Replace("\"", "'");
                    var s = Symbols.GetSymbol(pos.SymbolName);
                    double lotsVal = (s != null) ? s.VolumeInUnitsToQuantity(pos.VolumeInUnits) : (pos.VolumeInUnits / 100000.0);

                    double tpPnl = 0;
                    double slPnl = 0;
                    if (s != null)
                    {
                        if (pos.TakeProfit.HasValue)
                        {
                            double pips = (pos.TakeProfit.Value - pos.EntryPrice) / s.PipSize;
                            if (pos.TradeType == TradeType.Sell) pips = -pips;
                            tpPnl = pips * s.PipValue * pos.VolumeInUnits;
                        }
                        if (pos.StopLoss.HasValue)
                        {
                            double pips = (pos.StopLoss.Value - pos.EntryPrice) / s.PipSize;
                            if (pos.TradeType == TradeType.Sell) pips = -pips;
                            slPnl = pips * s.PipValue * pos.VolumeInUnits;
                        }
                    }

                    posList.Add(string.Format(CultureInfo.InvariantCulture,
                        "{{\"sid\":\"{0}\",\"comment\":\"{1}\",\"ticket\":\"{2}\",\"symbol\":\"{3}\",\"side\":\"{4}\",\"type\":\"MARKET\",\"entry\":{5:F5},\"sl\":{6:F5},\"tp\":{7:F5},\"volume\":{8:F2},\"lots\":{9:F2},\"pnl\":{10:F2},\"pips\":{11:F2},\"commission\":{12:F2},\"swap\":{13:F2},\"margin\":{14:F2},\"tp_pnl\":{15:F2},\"sl_pnl\":{16:F2},\"label\":\"{17}\",\"status\":\"OPEN\"}}",
                        sid, sid, pos.Id, pos.SymbolName, pos.TradeType.ToString().ToUpper(),
                        double.IsNaN(pos.EntryPrice) ? 0 : pos.EntryPrice,
                        pos.StopLoss ?? 0,
                        pos.TakeProfit ?? 0,
                        double.IsNaN(pos.VolumeInUnits) ? 0 : pos.VolumeInUnits,
                        double.IsNaN(lotsVal) ? 0 : lotsVal,
                        double.IsNaN(pos.NetProfit) ? 0 : pos.NetProfit,
                        double.IsNaN(pos.Pips) ? 0 : pos.Pips,
                        double.IsNaN(pos.Commissions) ? 0 : pos.Commissions,
                        double.IsNaN(pos.Swap) ? 0 : pos.Swap,
                        double.IsNaN(pos.Margin) ? 0 : pos.Margin,
                        double.IsNaN(tpPnl) ? 0 : tpPnl,
                        double.IsNaN(slPnl) ? 0 : slPnl,
                        pos.Label));
                }

                var closedList = new List<string>();
                var historicalDeals = History.OrderByDescending(d => d.ClosingTime).ToList();

                var limit = DateTime.UtcNow.AddDays(-2);
                foreach (var deal in historicalDeals)
                {
                    if (deal.ClosingTime < limit) continue;
                    if (_syncedClosedTickets.Contains(deal.PositionId.ToString())) continue;
                    if (closedList.Count >= 20) break;

                    var sid = ResolveSid(deal.PositionId.ToString(), deal.Comment).Replace("\"", "'");
                    closedList.Add(string.Format(CultureInfo.InvariantCulture,
                        "{{\"sid\":\"{0}\",\"comment\":\"{1}\",\"ticket\":\"{2}\",\"symbol\":\"{3}\",\"symbol_code\":\"{4}\",\"side\":\"{5}\",\"volume\":{6:F2},\"pnl\":{7:F2},\"pips\":{8:F2},\"commission\":{9:F2},\"swap\":{10:F2},\"status\":\"CLOSED\",\"closed_at\":\"{11:O}\",\"label\":\"{12}\"}}",
                        sid, sid, deal.PositionId, deal.SymbolName, deal.SymbolName, deal.TradeType.ToString().ToUpper(),
                        double.IsNaN(deal.VolumeInUnits) ? 0 : deal.VolumeInUnits,
                        double.IsNaN(deal.NetProfit) ? 0 : deal.NetProfit,
                        0.0,
                        double.IsNaN(deal.Commissions) ? 0 : deal.Commissions,
                        double.IsNaN(deal.Swap) ? 0 : deal.Swap,
                        deal.ClosingTime, deal.Label));
                }

                var ordersList = new List<string>();
                foreach (var order in PendingOrders)
                {
                    var sid = ResolveSid(order.Id.ToString(), order.Comment).Replace("\"", "'");
                    var s = Symbols.GetSymbol(order.SymbolName);
                    double lotsVal = (s != null) ? s.VolumeInUnitsToQuantity(order.VolumeInUnits) : (order.VolumeInUnits / 100000.0);

                    double pnlTp = 0;
                    double pnlSl = 0;
                    if (s != null)
                    {
                        if (order.TakeProfit.HasValue)
                        {
                            double pips = Math.Abs(order.TargetPrice - order.TakeProfit.Value) / s.PipSize;
                            pnlTp = pips * s.PipValue * order.VolumeInUnits;
                        }
                        if (order.StopLoss.HasValue)
                        {
                            double pips = Math.Abs(order.TargetPrice - order.StopLoss.Value) / s.PipSize;
                            pnlSl = -pips * s.PipValue * order.VolumeInUnits;
                        }
                    }

                    ordersList.Add(string.Format(CultureInfo.InvariantCulture,
                        "{{\"sid\":\"{0}\",\"comment\":\"{1}\",\"ticket\":\"{2}\",\"symbol\":\"{3}\",\"side\":\"{4}\",\"type\":\"{5}\",\"target_price\":{6:F5},\"entry\":{7:F5},\"sl\":{8:F5},\"tp\":{9:F5},\"volume\":{10:F2},\"lots\":{11:F2},\"label\":\"{12}\",\"status\":\"PENDING\",\"margin\":{13:F2},\"pnl_tp\":{14:F2},\"pnl_sl\":{15:F2}}}",
                        sid, sid, order.Id, order.SymbolName, order.TradeType.ToString().ToUpper(), order.OrderType.ToString().ToUpper(),
                        order.TargetPrice,
                        order.TargetPrice,
                        order.StopLoss ?? 0,
                        order.TakeProfit ?? 0,
                        double.IsNaN(order.VolumeInUnits) ? 0 : order.VolumeInUnits,
                        double.IsNaN(lotsVal) ? 0 : lotsVal,
                        order.Label,
                        0.0,
                        pnlTp,
                        pnlSl));
                }

                var symbolsToSync = new HashSet<string>();
                if (Symbol != null && !string.IsNullOrWhiteSpace(Symbol.Name))
                    symbolsToSync.Add(Symbol.Name);
                foreach (var pos in Positions)
                    if (!string.IsNullOrWhiteSpace(pos.SymbolName))
                        symbolsToSync.Add(pos.SymbolName);
                foreach (var order in PendingOrders)
                    if (!string.IsNullOrWhiteSpace(order.SymbolName))
                        symbolsToSync.Add(order.SymbolName);

                var metricsList = new List<string>();
                foreach (var symbolName in symbolsToSync.Take(100))
                {
                    Symbol s = null;
                    try
                    {
                        s = Symbols.GetSymbol(symbolName);
                    }
                    catch
                    {
                        continue;
                    }
                    if (s == null) continue;

                    metricsList.Add(string.Format(CultureInfo.InvariantCulture,
                        "{{\"symbol\":\"{0}\",\"pip_value\":{1:F5},\"spread\":{2:F2},\"min_vol\":{3:F2},\"step_vol\":{4:F2},\"pip_size\":{5:F8},\"digits\":{6}}}",
                            s.Name,
                            double.IsNaN(s.PipValue) ? 0 : s.PipValue,
                            double.IsNaN(s.Spread) ? 0 : s.Spread,
                            double.IsNaN(s.VolumeInUnitsMin) ? 0 : s.VolumeInUnitsMin,
                            double.IsNaN(s.VolumeInUnitsStep) ? 0 : s.VolumeInUnitsStep,
                            double.IsNaN(s.PipSize) ? 0 : s.PipSize,
                            s.Digits));
                }

                var brokerName = Account.BrokerName;
                _pollStatus = "POLLING";
                _syncStatus = "SYNCING";
                RefreshDebugPanel();

                Task.Run(async () =>
                {
                    try
                    {
                        await PollSignalsAsync(accId);
                        await SyncWithVpsAsync(accId, balance, equity, margin, brokerName, posList, ordersList, closedList, activeTicketIds, metricsList);
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
            catch (Exception ex)
            {
                _serverStatus = "CLIENT_ERR";
                _apiStatus = "PREP_ERR";
                _pollStatus = "ERROR";
                _syncStatus = "ERROR";
                _lastPollErr = FormatServerErrorForPanel(ex.Message);
                _lastSyncErr = FormatServerErrorForPanel(ex.Message);
                _isBusy = false;
                RefreshDebugPanel();
            }
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
                            Print("[Recovery] Error counter reset after successful poll");
                        }

                        var json = await response.Content.ReadAsStringAsync();
                        BeginInvokeOnMainThread(() => ProcessResponse(json));
                    }
                    else
                    {
                        _apiStatus = (response.StatusCode == HttpStatusCode.Unauthorized || response.StatusCode == HttpStatusCode.Forbidden) ? "KEY_INVALID" : "ERR_" + (int)response.StatusCode;
                        _pollStatus = "FAIL";
                        _lastPollErr = await response.Content.ReadAsStringAsync();
                        if (string.IsNullOrEmpty(_lastPollErr)) _lastPollErr = "HTTP " + (int)response.StatusCode;

                        // Increment error counter for non-successful responses
                        _consecutiveErrors++;
                        Print("[Error] Poll failed: {0} (consecutive errors: {1})", _lastPollErr, _consecutiveErrors);
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
                Print("[Error] Poll exception: {0} (consecutive errors: {1})", ex.Message, _consecutiveErrors);
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

            Print("[Debug] Task Received: type={0} action={1} symbol={2} ticket={3} (ID: {4})", taskType, action, symbolCode, ticketNum, id);

            UpdateSignalHistory(id, taskType + " " + action + " " + symbolCode + " (PENDING)");

            BeginInvokeOnMainThread(() =>
            {
                var symbol = Symbols.GetSymbol(symbolCode);

                if (symbol == null && symbolCode.Length == 6)
                {
                    var slashName = symbolCode.Substring(0, 3) + "/" + symbolCode.Substring(3, 3);
                    symbol = Symbols.GetSymbol(slashName);
                }

                if (symbol == null)
                {
                    var msg = "Symbol not found: " + symbolCode;
                    UpdateSignalHistory(id, taskType + " " + action + " " + symbolCode + " (" + msg + ")");
                    _ = AckAsync(id, leaseToken, "REJECTED", "", msg);
                    Print("[Error] Symbol '{0}' not found in your platform.", symbolCode);
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
                                _ = AckAsync(id, leaseToken, "CANCELLED", ticketStr, "cancel_close_ok");
                            }
                            else
                            {
                                UpdateSignalHistory(id, taskType + " " + action + " " + symbolCode + " (CANCEL_FAIL: " + cRes.Error + ")");
                                _ = AckAsync(id, leaseToken, "ERROR", ticketStr, "cancel_close_fail: " + cRes.Error);
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
                                    UpdateSignalHistory(id, taskType + " " + action + " " + symbolCode + " (CANCELLED)");
                                    _ = AckAsync(id, leaseToken, "CANCELLED", ticketStr, "cancel_order_ok");
                                }
                                else
                                {
                                    UpdateSignalHistory(id, taskType + " " + action + " " + symbolCode + " (CANCEL_FAIL: " + oRes.Error + ")");
                                    _ = AckAsync(id, leaseToken, "ERROR", ticketStr, "cancel_order_fail: " + oRes.Error);
                                }
                            }
                            else
                            {
                                // Ticket not found as position or order — close by comment/label fallback
                                var targets = Positions.Where(p => p.SymbolName == symbolCode && (p.Comment == id || p.Label == MagicNumber.ToString())).ToList();
                                foreach (var p in targets)
                                {
                                    var pRes = ClosePosition(p);
                                    if (!pRes.IsSuccessful) Print("[Error] Cancel close failed: {0}", pRes.Error);
                                }
                                _ = AckAsync(id, leaseToken, "CANCELLED", ticketStr, targets.Count > 0 ? "cancel_close_ok" : "cancel_no_ticket");
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
                            if (!pRes.IsSuccessful) Print("[Error] Cancel close failed: {0}", pRes.Error);
                        }
                        _ = AckAsync(id, leaseToken, "CANCELLED", ticketStr, targets.Count > 0 ? "cancel_close_ok" : "cancel_no_pos");
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
                                _ = AckAsync(id, leaseToken, "CLOSED", ticketStr, "close_ok");
                            }
                            else
                            {
                                _ = AckAsync(id, leaseToken, "ERROR", ticketStr, "close_fail: " + cRes.Error);
                            }
                            return;
                        }
                    }
                    var targets = Positions.Where(p => p.SymbolName == symbolCode && (p.Comment == id || p.Label == MagicNumber.ToString())).ToList();
                    foreach (var p in targets)
                    {
                        var cRes = ClosePosition(p);
                        if (!cRes.IsSuccessful) Print("[Error] Close failed: {0}", cRes.Error);
                    }
                    _ = AckAsync(id, leaseToken, "CLOSED", ticketStr, "");
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
                                _ = AckAsync(id, leaseToken, "OPEN", ticketStr, "modify_ok");
                            }
                            else
                            {
                                _ = AckAsync(id, leaseToken, "ERROR", ticketStr, "modify_fail: " + mRes.Error);
                            }
                            return;
                        }
                        var ord = PendingOrders.FirstOrDefault(o => o.Id == ticketNum);
                        if (ord != null)
                        {
                            double? slPips = null;
                            double? tpPips = null;
                            if (sl > 0) slPips = Math.Round((action == "BUY" ? (ord.TargetPrice - sl) : (sl - ord.TargetPrice)) / symbol.PipSize, 2);
                            if (tp > 0) tpPips = Math.Round((action == "BUY" ? (tp - ord.TargetPrice) : (ord.TargetPrice - tp)) / symbol.PipSize, 2);
                            var mRes = ModifyPendingOrder(ord, ord.TargetPrice, slPips, tpPips, ord.ExpirationTime);
                            if (mRes.IsSuccessful)
                            {
                                _ = AckAsync(id, leaseToken, "PENDING", ticketStr, "modify_ok");
                            }
                            else
                            {
                                _ = AckAsync(id, leaseToken, "ERROR", ticketStr, "modify_fail: " + mRes.Error);
                            }
                            return;
                        }
                    }
                    _ = AckAsync(id, leaseToken, "ERROR", "", "modify_no_ticket");
                    return;
                }

                // --- OPEN (default): create new position/order ---
                if (Positions.Any(p => p.Comment == id))
                {
                    UpdateSignalHistory(id, action + " " + symbolCode + " (ALREADY_OPEN)");
                    _ = AckAsync(id, leaseToken, "FILLED", "ALREADY_OPEN", "");
                    return;
                }
                if (PendingOrders.Any(o => o.Comment == id))
                {
                    UpdateSignalHistory(id, action + " " + symbolCode + " (ALREADY_PLACED)");
                    _ = AckAsync(id, leaseToken, "PENDING", "ALREADY_PLACED", "");
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

                double riskMoneyRaw = ParseDouble(GetJsonValue(json, "risk_money"));
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
                    _ = AckAsync(id, leaseToken, "REJECTED", "", msg);
                    return;
                }

                // EXTRACT PARTIAL TPs
                var rawJson = GetJsonValue(json, "raw_json");
                if (!string.IsNullOrEmpty(rawJson))
                {
                    var partials = new List<PartialTP>();
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
                    if (partials.Count > 0) _tradePartials[id] = partials;
                }

                var label = MagicNumber.ToString();
                var tradeType = (action == "BUY") ? TradeType.Buy : TradeType.Sell;
                TradeResult res = null;

                if (executionPrice <= 0)
                {
                    var msg = "Invalid execution price: " + executionPrice;
                    UpdateSignalHistory(id, action + " " + symbolCode + " (" + msg + ")");
                    _ = AckAsync(id, leaseToken, "REJECTED", "", msg);
                    Print("[Error] Cannot execute {0} {1}: Ask/Bid price is 0. Check connection.", action, symbolCode);
                    return;
                }

                Print("[Debug] Executing {0} {1} at {2}. SL: {3}, TP: {4}, Vol: {5}", action, symbolCode, executionPrice, sl, tp, volumeUnits);

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
                    if (sl > 0 || tp > 0)
                    {
                        if (res.Position != null)
                        {
                            var mRes = ModifyPosition(res.Position, (sl > 0 ? sl : (double?)null), (tp > 0 ? tp : (double?)null));
                            if (!mRes.IsSuccessful) Print("[Error] SL/TP Modification failed for Position {0}: {1}", ticket, mRes.Error);
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
                            if (!mRes.IsSuccessful) Print("[Error] SL/TP Modification failed for Order {0}: {1}", ticket, mRes.Error);
                        }
                    }

                    UpdateSignalHistory(id, action + " " + symbolCode + " (FILLED)");
                    _ = AckAsync(id, leaseToken, (res.Position != null ? "OPEN" : "PENDING"), ticket, "", (res.Position != null ? res.Position.EntryPrice : (res.PendingOrder != null ? res.PendingOrder.TargetPrice : 0)));
                }
                else
                {
                    UpdateSignalHistory(id, action + " " + symbolCode + " (EXEC_FAIL: " + res.Error + ")");
                    _ = AckAsync(id, leaseToken, "REJECTED", "", res.Error.ToString());
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
                Print("[Cleanup] Removed {0} old signal IDs from memory", toRemove.Count);
            }

            // Clean up old lease entries
            if (_processedLeases.Count > 1000)
            {
                var toRemove = _processedLeases.Take(_processedLeases.Count - 500).ToList();
                foreach (var l in toRemove) _processedLeases.Remove(l);
                Print("[Cleanup] Removed {0} old lease entries from memory", toRemove.Count);
            }

            // Clean up old synced closed tickets
            if (_syncedClosedTickets.Count > 500)
            {
                var toRemove = _syncedClosedTickets.Take(_syncedClosedTickets.Count - 250).ToList();
                foreach (var ticket in toRemove)
                {
                    _syncedClosedTickets.Remove(ticket);
                }
                Print("[Cleanup] Removed {0} old closed tickets from memory", toRemove.Count);
            }

            // Clean up old partial TP tracking
            if (_executedPartials.Count > 200)
            {
                var toRemove = _executedPartials.Take(_executedPartials.Count - 100).ToList();
                foreach (var key in toRemove)
                {
                    _executedPartials.Remove(key);
                }
                Print("[Cleanup] Removed {0} old partial TP keys from memory", toRemove.Count);
            }

            // Auto-clear error state after 5 minutes of successful operation
            if (_consecutiveErrors > 0 && (DateTime.Now - _lastErrorClearTime).TotalMinutes > 5)
            {
                _consecutiveErrors = 0;
                Print("[Recovery] Error counter reset after 5 minutes of stable operation");
            }
        }

        private async Task SyncWithVpsAsync(string accId, double bal, double eq, double marg, string brokerName, List<string> posList, List<string> ordersList, List<string> closedList, HashSet<string> activeTicketIds, List<string> metricsList)
        {
            _syncStatus = "SYNCING";
            try
            {
                var payload = string.Format(CultureInfo.InvariantCulture,
                    "{{\"source_id\":\"Ctrader\",\"account_id\":\"{0}\",\"balance\":{1:F2},\"equity\":{2:F2},\"margin\":{3:F2},\"broker_name\":\"{4}\",\"positions\":[{5}],\"orders\":[{6}],\"closed\":[{7}],\"symbol_metrics\":[{8}]}}",
                    accId, bal, eq, marg, brokerName, string.Join(",", posList), string.Join(",", ordersList), string.Join(",", closedList), string.Join(",", metricsList));
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
                        Print("[Recovery] Error counter reset after successful sync");
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
                    Print("[Error] Sync failed: {0} (consecutive errors: {1})", _lastSyncErr, _consecutiveErrors);
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
                Print("[Error] Sync exception: {0} (consecutive errors: {1})", ex.Message, _consecutiveErrors);
            }
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

        private async Task AckAsync(string sid, string token, string status, string ticket, string err, double entryExec = 0)
        {
            try
            {
                var payload = string.Format(CultureInfo.InvariantCulture,
                    "{{\"trade_id\":\"{0}\", \"lease_token\":\"{1}\", \"execution_status\":\"{2}\", \"broker_trade_id\":\"{3}\", \"error\":\"{4}\", \"entry_exec\":{5:F5}}}",
                    sid, token, status, ticket, err, entryExec);
                var content = new StringContent(payload, Encoding.UTF8, "application/json");
                content.Headers.Add("x-api-key", EaApiKey);
                await _httpClient.PostAsync(ServerBaseUrl.TrimEnd('/') + "/v2/broker/ack", content);
            }
            catch { }
        }

        private void RefreshDebugPanel()
        {
            BeginInvokeOnMainThread(() =>
            {
                var tl = new StringBuilder();
                tl.AppendLine(string.Format("BUILD: {0}", BuildVersion));
                tl.AppendLine(string.Format("TIME: {0}", DateTime.Now.ToString("HH:mm:ss")));
                tl.AppendLine(string.Format("SERVER: {0} | API: {1}", _serverStatus, _apiStatus));
                Chart.DrawStaticText("Panel_TL", tl.ToString(), VerticalAlignment.Top, HorizontalAlignment.Left, Color.Aqua);

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
            });
        }

        private string GetJsonValue(string json, string key)
        {
            var m = Regex.Match(json, string.Format("\"{0}\"\\s*:\\s*\"?([^,\"]*)\"?", key));
            return m.Success ? m.Groups[1].Value.Trim() : "";
        }
        private double ParseDouble(string val) { double r; return double.TryParse(val, NumberStyles.Any, CultureInfo.InvariantCulture, out r) ? r : 0; }
    }
}
