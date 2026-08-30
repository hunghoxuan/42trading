import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const backtestService = require("../src/api/modules/42trade/backtests/backtestService");

const {
  normalizeBarRows,
  simulateSignalStrategy,
  simulateStrategy,
  buildRunStrategyFingerprint,
  buildRunDatasetFingerprint,
  buildRunExecutionFingerprint,
  summarizeStrategyBacktestRecords,
  buildBacktestSummaryIndex,
} = backtestService.__test;

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

test("evaluateRule supports crosses_above and crosses_below shorthand operators", () => {
  const ctx = {
    indicators: { fast: 11, slow: 10, osc: 19 },
    prev_indicators: { fast: 9, slow: 10, osc: 21 },
    bar: { close: 101 },
    prev: { close: 99 },
  };

  assert.equal(
    backtestService.__test.evaluateRule(
      {
        crosses_above: [
          { var: "indicators.fast" },
          { var: "indicators.slow" },
        ],
      },
      ctx,
    ),
    true,
  );

  assert.equal(
    backtestService.__test.evaluateRule(
      {
        crosses_below: [
          { var: "indicators.osc" },
          20,
        ],
      },
      ctx,
    ),
    true,
  );
});

test("evaluateRule supports price-action comparator functions", () => {
  const bullishCtx = {
    indicators: { close_like: 101 },
    prev_indicators: { close_like: 102 },
    bar: { open: 102, high: 103, low: 99, close: 101 },
    prev: { open: 101, high: 104, low: 101, close: 102 },
  };

  assert.equal(
    backtestService.__test.evaluateRule(
      {
        touches: [{ var: "bar.close" }, 100],
      },
      bullishCtx,
    ),
    true,
  );

  assert.equal(
    backtestService.__test.evaluateRule(
      {
        retest: [{ var: "bar.close" }, 100],
      },
      bullishCtx,
    ),
    true,
  );

  assert.equal(
    backtestService.__test.evaluateRule(
      {
        rejected: [{ var: "bar.close" }, 100],
      },
      bullishCtx,
    ),
    true,
  );

  assert.equal(
    backtestService.__test.evaluateRule(
      {
        holds_above: [{ var: "bar.close" }, 100],
      },
      bullishCtx,
    ),
    true,
  );

  const bearishSweepCtx = {
    indicators: {},
    prev_indicators: {},
    bar: { open: 99, high: 101, low: 94, close: 96 },
    prev: { open: 98, high: 99, low: 95, close: 98 },
  };

  assert.equal(
    backtestService.__test.evaluateRule(
      {
        sweeps_above: [{ var: "bar.close" }, 100],
      },
      bearishSweepCtx,
    ),
    true,
  );

  const bullishSweepCtx = {
    indicators: {},
    prev_indicators: {},
    bar: { open: 101, high: 106, low: 98, close: 103 },
    prev: { open: 100, high: 104, low: 99, close: 101 },
  };

  assert.equal(
    backtestService.__test.evaluateRule(
      {
        sweeps_below: [{ var: "bar.close" }, 100],
      },
      bullishSweepCtx,
    ),
    true,
  );

  const bearishHoldCtx = {
    indicators: {},
    prev_indicators: {},
    bar: { open: 96, high: 98, low: 92, close: 95 },
    prev: { open: 98, high: 99, low: 94, close: 97 },
  };

  assert.equal(
    backtestService.__test.evaluateRule(
      {
        holds_below: [{ var: "bar.close" }, 100],
      },
      bearishHoldCtx,
    ),
    true,
  );

  assert.equal(
    backtestService.__test.evaluateRule(
      {
        fn: "rejected",
        args: [{ var: "bar.close" }, 100],
      },
      bullishCtx,
    ),
    true,
  );
});

