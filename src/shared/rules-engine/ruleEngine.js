"use strict";

import * as strategyEventFunctions from "./features/strategyEventFunctions.js";

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

function resolveCrossValues(rawValue, ctx, evaluate) {
  if (Array.isArray(rawValue)) {
    if (rawValue.length >= 4) {
      const [leftPrevNode, leftNode, rightPrevNode, rightNode] = rawValue;
      return [
        evaluate(leftPrevNode, ctx),
        evaluate(leftNode, ctx),
        evaluate(rightPrevNode, ctx),
        evaluate(rightNode, ctx),
      ];
    }
    if (rawValue.length >= 2) {
      const [leftNode, rightNode] = rawValue;
      return [
        evaluate(inferPreviousRuleNode(leftNode), ctx),
        evaluate(leftNode, ctx),
        evaluate(inferPreviousRuleNode(rightNode), ctx),
        evaluate(rightNode, ctx),
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
      evaluate(leftPrevNode, ctx),
      evaluate(rawValue.left, ctx),
      evaluate(rightPrevNode, ctx),
      evaluate(rawValue.right, ctx),
    ];
  }
  return [null, null, null, null];
}

function resolveLevelFromCrossValues(rawValue, ctx, evaluate) {
  const [leftPrev, leftCurrent, rightPrev, rightCurrent] = resolveCrossValues(
    rawValue,
    ctx,
    evaluate,
  );
  const level =
    Number.isFinite(Number(rightCurrent)) ? Number(rightCurrent) :
    Number.isFinite(Number(rightPrev)) ? Number(rightPrev) :
    null;
  return { leftPrev, leftCurrent, rightPrev, rightCurrent, level };
}

function evaluateComparatorRetest(rawValue, ctx, evaluate) {
  const { leftPrev, leftCurrent, level } = resolveLevelFromCrossValues(rawValue, ctx, evaluate);
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
  return (prevValue > level && currentValue > level) || (prevValue < level && currentValue < level);
}

function evaluateComparatorRejected(rawValue, ctx, evaluate) {
  const { leftCurrent, level } = resolveLevelFromCrossValues(rawValue, ctx, evaluate);
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
  return (barLow <= level && currentValue > level) || (barHigh >= level && currentValue < level);
}

function evaluateComparatorTouches(rawValue, ctx, evaluate) {
  const { level } = resolveLevelFromCrossValues(rawValue, ctx, evaluate);
  const barHigh = Number(ctx?.bar?.high);
  const barLow = Number(ctx?.bar?.low);
  if (!Number.isFinite(level) || !Number.isFinite(barHigh) || !Number.isFinite(barLow)) {
    return false;
  }
  return barLow <= level && barHigh >= level;
}

function evaluateComparatorHoldsAbove(rawValue, ctx, evaluate) {
  const { leftPrev, leftCurrent, level } = resolveLevelFromCrossValues(rawValue, ctx, evaluate);
  return Number(leftPrev) > level && Number(leftCurrent) > level;
}

function evaluateComparatorHoldsBelow(rawValue, ctx, evaluate) {
  const { leftPrev, leftCurrent, level } = resolveLevelFromCrossValues(rawValue, ctx, evaluate);
  return Number(leftPrev) < level && Number(leftCurrent) < level;
}

function evaluateComparatorSweepsAbove(rawValue, ctx, evaluate) {
  const { leftCurrent, level } = resolveLevelFromCrossValues(rawValue, ctx, evaluate);
  const barHigh = Number(ctx?.bar?.high);
  return Number.isFinite(level) && Number.isFinite(Number(leftCurrent)) && Number.isFinite(barHigh)
    ? barHigh > level && Number(leftCurrent) < level
    : false;
}

function evaluateComparatorSweepsBelow(rawValue, ctx, evaluate) {
  const { leftCurrent, level } = resolveLevelFromCrossValues(rawValue, ctx, evaluate);
  const barLow = Number(ctx?.bar?.low);
  return Number.isFinite(level) && Number.isFinite(Number(leftCurrent)) && Number.isFinite(barLow)
    ? barLow < level && Number(leftCurrent) > level
    : false;
}

const RULE_FUNCTION_NAMES = [
  "touches",
  "retest",
  "rejected",
  "holds_above",
  "holds_below",
  "sweeps_above",
  "sweeps_below",
  "sweep",
  "has_sweep",
  "bos",
  "has_bos",
  "choch",
  "has_choch",
  "breakout",
  "pin_bar",
  "engulfing",
  "inside_bar",
  "outside_bar",
  "reversal",
  "trend",
  "bias",
  "phase",
  "price_action_sl",
  "price_action_tp",
  "suggested_trade_sl",
  "suggested_trade_tp",
  "get_artifacts",
  "is_true",
  "draw",
];

const RULE_FUNCTION_EVALUATORS = Object.fromEntries(
  RULE_FUNCTION_NAMES.map((name) => [
    name,
    (args, ctx, evaluate) => strategyEventFunctions.evaluateNamedFunction(name, args, ctx, evaluate),
  ]),
);

for (const comparatorName of [
  "touches",
  "retest",
  "rejected",
  "holds_above",
  "holds_below",
  "sweeps_above",
  "sweeps_below",
]) {
  const artifactEvaluator = RULE_FUNCTION_EVALUATORS[comparatorName];
  RULE_FUNCTION_EVALUATORS[comparatorName] = (args, ctx, evaluate) => {
    const result = artifactEvaluator(args, ctx, evaluate);
    if (strategyEventFunctions.ruleResultTruthy(result)) return result;
    return evaluate({ [comparatorName]: args }, ctx);
  };
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
  crosses_above: (_values, rawValue, ctx, evaluate) => {
    const [leftPrev, leftCurrent, rightPrev, rightCurrent] = resolveCrossValues(rawValue, ctx, evaluate);
    return (
      Number.isFinite(Number(leftPrev)) &&
      Number.isFinite(Number(leftCurrent)) &&
      Number.isFinite(Number(rightPrev)) &&
      Number.isFinite(Number(rightCurrent)) &&
      Number(leftPrev) <= Number(rightPrev) &&
      Number(leftCurrent) > Number(rightCurrent)
    );
  },
  crosses_below: (_values, rawValue, ctx, evaluate) => {
    const [leftPrev, leftCurrent, rightPrev, rightCurrent] = resolveCrossValues(rawValue, ctx, evaluate);
    return (
      Number.isFinite(Number(leftPrev)) &&
      Number.isFinite(Number(leftCurrent)) &&
      Number.isFinite(Number(rightPrev)) &&
      Number.isFinite(Number(rightCurrent)) &&
      Number(leftPrev) >= Number(rightPrev) &&
      Number(leftCurrent) < Number(rightCurrent)
    );
  },
  touches: (_values, rawValue, ctx, evaluate) => evaluateComparatorTouches(rawValue, ctx, evaluate),
  retest: (_values, rawValue, ctx, evaluate) => evaluateComparatorRetest(rawValue, ctx, evaluate),
  rejected: (_values, rawValue, ctx, evaluate) => evaluateComparatorRejected(rawValue, ctx, evaluate),
  holds_above: (_values, rawValue, ctx, evaluate) => evaluateComparatorHoldsAbove(rawValue, ctx, evaluate),
  holds_below: (_values, rawValue, ctx, evaluate) => evaluateComparatorHoldsBelow(rawValue, ctx, evaluate),
  sweeps_above: (_values, rawValue, ctx, evaluate) => evaluateComparatorSweepsAbove(rawValue, ctx, evaluate),
  sweeps_below: (_values, rawValue, ctx, evaluate) => evaluateComparatorSweepsBelow(rawValue, ctx, evaluate),
};

function evaluateRuleExpression(node, ctx = {}) {
  if (node === null || node === undefined) return null;
  if (
    typeof node === "number" ||
    typeof node === "string" ||
    typeof node === "boolean"
  ) {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => evaluateRuleExpression(item, ctx));
  }
  if (typeof node !== "object") return null;
  if (typeof node.fn === "string") {
    const functionName = String(node.fn || "").trim();
    const evaluator = RULE_FUNCTION_EVALUATORS[functionName];
    if (!evaluator) return null;
    const args = Array.isArray(node.args) ? node.args : [];
    return evaluator(args, ctx, evaluateRuleExpression);
  }
  const entries = Object.entries(node);
  if (entries.length !== 1) return null;
  const [operator, rawValue] = entries[0];
  const items = Array.isArray(rawValue) ? rawValue : [rawValue];
  const values = items.map((item) => evaluateRuleExpression(item, ctx));
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
        if (strategyEventFunctions.ruleResultTruthy(values[index])) return values[index + 1];
      }
      return values.length % 2 === 1 ? values[values.length - 1] : null;
    default:
      return Object.prototype.hasOwnProperty.call(RULE_OPERATOR_EVALUATORS, operator)
        ? RULE_OPERATOR_EVALUATORS[operator](values, rawValue, ctx, evaluateRuleExpression)
        : null;
  }
}

