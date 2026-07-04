"use strict";

const REALTIME_TOPIC_CLIENTS = new Map();
const REALTIME_BROADCASTERS = new Set();

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
  const data = `data: ${JSON.stringify(envelope)}\n\n`;
  let delivered = 0;
  if (set?.size) {
    for (const res of set) {
      try {
        res.write(data);
        delivered += 1;
      } catch (_) {}
    }
  }
  for (const broadcaster of REALTIME_BROADCASTERS) {
    try {
      delivered += Math.max(0, Number(broadcaster(key, envelope)) || 0);
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

function registerRealtimeBroadcaster(broadcaster) {
  if (typeof broadcaster !== "function") {
    return () => {};
  }
  REALTIME_BROADCASTERS.add(broadcaster);
  return () => {
    REALTIME_BROADCASTERS.delete(broadcaster);
  };
}

module.exports = {
  emitRealtimeTopic,
  getRealtimeTopicClientCount,
  listRealtimeTopics,
  registerRealtimeBroadcaster,
  registerRealtimeTopic,
  removeRealtimeTopic,
};
