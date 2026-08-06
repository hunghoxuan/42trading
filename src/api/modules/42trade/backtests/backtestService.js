"use strict";

const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const { createConfigStore } = require("../../../shared/config/configStore");
const barsStorage = require("../marketData/marketDataRepo");
const strategyConfigService = require("../strategies/strategyConfigService");
const objectStore = require("../../../shared/objects/objectStoreRepo");
const {
  createStrategyScanEngine,
} = require("../../../../shared/utils/strategyScanEngine.cjs");
const {
  evaluateRuleExpression,
} = require("../../../../shared/rules-engine/index.cjs");
const {
  evaluateStrategies,
} = require("../../../../shared/strategy-engine/index.cjs");
const { normalizeSymbolList } = require("../../../../config/symbolGroups.cjs");
const sharedArtifactDetection = require("../../../../shared/rules-engine/features/detectArtifacts.cjs");
const strategyEventFunctions = require("../../../../shared/rules-engine/features/strategyEventFunctions.cjs");
const {
  evaluateChartStrategies,
} = require("../../../../shared/utils/chartStrategyChecks.cjs");
const { safePathPart, userRootDir } = objectStore;

const BACKTESTS_DIRNAME = "backtests";
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const DEFAULT_BATCH_TIMEFRAMES = Object.freeze(["1440", "240", "15", "5"]);
const configStore = createConfigStore();
const CTRADER_DOWNSTREAM_URL = String(
  process.env.CTRADER_DOWNSTREAM_URL ||
    (process.env.CTRADER_EXECUTOR_URL || "").replace(/\/execute\/?$/, ""),
).trim();
const CTRADER_DOWNSTREAM_API_KEY = String(
  process.env.CTRADER_DOWNSTREAM_API_KEY ||
    process.env.CTRADER_EXECUTOR_API_KEY ||
    "",
).trim();
const CTRADER_DOWNSTREAM_ACCOUNT_ID = String(
  process.env.CTRADER_ACCOUNT_ID || "",
).trim();

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
}

async function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await fsp.rename(tmpPath, filePath);
}

async function readJsonFile(filePath, fallback = null) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    const sanitized =
      typeof raw === "string" && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return JSON.parse(sanitized);
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return "null";
}

