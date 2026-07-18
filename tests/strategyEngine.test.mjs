import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  StrategyEngine,
  evaluateEventLogic,
  evaluateStrategies,
} from "../src/shared/strategy-engine/index.js";

const require = createRequire(import.meta.url);
const cjsStrategyEngine = require("../src/shared/strategy-engine/index.cjs");

const events = [
  {
    rule_id: "price_rejected_ema",
    abbr: "RJ_EMA",
    symbol: "EURUSD",
    tf: "5m",
    time: 100,
    bar_index: 10,
    bias: "bullish",
    family: "moving_average",
  },
  {
    rule_id: "bullish_engulfing",
    abbr: "B_ENG",
    symbol: "EURUSD",
    tf: "5m",
    time: 160,
    bar_index: 11,
    bias: "bullish",
    family: "candle_pattern",
  },
];

test("strategy engine evaluates boolean event logic over RuleEvent arrays", () => {
  const result = evaluateEventLogic(
    {
      and: [
        { event: "price_rejected_ema", bias: "bullish" },
        { event: "bullish_engulfing", within_bars: 2 },
      ],
    },
    events,
  );

  assert.equal(result.matched, true);
  assert.deepEqual(
    result.events.map((event) => event.rule_id),
    ["price_rejected_ema", "bullish_engulfing"],
  );
});

test("strategy engine supports ordered THEN event chains", () => {
  const result = evaluateStrategies({
    events,
    strategies: [
      {
        id: "ema_rejection_reversal_v1",
        name: "EMA Rejection Reversal",
        event_logic: {
          then: [
            { event: "price_rejected_ema" },
            { event: "bullish_engulfing" },
          ],
        },
        actions: [{ action: "trade", direction: "buy" }],
      },
    ],
  });

  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].strategy_id, "ema_rejection_reversal_v1");
  assert.equal(result.signals[0].time, 160);
  assert.equal(result.signals[0].actions[0].action, "trade");
});

test("StrategyEngine instances and CJS exports share behavior", () => {
  const strategy = {
    id: "breakout_confirmation",
    event_logic: {
      or: [{ event: "bullish_engulfing" }, { event: "break_of_structure" }],
    },
    actions: [{ action: "notify.toast" }],
  };
  const esmEngine = new StrategyEngine({ strategies: [strategy] });
  const cjsEngine = new cjsStrategyEngine.StrategyEngine({ strategies: [strategy] });

  assert.equal(esmEngine.evaluateEvents({ events }).signals.length, 1);
  assert.equal(cjsEngine.evaluateEvents({ events }).signals.length, 1);
});
