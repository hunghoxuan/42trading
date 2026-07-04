import { useEffect, useMemo, useState } from "react";
import FormComboSelect from "../../shared/components/FormComboSelect";
import ResponsivePanel from "../../shared/components/ResponsivePanel";
import TabBar from "../../shared/components/TabBar";
import {
  appendActionDraft,
  appendGroupChild,
  ensureGroupRootDraft,
  makeEmptyConditionDraft,
  makeEmptyGroupDraft,
} from "../utils/strategyRuleEditor.js";

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
];

const COMPARATOR_OPTIONS = [
  { value: ">", label: ">" },
  { value: "<", label: "<" },
  { value: ">=", label: ">=" },
  { value: "<=", label: "<=" },
  { value: "==", label: "==" },
  { value: "!=", label: "!=" },
  { value: "crosses_above", label: "Crosses Above" },
  { value: "crosses_below", label: "Crosses Below" },
];

const RULE_SECTIONS = [
  { key: "entry_long", label: "Entry Long", required: true },
  { key: "entry_short", label: "Entry Short", required: true },
  { key: "exit_long", label: "Exit Long", required: false },
  { key: "exit_short", label: "Exit Short", required: false },
];
const EVENT_ACTION_TYPE_OPTIONS = [
  { value: "trade.open.long", label: "Trade Open Long" },
  { value: "trade.open.short", label: "Trade Open Short" },
  { value: "trade.close.long", label: "Trade Close Long" },
  { value: "trade.close.short", label: "Trade Close Short" },
  { value: "notify.toast", label: "Toast" },
  { value: "notify.notification", label: "Notification" },
  { value: "chart.note", label: "Chart Note" },
  { value: "webhook.post", label: "Webhook" },
];

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

const TIMEFRAME_OPTIONS = [
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "60", label: "1h" },
  { value: "240", label: "4h" },
  { value: "1440", label: "1d" },
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
  { key: "stop_lookback", label: "Stop lookback" },
  { key: "max_open_trades", label: "Max open trades" },
  { key: "fallback_stop_pct", label: "Fallback stop %" },
  { key: "fallback_tp_pct", label: "Fallback TP %" },
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
  { value: "stop_lookback", label: "stop_lookback" },
  { value: "oversold", label: "oversold" },
  { value: "overbought", label: "overbought" },
];

const PRESET_META_FIELDS = [
  { key: "key", label: "Key" },
  { key: "kind", label: "Kind" },
];

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

