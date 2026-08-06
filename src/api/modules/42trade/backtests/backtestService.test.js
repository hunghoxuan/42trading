"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const backtestService = require("./backtestService");
const chartStrategyChecks = require("../../../../shared/utils/chartStrategyChecks.cjs");
const sharedArtifactDetection = require("../../../../shared/rules-engine/features/detectArtifacts.cjs");
const realtimeAnalysis = require("../../../../shared/rules-engine/features/realtimeAnalysis.cjs");

function makeStructureBars() {
  return [
    { time: 60, open: 100, high: 101, low: 99, close: 100, volume: 10 },
    { time: 120, open: 100, high: 102, low: 98, close: 101, volume: 10 },
    { time: 180, open: 101, high: 106, low: 100, close: 105, volume: 10 },
    { time: 240, open: 105, high: 105.5, low: 101, close: 102, volume: 10 },
    { time: 300, open: 102, high: 103, low: 97, close: 98, volume: 10 },
    { time: 360, open: 98, high: 99, low: 94, close: 95, volume: 10 },
    { time: 420, open: 95, high: 100, low: 94.5, close: 99, volume: 10 },
    { time: 480, open: 99, high: 106.5, low: 98, close: 101, volume: 10 },
    { time: 540, open: 101, high: 108, low: 100, close: 107, volume: 10 },
    { time: 600, open: 107, high: 107.5, low: 95.5, close: 96, volume: 10 },
    { time: 660, open: 96, high: 97, low: 92, close: 93, volume: 10 },
  ];
}

function makeBaseBars() {
  return [
    { time: 180, open: 99.5, high: 100.2, low: 99.1, close: 99.8, volume: 10 },
    { time: 360, open: 99.8, high: 100.1, low: 99.2, close: 99.4, volume: 10 },
    { time: 540, open: 99.4, high: 100.5, low: 99.2, close: 100.1, volume: 10 },
    { time: 660, open: 100.1, high: 100.4, low: 99.6, close: 99.9, volume: 10 },
  ];
}

test("evaluateRule supports multi-timeframe BOS lookups", () => {
  const h1Bars = makeStructureBars();
  const baseBars = makeBaseBars();
  const multiTfData = {
    "1h": {
      bars: h1Bars,
      derivedArtifacts: sharedArtifactDetection.buildDerivedItemsFromBars(h1Bars, "1h"),
    },
  };
  const ctx = {
    bars: baseBars,
    index: baseBars.length - 1,
    bar: baseBars[baseBars.length - 1],
    prev: baseBars[baseBars.length - 2],
    tf: "15m",
    strategy: {},
    params: {},
    risk: {},
    indicators: {},
    prev_indicators: {},
    derivedArtifacts: sharedArtifactDetection.buildDerivedItemsFromBars(baseBars, "15m"),
    multiTf: multiTfData,
  };
  const result = backtestService.__test.evaluateRule(
    { fn: "bos", args: ["bullish", "1h"] },
    ctx,
  );

  assert.equal(Boolean(result), true);
  assert.equal(Array.isArray(result.matches), true);
  assert.equal(result.matches.some((item) => item?.type === "bos"), true);
  assert.equal(String(result.timeframe || "").toLowerCase(), "1h");
});

test("simulateStrategy preserves detector-style events with draw actions in the event log", () => {
  const strategy = {
    id: "price_action_event_detector_v1",
    name: "Price Action Event Detector v1",
    engine_version: "42trade.strategy.v2",
    indicators: [],
    events: [
      {
        id: "bos_event",
        name: "BOS",
        when: { fn: "bos", args: ["bullish"] },
        actions: [{ id: "bos_draw", action: "draw", message: "BOS detected." }],
      },
    ],
  };

  const result = backtestService.__test.simulateStrategy(
    makeStructureBars(),
    strategy,
    {
      tf: "15m",
      symbol: "EURUSD",
      returnDetails: true,
    },
  );

  assert.equal(Array.isArray(result?.event_log), true);
  assert.equal(result.event_log.length > 0, true);
  assert.equal(result.event_log.some((entry) => entry?.action_type === "draw"), true);
  assert.equal(result.event_log.some((entry) => entry?.event_id === "bos_event"), true);
});

test("simulateStrategy uses the same trade plan core as chart strategy scan", () => {
  const bars = makeStructureBars();
  const strategy = {
    id: "bos_trade_strategy",
    name: "BOS Trade Strategy",
    engine_version: "42trade.strategy.v2",
    indicators: [],
    events: [
      {
        id: "bos_trade",
        name: "BOS Trade",
        when: { fn: "bos", args: ["bullish"] },
        actions: [{ id: "bos_trade_action", action: "trade", trade_plan: { direction: "buy" } }],
      },
    ],
  };

  const chartEvaluation = chartStrategyChecks.evaluateChartStrategies({
    bars,
    strategies: [strategy],
    lookbackBars: bars.length,
    symbol: "EURUSD",
    tf: "1h",
    multiTfBars: { "1h": bars },
    scanMode: "backtest",
  });
  const chartPlan = Array.isArray(chartEvaluation?.tradePlans)
    ? chartEvaluation.tradePlans[0]
    : null;
  assert.ok(chartPlan, "chart evaluation should emit a trade plan");

  const result = backtestService.__test.simulateStrategy(bars, strategy, {
    tf: "1h",
    symbol: "EURUSD",
    returnDetails: true,
  });
  const backtestPlan = Array.isArray(result?.event_log)
    ? result.event_log.find((entry) => entry?.action_type === "trade")?.trade_plan || null
    : null;

  assert.ok(backtestPlan, "backtest simulation should emit a trade plan");
  assert.equal(String(backtestPlan.direction || "").toLowerCase(), String(chartPlan.direction || "").toLowerCase());
  assert.equal(Number(backtestPlan.entry), Number(chartPlan.entry));
  assert.equal(Number(backtestPlan.sl), Number(chartPlan.sl));
  assert.equal(Number(backtestPlan.tp), Number(chartPlan.tp));
});