function normalizeRuleDefinition(rule = {}, index = 0) {
  const id = String(rule?.id || `rule_${index + 1}`).trim() || `rule_${index + 1}`;
  return {
    id,
    abbr: String(rule?.abbr || rule?.short_name || id).trim() || id,
    name: String(rule?.name || rule?.label || id).trim() || id,
    icon: String(rule?.icon || "activity").trim() || "activity",
    family: String(rule?.family || "custom").trim() || "custom",
    condition:
      rule?.condition && typeof rule.condition === "object"
        ? rule.condition
        : rule?.when && typeof rule.when === "object"
          ? rule.when
          : null,
    params: rule?.params && typeof rule.params === "object" ? { ...rule.params } : {},
    outputs: rule?.outputs && typeof rule.outputs === "object" ? { ...rule.outputs } : {},
  };
}

function normalizeRuleEvent({ rule = {}, result = true, ctx = {}, index = 0 } = {}) {
  const bar = ctx?.bar && typeof ctx.bar === "object" ? ctx.bar : {};
  const latest =
    strategyEventFunctions.isArtifactResult(result) && result.latest
      ? result.latest
      : null;
  const time = Number(latest?.anchor_time ?? latest?.bar_end ?? latest?.time ?? bar?.time);
  const price = Number(latest?.price ?? latest?.price_high ?? latest?.price_low ?? bar?.close);
  const bias = String(
    rule?.outputs?.bias ||
      latest?.subtype ||
      latest?.direction ||
      result?.meta?.bias ||
      "",
  ).trim();
  return {
    id: `${rule.id}:${Number.isFinite(time) ? time : index}`,
    rule_id: rule.id,
    abbr: rule.abbr,
    name: rule.name,
    icon: rule.icon,
    family: rule.family,
    symbol: String(ctx?.symbol || ctx?.market?.symbol || "").trim().toUpperCase(),
    tf: String(ctx?.tf || ctx?.timeframe || ctx?.market?.tf || "").trim(),
    time: Number.isFinite(time) ? time : null,
    bar_index: Number.isFinite(Number(ctx?.index)) ? Number(ctx.index) : index,
    price: Number.isFinite(price) ? price : null,
    bias,
    confidence: Number(rule?.outputs?.confidence ?? 1) || 1,
    params: { ...(rule.params || {}) },
    evidence: {
      previous: ctx?.prev || null,
      current: bar || null,
      result: strategyEventFunctions.isArtifactResult(result)
        ? {
            functionName: result.functionName,
            latest,
            match_count: Array.isArray(result.matches) ? result.matches.length : 0,
            meta: result.meta || {},
          }
        : result,
    },
    artifact: {
      type: "marker",
      icon: rule.icon,
      label: rule.abbr,
    },
  };
}

