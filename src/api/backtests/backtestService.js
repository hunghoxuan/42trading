"use strict";

const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const barsStorage = require("../marketData/marketDataRepo");
const strategyConfigService = require("../strategies/strategyConfigService");
const { safePathPart, userRootDir } = require("../objects/objectStore");

const BACKTESTS_DIRNAME = "backtests";
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const BUILTIN_STRATEGIES_DIR = path.join(
  __dirname,
  "..",
  "..",
  "config",
  "strategies",
);
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

let builtinStrategiesCache = null;

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
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

function loadBuiltInStrategies() {
  if (builtinStrategiesCache) {
    return builtinStrategiesCache.map((item) => ({ ...item }));
  }
  const entries = fs.existsSync(BUILTIN_STRATEGIES_DIR)
    ? fs
        .readdirSync(BUILTIN_STRATEGIES_DIR)
        .filter((name) => name.endsWith(".json"))
        .sort()
    : [];
  const rows = [];
  for (const entry of entries) {
    const fullPath = path.join(BUILTIN_STRATEGIES_DIR, entry);
    const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    rows.push({
      kind: "preset",
      ...parsed,
    });
  }
  builtinStrategiesCache = rows;
  return rows.map((item) => ({ ...item }));
}

function listStrategies() {
  return loadBuiltInStrategies();
}

function findStrategy(strategyKey = "ema_cross_v1") {
  return (
    loadBuiltInStrategies().find(
      (item) => item.key === String(strategyKey || "").trim(),
    ) || loadBuiltInStrategies()[0]
  );
}

async function listAvailableStrategies(userId) {
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
    engine_version: strategy.engine_version || "42trade.strategy.v1",
    params: strategy.params || {},
    market: strategy.market || {},
    indicators: strategy.indicators || [],
    rules: strategy.rules || {},
    risk: strategy.risk || {},
  }));
  return [...listStrategies(), ...customRows];
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

function roundMoney(value) {
  return round(value, 2);
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
        brokerCalibration?.spread,
      0,
    ),
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
        brokerCalibration?.commission_per_lot,
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
    brokerCalibration,
    pipSize:
      asFiniteNumber(
        options.pipSize ??
          risk.pip_size ??
          risk.pipSize ??
          brokerCalibration?.pip_size,
        null,
      ) || null,
    lotSize:
      asFiniteNumber(
        options.lotSize ??
          risk.lot_size ??
          risk.lotSize ??
          brokerCalibration?.lot_size,
        null,
      ) || null,
    volumeStepUnits:
      asFiniteNumber(
        options.volumeStepUnits ??
          risk.volume_step_units ??
          risk.volumeStepUnits ??
          brokerCalibration?.volume_step_units,
        null,
      ) || null,
    minVolumeUnits:
      asFiniteNumber(
        options.minVolumeUnits ??
          risk.min_volume_units ??
          risk.minVolumeUnits ??
          brokerCalibration?.min_volume_units,
        null,
      ) || null,
    maxVolumeUnits:
      asFiniteNumber(
        options.maxVolumeUnits ??
          risk.max_volume_units ??
          risk.maxVolumeUnits ??
          brokerCalibration?.max_volume_units,
        null,
      ) || null,
    trailStages: normalizeTrailStages(
      options.trailStages ?? risk.trail_stages ?? risk.trailStages,
    ),
    commissionPerLot,
  };
}

