function toEpochSec(value) {
  const ms = new Date(value || 0).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms / 1000);
}

function timeframeToSeconds(tf) {
  const value = String(tf || "")
    .trim()
    .toLowerCase();
  if (!value) return null;
  if (value === "1m" || value === "1min" || value === "m1") return 60;
  if (value === "5m" || value === "5min" || value === "m5") return 5 * 60;
  if (value === "15m" || value === "15min" || value === "m15") return 15 * 60;
  if (value === "1h" || value === "60" || value === "h1") return 60 * 60;
  if (value === "4h" || value === "240" || value === "h4") return 4 * 60 * 60;
  if (value === "d" || value === "1d" || value === "day") return 24 * 60 * 60;
  if (value === "w" || value === "1w" || value === "week") return 7 * 24 * 60 * 60;
  return null;
}

function tradeAnchorPaddingBars(tfSeconds) {
  if (!Number.isFinite(tfSeconds) || tfSeconds <= 0) return 16;
  if (tfSeconds >= 24 * 60 * 60) return 2;
  if (tfSeconds >= 4 * 60 * 60) return 6;
  if (tfSeconds >= 60 * 60) return 10;
  if (tfSeconds >= 15 * 60) return 16;
  if (tfSeconds >= 5 * 60) return 24;
  return 40;
}

const DEFAULT_TRADE_ANCHOR_PADDING_SECONDS = 4 * 60 * 60;

function hasAnyTradeTime({ createdAt = null, openedAt = null, closedAt = null } = {}) {
  return [createdAt, openedAt, closedAt].some((value) => {
    const sec = toEpochSec(value);
    return Number.isFinite(sec) && sec > 0;
  });
}

export function resolveTradeViewportEndTimeSec({
  createdAt = null,
  openedAt = null,
  closedAt = null,
  timeframes = [],
  nowSec = null,
} = {}) {
  const closedSec = toEpochSec(closedAt);
  const openedSec = toEpochSec(openedAt);
  const createdSec = toEpochSec(createdAt);
  const safeNowSec = Number.isFinite(Number(nowSec)) && Number(nowSec) > 0
    ? Number(nowSec)
    : Math.floor(Date.now() / 1000);
  const baseSec =
    Number.isFinite(closedSec) && closedSec > 0
      ? closedSec
      : safeNowSec;
  if (!Number.isFinite(baseSec) || baseSec <= 0) return null;
  if (
    (!Number.isFinite(closedSec) || closedSec <= 0) &&
    (!Number.isFinite(openedSec) || openedSec <= 0) &&
    (!Number.isFinite(createdSec) || createdSec <= 0)
  ) {
    return null;
  }
  const tfSeconds = (Array.isArray(timeframes) ? timeframes : [])
    .map(timeframeToSeconds)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)[0];
  const paddingSeconds = Number.isFinite(tfSeconds)
    ? tfSeconds * tradeAnchorPaddingBars(tfSeconds)
    : DEFAULT_TRADE_ANCHOR_PADDING_SECONDS;
  return baseSec + paddingSeconds;
}

export function resolveTradeFetchEndTimeSec({
  createdAt = null,
  openedAt = null,
  closedAt = null,
  nowSec = null,
} = {}) {
  if (!hasAnyTradeTime({ createdAt, openedAt, closedAt })) return null;
  const closedSec = toEpochSec(closedAt);
  if (Number.isFinite(closedSec) && closedSec > 0) return closedSec;
  const safeNowSec = Number.isFinite(Number(nowSec)) && Number(nowSec) > 0
    ? Number(nowSec)
    : Math.floor(Date.now() / 1000);
  return Number.isFinite(safeNowSec) && safeNowSec > 0 ? safeNowSec : null;
}

export function resolveTradeFetchBarsCount({
  createdAt = null,
  openedAt = null,
  closedAt = null,
  timeframes = [],
  requestedBars = 0,
  nowSec = null,
} = {}) {
  const createdSec = toEpochSec(createdAt);
  const openedSec = toEpochSec(openedAt);
  const closedSec = toEpochSec(closedAt);
  const startSec =
    (Number.isFinite(openedSec) && openedSec > 0
      ? openedSec
      : null) ??
    (Number.isFinite(createdSec) && createdSec > 0
      ? createdSec
      : null) ??
    (Number.isFinite(closedSec) && closedSec > 0
      ? closedSec
      : null);
  if (!Number.isFinite(startSec) || startSec <= 0) return null;

  const safeNowSec = Number.isFinite(Number(nowSec)) && Number(nowSec) > 0
    ? Number(nowSec)
    : Math.floor(Date.now() / 1000);
  const tfSeconds = (Array.isArray(timeframes) ? timeframes : [])
    .map(timeframeToSeconds)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)[0];
  const paddingSeconds = Number.isFinite(tfSeconds)
    ? tfSeconds * tradeAnchorPaddingBars(tfSeconds)
    : DEFAULT_TRADE_ANCHOR_PADDING_SECONDS;
  const endAnchorSec =
    Number.isFinite(closedSec) && closedSec > 0
      ? closedSec + paddingSeconds
      : safeNowSec;
  if (!Number.isFinite(endAnchorSec) || endAnchorSec <= 0) return null;
  const effectiveTfSeconds = Number.isFinite(tfSeconds) && tfSeconds > 0 ? tfSeconds : 60;
  const startAnchorSec = Math.max(0, startSec);
  const spanBars = Math.ceil(
    Math.max(0, endAnchorSec - startAnchorSec) / effectiveTfSeconds,
  ) + 1;
  const minRequestedBars = Math.max(0, Math.round(Number(requestedBars) || 0));
  return Math.max(minRequestedBars, spanBars);
}

export function resolveTradeChartRenderBars({
  loadedBars = [],
  focusedBars = [],
  replayBars = [],
  replayActive = false,
} = {}) {
  if (!replayActive && Array.isArray(focusedBars) && focusedBars.length) {
    return focusedBars;
  }
  if (Array.isArray(replayBars) && replayBars.length) return replayBars;
  if (Array.isArray(focusedBars) && focusedBars.length) return focusedBars;
  return Array.isArray(loadedBars) ? loadedBars : [];
}
