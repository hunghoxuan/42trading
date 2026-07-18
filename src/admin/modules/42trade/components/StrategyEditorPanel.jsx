import { useEffect, useMemo, useState } from "react";
import BacktestSummaryMetaRow from "./BacktestSummaryMetaRow";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import RuleBuilder, {
  createEmptyRuleDraft,
  normalizeRuleAction,
  normalizeRuleDraft,
} from "./RuleBuilder.jsx";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import TabBar from "../../../shared/components/TabBar";
import ToggleButton from "../../../shared/components/ToggleButton";
import TimeframeSelector from "../../system/components/TimeframeSelector.jsx";
import strategyFunctions from "../../../../config/strategyFunctions.json";
import { buildRuleVariableValues } from "../../../shared/utils/ruleVariableOptions";
import {
  appendGroupChild,
  ensureGroupRootDraft,
  makeEmptyConditionDraft,
  makeEmptyGroupDraft,
} from "../../../shared/utils/strategyRuleEditor.js";

const EDITOR_TABS = [
  { value: "edit", label: "Edit" },
  { value: "json", label: "Json" },
];

const EDITOR_HASH_TO_TAB = {
  "#json": "json",
  "#edit": "edit",
};

const LOGIC_OPTIONS = [
  { value: "and", label: "AND" },
  { value: "or", label: "OR" },
  { value: "then", label: "THEN" },
];

const PREDICATE_FUNCTION_OPTIONS = (Array.isArray(strategyFunctions?.functions)
  ? strategyFunctions.functions
  : []
).filter((item) => item?.kind === "predicate");

const PREDICATE_FUNCTION_VALUES = new Set(
  PREDICATE_FUNCTION_OPTIONS.map((item) => String(item?.value || "").trim()).filter(Boolean),
);

const COMPARATOR_OPTIONS = (Array.isArray(strategyFunctions?.operators)
  ? strategyFunctions.operators
  : []
).filter(
  (item) =>
    item?.category === "comparator" &&
    !PREDICATE_FUNCTION_VALUES.has(String(item?.value || "").trim()),
);

const CONDITION_MODE_OPTIONS = [
  { value: "compare", label: "Compare" },
  { value: "if_true", label: "If True" },
  { value: "if_not", label: "If Not" },
  { value: "is_true", label: "Rule True" },
  { value: "get_artifacts", label: "GET_ARTIFACTS" },
  { value: "draw", label: "DRAW" },
];

const TIMEFRAME_OPTIONS = [
  { value: "", label: "Null" },
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "60", label: "1h" },
  { value: "240", label: "4h" },
  { value: "1440", label: "1d" },
];

const STRATEGY_FUNCTION_TF_OPTIONS = [
  { value: "", label: "Current TF" },
  { value: "all", label: "All TFs" },
  ...TIMEFRAME_OPTIONS,
];

const STRATEGY_FUNCTION_BIAS_OPTIONS = [
  { value: "", label: "Any Bias" },
  { value: "bullish", label: "Bullish" },
  { value: "bearish", label: "Bearish" },
];

const STRATEGY_FUNCTION_PHASE_OPTIONS = [
  { value: "", label: "Any Phase" },
  { value: "impulse", label: "Impulse" },
  { value: "pullback", label: "Pullback" },
  { value: "continuation", label: "Continuation" },
  { value: "reversal", label: "Reversal" },
  { value: "consolidation", label: "Consolidation" },
];

const WEBHOOK_METHOD_OPTIONS = [
  { value: "POST", label: "POST" },
  { value: "GET", label: "GET" },
];

const INDICATOR_TYPE_OPTIONS = [
  { value: "ema", label: "EMA" },
  { value: "sma", label: "SMA" },
  { value: "rsi", label: "RSI" },
  { value: "roc", label: "ROC" },
  { value: "macd", label: "MACD" },
  { value: "bollinger", label: "Bollinger" },
  { value: "stochastic", label: "Stochastic" },
  { value: "highest_high", label: "Highest High" },
  { value: "lowest_low", label: "Lowest Low" },
];

const INDICATOR_SOURCE_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
  { value: "close", label: "Close" },
  { value: "volume", label: "Volume" },
];

const INDICATOR_FIELD_OPTIONS = {
  macd: [
    { value: "macd", label: "MACD" },
    { value: "signal", label: "Signal" },
    { value: "histogram", label: "Histogram" },
  ],
  bollinger: [
    { value: "upper", label: "Upper" },
    { value: "mid", label: "Mid" },
    { value: "lower", label: "Lower" },
  ],
  stochastic: [
    { value: "k", label: "K" },
    { value: "d", label: "D" },
  ],
};

const RISK_FIELDS = [
  { key: "rr_target", label: "RR target" },
  { key: "min_rr", label: "Min RR" },
  { key: "stop_lookback", label: "Stop lookback" },
  { key: "max_open_trades", label: "Max open trades" },
  { key: "fallback_stop_pct", label: "Fallback stop %" },
  { key: "fallback_tp_pct", label: "Fallback TP %" },
];

const STRATEGY_CONDITION_FIELDS = [
  {
    key: "skip_news",
    label: "Skip News",
    type: "select",
    options: [
      { value: "", label: "Null" },
      { value: "true", label: "True" },
      { value: "false", label: "False" },
    ],
  },
  { key: "news_window_minutes", label: "News Window Min", type: "number", placeholder: "120" },
  { key: "sessions", label: "Sessions", type: "csv", placeholder: "London,New York" },
  { key: "max_spread", label: "Max Spread", type: "number", placeholder: "null" },
  { key: "min_atr", label: "Min ATR", type: "number", placeholder: "null" },
  { key: "cooldown_bars", label: "Cooldown Bars", type: "number", placeholder: "null" },
  {
    key: "max_signals_per_session",
    label: "Max Signals / Session",
    type: "number",
    placeholder: "null",
  },
  {
    key: "regime_tags",
    label: "Regime Tags",
    type: "csv",
    placeholder: "trend,range,breakout",
  },
];

const PARAM_KEY_OPTIONS = [
  { value: "fast_period", label: "fast_period" },
  { value: "mid_period", label: "mid_period" },
  { value: "slow_period", label: "slow_period" },
  { value: "period", label: "period" },
  { value: "rsi_period", label: "rsi_period" },
  { value: "signal_period", label: "signal_period" },
  { value: "smooth_period", label: "smooth_period" },
  { value: "stddev", label: "stddev" },
  { value: "rr_target", label: "rr_target" },
  { value: "reward_rr", label: "reward_rr" },
  { value: "reward_rr_floor", label: "reward_rr_floor" },
  { value: "stop_lookback", label: "stop_lookback" },
  { value: "stop_buffer_pct", label: "stop_buffer_pct" },
  { value: "min_stop_pips", label: "min_stop_pips" },
  { value: "suggested_level_tfs", label: "suggested_level_tfs" },
  { value: "oversold", label: "oversold" },
  { value: "overbought", label: "overbought" },
];

const PRESET_META_FIELDS = [
  { key: "key", label: "Key" },
  { key: "kind", label: "Kind" },
];

const FUNCTION_META_BY_VALUE = new Map(
  PREDICATE_FUNCTION_OPTIONS.map((item) => [String(item?.value || ""), item]),
);

const WRAPPER_FUNCTION_MODES = new Set(["is_true", "get_artifacts", "draw"]);

function deepClone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function createNodeId(prefix = "node") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeStrategyId(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 64);
}

function prettyJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

