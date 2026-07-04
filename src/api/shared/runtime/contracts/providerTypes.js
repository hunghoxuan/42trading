export const PROVIDER_DOMAINS = Object.freeze([
  "automation",
  "streaming",
  "pubsub",
  "cache",
]);

export const PROVIDER_IDS = Object.freeze({
  automation: Object.freeze({
    node_timer: "node_timer",
    bullmq: "bullmq",
  }),
  streaming: Object.freeze({
    socketio: "socketio",
    sse: "sse",
  }),
  pubsub: Object.freeze({
    memory: "memory",
    redis: "redis",
  }),
  cache: Object.freeze({
    memory: "memory",
    redis: "redis",
  }),
});
