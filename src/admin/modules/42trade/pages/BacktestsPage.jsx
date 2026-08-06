import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../../../app/api";
import BacktestBarsSelector from "../components/BacktestBarsSelector";
import RuleBuilder, {
  createEmptyRuleDraft,
  normalizeRuleDraft,
} from "../components/RuleBuilder";
import StrategyEditorPanel from "../components/StrategyEditorPanel";
import SymbolChart from "../components/charts/SymbolChart";
import PageHeader from "../../../shared/components/PageHeader";
import MasterDetailLayout from "../../../shared/components/MasterDetailLayout";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import ListItems from "../../../shared/components/ListItems";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import TabBar from "../../../shared/components/TabBar";
import { useConfirmDialog } from "../../../shared/components/ConfirmDialog";
import useIsMobile from "../../../shared/hooks/useIsMobile.js";
import strategyFunctions from "../../../../config/strategyFunctions.json";
import { deriveBacktestFormFromRun } from "../../../shared/utils/backtestForm";
import {
  buildRuleVariableOptions,
  buildRuleVariableValues,
} from "../../../shared/utils/ruleVariableOptions";
import { SYSTEM_SYMBOL_GROUP_PRESETS } from "../../../../config/symbolGroups.js";
import {
  mergeStrategiesById,
  normalizeStrategyCatalog,
} from "../../../shared/utils/strategyCatalog";
import TradePriceInline from "../components/TradePriceInline";
import { listPredefinedRules } from "../../../../shared/rules-engine/predefinedRules.js";

function formatNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(digits);
}

function timeframeLabel(tfRaw) {
  const tf = String(tfRaw || "").trim().toLowerCase();
  if (!tf) return "-";
  if (tf === "multi" || tf === "mixed") return "Multi TF";
  if (tf === "1" || tf === "1m") return "1m";
  if (tf === "5" || tf === "5m") return "5m";
  if (tf === "15" || tf === "15m") return "15m";
  if (tf === "60" || tf === "1h") return "1h";
  if (tf === "240" || tf === "4h") return "4h";
  if (tf === "1440" || tf === "1d") return "1d";
  return String(tfRaw || "-");
}

const BACKTEST_TF_SEQUENCE = ["1m", "5m", "15m", "1h", "4h", "1d"];
const BACKTEST_TF_MATRIX_SEQUENCE = ["1d", "4h", "1h", "15m", "5m", "1m"];
const BACKTEST_TRADES_RENDER_STEP = 120;

function higherBacktestTimeframes(tfRaw = "") {
  const normalizedTf = timeframeLabel(tfRaw);
  const startIndex = BACKTEST_TF_SEQUENCE.indexOf(normalizedTf);
  if (startIndex < 0) return [];
  return BACKTEST_TF_SEQUENCE.slice(startIndex + 1);
}

function sortBacktestMatrixTimeframes(timeframes = []) {
  const unique = [
    ...new Set(
      (Array.isArray(timeframes) ? timeframes : []).map((tf) => timeframeLabel(tf)),
    ),
  ];
  return unique.sort((left, right) => {
    const leftIndex = BACKTEST_TF_MATRIX_SEQUENCE.indexOf(timeframeLabel(left));
    const rightIndex = BACKTEST_TF_MATRIX_SEQUENCE.indexOf(timeframeLabel(right));
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
    if (leftIndex >= 0) return -1;
    if (rightIndex >= 0) return 1;
    return String(left).localeCompare(String(right));
  });
}

function strategyStatusMeta(strategy = {}) {
  const status = String(strategy?.status || "active").trim().toLowerCase();
  if (status === "inactive" || status === "draft" || status === "archived") {
    return {
      badge: "INACTIVE",
      text: "inactive",
      color: "#f59e0b",
      background: "rgba(245,158,11,0.12)",
      border: "rgba(245,158,11,0.32)",
    };
  }
  return {
    badge: "ACTIVE",
    text: "active",
    color: "#22c55e",
    background: "rgba(34,197,94,0.12)",
    border: "rgba(34,197,94,0.32)",
  };
}

function formatStrategyOptionLabel(strategy = {}) {
  const name = String(strategy?.name || strategy?.key || strategy?.id || "Strategy").trim();
  const status = String(strategy?.status || "").trim().toLowerCase();
  if (status === "inactive" || status === "draft" || status === "archived") {
    return `${name} (Inactive)`;
  }
  if (status === "active") return `${name} (Active)`;
  return name;
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

function tradeTimeframeKey(trade = {}) {
  return timeframeLabel(trade?.tf || trade?.timeframe || "");
}

function tradeStrategyKey(trade = {}) {
  return String(
    trade?.strategy_id ||
      trade?.strategy_key ||
      trade?.strategy ||
      trade?.strategy_name ||
      "",
  ).trim();
}

const LEFT_TABS = [
  { value: "backtest", label: "Backtest" },
  { value: "history", label: "History" },
  { value: "rules", label: "Rules" },
  { value: "strategies", label: "Strategies" },
];

const DEFAULT_EDIT_STRATEGY_ID = "price_action_fvg_context_v1";
const DEFAULT_BACKTEST_STRATEGY_ID = "ema_cross_v1";

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

const RULE_LOGIC_OPTIONS = [
  { value: "and", label: "AND" },
  { value: "or", label: "OR" },
  { value: "then", label: "THEN" },
];

const RULE_MODE_OPTIONS = [
  { value: "compare", label: "Compare" },
  { value: "if_true", label: "If True" },
  { value: "if_not", label: "If Not" },
  { value: "predefined_rule", label: "Predefined Rule" },
];

const HISTORY_STRATEGY_FILTER_ALL = "__all__";

const RULE_COMPARE_OPTIONS = (Array.isArray(strategyFunctions?.operators)
  ? strategyFunctions.operators
  : []
)
  .filter((item) => item?.category === "comparator")
  .map((item) => ({
    value: String(item?.value || "").trim(),
    label: String(item?.label || item?.value || "").trim(),
  }))
  .filter((item) => item.value && item.value !== "var");

const RULE_FUNCTION_OPTIONS = (Array.isArray(strategyFunctions?.functions)
  ? strategyFunctions.functions
  : []
)
  .filter((item) => item?.kind === "predicate")
  .filter((item) => !["is_true", "get_artifacts", "draw"].includes(String(item?.value || "").trim()))
  .map((item) => ({
    value: String(item?.value || "").trim(),
    label: String(item?.label || item?.value || "").trim(),
    args: Array.isArray(item?.args) ? item.args : [],
  }))
  .filter((item) => item.value);

const RULE_TEST_INDICATORS = [
  { id: "ema_fast", type: "ema", source: "close", length: 20 },
  { id: "ema_slow", type: "ema", source: "close", length: 50 },
  { id: "rsi_14", type: "rsi", source: "close", length: 14 },
  { id: "highest_high_20", type: "highest_high", source: "high", length: 20 },
  { id: "lowest_low_20", type: "lowest_low", source: "low", length: 20 },
];

const RULE_DEFAULT_VARIABLE_OPTIONS = buildRuleVariableOptions({
  indicators: RULE_TEST_INDICATORS,
});

const RULE_DEFAULT_VARIABLE_VALUES = buildRuleVariableValues({
  indicators: RULE_TEST_INDICATORS,
});

function createRuleTestNodeId(prefix = "rule") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function createRuleTestCondition() {
  return {
    id: createRuleTestNodeId("condition"),
    type: "condition",
    mode: "compare",
    left: "bar.close",
    comparator: ">",
    right: "indicators.ema_fast",
    functionName: "touches",
    args: {},
  };
}

function createRuleTestGroup(operator = "and") {
  return {
    id: createRuleTestNodeId("group"),
    type: "group",
    operator,
    children: [createRuleTestCondition()],
  };
}

function createRuleTestGroupWithChildren(operator = "and", children = []) {
  const normalizedChildren = Array.isArray(children) ? children.filter(Boolean) : [];
  return {
    id: createRuleTestNodeId("group"),
    type: "group",
    operator,
    children: normalizedChildren.length ? normalizedChildren : [createRuleTestCondition()],
  };
}

function parseRuleLiteral(rawValue = "") {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return { var: "" };
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  const numberValue = Number(raw);
  if (Number.isFinite(numberValue) && `${numberValue}` === raw.replace(/^0+(\d)/, "$1")) {
    return numberValue;
  }
  return { var: raw };
}

function buildRuleOperand(rawValue = "") {
  const parsed = parseRuleLiteral(rawValue);
  return parsed;
}

function buildRuleFunctionArgOperand(argKey = "", rawValue = "") {
  const normalizedKey = String(argKey || "").trim().toLowerCase();
  if (normalizedKey === "bias" || normalizedKey === "tf") {
    return String(rawValue ?? "").trim();
  }
  return buildRuleOperand(rawValue);
}

function buildRuleExpressionFromDraft(node) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "group") {
    const operator = String(node.operator || "and").trim().toLowerCase();
    const children = (Array.isArray(node.children) ? node.children : [])
      .map((child) => buildRuleExpressionFromDraft(child))
      .filter(Boolean);
    if (!children.length) return null;
    return { [operator]: children };
  }
  if (node.type === "condition") {
    const mode = String(node.mode || "compare").trim().toLowerCase();
    if (mode === "compare") {
      return {
        [String(node.comparator || ">").trim() || ">"]: [
          buildRuleOperand(node.left),
          buildRuleOperand(node.right),
        ],
      };
    }
    const functionName = String(node.functionName || "").trim();
    if (!functionName) return null;
    const functionMeta =
      RULE_FUNCTION_OPTIONS.find((item) => item.value === functionName) || null;
    const args = (Array.isArray(functionMeta?.args) ? functionMeta.args : []).map((arg) => {
      const argKey = String(arg?.key || "").trim();
      return buildRuleFunctionArgOperand(
        argKey,
        node?.args?.[argKey] ?? "",
      );
    });
    const expression = { fn: functionName, args };
    return mode === "if_not" ? { not: expression } : expression;
  }
  return null;
}

function buildRuleDraftFromOperand(value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Object.prototype.hasOwnProperty.call(value, "var")
  ) {
    return String(value.var || "");
  }
  if (value === null) return "null";
  if (value === undefined) return "";
  return String(value);
}

function buildRuleDraftFromExpression(expression) {
  if (!expression || typeof expression !== "object" || Array.isArray(expression)) return null;
  if (Object.keys(expression).length !== 1 && typeof expression.fn !== "string") return null;
  if (typeof expression.fn === "string") {
    const functionName = String(expression.fn || "").trim();
    if (!functionName) return null;
    const functionMeta =
      RULE_FUNCTION_OPTIONS.find((item) => item.value === functionName) || null;
    const args = {};
    (Array.isArray(functionMeta?.args) ? functionMeta.args : []).forEach((arg, index) => {
      const argKey = String(arg?.key || "").trim();
      args[argKey] = buildRuleDraftFromOperand(
        Array.isArray(expression.args) ? expression.args[index] : "",
      );
    });
    return {
      id: createRuleTestNodeId("condition"),
      type: "condition",
      mode: "if_true",
      functionName,
      args,
      left: "bar.close",
      comparator: ">",
      right: "bar.open",
    };
  }
  const [operator, rawValue] = Object.entries(expression)[0];
  if (operator === "not") {
    const nested = buildRuleDraftFromExpression(rawValue);
    if (!nested || nested.type !== "condition") return nested;
    return {
      ...nested,
      mode: nested.mode === "compare" ? "if_not" : "if_not",
    };
  }
  if (["and", "or", "then"].includes(operator)) {
    const children = (Array.isArray(rawValue) ? rawValue : [rawValue])
      .map((item) => buildRuleDraftFromExpression(item))
      .filter(Boolean);
    return createRuleTestGroupWithChildren(operator, children);
  }
  if (RULE_COMPARE_OPTIONS.some((item) => item.value === operator)) {
    const pair = Array.isArray(rawValue) ? rawValue : [rawValue];
    return {
      id: createRuleTestNodeId("condition"),
      type: "condition",
      mode: "compare",
      left: buildRuleDraftFromOperand(pair[0]),
      comparator: operator,
      right: buildRuleDraftFromOperand(pair[1]),
      functionName: "touches",
      args: {},
    };
  }
  return null;
}

function createRuleTestStrategy({
  symbol = "",
  tf = "",
  ruleTree = null,
  ruleName = "Rule",
  ruleAbbr = "",
  ruleBias = "neutral",
} = {}) {
  const when = buildRuleExpressionFromDraft(ruleTree);
  if (!when) return null;
  const normalizedTf = String(tf || "").trim();
  const chartTf = timeframeLabel(normalizedTf);
  const normalizedBias = String(ruleBias || "neutral").trim().toLowerCase();
  const markerLabel = String(ruleAbbr || inferRuleAbbr(ruleName)).trim() || "RULE";
  const drawColor =
    normalizedBias === "bullish"
      ? "#22c55e"
      : normalizedBias === "bearish"
        ? "#ef4444"
        : "";
  return {
    id: "rules_tester_preview",
    key: "rules_tester_preview",
    name: "Rules Tester",
    kind: "custom",
    market: {
      symbol: String(symbol || "").trim().toUpperCase(),
      tf: chartTf,
    },
    indicators: RULE_TEST_INDICATORS,
    metadata: {
      preview_current_bar_only: false,
    },
    events: [
      {
        id: normalizeCustomRuleConfigId(ruleAbbr || ruleName || "rules_test_event", "rules_test_event"),
        name: String(ruleName || "Rule").trim() || "Rule",
        abbr: markerLabel,
        bias: normalizedBias,
        when,
        actions: [
          {
            id: "rules_test_draw",
            action: "draw",
            label: markerLabel,
            color: drawColor,
          },
        ],
      },
    ],
  };
}

function ensureRuleTestRootGroup(tree) {
  if (!tree || typeof tree !== "object") {
    return createRuleTestGroup("and");
  }
  if (tree.type === "group") return tree;
  return createRuleTestGroupWithChildren("and", [tree]);
}

function cloneRuleTestTreeWithFreshIds(node) {
  if (!node || typeof node !== "object") return node;
  if (node.type === "group") {
    return {
      ...node,
      id: createRuleTestNodeId("group"),
      children: (Array.isArray(node.children) ? node.children : [])
        .map((child) => cloneRuleTestTreeWithFreshIds(child))
        .filter(Boolean),
    };
  }
  if (node.type === "condition") {
    return {
      ...node,
      id: createRuleTestNodeId("condition"),
    };
  }
  return cloneJson(node);
}

function buildRuleLibraryEntry({
  id = "",
  label = "",
  source = "popular",
  tree = null,
  symbol = "",
  tf = "",
  rule = null,
}) {
  return {
    id: String(id || label || createRuleTestNodeId("library")).trim(),
    label: String(label || id || "Rule").trim() || "Rule",
    source: String(source || "popular").trim(),
    tree,
    symbol: String(symbol || "").trim().toUpperCase(),
    tf: String(tf || "").trim(),
    rule_id: String(rule?.id || "").trim(),
    abbr: String(rule?.abbr || rule?.short_name || "").trim(),
    name: String(rule?.name || label || "").trim(),
    icon: String(rule?.icon || "").trim(),
    family: String(rule?.family || "").trim(),
    outputs: rule?.outputs && typeof rule.outputs === "object" ? cloneJson(rule.outputs) : undefined,
  };
}

function buildRuleLibraryEntryFromCatalogRule(rule = {}) {
  const condition =
    rule?.condition && typeof rule.condition === "object" && !Array.isArray(rule.condition)
      ? rule.condition
      : rule?.when && typeof rule.when === "object" && !Array.isArray(rule.when)
        ? rule.when
        : null;
  const tree = buildRuleDraftFromExpression(condition);
  if (!tree) return null;
  return buildRuleLibraryEntry({
    id: `catalog_${String(rule?.kind || "predefined")}_${String(rule?.id || rule?.abbr || rule?.name || "")}`,
    label: String(rule?.abbr || rule?.short_name || rule?.name || rule?.id || "Rule").trim(),
    source: String(rule?.kind || "predefined").trim() || "predefined",
    tree,
    rule,
  });
}

function normalizeCustomRuleConfigId(value = "", fallback = "custom_rule") {
  const normalized = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized.length >= 3 ? normalized : fallback;
}

function inferRuleAbbr(value = "", fallback = "RULE") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const compact = raw
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  if (compact && compact.length <= 16) return compact;
  const initials = raw
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .join("")
    .toUpperCase();
  return (initials || compact || fallback).slice(0, 16);
}

function buildRuleConfigSavePayload(rule = {}) {
  const normalizedRule = normalizeRuleDraft(rule);
  const name = String(normalizedRule.name || "Custom Rule").trim() || "Custom Rule";
  const id = normalizeCustomRuleConfigId(
    normalizedRule.id && !String(normalizedRule.id).startsWith("rule_")
      ? normalizedRule.id
      : name,
    "custom_rule",
  );
  const abbr = inferRuleAbbr(normalizedRule.abbr || name);
  return {
    id,
    abbr,
    name,
    icon: String(normalizedRule.icon || "sparkles").trim() || "sparkles",
    family: String(normalizedRule.family || "custom").trim() || "custom",
    params: {},
    condition: normalizedRule.when,
    outputs: {
      ...(normalizedRule.outputs || {}),
      bias: normalizedRule.bias || normalizedRule.outputs?.bias || "neutral",
    },
  };
}

function stripRuleActions(rule = {}) {
  const normalizedRule =
    !rule || typeof rule !== "object" || Array.isArray(rule)
      ? normalizeRuleDraft({ name: "Rule Test", actions: [] })
      : normalizeRuleDraft(rule);
  const { actions: _actions, ...rest } = normalizedRule;
  return rest;
}

function updateRuleTreeNode(node, targetId, updater) {
  if (!node || typeof node !== "object") return node;
  if (String(node.id || "") === String(targetId || "")) {
    return updater(node);
  }
  if (node.type !== "group") return node;
  return {
    ...node,
    children: (Array.isArray(node.children) ? node.children : []).map((child) =>
      updateRuleTreeNode(child, targetId, updater),
    ),
  };
}

function removeRuleTreeNode(node, targetId) {
  if (!node || typeof node !== "object" || node.type !== "group") return node;
  const nextChildren = (Array.isArray(node.children) ? node.children : [])
    .filter((child) => String(child?.id || "") !== String(targetId || ""))
    .map((child) => (child?.type === "group" ? removeRuleTreeNode(child, targetId) : child));
  return {
    ...node,
    children: nextChildren.length ? nextChildren : [createRuleTestCondition()],
  };
}