function formatBacktestSummaryMoney(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${num >= 0 ? "+" : "-"}$${Math.abs(num).toFixed(digits)}`;
}

function formatBacktestSummaryNumber(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(digits);
}

function formatBacktestSummaryDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const currentYear = new Date().getFullYear();
  return year === currentYear ? `${day}.${month}` : `${day}.${month}.${year}`;
}

function formatBacktestSummaryRange(summary = null) {
  if (!summary) return "";
  const startLabel = formatBacktestSummaryDate(summary?.earliest_data_start_at);
  const endLabel = formatBacktestSummaryDate(summary?.latest_data_end_at);
  if (startLabel && endLabel) {
    return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
  }
  return startLabel || endLabel || "";
}

const COMPACT_DANGER_BUTTON_STYLE = {
  minWidth: 32,
  width: 32,
  height: 32,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const ACTION_ROW_CONTROL_STYLE = {
  minHeight: 36,
  height: 36,
};

const DEFAULT_BATCH_TIMEFRAMES = ["1440", "240", "15", "5"];

function formatBatchTimeframeLabel(tfRaw) {
  const tf = String(tfRaw || "").trim().toLowerCase();
  if (tf === "1") return "1m";
  if (tf === "5") return "5m";
  if (tf === "15") return "15m";
  if (tf === "60") return "1h";
  if (tf === "240") return "4h";
  if (tf === "1440") return "1d";
  return String(tfRaw || "-");
}

function formatBatchMetric(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(digits);
}

const ACTION_ROW_INPUT_STYLE = {
  width: "100%",
  minWidth: 0,
  height: 36,
};

function normalizeEditorStrategy(value) {
  const nextValue = deepClone(value) || {};
  if (nextValue && typeof nextValue === "object") {
    delete nextValue.backtest_summary;
    delete nextValue.min_bars;
    const nextParams =
      nextValue.params && typeof nextValue.params === "object" && !Array.isArray(nextValue.params)
        ? { ...nextValue.params }
        : {};
    const nextRisk =
      nextValue.risk && typeof nextValue.risk === "object" && !Array.isArray(nextValue.risk)
        ? { ...nextValue.risk }
        : {};
    const nextConditions =
      nextValue.conditions &&
      typeof nextValue.conditions === "object" &&
      !Array.isArray(nextValue.conditions)
        ? { ...nextValue.conditions }
        : {};

    ["rr_target", "stop_lookback"].forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(nextParams, key)) return;
      if (!Object.prototype.hasOwnProperty.call(nextRisk, key)) {
        nextRisk[key] = nextParams[key];
      }
      delete nextParams[key];
    });

    nextValue.params = nextParams;
    nextValue.risk = nextRisk;
    nextValue.conditions = nextConditions;
    nextValue.metadata =
      nextValue.metadata && typeof nextValue.metadata === "object" && !Array.isArray(nextValue.metadata)
        ? {
            strategy_type: "price_action",
            signal_source: "rules",
            ...nextValue.metadata,
          }
        : {
            strategy_type: "price_action",
            signal_source: "rules",
          };
  }
  return nextValue;
}

function hasDataValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function parseLiteralInput(rawValue = "") {
  const raw = String(rawValue ?? "").trim();
  if (!raw.length) return 0;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  const num = Number(raw);
  if (Number.isFinite(num) && raw !== "") return num;
  return rawValue;
}

function parseCommaSeparatedInput(rawValue = "") {
  return String(rawValue || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatCommaSeparatedInput(value) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function parseNullableNumberInput(rawValue = "") {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseNullableBooleanInput(rawValue = "") {
  const raw = String(rawValue ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

function conditionFieldValue(draft, key) {
  if (key === "news_window_minutes") {
    return (
      draft?.conditions?.news_window_minutes ??
      draft?.conditions?.news_before_minutes ??
      draft?.conditions?.news_after_minutes ??
      ""
    );
  }
  return draft?.conditions?.[key] ?? "";
}

function parsePlanFieldInput(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.fn === "string") {
      return formatPlanFunctionExpression(value);
    }
    if (
      Object.keys(value).length === 1 &&
      Object.prototype.hasOwnProperty.call(value, "var")
    ) {
      const variablePath = String(value.var || "").trim();
      return variablePath || null;
    }
  }
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw;
}

function formatPlanFieldInput(value) {
  if (value === undefined || value === null || value === "") return "";
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Object.prototype.hasOwnProperty.call(value, "var")
  ) {
    return String(value.var || "");
  }
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.fn === "string") {
    return formatPlanFunctionExpression(value);
  }
  return typeof value === "object" ? prettyJson(value) : String(value);
}

function formatPlanFunctionArgument(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.fn === "string") return formatPlanFunctionExpression(value);
    if (Object.prototype.hasOwnProperty.call(value, "var")) {
      return String(value.var || "").trim();
    }
  }
  if (typeof value === "string") {
    const raw = value.trim();
    return /^[a-zA-Z_][a-zA-Z0-9._-]*$/.test(raw) ? raw : JSON.stringify(raw);
  }
  if (value === null) return "null";
  if (value === undefined) return "";
  return String(value);
}

function formatPlanFunctionExpression(node = {}) {
  const fnName = String(node?.fn || "").trim();
  const args = Array.isArray(node?.args) ? node.args : [];
  return `${fnName}(${args.map((arg) => formatPlanFunctionArgument(arg)).join(", ")})`;
}

function isPlanFieldParamType(value) {
  const raw = formatPlanFieldInput(value).trim();
  if (!raw) return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return false;
  if (/^[a-zA-Z_][a-zA-Z0-9._-]*\s*\(/.test(raw)) return false;
  return true;
}

function formatLiteralInput(value) {
  if (value === null) return "null";
  if (value === undefined) return "";
  return String(value);
}

function parseIndicatorSettingInput(text = "", type = "value") {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  if (type === "param") return raw;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;
  return raw;
}

function getFunctionMeta(functionName = "") {
  return FUNCTION_META_BY_VALUE.get(String(functionName || "").trim()) || null;
}

function createDefaultFunctionArg(meta = null, index = 0) {
  const argKey = String(meta?.args?.[index]?.key || "").trim().toLowerCase();
  const argLabel = String(meta?.args?.[index]?.label || "").trim().toLowerCase();
  if (argKey === "level" || argLabel.includes("level")) {
    return { kind: "var", value: "levels.pd_mid" };
  }
  if (argKey === "bias" || argKey === "tf" || argKey === "phase") {
    return { kind: "literal", value: "" };
  }
  return { kind: "var", value: "" };
}

function createFunctionArgs(functionName = "") {
  const meta = getFunctionMeta(functionName);
  const args = Array.isArray(meta?.args) ? meta.args : [];
  if (!args.length) return [];
  return args.map((_, index) => createDefaultFunctionArg(meta, index));
}

function functionArgMeta(functionMeta = null, index = 0) {
  return functionMeta?.args?.[index] || null;
}

function functionArgKey(functionMeta = null, index = 0) {
  return String(functionArgMeta(functionMeta, index)?.key || "")
    .trim()
    .toLowerCase();
}

function functionArgLiteralValue(operand = null) {
  if (!operand || typeof operand !== "object") return "";
  return operand.kind === "literal" ? String(operand.value ?? "") : "";
}

function functionArgSelectOptions(functionMeta = null, index = 0) {
  const key = functionArgKey(functionMeta, index);
  if (key === "tf") return STRATEGY_FUNCTION_TF_OPTIONS;
  if (key === "bias") return STRATEGY_FUNCTION_BIAS_OPTIONS;
  if (key === "phase") return STRATEGY_FUNCTION_PHASE_OPTIONS;
  return [];
}

function functionArgHint(functionMeta = null, index = 0) {
  const key = functionArgKey(functionMeta, index);
  if (key === "tf") return "Leave empty to use the current strategy or chart timeframe.";
  if (key === "bias") return "Optional bullish or bearish direction filter.";
  if (key === "phase") return "Optional phase filter like pullback, impulse, or reversal.";
  if (key === "level") return "Use a level variable or fixed price.";
  return "";
}

function isWrapperFunctionMode(mode = "") {
  return WRAPPER_FUNCTION_MODES.has(String(mode || "").trim().toLowerCase());
}

function wrapperFunctionLabel(mode = "") {
  const normalized = String(mode || "").trim().toLowerCase();
  if (normalized === "is_true") return "Rule True";
  if (normalized === "get_artifacts") return "GET_ARTIFACTS";
  if (normalized === "draw") return "DRAW";
  return "Wrapper";
}

function buildOperandFromExpression(node) {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    if (typeof node.fn === "string") {
      return null;
    }
    const keys = Object.keys(node);
    if (keys.length === 1 && keys[0] === "var") {
      return {
        kind: "var",
        value: String(node.var || ""),
      };
    }
    return null;
  }
  if (
    typeof node === "number" ||
    typeof node === "string" ||
    typeof node === "boolean" ||
    node === null
  ) {
    return {
      kind: "literal",
      value: node,
    };
  }
  return null;
}

function buildVisualNodeFromExpression(expression) {
  if (!expression || typeof expression !== "object" || Array.isArray(expression)) {
    return null;
  }
  if (Object.keys(expression).length === 1 && Object.prototype.hasOwnProperty.call(expression, "not")) {
    const nested = buildVisualNodeFromExpression(expression.not);
    if (nested?.type === "condition" && String(nested?.mode || "") === "if_true") {
      return {
        ...nested,
        mode: "if_not",
      };
    }
    return null;
  }
  if (typeof expression.fn === "string") {
    const functionName = String(expression.fn || "").trim();
    if (isWrapperFunctionMode(functionName)) {
      const targetExpression = Array.isArray(expression.args) ? expression.args[0] : null;
      const target = buildVisualNodeFromExpression(targetExpression);
      if (!target) return null;
      return {
        id: createNodeId("condition"),
        type: "condition",
        mode: functionName,
        functionName: "retest",
        args: createFunctionArgs("retest"),
        comparator: COMPARATOR_OPTIONS[0]?.value || ">",
        left: { kind: "var", value: "bar.close" },
        right: { kind: "literal", value: 0 },
        target: ensureGroupRootDraft(target),
      };
    }
    const meta = getFunctionMeta(functionName);
    if (!meta) return null;
    const rawArgs = Array.isArray(expression.args) ? expression.args : [];
    const args = rawArgs.map((item) => buildOperandFromExpression(item));
    if (args.some((item) => !item)) return null;
    return {
      id: createNodeId("condition"),
      type: "condition",
      mode: "if_true",
      functionName,
      args,
      comparator: COMPARATOR_OPTIONS[0]?.value || ">",
      left: { kind: "var", value: "bar.close" },
      right: { kind: "literal", value: 0 },
      target: null,
    };
  }
  const keys = Object.keys(expression);
  if (keys.length !== 1) return null;
  const operator = keys[0];
  const rawValue = expression[operator];
  if (operator === "and" || operator === "or" || operator === "then") {
    if (!Array.isArray(rawValue)) return null;
    const children = rawValue
      .map((child) => buildVisualNodeFromExpression(child))
      .filter(Boolean);
    return {
      id: createNodeId("group"),
      type: "group",
      operator,
      children,
    };
  }
  if (PREDICATE_FUNCTION_VALUES.has(operator)) {
    if (!Array.isArray(rawValue)) return null;
    const args = rawValue.map((item) => buildOperandFromExpression(item));
    if (args.some((item) => !item)) return null;
    return {
      id: createNodeId("condition"),
      type: "condition",
      mode: "if_true",
      functionName: operator,
      args,
      comparator: COMPARATOR_OPTIONS[0]?.value || ">",
      left: { kind: "var", value: "bar.close" },
      right: { kind: "literal", value: 0 },
      target: null,
    };
  }
  if (!COMPARATOR_OPTIONS.some((item) => item.value === operator)) return null;
  if (!Array.isArray(rawValue) || rawValue.length !== 2) return null;
  const left = buildOperandFromExpression(rawValue[0]);
  const right = buildOperandFromExpression(rawValue[1]);
  if (!left || !right) return null;
  return {
    id: createNodeId("condition"),
    type: "condition",
    mode: "compare",
    comparator: operator,
    left,
    right,
    functionName: PREDICATE_FUNCTION_OPTIONS[0]?.value || "retest",
    args: createFunctionArgs(PREDICATE_FUNCTION_OPTIONS[0]?.value || "retest"),
    target: null,
  };
}

function buildExpressionFromOperand(operand) {
  if (operand?.kind === "var") {
    const nextValue = String(operand?.value || "").trim();
    return nextValue ? { var: nextValue } : null;
  }
  if (operand?.kind !== "literal") {
    return null;
  }
  return parseLiteralInput(operand?.value);
}

function buildExpressionFromVisualNode(node) {
  if (!node) return null;
  if (node.type === "group") {
    const operator = String(node?.operator || "").trim().toLowerCase();
    if (operator !== "and" && operator !== "or" && operator !== "then") return null;
    return {
      [operator]: Array.isArray(node.children)
        ? node.children.map((child) => buildExpressionFromVisualNode(child)).filter(Boolean)
        : [],
    };
  }
  if (node.type === "condition") {
    const mode = String(node?.mode || "compare");
    if (mode === "if_true" || mode === "if_not") {
      const functionName = String(node?.functionName || "").trim();
      if (!functionName) return null;
      const args = Array.isArray(node?.args)
        ? node.args.map((item) => buildExpressionFromOperand(item))
        : [];
      if (args.some((item) => item === null)) return null;
      const fnNode = {
        fn: functionName,
        args,
      };
      return String(node?.mode || "compare") === "if_not"
        ? { not: fnNode }
        : fnNode;
    }
    if (isWrapperFunctionMode(mode)) {
      const targetExpression = buildExpressionFromVisualNode(node?.target);
      if (!targetExpression) return null;
      return {
        fn: mode,
        args: [targetExpression],
      };
    }
    const comparator = String(node?.comparator || "").trim();
    if (!comparator) return null;
    const left = buildExpressionFromOperand(node.left);
    const right = buildExpressionFromOperand(node.right);
    if (left === null || right === null) return null;
    return {
      [comparator]: [left, right],
    };
  }
  return null;
}

function makeEmptyCondition() {
  return makeEmptyConditionDraft();
}

function makeEmptyGroup(operator = "and") {
  return makeEmptyGroupDraft(operator);
}

function ensureConditionDraft(node) {
  const base =
    node && typeof node === "object" && !Array.isArray(node)
      ? node
      : makeEmptyCondition();
  const rawMode = String(base?.mode || "compare");
  const mode =
    rawMode === "if_true" ||
    rawMode === "if_not" ||
    isWrapperFunctionMode(rawMode)
      ? rawMode
      : rawMode === "function"
        ? "if_true"
        : "compare";
  const fallbackFunction = PREDICATE_FUNCTION_OPTIONS[0]?.value || "retest";
  const functionName =
    mode !== "compare" && getFunctionMeta(base?.functionName)
      ? String(base.functionName)
      : fallbackFunction;
  const meta = getFunctionMeta(functionName);
  const expectedArgs = Array.isArray(meta?.args) ? meta.args : [];
  const nextArgs = expectedArgs.map((_, index) => {
    const currentArg = Array.isArray(base?.args) ? base.args[index] : null;
    return currentArg && typeof currentArg === "object"
      ? currentArg
      : createDefaultFunctionArg(meta, index);
  });
  return {
    ...makeEmptyCondition(),
    ...base,
    mode,
    comparator: String(base?.comparator || ">") || ">",
    left: base?.left || { kind: "var", value: "indicators.ema_fast" },
    right: base?.right || { kind: "var", value: "indicators.ema_slow" },
    functionName,
    args: nextArgs,
    target:
      base?.target && typeof base.target === "object"
        ? ensureGroupRootDraft(base.target)
        : isWrapperFunctionMode(mode)
          ? ensureGroupRootDraft(makeEmptyCondition())
          : null,
  };
}

function actionTypeToLegacyRuleKey(actionType = "") {
  const type = String(actionType || "").trim();
  switch (type) {
    case "trade.buy":
      return "bullish";
    case "trade.sell":
      return "bearish";
    default:
      return "";
  }
}

function resolveActionKind(action = {}) {
  const raw = String(action?.action || action?.type || "").trim();
  if (raw === "trade.open.long") return "trade";
  if (raw === "trade.open.short") return "trade";
  return raw;
}

function normalizeTradeDirection(value = "", fallback = "buy") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["buy", "bull", "long"].includes(normalized)) return "buy";
  if (["sell", "bear", "short"].includes(normalized)) return "sell";
  return fallback === "sell" ? "sell" : "buy";
}

function createDefaultTradePlan(direction = "buy") {
  return {
    direction: normalizeTradeDirection(direction),
    type: "market",
    entry: null,
    sl: null,
    tp: null,
  };
}

function normalizeTradePlanDraft(plan = {}, fallbackDirection = "buy") {
  const base =
    plan && typeof plan === "object" && !Array.isArray(plan)
      ? plan
      : {};
  const direction = normalizeTradeDirection(
    base?.direction || base?.dir,
    fallbackDirection,
  );
  return {
    direction,
    type: String(base?.type || base?.order_type || "market").trim().toLowerCase() || "market",
    entry: parsePlanFieldInput(base?.entry ?? base?.entry_price),
    sl: parsePlanFieldInput(base?.sl ?? base?.stop_loss),
    tp: parsePlanFieldInput(base?.tp ?? base?.tp1 ?? base?.tp2 ?? base?.tp3),
  };
}

function inferRuleBiasFromAction(action = {}, fallback = "neutral") {
  const actionKind = resolveActionKind(action);
  if (actionKind === "trade") {
    const direction = normalizeTradeDirection(
      action?.trade_plan?.direction ||
        (String(action?.type || "").trim() === "trade.open.short" ? "sell" : "buy"),
      "buy",
    );
    return direction === "sell" ? "bearish" : "bullish";
  }
  return fallback;
}

function humanizeRuleKey(key = "") {
  const normalized = String(key || "").trim();
  if (!normalized) return "Rule";
  if (["entry_long", "bullish"].includes(normalized.toLowerCase())) return "Buy";
  if (["entry_short", "bearish"].includes(normalized.toLowerCase())) return "Sell";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function createLegacyRuleDraft(key = "", when = null) {
  const normalizedKey = String(key || "").trim().toLowerCase();
  const bullish = ["bullish", "entry_long"].includes(normalizedKey);
  const bearish = ["bearish", "entry_short"].includes(normalizedKey);
  const markerLike = ["bos", "choch", "rejection", "rejected", "sweep"].includes(normalizedKey);
  return normalizeRuleDraft({
    id: String(key || createNodeId("rule")).trim() || createNodeId("rule"),
    name: humanizeRuleKey(key),
    bias: bullish ? "bullish" : bearish ? "bearish" : "neutral",
    priority: "medium",
    when: when && typeof when === "object" && !Array.isArray(when) ? when : { and: [] },
    actions: [
      bullish || bearish
        ? {
            action: "trade",
            trade_plan: {
              direction: bullish ? "buy" : "sell",
              type: "market",
              entry: null,
              tp: null,
              sl: null,
            },
          }
        : {
            action: "draw",
            label: humanizeRuleKey(key),
          },
    ],
  });
}

function normalizeStrategyRulesList(strategy = {}) {
  const rawRules = Array.isArray(strategy?.rules) ? strategy.rules : null;
  if (rawRules && rawRules.length) {
    return rawRules.map((rule) => normalizeRuleDraft(rule));
  }
  const rawEvents = Array.isArray(strategy?.events) ? strategy.events : null;
  if (rawEvents && rawEvents.length) {
    return rawEvents.map((event, index) => {
      const actions = (Array.isArray(event?.actions) ? event.actions : []).map((action) =>
        normalizeRuleAction(
          {
            ...action,
            action:
              String(action?.action || action?.type || "").trim() === "chart.note"
                ? "draw"
                : action?.action || action?.type,
            label: action?.label || action?.message || event?.name || `Rule ${index + 1}`,
          },
          event?.name || `Rule ${index + 1}`,
        ),
      );
      const inferredBias =
        actions.map((action) => inferRuleBiasFromAction(action, "")).find(Boolean) || "neutral";
      return normalizeRuleDraft({
        id: String(event?.id || createNodeId("rule")).trim() || createNodeId("rule"),
        name: String(event?.name || event?.label || `Rule ${index + 1}`).trim() || `Rule ${index + 1}`,
        bias: event?.bias || inferredBias,
        priority: event?.priority || "medium",
        when: event?.when && typeof event.when === "object" && !Array.isArray(event.when)
          ? event.when
          : { and: [] },
        actions,
      });
    });
  }
  const legacyRules =
    strategy?.rules && typeof strategy.rules === "object" && !Array.isArray(strategy.rules)
      ? strategy.rules
      : {};
  return Object.entries(legacyRules)
    .filter(([, when]) => when && typeof when === "object" && !Array.isArray(when))
    .map(([key, when]) => createLegacyRuleDraft(key, when));
}

function buildPersistedStrategy(draft = {}) {
  const normalizedDraft = normalizeEditorStrategy(draft);
  const nextRules = normalizeStrategyRulesList(normalizedDraft);
  const { events: _legacyEvents, ...rest } = normalizedDraft;
  return {
    ...rest,
    rules: nextRules,
  };
}

function toFlatOptions(items = []) {
  return items.map((item) => (
    <option key={item.value} value={item.value}>
      {item.label}
    </option>
  ));
}

function withNullOption(items = []) {
  return Array.isArray(items) ? items : [];
}

function resolveSelectValue(value, options = []) {
  const normalized = String(value ?? "").trim();
  return normalized;
}

function buildDefaultDraft(exampleStrategy, defaults = {}) {
  const base = normalizeEditorStrategy(exampleStrategy);
  const timestamp = Date.now();
  const baseId = sanitizeStrategyId(base.id || base.key || "");
  const editableId =
    base.kind && base.kind !== "custom"
      ? sanitizeStrategyId(`${baseId || "custom_strategy"}_custom`)
      : baseId;
  const baseConditions =
    base.conditions && typeof base.conditions === "object" && !Array.isArray(base.conditions)
      ? base.conditions
      : {};
  return {
    id: editableId || `custom_strategy_${timestamp}`,
    name: base.name || "New Custom Strategy",
    description: base.description || "",
    engine_version: "42trade.strategy.v2",
    kind: "custom",
    status: "draft",
    market: {
      symbol: String(base.market?.symbol ?? "").trim(),
      tf: String(base.market?.tf ?? "").trim(),
    },
    params:
      base.params && typeof base.params === "object" && !Array.isArray(base.params)
        ? base.params
        : {},
    indicators: Array.isArray(base.indicators) ? base.indicators : [],
    rules: normalizeStrategyRulesList(base),
    risk:
      base.risk && typeof base.risk === "object" && !Array.isArray(base.risk)
        ? base.risk
        : {},
    conditions: {
      skip_news:
        typeof baseConditions.skip_news === "boolean" ? baseConditions.skip_news : true,
      news_window_minutes:
        Number.isFinite(
          Number(
            baseConditions.news_window_minutes ??
              baseConditions.news_before_minutes ??
              baseConditions.news_after_minutes,
          ),
        )
          ? Number(
              baseConditions.news_window_minutes ??
                baseConditions.news_before_minutes ??
                baseConditions.news_after_minutes,
            )
          : 120,
      ...baseConditions,
    },
    metadata:
      base.metadata && typeof base.metadata === "object" && !Array.isArray(base.metadata)
        ? base.metadata
        : {},
  };
}

function variableSuggestionsForDraft(draft) {
  return buildRuleVariableValues({
    indicators: Array.isArray(draft?.indicators) ? draft.indicators : [],
    params:
      draft?.params && typeof draft.params === "object" && !Array.isArray(draft.params)
        ? draft.params
        : {},
    risk:
      draft?.risk && typeof draft.risk === "object" && !Array.isArray(draft.risk)
        ? draft.risk
        : {},
  });
}

function buildEventEditorState(draft) {
  const events = normalizeStrategyEvents(draft);
  const nextVisualEvents = {};
  const nextUnsupportedEvents = {};
  for (const event of events) {
    const visual = buildVisualNodeFromExpression(event.when);
    if (visual) {
      nextVisualEvents[event.id] = ensureGroupRootDraft(visual);
    } else {
      nextVisualEvents[event.id] = null;
      nextUnsupportedEvents[event.id] = true;
    }
  }
  return {
    nextEvents: events,
    nextVisualEvents,
    nextUnsupportedEvents,
  };
}

function updateTreeNode(node, targetId, updater) {
  if (!node) return node;
  if (node.id === targetId) return updater(node);
  if (node.type !== "group" || !Array.isArray(node.children)) return node;
  return {
    ...node,
    children: node.children.map((child) => updateTreeNode(child, targetId, updater)),
  };
}

function SimpleFieldGrid({ items = [] }) {
  const visibleItems = items.filter((item) => item && item.value !== undefined && item.value !== null && item.value !== "");
  if (!visibleItems.length) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 10,
      }}
    >
      {visibleItems.map((item) => (
        <div key={item.key} className="stack-layout" style={{ gap: 6 }}>
          <span className="minor-text" style={{ fontSize: 11 }}>
            {item.label}
          </span>
          <div
            style={{
              minHeight: 36,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.03)",
              color: "var(--text)",
              padding: "8px 10px",
              display: "flex",
              alignItems: "center",
            }}
          >
            {String(item.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

function removeTreeNode(node, targetId) {
  if (!node || node.id === targetId) return null;
  if (node.type !== "group" || !Array.isArray(node.children)) return node;
  return {
    ...node,
    children: node.children
      .map((child) => removeTreeNode(child, targetId))
      .filter(Boolean),
  };
}

function EmptySectionButton({ label, onClick }) {
  return (
    <button type="button" className="secondary-button" onClick={onClick}>
      Add {label}
    </button>
  );
}

function EmptySectionPlaceholder({ title, actionLabel, onClick }) {
  return (
    <div
      style={{
        borderRadius: 10,
        padding: "24px 16px",
        border: "1px solid rgba(148, 163, 184, 0.18)",
        background: "rgba(255,255,255,0.015)",
        textAlign: "center",
      }}
    >
      <div className="minor-text" style={{ fontSize: 11, marginBottom: 10 }}>
        {title}
      </div>
      <button type="button" className="secondary-button" onClick={onClick}>
        {actionLabel}
      </button>
    </div>
  );
}

function getEditorTabFromHash(defaultTab = "json") {
  if (typeof window === "undefined") return defaultTab;
  return EDITOR_HASH_TO_TAB[window.location.hash] || defaultTab;
}

function writeEditorHash(tab) {
  if (typeof window === "undefined") return;
  const hash = tab === "edit" ? "#edit" : "#json";
  if (window.location.hash === hash) return;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${hash}`,
  );
}

