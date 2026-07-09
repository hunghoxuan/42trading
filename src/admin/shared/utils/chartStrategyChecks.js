import * as sharedArtifactDetection from "../../modules/42trade/chartArtifacts/detectArtifacts.js";
import * as strategyEventFunctions from "../../modules/42trade/chartArtifacts/strategyEventFunctions.js";

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
  get_artifacts: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("get_artifacts", args, ctx, evaluate),
  is_true: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("is_true", args, ctx, evaluate),
  draw: (args, ctx, evaluate) =>
    strategyEventFunctions.evaluateNamedFunction("draw", args, ctx, evaluate),
};

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
  if (typeof node.fn === "string") {
    const functionName = String(node.fn || "").trim();
    const evaluator = RULE_FUNCTION_EVALUATORS[functionName];
    if (!evaluator) return null;
    const args = Array.isArray(node.args) ? node.args : [];
    return evaluator(args, ctx, evaluateRule);
  }
  const entries = Object.entries(node);
  if (entries.length !== 1) return null;
  const [operator, rawValue] = entries[0];
  const items = Array.isArray(rawValue) ? rawValue : [rawValue];
  const values = items.map((item) => evaluateRule(item, ctx));
  switch (operator) {
    case "var":
      return valueAtPath(ctx, rawValue);
    case "and":
      return strategyEventFunctions.mergeArtifactResults("and", values);
    case "then":
      return strategyEventFunctions.mergeArtifactResults("then", values);
    case "or":
      return strategyEventFunctions.mergeArtifactResults("or", values);
    case "not":
      return !strategyEventFunctions.ruleResultTruthy(values[0]);
    case "if":
      for (let index = 0; index < values.length - 1; index += 2) {
        if (strategyEventFunctions.ruleResultTruthy(values[index])) {
          return values[index + 1];
        }
      }
      return values.length % 2 === 1 ? values[values.length - 1] : null;
    default:
      return Object.prototype.hasOwnProperty.call(RULE_OPERATOR_EVALUATORS, operator)
        ? RULE_OPERATOR_EVALUATORS[operator](values, rawValue, ctx)
        : null;
  }
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
  if (Array.isArray(strategy?.rules) && strategy.rules.length) {
    return strategy.rules
      .map((rule, ruleIndex) => ({
        id:
          String(rule?.id || `rule_${ruleIndex + 1}`).trim() ||
          `rule_${ruleIndex + 1}`,
        name:
          String(rule?.name || rule?.label || `Rule ${ruleIndex + 1}`).trim() ||
          `Rule ${ruleIndex + 1}`,
        bias: String(rule?.bias || "").trim().toLowerCase(),
        when: rule?.when && typeof rule.when === "object" ? rule.when : null,
        actions: Array.isArray(rule?.actions) ? rule.actions : [],
      }))
      .filter((rule) => rule.when);
  }
  return (Array.isArray(strategy?.events) ? strategy.events : [])
    .map((event, eventIndex) => ({
      id:
        String(event?.id || `event_${eventIndex + 1}`).trim() ||
        `event_${eventIndex + 1}`,
      name:
        String(event?.name || event?.label || `Event ${eventIndex + 1}`).trim() ||
        `Event ${eventIndex + 1}`,
      bias: String(event?.bias || "").trim().toLowerCase(),
      when: event?.when && typeof event.when === "object" ? event.when : null,
      actions: Array.isArray(event?.actions) ? event.actions : [],
    }))
    .filter((event) => event.when);
}

function buildRuleContext({
  bars,
  index,
  strategy,
  currentIndicators,
  prevIndicators,
  derivedArtifacts,
  multiTf,
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
  return `${String(strategyName || "Strategy").trim() || "Strategy"} · ${
    String(eventName || "Rule").trim() || "Rule"
  }`;
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

  normalizedStrategies.forEach((strategy) => {
    const strategyTf = normalizeTfKey(strategy?.market?.tf || "");
    const chartTf = normalizeTfKey(tf);
    if (strategyTf && chartTf && strategyTf !== chartTf) return;
    const derivedArtifacts = sharedArtifactDetection.buildDerivedItemsFromBars(
      normalizedBars,
      chartTf || strategyTf || "",
    );
    const multiTf = buildMultiTfContextEntries(
      multiTfBars,
      chartTf || strategyTf || tf,
    );
    const indicators = {};
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
          eventId: String(event.id || "").trim(),
          eventName: String(event.name || event.id || "Rule").trim() || "Rule",
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
        });
      }
      if (!latestHit) return;
      latestMatches.push(latestHit);
    });
  });

  return {
    matches: dedupeStrategyHits(matches),
    latestMatches: dedupeStrategyHits(latestMatches),
  };
}
