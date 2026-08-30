"use strict";

const { createConfigStore } = require("../../../shared/config/configStore");
const objectStore = require("../../../shared/objects/objectStoreRepo");
const { compileRuleExpression } = require("../../../../shared/rules-engine/index.cjs");
const defaultConfigStore = createConfigStore();

const SUPPORTED_INDICATORS = new Set([
  "ema",
  "sma",
  "rsi",
  "roc",
  "macd",
  "bollinger",
  "stochastic",
  "highest_high",
  "lowest_low",
]);
const SUPPORTED_SOURCES = new Set(["open", "high", "low", "close", "volume"]);

const EVENT_ACTION_TYPES = new Set([
  "trade",
  "draw",
  "notify.toast",
  "notify.notification",
  "webhook.post",
]);

function normalizeStrategyId(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 64);
}

function normalizeEventId(value = "", fallback = "event") {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 64);
}

function validateExpression(
  node,
  errors,
  pathName = "rules",
  { supportedOperators = new Set(), supportedFunctions = new Set() } = {},
) {
  if (node === null || node === undefined) {
    errors.push(`${pathName} must not be null`);
    return;
  }
  if (
    typeof node === "number" ||
    typeof node === "string" ||
    typeof node === "boolean"
  ) {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) =>
      validateExpression(item, errors, `${pathName}[${index}]`),
    );
    return;
  }
  if (typeof node !== "object") {
    errors.push(`${pathName} must be a valid expression object`);
    return;
  }
  if (typeof node.fn === "string") {
    const functionName = String(node.fn || "").trim();
    if (!supportedFunctions.has(functionName)) {
      errors.push(`${pathName}.fn uses unsupported function "${functionName}"`);
      return;
    }
    const args = Array.isArray(node.args) ? node.args : [];
    args.forEach((item, index) =>
      validateExpression(item, errors, `${pathName}.args[${index}]`, {
        supportedOperators,
        supportedFunctions,
      }),
    );
    return;
  }
  const keys = Object.keys(node);
  if (keys.length !== 1) {
    errors.push(`${pathName} must contain exactly one operator`);
    return;
  }
  const operator = keys[0];
  if (!supportedOperators.has(operator)) {
    errors.push(`${pathName} uses unsupported operator "${operator}"`);
    return;
  }
  const value = node[operator];
  if (operator === "var") {
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`${pathName}.var must be a non-empty string`);
    }
    return;
  }
  if (operator === "not" || operator === "abs") {
    validateExpression(value, errors, `${pathName}.${operator}`, {
      supportedOperators,
      supportedFunctions,
    });
    return;
  }
  const items = Array.isArray(value) ? value : [value];
  if (!items.length) {
    errors.push(`${pathName}.${operator} must have at least one operand`);
    return;
  }
  items.forEach((item, index) =>
    validateExpression(item, errors, `${pathName}.${operator}[${index}]`, {
      supportedOperators,
      supportedFunctions,
    }),
  );
}

function buildSupportedValueSet(items = []) {
  return new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => String(item?.value || "").trim())
      .filter(Boolean),
  );
}

