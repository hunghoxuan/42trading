import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const helpers = require("../src/api/utils/tradeRef");

test("normalizeTradeFolderSid strips duplicate symbol suffix from composite trade refs", () => {
  assert.equal(
    helpers.normalizeTradeFolderSid("TGGI0EIY1-XAUUSD"),
    "TGGI0EIY1",
  );
  assert.equal(
    helpers.normalizeTradeFolderSid("TGGI0EIY1-XAUUSD", "XAUUSD"),
    "TGGI0EIY1",
  );
});

test("extractSymbolFromTradeRef returns broker symbol hints from composite refs", () => {
  assert.equal(helpers.extractSymbolFromTradeRef("TGGI0EIY1-XAUUSD"), "XAUUSD");
  assert.equal(helpers.extractSymbolFromTradeRef("TFW31TPGY-BTCUSD"), "BTCUSD");
});

test("normalizeTradeFolderSid leaves non-composite refs unchanged", () => {
  assert.equal(helpers.normalizeTradeFolderSid("trade-42"), "trade-42");
  assert.equal(helpers.normalizeTradeFolderSid("TGGI0EIY1"), "TGGI0EIY1");
});
