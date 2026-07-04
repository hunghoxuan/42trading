import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const realtimeTopicHub = require("../src/api/realtime/realtimeTopicHub");

test("emitRealtimeTopic fans out to registered SSE clients and extra broadcasters", () => {
  const writes = [];
  const res = {
    write(chunk) {
      writes.push(chunk);
    },
  };
  const unregisterBroadcaster = realtimeTopicHub.registerRealtimeBroadcaster(
    (topic, envelope) => {
      assert.equal(topic, "chart:BTCUSD:15m");
      assert.equal(envelope.type, "bar_update");
      return 2;
    },
  );

  realtimeTopicHub.registerRealtimeTopic("chart:BTCUSD:15m", res);
  const delivered = realtimeTopicHub.emitRealtimeTopic("chart:BTCUSD:15m", {
    topic: "chart:BTCUSD:15m",
    type: "bar_update",
    data: { close: 1 },
  });

  assert.equal(delivered, 3);
  assert.equal(writes.length, 1);
  assert.match(writes[0], /bar_update/);

  realtimeTopicHub.removeRealtimeTopic("chart:BTCUSD:15m", res);
  unregisterBroadcaster();
});
