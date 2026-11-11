using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using cAlgo.API;

namespace cAlgo.Robots
{
    public partial class TVBridgeCBot
    {
        // One execution journal for every entry source. Market-data/event caches are
        // deliberately separate: drawing an event must never consume a trading action.
        internal enum ExecutionActionStatus { Waiting, Ready, Submitting, Accepted, Blocked, RetryableFailure, Failed }

        internal sealed class ExecutionActionState
        {
            public string Key;
            public ExecutionActionStatus Status;
            public DateTime UpdatedAtUtc;
            public long Ticket;
            public string Reason = "";
            public string PolicyKey;
            public bool BrokerAttempted;
            public bool SubmissionUncertain;
        }

        private readonly Dictionary<string, ExecutionActionState> _executionActions =
            new Dictionary<string, ExecutionActionState>(StringComparer.OrdinalIgnoreCase);
        private ExecutionActionState _activeExecutionAction;
        private const string ExecutionJournalStorageKey = "Execution Actions v2";
        private const string ExecutionPoliciesStorageKey = "Execution Policies v1";
        private const int ExecutionJournalLimit = 2000;
        private string _lastExecutionJournalSaved;

        private bool IsExecutionActionAccepted(string key)
        {
            ExecutionActionState state;
            if (_executionActions.TryGetValue(key, out state) && state.Status == ExecutionActionStatus.Accepted) return true;
            // v1 keys omitted StrategyId. Honor those records during migration only.
            var parts = (key ?? "").Split('|');
            int slot;
            if (parts.Length >= 6 && parts[0] == "GROUP" && !int.TryParse(parts[3], out slot))
                return _executionActions.TryGetValue(string.Join("|", parts.Where((p, i) => i != 3)), out state) &&
                    state.Status == ExecutionActionStatus.Accepted;
            return false;
        }

        private bool IsExecutionActionTerminal(string key)
        {
            ExecutionActionState state;
            return _executionActions.TryGetValue(key, out state) &&
                (state.Status == ExecutionActionStatus.Accepted || state.Status == ExecutionActionStatus.Blocked ||
                 state.Status == ExecutionActionStatus.Failed || state.Status == ExecutionActionStatus.Submitting);
        }

        private bool CanStartExecutionAction(ExecutionActionState state)
        {
            if (IsExecutionActionTerminal(state.Key) || IsExecutionActionAccepted(state.Key)) return false;
            if (state.Status == ExecutionActionStatus.RetryableFailure && RecoverAcceptedExecutionAction(state)) return false;
            if (state.SubmissionUncertain)
            {
                SetExecutionAction(state, ExecutionActionStatus.Failed, "interrupted_submission_outcome_unknown");
                SaveExecutionJournal();
                return false;
            }
            return true;
        }

        private ExecutionActionState GetExecutionAction(string key)
        {
            ExecutionActionState state;
            if (!_executionActions.TryGetValue(key, out state))
            {
                state = new ExecutionActionState { Key = key, Status = ExecutionActionStatus.Ready };
                _executionActions.Add(key, state);
            }
            return state;
        }

        private void SetExecutionAction(ExecutionActionState state, ExecutionActionStatus status, string reason = "", long ticket = 0)
        {
            if (state == null || (state.Status == ExecutionActionStatus.Accepted && status != ExecutionActionStatus.Accepted)) return;
            var changed = state.Status != status || state.Reason != reason || state.Ticket != ticket;
            state.Status = status;
            if (status == ExecutionActionStatus.Accepted) state.SubmissionUncertain = false;
            state.Reason = reason ?? "";
            if (ticket > 0) state.Ticket = ticket;
            state.UpdatedAtUtc = GetStrategySchedulerClockUtc();
            if (changed)
            {
                if (state.Key.StartsWith("EXITGROUP|", StringComparison.Ordinal))
                    PrintAlways("[Execution] action={0}; status={1}; ticket={2}; reason={3}", state.Key, status, state.Ticket, state.Reason);
                else
                    SafePrint("[Execution] action={0}; status={1}; ticket={2}; reason={3}", state.Key, status, state.Ticket, state.Reason);
            }
        }

