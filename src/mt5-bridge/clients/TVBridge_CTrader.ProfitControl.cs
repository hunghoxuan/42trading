using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using cAlgo.API;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    public partial class TVBridgeCBot
    {
        private sealed class ProfitBasketMember
        {
            public double BaselineNet, BaselineClosedVolume, TotalVolume, LastVolume;
        }

        private readonly Dictionary<long, ProfitBasketMember> _profitBasket = new Dictionary<long, ProfitBasketMember>();
        private Dictionary<long, double> _profitHistoryNet = new Dictionary<long, double>();
        private Dictionary<long, double> _profitHistoryVolume = new Dictionary<long, double>();
        private int _profitHistoryCount = -1;
        private double _profitBasketBalance, _profitBasketPeak, _profitBasketPnl, _profitFloatingPnl;
        private bool _profitLockArmed, _profitClosing, _profitStateLoaded, _profitControlBusy, _profitStateRestored;
        private string _profitControlError = "", _profitClosingReason = "", _profitLastSaved = "";
        private DateTime _profitStateFlushUtc = DateTime.MinValue;
        private DateTime _profitResumeAfter = DateTime.MinValue, _profitLastFlatten = DateTime.MinValue;
        private DateTime _profitWarningUtc = DateTime.MinValue;

        private bool IsProfitControlEnabled => ProfitLockStartPreset != ProfitLockPercentPreset.None;

        private double ResolveProfitLockPresetAmount(ProfitLockPercentPreset preset, double balance)
        {
            switch (preset)
            {
                case ProfitLockPercentPreset._25pct: return balance > 0 ? balance * 0.25 : 0;
                case ProfitLockPercentPreset._30pct: return balance > 0 ? balance * 0.30 : 0;
                default: return ResolveRiskLimitPresetAmount((RiskLimitPreset)(int)preset, balance);
            }
        }

        private void ValidateProfitLockSettings()
        {
            if (!Enum.IsDefined(typeof(ProfitLockPercentPreset), ProfitLockStartPreset) ||
                !Enum.IsDefined(typeof(ProfitGivebackPercentPreset), ProfitGivebackPreset))
                throw new InvalidOperationException("Profit Lock and Profit Giveback require percentage selections; reselect any retired currency preset");
        }

        private void ResetProfitControlRuntime()
        {
            _profitBasket.Clear();
            _profitHistoryNet.Clear(); _profitHistoryVolume.Clear(); _profitHistoryCount = -1;
            _profitBasketBalance = _profitBasketPeak = _profitBasketPnl = _profitFloatingPnl = 0;
            _profitLockArmed = _profitClosing = _profitStateLoaded = _profitControlBusy = _profitStateRestored = false;
            _profitControlError = _profitClosingReason = _profitLastSaved = "";
            _profitStateFlushUtc = _profitResumeAfter = _profitLastFlatten = _profitWarningUtc = DateTime.MinValue;
        }

        private string ProfitControlStorageKey() => "Account Profit Control v1 " +
            BuildStableBase62Token(Account.BrokerName + ":" + Account.Number.ToString(CultureInfo.InvariantCulture), 12);

        private void LoadProfitControlState()
        {
            if (_profitStateLoaded) return;
            if (!IsBacktestingRuntime())
            {
                var raw = LocalStorage.GetString(ProfitControlStorageKey(), LocalStorageScope.Instance);
                if (!string.IsNullOrWhiteSpace(raw))
                {
                    var lines = raw.Split('\n'); var h = lines[0].Split('\t');
                    if (h.Length != 6 || h[0] != "PC1") throw new InvalidOperationException("Invalid profit-control state");
                    var balance = ParseProfitNumber(h[1]); var peak = ParseProfitNumber(h[2]);
                    if (balance < 0 || peak < 0 || (h[3] != "0" && h[3] != "1") ||
                        (h[4] != "0" && h[4] != "1")) throw new InvalidOperationException("Invalid profit-control anchor");
                    var members = new Dictionary<long, ProfitBasketMember>();
                    foreach (var line in lines.Skip(1).Where(line => line.Length > 0))
                    {
                        var p = line.Split('\t');
                        if (p.Length != 5) throw new InvalidOperationException("Invalid basket member");
                        var id = long.Parse(p[0], CultureInfo.InvariantCulture);
                        var member = new ProfitBasketMember { BaselineNet = ParseProfitNumber(p[1]),
                            BaselineClosedVolume = ParseProfitNumber(p[2]), TotalVolume = ParseProfitNumber(p[3]),
                            LastVolume = ParseProfitNumber(p[4]) };
                        if (id <= 0 || member.BaselineClosedVolume < 0 || member.TotalVolume <= 0 || member.LastVolume < 0)
                            throw new InvalidOperationException("Invalid basket member values");
                        members.Add(id, member);
                    }
                    _profitBasket.Clear(); foreach (var p in members) _profitBasket.Add(p.Key, p.Value);
                    _profitBasketBalance = balance; _profitBasketPeak = peak;
                    _profitLockArmed = h[3] == "1"; _profitClosing = h[4] == "1"; _profitClosingReason = h[5];
                    _profitLastSaved = raw;
                    _profitStateRestored = true;
                }
            }
            _profitStateLoaded = true;
        }

        private static double ParseProfitNumber(string text)
        {
            double number;
            if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out number) ||
                double.IsNaN(number) || double.IsInfinity(number)) throw new InvalidOperationException("Invalid basket number");
            return number;
        }

        private void SaveProfitControlState(bool force = false)
        {
            if (!_profitStateLoaded || IsBacktestingRuntime()) return;
            Func<double, string> number = value => value.ToString("R", CultureInfo.InvariantCulture);
            var raw = string.Join("\t", "PC1", number(_profitBasketBalance), number(_profitBasketPeak),
                _profitLockArmed ? "1" : "0", _profitClosing ? "1" : "0", _profitClosingReason) + "\n" +
                string.Join("\n", _profitBasket.OrderBy(p => p.Key).Select(p => string.Join("\t",
                    p.Key.ToString(CultureInfo.InvariantCulture), number(p.Value.BaselineNet),
                    number(p.Value.BaselineClosedVolume), number(p.Value.TotalVolume), number(p.Value.LastVolume))));
            if (!force && raw == _profitLastSaved) return;
            LocalStorage.SetString(ProfitControlStorageKey(), raw, LocalStorageScope.Instance);
            if (force || (DateTime.UtcNow - _profitStateFlushUtc).TotalSeconds >= 5)
            {
                LocalStorage.Flush(LocalStorageScope.Instance);
                _profitStateFlushUtc = DateTime.UtcNow; _profitLastSaved = raw;
            }
        }

        private void RefreshProfitHistory()
        {
            if (History == null) throw new InvalidOperationException("Basket trade history unavailable");
            if (History.Count == _profitHistoryCount) return;
            var net = new Dictionary<long, double>(); var volume = new Dictionary<long, double>();
            foreach (var deal in History)
            {
                if (deal == null) continue;
                if (!IsFiniteNumber(deal.NetProfit) || !IsFiniteNumber(deal.VolumeInUnits))
                    throw new InvalidOperationException("Nonfinite basket trade history");
                double previous; net.TryGetValue(deal.PositionId, out previous); net[deal.PositionId] = previous + deal.NetProfit;
                volume.TryGetValue(deal.PositionId, out previous); volume[deal.PositionId] = previous + deal.VolumeInUnits;
            }
            _profitHistoryNet = net; _profitHistoryVolume = volume; _profitHistoryCount = History.Count;
        }

        private double ProfitHistoryValue(Dictionary<long, double> values, long id)
        {
            double value; return values.TryGetValue(id, out value) ? value : 0;
        }

        private void ObserveProfitBasket(List<Position> positions)
        {
            RefreshProfitHistory();
            // If the old basket finished while offline, a completely different set of
            // live positions starts a new cycle instead of inheriting its profit peak.
            if (_profitStateRestored)
            {
                if (!positions.Any(p => _profitBasket.ContainsKey(p.Id))) _profitBasket.Clear();
                _profitStateRestored = false;
            }
            if (_profitBasket.Count == 0)
            {
                if (!IsFiniteNumber(Account.Balance) || Account.Balance < 0)
                    throw new InvalidOperationException("Basket balance anchor unavailable");
                _profitBasketBalance = Account.Balance;
                _profitBasketPeak = 0; _profitLockArmed = false;
            }
            _profitFloatingPnl = 0;
            var volumes = new Dictionary<long, double>();
            foreach (var position in positions)
            {
                if (!IsFiniteNumber(position.NetProfit) || !IsFiniteNumber(position.VolumeInUnits))
                    throw new InvalidOperationException("Basket position state unavailable");
                _profitFloatingPnl += position.NetProfit; volumes[position.Id] = position.VolumeInUnits;
                ProfitBasketMember member;
                if (!_profitBasket.TryGetValue(position.Id, out member))
                {
                    member = new ProfitBasketMember { BaselineNet = ProfitHistoryValue(_profitHistoryNet, position.Id),
                        BaselineClosedVolume = ProfitHistoryValue(_profitHistoryVolume, position.Id),
                        TotalVolume = position.VolumeInUnits, LastVolume = position.VolumeInUnits };
                    _profitBasket.Add(position.Id, member);
                }
                else if (position.VolumeInUnits > member.LastVolume)
                    member.TotalVolume += position.VolumeInUnits - member.LastVolume;
                member.LastVolume = position.VolumeInUnits;
            }
            var realized = 0.0;
            foreach (var p in _profitBasket)
            {
                var closedVolume = ProfitHistoryValue(_profitHistoryVolume, p.Key) - p.Value.BaselineClosedVolume;
                double remaining; volumes.TryGetValue(p.Key, out remaining);
                // A partial close can update live position volume before History. Wait for
                // its realized result rather than interpreting the missing float as giveback.
                if (closedVolume + remaining < p.Value.TotalVolume - 1e-7)
                    throw new InvalidOperationException("Basket close history is settling");
                realized += ProfitHistoryValue(_profitHistoryNet, p.Key) - p.Value.BaselineNet;
            }
            _profitBasketPnl = realized + _profitFloatingPnl;
            _profitBasketPeak = Math.Max(_profitBasketPeak, _profitBasketPnl);
        }

        private void OnProfitControlPositionOpened(PositionOpenedEventArgs args)
        {
            EnforceMaxTotalWin("POSITION_OPENED");
            if (!IsProfitControlEnabled || _profitControlBusy || _profitClosing) return;
            // Capture before a same-tick ladder action can partially close the new trade.
            EnforceProfitControl("POSITION_OPENED");
        }

        private void OnProfitControlPositionClosed()
        {
            EnforceMaxTotalWin("POSITION_CLOSED");
            if (!IsProfitControlEnabled || _profitControlBusy || _profitClosing || !_profitStateLoaded || Positions.Count != 0)
                return;
            // A naturally closed basket must finish before an SL reversal or another
            // strategy opens its next position during this same event dispatch.
            _profitBasket.Clear(); _profitBasketBalance = _profitBasketPeak = _profitBasketPnl = _profitFloatingPnl = 0;
            _profitLockArmed = false;
            try { SaveProfitControlState(true); } catch (Exception ex) { ReportProfitControlError(ex.Message); }
        }

        private void AddProfitControlDashboardLines(List<string> lines)
        {
            if (MaxTotalWinPreset != TotalWinPreset.None)
                lines.Add(string.Format(CultureInfo.InvariantCulture,
                    "Max Total Win: {0}; original={1:F2}; net={2:F2}; stopped ideas={3}{4}",
                    MaxTotalWinPreset, _totalWinOriginalBalance, _totalWinNet,
                    _totalWinStoppedIdeas.Count, _totalWinError.Length > 0 ? "; WAIT: " + _totalWinError : ""));
            if (!IsProfitControlEnabled && !_profitClosing) return;
            lines.Add(string.Format(CultureInfo.InvariantCulture, "Profit Lock: {0}; lock={4}; giveback={5}; open={1:F2}; basket={2:F2}; peak={3:F2}",
                _profitClosing ? "CLOSING" : _profitLockArmed ? "LOCK ACTIVE" : "WATCHING",
                _profitFloatingPnl, _profitBasketPnl, _profitBasketPeak,
                ProfitLockStartPreset, ProfitGivebackPreset));
            if (_profitControlError.Length > 0) lines.Add("Profit Control waiting: " + _profitControlError);
        }

        private bool BlockProfitControlEntry(string context)
        {
            if (EnforceMaxTotalWin(context) || _totalWinError.Length > 0) return true;
            if (!IsProfitControlEnabled && !_profitClosing) return false;
            return EnforceProfitControl(context) || _profitControlError.Length > 0;
        }

        private bool EnforceProfitControl(string context)
        {
            if (EnforceMaxTotalWin(context)) return true;
            if (!IsProfitControlEnabled && !_profitClosing) return false;
            if (_profitControlBusy) return _profitClosing;
            // Existing mandatory account/daily limits have priority. Profit exits do not
            // depend on Rules Profile and never set the account-stop flag themselves.
            if (EnforceAccountRiskRulesIfNeeded("PROFIT_" + context)) return true;
            _profitControlBusy = true;
            try
            {
                LoadProfitControlState();
                var positions = Positions.Where(p => p != null).ToList();
                var now = GetStrategySchedulerClockUtc();
                if (_profitClosing) return FlattenProfitBasket(positions, now);
                if (now <= _profitResumeAfter) return true;
                ValidateProfitLockSettings();
                if (positions.Count == 0)
                {
                    _profitBasket.Clear(); _profitBasketBalance = _profitBasketPeak = _profitBasketPnl = _profitFloatingPnl = 0;
                    _profitLockArmed = false; _profitControlError = ""; SaveProfitControlState(); return false;
                }
                ObserveProfitBasket(positions);
                // Both choices are validated percentage-only values with stable legacy IDs.
                // Keep the basket-start balance fixed through partial closes and deposits.
                var start = ResolveProfitLockPresetAmount(ProfitLockStartPreset, _profitBasketBalance);
                var gap = ResolveRiskLimitPresetAmount((RiskLimitPreset)(int)ProfitGivebackPreset, _profitBasketBalance);
                if (start > 0 && _profitBasketPnl >= start) _profitLockArmed = true;
                // Zero giveback is the immediate profit target. A positive distance trails
                // the observed basket peak after the lock arms. Both use the same net PnL.
                var hit = start > 0 && gap == 0 && _profitBasketPnl >= start ? "profit_lock_target"
                    : _profitLockArmed && gap > 0 && _profitBasketPnl <= _profitBasketPeak - gap ? "profit_giveback" : "";
                _profitControlError = "";
                if (hit.Length > 0)
                {
                    _profitClosing = true; _profitClosingReason = hit;
                    PrintAlways("[ProfitControl][EXIT] reason={0} context={1} floating={2:F2} basket={3:F2} peak={4:F2} lock={5:F2} giveback={6:F2}; action=close_account_basket",
                        hit, context, _profitFloatingPnl, _profitBasketPnl, _profitBasketPeak, start, gap);
                    // Persist the latched exit before broker actions; failures still unwind
                    // the account and are retried rather than forgetting the trigger.
                    try { SaveProfitControlState(true); } catch (Exception ex) { ReportProfitControlError(ex.Message); }
                    return FlattenProfitBasket(positions, now);
                }
                SaveProfitControlState(); return false;
            }
            catch (Exception ex)
            {
                ReportProfitControlError(ex.Message);
                // Keep per-position SL management running while new entries are blocked.
                return _profitClosing;
            }
            finally { _profitControlBusy = false; }
        }

        private void ReportProfitControlError(string message)
        {
            if (message != _profitControlError || (DateTime.UtcNow - _profitWarningUtc).TotalSeconds >= 30)
            {
                _profitWarningUtc = DateTime.UtcNow;
                PrintAlways("[ProfitControl][WAIT] {0}; new_entries=blocked", message);
            }
            _profitControlError = message;
        }

        // Lifetime profit targets have their own anchor and sticky completion state.
        // They must not reset with the daily clock or with a flat profit-control basket.
        private double _totalWinOriginalBalance, _totalWinNet;
        private DateTime _totalWinStartUtc = DateTime.MinValue;
        private DateTime _totalWinLastFlattenUtc = DateTime.MinValue;
        private int _totalWinLastFlattenScopeCount = -1;
        private bool _totalWinLoaded, _totalWinAllStopped, _totalWinBusy;
        private string _totalWinError = "";
        private int _totalWinHistoryCount = -1;
        private double _totalWinClosedNet;
        private readonly Dictionary<string, double> _totalWinClosedByIdea = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _totalWinStoppedIdeas = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<long, double> _totalWinClosedVolume = new Dictionary<long, double>();
        private readonly Dictionary<long, double> _totalWinTrackedVolume = new Dictionary<long, double>();
        private readonly Dictionary<long, double> _totalWinLastOpenVolume = new Dictionary<long, double>();

        private void ResetMaxTotalWinRuntime()
        {
            _totalWinOriginalBalance = _totalWinNet = _totalWinClosedNet = 0;
            _totalWinStartUtc = DateTime.MinValue;
            _totalWinLastFlattenUtc = DateTime.MinValue; _totalWinLastFlattenScopeCount = -1;
            _totalWinLoaded = _totalWinAllStopped = _totalWinBusy = false;
            _totalWinHistoryCount = -1; _totalWinError = "";
            _totalWinStoppedIdeas.Clear(); _totalWinClosedByIdea.Clear();
            _totalWinClosedVolume.Clear(); _totalWinTrackedVolume.Clear();
            _totalWinLastOpenVolume.Clear();
        }

        private bool IsIdeaTotalWin => MaxTotalWinPreset.ToString().StartsWith("Idea_", StringComparison.Ordinal);

        private double MaxTotalWinPercent()
        {
            if (!Enum.IsDefined(typeof(TotalWinPreset), MaxTotalWinPreset))
                throw new InvalidOperationException("Unknown Max Total Win selection");
            var value = (int)MaxTotalWinPreset;
            return IsIdeaTotalWin ? value - 100 : value;
        }

        private string TotalWinStorageKey() => "Max Total Win v1 " +
            BuildStableBase62Token(Account.BrokerName + ":" + Account.Number.ToString(CultureInfo.InvariantCulture), 12);

        private void InitializeMaxTotalWin()
        {
            if (MaxTotalWinPreset == TotalWinPreset.None || _totalWinLoaded) return;
            try
            {
                MaxTotalWinPercent();
                var raw = IsBacktestingRuntime() ? null : LocalStorage.GetString(TotalWinStorageKey(), LocalStorageScope.Instance);
                if (!string.IsNullOrWhiteSpace(raw))
                {
                    var parts = raw.Split('\n'); var header = parts[0].Split('\t');
                    long ticks;
                    if (header.Length != 4 || (header[0] != "TW1" && header[0] != "TW2") ||
                        !long.TryParse(header[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out ticks) ||
                        (header[3] != "0" && header[3] != "1"))
                        throw new InvalidOperationException("Invalid Max Total Win state");
                    var balance = ParseProfitNumber(header[1]);
                    var start = new DateTime(ticks, DateTimeKind.Utc);
                    if (!(balance > 0) || start == DateTime.MinValue || start > GetStrategySchedulerClockUtc())
                        throw new InvalidOperationException("Invalid Max Total Win anchor");
                    var ideas = new List<string>(); var volumes = new Dictionary<long, double>();
                    var lastVolumes = new Dictionary<long, double>();
                    foreach (var line in parts.Skip(1).Where(p => p.Length > 0))
                    {
                        var item = line.Split('\t'); long id;
                        if (item.Length == 2 && item[0] == "I")
                        {
                            var idea = Uri.UnescapeDataString(item[1]);
                            if (idea.Split('|').Length != (header[0] == "TW1" ? 2 : 3))
                                throw new InvalidOperationException("Invalid stopped idea");
                            // Old symbol/TF totals combined multiple strategies. Preserve the
                            // lifetime anchor, but rebuild individual targets from trade history.
                            if (header[0] == "TW2") ideas.Add(idea);
                        }
                        else if (item.Length == 4 && item[0] == "V" && long.TryParse(item[1], out id) && id > 0)
                        {
                            var volume = ParseProfitNumber(item[2]);
                            var lastVolume = ParseProfitNumber(item[3]);
                            if (!(volume > 0) || lastVolume < 0 || lastVolume > volume)
                                throw new InvalidOperationException("Invalid tracked total volume");
                            volumes.Add(id, volume);
                            lastVolumes.Add(id, lastVolume);
                        }
                        else throw new InvalidOperationException("Invalid Max Total Win member");
                    }
                    _totalWinOriginalBalance = balance; _totalWinStartUtc = start;
                    _totalWinAllStopped = header[3] == "1";
                    foreach (var idea in ideas) _totalWinStoppedIdeas.Add(idea);
                    foreach (var item in volumes) _totalWinTrackedVolume.Add(item.Key, item.Value);
                    foreach (var item in lastVolumes) _totalWinLastOpenVolume.Add(item.Key, item.Value);
                    if (header[0] == "TW1")
                        PrintAlways("[MaxTotalWin][MIGRATE] idea_scope=strategy_symbol_tf; original balance and start retained; strategy totals rebuilt from history");
                }
                else
                {
                    var balance = Account.Balance;
                    if (!IsFiniteNumber(balance) || !(balance > 0))
                        throw new InvalidOperationException("Original balance unavailable for Max Total Win");
                    _totalWinOriginalBalance = balance;
                    _totalWinStartUtc = GetStrategySchedulerClockUtc();
                }
                _totalWinLoaded = true;
                SaveMaxTotalWinState();
                _totalWinError = "";
            }
            catch (Exception ex) { ReportMaxTotalWinError(ex.Message); }
        }

        private void SaveMaxTotalWinState()
        {
            if (!_totalWinLoaded || IsBacktestingRuntime()) return;
            var raw = string.Join("\t", "TW2", _totalWinOriginalBalance.ToString("R", CultureInfo.InvariantCulture),
                _totalWinStartUtc.Ticks.ToString(CultureInfo.InvariantCulture), _totalWinAllStopped ? "1" : "0") + "\n" +
                string.Join("\n", _totalWinStoppedIdeas.OrderBy(p => p, StringComparer.OrdinalIgnoreCase).Select(p => "I\t" + Uri.EscapeDataString(p))) + "\n" +
                string.Join("\n", _totalWinTrackedVolume.OrderBy(p => p.Key).Select(p => "V\t" +
                    p.Key.ToString(CultureInfo.InvariantCulture) + "\t" + p.Value.ToString("R", CultureInfo.InvariantCulture) + "\t" +
                    _totalWinLastOpenVolume[p.Key].ToString("R", CultureInfo.InvariantCulture)));
            LocalStorage.SetString(TotalWinStorageKey(), raw, LocalStorageScope.Instance);
            LocalStorage.Flush(LocalStorageScope.Instance);
        }

        private void ReportMaxTotalWinError(string message)
        {
            if (_totalWinError != message)
                PrintAlways("[MaxTotalWin][WAIT] {0}; new_entries=blocked", message);
            _totalWinError = message;
        }

        private string TotalWinIdeaKey(string strategyId, string symbolName, TimeFrame frame) =>
            string.IsNullOrWhiteSpace(strategyId) || string.IsNullOrWhiteSpace(symbolName) || frame == null ? "" :
                Uri.EscapeDataString(strategyId.Trim().ToLowerInvariant()) + "|" +
                Uri.EscapeDataString(symbolName.Trim().ToUpperInvariant()) + "|" +
                GetTimeFrameShortLabel(frame).ToLowerInvariant();

        private string ResolveTotalWinIdeaKey(string symbolName, string label, string comment)
        {
            var strategyId = ExtractStrategyIdFromOrderLabel(label);
            if (string.IsNullOrWhiteSpace(strategyId)) return "";
            var tokens = (comment ?? "").Split('|');
            TimeFrame frame;
            // Use the producer's shared comment contract: ordinary B/S, flipped,
            // reduced/increased-risk variants and legacy event-first comments.
            // An HTF confluence or SL source never owns the entry timeframe.
            var primary = GetStrategyCommentEventLabel(comment);
            if (TryResolveStrategyTriggerTimeFrame(primary, out frame)) return TotalWinIdeaKey(strategyId, symbolName, frame);
            foreach (var token in tokens)
                if (token.StartsWith("tf:", StringComparison.OrdinalIgnoreCase) &&
                    TryParseTimeFrameToken(token.Substring(3), out frame)) return TotalWinIdeaKey(strategyId, symbolName, frame);
            if (TryResolveTradeAuditTimeFrame(label, "", out frame)) return TotalWinIdeaKey(strategyId, symbolName, frame);
            return ""; // Unknown/manual TF is not assigned to the attached chart's idea.
        }

        private void RefreshTotalWinHistory()
        {
            if (History == null) throw new InvalidOperationException("Max Total Win history unavailable");
            if (_totalWinHistoryCount == History.Count) return;
            var net = 0.0; var ideas = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
            var volumes = new Dictionary<long, double>();
            foreach (var deal in History)
            {
                // HistoricalTrade timestamps use the cBot's UTC clock, including
                // DateTimeKind.Unspecified. Machine-local conversion can exclude the
                // first closed trades and leave volume reconciliation waiting forever.
                if (deal == null || NormalizeBotTimeToUtc(deal.ClosingTime) < _totalWinStartUtc) continue;
                if (!IsFiniteNumber(deal.NetProfit) || !IsFiniteNumber(deal.VolumeInUnits))
                    throw new InvalidOperationException("Invalid total profit history");
                net += deal.NetProfit;
                double volume; volumes.TryGetValue(deal.PositionId, out volume); volumes[deal.PositionId] = volume + deal.VolumeInUnits;
                var key = ResolveTotalWinIdeaKey(deal.SymbolName, deal.Label, deal.Comment);
                if (key.Length > 0)
                {
                    double previous; ideas.TryGetValue(key, out previous); ideas[key] = previous + deal.NetProfit;
                }
            }
            _totalWinClosedNet = net;
            _totalWinClosedByIdea.Clear(); foreach (var item in ideas) _totalWinClosedByIdea.Add(item.Key, item.Value);
            _totalWinClosedVolume.Clear(); foreach (var item in volumes) _totalWinClosedVolume.Add(item.Key, item.Value);
            _totalWinHistoryCount = History.Count;
        }

        private bool BlockMaxTotalWinIdea(string strategyId, string symbolName, TimeFrame frame)
        {
            if (MaxTotalWinPreset == TotalWinPreset.None) return false;
            if (EnforceMaxTotalWin("IDEA_ENTRY") || _totalWinError.Length > 0) return true;
            if (!IsIdeaTotalWin) return false;
            var key = TotalWinIdeaKey(strategyId, symbolName, frame);
            return key.Length == 0 || _totalWinStoppedIdeas.Contains(key);
        }

        private bool BlockMaxTotalWinIdeaEntry(string symbolName, string label, string comment)
        {
            if (!IsIdeaTotalWin) return false;
            var key = ResolveTotalWinIdeaKey(symbolName, label, comment);
            // An unidentifiable order must not bypass an enabled per-idea limit.
            if (key.Length == 0)
            {
                PrintAlways("[MaxTotalWin][REJECT] symbol={0}; strategy_or_source_timeframe_missing", symbolName);
                return true;
            }
            return _totalWinStoppedIdeas.Contains(key);
        }

        private bool EnforceMaxTotalWin(string context)
        {
            if (MaxTotalWinPreset == TotalWinPreset.None) return false;
            if (_totalWinBusy) return _totalWinAllStopped && !IsIdeaTotalWin;
            if (EnforceAccountRiskRulesIfNeeded("TOTAL_WIN_" + context)) return true;
            _totalWinBusy = true;
            try
            {
                InitializeMaxTotalWin();
                if (!_totalWinLoaded) return false;
                // Retry a failed initial state flush instead of silently enabling entries.
                if (_totalWinError.Length > 0) SaveMaxTotalWinState();
                // Once hit, retry the latched exit without depending on another P&L
                // snapshot. History can lag broker closures or be temporarily unavailable.
                if (!IsIdeaTotalWin && _totalWinAllStopped)
                { _totalWinError = ""; return FlattenMaxTotalWin(true, context); }
                if (IsIdeaTotalWin && _totalWinStoppedIdeas.Count > 0)
                    FlattenMaxTotalWin(false, context);
                RefreshTotalWinHistory();
                var positions = Positions.Where(p => p != null).ToList();
                var stateChanged = false;
                var remaining = positions.ToDictionary(p => (long)p.Id, p => p.VolumeInUnits);
                foreach (var p in positions)
                {
                    if (!IsFiniteNumber(p.VolumeInUnits) || !(p.VolumeInUnits > 0))
                        throw new InvalidOperationException("Invalid total profit position volume");
                    double closed; _totalWinClosedVolume.TryGetValue(p.Id, out closed);
                    double previous;
                    if (!_totalWinTrackedVolume.TryGetValue(p.Id, out previous))
                    { _totalWinTrackedVolume[p.Id] = p.VolumeInUnits + closed; stateChanged = true; }
                    else if (p.VolumeInUnits > _totalWinLastOpenVolume[p.Id])
                    {
                        _totalWinTrackedVolume[p.Id] = previous + p.VolumeInUnits - _totalWinLastOpenVolume[p.Id];
                        stateChanged = true;
                    }
                    if (!_totalWinLastOpenVolume.ContainsKey(p.Id) || _totalWinLastOpenVolume[p.Id] != p.VolumeInUnits)
                    { _totalWinLastOpenVolume[p.Id] = p.VolumeInUnits; stateChanged = true; }
                }
                foreach (var item in _totalWinTrackedVolume.ToList())
                {
                    double open, closed; remaining.TryGetValue(item.Key, out open); _totalWinClosedVolume.TryGetValue(item.Key, out closed);
                    if (Math.Abs(open + closed - item.Value) > 1e-7)
                        throw new InvalidOperationException("Max Total Win close history is settling");
                    if (open == 0)
                    { _totalWinTrackedVolume.Remove(item.Key); _totalWinLastOpenVolume.Remove(item.Key); stateChanged = true; }
                }
                if (stateChanged) SaveMaxTotalWinState();
                var ideas = new Dictionary<string, double>(_totalWinClosedByIdea, StringComparer.OrdinalIgnoreCase);
                _totalWinNet = _totalWinClosedNet;
                foreach (var p in positions)
                {
                    if (!IsFiniteNumber(p.NetProfit)) throw new InvalidOperationException("Invalid open total profit");
                    _totalWinNet += p.NetProfit;
                    var key = ResolveTotalWinIdeaKey(p.SymbolName, p.Label, p.Comment);
                    if (key.Length > 0)
                    {
                        double previous; ideas.TryGetValue(key, out previous); ideas[key] = previous + p.NetProfit;
                    }
                }
                var limit = _totalWinOriginalBalance * MaxTotalWinPercent() / 100.0;
                if (!IsIdeaTotalWin && !_totalWinAllStopped && _totalWinNet >= limit)
                {
                    _totalWinAllStopped = true;
                    SaveMaxTotalWinState();
                    PrintAlways("[MaxTotalWin][HIT] preset={0}; net={1:F2}; limit={2:F2}; original={3:F2}; action=close_all_stop_bot",
                        MaxTotalWinPreset, _totalWinNet, limit, _totalWinOriginalBalance);
                }
                if (IsIdeaTotalWin)
                    foreach (var item in ideas.Where(p => p.Value >= limit))
                        if (_totalWinStoppedIdeas.Add(item.Key))
                        {
                            SaveMaxTotalWinState();
                            PrintAlways("[MaxTotalWin][HIT] preset={0}; idea={1}; net={2:F2}; limit={3:F2}; action=close_stop_idea",
                                MaxTotalWinPreset, item.Key, item.Value, limit);
                        }
                _totalWinError = "";
                var all = !IsIdeaTotalWin && _totalWinAllStopped;
                if (!all && (!IsIdeaTotalWin || _totalWinStoppedIdeas.Count == 0)) return false;
                return FlattenMaxTotalWin(all, context);
            }
            catch (Exception ex) { ReportMaxTotalWinError(ex.Message); return _totalWinAllStopped && !IsIdeaTotalWin; }
            finally { _totalWinBusy = false; }
        }

        private bool FlattenMaxTotalWin(bool all, string context)
        {
            var now = GetStrategySchedulerClockUtc();
            var scopeCount = all ? -2 : _totalWinStoppedIdeas.Count;
            if (now == _totalWinLastFlattenUtc && scopeCount == _totalWinLastFlattenScopeCount) return all;
            _totalWinLastFlattenUtc = now; _totalWinLastFlattenScopeCount = scopeCount;
            var positions = Positions.Where(p => p != null).ToList();
            foreach (var pending in _pendingStrategyEntries.ToList())
                    if (all || _totalWinStoppedIdeas.Contains(TotalWinIdeaKey(pending.Value.Signal.StrategyId,
                        pending.Value.SymbolName, pending.Value.Signal.SourceTimeFrame)))
                    FinalizeWaitConfirmQueueEntry(pending.Key, "CANCELLED");
            var failures = 0;
            foreach (var order in PendingOrders.ToList())
                if (all || _totalWinStoppedIdeas.Contains(ResolveTotalWinIdeaKey(order.SymbolName, order.Label, order.Comment)))
                {
                    try { var result = CancelPendingOrder(order); if (result == null || !result.IsSuccessful) failures++; }
                    catch { failures++; }
                }
            foreach (var p in positions)
                if (all || _totalWinStoppedIdeas.Contains(ResolveTotalWinIdeaKey(p.SymbolName, p.Label, p.Comment)))
                {
                    try { var result = ClosePosition(p); if (result == null || !result.IsSuccessful) failures++; }
                    catch { failures++; }
                }
            if (failures > 0) PrintAlways("[MaxTotalWin][RETRY] context={0}; failed_actions={1}", context, failures);
            if (all && failures == 0 && Positions.Count == 0 && PendingOrders.Count == 0)
                RequestBotStop("max_total_win: " + MaxTotalWinPreset + "; target_reached");
            return all;
        }

        private bool FlattenProfitBasket(List<Position> positions, DateTime now)
        {
            if (now == _profitLastFlatten) return true;
            _profitLastFlatten = now;
            // Cancel internal wait-confirm routes as well as all broker pending orders.
            foreach (var p in _pendingStrategyEntries.ToList())
            {
                FinalizeWaitConfirmQueueEntry(p.Key, "CANCELLED");
            }
            var failures = 0;
            foreach (var order in PendingOrders.ToList())
            {
                try
                {
                    var result = CancelPendingOrder(order);
                    if (result == null || !result.IsSuccessful) failures++;
                }
                catch { failures++; }
            }
            foreach (var position in positions)
            {
                try
                {
                    var result = ClosePosition(position);
                    if (result == null || !result.IsSuccessful) failures++;
                }
                catch { failures++; }
            }
            if (failures == 0 && Positions.Count == 0 && PendingOrders.Count == 0)
            {
                PrintAlways("[ProfitControl][CLOSED] reason={0}; basket complete; new trades resume on next quote", _profitClosingReason);
                _profitClosing = _profitLockArmed = false;
                _profitBasket.Clear(); _profitBasketBalance = _profitBasketPeak = _profitBasketPnl = _profitFloatingPnl = 0;
                _profitClosingReason = _profitControlError = ""; _profitResumeAfter = now;
                SaveProfitControlState(true);
            }
            else
            {
                PrintAlways("[ProfitControl][RETRY] positions={0} pending={1} failed_actions={2}", Positions.Count, PendingOrders.Count, failures);
                try { SaveProfitControlState(true); } catch (Exception ex) { ReportProfitControlError(ex.Message); }
            }
            return true;
        }
    }
}
