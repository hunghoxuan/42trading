import assert from "node:assert/strict";
import test from "node:test";

import { createAppRuntime } from "../../shared/runtime/bootstrap/createAppRuntime.js";

function makeBarSeries(startTime, count) {
  return Array.from({ length: count }, (_, index) => ({
    time: startTime + index * 300,
    open: 1 + index,
    high: 2 + index,
    low: 0.5 + index,
    close: 1.5 + index,
    volume: 10 + index,
  }));
}

test("chart history bootstrap returns a 3x buffered window and caches the result", async () => {
  const storageBars = makeBarSeries(1_700_000_000, 900);
  const loadCalls = [];
  const runtime = createAppRuntime({
    chartHistory: {
      loadSnapshot: async (request) => {
        loadCalls.push(request);
        const count = Math.min(request.bars, storageBars.length);
        return {
          topic: `chart:${request.symbol}:${request.timeframe}`,
          symbol: request.symbol,
          timeframe: request.timeframe,
          bars: storageBars.slice(-count),
          lastPrice: storageBars[storageBars.length - 1]?.close ?? null,
          metadata: {
            source_kind: "broker",
          },
        };
      },
      refreshHistory: async () => ({ ok: true, refreshed: false }),
    },
  });

  const first = await runtime.chartHistory.resolveRange({
    symbol: "BTCUSD",
    timeframe: "5m",
    bars: 300,
    visibleBars: 300,
    direction: "latest",
  });
  const second = await runtime.chartHistory.resolveRange({
    symbol: "BTCUSD",
    timeframe: "5m",
    bars: 300,
    visibleBars: 300,
    direction: "latest",
  });

  assert.equal(first.bars.length, 900);
  assert.equal(first.metadata.requested_bars, 300);
  assert.equal(first.metadata.served_bars, 900);
  assert.equal(first.metadata.buffer_multiplier, 3);
  assert.equal(first.metadata.resolution_path, "storage");
  assert.equal(second.metadata.resolution_path, "cache");
  assert.equal(loadCalls.length, 1);
});

test("chart history backfill refreshes remote history when storage does not cover the expanded range", async () => {
  const beforeRefreshBars = makeBarSeries(1_700_000_000, 120);
  const afterRefreshBars = makeBarSeries(1_699_730_000, 900);
  let refreshed = false;
  const runtime = createAppRuntime({
    chartHistory: {
      loadSnapshot: async (request) => {
        const bars = refreshed ? afterRefreshBars : beforeRefreshBars;
        const count = Math.min(request.bars, bars.length);
        return {
          topic: `chart:${request.symbol}:${request.timeframe}`,
          symbol: request.symbol,
          timeframe: request.timeframe,
          bars: bars.slice(-count),
          lastPrice: bars[bars.length - 1]?.close ?? null,
          metadata: {
            source_kind: "broker",
          },
        };
      },
      refreshHistory: async (request) => {
        refreshed = true;
        assert.equal(request.direction, "history");
        assert.equal(request.requestedBars, 900);
        return { ok: true, refreshed: true };
      },
    },
  });

  const snapshot = await runtime.chartHistory.resolveRange({
    symbol: "BTCUSD",
    timeframe: "5m",
    bars: 300,
    visibleBars: 300,
    direction: "history",
    endTimeSec: 1_700_000_000 - 300,
  });

  assert.equal(snapshot.bars.length, 900);
  assert.equal(snapshot.metadata.resolution_path, "storage+remote");
  assert.equal(snapshot.metadata.remote_refreshed, true);
});

