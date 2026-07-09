import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../../../app/api";
import BacktestBarsSelector from "../components/BacktestBarsSelector";
import BacktestSummaryMetaRow from "../components/BacktestSummaryMetaRow";
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
import { SYSTEM_SYMBOL_GROUP_PRESETS } from "../../../shared/utils/symbolGroups";
import {
  mergeStrategiesById,
  normalizeStrategyCatalog,
} from "../../../shared/utils/strategyCatalog";

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

const BACKTEST_TF_SEQUENCE = ["1m", "5m", "15m", "1h", "4h", "1d"];

function higherBacktestTimeframes(tfRaw = "") {
  const normalizedTf = timeframeLabel(tfRaw);
  const startIndex = BACKTEST_TF_SEQUENCE.indexOf(normalizedTf);
  if (startIndex < 0) return [];
  return BACKTEST_TF_SEQUENCE.slice(startIndex + 1);
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
  { value: "rules", label: "Rules" },
  { value: "strategies", label: "Strategies" },
];

const DEFAULT_EDIT_STRATEGY_ID = "price_action_fvg_context_v1";

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
];

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
  ruleBias = "neutral",
} = {}) {
  const when = buildRuleExpressionFromDraft(ruleTree);
  if (!when) return null;
  const normalizedTf = String(tf || "").trim();
  const chartTf = timeframeLabel(normalizedTf);
  const normalizedBias = String(ruleBias || "neutral").trim().toLowerCase();
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
      preview_current_bar_only: true,
    },
    events: [
      {
        id: "rules_test_event",
        name: String(ruleName || "Rule").trim() || "Rule",
        bias: normalizedBias,
        when,
        actions: [
          {
            id: "rules_test_draw",
            action: "draw",
            label: String(ruleName || "Rule").trim() || "Rule",
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
}) {
  return {
    id: String(id || label || createRuleTestNodeId("library")).trim(),
    label: String(label || id || "Rule").trim() || "Rule",
    source: String(source || "popular").trim(),
    tree,
    symbol: String(symbol || "").trim().toUpperCase(),
    tf: String(tf || "").trim(),
  };
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
}) {
  const functionMeta =
    RULE_FUNCTION_OPTIONS.find((item) => item.value === String(node?.functionName || "").trim()) || null;
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
        value={String(node?.mode || "compare")}
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
      {String(node?.mode || "compare") === "compare" ? (
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

function editorHashActive(location) {
  const hash = String(location?.hash || "").trim().toLowerCase();
  return hash === "#edit" || hash === "#json";
}

function buildBacktestsStrategyUrl(strategyId = "", hash = "#edit") {
  const normalizedId = String(strategyId || "").trim();
  const nextHash = String(hash || "#edit").trim() || "#edit";
  return normalizedId
    ? `/trades/backtests?strategy=${encodeURIComponent(normalizedId)}${nextHash}`
    : `/trades/backtests${nextHash}`;
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

function formatEventArtifactLabel(item = {}) {
  const type = String(item?.type || item?.artifact_type || "artifact")
    .trim()
    .toUpperCase();
  const subtype = String(item?.subtype || item?.payload?.bias || "")
    .trim()
    .toUpperCase();
  return subtype ? `${type} ${subtype}` : type;
}

function formatBacktestEventTime(value) {
  const sec = Number(value);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  return new Date(sec * 1000).toLocaleString();
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

function formatMoneyCompact(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${num >= 0 ? "+" : "-"}$${Math.abs(num).toFixed(digits)}`;
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
            alignItems: "flex-start",
            gap: 10,
            lineHeight: 1.2,
          }}
        >
          <div>
            <div style={{ color: "var(--muted)", fontSize: 9, lineHeight: 1.2 }}>
              {trade?.entry || "-"} → {trade?.tp || "-"}
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

  const [activeTab, setActiveTab] = useState(() => {
    const hash = String(location?.hash || "").trim().toLowerCase();
    if (hash === "#rules") return "rules";
    if (editorHashActive(location)) return "strategies";
    if (hash === "#history") return "history";
    return "backtest";
  });
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);
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
  const [loadingStrategies, setLoadingStrategies] = useState(false);
  const [running, setRunning] = useState(false);
  const [savingRun, setSavingRun] = useState(false);
  const [error, setError] = useState("");
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
    rule: createEmptyRuleDraft({
      name: "Rule Test",
      actions: [],
    }),
  });
  const [ruleEditorTab, setRuleEditorTab] = useState("edit");
  const [ruleLibraryTab, setRuleLibraryTab] = useState("popular");
  const [testedRuleStrategy, setTestedRuleStrategy] = useState(null);
  const [ruleTestRunKey, setRuleTestRunKey] = useState(0);
  const [form, setForm] = useState({
    symbol: "EURAUD",
    tf: "15",
    limit: "all",
    limit_mode: "bars",
    limit_bars_value: "all",
    limit_preset: "today",
    limit_start_date: "",
    limit_end_date: "",
    strategy_key: DEFAULT_EDIT_STRATEGY_ID,
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

  useEffect(() => {
    loadRuns();
    loadStrategyCatalog();
  }, []);

  useEffect(() => {
    if (!editorHashActive(location)) return;
    setActiveTab("strategies");
    const preferredStrategyId =
      routeStrategyId || String(form.strategy_key || "").trim() || DEFAULT_EDIT_STRATEGY_ID;
    if (!preferredStrategyId) return;
    setSelectedStrategyId((current) =>
      current && current !== "__new__" ? current : preferredStrategyId,
    );
    setForm((prev) => ({
      ...prev,
      strategy_key: preferredStrategyId,
    }));
  }, [location, routeStrategyId, form.strategy_key]);

  useEffect(() => {
    const hash = String(location?.hash || "").trim().toLowerCase();
    if (hash === "#rules") {
      setActiveTab("rules");
      return;
    }
    if (hash === "#history") {
      setActiveTab("history");
      return;
    }
  }, [location]);

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
  const activeEvents = Array.isArray(activeRunDetail?.events)
    ? activeRunDetail.events
    : [];
  const strategyOptions = useMemo(
    () =>
      strategies.length || customStrategies.length
        ? mergeStrategiesById(strategies, customStrategies)
        : [{ key: "ema_cross_v1", name: "EMA Cross v1" }],
    [customStrategies, strategies],
  );
  const allStrategies = strategyOptions;
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
  }, [activeRun?.strategy_id, activeRun?.strategy_key, allStrategies, selectedStrategy]);
  const symbolOptions = useMemo(() => {
    const known = new Set();
    for (const values of Object.values(SYSTEM_SYMBOL_GROUP_PRESETS)) {
      for (const symbol of values || []) known.add(String(symbol || "").trim().toUpperCase());
    }
    if (activeRun?.symbol) known.add(String(activeRun.symbol).trim().toUpperCase());
    if (form.symbol) known.add(String(form.symbol).trim().toUpperCase());
    return Array.from(known).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [activeRun?.symbol, form.symbol]);
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
    () => JSON.stringify(ruleTester.rule || {}, null, 2),
    [ruleTester.rule],
  );
  const ruleLibraryItems = useMemo(() => {
    const items = [];
    const pushItem = (entry) => {
      if (!entry?.tree) return;
      items.push(entry);
    };

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
  }, [allStrategies]);
  const visibleRuleLibraryItems = useMemo(
    () =>
      ruleLibraryItems.filter((item) =>
        ruleLibraryTab === "strategy"
          ? item.source === "strategy"
          : item.source !== "strategy",
      ),
    [ruleLibraryItems, ruleLibraryTab],
  );
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
  const visibleBacktestEvents = useMemo(() => {
    if (!activeEvents.length) return [];
    const tradeTimeMs =
      toTimeMs(
        selectedTrade?.created_at ||
          selectedTrade?.signal_bar_time ||
          selectedTrade?.opened_at ||
          selectedTrade?.closed_at ||
          null,
      ) || null;
    const scoped = tradeTimeMs
      ? activeEvents.filter((entry) => {
          const eventTimeMs = Number(entry?.bar_time_unix) * 1000;
          return Number.isFinite(eventTimeMs) && eventTimeMs <= tradeTimeMs;
        })
      : activeEvents;
    return scoped.slice(-12).reverse();
  }, [activeEvents, selectedTrade]);
  const selectedStrategyRuns = useMemo(
    () =>
      runs.filter((run) =>
        runMatchesStrategy(run, selectedExistingStrategy, form.strategy_key),
      ),
    [form.strategy_key, runs, selectedExistingStrategy],
  );
  const replaySummary = useMemo(() => {
    if (!replayPlaying || !replayProgress || !activeSummary) return null;
    const replayTimeSec = Number(replayProgress.clockTimeSec);
    if (!Number.isFinite(replayTimeSec) || replayTimeSec <= 0) return null;
    const replayTimeMs = replayTimeSec * 1000;
    const closedTrades = sortedActiveTrades.filter((trade) => {
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
        Number.isFinite(totalPnl) &&
        Number.isFinite(oneRValue) &&
        oneRValue > 0
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
  const summaryRangeText =
    replaySummary?.rangeLabel || activeSummaryRangeLabel || activeDataRangeLabel || "-";
  const summaryTradesCount =
    replaySummary ? replaySummary.totalTrades : activeSummary?.total_trades || 0;
  const summaryRrValue = replaySummary ? replaySummary.totalRr : activeTotalRr;
  const summaryWinRateValue = replaySummary
    ? replaySummary.winRate
    : activeSummary?.win_rate_pct || 0;
  const activeRunSummaryTitle = [
    `${Math.round(Number(summaryTradesCount || 0))} trades`,
    `WR ${formatNumber(summaryWinRateValue, 0)}%`,
    `RR ${formatNumber(summaryRrValue, 1)}`,
    summaryRangeText,
  ]
    .filter(Boolean)
    .join(" · ");
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
    setReplayProgress(null);
    setEphemeralRunDetail(null);
    setEphemeralRunSaveName("");
    setSelectedRunDetail(null);
    setSelectedRunId("");
    setSelectedTradeSid("");
    navigate("/trades/backtests");
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
        navigate(`/trades/backtests/${encodeURIComponent(runId)}`);
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
    setForm((prev) => ({ ...prev, strategy_key: nextId }));
    if (activeTab === "strategies" || editorHashActive(location)) {
      navigate(buildBacktestsStrategyUrl(nextId, "#edit"), { replace: false });
    }
  }

  function handleOpenStrategyEditor(strategyOrId) {
    const nextId = String(
      strategyOrId?.id || strategyOrId?.key || strategyOrId || "",
    ).trim();
    if (!nextId) return;
    setDraftStrategySeed(null);
    setSelectedStrategyId(nextId);
    setForm((prev) => ({ ...prev, strategy_key: nextId }));
    setActiveTab("strategies");
    navigate(buildBacktestsStrategyUrl(nextId, "#edit"), { replace: false });
  }

  function handleRuleTesterRun() {
    const nextStrategy = createRuleTestStrategy({
      symbol: ruleTester.symbol,
      tf: timeframeLabel(ruleTester.tf),
      ruleTree: buildRuleDraftFromExpression(ruleTester.rule?.when),
      ruleName: ruleTester.rule?.name,
      ruleBias: ruleTester.rule?.bias,
    });
    if (!nextStrategy) {
      setError("Build a valid rule before testing.");
      return;
    }
    setError("");
    setTestedRuleStrategy(nextStrategy);
    setRuleTestRunKey((current) => current + 1);
  }

  function handleRuleLibraryPick(item) {
    if (!item?.tree) return;
    const nextTree = cloneRuleTestTreeWithFreshIds(
      ensureRuleTestRootGroup(cloneJson(item.tree)),
    );
    const nextRule = normalizeRuleDraft({
      ...(ruleTester.rule || createEmptyRuleDraft({ name: item.label || "Rule Test", actions: [] })),
      name: item.label || ruleTester.rule?.name || "Rule Test",
      when: buildRuleExpressionFromDraft(nextTree) || { and: [] },
    });
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
  }

  function handleOpenStrategyBacktest(strategyOrId) {
    const nextId = String(
      strategyOrId?.id || strategyOrId?.key || strategyOrId || "",
    ).trim();
    if (!nextId) return;
    handleStrategySelect(nextId);
    setActiveTab("backtest");
    navigate("/trades/backtests", { replace: false });
  }

  function handleCreateStrategyDraft() {
    const draft = buildNewStrategyDraft(strategyExample, {
      symbol: form.symbol,
      tf: form.tf,
    });
    setDraftStrategySeed(draft);
    setSelectedStrategyId("__new__");
    setActiveTab("strategies");
    navigate("/trades/backtests#edit", { replace: false });
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

  function handleLeftTabChange(nextValue) {
    const nextTab = String(nextValue || "backtest").trim().toLowerCase() || "backtest";
    setActiveTab(nextTab);
    if (nextTab === "rules") {
      navigate("/trades/backtests#rules", { replace: false });
      return;
    }
    if (nextTab === "history") {
      navigate("/trades/backtests#history", { replace: false });
      return;
    }
    if (nextTab === "strategies") {
      navigate("/trades/backtests#edit", { replace: false });
      return;
    }
    navigate("/trades/backtests", { replace: false });
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
        navigate("/trades/backtests");
      }
      await loadRuns("");
    } catch (deleteError) {
      setError(String(deleteError?.message || deleteError || "Failed to delete backtest"));
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
            <span className="minor-text">Strategy</span>
            <InputComboSelect
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
                <option key={item.key || item.id} value={item.key || item.id}>
                  {item.name || item.key || item.id}
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
            <span className="minor-text">Timeframe</span>
            <InputComboSelect
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
            {running ? "Running..." : "Run Backtest"}
          </button>
        </div>
      </div>
    </form>
  );

  const runList = (
    <ListItems>
      {runs.length ? (
        runs.map((run) => {
          const isActive = selectedRunId === run.run_id;
          const pnl = Number(run?.summary?.total_pnl || 0);
          const openRun = () => {
            setSelectedRunId(run.run_id);
            navigate(`/backtests/${encodeURIComponent(run.run_id)}`);
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
    </ListItems>
  );

  const strategiesList = (
    <ListItems>
      {allStrategies.map((item) => {
        const id = item.key || item.id;
        const active = String(selectedStrategyId || form.strategy_key || "") === String(id || "");
        const sourceMeta = strategySourceMeta(item);
        const backtestSummary = normalizeStrategyBacktestSummary(item);
        const totalTrades = Math.round(Number(backtestSummary?.total_trades || 0));
        const weightedWinRate = Number(backtestSummary?.weighted_win_rate_pct || 0);
        const totalR = Number(backtestSummary?.total_r || 0);
        const backtestRangeLabel = formatStrategyBacktestRange(backtestSummary);
        const backtestTitle = backtestSummary
          ? [
              `${totalTrades} trades`,
              `WR ${formatNumber(weightedWinRate, 0)}%`,
              `RR ${formatNumber(totalR, 1)}`,
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
                <div title={backtestTitle}>
                  {backtestSummary ? (
                    <BacktestSummaryMetaRow
                      leadLabel={`${totalTrades} trades`}
                      winRateValue={weightedWinRate}
                      rrValue={totalR}
                      rangeLabel={backtestRangeLabel}
                      title={backtestTitle}
                    />
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
            }}
          />
        </div>
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
        }}
      >
        <div className="minor-text" style={{ fontSize: 11 }}>Rule Library</div>
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
                    {item.source === "strategy" ? "Strategy" : "Popular"}
                  </span>
                </div>
              </button>
            );
          })
        ) : (
          <div className="minor-text" style={{ fontSize: 11 }}>
            {ruleLibraryTab === "strategy"
              ? "No strategy-derived rules available yet."
              : "No popular rules available."}
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
                  <InputComboSelect
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
                  </InputComboSelect>
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
              <BacktestSummaryMetaRow
                leadLabel={`${Math.round(Number(summaryTradesCount || 0))} trades`}
                winRateValue={summaryWinRateValue}
                rrValue={summaryRrValue}
                rangeLabel={summaryRangeText}
                title={activeRunSummaryTitle}
              />
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
              <ListItems className="list-items--run-trades">
                {sortedActiveTrades.map((trade) => (
                  <TradeListCard
                    key={trade.sid}
                    trade={trade}
                    symbol={activeRun?.symbol}
                    active={trade?.sid === selectedTrade?.sid}
                    onClick={() => setSelectedTradeSid(String(trade?.sid || ""))}
                  />
                ))}
              </ListItems>
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
                  onCreateNew={handleCreateStrategyDraft}
                  onSave={handleSaveStrategy}
                  onSaveAs={handleSaveAsStrategy}
                  onArchive={handleArchiveStrategy}
                  onDelete={handleDeleteStrategy}
                  onOpenBacktest={handleOpenStrategyBacktest}
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
                        showActions={false}
                        currentTimeframeLabel={timeframeLabel(ruleTester.tf)}
                        onChange={(nextRule) => {
                          setRuleTester((prev) => ({ ...prev, rule: nextRule }));
                          setTestedRuleStrategy(null);
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
                    chartStrategies={ruleTesterChartStrategy ? [ruleTesterChartStrategy] : []}
                  />
                  <ResponsivePanel
                    title="Test Status"
                    showToggle={false}
                    border="always"
                    bodyClassName="stack-layout"
                  >
                    <div className="minor-text" style={{ fontSize: 11, lineHeight: 1.5 }}>
                      {ruleTesterChartStrategy
                        ? "Rule tested. Matching bars are drawn as chart markers. Replay is available from the chart controls if you want to reveal hits bar by bar."
                        : "Build a rule and click Test to evaluate all loaded bars and draw markers where the rule is satisfied."}
                    </div>
                  </ResponsivePanel>
                </div>
              ) : !activeRun ? (
                <div className="empty-state">SELECT A RUN TO INSPECT DETAILS</div>
              ) : (
                <div className="stack-layout" style={{ gap: 14 }}>
                  <SymbolChart
                    symbol={activeRun.symbol}
                    timeframes={[timeframeLabel(activeRun.tf)]}
                    extraRequestedTimeframes={higherBacktestTimeframes(activeRun.tf)}
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
                    anchorToTradeTime={Boolean(backtestReplayConfig?.enabled && backtestReplayConfig?.playing)}
                    onReplayActiveTradeChange={(tradeSid) => {
                      if (!tradeSid) return;
                      setReplayActiveTradeSid(String(tradeSid));
                    }}
                    onReplayProgressChange={setReplayProgress}
                    backtestReplay={backtestReplayConfig}
                    chartStrategies={activeChartStrategy ? [activeChartStrategy] : []}
                  />
                  <ResponsivePanel
                    title="Strategy Events"
                    showToggle={false}
                    border="always"
                    bodyClassName="stack-layout"
                  >
                    {visibleBacktestEvents.length ? (
                      <ListItems className="list-items--strategy-events">
                        {visibleBacktestEvents.map((entry, index) => {
                          const artifacts = Array.isArray(entry?.artifacts)
                            ? entry.artifacts
                            : [];
                          return (
                            <div
                              key={`${entry?.event_id || "event"}:${entry?.bar_time_unix || index}:${index}`}
                              className="strategy-event-card"
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
                                <strong style={{ fontSize: 12 }}>
                                  {entry?.event_name || entry?.event_id || "Event"}
                                </strong>
                                <span className="minor-text" style={{ fontSize: 11 }}>
                                  {formatBacktestEventTime(entry?.bar_time_unix)}
                                </span>
                              </div>
                              <div className="minor-text" style={{ fontSize: 11, marginTop: 4 }}>
                                {String(entry?.action_type || entry?.action || "action").trim() || "action"} · close {formatNumber(entry?.bar_close, 5)}
                              </div>
                              {artifacts.length ? (
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 6,
                                    marginTop: 8,
                                  }}
                                >
                                  {artifacts.slice(0, 6).map((item, artifactIndex) => (
                                    <span
                                      key={`${item?.id || item?.type || artifactIndex}`}
                                      className="minor-text"
                                      title={`${formatEventArtifactLabel(item)} @ ${formatNumber(item?.price, 5)}`}
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        padding: "3px 8px",
                                        borderRadius: 999,
                                        border: "1px solid rgba(56, 189, 248, 0.28)",
                                        background: "rgba(56, 189, 248, 0.08)",
                                        fontSize: 10,
                                      }}
                                    >
                                      {formatEventArtifactLabel(item)}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </ListItems>
                    ) : (
                      <div className="empty-state">
                        No strategy events available for this run yet.
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
