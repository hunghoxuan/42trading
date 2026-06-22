import { useEffect, useMemo, useState } from "react";
import FormComboSelect from "../../shared/components/FormComboSelect";
import ResponsivePanel from "../../shared/components/ResponsivePanel";
import TabBar from "../../shared/components/TabBar";

const EDITOR_TABS = [
  { value: "json", label: "Json" },
  { value: "edit", label: "Visual Edit" },
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
];

const RULE_SECTIONS = [
  { key: "entry_long", label: "Entry Long", required: true },
  { key: "entry_short", label: "Entry Short", required: true },
  { key: "exit_long", label: "Exit Long", required: false },
  { key: "exit_short", label: "Exit Short", required: false },
];

const INDICATOR_TYPE_OPTIONS = [
  { value: "ema", label: "EMA" },
  { value: "sma", label: "SMA" },
  { value: "rsi", label: "RSI" },
  { value: "roc", label: "ROC" },
  { value: "macd", label: "MACD" },
  { value: "bollinger", label: "Bollinger" },
  { value: "stochastic", label: "Stochastic" },
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
  { value: "slow_period", label: "slow_period" },
  { value: "period", label: "period" },
  { value: "rsi_period", label: "rsi_period" },
  { value: "oversold", label: "oversold" },
  { value: "overbought", label: "overbought" },
  { value: "rr_target", label: "rr_target" },
  { value: "stop_lookback", label: "stop_lookback" },
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

function normalizeEditorStrategy(value) {
  const nextValue = deepClone(value) || {};
  if (nextValue && typeof nextValue === "object") {
    delete nextValue.min_bars;
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
    return { var: String(operand?.value || "").trim() };
  }
  return parseLiteralInput(operand?.value);
}

function buildExpressionFromVisualNode(node) {
  if (!node) return null;
  if (node.type === "group") {
    return {
      [node.operator === "or" ? "or" : "and"]: Array.isArray(node.children)
        ? node.children.map((child) => buildExpressionFromVisualNode(child)).filter(Boolean)
        : [],
    };
  }
  if (node.type === "condition") {
    return {
      [node.comparator || ">"]: [
        buildExpressionFromOperand(node.left),
        buildExpressionFromOperand(node.right),
      ],
    };
  }
  return null;
}

function makeEmptyCondition() {
  return {
    id: createNodeId("condition"),
    type: "condition",
    comparator: ">",
    left: { kind: "var", value: "indicators.ema_fast" },
    right: { kind: "var", value: "indicators.ema_slow" },
  };
}

function makeEmptyGroup(operator = "and") {
  return {
    id: createNodeId("group"),
    type: "group",
    operator: operator === "or" ? "or" : "and",
    children: [makeEmptyCondition()],
  };
}

function toFlatOptions(items = []) {
  return items.map((item) => (
    <option key={item.value} value={item.value}>
      {item.label}
    </option>
  ));
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
    engine_version: "42trade.strategy.v1",
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
    rules:
      base.rules && typeof base.rules === "object" && !Array.isArray(base.rules)
        ? base.rules
        : {},
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

function buildRuleEditorState(draft) {
  const nextVisualRules = {};
  const nextUnsupportedRules = {};
  for (const section of RULE_SECTIONS) {
    const expr = draft?.rules?.[section.key];
    if (!expr) {
      nextVisualRules[section.key] = null;
      continue;
    }
    const visual = buildVisualNodeFromExpression(expr);
    if (visual) {
      nextVisualRules[section.key] = visual;
    } else {
      nextVisualRules[section.key] = null;
      nextUnsupportedRules[section.key] = true;
    }
  }
  return {
    nextVisualRules,
    nextUnsupportedRules,
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
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
      }}
    >
      <FormComboSelect
        value={isLiteral ? "literal" : "var"}
        onChange={(event) =>
          onChange({
            kind: event.target.value === "literal" ? "literal" : "var",
            value:
              event.target.value === "literal"
                ? formatLiteralInput(isLiteral ? operand?.value : 0)
                : isLiteral
                  ? variableOptions[0] || "bar.close"
                  : operand?.value || "",
          })
        }
        aria-label="Operand type"
        title="Choose whether this side uses a fixed value or a variable path."
        style={{
          width: 84,
          minWidth: 84,
        }}
      >
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
            minHeight: 34,
            minWidth: 0,
            width: "100%",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--panel-2, rgba(255,255,255,0.03))",
            color: "var(--text)",
            padding: "8px 10px",
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
            minHeight: 34,
            minWidth: 0,
            width: "100%",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--panel-2, rgba(255,255,255,0.03))",
            color: "var(--text)",
            padding: "8px 10px",
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
  return (
    <FormComboSelect
      value={node.comparator || ">"}
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
      {toFlatOptions(COMPARATOR_OPTIONS)}
    </FormComboSelect>
  );
}

