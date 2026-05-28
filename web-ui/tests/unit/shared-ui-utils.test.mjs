import assert from "node:assert/strict";
import test from "node:test";
import { asFiniteOrNull, formatNum3 } from "../../src/utils/numberFormat.js";
import { getBrokerTicket } from "../../src/utils/tradeRow.js";
import { parseTextList } from "../../src/utils/textList.js";
import { maskSecretPreview } from "../../src/utils/secrets.js";
import { isCurrentAiTradePlan } from "../../src/utils/tradePlanShape.js";

test("number helpers normalize finite values and preserve compact precision", () => {
  assert.equal(asFiniteOrNull("12.5"), 12.5);
  assert.equal(asFiniteOrNull(""), null);
  assert.equal(asFiniteOrNull("wat"), null);
  assert.equal(formatNum3("1.23000000"), "1.23");
  assert.equal(formatNum3("not-a-number"), "");
});

test("getBrokerTicket prefers broker_trade_id then ticket", () => {
  assert.equal(getBrokerTicket({ broker_trade_id: " 976 " }), "976");
  assert.equal(getBrokerTicket({ ticket: 123 }), "123");
  assert.equal(getBrokerTicket({}), "-");
});

test("parseTextList splits newlines and commas, dedupes, and optionally uppercases", () => {
  assert.deepEqual(parseTextList("eurusd, gbpusd\nEURUSD", { uppercase: true }), ["EURUSD", "GBPUSD"]);
  assert.deepEqual(parseTextList("one,, two\none"), ["one", "two"]);
});

test("maskSecretPreview keeps recognizable prefix and suffix only", () => {
  assert.equal(maskSecretPreview(""), "");
  assert.equal(maskSecretPreview("abcdef"), "a****f");
  assert.equal(maskSecretPreview("abcdefghijkl"), "abcd****ijkl");
});

test("isCurrentAiTradePlan recognizes current execution_plan schema", () => {
  assert.equal(isCurrentAiTradePlan({ execution_plan: {}, direction: "BUY" }), true);
  assert.equal(isCurrentAiTradePlan({ execution_plan: {} }), false);
  assert.equal(isCurrentAiTradePlan([{ execution_plan: {}, direction: "BUY" }]), false);
});