function StrategyOperandEditor({
  operand,
  onChange,
  variableOptions,
  placeholder = "Value or variable",
  title = "Type a fixed value or pick a variable path.",
}) {
  const operandKind =
    operand?.kind === "literal" || operand?.kind === "var" ? operand.kind : "literal";
  const operandText =
    operandKind === "literal"
      ? formatLiteralInput(operand?.value)
      : String(operand?.value || "");
  return (
    <div
      style={{
        minWidth: 0,
        width: "100%",
      }}
    >
      <InputComboSelect
        text={operandText}
        items={variableOptions}
        type={operandKind === "var" ? "param" : "value"}
        onChange={({ text, type }) =>
          onChange({
            kind: type === "param" ? "var" : "literal",
            value: text,
          })
        }
        aria-label="Condition operand"
        title={title}
        inputTitle="Type a fixed value or a variable path like indicators.ema_fast."
        menuTitle="Show variable suggestions"
        placeholder={placeholder}
        showType={false}
        matchTriggerWidth
        searchable
        searchPlaceholder="Filter variables..."
        style={{
          width: "100%",
          minWidth: 0,
        }}
      />
    </div>
  );
}

function buildSectionSubtitle(hasData, emptyMessage, hint) {
  return hasData ? hint : `${emptyMessage} ${hint}`;
}

