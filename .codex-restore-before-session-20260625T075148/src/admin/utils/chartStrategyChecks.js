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
      for (let index = 0; index < values.length - 1; index += 2) {
        if (values[index]) return values[index + 1];
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
        : values
            .slice(1)
            .reduce((sum, value) => Number(sum) - Number(value), Number(values[0]));
    case "*":
      return values.reduce(
        (product, value) => Number(product) * Number(value),
        1,
      );
    case "/":
      return values
        .slice(1)
        .reduce(
          (quotient, value) => Number(quotient) / Number(value || 1),
          Number(values[0]),
        );
    case "abs":
      return Math.abs(Number(values[0]));
    case "min":
      return Math.min(...values.map(Number));
    case "max":
      return Math.max(...values.map(Number));
    case "crosses_above": {
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
    }
    case "crosses_below": {
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
    }
    default:
      return null;
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
  return (Array.isArray(strategy?.events) ? strategy.events : [])
    .map((event, eventIndex) => ({
      id:
        String(event?.id || `event_${eventIndex + 1}`).trim() ||
        `event_${eventIndex + 1}`,
      name:
        String(event?.name || event?.label || `Event ${eventIndex + 1}`).trim() ||
        `Event ${eventIndex + 1}`,
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
}) {
  return {
    bar: bars[index] || null,
    prev: bars[index - 1] || null,
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
  };
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

function resolveStrategyMarkerMeta(actions = [], fallbackEventName = "") {
  const normalizedActionTypes = (Array.isArray(actions) ? actions : [])
    .map((action) => String(action?.type || "").trim().toLowerCase())
    .filter(Boolean);
  const eventHint = String(fallbackEventName || "").trim().toLowerCase();
  const combinedHints = [...normalizedActionTypes, eventHint].join(" ");
  if (
    normalizedActionTypes.some(
      (type) =>
        type === "trade.open.long" ||
        type === "trade.close.short",
    ) ||
    /\blong\b|\bbuy\b|\bentry long\b/.test(combinedHints)
  ) {
    return {
      direction: "up",
      color: "#22c55e",
      shape: "arrowUp",
      position: "belowBar",
    };
  }
  if (
    normalizedActionTypes.some(
      (type) =>
        type === "trade.open.short" ||
        type === "trade.close.long",
    ) ||
    /\bshort\b|\bsell\b|\bentry short\b/.test(combinedHints)
  ) {
    return {
      direction: "down",
      color: "#ef4444",
      shape: "arrowDown",
      position: "aboveBar",
    };
  }
  return {
    direction: "up",
    color: "#22c55e",
    shape: "arrowUp",
    position: "belowBar",
  };
}

function resolveStrategyMarkerMeta(actions = [], fallbackEventName = "") {
  const normalizedActionTypes = (Array.isArray(actions) ? actions : [])
    .map((action) => String(action?.type || "").trim().toLowerCase())
    .filter(Boolean);
  const eventHint = String(fallbackEventName || "").trim().toLowerCase();
  const combinedHints = [...normalizedActionTypes, eventHint].join(" ");
  if (
    normalizedActionTypes.some(
      (type) =>
        type === "trade.open.long" ||
        type === "trade.close.short",
    ) ||
    /\blong\b|\bbuy\b|\bentry long\b/.test(combinedHints)
  ) {
    return {
      direction: "up",
      color: "#22c55e",
      shape: "arrowUp",
      position: "belowBar",
    };
  }
  if (
    normalizedActionTypes.some(
      (type) =>
        type === "trade.open.short" ||
        type === "trade.close.long",
    ) ||
    /\bshort\b|\bsell\b|\bentry short\b/.test(combinedHints)
  ) {
    return {
      direction: "down",
      color: "#ef4444",
      shape: "arrowDown",
      position: "aboveBar",
    };
  }
  return {
    direction: "up",
    color: "#22c55e",
    shape: "arrowUp",
    position: "belowBar",
  };
}

export function evaluateChartStrategies({
  bars = [],
  strategies = [],
  lookbackBars = 100,
  symbol = "",
  tf = "",
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
        });
        if (!Boolean(evaluateRule(event.when, ctx))) continue;
        const hit = {
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
        const markerMeta = resolveStrategyMarkerMeta(
          hit.actions,
          hit.eventName,
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
          hit.strategyId,
          hit.eventId,
          hit.barTimeUnix,
        ].join("|");
        matches.push(hit);
        latestHit = hit;
      }
      if (!latestHit) return;
      latestMatches.push(latestHit);
    });
  });

  matches.sort((left, right) => Number(left.barTimeUnix || 0) - Number(right.barTimeUnix || 0));
  latestMatches.sort(
    (left, right) => Number(left.barTimeUnix || 0) - Number(right.barTimeUnix || 0),
  );
  return { matches, latestMatches };
}
