import { createClient as createRedisClient } from "redis";

const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

function normalizeTopic(topic) {
  return String(topic || "").trim();
}

function parseEnvelope(topic, message) {
  if (typeof message !== "string") {
    return message;
  }

  try {
    return JSON.parse(message);
  } catch {
    return {
      topic,
      type: "message",
      data: message,
    };
  }
}

function createRegistrationHandle(unsubscribe, ready = Promise.resolve()) {
  const handle = typeof unsubscribe === "function" ? unsubscribe : () => {};
  handle.unsubscribe = handle;
  handle.ready = ready;
  return handle;
}

export class RedisPubSubProvider {
  constructor({ url = DEFAULT_REDIS_URL, createClient = createRedisClient } = {}) {
    this.url = String(url || "").trim() || DEFAULT_REDIS_URL;
    this.createClient = createClient;
    this.publisher = null;
    this.publisherPromise = null;
    this.subscriptionClients = new Set();
  }

  async publish(topic, envelope) {
    const channel = normalizeTopic(topic);
    if (!channel) return 0;

    const publisher = await this.getPublisher();
    return publisher.publish(channel, JSON.stringify(envelope));
  }

  subscribe(topic, listener) {
    return this.registerSubscription(topic, listener);
  }

  registerStreamSink(topic, sink) {
    return this.registerSubscription(topic, sink);
  }

  async close() {
    const pending = [];

    if (this.publisher) {
      pending.push(this.disconnectClient(this.publisher));
      this.publisher = null;
    }
    this.publisherPromise = null;

    for (const client of this.subscriptionClients) {
      pending.push(this.disconnectClient(client));
    }
    this.subscriptionClients.clear();

    await Promise.allSettled(pending);
  }

  async getPublisher() {
    if (this.publisher) {
      return this.publisher;
    }
    if (this.publisherPromise) {
      return this.publisherPromise;
    }

    this.publisherPromise = (async () => {
      const client = this.createClient({ url: this.url });
      if (typeof client.connect === "function") {
        await client.connect();
      }
      this.publisher = client;
      return client;
    })();

    try {
      return await this.publisherPromise;
    } finally {
      if (!this.publisher) {
        this.publisherPromise = null;
      }
    }
  }

  registerSubscription(topic, deliver) {
    const channel = normalizeTopic(topic);
    if (!channel || typeof deliver !== "function") {
      return createRegistrationHandle(() => {}, Promise.resolve());
    }

    let active = true;

    const subscriptionReady = this.createSubscriptionClient(channel, (message) => {
      if (!active) return;
      try {
        deliver(parseEnvelope(channel, message));
      } catch {
        // Isolate listener failures so later messages can still flow.
      }
    });
    subscriptionReady.catch(() => {});

    const unsubscribe = () => {
      if (!active) return;
      active = false;
      void subscriptionReady
        .then((client) => this.unsubscribeClient(client, channel))
        .catch(() => {});
    };

    return createRegistrationHandle(unsubscribe, subscriptionReady);
  }

  async createSubscriptionClient(channel, onMessage) {
    const client = this.createClient({ url: this.url });
    this.subscriptionClients.add(client);

    try {
      if (typeof client.connect === "function") {
        await client.connect();
      }
      await client.subscribe(channel, onMessage);
      return client;
    } catch (error) {
      this.subscriptionClients.delete(client);
      await this.disconnectClient(client);
      throw error;
    }
  }

  async unsubscribeClient(client, channel) {
    try {
      if (typeof client.unsubscribe === "function") {
        await client.unsubscribe(channel);
      }
    } catch {
      // Best-effort cleanup for already-closed or failed subscriptions.
    } finally {
      this.subscriptionClients.delete(client);
      await this.disconnectClient(client);
    }
  }

  async disconnectClient(client) {
    if (!client) return;

    if (typeof client.quit === "function") {
      try {
        await client.quit();
        return;
      } catch {
        // Fall through to disconnect.
      }
    }

    if (typeof client.disconnect === "function") {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect races during teardown.
      }
    }
  }

  getStatus() {
    return {
      id: "redis",
      ready: Boolean(this.publisher || this.publisherPromise || this.subscriptionClients.size),
      url: this.url,
      subscriptionClientCount: this.subscriptionClients.size,
    };
  }
}
