import assert from "node:assert/strict";
import test from "node:test";

import {
  findViewportHistoryGap,
  mergeHistoricalBarsIntoTfData,
  mergeRealtimeBarsIntoTfData,
  mergeViewportArtifactObjects,
  resolveChartAutoHealPlan,
  resolveViewportHistoryRequest,
  resolveRealtimeBadgeStatus,
  shouldAutoFollowRealtimeTail,
} from "../../shared/utils/symbolChartStreaming.js";

test("findViewportHistoryGap detects when viewport starts before the first loaded bar", () => {
  assert.deepEqual(
    findViewportHistoryGap({
      firstBarSec: 1_700_000_000,
      viewportStartMs: (1_700_000_000 - 6 * 300) * 1000,
      timeframeSec: 300,
      barsPerRequest: 600,
    }),
    {
      needsBackfill: true,
      gapBars: 5,
      requestBars: 600,
    },
  );
});

test("findViewportHistoryGap stays idle when viewport is already covered", () => {
  assert.deepEqual(
    findViewportHistoryGap({
      firstBarSec: 1_700_000_000,
      viewportStartMs: (1_700_000_000 - 300) * 1000,
      timeframeSec: 300,
      barsPerRequest: 600,
    }),
    {
      needsBackfill: false,
      gapBars: 0,
      requestBars: 0,
    },
  );
});

test("resolveViewportHistoryRequest prefetches before a visible gap when scrolling left", () => {
  assert.deepEqual(
    resolveViewportHistoryRequest({
      firstBarSec: 1_700_000_000,
      viewportStartMs: (1_700_000_000 + 4 * 300) * 1000,
      previousViewportStartMs: (1_700_000_000 + 9 * 300) * 1000,
      timeframeSec: 300,
      visibleBars: 20,
      barsPerRequest: 600,
      preloadThresholdBars: 6,
    }),
    {
      shouldRequest: true,
      needsBackfill: false,
      shouldPrefetch: true,
      gapBars: 0,
      leftBufferBars: 4,
      movingTowardHistory: true,
      requestBars: 600,
      reason: "near_left_edge_prefetch",
    },
  );
});

test("resolveViewportHistoryRequest stays idle when moving away from history", () => {
  assert.deepEqual(
    resolveViewportHistoryRequest({
      firstBarSec: 1_700_000_000,
      viewportStartMs: (1_700_000_000 + 8 * 300) * 1000,
      previousViewportStartMs: (1_700_000_000 + 4 * 300) * 1000,
      timeframeSec: 300,
      visibleBars: 20,
      barsPerRequest: 600,
      preloadThresholdBars: 6,
    }),
    {
      shouldRequest: false,
      needsBackfill: false,
      shouldPrefetch: false,
      gapBars: 0,
      leftBufferBars: 8,
      movingTowardHistory: false,
      requestBars: 0,
      reason: "covered",
    },
  );
});

test("shouldAutoFollowRealtimeTail is true only when viewport is near the loaded tail", () => {
  assert.equal(
    shouldAutoFollowRealtimeTail({
      viewportEndMs: 1_700_000_000 * 1000,
      loadedEndSec: 1_700_000_000,
      timeframeSec: 300,
    }),
    true,
  );

  assert.equal(
    shouldAutoFollowRealtimeTail({
      viewportEndMs: (1_700_000_000 - 10 * 300) * 1000,
      loadedEndSec: 1_700_000_000,
      timeframeSec: 300,
    }),
    false,
  );
});

test("mergeRealtimeBarsIntoTfData replaces the last bar when timestamps match", () => {
  const current = {
    bars: [
      { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 200, open: 2, high: 3, low: 1.5, close: 2.5, volume: 20 },
    ],
    last_price: 2.5,
  };
  const next = mergeRealtimeBarsIntoTfData(current, {
    bars: [
      { time: 200, open: 2, high: 3.2, low: 1.5, close: 2.8, volume: 25 },
    ],
    lastPrice: 2.8,
    cachedAt: 1234,
  });

  assert.equal(next.bars.length, 2);
  assert.equal(next.bars[1].time, 200);
  assert.equal(next.bars[1].close, 2.8);
  assert.equal(next.last_price, 2.8);
});

