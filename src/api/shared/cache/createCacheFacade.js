"use strict";

const { CacheFacade } = require("./CacheFacade");
const { CACHE_PROVIDER_IDS } = require("./providerTypes");
const { MemoryCacheProvider } = require("./providers/MemoryCacheProvider");
const { NoopCacheProvider } = require("./providers/NoopCacheProvider");
const { RedisCacheProvider } = require("./providers/RedisCacheProvider");

function normalizeProviderId(value = "") {
  return String(value || "").trim().toLowerCase();
}

function resolveProviderId(options = {}) {
  const env = options.env || process.env;
  const explicit = normalizeProviderId(
    options.provider || options.providerId || env.OBJECT_CACHE_PROVIDER || env.CACHE_PROVIDER,
  );
  if (explicit && Object.values(CACHE_PROVIDER_IDS).includes(explicit)) {
    return explicit;
  }
  return String(env.REDIS_URL || "").trim()
    ? CACHE_PROVIDER_IDS.redis
    : CACHE_PROVIDER_IDS.memory;
}

function isCacheFacade(value) {
  return value && typeof value.get === "function" && typeof value.set === "function";
}

function createProvider(options = {}) {
  const providerId = resolveProviderId(options);
  if (providerId === CACHE_PROVIDER_IDS.redis) {
    return new RedisCacheProvider({
      url: options.url || (options.env || process.env).REDIS_URL,
      createClient: options.createClient,
    });
  }
  if (providerId === CACHE_PROVIDER_IDS.noop) {
    return new NoopCacheProvider();
  }
  return new MemoryCacheProvider();
}

function createCacheFacade(options = {}) {
  if (isCacheFacade(options)) return options;
  if (isCacheFacade(options.facade)) return options.facade;
  if (options.provider && typeof options.provider.get === "function") {
    return new CacheFacade(options.provider);
  }
  return new CacheFacade(createProvider(options));
}

module.exports = {
  CACHE_PROVIDER_IDS,
  createCacheFacade,
};
