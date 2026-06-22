import { RealtimeTransportProvider } from "./RealtimeTransportProvider";

export class SseTransportProvider extends RealtimeTransportProvider {
  constructor({ buildUrl, reconnectDelayMs = 3000 } = {}) {
    super();
    this.buildUrl = buildUrl;
    this.reconnectDelayMs = reconnectDelayMs;
    this.connections = new Map();
  }

  subscribe(topic, params = {}, handlers = {}) {
    const key = String(topic || "").trim();
    if (!key) throw new Error("topic is required");
    if (!this.buildUrl) throw new Error("buildUrl is required");
    const entry = this.connections.get(key) || this.#createEntry(key, params);
    entry.params = { ...(entry.params || {}), ...(params || {}) };
    if (typeof handlers.onOpen === "function") entry.onOpen.add(handlers.onOpen);
    if (typeof handlers.onMessage === "function") entry.onMessage.add(handlers.onMessage);
    if (typeof handlers.onError === "function") entry.onError.add(handlers.onError);
    this.connections.set(key, entry);
    if (!entry.eventSource) this.#connect(entry);
    return () => this.#unsubscribe(key, handlers);
  }

  disconnectTopic(topic) {
    const key = String(topic || "").trim();
    const entry = this.connections.get(key);
    if (!entry) return;
    this.#closeEntry(entry);
    this.connections.delete(key);
  }

  disconnectAll() {
    for (const entry of this.connections.values()) {
      this.#closeEntry(entry);
    }
    this.connections.clear();
  }

  #createEntry(topic, params) {
    return {
      topic,
      params: { ...(params || {}) },
      eventSource: null,
      reconnectTimer: null,
      onOpen: new Set(),
      onMessage: new Set(),
      onError: new Set(),
      manuallyClosed: false,
    };
  }

  #unsubscribe(topic, handlers = {}) {
    const entry = this.connections.get(topic);
    if (!entry) return;
    if (typeof handlers.onOpen === "function") entry.onOpen.delete(handlers.onOpen);
    if (typeof handlers.onMessage === "function") entry.onMessage.delete(handlers.onMessage);
    if (typeof handlers.onError === "function") entry.onError.delete(handlers.onError);
    if (!entry.onOpen.size && !entry.onMessage.size && !entry.onError.size) {
      this.disconnectTopic(topic);
    }
  }

  #closeEntry(entry) {
    entry.manuallyClosed = true;
    if (entry.reconnectTimer) {
      window.clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
    if (entry.eventSource) {
      entry.eventSource.close();
      entry.eventSource = null;
    }
  }

  #connect(entry) {
    entry.manuallyClosed = false;
    const es = new EventSource(this.buildUrl(entry.topic, entry.params), {
      withCredentials: true,
    });
    entry.eventSource = es;
    es.onopen = () => {
      for (const listener of entry.onOpen) {
        listener({ topic: entry.topic, transport: "sse" });
      }
    };
    es.onmessage = (event) => {
      if (!event?.data) return;
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        payload = {
          topic: entry.topic,
          type: "message",
          data: event.data,
          ts: Date.now(),
          version: Date.now(),
        };
      }
      for (const listener of entry.onMessage) {
        listener(payload);
      }
    };
    es.onerror = (error) => {
      for (const listener of entry.onError) {
        listener(error);
      }
      if (entry.eventSource) {
        entry.eventSource.close();
        entry.eventSource = null;
      }
      if (entry.manuallyClosed) return;
      if (entry.reconnectTimer) window.clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = window.setTimeout(() => {
        entry.reconnectTimer = null;
        if (!entry.manuallyClosed) this.#connect(entry);
      }, this.reconnectDelayMs);
    };
  }
}