test("chart history backfill passes the requested history anchor into remote refresh", async () => {
  const beforeRefreshBars = makeBarSeries(1_700_000_000, 120);
  const afterRefreshBars = makeBarSeries(1_699_730_000, 900);
  let refreshed = false;
  let refreshRequest = null;
  const runtime = createAppRuntime({
    chartHistory: {
      loadSnapshot: async (request) => {
        const bars = refreshed ? afterRefreshBars : beforeRefreshBars;
        const count = Math.min(request.bars, bars.length);
        return {
          topic: `chart:${request.symbol}:${request.timeframe}`,
          symbol: request.symbol,
          timeframe: request.timeframe,
          bars: bars.slice(-count),
          lastPrice: bars[bars.length - 1]?.close ?? null,
          metadata: {
            source_kind: "broker",
          },
        };
      },
      refreshHistory: async (request) => {
        refreshRequest = request;
        refreshed = true;
        return { ok: true, refreshed: true };
      },
    },
  });

  await runtime.chartHistory.resolveRange({
    symbol: "BTCUSD",
    timeframe: "4h",
    bars: 300,
    visibleBars: 300,
    direction: "history",
    endTimeSec: 1_700_000_000 - 14_400,
  });

  assert.equal(refreshRequest?.direction, "history");
  assert.equal(refreshRequest?.endTimeSec, 1_700_000_000 - 14_400);
});

test("chart history falls back to direct storage results when remote refresh fails", async () => {
  const storageBars = makeBarSeries(1_700_000_000, 120);
  const runtime = createAppRuntime({
    chartHistory: {
      loadSnapshot: async (request) => {
        const count = Math.min(request.bars, storageBars.length);
        return {
          topic: `chart:${request.symbol}:${request.timeframe}`,
          symbol: request.symbol,
          timeframe: request.timeframe,
          bars: storageBars.slice(-count),
          lastPrice: storageBars[storageBars.length - 1]?.close ?? null,
          metadata: {
            source_kind: "broker",
          },
        };
      },
      refreshHistory: async () => ({ ok: false, refreshed: false }),
    },
  });

  const snapshot = await runtime.chartHistory.resolveRange({
    symbol: "BTCUSD",
    timeframe: "5m",
    bars: 300,
    visibleBars: 300,
    direction: "history",
  });

  assert.equal(snapshot.bars.length, 120);
  assert.equal(snapshot.metadata.resolution_path, "storage");
  assert.equal(snapshot.metadata.remote_refreshed, false);
});

test("chart history reports exhaustion explicitly when storage and remote both have no older bars", async () => {
  const runtime = createAppRuntime({
    chartHistory: {
      loadSnapshot: async () => ({
        topic: "chart:BTCUSD:15m",
        symbol: "BTCUSD",
        timeframe: "15m",
        bars: [],
        lastPrice: null,
        metadata: {
          source_kind: "broker",
        },
      }),
      refreshHistory: async () => ({
        ok: false,
        reason: "provider_empty",
        fetched_source_bars: 0,
      }),
    },
  });

  const snapshot = await runtime.chartHistory.resolveRange({
    symbol: "BTCUSD",
    timeframe: "15m",
    bars: 300,
    visibleBars: 300,
    direction: "history",
    endTimeSec: 1_700_000_000,
  });

  assert.equal(snapshot.metadata.history_status, "exhausted");
  assert.equal(snapshot.metadata.history_exhausted, true);
  assert.equal(snapshot.metadata.storage_had_earlier, false);
  assert.equal(snapshot.metadata.remote_attempted, true);
  assert.equal(snapshot.metadata.remote_returned_bars, 0);
});

test("chart history allows large requests without the old 5k clamp", async () => {
  const loadCalls = [];
  const runtime = createAppRuntime({
    chartHistory: {
      loadSnapshot: async (request) => {
        loadCalls.push(request);
        return {
          topic: `chart:${request.symbol}:${request.timeframe}`,
          symbol: request.symbol,
          timeframe: request.timeframe,
          bars: makeBarSeries(1_700_000_000, Math.min(request.bars, 20_000)),
          lastPrice: 1,
          metadata: {
            source_kind: "broker",
          },
        };
      },
      refreshHistory: async () => ({ ok: true, refreshed: false }),
    },
  });

  const snapshot = await runtime.chartHistory.resolveRange({
    symbol: "BTCUSD",
    timeframe: "5m",
    bars: 20_000,
    visibleBars: 20_000,
    direction: "history",
  });

  assert.equal(loadCalls.length, 1);
  assert.equal(loadCalls[0]?.bars, 20_000);
  assert.equal(snapshot.metadata.requested_bars, 20_000);
  assert.equal(snapshot.metadata.served_bars, 20_000);
});
