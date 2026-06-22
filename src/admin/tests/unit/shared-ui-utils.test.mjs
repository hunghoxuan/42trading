import assert from "node:assert/strict";
import test from "node:test";
import { asFiniteOrNull, formatNum3 } from "../../utils/numberFormat.js";
import { getBrokerTicket } from "../../utils/tradeRow.js";
import { parseTextList } from "../../utils/textList.js";
import { maskSecretPreview } from "../../utils/secrets.js";
import { isCurrentAiTradePlan } from "../../utils/tradePlanShape.js";
import { formatWeekdayDateLabel } from "../../utils/format.js";
import {
  BACKTEST_CHART_THEME,
  resolveClosedTradeLineStyle,
} from "../../components/charts/backtestChartTheme.js";

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

test("formatWeekdayDateLabel returns short weekday plus day.month in timezone", () => {
  assert.equal(
    formatWeekdayDateLabel("2026-06-13T08:27:29Z", "UTC"),
    "Sat 13.06",
  );
  assert.equal(
    formatWeekdayDateLabel("2026-06-14T01:27:29Z", "America/New_York"),
    "Sat 13.06",
  );
});

test("resolveClosedTradeLineStyle draws only explicit exit-price close lines", () => {
  assert.deepEqual(
    resolveClosedTradeLineStyle(
      {
        closeStatus: "TP",
        pnlRealized: 25,
        exitPrice: 1.23456,
        tpPrice: 1.25,
        slPrice: 1.2,
      },
      null,
    ),
    {
      value: 1.23456,
      color: BACKTEST_CHART_THEME.plannedTp,
      dash: "0",
      title: "",
      text: "",
    },
  );

  assert.equal(
    resolveClosedTradeLineStyle(
      {
        closeStatus: "SL",
        pnlRealized: -10,
        exitPrice: null,
        tpPrice: 1.25,
        slPrice: 1.2,
      },
      null,
    ),
    null,
  );
});