function evaluateRuleDefinition(rule, ctx = {}, index = 0) {
  const normalized = normalizeRuleDefinition(rule, index);
  if (!normalized.condition) return null;
  const result = evaluateRuleExpression(normalized.condition, ctx);
  if (!strategyEventFunctions.ruleResultTruthy(result)) return null;
  return normalizeRuleEvent({ rule: normalized, result, ctx, index });
}

function evaluateRules({ bars = [], rules = [], baseContext = {}, buildContext = null } = {}) {
  const normalizedBars = Array.isArray(bars) ? bars : [];
  const normalizedRules = (Array.isArray(rules) ? rules : []).map(normalizeRuleDefinition);
  const events = [];
  normalizedBars.forEach((bar, index) => {
    const ctx =
      typeof buildContext === "function"
        ? buildContext({ bar, index, bars: normalizedBars, baseContext })
        : {
            ...baseContext,
            bars: normalizedBars,
            index,
            bar,
            prev: index > 0 ? normalizedBars[index - 1] : null,
          };
    normalizedRules.forEach((rule) => {
      const event = evaluateRuleDefinition(rule, ctx, index);
      if (event) events.push(event);
    });
  });
  return { events };
}

class RuleEngine {
  constructor({ rules = [] } = {}) {
    this.rules = (Array.isArray(rules) ? rules : []).map(normalizeRuleDefinition);
  }

  evaluateBars(options = {}) {
    return evaluateRules({ ...options, rules: options.rules || this.rules });
  }

  evaluateRule(rule, ctx = {}, index = 0) {
    return evaluateRuleDefinition(rule, ctx, index);
  }
}

export {
  RuleEngine,
  evaluateRuleDefinition,
  evaluateRuleExpression,
  evaluateRules,
  normalizeRuleDefinition,
  normalizeRuleEvent,
  valueAtPath,
};
