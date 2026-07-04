export class TopicRouter {
  constructor() {
    this.topicListeners = new Map();
  }

  subscribe(topic, listener) {
    const key = String(topic || "").trim();
    if (!key || typeof listener !== "function") {
      return () => {};
    }
    const set = this.topicListeners.get(key) || new Set();
    set.add(listener);
    this.topicListeners.set(key, set);
    return () => {
      const nextSet = this.topicListeners.get(key);
      if (!nextSet) return;
      nextSet.delete(listener);
      if (!nextSet.size) this.topicListeners.delete(key);
    };
  }

  publish(envelope) {
    const topic = String(envelope?.topic || "").trim();
    if (!topic) return;
    const set = this.topicListeners.get(topic);
    if (!set?.size) return;
    for (const listener of set) {
      listener(envelope);
    }
  }
}
