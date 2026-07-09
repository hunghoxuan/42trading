"use strict";

const marketDataDomain = require("../marketData");

const barsStorage = marketDataDomain.marketDataRepo;

function normalizeSymbol(rawSymbol) {
  const base = String(rawSymbol || "")
    .trim()
    .toUpperCase();
  if (!base) return "";
  return base.includes(":") ? base.split(":").pop().trim().toUpperCase() : base;
}

function normalizeTimeframe(rawTf) {
  const value = String(rawTf || "")
    .trim()
    .toLowerCase();
  const tfKey = String(barsStorage.normalizeCsvTfKey(rawTf) || value)
    .trim()
    .toLowerCase();
  if (["1", "1m", "1min", "m1"].includes(tfKey)) return "1m";
  if (["5", "5m", "5min", "m5"].includes(tfKey)) return "5m";
  if (["15", "15m", "15min", "m15"].includes(tfKey)) return "15m";
  if (["60", "1h", "h1"].includes(tfKey)) return "1h";
  if (["240", "4h", "h4"].includes(tfKey)) return "4h";
  if (["d", "1d", "day"].includes(tfKey)) return "d";
  return tfKey;
}

function normalizeTopicSegment(value, fallback = "") {
  const raw = String(value ?? fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "_");
  return raw || String(fallback || "").trim();
}

function buildChartTopic(symbol) {
  const sym = normalizeSymbol(symbol);
  if (!sym) return "";
  return `chart:${sym}`;
}

function buildReplayTopic(sessionId) {
  const id = String(sessionId || "").trim();
  return id ? `replay:${id}` : "";
}

function buildNotificationTopic(userId) {
  const id = String(userId || "").trim() || "*";
  return `notifications:${id}`;
}

function buildMt5Topic(userId) {
  const id = String(userId || "").trim() || "*";
  return `mt5:${id}`;
}

function buildBrokerTopic(userId) {
  return buildMt5Topic(userId);
}

function buildTradeTopic(tradeSid) {
  const id = String(tradeSid || "").trim() || "*";
  return `trade:${id}`;
}

function buildNewsTopic(scope = "today") {
  const target = normalizeTopicSegment(scope, "today").toLowerCase() || "today";
  return `news:${target}`;
}

function buildChatConversationsTopic(userId) {
  const id = normalizeTopicSegment(userId || "*", "*");
  return `chat:${id}:conversations`;
}

function buildChatConversationTopic(userId, conversationId) {
  const id = normalizeTopicSegment(userId || "*", "*");
  const convoId = normalizeTopicSegment(conversationId);
  if (!convoId) return "";
  return `chat:${id}:conversation:${convoId}`;
}

function buildLogTopic(source, objectId, file) {
  const safeSource = normalizeTopicSegment(source).toLowerCase();
  const safeObjectId = normalizeTopicSegment(objectId);
  const safeFile = normalizeTopicSegment(file);
  if (!safeSource || !safeObjectId || !safeFile) return "";
  return `logs:${safeSource}:${safeObjectId}:${safeFile}`;
}

function parseTopic(rawTopic) {
  const topic = String(rawTopic || "").trim();
  if (!topic) return null;
  const parts = topic.split(":");
  const kind = String(parts[0] || "").trim().toLowerCase();
  if (kind === "chart" && parts.length === 2) {
    const requested = String(parts[1] || "").trim();
    const symbol = requested === "*" ? "*" : normalizeSymbol(requested);
    if (!symbol) return null;
    return {
      kind: "chart",
      topic: buildChartTopic(symbol),
      symbol,
    };
  }
  if (kind === "replay" && parts.length >= 2) {
    const sessionId = String(parts[1] || "").trim();
    if (!sessionId) return null;
    return {
      kind: "replay",
      topic: buildReplayTopic(sessionId),
      sessionId,
    };
  }
  if (
    (kind === "notifications" || kind === "notification") &&
    parts.length >= 2
  ) {
    const userId = String(parts[1] || "").trim() || "*";
    return {
      kind: "notifications",
      topic: buildNotificationTopic(userId),
      userId,
    };
  }
  if ((kind === "broker" || kind === "mt5") && parts.length >= 2) {
    const userId = String(parts[1] || "").trim() || "*";
    return {
      kind: "mt5",
      topic: buildMt5Topic(userId),
      userId,
    };
  }
  if (kind === "trade" && parts.length >= 2) {
    const tradeSid = String(parts[1] || "").trim() || "*";
    return {
      kind: "trade",
      topic: buildTradeTopic(tradeSid),
      tradeSid,
    };
  }
  if (kind === "news" && parts.length >= 2) {
    const scope = normalizeTopicSegment(parts[1], "today").toLowerCase();
    if (!scope) return null;
    return {
      kind: "news",
      topic: buildNewsTopic(scope),
      scope,
    };
  }
  if (kind === "chat" && parts.length >= 3) {
    const userId = normalizeTopicSegment(parts[1], "*") || "*";
    const scope = String(parts[2] || "").trim().toLowerCase();
    if (scope === "conversations") {
      return {
        kind: "chat",
        scope: "conversations",
        userId,
        topic: buildChatConversationsTopic(userId),
      };
    }
    if (scope === "conversation" && parts.length >= 4) {
      const conversationId = normalizeTopicSegment(parts[3]);
      const topicKey = buildChatConversationTopic(userId, conversationId);
      if (!topicKey) return null;
      return {
        kind: "chat",
        scope: "conversation",
        userId,
        conversationId,
        topic: topicKey,
      };
    }
  }
  if (kind === "logs" && parts.length >= 4) {
    const source = normalizeTopicSegment(parts[1]).toLowerCase();
    const objectId = normalizeTopicSegment(parts[2]);
    const file = normalizeTopicSegment(parts[3]);
    const topicKey = buildLogTopic(source, objectId, file);
    if (!topicKey) return null;
    return {
      kind: "logs",
      topic: topicKey,
      source,
      objectId,
      file,
    };
  }
  return null;
}

function normalizeBars(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    time: Number(row?.time),
    open: Number(row?.open),
    high: Number(row?.high),
    low: Number(row?.low),
    close: Number(row?.close),
    volume: Number(row?.volume || 0),
  }));
}

module.exports = {
  buildChatConversationTopic,
  buildChatConversationsTopic,
  buildChartTopic,
  buildLogTopic,
  buildBrokerTopic,
  buildMt5Topic,
  buildNewsTopic,
  buildNotificationTopic,
  buildReplayTopic,
  buildTradeTopic,
  normalizeBars,
  normalizeSymbol,
  normalizeTopicSegment,
  normalizeTimeframe,
  parseTopic,
};
