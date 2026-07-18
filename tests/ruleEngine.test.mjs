import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  RuleEngine,
  evaluateRuleExpression,
  evaluateRules,
  findPredefinedRule,
  listPredefinedRules,
} from "../src/shared/rules-engine/index.js";

const require = createRequire(import.meta.url);
const cjsRuleEngine = require("../src/shared/rules-engine/index.cjs");

function makeBars(closes = []) {
  return closes.map((close, index) => ({
    time: 1_717_200_000 + index * 60,
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: 10,
  }));
}

test("shared rule engine evaluates expressions for browser and node consumers", () => {
  const ctx = {
    indicators: { fast: 11, slow: 10 },
    prev_indicators: { fast: 9, slow: 10 },
    bar: { close: 11 },
    prev: { close: 9 },
  };
  const expression = {
    crosses_above: [{ var: "indicators.fast" }, { var: "indicators.slow" }],
  };

  assert.equal(evaluateRuleExpression(expression, ctx), true);
  assert.equal(cjsRuleEngine.evaluateRuleExpression(expression, ctx), true);
});

test("shared rule engine turns rule definitions into happened rule events", () => {
  const bars = makeBars([9, 10, 11]);
  const rule = {
    id: "price_crosses_key",
    abbr: "PX_KEY",
    name: "Price Crosses Key Level",
    icon: "crosshair",
    family: "key_level",
    condition: {
      crosses_above: [{ var: "bar.close" }, { var: "levels.key" }],
    },
    outputs: { bias: "bullish" },
  };

  const result = evaluateRules({
    bars,
    rules: [rule],
    baseContext: {
      symbol: "EURUSD",
      tf: "1m",
      levels: { key: 10 },
    },
  });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].rule_id, "price_crosses_key");
  assert.equal(result.events[0].abbr, "PX_KEY");
  assert.equal(result.events[0].symbol, "EURUSD");
  assert.equal(result.events[0].tf, "1m");
  assert.equal(result.events[0].price, 11);
  assert.equal(result.events[0].bias, "bullish");
});

test("RuleEngine instances can run reusable rule sets", () => {
  const engine = new RuleEngine({
    rules: [
      {
        id: "above_10",
        abbr: "A10",
        name: "Above 10",
        condition: { ">": [{ var: "bar.close" }, 10] },
      },
    ],
  });

  const result = engine.evaluateBars({ bars: makeBars([9, 11, 12]) });

  assert.deepEqual(
    result.events.map((event) => event.bar_index),
    [1, 2],
  );
});

test("predefined rule catalog exposes fresh detector building blocks", () => {
  const rules = listPredefinedRules();
  const ids = rules.map((rule) => rule.id);

  assert.ok(ids.includes("price_crosses_ema"));
  assert.ok(ids.includes("price_rejected_ema"));
  assert.ok(ids.includes("ema_fast_crosses_ema_slow"));
  assert.ok(ids.includes("liquidity_sweep"));
  assert.equal(findPredefinedRule("break_of_structure")?.abbr, "BOS");
});
