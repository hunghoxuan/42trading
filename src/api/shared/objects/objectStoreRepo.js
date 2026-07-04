"use strict";

const { createCacheFacade } = require("../cache");
const jsonProvider = require("./providers/jsonObjectStoreProvider");
const sqliteProvider = require("./providers/sqliteObjectStoreProvider");
const postgresProvider = require("./providers/postgresObjectStoreProvider");

const DEFAULT_OBJECT_STORE_PROVIDER = "json";

const OBJECT_STORE_PROVIDERS = Object.freeze({
  json: jsonProvider,
  sqlite: sqliteProvider,
  postgres: postgresProvider,
});

const CACHE_ENTRY_VERSION = 1;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeObjectStoreProvider(provider, fallback = DEFAULT_OBJECT_STORE_PROVIDER) {
  const normalized = String(provider || fallback || DEFAULT_OBJECT_STORE_PROVIDER)
    .trim()
    .toLowerCase();
  return OBJECT_STORE_PROVIDERS[normalized] ? normalized : fallback;
}

function getObjectStoreProviderName(options = {}) {
  return normalizeObjectStoreProvider(
    options.provider || process.env.OBJECT_STORE_PROVIDER,
    DEFAULT_OBJECT_STORE_PROVIDER,
  );
}

function getObjectStoreProvider(options = {}) {
  return OBJECT_STORE_PROVIDERS[getObjectStoreProviderName(options)];
}

