import assert from "node:assert/strict";
import test from "node:test";

import { resolveDisplayedVersion } from "../../shared/utils/appVersion.js";
import { deriveBacktestFormFromRun } from "../../shared/utils/backtestForm.js";
import {
  resolveTradeChartRenderBars,
  resolveTradeFetchBarsCount,
  resolveTradeFetchEndTimeSec,
  resolveTradeViewportEndTimeSec,
} from "../../shared/utils/tradeAnchor.js";

test("resolveDisplayedVersion prefers server version when present", () => {
  assert.equal(resolveDisplayedVersion("1.2.3", "0.1.6"), "1.2.3");
});

test("resolveDisplayedVersion falls back to build version when server version is missing", () => {
  assert.equal(resolveDisplayedVersion("", "0.1.6"), "0.1.6");
  assert.equal(resolveDisplayedVersion(null, "0.1.6"), "0.1.6");
});

test("resolveDisplayedVersion returns empty string when neither version exists", () => {
  assert.equal(resolveDisplayedVersion("", ""), "");
});

test("deriveBacktestFormFromRun hydrates backtest form fields from loaded run", () => {
  assert.deepEqual(
    deriveBacktestFormFromRun(
      {
        symbol: "BTCUSD",
        tf: "60",
        limit: 1000,
        strategy_key: "breakout_v2",
        direction: "sell",
        session: "London",
        one_r_value: 250,
      },
      {
        symbol: "EURAUD",
        tf: "15",
        limit: "all",
        strategy_key: "ema_cross_v1",
        direction: "all",
        session: "Any",
        one_r_value: "100",
      },
    ),
    {
      symbol: "BTCUSD",
      tf: "60",
      limit: "1000",
      limit_mode: "bars",
      limit_bars_value: "1000",
      strategy_key: "breakout_v2",
      direction: "sell",
      session: "London",
      one_r_value: "250",
    },
  );

  assert.deepEqual(
    deriveBacktestFormFromRun(
      {
        symbol: "XAUUSD",
        tf: "5",
        limit: 0,
      },
      {
        symbol: "EURAUD",
        tf: "15",
        limit: "300",
        strategy_key: "ema_cross_v1",
        direction: "buy",
        session: "Asian",
        one_r_value: "100",
      },
    ),
    {
      symbol: "XAUUSD",
      tf: "5",
      limit: "all",
      limit_mode: "bars",
      limit_bars_value: "all",
      strategy_key: "ema_cross_v1",
      direction: "buy",
      session: "Asian",
      one_r_value: "100",
    },
  );
});

test("trade anchor helpers split viewport end from fetch end for closed trades", () => {
  const nowSec = 1_719_064_800;
  const closedAt = "2026-06-22T10:30:00Z";
  const closedSec = Math.floor(new Date(closedAt).getTime() / 1000);

  assert.equal(
    resolveTradeFetchEndTimeSec({
      createdAt: "2026-06-22T08:00:00Z",
      openedAt: "2026-06-22T09:00:00Z",
      closedAt,
      nowSec,
    }),
    nowSec,
  );

  const viewportEnd = resolveTradeViewportEndTimeSec({
    createdAt: "2026-06-22T08:00:00Z",
    openedAt: "2026-06-22T09:00:00Z",
    closedAt,
    timeframes: ["15m"],
    nowSec,
  });
  assert.equal(viewportEnd, closedSec + 15 * 60 * 16);
  assert.notEqual(viewportEnd, nowSec);

  assert.equal(
    resolveTradeFetchBarsCount({
      createdAt: "2026-06-22T08:00:00Z",
      openedAt: "2026-06-22T09:00:00Z",
      closedAt,
      timeframes: ["15m"],
      requestedBars: 500,
      nowSec,
    }),
    500,
  );
});

test("trade anchor helpers expand fetch bars from trade start through now", () => {
  const nowSec = Math.floor(new Date("2026-06-22T12:00:00Z").getTime() / 1000);
  assert.equal(
    resolveTradeFetchBarsCount({
      createdAt: "2026-06-22T08:00:00Z",
      openedAt: "2026-06-22T09:00:00Z",
      timeframes: ["15m"],
      requestedBars: 20,
      nowSec,
    }),
    33,
  );
});

test("trade chart render bars keep full loaded dataset when replay is off", () => {
  const loadedBars = [{ time: 1 }, { time: 2 }, { time: 3 }, { time: 4 }];
  const focusedBars = [{ time: 2 }, { time: 3 }];
  const replayBars = [{ time: 2 }];

  assert.deepEqual(
    resolveTradeChartRenderBars({
      loadedBars,
      focusedBars,
      replayBars,
      replayActive: false,
    }),
    loadedBars,
  );

  assert.deepEqual(
    resolveTradeChartRenderBars({
      loadedBars,
      focusedBars,
      replayBars,
      replayActive: true,
    }),
    replayBars,
  );
});
