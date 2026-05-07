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

        [Parameter("Max Volume (%)", DefaultValue = 1.0)]
        public double MaxVolumePercent { get; set; }

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

        private const string BuildVersion = "v2026.05.07 13:20 - e6f7a8b";
        
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

        // REGISTRY: Tracks all processed signals to prevent duplicates
        private HashSet<string> _processedSignalIds = new HashSet<string>();
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


        private HttpClient _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        private bool _isBusy = false;

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
                            
                            if (volToClose >= symbol.VolumeInUnitsMin)
                            {
                                var res = ClosePosition(pos, volToClose);
                                if (res.IsSuccessful)
                                {
                                    _executedPartials.Add(pKey);
                                    Print("[Partial] Closed {0} units ({1}%) for {2} at {3}", volToClose, p.SizePct, pos.Id, p.Price);
                                }
                            }
                            else
                            {
                                // If remaining volume is too small to split, just mark as done to avoid spamming
                                _executedPartials.Add(pKey);
                                Print("[Partial] Skipped {0} (Volume too small for partial)", pos.Id);
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

            var accId = Account.UserId.ToString();
            var balance = Account.Balance;
            var equity = Account.Equity;
            var margin = Account.Margin;
            var posList = new List<string>();
            var activeTicketIds = new HashSet<string>(Positions.Select(p => p.Id.ToString()));
            
            // Sync ALL positions for Manual Discovery / Auto-Adopt
            foreach (var pos in Positions) {
                var sid = (pos.Comment ?? "").Replace("\"", "'");
                var s = Symbols.GetSymbol(pos.SymbolName);
                double lotsVal = (s != null) ? s.VolumeInUnitsToQuantity(pos.VolumeInUnits) : (pos.VolumeInUnits / 100000.0);
                
                double tpPnl = 0;
                double slPnl = 0;
                if (s != null) {
                    if (pos.TakeProfit.HasValue) {
                        double pips = (pos.TakeProfit.Value - pos.EntryPrice) / s.PipSize;
                        if (pos.TradeType == TradeType.Sell) pips = -pips;
                        tpPnl = pips * s.PipValue * pos.VolumeInUnits;
                    }
                    if (pos.StopLoss.HasValue) {
                        double pips = (pos.StopLoss.Value - pos.EntryPrice) / s.PipSize;
                        if (pos.TradeType == TradeType.Sell) pips = -pips;
                        slPnl = pips * s.PipValue * pos.VolumeInUnits;
                    }
                }

                posList.Add(string.Format(CultureInfo.InvariantCulture, 
                    "{{\"sid\":\"{0}\",\"ticket\":\"{1}\",\"symbol\":\"{2}\",\"side\":\"{3}\",\"volume\":{4:F2},\"lots\":{5:F2},\"pnl\":{6:F2},\"pips\":{7:F2},\"commission\":{8:F2},\"swap\":{9:F2},\"margin\":{10:F2},\"tp_pnl\":{11:F2},\"sl_pnl\":{12:F2},\"label\":\"{13}\",\"status\":\"OPEN\"}}",
                    sid, pos.Id, pos.SymbolName, pos.TradeType.ToString().ToUpper(), 
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
            foreach (var deal in historicalDeals) {
                if (deal.ClosingTime < limit) continue;
                if (_syncedClosedTickets.Contains(deal.PositionId.ToString())) continue;
                if (closedList.Count >= 20) break;

                var sid = (deal.Comment ?? "").Replace("\"", "'");
                closedList.Add(string.Format(CultureInfo.InvariantCulture, 
                    "{{\"sid\":\"{0}\",\"ticket\":\"{1}\",\"symbol\":\"{2}\",\"symbol_code\":\"{3}\",\"side\":\"{4}\",\"volume\":{5:F2},\"pnl\":{6:F2},\"pips\":{7:F2},\"commission\":{8:F2},\"swap\":{9:F2},\"status\":\"CLOSED\",\"closed_at\":\"{10:O}\",\"label\":\"{11}\"}}",
                    sid, deal.PositionId, deal.SymbolName, deal.SymbolName, deal.TradeType.ToString().ToUpper(), 
                    double.IsNaN(deal.VolumeInUnits) ? 0 : deal.VolumeInUnits, 
                    double.IsNaN(deal.NetProfit) ? 0 : deal.NetProfit, 
                    0.0, // Historical deals don't have a direct 'Pips' property in some versions, defaulting to 0 for now
                    double.IsNaN(deal.Commissions) ? 0 : deal.Commissions,
                    double.IsNaN(deal.Swap) ? 0 : deal.Swap,
                    deal.ClosingTime, deal.Label));
            }

            var ordersList = new List<string>();
            foreach (var order in PendingOrders) {
                var sid = (order.Comment ?? "").Replace("\"", "'");
                var s = Symbols.GetSymbol(order.SymbolName);
                double lotsVal = (s != null) ? s.VolumeInUnitsToQuantity(order.VolumeInUnits) : (order.VolumeInUnits / 100000.0);
                
                double pnlTp = 0;
                double pnlSl = 0;
                if (s != null) {
                    if (order.TakeProfit.HasValue) {
                        double pips = Math.Abs(order.TargetPrice - order.TakeProfit.Value) / s.PipSize;
                        pnlTp = pips * s.PipValue * order.VolumeInUnits;
                    }
                    if (order.StopLoss.HasValue) {
                        double pips = Math.Abs(order.TargetPrice - order.StopLoss.Value) / s.PipSize;
                        pnlSl = -pips * s.PipValue * order.VolumeInUnits;
                    }
                }

                ordersList.Add(string.Format(CultureInfo.InvariantCulture, 
                    "{{\"sid\":\"{0}\",\"ticket\":\"{1}\",\"symbol\":\"{2}\",\"side\":\"{3}\",\"type\":\"{4}\",\"volume\":{5:F2},\"lots\":{6:F2},\"target_price\":{7:F5},\"sl\":{8:F5},\"tp\":{9:F5},\"label\":\"{10}\",\"status\":\"PENDING\",\"margin\":{11:F2},\"pnl_tp\":{12:F2},\"pnl_sl\":{13:F2}}}",
                    sid, order.Id, order.SymbolName, order.TradeType.ToString().ToUpper(), order.OrderType.ToString().ToUpper(),
                    double.IsNaN(order.VolumeInUnits) ? 0 : order.VolumeInUnits, 
                    double.IsNaN(lotsVal) ? 0 : lotsVal,
                    order.TargetPrice,
                    order.StopLoss ?? 0,
                    order.TakeProfit ?? 0,
                    order.Label,
                    0.0, // margin fallback
                    pnlTp,
                    pnlSl));
            }

            var symbolsToSync = new HashSet<string>();
            symbolsToSync.Add(Symbol.Name);
            int count = 0;
            foreach (var name in Symbols) {
                symbolsToSync.Add(name);
                if (++count >= 50) break;
            }
            foreach (var pos in Positions) symbolsToSync.Add(pos.SymbolName);
            
            var metricsList = new List<string>();
            foreach (var symbolName in symbolsToSync.Take(100)) {
                var s = Symbols.GetSymbol(symbolName);
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

            Task.Run(async () => {
                try {
                    await PollSignalsAsync(accId);
                    await SyncWithVpsAsync(accId, balance, equity, margin, brokerName, posList, ordersList, closedList, activeTicketIds, metricsList);
                } catch (Exception ex) {
                    _lastSyncErr = ex.Message;
                } finally {
                    _isBusy = false;
                    RefreshDebugPanel();
                }
            });
        }

        private async Task PollSignalsAsync(string accountId)
        {
            _pollCount++;
            _pollStatus = "POLLING";
            try
            {
                var url = ServerBaseUrl.TrimEnd('/') + "/v2/broker/pull?account_id=" + accountId;
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
                        var json = await response.Content.ReadAsStringAsync();
                        BeginInvokeOnMainThread(() => ProcessResponse(json));
                    }
                    else
                    {
                        _apiStatus = (response.StatusCode == HttpStatusCode.Unauthorized || response.StatusCode == HttpStatusCode.Forbidden) ? "KEY_INVALID" : "ERR_" + (int)response.StatusCode;
                        _pollStatus = "FAIL";
                        _lastPollErr = await response.Content.ReadAsStringAsync();
                        if (string.IsNullOrEmpty(_lastPollErr)) _lastPollErr = "HTTP " + (int)response.StatusCode;
                    }
                }
            }
            catch (Exception ex) { 
                _serverStatus = "OFFLINE";
                _apiStatus = "???";
                _pollStatus = "ERROR"; 
                _lastPollErr = ex.Message; 
            }
        }

        private void ProcessResponse(string json)
        {
            if (string.IsNullOrEmpty(json) || !json.Contains("\"items\"")) return;
            var itemsMatch = Regex.Match(json, "\"items\"\\s*:\\s*\\[(.*?)\\]", RegexOptions.Singleline);
            if (!itemsMatch.Success) return;
            var objects = Regex.Matches(itemsMatch.Groups[1].Value, "\\{(.*?)\\}", RegexOptions.Singleline);
            foreach (Match objMatch in objects) ExecuteSignal("{" + objMatch.Groups[1].Value + "}");
        }

        private void ExecuteSignal(string json)
        {
            var id = GetJsonValue(json, "sid");
            if (string.IsNullOrEmpty(id)) id = GetJsonValue(json, "signal_id");
            var leaseToken = GetJsonValue(json, "lease_token");
            var action = GetJsonValue(json, "action").ToUpper();
            var symbolCode = GetJsonValue(json, "symbol").ToUpper();
            var lots = ParseDouble(GetJsonValue(json, "volume"));

            if (string.IsNullOrEmpty(id)) return;
            if (_processedSignalIds.Contains(id)) return;
            
            Print("[Debug] Signal Received: {0} {1} (ID: {2})", action, symbolCode, id);
            
            _processedSignalIds.Add(id);
            UpdateSignalHistory(id, action + " " + symbolCode + " (PENDING)");

            BeginInvokeOnMainThread(() => {
                var symbol = Symbols.GetSymbol(symbolCode);
                
                if (symbol == null && symbolCode.Length == 6) {
                    var slashName = symbolCode.Substring(0, 3) + "/" + symbolCode.Substring(3, 3);
                    symbol = Symbols.GetSymbol(slashName);
                }

                if (symbol == null) {
                    var msg = "Symbol not found: " + symbolCode;
                    UpdateSignalHistory(id, action + " " + symbolCode + " (" + msg + ")");
                    _ = AckAsync(id, leaseToken, "REJECTED", "", msg);
                    Print("[Error] Symbol '{0}' not found in your platform.", symbolCode);
                    return;
                }
                
                symbolCode = symbol.Name; 
                
                if (action == "CLOSE") {
                    var targets = Positions.Where(p => p.SymbolName == symbolCode && (p.Comment == id || p.Label == MagicNumber.ToString())).ToList();
                    foreach (var p in targets) {
                         var cRes = ClosePosition(p);
                         if (!cRes.IsSuccessful) Print("[Error] Close failed: {0}", cRes.Error);
                    }
                    _ = AckAsync(id, leaseToken, "CLOSED", "MANUAL", "");
                    return;
                }

                if (Positions.Any(p => p.Comment == id)) {
                    UpdateSignalHistory(id, action + " " + symbolCode + " (ALREADY_OPEN)");
                    _ = AckAsync(id, leaseToken, "FILLED", "ALREADY_OPEN", "");
                    return;
                }

                var sl = ParseDouble(GetJsonValue(json, "sl"));
                var tp = ParseDouble(GetJsonValue(json, "tp"));
                var entry = ParseDouble(GetJsonValue(json, "entry"));
                var orderTypeStr = GetJsonValue(json, "order_type").ToLower();
                if (string.IsNullOrEmpty(orderTypeStr)) orderTypeStr = "market";
                
                var currentPrice = (action == "BUY") ? symbol.Ask : symbol.Bid;
                var executionPrice = (orderTypeStr == "market" || entry <= 0) ? currentPrice : entry;

                double signalRiskPct = lots; 
                double requestedRiskMoney = Account.Balance * signalRiskPct;
                double finalRiskMoney = Math.Min(MaxRiskAmount, requestedRiskMoney);
                double volumeUnits = symbol.VolumeInUnitsMin;

                if (sl > 0) {
                    double riskPerMinVolume = (Math.Abs(executionPrice - sl) / symbol.TickSize) * symbol.TickValue;
                    if (riskPerMinVolume > 0) {
                        volumeUnits = (finalRiskMoney / riskPerMinVolume) * symbol.VolumeInUnitsMin;
                        volumeUnits = symbol.NormalizeVolumeInUnits(volumeUnits, RoundingMode.Down);
                    }
                }
                else volumeUnits = symbol.QuantityToVolumeInUnits(lots);

                double maxNotional = Account.Balance * (MaxVolumePercent / 100.0);
                double maxVolumeByBalance = maxNotional / currentPrice;
                if (volumeUnits > maxVolumeByBalance) volumeUnits = symbol.NormalizeVolumeInUnits(maxVolumeByBalance, RoundingMode.Down);

                if (volumeUnits < symbol.VolumeInUnitsMin) {
                    var msg = "Volume too small: " + volumeUnits;
                    UpdateSignalHistory(id, action + " " + symbolCode + " (" + msg + ")");
                    _ = AckAsync(id, leaseToken, "REJECTED", "", msg);
                    return;
                }

                // EXTRACT PARTIAL TPs
                var rawJson = GetJsonValue(json, "raw_json");
                if (!string.IsNullOrEmpty(rawJson)) {
                    var partials = new List<PartialTP>();
                    var pMatch = Regex.Match(rawJson, "\"partial_tps\"\\s*:\\s*\\[(.*?)\\]", RegexOptions.Singleline);
                    if (pMatch.Success) {
                        var items = Regex.Matches(pMatch.Groups[1].Value, "\\{(.*?)\\}", RegexOptions.Singleline);
                        foreach (Match m in items) {
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

                double? slPips = (sl > 0) ? Math.Abs(executionPrice - sl) / symbol.PipSize : (double?)null;
                double? tpPips = (tp > 0) ? Math.Abs(executionPrice - tp) / symbol.PipSize : (double?)null;

                if (orderTypeStr == "limit") {
                    res = PlaceLimitOrder(tradeType, symbol.Name, volumeUnits, entry, label, stopLossPips: slPips, takeProfitPips: tpPips, expiration: null, comment: id);
                } else if (orderTypeStr == "stop") {
                    res = PlaceStopOrder(tradeType, symbol.Name, volumeUnits, entry, label, stopLossPips: slPips, takeProfitPips: tpPips, expiration: null, comment: id);
                } else {
                    res = ExecuteMarketOrder(tradeType, symbol.Name, volumeUnits, label, stopLossPips: slPips, takeProfitPips: tpPips, comment: id);
                }

                if (res.IsSuccessful) {
                    var ticket = (res.Position != null) ? res.Position.Id.ToString() : (res.PendingOrder != null ? res.PendingOrder.Id.ToString() : "OK");
                    UpdateSignalHistory(id, action + " " + symbolCode + " (FILLED)");
                    _ = AckAsync(id, leaseToken, (res.Position != null ? "OPEN" : "PENDING"), ticket, "", (res.Position != null ? res.Position.EntryPrice : (res.PendingOrder != null ? res.PendingOrder.TargetPrice : 0)));
                } else {
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

        private async Task SyncWithVpsAsync(string accId, double bal, double eq, double marg, string brokerName, List<string> posList, List<string> ordersList, List<string> closedList, HashSet<string> activeTicketIds, List<string> metricsList)
        {
            _syncStatus = "SYNCING";
            try
            {
                var payload = string.Format(CultureInfo.InvariantCulture, 
                    "{{\"account_id\":\"{0}\",\"balance\":{1:F2},\"equity\":{2:F2},\"margin\":{3:F2},\"broker_name\":\"{4}\",\"positions\":[{5}],\"orders\":[{6}],\"closed\":[{7}],\"symbol_metrics\":[{8}]}}",
                    accId, bal, eq, marg, brokerName, string.Join(",", posList), string.Join(",", ordersList), string.Join(",", closedList), string.Join(",", metricsList));
                var content = new StringContent(payload, Encoding.UTF8, "application/json");
                content.Headers.Add("x-api-key", EaApiKey);
                var response = await _httpClient.PostAsync(ServerBaseUrl.TrimEnd('/') + "/v2/broker/sync", content);
                
                _serverStatus = (int)response.StatusCode < 500 ? "OK" : "SERVER_ERR";
                
                if (response.IsSuccessStatusCode) {
                    _apiStatus = "OK";
                    _syncCount++; _syncStatus = "OK"; _lastSyncTime = DateTime.Now; _lastSyncErr = "None";
                    var json = await response.Content.ReadAsStringAsync();
                    ParseSyncResults(json, activeTicketIds);
                } else { 
                    _apiStatus = (response.StatusCode == HttpStatusCode.Unauthorized || response.StatusCode == HttpStatusCode.Forbidden) ? "KEY_INVALID" : "ERR_" + (int)response.StatusCode;
                    _syncStatus = "FAIL (" + (int)response.StatusCode + ")"; 
                    _lastSyncErr = await response.Content.ReadAsStringAsync();
                    if (string.IsNullOrEmpty(_lastSyncErr)) _lastSyncErr = "Server Rejected Payload";
                }
            }
            catch (Exception ex) { 
                _serverStatus = "OFFLINE";
                _apiStatus = "???";
                _syncStatus = "ERROR"; 
                _lastSyncErr = ex.Message; 
            }
        }

        private void ParseSyncResults(string json, HashSet<string> activeTicketIds)
        {
            var resList = new List<string>();
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
                    
                    if (status == "Ok" || status == "Skip") {
                        if (status == "Ok" && !activeTicketIds.Contains(ticket)) _syncedClosedTickets.Add(ticket);
                        continue;
                    }
                    var displaySid = string.IsNullOrEmpty(sid) ? "SKIP" : sid;
                    resList.Add(string.Format("{0} | {1} {2} {3} [{4}]", ticket, displaySid, act, sym, status));
                }
            }
            _lastSyncResults = resList;
        }

        private async Task AckAsync(string sid, string token, string status, string ticket, string err, double entryExec = 0)
        {
            try {
                var payload = string.Format(CultureInfo.InvariantCulture, 
                    "{{\"trade_id\":\"{0}\", \"lease_token\":\"{1}\", \"execution_status\":\"{2}\", \"broker_trade_id\":\"{3}\", \"error\":\"{4}\", \"entry_exec\":{5:F5}}}", 
                    sid, token, status, ticket, err, entryExec);
                var content = new StringContent(payload, Encoding.UTF8, "application/json");
                content.Headers.Add("x-api-key", EaApiKey);
                await _httpClient.PostAsync(ServerBaseUrl.TrimEnd('/') + "/v2/broker/ack", content);
            } catch {}
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
                if (_lastSyncErr != "None") br.AppendLine("ERR: " + (_lastSyncErr.Length > 50 ? _lastSyncErr.Substring(0, 50) : _lastSyncErr));
                
                Color syncColor = _syncStatus == "OK" ? Color.Lime : 
                                 (_syncStatus == "IDLE" || _syncStatus == "WAITING" ? Color.Gray : 
                                 (_syncStatus == "SYNCING" ? Color.Yellow : Color.Red));
                Chart.DrawStaticText("Panel_BR", br.ToString(), VerticalAlignment.Bottom, HorizontalAlignment.Right, syncColor);
            });
        }

        private string GetJsonValue(string json, string key) {
            var m = Regex.Match(json, string.Format("\"{0}\"\\s*:\\s*\"?([^,\"]*)\"?", key));
            return m.Success ? m.Groups[1].Value.Trim() : "";
        }
        private double ParseDouble(string val) { double r; return double.TryParse(val, NumberStyles.Any, CultureInfo.InvariantCulture, out r) ? r : 0; }
    }
}