        private void NoteExecutionBlock(string reason)
        {
            if (_activeExecutionAction != null && _activeExecutionAction.Status != ExecutionActionStatus.Accepted &&
                (reason != "entry_gate_rejected" || _activeExecutionAction.Reason.Length == 0))
                _activeExecutionAction.Reason = reason ?? "";
        }

        private TradeResult AutoExecuteTrade(AutoTradeRequest request)
        {
            // Strategy stages already own an action, including their split legs.
            // Bridge/legacy adapters that submit directly join the same journal here.
            if (request == null || request.Type == AutoTradeOrderType.PositionVolume || _activeExecutionAction != null)
                return AutoExecuteTradeTracked(request);
            var publicComment = string.Join("|", (request.Comment ?? "").Split('|').Where(p =>
                !p.StartsWith("owner:", StringComparison.Ordinal) && !p.StartsWith("cfg:", StringComparison.Ordinal) &&
                !p.StartsWith("action:", StringComparison.Ordinal)));
            var identity = string.Join("/", new[] { request.Label, publicComment, request.TradeType.ToString(), request.Type.ToString(),
                request.EntryPrice.ToString("R", CultureInfo.InvariantCulture), request.VolumeInUnits.ToString("R", CultureInfo.InvariantCulture),
                request.StopLossPips.HasValue ? request.StopLossPips.Value.ToString("R", CultureInfo.InvariantCulture) : "",
                request.TakeProfitPips.HasValue ? request.TakeProfitPips.Value.ToString("R", CultureInfo.InvariantCulture) : "" });
            var key = request.ExecutionActionKey ?? (request.ExecutionActionKey =
                "REQUEST|" + request.SymbolName + "|" + BuildStableBase62Token(identity, 12));
            var state = GetExecutionAction(key);
            if (!CanStartExecutionAction(state)) return null;
            var previous = _activeExecutionAction;
            _activeExecutionAction = state;
            SetExecutionAction(state, ExecutionActionStatus.Submitting);
            try { return AutoExecuteTradeTracked(request); }
            catch (Exception ex)
            {
                SetExecutionAction(state, ExecutionActionStatus.Failed, ex.GetType().Name + ":" + ex.Message);
                throw;
            }
            finally
            {
                if (state.Status == ExecutionActionStatus.Submitting)
                    SetExecutionAction(state, ExecutionActionStatus.Blocked, state.Reason.Length > 0 ? state.Reason : "broker_gate_rejected");
                _activeExecutionAction = previous;
                TrimExecutionJournal();
            }
        }

