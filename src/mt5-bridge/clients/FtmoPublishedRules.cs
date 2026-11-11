using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.IO;
using System.Text.Json;

namespace cAlgo.Robots
{
    // Published FTMO CFD objectives. This is an audit ledger, separate from the
    // cBot's earlier protective exits and configurable Custom Rules.
    internal static class FtmoPublishedRules
    {
        internal enum Product { OneStep, TwoStep, Instant }
        internal enum Phase { Challenge, Verification, Account }
        internal enum Variant { Standard, Swing }
        internal enum ConsistencyVersion { Unknown, Current, LegacyBestDay }

        internal sealed class Trade
        {
            internal DateTime EntryUtc;
            internal DateTime? ExitUtc;
            internal double NetProfit;
            internal string Symbol;
        }

        internal sealed class RestrictedEvent
        {
            internal DateTime AtUtc;
            internal HashSet<string> Symbols = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            internal string Title;
        }

        internal sealed class MarketBreak
        {
            internal DateTime StartUtc;
            internal DateTime EndUtc;
            internal string Symbol;
        }

        internal sealed class Input
        {
            internal Product Product;
            internal Phase Phase;
            internal Variant Variant;
            internal ConsistencyVersion ConsistencyVersion;
            internal double InitialCapital;
            internal double CurrentBalance;
            internal double CurrentEquity;
            internal double MidnightBalance;
            internal double HighestMidnightBalance;
            internal double HighestClosedTradeBalance;
            internal double KnownMaximumLossFloor;
            internal DateTime AsOfUtc;
            internal DateTime CycleStartUtc;
            internal bool HasCompleteAccountHistory;
            internal bool HasCompleteRewardHistory;
            internal bool HasCompleteNewsCalendar;
            internal bool HasCompleteMarketBreakCalendar;
            internal bool HistoricalLossBreach;
            internal IReadOnlyList<Trade> Trades = Array.Empty<Trade>();
            internal IReadOnlyList<RestrictedEvent> RestrictedEvents = Array.Empty<RestrictedEvent>();
            internal IReadOnlyList<MarketBreak> MarketBreaks = Array.Empty<MarketBreak>();
        }

        internal sealed class EvidenceManifest
        {
            internal string Source;
            internal bool AccountHistoryComplete;
            internal bool RewardHistoryComplete;
            internal DateTime CycleStartUtc;
            internal DateTime NewsCoverageStartUtc;
            internal DateTime NewsCoverageEndUtc;
            internal DateTime MarketBreakCoverageStartUtc;
            internal DateTime MarketBreakCoverageEndUtc;
            internal List<RestrictedEvent> RestrictedEvents = new List<RestrictedEvent>();
            internal List<MarketBreak> MarketBreaks = new List<MarketBreak>();

            internal bool CoversNews(DateTime startUtc, DateTime endUtc) =>
                NewsCoverageStartUtc <= startUtc && NewsCoverageEndUtc >= endUtc &&
                NewsCoverageStartUtc != DateTime.MinValue;
            internal bool CoversMarketBreaks(DateTime startUtc, DateTime endUtc) =>
                MarketBreakCoverageStartUtc <= startUtc && MarketBreakCoverageEndUtc >= endUtc &&
                MarketBreakCoverageStartUtc != DateTime.MinValue;
        }

