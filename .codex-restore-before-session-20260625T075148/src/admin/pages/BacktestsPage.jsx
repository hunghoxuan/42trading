import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import MetricValue, { inferPricePrecision } from "../components/MetricValue";
import StrategyEditorPanel from "../components/StrategyEditorPanel";
import SymbolChart from "../components/charts/SymbolChart";
import PageHeader from "../../shared/components/PageHeader";
import MasterDetailLayout from "../../shared/components/MasterDetailLayout";
import ResponsivePanel from "../../shared/components/ResponsivePanel";
import FormComboSelect from "../../shared/components/FormComboSelect";
import TabBar from "../../shared/components/TabBar";
import { useConfirmDialog } from "../../shared/components/ConfirmDialog";
import { deriveBacktestFormFromRun } from "../utils/backtestForm";
import { showDateTime } from "../utils/format";
import { SYSTEM_SYMBOL_GROUP_PRESETS } from "../utils/symbolGroups";
import {
  mergeStrategiesById,
  normalizeStrategyCatalog,
} from "../utils/strategyCatalog";

function formatNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(digits);
}

function timeframeLabel(tfRaw) {
  const tf = String(tfRaw || "").trim().toLowerCase();
  if (!tf) return "-";
  if (tf === "1" || tf === "1m") return "1m";
  if (tf === "5" || tf === "5m") return "5m";
  if (tf === "15" || tf === "15m") return "15m";
  if (tf === "60" || tf === "1h") return "1h";
  if (tf === "240" || tf === "4h") return "4h";
  if (tf === "1440" || tf === "1d") return "1d";
  return String(tfRaw || "-");
}

function formatActionTypeLabel(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  return raw
    .split(".")
    .map((part) =>
      part
        .split("_")
        .map((token) =>
          token ? `${token.slice(0, 1).toUpperCase()}${token.slice(1)}` : "",
        )
        .join(" "),
    )
    .join(" / ");
}

function strategySourceMeta(strategy = {}) {
  const kind = String(strategy?.kind || "").trim().toLowerCase();
  if (kind === "custom") {
    return {
      badge: "USR",
      text: "user",
      color: "#22c55e",
      background: "rgba(34,197,94,0.12)",
      border: "rgba(34,197,94,0.32)",
    };
  }
  return {
    badge: "CFG",
    text: "config",
    color: "#38bdf8",
    background: "rgba(56,189,248,0.12)",
    border: "rgba(56,189,248,0.32)",
  };
}

function toTimeMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function compareTimeDesc(a, b) {
  const left = toTimeMs(a);
  const right = toTimeMs(b);
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right - left;
}

function tradeReplayTimeMs(trade = {}) {
  return (
    toTimeMs(trade?.created_at) ??
    toTimeMs(trade?.signal_bar_time) ??
    toTimeMs(trade?.opened_at) ??
    toTimeMs(trade?.closed_at) ??
    0
  );
}

function compareTradeReplayAsc(left, right) {
  const leftTime = tradeReplayTimeMs(left);
  const rightTime = tradeReplayTimeMs(right);
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left?.sid || "").localeCompare(String(right?.sid || ""));
}

function pickInitialTradeSid(trades = []) {
  if (!Array.isArray(trades) || !trades.length) return "";
  const firstTrade = [...trades].sort(compareTradeReplayAsc)[0];
  return String(firstTrade?.sid || "");
}

const LEFT_TABS = [
  { value: "backtest", label: "Backtest" },
  { value: "history", label: "History" },
  { value: "strategies", label: "Strategies" },
];

const TIMEFRAME_OPTIONS = [
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "60", label: "1h" },
  { value: "240", label: "4h" },
  { value: "1440", label: "1d" },
];

const BARS_OPTIONS = [
  { value: "300", label: "300" },
  { value: "500", label: "500" },
  { value: "1000", label: "1000" },
  { value: "3000", label: "3000" },
  { value: "5000", label: "5000" },
  { value: "all", label: "Full history" },
];

const BACKTEST_DIRECTION_OPTIONS = [
  { value: "all", label: "All" },
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
];

const BACKTEST_SESSION_OPTIONS = [
  { value: "Any", label: "Any" },
  { value: "London", label: "London" },
  { value: "New York", label: "New York" },
  { value: "Asian", label: "Asian" },
  { value: "London+NY", label: "London+NY" },
];

const REPLAY_SPEED_OPTIONS = [
  { value: 100, label: "0.1s" },
  { value: 200, label: "0.2s" },
  { value: 500, label: "0.5s" },
  { value: 1000, label: "1s" },
  { value: 2000, label: "2s" },
  { value: 5000, label: "5s" },
];

function sideClass(action) {
  return String(action || "").toUpperCase() === "SELL" ? "side-sell" : "side-buy";
}

function asNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function calcRr(trade = {}) {
  const entry = asNum(trade?.entry);
  const tp = asNum(trade?.tp);
  const sl = asNum(trade?.sl);
  if (entry == null || tp == null || sl == null) return null;
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (!risk || !Number.isFinite(risk) || !Number.isFinite(reward)) return null;
  return reward / risk;
}

