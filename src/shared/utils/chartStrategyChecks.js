import * as sharedArtifactDetection from "../rules-engine/features/detectArtifacts.js";
import * as strategyEventFunctions from "../rules-engine/features/strategyEventFunctions.js";
import * as strategyScanEngine from "./strategyScanEngine.js";
import * as sharedRulesEngine from "../rules-engine/index.js";

const { createStrategyScanEngine } = strategyScanEngine;

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

function normalizeTfKey(tfRaw = "") {
  const raw = String(tfRaw || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "1m" || raw === "1min" || raw === "m1" || raw === "1") return "1m";
  if (raw === "5m" || raw === "5min" || raw === "m5" || raw === "5") return "5m";
  if (raw === "15m" || raw === "15min" || raw === "m15" || raw === "15") return "15m";
  if (raw === "1h" || raw === "60" || raw === "h1") return "1h";
  if (raw === "4h" || raw === "240" || raw === "h4") return "4h";
  if (raw === "1d" || raw === "d" || raw === "day") return "1d";
  if (raw === "1w" || raw === "w" || raw === "week") return "1w";
  return raw;
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
      : values
          .slice(1)
          .reduce((sum, value) => Number(sum) - Number(value), Number(values[0])),
  "*": (values) =>
    values.reduce((product, value) => Number(product) * Number(value), 1),
  "/": (values) =>
    values
      .slice(1)
      .reduce(
        (quotient, value) => Number(quotient) / Number(value || 1),
        Number(values[0]),
      ),
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
  pin_bar: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("pin_bar", args, ctx, evaluate),
  engulfing: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("engulfing", args, ctx, evaluate),
  inside_bar: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("inside_bar", args, ctx, evaluate),
  outside_bar: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("outside_bar", args, ctx, evaluate),
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
  get_artifacts: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("get_artifacts", args, ctx, evaluate),
  is_true: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("is_true", args, ctx, evaluate),
  draw: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("draw", args, ctx, evaluate),
};

function evaluateRule(node, ctx) {
  return sharedRulesEngine.evaluateRuleExpression(node, ctx);
}

function seriesBySource(bars, source = "close") {
  return (Array.isArray(bars) ? bars : []).map((bar) =>
    Number(bar?.[source] ?? bar?.close),
  );
}

function emaSeries(values = [], period = 9) {
  const length = Math.max(1, Number(period) || 9);
  const multiplier = 2 / (length + 1);
  let ema = null;
  return values.map((value) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return ema;
    if (ema === null) {
      ema = next;
      return ema;
    }
    ema = (next - ema) * multiplier + ema;
    return ema;
  });
}

function smaSeries(values = [], period = 9) {
  const length = Math.max(1, Number(period) || 9);
  const result = new Array(values.length).fill(null);
  let rollingSum = 0;
  for (let index = 0; index < values.length; index += 1) {
    const next = Number(values[index]);
    rollingSum += Number.isFinite(next) ? next : 0;
    if (index >= length) {
      const previous = Number(values[index - length]);
      rollingSum -= Number.isFinite(previous) ? previous : 0;
    }
    if (index >= length - 1) {
      result[index] = rollingSum / length;
    }
  }
  return result;
}

function bollingerSeries(values = [], period = 20, stddev = 2) {
  const mid = smaSeries(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  const length = Math.max(1, Number(period) || 20);
  const deviation = Number(stddev) || 2;
  for (let index = length - 1; index < values.length; index += 1) {
    const window = values
      .slice(index - length + 1, index + 1)
      .map(Number)
      .filter(Number.isFinite);
    if (window.length !== length || !Number.isFinite(mid[index])) continue;
    const mean = Number(mid[index]);
    const variance =
      window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / length;
    const sigma = Math.sqrt(variance);
    upper[index] = mean + sigma * deviation;
    lower[index] = mean - sigma * deviation;
  }
  return { upper, mid, lower };
}

function rsiSeries(values = [], period = 14) {
  const length = Math.max(1, Number(period) || 14);
  const result = new Array(values.length).fill(null);
  if (values.length <= length) return result;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= length; index += 1) {
    const delta = Number(values[index]) - Number(values[index - 1]);
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  let avgGain = gains / length;
  let avgLoss = losses / length;
  const firstRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result[length] = 100 - 100 / (1 + firstRs);
  for (let index = length + 1; index < values.length; index += 1) {
    const delta = Number(values[index]) - Number(values[index - 1]);
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (length - 1) + gain) / length;
    avgLoss = (avgLoss * (length - 1) + loss) / length;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result[index] = Math.max(0, Math.min(100, 100 - 100 / (1 + rs)));
  }
  return result;
}

function rocSeries(values = [], period = 14) {
  const length = Math.max(1, Number(period) || 14);
  return values.map((value, index) => {
    if (index < length) return null;
    const previous = Number(values[index - length]);
    const current = Number(value);
    if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) {
      return null;
    }
    return ((current - previous) / previous) * 100;
  });
}

function atrSeries(bars = [], period = 14) {
  const length = Math.max(1, Number(period) || 14);
  const trueRanges = bars.map((bar, index) => {
    const high = Number(bar?.high);
    const low = Number(bar?.low);
    const previousClose = Number(bars[index - 1]?.close);
    if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
    if (!Number.isFinite(previousClose)) return high - low;
    return Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    );
  });
  return trueRanges.map((_, index) => {
    if (index < length - 1) return null;
    const window = trueRanges.slice(index - length + 1, index + 1).map(Number);
    if (window.some((value) => !Number.isFinite(value))) return null;
    return window.reduce((sum, value) => sum + value, 0) / length;
  });
}

function getUtcHourFraction(unixSeconds) {
  const date = new Date(Number(unixSeconds || 0) * 1000);
  return (
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600
  );
}

function inferSessionName(unixSeconds) {
  const hour = getUtcHourFraction(unixSeconds);
  if (!Number.isFinite(hour)) return "Any";
  if (hour >= 0 && hour < 9) return "Asian";
  if (hour >= 8 && hour < 17) return "London";
  if (hour >= 13 && hour < 22) return "New York";
  return "Any";
}

