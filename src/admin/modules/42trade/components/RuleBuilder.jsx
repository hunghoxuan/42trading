import { useMemo } from "react";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import strategyFunctions from "../../../../config/strategyFunctions.json";
import {
  appendGroupChild,
  ensureGroupRootDraft,
  makeEmptyConditionDraft,
  makeEmptyGroupDraft,
} from "../../../shared/utils/strategyRuleEditor.js";

const LOGIC_OPTIONS = [
  { value: "and", label: "AND" },
  { value: "or", label: "OR" },
  { value: "then", label: "THEN" },
];

const CONDITION_MODE_OPTIONS = [
  { value: "compare", label: "Compare" },
  { value: "if_true", label: "If True" },
  { value: "if_not", label: "If Not" },
  { value: "predefined_rule", label: "Predefined Rule" },
  { value: "is_true", label: "Rule True" },
  { value: "get_artifacts", label: "GET_ARTIFACTS" },
  { value: "draw", label: "DRAW" },
];

const FUNCTION_OPTIONS = (Array.isArray(strategyFunctions?.functions)
  ? strategyFunctions.functions
  : []
)
  .filter((item) => item?.kind === "predicate")
  .map((item) => ({
    value: String(item?.value || "").trim(),
    label: String(item?.label || item?.value || "").trim(),
    args: Array.isArray(item?.args) ? item.args : [],
  }))
  .filter((item) => item.value);

const FUNCTION_VALUES = new Set(FUNCTION_OPTIONS.map((item) => item.value));

const COMPARATOR_OPTIONS = (Array.isArray(strategyFunctions?.operators)
  ? strategyFunctions.operators
  : []
)
  .filter(
    (item) =>
      item?.category === "comparator" &&
      !FUNCTION_VALUES.has(String(item?.value || "").trim()),
  )
  .map((item) => ({
    value: String(item?.value || "").trim(),
    label: String(item?.label || item?.value || "").trim(),
  }))
  .filter((item) => item.value);

const RULE_BIAS_OPTIONS = [
  { value: "neutral", label: "Auto" },
  { value: "bullish", label: "Bullish" },
  { value: "bearish", label: "Bearish" },
];

const RULE_PRIORITY_OPTIONS = [
  { value: "medium", label: "Medium" },
  { value: "strong", label: "Strong" },
  { value: "weak", label: "Weak" },
];

const ACTION_TYPE_OPTIONS = [
  { value: "trade", label: "Trade" },
  { value: "draw", label: "Marker" },
  { value: "notify.notification", label: "Notification" },
  { value: "notify.toast", label: "Toast" },
];

const TRADE_DIRECTION_OPTIONS = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
];

const TRADE_TYPE_OPTIONS = [
  { value: "market", label: "Market" },
  { value: "limit", label: "Limit" },
  { value: "stop", label: "Stop" },
];

const BIAS_ARG_OPTIONS = [
  { value: "", label: "Any Bias" },
  { value: "bullish", label: "Bullish" },
  { value: "bearish", label: "Bearish" },
];

const PHASE_ARG_OPTIONS = [
  { value: "", label: "Any Phase" },
  { value: "impulse", label: "Impulse" },
  { value: "pullback", label: "Pullback" },
  { value: "continuation", label: "Continuation" },
  { value: "reversal", label: "Reversal" },
  { value: "consolidation", label: "Consolidation" },
];

const TF_ARG_OPTIONS = [
  { value: "", label: "Current TF" },
  { value: "all", label: "All TFs" },
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "60", label: "1h" },
  { value: "240", label: "4h" },
  { value: "1440", label: "1d" },
];

const WRAPPER_FUNCTION_MODES = new Set(["is_true", "get_artifacts", "draw"]);

function deepClone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function createNodeId(prefix = "node") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function prettyJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

function normalizeTradeDirection(value = "", fallback = "buy") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["buy", "bull", "bullish", "long"].includes(normalized)) return "buy";
  if (["sell", "bear", "bearish", "short"].includes(normalized)) return "sell";
  return fallback === "sell" ? "sell" : "buy";
}

