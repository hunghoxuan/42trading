import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calculateBarsForDateRange,
  resolveTimeRangeSelection,
} from "../../shared/utils/backtestBarsRange.js";
import { deriveBacktestFormFromRun } from "../../shared/utils/backtestForm.js";

const backtestBarsSelectorSource = readFileSync(
  new URL("../../modules/42trade/components/BacktestBarsSelector.jsx", import.meta.url),
  "utf8",
);

test("resolveTimeRangeSelection expands preset to date inputs and computed bars", () => {
  const selection = resolveTimeRangeSelection({
    mode: "time_range",
    timeframe: "60",
    preset: "today",
    now: "2026-06-30T12:00:00Z",
  });

  assert.equal(selection.startDate, "2026-06-30");
  assert.equal(selection.endDate, "2026-06-30");
  assert.equal(selection.limit, "24");
});

test("calculateBarsForDateRange counts bars from inclusive start and end dates", () => {
  assert.equal(
    calculateBarsForDateRange({
      timeframe: "15",
      startDate: "2026-06-01",
      endDate: "2026-06-14",
    }),
    1344,
  );
});

test("deriveBacktestFormFromRun resets bars selector to bars mode", () => {
  const nextForm = deriveBacktestFormFromRun(
    {
      symbol: "XAUUSD",
      tf: "60",
      limit: 1000,
      strategy_key: "ema_cross_v1",
    },
    {
      limit_mode: "time_range",
      limit_preset: "today",
      limit_start_date: "2026-06-30",
      limit_end_date: "2026-06-30",
    },
  );

  assert.equal(nextForm.limit, "1000");
  assert.equal(nextForm.limit_mode, "bars");
});

test("BacktestBarsSelector uses a compact trigger with a dropdown panel", () => {
  assert.match(backtestBarsSelectorSource, /<DropdownMenu\.Trigger asChild>/);
  assert.match(backtestBarsSelectorSource, /combo-button-menu-trigger/);
  assert.match(backtestBarsSelectorSource, /<DropdownMenu\.Content/);
  assert.doesNotMatch(backtestBarsSelectorSource, /<InputComboSelect/);
  assert.doesNotMatch(backtestBarsSelectorSource, /^<div className="stack-layout" style=\{\{ gap: 8 \}\}>/m);
});