function sha1Hex(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

async function loadBuiltInStrategies() {
  const rows = await configStore.listStrategies();
  return rows
    .filter((item) => item && typeof item === "object")
    .map((parsed) => ({
      kind: "preset",
      ...parsed,
      events: Array.isArray(parsed?.events)
        ? parsed.events
        : normalizeStrategyEventsForSimulation(parsed),
    }))
    .map((item) => ({ ...item }));
}

async function listStrategies() {
  return loadBuiltInStrategies();
}

async function findStrategy(strategyKey = "ema_cross_v1") {
  const strategies = await loadBuiltInStrategies();
  return (
    strategies.find((item) => item.key === String(strategyKey || "").trim()) ||
    strategies[0] ||
    null
  );
}

function strategySummaryKeyForItem(strategy = {}) {
  return String(strategy?.key || strategy?.id || "").trim();
}

function strategySummaryKeyForRun(run = {}) {
  return String(run?.strategy_key || run?.strategy_id || "").trim();
}

function normalizeStrategySnapshotForFingerprint(snapshot = {}) {
  return {
    engine_version: snapshot?.engine_version || null,
    market: snapshot?.market || {},
    params: snapshot?.params || {},
    indicators: Array.isArray(snapshot?.indicators) ? snapshot.indicators : [],
    events: Array.isArray(snapshot?.events) ? snapshot.events : [],
    rules: snapshot?.rules || {},
    risk: snapshot?.risk || {},
  };
}

function buildRunDatasetFingerprint(run = {}, summary = {}) {
  return sha1Hex(
    stableStringify({
      symbol: String(run?.symbol || "").trim().toUpperCase(),
      tf: String(run?.tf || "").trim(),
      first_bar_at: summary?.first_bar_at || null,
      last_bar_at: summary?.last_bar_at || null,
      bars_analyzed: Number(summary?.bars_analyzed || 0) || 0,
      limit: Number(run?.limit || 0) || 0,
      market_data_quality: run?.market_data_quality || summary?.market_data_quality || {},
    }),
  );
}

function buildRunExecutionFingerprint(run = {}) {
  return sha1Hex(
    stableStringify({
      direction: normalizeBacktestDirection(run?.direction, "all"),
      session: normalizeBacktestSession(run?.session, "Any"),
      broker_calibration: run?.broker_calibration || {},
      execution_options: run?.execution_options || {},
    }),
  );
}

function buildRunStrategyFingerprint(run = {}) {
  const snapshot =
    run?.strategy_snapshot && typeof run.strategy_snapshot === "object"
      ? run.strategy_snapshot
      : {
          key: run?.strategy_key || null,
          id: run?.strategy_id || null,
          name: run?.strategy_name || null,
        };
  return sha1Hex(stableStringify(normalizeStrategySnapshotForFingerprint(snapshot)));
}

function toTimestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function preferLaterRecord(left, right) {
  const leftTime =
    toTimestampMs(left?.run?.updated_at) ||
    toTimestampMs(left?.run?.completed_at) ||
    toTimestampMs(left?.run?.started_at) ||
    0;
  const rightTime =
    toTimestampMs(right?.run?.updated_at) ||
    toTimestampMs(right?.run?.completed_at) ||
    toTimestampMs(right?.run?.started_at) ||
    0;
  return rightTime >= leftTime ? right : left;
}

function summarizeStrategyBacktestRecords(records = []) {
  const rawRuns = Array.isArray(records) ? records.filter((record) => record?.run) : [];
  if (!rawRuns.length) return null;
  const grouped = new Map();
  for (const record of rawRuns) {
    const run = record?.run || {};
    const summary =
      record?.summary && typeof record.summary === "object"
        ? record.summary
        : run.summary && typeof run.summary === "object"
          ? run.summary
          : {};
    const key = [
      buildRunStrategyFingerprint(run),
      buildRunDatasetFingerprint(run, summary),
      buildRunExecutionFingerprint(run),
    ].join("|");
    const current = grouped.get(key);
    grouped.set(key, current ? preferLaterRecord(current, record) : record);
  }
  const uniqueRecords = Array.from(grouped.values());
  const latestRecord = uniqueRecords.reduce((best, current) => {
    if (!best) return current;
    return preferLaterRecord(best, current);
  }, null);
  const numericSummaries = uniqueRecords.map((record) => {
    const run = record?.run || {};
    const summary =
      record?.summary && typeof record.summary === "object"
        ? record.summary
        : run.summary && typeof run.summary === "object"
          ? run.summary
          : {};
    return { run, summary };
  });
  const totalTrades = numericSummaries.reduce(
    (sum, item) => sum + (Number(item.summary?.total_trades || 0) || 0),
    0,
  );
  const totalPnl = numericSummaries.reduce(
    (sum, item) => sum + (Number(item.summary?.total_pnl || 0) || 0),
    0,
  );
  const totalR = numericSummaries.reduce(
    (sum, item) => sum + (Number(item.summary?.total_r || 0) || 0),
    0,
  );
  const winRates = numericSummaries
    .map((item) => Number(item.summary?.win_rate_pct))
    .filter(Number.isFinite);
  const avgWinRate = winRates.length
    ? winRates.reduce((sum, value) => sum + value, 0) / winRates.length
    : 0;
  const weightedWinRate = totalTrades > 0
    ? numericSummaries.reduce((sum, item) => {
        const trades = Number(item.summary?.total_trades || 0) || 0;
        const winRate = Number(item.summary?.win_rate_pct);
        return Number.isFinite(winRate) ? sum + trades * winRate : sum;
      }, 0) / totalTrades
    : avgWinRate;
  const runPnlValues = numericSummaries
    .map((item) => Number(item.summary?.total_pnl))
    .filter(Number.isFinite);
  const startedTimes = numericSummaries
    .map((item) =>
      toTimestampMs(item.run?.started_at) ||
      toTimestampMs(item.run?.created_at) ||
      toTimestampMs(item.run?.updated_at) ||
      toTimestampMs(item.run?.completed_at),
    )
    .filter(Boolean);
  const completedTimes = numericSummaries
    .map((item) =>
      toTimestampMs(item.run?.completed_at) ||
      toTimestampMs(item.run?.updated_at) ||
      toTimestampMs(item.run?.started_at) ||
      toTimestampMs(item.run?.created_at),
    )
    .filter(Boolean);
  const firstBarTimes = numericSummaries
    .map((item) => toTimestampMs(item.summary?.first_bar_at))
    .filter(Boolean);
  const lastBarTimes = numericSummaries
    .map((item) => toTimestampMs(item.summary?.last_bar_at))
    .filter(Boolean);
  const latestRun = latestRecord?.run || {};
  const latestCompletedAt =
    toTimestampMs(latestRun?.completed_at) ||
    toTimestampMs(latestRun?.updated_at) ||
    toTimestampMs(latestRun?.started_at) ||
    toTimestampMs(latestRun?.created_at);

  return {
    raw_runs: rawRuns.length,
    unique_runs: uniqueRecords.length,
    duplicate_runs: Math.max(0, rawRuns.length - uniqueRecords.length),
    run_count: uniqueRecords.length,
    history_runs: rawRuns.length,
    first_backtested_at: startedTimes.length ? new Date(Math.min(...startedTimes)).toISOString() : null,
    last_backtested_at: completedTimes.length ? new Date(Math.max(...completedTimes)).toISOString() : null,
    earliest_data_start_at: firstBarTimes.length ? new Date(Math.min(...firstBarTimes)).toISOString() : null,
    latest_data_start_at: firstBarTimes.length ? new Date(Math.max(...firstBarTimes)).toISOString() : null,
    earliest_data_end_at: lastBarTimes.length ? new Date(Math.min(...lastBarTimes)).toISOString() : null,
    latest_data_end_at: lastBarTimes.length ? new Date(Math.max(...lastBarTimes)).toISOString() : null,
    avg_win_rate_pct: round(avgWinRate, 2),
    weighted_win_rate_pct: round(weightedWinRate, 2),
    total_trades: Number.isFinite(totalTrades) ? totalTrades : 0,
    total_pnl: Number.isFinite(totalPnl) ? round(totalPnl, 5) : 0,
    total_r: Number.isFinite(totalR) ? round(totalR, 5) : 0,
    best_run_pnl: runPnlValues.length ? round(Math.max(...runPnlValues), 5) : null,
    worst_run_pnl: runPnlValues.length ? round(Math.min(...runPnlValues), 5) : null,
    last_run_id: String(latestRun?.run_id || "").trim() || null,
    last_run_at: latestCompletedAt ? new Date(latestCompletedAt).toISOString() : null,
    latest_only: false,
    dedupe_version: 2,
  };
}

async function listAvailableStrategies(userId, options = {}) {
  const customStrategies = await strategyConfigService.listStrategies(userId).catch(
    () => [],
  );
  const customRows = customStrategies.map((strategy) => ({
    key: strategy.id,
    id: strategy.id,
    name: strategy.name,
    description: strategy.description || "",
    kind: strategy.kind || "custom",
    status: strategy.status || "draft",
    engine_version: strategy.engine_version || "42trade.strategy.v2",
    params: strategy.params || {},
    market: strategy.market || {},
    indicators: strategy.indicators || [],
    events: Array.isArray(strategy.events)
      ? strategy.events
      : normalizeStrategyEventsForSimulation(strategy),
    rules: Array.isArray(strategy.rules) ? strategy.rules : strategy.rules || [],
    risk: strategy.risk || {},
  }));
  const records = Array.isArray(options.records)
    ? options.records
    : await listPersistedBacktestRecords(userId);
  const summaryIndex = buildBacktestSummaryIndex(records);
  return attachBacktestSummaryToStrategies(
    [...(await listStrategies()), ...customRows],
    summaryIndex,
  );
}

function makeRunId() {
  return `bt-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function makeTradeSid(runId, index) {
  const suffix = crypto
    .createHash("sha1")
    .update(`${runId}:${index}`)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  return `BT${suffix}`;
}

function backtestsRoot(userId) {
  return path.join(userRootDir(userId), BACKTESTS_DIRNAME);
}

function strategyRoot(userId, strategyKey) {
  return path.join(userRootDir(userId), "strategies", safePathPart(strategyKey));
}

function strategyRunsRoot(userId, strategyKey) {
  return path.join(strategyRoot(userId, strategyKey), "runs");
}

function backtestRunDir(userId, runId) {
  return path.join(backtestsRoot(userId), safePathPart(runId));
}

function strategyBacktestRunDir(userId, strategyKey, runId) {
  return path.join(strategyRunsRoot(userId, strategyKey), safePathPart(runId));
}

function toIsoFromUnixSeconds(unixSeconds) {
  return new Date(Number(unixSeconds || 0) * 1000).toISOString();
}

function round(value, digits = 5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const scale = 10 ** digits;
  return Math.round(num * scale) / scale;
}

function asFiniteNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asOptionalFiniteNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  return asFiniteNumber(value, fallback);
}

function roundMoney(value) {
  return round(value, 2);
}

function normalizeSymbolKey(value = "") {
  return String(value || "").trim().toUpperCase();
}

function normalizeExecutionMetadata(input = {}, fallback = {}) {
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
  const data = raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
    ? raw.data
    : raw;
  const symbol = normalizeSymbolKey(data.symbol || fallback.symbol);
  if (!symbol) return null;
  const pipSize = asOptionalFiniteNumber(data.pip_size ?? data.pipSize, null);
  const spreadPips = asOptionalFiniteNumber(data.spread_pips ?? data.spreadPips ?? data.spread, null);
  const minStopPips = asOptionalFiniteNumber(data.min_stop_pips ?? data.minStopPips, null);
  const maxStopPips = asOptionalFiniteNumber(data.max_stop_pips ?? data.maxStopPips, null);
  return {
    provider: String(data.provider || fallback.provider || "").trim() || null,
    account_id: String(data.account_id || fallback.account_id || "").trim() || null,
    symbol,
    broker_symbol: normalizeSymbolKey(data.broker_symbol || data.brokerSymbol || symbol),
    pip_size: pipSize,
    pip_value: asOptionalFiniteNumber(data.pip_value ?? data.pipValue, null),
    lot_size: asOptionalFiniteNumber(data.lot_size ?? data.lotSize, null),
    min_volume_units: asOptionalFiniteNumber(data.min_volume_units ?? data.minVolumeUnits, null),
    max_volume_units: asOptionalFiniteNumber(data.max_volume_units ?? data.maxVolumeUnits, null),
    volume_step_units: asOptionalFiniteNumber(
      data.volume_step_units ?? data.step_volume_units ?? data.volumeStepUnits,
      null,
    ),
    min_stop_pips: minStopPips,
    min_stop_price_distance: asOptionalFiniteNumber(
      data.min_stop_price_distance ?? data.minStopPriceDistance,
      pipSize && minStopPips ? pipSize * minStopPips : null,
    ),
    max_stop_pips: maxStopPips,
    max_stop_price_distance: asOptionalFiniteNumber(
      data.max_stop_price_distance ?? data.maxStopPriceDistance,
      pipSize && maxStopPips ? pipSize * maxStopPips : null,
    ),
    spread_pips: spreadPips,
    spread:
      pipSize && spreadPips != null
        ? pipSize * spreadPips
        : asOptionalFiniteNumber(data.spread_abs ?? data.spreadAbs, null),
    commission_per_lot: asOptionalFiniteNumber(
      data.commission_per_lot ?? data.commissionPerLot,
      null,
    ),
    source: String(data.source || fallback.source || "").trim() || null,
    updated_at: data.updated_at || raw.updated_at || null,
  };
}

async function loadMarketExecutionMetadata(userId, symbol) {
  const symbolKey = normalizeSymbolKey(symbol);
  if (!symbolKey) return null;
  const candidates = [];
  const userDir = userRootDir(userId);
  const runtimeDir = path.join(userDir, "broker_symbol_metadata__runtime");
  try {
    const entries = await fsp.readdir(runtimeDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const objectId = String(entry.name || "");
      if (!objectId.toUpperCase().endsWith(`__${symbolKey}`)) continue;
      const parsed = await readJsonFile(path.join(runtimeDir, entry.name, "data.json"), null);
      const normalized = normalizeExecutionMetadata(parsed, {
        symbol: symbolKey,
        source: "broker_symbol_metadata__runtime",
      });
      if (normalized) candidates.push(normalized);
    }
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }

  const tfMetadataRoot = path.join(
    barsStorage.getDataRoot ? barsStorage.getDataRoot() : path.resolve(__dirname, "..", "..", "..", "..", "..", "data"),
    "market_data",
    symbolKey,
    "metadata",
  );
  for (const fileName of ["broker.json", "symbol.json", "calibration.json"]) {
    const parsed = await readJsonFile(path.join(tfMetadataRoot, fileName), null);
    const normalized = normalizeExecutionMetadata(parsed, {
      symbol: symbolKey,
      source: `market_data/${fileName}`,
    });
    if (normalized) candidates.push(normalized);
  }

  return candidates.reduce((best, item) => {
    if (!best) return item;
    const bestScore = [
      best.pip_size,
      best.min_stop_pips,
      best.spread_pips,
      best.pip_value,
    ].filter((value) => value != null).length;
    const itemScore = [
      item.pip_size,
      item.min_stop_pips,
      item.spread_pips,
      item.pip_value,
    ].filter((value) => value != null).length;
    if (itemScore !== bestScore) return itemScore > bestScore ? item : best;
    return String(item.updated_at || "") >= String(best.updated_at || "") ? item : best;
  }, null);
}

function tradeSortTimeMs(trade = {}) {
  return (
    toTimestampMs(trade?.created_at) ||
    toTimestampMs(trade?.signal_bar_time) ||
    toTimestampMs(trade?.opened_at) ||
    toTimestampMs(trade?.closed_at) ||
    0
  );
}

function compareBatchTradeAsc(left, right) {
  const leftTime = tradeSortTimeMs(left);
  const rightTime = tradeSortTimeMs(right);
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left?.sid || "").localeCompare(String(right?.sid || ""));
}

function eventSortTimeMs(event = {}) {
  const unixMs = Number(event?.bar_time_unix) * 1000;
  if (Number.isFinite(unixMs) && unixMs > 0) return unixMs;
  return toTimestampMs(event?.bar_time) || 0;
}

function compareBatchEventAsc(left, right) {
  const leftTime = eventSortTimeMs(left);
  const rightTime = eventSortTimeMs(right);
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left?.event_id || "").localeCompare(String(right?.event_id || ""));
}

function normalizeBacktestDirection(value, fallback = "all") {
  const normalized = String(value || fallback || "all").trim().toLowerCase();
  if (["all", "buy", "sell"].includes(normalized)) return normalized;
  if (normalized === "long") return "buy";
  if (normalized === "short") return "sell";
  return String(fallback || "all").trim().toLowerCase() || "all";
}

function normalizeBacktestSession(value, fallback = "Any") {
  const normalized = String(value || "").trim();
  if (!normalized) return String(fallback || "Any");
  const aliases = {
    any: "Any",
    london: "London",
    "new york": "New York",
    newyork: "New York",
    ny: "New York",
    asian: "Asian",
    asia: "Asian",
    "london+ny": "London+NY",
    "london + ny": "London+NY",
  };
  return aliases[normalized.toLowerCase()] || normalized;
}

function normalizeBatchTimeframes(values = []) {
  const source = Array.isArray(values) ? values : [values];
  const mapping = {
    "1": "1",
    "1m": "1",
    "5": "5",
    "5m": "5",
    "15": "15",
    "15m": "15",
    "60": "60",
    "1h": "60",
    "240": "240",
    "4h": "240",
    "1440": "1440",
    "1d": "1440",
    d: "1440",
  };
  return [...new Set(
    source
      .map((value) => mapping[String(value || "").trim().toLowerCase()] || "")
      .filter(Boolean),
  )];
}

function getUtcHourFraction(unixSeconds) {
  const date = new Date(Number(unixSeconds || 0) * 1000);
  return (
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600
  );
}

function isBarInNamedSession(unixSeconds, sessionName = "Any") {
  const normalized = normalizeBacktestSession(sessionName, "Any");
  if (normalized === "Any") return true;
  const hour = getUtcHourFraction(unixSeconds);
  if (!Number.isFinite(hour)) return false;
  switch (normalized) {
    case "Asian":
      return hour >= 0 && hour < 9;
    case "London":
      return hour >= 8 && hour < 17;
    case "New York":
      return hour >= 13 && hour < 22;
    case "London+NY":
      return hour >= 8 && hour < 22;
    default:
      return true;
  }
}

function isActionAllowedByDirection(action, direction = "all") {
  const normalizedDirection = normalizeBacktestDirection(direction, "all");
  if (normalizedDirection === "all") return true;
  const normalizedAction = String(action || "").trim().toUpperCase();
  if (normalizedDirection === "buy") return normalizedAction === "BUY";
  if (normalizedDirection === "sell") return normalizedAction === "SELL";
  return true;
}

function quantizeToStep(value, step, minValue = 0, maxValue = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const safeStep = Number(step);
  let out = numeric;
  if (Number.isFinite(safeStep) && safeStep > 0) {
    out = Math.floor(numeric / safeStep) * safeStep;
  }
  const floorMin =
    minValue === null || minValue === undefined
      ? 0
      : Number.isFinite(Number(minValue))
        ? Number(minValue)
        : 0;
  if (floorMin > 0 && out < floorMin) out = floorMin;
  const ceilMax =
    maxValue === null || maxValue === undefined
      ? null
      : Number.isFinite(Number(maxValue))
        ? Number(maxValue)
        : null;
  if (ceilMax !== null && out > ceilMax) out = ceilMax;
  return out;
}

async function fetchBrokerCalibration(symbol, payload = {}) {
  const requestedProvider = String(
    payload.provider || payload.broker || payload.source || "",
  )
    .trim()
    .toLowerCase();
  const shouldUseCTrader =
    requestedProvider === "ctrader" ||
    requestedProvider === "c_trader" ||
    (!requestedProvider && CTRADER_DOWNSTREAM_URL && CTRADER_DOWNSTREAM_ACCOUNT_ID);
  if (!shouldUseCTrader || !CTRADER_DOWNSTREAM_URL || !CTRADER_DOWNSTREAM_ACCOUNT_ID) {
    return null;
  }
  try {
    const response = await fetch(
      `${CTRADER_DOWNSTREAM_URL.replace(/\/+$/, "")}/symbol-calibration`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(CTRADER_DOWNSTREAM_API_KEY
            ? { "x-api-key": CTRADER_DOWNSTREAM_API_KEY }
            : {}),
        },
        body: JSON.stringify({
          account_id: CTRADER_DOWNSTREAM_ACCOUNT_ID,
          symbol,
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    if (!body?.ok || !body?.calibration) return null;
    return body.calibration;
  } catch {
    return null;
  }
}

function normalizeTrailStages(rawStages = []) {
  if (!Array.isArray(rawStages)) return [];
  return rawStages
    .map((stage) => ({
      trigger_r:
        asFiniteNumber(stage?.trigger_r, null) ??
        asFiniteNumber(stage?.triggerR, null),
      stop_to_r:
        asFiniteNumber(stage?.stop_to_r, null) ??
        asFiniteNumber(stage?.stopToR, null),
    }))
    .filter(
      (stage) =>
        Number.isFinite(stage.trigger_r) && Number.isFinite(stage.stop_to_r),
    )
    .sort((left, right) => left.trigger_r - right.trigger_r);
}

function resolveExecutionOptions(strategy = {}, options = {}) {
  const risk = strategy?.risk || {};
  const brokerCalibration =
    options.brokerCalibration && typeof options.brokerCalibration === "object"
      ? options.brokerCalibration
      : null;
  const marketMetadata =
    options.marketMetadata && typeof options.marketMetadata === "object"
      ? options.marketMetadata
      : null;
  const calibration = {
    ...(marketMetadata || {}),
    ...(brokerCalibration || {}),
  };
  const initialEquity = Math.max(
    1,
    asFiniteNumber(
      options.initialEquity ??
        risk.initial_equity ??
        risk.initialEquity ??
        10000,
      10000,
    ),
  );
  const riskPercent = Math.max(
    0.01,
    asFiniteNumber(
      options.riskPercent ??
        risk.risk_percent ??
        risk.riskPercent ??
        1,
      1,
    ),
  );
  const fixedRiskAmount = asFiniteNumber(
    options.riskAmount ?? risk.risk_amount ?? risk.riskAmount,
    null,
  );
  const compoundEquity = Boolean(
    options.compoundEquity ??
      risk.compound_equity ??
      risk.compoundEquity ??
      false,
  );
  const spreadAbs = Math.max(
    0,
    asFiniteNumber(
      options.spreadAbs ??
        risk.spread_abs ??
        risk.spreadAbs ??
        calibration?.spread,
      0,
    ),
  );
  const pipSize = asOptionalFiniteNumber(
    options.pipSize ??
      risk.pip_size ??
      risk.pipSize ??
      calibration?.pip_size,
    null,
  ) || null;
  const spreadPips = asOptionalFiniteNumber(
    options.spreadPips ??
      risk.spread_pips ??
      risk.spreadPips ??
      calibration?.spread_pips,
    null,
  );
  const spreadBps = Math.max(
    0,
    asFiniteNumber(
      options.spreadBps ??
        risk.spread_bps ??
        risk.spreadBps,
      0,
    ),
  );
  const commissionFlat = Math.max(
    0,
    asFiniteNumber(
      options.commissionFlat ??
        risk.commission_flat ??
        risk.commissionFlat,
      0,
    ),
  );
  const commissionPerUnit = Math.max(
    0,
    asFiniteNumber(
      options.commissionPerUnit ??
        risk.commission_per_unit ??
        risk.commissionPerUnit,
      0,
    ),
  );
  const commissionPerLot = Math.max(
    0,
    asFiniteNumber(
      options.commissionPerLot ??
        risk.commission_per_lot ??
        risk.commissionPerLot ??
        calibration?.commission_per_lot,
      0,
    ),
  );
  const breakEvenAtR = asFiniteNumber(
    options.breakEvenAtR ??
      risk.break_even_at_r ??
      risk.breakEvenAtR,
    null,
  );
  const partialAtR = asFiniteNumber(
    options.partialAtR ??
      risk.partial_at_r ??
      risk.partialAtR,
    null,
  );
  const partialCloseFraction = Math.min(
    1,
    Math.max(
      0,
      asFiniteNumber(
        options.partialCloseFraction ??
          risk.partial_close_fraction ??
          risk.partialCloseFraction,
        0.5,
      ),
    ),
  );
  const maxBarsInTrade = Math.max(
    0,
    Math.trunc(
      asFiniteNumber(
        options.maxBarsInTrade ??
          risk.max_bars_in_trade ??
          risk.maxBarsInTrade,
        0,
      ),
    ),
  );
  const pendingOrderMaxBars = Math.max(
    0,
    Math.trunc(
      asFiniteNumber(
        options.pendingOrderMaxBars ??
          options.pending_order_max_bars ??
          risk.pending_order_max_bars ??
          risk.pendingOrderMaxBars,
        20,
      ),
    ),
  );
  const direction = normalizeBacktestDirection(
    options.direction ?? strategy?.market?.direction,
    "all",
  );
  const session = normalizeBacktestSession(
    options.session ?? strategy?.market?.session,
    "Any",
  );
  return {
    initialEquity,
    riskPercent,
    fixedRiskAmount,
    compoundEquity,
    spreadAbs,
    spreadBps,
    commissionFlat,
    commissionPerUnit,
    breakEvenAtR,
    partialAtR,
    partialCloseFraction,
    maxBarsInTrade,
    pendingOrderMaxBars,
    direction,
    session,
    brokerCalibration,
    marketMetadata,
    pipSize,
    pipValue: asOptionalFiniteNumber(
      options.pipValue ??
        risk.pip_value ??
        risk.pipValue ??
        calibration?.pip_value,
      null,
    ),
    minStopPips: asOptionalFiniteNumber(
      options.minStopPips ??
        risk.min_stop_pips ??
        risk.minStopPips ??
        calibration?.min_stop_pips,
      null,
    ),
    minStopPriceDistance: asOptionalFiniteNumber(
      options.minStopPriceDistance ??
        risk.min_stop_price_distance ??
        risk.minStopPriceDistance ??
        calibration?.min_stop_price_distance,
      pipSize && asOptionalFiniteNumber(calibration?.min_stop_pips, null)
        ? pipSize * asOptionalFiniteNumber(calibration?.min_stop_pips, 0)
        : null,
    ),
    maxStopPips: asOptionalFiniteNumber(
      options.maxStopPips ??
        risk.max_stop_pips ??
        risk.maxStopPips ??
        calibration?.max_stop_pips,
      null,
    ),
    maxStopPriceDistance: asOptionalFiniteNumber(
      options.maxStopPriceDistance ??
        risk.max_stop_price_distance ??
        risk.maxStopPriceDistance ??
        calibration?.max_stop_price_distance,
      pipSize && asOptionalFiniteNumber(calibration?.max_stop_pips, null)
        ? pipSize * asOptionalFiniteNumber(calibration?.max_stop_pips, 0)
        : null,
    ),
    spreadPips,
    effectiveSpreadAbs:
      spreadAbs > 0
        ? spreadAbs
        : pipSize && spreadPips != null
          ? pipSize * spreadPips
          : 0,
    lotSize:
      asOptionalFiniteNumber(
        options.lotSize ??
          risk.lot_size ??
          risk.lotSize ??
          calibration?.lot_size,
        null,
      ) || null,
    volumeStepUnits:
      asOptionalFiniteNumber(
        options.volumeStepUnits ??
          risk.volume_step_units ??
          risk.volumeStepUnits ??
          calibration?.volume_step_units,
        null,
      ) || null,
    minVolumeUnits:
      asOptionalFiniteNumber(
        options.minVolumeUnits ??
          risk.min_volume_units ??
          risk.minVolumeUnits ??
          calibration?.min_volume_units,
        null,
      ) || null,
    maxVolumeUnits:
      asOptionalFiniteNumber(
        options.maxVolumeUnits ??
          risk.max_volume_units ??
          risk.maxVolumeUnits ??
          calibration?.max_volume_units,
        null,
      ) || null,
    trailStages: normalizeTrailStages(
      options.trailStages ?? risk.trail_stages ?? risk.trailStages,
    ),
    commissionPerLot,
  };
}

function resolveSpreadAmount(entryPrice, executionOptions) {
  const effectiveSpread = Math.max(0, Number(executionOptions?.effectiveSpreadAbs || 0));
  if (effectiveSpread > 0) return effectiveSpread;
  const directSpread = Math.max(0, Number(executionOptions?.spreadAbs || 0));
  if (directSpread > 0) return directSpread;
  const spreadBps = Math.max(0, Number(executionOptions?.spreadBps || 0));
  const basis = Math.abs(Number(entryPrice) || 0);
  return basis > 0 ? (basis * spreadBps) / 10000 : 0;
}

function resolveMinimumStopDistance(executionOptions = {}) {
  const explicit = asOptionalFiniteNumber(executionOptions.minStopPriceDistance, null);
  if (explicit != null && explicit > 0) return explicit;
  const pipSize = asOptionalFiniteNumber(executionOptions.pipSize, null);
  const minStopPips = asOptionalFiniteNumber(executionOptions.minStopPips, null);
  return pipSize && minStopPips ? pipSize * minStopPips : 0;
}

function resolveMaximumStopDistance(executionOptions = {}) {
  const explicit = asOptionalFiniteNumber(executionOptions.maxStopPriceDistance, null);
  if (explicit != null && explicit > 0) return explicit;
  const pipSize = asOptionalFiniteNumber(executionOptions.pipSize, null);
  const maxStopPips = asOptionalFiniteNumber(executionOptions.maxStopPips, null);
  return pipSize && maxStopPips ? pipSize * maxStopPips : 0;
}

function stopDistanceIsAllowed(entry, stopLoss, executionOptions = {}) {
  const minDistance = resolveMinimumStopDistance(executionOptions);
  const maxDistance = resolveMaximumStopDistance(executionOptions);
  const distance = Math.abs(Number(entry) - Number(stopLoss));
  if (!Number.isFinite(distance)) return false;
  if (minDistance > 0 && distance + 1e-12 < minDistance) return false;
  if (maxDistance > 0 && distance - 1e-12 > maxDistance) return false;
  return true;
}

function limitOrderTouched(bar = {}, action = "", entry = null) {
  const entryPrice = Number(entry);
  if (!Number.isFinite(entryPrice)) return false;
  if (String(action || "").toUpperCase() === "BUY") {
    return Number(bar.low) <= entryPrice;
  }
  return Number(bar.high) >= entryPrice;
}

function adjustPriceForSide(rawPrice, action, spreadAmount, phase = "entry") {
  const price = Number(rawPrice);
  const spreadHalf = Math.max(0, Number(spreadAmount || 0)) / 2;
  if (!Number.isFinite(price)) return null;
  if (String(action || "").toUpperCase() === "BUY") {
    return phase === "entry" ? price + spreadHalf : price - spreadHalf;
  }
  return phase === "entry" ? price - spreadHalf : price + spreadHalf;
}

function buildTargetPriceFromR(action, entry, stopLoss, targetR) {
  const riskDistance = Math.abs(Number(entry) - Number(stopLoss));
  if (!Number.isFinite(riskDistance) || riskDistance <= 0) return null;
  if (!Number.isFinite(Number(targetR))) return null;
  return String(action || "").toUpperCase() === "BUY"
    ? Number(entry) + riskDistance * Number(targetR)
    : Number(entry) - riskDistance * Number(targetR);
}

function tightenStopFromR(action, entry, stopLoss, activeStop, lockR) {
  const nextStop = buildTargetPriceFromR(action, entry, stopLoss, lockR);
  if (!Number.isFinite(nextStop)) return activeStop;
  if (String(action || "").toUpperCase() === "BUY") {
    return Math.max(Number(activeStop), Number(nextStop));
  }
  return Math.min(Number(activeStop), Number(nextStop));
}

function emaSeries(values = [], period = 9) {
  const size = Math.max(1, Number(period) || 1);
  const alpha = 2 / (size + 1);
  const out = new Array(values.length).fill(null);
  let prev = null;
  for (let i = 0; i < values.length; i += 1) {
    const price = Number(values[i]);
    if (!Number.isFinite(price)) continue;
    prev = prev === null ? price : price * alpha + prev * (1 - alpha);
    out[i] = prev;
  }
  return out;
}

function smaSeries(values = [], period = 9) {
  const size = Math.max(1, Number(period) || 1);
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = Number(values[i]);
    if (!Number.isFinite(value)) continue;
    sum += value;
    if (i >= size) {
      sum -= Number(values[i - size]) || 0;
    }
    if (i >= size - 1) {
      out[i] = sum / size;
    }
  }
  return out;
}

function rollingStdDevSeries(values = [], period = 20) {
  const size = Math.max(1, Number(period) || 1);
  const out = new Array(values.length).fill(null);
  for (let i = size - 1; i < values.length; i += 1) {
    const window = values.slice(i - size + 1, i + 1).map(Number);
    if (window.some((value) => !Number.isFinite(value))) continue;
    const mean = window.reduce((sum, value) => sum + value, 0) / size;
    const variance =
      window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / size;
    out[i] = Math.sqrt(variance);
  }
  return out;
}

function bollingerSeries(values = [], period = 20, stddev = 2) {
  const mid = smaSeries(values, period);
  const dev = rollingStdDevSeries(values, period);
  const upper = mid.map((value, index) =>
    Number.isFinite(value) && Number.isFinite(dev[index])
      ? value + dev[index] * Number(stddev || 2)
      : null,
  );
  const lower = mid.map((value, index) =>
    Number.isFinite(value) && Number.isFinite(dev[index])
      ? value - dev[index] * Number(stddev || 2)
      : null,
  );
  return { upper, mid, lower };
}

function rsiSeries(values = [], period = 14) {
  const size = Math.max(2, Number(period) || 14);
  const out = new Array(values.length).fill(null);
  if (values.length <= size) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= size; i += 1) {
    const delta = Number(values[i]) - Number(values[i - 1]);
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  let avgGain = gains / size;
  let avgLoss = losses / size;
  out[size] =
    avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / Math.max(avgLoss, 1e-12));
  for (let i = size + 1; i < values.length; i += 1) {
    const delta = Number(values[i]) - Number(values[i - 1]);
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (size - 1) + gain) / size;
    avgLoss = (avgLoss * (size - 1) + loss) / size;
    out[i] =
      avgLoss === 0
        ? 100
        : 100 - 100 / (1 + avgGain / Math.max(avgLoss, 1e-12));
  }
  return out;
}

function macdSeries(values = [], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fast = emaSeries(values, fastPeriod);
  const slow = emaSeries(values, slowPeriod);
  const macd = values.map((_, index) => {
    if (!Number.isFinite(fast[index]) || !Number.isFinite(slow[index])) return null;
    return fast[index] - slow[index];
  });
  const signal = emaSeries(
    macd.map((value) => (Number.isFinite(value) ? value : 0)),
    signalPeriod,
  );
  const histogram = macd.map((value, index) => {
    if (!Number.isFinite(value) || !Number.isFinite(signal[index])) return null;
    return value - signal[index];
  });
  return { macd, signal, histogram };
}

function highestHighSeries(bars = [], period = 20) {
  const size = Math.max(1, Number(period) || 1);
  const out = new Array(bars.length).fill(null);
  for (let i = size; i < bars.length; i += 1) {
    let highest = -Infinity;
    for (let cursor = i - size; cursor < i; cursor += 1) {
      highest = Math.max(highest, Number(bars[cursor]?.high));
    }
    out[i] = Number.isFinite(highest) ? highest : null;
  }
  return out;
}

function lowestLowSeries(bars = [], period = 20) {
  const size = Math.max(1, Number(period) || 1);
  const out = new Array(bars.length).fill(null);
  for (let i = size; i < bars.length; i += 1) {
    let lowest = Infinity;
    for (let cursor = i - size; cursor < i; cursor += 1) {
      lowest = Math.min(lowest, Number(bars[cursor]?.low));
    }
    out[i] = Number.isFinite(lowest) ? lowest : null;
  }
  return out;
}

function stochasticKSeries(bars = [], period = 14, smoothPeriod = 3) {
  const raw = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i += 1) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let cursor = i - period + 1; cursor <= i; cursor += 1) {
      highest = Math.max(highest, Number(bars[cursor]?.high));
      lowest = Math.min(lowest, Number(bars[cursor]?.low));
    }
    const close = Number(bars[i]?.close);
    const range = highest - lowest;
    raw[i] = range > 0 ? ((close - lowest) / range) * 100 : 50;
  }
  return smaSeries(
    raw.map((value) => (Number.isFinite(value) ? value : 50)),
    smoothPeriod,
  );
}

function stochasticSeries(bars = [], period = 14, smoothPeriod = 3) {
  const k = stochasticKSeries(bars, period, smoothPeriod);
  const d = smaSeries(
    k.map((value) => (Number.isFinite(value) ? value : 50)),
    smoothPeriod,
  );
  return { k, d };
}

function rocSeries(values = [], period = 12) {
  const size = Math.max(1, Number(period) || 1);
  const out = new Array(values.length).fill(null);
  for (let i = size; i < values.length; i += 1) {
    const prev = Number(values[i - size]);
    const current = Number(values[i]);
    if (!Number.isFinite(prev) || !Number.isFinite(current) || prev === 0) continue;
    out[i] = ((current - prev) / prev) * 100;
  }
  return out;
}

function resolveStopAndTarget(
  bars,
  index,
  action,
  strategy,
  entry,
  signals = {},
  ctx = null,
  tradePlan = null,
) {
  const plannedTrade = normalizeStrategyTradePlan(
    tradePlan,
    action === "SELL" ? "sell" : "buy",
  );
  const plannedSl = resolveTradePlanFieldValue(plannedTrade?.sl, ctx);
  const plannedTp = resolveTradePlanFieldValue(
    plannedTrade?.tp1 ?? plannedTrade?.tp ?? plannedTrade?.tp2 ?? plannedTrade?.tp3,
    ctx,
  );
  const plannedRr = Number(plannedTrade?.rr);
  if (Number.isFinite(plannedSl)) {
    let sl = plannedSl;
    let tp = Number.isFinite(plannedTp)
      ? plannedTp
      : Number.isFinite(plannedRr) && plannedRr > 0
        ? action === "BUY"
          ? Number(entry) + Math.abs(Number(entry) - plannedSl) * plannedRr
          : Number(entry) - Math.abs(Number(entry) - plannedSl) * plannedRr
        : Number.NaN;
    if (!Number.isFinite(tp)) {
      tp = fallbackTakeProfit(entry, action, strategy);
    }
    if (action === "BUY") {
      if (sl >= Number(entry)) sl = fallbackStopLoss(entry, action, strategy);
      if (tp <= Number(entry)) tp = fallbackTakeProfit(entry, action, strategy);
    } else {
      if (sl <= Number(entry)) sl = fallbackStopLoss(entry, action, strategy);
      if (tp >= Number(entry)) tp = fallbackTakeProfit(entry, action, strategy);
    }
    return {
      sl: round(sl),
      tp: round(tp),
    };
  }
  const explicitStopExpr =
    action === "BUY" ? signals.stop_loss_long : signals.stop_loss_short;
  const explicitTakeExpr =
    action === "BUY" ? signals.take_profit_long : signals.take_profit_short;
  if (explicitStopExpr !== undefined || explicitTakeExpr !== undefined) {
    let sl = Number(
      explicitStopExpr !== undefined
        ? evaluateRule(explicitStopExpr, ctx)
        : fallbackStopLoss(entry, action, strategy),
    );
    let tp = Number(
      explicitTakeExpr !== undefined
        ? evaluateRule(explicitTakeExpr, ctx)
        : fallbackTakeProfit(entry, action, strategy),
    );
    if (!Number.isFinite(sl)) {
      sl = fallbackStopLoss(entry, action, strategy);
    }
    if (!Number.isFinite(tp)) {
      tp = fallbackTakeProfit(entry, action, strategy);
    }
    if (action === "BUY") {
      if (sl >= Number(entry)) sl = fallbackStopLoss(entry, action, strategy);
      if (tp <= Number(entry)) tp = fallbackTakeProfit(entry, action, strategy);
    } else {
      if (sl <= Number(entry)) sl = fallbackStopLoss(entry, action, strategy);
      if (tp >= Number(entry)) tp = fallbackTakeProfit(entry, action, strategy);
    }
    return {
      sl: round(sl),
      tp: round(tp),
    };
  }
  const lookback = Math.max(
    1,
    Number(strategy?.risk?.stop_lookback ?? strategy?.params?.stop_lookback) || 2,
  );
  let stopAnchor =
    action === "BUY" ? Infinity : -Infinity;
  for (let cursor = Math.max(0, index - lookback); cursor <= index; cursor += 1) {
    const bar = bars[cursor];
    if (!bar) continue;
    if (action === "BUY") {
      stopAnchor = Math.min(stopAnchor, Number(bar.low));
    } else {
      stopAnchor = Math.max(stopAnchor, Number(bar.high));
    }
  }
  let sl = stopAnchor;
  let risk = Math.abs(Number(entry) - Number(sl));
  if (!Number.isFinite(risk) || risk <= 0) {
    risk = Math.max(Math.abs(Number(entry)) * 0.001, 0.0001);
    sl = action === "BUY" ? Number(entry) - risk : Number(entry) + risk;
  }
  const rrTarget = Math.max(
    1,
    Number(strategy?.risk?.rr_target ?? strategy?.params?.rr_target) || 2,
  );
  const tp = action === "BUY" ? Number(entry) + risk * rrTarget : Number(entry) - risk * rrTarget;
  return {
    sl: round(sl),
    tp: round(tp),
  };
}

function simulateSignalStrategy(bars, strategy, signalResolver, options = {}) {
  const trades = [];
  const execution = resolveExecutionOptions(strategy, options);
  let equity = execution.initialEquity;
  let equityPeak = execution.initialEquity;
  let maxDrawdownPct = 0;
  let openTrade = null;
  let pendingOrder = null;

  function resolvePlannedR(entryPrice, stopPrice, targetPrice) {
    const riskDistance = Math.abs(Number(entryPrice) - Number(stopPrice));
    const rewardDistance = Math.abs(Number(targetPrice) - Number(entryPrice));
    if (!Number.isFinite(riskDistance) || riskDistance <= 0) return 0;
    if (!Number.isFinite(rewardDistance) || rewardDistance <= 0) return 0;
    return rewardDistance / riskDistance;
  }

  function resolvePlannedOutcomeR(plannedR, realizedNetPnl) {
    const safePlannedR = Number(plannedR);
    const safeRealizedNetPnl = Number(realizedNetPnl);
    if (!Number.isFinite(safeRealizedNetPnl) || safeRealizedNetPnl === 0) {
      return 0;
    }
    if (!Number.isFinite(safePlannedR) || safePlannedR <= 0) {
      return safeRealizedNetPnl > 0 ? 1 : -1;
    }
    return safeRealizedNetPnl > 0 ? safePlannedR : -1;
  }

  function pushTrade(trade) {
    trades.push(trade);
    equity += Number(trade.pnl_realized || 0);
    equityPeak = Math.max(equityPeak, equity);
    const drawdownPct =
      equityPeak > 0 ? ((equity - equityPeak) / equityPeak) * 100 : 0;
    maxDrawdownPct = Math.min(maxDrawdownPct, drawdownPct);
  }

  function createOpenTradeFromSetup(setup = {}, fillBar = {}, fillIndex = 0) {
    const action = String(setup.action || "").toUpperCase();
    const entry = Number(setup.entry);
    const sl = Number(setup.sl);
    const tp = Number(setup.tp);
    if (!action || !Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp)) {
      return null;
    }
    if (!stopDistanceIsAllowed(entry, sl, execution)) {
      return null;
    }
    const accountEquityForTrade = execution.compoundEquity ? equity : execution.initialEquity;
    const riskAmount =
      execution.fixedRiskAmount !== null
        ? Math.max(0.01, execution.fixedRiskAmount)
        : Math.max(0.01, (accountEquityForTrade * execution.riskPercent) / 100);
    const spreadAmount = resolveSpreadAmount(entry, execution);
    const entryFill = adjustPriceForSide(entry, action, spreadAmount, "entry");
    const stopFill = adjustPriceForSide(sl, action, spreadAmount, "exit");
    const riskPerUnit = Math.abs(Number(entryFill) - Number(stopFill));
    if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) {
      return null;
    }
    let quantity = Math.max(0.00000001, riskAmount / riskPerUnit);
    quantity = quantizeToStep(
      quantity,
      execution.volumeStepUnits,
      execution.minVolumeUnits,
      execution.maxVolumeUnits,
    );
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return null;
    }
    const estimatedLots =
      execution.lotSize && execution.lotSize > 0
        ? quantity / execution.lotSize
        : null;
    const commissionPerSide =
      execution.commissionFlat +
      execution.commissionPerUnit * quantity +
      (estimatedLots !== null ? execution.commissionPerLot * estimatedLots : 0);
    const partialTp =
      Number.isFinite(execution.partialAtR) && execution.partialAtR > 0
        ? buildTargetPriceFromR(action, entry, sl, execution.partialAtR)
        : null;
    const breakEvenTrigger =
      Number.isFinite(execution.breakEvenAtR) && execution.breakEvenAtR > 0
        ? buildTargetPriceFromR(action, entry, sl, execution.breakEvenAtR)
        : null;
    return {
      action,
      orderType: setup.orderType || "market",
      entry,
      entryFill,
      initialSl: sl,
      activeSl: sl,
      tp,
      quantity,
      estimatedLots,
      riskAmount,
      riskPercent: execution.riskPercent,
      spreadAmount,
      commissionPerSide,
      entryIndex: fillIndex,
      signalIndex: setup.signalIndex ?? fillIndex,
      signalTime: setup.signalTime ?? fillBar.time,
      openTime: fillBar.time,
      accountEquityBefore: accountEquityForTrade,
      breakEvenTrigger,
      breakEvenArmed: false,
      partialTp,
      partialTaken: false,
      partialCloseFraction: execution.partialCloseFraction,
      remainingFraction: 1,
      realizedGrossPnl: 0,
      realizedNetPnl: 0,
      realizedCommission: 0,
      realizedR: 0,
      plannedR: resolvePlannedR(entry, sl, tp),
      weightedExitPrice: 0,
      closedFractions: [],
      maxBarsInTrade: execution.maxBarsInTrade,
      trailStages: execution.trailStages.map((stage) => ({
        ...stage,
        triggerPrice: buildTargetPriceFromR(action, entry, sl, stage.trigger_r),
        triggered: false,
      })),
      trailingStopUpdates: [],
    };
  }

  for (let i = 1; i < bars.length; i += 1) {
    const bar = bars[i];
    const signals = signalResolver(i) || {};
    const buySignal = Boolean(signals.buy);
    const sellSignal = Boolean(signals.sell);

    if (!openTrade && pendingOrder) {
      const pendingExpired =
        execution.pendingOrderMaxBars > 0 &&
        i - Number(pendingOrder.signalIndex || i) > execution.pendingOrderMaxBars;
      if (pendingExpired) {
        pendingOrder = null;
      } else if (limitOrderTouched(bar, pendingOrder.action, pendingOrder.entry)) {
        openTrade = createOpenTradeFromSetup(pendingOrder, bar, i);
        pendingOrder = null;
      }
    }

    if (openTrade) {
      // Signals are evaluated from the completed bar, so the fill bar itself
      // cannot also be used to decide SL/TP outcomes without lookahead bias.
      if (i <= Number(openTrade.entryIndex || 0)) {
        continue;
      }
      const isBuy = openTrade.action === "BUY";
      const slHit = isBuy ? bar.low <= openTrade.activeSl : bar.high >= openTrade.activeSl;
      const partialHit =
        !openTrade.partialTaken &&
        Number.isFinite(openTrade.partialTp) &&
        (isBuy ? bar.high >= openTrade.partialTp : bar.low <= openTrade.partialTp);
      const beHit =
        !openTrade.breakEvenArmed &&
        Number.isFinite(openTrade.breakEvenTrigger) &&
        (isBuy
          ? bar.high >= openTrade.breakEvenTrigger
          : bar.low <= openTrade.breakEvenTrigger);
      const tpHit = isBuy ? bar.high >= openTrade.tp : bar.low <= openTrade.tp;
      const explicitExit = isBuy ? Boolean(signals.exit_long) : Boolean(signals.exit_short);
      const oppositeSignal = isBuy ? sellSignal : buySignal;

      const closePortion = (rawExitPrice, closeFraction, exitReason, exitBarIndex) => {
        const normalizedFraction = Math.min(
          Math.max(Number(closeFraction || 0), 0),
          openTrade.remainingFraction,
        );
        if (normalizedFraction <= 0) return null;
        const exitFill = adjustPriceForSide(
          rawExitPrice,
          openTrade.action,
          openTrade.spreadAmount,
          "exit",
        );
        const quantityClosed = openTrade.quantity * normalizedFraction;
        const direction = isBuy ? 1 : -1;
        const grossPnl = (Number(exitFill) - Number(openTrade.entryFill)) * direction * quantityClosed;
        const commissionPaid =
          openTrade.commissionPerSide * normalizedFraction +
          openTrade.commissionPerSide * normalizedFraction;
        const netPnl = grossPnl - commissionPaid;
        const rMultiple =
          openTrade.riskAmount > 0 ? netPnl / openTrade.riskAmount : 0;
        openTrade.remainingFraction = round(
          openTrade.remainingFraction - normalizedFraction,
          8,
        );
        openTrade.realizedGrossPnl += grossPnl;
        openTrade.realizedNetPnl += netPnl;
        openTrade.realizedCommission += commissionPaid;
        openTrade.realizedR += rMultiple;
        openTrade.weightedExitPrice += Number(exitFill) * normalizedFraction;
        openTrade.closedFractions.push({
          fraction: normalizedFraction,
          exit_reason: exitReason,
          exit_price_raw: round(rawExitPrice),
          exit_price_fill: round(exitFill),
          quantity: round(quantityClosed, 8),
          pnl_gross: round(grossPnl, 5),
          pnl_net: round(netPnl, 5),
          r_multiple: round(rMultiple, 5),
          bar_index: exitBarIndex,
          time_unix: bar.time,
        });
        return exitFill;
      };

      if (slHit) {
        closePortion(openTrade.activeSl, openTrade.remainingFraction, openTrade.breakEvenArmed
          ? "break_even_or_trailing_stop"
          : "sl", i);
        const averageExit =
          openTrade.closedFractions.length > 0 && openTrade.remainingFraction <= 0
            ? openTrade.weightedExitPrice /
              openTrade.closedFractions.reduce(
                (sum, item) => sum + Number(item.fraction || 0),
                0,
              )
            : adjustPriceForSide(
                openTrade.activeSl,
                openTrade.action,
                openTrade.spreadAmount,
                "exit",
              );
        pushTrade({
          sid: "",
          action: openTrade.action,
          order_type: openTrade.orderType,
          entry: openTrade.entry,
          entry_fill: round(openTrade.entryFill),
          sl: round(openTrade.initialSl),
          tp1: round(openTrade.tp),
          tp: round(openTrade.tp),
          created_at: toIsoFromUnixSeconds(openTrade.signalTime),
          opened_at: toIsoFromUnixSeconds(openTrade.openTime),
          closed_at: toIsoFromUnixSeconds(bar.time),
          signal_bar_time: toIsoFromUnixSeconds(openTrade.signalTime),
          exit_price: round(averageExit),
          exit_price_raw: round(openTrade.activeSl),
          pnl_realized: round(openTrade.realizedNetPnl, 5),
          pnl_gross: round(openTrade.realizedGrossPnl, 5),
          commission_paid: round(openTrade.realizedCommission, 5),
          bars_held: i - openTrade.entryIndex,
          entry_bar_index: openTrade.entryIndex,
          exit_bar_index: i,
          entry_time_unix: openTrade.openTime,
          exit_time_unix: bar.time,
          exit_reason: openTrade.breakEvenArmed ? "sl_after_be_or_trail" : "sl",
          result:
            openTrade.realizedNetPnl > 0
              ? "win"
              : openTrade.realizedNetPnl < 0
                ? "loss"
                : "flat",
          quantity: round(openTrade.quantity, 8),
          estimated_lots: round(openTrade.estimatedLots, 8),
          risk_amount: roundMoney(openTrade.riskAmount),
          risk_percent: round(openTrade.riskPercent, 4),
          realized_r: round(openTrade.realizedR, 5),
          r_multiple: round(openTrade.realizedR, 5),
          planned_rr: round(openTrade.plannedR, 5),
          planned_outcome_r: round(
            resolvePlannedOutcomeR(openTrade.plannedR, openTrade.realizedNetPnl),
            5,
          ),
          spread_amount: round(openTrade.spreadAmount, 8),
          spread_pips:
            execution.pipSize && execution.pipSize > 0
              ? round(openTrade.spreadAmount / execution.pipSize, 5)
              : null,
          pip_size: execution.pipSize,
          min_stop_pips: execution.minStopPips,
          max_stop_pips: execution.maxStopPips,
          spread_cost: round(
            Math.abs(openTrade.entryFill - openTrade.entry) * openTrade.quantity +
              Math.abs(Number(averageExit) - Number(openTrade.activeSl)) *
                openTrade.quantity,
            5,
          ),
          account_equity_before: roundMoney(openTrade.accountEquityBefore),
          account_equity_after: roundMoney(equity + openTrade.realizedNetPnl),
          closed_fractions: openTrade.closedFractions,
          break_even_armed: openTrade.breakEvenArmed,
          partial_taken: openTrade.partialTaken,
          trailing_stop_updates: openTrade.trailingStopUpdates,
        });
        openTrade = null;
      } else {
        if (partialHit) {
          closePortion(
            openTrade.partialTp,
            openTrade.partialCloseFraction,
            "partial_tp",
            i,
          );
          openTrade.partialTaken = true;
        }

        if (beHit) {
          openTrade.breakEvenArmed = true;
          openTrade.activeSl = openTrade.entry;
        }

        for (const stage of openTrade.trailStages) {
          if (stage.triggered) continue;
          const stageHit = isBuy
            ? bar.high >= stage.triggerPrice
            : bar.low <= stage.triggerPrice;
          if (!stageHit) continue;
          openTrade.activeSl = tightenStopFromR(
            openTrade.action,
            openTrade.entry,
            openTrade.initialSl,
            openTrade.activeSl,
            stage.stop_to_r,
          );
          openTrade.breakEvenArmed = true;
          stage.triggered = true;
          openTrade.trailingStopUpdates.push({
            trigger_r: stage.trigger_r,
            stop_to_r: stage.stop_to_r,
            new_sl: round(openTrade.activeSl),
            bar_index: i,
            time_unix: bar.time,
          });
        }

        if (tpHit) {
          closePortion(openTrade.tp, openTrade.remainingFraction, "tp", i);
          const averageExit =
            openTrade.weightedExitPrice /
            openTrade.closedFractions.reduce(
              (sum, item) => sum + Number(item.fraction || 0),
              0,
            );
        pushTrade({
          sid: "",
          action: openTrade.action,
          order_type: openTrade.orderType,
          entry: openTrade.entry,
          entry_fill: round(openTrade.entryFill),
          sl: round(openTrade.initialSl),
          tp1: round(openTrade.tp),
          tp: round(openTrade.tp),
            created_at: toIsoFromUnixSeconds(openTrade.signalTime),
            opened_at: toIsoFromUnixSeconds(openTrade.openTime),
            closed_at: toIsoFromUnixSeconds(bar.time),
            signal_bar_time: toIsoFromUnixSeconds(openTrade.signalTime),
            exit_price: round(averageExit),
            exit_price_raw: round(openTrade.tp),
            pnl_realized: round(openTrade.realizedNetPnl, 5),
            pnl_gross: round(openTrade.realizedGrossPnl, 5),
            commission_paid: round(openTrade.realizedCommission, 5),
            bars_held: i - openTrade.entryIndex,
            entry_bar_index: openTrade.entryIndex,
            exit_bar_index: i,
            entry_time_unix: openTrade.openTime,
            exit_time_unix: bar.time,
            exit_reason: openTrade.partialTaken ? "tp_after_partial" : "tp",
            result:
              openTrade.realizedNetPnl > 0
                ? "win"
                : openTrade.realizedNetPnl < 0
                  ? "loss"
                  : "flat",
          quantity: round(openTrade.quantity, 8),
          estimated_lots: round(openTrade.estimatedLots, 8),
          risk_amount: roundMoney(openTrade.riskAmount),
          risk_percent: round(openTrade.riskPercent, 4),
          realized_r: round(openTrade.realizedR, 5),
          r_multiple: round(openTrade.realizedR, 5),
          planned_rr: round(openTrade.plannedR, 5),
          planned_outcome_r: round(
            resolvePlannedOutcomeR(openTrade.plannedR, openTrade.realizedNetPnl),
            5,
          ),
          spread_amount: round(openTrade.spreadAmount, 8),
          spread_pips:
            execution.pipSize && execution.pipSize > 0
              ? round(openTrade.spreadAmount / execution.pipSize, 5)
              : null,
          pip_size: execution.pipSize,
          min_stop_pips: execution.minStopPips,
          max_stop_pips: execution.maxStopPips,
          account_equity_before: roundMoney(openTrade.accountEquityBefore),
          account_equity_after: roundMoney(equity + openTrade.realizedNetPnl),
          closed_fractions: openTrade.closedFractions,
          break_even_armed: openTrade.breakEvenArmed,
          partial_taken: openTrade.partialTaken,
          trailing_stop_updates: openTrade.trailingStopUpdates,
          });
          openTrade = null;
        } else if (
          explicitExit ||
          oppositeSignal ||
          i === bars.length - 1 ||
          (openTrade.maxBarsInTrade > 0 &&
            i - openTrade.entryIndex + 1 >= openTrade.maxBarsInTrade)
        ) {
          let exitReason = explicitExit
            ? "rule_exit"
            : oppositeSignal
              ? "signal_flip"
              : i === bars.length - 1
                ? "end_of_data"
                : "time_stop";
          closePortion(Number(bar.close), openTrade.remainingFraction, exitReason, i);
          const averageExit =
            openTrade.weightedExitPrice /
            openTrade.closedFractions.reduce(
              (sum, item) => sum + Number(item.fraction || 0),
              0,
            );
          pushTrade({
            sid: "",
            action: openTrade.action,
            order_type: openTrade.orderType,
            entry: openTrade.entry,
            entry_fill: round(openTrade.entryFill),
            sl: round(openTrade.initialSl),
            tp1: round(openTrade.tp),
            tp: round(openTrade.tp),
            created_at: toIsoFromUnixSeconds(openTrade.signalTime),
            opened_at: toIsoFromUnixSeconds(openTrade.openTime),
            closed_at: toIsoFromUnixSeconds(bar.time),
            signal_bar_time: toIsoFromUnixSeconds(openTrade.signalTime),
            exit_price: round(averageExit),
            exit_price_raw: round(bar.close),
            pnl_realized: round(openTrade.realizedNetPnl, 5),
            pnl_gross: round(openTrade.realizedGrossPnl, 5),
            commission_paid: round(openTrade.realizedCommission, 5),
            bars_held: i - openTrade.entryIndex,
            entry_bar_index: openTrade.entryIndex,
            exit_bar_index: i,
            entry_time_unix: openTrade.openTime,
            exit_time_unix: bar.time,
            exit_reason: exitReason,
            result:
              openTrade.realizedNetPnl > 0
                ? "win"
                : openTrade.realizedNetPnl < 0
                  ? "loss"
                  : "flat",
            quantity: round(openTrade.quantity, 8),
            estimated_lots: round(openTrade.estimatedLots, 8),
            risk_amount: roundMoney(openTrade.riskAmount),
            risk_percent: round(openTrade.riskPercent, 4),
            realized_r: round(openTrade.realizedR, 5),
            r_multiple: round(openTrade.realizedR, 5),
            planned_rr: round(openTrade.plannedR, 5),
            planned_outcome_r: round(
              resolvePlannedOutcomeR(openTrade.plannedR, openTrade.realizedNetPnl),
              5,
            ),
            spread_amount: round(openTrade.spreadAmount, 8),
            spread_pips:
              execution.pipSize && execution.pipSize > 0
                ? round(openTrade.spreadAmount / execution.pipSize, 5)
                : null,
            pip_size: execution.pipSize,
            min_stop_pips: execution.minStopPips,
            max_stop_pips: execution.maxStopPips,
            account_equity_before: roundMoney(openTrade.accountEquityBefore),
            account_equity_after: roundMoney(equity + openTrade.realizedNetPnl),
            closed_fractions: openTrade.closedFractions,
            break_even_armed: openTrade.breakEvenArmed,
            partial_taken: openTrade.partialTaken,
            trailing_stop_updates: openTrade.trailingStopUpdates,
          });
          openTrade = null;
        }
      }
    }

    if (openTrade) continue;
    if (!buySignal && !sellSignal) continue;

    const action = buySignal ? "BUY" : "SELL";
    const selectedTradePlan = buySignal
      ? signals.trade_plan_buy
      : signals.trade_plan_sell;
    if (!isActionAllowedByDirection(action, execution.direction)) {
      continue;
    }
    if (!isBarInNamedSession(bar?.time, execution.session)) {
      continue;
    }
    const entryCtx = signals.ctx || null;
    const orderType = String(selectedTradePlan?.type || "market").trim().toLowerCase() || "market";
    const plannedEntry = resolveTradePlanFieldValue(selectedTradePlan?.entry, entryCtx);
    const entry = round(
      Number.isFinite(plannedEntry) ? plannedEntry : Number(bar.close),
    );
    const { sl, tp } = resolveStopAndTarget(
      bars,
      i,
      action,
      strategy,
      entry,
      signals,
      entryCtx,
      selectedTradePlan,
    );
    const setup = {
      action,
      orderType,
      entry,
      sl: Number(sl),
      tp: Number(tp),
      signalIndex: i,
      signalTime: bar.time,
    };
    if (orderType === "limit") {
      pendingOrder = setup;
      continue;
    }
    openTrade = createOpenTradeFromSetup(setup, bar, i);
  }

  const details = {
    trades,
    equity_curve: trades.reduce(
      (points, trade) => {
        const previous =
          points.length > 0
            ? Number(points[points.length - 1].equity || execution.initialEquity)
            : execution.initialEquity;
        points.push({
          time: trade.exit_time_unix,
          equity: roundMoney(previous + Number(trade.pnl_realized || 0)),
        });
        return points;
      },
      [{ time: bars[0]?.time || 0, equity: roundMoney(execution.initialEquity) }],
    ),
    initial_equity: roundMoney(execution.initialEquity),
    final_equity: roundMoney(equity),
    max_drawdown_pct: round(maxDrawdownPct, 4),
    execution_options: {
      spread_amount: round(execution.effectiveSpreadAbs || execution.spreadAbs || 0, 8),
      spread_pips: execution.spreadPips ?? null,
      pip_size: execution.pipSize ?? null,
      pip_value: execution.pipValue ?? null,
      min_stop_pips: execution.minStopPips ?? null,
      min_stop_price_distance: execution.minStopPriceDistance ?? null,
      max_stop_pips: execution.maxStopPips ?? null,
      max_stop_price_distance: execution.maxStopPriceDistance ?? null,
      commission_flat: execution.commissionFlat,
      commission_per_unit: execution.commissionPerUnit,
      commission_per_lot: execution.commissionPerLot,
      pending_order_max_bars: execution.pendingOrderMaxBars,
    },
  };
  return options && options.returnDetails ? details : trades;
}

function normalizeBarRows(rows = [], tf = "15") {
  const tfSeconds = Math.max(60, barsStorage.parseTfTokenToSeconds(tf));
  const diagnostics = {
    input_rows: Array.isArray(rows) ? rows.length : 0,
    output_rows: 0,
    dropped_invalid_rows: 0,
    duplicate_timestamps: 0,
    non_monotonic_input: 0,
    corrected_ohlc_rows: 0,
    gap_count: 0,
    expected_tf_seconds: tfSeconds,
  };
  if (!Array.isArray(rows) || !rows.length) {
    return { bars: [], diagnostics };
  }

  const prepared = [];
  let previousInputTime = null;
  for (const row of rows) {
    const time = Number(row.time);
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    const volume = Number(row.volume || 0);
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      diagnostics.dropped_invalid_rows += 1;
      continue;
    }
    if (previousInputTime !== null && time < previousInputTime) {
      diagnostics.non_monotonic_input += 1;
    }
    previousInputTime = time;
    const normalized = {
      time,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    };
    const boundedHigh = Math.max(normalized.high, normalized.open, normalized.close, normalized.low);
    const boundedLow = Math.min(normalized.low, normalized.open, normalized.close, normalized.high);
    if (boundedHigh !== normalized.high || boundedLow !== normalized.low) {
      diagnostics.corrected_ohlc_rows += 1;
      normalized.high = boundedHigh;
      normalized.low = boundedLow;
    }
    prepared.push(normalized);
  }

  prepared.sort((a, b) => a.time - b.time);
  const deduped = [];
  for (const row of prepared) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.time === row.time) {
      diagnostics.duplicate_timestamps += 1;
      deduped[deduped.length - 1] = row;
      continue;
    }
    if (previous) {
      const delta = row.time - previous.time;
      if (delta > tfSeconds) {
        diagnostics.gap_count += Math.max(1, Math.floor(delta / tfSeconds) - 1);
      }
    }
    deduped.push(row);
  }

  diagnostics.output_rows = deduped.length;
  return { bars: deduped, diagnostics };
}

function normalizeBars(symbol, tf, limit) {
  const rows = barsStorage.readBrokerBarsFromFile(symbol, tf, limit, {
    fullFile: Number(limit) <= 0,
  });
  return normalizeBarRows(rows, tf);
}

function collectRequestedTimeframesFromRule(node, out = new Set()) {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    node.forEach((item) => collectRequestedTimeframesFromRule(item, out));
    return out;
  }
  if (typeof node !== "object") return out;
  if (typeof node.fn === "string") {
    const args = Array.isArray(node.args) ? node.args : [];
    if (args.length > 1) {
      const candidate = args[args.length - 1];
      if (
        typeof candidate === "string" ||
        typeof candidate === "number"
      ) {
        const tf = strategyEventFunctions.normalizeTfKey(candidate);
        if (tf) out.add(tf);
      }
    }
    args.forEach((item) => collectRequestedTimeframesFromRule(item, out));
    return out;
  }
  Object.values(node).forEach((value) => collectRequestedTimeframesFromRule(value, out));
  return out;
}

function collectStrategyRequestedTimeframes(strategy = {}, baseTf = "") {
  const requested = new Set();
  const normalizedBaseTf = strategyEventFunctions.normalizeTfKey(baseTf);
  if (normalizedBaseTf) requested.add(normalizedBaseTf);
  const events = Array.isArray(strategy?.events) ? strategy.events : [];
  events.forEach((event) => collectRequestedTimeframesFromRule(event?.when, requested));
  return Array.from(requested).filter(Boolean);
}

function buildMultiTimeframeContext(symbol = "", tf = "", limit = 0, strategy = {}) {
  const requestedTfs = collectStrategyRequestedTimeframes(strategy, tf);
  const out = {};
  requestedTfs.forEach((tfKey) => {
    const normalized = normalizeBars(symbol, tfKey, limit);
    out[tfKey] = {
      bars: normalized.bars,
      diagnostics: normalized.diagnostics,
      derivedArtifacts: sharedArtifactDetection.buildDerivedItemsFromBars(
        normalized.bars,
        tfKey,
      ),
      analysis: null,
    };
  });
  return out;
}

function valueAtPath(source, pathName = "") {
  const parts = String(pathName || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  let cursor = source;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || !(part in cursor)) return null;
    cursor = cursor[part];
  }
  return cursor;
}

function normalizeContextRowObject(row = {}) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const next = { ...row };
  delete next.time;
  delete next.t;
  delete next.bar_time_unix;
  delete next.barIndex;
  delete next.bar_index;
  delete next.symbol;
  delete next.tf;
  return Object.keys(next).length ? next : null;
}

function buildBacktestContextIndex(options = {}, strategy = {}) {
  const index = new Map();
  const appendRow = (rawRow, namespace = "") => {
    if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) return;
    const time = Number(rawRow.time ?? rawRow.bar_time_unix ?? rawRow.t);
    if (!Number.isFinite(time) || time <= 0) return;
    const rowBody = normalizeContextRowObject(rawRow);
    if (!rowBody) return;
    const scopedRow =
      namespace && !Object.prototype.hasOwnProperty.call(rowBody, namespace)
        ? { [namespace]: rowBody }
        : rowBody;
    index.set(time, {
      ...(index.get(time) || {}),
      ...scopedRow,
    });
  };

  for (const row of Array.isArray(options?.context_rows) ? options.context_rows : []) {
    appendRow(row, "");
  }
  for (const row of Array.isArray(options?.ai_context_rows) ? options.ai_context_rows : []) {
    appendRow(row, "ai");
  }
  for (const row of Array.isArray(options?.price_action_context_rows) ? options.price_action_context_rows : []) {
    appendRow(row, "");
  }
  for (const row of Array.isArray(strategy?.metadata?.context_rows) ? strategy.metadata.context_rows : []) {
    appendRow(row, "");
  }
  return index;
}

function inferPreviousRuleNode(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;
  const entries = Object.entries(node);
  if (entries.length !== 1) return node;
  const [operator, rawValue] = entries[0];
  if (operator !== "var" || typeof rawValue !== "string") return node;
  if (rawValue.startsWith("indicators.")) {
    return { var: rawValue.replace(/^indicators\./, "prev_indicators.") };
  }
  if (rawValue.startsWith("bar.")) {
    return { var: rawValue.replace(/^bar\./, "prev.") };
  }
  return node;
}

function resolveCrossValues(rawValue, ctx) {
  if (Array.isArray(rawValue)) {
    if (rawValue.length >= 4) {
      const [leftPrevNode, leftNode, rightPrevNode, rightNode] = rawValue;
      return [
        evaluateRule(leftPrevNode, ctx),
        evaluateRule(leftNode, ctx),
        evaluateRule(rightPrevNode, ctx),
        evaluateRule(rightNode, ctx),
      ];
    }
    if (rawValue.length >= 2) {
      const [leftNode, rightNode] = rawValue;
      return [
        evaluateRule(inferPreviousRuleNode(leftNode), ctx),
        evaluateRule(leftNode, ctx),
        evaluateRule(inferPreviousRuleNode(rightNode), ctx),
        evaluateRule(rightNode, ctx),
      ];
    }
  }
  if (rawValue && typeof rawValue === "object") {
    const leftPrevNode =
      rawValue.left_prev ??
      rawValue.leftPrev ??
      inferPreviousRuleNode(rawValue.left);
    const rightPrevNode =
      rawValue.right_prev ??
      rawValue.rightPrev ??
      inferPreviousRuleNode(rawValue.right);
    return [
      evaluateRule(leftPrevNode, ctx),
      evaluateRule(rawValue.left, ctx),
      evaluateRule(rightPrevNode, ctx),
      evaluateRule(rawValue.right, ctx),
    ];
  }
  return [null, null, null, null];
}

function evaluateComparatorRetest(rawValue, ctx) {
  const [leftPrev, leftCurrent, rightPrev, rightCurrent] = resolveCrossValues(
    rawValue,
    ctx,
  );
  const level =
    Number.isFinite(Number(rightCurrent)) ? Number(rightCurrent) :
    Number.isFinite(Number(rightPrev)) ? Number(rightPrev) :
    null;
  const prevValue = Number(leftPrev);
  const currentValue = Number(leftCurrent);
  const barHigh = Number(ctx?.bar?.high);
  const barLow = Number(ctx?.bar?.low);
  if (
    !Number.isFinite(level) ||
    !Number.isFinite(prevValue) ||
    !Number.isFinite(currentValue) ||
    !Number.isFinite(barHigh) ||
    !Number.isFinite(barLow)
  ) {
    return false;
  }
  const touchedLevel = barLow <= level && barHigh >= level;
  if (!touchedLevel) return false;
  const bullishRetest = prevValue > level && currentValue > level;
  const bearishRetest = prevValue < level && currentValue < level;
  return bullishRetest || bearishRetest;
}

function evaluateComparatorRejected(rawValue, ctx) {
  const [leftPrev, leftCurrent, rightPrev, rightCurrent] = resolveCrossValues(
    rawValue,
    ctx,
  );
  const level =
    Number.isFinite(Number(rightCurrent)) ? Number(rightCurrent) :
    Number.isFinite(Number(rightPrev)) ? Number(rightPrev) :
    null;
  const currentValue = Number(leftCurrent);
  const barHigh = Number(ctx?.bar?.high);
  const barLow = Number(ctx?.bar?.low);
  if (
    !Number.isFinite(level) ||
    !Number.isFinite(currentValue) ||
    !Number.isFinite(barHigh) ||
    !Number.isFinite(barLow)
  ) {
    return false;
  }
  const bullishRejection = barLow <= level && currentValue > level;
  const bearishRejection = barHigh >= level && currentValue < level;
  return bullishRejection || bearishRejection;
}

function evaluateComparatorTouches(rawValue, ctx) {
  const [_leftPrev, _leftCurrent, rightPrev, rightCurrent] = resolveCrossValues(
    rawValue,
    ctx,
  );
  const level =
    Number.isFinite(Number(rightCurrent)) ? Number(rightCurrent) :
    Number.isFinite(Number(rightPrev)) ? Number(rightPrev) :
    null;
  const barHigh = Number(ctx?.bar?.high);
  const barLow = Number(ctx?.bar?.low);
  if (
    !Number.isFinite(level) ||
    !Number.isFinite(barHigh) ||
    !Number.isFinite(barLow)
  ) {
    return false;
  }
  return barLow <= level && barHigh >= level;
}

function evaluateComparatorHoldsAbove(rawValue, ctx) {
  const [leftPrev, leftCurrent, rightPrev, rightCurrent] = resolveCrossValues(
    rawValue,
    ctx,
  );
  const level =
    Number.isFinite(Number(rightCurrent)) ? Number(rightCurrent) :
    Number.isFinite(Number(rightPrev)) ? Number(rightPrev) :
    null;
  const prevValue = Number(leftPrev);
  const currentValue = Number(leftCurrent);
  if (
    !Number.isFinite(level) ||
    !Number.isFinite(prevValue) ||
    !Number.isFinite(currentValue)
  ) {
    return false;
  }
  return prevValue > level && currentValue > level;
}

function evaluateComparatorHoldsBelow(rawValue, ctx) {
  const [leftPrev, leftCurrent, rightPrev, rightCurrent] = resolveCrossValues(
    rawValue,
    ctx,
  );
  const level =
    Number.isFinite(Number(rightCurrent)) ? Number(rightCurrent) :
    Number.isFinite(Number(rightPrev)) ? Number(rightPrev) :
    null;
  const prevValue = Number(leftPrev);
  const currentValue = Number(leftCurrent);
  if (
    !Number.isFinite(level) ||
    !Number.isFinite(prevValue) ||
    !Number.isFinite(currentValue)
  ) {
    return false;
  }
  return prevValue < level && currentValue < level;
}

function evaluateComparatorSweepsAbove(rawValue, ctx) {
  const [_leftPrev, leftCurrent, rightPrev, rightCurrent] = resolveCrossValues(
    rawValue,
    ctx,
  );
  const level =
    Number.isFinite(Number(rightCurrent)) ? Number(rightCurrent) :
    Number.isFinite(Number(rightPrev)) ? Number(rightPrev) :
    null;
  const currentValue = Number(leftCurrent);
  const barHigh = Number(ctx?.bar?.high);
  if (
    !Number.isFinite(level) ||
    !Number.isFinite(currentValue) ||
    !Number.isFinite(barHigh)
  ) {
    return false;
  }
  return barHigh > level && currentValue < level;
}

function evaluateComparatorSweepsBelow(rawValue, ctx) {
  const [_leftPrev, leftCurrent, rightPrev, rightCurrent] = resolveCrossValues(
    rawValue,
    ctx,
  );
  const level =
    Number.isFinite(Number(rightCurrent)) ? Number(rightCurrent) :
    Number.isFinite(Number(rightPrev)) ? Number(rightPrev) :
    null;
  const currentValue = Number(leftCurrent);
  const barLow = Number(ctx?.bar?.low);
  if (
    !Number.isFinite(level) ||
    !Number.isFinite(currentValue) ||
    !Number.isFinite(barLow)
  ) {
    return false;
  }
  return barLow < level && currentValue > level;
}

const RULE_OPERATOR_EVALUATORS = {
  ">": (values) => Number(values[0]) > Number(values[1]),
  "<": (values) => Number(values[0]) < Number(values[1]),
  ">=": (values) => Number(values[0]) >= Number(values[1]),
  "<=": (values) => Number(values[0]) <= Number(values[1]),
  "==": (values) => values[0] === values[1],
  "!=": (values) => values[0] !== values[1],
  "+": (values) => values.reduce((sum, value) => Number(sum) + Number(value), 0),
  "-": (values) =>
    values.length === 1
      ? -Number(values[0])
      : values.slice(1).reduce((sum, value) => Number(sum) - Number(value), Number(values[0])),
  "*": (values) => values.reduce((product, value) => Number(product) * Number(value), 1),
  "/": (values) =>
    values.slice(1).reduce((quotient, value) => Number(quotient) / Number(value || 1), Number(values[0])),
  abs: (values) => Math.abs(Number(values[0])),
  min: (values) => Math.min(...values.map(Number)),
  max: (values) => Math.max(...values.map(Number)),
  crosses_above: (_values, rawValue, ctx) => {
    const [leftPrev, leftCurrent, rightPrev, rightCurrent] = resolveCrossValues(
      rawValue,
      ctx,
    );
    return (
      Number.isFinite(leftPrev) &&
      Number.isFinite(leftCurrent) &&
      Number.isFinite(rightPrev) &&
      Number.isFinite(rightCurrent) &&
      Number(leftPrev) <= Number(rightPrev) &&
      Number(leftCurrent) > Number(rightCurrent)
    );
  },
  crosses_below: (_values, rawValue, ctx) => {
    const [leftPrev, leftCurrent, rightPrev, rightCurrent] = resolveCrossValues(
      rawValue,
      ctx,
    );
    return (
      Number.isFinite(leftPrev) &&
      Number.isFinite(leftCurrent) &&
      Number.isFinite(rightPrev) &&
      Number.isFinite(rightCurrent) &&
      Number(leftPrev) >= Number(rightPrev) &&
      Number(leftCurrent) < Number(rightCurrent)
    );
  },
  touches: (_values, rawValue, ctx) => evaluateComparatorTouches(rawValue, ctx),
  retest: (_values, rawValue, ctx) => evaluateComparatorRetest(rawValue, ctx),
  rejected: (_values, rawValue, ctx) => evaluateComparatorRejected(rawValue, ctx),
  holds_above: (_values, rawValue, ctx) =>
    evaluateComparatorHoldsAbove(rawValue, ctx),
  holds_below: (_values, rawValue, ctx) =>
    evaluateComparatorHoldsBelow(rawValue, ctx),
  sweeps_above: (_values, rawValue, ctx) =>
    evaluateComparatorSweepsAbove(rawValue, ctx),
  sweeps_below: (_values, rawValue, ctx) =>
    evaluateComparatorSweepsBelow(rawValue, ctx),
};

const RULE_FUNCTION_EVALUATORS = {
  touches: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("touches", args, ctx, evaluate),
  retest: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("retest", args, ctx, evaluate),
  rejected: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("rejected", args, ctx, evaluate),
  holds_above: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("holds_above", args, ctx, evaluate),
  holds_below: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("holds_below", args, ctx, evaluate),
  sweeps_above: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("sweeps_above", args, ctx, evaluate),
  sweeps_below: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("sweeps_below", args, ctx, evaluate),
  sweep: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("sweep", args, ctx, evaluate),
  has_sweep: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("has_sweep", args, ctx, evaluate),
  bos: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("bos", args, ctx, evaluate),
  has_bos: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("has_bos", args, ctx, evaluate),
  choch: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("choch", args, ctx, evaluate),
  has_choch: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("has_choch", args, ctx, evaluate),
  breakout: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("breakout", args, ctx, evaluate),
  reversal: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("reversal", args, ctx, evaluate),
  trend: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("trend", args, ctx, evaluate),
  bias: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("bias", args, ctx, evaluate),
  phase: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("phase", args, ctx, evaluate),
  price_action_sl: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("price_action_sl", args, ctx, evaluate),
  price_action_tp: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("price_action_tp", args, ctx, evaluate),
  three_candles_signal: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("three_candles_signal", args, ctx, evaluate),
  three_candles_sl: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("three_candles_sl", args, ctx, evaluate),
  three_candles_tp: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("three_candles_tp", args, ctx, evaluate),
  get_artifacts: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("get_artifacts", args, ctx, evaluate),
  is_true: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("is_true", args, ctx, evaluate),
  draw: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("draw", args, ctx, evaluate),
};

function evaluateRule(node, ctx) {
  return evaluateRuleExpression(node, ctx);
}

function resolveTradePlanFieldValue(value, ctx = null) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;
    const resolved = valueAtPath(ctx, trimmed);
    const resolvedNumeric = Number(resolved);
    return Number.isFinite(resolvedNumeric) ? resolvedNumeric : null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const resolved = evaluateRule(value, ctx);
    const resolvedNumeric = Number(resolved);
    return Number.isFinite(resolvedNumeric) ? resolvedNumeric : null;
  }
  return null;
}

function seriesBySource(bars, source = "close") {
  return bars.map((bar) => Number(bar?.[source] ?? bar?.close));
}

function computeIndicatorSeries(bars, indicator = {}) {
  const source = String(indicator.source || "close").trim() || "close";
  const values = seriesBySource(bars, source);
  const length = Number(indicator.length || indicator.period || 14);
  const field = String(indicator.field || "").trim().toLowerCase();
  switch (String(indicator.type || "").trim()) {
    case "ema":
      return emaSeries(values, length);
    case "sma":
      return smaSeries(values, length);
    case "rsi":
      return rsiSeries(values, length);
    case "roc":
      return rocSeries(values, length);
    case "macd": {
      const result = macdSeries(
        values,
        Number(indicator.fast_length || 12),
        Number(indicator.slow_length || 26),
        Number(indicator.signal_length || 9),
      );
      return result[field || "macd"] || result.macd;
    }
    case "bollinger": {
      const result = bollingerSeries(
        values,
        Number(indicator.length || 20),
        Number(indicator.stddev || 2),
      );
      return result[field || "mid"] || result.mid;
    }
    case "stochastic": {
      const result = stochasticSeries(
        bars,
        Number(indicator.length || 14),
        Number(indicator.smooth_period || 3),
      );
      return result[field || "k"] || result.k;
    }
    case "highest_high":
      return highestHighSeries(bars, length);
    case "lowest_low":
      return lowestLowSeries(bars, length);
    default:
      return new Array(values.length).fill(null);
  }
}

function resolveIndicatorNumericSetting(value, strategy = {}, fallback = null) {
  const params =
    strategy?.params && typeof strategy.params === "object" && !Array.isArray(strategy.params)
      ? strategy.params
      : {};
  const rawValue =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Object.prototype.hasOwnProperty.call(value, "var")
      ? value.var
      : value;
  if (rawValue === undefined || rawValue === null || rawValue === "") return fallback;
  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) return fallback;
    if (trimmed.startsWith("params.")) {
      const resolved = valueAtPath({ params }, trimmed);
      const numeric = Number(resolved);
      return Number.isFinite(numeric) ? numeric : fallback;
    }
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : fallback;
  }
  const numeric = Number(rawValue);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundRuleContextLevelKey(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return num.toFixed(6);
}

function extractRuleContextArtifactLevels(item = {}) {
  const candidates = [
    item?.price,
    item?.payload?.level,
    item?.payload?.source_swing_price,
    item?.payload?.swept_swing_price,
    item?.payload?.mitigation_price,
    item?.price_high,
    item?.price_low,
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return Array.from(new Set(candidates.map((value) => roundRuleContextLevelKey(value))))
    .map((key) => Number(key))
    .filter((value) => Number.isFinite(value));
}

function resolveRuleContextKeyLevel({
  bar = null,
  derivedArtifacts = [],
} = {}) {
  const supportedTypes = new Set([
    "liquidity_high",
    "liquidity_low",
    "fvg",
    "ob",
    "support",
    "demand",
    "pdh",
    "pdl",
  ]);
  const currentTime = Number(bar?.time || 0);
  const currentClose = Number(bar?.close);
  const recentArtifacts = (Array.isArray(derivedArtifacts) ? derivedArtifacts : [])
    .filter((item) => {
      const type = String(item?.type || "").trim().toLowerCase();
      if (!supportedTypes.has(type)) return false;
      const itemTime = Number(
        item?.anchor_time ?? item?.bar_end ?? item?.bar_start ?? item?.time ?? 0,
      );
      return !Number.isFinite(currentTime) || currentTime <= 0 || itemTime <= currentTime;
    })
    .slice(-12)
    .reverse();
  const levels = [];
  const seen = new Set();
  for (const item of recentArtifacts) {
    for (const level of extractRuleContextArtifactLevels(item)) {
      const key = roundRuleContextLevelKey(level);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      levels.push(level);
    }
  }
  if (!levels.length) return null;
  if (!Number.isFinite(currentClose)) return levels[0];
  return [...levels].sort((left, right) => {
    const leftDistance = Math.abs(Number(left) - currentClose);
    const rightDistance = Math.abs(Number(right) - currentClose);
    return leftDistance - rightDistance;
  })[0];
}

function buildRuleContext({
  bars,
  index,
  strategy,
  currentIndicators,
  prevIndicators,
  entry = null,
  action = "",
  extraContext = null,
  derivedArtifacts = [],
  multiTf = null,
  analysis = null,
  tf = "",
}) {
  const inferredKeyLevel = resolveRuleContextKeyLevel({
    bar: bars[index] || null,
    derivedArtifacts,
  });
  return {
    bar: bars[index] || null,
    prev: bars[index - 1] || null,
    bars,
    index,
    strategy,
    tf,
    derivedArtifacts: Array.isArray(derivedArtifacts) ? derivedArtifacts : [],
    analysis:
      analysis && typeof analysis === "object" && !Array.isArray(analysis)
        ? analysis
        : null,
    multiTf:
      multiTf && typeof multiTf === "object" && !Array.isArray(multiTf)
        ? multiTf
        : {},
    session: {
      current: normalizeBacktestSession(barSessionName((bars[index] || {}).time), "Any"),
    },
    params: strategy.params || {},
    risk: strategy.risk || {},
    levels: {
      ...(Number.isFinite(Number(inferredKeyLevel)) ? { key: Number(inferredKeyLevel) } : {}),
    },
    indicators: currentIndicators || {},
    prev_indicators: prevIndicators || {},
    entry,
    action,
    ...(extraContext && typeof extraContext === "object" && !Array.isArray(extraContext)
      ? extraContext
      : {}),
  };
}

function barSessionName(unixSeconds) {
  if (isBarInNamedSession(unixSeconds, "Asian")) return "Asian";
  if (isBarInNamedSession(unixSeconds, "London")) return "London";
  if (isBarInNamedSession(unixSeconds, "New York")) return "New York";
  return "Off Session";
}

function fallbackStopLoss(entry, action, strategy) {
  const pct = Math.max(
    0.00001,
    Number(strategy?.risk?.fallback_stop_pct || 0.001),
  );
  return action === "BUY"
    ? Number(entry) * (1 - pct)
    : Number(entry) * (1 + pct);
}

function fallbackTakeProfit(entry, action, strategy) {
  const pct = Math.max(
    0.00001,
    Number(strategy?.risk?.fallback_tp_pct || strategy?.risk?.fallback_stop_pct || 0.0015),
  );
  return action === "BUY"
    ? Number(entry) * (1 + pct)
    : Number(entry) * (1 - pct);
}

function resolveStrategyActionKind(action = {}) {
  const raw = String(action?.action || action?.type || "").trim();
  if (raw === "trade.open.long" || raw === "trade.open.short") return "trade";
  return raw;
}

function normalizeStrategyTradeDirection(value = "", fallback = "buy") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["buy", "bull", "long"].includes(normalized)) return "buy";
  if (["sell", "bear", "short"].includes(normalized)) return "sell";
  return fallback === "sell" ? "sell" : "buy";
}

function normalizeStrategyTradePlanField(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;
    return { var: trimmed };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return null;
}

function normalizeStrategyTradePlan(plan = {}, fallbackDirection = "buy") {
  const base =
    plan && typeof plan === "object" && !Array.isArray(plan)
      ? plan
      : {};
  const rrValue = Number(base?.rr ?? base?.risk_reward);
  return {
    direction: normalizeStrategyTradeDirection(
      base?.direction || base?.dir,
      fallbackDirection,
    ),
    type: String(base?.type || base?.order_type || "market").trim().toLowerCase() || "market",
    entry: normalizeStrategyTradePlanField(base?.entry ?? base?.entry_price),
    sl: normalizeStrategyTradePlanField(base?.sl ?? base?.stop_loss),
    tp1: normalizeStrategyTradePlanField(base?.tp1 ?? base?.tp ?? base?.tp2 ?? base?.tp3),
    tp: normalizeStrategyTradePlanField(base?.tp ?? base?.tp1 ?? base?.tp2 ?? base?.tp3),
    rr: Number.isFinite(rrValue) ? rrValue : null,
  };
}

function normalizeStrategyEventsForSimulation(strategy = {}) {
  if (Array.isArray(strategy?.rules) && strategy.rules.length) {
    return strategy.rules
      .map((rule, index) => {
        const ruleId =
          String(rule?.id || `rule_${index + 1}`).trim() || `rule_${index + 1}`;
        const when =
          rule?.when && typeof rule.when === "object" ? rule.when : null;
        const actions = (Array.isArray(rule?.actions) ? rule.actions : [])
          .map((action, actionIndex) => {
            const actionKind = resolveStrategyActionKind(action);
            const fallbackDirection =
              normalizeStrategyTradeDirection(
                action?.trade_plan?.direction,
                String(rule?.bias || "").trim().toLowerCase() === "bearish"
                  ? "sell"
                  : "buy",
              );
            return {
              id:
                String(action?.id || `${ruleId}_action_${actionIndex + 1}`).trim() ||
                `${ruleId}_action_${actionIndex + 1}`,
              action: actionKind,
              trade_plan:
                actionKind === "trade"
                  ? normalizeStrategyTradePlan(action?.trade_plan, fallbackDirection)
                  : undefined,
              message: action?.message || action?.label || "",
              color: action?.color || "",
              url: action?.url || "",
              method: action?.method || "",
            };
          })
          .filter((action) => action.action);
        return {
          id: ruleId,
          name: String(rule?.name || ruleId).trim() || ruleId,
          when,
          actions,
        };
      })
      .filter((rule) => rule.when);
  }
  if (Array.isArray(strategy?.events) && strategy.events.length) {
    return strategy.events
      .map((event, index) => {
        const eventId =
          String(event?.id || `event_${index + 1}`).trim() || `event_${index + 1}`;
        const when =
          event?.when && typeof event.when === "object" ? event.when : null;
        const actions = (Array.isArray(event?.actions) ? event.actions : [])
          .map((action, actionIndex) => {
            const actionKind = resolveStrategyActionKind(action);
            const fallbackDirection =
              normalizeStrategyTradeDirection(
                action?.trade_plan?.direction,
                /bear|short|sell/i.test(String(event?.name || eventId))
                  ? "sell"
                  : "buy",
              );
            return {
              id:
                String(action?.id || `${eventId}_action_${actionIndex + 1}`).trim() ||
                `${eventId}_action_${actionIndex + 1}`,
              action: actionKind,
              trade_plan:
                actionKind === "trade"
                  ? normalizeStrategyTradePlan(action?.trade_plan, fallbackDirection)
                  : undefined,
              message: action?.message || "",
              url: action?.url || "",
              method: action?.method || "",
            };
          })
          .filter((action) => action.action);
        return {
          id: eventId,
          name: String(event?.name || eventId).trim() || eventId,
          when,
          actions,
        };
      })
      .filter((event) => event.when);
  }
  const rules =
    strategy?.rules && typeof strategy.rules === "object" && !Array.isArray(strategy.rules)
      ? strategy.rules
      : {};
  const legacyEvents = [
    [["bullish", "entry_long"], "Bullish", "buy", "bullish"],
    [["bearish", "entry_short"], "Bearish", "sell", "bearish"],
  ];
  return legacyEvents
    .map(([ruleKeys, name, direction, id]) => ({
      id,
      name,
      direction,
      when: ruleKeys.map((key) => rules[key]).find(Boolean) || null,
    }))
    .filter((event) => event.when)
    .map((event) => ({
      id: event.id,
      name: event.name,
      when: event.when,
      actions: [
        {
          id: `${event.id}_action`,
          action: "trade",
          trade_plan: normalizeStrategyTradePlan({}, event.direction),
        },
      ],
    }));
}

function buildStrategySignalDefinitionsForSimulation(strategy = {}) {
  const strategyId =
    String(strategy?.id || strategy?.key || "strategy").trim() || "strategy";
  const strategyName = String(strategy?.name || strategyId).trim() || strategyId;
  return normalizeStrategyEventsForSimulation(strategy).map((event, index) => {
    const eventId = String(event?.id || `event_${index + 1}`).trim() || `event_${index + 1}`;
    return {
      id: `${strategyId}:${eventId}`,
      name: `${strategyName} / ${String(event?.name || eventId).trim() || eventId}`,
      event_logic: { event: eventId },
      actions: Array.isArray(event?.actions) ? event.actions : [],
      metadata: {
        source_strategy_id: strategyId,
        source_event_id: eventId,
      },
    };
  });
}

function summarizeStrategySignal(signal = {}) {
  return {
    id: String(signal?.id || "").trim(),
    strategy_id: String(signal?.strategy_id || "").trim(),
    strategy_name: String(signal?.strategy_name || "").trim(),
    source_strategy_id: String(signal?.metadata?.source_strategy_id || "").trim(),
    source_event_id: String(signal?.metadata?.source_event_id || "").trim(),
    time: Number.isFinite(Number(signal?.time)) ? Number(signal.time) : null,
    bar_index: Number.isFinite(Number(signal?.bar_index)) ? Number(signal.bar_index) : null,
    symbol: String(signal?.symbol || "").trim().toUpperCase(),
    tf: String(signal?.tf || "").trim(),
    events: Array.isArray(signal?.events) ? signal.events : [],
    actions: Array.isArray(signal?.actions) ? signal.actions : [],
  };
}

function groupStrategySignalsByEventId(signals = []) {
  const grouped = new Map();
  for (const signal of Array.isArray(signals) ? signals : []) {
    const eventId = String(signal?.metadata?.source_event_id || "").trim();
    if (!eventId) continue;
    if (!grouped.has(eventId)) grouped.set(eventId, []);
    grouped.get(eventId).push(summarizeStrategySignal(signal));
  }
  return grouped;
}

function applyEventActionToSignalState(signalState, action = {}) {
  const actionKind = resolveStrategyActionKind(action);
  if (actionKind !== "trade") return;
  const tradePlan = normalizeStrategyTradePlan(action?.trade_plan, "buy");
  if (tradePlan.direction === "sell") {
    signalState.sell = true;
    signalState.trade_plan_sell = tradePlan;
    return;
  }
  signalState.buy = true;
  signalState.trade_plan_buy = tradePlan;
}

function simulateStrategy(bars, strategy, options = {}) {
  const hasRules =
    strategy &&
    typeof strategy === "object" &&
    (
      (Array.isArray(strategy.rules) && strategy.rules.length > 0) ||
      (strategy.rules &&
        typeof strategy.rules === "object" &&
        !Array.isArray(strategy.rules))
    );
  const hasEvents =
    strategy &&
    typeof strategy === "object" &&
    Array.isArray(strategy.events) &&
    strategy.events.length > 0;
  const isRuleBasedStrategy =
    (hasRules || hasEvents) &&
    Array.isArray(strategy.indicators) &&
    ["42trade.strategy.v1", "42trade.strategy.v2"].includes(
      String(strategy.engine_version || "").trim(),
    );
  if (isRuleBasedStrategy) {
    return simulateRuleBasedStrategy(bars, strategy, options);
  }
  if (String(strategy?.kind || "").trim() === "custom") {
    return simulateRuleBasedStrategy(bars, strategy, options);
  }
  throw new Error(
    `Unsupported preset strategy: ${String(strategy?.key || "unknown")}`,
  );
}

function resolveRuleIndicatorDefinition(indicator = {}, strategy = {}) {
  const indicatorId = String(indicator?.id || "").trim();
  const indicatorType = String(indicator?.type || "").trim();
  const params = strategy?.params && typeof strategy.params === "object"
    ? strategy.params
    : {};
  const resolvedLength =
    indicator.length ??
    indicator.period ??
    params[`${indicatorId}_length`] ??
    params[`${indicatorId}_period`] ??
    (indicatorId === "ema_fast"
      ? params.fast_period
      : indicatorId === "ema_slow"
        ? params.slow_period
        : undefined);
  return {
    ...indicator,
    ...(resolvedLength !== undefined
      ? { length: resolveIndicatorNumericSetting(resolvedLength, strategy, resolvedLength) }
      : {}),
    ...(resolvedLength !== undefined
      ? { period: resolveIndicatorNumericSetting(resolvedLength, strategy, resolvedLength) }
      : {}),
    fast_length: resolveIndicatorNumericSetting(indicator?.fast_length, strategy, indicator?.fast_length),
    slow_length: resolveIndicatorNumericSetting(indicator?.slow_length, strategy, indicator?.slow_length),
    signal_length: resolveIndicatorNumericSetting(indicator?.signal_length, strategy, indicator?.signal_length),
    stddev: resolveIndicatorNumericSetting(indicator?.stddev, strategy, indicator?.stddev),
    smooth_period: resolveIndicatorNumericSetting(indicator?.smooth_period, strategy, indicator?.smooth_period),
    type: indicatorType,
  };
}

function simulateRuleBasedStrategy(bars, strategy, options = {}) {
  const indicators = {};
  const contextIndex = buildBacktestContextIndex(options, strategy);
  const normalizedTf = strategyEventFunctions.normalizeTfKey(
    options?.tf || strategy?.market?.tf || "",
  );
  const strategyScanEngine = createStrategyScanEngine({
    strategy,
    scanMode: options?.scanMode || "backtest",
    skipConditions: options?.skipConditions !== false,
    tf: options?.tf || strategy?.market?.tf || "",
    symbol: options?.symbol || strategy?.market?.symbol || "",
    newsEvents: options?.newsEvents || options?.news_events || [],
  });
  if (!strategyScanEngine.isStrategyAllowed().allowed) {
    return {
      trades: [],
      equity_curve: [],
      summary: {
        bars_analyzed: Array.isArray(bars) ? bars.length : 0,
        total_trades: 0,
        generated_signals: 0,
        triggered_events: 0,
        triggered_actions: 0,
      },
      event_log: [],
    };
  }
  const multiTfData =
    options?.multiTfData && typeof options.multiTfData === "object"
      ? options.multiTfData
      : {};
  const barsByTfForEvaluation = {
    [normalizedTf]: Array.isArray(bars) ? bars : [],
  };
  Object.entries(multiTfData || {}).forEach(([tfKey, item]) => {
    const normalizedKey = strategyEventFunctions.normalizeTfKey(tfKey);
    const tfBars = Array.isArray(item?.bars) ? item.bars : [];
    if (!normalizedKey || !tfBars.length || normalizedKey === normalizedTf) return;
    barsByTfForEvaluation[normalizedKey] = tfBars;
  });
  const derivedArtifacts =
    Array.isArray(multiTfData?.[normalizedTf]?.derivedArtifacts)
      ? multiTfData[normalizedTf].derivedArtifacts
      : sharedArtifactDetection.buildDerivedItemsFromBars(
          Array.isArray(bars) ? bars : [],
          normalizedTf,
        );
  const evaluation = evaluateChartStrategies({
    bars: Array.isArray(bars) ? bars : [],
    strategies: [strategy],
    lookbackBars: Array.isArray(bars) ? bars.length : 0,
    symbol: String(options?.symbol || strategy?.market?.symbol || "").trim().toUpperCase(),
    tf: options?.tf || strategy?.market?.tf || "",
    multiTfBars: barsByTfForEvaluation,
    scanMode: options?.scanMode || "backtest",
    skipConditions: options?.skipConditions !== false,
    newsEvents: options?.newsEvents || options?.news_events || [],
    runtimeState: {
      spread:
        asOptionalFiniteNumber(options?.spreadPips, null) ??
        asOptionalFiniteNumber(options?.marketMetadata?.spread_pips, null) ??
        asOptionalFiniteNumber(options?.brokerCalibration?.spread_pips, null) ??
        null,
    },
  });
  const hitsByBarIndex = new Map();
  for (const hit of Array.isArray(evaluation?.matches) ? evaluation.matches : []) {
    const barIndex = Number(hit?.barIndex);
    if (!Number.isFinite(barIndex) || barIndex < 0) continue;
    if (!hitsByBarIndex.has(barIndex)) hitsByBarIndex.set(barIndex, []);
    hitsByBarIndex.get(barIndex).push(hit);
  }
  const eventLog = [];
  const strategySignalDefinitions = buildStrategySignalDefinitionsForSimulation(strategy);
  const strategySignalLog = [];
  for (const indicator of Array.isArray(strategy.indicators) ? strategy.indicators : []) {
    if (!indicator?.id) continue;
    indicators[indicator.id] = computeIndicatorSeries(
      bars,
      resolveRuleIndicatorDefinition(indicator, strategy),
    );
  }
  const result = simulateSignalStrategy(bars, strategy, (i) => {
    const currentIndicators = {};
    const prevIndicators = {};
    for (const [indicatorId, series] of Object.entries(indicators)) {
      currentIndicators[indicatorId] = series[i];
      prevIndicators[indicatorId] = series[i - 1];
    }
    const ctx = {
      ...buildRuleContext({
        bars,
        index: i,
        strategy,
        currentIndicators,
        prevIndicators,
        extraContext: contextIndex.get(Number(bars[i]?.time || 0)) || null,
        derivedArtifacts,
        tf: options?.tf || strategy?.market?.tf || "",
        multiTf: multiTfData,
      }),
    };
    const signalState = {
      buy: false,
      sell: false,
      trade_plan_buy: null,
      trade_plan_sell: null,
      exit_long: false,
      exit_short: false,
      stop_loss_long: strategy.rules?.stop_loss_long,
      stop_loss_short: strategy.rules?.stop_loss_short,
      take_profit_long: strategy.rules?.take_profit_long,
      take_profit_short: strategy.rules?.take_profit_short,
      ctx,
    };
    const hits = hitsByBarIndex.get(i) || [];
    const strategySignals = evaluateStrategies({
      events: hits.map((hit) => hit?.ruleEvent).filter(Boolean),
      strategies: strategySignalDefinitions,
    }).signals;
    const signalsByEventId = groupStrategySignalsByEventId(strategySignals);
    strategySignalLog.push(...strategySignals.map((signal) => summarizeStrategySignal(signal)));
    for (const hit of hits) {
      const hitStrategySignals = signalsByEventId.get(String(hit?.eventId || "").trim()) || [];
      const primaryStrategySignal = hitStrategySignals[0] || null;
      const tradePlans = Array.isArray(hit?.tradePlans) ? hit.tradePlans : [];
      let tradePlanCursor = 0;
      for (const strategySignal of hitStrategySignals) {
        for (const action of Array.isArray(strategySignal?.actions) ? strategySignal.actions : []) {
          const actionKind = resolveStrategyActionKind(action);
          const sharedTradePlan =
            actionKind === "trade" ? tradePlans[tradePlanCursor++] || null : null;
          const eventTradePlan = sharedTradePlan
            ? normalizeStrategyTradePlan(
                {
                  direction: sharedTradePlan.direction,
                  type: sharedTradePlan.type,
                  entry: sharedTradePlan.entry,
                  sl: sharedTradePlan.sl,
                  tp: sharedTradePlan.tp,
                },
                String(sharedTradePlan.direction || "").trim().toLowerCase() === "sell"
                  ? "sell"
                  : "buy",
              )
            : null;
          if (eventTradePlan) {
            applyEventActionToSignalState(signalState, {
              ...action,
              trade_plan: eventTradePlan,
            });
          }
          eventLog.push({
            event_id: hit?.eventId || "",
            event_name: hit?.eventName || "",
            strategy_signal_id: strategySignal?.id || primaryStrategySignal?.id || "",
            strategy_signal_strategy_id:
              strategySignal?.strategy_id || primaryStrategySignal?.strategy_id || "",
            strategy_signal_event_id:
              strategySignal?.source_event_id || primaryStrategySignal?.source_event_id || "",
            action_id: action?.id || "",
            action_type: actionKind,
            action: actionKind,
            trade_plan: eventTradePlan,
            message: action?.message || "",
            url: action?.url || "",
            method: action?.method || "",
            symbol: String(strategy?.market?.symbol || options?.symbol || "").trim().toUpperCase(),
            tf: String(strategy?.market?.tf || options?.tf || "").trim(),
            bar_index: i,
            bar_time_unix: Number(bars[i]?.time || 0),
            bar_time: toIsoFromUnixSeconds(bars[i]?.time),
            bar_close: round(Number(bars[i]?.close), 5),
            rule_event: hit?.ruleEvent || null,
            strategy_signals: hitStrategySignals,
            artifacts: Array.isArray(hit?.artifacts) ? hit.artifacts : [],
          });
        }
      }
    }
    return signalState;
  }, options);
  if (options && options.returnDetails && result && typeof result === "object") {
    result.event_log = eventLog;
    result.strategy_signals = strategySignalLog;
  }
  return result;
}

function summarizeTrades(trades = [], bars = [], strategy = null, details = {}) {
  const strategyParamsText = formatBacktestStrategyParamsText(strategy);
  const totalTrades = trades.length;
  const wins = trades.filter((trade) => trade.result === "win").length;
  const losses = trades.filter((trade) => trade.result === "loss").length;
  const flats = trades.filter((trade) => trade.result === "flat").length;
  const totalPnl = trades.reduce(
    (sum, trade) => sum + Number(trade.pnl_realized || 0),
    0,
  );
  const totalRealizedR = trades.reduce(
    (sum, trade) =>
      sum +
      Number(
        trade.realized_r ??
          trade.r_multiple ??
          trade.rr_realized ??
          trade.rr ??
          0,
      ),
    0,
  );
  const totalPlannedOutcomeR = trades.reduce(
    (sum, trade) =>
      sum +
      Number(
        trade.planned_outcome_r ??
          trade.plannedOutcomeR ??
          0,
      ),
    0,
  );
  const actionLog = Array.isArray(details.event_log) ? details.event_log : [];
  const strategySignalCount = new Set(
    actionLog
      .map((entry) => String(entry?.strategy_signal_id || "").trim())
      .filter(Boolean),
  ).size;
  const triggeredEventCount = new Set(
    actionLog.map(
      (entry) => `${String(entry?.bar_index ?? "")}:${String(entry?.event_id || "")}`,
    ),
  ).size;
  return {
    bars_analyzed: bars.length,
    total_trades: totalTrades,
    generated_signals: totalTrades,
    strategy_signals: strategySignalCount,
    triggered_events: triggeredEventCount,
    triggered_actions: actionLog.length,
    wins,
    losses,
    flats,
    win_rate_pct: totalTrades ? round((wins / totalTrades) * 100, 2) : 0,
    total_pnl: round(totalPnl, 5),
    average_pnl: totalTrades ? round(totalPnl / totalTrades, 5) : 0,
    total_realized_r: round(totalRealizedR, 5),
    average_realized_r: totalTrades ? round(totalRealizedR / totalTrades, 5) : 0,
    total_planned_outcome_r: round(totalPlannedOutcomeR, 5),
    average_planned_outcome_r: totalTrades
      ? round(totalPlannedOutcomeR / totalTrades, 5)
      : 0,
    total_r: round(totalRealizedR, 5),
    average_r: totalTrades ? round(totalRealizedR / totalTrades, 5) : 0,
    strategy_key: strategy?.key || strategy?.id || null,
    strategy_id: strategy?.id || null,
    strategy_name: strategy?.name || null,
    backtest_params_text: strategyParamsText || null,
    initial_equity: details.initial_equity ?? null,
    final_equity: details.final_equity ?? null,
    max_drawdown_pct: details.max_drawdown_pct ?? null,
    execution_options:
      details.execution_options && typeof details.execution_options === "object"
        ? details.execution_options
        : null,
    first_bar_at: bars[0] ? toIsoFromUnixSeconds(bars[0].time) : null,
    last_bar_at: bars.length
      ? toIsoFromUnixSeconds(bars[bars.length - 1].time)
      : null,
  };
}

function formatBacktestParamValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return Number.isInteger(value) ? String(value) : String(value);
  }
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.toLowerCase() === "continue") return "Continue";
  if (text.toLowerCase() === "reverse") return "Reverse";
  return text;
}

function formatGenericBacktestParamsText(params = {}) {
  if (!params || typeof params !== "object" || Array.isArray(params)) return "";
  return Object.entries(params)
    .map(([key, value]) => {
      const formattedValue = formatBacktestParamValue(value);
      if (!formattedValue) return "";
      return `${String(key || "").trim()}: ${formattedValue}`;
    })
    .filter(Boolean)
    .join(" | ");
}

function formatBacktestStrategyParamsText(strategy = null) {
  const params =
    strategy?.params && typeof strategy.params === "object" && !Array.isArray(strategy.params)
      ? strategy.params
      : {};
  if (!Object.keys(params).length) return "";
  const strategyKey = String(strategy?.key || strategy?.id || "").trim().toLowerCase();
  if (strategyKey === "three_candles_v1") {
    const parts = [
      `Candles Num ${formatBacktestParamValue(params.candles_count) || "3"}`,
      `SL Candle Num ${formatBacktestParamValue(params.sl_candle_num) || "1"}`,
      `TP/SL RR ${formatBacktestParamValue(params.reward_risk) || "1"}`,
      `Trade Direction ${formatBacktestParamValue(params.direction_mode) || "Continue"}`,
    ];
    return parts.filter(Boolean).join(" | ");
  }
  return formatGenericBacktestParamsText(params);
}

async function listRunDirs(root) {
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch((error) => {
    if (error && error.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
}

function normalizeBacktestRecordPayload(row = null) {
  const data = row?.data && typeof row.data === "object" ? row.data : null;
  if (!data || !data.run || typeof data.run !== "object") return null;
  return {
    ok: true,
    run: {
      ...data.run,
      status: String(row?.status || data.run.status || "completed"),
      updated_at: row?.updated_at || data.run.updated_at || null,
    },
    summary:
      data.summary && typeof data.summary === "object" ? data.summary : null,
    trades: Array.isArray(data.trades) ? data.trades : [],
    events: Array.isArray(data.events) ? data.events : [],
  };
}

async function getBacktestRecordFromObjectStore(userId, runId) {
  const row = await objectStore.getObject(userId, "backtests", runId);
  return normalizeBacktestRecordPayload(row);
}

async function readLegacyBacktestRun(runDir) {
  const manifest = await readJsonFile(path.join(runDir, "manifest.json"), null);
  if (!manifest) return null;
  const [summary, trades, events] = await Promise.all([
    readJsonFile(path.join(runDir, "summary.json"), manifest.summary || null),
    readJsonFile(path.join(runDir, "trades.json"), []),
    readJsonFile(path.join(runDir, "events.json"), []),
  ]);
  return {
    ok: true,
    run: manifest,
    summary,
    trades,
    events,
  };
}

async function listPersistedBacktestRecords(userId) {
  const repoRows = await objectStore.listObjectsByType(userId, "backtests").catch(
    () => [],
  );
  const repoRecords = repoRows
    .map((row) => normalizeBacktestRecordPayload(row))
    .filter(Boolean);

  const legacyRoot = backtestsRoot(userId);
  ensureDir(legacyRoot);
  const [legacyRunDirs, nestedRunDirs] = await Promise.all([
    listRunDirs(legacyRoot),
    listStrategyRunDirs(userId),
  ]);
  const legacyRecords = (
    await Promise.all(
      [...nestedRunDirs, ...legacyRunDirs].map((dir) => readLegacyBacktestRun(dir)),
    )
  ).filter(Boolean);

  const seen = new Set();
  const records = [];
  for (const record of [...repoRecords, ...legacyRecords]) {
    const runId = String(record?.run?.run_id || "").trim();
    if (!record?.run || !runId || seen.has(runId)) continue;
    seen.add(runId);
    records.push(record);
  }
  records.sort((left, right) =>
    String(
      right?.run?.updated_at || right?.run?.completed_at || right?.run?.started_at || "",
    ).localeCompare(
      String(
        left?.run?.updated_at || left?.run?.completed_at || left?.run?.started_at || "",
      ),
    ),
  );
  return records;
}

function buildBacktestSummaryIndex(records = []) {
  const grouped = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const strategyKey = strategySummaryKeyForRun(record?.run);
    if (!strategyKey) continue;
    if (!grouped.has(strategyKey)) grouped.set(strategyKey, []);
    grouped.get(strategyKey).push(record);
  }
  const summaryIndex = new Map();
  for (const [strategyKey, strategyRecords] of grouped.entries()) {
    const summary = summarizeStrategyBacktestRecords(strategyRecords);
    if (summary) summaryIndex.set(strategyKey, summary);
  }
  return summaryIndex;
}

function attachBacktestSummaryToStrategies(strategies = [], summaryIndex = new Map()) {
  return (Array.isArray(strategies) ? strategies : []).map((strategy) => {
    const strategyKey = strategySummaryKeyForItem(strategy);
    const summary = strategyKey ? summaryIndex.get(strategyKey) || null : null;
    return {
      ...strategy,
      backtest_summary: summary,
    };
  });
}

async function listStrategyRunDirs(userId) {
  const strategiesDir = path.join(userRootDir(userId), "strategies");
  const strategyEntries = await fsp.readdir(strategiesDir, { withFileTypes: true }).catch((error) => {
    if (error && error.code === "ENOENT") return [];
    throw error;
  });
  const out = [];
  for (const entry of strategyEntries) {
    if (!entry.isDirectory()) continue;
    const runDirs = await listRunDirs(path.join(strategiesDir, entry.name, "runs"));
    out.push(...runDirs);
  }
  return out;
}

async function resolveRunDir(userId, runId, strategyKey = "") {
  if (strategyKey) {
    const nestedDir = strategyBacktestRunDir(userId, strategyKey, runId);
    if (fs.existsSync(path.join(nestedDir, "manifest.json"))) return nestedDir;
  }
  const nestedRunDirs = await listStrategyRunDirs(userId);
  for (const dir of nestedRunDirs) {
    if (path.basename(dir) !== safePathPart(runId)) continue;
    if (fs.existsSync(path.join(dir, "manifest.json"))) return dir;
  }
  return backtestRunDir(userId, runId);
}

async function persistBacktestResult(userId, result = {}) {
  const run = result?.run && typeof result.run === "object" ? result.run : null;
  const summary =
    result?.summary && typeof result.summary === "object" ? result.summary : null;
  const trades = Array.isArray(result?.trades) ? result.trades : [];
  const events = Array.isArray(result?.events) ? result.events : [];
  if (!run?.run_id) {
    throw new Error("run.run_id is required");
  }
  const strategyKeyForPath =
    String(run.strategy_key || run.strategy_id || "default").trim() || "default";
  const runDir = strategyBacktestRunDir(userId, strategyKeyForPath, run.run_id);
  ensureDir(runDir);
  const completedAt =
    String(run.completed_at || run.updated_at || new Date().toISOString()).trim() ||
    new Date().toISOString();
  const finalManifest = {
    ...run,
    user_id: userId,
    status: "completed",
    summary: summary || run.summary || null,
    updated_at: completedAt,
    completed_at: completedAt,
    persisted_at: new Date().toISOString(),
    ephemeral: false,
  };
  await objectStore.upsertObject(
    userId,
    "backtests",
    finalManifest.run_id,
    {
      run: finalManifest,
      summary: summary || finalManifest.summary || null,
      trades,
      events,
    },
    "COMPLETED",
    {
      created_at: finalManifest.started_at || finalManifest.created_at || completedAt,
      updated_at: completedAt,
    },
  );
  await fsp.rm(runDir, { recursive: true, force: true }).catch(() => {});
  return {
    ok: true,
    run: finalManifest,
    summary: summary || finalManifest.summary || null,
    trades,
    events,
    strategies: await listAvailableStrategies(userId),
  };
}

async function runBacktest(userId, payload = {}) {
  const symbol = String(payload.symbol || "").trim().toUpperCase();
  const tf = String(payload.tf || payload.timeframe || "15").trim();
  const requestedLimit = Number(payload.limit);
  const limit =
    requestedLimit === 0
      ? 0
      : Math.max(100, Math.min(requestedLimit || DEFAULT_LIMIT, MAX_LIMIT));
  const strategyKey = String(
    payload.strategy_id || payload.strategy_key || payload.strategy || "",
  ).trim();
  let strategy = null;
  if (strategyKey) {
    strategy =
      (await strategyConfigService.getStrategy(userId, strategyKey).catch(() => null)) ||
      (await findStrategy(strategyKey));
  }
  if (!strategy && payload.strategy_config && typeof payload.strategy_config === "object") {
    const validation = await strategyConfigService.validateStrategyPayload(
      payload.strategy_config,
    );
    if (!validation.ok) {
      throw new Error(validation.errors.join("; "));
    }
    strategy = validation.strategy;
  }
  if (!strategy) {
    strategy = await findStrategy("ema_cross_v1");
  }
  if (!symbol) {
    throw new Error("symbol is required");
  }

  const { bars, diagnostics } = normalizeBars(symbol, tf, limit);
  const minBars = Math.max(
    20,
    Number(strategy.min_bars || strategy?.params?.slow_period || 20),
  );
  if (bars.length < minBars) {
    throw new Error(
      `Not enough bars for strategy "${String(strategy?.name || strategy?.key || strategyKey || "selected strategy").trim()}" on ${symbol} ${tf}: loaded ${bars.length}, required ${minBars}.`,
    );
  }

  const marketMetadata = await loadMarketExecutionMetadata(userId, symbol);
  const brokerCalibration = await fetchBrokerCalibration(symbol, payload);
  const normalizedDirection = normalizeBacktestDirection(payload.direction, "all");
  const normalizedSession = normalizeBacktestSession(payload.session, "Any");
  const normalizedOneRValue = asFiniteNumber(payload.one_r_value, null);

  const runId = makeRunId();
  const startedAt = new Date().toISOString();
  const shouldPersist = payload?.persist === true;
  const strategyKeyForPath =
    String(strategy?.key || strategy?.id || strategyKey || "default").trim() || "default";

  const manifest = {
    run_id: runId,
    user_id: userId,
    symbol,
    tf,
    limit,
    direction: normalizedDirection,
    session: normalizedSession,
    one_r_value: normalizedOneRValue,
    status: "running",
    strategy_key: strategyKeyForPath,
    strategy_id: strategy.id || null,
    strategy_name: strategy.name,
    strategy_snapshot: strategy,
    market_data_quality: diagnostics,
    market_metadata: marketMetadata,
    broker_calibration: brokerCalibration,
    execution_options: resolveExecutionOptions(strategy, {
      ...payload,
      direction: normalizedDirection,
      session: normalizedSession,
      marketMetadata,
      brokerCalibration,
    }),
    started_at: startedAt,
    updated_at: startedAt,
    ephemeral: !shouldPersist,
  };

  const multiTfData = buildMultiTimeframeContext(symbol, tf, limit, strategy);

  const executionResult = simulateStrategy(bars, strategy, {
    ...payload,
    scanMode: payload?.scan_mode || payload?.scanMode || "backtest",
    skipConditions:
      payload?.skip_conditions === undefined && payload?.skipConditions === undefined
        ? true
        : payload?.skip_conditions !== false && payload?.skipConditions !== false,
    direction: normalizedDirection,
    session: normalizedSession,
    marketMetadata,
    brokerCalibration,
    multiTfData,
    returnDetails: true,
  });
  const trades = executionResult.trades.map((trade, index) => {
    const sid = makeTradeSid(runId, index);
    return {
      ...trade,
      sid,
    };
  });

  const summary = {
    ...summarizeTrades(trades, bars, strategy, executionResult),
    market_data_quality: diagnostics,
    market_metadata: marketMetadata,
    equity_curve: executionResult.equity_curve,
    broker_calibration: brokerCalibration,
  };
  const completedAt = new Date().toISOString();
  const finalManifest = {
    ...manifest,
    status: "completed",
    completed_at: completedAt,
    updated_at: completedAt,
    summary,
  };
  const result = {
    ok: true,
    run: finalManifest,
    summary,
    trades,
    events: Array.isArray(executionResult.event_log) ? executionResult.event_log : [],
    strategies: await listAvailableStrategies(userId),
  };
  if (!shouldPersist) {
    return result;
  }
  return persistBacktestResult(userId, result);
}

async function buildSharedBatchContextForSymbols({
  userId = "default",
  symbols = [],
  timeframes = [],
  strategies = [],
  limit = 0,
  payload = {},
} = {}) {
  const contextBySymbol = new Map();
  const requestedTfs = new Set(
    (Array.isArray(timeframes) ? timeframes : []).map((tf) =>
      strategyEventFunctions.normalizeTfKey(tf),
    ).filter(Boolean),
  );
  for (const strategy of Array.isArray(strategies) ? strategies : []) {
    for (const tf of requestedTfs) {
      collectStrategyRequestedTimeframes(strategy, tf).forEach((item) => {
        const normalized = strategyEventFunctions.normalizeTfKey(item);
        if (normalized) requestedTfs.add(normalized);
      });
    }
  }
  for (const symbol of Array.isArray(symbols) ? symbols : []) {
    const symbolKey = String(symbol || "").trim().toUpperCase();
    if (!symbolKey) continue;
    const marketMetadata = await loadMarketExecutionMetadata(userId, symbolKey);
    const brokerCalibration = await fetchBrokerCalibration(symbolKey, payload);
    const byTf = {};
    for (const tf of requestedTfs) {
      const normalized = normalizeBars(symbolKey, tf, limit);
      byTf[tf] = {
        bars: normalized.bars,
        diagnostics: normalized.diagnostics,
        derivedArtifacts: sharedArtifactDetection.buildDerivedItemsFromBars(
          normalized.bars,
          tf,
        ),
        analysis: null,
      };
    }
    contextBySymbol.set(symbolKey, { marketMetadata, brokerCalibration, byTf });
  }
  return contextBySymbol;
}

function simulateBacktestFromSharedContext({
  payload = {},
  strategy = null,
  strategyKey = "",
  symbol = "",
  tf = "",
  limit = 0,
  sharedContext = null,
} = {}) {
  const symbolKey = String(symbol || "").trim().toUpperCase();
  const tfKey = strategyEventFunctions.normalizeTfKey(tf);
  const strategyLabel = String(strategy?.name || strategyKey || "Strategy").trim();
  const tfContext = sharedContext?.byTf?.[tfKey] || null;
  const bars = Array.isArray(tfContext?.bars) ? tfContext.bars : [];
  const diagnostics = tfContext?.diagnostics || null;
  const minBars = Math.max(
    20,
    Number(strategy?.min_bars || strategy?.params?.slow_period || 20),
  );
  if (bars.length < minBars) {
    throw new Error(
      `Not enough bars for strategy "${strategyLabel}" on ${symbolKey} ${tf}: loaded ${bars.length}, required ${minBars}.`,
    );
  }
  const normalizedDirection = normalizeBacktestDirection(payload.direction, "all");
  const normalizedSession = normalizeBacktestSession(payload.session, "Any");
  const marketMetadata = sharedContext?.marketMetadata || null;
  const brokerCalibration = sharedContext?.brokerCalibration || null;
  const executionResult = simulateStrategy(bars, strategy, {
    ...payload,
    symbol: symbolKey,
    tf,
    scanMode: payload?.scan_mode || payload?.scanMode || "backtest",
    skipConditions:
      payload?.skip_conditions === undefined && payload?.skipConditions === undefined
        ? true
        : payload?.skip_conditions !== false && payload?.skipConditions !== false,
    direction: normalizedDirection,
    session: normalizedSession,
    marketMetadata,
    brokerCalibration,
    multiTfData: sharedContext?.byTf || {},
    returnDetails: true,
  });
  const runId = makeRunId();
  const trades = (Array.isArray(executionResult?.trades) ? executionResult.trades : []).map(
    (trade, index) => ({
      ...trade,
      sid: makeTradeSid(runId, index),
    }),
  );
  const summary = {
    ...summarizeTrades(trades, bars, strategy, executionResult),
    market_data_quality: diagnostics,
    market_metadata: marketMetadata,
    equity_curve: executionResult.equity_curve,
    broker_calibration: brokerCalibration,
  };
  return {
    ok: true,
    run: {
      run_id: runId,
      symbol: symbolKey,
      tf,
      limit,
      direction: normalizedDirection,
      session: normalizedSession,
      one_r_value: asFiniteNumber(payload.one_r_value, null),
      strategy_key: strategyKey,
      strategy_id: strategy?.id || strategyKey || null,
      strategy_name: strategyLabel,
      strategy_snapshot: strategy,
      market_metadata: marketMetadata,
      broker_calibration: brokerCalibration,
      execution_options: resolveExecutionOptions(strategy, {
        ...payload,
        symbol: symbolKey,
        tf,
        direction: normalizedDirection,
        session: normalizedSession,
        marketMetadata,
        brokerCalibration,
      }),
      summary,
      status: "completed",
      ephemeral: true,
    },
    summary,
    trades,
    events: Array.isArray(executionResult.event_log) ? executionResult.event_log : [],
  };
}

async function runBacktestBatch(userId, payload = {}) {
  const requestedSymbols = normalizeSymbolList(
    payload.symbols || payload.effective_symbols || [],
  );
  const requestedTimeframes = normalizeBatchTimeframes(
    payload.timeframes || payload.tfs || payload.tf || DEFAULT_BATCH_TIMEFRAMES,
  );
  if (!requestedSymbols.length) {
    throw new Error("At least one symbol is required");
  }
  if (!requestedTimeframes.length) {
    throw new Error("At least one timeframe is required");
  }

  const requestedStrategyIds = [...new Set(
    (Array.isArray(payload.strategy_ids) ? payload.strategy_ids : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
  const availableStrategies = await listAvailableStrategies(userId);
  const strategies = requestedStrategyIds.length
    ? availableStrategies.filter((item) =>
        requestedStrategyIds.includes(String(item?.key || item?.id || "").trim()),
      )
    : availableStrategies;
  if (!strategies.length) {
    throw new Error("No strategies available for batch run");
  }

  const rows = [];
  let completed = 0;
  let failed = 0;
  let totalTrades = 0;
  let totalPnl = 0;
  let totalR = 0;
  let weightedWins = 0;
  const combinedTrades = [];
  const combinedEvents = [];
  const firstBarTimes = [];
  const lastBarTimes = [];
  const barsAnalyzedValues = [];
  const matrix = new Map();
  const startedAt = new Date().toISOString();
  const requestedLimit = Number(payload?.limit);
  const limit =
    requestedLimit === 0
      ? 0
      : Math.max(100, Math.min(requestedLimit || DEFAULT_LIMIT, MAX_LIMIT));
  const sharedContexts = await buildSharedBatchContextForSymbols({
    userId,
    symbols: requestedSymbols,
    timeframes: requestedTimeframes,
    strategies,
    limit,
    payload,
  });

  for (const strategy of strategies) {
    const strategyKey = String(strategy?.key || strategy?.id || "").trim();
    for (const symbol of requestedSymbols) {
      for (const tf of requestedTimeframes) {
        try {
          const result = simulateBacktestFromSharedContext({
            payload,
            strategy,
            strategyKey,
            symbol,
            tf,
            limit,
            sharedContext: sharedContexts.get(symbol),
          });
          const summary = result?.summary || {};
          const rowTrades = Math.max(0, Number(summary?.total_trades || 0));
          const rowWinRate = Number(summary?.win_rate_pct || 0);
          const rowPnl = Number(summary?.total_pnl || 0);
          const rowR = Number(summary?.total_r || 0);
          const firstBarAt = String(summary?.first_bar_at || "").trim();
          const lastBarAt = String(summary?.last_bar_at || "").trim();
          const barsAnalyzed = Number(summary?.bars_analyzed || 0);
          completed += 1;
          totalTrades += rowTrades;
          totalPnl += Number.isFinite(rowPnl) ? rowPnl : 0;
          totalR += Number.isFinite(rowR) ? rowR : 0;
          weightedWins += Number.isFinite(rowWinRate) ? (rowWinRate / 100) * rowTrades : 0;
          if (firstBarAt) firstBarTimes.push(firstBarAt);
          if (lastBarAt) lastBarTimes.push(lastBarAt);
          if (Number.isFinite(barsAnalyzed) && barsAnalyzed > 0) {
            barsAnalyzedValues.push(barsAnalyzed);
          }
          const comboKey = `${strategyKey}:${tf}`;
          if (!matrix.has(comboKey)) {
            matrix.set(comboKey, {
              strategy_id: strategyKey,
              strategy_name: String(strategy?.name || strategyKey || "Strategy").trim(),
              tf,
              total_trades: 0,
              total_pnl: 0,
              total_r: 0,
              weighted_wins: 0,
              completed: 0,
              failed: 0,
              symbols: new Set(),
            });
          }
          const matrixCell = matrix.get(comboKey);
          matrixCell.total_trades += rowTrades;
          matrixCell.total_pnl += Number.isFinite(rowPnl) ? rowPnl : 0;
          matrixCell.total_r += Number.isFinite(rowR) ? rowR : 0;
          matrixCell.weighted_wins += Number.isFinite(rowWinRate) ? (rowWinRate / 100) * rowTrades : 0;
          matrixCell.completed += 1;
          matrixCell.symbols.add(symbol);
          combinedTrades.push(
            ...((Array.isArray(result?.trades) ? result.trades : []).map((trade) => ({
              ...trade,
              symbol,
              tf,
              timeframe: tf,
              strategy_id: strategyKey,
              strategy_key: strategyKey,
              strategy_name: String(strategy?.name || strategyKey || "Strategy").trim(),
              batch_combo_key: comboKey,
            }))),
          );
          combinedEvents.push(
            ...((Array.isArray(result?.events) ? result.events : []).map((event) => ({
              ...event,
              symbol,
              tf,
              timeframe: tf,
              strategy_id: strategyKey,
              strategy_key: strategyKey,
              strategy_name: String(strategy?.name || strategyKey || "Strategy").trim(),
              batch_combo_key: comboKey,
            }))),
          );
          rows.push({
            status: "completed",
            strategy_id: strategyKey,
            strategy_name: String(strategy?.name || strategyKey || "Strategy").trim(),
            symbol,
            tf,
            total_trades: rowTrades,
            win_rate_pct: Number.isFinite(rowWinRate) ? round(rowWinRate, 2) : 0,
            total_pnl: Number.isFinite(rowPnl) ? round(rowPnl, 5) : 0,
            total_r: Number.isFinite(rowR) ? round(rowR, 5) : 0,
          });
        } catch (error) {
          failed += 1;
          const comboKey = `${strategyKey}:${tf}`;
          if (!matrix.has(comboKey)) {
            matrix.set(comboKey, {
              strategy_id: strategyKey,
              strategy_name: String(strategy?.name || strategyKey || "Strategy").trim(),
              tf,
              total_trades: 0,
              total_pnl: 0,
              total_r: 0,
              weighted_wins: 0,
              completed: 0,
              failed: 0,
              symbols: new Set(),
            });
          }
          matrix.get(comboKey).failed += 1;
          rows.push({
            status: "failed",
            strategy_id: strategyKey,
            strategy_name: String(strategy?.name || strategyKey || "Strategy").trim(),
            symbol,
            tf,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  combinedTrades.sort(compareBatchTradeAsc);
  combinedEvents.sort(compareBatchEventAsc);

  const firstBarAt = firstBarTimes
    .map((value) => toTimestampMs(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)[0];
  const lastBarAt = lastBarTimes
    .map((value) => toTimestampMs(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0];
  const matrixRows = strategies.map((strategy) => {
    const strategyKey = String(strategy?.key || strategy?.id || "").trim();
    const cells = requestedTimeframes.map((tf) => {
      const cell = matrix.get(`${strategyKey}:${tf}`) || null;
      const cellTrades = Number(cell?.total_trades || 0);
      const weightedWinRate = cellTrades
        ? round((Number(cell?.weighted_wins || 0) / cellTrades) * 100, 2)
        : 0;
      return {
        tf,
        completed: Number(cell?.completed || 0),
        failed: Number(cell?.failed || 0),
        total_trades: cellTrades,
        total_pnl: round(Number(cell?.total_pnl || 0), 5) || 0,
        total_r: round(Number(cell?.total_r || 0), 5) || 0,
        win_rate_pct: weightedWinRate,
        symbols: Array.from(cell?.symbols || []),
      };
    });
    return {
      strategy_id: strategyKey,
      strategy_name: String(strategy?.name || strategyKey || "Strategy").trim(),
      cells,
    };
  });
  const combinedWins = combinedTrades.filter((trade) => trade?.result === "win").length;
  const combinedLosses = combinedTrades.filter((trade) => trade?.result === "loss").length;
  const combinedFlats = combinedTrades.filter((trade) => trade?.result === "flat").length;

  const summary = {
    bars_analyzed: barsAnalyzedValues.length ? Math.max(...barsAnalyzedValues) : 0,
    total_trades: totalTrades,
    generated_signals: totalTrades,
    wins: combinedWins,
    losses: combinedLosses,
    flats: combinedFlats,
    win_rate_pct: totalTrades ? round((weightedWins / totalTrades) * 100, 2) : 0,
    total_pnl: round(totalPnl, 5),
    average_pnl: totalTrades ? round(totalPnl / totalTrades, 5) : 0,
    total_r: round(totalR, 5),
    average_r: totalTrades ? round(totalR / totalTrades, 5) : 0,
    strategy_key:
      strategies.length === 1 ? String(strategies[0]?.key || strategies[0]?.id || "batch_mix").trim() : "batch_mix",
    strategy_id:
      strategies.length === 1 ? String(strategies[0]?.id || strategies[0]?.key || "batch_mix").trim() : "batch_mix",
    strategy_name:
      strategies.length === 1
        ? String(strategies[0]?.name || strategies[0]?.key || "Strategy").trim()
        : `${strategies.length} Strategies Mixed`,
    first_bar_at: firstBarAt ? new Date(firstBarAt).toISOString() : null,
    last_bar_at: lastBarAt ? new Date(lastBarAt).toISOString() : null,
  };
  const completedAt = new Date().toISOString();
  const batchRunId = makeRunId();
  const run = {
    run_id: batchRunId,
    user_id: userId,
    symbol: requestedSymbols.length === 1 ? requestedSymbols[0] : "MULTI",
    tf: requestedTimeframes.length === 1 ? requestedTimeframes[0] : "multi",
    limit: Number(payload?.limit) === 0 ? 0 : Math.max(0, Number(payload?.limit || 0)),
    direction: normalizeBacktestDirection(payload.direction, "all"),
    session: normalizeBacktestSession(payload.session, "Any"),
    one_r_value: asFiniteNumber(payload.one_r_value, null),
    status: "completed",
    strategy_key: summary.strategy_key,
    strategy_id: summary.strategy_id,
    strategy_name: summary.strategy_name,
    started_at: startedAt,
    completed_at: completedAt,
    updated_at: completedAt,
    ephemeral: true,
    batch_mix: true,
    selection: {
      symbols: requestedSymbols,
      timeframes: requestedTimeframes,
      strategy_ids: strategies.map((item) => String(item?.key || item?.id || "").trim()),
    },
    summary,
  };

  return {
    ok: true,
    run,
    summary,
    trades: combinedTrades,
    events: combinedEvents,
    strategies: await listAvailableStrategies(userId),
    report: {
      generated_at: new Date().toISOString(),
      selection: {
        symbols: requestedSymbols,
        timeframes: requestedTimeframes,
        strategy_ids: strategies.map((item) => String(item?.key || item?.id || "").trim()),
      },
      matrix_timeframes: requestedTimeframes,
      matrix_rows: matrixRows,
      totals: {
        strategies: strategies.length,
        symbols: requestedSymbols.length,
        timeframes: requestedTimeframes.length,
        combinations: strategies.length * requestedSymbols.length * requestedTimeframes.length,
        completed,
        failed,
        total_trades: totalTrades,
        total_pnl: round(totalPnl, 5),
        total_r: round(totalR, 5),
        weighted_win_rate_pct: totalTrades ? round((weightedWins / totalTrades) * 100, 2) : 0,
      },
      rows,
    },
  };
}

async function listBacktestRuns(userId) {
  const records = await listPersistedBacktestRecords(userId);
  const runs = records.map((record) => ({
    ...record.run,
    summary: record.summary || record.run.summary || null,
  }));
  return {
    ok: true,
    runs,
    strategies: await listAvailableStrategies(userId, { records }),
  };
}

async function getBacktestRun(userId, runId) {
  const storedRecord = await getBacktestRecordFromObjectStore(userId, runId);
  if (storedRecord?.run) {
    return {
      ...storedRecord,
      strategies: await listAvailableStrategies(userId),
    };
  }
  const runDir = await resolveRunDir(userId, runId);
  const legacyRecord = await readLegacyBacktestRun(runDir);
  if (!legacyRecord?.run) {
    throw new Error("Backtest run not found");
  }
  return {
    ok: true,
    run: legacyRecord.run,
    summary: legacyRecord.summary,
    trades: legacyRecord.trades,
    events: legacyRecord.events,
    strategies: await listAvailableStrategies(userId),
  };
}

async function deleteBacktestRun(userId, runId) {
  const runIdText = String(runId || "").trim();
  if (!runIdText) {
    throw new Error("run_id is required");
  }
  const storedRecord = await getBacktestRecordFromObjectStore(userId, runIdText);
  let deleted = false;
  if (storedRecord?.run) {
    await objectStore.deleteObject(userId, "backtests", runIdText);
    deleted = true;
  }
  let runDir = null;
  try {
    runDir = await resolveRunDir(userId, runIdText);
  } catch {
    runDir = null;
  }
  const manifest =
    runDir && fs.existsSync(path.join(runDir, "manifest.json"))
      ? await readJsonFile(path.join(runDir, "manifest.json"), null)
      : null;
  if (manifest) {
    await fsp.rm(runDir, { recursive: true, force: true });
    const legacyDir = backtestRunDir(userId, runIdText);
    if (legacyDir !== runDir) {
      await fsp.rm(legacyDir, { recursive: true, force: true }).catch(() => {});
    }
    deleted = true;
  }
  if (!deleted) {
    throw new Error("Backtest run not found");
  }
  return {
    ok: true,
    deleted: runIdText,
    strategies: await listAvailableStrategies(userId),
  };
}

module.exports = {
  listStrategies,
  listAvailableStrategies,
  runBacktest,
  runBacktestBatch,
  persistBacktestResult,
  listBacktestRuns,
  getBacktestRun,
  deleteBacktestRun,
  __test: {
    normalizeBarRows,
    simulateSignalStrategy,
    simulateStrategy,
    resolveStopAndTarget,
    evaluateRule,
    buildRunStrategyFingerprint,
    buildRunDatasetFingerprint,
    buildRunExecutionFingerprint,
    summarizeStrategyBacktestRecords,
    buildBacktestSummaryIndex,
  },
};
