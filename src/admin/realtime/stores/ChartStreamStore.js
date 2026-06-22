function cloneBars(bars = []) {
  return (Array.isArray(bars) ? bars : []).map((bar) => ({ ...bar }));
}

export class ChartStreamStore {
  constructor() {
    this.topicState = new Map();
    this.listeners = new Map();
  }

  getState(topic) {
    return (
      this.topicState.get(topic) || {
        topic,
        status: "IDLE",
        connected: false,
        bars: [],
        error: "",
        lastPrice: null,
        metadata: null,
        lastEventType: "",
        lastUpdatedAt: null,
        version: 0,
      }
    );
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
    this.#commit(topic, {
      ...current,
      connected: Boolean(connected),
      status: current.status === "IDLE" ? "CONNECTING" : current.status,
    });
  }

  setBootstrap(topic, snapshot) {
    const bars = cloneBars(snapshot?.bars || []);
    this.#commit(topic, {
      topic,
      status: bars.length ? "READY" : "EMPTY",
      connected: this.getState(topic).connected,
      bars,
      error: "",
      lastPrice: Number(snapshot?.lastPrice) || Number(bars[bars.length - 1]?.close) || null,
      metadata: snapshot?.metadata || null,
      lastEventType: "bootstrap",
      lastUpdatedAt: Date.now(),
      version: Date.now(),
    });
  }

  setError(topic, error) {
    const current = this.getState(topic);
    this.#commit(topic, {
      ...current,
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
        status: current.bars.length ? "READY" : "CONNECTING",
        lastEventType: type,
        lastUpdatedAt: Date.now(),
        version: nextVersion,
      });
      return;
    }

    if (type === "snapshot") {
      this.setBootstrap(topic, payload);
      return;
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
        error: "",
        bars: nextBars,
        lastPrice: Number(nextBar?.close) || current.lastPrice,
        metadata: payload?.metadata || current.metadata,
        lastEventType: type,
        lastUpdatedAt: Date.now(),
        version: nextVersion,
      });
      return;
    }

    if (type === "price_tick") {
      this.#commit(topic, {
        ...current,
        status: current.bars.length ? "READY" : current.status,
        connected: true,
        lastPrice: Number(payload?.lastPrice) || current.lastPrice,
        lastEventType: type,
        lastUpdatedAt: Date.now(),
        version: nextVersion,
      });
      return;
    }

    if (type === "error") {
      this.#commit(topic, {
        ...current,
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
