import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildTradeRealtimeEnvelope,
  emitTradeRealtimeUpdate,
} = require("../src/api/realtime/tradeRealtime.js");

test("buildTradeRealtimeEnvelope normalizes a trade patch", () => {
  const envelope = buildTradeRealtimeEnvelope({
    sid: "TRD_123",
    symbol: "eurusd",
    execution_status: "FILLED",
    broker_pnl: 12.5,
  });

  assert.equal(envelope.type, "trade_update");
  assert.equal(envelope.topic, "trade:TRD_123");
  assert.deepEqual(envelope.data, {
    sid: "TRD_123",
    symbol: "EURUSD",
    execution_status: "FILLED",
    broker_pnl: 12.5,
  });
});

test("emitTradeRealtimeUpdate fans out to wildcard and trade specific topics", () => {
  const emitted = [];
  const delivered = emitTradeRealtimeUpdate(
    {
      sid: "TRD_123",
      symbol: "eurusd",
      execution_status: "CLOSED",
      pnl_realized: 25,
    },
    {
      emitRealtimeTopic(topic, envelope) {
        emitted.push({ topic, envelope });
        return 1;
      },
    },
  );

  assert.equal(delivered, 2);
  assert.deepEqual(
    emitted.map((item) => item.topic),
    ["trade:*", "trade:TRD_123"],
  );
  assert.equal(emitted[0].envelope.data.sid, "TRD_123");
  assert.equal(emitted[0].envelope.data.symbol, "EURUSD");
  assert.equal(emitted[1].envelope.data.execution_status, "CLOSED");
});
