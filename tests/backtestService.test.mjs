import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const backtestService = require("../src/api/backtests/backtestService");

const { normalizeBarRows, simulateSignalStrategy } = backtestService.__test;

test("normalizeBarRows sorts, deduplicates, fixes OHLC bounds, and reports gaps", () => {
  const { bars, diagnostics } = normalizeBarRows(
    [
      { time: 120, open: 1.2, high: 1.1, low: 1.3, close: 1.25, volume: 4 },
      { time: 60, open: 1.0, high: 1.05, low: 0.95, close: 1.01, volume: 1 },
      { time: 60, open: 1.0, high: 1.06, low: 0.94, close: 1.02, volume: 2 },
      { time: Number.NaN, open: 1, high: 1, low: 1, close: 1, volume: 0 },
      { time: 240, open: 1.3, high: 1.35, low: 1.28, close: 1.34, volume: 5 },
    ],
    "1",
  );

  assert.equal(bars.length, 3);
  assert.deepEqual(
    bars.map((bar) => bar.time),
    [60, 120, 240],
  );
  assert.equal(bars[0].close, 1.02);
  assert.equal(bars[1].high, 1.3);
  assert.equal(bars[1].low, 1.1);
  assert.deepEqual(diagnostics, {
    input_rows: 5,
    output_rows: 3,
    dropped_invalid_rows: 1,
    duplicate_timestamps: 1,
    non_monotonic_input: 1,
    corrected_ohlc_rows: 1,
    gap_count: 1,
    expected_tf_seconds: 60,
  });
});

test("simulateSignalStrategy uses conservative stop-loss precedence when SL and TP hit in the same bar", () => {
  const bars = [
    { time: 0, open: 100, high: 100.2, low: 99.8, close: 100 },
    { time: 60, open: 100, high: 100.4, low: 99.9, close: 100 },
    { time: 120, open: 100, high: 101.2, low: 99.4, close: 100.6 },
  ];

  const trades = simulateSignalStrategy(bars, {}, (index) => {
    if (index === 1) {
      return {
        buy: true,
        stop_loss_long: 99.5,
        take_profit_long: 101.0,
      };
    }
    return {};
  });

  assert.equal(trades.length, 1);
  assert.equal(trades[0].action, "BUY");
  assert.equal(trades[0].exit_reason, "sl");
  assert.equal(trades[0].exit_price, 99.5);
  assert.equal(trades[0].quantity, 200);
  assert.equal(trades[0].risk_amount, 100);
  assert.equal(trades[0].r_multiple, -1);
  assert.equal(trades[0].pnl_realized, -100);
});

test("simulateSignalStrategy closes an open trade on signal flip and can open the new direction on the same bar", () => {
  const bars = [
    { time: 0, open: 100, high: 100.2, low: 99.8, close: 100 },
    { time: 60, open: 100, high: 100.5, low: 99.9, close: 100.2 },
    { time: 120, open: 100.2, high: 100.4, low: 99.7, close: 99.9 },
    { time: 180, open: 99.9, high: 100.1, low: 99.2, close: 99.4 },
  ];

  const trades = simulateSignalStrategy(bars, {}, (index) => {
    if (index === 1) {
      return { buy: true, stop_loss_long: 99.4, take_profit_long: 101.5 };
    }
    if (index === 2) {
      return { sell: true, stop_loss_short: 100.8, take_profit_short: 99.0 };
    }
    return {};
  });

  assert.equal(trades.length, 2);
  assert.equal(trades[0].action, "BUY");
  assert.equal(trades[0].exit_reason, "signal_flip");
  assert.equal(trades[0].exit_price, 99.9);
  assert.equal(trades[1].action, "SELL");
  assert.equal(trades[1].exit_reason, "end_of_data");
});

test("simulateSignalStrategy can return detailed equity metrics with break-even and partial exits", () => {
  const bars = [
    { time: 0, open: 100, high: 100.2, low: 99.8, close: 100 },
    { time: 60, open: 100, high: 100.2, low: 99.9, close: 100 },
    { time: 120, open: 100, high: 101.1, low: 99.95, close: 100.8 },
    { time: 180, open: 100.8, high: 102.3, low: 100.4, close: 101.9 },
  ];

  const result = backtestService.__test.simulateSignalStrategy(
    bars,
    {},
    (index) => {
      if (index === 1) {
        return {
          buy: true,
          stop_loss_long: 99,
          take_profit_long: 102,
        };
      }
      return {};
    },
    {
      returnDetails: true,
      initialEquity: 10000,
      riskPercent: 1,
      breakEvenAtR: 1,
      partialAtR: 1,
      partialCloseFraction: 0.5,
    },
  );

  assert.equal(result.trades.length, 1);
  assert.equal(result.initial_equity, 10000);
  assert.equal(result.final_equity, 10150);
  assert.equal(result.trades[0].partial_taken, true);
  assert.equal(result.trades[0].break_even_armed, true);
  assert.equal(result.trades[0].closed_fractions.length, 2);
  assert.equal(result.trades[0].r_multiple, 1.5);
  assert.equal(result.trades[0].pnl_realized, 150);
});