test("simulateStrategy honors JSON risk management for partials, break-even, and trailing stages", () => {
  const bars = [
    { time: 0, open: 99.5, high: 99.8, low: 99.2, close: 99.4, volume: 10 },
    { time: 60, open: 99.4, high: 100.1, low: 99.3, close: 100.0, volume: 11 },
    { time: 120, open: 100.0, high: 101.6, low: 99.9, close: 101.2, volume: 12 },
    { time: 180, open: 101.2, high: 102.2, low: 100.8, close: 101.7, volume: 13 },
    { time: 240, open: 101.7, high: 101.8, low: 100.9, close: 101.0, volume: 14 },
  ];

  const strategy = {
    key: "test_rule_risk_management",
    kind: "custom",
    engine_version: "42trade.strategy.v1",
    params: {},
    indicators: [],
    rules: {
      entry_long: { "==": [{ var: "bar.time" }, 60] },
      entry_short: false,
      stop_loss_long: { "-": [{ var: "bar.close" }, 1] },
      take_profit_long: { "+": [{ var: "bar.close" }, 4] },
    },
    risk: {
      risk_percent: 1,
      break_even_at_r: 1,
      partial_at_r: 1,
      partial_close_fraction: 0.5,
      trail_stages: [
        { trigger_r: 1.5, stop_to_r: 0.5 },
        { trigger_r: 2, stop_to_r: 1 },
      ],
    },
  };

  const trades = simulateStrategy(bars, strategy);

  assert.equal(trades.length, 1);
  assert.equal(trades[0].action, "BUY");
  assert.equal(trades[0].partial_taken, true);
  assert.equal(trades[0].break_even_armed, true);
  assert.equal(trades[0].exit_reason, "sl_after_be_or_trail");
  assert.equal(trades[0].trailing_stop_updates.length, 2);
  assert.equal(trades[0].trailing_stop_updates[0].new_sl, 100.5);
  assert.equal(trades[0].trailing_stop_updates[1].new_sl, 101);
  assert.equal(trades[0].closed_fractions.length, 2);
});

test("simulateStrategy logs triggered events and supports non-trade actions in v2 events[]", () => {
  const bars = [
    { time: 0, open: 100, high: 100.1, low: 99.9, close: 100, volume: 10 },
    { time: 60, open: 100, high: 101.3, low: 99.8, close: 101, volume: 11 },
    { time: 120, open: 101, high: 101.4, low: 100.4, close: 100.8, volume: 12 },
  ];

  const strategy = {
    key: "test_events_v2",
    kind: "custom",
    engine_version: "42trade.strategy.v2",
    params: {},
    indicators: [],
    events: [
      {
        id: "long_breakout",
        name: "Long Breakout",
        when: { "==": [{ var: "bar.time" }, 60] },
        actions: [
          { id: "open_long", type: "trade.open.long" },
          { id: "toast_long", type: "notify.toast", message: "Breakout fired" },
        ],
      },
    ],
    rules: {
      stop_loss_long: { "-": [{ var: "bar.close" }, 1] },
      take_profit_long: { "+": [{ var: "bar.close" }, 2] },
    },
    risk: {
      risk_percent: 1,
    },
  };

  const result = simulateStrategy(bars, strategy, { returnDetails: true });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].action, "BUY");
  assert.equal(Array.isArray(result.event_log), true);
  assert.equal(result.event_log.length, 2);
  assert.equal(Array.isArray(result.strategy_signals), true);
  assert.equal(result.strategy_signals.length, 1);
  assert.equal(result.strategy_signals[0].source_event_id, "long_breakout");
  assert.equal(result.event_log[0].strategy_signal_event_id, "long_breakout");
  assert.equal(result.event_log[0].strategy_signal_id, result.strategy_signals[0].id);
  assert.equal(result.event_log[0].rule_event?.rule_id, "long_breakout");
  assert.deepEqual(
    result.event_log.map((entry) => entry.action_id),
    result.strategy_signals[0].actions.map((action) => action.id),
  );
  assert.deepEqual(
    result.event_log.map((entry) => entry.event_id),
    ["long_breakout", "long_breakout"],
  );
  assert.deepEqual(
    result.event_log.map((entry) => entry.action_type),
    ["trade", "notify.toast"],
  );
  assert.equal(result.event_log[0].trade_plan?.direction, "buy");
  assert.equal(result.event_log[1].message, "Breakout fired");
});