function macdSeries(values = [], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fast = emaSeries(values, fastPeriod);
  const slow = emaSeries(values, slowPeriod);
  const macd = values.map((_, index) => {
    const fastValue = Number(fast[index]);
    const slowValue = Number(slow[index]);
    return Number.isFinite(fastValue) && Number.isFinite(slowValue)
      ? fastValue - slowValue
      : null;
  });
  const signal = emaSeries(
    macd.map((value) => (Number.isFinite(Number(value)) ? Number(value) : 0)),
    signalPeriod,
  ).map((value, index) => (macd[index] == null ? null : value));
  const histogram = macd.map((value, index) => {
    const signalValue = Number(signal[index]);
    return Number.isFinite(Number(value)) && Number.isFinite(signalValue)
      ? Number(value) - signalValue
      : null;
  });
  return { macd, signal, histogram };
}

function highestHighSeries(bars = [], period = 20) {
  const length = Math.max(1, Number(period) || 20);
  return bars.map((_, index) => {
    if (index < length - 1) return null;
    return Math.max(
      ...bars
        .slice(index - length + 1, index + 1)
        .map((bar) => Number(bar?.high))
        .filter(Number.isFinite),
    );
  });
}

function lowestLowSeries(bars = [], period = 20) {
  const length = Math.max(1, Number(period) || 20);
  return bars.map((_, index) => {
    if (index < length - 1) return null;
    return Math.min(
      ...bars
        .slice(index - length + 1, index + 1)
        .map((bar) => Number(bar?.low))
        .filter(Number.isFinite),
    );
  });
}

function stochasticSeries(bars = [], period = 14, smoothPeriod = 3) {
  const length = Math.max(1, Number(period) || 14);
  const k = bars.map((bar, index) => {
    if (index < length - 1) return null;
    const window = bars.slice(index - length + 1, index + 1);
    const highest = Math.max(
      ...window.map((item) => Number(item?.high)).filter(Number.isFinite),
    );
    const lowest = Math.min(
      ...window.map((item) => Number(item?.low)).filter(Number.isFinite),
    );
    const close = Number(bar?.close);
    if (
      !Number.isFinite(highest) ||
      !Number.isFinite(lowest) ||
      !Number.isFinite(close) ||
      highest === lowest
    ) {
      return null;
    }
    return ((close - lowest) / (highest - lowest)) * 100;
  });
  const d = smaSeries(k.map((value) => (value == null ? 0 : value)), smoothPeriod).map(
    (value, index) => (k[index] == null ? null : value),
  );
  return { k, d };
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

function normalizeStrategyEvents(strategy = {}) {
  const normalizeEventAction = (action = {}, fallbackDirection = "buy") => {
    const actionType = String(action?.action || action?.type || "").trim();
    const direction =
      actionType === "trade.open.short" ? "sell" :
      actionType === "trade.open.long" ? "buy" :
      fallbackDirection;
    if (actionType === "trade.open.long" || actionType === "trade.open.short") {
      return {
        ...action,
        action: "trade",
        trade_plan: {
          direction,
          type: "market",
          entry: { var: "bar.close" },
          ...(action?.trade_plan && typeof action.trade_plan === "object"
            ? action.trade_plan
            : {}),
        },
      };
    }
    return action;
  };
  if (Array.isArray(strategy?.rules) && strategy.rules.length) {
    return strategy.rules
      .map((rule, ruleIndex) => ({
        id:
          String(rule?.id || `rule_${ruleIndex + 1}`).trim() ||
          `rule_${ruleIndex + 1}`,
        name:
          String(rule?.name || rule?.label || `Rule ${ruleIndex + 1}`).trim() ||
          `Rule ${ruleIndex + 1}`,
        abbr: String(rule?.abbr || rule?.short_name || "").trim(),
        icon: String(rule?.icon || "").trim(),
        family: String(rule?.family || "").trim(),
        priority: String(rule?.priority || "").trim(),
        bias: String(rule?.bias || "").trim().toLowerCase(),
        when: rule?.when && typeof rule.when === "object" ? rule.when : null,
        actions: Array.isArray(rule?.actions)
          ? rule.actions.map((action) =>
              normalizeEventAction(
                action,
                String(rule?.bias || "").trim().toLowerCase() === "bearish" ? "sell" : "buy",
              ),
            )
          : [],
      }))
      .filter((rule) => rule.when);
  }
  if (Array.isArray(strategy?.events) && strategy.events.length) {
    return strategy.events
      .map((event, eventIndex) => ({
        id:
          String(event?.id || `event_${eventIndex + 1}`).trim() ||
          `event_${eventIndex + 1}`,
        name:
          String(event?.name || event?.label || `Event ${eventIndex + 1}`).trim() ||
          `Event ${eventIndex + 1}`,
        abbr: String(event?.abbr || event?.short_name || "").trim(),
        icon: String(event?.icon || "").trim(),
        family: String(event?.family || "").trim(),
        priority: String(event?.priority || "").trim(),
        bias: String(event?.bias || "").trim().toLowerCase(),
        when: event?.when && typeof event.when === "object" ? event.when : null,
        actions: Array.isArray(event?.actions)
          ? event.actions.map((action) =>
              normalizeEventAction(
                action,
                /bear|short|sell/i.test(String(event?.name || event?.id || ""))
                  ? "sell"
                  : "buy",
              ),
            )
          : [],
      }))
      .filter((event) => event.when);
  }
  if (strategy?.rules && typeof strategy.rules === "object" && !Array.isArray(strategy.rules)) {
    const legacyEvents = [
      [["bullish", "entry_long"], "Bullish", "buy", "bullish"],
      [["bearish", "entry_short"], "Bearish", "sell", "bearish"],
    ];
    return legacyEvents
      .map(([ruleKeys, name, direction, id]) => ({
        id,
        name,
        bias: id,
        when: ruleKeys.map((key) => strategy.rules[key]).find(Boolean) || null,
        actions: [
          {
            id: `${id}_action`,
            action: "trade",
            trade_plan: {
              direction,
              type: "market",
              entry: { var: "bar.close" },
              sl: strategy.rules?.[`stop_loss_${direction === "buy" ? "long" : "short"}`] || null,
              tp: strategy.rules?.[`take_profit_${direction === "buy" ? "long" : "short"}`] || null,
            },
          },
        ],
      }))
      .filter((event) => event.when);
  }
  return [];
}

function buildRuleContext({
  bars,
  index,
  strategy,
  currentIndicators,
  prevIndicators,
  derivedArtifacts,
  multiTf,
  analysis = null,
  tf = "",
}) {
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
    params:
      strategy?.params && typeof strategy.params === "object"
        ? strategy.params
        : {},
    risk:
      strategy?.risk && typeof strategy.risk === "object"
        ? strategy.risk
        : {},
    indicators: currentIndicators || {},
    prev_indicators: prevIndicators || {},
    ...(
      strategy?.metadata?.preview_context &&
      typeof strategy.metadata.preview_context === "object" &&
      !Array.isArray(strategy.metadata.preview_context)
        ? strategy.metadata.preview_context
        : {}
    ),
  };
}

