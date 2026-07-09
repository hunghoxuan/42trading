import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChartStrategyHitMessage,
  evaluateChartStrategies,
  groupArtifactsBySourceTf,
} from "../../shared/utils/chartStrategyChecks.js";
import {
  limitArtifactsNearLastBarByType,
  shouldLimitArtifactType,
  buildDerivedItemsFromBars,
} from "../../modules/42trade/chartArtifacts/detectArtifacts.js";

function makeBars(closes = []) {
  const startSec = 1_717_200_000;
  return closes.map((close, index) => ({
    time: startSec + index * 60,
    open: close,
    high: close + 0.2,
    low: close - 0.2,
    close,
    volume: 10 + index,
  }));
}

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

function makePatternBars() {
  return [
    { time: 60, open: 10, high: 11, low: 9.8, close: 10.5, volume: 10 },
    { time: 120, open: 10.4, high: 10.5, low: 9.0, close: 10.45, volume: 10 },
    { time: 180, open: 10.45, high: 10.6, low: 10.2, close: 10.3, volume: 10 },
  ];
}

test("evaluateChartStrategies returns the latest matching event inside the lookback window", () => {
  const strategy = {
    id: "ema_cross",
    name: "EMA Cross",
    engine_version: "42trade.strategy.v2",
    indicators: [
      { id: "ema_fast", type: "ema", length: 2, source: "close" },
      { id: "ema_slow", type: "ema", length: 4, source: "close" },
    ],
    events: [
      {
        id: "entry_long",
        name: "Entry Long",
        when: {
          crosses_above: [
            { var: "indicators.ema_fast" },
            { var: "indicators.ema_slow" },
          ],
        },
        actions: [{ id: "notify", type: "notify.notification" }],
      },
    ],
  };

  const result = evaluateChartStrategies({
    bars: makeBars([10, 9, 8, 9, 11, 13, 14]),
    strategies: [strategy],
    lookbackBars: 5,
    symbol: "EURUSD",
    tf: "1m",
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].strategyId, "ema_cross");
  assert.equal(result.matches[0].eventId, "entry_long");
  assert.equal(result.matches[0].displayText, "EMA Cross · Entry Long");
});

test("evaluateChartStrategies drops matches that only occurred before the lookback window", () => {
  const strategy = {
    id: "price_break",
    name: "Price Break",
    engine_version: "42trade.strategy.v2",
    indicators: [],
    events: [
      {
        id: "break_above",
        name: "Break Above",
        when: {
          ">": [{ var: "bar.close" }, 10],
        },
        actions: [{ id: "notify", type: "notify.notification" }],
      },
    ],
  };

  const result = evaluateChartStrategies({
    bars: makeBars([9, 11, 9, 9, 9, 9]),
    strategies: [strategy],
    lookbackBars: 2,
    symbol: "EURUSD",
    tf: "1m",
  });

  assert.equal(result.matches.length, 0);
});

test("buildChartStrategyHitMessage formats the chart label consistently", () => {
  assert.equal(
    buildChartStrategyHitMessage({
      strategyName: "Momentum",
      eventName: "RSI Recovery",
    }),
    "Momentum · RSI Recovery",
  );
});

test("evaluateChartStrategies only applies a strategy to its own timeframe when market.tf is set", () => {
  const strategy = {
    id: "ema_cross",
    name: "EMA Cross",
    engine_version: "42trade.strategy.v2",
    market: {
      tf: "15m",
    },
    indicators: [
      { id: "ema_fast", type: "ema", length: 2, source: "close" },
      { id: "ema_slow", type: "ema", length: 4, source: "close" },
    ],
    events: [
      {
        id: "entry_long",
        name: "Entry Long",
        when: {
          crosses_above: [
            { var: "indicators.ema_fast" },
            { var: "indicators.ema_slow" },
          ],
        },
        actions: [{ id: "notify", type: "notify.notification" }],
      },
    ],
  };

  const bars = makeBars([10, 9, 8, 9, 11, 13, 14]);
  assert.equal(
    evaluateChartStrategies({
      bars,
      strategies: [strategy],
      lookbackBars: 5,
      symbol: "EURUSD",
      tf: "5m",
    }).matches.length,
    0,
  );

  assert.equal(
    evaluateChartStrategies({
      bars,
      strategies: [strategy],
      lookbackBars: 5,
      symbol: "EURUSD",
      tf: "15m",
    }).matches.length,
    1,
  );
});

