"use strict";

const objectStore = require("../objects/objectStore");

const STRATEGY_SCHEMA = require("../../config/schema/strategy.json");

const SUPPORTED_INDICATORS = new Set([
  "ema",
  "sma",
  "rsi",
  "roc",
  "macd",
  "bollinger",
  "stochastic",
]);
const SUPPORTED_SOURCES = new Set(["open", "high", "low", "close", "volume"]);
const SUPPORTED_OPERATORS = new Set([
  "var",
  "and",
  "or",
  "not",
  "if",
  ">",
  "<",
  ">=",
  "<=",
  "==",
  "!=",
  "+",
  "-",
  "*",
  "/",
  "abs",
  "min",
  "max",
]);

function readSchema() {
  return STRATEGY_SCHEMA;
}

function normalizeStrategyId(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 64);
}

function validateExpression(node, errors, pathName = "rules") {
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
  const keys = Object.keys(node);
  if (keys.length !== 1) {
    errors.push(`${pathName} must contain exactly one operator`);
    return;
  }
  const operator = keys[0];
  if (!SUPPORTED_OPERATORS.has(operator)) {
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
    validateExpression(value, errors, `${pathName}.${operator}`);
    return;
  }
  const items = Array.isArray(value) ? value : [value];
  if (!items.length) {
    errors.push(`${pathName}.${operator} must have at least one operand`);
    return;
  }
  items.forEach((item, index) =>
    validateExpression(item, errors, `${pathName}.${operator}[${index}]`),
  );
}

function validateStrategyPayload(input = {}) {
  const errors = [];
  const strategy = input && typeof input === "object" ? input : {};
  const normalizedId = normalizeStrategyId(strategy.id);

  if (!normalizedId || normalizedId.length < 3) {
    errors.push("id must be 3-64 chars using letters, numbers, dot, underscore, or dash");
  }
  if (typeof strategy.name !== "string" || strategy.name.trim().length < 3) {
    errors.push("name must be at least 3 chars");
  }
  if (strategy.engine_version !== "42trade.strategy.v1") {
    errors.push("engine_version must be 42trade.strategy.v1");
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
  if (!strategy.rules || typeof strategy.rules !== "object" || Array.isArray(strategy.rules)) {
    errors.push("rules must be an object");
  } else {
    if (!("entry_long" in strategy.rules)) errors.push("rules.entry_long is required");
    if (!("entry_short" in strategy.rules)) errors.push("rules.entry_short is required");
    for (const key of [
      "entry_long",
      "entry_short",
      "exit_long",
      "exit_short",
      "stop_loss_long",
      "stop_loss_short",
      "take_profit_long",
      "take_profit_short",
    ]) {
      if (key in strategy.rules) {
        validateExpression(strategy.rules[key], errors, `rules.${key}`);
      }
    }
  }
  if (!strategy.risk || typeof strategy.risk !== "object" || Array.isArray(strategy.risk)) {
    errors.push("risk must be an object");
  }

  return {
    ok: errors.length === 0,
    errors,
    strategy: {
      id: normalizedId,
      name: String(strategy.name || "").trim(),
      description: String(strategy.description || "").trim(),
      engine_version: "42trade.strategy.v1",
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
      rules:
        strategy.rules && typeof strategy.rules === "object" && !Array.isArray(strategy.rules)
          ? strategy.rules
          : {},
      risk:
        strategy.risk && typeof strategy.risk === "object" && !Array.isArray(strategy.risk)
          ? strategy.risk
          : {},
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
  const validation = validateStrategyPayload(payload);
  if (!validation.ok) {
    const error = new Error(validation.errors.join("; "));
    error.validation_errors = validation.errors;
    throw error;
  }
  const now = new Date().toISOString();
  const existing = await getStrategy(userId, validation.strategy.id);
  const strategy = {
    ...validation.strategy,
    metadata: {
      ...(existing?.metadata || {}),
      ...(validation.strategy.metadata || {}),
      created_at: existing?.metadata?.created_at || now,
      updated_at: now,
      schema_id: STRATEGY_SCHEMA.$id,
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
    engine_version: "42trade.strategy.v1",
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
    rules: {
      "entry_long": {
        "and": [
          { "<=": [{ "var": "prev_indicators.rsi14" }, { "var": "params.rsi_oversold" }] },
          { ">": [{ "var": "indicators.rsi14" }, { "var": "params.rsi_oversold" }] }
        ]
      },
      "entry_short": {
        "and": [
          { ">=": [{ "var": "prev_indicators.rsi14" }, { "var": "params.rsi_overbought" }] },
          { "<": [{ "var": "indicators.rsi14" }, { "var": "params.rsi_overbought" }] }
        ]
      },
      "exit_long": {
        ">=": [{ "var": "indicators.rsi14" }, 55]
      },
      "exit_short": {
        "<=": [{ "var": "indicators.rsi14" }, 45]
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
      stop_lookback: 3,
      max_open_trades: 1,
      fallback_stop_pct: 0.001,
      fallback_tp_pct: 0.0015
    },
    metadata: {
      author: "42trade"
    }
  };
}

module.exports = {
  readSchema,
  validateStrategyPayload,
  listStrategies,
  getStrategy,
  saveStrategy,
  archiveStrategy,
  deleteStrategy,
  buildExampleStrategy,
};