function StrategyConditionEditor({
  node,
  onChange,
  onRemove,
  variableOptions,
}) {
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
          gridTemplateColumns: "minmax(0, 1fr) 110px minmax(0, 1fr) auto",
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
  const indicatorType = String(indicator?.type || "ema");
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "end",
          flexWrap: "wrap",
        }}
      >
        <label className="stack-layout" style={{ gap: 6 }}>
          <span className="minor-text" title="Unique id used inside rule variables, for example indicators.ema_1.">
            ID
          </span>
          <input
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
              minHeight: 36,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.03)",
              color: "var(--text)",
              padding: "8px 10px",
              minWidth: 120,
            }}
          />
        </label>
        <label className="stack-layout" style={{ gap: 6, minWidth: 120, flex: "1 1 120px" }}>
          <span className="minor-text" title="Indicator formula type.">
            Type
          </span>
          <FormComboSelect
            value={indicatorType}
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
            {toFlatOptions(INDICATOR_TYPE_OPTIONS)}
          </FormComboSelect>
        </label>
        <label className="stack-layout" style={{ gap: 6, minWidth: 120, flex: "1 1 120px" }}>
          <span className="minor-text" title="Price or volume field used to calculate the indicator.">
            Source
          </span>
          <FormComboSelect
            value={indicator?.source || "close"}
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
            {toFlatOptions(INDICATOR_SOURCE_OPTIONS)}
          </FormComboSelect>
        </label>
        <label className="stack-layout" style={{ gap: 6, minWidth: 100, flex: "0 1 100px" }}>
          <span className="minor-text" title="Main lookback length.">
            Length
          </span>
          <input
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
              minHeight: 36,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.03)",
              color: "var(--text)",
              padding: "8px 10px",
            }}
          />
        </label>
        {indicatorType === "macd" ? (
          <>
            <label className="stack-layout" style={{ gap: 6, minWidth: 100, flex: "0 1 100px" }}>
              <span className="minor-text" title="Fast moving average length.">
                Fast
              </span>
              <input
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
                title="Fast MACD length."
                style={{
                  minHeight: 36,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.03)",
                  color: "var(--text)",
                  padding: "8px 10px",
                }}
              />
            </label>
            <label className="stack-layout" style={{ gap: 6, minWidth: 100, flex: "0 1 100px" }}>
              <span className="minor-text" title="Slow moving average length.">
                Slow
              </span>
              <input
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
                title="Slow MACD length."
                style={{
                  minHeight: 36,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.03)",
                  color: "var(--text)",
                  padding: "8px 10px",
                }}
              />
            </label>
            <label className="stack-layout" style={{ gap: 6, minWidth: 100, flex: "0 1 100px" }}>
              <span className="minor-text" title="Signal smoothing length.">
                Signal
              </span>
              <input
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
                title="MACD signal length."
                style={{
                  minHeight: 36,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.03)",
                  color: "var(--text)",
                  padding: "8px 10px",
                }}
              />
            </label>
          </>
        ) : null}
        {indicatorType === "bollinger" ? (
          <label className="stack-layout" style={{ gap: 6, minWidth: 100, flex: "0 1 100px" }}>
            <span className="minor-text" title="Band width multiplier.">
              Std dev
            </span>
            <input
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
              title="Bollinger standard deviation multiplier."
              style={{
                minHeight: 36,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "rgba(255,255,255,0.03)",
                color: "var(--text)",
                padding: "8px 10px",
              }}
            />
          </label>
        ) : null}
        {indicatorType === "stochastic" ? (
          <label className="stack-layout" style={{ gap: 6, minWidth: 100, flex: "0 1 100px" }}>
            <span className="minor-text" title="Smoothing period for the stochastic output.">
              Smooth
            </span>
            <input
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
              title="Stochastic smoothing period."
              style={{
                minHeight: 36,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "rgba(255,255,255,0.03)",
                color: "var(--text)",
                padding: "8px 10px",
              }}
            />
          </label>
        ) : null}
        {INDICATOR_FIELD_OPTIONS[indicatorType] ? (
          <label className="stack-layout" style={{ gap: 6, minWidth: 120, flex: "1 1 120px" }}>
            <span className="minor-text" title="Which output line to use from this indicator.">
              Field
            </span>
            <FormComboSelect
              value={indicator?.field || INDICATOR_FIELD_OPTIONS[indicatorType][0]?.value || ""}
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
              {toFlatOptions(INDICATOR_FIELD_OPTIONS[indicatorType])}
            </FormComboSelect>
          </label>
        ) : null}
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
    </div>
  );
}