test("evaluateChartStrategies derives directional marker metadata for long entries", () => {
  const strategy = {
    id: "ema_cross",
    name: "EMA Cross",
    engine_version: "42trade.strategy.v2",
    indicators: [
      { id: "ema_fast", type: "ema", length: 2, source: "close" },
      { id: "ema_slow", type: "ema", length: 4, source: "close" },
    ],
    events: [
      {
        id: "entry_long",
        name: "Entry Long",
        when: {
          crosses_above: [
            { var: "indicators.ema_fast" },
            { var: "indicators.ema_slow" },
          ],
        },
        actions: [{ id: "open_long", type: "trade.open.long" }],
      },
    ],
  };

  const result = evaluateChartStrategies({
    bars: makeBars([10, 9, 8, 9, 11, 13, 14]),
    strategies: [strategy],
    lookbackBars: 5,
    symbol: "EURUSD",
    tf: "1m",
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].markerDirection, "up");
  assert.equal(result.matches[0].markerShape, "arrowUp");
  assert.equal(result.matches[0].markerPosition, "belowBar");
  assert.equal(result.matches[0].markerText, "EMA Cross");
});

test("evaluateChartStrategies supports structure artifact functions and exposes latest artifact metadata", () => {
  const strategy = {
    id: "structure_long",
    name: "Structure Long",
    engine_version: "42trade.strategy.v2",
    events: [
      {
        id: "bos_long",
        name: "Bullish BOS",
        when: {
          and: [
            { fn: "bos", args: ["bullish"] },
            { fn: "bias", args: ["bullish"] },
          ],
        },
        actions: [{ id: "open_long", type: "trade.open.long" }],
      },
    ],
  };

  const result = evaluateChartStrategies({
    bars: makeStructureBars(),
    strategies: [strategy],
    lookbackBars: 6,
    symbol: "EURUSD",
    tf: "15m",
  });

  assert.equal(result.matches.length > 0, true);
  const latest = result.latestMatches[result.latestMatches.length - 1];
  assert.equal(Array.isArray(latest.artifacts), true);
  assert.equal(
    result.matches.some(
      (entry) =>
        Array.isArray(entry.artifacts) &&
        entry.artifacts.some((item) => item?.type === "bos"),
    ),
    true,
  );
  assert.equal(String(latest.latestArtifact?.subtype || "").toLowerCase(), "bullish");
});

test("evaluateChartStrategies supports breakout and reversal event functions with default current timeframe behavior", () => {
  const strategy = {
    id: "level_reversal",
    name: "Level Reversal",
    engine_version: "42trade.strategy.v2",
    events: [
      {
        id: "break_then_reverse",
        name: "Break And Reverse",
        when: {
          and: [
            { fn: "breakout", args: [100] },
            { fn: "reversal", args: [100] },
          ],
        },
        actions: [{ id: "notify", type: "notify.notification" }],
      },
    ],
  };

  const bars = [
    { time: 60, open: 99, high: 100, low: 98, close: 99, volume: 10 },
    { time: 120, open: 99, high: 103, low: 98.5, close: 102, volume: 10 },
    { time: 180, open: 102, high: 103, low: 99.2, close: 99.4, volume: 10 },
    { time: 240, open: 99.4, high: 100.5, low: 98.8, close: 100.2, volume: 10 },
  ];

  const result = evaluateChartStrategies({
    bars,
    strategies: [strategy],
    lookbackBars: 4,
    symbol: "EURUSD",
    tf: "5m",
  });

  assert.equal(result.matches.length > 0, true);
  assert.equal(
    result.matches.some((entry) =>
      Array.isArray(entry.artifacts) &&
      entry.artifacts.some((item) => ["breakout", "reversal"].includes(item?.type)),
    ),
    true,
  );
});

test("evaluateChartStrategies supports candle-pattern predicate functions", () => {
  const strategy = {
    id: "pattern_detector",
    name: "Pattern Detector",
    engine_version: "42trade.strategy.v2",
    metadata: {
      preview_current_bar_only: true,
    },
    events: [
      {
        id: "pin_bar_event",
        name: "Pin Bar",
        when: { fn: "pin_bar", args: ["", ""] },
        actions: [{ id: "pin_bar_draw", action: "draw" }],
      },
      {
        id: "engulfing_event",
        name: "Engulfing",
        when: { fn: "engulfing", args: ["", ""] },
        actions: [{ id: "engulfing_draw", action: "draw" }],
      },
    ],
  };

  const result = evaluateChartStrategies({
    bars: makePatternBars(),
    strategies: [strategy],
    lookbackBars: 3,
    symbol: "EURUSD",
    tf: "1m",
  });

  assert.equal(result.matches.length >= 2, true);
  assert.equal(
    result.matches.some((entry) =>
      Array.isArray(entry.artifacts) &&
      entry.artifacts.some((item) => item?.type === "bullish_pin_bar"),
    ),
    true,
  );
  assert.equal(
    result.matches.some((entry) =>
      Array.isArray(entry.artifacts) &&
      entry.artifacts.some((item) => item?.type === "bearish_engulfing"),
    ),
    true,
  );
});