function buildMultiTfContextEntries(multiTfBars = null, currentTf = "") {
  if (!multiTfBars || typeof multiTfBars !== "object" || Array.isArray(multiTfBars)) {
    return {};
  }
  const normalizedCurrentTf = normalizeTfKey(currentTf);
  const next = {};
  Object.entries(multiTfBars).forEach(([tfRaw, barsRaw]) => {
    const tf = normalizeTfKey(tfRaw);
    const bars = Array.isArray(barsRaw) ? barsRaw : [];
    if (!tf || !bars.length || tf === normalizedCurrentTf) return;
    next[tf] = {
      bars,
      derivedArtifacts: sharedArtifactDetection.buildDerivedItemsFromBars(bars, tf),
      analysis: null,
    };
  });
  return next;
}

function artifactMatchTime(item = {}) {
  return Number(
    item?.anchor_time ??
      item?.bar_end ??
      item?.bar_start ??
      item?.time ??
      0,
  ) || 0;
}

function artifactSourceTf(item = {}, fallbackTf = "") {
  return normalizeTfKey(
    item?.timeframe || item?.tf || item?.source_tf || fallbackTf || "",
  );
}

function normalizeTradeDirection(value = "", fallback = "BUY") {
  const normalized = String(value || "").trim().toUpperCase();
  if (["SELL", "SHORT", "BEAR", "BEARISH"].includes(normalized)) return "SELL";
  if (["BUY", "LONG", "BULL", "BULLISH"].includes(normalized)) return "BUY";
  return String(fallback || "BUY").trim().toUpperCase() === "SELL" ? "SELL" : "BUY";
}