        internal static EvidenceManifest ReadEvidenceManifest(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return null;
            using (var doc = JsonDocument.Parse(File.ReadAllText(path)))
            {
                var root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object)
                    throw new FormatException("FTMO evidence root must be an object");
                var manifest = new EvidenceManifest
                {
                    Source = ReadString(root, "source"),
                    AccountHistoryComplete = ReadBool(root, "account_history_complete"),
                    RewardHistoryComplete = ReadBool(root, "reward_history_complete"),
                    CycleStartUtc = ReadUtc(root, "cycle_start_utc"),
                    NewsCoverageStartUtc = ReadUtc(root, "news_coverage_start_utc"),
                    NewsCoverageEndUtc = ReadUtc(root, "news_coverage_end_utc"),
                    MarketBreakCoverageStartUtc = ReadUtc(root, "market_break_coverage_start_utc"),
                    MarketBreakCoverageEndUtc = ReadUtc(root, "market_break_coverage_end_utc"),
                };
                if (string.IsNullOrWhiteSpace(manifest.Source))
                    throw new FormatException("FTMO evidence source is required");
                JsonElement events;
                if (root.TryGetProperty("restricted_events", out events))
                {
                    if (events.ValueKind != JsonValueKind.Array)
                        throw new FormatException("restricted_events must be an array");
                    foreach (var item in events.EnumerateArray())
                    {
                        var evt = new RestrictedEvent
                        {
                            AtUtc = ReadUtc(item, "at_utc"),
                            Title = ReadString(item, "title"),
                        };
                        JsonElement symbols;
                        if (item.TryGetProperty("symbols", out symbols) && symbols.ValueKind == JsonValueKind.Array)
                            foreach (var symbol in symbols.EnumerateArray())
                                if (symbol.ValueKind == JsonValueKind.String)
                                    evt.Symbols.Add(symbol.GetString());
                        if (evt.AtUtc == DateTime.MinValue || evt.Symbols.Count == 0)
                            throw new FormatException("Each FTMO restricted event needs at_utc and symbols");
                        manifest.RestrictedEvents.Add(evt);
                    }
                }
                JsonElement breaks;
                if (root.TryGetProperty("market_breaks", out breaks))
                {
                    if (breaks.ValueKind != JsonValueKind.Array)
                        throw new FormatException("market_breaks must be an array");
                    foreach (var item in breaks.EnumerateArray())
                    {
                        var marketBreak = new MarketBreak
                        {
                            StartUtc = ReadUtc(item, "start_utc"),
                            EndUtc = ReadUtc(item, "end_utc"),
                            Symbol = ReadString(item, "symbol"),
                        };
                        if (marketBreak.StartUtc == DateTime.MinValue ||
                            marketBreak.EndUtc <= marketBreak.StartUtc ||
                            string.IsNullOrWhiteSpace(marketBreak.Symbol))
                            throw new FormatException("Each FTMO market break needs start_utc, end_utc and symbol");
                        manifest.MarketBreaks.Add(marketBreak);
                    }
                }
                return manifest;
            }
        }

        private static string ReadString(JsonElement element, string name)
        {
            JsonElement value;
            return element.TryGetProperty(name, out value) && value.ValueKind == JsonValueKind.String
                ? value.GetString() : "";
        }

        private static bool ReadBool(JsonElement element, string name)
        {
            JsonElement value;
            return element.TryGetProperty(name, out value) && value.ValueKind == JsonValueKind.True;
        }