        private static bool IsRetryableBrokerFailure(string error)
        {
            // A timeout has an unknown acceptance outcome; never blindly resubmit it.
            return string.Equals(error, "TechnicalError", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(error, "Disconnected", StringComparison.OrdinalIgnoreCase);
        }

        private void RecordExecutionBrokerResult(TradeResult result)
        {
            if (_activeExecutionAction == null) return;
            if (result != null && result.IsSuccessful && (result.Position != null || result.PendingOrder != null))
            {
                SetExecutionAction(_activeExecutionAction, ExecutionActionStatus.Accepted, "broker_accepted",
                    result.Position != null ? result.Position.Id : result.PendingOrder.Id);
                SaveExecutionJournal(); // Acceptance is durable before protection/audit callbacks.
            }
            else if (result != null && !result.IsSuccessful)
            {
                var error = Convert.ToString(result.Error, CultureInfo.InvariantCulture) ?? "broker_rejected";
                _activeExecutionAction.SubmissionUncertain = error.IndexOf("Timeout", StringComparison.OrdinalIgnoreCase) >= 0;
                SetExecutionAction(_activeExecutionAction,
                    IsRetryableBrokerFailure(error) ? ExecutionActionStatus.RetryableFailure : ExecutionActionStatus.Failed, error);
                SaveExecutionJournal();
            }
        }

        private bool RecoverAcceptedExecutionAction(ExecutionActionState state)
        {
            var token = BuildStableBase62Token(state.Key, 12);
            if (Positions != null)
                foreach (var p in Positions)
                    if (p != null && IsStrategyInstanceExposure(p.Label, p.Comment, false) &&
                        ResolveTradeIdentity(p.Label, p.Comment).Token("action") == token)
                    {
                        SetExecutionAction(state, ExecutionActionStatus.Accepted, "broker_reconciled", p.Id);
                        SaveExecutionJournal(); return true;
                    }
            if (PendingOrders != null)
                foreach (var p in PendingOrders)
                    if (p != null && IsStrategyInstanceExposure(p.Label, p.Comment, false) &&
                        ResolveTradeIdentity(p.Label, p.Comment).Token("action") == token)
                    {
                        SetExecutionAction(state, ExecutionActionStatus.Accepted, "broker_reconciled", p.Id);
                        SaveExecutionJournal(); return true;
                    }
            if (History != null)
                foreach (var trade in History)
                    if (trade != null && IsStrategyInstanceExposure(trade.Label, trade.Comment, false) &&
                        ResolveTradeIdentity(trade.Label, trade.Comment).Token("action") == token)
                    {
                        SetExecutionAction(state, ExecutionActionStatus.Accepted, "history_reconciled", trade.PositionId);
                        SaveExecutionJournal(); return true;
                    }
            return false;
        }

        private void ExecuteBacktestStrategySignalStage(string symbolName, BacktestStrategySignal signal, bool requireHtfBiasConfluence)
        {
            using var strategyData = BeginStrategyData(signal.StrategyMode, signal.StrategyId);
            if (!signal.IsValid || signal.SourceTimeFrame == null) return;
            if (!string.IsNullOrWhiteSpace(signal.SymbolName)) symbolName = signal.SymbolName;
            var key = BuildStrategyTradeGroupKey(symbolName, signal);
            var state = GetExecutionAction(key);
            if (!CanStartExecutionAction(state)) return;
            var previous = _activeExecutionAction;
            _activeExecutionAction = state;
            SetExecutionAction(state, ExecutionActionStatus.Submitting);
            try { ExecuteBacktestStrategySignalStageCore(symbolName, signal, requireHtfBiasConfluence); }
            catch (Exception ex)
            {
                SetExecutionAction(state, ExecutionActionStatus.Failed, ex.GetType().Name + ":" + ex.Message);
                throw;
            }
            finally
            {
                if (state.Status == ExecutionActionStatus.Submitting)
                {
                    var pendingKey = BuildEntryBarSignalKey(symbolName, signal);
                    SetExecutionAction(state, _pendingStrategyEntries.ContainsKey(pendingKey)
                        ? ExecutionActionStatus.Waiting : ExecutionActionStatus.Blocked,
                        state.Reason.Length > 0 ? state.Reason : "no_order_created");
                }
                _activeExecutionAction = previous;
                TrimExecutionJournal();
            }
        }

        private void TrimExecutionJournal()
        {
            if (_executionActions.Count <= ExecutionJournalLimit + 256) return;
            foreach (var state in _executionActions.Values
                .Where(s => s != _activeExecutionAction && s.Status != ExecutionActionStatus.Waiting &&
                    s.Status != ExecutionActionStatus.Ready && s.Status != ExecutionActionStatus.Submitting &&
                    (s.Status != ExecutionActionStatus.RetryableFailure || !_exitExecutionJobs.ContainsKey(s.Key)))
                .OrderByDescending(s => s.UpdatedAtUtc).Skip(ExecutionJournalLimit).ToList())
                _executionActions.Remove(state.Key);
        }

        private string BuildExecutionJournalJson()
        {
            var rows = _executionActions.Values.Where(s => s.Status == ExecutionActionStatus.Accepted ||
                    (s.BrokerAttempted && (s.Status == ExecutionActionStatus.Submitting || s.Status == ExecutionActionStatus.RetryableFailure)) ||
                    s.SubmissionUncertain ||
                    ((s.Status == ExecutionActionStatus.Blocked || s.Status == ExecutionActionStatus.Failed) &&
                     s.Key.StartsWith("EXITGROUP|", StringComparison.OrdinalIgnoreCase)))
                .OrderByDescending(s => s.UpdatedAtUtc).Take(ExecutionJournalLimit)
                .Select(s => (object)new Dictionary<string, object> {
                    { "key", s.Key }, { "status", s.Status.ToString() },
                    { "utc", s.UpdatedAtUtc.ToString("O", CultureInfo.InvariantCulture) },
                    { "ticket", s.Ticket }, { "reason", s.Reason }, { "uncertain", s.SubmissionUncertain } }).ToList();
            return SerializeJsonValue(rows);
        }

        private void SaveExecutionJournal()
        {
            if (IsBacktestingRuntime()) return;
            try
            {
                var json = BuildExecutionJournalJson();
                if (json == _lastExecutionJournalSaved) return;
                LocalStorage.SetString(ExecutionJournalStorageKey, json, LocalStorageScope.Instance);
                LocalStorage.Flush(LocalStorageScope.Instance);
                _lastExecutionJournalSaved = json;
            }
            catch (Exception ex) { SafePrint("[Execution] Journal save failed: {0}", ex.Message); }
        }

        private void RestoreExecutionJournal(string json)
        {
            var rows = CTraderRuleEngine.ParseJson(json) as System.Collections.IEnumerable;
            if (rows == null) return;
            foreach (var row in rows)
            {
                var values = row as Dictionary<string, object>;
                if (values == null) continue;
                var key = ConvertToInvariantString(GetDictionaryValue(values, "key"));
                ExecutionActionStatus status;
                DateTime utc;
                if (key.Length == 0 || !Enum.TryParse(ConvertToInvariantString(GetDictionaryValue(values, "status")), out status) ||
                    (status != ExecutionActionStatus.Accepted && status != ExecutionActionStatus.Blocked && status != ExecutionActionStatus.Failed &&
                     status != ExecutionActionStatus.Submitting && status != ExecutionActionStatus.RetryableFailure) ||
                    !DateTime.TryParse(ConvertToInvariantString(GetDictionaryValue(values, "utc")), CultureInfo.InvariantCulture,
                        DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out utc)) continue;
                var state = GetExecutionAction(key);
                state.SubmissionUncertain = status == ExecutionActionStatus.Submitting ||
                    string.Equals(ConvertToInvariantString(GetDictionaryValue(values, "uncertain")), "true", StringComparison.OrdinalIgnoreCase);
                state.BrokerAttempted = status == ExecutionActionStatus.Submitting || status == ExecutionActionStatus.RetryableFailure;
                state.Status = status == ExecutionActionStatus.Submitting ? ExecutionActionStatus.RetryableFailure : status;
                state.UpdatedAtUtc = utc;
                state.Reason = ConvertToInvariantString(GetDictionaryValue(values, "reason"));
                long ticket;
                if (long.TryParse(ConvertToInvariantString(GetDictionaryValue(values, "ticket")), out ticket)) state.Ticket = ticket;
            }
        }

        private sealed class TradeIdentity
        {
            public bool Managed;
            public string StrategyId;
            public TimeFrame SourceTimeFrame;
            public Dictionary<string, string> Tokens;
            public string Token(string name) { string value; return Tokens.TryGetValue(name, out value) ? value : ""; }
        }

        private readonly Dictionary<string, TradeIdentity> _tradeIdentities = new Dictionary<string, TradeIdentity>(StringComparer.Ordinal);
        private TradeIdentity ResolveTradeIdentity(string label, string comment)
        {
            label = (label ?? "").Trim(); comment = (comment ?? "").Trim();
            var key = label + "\n" + comment;
            TradeIdentity identity;
            if (_tradeIdentities.TryGetValue(key, out identity)) return identity;
            var tokens = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var part in comment.Split('|'))
            {
                var separator = part.IndexOf(':');
                if (separator > 0)
                {
                    var name = CanonicalTradeMetadataKey(part.Substring(0, separator));
                    if (!tokens.ContainsKey(name)) tokens[name] = part.Substring(separator + 1);
                }
            }
            TimeFrame frame;
            TryResolveStrategyTriggerTimeFrame(GetStrategyCommentEventLabel(comment), out frame);
            identity = new TradeIdentity { Tokens = tokens, StrategyId = ExtractStrategyIdFromOrderLabel(label), SourceTimeFrame = frame,
                Managed = comment.StartsWith("bot_", StringComparison.OrdinalIgnoreCase) || tokens.ContainsKey("rs") ||
                    tokens.ContainsKey("ltf") || IsCompactStrategyOrderComment(comment) ||
                    label.EndsWith("_bot", StringComparison.OrdinalIgnoreCase) || label.StartsWith("BT_", StringComparison.OrdinalIgnoreCase) ||
                    comment.StartsWith("live_", StringComparison.OrdinalIgnoreCase) || comment.StartsWith("backtest_", StringComparison.OrdinalIgnoreCase) };
            if (_tradeIdentities.Count >= 4096) _tradeIdentities.Clear();
            _tradeIdentities[key] = identity;
            return identity;
        }