test("evaluateChartStrategies supports THEN for ordered event chains", () => {
  const strategy = {
    id: "ordered_chain",
    name: "Ordered Chain",
    engine_version: "42trade.strategy.v2",
    events: [
      {
        id: "ordered_event",
        name: "Break Then Reverse",
        when: {
          then: [
            { fn: "breakout", args: [100] },
            { fn: "reversal", args: [100] },
          ],
        },
        actions: [{ id: "notify", type: "notify.notification" }],
      },
    ],
  };

  const bars = [
    { time: 60, open: 99, high: 100, low: 98, close: 99, volume: 10 },
    { time: 120, open: 99, high: 103, low: 98.5, close: 102, volume: 10 },
    { time: 180, open: 102, high: 103, low: 99.2, close: 99.4, volume: 10 },
    { time: 240, open: 99.4, high: 100.5, low: 98.8, close: 100.2, volume: 10 },
  ];

  const result = evaluateChartStrategies({
    bars,
    strategies: [strategy],
    lookbackBars: 4,
    symbol: "EURUSD",
    tf: "5m",
  });

  assert.equal(result.matches.length > 0, true);
  assert.equal(
    result.matches.filter((entry) => Array.isArray(entry.artifacts) && entry.artifacts.length >= 1).length >= 2,
    true,
  );
});

test("evaluateChartStrategies derives marker direction from artifact bias for detector events", () => {
  const strategy = {
    id: "detector",
    name: "Detector",
    engine_version: "42trade.strategy.v2",
    events: [
      {
        id: "bos_event",
        name: "BOS",
        when: { fn: "bos", args: ["bullish"] },
        actions: [{ id: "bos_draw", action: "draw" }],
      },
    ],
  };

  const result = evaluateChartStrategies({
    bars: makeStructureBars(),
    strategies: [strategy],
    lookbackBars: 6,
    symbol: "EURUSD",
    tf: "15m",
  });

  assert.equal(result.matches.length > 0, true);
  const latest = result.matches[result.matches.length - 1];
  assert.equal(latest.markerDirection, "up");
  assert.equal(latest.markerShape, "arrowUp");
  assert.equal(latest.markerPosition, "belowBar");
});

test("evaluateChartStrategies can infer recent structure levels for rejected() without an explicit level", () => {
  const strategy = {
    id: "rejection_detector",
    name: "Rejection Detector",
    engine_version: "42trade.strategy.v2",
    events: [
      {
        id: "rejection_event",
        name: "Rejection",
        when: { fn: "rejected", args: [] },
        actions: [{ id: "rejection_draw", action: "draw" }],
      },
    ],
  };

  const result = evaluateChartStrategies({
    bars: makeStructureBars(),
    strategies: [strategy],
    lookbackBars: 8,
    symbol: "EURUSD",
    tf: "15m",
  });

  assert.equal(result.matches.length > 0, true);
  assert.equal(
    result.matches.some(
      (entry) =>
        Array.isArray(entry.artifacts) &&
        entry.artifacts.some((item) => item?.type === "rejected"),
    ),
    true,
  );
});

