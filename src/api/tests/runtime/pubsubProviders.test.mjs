import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import { createRequire } from "node:module";
import test from "node:test";

import { createAppRuntime } from "../../shared/runtime/bootstrap/createAppRuntime.js";
import { InMemoryPubSubProvider } from "../../shared/runtime/providers/pubsub/InMemoryPubSubProvider.js";
import { RedisPubSubProvider } from "../../shared/runtime/providers/pubsub/RedisPubSubProvider.js";

const require = createRequire(import.meta.url);
const {
  emitRealtimeTopic,
} = require("../../modules/42trade/realtime/realtimeTopicHub.js");
const { createRealtimeSocketServer } = require("../../modules/42trade/realtime/realtimeSocketServer.js");
const adminRequire = createRequire(new URL("../../../admin/package.json", import.meta.url));
const { io: createSocketIoClient } = adminRequire("socket.io-client");

function createFakeRedisClientFactory() {
  const states = [];

  return {
    states,
    createClient(options = {}) {
      const state = {
        options,
        connectError: options.connectError || null,
        subscribeError: options.subscribeError || null,
        published: [],
        subscriptions: new Map(),
        unsubscribed: [],
        quitCalls: 0,
        disconnectCalls: 0,
      };
      const client = {
        async connect() {
          if (state.connectError) {
            throw state.connectError;
          }
        },
        async publish(channel, message) {
          state.published.push({ channel, message });
          return 1;
        },
        async subscribe(channel, handler) {
          if (state.subscribeError) {
            throw state.subscribeError;
          }
          state.subscriptions.set(channel, handler);
          return state.subscriptions.size;
        },
        async unsubscribe(channel) {
          state.unsubscribed.push(channel);
          state.subscriptions.delete(channel);
          return 0;
        },
        async quit() {
          state.quitCalls += 1;
        },
        async disconnect() {
          state.disconnectCalls += 1;
        },
      };

      state.client = client;
      states.push(state);
      return client;
    },
  };
}

async function waitFor(check, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("InMemoryPubSubProvider delivers published envelopes to subscribers", async () => {
  const provider = new InMemoryPubSubProvider();
  const seen = [];
  const unsubscribe = provider.subscribe("chart:BTCUSD:15m", (envelope) => {
    seen.push(envelope);
  });

  await provider.publish("chart:BTCUSD:15m", { type: "bar_update", data: { close: 100 } });
  unsubscribe();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, "bar_update");
  assert.equal(seen[0].data.close, 100);
});

test("InMemoryPubSubProvider subscribers receive envelopes published through realtimeTopicHub", () => {
  const provider = new InMemoryPubSubProvider();
  const seen = [];
  const unsubscribe = provider.subscribe("chart:BTCUSD:15m", (envelope) => {
    seen.push(envelope);
  });

  const delivered = emitRealtimeTopic("chart:BTCUSD:15m", {
    type: "bar_update",
    data: { close: 101 },
  });
  unsubscribe();

  assert.equal(delivered, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].data.close, 101);
});

test("InMemoryPubSubProvider isolates listener failures and still delivers to later listeners", async () => {
  const provider = new InMemoryPubSubProvider();
  const seen = [];
  const unsubscribeThrowing = provider.subscribe("chart:BTCUSD:15m", () => {
    throw new Error("listener failed");
  });
  const unsubscribeHealthy = provider.subscribe("chart:BTCUSD:15m", (envelope) => {
    seen.push(envelope);
  });

  const delivered = await provider.publish("chart:BTCUSD:15m", {
    type: "bar_update",
    data: { close: 102 },
  });
  unsubscribeThrowing();
  unsubscribeHealthy();

  assert.equal(delivered, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].data.close, 102);
});

test("InMemoryPubSubProvider forwards published envelopes to registered stream sinks", async () => {
  const provider = new InMemoryPubSubProvider();
  const seen = [];
  const unregister = provider.registerStreamSink("chart:ETHUSD:5m", (envelope) => {
    seen.push(envelope);
  });

  await provider.publish("chart:ETHUSD:5m", {
    type: "connected",
    data: { topic: "chart:ETHUSD:5m" },
  });
  unregister();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, "connected");
});

test("runtime pubsub publish can be used by market-data producers", async () => {
  const provider = new InMemoryPubSubProvider();
  const published = [];
  const unregister = provider.registerStreamSink("chart:BTCUSD:1m", (envelope) => {
    published.push(envelope);
  });

  await provider.publish("chart:BTCUSD:1m", {
    type: "bar_update",
    data: { close: 1 },
  });
  unregister();

  assert.equal(published.length, 1);
  assert.equal(published[0].type, "bar_update");
  assert.equal(published[0].data.close, 1);
});

