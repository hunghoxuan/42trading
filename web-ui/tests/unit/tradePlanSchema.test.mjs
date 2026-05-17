import test from "node:test";
import assert from "node:assert/strict";
import { resolvePlans } from "../../src/services/TradePlanSchema.js";

test("resolvePlans prefers __raw_plan and keeps multi-tp values", () => {
  const root = {
    direction: "BUY",
    tp: "77700",
    __raw_plan: {
      symbol: "BTCUSD",
      direction: "SELL",
      entry_price: 78380,
      stop_loss: 78620,
      risk_reward: 2.8,
      multiple_exits: {
        tp1: { price: 77700, risk_reward: 2.8 },
        tp2: { price: 77200, risk_reward: 4.5 },
        tp3: { price: 76500, risk_reward: 7.0 },
      },
    },
  };

  const plans = resolvePlans(root);
  assert.equal(plans.length, 1);
  const plan = plans[0];
  assert.equal(String(plan.direction).toUpperCase(), "SELL");
  assert.equal(Number(plan.entry), 78380);
  assert.equal(Number(plan.sl), 78620);
  assert.equal(Number(plan.tp), 77700);
  assert.equal(Number(plan.tp2), 77200);
  assert.equal(Number(plan.tp3), 76500);
});