        private bool IsStrategyInstanceExposure(string label, string comment, bool allowLegacy = true)
        {
            var identity = ResolveTradeIdentity(label, comment);
            if (!identity.Managed) return false;
            var owner = identity.Token("owner");
            return owner.Length == 0 ? allowLegacy : owner == GetTradePlanOwnerToken();
        }

        private readonly Dictionary<string, StrategyDataProfile> _executionPolicies = new Dictionary<string, StrategyDataProfile>(StringComparer.Ordinal);
        private StrategyDataProfile _activeExecutionPolicy;
        private bool _executionPoliciesLoaded;
        private static readonly Lazy<PropertyInfo[]> ExecutionPolicyProperties = new Lazy<PropertyInfo[]>(() =>
            StrategyDataParameterNames.OrderBy(n => n, StringComparer.Ordinal)
                .Select(n => typeof(TVBridgeCBot).GetProperty(n)).Where(p => p != null).ToArray());

        private void EnsureExecutionPolicies()
        {
            if (_executionPoliciesLoaded) return;
            if (IsBacktestingRuntime()) { _executionPoliciesLoaded = true; return; }
            var json = LocalStorage.GetString(ExecutionPoliciesStorageKey, LocalStorageScope.Instance) ?? "";
            if (json.Length > 0) RestoreExecutionPolicies(json);
            _executionPoliciesLoaded = true;
        }