function resolveTradeDirectionFromAction(
  action = {},
  fallbackEventBias = "",
  latestArtifact = null,
) {
  const explicit = normalizeTradeDirection(
    action?.trade_plan?.direction || "",
    "",
  );
  if (explicit === "BUY" || explicit === "SELL") return explicit;
  const actionType = String(action?.action || action?.type || "")
    .trim()
    .toLowerCase();
  if (actionType.includes("open.long") || actionType.includes("close.short")) {
    return "BUY";
  }
  if (actionType.includes("open.short") || actionType.includes("close.long")) {
    return "SELL";
  }
  const artifactBias = String(
    latestArtifact?.direction ||
      latestArtifact?.payload?.bias ||
      latestArtifact?.subtype ||
      "",
  )
    .trim()
    .toLowerCase();
  if (/\bbear\b|\bsell\b|\bshort\b|\bdown\b/.test(artifactBias)) return "SELL";
  if (/\bbull\b|\bbuy\b|\blong\b|\bup\b/.test(artifactBias)) return "BUY";
  const fallbackBias = String(fallbackEventBias || "").trim().toLowerCase();
  return /\bbear\b|\bsell\b|\bshort\b|\bdown\b/.test(fallbackBias) ? "SELL" : "BUY";
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function splitPlanExpressionArgs(source = "") {
  const args = [];
  let current = "";
  let depth = 0;
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      current += char;
      if (char === quote && source[index - 1] !== "\\") quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function parsePlanExpressionValue(rawValue, { forArgument = false } = {}) {
  if (typeof rawValue !== "string") return rawValue;
  const raw = rawValue.trim();
  if (!raw) return null;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  const fnMatch = raw.match(/^([a-zA-Z_][a-zA-Z0-9._-]*)\((.*)\)$/);
  if (fnMatch) {
    return {
      fn: fnMatch[1],
      args: splitPlanExpressionArgs(fnMatch[2]).map((item) =>
        parsePlanExpressionValue(item, { forArgument: true }),
      ),
    };
  }
  if (
    forArgument &&
    new Set(["buy", "sell", "bullish", "bearish", "all", "any"]).has(
      raw.toLowerCase(),
    )
  ) {
    return raw.toLowerCase();
  }
  return { var: raw };
}

function resolvePlanFieldValue(rawValue, ctx) {
  const normalizedValue =
    typeof rawValue === "string"
      ? parsePlanExpressionValue(rawValue)
      : rawValue;
  const value =
    normalizedValue &&
    typeof normalizedValue === "object" &&
    !Array.isArray(normalizedValue)
      ? evaluateRule(normalizedValue, ctx)
      : normalizedValue;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const firstNumeric = [
      value?.price,
      value?.value,
      value?.close,
      value?.entry,
      value?.tp,
      value?.sl,
    ]
      .map(toFiniteNumber)
      .find(Number.isFinite);
    return firstNumeric ?? value;
  }
  return value;
}

function midArtifactPrice(item = {}) {
  const low = toFiniteNumber(item?.price_low);
  const high = toFiniteNumber(item?.price_high);
  const price = toFiniteNumber(item?.price);
  if (Number.isFinite(low) && Number.isFinite(high)) return (low + high) / 2;
  if (Number.isFinite(price)) return price;
  if (Number.isFinite(low)) return low;
  if (Number.isFinite(high)) return high;
  return null;
}

function defaultTpSlFromEntry(entry, direction) {
  const e = Number(entry);
  const isSell = normalizeTradeDirection(direction, "BUY") === "SELL";
  if (!Number.isFinite(e)) return { tp: null, sl: null };
  return {
    tp: isSell ? e * 0.98 : e * 1.02,
    sl: isSell ? e * 1.02 : e * 0.98,
  };
}

function resolvePlanAnchorPrice(ctx = {}, latestArtifact = null) {
  const explicitArtifactPrice = midArtifactPrice(latestArtifact || {});
  if (Number.isFinite(explicitArtifactPrice)) return explicitArtifactPrice;
  const close = toFiniteNumber(ctx?.bar?.close);
  if (Number.isFinite(close)) return close;
  const open = toFiniteNumber(ctx?.bar?.open);
  return Number.isFinite(open) ? open : null;
}

function resolvePlanStopFromArtifact(direction = "BUY", latestArtifact = null) {
  if (!latestArtifact || typeof latestArtifact !== "object") return null;
  const low = toFiniteNumber(latestArtifact?.price_low);
  const high = toFiniteNumber(latestArtifact?.price_high);
  const price = toFiniteNumber(latestArtifact?.price);
  const isSell = normalizeTradeDirection(direction, "BUY") === "SELL";
  if (isSell) return high ?? price ?? null;
  return low ?? price ?? null;
}

function resolvePlanTargetFromArtifact(direction = "BUY", latestArtifact = null) {
  if (!latestArtifact || typeof latestArtifact !== "object") return null;
  const low = toFiniteNumber(latestArtifact?.price_low);
  const high = toFiniteNumber(latestArtifact?.price_high);
  const price = toFiniteNumber(latestArtifact?.price);
  const isSell = normalizeTradeDirection(direction, "BUY") === "SELL";
  if (isSell) return low ?? price ?? null;
  return high ?? price ?? null;
}

function normalizeStrategyArtifactLabel(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (
    normalized === "ob" ||
    normalized === "order_block" ||
    normalized === "orderblock"
  ) {
    return "OB";
  }
  if (
    normalized === "fvg" ||
    normalized === "fair_value_gap" ||
    normalized === "fairvaluegap"
  ) {
    return "FVG";
  }
  if (normalized === "breaker" || normalized === "breaker_block") {
    return "breaker";
  }
  if (normalized === "bsl") return "BSL";
  if (normalized === "ssl") return "SSL";
  if (normalized === "eqh") return "EQH";
  if (normalized === "eql") return "EQL";
  if (normalized === "liquidity") return "liquidity";
  if (normalized === "rejection") return "rejection zone";
  if (normalized === "sweep") return "liquidity";
  return normalized.replace(/[_-]+/g, " ");
}

function collectStrategyRuleHints(node, sink = new Set()) {
  if (node == null) return sink;
  if (Array.isArray(node)) {
    node.forEach((item) => collectStrategyRuleHints(item, sink));
    return sink;
  }
  if (typeof node === "string") {
    const text = node.toLowerCase();
    [
      "rejected",
      "retest",
      "touches",
      "sweeps_above",
      "sweeps_below",
      "sweep",
      "bos",
      "choch",
      "breakout",
      "pin_bar",
      "engulfing",
      "inside_bar",
      "outside_bar",
      "ob",
      "order_block",
      "fvg",
      "fair_value_gap",
      "breaker",
      "liquidity",
    ].forEach((token) => {
      if (text.includes(token)) sink.add(token);
    });
    return sink;
  }
  if (typeof node !== "object") return sink;
  if (typeof node.fn === "string") {
    sink.add(String(node.fn || "").trim().toLowerCase());
  }
  Object.entries(node).forEach(([key, value]) => {
    sink.add(String(key || "").trim().toLowerCase());
    collectStrategyRuleHints(value, sink);
  });
  return sink;
}

export function buildStrategyPlanNote({
  action = {},
  strategy = {},
  event = {},
  hit = {},
  latestArtifact = null,
}) {
  const direction =
    resolveTradeDirectionFromAction(
      action,
      event?.bias || hit?.eventBias || "",
      latestArtifact,
    ) === "SELL"
      ? "Bearish"
      : "Bullish";
  const artifacts = [
    ...(Array.isArray(hit?.artifacts) ? hit.artifacts : []),
    latestArtifact,
  ].filter(Boolean);
  const artifactLabels = [
    ...new Set(
      artifacts
        .flatMap((item) => [
          normalizeStrategyArtifactLabel(item?.type),
          normalizeStrategyArtifactLabel(item?.subtype),
          normalizeStrategyArtifactLabel(item?.kind),
        ])
        .filter(Boolean),
    ),
  ];
  const ruleHints = collectStrategyRuleHints(event?.when);
  const hasHint = (value) => ruleHints.has(String(value || "").trim().toLowerCase());
  const zoneLabel =
    artifactLabels.includes("OB") && artifactLabels.includes("FVG")
      ? "OB/FVG"
      : artifactLabels.find((label) =>
            ["OB", "FVG", "breaker", "BSL", "SSL", "EQH", "EQL", "liquidity"].includes(label),
          ) || "";

  let setupText = "";
  if (
    hasHint("sweep") ||
    hasHint("sweeps_above") ||
    hasHint("sweeps_below")
  ) {
    setupText = zoneLabel
      ? `swept liquidity into ${zoneLabel} and reversed`
      : "swept liquidity and reversed";
  } else if (hasHint("rejected")) {
    setupText = zoneLabel ? `rejected from ${zoneLabel}` : "rejected key level";
  } else if (hasHint("retest")) {
    setupText = zoneLabel ? `retested ${zoneLabel}` : "retested breakout level";
  } else if (hasHint("breakout")) {
    setupText = zoneLabel ? `broke out from ${zoneLabel}` : "broke structure";
  } else if (zoneLabel) {
    setupText = `reacted from ${zoneLabel}`;
  }

  const confirmations = [];
  if (hasHint("bos")) confirmations.push("BOS");
  if (hasHint("choch")) confirmations.push("CHoCH");
  if (hasHint("engulfing")) confirmations.push("engulfing");
  if (hasHint("pin_bar")) confirmations.push("pin bar");
  if (hasHint("inside_bar")) confirmations.push("inside-bar break");

  const confirmationText = confirmations.length
    ? `${confirmations.slice(0, 2).join(" + ")} confirmation`
    : "";

  if (setupText && confirmationText) {
    return `${direction} ${setupText} with ${confirmationText}`;
  }
  if (setupText) {
    return `${direction} ${setupText}`;
  }
  if (confirmationText) {
    return `${direction} setup with ${confirmationText}`;
  }

  const eventName = String(event?.name || hit?.eventName || "").trim();
  const strategyName = String(strategy?.name || hit?.strategyName || "").trim();
  if (eventName && !/^(buy|sell|long|short)$/i.test(eventName)) {
    return `${direction} ${eventName.toLowerCase()}`;
  }
  if (strategyName) {
    return `${direction} ${strategyName.toLowerCase()} setup`;
  }
  return `${direction} rule match`;
}

function sanitizeStrategyText(value = "") {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const normalized = text.toLowerCase();
  if (normalized === "null" || normalized === "undefined") return "";
  return text;
}

function buildClientTradePlanFromAction({
  action = {},
  ctx = {},
  strategy = {},
  event = {},
  hit = {},
  sourceTf = "",
  latestArtifact = null,
  planIndex = 0,
  chartTf = "",
}) {
  const actionType = String(action?.action || action?.type || "")
    .trim()
    .toLowerCase();
  if (!actionType || (!actionType.startsWith("trade") && actionType !== "trade")) {
    return null;
  }
  const direction = resolveTradeDirectionFromAction(
    action,
    event?.bias || hit?.eventBias || "",
    latestArtifact,
  );
  const rawEntry = resolvePlanFieldValue(action?.trade_plan?.entry, ctx);
  const rawTp = resolvePlanFieldValue(action?.trade_plan?.tp, ctx);
  const rawSl = resolvePlanFieldValue(action?.trade_plan?.sl, ctx);
  const entry =
    toFiniteNumber(rawEntry) ??
    resolvePlanAnchorPrice(ctx, latestArtifact);
  if (!Number.isFinite(entry)) return null;
  let sl =
    toFiniteNumber(rawSl) ??
    resolvePlanStopFromArtifact(direction, latestArtifact);
  let tp =
    toFiniteNumber(rawTp) ??
    resolvePlanTargetFromArtifact(direction, latestArtifact);
  if (!Number.isFinite(sl) || !Number.isFinite(tp)) {
    const defaults = defaultTpSlFromEntry(entry, direction);
    if (!Number.isFinite(sl)) sl = defaults.sl;
    if (!Number.isFinite(tp)) tp = defaults.tp;
  }
  if (!Number.isFinite(sl) || !Number.isFinite(tp)) return null;
  const riskDistance = Math.abs(Number(entry) - Number(sl));
  if (riskDistance > 0 && !toFiniteNumber(rawTp)) {
    tp =
      direction === "SELL"
        ? Number(entry) - riskDistance * 2
        : Number(entry) + riskDistance * 2;
  }
  const startBar = Number(hit?.barTimeUnix || ctx?.bar?.time || 0) || null;
  const endBar =
    Number(ctx?.bars?.[ctx?.bars?.length - 1]?.time || hit?.barTimeUnix || 0) || null;
  return {
    id: [
      "client-plan",
      String(strategy?.id || strategy?.key || "strategy").trim(),
      String(event?.id || "event").trim(),
      String(sourceTf || chartTf || "").trim().toLowerCase(),
      String(startBar || 0),
      String(planIndex),
    ].join("|"),
    source: "client_strategy_engine",
    strategy: sanitizeStrategyText(strategy?.name || strategy?.id || ""),
    strategy_id: String(strategy?.id || strategy?.key || "").trim(),
    strategy_name: sanitizeStrategyText(strategy?.name || strategy?.id || ""),
    event_id: String(event?.id || "").trim(),
    event_name: sanitizeStrategyText(event?.name || event?.id || ""),
    rule_name: sanitizeStrategyText(event?.name || event?.id || ""),
    rules_checked: buildChartStrategyHitMessage({
      strategyName: sanitizeStrategyText(strategy?.name || strategy?.id || ""),
      eventName: sanitizeStrategyText(event?.name || event?.id || ""),
    }),
    condition: sanitizeStrategyText(event?.name || event?.id || ""),
    label: String(action?.label || event?.name || strategy?.name || "Trade Plan").trim(),
    direction,
    note: buildStrategyPlanNote({
      action,
      strategy,
      event,
      hit,
      latestArtifact,
    }),
    type:
      String(action?.trade_plan?.type || "market").trim().toLowerCase() || "market",
    entry,
    tp,
    tp1: tp,
    sl,
    timeframe: normalizeTfKey(sourceTf || chartTf || hit?.sourceTf || hit?.tf || ""),
    tf: normalizeTfKey(sourceTf || chartTf || hit?.sourceTf || hit?.tf || ""),
    source_tf: normalizeTfKey(sourceTf || chartTf || hit?.sourceTf || hit?.tf || ""),
    start_bar: startBar,
    end_bar: endBar,
    bar_start: startBar,
    bar_end: endBar,
    anchor_time: startBar,
    actions: Array.isArray(hit?.actions) ? hit.actions : [],
    latest_artifact: latestArtifact || null,
  };
}

function dedupeTradePlans(plans = []) {
  const map = new Map();
  (Array.isArray(plans) ? plans : []).forEach((plan) => {
    if (!plan || typeof plan !== "object") return;
    const key = String(plan?.id || "").trim() || [
      normalizeTfKey(plan?.tf || plan?.timeframe || ""),
      String(plan?.strategy_id || plan?.strategy || ""),
      String(plan?.event_id || ""),
      String(plan?.start_bar || ""),
      String(plan?.direction || ""),
      String(plan?.entry || ""),
      String(plan?.tp || ""),
      String(plan?.sl || ""),
    ].join("|");
    map.set(key, plan);
  });
  return Array.from(map.values()).sort(
    (left, right) => Number(left?.start_bar || 0) - Number(right?.start_bar || 0),
  );
}

export function groupArtifactsBySourceTf(ruleResult, fallbackTf = "", fallbackTimeUnix = 0) {
  const groups = new Map();
  (Array.isArray(ruleResult?.matches) ? ruleResult.matches : []).forEach((item) => {
    const sourceTf = artifactSourceTf(item, fallbackTf) || normalizeTfKey(fallbackTf);
    const markerTimeUnix =
      Number(artifactMatchTime(item) || fallbackTimeUnix) || fallbackTimeUnix;
    const artifactId = String(item?.id || "").trim();
    const key = [
      sourceTf || "current",
      markerTimeUnix || 0,
      artifactId || String(item?.type || "").trim().toLowerCase(),
    ].join("|");
    if (!groups.has(key)) {
      groups.set(key, {
        sourceTf: sourceTf || normalizeTfKey(fallbackTf),
        markerTimeUnix,
        artifacts: [],
        groupKey: key,
      });
    }
    groups.get(key).artifacts.push(item);
  });
  return Array.from(groups.values())
    .map((group) => {
      const ordered = [...group.artifacts].sort(
        (left, right) => artifactMatchTime(left) - artifactMatchTime(right),
      );
      const latestArtifact = ordered[ordered.length - 1] || null;
      return {
        sourceTf: group.sourceTf || normalizeTfKey(fallbackTf),
        artifacts: ordered,
        latestArtifact,
        groupKey: group.groupKey,
        markerTimeUnix:
          Number(group.markerTimeUnix || artifactMatchTime(latestArtifact) || fallbackTimeUnix) ||
          fallbackTimeUnix,
      };
    })
    .sort((left, right) => {
      if (left.markerTimeUnix !== right.markerTimeUnix) {
        return Number(left.markerTimeUnix) - Number(right.markerTimeUnix);
      }
      return String(left.sourceTf || "").localeCompare(String(right.sourceTf || ""));
    });
}

function dedupeStrategyHits(hits = []) {
  const map = new Map();
  (Array.isArray(hits) ? hits : []).forEach((hit) => {
    const key = String(hit?.matchKey || "").trim();
    if (!key) return;
    map.set(key, hit);
  });
  return Array.from(map.values()).sort(
    (left, right) => Number(left?.barTimeUnix || 0) - Number(right?.barTimeUnix || 0),
  );
}

export function buildChartStrategyHitMessage({
  strategyName = "",
  eventName = "",
} = {}) {
  const safeStrategy = sanitizeStrategyText(strategyName);
  const safeEvent = sanitizeStrategyText(eventName);
  return [safeStrategy, safeEvent].filter(Boolean).join(" · ");
}

export function buildChartStrategyNotificationPayload(match = {}) {
  const message = buildChartStrategyHitMessage({
    strategyName: match.strategyName,
    eventName: match.eventName,
  });
  return {
    event: "chart_strategy_checked",
    type: "info",
    message,
    notification: true,
    position: "bottom-left",
    page: "chart_analysis",
  };
}

function resolveStrategyMarkerMeta(
  actions = [],
  fallbackEventName = "",
  fallbackBias = "",
  latestArtifact = null,
) {
  const normalizedActionTypes = (Array.isArray(actions) ? actions : [])
    .map((action) => String(action?.action || action?.type || "").trim().toLowerCase())
    .filter(Boolean);
  const normalizedDirections = (Array.isArray(actions) ? actions : [])
    .map((action) => String(action?.trade_plan?.direction || "").trim().toLowerCase())
    .filter(Boolean);
  const explicitColor = (Array.isArray(actions) ? actions : [])
    .map((action) => String(action?.color || "").trim())
    .find(Boolean);
  const artifactDirection = String(
    latestArtifact?.direction ||
      latestArtifact?.payload?.bias ||
      latestArtifact?.subtype ||
      "",
  )
    .trim()
    .toLowerCase();
  const eventHint = String(fallbackEventName || "").trim().toLowerCase();
  const biasHint = String(fallbackBias || "").trim().toLowerCase();
  const combinedHints = [
    ...normalizedActionTypes,
    ...normalizedDirections,
    artifactDirection,
    eventHint,
    biasHint,
  ].join(" ");
  const bullishHint =
    /\bbull\b|\bbullish\b|\bbuy\b|\blong\b|\bentry long\b/.test(combinedHints);
  const bearishHint =
    /\bbear\b|\bbearish\b|\bsell\b|\bshort\b|\bentry short\b/.test(combinedHints);
  if (explicitColor && bullishHint) {
    return {
      direction: "up",
      color: explicitColor,
      shape: "arrowUp",
      position: "belowBar",
    };
  }
  if (explicitColor && bearishHint) {
    return {
      direction: "down",
      color: explicitColor,
      shape: "arrowDown",
      position: "aboveBar",
    };
  }
  if (
    (
      normalizedActionTypes.some(
        (type) =>
          type === "trade.open.long" ||
          type === "trade.close.short",
      ) ||
      (
        normalizedActionTypes.some((type) => type === "trade") &&
        normalizedDirections.some((direction) => ["buy", "long", "bull"].includes(direction))
      )
    ) ||
    bullishHint
  ) {
    return {
      direction: "up",
      color: explicitColor || "#22c55e",
      shape: "arrowUp",
      position: "belowBar",
    };
  }
  if (
    (
      normalizedActionTypes.some(
        (type) =>
          type === "trade.open.short" ||
          type === "trade.close.long",
      ) ||
      (
        normalizedActionTypes.some((type) => type === "trade") &&
        normalizedDirections.some((direction) => ["sell", "short", "bear"].includes(direction))
      )
    ) ||
    bearishHint
  ) {
    return {
      direction: "down",
      color: explicitColor || "#ef4444",
      shape: "arrowDown",
      position: "aboveBar",
    };
  }
  if (/\bbear\b|\bbearish\b|\bdown\b/.test(combinedHints)) {
    return {
      direction: "down",
      color: "#ef4444",
      shape: "arrowDown",
      position: "aboveBar",
    };
  }
  if (/\bbull\b|\bbullish\b|\bup\b/.test(combinedHints)) {
    return {
      direction: "up",
      color: "#22c55e",
      shape: "arrowUp",
      position: "belowBar",
    };
  }
  return {
    direction: "up",
    color: "#38bdf8",
    shape: "circle",
    position: "belowBar",
  };
}

export function evaluateChartStrategies({
  bars = [],
  strategies = [],
  lookbackBars = 100,
  symbol = "",
  tf = "",
  multiTfBars = null,
  scanMode = "live",
  skipConditions = true,
  newsEvents = [],
} = {}) {
  const normalizedBars = Array.isArray(bars) ? bars : [];
  const normalizedStrategies = (Array.isArray(strategies) ? strategies : []).filter(
    Boolean,
  );
  if (normalizedBars.length < 2 || !normalizedStrategies.length) {
    return { matches: [] };
  }

  const lookback = Math.max(1, Math.round(Number(lookbackBars) || 100));
  const startIndex = Math.max(1, normalizedBars.length - lookback);
  const matches = [];
  const latestMatches = [];
  const tradePlans = [];

  normalizedStrategies.forEach((strategy) => {
    const chartTf = normalizeTfKey(tf);
    const strategyTf = normalizeTfKey(strategy?.market?.tf || "");
    const strategyEngine = createStrategyScanEngine({
      strategy,
      scanMode,
      skipConditions,
      tf: chartTf || strategyTf || tf,
      symbol: String(symbol || strategy?.market?.symbol || "").trim().toUpperCase(),
      newsEvents,
    });
    if (!strategyEngine.isStrategyAllowed().allowed) return;
    const derivedArtifacts = sharedArtifactDetection.buildDerivedItemsFromBars(
      normalizedBars,
      chartTf || strategyTf || "",
    );
    const multiTf = buildMultiTfContextEntries(
      multiTfBars,
      chartTf || strategyTf || tf,
    );
    const indicators = {};
    const atrValues = atrSeries(normalizedBars, 14);
    let lastSignalBarIndex = null;
    const sessionSignalCounts = new Map();
    (Array.isArray(strategy?.indicators) ? strategy.indicators : []).forEach(
      (indicator) => {
        if (!indicator?.id) return;
        indicators[String(indicator.id).trim()] = computeIndicatorSeries(
          normalizedBars,
          indicator,
        );
      },
    );

    normalizeStrategyEvents(strategy).forEach((event) => {
      let latestHit = null;
      const currentBarOnly = Boolean(strategy?.metadata?.preview_current_bar_only);
      for (let index = startIndex; index < normalizedBars.length; index += 1) {
        const currentIndicators = {};
        const prevIndicators = {};
        Object.entries(indicators).forEach(([indicatorId, series]) => {
          currentIndicators[indicatorId] = series[index];
          prevIndicators[indicatorId] = series[index - 1];
        });
        const barTimeUnix = Number(normalizedBars[index]?.time || 0);
        const currentSession = inferSessionName(barTimeUnix);
        const runtimeState = {
          atr: atrValues[index],
          session: currentSession,
          signalsInSession: sessionSignalCounts.get(currentSession) || 0,
          barsSinceLastSignal:
            lastSignalBarIndex == null ? Number.POSITIVE_INFINITY : index - lastSignalBarIndex,
        };
        if (
          !strategyEngine.isAllowedAtTime(
            Number.isFinite(barTimeUnix) ? barTimeUnix * 1000 : Date.now(),
            runtimeState,
          ).allowed
        ) {
          continue;
        }
        const ctx = buildRuleContext({
          bars: normalizedBars,
          index,
          strategy,
          currentIndicators,
          prevIndicators,
          derivedArtifacts,
          multiTf,
          tf: chartTf || strategyTf || tf,
        });
        const ruleResult = evaluateRule(event.when, ctx);
        if (!strategyEventFunctions.ruleResultTruthy(ruleResult)) continue;
        const ruleEvent = sharedRulesEngine.normalizeRuleEvent({
          rule: {
            id: String(event.id || "").trim(),
            abbr: String(event.abbr || event.short_name || event.id || "").trim(),
            name: String(event.name || event.id || "Rule").trim(),
            icon: String(event.icon || "activity").trim(),
            family: String(event.family || "strategy").trim(),
            params: {},
            outputs: {
              ...(event.outputs && typeof event.outputs === "object" ? event.outputs : {}),
              bias: String(event.bias || event.outputs?.bias || "").trim().toLowerCase(),
              priority: String(event.priority || event.outputs?.priority || "").trim(),
            },
          },
          result: ruleResult,
          ctx: {
            ...ctx,
            symbol: String(symbol || strategy?.market?.symbol || "").trim().toUpperCase(),
            tf: chartTf || strategyTf || tf,
          },
          index,
        });
        if (
          currentBarOnly &&
          strategyEventFunctions.isArtifactResult(ruleResult)
        ) {
          const currentTime = Number(normalizedBars[index]?.time || 0);
          const hasCurrentBarArtifact = (Array.isArray(ruleResult.matches) ? ruleResult.matches : [])
            .some((item) => artifactMatchTime(item) === currentTime);
          if (!hasCurrentBarArtifact) continue;
        }
        const baseHit = {
          strategyId: String(strategy?.id || strategy?.key || "").trim(),
          strategyName:
            String(strategy?.name || strategy?.id || strategy?.key || "Strategy").trim() ||
            "Strategy",
          strategyDescription: String(strategy?.description || "").trim(),
          eventId: String(event.id || "").trim(),
          eventName: String(event.name || event.id || "Rule").trim() || "Rule",
          eventBias: String(event.bias || "").trim(),
          eventPriority: String(event.priority || "").trim(),
          ruleDefinition:
            event?.when && typeof event.when === "object" ? event.when : null,
          ruleEvent,
          actions: Array.isArray(event.actions) ? event.actions : [],
          barIndex: index,
          barTimeUnix: Number(normalizedBars[index]?.time || 0),
          barClose: Number(normalizedBars[index]?.close ?? null),
          barHigh: Number(normalizedBars[index]?.high ?? null),
          barLow: Number(normalizedBars[index]?.low ?? null),
          symbol: String(symbol || strategy?.market?.symbol || "").trim().toUpperCase(),
          tf: String(tf || strategy?.market?.tf || "").trim(),
        };
        const hitGroups = strategyEventFunctions.isArtifactResult(ruleResult)
          ? groupArtifactsBySourceTf(
              ruleResult,
              chartTf || strategyTf || tf,
              Number(normalizedBars[index]?.time || 0),
            )
          : [
              {
                sourceTf: normalizeTfKey(chartTf || strategyTf || tf),
                artifacts: null,
                latestArtifact: null,
                markerTimeUnix: Number(normalizedBars[index]?.time || 0),
              },
            ];
        hitGroups.forEach((group) => {
          const hit = {
            ...baseHit,
            barTimeUnix: group.markerTimeUnix || baseHit.barTimeUnix,
            sourceTf: group.sourceTf || normalizeTfKey(chartTf || strategyTf || tf),
          };
          if (group.artifacts) {
            hit.artifacts = group.artifacts;
            hit.latestArtifact = group.latestArtifact || null;
            hit.ruleMeta =
              ruleResult?.meta && typeof ruleResult.meta === "object"
                ? ruleResult.meta
                : null;
          }
          const hitTradePlans = (Array.isArray(event.actions) ? event.actions : [])
            .map((action, actionIndex) =>
              strategyEngine.filterTradePlan(
                buildClientTradePlanFromAction({
                  action,
                  ctx,
                  strategy,
                  event,
                  hit,
                  sourceTf: group.sourceTf || normalizeTfKey(chartTf || strategyTf || tf),
                  latestArtifact: group.latestArtifact || null,
                  planIndex: actionIndex,
                  chartTf: chartTf || strategyTf || tf,
                }),
                {
                  timeMs:
                    (Number(hit?.barTimeUnix || ctx?.bar?.time || 0) || Date.now() / 1000) *
                    1000,
                  runtimeState,
                },
              ),
            )
            .filter(Boolean);
          if (hitTradePlans.length) {
            hit.tradePlans = hitTradePlans;
            tradePlans.push(...hitTradePlans);
          }
          const markerMeta = resolveStrategyMarkerMeta(
            hit.actions,
            hit.eventName,
            event.bias,
            hit.latestArtifact,
          );
          hit.displayText = buildChartStrategyHitMessage(hit);
          hit.markerText = hit.strategyName;
          hit.markerDirection = markerMeta.direction;
          hit.markerColor = markerMeta.color;
          hit.markerShape = markerMeta.shape;
          hit.markerPosition = markerMeta.position;
          hit.matchKey = [
            hit.symbol,
            hit.tf,
            hit.sourceTf || "",
            hit.strategyId,
            hit.eventId,
            hit.barTimeUnix,
            group.groupKey || "",
          ].join("|");
          matches.push(hit);
          latestHit = hit;
          lastSignalBarIndex = index;
          sessionSignalCounts.set(
            currentSession,
            Number(sessionSignalCounts.get(currentSession) || 0) + 1,
          );
        });
      }
      if (!latestHit) return;
      latestMatches.push(latestHit);
    });
  });

  return {
    matches: dedupeStrategyHits(matches),
    latestMatches: dedupeStrategyHits(latestMatches),
    tradePlans: dedupeTradePlans(tradePlans),
    latestTradePlans: dedupeTradePlans(
      latestMatches.flatMap((hit) => (Array.isArray(hit?.tradePlans) ? hit.tradePlans : [])),
    ),
  };
}

export function collectContextualStrategyTradePlans({
  barsByTf = null,
  strategies = [],
  lookbackBars = 100,
  symbol = "",
  tf = "",
  timeSec = null,
  scanMode = "live",
  skipConditions = true,
  newsEvents = [],
} = {}) {
  const normalizedStrategies = (Array.isArray(strategies) ? strategies : []).filter(
    Boolean,
  );
  const normalizedTf = normalizeTfKey(tf);
  if (!barsByTf || typeof barsByTf !== "object" || !normalizedTf || !normalizedStrategies.length) {
    return [];
  }
  const cutoffTime = toFiniteNumber(timeSec);
  const contextualBarsByTf = {};
  Object.entries(barsByTf || {}).forEach(([tfKeyRaw, barsRaw]) => {
    const tfKey = normalizeTfKey(tfKeyRaw);
    const sourceBars = Array.isArray(barsRaw) ? barsRaw : [];
    if (!tfKey || sourceBars.length < 2) return;
    const scopedBars = Number.isFinite(cutoffTime)
      ? sourceBars.filter((bar) => Number(bar?.time || 0) <= cutoffTime)
      : sourceBars.slice();
    if (scopedBars.length < 2) return;
    contextualBarsByTf[tfKey] = scopedBars;
  });
  const focusBars = Array.isArray(contextualBarsByTf?.[normalizedTf])
    ? contextualBarsByTf[normalizedTf]
    : [];
  if (focusBars.length < 2) return [];
  const evaluation = evaluateChartStrategies({
    bars: focusBars,
    strategies: normalizedStrategies,
    lookbackBars: Math.min(
      focusBars.length,
      Math.max(1, Math.round(Number(lookbackBars) || focusBars.length)),
    ),
    symbol,
    tf: normalizedTf,
    multiTfBars: contextualBarsByTf,
    scanMode,
    skipConditions,
    newsEvents,
  });
  const plans = Array.isArray(evaluation?.latestTradePlans)
    ? evaluation.latestTradePlans
    : Array.isArray(evaluation?.tradePlans)
      ? evaluation.tradePlans
      : [];
  return dedupeTradePlans(plans);
}