function normalizeStrategyConditions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const timeframes = [...new Set(
    [
      ...(Array.isArray(input?.timeframes) ? input.timeframes : []),
      ...(Array.isArray(input?.tfs) ? input.tfs : []),
      input?.tf,
    ]
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  )];
  const symbols = [...new Set(
    (Array.isArray(input?.symbols) ? input.symbols : [])
      .map((item) => String(item || "").trim().toUpperCase())
      .filter(Boolean),
  )];
  const sessions = [...new Set(
    (Array.isArray(input?.sessions) ? input.sessions : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  )];
  const tags = [...new Set(
    (Array.isArray(input?.tags) ? input.tags : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  )];
  const regimeTags = [...new Set(
    (Array.isArray(input?.regime_tags) ? input.regime_tags : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  )];
  const out = {
    ...(timeframes.length ? { timeframes } : {}),
    ...(symbols.length ? { symbols } : {}),
    ...(sessions.length ? { sessions } : {}),
    ...(tags.length ? { tags } : {}),
    ...(regimeTags.length ? { regime_tags: regimeTags } : {}),
  };
  if (typeof input?.skip_news === "boolean") out.skip_news = input.skip_news;
  if (Number.isFinite(Number(input?.news_window_minutes))) {
    out.news_window_minutes = Math.max(0, Number(input.news_window_minutes));
  }
  if (Number.isFinite(Number(input?.news_before_minutes))) {
    out.news_before_minutes = Math.max(0, Number(input.news_before_minutes));
  }
  if (Number.isFinite(Number(input?.news_after_minutes))) {
    out.news_after_minutes = Math.max(0, Number(input.news_after_minutes));
  }
  if (Number.isFinite(Number(input?.min_rr))) {
    out.min_rr = Number(input.min_rr);
  }
  if (Number.isFinite(Number(input?.max_spread))) {
    out.max_spread = Number(input.max_spread);
  }
  if (Number.isFinite(Number(input?.min_atr))) {
    out.min_atr = Number(input.min_atr);
  }
  if (Number.isFinite(Number(input?.cooldown_bars))) {
    out.cooldown_bars = Math.max(0, Number(input.cooldown_bars));
  }
  if (Number.isFinite(Number(input?.max_signals_per_session))) {
    out.max_signals_per_session = Math.max(0, Number(input.max_signals_per_session));
  }
  return out;
}

async function loadStrategyAssets(configStore = defaultConfigStore) {
  const [schema, strategyFunctions] = await Promise.all([
    configStore.getSchema("strategy", { refresh: true }),
    configStore.getStrategyFunctions({ refresh: true }),
  ]);
  return {
    schema: schema && typeof schema === "object" ? schema : {},
    supportedOperators: buildSupportedValueSet(strategyFunctions?.operators),
    supportedFunctions: buildSupportedValueSet(strategyFunctions?.functions),
  };
}

async function readSchema(configStore = defaultConfigStore) {
  const { schema } = await loadStrategyAssets(configStore);
  return schema;
}

function resolveActionKind(action = {}) {
  const raw = String(action?.action || action?.type || "").trim();
  if (raw === "trade.open.long" || raw === "trade.open.short") return "trade";
  return raw;
}

function normalizeTradeDirection(value = "", fallback = "buy") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["buy", "bull", "long"].includes(normalized)) return "buy";
  if (["sell", "bear", "short"].includes(normalized)) return "sell";
  return fallback === "sell" ? "sell" : "buy";
}

function normalizeTradePlanField(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;
    return trimmed;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return null;
}

function normalizeTradePlan(plan = {}, fallbackDirection = "buy") {
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
    entry: normalizeTradePlanField(base?.entry ?? base?.entry_price),
    sl: normalizeTradePlanField(base?.sl ?? base?.stop_loss),
    tp: normalizeTradePlanField(base?.tp ?? base?.tp1 ?? base?.tp2 ?? base?.tp3),
  };
}

function normalizeStrategyAction(action = {}) {
  const actionKind = resolveActionKind(action);
  const fallbackDirection =
    String(action?.type || "").trim() === "trade.open.short" ? "sell" : "buy";
  return {
    id: normalizeEventId(action?.id, "action"),
    action: actionKind,
    ...(actionKind === "trade"
      ? { trade_plan: normalizeTradePlan(action?.trade_plan, fallbackDirection) }
      : {}),
    ...(action?.message !== undefined ? { message: String(action.message || "") } : {}),
    ...(action?.url !== undefined ? { url: String(action.url || "") } : {}),
    ...(action?.method !== undefined
      ? { method: String(action.method || "POST").trim().toUpperCase() || "POST" }
      : {}),
  };
}

function normalizeRuleBias(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["bull", "bullish", "buy", "long"].includes(normalized)) return "bullish";
  if (["bear", "bearish", "sell", "short"].includes(normalized)) return "bearish";
  return "neutral";
}

function normalizeRulePriority(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["strong", "high"].includes(normalized)) return "strong";
  if (["weak", "low"].includes(normalized)) return "weak";
  return "medium";
}

function createFallbackRuleAction(direction = "buy") {
  return {
    id: normalizeEventId(`action_${direction}`, "action"),
    action: "trade",
    trade_plan: normalizeTradePlan({}, direction),
  };
}

