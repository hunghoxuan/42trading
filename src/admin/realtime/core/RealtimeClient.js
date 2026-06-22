import { TopicRouter } from "./TopicRouter";

export class RealtimeClient {
  constructor(provider) {
    this.provider = provider;
    this.router = new TopicRouter();
    this.providerUnsubscribers = new Map();
  }

  subscribe(topic, params = {}, listener = () => {}, lifecycle = {}) {
    const key = String(topic || "").trim();
    if (!key) throw new Error("topic is required");
    const unsubscribeRouter = this.router.subscribe(key, listener);
    if (!this.providerUnsubscribers.has(key)) {
      const disconnectProvider = this.provider.subscribe(key, params, {
        onOpen: lifecycle.onOpen,
        onError: lifecycle.onError,
        onMessage: (payload) => {
          const envelope = this.normalizeEnvelope(key, payload);
          this.router.publish(envelope);
        },
      });
      this.providerUnsubscribers.set(key, disconnectProvider);
    }
    return () => {
      unsubscribeRouter();
      if (!this.router.topicListeners.has(key)) {
        const disconnectProvider = this.providerUnsubscribers.get(key);
        if (typeof disconnectProvider === "function") disconnectProvider();
        this.providerUnsubscribers.delete(key);
        this.provider.disconnectTopic(key);
      }
    };
  }

  normalizeEnvelope(topic, payload) {
    const input = payload && typeof payload === "object" ? payload : {};
    return {
      topic: String(input.topic || topic || "").trim(),
      type: String(input.type || "message").trim(),
      version: Number(input.version) || Date.now(),
      ts: Number(input.ts) || Date.now(),
      transport: String(input.transport || "unknown"),
      data: input.data,
    };
  }

  disconnectAll() {
    this.provider.disconnectAll();
    this.providerUnsubscribers.clear();
  }
}
