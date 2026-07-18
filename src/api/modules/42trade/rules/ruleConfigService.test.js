"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildExampleRule,
  listRules,
  readSchema,
  validateRulePayload,
} = require("./ruleConfigService");

test("rule config service merges predefined JS rules with custom JSON rules", async () => {
  const rules = await listRules();
  const ids = rules.map((rule) => rule.id);

  assert.ok(ids.includes("price_crosses_ema"));
  assert.ok(ids.includes("price_crosses_ema_custom"));
  assert.equal(rules.find((rule) => rule.id === "price_crosses_ema")?.kind, "predefined");
  assert.equal(rules.find((rule) => rule.id === "price_crosses_ema_custom")?.kind, "custom");
});

test("rule config service exposes schema and validates the example rule", async () => {
  const schema = await readSchema();
  const example = buildExampleRule();
  const validation = validateRulePayload(example);

  assert.equal(schema.$id, "42trade.rule.v1");
  assert.equal(validation.ok, true);
  assert.equal(validation.rule.id, example.id);
  assert.equal(validation.rule.abbr, example.abbr);
});
