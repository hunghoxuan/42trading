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
import { inferPatternAt } from "../src/shared/rules-engine/features/detectArtifacts.js";

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
  assert.ok(ids.includes("price_crosses_below_ema"));
  assert.ok(ids.includes("price_rejected_ema"));
  assert.ok(ids.includes("ema_fast_crosses_ema_slow"));
  assert.ok(ids.includes("ema_fast_crosses_below_ema_slow"));
  assert.ok(ids.includes("stochastic_cross_up"));
  assert.ok(ids.includes("macd_crosses_above_zero"));
  assert.ok(ids.includes("liquidity_sweep"));
  assert.equal(findPredefinedRule("break_of_structure")?.abbr, "BOS");
});

test("predefined stochastic cross rule evaluates with shared indicator context", () => {
  const bars = makeBars([10]);
  const rule = findPredefinedRule("stochastic_cross_up");
  const result = evaluateRules({
    bars,
    rules: [rule],
    baseContext: {
      symbol: "EURUSD",
      tf: "5m",
      indicators: { stoch_k: 55, stoch_d: 45 },
      prev_indicators: { stoch_k: 35, stoch_d: 40 },
    },
  });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].rule_id, "stochastic_cross_up");
  assert.equal(result.events[0].bias, "bullish");
});

test("harami direction follows the second contained candle", () => {
  const bar = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 10 });
  const neutralBeforeImpulse = [
    bar(1, 102, 103, 100, 101),
    bar(2, 100, 102, 99, 101),
    bar(3, 102, 103, 99, 100),
    bar(4, 100, 102, 99, 101),
    bar(5, 100, 111, 99, 110),
    bar(6, 108, 110, 105, 106),
  ];
  assert.equal(inferPatternAt(neutralBeforeImpulse, 5).includes("bearish_harami"), true);
  assert.equal(inferPatternAt(neutralBeforeImpulse, 5).includes("bullish_harami"), false);

  const establishedUptrend = [
    bar(1, 100, 102, 99, 101),
    bar(2, 101, 103, 100, 102),
    bar(3, 102, 103, 101, 101.5),
    bar(4, 101.5, 104, 101, 103),
    bar(5, 103, 111, 102, 110),
    bar(6, 108, 110, 105, 106),
  ];
  assert.equal(inferPatternAt(establishedUptrend, 5).includes("bearish_harami"), true);

  const bullishSecondCandle = establishedUptrend.slice(0, 5).concat([
    bar(6, 106, 109, 105, 108),
  ]);
  assert.equal(inferPatternAt(bullishSecondCandle, 5).includes("bullish_harami"), true);
  assert.equal(inferPatternAt(bullishSecondCandle, 5).includes("bearish_harami"), false);

  const lowerWickDoji = establishedUptrend.slice(0, 5).concat([
    bar(6, 107, 108, 104, 107),
  ]);
  assert.equal(inferPatternAt(lowerWickDoji, 5).includes("bullish_harami"), true);
  assert.equal(inferPatternAt(lowerWickDoji, 5).includes("bearish_harami"), false);

  // New priority rules:
  // 1) 2x wick imbalance on the 2nd candle overrides its own red body.
  const redWithBigBottomWick = establishedUptrend.slice(0, 5).concat([
    bar(6, 108, 109, 102, 106),
  ]);
  assert.equal(inferPatternAt(redWithBigBottomWick, 5).includes("bullish_harami"), true);
  assert.equal(inferPatternAt(redWithBigBottomWick, 5).includes("bearish_harami"), false);

  // 1b) A 2.5x bottom wick already trips the 2x threshold (would not at 3x).
  const twoAndHalfWick = establishedUptrend.slice(0, 5).concat([
    bar(6, 108, 109, 103.5, 106),
  ]);
  assert.equal(inferPatternAt(twoAndHalfWick, 5).includes("bullish_harami"), true);
  assert.equal(inferPatternAt(twoAndHalfWick, 5).includes("bearish_harami"), false);

  // 2) Tiny body + balanced wicks: the 2nd candle is reluctant and follows the mother.
  const reluctantFollowsRedMother = [
    bar(1, 100, 102, 99, 101),
    bar(2, 101, 103, 100, 102),
    bar(3, 102, 103, 101, 101.5),
    bar(4, 101.5, 104, 101, 103),
    bar(5, 110, 111, 102, 103),
    bar(6, 106, 108, 104, 105.5),
  ];
  assert.equal(inferPatternAt(reluctantFollowsRedMother, 5).includes("bearish_harami"), true);
  assert.equal(inferPatternAt(reluctantFollowsRedMother, 5).includes("bullish_harami"), false);

  // 2b) Same tiny-body shape but a green mother flips it bullish.
  const reluctantFollowsGreenMother = [
    bar(1, 100, 102, 99, 101),
    bar(2, 101, 103, 100, 102),
    bar(3, 102, 103, 101, 101.5),
    bar(4, 101.5, 104, 101, 103),
    bar(5, 100, 109, 99, 108),
    bar(6, 106, 108, 104, 105.5),
  ];
  assert.equal(inferPatternAt(reluctantFollowsGreenMother, 5).includes("bullish_harami"), true);
  assert.equal(inferPatternAt(reluctantFollowsGreenMother, 5).includes("bearish_harami"), false);
});