function humanizeRuleName(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return "Rule";
  if (["entry_long", "bullish"].includes(normalized.toLowerCase())) return "Buy";
  if (["entry_short", "bearish"].includes(normalized.toLowerCase())) return "Sell";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeStrategyRule(rule = {}, index = 0) {
  const rawActions = Array.isArray(rule?.actions) ? rule.actions : [];
  const name = humanizeRuleName(rule?.name || rule?.label || `Rule ${index + 1}`);
  const normalizedActions = rawActions.map((action) =>
    normalizeStrategyAction({
      ...action,
      action:
        String(action?.action || action?.type || "").trim() === "chart.note"
          ? "draw"
          : action?.action || action?.type,
      message: action?.message ?? action?.label,
    }),
  );
  return {
    id: normalizeEventId(rule?.id, `rule_${index + 1}`),
    name,
    bias:
      name === "Buy"
        ? "bullish"
        : name === "Sell"
          ? "bearish"
          : normalizeRuleBias(rule?.bias),
    priority: normalizeRulePriority(rule?.priority),
    when:
      typeof rule?.when === "string"
        ? rule.when
        : rule?.when && typeof rule.when === "object" && !Array.isArray(rule.when)
        ? rule.when
        : { and: [] },
    actions: normalizedActions,
  };
}

function normalizeRulesFromStrategy(strategy = {}) {
  if (Array.isArray(strategy.rules) && strategy.rules.length) {
    return strategy.rules.map((rule, index) => normalizeStrategyRule(rule, index));
  }
  if (Array.isArray(strategy.events) && strategy.events.length) {
    return strategy.events.map((event, index) => {
      const normalizedActions = (Array.isArray(event?.actions) ? event.actions : []).map((action) =>
        normalizeStrategyAction({
          ...action,
          action:
            String(action?.action || action?.type || "").trim() === "chart.note"
              ? "draw"
              : action?.action || action?.type,
          message: action?.message ?? action?.label,
        }),
      );
      const tradeAction = normalizedActions.find((action) => action.action === "trade");
      return {
        id: normalizeEventId(event?.id, `rule_${index + 1}`),
        name:
          String(event?.name || event?.label || `Rule ${index + 1}`).trim() || `Rule ${index + 1}`,
        bias: normalizeRuleBias(
          event?.bias ||
            (tradeAction ? normalizeTradeDirection(tradeAction?.trade_plan?.direction, "buy") : "neutral"),
        ),
        priority: normalizeRulePriority(event?.priority),
        when:
          typeof event?.when === "string"
            ? event.when
            : event?.when && typeof event.when === "object" && !Array.isArray(event.when)
            ? event.when
            : { and: [] },
        actions: normalizedActions,
      };
    });
  }
  const legacyRules =
    strategy.rules && typeof strategy.rules === "object" && !Array.isArray(strategy.rules)
      ? strategy.rules
      : {};
  return Object.entries(legacyRules)
    .filter(([, when]) =>
      typeof when === "string" || (when && typeof when === "object" && !Array.isArray(when)),
    )
    .map(([key, when], index) => {
      const lowerKey = String(key || "").trim().toLowerCase();
      const bullish = ["bullish", "entry_long"].includes(lowerKey);
      const bearish = ["bearish", "entry_short"].includes(lowerKey);
      return {
        id: normalizeEventId(key, `rule_${index + 1}`),
        name: humanizeRuleName(key),
        bias: bullish ? "bullish" : bearish ? "bearish" : "neutral",
        priority: "medium",
        when,
        actions: [
          bullish || bearish
            ? createFallbackRuleAction(bullish ? "buy" : "sell")
            : {
                id: normalizeEventId(`${key}_draw`, "action"),
                action: "draw",
                message: humanizeRuleName(key),
              },
        ],
      };
    });
}

async function validateStrategyPayload(
  input = {},
  { configStore = defaultConfigStore } = {},
) {
  const errors = [];
  const strategy = input && typeof input === "object" ? input : {};
  const normalizedId = normalizeStrategyId(strategy.id);
  const { supportedOperators, supportedFunctions } =
    await loadStrategyAssets(configStore);

  if (!normalizedId || normalizedId.length < 3) {
    errors.push("id must be 3-64 chars using letters, numbers, dot, underscore, or dash");
  }
  if (typeof strategy.name !== "string" || strategy.name.trim().length < 3) {
    errors.push("name must be at least 3 chars");
  }
  if (strategy.engine_version !== "42trade.strategy.v1") {
    if (strategy.engine_version !== "42trade.strategy.v2") {
      errors.push("engine_version must be 42trade.strategy.v1 or 42trade.strategy.v2");
    }
  }
  if (strategy.kind !== "custom") {
    errors.push("kind must be custom");
  }
  if (!["draft", "active", "archived"].includes(String(strategy.status || ""))) {
    errors.push("status must be draft, active, or archived");
  }
  if (!strategy.params || typeof strategy.params !== "object" || Array.isArray(strategy.params)) {
    errors.push("params must be an object");
  }
  if (!Array.isArray(strategy.indicators)) {
    errors.push("indicators must be an array");
  } else {
    const ids = new Set();
    for (const [index, indicator] of strategy.indicators.entries()) {
      if (!indicator || typeof indicator !== "object") {
        errors.push(`indicators[${index}] must be an object`);
        continue;
      }
      const indicatorId = String(indicator.id || "").trim();
      if (!indicatorId) errors.push(`indicators[${index}].id is required`);
      if (ids.has(indicatorId)) errors.push(`indicators[${index}].id must be unique`);
      ids.add(indicatorId);
      if (!SUPPORTED_INDICATORS.has(String(indicator.type || "").trim())) {
        errors.push(`indicators[${index}].type is unsupported`);
      }
      const source = String(indicator.source || "close").trim();
      if (!SUPPORTED_SOURCES.has(source)) {
        errors.push(`indicators[${index}].source is unsupported`);
      }
    }
  }
  const normalizedRules = normalizeRulesFromStrategy(strategy);
  if (
    strategy.rules !== undefined &&
    !Array.isArray(strategy.rules) &&
    (typeof strategy.rules !== "object" || Array.isArray(strategy.rules))
  ) {
    errors.push("rules must be an array or legacy rule object");
  }
  if (strategy.events !== undefined && !Array.isArray(strategy.events)) {
    errors.push("events must be an array when provided");
  }
  for (const [index, rule] of normalizedRules.entries()) {
    let compiledWhen = null;
    try {
      compiledWhen = compileRuleExpression(rule.when);
    } catch (error) {
      errors.push(`rules[${index}].when: ${error.message}`);
    }
    if (!compiledWhen || typeof compiledWhen !== "object" || Array.isArray(compiledWhen)) {
      errors.push(`rules[${index}].when is required`);
    } else {
      validateExpression(compiledWhen, errors, `rules[${index}].when`, {
        supportedOperators,
        supportedFunctions,
      });
    }
    if (!Array.isArray(rule.actions) || !rule.actions.length) {
      errors.push(`rules[${index}].actions must have at least one action`);
    } else {
      for (const [actionIndex, action] of rule.actions.entries()) {
        const normalizedAction = normalizeStrategyAction(action);
        const type = normalizedAction.action;
        if (!EVENT_ACTION_TYPES.has(type)) {
          errors.push(`rules[${index}].actions[${actionIndex}].action is unsupported`);
        }
        if (type === "webhook.post" && !String(normalizedAction?.url || "").trim()) {
          errors.push(`rules[${index}].actions[${actionIndex}].url is required for webhook.post`);
        }
        if (type === "trade") {
          const tradePlan = normalizedAction.trade_plan || {};
          if (!["buy", "sell"].includes(String(tradePlan.direction || ""))) {
            errors.push(`rules[${index}].actions[${actionIndex}].trade_plan.direction is required`);
          }
          if (!["market", "limit", "stop"].includes(String(tradePlan.type || ""))) {
            errors.push(`rules[${index}].actions[${actionIndex}].trade_plan.type is invalid`);
          }
        }
      }
    }
  }
  if (!Array.isArray(normalizedRules) || !normalizedRules.length) {
    errors.push("rules must contain at least one rule");
  }
  if (!strategy.risk || typeof strategy.risk !== "object" || Array.isArray(strategy.risk)) {
    errors.push("risk must be an object");
  }
  if (
    strategy.conditions !== undefined &&
    (typeof strategy.conditions !== "object" ||
      strategy.conditions === null ||
      Array.isArray(strategy.conditions))
  ) {
    errors.push("conditions must be an object when provided");
  }

  return {
    ok: errors.length === 0,
    errors,
    strategy: {
      id: normalizedId,
      name: String(strategy.name || "").trim(),
      description: String(strategy.description || "").trim(),
      engine_version:
        strategy.engine_version === "42trade.strategy.v2"
          ? "42trade.strategy.v2"
          : "42trade.strategy.v1",
      kind: "custom",
      status: String(strategy.status || "draft"),
      market:
        strategy.market && typeof strategy.market === "object" ? strategy.market : {},
      params:
        strategy.params && typeof strategy.params === "object" && !Array.isArray(strategy.params)
          ? strategy.params
          : {},
      indicators: Array.isArray(strategy.indicators)
        ? strategy.indicators.map((indicator) => ({
            ...indicator,
            id: String(indicator?.id || "").trim(),
            type: String(indicator?.type || "").trim(),
            source: String(indicator?.source || "close").trim() || "close",
            field: String(indicator?.field || "").trim() || undefined,
          }))
        : [],
      rules: normalizedRules.map((rule, index) => ({
        id: normalizeEventId(rule.id, `rule_${index + 1}`),
        name: String(rule.name || `Rule ${index + 1}`).trim() || `Rule ${index + 1}`,
        bias: normalizeRuleBias(rule.bias),
        priority: normalizeRulePriority(rule.priority),
        when: rule.when,
        actions: (Array.isArray(rule.actions) ? rule.actions : []).map((action, actionIndex) => ({
          ...normalizeStrategyAction(action),
          id: normalizeEventId(action?.id, `action_${actionIndex + 1}`),
        })),
      })),
      risk:
        strategy.risk && typeof strategy.risk === "object" && !Array.isArray(strategy.risk)
          ? strategy.risk
          : {},
      conditions: normalizeStrategyConditions(strategy.conditions),
      metadata:
        strategy.metadata && typeof strategy.metadata === "object" && !Array.isArray(strategy.metadata)
          ? strategy.metadata
          : {},
    },
  };
}

async function listStrategies(userId) {
  const rows = await objectStore.listObjectsByType(userId, "strategies");
  return rows.map((row) => row.data || {}).filter(Boolean);
}

async function getStrategy(userId, strategyId) {
  const row = await objectStore.getObject(userId, "strategies", strategyId);
  return row?.data || null;
}

async function saveStrategy(userId, payload = {}) {
  const validation = await validateStrategyPayload(payload);
  if (!validation.ok) {
    const error = new Error(validation.errors.join("; "));
    error.validation_errors = validation.errors;
    throw error;
  }
  const now = new Date().toISOString();
  const existing = await getStrategy(userId, validation.strategy.id);
  const strategySchema = await readSchema();
  const strategy = {
    ...validation.strategy,
    metadata: {
      ...(existing?.metadata || {}),
      ...(validation.strategy.metadata || {}),
      created_at: existing?.metadata?.created_at || now,
      updated_at: now,
      schema_id: strategySchema.$id,
    },
  };
  await objectStore.upsertObject(
    userId,
    "strategies",
    strategy.id,
    strategy,
    String(strategy.status || "draft").toUpperCase(),
  );
  return strategy;
}

async function archiveStrategy(userId, strategyId) {
  const existing = await getStrategy(userId, strategyId);
  if (!existing) return null;
  return saveStrategy(userId, {
    ...existing,
    status: "archived",
  });
}

async function deleteStrategy(userId, strategyId) {
  await objectStore.deleteObject(userId, "strategies", strategyId);
}

function buildExampleStrategy() {
  return {
    id: "custom_rsi_reversion",
    name: "Custom RSI Reversion",
    description: "Buy RSI recovery from oversold and sell rollover from overbought.",
    engine_version: "42trade.strategy.v2",
    kind: "custom",
    status: "draft",
    market: {
      symbol: "EURAUD",
      tf: "15"
    },
    params: {
      rsi_oversold: 30,
      rsi_overbought: 70
    },
    indicators: [
      {
        id: "rsi14",
        type: "rsi",
        source: "close",
        length: 14
      }
    ],
    events: [
      {
        id: "bullish",
        name: "Bullish",
        when: {
          "and": [
            { "<=": [{ "var": "prev_indicators.rsi14" }, { "var": "params.rsi_oversold" }] },
            { ">": [{ "var": "indicators.rsi14" }, { "var": "params.rsi_oversold" }] }
          ]
        },
        actions: [
          {
            id: "bullish_trade",
            action: "trade",
            trade_plan: {
              direction: "buy",
              type: "market",
              entry: null,
              sl: null,
              tp: null,
            }
          }
        ]
      },
      {
        id: "bearish",
        name: "Bearish",
        when: {
          "and": [
            { ">=": [{ "var": "prev_indicators.rsi14" }, { "var": "params.rsi_overbought" }] },
            { "<": [{ "var": "indicators.rsi14" }, { "var": "params.rsi_overbought" }] }
          ]
        },
        actions: [
          {
            id: "bearish_trade",
            action: "trade",
            trade_plan: {
              direction: "sell",
              type: "market",
              entry: null,
              sl: null,
              tp: null,
            }
          }
        ]
      }
    ],
    rules: {
      "bullish": {
        "and": [
          { "<=": [{ "var": "prev_indicators.rsi14" }, { "var": "params.rsi_oversold" }] },
          { ">": [{ "var": "indicators.rsi14" }, { "var": "params.rsi_oversold" }] }
        ]
      },
      "bearish": {
        "and": [
          { ">=": [{ "var": "prev_indicators.rsi14" }, { "var": "params.rsi_overbought" }] },
          { "<": [{ "var": "indicators.rsi14" }, { "var": "params.rsi_overbought" }] }
        ]
      },
      "stop_loss_long": {
        "-": [{ "var": "bar.close" }, 0.0009]
      },
      "stop_loss_short": {
        "+": [{ "var": "bar.close" }, 0.0009]
      },
      "take_profit_long": {
        "+": [{ "var": "bar.close" }, 0.00135]
      },
      "take_profit_short": {
        "-": [{ "var": "bar.close" }, 0.00135]
      }
    },
    risk: {
      rr_target: 1.5,
      min_rr: 1.5,
      stop_lookback: 3,
      max_open_trades: 1,
      fallback_stop_pct: 0.001,
      fallback_tp_pct: 0.0015
    },
    conditions: {
      timeframes: ["15m"],
      skip_news: true,
      news_window_minutes: 120,
      min_rr: 1.5,
      max_spread: null,
      min_atr: null,
      cooldown_bars: null,
      max_signals_per_session: null,
      sessions: [],
      regime_tags: [],
      symbols: [],
    },
    metadata: {
      author: "42trade"
    }
  };
}

function createStrategyConfigService({
  configStore = defaultConfigStore,
  storeRepo = objectStore,
} = {}) {
  return {
    readSchema: () => readSchema(configStore),
    validateStrategyPayload: (input = {}) =>
      validateStrategyPayload(input, { configStore }),
    async listStrategies(userId) {
      const rows = await storeRepo.listObjectsByType(userId, "strategies");
      return rows.map((row) => row.data || {}).filter(Boolean);
    },
    async getStrategy(userId, strategyId) {
      const row = await storeRepo.getObject(userId, "strategies", strategyId);
      return row?.data || null;
    },
    async saveStrategy(userId, payload = {}) {
      const validation = await validateStrategyPayload(payload, { configStore });
      if (!validation.ok) {
        const error = new Error(validation.errors.join("; "));
        error.validation_errors = validation.errors;
        throw error;
      }
      const now = new Date().toISOString();
      const existing = await this.getStrategy(userId, validation.strategy.id);
      const strategySchema = await readSchema(configStore);
      const strategy = {
        ...validation.strategy,
        metadata: {
          ...(existing?.metadata || {}),
          ...(validation.strategy.metadata || {}),
          created_at: existing?.metadata?.created_at || now,
          updated_at: now,
          schema_id: strategySchema.$id,
        },
      };
      await storeRepo.upsertObject(
        userId,
        "strategies",
        strategy.id,
        strategy,
        String(strategy.status || "draft").toUpperCase(),
      );
      return strategy;
    },
    async archiveStrategy(userId, strategyId) {
      const existing = await this.getStrategy(userId, strategyId);
      if (!existing) return null;
      return this.saveStrategy(userId, {
        ...existing,
        status: "archived",
      });
    },
    async deleteStrategy(userId, strategyId) {
      await storeRepo.deleteObject(userId, "strategies", strategyId);
    },
    buildExampleStrategy,
  };
}

const strategyConfigService = createStrategyConfigService();

module.exports = {
  ...strategyConfigService,
  createStrategyConfigService,
  strategyConfigService,
};