function resolveSpreadAmount(entryPrice, executionOptions) {
  const directSpread = Math.max(0, Number(executionOptions?.spreadAbs || 0));
  if (directSpread > 0) return directSpread;
  const spreadBps = Math.max(0, Number(executionOptions?.spreadBps || 0));
  const basis = Math.abs(Number(entryPrice) || 0);
  return basis > 0 ? (basis * spreadBps) / 10000 : 0;
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

function crossedAbove(prevA, currentA, prevB, currentB) {
  return (
    Number.isFinite(prevA) &&
    Number.isFinite(currentA) &&
    Number.isFinite(prevB) &&
    Number.isFinite(currentB) &&
    prevA <= prevB &&
    currentA > currentB
  );
}

function crossedBelow(prevA, currentA, prevB, currentB) {
  return (
    Number.isFinite(prevA) &&
    Number.isFinite(currentA) &&
    Number.isFinite(prevB) &&
    Number.isFinite(currentB) &&
    prevA >= prevB &&
    currentA < currentB
  );
}

function resolveStopAndTarget(
  bars,
  index,
  action,
  strategy,
  entry,
  signals = {},
  ctx = null,
) {
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

  function pushTrade(trade) {
    trades.push(trade);
    equity += Number(trade.pnl_realized || 0);
    equityPeak = Math.max(equityPeak, equity);
    const drawdownPct =
      equityPeak > 0 ? ((equity - equityPeak) / equityPeak) * 100 : 0;
    maxDrawdownPct = Math.min(maxDrawdownPct, drawdownPct);
  }

  for (let i = 1; i < bars.length; i += 1) {
    const bar = bars[i];
    const signals = signalResolver(i) || {};
    const buySignal = Boolean(signals.buy);
    const sellSignal = Boolean(signals.sell);

    if (openTrade) {
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
          entry: openTrade.entry,
          entry_fill: round(openTrade.entryFill),
          sl: round(openTrade.initialSl),
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
          r_multiple: round(openTrade.realizedR, 5),
          spread_amount: round(openTrade.spreadAmount, 8),
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
            entry: openTrade.entry,
            entry_fill: round(openTrade.entryFill),
            sl: round(openTrade.initialSl),
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
            r_multiple: round(openTrade.realizedR, 5),
            spread_amount: round(openTrade.spreadAmount, 8),
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
            entry: openTrade.entry,
            entry_fill: round(openTrade.entryFill),
            sl: round(openTrade.initialSl),
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
            r_multiple: round(openTrade.realizedR, 5),
            spread_amount: round(openTrade.spreadAmount, 8),
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
    const entry = round(Number(bar.close));
    const entryCtx = signals.ctx || null;
    const { sl, tp } = resolveStopAndTarget(
      bars,
      i,
      action,
      strategy,
      entry,
      signals,
      entryCtx,
    );
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
      continue;
    }
    let quantity = Math.max(
      0.00000001,
      riskAmount / riskPerUnit,
    );
    quantity = quantizeToStep(
      quantity,
      execution.volumeStepUnits,
      execution.minVolumeUnits,
      execution.maxVolumeUnits,
    );
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
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
    openTrade = {
      action,
      entry,
      entryFill,
      initialSl: Number(sl),
      activeSl: Number(sl),
      tp: Number(tp),
      quantity,
      estimatedLots,
      riskAmount,
      riskPercent: execution.riskPercent,
      spreadAmount,
      commissionPerSide,
      entryIndex: i,
      signalTime: bar.time,
      openTime: bar.time,
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
  const rows = barsStorage.readBrokerBarsFromFile(symbol, tf, limit, {});
  return normalizeBarRows(rows, tf);
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

function evaluateRule(node, ctx) {
  if (node === null || node === undefined) return null;
  if (
    typeof node === "number" ||
    typeof node === "string" ||
    typeof node === "boolean"
  ) {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => evaluateRule(item, ctx));
  }
  if (typeof node !== "object") return null;
  const entries = Object.entries(node);
  if (entries.length !== 1) return null;
  const [operator, rawValue] = entries[0];
  const items = Array.isArray(rawValue) ? rawValue : [rawValue];
  const values = items.map((item) => evaluateRule(item, ctx));
  switch (operator) {
    case "var":
      return valueAtPath(ctx, rawValue);
    case "and":
      return values.every(Boolean);
    case "or":
      return values.some(Boolean);
    case "not":
      return !values[0];
    case "if":
      for (let i = 0; i < values.length - 1; i += 2) {
        if (values[i]) return values[i + 1];
      }
      return values.length % 2 === 1 ? values[values.length - 1] : null;
    case ">":
      return Number(values[0]) > Number(values[1]);
    case "<":
      return Number(values[0]) < Number(values[1]);
    case ">=":
      return Number(values[0]) >= Number(values[1]);
    case "<=":
      return Number(values[0]) <= Number(values[1]);
    case "==":
      return values[0] === values[1];
    case "!=":
      return values[0] !== values[1];
    case "+":
      return values.reduce((sum, value) => Number(sum) + Number(value), 0);
    case "-":
      return values.length === 1
        ? -Number(values[0])
        : values.slice(1).reduce((sum, value) => Number(sum) - Number(value), Number(values[0]));
    case "*":
      return values.reduce((product, value) => Number(product) * Number(value), 1);
    case "/":
      return values.slice(1).reduce((quotient, value) => Number(quotient) / Number(value || 1), Number(values[0]));
    case "abs":
      return Math.abs(Number(values[0]));
    case "min":
      return Math.min(...values.map(Number));
    case "max":
      return Math.max(...values.map(Number));
    default:
      return null;
  }
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
    default:
      return new Array(values.length).fill(null);
  }
}

function buildRuleContext({
  bars,
  index,
  strategy,
  currentIndicators,
  prevIndicators,
  entry = null,
  action = "",
}) {
  return {
    bar: bars[index] || null,
    prev: bars[index - 1] || null,
    params: strategy.params || {},
    risk: strategy.risk || {},
    indicators: currentIndicators || {},
    prev_indicators: prevIndicators || {},
    entry,
    action,
  };
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

function simulateEmaCrossStrategy(bars, strategy, options = {}) {
  const closes = bars.map((bar) => Number(bar.close));
  const fast = emaSeries(closes, strategy.params.fast_period);
  const slow = emaSeries(closes, strategy.params.slow_period);
  return simulateSignalStrategy(bars, strategy, (i) => ({
    buy: crossedAbove(fast[i - 1], fast[i], slow[i - 1], slow[i]),
    sell: crossedBelow(fast[i - 1], fast[i], slow[i - 1], slow[i]),
  }), options);
}

function simulateSmaCrossStrategy(bars, strategy, options = {}) {
  const closes = bars.map((bar) => Number(bar.close));
  const fast = smaSeries(closes, strategy.params.fast_period);
  const slow = smaSeries(closes, strategy.params.slow_period);
  return simulateSignalStrategy(bars, strategy, (i) => ({
    buy: crossedAbove(fast[i - 1], fast[i], slow[i - 1], slow[i]),
    sell: crossedBelow(fast[i - 1], fast[i], slow[i - 1], slow[i]),
  }), options);
}

function simulateRsiReversionStrategy(bars, strategy, options = {}) {
  const closes = bars.map((bar) => Number(bar.close));
  const rsi = rsiSeries(closes, strategy.params.rsi_period);
  return simulateSignalStrategy(bars, strategy, (i) => ({
    buy:
      Number.isFinite(rsi[i - 1]) &&
      Number.isFinite(rsi[i]) &&
      rsi[i - 1] <= strategy.params.oversold &&
      rsi[i] > strategy.params.oversold,
    sell:
      Number.isFinite(rsi[i - 1]) &&
      Number.isFinite(rsi[i]) &&
      rsi[i - 1] >= strategy.params.overbought &&
      rsi[i] < strategy.params.overbought,
  }), options);
}

function simulateMacdSignalStrategy(bars, strategy, options = {}) {
  const closes = bars.map((bar) => Number(bar.close));
  const { macd, signal } = macdSeries(
    closes,
    strategy.params.fast_period,
    strategy.params.slow_period,
    strategy.params.signal_period,
  );
  return simulateSignalStrategy(bars, strategy, (i) => ({
    buy: crossedAbove(macd[i - 1], macd[i], signal[i - 1], signal[i]),
    sell: crossedBelow(macd[i - 1], macd[i], signal[i - 1], signal[i]),
  }), options);
}

function simulateBollingerReversionStrategy(bars, strategy, options = {}) {
  const closes = bars.map((bar) => Number(bar.close));
  const mean = smaSeries(closes, strategy.params.period);
  const dev = rollingStdDevSeries(closes, strategy.params.period);
  return simulateSignalStrategy(bars, strategy, (i) => {
    const lowerPrev =
      Number.isFinite(mean[i - 1]) && Number.isFinite(dev[i - 1])
        ? mean[i - 1] - dev[i - 1] * strategy.params.stddev
        : null;
    const upperPrev =
      Number.isFinite(mean[i - 1]) && Number.isFinite(dev[i - 1])
        ? mean[i - 1] + dev[i - 1] * strategy.params.stddev
        : null;
    return {
      buy:
        Number.isFinite(lowerPrev) &&
        Number(bars[i - 1]?.close) < lowerPrev &&
        Number(bars[i]?.close) > Number(mean[i]),
      sell:
        Number.isFinite(upperPrev) &&
        Number(bars[i - 1]?.close) > upperPrev &&
        Number(bars[i]?.close) < Number(mean[i]),
    };
  }, options);
}

function simulateDonchianBreakoutStrategy(bars, strategy, options = {}) {
  const highest = highestHighSeries(bars, strategy.params.period);
  const lowest = lowestLowSeries(bars, strategy.params.period);
  return simulateSignalStrategy(bars, strategy, (i) => ({
    buy:
      Number.isFinite(highest[i]) &&
      Number(bars[i]?.close) > highest[i],
    sell:
      Number.isFinite(lowest[i]) &&
      Number(bars[i]?.close) < lowest[i],
  }), options);
}

function simulateStochasticReversalStrategy(bars, strategy, options = {}) {
  const k = stochasticKSeries(
    bars,
    strategy.params.period,
    strategy.params.smooth_period,
  );
  return simulateSignalStrategy(bars, strategy, (i) => ({
    buy:
      Number.isFinite(k[i - 1]) &&
      Number.isFinite(k[i]) &&
      k[i - 1] <= strategy.params.oversold &&
      k[i] > strategy.params.oversold,
    sell:
      Number.isFinite(k[i - 1]) &&
      Number.isFinite(k[i]) &&
      k[i - 1] >= strategy.params.overbought &&
      k[i] < strategy.params.overbought,
  }), options);
}

function simulateRocMomentumStrategy(bars, strategy, options = {}) {
  const closes = bars.map((bar) => Number(bar.close));
  const roc = rocSeries(closes, strategy.params.period);
  return simulateSignalStrategy(bars, strategy, (i) => ({
    buy:
      Number.isFinite(roc[i - 1]) &&
      Number.isFinite(roc[i]) &&
      roc[i - 1] <= 0 &&
      roc[i] > 0,
    sell:
      Number.isFinite(roc[i - 1]) &&
      Number.isFinite(roc[i]) &&
      roc[i - 1] >= 0 &&
      roc[i] < 0,
  }), options);
}

function simulateTripleEmaTrendStrategy(bars, strategy, options = {}) {
  const closes = bars.map((bar) => Number(bar.close));
  const fast = emaSeries(closes, strategy.params.fast_period);
  const mid = emaSeries(closes, strategy.params.mid_period);
  const slow = emaSeries(closes, strategy.params.slow_period);
  return simulateSignalStrategy(bars, strategy, (i) => ({
    buy:
      Number.isFinite(fast[i]) &&
      Number.isFinite(mid[i]) &&
      Number.isFinite(slow[i]) &&
      Number.isFinite(fast[i - 1]) &&
      Number.isFinite(mid[i - 1]) &&
      fast[i] > mid[i] &&
      mid[i] > slow[i] &&
      fast[i - 1] <= mid[i - 1],
    sell:
      Number.isFinite(fast[i]) &&
      Number.isFinite(mid[i]) &&
      Number.isFinite(slow[i]) &&
      Number.isFinite(fast[i - 1]) &&
      Number.isFinite(mid[i - 1]) &&
      fast[i] < mid[i] &&
      mid[i] < slow[i] &&
      fast[i - 1] >= mid[i - 1],
  }), options);
}

function simulateStrategy(bars, strategy, options = {}) {
  if (String(strategy?.kind || "").trim() === "custom") {
    return simulateCustomStrategy(bars, strategy, options);
  }
  switch (strategy.key) {
    case "ema_cross_v1":
      return simulateEmaCrossStrategy(bars, strategy, options);
    case "sma_cross_v1":
    case "golden_cross_v1":
      return simulateSmaCrossStrategy(bars, strategy, options);
    case "rsi_reversion_v1":
      return simulateRsiReversionStrategy(bars, strategy, options);
    case "macd_signal_v1":
      return simulateMacdSignalStrategy(bars, strategy, options);
    case "bollinger_reversion_v1":
      return simulateBollingerReversionStrategy(bars, strategy, options);
    case "donchian_breakout_v1":
      return simulateDonchianBreakoutStrategy(bars, strategy, options);
    case "stoch_reversal_v1":
      return simulateStochasticReversalStrategy(bars, strategy, options);
    case "roc_momentum_v1":
      return simulateRocMomentumStrategy(bars, strategy, options);
    case "triple_ema_trend_v1":
      return simulateTripleEmaTrendStrategy(bars, strategy, options);
    default:
      return simulateEmaCrossStrategy(bars, strategy, options);
  }
}

function simulateCustomStrategy(bars, strategy, options = {}) {
  const indicators = {};
  for (const indicator of Array.isArray(strategy.indicators) ? strategy.indicators : []) {
    if (!indicator?.id) continue;
    indicators[indicator.id] = computeIndicatorSeries(bars, indicator);
  }
  return simulateSignalStrategy(bars, strategy, (i) => {
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
      }),
    };
    return {
      buy: Boolean(evaluateRule(strategy.rules?.entry_long, ctx)),
      sell: Boolean(evaluateRule(strategy.rules?.entry_short, ctx)),
      exit_long: Boolean(evaluateRule(strategy.rules?.exit_long, ctx)),
      exit_short: Boolean(evaluateRule(strategy.rules?.exit_short, ctx)),
      stop_loss_long: strategy.rules?.stop_loss_long,
      stop_loss_short: strategy.rules?.stop_loss_short,
      take_profit_long: strategy.rules?.take_profit_long,
      take_profit_short: strategy.rules?.take_profit_short,
      ctx,
    };
  }, options);
}

