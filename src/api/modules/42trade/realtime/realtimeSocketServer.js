"use strict";

const { Server } = require("socket.io");

const SOCKET_TRANSPORT = "socket.io";

function createEnvelope(topic, type, data, extra = {}) {
  return {
    topic: String(topic || "").trim(),
    type: String(type || "message").trim() || "message",
    version: Number(extra.version) || Date.now(),
    ts: Number(extra.ts) || Date.now(),
    transport: SOCKET_TRANSPORT,
    data,
  };
}

function createRealtimeSocketServer({
  httpServer,
  corsOrigin = true,
  path = "/socket.io",
  parseTopic,
  authorize,
  authorizeTopic,
  getReplaySession,
  registerStreamSink,
  registerRealtimeBroadcaster,
  requestChartHistory,
}) {
  if (!httpServer) {
    throw new Error("httpServer is required");
  }
  if (typeof parseTopic !== "function") {
    throw new Error("parseTopic is required");
  }
  if (typeof authorize !== "function") {
    throw new Error("authorize is required");
  }
  if (
    typeof registerStreamSink !== "function" &&
    typeof registerRealtimeBroadcaster !== "function"
  ) {
    throw new Error(
      "registerStreamSink or registerRealtimeBroadcaster is required",
    );
  }

  const io = new Server(httpServer, {
    path,
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
  });
  const socketTopicState = new Map();
  const topicStreamState = new Map();

  const stopBroadcasting =
    typeof registerRealtimeBroadcaster === "function"
      ? registerRealtimeBroadcaster((topic, envelope) => {
          io.to(String(topic || "").trim()).emit("realtime:event", {
            ...envelope,
            transport: SOCKET_TRANSPORT,
          });
          return (
            io.sockets.adapter.rooms.get(String(topic || "").trim())?.size || 0
          );
        })
      : () => {};

  function retainTopicStream(topic) {
    if (typeof registerStreamSink !== "function") return;
    const key = String(topic || "").trim();
    if (!key) return;
    const existing = topicStreamState.get(key);
    if (existing) {
      existing.refs += 1;
      return;
    }
    const unsubscribe = registerStreamSink(key, (envelope) => {
      io.to(key).emit("realtime:event", {
        ...envelope,
        transport: SOCKET_TRANSPORT,
      });
      return io.sockets.adapter.rooms.get(key)?.size || 0;
    });
    topicStreamState.set(key, {
      refs: 1,
      unsubscribe: typeof unsubscribe === "function" ? unsubscribe : () => {},
    });
  }

  function releaseTopicStream(topic) {
    const key = String(topic || "").trim();
    if (!key) return;
    const entry = topicStreamState.get(key);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs > 0) return;
    entry.unsubscribe();
    topicStreamState.delete(key);
  }

  function getTopicMap(socket) {
    const existing = socketTopicState.get(socket.id);
    if (existing) return existing;
    const next = new Map();
    socketTopicState.set(socket.id, next);
    return next;
  }

  function clearTopicWatcher(socket, topic) {
    const map = socketTopicState.get(socket.id);
    if (!map) return;
    const entry = map.get(topic);
    if (!entry) return;
    if (entry.timer) clearInterval(entry.timer);
    if (entry.hasStreamSink) releaseTopicStream(topic);
    map.delete(topic);
    if (!map.size) {
      socketTopicState.delete(socket.id);
    }
  }

  function pollReplay(socket, topicKey, parsedTopic, pollMs) {
    let currentVersion = 0;
    const tick = () => {
      try {
        const snapshot = getReplaySession(parsedTopic.sessionId);
        if (!snapshot) {
          socket.emit(
            "realtime:event",
            createEnvelope(topicKey, "error", {
              message: "Replay session not found",
              topic: topicKey,
            }),
          );
          clearTopicWatcher(socket, topicKey);
          void socket.leave(topicKey);
          return;
        }
        const nextVersion = Number(snapshot.version) || 0;
        if (nextVersion === currentVersion) return;
        currentVersion = nextVersion;
        socket.emit(
          "realtime:event",
          createEnvelope(topicKey, "replay_state", snapshot, {
            version: nextVersion,
          }),
        );
      } catch (error) {
        socket.emit(
          "realtime:event",
          createEnvelope(topicKey, "error", {
            message: error instanceof Error ? error.message : String(error),
            topic: topicKey,
          }),
        );
      }
    };
    tick();
    return setInterval(tick, pollMs);
  }

  io.use((socket, next) => {
    try {
      const result = authorize(socket);
      if (result?.ok) {
        socket.data.auth = result;
        next();
        return;
      }
      next(new Error(result?.error || "AUTH_REQUIRED"));
    } catch (error) {
      next(error instanceof Error ? error : new Error(String(error)));
    }
  });

  io.on("connection", (socket) => {
    socket.on("realtime:subscribe", (payload = {}, ack = () => {}) => {
      const topicRaw = String(payload?.topic || "").trim();
      const parsedTopic = parseTopic(topicRaw);
      if (!parsedTopic?.topic) {
        ack({ ok: false, error: `Unsupported topic: ${topicRaw || "empty"}` });
        return;
      }
      if (typeof authorizeTopic === "function") {
        try {
          const allowed = authorizeTopic(socket, parsedTopic, payload);
          if (allowed?.ok === false) {
            ack({ ok: false, error: allowed.error || "TOPIC_FORBIDDEN" });
            return;
          }
        } catch (error) {
          ack({
            ok: false,
            error: error instanceof Error ? error.message : String(error || "TOPIC_FORBIDDEN"),
          });
          return;
        }
      }
      const topicKey = parsedTopic.topic;
      const pollMs = Math.max(
        1000,
        Math.min(30000, Number(payload?.pollMs) || 2500),
      );

      clearTopicWatcher(socket, topicKey);
      void socket.join(topicKey);
      const map = getTopicMap(socket);
      const entry = {
        parsedTopic,
        pollMs,
        timer: null,
        hasStreamSink: false,
      };
      if (typeof registerStreamSink === "function") {
        retainTopicStream(topicKey);
        entry.hasStreamSink = true;
      }
      if (
        parsedTopic.kind === "replay" &&
        typeof getReplaySession === "function"
      ) {
        entry.timer = pollReplay(socket, topicKey, parsedTopic, pollMs);
      }
      map.set(topicKey, entry);
      socket.emit(
        "realtime:event",
        createEnvelope(topicKey, "connected", {
          topic: topicKey,
          kind: parsedTopic.kind,
          poll_ms: pollMs,
        }),
      );
      ack({ ok: true, topic: topicKey });
    });

    socket.on("realtime:unsubscribe", (payload = {}, ack = () => {}) => {
      const topicRaw = String(payload?.topic || "").trim();
      const parsedTopic = parseTopic(topicRaw);
      if (!parsedTopic?.topic) {
        ack({ ok: false, error: `Unsupported topic: ${topicRaw || "empty"}` });
        return;
      }
      clearTopicWatcher(socket, parsedTopic.topic);
      void socket.leave(parsedTopic.topic);
      ack({ ok: true, topic: parsedTopic.topic });
    });

    socket.on("chart:history:request", async (payload = {}, ack = () => {}) => {
      if (typeof requestChartHistory !== "function") {
        ack({ ok: false, error: "CHART_HISTORY_UNAVAILABLE" });
        return;
      }
      try {
        const response = await requestChartHistory(payload, socket);
        ack({
          ok: true,
          ...(response && typeof response === "object" ? response : {}),
        });
      } catch (error) {
        ack({
          ok: false,
          error: error instanceof Error ? error.message : String(error || "CHART_HISTORY_FAILED"),
          requestId: String(payload?.requestId || "").trim() || null,
        });
      }
    });

    socket.on("disconnect", () => {
      const map = socketTopicState.get(socket.id);
      if (!map) return;
      for (const topicKey of map.keys()) {
        clearTopicWatcher(socket, topicKey);
        void socket.leave(topicKey);
      }
    });
  });

  return {
    io,
    close: async () => {
      stopBroadcasting();
      for (const entry of topicStreamState.values()) {
        entry.unsubscribe();
      }
      topicStreamState.clear();
      for (const map of socketTopicState.values()) {
        for (const entry of map.values()) {
          if (entry?.timer) clearInterval(entry.timer);
        }
      }
      socketTopicState.clear();
      await io.close();
    },
  };
}

module.exports = {
  createRealtimeSocketServer,
};