test("RedisPubSubProvider publishes JSON envelopes to the normalized Redis topic", async () => {
  const redis = createFakeRedisClientFactory();
  const provider = new RedisPubSubProvider({
    url: "redis://example.test:6379",
    createClient: redis.createClient,
  });
  const envelope = {
    type: "bar_update",
    data: { close: 110 },
  };

  const delivered = await provider.publish(" chart:BTCUSD:15m ", envelope);

  assert.equal(delivered, 1);
  assert.equal(redis.states.length, 1);
  assert.deepEqual(redis.states[0].options, {
    url: "redis://example.test:6379",
  });
  assert.deepEqual(redis.states[0].published, [
    {
      channel: "chart:BTCUSD:15m",
      message: JSON.stringify(envelope),
    },
  ]);

  await provider.close();
  assert.equal(redis.states[0].quitCalls, 1);
});

test("RedisPubSubProvider subscribes and cleans up topic listeners", async () => {
  const redis = createFakeRedisClientFactory();
  const provider = new RedisPubSubProvider({
    createClient: redis.createClient,
  });
  const seen = [];
  const unsubscribe = provider.registerStreamSink("chart:ETHUSD:5m", (envelope) => {
    seen.push(envelope);
  });

  await waitFor(() => redis.states[0]?.subscriptions.has("chart:ETHUSD:5m"));
  const handler = redis.states[0].subscriptions.get("chart:ETHUSD:5m");
  handler(
    JSON.stringify({
      topic: "chart:ETHUSD:5m",
      type: "connected",
      data: { topic: "chart:ETHUSD:5m" },
    }),
  );
  unsubscribe();
  await waitFor(() => redis.states[0].unsubscribed.includes("chart:ETHUSD:5m"));

  assert.deepEqual(seen, [
    {
      topic: "chart:ETHUSD:5m",
      type: "connected",
      data: { topic: "chart:ETHUSD:5m" },
    },
  ]);
  assert.deepEqual(redis.states[0].unsubscribed, ["chart:ETHUSD:5m"]);
  assert.equal(redis.states[0].quitCalls, 1);
});

test("createAppRuntime closes the selected Redis pubsub provider through runtime.close", async () => {
  const redis = createFakeRedisClientFactory();
  const runtime = createAppRuntime({
    env: {
      PUBSUB_PROVIDER: "redis",
    },
    pubsub: {
      redis: {
        createClient: redis.createClient,
      },
    },
  });

  await runtime.pubsub.publish("chart:BTCUSD:15m", {
    type: "bar_update",
    data: { close: 112 },
  });
  runtime.pubsub.registerStreamSink("chart:BTCUSD:15m", () => {});
  await waitFor(() => redis.states[1]?.subscriptions.has("chart:BTCUSD:15m"));

  await runtime.close();

  assert.equal(redis.states[0].quitCalls, 1);
  assert.equal(redis.states[1].quitCalls, 1);
});

test("createAppRuntime composes the default streaming and pubsub facades", () => {
  const runtime = createAppRuntime({ env: {} });

  assert.ok(runtime.pubsub);
  assert.equal(typeof runtime.pubsub.publish, "function");
  assert.equal(typeof runtime.pubsub.registerStreamSink, "function");
  assert.ok(runtime.streaming);
  assert.equal(typeof runtime.streaming.attach, "function");
});

test("createAppRuntime selects the Redis pubsub provider when PUBSUB_PROVIDER=redis", () => {
  const runtime = createAppRuntime({
    env: {
      PUBSUB_PROVIDER: "redis",
    },
  });

  assert.equal(runtime.config.providers.pubsub, "redis");
  assert.equal(runtime.pubsub.provider.constructor.name, "RedisPubSubProvider");
});

test("createAppRuntime exposes a real SSE topic stream seam", async () => {
  const runtime = createAppRuntime({
    env: {
      STREAMING_PROVIDER: "sse",
    },
  });

  const req = new EventEmitter();
  const writes = [];
  const res = {
    statusCode: 0,
    headers: null,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    write(chunk) {
      writes.push(String(chunk));
      return true;
    },
  };
  const stream = runtime.streaming.openTopicStream({
    req,
    res,
    topic: "chart:ETHUSD:5m",
    heartbeatMs: 1_000,
  });
  const registeredTopic = "chart:ETHUSD:5m";

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "text/event-stream");
  assert.equal(writes[0], ":ok\n\n");

  stream.registerTopic(registeredTopic);

  const delivered = await runtime.pubsub.publish(registeredTopic, {
    topic: registeredTopic,
    type: "bar_update",
    data: { close: 105 },
  });
  req.emit("close");

  assert.equal(delivered, 1);
  assert.ok(
    writes.some((chunk) => chunk.includes('"type":"bar_update"')),
  );
});

