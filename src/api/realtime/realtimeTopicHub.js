"use strict";

const REALTIME_TOPIC_CLIENTS = new Map();

function normalizeTopic(topic) {
  return String(topic || "").trim();
}

function registerRealtimeTopic(topic, res) {
  const key = normalizeTopic(topic);
  if (!key || !res) return;
  if (!REALTIME_TOPIC_CLIENTS.has(key)) {
    REALTIME_TOPIC_CLIENTS.set(key, new Set());
  }
  REALTIME_TOPIC_CLIENTS.get(key).add(res);
}

function removeRealtimeTopic(topic, res) {
  const key = normalizeTopic(topic);
  if (!key || !res) return;
  const set = REALTIME_TOPIC_CLIENTS.get(key);
  if (!set) return;
  set.delete(res);
  if (!set.size) REALTIME_TOPIC_CLIENTS.delete(key);
}

function emitRealtimeTopic(topic, envelope) {
  const key = normalizeTopic(topic);
  if (!key) return 0;
  const set = REALTIME_TOPIC_CLIENTS.get(key);
  if (!set?.size) return 0;
  const data = `data: ${JSON.stringify(envelope)}\n\n`;
  let delivered = 0;
  for (const res of set) {
    try {
      res.write(data);
      delivered += 1;
    } catch (_) {}
  }
  return delivered;
}

function getRealtimeTopicClientCount(topic) {
  const key = normalizeTopic(topic);
  if (!key) return 0;
  return REALTIME_TOPIC_CLIENTS.get(key)?.size || 0;
}

function listRealtimeTopics() {
  return [...REALTIME_TOPIC_CLIENTS.keys()];
}

module.exports = {
  emitRealtimeTopic,
  getRealtimeTopicClientCount,
  listRealtimeTopics,
  registerRealtimeTopic,
  removeRealtimeTopic,
};