        private void RestoreExecutionPolicies(string json)
        {
            var root = CTraderRuleEngine.ParseJson(json) as Dictionary<string, object>;
            if (root == null) throw new InvalidOperationException("invalid execution policies");
            foreach (var pair in root)
            {
                var row = pair.Value as Dictionary<string, object>;
                if (row == null) continue;
                var profile = new StrategyDataProfile { StrategyId = ConvertToInvariantString(GetDictionaryValue(row, "strategy")), Key = pair.Key,
                    Params = GetDictionaryValue(row, "params") as Dictionary<string, object> };
                AddStrategyParameterValues(profile, GetDictionaryValue(row, "values") as Dictionary<string, object>);
                _executionPolicies[pair.Key] = profile;
            }
        }

        private string BuildExecutionPoliciesJson()
        {
            return SerializeJsonValue(_executionPolicies.ToDictionary(p => p.Key, p => (object)new Dictionary<string, object> {
                { "strategy", p.Value.StrategyId }, { "values", p.Value.Values.ToDictionary(v => v.Key,
                    v => v.Value is Enum ? (object)v.Value.ToString() : v.Value) }, { "params", p.Value.Params } }));
        }

        private string CaptureExecutionPolicy(AutoTradeRequest request)
        {
            EnsureExecutionPolicies();
            StrategyDataProfile savedPolicy;
            if (_activeExecutionPolicy != null && _executionPolicies.TryGetValue(_activeExecutionPolicy.Key, out savedPolicy) &&
                ReferenceEquals(savedPolicy, _activeExecutionPolicy) &&
                (StrategyExitMode)savedPolicy.Values[nameof(SelectedStrategyExitMode)] == request.ExitMode)
                return _activeExecutionPolicy.Key;
            string key;
            StrategyDataProfile existing;
            if (_activeExecutionAction != null && _activeExecutionAction.PolicyKey != null &&
                _executionPolicies.TryGetValue(_activeExecutionAction.PolicyKey, out existing) &&
                (StrategyExitMode)existing.Values[nameof(SelectedStrategyExitMode)] == request.ExitMode)
                return existing.Key;
            var profile = new StrategyDataProfile { StrategyId = ExtractStrategyIdFromOrderLabel(request.Label),
                Params = _strategyDataProfile != null && _strategyDataProfile.Params != null
                    ? new Dictionary<string, object>(_strategyDataProfile.Params, StringComparer.Ordinal) : null };
            foreach (var property in ExecutionPolicyProperties.Value) profile.Values[property.Name] = property.GetValue(this);
            profile.Values[nameof(SelectedStrategyExitMode)] = request.ExitMode;
            var fingerprint = SerializeJsonValue(profile.Values.ToDictionary(v => v.Key,
                v => v.Value is Enum ? (object)v.Value.ToString() : v.Value)) + SerializeJsonValue(profile.Params) + profile.StrategyId;
            key = BuildStableBase62Token(fingerprint, 12);
            profile.Key = key;
            if (!_executionPolicies.ContainsKey(key))
            {
                _executionPolicies.Add(key, profile);
                if (!IsBacktestingRuntime())
                {
                    // Persist before submission: pending fills/restarts must recover the same policy.
                    try
                    {
                        LocalStorage.SetString(ExecutionPoliciesStorageKey, BuildExecutionPoliciesJson(), LocalStorageScope.Instance);
                        LocalStorage.Flush(LocalStorageScope.Instance);
                    }
                    catch { _executionPolicies.Remove(key); throw; }
                }
            }
            if (_activeExecutionAction != null) _activeExecutionAction.PolicyKey = key;
            return key;
        }

