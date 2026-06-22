"use strict";

const crypto = require("crypto");

const {
  buildReplayTopic,
  normalizeSymbol,
  normalizeTimeframe,
} = require("./realtimeCore");
const { loadChartSnapshot } = require("./chartStreamService");

const REPLAY_SESSIONS = new Map();

function clampIndex(index, maxIndex) {
  if (!Number.isFinite(Number(index))) return 0;
  return Math.max(0, Math.min(Number(index), Math.max(0, maxIndex)));
}

function findStartIndex(bars = [], startTimeSec = null) {
  const target = Number(startTimeSec);
  if (!Number.isFinite(target) || target <= 0) return 0;
  const index = bars.findIndex((bar) => Number(bar?.time) >= target);
  return index >= 0 ? index : 0;
}

function findEndIndex(bars = [], endTimeSec = null) {
  const target = Number(endTimeSec);
  if (!Number.isFinite(target) || target <= 0) return Math.max(0, bars.length - 1);
  let index = -1;
  for (let i = 0; i < bars.length; i += 1) {
    if (Number(bars[i]?.time) <= target) index = i;
    else break;
  }
  return index >= 0 ? index : Math.max(0, bars.length - 1);
}

function clearSessionTimer(session) {
  if (session?.timer) {
    clearInterval(session.timer);
    session.timer = null;
  }
}

function getVisibleBars(session) {
  const bars = Array.isArray(session?.bars) ? session.bars : [];
  if (!bars.length) return [];
  const startIndex = clampIndex(session.windowStartIndex, bars.length - 1);
  const cursorIndex = clampIndex(session.cursorIndex, bars.length - 1);
  return bars.slice(startIndex, cursorIndex + 1);
}

function buildReplaySnapshot(session) {
  const visibleBars = getVisibleBars(session);
  const currentBar = visibleBars.length ? visibleBars[visibleBars.length - 1] : null;
  return {
    topic: buildReplayTopic(session.id),
    sessionId: session.id,
    symbol: session.symbol,
    timeframe: session.timeframe,
    playing: Boolean(session.playing),
    pollMs: session.pollMs,
    cursorIndex: session.cursorIndex,
    windowStartIndex: session.windowStartIndex,
    windowEndIndex: session.windowEndIndex,
    totalBars: session.bars.length,
    visibleBars,
    currentTimeSec: Number(currentBar?.time) || null,
    startedAt: session.startedAt,
    lastUpdatedAt: session.lastUpdatedAt,
    version: session.version,
    completed: session.cursorIndex >= session.windowEndIndex,
  };
}

function bumpSession(session) {
  session.version += 1;
  session.lastUpdatedAt = new Date().toISOString();
  return session;
}

function advanceReplaySession(sessionId, step = 1) {
  const session = REPLAY_SESSIONS.get(String(sessionId || "").trim());
  if (!session) return null;
  const nextIndex = Math.min(
    session.windowEndIndex,
    Math.max(session.windowStartIndex, session.cursorIndex + Math.max(1, Number(step) || 1)),
  );
  if (nextIndex !== session.cursorIndex) {
    session.cursorIndex = nextIndex;
    bumpSession(session);
  }
  if (session.cursorIndex >= session.windowEndIndex) {
    session.playing = false;
    clearSessionTimer(session);
  }
  return buildReplaySnapshot(session);
}

function startReplayTimer(session) {
  clearSessionTimer(session);
  session.timer = setInterval(() => {
    const latest = REPLAY_SESSIONS.get(session.id);
    if (!latest || !latest.playing) {
      clearSessionTimer(session);
      return;
    }
    advanceReplaySession(session.id, 1);
  }, Math.max(100, Number(session.pollMs) || 1000));
}

function createReplaySession({
  symbol = "",
  timeframe = "5m",
  bars = 300,
  pollMs = 1000,
  startTimeSec = null,
  endTimeSec = null,
  dataRoot,
  duckdbPath,
}) {
  const snapshot = loadChartSnapshot({
    symbol,
    timeframe,
    bars,
    dataRoot,
    duckdbPath,
    endTimeSec,
  });
  const allBars = Array.isArray(snapshot?.bars) ? snapshot.bars : [];
  if (!allBars.length) {
    throw new Error("No bars available for replay");
  }
  const windowStartIndex = findStartIndex(allBars, startTimeSec);
  const windowEndIndex = Math.max(
    windowStartIndex,
    findEndIndex(allBars, endTimeSec),
  );
  const id = crypto.randomBytes(8).toString("hex");
  const session = {
    id,
    topic: buildReplayTopic(id),
    symbol: normalizeSymbol(symbol),
    timeframe: normalizeTimeframe(timeframe),
    bars: allBars,
    pollMs: Math.max(100, Number(pollMs) || 1000),
    playing: false,
    timer: null,
    windowStartIndex,
    windowEndIndex,
    cursorIndex: windowStartIndex,
    version: Date.now(),
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
  };
  REPLAY_SESSIONS.set(id, session);
  return buildReplaySnapshot(session);
}

function getReplaySession(sessionId) {
  const session = REPLAY_SESSIONS.get(String(sessionId || "").trim());
  return session ? buildReplaySnapshot(session) : null;
}

function updateReplaySession(sessionId, action = "pause", payload = {}) {
  const session = REPLAY_SESSIONS.get(String(sessionId || "").trim());
  if (!session) return null;
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (normalizedAction === "play") {
    session.playing = true;
    if (Number.isFinite(Number(payload.pollMs)) && Number(payload.pollMs) > 0) {
      session.pollMs = Math.max(100, Number(payload.pollMs));
    }
    if (session.cursorIndex >= session.windowEndIndex) {
      session.cursorIndex = session.windowStartIndex;
    }
    bumpSession(session);
    startReplayTimer(session);
    return buildReplaySnapshot(session);
  }
  if (normalizedAction === "pause") {
    session.playing = false;
    clearSessionTimer(session);
    bumpSession(session);
    return buildReplaySnapshot(session);
  }
  if (normalizedAction === "step") {
    session.playing = false;
    clearSessionTimer(session);
    return advanceReplaySession(session.id, Number(payload.step) || 1);
  }
  if (normalizedAction === "reset") {
    session.playing = false;
    clearSessionTimer(session);
    session.cursorIndex = session.windowStartIndex;
    bumpSession(session);
    return buildReplaySnapshot(session);
  }
  if (normalizedAction === "seek") {
    session.playing = false;
    clearSessionTimer(session);
    session.cursorIndex = clampIndex(
      Number(payload.cursorIndex),
      session.windowEndIndex,
    );
    if (session.cursorIndex < session.windowStartIndex) {
      session.cursorIndex = session.windowStartIndex;
    }
    bumpSession(session);
    return buildReplaySnapshot(session);
  }
  throw new Error(`Unsupported replay action: ${action}`);
}

function destroyReplaySession(sessionId) {
  const key = String(sessionId || "").trim();
  const session = REPLAY_SESSIONS.get(key);
  if (!session) return false;
  clearSessionTimer(session);
  REPLAY_SESSIONS.delete(key);
  return true;
}

module.exports = {
  createReplaySession,
  destroyReplaySession,
  getReplaySession,
  updateReplaySession,
};