test("evaluateChartStrategies can detect All TF rule hits from higher timeframe data", () => {
  const strategy = {
    id: "multi_tf_bos",
    name: "Multi TF BOS",
    engine_version: "42trade.strategy.v2",
    events: [
      {
        id: "bos_any_higher_tf",
        name: "BOS Any Higher TF",
        when: { fn: "bos", args: ["bullish", "all"] },
        actions: [{ id: "bos_draw", action: "draw" }],
      },
    ],
  };

  const lowerTfBars = [
    { time: 60, open: 100, high: 100.2, low: 99.8, close: 100, volume: 10 },
    { time: 120, open: 100, high: 100.1, low: 99.9, close: 100, volume: 10 },
    { time: 180, open: 100, high: 100.2, low: 99.8, close: 100, volume: 10 },
    { time: 240, open: 100, high: 100.1, low: 99.9, close: 100, volume: 10 },
    { time: 300, open: 100, high: 100.2, low: 99.8, close: 100, volume: 10 },
    { time: 360, open: 100, high: 100.1, low: 99.9, close: 100, volume: 10 },
    { time: 420, open: 100, high: 100.2, low: 99.8, close: 100, volume: 10 },
    { time: 480, open: 100, high: 100.1, low: 99.9, close: 100, volume: 10 },
    { time: 540, open: 100, high: 100.2, low: 99.8, close: 100, volume: 10 },
    { time: 600, open: 100, high: 100.1, low: 99.9, close: 100, volume: 10 },
    { time: 660, open: 100, high: 100.2, low: 99.8, close: 100, volume: 10 },
  ];

  const result = evaluateChartStrategies({
    bars: lowerTfBars,
    multiTfBars: {
      "15m": makeStructureBars(),
    },
    strategies: [strategy],
    lookbackBars: 11,
    symbol: "EURUSD",
    tf: "1m",
  });

  assert.equal(result.matches.length > 0, true);
  assert.equal(result.matches.some((entry) => entry.sourceTf === "15m"), true);
  assert.equal(
    result.matches.some(
      (entry) =>
        Array.isArray(entry.artifacts) &&
        entry.artifacts.some((item) => item?.timeframe === "15m" || item?.source_tf === "15m"),
    ),
    true,
  );
});

test("groupArtifactsBySourceTf keeps separate markers for separate artifact times within the same timeframe", () => {
  const groups = groupArtifactsBySourceTf(
    {
      kind: "artifact_result",
      matches: [
        { id: "bos-15m-1", type: "bos", timeframe: "15m", anchor_time: 900, subtype: "bullish" },
        { id: "bos-15m-2", type: "bos", timeframe: "15m", anchor_time: 1800, subtype: "bullish" },
        { id: "bos-4h-1", type: "bos", timeframe: "4h", anchor_time: 14400, subtype: "bullish" },
      ],
    },
    "15m",
    0,
  );

  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups.map((group) => [group.sourceTf, group.markerTimeUnix]),
    [
      ["15m", 900],
      ["15m", 1800],
      ["4h", 14400],
    ],
  );
});

test("detectArtifacts keeps historical BOS markers instead of trimming them near the last bar", () => {
  assert.equal(shouldLimitArtifactType("bos", "structure"), false);
  const kept = limitArtifactsNearLastBarByType(
    [
      { id: "bos-1", family: "structure", type: "bos", price: 100, anchor_time: 1000 },
      { id: "bos-2", family: "structure", type: "bos", price: 110, anchor_time: 2000 },
      { id: "bos-3", family: "structure", type: "bos", price: 120, anchor_time: 3000 },
    ],
    [{ time: 4000, close: 115, open: 115, high: 116, low: 114 }],
  );
  assert.deepEqual(
    kept.map((item) => item.id),
    ["bos-1", "bos-2", "bos-3"],
  );
});

test("BOS source swings align with derived swing markers from the same dataset", () => {
  const items = buildDerivedItemsFromBars(makeStructureBars(), "15m");
  const swings = items.filter((item) => ["swing_high", "swing_low"].includes(item?.type));
  const structureBreaks = items.filter((item) => ["bos", "choch"].includes(item?.type));

  assert.equal(swings.length > 0, true);
  assert.equal(structureBreaks.length > 0, true);
  assert.equal(
    structureBreaks.every((item) =>
      swings.some(
        (swing) =>
          Number(swing?.anchor_time) === Number(item?.payload?.source_swing_time) &&
          Number(swing?.price) === Number(item?.payload?.source_swing_price),
      ),
    ),
    true,
  );
});

test("evaluateChartStrategies derives directional marker metadata for long entries", () => {
  const strategy = {
    id: "ema_cross",
    name: "EMA Cross",
    engine_version: "42trade.strategy.v2",
    indicators: [
      { id: "ema_fast", type: "ema", length: 2, source: "close" },
      { id: "ema_slow", type: "ema", length: 4, source: "close" },
    ],
    events: [
      {
        id: "entry_long",
        name: "Entry Long",
        when: {
          crosses_above: [
            { var: "indicators.ema_fast" },
            { var: "indicators.ema_slow" },
          ],
        },
        actions: [{ id: "open_long", type: "trade.open.long" }],
      },
    ],
  };

  const result = evaluateChartStrategies({
    bars: makeBars([10, 9, 8, 9, 11, 13, 14]),
    strategies: [strategy],
    lookbackBars: 5,
    symbol: "EURUSD",
    tf: "1m",
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].markerDirection, "up");
  assert.equal(result.matches[0].markerShape, "arrowUp");
  assert.equal(result.matches[0].markerPosition, "belowBar");
  assert.equal(result.matches[0].markerText, "EMA Cross");
});
