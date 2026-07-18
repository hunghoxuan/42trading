"use strict";

const { createConfigStore } = require("../../../shared/config/configStore");
const {
  findPredefinedRule,
  listPredefinedRules,
  normalizeRuleDefinition,
} = require("../../../../shared/rules-engine/index.cjs");

const defaultConfigStore = createConfigStore();

function normalizeRuleId(value = "", fallback = "rule") {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
}

function validateRulePayload(input = {}) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["rule must be an object"], rule: null };
  }
  const id = normalizeRuleId(input.id);
  const abbr = String(input.abbr || input.short_name || "").trim();
  const name = String(input.name || input.label || "").trim();
  const condition =
    input.condition && typeof input.condition === "object" && !Array.isArray(input.condition)
      ? input.condition
      : input.when && typeof input.when === "object" && !Array.isArray(input.when)
        ? input.when
        : null;
  if (!id || id.length < 3) errors.push("id must be at least 3 characters");
  if (!abbr) errors.push("abbr is required");
  if (!name) errors.push("name is required");
  if (!condition) errors.push("condition must be an expression object");
  const rule = normalizeRuleDefinition({
    ...input,
    id,
    abbr,
    name,
    condition,
  });
  return { ok: errors.length === 0, errors, rule };
}

async function readSchema(configStore = defaultConfigStore) {
  return configStore.getSchema("rule", { refresh: true });
}

async function listCustomRules(configStore = defaultConfigStore) {
  const rows = await configStore.listRules({ refresh: true }).catch(() => []);
  return rows
    .map((row, index) => validateRulePayload(row).ok ? normalizeRuleDefinition(row, index) : null)
    .filter(Boolean)
    .map((rule) => ({ ...rule, kind: "custom" }));
}

async function listRules(configStore = defaultConfigStore) {
  const predefined = listPredefinedRules().map((rule) => ({ ...rule, kind: "predefined" }));
  const custom = await listCustomRules(configStore);
  return [...predefined, ...custom];
}

async function getRule(ruleId = "", configStore = defaultConfigStore) {
  const id = normalizeRuleId(ruleId, "");
  if (!id) return null;
  const predefined = findPredefinedRule(id);
  if (predefined) return { ...predefined, kind: "predefined" };
  const custom = await configStore.getRule(id, { refresh: true }).catch(() => null);
  if (!custom) return null;
  const validation = validateRulePayload(custom);
  return validation.ok ? { ...validation.rule, kind: "custom" } : null;
}

function buildExampleRule() {
  return {
    id: "price_crosses_ema_custom",
    abbr: "PX_EMA",
    name: "Price Crosses EMA",
    icon: "crosshair",
    family: "moving_average",
    params: {
      side: "above",
      source: "close",
      ema_length: 20,
    },
    condition: {
      crosses_above: [{ var: "bar.close" }, { var: "indicators.ema_20" }],
    },
    outputs: {
      bias: "bullish",
      marker: "arrow_up",
      severity: "medium",
    },
  };
}

function createRuleConfigService({ configStore = defaultConfigStore } = {}) {
  return {
    readSchema: () => readSchema(configStore),
    validateRulePayload,
    listCustomRules: () => listCustomRules(configStore),
    listRules: () => listRules(configStore),
    getRule: (ruleId) => getRule(ruleId, configStore),
    buildExampleRule,
  };
}

module.exports = {
  buildExampleRule,
  createRuleConfigService,
  getRule,
  listCustomRules,
  listRules,
  readSchema,
  validateRulePayload,
};
