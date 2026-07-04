import { createClient as createRedisClient } from "redis";

import { PROVIDER_IDS } from "../../contracts/providerTypes.js";

const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

function normalizeKey(key) {
  return String(key || "").trim();
}

export class RedisCacheProvider {
  constructor({ url = DEFAULT_REDIS_URL, createClient = createRedisClient } = {}) {
    this.id = PROVIDER_IDS.cache.redis;
    this.url = String(url || "").trim() || DEFAULT_REDIS_URL;
    this.createClient = createClient;
    this.client = null;
    this.clientPromise = null;
  }

  async get(key) {
    const cacheKey = normalizeKey(key);
    if (!cacheKey) return null;
    const client = await this.getClient();
    const raw = await client.get(cacheKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  async set(key, value, { ttlMs } = {}) {
    const cacheKey = normalizeKey(key);
    if (!cacheKey) return false;
    const client = await this.getClient();
    const serialized = JSON.stringify(value);
    const safeTtlMs = Math.max(0, Number(ttlMs) || 0);
    if (safeTtlMs > 0) {
      await client.pSetEx(cacheKey, safeTtlMs, serialized);
    } else {
      await client.set(cacheKey, serialized);
    }
    return true;
  }

  async delete(key) {
    const cacheKey = normalizeKey(key);
    if (!cacheKey) return false;
    const client = await this.getClient();
    return (await client.del(cacheKey)) > 0;
  }

  async ttl(key) {
    const cacheKey = normalizeKey(key);
    if (!cacheKey) return null;
    const client = await this.getClient();
    const ttlMs = await client.pTTL(cacheKey);
    return ttlMs >= 0 ? ttlMs : null;
  }

  async deletePrefix(prefix) {
    const keyPrefix = normalizeKey(prefix);
    if (!keyPrefix) return 0;
    const client = await this.getClient();
    let cursor = "0";
    let deleted = 0;
    do {
      const result = await client.scan(cursor, {
        MATCH: `${keyPrefix}*`,
        COUNT: 100,
      });
      cursor = String(result?.cursor ?? "0");
      const keys = Array.isArray(result?.keys) ? result.keys : [];
      if (keys.length) {
        deleted += await client.del(keys);
      }
    } while (cursor !== "0");
    return deleted;
  }

  async close() {
    if (!this.client) {
      this.clientPromise = null;
      return;
    }
    const client = this.client;
    this.client = null;
    this.clientPromise = null;
    if (typeof client.quit === "function") {
      try {
        await client.quit();
        return;
      } catch {}
    }
    if (typeof client.disconnect === "function") {
      try {
        await client.disconnect();
      } catch {}
    }
  }

  async getClient() {
    if (this.client) return this.client;
    if (this.clientPromise) return this.clientPromise;
    this.clientPromise = (async () => {
      const client = this.createClient({ url: this.url });
      if (typeof client.connect === "function") {
        await client.connect();
      }
      this.client = client;
      return client;
    })();
    try {
      return await this.clientPromise;
    } finally {
      if (!this.client) {
        this.clientPromise = null;
      }
    }
  }

  getStatus() {
    return {
      id: this.id,
      ready: Boolean(this.client || this.clientPromise),
      url: this.url,
    };
  }
}
