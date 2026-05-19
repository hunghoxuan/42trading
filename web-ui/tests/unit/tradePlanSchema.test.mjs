import test from "node:test";
import assert from "node:assert/strict";
import { extractPlans, resolvePlans } from "../../src/services/TradePlanSchema.js";

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

test("extractPlans preserves direct v3 AI plan object", () => {
  const rawPlan = {
    symbol: "CADJPY",
    direction: "SELL",
    context: {
      htf_bias: "Bearish",
      draw_on_liquidity: "SSL cluster near 114.800",
    },
    analysis: {
      sl_validity: {
        sl_behind_structure: {
          invalidation_logic: "Candle body close above 116.150",
        },
      },
    },
    execution_plan: {
      entry: { price: 115.65, reference: "15M-OB-1" },
      stop_loss: { price: 116.15 },
      tp1: { price: 115.13, rr: 1.04 },
      tp2: { price: 114.8, rr: 1.7 },
      tp3: { price: 114.2, rr: 2.9 },
      risk_reward: 3.4,
    },
    risk_management: {
      confidence_pct: 68,
      suggested_action: "Proceed",
    },
  };

  const plans = extractPlans(rawPlan);

  assert.equal(plans.length, 1);
  assert.equal(plans[0], rawPlan);
  assert.equal(plans[0].analysis.sl_validity.sl_behind_structure.invalidation_logic, "Candle body close above 116.150");
  assert.equal(plans[0].execution_plan.tp3.price, 114.2);
  assert.equal(plans[0].risk_management.confidence_pct, 68);
});