function normalizeRuleBias(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["bull", "bullish", "buy", "long"].includes(normalized)) return "bullish";
  if (["bear", "bearish", "sell", "short"].includes(normalized)) return "bearish";
  if (["auto", "both", "neutral", "any"].includes(normalized)) return "neutral";
  return "neutral";
}

function normalizeRulePriority(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["strong", "high"].includes(normalized)) return "strong";
  if (["weak", "low"].includes(normalized)) return "weak";
  return "medium";
}

function normalizeRuleName(value = "", fallback = "Rule") {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase();
  if (["entry long", "long entry", "buy"].includes(normalized)) return "Buy";
  if (["entry short", "short entry", "sell"].includes(normalized)) return "Sell";
  return raw || fallback;
}

function parseLiteralInput(rawValue = "") {
  const raw = String(rawValue ?? "").trim();
  if (!raw.length) return "";
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  const num = Number(raw);
  if (Number.isFinite(num) && raw !== "") return num;
  return rawValue;
}

function formatLiteralInput(value) {
  if (value === null) return "null";
  if (value === undefined) return "";
  return String(value);
}

function parsePlanFieldInput(value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
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

function getFunctionMeta(functionName = "") {
  return FUNCTION_OPTIONS.find(
    (item) => item.value === String(functionName || "").trim(),
  ) || null;
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
  return (Array.isArray(meta?.args) ? meta.args : []).map((_, index) =>
    createDefaultFunctionArg(meta, index),
  );
}

function buildOperandFromExpression(node) {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    if (typeof node.fn === "string") return null;
    const keys = Object.keys(node);
    if (keys.length === 1 && keys[0] === "var") {
      return { kind: "var", value: String(node.var || "") };
    }
    return null;
  }
  if (
    typeof node === "number" ||
    typeof node === "string" ||
    typeof node === "boolean" ||
    node === null
  ) {
    return { kind: "literal", value: node };
  }
  return null;
}

export function buildVisualNodeFromExpression(expression) {
  if (!expression || typeof expression !== "object" || Array.isArray(expression)) {
    return null;
  }
  if (
    Object.keys(expression).length === 1 &&
    Object.prototype.hasOwnProperty.call(expression, "not")
  ) {
    const nested = buildVisualNodeFromExpression(expression.not);
    if (nested?.type === "condition" && String(nested?.mode || "") === "if_true") {
      return { ...nested, mode: "if_not" };
    }
    return null;
  }
  if (typeof expression.fn === "string") {
    const functionName = String(expression.fn || "").trim();
    if (WRAPPER_FUNCTION_MODES.has(functionName)) {
      const targetExpression = Array.isArray(expression.args) ? expression.args[0] : null;
      const target = buildVisualNodeFromExpression(targetExpression);
      if (!target) return null;
      return {
        id: createNodeId("condition"),
        type: "condition",
        mode: functionName,
        functionName: "touches",
        args: createFunctionArgs("touches"),
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
  if (["and", "or", "then"].includes(operator)) {
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
  if (FUNCTION_VALUES.has(operator)) {
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
    functionName: FUNCTION_OPTIONS[0]?.value || "touches",
    args: createFunctionArgs(FUNCTION_OPTIONS[0]?.value || "touches"),
    target: null,
  };
}

function buildExpressionFromOperand(operand) {
  if (operand?.kind === "var") {
    const nextValue = String(operand?.value || "").trim();
    return nextValue ? { var: nextValue } : null;
  }
  if (operand?.kind !== "literal") return null;
  return parseLiteralInput(operand?.value);
}

export function buildExpressionFromVisualNode(node) {
  if (!node) return null;
  if (node.type === "group") {
    const operator = String(node?.operator || "").trim().toLowerCase();
    if (!["and", "or", "then"].includes(operator)) return null;
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
      const fnNode = { fn: functionName, args };
      return mode === "if_not" ? { not: fnNode } : fnNode;
    }
    if (WRAPPER_FUNCTION_MODES.has(mode)) {
      const targetExpression = buildExpressionFromVisualNode(node?.target);
      if (!targetExpression) return null;
      return { fn: mode, args: [targetExpression] };
    }
    const comparator = String(node?.comparator || "").trim();
    if (!comparator) return null;
    const left = buildExpressionFromOperand(node.left);
    const right = buildExpressionFromOperand(node.right);
    if (left === null || right === null) return null;
    return { [comparator]: [left, right] };
  }
  return null;
}

function normalizeOperandDraft(
  value,
  fallback = { kind: "literal", value: "" },
) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value.kind === "var" || value.kind === "literal")
  ) {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Object.prototype.hasOwnProperty.call(value, "var")
  ) {
    return { kind: "var", value: String(value.var || "") };
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return { kind: "literal", value };
  }
  return fallback;
}