test("simulateStrategy executes shared trade.close.long actions as rule exits", () => {
  const bars = [
    { time: 0, open: 100, high: 100.2, low: 99.8, close: 100, volume: 10 },
    { time: 60, open: 100, high: 101.2, low: 99.9, close: 101, volume: 11 },
    { time: 120, open: 101, high: 101.1, low: 100.4, close: 100.5, volume: 12 },
    { time: 180, open: 100.5, high: 100.8, low: 100.2, close: 100.7, volume: 13 },
  ];
  const strategy = {
    key: "shared_dynamic_exit",
    engine_version: "42trade.strategy.v2",
    indicators: [],
    events: [
      {
        id: "enter",
        name: "Enter",
        when: { "==": [{ var: "bar.time" }, 60] },
        actions: [{ id: "open", action: "trade.open.long" }],
      },
      {
        id: "leave",
        name: "Leave",
        when: { "==": [{ var: "bar.time" }, 120] },
        actions: [{ id: "close", action: "trade.close.long" }],
      },
    ],
    rules: {
      stop_loss_long: { "-": [{ var: "bar.close" }, 10] },
      take_profit_long: { "+": [{ var: "bar.close" }, 10] },
    },
  };

  const result = simulateStrategy(bars, strategy, { returnDetails: true });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].action, "BUY");
  assert.equal(result.trades[0].exit_reason, "rule_exit");
  assert.equal(result.trades[0].exit_time_unix, 120);
  assert.equal(result.event_log.find((entry) => entry.action_id === "close")?.action_type, "trade.close.long");
});

test("all built-in preset strategies are rule-based and executable through the generic simulator", async () => {
  const bars = [];
  for (let index = 0; index < 320; index += 1) {
    const base = 100 + Math.sin(index / 7) * 6 + Math.cos(index / 19) * 3 + index * 0.08;
    const open = base + Math.sin(index / 5) * 0.4;
    const close = base + Math.cos(index / 6) * 0.5;
    const high = Math.max(open, close) + 0.9 + (index % 4) * 0.1;
    const low = Math.min(open, close) - 0.9 - (index % 3) * 0.1;
    bars.push({
      time: index * 60,
      open,
      high,
      low,
      close,
      volume: 100 + index,
    });
  }

  for (const strategy of await backtestService.listStrategies()) {
    assert.equal(strategy.engine_version, "42trade.strategy.v2", `${strategy.key} should declare engine version`);
    assert.ok(Array.isArray(strategy.events), `${strategy.key} should define events`);
    assert.ok(Array.isArray(strategy.indicators), `${strategy.key} should define indicators`);
    assert.ok(strategy.rules && typeof strategy.rules === "object", `${strategy.key} should define rules`);
    const trades = simulateStrategy(bars, strategy);
    assert.ok(Array.isArray(trades), `${strategy.key} should simulate without throwing`);
  }
});