function normalizeEditorStrategy(value) {
  const nextValue = deepClone(value) || {};
  if (nextValue && typeof nextValue === "object") {
    delete nextValue.min_bars;
    const nextParams =
      nextValue.params && typeof nextValue.params === "object" && !Array.isArray(nextValue.params)
        ? { ...nextValue.params }
        : {};
    const nextRisk =
      nextValue.risk && typeof nextValue.risk === "object" && !Array.isArray(nextValue.risk)
        ? { ...nextValue.risk }
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

function formatLiteralInput(value) {
  if (value === null) return "null";
  if (value === undefined) return "";
  return String(value);
}

function buildOperandFromExpression(node) {
  if (node && typeof node === "object" && !Array.isArray(node)) {
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
  const keys = Object.keys(expression);
  if (keys.length !== 1) return null;
  const operator = keys[0];
  const rawValue = expression[operator];
  if (operator === "and" || operator === "or") {
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
  if (operator === "crosses_above" || operator === "crosses_below") {
    if (!Array.isArray(rawValue) || rawValue.length !== 2) return null;
    const left = buildOperandFromExpression(rawValue[0]);
    const right = buildOperandFromExpression(rawValue[1]);
    if (!left || !right) return null;
    return {
      id: createNodeId("condition"),
      type: "condition",
      comparator: operator,
      left,
      right,
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
    comparator: operator,
    left,
    right,
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
    if (operator !== "and" && operator !== "or") return null;
    return {
      [operator]: Array.isArray(node.children)
        ? node.children.map((child) => buildExpressionFromVisualNode(child)).filter(Boolean)
        : [],
    };
  }
  if (node.type === "condition") {
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

function actionTypeToLegacyRuleKey(actionType = "") {
  const type = String(actionType || "").trim();
  switch (type) {
    case "trade.open.long":
      return "entry_long";
    case "trade.open.short":
      return "entry_short";
    case "trade.close.long":
      return "exit_long";
    case "trade.close.short":
      return "exit_short";
    default:
      return "";
  }
}

function createEventActionDraft(type = "trade.open.long") {
  const safeType = EVENT_ACTION_TYPE_OPTIONS.some((item) => item.value === type)
    ? type
    : "trade.open.long";
  return {
    id: createNodeId("action"),
    type: safeType,
    message:
      safeType === "notify.toast" ||
      safeType === "notify.notification" ||
      safeType === "chart.note"
        ? ""
        : undefined,
    url: safeType === "webhook.post" ? "" : undefined,
    method: safeType === "webhook.post" ? "POST" : undefined,
  };
}

function createEventDraft(ruleKey = "entry_long", expression = null) {
  const section = RULE_SECTIONS.find((item) => item.key === ruleKey);
  const actionType = {
    entry_long: "trade.open.long",
    entry_short: "trade.open.short",
    exit_long: "trade.close.long",
    exit_short: "trade.close.short",
  }[ruleKey] || "trade.open.long";
  return {
    id: createNodeId("event"),
    name: section?.label || "Rule",
    when: expression || makeEmptyGroup("and"),
    actions: [createEventActionDraft(actionType)],
  };
}

function normalizeEventAction(action = {}) {
  return {
    id: String(action?.id || createNodeId("action")).trim(),
    type: String(action?.type || "").trim(),
    message: action?.message !== undefined ? String(action.message || "") : undefined,
    url: action?.url !== undefined ? String(action.url || "") : undefined,
    method:
      action?.method !== undefined
        ? String(action.method || "").trim().toUpperCase()
        : undefined,
  };
}

function normalizeStrategyEvents(strategy = {}) {
  const rawEvents = Array.isArray(strategy?.events) ? strategy.events : null;
  if (rawEvents && rawEvents.length) {
    return rawEvents.map((event, index) => ({
      id: String(event?.id || createNodeId(`event_${index}`)).trim() || createNodeId(`event_${index}`),
      name: String(event?.name || event?.label || `Rule ${index + 1}`).trim() || `Rule ${index + 1}`,
      when: event?.when && typeof event.when === "object" ? event.when : makeEmptyGroup("and"),
      actions: Array.isArray(event?.actions) && event.actions.length
        ? event.actions.map(normalizeEventAction)
        : [createEventActionDraft("trade.open.long")],
    }));
  }
  const legacyRules =
    strategy?.rules && typeof strategy.rules === "object" && !Array.isArray(strategy.rules)
      ? strategy.rules
      : {};
  return RULE_SECTIONS
    .filter((section) => legacyRules[section.key])
    .map((section) => {
      const actionType = {
        entry_long: "trade.open.long",
        entry_short: "trade.open.short",
        exit_long: "trade.close.long",
        exit_short: "trade.close.short",
      }[section.key] || "trade.open.long";
      return {
        id: createNodeId("event"),
        name: section.label,
        when: legacyRules[section.key],
        actions: [createEventActionDraft(actionType)],
      };
    });
}

function combineExpressionsWithOr(expressions = []) {
  const valid = expressions.filter(Boolean);
  if (!valid.length) return undefined;
  if (valid.length === 1) return valid[0];
  return { or: valid };
}

function deriveRulesFromEvents(events = [], fallbackRules = {}) {
  const grouped = {
    entry_long: [],
    entry_short: [],
    exit_long: [],
    exit_short: [],
  };
  for (const event of Array.isArray(events) ? events : []) {
    const when = event?.when && typeof event.when === "object" ? event.when : null;
    if (!when) continue;
    for (const action of Array.isArray(event?.actions) ? event.actions : []) {
      const legacyKey = actionTypeToLegacyRuleKey(action?.type);
      if (!legacyKey) continue;
      grouped[legacyKey].push(when);
    }
  }
  const nextRules = {
    ...(fallbackRules && typeof fallbackRules === "object" && !Array.isArray(fallbackRules)
      ? fallbackRules
      : {}),
  };
  for (const key of ["entry_long", "entry_short", "exit_long", "exit_short"]) {
    const expression = combineExpressionsWithOr(grouped[key]);
    if (expression) nextRules[key] = expression;
    else delete nextRules[key];
  }
  return nextRules;
}

function toFlatOptions(items = []) {
  return items.map((item) => (
    <option key={item.value} value={item.value}>
      {item.label}
    </option>
  ));
}

function withNullOption(items = [], label = "None") {
  return [{ value: "", label }, ...(Array.isArray(items) ? items : [])];
}

function resolveSelectValue(value, options = []) {
  const normalized = String(value ?? "").trim();
  return options.some((item) => String(item?.value ?? "") === normalized)
    ? normalized
    : "";
}

function buildDefaultDraft(exampleStrategy, defaults = {}) {
  const base = normalizeEditorStrategy(exampleStrategy);
  const timestamp = Date.now();
  const baseId = sanitizeStrategyId(base.id || base.key || "");
  const editableId =
    base.kind && base.kind !== "custom"
      ? sanitizeStrategyId(`${baseId || "custom_strategy"}_custom`)
      : baseId;
  return {
    id: editableId || `custom_strategy_${timestamp}`,
    name: base.name || "New Custom Strategy",
    description: base.description || "",
    engine_version: "42trade.strategy.v2",
    kind: "custom",
    status: "draft",
    market: {
      symbol:
        String(base.market?.symbol ?? "").trim() ||
        String(defaults.symbol ?? "").trim(),
      tf:
        String(base.market?.tf ?? "").trim() ||
        String(defaults.tf ?? "").trim(),
    },
    params:
      base.params && typeof base.params === "object" && !Array.isArray(base.params)
        ? base.params
        : {},
    indicators: Array.isArray(base.indicators) ? base.indicators : [],
    events: normalizeStrategyEvents(base),
    rules: deriveRulesFromEvents(
      normalizeStrategyEvents(base),
      base.rules && typeof base.rules === "object" && !Array.isArray(base.rules)
        ? base.rules
        : {},
    ),
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

function variableSuggestionsForDraft(draft) {
  const indicatorIds = Array.isArray(draft?.indicators)
    ? draft.indicators.map((item) => String(item?.id || "").trim()).filter(Boolean)
    : [];
  const paramKeys = draft?.params ? Object.keys(draft.params) : [];
  const riskKeys = draft?.risk ? Object.keys(draft.risk) : [];
  return [
    "bar.open",
    "bar.high",
    "bar.low",
    "bar.close",
    "bar.volume",
    "prev.open",
    "prev.high",
    "prev.low",
    "prev.close",
    "prev.volume",
    ...indicatorIds.map((id) => `indicators.${id}`),
    ...indicatorIds.map((id) => `prev_indicators.${id}`),
    ...paramKeys.map((key) => `params.${key}`),
    ...riskKeys.map((key) => `risk.${key}`),
    "entry",
  ];
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
}) {
  const isLiteral = operand?.kind === "literal";
  const operandKind =
    operand?.kind === "literal" || operand?.kind === "var" ? operand.kind : "";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "116px minmax(0, 1fr)",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
      }}
    >
      <FormComboSelect
        value={operandKind}
        onChange={(event) =>
          onChange({
            kind:
              event.target.value === "literal"
                ? "literal"
                : event.target.value === "var"
                  ? "var"
                  : "",
            value:
              event.target.value === "literal"
                ? formatLiteralInput(isLiteral ? operand?.value : 0)
                : event.target.value === "var"
                  ? (isLiteral ? variableOptions[0] || "bar.close" : operand?.value || "")
                  : "",
          })
        }
        aria-label="Operand type"
        title="Choose whether this side uses a fixed value or a variable path."
        style={{
          width: "100%",
          minWidth: 116,
        }}
      >
        <option value="">None</option>
        <option value="literal">Value</option>
        <option value="var">Param</option>
      </FormComboSelect>
      {isLiteral ? (
        <input
          className="input"
          value={formatLiteralInput(operand?.value)}
          onChange={(event) =>
            onChange({
              kind: "literal",
              value: event.target.value,
            })
          }
          placeholder="Value"
          title="Enter a fixed value like 50, 2.5, true, false, or text."
          style={{
            minWidth: 0,
            width: "100%",
          }}
        />
      ) : (
        <input
          className="input"
          value={String(operand?.value || "")}
          onChange={(event) =>
            onChange({
              kind: "var",
              value: event.target.value,
            })
          }
          placeholder="Variable path"
          list="strategy-variable-suggestions"
          title="Use a variable like bar.open, bar.close, indicators.ema_1, or params.fast_period."
          style={{
            minWidth: 0,
            width: "100%",
          }}
        />
      )}
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
    <FormComboSelect
      value={resolveSelectValue(node?.comparator, options)}
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
    </FormComboSelect>
  );
}

function StrategyConditionEditor({
  node,
  onChange,
  onRemove,
  variableOptions,
  compact = false,
}) {
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
          gridTemplateColumns: "minmax(0, 1.15fr) 132px minmax(0, 1.15fr) auto",
          gap: 8,
          alignItems: "center",
        }}
      >
        <StrategyOperandEditor
          operand={node.left}
          variableOptions={variableOptions}
          onChange={(left) => onChange({ ...node, left })}
        />
        <RuleComparatorEditor node={node} onChange={onChange} />
        <StrategyOperandEditor
          operand={node.right}
          variableOptions={variableOptions}
          onChange={(right) => onChange({ ...node, right })}
        />
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
    </div>
  );
}

function StrategyIndicatorRow({
  indicator,
  index,
  updateDraft,
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
            "minmax(120px, 1fr) minmax(120px, 1fr) minmax(140px, 1fr) 96px minmax(120px, 1fr) auto",
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
        <FormComboSelect
          value={resolveSelectValue(indicatorType, indicatorTypeOptions)}
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
        </FormComboSelect>
        <FormComboSelect
          value={resolveSelectValue(indicator?.source, indicatorSourceOptions)}
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
        </FormComboSelect>
        <input
          className="input"
          value={indicator?.length ?? ""}
          onChange={(event) =>
            updateDraft((base) => {
              const nextIndicators = [...(base.indicators || [])];
              nextIndicators[index] = {
                ...nextIndicators[index],
                length: Number(event.target.value || 0),
              };
              return {
                ...base,
                indicators: nextIndicators,
              };
            })
          }
          title="Number of bars used by the indicator."
          style={{
            minWidth: 0,
          }}
        />
        {indicatorFieldOptions ? (
          <FormComboSelect
            value={resolveSelectValue(indicator?.field, indicatorFieldSelectOptions)}
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
        </FormComboSelect>
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
          <input
            className="input"
            value={indicator?.fast_length ?? ""}
            onChange={(event) =>
              updateDraft((base) => {
                const nextIndicators = [...(base.indicators || [])];
                nextIndicators[index] = {
                  ...nextIndicators[index],
                  fast_length: Number(event.target.value || 0),
                };
                return {
                  ...base,
                  indicators: nextIndicators,
                };
              })
            }
            placeholder="Fast"
            title="Fast MACD length."
          />
          <input
            className="input"
            value={indicator?.slow_length ?? ""}
            onChange={(event) =>
              updateDraft((base) => {
                const nextIndicators = [...(base.indicators || [])];
                nextIndicators[index] = {
                  ...nextIndicators[index],
                  slow_length: Number(event.target.value || 0),
                };
                return {
                  ...base,
                  indicators: nextIndicators,
                };
              })
            }
            placeholder="Slow"
            title="Slow MACD length."
          />
          <input
            className="input"
            value={indicator?.signal_length ?? ""}
            onChange={(event) =>
              updateDraft((base) => {
                const nextIndicators = [...(base.indicators || [])];
                nextIndicators[index] = {
                  ...nextIndicators[index],
                  signal_length: Number(event.target.value || 0),
                };
                return {
                  ...base,
                  indicators: nextIndicators,
                };
              })
            }
            placeholder="Signal"
            title="MACD signal length."
          />
        </div>
      ) : null}
      {indicatorType === "bollinger" ? (
        <input
          className="input"
          value={indicator?.stddev ?? ""}
          onChange={(event) =>
            updateDraft((base) => {
              const nextIndicators = [...(base.indicators || [])];
              nextIndicators[index] = {
                ...nextIndicators[index],
                stddev: Number(event.target.value || 0),
              };
              return {
                ...base,
                indicators: nextIndicators,
              };
            })
          }
          placeholder="Std dev"
          title="Bollinger standard deviation multiplier."
          style={{
            maxWidth: 160,
          }}
        />
      ) : null}
      {indicatorType === "stochastic" ? (
        <input
          className="input"
          value={indicator?.smooth_period ?? ""}
          onChange={(event) =>
            updateDraft((base) => {
              const nextIndicators = [...(base.indicators || [])];
              nextIndicators[index] = {
                ...nextIndicators[index],
                smooth_period: Number(event.target.value || 0),
              };
              return {
                ...base,
                indicators: nextIndicators,
              };
            })
          }
          placeholder="Smooth"
          title="Stochastic smoothing period."
          style={{
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
}) {
  const actionType = String(action?.type || "").trim();
  const actionTypeOptions = withNullOption(EVENT_ACTION_TYPE_OPTIONS);
  const webhookMethodOptions = withNullOption(WEBHOOK_METHOD_OPTIONS);
  const isMessageAction =
    actionType === "notify.toast" ||
    actionType === "notify.notification" ||
    actionType === "chart.note";
  const isWebhookAction = actionType === "webhook.post";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isWebhookAction
          ? "minmax(180px, 220px) 96px minmax(0, 1fr) auto"
          : isMessageAction
            ? "minmax(180px, 220px) minmax(0, 1fr) auto"
            : "minmax(180px, 220px) auto",
        gap: 8,
        alignItems: "center",
      }}
    >
      <FormComboSelect
        value={resolveSelectValue(actionType, actionTypeOptions)}
        onChange={(event) =>
          onChange(normalizeEventAction({ ...action, type: event.target.value }))
        }
      >
        {toFlatOptions(actionTypeOptions)}
      </FormComboSelect>
      {isWebhookAction ? (
        <>
          <FormComboSelect
            value={resolveSelectValue(action?.method, webhookMethodOptions)}
            onChange={(event) =>
              onChange(normalizeEventAction({ ...action, method: event.target.value }))
            }
          >
            {toFlatOptions(webhookMethodOptions)}
          </FormComboSelect>
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
              <FormComboSelect
                value={resolveSelectValue(node?.operator, logicOptions)}
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
              </FormComboSelect>
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
  onCreateNew,
  onSave,
  onSaveAs,
  onArchive,
  onDelete,
}) {
  const [activeTab, setActiveTab] = useState("json");
  const [draft, setDraft] = useState(null);
  const [jsonText, setJsonText] = useState("");
  const [visualEvents, setVisualEvents] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [unsupportedEvents, setUnsupportedEvents] = useState({});
  const [descriptionVisible, setDescriptionVisible] = useState(false);
  const isPreset = String(draft?.kind || "").trim() !== "custom";
  const statusOptions = useMemo(() => withNullOption(STATUS_OPTIONS), []);
  const timeframeOptions = useMemo(() => withNullOption(TIMEFRAME_OPTIONS), []);

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
    const normalizedDraft = normalizeEditorStrategy(nextDraft);
    const { nextEvents, nextVisualEvents, nextUnsupportedEvents } = buildEventEditorState(normalizedDraft);
    const nextWithEvents = {
      ...normalizedDraft,
      events: nextEvents,
      rules: deriveRulesFromEvents(nextEvents, normalizedDraft.rules || {}),
    };
    setDraft(nextWithEvents);
    setJsonText(prettyJson(nextWithEvents));
    setVisualEvents(nextVisualEvents);
    setUnsupportedEvents(nextUnsupportedEvents);
    setActiveTab(nextTab);
    setDescriptionVisible(hasDataValue(nextDraft?.description));
    setMessage("");
    setMessageType("info");
  }, [defaultSymbol, defaultTf, exampleStrategy, isNewDraft, selectionKey, strategy]);

  useEffect(() => {
    writeEditorHash(activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "edit") return;
    if (!isPreset) return;
    const nextDraft = buildDefaultDraft(strategy || exampleStrategy, {});
    const { nextEvents, nextVisualEvents, nextUnsupportedEvents } = buildEventEditorState(nextDraft);
    const nextWithEvents = {
      ...nextDraft,
      events: nextEvents,
      rules: deriveRulesFromEvents(nextEvents, nextDraft.rules || {}),
    };
    setDraft(nextWithEvents);
    setJsonText(prettyJson(nextWithEvents));
    setVisualEvents(nextVisualEvents);
    setUnsupportedEvents(nextUnsupportedEvents);
    setDescriptionVisible(hasDataValue(nextDraft?.description));
  }, [activeTab, defaultSymbol, defaultTf, exampleStrategy, isPreset, strategy]);

  const variableOptions = useMemo(
    () => variableSuggestionsForDraft(draft),
    [draft],
  );
  const hasIndicators = Array.isArray(draft?.indicators) && draft.indicators.length > 0;
  const hasRiskValues = Object.values(draft?.risk || {}).some(
    (value) => value !== undefined && value !== null && value !== "",
  );
  const hasRuleValues = Array.isArray(draft?.events) && draft.events.length > 0;
  const hasParams = Object.keys(draft?.params || {}).length > 0;
  const hasDescription = hasDataValue(draft?.description);
  const visibleEvents = Array.isArray(draft?.events) ? draft.events : [];
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
    const normalizedDraft = normalizeEditorStrategy(nextDraft);
    const nextEvents = normalizeStrategyEvents(normalizedDraft);
    const nextWithEvents = {
      ...normalizedDraft,
      events: nextEvents,
      rules: deriveRulesFromEvents(nextEvents, normalizedDraft.rules || {}),
    };
    const { nextVisualEvents, nextUnsupportedEvents } = buildEventEditorState(nextWithEvents);
    setDraft(nextWithEvents);
    setJsonText(prettyJson(nextWithEvents));
    setVisualEvents(nextVisualEvents);
    setUnsupportedEvents(nextUnsupportedEvents);
  }

  function updateDraft(updater) {
    setDraft((current) => {
      const base = deepClone(current) || buildDefaultDraft(exampleStrategy, {
        symbol: defaultSymbol,
        tf: defaultTf,
      });
      const nextDraft = updater(base);
      const nextEvents = normalizeStrategyEvents(nextDraft);
      const nextWithEvents = {
        ...nextDraft,
        events: nextEvents,
        rules: deriveRulesFromEvents(nextEvents, nextDraft.rules || {}),
      };
      setJsonText(prettyJson(nextWithEvents));
      return nextWithEvents;
    });
  }

  function setEventWhen(eventId, node) {
    setVisualEvents((current) => ({
      ...current,
      [eventId]: node,
    }));
    setUnsupportedEvents((current) => ({
      ...current,
      [eventId]: false,
    }));
    updateDraft((base) => ({
      ...base,
      events: (Array.isArray(base.events) ? base.events : []).map((event) =>
        event.id === eventId
          ? {
              ...event,
              when: buildExpressionFromVisualNode(node),
            }
          : event,
      ),
    }));
  }

  function updateEventAction(eventId, actionId, updater) {
    updateDraft((base) => ({
      ...base,
      events: (Array.isArray(base.events) ? base.events : []).map((event) =>
        event.id === eventId
          ? {
              ...event,
              actions: (Array.isArray(event.actions) ? event.actions : []).map((action) =>
                action.id === actionId ? updater(action) : action,
              ),
            }
          : event,
      ),
    }));
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
      const result = await onSave?.(draft);
      applyDraft(normalizeEditorStrategy(result || draft));
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
      const result = await onSaveAs?.(draft);
      applyDraft(normalizeEditorStrategy(result || draft));
      setMessage("Strategy saved as new.");
      setMessageType("success");
    } catch (error) {
      setMessage(String(error?.message || error || "Failed to save strategy as new"));
      setMessageType("error");
    } finally {
      setBusy(false);
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
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              width: "100%",
              flexWrap: "wrap",
            }}
          >
            <div className="stack-layout" style={{ gap: 4 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>
                {draft?.name || draft?.id || "Strategy"}
              </div>
              <div className="minor-text" style={{ fontSize: 11 }}>
                {draft?.id || (isPreset ? "Preset strategy" : "Unsaved strategy")} · {isPreset ? "preset" : draft?.status || "draft"}
              </div>
            </div>
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
              <button
                type="button"
                className="primary-button"
                onClick={activeTab === "json" ? handleSaveFromJson : handleSaveVisual}
                disabled={busy}
              >
                {busy ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={activeTab === "json" ? handleSaveAsFromJson : handleSaveAsVisual}
                disabled={busy}
              >
                Save As
              </button>
            </div>
          </div>
        }
        showToggle={false}
        border="always"
        bodyClassName="stack-layout"
      >
        <div className="stack-layout" style={{ gap: 12 }}>
          <TabBar
            value={activeTab}
            options={EDITOR_TABS}
            onChange={(nextValue) => setActiveTab(nextValue || "json")}
            size="sm"
            ariaLabel="Strategy editor tabs"
          />
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
                    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
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
                    <span className="minor-text">Status</span>
                    <FormComboSelect
                      value={resolveSelectValue(draft?.status, statusOptions)}
                      readOnly={isPreset}
                      onChange={(event) =>
                        updateDraft((base) => ({
                          ...base,
                          status: event.target.value,
                        }))
                      }
                    >
                      {toFlatOptions(statusOptions)}
                    </FormComboSelect>
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
                    <FormComboSelect
                      value={resolveSelectValue(draft?.market?.tf, timeframeOptions)}
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
                    </FormComboSelect>
                  </label>
                </div>
                {hasDescription || descriptionVisible ? (
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Description</span>
                    <textarea
                      className="input"
                      value={draft?.description || ""}
                      readOnly={isPreset}
                      onChange={(event) =>
                        updateDraft((base) => ({
                          ...base,
                          description: event.target.value,
                        }))
                      }
                      style={{
                        width: "100%",
                        minHeight: 84,
                        resize: "vertical",
                      }}
                    />
                  </label>
                ) : (
                  <EmptySectionButton
                    label="Description"
                    onClick={() => setDescriptionVisible(true)}
                  />
                )}
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
                      PARAM_KEY_OPTIONS.every((option) =>
                        Object.prototype.hasOwnProperty.call(draft?.params || {}, option.value),
                      )
                    }
                    onClick={() =>
                      updateDraft((base) => {
                        const nextParams = { ...(base.params || {}) };
                        const nextOption = PARAM_KEY_OPTIONS.find(
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
                        PARAM_KEY_OPTIONS.filter(
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
                        <FormComboSelect
                          value={resolveSelectValue(key, paramKeyOptions)}
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
                        </FormComboSelect>
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
                      />
                    ))}
                  </div>
                ) : null}
              </ResponsivePanel>

              <ResponsivePanel
                title="Risk"
                subtitle={hasRiskValues ? "" : "No risk config yet."}
                defaultOpen={hasRiskValues}
                collapseDirection="top-down"
                border="always"
                bodyClassName="stack-layout"
              >
                {hasRiskValues ? (
                  <div className="stack-layout" style={{ gap: 8 }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      {RISK_FIELDS.map((field) => (
                        <span key={field.key} className="minor-text" style={{ fontSize: 11 }}>
                          {field.label}
                        </span>
                      ))}
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      {RISK_FIELDS.map((field) => (
                        <input
                          key={field.key}
                          className="input"
                          value={draft?.risk?.[field.key] ?? ""}
                          onChange={(event) =>
                            updateDraft((base) => ({
                              ...base,
                              risk: {
                                ...(base.risk || {}),
                                [field.key]: Number(event.target.value || 0),
                              },
                            }))
                          }
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <HintText title="Add risk values when you want shared stop or target helpers.">
                    Add risk values when you want reusable stop, target, or trade limit settings.
                  </HintText>
                )}
              </ResponsivePanel>

              <ResponsivePanel
                title="Rules"
                subtitle={buildSectionSubtitle(
                  hasRuleValues,
                  "No rules yet.",
                  "Each rule has one condition group and one or more actions.",
                )}
                defaultOpen={hasRuleValues}
                collapseDirection="top-down"
                border="always"
                bodyClassName="stack-layout"
                headerActions={(
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      const visualNode = makeEmptyGroup("and");
                      const nextEvent = createEventDraft(
                        "entry_long",
                        buildExpressionFromVisualNode(visualNode),
                      );
                      nextEvent.actions = [createEventActionDraft("trade.open.long")];
                      setVisualEvents((current) => ({
                        ...current,
                        [nextEvent.id]: visualNode,
                      }));
                      setUnsupportedEvents((current) => ({
                        ...current,
                        [nextEvent.id]: false,
                      }));
                      updateDraft((base) => ({
                        ...base,
                        events: [...(Array.isArray(base.events) ? base.events : []), nextEvent],
                      }));
                    }}
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
                  {visibleEvents.map((event, eventIndex) => {
                    const hasRule = hasDataValue(event?.when);
                    return (
                      <div
                        key={event.id || `event_${eventIndex}`}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 12,
                          padding: 12,
                          background: "rgba(255,255,255,0.02)",
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "64px minmax(0, 1fr) auto",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 10,
                          }}
                        >
                          <span className="minor-text" style={{ fontSize: 10 }}>
                            Name
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <input
                              className="input"
                              value={String(event?.name || "")}
                              onChange={(evt) =>
                                updateDraft((base) => ({
                                  ...base,
                                  events: (Array.isArray(base.events) ? base.events : []).map((item) =>
                                    item.id === event.id ? { ...item, name: evt.target.value } : item,
                                  ),
                                }))
                              }
                              placeholder="Rule name"
                            />
                          </div>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => {
                              setVisualEvents((current) => {
                                const next = { ...current };
                                delete next[event.id];
                                return next;
                              });
                              setUnsupportedEvents((current) => {
                                const next = { ...current };
                                delete next[event.id];
                                return next;
                              });
                              updateDraft((base) => ({
                                ...base,
                                events: (Array.isArray(base.events) ? base.events : []).filter(
                                  (item) => item.id !== event.id,
                                ),
                              }));
                            }}
                            aria-label={`Remove event ${event?.name || eventIndex + 1}`}
                            title="Remove this rule"
                            style={COMPACT_DANGER_BUTTON_STYLE}
                          >
                            X
                          </button>
                        </div>
                        {!hasRule ? null : (
                          <div className="stack-layout" style={{ gap: 10 }}>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "64px minmax(0, 1fr)",
                                gap: 8,
                                alignItems: "start",
                              }}
                            >
                              <span className="minor-text" style={{ fontSize: 10, paddingTop: 10 }}>
                                Rules
                              </span>
                              <RuleTreeEditor
                                node={visualEvents[event.id] || makeEmptyGroup("and")}
                                variableOptions={variableOptions}
                                onChange={(nextNode) => setEventWhen(event.id, nextNode)}
                                onRemove={null}
                              />
                            </div>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "64px minmax(0, 1fr)",
                                gap: 8,
                                alignItems: "start",
                              }}
                            >
                              <span className="minor-text" style={{ fontSize: 10, paddingTop: 10 }}>
                                Actions
                              </span>
                              <div
                                style={{
                                  display: "flex",
                                  gap: 8,
                                  flexWrap: "wrap",
                                  alignItems: "flex-start",
                                }}
                              >
                                {(Array.isArray(event?.actions) ? event.actions : []).map((action) => (
                                  <StrategyEventActionRow
                                    key={action.id}
                                    action={action}
                                    onChange={(nextAction) =>
                                      updateEventAction(event.id, action.id, () => nextAction)
                                    }
                                    onRemove={() =>
                                      updateDraft((base) => ({
                                        ...base,
                                        events: (Array.isArray(base.events) ? base.events : []).map((item) =>
                                          item.id === event.id
                                            ? {
                                                ...item,
                                                actions: (Array.isArray(item.actions) ? item.actions : []).filter(
                                                  (entry) => entry.id !== action.id,
                                                ),
                                              }
                                            : item,
                                        ),
                                      }))
                                    }
                                  />
                                ))}
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() =>
                                    updateDraft((base) => ({
                                      ...base,
                                      events: (Array.isArray(base.events) ? base.events : []).map((item) =>
                                        item.id === event.id
                                          ? {
                                              ...item,
                                              actions: appendActionDraft(
                                                Array.isArray(item.actions) ? item.actions : [],
                                                String(
                                                  item.actions?.[item.actions.length - 1]?.type ||
                                                    "trade.open.long",
                                                ),
                                              ),
                                            }
                                          : item,
                                      ),
                                    }))
                                  }
                                >
                                  Add Action
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {!visibleEvents.length ? (
                    <div
                      style={{
                        borderRadius: 10,
                        padding: "20px 16px",
                        border: "1px solid rgba(148, 163, 184, 0.18)",
                        background: "rgba(255,255,255,0.015)",
                        textAlign: "center",
                      }}
                      >
                        <span className="minor-text" style={{ fontSize: 11 }}>
                        No rules yet.
                      </span>
                    </div>
                  ) : null}
                </div>
              </ResponsivePanel>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