function ensureConditionDraft(node) {
  const base =
    node && typeof node === "object" && !Array.isArray(node)
      ? node
      : makeEmptyConditionDraft();
  const rawMode = String(base?.mode || "compare");
  const mode =
    rawMode === "if_true" ||
    rawMode === "if_not" ||
    rawMode === "predefined_rule" ||
    WRAPPER_FUNCTION_MODES.has(rawMode)
      ? rawMode
      : "compare";
  const fallbackFunction = FUNCTION_OPTIONS[0]?.value || "touches";
  const functionName =
    mode !== "compare" && getFunctionMeta(base?.functionName)
      ? String(base.functionName)
      : fallbackFunction;
  const meta = getFunctionMeta(functionName);
  const expectedArgs = Array.isArray(meta?.args) ? meta.args : [];
  const nextArgs = expectedArgs.map((_, index) => {
    const argKey = String(meta?.args?.[index]?.key || "").trim();
    const currentArg = Array.isArray(base?.args)
      ? base.args[index]
      : base?.args && typeof base.args === "object"
        ? base.args[argKey]
        : null;
    if (argKey === "bias" || argKey === "tf" || argKey === "phase") {
      const normalizedSelectValue =
        currentArg &&
        typeof currentArg === "object" &&
        !Array.isArray(currentArg) &&
        Object.prototype.hasOwnProperty.call(currentArg, "var")
          ? String(currentArg.var || "")
          : currentArg &&
              typeof currentArg === "object" &&
              !Array.isArray(currentArg) &&
              currentArg.kind === "literal"
            ? String(currentArg.value ?? "")
            : currentArg &&
                typeof currentArg === "object" &&
                !Array.isArray(currentArg) &&
                currentArg.kind === "var"
              ? String(currentArg.value ?? "")
              : String(currentArg ?? "");
      return {
        kind: "literal",
        value: normalizedSelectValue,
      };
    }
    return normalizeOperandDraft(
      currentArg,
      createDefaultFunctionArg(meta, index),
    );
  });
  return {
    ...makeEmptyConditionDraft(),
    ...base,
    mode,
    comparator: String(base?.comparator || ">") || ">",
    left: normalizeOperandDraft(base?.left, {
      kind: "var",
      value: "bar.close",
    }),
    right: normalizeOperandDraft(base?.right, {
      kind: "var",
      value: "levels.pd_mid",
    }),
    functionName,
    args: nextArgs,
    target:
      base?.target && typeof base.target === "object"
        ? ensureGroupRootDraft(base.target)
        : WRAPPER_FUNCTION_MODES.has(mode)
          ? ensureGroupRootDraft(makeEmptyConditionDraft())
          : null,
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

function resolveSelectValue(value, options = []) {
  const normalized = String(value ?? "").trim();
  return options.some((item) => String(item?.value ?? "") === normalized)
    ? normalized
    : String(options[0]?.value ?? "");
}

function toFlatOptions(items = []) {
  return items.map((item) => (
    <option key={item.value} value={item.value}>
      {item.label}
    </option>
  ));
}

function functionArgMeta(functionMeta = null, index = 0) {
  return functionMeta?.args?.[index] || null;
}

function functionArgKey(functionMeta = null, index = 0) {
  return String(functionArgMeta(functionMeta, index)?.key || "")
    .trim()
    .toLowerCase();
}

function functionArgSelectOptions(functionMeta = null, index = 0, currentTimeframeLabel = "") {
  const key = functionArgKey(functionMeta, index);
  if (key === "bias") return BIAS_ARG_OPTIONS;
  if (key === "phase") return PHASE_ARG_OPTIONS;
  if (key === "tf") {
    const nextLabel = String(currentTimeframeLabel || "").trim();
    if (!nextLabel) return TF_ARG_OPTIONS;
    return TF_ARG_OPTIONS.map((option, optionIndex) =>
      optionIndex === 0
        ? { ...option, label: `Current TF (${nextLabel})` }
        : option,
    );
  }
  return [];
}

function functionArgLiteralValue(operand = null) {
  if (!operand || typeof operand !== "object") return "";
  return operand.kind === "literal" ? String(operand.value ?? "") : "";
}

export function createEmptyRuleActionDraft(type = "trade", options = {}) {
  const safeType = ACTION_TYPE_OPTIONS.some((item) => item.value === type)
    ? type
    : "trade";
  return {
    id: createNodeId("action"),
    action: safeType,
    color: String(options?.color || "").trim(),
    label: String(options?.label || "").trim(),
    trade_plan:
      safeType === "trade"
        ? {
            direction: normalizeTradeDirection(options?.direction, "buy"),
            type: String(options?.trade_plan?.type || "market").trim().toLowerCase() || "market",
            entry: parsePlanFieldInput(options?.trade_plan?.entry),
            tp: parsePlanFieldInput(options?.trade_plan?.tp),
            sl: parsePlanFieldInput(options?.trade_plan?.sl),
          }
        : undefined,
  };
}

export function normalizeRuleAction(action = {}, ruleName = "") {
  const actionType = String(action?.action || action?.type || "trade").trim();
  const safeType = ACTION_TYPE_OPTIONS.some((item) => item.value === actionType)
    ? actionType
    : "trade";
  return {
    id: String(action?.id || createNodeId("action")).trim() || createNodeId("action"),
    action: safeType,
    color: String(action?.color || "").trim(),
    label: String(action?.label || action?.message || ruleName || "").trim(),
    trade_plan:
      safeType === "trade"
        ? {
            direction: normalizeTradeDirection(action?.trade_plan?.direction, "buy"),
            type:
              String(action?.trade_plan?.type || "market").trim().toLowerCase() || "market",
            entry: parsePlanFieldInput(action?.trade_plan?.entry),
            tp: parsePlanFieldInput(action?.trade_plan?.tp),
            sl: parsePlanFieldInput(action?.trade_plan?.sl),
          }
        : undefined,
  };
}

export function createEmptyRuleDraft(options = {}) {
  const name = normalizeRuleName(options?.name, "Rule");
  return {
    id: String(options?.id || createNodeId("rule")).trim() || createNodeId("rule"),
    name,
    bias: normalizeRuleBias(options?.bias),
    priority: normalizeRulePriority(options?.priority),
    when: options?.when && typeof options.when === "object"
      ? deepClone(options.when)
      : { and: [] },
    actions: Array.isArray(options?.actions) && options.actions.length
      ? options.actions.map((action) => normalizeRuleAction(action, name))
      : [createEmptyRuleActionDraft("trade")],
  };
}

function inferRuleBiasFromName(name = "") {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) return "";
  if (/\b(buy|bull|bullish)\b/.test(normalized)) return "bullish";
  if (/\b(sell|bear|bearish)\b/.test(normalized)) return "bearish";
  return "";
}

export function normalizeRuleDraft(rule = {}) {
  const name = normalizeRuleName(rule?.name || rule?.label, "Rule");
  const normalizedBias = normalizeRuleBias(rule?.bias);
  const inferredBiasFromName = inferRuleBiasFromName(name);
  const inferredBias =
    inferredBiasFromName || normalizedBias;
  return {
    id: String(rule?.id || createNodeId("rule")).trim() || createNodeId("rule"),
    name,
    bias: inferredBias,
    priority: normalizeRulePriority(rule?.priority),
    when:
      rule?.when && typeof rule.when === "object" && !Array.isArray(rule.when)
        ? deepClone(rule.when)
        : { and: [] },
    actions: Array.isArray(rule?.actions) && rule.actions.length
      ? rule.actions.map((action) => normalizeRuleAction(action, name))
      : [],
  };
}

function RuleOperandEditor({
  operand,
  onChange,
  variableOptions,
  placeholder = "Value or variable",
}) {
  const operandKind =
    operand?.kind === "literal" || operand?.kind === "var" ? operand.kind : "literal";
  const operandText =
    operandKind === "literal"
      ? formatLiteralInput(operand?.value)
      : String(operand?.value || "");
  return (
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
      placeholder={placeholder}
      showType={false}
      matchTriggerWidth
      searchable
      searchPlaceholder="Filter variables..."
      style={{ width: "100%", minWidth: 0 }}
    />
  );
}

function RuleConditionEditor({
  node,
  onChange,
  onRemove,
  variableOptions,
  currentTimeframeLabel = "",
  ruleTemplateOptions = [],
}) {
  const draft = ensureConditionDraft(node);
  const isWrapperMode = WRAPPER_FUNCTION_MODES.has(draft.mode);
  const isTemplateMode = draft.mode === "predefined_rule";
  const isFunctionMode = draft.mode !== "compare";
  const functionMeta = getFunctionMeta(draft.functionName);
  const functionArgs = Array.isArray(draft.args) ? draft.args : [];
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 10,
        background: "rgba(255,255,255,0.02)",
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
        <InputComboSelect
          value={resolveSelectValue(draft.mode, CONDITION_MODE_OPTIONS)}
          onChange={(event) =>
            onChange(
              ensureConditionDraft({
                ...draft,
                mode: event.target.value,
                target:
                  WRAPPER_FUNCTION_MODES.has(event.target.value)
                    ? ensureGroupRootDraft(draft.target || makeEmptyConditionDraft())
                    : draft.target,
              }),
            )
          }
          style={{ width: "100%" }}
        >
          {toFlatOptions(CONDITION_MODE_OPTIONS)}
        </InputComboSelect>
        {isTemplateMode ? (
          <>
            <InputComboSelect
              value=""
              searchable
              searchPlaceholder="Filter templates..."
              onChange={(event) => {
                const selected = (Array.isArray(ruleTemplateOptions) ? ruleTemplateOptions : [])
                  .find((item) => String(item.value || "") === String(event.target.value || ""));
                const nextTree = selected?.expression
                  ? buildVisualNodeFromExpression(selected.expression)
                  : selected?.tree;
                if (!nextTree) return;
                onChange(nextTree);
              }}
              style={{ gridColumn: "span 3", width: "100%", minWidth: 0 }}
            >
              <option value="">Select predefined rule...</option>
              {(Array.isArray(ruleTemplateOptions) ? ruleTemplateOptions : []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </InputComboSelect>
          </>
        ) : isFunctionMode ? (
          <>
            {isWrapperMode ? (
              <div
                className="minor-text"
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
                {draft.mode === "is_true"
                  ? "Rule True"
                  : draft.mode === "get_artifacts"
                    ? "GET_ARTIFACTS"
                    : "DRAW"}
              </div>
            ) : (
              <InputComboSelect
                value={resolveSelectValue(draft.functionName, FUNCTION_OPTIONS)}
                searchable
                onChange={(event) => {
                  const functionName = event.target.value;
                  const meta = getFunctionMeta(functionName);
                  onChange(
                    ensureConditionDraft({
                      ...draft,
                      functionName,
                      args: (Array.isArray(meta?.args) ? meta.args : []).map((_, index) =>
                        createDefaultFunctionArg(meta, index),
                      ),
                    }),
                  );
                }}
              >
                {toFlatOptions(FUNCTION_OPTIONS)}
              </InputComboSelect>
            )}
            {isWrapperMode ? (
              <div className="minor-text" style={{ fontSize: 11 }}>
                Nested rule
              </div>
            ) : functionArgs.map((arg, index) => {
              const argMeta = functionArgMeta(functionMeta, index);
              const argOptions = functionArgSelectOptions(
                functionMeta,
                index,
                currentTimeframeLabel,
              );
              if (argOptions.length) {
                return (
                  <InputComboSelect
                    key={`${draft.id}_arg_${index}`}
                    value={resolveSelectValue(functionArgLiteralValue(arg), argOptions)}
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
                    style={{ width: "100%", minWidth: 0 }}
                  >
                    {toFlatOptions(argOptions)}
                  </InputComboSelect>
                );
              }
              return (
                <RuleOperandEditor
                  key={`${draft.id}_arg_${index}`}
                  operand={arg}
                  variableOptions={variableOptions}
                  placeholder={argMeta?.label || `Arg ${index + 1}`}
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
            <RuleOperandEditor
              operand={draft.left}
              variableOptions={variableOptions}
              onChange={(left) => onChange({ ...draft, left })}
            />
            <InputComboSelect
              value={resolveSelectValue(draft.comparator, COMPARATOR_OPTIONS)}
              searchable
              onChange={(event) => onChange({ ...draft, comparator: event.target.value })}
            >
              {toFlatOptions(COMPARATOR_OPTIONS)}
            </InputComboSelect>
            <RuleOperandEditor
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
          title="Remove condition"
        >
          X
        </button>
      </div>
      {isWrapperMode ? (
        <div style={{ marginTop: 10 }}>
          <RuleTreeEditor
            node={draft.target}
            variableOptions={variableOptions}
            ruleTemplateOptions={ruleTemplateOptions}
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
    </div>
  );
}

function RuleTreeEditor({
  node,
  onChange,
  onRemove,
  variableOptions,
  depth = 0,
  currentTimeframeLabel = "",
  ruleTemplateOptions = [],
}) {
  if (!node) return null;
  if (node.type === "condition") {
    return (
      <RuleConditionEditor
        node={node}
        onChange={onChange}
        onRemove={onRemove}
        variableOptions={variableOptions}
        currentTimeframeLabel={currentTimeframeLabel}
        ruleTemplateOptions={ruleTemplateOptions}
      />
    );
  }
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 12,
        background: depth === 0 ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.02)",
      }}
    >
      <div className="stack-layout" style={{ gap: 10 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <InputComboSelect
              value={resolveSelectValue(node?.operator, LOGIC_OPTIONS)}
              onChange={(event) => onChange({ ...node, operator: event.target.value })}
              style={{ minWidth: 112 }}
            >
              {toFlatOptions(LOGIC_OPTIONS)}
            </InputComboSelect>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onChange(appendGroupChild(node, { childType: "condition" }))}
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
            <button type="button" className="danger-button" onClick={onRemove}>
              X
            </button>
          ) : null}
        </div>
        <div className="stack-layout" style={{ gap: 8 }}>
          {(node.children || []).length ? (
            node.children.map((child) => (
              <RuleTreeEditor
                key={child.id}
                node={child}
                variableOptions={variableOptions}
                depth={depth + 1}
                currentTimeframeLabel={currentTimeframeLabel}
                ruleTemplateOptions={ruleTemplateOptions}
                onChange={(nextChild) =>
                  onChange(updateTreeNode(node, child.id, () => nextChild))
                }
                onRemove={() =>
                  onChange(removeTreeNode(node, child.id) || makeEmptyGroupDraft(node.operator))
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
  );
}

function RuleActionRow({
  action,
  ruleName,
  variableOptions,
  onChange,
  onRemove,
}) {
  const normalizedAction = normalizeRuleAction(action, ruleName);
  const actionType = String(normalizedAction.action || "trade").trim();
  const isTradeAction = actionType === "trade";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isTradeAction
          ? "minmax(112px, 120px) minmax(84px, 0.8fr) minmax(84px, 0.8fr) minmax(140px, 1fr) minmax(140px, 1fr) minmax(140px, 1fr) 32px"
          : "minmax(112px, 120px) minmax(120px, 0.8fr) minmax(0, 1fr) 32px",
        gap: 10,
        alignItems: "center",
      }}
    >
      <InputComboSelect
        value={resolveSelectValue(actionType, ACTION_TYPE_OPTIONS)}
        onChange={(event) =>
          onChange(
            normalizeRuleAction(
              {
                ...normalizedAction,
                action: event.target.value,
                trade_plan:
                  event.target.value === "trade" ? normalizedAction.trade_plan : undefined,
              },
              ruleName,
            ),
          )
        }
        style={{ width: "100%" }}
      >
        {toFlatOptions(ACTION_TYPE_OPTIONS)}
      </InputComboSelect>
      {isTradeAction ? (
        <>
          <InputComboSelect
            value={resolveSelectValue(
              normalizedAction?.trade_plan?.direction,
              TRADE_DIRECTION_OPTIONS,
            )}
            onChange={(event) =>
              onChange(
                normalizeRuleAction(
                  {
                    ...normalizedAction,
                    trade_plan: {
                      ...normalizedAction.trade_plan,
                      direction: event.target.value,
                    },
                  },
                  ruleName,
                ),
              )
            }
          >
            {toFlatOptions(TRADE_DIRECTION_OPTIONS)}
          </InputComboSelect>
          <InputComboSelect
            value={resolveSelectValue(
              normalizedAction?.trade_plan?.type,
              TRADE_TYPE_OPTIONS,
            )}
            onChange={(event) =>
              onChange(
                normalizeRuleAction(
                  {
                    ...normalizedAction,
                    trade_plan: {
                      ...normalizedAction.trade_plan,
                      type: event.target.value,
                    },
                  },
                  ruleName,
                ),
              )
            }
          >
            {toFlatOptions(TRADE_TYPE_OPTIONS)}
          </InputComboSelect>
          {["entry", "tp", "sl"].map((fieldKey) => (
            <InputComboSelect
              key={fieldKey}
              text={formatPlanFieldInput(normalizedAction?.trade_plan?.[fieldKey])}
              items={variableOptions}
              type={isPlanFieldParamType(normalizedAction?.trade_plan?.[fieldKey]) ? "param" : "value"}
              onChange={({ text, type }) =>
                onChange(
                  normalizeRuleAction(
                    {
                      ...normalizedAction,
                      trade_plan: {
                        ...normalizedAction.trade_plan,
                        [fieldKey]: parsePlanFieldInput(text),
                      },
                    },
                    ruleName,
                  ),
                )
              }
              placeholder={`${fieldKey.toUpperCase()} / var`}
              showType={false}
              searchable
              searchPlaceholder="Filter variables..."
              style={{ width: "100%", minWidth: 0, height: 36 }}
            />
          ))}
        </>
      ) : (
        <>
          <input
            className="input"
            value={normalizedAction.color || ""}
            onChange={(event) =>
              onChange(
                normalizeRuleAction(
                  { ...normalizedAction, color: event.target.value },
                  ruleName,
                ),
              )
            }
            placeholder="Color"
          />
          <input
            className="input"
            value={normalizedAction.label || ruleName || ""}
            onChange={(event) =>
              onChange(
                normalizeRuleAction(
                  { ...normalizedAction, label: event.target.value },
                  ruleName,
                ),
              )
            }
            placeholder="Label"
          />
        </>
      )}
      <button type="button" className="danger-button" onClick={onRemove}>
        X
      </button>
    </div>
  );
}

export default function RuleBuilder({
  rule,
  onChange,
  onRemove = null,
  variableOptions = [],
  ruleTemplates = [],
  showName = true,
  showMeta = true,
  showActions = true,
  currentTimeframeLabel = "",
}) {
  const normalizedRule = useMemo(() => normalizeRuleDraft(rule), [rule]);
  const tree = useMemo(
    () => ensureGroupRootDraft(buildVisualNodeFromExpression(normalizedRule.when) || makeEmptyGroupDraft("and")),
    [normalizedRule.when],
  );
  const unsupportedExpression = useMemo(
    () => !buildVisualNodeFromExpression(normalizedRule.when),
    [normalizedRule.when],
  );
  const ruleTemplateOptions = useMemo(
    () =>
      (Array.isArray(ruleTemplates) ? ruleTemplates : [])
        .map((template, index) => {
          const expression =
            template?.condition && typeof template.condition === "object"
              ? template.condition
              : template?.when && typeof template.when === "object"
                ? template.when
                : null;
          if (!expression || !buildVisualNodeFromExpression(expression)) return null;
          const label = String(
            template?.name ||
              template?.short_name ||
              template?.abbr ||
              template?.id ||
              `Rule ${index + 1}`,
          ).trim();
          const sourceLabel = template?.kind === "custom" ? "Custom" : "Predefined";
          return {
            value: String(template?.id || template?.abbr || `rule_${index}`),
            label: `${label || `Rule ${index + 1}`} (${sourceLabel})`,
            expression,
          };
        })
        .filter(Boolean),
    [ruleTemplates],
  );

  const updateRule = (patch) => {
    onChange?.(normalizeRuleDraft({ ...normalizedRule, ...patch }));
  };

  return (
    <div
      className="form-item"
    >
      <div className="stack-layout" style={{ gap: 12 }}>
        {(showName || showMeta || onRemove) ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "52px minmax(0, 1fr)",
              gap: 8,
              alignItems: "start",
            }}
          >
            <span className="minor-text" style={{ fontSize: 10 }}>
              Name
            </span>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: showName && showMeta
                  ? "minmax(0, 1.4fr) minmax(160px, 0.7fr) minmax(160px, 0.7fr) auto"
                  : showName
                    ? "minmax(0, 1fr) auto"
                    : showMeta
                      ? "minmax(160px, 0.7fr) minmax(160px, 0.7fr) auto"
                      : "auto",
                gap: 10,
                alignItems: "center",
              }}
            >
              {showName ? (
                <input
                  className="input"
                  value={normalizedRule.name}
                  onChange={(event) => updateRule({ name: event.target.value })}
                  placeholder="Rule name"
                />
              ) : null}
              {showMeta ? (
                <>
                  <InputComboSelect
                    value={resolveSelectValue(normalizedRule.bias, RULE_BIAS_OPTIONS)}
                    onChange={(event) => updateRule({ bias: event.target.value })}
                  >
                    {toFlatOptions(RULE_BIAS_OPTIONS)}
                  </InputComboSelect>
                  <InputComboSelect
                    value={resolveSelectValue(normalizedRule.priority, RULE_PRIORITY_OPTIONS)}
                    onChange={(event) => updateRule({ priority: event.target.value })}
                  >
                    {toFlatOptions(RULE_PRIORITY_OPTIONS)}
                  </InputComboSelect>
                </>
              ) : null}
              {onRemove ? (
                <button type="button" className="danger-button" onClick={onRemove}>
                  X
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {unsupportedExpression ? (
          <div className="minor-text" style={{ color: "#fca5a5", fontSize: 11 }}>
            This rule expression is not fully supported by the visual editor yet. Editing here will replace it with the current visual tree.
          </div>
        ) : null}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "52px minmax(0, 1fr)",
            gap: 8,
            alignItems: "start",
          }}
        >
          <span className="minor-text" style={{ fontSize: 10 }}>
            Rules
          </span>
          <RuleTreeEditor
            node={tree}
            variableOptions={variableOptions}
            ruleTemplateOptions={ruleTemplateOptions}
            currentTimeframeLabel={currentTimeframeLabel}
            onChange={(nextNode) =>
              updateRule({ when: buildExpressionFromVisualNode(nextNode) || { and: [] } })
            }
            onRemove={null}
          />
        </div>
        {showActions ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "52px minmax(0, 1fr)",
              gap: 8,
              alignItems: "start",
            }}
          >
            <span className="minor-text" style={{ fontSize: 10 }}>
              Actions
            </span>
            <div className="stack-layout" style={{ gap: 8 }}>
              {(Array.isArray(normalizedRule.actions) ? normalizedRule.actions : []).map((action) => (
                <RuleActionRow
                  key={action.id}
                  action={action}
                  ruleName={normalizedRule.name}
                  variableOptions={variableOptions}
                  onChange={(nextAction) =>
                    updateRule({
                      actions: normalizedRule.actions.map((entry) =>
                        entry.id === action.id ? nextAction : entry,
                      ),
                    })
                  }
                  onRemove={() =>
                    updateRule({
                      actions: normalizedRule.actions.filter((entry) => entry.id !== action.id),
                    })
                  }
                />
              ))}
              <button
                type="button"
                className="secondary-button"
                style={{ minWidth: 156, minHeight: 36, height: 36, padding: "0 16px" }}
                onClick={() =>
                  updateRule({
                    actions: [
                      ...(Array.isArray(normalizedRule.actions) ? normalizedRule.actions : []),
                      createEmptyRuleActionDraft(
                        String(normalizedRule.actions?.[normalizedRule.actions.length - 1]?.action || "trade"),
                        { label: normalizedRule.name },
                      ),
                    ],
                  })
                }
              >
                Add Action
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
