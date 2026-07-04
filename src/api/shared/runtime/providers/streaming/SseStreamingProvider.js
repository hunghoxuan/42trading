function normalizeTopic(topic) {
  return String(topic || "").trim();
}

export class SseStreamingProvider {
  constructor({ pubsub } = {}) {
    this.pubsub = pubsub;
    this.streamCount = 0;
  }

  attach() {
    return {
      close: async () => {},
    };
  }

  openTopicStream({
    req,
    res,
    topic,
    heartbeatMs = 30000,
    onStop,
  } = {}) {
    this.streamCount += 1;
    const streamTopic = normalizeTopic(topic);
    const registeredTopics = new Map();
    let closed = false;
    let heartbeat = null;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(":ok\n\n");

    const stop = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      for (const unregister of registeredTopics.values()) {
        unregister();
      }
      registeredTopics.clear();
      this.streamCount = Math.max(0, this.streamCount - 1);
      if (typeof res?.end === "function") {
        try {
          res.end();
        } catch {}
      }
      if (typeof onStop === "function") {
        onStop();
      }
    };

    const writeEnvelope = (envelope) => {
      if (closed) return false;
      try {
        res.write(`data: ${JSON.stringify(envelope)}\n\n`);
        return true;
      } catch (_) {
        stop();
        return false;
      }
    };

    const pushEnvelope = (type, data, extra = {}) => {
      return writeEnvelope({
        topic: streamTopic,
        type: String(type || "message").trim(),
        ts: Date.now(),
        version: Number(extra.version) || Date.now(),
        transport: "sse",
        ...extra,
        data,
      });
    };

    const registerTopic = (nextTopic) => {
      const normalized = normalizeTopic(nextTopic);
      if (!normalized || registeredTopics.has(normalized) || closed) return;
      const registration =
        this.pubsub?.registerStreamSink?.(normalized, (envelope) => {
          writeEnvelope(envelope);
        }) || (() => {});
      const unregister =
        typeof registration.unsubscribe === "function"
          ? registration.unsubscribe
          : typeof registration === "function"
            ? registration
            : () => {};
      registeredTopics.set(normalized, unregister);
      void Promise.resolve(registration.ready).catch((error) => {
        if (registeredTopics.get(normalized) !== unregister) return;
        registeredTopics.delete(normalized);
        unregister();
        pushEnvelope("error", {
          message: error instanceof Error ? error.message : String(error),
          topic: normalized,
        });
        stop();
      });
    };

    const registerTopics = (topics = []) => {
      for (const nextTopic of Array.isArray(topics) ? topics : [topics]) {
        registerTopic(nextTopic);
      }
    };

    heartbeat = setInterval(() => {
      try {
        res.write(":ping\n\n");
      } catch (_) {
        stop();
      }
    }, Math.max(1000, Number(heartbeatMs) || 30000));

    if (req && typeof req.on === "function") {
      req.on("close", stop);
    }

    return {
      close: stop,
      pushEnvelope,
      registerTopic,
      registerTopics,
      stop,
    };
  }

  getStatus() {
    return {
      id: "sse",
      ready: true,
      streamCount: this.streamCount,
    };
  }
}