        private sealed class ExecutionPolicyScope : IDisposable
        {
            private readonly TVBridgeCBot _owner;
            private readonly StrategyDataProfile _previous;
            private readonly IDisposable _scope;
            public ExecutionPolicyScope(TVBridgeCBot owner, StrategyDataProfile profile)
            {
                _owner = owner; _previous = owner._activeExecutionPolicy;
                _scope = new StrategyDataScope(owner, profile);
                owner._activeExecutionPolicy = profile;
            }
            public void Dispose() { _owner._activeExecutionPolicy = _previous; _scope.Dispose(); }
        }

        private IDisposable BeginPositionExecutionPolicy(string label, string comment)
        {
            var identity = ResolveTradeIdentity(label, comment);
            var key = identity.Token("cfg");
            if (key.Length == 0) return BeginStrategyData(ResolveStrategyModeForId(identity.StrategyId), identity.StrategyId);
            EnsureExecutionPolicies();
            StrategyDataProfile profile;
            if (!_executionPolicies.TryGetValue(key, out profile))
                throw new InvalidOperationException("execution policy unavailable: " + key);
            // Only ongoing position management is immutable. Entry plans, sessions and
            // filters for a NEW follow-up resolve from the current strategy/shared settings.
            var current = ResolveStrategyDataProfileForMode(ResolveStrategyModeForId(identity.StrategyId), identity.StrategyId);
            var viewKey = "position/" + key + "/" + (current != null ? current.Key : "shared");
            StrategyDataProfile view;
            if (!_positionExecutionPolicies.TryGetValue(viewKey, out view))
            {
                view = new StrategyDataProfile { Key = viewKey, StrategyId = identity.StrategyId,
                    Values = current != null ? new Dictionary<string, object>(current.Values, StringComparer.Ordinal)
                        : new Dictionary<string, object>(StringComparer.Ordinal), Params = current != null ? current.Params : null };
                foreach (var name in PositionManagementParameterNames)
                {
                    object value;
                    if (profile.Values.TryGetValue(name, out value)) view.Values[name] = value;
                }
                _positionExecutionPolicies[viewKey] = view;
            }
            return new ExecutionPolicyScope(this, view);
        }