function HintText({ children, title }) {
  return (
    <div className="minor-text" title={title} style={{ fontSize: 11 }}>
      {children}
    </div>
  );
}

function StrategyHintBadge({ children, title }) {
  return (
    <span
      className="minor-text"
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 8px",
        borderRadius: 999,
        border: "1px solid rgba(148, 163, 184, 0.2)",
        fontSize: 10,
      }}
    >
      {children}
    </span>
  );
}

function RuleComparatorEditor({ node, onChange }) {
  const options = withNullOption(COMPARATOR_OPTIONS);
  return (
    <InputComboSelect
      value={resolveSelectValue(node?.comparator, options)}
      searchable
      onChange={(event) =>
        onChange({
          ...node,
          comparator: event.target.value,
        })
      }
      aria-label="Condition comparator"
      title="Pick how the left side should compare with the right side."
      style={{ width: "100%" }}
    >
      {toFlatOptions(options)}
    </InputComboSelect>
  );
}

function RuleModeToggle({ mode = "compare", onChange }) {
  const options = CONDITION_MODE_OPTIONS;
  return (
    <InputComboSelect
      value={resolveSelectValue(mode, options)}
      searchable={false}
      onChange={(event) => onChange(event.target.value)}
      title="Choose whether this row compares two values, requires a function to be true, or requires it to be false."
      style={{
        width: "100%",
        minWidth: 0,
      }}
    >
      {toFlatOptions(options)}
    </InputComboSelect>
  );
}

function RuleFunctionEditor({ node, onChange }) {
  const options = withNullOption(PREDICATE_FUNCTION_OPTIONS);
  return (
    <InputComboSelect
      value={resolveSelectValue(node?.functionName, options)}
      searchable
      onChange={(event) => {
        const functionName = event.target.value;
        const meta = getFunctionMeta(functionName);
        const nextArgs = Array.isArray(meta?.args)
          ? meta.args.map((_, index) => createDefaultFunctionArg(meta, index))
          : [];
        onChange({
          ...node,
          functionName,
          args: nextArgs,
        });
      }}
      aria-label="Condition function"
      title="Pick a ready-made event function like BOS, sweep, breakout, reversal, trend, or bias."
      style={{ width: "100%" }}
    >
      {toFlatOptions(options)}
    </InputComboSelect>
  );
}

function StrategyConditionEditor({
  node,
  onChange,
  onRemove,
  variableOptions,
  compact = false,
}) {
  const draft = ensureConditionDraft(node);
  const isWrapperMode = isWrapperFunctionMode(draft.mode);
  const isFunctionMode = draft.mode !== "compare";
  const functionMeta = getFunctionMeta(draft.functionName);
  const functionArgs = Array.isArray(draft.args) ? draft.args : [];
  return (
    <div
      style={{
        border: compact ? "none" : "1px solid var(--border)",
        borderRadius: compact ? 0 : 10,
        padding: compact ? 0 : 10,
        background: compact ? "transparent" : "rgba(255,255,255,0.02)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isFunctionMode
            ? `112px minmax(170px, 0.9fr) ${functionArgs
                .map(() => "minmax(0, 1fr)")
                .join(" ")} auto`
            : "112px minmax(0, 1.15fr) 132px minmax(0, 1.15fr) auto",
          gap: 8,
          alignItems: "center",
        }}
      >
        <RuleModeToggle
          mode={draft.mode}
          onChange={(mode) =>
            onChange(
              ensureConditionDraft({
                ...draft,
                mode,
                target:
                  isWrapperFunctionMode(mode)
                    ? ensureGroupRootDraft(draft.target || makeEmptyCondition())
                    : draft.target,
              }),
            )
          }
        />
        {isFunctionMode ? (
          <>
            {isWrapperMode ? (
              <div
                className="minor-text"
                title="Wrapper functions evaluate a nested rule tree and return either truthiness or artifact matches."
                style={{
                  minHeight: 32,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.03)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {wrapperFunctionLabel(draft.mode)}
              </div>
            ) : (
              <RuleFunctionEditor
                node={draft}
                onChange={(nextNode) => onChange(ensureConditionDraft(nextNode))}
              />
            )}
            {isWrapperMode ? (
              <div className="minor-text" style={{ fontSize: 11 }}>
                Nested rule
              </div>
            ) : functionArgs.map((arg, index) => {
              const argMeta = functionArgMeta(functionMeta, index);
              const argOptions = functionArgSelectOptions(functionMeta, index);
              if (argOptions.length) {
                return (
                  <InputComboSelect
                    key={`${draft.id || "condition"}_arg_${index}`}
                    value={resolveSelectValue(functionArgLiteralValue(arg), argOptions)}
                    searchable={false}
                    aria-label={argMeta?.label || `Function argument ${index + 1}`}
                    title={
                      functionArgHint(functionMeta, index) ||
                      `Choose ${String(argMeta?.label || `argument ${index + 1}`).toLowerCase()}.`
                    }
                    style={{ width: "100%", minWidth: 0 }}
                    onChange={(event) =>
                      onChange(
                        ensureConditionDraft({
                          ...draft,
                          args: functionArgs.map((item, itemIndex) =>
                            itemIndex === index
                              ? { kind: "literal", value: String(event.target.value || "") }
                              : item,
                          ),
                        }),
                      )
                    }
                  >
                    {toFlatOptions(argOptions)}
                  </InputComboSelect>
                );
              }
              return (
                <StrategyOperandEditor
                  key={`${draft.id || "condition"}_arg_${index}`}
                  operand={arg}
                  variableOptions={variableOptions}
                  placeholder={argMeta?.label || `Arg ${index + 1}`}
                  title={
                    functionArgHint(functionMeta, index) ||
                    `Pick or type ${String(
                      argMeta?.label || `argument ${index + 1}`,
                    ).toLowerCase()}.`
                  }
                  onChange={(nextArg) =>
                    onChange(
                      ensureConditionDraft({
                        ...draft,
                        args: functionArgs.map((item, itemIndex) =>
                          itemIndex === index ? nextArg : item,
                        ),
                      }),
                    )
                  }
                />
              );
            })}
            {!isWrapperMode && !functionArgs.length ? (
              <div className="minor-text" style={{ fontSize: 11 }}>
                {functionMeta?.label || "Function"} has no arguments.
              </div>
            ) : null}
          </>
        ) : (
          <>
            <StrategyOperandEditor
              operand={draft.left}
              variableOptions={variableOptions}
              onChange={(left) => onChange({ ...draft, left })}
            />
            <RuleComparatorEditor node={draft} onChange={onChange} />
            <StrategyOperandEditor
              operand={draft.right}
              variableOptions={variableOptions}
              onChange={(right) => onChange({ ...draft, right })}
            />
          </>
        )}
        <button
          type="button"
          className="danger-button"
          onClick={onRemove}
          aria-label="Remove condition"
          title="Remove this condition"
        >
          X
        </button>
      </div>
      {isWrapperMode ? (
        <div style={{ marginTop: 10 }}>
          <RuleTreeEditor
            node={draft.target}
            variableOptions={variableOptions}
            compact={false}
            depth={0}
            onChange={(nextTarget) =>
              onChange(
                ensureConditionDraft({
                  ...draft,
                  target: ensureGroupRootDraft(nextTarget),
                }),
              )
            }
            onRemove={null}
          />
        </div>
      ) : null}
      {isFunctionMode && functionMeta ? (
        <div className="minor-text" style={{ fontSize: 11, marginTop: 8 }}>
          Empty `TF` means current timeframe. Event functions search closed-bar history and can carry artifact matches into strategy results.
        </div>
      ) : null}
      {isWrapperMode ? (
        <div className="minor-text" style={{ fontSize: 11, marginTop: 8 }}>
          Wrap a nested rule group with `Rule True`, `GET_ARTIFACTS`, or `DRAW`. This keeps the strategy editable without dropping to raw JSON.
        </div>
      ) : null}
    </div>
  );
}

function StrategyIndicatorRow({
  indicator,
  index,
  updateDraft,
  indicatorParamOptions,
}) {
  const indicatorType = String(indicator?.type || "").trim();
  const indicatorFieldOptions = INDICATOR_FIELD_OPTIONS[indicatorType] || null;
  const indicatorTypeOptions = withNullOption(INDICATOR_TYPE_OPTIONS);
  const indicatorSourceOptions = withNullOption(INDICATOR_SOURCE_OPTIONS);
  const indicatorFieldSelectOptions = indicatorFieldOptions
    ? withNullOption(indicatorFieldOptions)
    : null;
  return (
    <div className="stack-layout" style={{ gap: 8 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(160px, 1.35fr) minmax(120px, 0.95fr) minmax(96px, 0.7fr) minmax(180px, 1.4fr) minmax(96px, 0.7fr) auto",
          gap: 10,
          alignItems: "center",
        }}
      >
        <input
          className="input"
          value={indicator?.id || ""}
          onChange={(event) =>
            updateDraft((base) => {
              const nextIndicators = [...(base.indicators || [])];
              nextIndicators[index] = {
                ...nextIndicators[index],
                id: sanitizeStrategyId(event.target.value),
              };
              return {
                ...base,
                indicators: nextIndicators,
              };
            })
          }
          title="This id is how rules reference the indicator, for example indicators.ema_1."
          style={{
            minWidth: 0,
          }}
        />
        <InputComboSelect
          value={resolveSelectValue(indicatorType, indicatorTypeOptions)}
          searchable
          onChange={(event) =>
            updateDraft((base) => {
              const nextIndicators = [...(base.indicators || [])];
              nextIndicators[index] = {
                ...nextIndicators[index],
                type: event.target.value,
              };
              return {
                ...base,
                indicators: nextIndicators,
              };
            })
          }
          title="Choose the indicator type."
        >
          {toFlatOptions(indicatorTypeOptions)}
        </InputComboSelect>
        <InputComboSelect
          value={resolveSelectValue(indicator?.source, indicatorSourceOptions)}
          searchable
          onChange={(event) =>
            updateDraft((base) => {
              const nextIndicators = [...(base.indicators || [])];
              nextIndicators[index] = {
                ...nextIndicators[index],
                source: event.target.value,
              };
              return {
                ...base,
                indicators: nextIndicators,
              };
            })
          }
          title="Choose which candle field feeds the indicator."
        >
          {toFlatOptions(indicatorSourceOptions)}
        </InputComboSelect>
        <InputComboSelect
          text={formatLiteralInput(indicator?.length)}
          items={indicatorParamOptions}
          type={
            typeof indicator?.length === "string" &&
            String(indicator.length).trim().startsWith("params.")
              ? "param"
              : "value"
          }
          onChange={({ text, type }) =>
            updateDraft((base) => {
              const nextIndicators = [...(base.indicators || [])];
              nextIndicators[index] = {
                ...nextIndicators[index],
                length: parseIndicatorSettingInput(text, type),
              };
              return {
                ...base,
                indicators: nextIndicators,
              };
            })
          }
          title="Number of bars used by the indicator."
          inputTitle="Type a numeric length or pick a params.* reference."
          menuTitle="Show parameter suggestions"
          placeholder="Length"
          showType={false}
          searchable
          searchPlaceholder="Filter params..."
          style={{
            width: "100%",
            minWidth: 0,
          }}
        />
        {indicatorFieldOptions ? (
          <InputComboSelect
            value={resolveSelectValue(indicator?.field, indicatorFieldSelectOptions)}
            searchable
            onChange={(event) =>
              updateDraft((base) => {
                const nextIndicators = [...(base.indicators || [])];
                nextIndicators[index] = {
                  ...nextIndicators[index],
                  field: event.target.value,
                };
                return {
                  ...base,
                  indicators: nextIndicators,
                };
              })
            }
            title="Pick the output field that rules should reference."
        >
          {toFlatOptions(indicatorFieldSelectOptions)}
        </InputComboSelect>
      ) : (
        <div />
      )}
        <button
          type="button"
          className="danger-button"
          onClick={() =>
            updateDraft((base) => ({
              ...base,
              indicators: (base.indicators || []).filter((_, itemIndex) => itemIndex !== index),
            }))
          }
          aria-label="Remove indicator"
          title="Remove this indicator"
        >
          X
        </button>
      </div>
      {indicatorType === "macd" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(120px, 1fr))",
            gap: 10,
            alignItems: "center",
          }}
        >
          <InputComboSelect
            text={formatLiteralInput(indicator?.fast_length)}
            items={indicatorParamOptions}
            type={
              typeof indicator?.fast_length === "string" &&
              String(indicator.fast_length).trim().startsWith("params.")
                ? "param"
                : "value"
            }
            onChange={({ text, type }) =>
              updateDraft((base) => {
                const nextIndicators = [...(base.indicators || [])];
                nextIndicators[index] = {
                  ...nextIndicators[index],
                  fast_length: parseIndicatorSettingInput(text, type),
                };
                return {
                  ...base,
                  indicators: nextIndicators,
                };
              })
            }
            placeholder="Fast"
            title="Fast MACD length."
            inputTitle="Type a numeric fast length or pick a params.* reference."
            menuTitle="Show parameter suggestions"
            showType={false}
            searchable
            searchPlaceholder="Filter params..."
          />
          <InputComboSelect
            text={formatLiteralInput(indicator?.slow_length)}
            items={indicatorParamOptions}
            type={
              typeof indicator?.slow_length === "string" &&
              String(indicator.slow_length).trim().startsWith("params.")
                ? "param"
                : "value"
            }
            onChange={({ text, type }) =>
              updateDraft((base) => {
                const nextIndicators = [...(base.indicators || [])];
                nextIndicators[index] = {
                  ...nextIndicators[index],
                  slow_length: parseIndicatorSettingInput(text, type),
                };
                return {
                  ...base,
                  indicators: nextIndicators,
                };
              })
            }
            placeholder="Slow"
            title="Slow MACD length."
            inputTitle="Type a numeric slow length or pick a params.* reference."
            menuTitle="Show parameter suggestions"
            showType={false}
            searchable
            searchPlaceholder="Filter params..."
          />
          <InputComboSelect
            text={formatLiteralInput(indicator?.signal_length)}
            items={indicatorParamOptions}
            type={
              typeof indicator?.signal_length === "string" &&
              String(indicator.signal_length).trim().startsWith("params.")
                ? "param"
                : "value"
            }
            onChange={({ text, type }) =>
              updateDraft((base) => {
                const nextIndicators = [...(base.indicators || [])];
                nextIndicators[index] = {
                  ...nextIndicators[index],
                  signal_length: parseIndicatorSettingInput(text, type),
                };
                return {
                  ...base,
                  indicators: nextIndicators,
                };
              })
            }
            placeholder="Signal"
            title="MACD signal length."
            inputTitle="Type a numeric signal length or pick a params.* reference."
            menuTitle="Show parameter suggestions"
            showType={false}
            searchable
            searchPlaceholder="Filter params..."
          />
        </div>
      ) : null}
      {indicatorType === "bollinger" ? (
        <InputComboSelect
          text={formatLiteralInput(indicator?.stddev)}
          items={indicatorParamOptions}
          type={
            typeof indicator?.stddev === "string" &&
            String(indicator.stddev).trim().startsWith("params.")
              ? "param"
              : "value"
          }
          onChange={({ text, type }) =>
            updateDraft((base) => {
              const nextIndicators = [...(base.indicators || [])];
              nextIndicators[index] = {
                ...nextIndicators[index],
                stddev: parseIndicatorSettingInput(text, type),
              };
              return {
                ...base,
                indicators: nextIndicators,
              };
            })
          }
          placeholder="Std dev"
          title="Bollinger standard deviation multiplier."
          inputTitle="Type a numeric standard deviation or pick a params.* reference."
          menuTitle="Show parameter suggestions"
          showType={false}
          searchable
          searchPlaceholder="Filter params..."
          style={{
            width: "100%",
            maxWidth: 160,
          }}
        />
      ) : null}
      {indicatorType === "stochastic" ? (
        <InputComboSelect
          text={formatLiteralInput(indicator?.smooth_period)}
          items={indicatorParamOptions}
          type={
            typeof indicator?.smooth_period === "string" &&
            String(indicator.smooth_period).trim().startsWith("params.")
              ? "param"
              : "value"
          }
          onChange={({ text, type }) =>
            updateDraft((base) => {
              const nextIndicators = [...(base.indicators || [])];
              nextIndicators[index] = {
                ...nextIndicators[index],
                smooth_period: parseIndicatorSettingInput(text, type),
              };
              return {
                ...base,
                indicators: nextIndicators,
              };
            })
          }
          placeholder="Smooth"
          title="Stochastic smoothing period."
          inputTitle="Type a numeric smoothing period or pick a params.* reference."
          menuTitle="Show parameter suggestions"
          showType={false}
          searchable
          searchPlaceholder="Filter params..."
          style={{
            width: "100%",
            maxWidth: 160,
          }}
        />
      ) : null}
    </div>
  );
}

