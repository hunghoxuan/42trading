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

        private string BuildVersion = "v2026.05.06 18:59 - 2fab46d";
        
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


        private HttpClient _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        private bool _isBusy = false;

        protected override void OnStart()
        {
            _httpClient.Timeout = TimeSpan.FromSeconds(30);
            Timer.Start(PollSeconds);
            Print("[Bridge] Robot Started. Version: {0}", BuildVersion);
            RefreshDebugPanel();
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

                posList.Add(string.Format(CultureInfo.InvariantCulture, 
                    "{{\"sid\":\"{0}\",\"ticket\":\"{1}\",\"symbol\":\"{2}\",\"side\":\"{3}\",\"volume\":{4:F2},\"lots\":{5:F2},\"pnl\":{6:F2},\"pips\":{7:F2},\"commission\":{8:F2},\"swap\":{9:F2},\"label\":\"{10}\"}}",
                    sid, pos.Id, pos.SymbolName, pos.TradeType.ToString().ToUpper(), 
                    double.IsNaN(pos.VolumeInUnits) ? 0 : pos.VolumeInUnits, 
                    double.IsNaN(lotsVal) ? 0 : lotsVal,
                    double.IsNaN(pos.NetProfit) ? 0 : pos.NetProfit, 
                    double.IsNaN(pos.Pips) ? 0 : pos.Pips,
                    double.IsNaN(pos.Commissions) ? 0 : pos.Commissions,
                    double.IsNaN(pos.Swap) ? 0 : pos.Swap,
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

            var metricsList = new List<string>();
            var symbolsToSync = new HashSet<string>();
            symbolsToSync.Add(Symbol.Name);
            int count = 0;
            foreach (var name in Symbols) {
                symbolsToSync.Add(name);
                if (++count >= 50) break;
            }
            foreach (var pos in Positions) symbolsToSync.Add(pos.SymbolName);
            
            foreach (var symbolName in symbolsToSync.Take(100)) {
                var s = Symbols.GetSymbol(symbolName);
                if (s == null) continue;
                
                // Use CultureInfo.InvariantCulture and check for NaN to avoid invalid JSON
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
                    await SyncWithVpsAsync(accId, balance, equity, margin, brokerName, posList, closedList, activeTicketIds, metricsList);
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
                
                // Simplified Match: Just try exact and slash variation (e.g., GBP/JPY)
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
                Print("[Info] Found matching symbol: {0}", symbolCode);
                
                if (action == "CLOSE") {
                    // Close by SID (comment) or Magic Number (label)
                    var targets = Positions.Where(p => p.SymbolName == symbolCode && (p.Comment == id || p.Label == MagicNumber.ToString())).ToList();
                    foreach (var p in targets) ClosePosition(p);
                    _ = AckAsync(id, leaseToken, "CLOSED", "MANUAL", "");
                    return;
                }

                if (Positions.Any(p => p.Comment == id))
                {
                    Print("Signal {0} already open. Skipping.", id);
                    UpdateSignalHistory(id, action + " " + symbolCode + " (ALREADY_OPEN)");
                    _ = AckAsync(id, leaseToken, "FILLED", "ALREADY_OPEN", "");
                    return;
                }

                var sl = ParseDouble(GetJsonValue(json, "sl"));
                var tp = ParseDouble(GetJsonValue(json, "tp"));
                var currentPrice = (action == "BUY") ? symbol.Ask : symbol.Bid;

                // 1. RISK CALCULATION
                double signalRiskPct = lots; 
                double requestedRiskMoney = Account.Balance * signalRiskPct;
                double finalRiskMoney = Math.Min(MaxRiskAmount, requestedRiskMoney);
                double volumeUnits = symbol.VolumeInUnitsMin;

                if (sl > 0)
                {
                    double riskPerMinVolume = (Math.Abs(currentPrice - sl) / symbol.TickSize) * symbol.TickValue;
                    if (riskPerMinVolume > 0)
                    {
                        volumeUnits = (finalRiskMoney / riskPerMinVolume) * symbol.VolumeInUnitsMin;
                        volumeUnits = symbol.NormalizeVolumeInUnits(volumeUnits, RoundingMode.Down);
                    }
                }
                else volumeUnits = symbol.QuantityToVolumeInUnits(lots);

                // 2. CAP VOLUME
                double maxNotional = Account.Balance * (MaxVolumePercent / 100.0);
                double maxVolumeByBalance = maxNotional / currentPrice;
                if (volumeUnits > maxVolumeByBalance) volumeUnits = symbol.NormalizeVolumeInUnits(maxVolumeByBalance, RoundingMode.Down);

                if (volumeUnits < symbol.VolumeInUnitsMin)
                {
                    var msg = string.Format("Rejected: vol {0} < min {1}", volumeUnits, symbol.VolumeInUnitsMin);
                    UpdateSignalHistory(id, action + " " + symbolCode + " (" + msg + ")");
                    _ = AckAsync(id, leaseToken, "REJECTED", "", msg);
                    return;
                }

                // Construct new-style label: {Source}_{EntryModel}
                var sourceId = GetJsonValue(json, "source_id");
                var entryModel = GetJsonValue(json, "entry_model");
                if (string.IsNullOrEmpty(entryModel)) entryModel = GetJsonValue(json, "strategy");
                
                string label = MagicNumber.ToString();
                if (!string.IsNullOrEmpty(sourceId) && !string.IsNullOrEmpty(entryModel))
                    label = string.Format("{0}_{1}", sourceId, entryModel);

                var res = ExecuteMarketOrder(action == "BUY" ? TradeType.Buy : TradeType.Sell, symbol.Name, volumeUnits, label, sl, tp, id);
                if (res.IsSuccessful) {
                    UpdateSignalHistory(id, action + " " + symbolCode + " (FILLED)");
                    _ = AckAsync(id, leaseToken, "FILLED", res.Position.Id.ToString(), "");
                } else {
                    UpdateSignalHistory(id, action + " " + symbolCode + " (ERR: " + res.Error + ")");
                    _ = AckAsync(id, leaseToken, "ERROR", "", res.Error.ToString());
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

        private async Task SyncWithVpsAsync(string accId, double bal, double eq, double marg, string brokerName, List<string> posList, List<string> closedList, HashSet<string> activeTicketIds, List<string> metricsList)
        {
            _syncStatus = "SYNCING";
            try
            {
                var payload = string.Format(CultureInfo.InvariantCulture, 
                    "{{\"account_id\":\"{0}\",\"balance\":{1:F2},\"equity\":{2:F2},\"margin\":{3:F2},\"broker_name\":\"{4}\",\"positions\":[{5}],\"orders\":[],\"closed\":[{6}],\"symbol_metrics\":[{7}]}}",
                    accId, bal, eq, marg, brokerName, string.Join(",", posList), string.Join(",", closedList), string.Join(",", metricsList));
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

        private async Task AckAsync(string sid, string token, string status, string ticket, string err)
        {
            try {
                var payload = string.Format("{{\"trade_id\":\"{0}\", \"lease_token\":\"{1}\", \"status\":\"{2}\", \"ticket\":\"{3}\", \"error\":\"{4}\"}}", sid, token, status, ticket, err);
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
