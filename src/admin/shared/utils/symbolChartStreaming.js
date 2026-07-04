export function findViewportHistoryGap({
  firstBarSec,
  viewportStartMs,
  timeframeSec,
  barsPerRequest = 0,
}) {
  const firstSec = Number(firstBarSec);
  const viewportMs = Number(viewportStartMs);
  const tfSec = Math.max(1, Number(timeframeSec) || 0);
  const requestBars = Math.max(0, Number(barsPerRequest) || 0);
  if (!Number.isFinite(firstSec) || firstSec <= 0) {
    return { needsBackfill: false, gapBars: 0, requestBars: 0 };
  }
  if (!Number.isFinite(viewportMs) || viewportMs <= 0 || !Number.isFinite(tfSec) || tfSec <= 0) {
    return { needsBackfill: false, gapBars: 0, requestBars: 0 };
  }
  const firstMs = firstSec * 1000;
  const thresholdMs = firstMs - tfSec * 1000;
  if (viewportMs >= thresholdMs) {
    return { needsBackfill: false, gapBars: 0, requestBars: 0 };
  }
  const gapBars = Math.max(1, Math.ceil((firstMs - viewportMs) / (tfSec * 1000)) - 1);
  return {
    needsBackfill: true,
    gapBars,
    requestBars: Math.max(requestBars, gapBars),
  };
}

export function resolveViewportHistoryRequest({
  firstBarSec,
  viewportStartMs,
  previousViewportStartMs = null,
  timeframeSec,
  visibleBars = 0,
  barsPerRequest = 0,
  preloadThresholdBars = 0,
}) {
  const gap = findViewportHistoryGap({
    firstBarSec,
    viewportStartMs,
    timeframeSec,
    barsPerRequest,
  });
  const firstSec = Number(firstBarSec);
  const viewportMs = Number(viewportStartMs);
  const previousViewportMs = Number(previousViewportStartMs);
  const tfSec = Math.max(1, Number(timeframeSec) || 0);
  const tfMs = tfSec * 1000;
  const visibleCount = Math.max(0, Number(visibleBars) || 0);
  const requestedBatchBars = Math.max(0, Number(barsPerRequest) || 0);
  const thresholdBars = Math.max(
    1,
    Number(preloadThresholdBars) || Math.ceil((visibleCount || 20) * 0.75),
  );

  if (!Number.isFinite(firstSec) || firstSec <= 0) {
    return {
      shouldRequest: false,
      needsBackfill: false,
      shouldPrefetch: false,
      gapBars: 0,
      leftBufferBars: null,
      requestBars: 0,
      reason: "missing_first_bar",
    };
  }
  if (!Number.isFinite(viewportMs) || viewportMs <= 0 || !Number.isFinite(tfSec) || tfSec <= 0) {
    return {
      shouldRequest: false,
      needsBackfill: false,
      shouldPrefetch: false,
      gapBars: 0,
      leftBufferBars: null,
      requestBars: 0,
      reason: "invalid_viewport",
    };
  }

  const firstMs = firstSec * 1000;
  const leftBufferBars =
    viewportMs >= firstMs ? Math.max(0, Math.floor((viewportMs - firstMs) / tfMs)) : 0;
  const movingTowardHistory =
    Number.isFinite(previousViewportMs) && previousViewportMs > 0
      ? viewportMs < previousViewportMs - Math.max(250, tfMs / 4)
      : false;
  const shouldPrefetch =
    !gap.needsBackfill &&
    movingTowardHistory &&
    leftBufferBars <= thresholdBars;
  const requestBars = shouldPrefetch
    ? Math.max(requestedBatchBars, thresholdBars * 2, visibleCount * 2)
    : Number(gap.requestBars) || 0;

  return {
    shouldRequest: gap.needsBackfill || shouldPrefetch,
    needsBackfill: gap.needsBackfill,
    shouldPrefetch,
    gapBars: gap.gapBars,
    leftBufferBars,
    movingTowardHistory,
    requestBars: shouldPrefetch ? Math.max(50, requestBars) : gap.requestBars,
    reason: gap.needsBackfill
      ? "viewport_gap"
      : shouldPrefetch
        ? "near_left_edge_prefetch"
        : "covered",
  };
}

export function shouldAutoFollowRealtimeTail({
  viewportEndMs,
  loadedEndSec,
  timeframeSec,
  followThresholdBars = 2,
}) {
  const viewportMs = Number(viewportEndMs);
  const loadedSec = Number(loadedEndSec);
  const tfSec = Math.max(1, Number(timeframeSec) || 0);
  const thresholdBars = Math.max(1, Number(followThresholdBars) || 0);
  if (!Number.isFinite(viewportMs) || viewportMs <= 0) return true;
  if (!Number.isFinite(loadedSec) || loadedSec <= 0) return true;
  const loadedMs = loadedSec * 1000;
  return viewportMs >= loadedMs - tfSec * 1000 * thresholdBars;
}

