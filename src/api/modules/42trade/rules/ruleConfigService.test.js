"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  buildExampleRule,
  createRuleConfigService,
  listRules,
  readSchema,
  validateRulePayload,
} = require("./ruleConfigService");
const { createConfigStore } = require("../../../shared/config/configStore");

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

test("rule config service saves custom JSON rule files", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "42trade-rule-save-"));
  await fs.mkdir(path.join(projectRoot, "src", "config", "rules"), { recursive: true });
  const service = createRuleConfigService({
    configStore: createConfigStore({
      projectRoot,
      repo: {
        getObjectData: async () => null,
        upsertObject: async () => null,
      },
    }),
  });
  const item = await service.saveRule({
    id: "custom_breakout_test",
    abbr: "BRK_T",
    name: "Custom Breakout Test",
    condition: {
      crosses_above: [{ var: "bar.close" }, { var: "levels.key" }],
    },
  });
  const saved = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "src", "config", "rules", "custom_breakout_test.json"),
      "utf8",
    ),
  );

  assert.equal(item.kind, "custom");
  assert.equal(saved.id, "custom_breakout_test");
  assert.equal(saved.abbr, "BRK_T");
});
