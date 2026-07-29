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
using System.IO;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.FullAccess)]
    public class TVBridgeCBot : Robot
    {
        private const string BuildVersion = "v2026.07.23 23:10 - structure-risk-fix";
        private const string BridgeSourceId = "Ctrader";
        private const string BridgeSourceType = "ctrader_bridge";
        private const int TransientErrorLogThresholdCount = 10;
        private const int TransientErrorLogThresholdSeconds = 30;
        private const string CustomUiSettingsFileName = "ctrader_ui_settings.txt";
        private const string DefaultBaseServerPath = "/Users/macmini/Projects/moza/42trade";
        private const string DefaultBacktestUserId = "default";
        private bool _showProcessDebugPanel = true;
        private StackPanel _chartButtonPanel;
        private StackPanel _chartSummaryPanel;
        private StackPanel _chartVisualTogglePanel;
        private StackPanel _chartVisualQuickPanel;
        private readonly Dictionary<string, List<CanonicalMarketEvent>> _dashboardEventCache = new Dictionary<string, List<CanonicalMarketEvent>>(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _backtestStrategyHandledEventKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, BacktestExportTradeSnapshot> _backtestExportTradeSnapshots = new Dictionary<string, BacktestExportTradeSnapshot>(StringComparer.OrdinalIgnoreCase);
        private readonly List<BacktestExportTradeSnapshot> _backtestExportTradeSequence = new List<BacktestExportTradeSnapshot>();
        private bool _backtestRiskStopTriggered;
        private string _backtestRiskStopReason = "";
        private object _chartSymbolCombo;
        private object _chartDirectionCombo;
        private object _chartTradeTypeCombo;
        private string _chartSelectedSymbol = "";
        private string _chartSelectedDirection = "All";
        private string _chartSelectedTradeProfile = "Scalp";
        private string _chartSymbolsSignature = "";
        private const string ChartAllSymbolsOption = "All";
        private bool _isRebuildingChartPanel = false;
        private bool _toggleKillerZones;
        private bool _toggleLiquidityLevels;
        private bool _toggleSweepDetections;
        private bool _toggleBosDetections;
        private bool _toggleChochDetections;
        private bool _toggleRejectionDetections;
        private bool _toggleBreakoutDetections;
        private bool _togglePullbackDetections;
        private bool _toggleContinuationDetections;
        private bool _toggleImpulseDetections;
        private bool _togglePinBarPatterns = true;
        private bool _toggleEngulfingPatterns = true;
        private bool _toggleBigCandlePatterns = true;
        private bool _toggleMorningStarPatterns = true;
        private bool _toggleEveningStarPatterns = true;
        private bool _toggleHammerPatterns = true;
        private bool _toggleHangingManPatterns = true;
        private bool _toggleShootingStarPatterns = true;
        private bool _toggleInvertedHammerPatterns = true;
        private bool _togglePiercingLinePatterns = true;
        private bool _toggleDarkCloudCoverPatterns = true;
        private bool _toggleThreeWhiteSoldiersPatterns = true;
        private bool _toggleThreeBlackCrowsPatterns = true;
        private bool _toggleHaramiPatterns = true;
        private bool _toggleEmaOverlay = true;
        private bool _toggleVwapOverlay = true;
        private bool _toggleBollingerOverlay = true;
        private bool _toggleEmaEvents = true;
        private bool _toggleVwapEvents = true;
        private bool _toggleBollingerEvents = true;
        private bool _toggleRsiEvents = true;
        private bool _toggleStochasticEvents = true;
        private bool _toggleMacdEvents = true;
        private bool _toggleFvgZones;
        private bool _toggleOrderBlocks;
        private bool _toggleHigherTimeframeZones;
        private bool _toggleHtf15 = true;
        private bool _toggleHtf4H = true;
        private bool _toggleHtf1D = true;
        private bool _toggleHtfMiniChart;
        private bool _toggleKeyLevels = true;
        private bool _toggleStrategyMarkers = true;
        private readonly Dictionary<string, string> _customUiSettings = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private string _customUiSettingsSerializedSnapshot = "";
        private readonly Dictionary<string, long> _liveStrategyLastProcessedBarTicks = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<long, StrategyPositionSnapshot> _trackedStrategyPositions = new Dictionary<long, StrategyPositionSnapshot>();
        private readonly List<StrategyChartMarker> _strategyChartMarkers = new List<StrategyChartMarker>();
        private string _lastStopReason = "external_or_unknown";
        private DateTime _startedAtUtc = DateTime.MinValue;
        private Color _lastPanelMessageColor = Color.White;
        private bool _backtestExportActive = false;
        private string _backtestExportRunId = "";
        private string _backtestExportRunDir = "";
        private string _backtestExportStrategyKey = "";
        private string _backtestExportStrategyName = "";
        private string _backtestExportUserId = DefaultBacktestUserId;
        private DateTime _backtestExportStartedUtc = DateTime.MinValue;
        private double _backtestExportInitialEquity = 0;
        private double _backtestExportInitialBalance = 0;
        [Parameter("Base API", DefaultValue = "http://127.0.0.1:3001/api")]
        public string ServerBaseUrl { get; set; }

        [Parameter("Base server", DefaultValue = DefaultBaseServerPath)]
        public string BaseServerPath { get; set; }

        [Parameter("EA API Key", DefaultValue = "acc_506cb604d10644736df6a7bf77c79fd30731")]
        public string EaApiKey { get; set; }

        public enum RiskTemplate
        {
            Custom,
            FTMO_1Step,
            FTMO_2Step,
            The5ers_HighStakes,
            FundedNext_Stellar_2Step,
            FundedNext_Stellar_1Step,
            FundedNext_Stellar_Lite,
            FTPlus_1Step_Express
        }

        public enum ChartMarkerFontSizeMode
        {
            None,
            Tiny,
            Small,
            Medium,
            Large
        }

        public enum ChartMarkerSymbolMode
        {
            Arrows,
            Triangles
        }

        public enum ChartLabelVisibilityMode
        {
            Yes,
            No
        }

        [Parameter("Rules Profile", DefaultValue = RiskTemplate.FTMO_1Step)]
        public RiskTemplate SelectedRiskTemplate { get; set; }

        [Parameter("M. Day Loss %", Group = "Custom Rules", DefaultValue = 3.0, MinValue = 0, Step = 0.5)]
        public double MaxDailyLossPercent { get; set; }

        [Parameter("M. DD %", Group = "Custom Rules", DefaultValue = 10.0, MinValue = 0, Step = 1)]
        public double MaxEquityDrawdownPercent { get; set; }

        [Parameter("News block", Group = "Trade Config", DefaultValue = NewsBlockPreset._90m)]
        public NewsBlockPreset SelectedNewsBlockPreset { get; set; }

        [Parameter("Overnight block", Group = "Trade Config", DefaultValue = true)]
        public bool NoOvernightHold { get; set; }

        [Parameter("Weekend block", Group = "Trade Config", DefaultValue = true)]
        public bool NoWeekendHold { get; set; }

        [Parameter("M. Trade Risk %", Group = "Trade Config", DefaultValue = 0.5, MinValue = 0, Step = 0.1)]
        public double MaxRiskPercent { get; set; }

        [Parameter("M. Total Risk %", Group = "Trade Config", DefaultValue = 1.5, MinValue = 0)]
        public double MaxTotalOpenRiskPercent { get; set; }

        [Parameter("M. Margin %", Group = "Trade Config", DefaultValue = 98, MinValue = 0, MaxValue = 100)]
        public double MarginSafetyPercent { get; set; }

        [Parameter("m. Stop pips", Group = "Trade Config", DefaultValue = 15, MinValue = 5)]
        public double MinStopPips { get; set; }

        [Parameter("M. Stop/TP pips", Group = "Trade Config", DefaultValue = 5000, MinValue = 50)]
        public double MaxProtectionPips { get; set; }

        [Parameter("M. RR", Group = "Trade Config", DefaultValue = 20, MinValue = 1)]
        public double MaxRewardRiskRatio { get; set; }

        [Parameter("On SL/TP err", Group = "Trade Config", DefaultValue = "Adjust")]
        public string OnSlTpError { get; set; }  // "Reject" = cancel trade, "Adjust" = auto-widen to meet minimum, "Continue" = keep position without SL/TP

        public enum BacktestStrategyMode
        {
            Off,
            HtfEventMarket,
            LtfEventMarket,
            EmaCrossV1,
            SmaCrossV1,
            GoldenCrossV1,
            TripleEmaTrendV1,
            RsiReversionV1,
            BollingerReversionV1,
            StochReversalV1,
            MacdSignalV1,
            RocMomentumV1,
            DonchianBreakoutV1,
            Trend,
            Impulse,
            PriceActionV1,
            PriceActionEventDetectorV1,
            PriceActionFvgContextV1,
            ArtifactSuggestedLevelsV1,
            ArtifactSuggestedLevelsV2,
            ArtifactSuggestedLevelsV2LimitBodyMid,
            AiSnapshotContextV1
        }

        public enum StrategyExposureMode
        {
            Off,
            PositionOnly,
            PositionAndOrder
        }

        public enum StrategyTriggerMode
        {
            Timer1s,
            OnBar,
            OnBarClosed,
            Ticker
        }

        public enum StrategyEntryType
        {
            _0_market,
            _0_1_limit,
            _0_2_limit,
            _0_3_limit
        }

        public enum StrategyDaysPreset
        {
            Weekdays,
            All,
            Weekend,
            Monday,
            Tuesday,
            Wednesday,
            Thursday,
            Friday,
            MonToThu,
            TueToFri,
            Off
        }

        public enum StrategySessionsPreset
        {
            All,
            Asia,
            London,
            NewYork,
            Ld_Ny,
            A_Ld_Ny,
            Off
        }

        public enum NewsBlockPreset
        {
            No,
            _30m,
            _60m,
            _90m,
            _120m
        }

        [Parameter("Live trade", Group = "Strategies", DefaultValue = true)]
        public bool EnableLiveStrategyTrading { get; set; }

        [Parameter("M. risk/idea", Group = "Trade Config", DefaultValue = 1.0, MinValue = 0)]
        public double MaxSameSymbolDirectionRiskPercent { get; set; }

        [Parameter("M. pos/idea", Group = "Trade Config", DefaultValue = 10, MinValue = 1)]
        public int MaxPositionsPerIdea { get; set; }

        [Parameter("M. pos total", Group = "Trade Config", DefaultValue = 20, MinValue = 1)]
        public int MaxPositionsTotal { get; set; }


        [Parameter("Strategy", Group = "Strategies", DefaultValue = BacktestStrategyMode.Trend)]
        public BacktestStrategyMode SelectedBacktestStrategy { get; set; }

        [Parameter("Strategy2", Group = "Strategies", DefaultValue = BacktestStrategyMode.Impulse)]
        public BacktestStrategyMode SelectedBacktestStrategy2 { get; set; }

        [Parameter("Strategy3", Group = "Strategies", DefaultValue = BacktestStrategyMode.Off)]
        public BacktestStrategyMode SelectedBacktestStrategy3 { get; set; }

        [Parameter("Strategy4", Group = "Strategies", DefaultValue = BacktestStrategyMode.Off)]
        public BacktestStrategyMode SelectedBacktestStrategy4 { get; set; }

        [Parameter("Strategy5", Group = "Strategies", DefaultValue = BacktestStrategyMode.Off)]
        public BacktestStrategyMode SelectedBacktestStrategy5 { get; set; }

        [Parameter("Symbols", Group = "Strategies", DefaultValue = "")]
        public string StrategySymbols { get; set; }

        [Parameter("Timeframes", Group = "Strategies", DefaultValue = "")]
        public string StrategyTimeframes { get; set; }

        [Parameter("Exposure mode", Group = "Strategies", DefaultValue = StrategyExposureMode.PositionOnly)]
        public StrategyExposureMode SelectedStrategyExposureMode { get; set; }

        [Parameter("Trigger", Group = "Strategies", DefaultValue = StrategyTriggerMode.OnBarClosed)]
        public StrategyTriggerMode SelectedStrategyTriggerMode { get; set; }

        [Parameter("Entry type", Group = "Strategies", DefaultValue = StrategyEntryType._0_1_limit)]
        public StrategyEntryType SelectedStrategyEntryType { get; set; }

        [Parameter("TP/SL RR", Group = "Strategies", DefaultValue = 1.1, MinValue = 0.1)]
        public double StrategyRewardRisk { get; set; }

        [Parameter("Days", Group = "Strategies", DefaultValue = StrategyDaysPreset.Weekdays)]
        public StrategyDaysPreset StrategyDaysPresetValue { get; set; }

        [Parameter("Sessions", Group = "Strategies", DefaultValue = StrategySessionsPreset.A_Ld_Ny)]
        public StrategySessionsPreset StrategySessionsPresetValue { get; set; }

        [Parameter("Trailing Stop", Group = "Strategies", DefaultValue = false)]
        public bool EnableTrailingStop { get; set; }

        [Parameter("Candles", Group = "Strategy_FollowTrend", DefaultValue = 3, MinValue = 1, Step = 1)]
        public int FollowTrendCandlesCount { get; set; }

        [Parameter("SL candle", Group = "Strategy_FollowTrend", DefaultValue = 1, MinValue = 1)]
        public int FollowTrendSlCandleNum { get; set; }

        [Parameter("Body % min", Group = "Strategy_FollowTrend_BigCandle", DefaultValue = 95.0, MinValue = 50.0, MaxValue = 100.0)]
        public double FollowTrendBigCandleBodyPercentMin { get; set; }

        [Parameter("Price push", Group = "Sync with server", DefaultValue = true)]
        public bool PricePushEnabled { get; set; }

        [Parameter("Price push sec", Group = "Sync with server", DefaultValue = 60, MinValue = 15)]
        public int PricePushSeconds { get; set; }

        [Parameter("Bar push", Group = "Sync with server", DefaultValue = true)]
        public bool BarPushEnabled { get; set; }

        [Parameter("Bar push sec", Group = "Sync with server", DefaultValue = 30, MinValue = 15)]
        public int BarPushSeconds { get; set; }

        [Parameter("Inc bars", Group = "Sync with server", DefaultValue = true)]
        public bool EnableIncrementalBars { get; set; }

        [Parameter("Inc sync sec", Group = "Sync with server", DefaultValue = 120, MinValue = 30)]
        public int IncrementalBarsSeconds { get; set; }

        [Parameter("M. Bars Per Post", Group = "Sync with server", DefaultValue = 200, MinValue = 10)]
        public int IncrementalBarsMaxPerPost { get; set; }

        [Parameter("Sync sec", Group = "Sync with server", DefaultValue = 10, MinValue = 5)]
        public int SyncIntervalSeconds { get; set; }

        [Parameter("Sync timeout", Group = "Sync with server", DefaultValue = 20, MinValue = 5)]
        public int SyncTimeoutSeconds { get; set; }

        [Parameter("Timer sec", Group = "Sync with server", DefaultValue = 1, MinValue = 1)]
        public int MasterTimerSeconds { get; set; }

        [Parameter("Poll timeout", Group = "Sync with server", DefaultValue = 12, MinValue = 3)]
        public int PollTimeoutSeconds { get; set; }

        [Parameter("Poll Sec", Group = "Logging", DefaultValue = 2, MinValue = 1)]
        public int PollSeconds { get; set; }

        [Parameter("Log Filter", Group = "Logging", DefaultValue = "Error,Reject")]
        public string LogFilter { get; set; }

        [Parameter("Popup Alerts", Group = "Logging", DefaultValue = true)]
        public bool EnablePopupAlerts { get; set; }

        [Parameter("Alert Sound", Group = "Logging", DefaultValue = false)]
        public bool EnableAlertSound { get; set; }

        [Parameter("Draw Killer Zones", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawKillerZones { get; set; }

        [Parameter("Draw Liquidity", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawLiquidityLevels { get; set; }

        [Parameter("Draw Sweep", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawSweepDetections { get; set; }

        [Parameter("Draw BOS", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawBosDetections { get; set; }

        [Parameter("Draw CHOCH", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawChochDetections { get; set; }

        [Parameter("Draw Rejection", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawRejectionDetections { get; set; }

        [Parameter("Draw Breakout", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawBreakoutDetections { get; set; }

        [Parameter("Draw Pullback", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawPullbackDetections { get; set; }

        [Parameter("Draw Continuation", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawContinuationDetections { get; set; }

        [Parameter("Draw Impulse", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawImpulseDetections { get; set; }

        [Parameter("KZ Days", Group = "Chart Visuals", DefaultValue = 10, MinValue = 1, MaxValue = 10)]
        public int KillerZoneDays { get; set; }

        [Parameter("Draw FVG", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawFvgZones { get; set; }

        [Parameter("Draw OB", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawOrderBlocks { get; set; }

        [Parameter("Draw HTF Zones", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawHigherTimeframeZones { get; set; }

        [Parameter("Draw HTF Mini", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawHtfMiniChart { get; set; }

        [Parameter("Show Strategy", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawStrategyMarkers { get; set; }

        [Parameter("Draw EMA", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawEmaOverlay { get; set; }

        [Parameter("Draw VWAP", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawVwapOverlay { get; set; }

        [Parameter("Draw Bollinger", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawBollingerOverlay { get; set; }

        [Parameter("Draw EMA evt", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawEmaEvents { get; set; }

        [Parameter("Draw VWAP evt", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawVwapEvents { get; set; }

        [Parameter("Draw BB evt", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawBollingerEvents { get; set; }

        [Parameter("Draw RSI evt", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawRsiEvents { get; set; }

        [Parameter("Draw Stoch evt", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawStochasticEvents { get; set; }

        [Parameter("Draw MACD evt", Group = "Chart Visuals", DefaultValue = true)]
        public bool DrawMacdEvents { get; set; }

        [Parameter("Marker Font", Group = "Chart Visuals", DefaultValue = ChartMarkerFontSizeMode.Small)]
        public ChartMarkerFontSizeMode MarkerFontSize { get; set; }

        [Parameter("Marker Symbol", Group = "Chart Visuals", DefaultValue = ChartMarkerSymbolMode.Triangles)]
        public ChartMarkerSymbolMode MarkerSymbol { get; set; }

        [Parameter("Show Label", Group = "Chart Visuals", DefaultValue = ChartLabelVisibilityMode.Yes)]
        public ChartLabelVisibilityMode ShowMarkerLabel { get; set; }

        [Parameter("OB Full Wick", Group = "Chart Visuals", DefaultValue = true)]
        public bool OrderBlockUseFullWick { get; set; }


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
        private string _lastPopupAlertMessage = "";
        private DateTime _lastPopupAlertAt = DateTime.MinValue;

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

        private sealed class TimedCacheEntry<T>
        {
            public DateTime CreatedAtUtc;
            public T Value;
        }

        private sealed class NewsGateEvent
        {
            public string Title;
            public string Phase;
            public int MinutesUntilStart;
            public int MinutesUntilEnd;
            public List<string> EffectiveSymbols;
        }

        private sealed class StrategyExecutionTarget
        {
            public string SymbolName;
            public TimeFrame TimeFrame;
        }

        private Dictionary<string, List<PartialTP>> _tradePartials = new Dictionary<string, List<PartialTP>>();
        private HashSet<string> _executedPartials = new HashSet<string>(); // key: ticket_partialIdx
        private Dictionary<string, double> _partialClosedVolumes = new Dictionary<string, double>(); // ticket -> total closed volume from partials
        private Dictionary<string, string> _ticketSidMap = new Dictionary<string, string>(); // ticket -> sid backfill for empty comments
        private Dictionary<string, string> _symbolResolveCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, TimedCacheEntry<List<double>>> _chartLiquidityCache = new Dictionary<string, TimedCacheEntry<List<double>>>();
        private readonly Dictionary<string, TimedCacheEntry<List<double>>> _chartSwingStopCache = new Dictionary<string, TimedCacheEntry<List<double>>>();
        private readonly Dictionary<string, TimedCacheEntry<List<ChartEntryCandidate>>> _chartEntryCandidatesCache = new Dictionary<string, TimedCacheEntry<List<ChartEntryCandidate>>>();
        private readonly Dictionary<string, TimedCacheEntry<List<ChartLevelCandidate>>> _chartStructuralLevelsCache = new Dictionary<string, TimedCacheEntry<List<ChartLevelCandidate>>>();
        private readonly Dictionary<string, TimedCacheEntry<List<NewsGateEvent>>> _newsGateEventsCache = new Dictionary<string, TimedCacheEntry<List<NewsGateEvent>>>();
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
        private string _lastIncrementalErr = "None";
        private int _incrementalSyncCount = 0;
        private int _incrementalTotalInserted = 0;
        private double _peakEquitySeen = 0;
        private double _peakBalanceSeen = 0;
        private DateTime _riskAnchorStartedAt = DateTime.MinValue;
        private double _initialAccountBalance = 0;
        private DateTime _ftmoDayStartUtc = DateTime.MinValue;
        private double _ftmoDayStartBalance = 0;
        private double _ftmoDayStartEquity = 0;
        private double _ftmoHighestDayStartBalance = 0;
        private TimeZoneInfo _ftmoTimeZone;
        private const int MagicNumber = 20260411;


        private HttpClient _httpClient = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        private bool _syncOnly = false; // When true, DoTimerWork only does sync payload + dispatch
        private static readonly TimeSpan ChartStructureCacheTtl = TimeSpan.FromSeconds(3);

        // Master timer state
        private DateTime _masterTimerTick = DateTime.MinValue;
        private long _masterTickCount = 0;

        // Per-subsystem busy flags (one stuck subsystem can't block others)
        private bool _busyPull = false;
        private bool _busySync = false;
        private bool _busyBars = false;
        private bool _busyIncSync = false;
        private bool _busyNewsGateRefresh = false;

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

        private string GetBaseServerRootPath()
        {
            var basePath = string.IsNullOrWhiteSpace(BaseServerPath) ? DefaultBaseServerPath : BaseServerPath.Trim();
            if (string.IsNullOrWhiteSpace(basePath))
                basePath = DefaultBaseServerPath;

            try
            {
                return Path.GetFullPath(basePath);
            }
            catch
            {
                return basePath;
            }
        }

        private string GetBaseServerConfigPath()
        {
            var baseRoot = GetBaseServerRootPath();
            if (string.IsNullOrWhiteSpace(baseRoot))
                return Environment.CurrentDirectory;

            try
            {
                var srcConfigPath = Path.Combine(baseRoot, "src", "config");
                if (Directory.Exists(srcConfigPath))
                    return srcConfigPath;

                var configPath = Path.Combine(baseRoot, "config");
                if (Directory.Exists(configPath))
                    return configPath;
            }
            catch
            {
            }

            return baseRoot;
        }

        private string Get42TradeUserRootPath(string userId)
        {
            var baseRoot = GetBaseServerRootPath();
            var safeUserId = SafePathPart(string.IsNullOrWhiteSpace(userId) ? DefaultBacktestUserId : userId, DefaultBacktestUserId);
            return Path.Combine(baseRoot, "data", "users", safeUserId);
        }

        private string SafePathPart(string value, string fallback)
        {
            var raw = string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
            var safe = Regex.Replace(raw, "[^a-zA-Z0-9._-]", "_");
            if (Regex.IsMatch(safe, "^\\.+$"))
                safe = "_";
            return string.IsNullOrWhiteSpace(safe) ? fallback : safe;
        }

        private string GetBacktestStrategyStorageKey()
        {
            var configured = GetConfiguredStrategyModes().ToList();
            if (configured.Count == 0)
                return "ctrader_backtest";
            if (configured.Count > 1)
                return "multi_strategy";

            switch (configured[0])
            {
                case BacktestStrategyMode.HtfEventMarket: return "htf_event_market";
                case BacktestStrategyMode.LtfEventMarket: return "ltf_event_market";
                case BacktestStrategyMode.EmaCrossV1: return "ema_cross_v1";
                case BacktestStrategyMode.SmaCrossV1: return "sma_cross_v1";
                case BacktestStrategyMode.GoldenCrossV1: return "golden_cross_v1";
                case BacktestStrategyMode.TripleEmaTrendV1: return "triple_ema_trend_v1";
                case BacktestStrategyMode.RsiReversionV1: return "rsi_reversion_v1";
                case BacktestStrategyMode.BollingerReversionV1: return "bollinger_reversion_v1";
                case BacktestStrategyMode.StochReversalV1: return "stoch_reversal_v1";
                case BacktestStrategyMode.MacdSignalV1: return "macd_signal_v1";
                case BacktestStrategyMode.RocMomentumV1: return "roc_momentum_v1";
                case BacktestStrategyMode.DonchianBreakoutV1: return "donchian_breakout_v1";
                case BacktestStrategyMode.Trend: return "follow_trend";
                case BacktestStrategyMode.Impulse: return "follow_trend_big_candle";
                case BacktestStrategyMode.PriceActionV1: return "price_action_v1";
                case BacktestStrategyMode.PriceActionEventDetectorV1: return "price_action_event_detector_v1";
                case BacktestStrategyMode.PriceActionFvgContextV1: return "price_action_fvg_context_v1";
                case BacktestStrategyMode.ArtifactSuggestedLevelsV1: return "artifact_suggested_levels_v1";
                case BacktestStrategyMode.ArtifactSuggestedLevelsV2: return "artifact_suggested_levels_v2";
                case BacktestStrategyMode.ArtifactSuggestedLevelsV2LimitBodyMid: return "artifact_suggested_levels_v2_limit_body_mid";
                case BacktestStrategyMode.AiSnapshotContextV1: return "ai_snapshot_context_v1";
                case BacktestStrategyMode.Off:
                default:
                    return "ctrader_backtest";
            }
        }

        private string GetBacktestStrategyDisplayName()
        {
            var configured = GetConfiguredStrategyModes().ToList();
            if (configured.Count == 0) return "cTrader Backtest";
            if (configured.Count == 1) return GetBacktestStrategyModeDisplayName(configured[0]);
            return string.Format(CultureInfo.InvariantCulture, "MultiStrategy ({0})", string.Join(", ", configured.Select(GetBacktestStrategyModeDisplayName).ToArray()));
        }

        private string GetConfiguredStrategyDisplayList()
        {
            var configured = GetConfiguredStrategyModes().Select(GetBacktestStrategyModeDisplayName).ToList();
            if (configured.Count == 0)
                return string.Empty;
            return string.Join(", ", configured);
        }

        private string GetConfiguredStrategyRuntimeList()
        {
            var configured = GetConfiguredStrategyModes().ToList();
            if (configured.Count == 0)
                return string.Empty;

            var runtimeTime = Server.Time;
            var canRunNow = ShouldStrategyEngineRun() && IsStrategyTradingTimeAllowed(runtimeTime);
            var statuses = configured
                .Select(mode => string.Format(
                    CultureInfo.InvariantCulture,
                    "{0}:{1}",
                    GetBacktestStrategyModeDisplayName(mode),
                    canRunNow ? "OK" : "na"))
                .ToList();

            return string.Join(", ", statuses);
        }

        private string GetBottomRightSessionContextText()
        {
            var utcNow = DateTime.UtcNow;
            var orderedSessions = new[] { "Asia", "London", "NewYork" };
            foreach (var sessionName in orderedSessions)
            {
                DateTime startUtc;
                DateTime endUtc;
                if (!TryGetSessionUtcRangeAtUtc(sessionName, utcNow, out startUtc, out endUtc))
                    continue;

                var minutesToEnd = Math.Max(0, (int)Math.Round((endUtc - utcNow).TotalMinutes));
                var displayStartTime = TimeZoneInfo.ConvertTimeFromUtc(startUtc, TimeZoneInfo.Local);
                var displayEndTime = TimeZoneInfo.ConvertTimeFromUtc(endUtc, TimeZoneInfo.Local);
                SessionWindowDefinition definition;
                if (!TryGetSessionWindowDefinition(sessionName, out definition))
                    continue;

                DateTime upcomingStartUtc = DateTime.MinValue;
                string upcomingSessionLabel = "";
                foreach (var candidateSessionName in orderedSessions)
                {
                    SessionWindowDefinition candidateDefinition;
                    if (!TryGetSessionWindowDefinition(candidateSessionName, out candidateDefinition))
                        continue;

                    TimeZoneInfo candidateTimeZone;
                    if (!TryGetSessionTimeZone(candidateDefinition, out candidateTimeZone))
                        continue;

                    var candidateMarketNow = TimeZoneInfo.ConvertTimeFromUtc(utcNow, candidateTimeZone);
                    for (var dayOffset = 0; dayOffset <= 2; dayOffset++)
                    {
                        DateTime candidateSessionStartUtc;
                        DateTime candidateSessionEndUtc;
                        if (!TryGetSessionUtcRangeForMarketDate(candidateSessionName, candidateMarketNow.Date.AddDays(dayOffset), out candidateSessionStartUtc, out candidateSessionEndUtc))
                            continue;

                        if (candidateSessionStartUtc <= utcNow)
                            continue;

                        if (upcomingStartUtc == DateTime.MinValue || candidateSessionStartUtc < upcomingStartUtc)
                        {
                            upcomingStartUtc = candidateSessionStartUtc;
                            upcomingSessionLabel = candidateDefinition.Label;
                        }
                    }
                }

                var nextSessionText = "";
                if (upcomingStartUtc != DateTime.MinValue && !string.IsNullOrWhiteSpace(upcomingSessionLabel))
                {
                    var minutesToNext = Math.Max(0, (int)Math.Round((upcomingStartUtc - utcNow).TotalMinutes));
                    nextSessionText = string.Format(
                        CultureInfo.InvariantCulture,
                        " (next {0} in {1})",
                        upcomingSessionLabel,
                        FormatRelativeMinutes(minutesToNext));
                }

                return string.Format(
                    CultureInfo.InvariantCulture,
                    "KZ: {0} {1}-{2}{3}",
                    definition.Label,
                    displayStartTime.ToString("HH:mm", CultureInfo.InvariantCulture),
                    displayEndTime.ToString("HH:mm", CultureInfo.InvariantCulture),
                    nextSessionText);
            }

            DateTime nextStartUtc = DateTime.MinValue;
            string nextSessionLabel = "";
            foreach (var sessionName in orderedSessions)
            {
                SessionWindowDefinition definition;
                if (!TryGetSessionWindowDefinition(sessionName, out definition))
                    continue;

                TimeZoneInfo timeZone;
                if (!TryGetSessionTimeZone(definition, out timeZone))
                    continue;

                var marketNow = TimeZoneInfo.ConvertTimeFromUtc(utcNow, timeZone);
                for (var dayOffset = 0; dayOffset <= 2; dayOffset++)
                {
                    DateTime candidateStartUtc;
                    DateTime candidateEndUtc;
                    if (!TryGetSessionUtcRangeForMarketDate(sessionName, marketNow.Date.AddDays(dayOffset), out candidateStartUtc, out candidateEndUtc))
                        continue;

                    if (candidateStartUtc <= utcNow)
                        continue;

                    if (nextStartUtc == DateTime.MinValue || candidateStartUtc < nextStartUtc)
                    {
                        nextStartUtc = candidateStartUtc;
                        nextSessionLabel = definition.Label;
                    }
                }
            }

            if (nextStartUtc != DateTime.MinValue)
            {
                var minutesToStart = Math.Max(0, (int)Math.Round((nextStartUtc - utcNow).TotalMinutes));
                var displayStartTime = TimeZoneInfo.ConvertTimeFromUtc(nextStartUtc, TimeZoneInfo.Local);
                return string.Format(
                    CultureInfo.InvariantCulture,
                    "KZ: {0} {1}",
                    nextSessionLabel,
                    FormatClockWithRelative(displayStartTime, minutesToStart));
            }

            return "KZ: none";
        }

        private string GetBottomRightNewsContextText(DateTime now)
        {
            var symbolName = ResolveSharedStrategySymbol(
                Chart != null ? Chart.SymbolName : (Symbol != null ? Symbol.Name : ""));
            var events = GetCachedNewsGateEvents();
            if (events == null || events.Count == 0)
                return "News: none";

            var normalizedSymbol = NormalizeSymbolAlias(symbolName);
            var relevant = events
                .Where(evt => evt != null)
                .Where(evt => evt.EffectiveSymbols != null && evt.EffectiveSymbols.Count > 0)
                .Where(evt => string.IsNullOrWhiteSpace(normalizedSymbol) ||
                              evt.EffectiveSymbols.Any(s => string.Equals(NormalizeSymbolAlias(s), normalizedSymbol, StringComparison.OrdinalIgnoreCase)))
                .ToList();
            if (relevant.Count == 0)
                relevant = events.Where(evt => evt != null).ToList();

            var activeEvent = relevant
                .Where(evt => string.Equals(evt.Phase ?? "", "during", StringComparison.OrdinalIgnoreCase))
                .OrderBy(evt => evt.MinutesUntilEnd < 0 ? int.MaxValue : evt.MinutesUntilEnd)
                .FirstOrDefault();
            if (activeEvent != null)
            {
                var endMinutes = Math.Max(0, activeEvent.MinutesUntilEnd);
                var endTime = now.AddMinutes(endMinutes);
                return string.Format(
                    CultureInfo.InvariantCulture,
                    "News: {0} {1}",
                    CompactPanelText(activeEvent.Title, 18),
                    FormatClockWithRelative(endTime, endMinutes));
            }

            var nextEvent = relevant
                .Where(evt => evt.MinutesUntilStart >= 0)
                .OrderBy(evt => evt.MinutesUntilStart)
                .FirstOrDefault();
            if (nextEvent == null)
                return "News: none";

            var startMinutes = Math.Max(0, nextEvent.MinutesUntilStart);
            var startTime = now.AddMinutes(startMinutes);
            return string.Format(
                CultureInfo.InvariantCulture,
                "News: {0} {1}",
                CompactPanelText(nextEvent.Title, 18),
                FormatClockWithRelative(startTime, startMinutes));
        }

        private string FormatClockWithRelative(DateTime time, int minutesUntil)
        {
            return string.Format(
                CultureInfo.InvariantCulture,
                "{0} (in {1})",
                time.ToString("HH:mm", CultureInfo.InvariantCulture),
                FormatRelativeMinutes(minutesUntil));
        }

        private string FormatRelativeMinutes(int minutesUntil)
        {
            var normalizedMinutes = Math.Max(0, minutesUntil);
            var hours = normalizedMinutes / 60;
            var minutes = normalizedMinutes % 60;
            return hours > 0
                ? string.Format(CultureInfo.InvariantCulture, "{0}h{1}m", hours, minutes)
                : string.Format(CultureInfo.InvariantCulture, "{0}m", minutes);
        }

        private string CompactPanelText(string value, int maxLength)
        {
            var text = string.IsNullOrWhiteSpace(value) ? "-" : value.Trim();
            if (maxLength < 4 || text.Length <= maxLength)
                return text;
            return text.Substring(0, maxLength - 3).TrimEnd() + "...";
        }

        private IEnumerable<BacktestStrategyMode> GetConfiguredStrategyModes()
        {
            var seen = new HashSet<BacktestStrategyMode>();
            var all = new[]
            {
                SelectedBacktestStrategy,
                SelectedBacktestStrategy2,
                SelectedBacktestStrategy3,
                SelectedBacktestStrategy4,
                SelectedBacktestStrategy5
            };
            foreach (var mode in all)
            {
                if (mode == BacktestStrategyMode.Off)
                    continue;
                if (seen.Add(mode))
                    yield return mode;
            }
        }

        private string GetBacktestStrategyModeDisplayName(BacktestStrategyMode mode)
        {
            switch (mode)
            {
                case BacktestStrategyMode.Trend:
                    return "Trend";
                case BacktestStrategyMode.Impulse:
                    return "Impulse";
                case BacktestStrategyMode.HtfEventMarket:
                    return "HtfEventMarket";
                case BacktestStrategyMode.LtfEventMarket:
                    return "LtfEventMarket";
                case BacktestStrategyMode.Off:
                    return "Off";
                default:
                    return mode.ToString();
            }
        }

        private string GetBacktestTfStorageLabel()
        {
            var tf = Chart != null ? Chart.TimeFrame : TimeFrame.Minute;
            if (tf == TimeFrame.Minute) return "1";
            if (tf == TimeFrame.Minute5) return "5";
            if (tf == TimeFrame.Minute15) return "15";
            if (tf == TimeFrame.Minute30) return "30";
            if (tf == TimeFrame.Hour) return "60";
            if (tf == TimeFrame.Hour4) return "240";
            if (tf == TimeFrame.Daily) return "1440";
            if (tf == TimeFrame.Weekly) return "10080";
            if (tf == TimeFrame.Monthly) return "43200";
            return NormalizeTradeTfLabel(tf.ToString());
        }

        private bool IsNullStrategyInputToken(string raw)
        {
            var normalized = string.IsNullOrWhiteSpace(raw) ? "" : raw.Trim();
            return normalized.Equals("null", StringComparison.OrdinalIgnoreCase) ||
                   normalized.Equals("(null)", StringComparison.OrdinalIgnoreCase) ||
                   normalized.Equals("current", StringComparison.OrdinalIgnoreCase) ||
                   normalized.Equals("chart", StringComparison.OrdinalIgnoreCase) ||
                   normalized.Equals("na", StringComparison.OrdinalIgnoreCase) ||
                   normalized.Equals("none", StringComparison.OrdinalIgnoreCase);
        }

        private string ResolveSharedStrategySymbol(string fallbackSymbolName = "")
        {
            return ResolveSharedStrategySymbols(fallbackSymbolName).FirstOrDefault() ?? NormalizeSymbolAlias(fallbackSymbolName);
        }

        private string NormalizeSymbolAlias(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
                return "";

            var value = raw.Trim().ToUpperInvariant().Replace("_", "").Replace("-", "").Replace(" ", "");
            if (value == "ALL" || value == "*")
                return "";
            switch (value)
            {
                case "BTC":
                case "XBT":
                case "BTCUSD":
                    return "BTCUSD";
                case "XAU":
                case "XAUUSD":
                    return "XAUUSD";
                case "XAG":
                case "XAGUSD":
                    return "XAGUSD";
                case "EUR":
                case "EURUSD":
                    return "EURUSD";
                default:
                    return value;
            }
        }

        private string NormalizeSessionAlias(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
                return "";

            var value = raw.Trim().ToUpperInvariant().Replace("_", "").Replace("-", "").Replace(" ", "");
            switch (value)
            {
                case "LONDON":
                case "LND":
                case "LD":
                case "LDN":
                    return "London";
                case "NEWYORK":
                case "NY":
                    return "NewYork";
                case "ASIA":
                case "AS":
                    return "Asia";
                case "ALL":
                case "*":
                    return "All";
                case "OFF":
                case "NO":
                    return "Off";
                default:
                    return value;
            }
        }

        private struct SessionWindowDefinition
        {
            public string Name;
            public string Label;
            public TimeSpan LocalStart;
            public TimeSpan LocalEnd;
            public string[] TimeZoneIds;
        }

        private TimeZoneInfo GetReferenceTimeZone()
        {
            string[] ids =
            {
                "Europe/Prague",
                "Europe/Berlin",
                "Central Europe Standard Time",
                "W. Europe Standard Time"
            };

            foreach (var id in ids)
            {
                try
                {
                    var tz = TimeZoneInfo.FindSystemTimeZoneById(id);
                    if (tz != null)
                        return tz;
                }
                catch
                {
                }
            }

            return TimeZoneInfo.Local;
        }

        private DateTime NormalizeBotTimeToUtc(DateTime value)
        {
            if (value == DateTime.MinValue)
                return DateTime.MinValue;
            if (value.Kind == DateTimeKind.Utc)
                return value;
            if (value.Kind == DateTimeKind.Local)
                return value.ToUniversalTime();
            return DateTime.SpecifyKind(value, DateTimeKind.Utc);
        }

        private DateTime GetReferenceNow()
        {
            return TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, GetReferenceTimeZone());
        }

        private DateTime ConvertUtcToReferenceTime(DateTime utcTime)
        {
            return TimeZoneInfo.ConvertTimeFromUtc(NormalizeBotTimeToUtc(utcTime), GetReferenceTimeZone());
        }

        private DateTime ConvertReferenceTimeToUtc(DateTime referenceTime)
        {
            var unspecified = DateTime.SpecifyKind(referenceTime, DateTimeKind.Unspecified);
            return TimeZoneInfo.ConvertTimeToUtc(unspecified, GetReferenceTimeZone());
        }

        private DateTime ConvertReferenceTimeToDisplayTime(DateTime referenceTime)
        {
            var referenceUtc = ConvertReferenceTimeToUtc(referenceTime);
            return TimeZoneInfo.ConvertTimeFromUtc(referenceUtc, TimeZoneInfo.Local);
        }

        private TimeZoneInfo GetRiskReferenceTimeZone()
        {
            return GetFtmoTimeZone();
        }

        private DateTime GetRiskReferenceNow()
        {
            return TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, GetRiskReferenceTimeZone());
        }

        private TimeZoneInfo ResolveTimeZone(params string[] ids)
        {
            foreach (var id in ids ?? Array.Empty<string>())
            {
                if (string.IsNullOrWhiteSpace(id))
                    continue;

                try
                {
                    var tz = TimeZoneInfo.FindSystemTimeZoneById(id);
                    if (tz != null)
                        return tz;
                }
                catch
                {
                }
            }

            return TimeZoneInfo.Local;
        }

        private static DateTime BuildSessionLocalDateTime(DateTime localDate, TimeSpan timeOfDay)
        {
            return new DateTime(
                localDate.Year,
                localDate.Month,
                localDate.Day,
                timeOfDay.Hours,
                timeOfDay.Minutes,
                timeOfDay.Seconds,
                DateTimeKind.Unspecified);
        }

        private bool TryGetSessionTimeZone(SessionWindowDefinition definition, out TimeZoneInfo timeZone)
        {
            timeZone = ResolveTimeZone(definition.TimeZoneIds);
            return timeZone != null;
        }

        private bool TryGetSessionUtcRangeForMarketDate(string sessionName, DateTime marketDate, out DateTime startUtc, out DateTime endUtc)
        {
            startUtc = DateTime.MinValue;
            endUtc = DateTime.MinValue;

            SessionWindowDefinition definition;
            if (!TryGetSessionWindowDefinition(sessionName, out definition))
                return false;

            TimeZoneInfo timeZone;
            if (!TryGetSessionTimeZone(definition, out timeZone))
                return false;

            var startLocal = BuildSessionLocalDateTime(marketDate.Date, definition.LocalStart);
            var endLocal = BuildSessionLocalDateTime(marketDate.Date, definition.LocalEnd);
            if (endLocal <= startLocal)
                endLocal = endLocal.AddDays(1);

            startUtc = TimeZoneInfo.ConvertTimeToUtc(startLocal, timeZone);
            endUtc = TimeZoneInfo.ConvertTimeToUtc(endLocal, timeZone);
            return true;
        }

        private bool TryGetSessionUtcRangeAtUtc(string sessionName, DateTime utcReference, out DateTime startUtc, out DateTime endUtc)
        {
            startUtc = DateTime.MinValue;
            endUtc = DateTime.MinValue;

            SessionWindowDefinition definition;
            if (!TryGetSessionWindowDefinition(sessionName, out definition))
                return false;

            TimeZoneInfo timeZone;
            if (!TryGetSessionTimeZone(definition, out timeZone))
                return false;

            var normalizedUtc = NormalizeBotTimeToUtc(utcReference == DateTime.MinValue ? DateTime.UtcNow : utcReference);
            var marketNow = TimeZoneInfo.ConvertTimeFromUtc(normalizedUtc, timeZone);

            DateTime todayStartUtc;
            DateTime todayEndUtc;
            if (TryGetSessionUtcRangeForMarketDate(sessionName, marketNow.Date, out todayStartUtc, out todayEndUtc) &&
                normalizedUtc >= todayStartUtc &&
                normalizedUtc < todayEndUtc)
            {
                startUtc = todayStartUtc;
                endUtc = todayEndUtc;
                return true;
            }

            DateTime previousStartUtc;
            DateTime previousEndUtc;
            if (TryGetSessionUtcRangeForMarketDate(sessionName, marketNow.Date.AddDays(-1), out previousStartUtc, out previousEndUtc) &&
                normalizedUtc >= previousStartUtc &&
                normalizedUtc < previousEndUtc)
            {
                startUtc = previousStartUtc;
                endUtc = previousEndUtc;
                return true;
            }

            return false;
        }

        private bool TryGetSessionWindowDefinition(string sessionName, out SessionWindowDefinition definition)
        {
            definition = default(SessionWindowDefinition);
            var normalized = NormalizeSessionAlias(sessionName);
            if (string.IsNullOrWhiteSpace(normalized))
                return false;

            switch (normalized)
            {
                case "Asia":
                    definition = new SessionWindowDefinition
                    {
                        Name = "Asia",
                        Label = "Asia",
                        LocalStart = new TimeSpan(9, 0, 0),
                        LocalEnd = new TimeSpan(18, 0, 0),
                        TimeZoneIds = new[] { "Asia/Tokyo", "Tokyo Standard Time" }
                    };
                    return true;
                case "London":
                    definition = new SessionWindowDefinition
                    {
                        Name = "London",
                        Label = "LDN",
                        LocalStart = new TimeSpan(9, 0, 0),
                        LocalEnd = new TimeSpan(18, 0, 0),
                        TimeZoneIds = new[] { "Europe/London", "Greenwich Standard Time" }
                    };
                    return true;
                case "NewYork":
                    definition = new SessionWindowDefinition
                    {
                        Name = "NewYork",
                        Label = "NY",
                        LocalStart = new TimeSpan(9, 0, 0),
                        LocalEnd = new TimeSpan(18, 0, 0),
                        TimeZoneIds = new[] { "America/New_York", "Eastern Standard Time" }
                    };
                    return true;
                default:
                    return false;
            }
        }

        private bool TryGetSessionUtcRange(string sessionName, DateTime referenceDate, out DateTime startUtc, out DateTime endUtc)
        {
            startUtc = DateTime.MinValue;
            endUtc = DateTime.MinValue;

            SessionWindowDefinition definition;
            if (!TryGetSessionWindowDefinition(sessionName, out definition))
                return false;
            return TryGetSessionUtcRangeForMarketDate(sessionName, referenceDate.Date, out startUtc, out endUtc);
        }

        private HashSet<DayOfWeek> GetAllowedStrategyDays()
        {
            var days = new HashSet<DayOfWeek>();
            switch (StrategyDaysPresetValue)
            {
                case StrategyDaysPreset.Off:
                    return days;
                case StrategyDaysPreset.All:
                    days.UnionWith(new[] { DayOfWeek.Sunday, DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday, DayOfWeek.Saturday });
                    break;
                case StrategyDaysPreset.Weekend:
                    days.Add(DayOfWeek.Saturday);
                    days.Add(DayOfWeek.Sunday);
                    break;
                case StrategyDaysPreset.Monday:
                    days.Add(DayOfWeek.Monday);
                    break;
                case StrategyDaysPreset.Tuesday:
                    days.Add(DayOfWeek.Tuesday);
                    break;
                case StrategyDaysPreset.Wednesday:
                    days.Add(DayOfWeek.Wednesday);
                    break;
                case StrategyDaysPreset.Thursday:
                    days.Add(DayOfWeek.Thursday);
                    break;
                case StrategyDaysPreset.Friday:
                    days.Add(DayOfWeek.Friday);
                    break;
                case StrategyDaysPreset.MonToThu:
                    days.UnionWith(new[] { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday });
                    break;
                case StrategyDaysPreset.TueToFri:
                    days.UnionWith(new[] { DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday });
                    break;
                case StrategyDaysPreset.Weekdays:
                default:
                    days.UnionWith(new[] { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday });
                    break;
            }

            return days;
        }

        private HashSet<string> GetAllowedStrategySessions()
        {
            var sessions = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            switch (StrategySessionsPresetValue)
            {
                case StrategySessionsPreset.Off:
                    sessions.Add("Off");
                    break;
                case StrategySessionsPreset.Asia:
                    sessions.Add("Asia");
                    break;
                case StrategySessionsPreset.London:
                    sessions.Add("London");
                    break;
                case StrategySessionsPreset.NewYork:
                    sessions.Add("NewYork");
                    break;
                case StrategySessionsPreset.Ld_Ny:
                    sessions.Add("London");
                    sessions.Add("NewYork");
                    break;
                case StrategySessionsPreset.A_Ld_Ny:
                    sessions.Add("Asia");
                    sessions.Add("London");
                    sessions.Add("NewYork");
                    break;
                case StrategySessionsPreset.All:
                default:
                    break;
            }

            return sessions;
        }

        private bool IsStrategyTradingTimeAllowed(DateTime time)
        {
            var referenceTime = ConvertUtcToReferenceTime(time == DateTime.MinValue ? DateTime.UtcNow : time);
            var allowedDays = GetAllowedStrategyDays();
            if (StrategyDaysPresetValue == StrategyDaysPreset.Off)
                return false;
            if (allowedDays.Count > 0 && !allowedDays.Contains(referenceTime.DayOfWeek))
                return false;

            var allowedSessions = GetAllowedStrategySessions();
            if (allowedSessions.Contains("Off"))
                return false;
            if (allowedSessions.Count == 0)
                return true;

            var utcTime = NormalizeBotTimeToUtc(time == DateTime.MinValue ? DateTime.UtcNow : time);
            foreach (var sessionName in allowedSessions)
            {
                DateTime startUtc;
                DateTime endUtc;
                if (TryGetSessionUtcRangeAtUtc(sessionName, utcTime, out startUtc, out endUtc))
                    return true;
            }

            return false;
        }

        private string GetStrategyTradingTimeBlockReason(DateTime time)
        {
            var referenceTime = ConvertUtcToReferenceTime(time == DateTime.MinValue ? DateTime.UtcNow : time);
            if (StrategyDaysPresetValue == StrategyDaysPreset.Off)
                return "days=Off";

            var allowedDays = GetAllowedStrategyDays();
            if (allowedDays.Count > 0 && !allowedDays.Contains(referenceTime.DayOfWeek))
            {
                return string.Format(
                    CultureInfo.InvariantCulture,
                    "day_blocked {0} preset={1}",
                    referenceTime.DayOfWeek,
                    StrategyDaysPresetValue);
            }

            var allowedSessions = GetAllowedStrategySessions();
            if (allowedSessions.Contains("Off"))
                return "sessions=Off";
            if (allowedSessions.Count == 0)
                return "";

            var utcTime = NormalizeBotTimeToUtc(time == DateTime.MinValue ? DateTime.UtcNow : time);
            foreach (var sessionName in allowedSessions)
            {
                DateTime startUtc;
                DateTime endUtc;
                if (TryGetSessionUtcRangeAtUtc(sessionName, utcTime, out startUtc, out endUtc))
                    return "";
            }

            return string.Format(
                CultureInfo.InvariantCulture,
                "session_blocked {0:HH:mm} preset={1}",
                referenceTime,
                StrategySessionsPresetValue);
        }

        private bool ShouldAllowStrategySignalTime(DateTime signalTime)
        {
            var time = signalTime == DateTime.MinValue ? Server.Time : signalTime;
            return IsStrategyTradingTimeAllowed(time);
        }

        private bool IsTimeWithinSession(TimeSpan timeOfDay, TimeSpan start, TimeSpan end)
        {
            if (end > start)
                return timeOfDay >= start && timeOfDay < end;
            return timeOfDay >= start || timeOfDay < end;
        }

        private bool TryResolveSessionWindowByName(string sessionName, out TimeSpan start, out TimeSpan end)
        {
            start = TimeSpan.Zero;
            end = TimeSpan.Zero;
            SessionWindowDefinition definition;
            if (!TryGetSessionWindowDefinition(sessionName, out definition))
                return false;
            var nowUtc = DateTime.UtcNow;
            DateTime startUtc;
            DateTime endUtc;
            if (!TryGetSessionUtcRangeAtUtc(sessionName, nowUtc, out startUtc, out endUtc))
            {
                TimeZoneInfo timeZone;
                if (!TryGetSessionTimeZone(definition, out timeZone))
                    return false;

                var marketNow = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, timeZone);
                if (!TryGetSessionUtcRangeForMarketDate(sessionName, marketNow.Date, out startUtc, out endUtc))
                    return false;
            }

            var startReference = ConvertUtcToReferenceTime(startUtc);
            var endReference = ConvertUtcToReferenceTime(endUtc);
            start = startReference.TimeOfDay;
            end = endReference.TimeOfDay;
            return true;
        }

        private bool TryResolveSessionWindowText(string sessionName, out string startText, out string endText)
        {
            startText = "";
            endText = "";
            TimeSpan start;
            TimeSpan end;
            if (!TryResolveSessionWindowByName(sessionName, out start, out end))
                return false;

            startText = start.ToString(@"hh\:mm", CultureInfo.InvariantCulture);
            endText = end.ToString(@"hh\:mm", CultureInfo.InvariantCulture);
            return true;
        }

        private bool IsReferenceTimeInsideAnyConfiguredSession(DateTime referenceTime)
        {
            var orderedSessions = new[] { "Asia", "London", "NewYork" };
            var utcTime = ConvertReferenceTimeToUtc(referenceTime);
            foreach (var sessionName in orderedSessions)
            {
                DateTime startUtc;
                DateTime endUtc;
                if (TryGetSessionUtcRangeAtUtc(sessionName, utcTime, out startUtc, out endUtc))
                    return true;
            }

            return false;
        }

        private IEnumerable<string> ResolveSharedStrategySymbols(string fallbackSymbolName = "")
        {
            var symbols = new List<string>();
            var fallback = NormalizeSymbolAlias(fallbackSymbolName);
            var tokens = (StrategySymbols ?? "").Split(new[] { ',', ';', '|' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var strategySymbol in tokens)
            {
                if (IsNullStrategyInputToken(strategySymbol))
                {
                    if (!string.IsNullOrWhiteSpace(fallback))
                        symbols.Add(fallback);
                    continue;
                }

                var normalized = NormalizeSymbolAlias(strategySymbol);
                if (IsChartAllSymbolsSelection(normalized))
                {
                    symbols.AddRange(
                        GetChartToolbarSymbols()
                            .Where(symbol => !IsChartAllSymbolsSelection(symbol))
                            .Select(NormalizeSymbolAlias)
                            .Where(symbol => !string.IsNullOrWhiteSpace(symbol)));
                    continue;
                }

                if (!string.IsNullOrWhiteSpace(normalized))
                    symbols.Add(normalized);
            }

            if (symbols.Count == 0)
            {
                if (!string.IsNullOrWhiteSpace(fallback))
                    symbols.Add(fallback);
            }

            return symbols.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }

        private TimeFrame ResolveSharedStrategyTimeFrame(TimeFrame fallbackTimeFrame)
        {
            return ResolveSharedStrategyTimeFrames(fallbackTimeFrame).FirstOrDefault();
        }

        private IEnumerable<TimeFrame> ResolveSharedStrategyTimeFrames(TimeFrame fallbackTimeFrame)
        {
            var frames = new List<TimeFrame>();
            var tokens = (StrategyTimeframes ?? "").Split(new[] { ',', ';', '|' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var strategyTimeFrame in tokens)
            {
                if (IsNullStrategyInputToken(strategyTimeFrame))
                {
                    frames.Add(fallbackTimeFrame);
                    continue;
                }

                TimeFrame parsedTimeFrame;
                if (TryParseTimeFrameToken(strategyTimeFrame, out parsedTimeFrame))
                    frames.Add(parsedTimeFrame);
            }

            if (frames.Count == 0)
                frames.Add(fallbackTimeFrame);

            return frames.Distinct().ToList();
        }

        private IEnumerable<StrategyExecutionTarget> ResolveStrategyExecutionTargets(string fallbackSymbolName, TimeFrame fallbackTimeFrame)
        {
            var symbols = ResolveSharedStrategySymbols(fallbackSymbolName).ToList();
            var timeFrames = ResolveSharedStrategyTimeFrames(fallbackTimeFrame).ToList();
            var targets = new List<StrategyExecutionTarget>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var symbolName in symbols)
            {
                foreach (var timeFrame in timeFrames)
                {
                    var key = string.Format(CultureInfo.InvariantCulture, "{0}|{1}", symbolName, timeFrame);
                    if (!seen.Add(key))
                        continue;

                    targets.Add(new StrategyExecutionTarget
                    {
                        SymbolName = symbolName,
                        TimeFrame = timeFrame
                    });
                }
            }

            return targets;
        }

        private bool ShouldStrategyEngineRun()
        {
            return IsBacktestingRuntime() || EnableLiveStrategyTrading;
        }

        private bool ShouldStrategySubmitOrders()
        {
            return IsBacktestingRuntime() || EnableLiveStrategyTrading;
        }

        private bool ShouldRunStrategiesOnMasterTimer()
        {
            return SelectedStrategyTriggerMode == StrategyTriggerMode.Timer1s;
        }

        private bool ShouldRunStrategiesOnBarEvent()
        {
            return SelectedStrategyTriggerMode == StrategyTriggerMode.OnBar;
        }

        private bool ShouldRunStrategiesOnBarClosedEvent()
        {
            return SelectedStrategyTriggerMode == StrategyTriggerMode.OnBarClosed;
        }

        private bool ShouldRunStrategiesOnTickEvent()
        {
            return SelectedStrategyTriggerMode == StrategyTriggerMode.Ticker;
        }

        private bool TryResolveStrategySymbolAndTimeFrame(BacktestStrategyMode mode, string fallbackSymbolName, TimeFrame fallbackTimeFrame, out string symbolName, out TimeFrame timeFrame)
        {
            symbolName = ResolveSharedStrategySymbol(fallbackSymbolName);
            timeFrame = ResolveSharedStrategyTimeFrame(fallbackTimeFrame);
            return !string.IsNullOrWhiteSpace(symbolName);
        }

        private string GetStrategyProfileRaw(BacktestStrategyMode mode, TimeFrame sourceTimeFrame)
        {
            if (mode == BacktestStrategyMode.Trend)
                return NormalizeTradeProfile("", NormalizeTradeTfLabel(GetMiniChartLabel(sourceTimeFrame)));
            return GetChartTradeProfileRaw();
        }

        private double ResolveStrategyRiskMoney(BacktestStrategyMode mode, string profileRaw)
        {
            var balance = Account != null ? Math.Max(0, Account.Balance) : 0;
            return Math.Max(0, balance * (Math.Max(0.0, GetEffectiveMaxRiskPercent()) / 100.0));
        }

        private string EscapeJsonString(string value)
        {
            if (value == null)
                return "null";

            var sb = new StringBuilder();
            sb.Append('"');
            for (var i = 0; i < value.Length; i++)
            {
                var ch = value[i];
                switch (ch)
                {
                    case '\\': sb.Append("\\\\"); break;
                    case '"': sb.Append("\\\""); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (ch < 32)
                            sb.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                        else
                            sb.Append(ch);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }

        private string SerializeJsonValue(object value)
        {
            if (value == null)
                return "null";

            if (value is string stringValue)
                return EscapeJsonString(stringValue);
            if (value is bool boolValue)
                return boolValue ? "true" : "false";
            if (value is DateTime dateTimeValue)
                return EscapeJsonString(ToUtcSafe(dateTimeValue).ToString("O", CultureInfo.InvariantCulture));
            if (value is int || value is long || value is short || value is byte)
                return Convert.ToString(value, CultureInfo.InvariantCulture);
            if (value is double || value is float || value is decimal)
            {
                var number = Convert.ToDouble(value, CultureInfo.InvariantCulture);
                if (double.IsNaN(number) || double.IsInfinity(number))
                    return "null";
                return number.ToString("0.#####", CultureInfo.InvariantCulture);
            }

            var dict = value as System.Collections.IDictionary;
            if (dict != null)
            {
                var parts = new List<string>();
                foreach (System.Collections.DictionaryEntry entry in dict)
                    parts.Add(EscapeJsonString(Convert.ToString(entry.Key, CultureInfo.InvariantCulture)) + ":" + SerializeJsonValue(entry.Value));
                return "{" + string.Join(",", parts) + "}";
            }

            var enumerable = value as System.Collections.IEnumerable;
            if (enumerable != null)
            {
                var parts = new List<string>();
                foreach (var item in enumerable)
                    parts.Add(SerializeJsonValue(item));
                return "[" + string.Join(",", parts) + "]";
            }

            return EscapeJsonString(Convert.ToString(value, CultureInfo.InvariantCulture));
        }

        private void WriteJsonAtomic(string filePath, object payload)
        {
            var folder = Path.GetDirectoryName(filePath);
            if (!string.IsNullOrWhiteSpace(folder))
                Directory.CreateDirectory(folder);

            var tempPath = string.Format(
                CultureInfo.InvariantCulture,
                "{0}.{1}.{2}.tmp",
                filePath,
                Process.GetCurrentProcess().Id,
                DateTime.UtcNow.Ticks);
            System.IO.File.WriteAllText(tempPath, SerializeJsonValue(payload) + Environment.NewLine, new UTF8Encoding(false));
            if (System.IO.File.Exists(filePath))
                System.IO.File.Delete(filePath);
            System.IO.File.Move(tempPath, filePath);
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

        private string NormalizeTradeProfile(string profileRaw, string tfRaw)
        {
            var value = string.IsNullOrWhiteSpace(profileRaw) ? "" : profileRaw.Trim().ToLowerInvariant();
            if (value.Contains("scalp")) return "scalp";
            if (value.Contains("swing")) return "swing";
            if (value.Contains("daily") || value.Contains("intraday")) return "daily";

            var tf = string.IsNullOrWhiteSpace(tfRaw) ? "" : tfRaw.Trim().ToLowerInvariant();
            if (tf == "1" || tf == "1m" || tf == "m1") return "scalp";
            if (tf == "5" || tf == "5m" || tf == "m5") return "swing";
            if (!string.IsNullOrEmpty(tf)) return "daily";
            return "";
        }

        private string NormalizeTradeTfLabel(string tfRaw)
        {
            var tf = string.IsNullOrWhiteSpace(tfRaw) ? "" : tfRaw.Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(tf)) return "";
            switch (tf)
            {
                case "1":
                case "1m":
                case "m1":
                    return "1m";
                case "5":
                case "5m":
                case "m5":
                    return "5m";
                case "15":
                case "15m":
                case "m15":
                    return "15m";
                case "60":
                case "1h":
                case "h1":
                    return "1h";
                case "240":
                case "4h":
                case "h4":
                    return "4h";
                case "1440":
                case "1d":
                case "d1":
                case "daily":
                    return "1d";
                default:
                    return tfRaw.Trim();
            }
        }

        private string NormalizeChartTradeProfileSelection(string raw = null)
        {
            var value = string.IsNullOrWhiteSpace(raw) ? _chartSelectedTradeProfile : raw.Trim();
            if (value.Equals("Swing", StringComparison.OrdinalIgnoreCase)) return "Swing";
            if (value.Equals("Daily", StringComparison.OrdinalIgnoreCase)) return "Daily";
            return "Scalp";
        }

        private string GetChartTradeProfileRaw(string raw = null)
        {
            var normalized = NormalizeChartTradeProfileSelection(raw);
            return normalized.ToLowerInvariant();
        }

        private string GetCustomUiSettingsFilePath()
        {
            try
            {
                var configPath = GetBaseServerConfigPath();
                return Path.Combine(configPath, CustomUiSettingsFileName);
            }
            catch
            {
                return Path.Combine(Environment.CurrentDirectory, CustomUiSettingsFileName);
            }
        }

        private void LoadCustomUiSettings()
        {
            _customUiSettings.Clear();
            _customUiSettingsSerializedSnapshot = "";

            try
            {
                var path = GetCustomUiSettingsFilePath();
                if (!System.IO.File.Exists(path))
                    return;

                foreach (var rawLine in System.IO.File.ReadAllLines(path))
                {
                    var line = rawLine ?? "";
                    var separatorIndex = line.IndexOf('=');
                    if (separatorIndex <= 0)
                        continue;

                    var key = line.Substring(0, separatorIndex).Trim();
                    var value = line.Substring(separatorIndex + 1);
                    if (string.IsNullOrWhiteSpace(key))
                        continue;

                    _customUiSettings[key] = value ?? "";
                }

                _customUiSettingsSerializedSnapshot = SerializeCustomUiSettingsSnapshot();
                PrintBypassLogFilter("[Settings] Loaded custom UI settings from {0}", path);
            }
            catch (Exception ex)
            {
                PrintBypassLogFilter("[Settings] Load failed: {0}", ex.Message);
            }
        }

        private string SerializeCustomUiSettingsSnapshot()
        {
            return string.Join(
                Environment.NewLine,
                _customUiSettings
                    .OrderBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase)
                    .Select(kv => string.Format(CultureInfo.InvariantCulture, "{0}={1}", kv.Key, kv.Value ?? ""))
                    .ToArray());
        }

        private void SaveCustomUiSettings()
        {
            try
            {
                var serialized = SerializeCustomUiSettingsSnapshot();
                if (string.Equals(serialized, _customUiSettingsSerializedSnapshot, StringComparison.Ordinal))
                    return;

                var path = GetCustomUiSettingsFilePath();
                var folder = Path.GetDirectoryName(path);
                if (!string.IsNullOrWhiteSpace(folder))
                    Directory.CreateDirectory(folder);

                var lines = string.IsNullOrEmpty(serialized)
                    ? new string[0]
                    : serialized.Split(new[] { Environment.NewLine }, StringSplitOptions.None);
                System.IO.File.WriteAllLines(path, lines);
                _customUiSettingsSerializedSnapshot = serialized;
                PrintBypassLogFilter("[Settings] Saved custom UI settings to {0}", path);
            }
            catch (Exception ex)
            {
                PrintBypassLogFilter("[Settings] Save failed: {0}", ex.Message);
            }
        }

        private string GetCustomUiSetting(string key, string fallback = "")
        {
            string value;
            return !string.IsNullOrWhiteSpace(key) && _customUiSettings.TryGetValue(key, out value)
                ? (value ?? "")
                : fallback;
        }

        private bool TryParseFlexibleBool(string raw, out bool value)
        {
            value = false;
            if (string.IsNullOrWhiteSpace(raw))
                return false;

            var normalized = raw.Trim();
            bool parsedBool;
            if (bool.TryParse(normalized, out parsedBool))
            {
                value = parsedBool;
                return true;
            }

            switch (normalized.ToLowerInvariant())
            {
                case "yes":
                case "y":
                case "1":
                case "on":
                    value = true;
                    return true;
                case "no":
                case "n":
                case "0":
                case "off":
                    value = false;
                    return true;
                default:
                    return false;
            }
        }

        private bool TryGetCustomUiBool(string key, out bool value)
        {
            value = false;
            var raw = GetCustomUiSetting(key, null);
            return TryParseFlexibleBool(raw, out value);
        }

        private void SetCustomUiSetting(string key, string value)
        {
            if (string.IsNullOrWhiteSpace(key))
                return;
            _customUiSettings[key] = value ?? "";
        }

        private void ApplyCustomUiSettingsOverrides()
        {
            var selectedSymbol = GetCustomUiSetting("chart.symbol", "");
            if (!string.IsNullOrWhiteSpace(selectedSymbol))
                _chartSelectedSymbol = selectedSymbol.Trim().ToUpperInvariant();

            var selectedDirection = GetCustomUiSetting("chart.direction", "");
            if (!string.IsNullOrWhiteSpace(selectedDirection))
                _chartSelectedDirection = NormalizeChartDirectionSelection(selectedDirection);

            var selectedTradeProfile = GetCustomUiSetting("chart.trade_profile", "");
            if (!string.IsNullOrWhiteSpace(selectedTradeProfile))
                _chartSelectedTradeProfile = NormalizeChartTradeProfileSelection(selectedTradeProfile);

            bool savedValue;
            if (TryGetCustomUiBool("toggle.htf_1d", out savedValue)) _toggleHtf1D = savedValue;
            if (TryGetCustomUiBool("toggle.htf_4h", out savedValue)) _toggleHtf4H = savedValue;
            if (TryGetCustomUiBool("toggle.htf_15m", out savedValue)) _toggleHtf15 = savedValue;
            if (TryGetCustomUiBool("toggle.killer_zones", out savedValue)) _toggleKillerZones = savedValue;
            if (TryGetCustomUiBool("toggle.liquidity", out savedValue)) _toggleLiquidityLevels = savedValue;
            if (TryGetCustomUiBool("toggle.sweep", out savedValue)) _toggleSweepDetections = savedValue;
            if (TryGetCustomUiBool("toggle.bos", out savedValue)) _toggleBosDetections = savedValue;
            if (TryGetCustomUiBool("toggle.choch", out savedValue)) _toggleChochDetections = savedValue;
            if (TryGetCustomUiBool("toggle.rejection", out savedValue)) _toggleRejectionDetections = savedValue;
            if (TryGetCustomUiBool("toggle.breakout", out savedValue)) _toggleBreakoutDetections = savedValue;
            if (TryGetCustomUiBool("toggle.pullback", out savedValue)) _togglePullbackDetections = savedValue;
            if (TryGetCustomUiBool("toggle.continuation", out savedValue)) _toggleContinuationDetections = savedValue;
            if (TryGetCustomUiBool("toggle.impulse", out savedValue)) _toggleImpulseDetections = savedValue;
            if (TryGetCustomUiBool("toggle.pin_bar", out savedValue)) _togglePinBarPatterns = savedValue;
            if (TryGetCustomUiBool("toggle.engulfing", out savedValue)) _toggleEngulfingPatterns = savedValue;
            if (TryGetCustomUiBool("toggle.big_candle", out savedValue)) _toggleBigCandlePatterns = savedValue;
            if (TryGetCustomUiBool("toggle.morning_star", out savedValue)) _toggleMorningStarPatterns = savedValue;
            if (TryGetCustomUiBool("toggle.evening_star", out savedValue)) _toggleEveningStarPatterns = savedValue;
            if (TryGetCustomUiBool("toggle.hammer", out savedValue)) _toggleHammerPatterns = savedValue;
            if (TryGetCustomUiBool("toggle.hanging_man", out savedValue)) _toggleHangingManPatterns = savedValue;
            if (TryGetCustomUiBool("toggle.shooting_star", out savedValue)) _toggleShootingStarPatterns = savedValue;
            if (TryGetCustomUiBool("toggle.inverted_hammer", out savedValue)) _toggleInvertedHammerPatterns = savedValue;
            if (TryGetCustomUiBool("toggle.piercing_line", out savedValue)) _togglePiercingLinePatterns = savedValue;
            if (TryGetCustomUiBool("toggle.dark_cloud_cover", out savedValue)) _toggleDarkCloudCoverPatterns = savedValue;
            if (TryGetCustomUiBool("toggle.three_white_soldiers", out savedValue)) _toggleThreeWhiteSoldiersPatterns = savedValue;
            if (TryGetCustomUiBool("toggle.three_black_crows", out savedValue)) _toggleThreeBlackCrowsPatterns = savedValue;
            if (TryGetCustomUiBool("toggle.harami", out savedValue)) _toggleHaramiPatterns = savedValue;
            if (TryGetCustomUiBool("toggle.ema_overlay", out savedValue)) _toggleEmaOverlay = savedValue;
            if (TryGetCustomUiBool("toggle.vwap_overlay", out savedValue)) _toggleVwapOverlay = savedValue;
            if (TryGetCustomUiBool("toggle.bollinger_overlay", out savedValue)) _toggleBollingerOverlay = savedValue;
            if (TryGetCustomUiBool("toggle.ema_events", out savedValue)) _toggleEmaEvents = savedValue;
            if (TryGetCustomUiBool("toggle.vwap_events", out savedValue)) _toggleVwapEvents = savedValue;
            if (TryGetCustomUiBool("toggle.bollinger_events", out savedValue)) _toggleBollingerEvents = savedValue;
            if (TryGetCustomUiBool("toggle.rsi_events", out savedValue)) _toggleRsiEvents = savedValue;
            if (TryGetCustomUiBool("toggle.stochastic_events", out savedValue)) _toggleStochasticEvents = savedValue;
            if (TryGetCustomUiBool("toggle.macd_events", out savedValue)) _toggleMacdEvents = savedValue;
            if (TryGetCustomUiBool("toggle.fvg", out savedValue)) _toggleFvgZones = savedValue;
            if (TryGetCustomUiBool("toggle.ob", out savedValue)) _toggleOrderBlocks = savedValue;
            if (TryGetCustomUiBool("toggle.htf_mini", out savedValue)) _toggleHtfMiniChart = savedValue;
            if (TryGetCustomUiBool("toggle.key_levels", out savedValue)) _toggleKeyLevels = savedValue;
            if (TryGetCustomUiBool("toggle.htf_zones", out savedValue)) _toggleHigherTimeframeZones = savedValue;
            if (TryGetCustomUiBool("toggle.strategy_markers", out savedValue)) _toggleStrategyMarkers = savedValue;
        }

        private void PersistCustomUiSettingsSnapshot()
        {
            SetCustomUiSetting("chart.symbol", _chartSelectedSymbol ?? "");
            SetCustomUiSetting("chart.direction", _chartSelectedDirection ?? "");
            SetCustomUiSetting("chart.trade_profile", _chartSelectedTradeProfile ?? "");

            SetCustomUiSetting("toggle.htf_1d", _toggleHtf1D.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.htf_4h", _toggleHtf4H.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.htf_15m", _toggleHtf15.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.killer_zones", _toggleKillerZones.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.liquidity", _toggleLiquidityLevels.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.sweep", _toggleSweepDetections.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.bos", _toggleBosDetections.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.choch", _toggleChochDetections.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.rejection", _toggleRejectionDetections.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.breakout", _toggleBreakoutDetections.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.pullback", _togglePullbackDetections.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.continuation", _toggleContinuationDetections.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.impulse", _toggleImpulseDetections.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.pin_bar", _togglePinBarPatterns.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.engulfing", _toggleEngulfingPatterns.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.big_candle", _toggleBigCandlePatterns.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.morning_star", _toggleMorningStarPatterns.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.evening_star", _toggleEveningStarPatterns.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.hammer", _toggleHammerPatterns.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.hanging_man", _toggleHangingManPatterns.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.shooting_star", _toggleShootingStarPatterns.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.inverted_hammer", _toggleInvertedHammerPatterns.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.piercing_line", _togglePiercingLinePatterns.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.dark_cloud_cover", _toggleDarkCloudCoverPatterns.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.three_white_soldiers", _toggleThreeWhiteSoldiersPatterns.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.three_black_crows", _toggleThreeBlackCrowsPatterns.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.harami", _toggleHaramiPatterns.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.ema_overlay", _toggleEmaOverlay.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.vwap_overlay", _toggleVwapOverlay.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.bollinger_overlay", _toggleBollingerOverlay.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.ema_events", _toggleEmaEvents.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.vwap_events", _toggleVwapEvents.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.bollinger_events", _toggleBollingerEvents.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.rsi_events", _toggleRsiEvents.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.stochastic_events", _toggleStochasticEvents.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.macd_events", _toggleMacdEvents.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.fvg", _toggleFvgZones.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.ob", _toggleOrderBlocks.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.htf_mini", _toggleHtfMiniChart.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.key_levels", _toggleKeyLevels.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.htf_zones", _toggleHigherTimeframeZones.ToString(CultureInfo.InvariantCulture));
            SetCustomUiSetting("toggle.strategy_markers", _toggleStrategyMarkers.ToString(CultureInfo.InvariantCulture));

            SaveCustomUiSettings();
        }

        private TimeFrame GetChartTradeStructureTimeFrame(string profileRaw)
        {
            switch (NormalizeTradeProfile(profileRaw, ""))
            {
                case "swing":
                    return TimeFrame.Hour4;
                case "daily":
                    return TimeFrame.Daily;
                case "scalp":
                default:
                    return TimeFrame.Hour;
            }
        }

        private string GetChartTradeStructureTfLabel(string profileRaw)
        {
            var profile = NormalizeTradeProfile(profileRaw, "");
            if (profile == "scalp") return "CUR+HTF";
            var timeFrame = GetChartTradeStructureTimeFrame(profileRaw);
            if (timeFrame == TimeFrame.Daily) return "1D";
            if (timeFrame == TimeFrame.Hour4) return "4H";
            return "1H";
        }

        private List<TimeFrame> GetChartTradeStructureTimeFrames(string profileRaw)
        {
            var frames = new List<TimeFrame>();
            var profile = NormalizeTradeProfile(profileRaw, "");
            if (profile == "daily")
            {
                frames.Add(TimeFrame.Daily);
                return frames;
            }

            if (profile == "swing")
            {
                frames.Add(TimeFrame.Hour4);
                return frames;
            }

            var currentTf = Chart != null ? Chart.TimeFrame : TimeFrame.Minute;
            frames.Add(currentTf);
            frames.Add(TimeFrame.Hour);
            frames.Add(TimeFrame.Hour4);
            frames.Add(TimeFrame.Daily);

            return frames
                .Where(tf => tf != null)
                .Distinct()
                .ToList();
        }

        private double GetTradeProfileRiskMultiplier(string profileRaw, string tfRaw)
        {
            return 1.0;
        }

        private string BuildBrokerLabel(string strategy, string entryModel, string profileRaw, string tfRaw)
        {
            var parts = new List<string>();
            var strategyValue = string.IsNullOrWhiteSpace(strategy) ? "" : Regex.Replace(strategy.Trim(), "\\s+", " ");
            var entryModelValue = string.IsNullOrWhiteSpace(entryModel) ? "" : Regex.Replace(entryModel.Trim(), "\\s+", " ");
            var profileValue = NormalizeTradeProfile(profileRaw, tfRaw);
            var tfValue = NormalizeTradeTfLabel(tfRaw);
            if (!string.IsNullOrEmpty(strategyValue)) parts.Add(strategyValue);
            if (!string.IsNullOrEmpty(entryModelValue) && !string.Equals(entryModelValue, strategyValue, StringComparison.OrdinalIgnoreCase)) parts.Add(entryModelValue);
            if (!string.IsNullOrEmpty(profileValue) || !string.IsNullOrEmpty(tfValue))
            {
                parts.Add(string.Format(
                    CultureInfo.InvariantCulture,
                    "{0}{1}{2}",
                    profileValue,
                    !string.IsNullOrEmpty(profileValue) && !string.IsNullOrEmpty(tfValue) ? " " : "",
                    tfValue));
            }
            var value = string.Join(" / ", parts);
            if (string.IsNullOrEmpty(value)) return MagicNumber.ToString();
            if (value.Length <= 50) return value;
            return value.Substring(0, 50);
        }

        private string BuildChartTradeLabel(string action, string orderType, string symbolName)
        {
            return "pa_manual";
        }

        private string BuildChartPendingComment(TradeType tradeType, bool isStopOrder, string symbolName)
        {
            var side = tradeType == TradeType.Buy ? "buy" : "sell";
            var type = isStopOrder ? "stp" : "lmt";
            var symbol = string.IsNullOrWhiteSpace(symbolName) ? "" : symbolName.Trim().ToLowerInvariant();
            return string.Format(CultureInfo.InvariantCulture, "pa_manual:{0}:{1}:{2}", side, type, symbol).TrimEnd(':');
        }

        private string ResolveProviderCode(string brokerName)
        {
            var name = string.IsNullOrWhiteSpace(brokerName) ? "" : brokerName.Trim().ToLowerInvariant();
            if (name.Contains("ic market") || name.Contains("icmarkets")) return "ICMARKETS";
            if (name.Contains("oanda")) return "OANDA";
            if (name.Contains("eightcap") || name.Contains("8cap")) return "EIGHTCAP";
            if (name.Contains("pepperstone")) return "PEPPERSTONE";
            if (name.Contains("forex.com") || name.Contains("forexcom") || name.Contains("gain capital")) return "FOREXCOM";
            if (name.Contains("fxcm")) return "FXCM";
            if (name.Contains("xm group") || name.Contains("xm.com")) return "XM";
            if (name.Contains("exness")) return "EXNESS";
            if (name.Contains("roboforex")) return "ROBOFOREX";
            return "";
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
            if (IsChartAllSymbolsSelection(rawSymbol))
                return null;

            string resolvedName;
            if (!TryResolveBrokerSymbol(NormalizeSymbolAlias(rawSymbol), out resolvedName)) return null;
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

        private static void TrySetEnumPropertyValue(object target, string propertyName, string enumName)
        {
            if (target == null || string.IsNullOrWhiteSpace(propertyName) || string.IsNullOrWhiteSpace(enumName)) return;
            try
            {
                var prop = target.GetType().GetProperty(propertyName);
                if (prop == null || !prop.CanWrite) return;
                var targetType = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;
                if (!targetType.IsEnum) return;
                var parsed = Enum.Parse(targetType, enumName, true);
                prop.SetValue(target, parsed, null);
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

        private int GetChartMarkerFontSize()
        {
            switch (MarkerFontSize)
            {
                case ChartMarkerFontSizeMode.None:
                    return 0;
                case ChartMarkerFontSizeMode.Tiny:
                    return 6;
                case ChartMarkerFontSizeMode.Medium:
                    return 10;
                case ChartMarkerFontSizeMode.Large:
                    return 12;
                case ChartMarkerFontSizeMode.Small:
                default:
                    return 8;
            }
        }

        private int GetChartMarkerFontLevel()
        {
            switch (MarkerFontSize)
            {
                case ChartMarkerFontSizeMode.None:
                    return -1;
                case ChartMarkerFontSizeMode.Tiny:
                    return 0;
                case ChartMarkerFontSizeMode.Medium:
                    return 2;
                case ChartMarkerFontSizeMode.Large:
                    return 3;
                case ChartMarkerFontSizeMode.Small:
                default:
                    return 1;
            }
        }

        private int ResolveChartMarkerFontSize(TimeFrame sourceTimeFrame)
        {
            if (!ShouldDrawChartMarkers())
                return 0;
            var level = GetChartMarkerFontLevel();
            var chartTimeFrame = Chart != null ? Chart.TimeFrame : TimeFrame.Minute;
            var chartTfMinutes = Math.Max(1, TimeFrameToMinutes(chartTimeFrame));
            var sourceTfMinutes = Math.Max(1, TimeFrameToMinutes(sourceTimeFrame));

            if (sourceTfMinutes > chartTfMinutes)
            {
                if (sourceTfMinutes >= 1440)
                    level += 3;
                else if (sourceTfMinutes >= 240)
                    level += 2;
                else if (sourceTfMinutes >= 60)
                    level += 1;
                else if (sourceTfMinutes >= 15)
                    level += 1;
            }

            level = Math.Max(0, Math.Min(3, level));
            switch (level)
            {
                case 0:
                    return 6;
                case 1:
                    return 8;
                case 2:
                    return 10;
                case 3:
                default:
                    return 12;
            }
        }

        private string FormatDirectionalMarkerText(string label, bool isBullish)
        {
            if (ShowMarkerLabel == ChartLabelVisibilityMode.No)
                return MarkerSymbol == ChartMarkerSymbolMode.Triangles
                    ? (isBullish ? "▲" : "▼")
                    : (isBullish ? "↑" : "↓");

            var normalized = string.IsNullOrWhiteSpace(label)
                ? "evt"
                : label.Trim().ToLowerInvariant();
            var prefix = MarkerSymbol == ChartMarkerSymbolMode.Triangles
                ? (isBullish ? "▲" : "▼")
                : (isBullish ? "↑" : "↓");
            return prefix + " " + normalized;
        }

        private bool ShouldDrawChartMarkers()
        {
            return MarkerFontSize != ChartMarkerFontSizeMode.None;
        }

        private static void TrySetChartObjectBackground(object chartObject)
        {
            if (chartObject == null) return;
            TrySetPropertyValue(chartObject, "IsBackground", true);
            TrySetPropertyValue(chartObject, "IsInteractive", false);
            TrySetPropertyValue(chartObject, "ZIndex", -10);
        }

        private int DrawBlurredCandleOverlay(
            string objectPrefix,
            int objectIndex,
            DateTime startTime,
            DateTime endTime,
            double high,
            double low,
            double open,
            double close,
            Color wickFillColor,
            Color wickBorderColor,
            Color bodyFillColor,
            Color bodyBorderColor)
        {
            if (endTime <= startTime)
                return objectIndex;

            var isMiniChart = string.Equals(objectPrefix, "MINI", StringComparison.OrdinalIgnoreCase);
            var bodyHigh = Math.Max(open, close);
            var bodyLow = Math.Min(open, close);
            var durationMinutes = Math.Max(1.0, (endTime - startTime).TotalMinutes);
            var wickStart = startTime.AddMinutes(durationMinutes * (isMiniChart ? 0.44 : 0.47));
            var wickEnd = startTime.AddMinutes(durationMinutes * (isMiniChart ? 0.56 : 0.53));
            if (wickEnd <= wickStart)
                wickEnd = wickStart.AddMinutes(1);

            if (high > bodyHigh)
            {
                var upperWick = Chart.DrawRectangle(
                    objectPrefix + "_WICK_U_" + objectIndex.ToString(CultureInfo.InvariantCulture),
                    wickStart,
                    high,
                    wickEnd,
                    bodyHigh,
                    wickFillColor);
                TrySetPropertyValue(upperWick, "IsFilled", true);
                TrySetPropertyValue(upperWick, "Color", wickFillColor);
                TrySetPropertyValue(upperWick, "BorderColor", wickBorderColor);
                TrySetPropertyValue(upperWick, "Thickness", isMiniChart ? 1 : 0);
                TrySetChartObjectBackground(upperWick);
            }

            if (bodyLow > low)
            {
                var lowerWick = Chart.DrawRectangle(
                    objectPrefix + "_WICK_L_" + objectIndex.ToString(CultureInfo.InvariantCulture),
                    wickStart,
                    bodyLow,
                    wickEnd,
                    low,
                    wickFillColor);
                TrySetPropertyValue(lowerWick, "IsFilled", true);
                TrySetPropertyValue(lowerWick, "Color", wickFillColor);
                TrySetPropertyValue(lowerWick, "BorderColor", wickBorderColor);
                TrySetPropertyValue(lowerWick, "Thickness", isMiniChart ? 1 : 0);
                TrySetChartObjectBackground(lowerWick);
            }

            var bodyRect = Chart.DrawRectangle(
                objectPrefix + "_BODY_" + objectIndex.ToString(CultureInfo.InvariantCulture),
                startTime,
                bodyHigh,
                endTime,
                bodyLow,
                bodyFillColor);
            TrySetPropertyValue(bodyRect, "IsFilled", true);
            TrySetPropertyValue(bodyRect, "Color", bodyFillColor);
            TrySetPropertyValue(bodyRect, "BorderColor", bodyBorderColor);
            TrySetPropertyValue(bodyRect, "Thickness", isMiniChart ? 1 : 1);
            TrySetChartObjectBackground(bodyRect);

            return objectIndex + 1;
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

        private List<string> BuildRiskDashboardLines(RiskGateState riskState)
        {
            const int metricWidth = 12;
            const int currentWidth = 11;
            const int limitWidth = 11;

            Func<string, double, double, string> buildRiskRow = (label, currentValue, limitValue) =>
                BuildTextTableRow(
                    PadCell(label, metricWidth),
                    PadCell(string.Format(CultureInfo.InvariantCulture, "{0}%", FormatDashboardPercent(currentValue)), currentWidth, true),
                    PadCell(limitValue > 0 ? string.Format(CultureInfo.InvariantCulture, "{0}%", FormatDashboardPercent(limitValue)) : "-", limitWidth, true));
            Func<string, double, string, string> buildRiskRowWithLimitText = (label, currentValue, limitText) =>
                BuildTextTableRow(
                    PadCell(label, metricWidth),
                    PadCell(string.Format(CultureInfo.InvariantCulture, "{0}%", FormatDashboardPercent(currentValue)), currentWidth, true),
                    PadCell(string.IsNullOrWhiteSpace(limitText) ? "-" : limitText.Trim(), limitWidth, true));
            Func<string, string, string, string> buildInfoRow = (label, currentValue, limitValue) =>
                BuildTextTableRow(
                    PadCell(label, metricWidth),
                    PadCell(string.IsNullOrWhiteSpace(currentValue) ? "-" : currentValue.Trim(), currentWidth, true),
                    PadCell(string.IsNullOrWhiteSpace(limitValue) ? "-" : limitValue.Trim(), limitWidth, true));
            Func<string, string> buildSectionRow = label =>
                BuildTextTableRow(
                    PadCell(label, metricWidth),
                    PadCell("", currentWidth, true),
                    PadCell("", limitWidth, true));

            Func<RiskTemplate, List<string>> buildTemplateSection = template =>
            {
                var lines = new List<string>
                {
                    BuildTextTableRow(
                        PadCell(template.ToString(), 9),
                        PadCell("CUR", 9, true),
                        PadCell("LIM", 9, true))
                };
                if (template != RiskTemplate.Custom)
                {
                    var configuredTradeRiskLimit = Math.Max(0.0, MaxRiskPercent);
                    var configuredOpenRiskLimit = Math.Max(0.0, MaxTotalOpenRiskPercent);
                    lines.Add(buildRiskRow("Day Loss", riskState.DailyLossPercent, GetEffectiveMaxDailyLossPercent(template)));
                    lines.Add(buildRiskRow("Drawdown", riskState.EquityDrawdownPercent, GetEffectiveMaxEquityDrawdownPercent(template)));
                    lines.Add(buildInfoRow("DD Mode", GetRiskDrawdownModeLabel(template), GetRiskDrawdownModeLabel(template)));
                    lines.Add(buildSectionRow("--- Trade Config ---"));
                    lines.Add(buildRiskRow("M. Trade Risk", riskState.MaxSingleOpenRiskPercent, configuredTradeRiskLimit));
                    lines.Add(buildRiskRow("M. Total Risk", riskState.TotalOpenRiskPercent, configuredOpenRiskLimit));
                    lines.Add(buildRiskRowWithLimitText("Same idea Risk", GetCurrentSymbolDirectionalRiskPercent(), GetRiskSameDirectionLimitLabel(RiskTemplate.Custom)));
                    lines.Add(buildInfoRow("News", GetEffectiveHighImpactNewsBlockEnabled(RiskTemplate.Custom) ? "ON" : "OFF", GetRiskNewsLimitLabel(RiskTemplate.Custom)));
                    lines.Add(buildInfoRow("Overnight", GetEffectiveNoOvernightHold(RiskTemplate.Custom) ? "BLOCK" : "ALLOW", GetRiskOvernightLimitLabel(RiskTemplate.Custom)));
                    lines.Add(buildInfoRow("Weekend", GetEffectiveNoWeekendHold(RiskTemplate.Custom) ? "BLOCK" : "ALLOW", GetRiskWeekendLimitLabel(RiskTemplate.Custom)));
                    return lines;
                }

                lines.Add(buildRiskRow("Day Loss", riskState.DailyLossPercent, GetEffectiveMaxDailyLossPercent(template)));
                lines.Add(buildRiskRow("Drawdown", riskState.EquityDrawdownPercent, GetEffectiveMaxEquityDrawdownPercent(template)));
                lines.Add(buildInfoRow("DD Mode", GetRiskDrawdownModeLabel(template), GetRiskDrawdownModeLabel(template)));
                lines.Add(buildSectionRow("--- Trade Config ---"));
                lines.Add(buildRiskRow("M. Trade Risk", riskState.MaxSingleOpenRiskPercent, Math.Max(0.0, MaxRiskPercent)));
                lines.Add(buildRiskRow("M. Total Risk", riskState.TotalOpenRiskPercent, Math.Max(0.0, MaxTotalOpenRiskPercent)));
                lines.Add(buildRiskRowWithLimitText("Same idea Risk", GetCurrentSymbolDirectionalRiskPercent(), GetRiskSameDirectionLimitLabel(RiskTemplate.Custom)));
                lines.Add(buildInfoRow("News", GetEffectiveHighImpactNewsBlockEnabled(RiskTemplate.Custom) ? "ON" : "OFF", GetRiskNewsLimitLabel(RiskTemplate.Custom)));
                lines.Add(buildInfoRow("Overnight", GetEffectiveNoOvernightHold(RiskTemplate.Custom) ? "BLOCK" : "ALLOW", GetRiskOvernightLimitLabel(RiskTemplate.Custom)));
                lines.Add(buildInfoRow("Weekend", GetEffectiveNoWeekendHold(RiskTemplate.Custom) ? "BLOCK" : "ALLOW", GetRiskWeekendLimitLabel(RiskTemplate.Custom)));
                return lines;
            };

            if (SelectedRiskTemplate != RiskTemplate.Custom)
                return buildTemplateSection(SelectedRiskTemplate);

            var combined = new List<string>();
            combined.AddRange(buildTemplateSection(RiskTemplate.FTMO_1Step));
            combined.Add(" -----");
            combined.AddRange(buildTemplateSection(RiskTemplate.Custom));
            return combined;
        }

        private static string GetFirstLine(string text)
        {
            if (string.IsNullOrEmpty(text))
                return "";

            var newlineIndex = text.IndexOf('\n');
            return newlineIndex >= 0 ? text.Substring(0, newlineIndex) : text;
        }

        private static string GetRemainingLines(string text)
        {
            if (string.IsNullOrEmpty(text))
                return "";

            var newlineIndex = text.IndexOf('\n');
            return newlineIndex >= 0 && newlineIndex + 1 < text.Length ? text.Substring(newlineIndex + 1) : "";
        }

        private static Color WithAlpha(Color color, int alpha)
        {
            return Color.FromArgb(alpha, color.R, color.G, color.B);
        }

        private static TimeSpan ParseTimeSpanOrDefault(string value, TimeSpan fallback)
        {
            if (string.IsNullOrWhiteSpace(value)) return fallback;
            TimeSpan parsed;
            return TimeSpan.TryParse(value.Trim(), CultureInfo.InvariantCulture, out parsed) ? parsed : fallback;
        }

        private void RemoveChartVisualObjects()
        {
            for (var i = 0; i < 256; i++)
            {
                Chart.RemoveObject("H4BG_BODY_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("H4BG_WICK_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("H4BG_WICK_U_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("H4BG_WICK_L_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("MINI_BODY_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("MINI_WICK_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("MINI_WICK_U_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("MINI_WICK_L_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("MINI_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("MINI_PAD_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("KZ_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("KZ_TOP_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("KZ_BOT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("KZ_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("KZ_TXT2_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("LIQ_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("LIQ_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("SWEEP_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("SWEEP_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("BOS_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("BOS_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("CHOCH_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("CHOCH_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("RJ_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("RJ_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("BR_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("BR_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("PB_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("PB_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("CT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("CT_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("IM_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("IM_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("PIN_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("PIN_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("ENG_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("ENG_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("STR_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("STR_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("SEQ_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("SEQ_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("BIG_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("BIG_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("FVG_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("OB_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("HTF_FVG_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("HTF_OB_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("KEY_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("KEY_TXT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("STRAT_" + i.ToString(CultureInfo.InvariantCulture));
                Chart.RemoveObject("STRAT_TXT_" + i.ToString(CultureInfo.InvariantCulture));

                foreach (var tfLabel in new[] { "1m", "5m", "15m", "1H", "4H", "1D" })
                {
                    Chart.RemoveObject("PAT_" + tfLabel + "_" + i.ToString(CultureInfo.InvariantCulture));
                    Chart.RemoveObject("RJ_" + tfLabel + "_" + i.ToString(CultureInfo.InvariantCulture));
                    Chart.RemoveObject("RJ_TXT_" + tfLabel + "_" + i.ToString(CultureInfo.InvariantCulture));
                    Chart.RemoveObject("BR_" + tfLabel + "_" + i.ToString(CultureInfo.InvariantCulture));
                    Chart.RemoveObject("BR_TXT_" + tfLabel + "_" + i.ToString(CultureInfo.InvariantCulture));
                    Chart.RemoveObject("PB_" + tfLabel + "_" + i.ToString(CultureInfo.InvariantCulture));
                    Chart.RemoveObject("PB_TXT_" + tfLabel + "_" + i.ToString(CultureInfo.InvariantCulture));
                    Chart.RemoveObject("CT_" + tfLabel + "_" + i.ToString(CultureInfo.InvariantCulture));
                    Chart.RemoveObject("CT_TXT_" + tfLabel + "_" + i.ToString(CultureInfo.InvariantCulture));
                    Chart.RemoveObject("IM_" + tfLabel + "_" + i.ToString(CultureInfo.InvariantCulture));
                    Chart.RemoveObject("IM_TXT_" + tfLabel + "_" + i.ToString(CultureInfo.InvariantCulture));
                }
            }
        }

        private void DrawChartVisualOverlays()
        {
            try
            {
                RemoveChartVisualObjects();
                if (Bars == null || Bars.Count < 5 || Chart == null)
                    return;

                var objectIndex = 0;
                if (_toggleHtf4H)
                    objectIndex = DrawBackgroundAutoHigherTimeframeCandles(objectIndex);
                if (_toggleHtfMiniChart)
                    objectIndex = DrawHtfMiniCharts(objectIndex);
                if (_toggleKillerZones)
                {
                    objectIndex = DrawConfiguredKillerZones(objectIndex);
                }
                if (_toggleLiquidityLevels)
                {
                    objectIndex = DrawLiquidityLevelsOnChart(objectIndex);
                }
                if (_toggleSweepDetections)
                {
                    objectIndex = DrawSweepDetectionsOnChart(objectIndex);
                }
                if (_toggleBosDetections)
                {
                    objectIndex = DrawStructureBreakDetectionsOnChart(objectIndex, false);
                }
                if (_toggleChochDetections)
                {
                    objectIndex = DrawStructureBreakDetectionsOnChart(objectIndex, true);
                }
                if (_toggleRejectionDetections)
                {
                    objectIndex = DrawCanonicalEventsOnChart(objectIndex, CanonicalEventType.Rejection);
                }
                if (_toggleBreakoutDetections)
                {
                    objectIndex = DrawCanonicalEventsOnChart(objectIndex, CanonicalEventType.Breakout);
                }
                if (_togglePullbackDetections)
                {
                    objectIndex = DrawCanonicalEventsOnChart(objectIndex, CanonicalEventType.Pullback);
                }
                if (_toggleContinuationDetections)
                {
                    objectIndex = DrawCanonicalEventsOnChart(objectIndex, CanonicalEventType.Continuation);
                }
                if (_toggleImpulseDetections)
                {
                    objectIndex = DrawCanonicalEventsOnChart(objectIndex, CanonicalEventType.Impulse);
                }
                if (_toggleEmaOverlay || _toggleVwapOverlay || _toggleBollingerOverlay)
                {
                    objectIndex = DrawIndicatorOverlaysOnChart(objectIndex);
                }
                if (_togglePinBarPatterns || _toggleEngulfingPatterns || _toggleBigCandlePatterns ||
                    _toggleMorningStarPatterns || _toggleEveningStarPatterns || _toggleHammerPatterns ||
                    _toggleHangingManPatterns || _toggleShootingStarPatterns || _toggleInvertedHammerPatterns ||
                    _togglePiercingLinePatterns || _toggleDarkCloudCoverPatterns || _toggleThreeWhiteSoldiersPatterns ||
                    _toggleThreeBlackCrowsPatterns || _toggleHaramiPatterns)
                {
                    objectIndex = DrawDirectionalCandlePatternsOnChart(objectIndex);
                }
                if (_toggleEmaEvents || _toggleVwapEvents || _toggleBollingerEvents || _toggleRsiEvents || _toggleStochasticEvents || _toggleMacdEvents)
                {
                    objectIndex = DrawDirectionalIndicatorEventsOnChart(objectIndex);
                }
                if (_toggleFvgZones)
                {
                    objectIndex = DrawRecentFvgZones(Bars, Chart.TimeFrame, "FVG_", objectIndex, GetCurrentChartEndTime());
                }
                if (_toggleOrderBlocks)
                {
                    objectIndex = DrawRecentOrderBlocks(Bars, Chart.TimeFrame, "OB_", objectIndex, GetCurrentChartEndTime());
                }
                if (_toggleHigherTimeframeZones)
                {
                    objectIndex = DrawHigherTimeframeZonesOnChart(objectIndex);
                }
                if (_toggleKeyLevels)
                    objectIndex = DrawKeyLevelsOnChart(objectIndex);
                if (_toggleStrategyMarkers)
                    objectIndex = DrawStrategyMarkersOnChart(objectIndex);
            }
            catch (Exception ex)
            {
                SafePrint("[Visuals] Draw failed: {0}", ex.Message);
            }
        }

        private int DrawBackgroundAutoHigherTimeframeCandles(int objectIndex)
        {
            var chartTfMinutes = TimeFrameToMinutes(Chart != null ? Chart.TimeFrame : TimeFrame.Minute);
            if (chartTfMinutes <= 0)
                return objectIndex;

            try
            {
                var autoFrames = GetAutoHigherTimeframes(Chart != null ? Chart.TimeFrame : TimeFrame.Minute);
                var sourceTimeFrame = autoFrames.Count > 1 ? autoFrames[1] : (autoFrames.Count > 0 ? autoFrames[0] : TimeFrame.Minute);
                if (TimeFrameToMinutes(sourceTimeFrame) <= chartTfMinutes)
                    return objectIndex;

                var sourceBars = MarketData.GetBars(sourceTimeFrame, Chart.SymbolName);
                if (sourceBars == null || sourceBars.Count < 4)
                    return objectIndex;

                var baseColor = GetTimeFrameStructureColor(sourceTimeFrame);
                var wickFill = Color.FromArgb(12, 230, 230, 230);
                var bodyFill = Color.FromArgb(18, 230, 230, 230);
                var borderColor = WithAlpha(baseColor, 72);
                var chartStartTime = Bars.OpenTimes[0];
                var lastCompletedIndex = sourceBars.Count - 2;
                var firstIndex = 0;
                while (firstIndex < lastCompletedIndex && sourceBars.OpenTimes[firstIndex + 1] < chartStartTime)
                    firstIndex++;

                for (var i = firstIndex; i <= lastCompletedIndex; i++)
                {
                    var startTime = sourceBars.OpenTimes[i];
                    var endTime = i + 1 < sourceBars.Count ? sourceBars.OpenTimes[i + 1] : startTime.AddMinutes(Math.Max(1, TimeFrameToMinutes(sourceTimeFrame)));
                    if (endTime <= startTime)
                        endTime = startTime.AddMinutes(Math.Max(1, TimeFrameToMinutes(sourceTimeFrame)));
                    if (endTime < chartStartTime)
                        continue;
                    objectIndex = DrawBlurredCandleOverlay(
                        "HTFBG_" + GetMiniChartLabel(sourceTimeFrame),
                        objectIndex,
                        startTime,
                        endTime,
                        sourceBars.HighPrices[i],
                        sourceBars.LowPrices[i],
                        sourceBars.OpenPrices[i],
                        sourceBars.ClosePrices[i],
                        wickFill,
                        borderColor,
                        bodyFill,
                        borderColor);
                }
            }
            catch (Exception ex)
            {
                SafePrint("[Visuals] HTF background skipped: {0}", ex.Message);
            }

            return objectIndex;
        }

        private int DrawHtfMiniCharts(int objectIndex)
        {
            var chartTfMinutes = TimeFrameToMinutes(Chart != null ? Chart.TimeFrame : TimeFrame.Minute);
            if (chartTfMinutes <= 0 || Bars == null || Bars.Count < 40)
                return objectIndex;

            try
            {
                var miniFrames = GetEnabledAutoHigherTimeframes(Chart != null ? Chart.TimeFrame : TimeFrame.Minute)
                    .Where(tf => TimeFrameToMinutes(tf) > chartTfMinutes)
                    .OrderBy(tf => TimeFrameToMinutes(tf))
                    .Take(2)
                    .ToList();
                if (miniFrames.Count == 0)
                    return objectIndex;

                var slotSpacingBars = 2;
                var totalFutureBars = miniFrames.Sum(GetMiniChartBarsForTimeFrame) + (Math.Max(0, miniFrames.Count - 1) * slotSpacingBars) + 2;
                objectIndex = DrawMiniChartSpacer(chartTfMinutes, totalFutureBars, objectIndex);

                var futureOffsetBars = 1;
                for (var slotIndex = 0; slotIndex < miniFrames.Count; slotIndex++)
                {
                    var tf = miniFrames[slotIndex];
                    objectIndex = DrawSingleMiniChart(tf, chartTfMinutes, futureOffsetBars, slotIndex, objectIndex);
                    futureOffsetBars += GetMiniChartBarsForTimeFrame(tf) + slotSpacingBars;
                }
            }
            catch (Exception ex)
            {
                SafePrint("[Visuals] HTF mini chart skipped: {0}", ex.Message);
            }

            return objectIndex;
        }

        private int DrawSingleMiniChart(TimeFrame timeFrame, int chartTfMinutes, int futureOffsetBars, int miniSlotIndex, int objectIndex)
        {
            var sourceBars = MarketData.GetBars(timeFrame, Chart.SymbolName);
            if (sourceBars == null || sourceBars.Count < 4)
                return objectIndex;

            var lastCompletedIndex = sourceBars.Count - 2;
            var candlesToDraw = Math.Max(3, Math.Min(GetMiniChartBarsForTimeFrame(timeFrame), lastCompletedIndex + 1));
            var firstSourceIndex = Math.Max(0, lastCompletedIndex - candlesToDraw + 1);
            var actualCount = lastCompletedIndex - firstSourceIndex + 1;
            if (actualCount <= 0)
                return objectIndex;

            var priceHigh = double.MinValue;
            var priceLow = double.MaxValue;
            for (var i = firstSourceIndex; i <= lastCompletedIndex; i++)
            {
                priceHigh = Math.Max(priceHigh, sourceBars.HighPrices[i]);
                priceLow = Math.Min(priceLow, sourceBars.LowPrices[i]);
            }

            if (priceHigh <= priceLow || priceHigh == double.MinValue || priceLow == double.MaxValue)
                return objectIndex;

            var tfBaseColor = GetTimeFrameStructureColor(timeFrame);
            var bullishFill = Color.FromArgb(56, 38, 166, 154);
            var bearishFill = Color.FromArgb(56, 239, 83, 80);
            var bullishWickFill = Color.FromArgb(44, 38, 166, 154);
            var bearishWickFill = Color.FromArgb(44, 239, 83, 80);
            var borderColor = WithAlpha(tfBaseColor, 184);
            var labelColor = WithAlpha(tfBaseColor, 220);
            var labelSlotOffset = Math.Max(priceHigh - priceLow, Symbol.PipSize * 20) * 0.08;
            var latestLabelTime = GetCurrentChartEndTime().AddMinutes((futureOffsetBars + actualCount - 0.5) * Math.Max(1, chartTfMinutes));

            for (var localIndex = 0; localIndex < actualCount; localIndex++)
            {
                var sourceIndex = firstSourceIndex + localIndex;
                var slotLeftTime = GetCurrentChartEndTime().AddMinutes((futureOffsetBars + localIndex) * Math.Max(1, chartTfMinutes));
                var slotRightTime = GetCurrentChartEndTime().AddMinutes((futureOffsetBars + localIndex + 1) * Math.Max(1, chartTfMinutes));
                if (slotRightTime <= slotLeftTime)
                    slotRightTime = slotLeftTime.AddMinutes(Math.Max(1, TimeFrameToMinutes(timeFrame)));

                var slotMinutes = Math.Max(1.0, (slotRightTime - slotLeftTime).TotalMinutes);
                var gapMinutes = Math.Min(slotMinutes * 0.22, Math.Max(0.35, slotMinutes * 0.12));
                var leftTime = slotLeftTime.AddMinutes(gapMinutes);
                var rightTime = slotRightTime.AddMinutes(-gapMinutes);
                if (rightTime <= leftTime)
                {
                    leftTime = slotLeftTime;
                    rightTime = slotRightTime;
                }
                var high = sourceBars.HighPrices[sourceIndex];
                var low = sourceBars.LowPrices[sourceIndex];
                var open = sourceBars.OpenPrices[sourceIndex];
                var close = sourceBars.ClosePrices[sourceIndex];
                var wickFill = close >= open ? bullishWickFill : bearishWickFill;
                var bodyFill = close >= open ? bullishFill : bearishFill;
                objectIndex = DrawBlurredCandleOverlay(
                    "MINI",
                    objectIndex,
                    leftTime,
                    rightTime,
                    high,
                    low,
                    open,
                    close,
                    wickFill,
                    borderColor,
                    bodyFill,
                    borderColor);
            }

            var labelY = priceLow - labelSlotOffset;
            var labelText = Chart.DrawText("MINI_TXT_" + objectIndex.ToString(CultureInfo.InvariantCulture), GetMiniChartLabel(timeFrame), latestLabelTime, labelY, labelColor);
            TryStyleChartText(labelText, 9, "Courier New", true);
            TrySetChartObjectBackground(labelText);
            return objectIndex + 1;
        }

        private int GetMiniChartBarsForTimeFrame(TimeFrame timeFrame)
        {
            if (timeFrame == TimeFrame.Daily)
                return 7;
            if (timeFrame == TimeFrame.Hour4)
                return 42;
            return 6;
        }

        private int DrawMiniChartSpacer(int chartTfMinutes, int futureOffsetBars, int objectIndex)
        {
            if (Bars == null || Bars.Count < 10)
                return objectIndex;

            var lookbackBars = Math.Min(Bars.Count, 200);
            var start = Math.Max(0, Bars.Count - lookbackBars);
            var chartHigh = double.MinValue;
            var chartLow = double.MaxValue;
            for (var i = start; i < Bars.Count; i++)
            {
                chartHigh = Math.Max(chartHigh, Bars.HighPrices[i]);
                chartLow = Math.Min(chartLow, Bars.LowPrices[i]);
            }

            if (chartHigh <= chartLow || chartHigh == double.MinValue || chartLow == double.MaxValue)
                return objectIndex;

            var chartEndTime = GetCurrentChartEndTime();
            var padStart = chartEndTime.AddMinutes(Math.Max(5, futureOffsetBars) * Math.Max(1, chartTfMinutes));
            var padEnd = padStart.AddMinutes(Math.Max(10, chartTfMinutes * 8));
            var padColor = Color.FromArgb(1, 255, 255, 255);
            var rect = Chart.DrawRectangle("MINI_PAD_" + objectIndex.ToString(CultureInfo.InvariantCulture), padStart, chartHigh, padEnd, chartLow, padColor);
            TrySetPropertyValue(rect, "IsFilled", true);
            TrySetPropertyValue(rect, "Color", padColor);
            TrySetPropertyValue(rect, "BorderColor", padColor);
            TrySetPropertyValue(rect, "Thickness", 1);
            TrySetChartObjectBackground(rect);
            return objectIndex + 1;
        }

        private void StoreBacktestExportTradeSnapshot(string ticket, BacktestStrategySignal signal, double approvedRiskMoney, double approvedVolumeUnits, double approvedVolumeLots)
        {
            var riskDistance = Math.Abs(signal.EntryPrice - signal.StopLoss);
            var rewardDistance = Math.Abs(signal.TakeProfit - signal.EntryPrice);
            var rewardRisk = riskDistance > 0 ? rewardDistance / riskDistance : 0;
            var equityBase = _backtestExportInitialEquity > 0 ? _backtestExportInitialEquity : _backtestExportInitialBalance;
            var riskPercent = equityBase > 0 && approvedRiskMoney > 0 ? (approvedRiskMoney / equityBase) * 100.0 : 0.0;
            var snapshot = new BacktestExportTradeSnapshot
            {
                StrategyId = signal.StrategyId ?? "",
                TradeType = signal.TradeType,
                SignalTime = signal.SignalTime,
                EntryPrice = signal.EntryPrice,
                StopLoss = signal.StopLoss,
                TakeProfit = signal.TakeProfit,
                RiskAmount = approvedRiskMoney,
                RiskPercent = riskPercent,
                RewardRisk = rewardRisk,
                VolumeInUnits = approvedVolumeUnits,
                VolumeLots = approvedVolumeLots
            };

            _backtestExportTradeSequence.Add(snapshot);

            if (!string.IsNullOrWhiteSpace(ticket))
                _backtestExportTradeSnapshots[ticket.Trim()] = snapshot;
        }

        private int FindBacktestExportTradeSnapshotIndex(
            List<BacktestExportTradeSnapshot> snapshots,
            HashSet<int> usedSnapshotIndexes,
            TradeType tradeType,
            DateTime openedAtUtc,
            double entryPrice,
            double volumeInUnits)
        {
            if (snapshots == null || snapshots.Count == 0)
                return -1;

            var bestIndex = -1;
            var bestScore = double.MaxValue;

            for (var i = 0; i < snapshots.Count; i++)
            {
                if (usedSnapshotIndexes != null && usedSnapshotIndexes.Contains(i))
                    continue;

                var snapshot = snapshots[i];
                if (snapshot.TradeType != tradeType)
                    continue;

                var score = 0.0;
                if (openedAtUtc != DateTime.MinValue && snapshot.SignalTime != DateTime.MinValue)
                    score += Math.Abs((openedAtUtc - snapshot.SignalTime).TotalSeconds);

                if (entryPrice > 0 && snapshot.EntryPrice > 0)
                    score += Math.Abs(entryPrice - snapshot.EntryPrice) * 100000.0;

                if (volumeInUnits > 0 && snapshot.VolumeInUnits > 0)
                    score += Math.Abs(volumeInUnits - snapshot.VolumeInUnits) * 10.0;

                if (bestIndex < 0 || score < bestScore)
                {
                    bestIndex = i;
                    bestScore = score;
                }
            }

            return bestIndex;
        }

        private List<TimeFrame> GetAutoHigherTimeframes(TimeFrame chartTimeFrame)
        {
            var chartTfMinutes = Math.Max(1, TimeFrameToMinutes(chartTimeFrame));
            if (chartTfMinutes <= 1)
                return new List<TimeFrame> { TimeFrame.Minute15, TimeFrame.Hour };
            if (chartTfMinutes <= 5)
                return new List<TimeFrame> { TimeFrame.Hour, TimeFrame.Hour4 };
            if (chartTfMinutes <= 30)
                return new List<TimeFrame> { TimeFrame.Hour4, TimeFrame.Daily };
            if (chartTfMinutes <= 240)
                return new List<TimeFrame> { TimeFrame.Daily, TimeFrame.Weekly };
            return new List<TimeFrame> { TimeFrame.Weekly };
        }

        private List<TimeFrame> GetEnabledAutoHigherTimeframes(TimeFrame chartTimeFrame)
        {
            var frames = GetAutoHigherTimeframes(chartTimeFrame);
            var enabled = new List<TimeFrame>();
            if (frames.Count > 0 && _toggleHtf15)
                enabled.Add(frames[0]);
            if (frames.Count > 1 && _toggleHtf4H)
                enabled.Add(frames[1]);
            return enabled;
        }

        private string GetAutoHigherTimeframeButtonLabel(TimeFrame chartTimeFrame, int slotIndex)
        {
            var frames = GetAutoHigherTimeframes(chartTimeFrame);
            if (slotIndex < 0 || slotIndex >= frames.Count)
                return slotIndex == 0 ? "HTF1" : "HTF2";
            return GetMiniChartLabel(frames[slotIndex]);
        }

        private DateTime GetCurrentChartEndTime()
        {
            if (Bars != null && Bars.Count > 0)
                return Bars.OpenTimes[Bars.Count - 1];
            return Server.Time;
        }

        private int DrawHigherTimeframeZonesOnChart(int objectIndex)
        {
            var chartTimeFrame = Chart != null ? Chart.TimeFrame : TimeFrame.Minute;
            var chartTfMinutes = TimeFrameToMinutes(chartTimeFrame);
            foreach (var tf in GetEnabledAutoHigherTimeframes(chartTimeFrame))
            {
                var tfMinutes = TimeFrameToMinutes(tf);
                if (tfMinutes <= 0 || tfMinutes <= chartTfMinutes)
                    continue;

                try
                {
                    var sourceBars = MarketData.GetBars(tf, Chart.SymbolName);
                    if (sourceBars == null || sourceBars.Count < 5)
                        continue;

                    if (DrawFvgZones)
                        objectIndex = DrawRecentFvgZones(sourceBars, tf, "HTF_FVG_", objectIndex, GetCurrentChartEndTime());
                    if (DrawOrderBlocks)
                        objectIndex = DrawRecentOrderBlocks(sourceBars, tf, "HTF_OB_", objectIndex, GetCurrentChartEndTime());
                }
                catch (Exception ex)
                {
                    SafePrint("[Visuals] HTF {0} skipped: {1}", tf, ex.Message);
                }
            }

            return objectIndex;
        }

        private bool IsHigherTimeframeEnabled(TimeFrame timeFrame)
        {
            var chartTimeFrame = Chart != null ? Chart.TimeFrame : TimeFrame.Minute;
            return GetEnabledAutoHigherTimeframes(chartTimeFrame)
                .Any(tf => tf == timeFrame);
        }

        private bool TryParseTimeFrameToken(string token, out TimeFrame timeFrame)
        {
            timeFrame = TimeFrame.Minute;
            var normalized = (token ?? "").Trim().ToUpperInvariant();
            normalized = normalized.Replace("_", "").Replace("-", "").Replace(" ", "");
            if (string.IsNullOrWhiteSpace(normalized))
                return false;

            if (TryParseNamedTimeFrame(normalized, out timeFrame))
                return true;

            int minutes;
            if (TryParseTimeFrameMinutes(normalized, out minutes) && TryMapMinutesToTimeFrame(minutes, out timeFrame))
                return true;

            return false;
        }

        private bool TryParseNamedTimeFrame(string normalized, out TimeFrame timeFrame)
        {
            timeFrame = TimeFrame.Minute;
            switch (normalized)
            {
                case "DAILY":
                    timeFrame = TimeFrame.Daily;
                    return true;
                case "WEEKLY":
                case "W1":
                case "1W":
                    timeFrame = TimeFrame.Weekly;
                    return true;
                case "MONTHLY":
                case "MN1":
                case "1MO":
                case "1MON":
                case "1MONTH":
                    timeFrame = TimeFrame.Monthly;
                    return true;
            }

            try
            {
                var property = typeof(TimeFrame)
                    .GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
                    .FirstOrDefault(p => p.PropertyType == typeof(TimeFrame) && string.Equals(p.Name, normalized, StringComparison.OrdinalIgnoreCase));
                if (property != null)
                {
                    var value = property.GetValue(null, null);
                    if (value is TimeFrame)
                    {
                        timeFrame = (TimeFrame)value;
                        return true;
                    }
                }
            }
            catch
            {
            }

            return false;
        }

        private bool TryParseTimeFrameMinutes(string normalized, out int minutes)
        {
            minutes = 0;

            int value;
            if (int.TryParse(normalized, NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
            {
                minutes = value;
                return minutes > 0;
            }

            if (normalized.EndsWith("S", StringComparison.Ordinal) && int.TryParse(normalized.Substring(0, normalized.Length - 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
            {
                if (value <= 0 || value % 60 != 0)
                    return false;
                minutes = value / 60;
                return minutes > 0;
            }

            if (normalized.EndsWith("M", StringComparison.Ordinal) && int.TryParse(normalized.Substring(0, normalized.Length - 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
            {
                minutes = value;
                return minutes > 0;
            }

            if (normalized.StartsWith("M", StringComparison.Ordinal) && int.TryParse(normalized.Substring(1), NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
            {
                minutes = value;
                return minutes > 0;
            }

            if (normalized.EndsWith("H", StringComparison.Ordinal) && int.TryParse(normalized.Substring(0, normalized.Length - 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
            {
                minutes = value * 60;
                return minutes > 0;
            }

            if (normalized.StartsWith("H", StringComparison.Ordinal) && int.TryParse(normalized.Substring(1), NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
            {
                minutes = value * 60;
                return minutes > 0;
            }

            if (normalized.EndsWith("D", StringComparison.Ordinal) && int.TryParse(normalized.Substring(0, normalized.Length - 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
            {
                minutes = value * 1440;
                return minutes > 0;
            }

            if (normalized.StartsWith("D", StringComparison.Ordinal) && int.TryParse(normalized.Substring(1), NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
            {
                minutes = value * 1440;
                return minutes > 0;
            }

            if (normalized.EndsWith("W", StringComparison.Ordinal) && int.TryParse(normalized.Substring(0, normalized.Length - 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
            {
                minutes = value * 10080;
                return minutes > 0;
            }

            if (normalized.StartsWith("W", StringComparison.Ordinal) && int.TryParse(normalized.Substring(1), NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
            {
                minutes = value * 10080;
                return minutes > 0;
            }

            return false;
        }

        private bool TryMapMinutesToTimeFrame(int minutes, out TimeFrame timeFrame)
        {
            timeFrame = TimeFrame.Minute;
            if (minutes <= 0)
                return false;

            switch (minutes)
            {
                case 1: timeFrame = TimeFrame.Minute; return true;
                case 5: timeFrame = TimeFrame.Minute5; return true;
                case 15: timeFrame = TimeFrame.Minute15; return true;
                case 30: timeFrame = TimeFrame.Minute30; return true;
                case 60: timeFrame = TimeFrame.Hour; return true;
                case 240: timeFrame = TimeFrame.Hour4; return true;
                case 1440: timeFrame = TimeFrame.Daily; return true;
                case 10080: timeFrame = TimeFrame.Weekly; return true;
                case 43200: timeFrame = TimeFrame.Monthly; return true;
            }

            try
            {
                foreach (var property in typeof(TimeFrame).GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static))
                {
                    if (property.PropertyType != typeof(TimeFrame))
                        continue;

                    var value = property.GetValue(null, null);
                    if (!(value is TimeFrame))
                        continue;

                    var candidate = (TimeFrame)value;
                    if (TimeFrameToMinutes(candidate) == minutes)
                    {
                        timeFrame = candidate;
                        return true;
                    }
                }
            }
            catch
            {
            }

            return false;
        }

        private string GetMiniChartLabel(TimeFrame timeFrame)
        {
            var minutes = TimeFrameToMinutes(timeFrame);
            if (minutes >= 1440) return "1D";
            if (minutes >= 240) return "4H";
            if (minutes >= 60) return "1H";
            if (minutes >= 15) return "15m";
            if (minutes >= 5) return "5m";
            return "1m";
        }

        private int TimeFrameToMinutes(TimeFrame timeFrame)
        {
            var label = Convert.ToString(timeFrame, CultureInfo.InvariantCulture).Trim().ToUpperInvariant();
            int minutes;
            if (TryParseTimeFrameMinutes(label, out minutes))
                return minutes;
            if (label.Contains("MINUTE30") || label == "M30") return 30;
            if (label.Contains("MINUTE15") || label == "M15") return 15;
            if (label.Contains("MINUTE5") || label == "M5") return 5;
            if (label.Contains("MINUTE") || label == "M1") return 1;
            if (label.Contains("HOUR4") || label == "H4") return 240;
            if (label.Contains("HOUR") || label == "H1") return 60;
            if (label.Contains("DAILY") || label == "D1") return 1440;
            if (label.Contains("WEEK") || label == "W1") return 10080;
            if (label.Contains("MONTH") || label == "MN1") return 43200;
            return 0;
        }

        private string GetTimeFrameShortLabel(TimeFrame timeFrame)
        {
            var minutes = TimeFrameToMinutes(timeFrame);
            if (minutes >= 1440) return "D";
            if (minutes >= 240) return "4h";
            if (minutes >= 60) return "1h";
            if (minutes >= 15) return "15m";
            if (minutes >= 5) return "5m";
            return "1m";
        }

        private Color GetTimeFrameStructureColor(TimeFrame timeFrame)
        {
            var minutes = TimeFrameToMinutes(timeFrame);
            if (minutes >= 1440) return Color.Gold;
            if (minutes >= 240) return Color.MediumPurple;
            if (minutes >= 60) return Color.SlateBlue;
            if (minutes >= 15) return Color.DeepSkyBlue;
            if (minutes >= 5) return Color.Gainsboro;
            return Color.WhiteSmoke;
        }

        private List<TimeFrame> GetDashboardEventTimeFrames()
        {
            return new List<TimeFrame>
            {
                TimeFrame.Minute,
                TimeFrame.Minute5,
                TimeFrame.Minute15,
                TimeFrame.Hour,
                TimeFrame.Hour4,
                TimeFrame.Daily
            };
        }

        private string BuildDashboardEventCacheKey(string symbolName, TimeFrame timeFrame)
        {
            return string.Format(
                CultureInfo.InvariantCulture,
                "{0}|{1}",
                string.IsNullOrWhiteSpace(symbolName) ? "" : symbolName.Trim().ToUpperInvariant(),
                GetMiniChartLabel(timeFrame));
        }

        private CanonicalMarketEvent BuildCanonicalMarketEvent(
            string symbolName,
            TimeFrame timeFrame,
            CanonicalEventType eventType,
            bool isBullish,
            CanonicalEventReason reason,
            CanonicalEventAction action,
            DateTime barTime,
            double priceRef,
            int score,
            int confidence)
        {
            var eventSuffix = eventType == CanonicalEventType.Choch
                ? "choch"
                : eventType == CanonicalEventType.Bos
                    ? "bos"
                    : eventType == CanonicalEventType.SweepReclaim
                        ? "sweep_reclaim"
                        : eventType == CanonicalEventType.Rejection
                            ? "rejection"
                            : eventType == CanonicalEventType.Breakout
                                ? "breakout"
                                : eventType == CanonicalEventType.Pullback
                                    ? "pullback"
                                    : eventType == CanonicalEventType.Continuation
                                        ? "continuation"
                                        : "impulse";

            return new CanonicalMarketEvent
            {
                EventKey = string.Format(
                    CultureInfo.InvariantCulture,
                    "{0}_{1}",
                    isBullish ? "bullish" : "bearish",
                    eventSuffix),
                SymbolName = string.IsNullOrWhiteSpace(symbolName) ? "" : symbolName.Trim().ToUpperInvariant(),
                TimeFrameLabel = GetMiniChartLabel(timeFrame),
                EventType = eventType,
                IsBullish = isBullish,
                Reason = reason,
                Action = action,
                BarTime = barTime,
                PriceRef = priceRef,
                Score = score,
                Confidence = confidence,
                SourceTimeFrame = timeFrame
            };
        }

        private CanonicalMarketEvent MapStructureEventToCanonical(string symbolName, StructureEvent evt)
        {
            return BuildCanonicalMarketEvent(
                symbolName,
                evt.SourceTimeFrame,
                evt.IsChoch ? CanonicalEventType.Choch : CanonicalEventType.Bos,
                evt.IsBullish,
                evt.IsChoch ? CanonicalEventReason.StructureReclaim : CanonicalEventReason.StructureBreak,
                evt.IsBullish ? CanonicalEventAction.Buy : CanonicalEventAction.Sell,
                evt.Time,
                evt.Price,
                evt.IsChoch ? 3 : 4,
                evt.IsChoch ? 72 : 80);
        }

        private List<ChartLevelCandidate> CollectTimeFrameStructuralLevelCandidates(Symbol symbol, Bars sourceBars, TimeFrame sourceTimeFrame)
        {
            var candidates = new List<ChartLevelCandidate>();
            if (symbol == null || sourceBars == null || sourceBars.Count < 5)
                return candidates;

            var tolerance = Math.Max(symbol.PipSize * 2.0, 0.0000001);

            int previousIndex;
            if (TryGetPreviousCompletedPeriodBarIndex(sourceBars, sourceTimeFrame, out previousIndex))
            {
                AddChartLevelCandidate(candidates, sourceBars.HighPrices[previousIndex], tolerance, 2);
                AddChartLevelCandidate(candidates, sourceBars.LowPrices[previousIndex], tolerance, 2);
            }

            var start = Math.Max(2, sourceBars.Count - 60);
            var resistance = double.MinValue;
            var support = double.MaxValue;
            for (var i = start; i < sourceBars.Count - 2; i++)
            {
                resistance = Math.Max(resistance, sourceBars.HighPrices[i]);
                support = Math.Min(support, sourceBars.LowPrices[i]);
            }

            if (resistance > double.MinValue)
                AddChartLevelCandidate(candidates, resistance, tolerance, 1);
            if (support < double.MaxValue)
                AddChartLevelCandidate(candidates, support, tolerance, 1);

            foreach (var swing in CollectConfirmedSwings(sourceBars, 120).TakeLast(10))
                AddChartLevelCandidate(candidates, swing.Price, tolerance, 2);

            var fvgLevels = new List<double>();
            AddFvgLevelCandidates(fvgLevels, sourceBars, tolerance);
            AddChartLevelCandidatesFromRaw(candidates, fvgLevels, tolerance, 1);

            var obLevels = new List<double>();
            AddOrderBlockLevelCandidates(obLevels, sourceBars, tolerance);
            AddChartLevelCandidatesFromRaw(candidates, obLevels, tolerance, 1);

            return candidates
                .Where(x => x.Price > 0 && x.Weight > 0)
                .OrderByDescending(x => x.Weight)
                .ThenBy(x => x.Price)
                .ToList();
        }

        private List<CanonicalMarketEvent> CollectCanonicalSweepReclaimEvents(string symbolName, Symbol symbol, Bars sourceBars, TimeFrame sourceTimeFrame, int lookbackBars)
        {
            var events = new List<CanonicalMarketEvent>();
            if (symbol == null || sourceBars == null || sourceBars.Count < 8)
                return events;

            var swings = CollectConfirmedSwings(sourceBars, lookbackBars);
            if (swings.Count < 2)
                return events;

            var candidates = swings
                .Take(Math.Max(0, swings.Count - 1))
                .Reverse()
                .Take(12)
                .ToList();
            if (candidates.Count == 0)
                return events;

            var startBar = Math.Max(2, sourceBars.Count - Math.Min(Math.Max(lookbackBars, 12), 36));
            for (var reclaimBarIndex = startBar; reclaimBarIndex < sourceBars.Count; reclaimBarIndex++)
            {
                foreach (var candidate in candidates)
                {
                    if (candidate.BarIndex >= reclaimBarIndex)
                        continue;

                    var candidateLevel = new SweepCandidate
                    {
                        Label = candidate.IsHigh ? "BSL" : "SSL",
                        Price = candidate.Price,
                        IsHigh = candidate.IsHigh,
                        Time = candidate.Time,
                        SourceTimeFrame = sourceTimeFrame,
                        Color = GetTimeFrameStructureColor(sourceTimeFrame)
                    };

                    SweepMatch match;
                    if (!TryMatchSweepPattern(sourceBars, reclaimBarIndex, candidateLevel, out match) || !match.IsValid)
                        continue;

                    var isBullish = !candidate.IsHigh;
                    events.Add(BuildCanonicalMarketEvent(
                        symbolName,
                        sourceTimeFrame,
                        CanonicalEventType.SweepReclaim,
                        isBullish,
                        CanonicalEventReason.LiquiditySweep,
                        isBullish ? CanonicalEventAction.Buy : CanonicalEventAction.Sell,
                        sourceBars.OpenTimes[Math.Max(0, match.ReclaimBarIndex)],
                        candidate.Price,
                        3,
                        76));
                }
            }

            return events;
        }

        private List<CanonicalMarketEvent> CollectCanonicalLevelReactionEvents(string symbolName, Symbol symbol, Bars sourceBars, TimeFrame sourceTimeFrame, int lookbackBars)
        {
            var events = new List<CanonicalMarketEvent>();
            if (symbol == null || sourceBars == null || sourceBars.Count < 5)
                return events;

            var candidates = CollectTimeFrameStructuralLevelCandidates(symbol, sourceBars, sourceTimeFrame);
            if (candidates.Count == 0)
                return events;

            var tolerance = Math.Max(symbol.PipSize * 2.0, 0.0000001);
            var startBar = Math.Max(2, sourceBars.Count - Math.Min(Math.Max(lookbackBars, 12), 40));

            for (var barIndex = startBar; barIndex < sourceBars.Count; barIndex++)
            {
                var openV = sourceBars.OpenPrices[barIndex];
                var highV = sourceBars.HighPrices[barIndex];
                var lowV = sourceBars.LowPrices[barIndex];
                var closeV = sourceBars.ClosePrices[barIndex];
                var prevClose = sourceBars.ClosePrices[barIndex - 1];
                var barTime = sourceBars.OpenTimes[barIndex];
                var span = Math.Max(highV - lowV, tolerance);
                var nearbyLevels = candidates
                    .OrderByDescending(x => x.Weight)
                    .ThenBy(x => Math.Abs(x.Price - closeV))
                    .Take(12)
                    .ToList();

                foreach (var level in nearbyLevels)
                {
                    var levelPrice = level.Price;

                    var bullishReject = lowV <= levelPrice + tolerance &&
                        closeV > levelPrice + (tolerance * 0.25) &&
                        (closeV - levelPrice) / span >= 0.35;
                    if (bullishReject)
                    {
                        events.Add(BuildCanonicalMarketEvent(
                            symbolName,
                            sourceTimeFrame,
                            CanonicalEventType.Rejection,
                            true,
                            CanonicalEventReason.KeyLevelRejection,
                            CanonicalEventAction.Buy,
                            barTime,
                            levelPrice,
                            2 + Math.Min(level.Weight, 2),
                            68 + Math.Min(level.Weight * 2, 8)));
                    }

                    var bearishReject = highV >= levelPrice - tolerance &&
                        closeV < levelPrice - (tolerance * 0.25) &&
                        (levelPrice - closeV) / span >= 0.35;
                    if (bearishReject)
                    {
                        events.Add(BuildCanonicalMarketEvent(
                            symbolName,
                            sourceTimeFrame,
                            CanonicalEventType.Rejection,
                            false,
                            CanonicalEventReason.KeyLevelRejection,
                            CanonicalEventAction.Sell,
                            barTime,
                            levelPrice,
                            2 + Math.Min(level.Weight, 2),
                            68 + Math.Min(level.Weight * 2, 8)));
                    }

                    var bullishBreakout = prevClose <= levelPrice + (tolerance * 0.25) &&
                        closeV > levelPrice + (tolerance * 0.25) &&
                        (closeV - levelPrice) / span >= 0.30 &&
                        closeV > openV;
                    if (bullishBreakout)
                    {
                        events.Add(BuildCanonicalMarketEvent(
                            symbolName,
                            sourceTimeFrame,
                            CanonicalEventType.Breakout,
                            true,
                            CanonicalEventReason.StructureBreak,
                            CanonicalEventAction.Buy,
                            barTime,
                            levelPrice,
                            3 + Math.Min(level.Weight, 2),
                            72 + Math.Min(level.Weight * 2, 8)));
                    }

                    var bearishBreakout = prevClose >= levelPrice - (tolerance * 0.25) &&
                        closeV < levelPrice - (tolerance * 0.25) &&
                        (levelPrice - closeV) / span >= 0.30 &&
                        closeV < openV;
                    if (bearishBreakout)
                    {
                        events.Add(BuildCanonicalMarketEvent(
                            symbolName,
                            sourceTimeFrame,
                            CanonicalEventType.Breakout,
                            false,
                            CanonicalEventReason.StructureBreak,
                            CanonicalEventAction.Sell,
                            barTime,
                            levelPrice,
                            3 + Math.Min(level.Weight, 2),
                            72 + Math.Min(level.Weight * 2, 8)));
                    }
                }
            }

            return events;
        }

        private double ComputeEmaAtIndex(Bars sourceBars, int period, int index)
        {
            if (sourceBars == null || period <= 0 || index < 0 || index >= sourceBars.Count)
                return double.NaN;

            var start = Math.Max(0, index - Math.Max(period * 4, period + 2));
            var ema = sourceBars.ClosePrices[start];
            var multiplier = 2.0 / (period + 1.0);
            for (var i = start + 1; i <= index; i++)
                ema += (sourceBars.ClosePrices[i] - ema) * multiplier;
            return ema;
        }

        private double ComputeRollingVwapAtIndex(Bars sourceBars, int length, int index)
        {
            if (sourceBars == null || length <= 0 || index < 0 || index >= sourceBars.Count)
                return double.NaN;

            var start = Math.Max(0, index - length + 1);
            double sumPv = 0.0;
            double sumV = 0.0;

            for (var i = start; i <= index; i++)
            {
                var typical = (sourceBars.HighPrices[i] + sourceBars.LowPrices[i] + sourceBars.ClosePrices[i]) / 3.0;
                var volume = 1.0;
                try
                {
                    var tickVolume = Convert.ToDouble(sourceBars.TickVolumes[i], CultureInfo.InvariantCulture);
                    if (!double.IsNaN(tickVolume) && tickVolume > 0)
                        volume = tickVolume;
                }
                catch
                {
                }

                sumPv += typical * volume;
                sumV += volume;
            }

            return sumV > 0 ? sumPv / sumV : double.NaN;
        }

        private double ComputeMedianRange(Bars sourceBars, int index, int lookback)
        {
            if (sourceBars == null || index < 0 || index >= sourceBars.Count || lookback <= 0)
                return 0;

            var start = Math.Max(0, index - lookback + 1);
            var ranges = new List<double>();
            for (var i = start; i <= index; i++)
            {
                var range = sourceBars.HighPrices[i] - sourceBars.LowPrices[i];
                if (!double.IsNaN(range) && range > 0)
                    ranges.Add(range);
            }

            if (ranges.Count == 0)
                return 0;

            ranges.Sort();
            var mid = ranges.Count / 2;
            return ranges.Count % 2 == 0
                ? (ranges[mid - 1] + ranges[mid]) * 0.5
                : ranges[mid];
        }

        private CanonicalMarketEvent? FindLatestDirectionalSeedEvent(List<CanonicalMarketEvent> seedEvents, DateTime barTime)
        {
            if (seedEvents == null || seedEvents.Count == 0)
                return null;

            foreach (var evt in seedEvents
                .Where(e =>
                    e.BarTime <= barTime &&
                    (e.EventType == CanonicalEventType.Choch ||
                     e.EventType == CanonicalEventType.Bos ||
                     e.EventType == CanonicalEventType.SweepReclaim ||
                     e.EventType == CanonicalEventType.Rejection ||
                     e.EventType == CanonicalEventType.Breakout))
                .OrderByDescending(e => e.BarTime)
                .ThenByDescending(e => e.Score))
            {
                return evt;
            }

            return null;
        }

        private bool HasDirectionalEventOnBar(List<CanonicalMarketEvent> events, DateTime barTime, bool isBullish, params CanonicalEventType[] types)
        {
            if (events == null || types == null || types.Length == 0)
                return false;

            return events.Any(e =>
                e.BarTime == barTime &&
                e.IsBullish == isBullish &&
                types.Contains(e.EventType));
        }

        private List<CanonicalMarketEvent> CollectCanonicalPhaseEvents(string symbolName, Symbol symbol, Bars sourceBars, TimeFrame sourceTimeFrame, List<CanonicalMarketEvent> seedEvents, int lookbackBars)
        {
            var events = new List<CanonicalMarketEvent>();
            if (symbol == null || sourceBars == null || sourceBars.Count < 25)
                return events;

            var tolerance = Math.Max(symbol.PipSize * 2.0, 0.0000001);
            var startBar = Math.Max(20, sourceBars.Count - Math.Min(Math.Max(lookbackBars, 20), 60));

            for (var barIndex = startBar; barIndex < sourceBars.Count; barIndex++)
            {
                var barTime = sourceBars.OpenTimes[barIndex];
                var latestSeed = FindLatestDirectionalSeedEvent(seedEvents, barTime);
                if (!latestSeed.HasValue)
                    continue;

                var seed = latestSeed.Value;
                var openV = sourceBars.OpenPrices[barIndex];
                var highV = sourceBars.HighPrices[barIndex];
                var lowV = sourceBars.LowPrices[barIndex];
                var closeV = sourceBars.ClosePrices[barIndex];
                var prevClose = sourceBars.ClosePrices[Math.Max(0, barIndex - 1)];
                var ema20 = ComputeEmaAtIndex(sourceBars, 20, barIndex);
                var ema20Prev = ComputeEmaAtIndex(sourceBars, 20, Math.Max(0, barIndex - 1));
                var vwap20 = ComputeRollingVwapAtIndex(sourceBars, 20, barIndex);
                var vwap20Prev = ComputeRollingVwapAtIndex(sourceBars, 20, Math.Max(0, barIndex - 1));
                var range = Math.Max(highV - lowV, tolerance);
                var body = Math.Abs(closeV - openV);
                var medianRange = ComputeMedianRange(sourceBars, barIndex, 8);
                var displacement = range > 0 && body / range >= 0.6 && medianRange > 0 && range >= medianRange * 1.1;
                var isBullishBias = seed.IsBullish;

                var bullishPullback = isBullishBias &&
                    !double.IsNaN(ema20) &&
                    !double.IsNaN(ema20Prev) &&
                    prevClose > ema20Prev &&
                    lowV <= ema20 + tolerance &&
                    closeV >= ema20;
                if (bullishPullback)
                {
                    events.Add(BuildCanonicalMarketEvent(
                        symbolName,
                        sourceTimeFrame,
                        CanonicalEventType.Pullback,
                        true,
                        CanonicalEventReason.EmaReclaim,
                        CanonicalEventAction.Wait,
                        barTime,
                        ema20,
                        2,
                        66));
                }

                var bearishPullback = !isBullishBias &&
                    !double.IsNaN(ema20) &&
                    !double.IsNaN(ema20Prev) &&
                    prevClose < ema20Prev &&
                    highV >= ema20 - tolerance &&
                    closeV <= ema20;
                if (bearishPullback)
                {
                    events.Add(BuildCanonicalMarketEvent(
                        symbolName,
                        sourceTimeFrame,
                        CanonicalEventType.Pullback,
                        false,
                        CanonicalEventReason.EmaReclaim,
                        CanonicalEventAction.Wait,
                        barTime,
                        ema20,
                        2,
                        66));
                }

                var bullishContinuation = isBullishBias &&
                    !double.IsNaN(ema20) &&
                    !double.IsNaN(vwap20) &&
                    !double.IsNaN(ema20Prev) &&
                    !double.IsNaN(vwap20Prev) &&
                    prevClose <= Math.Max(ema20Prev, vwap20Prev) + tolerance &&
                    closeV > ema20 &&
                    closeV > vwap20;
                if (bullishContinuation)
                {
                    events.Add(BuildCanonicalMarketEvent(
                        symbolName,
                        sourceTimeFrame,
                        CanonicalEventType.Continuation,
                        true,
                        CanonicalEventReason.VwapReclaim,
                        CanonicalEventAction.Buy,
                        barTime,
                        closeV,
                        3,
                        72));
                }

                var bearishContinuation = !isBullishBias &&
                    !double.IsNaN(ema20) &&
                    !double.IsNaN(vwap20) &&
                    !double.IsNaN(ema20Prev) &&
                    !double.IsNaN(vwap20Prev) &&
                    prevClose >= Math.Min(ema20Prev, vwap20Prev) - tolerance &&
                    closeV < ema20 &&
                    closeV < vwap20;
                if (bearishContinuation)
                {
                    events.Add(BuildCanonicalMarketEvent(
                        symbolName,
                        sourceTimeFrame,
                        CanonicalEventType.Continuation,
                        false,
                        CanonicalEventReason.VwapReclaim,
                        CanonicalEventAction.Sell,
                        barTime,
                        closeV,
                        3,
                        72));
                }

                var bullishImpulse = isBullishBias &&
                    displacement &&
                    HasDirectionalEventOnBar(seedEvents, barTime, true, CanonicalEventType.Bos, CanonicalEventType.Breakout);
                if (bullishImpulse)
                {
                    events.Add(BuildCanonicalMarketEvent(
                        symbolName,
                        sourceTimeFrame,
                        CanonicalEventType.Impulse,
                        true,
                        CanonicalEventReason.MomentumShift,
                        CanonicalEventAction.Buy,
                        barTime,
                        closeV,
                        4,
                        78));
                }

                var bearishImpulse = !isBullishBias &&
                    displacement &&
                    HasDirectionalEventOnBar(seedEvents, barTime, false, CanonicalEventType.Bos, CanonicalEventType.Breakout);
                if (bearishImpulse)
                {
                    events.Add(BuildCanonicalMarketEvent(
                        symbolName,
                        sourceTimeFrame,
                        CanonicalEventType.Impulse,
                        false,
                        CanonicalEventReason.MomentumShift,
                        CanonicalEventAction.Sell,
                        barTime,
                        closeV,
                        4,
                        78));
                }
            }

            return events;
        }

        private List<CanonicalMarketEvent> GetCanonicalEventsForSymbolTimeFrame(string symbolName, TimeFrame timeFrame, int maxEvents = 3)
        {
            var empty = new List<CanonicalMarketEvent>();
            if (string.IsNullOrWhiteSpace(symbolName))
                return empty;

            var normalizedSymbol = symbolName.Trim().ToUpperInvariant();
            var cacheKey = BuildDashboardEventCacheKey(normalizedSymbol, timeFrame);
            List<CanonicalMarketEvent> cached;
            if (_dashboardEventCache.TryGetValue(cacheKey, out cached) && cached != null && cached.Count > 0)
                return cached.Take(Math.Max(1, maxEvents)).ToList();

            try
            {
                var symbol = ResolveLoadedSymbol(normalizedSymbol);
                if (symbol == null)
                    return empty;

                var bars = MarketData.GetBars(timeFrame, normalizedSymbol);
                if (bars == null || bars.Count < 20)
                    return empty;

                var canonical = new List<CanonicalMarketEvent>();
                canonical.AddRange(
                    CollectStructureEvents(bars, timeFrame, 180)
                        .Select(evt => MapStructureEventToCanonical(normalizedSymbol, evt)));
                canonical.AddRange(CollectCanonicalSweepReclaimEvents(normalizedSymbol, symbol, bars, timeFrame, 180));
                canonical.AddRange(CollectCanonicalLevelReactionEvents(normalizedSymbol, symbol, bars, timeFrame, 180));
                canonical.AddRange(CollectCanonicalPhaseEvents(normalizedSymbol, symbol, bars, timeFrame, canonical.ToList(), 180));

                canonical = canonical
                    .OrderByDescending(evt => evt.BarTime)
                    .ThenByDescending(evt => evt.Score)
                    .ThenByDescending(evt => evt.PriceRef)
                    .GroupBy(evt => string.Format(
                        CultureInfo.InvariantCulture,
                        "{0}|{1}|{2}|{3}",
                        evt.EventKey,
                        evt.TimeFrameLabel,
                        evt.BarTime.Ticks,
                        Math.Round(evt.PriceRef, 6)))
                    .Select(group => group.First())
                    .ToList();

                _dashboardEventCache[cacheKey] = canonical;
                return canonical.Take(Math.Max(1, maxEvents)).ToList();
            }
            catch
            {
                return empty;
            }
        }

        private string FormatCanonicalEventReasonShort(CanonicalEventReason reason)
        {
            switch (reason)
            {
                case CanonicalEventReason.StructureReclaim:
                    return "recl";
                case CanonicalEventReason.StructureBreak:
                    return "brk";
                case CanonicalEventReason.LiquiditySweep:
                    return "liq";
                case CanonicalEventReason.KeyLevelRejection:
                    return "rej";
                case CanonicalEventReason.EmaReclaim:
                    return "ema";
                case CanonicalEventReason.VwapReclaim:
                    return "vwap";
                case CanonicalEventReason.BiasAlignment:
                    return "bias";
                case CanonicalEventReason.MomentumShift:
                    return "mom";
                default:
                    return "na";
            }
        }

        private string FormatDashboardEventCompact(CanonicalMarketEvent? evt)
        {
            if (!evt.HasValue)
                return "-";

            var value = evt.Value;
            var prefix = value.EventType == CanonicalEventType.Choch
                ? "CH"
                : value.EventType == CanonicalEventType.Bos
                    ? "BO"
                    : value.EventType == CanonicalEventType.SweepReclaim
                        ? "SW"
                        : value.EventType == CanonicalEventType.Rejection
                            ? "RJ"
                            : value.EventType == CanonicalEventType.Breakout
                                ? "BR"
                                : value.EventType == CanonicalEventType.Pullback
                                    ? "PB"
                                    : value.EventType == CanonicalEventType.Continuation
                                        ? "CT"
                                        : "IM";
            var dir = value.IsBullish ? "U" : "D";
            var action = value.Action == CanonicalEventAction.Buy ? "B" : value.Action == CanonicalEventAction.Sell ? "S" : value.Action == CanonicalEventAction.Wait ? "W" : "X";
            return string.Format(
                CultureInfo.InvariantCulture,
                "{0}{1} {2}/{3}",
                prefix,
                dir,
                action,
                FormatCanonicalEventReasonShort(value.Reason));
        }

        private Color GetCanonicalEventColor(CanonicalMarketEvent? evt)
        {
            if (!evt.HasValue)
                return Color.LightGray;
            return evt.Value.IsBullish ? Color.LimeGreen : Color.IndianRed;
        }

        private int DrawKeyLevelsOnChart(int objectIndex)
        {
            try
            {
                if (!ShouldShowLowerTimeframeSessionContext())
                    return objectIndex;

                objectIndex = DrawPreviousPeriodLevels(objectIndex, TimeFrame.Hour, "1H", GetTimeFrameStructureColor(TimeFrame.Hour));
                objectIndex = DrawPreviousPeriodLevels(objectIndex, TimeFrame.Hour4, "4H", GetTimeFrameStructureColor(TimeFrame.Hour4));
                objectIndex = DrawPreviousPeriodLevels(objectIndex, TimeFrame.Daily, "1D", GetTimeFrameStructureColor(TimeFrame.Daily));
            }
            catch (Exception ex)
            {
                SafePrint("[Visuals] Key levels failed: {0}", ex.Message);
            }

            return objectIndex;
        }

        private bool ShouldShowLowerTimeframeSessionContext()
        {
            var chartTimeFrame = Chart != null ? Chart.TimeFrame : TimeFrame.Minute;
            var chartTfMinutes = TimeFrameToMinutes(chartTimeFrame);
            return chartTfMinutes > 0 && chartTfMinutes <= 15;
        }

        private int DrawPreviousSessionLevels(int objectIndex)
        {
            var prevDate = GetReferenceNow().Date.AddDays(-1);
            objectIndex = DrawSessionHighLow(objectIndex, "London", prevDate, Color.FromArgb(160, 60, 179, 113));
            objectIndex = DrawSessionHighLow(objectIndex, "NY", prevDate, Color.FromArgb(180, 255, 215, 0));
            objectIndex = DrawSessionHighLow(objectIndex, "Asia", prevDate, Color.FromArgb(150, 70, 130, 180));
            return objectIndex;
        }

        private int DrawSessionHighLow(int objectIndex, string label, DateTime date, Color color)
        {
            DateTime startUtc;
            DateTime endUtc;
            if (!TryGetSessionUtcRange(label, date, out startUtc, out endUtc))
                return objectIndex;

            double high;
            double low;
            DateTime highTime;
            DateTime lowTime;
            if (!TryGetRangeHighLow(Bars, startUtc, endUtc, out high, out low, out highTime, out lowTime))
                return objectIndex;

            objectIndex = DrawHorizontalGuide(objectIndex, label, highTime, high, color, true);
            objectIndex = DrawHorizontalGuide(objectIndex, label, lowTime, low, color, false);
            return objectIndex;
        }

        private int DrawPreviousPeriodLevels(int objectIndex, TimeFrame timeFrame, string labelPrefix, Color color)
        {
            try
            {
                var sourceBars = MarketData.GetBars(timeFrame, Chart.SymbolName);
                if (sourceBars == null || sourceBars.Count < 1)
                    return objectIndex;

                int idx;
                if (!TryGetPreviousCompletedPeriodBarIndex(sourceBars, timeFrame, out idx))
                    return objectIndex;
                objectIndex = DrawHorizontalGuide(objectIndex, labelPrefix, sourceBars.OpenTimes[idx], sourceBars.HighPrices[idx], color, true);
                objectIndex = DrawHorizontalGuide(objectIndex, labelPrefix, sourceBars.OpenTimes[idx], sourceBars.LowPrices[idx], color, false);
            }
            catch
            {
            }
            return objectIndex;
        }

        private int DrawSwingAndSrLevels(int objectIndex)
        {
            var resistance = double.MinValue;
            var support = double.MaxValue;
            var recentHigh = double.MinValue;
            var recentLow = double.MaxValue;
            var resistanceTime = DateTime.MinValue;
            var supportTime = DateTime.MinValue;
            var recentHighTime = DateTime.MinValue;
            var recentLowTime = DateTime.MinValue;

            var start = Math.Max(2, Bars.Count - 60);
            for (var i = start; i < Bars.Count - 2; i++)
            {
                var high = Bars.HighPrices[i];
                var low = Bars.LowPrices[i];
                if (high > resistance)
                {
                    resistance = high;
                    resistanceTime = Bars.OpenTimes[i];
                }
                if (low < support)
                {
                    support = low;
                    supportTime = Bars.OpenTimes[i];
                }

                if (Bars.HighPrices[i] > Bars.HighPrices[i - 1] && Bars.HighPrices[i] > Bars.HighPrices[i - 2] &&
                    Bars.HighPrices[i] > Bars.HighPrices[i + 1] && Bars.HighPrices[i] > Bars.HighPrices[i + 2])
                {
                    recentHigh = high;
                    recentHighTime = Bars.OpenTimes[i];
                }
                if (Bars.LowPrices[i] < Bars.LowPrices[i - 1] && Bars.LowPrices[i] < Bars.LowPrices[i - 2] &&
                    Bars.LowPrices[i] < Bars.LowPrices[i + 1] && Bars.LowPrices[i] < Bars.LowPrices[i + 2])
                {
                    recentLow = low;
                    recentLowTime = Bars.OpenTimes[i];
                }
            }

            if (recentHigh > double.MinValue)
                objectIndex = DrawHorizontalGuide(objectIndex, "SWH", recentHighTime, recentHigh, Color.LightGray);
            if (recentLow < double.MaxValue)
                objectIndex = DrawHorizontalGuide(objectIndex, "SWL", recentLowTime, recentLow, Color.LightGray);
            if (resistance > double.MinValue)
                objectIndex = DrawHorizontalGuide(objectIndex, "RES", resistanceTime, resistance, Color.IndianRed);
            if (support < double.MaxValue)
                objectIndex = DrawHorizontalGuide(objectIndex, "SUP", supportTime, support, Color.PaleGreen);

            return objectIndex;
        }

        private struct SweepCandidate
        {
            public string Label;
            public double Price;
            public bool IsHigh;
            public DateTime Time;
            public TimeFrame SourceTimeFrame;
            public Color Color;
        }

        private struct SweepMatch
        {
            public bool IsValid;
            public int SweepBarIndex;
            public int ReclaimBarIndex;
        }

        private struct LiquidityLevel
        {
            public string Label;
            public double Price;
            public bool IsHigh;
            public DateTime Time;
            public Color Color;
            public TimeFrame SourceTimeFrame;
        }

        private struct SwingPoint
        {
            public int BarIndex;
            public DateTime Time;
            public double Price;
            public bool IsHigh;
        }

        private enum StructureBias
        {
            Neutral,
            Bullish,
            Bearish
        }

        private struct StructureEvent
        {
            public string Label;
            public int BarIndex;
            public DateTime Time;
            public double Price;
            public bool IsBullish;
            public bool IsChoch;
            public TimeFrame SourceTimeFrame;
        }

        private enum CanonicalEventType
        {
            Choch,
            Bos,
            SweepReclaim,
            Rejection,
            Breakout,
            Pullback,
            Continuation,
            Impulse
        }

        private enum CanonicalEventReason
        {
            StructureReclaim,
            StructureBreak,
            LiquiditySweep,
            KeyLevelRejection,
            EmaReclaim,
            VwapReclaim,
            BiasAlignment,
            MomentumShift
        }

        private enum CanonicalEventAction
        {
            Buy,
            Sell,
            Wait,
            Skip
        }

        private struct CanonicalMarketEvent
        {
            public string EventKey;
            public string SymbolName;
            public string TimeFrameLabel;
            public CanonicalEventType EventType;
            public bool IsBullish;
            public CanonicalEventReason Reason;
            public CanonicalEventAction Action;
            public DateTime BarTime;
            public double PriceRef;
            public int Score;
            public int Confidence;
            public TimeFrame SourceTimeFrame;
        }

        private struct ChartEntryCandidate
        {
            public string Label;
            public double Low;
            public double High;
            public double Entry;
            public DateTime Time;
        }

        private struct ChartLevelCandidate
        {
            public double Price;
            public int Weight;
        }

        private struct ChartTradePlan
        {
            public bool IsValid;
            public string EntryLabel;
            public string StructureTfLabel;
            public double Entry;
            public double StopLoss;
            public double TakeProfit;
            public double RewardRisk;
        }

        private struct StrategyPositionSnapshot
        {
            public long PositionId;
            public string SymbolName;
            public TradeType TradeType;
            public double EntryPrice;
            public DateTime EntryTime;
            public string Label;
            public string Comment;
        }

        private enum StrategyMarkerKind
        {
            Entry,
            Exit
        }

        private struct StrategyChartMarker
        {
            public long PositionId;
            public string SymbolName;
            public TradeType TradeType;
            public StrategyMarkerKind Kind;
            public DateTime Time;
            public double Price;
            public double Pnl;
            public bool IsWinning;
            public string Text;
        }

        private sealed class DirectionalPatternMarkerAggregate
        {
            public Bars SourceBars;
            public TimeFrame SourceTimeFrame;
            public int BarIndex;
            public bool IsBullish;
            public int SlotIndex;
            public List<string> Labels = new List<string>();
        }

        private sealed class SharedIndicatorSnapshot
        {
            public double Ema9;
            public double Ema20;
            public double Ema21;
            public double Ema50;
            public double Ema55;
            public double Ema200;
            public double Sma20;
            public double Sma50;
            public double Sma200;
            public double Vwap20;
            public double BbMid;
            public double BbUpper;
            public double BbLower;
            public double Rsi14;
            public double StochK;
            public double StochD;
            public double MacdLine;
            public double MacdSignal;
            public double MacdHistogram;
            public double Roc12;
        }

        private int FindBarIndexForMarkerTime(DateTime time)
        {
            if (Bars == null || Bars.Count == 0 || time == DateTime.MinValue)
                return -1;

            for (var i = Bars.Count - 1; i >= 0; i--)
            {
                if (Bars.OpenTimes[i] <= time)
                    return i;
            }

            return -1;
        }

        private double ResolveStrategyMarkerAnchorPrice(StrategyChartMarker marker)
        {
            var pad = Math.Max(Symbol.PipSize * 2.0, 0.0000001);
            var barIndex = FindBarIndexForMarkerTime(marker.Time);
            if (Bars != null && barIndex >= 0 && barIndex < Bars.Count)
            {
                return marker.TradeType == TradeType.Buy
                    ? Bars.LowPrices[barIndex] - pad
                    : Bars.HighPrices[barIndex] + pad;
            }

            return marker.TradeType == TradeType.Buy
                ? marker.Price - pad
                : marker.Price + pad;
        }

        private struct BacktestStrategySignal
        {
            public bool IsValid;
            public string StrategyId;
            public BacktestStrategyMode StrategyMode;
            public string SymbolName;
            public string SourceLabel;
            public TradeType TradeType;
            public TimeFrame SourceTimeFrame;
            public DateTime SignalTime;
            public bool UseLimitOrder;
            public double EntryPrice;
            public double StopLoss;
            public double TakeProfit;
            public string Note;
        }

        private struct BacktestExportTradeSnapshot
        {
            public string StrategyId;
            public TradeType TradeType;
            public DateTime SignalTime;
            public double EntryPrice;
            public double StopLoss;
            public double TakeProfit;
            public double RiskAmount;
            public double RiskPercent;
            public double RewardRisk;
            public double VolumeInUnits;
            public double VolumeLots;
        }

        private int DrawLiquidityLevelsOnChart(int objectIndex)
        {
            if (Bars == null || Bars.Count < 12)
                return objectIndex;

            try
            {
                var levels = CollectLiquidityLevels();
                if (levels.Count == 0)
                    return objectIndex;

                var currentEndTime = GetCurrentChartEndTime();
                var maxLevels = Math.Min(10, levels.Count);
                var labeled = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var level in levels
                    .OrderByDescending(x => x.Time)
                    .Take(maxLevels))
                {
                    var line = Chart.DrawTrendLine("LIQ_" + objectIndex.ToString(CultureInfo.InvariantCulture), level.Time, level.Price, currentEndTime, level.Price, WithAlpha(level.Color, 80));
                    TrySetPropertyValue(line, "Thickness", 1);
                    TrySetEnumPropertyValue(line, "LineStyle", "DotsRare");

                    if (ShouldDrawLiquidityLabel(level) && labeled.Add(level.Label))
                    {
                        var yPad = Math.Max(Symbol.PipSize * 10.0, 0.0000001);
                        var textY = level.IsHigh ? level.Price + yPad : level.Price - yPad;
                        var text = Chart.DrawText("LIQ_TXT_" + objectIndex.ToString(CultureInfo.InvariantCulture), level.Label, level.Time, textY, level.Color);
                        TryStyleChartText(text, GetChartMarkerFontSize(), "Courier New", false);
                    }
                    objectIndex++;
                }
            }
            catch (Exception ex)
            {
                SafePrint("[Visuals] Liquidity levels failed: {0}", ex.Message);
            }

            return objectIndex;
        }

        private bool ShouldDrawLiquidityLabel(LiquidityLevel level)
        {
            if (string.IsNullOrWhiteSpace(level.Label))
                return false;

            if (_toggleKeyLevels)
            {
                var label = level.Label.Trim();
                if (label.Equals("London", StringComparison.OrdinalIgnoreCase) ||
                    label.Equals("NY", StringComparison.OrdinalIgnoreCase) ||
                    label.Equals("Asia", StringComparison.OrdinalIgnoreCase) ||
                    label.Equals("4H", StringComparison.OrdinalIgnoreCase) ||
                    label.Equals("1D", StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }
            }

            return true;
        }

        private int DrawStrategyMarkersOnChart(int objectIndex)
        {
            if (!ShouldDrawChartMarkers() || Chart == null || Bars == null || _strategyChartMarkers.Count == 0)
                return objectIndex;

            var chartSymbolName = Chart.SymbolName ?? "";
            var chartStartTime = Bars.OpenTimes[0];
            var chartEndTime = GetCurrentChartEndTime();
            var visibleMarkers = _strategyChartMarkers
                .Where(marker => string.Equals(marker.SymbolName, chartSymbolName, StringComparison.OrdinalIgnoreCase))
                .Where(marker => marker.Time >= chartStartTime.AddDays(-2) && marker.Time <= chartEndTime.AddMinutes(5))
                .OrderBy(marker => marker.Time)
                .TakeLast(80)
                .ToList();

            foreach (var marker in visibleMarkers)
            {
                var isEntry = marker.Kind == StrategyMarkerKind.Entry;
                var iconColor = isEntry
                    ? (marker.TradeType == TradeType.Buy ? Color.LimeGreen : Color.OrangeRed)
                    : (marker.IsWinning ? Color.LimeGreen : Color.OrangeRed);
                var iconType = marker.TradeType == TradeType.Buy ? ChartIconType.UpArrow : ChartIconType.DownArrow;
                var anchorPrice = ResolveStrategyMarkerAnchorPrice(marker);
                var textY = marker.TradeType == TradeType.Buy
                    ? anchorPrice - Math.Max(Symbol.PipSize * 6.0, 0.0000001)
                    : anchorPrice + Math.Max(Symbol.PipSize * 6.0, 0.0000001);

                var icon = Chart.DrawIcon(
                    "STRAT_" + objectIndex.ToString(CultureInfo.InvariantCulture),
                    iconType,
                    marker.Time,
                    anchorPrice,
                    iconColor);
                TrySetPropertyValue(icon, "Thickness", 1);

                var text = Chart.DrawText(
                    "STRAT_TXT_" + objectIndex.ToString(CultureInfo.InvariantCulture),
                    marker.Text ?? (isEntry ? "ST IN" : "ST OUT"),
                    marker.Time,
                    textY,
                    iconColor);
                TryStyleChartText(text, GetChartMarkerFontSize(), "Courier New", true);
                objectIndex++;
            }

            return objectIndex;
        }

        private int DrawSweepDetectionsOnChart(int objectIndex)
        {
            if (!ShouldDrawChartMarkers() || Bars == null || Bars.Count < 12)
                return objectIndex;

            try
            {
                var candidates = CollectSweepCandidates();
                if (candidates.Count == 0)
                    return objectIndex;

                var bullishColor = Color.FromArgb(190, 0x26, 0xA6, 0x9A);
                var bearishColor = Color.FromArgb(190, 0xEF, 0x53, 0x50);
                var currentEndTime = GetCurrentChartEndTime();
                var shownBull = 0;
                var shownBear = 0;
                const int maxPerSide = 3;

                for (var barIndex = Bars.Count - 1; barIndex >= Math.Max(5, Bars.Count - 48); barIndex--)
                {
                    foreach (var candidate in candidates)
                    {
                        if (Bars.OpenTimes[barIndex] <= candidate.Time)
                            continue;

                        SweepMatch match;
                        if (!TryMatchSweepPattern(barIndex, candidate, out match))
                            continue;

                        var isBullishSweep = !candidate.IsHigh;
                        if (isBullishSweep && shownBull >= maxPerSide)
                            continue;
                        if (!isBullishSweep && shownBear >= maxPerSide)
                            continue;

                        if (!IsHigherTimeframeEnabled(candidate.SourceTimeFrame))
                            continue;

                        var color = candidate.Color;
                        var anchorBarIndex = match.ReclaimBarIndex >= 0 ? match.ReclaimBarIndex : barIndex;
                        var pad = Math.Max(Symbol.PipSize * 8.0, (Bars.HighPrices[anchorBarIndex] - Bars.LowPrices[anchorBarIndex]) * 0.12);
                        var textY = isBullishSweep ? candidate.Price - pad : candidate.Price + pad;
                        var line = Chart.DrawTrendLine("SWEEP_" + objectIndex.ToString(CultureInfo.InvariantCulture), Bars.OpenTimes[anchorBarIndex], candidate.Price, currentEndTime, candidate.Price, WithAlpha(color, 70));
                        TrySetPropertyValue(line, "LineStyle", LineStyle.DotsRare);
                        TrySetPropertyValue(line, "Thickness", 1);
                        var text = Chart.DrawText("SWEEP_TXT_" + objectIndex.ToString(CultureInfo.InvariantCulture), FormatDirectionalMarkerText("swp", isBullishSweep), Bars.OpenTimes[anchorBarIndex], textY, color);
                        TryStyleChartText(text, GetChartMarkerFontSize(), "Courier New", true);
                        objectIndex++;

                        if (isBullishSweep)
                            shownBull++;
                        else
                            shownBear++;
                    }

                    if (shownBull >= maxPerSide && shownBear >= maxPerSide)
                        break;
                }
            }
            catch (Exception ex)
            {
                SafePrint("[Visuals] Sweep detection failed: {0}", ex.Message);
            }

            return objectIndex;
        }

        private List<SweepCandidate> CollectSweepCandidates()
        {
            return CollectLiquidityLevels()
                .Select(level => new SweepCandidate
                {
                    Label = level.Label,
                    Price = level.Price,
                    IsHigh = level.IsHigh,
                    Time = level.Time,
                    SourceTimeFrame = level.SourceTimeFrame,
                    Color = level.Color
                })
                .ToList();
        }

        private List<LiquidityLevel> CollectLiquidityLevels()
        {
            var levels = new List<LiquidityLevel>();
            var prevDate = GetReferenceNow().Date.AddDays(-1);

            AddSessionLiquidityLevels(levels, "London", prevDate, Color.FromArgb(255, 0x3C, 0xB3, 0x71));
            AddSessionLiquidityLevels(levels, "NY", prevDate, Color.FromArgb(255, 0xFF, 0xD7, 0x00));
            AddSessionLiquidityLevels(levels, "Asia", prevDate, Color.FromArgb(255, 0x46, 0x82, 0xB4));

            AddPreviousPeriodLiquidityLevels(levels, "4H", TimeFrame.Hour4, GetTimeFrameStructureColor(TimeFrame.Hour4));
            AddPreviousPeriodLiquidityLevels(levels, "1D", TimeFrame.Daily, GetTimeFrameStructureColor(TimeFrame.Daily));
            AddRecentSwingLiquidityLevels(levels);
            return levels;
        }

        private void AddSessionLiquidityLevels(List<LiquidityLevel> levels, string label, DateTime date, Color color)
        {
            DateTime startUtc;
            DateTime endUtc;
            if (!TryGetSessionUtcRange(label, date, out startUtc, out endUtc))
                return;

            double high;
            double low;
            DateTime highTime;
            DateTime lowTime;
            if (!TryGetRangeHighLow(Bars, startUtc, endUtc, out high, out low, out highTime, out lowTime))
                return;

            AddLiquidityLevel(levels, label, high, true, highTime, color, Chart != null ? Chart.TimeFrame : TimeFrame.Minute);
            AddLiquidityLevel(levels, label, low, false, lowTime, color, Chart != null ? Chart.TimeFrame : TimeFrame.Minute);
        }

        private void AddPreviousPeriodLiquidityLevels(List<LiquidityLevel> levels, string label, TimeFrame timeFrame, Color color)
        {
            try
            {
                var sourceBars = MarketData.GetBars(timeFrame, Chart.SymbolName);
                if (sourceBars == null || sourceBars.Count < 1)
                    return;

                int idx;
                if (!TryGetPreviousCompletedPeriodBarIndex(sourceBars, timeFrame, out idx))
                    return;
                AddLiquidityLevel(levels, label, sourceBars.HighPrices[idx], true, sourceBars.OpenTimes[idx], color, timeFrame);
                AddLiquidityLevel(levels, label, sourceBars.LowPrices[idx], false, sourceBars.OpenTimes[idx], color, timeFrame);
            }
            catch
            {
            }
        }

        private bool TryGetPreviousCompletedPeriodBarIndex(Bars sourceBars, TimeFrame timeFrame, out int index)
        {
            index = -1;
            if (sourceBars == null || sourceBars.Count == 0)
                return false;

            var currentPeriodStart = GetPeriodStartTime(Server.Time, timeFrame);
            for (var i = sourceBars.Count - 1; i >= 0; i--)
            {
                if (sourceBars.OpenTimes[i] < currentPeriodStart)
                {
                    index = i;
                    return true;
                }
            }

            return false;
        }

        private DateTime GetPeriodStartTime(DateTime time, TimeFrame timeFrame)
        {
            var minutes = TimeFrameToMinutes(timeFrame);
            if (minutes >= 1440)
                return time.Date;
            if (minutes > 0)
            {
                var totalMinutes = (int)(time.TimeOfDay.TotalMinutes / minutes) * minutes;
                return time.Date.AddMinutes(totalMinutes);
            }

            return time;
        }

        private void AddRecentSwingLiquidityLevels(List<LiquidityLevel> levels)
        {
            foreach (var swing in CollectConfirmedSwings(120).TakeLast(8))
            {
                AddLiquidityLevel(levels, swing.IsHigh ? "BSL" : "SSL", swing.Price, swing.IsHigh, swing.Time, GetTimeFrameStructureColor(Chart != null ? Chart.TimeFrame : TimeFrame.Minute), Chart != null ? Chart.TimeFrame : TimeFrame.Minute);
            }
        }

        private void AddLiquidityLevel(List<LiquidityLevel> levels, string label, double price, bool isHigh, DateTime time, Color color, TimeFrame sourceTimeFrame)
        {
            if (price <= 0 || time == DateTime.MinValue)
                return;

            var tolerance = Math.Max(Symbol.PipSize * 2.0, 0.0000001);
            if (levels.Any(level => level.IsHigh == isHigh && Math.Abs(level.Price - price) <= tolerance))
                return;

            levels.Add(new LiquidityLevel
            {
                Label = label ?? "",
                Price = price,
                IsHigh = isHigh,
                Time = time,
                Color = color,
                SourceTimeFrame = sourceTimeFrame
            });
        }

        private List<SwingPoint> CollectConfirmedSwings(int lookbackBars)
        {
            var swings = new List<SwingPoint>();
            if (Bars == null || Bars.Count < 5)
                return swings;

            var start = Math.Max(2, Bars.Count - Math.Max(lookbackBars, 10));
            for (var i = start; i < Bars.Count - 2; i++)
            {
                var isHigh = Bars.HighPrices[i] > Bars.HighPrices[i - 1] && Bars.HighPrices[i] > Bars.HighPrices[i - 2] &&
                             Bars.HighPrices[i] > Bars.HighPrices[i + 1] && Bars.HighPrices[i] > Bars.HighPrices[i + 2];
                if (isHigh)
                {
                    swings.Add(new SwingPoint
                    {
                        BarIndex = i,
                        Time = Bars.OpenTimes[i],
                        Price = Bars.HighPrices[i],
                        IsHigh = true
                    });
                }

                var isLow = Bars.LowPrices[i] < Bars.LowPrices[i - 1] && Bars.LowPrices[i] < Bars.LowPrices[i - 2] &&
                            Bars.LowPrices[i] < Bars.LowPrices[i + 1] && Bars.LowPrices[i] < Bars.LowPrices[i + 2];
                if (isLow)
                {
                    swings.Add(new SwingPoint
                    {
                        BarIndex = i,
                        Time = Bars.OpenTimes[i],
                        Price = Bars.LowPrices[i],
                        IsHigh = false
                    });
                }
            }

            return swings.OrderBy(swing => swing.BarIndex).ToList();
        }

        private int DrawStructureBreakDetectionsOnChart(int objectIndex, bool drawChoch)
        {
            if (!ShouldDrawChartMarkers() || Bars == null || Bars.Count < 20)
                return objectIndex;

            try
            {
                var latestEvent = CollectStructureEvents()
                    .Where(evt => evt.IsChoch == drawChoch)
                    .LastOrDefault();
                if (latestEvent.Time == DateTime.MinValue)
                    return objectIndex;

                var evt = latestEvent;
                if (!IsHigherTimeframeEnabled(evt.SourceTimeFrame))
                    return objectIndex;

                var baseColor = GetTimeFrameStructureColor(evt.SourceTimeFrame);
                var color = evt.IsChoch ? WithAlpha(baseColor, 230) : baseColor;
                var prefix = evt.IsChoch ? "CHOCH_" : "BOS_";
                var textPrefix = evt.IsChoch ? "CHOCH_TXT_" : "BOS_TXT_";
                var line = Chart.DrawTrendLine(prefix + objectIndex.ToString(CultureInfo.InvariantCulture), evt.Time, evt.Price, GetCurrentChartEndTime(), evt.Price, WithAlpha(color, 88));
                TrySetPropertyValue(line, "Thickness", evt.IsChoch ? 2 : 1);
                TrySetEnumPropertyValue(line, "LineStyle", evt.IsChoch ? "DotsRare" : "Lines");

                var yPad = Math.Max(Symbol.PipSize * 12.0, 0.0000001);
                var textY = evt.IsBullish ? evt.Price + yPad : evt.Price - yPad;
                var text = Chart.DrawText(textPrefix + objectIndex.ToString(CultureInfo.InvariantCulture), FormatDirectionalMarkerText(evt.Label, evt.IsBullish), evt.Time, textY, color);
                TryStyleChartText(text, ResolveChartMarkerFontSize(evt.SourceTimeFrame), "Courier New", true);
                objectIndex++;
            }
            catch (Exception ex)
            {
                SafePrint("[Visuals] Structure break failed: {0}", ex.Message);
            }

            return objectIndex;
        }

        private int DrawCanonicalEventsOnChart(int objectIndex, CanonicalEventType eventType)
        {
            if (!ShouldDrawChartMarkers() || Chart == null || Bars == null || Bars.Count < 20 || Symbol == null)
                return objectIndex;

            try
            {
                var symbolName = Chart != null && !string.IsNullOrWhiteSpace(Chart.SymbolName)
                    ? Chart.SymbolName
                    : Symbol.Name;
                var chartTfMinutes = TimeFrameToMinutes(Chart.TimeFrame);
                var overlayFrames = new List<TimeFrame> { Chart.TimeFrame };
                overlayFrames.AddRange(GetEnabledAutoHigherTimeframes(Chart.TimeFrame)
                    .Where(tf => TimeFrameToMinutes(tf) > chartTfMinutes));

                var uniqueFrames = overlayFrames
                    .Distinct()
                    .OrderBy(tf => TimeFrameToMinutes(tf))
                    .ToList();
                if (uniqueFrames.Count == 0)
                    return objectIndex;

                string prefix;
                string shortLabel;
                switch (eventType)
                {
                    case CanonicalEventType.Rejection:
                        prefix = "RJ";
                        shortLabel = "RJ";
                        break;
                    case CanonicalEventType.Breakout:
                        prefix = "BR";
                        shortLabel = "BR";
                        break;
                    case CanonicalEventType.Pullback:
                        prefix = "PB";
                        shortLabel = "PB";
                        break;
                    case CanonicalEventType.Continuation:
                        prefix = "CT";
                        shortLabel = "CT";
                        break;
                    case CanonicalEventType.Impulse:
                        prefix = "IM";
                        shortLabel = "IM";
                        break;
                    default:
                        return objectIndex;
                }

                for (var frameIndex = 0; frameIndex < uniqueFrames.Count; frameIndex++)
                {
                    var sourceTimeFrame = uniqueFrames[frameIndex];
                    var latestEvent = GetCanonicalEventsForSymbolTimeFrame(symbolName, sourceTimeFrame, 24)
                        .Where(evt => evt.EventType == eventType)
                        .OrderByDescending(evt => evt.BarTime)
                        .ThenByDescending(evt => evt.Score)
                        .FirstOrDefault();
                    if (latestEvent.BarTime == DateTime.MinValue)
                        continue;

                    var evt = latestEvent;
                    var baseColor = GetTimeFrameStructureColor(sourceTimeFrame);
                    var yPad = Math.Max(Symbol.PipSize * (14.0 + (frameIndex * 8.0)), 0.0000001);
                    var anchorPrice = evt.IsBullish ? evt.PriceRef - yPad : evt.PriceRef + yPad;
                    var textY = evt.IsBullish ? anchorPrice - Math.Max(Symbol.PipSize * 10.0, 0.0000001) : anchorPrice + Math.Max(Symbol.PipSize * 10.0, 0.0000001);
                    var text = Chart.DrawText(
                        prefix + "_TXT_" + GetMiniChartLabel(sourceTimeFrame) + "_" + objectIndex.ToString(CultureInfo.InvariantCulture),
                        FormatDirectionalMarkerText(shortLabel, evt.IsBullish),
                        evt.BarTime,
                        textY,
                        baseColor);
                    TryStyleChartText(text, ResolveChartMarkerFontSize(sourceTimeFrame), "Courier New", true);
                    objectIndex++;
                }
            }
            catch (Exception ex)
            {
                SafePrint("[Visuals] Canonical event draw failed ({0}): {1}", eventType, ex.Message);
            }

            return objectIndex;
        }

        private int DrawDirectionalCandlePatternsOnChart(int objectIndex)
        {
            if (!ShouldDrawChartMarkers() || Chart == null || Bars == null || Bars.Count < 8 || Symbol == null)
                return objectIndex;

            try
            {
                var chartTf = Chart != null ? Chart.TimeFrame : TimeFrame.Minute;
                var chartTfMinutes = Math.Max(1, TimeFrameToMinutes(chartTf));
                var overlayFrames = new List<TimeFrame> { chartTf };
                overlayFrames.AddRange(GetEnabledAutoHigherTimeframes(chartTf)
                    .Where(tf => TimeFrameToMinutes(tf) > chartTfMinutes));

                var uniqueFrames = overlayFrames
                    .Distinct()
                    .OrderBy(tf => TimeFrameToMinutes(tf))
                    .ToList();

                var aggregatedMarkers = new List<DirectionalPatternMarkerAggregate>();
                var slotIndex = 0;
                foreach (var sourceTimeFrame in uniqueFrames)
                {
                    Bars sourceBars = sourceTimeFrame == chartTf ? Bars : null;
                    if (sourceBars == null)
                    {
                        try
                        {
                            sourceBars = MarketData.GetBars(sourceTimeFrame, Chart.SymbolName);
                        }
                        catch
                        {
                            sourceBars = null;
                        }
                    }

                    if (sourceBars == null || sourceBars.Count < 8)
                        continue;

                    if (_togglePinBarPatterns)
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "PIN", MatchBullishPinBar, MatchBearishPinBar, slotIndex++);
                    if (_toggleEngulfingPatterns)
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "ENG", MatchBullishEngulfingAtIndex, MatchBearishEngulfingAtIndex, slotIndex++);
                    if (_toggleBigCandlePatterns)
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "BIG", MatchBullishBigCandle, MatchBearishBigCandle, slotIndex++);
                    if (_toggleMorningStarPatterns)
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "MOR", MatchBullishMorningStar, MatchNever, slotIndex++);
                    if (_toggleEveningStarPatterns)
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "EVE", MatchNever, MatchBearishEveningStar, slotIndex++);
                    if (_toggleHammerPatterns)
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "HAM", MatchBullishHammer, MatchNever, slotIndex++);
                    if (_toggleHangingManPatterns)
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "HGM", MatchNever, MatchBearishHangingMan, slotIndex++);
                    if (_toggleShootingStarPatterns)
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "SST", MatchNever, MatchBearishShootingStar, slotIndex++);
                    if (_toggleInvertedHammerPatterns)
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "IHM", MatchBullishInvertedHammer, MatchNever, slotIndex++);
                    if (_togglePiercingLinePatterns)
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "PRC", MatchBullishPiercingLine, MatchNever, slotIndex++);
                    if (_toggleDarkCloudCoverPatterns)
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "DCC", MatchNever, MatchBearishDarkCloudCover, slotIndex++);
                    if (_toggleThreeWhiteSoldiersPatterns)
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "3WS", MatchBullishThreeWhiteSoldiers, MatchNever, slotIndex++);
                    if (_toggleThreeBlackCrowsPatterns)
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "3BC", MatchNever, MatchBearishThreeBlackCrows, slotIndex++);
                    if (_toggleHaramiPatterns)
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "HAR", MatchBullishHarami, MatchBearishHarami, slotIndex++);
                }

                foreach (var marker in aggregatedMarkers
                    .OrderBy(item => TimeFrameToMinutes(item.SourceTimeFrame))
                    .ThenBy(item => item.BarIndex)
                    .ThenBy(item => item.IsBullish ? 0 : 1))
                {
                    objectIndex = DrawDirectionalPatternMarker(
                        objectIndex,
                        marker.SourceBars,
                        marker.SourceTimeFrame,
                        marker.BarIndex,
                        marker.IsBullish,
                        marker.SlotIndex,
                        string.Join(", ", marker.Labels));
                }
            }
            catch (Exception ex)
            {
                SafePrint("[Visuals] Candle patterns failed: {0}", ex.Message);
            }

            return objectIndex;
        }

        private int DrawDirectionalIndicatorEventsOnChart(int objectIndex)
        {
            if (!ShouldDrawChartMarkers() || Chart == null || Bars == null || Bars.Count < 16 || Symbol == null)
                return objectIndex;

            try
            {
                var chartTf = Chart != null ? Chart.TimeFrame : TimeFrame.Minute;
                var chartTfMinutes = Math.Max(1, TimeFrameToMinutes(chartTf));
                var overlayFrames = new List<TimeFrame> { chartTf };
                overlayFrames.AddRange(GetEnabledAutoHigherTimeframes(chartTf)
                    .Where(tf => TimeFrameToMinutes(tf) > chartTfMinutes));

                var uniqueFrames = overlayFrames
                    .Distinct()
                    .OrderBy(tf => TimeFrameToMinutes(tf))
                    .ToList();

                var aggregatedMarkers = new List<DirectionalPatternMarkerAggregate>();
                var slotIndex = 0;
                foreach (var sourceTimeFrame in uniqueFrames)
                {
                    Bars sourceBars = sourceTimeFrame == chartTf ? Bars : null;
                    if (sourceBars == null)
                    {
                        try
                        {
                            sourceBars = MarketData.GetBars(sourceTimeFrame, Chart.SymbolName);
                        }
                        catch
                        {
                            sourceBars = null;
                        }
                    }

                    if (sourceBars == null || sourceBars.Count < 16)
                        continue;

                    if (_toggleEmaEvents)
                    {
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "pxe", MatchBullishPriceCrossesEma20, MatchBearishPriceCrossesEma20, slotIndex++);
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "emx", MatchBullishEma921Cross, MatchBearishEma921Cross, slotIndex++);
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "emt", MatchBullishEma2155Cross, MatchBearishEma2155Cross, slotIndex++);
                    }
                    if (_toggleVwapEvents)
                    {
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "vwx", MatchBullishPriceCrossesVwap20, MatchBearishPriceCrossesVwap20, slotIndex++);
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "vwr", MatchBullishVwapRejection, MatchBearishVwapRejection, slotIndex++);
                    }
                    if (_toggleBollingerEvents)
                    {
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "bbx", MatchBullishPriceCrossesBollingerMid, MatchBearishPriceCrossesBollingerMid, slotIndex++);
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "bbr", MatchBullishBollingerRejection, MatchBearishBollingerRejection, slotIndex++);
                    }
                    if (_toggleRsiEvents)
                    {
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "r50", MatchBullishRsiCross50, MatchBearishRsiCross50, slotIndex++);
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "ros", MatchBullishRsiOversold, MatchNever, slotIndex++);
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "rob", MatchNever, MatchBearishRsiOverbought, slotIndex++);
                    }
                    if (_toggleStochasticEvents)
                    {
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "stx", MatchBullishStochasticCross, MatchBearishStochasticCross, slotIndex++);
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "sto", MatchBullishStochasticExitOversold, MatchBearishStochasticExitOverbought, slotIndex++);
                    }
                    if (_toggleMacdEvents)
                    {
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "mdx", MatchBullishMacdCross, MatchBearishMacdCross, slotIndex++);
                        CollectRecentDirectionalPatternMarkers(aggregatedMarkers, sourceBars, sourceTimeFrame, "md0", MatchBullishMacdZeroCross, MatchBearishMacdZeroCross, slotIndex++);
                    }
                }

                foreach (var marker in aggregatedMarkers
                    .OrderBy(item => TimeFrameToMinutes(item.SourceTimeFrame))
                    .ThenBy(item => item.BarIndex)
                    .ThenBy(item => item.IsBullish ? 0 : 1))
                {
                    objectIndex = DrawDirectionalPatternMarker(
                        objectIndex,
                        marker.SourceBars,
                        marker.SourceTimeFrame,
                        marker.BarIndex,
                        marker.IsBullish,
                        marker.SlotIndex,
                        string.Join(", ", marker.Labels));
                }
            }
            catch (Exception ex)
            {
                SafePrint("[Visuals] Indicator events failed: {0}", ex.Message);
            }

            return objectIndex;
        }

        private int DrawIndicatorOverlaysOnChart(int objectIndex)
        {
            if (Chart == null || Bars == null || Bars.Count < 24)
                return objectIndex;

            try
            {
                if (_toggleEmaOverlay)
                {
                    objectIndex = DrawIndicatorSeriesLine(objectIndex, "EMA20_", index => ComputeExponentialMovingAverage(Bars, index, 20), Color.FromArgb(255, 56, 189, 248), 1, "Lines", 180);
                    objectIndex = DrawIndicatorSeriesLine(objectIndex, "EMA50_", index => ComputeExponentialMovingAverage(Bars, index, 50), Color.FromArgb(255, 251, 113, 133), 1, "Lines", 180);
                    objectIndex = DrawIndicatorSeriesLine(objectIndex, "EMA200_", index => ComputeExponentialMovingAverage(Bars, index, 200), Color.FromArgb(255, 132, 204, 22), 2, "Lines", 220);
                }

                if (_toggleVwapOverlay)
                    objectIndex = DrawIndicatorSeriesLine(objectIndex, "VWAP20_", index => ComputeRollingVwapAtIndex(Bars, 20, index), Color.FromArgb(255, 14, 165, 233), 1, "Lines", 180);

                if (_toggleBollingerOverlay)
                {
                    objectIndex = DrawIndicatorSeriesLine(objectIndex, "BBMID_", index => ComputeSimpleMovingAverage(Bars, index, 20), Color.FromArgb(255, 148, 163, 184), 1, "DotsRare", 180);
                    objectIndex = DrawIndicatorSeriesLine(objectIndex, "BBUP_", index => ComputeBollingerUpper(Bars, index, 20, 2.0), Color.FromArgb(255, 244, 114, 182), 1, "DotsRare", 180);
                    objectIndex = DrawIndicatorSeriesLine(objectIndex, "BBDN_", index => ComputeBollingerLower(Bars, index, 20, 2.0), Color.FromArgb(255, 244, 114, 182), 1, "DotsRare", 180);
                }
            }
            catch (Exception ex)
            {
                SafePrint("[Visuals] Indicator overlays failed: {0}", ex.Message);
            }

            return objectIndex;
        }

        private int DrawIndicatorSeriesLine(int objectIndex, string prefix, Func<int, double> valueSelector, Color color, int thickness, string lineStyle, int lookbackBars)
        {
            if (Chart == null || Bars == null || valueSelector == null || Bars.Count < 2)
                return objectIndex;

            var start = Math.Max(1, Bars.Count - Math.Max(lookbackBars, 10));
            for (var i = start; i < Bars.Count; i++)
            {
                var previousValue = valueSelector(i - 1);
                var currentValue = valueSelector(i);
                if (!IsFiniteNumber(previousValue) || !IsFiniteNumber(currentValue))
                    continue;

                var line = Chart.DrawTrendLine(
                    prefix + objectIndex.ToString(CultureInfo.InvariantCulture),
                    Bars.OpenTimes[i - 1],
                    previousValue,
                    Bars.OpenTimes[i],
                    currentValue,
                    WithAlpha(color, 180));
                TrySetPropertyValue(line, "Thickness", thickness);
                TrySetEnumPropertyValue(line, "LineStyle", lineStyle);
                TrySetPropertyValue(line, "ZIndex", 2);
                objectIndex++;
            }

            return objectIndex;
        }

        private void CollectRecentDirectionalPatternMarkers(
            List<DirectionalPatternMarkerAggregate> aggregates,
            Bars sourceBars,
            TimeFrame sourceTimeFrame,
            string shortLabel,
            Func<Bars, int, bool> bullishMatch,
            Func<Bars, int, bool> bearishMatch,
            int slotIndex)
        {
            if (aggregates == null || sourceBars == null || Symbol == null || bullishMatch == null || bearishMatch == null)
                return;

            var drawn = 0;
            var maxMarkers = 4;
            var startIndex = Math.Max(2, sourceBars.Count - 120);
            for (var barIndex = sourceBars.Count - 2; barIndex >= startIndex; barIndex--)
            {
                if (bullishMatch(sourceBars, barIndex))
                {
                    AddDirectionalPatternAggregate(aggregates, sourceBars, sourceTimeFrame, barIndex, true, slotIndex, shortLabel);
                    drawn++;
                }

                if (drawn >= maxMarkers)
                    break;

                if (bearishMatch(sourceBars, barIndex))
                {
                    AddDirectionalPatternAggregate(aggregates, sourceBars, sourceTimeFrame, barIndex, false, slotIndex, shortLabel);
                    drawn++;
                }

                if (drawn >= maxMarkers)
                    break;
            }
        }

        private void AddDirectionalPatternAggregate(
            List<DirectionalPatternMarkerAggregate> aggregates,
            Bars sourceBars,
            TimeFrame sourceTimeFrame,
            int barIndex,
            bool isBullish,
            int slotIndex,
            string shortLabel)
        {
            if (aggregates == null || sourceBars == null || string.IsNullOrWhiteSpace(shortLabel))
                return;

            var existing = aggregates.FirstOrDefault(item =>
                item.SourceTimeFrame == sourceTimeFrame &&
                item.BarIndex == barIndex &&
                item.IsBullish == isBullish);

            if (existing == null)
            {
                existing = new DirectionalPatternMarkerAggregate
                {
                    SourceBars = sourceBars,
                    SourceTimeFrame = sourceTimeFrame,
                    BarIndex = barIndex,
                    IsBullish = isBullish,
                    SlotIndex = slotIndex
                };
                aggregates.Add(existing);
            }

            existing.SlotIndex = Math.Min(existing.SlotIndex, slotIndex);
            if (!existing.Labels.Contains(shortLabel, StringComparer.OrdinalIgnoreCase))
                existing.Labels.Add(shortLabel);
        }

        private int DrawDirectionalPatternMarker(int objectIndex, Bars sourceBars, TimeFrame sourceTimeFrame, int barIndex, bool isBullish, int slotIndex, string combinedLabel)
        {
            if (sourceBars == null || Symbol == null || barIndex < 0 || barIndex >= sourceBars.Count)
                return objectIndex;

            var baseColor = GetTimeFrameStructureColor(sourceTimeFrame);
            var textPad = Math.Max(Symbol.PipSize * (0.6 + (slotIndex * 0.35)), 0.0000001);
            var sourceTfMinutes = Math.Max(1, TimeFrameToMinutes(sourceTimeFrame));
            var chartTfMinutes = Math.Max(1, TimeFrameToMinutes(Chart != null ? Chart.TimeFrame : sourceTimeFrame));
            var anchorPrice = isBullish
                ? sourceBars.LowPrices[barIndex]
                : sourceBars.HighPrices[barIndex];
            var textY = isBullish
                ? anchorPrice - textPad
                : anchorPrice + textPad;
            var textTime = sourceTfMinutes > chartTfMinutes
                ? sourceBars.OpenTimes[barIndex].AddMinutes(sourceTfMinutes - chartTfMinutes)
                : sourceBars.OpenTimes[barIndex].AddMinutes(sourceTfMinutes);
            var markerText = FormatDirectionalMarkerText(string.IsNullOrWhiteSpace(combinedLabel) ? "pat" : combinedLabel, isBullish);

            var text = Chart.DrawText(
                "PAT_" + GetMiniChartLabel(sourceTimeFrame) + "_" + objectIndex.ToString(CultureInfo.InvariantCulture),
                markerText,
                textTime,
                textY,
                baseColor);
            TryStyleChartText(text, ResolveChartMarkerFontSize(sourceTimeFrame), "Courier New", true);
            TrySetPropertyValue(text, "ZIndex", 12);
            return objectIndex + 1;
        }

        private bool MatchBullishPinBar(Bars sourceBars, int index)
        {
            return IsBullishPinBar(sourceBars, index);
        }

        private bool MatchBearishPinBar(Bars sourceBars, int index)
        {
            return IsBearishPinBar(sourceBars, index);
        }

        private bool MatchBullishEngulfingAtIndex(Bars sourceBars, int index)
        {
            return IsBullishEngulfing(sourceBars, index - 1, index);
        }

        private bool MatchBearishEngulfingAtIndex(Bars sourceBars, int index)
        {
            return IsBearishEngulfing(sourceBars, index - 1, index);
        }

        private bool MatchStrongBullishCandle(Bars sourceBars, int index)
        {
            return IsStrongDirectionalCandle(sourceBars, index, true);
        }

        private bool MatchStrongBearishCandle(Bars sourceBars, int index)
        {
            return IsStrongDirectionalCandle(sourceBars, index, false);
        }

        private bool MatchBullishSequenceCandle(Bars sourceBars, int index)
        {
            return IsDirectionalCandleSequence(sourceBars, index, true, Math.Max(1, FollowTrendCandlesCount));
        }

        private bool MatchBearishSequenceCandle(Bars sourceBars, int index)
        {
            return IsDirectionalCandleSequence(sourceBars, index, false, Math.Max(1, FollowTrendCandlesCount));
        }

        private bool MatchBullishBigCandle(Bars sourceBars, int index)
        {
            return IsBigDirectionalCandle(sourceBars, index, true);
        }

        private bool MatchBearishBigCandle(Bars sourceBars, int index)
        {
            return IsBigDirectionalCandle(sourceBars, index, false);
        }

        private bool MatchNever(Bars sourceBars, int index)
        {
            return false;
        }

        private bool MatchBullishMorningStar(Bars sourceBars, int index)
        {
            return MatchSharedRulePattern(sourceBars, index, "bullish_morning_star");
        }

        private bool MatchBearishEveningStar(Bars sourceBars, int index)
        {
            return MatchSharedRulePattern(sourceBars, index, "bearish_evening_star");
        }

        private bool MatchBullishHammer(Bars sourceBars, int index)
        {
            return MatchSharedRulePattern(sourceBars, index, "bullish_hammer");
        }

        private bool MatchBearishHangingMan(Bars sourceBars, int index)
        {
            return MatchSharedRulePattern(sourceBars, index, "hanging_man");
        }

        private bool MatchBearishShootingStar(Bars sourceBars, int index)
        {
            return MatchSharedRulePattern(sourceBars, index, "shooting_star");
        }

        private bool MatchBullishInvertedHammer(Bars sourceBars, int index)
        {
            return MatchSharedRulePattern(sourceBars, index, "bullish_inverted_hammer");
        }

        private bool MatchBullishPiercingLine(Bars sourceBars, int index)
        {
            return MatchSharedRulePattern(sourceBars, index, "bullish_piercing_line");
        }

        private bool MatchBearishDarkCloudCover(Bars sourceBars, int index)
        {
            return MatchSharedRulePattern(sourceBars, index, "bearish_dark_cloud_cover");
        }

        private bool MatchBullishThreeWhiteSoldiers(Bars sourceBars, int index)
        {
            return MatchSharedRulePattern(sourceBars, index, "bullish_three_white_soldiers");
        }

        private bool MatchBearishThreeBlackCrows(Bars sourceBars, int index)
        {
            return MatchSharedRulePattern(sourceBars, index, "bearish_three_black_crows");
        }

        private bool MatchBullishHarami(Bars sourceBars, int index)
        {
            return MatchSharedRulePattern(sourceBars, index, "bullish_harami");
        }

        private bool MatchBearishHarami(Bars sourceBars, int index)
        {
            return MatchSharedRulePattern(sourceBars, index, "bearish_harami");
        }

        private bool MatchSharedRulePattern(Bars sourceBars, int index, string patternType)
        {
            if (sourceBars == null || string.IsNullOrWhiteSpace(patternType) || index <= 0 || index >= sourceBars.Count)
                return false;

            try
            {
                var symbol = Symbol;
                var timeFrame = Chart != null ? Chart.TimeFrame : TimeFrame.Minute;
                var context = BuildSharedRuleContext(sourceBars, index, symbol, timeFrame, null);
                var detected = DetectSharedRulePatterns(context);
                return detected != null && detected.Contains(patternType);
            }
            catch
            {
                return false;
            }
        }

        private SharedIndicatorSnapshot BuildSharedIndicatorSnapshot(Bars sourceBars, int barIndex)
        {
            var snapshot = new SharedIndicatorSnapshot();
            if (sourceBars == null || barIndex < 0 || barIndex >= sourceBars.Count)
                return snapshot;

            snapshot.Ema9 = ComputeExponentialMovingAverage(sourceBars, barIndex, 9);
            snapshot.Ema20 = ComputeExponentialMovingAverage(sourceBars, barIndex, 20);
            snapshot.Ema21 = ComputeExponentialMovingAverage(sourceBars, barIndex, 21);
            snapshot.Ema50 = ComputeExponentialMovingAverage(sourceBars, barIndex, 50);
            snapshot.Ema55 = ComputeExponentialMovingAverage(sourceBars, barIndex, 55);
            snapshot.Ema200 = ComputeExponentialMovingAverage(sourceBars, barIndex, 200);
            snapshot.Sma20 = ComputeSimpleMovingAverage(sourceBars, barIndex, 20);
            snapshot.Sma50 = ComputeSimpleMovingAverage(sourceBars, barIndex, 50);
            snapshot.Sma200 = ComputeSimpleMovingAverage(sourceBars, barIndex, 200);
            snapshot.Vwap20 = ComputeRollingVwapAtIndex(sourceBars, 20, barIndex);
            snapshot.BbMid = snapshot.Sma20;
            snapshot.BbUpper = ComputeBollingerUpper(sourceBars, barIndex, 20, 2.0);
            snapshot.BbLower = ComputeBollingerLower(sourceBars, barIndex, 20, 2.0);
            snapshot.Rsi14 = ComputeRelativeStrengthIndex(sourceBars, barIndex, 14);
            snapshot.StochK = ComputeRawStochasticK(sourceBars, barIndex, 14);
            snapshot.StochD = ComputeSmoothedStochasticK(sourceBars, barIndex, 14, 3);
            snapshot.Roc12 = ComputeRateOfChange(sourceBars, barIndex, 12);
            double macdLine;
            double signalLine;
            if (TryComputeMacdValues(sourceBars, barIndex, 12, 26, 9, out macdLine, out signalLine))
            {
                snapshot.MacdLine = macdLine;
                snapshot.MacdSignal = signalLine;
                snapshot.MacdHistogram = macdLine - signalLine;
            }
            else
            {
                snapshot.MacdLine = double.NaN;
                snapshot.MacdSignal = double.NaN;
                snapshot.MacdHistogram = double.NaN;
            }

            return snapshot;
        }

        private void PopulateSharedIndicatorDictionary(Dictionary<string, object> sink, SharedIndicatorSnapshot snapshot)
        {
            if (sink == null || snapshot == null)
                return;

            SetSharedIndicatorValue(sink, "ema_9", snapshot.Ema9);
            SetSharedIndicatorValue(sink, "ema_20", snapshot.Ema20);
            SetSharedIndicatorValue(sink, "ema_21", snapshot.Ema21);
            SetSharedIndicatorValue(sink, "ema_50", snapshot.Ema50);
            SetSharedIndicatorValue(sink, "ema_55", snapshot.Ema55);
            SetSharedIndicatorValue(sink, "ema_200", snapshot.Ema200);
            SetSharedIndicatorValue(sink, "ema_fast", snapshot.Ema9);
            SetSharedIndicatorValue(sink, "ema_mid", snapshot.Ema21);
            SetSharedIndicatorValue(sink, "ema_slow", snapshot.Ema55);
            SetSharedIndicatorValue(sink, "sma_20", snapshot.Sma20);
            SetSharedIndicatorValue(sink, "sma_50", snapshot.Sma50);
            SetSharedIndicatorValue(sink, "sma_200", snapshot.Sma200);
            SetSharedIndicatorValue(sink, "vwap", snapshot.Vwap20);
            SetSharedIndicatorValue(sink, "vwap_20", snapshot.Vwap20);
            SetSharedIndicatorValue(sink, "bb_mid", snapshot.BbMid);
            SetSharedIndicatorValue(sink, "bb_upper", snapshot.BbUpper);
            SetSharedIndicatorValue(sink, "bb_lower", snapshot.BbLower);
            SetSharedIndicatorValue(sink, "rsi_14", snapshot.Rsi14);
            SetSharedIndicatorValue(sink, "stoch_k", snapshot.StochK);
            SetSharedIndicatorValue(sink, "stoch_d", snapshot.StochD);
            SetSharedIndicatorValue(sink, "macd", snapshot.MacdLine);
            SetSharedIndicatorValue(sink, "macd_line", snapshot.MacdLine);
            SetSharedIndicatorValue(sink, "macd_signal", snapshot.MacdSignal);
            SetSharedIndicatorValue(sink, "signal_line", snapshot.MacdSignal);
            SetSharedIndicatorValue(sink, "macd_histogram", snapshot.MacdHistogram);
            SetSharedIndicatorValue(sink, "roc_12", snapshot.Roc12);
            SetSharedIndicatorValue(sink, "roc_main", snapshot.Roc12);
        }

        private void SetSharedIndicatorValue(Dictionary<string, object> sink, string key, double value)
        {
            if (sink == null || string.IsNullOrWhiteSpace(key))
                return;

            sink[key] = IsFiniteNumber(value) ? (object)value : null;
        }

        private double ComputeBollingerUpper(Bars sourceBars, int endIndex, int period, double stddevMultiplier)
        {
            var mean = ComputeSimpleMovingAverage(sourceBars, endIndex, period);
            var stddev = ComputeRollingStandardDeviation(sourceBars, endIndex, period, mean);
            if (!IsFiniteNumber(mean) || !IsFiniteNumber(stddev))
                return double.NaN;
            return mean + (stddev * stddevMultiplier);
        }

        private double ComputeBollingerLower(Bars sourceBars, int endIndex, int period, double stddevMultiplier)
        {
            var mean = ComputeSimpleMovingAverage(sourceBars, endIndex, period);
            var stddev = ComputeRollingStandardDeviation(sourceBars, endIndex, period, mean);
            if (!IsFiniteNumber(mean) || !IsFiniteNumber(stddev))
                return double.NaN;
            return mean - (stddev * stddevMultiplier);
        }

        private bool MatchBullishPriceCrossesEma20(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesAbove(
                sourceBars.ClosePrices[index - 1],
                sourceBars.ClosePrices[index],
                ComputeExponentialMovingAverage(sourceBars, index - 1, 20),
                ComputeExponentialMovingAverage(sourceBars, index, 20));
        }

        private bool MatchBearishPriceCrossesEma20(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesBelow(
                sourceBars.ClosePrices[index - 1],
                sourceBars.ClosePrices[index],
                ComputeExponentialMovingAverage(sourceBars, index - 1, 20),
                ComputeExponentialMovingAverage(sourceBars, index, 20));
        }

        private bool MatchBullishEma921Cross(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesAbove(
                ComputeExponentialMovingAverage(sourceBars, index - 1, 9),
                ComputeExponentialMovingAverage(sourceBars, index, 9),
                ComputeExponentialMovingAverage(sourceBars, index - 1, 21),
                ComputeExponentialMovingAverage(sourceBars, index, 21));
        }

        private bool MatchBearishEma921Cross(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesBelow(
                ComputeExponentialMovingAverage(sourceBars, index - 1, 9),
                ComputeExponentialMovingAverage(sourceBars, index, 9),
                ComputeExponentialMovingAverage(sourceBars, index - 1, 21),
                ComputeExponentialMovingAverage(sourceBars, index, 21));
        }

        private bool MatchBullishEma2155Cross(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesAbove(
                ComputeExponentialMovingAverage(sourceBars, index - 1, 21),
                ComputeExponentialMovingAverage(sourceBars, index, 21),
                ComputeExponentialMovingAverage(sourceBars, index - 1, 55),
                ComputeExponentialMovingAverage(sourceBars, index, 55));
        }

        private bool MatchBearishEma2155Cross(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesBelow(
                ComputeExponentialMovingAverage(sourceBars, index - 1, 21),
                ComputeExponentialMovingAverage(sourceBars, index, 21),
                ComputeExponentialMovingAverage(sourceBars, index - 1, 55),
                ComputeExponentialMovingAverage(sourceBars, index, 55));
        }

        private bool MatchBullishPriceCrossesVwap20(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesAbove(
                sourceBars.ClosePrices[index - 1],
                sourceBars.ClosePrices[index],
                ComputeRollingVwapAtIndex(sourceBars, 20, index - 1),
                ComputeRollingVwapAtIndex(sourceBars, 20, index));
        }

        private bool MatchBearishPriceCrossesVwap20(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesBelow(
                sourceBars.ClosePrices[index - 1],
                sourceBars.ClosePrices[index],
                ComputeRollingVwapAtIndex(sourceBars, 20, index - 1),
                ComputeRollingVwapAtIndex(sourceBars, 20, index));
        }

        private bool MatchBullishVwapRejection(Bars sourceBars, int index)
        {
            if (sourceBars == null || index < 0)
                return false;

            var vwap = ComputeRollingVwapAtIndex(sourceBars, 20, index);
            return IsFiniteNumber(vwap) && sourceBars.LowPrices[index] <= vwap && sourceBars.ClosePrices[index] > vwap;
        }

        private bool MatchBearishVwapRejection(Bars sourceBars, int index)
        {
            if (sourceBars == null || index < 0)
                return false;

            var vwap = ComputeRollingVwapAtIndex(sourceBars, 20, index);
            return IsFiniteNumber(vwap) && sourceBars.HighPrices[index] >= vwap && sourceBars.ClosePrices[index] < vwap;
        }

        private bool MatchBullishPriceCrossesBollingerMid(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesAbove(
                sourceBars.ClosePrices[index - 1],
                sourceBars.ClosePrices[index],
                ComputeSimpleMovingAverage(sourceBars, index - 1, 20),
                ComputeSimpleMovingAverage(sourceBars, index, 20));
        }

        private bool MatchBearishPriceCrossesBollingerMid(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesBelow(
                sourceBars.ClosePrices[index - 1],
                sourceBars.ClosePrices[index],
                ComputeSimpleMovingAverage(sourceBars, index - 1, 20),
                ComputeSimpleMovingAverage(sourceBars, index, 20));
        }

        private bool MatchBullishBollingerRejection(Bars sourceBars, int index)
        {
            if (sourceBars == null || index < 0)
                return false;

            var lower = ComputeBollingerLower(sourceBars, index, 20, 2.0);
            return IsFiniteNumber(lower) && sourceBars.LowPrices[index] <= lower && sourceBars.ClosePrices[index] > lower;
        }

        private bool MatchBearishBollingerRejection(Bars sourceBars, int index)
        {
            if (sourceBars == null || index < 0)
                return false;

            var upper = ComputeBollingerUpper(sourceBars, index, 20, 2.0);
            return IsFiniteNumber(upper) && sourceBars.HighPrices[index] >= upper && sourceBars.ClosePrices[index] < upper;
        }

        private bool MatchBullishRsiCross50(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesAbove(
                ComputeRelativeStrengthIndex(sourceBars, index - 1, 14),
                ComputeRelativeStrengthIndex(sourceBars, index, 14),
                50.0,
                50.0);
        }

        private bool MatchBearishRsiCross50(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesBelow(
                ComputeRelativeStrengthIndex(sourceBars, index - 1, 14),
                ComputeRelativeStrengthIndex(sourceBars, index, 14),
                50.0,
                50.0);
        }

        private bool MatchBullishRsiOversold(Bars sourceBars, int index)
        {
            var rsi = ComputeRelativeStrengthIndex(sourceBars, index, 14);
            return IsFiniteNumber(rsi) && rsi < 30.0;
        }

        private bool MatchBearishRsiOverbought(Bars sourceBars, int index)
        {
            var rsi = ComputeRelativeStrengthIndex(sourceBars, index, 14);
            return IsFiniteNumber(rsi) && rsi > 70.0;
        }

        private bool MatchBullishStochasticCross(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesAbove(
                ComputeRawStochasticK(sourceBars, index - 1, 14),
                ComputeRawStochasticK(sourceBars, index, 14),
                ComputeSmoothedStochasticK(sourceBars, index - 1, 14, 3),
                ComputeSmoothedStochasticK(sourceBars, index, 14, 3));
        }

        private bool MatchBearishStochasticCross(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesBelow(
                ComputeRawStochasticK(sourceBars, index - 1, 14),
                ComputeRawStochasticK(sourceBars, index, 14),
                ComputeSmoothedStochasticK(sourceBars, index - 1, 14, 3),
                ComputeSmoothedStochasticK(sourceBars, index, 14, 3));
        }

        private bool MatchBullishStochasticExitOversold(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesAbove(
                ComputeRawStochasticK(sourceBars, index - 1, 14),
                ComputeRawStochasticK(sourceBars, index, 14),
                20.0,
                20.0);
        }

        private bool MatchBearishStochasticExitOverbought(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            return CrossesBelow(
                ComputeRawStochasticK(sourceBars, index - 1, 14),
                ComputeRawStochasticK(sourceBars, index, 14),
                80.0,
                80.0);
        }

        private bool MatchBullishMacdCross(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            double prevMacd;
            double prevSignal;
            double currentMacd;
            double currentSignal;
            if (!TryComputeMacdValues(sourceBars, index - 1, 12, 26, 9, out prevMacd, out prevSignal) ||
                !TryComputeMacdValues(sourceBars, index, 12, 26, 9, out currentMacd, out currentSignal))
                return false;

            return CrossesAbove(prevMacd, currentMacd, prevSignal, currentSignal);
        }

        private bool MatchBearishMacdCross(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            double prevMacd;
            double prevSignal;
            double currentMacd;
            double currentSignal;
            if (!TryComputeMacdValues(sourceBars, index - 1, 12, 26, 9, out prevMacd, out prevSignal) ||
                !TryComputeMacdValues(sourceBars, index, 12, 26, 9, out currentMacd, out currentSignal))
                return false;

            return CrossesBelow(prevMacd, currentMacd, prevSignal, currentSignal);
        }

        private bool MatchBullishMacdZeroCross(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            double prevMacd;
            double prevSignal;
            double currentMacd;
            double currentSignal;
            if (!TryComputeMacdValues(sourceBars, index - 1, 12, 26, 9, out prevMacd, out prevSignal) ||
                !TryComputeMacdValues(sourceBars, index, 12, 26, 9, out currentMacd, out currentSignal))
                return false;

            return CrossesAbove(prevMacd, currentMacd, 0.0, 0.0);
        }

        private bool MatchBearishMacdZeroCross(Bars sourceBars, int index)
        {
            if (sourceBars == null || index <= 0)
                return false;

            double prevMacd;
            double prevSignal;
            double currentMacd;
            double currentSignal;
            if (!TryComputeMacdValues(sourceBars, index - 1, 12, 26, 9, out prevMacd, out prevSignal) ||
                !TryComputeMacdValues(sourceBars, index, 12, 26, 9, out currentMacd, out currentSignal))
                return false;

            return CrossesBelow(prevMacd, currentMacd, 0.0, 0.0);
        }

        private List<StructureEvent> CollectStructureEvents()
        {
            return CollectStructureEvents(Bars, Chart != null ? Chart.TimeFrame : TimeFrame.Minute, 180);
        }

        private List<StructureEvent> CollectStructureEvents(Bars sourceBars, TimeFrame sourceTimeFrame, int lookbackBars)
        {
            var swings = CollectConfirmedSwings(sourceBars, lookbackBars);
            var events = new List<StructureEvent>();
            if (swings.Count < 4)
                return events;

            SwingPoint? lastHigh = null;
            SwingPoint? prevHigh = null;
            SwingPoint? lastLow = null;
            SwingPoint? prevLow = null;
            var bias = StructureBias.Neutral;
            var lastBrokenHighBar = -1;
            var lastBrokenLowBar = -1;

            foreach (var swing in swings)
            {
                if (swing.IsHigh)
                {
                    prevHigh = lastHigh;
                    lastHigh = swing;
                }
                else
                {
                    prevLow = lastLow;
                    lastLow = swing;
                }

                if (!prevHigh.HasValue || !prevLow.HasValue || !lastHigh.HasValue || !lastLow.HasValue)
                    continue;

                if (lastHigh.Value.Price > prevHigh.Value.Price && lastLow.Value.Price > prevLow.Value.Price)
                    bias = StructureBias.Bullish;
                else if (lastHigh.Value.Price < prevHigh.Value.Price && lastLow.Value.Price < prevLow.Value.Price)
                    bias = StructureBias.Bearish;

                var startBar = Math.Max(swing.BarIndex + 1, 2);
                var endBar = Math.Min(sourceBars.Count - 1, swing.BarIndex + 16);
                for (var barIndex = startBar; barIndex <= endBar; barIndex++)
                {
                    var closeV = sourceBars.ClosePrices[barIndex];
                    if ((bias == StructureBias.Bullish || bias == StructureBias.Neutral) &&
                        closeV > lastHigh.Value.Price &&
                        lastBrokenHighBar < lastHigh.Value.BarIndex)
                    {
                        events.Add(new StructureEvent
                        {
                            Label = bias == StructureBias.Bearish ? "CHOCH" : "BOS",
                            BarIndex = barIndex,
                            Time = sourceBars.OpenTimes[barIndex],
                            Price = lastHigh.Value.Price,
                            IsBullish = true,
                            IsChoch = bias == StructureBias.Bearish,
                            SourceTimeFrame = sourceTimeFrame
                        });
                        lastBrokenHighBar = lastHigh.Value.BarIndex;
                        bias = StructureBias.Bullish;
                        break;
                    }

                    if ((bias == StructureBias.Bearish || bias == StructureBias.Neutral) &&
                        closeV < lastLow.Value.Price &&
                        lastBrokenLowBar < lastLow.Value.BarIndex)
                    {
                        events.Add(new StructureEvent
                        {
                            Label = bias == StructureBias.Bullish ? "CHOCH" : "BOS",
                            BarIndex = barIndex,
                            Time = sourceBars.OpenTimes[barIndex],
                            Price = lastLow.Value.Price,
                            IsBullish = false,
                            IsChoch = bias == StructureBias.Bullish,
                            SourceTimeFrame = sourceTimeFrame
                        });
                        lastBrokenLowBar = lastLow.Value.BarIndex;
                        bias = StructureBias.Bearish;
                        break;
                    }
                }
            }

            return events;
        }

        private bool TryMatchSweepPattern(int reclaimBarIndex, SweepCandidate candidate, out SweepMatch match)
        {
            return TryMatchSweepPattern(Bars, reclaimBarIndex, candidate, out match);
        }

        private bool TryMatchSweepPattern(Bars sourceBars, int reclaimBarIndex, SweepCandidate candidate, out SweepMatch match)
        {
            match = new SweepMatch
            {
                IsValid = false,
                SweepBarIndex = -1,
                ReclaimBarIndex = -1
            };

            if (sourceBars == null || reclaimBarIndex < 1 || reclaimBarIndex >= sourceBars.Count)
                return false;

            if (IsSingleBarSweepReclaim(sourceBars, reclaimBarIndex, candidate))
            {
                match = new SweepMatch
                {
                    IsValid = true,
                    SweepBarIndex = reclaimBarIndex,
                    ReclaimBarIndex = reclaimBarIndex
                };
                return true;
            }

            var sweepBarIndex = reclaimBarIndex - 1;
            if (sourceBars.OpenTimes[sweepBarIndex] <= candidate.Time)
                return false;

            if (IsTwoBarSweepReclaim(sourceBars, sweepBarIndex, reclaimBarIndex, candidate))
            {
                match = new SweepMatch
                {
                    IsValid = true,
                    SweepBarIndex = sweepBarIndex,
                    ReclaimBarIndex = reclaimBarIndex
                };
                return true;
            }

            return false;
        }

        private bool IsSingleBarSweepReclaim(int barIndex, SweepCandidate candidate)
        {
            return IsSingleBarSweepReclaim(Bars, barIndex, candidate);
        }

        private bool IsSingleBarSweepReclaim(Bars sourceBars, int barIndex, SweepCandidate candidate)
        {
            var level = candidate.Price;
            var openV = sourceBars.OpenPrices[barIndex];
            var highV = sourceBars.HighPrices[barIndex];
            var lowV = sourceBars.LowPrices[barIndex];
            var closeV = sourceBars.ClosePrices[barIndex];
            var bodyCross = (openV < level && closeV > level) || (openV > level && closeV < level);
            if (bodyCross)
                return false;

            var reclaim = candidate.IsHigh
                ? (highV > level && closeV < level)
                : (lowV < level && closeV > level);
            if (!reclaim)
                return false;

            var pipSize = Symbol != null && Symbol.PipSize > 0 ? Symbol.PipSize : 0.0000001;
            var fullSpan = Math.Max(highV - lowV, Math.Max(pipSize, 0.0000001));
            var startSpan = candidate.IsHigh
                ? Math.Max(highV - level, 0.0)
                : Math.Max(level - lowV, 0.0);
            var startRatio = startSpan / fullSpan;
            return startRatio >= 0.75;
        }

        private bool IsTwoBarSweepReclaim(int sweepBarIndex, int reclaimBarIndex, SweepCandidate candidate)
        {
            return IsTwoBarSweepReclaim(Bars, sweepBarIndex, reclaimBarIndex, candidate);
        }

        private bool IsTwoBarSweepReclaim(Bars sourceBars, int sweepBarIndex, int reclaimBarIndex, SweepCandidate candidate)
        {
            var level = candidate.Price;
            var sweepHigh = sourceBars.HighPrices[sweepBarIndex];
            var sweepLow = sourceBars.LowPrices[sweepBarIndex];
            var sweepClose = sourceBars.ClosePrices[sweepBarIndex];
            var reclaimHigh = sourceBars.HighPrices[reclaimBarIndex];
            var reclaimLow = sourceBars.LowPrices[reclaimBarIndex];
            var reclaimClose = sourceBars.ClosePrices[reclaimBarIndex];
            var pipSize = Symbol != null && Symbol.PipSize > 0 ? Symbol.PipSize : 0.0000001;
            var combinedSpan = Math.Max(Math.Max(sweepHigh, reclaimHigh) - Math.Min(sweepLow, reclaimLow), Math.Max(pipSize, 0.0000001));

            if (candidate.IsHigh)
            {
                if (!(sweepHigh > level && sweepClose <= level && reclaimClose < level))
                    return false;

                var penetration = sweepHigh - level;
                return (penetration / combinedSpan) <= 0.45;
            }

            if (!(sweepLow < level && sweepClose >= level && reclaimClose > level))
                return false;

            var lowPenetration = level - sweepLow;
            return (lowPenetration / combinedSpan) <= 0.45;
        }

        private bool TryGetRangeHighLow(Bars sourceBars, DateTime start, DateTime end, out double high, out double low, out DateTime highTime, out DateTime lowTime)
        {
            high = double.MinValue;
            low = double.MaxValue;
            highTime = DateTime.MinValue;
            lowTime = DateTime.MinValue;
            if (sourceBars == null || sourceBars.Count == 0)
                return false;

            for (var i = 0; i < sourceBars.Count; i++)
            {
                var openTime = sourceBars.OpenTimes[i];
                if (openTime < start || openTime >= end)
                    continue;
                if (sourceBars.HighPrices[i] > high)
                {
                    high = sourceBars.HighPrices[i];
                    highTime = openTime;
                }
                if (sourceBars.LowPrices[i] < low)
                {
                    low = sourceBars.LowPrices[i];
                    lowTime = openTime;
                }
            }

            return high > double.MinValue && low < double.MaxValue && highTime != DateTime.MinValue && lowTime != DateTime.MinValue;
        }

        private int DrawHorizontalGuide(int objectIndex, string label, DateTime startTime, double price, Color color, bool drawLabel = true)
        {
            if (startTime == DateTime.MinValue)
                startTime = GetCurrentChartEndTime();
            var endTime = GetCurrentChartEndTime();
            if (endTime <= startTime)
                endTime = startTime.AddMinutes(1);

            var line = Chart.DrawTrendLine("KEY_" + objectIndex.ToString(CultureInfo.InvariantCulture), startTime, price, endTime, price, color);
            TrySetPropertyValue(line, "Thickness", 1);
            TrySetEnumPropertyValue(line, "LineStyle", "DotsRare");

            if (drawLabel && !string.IsNullOrWhiteSpace(label))
            {
                var text = Chart.DrawText("KEY_TXT_" + objectIndex.ToString(CultureInfo.InvariantCulture), label, startTime, price, color);
                TryStyleChartText(text, GetChartMarkerFontSize(), "Courier New", false);
            }
            objectIndex++;
            return objectIndex;
        }

        private int DrawConfiguredKillerZones(int objectIndex)
        {
            if (!ShouldShowLowerTimeframeSessionContext())
                return objectIndex;

            var today = GetReferenceNow().Date;
            var days = Math.Max(1, KillerZoneDays);
            for (var dayOffset = 0; dayOffset < days; dayOffset++)
            {
                var date = today.AddDays(-dayOffset);
                objectIndex = DrawKillerZoneBox(objectIndex, "ASIA", date, Color.FromArgb(32, 70, 130, 180));
                objectIndex = DrawKillerZoneBox(objectIndex, "LDN", date, Color.FromArgb(34, 60, 179, 113));
                objectIndex = DrawKillerZoneBox(objectIndex, "NY", date, Color.FromArgb(38, 255, 215, 0));
            }
            return objectIndex;
        }

        private int DrawKillerZoneBox(int objectIndex, string label, DateTime date, Color color)
        {
            DateTime startUtc;
            DateTime endUtc;
            if (!TryGetSessionUtcRange(label, date, out startUtc, out endUtc))
                return objectIndex;

            double high;
            double low;
            DateTime highTime;
            DateTime lowTime;
            if (!TryGetRangeHighLow(Bars, startUtc, endUtc, out high, out low, out highTime, out lowTime))
                return objectIndex;
            if (high <= low)
                return objectIndex;

            var textColor = Color.FromArgb(235, 72, 72, 72);
            var borderColor = textColor;
            var topLine = Chart.DrawTrendLine("KZ_TOP_" + objectIndex.ToString(CultureInfo.InvariantCulture), startUtc, high, endUtc, high, borderColor);
            TrySetPropertyValue(topLine, "Thickness", 2);
            TrySetEnumPropertyValue(topLine, "LineStyle", "DotsRare");
            TrySetChartObjectBackground(topLine);

            var bottomLine = Chart.DrawTrendLine("KZ_BOT_" + objectIndex.ToString(CultureInfo.InvariantCulture), startUtc, low, endUtc, low, borderColor);
            TrySetPropertyValue(bottomLine, "Thickness", 2);
            TrySetEnumPropertyValue(bottomLine, "LineStyle", "DotsRare");
            TrySetChartObjectBackground(bottomLine);

            var textX = startUtc.AddMinutes(Math.Max(1, (endUtc - startUtc).TotalMinutes * 0.08));
            var topTextY = high + (Math.Max(high - low, Symbol.PipSize * 20) * 0.02);
            var bottomTextY = low - (Math.Max(high - low, Symbol.PipSize * 20) * 0.02);
            var text = Chart.DrawText("KZ_TXT_" + objectIndex.ToString(CultureInfo.InvariantCulture), (label ?? "KZ") + " KZ", textX, topTextY, textColor);
            TryStyleChartText(text, GetChartMarkerFontSize(), "Courier New", true);
            var text2 = Chart.DrawText("KZ_TXT2_" + objectIndex.ToString(CultureInfo.InvariantCulture), label ?? "SESSION", textX, bottomTextY, textColor);
            TryStyleChartText(text2, GetChartMarkerFontSize(), "Courier New", true);
            return objectIndex + 1;
        }

        private int DrawRecentFvgZones(Bars sourceBars, TimeFrame sourceTimeFrame, string objectPrefix, int objectIndex, DateTime endTime)
        {
            var maxZones = 8;
            if (sourceBars == null || sourceBars.Count < 3) return objectIndex;
            var startIndex = Math.Max(2, sourceBars.Count - 80);
            var zoneColor = WithAlpha(GetTimeFrameStructureColor(sourceTimeFrame), 24);
            for (var i = sourceBars.Count - 1; i >= startIndex && maxZones > 0; i--)
            {
                var leftHigh = sourceBars.HighPrices[i - 2];
                var leftLow = sourceBars.LowPrices[i - 2];
                var rightHigh = sourceBars.HighPrices[i];
                var rightLow = sourceBars.LowPrices[i];

                if (rightLow > leftHigh)
                {
                    if (IsZoneTouched(sourceBars, i + 1, leftHigh, rightLow))
                        continue;
                    var rect = Chart.DrawRectangle(objectPrefix + objectIndex.ToString(CultureInfo.InvariantCulture), sourceBars.OpenTimes[i - 2], rightLow, endTime, leftHigh, zoneColor);
                    TrySetPropertyValue(rect, "IsFilled", true);
                    TrySetPropertyValue(rect, "Color", zoneColor);
                    TrySetPropertyValue(rect, "BorderColor", Color.FromArgb(0, zoneColor.R, zoneColor.G, zoneColor.B));
                    TrySetPropertyValue(rect, "Thickness", 0);
                    TrySetChartObjectBackground(rect);
                    objectIndex++;
                    maxZones--;
                }
                else if (rightHigh < leftLow)
                {
                    if (IsZoneTouched(sourceBars, i + 1, rightHigh, leftLow))
                        continue;
                    var rect = Chart.DrawRectangle(objectPrefix + objectIndex.ToString(CultureInfo.InvariantCulture), sourceBars.OpenTimes[i - 2], leftLow, endTime, rightHigh, zoneColor);
                    TrySetPropertyValue(rect, "IsFilled", true);
                    TrySetPropertyValue(rect, "Color", zoneColor);
                    TrySetPropertyValue(rect, "BorderColor", Color.FromArgb(0, zoneColor.R, zoneColor.G, zoneColor.B));
                    TrySetPropertyValue(rect, "Thickness", 0);
                    TrySetChartObjectBackground(rect);
                    objectIndex++;
                    maxZones--;
                }
            }
            return objectIndex;
        }

        private int DrawRecentOrderBlocks(Bars sourceBars, TimeFrame sourceTimeFrame, string objectPrefix, int objectIndex, DateTime endTime)
        {
            var maxBlocks = 6;
            if (sourceBars == null || sourceBars.Count < 4) return objectIndex;
            var startIndex = Math.Max(3, sourceBars.Count - 80);
            var zoneColor = WithAlpha(GetTimeFrameStructureColor(sourceTimeFrame), 28);
            for (var i = sourceBars.Count - 1; i >= startIndex && maxBlocks > 0; i--)
            {
                var leftHigh = sourceBars.HighPrices[i - 2];
                var leftLow = sourceBars.LowPrices[i - 2];
                var rightHigh = sourceBars.HighPrices[i];
                var rightLow = sourceBars.LowPrices[i];

                if (rightLow > leftHigh)
                {
                    for (var j = i - 1; j >= Math.Max(1, i - 5); j--)
                    {
                        if (sourceBars.ClosePrices[j] < sourceBars.OpenPrices[j])
                        {
                            if (!IsOrderBlockTouched(sourceBars, j + 1, j))
                            {
                                DrawOrderBlockRectangle(sourceBars, objectPrefix + objectIndex.ToString(CultureInfo.InvariantCulture), j, endTime, zoneColor);
                                objectIndex++;
                                maxBlocks--;
                            }
                            break;
                        }
                    }
                }
                else if (rightHigh < leftLow)
                {
                    for (var j = i - 1; j >= Math.Max(1, i - 5); j--)
                    {
                        if (sourceBars.ClosePrices[j] > sourceBars.OpenPrices[j])
                        {
                            if (!IsOrderBlockTouched(sourceBars, j + 1, j))
                            {
                                DrawOrderBlockRectangle(sourceBars, objectPrefix + objectIndex.ToString(CultureInfo.InvariantCulture), j, endTime, zoneColor);
                                objectIndex++;
                                maxBlocks--;
                            }
                            break;
                        }
                    }
                }
            }
            return objectIndex;
        }

        private bool IsZoneTouched(Bars sourceBars, int fromBarIndex, double zoneLow, double zoneHigh)
        {
            if (sourceBars == null || sourceBars.Count == 0) return false;
            var low = Math.Min(zoneLow, zoneHigh);
            var high = Math.Max(zoneLow, zoneHigh);
            for (var i = Math.Max(0, fromBarIndex); i < sourceBars.Count; i++)
            {
                if (sourceBars.HighPrices[i] >= low && sourceBars.LowPrices[i] <= high)
                    return true;
            }
            return false;
        }

        private bool IsOrderBlockTouched(Bars sourceBars, int fromBarIndex, int obBarIndex)
        {
            var obHigh = OrderBlockUseFullWick ? sourceBars.HighPrices[obBarIndex] : Math.Max(sourceBars.OpenPrices[obBarIndex], sourceBars.ClosePrices[obBarIndex]);
            var obLow = OrderBlockUseFullWick ? sourceBars.LowPrices[obBarIndex] : Math.Min(sourceBars.OpenPrices[obBarIndex], sourceBars.ClosePrices[obBarIndex]);
            return IsZoneTouched(sourceBars, fromBarIndex, obLow, obHigh);
        }

        private void DrawOrderBlockRectangle(Bars sourceBars, string objectName, int barIndex, DateTime endTime, Color color)
        {
            var high = OrderBlockUseFullWick ? sourceBars.HighPrices[barIndex] : Math.Max(sourceBars.OpenPrices[barIndex], sourceBars.ClosePrices[barIndex]);
            var low = OrderBlockUseFullWick ? sourceBars.LowPrices[barIndex] : Math.Min(sourceBars.OpenPrices[barIndex], sourceBars.ClosePrices[barIndex]);
            var rect = Chart.DrawRectangle(objectName, sourceBars.OpenTimes[barIndex], high, endTime, low, color);
            TrySetPropertyValue(rect, "IsFilled", true);
            TrySetPropertyValue(rect, "Thickness", 1);
            TrySetPropertyValue(rect, "Color", color);
            TrySetPropertyValue(rect, "BorderColor", WithAlpha(color, 62));
            TrySetEnumPropertyValue(rect, "LineStyle", "DotsRare");
            TrySetChartObjectBackground(rect);
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

        private string DescribeTradeAvailabilityReason(string reason, string symbolName)
        {
            var resolvedSymbol = string.IsNullOrWhiteSpace(symbolName) ? "symbol" : symbolName.Trim();
            switch ((reason ?? "").Trim().ToUpperInvariant())
            {
                case "MARKET_CLOSED":
                    return resolvedSymbol + " market is closed";
                case "NO_QUOTES":
                    return resolvedSymbol + " has no live quotes";
                case "SYMBOL_TRADING_DISABLED":
                    return resolvedSymbol + " trading is disabled";
                case "SYMBOL_CLOSE_ONLY":
                    return resolvedSymbol + " is close-only right now";
                case "SYMBOL_NOT_TRADABLE":
                    return resolvedSymbol + " is not tradable right now";
                case "SYMBOL_NULL":
                    return "No tradable symbol is loaded";
                default:
                    return string.IsNullOrWhiteSpace(reason) ? resolvedSymbol + " is not tradable right now" : reason;
            }
        }

#pragma warning disable CS0618
        private TradeResult ModifyPositionCompat(Position position, double? stopLoss, double? takeProfit)
        {
            return base.ModifyPosition(position, stopLoss, takeProfit);
        }

        private TradeResult ModifyPendingOrderCompat(PendingOrder pendingOrder, double targetPrice, double? stopLossPips, double? takeProfitPips, DateTime? expirationTime)
        {
            return base.ModifyPendingOrder(pendingOrder, targetPrice, stopLossPips, takeProfitPips, expirationTime);
        }
#pragma warning restore CS0618

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

        private bool TryFitVolumeToRiskCap(
            Symbol symbol,
            TradeType tradeType,
            double entryPrice,
            double stopLossPrice,
            double requestedVolumeUnits,
            double maxRiskMoney,
            out double fittedVolumeUnits,
            out double fittedRiskMoney,
            out string note)
        {
            fittedVolumeUnits = 0;
            fittedRiskMoney = 0;
            note = "";

            if (symbol == null)
            {
                note = "symbol_missing";
                return false;
            }

            if (entryPrice <= 0 || stopLossPrice <= 0)
            {
                note = string.Format(
                    CultureInfo.InvariantCulture,
                    "invalid_entry_or_sl entry={0:F5} sl={1:F5}",
                    entryPrice,
                    stopLossPrice
                );
                return false;
            }

            if (!(maxRiskMoney > 0))
            {
                var uncapped = symbol.NormalizeVolumeInUnits(requestedVolumeUnits, RoundingMode.Down);
                fittedVolumeUnits = uncapped;
                fittedRiskMoney = EstimateRiskAmount(symbol, tradeType, entryPrice, stopLossPrice, uncapped);
                note = "risk_cap_disabled";
                return uncapped >= symbol.VolumeInUnitsMin;
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

            var tolerance = Math.Max(0.5, maxRiskMoney * 0.0025);
            var previousCandidate = double.NaN;
            while (candidate >= minVolume)
            {
                var candidateRisk = EstimateRiskAmount(symbol, tradeType, entryPrice, stopLossPrice, candidate);
                if (candidateRisk <= maxRiskMoney + tolerance)
                {
                    fittedVolumeUnits = candidate;
                    fittedRiskMoney = candidateRisk;
                    note = string.Format(
                        CultureInfo.InvariantCulture,
                        "risk_fit risk={0:F2} cap={1:F2}",
                        candidateRisk,
                        maxRiskMoney
                    );
                    return true;
                }

                previousCandidate = candidate;
                candidate -= stepVolume;
                candidate = symbol.NormalizeVolumeInUnits(candidate, RoundingMode.Down);
                if (candidate < minVolume) break;
                if (!double.IsNaN(previousCandidate) && Math.Abs(candidate - previousCandidate) < 0.0000001) break;
            }

            fittedRiskMoney = EstimateRiskAmount(symbol, tradeType, entryPrice, stopLossPrice, Math.Max(minVolume, 0));
            note = string.Format(
                CultureInfo.InvariantCulture,
                "risk_unaffordable requested={0:F2} min={1:F2} est={2:F2} cap={3:F2}",
                requestedVolumeUnits,
                minVolume,
                fittedRiskMoney,
                maxRiskMoney
            );
            return false;
        }

        private class RiskGateState
        {
            public int OpenPositionsCount;
            public int PendingOrdersCount;
            public double UsedMarginAmount;
            public double UsedMarginPercent;
            public double ExistingOpenRiskAmount;
            public double MaxSingleOpenRiskAmount;
            public double MaxSingleOpenRiskPercent;
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
            public double PossibleSlOutcomeAmount;
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
            if (_initialAccountBalance <= 0 && balance > 0)
                _initialAccountBalance = balance;
            if (balance > _peakBalanceSeen) _peakBalanceSeen = balance;
            if (equity > _peakEquitySeen) _peakEquitySeen = equity;
            if (_peakBalanceSeen <= 0) _peakBalanceSeen = balance;
            if (_peakEquitySeen <= 0) _peakEquitySeen = equity;
        }

        private enum RiskDailyLossReferenceMode
        {
            DayStartBalance,
            HigherOfDayStartBalanceOrEquity
        }

        private enum RiskDrawdownMode
        {
            StaticInitialBalance,
            EndOfDayTrailingBalance,
            BalanceTrailingCapAtInitial
        }

        private TimeZoneInfo GetFtmoTimeZone()
        {
            if (_ftmoTimeZone != null) return _ftmoTimeZone;

            string[] ids;
            switch (SelectedRiskTemplate)
            {
                case RiskTemplate.FTMO_1Step:
                case RiskTemplate.FTMO_2Step:
                    ids = new[]
                    {
                        "Europe/Prague",
                        "Central Europe Standard Time",
                        "W. Europe Standard Time"
                    };
                    break;
                case RiskTemplate.FundedNext_Stellar_2Step:
                case RiskTemplate.FundedNext_Stellar_1Step:
                case RiskTemplate.FundedNext_Stellar_Lite:
                case RiskTemplate.FTPlus_1Step_Express:
                    ids = new[]
                    {
                        "Europe/Athens",
                        "GTB Standard Time",
                        "E. Europe Standard Time"
                    };
                    break;
                case RiskTemplate.The5ers_HighStakes:
                default:
                    ids = new[]
                    {
                        "America/New_York",
                        "Eastern Standard Time"
                    };
                    break;
            }

            foreach (var id in ids)
            {
                try
                {
                    _ftmoTimeZone = TimeZoneInfo.FindSystemTimeZoneById(id);
                    if (_ftmoTimeZone != null) return _ftmoTimeZone;
                }
                catch
                {
                }
            }

            _ftmoTimeZone = TimeZoneInfo.Local;
            return _ftmoTimeZone;
        }

        private DateTime ToUtcSafe(DateTime value)
        {
            if (value.Kind == DateTimeKind.Utc) return value;
            if (value.Kind == DateTimeKind.Local) return value.ToUniversalTime();
            return DateTime.SpecifyKind(value, DateTimeKind.Local).ToUniversalTime();
        }

        private double ReadDoubleMember(object target, params string[] propertyNames)
        {
            if (target == null || propertyNames == null) return 0;
            foreach (var propertyName in propertyNames)
            {
                var raw = TryGetPropertyValue(target, propertyName);
                if (raw == null) continue;
                try
                {
                    var value = Convert.ToDouble(raw, CultureInfo.InvariantCulture);
                    if (!double.IsNaN(value) && !double.IsInfinity(value))
                        return value;
                }
                catch
                {
                }
            }
            return 0;
        }

        private DateTime ReadDateTimeMember(object target, params string[] propertyNames)
        {
            if (target == null || propertyNames == null) return DateTime.MinValue;
            foreach (var propertyName in propertyNames)
            {
                var raw = TryGetPropertyValue(target, propertyName);
                if (raw == null) continue;
                try
                {
                    if (raw is DateTime dt)
                        return ToUtcSafe(dt);

                    var parsed = DateTime.Parse(Convert.ToString(raw, CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
                    return ToUtcSafe(parsed);
                }
                catch
                {
                }
            }
            return DateTime.MinValue;
        }

        private string ReadStringMember(object target, params string[] propertyNames)
        {
            if (target == null || propertyNames == null) return "";
            foreach (var propertyName in propertyNames)
            {
                var raw = TryGetPropertyValue(target, propertyName);
                if (raw == null) continue;
                var text = Convert.ToString(raw, CultureInfo.InvariantCulture);
                if (!string.IsNullOrWhiteSpace(text))
                    return text.Trim();
            }
            return "";
        }

        private int TimeFrameToSecondsSafe(TimeFrame timeFrame)
        {
            var minutes = TimeFrameToMinutes(timeFrame);
            if (minutes > 0)
                return minutes * 60;
            return 60;
        }

        private string Make42TradeBacktestRunId()
        {
            return string.Format(
                CultureInfo.InvariantCulture,
                "bt-{0}-{1}-{2}-{3}",
                DateTime.UtcNow.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture),
                SafePathPart(SymbolName, "SYMBOL"),
                SafePathPart(GetBacktestTfStorageLabel(), "tf"),
                Guid.NewGuid().ToString("N").Substring(0, 8));
        }

        private string Make42TradeTradeSid(string runId, string ticket, int index)
        {
            var core = !string.IsNullOrWhiteSpace(ticket) ? ticket.Trim() : index.ToString(CultureInfo.InvariantCulture);
            return "BT" + SafePathPart(runId + "_" + core, "trade").ToUpperInvariant();
        }

        private void StartBacktestExportSession()
        {
            if (!IsBacktestingRuntime() || _backtestExportActive)
                return;

            _backtestExportUserId = DefaultBacktestUserId;
            _backtestExportStrategyKey = GetBacktestStrategyStorageKey();
            _backtestExportStrategyName = GetBacktestStrategyDisplayName();
            _backtestExportRunId = Make42TradeBacktestRunId();
            _backtestExportRunDir = Path.Combine(
                Get42TradeUserRootPath(_backtestExportUserId),
                "strategies",
                SafePathPart(_backtestExportStrategyKey, "default"),
                "runs",
                SafePathPart(_backtestExportRunId, "default"));
            _backtestExportStartedUtc = DateTime.UtcNow;
            _backtestExportInitialEquity = !double.IsNaN(Account.Equity) ? Account.Equity : 0;
            _backtestExportInitialBalance = !double.IsNaN(Account.Balance) ? Account.Balance : _backtestExportInitialEquity;
            _backtestExportTradeSnapshots.Clear();
            _backtestExportTradeSequence.Clear();
            _backtestExportActive = true;

            try
            {
                Directory.CreateDirectory(_backtestExportRunDir);
                var runningManifest = Build42TradeBacktestManifest("running", null, null);
                WriteJsonAtomic(Path.Combine(_backtestExportRunDir, "manifest.json"), runningManifest);
                WriteJsonAtomic(Path.Combine(_backtestExportRunDir, "summary.json"), new Dictionary<string, object>());
                WriteJsonAtomic(Path.Combine(_backtestExportRunDir, "trades.json"), new List<object>());
                WriteJsonAtomic(Path.Combine(_backtestExportRunDir, "events.json"), new List<object>());
                SafePrint("[BacktestExport] Session started run_id={0} dir={1}", _backtestExportRunId, _backtestExportRunDir);
            }
            catch (Exception ex)
            {
                SafePrint("[BacktestExport] Start failed: {0}", ex.Message);
            }
        }

        private Dictionary<string, object> Build42TradeStrategySnapshot()
        {
            return new Dictionary<string, object>
            {
                { "kind", "ctrader_backtest" },
                { "key", _backtestExportStrategyKey },
                { "id", null },
                { "name", _backtestExportStrategyName },
                { "description", "Exported from cTrader backtesting session" },
                { "engine_version", "ctrader.backtest.v1" },
                { "params", new Dictionary<string, object>
                    {
                        { "live_trade_mode", EnableLiveStrategyTrading },
                        { "strategy_slots", GetConfiguredStrategyModes().Select(GetBacktestStrategyModeDisplayName).ToArray() },
                        { "strategy_symbol", string.Join(",", ResolveSharedStrategySymbols(Symbol != null ? Symbol.Name : "")) },
                        { "strategy_timeframe", string.Join(",", ResolveSharedStrategyTimeFrames(Chart != null ? Chart.TimeFrame : TimeFrame.Minute).Select(GetMiniChartLabel).ToArray()) },
                        { "strategy_days", StrategyDaysPresetValue.ToString() },
                        { "strategy_sessions", StrategySessionsPresetValue.ToString() },
                        { "strategy_trade_risk", GetEffectiveMaxRiskPercent() },
                        { "follow_trend_candles_num", FollowTrendCandlesCount },
                        { "follow_trend_sl_candle_num", FollowTrendSlCandleNum },
                        { "strategy_entry_type", SelectedStrategyEntryType.ToString() },
                        { "strategy_rr", StrategyRewardRisk },
                        { "follow_trend_rr", StrategyRewardRisk }
                    }
                },
                { "indicators", new List<object>() },
                { "events", new List<object>() },
                { "rules", new Dictionary<string, object>() },
                { "risk", new Dictionary<string, object>
                    {
                        { "risk_template", SelectedRiskTemplate.ToString() },
                        { "max_risk_percent", GetEffectiveMaxRiskPercent() },
                        { "max_open_risk_percent", GetEffectiveMaxTotalOpenRiskPercent() },
                        { "max_day_loss_percent", GetEffectiveMaxDailyLossPercent() },
                        { "max_dd_percent", GetEffectiveMaxEquityDrawdownPercent() }
                    }
                }
            };
        }

        private Dictionary<string, object> Build42TradeExecutionOptions()
        {
            return new Dictionary<string, object>
            {
                { "initialEquity", _backtestExportInitialEquity },
                { "riskPercent", GetEffectiveMaxRiskPercent() },
                { "fixedRiskAmount", null },
                { "compoundEquity", false },
                { "spreadAbs", 0 },
                { "spreadBps", 0 },
                { "commissionFlat", 0 },
                { "commissionPerUnit", 0 },
                { "breakEvenAtR", null },
                { "partialAtR", null },
                { "partialCloseFraction", 1.0 },
                { "maxBarsInTrade", 0 },
                { "brokerCalibration", null },
                { "pipSize", Symbol != null ? Symbol.PipSize : 0 },
                { "lotSize", Symbol != null ? Symbol.LotSize : 0 },
                { "volumeStepUnits", Symbol != null ? Symbol.VolumeInUnitsStep : 0 },
                { "minVolumeUnits", Symbol != null ? Symbol.VolumeInUnitsMin : 0 },
                { "maxVolumeUnits", Symbol != null ? Symbol.VolumeInUnitsMax : 0 },
                { "trailStages", new List<object>() },
                { "commissionPerLot", 0 }
            };
        }

        private string Build42TradeBacktestRunLabel(DateTime firstBarUtc, DateTime lastBarUtc)
        {
            var strategyLabel = string.IsNullOrWhiteSpace(_backtestExportStrategyName) ? "Backtest" : _backtestExportStrategyName.Trim();
            var tfLabel = GetBacktestTfStorageLabel();
            var symbolLabel = string.IsNullOrWhiteSpace(SymbolName) ? "-" : SymbolName.Trim().ToUpperInvariant();
            var startLabel = firstBarUtc != DateTime.MinValue ? firstBarUtc.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) : "";
            var endLabel = lastBarUtc != DateTime.MinValue ? lastBarUtc.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) : "";
            var rangeLabel = !string.IsNullOrWhiteSpace(startLabel) && !string.IsNullOrWhiteSpace(endLabel)
                ? startLabel + " -> " + endLabel
                : startLabel + endLabel;
            return string.IsNullOrWhiteSpace(rangeLabel)
                ? string.Format(CultureInfo.InvariantCulture, "{0} - {1} - {2}", strategyLabel, tfLabel, symbolLabel)
                : string.Format(CultureInfo.InvariantCulture, "{0} - {1} - {2} - {3}", strategyLabel, tfLabel, symbolLabel, rangeLabel);
        }

        private Dictionary<string, object> Build42TradeBacktestManifest(string status, Dictionary<string, object> summary, Dictionary<string, object> marketDataQuality)
        {
            var firstBarAt = summary != null && summary.ContainsKey("first_bar_at")
                ? Convert.ToString(summary["first_bar_at"], CultureInfo.InvariantCulture)
                : null;
            var lastBarAt = summary != null && summary.ContainsKey("last_bar_at")
                ? Convert.ToString(summary["last_bar_at"], CultureInfo.InvariantCulture)
                : null;
            var displayName = summary != null && summary.ContainsKey("run_label")
                ? Convert.ToString(summary["run_label"], CultureInfo.InvariantCulture)
                : Build42TradeBacktestRunLabel(DateTime.MinValue, DateTime.MinValue);
            return new Dictionary<string, object>
            {
                { "run_id", _backtestExportRunId },
                { "user_id", _backtestExportUserId },
                { "symbol", string.IsNullOrWhiteSpace(SymbolName) ? "" : SymbolName.Trim().ToUpperInvariant() },
                { "tf", GetBacktestTfStorageLabel() },
                { "display_name", displayName },
                { "limit", 0 },
                { "status", status },
                { "strategy_key", _backtestExportStrategyKey },
                { "strategy_id", null },
                { "strategy_name", _backtestExportStrategyName },
                { "selection", new Dictionary<string, object>
                    {
                        { "strategy_ids", new List<object> { _backtestExportStrategyKey, _backtestExportStrategyName } },
                        { "timeframes", new List<object> { GetBacktestTfStorageLabel() } },
                        { "symbols", new List<object> { string.IsNullOrWhiteSpace(SymbolName) ? "" : SymbolName.Trim().ToUpperInvariant() } }
                    }
                },
                { "strategy_snapshot", Build42TradeStrategySnapshot() },
                { "market_data_quality", marketDataQuality ?? new Dictionary<string, object>() },
                { "broker_calibration", null },
                { "execution_options", Build42TradeExecutionOptions() },
                { "started_at", _backtestExportStartedUtc == DateTime.MinValue ? DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture) : _backtestExportStartedUtc.ToString("O", CultureInfo.InvariantCulture) },
                { "updated_at", DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture) },
                { "completed_at", string.Equals(status, "completed", StringComparison.OrdinalIgnoreCase) ? DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture) : null },
                { "first_bar_at", firstBarAt },
                { "last_bar_at", lastBarAt },
                { "ephemeral", false },
                { "summary", summary }
            };
        }

        private Tuple<List<object>, List<object>, Dictionary<string, object>> Build42TradeBacktestArtifacts()
        {
            var trades = new List<object>();
            var events = new List<object>();
            var equityCurve = new List<object>();
            var orderedSnapshots = _backtestExportTradeSequence
                .OrderBy(x => x.SignalTime == DateTime.MinValue ? DateTime.MaxValue : x.SignalTime)
                .ToList();
            var usedSnapshotIndexes = new HashSet<int>();
            var closed = History != null
                ? History.OrderBy(h => ReadDateTimeMember(h, "ClosingTime", "CloseTime", "Time")).ToList()
                : new List<HistoricalTrade>();

            var firstBarUtc = Bars != null && Bars.Count > 0 ? ToUtcSafe(Bars.OpenTimes[0]) : _backtestExportStartedUtc;
            var lastBarUtc = Bars != null && Bars.Count > 0 ? ToUtcSafe(Bars.OpenTimes[Bars.Count - 1]) : DateTime.UtcNow;
            var tfSeconds = TimeFrameToSecondsSafe(Chart != null ? Chart.TimeFrame : TimeFrame.Minute);
            var equityBefore = _backtestExportInitialEquity > 0 ? _backtestExportInitialEquity : _backtestExportInitialBalance;
            if (equityBefore <= 0) equityBefore = !double.IsNaN(Account.Balance) ? Account.Balance : 10000;
            equityCurve.Add(new Dictionary<string, object>
            {
                { "time", (long)Math.Floor((firstBarUtc - new DateTime(1970, 1, 1)).TotalSeconds) },
                { "equity", equityBefore }
            });

            var wins = 0;
            var losses = 0;
            var flats = 0;
            double totalPnl = 0;
            double totalR = 0;
            double peakEquity = equityBefore;
            double maxDrawdownPct = 0;

            for (var i = 0; i < closed.Count; i++)
            {
                var deal = closed[i];
                if (deal == null) continue;

                var symbolName = !string.IsNullOrWhiteSpace(deal.SymbolName) ? deal.SymbolName : SymbolName;
                var symbol = ResolveLoadedSymbol(symbolName) ?? Symbol;
                var ticket = Convert.ToString(deal.PositionId, CultureInfo.InvariantCulture);
                var plannedSnapshot = default(BacktestExportTradeSnapshot);
                var hasPlannedSnapshot = !string.IsNullOrWhiteSpace(ticket) && _backtestExportTradeSnapshots.TryGetValue(ticket.Trim(), out plannedSnapshot);
                var action = deal.TradeType == TradeType.Buy ? "BUY" : "SELL";
                var historyEntryPrice = ReadDoubleMember(deal, "EntryPrice", "OpeningPrice");
                var exitPrice = ReadDoubleMember(deal, "ClosingPrice", "ClosePrice", "ExitPrice");
                var openedAtUtc = ReadDateTimeMember(deal, "EntryTime", "OpeningTime", "OpenTime");
                var closedAtUtc = ReadDateTimeMember(deal, "ClosingTime", "CloseTime", "Time");
                if (openedAtUtc == DateTime.MinValue) openedAtUtc = closedAtUtc != DateTime.MinValue ? closedAtUtc.AddSeconds(-tfSeconds) : _backtestExportStartedUtc;
                if (closedAtUtc == DateTime.MinValue) closedAtUtc = openedAtUtc;
                var quantity = !double.IsNaN(deal.VolumeInUnits) ? deal.VolumeInUnits : 0;
                if (!hasPlannedSnapshot)
                {
                    var snapshotIndex = FindBacktestExportTradeSnapshotIndex(
                        orderedSnapshots,
                        usedSnapshotIndexes,
                        deal.TradeType,
                        openedAtUtc,
                        historyEntryPrice,
                        quantity);
                    if (snapshotIndex >= 0 && snapshotIndex < orderedSnapshots.Count)
                    {
                        plannedSnapshot = orderedSnapshots[snapshotIndex];
                        hasPlannedSnapshot = true;
                        usedSnapshotIndexes.Add(snapshotIndex);
                    }
                }
                var entryPrice = hasPlannedSnapshot && plannedSnapshot.EntryPrice > 0
                    ? plannedSnapshot.EntryPrice
                    : historyEntryPrice;
                var stopLoss = hasPlannedSnapshot && plannedSnapshot.StopLoss > 0
                    ? plannedSnapshot.StopLoss
                    : ReadDoubleMember(deal, "StopLoss");
                var takeProfit = hasPlannedSnapshot && plannedSnapshot.TakeProfit > 0
                    ? plannedSnapshot.TakeProfit
                    : ReadDoubleMember(deal, "TakeProfit");
                if (hasPlannedSnapshot && plannedSnapshot.VolumeInUnits > 0)
                    quantity = plannedSnapshot.VolumeInUnits;
                var estimatedLots = hasPlannedSnapshot && plannedSnapshot.VolumeLots > 0
                    ? plannedSnapshot.VolumeLots
                    : (symbol != null ? symbol.VolumeInUnitsToQuantity(quantity) : quantity / 100000.0);
                var commission = !double.IsNaN(deal.Commissions) ? deal.Commissions : 0;
                var swap = !double.IsNaN(deal.Swap) ? deal.Swap : 0;
                var pnlRealized = !double.IsNaN(deal.NetProfit) ? deal.NetProfit : 0;
                var pnlGross = pnlRealized - commission - swap;
                var riskAmount = hasPlannedSnapshot && plannedSnapshot.RiskAmount > 0 ? plannedSnapshot.RiskAmount : 0.0;
                if (!(riskAmount > 0) && symbol != null && entryPrice > 0 && stopLoss > 0 && quantity > 0)
                    riskAmount = Math.Abs(EstimateRiskAmount(symbol, deal.TradeType, entryPrice, stopLoss, quantity));
                var riskPercent = hasPlannedSnapshot && plannedSnapshot.RiskPercent > 0
                    ? plannedSnapshot.RiskPercent
                    : (equityBefore > 0 && riskAmount > 0 ? (riskAmount / equityBefore) * 100.0 : 0.0);
                var rMultiple = riskAmount > 0 ? pnlRealized / riskAmount : 0.0;
                var plannedRewardRisk = hasPlannedSnapshot && plannedSnapshot.RewardRisk > 0
                    ? plannedSnapshot.RewardRisk
                    : ((entryPrice > 0 && stopLoss > 0 && takeProfit > 0)
                        ? Math.Abs(takeProfit - entryPrice) / Math.Max(0.0000001, Math.Abs(entryPrice - stopLoss))
                        : 0.0);
                var equityAfter = equityBefore + pnlRealized;
                var result = pnlRealized > 0 ? "win" : pnlRealized < 0 ? "loss" : "flat";
                if (result == "win") wins++;
                else if (result == "loss") losses++;
                else flats++;
                totalPnl += pnlRealized;
                totalR += rMultiple;
                peakEquity = Math.Max(peakEquity, equityAfter);
                if (peakEquity > 0)
                {
                    var ddPct = ((equityAfter - peakEquity) / peakEquity) * 100.0;
                    if (ddPct < maxDrawdownPct)
                        maxDrawdownPct = ddPct;
                }

                var openUnix = (long)Math.Floor((openedAtUtc - new DateTime(1970, 1, 1)).TotalSeconds);
                var closeUnix = (long)Math.Floor((closedAtUtc - new DateTime(1970, 1, 1)).TotalSeconds);
                var entryBarIndex = Bars != null && Bars.Count > 0
                    ? Math.Max(0, (int)Math.Round((openedAtUtc - firstBarUtc).TotalSeconds / Math.Max(1, tfSeconds)))
                    : i;
                var exitBarIndex = Bars != null && Bars.Count > 0
                    ? Math.Max(entryBarIndex, (int)Math.Round((closedAtUtc - firstBarUtc).TotalSeconds / Math.Max(1, tfSeconds)))
                    : entryBarIndex;
                var barsHeld = Math.Max(0, exitBarIndex - entryBarIndex);
                var exitReason = ReadStringMember(deal, "ClosingReason", "CloseReason", "Reason");
                if (string.IsNullOrWhiteSpace(exitReason))
                {
                    var tolerance = symbol != null && symbol.PipSize > 0 ? symbol.PipSize * 1.5 : 0.00001;
                    if (takeProfit > 0 && Math.Abs(exitPrice - takeProfit) <= tolerance) exitReason = "tp";
                    else if (stopLoss > 0 && Math.Abs(exitPrice - stopLoss) <= tolerance) exitReason = "sl";
                    else exitReason = "manual";
                }

                var tradePlan = new Dictionary<string, object>
                {
                    { "entry", entryPrice },
                    { "entry_price", entryPrice },
                    { "sl", stopLoss },
                    { "stop_loss", stopLoss },
                    { "tp", takeProfit },
                    { "tp1", takeProfit },
                    { "take_profit", takeProfit },
                    { "rr", Math.Round(plannedRewardRisk, 5) },
                    { "risk_reward", Math.Round(plannedRewardRisk, 5) },
                    { "risk_money", Math.Round(riskAmount, 5) },
                    { "risk_percent", Math.Round(riskPercent, 5) },
                    { "lots", Math.Round(estimatedLots, 5) },
                    { "volume_units", Math.Round(quantity, 5) }
                };

                trades.Add(new Dictionary<string, object>
                {
                    { "sid", Make42TradeTradeSid(_backtestExportRunId, ticket, i) },
                    { "action", action },
                    { "strategy", hasPlannedSnapshot && !string.IsNullOrWhiteSpace(plannedSnapshot.StrategyId) ? plannedSnapshot.StrategyId : _backtestExportStrategyName },
                    { "entry", entryPrice },
                    { "entry_fill", entryPrice },
                    { "sl", stopLoss },
                    { "tp", takeProfit },
                    { "tp1", takeProfit },
                    { "created_at", openedAtUtc.ToString("O", CultureInfo.InvariantCulture) },
                    { "opened_at", openedAtUtc.ToString("O", CultureInfo.InvariantCulture) },
                    { "closed_at", closedAtUtc.ToString("O", CultureInfo.InvariantCulture) },
                    { "signal_bar_time", openedAtUtc.ToString("O", CultureInfo.InvariantCulture) },
                    { "exit_price", exitPrice },
                    { "exit_price_raw", exitPrice },
                    { "pnl_realized", pnlRealized },
                    { "pnl_gross", pnlGross },
                    { "commission_paid", commission },
                    { "bars_held", barsHeld },
                    { "entry_bar_index", entryBarIndex },
                    { "exit_bar_index", exitBarIndex },
                    { "entry_time_unix", openUnix },
                    { "exit_time_unix", closeUnix },
                    { "exit_reason", exitReason.ToLowerInvariant() },
                    { "result", result },
                    { "quantity", quantity },
                    { "estimated_lots", estimatedLots },
                    { "risk_amount", riskAmount },
                    { "risk_percent", riskPercent },
                    { "r_multiple", Math.Round(rMultiple, 5) },
                    { "realized_r", Math.Round(rMultiple, 5) },
                    { "rr_planned", Math.Round(plannedRewardRisk, 5) },
                    { "meta", new Dictionary<string, object>
                        {
                            { "strategy", hasPlannedSnapshot && !string.IsNullOrWhiteSpace(plannedSnapshot.StrategyId) ? plannedSnapshot.StrategyId : _backtestExportStrategyName },
                            { "trade_plan", tradePlan },
                            { "broker_data", new Dictionary<string, object>
                                {
                                    { "entry", entryPrice },
                                    { "sl", stopLoss },
                                    { "tp", takeProfit },
                                    { "lots", estimatedLots }
                                }
                            }
                        }
                    },
                    { "spread_amount", 0 },
                    { "spread_cost", 0 },
                    { "account_equity_before", equityBefore },
                    { "account_equity_after", equityAfter },
                    { "closed_fractions", new List<object>
                        {
                            new Dictionary<string, object>
                            {
                                { "fraction", 1 },
                                { "exit_reason", exitReason.ToLowerInvariant() },
                                { "exit_price_raw", exitPrice },
                                { "exit_price_fill", exitPrice },
                                { "quantity", quantity },
                                { "pnl_gross", pnlGross },
                                { "pnl_net", pnlRealized },
                                { "r_multiple", Math.Round(rMultiple, 5) },
                                { "bar_index", exitBarIndex },
                                { "time_unix", closeUnix }
                            }
                        }
                    },
                    { "break_even_armed", false },
                    { "partial_taken", false },
                    { "trailing_stop_updates", new List<object>() }
                });

                events.Add(new Dictionary<string, object>
                {
                    { "event_id", action == "BUY" ? "entry_long" : "entry_short" },
                    { "event_name", action == "BUY" ? "Entry Long" : "Entry Short" },
                    { "action_id", action == "BUY" ? "open_long" : "open_short" },
                    { "action_type", action == "BUY" ? "trade.open.long" : "trade.open.short" },
                    { "message", "" },
                    { "url", "" },
                    { "method", "" },
                    { "symbol", string.IsNullOrWhiteSpace(symbolName) ? "" : symbolName.Trim().ToUpperInvariant() },
                    { "tf", GetBacktestTfStorageLabel() },
                    { "bar_index", entryBarIndex },
                    { "bar_time_unix", openUnix },
                    { "bar_time", openedAtUtc.ToString("O", CultureInfo.InvariantCulture) },
                    { "bar_close", entryPrice }
                });

                equityCurve.Add(new Dictionary<string, object>
                {
                    { "time", closeUnix },
                    { "equity", equityAfter }
                });

                equityBefore = equityAfter;
            }

            var totalTrades = trades.Count;
            var runLabel = Build42TradeBacktestRunLabel(firstBarUtc, lastBarUtc);
            var completedAtUtc = DateTime.UtcNow;
            var summary = new Dictionary<string, object>
            {
                { "run_id", _backtestExportRunId },
                { "run_label", runLabel },
                { "symbol", string.IsNullOrWhiteSpace(SymbolName) ? "" : SymbolName.Trim().ToUpperInvariant() },
                { "tf", GetBacktestTfStorageLabel() },
                { "strategy_display", _backtestExportStrategyName },
                { "bars_analyzed", Bars != null ? Bars.Count : 0 },
                { "total_trades", totalTrades },
                { "positions", totalTrades },
                { "generated_signals", totalTrades },
                { "triggered_events", events.Count },
                { "triggered_actions", totalTrades },
                { "wins", wins },
                { "losses", losses },
                { "flats", flats },
                { "win_rate_pct", totalTrades > 0 ? Math.Round((wins * 100.0) / totalTrades, 2) : 0 },
                { "wr", totalTrades > 0 ? Math.Round((wins * 100.0) / totalTrades, 2) : 0 },
                { "total_pnl", Math.Round(totalPnl, 5) },
                { "average_pnl", totalTrades > 0 ? Math.Round(totalPnl / totalTrades, 5) : 0 },
                { "total_realized_r", Math.Round(totalR, 5) },
                { "average_realized_r", totalTrades > 0 ? Math.Round(totalR / totalTrades, 5) : 0 },
                { "total_planned_outcome_r", Math.Round(totalR, 5) },
                { "average_planned_outcome_r", totalTrades > 0 ? Math.Round(totalR / totalTrades, 5) : 0 },
                { "total_r", Math.Round(totalR, 5) },
                { "average_r", totalTrades > 0 ? Math.Round(totalR / totalTrades, 5) : 0 },
                { "strategy_key", _backtestExportStrategyKey },
                { "strategy_id", null },
                { "strategy_name", _backtestExportStrategyName },
                { "initial_equity", _backtestExportInitialEquity > 0 ? _backtestExportInitialEquity : _backtestExportInitialBalance },
                { "final_equity", equityBefore },
                { "max_drawdown_pct", Math.Round(maxDrawdownPct, 5) },
                { "started_at", _backtestExportStartedUtc == DateTime.MinValue ? null : _backtestExportStartedUtc.ToString("O", CultureInfo.InvariantCulture) },
                { "completed_at", completedAtUtc.ToString("O", CultureInfo.InvariantCulture) },
                { "first_bar_at", firstBarUtc != DateTime.MinValue ? firstBarUtc.ToString("O", CultureInfo.InvariantCulture) : null },
                { "last_bar_at", lastBarUtc != DateTime.MinValue ? lastBarUtc.ToString("O", CultureInfo.InvariantCulture) : null },
                { "range", new Dictionary<string, object>
                    {
                        { "start", firstBarUtc != DateTime.MinValue ? firstBarUtc.ToString("O", CultureInfo.InvariantCulture) : null },
                        { "end", lastBarUtc != DateTime.MinValue ? lastBarUtc.ToString("O", CultureInfo.InvariantCulture) : null }
                    }
                },
                { "params", Build42TradeStrategySnapshot() },
                { "execution_options", Build42TradeExecutionOptions() },
                { "market_data_quality", new Dictionary<string, object>
                    {
                        { "input_rows", Bars != null ? Bars.Count : 0 },
                        { "output_rows", Bars != null ? Bars.Count : 0 },
                        { "dropped_invalid_rows", 0 },
                        { "duplicate_timestamps", 0 },
                        { "non_monotonic_input", 0 },
                        { "corrected_ohlc_rows", 0 },
                        { "gap_count", 0 },
                        { "expected_tf_seconds", tfSeconds }
                    }
                },
                { "equity_curve", equityCurve }
            };

            return Tuple.Create(trades, events, summary);
        }

        private void FinalizeBacktestExportSession()
        {
            if (!_backtestExportActive || string.IsNullOrWhiteSpace(_backtestExportRunDir))
                return;

            try
            {
                var artifacts = Build42TradeBacktestArtifacts();
                var trades = artifacts.Item1;
                var events = artifacts.Item2;
                var summary = artifacts.Item3;
                var marketDataQuality = summary.ContainsKey("market_data_quality")
                    ? summary["market_data_quality"] as Dictionary<string, object>
                    : null;
                var manifest = Build42TradeBacktestManifest("completed", summary, marketDataQuality);
                WriteJsonAtomic(Path.Combine(_backtestExportRunDir, "manifest.json"), manifest);
                WriteJsonAtomic(Path.Combine(_backtestExportRunDir, "summary.json"), summary);
                WriteJsonAtomic(Path.Combine(_backtestExportRunDir, "trades.json"), trades);
                WriteJsonAtomic(Path.Combine(_backtestExportRunDir, "events.json"), events);
                SafePrint("[BacktestExport] Session completed run_id={0} trades={1} dir={2}", _backtestExportRunId, trades.Count, _backtestExportRunDir);
            }
            catch (Exception ex)
            {
                SafePrint("[BacktestExport] Finalize failed: {0}", ex.Message);
            }
        }

        private DateTime GetFtmoDayStartUtc(DateTime utcNow)
        {
            var tz = GetFtmoTimeZone();
            var ftmoNow = TimeZoneInfo.ConvertTimeFromUtc(utcNow, tz);
            var ftmoStartLocal = ftmoNow.Date;
            return TimeZoneInfo.ConvertTimeToUtc(ftmoStartLocal, tz);
        }

        private double GetPercentAmountFromInitialBalance(double percent)
        {
            if (percent <= 0 || _initialAccountBalance <= 0) return 0;
            return _initialAccountBalance * (percent / 100.0);
        }

        private RiskDailyLossReferenceMode GetRiskDailyLossReferenceMode()
        {
            return GetRiskDailyLossReferenceMode(SelectedRiskTemplate);
        }

        private RiskDailyLossReferenceMode GetRiskDailyLossReferenceMode(RiskTemplate template)
        {
            switch (template)
            {
                case RiskTemplate.The5ers_HighStakes:
                    return RiskDailyLossReferenceMode.HigherOfDayStartBalanceOrEquity;
                default:
                    return RiskDailyLossReferenceMode.DayStartBalance;
            }
        }

        private double ResolveDailyLossReferenceAmount(double dayStartBalance, double dayStartEquity)
        {
            switch (GetRiskDailyLossReferenceMode())
            {
                case RiskDailyLossReferenceMode.HigherOfDayStartBalanceOrEquity:
                    return Math.Max(dayStartBalance, dayStartEquity);
                default:
                    return dayStartBalance;
            }
        }

        private RiskDrawdownMode GetRiskDrawdownMode()
        {
            return GetRiskDrawdownMode(SelectedRiskTemplate);
        }

        private RiskDrawdownMode GetRiskDrawdownMode(RiskTemplate template)
        {
            switch (template)
            {
                case RiskTemplate.FTMO_1Step:
                    return RiskDrawdownMode.EndOfDayTrailingBalance;
                case RiskTemplate.FTPlus_1Step_Express:
                    return RiskDrawdownMode.BalanceTrailingCapAtInitial;
                default:
                    return RiskDrawdownMode.StaticInitialBalance;
            }
        }

        private string GetRiskDrawdownModeLabel(RiskTemplate template)
        {
            switch (GetRiskDrawdownMode(template))
            {
                case RiskDrawdownMode.EndOfDayTrailingBalance:
                    return "EOD Trail";
                case RiskDrawdownMode.BalanceTrailingCapAtInitial:
                    return "Bal Trail";
                default:
                    return "Static";
            }
        }

        private double GetEffectiveMaxRiskPercent()
        {
            return GetEffectiveMaxRiskPercent(SelectedRiskTemplate);
        }

        private double GetEffectiveMaxRiskPercent(RiskTemplate template)
        {
            var configuredRiskPercent = Math.Max(0.0, MaxRiskPercent);
            switch (template)
            {
                default:
                    return configuredRiskPercent;
            }
        }

        private double GetEffectiveMaxTotalOpenRiskPercent()
        {
            return GetEffectiveMaxTotalOpenRiskPercent(SelectedRiskTemplate);
        }

        private double GetEffectiveMaxTotalOpenRiskPercent(RiskTemplate template)
        {
            return Math.Max(0.0, MaxTotalOpenRiskPercent);
        }

        private double GetEffectiveMaxDailyLossPercent()
        {
            return GetEffectiveMaxDailyLossPercent(SelectedRiskTemplate);
        }

        private double GetEffectiveMaxDailyLossPercent(RiskTemplate template)
        {
            switch (template)
            {
                case RiskTemplate.FTMO_1Step:
                case RiskTemplate.FundedNext_Stellar_1Step:
                    return 3.0;
                case RiskTemplate.FTMO_2Step:
                case RiskTemplate.The5ers_HighStakes:
                case RiskTemplate.FundedNext_Stellar_2Step:
                    return 5.0;
                case RiskTemplate.FundedNext_Stellar_Lite:
                case RiskTemplate.FTPlus_1Step_Express:
                    return 4.0;
                default:
                    return MaxDailyLossPercent;
            }
        }

        private double GetEffectiveMaxEquityDrawdownPercent()
        {
            return GetEffectiveMaxEquityDrawdownPercent(SelectedRiskTemplate);
        }

        private double GetEffectiveMaxEquityDrawdownPercent(RiskTemplate template)
        {
            switch (template)
            {
                case RiskTemplate.FTMO_1Step:
                case RiskTemplate.FTMO_2Step:
                case RiskTemplate.The5ers_HighStakes:
                case RiskTemplate.FundedNext_Stellar_2Step:
                    return 10.0;
                case RiskTemplate.FundedNext_Stellar_1Step:
                case RiskTemplate.FTPlus_1Step_Express:
                    return 6.0;
                case RiskTemplate.FundedNext_Stellar_Lite:
                    return 8.0;
                default:
                    return MaxEquityDrawdownPercent;
            }
        }

        private double GetEffectiveMaxSameSymbolDirectionRiskPercent()
        {
            return GetEffectiveMaxSameSymbolDirectionRiskPercent(SelectedRiskTemplate);
        }

        private double GetEffectiveMaxSameSymbolDirectionRiskPercent(RiskTemplate template)
        {
            return Math.Max(0.0, MaxSameSymbolDirectionRiskPercent);
        }

        private string GetRiskSameDirectionLimitLabel(RiskTemplate template)
        {
            var value = GetEffectiveMaxSameSymbolDirectionRiskPercent(template);
            return value > 0
                ? string.Format(CultureInfo.InvariantCulture, "{0}%", FormatDashboardPercent(value))
                : "OFF";
        }

        private bool GetEffectiveHighImpactNewsBlockEnabled(RiskTemplate template)
        {
            return SelectedNewsBlockPreset != NewsBlockPreset.No;
        }

        private int GetConfiguredNewsBlockMinutes()
        {
            switch (SelectedNewsBlockPreset)
            {
                case NewsBlockPreset._30m:
                    return 30;
                case NewsBlockPreset._60m:
                    return 60;
                case NewsBlockPreset._90m:
                    return 90;
                case NewsBlockPreset._120m:
                    return 120;
                default:
                    return 0;
            }
        }

        private int GetEffectiveNewsBlockBeforeMinutes(RiskTemplate template)
        {
            return Math.Max(0, GetConfiguredNewsBlockMinutes());
        }

        private int GetEffectiveNewsBlockDuringMinutes(RiskTemplate template)
        {
            return Math.Max(0, GetConfiguredNewsBlockMinutes());
        }

        private string GetRiskNewsLimitLabel(RiskTemplate template)
        {
            if (!GetEffectiveHighImpactNewsBlockEnabled(template))
                return "OFF";
            return string.Format(
                CultureInfo.InvariantCulture,
                "{0}/{1}m",
                GetEffectiveNewsBlockBeforeMinutes(template),
                GetEffectiveNewsBlockDuringMinutes(template));
        }

        private bool GetEffectiveNoOvernightHold(RiskTemplate template)
        {
            return NoOvernightHold;
        }

        private string GetRiskOvernightLimitLabel(RiskTemplate template)
        {
            return GetEffectiveNoOvernightHold(template) ? "BLOCK" : "ALLOW";
        }

        private bool GetEffectiveNoWeekendHold(RiskTemplate template)
        {
            return NoWeekendHold;
        }

        private string GetRiskWeekendLimitLabel(RiskTemplate template)
        {
            return GetEffectiveNoWeekendHold(template) ? "BLOCK" : "ALLOW";
        }

        private bool TryGetOvernightGateRejectReason(RiskTemplate template, out string rejectReason)
        {
            rejectReason = "";
            if (!GetEffectiveNoOvernightHold(template))
                return false;

            var riskNow = GetRiskReferenceNow();
            var localNyClose = new TimeSpan(17, 0, 0);
            if (riskNow.TimeOfDay < localNyClose)
                return false;

            rejectReason = string.Format(
                CultureInfo.InvariantCulture,
                "overnight_block ref_time={0}; tz={1}",
                riskNow.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture),
                GetRiskReferenceTimeZone().StandardName);
            return true;
        }

        private bool TryGetWeekendGateRejectReason(RiskTemplate template, out string rejectReason)
        {
            rejectReason = "";
            if (!GetEffectiveNoWeekendHold(template))
                return false;

            var riskNow = GetRiskReferenceNow();
            if (riskNow.DayOfWeek == DayOfWeek.Saturday || riskNow.DayOfWeek == DayOfWeek.Sunday)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "weekend_block ref_time={0}; tz={1}",
                    riskNow.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture),
                    GetRiskReferenceTimeZone().StandardName);
                return true;
            }

            var localNyClose = new TimeSpan(17, 0, 0);
            if (riskNow.DayOfWeek == DayOfWeek.Friday && riskNow.TimeOfDay >= localNyClose)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "weekend_block ref_time={0}; tz={1}",
                    riskNow.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture),
                    GetRiskReferenceTimeZone().StandardName);
                return true;
            }

            return false;
        }

        private List<string> ExtractTopLevelJsonObjectsFromArray(string json, string arrayKey)
        {
            var result = new List<string>();
            if (string.IsNullOrWhiteSpace(json) || string.IsNullOrWhiteSpace(arrayKey))
                return result;

            var keyIndex = json.IndexOf("\"" + arrayKey + "\"", StringComparison.OrdinalIgnoreCase);
            if (keyIndex < 0)
                return result;

            var arrayStart = json.IndexOf('[', keyIndex);
            if (arrayStart < 0)
                return result;

            var depth = 0;
            var objectStart = -1;
            var inString = false;
            var isEscaped = false;
            for (var i = arrayStart + 1; i < json.Length; i++)
            {
                var ch = json[i];
                if (inString)
                {
                    if (isEscaped)
                    {
                        isEscaped = false;
                    }
                    else if (ch == '\\')
                    {
                        isEscaped = true;
                    }
                    else if (ch == '"')
                    {
                        inString = false;
                    }
                    continue;
                }

                if (ch == '"')
                {
                    inString = true;
                    continue;
                }

                if (ch == '[' && depth == 0 && objectStart < 0)
                    continue;

                if (ch == '{')
                {
                    if (depth == 0)
                        objectStart = i;
                    depth++;
                    continue;
                }

                if (ch == '}')
                {
                    if (depth > 0)
                    {
                        depth--;
                        if (depth == 0 && objectStart >= 0)
                        {
                            result.Add(json.Substring(objectStart, i - objectStart + 1));
                            objectStart = -1;
                        }
                    }
                    continue;
                }

                if (ch == ']' && depth == 0)
                    break;
            }

            return result;
        }

        private List<NewsGateEvent> FetchNewsGateEvents()
        {
            var url = BuildServerApiUrl("calendar/today");
            HttpRequestMessage request = null;
            try
            {
                using (request = new HttpRequestMessage(System.Net.Http.HttpMethod.Get, url))
                {
                    request.Headers.Add("x-api-key", EaApiKey);
                    var response = SendWithTimeoutAsync(request, Math.Max(2, Math.Min(5, PollTimeoutSeconds))).GetAwaiter().GetResult();
                    if (response == null || !response.IsSuccessStatusCode)
                        return new List<NewsGateEvent>();

                    var json = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    var eventObjects = ExtractTopLevelJsonObjectsFromArray(json, "events");
                    var result = new List<NewsGateEvent>();
                    foreach (var eventJson in eventObjects)
                    {
                        var phase = (GetJsonValue(eventJson, "phase") ?? "").Trim().ToLowerInvariant();
                        if (string.IsNullOrWhiteSpace(phase))
                            continue;

                        var symbols = GetJsonStringArray(eventJson, "effective_symbols")
                            .Where(s => !string.IsNullOrWhiteSpace(s))
                            .Select(s => s.Trim().ToUpperInvariant())
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .ToList();

                        result.Add(new NewsGateEvent
                        {
                            Title = GetJsonValue(eventJson, "title"),
                            Phase = phase,
                            MinutesUntilStart = GetJsonInt(eventJson, "minutes_until_start"),
                            MinutesUntilEnd = GetJsonInt(eventJson, "minutes_until_end"),
                            EffectiveSymbols = symbols
                        });
                    }

                    return result;
                }
            }
            catch
            {
                return new List<NewsGateEvent>();
            }
        }

        private async Task RefreshNewsGateEventsAsync()
        {
            if (_busyNewsGateRefresh)
                return;

            _busyNewsGateRefresh = true;
            try
            {
                var url = BuildServerApiUrl("calendar/today");
                using (var request = new HttpRequestMessage(System.Net.Http.HttpMethod.Get, url))
                {
                    request.Headers.Add("x-api-key", EaApiKey);
                    var response = await SendWithTimeoutAsync(request, Math.Max(2, Math.Min(5, PollTimeoutSeconds)));
                    if (response == null || !response.IsSuccessStatusCode)
                        return;

                    var json = await response.Content.ReadAsStringAsync();
                    var eventObjects = ExtractTopLevelJsonObjectsFromArray(json, "events");
                    var result = new List<NewsGateEvent>();
                    foreach (var eventJson in eventObjects)
                    {
                        var phase = (GetJsonValue(eventJson, "phase") ?? "").Trim().ToLowerInvariant();
                        if (string.IsNullOrWhiteSpace(phase))
                            continue;

                        var symbols = GetJsonStringArray(eventJson, "effective_symbols")
                            .Where(s => !string.IsNullOrWhiteSpace(s))
                            .Select(s => s.Trim().ToUpperInvariant())
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .ToList();

                        result.Add(new NewsGateEvent
                        {
                            Title = GetJsonValue(eventJson, "title"),
                            Phase = phase,
                            MinutesUntilStart = GetJsonInt(eventJson, "minutes_until_start"),
                            MinutesUntilEnd = GetJsonInt(eventJson, "minutes_until_end"),
                            EffectiveSymbols = symbols
                        });
                    }

                    _newsGateEventsCache["calendar_today"] = new TimedCacheEntry<List<NewsGateEvent>>
                    {
                        CreatedAtUtc = DateTime.UtcNow,
                        Value = result
                    };
                }
            }
            catch
            {
                // Non-blocking by design. If server news fails, strategies continue and treat it as no news.
            }
            finally
            {
                _busyNewsGateRefresh = false;
            }
        }

        private List<NewsGateEvent> GetCachedNewsGateEvents()
        {
            TimedCacheEntry<List<NewsGateEvent>> cached;
            if (_newsGateEventsCache.TryGetValue("calendar_today", out cached) && cached != null && cached.Value != null)
                return cached.Value;
            return new List<NewsGateEvent>();
        }

        private void TriggerNewsGateRefreshIfNeeded()
        {
            TimedCacheEntry<List<NewsGateEvent>> cached;
            var hasFreshCache =
                _newsGateEventsCache.TryGetValue("calendar_today", out cached) &&
                cached != null &&
                cached.Value != null &&
                (DateTime.UtcNow - cached.CreatedAtUtc) <= TimeSpan.FromSeconds(45);

            if (hasFreshCache || _busyNewsGateRefresh)
                return;

            Task.Run(async () => await RefreshNewsGateEventsAsync());
        }

        private bool TryGetNewsGateRejectReason(string symbolName, RiskTemplate template, out string rejectReason)
        {
            rejectReason = "";
            if (!GetEffectiveHighImpactNewsBlockEnabled(template))
                return false;

            var normalizedSymbol = string.IsNullOrWhiteSpace(symbolName) ? "" : symbolName.Trim().ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(normalizedSymbol))
                return false;

            var beforeMinutes = GetEffectiveNewsBlockBeforeMinutes(template);
            var duringMinutes = GetEffectiveNewsBlockDuringMinutes(template);
            var events = GetCachedNewsGateEvents();
            foreach (var evt in events)
            {
                if (evt == null)
                    continue;
                if (evt.EffectiveSymbols == null || evt.EffectiveSymbols.Count == 0)
                    continue;
                if (!evt.EffectiveSymbols.Any(s => string.Equals(s, normalizedSymbol, StringComparison.OrdinalIgnoreCase)))
                    continue;

                if (evt.Phase == "before" && beforeMinutes >= 0 && evt.MinutesUntilStart >= 0 && evt.MinutesUntilStart <= beforeMinutes)
                {
                    rejectReason = string.Format(
                        CultureInfo.InvariantCulture,
                        "high_impact_news_before symbol={0}; mins={1}; limit={2}; title={3}",
                        normalizedSymbol,
                        evt.MinutesUntilStart,
                        beforeMinutes,
                        string.IsNullOrWhiteSpace(evt.Title) ? "NEWS" : evt.Title.Trim());
                    return true;
                }

                if (evt.Phase == "during" && duringMinutes >= 0 && (evt.MinutesUntilEnd <= 0 || evt.MinutesUntilEnd <= duringMinutes))
                {
                    rejectReason = string.Format(
                        CultureInfo.InvariantCulture,
                        "high_impact_news_during symbol={0}; mins_left={1}; limit={2}; title={3}",
                        normalizedSymbol,
                        evt.MinutesUntilEnd,
                        duringMinutes,
                        string.IsNullOrWhiteSpace(evt.Title) ? "NEWS" : evt.Title.Trim());
                    return true;
                }
            }

            return false;
        }

        private double EstimateDirectionalRiskAmount(string symbolName, TradeType tradeType)
        {
            var total = 0.0;
            var normalizedSymbol = string.IsNullOrWhiteSpace(symbolName) ? "" : symbolName.Trim().ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(normalizedSymbol))
                return 0.0;

            if (Positions != null)
            {
                foreach (var position in Positions)
                {
                    if (position == null) continue;
                    if (!string.Equals(position.SymbolName ?? "", normalizedSymbol, StringComparison.OrdinalIgnoreCase)) continue;
                    if (position.TradeType != tradeType) continue;
                    total += EstimateOpenPositionRiskAmount(position);
                }
            }

            return Math.Max(0.0, total);
        }

        private double GetCurrentSymbolDirectionalRiskPercent()
        {
            var symbolName = Symbol != null ? Symbol.Name : "";
            var balance = Account != null ? Math.Max(0.0, Account.Balance) : 0.0;
            if (!(balance > 0) || string.IsNullOrWhiteSpace(symbolName))
                return 0.0;

            var buyRisk = EstimateDirectionalRiskAmount(symbolName, TradeType.Buy);
            var sellRisk = EstimateDirectionalRiskAmount(symbolName, TradeType.Sell);
            return (Math.Max(buyRisk, sellRisk) / balance) * 100.0;
        }

        private double CalculateStopLossPips(Symbol symbol, double entryPrice, double stopLossPrice)
        {
            if (symbol == null || entryPrice <= 0 || stopLossPrice <= 0 || symbol.PipSize <= 0)
                return 0;

            var stopLossPips = Math.Abs(entryPrice - stopLossPrice) / symbol.PipSize;
            return double.IsNaN(stopLossPips) || double.IsInfinity(stopLossPips) ? 0 : Math.Max(0, stopLossPips);
        }

        private double EstimateAbsolutePnlFromPriceDistanceLegacy(Symbol symbol, double priceDistance, double volumeUnits)
        {
            if (symbol == null || volumeUnits <= 0)
                return 0;

            var absDistance = Math.Abs(priceDistance);
            if (!(absDistance > 0))
                return 0;

            double lots = 0;
            try
            {
                lots = symbol.VolumeInUnitsToQuantity(volumeUnits);
            }
            catch
            {
                lots = 0;
            }

            if (lots > 0 && symbol.PipSize > 0)
            {
                var pipDistance = absDistance / symbol.PipSize;
                var pipValue = double.IsNaN(symbol.PipValue) ? 0 : Math.Abs(symbol.PipValue);
                if (pipDistance > 0 && pipValue > 0)
                {
                    var pipAmount = pipDistance * pipValue * lots;
                    if (!double.IsNaN(pipAmount) && !double.IsInfinity(pipAmount))
                        return Math.Max(0, pipAmount);
                }
            }

            if (lots > 0 && symbol.TickSize > 0)
            {
                var tickDistanceLots = absDistance / symbol.TickSize;
                var tickValueLots = double.IsNaN(symbol.TickValue) ? 0 : Math.Abs(symbol.TickValue);
                if (tickDistanceLots > 0 && tickValueLots > 0)
                {
                    var tickLotsAmount = tickDistanceLots * tickValueLots * lots;
                    if (!double.IsNaN(tickLotsAmount) && !double.IsInfinity(tickLotsAmount))
                        return Math.Max(0, tickLotsAmount);
                }
            }

            if (symbol.TickSize <= 0)
                return 0;

            var tickDistance = absDistance / symbol.TickSize;
            var tickValue = double.IsNaN(symbol.TickValue) ? 0 : Math.Abs(symbol.TickValue);
            if (tickDistance <= 0 || tickValue <= 0)
                return 0;

            var amount = tickDistance * tickValue * volumeUnits;
            return double.IsNaN(amount) || double.IsInfinity(amount) ? 0 : Math.Max(0, amount);
        }

        private double EstimateAbsolutePnlFromPriceDistance(Symbol symbol, double priceDistance, double volumeUnits)
        {
            if (symbol == null || volumeUnits <= 0)
                return 0;

            if (symbol.PipSize > 0)
            {
                try
                {
                    var stopLossPips = Math.Abs(priceDistance) / symbol.PipSize;
                    if (stopLossPips > 0)
                    {
                        var amountRisked = symbol.AmountRisked(volumeUnits, stopLossPips);
                        if (!double.IsNaN(amountRisked) && !double.IsInfinity(amountRisked) && amountRisked > 0)
                            return Math.Max(0, amountRisked);
                    }
                }
                catch
                {
                }
            }

            return EstimateAbsolutePnlFromPriceDistanceLegacy(symbol, priceDistance, volumeUnits);
        }

        private double EstimateRiskAmount(Symbol symbol, TradeType tradeType, double entryPrice, double stopLossPrice, double volumeUnits)
        {
            if (symbol == null || volumeUnits <= 0 || entryPrice <= 0 || stopLossPrice <= 0)
                return 0;
            return EstimateAbsolutePnlFromPriceDistance(symbol, entryPrice - stopLossPrice, volumeUnits);
        }

        private double EstimatePnlFromPriceDistance(Symbol symbol, double priceDistance, double volumeUnits)
        {
            var amount = EstimateAbsolutePnlFromPriceDistance(symbol, priceDistance, volumeUnits);
            if (!(amount > 0))
                return 0;
            return priceDistance < 0 ? -amount : amount;
        }

        private double EstimatePnlFromPips(Symbol symbol, double pips, double volumeUnits)
        {
            if (symbol == null || symbol.PipSize <= 0)
                return 0;
            return EstimatePnlFromPriceDistance(symbol, pips * symbol.PipSize, volumeUnits);
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

        private double EstimateOpenPositionSlOutcomeAmount(Position position)
        {
            if (position == null || !position.StopLoss.HasValue) return 0;
            var symbol = ResolveLoadedSymbol(position.SymbolName);
            if (symbol == null) return 0;
            var signedPriceDistance = position.StopLoss.Value - position.EntryPrice;
            if (position.TradeType == TradeType.Sell) signedPriceDistance = -signedPriceDistance;
            return EstimatePnlFromPriceDistance(symbol, signedPriceDistance, position.VolumeInUnits);
        }

        private double EstimateOpenPositionTpAmount(Position position)
        {
            if (position == null || !position.TakeProfit.HasValue) return 0;
            var symbol = ResolveLoadedSymbol(position.SymbolName);
            if (symbol == null) return 0;
            var signedPriceDistance = position.TakeProfit.Value - position.EntryPrice;
            if (position.TradeType == TradeType.Sell) signedPriceDistance = -signedPriceDistance;
            return Math.Max(0, EstimatePnlFromPriceDistance(symbol, signedPriceDistance, position.VolumeInUnits));
        }

        private double EstimatePendingOrderTpAmount(PendingOrder order)
        {
            if (order == null || !order.TakeProfit.HasValue) return 0;
            var symbol = ResolveLoadedSymbol(order.SymbolName);
            if (symbol == null) return 0;
            var signedPriceDistance = order.TakeProfit.Value - order.TargetPrice;
            if (order.TradeType == TradeType.Sell) signedPriceDistance = -signedPriceDistance;
            return Math.Max(0, EstimatePnlFromPriceDistance(symbol, signedPriceDistance, order.VolumeInUnits));
        }

        private RiskGateState BuildRiskGateState(double candidateRiskAmount)
        {
            RefreshRiskAnchors();

            var state = new RiskGateState();
            state.OpenPositionsCount = Positions != null ? Positions.Count : 0;
            state.PendingOrdersCount = PendingOrders != null ? PendingOrders.Count : 0;
            state.UsedMarginAmount = Account != null && !double.IsNaN(Account.Margin) ? Math.Max(0, Account.Margin) : 0;
            state.ExistingOpenRiskAmount =
                (Positions != null ? Positions.Sum(EstimateOpenPositionRiskAmount) : 0);
            state.MaxSingleOpenRiskAmount = Positions != null && Positions.Count > 0
                ? Positions.Max(EstimateOpenPositionRiskAmount)
                : 0;
            state.CandidateRiskAmount = Math.Max(0, candidateRiskAmount);
            state.TotalOpenRiskAmount = state.ExistingOpenRiskAmount + state.CandidateRiskAmount;
            state.AccountBalance = Account != null ? Math.Max(0, Account.Balance) : 0;
            state.CurrentEquity = Account != null ? Math.Max(0, Account.Equity) : 0;
            state.UsedMarginPercent = state.CurrentEquity > 0
                ? (state.UsedMarginAmount / state.CurrentEquity) * 100.0
                : 0;
            state.MaxSingleOpenRiskPercent = state.AccountBalance > 0
                ? (state.MaxSingleOpenRiskAmount / state.AccountBalance) * 100.0
                : 0;
            state.TotalOpenRiskPercent = state.AccountBalance > 0
                ? (state.TotalOpenRiskAmount / state.AccountBalance) * 100.0
                : 0;

            var utcNow = DateTime.UtcNow;
            var ftmoDayStartUtc = GetFtmoDayStartUtc(utcNow);
            state.DailyClosedPnl = History != null
                ? History.Where(d => d != null && ToUtcSafe(d.ClosingTime) >= ftmoDayStartUtc).Sum(d => double.IsNaN(d.NetProfit) ? 0 : d.NetProfit)
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
                ? History.Where(d => d != null && ToUtcSafe(d.ClosingTime) >= ftmoDayStartUtc).Sum(d => Math.Max(0, double.IsNaN(d.NetProfit) ? 0 : d.NetProfit))
                : 0;
            state.ClosedTodayLoseAmount = History != null
                ? History.Where(d => d != null && ToUtcSafe(d.ClosingTime) >= ftmoDayStartUtc).Sum(d => Math.Max(0, -(double.IsNaN(d.NetProfit) ? 0 : d.NetProfit)))
                : 0;
            state.PossibleWinAmount =
                (Positions != null ? Positions.Sum(EstimateOpenPositionTpAmount) : 0);
            state.PossibleLoseAmount =
                (Positions != null ? Positions.Sum(EstimateOpenPositionRiskAmount) : 0);
            state.PossibleSlOutcomeAmount =
                (Positions != null ? Positions.Sum(EstimateOpenPositionSlOutcomeAmount) : 0);
            state.DailyClosedNetLossAmount = state.ClosedTodayLoseAmount - state.ClosedTodayWinAmount;
            state.DailyTotalPnl = state.DailyClosedPnl + state.DailyFloatingPnl;
            var derivedDayStartBalance = Math.Max(0, state.AccountBalance - state.DailyClosedPnl);
            var derivedDayStartEquity = Math.Max(0, state.CurrentEquity - state.DailyTotalPnl);
            if (_ftmoDayStartUtc == DateTime.MinValue || ftmoDayStartUtc > _ftmoDayStartUtc)
            {
                _ftmoDayStartUtc = ftmoDayStartUtc;
                _ftmoDayStartBalance = derivedDayStartBalance;
                _ftmoDayStartEquity = state.CurrentEquity;
                if (_ftmoHighestDayStartBalance <= 0)
                    _ftmoHighestDayStartBalance = Math.Max(_initialAccountBalance, _ftmoDayStartBalance);
                else if (_ftmoDayStartBalance > _ftmoHighestDayStartBalance)
                    _ftmoHighestDayStartBalance = _ftmoDayStartBalance;
            }
            else if (_ftmoDayStartBalance <= 0)
            {
                _ftmoDayStartBalance = derivedDayStartBalance;
            }
            else if (_ftmoDayStartEquity <= 0)
            {
                _ftmoDayStartEquity = derivedDayStartEquity;
            }

            var dailyLossReference = ResolveDailyLossReferenceAmount(_ftmoDayStartBalance, _ftmoDayStartEquity);
            state.DailyLossAmount = Math.Max(0, dailyLossReference - state.CurrentEquity);
            state.DailyLossPercent = _initialAccountBalance > 0
                ? (state.DailyLossAmount / _initialAccountBalance) * 100.0
                : 0;

            var effectiveMaxEquityDrawdownPercent = GetEffectiveMaxEquityDrawdownPercent();
            var drawdownLimitAmount = GetPercentAmountFromInitialBalance(effectiveMaxEquityDrawdownPercent);
            double drawdownReference;
            switch (GetRiskDrawdownMode())
            {
                case RiskDrawdownMode.EndOfDayTrailingBalance:
                    drawdownReference = Math.Max(_initialAccountBalance, _ftmoHighestDayStartBalance);
                    break;
                case RiskDrawdownMode.BalanceTrailingCapAtInitial:
                    drawdownReference = drawdownLimitAmount > 0
                        ? Math.Min(_initialAccountBalance + drawdownLimitAmount, _peakBalanceSeen)
                        : _initialAccountBalance;
                    break;
                default:
                    drawdownReference = _initialAccountBalance;
                    break;
            }
            state.PeakEquitySeen = drawdownReference;
            state.EquityDrawdownAmount = Math.Max(0, drawdownReference - state.CurrentEquity);
            state.EquityDrawdownPercent = _initialAccountBalance > 0
                ? (state.EquityDrawdownAmount / _initialAccountBalance) * 100.0
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
            var effectiveMaxTotalOpenRiskPercent = GetEffectiveMaxTotalOpenRiskPercent();
            var effectiveMaxSameSymbolDirectionRiskPercent = GetEffectiveMaxSameSymbolDirectionRiskPercent();
            var effectiveMaxDailyLossPercent = GetEffectiveMaxDailyLossPercent();
            var effectiveMaxEquityDrawdownPercent = GetEffectiveMaxEquityDrawdownPercent();
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

            if (effectiveMaxSameSymbolDirectionRiskPercent > 0 && symbol != null)
            {
                var sameDirectionRiskAmount = EstimateDirectionalRiskAmount(symbol.Name, tradeType) + state.CandidateRiskAmount;
                var sameDirectionRiskPercent = state.AccountBalance > 0
                    ? (sameDirectionRiskAmount / state.AccountBalance) * 100.0
                    : 0.0;
                if (sameDirectionRiskPercent > effectiveMaxSameSymbolDirectionRiskPercent)
                {
                    rejectReason = string.Format(
                        CultureInfo.InvariantCulture,
                        "max_risk_pct_per_idea {0:F2}>{1:F2}; symbol={2}; side={3}",
                        sameDirectionRiskPercent,
                        effectiveMaxSameSymbolDirectionRiskPercent,
                        symbol.Name,
                        action);
                    return false;
                }
            }

            if (symbol != null)
            {
                string newsRejectReason;
                if (TryGetNewsGateRejectReason(symbol.Name, SelectedRiskTemplate, out newsRejectReason))
                {
                    rejectReason = newsRejectReason;
                    return false;
                }
            }

            string overnightRejectReason;
            if (TryGetOvernightGateRejectReason(SelectedRiskTemplate, out overnightRejectReason))
            {
                rejectReason = overnightRejectReason;
                return false;
            }

            string weekendRejectReason;
            if (TryGetWeekendGateRejectReason(SelectedRiskTemplate, out weekendRejectReason))
            {
                rejectReason = weekendRejectReason;
                return false;
            }

            if (effectiveMaxTotalOpenRiskPercent > 0 && state.TotalOpenRiskPercent > effectiveMaxTotalOpenRiskPercent)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "total_open_risk_pct {0:F2}>{1:F2}; total_open_risk={2:F2}; balance={3:F2}",
                    state.TotalOpenRiskPercent,
                    effectiveMaxTotalOpenRiskPercent,
                    state.TotalOpenRiskAmount,
                    state.AccountBalance
                );
                return false;
            }

            if (effectiveMaxDailyLossPercent > 0 && state.DailyLossPercent >= effectiveMaxDailyLossPercent)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "daily_loss_pct {0:F2}>={1:F2}; daily_loss={2:F2}; day_start_balance={3:F2}; equity={4:F2}",
                    state.DailyLossPercent,
                    effectiveMaxDailyLossPercent,
                    state.DailyLossAmount,
                    _ftmoDayStartBalance,
                    state.CurrentEquity
                );
                return false;
            }

            if (effectiveMaxEquityDrawdownPercent > 0 && state.EquityDrawdownPercent >= effectiveMaxEquityDrawdownPercent)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "equity_drawdown_pct {0:F2}>={1:F2}; ftmo_ref={2:F2}; equity={3:F2}",
                    state.EquityDrawdownPercent,
                    effectiveMaxEquityDrawdownPercent,
                    state.PeakEquitySeen,
                    state.CurrentEquity
                );
                return false;
            }

            return true;
        }

        private bool IsStrictPropRiskTemplate()
        {
            return SelectedRiskTemplate != RiskTemplate.Custom;
        }

        private bool TryGetBacktestRiskStopReason(out string reason)
        {
            reason = "";
            if (!IsBacktestingRuntime() || !IsStrictPropRiskTemplate())
                return false;

            var state = BuildRiskGateState(0);
            var effectiveMaxDailyLossPercent = GetEffectiveMaxDailyLossPercent();
            var effectiveMaxEquityDrawdownPercent = GetEffectiveMaxEquityDrawdownPercent();

            if (effectiveMaxDailyLossPercent > 0 && state.DailyLossPercent >= effectiveMaxDailyLossPercent)
            {
                reason = string.Format(
                    CultureInfo.InvariantCulture,
                    "prop_daily_loss_breach {0:F2}>={1:F2}",
                    state.DailyLossPercent,
                    effectiveMaxDailyLossPercent);
                return true;
            }

            if (effectiveMaxEquityDrawdownPercent > 0 && state.EquityDrawdownPercent >= effectiveMaxEquityDrawdownPercent)
            {
                reason = string.Format(
                    CultureInfo.InvariantCulture,
                    "prop_drawdown_breach {0:F2}>={1:F2}",
                    state.EquityDrawdownPercent,
                    effectiveMaxEquityDrawdownPercent);
                return true;
            }

            return false;
        }

        private void StopBacktestForPropRuleBreach(string context, string symbolName, string reason)
        {
            if (!IsBacktestingRuntime())
            {
                SafePrint(
                    "[Live][Gate] Reject {0} {1} {2}",
                    string.IsNullOrWhiteSpace(context) ? "ENTRY" : context.Trim(),
                    string.IsNullOrWhiteSpace(symbolName) ? "" : symbolName.Trim().ToUpperInvariant(),
                    string.IsNullOrWhiteSpace(reason) ? "prop_rule_breach" : reason.Trim());
                return;
            }

            if (_backtestRiskStopTriggered)
                return;

            _backtestRiskStopTriggered = true;
            _backtestRiskStopReason = string.Format(
                CultureInfo.InvariantCulture,
                "{0} {1} {2}",
                string.IsNullOrWhiteSpace(context) ? "BACKTEST" : context.Trim(),
                string.IsNullOrWhiteSpace(symbolName) ? "" : symbolName.Trim().ToUpperInvariant(),
                string.IsNullOrWhiteSpace(reason) ? "prop_rule_breach" : reason.Trim()).Trim();

            SafePrint("[Backtest][STOP] {0}", _backtestRiskStopReason);
            try { RefreshDebugPanelNow(); } catch { }
            RequestBotStop("backtest_prop_rule_breach: " + _backtestRiskStopReason);
        }

        private void RequestBotStop(string reason)
        {
            _lastStopReason = string.IsNullOrWhiteSpace(reason) ? "requested_without_reason" : reason.Trim();
            SafePrint("[BotStop] Requesting stop: {0}", _lastStopReason);
            Stop();
        }

        private bool TryPassAbsoluteBrokerRiskGate(
            Symbol symbol,
            string action,
            string orderTypeStr,
            double entry,
            double executionPrice,
            double sl,
            double volumeUnits,
            double finalRiskMoney,
            out double brokerRiskAmount,
            out string rejectReason)
        {
            brokerRiskAmount = 0;
            rejectReason = "";

            if (symbol == null)
            {
                rejectReason = "symbol_missing";
                return false;
            }

            if (!(finalRiskMoney > 0))
                return true;

            var submitReferencePrice = (orderTypeStr == "market" || entry <= 0) ? executionPrice : entry;
            if (!(submitReferencePrice > 0) || !(sl > 0) || !(volumeUnits > 0))
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "absolute_risk_gate_invalid_input ref={0:F5}; sl={1:F5}; volume={2:F2}",
                    submitReferencePrice,
                    sl,
                    volumeUnits
                );
                return false;
            }

            brokerRiskAmount = EstimateRiskAmount(symbol, action == "BUY" ? TradeType.Buy : TradeType.Sell, submitReferencePrice, sl, volumeUnits);
            var allowedWithBuffer = finalRiskMoney * 1.2;
            if (brokerRiskAmount > allowedWithBuffer)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "absolute_risk_gate {0:F2}>{1:F2} (cap={2:F2}); ref={3:F5}; sl={4:F5}; volume={5:F2}",
                    brokerRiskAmount,
                    allowedWithBuffer,
                    finalRiskMoney,
                    submitReferencePrice,
                    sl,
                    volumeUnits
                );
                return false;
            }

            return true;
        }

        private bool TryPassSharedCreationGate(
            Symbol symbol,
            string action,
            string orderTypeStr,
            double entry,
            double executionPrice,
            double sl,
            double tp,
            double requestedVolumeUnits,
            double requestedRiskMoney,
            double finalRiskMoney,
            out double approvedSl,
            out double approvedTp,
            out double approvedVolumeUnits,
            out double approvedRiskMoney,
            out double marginEstimate,
            out double marginBudget,
            out string rejectReason)
        {
            approvedSl = sl;
            approvedTp = tp;
            approvedVolumeUnits = 0;
            approvedRiskMoney = 0;
            marginEstimate = 0;
            marginBudget = 0;
            rejectReason = "";

            if (symbol == null)
            {
                rejectReason = "symbol_missing";
                return false;
            }

            if (sl <= 0)
            {
                rejectReason = "missing_stop_loss";
                return false;
            }

            var submitReferencePrice = (orderTypeStr == "market" || entry <= 0) ? executionPrice : entry;
            if (symbol.PipSize > 0)
            {
                var adjustProtection = String.Equals(OnSlTpError, "Adjust", StringComparison.OrdinalIgnoreCase);
                if (approvedSl > 0)
                {
                    var slDistPips = Math.Abs(submitReferencePrice - approvedSl) / symbol.PipSize;
                    if (slDistPips < MinStopPips)
                    {
                        if (!adjustProtection)
                        {
                            rejectReason = string.Format(
                                CultureInfo.InvariantCulture,
                                "sl_too_close {0:F1}<{1:F1}; ref={2:F5}; sl={3:F5}",
                                slDistPips,
                                MinStopPips,
                                submitReferencePrice,
                                approvedSl
                            );
                            return false;
                        }

                        approvedSl = action == "SELL"
                            ? submitReferencePrice + MinStopPips * symbol.PipSize
                            : submitReferencePrice - MinStopPips * symbol.PipSize;
                        approvedSl = NormalizePriceToSymbol(symbol, approvedSl);
                    }
                }

                if (approvedTp > 0)
                {
                    var tpDistPips = Math.Abs(approvedTp - submitReferencePrice) / symbol.PipSize;
                    if (tpDistPips < MinStopPips)
                    {
                        if (!adjustProtection)
                        {
                            rejectReason = string.Format(
                                CultureInfo.InvariantCulture,
                                "tp_too_close {0:F1}<{1:F1}; ref={2:F5}; tp={3:F5}",
                                tpDistPips,
                                MinStopPips,
                                submitReferencePrice,
                                approvedTp
                            );
                            return false;
                        }

                        approvedTp = action == "SELL"
                            ? submitReferencePrice - MinStopPips * symbol.PipSize
                            : submitReferencePrice + MinStopPips * symbol.PipSize;
                        approvedTp = NormalizePriceToSymbol(symbol, approvedTp);
                    }
                }
            }

            string protectionRejectReason;
            if (!TryValidateProtectionPrices(symbol, action, submitReferencePrice, approvedSl, approvedTp, out protectionRejectReason))
            {
                rejectReason = protectionRejectReason;
                return false;
            }

            approvedVolumeUnits = symbol.NormalizeVolumeInUnits(requestedVolumeUnits, RoundingMode.Down);
            if (approvedVolumeUnits < symbol.VolumeInUnitsMin)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "volume_below_min requested={0:F2} normalized={1:F2} min={2:F2}",
                    requestedVolumeUnits,
                    approvedVolumeUnits,
                    symbol.VolumeInUnitsMin
                );
                return false;
            }

            double riskFittedVolumeUnits;
            double riskFittedRiskMoney;
            string riskFitNote;
            var tradeType = action == "BUY" ? TradeType.Buy : TradeType.Sell;
            if (!TryFitVolumeToRiskCap(symbol, tradeType, submitReferencePrice, approvedSl, approvedVolumeUnits, finalRiskMoney, out riskFittedVolumeUnits, out riskFittedRiskMoney, out riskFitNote))
            {
                rejectReason = riskFitNote;
                return false;
            }
            approvedVolumeUnits = riskFittedVolumeUnits;
            approvedRiskMoney = riskFittedRiskMoney;

            double affordableVolumeUnits;
            string marginNote;
            if (!TryFitVolumeToFreeMargin(symbol, tradeType, approvedVolumeUnits, out affordableVolumeUnits, out marginEstimate, out marginBudget, out marginNote))
            {
                rejectReason = marginNote;
                return false;
            }
            approvedVolumeUnits = affordableVolumeUnits;
            approvedRiskMoney = EstimateRiskAmount(symbol, tradeType, submitReferencePrice, approvedSl, approvedVolumeUnits);

            double absoluteBrokerRiskAmount;
            string absoluteBrokerRiskRejectReason;
            if (!TryPassAbsoluteBrokerRiskGate(
                symbol,
                action,
                orderTypeStr,
                entry,
                executionPrice,
                approvedSl,
                approvedVolumeUnits,
                finalRiskMoney,
                out absoluteBrokerRiskAmount,
                out absoluteBrokerRiskRejectReason))
            {
                rejectReason = absoluteBrokerRiskRejectReason;
                return false;
            }
            approvedRiskMoney = absoluteBrokerRiskAmount;

            string riskFirewallReason;
            if (!TryPassRiskFirewall(
                symbol,
                action,
                orderTypeStr,
                entry,
                executionPrice,
                approvedSl,
                approvedTp,
                approvedVolumeUnits,
                requestedRiskMoney,
                finalRiskMoney,
                out riskFirewallReason))
            {
                rejectReason = riskFirewallReason;
                return false;
            }

            if (approvedVolumeUnits < symbol.VolumeInUnitsMin)
            {
                rejectReason = string.Format(
                    CultureInfo.InvariantCulture,
                    "volume_below_min_after_gate approved={0:F2} min={1:F2}",
                    approvedVolumeUnits,
                    symbol.VolumeInUnitsMin
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

        private bool ShouldRaisePopupAlert(string level, string message)
        {
            if (!EnablePopupAlerts) return false;

            var text = string.IsNullOrWhiteSpace(message) ? "" : message.Trim();
            if (string.IsNullOrWhiteSpace(text)) return false;

            var isErrorLevel = string.Equals((level ?? "").Trim(), "ERROR", StringComparison.OrdinalIgnoreCase);
            var isTradeRelevant =
                text.IndexOf("[ChartTrade]", StringComparison.OrdinalIgnoreCase) >= 0 ||
                text.IndexOf("[Reject]", StringComparison.OrdinalIgnoreCase) >= 0 ||
                text.IndexOf("[CreateFailed]", StringComparison.OrdinalIgnoreCase) >= 0;
            if (!isErrorLevel || !isTradeRelevant) return false;

            var now = DateTime.UtcNow;
            if (string.Equals(_lastPopupAlertMessage, text, StringComparison.Ordinal) && (now - _lastPopupAlertAt).TotalSeconds < 3)
                return false;

            _lastPopupAlertMessage = text;
            _lastPopupAlertAt = now;
            return true;
        }

        private void TryShowPopupAlert(string level, string message)
        {
            if (!ShouldRaisePopupAlert(level, message)) return;

            try
            {
                Notifications.ShowPopup("42Trade Alert", message, PopupNotificationState.Error);
                if (EnableAlertSound)
                    Notifications.PlaySound(SoundType.NegativeNotification);
            }
            catch
            {
            }
        }

        private void PrintBypassLogFilter(string format, params object[] args)
        {
            var message = (args != null && args.Length > 0)
                ? string.Format(CultureInfo.InvariantCulture, format, args)
                : format;
            _lastPanelMessage = message;
            _lastPanelMessageIsError = false;
            _lastPanelMessageColor = Color.White;
            BeginInvokeOnMainThread(() => Print(message));
        }

        private void SafeLog(string level, string format, params object[] args)
        {
            var message = (args != null && args.Length > 0)
                ? string.Format(CultureInfo.InvariantCulture, format, args)
                : format;
            var suppressBacktestInfo =
                IsBacktestingRuntime() &&
                string.Equals((level ?? "").Trim(), "INFO", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(message) &&
                (message.StartsWith("[Backtest] Skip", StringComparison.OrdinalIgnoreCase) ||
                 message.StartsWith("[Backtest] Signal", StringComparison.OrdinalIgnoreCase) ||
                 message.StartsWith("[Backtest] price_action_event_detector_v1", StringComparison.OrdinalIgnoreCase) ||
                 message.StartsWith("[Backtest] follow_trend", StringComparison.OrdinalIgnoreCase));
            _lastPanelMessage = message;
            _lastPanelMessageIsError =
                string.Equals((level ?? "").Trim(), "ERROR", StringComparison.OrdinalIgnoreCase) ||
                message.IndexOf("[Error]", StringComparison.OrdinalIgnoreCase) >= 0 ||
                message.IndexOf(" failed", StringComparison.OrdinalIgnoreCase) >= 0 ||
                message.IndexOf(" rejected", StringComparison.OrdinalIgnoreCase) >= 0;
            _lastPanelMessageColor = _lastPanelMessageIsError
                ? Color.Red
                : (message.IndexOf("TRADELOG|", StringComparison.OrdinalIgnoreCase) >= 0 && message.IndexOf("status=SUCCEEDED", StringComparison.OrdinalIgnoreCase) >= 0
                    ? Color.LimeGreen
                    : Color.White);
            if (suppressBacktestInfo)
                return;

            TryShowPopupAlert(level, message);
            if (!ShouldEmitLog(level, message)) return;
            BeginInvokeOnMainThread(() => Print(message));
        }

        private string ToStructuredLogField(string value)
        {
            var normalized = string.IsNullOrWhiteSpace(value) ? "" : value.Trim();
            normalized = normalized.Replace("|", "/").Replace("\r", " ").Replace("\n", " ");
            return normalized;
        }

        private string ToStructuredLogNumber(double value, int decimals)
        {
            if (double.IsNaN(value) || double.IsInfinity(value))
                return "";

            var safeDecimals = Math.Max(0, Math.Min(8, decimals));
            return value.ToString("F" + safeDecimals.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
        }

        private void LogStructuredTradeEvent(
            string scope,
            string status,
            string symbol,
            string side,
            string orderType,
            double lots,
            double entryPrice,
            double stopLoss,
            double takeProfit,
            string ticket,
            string note = "")
        {
            var level = string.Equals(status, "FAILED", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(status, "REJECTED", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(status, "ERROR", StringComparison.OrdinalIgnoreCase)
                ? "ERROR"
                : "INFO";

            SafeLog(
                level,
                "TRADELOG|scope={0}|status={1}|symbol={2}|side={3}|type={4}|lots={5}|entry={6}|sl={7}|tp={8}|ticket={9}|note={10}",
                ToStructuredLogField(scope),
                ToStructuredLogField(status),
                ToStructuredLogField(symbol),
                ToStructuredLogField(side),
                ToStructuredLogField(orderType),
                ToStructuredLogNumber(lots, 4),
                ToStructuredLogNumber(entryPrice, 5),
                ToStructuredLogNumber(stopLoss, 5),
                ToStructuredLogNumber(takeProfit, 5),
                ToStructuredLogField(ticket),
                ToStructuredLogField(note));
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
            _startedAtUtc = DateTime.UtcNow;
            _lastStopReason = "running";
            LoadCustomUiSettings();
            StartBacktestExportSession();
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
            _toggleKillerZones = DrawKillerZones;
            _toggleLiquidityLevels = DrawLiquidityLevels;
            _toggleSweepDetections = DrawSweepDetections;
            _toggleBosDetections = DrawBosDetections;
            _toggleChochDetections = DrawChochDetections;
            _toggleRejectionDetections = DrawRejectionDetections;
            _toggleBreakoutDetections = DrawBreakoutDetections;
            _togglePullbackDetections = DrawPullbackDetections;
            _toggleContinuationDetections = DrawContinuationDetections;
            _toggleImpulseDetections = DrawImpulseDetections;
            _toggleEmaOverlay = DrawEmaOverlay;
            _toggleVwapOverlay = DrawVwapOverlay;
            _toggleBollingerOverlay = DrawBollingerOverlay;
            _toggleEmaEvents = DrawEmaEvents;
            _toggleVwapEvents = DrawVwapEvents;
            _toggleBollingerEvents = DrawBollingerEvents;
            _toggleRsiEvents = DrawRsiEvents;
            _toggleStochasticEvents = DrawStochasticEvents;
            _toggleMacdEvents = DrawMacdEvents;
            _toggleFvgZones = DrawFvgZones;
            _toggleOrderBlocks = DrawOrderBlocks;
            _toggleHigherTimeframeZones = DrawHigherTimeframeZones;
            _toggleHtf15 = true;
            _toggleHtf4H = true;
            _toggleHtf1D = true;
            _toggleHtfMiniChart = DrawHtfMiniChart;
            _toggleKeyLevels = true;
            _toggleStrategyMarkers = DrawStrategyMarkers;
            ApplyCustomUiSettingsOverrides();
            var effectiveMaxRiskPercent = GetEffectiveMaxRiskPercent();
            var effectiveMaxDailyLossPercent = GetEffectiveMaxDailyLossPercent();
            var effectiveMaxTotalOpenRiskPercent = GetEffectiveMaxTotalOpenRiskPercent();
            var effectiveMaxEquityDrawdownPercent = GetEffectiveMaxEquityDrawdownPercent();
            int interval = Math.Max(1, MasterTimerSeconds);
            Timer.Start(TimeSpan.FromSeconds(interval));
            _lastTimerTickSeen = DateTime.Now;
            StartMasterWatchdog(interval);
            BuildChartVisualTogglePanel();
            BuildChartButtonPanel();
            DrawChartVisualOverlays();
            SafePrint("[Bridge] Started. MasterTimer={0}s Ver={1}", interval, BuildVersion);
            SafePrint(
                "[RiskTpl] Active={0} Effective: MaxRisk={1}% MaxOpenRisk={2}% MaxDayLoss={3}% MaxDD={4}%",
                SelectedRiskTemplate,
                FormatDashboardPercent(effectiveMaxRiskPercent),
                FormatDashboardPercent(effectiveMaxTotalOpenRiskPercent),
                FormatDashboardPercent(effectiveMaxDailyLossPercent),
                FormatDashboardPercent(effectiveMaxEquityDrawdownPercent));
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
            var safeProviderCode = "(auto)";
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
            var safeProviderCode = "(auto)";
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
            EnsureAutoProtectedPositions();

            if (ShouldStrategyEngineRun() && ShouldRunStrategiesOnTickEvent())
                TryRunBacktestStrategy();
        }

        protected override void OnBar()
        {
            if (ShouldRunStrategiesOnBarEvent())
                TryRunBacktestStrategy();
        }

        protected override void OnBarClosed()
        {
            if (ShouldStrategyEngineRun() && ShouldRunStrategiesOnBarClosedEvent())
                TryRunBacktestStrategy();
        }

        private bool ShouldUseNativeTrailingAutoProtect()
        {
            return EnableTrailingStop;
        }

        private void EnsureAutoProtectedPositions()
        {
            if (!ShouldUseNativeTrailingAutoProtect())
                return;

            foreach (var pos in Positions)
            {
                if (pos == null || !IsStrategyManagedExposure(pos.Label, pos.Comment))
                    continue;

                var symbol = ResolveLoadedSymbol(pos.SymbolName);
                if (symbol == null)
                    continue;

                var currentPrice = (pos.TradeType == TradeType.Buy) ? symbol.Bid : symbol.Ask;
                if (!IsFiniteNumber(currentPrice) || currentPrice <= 0)
                    continue;

                if (!pos.StopLoss.HasValue || pos.StopLoss.Value <= 0 || pos.HasTrailingStop)
                    goto Partials;

                try
                {
                    var result = pos.ModifyTrailingStop(true);
                    if (result != null && result.IsSuccessful)
                        SafePrint("[AutoProtect] TrailingStop enabled for {0} #{1}", pos.SymbolName, pos.Id);
                }
                catch (Exception ex)
                {
                    SafePrint("[AutoProtect] TrailingStop enable FAILED for {0} #{1}: {2}", pos.SymbolName, pos.Id, ex.Message);
                }

                Partials:
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

        private void TryEnableTrailingStopForPosition(Position position)
        {
            if (!ShouldUseNativeTrailingAutoProtect() || position == null || position.HasTrailingStop)
                return;

            if (!IsStrategyManagedExposure(position.Label, position.Comment))
                return;

            if (!position.StopLoss.HasValue || position.StopLoss.Value <= 0)
                return;

            try
            {
                var result = position.ModifyTrailingStop(true);
                if (result != null && result.IsSuccessful)
                    SafePrint("[AutoProtect] TrailingStop enabled for {0} #{1}", position.SymbolName, position.Id);
            }
            catch (Exception ex)
            {
                SafePrint("[AutoProtect] TrailingStop enable FAILED for {0} #{1}: {2}", position.SymbolName, position.Id, ex.Message);
            }
        }

        protected override void OnTimer()
        {
            _lastTimerTickSeen = DateTime.Now;
            _masterTickCount++;
            _masterTimerTick = DateTime.Now;
            MasterTimerTick();
        }

        private bool IsBacktestingRuntime()
        {
            try
            {
                var runningMode = TryGetPropertyValue(this, "RunningMode");
                var runningModeText = runningMode != null
                    ? Convert.ToString(runningMode, CultureInfo.InvariantCulture) ?? ""
                    : "";
                if (runningModeText.IndexOf("BACKTEST", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    runningModeText.IndexOf("OPTIM", StringComparison.OrdinalIgnoreCase) >= 0)
                    return true;
            }
            catch
            {
            }

            try
            {
                var raw = TryGetPropertyValue(this, "IsBacktesting");
                if (raw is bool directBool)
                    return directBool;
                if (raw != null)
                    return Convert.ToBoolean(raw, CultureInfo.InvariantCulture);
            }
            catch
            {
            }

            return false;
        }

        private bool IsFiniteNumber(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        private bool CrossesAbove(double leftPrevious, double leftCurrent, double rightPrevious, double rightCurrent)
        {
            return IsFiniteNumber(leftPrevious) &&
                   IsFiniteNumber(leftCurrent) &&
                   IsFiniteNumber(rightPrevious) &&
                   IsFiniteNumber(rightCurrent) &&
                   leftPrevious <= rightPrevious &&
                   leftCurrent > rightCurrent;
        }

        private bool CrossesBelow(double leftPrevious, double leftCurrent, double rightPrevious, double rightCurrent)
        {
            return IsFiniteNumber(leftPrevious) &&
                   IsFiniteNumber(leftCurrent) &&
                   IsFiniteNumber(rightPrevious) &&
                   IsFiniteNumber(rightCurrent) &&
                   leftPrevious >= rightPrevious &&
                   leftCurrent < rightCurrent;
        }

        private bool TryGetBacktestStrategyBars(string symbolName, out Symbol symbol, out Bars sourceBars, out int signalIndex, out int previousIndex)
        {
            return TryGetBacktestStrategyBars(symbolName, Chart != null ? Chart.TimeFrame : TimeFrame.Minute, out symbol, out sourceBars, out signalIndex, out previousIndex);
        }

        private int GetStrategySignalBarIndex(Bars sourceBars)
        {
            if (sourceBars == null)
                return -1;

            if (ShouldRunStrategiesOnBarClosedEvent())
                return sourceBars.Count - 1;

            return sourceBars.Count - 2;
        }

        private bool TryGetBacktestStrategyBars(string symbolName, TimeFrame sourceTimeFrame, out Symbol symbol, out Bars sourceBars, out int signalIndex, out int previousIndex)
        {
            symbol = ResolveLoadedSymbol(symbolName);
            sourceBars = null;
            signalIndex = -1;
            previousIndex = -1;

            if (symbol == null || string.IsNullOrWhiteSpace(symbolName))
                return false;

            try
            {
                sourceBars = MarketData.GetBars(sourceTimeFrame, symbolName);
                if (sourceBars == null || sourceBars.Count < 8)
                    return false;

                signalIndex = GetStrategySignalBarIndex(sourceBars);
                previousIndex = signalIndex - 1;
                return signalIndex >= 2 && previousIndex >= 1;
            }
            catch
            {
                return false;
            }
        }

        private bool ShouldRunLiveStrategyForNewClosedBar(BacktestStrategyMode mode, string strategySymbolName, TimeFrame strategyTimeFrame)
        {
            if (IsBacktestingRuntime())
                return true;

            Symbol strategySymbol;
            Bars strategyBars;
            int signalIndex;
            int previousIndex;
            if (!TryGetBacktestStrategyBars(strategySymbolName, strategyTimeFrame, out strategySymbol, out strategyBars, out signalIndex, out previousIndex))
            {
                LogStrategyInfoOnce(
                    GetBacktestStrategyModeDisplayName(mode),
                    string.IsNullOrWhiteSpace(strategySymbolName) ? "UNKNOWN" : strategySymbolName,
                    string.Format(CultureInfo.InvariantCulture, "bars unavailable on {0}", GetMiniChartLabel(strategyTimeFrame)));
                return false;
            }

            if (strategyBars == null || signalIndex < 0 || signalIndex >= strategyBars.Count)
                return false;

            var barTime = strategyBars.OpenTimes[signalIndex];
            var liveBarKey = string.Format(
                CultureInfo.InvariantCulture,
                "{0}|{1}|{2}",
                mode,
                string.IsNullOrWhiteSpace(strategySymbolName) ? "" : strategySymbolName.Trim().ToUpperInvariant(),
                strategyTimeFrame);
            long lastTicks;
            if (_liveStrategyLastProcessedBarTicks.TryGetValue(liveBarKey, out lastTicks) && lastTicks == barTime.Ticks)
                return false;

            _liveStrategyLastProcessedBarTicks[liveBarKey] = barTime.Ticks;
            return true;
        }

        private double ComputeSimpleMovingAverage(Bars sourceBars, int endIndex, int period)
        {
            if (sourceBars == null || period <= 0 || endIndex < period - 1)
                return double.NaN;

            double sum = 0;
            var start = endIndex - period + 1;
            for (var i = start; i <= endIndex; i++)
                sum += sourceBars.ClosePrices[i];
            return sum / period;
        }

        private double ComputeExponentialMovingAverage(Bars sourceBars, int endIndex, int period)
        {
            if (sourceBars == null || period <= 0 || endIndex < period - 1)
                return double.NaN;

            double ema = 0;
            for (var i = 0; i < period; i++)
                ema += sourceBars.ClosePrices[i];
            ema /= period;

            var multiplier = 2.0 / (period + 1.0);
            for (var i = period; i <= endIndex; i++)
                ema = ((sourceBars.ClosePrices[i] - ema) * multiplier) + ema;

            return ema;
        }

        private double ComputeRateOfChange(Bars sourceBars, int endIndex, int period)
        {
            if (sourceBars == null || period <= 0 || endIndex < period)
                return double.NaN;

            var previousClose = sourceBars.ClosePrices[endIndex - period];
            if (!IsFiniteNumber(previousClose) || Math.Abs(previousClose) < 0.0000001)
                return double.NaN;

            return ((sourceBars.ClosePrices[endIndex] - previousClose) / previousClose) * 100.0;
        }

        private double ComputeRelativeStrengthIndex(Bars sourceBars, int endIndex, int period)
        {
            if (sourceBars == null || period <= 0 || endIndex <= period)
                return double.NaN;

            double gain = 0;
            double loss = 0;
            for (var i = 1; i <= period; i++)
            {
                var delta = sourceBars.ClosePrices[i] - sourceBars.ClosePrices[i - 1];
                if (delta >= 0)
                    gain += delta;
                else
                    loss -= delta;
            }

            var averageGain = gain / period;
            var averageLoss = loss / period;
            for (var i = period + 1; i <= endIndex; i++)
            {
                var delta = sourceBars.ClosePrices[i] - sourceBars.ClosePrices[i - 1];
                var currentGain = delta > 0 ? delta : 0;
                var currentLoss = delta < 0 ? -delta : 0;
                averageGain = ((averageGain * (period - 1)) + currentGain) / period;
                averageLoss = ((averageLoss * (period - 1)) + currentLoss) / period;
            }

            if (averageLoss <= 0)
                return averageGain <= 0 ? 50.0 : 100.0;

            var rs = averageGain / averageLoss;
            return 100.0 - (100.0 / (1.0 + rs));
        }

        private double ComputeRollingStandardDeviation(Bars sourceBars, int endIndex, int period, double mean)
        {
            if (sourceBars == null || period <= 0 || endIndex < period - 1 || !IsFiniteNumber(mean))
                return double.NaN;

            double varianceSum = 0;
            var start = endIndex - period + 1;
            for (var i = start; i <= endIndex; i++)
            {
                var diff = sourceBars.ClosePrices[i] - mean;
                varianceSum += diff * diff;
            }

            return Math.Sqrt(varianceSum / period);
        }

        private double ComputeRawStochasticK(Bars sourceBars, int endIndex, int period)
        {
            if (sourceBars == null || period <= 0 || endIndex < period - 1)
                return double.NaN;

            var start = endIndex - period + 1;
            var highestHigh = double.MinValue;
            var lowestLow = double.MaxValue;
            for (var i = start; i <= endIndex; i++)
            {
                highestHigh = Math.Max(highestHigh, sourceBars.HighPrices[i]);
                lowestLow = Math.Min(lowestLow, sourceBars.LowPrices[i]);
            }

            var range = highestHigh - lowestLow;
            if (!IsFiniteNumber(range) || range <= 0)
                return 50.0;

            return ((sourceBars.ClosePrices[endIndex] - lowestLow) / range) * 100.0;
        }

        private double ComputeSmoothedStochasticK(Bars sourceBars, int endIndex, int period, int smoothPeriod)
        {
            if (sourceBars == null || period <= 0 || smoothPeriod <= 0 || endIndex < period + smoothPeriod - 2)
                return double.NaN;

            double sum = 0;
            for (var i = 0; i < smoothPeriod; i++)
            {
                var raw = ComputeRawStochasticK(sourceBars, endIndex - i, period);
                if (!IsFiniteNumber(raw))
                    return double.NaN;
                sum += raw;
            }

            return sum / smoothPeriod;
        }

        private bool TryComputeMacdValues(Bars sourceBars, int endIndex, int fastPeriod, int slowPeriod, int signalPeriod, out double macdLine, out double signalLine)
        {
            macdLine = double.NaN;
            signalLine = double.NaN;
            if (sourceBars == null || fastPeriod <= 0 || slowPeriod <= 0 || signalPeriod <= 0 || endIndex < slowPeriod + signalPeriod)
                return false;

            var macdSeries = new List<double>();
            for (var i = 0; i <= endIndex; i++)
            {
                var fast = ComputeExponentialMovingAverage(sourceBars, i, fastPeriod);
                var slow = ComputeExponentialMovingAverage(sourceBars, i, slowPeriod);
                if (!IsFiniteNumber(fast) || !IsFiniteNumber(slow))
                    continue;
                macdSeries.Add(fast - slow);
            }

            if (macdSeries.Count < signalPeriod + 1)
                return false;

            macdLine = macdSeries[macdSeries.Count - 1];
            double ema = macdSeries.Take(signalPeriod).Average();
            var multiplier = 2.0 / (signalPeriod + 1.0);
            for (var i = signalPeriod; i < macdSeries.Count; i++)
                ema = ((macdSeries[i] - ema) * multiplier) + ema;

            signalLine = ema;
            return IsFiniteNumber(macdLine) && IsFiniteNumber(signalLine);
        }

        private bool HasBullishBiasForStrategy(string symbolName)
        {
            var bias = GetSymbolTrendBias(symbolName);
            return bias.Item1 >= 2 || bias.Item2 >= 2 || (bias.Item1 + bias.Item2 + bias.Item3) > 0;
        }

        private bool HasBearishBiasForStrategy(string symbolName)
        {
            var bias = GetSymbolTrendBias(symbolName);
            return bias.Item1 <= -2 || bias.Item2 <= -2 || (bias.Item1 + bias.Item2 + bias.Item3) < 0;
        }

        private bool IsBullishPinBar(Bars sourceBars, int index)
        {
            if (sourceBars == null || index < 0 || index >= sourceBars.Count)
                return false;

            var open = sourceBars.OpenPrices[index];
            var close = sourceBars.ClosePrices[index];
            var high = sourceBars.HighPrices[index];
            var low = sourceBars.LowPrices[index];
            var body = Math.Abs(close - open);
            var range = high - low;
            var lowerWick = Math.Min(open, close) - low;
            var upperWick = high - Math.Max(open, close);
            return range > 0 &&
                   lowerWick >= body * 2.0 &&
                   lowerWick > upperWick * 1.5 &&
                   close >= low + (range * 0.55);
        }

        private bool IsBearishPinBar(Bars sourceBars, int index)
        {
            if (sourceBars == null || index < 0 || index >= sourceBars.Count)
                return false;

            var open = sourceBars.OpenPrices[index];
            var close = sourceBars.ClosePrices[index];
            var high = sourceBars.HighPrices[index];
            var low = sourceBars.LowPrices[index];
            var body = Math.Abs(close - open);
            var range = high - low;
            var lowerWick = Math.Min(open, close) - low;
            var upperWick = high - Math.Max(open, close);
            return range > 0 &&
                   upperWick >= body * 2.0 &&
                   upperWick > lowerWick * 1.5 &&
                   close <= low + (range * 0.45);
        }

        private bool IsBullishEngulfing(Bars sourceBars, int previousIndex, int currentIndex)
        {
            if (sourceBars == null || previousIndex < 0 || currentIndex < 0)
                return false;

            var previousOpen = sourceBars.OpenPrices[previousIndex];
            var previousClose = sourceBars.ClosePrices[previousIndex];
            var currentOpen = sourceBars.OpenPrices[currentIndex];
            var currentClose = sourceBars.ClosePrices[currentIndex];
            return previousClose < previousOpen &&
                   currentClose > currentOpen &&
                   currentOpen <= previousClose &&
                   currentClose >= previousOpen;
        }

        private bool IsBearishEngulfing(Bars sourceBars, int previousIndex, int currentIndex)
        {
            if (sourceBars == null || previousIndex < 0 || currentIndex < 0)
                return false;

            var previousOpen = sourceBars.OpenPrices[previousIndex];
            var previousClose = sourceBars.ClosePrices[previousIndex];
            var currentOpen = sourceBars.OpenPrices[currentIndex];
            var currentClose = sourceBars.ClosePrices[currentIndex];
            return previousClose > previousOpen &&
                   currentClose < currentOpen &&
                   currentOpen >= previousClose &&
                   currentClose <= previousOpen;
        }

        private bool IsStrongDirectionalCandle(Bars sourceBars, int index, bool bullish)
        {
            if (sourceBars == null || index < 0 || index >= sourceBars.Count)
                return false;

            var openV = sourceBars.OpenPrices[index];
            var highV = sourceBars.HighPrices[index];
            var lowV = sourceBars.LowPrices[index];
            var closeV = sourceBars.ClosePrices[index];
            var range = Math.Max(highV - lowV, Math.Max(Symbol != null ? Symbol.PipSize : 0.0000001, 0.0000001));
            var body = Math.Abs(closeV - openV);
            if (!(range > 0) || !(body > 0))
                return false;

            if (bullish)
                return closeV > openV && body / range >= 0.55 && closeV >= highV - (range * 0.30);

            return closeV < openV && body / range >= 0.55 && closeV <= lowV + (range * 0.30);
        }

        private bool IsDirectionalCandleSequence(Bars sourceBars, int endIndex, bool bullish, int candlesNum)
        {
            if (sourceBars == null || candlesNum <= 0 || endIndex < candlesNum - 1 || endIndex >= sourceBars.Count)
                return false;

            var startIndex = endIndex - candlesNum + 1;
            for (var index = startIndex; index <= endIndex; index++)
            {
                var open = sourceBars.OpenPrices[index];
                var close = sourceBars.ClosePrices[index];
                if (bullish)
                {
                    if (!(close > open))
                        return false;
                }
                else if (!(close < open))
                {
                    return false;
                }
            }

            return true;
        }

        private bool IsBigDirectionalCandle(Bars sourceBars, int index, bool bullish)
        {
            if (sourceBars == null || index < 0 || index >= sourceBars.Count || Symbol == null)
                return false;

            var open = sourceBars.OpenPrices[index];
            var close = sourceBars.ClosePrices[index];
            var high = sourceBars.HighPrices[index];
            var low = sourceBars.LowPrices[index];
            var candleRange = Math.Abs(high - low);
            var candleBody = Math.Abs(close - open);
            if (!(candleRange > 0) || !(candleBody > 0))
                return false;

            var bodyPercent = (candleBody / candleRange) * 100.0;
            var minBodyPercent = Math.Max(50.0, Math.Min(100.0, FollowTrendBigCandleBodyPercentMin));
            if (bodyPercent < minBodyPercent)
                return false;

            var isBullish = close > open;
            var isBearish = close < open;
            if (bullish != isBullish || (!bullish && !isBearish))
                return false;

            var tolerance = Math.Max(Symbol.PipSize * 0.5, 0.0000001);
            var closeAtHigh = Math.Abs(close - high) <= tolerance;
            var closeAtLow = Math.Abs(close - low) <= tolerance;
            return bullish ? closeAtHigh : closeAtLow;
        }

        private bool TryGetRecentDirectionalEvent(string symbolName, IEnumerable<TimeFrame> timeFrames, bool bullish, out CanonicalMarketEvent selectedEvent, params CanonicalEventType[] eventTypes)
        {
            selectedEvent = default(CanonicalMarketEvent);
            if (string.IsNullOrWhiteSpace(symbolName) || timeFrames == null || eventTypes == null || eventTypes.Length == 0)
                return false;

            var typeSet = new HashSet<CanonicalEventType>(eventTypes);
            var candidates = new List<CanonicalMarketEvent>();
            foreach (var timeFrame in timeFrames.Distinct())
            {
                candidates.AddRange(
                    GetCanonicalEventsForSymbolTimeFrame(symbolName, timeFrame, 12)
                        .Where(evt => evt.IsBullish == bullish)
                        .Where(evt => typeSet.Contains(evt.EventType))
                        .Where(evt => IsRecentBacktestStrategyEvent(symbolName, evt)));
            }

            var latest = candidates
                .OrderByDescending(evt => evt.BarTime)
                .ThenByDescending(evt => evt.Score)
                .FirstOrDefault();
            if (latest.BarTime == DateTime.MinValue)
                return false;

            selectedEvent = latest;
            return true;
        }

        private bool TryBuildSuggestedLevelsPlan(Symbol symbol, string symbolName, TradeType tradeType, double entryPrice, int slRank, int tpRank, string profileRaw, out ChartTradePlan plan)
        {
            plan = new ChartTradePlan { IsValid = false, StructureTfLabel = GetChartTradeStructureTfLabel(profileRaw) };
            if (symbol == null || string.IsNullOrWhiteSpace(symbolName) || !IsFiniteNumber(entryPrice) || entryPrice <= 0)
                return false;

            var stopCandidates = GetRankedChartStructuralLevels(symbol, symbolName, tradeType == TradeType.Buy, entryPrice, profileRaw);
            var targetCandidates = GetRankedChartStructuralLevels(symbol, symbolName, tradeType != TradeType.Buy, entryPrice, profileRaw);
            if (stopCandidates.Count == 0 || targetCandidates.Count == 0)
                return false;

            var stopIndex = Math.Max(0, Math.Min(stopCandidates.Count - 1, Math.Max(0, slRank - 1)));
            var targetIndex = Math.Max(0, Math.Min(targetCandidates.Count - 1, Math.Max(0, tpRank - 1)));
            var adjusted = ApplyChartProtectionBiasAndRisk(symbol, tradeType, entryPrice, stopCandidates[stopIndex].Price, targetCandidates[targetIndex].Price);
            if (adjusted == null)
                return false;

            var risk = Math.Abs(entryPrice - adjusted.Item1);
            var reward = Math.Abs(adjusted.Item2 - entryPrice);
            if (risk <= 0 || reward <= 0)
                return false;

            plan = new ChartTradePlan
            {
                IsValid = true,
                EntryLabel = string.Format(CultureInfo.InvariantCulture, "rank{0}/rank{1}", stopIndex + 1, targetIndex + 1),
                StructureTfLabel = GetChartTradeStructureTfLabel(profileRaw),
                Entry = NormalizePriceToSymbol(symbol, entryPrice),
                StopLoss = NormalizePriceToSymbol(symbol, adjusted.Item1),
                TakeProfit = NormalizePriceToSymbol(symbol, adjusted.Item2),
                RewardRisk = reward / risk
            };
            return true;
        }

        private double ResolveThreeCandlesStopLossPrice(Symbol symbol, Bars sourceBars, int candleIndex, int startIndex, int endIndex, double entryPrice, TradeType tradeType)
        {
            if (symbol == null || sourceBars == null || candleIndex < 0 || candleIndex >= sourceBars.Count)
                return 0;

            var rawStop = tradeType == TradeType.Buy
                ? Math.Min(sourceBars.LowPrices[candleIndex], Math.Min(sourceBars.OpenPrices[candleIndex], sourceBars.ClosePrices[candleIndex]))
                : Math.Max(sourceBars.HighPrices[candleIndex], Math.Max(sourceBars.OpenPrices[candleIndex], sourceBars.ClosePrices[candleIndex]));
            if (startIndex < 0)
                startIndex = 0;
            if (endIndex >= sourceBars.Count)
                endIndex = sourceBars.Count - 1;

            if (tradeType == TradeType.Buy && rawStop >= entryPrice)
            {
                for (var i = startIndex; i <= endIndex; i++)
                    rawStop = Math.Min(rawStop, sourceBars.LowPrices[i]);
            }
            else if (tradeType == TradeType.Sell && rawStop <= entryPrice)
            {
                for (var i = startIndex; i <= endIndex; i++)
                    rawStop = Math.Max(rawStop, sourceBars.HighPrices[i]);
            }

            return NormalizePriceToSymbol(symbol, rawStop);
        }

        private string GetStrategyRuntimeTag()
        {
            return IsBacktestingRuntime() ? "Backtest" : "Live";
        }

        private void LogStrategyInfoOnce(string strategyId, string symbolName, string message)
        {
            var barTime = Bars != null && Bars.Count > 0 ? Bars.OpenTimes[Math.Max(0, Bars.Count - 1)] : Server.Time;
            var eventKey = string.Format(CultureInfo.InvariantCulture, "INFO|{0}|{1}|{2}|{3}|{4}", GetStrategyRuntimeTag(), strategyId, symbolName.ToUpperInvariant(), message, barTime.Ticks);
            if (_backtestStrategyHandledEventKeys.Contains(eventKey))
                return;

            SafePrint("[{0}] {1} {2}: {3}", GetStrategyRuntimeTag(), strategyId, symbolName, message);
            _backtestStrategyHandledEventKeys.Add(eventKey);
        }

        private void LogStrategySkip(string strategyId, string symbolName, string message)
        {
        }

        private void LogStrategyReject(string strategyId, string symbolName, string message)
        {
            SafePrint("[{0}] Reject {1} {2}: {3}", GetStrategyRuntimeTag(), strategyId, symbolName, message);
        }

        private bool MatchesStrategyExposure(string strategyId, string label, string comment)
        {
            if (string.IsNullOrWhiteSpace(strategyId))
                return true;

            var normalizedStrategyId = strategyId.Trim().ToLowerInvariant();
            var normalizedLabel = string.IsNullOrWhiteSpace(label) ? "" : label.Trim().ToLowerInvariant();
            var normalizedComment = string.IsNullOrWhiteSpace(comment) ? "" : comment.Trim().ToLowerInvariant();

            return normalizedLabel.Contains(normalizedStrategyId) || normalizedComment.Contains(normalizedStrategyId);
        }

        private bool IsStrategyManagedExposure(string label, string comment)
        {
            var normalizedLabel = string.IsNullOrWhiteSpace(label) ? "" : label.Trim();
            var normalizedComment = string.IsNullOrWhiteSpace(comment) ? "" : comment.Trim();

            return normalizedLabel.StartsWith("BT_", StringComparison.OrdinalIgnoreCase) ||
                   normalizedComment.StartsWith("live_", StringComparison.OrdinalIgnoreCase) ||
                   normalizedComment.StartsWith("backtest_", StringComparison.OrdinalIgnoreCase);
        }

        private void TrackStrategyPositionMarkers()
        {
            if (Positions == null)
                return;

            var currentIds = new HashSet<long>();
            foreach (var position in Positions)
            {
                if (position == null || !IsStrategyManagedExposure(position.Label, position.Comment))
                    continue;

                currentIds.Add(position.Id);

                if (_trackedStrategyPositions.ContainsKey(position.Id))
                    continue;

                var entryTime = ReadDateTimeMember(position, "EntryTime", "OpeningTime", "OpenTime");
                if (entryTime == DateTime.MinValue)
                    entryTime = Server.Time;

                _trackedStrategyPositions[position.Id] = new StrategyPositionSnapshot
                {
                    PositionId = position.Id,
                    SymbolName = position.SymbolName,
                    TradeType = position.TradeType,
                    EntryPrice = position.EntryPrice,
                    EntryTime = entryTime,
                    Label = position.Label,
                    Comment = position.Comment
                };

                AddStrategyChartMarker(new StrategyChartMarker
                {
                    PositionId = position.Id,
                    SymbolName = position.SymbolName,
                    TradeType = position.TradeType,
                    Kind = StrategyMarkerKind.Entry,
                    Time = entryTime,
                    Price = position.EntryPrice,
                    Pnl = 0,
                    IsWinning = false,
                    Text = position.TradeType == TradeType.Buy ? "B" : "S"
                });
            }

            var closedIds = _trackedStrategyPositions.Keys.Where(id => !currentIds.Contains(id)).ToList();
            foreach (var closedId in closedIds)
            {
                var snapshot = _trackedStrategyPositions[closedId];
                var historyDeal = History != null
                    ? History
                        .Where(deal => deal != null && deal.PositionId == closedId)
                        .OrderByDescending(deal => ReadDateTimeMember(deal, "ClosingTime", "CloseTime", "Time"))
                        .FirstOrDefault()
                    : null;

                var exitTime = historyDeal != null
                    ? ReadDateTimeMember(historyDeal, "ClosingTime", "CloseTime", "Time")
                    : Server.Time;
                if (exitTime == DateTime.MinValue)
                    exitTime = Server.Time;

                var exitPrice = historyDeal != null
                    ? ReadDoubleMember(historyDeal, "ClosingPrice", "ClosePrice", "ExitPrice")
                    : snapshot.EntryPrice;
                if (!(exitPrice > 0))
                    exitPrice = snapshot.EntryPrice;

                var pnl = historyDeal != null && !double.IsNaN(historyDeal.NetProfit)
                    ? historyDeal.NetProfit
                    : 0;

                AddStrategyChartMarker(new StrategyChartMarker
                {
                    PositionId = snapshot.PositionId,
                    SymbolName = snapshot.SymbolName,
                    TradeType = snapshot.TradeType,
                    Kind = StrategyMarkerKind.Exit,
                    Time = exitTime,
                    Price = exitPrice,
                    Pnl = pnl,
                    IsWinning = pnl >= 0,
                    Text = string.Format(CultureInfo.InvariantCulture, "{0}{1}", pnl >= 0 ? "+" : "", pnl.ToString("F0", CultureInfo.InvariantCulture))
                });

                _trackedStrategyPositions.Remove(closedId);
            }
        }

        private void AddStrategyChartMarker(StrategyChartMarker marker)
        {
            if (marker.Time == DateTime.MinValue || string.IsNullOrWhiteSpace(marker.SymbolName))
                return;

            var duplicateExists = _strategyChartMarkers.Any(existing =>
                existing.PositionId == marker.PositionId &&
                existing.Kind == marker.Kind &&
                existing.TradeType == marker.TradeType &&
                string.Equals(existing.SymbolName, marker.SymbolName, StringComparison.OrdinalIgnoreCase) &&
                Math.Abs((existing.Time - marker.Time).TotalSeconds) < 1);
            if (duplicateExists)
                return;

            _strategyChartMarkers.Add(marker);
            if (_strategyChartMarkers.Count > 200)
                _strategyChartMarkers.RemoveRange(0, _strategyChartMarkers.Count - 200);
        }

        private int CountStrategyManagedOpenPositions()
        {
            if (Positions == null)
                return 0;

            return Positions.Count(p =>
                p != null &&
                IsStrategyManagedExposure(p.Label, p.Comment));
        }

        private void EnforceLiveStrategyProtectionSafety()
        {
            if (IsBacktestingRuntime() || !EnableLiveStrategyTrading || Positions == null)
                return;

            foreach (var position in Positions.ToList())
            {
                if (position == null)
                    continue;
                if (!IsStrategyManagedExposure(position.Label, position.Comment))
                    continue;

                var hasStopLoss = position.StopLoss.HasValue && position.StopLoss.Value > 0;
                if (hasStopLoss)
                    continue;

                SafeLog(
                    "ERROR",
                    "[Live][Safety] Closing unprotected strategy position #{0} {1} {2} label={3} comment={4}",
                    position.Id,
                    position.SymbolName,
                    position.TradeType,
                    position.Label,
                    position.Comment);

                var closeResult = ClosePosition(position);
                if (closeResult != null && closeResult.IsSuccessful)
                {
                    var positionSymbol = ResolveLoadedSymbol(position.SymbolName);
                    var positionLots = positionSymbol != null ? positionSymbol.VolumeInUnitsToQuantity(position.VolumeInUnits) : 0;
                    LogStructuredTradeEvent(
                        "live",
                        "FAILED",
                        position.SymbolName,
                        position.TradeType == TradeType.Buy ? "BUY" : "SELL",
                        "MARKET",
                        positionLots,
                        position.EntryPrice,
                        0,
                        position.TakeProfit ?? 0,
                        position.Id.ToString(CultureInfo.InvariantCulture),
                        "safety_close_unprotected_position");
                }
                else
                {
                    SafeLog(
                        "ERROR",
                        "[Live][Safety] Close failed for unprotected strategy position #{0}: {1}",
                        position.Id,
                        closeResult != null ? Convert.ToString(closeResult.Error, CultureInfo.InvariantCulture) : "null_result");
                }
            }
        }

        private int CountStrategyManagedIdeaPositions(string symbolName, TradeType tradeType)
        {
            if (Positions == null || string.IsNullOrWhiteSpace(symbolName))
                return 0;

            var normalizedSymbol = symbolName.Trim();
            return Positions.Count(p =>
                p != null &&
                string.Equals(p.SymbolName, normalizedSymbol, StringComparison.OrdinalIgnoreCase) &&
                p.TradeType == tradeType &&
                IsStrategyManagedExposure(p.Label, p.Comment));
        }

        private bool TryPassStrategyPositionCaps(string symbolName, TradeType tradeType, out string rejectReason)
        {
            rejectReason = "";

            var maxIdea = Math.Max(0, MaxPositionsPerIdea);
            if (maxIdea > 0)
            {
                var existingIdeaPositions = CountStrategyManagedIdeaPositions(symbolName, tradeType);
                if (existingIdeaPositions >= maxIdea)
                {
                    rejectReason = string.Format(
                        CultureInfo.InvariantCulture,
                        "max_pos_per_idea {0}>={1}; symbol={2}; side={3}",
                        existingIdeaPositions,
                        maxIdea,
                        string.IsNullOrWhiteSpace(symbolName) ? "" : symbolName.Trim().ToUpperInvariant(),
                        tradeType == TradeType.Buy ? "BUY" : "SELL");
                    return false;
                }
            }

            var maxTotal = Math.Max(0, MaxPositionsTotal);
            if (maxTotal > 0)
            {
                var existingTotalPositions = CountStrategyManagedOpenPositions();
                if (existingTotalPositions >= maxTotal)
                {
                    rejectReason = string.Format(
                        CultureInfo.InvariantCulture,
                        "max_pos_total {0}>={1}",
                        existingTotalPositions,
                        maxTotal);
                    return false;
                }
            }

            return true;
        }

        private bool HasExistingStrategyExposure(string symbolName, string strategyId)
        {
            if (string.IsNullOrWhiteSpace(symbolName))
                return false;

            if (SelectedStrategyExposureMode == StrategyExposureMode.Off)
                return false;

            var normalizedSymbol = symbolName.Trim();
            if (Positions.Any(p =>
                    p != null &&
                    string.Equals(p.SymbolName, normalizedSymbol, StringComparison.OrdinalIgnoreCase) &&
                    MatchesStrategyExposure(strategyId, p.Label, p.Comment)))
                return true;

            if (SelectedStrategyExposureMode == StrategyExposureMode.PositionAndOrder)
            {
                if (PendingOrders.Any(o =>
                        o != null &&
                        string.Equals(o.SymbolName, normalizedSymbol, StringComparison.OrdinalIgnoreCase) &&
                        MatchesStrategyExposure(strategyId, o.Label, o.Comment)))
                    return true;
            }

            return false;
        }

        private string GetStrategyExposureBlockMessage()
        {
            switch (SelectedStrategyExposureMode)
            {
                case StrategyExposureMode.PositionAndOrder:
                    return "existing position or pending order";
                case StrategyExposureMode.PositionOnly:
                    return "existing position";
                default:
                    return "existing exposure";
            }
        }

        private IEnumerable<TimeFrame> GetBacktestStrategyHigherTimeFrames(TimeFrame baseTimeFrame)
        {
            return GetEnabledAutoHigherTimeframes(baseTimeFrame)
                .Distinct()
                .OrderBy(tf => TimeFrameToMinutes(tf))
                .ToList();
        }

        private IEnumerable<TimeFrame> GetBacktestStrategyLowerTimeFrames(TimeFrame baseTimeFrame)
        {
            var chartTfMinutes = TimeFrameToMinutes(baseTimeFrame);
            var frames = new List<TimeFrame>
            {
                TimeFrame.Minute,
                TimeFrame.Minute5,
                TimeFrame.Minute15,
                TimeFrame.Hour,
                TimeFrame.Hour4,
                TimeFrame.Daily
            };

            var filtered = frames
                .Where(tf => tf != null)
                .Where(tf => TimeFrameToMinutes(tf) < chartTfMinutes)
                .Distinct()
                .OrderBy(tf => TimeFrameToMinutes(tf))
                .ToList();

            if (filtered.Count == 0)
                filtered.Add(baseTimeFrame);

            return filtered;
        }

        private bool IsEligibleBacktestStrategyEventType(CanonicalEventType eventType)
        {
            return eventType == CanonicalEventType.Choch ||
                   eventType == CanonicalEventType.Bos ||
                   eventType == CanonicalEventType.SweepReclaim ||
                   eventType == CanonicalEventType.Rejection ||
                   eventType == CanonicalEventType.Breakout ||
                   eventType == CanonicalEventType.Continuation ||
                   eventType == CanonicalEventType.Impulse;
        }

        private bool IsRecentBacktestStrategyEvent(string symbolName, CanonicalMarketEvent evt)
        {
            try
            {
                var bars = MarketData.GetBars(evt.SourceTimeFrame, symbolName);
                if (bars == null || bars.Count < 3)
                    return false;
                var thresholdTime = bars.OpenTimes[Math.Max(0, bars.Count - 3)];
                return evt.BarTime >= thresholdTime;
            }
            catch
            {
                return false;
            }
        }

        private bool TryGetLatestBacktestStrategyEvent(string symbolName, TimeFrame baseTimeFrame, out CanonicalMarketEvent selectedEvent)
        {
            selectedEvent = default(CanonicalMarketEvent);
            if (string.IsNullOrWhiteSpace(symbolName))
                return false;

            var candidates = new List<CanonicalMarketEvent>();
            foreach (var timeFrame in GetBacktestStrategyHigherTimeFrames(baseTimeFrame))
            {
                candidates.AddRange(
                    GetCanonicalEventsForSymbolTimeFrame(symbolName, timeFrame, 12)
                        .Where(evt => IsEligibleBacktestStrategyEventType(evt.EventType))
                        .Where(evt => IsRecentBacktestStrategyEvent(symbolName, evt)));
            }

            var latest = candidates
                .OrderByDescending(evt => evt.BarTime)
                .ThenByDescending(evt => evt.Score)
                .FirstOrDefault();
            if (latest.BarTime == DateTime.MinValue)
                return false;

            selectedEvent = latest;
            return true;
        }

        private bool TryGetLatestBacktestStrategyEventForTimeFrames(string symbolName, IEnumerable<TimeFrame> timeFrames, out CanonicalMarketEvent selectedEvent)
        {
            selectedEvent = default(CanonicalMarketEvent);
            if (string.IsNullOrWhiteSpace(symbolName) || timeFrames == null)
                return false;

            var candidates = new List<CanonicalMarketEvent>();
            foreach (var timeFrame in timeFrames.Distinct())
            {
                candidates.AddRange(
                    GetCanonicalEventsForSymbolTimeFrame(symbolName, timeFrame, 12)
                        .Where(evt => IsEligibleBacktestStrategyEventType(evt.EventType))
                        .Where(evt => IsRecentBacktestStrategyEvent(symbolName, evt)));
            }

            var latest = candidates
                .OrderByDescending(evt => evt.BarTime)
                .ThenByDescending(evt => evt.Score)
                .FirstOrDefault();
            if (latest.BarTime == DateTime.MinValue)
                return false;

            selectedEvent = latest;
            return true;
        }

        private bool TryGetBacktestBiasConfluence(string symbolName, bool wantBullish, out string reason)
        {
            reason = "";
            if (string.IsNullOrWhiteSpace(symbolName))
            {
                reason = "symbol_missing";
                return false;
            }

            var trendBias = GetSymbolTrendBias(symbolName);
            var dailyBias = trendBias.Item1;
            var h4Bias = trendBias.Item2;
            var wantsPositive = wantBullish;

            var dailyAligned = wantsPositive ? dailyBias >= 2 : dailyBias <= -2;
            var h4Aligned = wantsPositive ? h4Bias >= 2 : h4Bias <= -2;
            if (dailyAligned && h4Aligned)
                return true;

            reason = string.Format(
                CultureInfo.InvariantCulture,
                "bias_not_aligned 1D={0} 4H={1} expected={2}",
                dailyBias,
                h4Bias,
                wantBullish ? "bullish" : "bearish");
            return false;
        }

        private void ExecuteBacktestStrategyMarketEntry(string symbolName, CanonicalMarketEvent strategyEvent, string strategyId, bool requireHtfBiasConfluence)
        {
            if (!ShouldAllowStrategySignalTime(strategyEvent.BarTime))
            {
                LogStrategySkip(strategyId, symbolName, GetStrategyTradingTimeBlockReason(strategyEvent.BarTime));
                return;
            }

            var eventKey = string.Format(
                CultureInfo.InvariantCulture,
                "{0}|{1}|{2}|{3}|{4}|{5}",
                strategyId,
                symbolName.ToUpperInvariant(),
                strategyEvent.SourceTimeFrame,
                strategyEvent.EventType,
                strategyEvent.IsBullish ? "B" : "S",
                strategyEvent.BarTime.Ticks);
            if (_backtestStrategyHandledEventKeys.Contains(eventKey))
                return;

            if (requireHtfBiasConfluence)
            {
                string confluenceReason;
                if (!TryGetBacktestBiasConfluence(symbolName, strategyEvent.IsBullish, out confluenceReason))
                {
                    LogStrategySkip(strategyId, symbolName, confluenceReason);
                    _backtestStrategyHandledEventKeys.Add(eventKey);
                    return;
                }
            }

            var symbol = ResolveLoadedSymbol(symbolName);
            if (symbol == null)
                return;

            var tradeType = strategyEvent.IsBullish ? TradeType.Buy : TradeType.Sell;
            var action = strategyEvent.IsBullish ? "BUY" : "SELL";

            if (HasExistingStrategyExposure(symbolName, strategyId))
            {
                _backtestStrategyHandledEventKeys.Add(eventKey);
                LogStrategySkip(strategyId, symbolName, GetStrategyExposureBlockMessage());
                return;
            }

            string positionCapRejectReason;
            if (!TryPassStrategyPositionCaps(symbolName, tradeType, out positionCapRejectReason))
            {
                LogStrategyReject(strategyId, symbolName, positionCapRejectReason);
                _backtestStrategyHandledEventKeys.Add(eventKey);
                return;
            }

            var executionPrice = tradeType == TradeType.Buy ? symbol.Ask : symbol.Bid;
            if (executionPrice <= 0)
                return;

            var profileRaw = GetChartTradeProfileRaw();
            var protection = BuildSharedChartProtectionPrices(symbol, symbolName, tradeType, executionPrice, Math.Max(MinStopPips, 100.0), profileRaw);
            if (protection == null)
            {
                LogStrategySkip(strategyId, symbolName, "no valid SL/TP from structure");
                _backtestStrategyHandledEventKeys.Add(eventKey);
                return;
            }

            var sl = protection.Item1;
            var tp = protection.Item2;
            string protectionReason;
            if (!TryValidateProtectionPrices(symbol, action, executionPrice, sl, tp, out protectionReason))
            {
                LogStrategySkip(strategyId, symbolName, protectionReason);
                _backtestStrategyHandledEventKeys.Add(eventKey);
                return;
            }

            var finalRiskMoney = ResolveChartFinalRiskMoney(profileRaw);
            var volumeUnits = ResolveChartTradeVolumeForRisk(symbol, tradeType, executionPrice, sl, finalRiskMoney, symbolName);
            if (volumeUnits < symbol.VolumeInUnitsMin)
            {
                LogStrategySkip(strategyId, symbolName, "volume below minimum for risk cap");
                _backtestStrategyHandledEventKeys.Add(eventKey);
                return;
            }

            double approvedSl;
            double approvedTp;
            double approvedVolumeUnits;
            double approvedRiskMoney;
            double marginEstimate;
            double marginBudget;
            string gateRejectReason;
            if (!TryPassSharedCreationGate(
                symbol,
                action,
                "market",
                0,
                executionPrice,
                sl,
                tp,
                volumeUnits,
                finalRiskMoney,
                finalRiskMoney,
                out approvedSl,
                out approvedTp,
                out approvedVolumeUnits,
                out approvedRiskMoney,
                out marginEstimate,
                out marginBudget,
                out gateRejectReason))
            {
                LogStrategyReject(strategyId, symbolName, gateRejectReason);
                if (IsStrictPropRiskTemplate())
                {
                    StopBacktestForPropRuleBreach("ENTRY", symbolName, gateRejectReason);
                    return;
                }
                _backtestStrategyHandledEventKeys.Add(eventKey);
                return;
            }

            double? slPips = symbol.PipSize > 0 ? (double?)Math.Round(Math.Abs(executionPrice - approvedSl) / symbol.PipSize, 2) : null;
            double? tpPips = symbol.PipSize > 0 ? (double?)Math.Round(Math.Abs(approvedTp - executionPrice) / symbol.PipSize, 2) : null;
            if (!slPips.HasValue || slPips.Value <= 0)
            {
                _backtestStrategyHandledEventKeys.Add(eventKey);
                return;
            }

            if (!ShouldStrategySubmitOrders())
            {
                SafePrint(
                    "[Strategy] Signal {0} {1} {2} from {3} {4} @ {5:F5} SL={6:F5} TP={7:F5} risk={8:F2}",
                    strategyId,
                    action,
                    symbolName,
                    GetMiniChartLabel(strategyEvent.SourceTimeFrame),
                    strategyEvent.EventType,
                    executionPrice,
                    approvedSl,
                    approvedTp,
                    approvedRiskMoney);
                _backtestStrategyHandledEventKeys.Add(eventKey);
                return;
            }

            var label = string.Format(
                CultureInfo.InvariantCulture,
                "BT_{0}_{1}_{2}",
                strategyId,
                GetMiniChartLabel(strategyEvent.SourceTimeFrame),
                strategyEvent.EventType.ToString().ToUpperInvariant());
            var requestedLots = symbol.VolumeInUnitsToQuantity(approvedVolumeUnits);
            LogStructuredTradeEvent(
                "backtest",
                "SUBMIT",
                symbolName,
                action,
                "MARKET",
                requestedLots,
                executionPrice,
                approvedSl,
                approvedTp,
                "",
                strategyId + ":" + strategyEvent.EventType);
            var result = ExecuteMarketOrder(tradeType, symbol.Name, approvedVolumeUnits, label, slPips, tpPips, (IsBacktestingRuntime() ? "backtest_" : "live_") + strategyId.ToLowerInvariant());
            if (result != null && result.IsSuccessful)
            {
                var finalApprovedSl = approvedSl;
                var finalApprovedTp = approvedTp;
                if (result.Position != null)
                {
                    ReanchorProtectionToFilledEntry(symbol, action, executionPrice, result.Position.EntryPrice, ref finalApprovedSl, ref finalApprovedTp);
                    string protectionError;
                    if (!TryEnsureStrategyPositionProtection(result.Position, symbol, action, finalApprovedSl, finalApprovedTp, out protectionError))
                    {
                        var closeProtectionResult = ClosePosition(result.Position);
                        var closeProtectionNote = closeProtectionResult != null && closeProtectionResult.IsSuccessful
                            ? "position_closed_after_protection_failure"
                            : "position_close_failed_after_protection_failure";
                        LogStructuredTradeEvent(
                            IsBacktestingRuntime() ? "backtest" : "live",
                            "FAILED",
                            symbolName,
                            action,
                            "MARKET",
                            requestedLots,
                            result.Position.EntryPrice,
                            finalApprovedSl,
                            finalApprovedTp,
                            result.Position.Id.ToString(CultureInfo.InvariantCulture),
                            protectionError + "; " + closeProtectionNote);
                        SafePrint("[Strategy] Entry failed {0} {1}: {2}; {3}", strategyId, symbolName, protectionError, closeProtectionNote);
                        _backtestStrategyHandledEventKeys.Add(eventKey);
                        return;
                    }
                }

                if (result.Position != null)
                {
                    var submittedSignal = new BacktestStrategySignal
                    {
                        IsValid = true,
                        StrategyId = strategyId,
                        SourceLabel = strategyEvent.EventType.ToString(),
                        TradeType = tradeType,
                        SourceTimeFrame = strategyEvent.SourceTimeFrame,
                        SignalTime = strategyEvent.BarTime,
                        UseLimitOrder = false,
                        EntryPrice = executionPrice,
                        StopLoss = finalApprovedSl,
                        TakeProfit = finalApprovedTp,
                        Note = ""
                    };
                    StoreBacktestExportTradeSnapshot(
                        result.Position.Id.ToString(CultureInfo.InvariantCulture),
                        submittedSignal,
                        approvedRiskMoney,
                        approvedVolumeUnits,
                        symbol.VolumeInUnitsToQuantity(approvedVolumeUnits));
                }
                LogStructuredTradeEvent(
                    IsBacktestingRuntime() ? "backtest" : "live",
                    "SUCCEEDED",
                    symbolName,
                    action,
                    "MARKET",
                    requestedLots,
                    result.Position != null ? result.Position.EntryPrice : executionPrice,
                    finalApprovedSl,
                    finalApprovedTp,
                    result.Position != null ? result.Position.Id.ToString(CultureInfo.InvariantCulture) : "",
                    strategyId + ":" + strategyEvent.EventType);
                SafePrint(
                    "[Strategy] Entry {0} {1} {2} from {3} {4} vol={5:F2} risk={6:F2}",
                    strategyId,
                    action,
                    symbolName,
                    GetMiniChartLabel(strategyEvent.SourceTimeFrame),
                    strategyEvent.EventType,
                    approvedVolumeUnits,
                    approvedRiskMoney);
                _backtestStrategyHandledEventKeys.Add(eventKey);
            }
            else
            {
                LogStructuredTradeEvent(
                    IsBacktestingRuntime() ? "backtest" : "live",
                    "FAILED",
                    symbolName,
                    action,
                    "MARKET",
                    requestedLots,
                    executionPrice,
                    approvedSl,
                    approvedTp,
                    "",
                    result != null ? Convert.ToString(result.Error, CultureInfo.InvariantCulture) : "null_result");
                SafePrint("[Strategy] Entry failed {0} {1}: {2}", strategyId, symbolName, result != null ? Convert.ToString(result.Error, CultureInfo.InvariantCulture) : "null_result");
            }
        }

        private double GetStrategyEntryBufferMultiplier()
        {
            switch (SelectedStrategyEntryType)
            {
                case StrategyEntryType._0_1_limit:
                    return 0.1;
                case StrategyEntryType._0_2_limit:
                    return 0.2;
                case StrategyEntryType._0_3_limit:
                    return 0.3;
                default:
                    return 0.0;
            }
        }

        private void ApplySharedStrategyEntryType(Symbol symbol, TradeType tradeType, double executionPrice, ref bool useLimitOrder, ref double entryPrice, ref double stopLoss, ref double takeProfit)
        {
            if (symbol == null || entryPrice <= 0 || stopLoss <= 0 || takeProfit <= 0)
                return;

            var originalRiskDistance = Math.Abs(entryPrice - stopLoss);
            var originalRewardDistance = Math.Abs(takeProfit - entryPrice);
            if (!(originalRiskDistance > 0) || !(originalRewardDistance > 0))
                return;

            var bufferMultiplier = GetStrategyEntryBufferMultiplier();
            if (bufferMultiplier <= 0)
            {
                useLimitOrder = false;
                entryPrice = executionPrice;
                if (tradeType == TradeType.Buy)
                {
                    stopLoss = NormalizePriceToSymbol(symbol, entryPrice - originalRiskDistance);
                    takeProfit = NormalizePriceToSymbol(symbol, entryPrice + originalRewardDistance);
                }
                else
                {
                    stopLoss = NormalizePriceToSymbol(symbol, entryPrice + originalRiskDistance);
                    takeProfit = NormalizePriceToSymbol(symbol, entryPrice - originalRewardDistance);
                }
                return;
            }

            useLimitOrder = true;
            var buffer = originalRiskDistance * bufferMultiplier;
            if (!(buffer > 0))
                return;

            if (tradeType == TradeType.Buy)
            {
                entryPrice = NormalizePriceToSymbol(symbol, entryPrice - buffer);
                stopLoss = NormalizePriceToSymbol(symbol, stopLoss - buffer);
                takeProfit = NormalizePriceToSymbol(symbol, takeProfit - buffer);
            }
            else
            {
                entryPrice = NormalizePriceToSymbol(symbol, entryPrice + buffer);
                stopLoss = NormalizePriceToSymbol(symbol, stopLoss + buffer);
                takeProfit = NormalizePriceToSymbol(symbol, takeProfit + buffer);
            }
        }

        private void ExecuteBacktestStrategySignal(string symbolName, BacktestStrategySignal signal, bool requireHtfBiasConfluence)
        {
            if (!string.IsNullOrWhiteSpace(signal.SymbolName))
                symbolName = signal.SymbolName;

            if (!signal.IsValid || string.IsNullOrWhiteSpace(symbolName))
                return;

            if (!ShouldAllowStrategySignalTime(signal.SignalTime))
            {
                LogStrategySkip(signal.StrategyId, symbolName, GetStrategyTradingTimeBlockReason(signal.SignalTime));
                return;
            }

            var eventKey = string.Format(
                CultureInfo.InvariantCulture,
                "{0}|{1}|{2}|{3}|{4}|{5}|{6}",
                signal.StrategyId ?? "CUSTOM",
                symbolName.ToUpperInvariant(),
                signal.SourceTimeFrame,
                signal.TradeType,
                signal.UseLimitOrder ? "LMT" : "MKT",
                signal.EntryPrice.ToString("F5", CultureInfo.InvariantCulture),
                signal.SignalTime.Ticks);
            if (_backtestStrategyHandledEventKeys.Contains(eventKey))
                return;

            var wantBullish = signal.TradeType == TradeType.Buy;
            if (requireHtfBiasConfluence)
            {
                string confluenceReason;
                if (!TryGetBacktestBiasConfluence(symbolName, wantBullish, out confluenceReason))
                {
                    LogStrategySkip(signal.StrategyId, symbolName, confluenceReason);
                    _backtestStrategyHandledEventKeys.Add(eventKey);
                    return;
                }
            }

            if (HasExistingStrategyExposure(symbolName, signal.StrategyId))
            {
                LogStrategySkip(signal.StrategyId, symbolName, GetStrategyExposureBlockMessage());
                _backtestStrategyHandledEventKeys.Add(eventKey);
                return;
            }

            string positionCapRejectReason;
            if (!TryPassStrategyPositionCaps(symbolName, signal.TradeType, out positionCapRejectReason))
            {
                LogStrategyReject(signal.StrategyId, symbolName, positionCapRejectReason);
                _backtestStrategyHandledEventKeys.Add(eventKey);
                return;
            }

            var symbol = ResolveLoadedSymbol(symbolName);
            if (symbol == null)
                return;

            var action = signal.TradeType == TradeType.Buy ? "BUY" : "SELL";
            var executionPrice = signal.TradeType == TradeType.Buy ? symbol.Ask : symbol.Bid;
            if (!IsFiniteNumber(executionPrice) || executionPrice <= 0)
                return;

            var tradableRejectReason = DetectSymbolTradeAvailabilityReason(symbol);
            if (!string.IsNullOrWhiteSpace(tradableRejectReason))
            {
                LogStrategyReject(signal.StrategyId, symbolName, DescribeTradeAvailabilityReason(tradableRejectReason, symbolName));
                _backtestStrategyHandledEventKeys.Add(eventKey);
                return;
            }

            var referencePrice = signal.UseLimitOrder && signal.EntryPrice > 0
                ? NormalizePriceToSymbol(symbol, signal.EntryPrice)
                : executionPrice;
            if (signal.UseLimitOrder)
            {
                if (signal.TradeType == TradeType.Buy && referencePrice >= executionPrice)
                {
                    LogStrategyReject(signal.StrategyId, symbolName, "buy_limit_not_below_market");
                    _backtestStrategyHandledEventKeys.Add(eventKey);
                    return;
                }

                if (signal.TradeType == TradeType.Sell && referencePrice <= executionPrice)
                {
                    LogStrategyReject(signal.StrategyId, symbolName, "sell_limit_not_above_market");
                    _backtestStrategyHandledEventKeys.Add(eventKey);
                    return;
                }
            }

            var profileRaw = GetStrategyProfileRaw(signal.StrategyMode, signal.SourceTimeFrame);
            var sl = signal.StopLoss;
            var tp = signal.TakeProfit;
            if (!(sl > 0) || !(tp > 0))
            {
                var fallbackProtection = BuildSharedChartProtectionPrices(symbol, symbolName, signal.TradeType, referencePrice, Math.Max(MinStopPips, 100.0), profileRaw);
                if (fallbackProtection == null)
                {
                    LogStrategySkip(signal.StrategyId, symbolName, "no valid SL/TP from structure");
                    _backtestStrategyHandledEventKeys.Add(eventKey);
                    return;
                }

                sl = fallbackProtection.Item1;
                tp = fallbackProtection.Item2;
            }

            string protectionReason;
            if (!TryValidateProtectionPrices(symbol, action, referencePrice, sl, tp, out protectionReason))
            {
                LogStrategySkip(signal.StrategyId, symbolName, protectionReason);
                _backtestStrategyHandledEventKeys.Add(eventKey);
                return;
            }

            var effectiveUseLimitOrder = signal.UseLimitOrder;
            var effectiveEntryPrice = referencePrice;
            ApplySharedStrategyEntryType(symbol, signal.TradeType, executionPrice, ref effectiveUseLimitOrder, ref effectiveEntryPrice, ref sl, ref tp);

            if (effectiveUseLimitOrder)
            {
                if (signal.TradeType == TradeType.Buy && effectiveEntryPrice >= executionPrice)
                {
                    LogStrategyReject(signal.StrategyId, symbolName, "buy_limit_not_below_market");
                    _backtestStrategyHandledEventKeys.Add(eventKey);
                    return;
                }

                if (signal.TradeType == TradeType.Sell && effectiveEntryPrice <= executionPrice)
                {
                    LogStrategyReject(signal.StrategyId, symbolName, "sell_limit_not_above_market");
                    _backtestStrategyHandledEventKeys.Add(eventKey);
                    return;
                }
            }

            if (!TryValidateProtectionPrices(symbol, action, effectiveEntryPrice, sl, tp, out protectionReason))
            {
                LogStrategySkip(signal.StrategyId, symbolName, protectionReason);
                _backtestStrategyHandledEventKeys.Add(eventKey);
                return;
            }

            var finalRiskMoney = ResolveStrategyRiskMoney(signal.StrategyMode, profileRaw);
            var volumeUnits = ResolveChartTradeVolumeForRisk(symbol, signal.TradeType, effectiveEntryPrice, sl, finalRiskMoney, symbolName);
            if (volumeUnits < symbol.VolumeInUnitsMin)
            {
                LogStrategySkip(signal.StrategyId, symbolName, "volume below minimum for risk cap");
                _backtestStrategyHandledEventKeys.Add(eventKey);
                return;
            }

            double approvedSl;
            double approvedTp;
            double approvedVolumeUnits;
            double approvedRiskMoney;
            double marginEstimate;
            double marginBudget;
            string gateRejectReason;
            if (!TryPassSharedCreationGate(
                symbol,
                action,
                effectiveUseLimitOrder ? "limit" : "market",
                effectiveUseLimitOrder ? effectiveEntryPrice : 0,
                executionPrice,
                sl,
                tp,
                volumeUnits,
                finalRiskMoney,
                finalRiskMoney,
                out approvedSl,
                out approvedTp,
                out approvedVolumeUnits,
                out approvedRiskMoney,
                out marginEstimate,
                out marginBudget,
                out gateRejectReason))
            {
                LogStrategyReject(signal.StrategyId, symbolName, gateRejectReason);
                if (IsStrictPropRiskTemplate())
                {
                    StopBacktestForPropRuleBreach("ENTRY", symbolName, gateRejectReason);
                    return;
                }
                _backtestStrategyHandledEventKeys.Add(eventKey);
                return;
            }

            if (!ShouldStrategySubmitOrders())
            {
                SafePrint(
                    "[Strategy] Signal {0} {1} {2} {3} @ {4:F5} SL={5:F5} TP={6:F5} risk={7:F2}{8}",
                    signal.StrategyId,
                    action,
                    effectiveUseLimitOrder ? "LIMIT" : "MARKET",
                    symbolName,
                    effectiveEntryPrice,
                    approvedSl,
                    approvedTp,
                    approvedRiskMoney,
                    string.IsNullOrWhiteSpace(signal.Note) ? "" : " " + signal.Note);
                _backtestStrategyHandledEventKeys.Add(eventKey);
                return;
            }

            TradeResult result = null;
            if (effectiveUseLimitOrder)
            {
                var slPips = Math.Round(Math.Abs(effectiveEntryPrice - approvedSl) / symbol.PipSize, 2);
                var tpPips = Math.Round(Math.Abs(approvedTp - effectiveEntryPrice) / symbol.PipSize, 2);
                var requestedLots = symbol.VolumeInUnitsToQuantity(approvedVolumeUnits);
                LogStructuredTradeEvent(
                    IsBacktestingRuntime() ? "backtest" : "live",
                    "SUBMIT",
                    symbolName,
                    action,
                    "LIMIT",
                    requestedLots,
                    effectiveEntryPrice,
                    approvedSl,
                    approvedTp,
                    "",
                    signal.StrategyId);
                result = PlaceLimitOrder(
                    signal.TradeType,
                    symbol.Name,
                    approvedVolumeUnits,
                    effectiveEntryPrice,
                    string.Format(CultureInfo.InvariantCulture, "BT_{0}_LMT", signal.StrategyId),
                    (double?)slPips,
                    (double?)tpPips,
                    (ProtectionType?)null,
                    null,
                    (IsBacktestingRuntime() ? "backtest_" : "live_") + (signal.StrategyId ?? "strategy").ToLowerInvariant());

                if (result != null && result.IsSuccessful && result.PendingOrder != null)
                {
                    string modifyError;
                    if (!TryApplyPendingOrderProtection(result.PendingOrder, symbol, action, approvedSl, approvedTp, out modifyError))
                    {
                        SafePrint("[Strategy] Entry failed {0} {1}: {2}", signal.StrategyId, symbolName, modifyError);
                        return;
                    }
                }
            }
            else
            {
                var slPips = Math.Round(Math.Abs(effectiveEntryPrice - approvedSl) / symbol.PipSize, 2);
                var tpPips = Math.Round(Math.Abs(approvedTp - effectiveEntryPrice) / symbol.PipSize, 2);
                var requestedLots = symbol.VolumeInUnitsToQuantity(approvedVolumeUnits);
                LogStructuredTradeEvent(
                    IsBacktestingRuntime() ? "backtest" : "live",
                    "SUBMIT",
                    symbolName,
                    action,
                    "MARKET",
                    requestedLots,
                    effectiveEntryPrice,
                    approvedSl,
                    approvedTp,
                    "",
                    signal.StrategyId);
                result = ExecuteMarketOrder(
                    signal.TradeType,
                    symbol.Name,
                    approvedVolumeUnits,
                    string.Format(CultureInfo.InvariantCulture, "BT_{0}_MKT", signal.StrategyId),
                    (double?)slPips,
                    (double?)tpPips,
                    (IsBacktestingRuntime() ? "backtest_" : "live_") + (signal.StrategyId ?? "strategy").ToLowerInvariant());
            }

            if (result != null && result.IsSuccessful)
            {
                var finalApprovedSl = approvedSl;
                var finalApprovedTp = approvedTp;
                if (result.Position != null)
                {
                    if (!effectiveUseLimitOrder)
                        ReanchorProtectionToFilledEntry(symbol, action, effectiveEntryPrice, result.Position.EntryPrice, ref finalApprovedSl, ref finalApprovedTp);
                    string protectionError;
                    if (!TryEnsureStrategyPositionProtection(result.Position, symbol, action, finalApprovedSl, finalApprovedTp, out protectionError))
                    {
                        var closeProtectionResult = ClosePosition(result.Position);
                        var closeProtectionNote = closeProtectionResult != null && closeProtectionResult.IsSuccessful
                            ? "position_closed_after_protection_failure"
                            : "position_close_failed_after_protection_failure";
                        LogStructuredTradeEvent(
                            IsBacktestingRuntime() ? "backtest" : "live",
                            "FAILED",
                            symbolName,
                            action,
                            effectiveUseLimitOrder ? "LIMIT" : "MARKET",
                            symbol.VolumeInUnitsToQuantity(approvedVolumeUnits),
                            result.Position.EntryPrice,
                            finalApprovedSl,
                            finalApprovedTp,
                            result.Position.Id.ToString(CultureInfo.InvariantCulture),
                            protectionError + "; " + closeProtectionNote);
                        SafePrint("[Strategy] Entry failed {0} {1}: {2}; {3}", signal.StrategyId, symbolName, protectionError, closeProtectionNote);
                        _backtestStrategyHandledEventKeys.Add(eventKey);
                        return;
                    }

                    TryEnableTrailingStopForPosition(result.Position);
                }

                LogStructuredTradeEvent(
                    IsBacktestingRuntime() ? "backtest" : "live",
                    "SUCCEEDED",
                    symbolName,
                    action,
                    effectiveUseLimitOrder ? "LIMIT" : "MARKET",
                    symbol.VolumeInUnitsToQuantity(approvedVolumeUnits),
                    result.Position != null ? result.Position.EntryPrice : (result.PendingOrder != null ? result.PendingOrder.TargetPrice : effectiveEntryPrice),
                    finalApprovedSl,
                    finalApprovedTp,
                    result.Position != null ? result.Position.Id.ToString(CultureInfo.InvariantCulture) : (result.PendingOrder != null ? result.PendingOrder.Id.ToString(CultureInfo.InvariantCulture) : ""),
                    signal.StrategyId);
                SafePrint(
                    "[Strategy] Entry {0} {1} {2} {3} vol={4:F2} risk={5:F2}{6}",
                    signal.StrategyId,
                    action,
                    effectiveUseLimitOrder ? "LIMIT" : "MARKET",
                    symbolName,
                    approvedVolumeUnits,
                    approvedRiskMoney,
                    string.IsNullOrWhiteSpace(signal.Note) ? "" : " " + signal.Note);
                _backtestStrategyHandledEventKeys.Add(eventKey);
            }
            else
            {
                LogStructuredTradeEvent(
                    IsBacktestingRuntime() ? "backtest" : "live",
                    "FAILED",
                    symbolName,
                    action,
                    effectiveUseLimitOrder ? "LIMIT" : "MARKET",
                    symbol.VolumeInUnitsToQuantity(approvedVolumeUnits),
                    effectiveEntryPrice,
                    approvedSl,
                    approvedTp,
                    "",
                    result != null ? Convert.ToString(result.Error, CultureInfo.InvariantCulture) : "null_result");
                SafePrint("[Strategy] Entry failed {0} {1}: {2}", signal.StrategyId, symbolName, result != null ? Convert.ToString(result.Error, CultureInfo.InvariantCulture) : "null_result");
            }
        }

        private bool TryEnsureStrategyPositionProtection(Position position, Symbol symbol, string action, double approvedSl, double approvedTp, out string errorText)
        {
            errorText = "";

            if (position == null)
            {
                errorText = "position_missing_after_fill";
                return false;
            }

            var needsSl = approvedSl > 0;
            var needsTp = approvedTp > 0;
            var normalizedSl = needsSl ? NormalizePriceToSymbol(symbol, approvedSl) : 0;
            var normalizedTp = needsTp ? NormalizePriceToSymbol(symbol, approvedTp) : 0;

            string validationReason;
            if (!TryValidateProtectionPrices(symbol, action, position.EntryPrice, normalizedSl, normalizedTp, out validationReason))
            {
                errorText = "post_fill_protection_rejected: " + validationReason;
                return false;
            }

            var currentSl = position.StopLoss;
            var currentTp = position.TakeProfit;
            var slCloseEnough = !needsSl || (currentSl.HasValue && Math.Abs(currentSl.Value - normalizedSl) <= symbol.PipSize * 0.5);
            var tpCloseEnough = !needsTp || (currentTp.HasValue && Math.Abs(currentTp.Value - normalizedTp) <= symbol.PipSize * 0.5);
            if (HasRequiredProtection(position, needsSl, needsTp) && slCloseEnough && tpCloseEnough)
                return true;

            var desiredSl = needsSl ? (double?)normalizedSl : position.StopLoss;
            var desiredTp = needsTp ? (double?)normalizedTp : position.TakeProfit;
            var modifyResult = ModifyPositionCompat(position, desiredSl, desiredTp);
            if (modifyResult != null && modifyResult.IsSuccessful)
            {
                SafePrint("[Strategy] Protection set SL={0} TP={1} for {2} #{3}", normalizedSl, normalizedTp, position.SymbolName, position.Id);
                return true;
            }

            currentSl = position.StopLoss;
            currentTp = position.TakeProfit;
            slCloseEnough = !needsSl || (currentSl.HasValue && Math.Abs(currentSl.Value - normalizedSl) <= symbol.PipSize * 0.5);
            tpCloseEnough = !needsTp || (currentTp.HasValue && Math.Abs(currentTp.Value - normalizedTp) <= symbol.PipSize * 0.5);
            if (HasRequiredProtection(position, needsSl, needsTp) && slCloseEnough && tpCloseEnough)
                return true;

            var slError = "";
            var tpError = "";
            var needsSlRefine = needsSl && !slCloseEnough;
            var needsTpRefine = needsTp && !tpCloseEnough;

            if (needsSlRefine)
            {
                var slOnlyResult = ModifyPositionCompat(position, normalizedSl, position.TakeProfit);
                currentSl = position.StopLoss;
                slCloseEnough = currentSl.HasValue && Math.Abs(currentSl.Value - normalizedSl) <= symbol.PipSize * 0.5;
                if (!(slOnlyResult != null && slOnlyResult.IsSuccessful) && !slCloseEnough)
                {
                    if (String.Equals(OnSlTpError, "Adjust", StringComparison.OrdinalIgnoreCase))
                    {
                        var adjustedSl = action == "SELL"
                            ? NormalizePriceToSymbol(symbol, position.EntryPrice + (Math.Max(1.0, MinStopPips) * symbol.PipSize))
                            : NormalizePriceToSymbol(symbol, position.EntryPrice - (Math.Max(1.0, MinStopPips) * symbol.PipSize));
                        var adjustedSlResult = ModifyPositionCompat(position, adjustedSl, position.TakeProfit);
                        currentSl = position.StopLoss;
                        slCloseEnough = currentSl.HasValue && Math.Abs(currentSl.Value - adjustedSl) <= symbol.PipSize * 0.5;
                        if (adjustedSlResult != null && adjustedSlResult.IsSuccessful || slCloseEnough)
                        {
                            normalizedSl = adjustedSl;
                        }
                        else
                        {
                            slError = "sl_rejected: " + (adjustedSlResult != null ? Convert.ToString(adjustedSlResult.Error, CultureInfo.InvariantCulture) : "null_result");
                        }
                    }
                    else
                    {
                        slError = "sl_rejected: " + (slOnlyResult != null ? Convert.ToString(slOnlyResult.Error, CultureInfo.InvariantCulture) : "null_result");
                    }
                }
            }

            if (needsTpRefine)
            {
                var currentTpForModify = position.TakeProfit;
                var tpOnlyResult = ModifyPositionCompat(position, position.StopLoss, normalizedTp);
                currentTp = position.TakeProfit;
                tpCloseEnough = currentTp.HasValue && Math.Abs(currentTp.Value - normalizedTp) <= symbol.PipSize * 0.5;
                if (!(tpOnlyResult != null && tpOnlyResult.IsSuccessful) && !tpCloseEnough)
                {
                    if (String.Equals(OnSlTpError, "Adjust", StringComparison.OrdinalIgnoreCase))
                    {
                        var adjustedTp = action == "SELL"
                            ? NormalizePriceToSymbol(symbol, position.EntryPrice - (Math.Max(1.0, MinStopPips) * symbol.PipSize))
                            : NormalizePriceToSymbol(symbol, position.EntryPrice + (Math.Max(1.0, MinStopPips) * symbol.PipSize));
                        var adjustedTpResult = ModifyPositionCompat(position, position.StopLoss, adjustedTp);
                        currentTp = position.TakeProfit;
                        tpCloseEnough = currentTp.HasValue && Math.Abs(currentTp.Value - adjustedTp) <= symbol.PipSize * 0.5;
                        if (adjustedTpResult != null && adjustedTpResult.IsSuccessful || tpCloseEnough)
                        {
                            normalizedTp = adjustedTp;
                        }
                        else
                        {
                            tpError = "tp_rejected: " + (adjustedTpResult != null ? Convert.ToString(adjustedTpResult.Error, CultureInfo.InvariantCulture) : "null_result");
                        }
                    }
                    else
                    {
                        tpError = "tp_rejected: " + (tpOnlyResult != null ? Convert.ToString(tpOnlyResult.Error, CultureInfo.InvariantCulture) : "null_result");
                    }
                }
            }

            if (HasRequiredProtection(position, needsSl, needsTp))
            {
                SafePrint("[Strategy] Protection set SL={0} TP={1} for {2} #{3}", normalizedSl, normalizedTp, position.SymbolName, position.Id);
                return true;
            }

            var errors = new List<string>();
            if (!string.IsNullOrWhiteSpace(slError)) errors.Add(slError);
            if (!string.IsNullOrWhiteSpace(tpError)) errors.Add(tpError);
            if (errors.Count == 0)
                errors.Add("sl_tp_rejected: " + (modifyResult != null ? Convert.ToString(modifyResult.Error, CultureInfo.InvariantCulture) : "null_result"));

            errorText = string.Format(
                CultureInfo.InvariantCulture,
                "{0} (SL={1} TP={2})",
                string.Join("; ", errors),
                normalizedSl,
                normalizedTp);
            return false;
        }

        private void ReanchorProtectionToFilledEntry(Symbol symbol, string action, double plannedEntry, double filledEntry, ref double sl, ref double tp)
        {
            if (symbol == null || plannedEntry <= 0 || filledEntry <= 0)
                return;

            string protectionReason;
            if (TryValidateProtectionPrices(symbol, action, filledEntry, sl, tp, out protectionReason))
                return;

            var originalSlDistance = sl > 0 ? Math.Abs(sl - plannedEntry) : 0;
            var originalTpDistance = tp > 0 ? Math.Abs(tp - plannedEntry) : 0;
            var isSell = string.Equals(action, "SELL", StringComparison.OrdinalIgnoreCase);

            if (originalSlDistance > 0)
            {
                sl = NormalizePriceToSymbol(
                    symbol,
                    isSell ? filledEntry + originalSlDistance : filledEntry - originalSlDistance);
            }

            if (originalTpDistance > 0)
            {
                tp = NormalizePriceToSymbol(
                    symbol,
                    isSell ? filledEntry - originalTpDistance : filledEntry + originalTpDistance);
            }
        }

        private bool TryBuildIndicatorStrategySignal(string symbolName, TimeFrame strategyTimeFrame, BacktestStrategyMode mode, out BacktestStrategySignal signal)
        {
            signal = default(BacktestStrategySignal);

            Symbol symbol;
            Bars sourceBars;
            int signalIndex;
            int previousIndex;
            if (!TryGetBacktestStrategyBars(symbolName, strategyTimeFrame, out symbol, out sourceBars, out signalIndex, out previousIndex))
                return false;

            var barTime = sourceBars.OpenTimes[signalIndex];
            var sourceTimeFrame = strategyTimeFrame;
            switch (mode)
            {
                case BacktestStrategyMode.Impulse:
                {
                    if (signalIndex < 1)
                        return false;

                    var open = sourceBars.OpenPrices[signalIndex];
                    var close = sourceBars.ClosePrices[signalIndex];
                    var high = sourceBars.HighPrices[signalIndex];
                    var low = sourceBars.LowPrices[signalIndex];
                    var candleRange = Math.Abs(high - low);
                    var candleBody = Math.Abs(close - open);
                    if (!(candleRange > 0) || !(candleBody > 0))
                        return false;

                    var bodyPercent = (candleBody / candleRange) * 100.0;
                    var minBodyPercent = Math.Max(50.0, Math.Min(100.0, FollowTrendBigCandleBodyPercentMin));
                    if (bodyPercent < minBodyPercent)
                        return false;

                    var bullish = close > open;
                    var bearish = close < open;
                    if (!bullish && !bearish)
                        return false;

                    var closeAtHigh = Math.Abs(close - high) <= Math.Max(symbol.PipSize * 0.5, 0.0000001);
                    var closeAtLow = Math.Abs(close - low) <= Math.Max(symbol.PipSize * 0.5, 0.0000001);
                    if (bullish && !closeAtHigh)
                        return false;
                    if (bearish && !closeAtLow)
                        return false;

                    var retraceDistance = candleRange * 0.25;
                    var entryPrice = bullish
                        ? NormalizePriceToSymbol(symbol, close - retraceDistance)
                        : NormalizePriceToSymbol(symbol, close + retraceDistance);
                    if (!(entryPrice > 0))
                        return false;

                    var slDistance = candleRange;
                    if (!(slDistance > 0))
                        return false;

                    var stopLoss = bullish
                        ? NormalizePriceToSymbol(symbol, entryPrice - slDistance)
                        : NormalizePriceToSymbol(symbol, entryPrice + slDistance);
                    var rewardRisk = Math.Max(0.1, StrategyRewardRisk);
                    var takeProfit = bullish
                        ? NormalizePriceToSymbol(symbol, entryPrice + (slDistance * rewardRisk))
                        : NormalizePriceToSymbol(symbol, entryPrice - (slDistance * rewardRisk));

                    signal = new BacktestStrategySignal
                    {
                        IsValid = true,
                        StrategyMode = BacktestStrategyMode.Impulse,
                        StrategyId = "follow_trend_big_candle",
                        SourceLabel = string.Format(CultureInfo.InvariantCulture, "BC {0:0.#}%", bodyPercent),
                        TradeType = bullish ? TradeType.Buy : TradeType.Sell,
                        SourceTimeFrame = sourceTimeFrame,
                        SignalTime = barTime,
                        UseLimitOrder = true,
                        EntryPrice = entryPrice,
                        StopLoss = stopLoss,
                        TakeProfit = takeProfit,
                        Note = string.Format(
                            CultureInfo.InvariantCulture,
                            "[body={0:0.#}% close={1} entry=1/4c rr={2:0.##}]",
                            bodyPercent,
                            bullish ? "high" : "low",
                            rewardRisk)
                    };
                    return signal.IsValid;
                }
                case BacktestStrategyMode.EmaCrossV1:
                {
                    var fastPrev = ComputeExponentialMovingAverage(sourceBars, previousIndex, 9);
                    var fastCurrent = ComputeExponentialMovingAverage(sourceBars, signalIndex, 9);
                    var slowPrev = ComputeExponentialMovingAverage(sourceBars, previousIndex, 21);
                    var slowCurrent = ComputeExponentialMovingAverage(sourceBars, signalIndex, 21);
                    if (CrossesAbove(fastPrev, fastCurrent, slowPrev, slowCurrent))
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "ema_cross_v1", SourceLabel = "EMA 9/21", TradeType = TradeType.Buy, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    else if (CrossesBelow(fastPrev, fastCurrent, slowPrev, slowCurrent))
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "ema_cross_v1", SourceLabel = "EMA 9/21", TradeType = TradeType.Sell, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    return signal.IsValid;
                }
                case BacktestStrategyMode.SmaCrossV1:
                {
                    var fastPrev = ComputeSimpleMovingAverage(sourceBars, previousIndex, 20);
                    var fastCurrent = ComputeSimpleMovingAverage(sourceBars, signalIndex, 20);
                    var slowPrev = ComputeSimpleMovingAverage(sourceBars, previousIndex, 50);
                    var slowCurrent = ComputeSimpleMovingAverage(sourceBars, signalIndex, 50);
                    if (CrossesAbove(fastPrev, fastCurrent, slowPrev, slowCurrent))
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "sma_cross_v1", SourceLabel = "SMA 20/50", TradeType = TradeType.Buy, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    else if (CrossesBelow(fastPrev, fastCurrent, slowPrev, slowCurrent))
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "sma_cross_v1", SourceLabel = "SMA 20/50", TradeType = TradeType.Sell, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    return signal.IsValid;
                }
                case BacktestStrategyMode.GoldenCrossV1:
                {
                    var fastPrev = ComputeSimpleMovingAverage(sourceBars, previousIndex, 50);
                    var fastCurrent = ComputeSimpleMovingAverage(sourceBars, signalIndex, 50);
                    var slowPrev = ComputeSimpleMovingAverage(sourceBars, previousIndex, 200);
                    var slowCurrent = ComputeSimpleMovingAverage(sourceBars, signalIndex, 200);
                    if (CrossesAbove(fastPrev, fastCurrent, slowPrev, slowCurrent))
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "golden_cross_v1", SourceLabel = "SMA 50/200", TradeType = TradeType.Buy, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    else if (CrossesBelow(fastPrev, fastCurrent, slowPrev, slowCurrent))
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "golden_cross_v1", SourceLabel = "SMA 50/200", TradeType = TradeType.Sell, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    return signal.IsValid;
                }
                case BacktestStrategyMode.TripleEmaTrendV1:
                {
                    var fastPrev = ComputeExponentialMovingAverage(sourceBars, previousIndex, 8);
                    var fastCurrent = ComputeExponentialMovingAverage(sourceBars, signalIndex, 8);
                    var midPrev = ComputeExponentialMovingAverage(sourceBars, previousIndex, 21);
                    var midCurrent = ComputeExponentialMovingAverage(sourceBars, signalIndex, 21);
                    var slowCurrent = ComputeExponentialMovingAverage(sourceBars, signalIndex, 55);
                    if (CrossesAbove(fastPrev, fastCurrent, midPrev, midCurrent) && fastCurrent > midCurrent && midCurrent > slowCurrent)
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "triple_ema_trend_v1", SourceLabel = "EMA 8/21/55", TradeType = TradeType.Buy, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    else if (CrossesBelow(fastPrev, fastCurrent, midPrev, midCurrent) && fastCurrent < midCurrent && midCurrent < slowCurrent)
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "triple_ema_trend_v1", SourceLabel = "EMA 8/21/55", TradeType = TradeType.Sell, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    return signal.IsValid;
                }
                case BacktestStrategyMode.RsiReversionV1:
                {
                    var rsiPrev = ComputeRelativeStrengthIndex(sourceBars, previousIndex, 14);
                    var rsiCurrent = ComputeRelativeStrengthIndex(sourceBars, signalIndex, 14);
                    if (CrossesAbove(rsiPrev, rsiCurrent, 30, 30))
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "rsi_reversion_v1", SourceLabel = "RSI 14", TradeType = TradeType.Buy, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    else if (CrossesBelow(rsiPrev, rsiCurrent, 70, 70))
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "rsi_reversion_v1", SourceLabel = "RSI 14", TradeType = TradeType.Sell, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    return signal.IsValid;
                }
                case BacktestStrategyMode.BollingerReversionV1:
                {
                    var previousMid = ComputeSimpleMovingAverage(sourceBars, previousIndex, 20);
                    var currentMid = ComputeSimpleMovingAverage(sourceBars, signalIndex, 20);
                    var previousStd = ComputeRollingStandardDeviation(sourceBars, previousIndex, 20, previousMid);
                    var currentStd = ComputeRollingStandardDeviation(sourceBars, signalIndex, 20, currentMid);
                    var previousLower = previousMid - (previousStd * 2.0);
                    var previousUpper = previousMid + (previousStd * 2.0);
                    if (sourceBars.ClosePrices[previousIndex] < previousLower && sourceBars.ClosePrices[signalIndex] > currentMid)
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "bollinger_reversion_v1", SourceLabel = "BB 20/2", TradeType = TradeType.Buy, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    else if (sourceBars.ClosePrices[previousIndex] > previousUpper && sourceBars.ClosePrices[signalIndex] < currentMid)
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "bollinger_reversion_v1", SourceLabel = "BB 20/2", TradeType = TradeType.Sell, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    return signal.IsValid;
                }
                case BacktestStrategyMode.StochReversalV1:
                {
                    var stochPrev = ComputeSmoothedStochasticK(sourceBars, previousIndex, 14, 3);
                    var stochCurrent = ComputeSmoothedStochasticK(sourceBars, signalIndex, 14, 3);
                    if (CrossesAbove(stochPrev, stochCurrent, 20, 20))
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "stoch_reversal_v1", SourceLabel = "Stoch 14/3", TradeType = TradeType.Buy, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    else if (CrossesBelow(stochPrev, stochCurrent, 80, 80))
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "stoch_reversal_v1", SourceLabel = "Stoch 14/3", TradeType = TradeType.Sell, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    return signal.IsValid;
                }
                case BacktestStrategyMode.MacdSignalV1:
                {
                    double macdPrev;
                    double signalPrev;
                    double macdCurrent;
                    double signalCurrent;
                    if (!TryComputeMacdValues(sourceBars, previousIndex, 12, 26, 9, out macdPrev, out signalPrev) ||
                        !TryComputeMacdValues(sourceBars, signalIndex, 12, 26, 9, out macdCurrent, out signalCurrent))
                        return false;
                    if (CrossesAbove(macdPrev, macdCurrent, signalPrev, signalCurrent))
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "macd_signal_v1", SourceLabel = "MACD 12/26/9", TradeType = TradeType.Buy, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    else if (CrossesBelow(macdPrev, macdCurrent, signalPrev, signalCurrent))
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "macd_signal_v1", SourceLabel = "MACD 12/26/9", TradeType = TradeType.Sell, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    return signal.IsValid;
                }
                case BacktestStrategyMode.RocMomentumV1:
                {
                    var rocPrev = ComputeRateOfChange(sourceBars, previousIndex, 12);
                    var rocCurrent = ComputeRateOfChange(sourceBars, signalIndex, 12);
                    if (CrossesAbove(rocPrev, rocCurrent, 0, 0))
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "roc_momentum_v1", SourceLabel = "ROC 12", TradeType = TradeType.Buy, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    else if (CrossesBelow(rocPrev, rocCurrent, 0, 0))
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "roc_momentum_v1", SourceLabel = "ROC 12", TradeType = TradeType.Sell, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    return signal.IsValid;
                }
                case BacktestStrategyMode.DonchianBreakoutV1:
                {
                    if (signalIndex < 21)
                        return false;
                    var channelHigh = double.MinValue;
                    var channelLow = double.MaxValue;
                    for (var i = signalIndex - 20; i <= signalIndex - 1; i++)
                    {
                        channelHigh = Math.Max(channelHigh, sourceBars.HighPrices[i]);
                        channelLow = Math.Min(channelLow, sourceBars.LowPrices[i]);
                    }

                    if (sourceBars.ClosePrices[signalIndex] > channelHigh)
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "donchian_breakout_v1", SourceLabel = "Donchian 20", TradeType = TradeType.Buy, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    else if (sourceBars.ClosePrices[signalIndex] < channelLow)
                        signal = new BacktestStrategySignal { IsValid = true, StrategyId = "donchian_breakout_v1", SourceLabel = "Donchian 20", TradeType = TradeType.Sell, SourceTimeFrame = sourceTimeFrame, SignalTime = barTime };
                    return signal.IsValid;
                }
                case BacktestStrategyMode.Trend:
                {
                    var candlesNum = Math.Max(1, FollowTrendCandlesCount);
                    var slCandleNum = Math.Max(1, FollowTrendSlCandleNum);
                    var rewardRisk = Math.Max(0.1, StrategyRewardRisk);
                    if (slCandleNum >= candlesNum)
                        slCandleNum = Math.Max(0, candlesNum - 1);

                    if (signalIndex < candlesNum - 1)
                        return false;

                    var startIndex = signalIndex - candlesNum + 1;
                    var bullishSequence = true;
                    var bearishSequence = true;
                    for (var i = startIndex; i <= signalIndex; i++)
                    {
                        var close = sourceBars.ClosePrices[i];
                        var open = sourceBars.OpenPrices[i];
                        if (!(close > open))
                            bullishSequence = false;
                        if (!(close < open))
                            bearishSequence = false;
                    }

                    var entryIndex = signalIndex;
                    var stopIndex = signalIndex - slCandleNum;

                    if (bullishSequence)
                    {
                        var entryPrice = NormalizePriceToSymbol(symbol, sourceBars.ClosePrices[entryIndex]);
                        var stopLoss = ResolveThreeCandlesStopLossPrice(symbol, sourceBars, stopIndex, startIndex, signalIndex, entryPrice, TradeType.Buy);
                        var riskDistance = entryPrice - stopLoss;
                        if (riskDistance <= 0)
                            return false;

                        signal = new BacktestStrategySignal
                        {
                            IsValid = true,
                            StrategyId = "follow_trend",
                            StrategyMode = BacktestStrategyMode.Trend,
                            SymbolName = symbolName,
                            SourceLabel = "n green",
                            TradeType = TradeType.Buy,
                            SourceTimeFrame = sourceTimeFrame,
                            SignalTime = barTime,
                            EntryPrice = entryPrice,
                            StopLoss = stopLoss,
                            TakeProfit = NormalizePriceToSymbol(symbol, entryPrice + (riskDistance * rewardRisk)),
                            Note = string.Format(CultureInfo.InvariantCulture, "[Continue N={0} SL#{1} RR={2:0.##}]", candlesNum, slCandleNum, rewardRisk)
                        };
                        return true;
                    }

                    if (bearishSequence)
                    {
                        var entryPrice = NormalizePriceToSymbol(symbol, sourceBars.ClosePrices[entryIndex]);
                        var stopLoss = ResolveThreeCandlesStopLossPrice(symbol, sourceBars, stopIndex, startIndex, signalIndex, entryPrice, TradeType.Sell);
                        var riskDistance = stopLoss - entryPrice;
                        if (riskDistance <= 0)
                            return false;

                        signal = new BacktestStrategySignal
                        {
                            IsValid = true,
                            StrategyId = "follow_trend",
                            StrategyMode = BacktestStrategyMode.Trend,
                            SymbolName = symbolName,
                            SourceLabel = "n red",
                            TradeType = TradeType.Sell,
                            SourceTimeFrame = sourceTimeFrame,
                            SignalTime = barTime,
                            EntryPrice = entryPrice,
                            StopLoss = stopLoss,
                            TakeProfit = NormalizePriceToSymbol(symbol, entryPrice - (riskDistance * rewardRisk)),
                            Note = string.Format(CultureInfo.InvariantCulture, "[Continue N={0} SL#{1} RR={2:0.##}]", candlesNum, slCandleNum, rewardRisk)
                        };
                        return true;
                    }

                    return false;
                }
            }

            return false;
        }

        private bool TryBuildPriceActionTriggerSignal(string symbolName, TimeFrame strategyTimeFrame, string strategyId, bool useSuggestedLevels, int slRank, int tpRank, bool useLimitBodyMidEntry, out BacktestStrategySignal signal)
        {
            signal = default(BacktestStrategySignal);

            Symbol symbol;
            Bars sourceBars;
            int signalIndex;
            int previousIndex;
            if (!TryGetBacktestStrategyBars(symbolName, strategyTimeFrame, out symbol, out sourceBars, out signalIndex, out previousIndex))
                return false;

            var bullishPattern = IsBullishPinBar(sourceBars, signalIndex) || IsBullishEngulfing(sourceBars, previousIndex, signalIndex);
            var bearishPattern = IsBearishPinBar(sourceBars, signalIndex) || IsBearishEngulfing(sourceBars, previousIndex, signalIndex);
            CanonicalMarketEvent directionalEvent;
            var timeFrames = new[] { strategyTimeFrame };
            var bullishEvent = TryGetRecentDirectionalEvent(symbolName, timeFrames, true, out directionalEvent, CanonicalEventType.Bos, CanonicalEventType.Choch);
            var bearishEvent = TryGetRecentDirectionalEvent(symbolName, timeFrames, false, out directionalEvent, CanonicalEventType.Bos, CanonicalEventType.Choch);

            TradeType? tradeType = null;
            if (HasBullishBiasForStrategy(symbolName) && (bullishPattern || bullishEvent))
                tradeType = TradeType.Buy;
            else if (HasBearishBiasForStrategy(symbolName) && (bearishPattern || bearishEvent))
                tradeType = TradeType.Sell;

            if (!tradeType.HasValue)
                return false;

            var entryPrice = tradeType.Value == TradeType.Buy ? symbol.Ask : symbol.Bid;
            if (useLimitBodyMidEntry)
                entryPrice = NormalizePriceToSymbol(symbol, (sourceBars.OpenPrices[signalIndex] + sourceBars.ClosePrices[signalIndex]) * 0.5);

            var signalTime = sourceBars.OpenTimes[signalIndex];
            var profileRaw = GetChartTradeProfileRaw();
            var result = new BacktestStrategySignal
            {
                IsValid = true,
                StrategyId = strategyId,
                SourceLabel = useLimitBodyMidEntry ? "body_mid_limit" : "price_action",
                TradeType = tradeType.Value,
                SourceTimeFrame = strategyTimeFrame,
                SignalTime = signalTime,
                UseLimitOrder = useLimitBodyMidEntry,
                EntryPrice = entryPrice
            };

            if (useSuggestedLevels)
            {
                ChartTradePlan plan;
                if (!TryBuildSuggestedLevelsPlan(symbol, symbolName, tradeType.Value, entryPrice, slRank, tpRank, profileRaw, out plan) || !plan.IsValid)
                    return false;

                result.EntryPrice = plan.Entry;
                result.StopLoss = plan.StopLoss;
                result.TakeProfit = plan.TakeProfit;
                result.Note = string.Format(CultureInfo.InvariantCulture, "[{0}] RR={1:F2}", plan.EntryLabel, plan.RewardRisk);
            }

            signal = result;
            return true;
        }

        private bool TryBuildPriceActionFvgContextSignal(string symbolName, TimeFrame strategyTimeFrame, out BacktestStrategySignal signal)
        {
            signal = default(BacktestStrategySignal);

            Symbol symbol;
            Bars sourceBars;
            int signalIndex;
            int previousIndex;
            if (!TryGetBacktestStrategyBars(symbolName, strategyTimeFrame, out symbol, out sourceBars, out signalIndex, out previousIndex))
                return false;

            var bullishBias = HasBullishBiasForStrategy(symbolName);
            var bearishBias = HasBearishBiasForStrategy(symbolName);
            if (!bullishBias && !bearishBias)
                return false;

            var profileRaw = GetChartTradeProfileRaw();
            var entries = CollectChartEntryCandidates(symbol, symbolName, profileRaw)
                .Where(candidate => !string.IsNullOrWhiteSpace(candidate.Label) && candidate.Label.IndexOf("FVG", StringComparison.OrdinalIgnoreCase) >= 0)
                .OrderByDescending(candidate => candidate.Time)
                .Take(6)
                .ToList();
            if (entries.Count == 0)
                return false;

            var barLow = sourceBars.LowPrices[signalIndex];
            var barHigh = sourceBars.HighPrices[signalIndex];
            var barClose = sourceBars.ClosePrices[signalIndex];
            foreach (var entryCandidate in entries)
            {
                var mid = NormalizePriceToSymbol(symbol, entryCandidate.Entry);
                if (mid <= 0 || barLow > mid || barHigh < mid)
                    continue;

                if (bullishBias && barClose > mid)
                {
                    var entryPrice = symbol.Ask;
                    var targetLevels = GetRankedChartStructuralLevels(symbol, symbolName, false, entryPrice, profileRaw);
                    var adjusted = targetLevels.Count > 0
                        ? ApplyChartProtectionBiasAndRisk(symbol, TradeType.Buy, entryPrice, entryCandidate.Low, targetLevels[0].Price)
                        : null;
                    if (adjusted == null)
                        continue;

                    signal = new BacktestStrategySignal
                    {
                        IsValid = true,
                        StrategyId = "price_action_fvg_context_v1",
                        SourceLabel = entryCandidate.Label,
                        TradeType = TradeType.Buy,
                        SourceTimeFrame = strategyTimeFrame,
                        SignalTime = sourceBars.OpenTimes[signalIndex],
                        EntryPrice = entryPrice,
                        StopLoss = adjusted.Item1,
                        TakeProfit = adjusted.Item2,
                        Note = "[local_fvg_context]"
                    };
                    return true;
                }

                if (bearishBias && barClose < mid)
                {
                    var entryPrice = symbol.Bid;
                    var targetLevels = GetRankedChartStructuralLevels(symbol, symbolName, true, entryPrice, profileRaw);
                    var adjusted = targetLevels.Count > 0
                        ? ApplyChartProtectionBiasAndRisk(symbol, TradeType.Sell, entryPrice, entryCandidate.High, targetLevels[0].Price)
                        : null;
                    if (adjusted == null)
                        continue;

                    signal = new BacktestStrategySignal
                    {
                        IsValid = true,
                        StrategyId = "price_action_fvg_context_v1",
                        SourceLabel = entryCandidate.Label,
                        TradeType = TradeType.Sell,
                        SourceTimeFrame = strategyTimeFrame,
                        SignalTime = sourceBars.OpenTimes[signalIndex],
                        EntryPrice = entryPrice,
                        StopLoss = adjusted.Item1,
                        TakeProfit = adjusted.Item2,
                        Note = "[local_fvg_context]"
                    };
                    return true;
                }
            }

            return false;
        }

        private void ExecuteBacktestPriceActionEventDetectorStrategy(string symbolName, TimeFrame strategyTimeFrame)
        {
            CanonicalMarketEvent latestEvent;
            if (!TryGetLatestBacktestStrategyEventForTimeFrames(symbolName, new[] { strategyTimeFrame }, out latestEvent))
                return;

            LogStrategyInfoOnce(
                "price_action_event_detector_v1",
                symbolName,
                string.Format(
                    CultureInfo.InvariantCulture,
                    "detector {0} {1} {2}",
                    GetMiniChartLabel(latestEvent.SourceTimeFrame),
                    latestEvent.EventType,
                    latestEvent.IsBullish ? "bullish" : "bearish"));
        }

        private void TryRunBacktestStrategy()
        {
            try
            {
                var configuredStrategies = GetConfiguredStrategyModes().ToList();
                if (configuredStrategies.Count == 0)
                    return;
                if (!ShouldStrategyEngineRun())
                    return;
                var isBacktesting = IsBacktestingRuntime();
                if (isBacktesting && _backtestRiskStopTriggered)
                    return;

                string backtestRiskStopReason;
                if (isBacktesting && TryGetBacktestRiskStopReason(out backtestRiskStopReason))
                {
                    StopBacktestForPropRuleBreach("STATE", Symbol != null ? Symbol.Name : "", backtestRiskStopReason);
                    return;
                }

                var fallbackSymbolName = Chart != null && !string.IsNullOrWhiteSpace(Chart.SymbolName)
                    ? Chart.SymbolName.Trim()
                    : (Symbol != null ? Symbol.Name : "");
                var fallbackTimeFrame = Chart != null ? Chart.TimeFrame : TimeFrame.Minute;
                var strategyTargets = ResolveStrategyExecutionTargets(fallbackSymbolName, fallbackTimeFrame).ToList();
                if (strategyTargets.Count == 0)
                {
                    LogStrategyInfoOnce("engine", string.IsNullOrWhiteSpace(fallbackSymbolName) ? "UNKNOWN" : fallbackSymbolName, "no resolved strategy targets from Symbols/Timeframes");
                    return;
                }

                foreach (var target in strategyTargets)
                {
                    foreach (var strategyMode in configuredStrategies)
                    {
                        switch (strategyMode)
                        {
                            case BacktestStrategyMode.HtfEventMarket:
                                ExecuteBacktestHtfEventMarketStrategy(target.SymbolName, target.TimeFrame);
                                break;
                            case BacktestStrategyMode.LtfEventMarket:
                                ExecuteBacktestLtfEventMarketStrategy(target.SymbolName, target.TimeFrame);
                                break;
                            case BacktestStrategyMode.EmaCrossV1:
                            case BacktestStrategyMode.SmaCrossV1:
                            case BacktestStrategyMode.GoldenCrossV1:
                            case BacktestStrategyMode.TripleEmaTrendV1:
                            case BacktestStrategyMode.RsiReversionV1:
                            case BacktestStrategyMode.BollingerReversionV1:
                            case BacktestStrategyMode.StochReversalV1:
                            case BacktestStrategyMode.MacdSignalV1:
                            case BacktestStrategyMode.RocMomentumV1:
                            case BacktestStrategyMode.DonchianBreakoutV1:
                            case BacktestStrategyMode.Trend:
                            case BacktestStrategyMode.Impulse:
                            {
                                if (!ShouldRunLiveStrategyForNewClosedBar(strategyMode, target.SymbolName, target.TimeFrame))
                                    break;

                                BacktestStrategySignal indicatorSignal;
                                if (TryBuildIndicatorStrategySignal(target.SymbolName, target.TimeFrame, strategyMode, out indicatorSignal))
                                {
                                    ExecuteBacktestStrategySignal(target.SymbolName, indicatorSignal, false);
                                }
                                else if (strategyMode == BacktestStrategyMode.Trend)
                                {
                                    var followTrendTf = NormalizeTradeTfLabel(GetMiniChartLabel(target.TimeFrame));
                                    LogStrategyInfoOnce("follow_trend", target.SymbolName, string.Format(CultureInfo.InvariantCulture, "no signal on {0} N={1} SL#{2} RR={3:0.##}", followTrendTf, Math.Max(1, FollowTrendCandlesCount), Math.Max(1, FollowTrendSlCandleNum), Math.Max(0.1, StrategyRewardRisk)));
                                }
                                else if (strategyMode == BacktestStrategyMode.Impulse)
                                {
                                    var bigCandleTf = NormalizeTradeTfLabel(GetMiniChartLabel(target.TimeFrame));
                                    LogStrategyInfoOnce("follow_trend_big_candle", target.SymbolName, string.Format(CultureInfo.InvariantCulture, "no signal on {0} body>={1:0.#}% rr={2:0.##}", bigCandleTf, Math.Max(50.0, Math.Min(100.0, FollowTrendBigCandleBodyPercentMin)), Math.Max(0.1, StrategyRewardRisk)));
                                }
                                break;
                            }
                            case BacktestStrategyMode.PriceActionV1:
                            {
                                BacktestStrategySignal signal;
                                if (TryBuildPriceActionTriggerSignal(target.SymbolName, target.TimeFrame, "price_action_v1", false, 1, 1, false, out signal))
                                    ExecuteBacktestStrategySignal(target.SymbolName, signal, false);
                                break;
                            }
                            case BacktestStrategyMode.PriceActionEventDetectorV1:
                                ExecuteBacktestPriceActionEventDetectorStrategy(target.SymbolName, target.TimeFrame);
                                break;
                            case BacktestStrategyMode.PriceActionFvgContextV1:
                            {
                                BacktestStrategySignal signal;
                                if (TryBuildPriceActionFvgContextSignal(target.SymbolName, target.TimeFrame, out signal))
                                    ExecuteBacktestStrategySignal(target.SymbolName, signal, false);
                                break;
                            }
                            case BacktestStrategyMode.ArtifactSuggestedLevelsV1:
                            {
                                BacktestStrategySignal signal;
                                if (TryBuildPriceActionTriggerSignal(target.SymbolName, target.TimeFrame, "artifact_suggested_levels_v1", true, 1, 1, false, out signal))
                                    ExecuteBacktestStrategySignal(target.SymbolName, signal, false);
                                break;
                            }
                            case BacktestStrategyMode.ArtifactSuggestedLevelsV2:
                            {
                                BacktestStrategySignal signal;
                                if (TryBuildPriceActionTriggerSignal(target.SymbolName, target.TimeFrame, "artifact_suggested_levels_v2", true, 2, 2, false, out signal))
                                    ExecuteBacktestStrategySignal(target.SymbolName, signal, false);
                                break;
                            }
                            case BacktestStrategyMode.ArtifactSuggestedLevelsV2LimitBodyMid:
                            {
                                BacktestStrategySignal signal;
                                if (TryBuildPriceActionTriggerSignal(target.SymbolName, target.TimeFrame, "artifact_suggested_levels_v2_limit_body_mid", true, 2, 2, true, out signal))
                                    ExecuteBacktestStrategySignal(target.SymbolName, signal, false);
                                break;
                            }
                            case BacktestStrategyMode.AiSnapshotContextV1:
                                LogStrategyInfoOnce("ai_snapshot_context_v1", target.SymbolName, "requires external ai.* context rows; not available in standalone cTrader runtime");
                                break;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                SafePrint("[Strategy] Engine failed: {0}", ex.Message);
            }
        }

        private void ExecuteBacktestHtfEventMarketStrategy(string symbolName, TimeFrame strategyTimeFrame)
        {
            CanonicalMarketEvent strategyEvent;
            var higherFrames = GetBacktestStrategyHigherTimeFrames(strategyTimeFrame).ToList();
            if (higherFrames.Count == 0)
            {
                LogStrategyInfoOnce("HTF_EVENT", symbolName, "no enabled higher timeframe above current chart timeframe");
                return;
            }

            if (!TryGetLatestBacktestStrategyEvent(symbolName, strategyTimeFrame, out strategyEvent))
            {
                LogStrategyInfoOnce("HTF_EVENT", symbolName, "no recent eligible HTF event");
                return;
            }

            ExecuteBacktestStrategyMarketEntry(symbolName, strategyEvent, "HTF_EVENT", true);
        }

        private void ExecuteBacktestLtfEventMarketStrategy(string symbolName, TimeFrame strategyTimeFrame)
        {
            CanonicalMarketEvent strategyEvent;
            var lowerFrames = GetBacktestStrategyLowerTimeFrames(strategyTimeFrame).ToList();
            if (!TryGetLatestBacktestStrategyEventForTimeFrames(symbolName, lowerFrames, out strategyEvent))
            {
                LogStrategyInfoOnce(
                    "LTF_EVENT",
                    symbolName,
                    "no recent eligible LTF event in " + string.Join(",", lowerFrames.Select(GetMiniChartLabel)));
                return;
            }

            ExecuteBacktestStrategyMarketEntry(symbolName, strategyEvent, "LTF_EVENT", false);
        }

        private void MasterTimerTick()
        {
            if (EnableLiveStrategyTrading && !IsBacktestingRuntime() && _masterTickCount <= 2)
            {
                var timerSymbol = ResolveSharedStrategySymbol(
                    Chart != null ? Chart.SymbolName : (Symbol != null ? Symbol.Name : ""));
                LogStrategyInfoOnce(
                    "engine",
                    string.IsNullOrWhiteSpace(timerSymbol) ? "UNKNOWN" : timerSymbol,
                    string.Format(
                        CultureInfo.InvariantCulture,
                        "master timer active tick={0} interval={1}s",
                        _masterTickCount,
                        Math.Max(1, MasterTimerSeconds)));
            }

            var fullRefreshEveryTicks = Math.Max(1, (int)Math.Ceiling(5.0 / Math.Max(1, MasterTimerSeconds)));
            var includeVisualOverlays = _masterTickCount <= 1 || (_masterTickCount % fullRefreshEveryTicks) == 0;
            RefreshDebugPanelNow(includeVisualOverlays);

            if (_masterTickCount % 60 == 0) CleanupOldEntries();

            if (EnableLiveStrategyTrading)
                TriggerNewsGateRefreshIfNeeded();

            EnforceLiveStrategyProtectionSafety();
            TrackStrategyPositionMarkers();

            // MasterTimer mode lets strategies run independently from the host chart bar close.
            // This is especially useful when the chart symbol/timeframe differs from the
            // configured strategy symbol/timeframe.
            if (ShouldStrategyEngineRun() && ShouldRunStrategiesOnMasterTimer())
                TryRunBacktestStrategy();

            if (IsBacktestingRuntime())
                return;

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
                _busyIncSync = true;
                var syms = GetActiveSymbols();
                if (syms.Count > 0)
                {
                    var iss = syms;
                    Task.Run(async () =>
                    {
                        try { await SyncBarsIncrementalAsync(accId, iss); }
                        catch (Exception ex) { _lastIncrementalErr = ex.Message; }
                        finally { _lastIncrementalSync = DateTime.Now; _busyIncSync = false; }
                    });
                }
                else { _lastIncrementalSync = now; _busyIncSync = false; }
            }

        }

        private List<string> GetActiveSymbols()
        {
            var syms = _trackedSymbols.Count > 0 ? new List<string>(_trackedSymbols) : new List<string>();
            if (syms.Count == 0)
            {
                foreach (var pos in Positions)
                    if (!string.IsNullOrWhiteSpace(pos.SymbolName) && !IsChartAllSymbolsSelection(pos.SymbolName) && !syms.Contains(pos.SymbolName)) syms.Add(pos.SymbolName);
                foreach (var order in PendingOrders)
                    if (!string.IsNullOrWhiteSpace(order.SymbolName) && !IsChartAllSymbolsSelection(order.SymbolName) && !syms.Contains(order.SymbolName)) syms.Add(order.SymbolName);
                if (Symbol != null && !string.IsNullOrWhiteSpace(Symbol.Name) && !IsChartAllSymbolsSelection(Symbol.Name) && !syms.Contains(Symbol.Name)) syms.Add(Symbol.Name);
            }
            return syms
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Where(s => !IsChartAllSymbolsSelection(s))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
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
                if (IsBacktestingRuntime())
                    return;

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
                RefreshDebugPanelNow();
            }
        }

        protected override void OnStop()
        {
            try
            {
                var uptimeSeconds = _startedAtUtc == DateTime.MinValue
                    ? 0
                    : Math.Max(0, (int)Math.Round((DateTime.UtcNow - _startedAtUtc).TotalSeconds));
                SafePrint(
                    "[BotStop] OnStop reason={0} live={1} backtest={2} uptime_sec={3} symbol={4} tf={5}",
                    string.IsNullOrWhiteSpace(_lastStopReason) ? "external_or_unknown" : _lastStopReason,
                    EnableLiveStrategyTrading,
                    IsBacktestingRuntime(),
                    uptimeSeconds,
                    Chart != null ? Chart.SymbolName : (Symbol != null ? Symbol.Name : ""),
                    Chart != null ? Chart.TimeFrame.ToString() : "");
            }
            catch
            {
            }
            try { FinalizeBacktestExportSession(); } catch { }
            try { _watchdogCts?.Cancel(); } catch { }
            try { _watchdogCts?.Dispose(); } catch { }
            try { if (_chartButtonPanel != null) Chart.RemoveControl(_chartButtonPanel); } catch { }
            try { if (_chartSummaryPanel != null) Chart.RemoveControl(_chartSummaryPanel); } catch { }
            try { if (_chartVisualTogglePanel != null) Chart.RemoveControl(_chartVisualTogglePanel); } catch { }
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
                    HorizontalAlignment = HorizontalAlignment.Left,
                    VerticalAlignment = VerticalAlignment.Bottom,
                    Margin = 6,
                    Opacity = 0.85
                };
                _chartSymbolsSignature = "";

                TryAddChartSymbolCombo(_chartButtonPanel);
                TryAddChartDirectionCombo(_chartButtonPanel);
                TryAddChartTradeTypeCombo(_chartButtonPanel);

                var preferredToolbarSymbol = !string.IsNullOrWhiteSpace(_chartSelectedSymbol)
                    ? _chartSelectedSymbol
                    : (Chart != null ? Chart.SymbolName : "");
                var selectedToolbarSymbol = EnsureChartSelectedSymbol(preferredToolbarSymbol);
                var selectedDirection = ReadChartDirectionComboSelection();
                var isAllSymbolsSelected = IsChartAllSymbolsSelection(selectedToolbarSymbol);
                var hasSelectedOpenPositions = SymbolHasOpenPositions(selectedToolbarSymbol, selectedDirection);
                var hasSelectedPendingOrders = SymbolHasPendingOrders(selectedToolbarSymbol, selectedDirection);
                var allowDirectionalManagement = !string.Equals(selectedDirection, "All", StringComparison.OrdinalIgnoreCase);

                if (!isAllSymbolsSelected)
                {
                    var buyButton = BuildChartActionButton("B", Color.White, Color.ForestGreen, 28);
                    ApplyButtonTooltip(buyButton, "Buy market order using current chart trade settings");
                    buyButton.Click += _ => ExecuteChartQuickMarketOrder(TradeType.Buy);
                    _chartButtonPanel.AddChild(buyButton);

                    var sellButton = BuildChartActionButton("S", Color.White, Color.Firebrick, 28);
                    ApplyButtonTooltip(sellButton, "Sell market order using current chart trade settings");
                    sellButton.Click += _ => ExecuteChartQuickMarketOrder(TradeType.Sell);
                    _chartButtonPanel.AddChild(sellButton);

                    var buyLimitButton = BuildChartTintedOutlineButton("B.lmt", Color.ForestGreen, 42);
                    ApplyButtonTooltip(buyLimitButton, "Place buy limit order from structure/key-level logic");
                    buyLimitButton.Click += _ => ExecuteChartQuickPendingOrder(TradeType.Buy, false);
                    _chartButtonPanel.AddChild(buyLimitButton);

                    var sellLimitButton = BuildChartTintedOutlineButton("S.lmt", Color.Firebrick, 42);
                    ApplyButtonTooltip(sellLimitButton, "Place sell limit order from structure/key-level logic");
                    sellLimitButton.Click += _ => ExecuteChartQuickPendingOrder(TradeType.Sell, false);
                    _chartButtonPanel.AddChild(sellLimitButton);

                    var buyStopButton = BuildChartTintedOutlineButton("B.stp", Color.ForestGreen, 42);
                    ApplyButtonTooltip(buyStopButton, "Place buy stop order from structure/key-level logic");
                    buyStopButton.Click += _ => ExecuteChartQuickPendingOrder(TradeType.Buy, true);
                    _chartButtonPanel.AddChild(buyStopButton);

                    var sellStopButton = BuildChartTintedOutlineButton("S.stp", Color.Firebrick, 42);
                    ApplyButtonTooltip(sellStopButton, "Place sell stop order from structure/key-level logic");
                    sellStopButton.Click += _ => ExecuteChartQuickPendingOrder(TradeType.Sell, true);
                    _chartButtonPanel.AddChild(sellStopButton);
                }

                if (hasSelectedOpenPositions || hasSelectedPendingOrders)
                {
                    if (!isAllSymbolsSelected && allowDirectionalManagement && hasSelectedOpenPositions)
                    {
                        var slMinusButton = BuildChartOutlineButton("SL -", Color.OrangeRed, 36);
                        ApplyButtonTooltip(slMinusButton, "Move stop loss farther away");
                        slMinusButton.Click += _ => ShiftChartProtection(true, true);
                        _chartButtonPanel.AddChild(slMinusButton);

                        var slPlusButton = BuildChartOutlineButton("SL +", Color.SaddleBrown, 36);
                        ApplyButtonTooltip(slPlusButton, "Move stop loss closer");
                        slPlusButton.Click += _ => ShiftChartProtection(true, false);
                        _chartButtonPanel.AddChild(slPlusButton);

                        var tpMinusButton = BuildChartOutlineButton("TP -", Color.DeepSkyBlue, 36);
                        ApplyButtonTooltip(tpMinusButton, "Move take profit closer");
                        tpMinusButton.Click += _ => ShiftChartProtection(false, true);
                        _chartButtonPanel.AddChild(tpMinusButton);

                        var tpPlusButton = BuildChartOutlineButton("TP +", Color.MidnightBlue, 36);
                        ApplyButtonTooltip(tpPlusButton, "Move take profit farther away");
                        tpPlusButton.Click += _ => ShiftChartProtection(false, false);
                        _chartButtonPanel.AddChild(tpPlusButton);

                        var syncButton = BuildChartOutlineButton("Sync", Color.SteelBlue, 40);
                        ApplyButtonTooltip(syncButton, "Sync SL and TP with current chart trade plan");
                        syncButton.Click += _ => SyncChartSymbolProtection();
                        _chartButtonPanel.AddChild(syncButton);
                    }

                    if (hasSelectedOpenPositions)
                    {
                        var closeHalfButton = BuildChartOutlineButton("C.50", Color.Goldenrod, 40);
                        ApplyButtonTooltip(closeHalfButton, "Close 50% of selected open positions");
                        closeHalfButton.Click += _ => CloseChartSymbolPositions(50);
                        _chartButtonPanel.AddChild(closeHalfButton);

                        var closeAllButton = BuildChartOutlineButton("C.all", Color.DarkRed, 42);
                        ApplyButtonTooltip(closeAllButton, "Close 100% of selected open positions");
                        closeAllButton.Click += _ => CloseChartSymbolPositions(100);
                        _chartButtonPanel.AddChild(closeAllButton);
                    }

                    if (hasSelectedPendingOrders)
                    {
                        var cancelOrdersButton = BuildChartOutlineButton("C.order", Color.IndianRed, 52);
                        ApplyButtonTooltip(cancelOrdersButton, "Cancel selected pending orders");
                        cancelOrdersButton.Click += _ => CancelChartSymbolPendingOrders();
                        _chartButtonPanel.AddChild(cancelOrdersButton);
                    }
                }

                Chart.AddControl(_chartButtonPanel);
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

        private void BuildChartVisualTogglePanel()
        {
            try
            {
                if (_chartVisualTogglePanel != null)
                {
                    try { Chart.RemoveControl(_chartVisualTogglePanel); } catch { }
                }
                if (_chartVisualQuickPanel != null)
                {
                    try { Chart.RemoveControl(_chartVisualQuickPanel); } catch { }
                }

                _chartVisualQuickPanel = new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    HorizontalAlignment = HorizontalAlignment.Left,
                    VerticalAlignment = VerticalAlignment.Top,
                    Margin = "6 6 0 0",
                    Opacity = 0.92
                };

                _chartVisualTogglePanel = new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    HorizontalAlignment = HorizontalAlignment.Right,
                    VerticalAlignment = VerticalAlignment.Top,
                    Margin = 6,
                    Opacity = 0.92
                };

                var autoChartTimeFrame = Chart != null ? Chart.TimeFrame : TimeFrame.Minute;
                AddVisualToggleButton(_chartVisualQuickPanel, GetAutoHigherTimeframeButtonLabel(autoChartTimeFrame, 0), () => _toggleHtf15, value => _toggleHtf15 = value, Color.DeepSkyBlue);
                AddVisualToggleButton(_chartVisualQuickPanel, GetAutoHigherTimeframeButtonLabel(autoChartTimeFrame, 1), () => _toggleHtf4H, value => _toggleHtf4H = value, Color.FromArgb(255, 0x80, 0x00, 0x80));
                AddVisualToggleButton(_chartVisualQuickPanel, "KZ", () => _toggleKillerZones, value => _toggleKillerZones = value, Color.Goldenrod);
                AddVisualToggleButton(_chartVisualQuickPanel, "M", () => _toggleHtfMiniChart, value => _toggleHtfMiniChart = value, Color.Orange);
                AddVisualToggleButton(_chartVisualQuickPanel, "KEY", () => _toggleKeyLevels, value => _toggleKeyLevels = value, Color.PaleGreen);
                AddVisualToggleButton(_chartVisualQuickPanel, "FVG", () => _toggleFvgZones, value => _toggleFvgZones = value, Color.DeepSkyBlue);
                AddVisualToggleButton(_chartVisualQuickPanel, "OB", () => _toggleOrderBlocks, value => _toggleOrderBlocks = value, Color.MediumPurple);
                AddVisualToggleButton(_chartVisualQuickPanel, "LIQ", () => _toggleLiquidityLevels, value => _toggleLiquidityLevels = value, Color.LightGray);
                AddVisualToggleButton(_chartVisualQuickPanel, "EMA", () => _toggleEmaOverlay, value => _toggleEmaOverlay = value, Color.FromArgb(255, 56, 189, 248));
                AddVisualToggleButton(_chartVisualQuickPanel, "VW", () => _toggleVwapOverlay, value => _toggleVwapOverlay = value, Color.FromArgb(255, 14, 165, 233));
                AddVisualToggleButton(_chartVisualQuickPanel, "BB", () => _toggleBollingerOverlay, value => _toggleBollingerOverlay = value, Color.FromArgb(255, 244, 114, 182));

                AddVisualToggleButton(_chartVisualTogglePanel, "SW", () => _toggleSweepDetections, value => _toggleSweepDetections = value, Color.FromArgb(255, 0xFF, 0x66, 0x66));
                AddVisualToggleButton(_chartVisualTogglePanel, "BOS", () => _toggleBosDetections, value => _toggleBosDetections = value, Color.LimeGreen);
                AddVisualToggleButton(_chartVisualTogglePanel, "CH", () => _toggleChochDetections, value => _toggleChochDetections = value, Color.Gold);
                AddVisualToggleButton(_chartVisualTogglePanel, "RJ", () => _toggleRejectionDetections, value => _toggleRejectionDetections = value, Color.LightGreen);
                AddVisualToggleButton(_chartVisualTogglePanel, "BR", () => _toggleBreakoutDetections, value => _toggleBreakoutDetections = value, Color.DeepSkyBlue);
                AddVisualToggleButton(_chartVisualTogglePanel, "PB", () => _togglePullbackDetections, value => _togglePullbackDetections = value, Color.Khaki);
                AddVisualToggleButton(_chartVisualTogglePanel, "CT", () => _toggleContinuationDetections, value => _toggleContinuationDetections = value, Color.MediumSpringGreen);
                AddVisualToggleButton(_chartVisualTogglePanel, "IM", () => _toggleImpulseDetections, value => _toggleImpulseDetections = value, Color.Aqua);
                AddVisualToggleButton(_chartVisualTogglePanel, "PIN", () => _togglePinBarPatterns, value => _togglePinBarPatterns = value, Color.FromArgb(255, 0xFF, 0xB3, 0x47));
                AddVisualToggleButton(_chartVisualTogglePanel, "ENG", () => _toggleEngulfingPatterns, value => _toggleEngulfingPatterns = value, Color.FromArgb(255, 0xFF, 0x7F, 0x50));
                AddVisualToggleButton(_chartVisualTogglePanel, "BIG", () => _toggleBigCandlePatterns, value => _toggleBigCandlePatterns = value, Color.FromArgb(255, 0xFF, 0x45, 0x00));
                AddVisualToggleButton(_chartVisualTogglePanel, "MOR", () => _toggleMorningStarPatterns, value => _toggleMorningStarPatterns = value, Color.FromArgb(255, 0x9A, 0xCD, 0x32));
                AddVisualToggleButton(_chartVisualTogglePanel, "EVE", () => _toggleEveningStarPatterns, value => _toggleEveningStarPatterns = value, Color.FromArgb(255, 0xCD, 0x5C, 0x5C));
                AddVisualToggleButton(_chartVisualTogglePanel, "HAM", () => _toggleHammerPatterns, value => _toggleHammerPatterns = value, Color.FromArgb(255, 0x7C, 0xFC, 0x00));
                AddVisualToggleButton(_chartVisualTogglePanel, "HGM", () => _toggleHangingManPatterns, value => _toggleHangingManPatterns = value, Color.FromArgb(255, 0xFA, 0x80, 0x72));
                AddVisualToggleButton(_chartVisualTogglePanel, "SST", () => _toggleShootingStarPatterns, value => _toggleShootingStarPatterns = value, Color.FromArgb(255, 0xFF, 0x69, 0xB4));
                AddVisualToggleButton(_chartVisualTogglePanel, "IHM", () => _toggleInvertedHammerPatterns, value => _toggleInvertedHammerPatterns = value, Color.FromArgb(255, 0x66, 0xCD, 0xAA));
                AddVisualToggleButton(_chartVisualTogglePanel, "PRC", () => _togglePiercingLinePatterns, value => _togglePiercingLinePatterns = value, Color.FromArgb(255, 0x00, 0xCE, 0xD1));
                AddVisualToggleButton(_chartVisualTogglePanel, "DCC", () => _toggleDarkCloudCoverPatterns, value => _toggleDarkCloudCoverPatterns = value, Color.FromArgb(255, 0xFF, 0x63, 0x47));
                AddVisualToggleButton(_chartVisualTogglePanel, "3WS", () => _toggleThreeWhiteSoldiersPatterns, value => _toggleThreeWhiteSoldiersPatterns = value, Color.FromArgb(255, 0xAD, 0xFF, 0x2F));
                AddVisualToggleButton(_chartVisualTogglePanel, "3BC", () => _toggleThreeBlackCrowsPatterns, value => _toggleThreeBlackCrowsPatterns = value, Color.FromArgb(255, 0xB2, 0x22, 0x22));
                AddVisualToggleButton(_chartVisualTogglePanel, "HAR", () => _toggleHaramiPatterns, value => _toggleHaramiPatterns = value, Color.FromArgb(255, 0xBA, 0x55, 0xD3));
                AddVisualToggleButton(_chartVisualTogglePanel, "EMX", () => _toggleEmaEvents, value => _toggleEmaEvents = value, Color.FromArgb(255, 56, 189, 248));
                AddVisualToggleButton(_chartVisualTogglePanel, "VWX", () => _toggleVwapEvents, value => _toggleVwapEvents = value, Color.FromArgb(255, 14, 165, 233));
                AddVisualToggleButton(_chartVisualTogglePanel, "BBX", () => _toggleBollingerEvents, value => _toggleBollingerEvents = value, Color.FromArgb(255, 244, 114, 182));
                AddVisualToggleButton(_chartVisualTogglePanel, "RSI", () => _toggleRsiEvents, value => _toggleRsiEvents = value, Color.FromArgb(255, 168, 85, 247));
                AddVisualToggleButton(_chartVisualTogglePanel, "STO", () => _toggleStochasticEvents, value => _toggleStochasticEvents = value, Color.FromArgb(255, 59, 130, 246));
                AddVisualToggleButton(_chartVisualTogglePanel, "MAC", () => _toggleMacdEvents, value => _toggleMacdEvents = value, Color.FromArgb(255, 34, 197, 94));
                AddVisualToggleButton(_chartVisualTogglePanel, "ST", () => _toggleStrategyMarkers, value => _toggleStrategyMarkers = value, Color.FromArgb(255, 0x7C, 0xFC, 0x00));

                Chart.AddControl(_chartVisualQuickPanel);
                Chart.AddControl(_chartVisualTogglePanel);
            }
            catch (Exception ex)
            {
                SafePrint("[Panel] Visual toggle panel failed: {0}", ex.Message);
            }
        }

        private void AddVisualToggleButton(StackPanel panel, string text, Func<bool> getter, Action<bool> setter, Color accent)
        {
            if (panel == null)
                return;
            var isOn = getter();
            var button = BuildChartActionButton(text, isOn ? accent : Color.Gray, Color.FromArgb(185, 28, 28, 28), text.Length >= 3 ? 30 : 24);
            ApplyVisualToggleButtonState(button, text, isOn, accent);
            button.Click += _ =>
            {
                var nextValue = !getter();
                setter(nextValue);
                ApplyVisualToggleButtonState(button, text, nextValue, accent);
                PersistCustomUiSettingsSnapshot();
                RefreshDebugPanel();
            };
            panel.AddChild(button);
        }

        private void ApplyVisualToggleButtonState(Button button, string text, bool isOn, Color accent)
        {
            if (button == null)
                return;

            TrySetPropertyValue(button, "TextColor", isOn ? accent : Color.Gray);
            TrySetPropertyValue(button, "ForegroundColor", isOn ? accent : Color.Gray);
            TrySetPropertyValue(button, "BorderColor", isOn ? accent : Color.DimGray);
            TrySetPropertyValue(button, "BorderThickness", 1);
            TrySetPropertyValue(button, "FontSize", 7);
            TrySetPropertyValue(button, "Margin", 1);
            ApplyButtonTooltip(button, BuildVisualToggleTooltip(text, isOn));
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
                if (IsChartAllSymbolsSelection(symbolName)) return;

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
            var button = new Button { Text = text, Margin = 1 };
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

        private static void ApplyButtonTooltip(object button, string tooltip)
        {
            if (button == null || string.IsNullOrWhiteSpace(tooltip))
                return;

            TrySetPropertyValue(button, "ToolTip", tooltip);
            TrySetPropertyValue(button, "Tooltip", tooltip);
            TrySetPropertyValue(button, "Hint", tooltip);
            TrySetPropertyValue(button, "HelpText", tooltip);
            TrySetPropertyValue(button, "Description", tooltip);
        }

        private static string BuildVisualToggleTooltip(string text, bool isOn)
        {
            var state = isOn ? "ON" : "OFF";
            switch ((text ?? "").Trim().ToUpperInvariant())
            {
                case "4H": return "Toggle 4H higher-timeframe background overlay (" + state + ")";
                case "1D": return "Toggle 1D higher-timeframe overlay (" + state + ")";
                case "KZ": return "Toggle killer zones (" + state + ")";
                case "LIQ": return "Toggle liquidity levels (" + state + ")";
                case "SW": return "Toggle latest sweep detection (" + state + ")";
                case "BOS": return "Toggle latest break of structure (" + state + ")";
                case "CH": return "Toggle latest change of character (" + state + ")";
                case "RJ": return "Toggle latest rejection event (" + state + ")";
                case "BR": return "Toggle latest breakout event (" + state + ")";
                case "PB": return "Toggle latest pullback event (" + state + ")";
                case "CT": return "Toggle latest continuation event (" + state + ")";
                case "IM": return "Toggle latest impulse event (" + state + ")";
                case "PIN": return "Toggle latest bullish/bearish pin bar markers (" + state + ")";
                case "ENG": return "Toggle latest bullish/bearish engulfing markers (" + state + ")";
                case "BIG": return "Toggle latest large directional candle markers (" + state + ")";
                case "MOR": return "Toggle bullish morning star markers (" + state + ")";
                case "EVE": return "Toggle bearish evening star markers (" + state + ")";
                case "HAM": return "Toggle bullish hammer markers (" + state + ")";
                case "HGM": return "Toggle bearish hanging man markers (" + state + ")";
                case "SST": return "Toggle bearish shooting star markers (" + state + ")";
                case "IHM": return "Toggle bullish inverted hammer markers (" + state + ")";
                case "PRC": return "Toggle bullish piercing line markers (" + state + ")";
                case "DCC": return "Toggle bearish dark cloud cover markers (" + state + ")";
                case "3WS": return "Toggle bullish three white soldiers markers (" + state + ")";
                case "3BC": return "Toggle bearish three black crows markers (" + state + ")";
                case "HAR": return "Toggle bullish/bearish harami markers (" + state + ")";
                case "EMA": return "Toggle EMA 20/50/200 overlay lines (" + state + ")";
                case "VW": return "Toggle rolling VWAP overlay line (" + state + ")";
                case "BB": return "Toggle Bollinger band overlay lines (" + state + ")";
                case "EMX": return "Toggle EMA cross and reclaim markers (" + state + ")";
                case "VWX": return "Toggle VWAP cross and rejection markers (" + state + ")";
                case "BBX": return "Toggle Bollinger cross and rejection markers (" + state + ")";
                case "RSI": return "Toggle RSI threshold markers (" + state + ")";
                case "STO": return "Toggle stochastic cross markers (" + state + ")";
                case "MAC": return "Toggle MACD cross markers (" + state + ")";
                case "FVG": return "Toggle fair value gap zones (" + state + ")";
                case "OB": return "Toggle order block zones (" + state + ")";
                case "M": return "Toggle higher-timeframe mini chart (" + state + ")";
                case "KEY": return "Toggle key levels from session, period, and swings (" + state + ")";
                default: return "Toggle " + text + " (" + state + ")";
            }
        }

        private Button BuildChartOutlineButton(string text, Color accent, int width)
        {
            var button = BuildChartActionButton(text, Color.White, Color.FromArgb(185, 38, 38, 38), width);
            TrySetPropertyValue(button, "BorderColor", accent);
            TrySetPropertyValue(button, "BorderThickness", 1);
            TrySetPropertyValue(button, "Opacity", 1.0);
            return button;
        }

        private Button BuildChartTintedOutlineButton(string text, Color accent, int width)
        {
            var button = BuildChartActionButton(text, accent, Color.FromArgb(185, 38, 38, 38), width);
            TrySetPropertyValue(button, "BorderColor", accent);
            TrySetPropertyValue(button, "BorderThickness", 1);
            TrySetPropertyValue(button, "Opacity", 1.0);
            return button;
        }

        private Button BuildChartSummaryLabel(string text, Color foreground, int width)
        {
            var label = new Button { Text = text ?? "", Margin = 0 };
            TrySetPropertyValue(label, "Width", width);
            TrySetPropertyValue(label, "MinWidth", width);
            TrySetPropertyValue(label, "MaxWidth", width);
            TrySetPropertyValue(label, "Height", 14);
            TrySetPropertyValue(label, "FontSize", 8);
            TrySetPropertyValue(label, "BackgroundColor", Color.FromArgb(1, 18, 18, 18));
            TrySetPropertyValue(label, "ForegroundColor", foreground);
            TrySetPropertyValue(label, "TextColor", foreground);
            TrySetPropertyValue(label, "BorderColor", Color.FromArgb(1, 85, 85, 85));
            TrySetPropertyValue(label, "BorderThickness", 0);
            TrySetPropertyValue(label, "Opacity", 1.0);
            TrySetPropertyValue(label, "IsEnabled", true);
            TrySetPropertyValue(label, "AcceptsFocus", false);
            TrySetPropertyValue(label, "Margin", 0);
            return label;
        }

        private StructureBias DetectStructureBias(Bars sourceBars, int lookbackBars)
        {
            var swings = CollectConfirmedSwings(sourceBars, lookbackBars);
            if (swings.Count < 4)
                return StructureBias.Neutral;

            var highs = swings.Where(s => s.IsHigh).TakeLast(2).ToList();
            var lows = swings.Where(s => !s.IsHigh).TakeLast(2).ToList();
            if (highs.Count < 2 || lows.Count < 2)
                return StructureBias.Neutral;

            var higherHigh = highs[1].Price > highs[0].Price;
            var lowerHigh = highs[1].Price < highs[0].Price;
            var higherLow = lows[1].Price > lows[0].Price;
            var lowerLow = lows[1].Price < lows[0].Price;
            var lastClose = sourceBars.ClosePrices[sourceBars.Count - 1];
            var rangeMid = (highs[1].Price + lows[1].Price) * 0.5;
            var score = 0;

            if (higherHigh) score++;
            else if (lowerHigh) score--;

            if (higherLow) score++;
            else if (lowerLow) score--;

            if (lastClose >= rangeMid) score++;
            else score--;

            if (lastClose > highs[1].Price) score++;
            else if (lastClose < lows[1].Price) score--;

            if (score >= 2)
                return StructureBias.Bullish;
            if (score <= -2)
                return StructureBias.Bearish;

            return StructureBias.Neutral;
        }

        private int DetectStructureBiasScore(Bars sourceBars, int lookbackBars)
        {
            var swings = CollectConfirmedSwings(sourceBars, lookbackBars);
            if (swings.Count < 4)
                return 0;

            var highs = swings.Where(s => s.IsHigh).TakeLast(2).ToList();
            var lows = swings.Where(s => !s.IsHigh).TakeLast(2).ToList();
            if (highs.Count < 2 || lows.Count < 2)
                return 0;

            var higherHigh = highs[1].Price > highs[0].Price;
            var lowerHigh = highs[1].Price < highs[0].Price;
            var higherLow = lows[1].Price > lows[0].Price;
            var lowerLow = lows[1].Price < lows[0].Price;
            var lastClose = sourceBars.ClosePrices[sourceBars.Count - 1];
            var rangeMid = (highs[1].Price + lows[1].Price) * 0.5;
            var score = 0;

            if (higherHigh) score++;
            else if (lowerHigh) score--;

            if (higherLow) score++;
            else if (lowerLow) score--;

            if (lastClose >= rangeMid) score++;
            else score--;

            if (lastClose > highs[1].Price) score++;
            else if (lastClose < lows[1].Price) score--;

            return score;
        }

        private bool TryDetectRecentSweepBiasScore(Bars sourceBars, TimeFrame sourceTimeFrame, int lookbackBars, out int biasScore)
        {
            biasScore = 0;
            if (sourceBars == null || sourceBars.Count < 8)
                return false;

            var swings = CollectConfirmedSwings(sourceBars, lookbackBars);
            if (swings.Count < 2)
                return false;

            var candidates = swings
                .Take(Math.Max(0, swings.Count - 1))
                .Reverse()
                .Take(10)
                .ToList();
            if (candidates.Count == 0)
                return false;

            var startBar = Math.Max(2, sourceBars.Count - 8);
            for (var reclaimBarIndex = sourceBars.Count - 1; reclaimBarIndex >= startBar; reclaimBarIndex--)
            {
                foreach (var candidate in candidates)
                {
                    if (candidate.BarIndex >= reclaimBarIndex)
                        continue;

                    var candidateLevel = new SweepCandidate
                    {
                        Label = candidate.IsHigh ? "BSL" : "SSL",
                        Price = candidate.Price,
                        IsHigh = candidate.IsHigh,
                        Time = candidate.Time,
                        SourceTimeFrame = sourceTimeFrame,
                        Color = GetTimeFrameStructureColor(sourceTimeFrame)
                    };

                    SweepMatch match;
                    if (!TryMatchSweepPattern(sourceBars, reclaimBarIndex, candidateLevel, out match))
                        continue;

                    biasScore = candidate.IsHigh ? -2 : 2;
                    return true;
                }
            }

            return false;
        }

        private int DetectArtifactFirstBiasScore(Bars sourceBars, TimeFrame sourceTimeFrame, int lookbackBars)
        {
            if (sourceBars == null || sourceBars.Count < 10)
                return 0;

            var latestEvent = CollectStructureEvents(sourceBars, sourceTimeFrame, lookbackBars)
                .TakeLast(1)
                .FirstOrDefault();
            if (latestEvent.Time != DateTime.MinValue)
            {
                if (latestEvent.IsBullish)
                    return latestEvent.IsChoch ? 3 : 4;
                return latestEvent.IsChoch ? -3 : -4;
            }

            int sweepScore;
            if (TryDetectRecentSweepBiasScore(sourceBars, sourceTimeFrame, lookbackBars, out sweepScore))
                return sweepScore;

            return DetectStructureBiasScore(sourceBars, lookbackBars);
        }

        private string FormatStructureBiasShort(int biasScore)
        {
            if (biasScore >= 3) return "▲";
            if (biasScore >= 2) return "↑";
            if (biasScore <= -3) return "▼";
            if (biasScore <= -2) return "↓";
            return "•";
        }

        private Color GetStructureBiasColor(int biasScore)
        {
            if (biasScore >= 3) return Color.LimeGreen;
            if (biasScore >= 2) return Color.FromArgb(255, 120, 255, 120);
            if (biasScore <= -3) return Color.IndianRed;
            if (biasScore <= -2) return Color.FromArgb(255, 255, 140, 140);
            return Color.LightGray;
        }

        private bool HasCounterTrendCandlePattern(Bars sourceBars, int biasScore)
        {
            if (sourceBars == null || sourceBars.Count < 4 || Math.Abs(biasScore) < 2)
                return false;

            var lastIndex = sourceBars.Count - 2;
            var prevIndex = sourceBars.Count - 3;
            if (lastIndex <= 0 || prevIndex < 0)
                return false;

            var openV = sourceBars.OpenPrices[lastIndex];
            var highV = sourceBars.HighPrices[lastIndex];
            var lowV = sourceBars.LowPrices[lastIndex];
            var closeV = sourceBars.ClosePrices[lastIndex];
            var prevOpen = sourceBars.OpenPrices[prevIndex];
            var prevClose = sourceBars.ClosePrices[prevIndex];
            var range = Math.Max(highV - lowV, Math.Max(Symbol != null ? Symbol.PipSize : 0.0000001, 0.0000001));
            var body = Math.Abs(closeV - openV);

            var strongBearish = closeV < openV && body / range >= 0.55 && closeV <= lowV + (range * 0.30);
            var strongBullish = closeV > openV && body / range >= 0.55 && closeV >= highV - (range * 0.30);
            var bearishEngulfing = closeV < openV && prevClose > prevOpen && openV >= prevClose && closeV <= prevOpen;
            var bullishEngulfing = closeV > openV && prevClose < prevOpen && openV <= prevClose && closeV >= prevOpen;

            if (biasScore >= 2)
                return strongBearish || bearishEngulfing;

            return strongBullish || bullishEngulfing;
        }

        private bool TryGetCounterTrendWarning(string symbolName, TimeFrame timeFrame, int biasScore, out string marker, out Color color)
        {
            marker = "";
            color = Color.LightGray;

            if (string.IsNullOrWhiteSpace(symbolName) || IsChartAllSymbolsSelection(symbolName) || Math.Abs(biasScore) < 2)
                return false;

            try
            {
                var normalizedSymbol = symbolName.Trim().ToUpperInvariant();
                var bars = MarketData.GetBars(timeFrame, normalizedSymbol);
                if (bars == null || bars.Count < 20)
                    return false;

                var recentThresholdIndex = Math.Max(0, bars.Count - 4);
                var recentThresholdTime = bars.OpenTimes[recentThresholdIndex];
                var expectsBullishCounter = biasScore <= -2;
                var pullbackMatchesBias = biasScore >= 2;
                var recentEvents = GetCanonicalEventsForSymbolTimeFrame(normalizedSymbol, timeFrame, 8)
                    .Where(evt => evt.BarTime >= recentThresholdTime)
                    .ToList();

                var hasPullbackPhase = recentEvents.Any(evt =>
                    evt.EventType == CanonicalEventType.Pullback &&
                    evt.IsBullish == pullbackMatchesBias);

                var hasCounterReversalEvent = recentEvents.Any(evt =>
                    evt.IsBullish == expectsBullishCounter &&
                    (evt.EventType == CanonicalEventType.Rejection ||
                     evt.EventType == CanonicalEventType.SweepReclaim ||
                     evt.EventType == CanonicalEventType.Choch ||
                     evt.EventType == CanonicalEventType.Breakout));

                var hasCounterCandlePattern = HasCounterTrendCandlePattern(bars, biasScore);
                if (!hasPullbackPhase && !hasCounterReversalEvent && !hasCounterCandlePattern)
                    return false;

                marker = expectsBullishCounter ? "↑" : "↓";
                color = hasCounterReversalEvent
                    ? (expectsBullishCounter ? Color.LimeGreen : Color.IndianRed)
                    : Color.Gold;
                return true;
            }
            catch
            {
                return false;
            }
        }

        private Tuple<int, int, int> GetSymbolTrendBias(string symbolName)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(symbolName) || IsChartAllSymbolsSelection(symbolName))
                    return Tuple.Create(0, 0, 0);

                var dailyBars = MarketData.GetBars(TimeFrame.Daily, symbolName);
                var h4Bars = MarketData.GetBars(TimeFrame.Hour4, symbolName);
                var m15Bars = MarketData.GetBars(TimeFrame.Minute15, symbolName);
                var dailyTrend = dailyBars != null && dailyBars.Count >= 10
                    ? DetectArtifactFirstBiasScore(dailyBars, TimeFrame.Daily, 180)
                    : 0;
                var h4Bias = h4Bars != null && h4Bars.Count >= 10
                    ? DetectArtifactFirstBiasScore(h4Bars, TimeFrame.Hour4, 180)
                    : 0;
                var m15Bias = m15Bars != null && m15Bars.Count >= 10
                    ? DetectArtifactFirstBiasScore(m15Bars, TimeFrame.Minute15, 180)
                    : 0;
                return Tuple.Create(dailyTrend, h4Bias, m15Bias);
            }
            catch
            {
                return Tuple.Create(0, 0, 0);
            }
        }

        private int GetSymbolTrendBiasForTimeFrame(string symbolName, TimeFrame timeFrame)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(symbolName) || IsChartAllSymbolsSelection(symbolName))
                    return 0;

                var bars = MarketData.GetBars(timeFrame, symbolName);
                return bars != null && bars.Count >= 10
                    ? DetectArtifactFirstBiasScore(bars, timeFrame, 180)
                    : 0;
            }
            catch
            {
                return 0;
            }
        }

        private void RefreshChartSummaryPanel(RiskGateState riskState)
        {
            try
            {
                _dashboardEventCache.Clear();
                if (_chartSummaryPanel != null)
                {
                    try { Chart.RemoveControl(_chartSummaryPanel); } catch { }
                    _chartSummaryPanel = null;
                }

                var positionGroups = Positions
                    .GroupBy(p => string.IsNullOrWhiteSpace(p.SymbolName) ? "" : p.SymbolName.Trim().ToUpperInvariant())
                    .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);
                var dashboardSymbols = GetChartToolbarSymbols()
                    .Where(symbol => !IsChartAllSymbolsSelection(symbol))
                    .ToList();

                if (dashboardSymbols.Count == 0)
                    return;

                _chartSummaryPanel = new StackPanel
                {
                    Orientation = Orientation.Vertical,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Top,
                    Margin = "0 22 0 0",
                    Opacity = 0.84
                };

                var summaryTimeFrames = new[]
                {
                    new { Label = "1D", Tf = TimeFrame.Daily, Color = Color.Gold },
                    new { Label = "4H", Tf = TimeFrame.Hour4, Color = Color.MediumPurple },
                    new { Label = "1H", Tf = TimeFrame.Hour, Color = Color.CornflowerBlue },
                    new { Label = "15m", Tf = TimeFrame.Minute15, Color = Color.DeepSkyBlue },
                    new { Label = "5m", Tf = TimeFrame.Minute5, Color = Color.LimeGreen },
                    new { Label = "1m", Tf = TimeFrame.Minute, Color = Color.WhiteSmoke }
                };
                const int symbolWidth = 64;
                const int tfWidth = 24;
                const int pnlWidth = 58;

                var headerRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = "0 0 0 1" };
                headerRow.AddChild(BuildChartSummaryLabel("", Color.White, symbolWidth));
                foreach (var frame in summaryTimeFrames)
                    headerRow.AddChild(BuildChartSummaryLabel(frame.Label, frame.Color, tfWidth));
                headerRow.AddChild(BuildChartSummaryLabel("W", Color.Aqua, pnlWidth));
                headerRow.AddChild(BuildChartSummaryLabel("L", Color.Aqua, pnlWidth));
                _chartSummaryPanel.AddChild(headerRow);

                foreach (var symbolName in dashboardSymbols)
                {
                    List<Position> symbolPositions;
                    if (!positionGroups.TryGetValue(symbolName, out symbolPositions))
                        symbolPositions = new List<Position>();
                    var symbolCurrentWin = symbolPositions.Sum(p => Math.Max(0, double.IsNaN(p.NetProfit) ? 0 : p.NetProfit));
                    var symbolCurrentLose = symbolPositions.Sum(p => Math.Max(0, -(double.IsNaN(p.NetProfit) ? 0 : p.NetProfit)));
                    var symbolPossibleWin = symbolPositions.Sum(EstimateOpenPositionTpAmount);
                    var symbolPossibleLose = Math.Abs(symbolPositions.Sum(EstimateOpenPositionSlOutcomeAmount));

                    var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = "0 0 0 1" };
                    row.AddChild(BuildChartSummaryLabel(symbolName, Color.White, symbolWidth));
                    foreach (var frame in summaryTimeFrames)
                    {
                        var biasScore = GetSymbolTrendBiasForTimeFrame(symbolName, frame.Tf);
                        string counterMarker;
                        Color counterColor;
                        var hasCounter = TryGetCounterTrendWarning(symbolName, frame.Tf, biasScore, out counterMarker, out counterColor);
                        var cellText = FormatStructureBiasShort(biasScore);
                        if (hasCounter && !string.IsNullOrWhiteSpace(counterMarker))
                            cellText = string.Concat(cellText, counterMarker);
                        row.AddChild(BuildChartSummaryLabel(cellText, hasCounter ? counterColor : GetStructureBiasColor(biasScore), tfWidth));
                    }
                    row.AddChild(BuildChartSummaryLabel(string.Format(CultureInfo.InvariantCulture, "{0} / {1}", FormatDashboardNumber(symbolCurrentWin), FormatDashboardNumber(symbolPossibleWin)), Color.LimeGreen, pnlWidth));
                    row.AddChild(BuildChartSummaryLabel(string.Format(CultureInfo.InvariantCulture, "{0} / {1}", FormatDashboardNumber(symbolCurrentLose), FormatDashboardNumber(symbolPossibleLose)), Color.Red, pnlWidth));
                    _chartSummaryPanel.AddChild(row);
                }

                var allRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = "0 0 0 1" };
                allRow.AddChild(BuildChartSummaryLabel("ALL", Color.White, symbolWidth));
                foreach (var frame in summaryTimeFrames)
                    allRow.AddChild(BuildChartSummaryLabel("-", Color.LightGray, tfWidth));
                allRow.AddChild(BuildChartSummaryLabel(string.Format(CultureInfo.InvariantCulture, "{0} / {1}", FormatDashboardNumber(riskState.CurrentWinAmount), FormatDashboardNumber(riskState.PossibleWinAmount)), Color.LimeGreen, pnlWidth));
                allRow.AddChild(BuildChartSummaryLabel(string.Format(CultureInfo.InvariantCulture, "{0} / {1}", FormatDashboardNumber(riskState.CurrentLoseAmount), FormatDashboardNumber(Math.Abs(riskState.PossibleSlOutcomeAmount))), Color.Red, pnlWidth));
                _chartSummaryPanel.AddChild(allRow);

                Chart.AddControl(_chartSummaryPanel);
            }
            catch (Exception ex)
            {
                SafePrint("[Panel] Summary panel failed: {0}", ex.Message);
            }
        }

        private List<string> GetChartToolbarSymbols()
        {
            var symbols = new List<string>();

            if (Positions != null)
            {
                symbols.AddRange(
                    Positions
                        .Where(p => p != null && !string.IsNullOrWhiteSpace(p.SymbolName))
                        .Select(p => p.SymbolName.Trim()));
            }

            if (PendingOrders != null)
            {
                symbols.AddRange(
                    PendingOrders
                        .Where(o => o != null && !string.IsNullOrWhiteSpace(o.SymbolName))
                        .Select(o => o.SymbolName.Trim()));
            }

            var chartSymbolName = Chart != null && !string.IsNullOrWhiteSpace(Chart.SymbolName)
                ? Chart.SymbolName.Trim()
                : "";
            if (!string.IsNullOrWhiteSpace(chartSymbolName) && !symbols.Any(s => string.Equals(s, chartSymbolName, StringComparison.OrdinalIgnoreCase)))
                symbols.Add(chartSymbolName);

            var orderedSymbols = symbols
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(s => s, StringComparer.OrdinalIgnoreCase)
                .ToList();

            orderedSymbols.Insert(0, ChartAllSymbolsOption);
            return orderedSymbols;
        }

        private bool IsChartAllSymbolsSelection(string symbolName)
        {
            return string.Equals((symbolName ?? "").Trim(), ChartAllSymbolsOption, StringComparison.OrdinalIgnoreCase);
        }

        private string NormalizeChartDirectionSelection(string raw = null)
        {
            var value = string.IsNullOrWhiteSpace(raw) ? _chartSelectedDirection : raw.Trim();
            if (string.Equals(value, "Buy", StringComparison.OrdinalIgnoreCase)) return "Buy";
            if (string.Equals(value, "Sell", StringComparison.OrdinalIgnoreCase)) return "Sell";
            return "All";
        }

        private bool DirectionMatchesTradeType(string selectedDirection, TradeType tradeType)
        {
            var normalized = NormalizeChartDirectionSelection(selectedDirection);
            if (normalized == "All") return true;
            if (normalized == "Buy") return tradeType == TradeType.Buy;
            if (normalized == "Sell") return tradeType == TradeType.Sell;
            return true;
        }

        private bool SymbolHasOpenPositions(string symbolName, string selectedDirection = null)
        {
            return Positions != null &&
                !string.IsNullOrWhiteSpace(symbolName) &&
                Positions.Any(p =>
                    p != null &&
                    (IsChartAllSymbolsSelection(symbolName) || string.Equals(p.SymbolName, symbolName, StringComparison.OrdinalIgnoreCase)) &&
                    DirectionMatchesTradeType(selectedDirection, p.TradeType));
        }

        private bool SymbolHasPendingOrders(string symbolName, string selectedDirection = null)
        {
            return PendingOrders != null &&
                !string.IsNullOrWhiteSpace(symbolName) &&
                PendingOrders.Any(o =>
                    o != null &&
                    (IsChartAllSymbolsSelection(symbolName) || string.Equals(o.SymbolName, symbolName, StringComparison.OrdinalIgnoreCase)) &&
                    DirectionMatchesTradeType(selectedDirection, o.TradeType));
        }

        private List<Position> GetChartSelectedPositions(string symbolName, string selectedDirection = null)
        {
            return Positions != null
                ? Positions
                    .Where(p =>
                        p != null &&
                        (IsChartAllSymbolsSelection(symbolName) || string.Equals(p.SymbolName, symbolName, StringComparison.OrdinalIgnoreCase)) &&
                        DirectionMatchesTradeType(selectedDirection, p.TradeType))
                    .ToList()
                : new List<Position>();
        }

        private List<PendingOrder> GetChartSelectedPendingOrders(string symbolName, string selectedDirection = null)
        {
            return PendingOrders != null
                ? PendingOrders
                    .Where(o =>
                        o != null &&
                        (IsChartAllSymbolsSelection(symbolName) || string.Equals(o.SymbolName, symbolName, StringComparison.OrdinalIgnoreCase)) &&
                        DirectionMatchesTradeType(selectedDirection, o.TradeType))
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

            if (IsChartAllSymbolsSelection(symbolName))
            {
                SafePrint("[ChartTrade] 'All' is management-only. Select one symbol for entries or protection edits.");
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
            var chartSymbolName = Chart != null && !string.IsNullOrWhiteSpace(Chart.SymbolName)
                ? Chart.SymbolName.Trim()
                : "";
            if (!string.IsNullOrWhiteSpace(preferred))
            {
                if (IsChartAllSymbolsSelection(preferred))
                {
                    _chartSelectedSymbol = ChartAllSymbolsOption;
                    return _chartSelectedSymbol;
                }

                var match = symbols.FirstOrDefault(s => string.Equals(s, preferred.Trim(), StringComparison.OrdinalIgnoreCase));
                if (!string.IsNullOrWhiteSpace(match))
                    _chartSelectedSymbol = match;
            }

            if (!string.IsNullOrWhiteSpace(_chartSelectedSymbol))
            {
                if (IsChartAllSymbolsSelection(_chartSelectedSymbol))
                {
                    _chartSelectedSymbol = ChartAllSymbolsOption;
                    return _chartSelectedSymbol;
                }

                var existing = symbols.FirstOrDefault(s => string.Equals(s, _chartSelectedSymbol, StringComparison.OrdinalIgnoreCase));
                if (!string.IsNullOrWhiteSpace(existing))
                {
                    _chartSelectedSymbol = existing;
                    return _chartSelectedSymbol;
                }
            }

            if (!string.IsNullOrWhiteSpace(chartSymbolName))
            {
                var chartMatch = symbols.FirstOrDefault(s => string.Equals(s, chartSymbolName, StringComparison.OrdinalIgnoreCase));
                if (!string.IsNullOrWhiteSpace(chartMatch))
                {
                    _chartSelectedSymbol = chartMatch;
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

        private bool TryAddChartDirectionCombo(StackPanel panel)
        {
            try
            {
                _chartDirectionCombo = null;
                var assembly = typeof(StackPanel).Assembly;
                var comboType = assembly.GetType("cAlgo.API.ComboBox") ?? assembly.GetType("cAlgo.API.Controls.ComboBox");
                if (comboType == null) return false;

                var combo = Activator.CreateInstance(comboType);
                TrySetPropertyValue(combo, "Margin", 3);
                TrySetPropertyValue(combo, "Width", 72);
                TrySetPropertyValue(combo, "MinWidth", 72);
                TrySetPropertyValue(combo, "MaxWidth", 84);
                TrySetPropertyValue(combo, "FontSize", 8);

                var items = TryGetPropertyValue(combo, "Items");
                foreach (var item in new[] { "All", "Buy", "Sell" })
                {
                    if (!(items != null && TryAddToCollection(items, item)))
                        TryInvokeVoidMethod(combo, "AddItem", item);
                }

                var normalizedDirection = NormalizeChartDirectionSelection();
                TrySetPropertyValue(combo, "SelectedItem", normalizedDirection);
                TrySetPropertyValue(combo, "SelectedValue", normalizedDirection);
                TrySetPropertyValue(combo, "SelectedIndex", normalizedDirection == "Buy" ? 1 : normalizedDirection == "Sell" ? 2 : 0);

                var changedEvent = comboType.GetEvent("SelectionChanged") ?? comboType.GetEvent("SelectedItemChanged");
                if (changedEvent != null)
                {
                    Action<object> handler = _ =>
                    {
                        var previousDirection = _chartSelectedDirection;
                        var selected = ReadChartDirectionComboSelection();
                        _chartSelectedDirection = NormalizeChartDirectionSelection(selected);
                        if (!_isRebuildingChartPanel && !string.Equals(previousDirection, _chartSelectedDirection, StringComparison.OrdinalIgnoreCase))
                        {
                            PersistCustomUiSettingsSnapshot();
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

                _chartDirectionCombo = combo;
                return true;
            }
            catch (Exception ex)
            {
                SafePrint("[Panel] Direction combo unavailable: {0}", ex.Message);
                return false;
            }
        }

        private bool TryAddChartTradeTypeCombo(StackPanel panel)
        {
            try
            {
                _chartTradeTypeCombo = null;
                var assembly = typeof(StackPanel).Assembly;
                var comboType = assembly.GetType("cAlgo.API.ComboBox") ?? assembly.GetType("cAlgo.API.Controls.ComboBox");
                if (comboType == null) return false;

                var combo = Activator.CreateInstance(comboType);
                TrySetPropertyValue(combo, "Margin", 3);
                TrySetPropertyValue(combo, "Width", 52);
                TrySetPropertyValue(combo, "MinWidth", 52);
                TrySetPropertyValue(combo, "MaxWidth", 64);
                TrySetPropertyValue(combo, "FontSize", 8);

                var items = TryGetPropertyValue(combo, "Items");
                foreach (var item in new[] { "Scalp", "Swing", "Daily" })
                {
                    if (!(items != null && TryAddToCollection(items, item)))
                        TryInvokeVoidMethod(combo, "AddItem", item);
                }

                var normalizedType = NormalizeChartTradeProfileSelection();
                TrySetPropertyValue(combo, "SelectedItem", normalizedType);
                TrySetPropertyValue(combo, "SelectedValue", normalizedType);
                TrySetPropertyValue(combo, "SelectedIndex", normalizedType == "Swing" ? 1 : normalizedType == "Daily" ? 2 : 0);

                var changedEvent = comboType.GetEvent("SelectionChanged") ?? comboType.GetEvent("SelectedItemChanged");
                if (changedEvent != null)
                {
                    Action<object> handler = _ =>
                    {
                        var previousType = _chartSelectedTradeProfile;
                        var selected = ReadChartTradeTypeComboSelection();
                        _chartSelectedTradeProfile = NormalizeChartTradeProfileSelection(selected);
                        if (!_isRebuildingChartPanel && !string.Equals(previousType, _chartSelectedTradeProfile, StringComparison.OrdinalIgnoreCase))
                        {
                            PersistCustomUiSettingsSnapshot();
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

                _chartTradeTypeCombo = combo;
                return true;
            }
            catch (Exception ex)
            {
                SafePrint("[Panel] Trade type combo unavailable: {0}", ex.Message);
                return false;
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
                TrySetPropertyValue(combo, "Width", 84);
                TrySetPropertyValue(combo, "MinWidth", 84);
                TrySetPropertyValue(combo, "MaxWidth", 96);
                TrySetPropertyValue(combo, "FontSize", 8);
                TrySetPropertyValue(combo, "SelectedIndex", 0);

                var changedEvent = comboType.GetEvent("SelectionChanged") ?? comboType.GetEvent("SelectedItemChanged");
                if (changedEvent != null)
                {
                    Action<object> handler = _ =>
                    {
                        var previousSymbol = _chartSelectedSymbol;
                        var raw =
                            TryGetPropertyValue(combo, "SelectedItem") ??
                            TryGetPropertyValue(combo, "SelectedValue") ??
                            TryGetPropertyValue(combo, "Text");
                        var selected = raw != null ? Convert.ToString(raw, CultureInfo.InvariantCulture) : "";
                        if (!string.IsNullOrWhiteSpace(selected))
                            _chartSelectedSymbol = EnsureChartSelectedSymbol(selected);
                        if (!_isRebuildingChartPanel && !string.Equals(previousSymbol, _chartSelectedSymbol, StringComparison.OrdinalIgnoreCase))
                        {
                            PersistCustomUiSettingsSnapshot();
                            if (!IsChartAllSymbolsSelection(_chartSelectedSymbol))
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
                RefreshChartSymbolSelector();
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

        private string TryReadChartComboRawSelection(object combo)
        {
            try
            {
                if (combo == null) return "";
                var raw =
                    TryGetPropertyValue(combo, "SelectedItem") ??
                    TryGetPropertyValue(combo, "SelectedValue") ??
                    TryGetPropertyValue(combo, "Text");
                return raw != null ? Convert.ToString(raw, CultureInfo.InvariantCulture) : "";
            }
            catch
            {
                return "";
            }
        }

        private void SyncChartToolbarSelectionsFromControls()
        {
            if (_isRebuildingChartPanel)
                return;

            var needsRebuild = false;

            var rawSymbol = TryReadChartComboRawSelection(_chartSymbolCombo);
            if (!string.IsNullOrWhiteSpace(rawSymbol))
            {
                var normalizedSymbol = EnsureChartSelectedSymbol(rawSymbol);
                if (!string.Equals(normalizedSymbol, _chartSelectedSymbol, StringComparison.OrdinalIgnoreCase))
                {
                    _chartSelectedSymbol = normalizedSymbol;
                    if (!IsChartAllSymbolsSelection(_chartSelectedSymbol))
                        RefreshChartToSelectedSymbol();
                    needsRebuild = true;
                }
            }

            var rawDirection = TryReadChartComboRawSelection(_chartDirectionCombo);
            if (!string.IsNullOrWhiteSpace(rawDirection))
            {
                var normalizedDirection = NormalizeChartDirectionSelection(rawDirection);
                if (!string.Equals(normalizedDirection, _chartSelectedDirection, StringComparison.OrdinalIgnoreCase))
                {
                    _chartSelectedDirection = normalizedDirection;
                    needsRebuild = true;
                }
            }

            var rawProfile = TryReadChartComboRawSelection(_chartTradeTypeCombo);
            if (!string.IsNullOrWhiteSpace(rawProfile))
            {
                var normalizedProfile = NormalizeChartTradeProfileSelection(rawProfile);
                if (!string.Equals(normalizedProfile, _chartSelectedTradeProfile, StringComparison.OrdinalIgnoreCase))
                {
                    _chartSelectedTradeProfile = normalizedProfile;
                    needsRebuild = true;
                }
            }

            if (needsRebuild)
            {
                PersistCustomUiSettingsSnapshot();
                RebuildChartButtonPanel();
            }
        }

        private string ReadChartDirectionComboSelection()
        {
            try
            {
                if (_chartDirectionCombo == null) return NormalizeChartDirectionSelection();

                var raw =
                    TryGetPropertyValue(_chartDirectionCombo, "SelectedItem") ??
                    TryGetPropertyValue(_chartDirectionCombo, "SelectedValue") ??
                    TryGetPropertyValue(_chartDirectionCombo, "Text");
                var text = raw != null ? Convert.ToString(raw, CultureInfo.InvariantCulture) : "";
                if (!string.IsNullOrWhiteSpace(text))
                {
                    _chartSelectedDirection = NormalizeChartDirectionSelection(text);
                    return _chartSelectedDirection;
                }
            }
            catch
            {
            }
            _chartSelectedDirection = NormalizeChartDirectionSelection();
            return _chartSelectedDirection;
        }

        private string ReadChartTradeTypeComboSelection()
        {
            try
            {
                if (_chartTradeTypeCombo == null) return NormalizeChartTradeProfileSelection();

                var raw =
                    TryGetPropertyValue(_chartTradeTypeCombo, "SelectedItem") ??
                    TryGetPropertyValue(_chartTradeTypeCombo, "SelectedValue") ??
                    TryGetPropertyValue(_chartTradeTypeCombo, "Text");
                var text = raw != null ? Convert.ToString(raw, CultureInfo.InvariantCulture) : "";
                if (!string.IsNullOrWhiteSpace(text))
                {
                    _chartSelectedTradeProfile = NormalizeChartTradeProfileSelection(text);
                    return _chartSelectedTradeProfile;
                }
            }
            catch
            {
            }
            _chartSelectedTradeProfile = NormalizeChartTradeProfileSelection();
            return _chartSelectedTradeProfile;
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

        private double ResolveVolumeUnitsForRisk(Symbol symbol, TradeType tradeType, double entryPrice, double stopLossPrice, double maxRiskMoney)
        {
            if (symbol == null)
                return 0;

            var minVolume = !double.IsNaN(symbol.VolumeInUnitsMin) && symbol.VolumeInUnitsMin > 0
                ? symbol.VolumeInUnitsMin
                : 0;
            if (minVolume <= 0)
                return 0;

            if (entryPrice > 0 && stopLossPrice > 0 && maxRiskMoney > 0)
            {
                var stopLossPips = CalculateStopLossPips(symbol, entryPrice, stopLossPrice);
                if (!(stopLossPips > 0))
                    return 0;

                var riskAtMinVolume = EstimateRiskAmount(symbol, tradeType, entryPrice, stopLossPrice, minVolume);
                if (riskAtMinVolume > 0)
                {
                    if (riskAtMinVolume > maxRiskMoney)
                        return 0;

                    double rawVolume = 0;
                    try
                    {
                        rawVolume = symbol.VolumeForFixedRisk(maxRiskMoney, stopLossPips, RoundingMode.Down);
                    }
                    catch
                    {
                        rawVolume = minVolume * (maxRiskMoney / riskAtMinVolume);
                    }

                    var normalized = symbol.NormalizeVolumeInUnits(rawVolume, RoundingMode.Down);
                    if (normalized >= minVolume)
                        return normalized;

                    return minVolume;
                }

                return 0;
            }

            return 0;
        }

        private double ResolveChartTradeVolumeForRisk(Symbol symbol, TradeType tradeType, double entryPrice, double stopLossPrice, double maxRiskMoney, string symbolName)
        {
            var riskVolume = ResolveVolumeUnitsForRisk(symbol, tradeType, entryPrice, stopLossPrice, maxRiskMoney);
            if (maxRiskMoney > 0)
                return riskVolume;

            if (riskVolume > 0)
                return riskVolume;

            return ResolveChartTradeVolume(symbol, symbolName);
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

        private List<double> CollectChartExistingProtectionLevels(string symbolName)
        {
            var candidates = new List<double>();
            if (string.IsNullOrWhiteSpace(symbolName))
                return candidates;

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

            return candidates.Distinct().ToList();
        }

        private void AddDistinctChartLevel(List<double> candidates, double price, double tolerance)
        {
            if (candidates == null || price <= 0)
                return;

            if (candidates.Any(v => Math.Abs(v - price) <= tolerance))
                return;

            candidates.Add(price);
        }

        private void AddChartLevelCandidate(List<ChartLevelCandidate> candidates, double price, double tolerance, int weight = 1)
        {
            if (candidates == null || price <= 0 || weight <= 0)
                return;

            for (var i = 0; i < candidates.Count; i++)
            {
                if (Math.Abs(candidates[i].Price - price) <= tolerance)
                {
                    var mergedWeight = candidates[i].Weight + weight;
                    var mergedPrice = ((candidates[i].Price * candidates[i].Weight) + (price * weight)) / Math.Max(1, mergedWeight);
                    candidates[i] = new ChartLevelCandidate
                    {
                        Price = mergedPrice,
                        Weight = mergedWeight
                    };
                    return;
                }
            }

            candidates.Add(new ChartLevelCandidate
            {
                Price = price,
                Weight = weight
            });
        }

        private void AddChartLevelCandidatesFromRaw(List<ChartLevelCandidate> weightedCandidates, IEnumerable<double> rawLevels, double tolerance, int weight = 1)
        {
            if (weightedCandidates == null || rawLevels == null)
                return;

            foreach (var level in rawLevels)
                AddChartLevelCandidate(weightedCandidates, level, tolerance, weight);
        }

        private List<SwingPoint> CollectConfirmedSwings(Bars sourceBars, int lookbackBars)
        {
            var swings = new List<SwingPoint>();
            if (sourceBars == null || sourceBars.Count < 5)
                return swings;

            var start = Math.Max(2, sourceBars.Count - Math.Max(lookbackBars, 10));
            for (var i = start; i < sourceBars.Count - 2; i++)
            {
                var isHigh = sourceBars.HighPrices[i] > sourceBars.HighPrices[i - 1] && sourceBars.HighPrices[i] > sourceBars.HighPrices[i - 2] &&
                             sourceBars.HighPrices[i] > sourceBars.HighPrices[i + 1] && sourceBars.HighPrices[i] > sourceBars.HighPrices[i + 2];
                if (isHigh)
                {
                    swings.Add(new SwingPoint
                    {
                        BarIndex = i,
                        Time = sourceBars.OpenTimes[i],
                        Price = sourceBars.HighPrices[i],
                        IsHigh = true
                    });
                }

                var isLow = sourceBars.LowPrices[i] < sourceBars.LowPrices[i - 1] && sourceBars.LowPrices[i] < sourceBars.LowPrices[i - 2] &&
                            sourceBars.LowPrices[i] < sourceBars.LowPrices[i + 1] && sourceBars.LowPrices[i] < sourceBars.LowPrices[i + 2];
                if (isLow)
                {
                    swings.Add(new SwingPoint
                    {
                        BarIndex = i,
                        Time = sourceBars.OpenTimes[i],
                        Price = sourceBars.LowPrices[i],
                        IsHigh = false
                    });
                }
            }

            return swings.OrderBy(swing => swing.BarIndex).ToList();
        }

        private void AddFvgLevelCandidates(List<double> candidates, Bars sourceBars, double tolerance)
        {
            if (sourceBars == null || sourceBars.Count < 3)
                return;

            var maxZones = 8;
            var startIndex = Math.Max(2, sourceBars.Count - 80);
            for (var i = sourceBars.Count - 1; i >= startIndex && maxZones > 0; i--)
            {
                var leftHigh = sourceBars.HighPrices[i - 2];
                var leftLow = sourceBars.LowPrices[i - 2];
                var rightHigh = sourceBars.HighPrices[i];
                var rightLow = sourceBars.LowPrices[i];

                if (rightLow > leftHigh)
                {
                    if (IsZoneTouched(sourceBars, i + 1, leftHigh, rightLow))
                        continue;
                    AddDistinctChartLevel(candidates, leftHigh, tolerance);
                    AddDistinctChartLevel(candidates, rightLow, tolerance);
                    maxZones--;
                }
                else if (rightHigh < leftLow)
                {
                    if (IsZoneTouched(sourceBars, i + 1, rightHigh, leftLow))
                        continue;
                    AddDistinctChartLevel(candidates, rightHigh, tolerance);
                    AddDistinctChartLevel(candidates, leftLow, tolerance);
                    maxZones--;
                }
            }
        }

        private void AddOrderBlockLevelCandidates(List<double> candidates, Bars sourceBars, double tolerance)
        {
            if (sourceBars == null || sourceBars.Count < 4)
                return;

            var maxBlocks = 6;
            var startIndex = Math.Max(3, sourceBars.Count - 80);
            for (var i = sourceBars.Count - 1; i >= startIndex && maxBlocks > 0; i--)
            {
                var leftHigh = sourceBars.HighPrices[i - 2];
                var leftLow = sourceBars.LowPrices[i - 2];
                var rightHigh = sourceBars.HighPrices[i];
                var rightLow = sourceBars.LowPrices[i];

                if (rightLow > leftHigh)
                {
                    for (var j = i - 1; j >= Math.Max(1, i - 5); j--)
                    {
                        if (sourceBars.ClosePrices[j] < sourceBars.OpenPrices[j] && !IsOrderBlockTouched(sourceBars, j + 1, j))
                        {
                            var obHigh = OrderBlockUseFullWick ? sourceBars.HighPrices[j] : Math.Max(sourceBars.OpenPrices[j], sourceBars.ClosePrices[j]);
                            var obLow = OrderBlockUseFullWick ? sourceBars.LowPrices[j] : Math.Min(sourceBars.OpenPrices[j], sourceBars.ClosePrices[j]);
                            AddDistinctChartLevel(candidates, obHigh, tolerance);
                            AddDistinctChartLevel(candidates, obLow, tolerance);
                            maxBlocks--;
                            break;
                        }
                    }
                }
                else if (rightHigh < leftLow)
                {
                    for (var j = i - 1; j >= Math.Max(1, i - 5); j--)
                    {
                        if (sourceBars.ClosePrices[j] > sourceBars.OpenPrices[j] && !IsOrderBlockTouched(sourceBars, j + 1, j))
                        {
                            var obHigh = OrderBlockUseFullWick ? sourceBars.HighPrices[j] : Math.Max(sourceBars.OpenPrices[j], sourceBars.ClosePrices[j]);
                            var obLow = OrderBlockUseFullWick ? sourceBars.LowPrices[j] : Math.Min(sourceBars.OpenPrices[j], sourceBars.ClosePrices[j]);
                            AddDistinctChartLevel(candidates, obHigh, tolerance);
                            AddDistinctChartLevel(candidates, obLow, tolerance);
                            maxBlocks--;
                            break;
                        }
                    }
                }
            }
        }

        private void AddSessionLiquidityLevelCandidates(List<double> candidates, string sessionName, double tolerance)
        {
            if (Bars == null || Bars.Count < 10)
                return;

            var prevDate = GetReferenceNow().Date.AddDays(-1);
            DateTime startUtc;
            DateTime endUtc;
            if (!TryGetSessionUtcRange(sessionName, prevDate, out startUtc, out endUtc))
                return;

            double high;
            double low;
            DateTime highTime;
            DateTime lowTime;
            if (!TryGetRangeHighLow(Bars, startUtc, endUtc, out high, out low, out highTime, out lowTime))
                return;

            AddDistinctChartLevel(candidates, high, tolerance);
            AddDistinctChartLevel(candidates, low, tolerance);
        }

        private void AddPreviousPeriodLevelCandidates(List<double> candidates, string symbolName, TimeFrame timeFrame, double tolerance)
        {
            try
            {
                var sourceBars = MarketData.GetBars(timeFrame, symbolName);
                if (sourceBars == null || sourceBars.Count < 1)
                    return;

                int idx;
                if (!TryGetPreviousCompletedPeriodBarIndex(sourceBars, timeFrame, out idx))
                    return;

                AddDistinctChartLevel(candidates, sourceBars.HighPrices[idx], tolerance);
                AddDistinctChartLevel(candidates, sourceBars.LowPrices[idx], tolerance);
            }
            catch
            {
            }
        }

        private void AddEqualHighLowCandidates(List<double> candidates, Bars sourceBars, double tolerance)
        {
            var swings = CollectConfirmedSwings(sourceBars, 180);
            if (swings.Count < 2)
                return;

            for (var i = 0; i < swings.Count; i++)
            {
                for (var j = i + 1; j < swings.Count; j++)
                {
                    if (swings[i].IsHigh != swings[j].IsHigh)
                        continue;

                    if (Math.Abs(swings[i].Price - swings[j].Price) > tolerance * 3.0)
                        continue;

                    AddDistinctChartLevel(candidates, (swings[i].Price + swings[j].Price) * 0.5, tolerance);
                }
            }
        }

        private void AddClusteredSwingLiquidityCandidates(List<double> candidates, Bars sourceBars, double tolerance)
        {
            var swings = CollectConfirmedSwings(sourceBars, 180).TakeLast(20).ToList();
            if (swings.Count < 2)
                return;

            var highs = swings.Where(s => s.IsHigh).ToList();
            var lows = swings.Where(s => !s.IsHigh).ToList();

            foreach (var cluster in highs.GroupBy(s => Math.Round(s.Price / (tolerance * 2.0))))
            {
                var list = cluster.ToList();
                if (list.Count >= 2)
                    AddDistinctChartLevel(candidates, list.Average(x => x.Price), tolerance);
            }

            foreach (var cluster in lows.GroupBy(s => Math.Round(s.Price / (tolerance * 2.0))))
            {
                var list = cluster.ToList();
                if (list.Count >= 2)
                    AddDistinctChartLevel(candidates, list.Average(x => x.Price), tolerance);
            }
        }

        private void AddFvgEntryCandidates(List<ChartEntryCandidate> candidates, Bars sourceBars, double tolerance)
        {
            if (sourceBars == null || sourceBars.Count < 3)
                return;

            var maxZones = 8;
            var startIndex = Math.Max(2, sourceBars.Count - 80);
            for (var i = sourceBars.Count - 1; i >= startIndex && maxZones > 0; i--)
            {
                var leftHigh = sourceBars.HighPrices[i - 2];
                var leftLow = sourceBars.LowPrices[i - 2];
                var rightHigh = sourceBars.HighPrices[i];
                var rightLow = sourceBars.LowPrices[i];

                if (rightLow > leftHigh)
                {
                    if (IsZoneTouched(sourceBars, i + 1, leftHigh, rightLow))
                        continue;
                    var low = Math.Min(leftHigh, rightLow);
                    var high = Math.Max(leftHigh, rightLow);
                    candidates.Add(new ChartEntryCandidate
                    {
                        Label = "FVG",
                        Low = low,
                        High = high,
                        Entry = NormalizePriceToSymbol(Symbol, (low + high) * 0.5),
                        Time = sourceBars.OpenTimes[i - 2]
                    });
                    maxZones--;
                }
                else if (rightHigh < leftLow)
                {
                    if (IsZoneTouched(sourceBars, i + 1, rightHigh, leftLow))
                        continue;
                    var low = Math.Min(rightHigh, leftLow);
                    var high = Math.Max(rightHigh, leftLow);
                    candidates.Add(new ChartEntryCandidate
                    {
                        Label = "iFVG",
                        Low = low,
                        High = high,
                        Entry = NormalizePriceToSymbol(Symbol, (low + high) * 0.5),
                        Time = sourceBars.OpenTimes[i - 2]
                    });
                    maxZones--;
                }
            }
        }

        private void AddOrderBlockEntryCandidates(List<ChartEntryCandidate> candidates, Bars sourceBars, double tolerance)
        {
            if (sourceBars == null || sourceBars.Count < 4)
                return;

            var maxBlocks = 6;
            var startIndex = Math.Max(3, sourceBars.Count - 80);
            for (var i = sourceBars.Count - 1; i >= startIndex && maxBlocks > 0; i--)
            {
                var leftHigh = sourceBars.HighPrices[i - 2];
                var leftLow = sourceBars.LowPrices[i - 2];
                var rightHigh = sourceBars.HighPrices[i];
                var rightLow = sourceBars.LowPrices[i];

                if (rightLow > leftHigh)
                {
                    for (var j = i - 1; j >= Math.Max(1, i - 5); j--)
                    {
                        if (sourceBars.ClosePrices[j] < sourceBars.OpenPrices[j] && !IsOrderBlockTouched(sourceBars, j + 1, j))
                        {
                            var high = OrderBlockUseFullWick ? sourceBars.HighPrices[j] : Math.Max(sourceBars.OpenPrices[j], sourceBars.ClosePrices[j]);
                            var low = OrderBlockUseFullWick ? sourceBars.LowPrices[j] : Math.Min(sourceBars.OpenPrices[j], sourceBars.ClosePrices[j]);
                            candidates.Add(new ChartEntryCandidate
                            {
                                Label = "OB",
                                Low = low,
                                High = high,
                                Entry = NormalizePriceToSymbol(Symbol, (low + high) * 0.5),
                                Time = sourceBars.OpenTimes[j]
                            });
                            maxBlocks--;
                            break;
                        }
                    }
                }
                else if (rightHigh < leftLow)
                {
                    for (var j = i - 1; j >= Math.Max(1, i - 5); j--)
                    {
                        if (sourceBars.ClosePrices[j] > sourceBars.OpenPrices[j] && !IsOrderBlockTouched(sourceBars, j + 1, j))
                        {
                            var high = OrderBlockUseFullWick ? sourceBars.HighPrices[j] : Math.Max(sourceBars.OpenPrices[j], sourceBars.ClosePrices[j]);
                            var low = OrderBlockUseFullWick ? sourceBars.LowPrices[j] : Math.Min(sourceBars.OpenPrices[j], sourceBars.ClosePrices[j]);
                            candidates.Add(new ChartEntryCandidate
                            {
                                Label = "BB",
                                Low = low,
                                High = high,
                                Entry = NormalizePriceToSymbol(Symbol, (low + high) * 0.5),
                                Time = sourceBars.OpenTimes[j]
                            });
                            maxBlocks--;
                            break;
                        }
                    }
                }
            }
        }

        private List<double> CollectChartLiquidityLevels(Symbol symbol, string symbolName, string profileRaw)
        {
            if (symbol == null || string.IsNullOrWhiteSpace(symbolName) || IsChartAllSymbolsSelection(symbolName))
                return new List<double>();

            var cacheKey = string.Format(
                CultureInfo.InvariantCulture,
                "{0}|{1}|liq|{2}|{3}|{4}|{5}|{6}",
                symbolName.ToUpperInvariant(),
                GetChartTradeProfileRaw(profileRaw),
                MinStopPips,
                true,
                true,
                true,
                Chart != null ? Chart.TimeFrame.ToString() : "");
            return GetOrCreateTimedCacheValue(
                _chartLiquidityCache,
                cacheKey,
                ChartStructureCacheTtl,
                () => CollectChartLiquidityLevelsCore(symbol, symbolName, profileRaw));
        }

        private List<double> CollectChartLiquidityLevelsCore(Symbol symbol, string symbolName, string profileRaw)
        {
            var candidates = new List<double>();
            var started = Stopwatch.StartNew();

            var tolerance = Math.Max(symbol.PipSize * 2.0, 0.0000001);
            try
            {
                var sourceTimeFrame = GetChartTradeStructureTimeFrame(profileRaw);
                var sourceBars = MarketData.GetBars(sourceTimeFrame, symbolName);
                if (sourceBars == null || sourceBars.Count < 5)
                    return candidates;

                AddPreviousPeriodLevelCandidates(candidates, symbolName, sourceTimeFrame, tolerance);
                AddPreviousPeriodLevelCandidates(candidates, symbolName, TimeFrame.Hour4, tolerance);
                AddPreviousPeriodLevelCandidates(candidates, symbolName, TimeFrame.Daily, tolerance);
                try { AddPreviousPeriodLevelCandidates(candidates, symbolName, TimeFrame.Weekly, tolerance); } catch { }

                AddSessionLiquidityLevelCandidates(candidates, "London", tolerance);
                AddSessionLiquidityLevelCandidates(candidates, "NewYork", tolerance);
                AddSessionLiquidityLevelCandidates(candidates, "Asia", tolerance);

                foreach (var swing in CollectConfirmedSwings(sourceBars, 120).TakeLast(12))
                    AddDistinctChartLevel(candidates, swing.Price, tolerance);

                AddEqualHighLowCandidates(candidates, sourceBars, tolerance);
                AddClusteredSwingLiquidityCandidates(candidates, sourceBars, tolerance);
            }
            catch (Exception ex)
            {
                SafePrint("[ChartTrade] Liquidity levels failed for {0}: {1}", symbolName, ex.Message);
            }

            var result = candidates.OrderBy(v => v).ToList();
            LogSlowChartStep("CollectChartLiquidityLevels", started, string.Format(CultureInfo.InvariantCulture, "{0} {1} -> {2}", symbolName, GetChartTradeProfileRaw(profileRaw), result.Count));
            return result;
        }

        private List<double> CollectChartSwingStopLevels(Symbol symbol, string symbolName, string profileRaw, TradeType tradeType, double entryPrice)
        {
            if (symbol == null || string.IsNullOrWhiteSpace(symbolName) || IsChartAllSymbolsSelection(symbolName) || entryPrice <= 0)
                return new List<double>();

            var cacheKey = string.Format(
                CultureInfo.InvariantCulture,
                "{0}|{1}|swingstop|{2}|{3}",
                symbolName.ToUpperInvariant(),
                GetChartTradeProfileRaw(profileRaw),
                tradeType,
                Chart != null ? Chart.TimeFrame.ToString() : "");
            var allCandidates = GetOrCreateTimedCacheValue(
                _chartSwingStopCache,
                cacheKey,
                ChartStructureCacheTtl,
                () => CollectChartSwingStopLevelsCore(symbol, symbolName, profileRaw, tradeType));

            return tradeType == TradeType.Buy
                ? allCandidates.Where(v => v < entryPrice).OrderByDescending(v => v).ToList()
                : allCandidates.Where(v => v > entryPrice).OrderBy(v => v).ToList();
        }

        private List<double> CollectChartSwingStopLevelsCore(Symbol symbol, string symbolName, string profileRaw, TradeType tradeType)
        {
            var candidates = new List<double>();
            var started = Stopwatch.StartNew();

            var tolerance = Math.Max(symbol.PipSize * 2.0, 0.0000001);
            try
            {
                var sourceTimeFrame = Chart != null ? Chart.TimeFrame : GetChartTradeStructureTimeFrame(profileRaw);
                var sourceBars = MarketData.GetBars(sourceTimeFrame, symbolName);
                if (sourceBars == null || sourceBars.Count < 5)
                {
                    sourceTimeFrame = GetChartTradeStructureTimeFrame(profileRaw);
                    sourceBars = MarketData.GetBars(sourceTimeFrame, symbolName);
                    if (sourceBars == null || sourceBars.Count < 5)
                        return candidates;
                }

                foreach (var swing in CollectConfirmedSwings(sourceBars, 160).TakeLast(16))
                {
                    if (tradeType == TradeType.Buy)
                    {
                        if (!swing.IsHigh)
                            AddDistinctChartLevel(candidates, swing.Price, tolerance);
                    }
                    else
                    {
                        if (swing.IsHigh)
                            AddDistinctChartLevel(candidates, swing.Price, tolerance);
                    }
                }
            }
            catch (Exception ex)
            {
                SafePrint("[ChartTrade] Swing stops failed for {0}: {1}", symbolName, ex.Message);
            }

            var result = tradeType == TradeType.Buy
                ? candidates.OrderByDescending(v => v).ToList()
                : candidates.OrderBy(v => v).ToList();
            LogSlowChartStep("CollectChartSwingStopLevels", started, string.Format(CultureInfo.InvariantCulture, "{0} {1} {2} -> {3}", symbolName, GetChartTradeProfileRaw(profileRaw), tradeType, result.Count));
            return result;
        }

        private List<ChartEntryCandidate> CollectChartEntryCandidates(Symbol symbol, string symbolName, string profileRaw)
        {
            if (symbol == null || string.IsNullOrWhiteSpace(symbolName))
                return new List<ChartEntryCandidate>();

            var cacheKey = string.Format(
                CultureInfo.InvariantCulture,
                "{0}|{1}|entry|{2}",
                symbolName.ToUpperInvariant(),
                GetChartTradeProfileRaw(profileRaw),
                Chart != null ? Chart.TimeFrame.ToString() : "");
            return GetOrCreateTimedCacheValue(
                _chartEntryCandidatesCache,
                cacheKey,
                ChartStructureCacheTtl,
                () => CollectChartEntryCandidatesCore(symbol, symbolName, profileRaw));
        }

        private List<ChartEntryCandidate> CollectChartEntryCandidatesCore(Symbol symbol, string symbolName, string profileRaw)
        {
            var candidates = new List<ChartEntryCandidate>();
            var started = Stopwatch.StartNew();

            var tolerance = Math.Max(symbol.PipSize * 2.0, 0.0000001);
            try
            {
                var sourceTimeFrame = GetChartTradeStructureTimeFrame(profileRaw);
                var sourceBars = MarketData.GetBars(sourceTimeFrame, symbolName);
                if (sourceBars == null || sourceBars.Count < 5)
                    return candidates;

                AddFvgEntryCandidates(candidates, sourceBars, tolerance);
                AddOrderBlockEntryCandidates(candidates, sourceBars, tolerance);
            }
            catch (Exception ex)
            {
                SafePrint("[ChartTrade] Entry levels failed for {0}: {1}", symbolName, ex.Message);
            }

            var result = candidates
                .Where(c => c.Entry > 0 && c.High >= c.Low)
                .GroupBy(c => Math.Round(c.Entry / tolerance) * tolerance)
                .Select(g => g.OrderByDescending(x => x.Time).First())
                .OrderByDescending(c => c.Time)
                .ToList();
            LogSlowChartStep("CollectChartEntryCandidates", started, string.Format(CultureInfo.InvariantCulture, "{0} {1} -> {2}", symbolName, GetChartTradeProfileRaw(profileRaw), result.Count));
            return result;
        }

        private ChartTradePlan BuildChartLimitPlanV2(Symbol symbol, string symbolName, TradeType tradeType, string profileRaw)
        {
            var started = Stopwatch.StartNew();
            var plan = new ChartTradePlan { IsValid = false, StructureTfLabel = GetChartTradeStructureTfLabel(profileRaw) };
            if (symbol == null || string.IsNullOrWhiteSpace(symbolName))
                return plan;

            var currentPrice = tradeType == TradeType.Buy ? symbol.Bid : symbol.Ask;
            if (currentPrice <= 0)
                return plan;

            var entries = CollectChartEntryCandidates(symbol, symbolName, profileRaw);
            var liquidities = CollectChartLiquidityLevels(symbol, symbolName, profileRaw);
            if (entries.Count == 0 || liquidities.Count == 0)
                return plan;

            var lowerRange = liquidities.Where(v => v < currentPrice).DefaultIfEmpty(0).Max();
            var upperRange = liquidities.Where(v => v > currentPrice).DefaultIfEmpty(0).Min();
            var rrFloor = 1.5;
            var rrCap = MaxRewardRiskRatio > 0 ? MaxRewardRiskRatio : 20.0;
            var bestScore = double.MinValue;

            foreach (var candidate in entries)
            {
                var entry = NormalizePriceToSymbol(symbol, candidate.Entry);
                if (entry <= 0)
                    continue;

                if (tradeType == TradeType.Buy)
                {
                    if (entry >= currentPrice) continue;
                    if (lowerRange > 0 && entry < lowerRange) continue;
                    if (upperRange > 0 && entry > upperRange) continue;
                }
                else
                {
                    if (entry <= currentPrice) continue;
                    if (lowerRange > 0 && entry < lowerRange) continue;
                    if (upperRange > 0 && entry > upperRange) continue;
                }

                var swingStops = CollectChartSwingStopLevels(symbol, symbolName, profileRaw, tradeType, entry);
                var stop = tradeType == TradeType.Buy
                    ? swingStops.Where(v => v < entry).DefaultIfEmpty(0).FirstOrDefault()
                    : swingStops.Where(v => v > entry).DefaultIfEmpty(0).FirstOrDefault();
                var targetCandidates = tradeType == TradeType.Buy
                    ? liquidities.Where(v => v > entry).OrderBy(v => v).ToList()
                    : liquidities.Where(v => v < entry).OrderByDescending(v => v).ToList();

                if (stop <= 0 || targetCandidates.Count == 0)
                    continue;

                var stopBufferPips = Math.Max(GetChartProtectionBiasPips(), Math.Max(1.0, MinStopPips) * 0.5);
                var adjustedStop = tradeType == TradeType.Buy
                    ? NormalizePriceToSymbol(symbol, stop - (stopBufferPips * symbol.PipSize))
                    : NormalizePriceToSymbol(symbol, stop + (stopBufferPips * symbol.PipSize));
                if (!IsChartProtectionDistanceUsable(symbol, entry, adjustedStop))
                    continue;

                foreach (var rawTarget in targetCandidates)
                {
                    var adjustedTarget = tradeType == TradeType.Buy
                        ? NormalizePriceToSymbol(symbol, rawTarget - (GetChartProtectionBiasPips() * symbol.PipSize))
                        : NormalizePriceToSymbol(symbol, rawTarget + (GetChartProtectionBiasPips() * symbol.PipSize));
                    if (!IsChartProtectionDistanceUsable(symbol, entry, adjustedTarget))
                        continue;

                    var risk = Math.Abs(entry - adjustedStop);
                    var reward = Math.Abs(adjustedTarget - entry);
                    if (risk <= 0 || reward <= 0)
                        continue;

                    var rr = reward / risk;
                    if (rr < rrFloor || rr > rrCap)
                        continue;

                    string reason;
                    var action = tradeType == TradeType.Buy ? "BUY" : "SELL";
                    if (!TryValidateProtectionPrices(symbol, action, entry, adjustedStop, adjustedTarget, out reason))
                        continue;

                    var distanceScore = 1.0 / Math.Max(symbol.PipSize, Math.Abs(currentPrice - entry));
                    var score = (rr * 1000.0) + distanceScore;
                    if (score <= bestScore)
                        continue;

                    bestScore = score;
                    plan = new ChartTradePlan
                    {
                        IsValid = true,
                        EntryLabel = candidate.Label,
                        StructureTfLabel = GetChartTradeStructureTfLabel(profileRaw),
                        Entry = entry,
                        StopLoss = adjustedStop,
                        TakeProfit = adjustedTarget,
                        RewardRisk = rr
                    };
                }
            }

            LogSlowChartStep("BuildChartLimitPlanV2", started, string.Format(CultureInfo.InvariantCulture, "{0} {1} {2} valid={3} rr={4:F2}", symbolName, tradeType, GetChartTradeProfileRaw(profileRaw), plan.IsValid, plan.RewardRisk));
            return plan;
        }

        private ChartTradePlan BuildChartLimitPlanFromLegacy(Symbol symbol, string symbolName, TradeType tradeType, string profileRaw)
        {
            var plan = new ChartTradePlan
            {
                IsValid = false,
                EntryLabel = "legacy",
                StructureTfLabel = "Legacy"
            };
            if (symbol == null || string.IsNullOrWhiteSpace(symbolName))
                return plan;

            var currentPrice = tradeType == TradeType.Buy ? symbol.Bid : symbol.Ask;
            if (currentPrice <= 0)
                return plan;

            var entry = tradeType == TradeType.Buy
                ? FindClosestChartLevel(symbolName, true, currentPrice, profileRaw)
                : FindClosestChartLevel(symbolName, false, currentPrice, profileRaw);
            if (!entry.HasValue || entry.Value <= 0)
                entry = BuildFallbackChartEntryPrice(symbol, tradeType, false, currentPrice);
            if (!entry.HasValue || entry.Value <= 0)
                return plan;

            var normalizedEntry = NormalizePriceToSymbol(symbol, entry.Value);
            var protection = BuildSharedChartProtectionPrices(symbol, symbolName, tradeType, normalizedEntry, Math.Max(1.0, MinStopPips), profileRaw);
            if (protection == null)
                return plan;

            var sl = NormalizePriceToSymbol(symbol, protection.Item1);
            var tp = NormalizePriceToSymbol(symbol, protection.Item2);
            var risk = Math.Abs(normalizedEntry - sl);
            var reward = Math.Abs(tp - normalizedEntry);
            if (risk <= 0 || reward <= 0)
                return plan;

            string reason;
            var action = tradeType == TradeType.Buy ? "BUY" : "SELL";
            if (!TryValidateProtectionPrices(symbol, action, normalizedEntry, sl, tp, out reason))
                return plan;

            plan.IsValid = true;
            plan.Entry = normalizedEntry;
            plan.StopLoss = sl;
            plan.TakeProfit = tp;
            plan.RewardRisk = reward / risk;
            return plan;
        }

        private List<ChartLevelCandidate> CollectChartStructuralLevelCandidates(Symbol symbol, string symbolName, string profileRaw)
        {
            if (symbol == null || string.IsNullOrWhiteSpace(symbolName))
                return new List<ChartLevelCandidate>();

            var cacheKey = string.Format(
                CultureInfo.InvariantCulture,
                "{0}|{1}|struct|{2}|{3}",
                symbolName.ToUpperInvariant(),
                GetChartTradeProfileRaw(profileRaw),
                Chart != null ? Chart.TimeFrame.ToString() : "",
                MinStopPips);
            return GetOrCreateTimedCacheValue(
                _chartStructuralLevelsCache,
                cacheKey,
                ChartStructureCacheTtl,
                () => CollectChartStructuralLevelCandidatesCore(symbol, symbolName, profileRaw));
        }

        private List<ChartLevelCandidate> CollectChartStructuralLevelCandidatesCore(Symbol symbol, string symbolName, string profileRaw)
        {
            var candidates = new List<ChartLevelCandidate>();
            var started = Stopwatch.StartNew();

            var tolerance = Math.Max(symbol.PipSize * 2.0, 0.0000001);
            try
            {
                foreach (var sourceTimeFrame in GetChartTradeStructureTimeFrames(profileRaw))
                {
                    var sourceBars = MarketData.GetBars(sourceTimeFrame, symbolName);
                    if (sourceBars == null || sourceBars.Count < 5)
                        continue;

                    int previousIndex;
                    if (TryGetPreviousCompletedPeriodBarIndex(sourceBars, sourceTimeFrame, out previousIndex))
                    {
                        AddChartLevelCandidate(candidates, sourceBars.HighPrices[previousIndex], tolerance, 2);
                        AddChartLevelCandidate(candidates, sourceBars.LowPrices[previousIndex], tolerance, 2);
                    }

                    var start = Math.Max(2, sourceBars.Count - 60);
                    var resistance = double.MinValue;
                    var support = double.MaxValue;
                    for (var i = start; i < sourceBars.Count - 2; i++)
                    {
                        resistance = Math.Max(resistance, sourceBars.HighPrices[i]);
                        support = Math.Min(support, sourceBars.LowPrices[i]);
                    }
                    if (resistance > double.MinValue)
                        AddChartLevelCandidate(candidates, resistance, tolerance, 1);
                    if (support < double.MaxValue)
                        AddChartLevelCandidate(candidates, support, tolerance, 1);

                    foreach (var swing in CollectConfirmedSwings(sourceBars, 120).TakeLast(10))
                        AddChartLevelCandidate(candidates, swing.Price, tolerance, 2);

                    var fvgLevels = new List<double>();
                    AddFvgLevelCandidates(fvgLevels, sourceBars, tolerance);
                    AddChartLevelCandidatesFromRaw(candidates, fvgLevels, tolerance, 1);

                    var obLevels = new List<double>();
                    AddOrderBlockLevelCandidates(obLevels, sourceBars, tolerance);
                    AddChartLevelCandidatesFromRaw(candidates, obLevels, tolerance, 1);
                }
            }
            catch (Exception ex)
            {
                SafePrint("[ChartTrade] Structural levels failed for {0}: {1}", symbolName, ex.Message);
            }

            LogSlowChartStep("CollectChartStructuralLevelCandidates", started, string.Format(CultureInfo.InvariantCulture, "{0} {1} -> {2}", symbolName, GetChartTradeProfileRaw(profileRaw), candidates.Count));
            return candidates;
        }

        private List<double> CollectChartStructuralLevels(Symbol symbol, string symbolName, string profileRaw)
        {
            return CollectChartStructuralLevelCandidates(symbol, symbolName, profileRaw)
                .Select(x => x.Price)
                .Distinct()
                .ToList();
        }

        private List<ChartLevelCandidate> GetRankedChartStructuralLevels(Symbol symbol, string symbolName, bool wantBelowReference, double referencePrice, string profileRaw = null)
        {
            var chartProfile = string.IsNullOrWhiteSpace(profileRaw) ? GetChartTradeProfileRaw(ReadChartTradeTypeComboSelection()) : GetChartTradeProfileRaw(profileRaw);
            return CollectChartStructuralLevelCandidates(symbol, symbolName, chartProfile)
                .Where(x => x.Price > 0)
                .Where(x => wantBelowReference ? x.Price < referencePrice : x.Price > referencePrice)
                .OrderByDescending(x => x.Weight)
                .ThenBy(x => Math.Abs(x.Price - referencePrice))
                .ToList();
        }

        private double? FindClosestChartLevel(string symbolName, bool wantBelowReference, double referencePrice, string profileRaw = null)
        {
            if (referencePrice <= 0) return null;

            var symbol = ResolveLoadedSymbol(symbolName);
            var candidates = GetRankedChartStructuralLevels(symbol, symbolName, wantBelowReference, referencePrice, profileRaw);

            if (candidates.Count == 0) return null;
            return candidates.First().Price;
        }

        private double? BuildFallbackChartEntryPrice(Symbol symbol, TradeType tradeType, bool isStopOrder, double currentPrice)
        {
            if (symbol == null || currentPrice <= 0 || symbol.PipSize <= 0) return null;

            var distancePips = Math.Max(1.0, MinStopPips);
            var distance = distancePips * symbol.PipSize;
            double entryPrice;

            if (isStopOrder)
            {
                entryPrice = tradeType == TradeType.Buy
                    ? currentPrice + distance
                    : currentPrice - distance;
            }
            else
            {
                entryPrice = tradeType == TradeType.Buy
                    ? currentPrice - distance
                    : currentPrice + distance;
            }

            return NormalizePriceToSymbol(symbol, entryPrice);
        }

        private double? FindClosestUsableChartLevel(Symbol symbol, string symbolName, bool wantBelowReference, double referencePrice, string profileRaw = null)
        {
            if (symbol == null || string.IsNullOrWhiteSpace(symbolName) || referencePrice <= 0) return null;

            var filtered = GetRankedChartStructuralLevels(symbol, symbolName, wantBelowReference, referencePrice, profileRaw);

            foreach (var candidate in filtered)
            {
                if (IsChartProtectionDistanceUsable(symbol, referencePrice, candidate.Price))
                    return candidate.Price;
            }

            return null;
        }

        private Tuple<double, double> BuildFallbackChartProtectionPrices(Symbol symbol, TradeType tradeType, double executionPrice, double? overrideDistancePips = null)
        {
            if (symbol == null || executionPrice <= 0 || symbol.PipSize <= 0) return null;

            var distancePips = Math.Max(1.0, overrideDistancePips ?? MinStopPips);
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

        private bool IsChartProtectionDistanceUsable(Symbol symbol, double referencePrice, double levelPrice)
        {
            if (symbol == null || referencePrice <= 0 || levelPrice <= 0 || symbol.PipSize <= 0) return false;
            var distancePips = Math.Abs(referencePrice - levelPrice) / symbol.PipSize;
            if (double.IsNaN(distancePips) || double.IsInfinity(distancePips)) return false;
            if (distancePips < Math.Max(1.0, MinStopPips)) return false;
            return true;
        }

        private double GetEffectiveMaxProtectionPips(Symbol symbol, double referencePrice)
        {
            var configured = Math.Max(0.0, MaxProtectionPips);
            if (symbol == null || symbol.PipSize <= 0 || referencePrice <= 0)
                return configured;

            // FX-friendly configured pip caps are far too small for high-priced instruments like BTC.
            // Allow at least 0.5% of price expressed in pips so structural levels remain usable.
            var priceRelativeFloorPips = (referencePrice * 0.005) / symbol.PipSize;
            return Math.Max(configured, priceRelativeFloorPips);
        }

        private double GetChartProtectionBiasPips()
        {
            return Math.Max(1.0, Math.Min(10.0, Math.Max(1.0, MinStopPips) * 0.25));
        }

        private Tuple<double, double> ApplyChartProtectionBiasAndRisk(
            Symbol symbol,
            TradeType tradeType,
            double entryPrice,
            double slPrice,
            double tpPrice)
        {
            if (symbol == null || entryPrice <= 0 || slPrice <= 0 || tpPrice <= 0 || symbol.PipSize <= 0)
                return null;

            var biasDistance = GetChartProtectionBiasPips() * symbol.PipSize;
            if (tradeType == TradeType.Buy)
            {
                slPrice -= biasDistance;
                tpPrice -= biasDistance;
            }
            else
            {
                slPrice += biasDistance;
                tpPrice += biasDistance;
            }

            slPrice = NormalizePriceToSymbol(symbol, slPrice);
            tpPrice = NormalizePriceToSymbol(symbol, tpPrice);

            var slDistance = Math.Abs(entryPrice - slPrice);
            if (slDistance <= 0) return null;

            var minRewardRisk = Math.Max(1.5, 1.5);
            var minTpDistance = slDistance * minRewardRisk;
            var currentTpDistance = Math.Abs(tpPrice - entryPrice);
            if (currentTpDistance < minTpDistance)
            {
                tpPrice = tradeType == TradeType.Buy
                    ? entryPrice + minTpDistance
                    : entryPrice - minTpDistance;
                tpPrice = NormalizePriceToSymbol(symbol, tpPrice);
            }

            if (!IsChartProtectionDistanceUsable(symbol, entryPrice, slPrice)) return null;
            if (!IsChartProtectionDistanceUsable(symbol, entryPrice, tpPrice)) return null;

            string reason;
            var action = tradeType == TradeType.Buy ? "BUY" : "SELL";
            if (!TryValidateProtectionPrices(symbol, action, entryPrice, slPrice, tpPrice, out reason))
                return null;

            return Tuple.Create(
                NormalizePriceToSymbol(symbol, slPrice),
                NormalizePriceToSymbol(symbol, tpPrice));
        }

        private Tuple<double, double> BuildSharedChartProtectionPrices(Symbol symbol, string symbolName, TradeType tradeType, double entryPrice, double fallbackDistancePips, string profileRaw = null)
        {
            var started = Stopwatch.StartNew();
            if (symbol == null || string.IsNullOrWhiteSpace(symbolName) || entryPrice <= 0 || symbol.PipSize <= 0)
                return null;

            var chartProfile = string.IsNullOrWhiteSpace(profileRaw) ? GetChartTradeProfileRaw(ReadChartTradeTypeComboSelection()) : GetChartTradeProfileRaw(profileRaw);
            double? rawSl = tradeType == TradeType.Buy
                ? FindClosestUsableChartLevel(symbol, symbolName, true, entryPrice, chartProfile)
                : FindClosestUsableChartLevel(symbol, symbolName, false, entryPrice, chartProfile);
            double? rawTp = tradeType == TradeType.Buy
                ? FindClosestUsableChartLevel(symbol, symbolName, false, entryPrice, chartProfile)
                : FindClosestUsableChartLevel(symbol, symbolName, true, entryPrice, chartProfile);

            var fallback = BuildFallbackChartProtectionPrices(symbol, tradeType, entryPrice, fallbackDistancePips);
            if (fallback == null) return null;

            if (!rawSl.HasValue) rawSl = fallback.Item1;
            if (!rawTp.HasValue) rawTp = fallback.Item2;

            var adjusted = ApplyChartProtectionBiasAndRisk(symbol, tradeType, entryPrice, rawSl.Value, rawTp.Value);
            if (adjusted != null)
            {
                LogSlowChartStep("BuildSharedChartProtectionPrices", started, string.Format(CultureInfo.InvariantCulture, "{0} {1} {2} direct", symbolName, tradeType, chartProfile));
                return adjusted;
            }

            var fallbackAdjusted = ApplyChartProtectionBiasAndRisk(symbol, tradeType, entryPrice, fallback.Item1, fallback.Item2);
            LogSlowChartStep("BuildSharedChartProtectionPrices", started, string.Format(CultureInfo.InvariantCulture, "{0} {1} {2} fallback", symbolName, tradeType, chartProfile));
            return fallbackAdjusted;
        }

        private double ResolveChartFinalRiskMoney(string profileRaw = null)
        {
            var balance = Account != null ? Math.Max(0, Account.Balance) : 0;
            var effectiveMaxRiskPercent = GetEffectiveMaxRiskPercent();
            var multiplier = GetTradeProfileRiskMultiplier(
                string.IsNullOrWhiteSpace(profileRaw) ? GetChartTradeProfileRaw(ReadChartTradeTypeComboSelection()) : profileRaw,
                "");
            return effectiveMaxRiskPercent > 0
                ? Math.Max(0, balance * (effectiveMaxRiskPercent / 100.0) * Math.Max(0.0, multiplier))
                : 0;
        }

        private void ExecuteChartQuickMarketOrder(TradeType tradeType)
        {
            var started = Stopwatch.StartNew();
            try
            {
                var symbolName = ReadChartSymbolComboSelection();
                var selectedTradeProfile = GetChartTradeProfileRaw(ReadChartTradeTypeComboSelection());
                var structureTfLabel = GetChartTradeStructureTfLabel(selectedTradeProfile);
                if (string.IsNullOrWhiteSpace(symbolName))
                {
                    SafeLog("ERROR", "[ChartTrade] {0} MARKET rejected: no_symbol_selected", tradeType == TradeType.Buy ? "BUY" : "SELL");
                    RefreshDebugPanelLite();
                    return;
                }

                var symbol = ResolveLoadedSymbol(symbolName);
                if (symbol == null)
                {
                    SafeLog("ERROR", "[ChartTrade] {0} MARKET {1} rejected: symbol_not_loaded", tradeType == TradeType.Buy ? "BUY" : "SELL", symbolName);
                    RefreshDebugPanelLite();
                    return;
                }

                var action = tradeType == TradeType.Buy ? "BUY" : "SELL";
                var tradableRejectReason = DetectSymbolTradeAvailabilityReason(symbol);
                if (!string.IsNullOrWhiteSpace(tradableRejectReason))
                {
                    SafeLog("ERROR", "[ChartTrade] {0} MARKET {1} rejected: {2}", action, symbolName, DescribeTradeAvailabilityReason(tradableRejectReason, symbolName));
                    RefreshDebugPanelLite();
                    return;
                }
                var executionPrice = tradeType == TradeType.Buy ? symbol.Ask : symbol.Bid;
                double? sl = null;
                double? tp = null;

                if (executionPrice <= 0)
                {
                    SafeLog("ERROR", "[ChartTrade] {0} MARKET {1} rejected: invalid_execution_price", action, symbolName);
                    RefreshDebugPanelLite();
                    return;
                }

                var marketProtection = BuildSharedChartProtectionPrices(symbol, symbolName, tradeType, executionPrice, Math.Max(MinStopPips, 100.0), selectedTradeProfile);
                if (marketProtection != null)
                {
                    sl = marketProtection.Item1;
                    tp = marketProtection.Item2;
                }

                if (!sl.HasValue || !tp.HasValue)
                {
                    SafeLog("ERROR", "[ChartTrade] {0} MARKET {1} rejected: no_sl_tp_levels", action, symbolName);
                    RefreshDebugPanelLite();
                    return;
                }

                string protectionReason;
                if (!TryValidateProtectionPrices(symbol, action, executionPrice, sl.Value, tp.Value, out protectionReason))
                {
                    SafeLog("ERROR", "[ChartTrade] {0} MARKET {1} rejected: {2}", action, symbolName, protectionReason);
                    RefreshDebugPanelLite();
                    return;
                }

                var finalRiskMoney = ResolveChartFinalRiskMoney(selectedTradeProfile);
                var volumeUnits = ResolveChartTradeVolumeForRisk(symbol, tradeType, executionPrice, sl.Value, finalRiskMoney, symbolName);
                if (volumeUnits < symbol.VolumeInUnitsMin)
                {
                    var minRisk = EstimateRiskAmount(symbol, tradeType, executionPrice, sl.Value, symbol.VolumeInUnitsMin);
                    SafeLog("ERROR", "[ChartTrade] {0} MARKET {1} rejected: volume_too_small {2:F2}; min_vol={3:F2}; min_vol_risk={4:F2}; allowed={5:F2}", action, symbolName, volumeUnits, symbol.VolumeInUnitsMin, minRisk, finalRiskMoney);
                    RefreshDebugPanelLite();
                    return;
                }

                double approvedVolumeUnits;
                double approvedRiskMoney;
                double approvedMarginEstimate;
                double approvedMarginBudget;
                double approvedSl;
                double approvedTp;
                string gateRejectReason;
                if (!TryPassSharedCreationGate(
                    symbol,
                    action,
                    "market",
                    0,
                    executionPrice,
                    sl.Value,
                    tp.Value,
                    volumeUnits,
                    finalRiskMoney,
                    finalRiskMoney,
                    out approvedSl,
                    out approvedTp,
                    out approvedVolumeUnits,
                    out approvedRiskMoney,
                    out approvedMarginEstimate,
                    out approvedMarginBudget,
                    out gateRejectReason))
                {
                    SafeLog("ERROR", "[ChartTrade] {0} MARKET {1} rejected: {2}", action, symbolName, gateRejectReason);
                    RefreshDebugPanelLite();
                    return;
                }
                if (approvedVolumeUnits < volumeUnits)
                {
                    SafePrint(
                        "[ChartTrade] {0} {1} volume reduced by shared gate: {2:F2} -> {3:F2} units (risk {4:F2}/{5:F2})",
                        action,
                        symbolName,
                        volumeUnits,
                        approvedVolumeUnits,
                        approvedRiskMoney,
                        finalRiskMoney
                    );
                    volumeUnits = approvedVolumeUnits;
                }

                sl = approvedSl;
                tp = approvedTp;

                var slPips = Math.Round(Math.Abs(executionPrice - sl.Value) / symbol.PipSize, 2);
                var tpPips = Math.Round(Math.Abs(tp.Value - executionPrice) / symbol.PipSize, 2);
                var label = BuildChartTradeLabel(action, "Market", symbolName);
                var comment = label;
                var requestedLots = symbol.VolumeInUnitsToQuantity(volumeUnits);
                LogStructuredTradeEvent("chart", "SUBMIT", symbolName, action, "MARKET", requestedLots, executionPrice, sl.Value, tp.Value, "", structureTfLabel);
                var result = ExecuteMarketOrder(tradeType, symbol.Name, volumeUnits, label, slPips, tpPips, comment);

                if (!result.IsSuccessful)
                {
                    LogStructuredTradeEvent("chart", "FAILED", symbolName, action, "MARKET", requestedLots, executionPrice, sl.Value, tp.Value, "", Convert.ToString(result.Error, CultureInfo.InvariantCulture));
                    SafeLog("ERROR", "[ChartTrade] {0} MARKET {1} failed: {2}", action, symbolName, result.Error);
                    RefreshDebugPanelLite();
                    return;
                }

                if (result.Position != null)
                {
                    var normalizedSl = NormalizePriceToSymbol(symbol, sl.Value);
                    var normalizedTp = NormalizePriceToSymbol(symbol, tp.Value);
                    var modify = ModifyPositionCompat(result.Position, normalizedSl, normalizedTp);
                    if (!modify.IsSuccessful)
                        SafeLog("ERROR", "[ChartTrade] {0} MARKET {1} ({2}) filled but exact SL/TP refine failed: {3}", action, symbolName, structureTfLabel, modify.Error);
                }

                LogStructuredTradeEvent("chart", "SUCCEEDED", symbolName, action, "MARKET", requestedLots, result.Position != null ? result.Position.EntryPrice : executionPrice, sl.Value, tp.Value, result.Position != null ? result.Position.Id.ToString(CultureInfo.InvariantCulture) : "", structureTfLabel);
                SafeLog("INFO", "[ChartTrade] {0} MARKET {1} [{2}] sent with SL={3:F5} TP={4:F5}", action, symbolName, structureTfLabel, sl.Value, tp.Value);
                RebuildChartButtonPanel();
                RefreshDebugPanelLite();
            }
            catch (Exception ex)
            {
                SafeLog("ERROR", "[ChartTrade] MARKET failed: {0}", ex.Message);
                RefreshDebugPanelLite();
            }
            finally
            {
                LogSlowChartStep("ExecuteChartQuickMarketOrder", started, tradeType.ToString());
            }
        }

        private void ExecuteChartQuickPendingOrder(TradeType tradeType, bool isStopOrder)
        {
            if (!isStopOrder)
            {
                ExecuteChartQuickPendingOrderV2(tradeType);
                return;
            }

            var started = Stopwatch.StartNew();
            try
            {
                var symbolName = ReadChartSymbolComboSelection();
                var selectedTradeProfile = GetChartTradeProfileRaw(ReadChartTradeTypeComboSelection());
                var structureTfLabel = GetChartTradeStructureTfLabel(selectedTradeProfile);
                if (string.IsNullOrWhiteSpace(symbolName))
                {
                    SafeLog("ERROR", "[ChartTrade] {0} rejected: no_symbol_selected", tradeType == TradeType.Buy ? (isStopOrder ? "BUY STOP" : "BUY LIMIT") : (isStopOrder ? "SELL STOP" : "SELL LIMIT"));
                    RefreshDebugPanelLite();
                    return;
                }

                var symbol = ResolveLoadedSymbol(symbolName);
                if (symbol == null)
                {
                    SafeLog("ERROR", "[ChartTrade] {0} {1} rejected: symbol_not_loaded", tradeType == TradeType.Buy ? (isStopOrder ? "BUY STOP" : "BUY LIMIT") : (isStopOrder ? "SELL STOP" : "SELL LIMIT"), symbolName);
                    RefreshDebugPanelLite();
                    return;
                }

                var action = tradeType == TradeType.Buy ? "BUY" : "SELL";
                var orderTypeLabel = isStopOrder ? "STOP" : "LIMIT";
                var tradableRejectReason = DetectSymbolTradeAvailabilityReason(symbol);
                if (!string.IsNullOrWhiteSpace(tradableRejectReason))
                {
                    SafeLog("ERROR", "[ChartTrade] {0} {1} {2} rejected: {3}", action, orderTypeLabel, symbolName, DescribeTradeAvailabilityReason(tradableRejectReason, symbolName));
                    RefreshDebugPanelLite();
                    return;
                }
                var currentPrice = tradeType == TradeType.Buy ? symbol.Bid : symbol.Ask;
                if (currentPrice <= 0)
                {
                    SafeLog("ERROR", "[ChartTrade] {0} {1} {2} rejected: invalid_reference_price", action, orderTypeLabel, symbolName);
                    RefreshDebugPanelLite();
                    return;
                }

                var entry = isStopOrder
                    ? (tradeType == TradeType.Buy
                        ? FindClosestChartLevel(symbolName, false, currentPrice, selectedTradeProfile)
                        : FindClosestChartLevel(symbolName, true, currentPrice, selectedTradeProfile))
                    : (tradeType == TradeType.Buy
                        ? FindClosestChartLevel(symbolName, true, currentPrice, selectedTradeProfile)
                        : FindClosestChartLevel(symbolName, false, currentPrice, selectedTradeProfile));
                if (!entry.HasValue || entry.Value <= 0)
                {
                    entry = BuildFallbackChartEntryPrice(symbol, tradeType, isStopOrder, currentPrice);
                    if (!entry.HasValue || entry.Value <= 0)
                    {
                        var directionHint = isStopOrder
                            ? (tradeType == TradeType.Buy ? "above current price" : "below current price")
                            : (tradeType == TradeType.Buy ? "below current price" : "above current price");
                        SafeLog("ERROR", "[ChartTrade] {0} {1} {2} rejected: no structural entry level from {3} found {4}, and fallback entry from MinStopPips was unavailable", action, orderTypeLabel, symbolName, structureTfLabel, directionHint);
                        RefreshDebugPanelLite();
                        return;
                    }
                    SafeLog("INFO", "[ChartTrade] {0} {1} {2} using fallback entry: no structural {3} level found, entry={4:F5}", action, orderTypeLabel, symbolName, structureTfLabel, entry.Value);
                }

                var normalizedEntry = NormalizePriceToSymbol(symbol, entry.Value);
                double? sl = null;
                double? tp = null;
                var pendingProtection = BuildSharedChartProtectionPrices(symbol, symbolName, tradeType, normalizedEntry, Math.Max(1.0, MinStopPips), selectedTradeProfile);
                if (pendingProtection != null)
                {
                    sl = pendingProtection.Item1;
                    tp = pendingProtection.Item2;
                }

                if (!sl.HasValue || !tp.HasValue)
                {
                    SafeLog("ERROR", "[ChartTrade] {0} {1} {2} rejected: no_sl_tp_levels", action, orderTypeLabel, symbolName);
                    RefreshDebugPanelLite();
                    return;
                }

                var finalRiskMoney = ResolveChartFinalRiskMoney(selectedTradeProfile);
                var volumeUnits = ResolveChartTradeVolumeForRisk(symbol, tradeType, normalizedEntry, sl.Value, finalRiskMoney, symbolName);
                if (volumeUnits < symbol.VolumeInUnitsMin)
                {
                    SafeLog("ERROR", "[ChartTrade] {0} {1} {2} rejected: volume_too_small {3}", action, orderTypeLabel, symbolName, volumeUnits);
                    RefreshDebugPanelLite();
                    return;
                }

                double approvedVolumeUnits;
                double approvedRiskMoney;
                double approvedMarginEstimate;
                double approvedMarginBudget;
                double approvedSl;
                double approvedTp;
                string gateRejectReason;
                if (!TryPassSharedCreationGate(
                    symbol,
                    action,
                    isStopOrder ? "stop" : "limit",
                    normalizedEntry,
                    currentPrice,
                    sl.Value,
                    tp.Value,
                    volumeUnits,
                    finalRiskMoney,
                    finalRiskMoney,
                    out approvedSl,
                    out approvedTp,
                    out approvedVolumeUnits,
                    out approvedRiskMoney,
                    out approvedMarginEstimate,
                    out approvedMarginBudget,
                    out gateRejectReason))
                {
                    SafeLog("ERROR", "[ChartTrade] {0} {1} {2} rejected: {3}", action, orderTypeLabel, symbolName, gateRejectReason);
                    RefreshDebugPanelLite();
                    return;
                }
                if (approvedVolumeUnits < volumeUnits)
                {
                    SafeLog(
                        "INFO",
                        "[ChartTrade] {0} {1} {2} volume reduced by shared gate: {3:F2} -> {4:F2} units (risk {5:F2}/{6:F2})",
                        action,
                        orderTypeLabel,
                        symbolName,
                        volumeUnits,
                        approvedVolumeUnits,
                        approvedRiskMoney,
                        finalRiskMoney
                    );
                    volumeUnits = approvedVolumeUnits;
                }

                sl = approvedSl;
                tp = approvedTp;

                var slPips = Math.Round(Math.Abs(normalizedEntry - sl.Value) / symbol.PipSize, 2);
                var tpPips = Math.Round(Math.Abs(tp.Value - normalizedEntry) / symbol.PipSize, 2);
                var label = BuildChartTradeLabel(action, orderTypeLabel, symbolName);
                var comment = BuildChartPendingComment(tradeType, isStopOrder, symbolName);
                var requestedLots = symbol.VolumeInUnitsToQuantity(volumeUnits);
                LogStructuredTradeEvent("chart", "SUBMIT", symbolName, action, orderTypeLabel, requestedLots, normalizedEntry, sl.Value, tp.Value, "", structureTfLabel);
                TradeResult result;
                if (isStopOrder)
                {
                    result = PlaceStopOrder(
                        tradeType,
                        symbol.Name,
                        volumeUnits,
                        normalizedEntry,
                        label,
                        (double?)slPips,
                        (double?)tpPips,
                        (ProtectionType?)null,
                        null,
                        comment
                    );
                }
                else
                {
                    result = PlaceLimitOrder(
                        tradeType,
                        symbol.Name,
                        volumeUnits,
                        normalizedEntry,
                        label,
                        (double?)slPips,
                        (double?)tpPips,
                        (ProtectionType?)null,
                        null,
                        comment
                    );
                }

                if (result == null || !result.IsSuccessful)
                {
                    var errorText = result != null ? Convert.ToString(result.Error, CultureInfo.InvariantCulture) : "unknown_error";
                    LogStructuredTradeEvent("chart", "FAILED", symbolName, action, orderTypeLabel, requestedLots, normalizedEntry, sl.Value, tp.Value, "", errorText);
                    SafeLog("ERROR", "[ChartTrade] {0} {1} {2} failed: {3}", action, orderTypeLabel, symbolName, errorText);
                    RefreshDebugPanelLite();
                    return;
                }

                if (result.PendingOrder != null)
                {
                    string modifyError;
                    if (!TryApplyPendingOrderProtection(result.PendingOrder, symbol, action, sl.Value, tp.Value, out modifyError))
                    {
                        SafeLog("ERROR", "[ChartTrade] {0} {1} {2} placed but SL/TP apply failed: {3}", action, orderTypeLabel, symbolName, modifyError);
                        RefreshDebugPanelLite();
                        return;
                    }
                }

                LogStructuredTradeEvent("chart", "SUCCEEDED", symbolName, action, orderTypeLabel, requestedLots, normalizedEntry, sl.Value, tp.Value, result.PendingOrder != null ? result.PendingOrder.Id.ToString(CultureInfo.InvariantCulture) : "", structureTfLabel);
                SafeLog("INFO", "[ChartTrade] {0} {1} {2} [{3}] placed E={4:F5} SL={5:F5} TP={6:F5}", action, orderTypeLabel, symbolName, structureTfLabel, normalizedEntry, sl.Value, tp.Value);
                RebuildChartButtonPanel();
                RefreshDebugPanelLite();
            }
            catch (Exception ex)
            {
                SafeLog("ERROR", "[ChartTrade] Pending order failed: {0}", ex.Message);
                RefreshDebugPanelLite();
            }
            finally
            {
                LogSlowChartStep("ExecuteChartQuickPendingOrder", started, string.Format(CultureInfo.InvariantCulture, "{0} stop={1}", tradeType, isStopOrder));
            }
        }

        private void ExecuteChartQuickPendingOrderV2(TradeType tradeType)
        {
            var started = Stopwatch.StartNew();
            try
            {
                var symbolName = ReadChartSymbolComboSelection();
                var selectedTradeProfile = GetChartTradeProfileRaw(ReadChartTradeTypeComboSelection());
                if (string.IsNullOrWhiteSpace(symbolName))
                {
                    SafeLog("ERROR", "[ChartTrade] {0} LIMIT rejected: no_symbol_selected", tradeType == TradeType.Buy ? "BUY" : "SELL");
                    RefreshDebugPanelLite();
                    return;
                }

                var symbol = ResolveLoadedSymbol(symbolName);
                if (symbol == null)
                {
                    SafeLog("ERROR", "[ChartTrade] {0} LIMIT {1} rejected: symbol_not_loaded", tradeType == TradeType.Buy ? "BUY" : "SELL", symbolName);
                    RefreshDebugPanelLite();
                    return;
                }

                var action = tradeType == TradeType.Buy ? "BUY" : "SELL";
                var tradableRejectReason = DetectSymbolTradeAvailabilityReason(symbol);
                if (!string.IsNullOrWhiteSpace(tradableRejectReason))
                {
                    SafeLog("ERROR", "[ChartTrade] {0} LIMIT {1} rejected: {2}", action, symbolName, DescribeTradeAvailabilityReason(tradableRejectReason, symbolName));
                    RefreshDebugPanelLite();
                    return;
                }
                var plan = BuildChartLimitPlanV2(symbol, symbolName, tradeType, selectedTradeProfile);
                if (!plan.IsValid)
                {
                    plan = BuildChartLimitPlanFromLegacy(symbol, symbolName, tradeType, selectedTradeProfile);
                    if (!plan.IsValid)
                    {
                        SafeLog("ERROR", "[ChartTrade] {0} LIMIT {1} rejected: no_valid_entry_plan from {2}, and legacy fallback also failed", action, symbolName, GetChartTradeStructureTfLabel(selectedTradeProfile));
                        RefreshDebugPanelLite();
                        return;
                    }

                    SafeLog("INFO", "[ChartTrade] {0} LIMIT {1} fallback: new model had no valid plan, using legacy entry/protection", action, symbolName);
                }

                var entry = NormalizePriceToSymbol(symbol, plan.Entry);
                var sl = NormalizePriceToSymbol(symbol, plan.StopLoss);
                var tp = NormalizePriceToSymbol(symbol, plan.TakeProfit);
                var finalRiskMoney = ResolveChartFinalRiskMoney(selectedTradeProfile);
                var volumeUnits = ResolveChartTradeVolumeForRisk(symbol, tradeType, entry, sl, finalRiskMoney, symbolName);
                if (volumeUnits < symbol.VolumeInUnitsMin)
                {
                    SafeLog("ERROR", "[ChartTrade] {0} LIMIT {1} rejected: volume_too_small {2}", action, symbolName, volumeUnits);
                    RefreshDebugPanelLite();
                    return;
                }

                double approvedVolumeUnits;
                double approvedRiskMoney;
                double approvedMarginEstimate;
                double approvedMarginBudget;
                double approvedSl;
                double approvedTp;
                string gateRejectReason;
                if (!TryPassSharedCreationGate(
                    symbol,
                    action,
                    "limit",
                    entry,
                    entry,
                    sl,
                    tp,
                    volumeUnits,
                    finalRiskMoney,
                    finalRiskMoney,
                    out approvedSl,
                    out approvedTp,
                    out approvedVolumeUnits,
                    out approvedRiskMoney,
                    out approvedMarginEstimate,
                    out approvedMarginBudget,
                    out gateRejectReason))
                {
                    SafeLog("ERROR", "[ChartTrade] {0} LIMIT {1} rejected: {2}", action, symbolName, gateRejectReason);
                    RefreshDebugPanelLite();
                    return;
                }
                if (approvedVolumeUnits < volumeUnits)
                {
                    SafeLog(
                        "INFO",
                        "[ChartTrade] {0} LIMIT {1} volume reduced by shared gate: {2:F2} -> {3:F2} units (risk {4:F2}/{5:F2})",
                        action,
                        symbolName,
                        volumeUnits,
                        approvedVolumeUnits,
                        approvedRiskMoney,
                        finalRiskMoney
                    );
                    volumeUnits = approvedVolumeUnits;
                }

                sl = approvedSl;
                tp = approvedTp;

                var slPips = Math.Round(Math.Abs(entry - sl) / symbol.PipSize, 2);
                var tpPips = Math.Round(Math.Abs(tp - entry) / symbol.PipSize, 2);
                var label = BuildChartTradeLabel(action, "LIMIT", symbolName);
                var comment = BuildChartPendingComment(tradeType, false, symbolName);
                var requestedLots = symbol.VolumeInUnitsToQuantity(volumeUnits);
                LogStructuredTradeEvent("chart", "SUBMIT", symbolName, action, "LIMIT", requestedLots, entry, sl, tp, "", plan.StructureTfLabel + ":" + plan.EntryLabel);
                var result = PlaceLimitOrder(
                    tradeType,
                    symbol.Name,
                    volumeUnits,
                    entry,
                    label,
                    (double?)slPips,
                    (double?)tpPips,
                    (ProtectionType?)null,
                    null,
                    comment
                );

                if (result == null || !result.IsSuccessful)
                {
                    var errorText = result != null ? Convert.ToString(result.Error, CultureInfo.InvariantCulture) : "unknown_error";
                    LogStructuredTradeEvent("chart", "FAILED", symbolName, action, "LIMIT", requestedLots, entry, sl, tp, "", errorText);
                    SafeLog("ERROR", "[ChartTrade] {0} LIMIT {1} failed: {2}", action, symbolName, errorText);
                    RefreshDebugPanelLite();
                    return;
                }

                if (result.PendingOrder != null)
                {
                    string modifyError;
                    if (!TryApplyPendingOrderProtection(result.PendingOrder, symbol, action, sl, tp, out modifyError))
                    {
                        SafeLog("ERROR", "[ChartTrade] {0} LIMIT {1} placed but SL/TP apply failed: {2}", action, symbolName, modifyError);
                        RefreshDebugPanelLite();
                        return;
                    }
                }

                LogStructuredTradeEvent("chart", "SUCCEEDED", symbolName, action, "LIMIT", requestedLots, entry, sl, tp, result.PendingOrder != null ? result.PendingOrder.Id.ToString(CultureInfo.InvariantCulture) : "", plan.StructureTfLabel + ":" + plan.EntryLabel);
                SafeLog(
                    "INFO",
                    "[ChartTrade] {0} LIMIT {1} [{2}] {3} RR={4:F2} E={5:F5} SL={6:F5} TP={7:F5}",
                    action,
                    symbolName,
                    plan.StructureTfLabel,
                    plan.EntryLabel,
                    plan.RewardRisk,
                    entry,
                    sl,
                    tp
                );
                RebuildChartButtonPanel();
                RefreshDebugPanelLite();
            }
            catch (Exception ex)
            {
                SafeLog("ERROR", "[ChartTrade] LIMIT failed: {0}", ex.Message);
                RefreshDebugPanelLite();
            }
            finally
            {
                LogSlowChartStep("ExecuteChartQuickPendingOrderV2", started, tradeType.ToString());
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

        private bool TryApplyPendingOrderProtection(PendingOrder pendingOrder, Symbol symbol, string action, double slPrice, double tpPrice, out string errorText)
        {
            errorText = "";
            if (pendingOrder == null)
            {
                errorText = "pending_order_missing";
                return false;
            }
            if (symbol == null || symbol.PipSize <= 0)
            {
                errorText = "symbol_missing";
                return false;
            }

            double? slPips = null;
            double? tpPips = null;
            if (slPrice > 0)
                slPips = Math.Round((action == "BUY" ? (pendingOrder.TargetPrice - slPrice) : (slPrice - pendingOrder.TargetPrice)) / symbol.PipSize, 2);
            if (tpPrice > 0)
                tpPips = Math.Round((action == "BUY" ? (tpPrice - pendingOrder.TargetPrice) : (pendingOrder.TargetPrice - tpPrice)) / symbol.PipSize, 2);

            var modifyResult = ModifyPendingOrderCompat(pendingOrder, pendingOrder.TargetPrice, slPips, tpPips, pendingOrder.ExpirationTime);
            if (modifyResult != null && modifyResult.IsSuccessful)
                return true;

            errorText = modifyResult != null
                ? Convert.ToString(modifyResult.Error, CultureInfo.InvariantCulture)
                : "unknown_modify_error";
            return false;
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
                var result = ModifyPositionCompat(position, nextSl, nextTp);
                if (result.IsSuccessful) modifiedCount++;
                else SafePrint("[ChartTrade] Modify failed for {0} #{1}: {2}", symbolName, position.Id, result.Error);
            }

            return modifiedCount;
        }

        private void SyncChartSymbolProtection()
        {
            try
            {
                string symbolName;
                Symbol symbol;
                if (!TryGetChartSelectedSymbol(out symbolName, out symbol)) return;
                var selectedDirection = ReadChartDirectionComboSelection();

                var positions = GetChartSelectedPositions(symbolName, selectedDirection);
                if (positions.Count == 0)
                {
                    SafePrint("[ChartTrade] No open positions for {0} {1}", symbolName, selectedDirection);
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
                        var result = ModifyPositionCompat(pos, nextSl, nextTp);
                        if (result.IsSuccessful) modifiedCount++;
                        else SafePrint("[ChartTrade] Sync failed for {0} #{1}: {2}", symbolName, pos.Id, result.Error);
                    }
                }

                SafePrint("[ChartTrade] Sync updated {0} position(s) for {1} {2}", modifiedCount, symbolName, selectedDirection);
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
                var symbolName = ReadChartSymbolComboSelection();
                if (string.IsNullOrWhiteSpace(symbolName))
                {
                    SafePrint("[ChartTrade] No symbol selected.");
                    return;
                }

                var selectedDirection = ReadChartDirectionComboSelection();

                var positions = GetChartSelectedPositions(symbolName, selectedDirection);
                if (positions.Count == 0)
                {
                    SafePrint("[ChartTrade] No open positions for {0} {1}", symbolName, selectedDirection);
                    return;
                }

                var closedCount = 0;
                var skippedCount = 0;
                foreach (var pos in positions)
                {
                    var posSymbol = ResolveLoadedSymbol(pos.SymbolName);
                    var posSide = pos.TradeType == TradeType.Buy ? "Buy" : "Sell";
                    var posPnl = double.IsNaN(pos.NetProfit) ? 0 : pos.NetProfit;
                    if (posSymbol == null)
                    {
                        skippedCount++;
                        SafePrint("[ChartTrade] Close skipped for {0} {1} #{2}: symbol_not_loaded pnl={3:F2}", pos.SymbolName, posSide, pos.Id, posPnl);
                        continue;
                    }

                    TradeResult result;
                    double closeVolume = pos.VolumeInUnits;
                    if (percentToClose >= 100)
                    {
                        result = ClosePosition(pos);
                    }
                    else
                    {
                        var volumeToClose = pos.VolumeInUnits * (percentToClose / 100.0);
                        volumeToClose = posSymbol.NormalizeVolumeInUnits(volumeToClose, RoundingMode.Down);
                        if (volumeToClose < posSymbol.VolumeInUnitsMin)
                        {
                            skippedCount++;
                            SafePrint(
                                "[ChartTrade] Close skipped for {0} #{1}: partial_volume_below_min {2:F2}<{3:F2}",
                                pos.SymbolName,
                                pos.Id,
                                volumeToClose,
                                posSymbol.VolumeInUnitsMin
                            );
                            continue;
                        }
                        if (volumeToClose > pos.VolumeInUnits) volumeToClose = pos.VolumeInUnits;
                        closeVolume = volumeToClose;
                        result = ClosePosition(pos, volumeToClose);
                    }

                    if (result.IsSuccessful)
                    {
                        closedCount++;
                        SafePrint("[ChartTrade] Close OK {0} {1} #{2} volume={3:F2}/{4:F2} pnl={5:F2}", pos.SymbolName, posSide, pos.Id, closeVolume, pos.VolumeInUnits, posPnl);
                    }
                    else SafePrint("[ChartTrade] Close failed for {0} {1} #{2}: {3} pnl={4:F2}", pos.SymbolName, posSide, pos.Id, result.Error, posPnl);
                }

                SafePrint("[ChartTrade] Closed {0} position(s), skipped {1} for {2} {3}", closedCount, skippedCount, symbolName, selectedDirection);
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
                var symbolName = ReadChartSymbolComboSelection();
                if (string.IsNullOrWhiteSpace(symbolName))
                {
                    SafePrint("[ChartTrade] No symbol selected.");
                    return;
                }

                var selectedDirection = ReadChartDirectionComboSelection();

                var orders = GetChartSelectedPendingOrders(symbolName, selectedDirection);
                if (orders.Count == 0)
                {
                    SafePrint("[ChartTrade] No pending orders for {0} {1}", symbolName, selectedDirection);
                    return;
                }

                var canceledCount = 0;
                foreach (var order in orders)
                {
                    var result = CancelPendingOrder(order);
                    if (result.IsSuccessful) canceledCount++;
                    else SafePrint("[ChartTrade] Cancel failed for {0} #{1}: {2}", symbolName, order.Id, result.Error);
                }

                SafePrint("[ChartTrade] Canceled {0} pending order(s) for {1} {2}", canceledCount, symbolName, selectedDirection);
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
                var selectedDirection = ReadChartDirectionComboSelection();
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

                var positions = GetChartSelectedPositions(symbolName, selectedDirection);
                if (positions.Count == 0)
                {
                    SafePrint("[ChartTrade] No open positions for {0} {1}", symbolName, selectedDirection);
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
                    var oppositeLevels = sidePositions
                        .Select(p => isStopLoss ? p.TakeProfit : p.StopLoss)
                        .Where(v => v.HasValue && v.Value > 0)
                        .Select(v => v.Value)
                        .ToList();

                    var targetPrice = BuildSharedProtectionTarget(symbol, tradeType, isStopLoss, moveCloser, referencePrice, existingLevels);
                    string reason;
                    var action = tradeType == TradeType.Buy ? "BUY" : "SELL";
                    var validationReference = tradeType == TradeType.Buy ? symbol.Bid : symbol.Ask;
                    var existingSl = sidePositions.FirstOrDefault(p => p.StopLoss.HasValue && p.StopLoss.Value > 0)?.StopLoss ?? 0;
                    var existingTp = sidePositions.FirstOrDefault(p => p.TakeProfit.HasValue && p.TakeProfit.Value > 0)?.TakeProfit ?? 0;
                    if (isStopLoss && existingTp <= 0)
                        existingTp = BuildSharedProtectionTarget(symbol, tradeType, false, false, referencePrice, oppositeLevels);
                    if (!isStopLoss && existingSl <= 0)
                        existingSl = BuildSharedProtectionTarget(symbol, tradeType, true, false, referencePrice, oppositeLevels);
                    var checkSl = isStopLoss ? targetPrice : existingSl;
                    var checkTp = isStopLoss ? existingTp : targetPrice;

                    if (!TryValidateProtectionPrices(symbol, action, validationReference, checkSl, checkTp, out reason))
                    {
                        SafePrint("[ChartTrade] {0} {1} {2} rejected: {3}", symbolName, action, isStopLoss ? "SL" : "TP", reason);
                        continue;
                    }

                    totalModified += ApplySharedProtectionTarget(symbolName, tradeType, isStopLoss, targetPrice);
                }

                SafePrint("[ChartTrade] {0} {1} updated {2} position(s) for {3} {4}", isStopLoss ? "SL" : "TP", moveCloser ? "closer" : "farther", totalModified, symbolName, selectedDirection);
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
                            var modifyProfile = GetJsonValue(json, "profile");
                            var modifyTf = GetJsonValue(json, "trade_tf");
                            if (string.IsNullOrWhiteSpace(modifyTf)) modifyTf = GetJsonValue(json, "chart_tf");
                            if (string.IsNullOrWhiteSpace(modifyTf)) modifyTf = GetJsonValue(json, "tf");
                            var modifyRiskMultiplier = GetTradeProfileRiskMultiplier(modifyProfile, modifyTf);
                            var modifyEffectiveMaxRiskPercent = GetEffectiveMaxRiskPercent();
                            var modifyFinalRiskMoney = modifyEffectiveMaxRiskPercent > 0
                                ? Account.Balance * (modifyEffectiveMaxRiskPercent / 100.0) * Math.Max(0.0, modifyRiskMultiplier)
                                : 0;
                            var nextSl = sl > 0 ? sl : (pos.StopLoss.HasValue ? pos.StopLoss.Value : 0);
                            var nextTp = tp > 0 ? tp : (pos.TakeProfit.HasValue ? pos.TakeProfit.Value : 0);
                            if (nextSl <= 0)
                            {
                                var rejectMsg = "modify_missing_stop_loss";
                                RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATE_REJECTED", rejectMsg, "error");
                                SafeAck(id, leaseToken, "REJECTED", ticketStr, rejectMsg);
                                return;
                            }
                            string modifyProtectionReason;
                            if (!TryValidateProtectionPrices(symbol, action, pos.EntryPrice, nextSl, nextTp, out modifyProtectionReason))
                            {
                                var rejectMsg = "modify_protection_rejected: " + modifyProtectionReason;
                                RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATE_REJECTED", rejectMsg, "error");
                                SafeAck(id, leaseToken, "REJECTED", ticketStr, rejectMsg);
                                return;
                            }
                            string modifyRiskRejectReason;
                            if (!TryPassRiskFirewall(
                                symbol,
                                action,
                                "market",
                                pos.EntryPrice,
                                pos.EntryPrice,
                                nextSl,
                                nextTp,
                                pos.VolumeInUnits,
                                modifyFinalRiskMoney,
                                modifyFinalRiskMoney,
                                out modifyRiskRejectReason))
                            {
                                var rejectMsg = "modify_risk_gate_rejected: " + modifyRiskRejectReason;
                                RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATE_REJECTED", rejectMsg, "error");
                                SafeAck(id, leaseToken, "REJECTED", ticketStr, rejectMsg);
                                return;
                            }
                            var mRes = ModifyPositionCompat(pos, nextSl, nextTp > 0 ? (double?)nextTp : (double?)null);
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
                            double requestedModifyLots = ParseDouble(GetJsonValue(json, "lots"));
                            if (requestedModifyLots <= 0) requestedModifyLots = ParseDouble(GetJsonValue(json, "volume"));
                            double requestedTargetPrice = ParseDouble(GetJsonValue(json, "price"));
                            if (requestedTargetPrice <= 0) requestedTargetPrice = ParseDouble(GetJsonValue(json, "entry"));
                            double currentLots = symbol.VolumeInUnitsToQuantity(ord.VolumeInUnits);
                            bool wantsVolumeChange = requestedModifyLots > 0 && Math.Abs(requestedModifyLots - currentLots) > 0.0001;
                            double nextTargetPrice = requestedTargetPrice > 0 ? requestedTargetPrice : ord.TargetPrice;
                            var modifyProfile = GetJsonValue(json, "profile");
                            var modifyTf = GetJsonValue(json, "trade_tf");
                            if (string.IsNullOrWhiteSpace(modifyTf)) modifyTf = GetJsonValue(json, "chart_tf");
                            if (string.IsNullOrWhiteSpace(modifyTf)) modifyTf = GetJsonValue(json, "tf");
                            var modifyRiskMultiplier = GetTradeProfileRiskMultiplier(modifyProfile, modifyTf);
                            var modifyEffectiveMaxRiskPercent = GetEffectiveMaxRiskPercent();
                            var modifyFinalRiskMoney = modifyEffectiveMaxRiskPercent > 0
                                ? Account.Balance * (modifyEffectiveMaxRiskPercent / 100.0) * Math.Max(0.0, modifyRiskMultiplier)
                                : 0;
                            var nextSl = sl > 0 ? sl : (ord.StopLoss.HasValue ? ord.StopLoss.Value : 0);
                            var nextTp = tp > 0 ? tp : (ord.TakeProfit.HasValue ? ord.TakeProfit.Value : 0);
                            if (nextSl <= 0)
                            {
                                RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATE_REJECTED", "modify_missing_stop_loss", "error");
                                SafeAck(id, leaseToken, "REJECTED", ticketStr, "modify_missing_stop_loss");
                                return;
                            }

                            if (wantsVolumeChange)
                            {
                                double newVolumeUnits = symbol.QuantityToVolumeInUnits(requestedModifyLots);
                                newVolumeUnits = symbol.NormalizeVolumeInUnits(newVolumeUnits, RoundingMode.Down);
                                if (newVolumeUnits < symbol.VolumeInUnitsMin)
                                {
                                    RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATE_REJECTED", "modify_volume_too_small", "error");
                                    SafeAck(id, leaseToken, "ERROR", ticketStr, "modify_volume_too_small");
                                    return;
                                }

                                var modifyExecutionPrice = nextTargetPrice > 0 ? nextTargetPrice : ord.TargetPrice;

                                double modifyApprovedVolumeUnits;
                                double modifyApprovedRiskMoney;
                                double modifyApprovedMarginEstimate;
                                double modifyApprovedMarginBudget;
                                double modifyApprovedSl;
                                double modifyApprovedTp;
                                string modifyGateRejectReason;
                                if (!TryPassSharedCreationGate(
                                    symbol,
                                    action,
                                    ord.OrderType == PendingOrderType.Limit ? "limit" : "stop",
                                    modifyExecutionPrice,
                                    modifyExecutionPrice,
                                    nextSl,
                                    nextTp,
                                    newVolumeUnits,
                                    modifyFinalRiskMoney,
                                    modifyFinalRiskMoney,
                                    out modifyApprovedSl,
                                    out modifyApprovedTp,
                                    out modifyApprovedVolumeUnits,
                                    out modifyApprovedRiskMoney,
                                    out modifyApprovedMarginEstimate,
                                    out modifyApprovedMarginBudget,
                                    out modifyGateRejectReason))
                                {
                                    RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATE_REJECTED", "modify_gate_rejected: " + modifyGateRejectReason, "error");
                                    SafeAck(id, leaseToken, "REJECTED", ticketStr, "modify_gate_rejected: " + modifyGateRejectReason);
                                    return;
                                }
                                newVolumeUnits = modifyApprovedVolumeUnits;
                                nextSl = modifyApprovedSl;
                                nextTp = modifyApprovedTp;

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
                                        (double?)null,
                                        (double?)null,
                                        (ProtectionType?)null,
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
                                        (double?)null,
                                        (double?)null,
                                        (ProtectionType?)null,
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
                            else
                            {
                                double modifyApprovedVolumeUnits;
                                double modifyApprovedRiskMoney;
                                double modifyApprovedMarginEstimate;
                                double modifyApprovedMarginBudget;
                                double modifyApprovedSl;
                                double modifyApprovedTp;
                                string modifyGateRejectReason;
                                if (!TryPassSharedCreationGate(
                                    symbol,
                                    action,
                                    ord.OrderType == PendingOrderType.Limit ? "limit" : "stop",
                                    nextTargetPrice,
                                    nextTargetPrice,
                                    nextSl,
                                    nextTp,
                                    ord.VolumeInUnits,
                                    modifyFinalRiskMoney,
                                    modifyFinalRiskMoney,
                                    out modifyApprovedSl,
                                    out modifyApprovedTp,
                                    out modifyApprovedVolumeUnits,
                                    out modifyApprovedRiskMoney,
                                    out modifyApprovedMarginEstimate,
                                    out modifyApprovedMarginBudget,
                                    out modifyGateRejectReason))
                                {
                                    RecordPollEvent(ticketStr, id, symbolCode, action, "UPDATE_REJECTED", "modify_gate_rejected: " + modifyGateRejectReason, "error");
                                    SafeAck(id, leaseToken, "REJECTED", ticketStr, "modify_gate_rejected: " + modifyGateRejectReason);
                                    return;
                                }
                                nextSl = modifyApprovedSl;
                                nextTp = modifyApprovedTp;
                            }

                            double? slPips = null;
                            double? tpPips = null;
                            if (nextSl > 0) slPips = Math.Round((action == "BUY" ? (nextTargetPrice - nextSl) : (nextSl - nextTargetPrice)) / symbol.PipSize, 2);
                            if (nextTp > 0) tpPips = Math.Round((action == "BUY" ? (nextTp - nextTargetPrice) : (nextTargetPrice - nextTp)) / symbol.PipSize, 2);
                            var mRes = ModifyPendingOrderCompat(ord, nextTargetPrice, slPips, tpPips, ord.ExpirationTime);
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
                var tradeProfile = GetJsonValue(json, "profile");
                var tradeTf = GetJsonValue(json, "trade_tf");
                if (string.IsNullOrWhiteSpace(tradeTf)) tradeTf = GetJsonValue(json, "chart_tf");
                if (string.IsNullOrWhiteSpace(tradeTf)) tradeTf = GetJsonValue(json, "tf");
                var profileRiskMultiplier = GetTradeProfileRiskMultiplier(tradeProfile, tradeTf);

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

                var effectiveMaxRiskPercent = GetEffectiveMaxRiskPercent();
                double maxRiskFromPct = effectiveMaxRiskPercent > 0
                    ? Account.Balance * (effectiveMaxRiskPercent / 100.0) * Math.Max(0.0, profileRiskMultiplier)
                    : 0;
                double finalRiskMoney = maxRiskFromPct > 0 ? Math.Min(requestedRiskMoney, maxRiskFromPct) : requestedRiskMoney;
                var tradeType = (action == "BUY") ? TradeType.Buy : TradeType.Sell;

                double volumeUnits = symbol.VolumeInUnitsMin;

                if (sl > 0)
                {
                    volumeUnits = ResolveVolumeUnitsForRisk(symbol, tradeType, executionPrice, sl, finalRiskMoney);
                    if (volumeUnits <= 0)
                    {
                        var msg = string.Format(
                            CultureInfo.InvariantCulture,
                            "Unable to compute risk-sized volume for {0}: entry={1:F5} sl={2:F5} risk_budget={3:F2}",
                            symbolCode,
                            executionPrice,
                            sl,
                            finalRiskMoney
                        );
                        RecordPollEvent("", id, symbolCode, action, "REJECTED_RISK_MODEL", msg, "error");
                        SafeAck(id, leaseToken, "REJECTED", "", msg);
                        return;
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
                var label = BuildBrokerLabel(strategyLabel, entryModelLabel, tradeProfile, tradeTf);
                var brokerComment = BuildBrokerComment(id);
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
                                if (effectiveMaxRiskPercent > 0)
                                {
                                    var allowedRiskMoney = Account.Equity * effectiveMaxRiskPercent / 100;
                                    var riskAtCurrentVolume = EstimateRiskAmount(symbol, action == "BUY" ? TradeType.Buy : TradeType.Sell, executionPrice, reqSl, volumeUnits);
                                    if (riskAtCurrentVolume > allowedRiskMoney && riskAtCurrentVolume > 0)
                                    {
                                        var scaledVolume = volumeUnits * (allowedRiskMoney / riskAtCurrentVolume);
                                        if (scaledVolume < volumeUnits) newVolume = scaledVolume;
                                    }
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

                double approvedVolumeUnits;
                double approvedRiskMoney;
                double approvedSl;
                double approvedTp;
                string gateRejectReason;
                if (!TryPassSharedCreationGate(
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
                    out approvedSl,
                    out approvedTp,
                    out approvedVolumeUnits,
                    out approvedRiskMoney,
                    out fittedMarginEstimate,
                    out fittedMarginBudget,
                    out gateRejectReason
                ))
                {
                    var rejectMsg = string.Format(
                        CultureInfo.InvariantCulture,
                        "HARD_RISK_GATE_REJECTED:{0} | {1}",
                        gateRejectReason,
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
                if (approvedVolumeUnits < volumeUnits)
                {
                    SafePrint(
                        "[Adjust] Shared gate volume reduced from {0:F2} to {1:F2} units for {2} (risk={3:F2}, cap={4:F2})",
                        volumeUnits,
                        approvedVolumeUnits,
                        symbolCode,
                        approvedRiskMoney,
                        finalRiskMoney
                    );
                    volumeUnits = approvedVolumeUnits;
                }
                sl = approvedSl;
                tp = approvedTp;

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

                var requestedLots = symbol.VolumeInUnitsToQuantity(volumeUnits);
                LogStructuredTradeEvent(
                    "server",
                    "SUBMIT",
                    symbolCode,
                    action,
                    orderTypeStr.ToUpperInvariant(),
                    requestedLots,
                    submitReferencePrice,
                    sl,
                    tp,
                    "",
                    id);

                // Submit with protective SL/TP attached so the max-risk gate is enforced
                // at order creation time, then optionally refine to exact absolute prices after fill.
                if (orderTypeStr == "limit")
                {
                    res = PlaceLimitOrder(
                        tradeType,
                        symbol.Name,
                        volumeUnits,
                        entry,
                        label,
                        submitSlPips,
                        submitTpPips,
                        (ProtectionType?)null,
                        null,
                        brokerComment
                    );
                }
                else if (orderTypeStr == "stop")
                {
                    res = PlaceStopOrder(
                        tradeType,
                        symbol.Name,
                        volumeUnits,
                        entry,
                        label,
                        submitSlPips,
                        submitTpPips,
                        (ProtectionType?)null,
                        null,
                        brokerComment
                    );
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
                            res = PlaceLimitOrder(
                                tradeType,
                                symbol.Name,
                                volumeUnits,
                                entry,
                                label,
                                submitSlPips,
                                submitTpPips,
                                (ProtectionType?)null,
                                null,
                                brokerComment
                            );
                        }
                        else if (orderTypeStr == "stop")
                        {
                            res = PlaceStopOrder(
                                tradeType,
                                symbol.Name,
                                volumeUnits,
                                entry,
                                label,
                                submitSlPips,
                                submitTpPips,
                                (ProtectionType?)null,
                                null,
                                brokerComment
                            );
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
                                var mRes = ModifyPositionCompat(res.Position, (needsSl ? (double?)normalizedSl : (double?)null), (needsTp ? (double?)normalizedTp : (double?)null));
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
                            var mRes = ModifyPendingOrderCompat(res.PendingOrder, res.PendingOrder.TargetPrice, slPips, tpPips, res.PendingOrder.ExpirationTime);
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
                    LogStructuredTradeEvent(
                        "server",
                        "SUCCEEDED",
                        symbolCode,
                        action,
                        orderTypeStr.ToUpperInvariant(),
                        lots,
                        ackEntry,
                        sl,
                        tp,
                        ticket,
                        id);
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
                        LogStructuredTradeEvent(
                            "server",
                            "FAILED",
                            symbolCode,
                            action,
                            orderTypeStr.ToUpperInvariant(),
                            symbol.VolumeInUnitsToQuantity(volumeUnits),
                            submitReferencePrice,
                            sl,
                            tp,
                            "",
                            brokerError);
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
                var resolvedProviderCode = ResolveProviderCode(brokerName);

                var payload = "{\"source_id\":\"Ctrader\",\"account_id\":\"" + accId
                    + "\",\"balance\":" + bal.ToString("F2", CultureInfo.InvariantCulture)
                    + ",\"equity\":" + eq.ToString("F2", CultureInfo.InvariantCulture)
                    + ",\"margin\":" + marg.ToString("F2", CultureInfo.InvariantCulture)
                    + ",\"broker_name\":\"" + (brokerName ?? "").Replace("\"", "'") + "\""
                    + ",\"provider_code\":\"" + (resolvedProviderCode ?? "").Replace("\"", "'") + "\""
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
            try
            {
                // 1. Get coverage from webhook
                var covUrl = BuildServerApiUrl("broker/symbols") + "?symbols=" + string.Join(",", symbols);
                var covRequest = new HttpRequestMessage(System.Net.Http.HttpMethod.Get, covUrl);
                covRequest.Headers.Add("x-api-key", EaApiKey);
                var covResponse = await _httpClient.SendAsync(covRequest);
                if (!covResponse.IsSuccessStatusCode)
                {
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
                    _lastIncrementalErr = "None";
                    return;
                }

                // 3. POST to prices-sync
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
                    _lastIncrementalErr = "None";
                    SafePrint("[IncBars] sync={0} bars={1} ins={2} dup={3}", _incrementalSyncCount, totalBars, inserted, duplicated);
                }
                else
                {
                    _lastIncrementalErr = FormatServerErrorForPanel(await postResponse.Content.ReadAsStringAsync());
                    SafePrint("[IncBars] POST failed: {0}", _lastIncrementalErr);
                }
            }
            catch (Exception ex)
            {
                MarkApiOfflineCooldown();
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

        private void RefreshDebugPanelLite()
        {
            RunOnMainThread(() => RefreshDebugPanelNow(false));
        }

        private void RefreshDebugPanelNow()
        {
            RefreshDebugPanelNow(true);
        }

        private void RefreshDebugPanelNow(bool includeVisualOverlays)
        {
            try
            {
                var isBacktesting = IsBacktestingRuntime();
                if (includeVisualOverlays)
                    DrawChartVisualOverlays();
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
                Chart.RemoveObject("Panel_GATE_ROW1");
                Chart.RemoveObject("Panel_GATE_ROW2");
                Chart.RemoveObject("Panel_GATE_ROW3");
                Chart.RemoveObject("Panel_GATE_ROW4");
                Chart.RemoveObject("Panel_GATE_ROW5");
                Chart.RemoveObject("Panel_GATE_SUM_HDR");
                Chart.RemoveObject("Panel_GATE_SUM_BODY");
                Chart.RemoveObject("Panel_GATE_SUM_SYM");
                Chart.RemoveObject("Panel_GATE_SUM_WIN");
                Chart.RemoveObject("Panel_GATE_SUM_LOSE");
                Chart.RemoveObject("Panel_TL");
                Chart.RemoveObject("Panel_BL");
                Chart.RemoveObject("Panel_BR");
                if (includeVisualOverlays)
                {
                    try { if (_chartSummaryPanel != null) Chart.RemoveControl(_chartSummaryPanel); } catch { }
                    _chartSummaryPanel = null;
                }

                var riskState = BuildRiskGateState(0);
                if (isBacktesting)
                {
                    if (!string.IsNullOrWhiteSpace(_lastPanelMessage) && !string.Equals(_lastPanelMessage, "Ready", StringComparison.OrdinalIgnoreCase))
                    {
                        var backtestMessagePanel = Chart.DrawStaticText("Panel_DBG", _lastPanelMessage, VerticalAlignment.Top, HorizontalAlignment.Left, _lastPanelMessageColor);
                        TryStyleChartText(backtestMessagePanel, 10, "Courier New", false);
                    }

                    var backtestGateLines = BuildRiskDashboardLines(riskState);
                    var backtestMetricText = string.Join(Environment.NewLine, backtestGateLines);
                    var backtestMetricHeader = GetFirstLine(backtestMetricText);
                    var backtestMetricBody = GetRemainingLines(backtestMetricText);
                    if (!string.IsNullOrWhiteSpace(backtestMetricHeader))
                    {
                        var backtestMetricHeaderPanel = Chart.DrawStaticText("Panel_GATE_HDR", backtestMetricHeader, VerticalAlignment.Top, HorizontalAlignment.Right, Color.Cyan);
                        TryStyleChartText(backtestMetricHeaderPanel, 9, "Courier New", true);
                    }
                    if (!string.IsNullOrWhiteSpace(backtestMetricBody))
                    {
                        var backtestMetricBodyPanel = Chart.DrawStaticText("Panel_GATE_BODY", Environment.NewLine + backtestMetricBody, VerticalAlignment.Top, HorizontalAlignment.Right, Color.White);
                        TryStyleChartText(backtestMetricBodyPanel, 9, "Courier New", false);
                    }
                    if (includeVisualOverlays)
                        RefreshChartSummaryPanel(riskState);
                    return;
                }

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

                var panelHeader = string.Format(
                    CultureInfo.InvariantCulture,
                    "v{0} {1}",
                    BuildVersion,
                    DateTime.Now.ToString("HH:mm:ss"));
                var panelBody = new StringBuilder();
                var serverLine = "";
                if (_showProcessDebugPanel)
                {
                    serverLine = string.Format(
                        CultureInfo.InvariantCulture,
                        "Server:{0} API:{1} PULL:{2} SYNC:{3}",
                        compactStatus(_serverStatus),
                        compactStatus(_apiStatus),
                        compactStatus(_pollStatus),
                        compactStatus(_syncStatus));
                }

                if (_consecutiveErrors > 0 || _lastPollErr != "None" || _lastSyncErr != "None")
                {
                    var err = _lastSyncErr != "None" ? _lastSyncErr : _lastPollErr;
                    if (string.IsNullOrWhiteSpace(err) || err == "None")
                        panelBody.AppendLine(string.Format("E {0}", _consecutiveErrors));
                    else
                        AppendWrappedPanelLine(panelBody, "E ", err, 72, 1);
                }

                if (!string.IsNullOrWhiteSpace(_lastPanelMessage) && !string.Equals(_lastPanelMessage, "Ready", StringComparison.OrdinalIgnoreCase))
                    AppendWrappedPanelLine(panelBody, _lastPanelMessageIsError ? "! " : "M ", _lastPanelMessage, 72, 1);

                var procBodyText = panelBody.ToString().TrimEnd('\r', '\n');
                var leftPanel = new StringBuilder();
                leftPanel.AppendLine(panelHeader);
                if (!string.IsNullOrWhiteSpace(serverLine))
                    leftPanel.AppendLine(serverLine);
                var strategyRuntime = GetConfiguredStrategyRuntimeList();
                if (!string.IsNullOrWhiteSpace(strategyRuntime))
                    leftPanel.AppendLine("Strategies: " + strategyRuntime);
                if (!string.IsNullOrWhiteSpace(procBodyText))
                    leftPanel.AppendLine(procBodyText);
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
                        : _lastPanelMessageColor;
                var debugPanel = Chart.DrawStaticText("Panel_DBG", leftPanel.ToString(), VerticalAlignment.Top, HorizontalAlignment.Left, debugPanelColor);
                TryStyleChartText(debugPanel, 10, "Courier New", false);
                TrySetPropertyValue(debugPanel, "Margin", "6 30 0 0");

                var metricText = string.Join(Environment.NewLine, BuildRiskDashboardLines(riskState));
                var metricHeader = GetFirstLine(metricText);
                var metricBody = GetRemainingLines(metricText);
                if (!string.IsNullOrWhiteSpace(metricHeader))
                {
                    var metricHeaderPanel = Chart.DrawStaticText("Panel_GATE_HDR", metricHeader, VerticalAlignment.Top, HorizontalAlignment.Right, Color.Cyan);
                    TryStyleChartText(metricHeaderPanel, 9, "Courier New", true);
                }
                if (!string.IsNullOrWhiteSpace(metricBody))
                {
                    var metricBodyPanel = Chart.DrawStaticText("Panel_GATE_BODY", Environment.NewLine + metricBody, VerticalAlignment.Top, HorizontalAlignment.Right, Color.White);
                    TryStyleChartText(metricBodyPanel, 9, "Courier New", false);
                }

                var bottomRightLines = new List<string>();
                if (ShouldShowLowerTimeframeSessionContext())
                    bottomRightLines.Add(GetBottomRightSessionContextText());
                bottomRightLines.Add(GetBottomRightNewsContextText(DateTime.Now));
                var bottomRightPanel = string.Join(Environment.NewLine, bottomRightLines.Where(line => !string.IsNullOrWhiteSpace(line)).ToArray());
                var bottomRight = Chart.DrawStaticText("Panel_BR", bottomRightPanel, VerticalAlignment.Bottom, HorizontalAlignment.Right, Color.LightGray);
                TryStyleChartText(bottomRight, 9, "Courier New", false);

                if (includeVisualOverlays)
                    RefreshChartSummaryPanel(riskState);
            }
            catch (Exception ex)
            {
                SafePrint("[Panel] Draw failed: {0}", ex.Message);
            }
        }

        private static string BuildChartCacheKey(params object[] parts)
        {
            return string.Join("|", parts.Select(p => p == null ? "" : Convert.ToString(p, CultureInfo.InvariantCulture) ?? ""));
        }

        private List<T> GetOrCreateTimedCacheValue<T>(
            Dictionary<string, TimedCacheEntry<List<T>>> cache,
            string key,
            TimeSpan ttl,
            Func<List<T>> factory)
        {
            TimedCacheEntry<List<T>> cached;
            if (cache != null && cache.TryGetValue(key, out cached))
            {
                if ((DateTime.UtcNow - cached.CreatedAtUtc) <= ttl && cached.Value != null)
                    return cached.Value;
            }

            var created = factory != null ? factory() : new List<T>();
            if (created == null)
                created = new List<T>();

            if (cache != null)
            {
                cache[key] = new TimedCacheEntry<List<T>>
                {
                    CreatedAtUtc = DateTime.UtcNow,
                    Value = created
                };
            }

            return created;
        }

        private void LogSlowChartStep(string stepName, Stopwatch stopwatch, string detail = null)
        {
            if (stopwatch == null)
                return;

            stopwatch.Stop();
            if (stopwatch.ElapsedMilliseconds < 120)
                return;

            if (string.IsNullOrWhiteSpace(detail))
                SafePrint("[Perf] {0}: {1}ms", stepName, stopwatch.ElapsedMilliseconds);
            else
                SafePrint("[Perf] {0}: {1}ms ({2})", stepName, stopwatch.ElapsedMilliseconds, detail);
        }

        private string GetJsonValue(string json, string key)
        {
            var m = Regex.Match(json, string.Format("\"{0}\"\\s*:\\s*\"?([^,\"]*)\"?", key));
            return m.Success ? m.Groups[1].Value.Trim() : "";
        }

        private sealed class SharedRuleArtifactMatch
        {
            public string Type;
            public string Direction;
            public string Bias;
            public string Label;
            public double? Price;
            public double? PriceLow;
            public double? PriceHigh;
            public long AnchorTime;
            public Dictionary<string, object> Payload = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        }

        private sealed class SharedRuleArtifactResult
        {
            public string FunctionName;
            public List<SharedRuleArtifactMatch> Matches = new List<SharedRuleArtifactMatch>();
            public Dictionary<string, object> Meta = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

            public SharedRuleArtifactMatch Latest
            {
                get
                {
                    return Matches.Count > 0 ? Matches[Matches.Count - 1] : null;
                }
            }
        }

        private sealed class SharedRuleResult
        {
            public bool Matched;
            public string EventType = "na";
            public string Direction = "na";
            public object RawValue;
            public SharedRuleArtifactResult Artifact;
            public string RuleId = "";
            public string RuleName = "";
        }

        private sealed class SharedRuleJsonParser
        {
            private readonly string _text;
            private int _index;

            private SharedRuleJsonParser(string text)
            {
                _text = text ?? "";
                _index = 0;
            }

            public static object Parse(string text)
            {
                var parser = new SharedRuleJsonParser(text);
                var value = parser.ParseValue();
                parser.SkipWhitespace();
                if (!parser.IsEnd())
                    throw new FormatException("Unexpected trailing characters in shared rule JSON.");
                return value;
            }

            private object ParseValue()
            {
                SkipWhitespace();
                if (IsEnd())
                    return null;

                var ch = _text[_index];
                if (ch == '{') return ParseObject();
                if (ch == '[') return ParseArray();
                if (ch == '"') return ParseString();
                if (ch == '-' || char.IsDigit(ch)) return ParseNumber();
                if (MatchLiteral("true")) return true;
                if (MatchLiteral("false")) return false;
                if (MatchLiteral("null")) return null;
                throw new FormatException("Invalid shared rule JSON value at index " + _index.ToString(CultureInfo.InvariantCulture) + ".");
            }

            private Dictionary<string, object> ParseObject()
            {
                var result = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                Expect('{');
                SkipWhitespace();
                if (TryConsume('}'))
                    return result;

                while (!IsEnd())
                {
                    SkipWhitespace();
                    var key = ParseString();
                    SkipWhitespace();
                    Expect(':');
                    var value = ParseValue();
                    result[key] = value;
                    SkipWhitespace();
                    if (TryConsume('}'))
                        break;
                    Expect(',');
                }

                return result;
            }

            private List<object> ParseArray()
            {
                var result = new List<object>();
                Expect('[');
                SkipWhitespace();
                if (TryConsume(']'))
                    return result;

                while (!IsEnd())
                {
                    result.Add(ParseValue());
                    SkipWhitespace();
                    if (TryConsume(']'))
                        break;
                    Expect(',');
                }

                return result;
            }

            private string ParseString()
            {
                Expect('"');
                var sb = new StringBuilder();
                while (!IsEnd())
                {
                    var ch = _text[_index++];
                    if (ch == '"')
                        break;

                    if (ch == '\\')
                    {
                        if (IsEnd())
                            break;

                        var esc = _text[_index++];
                        switch (esc)
                        {
                            case '"': sb.Append('"'); break;
                            case '\\': sb.Append('\\'); break;
                            case '/': sb.Append('/'); break;
                            case 'b': sb.Append('\b'); break;
                            case 'f': sb.Append('\f'); break;
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            case 'u':
                                if (_index + 4 <= _text.Length)
                                {
                                    var hex = _text.Substring(_index, 4);
                                    int code;
                                    if (int.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out code))
                                        sb.Append((char)code);
                                    _index += 4;
                                }
                                break;
                            default:
                                sb.Append(esc);
                                break;
                        }
                    }
                    else
                    {
                        sb.Append(ch);
                    }
                }

                return sb.ToString();
            }

            private double ParseNumber()
            {
                var start = _index;
                if (_text[_index] == '-')
                    _index++;

                while (!IsEnd() && char.IsDigit(_text[_index]))
                    _index++;

                if (!IsEnd() && _text[_index] == '.')
                {
                    _index++;
                    while (!IsEnd() && char.IsDigit(_text[_index]))
                        _index++;
                }

                if (!IsEnd() && (_text[_index] == 'e' || _text[_index] == 'E'))
                {
                    _index++;
                    if (!IsEnd() && (_text[_index] == '+' || _text[_index] == '-'))
                        _index++;
                    while (!IsEnd() && char.IsDigit(_text[_index]))
                        _index++;
                }

                var raw = _text.Substring(start, _index - start);
                double value;
                if (!double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out value))
                    throw new FormatException("Invalid shared rule JSON number: " + raw);
                return value;
            }

            private bool MatchLiteral(string literal)
            {
                if (string.IsNullOrEmpty(literal) || _index + literal.Length > _text.Length)
                    return false;
                if (!string.Equals(_text.Substring(_index, literal.Length), literal, StringComparison.Ordinal))
                    return false;
                _index += literal.Length;
                return true;
            }

            private void Expect(char expected)
            {
                SkipWhitespace();
                if (IsEnd() || _text[_index] != expected)
                    throw new FormatException("Expected '" + expected + "' in shared rule JSON.");
                _index++;
            }

            private bool TryConsume(char expected)
            {
                SkipWhitespace();
                if (IsEnd() || _text[_index] != expected)
                    return false;
                _index++;
                return true;
            }

            private void SkipWhitespace()
            {
                while (!IsEnd() && char.IsWhiteSpace(_text[_index]))
                    _index++;
            }

            private bool IsEnd()
            {
                return _index >= _text.Length;
            }
        }

        private SharedRuleResult EvaluateSharedRuleInput(string ruleInput, Bars sourceBars, int barIndex, Dictionary<string, object> extraContext = null)
        {
            var context = BuildSharedRuleContext(sourceBars, barIndex, Symbol, Chart != null ? Chart.TimeFrame : TimeFrame.Minute, extraContext);
            return EvaluateSharedRuleInput(ruleInput, context);
        }

        private SharedRuleResult EvaluateSharedRuleInput(string ruleInput, Dictionary<string, object> context)
        {
            var parsed = ParseSharedRuleInput(ruleInput);
            return EvaluateSharedRuleObject(parsed, context);
        }

        private SharedRuleResult EvaluateSharedRuleObject(object parsedRule, Dictionary<string, object> context)
        {
            var result = new SharedRuleResult();
            if (context == null)
                context = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

            var ruleNode = parsedRule;
            Dictionary<string, object> ruleObject;
            if (TryGetRuleObject(parsedRule, out ruleObject))
            {
                object conditionNode;
                if (TryGetValueIgnoreCase(ruleObject, "condition", out conditionNode))
                    ruleNode = conditionNode;
                else if (TryGetValueIgnoreCase(ruleObject, "when", out conditionNode))
                    ruleNode = conditionNode;

                result.RuleId = ConvertToInvariantString(GetDictionaryValue(ruleObject, "id"));
                result.RuleName = ConvertToInvariantString(GetDictionaryValue(ruleObject, "name"));
            }

            var rawValue = EvaluateSharedRuleExpression(ruleNode, context);
            var artifact = rawValue as SharedRuleArtifactResult;
            result.RawValue = rawValue;
            result.Artifact = artifact;
            result.Matched = SharedRuleTruthy(rawValue);

            if (artifact != null && artifact.Latest != null)
            {
                result.EventType = NormalizeSharedRuleEventType(string.IsNullOrWhiteSpace(artifact.Latest.Type) ? artifact.FunctionName : artifact.Latest.Type);
                result.Direction = NormalizeSharedRuleDirection(!string.IsNullOrWhiteSpace(artifact.Latest.Bias) ? artifact.Latest.Bias : artifact.Latest.Direction);
            }
            else
            {
                result.EventType = "na";
                result.Direction = "na";
                if (ruleObject != null)
                {
                    Dictionary<string, object> outputs;
                    if (TryGetNestedDictionary(ruleObject, "outputs", out outputs))
                    {
                        var outputsBias = ConvertToInvariantString(GetDictionaryValue(outputs, "bias"));
                        if (!string.IsNullOrWhiteSpace(outputsBias))
                            result.Direction = NormalizeSharedRuleDirection(outputsBias);
                    }
                }
            }

            return result;
        }

        private object ParseSharedRuleInput(string rawInput)
        {
            var text = (rawInput ?? "").Trim();
            if (string.IsNullOrWhiteSpace(text))
                return null;

            if (text.StartsWith("{", StringComparison.Ordinal) || text.StartsWith("[", StringComparison.Ordinal))
                return SharedRuleJsonParser.Parse(text);

            var functionMatch = Regex.Match(text, "^([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\((.*)\\)$");
            if (functionMatch.Success)
            {
                var functionName = functionMatch.Groups[1].Value.Trim();
                var rawArgs = SplitSharedRuleArgs(functionMatch.Groups[2].Value);
                return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
                {
                    { "fn", functionName },
                    { "args", rawArgs.Select(ParseSharedRuleToken).ToList<object>() },
                };
            }

            foreach (var op in new[] { ">=", "<=", "==", "!=", ">", "<" })
            {
                var opIndex = text.IndexOf(op, StringComparison.Ordinal);
                if (opIndex > 0)
                {
                    var left = text.Substring(0, opIndex).Trim();
                    var right = text.Substring(opIndex + op.Length).Trim();
                    return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
                    {
                        { op, new List<object> { ParseSharedRuleToken(left), ParseSharedRuleToken(right) } },
                    };
                }
            }

            if (Regex.IsMatch(text, "^[a-zA-Z_][a-zA-Z0-9_.]*$"))
            {
                if (text.Contains("."))
                    return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase) { { "var", text } };
                return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase) { { "fn", text }, { "args", new List<object>() } };
            }

            return ParseSharedRuleToken(text);
        }

        private List<string> SplitSharedRuleArgs(string rawArgs)
        {
            var result = new List<string>();
            var current = new StringBuilder();
            var depth = 0;
            var inString = false;
            var escaped = false;

            foreach (var ch in rawArgs ?? "")
            {
                if (inString)
                {
                    current.Append(ch);
                    if (escaped)
                    {
                        escaped = false;
                    }
                    else if (ch == '\\')
                    {
                        escaped = true;
                    }
                    else if (ch == '"')
                    {
                        inString = false;
                    }
                    continue;
                }

                if (ch == '"')
                {
                    inString = true;
                    current.Append(ch);
                    continue;
                }

                if (ch == '(' || ch == '[' || ch == '{')
                {
                    depth++;
                    current.Append(ch);
                    continue;
                }

                if (ch == ')' || ch == ']' || ch == '}')
                {
                    depth = Math.Max(0, depth - 1);
                    current.Append(ch);
                    continue;
                }

                if (ch == ',' && depth == 0)
                {
                    result.Add(current.ToString().Trim());
                    current.Clear();
                    continue;
                }

                current.Append(ch);
            }

            var final = current.ToString().Trim();
            if (!string.IsNullOrWhiteSpace(final))
                result.Add(final);
            return result;
        }

        private object ParseSharedRuleToken(string token)
        {
            var text = (token ?? "").Trim();
            if (string.IsNullOrWhiteSpace(text))
                return null;
            if (text.StartsWith("{", StringComparison.Ordinal) || text.StartsWith("[", StringComparison.Ordinal))
                return SharedRuleJsonParser.Parse(text);
            if (text.StartsWith("\"", StringComparison.Ordinal) && text.EndsWith("\"", StringComparison.Ordinal) && text.Length >= 2)
                return text.Substring(1, text.Length - 2);
            if (string.Equals(text, "true", StringComparison.OrdinalIgnoreCase))
                return true;
            if (string.Equals(text, "false", StringComparison.OrdinalIgnoreCase))
                return false;
            if (string.Equals(text, "null", StringComparison.OrdinalIgnoreCase))
                return null;

            double numericValue;
            if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out numericValue))
                return numericValue;

            if (Regex.IsMatch(text, "^[a-zA-Z_][a-zA-Z0-9_.]*$"))
            {
                if (text.Contains("."))
                    return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase) { { "var", text } };
                return text;
            }

            return text;
        }

        private Dictionary<string, object> BuildSharedRuleContext(Bars sourceBars, int barIndex, Symbol symbol, TimeFrame timeFrame, Dictionary<string, object> extraContext = null)
        {
            var context = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            var barsList = new List<Dictionary<string, object>>();
            if (sourceBars != null)
            {
                for (var i = 0; i < sourceBars.Count; i++)
                    barsList.Add(BuildSharedRuleBarContext(sourceBars, i));
            }

            context["bars"] = barsList;
            context["index"] = barIndex;
            context["bar"] = barIndex >= 0 && barIndex < barsList.Count ? barsList[barIndex] : null;
            context["prev"] = barIndex > 0 && barIndex - 1 < barsList.Count ? barsList[barIndex - 1] : null;
            context["symbol"] = symbol != null ? symbol.Name : "";
            context["tf"] = GetTimeFrameShortLabel(timeFrame);
            context["timeframe"] = GetTimeFrameShortLabel(timeFrame);
            context["market"] = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
            {
                { "symbol", symbol != null ? symbol.Name : "" },
                { "tf", GetTimeFrameShortLabel(timeFrame) }
            };
            var indicators = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            var prevIndicators = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            PopulateSharedIndicatorDictionary(indicators, BuildSharedIndicatorSnapshot(sourceBars, barIndex));
            PopulateSharedIndicatorDictionary(prevIndicators, BuildSharedIndicatorSnapshot(sourceBars, Math.Max(0, barIndex - 1)));
            context["indicators"] = indicators;
            context["prev_indicators"] = prevIndicators;
            context["levels"] = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

            if (extraContext != null)
            {
                foreach (var pair in extraContext)
                    context[pair.Key] = pair.Value;
            }

            return context;
        }

        private Dictionary<string, object> BuildSharedRuleBarContext(Bars sourceBars, int index)
        {
            return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
            {
                { "time", ToUnixSecondsSafe(sourceBars != null && index >= 0 && index < sourceBars.Count ? sourceBars.OpenTimes[index] : DateTime.MinValue) },
                { "open", sourceBars != null && index >= 0 && index < sourceBars.Count ? sourceBars.OpenPrices[index] : 0.0 },
                { "high", sourceBars != null && index >= 0 && index < sourceBars.Count ? sourceBars.HighPrices[index] : 0.0 },
                { "low", sourceBars != null && index >= 0 && index < sourceBars.Count ? sourceBars.LowPrices[index] : 0.0 },
                { "close", sourceBars != null && index >= 0 && index < sourceBars.Count ? sourceBars.ClosePrices[index] : 0.0 },
                { "volume", sourceBars != null && index >= 0 && index < sourceBars.Count ? GetSharedRuleBarVolume(sourceBars, index) : 0.0 },
            };
        }

        private double GetSharedRuleBarVolume(Bars sourceBars, int index)
        {
            try
            {
                return sourceBars != null && index >= 0 && index < sourceBars.TickVolumes.Count
                    ? sourceBars.TickVolumes[index]
                    : 0.0;
            }
            catch
            {
                return 0.0;
            }
        }

        private long ToUnixSecondsSafe(DateTime value)
        {
            try
            {
                if (value == DateTime.MinValue)
                    return 0;
                return new DateTimeOffset(DateTime.SpecifyKind(value, DateTimeKind.Utc)).ToUnixTimeSeconds();
            }
            catch
            {
                return 0;
            }
        }

        private object EvaluateSharedRuleExpression(object node, Dictionary<string, object> ctx)
        {
            if (node == null)
                return null;
            if (node is string || node is bool || node is double || node is int || node is long || node is decimal || node is float)
                return node;

            var list = node as List<object>;
            if (list != null)
                return list.Select(item => EvaluateSharedRuleExpression(item, ctx)).ToList<object>();

            Dictionary<string, object> map;
            if (!TryGetRuleObject(node, out map))
                return null;

            object functionNameRaw;
            if (TryGetValueIgnoreCase(map, "fn", out functionNameRaw))
            {
                var functionName = ConvertToInvariantString(functionNameRaw);
                object argsRaw;
                var args = TryGetValueIgnoreCase(map, "args", out argsRaw) && argsRaw is List<object>
                    ? (List<object>)argsRaw
                    : new List<object>();
                return EvaluateSharedRuleFunction(functionName, args, ctx);
            }

            if (map.Count != 1)
                return null;

            var entry = map.First();
            var op = entry.Key ?? "";
            var rawValue = entry.Value;
            var items = rawValue as List<object> ?? new List<object> { rawValue };
            var values = items.Select(item => EvaluateSharedRuleExpression(item, ctx)).ToList();

            switch (op)
            {
                case "var":
                    return SharedRuleValueAtPath(ctx, ConvertToInvariantString(rawValue));
                case "and":
                    return MergeSharedRuleResults("and", values);
                case "then":
                    return MergeSharedRuleResults("then", values);
                case "or":
                    return MergeSharedRuleResults("or", values);
                case "not":
                    return !SharedRuleTruthy(values.Count > 0 ? values[0] : null);
                case "if":
                    for (var i = 0; i < values.Count - 1; i += 2)
                    {
                        if (SharedRuleTruthy(values[i]))
                            return values[i + 1];
                    }
                    return values.Count % 2 == 1 ? values[values.Count - 1] : null;
                case ">":
                    return ToSharedRuleNumber(values.ElementAtOrDefault(0)) > ToSharedRuleNumber(values.ElementAtOrDefault(1));
                case "<":
                    return ToSharedRuleNumber(values.ElementAtOrDefault(0)) < ToSharedRuleNumber(values.ElementAtOrDefault(1));
                case ">=":
                    return ToSharedRuleNumber(values.ElementAtOrDefault(0)) >= ToSharedRuleNumber(values.ElementAtOrDefault(1));
                case "<=":
                    return ToSharedRuleNumber(values.ElementAtOrDefault(0)) <= ToSharedRuleNumber(values.ElementAtOrDefault(1));
                case "==":
                    return SharedRuleEquals(values.ElementAtOrDefault(0), values.ElementAtOrDefault(1));
                case "!=":
                    return !SharedRuleEquals(values.ElementAtOrDefault(0), values.ElementAtOrDefault(1));
                case "+":
                    return values.Sum(ToSharedRuleNumber);
                case "-":
                    if (values.Count == 0) return 0.0;
                    if (values.Count == 1) return -ToSharedRuleNumber(values[0]);
                    var delta = ToSharedRuleNumber(values[0]);
                    for (var i = 1; i < values.Count; i++) delta -= ToSharedRuleNumber(values[i]);
                    return delta;
                case "*":
                    var product = 1.0;
                    foreach (var value in values) product *= ToSharedRuleNumber(value);
                    return product;
                case "/":
                    if (values.Count == 0) return 0.0;
                    var quotient = ToSharedRuleNumber(values[0]);
                    for (var i = 1; i < values.Count; i++)
                    {
                        var divisor = ToSharedRuleNumber(values[i]);
                        quotient = Math.Abs(divisor) <= 0.0000000001 ? quotient : quotient / divisor;
                    }
                    return quotient;
                case "abs":
                    return Math.Abs(ToSharedRuleNumber(values.ElementAtOrDefault(0)));
                case "min":
                    return values.Count == 0 ? 0.0 : values.Min(ToSharedRuleNumber);
                case "max":
                    return values.Count == 0 ? 0.0 : values.Max(ToSharedRuleNumber);
                case "crosses_above":
                    return EvaluateSharedRuleCrossComparator(rawValue, ctx, true);
                case "crosses_below":
                    return EvaluateSharedRuleCrossComparator(rawValue, ctx, false);
                case "touches":
                    return EvaluateSharedRuleLevelComparator(rawValue, ctx, "touches");
                case "retest":
                    return EvaluateSharedRuleLevelComparator(rawValue, ctx, "retest");
                case "rejected":
                    return EvaluateSharedRuleLevelComparator(rawValue, ctx, "rejected");
                case "holds_above":
                    return EvaluateSharedRuleLevelComparator(rawValue, ctx, "holds_above");
                case "holds_below":
                    return EvaluateSharedRuleLevelComparator(rawValue, ctx, "holds_below");
                case "sweeps_above":
                    return EvaluateSharedRuleLevelComparator(rawValue, ctx, "sweeps_above");
                case "sweeps_below":
                    return EvaluateSharedRuleLevelComparator(rawValue, ctx, "sweeps_below");
                default:
                    return null;
            }
        }

        private object EvaluateSharedRuleFunction(string functionName, List<object> rawArgs, Dictionary<string, object> ctx)
        {
            var lowerName = ConvertToInvariantString(functionName).Trim().ToLowerInvariant();
            var args = (rawArgs ?? new List<object>()).Select(arg => EvaluateSharedRuleExpression(arg, ctx)).ToList();
            var currentBar = SharedRuleCurrentBar(ctx);
            var prevBar = SharedRulePreviousBar(ctx);
            var currentTime = ConvertToInt64(SharedRuleValueAtPath(currentBar, "time"));
            var currentPrice = ToSharedRuleNumber(SharedRuleValueAtPath(currentBar, "close"));

            switch (lowerName)
            {
                case "is_true":
                    return SharedRuleTruthy(args.ElementAtOrDefault(0));
                case "get_artifacts":
                case "draw":
                    return SharedRuleTruthy(args.ElementAtOrDefault(0))
                        ? BuildSharedRuleArtifactResult(lowerName, BuildSharedRuleMatch(lowerName, "", currentBar, currentPrice, new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)), new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase))
                        : false;
                case "pin_bar":
                    return EvaluateSharedRulePinBar(args, ctx);
                case "engulfing":
                    return EvaluateSharedRuleEngulfing(args, ctx);
                case "morning_star":
                    return EvaluateSharedRuleSinglePattern("bullish_morning_star", "bullish", ctx);
                case "evening_star":
                    return EvaluateSharedRuleSinglePattern("bearish_evening_star", "bearish", ctx);
                case "hammer":
                    return EvaluateSharedRuleSinglePattern("bullish_hammer", "bullish", ctx);
                case "hanging_man":
                    return EvaluateSharedRuleSinglePattern("hanging_man", "bearish", ctx);
                case "shooting_star":
                    return EvaluateSharedRuleSinglePattern("shooting_star", "bearish", ctx);
                case "inverted_hammer":
                    return EvaluateSharedRuleSinglePattern("bullish_inverted_hammer", "bullish", ctx);
                case "piercing_line":
                    return EvaluateSharedRuleSinglePattern("bullish_piercing_line", "bullish", ctx);
                case "dark_cloud_cover":
                    return EvaluateSharedRuleSinglePattern("bearish_dark_cloud_cover", "bearish", ctx);
                case "three_white_soldiers":
                    return EvaluateSharedRuleSinglePattern("bullish_three_white_soldiers", "bullish", ctx);
                case "three_black_crows":
                    return EvaluateSharedRuleSinglePattern("bearish_three_black_crows", "bearish", ctx);
                case "harami":
                    return EvaluateSharedRuleHarami(args, ctx);
                case "inside_bar":
                    return EvaluateSharedRuleInsideOutsideBar("inside_bar", ctx, true);
                case "outside_bar":
                    return EvaluateSharedRuleInsideOutsideBar("outside_bar", ctx, false);
                case "trend":
                case "bias":
                    var derivedBias = DeriveSharedRuleBias(ctx);
                    if (string.IsNullOrWhiteSpace(derivedBias))
                        return false;
                    if (!string.IsNullOrWhiteSpace(ConvertToInvariantString(args.ElementAtOrDefault(0))) &&
                        NormalizeSharedRuleDirection(args[0]) != NormalizeSharedRuleDirection(derivedBias))
                        return false;
                    return BuildSharedRuleArtifactResult(lowerName, BuildSharedRuleMatch(lowerName, derivedBias, currentBar, currentPrice, new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
                    {
                        { "trend", derivedBias },
                    }), new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
                    {
                        { "bias", derivedBias },
                    });
                case "breakout":
                    return EvaluateSharedRuleLevelComparator(args.Count > 0 ? args[0] : null, ctx, "breakout");
                default:
                    return null;
            }
        }

        private object EvaluateSharedRuleCrossComparator(object rawValue, Dictionary<string, object> ctx, bool crossesAbove)
        {
            var values = ResolveSharedRuleCrossValues(rawValue, ctx);
            var leftPrev = values[0];
            var leftCurrent = values[1];
            var rightPrev = values[2];
            var rightCurrent = values[3];
            var crossed = crossesAbove
                ? leftPrev <= rightPrev && leftCurrent > rightCurrent
                : leftPrev >= rightPrev && leftCurrent < rightCurrent;
            if (!crossed)
                return false;
            return BuildSharedRuleArtifactResult(
                crossesAbove ? "crosses_above" : "crosses_below",
                BuildSharedRuleMatch(
                    crossesAbove ? "crosses_above" : "crosses_below",
                    crossesAbove ? "bullish" : "bearish",
                    SharedRuleCurrentBar(ctx),
                    leftCurrent,
                    new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
                    {
                        { "left_prev", leftPrev },
                        { "left_current", leftCurrent },
                        { "right_prev", rightPrev },
                        { "right_current", rightCurrent },
                    }),
                new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase));
        }

        private object EvaluateSharedRuleLevelComparator(object rawValue, Dictionary<string, object> ctx, string comparatorName)
        {
            var values = ResolveSharedRuleCrossValues(rawValue, ctx);
            var leftPrev = values[0];
            var leftCurrent = values[1];
            var rightPrev = values[2];
            var rightCurrent = values[3];
            var level = SharedRuleFinite(rightCurrent) ? rightCurrent : rightPrev;
            var currentBar = SharedRuleCurrentBar(ctx);
            if (currentBar == null || !SharedRuleFinite(level))
                return false;

            var barHigh = ToSharedRuleNumber(SharedRuleValueAtPath(currentBar, "high"));
            var barLow = ToSharedRuleNumber(SharedRuleValueAtPath(currentBar, "low"));
            var touched = barLow <= level && barHigh >= level;
            var bullish = false;
            var bearish = false;

            switch (comparatorName)
            {
                case "touches":
                    if (!touched) return false;
                    break;
                case "retest":
                    if (!touched) return false;
                    bullish = leftPrev > level && leftCurrent > level;
                    bearish = leftPrev < level && leftCurrent < level;
                    if (!bullish && !bearish) return false;
                    break;
                case "rejected":
                    bullish = barLow <= level && leftCurrent > level;
                    bearish = barHigh >= level && leftCurrent < level;
                    if (!bullish && !bearish) return false;
                    break;
                case "holds_above":
                    bullish = leftPrev > level && leftCurrent > level;
                    if (!bullish) return false;
                    break;
                case "holds_below":
                    bearish = leftPrev < level && leftCurrent < level;
                    if (!bearish) return false;
                    break;
                case "sweeps_above":
                    bearish = barHigh > level && leftCurrent < level;
                    if (!bearish) return false;
                    break;
                case "sweeps_below":
                    bullish = barLow < level && leftCurrent > level;
                    if (!bullish) return false;
                    break;
                case "breakout":
                    bullish = leftPrev <= level && leftCurrent > level;
                    bearish = leftPrev >= level && leftCurrent < level;
                    if (!bullish && !bearish) return false;
                    break;
                default:
                    return false;
            }

            var direction = bullish ? "bullish" : bearish ? "bearish" : "";
            return BuildSharedRuleArtifactResult(
                comparatorName,
                BuildSharedRuleMatch(comparatorName, direction, currentBar, level, new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
                {
                    { "level", level },
                    { "left_prev", leftPrev },
                    { "left_current", leftCurrent },
                    { "right_prev", rightPrev },
                    { "right_current", rightCurrent },
                }),
                new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
                {
                    { "level", level },
                });
        }

        private SharedRuleArtifactResult EvaluateSharedRulePinBar(List<object> args, Dictionary<string, object> ctx)
        {
            var biasFilter = NormalizeSharedRuleDirection(ConvertToInvariantString(args.ElementAtOrDefault(0)));
            var bar = SharedRuleCurrentBar(ctx);
            if (bar == null)
                return null;

            var open = ToSharedRuleNumber(SharedRuleValueAtPath(bar, "open"));
            var high = ToSharedRuleNumber(SharedRuleValueAtPath(bar, "high"));
            var low = ToSharedRuleNumber(SharedRuleValueAtPath(bar, "low"));
            var close = ToSharedRuleNumber(SharedRuleValueAtPath(bar, "close"));
            var body = Math.Abs(close - open);
            var range = Math.Max(0.0000001, high - low);
            var upperWick = high - Math.Max(open, close);
            var lowerWick = Math.Min(open, close) - low;

            var bullish = body / range <= 0.35 && lowerWick / range >= 0.45 && upperWick / range <= 0.2;
            var bearish = body / range <= 0.35 && upperWick / range >= 0.45 && lowerWick / range <= 0.2;

            if (biasFilter == "bullish") bearish = false;
            if (biasFilter == "bearish") bullish = false;

            if (!bullish && !bearish)
                return null;

            var matches = new List<SharedRuleArtifactMatch>();
            if (bullish)
                matches.Add(BuildSharedRuleMatch("bullish_pin_bar", "bullish", bar, close, new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)));
            if (bearish)
                matches.Add(BuildSharedRuleMatch("bearish_pin_bar", "bearish", bar, close, new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)));
            return BuildSharedRuleArtifactResult("pin_bar", matches, new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
            {
                { "bias", biasFilter },
            });
        }

        private SharedRuleArtifactResult EvaluateSharedRuleEngulfing(List<object> args, Dictionary<string, object> ctx)
        {
            var biasFilter = NormalizeSharedRuleDirection(ConvertToInvariantString(args.ElementAtOrDefault(0)));
            var bar = SharedRuleCurrentBar(ctx);
            var prev = SharedRulePreviousBar(ctx);
            if (bar == null || prev == null)
                return null;

            var prevOpen = ToSharedRuleNumber(SharedRuleValueAtPath(prev, "open"));
            var prevClose = ToSharedRuleNumber(SharedRuleValueAtPath(prev, "close"));
            var open = ToSharedRuleNumber(SharedRuleValueAtPath(bar, "open"));
            var close = ToSharedRuleNumber(SharedRuleValueAtPath(bar, "close"));

            var prevBodyHigh = Math.Max(prevOpen, prevClose);
            var prevBodyLow = Math.Min(prevOpen, prevClose);
            var bodyHigh = Math.Max(open, close);
            var bodyLow = Math.Min(open, close);

            var bullish = prevClose < prevOpen && close > open && bodyHigh >= prevBodyHigh && bodyLow <= prevBodyLow;
            var bearish = prevClose > prevOpen && close < open && bodyHigh >= prevBodyHigh && bodyLow <= prevBodyLow;

            if (biasFilter == "bullish") bearish = false;
            if (biasFilter == "bearish") bullish = false;

            if (!bullish && !bearish)
                return null;

            var matches = new List<SharedRuleArtifactMatch>();
            if (bullish)
                matches.Add(BuildSharedRuleMatch("bullish_engulfing", "bullish", bar, close, new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)));
            if (bearish)
                matches.Add(BuildSharedRuleMatch("bearish_engulfing", "bearish", bar, close, new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)));
            return BuildSharedRuleArtifactResult("engulfing", matches, new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
            {
                { "bias", biasFilter },
            });
        }

        private SharedRuleArtifactResult EvaluateSharedRuleInsideOutsideBar(string functionName, Dictionary<string, object> ctx, bool insideBar)
        {
            var bar = SharedRuleCurrentBar(ctx);
            var prev = SharedRulePreviousBar(ctx);
            if (bar == null || prev == null)
                return null;

            var condition = insideBar
                ? ToSharedRuleNumber(SharedRuleValueAtPath(bar, "high")) <= ToSharedRuleNumber(SharedRuleValueAtPath(prev, "high")) &&
                  ToSharedRuleNumber(SharedRuleValueAtPath(bar, "low")) >= ToSharedRuleNumber(SharedRuleValueAtPath(prev, "low"))
                : ToSharedRuleNumber(SharedRuleValueAtPath(bar, "high")) >= ToSharedRuleNumber(SharedRuleValueAtPath(prev, "high")) &&
                  ToSharedRuleNumber(SharedRuleValueAtPath(bar, "low")) <= ToSharedRuleNumber(SharedRuleValueAtPath(prev, "low"));
            if (!condition)
                return null;

            return BuildSharedRuleArtifactResult(functionName, BuildSharedRuleMatch(functionName, "", bar, ToSharedRuleNumber(SharedRuleValueAtPath(bar, "close")), new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)), new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase));
        }

        private SharedRuleArtifactResult EvaluateSharedRuleSinglePattern(string patternType, string direction, Dictionary<string, object> ctx)
        {
            var detected = DetectSharedRulePatterns(ctx);
            if (detected == null || !detected.Contains(patternType))
                return null;

            var bar = SharedRuleCurrentBar(ctx);
            return BuildSharedRuleArtifactResult(
                NormalizeSharedRuleEventType(patternType),
                BuildSharedRuleMatch(patternType, direction, bar, ToSharedRuleNumber(SharedRuleValueAtPath(bar, "close")), new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)),
                new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
                {
                    { "bias", direction },
                });
        }

        private SharedRuleArtifactResult EvaluateSharedRuleHarami(List<object> args, Dictionary<string, object> ctx)
        {
            var detected = DetectSharedRulePatterns(ctx);
            if (detected == null)
                return null;

            var biasFilter = NormalizeSharedRuleDirection(ConvertToInvariantString(args.ElementAtOrDefault(0)));
            var matches = new List<SharedRuleArtifactMatch>();
            var bar = SharedRuleCurrentBar(ctx);
            if (detected.Contains("bullish_harami") && (biasFilter == "na" || biasFilter == "bullish"))
                matches.Add(BuildSharedRuleMatch("bullish_harami", "bullish", bar, ToSharedRuleNumber(SharedRuleValueAtPath(bar, "close")), new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)));
            if (detected.Contains("bearish_harami") && (biasFilter == "na" || biasFilter == "bearish"))
                matches.Add(BuildSharedRuleMatch("bearish_harami", "bearish", bar, ToSharedRuleNumber(SharedRuleValueAtPath(bar, "close")), new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)));
            return matches.Count == 0
                ? null
                : BuildSharedRuleArtifactResult("harami", matches, new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
                {
                    { "bias", biasFilter },
                });
        }

        private HashSet<string> DetectSharedRulePatterns(Dictionary<string, object> ctx)
        {
            var bars = GetSharedRuleBars(ctx);
            var index = GetSharedRuleIndex(ctx);
            if (bars == null || index <= 0 || index >= bars.Count)
                return new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            var bar = bars[index];
            var prev = bars[index - 1];
            var prev2 = index > 1 ? bars[index - 2] : null;
            if (bar == null || prev == null)
                return new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            var outPatterns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var barStats = BuildSharedRuleCandleStats(bar);
            var prevStats = BuildSharedRuleCandleStats(prev);
            var prev2Stats = BuildSharedRuleCandleStats(prev2);
            if (barStats == null || prevStats == null)
                return outPatterns;

            var preCurrentPressure = InferSharedRulePriorPressure(bars, index - 1, 4);
            var preStarPressure = InferSharedRulePriorPressure(bars, index - 2, 4);
            var preSequencePressure = InferSharedRulePriorPressure(bars, index - 3, 5);
            var lowerShadowReversalShape =
                barStats.BodyRatio <= 0.35 &&
                barStats.LowerWick / barStats.Range >= 0.5 &&
                barStats.UpperWick / barStats.Range <= 0.15 &&
                barStats.BodyLow >= barStats.Low + barStats.Range * 0.55;
            var upperShadowReversalShape =
                barStats.BodyRatio <= 0.35 &&
                barStats.UpperWick / barStats.Range >= 0.5 &&
                barStats.LowerWick / barStats.Range <= 0.15 &&
                barStats.BodyHigh <= barStats.Low + barStats.Range * 0.45;

            if (prevStats.Bearish && barStats.Bullish && barStats.BodyHigh >= prevStats.BodyHigh && barStats.BodyLow <= prevStats.BodyLow)
                outPatterns.Add("bullish_engulfing");
            if (prevStats.Bullish && barStats.Bearish && barStats.BodyHigh >= prevStats.BodyHigh && barStats.BodyLow <= prevStats.BodyLow)
                outPatterns.Add("bearish_engulfing");

            if (barStats.BodyRatio <= 0.35 && barStats.LowerWick / barStats.Range >= 0.45 && barStats.UpperWick / barStats.Range <= 0.2)
                outPatterns.Add("bullish_pin_bar");
            if (barStats.BodyRatio <= 0.35 && barStats.UpperWick / barStats.Range >= 0.45 && barStats.LowerWick / barStats.Range <= 0.2)
                outPatterns.Add("bearish_pin_bar");

            if (lowerShadowReversalShape && preCurrentPressure == "down")
                outPatterns.Add("bullish_hammer");
            if (lowerShadowReversalShape && preCurrentPressure == "up")
                outPatterns.Add("hanging_man");
            if (upperShadowReversalShape && preCurrentPressure == "up")
                outPatterns.Add("shooting_star");
            if (upperShadowReversalShape && preCurrentPressure == "down")
                outPatterns.Add("bullish_inverted_hammer");

            if (prevStats.Bearish && barStats.Bullish && barStats.Open < prevStats.Close && barStats.Close > (prevStats.Open + prevStats.Close) * 0.5 && barStats.Close < prevStats.Open && preCurrentPressure == "down")
                outPatterns.Add("bullish_piercing_line");
            if (prevStats.Bullish && barStats.Bearish && barStats.Open > prevStats.Close && barStats.Close < (prevStats.Open + prevStats.Close) * 0.5 && barStats.Close > prevStats.Open && preCurrentPressure == "up")
                outPatterns.Add("bearish_dark_cloud_cover");

            if (prevStats.Bearish && prevStats.BodyRatio >= 0.5 && barStats.Bullish && barStats.BodyHigh <= prevStats.BodyHigh && barStats.BodyLow >= prevStats.BodyLow && barStats.Body <= prevStats.Body * 0.75 && preCurrentPressure == "down")
                outPatterns.Add("bullish_harami");
            if (prevStats.Bullish && prevStats.BodyRatio >= 0.5 && barStats.Bearish && barStats.BodyHigh <= prevStats.BodyHigh && barStats.BodyLow >= prevStats.BodyLow && barStats.Body <= prevStats.Body * 0.75 && preCurrentPressure == "up")
                outPatterns.Add("bearish_harami");

            if (prev2Stats != null && prev2Stats.Bearish && prev2Stats.BodyRatio >= 0.45 && prevStats.Body <= prev2Stats.Body * 0.6 && prevStats.BodyRatio <= 0.35 && barStats.Bullish && barStats.BodyRatio >= 0.45 && barStats.Close >= prev2Stats.BodyLow + prev2Stats.Body * 0.5 && preStarPressure == "down")
                outPatterns.Add("bullish_morning_star");
            if (prev2Stats != null && prev2Stats.Bullish && prev2Stats.BodyRatio >= 0.45 && prevStats.Body <= prev2Stats.Body * 0.6 && prevStats.BodyRatio <= 0.35 && barStats.Bearish && barStats.BodyRatio >= 0.45 && barStats.Close <= prev2Stats.BodyLow + prev2Stats.Body * 0.5 && preStarPressure == "up")
                outPatterns.Add("bearish_evening_star");

            if (index >= 2)
            {
                var a = BuildSharedRuleCandleStats(bars[index - 2]);
                var b = BuildSharedRuleCandleStats(bars[index - 1]);
                var c = BuildSharedRuleCandleStats(bars[index]);
                if (a != null && b != null && c != null)
                {
                    var ascendingCloses = a.Bullish && b.Bullish && c.Bullish && b.Close > a.Close && c.Close > b.Close;
                    var descendingCloses = a.Bearish && b.Bearish && c.Bearish && b.Close < a.Close && c.Close < b.Close;
                    var opensWithinBodies = b.Open >= a.BodyLow && b.Open <= a.BodyHigh && c.Open >= b.BodyLow && c.Open <= b.BodyHigh;
                    var smallUpperWicks = a.UpperWick / a.Range <= 0.2 && b.UpperWick / b.Range <= 0.2 && c.UpperWick / c.Range <= 0.2;
                    var smallLowerWicks = a.LowerWick / a.Range <= 0.2 && b.LowerWick / b.Range <= 0.2 && c.LowerWick / c.Range <= 0.2;
                    if (ascendingCloses && opensWithinBodies && smallUpperWicks && preSequencePressure == "down") outPatterns.Add("bullish_three_white_soldiers");
                    if (descendingCloses && opensWithinBodies && smallLowerWicks && preSequencePressure == "up") outPatterns.Add("bearish_three_black_crows");
                }
            }

            if (barStats.High <= prevStats.High && barStats.Low >= prevStats.Low)
                outPatterns.Add("inside_bar");
            if (barStats.High >= prevStats.High && barStats.Low <= prevStats.Low)
                outPatterns.Add("outside_bar");

            return outPatterns;
        }

        private string InferSharedRulePriorPressure(List<Dictionary<string, object>> bars, int endIndex, int lookback)
        {
            if (bars == null || endIndex < 1 || endIndex >= bars.Count)
                return "neutral";

            var startIndex = Math.Max(0, endIndex - Math.Max(2, lookback) + 1);
            var window = new List<SharedRuleCandleStats>();
            for (var i = startIndex; i <= endIndex && i < bars.Count; i++)
            {
                var stats = BuildSharedRuleCandleStats(bars[i]);
                if (stats != null)
                    window.Add(stats);
            }

            if (window.Count < 2)
                return "neutral";

            var firstClose = window[0].Close;
            var lastClose = window[window.Count - 1].Close;
            var bullishCount = window.Count(item => item.Bullish);
            var bearishCount = window.Count(item => item.Bearish);
            if (lastClose < firstClose && bearishCount >= bullishCount + 1)
                return "down";
            if (lastClose > firstClose && bullishCount >= bearishCount + 1)
                return "up";
            return "neutral";
        }

        private sealed class SharedRuleCandleStats
        {
            public double Open;
            public double High;
            public double Low;
            public double Close;
            public double Range;
            public double Body;
            public double BodyHigh;
            public double BodyLow;
            public double UpperWick;
            public double LowerWick;
            public double BodyRatio;
            public bool Bullish;
            public bool Bearish;
        }

        private SharedRuleCandleStats BuildSharedRuleCandleStats(Dictionary<string, object> bar)
        {
            if (bar == null)
                return null;

            var open = ToSharedRuleNumber(SharedRuleValueAtPath(bar, "open"));
            var high = ToSharedRuleNumber(SharedRuleValueAtPath(bar, "high"));
            var low = ToSharedRuleNumber(SharedRuleValueAtPath(bar, "low"));
            var close = ToSharedRuleNumber(SharedRuleValueAtPath(bar, "close"));
            if (!SharedRuleFinite(open) || !SharedRuleFinite(high) || !SharedRuleFinite(low) || !SharedRuleFinite(close))
                return null;

            var range = Math.Max(0.0000001, high - low);
            var body = Math.Abs(close - open);
            return new SharedRuleCandleStats
            {
                Open = open,
                High = high,
                Low = low,
                Close = close,
                Range = range,
                Body = body,
                BodyHigh = Math.Max(open, close),
                BodyLow = Math.Min(open, close),
                UpperWick = high - Math.Max(open, close),
                LowerWick = Math.Min(open, close) - low,
                BodyRatio = body / range,
                Bullish = close > open,
                Bearish = close < open,
            };
        }

        private SharedRuleArtifactMatch BuildSharedRuleMatch(string type, string direction, Dictionary<string, object> bar, double price, Dictionary<string, object> payload)
        {
            var normalizedDirection = NormalizeSharedRuleDirection(direction);
            return new SharedRuleArtifactMatch
            {
                Type = type ?? "",
                Direction = normalizedDirection,
                Bias = normalizedDirection,
                Label = type ?? "",
                Price = SharedRuleFinite(price) ? (double?)price : null,
                PriceLow = SharedRuleFinite(ToSharedRuleNumber(SharedRuleValueAtPath(bar, "low"))) ? (double?)ToSharedRuleNumber(SharedRuleValueAtPath(bar, "low")) : null,
                PriceHigh = SharedRuleFinite(ToSharedRuleNumber(SharedRuleValueAtPath(bar, "high"))) ? (double?)ToSharedRuleNumber(SharedRuleValueAtPath(bar, "high")) : null,
                AnchorTime = ConvertToInt64(SharedRuleValueAtPath(bar, "time")),
                Payload = payload ?? new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
            };
        }

        private SharedRuleArtifactResult BuildSharedRuleArtifactResult(string functionName, SharedRuleArtifactMatch match, Dictionary<string, object> meta)
        {
            return BuildSharedRuleArtifactResult(functionName, match != null ? new List<SharedRuleArtifactMatch> { match } : new List<SharedRuleArtifactMatch>(), meta);
        }

        private SharedRuleArtifactResult BuildSharedRuleArtifactResult(string functionName, List<SharedRuleArtifactMatch> matches, Dictionary<string, object> meta)
        {
            var normalizedMatches = (matches ?? new List<SharedRuleArtifactMatch>()).Where(item => item != null).ToList();
            if (normalizedMatches.Count == 0)
                return null;
            return new SharedRuleArtifactResult
            {
                FunctionName = ConvertToInvariantString(functionName).Trim().ToLowerInvariant(),
                Matches = normalizedMatches,
                Meta = meta ?? new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
            };
        }

        private object MergeSharedRuleResults(string mode, List<object> values)
        {
            var items = values ?? new List<object>();
            if (string.Equals(mode, "and", StringComparison.OrdinalIgnoreCase) || string.Equals(mode, "then", StringComparison.OrdinalIgnoreCase))
            {
                if (!items.All(SharedRuleTruthy))
                    return false;
            }
            else if (!items.Any(SharedRuleTruthy))
            {
                return false;
            }

            var mergedMatches = new List<SharedRuleArtifactMatch>();
            foreach (var item in items)
            {
                var artifact = item as SharedRuleArtifactResult;
                if (artifact == null || artifact.Matches == null)
                    continue;
                mergedMatches.AddRange(artifact.Matches.Where(match => match != null));
            }

            if (mergedMatches.Count == 0)
                return true;

            if (string.Equals(mode, "then", StringComparison.OrdinalIgnoreCase))
            {
                long previousTime = 0;
                foreach (var item in items)
                {
                    var artifact = item as SharedRuleArtifactResult;
                    if (artifact == null || artifact.Matches == null || artifact.Matches.Count == 0)
                        continue;
                    var latestTime = artifact.Matches.Max(match => match != null ? match.AnchorTime : 0);
                    if (latestTime < previousTime)
                        return false;
                    previousTime = latestTime;
                }
            }

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var deduped = new List<SharedRuleArtifactMatch>();
            foreach (var match in mergedMatches)
            {
                var key = string.Join("|", match.Type ?? "", match.Direction ?? "", match.AnchorTime.ToString(CultureInfo.InvariantCulture), match.Price.HasValue ? match.Price.Value.ToString("G17", CultureInfo.InvariantCulture) : "");
                if (seen.Add(key))
                    deduped.Add(match);
            }

            return BuildSharedRuleArtifactResult(mode, deduped, new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
            {
                { "operator", mode }
            });
        }

        private double[] ResolveSharedRuleCrossValues(object rawValue, Dictionary<string, object> ctx)
        {
            var leftPrevNode = (object)null;
            var leftNode = (object)null;
            var rightPrevNode = (object)null;
            var rightNode = (object)null;

            var list = rawValue as List<object>;
            if (list != null)
            {
                if (list.Count >= 4)
                {
                    leftPrevNode = list[0];
                    leftNode = list[1];
                    rightPrevNode = list[2];
                    rightNode = list[3];
                }
                else if (list.Count >= 2)
                {
                    leftNode = list[0];
                    rightNode = list[1];
                    leftPrevNode = InferSharedRulePreviousNode(leftNode);
                    rightPrevNode = InferSharedRulePreviousNode(rightNode);
                }
            }
            else
            {
                Dictionary<string, object> map;
                if (TryGetRuleObject(rawValue, out map))
                {
                    leftNode = GetDictionaryValue(map, "left");
                    rightNode = GetDictionaryValue(map, "right");
                    leftPrevNode = GetDictionaryValue(map, "left_prev") ?? GetDictionaryValue(map, "leftPrev") ?? InferSharedRulePreviousNode(leftNode);
                    rightPrevNode = GetDictionaryValue(map, "right_prev") ?? GetDictionaryValue(map, "rightPrev") ?? InferSharedRulePreviousNode(rightNode);
                }
            }

            return new[]
            {
                ToSharedRuleNumber(EvaluateSharedRuleExpression(leftPrevNode, ctx)),
                ToSharedRuleNumber(EvaluateSharedRuleExpression(leftNode, ctx)),
                ToSharedRuleNumber(EvaluateSharedRuleExpression(rightPrevNode, ctx)),
                ToSharedRuleNumber(EvaluateSharedRuleExpression(rightNode, ctx)),
            };
        }

        private object InferSharedRulePreviousNode(object node)
        {
            Dictionary<string, object> map;
            if (!TryGetRuleObject(node, out map) || map.Count != 1)
                return node;

            object rawValue;
            if (!TryGetValueIgnoreCase(map, "var", out rawValue))
                return node;

            var path = ConvertToInvariantString(rawValue);
            if (path.StartsWith("indicators.", StringComparison.OrdinalIgnoreCase))
                return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase) { { "var", "prev_indicators." + path.Substring("indicators.".Length) } };
            if (path.StartsWith("bar.", StringComparison.OrdinalIgnoreCase))
                return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase) { { "var", "prev." + path.Substring("bar.".Length) } };
            return node;
        }

        private object SharedRuleValueAtPath(object source, string pathName)
        {
            if (string.IsNullOrWhiteSpace(pathName))
                return null;

            var parts = pathName
                .Split(new[] { '.' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(part => part.Trim())
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .ToList();

            object cursor = source;
            foreach (var part in parts)
            {
                if (cursor == null)
                    return null;

                Dictionary<string, object> map;
                if (TryGetRuleObject(cursor, out map))
                {
                    object next;
                    if (!TryGetValueIgnoreCase(map, part, out next))
                        return null;
                    cursor = next;
                    continue;
                }

                return null;
            }

            return cursor;
        }

        private Dictionary<string, object> SharedRuleCurrentBar(Dictionary<string, object> ctx)
        {
            Dictionary<string, object> bar;
            return TryGetNestedDictionary(ctx, "bar", out bar) ? bar : null;
        }

        private Dictionary<string, object> SharedRulePreviousBar(Dictionary<string, object> ctx)
        {
            Dictionary<string, object> bar;
            return TryGetNestedDictionary(ctx, "prev", out bar) ? bar : null;
        }

        private string DeriveSharedRuleBias(Dictionary<string, object> ctx)
        {
            var bars = GetSharedRuleBars(ctx);
            var index = GetSharedRuleIndex(ctx);
            if (bars == null || bars.Count == 0 || index < 0)
                return "";

            var startIndex = Math.Max(0, index - 4);
            var firstClose = ToSharedRuleNumber(SharedRuleValueAtPath(bars[startIndex], "close"));
            var lastClose = ToSharedRuleNumber(SharedRuleValueAtPath(bars[index], "close"));
            if (!SharedRuleFinite(firstClose) || !SharedRuleFinite(lastClose) || Math.Abs(lastClose - firstClose) <= 0.0000000001)
                return "neutral";
            return lastClose > firstClose ? "bullish" : "bearish";
        }

        private List<Dictionary<string, object>> GetSharedRuleBars(Dictionary<string, object> ctx)
        {
            object rawBars;
            if (ctx == null || !TryGetValueIgnoreCase(ctx, "bars", out rawBars))
                return new List<Dictionary<string, object>>();

            var list = rawBars as List<object>;
            if (list != null)
            {
                return list
                    .Select(item =>
                    {
                        Dictionary<string, object> map;
                        return TryGetRuleObject(item, out map) ? map : null;
                    })
                    .Where(map => map != null)
                    .ToList();
            }

            var typedList = rawBars as List<Dictionary<string, object>>;
            return typedList ?? new List<Dictionary<string, object>>();
        }

        private int GetSharedRuleIndex(Dictionary<string, object> ctx)
        {
            return (int)Math.Round(ToSharedRuleNumber(GetDictionaryValue(ctx, "index")));
        }

        private bool SharedRuleTruthy(object value)
        {
            var artifact = value as SharedRuleArtifactResult;
            if (artifact != null)
                return artifact.Matches != null && artifact.Matches.Count > 0;
            if (value is bool)
                return (bool)value;
            if (value == null)
                return false;
            if (value is string)
                return !string.IsNullOrWhiteSpace((string)value);
            return true;
        }

        private bool SharedRuleEquals(object left, object right)
        {
            var leftNumber = ToSharedRuleNumber(left);
            var rightNumber = ToSharedRuleNumber(right);
            if (SharedRuleFinite(leftNumber) && SharedRuleFinite(rightNumber))
                return Math.Abs(leftNumber - rightNumber) <= 0.0000000001;
            return string.Equals(ConvertToInvariantString(left), ConvertToInvariantString(right), StringComparison.OrdinalIgnoreCase);
        }

        private double ToSharedRuleNumber(object value)
        {
            if (value == null)
                return double.NaN;
            if (value is double) return (double)value;
            if (value is float) return Convert.ToDouble(value, CultureInfo.InvariantCulture);
            if (value is decimal) return Convert.ToDouble(value, CultureInfo.InvariantCulture);
            if (value is int) return Convert.ToDouble(value, CultureInfo.InvariantCulture);
            if (value is long) return Convert.ToDouble(value, CultureInfo.InvariantCulture);
            double number;
            return double.TryParse(ConvertToInvariantString(value), NumberStyles.Float, CultureInfo.InvariantCulture, out number)
                ? number
                : double.NaN;
        }

        private bool SharedRuleFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        private long ConvertToInt64(object value)
        {
            long output;
            return long.TryParse(ConvertToInvariantString(value), NumberStyles.Integer, CultureInfo.InvariantCulture, out output) ? output : 0;
        }

        private string ConvertToInvariantString(object value)
        {
            return value == null ? "" : Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
        }

        private string NormalizeSharedRuleEventType(string rawType)
        {
            var normalized = ConvertToInvariantString(rawType).Trim().ToLowerInvariant();
            if (normalized.StartsWith("bullish_", StringComparison.Ordinal))
                normalized = normalized.Substring("bullish_".Length);
            else if (normalized.StartsWith("bearish_", StringComparison.Ordinal))
                normalized = normalized.Substring("bearish_".Length);
            if (string.IsNullOrWhiteSpace(normalized))
                return "na";
            return normalized;
        }

        private string NormalizeSharedRuleDirection(object rawDirection)
        {
            var normalized = ConvertToInvariantString(rawDirection).Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(normalized))
                return "na";
            if (normalized == "buy" || normalized == "bull" || normalized == "bullish" || normalized == "long" || normalized == "up")
                return "bullish";
            if (normalized == "sell" || normalized == "bear" || normalized == "bearish" || normalized == "short" || normalized == "down")
                return "bearish";
            if (normalized == "neutral")
                return "neutral";
            return normalized;
        }

        private bool TryGetRuleObject(object value, out Dictionary<string, object> map)
        {
            map = value as Dictionary<string, object>;
            return map != null;
        }

        private bool TryGetValueIgnoreCase(Dictionary<string, object> map, string key, out object value)
        {
            value = null;
            if (map == null || string.IsNullOrWhiteSpace(key))
                return false;
            if (map.TryGetValue(key, out value))
                return true;
            foreach (var pair in map)
            {
                if (string.Equals(pair.Key ?? "", key, StringComparison.OrdinalIgnoreCase))
                {
                    value = pair.Value;
                    return true;
                }
            }
            return false;
        }

        private object GetDictionaryValue(Dictionary<string, object> map, string key)
        {
            object value;
            return TryGetValueIgnoreCase(map, key, out value) ? value : null;
        }

        private bool TryGetNestedDictionary(Dictionary<string, object> map, string key, out Dictionary<string, object> nested)
        {
            nested = null;
            object raw;
            if (!TryGetValueIgnoreCase(map, key, out raw))
                return false;
            return TryGetRuleObject(raw, out nested);
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
