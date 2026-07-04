import { io } from "socket.io-client";
import { RealtimeTransportProvider } from "./RealtimeTransportProvider";

export class SocketIoTransportProvider extends RealtimeTransportProvider {
  constructor({ getConnectionOptions, ackTimeoutMs = 20000 } = {}) {
    super();
    this.getConnectionOptions = getConnectionOptions;
    this.ackTimeoutMs = ackTimeoutMs;
    this.socket = null;
    this.connectionState = "idle";
    this.topics = new Map();
    this.disconnectTimer = null;
    this.boundHandleConnect = () => this.#handleConnect();
    this.boundHandleDisconnect = (reason) => this.#handleDisconnect(reason);
    this.boundHandleConnectError = (error) => this.#handleConnectError(error);
    this.boundHandleRealtimeEvent = (envelope) => this.#handleRealtimeEvent(envelope);
  }

  subscribe(topic, params = {}, handlers = {}) {
    const key = String(topic || "").trim();
    if (!key) throw new Error("topic is required");
    if (typeof this.getConnectionOptions !== "function") {
      throw new Error("getConnectionOptions is required");
    }
    this.#cancelPendingDisconnect();
    const entry = this.topics.get(key) || this.#createEntry(key, params);
    entry.params = { ...(entry.params || {}), ...(params || {}) };
    if (typeof handlers.onOpen === "function") entry.onOpen.add(handlers.onOpen);
    if (typeof handlers.onMessage === "function") entry.onMessage.add(handlers.onMessage);
    if (typeof handlers.onError === "function") entry.onError.add(handlers.onError);
    this.topics.set(key, entry);
    this.#ensureSocket();
    if (this.connectionState === "connected") {
      this.#subscribeTopic(entry);
    }
    return () => this.#unsubscribe(key, handlers);
  }

