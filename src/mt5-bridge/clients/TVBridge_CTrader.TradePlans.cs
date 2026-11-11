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
        private string _tradePlanOwnerToken = "";

        private static bool IsOnExitTradePlan(StrategyTradeChainMode mode)
        {
            mode = ResolveBaseExitTradePlan(mode);
            return mode == StrategyTradeChainMode.OnExit_cont || mode == StrategyTradeChainMode.OnExit_flip ||
                mode == StrategyTradeChainMode.OnTP_cont || mode == StrategyTradeChainMode.OnTP_flip ||
                mode == StrategyTradeChainMode.OnSL_cont || mode == StrategyTradeChainMode.OnSL_flip;
        }

        private static StrategyTradeChainMode ResolveBaseExitTradePlan(StrategyTradeChainMode mode)
        {
            switch (mode)
            {
                case StrategyTradeChainMode.OnExit_cont_Swing: return StrategyTradeChainMode.OnExit_cont;
                case StrategyTradeChainMode.OnExit_flip_Swing: return StrategyTradeChainMode.OnExit_flip;
                case StrategyTradeChainMode.OnTP_cont_Swing: return StrategyTradeChainMode.OnTP_cont;
                case StrategyTradeChainMode.OnTP_flip_Swing: return StrategyTradeChainMode.OnTP_flip;
                case StrategyTradeChainMode.OnSL_cont_Swing: return StrategyTradeChainMode.OnSL_cont;
                case StrategyTradeChainMode.OnSL_flip_Swing: return StrategyTradeChainMode.OnSL_flip;
                default: return mode;
            }
        }

        private static StrategyStopLossMode ResolveExitTradeStopLossMode(StrategyTradeChainMode mode)
        {
            return mode != ResolveBaseExitTradePlan(mode) ? StrategyStopLossMode.swing : StrategyStopLossMode.Auto_Scalp;
        }

        private bool TryResolveExitTradeStopLoss(DecisionBar currentBar, Symbol symbol, string symbolName,
            BacktestStrategySignal signal, double entryPrice, StrategyStopLossMode mode,
            out double stopLoss, out string sourceCode)
        {
            using var decision = BeginDecisionBar(currentBar);
            stopLoss = 0; sourceCode = "";
            if (!IsDecisionBarUsable(currentBar) || symbol == null || !IsFiniteNumber(entryPrice) || entryPrice <= 0)
                return false;
            bool Resolve(double reference, out double stop, out string source)
            {
                if (mode != StrategyStopLossMode.swing)
                    return TryResolveStrategyAutoScalpStopLoss(currentBar, symbol, symbolName, signal, reference, out stop, out source);
                source = "SLTF";
                return TryResolveStrategySwingStopLoss(currentBar, symbol, symbolName, signal, reference,
                    GetStrategyLtfProtectionFrames(signal), out stop);
            }
            if (Resolve(entryPrice, out stopLoss, out sourceCode)) return true;

            // An exit is not a new detector event. Price may already have broken every
            // completed-bar level. Derive the selected family's distance at that closed
            // bar's close, then translate it to this entry; never reuse a parent's SL or
            // substitute a fixed USD/ATR stop. The shared buffer is applied afterward.
            var referenceClose = currentBar.SourceBars.ClosePrices[currentBar.Index];
            double referenceStop; string referenceSource;
            if (IsFiniteNumber(referenceClose) && referenceClose > 0 &&
                Resolve(referenceClose, out referenceStop, out referenceSource))
            {
                var distance = Math.Abs(referenceClose - referenceStop);
                if (IsFiniteNumber(distance) && distance > 0)
                {
                    distance = Math.Max(distance, ResolveMinStopPips(symbol,
                        GetDecisionBars(currentBar, currentBar.TimeFrame)) * symbol.PipSize);
                    stopLoss = NormalizePriceToSymbol(symbol, signal.TradeType == TradeType.Buy
                        ? entryPrice - distance : entryPrice + distance);
                    sourceCode = AttachStrategyProtectionSourceDetail(referenceSource, "Reanchored");
                    if (stopLoss > 0 && (signal.TradeType == TradeType.Buy ? stopLoss < entryPrice : stopLoss > entryPrice))
                        return true;
                }
            }
            stopLoss = 0; sourceCode = "";
            NoteExecutionBlock("exit_stop_unavailable:" + mode);
            return false; // Missing history/confirmed swings still cannot open naked orders.
        }

        private bool TryNormalizeExitExecutionProtection(Symbol symbol, BacktestStrategySignal signal,
            double entryPrice, StrategyTakeProfitMode takeProfitMode, ref double stopLoss, ref double takeProfit)
        {
            if (signal.OnExitParentId <= 0 || !IsOnExitTradePlan(ResolveEffectiveSignalTradePlan(signal))) return true;
            if (symbol == null || !IsFiniteNumber(entryPrice) || entryPrice <= 0 ||
                !IsFiniteNumber(stopLoss) || stopLoss <= 0 ||
                !(signal.TradeType == TradeType.Buy ? stopLoss < entryPrice : stopLoss > entryPrice)) return false;
            // Execution-only normalization, after the causal plan and buffer, before
            // volume sizing. Reuse exactly the shared submission gate's current minimum.
            var minimumDistance = ResolveMinStopPips(symbol) * symbol.PipSize;
            var tick = Math.Max(symbol.TickSize, symbol.PipSize * 0.1);
            var rr = CTraderStrategyEngine.IsRewardRiskMode(takeProfitMode)
                ? CTraderStrategyEngine.ResolveRewardRisk(takeProfitMode) : 0;
            if (!IsFiniteNumber(minimumDistance) || minimumDistance <= 0 || !IsFiniteNumber(tick) || tick <= 0) return false;
            // RR below 1 also needs enough SL distance for TP to clear the same gate.
            var floor = Math.Max(minimumDistance + tick, rr > 0 ? (minimumDistance + tick) / rr : 0);
            if (Math.Abs(entryPrice - stopLoss) >= floor) return true;
            var previousStop = stopLoss;
            stopLoss = NormalizePriceToSymbol(symbol, signal.TradeType == TradeType.Buy
                ? entryPrice - floor : entryPrice + floor);
            if (stopLoss <= 0) return false;
            if (rr > 0)
            {
                var distance = Math.Abs(entryPrice - stopLoss);
                takeProfit = NormalizePriceToSymbol(symbol, signal.TradeType == TradeType.Buy
                    ? entryPrice + distance * rr : entryPrice - distance * rr);
                ApplyStrategySignalRewardRisk(symbol, signal, entryPrice, stopLoss, takeProfitMode, ref takeProfit);
                ApplyStrategySignalTakeProfitLimit(symbol, ref signal, entryPrice, stopLoss, ref takeProfit);
            }
            PrintAlways("[Execution] Exit protection widened parent=#{0}; SL={1}->{2}; minimum_pips={3:0.##}; sizing=after_adjustment",
                signal.OnExitParentId, FormatPriceShort(previousStop), FormatPriceShort(stopLoss), minimumDistance / symbol.PipSize);
            return true;
        }

        private static string NormalizeTradePlanName(string text)
        {
            var value = (text ?? "").Trim();
            if (value.EndsWith("_Swing", StringComparison.OrdinalIgnoreCase))
                return NormalizeTradePlanName(value.Substring(0, value.Length - 6)) + "_Swing";
            switch ((text ?? "").Trim().ToLowerInvariant())
            {
                case "wait": return nameof(StrategyTradePlanMode.Wait_BetterEntry);
                case "nowreverse": case "now_reverse": return nameof(StrategyTradePlanMode.Now_flip);
                case "waitreverse": case "wait_reverse": return nameof(StrategyTradePlanMode.Wait_flip);
                case "onexit_continue": return nameof(StrategyTradePlanMode.OnExit_cont);
                case "onexit_reverse": case "onexit_reversve": return nameof(StrategyTradePlanMode.OnExit_flip);
                case "ontp_continue": return nameof(StrategyTradePlanMode.OnTP_cont);
                case "ontp_reverse": case "ontp_reversve": return nameof(StrategyTradePlanMode.OnTP_flip);
                case "onsl_continue": return nameof(StrategyTradePlanMode.OnSL_cont);
                case "onsl_reverse": case "onsl_reversve": return nameof(StrategyTradePlanMode.OnSL_flip);
                default: return (text ?? "").Trim();
            }
        }

        private static bool MatchesExitTradePlanReason(StrategyTradeChainMode plan, PositionCloseReason reason)
        {
            if (reason != PositionCloseReason.TakeProfit && reason != PositionCloseReason.StopLoss) return false;
            switch (ResolveBaseExitTradePlan(plan))
            {
                case StrategyTradeChainMode.OnExit_cont: case StrategyTradeChainMode.OnExit_flip: return true;
                case StrategyTradeChainMode.OnTP_cont: case StrategyTradeChainMode.OnTP_flip:
                    return reason == PositionCloseReason.TakeProfit;
                case StrategyTradeChainMode.OnSL_cont: case StrategyTradeChainMode.OnSL_flip:
                    return reason == PositionCloseReason.StopLoss;
                default: return false;
            }
        }

        private StrategyTradeChainMode ResolveEffectiveSignalTradePlan(BacktestStrategySignal signal)
        {
            return signal.TradeChainModeOverride != StrategyTradeChainMode.No
                ? signal.TradeChainModeOverride : ResolveStrategyTradeChainMode(signal.TradeChainSlot);
        }

        private double GetWaitMaximumChaseR(BacktestStrategySignal signal)
        {
            // A directional breakout intentionally pays a worse entry than the original candle.
            // Its SL, sizing and mandatory exposure gates still apply at submission.
            return ResolveEffectiveSignalTradePlan(signal) == StrategyTradeChainMode.Wait_DirectionConfirm
                ? double.PositiveInfinity : WaitConfirmMaximumChaseR;
        }

        private TradeType ResolveWaitConfirmationSide(string symbolName,
            BacktestStrategySignal signal, StrategyTradeChainMode plan)
        {
            if (plan != StrategyTradeChainMode.Wait_DirectionConfirm) return signal.TradeType;
            // Confirm the side this order would actually execute, including a configured
            // direction flip. The detector's original side stays intact for its own rules.
            var direction = signal.IsManualExecution ? StrategyTradeDirectionMode.Original :
                ResolveStrategyTradeDirectionMode(SelectedTradeDirectionMode, signal.SourceLabel,
                    signal.PrimaryTriggerIsCross, signal.HasForwardObstacleRejection);
            var candidate = signal;
            candidate.TradeType = ResolveStrategyExecutionTradeType(signal.TradeType, direction, false);
            var reverseBias = ShouldApplyAdaptiveBias(symbolName, candidate) &&
                !IsAdaptiveBiasReduceMode(SelectedAdaptiveBiasMode);
            return ResolveStrategyExecutionTradeType(signal.TradeType, direction, reverseBias);
        }

        private string GetTradePlanOwnerToken()
        {
            if (_tradePlanOwnerToken.Length > 0) return _tradePlanOwnerToken;
            if (IsBacktestingRuntime()) return _tradePlanOwnerToken = "BACKTEST";
            try
            {
                const string key = "Trade Plan Owner v1";
                var token = LocalStorage.GetString(key, LocalStorageScope.Instance) ?? "";
                if (token.Length == 0)
                {
                    token = Guid.NewGuid().ToString("N").Substring(0, 12);
                    LocalStorage.SetString(key, token, LocalStorageScope.Instance);
                    LocalStorage.Flush(LocalStorageScope.Instance);
                }
                _tradePlanOwnerToken = token;
            }
            catch (Exception ex)
            {
                SafePrint("[TradePlan] Owner state unavailable: {0}; exit follow-ups require verified ownership", ex.Message);
            }
            return _tradePlanOwnerToken;
        }

        private static string GetTradePlanCommentValue(string comment, string key)
        {
            foreach (var part in (comment ?? "").Split('|'))
            {
                var separator = part.IndexOf(':');
                if (separator > 0 && CanonicalTradeMetadataKey(part.Substring(0, separator)) == key)
                    return part.Substring(separator + 1);
            }
            return "";
        }

        private void StampTradePlanOwner(AutoTradeRequest request)
        {
            if (request == null || request.IsManual || request.Type == AutoTradeOrderType.PositionVolume ||
                !IsCompactStrategyOrderComment(request.Comment) ||
                (request.Comment ?? "").IndexOf("|manual:1", StringComparison.OrdinalIgnoreCase) >= 0 ||
                !IsStrategyManagedExposure(request.Label, request.Comment)) return;
            var owner = GetTradePlanOwnerToken();
            if (owner.Length == 0) throw new InvalidOperationException("instance identity unavailable");
            var identity = ResolveTradeIdentity(request.Label, request.Comment);
            if (identity.Token("owner").Length > 0 && identity.Token("owner") != owner)
                throw new InvalidOperationException("foreign instance identity");
            var parts = request.Comment.Split('|').ToList();
            var metadata = new List<string>();
            if (identity.Token("owner").Length == 0) metadata.Add("owner:" + owner);
            if (identity.Token("cfg").Length == 0) metadata.Add("cfg:" + CaptureExecutionPolicy(request));
            if (_activeExecutionAction != null)
            {
                var action = BuildStableBase62Token(_activeExecutionAction.Key, 12);
                if (identity.Token("action") != action)
                {
                    parts.RemoveAll(p => p.StartsWith("action:", StringComparison.Ordinal));
                    metadata.Add("action:" + action);
                }
            }
            parts.InsertRange(Math.Min(3, parts.Count), metadata);
            request.Comment = FitStrategyBrokerComment(string.Join("|", parts));
        }

        // Broker/backtest comments may be capped at 100 characters. Machine identity
        // must survive independently of the optional descriptive protection/evidence tail.
        private static string CanonicalTradeMetadataKey(string key)
        {
            switch (key)
            {
                case "o": return "owner";
                case "a": return "action";
                case "x": return "exit_slot";
                case "p": return "from";
                case "e": return "exit";
                default: return key;
            }
        }

        private static string FitStrategyBrokerComment(string comment)
        {
            const int limit = 100;
            if (comment.Length <= limit) return comment;
            var parts = comment.Split('|').ToList();
            var essential = new List<string>();
            foreach (var key in new[] { "owner", "cfg", "action", "exit_slot", "from", "exit", "rev", "manual" })
            {
                var value = GetTradePlanCommentValue(comment, key);
                if (value.Length == 0) continue;
                var name = key == "owner" ? "o" : key == "action" ? "a" : key == "exit_slot" ? "x" : key;
                essential.Add(name + ":" + value);
            }
            var tail = "|" + string.Join("|", essential);
            var eventBudget = limit - parts[0].Length - parts[2].Length - 2 - tail.Length;
            var eventLabel = parts[1];
            var dot = eventLabel.IndexOf('.');
            if (dot >= 1 && eventBudget < dot + 2)
            {
                tail = tail.Replace("|from:", "|p:").Replace("|exit:", "|e:");
                eventBudget = limit - parts[0].Length - parts[2].Length - 2 - tail.Length;
            }
            if (dot < 1 || eventBudget < dot + 2)
                throw new InvalidOperationException("strategy identity exceeds broker comment limit");
            // Detailed event evidence remains in TradeEvidenceJson; preserve its frame.
            if (eventLabel.Length > eventBudget) eventLabel = eventLabel.Substring(0, eventBudget);
            var result = parts[0] + "|" + eventLabel + "|" + parts[2] + tail;
            return result;
        }

        private static bool TryResolveOnExitTradeType(StrategyTradeChainMode plan,
            TradeType closedSide, PositionCloseReason reason, out TradeType side)
        {
            side = closedSide;
            if (!MatchesExitTradePlanReason(plan, reason)) return false;
            var exitDirection = reason == PositionCloseReason.TakeProfit ? closedSide : ReverseTradeType(closedSide);
            plan = ResolveBaseExitTradePlan(plan);
            var continues = plan == StrategyTradeChainMode.OnExit_cont || plan == StrategyTradeChainMode.OnTP_cont ||
                plan == StrategyTradeChainMode.OnSL_cont;
            side = continues ? exitDirection : ReverseTradeType(exitDirection);
            return true;
        }

        private static bool IsExitDerivedTrade(string label, string comment)
        {
            if (GetTradePlanCommentValue(comment, "exit_slot").Length > 0 ||
                GetTradePlanCommentValue(comment, "from").Length > 0 ||
                GetTradePlanCommentValue(comment, "rev") == "1" ||
                (label ?? "").EndsWith(":REV", StringComparison.OrdinalIgnoreCase)) return true;
            // Also recognize old/truncated exit comments whose parent metadata is absent.
            foreach (var part in (comment ?? "").Split('|'))
            {
                var separator = part.LastIndexOf('.');
                StrategyTradePlanMode mode;
                if (separator > 0 && TryParseStrategyTradePlanMode(part.Substring(0, separator), out mode) &&
                    IsOnExitTradePlan((StrategyTradeChainMode)(int)mode)) return true;
            }
            return false;
        }

        private bool TryVerifyOriginalExitParent(ExitExecutionJob job)
        {
            if (Positions != null && Positions.Any(p => p != null && p.Id == job.ParentId)) return false;
            if (job.OriginalParentVerified) return true;
            // v1 queues did not store parent evidence. Recover it from broker history;
            // an unavailable or exit-derived parent cannot seed a restored submission.
            if (string.IsNullOrWhiteSpace(job.ParentLabel) && History != null)
                foreach (var trade in History)
                    if (trade != null && trade.PositionId == job.ParentId &&
                        string.Equals(trade.SymbolName, job.SymbolName, StringComparison.OrdinalIgnoreCase))
                    { job.ParentLabel = trade.Label; job.ParentComment = trade.Comment; break; }
            if (string.IsNullOrWhiteSpace(job.ParentLabel) ||
                !IsStrategyInstanceExposure(job.ParentLabel, job.ParentComment, job.Legacy) ||
                GetTradePlanCommentValue(job.ParentComment, "manual") == "1" ||
                IsExitDerivedTrade(job.ParentLabel, job.ParentComment)) return false;
            var identity = ResolveTradeIdentity(job.ParentLabel, job.ParentComment);
            if (!string.Equals(identity.StrategyId, job.StrategyId, StringComparison.OrdinalIgnoreCase) ||
                identity.SourceTimeFrame == null || !identity.SourceTimeFrame.Equals(job.Frame)) return false;
            job.OriginalParentVerified = true;
            return true;
        }

        private bool TryExecuteOnExitTradePlans(PositionClosedEventArgs args)
        {
            if (args == null || args.Position == null ||
                (args.Reason != PositionCloseReason.TakeProfit && args.Reason != PositionCloseReason.StopLoss)) return false;
            var closed = args.Position;
            if (Positions != null && Positions.Any(p => p != null && p.Id == closed.Id)) return false;
            if (!IsStrategyInstanceExposure(closed.Label, closed.Comment, false) ||
                GetTradePlanCommentValue(closed.Comment, "manual") == "1") return false;
            if (IsExitDerivedTrade(closed.Label, closed.Comment)) return true; // Suppress every exit/legacy chain.
            try
            {
                using var policy = BeginPositionExecutionPolicy(closed.Label, closed.Comment);
                var identity = ResolveTradeIdentity(closed.Label, closed.Comment);
                var strategyMode = ResolveStrategyModeForId(identity.StrategyId);
                if (strategyMode == BacktestStrategyMode.Off || identity.SourceTimeFrame == null) return false;
                var slots = Enumerable.Range(1, 3).Where(slot =>
                    IsOnExitTradePlan(ResolveStrategyTradeChainMode(slot))).ToList();
                if (slots.Count == 0) return false;
                foreach (var slot in slots)
                {
                    var plan = ResolveStrategyTradeChainMode(slot);
                    if (MatchesExitTradePlanReason(plan, args.Reason)) QueueExitExecution(closed, args.Reason, slot, plan, false);
                }
                return true; // Explicit plans also suppress the legacy reversal when blocked.
            }
            catch (Exception ex)
            {
                SafePrint("[Execution] Exit policy unavailable parent=#{0}: {1}", closed.Id, ex.Message);
                return true;
            }
        }

        private bool TryBuildOnExitTradeSignal(Position closed, PositionCloseReason reason,
            BacktestStrategyMode mode, string strategyId, string sourceEvent, TimeFrame frame,
            int slot, StrategyTradeChainMode plan, out BacktestStrategySignal signal)
        {
            var job = new ExitExecutionJob { ParentId = closed.Id, SymbolName = closed.SymbolName,
                StrategyId = strategyId, SourceEvent = sourceEvent, Frame = frame, Plan = plan,
                Slot = slot, ClosedSide = closed.TradeType, Reason = reason, ExitUtc = GetStrategySchedulerClockUtc(),
                ParentLabel = closed.Label, ParentComment = closed.Comment };
            var valid = PrepareExitExecutionSignal(job);
            signal = job.Signal;
            return valid;
        }

        private sealed class ExitExecutionJob
        {
            public string Key, StrategyId, SymbolName, SourceEvent, PolicyKey, ParentLabel, ParentComment;
            public TimeFrame Frame;
            public TradeType ClosedSide;
            public PositionCloseReason Reason;
            public StrategyTradeChainMode Plan;
            public int Slot, Attempts;
            public long ParentId;
            public DateTime ExitUtc, NextAttemptUtc;
            public bool Legacy, OriginalParentVerified;
            public BacktestStrategySignal Signal;
        }

        private const string ExitJobsStorageKey = "Execution Exit Jobs v1";
        private readonly Dictionary<string, ExitExecutionJob> _exitExecutionJobs =
            new Dictionary<string, ExitExecutionJob>(StringComparer.OrdinalIgnoreCase);
        private bool _exitJobsLoaded, _exitJobsProcessing;
        private string _lastExitJobsSaved;

        private void QueueLegacyExitReversal(PositionClosedEventArgs args)
        {
            if (args == null || args.Position == null || args.Reason != PositionCloseReason.StopLoss) return;
            var closed = args.Position;
            if (IsExitDerivedTrade(closed.Label, closed.Comment) ||
                !IsStrategyInstanceExposure(closed.Label, closed.Comment) ||
                ResolveTradeIdentity(closed.Label, closed.Comment).Token("manual") == "1" ||
                (Positions != null && Positions.Any(p => p != null && p.Id == closed.Id))) return;
            try
            {
                using var policy = BeginPositionExecutionPolicy(closed.Label, closed.Comment);
                if (!ShouldReverseStoppedStrategyPosition() || !CTraderExecutionEngine.ShouldReverseAfterSl(
                    SelectedReverseAfterSlMode, closed.NetProfit)) return;
                if (GetTradePlanCommentValue(closed.Comment, "rev") == "1" ||
                    (closed.Label ?? "").EndsWith(":REV", StringComparison.OrdinalIgnoreCase)) return;
                QueueExitExecution(closed, args.Reason, 1, StrategyTradeChainMode.Now, true);
            }
            catch (Exception ex) { SafePrint("[Execution] Legacy exit skipped parent=#{0}: {1}", closed.Id, ex.Message); }
        }

        private void QueueExitExecution(Position closed, PositionCloseReason reason, int slot, StrategyTradeChainMode plan, bool legacy)
        {
            if ((Positions != null && Positions.Any(p => p != null && p.Id == closed.Id)) ||
                IsExitDerivedTrade(closed.Label, closed.Comment) ||
                (!legacy && !MatchesExitTradePlanReason(plan, reason))) return;
            EnsureExitExecutionJobs();
            var identity = ResolveTradeIdentity(closed.Label, closed.Comment);
            if (identity.SourceTimeFrame == null || ResolveStrategyModeForId(identity.StrategyId) == BacktestStrategyMode.Off) return;
            var key = string.Format(CultureInfo.InvariantCulture, "EXITGROUP|{0}|{1}|{2}|{3}",
                closed.SymbolName, identity.SourceTimeFrame, slot, closed.Id);
            if (_exitExecutionJobs.ContainsKey(key) || IsExecutionActionTerminal(key)) return;
            var state = GetExecutionAction(key);
            if (_profitClosing || _profitControlBusy || _accountRiskStopTriggered || _totalWinAllStopped)
            {
                SetExecutionAction(state, ExecutionActionStatus.Blocked, "account_unwind_or_stop");
                SaveExecutionJournal();
                return;
            }
            using var actionPolicy = new ExecutionPolicyScope(this,
                ResolveStrategyDataProfileForMode(ResolveStrategyModeForId(identity.StrategyId), identity.StrategyId));
            var policyKey = CaptureExecutionPolicy(new AutoTradeRequest { Label = closed.Label, ExitMode = SelectedStrategyExitMode });
            var now = GetStrategySchedulerClockUtc();
            var job = new ExitExecutionJob { Key = key, StrategyId = identity.StrategyId, SymbolName = closed.SymbolName,
                Frame = identity.SourceTimeFrame, SourceEvent = GetStrategyCommentEventLabel(closed.Comment), PolicyKey = policyKey,
                ClosedSide = closed.TradeType, Reason = reason, Plan = plan, Slot = slot, ParentId = closed.Id,
                ExitUtc = now, NextAttemptUtc = now, Legacy = legacy,
                ParentLabel = closed.Label, ParentComment = closed.Comment };
            if (!TryVerifyOriginalExitParent(job)) return;
            BacktestStrategySignal prepared;
            if (TryBuildOnExitTradeSignal(closed, reason, ResolveStrategyModeForId(identity.StrategyId),
                identity.StrategyId, job.SourceEvent, job.Frame, slot,
                legacy ? StrategyTradeChainMode.OnExit_cont : plan, out prepared))
            {
                prepared.IsLegacyExitReverse = legacy;
                prepared.TradeChainModeOverride = plan;
                job.Signal = prepared;
            }
            _exitExecutionJobs.Add(key, job);
            SetExecutionAction(state, ExecutionActionStatus.Ready, "exit_queued");
            SaveExitExecutionJobs();
        }

        private bool PrepareExitExecutionSignal(ExitExecutionJob job)
        {
            if (!TryVerifyOriginalExitParent(job)) return false;
            if (job.Signal.IsValid) return true;
            var side = ReverseTradeType(job.ClosedSide);
            if (!job.Legacy && !TryResolveOnExitTradeType(job.Plan, job.ClosedSide, job.Reason, out side)) return false;
            var bars = GetBarsForCurrentMasterTimer(job.Frame, job.SymbolName);
            if (bars == null || bars.Count < 3) return false;
            var index = bars.Count - 2;
            while (index >= 0 && ResolveSourceBarEndTime(bars, bars.OpenTimes[index], job.Frame) > job.ExitUtc) index--;
            if (index < 0) return false;
            using var decision = BeginCausalBarDecision(bars, job.Frame, index, job.SymbolName);
            job.Signal = new BacktestStrategySignal {
                IsValid = true, StrategyId = job.StrategyId, StrategyMode = ResolveStrategyModeForId(job.StrategyId),
                SymbolName = job.SymbolName, SourceLabel = job.SourceEvent, SourceTimeFrame = job.Frame,
                SignalTime = bars.OpenTimes[index], EntryConfirmationTime = bars.OpenTimes[index], PatternToEntryBars = 1,
                TradeChainSlot = job.Slot, TradeChainModeOverride = job.Plan, TradeType = side,
                OnExitParentId = job.ParentId, OnExitParentIsOriginal = true, OnExitTime = job.ExitUtc, OnExitReason = job.Reason == PositionCloseReason.TakeProfit ? "TP" : "SL",
                IsLegacyExitReverse = job.Legacy, EventCandleLow = bars.LowPrices[index], EventCandleHigh = bars.HighPrices[index],
                EventSlDistance = Math.Max(0, bars.HighPrices[index] - bars.LowPrices[index]),
                Note = "[exit parent=" + job.ParentId.ToString(CultureInfo.InvariantCulture) + "; reason=" + job.Reason + "]" };
            return true;
        }

        private void ProcessExitExecutionJobs()
        {
            if (_exitJobsProcessing || _activeExecutionAction != null || IsStartupWarmupActive()) return;
            _exitJobsProcessing = true;
            try
            {
                EnsureExitExecutionJobs();
                if (_exitExecutionJobs.Count == 0) return;
                var now = GetStrategySchedulerClockUtc();
                // A bounded queue slice keeps position events and chart/UI work responsive.
                foreach (var job in _exitExecutionJobs.Values.Where(j => j.NextAttemptUtc <= now)
                    .OrderBy(j => j.ExitUtc).ThenBy(j => j.Slot).Take(12).ToList())
                {
                    var state = GetExecutionAction(job.Key);
                    if (IsExecutionActionTerminal(job.Key)) { _exitExecutionJobs.Remove(job.Key); continue; }
                    try
                    {
                        if (!TryVerifyOriginalExitParent(job))
                            SetExecutionAction(state, ExecutionActionStatus.Blocked, "exit_parent_not_original_or_unverifiable");
                        else if (_profitClosing || _profitControlBusy || _accountRiskStopTriggered || _totalWinAllStopped)
                            SetExecutionAction(state, ExecutionActionStatus.Blocked, "account_unwind_or_stop");
                        else
                        {
                            EnsureExecutionPolicies();
                            StrategyDataProfile profile;
                            if (!_executionPolicies.TryGetValue(job.PolicyKey, out profile))
                                SetExecutionAction(state, ExecutionActionStatus.Failed, "execution_policy_unavailable");
                            else
                            {
                                using var policy = new ExecutionPolicyScope(this, profile);
                                var block = GetStrategyTradingTimeBlockReasonForExposure(now, false);
                                if (!string.IsNullOrWhiteSpace(block)) SetExecutionAction(state, ExecutionActionStatus.Blocked, block);
                                else if (!ShouldStrategySubmitOrdersForMarket(job.SymbolName, job.Frame))
                                    SetExecutionAction(state, ExecutionActionStatus.Blocked, "execution_market_disabled");
                                else if (PrepareExitExecutionSignal(job))
                                {
                                    // Never retry a stale exit on a later source bar.
                                    var end = ResolveSourceBarEndTime(GetBarsForCurrentMasterTimer(job.Frame, job.SymbolName),
                                        job.Signal.SignalTime, job.Frame);
                                    var frameSeconds = Math.Max(1, (end - job.Signal.SignalTime).TotalSeconds);
                                    if (now >= end.AddSeconds(frameSeconds))
                                        SetExecutionAction(state, ExecutionActionStatus.Failed, "exit_retry_window_elapsed");
                                    else
                                    {
                                        job.Attempts++;
                                        ExecuteBacktestStrategySignalStage(job.SymbolName, job.Signal, false);
                                    }
                                }
                                else
                                {
                                    job.Attempts++;
                                    SetExecutionAction(state, ExecutionActionStatus.RetryableFailure, "completed_source_data_unavailable");
                                }
                            }
                        }
                    }
                    catch (Exception ex) { SetExecutionAction(state, ExecutionActionStatus.Failed, ex.GetType().Name + ":" + ex.Message); }
                    if (state.Status == ExecutionActionStatus.RetryableFailure && job.Attempts < 3)
                        job.NextAttemptUtc = now.AddSeconds(2 * Math.Max(1, job.Attempts));
                    else
                    {
                        if (state.Status == ExecutionActionStatus.RetryableFailure)
                            SetExecutionAction(state, ExecutionActionStatus.Failed, "retry_limit:" + state.Reason);
                        _exitExecutionJobs.Remove(job.Key);
                    }
                }
                SaveExecutionJournal();
                SaveExitExecutionJobs();
            }
            catch (Exception ex) { SafePrint("[Execution] Exit scheduler failed: {0}", ex.Message); }
            finally { _exitJobsProcessing = false; }
        }

        private void SaveExitExecutionJobs()
        {
            if (IsBacktestingRuntime()) return;
            var json = BuildExitExecutionJobsJson();
            if (json == _lastExitJobsSaved) return;
            LocalStorage.SetString(ExitJobsStorageKey, json, LocalStorageScope.Instance);
            LocalStorage.Flush(LocalStorageScope.Instance);
            _lastExitJobsSaved = json;
        }

        private string BuildExitExecutionJobsJson()
        {
            return SerializeJsonValue(_exitExecutionJobs.Values.Select(j => (object)new Dictionary<string, object> {
                { "key", j.Key }, { "strategy", j.StrategyId }, { "symbol", j.SymbolName }, { "frame", j.Frame.ToString() },
                { "event", j.SourceEvent }, { "policy", j.PolicyKey }, { "side", j.ClosedSide.ToString() },
                { "reason", j.Reason.ToString() }, { "plan", j.Plan.ToString() }, { "slot", j.Slot },
                { "parent", j.ParentId }, { "parent_label", j.ParentLabel }, { "parent_comment", j.ParentComment }, { "utc", j.ExitUtc.ToString("O", CultureInfo.InvariantCulture) },
                { "attempts", j.Attempts }, { "next", j.NextAttemptUtc.ToString("O", CultureInfo.InvariantCulture) }, { "legacy", j.Legacy } }).ToList());
        }

        private void EnsureExitExecutionJobs()
        {
            if (_exitJobsLoaded) return;
            if (IsBacktestingRuntime()) { _exitJobsLoaded = true; return; }
            var json = LocalStorage.GetString(ExitJobsStorageKey, LocalStorageScope.Instance) ?? "";
            if (json.Length == 0) { _exitJobsLoaded = true; return; }
            RestoreExitExecutionJobs(json);
            _exitJobsLoaded = true;
        }

        private void RestoreExitExecutionJobs(string json)
        {
            var rows = CTraderRuleEngine.ParseJson(json) as System.Collections.IEnumerable;
            if (rows == null) throw new InvalidOperationException("invalid execution queue");
            foreach (var item in rows)
            {
                var row = item as Dictionary<string, object>;
                if (row == null) continue;
                string Value(string key) { return ConvertToInvariantString(GetDictionaryValue(row, key)); }
                DateTime utc, next; TradeType side; PositionCloseReason reason; StrategyTradeChainMode plan; TimeFrame frame;
                int slot, attempts; long parent; bool legacy;
                if (!DateTime.TryParse(Value("utc"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out utc) ||
                    !DateTime.TryParse(Value("next"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out next) ||
                    !Enum.TryParse(Value("side"), out side) || !Enum.TryParse(Value("reason"), out reason) ||
                    !Enum.TryParse(NormalizeTradePlanName(Value("plan")), true, out plan) ||
                    (!TimeFrame.TryParse(Value("frame"), out frame) && !TryParseTimeFrameToken(Value("frame"), out frame)) ||
                    !int.TryParse(Value("slot"), out slot) || slot < 1 || slot > 3 || !long.TryParse(Value("parent"), out parent) || parent <= 0 ||
                    !int.TryParse(Value("attempts"), out attempts) || attempts < 0 || attempts >= 3 ||
                    !bool.TryParse(Value("legacy"), out legacy) ||
                    (legacy ? plan != StrategyTradeChainMode.Now || reason != PositionCloseReason.StopLoss :
                        !MatchesExitTradePlanReason(plan, reason))) continue;
                var key = Value("key");
                if (key.Length == 0 || IsExecutionActionTerminal(key)) continue;
                var job = new ExitExecutionJob { Key = key, StrategyId = Value("strategy"), SymbolName = Value("symbol"),
                    SourceEvent = Value("event"), PolicyKey = Value("policy"), Frame = frame, ClosedSide = side, Reason = reason,
                    Plan = plan, Slot = slot, ParentId = parent, ExitUtc = utc, NextAttemptUtc = next, Attempts = attempts, Legacy = legacy,
                    ParentLabel = Value("parent_label"), ParentComment = Value("parent_comment") };
                if (!TryVerifyOriginalExitParent(job)) continue;
                _exitExecutionJobs[key] = job;
                var state = GetExecutionAction(key);
                if (state.Status != ExecutionActionStatus.RetryableFailure)
                    SetExecutionAction(state, ExecutionActionStatus.Ready, "exit_restored");
            }
        }
    }
}