function StrategyEventActionRow({
  action,
  onChange,
  onRemove,
  variableOptions = [],
}) {
  const actionType = resolveActionKind(action);
  const actionTypeOptions = withNullOption(EVENT_ACTION_TYPE_OPTIONS);
  const webhookMethodOptions = withNullOption(WEBHOOK_METHOD_OPTIONS);
  const tradeDirectionOptions = withNullOption(TRADE_DIRECTION_OPTIONS);
  const tradeOrderTypeOptions = withNullOption(TRADE_ORDER_TYPE_OPTIONS);
  const isTradeAction = actionType === "trade";
  const isMessageAction =
    actionType === "notify.toast" ||
    actionType === "notify.notification" ||
    actionType === "chart.note";
  const isWebhookAction = actionType === "webhook.post";
  return (
    <div
      style={{
        display: "grid",
        width: "100%",
        gridTemplateColumns: isWebhookAction
          ? "minmax(180px, 220px) 96px minmax(0, 1fr) auto"
          : isTradeAction
            ? "minmax(0, 1fr)"
          : isMessageAction
            ? "minmax(180px, 220px) minmax(0, 1fr) auto"
            : "minmax(180px, 220px) auto",
        gap: 8,
        alignItems: isTradeAction ? "start" : "center",
      }}
    >
      {!isTradeAction ? (
        <InputComboSelect
          value={resolveSelectValue(actionType, actionTypeOptions)}
          searchable
          onChange={(event) =>
            onChange(normalizeEventAction({ ...action, action: event.target.value }))
          }
        >
          {toFlatOptions(actionTypeOptions)}
        </InputComboSelect>
      ) : null}
      {isTradeAction ? (
        <>
          <div
            style={{
              display: "grid",
              width: "100%",
              gridTemplateColumns:
                "minmax(104px, 124px) minmax(84px, 0.82fr) minmax(84px, 0.82fr) minmax(140px, 1.15fr) minmax(140px, 1.15fr) minmax(140px, 1.15fr) 32px",
              gap: 10,
              minWidth: 0,
              alignItems: "center",
            }}
          >
            <InputComboSelect
              value={resolveSelectValue(actionType, actionTypeOptions)}
              searchable
              onChange={(event) =>
                onChange(normalizeEventAction({ ...action, action: event.target.value }))
              }
              style={ACTION_ROW_CONTROL_STYLE}
            >
              {toFlatOptions(actionTypeOptions)}
            </InputComboSelect>
            <InputComboSelect
              value={resolveSelectValue(action?.trade_plan?.direction, tradeDirectionOptions)}
              searchable
              onChange={(event) =>
                onChange(
                  normalizeEventAction({
                    ...action,
                    trade_plan: {
                      ...action?.trade_plan,
                      direction: event.target.value,
                    },
                  }),
                )
              }
              style={ACTION_ROW_CONTROL_STYLE}
            >
              {toFlatOptions(tradeDirectionOptions)}
            </InputComboSelect>
            <InputComboSelect
              value={resolveSelectValue(action?.trade_plan?.type, tradeOrderTypeOptions)}
              searchable
              onChange={(event) =>
                onChange(
                  normalizeEventAction({
                    ...action,
                    trade_plan: {
                      ...action?.trade_plan,
                      type: event.target.value,
                    },
                  }),
                )
              }
              style={ACTION_ROW_CONTROL_STYLE}
            >
              {toFlatOptions(tradeOrderTypeOptions)}
            </InputComboSelect>
            {[
              ["entry", "Entry"],
              ["tp", "TP"],
              ["sl", "SL"],
            ].map(([fieldKey, placeholder]) => (
              <InputComboSelect
                key={fieldKey}
                text={formatPlanFieldInput(action?.trade_plan?.[fieldKey])}
                items={variableOptions}
                type={isPlanFieldParamType(action?.trade_plan?.[fieldKey]) ? "param" : "value"}
                onChange={({ text, type }) =>
                  onChange(
                    normalizeEventAction({
                      ...action,
                      trade_plan: {
                        ...action?.trade_plan,
                        [fieldKey]: parsePlanFieldInput(text),
                      },
                    }),
                  )
                }
                placeholder={`${placeholder} / var`}
                inputTitle={`Type ${placeholder.toLowerCase()} price or pick a variable.`}
                menuTitle="Show variable suggestions"
                showType={false}
                searchable
                searchPlaceholder="Filter variables..."
                style={ACTION_ROW_INPUT_STYLE}
              />
            ))}
            <button
              type="button"
              className="danger-button"
              onClick={onRemove}
              aria-label="Remove action"
              title="Remove this action"
              style={COMPACT_DANGER_BUTTON_STYLE}
            >
              X
            </button>
          </div>
        </>
      ) : null}
      {isWebhookAction ? (
        <>
          <InputComboSelect
            value={resolveSelectValue(action?.method, webhookMethodOptions)}
            searchable
            onChange={(event) =>
              onChange(normalizeEventAction({ ...action, method: event.target.value }))
            }
          >
            {toFlatOptions(webhookMethodOptions)}
          </InputComboSelect>
          <input
            className="input"
            value={String(action?.url || "")}
            onChange={(event) =>
              onChange(normalizeEventAction({ ...action, url: event.target.value }))
            }
            placeholder="https://..."
          />
        </>
      ) : null}
      {isMessageAction ? (
        <input
          className="input"
          value={String(action?.message || "")}
          onChange={(event) =>
            onChange(normalizeEventAction({ ...action, message: event.target.value }))
          }
          placeholder="Message"
        />
      ) : null}
      {isTradeAction ? null : (
        <button
          type="button"
          className="danger-button"
          onClick={onRemove}
          aria-label="Remove action"
          title="Remove this action"
          style={COMPACT_DANGER_BUTTON_STYLE}
        >
          X
        </button>
      )}
    </div>
  );
}