  async requestChartHistory(payload = {}, { timeoutMs = this.ackTimeoutMs } = {}) {
    if (typeof this.getConnectionOptions !== "function") {
      throw new Error("getConnectionOptions is required");
    }
    this.#cancelPendingDisconnect();
    this.#ensureSocket();
    await this.#waitForConnection(timeoutMs);
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error("Chart history request timeout"));
      }, Math.max(250, Number(timeoutMs) || this.ackTimeoutMs));
      this.socket.emit("chart:history:request", payload, (response = {}) => {
        window.clearTimeout(timer);
        if (!response?.ok) {
          reject(new Error(response?.error || "Chart history request failed"));
          return;
        }
        resolve(response);
      });
    });
  }

  disconnectTopic(topic) {
    const key = String(topic || "").trim();
    const entry = this.topics.get(key);
    if (!entry) return;
    if (entry.pendingSubscribe) {
      window.clearTimeout(entry.pendingSubscribe);
      entry.pendingSubscribe = null;
    }
    this.topics.delete(key);
    if (this.socket && this.connectionState === "connected" && entry.subscribed) {
      this.socket.emit("realtime:unsubscribe", { topic: key });
    }
    if (!this.topics.size) {
      this.disconnectAll();
    }
  }

  disconnectAll() {
    for (const entry of this.topics.values()) {
      if (entry.pendingSubscribe) {
        window.clearTimeout(entry.pendingSubscribe);
        entry.pendingSubscribe = null;
      }
      entry.subscribed = false;
    }
    this.topics.clear();
    if (this.socket) {
      this.#scheduleDisconnect();
    } else {
      this.#cancelPendingDisconnect();
    }
    this.connectionState = "idle";
  }

  #createEntry(topic, params) {
    return {
      topic,
      params: { ...(params || {}) },
      onOpen: new Set(),
      onMessage: new Set(),
      onError: new Set(),
      subscribed: false,
      pendingSubscribe: null,
    };
  }

  #unsubscribe(topic, handlers = {}) {
    const entry = this.topics.get(topic);
    if (!entry) return;
    if (typeof handlers.onOpen === "function") entry.onOpen.delete(handlers.onOpen);
    if (typeof handlers.onMessage === "function") entry.onMessage.delete(handlers.onMessage);
    if (typeof handlers.onError === "function") entry.onError.delete(handlers.onError);
    if (!entry.onOpen.size && !entry.onMessage.size && !entry.onError.size) {
      this.disconnectTopic(topic);
    }
  }

  #ensureSocket() {
    this.#cancelPendingDisconnect();
    if (this.socket) return;
    const connectionOptions = this.getConnectionOptions() || {};
    this.socket = io(connectionOptions.url, {
      path: connectionOptions.path || "/socket.io",
      auth: connectionOptions.auth || {},
      withCredentials: true,
      autoConnect: true,
      transports: ["websocket", "polling"],
    });
    this.connectionState = "connecting";
    this.socket.on("connect", this.boundHandleConnect);
    this.socket.on("disconnect", this.boundHandleDisconnect);
    this.socket.on("connect_error", this.boundHandleConnectError);
    this.socket.on("realtime:event", this.boundHandleRealtimeEvent);
  }

  #cancelPendingDisconnect() {
    if (!this.disconnectTimer) return;
    window.clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }

  #scheduleDisconnect() {
    this.#cancelPendingDisconnect();
    this.disconnectTimer = window.setTimeout(() => {
      this.disconnectTimer = null;
      if (!this.socket || this.topics.size) return;
      this.socket.off("connect", this.boundHandleConnect);
      this.socket.off("disconnect", this.boundHandleDisconnect);
      this.socket.off("connect_error", this.boundHandleConnectError);
      this.socket.off("realtime:event", this.boundHandleRealtimeEvent);
      this.socket.disconnect();
      this.socket = null;
      this.connectionState = "idle";
    }, 150);
  }

  #handleConnect() {
    this.connectionState = "connected";
    for (const entry of this.topics.values()) {
      entry.subscribed = false;
      this.#subscribeTopic(entry);
    }
  }

  #handleDisconnect(reason) {
    this.connectionState = this.topics.size ? "connecting" : "idle";
    for (const entry of this.topics.values()) {
      entry.subscribed = false;
      if (entry.pendingSubscribe) {
        window.clearTimeout(entry.pendingSubscribe);
        entry.pendingSubscribe = null;
      }
      for (const listener of entry.onError) {
        listener({ type: "disconnect", message: "Realtime socket disconnected", reason });
      }
    }
  }

  #handleConnectError(error) {
    this.connectionState = "error";
    for (const entry of this.topics.values()) {
      entry.subscribed = false;
      if (entry.pendingSubscribe) {
        window.clearTimeout(entry.pendingSubscribe);
        entry.pendingSubscribe = null;
      }
      for (const listener of entry.onError) {
        listener({
          type: "connect_error",
          message:
            error instanceof Error ? error.message : String(error || "Realtime socket error"),
          error,
        });
      }
    }
  }

  #handleRealtimeEvent(envelope) {
    const topic = String(envelope?.topic || "").trim();
    if (!topic) return;
    const entry = this.topics.get(topic);
    if (!entry) return;
    for (const listener of entry.onMessage) {
      listener(envelope);
    }
  }

  #subscribeTopic(entry) {
    if (!this.socket || this.connectionState !== "connected") return;
    if (entry.subscribed || entry.pendingSubscribe) return;
    entry.pendingSubscribe = window.setTimeout(() => {
      entry.pendingSubscribe = null;
      for (const listener of entry.onError) {
        listener({ message: "Realtime subscribe timeout", topic: entry.topic });
      }
    }, this.ackTimeoutMs);
    this.socket.emit(
      "realtime:subscribe",
      {
        topic: entry.topic,
        ...entry.params,
      },
      (response = {}) => {
        if (entry.pendingSubscribe) {
          window.clearTimeout(entry.pendingSubscribe);
          entry.pendingSubscribe = null;
        }
        if (!this.topics.has(entry.topic)) return;
        if (!response?.ok) {
          for (const listener of entry.onError) {
            listener({
              type: "subscribe_error",
              message: response?.error || "Realtime subscribe failed",
              topic: entry.topic,
            });
          }
          return;
        }
        entry.subscribed = true;
        for (const listener of entry.onOpen) {
          listener({ topic: entry.topic, transport: "socket.io" });
        }
      },
    );
  }

  #waitForConnection(timeoutMs = this.ackTimeoutMs) {
    if (this.socket && this.connectionState === "connected") {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (error) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error || "Socket connection failed")));
      };
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("Socket connection timeout"));
      }, Math.max(250, Number(timeoutMs) || this.ackTimeoutMs));
      const cleanup = () => {
        window.clearTimeout(timer);
        this.socket?.off("connect", onConnect);
        this.socket?.off("connect_error", onError);
      };
      this.socket?.on("connect", onConnect);
      this.socket?.on("connect_error", onError);
    });
  }
}
