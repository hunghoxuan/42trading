import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const realtimeCore = require("../src/api/realtime/realtimeCore.js");

test("realtimeCore exposes mt5 topics and parses broker aliases as mt5", () => {
  assert.equal(realtimeCore.buildMt5Topic("self"), "mt5:self");
  assert.equal(realtimeCore.buildTradeTopic("TRD_123"), "trade:TRD_123");

  assert.deepEqual(realtimeCore.parseTopic("mt5:self"), {
    kind: "mt5",
    topic: "mt5:self",
    userId: "self",
  });

  assert.deepEqual(realtimeCore.parseTopic("broker:self"), {
    kind: "mt5",
    topic: "mt5:self",
    userId: "self",
  });
});