        private static DateTime ReadUtc(JsonElement element, string name)
        {
            var text = ReadString(element, name);
            if (string.IsNullOrWhiteSpace(text)) return DateTime.MinValue;
            DateTimeOffset value;
            if (!DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out value))
                throw new FormatException("Invalid FTMO UTC timestamp: " + name);
            return value.UtcDateTime;
        }

        internal sealed class Result
        {
            internal string ConfigurationError;
            internal double DailyFloor;
            internal double MaximumLossFloor;
            internal bool DailyLossBreachedNow;
            internal bool MaximumLossBreachedNow;
            internal double? ProfitTargetBalance;
            internal string ProfitTargetStatus;
            internal int TradingDays;
            internal string TradingDaysStatus;
            internal double? BestDayProfit;
            internal double? ConsistencyDenominator;
            internal string ConsistencyStatus;
            internal string RestrictedNewsStatus;
            internal string MarketBreakStatus;
            internal string RewardCycleStatus;
            internal string RewardEligibilityStatus;
            internal string PhaseObjectivesStatus;
            internal string TradingPracticeStatus = "unknown_ftmo_review";
            internal List<string> Evidence = new List<string>();
        }

        internal static Result Evaluate(Input input)
        {
            if (input == null) throw new ArgumentNullException(nameof(input));
            var result = new Result();
            if (!(input.InitialCapital > 0) || double.IsNaN(input.InitialCapital) || double.IsInfinity(input.InitialCapital))
                result.ConfigurationError = "initial_capital_required";
            else if (input.Product == Product.Instant && input.Phase != Phase.Account)
                result.ConfigurationError = "instant_has_account_phase_only";
            else if (input.Product == Product.OneStep && input.Phase == Phase.Verification)
                result.ConfigurationError = "one_step_has_no_verification";
            else if (input.Variant == Variant.Swing && input.Product != Product.TwoStep)
                result.ConfigurationError = "swing_is_two_step_only";
            if (result.ConfigurationError != null) return result;

            var capital = input.InitialCapital;
            var dailyAmount = capital * (input.Product == Product.TwoStep ? 0.05 : 0.03);
            result.DailyFloor = (input.MidnightBalance > 0 ? input.MidnightBalance : capital) - dailyAmount;
            var maximumReference = capital;
            if (input.Product == Product.OneStep)
                maximumReference = Math.Max(capital, input.HighestMidnightBalance);
            else if (input.Product == Product.Instant)
                maximumReference = Math.Max(capital, input.HighestClosedTradeBalance);
            result.MaximumLossFloor = maximumReference - capital * 0.10;
            if (input.KnownMaximumLossFloor > 0 && input.Product != Product.TwoStep)
                result.MaximumLossFloor = Math.Max(result.MaximumLossFloor, input.KnownMaximumLossFloor);
            // FTMO's published text says "below" the limit, not "at or below".
            result.DailyLossBreachedNow = input.CurrentEquity < result.DailyFloor;
            result.MaximumLossBreachedNow = input.CurrentEquity < result.MaximumLossFloor;

            var isEvaluation = input.Phase != Phase.Account;
            var targetPercent = !isEvaluation ? 0 :
                input.Product == Product.TwoStep && input.Phase == Phase.Verification ? 0.05 : 0.10;
            if (targetPercent > 0)
            {
                result.ProfitTargetBalance = capital * (1 + targetPercent);
                result.ProfitTargetStatus = !input.HasCompleteAccountHistory ? "unknown_incomplete_history" :
                    input.CurrentBalance + 0.000001 >= result.ProfitTargetBalance.Value &&
                    !input.Trades.Any(t => !t.ExitUtc.HasValue) ? "met" : "unmet";
            }
            else result.ProfitTargetStatus = "not_applicable";

            var zone = GetCentralEuropeanTimeZone();
            var trades = input.Trades ?? Array.Empty<Trade>();
            var cycleTrades = trades.Where(t => t != null &&
                (input.CycleStartUtc == DateTime.MinValue || t.EntryUtc >= input.CycleStartUtc)).ToArray();
            result.TradingDays = cycleTrades.Select(t => TimeZoneInfo.ConvertTimeFromUtc(
                    EnsureUtc(t.EntryUtc), zone).Date).Distinct().Count();
            result.TradingDaysStatus = input.Product == Product.TwoStep && isEvaluation
                ? !input.HasCompleteAccountHistory ? "unknown_incomplete_history" :
                    result.TradingDays >= 4 ? "met" : "unmet"
                : "not_applicable";

            if (input.Product == Product.TwoStep)
                result.ConsistencyStatus = "not_applicable";
            else if (!input.HasCompleteAccountHistory)
                result.ConsistencyStatus = "unknown_incomplete_history";
            else if (input.Product == Product.OneStep &&
                input.ConsistencyVersion == ConsistencyVersion.Unknown)
                result.ConsistencyStatus = "unknown_order_or_merge_date";
            else
            {
                var closed = trades.Where(t => t != null && t.ExitUtc.HasValue &&
                    (input.CycleStartUtc == DateTime.MinValue ||
                     t.ExitUtc.Value >= input.CycleStartUtc)).ToArray();
                var dayProfits = closed.GroupBy(t => TimeZoneInfo.ConvertTimeFromUtc(
                        EnsureUtc(t.ExitUtc.Value), zone).Date)
                    .Select(g => g.Sum(t => t.NetProfit)).ToArray();
                result.BestDayProfit = dayProfits.Length == 0 ? 0 : dayProfits.Max();
                result.ConsistencyDenominator = input.Product == Product.OneStep &&
                    input.ConsistencyVersion == ConsistencyVersion.LegacyBestDay
                    ? dayProfits.Where(p => p > 0).Sum() : dayProfits.Sum();
                var fraction = input.Product == Product.Instant ? 0.30 : 0.50;
                result.ConsistencyStatus = result.ConsistencyDenominator > 0 &&
                    result.BestDayProfit <= fraction * result.ConsistencyDenominator + 0.000001
                    ? "met" : "unmet";
            }

            var restricted = input.Phase == Phase.Account && input.Variant == Variant.Standard;
            result.RestrictedNewsStatus = !restricted ? "not_applicable" :
                !input.HasCompleteAccountHistory ? "unknown_incomplete_history" :
                !input.HasCompleteNewsCalendar ? "unknown_ftmo_calendar" :
                HasRestrictedNewsExecution(trades.Where(t => t != null &&
                    (input.CycleStartUtc == DateTime.MinValue || t.EntryUtc >= input.CycleStartUtc ||
                     t.ExitUtc.HasValue && t.ExitUtc.Value >= input.CycleStartUtc)),
                    input.RestrictedEvents ?? Array.Empty<RestrictedEvent>(), result.Evidence)
                    ? "violated" : "no_violation_observed";
            result.MarketBreakStatus = !restricted ? "not_applicable" :
                !input.HasCompleteAccountHistory ? "unknown_incomplete_history" :
                !input.HasCompleteMarketBreakCalendar ? "unknown_market_calendar" :
                HasLongBreakExposure(trades.Where(t => t != null),
                    input.MarketBreaks ?? Array.Empty<MarketBreak>(), result.Evidence)
                    ? "violated" : "no_violation_observed";
            result.RewardCycleStatus = input.Phase != Phase.Account ? "not_applicable" :
                !input.HasCompleteRewardHistory || input.CycleStartUtc == DateTime.MinValue
                    ? "unknown_reward_history" : "cycle_start_supplied";
            if (isEvaluation)
            {
                result.PhaseObjectivesStatus = input.HistoricalLossBreach ||
                    result.DailyLossBreachedNow || result.MaximumLossBreachedNow
                    ? "failed_loss_rule" :
                    IsUnknown(result.ProfitTargetStatus) || IsUnknown(result.TradingDaysStatus) ||
                    IsUnknown(result.ConsistencyStatus) ? "unknown_missing_evidence" :
                    result.ProfitTargetStatus == "met" &&
                    (result.TradingDaysStatus == "met" || result.TradingDaysStatus == "not_applicable") &&
                    (result.ConsistencyStatus == "met" || result.ConsistencyStatus == "not_applicable")
                        ? "locally_met_pending_ftmo_review" : "unmet";
                result.RewardEligibilityStatus = "not_applicable";
            }
            else
            {
                result.PhaseObjectivesStatus = "not_applicable";
                var firstEntry = cycleTrades.Length == 0 ? DateTime.MinValue : cycleTrades.Min(t => t.EntryUtc);
                var closedProfit = trades.Where(t => t != null && t.ExitUtc.HasValue &&
                        (input.CycleStartUtc == DateTime.MinValue || t.ExitUtc.Value >= input.CycleStartUtc))
                    .Sum(t => t.NetProfit);
                result.RewardEligibilityStatus = !input.HasCompleteRewardHistory ||
                    !input.HasCompleteAccountHistory || input.CycleStartUtc == DateTime.MinValue
                    ? "unknown_reward_or_account_history" :
                    input.HistoricalLossBreach || result.DailyLossBreachedNow ||
                    result.MaximumLossBreachedNow
                    ? "failed_loss_rule" : IsUnknown(result.ConsistencyStatus)
                    ? "unknown_consistency_version" :
                    firstEntry != DateTime.MinValue && input.AsOfUtc >= firstEntry.AddDays(14) &&
                    closedProfit > 0 && !trades.Any(t => t != null && !t.ExitUtc.HasValue) &&
                    (result.ConsistencyStatus == "met" || result.ConsistencyStatus == "not_applicable")
                        ? "locally_eligible_pending_ftmo_review" : "unmet";
            }
            return result;
        }

        private static bool IsUnknown(string status) => status != null &&
            status.StartsWith("unknown", StringComparison.Ordinal);

        private static bool HasRestrictedNewsExecution(IEnumerable<Trade> trades,
            IEnumerable<RestrictedEvent> events, List<string> evidence)
        {
            var violated = false;
            foreach (var trade in trades)
            foreach (var evt in events)
            {
                if (evt == null || evt.Symbols == null || !evt.Symbols.Contains(trade.Symbol ?? ""))
                    continue;
                var start = evt.AtUtc.AddMinutes(-2);
                var end = evt.AtUtc.AddMinutes(2);
                var entry = trade.EntryUtc >= start && trade.EntryUtc <= end;
                var exit = trade.ExitUtc.HasValue && trade.ExitUtc.Value >= start && trade.ExitUtc.Value <= end;
                if (!entry && !exit) continue;
                violated = true;
                evidence.Add(string.Format(CultureInfo.InvariantCulture,
                    "restricted_news symbol={0} event_utc={1:O} event={2} execution={3} execution_utc={4:O}",
                    trade.Symbol, evt.AtUtc, evt.Title, entry ? "entry" : "exit",
                    entry ? trade.EntryUtc : trade.ExitUtc.Value));
                if (entry && exit)
                    evidence.Add(string.Format(CultureInfo.InvariantCulture,
                        "restricted_news symbol={0} event_utc={1:O} event={2} execution=exit execution_utc={3:O}",
                        trade.Symbol, evt.AtUtc, evt.Title, trade.ExitUtc.Value));
            }
            return violated;
        }

        private static bool HasLongBreakExposure(IEnumerable<Trade> trades,
            IEnumerable<MarketBreak> breaks, List<string> evidence)
        {
            var violated = false;
            foreach (var trade in trades)
            foreach (var marketBreak in breaks)
            {
                if (marketBreak == null ||
                    marketBreak.EndUtc - marketBreak.StartUtc <= TimeSpan.FromHours(2) ||
                    !string.Equals(trade.Symbol, marketBreak.Symbol, StringComparison.OrdinalIgnoreCase))
                    continue;
                if (trade.EntryUtc < marketBreak.StartUtc &&
                    (!trade.ExitUtc.HasValue || trade.ExitUtc.Value >= marketBreak.StartUtc))
                {
                    violated = true;
                    evidence.Add(string.Format(CultureInfo.InvariantCulture,
                        "market_break symbol={0} break_start_utc={1:O} break_end_utc={2:O} entry_utc={3:O} exit_utc={4}",
                        trade.Symbol, marketBreak.StartUtc, marketBreak.EndUtc, trade.EntryUtc,
                        trade.ExitUtc.HasValue ? trade.ExitUtc.Value.ToString("O", CultureInfo.InvariantCulture) : "open"));
                }
            }
            return violated;
        }

        private static DateTime EnsureUtc(DateTime value)
        {
            return value.Kind == DateTimeKind.Utc ? value :
                DateTime.SpecifyKind(value, DateTimeKind.Utc);
        }

        private static TimeZoneInfo GetCentralEuropeanTimeZone()
        {
            foreach (var id in new[] { "Europe/Prague", "Central Europe Standard Time", "W. Europe Standard Time" })
            {
                try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
                catch (TimeZoneNotFoundException) { }
            }
            throw new TimeZoneNotFoundException("FTMO CE(S)T timezone is unavailable");
        }
    }
}