test("simulateStrategy rejects trades that violate market metadata min stop pips", () => {
  const bars = [
    { time: 60, open: 1.1, high: 1.101, low: 1.099, close: 1.1, volume: 10 },
    { time: 120, open: 1.1, high: 1.101, low: 1.099, close: 1.1, volume: 10 },
    { time: 180, open: 1.1, high: 1.103, low: 1.099, close: 1.102, volume: 10 },
  ];
  const strategy = {
    id: "min_stop_test",
    name: "Min Stop Test",
    engine_version: "42trade.strategy.v2",
    indicators: [],
    events: [
      {
        id: "buy_once",
        name: "Buy Once",
        when: { "==": [{ var: "bar.time" }, 120] },
        actions: [
          {
            id: "buy",
            action: "trade",
            trade_plan: {
              direction: "buy",
              type: "market",
              entry: "bar.close",
              sl: 1.0995,
              tp: 1.103,
            },
          },
        ],
      },
    ],
  };

  const result = backtestService.__test.simulateStrategy(bars, strategy, {
    tf: "1m",
    symbol: "EURUSD",
    returnDetails: true,
    marketMetadata: {
      symbol: "EURUSD",
      pip_size: 0.0001,
      min_stop_pips: 15,
      spread_pips: 0,
    },
  });

  assert.equal(result.trades.length, 0);
  assert.equal(result.execution_options.min_stop_pips, 15);
});

test("simulateStrategy ports ThreeCandlesV1 continue mode with cTrader-style stop and target", async () => {
  const strategy = (await backtestService.listStrategies()).find(
    (item) => item?.key === "three_candles_v1",
  );
  assert.ok(strategy, "three_candles_v1 preset should load");

  const bars = [
    { time: 60, open: 1.099, high: 1.1002, low: 1.0988, close: 1.1, volume: 10 },
    { time: 120, open: 1.1, high: 1.1012, low: 1.0998, close: 1.101, volume: 10 },
    { time: 180, open: 1.101, high: 1.1022, low: 1.1006, close: 1.102, volume: 10 },
    { time: 240, open: 1.102, high: 1.1035, low: 1.1014, close: 1.1032, volume: 10 }
  ];

  const result = backtestService.__test.simulateStrategy(bars, strategy, {
    tf: "1m",
    symbol: "EURUSD",
    returnDetails: true,
    marketMetadata: {
      symbol: "EURUSD",
      pip_size: 0.0001,
      spread_pips: 0
    }
  });

  const trade = result.trades[0];
  assert.ok(trade, "strategy should open a trade after three bullish candles");
  assert.equal(String(trade.action || "").toUpperCase(), "BUY");
  assert.equal(Number(trade.entry), 1.102);
  assert.equal(Number(trade.sl), 1.0998);
  assert.equal(Number(trade.tp), 1.1042);
});

test("simulateStrategy ports ThreeCandlesV1 reverse mode", async () => {
  const base = (await backtestService.listStrategies()).find(
    (item) => item?.key === "three_candles_v1",
  );
  assert.ok(base, "three_candles_v1 preset should load");
  const strategy = {
    ...base,
    params: {
      ...(base.params || {}),
      direction_mode: "reverse"
    }
  };

  const bars = [
    { time: 60, open: 1.105, high: 1.1052, low: 1.1039, close: 1.104, volume: 10 },
    { time: 120, open: 1.104, high: 1.1041, low: 1.1029, close: 1.103, volume: 10 },
    { time: 180, open: 1.103, high: 1.1032, low: 1.1018, close: 1.102, volume: 10 },
    { time: 240, open: 1.102, high: 1.1024, low: 1.1005, close: 1.1012, volume: 10 }
  ];

  const result = backtestService.__test.simulateStrategy(bars, strategy, {
    tf: "1m",
    symbol: "EURUSD",
    returnDetails: true,
    marketMetadata: {
      symbol: "EURUSD",
      pip_size: 0.0001,
      spread_pips: 0
    }
  });

  const trade = result.trades[0];
  assert.ok(trade, "reverse mode should buy after three bearish candles");
  assert.equal(String(trade.action || "").toUpperCase(), "BUY");
  assert.equal(Number(trade.entry), 1.102);
  assert.equal(Number(trade.sl), 1.1018);
  assert.equal(Number(trade.tp), 1.1022);
});