export function mergeRealtimeBarsIntoTfData(currentEntry = {}, update = {}) {
  const currentBars = Array.isArray(currentEntry?.bars) ? currentEntry.bars : [];
  const incomingBars = Array.isArray(update?.bars) ? update.bars : [];
  if (!incomingBars.length) return currentEntry;
  const nextBars = currentBars.map((bar) => ({ ...bar }));
  for (const rawBar of incomingBars) {
    const nextBar = rawBar && typeof rawBar === "object" ? { ...rawBar } : null;
    if (!nextBar) continue;
    if (!nextBars.length) {
      nextBars.push(nextBar);
      continue;
    }
    const lastIndex = nextBars.length - 1;
    const lastTime = Number(nextBars[lastIndex]?.time);
    const nextTime = Number(nextBar?.time);
    if (!Number.isFinite(nextTime) || nextTime <= 0) continue;
    if (Number.isFinite(lastTime) && lastTime === nextTime) {
      nextBars[lastIndex] = nextBar;
    } else if (!Number.isFinite(lastTime) || lastTime < nextTime) {
      nextBars.push(nextBar);
    }
  }
  return {
    ...currentEntry,
    bars: nextBars,
    last_price:
      Number(update?.lastPrice) ||
      Number(nextBars[nextBars.length - 1]?.close) ||
      currentEntry?.last_price ||
      null,
    created_at: update?.cachedAt || currentEntry?.created_at || Date.now(),
    cached_at: update?.cachedAt || currentEntry?.cached_at || Date.now(),
    cache_source: currentEntry?.cache_source || "realtime_stream",
    freshness: "stream",
  };
}

export function mergeHistoricalBarsIntoTfData(currentEntry = {}, update = {}) {
  const currentBars = Array.isArray(currentEntry?.bars) ? currentEntry.bars : [];
  const incomingBars = Array.isArray(update?.bars) ? update.bars : [];
  if (!incomingBars.length) return currentEntry;
  const byTime = new Map();
  for (const bar of [...incomingBars, ...currentBars]) {
    const nextBar = bar && typeof bar === "object" ? { ...bar } : null;
    const nextTime = Number(nextBar?.time);
    if (!nextBar || !Number.isFinite(nextTime) || nextTime <= 0) continue;
    byTime.set(nextTime, nextBar);
  }
  const nextBars = [...byTime.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, bar]) => bar);
  return {
    ...currentEntry,
    bars: nextBars,
    bar_start: nextBars[0]?.time || currentEntry?.bar_start || null,
    bar_end: nextBars[nextBars.length - 1]?.time || currentEntry?.bar_end || null,
    last_price:
      currentEntry?.last_price ||
      Number(nextBars[nextBars.length - 1]?.close) ||
      null,
    cached_at: update?.cachedAt || currentEntry?.cached_at || Date.now(),
    created_at: update?.cachedAt || currentEntry?.created_at || Date.now(),
    metadata:
      update?.metadata && typeof update.metadata === "object"
        ? {
            ...(currentEntry?.metadata && typeof currentEntry.metadata === "object"
              ? currentEntry.metadata
              : {}),
            ...update.metadata,
          }
        : currentEntry?.metadata || null,
  };
}

export function mergeViewportArtifactObjects(currentItems = [], incomingItems = []) {
  const current = Array.isArray(currentItems) ? currentItems : [];
  const incoming = Array.isArray(incomingItems) ? incomingItems : [];
  if (!current.length) return incoming;
  if (!incoming.length) return current;

  const mergedById = new Map();
  for (const item of current) {
    const id = String(item?.id || "");
    if (id) mergedById.set(id, item);
  }
  for (const item of incoming) {
    const id = String(item?.id || "");
    if (id) {
      mergedById.set(id, item);
    }
  }

  const next = [];
  const seen = new Set();
  for (const item of current) {
    const id = String(item?.id || "");
    if (!id || seen.has(id) || !mergedById.has(id)) continue;
    next.push(mergedById.get(id));
    seen.add(id);
  }
  for (const item of incoming) {
    const id = String(item?.id || "");
    if (!id || seen.has(id) || !mergedById.has(id)) continue;
    next.push(mergedById.get(id));
    seen.add(id);
  }
  return next;
}

