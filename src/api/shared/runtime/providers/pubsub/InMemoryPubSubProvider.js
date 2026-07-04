import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  emitRealtimeTopic,
  registerRealtimeBroadcaster,
} = require("../../../../modules/42trade/realtime/realtimeTopicHub.js");

function normalizeTopic(topic) {
  return String(topic || "").trim();
}

function registerTopicBroadcaster(topic, deliver) {
  const expectedTopic = normalizeTopic(topic);
  if (!expectedTopic || typeof deliver !== "function") {
    const noop = () => {};
    noop.unsubscribe = noop;
    noop.ready = Promise.resolve();
    return noop;
  }
  const unsubscribe = registerRealtimeBroadcaster((publishedTopic, envelope) => {
    if (publishedTopic !== expectedTopic) return 0;
    deliver(envelope);
    return 1;
  });
  unsubscribe.unsubscribe = unsubscribe;
  unsubscribe.ready = Promise.resolve();
  return unsubscribe;
}

export class InMemoryPubSubProvider {
  constructor() {
    this.id = "memory";
  }

  async publish(topic, envelope) {
    return emitRealtimeTopic(topic, envelope);
  }

  subscribe(topic, listener) {
    return registerTopicBroadcaster(topic, listener);
  }

  registerStreamSink(topic, sink) {
    return registerTopicBroadcaster(topic, sink);
  }

  getStatus() {
    return {
      id: this.id,
      ready: true,
    };
  }
}