function summarizeTrades(trades = [], bars = [], strategy = null, details = {}) {
  const totalTrades = trades.length;
  const wins = trades.filter((trade) => trade.result === "win").length;
  const losses = trades.filter((trade) => trade.result === "loss").length;
  const flats = trades.filter((trade) => trade.result === "flat").length;
  const totalPnl = trades.reduce(
    (sum, trade) => sum + Number(trade.pnl_realized || 0),
    0,
  );
  const totalR = trades.reduce(
    (sum, trade) => sum + Number(trade.r_multiple || 0),
    0,
  );
  return {
    bars_analyzed: bars.length,
    total_trades: totalTrades,
    generated_signals: totalTrades,
    wins,
    losses,
    flats,
    win_rate_pct: totalTrades ? round((wins / totalTrades) * 100, 2) : 0,
    total_pnl: round(totalPnl, 5),
    average_pnl: totalTrades ? round(totalPnl / totalTrades, 5) : 0,
    total_r: round(totalR, 5),
    average_r: totalTrades ? round(totalR / totalTrades, 5) : 0,
    strategy_key: strategy?.key || strategy?.id || null,
    strategy_id: strategy?.id || null,
    strategy_name: strategy?.name || null,
    initial_equity: details.initial_equity ?? null,
    final_equity: details.final_equity ?? null,
    max_drawdown_pct: details.max_drawdown_pct ?? null,
    first_bar_at: bars[0] ? toIsoFromUnixSeconds(bars[0].time) : null,
    last_bar_at: bars.length
      ? toIsoFromUnixSeconds(bars[bars.length - 1].time)
      : null,
  };
}