test("strategy backtest summary dedupes reruns of the same strategy version on the same dataset", () => {
  const baseRun = {
    strategy_key: "ema_cross_v1",
    strategy_id: null,
    strategy_name: "EMA Cross v1",
    strategy_snapshot: {
      engine_version: "42trade.strategy.v2",
      params: { fast_period: 9, slow_period: 21 },
      indicators: [{ id: "ema_fast", type: "ema", length: 9 }],
      events: [{ id: "entry_long", actions: [{ id: "open_long", action: "trade" }] }],
      rules: { bullish: { and: [] } },
      risk: { rr_target: 2 },
    },
    symbol: "AUDCAD",
    tf: "240",
    direction: "all",
    session: "Any",
    execution_options: { signal_source: "rules" },
    broker_calibration: { pip_size: 0.0001 },
  };
  const summaryA = {
    total_trades: 10,
    win_rate_pct: 50,
    total_pnl: 100,
    bars_analyzed: 2000,
    first_bar_at: "2026-01-01T00:00:00.000Z",
    last_bar_at: "2026-02-01T00:00:00.000Z",
  };
  const summaryB = {
    ...summaryA,
    total_pnl: 150,
    win_rate_pct: 60,
  };
  const summaryC = {
    ...summaryA,
    total_trades: 8,
    win_rate_pct: 25,
    total_pnl: -40,
    first_bar_at: "2026-03-01T00:00:00.000Z",
    last_bar_at: "2026-04-01T00:00:00.000Z",
  };

  const records = [
    {
      run: {
        ...baseRun,
        run_id: "bt-1",
        started_at: "2026-06-01T09:00:00.000Z",
        completed_at: "2026-06-01T09:05:00.000Z",
        updated_at: "2026-06-01T09:05:00.000Z",
      },
      summary: summaryA,
    },
    {
      run: {
        ...baseRun,
        run_id: "bt-2",
        started_at: "2026-06-02T09:00:00.000Z",
        completed_at: "2026-06-02T09:05:00.000Z",
        updated_at: "2026-06-02T09:05:00.000Z",
      },
      summary: summaryB,
    },
    {
      run: {
        ...baseRun,
        run_id: "bt-3",
        started_at: "2026-06-03T09:00:00.000Z",
        completed_at: "2026-06-03T09:05:00.000Z",
        updated_at: "2026-06-03T09:05:00.000Z",
      },
      summary: summaryC,
    },
  ];

  assert.equal(buildRunStrategyFingerprint(records[0].run), buildRunStrategyFingerprint(records[1].run));
  assert.equal(buildRunDatasetFingerprint(records[0].run, records[0].summary), buildRunDatasetFingerprint(records[1].run, records[1].summary));
  assert.equal(buildRunExecutionFingerprint(records[0].run), buildRunExecutionFingerprint(records[1].run));

  const summary = summarizeStrategyBacktestRecords(records);
  assert.ok(summary);
  assert.equal(summary.raw_runs, 3);
  assert.equal(summary.unique_runs, 2);
  assert.equal(summary.duplicate_runs, 1);
  assert.equal(summary.total_pnl, 110);
  assert.equal(summary.total_trades, 18);
  assert.equal(summary.avg_win_rate_pct, 42.5);
  assert.equal(summary.weighted_win_rate_pct, 44.44);
  assert.equal(summary.last_run_id, "bt-3");
  assert.equal(summary.earliest_data_start_at, "2026-01-01T00:00:00.000Z");
  assert.equal(summary.latest_data_end_at, "2026-04-01T00:00:00.000Z");
});

test("strategy backtest summary separates different strategy versions on the same dataset", () => {
  const records = [
    {
      run: {
        run_id: "bt-a",
        strategy_key: "custom_alpha",
        strategy_snapshot: {
          engine_version: "42trade.strategy.v2",
          params: { fast_period: 9 },
          indicators: [],
          events: [],
          rules: { bullish: { and: [] } },
          risk: { rr_target: 2 },
        },
        symbol: "AUDCAD",
        tf: "15",
        direction: "all",
        session: "Any",
        started_at: "2026-06-01T09:00:00.000Z",
        completed_at: "2026-06-01T09:05:00.000Z",
      },
      summary: {
        total_trades: 5,
        win_rate_pct: 40,
        total_pnl: 50,
        bars_analyzed: 500,
        first_bar_at: "2026-01-01T00:00:00.000Z",
        last_bar_at: "2026-01-05T00:00:00.000Z",
      },
    },
    {
      run: {
        run_id: "bt-b",
        strategy_key: "custom_alpha",
        strategy_snapshot: {
          engine_version: "42trade.strategy.v2",
          params: { fast_period: 12 },
          indicators: [],
          events: [],
          rules: { bullish: { and: [{ "==": [1, 1] }] } },
          risk: { rr_target: 3 },
        },
        symbol: "AUDCAD",
        tf: "15",
        direction: "all",
        session: "Any",
        started_at: "2026-06-02T09:00:00.000Z",
        completed_at: "2026-06-02T09:05:00.000Z",
      },
      summary: {
        total_trades: 7,
        win_rate_pct: 57.14,
        total_pnl: 80,
        bars_analyzed: 500,
        first_bar_at: "2026-01-01T00:00:00.000Z",
        last_bar_at: "2026-01-05T00:00:00.000Z",
      },
    },
  ];

  assert.notEqual(buildRunStrategyFingerprint(records[0].run), buildRunStrategyFingerprint(records[1].run));

  const summaryIndex = buildBacktestSummaryIndex(records);
  const summary = summaryIndex.get("custom_alpha");
  assert.ok(summary);
  assert.equal(summary.raw_runs, 2);
  assert.equal(summary.unique_runs, 2);
  assert.equal(summary.total_pnl, 130);
});