function RuleTestConditionEditor({
  node,
  onChange,
  onRemove,
  ruleTemplateItems = [],
}) {
  const functionMeta =
    RULE_FUNCTION_OPTIONS.find((item) => item.value === String(node?.functionName || "").trim()) || null;
  const mode = String(node?.mode || "compare");
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px minmax(0, 1fr) 140px minmax(0, 1fr) 40px",
        gap: 8,
        alignItems: "center",
      }}
    >
      <InputComboSelect
        value={mode}
        onChange={(event) =>
          onChange({
            ...node,
            mode: String(event.target.value || "compare"),
          })
        }
      >
        {RULE_MODE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </InputComboSelect>
      {mode === "compare" ? (
        <>
          <InputComboSelect
            value={String(node?.left || "")}
            onChange={(event) => onChange({ ...node, left: event.target.value })}
            searchable
            searchPlaceholder="Filter..."
          >
            {RULE_DEFAULT_VARIABLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </InputComboSelect>
          <InputComboSelect
            value={String(node?.comparator || ">")}
            onChange={(event) => onChange({ ...node, comparator: event.target.value })}
          >
            {RULE_COMPARE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </InputComboSelect>
          <InputComboSelect
            value={String(node?.right || "")}
            onChange={(event) => onChange({ ...node, right: event.target.value })}
            searchable
            searchPlaceholder="Filter..."
          >
            {RULE_DEFAULT_VARIABLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </InputComboSelect>
        </>
      ) : mode === "predefined_rule" ? (
        <>
          <InputComboSelect
            value=""
            searchable
            searchPlaceholder="Filter templates..."
            onChange={(event) => {
              const selected = (Array.isArray(ruleTemplateItems) ? ruleTemplateItems : [])
                .find((item) => String(item.id || "") === String(event.target.value || ""));
              if (!selected?.tree) return;
              onChange(cloneRuleTestTreeWithFreshIds(cloneJson(selected.tree)));
            }}
            style={{ gridColumn: "span 3", width: "100%" }}
          >
            <option value="">Select predefined rule...</option>
            {(Array.isArray(ruleTemplateItems) ? ruleTemplateItems : []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </InputComboSelect>
        </>
      ) : (
        <>
          <InputComboSelect
            value={String(node?.functionName || "touches")}
            onChange={(event) => {
              const nextFunctionName = String(event.target.value || "touches");
              const nextMeta =
                RULE_FUNCTION_OPTIONS.find((item) => item.value === nextFunctionName) || null;
              const nextArgs = {};
              (Array.isArray(nextMeta?.args) ? nextMeta.args : []).forEach((arg) => {
                nextArgs[String(arg?.key || "").trim()] = "";
              });
              onChange({
                ...node,
                functionName: nextFunctionName,
                args: nextArgs,
              });
            }}
          >
            {RULE_FUNCTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </InputComboSelect>
          <div
            style={{
              display: "grid",
              gridColumn: "span 2",
              gridTemplateColumns: `repeat(${Math.max(1, Math.min(2, functionMeta?.args?.length || 1))}, minmax(0, 1fr))`,
              gap: 8,
            }}
          >
            {(Array.isArray(functionMeta?.args) ? functionMeta.args : []).map((arg) => {
              const argKey = String(arg?.key || "").trim();
              return (
                <InputComboSelect
                  key={argKey}
                  value={String(node?.args?.[argKey] ?? "")}
                  onChange={(event) =>
                    onChange({
                      ...node,
                      args: {
                        ...(node?.args && typeof node.args === "object" ? node.args : {}),
                        [argKey]: event.target.value,
                      },
                    })
                  }
                  searchable
                  searchPlaceholder={arg?.label || argKey}
                >
                  {argKey === "bias" ? (
                    <>
                      <option value="">Any Bias</option>
                      <option value="bullish">Bullish</option>
                      <option value="bearish">Bearish</option>
                    </>
                  ) : argKey === "tf" ? (
                    <>
                      <option value="">Current TF</option>
                      <option value="all">All TFs</option>
                      {TIMEFRAME_OPTIONS.map((option) => (
                        <option key={option.value} value={timeframeLabel(option.value)}>
                          {option.label}
                        </option>
                      ))}
                    </>
                  ) : (
                    <>
                      <option value="">Any</option>
                      {RULE_DEFAULT_VARIABLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </>
                  )}
                </InputComboSelect>
              );
            })}
          </div>
        </>
      )}
      <button
        type="button"
        className="secondary-button"
        onClick={onRemove}
        style={{ minWidth: 36, color: "#ef4444", borderColor: "rgba(239,68,68,0.35)" }}
        title="Remove condition"
      >
        X
      </button>
    </div>
  );
}

function RuleTestGroupEditor({
  node,
  onChange,
  isRoot = false,
  ruleTemplateItems = [],
}) {
  if (!node || node.type !== "group") return null;
  return (
    <div
      style={{
        border: "1px solid rgba(148,163,184,0.18)",
        borderRadius: 12,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {!isRoot ? <span className="minor-text">Group</span> : <span className="minor-text">Rule</span>}
        <InputComboSelect
          value={String(node.operator || "and")}
          onChange={(event) =>
            onChange({
              ...node,
              operator: String(event.target.value || "and"),
            })
          }
          style={{ width: 110 }}
        >
          {RULE_LOGIC_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </InputComboSelect>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            onChange({
              ...node,
              children: [...(Array.isArray(node.children) ? node.children : []), createRuleTestCondition()],
            })
          }
          style={{ minHeight: 30, padding: "0 10px", fontSize: 11 }}
        >
          + Condition
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            onChange({
              ...node,
              children: [...(Array.isArray(node.children) ? node.children : []), createRuleTestGroup("and")],
            })
          }
          style={{ minHeight: 30, padding: "0 10px", fontSize: 11 }}
        >
          + Group
        </button>
      </div>
      {(Array.isArray(node.children) ? node.children : []).map((child) =>
        child?.type === "group" ? (
          <RuleTestGroupEditor
            key={child.id}
            node={child}
            ruleTemplateItems={ruleTemplateItems}
            onChange={(nextChild) => onChange(updateRuleTreeNode(node, child.id, () => nextChild))}
          />
        ) : (
          <RuleTestConditionEditor
            key={child?.id}
            node={child}
            onChange={(nextChild) =>
              onChange(updateRuleTreeNode(node, child.id, () => nextChild))
            }
            onRemove={() => onChange(removeRuleTreeNode(node, child.id))}
            ruleTemplateItems={ruleTemplateItems}
          />
        ),
      )}
    </div>
  );
}

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

function runMatchesStrategySelection(run = {}, strategyIds = []) {
  const selectedIds = new Set(
    normalizeSelectionList(strategyIds).map((value) => String(value || "").trim()),
  );
  if (!selectedIds.size) return true;
  const runIds = new Set(
    [
      run?.strategy_key,
      run?.strategy_id,
      run?.strategy_name,
      ...(Array.isArray(run?.selection?.strategy_ids) ? run.selection.strategy_ids : []),
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  if (!runIds.size) return false;
  for (const value of runIds) {
    if (selectedIds.has(value)) return true;
  }
  return false;
}

function formatRunSelectorLabel(run = {}) {
  if (run?.batch_mix) {
    const strategyCount = Array.isArray(run?.selection?.strategy_ids)
      ? run.selection.strategy_ids.length
      : 0;
    const timeframeCount = Array.isArray(run?.selection?.timeframes)
      ? run.selection.timeframes.length
      : 0;
    const symbolCount = Array.isArray(run?.selection?.symbols)
      ? run.selection.symbols.length
      : 0;
    const scopeParts = [
      strategyCount ? `${strategyCount} strategies` : "",
      timeframeCount ? `${timeframeCount} TFs` : "",
      symbolCount ? `${symbolCount} symbols` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const rangeLabel = formatBacktestDataRange(run);
    return `Batch Mix${scopeParts ? ` - ${scopeParts}` : ""}${rangeLabel ? ` - ${rangeLabel}` : ""}`;
  }
  const strategyLabel = String(run?.strategy_name || run?.strategy_key || "Run")
    .trim();
  const tfLabel = timeframeLabel(run?.tf);
  const symbolLabel = String(run?.symbol || "-").trim() || "-";
  const rangeLabel = formatBacktestDataRange(run);
  return `${strategyLabel} - ${tfLabel} - ${symbolLabel}${rangeLabel ? ` - ${rangeLabel}` : ""}`;
}

function buildEphemeralRunSaveName(result = {}) {
  const run = result?.run && typeof result.run === "object" ? result.run : {};
  if (run?.batch_mix) {
    const strategyCount = Array.isArray(run?.selection?.strategy_ids)
      ? run.selection.strategy_ids.length
      : 0;
    const timeframeCount = Array.isArray(run?.selection?.timeframes)
      ? run.selection.timeframes.length
      : 0;
    return `Batch Mix ${strategyCount || 1} Strategies ${timeframeCount || 1} TFs`;
  }
  return (
    formatRunSelectorLabel(run) ||
    String(run?.run_id || "backtest_run").trim() ||
    "backtest_run"
  );
}

function strategyIdFromLocation(location) {
  const search = String(location?.search || "").trim();
  const params = new URLSearchParams(search);
  return String(params.get("strategy") || "").trim();
}

function normalizeBacktestTimeframeValue(value = "", fallback = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return String(fallback || "").trim();
  const mapped = {
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
  }[normalized];
  return String(mapped || fallback || "").trim();
}

function resolveRequestedStrategyId(strategyId = "", options = []) {
  const requested = String(strategyId || "").trim();
  if (!requested) return "";
  const available = Array.isArray(options) ? options : [];
  const exact = available.find(
    (item) => String(item?.key || item?.id || "").trim() === requested,
  );
  if (exact) return requested;
  return requested;
}

function resolveCustomStrategyBaseId(strategyId = "") {
  const requested = String(strategyId || "").trim();
  if (!requested) return "";
  return requested;
}

function editorHashActive(location) {
  const hash = String(location?.hash || "").trim().toLowerCase();
  return hash === "#edit" || hash === "#json";
}

function resolveBacktestsBasePath(pathname = "") {
  const path = String(pathname || "").trim().toLowerCase();
  if (path.startsWith("/trades0/backtests")) return "/trades0/backtests";
  if (path.startsWith("/trades/backtests")) return "/trades/backtests";
  return "/backtests";
}

function buildBacktestsStrategyUrl(
  strategyId = "",
  hash = "#edit",
  basePath = "/trades/backtests",
) {
  const normalizedId = String(strategyId || "").trim();
  const nextHash = String(hash || "#edit").trim() || "#edit";
  return normalizedId
    ? `${basePath}?strategy=${encodeURIComponent(normalizedId)}${nextHash}`
    : `${basePath}${nextHash}`;
}

function buildBacktestsRunUrl(
  strategyId = "",
  params = {},
  basePath = "/trades/backtests",
) {
  const query = new URLSearchParams();
  const normalizedId = String(strategyId || "").trim();
  if (normalizedId) query.set("strategy", normalizedId);
  Object.entries(params || {}).forEach(([key, rawValue]) => {
    const value = String(rawValue || "").trim();
    if (value) query.set(key, value);
  });
  const queryText = query.toString();
  return queryText ? `${basePath}?${queryText}` : basePath;
}

function buildBacktestsDetailUrl(
  runId = "",
  {
    strategyId = "",
    params = {},
    basePath = "/trades/backtests",
    hash = "",
  } = {},
) {
  const normalizedRunId = String(runId || "").trim();
  const baseUrl = normalizedRunId
    ? `${basePath}/${encodeURIComponent(normalizedRunId)}`
    : String(basePath || "/trades/backtests");
  const query = new URLSearchParams();
  const normalizedStrategyId = String(strategyId || "").trim();
  if (normalizedStrategyId) query.set("strategy", normalizedStrategyId);
  Object.entries(params || {}).forEach(([key, rawValue]) => {
    const value = String(rawValue || "").trim();
    if (value) query.set(key, value);
  });
  const queryText = query.toString();
  const hashText = String(hash || "").trim();
  return `${baseUrl}${queryText ? `?${queryText}` : ""}${hashText}`;
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

function formatBacktestSummaryParams(summary = null) {
  const text = String(summary?.backtest_params_text || "").trim();
  return text || "";
}

function formatMoneyCompact(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${num >= 0 ? "+" : "-"}$${Math.abs(num).toFixed(digits)}`;
}

function normalizeSelectionList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeStrategySelection(form = {}, fallback = "") {
  const selected = normalizeSelectionList(form?.strategy_keys);
  if (selected.length) return selected;
  const single = String(form?.strategy_key || fallback || "").trim();
  return single ? [single] : [];
}

function normalizeTimeframeSelection(form = {}, fallback = "") {
  const selected = normalizeSelectionList(form?.tfs);
  if (selected.length) return selected;
  const single = String(form?.tf || fallback || "").trim();
  return single ? [single] : [];
}

function roundNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const factor = 10 ** Math.max(0, Number(digits) || 0);
  return Math.round(num * factor) / factor;
}

function formatBatchCellCompact(cell = null) {
  if (!cell) return "-";
  if (Number(cell?.completed || 0) <= 0 && Number(cell?.failed || 0) <= 0) return "-";
  if (Number(cell?.completed || 0) <= 0 && Number(cell?.failed || 0) > 0) return "Failed";
  const plannedAvailable = Number(cell?.planned_outcome_samples || 0) > 0;
  const realizedValue = Number((cell?.total_realized_r ?? cell?.total_r) || 0);
  const plannedValue = Number(cell?.total_planned_outcome_r || 0);
  const toneClass = (value) =>
    value > 0 ? "money-pos" : value < 0 ? "money-neg" : "money-neutral";
  return (
    <>
      <span className="money-neutral">{`(${Math.round(Number(cell?.total_trades || 0))}t)`}</span>{" "}
      <span className="money-neutral">{`${formatNumber(cell?.win_rate_pct || 0, 0)}%`}</span>{" "}
      <span className={toneClass(realizedValue)}>{`${formatNumber(realizedValue, 1)}r`}</span>
      <span className="money-neutral">/</span>
      <span className={plannedAvailable ? toneClass(plannedValue) : "money-neutral"}>
        {plannedAvailable ? `${formatNumber(plannedValue, 1)}r` : "-"}
      </span>
    </>
  );
}

function buildMetricsMatrixCell({
  tf = "",
  totalTrades = 0,
  winRatePct = 0,
  totalRealizedR = 0,
  totalPlannedOutcomeR = 0,
  plannedOutcomeSamples = 0,
  symbols = [],
} = {}) {
  return {
    tf: timeframeLabel(tf),
    completed: 1,
    failed: 0,
    total_trades: Math.max(0, Number(totalTrades) || 0),
    win_rate_pct: Number(winRatePct) || 0,
    total_realized_r: Number(totalRealizedR) || 0,
    total_planned_outcome_r: Number(totalPlannedOutcomeR) || 0,
    planned_outcome_samples: Math.max(0, Number(plannedOutcomeSamples) || 0),
    total_r: Number(totalRealizedR) || 0,
    symbols: Array.isArray(symbols) ? symbols.filter(Boolean) : [],
  };
}

function buildClientBatchBacktestResult({
  payload = {},
  sessionResults = [],
  sessionFailures = [],
  strategies = [],
  symbols = [],
  timeframes = [],
  limit = 0,
} = {}) {
  const strategyLabelById = new Map(
    (Array.isArray(strategies) ? strategies : []).map((strategy) => {
      const id = String(strategy?.key || strategy?.id || "").trim();
      return [id, String(strategy?.name || id || "Strategy").trim()];
    }),
  );
  const requestedSymbols = normalizeSelectionList(symbols).map((symbol) =>
    symbol.toUpperCase(),
  );
  const requestedTimeframes = normalizeSelectionList(timeframes);
  const requestedStrategies = normalizeSelectionList(
    (Array.isArray(strategies) ? strategies : []).map(
      (strategy) => strategy?.key || strategy?.id,
    ),
  );
  const matrix = new Map();
  const rows = [];
  const combinedTrades = [];
  const combinedEvents = [];
  const firstBarTimes = [];
  const lastBarTimes = [];
  const barsAnalyzedValues = [];
  let completed = 0;
  let failed = 0;
  let totalTrades = 0;
  let totalPnl = 0;
  let totalRealizedR = 0;
  let totalPlannedOutcomeR = 0;
  let totalPlannedOutcomeSamples = 0;
  let weightedWins = 0;

  const ensureMatrixCell = (strategyId, tf) => {
    const strategyKey = String(strategyId || "").trim();
    const tfKey = String(tf || "").trim();
    const comboKey = `${strategyKey}:${tfKey}`;
    if (!matrix.has(comboKey)) {
      matrix.set(comboKey, {
        strategy_id: strategyKey,
        strategy_name: strategyLabelById.get(strategyKey) || strategyKey || "Strategy",
        tf: tfKey,
        total_trades: 0,
        total_pnl: 0,
        total_realized_r: 0,
        total_planned_outcome_r: 0,
        planned_outcome_samples: 0,
        total_r: 0,
        weighted_wins: 0,
        completed: 0,
        failed: 0,
        symbols: new Set(),
      });
    }
    return matrix.get(comboKey);
  };

  for (const entry of Array.isArray(sessionResults) ? sessionResults : []) {
    const result = entry?.result || {};
    const run = result?.run || {};
    const summary =
      result?.summary && typeof result.summary === "object"
        ? result.summary
        : run?.summary && typeof run.summary === "object"
          ? run.summary
          : {};
    const strategyId = String(entry?.strategyKey || run?.strategy_key || run?.strategy_id || "").trim();
    const strategyName = String(
      run?.strategy_name || strategyLabelById.get(strategyId) || strategyId || "Strategy",
    ).trim();
    const symbol = String(entry?.symbol || run?.symbol || "").trim().toUpperCase();
    const tf = String(entry?.tf || run?.tf || "").trim();
    const resultTrades = Array.isArray(result?.trades) ? result.trades : [];
    const fallbackTrades = resultTrades.filter((trade) => trade && typeof trade === "object");
    const fallbackTradeCount = fallbackTrades.length;
    const fallbackWins = fallbackTrades.filter((trade) => {
      const resultLabel = String(trade?.result || "").trim().toLowerCase();
      if (resultLabel === "win") return true;
      if (resultLabel === "loss" || resultLabel === "flat") return false;
      return Number(trade?.pnl_realized ?? trade?.pnl ?? 0) > 0;
    }).length;
    const fallbackPnl = fallbackTrades.reduce(
      (sum, trade) => sum + Number(trade?.pnl_realized ?? trade?.pnl ?? 0),
      0,
    );
    const fallbackRealizedR = fallbackTrades.reduce((sum, trade) => {
      const rawR = Number(
        trade?.realized_r ??
          trade?.r_multiple ??
          trade?.rr_realized ??
          trade?.rr ??
          0,
      );
      return sum + (Number.isFinite(rawR) ? rawR : 0);
    }, 0);
    const fallbackPlannedOutcomeR = fallbackTrades.reduce((sum, trade) => {
      const rawR = Number(trade?.planned_outcome_r ?? 0);
      return sum + (Number.isFinite(rawR) ? rawR : 0);
    }, 0);
    const fallbackPlannedOutcomeSamples = fallbackTrades.filter((trade) =>
      Object.prototype.hasOwnProperty.call(trade || {}, "planned_outcome_r"),
    ).length;
    const summaryTradeCount = Math.max(0, Number(summary?.total_trades || 0));
    const hasSummaryTradeCount =
      Object.prototype.hasOwnProperty.call(summary, "total_trades") && summaryTradeCount > 0;
    const hasAnySummaryTradeMetric = [
      "total_trades",
      "win_rate_pct",
      "total_pnl",
      "total_realized_r",
      "total_r",
      "total_planned_outcome_r",
    ].some((key) => Object.prototype.hasOwnProperty.call(summary, key));
    const useSummaryMetrics = hasSummaryTradeCount || (!fallbackTradeCount && hasAnySummaryTradeMetric);
    const rowTrades = useSummaryMetrics ? summaryTradeCount : fallbackTradeCount;
    const rowWinRate = useSummaryMetrics
      ? Number(summary?.win_rate_pct || 0)
      : rowTrades
        ? (fallbackWins / rowTrades) * 100
        : 0;
    const rowPnl = useSummaryMetrics ? Number(summary?.total_pnl || 0) : fallbackPnl;
    const rowRealizedR = useSummaryMetrics
      ? Number((summary?.total_realized_r ?? summary?.total_r) || 0)
      : fallbackRealizedR;
    const summaryHasPlannedOutcome =
      (summary &&
        typeof summary === "object" &&
        Object.prototype.hasOwnProperty.call(summary, "total_planned_outcome_r")) ||
      fallbackPlannedOutcomeSamples > 0;
    const rowPlannedOutcomeR = useSummaryMetrics
      ? Number(summary?.total_planned_outcome_r || 0)
      : fallbackPlannedOutcomeR;
    const firstBarAt = String(summary?.first_bar_at || "").trim();
    const lastBarAt = String(summary?.last_bar_at || "").trim();
    const barsAnalyzed = Number(summary?.bars_analyzed || 0);
    const comboKey = `${strategyId}:${tf}`;
    const cell = ensureMatrixCell(strategyId, tf);
    completed += 1;
    totalTrades += rowTrades;
    totalPnl += Number.isFinite(rowPnl) ? rowPnl : 0;
    totalRealizedR += Number.isFinite(rowRealizedR) ? rowRealizedR : 0;
    totalPlannedOutcomeR += Number.isFinite(rowPlannedOutcomeR) ? rowPlannedOutcomeR : 0;
    totalPlannedOutcomeSamples += summaryHasPlannedOutcome ? 1 : 0;
    weightedWins += Number.isFinite(rowWinRate) ? (rowWinRate / 100) * rowTrades : 0;
    if (firstBarAt) firstBarTimes.push(firstBarAt);
    if (lastBarAt) lastBarTimes.push(lastBarAt);
    if (Number.isFinite(barsAnalyzed) && barsAnalyzed > 0) {
      barsAnalyzedValues.push(barsAnalyzed);
    }
    cell.total_trades += rowTrades;
    cell.total_pnl += Number.isFinite(rowPnl) ? rowPnl : 0;
    cell.total_realized_r += Number.isFinite(rowRealizedR) ? rowRealizedR : 0;
    cell.total_planned_outcome_r += Number.isFinite(rowPlannedOutcomeR)
      ? rowPlannedOutcomeR
      : 0;
    cell.planned_outcome_samples += summaryHasPlannedOutcome
      ? useSummaryMetrics
        ? 1
        : fallbackPlannedOutcomeSamples
      : 0;
    cell.total_r += Number.isFinite(rowRealizedR) ? rowRealizedR : 0;
    cell.weighted_wins += Number.isFinite(rowWinRate) ? (rowWinRate / 100) * rowTrades : 0;
    cell.completed += 1;
    if (symbol) cell.symbols.add(symbol);
    combinedTrades.push(
      ...((Array.isArray(result?.trades) ? result.trades : []).map((trade) => ({
        ...trade,
        symbol,
        tf,
        timeframe: tf,
        strategy_id: strategyId,
        strategy_key: strategyId,
        strategy_name: strategyName,
        batch_combo_key: comboKey,
      }))),
    );
    combinedEvents.push(
      ...((Array.isArray(result?.events) ? result.events : []).map((event) => ({
        ...event,
        symbol,
        tf,
        timeframe: tf,
        strategy_id: strategyId,
        strategy_key: strategyId,
        strategy_name: strategyName,
        batch_combo_key: comboKey,
      }))),
    );
    rows.push({
      status: "completed",
      strategy_id: strategyId,
      strategy_name: strategyName,
      symbol,
      tf,
      total_trades: rowTrades,
      win_rate_pct: Number.isFinite(rowWinRate) ? roundNumber(rowWinRate, 2) : 0,
      total_pnl: Number.isFinite(rowPnl) ? roundNumber(rowPnl, 5) : 0,
      total_realized_r: Number.isFinite(rowRealizedR) ? roundNumber(rowRealizedR, 5) : 0,
      total_planned_outcome_r: Number.isFinite(rowPlannedOutcomeR)
        ? roundNumber(rowPlannedOutcomeR, 5)
        : 0,
      planned_outcome_available: summaryHasPlannedOutcome,
      total_r: Number.isFinite(rowRealizedR) ? roundNumber(rowRealizedR, 5) : 0,
    });
  }

  for (const entry of Array.isArray(sessionFailures) ? sessionFailures : []) {
    const strategyId = String(entry?.strategyKey || "").trim();
    const tf = String(entry?.tf || "").trim();
    const symbol = String(entry?.symbol || "").trim().toUpperCase();
    const cell = ensureMatrixCell(strategyId, tf);
    failed += 1;
    cell.failed += 1;
    if (symbol) cell.symbols.add(symbol);
    rows.push({
      status: "failed",
      strategy_id: strategyId,
      strategy_name: strategyLabelById.get(strategyId) || strategyId || "Strategy",
      symbol,
      tf,
      error: String(entry?.error || "Backtest failed"),
    });
  }

  combinedTrades.sort(compareTradeReplayAsc);
  combinedEvents.sort((left, right) => {
    const leftTime = Number(left?.bar_time_unix || 0);
    const rightTime = Number(right?.bar_time_unix || 0);
    if (leftTime !== rightTime) return leftTime - rightTime;
    return String(left?.event_id || "").localeCompare(String(right?.event_id || ""));
  });

  const firstBarAt = firstBarTimes
    .map((value) => toTimeMs(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)[0];
  const lastBarAt = lastBarTimes
    .map((value) => toTimeMs(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0];
  const matrixRows = requestedStrategies.map((strategyId) => {
    const cells = requestedTimeframes.map((tf) => {
      const cell = matrix.get(`${strategyId}:${tf}`) || null;
      const cellTrades = Number(cell?.total_trades || 0);
      return {
        tf,
        completed: Number(cell?.completed || 0),
        failed: Number(cell?.failed || 0),
        total_trades: cellTrades,
        total_pnl: roundNumber(cell?.total_pnl || 0, 5),
        total_realized_r: roundNumber((cell?.total_realized_r ?? cell?.total_r) || 0, 5),
        total_planned_outcome_r: roundNumber(cell?.total_planned_outcome_r || 0, 5),
        planned_outcome_samples: Number(cell?.planned_outcome_samples || 0),
        total_r: roundNumber(cell?.total_r || 0, 5),
        win_rate_pct: cellTrades
          ? roundNumber((Number(cell?.weighted_wins || 0) / cellTrades) * 100, 2)
          : 0,
        symbols: Array.from(cell?.symbols || []),
      };
    });
    return {
      strategy_id: strategyId,
      strategy_name: strategyLabelById.get(strategyId) || strategyId || "Strategy",
      cells,
    };
  });
  const wins = combinedTrades.filter((trade) => trade?.result === "win").length;
  const losses = combinedTrades.filter((trade) => trade?.result === "loss").length;
  const flats = combinedTrades.filter((trade) => trade?.result === "flat").length;
  const summary = {
    bars_analyzed: barsAnalyzedValues.length ? Math.max(...barsAnalyzedValues) : 0,
    total_trades: totalTrades,
    generated_signals: totalTrades,
    wins,
    losses,
    flats,
    win_rate_pct: totalTrades ? roundNumber((weightedWins / totalTrades) * 100, 2) : 0,
    total_pnl: roundNumber(totalPnl, 5),
    average_pnl: totalTrades ? roundNumber(totalPnl / totalTrades, 5) : 0,
    total_realized_r: roundNumber(totalRealizedR, 5),
    average_realized_r: totalTrades ? roundNumber(totalRealizedR / totalTrades, 5) : 0,
    total_planned_outcome_r: roundNumber(totalPlannedOutcomeR, 5),
    planned_outcome_samples: totalPlannedOutcomeSamples,
    average_planned_outcome_r: totalTrades
      ? roundNumber(totalPlannedOutcomeR / totalTrades, 5)
      : 0,
    total_r: roundNumber(totalRealizedR, 5),
    average_r: totalTrades ? roundNumber(totalRealizedR / totalTrades, 5) : 0,
    strategy_key: requestedStrategies.length === 1 ? requestedStrategies[0] : "batch_mix",
    strategy_id: requestedStrategies.length === 1 ? requestedStrategies[0] : "batch_mix",
    strategy_name:
      requestedStrategies.length === 1
        ? strategyLabelById.get(requestedStrategies[0]) || requestedStrategies[0] || "Strategy"
        : `${requestedStrategies.length} Strategies Mixed`,
    first_bar_at: firstBarAt ? new Date(firstBarAt).toISOString() : null,
    last_bar_at: lastBarAt ? new Date(lastBarAt).toISOString() : null,
  };
  const now = new Date().toISOString();
  const run = {
    run_id: `client_batch_${Date.now()}`,
    symbol: requestedSymbols.length === 1 ? requestedSymbols[0] : "MULTI",
    tf: requestedTimeframes.length === 1 ? requestedTimeframes[0] : "multi",
    limit,
    direction: String(payload.direction || "all").trim().toLowerCase(),
    session: String(payload.session || "Any").trim() || "Any",
    one_r_value: Number(payload.one_r_value || 0) || null,
    status: failed && !completed ? "failed" : "completed",
    strategy_key: summary.strategy_key,
    strategy_id: summary.strategy_id,
    strategy_name: summary.strategy_name,
    started_at: now,
    completed_at: now,
    updated_at: now,
    ephemeral: true,
    batch_mix: true,
    selection: {
      symbols: requestedSymbols,
      timeframes: requestedTimeframes,
      strategy_ids: requestedStrategies,
    },
    summary,
  };
  return {
    ok: true,
    run,
    summary,
    trades: combinedTrades,
    events: combinedEvents,
    strategies,
    report: {
      generated_at: now,
      selection: {
        symbols: requestedSymbols,
        timeframes: requestedTimeframes,
        strategy_ids: requestedStrategies,
      },
      matrix_timeframes: requestedTimeframes,
      matrix_rows: matrixRows,
      totals: {
        strategies: requestedStrategies.length,
        symbols: requestedSymbols.length,
        timeframes: requestedTimeframes.length,
        combinations: requestedStrategies.length * requestedSymbols.length * requestedTimeframes.length,
        completed,
        failed,
        total_trades: totalTrades,
        total_pnl: roundNumber(totalPnl, 5),
        total_realized_r: roundNumber(totalRealizedR, 5),
        total_planned_outcome_r: roundNumber(totalPlannedOutcomeR, 5),
        planned_outcome_samples: totalPlannedOutcomeSamples,
        total_r: roundNumber(totalRealizedR, 5),
        weighted_win_rate_pct: totalTrades ? roundNumber((weightedWins / totalTrades) * 100, 2) : 0,
      },
      rows,
    },
  };
}

function normalizeStrategyBacktestSummary(strategy = null) {
  const summary =
    strategy?.backtest_summary && typeof strategy.backtest_summary === "object"
      ? strategy.backtest_summary
      : null;
  return summary;
}

function formatStrategyBacktestRange(summary = null) {
  if (!summary) return "";
  const startLabel = formatBacktestDateLabel(summary?.earliest_data_start_at);
  const endLabel = formatBacktestDateLabel(summary?.latest_data_end_at);
  if (startLabel && endLabel) {
    return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
  }
  return startLabel || endLabel || "";
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
      symbol: defaults.symbol || base.market?.symbol || "",
      tf: defaults.tf || base.market?.tf || "",
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
        : {
            bullish: { and: [] },
            bearish: { and: [] },
          },
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
    kind: "custom",
    status: "draft",
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
  const tradeSymbol = String(trade?.symbol || symbol || "-").trim() || "-";
  const tradeTf = timeframeLabel(trade?.tf || trade?.timeframe || "");
  const strategyLabel = String(
    trade?.strategy_name || trade?.strategy_key || trade?.strategy_id || "",
  ).trim();
  return (
    <div
      role="button"
      tabIndex={0}
      className={`backtests-item-card card-item${active ? " selected-item backtests-item-card--active-soft" : ""}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onClick?.();
      }}
    >
      <div className="stack-layout backtests-item-card__body backtests-item-card__body--trade" style={{ gap: 2, width: "100%" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {strategyLabel ? (
              <span style={{ fontWeight: 700, fontSize: 10, color: "#cbd5e1" }}>
                {strategyLabel}
              </span>
            ) : null}
            <span
              style={{
                fontWeight: 700,
                fontSize: 10,
                color: action === "SELL" ? "#ef5350" : "#26a69a",
              }}
            >
              {tradeSymbol}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span style={{ color: "var(--muted)", fontSize: 9 }}>{tradeTf}</span>
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
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 10,
            lineHeight: 1.2,
          }}
        >
          <div>
            <div style={{ color: "var(--muted)", fontSize: 9, lineHeight: 1.2 }}>
              <TradePriceInline
                entry={trade?.entry}
                tp={trade?.tp1 ?? trade?.tp}
                sl={trade?.sl}
                symbol={tradeSymbol}
              />
            </div>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 9, lineHeight: 1.2 }}>
            {rr != null ? `${rr.toFixed(1)}R` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BacktestsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const confirm = useConfirmDialog();
  const isMobile = useIsMobile();
  const routeRunId = String(params.runId || "").trim();
  const routeStrategyId = strategyIdFromLocation(location);
  const routeStrategyCandidateId = resolveCustomStrategyBaseId(routeStrategyId);
  const locationHash = String(location?.hash || "").trim().toLowerCase();
  const locationSearch = String(location?.search || "").trim();
  const routeQueryParams = useMemo(() => new URLSearchParams(locationSearch), [locationSearch]);
  const routeSymbol = String(routeQueryParams.get("symbol") || "").trim().toUpperCase();
  const routeTf = normalizeBacktestTimeframeValue(
    routeQueryParams.get("tf") || routeQueryParams.get("timeframe") || "",
    "",
  );
  const backtestsBasePath = useMemo(
    () => resolveBacktestsBasePath(location?.pathname || ""),
    [location?.pathname],
  );

  const [activeTab, setActiveTab] = useState(() => {
    if (locationHash === "#rules") return "rules";
    if (editorHashActive({ hash: locationHash })) return "strategies";
    if (locationHash === "#history") return "history";
    return "backtest";
  });
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);
  const [runs, setRuns] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [customStrategies, setCustomStrategies] = useState([]);
  const [strategyExample, setStrategyExample] = useState(null);
  const [selectedStrategyId, setSelectedStrategyId] = useState(routeStrategyId);
  const [draftStrategySeed, setDraftStrategySeed] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(routeRunId);
  const [selectedRunDetail, setSelectedRunDetail] = useState(null);
  const [ephemeralRunDetail, setEphemeralRunDetail] = useState(null);
  const [ephemeralRunSaveName, setEphemeralRunSaveName] = useState("");
  const [selectedTradeSid, setSelectedTradeSid] = useState("");
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingStrategies, setLoadingStrategies] = useState(false);
  const [running, setRunning] = useState(false);
  const [backtestRunProgress, setBacktestRunProgress] = useState(null);
  const [savingRun, setSavingRun] = useState(false);
  const [error, setError] = useState("");
  const [batchReport, setBatchReport] = useState(null);
  const [resultFilterTf, setResultFilterTf] = useState("all");
  const [resultFilterStrategy, setResultFilterStrategy] = useState("all");
  const [historyStrategyFilter, setHistoryStrategyFilter] = useState(
    HISTORY_STRATEGY_FILTER_ALL,
  );
  const [resultChartLoaded, setResultChartLoaded] = useState(false);
  const [resultChartLoadKey, setResultChartLoadKey] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeedMs, setReplaySpeedMs] = useState(200);
  const [replayStartTradeSid, setReplayStartTradeSid] = useState("");
  const [replayActiveTradeSid, setReplayActiveTradeSid] = useState("");
  const [replayProgress, setReplayProgress] = useState(null);
  const [ruleTester, setRuleTester] = useState({
    symbol: "BTCUSD",
    tf: "5",
    bars: "1000",
    one_r_value: "100",
    rule: stripRuleActions(
      createEmptyRuleDraft({
        name: "Rule Test",
        actions: [],
      }),
    ),
  });
  const [ruleEditorTab, setRuleEditorTab] = useState("edit");
  const [ruleLibraryTab, setRuleLibraryTab] = useState("popular");
  const [ruleLibraryQuery, setRuleLibraryQuery] = useState("");
  const [ruleCatalog, setRuleCatalog] = useState([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [testedRuleStrategy, setTestedRuleStrategy] = useState(null);
  const [ruleTestRunKey, setRuleTestRunKey] = useState(0);
  const [ruleTestMarkerSummary, setRuleTestMarkerSummary] = useState(null);
  const routeAutoRunKeyRef = useRef("");
  const [form, setForm] = useState({
    symbol: routeSymbol || "BTCUSD",
    tf: routeTf || "1",
    tfs: [routeTf || "1"],
    limit: "3000",
    limit_mode: "bars",
    limit_bars_value: "3000",
    limit_preset: "today",
    limit_start_date: "",
    limit_end_date: "",
    strategy_key: routeStrategyId || DEFAULT_BACKTEST_STRATEGY_ID,
    strategy_keys: [routeStrategyId || DEFAULT_BACKTEST_STRATEGY_ID],
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
      setStrategies(Array.isArray(res?.strategies) ? res.strategies : []);
      const shouldHoldRunSelection =
        !preferredRunId &&
        !routeRunId &&
        !selectedRunId &&
        Boolean(String(routeStrategyId || "").trim());
      const nextSelectedRunId =
        preferredRunId ||
        routeRunId ||
        selectedRunId ||
        (shouldHoldRunSelection
          ? ""
          : nextRuns[0]
            ? String(nextRuns[0].run_id || "")
            : "");
      if (nextSelectedRunId) {
        setSelectedRunId(nextSelectedRunId);
      }
    } catch (loadError) {
      setError(String(loadError?.message || loadError || "Failed to load backtests"));
    } finally {
      setLoadingRuns(false);
    }
  }

  async function loadRulesCatalog() {
    setLoadingRules(true);
    try {
      const res = await api.listRules();
      const items = Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res?.rules)
          ? res.rules
          : [];
      setRuleCatalog(items.length ? items : listPredefinedRules().map((rule) => ({
        ...rule,
        kind: "predefined",
      })));
    } catch {
      setRuleCatalog(listPredefinedRules().map((rule) => ({
        ...rule,
        kind: "predefined",
      })));
    } finally {
      setLoadingRules(false);
    }
  }

  async function loadStrategyCatalog() {
    setLoadingStrategies(true);
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
    } finally {
      setLoadingStrategies(false);
    }
  }

  async function loadRouteStrategy(strategyId) {
    const targetId = String(strategyId || "").trim();
    if (!targetId) return null;
    try {
      const res = await api.getStrategy(targetId);
      const item = res?.item && typeof res.item === "object" ? res.item : null;
      if (!item) return null;
      setCustomStrategies((prev) =>
        normalizeStrategyCatalog([
          ...(Array.isArray(prev) ? prev : []),
          item,
        ]).filter((entry) => String(entry?.kind || "").trim() === "custom"),
      );
      return item;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    loadRuns();
    loadRulesCatalog();
    loadStrategyCatalog();
  }, []);

  useEffect(() => {
    if (!routeStrategyId) return;
    const routeStrategyBaseId = resolveCustomStrategyBaseId(routeStrategyId);
    const existsInCatalog =
      strategies.some((item) => String(item?.key || item?.id || "").trim() === routeStrategyId) ||
      strategies.some((item) => String(item?.key || item?.id || "").trim() === routeStrategyBaseId) ||
      customStrategies.some(
        (item) => String(item?.key || item?.id || "").trim() === routeStrategyId,
      ) ||
      customStrategies.some(
        (item) => String(item?.key || item?.id || "").trim() === routeStrategyBaseId,
      );
    if (existsInCatalog) return;
    void loadRouteStrategy(routeStrategyId);
  }, [customStrategies, routeStrategyId, strategies]);

  useEffect(() => {
    if (!editorHashActive({ hash: locationHash })) return;
    setActiveTab((current) => (current === "strategies" ? current : "strategies"));
    const preferredStrategyId = routeStrategyCandidateId || routeStrategyId || DEFAULT_EDIT_STRATEGY_ID;
    if (!preferredStrategyId) return;
    setSelectedStrategyId((current) => {
      if (current && current !== "__new__") return current;
      return current === preferredStrategyId ? current : preferredStrategyId;
    });
    setForm((prev) =>
      prev.strategy_key === preferredStrategyId
        ? prev
        : {
            ...prev,
            strategy_key: preferredStrategyId,
          },
    );
  }, [locationHash, routeStrategyCandidateId, routeStrategyId]);

  useEffect(() => {
    if (locationHash === "#rules") {
      setActiveTab((current) => (current === "rules" ? current : "rules"));
      return;
    }
    if (locationHash === "#history") {
      setActiveTab((current) => (current === "history" ? current : "history"));
      return;
    }
  }, [locationHash]);

  useEffect(() => {
    const nextStrategyId = String(routeStrategyCandidateId || routeStrategyId || "").trim();
    const nextSymbol = routeSymbol;
    const nextTf = routeTf;
    if (!nextStrategyId && !nextSymbol && !nextTf) return;
    const strategySelectionCleared =
      Array.isArray(form?.strategy_keys) &&
      form.strategy_keys.length === 0 &&
      !String(form?.strategy_key || "").trim();
    if (nextStrategyId && selectedStrategyId !== nextStrategyId && !strategySelectionCleared) {
      setDraftStrategySeed(null);
      setSelectedStrategyId(nextStrategyId);
    }
    setForm((prev) => {
      const next = { ...prev };
      if (nextStrategyId && !strategySelectionCleared) {
        const currentStrategyKeys = normalizeStrategySelection(prev);
        if (!currentStrategyKeys.length) {
          next.strategy_key = nextStrategyId;
          next.strategy_keys = [nextStrategyId];
        }
      }
      if (nextSymbol) {
        next.symbol = nextSymbol;
      }
      if (nextTf) {
        next.tf = nextTf;
        const currentTfs = normalizeTimeframeSelection(prev);
        next.tfs =
          currentTfs.length > 1 && currentTfs.includes(nextTf)
            ? currentTfs
            : [nextTf];
      }
      const prevJson = JSON.stringify(prev);
      const nextJson = JSON.stringify(next);
      return prevJson === nextJson ? prev : next;
    });
  }, [routeStrategyCandidateId, routeStrategyId, routeSymbol, routeTf, selectedStrategyId]);

  useEffect(() => {
    if (!routeStrategyId || routeRunId) return;
    setEphemeralRunDetail(null);
    setEphemeralRunSaveName("");
    setSelectedRunDetail(null);
    setSelectedRunId("");
    setSelectedTradeSid("");
    setBatchReport(null);
    setBacktestRunProgress(null);
  }, [routeRunId, routeStrategyId]);

  useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    const autoRun = params.get("autorun") === "1";
    if (!autoRun) {
      routeAutoRunKeyRef.current = "";
      return;
    }
    const nextStrategyId = String(
      routeStrategyCandidateId || routeStrategyId || params.get("strategy") || "",
    ).trim();
    const nextSymbol = String(params.get("symbol") || "").trim().toUpperCase();
    const nextTf = normalizeBacktestTimeframeValue(
      params.get("tf") || params.get("timeframe") || "",
      "",
    );
    setActiveTab((current) => (current === "backtest" ? current : "backtest"));
    const strategySelectionCleared =
      Array.isArray(form?.strategy_keys) &&
      form.strategy_keys.length === 0 &&
      !String(form?.strategy_key || "").trim();
    if (nextStrategyId && selectedStrategyId !== nextStrategyId && !strategySelectionCleared) {
      setDraftStrategySeed(null);
      setSelectedStrategyId(nextStrategyId);
    }
    setForm((prev) => {
      const next = {
        ...prev,
      };
      if (nextStrategyId && !strategySelectionCleared) {
        const currentStrategyKeys = normalizeStrategySelection(prev);
        if (!currentStrategyKeys.length) {
          next.strategy_key = nextStrategyId;
          next.strategy_keys = [nextStrategyId];
        }
      }
      if (nextSymbol) {
        next.symbol = nextSymbol;
      }
      if (nextTf) {
        next.tf = nextTf;
        const currentTfs = normalizeTimeframeSelection(prev);
        next.tfs =
          currentTfs.length > 1 && currentTfs.includes(nextTf)
            ? currentTfs
            : [nextTf];
      }
      const prevJson = JSON.stringify(prev);
      const nextJson = JSON.stringify(next);
      return prevJson === nextJson ? prev : next;
    });
  }, [locationSearch, routeStrategyCandidateId, routeStrategyId, selectedStrategyId]);

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
  const activeBatchReport = activeRunDetail?.report || batchReport || null;
  const strategyOptions = useMemo(
    () =>
      strategies.length || customStrategies.length
        ? mergeStrategiesById(strategies, customStrategies)
        : [{ key: "ema_cross_v1", name: "EMA Cross v1" }],
    [customStrategies, strategies],
  );
  const allStrategies = strategyOptions;
  const resolvedRouteStrategyId = useMemo(
    () => resolveRequestedStrategyId(routeStrategyId, allStrategies),
    [allStrategies, routeStrategyId],
  );
  const selectedStrategyKeys = useMemo(
    () => normalizeStrategySelection(form, DEFAULT_BACKTEST_STRATEGY_ID),
    [form],
  );
  const selectedTimeframes = useMemo(
    () => normalizeTimeframeSelection(form, "1"),
    [form],
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
  const activeChartStrategy = useMemo(() => {
    if (resultFilterStrategy && resultFilterStrategy !== "all") {
      const filteredStrategy = allStrategies.find(
        (item) => String(item.key || item.id || "").trim() === resultFilterStrategy,
      );
      if (filteredStrategy) return filteredStrategy;
    }
    if (selectedStrategy) return selectedStrategy;
    const activeRunStrategyId = String(
      activeRun?.strategy_key || activeRun?.strategy_id || "",
    ).trim();
    if (!activeRunStrategyId) return null;
    return (
      allStrategies.find(
        (item) =>
          String(item.key || item.id || "").trim() === activeRunStrategyId,
      ) || null
    );
  }, [
    activeRun?.strategy_id,
    activeRun?.strategy_key,
    allStrategies,
    resultFilterStrategy,
    selectedStrategy,
  ]);
  const symbolOptions = useMemo(() => {
    const known = new Set();
    for (const values of Object.values(SYSTEM_SYMBOL_GROUP_PRESETS)) {
      for (const symbol of values || []) known.add(String(symbol || "").trim().toUpperCase());
    }
    if (activeRun?.symbol) known.add(String(activeRun.symbol).trim().toUpperCase());
    if (form.symbol) known.add(String(form.symbol).trim().toUpperCase());
    return Array.from(known).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [activeRun?.symbol, form.symbol]);
  const selectedStrategyItems = useMemo(
    () =>
      selectedStrategyKeys
        .map((key) =>
          allStrategies.find((item) => String(item?.key || item?.id || "") === key) || null,
        )
        .filter(Boolean),
    [allStrategies, selectedStrategyKeys],
  );
  const ruleTesterBarsCount = useMemo(() => {
    const raw = String(ruleTester.bars || "").trim().toLowerCase();
    if (raw === "all") return 3000;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
  }, [ruleTester.bars]);
  const ruleTesterChartStrategy = useMemo(
    () =>
      testedRuleStrategy
        ? {
            ...testedRuleStrategy,
            id: `${testedRuleStrategy.id || "rules_tester_preview"}_${ruleTestRunKey}`,
            key: `${testedRuleStrategy.key || "rules_tester_preview"}_${ruleTestRunKey}`,
          }
        : null,
    [ruleTestRunKey, testedRuleStrategy],
  );
  const ruleTesterExpressionJson = useMemo(
    () => JSON.stringify(stripRuleActions(ruleTester.rule), null, 2),
    [ruleTester.rule],
  );
  const ruleLibraryItems = useMemo(() => {
    const items = [];
    const pushItem = (entry) => {
      if (!entry?.tree) return;
      items.push(entry);
    };
    const catalogEntries = (Array.isArray(ruleCatalog) ? ruleCatalog : [])
      .map((rule) => buildRuleLibraryEntryFromCatalogRule(rule))
      .filter(Boolean);

    if (catalogEntries.length) {
      catalogEntries.forEach(pushItem);
    } else {
    pushItem(
      buildRuleLibraryEntry({
        id: "popular_bos",
        label: "BOS",
        source: "popular",
        tree: {
          id: createRuleTestNodeId("condition"),
          type: "condition",
          mode: "if_true",
          functionName: "bos",
          args: { bias: "", tf: "" },
          left: "bar.close",
          comparator: ">",
          right: "bar.open",
        },
      }),
    );
    pushItem(
      buildRuleLibraryEntry({
        id: "popular_choch",
        label: "CHOCH",
        source: "popular",
        tree: {
          id: createRuleTestNodeId("condition"),
          type: "condition",
          mode: "if_true",
          functionName: "choch",
          args: { bias: "", tf: "" },
          left: "bar.close",
          comparator: ">",
          right: "bar.open",
        },
      }),
    );
    pushItem(
      buildRuleLibraryEntry({
        id: "popular_sweep",
        label: "Sweep",
        source: "popular",
        tree: {
          id: createRuleTestNodeId("condition"),
          type: "condition",
          mode: "if_true",
          functionName: "sweep",
          args: { bias: "", tf: "" },
          left: "bar.close",
          comparator: ">",
          right: "bar.open",
        },
      }),
    );
    pushItem(
      buildRuleLibraryEntry({
        id: "popular_rejected",
        label: "Rejected",
        source: "popular",
        tree: {
          id: createRuleTestNodeId("condition"),
          type: "condition",
          mode: "if_true",
          functionName: "rejected",
          args: { level: "levels.pd_mid" },
        },
      }),
    );
    pushItem(
      buildRuleLibraryEntry({
        id: "popular_breakout",
        label: "Breakout",
        source: "popular",
        tree: {
          id: createRuleTestNodeId("condition"),
          type: "condition",
          mode: "if_true",
          functionName: "breakout",
          args: { level: "levels.pd_mid", tf: "" },
        },
      }),
    );
    pushItem(
      buildRuleLibraryEntry({
        id: "popular_pin_bar",
        label: "Pin Bar",
        source: "popular",
        tree: {
          id: createRuleTestNodeId("condition"),
          type: "condition",
          mode: "if_true",
          functionName: "pin_bar",
          args: { bias: "", tf: "" },
        },
      }),
    );
    pushItem(
      buildRuleLibraryEntry({
        id: "popular_engulfing",
        label: "Engulfing",
        source: "popular",
        tree: {
          id: createRuleTestNodeId("condition"),
          type: "condition",
          mode: "if_true",
          functionName: "engulfing",
          args: { bias: "", tf: "" },
        },
      }),
    );
    pushItem(
      buildRuleLibraryEntry({
        id: "popular_inside_bar",
        label: "Inside Bar",
        source: "popular",
        tree: {
          id: createRuleTestNodeId("condition"),
          type: "condition",
          mode: "if_true",
          functionName: "inside_bar",
          args: { bias: "", tf: "" },
          left: "bar.close",
          comparator: ">",
          right: "bar.open",
        },
      }),
    );
    pushItem(
      buildRuleLibraryEntry({
        id: "popular_ema_cross",
        label: "EMA Fast > EMA Slow",
        source: "popular",
        tree: {
          id: createRuleTestNodeId("condition"),
          type: "condition",
          mode: "compare",
          left: "indicators.ema_fast",
          comparator: ">",
          right: "indicators.ema_slow",
          functionName: "touches",
          args: {},
        },
      }),
    );
    pushItem(
      buildRuleLibraryEntry({
        id: "popular_rsi_oversold",
        label: "RSI < 30",
        source: "popular",
        tree: {
          id: createRuleTestNodeId("condition"),
          type: "condition",
          mode: "compare",
          left: "indicators.rsi_14",
          comparator: "<",
          right: "30",
          functionName: "touches",
          args: {},
        },
      }),
    );
    pushItem(
      buildRuleLibraryEntry({
        id: "popular_rsi_overbought",
        label: "RSI > 70",
        source: "popular",
        tree: {
          id: createRuleTestNodeId("condition"),
          type: "condition",
          mode: "compare",
          left: "indicators.rsi_14",
          comparator: ">",
          right: "70",
          functionName: "touches",
          args: {},
        },
      }),
    );
    }

    (Array.isArray(allStrategies) ? allStrategies : []).forEach((strategy, strategyIndex) => {
      const strategyName =
        String(strategy?.name || strategy?.key || strategy?.id || `Strategy ${strategyIndex + 1}`).trim() ||
        `Strategy ${strategyIndex + 1}`;
      const strategyTf = String(strategy?.market?.tf || "").trim();
      const strategySymbol = String(strategy?.market?.symbol || "").trim().toUpperCase();
      const strategyRules = Array.isArray(strategy?.rules)
        ? strategy.rules
        : Array.isArray(strategy?.events)
          ? strategy.events
          : [];
      strategyRules.forEach((rule, ruleIndex) => {
        const when = rule?.when && typeof rule.when === "object" ? rule.when : null;
        const nextTree = buildRuleDraftFromExpression(when);
        if (!nextTree) return;
        pushItem(
          buildRuleLibraryEntry({
            id: `${String(strategy?.id || strategy?.key || strategyIndex)}_${String(rule?.id || ruleIndex)}`,
            label: `${strategyName} · ${String(rule?.name || rule?.id || `Rule ${ruleIndex + 1}`).trim() || `Rule ${ruleIndex + 1}`}`,
            source: "strategy",
            tree: nextTree,
            symbol: strategySymbol,
            tf: strategyTf,
          }),
        );
      });
    });

    const seen = new Set();
    return items.filter((item) => {
      const key = `${item.label}|${JSON.stringify(item.tree)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [allStrategies, ruleCatalog]);
  const visibleRuleLibraryItems = useMemo(
    () =>
      ruleLibraryItems.filter((item) =>
        (ruleLibraryTab === "strategy"
          ? item.source === "strategy"
          : item.source !== "strategy") &&
        (!String(ruleLibraryQuery || "").trim() ||
          [
            item.label,
            item.name,
            item.abbr,
            item.source,
            item.rule_id,
          ]
            .map((value) => String(value || "").toLowerCase())
            .some((value) =>
              value.includes(String(ruleLibraryQuery || "").trim().toLowerCase()),
            )),
      ),
    [ruleLibraryItems, ruleLibraryQuery, ruleLibraryTab],
  );
  const sortedActiveTrades = useMemo(
    () => [...activeTrades].sort(compareTradeReplayAsc),
    [activeTrades],
  );
  const activeRunTimeframes = useMemo(() => {
    const preferred = Array.isArray(activeBatchReport?.matrix_timeframes)
      ? activeBatchReport.matrix_timeframes
      : Array.isArray(activeRun?.selection?.timeframes)
        ? activeRun.selection.timeframes
        : [];
    const derived = [
      ...preferred,
      ...sortedActiveTrades.map((trade) => trade?.tf || trade?.timeframe || ""),
      activeRun?.tf || "",
      form.tf || "",
    ]
      .map((value) => timeframeLabel(value))
      .filter((value) => value && value !== "-");
    return [...new Set(derived)];
  }, [
    activeBatchReport?.matrix_timeframes,
    activeRun?.selection?.timeframes,
    activeRun?.tf,
    form.tf,
    sortedActiveTrades,
  ]);
  const resultStrategyOptions = useMemo(() => {
    const byId = new Map();
    const addStrategy = (idRaw, labelRaw) => {
      const id = String(idRaw || "").trim();
      if (!id || byId.has(id)) return;
      byId.set(id, String(labelRaw || id).trim() || id);
    };
    (Array.isArray(activeRun?.selection?.strategy_ids)
      ? activeRun.selection.strategy_ids
      : []
    ).forEach((id) => {
      const strategy = allStrategies.find(
        (item) => String(item?.key || item?.id || "").trim() === String(id || "").trim(),
      );
      addStrategy(id, strategy?.name || id);
    });
    sortedActiveTrades.forEach((trade) =>
      addStrategy(tradeStrategyKey(trade), trade?.strategy_name || tradeStrategyKey(trade)),
    );
    if (activeRun?.strategy_id || activeRun?.strategy_key) {
      addStrategy(
        activeRun?.strategy_id || activeRun?.strategy_key,
        activeRun?.strategy_name || activeRun?.strategy_id || activeRun?.strategy_key,
      );
    }
    return Array.from(byId.entries()).map(([id, label]) => ({ id, label }));
  }, [
    activeRun?.selection?.strategy_ids,
    activeRun?.strategy_id,
    activeRun?.strategy_key,
    activeRun?.strategy_name,
    allStrategies,
    sortedActiveTrades,
  ]);
  const resultFilteredTrades = useMemo(() => {
    const tfFilter = String(resultFilterTf || "all").trim();
    const strategyFilter = String(resultFilterStrategy || "all").trim();
    return sortedActiveTrades.filter((trade) => {
      const tfOk = tfFilter === "all" || tradeTimeframeKey(trade) === tfFilter;
      const strategyOk =
        strategyFilter === "all" || tradeStrategyKey(trade) === strategyFilter;
      return tfOk && strategyOk;
    });
  }, [resultFilterStrategy, resultFilterTf, sortedActiveTrades]);
  useEffect(() => {
    if (resultFilterTf !== "all" && !activeRunTimeframes.includes(resultFilterTf)) {
      setResultFilterTf("all");
    }
    if (
      resultFilterStrategy !== "all" &&
      !resultStrategyOptions.some((item) => item.id === resultFilterStrategy)
    ) {
      setResultFilterStrategy("all");
    }
  }, [activeRunTimeframes, resultFilterStrategy, resultFilterTf, resultStrategyOptions]);
  const chartFilterSignature = [
    activeRun?.run_id || "",
    resultFilterTf,
    resultFilterStrategy,
  ].join("|");
  useEffect(() => {
    setResultChartLoaded(Boolean(activeRun && activeRunTimeframes.length === 1));
    setResultChartLoadKey((value) => value + 1);
  }, [activeRun?.run_id, activeRunTimeframes.length, chartFilterSignature]);
  const effectiveTradeSid = replayPlaying
    ? String(replayActiveTradeSid || replayStartTradeSid || selectedTradeSid || "")
    : String(selectedTradeSid || "");
  const selectedTrade = useMemo(
    () =>
      resultFilteredTrades.find((trade) => String(trade?.sid || "") === effectiveTradeSid) ||
      resultFilteredTrades[0] ||
      null,
    [effectiveTradeSid, resultFilteredTrades],
  );
  const activeChartSymbol = String(
    selectedTrade?.symbol || activeRun?.symbol || form.symbol || "",
  )
    .trim()
    .toUpperCase();
  const activeChartTf = String(
    selectedTrade?.tf || selectedTrade?.timeframe || activeRun?.tf || form.tf || "1",
  ).trim();
  const activeChartTfKey = timeframeLabel(activeChartTf);
  const selectedResultTf = String(resultFilterTf || "all").trim();
  const selectedResultStrategy = String(resultFilterStrategy || "all").trim();
  const chartTimeframes = useMemo(() => {
    if (activeRunTimeframes.length === 1) return activeRunTimeframes;
    if (selectedResultTf && selectedResultTf !== "all") return [selectedResultTf];
    if (selectedResultStrategy && selectedResultStrategy !== "all") {
      return activeRunTimeframes;
    }
    return [];
  }, [activeRunTimeframes, selectedResultStrategy, selectedResultTf]);
  const canLoadResultChart =
    Boolean(activeRun) &&
    chartTimeframes.length > 0 &&
    (
      selectedResultTf !== "all" ||
      selectedResultStrategy !== "all" ||
      resultStrategyOptions.length <= 1 ||
      activeRunTimeframes.length === 1
    );
  const filteredActiveTrades = useMemo(() => {
    if (!resultFilteredTrades.length) return [];
    return resultFilteredTrades;
  }, [resultFilteredTrades]);
  const deferredFilteredActiveTrades = useDeferredValue(filteredActiveTrades);
  const [visibleTradeCount, setVisibleTradeCount] = useState(
    BACKTEST_TRADES_RENDER_STEP,
  );
  const activeChartTradeLabel = String(
    selectedTrade?.strategy_name ||
      selectedTrade?.strategy_key ||
      activeRun?.strategy_name ||
      activeRun?.strategy_key ||
      "",
  ).trim();
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
  const activeTotalRr = useMemo(() => {
    const totalPnl = Number(activeSummary?.total_pnl);
    if (!Number.isFinite(totalPnl) || !Number.isFinite(oneRValue) || oneRValue <= 0) {
      return null;
    }
    return totalPnl / oneRValue;
  }, [activeSummary?.total_pnl, oneRValue]);
  const selectedTradeIndex = useMemo(
    () =>
      filteredActiveTrades.findIndex(
        (trade) => String(trade?.sid || "") === String(selectedTrade?.sid || ""),
      ),
    [filteredActiveTrades, selectedTrade],
  );
  const tradesByTimeframe = useMemo(() => {
    const grouped = new Map();
    activeRunTimeframes.forEach((tf) => grouped.set(tf, []));
    resultFilteredTrades.forEach((trade) => {
      const tfKey = tradeTimeframeKey(trade);
      if (!grouped.has(tfKey)) grouped.set(tfKey, []);
      grouped.get(tfKey).push(trade);
    });
    return grouped;
  }, [activeRunTimeframes, resultFilteredTrades]);
  const metricsMatrixModel = useMemo(() => {
    if (
      Array.isArray(activeBatchReport?.matrix_rows) &&
      activeBatchReport.matrix_rows.length
    ) {
      const tfFilter = String(resultFilterTf || "all").trim();
      const strategyFilter = String(resultFilterStrategy || "all").trim();
      const sourceTimeframes = sortBacktestMatrixTimeframes(
        (Array.isArray(activeBatchReport?.matrix_timeframes)
          ? activeBatchReport.matrix_timeframes
          : activeRunTimeframes
        ).map((tf) => timeframeLabel(tf)),
      );
      const timeframes =
        tfFilter === "all"
          ? sourceTimeframes
          : sourceTimeframes.filter((tf) => tf === tfFilter);
      const rows = activeBatchReport.matrix_rows
        .filter((row) => {
          const rowStrategyId = String(row?.strategy_id || row?.strategy_name || "").trim();
          return strategyFilter === "all" || rowStrategyId === strategyFilter;
        })
        .map((row) => ({
          ...row,
          cells: (Array.isArray(row?.cells) ? row.cells : []).filter((cell) => {
            const cellTf = timeframeLabel(cell?.tf);
            return tfFilter === "all" || cellTf === tfFilter;
          }),
        }));
      return {
        timeframes,
        rows,
      };
    }
    if (!activeRun) return { timeframes: [], rows: [] };
    const resolvedTfs = sortBacktestMatrixTimeframes(
      activeRunTimeframes.length
        ? activeRunTimeframes
        : [timeframeLabel(activeRun?.tf || form.tf || "1")],
    );
    const strategyName =
      String(
        activeRun?.strategy_name ||
          activeRun?.strategy_key ||
          activeRun?.strategy_id ||
          "Strategy",
      ).trim() || "Strategy";
    const strategyId =
      String(activeRun?.strategy_id || activeRun?.strategy_key || strategyName).trim() ||
      strategyName;
    return {
      timeframes: resolvedTfs,
      rows: [
        {
          strategy_id: strategyId,
          strategy_name: strategyName,
          cells: resolvedTfs.map((tf) => {
            const tfTrades = tradesByTimeframe.get(tf) || [];
            const closedTradeLike = tfTrades.filter(Boolean);
            const totalTrades = closedTradeLike.length;
            const wins = closedTradeLike.filter(
              (trade) =>
                String(trade?.result || "").trim().toLowerCase() === "win" ||
                Number(trade?.pnl_realized ?? trade?.pnl ?? 0) > 0,
            ).length;
            const winRatePct = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
            const totalRealizedR = closedTradeLike.reduce((sum, trade) => {
              const rawR = Number(
                trade?.realized_r ??
                  trade?.r_multiple ??
                  trade?.rr_realized ??
                  trade?.rr ??
                  0,
              );
              return sum + (Number.isFinite(rawR) ? rawR : 0);
            }, 0);
            const totalPlannedOutcomeR = closedTradeLike.reduce((sum, trade) => {
              const rawR = Number(trade?.planned_outcome_r ?? 0);
              return sum + (Number.isFinite(rawR) ? rawR : 0);
            }, 0);
            const plannedOutcomeSamples = closedTradeLike.filter((trade) =>
              Object.prototype.hasOwnProperty.call(trade || {}, "planned_outcome_r"),
            ).length;
            return buildMetricsMatrixCell({
              tf,
              totalTrades,
              winRatePct,
              totalRealizedR,
              totalPlannedOutcomeR,
              symbols: [String(activeRun?.symbol || form.symbol || "").trim().toUpperCase()].filter(Boolean),
              plannedOutcomeSamples,
            });
          }),
        },
      ],
    };
  }, [
    activeBatchReport?.matrix_rows,
    activeBatchReport?.matrix_timeframes,
    activeRun,
    activeRunTimeframes,
    form.tf,
    resultFilterStrategy,
    resultFilterTf,
    tradesByTimeframe,
  ]);
  const metricsMatrixHeaderSymbol = useMemo(() => {
    if (Array.isArray(activeBatchReport?.selection?.symbols) && activeBatchReport.selection.symbols.length === 1) {
      return String(activeBatchReport.selection.symbols[0] || "").trim().toUpperCase();
    }
    if (activeRun?.symbol) {
      return String(activeRun.symbol || "").trim().toUpperCase();
    }
    if (form.symbol) {
      return String(form.symbol || "").trim().toUpperCase();
    }
    return "SYMBOL";
  }, [activeBatchReport?.selection?.symbols, activeRun?.symbol, form.symbol]);
  const selectedStrategyRuns = useMemo(
    () =>
      runs.filter((run) =>
        runMatchesStrategySelection(
          run,
          selectedStrategyKeys.length
            ? selectedStrategyKeys
            : [selectedExistingStrategy?.key, selectedExistingStrategy?.id, form.strategy_key],
        ),
      ),
    [form.strategy_key, runs, selectedExistingStrategy, selectedStrategyKeys],
  );
  const historyStrategyOptions = useMemo(() => {
    const byId = new Map();
    runs.forEach((run) => {
      const id = String(run?.strategy_key || run?.strategy_id || "").trim();
      const label = String(run?.strategy_name || id || "").trim();
      if (!id || !label || byId.has(id)) return;
      byId.set(id, label);
    });
    return [
      { value: HISTORY_STRATEGY_FILTER_ALL, label: "All Strategies" },
      ...Array.from(byId.entries())
        .sort((left, right) => String(left[1] || "").localeCompare(String(right[1] || "")))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [runs]);
  const historyRuns = useMemo(() => {
    const selectedFilter = String(historyStrategyFilter || HISTORY_STRATEGY_FILTER_ALL).trim();
    return [...runs]
      .filter((run) => {
        if (selectedFilter === HISTORY_STRATEGY_FILTER_ALL) return true;
        return String(run?.strategy_key || run?.strategy_id || "").trim() === selectedFilter;
      })
      .sort((left, right) => {
        const cmp = compareTimeDesc(
          left?.run_at || left?.created_at || left?.updated_at || left?.summary?.created_at,
          right?.run_at || right?.created_at || right?.updated_at || right?.summary?.created_at,
        );
        if (cmp !== 0) return cmp;
        return String(right?.run_id || "").localeCompare(String(left?.run_id || ""));
      });
  }, [historyStrategyFilter, runs]);
  useEffect(() => {
    if (
      historyStrategyFilter !== HISTORY_STRATEGY_FILTER_ALL &&
      !historyStrategyOptions.some((item) => item.value === historyStrategyFilter)
    ) {
      setHistoryStrategyFilter(HISTORY_STRATEGY_FILTER_ALL);
    }
  }, [historyStrategyFilter, historyStrategyOptions]);
  const replaySummary = useMemo(() => {
    if (!replayPlaying || !replayProgress) return null;
    const replayTimeSec = Number(replayProgress.clockTimeSec);
    if (!Number.isFinite(replayTimeSec) || replayTimeSec <= 0) return null;
    const replayTimeMs = replayTimeSec * 1000;
    const closedTrades = filteredActiveTrades.filter((trade) => {
      const closedAtMs = toTimeMs(trade?.closed_at);
      return Number.isFinite(closedAtMs) && closedAtMs <= replayTimeMs;
    });
    const wins = closedTrades.filter(
      (trade) => Number(trade?.pnl_realized || 0) > 0,
    ).length;
    const totalPnl = closedTrades.reduce(
      (sum, trade) => sum + Number(trade?.pnl_realized || 0),
      0,
    );
    const totalRealizedR = closedTrades.reduce(
      (sum, trade) =>
        sum +
        Number(
          trade?.realized_r ??
            trade?.r_multiple ??
            trade?.rr_realized ??
            trade?.rr ??
            0,
        ),
      0,
    );
    const totalPlannedOutcomeR = closedTrades.reduce(
      (sum, trade) => sum + Number(trade?.planned_outcome_r || 0),
      0,
    );
    const plannedOutcomeSamples = closedTrades.filter((trade) =>
      Object.prototype.hasOwnProperty.call(trade || {}, "planned_outcome_r"),
    ).length;
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
      totalRealizedR,
      totalPlannedOutcomeR,
      plannedOutcomeSamples,
      winRate,
    };
  }, [
    activeSummaryRangeLabel,
    replayPlaying,
    replayProgress,
    filteredActiveTrades,
  ]);
  const filteredSummary = useMemo(() => {
    const closedTrades = filteredActiveTrades.filter(Boolean);
    const wins = closedTrades.filter(
      (trade) =>
        String(trade?.result || "").trim().toLowerCase() === "win" ||
        Number(trade?.pnl_realized ?? trade?.pnl ?? 0) > 0,
    ).length;
    const totalPnl = closedTrades.reduce(
      (sum, trade) => sum + Number(trade?.pnl_realized ?? trade?.pnl ?? 0),
      0,
    );
    const totalRealizedR = closedTrades.reduce(
      (sum, trade) =>
        sum +
        Number(
          trade?.realized_r ??
            trade?.r_multiple ??
            trade?.rr_realized ??
            trade?.rr ??
            0,
        ),
      0,
    );
    const totalPlannedOutcomeR = closedTrades.reduce(
      (sum, trade) => sum + Number(trade?.planned_outcome_r || 0),
      0,
    );
    const plannedOutcomeSamples = closedTrades.filter((trade) =>
      Object.prototype.hasOwnProperty.call(trade || {}, "planned_outcome_r"),
    ).length;
    return {
      totalTrades: closedTrades.length,
      winRate: closedTrades.length ? (wins / closedTrades.length) * 100 : 0,
      totalPnl,
      totalRealizedR,
      totalPlannedOutcomeR,
      plannedOutcomeSamples,
    };
  }, [filteredActiveTrades]);
  const summaryRangeText =
    replaySummary?.rangeLabel || activeSummaryRangeLabel || activeDataRangeLabel || "-";
  const summaryParamsText = replaySummary ? "" : formatBacktestSummaryParams(activeSummary);
  const summaryTradesCount = replaySummary
    ? replaySummary.totalTrades
    : filteredSummary.totalTrades;
  const summaryRealizedRValue = replaySummary
    ? replaySummary.totalRealizedR
    : filteredSummary.totalRealizedR;
  const summaryPlannedOutcomeRValue = replaySummary
    ? replaySummary.totalPlannedOutcomeR
    : filteredSummary.totalPlannedOutcomeR;
  const summaryPlannedOutcomeAvailable = replaySummary
    ? Number(replaySummary?.plannedOutcomeSamples || 0) > 0
    : Number(filteredSummary?.plannedOutcomeSamples || 0) > 0;
  const summaryWinRateValue = replaySummary
    ? replaySummary.winRate
    : filteredSummary.winRate;
  const summaryTotalPnlValue = replaySummary
    ? replaySummary.totalPnl
    : filteredSummary.totalPnl;
  const activeRunSummaryTitle = [
    `${Math.round(Number(summaryTradesCount || 0))} trades`,
    `WR ${formatNumber(summaryWinRateValue, 0)}%`,
    `Real ${formatNumber(summaryRealizedRValue, 1)}r`,
    `Plan ${summaryPlannedOutcomeAvailable ? `${formatNumber(summaryPlannedOutcomeRValue, 1)}r` : "-"}`,
    `$${formatNumber(summaryTotalPnlValue, 0)}`,
    summaryRangeText,
    summaryParamsText,
  ]
    .filter(Boolean)
    .join(" · ");
  const resultPanelHeaderContent = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "nowrap",
        width: "100%",
        minWidth: 0,
      }}
    >
      <div className="panel-label" style={{ flex: "0 0 auto" }}>
        Result
      </div>
      {ephemeralRunDetail ? (
        <>
          <input
            type="text"
            value={ephemeralRunSaveName}
            onChange={(event) => setEphemeralRunSaveName(event.target.value)}
            className="text-input"
            placeholder="Backtest name"
            style={{
              flex: "0 1 280px",
              minWidth: 140,
              maxWidth: 320,
              height: 28,
              fontSize: 11,
            }}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={savingRun}
            onClick={handleSaveRun}
            style={{ minHeight: 28, padding: "0 9px", fontSize: 10 }}
          >
            {savingRun ? "Saving..." : "Save"}
          </button>
        </>
      ) : (
        <>
          <InputComboSelect
            value={selectedRunId || ""}
            onChange={(event) => {
              const nextRunId = String(event.target.value || "").trim();
              if (!nextRunId) return;
              setEphemeralRunDetail(null);
              setEphemeralRunSaveName("");
              setSelectedRunId(nextRunId);
              navigate(
                buildBacktestsDetailUrl(nextRunId, {
                  strategyId: String(
                    activeRun?.strategy_key ||
                      activeRun?.strategy_id ||
                      selectedStrategy?.key ||
                      selectedStrategy?.id ||
                      form.strategy_key ||
                      DEFAULT_BACKTEST_STRATEGY_ID,
                  ).trim(),
                  params: {
                    symbol: String(activeRun?.symbol || form.symbol || "").trim().toUpperCase(),
                    tf:
                      normalizeBacktestTimeframeValue(activeRun?.tf || "", "") ||
                      normalizeTimeframeSelection(form, "1")[0] ||
                      form.tf,
                  },
                  basePath: backtestsBasePath,
                }),
              );
            }}
            searchable
            searchPlaceholder="Filter strategy runs..."
            style={{ flex: "0 1 300px", minWidth: 160, maxWidth: 340, height: 28, fontSize: 11 }}
          >
            {selectedStrategyRuns.map((run) => (
              <option key={run.run_id} value={run.run_id}>
                {formatRunSelectorLabel(run)}
              </option>
            ))}
          </InputComboSelect>
          <button
            type="button"
            className="secondary-button"
            onClick={() => handleLeftTabChange("history")}
            style={{ minHeight: 28, padding: "0 9px", fontSize: 10 }}
            title="Open History tab"
          >
            &gt;&gt;
          </button>
        </>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "nowrap",
          marginLeft: "auto",
          justifyContent: "flex-end",
          minWidth: 0,
          flex: "0 1 auto",
        }}
      >
        <label
          className="field-label"
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            flex: "0 0 auto",
          }}
        >
          <span>TF</span>
          <InputComboSelect
            value={resultFilterTf}
            onChange={(event) => setResultFilterTf(event.target.value)}
            style={{ minWidth: 70, height: 28, fontSize: 11 }}
          >
            <option value="all">All TFs</option>
            {activeRunTimeframes.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </InputComboSelect>
        </label>
        <label
          className="field-label"
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            flex: "0 1 auto",
            minWidth: 0,
          }}
        >
          <span>Strategy</span>
          <InputComboSelect
            value={resultFilterStrategy}
            onChange={(event) => setResultFilterStrategy(event.target.value)}
            searchable
            searchPlaceholder="Filter strategies..."
            style={{ minWidth: 150, maxWidth: 190, height: 28, fontSize: 11 }}
          >
            <option value="all">All Strategies</option>
            {resultStrategyOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </InputComboSelect>
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={!canLoadResultChart}
          onClick={() => {
            setResultChartLoaded(true);
            setResultChartLoadKey((value) => value + 1);
          }}
          style={{
            minHeight: 28,
            minWidth: 32,
            width: 32,
            padding: 0,
            fontSize: 14,
            lineHeight: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "0 0 auto",
          }}
          title={
            canLoadResultChart
              ? "Refresh chart for the selected TF and/or strategy"
              : "Select a TF or a strategy to load a chart"
          }
          aria-label="Refresh chart"
        >
          ↻
        </button>
      </div>
    </div>
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
        replayStartTradeSid || selectedTrade?.sid || filteredActiveTrades[0]?.sid || "",
      ),
      barsAnalyzed: Math.max(0, Number(activeSummary?.bars_analyzed) || 0),
      currentTradeIndex: selectedTradeIndex,
      totalTrades: filteredActiveTrades.length,
      onSpeedChange: (nextSpeedMs) =>
        setReplaySpeedMs(Math.max(100, Number(nextSpeedMs) || 200)),
      onToggle: () => {
        setReplayPlaying((prev) => {
          const next = !prev;
          if (next) {
            const startSid = String(
              selectedTrade?.sid || filteredActiveTrades[0]?.sid || "",
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
      activeSummary?.bars_analyzed,
      replayPlaying,
      replayStartTradeSid,
      replaySpeedMs,
      selectedTradeIndex,
      selectedRunId,
      selectedTrade?.sid,
      filteredActiveTrades,
    ],
  );
  const openMetricsChartView = useCallback(
    ({ tf = "all", strategyId = "all" } = {}) => {
      const requestedTf = String(tf || "all").trim() || "all";
      const nextTf =
        requestedTf === "all" ? "all" : timeframeLabel(requestedTf) || "all";
      const nextStrategyId = String(strategyId || "all").trim() || "all";
      setActiveTab("backtest");
      setResultFilterTf(nextTf);
      setResultFilterStrategy(nextStrategyId);
      setSelectedTradeSid("");
      setReplayPlaying(false);
      setReplayStartTradeSid("");
      setReplayActiveTradeSid("");
      setReplayProgress(null);
      setResultChartLoaded(true);
      setResultChartLoadKey((value) => value + 1);
    },
    [],
  );
  const batchMetricsTable = Array.isArray(metricsMatrixModel?.rows) &&
    metricsMatrixModel.rows.length ? (
        <div style={{ overflowX: "auto" }}>
          <table className="table-dense" style={{ minWidth: 620, fontSize: 11, marginTop: 2 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", fontSize: 10, fontWeight: 700 }}>Strategy</th>
                {(Array.isArray(metricsMatrixModel?.timeframes)
                  ? metricsMatrixModel.timeframes
                  : []
                ).map((tf) => (
                  <th
                    key={tf}
                    role="button"
                    tabIndex={0}
                    onClick={() => openMetricsChartView({ tf })}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openMetricsChartView({ tf });
                    }}
                    style={{
                      textAlign: "left",
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                    title={`Open ${metricsMatrixHeaderSymbol} ${timeframeLabel(tf)} chart with all strategies`}
                  >
                    <span
                      style={{
                        color: "inherit",
                        font: "inherit",
                        fontWeight: "inherit",
                      }}
                    >
                      {`${metricsMatrixHeaderSymbol} ${timeframeLabel(tf)}`}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metricsMatrixModel.rows.map((row) => (
                <tr key={row.strategy_id || row.strategy_name}>
                  <td
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      openMetricsChartView({
                        tf: "all",
                        strategyId: row.strategy_id || row.strategy_name || "all",
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openMetricsChartView({
                        tf: "all",
                        strategyId: row.strategy_id || row.strategy_name || "all",
                      });
                    }}
                    style={{
                      fontWeight: 700,
                      fontSize: 11,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                    title={`Open all TF charts for ${row.strategy_name || row.strategy_id}`}
                  >
                    <span
                      style={{
                        color: "inherit",
                        font: "inherit",
                        fontWeight: "inherit",
                      }}
                    >
                      {row.strategy_name || row.strategy_id}
                    </span>
                  </td>
                  {(Array.isArray(row.cells) ? row.cells : []).map((cell) => (
                    <td
                      key={`${row.strategy_id || row.strategy_name}:${cell.tf}`}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        openMetricsChartView({
                          tf: cell.tf,
                          strategyId: row.strategy_id || row.strategy_name || "all",
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        openMetricsChartView({
                          tf: cell.tf,
                          strategyId: row.strategy_id || row.strategy_name || "all",
                        });
                      }}
                      style={{
                        fontSize: 11,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                      title={`Open ${metricsMatrixHeaderSymbol} ${timeframeLabel(cell.tf)} chart for ${row.strategy_name || row.strategy_id}`}
                    >
                      <span
                        className={
                          Number(cell?.total_realized_r ?? cell?.total_r ?? 0) > 0
                            ? "money-pos"
                            : Number(cell?.total_realized_r ?? cell?.total_r ?? 0) < 0
                              ? "money-neg"
                              : "money-neutral"
                        }
                      >
                        {formatBatchCellCompact(cell)}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
    ) : null;

  useEffect(() => {
    setReplayPlaying(false);
    setReplayStartTradeSid("");
    setReplayActiveTradeSid("");
    setReplayProgress(null);
  }, [selectedRunId]);

  useEffect(() => {
    setVisibleTradeCount(BACKTEST_TRADES_RENDER_STEP);
  }, [activeRun?.run_id, resultFilterStrategy, resultFilterTf]);

  const visibleTradeItems = useMemo(
    () =>
      deferredFilteredActiveTrades.slice(
        0,
        Math.max(BACKTEST_TRADES_RENDER_STEP, Number(visibleTradeCount) || 0),
      ),
    [deferredFilteredActiveTrades, visibleTradeCount],
  );

  useEffect(() => {
    if (selectedStrategyId === "__new__") return;
    const strategySelectionCleared =
      Array.isArray(form?.strategy_keys) &&
      form.strategy_keys.length === 0 &&
      !String(form?.strategy_key || "").trim();
    if (strategySelectionCleared) {
      if (selectedStrategyId) {
        setSelectedStrategyId("");
      }
      return;
    }
    const routePreferredId = String(resolvedRouteStrategyId || routeStrategyId || "").trim();
    const preferredId = String(routePreferredId || selectedStrategyId || form.strategy_key || "").trim();
    const exists = allStrategies.some(
      (item) => String(item.key || item.id || "") === preferredId,
    );
    if (preferredId && exists) {
      if (selectedStrategyId !== preferredId) {
        setSelectedStrategyId(preferredId);
      }
      if (
        form.strategy_key !== preferredId ||
        !normalizeStrategySelection(form).length
      ) {
        setForm((prev) => ({
          ...prev,
          strategy_key: preferredId,
          strategy_keys: normalizeStrategySelection(prev).length
            ? normalizeStrategySelection(prev)
            : [preferredId],
        }));
      }
      return;
    }
    if (routePreferredId) {
      return;
    }
    const fallbackId = String(
      allStrategies.find(
        (item) =>
          String(item.key || item.id || "") === DEFAULT_BACKTEST_STRATEGY_ID,
      )?.key ||
        allStrategies.find(
          (item) =>
            String(item.key || item.id || "") === DEFAULT_BACKTEST_STRATEGY_ID,
        )?.id ||
        form.strategy_key ||
        allStrategies[0]?.key ||
        allStrategies[0]?.id ||
        "",
    ).trim();
    if (!fallbackId) return;
    if (selectedStrategyId !== fallbackId) {
      setSelectedStrategyId(fallbackId);
    }
    if (form.strategy_key !== fallbackId) {
      setForm((prev) =>
        prev.strategy_key === fallbackId
          ? {
              ...prev,
              strategy_keys: normalizeStrategySelection(prev).length
                ? normalizeStrategySelection(prev)
                : [fallbackId],
            }
          : { ...prev, strategy_key: fallbackId, strategy_keys: [fallbackId] },
      );
    }
  }, [allStrategies, form, resolvedRouteStrategyId, routeStrategyId, selectedStrategyId]);

  useEffect(() => {
    if (!filteredActiveTrades.length) {
      setReplayPlaying(false);
      setReplayActiveTradeSid("");
      setReplayProgress(null);
      return;
    }
    if (!selectedTrade) {
      setSelectedTradeSid(String(filteredActiveTrades[0]?.sid || ""));
    }
  }, [filteredActiveTrades, selectedTrade]);

  useEffect(() => {
    if (replayPlaying) return;
    if (!replayActiveTradeSid) return;
    setSelectedTradeSid(String(replayActiveTradeSid));
    setReplayActiveTradeSid("");
  }, [replayActiveTradeSid, replayPlaying]);

  useEffect(() => {
    if (!activeRun) return;
    if (routeStrategyId && !routeRunId) return;
    setForm((prev) => deriveBacktestFormFromRun(activeRun, prev));
  }, [activeRun, routeRunId, routeStrategyId]);

  useEffect(() => {
    if (!ephemeralRunDetail) {
      setEphemeralRunSaveName("");
      return;
    }
    setEphemeralRunSaveName(buildEphemeralRunSaveName(ephemeralRunDetail));
  }, [ephemeralRunDetail]);

  async function executeBacktestRun() {
    setRunning(true);
    setError("");
    setReplayPlaying(false);
    setReplayStartTradeSid("");
    setReplayActiveTradeSid("");
    setReplayProgress(null);
    setEphemeralRunDetail(null);
    setEphemeralRunSaveName("");
    setSelectedRunDetail(null);
    setSelectedRunId("");
    setSelectedTradeSid("");
    setBatchReport(null);
    navigate(
      buildBacktestsRunUrl(
        String(
          selectedStrategy?.key ||
            selectedStrategy?.id ||
            form.strategy_key ||
            DEFAULT_BACKTEST_STRATEGY_ID,
        ).trim(),
        {
          symbol: form.symbol,
          tf: normalizeTimeframeSelection(form, "1")[0] || form.tf,
        },
        backtestsBasePath,
      ),
      { replace: false },
    );
    try {
      const strategySelectionCleared =
        Array.isArray(form?.strategy_keys) &&
        form.strategy_keys.length === 0 &&
        !String(form?.strategy_key || "").trim();
      const requestedStrategyKeys = strategySelectionCleared
        ? []
        : selectedStrategyKeys.length
        ? selectedStrategyKeys
        : [String(
            selectedStrategy?.key ||
              selectedStrategy?.id ||
              form.strategy_key ||
              DEFAULT_BACKTEST_STRATEGY_ID,
          ).trim()];
      if (!requestedStrategyKeys.filter(Boolean).length) {
        throw new Error("Select at least one strategy before running a backtest.");
      }
      const requestedTimeframes = selectedTimeframes.length
        ? selectedTimeframes
        : [String(form.tf || "1").trim()];
      const payload = {
        ...form,
        symbol: form.symbol,
        strategy_key: String(requestedStrategyKeys[0] || DEFAULT_BACKTEST_STRATEGY_ID).trim(),
        strategy_keys: requestedStrategyKeys,
        strategy_ids: requestedStrategyKeys,
        tf: String(requestedTimeframes[0] || form.tf || "1").trim(),
        tfs: requestedTimeframes,
        timeframes: requestedTimeframes,
        limit: form.limit === "all" ? 0 : Number(form.limit || 500),
        limit_mode: form.limit_mode,
        direction: String(form.direction || "all").trim().toLowerCase(),
        session: String(form.session || "Any").trim() || "Any",
        scan_mode: "backtest",
        skip_conditions: false,
        persist: false,
        one_r_value: form.one_r_value,
      };
      const sessions = requestedStrategyKeys.flatMap((strategyKey) =>
        [form.symbol].flatMap((symbol) =>
          requestedTimeframes.map((tf) => ({
            strategyKey,
            symbol,
            tf,
          })),
        ),
      );
      let res = null;
      if (sessions.length > 1) {
        const sessionResults = [];
        const sessionFailures = [];
        for (const [index, session] of sessions.entries()) {
          setBacktestRunProgress({
            completed: index,
            total: sessions.length,
            label: `${session.symbol} ${timeframeLabel(session.tf)}`,
          });
          try {
            const result = await api.runBacktest({
              ...payload,
              symbol: session.symbol,
              strategy_key: session.strategyKey,
              strategy_id: session.strategyKey,
              strategy_keys: [session.strategyKey],
              strategy_ids: [session.strategyKey],
              tf: session.tf,
              tfs: [session.tf],
              timeframes: [session.tf],
            });
            sessionResults.push({ ...session, result });
          } catch (sessionError) {
            sessionFailures.push({
              ...session,
              error: String(sessionError?.message || sessionError || "Backtest failed"),
            });
          }
        }
        setBacktestRunProgress({
          completed: sessions.length,
          total: sessions.length,
          label: "Finalizing",
        });
        const selectedStrategiesForBatch = requestedStrategyKeys.map((strategyKey) => {
          const found = allStrategies.find(
            (item) => String(item?.key || item?.id || "").trim() === strategyKey,
          );
          return found || { key: strategyKey, id: strategyKey, name: strategyKey };
        });
        res = buildClientBatchBacktestResult({
          payload,
          sessionResults,
          sessionFailures,
          strategies: selectedStrategiesForBatch,
          symbols: [form.symbol],
          timeframes: requestedTimeframes,
          limit: payload.limit,
        });
      } else {
        res = await api.runBacktest(payload);
      }
      if (res) {
        startTransition(() => {
          setEphemeralRunDetail(res);
          setBatchReport(res?.report || null);
          setSelectedRunDetail(null);
          setSelectedRunId("");
          setEphemeralRunSaveName(buildEphemeralRunSaveName(res));
          setSelectedTradeSid(pickInitialTradeSid(res?.trades));
        });
      }
    } catch (runError) {
      setError(String(runError?.message || runError || "Backtest failed"));
    } finally {
      setBacktestRunProgress(null);
      setRunning(false);
    }
  }

  async function handleRun(event) {
    event.preventDefault();
    await executeBacktestRun();
  }

  useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    const autoRun = params.get("autorun") === "1";
    if (!autoRun || running) return;
    const strategyId = String(params.get("strategy") || routeStrategyId || "").trim();
    const symbol = String(params.get("symbol") || "").trim().toUpperCase();
    const tf = normalizeBacktestTimeframeValue(
      params.get("tf") || params.get("timeframe") || "",
      "",
    );
    const autoRunKey = JSON.stringify({
      strategyId,
      symbol,
      tf,
    });
    if (routeAutoRunKeyRef.current === autoRunKey) return;
    if (activeTab !== "backtest") return;
    if (strategyId && form.strategy_key !== strategyId) return;
    if (symbol && String(form.symbol || "").trim().toUpperCase() !== symbol) return;
    if (tf && !normalizeTimeframeSelection(form, "1").includes(tf)) return;
    routeAutoRunKeyRef.current = autoRunKey;
    void executeBacktestRun().finally(() => {
      navigate(
        buildBacktestsRunUrl(
          strategyId || form.strategy_key || DEFAULT_BACKTEST_STRATEGY_ID,
          {
            symbol: symbol || form.symbol,
            tf: tf || form.tf,
          },
          backtestsBasePath,
        ),
        { replace: true },
      );
    });
  }, [activeTab, backtestsBasePath, form, locationSearch, navigate, routeStrategyId, running]);

  async function handleSaveRun() {
    if (!ephemeralRunDetail) return;
    setSavingRun(true);
    setError("");
    try {
      const requestedRunId =
        String(ephemeralRunSaveName || "")
          .trim()
          .replace(/[^a-zA-Z0-9._ -]/g, "_") ||
        buildEphemeralRunSaveName(ephemeralRunDetail);
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
        navigate(
          buildBacktestsDetailUrl(runId, {
            strategyId: String(
              res?.run?.strategy_key ||
                res?.run?.strategy_id ||
                form.strategy_key ||
                DEFAULT_BACKTEST_STRATEGY_ID,
            ).trim(),
            params: {
              symbol: String(res?.run?.symbol || form.symbol || "").trim().toUpperCase(),
              tf:
                normalizeBacktestTimeframeValue(res?.run?.tf || "", "") ||
                normalizeTimeframeSelection(form, "1")[0] ||
                form.tf,
            },
            basePath: backtestsBasePath,
          }),
        );
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

  function handleStrategySelect(strategyId) {
    const nextId = String(strategyId || "").trim();
    if (!nextId) return;
    setDraftStrategySeed(null);
    setSelectedStrategyId(nextId);
    setForm((prev) => ({
      ...prev,
      strategy_key: nextId,
      strategy_keys: normalizeStrategySelection(prev).includes(nextId)
        ? normalizeStrategySelection(prev)
        : [nextId],
    }));
    if (activeTab === "strategies" || editorHashActive(location)) {
      navigate(buildBacktestsStrategyUrl(nextId, "#edit", backtestsBasePath), { replace: false });
    }
  }

  function handleOpenStrategyEditor(strategyOrId) {
    const nextId = String(
      strategyOrId?.id || strategyOrId?.key || strategyOrId || "",
    ).trim();
    if (!nextId) return;
    setDraftStrategySeed(null);
    setSelectedStrategyId(nextId);
    setForm((prev) => ({
      ...prev,
      strategy_key: nextId,
      strategy_keys: normalizeStrategySelection(prev).includes(nextId)
        ? normalizeStrategySelection(prev)
        : [nextId],
    }));
    setActiveTab("strategies");
    navigate(buildBacktestsStrategyUrl(nextId, "#edit", backtestsBasePath), { replace: false });
  }

  function handleRuleTesterRun() {
    const nextStrategy = createRuleTestStrategy({
      symbol: ruleTester.symbol,
      tf: timeframeLabel(ruleTester.tf),
      ruleTree: buildRuleDraftFromExpression(ruleTester.rule?.when),
      ruleName: ruleTester.rule?.name,
      ruleAbbr: ruleTester.rule?.abbr,
      ruleBias: ruleTester.rule?.bias,
    });
    if (!nextStrategy) {
      setError("Build a valid rule before testing.");
      return;
    }
    setError("");
    setRuleTestMarkerSummary({ status: "scanning", total: 0, objectsByTf: {} });
    setTestedRuleStrategy(nextStrategy);
    setRuleTestRunKey((current) => current + 1);
  }

  const handleRuleTestMarkersChange = useCallback((summary = {}) => {
    setRuleTestMarkerSummary({
      status: "done",
      total: Number(summary?.resultCount ?? summary?.total ?? 0),
      rawTotal: Number(summary?.total || 0),
      objectsByTf:
        summary?.objectsByTf && typeof summary.objectsByTf === "object"
          ? summary.objectsByTf
          : {},
    });
  }, []);

  async function handleSaveRuleConfig() {
    const payload = buildRuleConfigSavePayload(ruleTester.rule);
    if (!payload.condition || !Object.keys(payload.condition || {}).length) {
      setError("Build a valid rule before saving.");
      return;
    }
    setSavingRule(true);
    setError("");
    try {
      const result = await api.saveRule(payload);
      const item = result?.item || payload;
      await loadRulesCatalog();
      setRuleTester((prev) => ({
        ...prev,
        rule: stripRuleActions(normalizeRuleDraft({
          ...prev.rule,
          id: item.id || payload.id,
          abbr: item.abbr || payload.abbr,
          icon: item.icon || payload.icon,
          family: item.family || payload.family,
          outputs: item.outputs || payload.outputs,
          name: item.name || payload.name,
          when: item.condition || payload.condition,
        })),
      }));
    } catch (saveError) {
      const status = Number(saveError?.apiRequest?.status || saveError?.apiResponse?.status || 0);
      setError(
        status === 404
          ? "Rule save endpoint is unavailable. Restart the API server so /api/rules is loaded, then try Save again."
          : String(saveError?.message || saveError || "Failed to save rule"),
      );
    } finally {
      setSavingRule(false);
    }
  }

  function handleRuleLibraryPick(item) {
    if (!item?.tree) return;
    const nextTree = cloneRuleTestTreeWithFreshIds(
      ensureRuleTestRootGroup(cloneJson(item.tree)),
    );
    const nextRule = stripRuleActions(normalizeRuleDraft({
      ...(ruleTester.rule || createEmptyRuleDraft({ name: item.label || "Rule Test", actions: [] })),
      id: item.rule_id || ruleTester.rule?.id,
      abbr: item.abbr || ruleTester.rule?.abbr,
      icon: item.icon || ruleTester.rule?.icon,
      family: item.family || ruleTester.rule?.family,
      outputs: item.outputs || ruleTester.rule?.outputs,
      name: item.name || item.label || ruleTester.rule?.name || "Rule Test",
      when: buildRuleExpressionFromDraft(nextTree) || { and: [] },
    }));
    setRuleEditorTab("edit");
    setRuleTester((prev) => ({
      ...prev,
      symbol: item.symbol || prev.symbol,
      tf: item.tf
        ? String(
            TIMEFRAME_OPTIONS.find((option) => timeframeLabel(option.value) === timeframeLabel(item.tf))?.value ||
              prev.tf,
          )
        : prev.tf,
      rule: nextRule,
    }));
    setTestedRuleStrategy(null);
    setRuleTestMarkerSummary(null);
  }

  function handleOpenStrategyBacktest(strategyOrId) {
    const nextStrategy =
      strategyOrId && typeof strategyOrId === "object" ? strategyOrId : null;
    const nextId = String(
      nextStrategy?.id || nextStrategy?.key || strategyOrId || "",
    ).trim();
    if (!nextId) return;
    const nextSymbol = String(nextStrategy?.market?.symbol || "").trim().toUpperCase();
    const nextTf = normalizeBacktestTimeframeValue(nextStrategy?.market?.tf, "");
    setDraftStrategySeed(null);
    setEphemeralRunDetail(null);
    setEphemeralRunSaveName("");
    setSelectedRunDetail(null);
    setSelectedRunId("");
    setSelectedTradeSid("");
    setBatchReport(null);
    setSelectedStrategyId(nextId);
    setForm((prev) => ({
      ...prev,
      strategy_key: nextId,
      strategy_keys: [nextId],
      symbol: nextSymbol || prev.symbol,
      tf: nextTf || prev.tf,
      tfs: nextTf ? [nextTf] : normalizeTimeframeSelection(prev, "1"),
    }));
    setActiveTab("backtest");
    navigate(
      buildBacktestsRunUrl(nextId, {
        autorun: "1",
        symbol: nextSymbol,
        tf: nextTf,
      }, backtestsBasePath),
      { replace: false },
    );
  }

  async function handleRunStrategyBatch({ strategy = null, symbols = [], timeframes = [] } = {}) {
    setError("");
    const strategyId = String(strategy?.id || strategy?.key || "").trim();
    const res = await api.runBacktestBatch({
      symbols,
      timeframes,
      strategy_ids: strategyId ? [strategyId] : selectedStrategyKeys,
      persist: false,
      scan_mode: "backtest",
      skip_conditions: false,
      limit: form.limit === "all" ? 0 : Number(form.limit || 500),
      limit_mode: form.limit_mode,
      limit_bars_value: form.limit_bars_value,
      limit_days_value: form.limit_days_value,
      direction: String(form.direction || "all").trim().toLowerCase(),
      session: String(form.session || "Any").trim() || "Any",
      one_r_value: form.one_r_value,
    });
    return res;
  }

  function handleCreateStrategyDraft() {
    const draft = buildNewStrategyDraft(strategyExample, {
      symbol: form.symbol,
      tf: form.tf,
    });
    setDraftStrategySeed(draft);
    setSelectedStrategyId("__new__");
    setActiveTab("strategies");
    navigate(`${backtestsBasePath}#edit`, { replace: false });
  }

  async function handleSaveStrategy(payload) {
    const sourceId = String(payload?.id || "").trim();
    const existingCustom = customStrategies.find(
      (item) =>
        String(item?.id || "") === sourceId &&
        String(item?.kind || "").trim() === "custom",
    );
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
      navigate(
        buildBacktestsStrategyUrl(String(item.id), "#edit", backtestsBasePath),
        { replace: false },
      );
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
      navigate(
        buildBacktestsStrategyUrl(String(item.id), "#edit", backtestsBasePath),
        { replace: false },
      );
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

  function handleLeftTabChange(nextValue) {
    const nextTab = String(nextValue || "backtest").trim().toLowerCase() || "backtest";
    const activeStrategyId = String(
      activeRun?.strategy_key ||
        activeRun?.strategy_id ||
        selectedStrategy?.key ||
        selectedStrategy?.id ||
        form.strategy_key ||
        DEFAULT_BACKTEST_STRATEGY_ID,
    ).trim();
    const activeRunRouteId = String(routeRunId || selectedRunId || activeRun?.run_id || "").trim();
    const activeSymbol = String(activeRun?.symbol || form.symbol || "").trim().toUpperCase();
    const activeTf =
      normalizeBacktestTimeframeValue(activeRun?.tf || "", "") ||
      normalizeTimeframeSelection(form, "1")[0] ||
      form.tf ||
      "";
    setActiveTab(nextTab);
    if (nextTab === "rules") {
      navigate(`${backtestsBasePath}#rules`, { replace: false });
      return;
    }
    if (nextTab === "history") {
      navigate(
        activeRunRouteId
          ? buildBacktestsDetailUrl(activeRunRouteId, {
              strategyId: activeStrategyId,
              params: {
                symbol: activeSymbol,
                tf: activeTf,
              },
              basePath: backtestsBasePath,
              hash: "#history",
            })
          : `${backtestsBasePath}#history`,
        { replace: false },
      );
      return;
    }
    if (nextTab === "strategies") {
      navigate(`${backtestsBasePath}#edit`, { replace: false });
      return;
    }
    navigate(
      activeRunRouteId
        ? buildBacktestsDetailUrl(activeRunRouteId, {
            strategyId: activeStrategyId,
            params: {
              symbol: activeSymbol,
              tf: activeTf,
            },
            basePath: backtestsBasePath,
          })
        : buildBacktestsRunUrl(
            activeStrategyId,
            {
              symbol: activeSymbol,
              tf: activeTf,
            },
            backtestsBasePath,
          ),
      { replace: false },
    );
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
        navigate(backtestsBasePath);
      }
      await loadRuns("");
    } catch (deleteError) {
      setError(String(deleteError?.message || deleteError || "Failed to delete backtest"));
    }
  }

  async function handleDeleteVisibleRuns() {
    if (!historyRuns.length) return;
    const count = historyRuns.length;
    const ok = await confirm({
      title: "Delete visible backtests?",
      message: `Delete ${count} visible backtest ${count === 1 ? "run" : "runs"} from history?`,
      confirmLabel: "Delete All",
      tone: "danger",
    });
    if (!ok) return;
    setError("");
    try {
      for (const run of historyRuns) {
        const runId = String(run?.run_id || "").trim();
        if (!runId) continue;
        await api.deleteBacktest(runId);
      }
      const visibleRunIds = new Set(
        historyRuns.map((run) => String(run?.run_id || "").trim()).filter(Boolean),
      );
      if (visibleRunIds.has(String(selectedRunId || "").trim())) {
        setSelectedRunId("");
        setSelectedRunDetail(null);
        setSelectedTradeSid("");
        navigate(`${backtestsBasePath}#history`, { replace: false });
      }
      await loadRuns("");
    } catch (deleteError) {
      setError(
        String(deleteError?.message || deleteError || "Failed to delete visible backtests"),
      );
    }
  }

  const runnerControls = (
    <form onSubmit={handleRun}>
      <div className="stack-layout form-item" style={{ gap: 12 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
        >
          <label className="stack-layout" style={{ gap: 5 }}>
            <span className="minor-text">Strategies</span>
            <InputComboSelect
              value={selectedStrategyKeys}
              multiple
              searchable
              onChange={(event) => {
                const nextValues = normalizeSelectionList(event?.target?.values);
                setForm((prev) => ({
                  ...prev,
                  strategy_key: nextValues[0] || "",
                  strategy_keys: nextValues,
                }));
                setSelectedStrategyId(nextValues[0] || "");
              }}
            >
              {strategyOptions.map((item) => (
                <option key={item.key || item.id} value={item.key || item.id}>
                  {formatStrategyOptionLabel(item)}
                </option>
              ))}
            </InputComboSelect>
          </label>

          <label className="stack-layout" style={{ gap: 5 }}>
            <span className="minor-text">Symbols</span>
            <InputComboSelect
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
            </InputComboSelect>
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
            <span className="minor-text">TFs</span>
            <InputComboSelect
              value={selectedTimeframes}
              multiple
              searchable
              onChange={(event) => {
                const nextValues = normalizeSelectionList(event?.target?.values);
                if (!nextValues.length) return;
                setForm((prev) => ({ ...prev, tf: nextValues[0], tfs: nextValues }));
              }}
            >
              {TIMEFRAME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </InputComboSelect>
          </label>
          <label className="stack-layout" style={{ gap: 5 }}>
            <span className="minor-text">Bars</span>
            <BacktestBarsSelector
              timeframe={form.tf}
              barsOptions={BARS_OPTIONS}
              value={form}
              onChange={(patch) =>
                setForm((prev) => ({
                  ...prev,
                  ...patch,
                }))
              }
            />
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
            <InputComboSelect
              value={form.session || "Any"}
              searchable
              onChange={(event) =>
                setForm((prev) => ({ ...prev, session: event.target.value }))
              }
            >
              {BACKTEST_SESSION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </InputComboSelect>
          </label>
          <label className="stack-layout" style={{ gap: 5 }}>
            <span className="minor-text">Direction</span>
            <InputComboSelect
              value={form.direction || "all"}
              searchable
              onChange={(event) =>
                setForm((prev) => ({ ...prev, direction: event.target.value }))
              }
            >
              {BACKTEST_DIRECTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </InputComboSelect>
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
          <button
            type="submit"
            className="primary-button"
            disabled={running || !form.symbol}
            style={{ flex: "1 1 auto" }}
          >
            {running && backtestRunProgress?.total
              ? `Running ${Math.min(
                  Number(backtestRunProgress.completed || 0) + 1,
                  Number(backtestRunProgress.total || 0),
                )}/${backtestRunProgress.total}`
              : running
                ? "Running..."
                : "Run Backtest"}
          </button>
        </div>
      </div>
    </form>
  );

  const runList = (
    <div className="stack-layout" style={{ gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <InputComboSelect
          value={historyStrategyFilter}
          onChange={(event) =>
            setHistoryStrategyFilter(
              String(event?.target?.value || HISTORY_STRATEGY_FILTER_ALL).trim() ||
                HISTORY_STRATEGY_FILTER_ALL,
            )
          }
          searchable
          searchPlaceholder="Filter strategy..."
          style={{ flex: "1 1 220px", minWidth: 0, height: 32, fontSize: 11 }}
        >
          {historyStrategyOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </InputComboSelect>
        <button
          type="button"
          className="secondary-button"
          disabled={!historyRuns.length}
          onClick={handleDeleteVisibleRuns}
          title="Delete all visible history"
          style={{
            minHeight: 32,
            minWidth: 32,
            padding: "0 10px",
            fontSize: 12,
            color: historyRuns.length ? "#f87171" : undefined,
          }}
        >
          X
        </button>
      </div>
      <ListItems>
      {historyRuns.length ? (
        historyRuns.map((run) => {
          const isActive = selectedRunId === run.run_id;
          const pnl = Number(run?.summary?.total_pnl || 0);
          const openRun = () => {
            const nextRunId = String(run?.run_id || "").trim();
            if (!nextRunId) return;
            setEphemeralRunDetail(null);
            setEphemeralRunSaveName("");
            setSelectedRunId(nextRunId);
            setSelectedTradeSid("");
            setReplayPlaying(false);
            setReplayStartTradeSid("");
            setReplayActiveTradeSid("");
            setReplayProgress(null);
            setActiveTab("backtest");
            navigate(
              buildBacktestsDetailUrl(nextRunId, {
                strategyId: String(
                  run?.strategy_key ||
                    run?.strategy_id ||
                    selectedStrategy?.key ||
                    selectedStrategy?.id ||
                    form.strategy_key ||
                    DEFAULT_BACKTEST_STRATEGY_ID,
                ).trim(),
                params: {
                  symbol: String(run?.symbol || form.symbol || "").trim().toUpperCase(),
                  tf:
                    normalizeBacktestTimeframeValue(run?.tf || "", "") ||
                    normalizeTimeframeSelection(form, "1")[0] ||
                    form.tf,
                },
                basePath: backtestsBasePath,
              }),
            );
          };
          return (
            <div
              key={run.run_id}
              role="button"
              tabIndex={0}
              className={`backtests-item-card card-item${isActive ? " selected-item backtests-item-card--active" : ""}`}
              onClick={openRun}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                openRun();
              }}
            >
              <div className="stack-layout backtests-item-card__body backtests-item-card__body--run" style={{ gap: 2, width: "100%" }}>
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
                    {run?.batch_mix
                      ? formatRunSelectorLabel(run)
                      : `${run.strategy_name || run.strategy_key} - ${timeframeLabel(run.tf)} - ${run.symbol || "-"}`}
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
                      className="backtests-item-card__action"
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveTab("backtest");
                        openRun();
                      }}
                    >
                      &gt;&gt;
                    </button>
                    <button
                      type="button"
                      className="backtests-item-card__action backtests-item-card__action--danger"
                      onClick={async (event) => {
                        event.stopPropagation();
                        await handleDeleteRun(run);
                      }}
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
                    flexWrap: "wrap",
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
                    Real{" "}
                    <span style={{ fontWeight: 700 }}>
                      {formatNumber(
                        run?.summary?.total_realized_r ?? run?.summary?.total_r ?? 0,
                        1,
                      )}r
                    </span>
                  </span>
                  <span>
                    Plan{" "}
                    <span style={{ fontWeight: 700 }}>
                      {Object.prototype.hasOwnProperty.call(run?.summary || {}, "total_planned_outcome_r")
                        ? `${formatNumber(run?.summary?.total_planned_outcome_r || 0, 1)}r`
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
        <div className="empty-state">
          {runs.length
            ? "No backtests match the selected strategy filter."
            : "No backtest runs yet."}
        </div>
      )}
      </ListItems>
    </div>
  );

  const strategiesList = (
    <ListItems>
      {allStrategies.map((item) => {
        const id = item.key || item.id;
        const active = String(selectedStrategyId || form.strategy_key || "") === String(id || "");
        const sourceMeta = strategyStatusMeta(item);
        const backtestSummary = normalizeStrategyBacktestSummary(item);
        const totalTrades = Math.round(Number(backtestSummary?.total_trades || 0));
        const weightedWinRate = Number(backtestSummary?.weighted_win_rate_pct || 0);
        const totalRealizedR = Number(
          backtestSummary?.total_realized_r ?? backtestSummary?.total_r ?? 0,
        );
        const totalPlannedOutcomeR = Number(
          backtestSummary?.total_planned_outcome_r || 0,
        );
        const plannedOutcomeAvailable = Object.prototype.hasOwnProperty.call(
          backtestSummary || {},
          "total_planned_outcome_r",
        );
        const backtestRangeLabel = formatStrategyBacktestRange(backtestSummary);
        const backtestTitle = backtestSummary
          ? [
              `${totalTrades} trades`,
              `WR ${formatNumber(weightedWinRate, 0)}%`,
              `Real ${formatNumber(totalRealizedR, 1)}r`,
              `Plan ${plannedOutcomeAvailable ? `${formatNumber(totalPlannedOutcomeR, 1)}r` : "-"}`,
              backtestRangeLabel ? `Data ${backtestRangeLabel}` : "",
            ]
              .filter(Boolean)
              .join(" · ")
          : "No saved backtests yet";
        return (
          <div
            key={`${String(id || "strategy").trim() || "strategy"}:${String(item.kind || item.status || "item").trim()}:${String(item.name || "").trim()}`}
            role="button"
            tabIndex={0}
            className={`backtests-item-card card-item${active ? " selected-item backtests-item-card--active" : ""}`}
            onClick={async () => {
              handleOpenStrategyEditor(id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleOpenStrategyEditor(id);
              }
            }}
          >
            <div
              className="backtests-item-card__body backtests-item-card__body--strategy"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                minWidth: 0,
              }}
            >
              <div className="stack-layout" style={{ gap: 2, width: "100%", minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                      flex: "1 1 auto",
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
                        fontWeight: 800,
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
                        fontWeight: 700,
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
                </div>
                <div title={backtestTitle}>
                  {backtestSummary ? (
                    <div
                      className="minor-text"
                      style={{
                        fontSize: 10,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span>{totalTrades} trades</span>
                      <span>
                        WR{" "}
                        <span style={{ fontWeight: 700 }}>
                          {formatNumber(weightedWinRate, 0)}%
                        </span>
                      </span>
                      <span>
                        Real{" "}
                        <span
                          className={totalRealizedR >= 0 ? "money-pos" : "money-neg"}
                          style={{ fontWeight: 700 }}
                        >
                          {formatNumber(totalRealizedR, 1)}r
                        </span>
                      </span>
                      <span>
                        Plan{" "}
                        <span
                          className={totalPlannedOutcomeR >= 0 ? "money-pos" : "money-neg"}
                          style={{ fontWeight: 700 }}
                        >
                          {formatNumber(totalPlannedOutcomeR, 1)}r
                        </span>
                      </span>
                      {backtestRangeLabel ? <span>Data {backtestRangeLabel}</span> : null}
                    </div>
                  ) : (
                    <div className="minor-text" style={{ fontSize: 10 }}>
                      No backtests yet
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="backtests-item-card__action"
                onClick={(event) => {
                  event.stopPropagation();
                  handleOpenStrategyBacktest(id);
                }}
                title="Open Backtest tab"
              >
                &gt;
              </button>
            </div>
          </div>
        );
      })}
    </ListItems>
  );

  const ruleTesterHeaderControls = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        width: "100%",
        flexWrap: "wrap",
      }}
    >
      <TabBar
        value={ruleEditorTab}
        options={[
          { value: "edit", label: "Edit" },
          { value: "json", label: "Json" },
        ]}
        onChange={(nextValue) =>
          setRuleEditorTab(String(nextValue || "edit"))
        }
        size="sm"
        ariaLabel="Rule editor tabs"
      />
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "flex-end",
          gap: 10,
          flexWrap: "wrap",
          marginLeft: "auto",
        }}
      >
        <div>
          <InputComboSelect
            value={ruleTester.symbol}
            onChange={(event) => {
              const nextValue = String(event.target.value || "").trim().toUpperCase();
              setRuleTester((prev) => ({ ...prev, symbol: nextValue }));
              setTestedRuleStrategy(null);
              setRuleTestMarkerSummary(null);
            }}
            searchable
            searchPlaceholder="Filter symbols..."
          >
            {symbolOptions.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </InputComboSelect>
        </div>
        <div>
          <InputComboSelect
            value={ruleTester.tf}
            onChange={(event) => {
              setRuleTester((prev) => ({ ...prev, tf: event.target.value }));
              setTestedRuleStrategy(null);
              setRuleTestMarkerSummary(null);
            }}
          >
            {TIMEFRAME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </InputComboSelect>
        </div>
        <div>
          <BacktestBarsSelector
            timeframe={ruleTester.tf}
            barsOptions={BARS_OPTIONS}
            value={{
              limit_mode: "bars",
              limit: ruleTester.bars,
              limit_bars_value: ruleTester.bars,
            }}
            onChange={(patch) => {
              const nextBars = String(
                patch?.limit_bars_value ?? patch?.limit ?? ruleTester.bars,
              ).trim() || ruleTester.bars;
              setRuleTester((prev) => ({ ...prev, bars: nextBars }));
              setTestedRuleStrategy(null);
              setRuleTestMarkerSummary(null);
            }}
          />
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={handleSaveRuleConfig}
          disabled={savingRule}
        >
          {savingRule ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={handleRuleTesterRun}
        >
          Test
        </button>
      </div>
    </div>
  );

  const ruleLibraryPanel = (
    <div className="stack-layout" style={{ gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          width: "100%",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", width: "100%" }}>
          <input
            type="text"
            className="input"
            value={ruleLibraryQuery}
            onChange={(event) => setRuleLibraryQuery(event.target.value)}
            placeholder="Search rules..."
            style={{ flex: "1 1 220px", minWidth: 0, height: 32 }}
          />
          <TabBar
            value={ruleLibraryTab}
            options={[
              { value: "popular", label: "Popular" },
              { value: "strategy", label: "Strategy" },
            ]}
            onChange={(nextValue) =>
              setRuleLibraryTab(String(nextValue || "popular"))
            }
            size="sm"
            ariaLabel="Rule library tabs"
          />
        </div>
      </div>
      <ListItems className="list-items--rule-library">
        {visibleRuleLibraryItems.length ? (
          visibleRuleLibraryItems.map((item) => {
            const isActive =
              String(ruleTester?.rule?.name || "").trim().toLowerCase() ===
              String(item.label || "").trim().toLowerCase();
            return (
              <button
                key={item.id}
                type="button"
                className={`backtests-item-card card-item${isActive ? " selected-item" : ""}`}
                onClick={() => handleRuleLibraryPick(item)}
                title={`Load ${item.label}`}
              >
                <div className="backtests-item-card__body backtests-item-card__body--rule">
                  <span
                    className="backtests-item-card__label"
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.label}
                  </span>
                  <span className="minor-text backtests-item-card__tag" style={{ fontSize: 10, flex: "0 0 auto" }}>
                    {item.source === "strategy"
                      ? "Strategy"
                      : item.source === "custom"
                        ? "Custom"
                        : "Predefined"}
                  </span>
                </div>
              </button>
            );
          })
        ) : (
          <div className="minor-text" style={{ fontSize: 11 }}>
            {ruleLibraryTab === "strategy"
              ? "No strategy-derived rules available yet."
              : loadingRules
                ? "Loading rule catalog..."
                : String(ruleLibraryQuery || "").trim()
                  ? "No rules match this search."
                  : "No predefined or custom rules available."}
          </div>
        )}
      </ListItems>
    </div>
  );

  const leftPanelBody = (
    <div className="stack-layout" style={{ gap: 14 }}>
      {activeTab === "backtest" ? (
        <>
          <ResponsivePanel
            showToggle={false}
            border="none"
            bodyClassName="stack-layout"
          >
            {runnerControls}
          </ResponsivePanel>
          <ResponsivePanel
            showToggle={false}
            border="always"
            bodyClassName="stack-layout"
          >
            {activeRun && filteredActiveTrades.length ? (
              <ListItems className="list-items--run-trades">
                {visibleTradeItems.map((trade) => (
                  <TradeListCard
                    key={trade.sid}
                    trade={trade}
                    symbol={activeRun?.symbol}
                    active={trade?.sid === selectedTrade?.sid}
                    onClick={() => setSelectedTradeSid(String(trade?.sid || ""))}
                  />
                ))}
                {deferredFilteredActiveTrades.length > visibleTradeItems.length ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      setVisibleTradeCount((current) =>
                        current + BACKTEST_TRADES_RENDER_STEP,
                      )
                    }
                    style={{ minHeight: 32, padding: "0 10px", fontSize: 11 }}
                  >
                    {`Show more trades (${visibleTradeItems.length}/${deferredFilteredActiveTrades.length})`}
                  </button>
                ) : null}
              </ListItems>
            ) : (
              <div className="empty-state">
                {activeRun
                  ? sortedActiveTrades.length
                    ? "No trades match the selected result filters."
                    : "No trades found for this run."
                  : "Select a run to inspect trades."}
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
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                className="secondary-button"
                onClick={loadStrategyCatalog}
                disabled={loadingStrategies}
                style={{ minHeight: 28, padding: "0 10px", fontSize: 11 }}
              >
                {loadingStrategies ? "Refreshing..." : "Refresh"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleCreateStrategyDraft}
                style={{ minHeight: 28, padding: "0 10px", fontSize: 11 }}
              >
                + Custom
              </button>
            </div>
          </div>
          {strategiesList}
        </div>
      ) : null}
      {activeTab === "rules" ? (
        ruleLibraryPanel
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

      <MasterDetailLayout
        sidebarWidth={360}
        sidebarCollapsed={!isMobile && !isLeftPanelOpen}
        collapsedSidebarWidth={44}
        gap={18}
      >
        <ResponsivePanel
          headerContent={
            <TabBar
              value={activeTab}
              options={LEFT_TABS}
              onChange={handleLeftTabChange}
              size="sm"
              ariaLabel="Backtest left panel tabs"
              style={{ width: "100%" }}
            />
          }
          showToggle
          collapseDirection="left-right"
          open={isLeftPanelOpen}
          onOpenChange={setIsLeftPanelOpen}
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
                  hideBatchControls
                  onCreateNew={handleCreateStrategyDraft}
                  onSave={handleSaveStrategy}
                  onSaveAs={handleSaveAsStrategy}
                  onArchive={handleArchiveStrategy}
                  onDelete={handleDeleteStrategy}
                  onOpenBacktest={handleOpenStrategyBacktest}
                  onRunBatch={handleRunStrategyBatch}
                />
              ) : activeTab === "rules" ? (
                <div className="stack-layout" style={{ gap: 14 }}>
                  <ResponsivePanel
                    headerContent={ruleTesterHeaderControls}
                    showToggle={false}
                    border="always"
                    bodyClassName="stack-layout"
                  >
                    {ruleEditorTab === "edit" ? (
                      <RuleBuilder
                        key={String(ruleTester?.rule?.id || "rule-editor-root")}
                        rule={ruleTester.rule}
                        variableOptions={RULE_DEFAULT_VARIABLE_VALUES}
                        ruleTemplates={ruleCatalog}
                        showActions={false}
                        currentTimeframeLabel={timeframeLabel(ruleTester.tf)}
                        onChange={(nextRule) => {
                          setRuleTester((prev) => ({
                            ...prev,
                            rule: stripRuleActions(nextRule),
                          }));
                          setTestedRuleStrategy(null);
                          setRuleTestMarkerSummary(null);
                        }}
                      />
                    ) : (
                      <div className="stack-layout" style={{ gap: 10 }}>
                        <pre
                          style={{
                            margin: 0,
                            padding: 12,
                            borderRadius: 10,
                            border: "1px solid rgba(148,163,184,0.18)",
                            background: "rgba(15,23,42,0.5)",
                            color: "#cbd5e1",
                            fontSize: 11,
                            overflowX: "auto",
                          }}
                        >
                          {ruleTesterExpressionJson}
                        </pre>
                      </div>
                    )}
                  </ResponsivePanel>
                  {ruleTestMarkerSummary ? (
                    <ResponsivePanel
                      title="Test Result"
                      showToggle={false}
                      border="always"
                      bodyClassName="stack-layout"
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          flexWrap: "wrap",
                          fontSize: 11,
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>
                          Results: {Number(ruleTestMarkerSummary?.total || 0)}
                        </div>
                        <div className="minor-text" style={{ fontSize: 11, lineHeight: 1.5 }}>
                          {ruleTestMarkerSummary?.status === "scanning"
                            ? "Scanning loaded bars for rule matches..."
                            : Number(ruleTestMarkerSummary?.total || 0) > 0
                              ? `Found ${Number(ruleTestMarkerSummary.total)} ${String(ruleTester.rule?.abbr || ruleTester.rule?.name || "rule").trim()} match${Number(ruleTestMarkerSummary.total) === 1 ? "" : "es"} in ${ruleTester.symbol} ${timeframeLabel(ruleTester.tf)} / ${ruleTesterBarsCount} bars.`
                              : `No ${String(ruleTester.rule?.abbr || ruleTester.rule?.name || "rule").trim()} matches in ${ruleTester.symbol} ${timeframeLabel(ruleTester.tf)} / ${ruleTesterBarsCount} bars.`}
                        </div>
                      </div>
                    </ResponsivePanel>
                  ) : null}
                  <SymbolChart
                    key={`rules:${ruleTester.symbol}:${ruleTester.tf}:${ruleTesterBarsCount}:${ruleTestRunKey}`}
                    symbol={ruleTester.symbol}
                    timeframes={[timeframeLabel(ruleTester.tf)]}
                    extraRequestedTimeframes={higherBacktestTimeframes(ruleTester.tf)}
                    liveBars={false}
                    bootstrapLiveBarsOnMount
                    defaultMode="cache"
                    syncModeWithLocationHash={false}
                    initialGridCols={1}
                    initialBarsCount={ruleTesterBarsCount}
                    provider="ICMARKETS"
                    skipFetch={false}
                    autoLoadOnMount
                    showAnalyzeButton={false}
                    showTradeButton={false}
                    showSnapshotButton={true}
                    showEditButton={false}
                    showPerCardLayoutControls={false}
                    fillViewportForFourCharts={false}
                    showEventMarkers={false}
                    showStrategyMarkersDefault
                    strategyScanMode="backtest"
                    chartStrategies={ruleTesterChartStrategy ? [ruleTesterChartStrategy] : []}
                    allowedRules={ruleTester.rule ? [ruleTester.rule] : null}
                    onStrategyMarkersChange={handleRuleTestMarkersChange}
                  />
                </div>
              ) : !activeRun ? (
                <div className="empty-state">SELECT A RUN TO INSPECT DETAILS</div>
              ) : (
                <div className="stack-layout" style={{ gap: 14 }}>
                  <ResponsivePanel
                    headerContent={resultPanelHeaderContent}
                    showToggle={false}
                    border="always"
                    bodyClassName="stack-layout"
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                        fontSize: 11,
                        lineHeight: 1.2,
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>
                        {`${Math.round(Number(summaryTradesCount || 0))} trades`}
                      </span>
                      <span className="money-neg">{`WR ${formatNumber(summaryWinRateValue, 0)}%`}</span>
                      <span className="money-pos">{`Real ${formatNumber(summaryRealizedRValue, 1)}r`}</span>
                      <span className={summaryPlannedOutcomeAvailable ? "money-pos" : "money-neutral"}>
                        {`Plan ${summaryPlannedOutcomeAvailable ? `${formatNumber(summaryPlannedOutcomeRValue, 1)}r` : "-"}`}
                      </span>
                      <span
                        className={
                          Number(summaryTotalPnlValue || 0) > 0
                            ? "money-pos"
                            : Number(summaryTotalPnlValue || 0) < 0
                              ? "money-neg"
                              : "money-neutral"
                        }
                      >
                        {`$${formatNumber(summaryTotalPnlValue, 0)}`}
                      </span>
                      <span className="minor-text">{summaryRangeText}</span>
                      {summaryParamsText ? (
                        <span className="minor-text">{summaryParamsText}</span>
                      ) : null}
                    </div>
                    {batchMetricsTable ? (
                      <div
                        style={{
                          paddingTop: 4,
                          borderTop: "1px solid rgba(148,163,184,0.12)",
                        }}
                      >
                        {batchMetricsTable}
                      </div>
                    ) : null}
                  </ResponsivePanel>
                  {resultChartLoaded && chartTimeframes.length ? (
                    <SymbolChart
                      key={`backtest-chart:${activeRun?.run_id || "run"}:${chartTimeframes.join(",")}:${resultFilterStrategy}:${resultChartLoadKey}`}
                      symbol={activeChartSymbol}
                      showSymbolTfBadge
                      timeframes={chartTimeframes}
                      extraRequestedTimeframes={chartTimeframes.flatMap((tf) =>
                        higherBacktestTimeframes(tf),
                      )}
                      liveBars={false}
                      bootstrapLiveBarsOnMount
                      defaultMode="cache"
                      syncModeWithLocationHash={false}
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
                      showEventMarkers={Boolean(deferredFilteredActiveTrades.length)}
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
                      tradeLabel={activeChartTradeLabel}
                      trades={deferredFilteredActiveTrades}
                      animateTradeViewport
                      anchorToTradeTime={Boolean(
                        backtestReplayConfig?.enabled && backtestReplayConfig?.playing,
                      )}
                      onReplayActiveTradeChange={(tradeSid) => {
                        if (!tradeSid) return;
                        setReplayActiveTradeSid(String(tradeSid));
                      }}
                      onReplayProgressChange={setReplayProgress}
                      backtestReplay={backtestReplayConfig}
                    />
                  ) : null}
                </div>
              )}
            </div>
        </MasterDetailLayout>
    </section>
  );
}