async function listRunDirs(root) {
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch((error) => {
    if (error && error.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
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
      findStrategy(strategyKey);
  }
  if (!strategy && payload.strategy_config && typeof payload.strategy_config === "object") {
    const validation = strategyConfigService.validateStrategyPayload(payload.strategy_config);
    if (!validation.ok) {
      throw new Error(validation.errors.join("; "));
    }
    strategy = validation.strategy;
  }
  if (!strategy) {
    strategy = findStrategy("ema_cross_v1");
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
    throw new Error("Not enough bars available for the selected strategy");
  }

  const brokerCalibration = await fetchBrokerCalibration(symbol, payload);

  const runId = makeRunId();
  const startedAt = new Date().toISOString();
  const strategyKeyForPath = strategy.key || strategy.id || "default";
  const runDir = strategyBacktestRunDir(userId, strategyKeyForPath, runId);
  ensureDir(runDir);

  const manifest = {
    run_id: runId,
    user_id: userId,
    symbol,
    tf,
    limit,
    status: "running",
    strategy_key: strategyKeyForPath,
    strategy_id: strategy.id || null,
    strategy_name: strategy.name,
    strategy_snapshot: strategy,
    market_data_quality: diagnostics,
    broker_calibration: brokerCalibration,
    execution_options: resolveExecutionOptions(strategy, {
      ...payload,
      brokerCalibration,
    }),
    started_at: startedAt,
    updated_at: startedAt,
  };
  await writeJsonAtomic(path.join(runDir, "manifest.json"), manifest);

  const executionResult = simulateStrategy(bars, strategy, {
    ...payload,
    brokerCalibration,
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

  await writeJsonAtomic(path.join(runDir, "summary.json"), summary);
  await writeJsonAtomic(path.join(runDir, "trades.json"), trades);
  await writeJsonAtomic(path.join(runDir, "manifest.json"), finalManifest);

  return {
    ok: true,
    run: finalManifest,
    summary,
    trades,
    strategies: await listAvailableStrategies(userId),
  };
}

async function listBacktestRuns(userId) {
  const legacyRoot = backtestsRoot(userId);
  ensureDir(legacyRoot);
  const [legacyRunDirs, nestedRunDirs] = await Promise.all([
    listRunDirs(legacyRoot),
    listStrategyRunDirs(userId),
  ]);
  const seen = new Set();
  const runs = [];
  for (const dir of [...nestedRunDirs, ...legacyRunDirs]) {
    const manifestPath = path.join(dir, "manifest.json");
    const manifest = await readJsonFile(manifestPath, null);
    if (!manifest) continue;
    const manifestKey = String(manifest.run_id || path.basename(dir)).trim();
    if (seen.has(manifestKey)) continue;
    seen.add(manifestKey);
    const summary = await readJsonFile(path.join(dir, "summary.json"), manifest.summary || null);
    runs.push({
      ...manifest,
      summary: summary || manifest.summary || null,
    });
  }
  runs.sort((a, b) =>
    String(b.updated_at || b.started_at || "").localeCompare(
      String(a.updated_at || a.started_at || ""),
    ),
  );
  return {
    ok: true,
    runs,
    strategies: await listAvailableStrategies(userId),
  };
}

async function getBacktestRun(userId, runId) {
  const runDir = await resolveRunDir(userId, runId);
  const manifest = await readJsonFile(path.join(runDir, "manifest.json"), null);
  if (!manifest) {
    throw new Error("Backtest run not found");
  }
  const [summary, trades] = await Promise.all([
    readJsonFile(path.join(runDir, "summary.json"), manifest.summary || null),
    readJsonFile(path.join(runDir, "trades.json"), []),
  ]);
  return {
    ok: true,
    run: manifest,
    summary,
    trades,
    strategies: await listAvailableStrategies(userId),
  };
}

module.exports = {
  listStrategies,
  runBacktest,
  listBacktestRuns,
  getBacktestRun,
  __test: {
    normalizeBarRows,
    simulateSignalStrategy,
    resolveStopAndTarget,
    evaluateRule,
  },
};