function RuleTreeEditor({
  node,
  onChange,
  onRemove,
  variableOptions,
  depth = 0,
  compact = false,
}) {
  if (!node) return null;
  const isAndGroup = (node.operator || "and") !== "or";
  const logicOptions = withNullOption(LOGIC_OPTIONS);
  if (node.type === "condition") {
    return (
      <StrategyConditionEditor
        node={node}
        onChange={onChange}
        onRemove={onRemove}
        variableOptions={variableOptions}
        compact={compact}
      />
    );
  }

  return (
    <div
      style={{
        border: compact ? "none" : "1px solid var(--border)",
        borderRadius: compact ? 0 : 12,
        padding: compact ? 0 : 12,
        background: compact
          ? "transparent"
          : depth === 0
            ? "rgba(0,0,0,0.08)"
            : "rgba(255,255,255,0.02)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 10,
          alignItems: "stretch",
        }}
      >
        <div className="stack-layout" style={{ gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <InputComboSelect
                value={resolveSelectValue(node?.operator, logicOptions)}
                searchable
                onChange={(event) =>
                  onChange({
                    ...node,
                    operator: event.target.value,
                  })
                }
                aria-label="Condition group operator"
                title="Choose whether all conditions in this group must pass, or only one."
                style={{ minWidth: 112 }}
              >
                {toFlatOptions(logicOptions)}
              </InputComboSelect>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  onChange(appendGroupChild(node, { childType: "condition" }))
                }
              >
                + Condition
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  onChange(appendGroupChild(node, { childType: "group", operator: "and" }))
                }
              >
                + Group
              </button>
            </div>
            {onRemove ? (
              <button
                type="button"
                className="danger-button"
                onClick={onRemove}
                aria-label="Remove group"
              >
                X
              </button>
            ) : null}
          </div>
          <div
            className="stack-layout"
            style={{
              gap: isAndGroup ? 8 : 10,
              padding: isAndGroup ? 8 : 0,
              border: isAndGroup ? "1px solid var(--border)" : "none",
              borderRadius: isAndGroup ? 10 : 0,
              background: "transparent",
            }}
          >
            {(node.children || []).length ? (
              node.children.map((child) => (
                <RuleTreeEditor
                  key={child.id}
                  node={child}
                  variableOptions={variableOptions}
                  depth={depth + 1}
                  compact={child?.type === "condition"}
                  onChange={(nextChild) =>
                    onChange(updateTreeNode(node, child.id, () => nextChild))
                  }
                  onRemove={() =>
                    onChange(removeTreeNode(node, child.id) || makeEmptyGroup(node.operator))
                  }
                />
              ))
            ) : (
              <div className="minor-text" style={{ fontSize: 11 }}>
                No conditions yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StrategyEditorPanel({
  strategy,
  selectionKey,
  exampleStrategy,
  defaultSymbol = "EURAUD",
  defaultTf = "15",
  isNewDraft = false,
  hideBatchControls = false,
  onCreateNew,
  onSave,
  onSaveAs,
  onArchive,
  onDelete,
  onOpenBacktest,
  onRunBatch,
}) {
  const [activeTab, setActiveTab] = useState("json");
  const [draft, setDraft] = useState(null);
  const [jsonText, setJsonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [descriptionVisible, setDescriptionVisible] = useState(false);
  const [batchSymbolsInput, setBatchSymbolsInput] = useState("");
  const [batchTimeframes, setBatchTimeframes] = useState(DEFAULT_BATCH_TIMEFRAMES);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchReport, setBatchReport] = useState(null);
  const [batchError, setBatchError] = useState("");
  const isPreset = String(draft?.kind || "").trim() !== "custom";
  const timeframeOptions = useMemo(() => withNullOption(TIMEFRAME_OPTIONS), []);
  const batchTimeframeOptions = useMemo(
    () => TIMEFRAME_OPTIONS.filter((item) => item.value).map((item) => ({ ...item })),
    [],
  );
  const isStrategyEnabled = String(draft?.status || "").trim().toLowerCase() === "active";

  useEffect(() => {
    const defaultTab = "edit";
    const nextTab = getEditorTabFromHash(defaultTab);
    const nextDraft =
      nextTab === "edit"
        ? buildDefaultDraft(
            strategy || exampleStrategy,
            strategy
              ? {}
              : {
                  symbol: defaultSymbol,
                  tf: defaultTf,
                },
          )
        : strategy
      ? normalizeEditorStrategy(strategy)
          : buildDefaultDraft(exampleStrategy, {
              symbol: defaultSymbol,
              tf: defaultTf,
            });
    const normalizedDraft = {
      ...normalizeEditorStrategy(nextDraft),
      rules: normalizeStrategyRulesList(nextDraft),
    };
    setDraft(normalizedDraft);
    setJsonText(prettyJson(buildPersistedStrategy(normalizedDraft)));
    setActiveTab(nextTab);
    setDescriptionVisible(hasDataValue(nextDraft?.description));
    setMessage("");
    setMessageType("info");
    setBatchSymbolsInput("");
    setBatchTimeframes(DEFAULT_BATCH_TIMEFRAMES);
    setBatchReport(null);
    setBatchError("");
  }, [defaultSymbol, defaultTf, exampleStrategy, isNewDraft, selectionKey, strategy]);

  useEffect(() => {
    writeEditorHash(activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "edit") return;
    if (!isPreset) return;
    const nextDraft = buildDefaultDraft(strategy || exampleStrategy, {});
    setDraft(nextDraft);
    setJsonText(prettyJson(buildPersistedStrategy(nextDraft)));
    setDescriptionVisible(hasDataValue(nextDraft?.description));
  }, [activeTab, defaultSymbol, defaultTf, exampleStrategy, isPreset, strategy]);

  const variableOptions = useMemo(
    () => variableSuggestionsForDraft(draft),
    [draft],
  );
  const indicatorParamOptions = useMemo(
    () =>
      Object.keys(draft?.params || {}).map((key) => ({
        value: `params.${key}`,
        label: `params.${key}`,
      })),
    [draft?.params],
  );
  const hasIndicators = Array.isArray(draft?.indicators) && draft.indicators.length > 0;
  const hasRuleValues = Array.isArray(draft?.rules) && draft.rules.length > 0;
  const hasParams = Object.keys(draft?.params || {}).length > 0;
  const paramKeyCatalog = useMemo(() => {
    const byValue = new Map(
      PARAM_KEY_OPTIONS.map((option) => [String(option.value || ""), option]),
    );
    Object.keys(draft?.params || {}).forEach((key) => {
      const value = String(key || "").trim();
      if (!value || byValue.has(value)) return;
      byValue.set(value, { value, label: value });
    });
    return Array.from(byValue.values());
  }, [draft?.params]);
  const hasDescription = hasDataValue(draft?.description);
  const visibleRules = Array.isArray(draft?.rules) ? draft.rules : [];
  const backtestSummary =
    strategy?.backtest_summary && typeof strategy.backtest_summary === "object"
      ? strategy.backtest_summary
      : null;
  const presetMetaItems = PRESET_META_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    value: draft?.[field.key],
  }));
  const presetParamItems = Object.entries(draft?.params || {}).map(([key, value]) => ({
    key,
    label: key,
    value,
  }));

  function applyDraft(nextDraft) {
    const normalizedDraft = {
      ...normalizeEditorStrategy(nextDraft),
      rules: normalizeStrategyRulesList(nextDraft),
    };
    setDraft(normalizedDraft);
    setJsonText(prettyJson(buildPersistedStrategy(normalizedDraft)));
  }

  function updateDraft(updater) {
    setDraft((current) => {
      const base = deepClone(current) || buildDefaultDraft(exampleStrategy, {
        symbol: defaultSymbol,
        tf: defaultTf,
      });
      const updatedBase = updater(base);
      const nextDraft = {
        ...updatedBase,
        rules: normalizeStrategyRulesList(updatedBase),
      };
      setJsonText(prettyJson(buildPersistedStrategy(nextDraft)));
      return nextDraft;
    });
  }

  async function handleSaveFromJson() {
    setBusy(true);
    setMessage("");
    try {
      const parsed = JSON.parse(jsonText);
      const result = await onSave?.(parsed);
      applyDraft(normalizeEditorStrategy(result || parsed));
      setMessage("Strategy saved.");
      setMessageType("success");
    } catch (error) {
      setMessage(String(error?.message || error || "Failed to save strategy"));
      setMessageType("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveVisual() {
    setBusy(true);
    setMessage("");
    try {
      const payload = buildPersistedStrategy(draft);
      const result = await onSave?.(payload);
      applyDraft(normalizeEditorStrategy(result || payload));
      setMessage("Strategy saved.");
      setMessageType("success");
    } catch (error) {
      setMessage(String(error?.message || error || "Failed to save strategy"));
      setMessageType("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAsFromJson() {
    setBusy(true);
    setMessage("");
    try {
      const parsed = JSON.parse(jsonText);
      const result = await onSaveAs?.(parsed);
      applyDraft(normalizeEditorStrategy(result || parsed));
      setMessage("Strategy saved as new.");
      setMessageType("success");
    } catch (error) {
      setMessage(String(error?.message || error || "Failed to save strategy as new"));
      setMessageType("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAsVisual() {
    setBusy(true);
    setMessage("");
    try {
      const payload = buildPersistedStrategy(draft);
      const result = await onSaveAs?.(payload);
      applyDraft(normalizeEditorStrategy(result || payload));
      setMessage("Strategy saved as new.");
      setMessageType("success");
    } catch (error) {
      setMessage(String(error?.message || error || "Failed to save strategy as new"));
      setMessageType("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleRunBatch() {
    setBatchRunning(true);
    setBatchError("");
    try {
      const result = await onRunBatch?.({
        strategy: draft,
        symbols: parseCommaSeparatedInput(batchSymbolsInput),
        timeframes: Array.isArray(batchTimeframes) && batchTimeframes.length
          ? batchTimeframes
          : DEFAULT_BATCH_TIMEFRAMES,
      });
      setBatchReport(result?.report || null);
    } catch (error) {
      setBatchError(String(error?.message || error || "Batch run failed"));
      setBatchReport(null);
    } finally {
      setBatchRunning(false);
    }
  }

  async function handleArchive() {
    if (!draft?.id || isPreset) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await onArchive?.(draft.id);
      applyDraft(normalizeEditorStrategy(result || draft));
      setMessage("Strategy archived.");
      setMessageType("success");
    } catch (error) {
      setMessage(String(error?.message || error || "Failed to archive strategy"));
      setMessageType("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!draft?.id || isPreset) return;
    setBusy(true);
    setMessage("");
    try {
      await onDelete?.(draft.id);
      setMessage("Strategy deleted.");
      setMessageType("success");
    } catch (error) {
      setMessage(String(error?.message || error || "Failed to delete strategy"));
      setMessageType("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-layout" style={{ gap: 16 }}>
      <ResponsivePanel
        headerContent={
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
              width: "100%",
              flexWrap: "wrap",
            }}
          >
            <div className="stack-layout" style={{ gap: 6, minWidth: 0, flex: "1 1 320px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 800 }}>
                  {draft?.name || draft?.id || "Strategy"}
                </div>
                <ToggleButton
                  active={isStrategyEnabled}
                  classActive="secondary-button"
                  classInActive="secondary-button"
                  labelActive="Enabled"
                  labelInActive="Disabled"
                  colorActive="#22c55e"
                  colorInActive="#94a3b8"
                  disabled={isPreset || busy || batchRunning}
                  onClick={() =>
                    updateDraft((base) => ({
                      ...base,
                      status:
                        String(base?.status || "").trim().toLowerCase() === "active"
                          ? "draft"
                          : "active",
                    }))
                  }
                />
              </div>
              {draft?.description ? (
                <div
                  className="minor-text"
                  style={{
                    fontSize: 12,
                    lineHeight: 1.45,
                    maxWidth: 720,
                  }}
                >
                  {draft.description}
                </div>
              ) : null}
            </div>
            <div
              className="stack-layout"
              style={{
                gap: 8,
                alignItems: "flex-end",
                marginLeft: "auto",
                flex: "0 1 auto",
              }}
            >
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => onOpenBacktest?.(draft)}
                  disabled={busy || batchRunning}
                >
                  Run Backtest
                </button>
                {hideBatchControls ? null : (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleRunBatch}
                    disabled={busy || batchRunning}
                  >
                    {batchRunning ? "Running Batch..." : "Run Batch"}
                  </button>
                )}
                <TabBar
                  value={activeTab}
                  options={EDITOR_TABS}
                  onChange={(nextValue) => setActiveTab(nextValue || "json")}
                  size="sm"
                  ariaLabel="Strategy editor tabs"
                />
              </div>
              {hideBatchControls ? null : (
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                    width: "100%",
                  }}
                >
                  <input
                    className="input"
                    value={batchSymbolsInput}
                    onChange={(event) => setBatchSymbolsInput(event.target.value.toUpperCase())}
                    placeholder="Batch symbols blank = watchlist"
                    style={{ minWidth: 240, flex: "1 1 260px" }}
                  />
                  <TimeframeSelector
                    value={batchTimeframes}
                    onChange={(nextValue) =>
                      setBatchTimeframes(
                        Array.isArray(nextValue) && nextValue.length
                          ? nextValue
                          : DEFAULT_BATCH_TIMEFRAMES,
                      )
                    }
                    options={batchTimeframeOptions}
                    multiple
                    allowEmpty={false}
                    size="sm"
                    ariaLabel="Batch timeframes"
                  />
                </div>
              )}
              {backtestSummary ? (
                <BacktestSummaryMetaRow
                  leadLabel={`${Math.round(Number(backtestSummary?.total_trades || 0))} trades`}
                  winRateValue={backtestSummary?.weighted_win_rate_pct}
                  rrValue={backtestSummary?.total_r}
                  rangeLabel={formatBacktestSummaryRange(backtestSummary)}
                  title={[
                    `${Math.round(Number(backtestSummary?.total_trades || 0))} trades`,
                    `WR ${formatBacktestSummaryNumber(backtestSummary?.weighted_win_rate_pct, 0)}%`,
                    `RR ${formatBacktestSummaryNumber(backtestSummary?.total_r, 1)}`,
                    formatBacktestSummaryRange(backtestSummary),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ) : null}
            </div>
          </div>
        }
        showToggle={false}
        border="always"
        bodyClassName="stack-layout"
      >
        <div className="stack-layout" style={{ gap: 12 }}>
          {message ? (
            <div
              className="minor-text"
              style={{
                color: messageType === "error" ? "#f87171" : "#a7f3d0",
                fontSize: 11,
              }}
            >
              {message}
            </div>
          ) : null}
          {batchError ? (
            <div className="minor-text" style={{ color: "#f87171", fontSize: 11 }}>
              {batchError}
            </div>
          ) : null}
          {batchReport ? (
            <ResponsivePanel showToggle={false} border="always" bodyClassName="stack-layout">
              <div className="panel-label">Batch Report</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                  gap: 10,
                }}
              >
                {[
                  { label: "Strategies", value: batchReport?.totals?.strategies },
                  { label: "Symbols", value: batchReport?.totals?.symbols },
                  { label: "TFs", value: batchReport?.totals?.timeframes },
                  { label: "Trades", value: batchReport?.totals?.total_trades },
                  { label: "WR %", value: formatBatchMetric(batchReport?.totals?.weighted_win_rate_pct, 1) },
                  { label: "RR", value: formatBatchMetric(batchReport?.totals?.total_r, 1) },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(148,163,184,0.18)",
                      background: "rgba(15,23,42,0.32)",
                    }}
                  >
                    <div className="minor-text" style={{ fontSize: 10 }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>
                      {item.value ?? "-"}
                    </div>
                  </div>
                ))}
              </div>
              <div className="minor-text" style={{ fontSize: 11 }}>
                Scope: {(batchReport?.selection?.symbols || []).join(", ") || "watchlist"} ·{" "}
                {(batchReport?.selection?.timeframes || [])
                  .map((item) => formatBatchTimeframeLabel(item))
                  .join(", ")}
              </div>
              <div className="stack-layout" style={{ gap: 8 }}>
                {(Array.isArray(batchReport?.rows) ? batchReport.rows : []).slice(0, 18).map((row, index) => (
                  <div
                    key={`${row?.strategy_id || row?.strategy_name || "strategy"}:${row?.symbol || "symbol"}:${row?.tf || index}:${index}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2.2fr 0.85fr 0.7fr 0.75fr 0.75fr 2fr",
                      gap: 10,
                      alignItems: "center",
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid rgba(148,163,184,0.14)",
                      background: "rgba(15,23,42,0.24)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>
                        {row?.strategy_name || row?.strategy_id || "Strategy"}
                      </div>
                      {row?.error ? (
                        <div className="minor-text" style={{ color: "#fca5a5", fontSize: 10 }}>
                          {row.error}
                        </div>
                      ) : null}
                    </div>
                    <div className="minor-text" style={{ fontSize: 11 }}>
                      {row?.symbol || "-"}
                    </div>
                    <div className="minor-text" style={{ fontSize: 11 }}>
                      {formatBatchTimeframeLabel(row?.tf)}
                    </div>
                    <div className="minor-text" style={{ fontSize: 11 }}>
                      {row?.status === "failed"
                        ? "Fail"
                        : formatBatchMetric(row?.total_trades, 0)}
                    </div>
                    <div className="minor-text" style={{ fontSize: 11 }}>
                      {row?.status === "failed"
                        ? "-"
                        : `${formatBatchMetric(row?.win_rate_pct, 1)}%`}
                    </div>
                    <div
                      className="minor-text"
                      style={{
                        fontSize: 11,
                        color:
                          Number(row?.total_r || 0) > 0
                            ? "#34d399"
                            : Number(row?.total_r || 0) < 0
                              ? "#f87171"
                              : "var(--text-muted, #94a3b8)",
                      }}
                    >
                      {row?.status === "failed"
                        ? "-"
                        : `R ${formatBatchMetric(row?.total_r, 1)} · PnL ${formatBatchMetric(row?.total_pnl, 2)}`}
                    </div>
                  </div>
                ))}
              </div>
            </ResponsivePanel>
          ) : null}
        </div>
      </ResponsivePanel>

      {activeTab === "json" ? (
        <ResponsivePanel showToggle={false} border="always" bodyClassName="stack-layout">
          <textarea
            value={jsonText}
            onChange={(event) => setJsonText(event.target.value)}
            readOnly={isPreset}
            spellCheck={false}
            style={{
              width: "100%",
              minHeight: 560,
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "rgba(0,0,0,0.22)",
              color: "var(--text)",
              padding: 14,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 12,
              lineHeight: 1.5,
              resize: "vertical",
            }}
          />
        </ResponsivePanel>
      ) : null}

      {activeTab === "edit" ? (
        <div className="stack-layout" style={{ gap: 16 }}>
          {isPreset ? (
            <>
              <ResponsivePanel showToggle={false} border="always" bodyClassName="stack-layout">
                <SimpleFieldGrid
                  items={[
                    { key: "name", label: "Name", value: draft?.name },
                    ...presetMetaItems,
                  ]}
                />
                {draft?.description ? (
                  <div className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text" style={{ fontSize: 11 }}>
                      Description
                    </span>
                    <div
                      style={{
                        borderRadius: 10,
                        border: "1px solid var(--border)",
                        background: "rgba(255,255,255,0.03)",
                        color: "var(--text)",
                        padding: 12,
                        lineHeight: 1.5,
                      }}
                    >
                      {draft.description}
                    </div>
                  </div>
                ) : null}
              </ResponsivePanel>

              <ResponsivePanel showToggle={false} border="always" bodyClassName="stack-layout">
                <div className="panel-label">Parameters</div>
                <SimpleFieldGrid items={presetParamItems} />
              </ResponsivePanel>
            </>
          ) : (
            <>
              <ResponsivePanel showToggle={false} border="always" bodyClassName="stack-layout">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                    gap: 12,
                  }}
                >
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">ID</span>
                    <input
                      className="input"
                      value={draft?.id || ""}
                      readOnly={isPreset}
                      onChange={(event) =>
                        updateDraft((base) => ({
                          ...base,
                          id: sanitizeStrategyId(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Name</span>
                    <input
                      className="input"
                      value={draft?.name || ""}
                      readOnly={isPreset}
                      onChange={(event) =>
                        updateDraft((base) => ({
                          ...base,
                          name: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Symbol</span>
                    <input
                      className="input"
                      value={draft?.market?.symbol || ""}
                      readOnly={isPreset}
                      onChange={(event) =>
                        updateDraft((base) => ({
                          ...base,
                          market: {
                            ...(base.market || {}),
                            symbol: event.target.value.toUpperCase(),
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Timeframe</span>
                    <InputComboSelect
                      value={resolveSelectValue(draft?.market?.tf, timeframeOptions)}
                      searchable
                      readOnly={isPreset}
                      onChange={(event) =>
                        updateDraft((base) => ({
                          ...base,
                          market: {
                            ...(base.market || {}),
                            tf: event.target.value,
                          },
                        }))
                      }
                    >
                      {toFlatOptions(timeframeOptions)}
                    </InputComboSelect>
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Skip News</span>
                    <InputComboSelect
                      value={
                        draft?.conditions?.skip_news === true
                          ? "true"
                          : draft?.conditions?.skip_news === false
                            ? "false"
                            : ""
                      }
                      onChange={(event) =>
                        updateDraft((base) => ({
                          ...base,
                          conditions: {
                            ...(base.conditions || {}),
                            skip_news: parseNullableBooleanInput(event.target.value),
                          },
                        }))
                      }
                    >
                      {toFlatOptions(
                        STRATEGY_CONDITION_FIELDS.find((field) => field.key === "skip_news")
                          ?.options || [],
                      )}
                    </InputComboSelect>
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">News Window Min</span>
                    <input
                      className="input"
                      value={conditionFieldValue(draft, "news_window_minutes")}
                      placeholder="120"
                      onChange={(event) =>
                        updateDraft((base) => ({
                          ...base,
                          conditions: {
                            ...(base.conditions || {}),
                            news_window_minutes: parseNullableNumberInput(event.target.value),
                            news_before_minutes: null,
                            news_after_minutes: null,
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Description</span>
                    <input
                      className="input"
                      value={draft?.description || ""}
                      readOnly={isPreset}
                      onChange={(event) =>
                        updateDraft((base) => ({
                          ...base,
                          description: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="stack-layout" style={{ gap: 10 }}>
                  <div className="minor-text" style={{ fontSize: 11 }}>
                    Risk
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                      gap: 10,
                    }}
                  >
                    {RISK_FIELDS.map((field) => (
                      <label key={field.key} className="stack-layout" style={{ gap: 6 }}>
                        <span className="minor-text">{field.label}</span>
                        <input
                          className="input"
                          value={draft?.risk?.[field.key] ?? ""}
                          placeholder="null"
                          onChange={(event) =>
                            updateDraft((base) => ({
                              ...base,
                              risk: {
                                ...(base.risk || {}),
                                [field.key]: parseNullableNumberInput(event.target.value),
                              },
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="stack-layout" style={{ gap: 10 }}>
                  <div className="minor-text" style={{ fontSize: 11 }}>
                    Conditions
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                      gap: 10,
                    }}
                  >
                    {STRATEGY_CONDITION_FIELDS.filter(
                      (field) => !["skip_news", "news_window_minutes"].includes(field.key),
                    ).map((field) => (
                      <label key={field.key} className="stack-layout" style={{ gap: 6 }}>
                        <span className="minor-text">{field.label}</span>
                        {field.type === "select" ? (
                          <InputComboSelect
                            value={
                              draft?.conditions?.[field.key] === true
                                ? "true"
                                : draft?.conditions?.[field.key] === false
                                  ? "false"
                                  : ""
                            }
                            onChange={(event) =>
                              updateDraft((base) => ({
                                ...base,
                                conditions: {
                                  ...(base.conditions || {}),
                                  [field.key]: parseNullableBooleanInput(event.target.value),
                                },
                              }))
                            }
                          >
                            {toFlatOptions(field.options || [])}
                          </InputComboSelect>
                        ) : (
                          <input
                            className="input"
                            value={
                              field.type === "csv"
                                ? formatCommaSeparatedInput(conditionFieldValue(draft, field.key))
                                : conditionFieldValue(draft, field.key)
                            }
                            placeholder={field.placeholder || "null"}
                            onChange={(event) =>
                              updateDraft((base) => ({
                                ...base,
                                conditions: {
                                  ...(base.conditions || {}),
                                  ...(field.key === "news_window_minutes"
                                    ? {
                                        news_window_minutes: parseNullableNumberInput(event.target.value),
                                        news_before_minutes: null,
                                        news_after_minutes: null,
                                      }
                                    : {
                                        [field.key]:
                                          field.type === "csv"
                                            ? parseCommaSeparatedInput(event.target.value)
                                            : parseNullableNumberInput(event.target.value),
                                      }),
                                },
                              }))
                            }
                          />
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              </ResponsivePanel>

              <ResponsivePanel
                title="Parameters"
                subtitle={buildSectionSubtitle(
                  hasParams,
                  "No parameters yet.",
                  "Reusable values for rules and risk.",
                )}
                defaultOpen={hasParams}
                collapseDirection="top-down"
                border="always"
                bodyClassName="stack-layout"
                headerActions={(
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={
                      paramKeyCatalog.every((option) =>
                        Object.prototype.hasOwnProperty.call(draft?.params || {}, option.value),
                      )
                    }
                    onClick={() =>
                      updateDraft((base) => {
                        const nextParams = { ...(base.params || {}) };
                        const nextOption = paramKeyCatalog.find(
                          (option) => !Object.prototype.hasOwnProperty.call(nextParams, option.value),
                        );
                        if (!nextOption) return base;
                        nextParams[nextOption.value] = 0;
                        return {
                          ...base,
                          params: nextParams,
                        };
                      })
                    }
                  >
                    Add Param
                  </button>
                )}
              >
                {hasParams ? (
                  <div className="stack-layout" style={{ gap: 8 }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) 42px",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <span className="minor-text" style={{ fontSize: 11 }}>Param</span>
                      <span className="minor-text" style={{ fontSize: 11 }}>Value</span>
                      <span />
                    </div>
                    {Object.entries(draft?.params || {}).map(([key, value]) => {
                      const paramKeyOptions = withNullOption(
                        paramKeyCatalog.filter(
                          (option) =>
                            option.value === key ||
                            !Object.prototype.hasOwnProperty.call(draft?.params || {}, option.value),
                        ),
                      );
                      return (
                      <div
                        key={key}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        <InputComboSelect
                          value={resolveSelectValue(key, paramKeyOptions)}
                          searchable
                          onChange={(event) =>
                            updateDraft((base) => {
                              const nextParams = { ...(base.params || {}) };
                              const nextValue = nextParams[key];
                              const nextKey = String(event.target.value || "").trim();
                              if (!nextKey || nextKey === key) return base;
                              if (
                                Object.prototype.hasOwnProperty.call(nextParams, nextKey) &&
                                nextKey !== key
                              ) {
                                return base;
                              }
                              delete nextParams[key];
                              nextParams[nextKey] = nextValue;
                              return {
                                ...base,
                                params: nextParams,
                              };
                            })
                          }
                        >
                          {toFlatOptions(paramKeyOptions)}
                        </InputComboSelect>
                        <input
                          className="input"
                          value={formatLiteralInput(value)}
                          onChange={(event) =>
                            updateDraft((base) => ({
                              ...base,
                              params: {
                                ...(base.params || {}),
                                [key]: parseLiteralInput(event.target.value),
                              },
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() =>
                            updateDraft((base) => {
                              const nextParams = { ...(base.params || {}) };
                              delete nextParams[key];
                              return {
                                ...base,
                                params: nextParams,
                              };
                            })
                          }
                          aria-label={`Remove parameter ${key}`}
                        >
                          X
                        </button>
                      </div>
                      );
                    })}
                  </div>
                ) : (
                  <HintText title="Add parameters from the header button. Parameters can be referenced in rules using params.your_name.">
                    Add parameters from the header button. Use them in rules like `params.fast_period`.
                  </HintText>
                )}
              </ResponsivePanel>

              <ResponsivePanel
                title="Indicators"
                subtitle={buildSectionSubtitle(
                  hasIndicators,
                  "No indicators yet.",
                  "Indicators become available in rule variables.",
                )}
                defaultOpen={hasIndicators}
                collapseDirection="top-down"
                border="always"
                bodyClassName="stack-layout"
                headerActions={(
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      updateDraft((base) => {
                        const nextIndicators = Array.isArray(base.indicators)
                          ? [...base.indicators]
                          : [];
                        nextIndicators.push({
                          id: `ema_${nextIndicators.length + 1}`,
                          type: "ema",
                          source: "close",
                          length: 20,
                        });
                        return {
                          ...base,
                          indicators: nextIndicators,
                        };
                      })
                    }
                  >
                    Add Indicator
                  </button>
                )}
              >
                {hasIndicators ? (
                  <div className="stack-layout" style={{ gap: 10 }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(120px, 1fr) minmax(120px, 1fr) minmax(140px, 1fr) 96px minmax(120px, 1fr) 42px",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      <span className="minor-text" style={{ fontSize: 11 }}>ID</span>
                      <span className="minor-text" style={{ fontSize: 11 }}>Type</span>
                      <span className="minor-text" style={{ fontSize: 11 }}>Source</span>
                      <span className="minor-text" style={{ fontSize: 11 }}>Length</span>
                      <span className="minor-text" style={{ fontSize: 11 }}>Field</span>
                      <span />
                    </div>
                    {(Array.isArray(draft?.indicators) ? draft.indicators : []).map((indicator, index) => (
                      <StrategyIndicatorRow
                        key={`${indicator?.id || "indicator"}_${index}`}
                        indicator={indicator}
                        index={index}
                        updateDraft={updateDraft}
                        indicatorParamOptions={indicatorParamOptions}
                      />
                    ))}
                  </div>
                ) : null}
              </ResponsivePanel>

              <ResponsivePanel
                title="Rules"
                subtitle={buildSectionSubtitle(
                  hasRuleValues,
                  "No rules yet.",
                  "Rules are fully dynamic and can carry their own bias, priority, and actions.",
                )}
                defaultOpen={hasRuleValues}
                collapseDirection="top-down"
                border="always"
                bodyClassName="stack-layout"
                headerActions={(
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      updateDraft((base) => ({
                        ...base,
                        rules: [
                          ...(Array.isArray(base.rules) ? base.rules : []),
                          createEmptyRuleDraft({
                            name: `Rule ${(Array.isArray(base.rules) ? base.rules.length : 0) + 1}`,
                          }),
                        ],
                      }))
                    }
                  >
                    Add Rule
                  </button>
                )}
              >
                <datalist id="strategy-variable-suggestions">
                  {variableOptions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
                <div className="stack-layout" style={{ gap: 14 }}>
                  {visibleRules.map((rule, ruleIndex) => {
                    return (
                      <RuleBuilder
                        key={rule.id || `rule_${ruleIndex}`}
                        rule={rule}
                        variableOptions={variableOptions}
                        onChange={(nextRule) =>
                          updateDraft((base) => ({
                            ...base,
                            rules: (Array.isArray(base.rules) ? base.rules : []).map((item) =>
                              item.id === rule.id ? nextRule : item,
                            ),
                          }))
                        }
                        onRemove={() =>
                          updateDraft((base) => ({
                            ...base,
                            rules: (Array.isArray(base.rules) ? base.rules : []).filter(
                              (item) => item.id !== rule.id,
                            ),
                          }))
                        }
                      />
                    );
                  })}
                  {!visibleRules.length ? (
                    <div className="minor-text" style={{ fontSize: 11 }}>
                      No rules yet. Add one to start defining custom conditions and actions.
                    </div>
                  ) : null}
                </div>
              </ResponsivePanel>
            </>
          )}
        </div>
      ) : null}
      <ResponsivePanel showToggle={false} border="always" bodyClassName="stack-layout">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="secondary-button"
              onClick={onCreateNew}
              disabled={busy}
            >
              New Custom
            </button>
            {isPreset || isNewDraft ? null : (
              <button
                type="button"
                className="secondary-button"
                onClick={handleArchive}
                disabled={busy}
              >
                Archive
              </button>
            )}
            {isPreset || isNewDraft ? null : (
              <button
                type="button"
                className="danger-button"
                onClick={handleDelete}
                disabled={busy}
              >
                Delete
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
            <button
              type="button"
              className="secondary-button"
              onClick={activeTab === "json" ? handleSaveAsFromJson : handleSaveAsVisual}
              disabled={busy}
            >
              Save As
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={activeTab === "json" ? handleSaveFromJson : handleSaveVisual}
              disabled={busy}
            >
              {busy ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </ResponsivePanel>
    </div>
  );
}