test("mergeRealtimeBarsIntoTfData appends a new tail bar when realtime advances", () => {
  const current = {
    bars: [
      { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 200, open: 2, high: 3, low: 1.5, close: 2.5, volume: 20 },
    ],
    last_price: 2.5,
  };
  const next = mergeRealtimeBarsIntoTfData(current, {
    bars: [
      { time: 300, open: 2.5, high: 3.4, low: 2.4, close: 3.1, volume: 30 },
    ],
    lastPrice: 3.1,
    cachedAt: 1234,
  });

  assert.equal(next.bars.length, 3);
  assert.equal(next.bars[2].time, 300);
  assert.equal(next.bars[2].close, 3.1);
  assert.equal(next.last_price, 3.1);
});

test("mergeHistoricalBarsIntoTfData prepends unique older bars without disturbing the live tail", () => {
  const current = {
    bars: [
      { time: 200, open: 2, high: 3, low: 1.5, close: 2.5, volume: 20 },
      { time: 300, open: 2.5, high: 3.4, low: 2.4, close: 3.1, volume: 30 },
    ],
    last_price: 3.1,
  };
  const next = mergeHistoricalBarsIntoTfData(current, {
    bars: [
      { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 200, open: 2, high: 3, low: 1.5, close: 2.5, volume: 20 },
    ],
    cachedAt: 1234,
  });

  assert.deepEqual(
    next.bars.map((bar) => Number(bar.time)),
    [100, 200, 300],
  );
  assert.equal(next.last_price, 3.1);
  assert.equal(next.cached_at, 1234);
});

test("mergeViewportArtifactObjects keeps previously loaded artifacts when a zoom-scoped refresh returns fewer items", () => {
  const current = [
    { id: "d-fvg-1", artifact_group: "fvg", source_tf: "d", label: "D FVG" },
    { id: "m15-fvg-1", artifact_group: "fvg", source_tf: "15m", label: "15m FVG" },
  ];
  const incoming = [
    { id: "m15-fvg-1", artifact_group: "fvg", source_tf: "15m", label: "15m FVG" },
  ];

  assert.deepEqual(
    mergeViewportArtifactObjects(current, incoming).map((item) => item.id),
    ["d-fvg-1", "m15-fvg-1"],
  );
});

test("mergeViewportArtifactObjects updates matching artifact ids with the latest visible payload", () => {
  const current = [
    { id: "d-fvg-1", artifact_group: "fvg", source_tf: "d", visible: true, color: "#aaa" },
  ];
  const incoming = [
    { id: "d-fvg-1", artifact_group: "fvg", source_tf: "d", visible: false, color: "#bbb" },
  ];

  assert.deepEqual(mergeViewportArtifactObjects(current, incoming), incoming);
});

test("resolveRealtimeBadgeStatus stays yellow before the socket has ever connected", () => {
  assert.deepEqual(
    resolveRealtimeBadgeStatus({
      connectionState: "connecting",
      everConnected: false,
      streamConnected: false,
      lastDataAt: null,
      nowMs: 1_700_000_000_000,
      staleAfterMs: 90_000,
    }),
    {
      tone: "yellow",
      color: "#f59e0b",
      isLive: false,
      reason: "socket_not_connected",
    },
  );
});

test("resolveChartAutoHealPlan requests a refresh when latest bars are missing", () => {
  assert.deepEqual(
    resolveChartAutoHealPlan({
      missingLatestBars: 2,
      streamExpected: true,
      streamConnected: true,
      streamEverConnected: true,
      streamConnectionState: "connected",
      timeframeSec: 300,
      followTail: true,
      consecutiveIssues: 1,
      nowMs: 1_700_000_000_000,
    }),
    {
      shouldRun: true,
      action: "refresh",
      reason: "missing_latest_bars",
      missingBars: 2,
      streamStale: false,
      streamDisconnected: false,
      staleAfterMs: 600_000,
      cooldownRemainingMs: 0,
    },
  );
});

