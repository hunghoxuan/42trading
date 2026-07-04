function cloneBars(bars = []) {
  return (Array.isArray(bars) ? bars : []).map((bar) => ({ ...bar }));
}

function normalizeRange(input = {}) {
  const startSec = Math.floor(Number(input?.startSec) || 0);
  const endSec = Math.floor(Number(input?.endSec) || 0);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec <= 0 || endSec <= 0) {
    return null;
  }
  return startSec <= endSec
    ? { startSec, endSec }
    : { startSec: endSec, endSec: startSec };
}

function rangesOverlap(left, right) {
  if (!left || !right) return false;
  return left.startSec <= right.endSec && right.startSec <= left.endSec;
}

function mergeRanges(ranges = [], nextRange = null) {
  const normalized = normalizeRange(nextRange);
  if (!normalized) return Array.isArray(ranges) ? ranges : [];
  const source = Array.isArray(ranges) ? ranges : [];
  const sorted = [...source, normalized]
    .map((range) => normalizeRange(range))
    .filter(Boolean)
    .sort((left, right) => left.startSec - right.startSec);
  const merged = [];
  for (const range of sorted) {
    const current = merged[merged.length - 1];
    if (!current) {
      merged.push({ ...range });
      continue;
    }
    if (range.startSec <= current.endSec + 1) {
      current.endSec = Math.max(current.endSec, range.endSec);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

function barsToRange(bars = []) {
  const list = Array.isArray(bars) ? bars : [];
  const firstSec = Math.floor(Number(list[0]?.time) || 0);
  const lastSec = Math.floor(Number(list[list.length - 1]?.time) || 0);
  return normalizeRange({ startSec: firstSec, endSec: lastSec });
}

function mergeBarsByTime(currentBars = [], nextBars = []) {
  const byTime = new Map();
  for (const bar of [...(Array.isArray(nextBars) ? nextBars : []), ...(Array.isArray(currentBars) ? currentBars : [])]) {
    const nextBar = bar && typeof bar === "object" ? { ...bar } : null;
    const nextTime = Math.floor(Number(nextBar?.time) || 0);
    if (!nextBar || !Number.isFinite(nextTime) || nextTime <= 0) continue;
    byTime.set(nextTime, nextBar);
  }
  return [...byTime.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, value]) => value);
}

const CHART_SYMBOL_TOPIC_RE = /^chart:[^:]+$/i;

function normalizeChartTimeframe(rawTf = "") {
  const value = String(rawTf || "")
    .trim()
    .toLowerCase();
  if (!value) return "";
  if (["1", "1m", "1min", "m1"].includes(value)) return "1m";
  if (["5", "5m", "5min", "m5"].includes(value)) return "5m";
  if (["15", "15m", "15min", "m15"].includes(value)) return "15m";
  if (["60", "1h", "h1"].includes(value)) return "1h";
  if (["240", "4h", "h4"].includes(value)) return "4h";
  if (["d", "1d", "day", "1440"].includes(value)) return "d";
  return value;
}

function isSymbolChartTopic(topic = "") {
  return CHART_SYMBOL_TOPIC_RE.test(String(topic || "").trim());
}

function createDefaultState(topic) {
  return {
    topic,
    status: "IDLE",
    connected: false,
    connectionState: "idle",
    everConnected: false,
    bars: [],
    timeframes: {},
    error: "",
    lastPrice: null,
    metadata: null,
    lastEventType: "",
    lastUpdatedAt: null,
    lastDataAt: null,
    lastConnectedAt: null,
    loadedHistoryRanges: [],
    exhaustedHistoryRanges: [],
    pendingHistoryRequests: [],
    version: 0,
  };
}

function stateHasBars(state = {}) {
  if (Array.isArray(state?.bars) && state.bars.length > 0) return true;
  return Object.values(state?.timeframes || {}).some(
    (entry) => Array.isArray(entry?.bars) && entry.bars.length > 0,
  );
}

function getTfState(state = {}, timeframe = "") {
  const tfKey = normalizeChartTimeframe(timeframe);
  if (!tfKey) return null;
  return (
    state?.timeframes?.[tfKey] || {
      timeframe: tfKey,
      status: "IDLE",
      bars: [],
      error: "",
      lastPrice: null,
      metadata: null,
      lastEventType: "",
      lastUpdatedAt: null,
      lastDataAt: null,
      version: 0,
    }
  );
}

export class ChartStreamStore {
  constructor() {
    this.topicState = new Map();
    this.listeners = new Map();
  }

  getState(topic) {
    return this.topicState.get(topic) || createDefaultState(topic);
  }

  subscribe(topic, listener) {
    const key = String(topic || "").trim();
    if (!key || typeof listener !== "function") {
      return () => {};
    }
    const set = this.listeners.get(key) || new Set();
    set.add(listener);
    this.listeners.set(key, set);
    listener(this.getState(key));
    return () => {
      const nextSet = this.listeners.get(key);
      if (!nextSet) return;
      nextSet.delete(listener);
      if (!nextSet.size) this.listeners.delete(key);
    };
  }

  setConnected(topic, connected) {
    const current = this.getState(topic);
    const nextConnected = Boolean(connected);
    const now = Date.now();
    this.#commit(topic, {
      ...current,
      connected: nextConnected,
      connectionState: nextConnected
        ? "connected"
        : current.everConnected
          ? "disconnected"
          : "idle",
      everConnected: current.everConnected || nextConnected,
      lastConnectedAt: nextConnected ? now : current.lastConnectedAt,
      error: nextConnected ? "" : current.error,
      status: nextConnected
        ? stateHasBars(current)
          ? "READY"
          : "CONNECTING"
        : current.status === "IDLE"
          ? "IDLE"
          : current.status,
      lastUpdatedAt: now,
    });
  }

  setDisconnected(topic, reason = "") {
    const current = this.getState(topic);
    this.#commit(topic, {
      ...current,
      connected: false,
      connectionState: current.everConnected ? "disconnected" : "idle",
      error: String(reason || current.error || ""),
      lastUpdatedAt: Date.now(),
    });
  }

  setBootstrap(topic, snapshot) {
    const current = this.getState(topic);
    const timeframe = normalizeChartTimeframe(snapshot?.timeframe);
    if (isSymbolChartTopic(topic) && timeframe) {
      const bars = cloneBars(snapshot?.bars || []);
      const tfState = getTfState(current, timeframe);
      this.#commit(topic, {
        ...current,
        status: stateHasBars(current) || bars.length ? "READY" : "EMPTY",
        error: "",
        lastUpdatedAt: Date.now(),
        version: Date.now(),
        timeframes: {
          ...(current.timeframes || {}),
          [timeframe]: {
            ...tfState,
            timeframe,
            status: bars.length ? "READY" : "EMPTY",
            bars,
            error: "",
            lastPrice:
              Number(snapshot?.lastPrice) ||
              Number(bars[bars.length - 1]?.close) ||
              null,
            metadata: snapshot?.metadata || null,
            lastEventType: "bootstrap",
            lastUpdatedAt: Date.now(),
            lastDataAt: tfState.lastDataAt,
            version: Date.now(),
          },
        },
      });
      return;
    }
    const bars = cloneBars(snapshot?.bars || []);
    this.#commit(topic, {
      topic,
      status: bars.length ? "READY" : "EMPTY",
      connected: current.connected,
      connectionState: current.connectionState,
      everConnected: current.everConnected,
      bars,
      error: "",
      lastPrice: Number(snapshot?.lastPrice) || Number(bars[bars.length - 1]?.close) || null,
      metadata: snapshot?.metadata || null,
      lastEventType: "bootstrap",
      lastUpdatedAt: Date.now(),
      lastDataAt: current.lastDataAt,
      lastConnectedAt: current.lastConnectedAt,
      loadedHistoryRanges: mergeRanges(current.loadedHistoryRanges, barsToRange(bars)),
      exhaustedHistoryRanges: current.exhaustedHistoryRanges,
      pendingHistoryRequests: current.pendingHistoryRequests,
      version: Date.now(),
    });
  }

  mergeHistory(topic, snapshot) {
    const current = this.getState(topic);
    const timeframe = normalizeChartTimeframe(snapshot?.timeframe);
    if (isSymbolChartTopic(topic) && timeframe) {
      const tfState = getTfState(current, timeframe);
      const bars = mergeBarsByTime(tfState.bars, snapshot?.bars || []);
      this.#commit(topic, {
        ...current,
        status: bars.length || stateHasBars(current) ? "READY" : current.status,
        lastUpdatedAt: Date.now(),
        version: Date.now(),
        timeframes: {
          ...(current.timeframes || {}),
          [timeframe]: {
            ...tfState,
            timeframe,
            status: bars.length ? "READY" : tfState.status,
            bars,
            error: "",
            lastPrice:
              Number(snapshot?.lastPrice) ||
              Number(bars[bars.length - 1]?.close) ||
              tfState.lastPrice,
            metadata:
              snapshot?.metadata && typeof snapshot.metadata === "object"
                ? {
                    ...(tfState.metadata && typeof tfState.metadata === "object"
                      ? tfState.metadata
                      : {}),
                    ...snapshot.metadata,
                  }
                : tfState.metadata,
            lastEventType: "history_merge",
            lastUpdatedAt: Date.now(),
            version: Date.now(),
          },
        },
      });
      return;
    }
    const bars = mergeBarsByTime(current.bars, snapshot?.bars || []);
    const mergedRange =
      normalizeRange(snapshot?.range) ||
      barsToRange(snapshot?.bars || []) ||
      barsToRange(bars);
    this.#commit(topic, {
      ...current,
      status: bars.length ? "READY" : current.status,
      bars,
      lastPrice: Number(snapshot?.lastPrice) || Number(bars[bars.length - 1]?.close) || current.lastPrice,
      metadata:
        snapshot?.metadata && typeof snapshot.metadata === "object"
          ? {
              ...(current.metadata && typeof current.metadata === "object" ? current.metadata : {}),
              ...snapshot.metadata,
            }
          : current.metadata,
      lastEventType: "history_merge",
      lastUpdatedAt: Date.now(),
      loadedHistoryRanges: mergeRanges(current.loadedHistoryRanges, mergedRange),
      exhaustedHistoryRanges: current.exhaustedHistoryRanges,
      pendingHistoryRequests: current.pendingHistoryRequests,
      version: Date.now(),
    });
  }

  isHistoryRangeExhausted(topic, range = {}) {
    const normalized = normalizeRange(range);
    if (!normalized) return false;
    return this.getState(topic).exhaustedHistoryRanges.some(
      (candidate) =>
        Number(candidate?.startSec) <= normalized.startSec &&
        Number(candidate?.endSec) >= normalized.endSec,
    );
  }

  isHistoryRangeLoaded(topic, range = {}) {
    const normalized = normalizeRange(range);
    if (!normalized) return false;
    return this.getState(topic).loadedHistoryRanges.some(
      (candidate) =>
        Number(candidate?.startSec) <= normalized.startSec &&
        Number(candidate?.endSec) >= normalized.endSec,
    );
  }

  beginHistoryRequest(topic, request = {}) {
    const key = String(request?.key || "").trim();
    const normalized = normalizeRange(request);
    if (!key || !normalized) {
      return { accepted: false, reason: "invalid_request" };
    }
    const current = this.getState(topic);
    if (this.isHistoryRangeLoaded(topic, normalized)) {
      return { accepted: false, reason: "already_loaded" };
    }
    if (this.isHistoryRangeExhausted(topic, normalized)) {
      return { accepted: false, reason: "history_exhausted" };
    }
    if ((current.pendingHistoryRequests || []).some((entry) => rangesOverlap(entry, normalized))) {
      return { accepted: false, reason: "pending_overlap" };
    }
    this.#commit(topic, {
      ...current,
      pendingHistoryRequests: [
        ...(Array.isArray(current.pendingHistoryRequests) ? current.pendingHistoryRequests : []),
        {
          key,
          startSec: normalized.startSec,
          endSec: normalized.endSec,
          requestedAt: Date.now(),
        },
      ],
      lastUpdatedAt: Date.now(),
    });
    return { accepted: true, key };
  }

  completeHistoryRequest(topic, requestKey, snapshot = null) {
    const current = this.getState(topic);
    const nextPending = (Array.isArray(current.pendingHistoryRequests) ? current.pendingHistoryRequests : [])
      .filter((entry) => String(entry?.key || "") !== String(requestKey || ""));
    this.#commit(topic, {
      ...current,
      pendingHistoryRequests: nextPending,
      lastUpdatedAt: Date.now(),
    });
    if (snapshot?.bars?.length) {
      this.mergeHistory(topic, snapshot);
    }
  }

  failHistoryRequest(topic, requestKey) {
    const current = this.getState(topic);
    const nextPending = (Array.isArray(current.pendingHistoryRequests) ? current.pendingHistoryRequests : [])
      .filter((entry) => String(entry?.key || "") !== String(requestKey || ""));
    this.#commit(topic, {
      ...current,
      pendingHistoryRequests: nextPending,
      lastUpdatedAt: Date.now(),
    });
  }

  markHistoryExhausted(topic, range = {}, metadata = null) {
    const normalized = normalizeRange(range);
    if (!normalized) return;
    const current = this.getState(topic);
    this.#commit(topic, {
      ...current,
      metadata:
        metadata && typeof metadata === "object"
          ? {
              ...(current.metadata && typeof current.metadata === "object" ? current.metadata : {}),
              ...metadata,
            }
          : current.metadata,
      exhaustedHistoryRanges: mergeRanges(current.exhaustedHistoryRanges, normalized),
      lastUpdatedAt: Date.now(),
    });
  }

  setError(topic, error, timeframe = "") {
    const current = this.getState(topic);
    const tfKey = normalizeChartTimeframe(timeframe);
    if (isSymbolChartTopic(topic) && tfKey) {
      const tfState = getTfState(current, tfKey);
      this.#commit(topic, {
        ...current,
        connected: false,
        connectionState: current.everConnected ? "error" : "idle",
        status: stateHasBars(current) ? current.status : "ERROR",
        error: String(error || "Unknown realtime error"),
        lastUpdatedAt: Date.now(),
        timeframes: {
          ...(current.timeframes || {}),
          [tfKey]: {
            ...tfState,
            timeframe: tfKey,
            status: "ERROR",
            error: String(error || "Unknown realtime error"),
            lastUpdatedAt: Date.now(),
          },
        },
      });
      return;
    }
    this.#commit(topic, {
      ...current,
      connected: false,
      connectionState: current.everConnected ? "error" : "idle",
      status: "ERROR",
      error: String(error || "Unknown realtime error"),
      lastUpdatedAt: Date.now(),
    });
  }

  applyEnvelope(envelope) {
    const topic = String(envelope?.topic || "").trim();
    if (!topic) return;
    const current = this.getState(topic);
    const nextVersion = Number(envelope?.version) || Date.now();
    if (nextVersion < Number(current.version || 0)) return;
    const type = String(envelope?.type || "").trim();
    const payload = envelope?.data || {};

    if (type === "connected") {
      this.#commit(topic, {
        ...current,
        connected: true,
        connectionState: "connected",
        everConnected: true,
        status: stateHasBars(current) ? "READY" : "CONNECTING",
        lastEventType: type,
        lastUpdatedAt: Date.now(),
        lastConnectedAt: Date.now(),
        version: nextVersion,
      });
      return;
    }

    if (type === "snapshot") {
      this.setBootstrap(topic, payload);
      return;
    }

    const timeframe = normalizeChartTimeframe(payload?.timeframe);
    if (isSymbolChartTopic(topic) && timeframe) {
      const tfState = getTfState(current, timeframe);
      if (type === "bar_update") {
        const nextBars = cloneBars(tfState.bars);
        const nextBar =
          payload?.bar && typeof payload.bar === "object" ? { ...payload.bar } : null;
        if (!nextBar) return;
        if (!nextBars.length) {
          nextBars.push(nextBar);
        } else {
          const lastIndex = nextBars.length - 1;
          const lastBar = nextBars[lastIndex];
          if (Number(lastBar?.time) === Number(nextBar.time)) {
            nextBars[lastIndex] = nextBar;
          } else if (Number(lastBar?.time) < Number(nextBar.time)) {
            nextBars.push(nextBar);
          } else {
            return;
          }
        }
        this.#commit(topic, {
          ...current,
          status: "READY",
          connected: true,
          connectionState: "connected",
          everConnected: true,
          error: "",
          lastEventType: type,
          lastUpdatedAt: Date.now(),
          lastDataAt: Date.now(),
          version: nextVersion,
          timeframes: {
            ...(current.timeframes || {}),
            [timeframe]: {
              ...tfState,
              timeframe,
              status: "READY",
              error: "",
              bars: nextBars,
              lastPrice: Number(nextBar?.close) || tfState.lastPrice,
              metadata: payload?.metadata || tfState.metadata,
              lastEventType: type,
              lastUpdatedAt: Date.now(),
              lastDataAt: Date.now(),
              version: nextVersion,
            },
          },
        });
        return;
      }

      if (type === "price_tick" || type === "price_update") {
        this.#commit(topic, {
          ...current,
          status: stateHasBars(current) ? "READY" : current.status,
          connected: true,
          connectionState: "connected",
          everConnected: true,
          lastEventType: type,
          lastUpdatedAt: Date.now(),
          lastDataAt: Date.now(),
          version: nextVersion,
          timeframes: {
            ...(current.timeframes || {}),
            [timeframe]: {
              ...tfState,
              timeframe,
              status: tfState.bars.length ? "READY" : tfState.status,
              lastPrice: Number(payload?.lastPrice) || tfState.lastPrice,
              lastEventType: type,
              lastUpdatedAt: Date.now(),
              lastDataAt: Date.now(),
              version: nextVersion,
            },
          },
        });
        return;
      }

      if (type === "error") {
        this.setError(topic, payload?.message || "Realtime stream error", timeframe);
        return;
      }
    }

    if (type === "bar_update") {
      const nextBars = cloneBars(current.bars);
      const nextBar = payload?.bar && typeof payload.bar === "object" ? { ...payload.bar } : null;
      if (!nextBar) return;
      if (!nextBars.length) {
        nextBars.push(nextBar);
      } else {
        const lastIndex = nextBars.length - 1;
        const lastBar = nextBars[lastIndex];
        if (Number(lastBar?.time) === Number(nextBar.time)) {
          nextBars[lastIndex] = nextBar;
        } else if (Number(lastBar?.time) < Number(nextBar.time)) {
          nextBars.push(nextBar);
        } else {
          return;
        }
      }
      this.#commit(topic, {
        ...current,
        status: "READY",
        connected: true,
        connectionState: "connected",
        everConnected: true,
        error: "",
        bars: nextBars,
        lastPrice: Number(nextBar?.close) || current.lastPrice,
        metadata: payload?.metadata || current.metadata,
        lastEventType: type,
        lastUpdatedAt: Date.now(),
        lastDataAt: Date.now(),
        loadedHistoryRanges: mergeRanges(current.loadedHistoryRanges, barsToRange(nextBars)),
        version: nextVersion,
      });
      return;
    }

    if (type === "price_tick" || type === "price_update") {
      this.#commit(topic, {
        ...current,
        status: current.bars.length ? "READY" : current.status,
        connected: true,
        connectionState: "connected",
        everConnected: true,
        lastPrice: Number(payload?.lastPrice) || current.lastPrice,
        lastEventType: type,
        lastUpdatedAt: Date.now(),
        lastDataAt: Date.now(),
        version: nextVersion,
      });
      return;
    }

    if (type === "error") {
      this.#commit(topic, {
        ...current,
        connected: false,
        connectionState: current.everConnected ? "error" : "idle",
        status: "ERROR",
        error: String(payload?.message || "Realtime stream error"),
        lastEventType: type,
        lastUpdatedAt: Date.now(),
        version: nextVersion,
      });
    }
  }

  #commit(topic, state) {
    this.topicState.set(topic, state);
    const set = this.listeners.get(topic);
    if (!set?.size) return;
    for (const listener of set) {
      listener(state);
    }
  }
}
