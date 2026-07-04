export class ReplaySessionStore {
  constructor() {
    this.sessionState = new Map();
    this.listeners = new Map();
  }

  getState(sessionId) {
    return (
      this.sessionState.get(sessionId) || {
        sessionId,
        status: "IDLE",
        connected: false,
        error: "",
        session: null,
      }
    );
  }

  subscribe(sessionId, listener) {
    const key = String(sessionId || "").trim();
    if (!key || typeof listener !== "function") return () => {};
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

  setBootstrap(session) {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId) return;
    this.#commit(sessionId, {
      sessionId,
      status: "READY",
      connected: this.getState(sessionId).connected,
      error: "",
      session,
    });
  }

  setConnected(sessionId, connected) {
    const current = this.getState(sessionId);
    this.#commit(sessionId, {
      ...current,
      connected: Boolean(connected),
      status: current.status === "IDLE" ? "CONNECTING" : current.status,
    });
  }

  setError(sessionId, error) {
    const current = this.getState(sessionId);
    this.#commit(sessionId, {
      ...current,
      status: "ERROR",
      error: String(error || "Replay error"),
    });
  }

  applyEnvelope(envelope) {
    const payload = envelope?.data;
    const sessionId = String(payload?.sessionId || "").trim();
    if (!sessionId) return;
    if (String(envelope?.type || "") === "replay_state") {
      this.#commit(sessionId, {
        sessionId,
        status: "READY",
        connected: true,
        error: "",
        session: payload,
      });
      return;
    }
    if (String(envelope?.type || "") === "error") {
      this.setError(sessionId, payload?.message || "Replay stream error");
    }
  }

  #commit(sessionId, state) {
    this.sessionState.set(sessionId, state);
    const set = this.listeners.get(sessionId);
    if (!set?.size) return;
    for (const listener of set) listener(state);
  }
}