        private static readonly string[] PositionManagementParameterNames = {
            nameof(SelectedStrategyExitMode), nameof(SelectedRrLadderSlStep), nameof(BreakEvenOffsetPips),
            nameof(SelectedRrLadderClosePlan), nameof(OrdersExpiry) };
        private readonly Dictionary<string, StrategyDataProfile> _positionExecutionPolicies =
            new Dictionary<string, StrategyDataProfile>(StringComparer.Ordinal);

        private readonly HashSet<string> _executionPolicyFailures = new HashSet<string>(StringComparer.Ordinal);
        private void ForEachManagedPosition(Action<Position> action)
        {
            if (Positions == null || Positions.Count == 0) return;
            // One runtime/settings scope per policy, rather than reflection and indicator
            // reconfiguration for every leg of the same setup on every tick.
            foreach (var group in Positions.Where(p => p != null && IsStrategyInstanceExposure(p.Label, p.Comment))
                .ToList().GroupBy(p => {
                    var identity = ResolveTradeIdentity(p.Label, p.Comment);
                    return identity.Token("cfg") + "/" + identity.StrategyId;
                }))
            {
                try
                {
                    var first = group.First();
                    using var policy = BeginPositionExecutionPolicy(first.Label, first.Comment);
                    foreach (var position in group)
                    {
                        try { action(position); }
                        catch (Exception ex)
                        {
                            if (_executionPolicyFailures.Add(position.Id + ":" + ex.Message))
                                SafePrint("[Execution] Position #{0} management failed: {1}", position.Id, ex.Message);
                        }
                    }
                }
                catch (Exception ex)
                {
                    if (_executionPolicyFailures.Add(group.Key + ":" + ex.Message))
                        SafePrint("[Execution] Position policy unavailable {0}: {1}", group.Key, ex.Message);
                }
            }
        }

        private void InvalidateExecutionAccountSnapshot()
        {
            _masterTimerPositionsSnapshot = null;
            _masterTimerPendingOrdersSnapshot = null;
            _masterTimerActiveSymbolsSnapshot = null;
            _adaptiveRefreshed = DateTime.MinValue;
        }

        private bool TryFinalizeDelayedStrategySignal(string symbolName, TimeFrame frame,
            ref BacktestStrategySignal signal, DateTime confirmationTime, int patternEndIndex, HashSet<long> eventTicks,
            out CTraderWaitConfirmDecision decision)
        {
            InitializeWaitConfirmReference(symbolName, frame, ref signal);
            Bars bars;
            int triggerIndex;
            if (!TryEvaluateWaitConfirm(symbolName, ref signal, out decision, out bars, out triggerIndex, eventTicks, patternEndIndex) ||
                decision == null || decision.Kind != CTraderWaitConfirmDecisionKind.Confirm) return false;
            var index = triggerIndex + decision.ConfirmationOffset;
            if (!IsValidBarIndex(bars, index) || bars.OpenTimes[index].Ticks != confirmationTime.Ticks) return false;
            signal.WaitConfirmActionKey = BuildWaitConfirmTravelKey(symbolName, signal);
            if (_releasedEntryBarSignalKeys.Contains(signal.WaitConfirmActionKey) || IsExecutionActionAccepted(signal.WaitConfirmActionKey)) return false;
            ApplyStrategyConfluenceSizing(symbolName, frame, ref signal);
            return true;
        }
    }
}
