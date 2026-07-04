import assert from "node:assert/strict";
import test from "node:test";

import { ChartStreamStore } from "../../modules/42trade/realtime/stores/ChartStreamStore.js";

test("ChartStreamStore records a live connection and fresh data timestamps", () => {
  const store = new ChartStreamStore();
  const topic = "chart:BTCUSD:15m";

  store.setConnected(topic, true);
  store.applyEnvelope({
    topic,
    type: "bar_update",
    version: 1,
    data: {
      bar: { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    },
  });

  const state = store.getState(topic);
  assert.equal(state.connected, true);
  assert.equal(state.connectionState, "connected");
  assert.equal(state.everConnected, true);
  assert.equal(typeof state.lastDataAt, "number");
});

test("ChartStreamStore marks a topic disconnected after it had been live", () => {
  const store = new ChartStreamStore();
  const topic = "chart:BTCUSD:15m";

  store.setConnected(topic, true);
  store.setDisconnected(topic, "transport close");

  const state = store.getState(topic);
  assert.equal(state.connected, false);
  assert.equal(state.connectionState, "disconnected");
  assert.equal(state.everConnected, true);
  assert.equal(state.error, "transport close");
});

test("ChartStreamStore tracks loaded history ranges from bootstrap snapshots", () => {
  const store = new ChartStreamStore();
  const topic = "chart:BTCUSD:15m";

  store.setBootstrap(topic, {
    bars: [
      { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 200, open: 2, high: 3, low: 1.5, close: 2.5, volume: 20 },
      { time: 300, open: 2.5, high: 3.4, low: 2.4, close: 3.1, volume: 30 },
    ],
  });

  assert.equal(store.isHistoryRangeLoaded(topic, { startSec: 100, endSec: 300 }), true);
  assert.equal(store.isHistoryRangeLoaded(topic, { startSec: 50, endSec: 300 }), false);
});

test("ChartStreamStore suppresses duplicate overlapping in-flight history requests", () => {
  const store = new ChartStreamStore();
  const topic = "chart:BTCUSD:15m";

  const first = store.beginHistoryRequest(topic, {
    key: "req-1",
    startSec: 100,
    endSec: 300,
  });
  const duplicate = store.beginHistoryRequest(topic, {
    key: "req-2",
    startSec: 120,
    endSec: 280,
  });

  assert.equal(first.accepted, true);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, "pending_overlap");
});

test("ChartStreamStore merges completed history requests and clears pending entries", () => {
  const store = new ChartStreamStore();
  const topic = "chart:BTCUSD:15m";

  store.setBootstrap(topic, {
    bars: [
      { time: 200, open: 2, high: 3, low: 1.5, close: 2.5, volume: 20 },
      { time: 300, open: 2.5, high: 3.4, low: 2.4, close: 3.1, volume: 30 },
    ],
  });
  store.beginHistoryRequest(topic, {
    key: "req-1",
    startSec: 100,
    endSec: 199,
  });

  store.completeHistoryRequest(topic, "req-1", {
    bars: [
      { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 200, open: 2, high: 3, low: 1.5, close: 2.5, volume: 20 },
    ],
  });

  const state = store.getState(topic);
  assert.deepEqual(
    state.bars.map((bar) => Number(bar.time)),
    [100, 200, 300],
  );
  assert.equal(state.pendingHistoryRequests.length, 0);
  assert.equal(store.isHistoryRangeLoaded(topic, { startSec: 100, endSec: 300 }), true);
});

test("ChartStreamStore clears failed history requests so the same range can be retried", () => {
  const store = new ChartStreamStore();
  const topic = "chart:BTCUSD:15m:anchor:1700000000";

  const first = store.beginHistoryRequest(topic, {
    key: "req-1",
    startSec: 100,
    endSec: 300,
  });
  store.failHistoryRequest(topic, "req-1");
  const retry = store.beginHistoryRequest(topic, {
    key: "req-2",
    startSec: 100,
    endSec: 300,
  });

  assert.equal(first.accepted, true);
  assert.equal(retry.accepted, true);
  assert.equal(store.getState(topic).pendingHistoryRequests.length, 1);
});

test("ChartStreamStore keeps anchored history tracking isolated from the live topic", () => {
  const store = new ChartStreamStore();
  const liveTopic = "chart:BTCUSD:15m";
  const anchoredTopic = "chart:BTCUSD:15m:anchor:1700000000";

  store.setBootstrap(liveTopic, {
    bars: [
      { time: 200, open: 2, high: 3, low: 1.5, close: 2.5, volume: 20 },
      { time: 300, open: 2.5, high: 3.4, low: 2.4, close: 3.1, volume: 30 },
    ],
  });

  const anchoredRequest = store.beginHistoryRequest(anchoredTopic, {
    key: "req-1",
    startSec: 100,
    endSec: 199,
  });

  assert.equal(anchoredRequest.accepted, true);
  assert.equal(store.getState(liveTopic).pendingHistoryRequests.length, 0);
  assert.equal(store.getState(anchoredTopic).pendingHistoryRequests.length, 1);
});

test("ChartStreamStore suppresses history requests once a range is marked exhausted", () => {
  const store = new ChartStreamStore();
  const topic = "chart:BTCUSD:15m:anchor:1700000000";

  store.markHistoryExhausted(
    topic,
    { startSec: 100, endSec: 300 },
    { history_exhausted: true, history_status: "exhausted" },
  );

  const retry = store.beginHistoryRequest(topic, {
    key: "req-2",
    startSec: 100,
    endSec: 300,
  });

  assert.equal(retry.accepted, false);
  assert.equal(retry.reason, "history_exhausted");
  assert.equal(store.getState(topic).metadata.history_status, "exhausted");
});