test("simulateStrategy fills limit orders only after price touches the limit", () => {
  const bars = [
    { time: 60, open: 100, high: 100.5, low: 99.8, close: 100, volume: 10 },
    { time: 120, open: 100, high: 100.5, low: 99.5, close: 100.2, volume: 10 },
    { time: 180, open: 100.2, high: 100.3, low: 98.8, close: 99.2, volume: 10 },
    { time: 240, open: 99.2, high: 101.5, low: 99, close: 101.2, volume: 10 },
  ];
  const strategy = {
    id: "limit_fill_test",
    name: "Limit Fill Test",
    engine_version: "42trade.strategy.v2",
    indicators: [],
    events: [
      {
        id: "buy_limit_once",
        name: "Buy Limit Once",
        when: { "==": [{ var: "bar.time" }, 120] },
        actions: [
          {
            id: "buy_limit",
            action: "trade",
            trade_plan: {
              direction: "buy",
              type: "limit",
              entry: 99,
              sl: 98,
              tp: 101,
            },
          },
        ],
      },
    ],
  };

  const result = backtestService.__test.simulateStrategy(bars, strategy, {
    tf: "1m",
    symbol: "BTCUSD",
    returnDetails: true,
    marketMetadata: {
      symbol: "BTCUSD",
      pip_size: 1,
      spread_pips: 0,
    },
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].order_type, "limit");
  assert.equal(result.trades[0].entry_time_unix, 180);
  assert.equal(result.trades[0].exit_reason, "tp");
});

test("simulateStrategy does not fill or settle limit orders on the signal bar", () => {
  const bars = [
    { time: 60, open: 100, high: 100.2, low: 99.8, close: 100, volume: 10 },
    { time: 120, open: 100, high: 101.2, low: 98.8, close: 101, volume: 10 },
    { time: 180, open: 101, high: 100.4, low: 98.9, close: 99.4, volume: 10 },
    { time: 240, open: 99.4, high: 101.4, low: 99.2, close: 101.1, volume: 10 },
  ];
  const strategy = {
    id: "limit_no_signal_bar_fill_test",
    name: "Limit No Signal Bar Fill Test",
    engine_version: "42trade.strategy.v2",
    indicators: [],
    events: [
      {
        id: "buy_limit_once",
        name: "Buy Limit Once",
        when: { "==": [{ var: "bar.time" }, 120] },
        actions: [
          {
            id: "buy_limit",
            action: "trade",
            trade_plan: {
              direction: "buy",
              type: "limit",
              entry: 99,
              sl: 98,
              tp: 101,
            },
          },
        ],
      },
    ],
  };

  const result = backtestService.__test.simulateStrategy(bars, strategy, {
    tf: "1m",
    symbol: "BTCUSD",
    returnDetails: true,
    marketMetadata: {
      symbol: "BTCUSD",
      pip_size: 1,
      spread_pips: 0,
    },
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].order_type, "limit");
  assert.equal(result.trades[0].signal_bar_time, "1970-01-01T00:02:00.000Z");
  assert.equal(result.trades[0].entry_time_unix, 180);
  assert.equal(result.trades[0].exit_time_unix, 240);
  assert.equal(result.trades[0].exit_reason, "tp");
});

test("realtime analysis derives phase and artifact buckets from timeframe bars", () => {
  const analysis = realtimeAnalysis.buildTfAnalysis({
    bars: makeStructureBars(),
    timeframe: "1h",
  });

  assert.equal(analysis.bias, "bearish");
  assert.equal(analysis.trend, "down");
  assert.equal(analysis.phase, "reversal");
  assert.equal(analysis.structure_state, "choch");
  assert.equal(Array.isArray(analysis.order_blocks), true);
  assert.equal(Array.isArray(analysis.fvgs), true);
  assert.equal(Array.isArray(analysis.structure), true);
});

test("evaluateRule supports phase lookups on the current timeframe", () => {
  const bars = makeStructureBars();
  const ctx = {
    bars,
    index: bars.length - 1,
    bar: bars[bars.length - 1],
    prev: bars[bars.length - 2],
    tf: "1h",
    strategy: {},
    params: {},
    risk: {},
    indicators: {},
    prev_indicators: {},
    derivedArtifacts: sharedArtifactDetection.buildDerivedItemsFromBars(bars, "1h"),
    multiTf: {},
  };
  const result = backtestService.__test.evaluateRule(
    { fn: "phase", args: ["reversal"] },
    ctx,
  );

  assert.equal(Boolean(result), true);
  assert.equal(String(result?.meta?.phase || ""), "reversal");
  assert.equal(String(result?.meta?.trend || ""), "down");
  assert.equal(String(result?.matches?.[0]?.payload?.structure_state || ""), "choch");
});

test("runBacktest reports loaded vs required bars when the dataset is too short", async () => {
  await assert.rejects(
    () =>
      backtestService.runBacktest("default", {
        symbol: "BTCUSD",
        tf: "1",
        limit: 30,
        strategy: "golden_cross_v1",
        persist: false,
      }),
    /loaded 100, required 240/i,
  );
});