function StrategyHelpBlock() {
  return (
    <div className="stack-layout" style={{ gap: 8 }}>
      <HintText title="Strategy rules can reference candle values, indicator ids, and parameters.">
        Use `bar.open`, `bar.close`, `indicators.ema_1`, or `params.fast_period` inside rules.
      </HintText>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <StrategyHintBadge title="Compare two live values from the market or indicators.">
          Variable vs variable
        </StrategyHintBadge>
        <StrategyHintBadge title="Turn on Fixed value when you want thresholds like RSI below 30.">
          Fixed value for thresholds
        </StrategyHintBadge>
        <StrategyHintBadge title="Indicators must have an id before rules can reference them.">
          Give indicators clear ids
        </StrategyHintBadge>
      </div>
    </div>
  );
}

function RuleTreeEditor({
  node,
  onChange,
  onRemove,
  variableOptions,
  depth = 0,
}) {
  if (!node) return null;
  if (node.type === "condition") {
    return (
      <StrategyConditionEditor
        node={node}
        onChange={onChange}
        onRemove={onRemove}
        variableOptions={variableOptions}
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <TabBar
          value={node.operator || "and"}
          options={LOGIC_OPTIONS}
          onChange={(nextValue) =>
            onChange({
              ...node,
              operator: nextValue || "and",
            })
          }
          size="sm"
          ariaLabel="Condition group operator"
        />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              onChange({
                ...node,
                children: [...(node.children || []), makeEmptyCondition()],
              })
            }
          >
            + Condition
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              onChange({
                ...node,
                children: [...(node.children || []), makeEmptyGroup("and")],
              })
            }
          >
            + Group
          </button>
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
      </div>
      <div className="stack-layout" style={{ gap: 10 }}>
        {(node.children || []).length ? (
          node.children.map((child) => (
            <RuleTreeEditor
              key={child.id}
              node={child}
              variableOptions={variableOptions}
              depth={depth + 1}
              onChange={(nextChild) =>
                onChange(updateTreeNode(node, child.id, () => nextChild))
              }
              onRemove={() => onChange(removeTreeNode(node, child.id) || makeEmptyGroup(node.operator))}
            />
          ))
        ) : (
          <div className="minor-text" style={{ fontSize: 11 }}>
            No conditions yet.
          </div>
        )}
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
  onArchive,
  onDelete,
}) {
  const [activeTab, setActiveTab] = useState("json");
  const [draft, setDraft] = useState(null);
  const [jsonText, setJsonText] = useState("");
  const [visualRules, setVisualRules] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [unsupportedRules, setUnsupportedRules] = useState({});
  const [descriptionVisible, setDescriptionVisible] = useState(false);
  const isPreset = String(draft?.kind || "").trim() !== "custom";

  useEffect(() => {
    const defaultTab = isNewDraft ? "edit" : "json";
    const nextTab = getEditorTabFromHash(defaultTab);
    const nextDraft =
      nextTab === "edit"
        ? buildDefaultDraft(strategy || exampleStrategy, {
            symbol: defaultSymbol,
            tf: defaultTf,
          })
        : strategy
      ? normalizeEditorStrategy(strategy)
          : buildDefaultDraft(exampleStrategy, {
              symbol: defaultSymbol,
              tf: defaultTf,
            });
    const { nextVisualRules, nextUnsupportedRules } = buildRuleEditorState(nextDraft);
      setDraft(normalizeEditorStrategy(nextDraft));
    setJsonText(prettyJson(nextDraft));
    setVisualRules(nextVisualRules);
    setUnsupportedRules(nextUnsupportedRules);
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
    const nextDraft = buildDefaultDraft(strategy || exampleStrategy, {
      symbol: defaultSymbol,
      tf: defaultTf,
    });
    const { nextVisualRules, nextUnsupportedRules } = buildRuleEditorState(nextDraft);
    setDraft(nextDraft);
    setJsonText(prettyJson(nextDraft));
    setVisualRules(nextVisualRules);
    setUnsupportedRules(nextUnsupportedRules);
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
  const hasRuleValues = RULE_SECTIONS.some((section) => hasDataValue(draft?.rules?.[section.key]));
  const hasParams = Object.keys(draft?.params || {}).length > 0;
  const hasDescription = hasDataValue(draft?.description);
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
    setDraft(nextDraft);
    setJsonText(prettyJson(nextDraft));
  }

  function updateDraft(updater) {
    setDraft((current) => {
      const base = deepClone(current) || buildDefaultDraft(exampleStrategy, {
        symbol: defaultSymbol,
        tf: defaultTf,
      });
      const nextDraft = updater(base);
      setJsonText(prettyJson(nextDraft));
      return nextDraft;
    });
  }

  function setRuleNode(ruleKey, node) {
    setVisualRules((current) => ({
      ...current,
      [ruleKey]: node,
    }));
    setUnsupportedRules((current) => ({
      ...current,
      [ruleKey]: false,
    }));
    updateDraft((base) => {
      const nextRules = { ...(base.rules || {}) };
      const nextExpression = buildExpressionFromVisualNode(node);
      if (nextExpression) nextRules[ruleKey] = nextExpression;
      else delete nextRules[ruleKey];
      return {
        ...base,
        rules: nextRules,
      };
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
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: 12,
                  }}
                >
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">ID</span>
                    <input
                      value={draft?.id || ""}
                      readOnly={isPreset}
                      onChange={(event) =>
                        updateDraft((base) => ({
                          ...base,
                          id: sanitizeStrategyId(event.target.value),
                        }))
                      }
                      style={{
                        minHeight: 36,
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "rgba(255,255,255,0.03)",
                        color: "var(--text)",
                        padding: "8px 10px",
                      }}
                    />
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Name</span>
                    <input
                      value={draft?.name || ""}
                      readOnly={isPreset}
                      onChange={(event) =>
                        updateDraft((base) => ({
                          ...base,
                          name: event.target.value,
                        }))
                      }
                      style={{
                        minHeight: 36,
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "rgba(255,255,255,0.03)",
                        color: "var(--text)",
                        padding: "8px 10px",
                      }}
                    />
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Status</span>
                    <FormComboSelect
                      value={draft?.status || "draft"}
                      readOnly={isPreset}
                      onChange={(event) =>
                        updateDraft((base) => ({
                          ...base,
                          status: event.target.value || "draft",
                        }))
                      }
                    >
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                    </FormComboSelect>
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Symbol</span>
                    <input
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
                      style={{
                        minHeight: 36,
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "rgba(255,255,255,0.03)",
                        color: "var(--text)",
                        padding: "8px 10px",
                      }}
                    />
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Timeframe</span>
                    <input
                      value={draft?.market?.tf || ""}
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
                      style={{
                        minHeight: 36,
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "rgba(255,255,255,0.03)",
                        color: "var(--text)",
                        padding: "8px 10px",
                      }}
                    />
                  </label>
                </div>
                {hasDescription || descriptionVisible ? (
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Description</span>
                    <textarea
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
                        borderRadius: 10,
                        border: "1px solid var(--border)",
                        background: "rgba(255,255,255,0.03)",
                        color: "var(--text)",
                        padding: 10,
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
                    {Object.entries(draft?.params || {}).map(([key, value]) => (
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
                          value={key}
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
                          {toFlatOptions(
                            PARAM_KEY_OPTIONS.filter(
                              (option) =>
                                option.value === key ||
                                !Object.prototype.hasOwnProperty.call(draft?.params || {}, option.value),
                            ),
                          )}
                        </FormComboSelect>
                        <input
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
                          style={{
                            minHeight: 36,
                            borderRadius: 8,
                            border: "1px solid var(--border)",
                            background: "rgba(255,255,255,0.03)",
                            color: "var(--text)",
                            padding: "8px 10px",
                          }}
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
                    ))}
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
                subtitle={buildSectionSubtitle(
                  hasRiskValues,
                  "No risk config yet.",
                  "Optional stop and target helpers.",
                )}
                defaultOpen={hasRiskValues}
                border="always"
                bodyClassName="stack-layout"
              >
                {hasRiskValues ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 10,
                    }}
                  >
                    {RISK_FIELDS.map((field) => (
                      <label key={field.key} className="stack-layout" style={{ gap: 6 }}>
                        <span className="minor-text">{field.label}</span>
                        <input
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
                          style={{
                            minHeight: 36,
                            borderRadius: 8,
                            border: "1px solid var(--border)",
                            background: "rgba(255,255,255,0.03)",
                            color: "var(--text)",
                            padding: "8px 10px",
                          }}
                        />
                      </label>
                    ))}
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
                  "Build AND/OR groups with variables or fixed values.",
                )}
                defaultOpen={hasRuleValues}
                border="always"
                bodyClassName="stack-layout"
              >
                <StrategyHelpBlock />
                <datalist id="strategy-variable-suggestions">
                  {variableOptions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
                <div className="stack-layout" style={{ gap: 14 }}>
                  {RULE_SECTIONS.filter((section) => hasDataValue(draft?.rules?.[section.key]) || unsupportedRules[section.key]).map((section) => {
                    const hasRule = hasDataValue(draft?.rules?.[section.key]);
                    return (
                      <div
                        key={section.key}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 12,
                          padding: 12,
                          background: "rgba(255,255,255,0.02)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                            flexWrap: "wrap",
                            marginBottom: 10,
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 800 }}>{section.label}</div>
                            <div className="minor-text" style={{ fontSize: 10 }}>
                              {section.required ? "Required" : "Optional"}
                            </div>
                          </div>
                          {unsupportedRules[section.key] ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => setRuleNode(section.key, makeEmptyGroup("and"))}
                            >
                              Replace With Builder
                            </button>
                          ) : null}
                        </div>
                        {!hasRule ? null : unsupportedRules[section.key] ? (
                          <div className="minor-text" style={{ fontSize: 11, color: "#fbbf24" }}>
                            This rule uses JSON logic the visual editor does not yet map cleanly. Use Json tab to preserve it, or replace it with a visual rule group here.
                          </div>
                        ) : (
                          <RuleTreeEditor
                            node={visualRules[section.key] || makeEmptyGroup("and")}
                            variableOptions={variableOptions}
                            onChange={(nextNode) => setRuleNode(section.key, nextNode)}
                            onRemove={() => setRuleNode(section.key, null)}
                          />
                        )}
                      </div>
                    );
                  })}
                  {RULE_SECTIONS.some((section) => !hasDataValue(draft?.rules?.[section.key]) && !unsupportedRules[section.key]) ? (
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      <span className="minor-text" style={{ fontSize: 11 }}>
                        Add rule section:
                      </span>
                      {RULE_SECTIONS.filter((section) => !hasDataValue(draft?.rules?.[section.key]) && !unsupportedRules[section.key]).map((section) => (
                        <button
                          key={section.key}
                          type="button"
                          className="secondary-button"
                          onClick={() => setRuleNode(section.key, makeEmptyGroup("and"))}
                        >
                          {section.label}
                        </button>
                      ))}
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