function cloneValue(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function cacheKeyPart(value, fallback = "_") {
  const raw = value === null || value === undefined ? fallback : String(value).trim();
  return raw || fallback;
}

function cacheEntry(value) {
  return {
    __object_store_cache_entry: CACHE_ENTRY_VERSION,
    value: cloneValue(value),
  };
}

function readCacheEntry(payload) {
  if (
    !payload ||
    typeof payload !== "object" ||
    payload.__object_store_cache_entry !== CACHE_ENTRY_VERSION
  ) {
    return {
      hit: false,
      value: null,
    };
  }
  return {
    hit: true,
    value: cloneValue(payload.value),
  };
}

function createObjectStoreRepo(baseOptions = {}) {
  const provider = getObjectStoreProvider(baseOptions);
  const cache = createCacheFacade(baseOptions.cache || {});
  const cacheTtlMs = Math.max(
    1000,
    Number(baseOptions.cacheTtlMs || process.env.OBJECT_CACHE_TTL_MS) ||
      DEFAULT_CACHE_TTL_MS,
  );

  const objectPrefix = `object-store:${provider.name}:object:`;
  const objectDataPrefix = `object-store:${provider.name}:object-data:`;
  const listPrefix = `object-store:${provider.name}:list:`;
  const fallbackListPrefix = `object-store:${provider.name}:list-fallback:`;

  function objectCacheKey(userId, objectType, objectId) {
    return `${objectPrefix}${cacheKeyPart(userId, "_all_")}:${cacheKeyPart(objectType)}:${cacheKeyPart(objectId, "default")}`;
  }

  function objectDataCacheKey(userId, objectType, objectId) {
    return `${objectDataPrefix}${cacheKeyPart(userId, "_all_")}:${cacheKeyPart(objectType)}:${cacheKeyPart(objectId, "default")}`;
  }

  function listCacheKey(userId, objectType, fallback = false) {
    const prefix = fallback ? fallbackListPrefix : listPrefix;
    return `${prefix}${cacheKeyPart(userId, "_all_")}:${cacheKeyPart(objectType)}`;
  }

  async function readCached(key, loader) {
    const cached = readCacheEntry(await cache.get(key));
    if (cached.hit) return cached.value;
    const value = await loader();
    await cache.set(key, cacheEntry(value), { ttlMs: cacheTtlMs });
    return cloneValue(value);
  }

  async function invalidateObjectFamily(userId, objectType, objectId = "default") {
    await cache.delete(objectCacheKey(userId, objectType, objectId));
    await cache.delete(objectDataCacheKey(userId, objectType, objectId));
    await cache.delete(listCacheKey(userId, objectType, false));
    await cache.delete(listCacheKey(userId, objectType, true));
    if (userId) {
      await cache.delete(listCacheKey(null, objectType, false));
      await cache.delete(listCacheKey(null, objectType, true));
    }
  }

  return {
    name: provider.name,
    kind: provider.kind,
    cache,
    getProvider() {
      return provider;
    },
    getProviderName() {
      return provider.name;
    },
    safePathPart: provider.safePathPart,
    parseJsonField: provider.parseJsonField,
    canonicalObjectType: provider.canonicalObjectType,
    legacySettingsTypeForObjectType: provider.legacySettingsTypeForObjectType,
    resolveDataRoot(options = {}) {
      if (typeof provider.resolveDataRoot === "function") {
        return provider.resolveDataRoot({ ...baseOptions, ...options });
      }
      return undefined;
    },
    userRootDir(userId, options = {}) {
      return provider.userRootDir(userId, { ...baseOptions, ...options });
    },
    objectTypeDir(userId, objectType, options = {}) {
      return provider.objectTypeDir(userId, objectType, {
        ...baseOptions,
        ...options,
      });
    },
    objectDir(userId, objectType, objectId, options = {}) {
      return provider.objectDir(userId, objectType, objectId, {
        ...baseOptions,
        ...options,
      });
    },
    objectDataPath(userId, objectType, objectId, options = {}) {
      return provider.objectDataPath(userId, objectType, objectId, {
        ...baseOptions,
        ...options,
      });
    },
    objectLogsDir(userId, objectType, objectId, options = {}) {
      return provider.objectLogsDir(userId, objectType, objectId, {
        ...baseOptions,
        ...options,
      });
    },
    legacySettingFilePath(userId, objectType, objectId, options = {}) {
      return provider.legacySettingFilePath(userId, objectType, objectId, {
        ...baseOptions,
        ...options,
      });
    },
    async listObjectsByType(userId, objectType) {
      return readCached(listCacheKey(userId, objectType, false), () =>
        provider.listObjectsByType(userId, objectType, baseOptions),
      );
    },
    async listObjectsByTypeWithLegacyFallback(userId, objectType) {
      return readCached(listCacheKey(userId, objectType, true), () =>
        provider.listObjectsByTypeWithLegacyFallback(
          userId,
          objectType,
          baseOptions,
        ),
      );
    },
    async getObject(userId, objectType, objectId = "default") {
      return readCached(objectCacheKey(userId, objectType, objectId), () =>
        provider.getObject(userId, objectType, objectId, baseOptions),
      );
    },
    async getObjectWithLegacyFallback(userId, objectType, objectId = "default") {
      return readCached(objectCacheKey(userId, `${objectType}:legacy`, objectId), () =>
        provider.getObjectWithLegacyFallback(
          userId,
          objectType,
          objectId,
          baseOptions,
        ),
      );
    },
    async getObjectData(userId, objectType, objectId = "default") {
      return readCached(objectDataCacheKey(userId, objectType, objectId), () =>
        provider.getObjectData(userId, objectType, objectId, baseOptions),
      );
    },
    async getObjectDataWithLegacyFallback(userId, objectType, objectId = "default") {
      return readCached(
        objectDataCacheKey(userId, `${objectType}:legacy`, objectId),
        () =>
          provider.getObjectDataWithLegacyFallback(
            userId,
            objectType,
            objectId,
            baseOptions,
          ),
      );
    },
    async upsertObject(userId, objectType, objectId, data, status = "ACTIVE", meta = {}) {
      const rows = await provider.upsertObject(
        userId,
        objectType,
        objectId,
        data,
        status,
        meta,
        baseOptions,
      );
      const row = Array.isArray(rows) ? rows[0] || null : null;
      await invalidateObjectFamily(
        userId,
        row?.type || objectType,
        row?.name || objectId,
      );
      if (row) {
        await cache.set(
          objectCacheKey(userId, row.type || objectType, row.name || objectId),
          cacheEntry(row),
          { ttlMs: cacheTtlMs },
        );
        await cache.set(
          objectDataCacheKey(userId, row.type || objectType, row.name || objectId),
          cacheEntry(row.data || null),
          { ttlMs: cacheTtlMs },
        );
      }
      return rows;
    },
    async putObjectRow(row) {
      const rows = await provider.putObjectRow(row, baseOptions);
      const item = Array.isArray(rows) ? rows[0] || null : null;
      await invalidateObjectFamily(
        item?.user_id || row?.user_id || row?.userId,
        item?.type || row?.type || row?.object_type,
        item?.name || row?.name || row?.object_id,
      );
      return rows;
    },
    async deleteObject(userId, objectType, objectId = "default") {
      await provider.deleteObject(userId, objectType, objectId, baseOptions);
      await invalidateObjectFamily(userId, objectType, objectId);
    },
  };
}

const defaultRepo = createObjectStoreRepo();

module.exports = {
  DEFAULT_OBJECT_STORE_PROVIDER,
  OBJECT_STORE_PROVIDERS,
  normalizeObjectStoreProvider,
  getObjectStoreProviderName,
  getObjectStoreProvider,
  createObjectStoreRepo,
  ...defaultRepo,
  objectStoreRepo: defaultRepo,
};