function cloneJson(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function runMatchesStrategy(run = {}, strategy = null, fallbackStrategyId = "") {
  const strategyIds = new Set(
    [
      strategy?.key,
      strategy?.id,
      fallbackStrategyId,
      strategy?.name,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  if (!strategyIds.size) return true;
  const runIds = [
    run?.strategy_key,
    run?.strategy_id,
    run?.strategy_name,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return runIds.some((value) => strategyIds.has(value));
}

function formatRunSelectorLabel(run = {}) {
  const strategyLabel = String(run?.strategy_name || run?.strategy_key || "Run")
    .trim();
  const tfLabel = timeframeLabel(run?.tf);
  const symbolLabel = String(run?.symbol || "-").trim() || "-";
  const rangeLabel = formatBacktestDataRange(run);
  return `${strategyLabel} - ${tfLabel} - ${symbolLabel}${rangeLabel ? ` - ${rangeLabel}` : ""}`;
}

function buildEphemeralRunSaveName(result = {}) {
  const run = result?.run && typeof result.run === "object" ? result.run : {};
  return formatRunSelectorLabel(run) || String(run?.run_id || "backtest_run").trim() || "backtest_run";
}

function formatBacktestDateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const currentYear = new Date().getFullYear();
  return year === currentYear ? `${day}.${month}` : `${day}.${month}.${year}`;
}

function formatBacktestDataRange(run = {}, summaryOverride = null) {
  const summary =
    summaryOverride && typeof summaryOverride === "object"
      ? summaryOverride
      : run?.summary && typeof run.summary === "object"
        ? run.summary
        : {};
  const startLabel = formatBacktestDateLabel(summary?.first_bar_at);
  const endLabel = formatBacktestDateLabel(summary?.last_bar_at);
  if (startLabel && endLabel) {
    return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
  }
  return startLabel || endLabel || "";
}

function formatBacktestDateTimeLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const currentYear = new Date().getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const datePart =
    year === currentYear ? `${day}.${month}` : `${day}.${month}.${year}`;
  return `${datePart} ${hours}:${minutes}`;
}

function formatBacktestSummaryRange(run = {}, summaryOverride = null) {
  const summary =
    summaryOverride && typeof summaryOverride === "object"
      ? summaryOverride
      : run?.summary && typeof run.summary === "object"
        ? run.summary
        : {};
  const startLabel = formatBacktestDateTimeLabel(summary?.first_bar_at);
  const endLabel = formatBacktestDateTimeLabel(summary?.last_bar_at);
  const barsCount = Number(summary?.bars_analyzed);
  const barsLabel = Number.isFinite(barsCount) && barsCount > 0 ? `${barsCount} bars` : "";
  const rangeLabel =
    startLabel && endLabel
      ? `${startLabel} - ${endLabel}`
      : startLabel || endLabel || "";
  if (rangeLabel && barsLabel) return `${rangeLabel} | ${barsLabel}`;
  return rangeLabel || barsLabel || "";
}

function formatWholeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return String(Math.round(num));
}

function formatBacktestSummaryPoint(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const currentYear = new Date().getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return year === currentYear
    ? `${day}.${month} ${hours}:${minutes}`
    : `${day}.${month}.${year} ${hours}:${minutes}`;
}

function buildNewStrategyDraft(example, defaults = {}) {
  const base = cloneJson(example) || {};
  const timestamp = Date.now();
  const sourceId = String(base.id || base.key || "").trim();
  const sourceName = String(base.name || "").trim();
  const nextIdBase = sourceId ? `${sourceId}_custom` : `custom_strategy_${timestamp}`;
  return {
    id: `${nextIdBase}_${timestamp}`,
    name: sourceName ? `${sourceName} Copy` : "New Custom Strategy",
    description: base.description || "",
    engine_version: "42trade.strategy.v2",
    kind: "custom",
    status: "draft",
    market: {
      symbol: defaults.symbol || base.market?.symbol || "EURAUD",
      tf: defaults.tf || base.market?.tf || "15",
    },
    params:
      base.params && typeof base.params === "object" && !Array.isArray(base.params)
        ? base.params
        : {},
    indicators: Array.isArray(base.indicators) ? base.indicators : [],
    events: Array.isArray(base.events) ? base.events : [],
    rules:
      base.rules && typeof base.rules === "object" && !Array.isArray(base.rules)
        ? base.rules
        : {},
    risk:
      base.risk && typeof base.risk === "object" && !Array.isArray(base.risk)
        ? base.risk
        : {},
    metadata:
      base.metadata && typeof base.metadata === "object" && !Array.isArray(base.metadata)
        ? base.metadata
        : {},
  };
}

function buildStrategySaveAsPayload(strategy) {
  const base = cloneJson(strategy) || {};
  const timestamp = Date.now();
  const sourceId = String(base.id || base.key || "custom_strategy").trim() || "custom_strategy";
  const sourceName = String(base.name || "").trim();
  return {
    ...base,
    id: `${sourceId}_${timestamp}`,
    name: sourceName ? `${sourceName} Copy` : "New Custom Strategy",
    key: undefined,
    status: String(base.status || "draft").trim() || "draft",
  };
}

function TradeListCard({
  trade,
  symbol,
  active = false,
  onClick,
}) {
  const action = String(trade?.action || trade?.side || "").toUpperCase();
  const pnl = Number(trade?.pnl_realized || 0);
  const rr = calcRr(trade);
  return (
    <div
      role="button"
      tabIndex={0}
      className="secondary-button"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onClick?.();
      }}
      style={{
        width: "100%",
        minHeight: 52,
        padding: "4px 6px",
        justifyContent: "flex-start",
        textAlign: "left",
        borderColor: active ? "var(--accent)" : "var(--border)",
        background: active ? "rgba(255,255,255,0.05)" : "transparent",
        borderRadius: 6,
      }}
    >
      <div className="stack-layout" style={{ gap: 4, width: "100%" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: 10,
                color: action === "SELL" ? "#ef5350" : "#26a69a",
              }}
            >
              {symbol || "-"}
            </span>
            <span
              style={{
                flex: "0 0 auto",
                fontSize: 9,
                fontWeight: 800,
                lineHeight: 1,
                padding: "3px 5px",
                borderRadius: 999,
                border: `1px solid ${action === "SELL" ? "#ef535044" : "#26a69a44"}`,
                background: action === "SELL" ? "#ef535018" : "#26a69a18",
                color: action === "SELL" ? "#ef5350" : "#26a69a",
              }}
            >
              {action || "-"}
            </span>
          </div>
          <span
            style={{
              fontWeight: 700,
              fontSize: 10,
              color: pnl >= 0 ? "#10b981" : "#ef4444",
            }}
          >
            {`${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(0)}`}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span>
            <span style={{ color: "var(--muted)", fontSize: 9 }}>
              {trade?.entry || "-"} → {trade?.tp || "-"}
            </span>
          </span>
          <span style={{ color: "var(--muted)", fontSize: 9 }}>
            {rr != null ? `${rr.toFixed(1)}R` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function BacktestsPage() {
  const navigate = useNavigate();
  const params = useParams();
  const confirm = useConfirmDialog();
  const routeRunId = String(params.runId || "").trim();

  const [activeTab, setActiveTab] = useState("backtest");
  const [runs, setRuns] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [customStrategies, setCustomStrategies] = useState([]);
  const [strategyExample, setStrategyExample] = useState(null);
  const [selectedStrategyId, setSelectedStrategyId] = useState("");
  const [draftStrategySeed, setDraftStrategySeed] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(routeRunId);
  const [selectedRunDetail, setSelectedRunDetail] = useState(null);
  const [ephemeralRunDetail, setEphemeralRunDetail] = useState(null);
  const [ephemeralRunSaveName, setEphemeralRunSaveName] = useState("");
  const [selectedTradeSid, setSelectedTradeSid] = useState("");
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [running, setRunning] = useState(false);
  const [savingRun, setSavingRun] = useState(false);
  const [error, setError] = useState("");
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeedMs, setReplaySpeedMs] = useState(200);
  const [replayStartTradeSid, setReplayStartTradeSid] = useState("");
  const [replayActiveTradeSid, setReplayActiveTradeSid] = useState("");
  const [replayProgress, setReplayProgress] = useState(null);
  const [form, setForm] = useState({
    symbol: "EURAUD",
    tf: "15",
    limit: "1000",
    strategy_key: "ema_cross_v1",
    direction: "all",
    session: "Any",
    one_r_value: "100",
  });

  async function loadRuns(preferredRunId = "") {
    setLoadingRuns(true);
    setError("");
    try {
      const res = await api.listBacktests();
      const nextRuns = Array.isArray(res?.runs) ? res.runs : [];
      setRuns(nextRuns);
      const nextSelectedRunId =
        preferredRunId ||
        routeRunId ||
        selectedRunId ||
        (nextRuns[0] ? String(nextRuns[0].run_id || "") : "");
      if (nextSelectedRunId) {
        setSelectedRunId(nextSelectedRunId);
      }
    } catch (loadError) {
      setError(String(loadError?.message || loadError || "Failed to load backtests"));
    } finally {
      setLoadingRuns(false);
    }
  }

  async function loadStrategyCatalog() {
    try {
      const res = await api.listStrategies();
      const items = normalizeStrategyCatalog(res?.items);
      setStrategies(
        items.filter((item) => String(item?.kind || "").trim() !== "custom"),
      );
      setCustomStrategies(
        items.filter((item) => String(item?.kind || "").trim() === "custom"),
      );
      setStrategyExample(res?.example || null);
    } catch {
      // noop
    }
  }

  useEffect(() => {
    loadRuns();
    loadStrategyCatalog();
  }, []);

  useEffect(() => {
    if (routeRunId && routeRunId !== selectedRunId) {
      setEphemeralRunDetail(null);
      setSelectedRunId(routeRunId);
      return;
    }
    if (!selectedRunId) {
      setSelectedRunDetail(null);
      setSelectedTradeSid("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getBacktest(selectedRunId);
        if (cancelled) return;
        setSelectedRunDetail(res);
        setSelectedTradeSid(pickInitialTradeSid(res?.trades));
      } catch (detailError) {
        if (!cancelled) {
          setSelectedRunDetail(null);
          setSelectedTradeSid("");
          setError(
            String(detailError?.message || detailError || "Failed to load backtest detail"),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeRunId, selectedRunId]);

  const activeRunDetail = ephemeralRunDetail || selectedRunDetail || null;
  const activeRun = activeRunDetail?.run || null;
  const activeSummary = activeRunDetail?.summary || null;
  const activeTrades = Array.isArray(activeRunDetail?.trades)
    ? activeRunDetail.trades
    : [];
  const activeEventLog = Array.isArray(activeRunDetail?.events)
    ? activeRunDetail.events
    : [];
  const strategyOptions = useMemo(
    () =>
      strategies.length
        ? mergeStrategiesById(strategies)
        : [{ key: "ema_cross_v1", name: "EMA Cross v1" }],
    [strategies],
  );
  const allStrategies = useMemo(
    () => mergeStrategiesById(strategyOptions, customStrategies),
    [customStrategies, strategyOptions],
  );
  const selectedExistingStrategy = useMemo(
    () =>
      allStrategies.find((item) => String(item.key || item.id || "") === String(selectedStrategyId || "")) ||
      allStrategies.find((item) => String(item.key || item.id || "") === String(form.strategy_key || "")) ||
      null,
    [allStrategies, form.strategy_key, selectedStrategyId],
  );
  const selectedStrategy = useMemo(
    () =>
      selectedStrategyId === "__new__"
        ? draftStrategySeed
        : selectedExistingStrategy,
    [draftStrategySeed, selectedExistingStrategy, selectedStrategyId],
  );
  const symbolOptions = useMemo(() => {
    const known = new Set();
    for (const values of Object.values(SYSTEM_SYMBOL_GROUP_PRESETS)) {
      for (const symbol of values || []) known.add(String(symbol || "").trim().toUpperCase());
    }
    if (activeRun?.symbol) known.add(String(activeRun.symbol).trim().toUpperCase());
    if (form.symbol) known.add(String(form.symbol).trim().toUpperCase());
    return Array.from(known).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [activeRun?.symbol, form.symbol]);
  const sortedActiveTrades = useMemo(
    () => [...activeTrades].sort(compareTradeReplayAsc),
    [activeTrades],
  );
  const effectiveTradeSid = replayPlaying
    ? String(replayActiveTradeSid || replayStartTradeSid || selectedTradeSid || "")
    : String(selectedTradeSid || "");
  const selectedTrade = useMemo(
    () =>
      sortedActiveTrades.find((trade) => String(trade?.sid || "") === effectiveTradeSid) ||
      sortedActiveTrades[0] ||
      null,
    [effectiveTradeSid, sortedActiveTrades],
  );
  const activeDataRangeLabel = useMemo(
    () => formatBacktestDataRange(activeRun, activeSummary),
    [activeRun, activeSummary],
  );
  const activeSummaryRangeLabel = useMemo(
    () => formatBacktestSummaryRange(activeRun, activeSummary),
    [activeRun, activeSummary],
  );
  const oneRValue = useMemo(() => {
    const parsed = Number(form.one_r_value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
  }, [form.one_r_value]);
  const replaySummary = useMemo(() => {
    if (!replayPlaying || !replayProgress || !activeSummary) return null;
    const replayTimeSec = Number(replayProgress.clockTimeSec);
    if (!Number.isFinite(replayTimeSec) || replayTimeSec <= 0) return null;
    const replayTimeMs = replayTimeSec * 1000;
    const closedTrades = sortedActiveTrades.filter((trade) => {
      const closedAtMs = toTimeMs(trade?.closed_at);
      return Number.isFinite(closedAtMs) && closedAtMs <= replayTimeMs;
    });
    const wins = closedTrades.filter((trade) => Number(trade?.pnl_realized || 0) > 0).length;
    const totalPnl = closedTrades.reduce(
      (sum, trade) => sum + Number(trade?.pnl_realized || 0),
      0,
    );
    const winRate = closedTrades.length ? (wins / closedTrades.length) * 100 : 0;
    const startLabel = formatBacktestSummaryPoint(activeSummary?.first_bar_at);
    const endLabel = formatBacktestSummaryPoint(replayTimeMs);
    return {
      rangeLabel:
        startLabel && endLabel
          ? `${startLabel} - ${endLabel} | ${Math.max(0, Number(replayProgress.barsVisible) || 0)} bars`
          : activeSummaryRangeLabel,
      totalTrades: closedTrades.length,
      totalPnl,
      totalRr:
        Number.isFinite(totalPnl) && Number.isFinite(oneRValue) && oneRValue > 0
          ? totalPnl / oneRValue
          : null,
      winRate,
    };
  }, [
    activeSummary,
    activeSummaryRangeLabel,
    oneRValue,
    replayPlaying,
    replayProgress,
    sortedActiveTrades,
  ]);
  const sortedActiveEventLog = useMemo(
    () =>
      [...activeEventLog].sort((left, right) => {
        const timeDelta =
          Number(right?.bar_time_unix || 0) - Number(left?.bar_time_unix || 0);
        if (timeDelta !== 0) return timeDelta;
        return String(right?.action_id || "").localeCompare(String(left?.action_id || ""));
      }),
    [activeEventLog],
  );
  const activeTotalRr = useMemo(() => {
    const totalPnl = Number(activeSummary?.total_pnl);
    if (!Number.isFinite(totalPnl) || !Number.isFinite(oneRValue) || oneRValue <= 0) {
      return null;
    }
    return totalPnl / oneRValue;
  }, [activeSummary?.total_pnl, oneRValue]);
  const selectedTradeIndex = useMemo(
    () =>
      sortedActiveTrades.findIndex(
        (trade) => String(trade?.sid || "") === String(selectedTrade?.sid || ""),
      ),
    [sortedActiveTrades, selectedTrade],
  );
  const pricePrecision = useMemo(
    () =>
      inferPricePrecision(
        activeRun?.symbol,
        sortedActiveTrades.flatMap((trade) => [
          trade?.entry,
          trade?.sl,
          trade?.tp,
          trade?.exit_price,
        ]),
      ),
    [activeRun?.symbol, sortedActiveTrades],
  );
  const selectedStrategyRuns = useMemo(
    () =>
      runs.filter((run) =>
        runMatchesStrategy(run, selectedExistingStrategy, form.strategy_key),
      ),
    [form.strategy_key, runs, selectedExistingStrategy],
  );
  const backtestReplayConfig = useMemo(
    () => ({
      enabled: true,
      playing: replayPlaying,
      speedMs: replaySpeedMs,
      pauseAfterEventMs: 0,
      speedOptions: REPLAY_SPEED_OPTIONS,
      runKey: selectedRunId || activeRun?.run_id || "",
      startTradeSid: String(
        replayStartTradeSid || selectedTrade?.sid || sortedActiveTrades[0]?.sid || "",
      ),
      currentTradeIndex: selectedTradeIndex,
      totalTrades: sortedActiveTrades.length,
      onSpeedChange: (nextSpeedMs) =>
        setReplaySpeedMs(Math.max(100, Number(nextSpeedMs) || 200)),
      onToggle: () => {
        setReplayPlaying((prev) => {
          const next = !prev;
          if (next) {
            const startSid = String(
              selectedTrade?.sid || sortedActiveTrades[0]?.sid || "",
            );
            setReplayStartTradeSid(startSid);
            setReplayActiveTradeSid(startSid);
          }
          return next;
        });
      },
      onComplete: () => setReplayPlaying(false),
    }),
    [
      activeRun?.run_id,
      replayPlaying,
      replayStartTradeSid,
      replaySpeedMs,
      selectedTradeIndex,
      selectedRunId,
      selectedTrade?.sid,
      sortedActiveTrades,
    ],
  );

  useEffect(() => {
    setReplayPlaying(false);
    setReplayStartTradeSid("");
    setReplayActiveTradeSid("");
    setReplayProgress(null);
  }, [selectedRunId]);

  useEffect(() => {
    if (selectedStrategyId === "__new__") return;
    const preferredId = String(selectedStrategyId || form.strategy_key || "").trim();
    const exists = allStrategies.some(
      (item) => String(item.key || item.id || "") === preferredId,
    );
    if (preferredId && exists) return;
    const fallbackId = String(
      form.strategy_key ||
        allStrategies[0]?.key ||
        allStrategies[0]?.id ||
        "",
    ).trim();
    if (fallbackId) setSelectedStrategyId(fallbackId);
  }, [allStrategies, form.strategy_key, selectedStrategyId]);

  useEffect(() => {
    if (!sortedActiveTrades.length) {
      setReplayPlaying(false);
      setReplayActiveTradeSid("");
      setReplayProgress(null);
      return;
    }
    if (!selectedTrade) {
        setSelectedTradeSid(String(sortedActiveTrades[0]?.sid || ""));
    }
  }, [sortedActiveTrades, selectedTrade]);

  useEffect(() => {
    if (replayPlaying) return;
    if (!replayActiveTradeSid) return;
    setSelectedTradeSid(String(replayActiveTradeSid));
    setReplayActiveTradeSid("");
  }, [replayActiveTradeSid, replayPlaying]);

  const summaryRangeText =
    replaySummary?.rangeLabel || activeSummaryRangeLabel || activeDataRangeLabel || "-";
  const summaryTradesCount =
    replaySummary ? replaySummary.totalTrades : activeSummary?.total_trades || 0;
  const summaryPnlValue = replaySummary ? replaySummary.totalPnl : activeSummary?.total_pnl;
  const summaryRrValue = replaySummary ? replaySummary.totalRr : activeTotalRr;
  const summaryWinRateValue =
    replaySummary ? replaySummary.winRate : activeSummary?.win_rate_pct || 0;

  useEffect(() => {
    if (!activeRun) return;
    setForm((prev) => deriveBacktestFormFromRun(activeRun, prev));
  }, [activeRun]);

  useEffect(() => {
    if (!ephemeralRunDetail) {
      setEphemeralRunSaveName("");
      return;
    }
    setEphemeralRunSaveName(buildEphemeralRunSaveName(ephemeralRunDetail));
  }, [ephemeralRunDetail]);

  async function handleRun(event) {
    event.preventDefault();
    setRunning(true);
    setError("");
    setReplayPlaying(false);
    setReplayStartTradeSid("");
    setReplayActiveTradeSid("");
    setEphemeralRunDetail(null);
    setEphemeralRunSaveName("");
    setSelectedRunDetail(null);
    setSelectedRunId("");
    setSelectedTradeSid("");
    navigate("/backtests");
    try {
      const payload = {
        ...form,
        symbol: form.symbol,
        limit: form.limit === "all" ? 0 : Number(form.limit || 500),
        direction: String(form.direction || "all").trim().toLowerCase(),
        session: String(form.session || "Any").trim() || "Any",
        persist: false,
      };
      const res = await api.runBacktest(payload);
      if (res) {
        setEphemeralRunDetail(res);
        setSelectedRunDetail(null);
        setSelectedRunId("");
        setEphemeralRunSaveName(buildEphemeralRunSaveName(res));
        navigate("/backtests");
        setSelectedTradeSid(pickInitialTradeSid(res?.trades));
      }
    } catch (runError) {
      setError(String(runError?.message || runError || "Backtest failed"));
    } finally {
      setRunning(false);
    }
  }

  async function handleSaveRun() {
    if (!ephemeralRunDetail) return;
    setSavingRun(true);
    setError("");
    try {
      const requestedRunId =
        String(ephemeralRunSaveName || "")
          .trim()
          .replace(/[^a-zA-Z0-9._ -]/g, "_") || buildEphemeralRunSaveName(ephemeralRunDetail);
      const res = await api.saveBacktest({
        ...ephemeralRunDetail,
        run: {
          ...(ephemeralRunDetail.run || {}),
          run_id: requestedRunId,
        },
      });
      const runId = String(res?.run?.run_id || "");
      setEphemeralRunDetail(null);
      setEphemeralRunSaveName("");
      await loadRuns(runId);
      if (runId) {
        setSelectedRunId(runId);
        navigate(`/backtests/${encodeURIComponent(runId)}`);
      }
      if (res) {
        setSelectedRunDetail(res);
        setSelectedTradeSid(pickInitialTradeSid(res?.trades));
      }
    } catch (saveError) {
      setError(String(saveError?.message || saveError || "Failed to save backtest"));
    } finally {
      setSavingRun(false);
    }
  }

  async function handleDeleteRun(run) {
    const runId = String(run?.run_id || "").trim();
    if (!runId) return;
    const ok = await confirm({
      title: "Delete backtest?",
      message: `Delete ${run.strategy_name || run.strategy_key || "this backtest"}?`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    setError("");
    try {
      await api.deleteBacktest(runId);
      if (selectedRunId === runId) {
        setSelectedRunId("");
        setSelectedRunDetail(null);
        setSelectedTradeSid("");
        navigate("/backtests");
      }
      await loadRuns("");
    } catch (deleteError) {
      setError(String(deleteError?.message || deleteError || "Failed to delete backtest"));
    }
  }

  function handleStrategySelect(strategyId) {
    const nextId = String(strategyId || "").trim();
    if (!nextId) return;
    setDraftStrategySeed(null);
    setSelectedStrategyId(nextId);
    setForm((prev) => ({ ...prev, strategy_key: nextId }));
  }

  function handleCreateStrategyDraft() {
    const draft = buildNewStrategyDraft(strategyExample, {
      symbol: form.symbol,
      tf: form.tf,
    });
    setDraftStrategySeed(draft);
    setSelectedStrategyId("__new__");
    setActiveTab("strategies");
  }

  async function handleSaveStrategy(payload) {
    const sourceId = String(
      payload?.id || payload?.key || selectedStrategyId || "",
    ).trim();
    const existingCustom = customStrategies.find((item) => {
      const itemId = String(item?.id || item?.key || "").trim();
      return (
        itemId &&
        itemId === sourceId &&
        String(item?.kind || "").trim() === "custom"
      );
    });
    const result = existingCustom
      ? await api.updateStrategy(sourceId, payload)
      : await api.saveStrategy(payload);
    const item = result?.item || payload;
    await Promise.all([
      loadStrategyCatalog(),
      loadRuns(selectedRunId),
    ]);
    setDraftStrategySeed(null);
    setSelectedStrategyId(String(item?.id || sourceId || ""));
    if (item?.id) {
      setForm((prev) => ({ ...prev, strategy_key: String(item.id) }));
    }
    return item;
  }

  async function handleSaveAsStrategy(payload) {
    const nextPayload = buildStrategySaveAsPayload(payload);
    const result = await api.saveStrategy(nextPayload);
    const item = result?.item || nextPayload;
    await Promise.all([
      loadStrategyCatalog(),
      loadRuns(selectedRunId),
    ]);
    setDraftStrategySeed(null);
    setSelectedStrategyId(String(item?.id || nextPayload.id || ""));
    if (item?.id) {
      setForm((prev) => ({ ...prev, strategy_key: String(item.id) }));
    }
    return item;
  }

  async function handleArchiveStrategy(strategyId) {
    const result = await api.archiveStrategy(strategyId);
    await Promise.all([
      loadStrategyCatalog(),
      loadRuns(selectedRunId),
    ]);
    return result?.item || null;
  }

  async function handleDeleteStrategy(strategyId) {
    await api.deleteStrategy(strategyId);
    await Promise.all([
      loadStrategyCatalog(),
      loadRuns(selectedRunId),
    ]);
    const fallbackId = String(form.strategy_key || strategyOptions[0]?.key || "").trim();
    setDraftStrategySeed(null);
    setSelectedStrategyId(fallbackId);
  }

  const runnerControls = (
    <form onSubmit={handleRun}>
      <div className="stack-layout" style={{ gap: 12 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
        >
          <label className="stack-layout" style={{ gap: 5 }}>
            <span className="minor-text">Strategy</span>
            <FormComboSelect
              value={form.strategy_key}
              searchable
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  strategy_key: event.target.value,
                }))
              }
            >
              {strategyOptions.map((item) => (
                <option
                  key={`${String(item.key || item.id || "strategy").trim() || "strategy"}:${String(item.kind || item.status || "item").trim()}:${String(item.name || "").trim()}`}
                  value={item.key || item.id}
                >
                  {item.name || item.key || item.id}
                </option>
              ))}
            </FormComboSelect>
          </label>

          <label className="stack-layout" style={{ gap: 5 }}>
            <span className="minor-text">Symbols</span>
            <FormComboSelect
              value={form.symbol}
              searchable
              searchPlaceholder="Filter symbol..."
              onChange={(event) =>
                setForm((prev) => ({ ...prev, symbol: event.target.value }))
              }
            >
              {symbolOptions.map((symbol) => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </FormComboSelect>
          </label>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 10,
          }}
        >
          <label className="stack-layout" style={{ gap: 5 }}>
            <span className="minor-text">Timeframe</span>
            <FormComboSelect
              value={form.tf}
              searchable
              onChange={(event) =>
                setForm((prev) => ({ ...prev, tf: event.target.value }))
              }
            >
              {TIMEFRAME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </FormComboSelect>
          </label>
          <label className="stack-layout" style={{ gap: 5 }}>
            <span className="minor-text">Bars</span>
            <FormComboSelect
              value={form.limit}
              searchable
              onChange={(event) =>
                setForm((prev) => ({ ...prev, limit: event.target.value }))
              }
            >
              {BARS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </FormComboSelect>
          </label>
          <label className="stack-layout" style={{ gap: 5 }}>
            <span className="minor-text">1R ($)</span>
            <input
              type="number"
              min="1"
              step="1"
              value={form.one_r_value}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  one_r_value: event.target.value,
                }))
              }
              className="text-input"
              placeholder="100"
            />
          </label>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
        >
          <label className="stack-layout" style={{ gap: 5 }}>
            <span className="minor-text">Sessions</span>
            <FormComboSelect
              value={form.session || "Any"}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, session: event.target.value }))
              }
            >
              {BACKTEST_SESSION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </FormComboSelect>
          </label>
          <label className="stack-layout" style={{ gap: 5 }}>
            <span className="minor-text">Direction</span>
            <FormComboSelect
              value={form.direction || "all"}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, direction: event.target.value }))
              }
            >
              {BACKTEST_DIRECTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </FormComboSelect>
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
          <button
            type="submit"
            className="primary-button"
            disabled={running || !form.symbol}
            style={{ flex: "1 1 auto" }}
          >
            {running ? "Running..." : "Run Backtest"}
          </button>
        </div>
      </div>
    </form>
  );

  const runList = (
    <div className="stack-layout" style={{ gap: 8 }}>
      {runs.length ? (
        runs.map((run) => {
          const isActive = selectedRunId === run.run_id;
	          const pnl = Number(run?.summary?.total_pnl || 0);
	          const openRun = () => {
	            setEphemeralRunDetail(null);
	            setSelectedRunId(run.run_id);
	            navigate(`/backtests/${encodeURIComponent(run.run_id)}`);
	          };
          return (
            <div
              key={run.run_id}
              role="button"
              tabIndex={0}
              className="secondary-button"
              onClick={openRun}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                openRun();
              }}
              style={{
                textAlign: "left",
                justifyContent: "flex-start",
                padding: 10,
                minHeight: 0,
                borderColor: isActive ? "var(--accent)" : "var(--border)",
                background: isActive ? "var(--accent-soft)" : "transparent",
              }}
            >
              <div className="stack-layout" style={{ gap: 2, width: "100%" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      minWidth: 0,
                      flex: "1 1 auto",
                      fontSize: 12,
                      fontWeight: 850,
                      lineHeight: 1.2,
                    }}
                  >
                    {run.strategy_name || run.strategy_key} - {timeframeLabel(run.tf)} -{" "}
                    {run.symbol || "-"}
                  </div>
                  <div
                    style={{
                      flex: "0 0 auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveTab("backtest");
                        openRun();
                      }}
                      style={{ minHeight: 24, padding: "0 8px", fontSize: 10 }}
                    >
                      &gt;&gt;
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={async (event) => {
                        event.stopPropagation();
                        await handleDeleteRun(run);
                      }}
                      style={{ minHeight: 24, padding: "0 8px", fontSize: 10 }}
                      title="Delete backtest"
                    >
                      X
                    </button>
                  </div>
                </div>
                <div
                  className="minor-text"
                  style={{
                    fontSize: 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "nowrap",
                    minWidth: 0,
                  }}
                >
                  <span>{Number(run?.summary?.total_trades || 0)} trades</span>
                  <span>
                    PnL{" "}
                    <span style={{ fontWeight: 700, color: pnl >= 0 ? "#10b981" : "#ef4444" }}>
                      {`${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}`}
                    </span>
                  </span>
                  <span>
                    RR{" "}
                    <span style={{ fontWeight: 700 }}>
                      {Number.isFinite(oneRValue) && oneRValue > 0
                        ? formatNumber(pnl / oneRValue, 2)
                        : "-"}
                    </span>
                  </span>
                  <span>WR {formatNumber(run?.summary?.win_rate_pct || 0, 0)}%</span>
                </div>
              </div>
            </div>
          );
        })
      ) : (
        <div className="empty-state">No backtest runs yet.</div>
      )}
    </div>
  );

  const strategiesList = (
    <div className="stack-layout" style={{ gap: 8 }}>
      {allStrategies.map((item) => {
        const id = item.key || item.id;
        const active = String(selectedStrategyId || form.strategy_key || "") === String(id || "");
        const sourceMeta = strategySourceMeta(item);
        return (
          <button
            key={`${String(id || "strategy").trim() || "strategy"}:${String(item.kind || item.status || "item").trim()}:${String(item.name || "").trim()}`}
            type="button"
            className="secondary-button"
            onClick={async () => {
              handleStrategySelect(id);
            }}
            style={{
              textAlign: "left",
              justifyContent: "flex-start",
              minHeight: 56,
              padding: 10,
              borderColor: active ? "var(--accent)" : "var(--border)",
              background: active ? "var(--accent-soft)" : "transparent",
            }}
          >
            <div className="stack-layout" style={{ gap: 2, width: "100%" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 32,
                    padding: "2px 6px",
                    borderRadius: 999,
                    fontSize: 9,
                    fontWeight: 900,
                    letterSpacing: "0.08em",
                    color: sourceMeta.color,
                    background: sourceMeta.background,
                    border: `1px solid ${sourceMeta.border}`,
                    flex: "0 0 auto",
                  }}
                  title={sourceMeta.text}
                >
                  {sourceMeta.badge}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 850,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={item.name || id}
                >
                  {item.name || id}
                </span>
              </div>
              <div
                className="minor-text"
                style={{ fontSize: 10, display: "flex", gap: 8, alignItems: "center" }}
              >
                <span>{id}</span>
                <span>{sourceMeta.text}</span>
                <span>{item.status || item.kind || "built-in"}</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );

  const leftPanelBody = (
    <div className="stack-layout" style={{ gap: 14 }}>
      {activeTab === "backtest" ? (
        <>
          <ResponsivePanel
            showToggle={false}
            border="always"
            bodyClassName="stack-layout"
          >
            {runnerControls}
          </ResponsivePanel>
          <ResponsivePanel
            headerContent={
              ephemeralRunDetail ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                  }}
                >
                  <input
                    type="text"
                    value={ephemeralRunSaveName}
                    onChange={(event) => setEphemeralRunSaveName(event.target.value)}
                    className="text-input"
                    placeholder="Backtest name"
                    style={{ flex: "1 1 auto", minWidth: 0 }}
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={savingRun}
                    onClick={handleSaveRun}
                    style={{ minHeight: 32, padding: "0 10px", fontSize: 11, flex: "0 0 auto" }}
                  >
                    {savingRun ? "Saving..." : "Save"}
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                  }}
                >
                  <FormComboSelect
                    value={selectedRunId || ""}
	                  onChange={(event) => {
	                    const nextRunId = String(event.target.value || "").trim();
	                    if (!nextRunId) return;
	                    setEphemeralRunDetail(null);
	                    setSelectedRunId(nextRunId);
	                    navigate(`/backtests/${encodeURIComponent(nextRunId)}`);
	                  }}
                    searchable
                    searchPlaceholder="Filter strategy runs..."
                    style={{ flex: "1 1 auto", minWidth: 0 }}
                  >
                    {selectedStrategyRuns.map((run) => (
                      <option key={run.run_id} value={run.run_id}>
                        {formatRunSelectorLabel(run)}
                      </option>
                    ))}
                  </FormComboSelect>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setActiveTab("history")}
                    style={{ minHeight: 32, padding: "0 10px", fontSize: 11, flex: "0 0 auto" }}
                    title="Open History tab"
                  >
                    &gt;&gt;
                  </button>
                </div>
              )
            }
            showToggle={false}
            border="always"
            bodyClassName="stack-layout"
          >
            {activeRun ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "nowrap",
                    minWidth: 0,
                  }}
                >
                  <div
                    className="minor-text"
                    style={{
                      flex: "1 1 auto",
                      minWidth: 0,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={`${activeRun.strategy_name || activeRun.strategy_key} · ${timeframeLabel(activeRun.tf)} · ${activeRun.symbol || "-"} · ${Math.round(Number(summaryTradesCount || 0))} trades${summaryRangeText ? ` · ${summaryRangeText}` : ""}`}
                  >
                    {summaryRangeText} | {Math.round(Number(summaryTradesCount || 0))} trades
                  </div>
                  <div
                    className="minor-text"
                    style={{
                      flex: "0 0 auto",
                      whiteSpace: "nowrap",
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      fontSize: 10,
                    }}
                  >
                    <MetricValue
                      type="pnl"
                      value={summaryPnlValue}
                      digits={0}
                      className=""
                      strong={false}
                    />
                    <span title={`Total RR using 1R = $${oneRValue.toFixed(0)}`}>
                      {summaryRrValue != null ? `${formatNumber(summaryRrValue, 1)}rr` : "-"}
                    </span>
                    <span>{`${formatWholeNumber(summaryWinRateValue)}%`}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state">
                {loadingRuns ? "Loading strategy runs..." : "No strategy runs found."}
              </div>
            )}
          </ResponsivePanel>
          <ResponsivePanel
            showToggle={false}
            border="always"
            bodyClassName="stack-layout"
          >
            {activeRun && sortedActiveTrades.length ? (
              <div
                style={{
                  maxHeight: 700,
                  overflowY: "auto",
                  overflowX: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  paddingRight: 4,
                }}
              >
                {sortedActiveTrades.map((trade) => (
                  <TradeListCard
                    key={trade.sid}
                    trade={trade}
                    symbol={activeRun?.symbol}
                    active={trade?.sid === selectedTrade?.sid}
                    onClick={() => setSelectedTradeSid(String(trade?.sid || ""))}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                {activeRun ? "No trades found for this run." : "Select a run to inspect trades."}
              </div>
            )}
          </ResponsivePanel>
        </>
      ) : null}
      {activeTab === "history" ? (
        <div className="stack-layout" style={{ gap: 8 }}>
          {runList}
        </div>
      ) : null}
      {activeTab === "strategies" ? (
        <div className="stack-layout" style={{ gap: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div className="panel-label">
              STRATEGIES ({allStrategies.length})
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={handleCreateStrategyDraft}
              style={{ minHeight: 28, padding: "0 10px", fontSize: 11 }}
            >
              + Custom
            </button>
          </div>
          {strategiesList}
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="stack-layout fadeIn" style={{ paddingBottom: 40 }}>
      <PageHeader title="BACKTESTS" />

      {error ? (
        <div className="toolbar-panel">
          <div className="minor-text msg-error">{error}</div>
        </div>
      ) : null}

      <MasterDetailLayout sidebarWidth={360} gap={18}>
        <ResponsivePanel
          headerContent={
            <TabBar
              value={activeTab}
              options={LEFT_TABS}
              onChange={(nextValue) => setActiveTab(nextValue || "backtest")}
              size="sm"
              ariaLabel="Backtest left panel tabs"
              style={{ width: "100%" }}
            />
          }
          showToggle={false}
          border="always"
          bodyClassName="stack-layout"
          style={{ minHeight: 720 }}
        >
          {leftPanelBody}
        </ResponsivePanel>

        <div style={{ minHeight: 720, minWidth: 0 }}>
              {activeTab === "strategies" ? (
                <StrategyEditorPanel
                  strategy={selectedStrategy}
                  selectionKey={
                    selectedStrategyId === "__new__"
                      ? `new:${draftStrategySeed?.id || "draft"}`
                      : String(selectedStrategy?.id || selectedStrategy?.key || "strategy")
                  }
                  exampleStrategy={strategyExample}
                  defaultSymbol={form.symbol}
                  defaultTf={form.tf}
                  isNewDraft={selectedStrategyId === "__new__"}
                  onCreateNew={handleCreateStrategyDraft}
                  onSave={handleSaveStrategy}
                  onSaveAs={handleSaveAsStrategy}
                  onArchive={handleArchiveStrategy}
                  onDelete={handleDeleteStrategy}
                />
              ) : !activeRun ? (
                <div className="empty-state">SELECT A RUN TO INSPECT DETAILS</div>
              ) : (
                <div className="stack-layout" style={{ gap: 14 }}>
                  <SymbolChart
                    symbol={activeRun.symbol}
                    timeframes={[activeRun.tf]}
                    defaultMode="cache"
                    initialGridCols={1}
                    initialBarsCount={1000}
                    provider="ICMARKETS"
                    skipFetch={false}
                    autoLoadOnMount
                    showAnalyzeButton={false}
                    showTradeButton={true}
                    showSnapshotButton={true}
                    showEditButton={false}
                    showPerCardLayoutControls={false}
                    fillViewportForFourCharts={false}
                    tradeSid={selectedTrade?.sid || ""}
                    hasTradePlan={Boolean(selectedTrade)}
                    showEventMarkers={Boolean(selectedTrade)}
                    side={selectedTrade?.action || ""}
                    action={selectedTrade?.action || ""}
                    entryPrice={selectedTrade?.entry || null}
                    slPrice={selectedTrade?.sl || null}
                    tpPrice={selectedTrade?.tp || null}
                    createdAt={
                      selectedTrade?.created_at ||
                      selectedTrade?.signal_bar_time ||
                      selectedTrade?.opened_at ||
                      null
                    }
                    openedAt={selectedTrade?.opened_at || null}
                    closedAt={selectedTrade?.closed_at || null}
                    closeStatus={selectedTrade?.execution_status || ""}
                    exitPrice={selectedTrade?.exit_price || null}
                    pnlRealized={selectedTrade?.pnl_realized || null}
                    tradeLabel={
                      activeRun?.strategy_name || activeRun?.strategy_key || ""
                    }
                    trades={sortedActiveTrades}
                    animateTradeViewport
                    anchorToTradeTime={true}
                    onReplayActiveTradeChange={(tradeSid) => {
                      if (!tradeSid) return;
                      setReplayActiveTradeSid(String(tradeSid));
                    }}
                    onReplayProgressChange={setReplayProgress}
                    backtestReplay={backtestReplayConfig}
                  />
                  <ResponsivePanel
                    title="Event Log"
                    subtitle={
                      sortedActiveEventLog.length
                        ? `${sortedActiveEventLog.length} triggered actions`
                        : "No events triggered in this run."
                    }
                    showToggle={false}
                    border="always"
                    bodyClassName="stack-layout"
                  >
                    {sortedActiveEventLog.length ? (
                      <div
                        style={{
                          maxHeight: 320,
                          overflowY: "auto",
                          overflowX: "hidden",
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          paddingRight: 4,
                        }}
                      >
                        {sortedActiveEventLog.map((entry, index) => (
                          <div
                            key={`${entry?.event_id || "event"}_${entry?.action_id || "action"}_${entry?.bar_index ?? index}`}
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: 10,
                              padding: 10,
                              background: "rgba(255,255,255,0.02)",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 8,
                                flexWrap: "wrap",
                              }}
                            >
                              <div style={{ fontSize: 12, fontWeight: 800 }}>
                                {entry?.event_name || entry?.event_id || "Event"}
                              </div>
                              <div className="minor-text" style={{ fontSize: 10 }}>
                                {showDateTime(entry?.bar_time) || "-"}
                              </div>
                            </div>
                            <div
                              className="minor-text"
                              style={{
                                display: "flex",
                                gap: 10,
                                flexWrap: "wrap",
                                marginTop: 6,
                                fontSize: 11,
                              }}
                            >
                              <span>{formatActionTypeLabel(entry?.action_type)}</span>
                              <span>Bar #{Number(entry?.bar_index ?? 0) + 1}</span>
                              <span>Close {formatNumber(entry?.bar_close, pricePrecision)}</span>
                            </div>
                            {entry?.message ? (
                              <div className="minor-text" style={{ marginTop: 6, fontSize: 11 }}>
                                {entry.message}
                              </div>
                            ) : null}
                            {entry?.url ? (
                              <div className="minor-text" style={{ marginTop: 4, fontSize: 10 }}>
                                {entry.method || "POST"} {entry.url}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state">
                        No triggered events to review yet.
                      </div>
                    )}
                  </ResponsivePanel>
                </div>
              )}
            </div>
        </MasterDetailLayout>
    </section>
  );
}