test("resolveChartAutoHealPlan escalates to fix after repeated unresolved issues", () => {
  const nowMs = 1_700_000_200_000;
  assert.deepEqual(
    resolveChartAutoHealPlan({
      missingLatestBars: 1,
      streamExpected: true,
      streamConnected: false,
      streamEverConnected: true,
      streamConnectionState: "disconnected",
      timeframeSec: 300,
      followTail: true,
      consecutiveIssues: 2,
      lastActionAt: nowMs - 60_000,
      lastAction: "refresh",
      nowMs,
    }),
    {
      shouldRun: true,
      action: "fix",
      reason: "missing_latest_bars",
      missingBars: 1,
      streamStale: false,
      streamDisconnected: true,
      staleAfterMs: 600_000,
      cooldownRemainingMs: 0,
    },
  );
});

test("resolveChartAutoHealPlan waits for cooldown before retrying the same action", () => {
  const nowMs = 1_700_000_000_000;
  const plan = resolveChartAutoHealPlan({
    missingLatestBars: 4,
    streamExpected: true,
    streamConnected: true,
    streamEverConnected: true,
    streamConnectionState: "connected",
    timeframeSec: 300,
    followTail: true,
    consecutiveIssues: 3,
    lastActionAt: nowMs - 30_000,
    lastAction: "fix",
    nowMs,
  });

  assert.equal(plan.shouldRun, false);
  assert.equal(plan.action, "fix");
  assert.equal(plan.reason, "missing_latest_bars");
  assert.equal(plan.cooldownRemainingMs, 90_000);
});

test("resolveChartAutoHealPlan stays idle when stream is healthy and bars are current", () => {
  assert.deepEqual(
    resolveChartAutoHealPlan({
      missingLatestBars: 0,
      streamExpected: true,
      streamConnected: true,
      streamEverConnected: true,
      streamConnectionState: "connected",
      streamLastDataAt: 1_700_000_000_000,
      timeframeSec: 300,
      followTail: true,
      nowMs: 1_700_000_010_000,
    }),
    {
      shouldRun: false,
      action: null,
      reason: "healthy",
      missingBars: 0,
      streamStale: false,
      streamDisconnected: false,
      staleAfterMs: 600_000,
      cooldownRemainingMs: 0,
    },
  );
});

test("resolveRealtimeBadgeStatus turns green only when socket is connected and data is fresh", () => {
  assert.deepEqual(
    resolveRealtimeBadgeStatus({
      connectionState: "connected",
      everConnected: true,
      streamConnected: true,
      lastDataAt: 1_700_000_000_000 - 30_000,
      nowMs: 1_700_000_000_000,
      staleAfterMs: 90_000,
    }),
    {
      tone: "green",
      color: "#22c55e",
      isLive: true,
      reason: "live_and_fresh",
    },
  );
});

test("resolveRealtimeBadgeStatus turns red when socket was live and then disconnects", () => {
  assert.deepEqual(
    resolveRealtimeBadgeStatus({
      connectionState: "disconnected",
      everConnected: true,
      streamConnected: false,
      lastDataAt: 1_700_000_000_000 - 30_000,
      nowMs: 1_700_000_000_000,
      staleAfterMs: 90_000,
    }),
    {
      tone: "red",
      color: "#ef4444",
      isLive: false,
      reason: "socket_disconnected_after_live",
    },
  );
});

test("resolveRealtimeBadgeStatus turns red when socket is connected but feed is stale", () => {
  assert.deepEqual(
    resolveRealtimeBadgeStatus({
      connectionState: "connected",
      everConnected: true,
      streamConnected: true,
      lastDataAt: 1_700_000_000_000 - 120_000,
      nowMs: 1_700_000_000_000,
      staleAfterMs: 90_000,
    }),
    {
      tone: "red",
      color: "#ef4444",
      isLive: false,
      reason: "stream_stale",
    },
  );
});