export function resolveRealtimeBadgeStatus({
  connectionState = "",
  everConnected = false,
  streamConnected = false,
  lastDataAt = null,
  nowMs = Date.now(),
  staleAfterMs = 90_000,
} = {}) {
  const normalizedState = String(connectionState || "")
    .trim()
    .toLowerCase();
  const currentMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const lastDataMs = Number.isFinite(Number(lastDataAt)) ? Number(lastDataAt) : 0;
  const staleMs = Math.max(1_000, Number(staleAfterMs) || 90_000);
  const hasFreshData =
    lastDataMs > 0 && currentMs - lastDataMs <= staleMs;

  if (normalizedState === "connected" && streamConnected && hasFreshData) {
    return {
      tone: "green",
      color: "#22c55e",
      isLive: true,
      reason: "live_and_fresh",
    };
  }

  if (
    normalizedState === "error" ||
    (normalizedState === "disconnected" && everConnected) ||
    (normalizedState === "connected" && streamConnected && !hasFreshData)
  ) {
    return {
      tone: "red",
      color: "#ef4444",
      isLive: false,
      reason:
        normalizedState === "connected" && streamConnected && !hasFreshData
          ? "stream_stale"
          : "socket_disconnected_after_live",
    };
  }

  return {
    tone: "yellow",
    color: "#f59e0b",
    isLive: false,
    reason: "socket_not_connected",
  };
}

export function resolveChartAutoHealPlan({
  missingLatestBars = 0,
  streamExpected = false,
  streamConnected = false,
  streamEverConnected = false,
  streamConnectionState = "",
  streamLastDataAt = null,
  timeframeSec = 0,
  followTail = true,
  consecutiveIssues = 0,
  lastActionAt = 0,
  lastAction = "",
  nowMs = Date.now(),
  refreshCooldownMs = 30_000,
  fixCooldownMs = 120_000,
  escalationDelayMs = 45_000,
  issuesBeforeFix = 2,
  missingBarsForFix = 3,
} = {}) {
  const tfSec = Math.max(1, Number(timeframeSec) || 0);
  const missingBars = Math.max(0, Number(missingLatestBars) || 0);
  const connected = streamConnected === true;
  const everConnected = streamEverConnected === true;
  const expected = streamExpected === true;
  const connectionState = String(streamConnectionState || "")
    .trim()
    .toLowerCase();
  const lastDataAt = Number.isFinite(Number(streamLastDataAt))
    ? Number(streamLastDataAt)
    : 0;
  const currentMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const normalizedLastAction = String(lastAction || "")
    .trim()
    .toLowerCase();
  const priorActionAt = Number.isFinite(Number(lastActionAt))
    ? Number(lastActionAt)
    : 0;
  const staleAfterMs = Math.max(
    90_000,
    Math.min(10 * 60_000, tfSec * 3 * 1000),
  );
  const streamStale =
    expected &&
    connected &&
    lastDataAt > 0 &&
    currentMs - lastDataAt > staleAfterMs;
  const streamDisconnected =
    expected &&
    everConnected &&
    (!connected ||
      connectionState === "error" ||
      connectionState === "disconnected");
  const tailRisk = followTail !== false && (streamStale || streamDisconnected);
  const needsAttention = missingBars > 0 || tailRisk;
  const reason =
    missingBars > 0
      ? "missing_latest_bars"
      : streamStale
        ? "stream_stale"
        : streamDisconnected
          ? "stream_disconnected"
          : "healthy";

  if (!needsAttention) {
    return {
      shouldRun: false,
      action: null,
      reason,
      missingBars,
      streamStale,
      streamDisconnected,
      staleAfterMs,
      cooldownRemainingMs: 0,
    };
  }

  const nextAction =
    missingBars >= Math.max(1, Number(missingBarsForFix) || 0) ||
    Number(consecutiveIssues || 0) >= Math.max(1, Number(issuesBeforeFix) || 0)
      ? "fix"
      : "refresh";
  const cooldownMs =
    nextAction === "fix"
      ? Math.max(1_000, Number(fixCooldownMs) || 120_000)
      : Math.max(1_000, Number(refreshCooldownMs) || 30_000);
  const sinceLastActionMs =
    priorActionAt > 0 ? Math.max(0, currentMs - priorActionAt) : Number.POSITIVE_INFINITY;

  if (
    normalizedLastAction === nextAction &&
    Number.isFinite(sinceLastActionMs) &&
    sinceLastActionMs < cooldownMs
  ) {
    return {
      shouldRun: false,
      action: nextAction,
      reason,
      missingBars,
      streamStale,
      streamDisconnected,
      staleAfterMs,
      cooldownRemainingMs: cooldownMs - sinceLastActionMs,
    };
  }

  if (
    nextAction === "fix" &&
    priorActionAt > 0 &&
    Number.isFinite(sinceLastActionMs) &&
    sinceLastActionMs < Math.max(1_000, Number(escalationDelayMs) || 45_000)
  ) {
    return {
      shouldRun: false,
      action: nextAction,
      reason,
      missingBars,
      streamStale,
      streamDisconnected,
      staleAfterMs,
      cooldownRemainingMs:
        Math.max(1_000, Number(escalationDelayMs) || 45_000) - sinceLastActionMs,
    };
  }

  return {
    shouldRun: true,
    action: nextAction,
    reason,
    missingBars,
    streamStale,
    streamDisconnected,
    staleAfterMs,
    cooldownRemainingMs: 0,
  };
}