test("createAppRuntime routes SSE topic streams through the selected Redis pubsub provider", async () => {
  const redis = createFakeRedisClientFactory();
  const runtime = createAppRuntime({
    env: {
      STREAMING_PROVIDER: "sse",
      PUBSUB_PROVIDER: "redis",
    },
    pubsub: {
      redis: {
        createClient: redis.createClient,
      },
    },
  });

  const req = new EventEmitter();
  const writes = [];
  const res = {
    statusCode: 0,
    headers: null,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    write(chunk) {
      writes.push(String(chunk));
      return true;
    },
  };
  const registeredTopic = "chart:BTCUSD:15m";
  const stream = runtime.streaming.openTopicStream({
    req,
    res,
    topic: registeredTopic,
    heartbeatMs: 1_000,
  });

  stream.registerTopic(registeredTopic);
  await waitFor(() => redis.states[0]?.subscriptions.has(registeredTopic));

  assert.ok(redis.states[0]?.subscriptions.has(registeredTopic));

  const handler = redis.states[0].subscriptions.get(registeredTopic);
  handler(
    JSON.stringify({
      topic: registeredTopic,
      type: "bar_update",
      data: { close: 111 },
    }),
  );
  req.emit("close");
  await waitFor(() => redis.states[0].unsubscribed.includes(registeredTopic));

  assert.ok(
    writes.some((chunk) => chunk.includes('"type":"bar_update"')),
  );
  assert.deepEqual(redis.states[0].unsubscribed, [registeredTopic]);
});

test("createAppRuntime stops SSE topic streams when selected Redis pubsub subscription setup fails", async () => {
  const redis = createFakeRedisClientFactory();
  const runtime = createAppRuntime({
    env: {
      STREAMING_PROVIDER: "sse",
      PUBSUB_PROVIDER: "redis",
    },
    pubsub: {
      redis: {
        createClient(options = {}) {
          return redis.createClient({
            ...options,
            subscribeError: new Error("redis subscribe failed"),
          });
        },
      },
    },
  });

  const req = new EventEmitter();
  const writes = [];
  let stopCount = 0;
  let endCount = 0;
  const res = {
    statusCode: 0,
    headers: null,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    write(chunk) {
      writes.push(String(chunk));
      return true;
    },
    end() {
      endCount += 1;
    },
  };
  const stream = runtime.streaming.openTopicStream({
    req,
    res,
    topic: "chart:BTCUSD:15m",
    heartbeatMs: 1_000,
    onStop: () => {
      stopCount += 1;
    },
  });

  stream.registerTopic("chart:BTCUSD:15m");
  await waitFor(
    () =>
      stopCount > 0 ||
      writes.some((chunk) => chunk.includes("redis subscribe failed")),
  );

  assert.equal(stopCount, 1);
  assert.equal(endCount, 1);
  assert.ok(
    writes.some((chunk) => chunk.includes("redis subscribe failed")),
  );
});

test("createRealtimeSocketServer releases topic-scoped stream sinks on disconnect", async () => {
  const httpServer = http.createServer();
  await new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });

  let releaseCount = 0;
  const socketServer = createRealtimeSocketServer({
    httpServer,
    parseTopic: (topic) =>
      topic ? { topic: String(topic).trim(), kind: "chart" } : null,
    authorize: () => ({ ok: true }),
    getReplaySession: () => null,
    registerStreamSink: () => () => {
      releaseCount += 1;
    },
  });

  const address = httpServer.address();
  assert.ok(address && typeof address === "object");
  const client = createSocketIoClient(`http://127.0.0.1:${address.port}`, {
    path: "/socket.io",
    transports: ["websocket"],
  });

  try {
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });

    const subscribeAck = await new Promise((resolve) => {
      client.emit(
        "realtime:subscribe",
        { topic: "chart:BTCUSD:15m" },
        resolve,
      );
    });
    assert.deepEqual(subscribeAck, { ok: true, topic: "chart:BTCUSD:15m" });

    client.disconnect();

    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });

    assert.equal(releaseCount, 1);
  } finally {
    client.close();
    await socketServer.close();
    if (httpServer.listening) {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }
});

test("createRealtimeSocketServer handles chart history request acknowledgements", async () => {
  const httpServer = http.createServer();
  await new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });

  const socketServer = createRealtimeSocketServer({
    httpServer,
    parseTopic: (topic) =>
      topic ? { topic: String(topic).trim(), kind: "chart" } : null,
    authorize: () => ({ ok: true }),
    getReplaySession: () => null,
    registerStreamSink: () => () => {},
    requestChartHistory: async (payload) => ({
      requestId: payload.requestId,
      snapshot: {
        topic: payload.topic,
        bars: [
          { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
        ],
      },
    }),
  });

  const address = httpServer.address();
  assert.ok(address && typeof address === "object");
  const client = createSocketIoClient(`http://127.0.0.1:${address.port}`, {
    path: "/socket.io",
    transports: ["websocket"],
  });

  try {
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });

    const response = await new Promise((resolve) => {
      client.emit(
        "chart:history:request",
        {
          requestId: "req-1",
          topic: "chart:BTCUSD:15m",
          symbol: "BTCUSD",
          timeframe: "15m",
          visibleBars: 200,
        },
        resolve,
      );
    });

    assert.deepEqual(response, {
      ok: true,
      requestId: "req-1",
      snapshot: {
        topic: "chart:BTCUSD:15m",
        bars: [
          { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
        ],
      },
    });
  } finally {
    client.close();
    await socketServer.close();
    if (httpServer.listening) {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }
});
