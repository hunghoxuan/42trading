import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveTradeChartRenderBars,
  resolveTradeFetchBarsCount,
  resolveTradeFetchEndTimeSec,
} from "../../shared/utils/tradeAnchor.js";
import { resolveTradeFocusedWindow } from "../../modules/42trade/components/charts/backtestChartTheme.js";

test("resolveTradeFetchEndTimeSec stays anchored to the trade close when available", () => {
  assert.equal(
    resolveTradeFetchEndTimeSec({
      createdAt: "2026-06-01T09:00:00.000Z",
      openedAt: "2026-06-01T09:15:00.000Z",
      closedAt: "2026-06-01T10:00:00.000Z",
      nowSec: 1_900_000_000,
    }),
    1_780_308_000,
  );
});

test("resolveTradeFetchBarsCount uses the trade window instead of stretching to now once closed", () => {
  assert.equal(
    resolveTradeFetchBarsCount({
      createdAt: "2026-06-01T09:00:00.000Z",
      openedAt: "2026-06-01T09:15:00.000Z",
      closedAt: "2026-06-01T10:00:00.000Z",
      timeframes: ["15m"],
      requestedBars: 0,
      nowSec: 1_900_000_000,
    }),
    20,
  );
});

test("resolveTradeChartRenderBars prefers the focused trade window outside replay", () => {
  const loadedBars = [{ time: 1 }, { time: 2 }, { time: 3 }, { time: 4 }];
  const focusedBars = [{ time: 2 }, { time: 3 }];

  assert.deepEqual(
    resolveTradeChartRenderBars({
      loadedBars,
      focusedBars,
      replayBars: [],
      replayActive: false,
    }),
    focusedBars,
  );
});

test("resolveTradeFocusedWindow caps open-trade viewport to recent visible bars", () => {
  const bars = Array.from({ length: 1000 }, (_, index) => ({
    time: 1_700_000_000 + index * 900,
  }));
  const firstAnchorIndex = 200;
  const range = resolveTradeFocusedWindow(bars, 300, {
    firstAnchorTimeSec: bars[firstAnchorIndex].time,
    lastAnchorTimeSec: bars[bars.length - 1].time,
    preferLatestWindow: true,
  });

  assert.equal(range.from, bars.length - 300);
  assert.equal(range.to, bars.length - 1);
});
