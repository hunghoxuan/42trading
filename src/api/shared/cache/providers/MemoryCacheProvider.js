"use strict";

const { CACHE_PROVIDER_IDS } = require("../providerTypes");

function cloneValue(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function toExpiresAt(ttlMs) {
  const safeTtlMs = Math.max(0, Number(ttlMs) || 0);
  return safeTtlMs > 0 ? Date.now() + safeTtlMs : null;
}

class MemoryCacheProvider {
  constructor() {
    this.id = CACHE_PROVIDER_IDS.memory;
    this.store = new Map();
  }

  async get(key) {
    const cacheKey = String(key || "").trim();
    if (!cacheKey) return null;
    const hit = this.store.get(cacheKey);
    if (!hit) return null;
    if (hit.expiresAt && hit.expiresAt <= Date.now()) {
      this.store.delete(cacheKey);
      return null;
    }
    return cloneValue(hit.value);
  }

  async set(key, value, { ttlMs } = {}) {
    const cacheKey = String(key || "").trim();
    if (!cacheKey) return false;
    this.store.set(cacheKey, {
      value: cloneValue(value),
      expiresAt: toExpiresAt(ttlMs),
    });
    return true;
  }

  async delete(key) {
    const cacheKey = String(key || "").trim();
    if (!cacheKey) return false;
    return this.store.delete(cacheKey);
  }

  async ttl(key) {
    const cacheKey = String(key || "").trim();
    if (!cacheKey) return null;
    const hit = this.store.get(cacheKey);
    if (!hit) return null;
    if (!hit.expiresAt) return null;
    return Math.max(0, hit.expiresAt - Date.now());
  }

  async deletePrefix(prefix) {
    const keyPrefix = String(prefix || "").trim();
    if (!keyPrefix) return 0;
    let deleted = 0;
    for (const key of this.store.keys()) {
      if (!String(key).startsWith(keyPrefix)) continue;
      this.store.delete(key);
      deleted += 1;
    }
    return deleted;
  }

  async close() {
    this.store.clear();
  }

  getStatus() {
    return {
      id: this.id,
      ready: true,
      keyCount: this.store.size,
    };
  }
}

module.exports = {
  MemoryCacheProvider,
};
