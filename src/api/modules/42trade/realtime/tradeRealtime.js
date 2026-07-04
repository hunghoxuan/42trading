"use strict";

const { buildTradeTopic, normalizeSymbol } = require("./realtimeCore");

function normalizeTradeRealtimePatch(payload = {}) {
  const source =
    payload && typeof payload === "object" ? { ...payload } : {};
  const sid = String(
    source.sid || source.trade_sid || source.tradeSid || "",
  ).trim();
  if (!sid) return null;
  const symbol = normalizeSymbol(source.symbol || source.instrument || "");
  const patch = {
    sid,
    ...(symbol ? { symbol } : {}),
  };
  const fields = [
    "execution_status",
    "broker_pnl",
    "pnl_realized",
    "pnl",
    "broker_pips",
    "sl",
    "tp",
    "close_reason",
    "account_id",
    "dispatch_status",
    "updated_at",
    "opened_at",
    "closed_at",
  ];
  for (const field of fields) {
    if (source[field] !== undefined) {
      patch[field] = source[field];
    }
  }
  return patch;
}

function buildTradeRealtimeEnvelope(payload = {}, extra = {}) {
  const patch = normalizeTradeRealtimePatch(payload);
  if (!patch) return null;
  const topic = buildTradeTopic(patch.sid);
  return {
    topic,
    type: String(extra.type || "trade_update").trim() || "trade_update",
    ts: Date.now(),
    version: Number(extra.version) || Date.now(),
    transport: "sse",
    data: patch,
  };
}

function emitTradeRealtimeUpdate(payload = {}, { emitRealtimeTopic } = {}) {
  if (typeof emitRealtimeTopic !== "function") return 0;
  const envelope = buildTradeRealtimeEnvelope(payload);
  if (!envelope) return 0;
  let delivered = 0;
  for (const topic of [buildTradeTopic("*"), envelope.topic]) {
    delivered += Number(
      emitRealtimeTopic(topic, {
        ...envelope,
        topic,
      }),
    ) || 0;
  }
  return delivered;
}

module.exports = {
  buildTradeRealtimeEnvelope,
  emitTradeRealtimeUpdate,
  normalizeTradeRealtimePatch,
};
