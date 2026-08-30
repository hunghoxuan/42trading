"use strict";

const { createConfigStore } = require("../../../shared/config/configStore");
const {
  compileRuleExpression,
} = require("../../../../shared/rules-engine/index.cjs");

const CATALOG_KINDS = new Set(["rule", "event", "strategy"]);
const defaultConfigStore = createConfigStore();

function normalizeCatalogKind(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  const singular = raw === "strategies" ? "strategy" : raw.replace(/s$/, "");
  return CATALOG_KINDS.has(singular) ? singular : "";
}

function normalizeCatalogId(value = "", fallback = "") {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
}

function expressionSource(definition = {}) {
  return definition?.condition ?? definition?.when ?? definition?.expression ?? null;
}

function validateExpressionSource(source, pathName, errors, { required = true } = {}) {
  if (source === null || source === undefined || source === "") {
    if (required) errors.push(`${pathName} is required`);
    return null;
  }
  try {
    return compileRuleExpression(source);
  } catch (error) {
    errors.push(`${pathName}: ${error.message}`);
    return null;
  }
}

function validateRuleOrEvent(kind, input = {}) {
  const errors = [];
  const item = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const id = normalizeCatalogId(item.id || item.key);
  const name = String(item.name || item.label || id).trim();
  const implementation =
    item.implementation && typeof item.implementation === "object"
      ? item.implementation
      : {};
  const implementationType = String(implementation.type || "expression").trim().toLowerCase();
  if (id.length < 3) errors.push("id must be at least 3 characters");
  if (!name) errors.push("name is required");
  if (!["builtin", "expression"].includes(implementationType)) {
    errors.push("implementation.type must be builtin or expression");
  }
  if (implementationType === "builtin") {
    const handler = String(implementation.handler || item.handler || id).trim();
    if (!handler) errors.push("implementation.handler is required for builtin items");
  } else {
    validateExpressionSource(expressionSource(item), `${kind}.expression`, errors);
  }
  return {
    ok: errors.length === 0,
    errors,
    item: {
      ...item,
      id,
      name,
      kind: String(item.kind || "custom").trim() || "custom",
      implementation: {
        ...implementation,
        type: implementationType,
        ...(implementationType === "builtin"
          ? { handler: String(implementation.handler || item.handler || id).trim() }
          : {}),
      },
    },
  };
}

function validateStrategy(input = {}) {
  const errors = [];
  const strategy = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const id = normalizeCatalogId(strategy.id || strategy.key);
  const name = String(strategy.name || id).trim();
  if (id.length < 3) errors.push("id must be at least 3 characters");
  if (!name) errors.push("name is required");
  const definitions = [
    ...(Array.isArray(strategy.rules) ? strategy.rules : []),
    ...(Array.isArray(strategy.events) ? strategy.events : []),
  ];
  definitions.forEach((definition, index) => {
    validateExpressionSource(
      expressionSource(definition),
      `strategy definitions[${index}].when`,
      errors,
      { required: false },
    );
  });
  if (!definitions.length && !strategy.event_logic && !strategy.when) {
    errors.push("strategy must contain rules, events, event_logic, or when");
  }
  return {
    ok: errors.length === 0,
    errors,
    item: {
      ...strategy,
      id,
      key: String(strategy.key || id).trim() || id,
      name,
      kind: String(strategy.kind || "custom").trim() || "custom",
      engine_version: String(strategy.engine_version || "42trade.strategy.v2").trim(),
      status: String(strategy.status || "draft").trim() || "draft",
    },
  };
}

function validateCatalogItem(kind, input = {}) {
  const normalizedKind = normalizeCatalogKind(kind);
  if (!normalizedKind) return { ok: false, errors: ["Unsupported catalog kind"], item: null };
  return normalizedKind === "strategy"
    ? validateStrategy(input)
    : validateRuleOrEvent(normalizedKind, input);
}

function createSharedCatalogService({ configStore = defaultConfigStore } = {}) {
  async function list(kind) {
    const normalizedKind = normalizeCatalogKind(kind);
    if (!normalizedKind) throw new Error("Unsupported catalog kind");
    const method =
      normalizedKind === "strategy"
        ? "listStrategies"
        : `list${normalizedKind[0].toUpperCase()}${normalizedKind.slice(1)}s`;
    const rows = await configStore[method]({ refresh: true });
    return rows
      .filter((item) => item && typeof item === "object")
      .map((item) => ({ ...item, id: normalizeCatalogId(item.id || item.key) }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  }

  async function get(kind, id) {
    const normalizedKind = normalizeCatalogKind(kind);
    const safeId = normalizeCatalogId(id);
    if (!normalizedKind || !safeId) return null;
    const method = `get${normalizedKind[0].toUpperCase()}${normalizedKind.slice(1)}`;
    return configStore[method](safeId, { refresh: true }).catch(() => null);
  }

  async function save(kind, input = {}) {
    const normalizedKind = normalizeCatalogKind(kind);
    const validation = validateCatalogItem(normalizedKind, input);
    if (!validation.ok) {
      const error = new Error(validation.errors.join("; "));
      error.validation_errors = validation.errors;
      throw error;
    }
    const method = `save${normalizedKind[0].toUpperCase()}${normalizedKind.slice(1)}`;
    await configStore[method](validation.item.id, validation.item);
    return validation.item;
  }

  async function remove(kind, id) {
    const normalizedKind = normalizeCatalogKind(kind);
    const safeId = normalizeCatalogId(id);
    if (!normalizedKind || !safeId) throw new Error("Invalid catalog item");
    await configStore.deleteDocument(normalizedKind, safeId);
    return { id: safeId, kind: normalizedKind };
  }

  return { get, list, remove, save, validateCatalogItem };
}

module.exports = {
  createSharedCatalogService,
  normalizeCatalogId,
  normalizeCatalogKind,
  validateCatalogItem,
};
