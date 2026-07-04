"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { createObjectStoreRepo } = require("./objectStoreRepo");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const USERS_ROOT = path.join(PROJECT_ROOT, "data", "users");

const STATIC_PREFIX = "USR:STA";
const DYNAMIC_PREFIX = "USR:DYN";
const DYNAMIC_LIST_PREFIX = "USR:DYN:LST";
const DEFAULT_DYNAMIC_CACHE_TTL_SEC = 3600;
const DEFAULT_STATIC_CACHE_TTL_SEC = 3600;

function nowIso() {
  return new Date().toISOString();
}

function safePathPart(value, fallback = "default") {
  const raw = String(value || "").trim() || fallback;
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+$/, "_");
  return safe || fallback;
}

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function parseJsonField(value, fallback = {}) {
  if (value === null || value === undefined || value === "") {
    return clone(fallback);
  }
  if (typeof value === "object") return clone(value);
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : clone(fallback);
  } catch {
    return clone(fallback);
  }
}

function normalizeIso(value, fallback = nowIso()) {
  if (!value) return fallback;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function mergePlainObjects(baseValue, overrideValue) {
  return {
    ...clone(ensureObject(baseValue)),
    ...clone(ensureObject(overrideValue)),
  };
}

function listUserIdsFromRoot(usersRoot) {
  try {
    return fs
      .readdirSync(usersRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

class RepoBackedStaticObjectDal {
  constructor({ repo, usersRoot = USERS_ROOT } = {}) {
    this.repo = repo;
    this.usersRoot = usersRoot;
  }

  userRoot(userId) {
    return this.repo.userRootDir(userId);
  }

  objectDir(userId, objectType) {
    return this.repo.objectTypeDir(userId, objectType);
  }

  objectFolderDir(userId, objectType, objectId) {
    return this.repo.objectDir(userId, objectType, objectId);
  }

  objectPath(userId, objectType, objectId) {
    return this.repo.objectDataPath(userId, objectType, objectId);
  }

  objectLogsDir(userId, objectType, objectId) {
    return this.repo.objectLogsDir(userId, objectType, objectId);
  }

  legacyObjectPath(userId, objectType, objectId) {
    return path.join(
      this.objectDir(userId, objectType),
      `${safePathPart(objectId, "default")}.json`,
    );
  }

  normalizeStaticObject(userId, objectType, objectId, data = {}, meta = {}) {
    const body = ensureObject(data);
    const now = nowIso();
    return {
      object_type: String(objectType || ""),
      object_id: String(objectId || ""),
      user_id: String(userId || ""),
      created_at: normalizeIso(meta.created_at || body.created_at, now),
      updated_at: normalizeIso(meta.updated_at || body.updated_at, now),
      ...clone(body),
    };
  }

  fromRepoRow(row, fallback = {}) {
    if (!row) return null;
    const staticBody = {
      ...(row.data || {}),
      ...row,
    };
    delete staticBody.id;
    delete staticBody.userId;
    delete staticBody.type;
    delete staticBody.data;
    delete staticBody.value;
    delete staticBody.createdAt;
    delete staticBody.updatedAt;
    return this.normalizeStaticObject(
      row.user_id || fallback.user_id,
      row.type || fallback.object_type,
      row.object_id || row.name || fallback.object_id,
      staticBody,
      row,
    );
  }

  async getObject(userId, objectType, objectId) {
    const row = await this.repo.getObjectWithLegacyFallback(
      userId,
      objectType,
      objectId,
    );
    return this.fromRepoRow(row, {
      user_id: userId,
      object_type: objectType,
      object_id: objectId,
    });
  }

  async upsertObject(userId, objectType, objectId, data = {}, meta = {}) {
    const rows = await this.repo.upsertObject(
      userId,
      objectType,
      objectId,
      this.normalizeStaticObject(userId, objectType, objectId, data, meta),
      meta.status || "ACTIVE",
      meta,
    );
    return this.fromRepoRow(rows?.[0], {
      user_id: userId,
      object_type: objectType,
      object_id: objectId,
    });
  }

  async deleteObject(userId, objectType, objectId) {
    await this.repo.deleteObject(userId, objectType, objectId);
  }

  async listObjects(userId, objectType) {
    const rows = await this.repo.listObjectsByTypeWithLegacyFallback(
      userId,
      objectType,
    );
    return rows
      .map((row) => this.fromRepoRow(row))
      .filter(Boolean)
      .sort((a, b) =>
        `${a.object_type}:${a.object_id}`.localeCompare(
          `${b.object_type}:${b.object_id}`,
        ),
      );
  }

  async listUsersWithObjectType(objectType) {
    const repoRows = await this.repo.listObjectsByTypeWithLegacyFallback(
      null,
      objectType,
    );
    const users = new Set(repoRows.map((row) => String(row.user_id || "").trim()).filter(Boolean));

    for (const uid of listUserIdsFromRoot(this.usersRoot)) {
      const legacyDir = this.objectDir(uid, objectType);
      if (fs.existsSync(legacyDir)) users.add(uid);
    }
    return [...users].sort();
  }

  async findObjectByField(objectType, fieldName, fieldValue, userId = null) {
    const users = userId
      ? [String(userId)]
      : await this.listUsersWithObjectType(objectType);
    const target = String(fieldValue ?? "");
    for (const uid of users) {
      const rows = await this.listObjects(uid, objectType);
      const found = rows.find((row) => String(row?.[fieldName] ?? "") === target);
      if (found) return found;
    }
    return null;
  }
}

class RepoBackedDynamicObjectDal {
  constructor({ repo } = {}) {
    this.repo = repo;
  }

  dynamicType(objectType) {
    return `${String(objectType || "objects").trim() || "objects"}__runtime`;
  }

  normalizeDynamicRow(userId, objectType, objectId, row = {}) {
    if (!row || typeof row !== "object") return null;
    return {
      user_id: String(userId || row.user_id || ""),
      object_type: String(objectType || row.type || row.object_type || ""),
      object_id: String(objectId || row.object_id || row.name || ""),
      metadata: parseJsonField(row.data, {}),
      status: String(row.status || "ACTIVE"),
      created_at: normalizeIso(row.created_at),
      updated_at: normalizeIso(row.updated_at),
    };
  }

  async getObject(userId, objectType, objectId) {
    const row = await this.repo.getObject(
      userId,
      this.dynamicType(objectType),
      objectId,
    );
    return this.normalizeDynamicRow(userId, objectType, objectId, row);
  }

  async listObjects(userId, objectType) {
    const rows = await this.repo.listObjectsByType(
      userId,
      this.dynamicType(objectType),
    );
    return rows
      .map((row) =>
        this.normalizeDynamicRow(
          userId,
          objectType,
          row.object_id || row.name,
          row,
        ),
      )
      .filter(Boolean);
  }

  async upsertObject(
    userId,
    objectType,
    objectId,
    metadata = {},
    status = "ACTIVE",
    meta = {},
  ) {
    const rows = await this.repo.upsertObject(
      userId,
      this.dynamicType(objectType),
      objectId,
      ensureObject(metadata),
      status,
      meta,
    );
    return this.normalizeDynamicRow(userId, objectType, objectId, rows?.[0]);
  }

  async deleteObject(userId, objectType, objectId) {
    await this.repo.deleteObject(userId, this.dynamicType(objectType), objectId);
  }
}

class UnifiedUserObjectStore {
  constructor({
    usersRoot = USERS_ROOT,
    redisEnabled = false,
    getRedisClient = null,
    logger = console,
    staticCacheTtlSec = DEFAULT_STATIC_CACHE_TTL_SEC,
    dynamicCacheTtlSec = DEFAULT_DYNAMIC_CACHE_TTL_SEC,
    provider,
    projectRoot = PROJECT_ROOT,
    dataRoot,
    sqlitePath,
    postgresUrl,
    pool,
  } = {}) {
    this.usersRoot = usersRoot;
    this.redisEnabled = Boolean(redisEnabled);
    this.getRedisClient =
      typeof getRedisClient === "function" ? getRedisClient : null;
    this.logger = logger;
    this.staticCacheTtlSec = Math.max(
      30,
      Number(staticCacheTtlSec) || DEFAULT_STATIC_CACHE_TTL_SEC,
    );
    this.dynamicCacheTtlSec = Math.max(
      30,
      Number(dynamicCacheTtlSec) || DEFAULT_DYNAMIC_CACHE_TTL_SEC,
    );
    this.memory = new Map();
    this.repo = createObjectStoreRepo({
      provider,
      projectRoot,
      dataRoot,
      sqlitePath,
      postgresUrl,
      pool,
    });
    this.staticDal = new RepoBackedStaticObjectDal({
      repo: this.repo,
      usersRoot,
    });
    this.dynamicDal = new RepoBackedDynamicObjectDal({ repo: this.repo });
  }

  staticCacheKey(userId, objectType, objectId) {
    return `${STATIC_PREFIX}:${userId}:${objectType}:${objectId}`;
  }

  dynamicCacheKey(userId, objectType, objectId) {
    return `${DYNAMIC_PREFIX}:${userId}:${objectType}:${objectId}`;
  }

  dynamicListCacheKey(userId, objectType) {
    return `${DYNAMIC_LIST_PREFIX}:${userId}:${objectType}`;
  }

  getMemory(key) {
    const row = this.memory.get(key);
    if (!row) return null;
    if (row.expires_at_ms <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return clone(row.data);
  }

  setMemory(key, data, ttlSec) {
    this.memory.set(key, {
      data: clone(data),
      expires_at_ms: Date.now() + Math.max(1, Number(ttlSec) || 1) * 1000,
    });
  }

  async getRedis(key) {
    if (!this.redisEnabled || !this.getRedisClient) return null;
    const client = await this.getRedisClient().catch(() => null);
    if (!client) return null;
    try {
      const raw = await client.get(key);
      return raw ? parseJsonField(raw, null) : null;
    } catch {
      return null;
    }
  }

  async setRedis(key, data, ttlSec) {
    if (!this.redisEnabled || !this.getRedisClient) return;
    const client = await this.getRedisClient().catch(() => null);
    if (!client) return;
    try {
      await client.set(key, JSON.stringify(data), {
        EX: Math.max(1, Number(ttlSec) || 1),
      });
    } catch {}
  }

  async delRedis(key) {
    if (!this.redisEnabled || !this.getRedisClient) return;
    const client = await this.getRedisClient().catch(() => null);
    if (!client) return;
    try {
      await client.del(key);
    } catch {}
  }

  async getStaticObject(userId, objectType, objectId) {
    const cacheKey = this.staticCacheKey(userId, objectType, objectId);
    const cached = this.getMemory(cacheKey);
    if (cached) return cached;
    const row = await this.staticDal.getObject(userId, objectType, objectId);
    if (row) this.setMemory(cacheKey, row, this.staticCacheTtlSec);
    return row;
  }

  async upsertStaticObject(userId, objectType, objectId, data = {}, meta = {}) {
    const row = await this.staticDal.upsertObject(
      userId,
      objectType,
      objectId,
      data,
      meta,
    );
    this.setMemory(
      this.staticCacheKey(userId, objectType, objectId),
      row,
      this.staticCacheTtlSec,
    );
    return row;
  }

  async getDynamicObject(userId, objectType, objectId, { bypassCache = false } = {}) {
    const cacheKey = this.dynamicCacheKey(userId, objectType, objectId);
    if (!bypassCache) {
      const memoryHit = this.getMemory(cacheKey);
      if (memoryHit) return memoryHit;
      const redisHit = await this.getRedis(cacheKey);
      if (redisHit) {
        this.setMemory(cacheKey, redisHit, this.dynamicCacheTtlSec);
        return redisHit;
      }
    }
    const row = await this.dynamicDal.getObject(userId, objectType, objectId);
    if (row) {
      await this.setRedis(cacheKey, row, this.dynamicCacheTtlSec);
      this.setMemory(cacheKey, row, this.dynamicCacheTtlSec);
    }
    return row;
  }

  async listDynamicObjects(userId, objectType, { bypassCache = false } = {}) {
    const listKey = this.dynamicListCacheKey(userId, objectType);
    if (!bypassCache) {
      const memoryHit = this.getMemory(listKey);
      if (memoryHit) return memoryHit;
      const redisHit = await this.getRedis(listKey);
      if (redisHit) {
        this.setMemory(listKey, redisHit, this.dynamicCacheTtlSec);
        return redisHit;
      }
    }
    const rows = await this.dynamicDal.listObjects(userId, objectType);
    await this.setRedis(listKey, rows, this.dynamicCacheTtlSec);
    this.setMemory(listKey, rows, this.dynamicCacheTtlSec);
    for (const row of rows) {
      const objectKey = this.dynamicCacheKey(userId, objectType, row.object_id);
      await this.setRedis(objectKey, row, this.dynamicCacheTtlSec);
      this.setMemory(objectKey, row, this.dynamicCacheTtlSec);
    }
    return rows;
  }

  async upsertDynamicObject(
    userId,
    objectType,
    objectId,
    metadata = {},
    status = "ACTIVE",
    meta = {},
  ) {
    const row = await this.dynamicDal.upsertObject(
      userId,
      objectType,
      objectId,
      metadata,
      status,
      meta,
    );
    const cacheKey = this.dynamicCacheKey(userId, objectType, objectId);
    const listKey = this.dynamicListCacheKey(userId, objectType);
    await this.setRedis(cacheKey, row, this.dynamicCacheTtlSec);
    this.setMemory(cacheKey, row, this.dynamicCacheTtlSec);
    this.memory.delete(listKey);
    await this.delRedis(listKey);
    return row;
  }

  async deleteUnifiedObject(userId, objectType, objectId) {
    await this.staticDal.deleteObject(userId, objectType, objectId);
    await this.dynamicDal.deleteObject(userId, objectType, objectId);
    const staticKey = this.staticCacheKey(userId, objectType, objectId);
    const dynamicKey = this.dynamicCacheKey(userId, objectType, objectId);
    const listKey = this.dynamicListCacheKey(userId, objectType);
    this.memory.delete(staticKey);
    this.memory.delete(dynamicKey);
    this.memory.delete(listKey);
    await this.delRedis(dynamicKey);
    await this.delRedis(listKey);
  }

  mergeUnifiedObject(staticObject, dynamicRow) {
    const base = staticObject ? clone(staticObject) : {};
    const dynamicMeta = ensureObject(dynamicRow?.metadata);
    const staticMeta = ensureObject(base.metadata);
    const merged = {
      ...base,
      ...clone(dynamicMeta),
    };
    merged.metadata = mergePlainObjects(staticMeta, dynamicMeta);
    if (dynamicRow?.user_id && !merged.user_id) merged.user_id = dynamicRow.user_id;
    if (dynamicRow?.created_at && !merged.created_at) {
      merged.created_at = dynamicRow.created_at;
    }
    if (dynamicRow?.updated_at) merged.updated_at = dynamicRow.updated_at;
    if (dynamicRow?.status) merged.status = dynamicRow.status;
    if (!merged.object_type) {
      merged.object_type = dynamicRow?.object_type || staticObject?.object_type;
    }
    if (!merged.object_id) {
      merged.object_id = dynamicRow?.object_id || staticObject?.object_id;
    }
    return merged;
  }

  async getUnifiedObject(userId, objectType, objectId) {
    const [staticObject, dynamicRow] = await Promise.all([
      this.getStaticObject(userId, objectType, objectId),
      this.getDynamicObject(userId, objectType, objectId),
    ]);
    if (!staticObject && !dynamicRow) return null;
    return this.mergeUnifiedObject(staticObject, dynamicRow);
  }

  async listUnifiedObjects(userId, objectType) {
    const [staticRows, dynamicRows] = await Promise.all([
      this.staticDal.listObjects(userId, objectType),
      this.listDynamicObjects(userId, objectType),
    ]);
    const staticMap = new Map(staticRows.map((row) => [String(row.object_id), row]));
    const dynamicMap = new Map(dynamicRows.map((row) => [String(row.object_id), row]));
    const objectIds = new Set([...staticMap.keys(), ...dynamicMap.keys()]);
    const out = [];
    for (const objectId of objectIds) {
      out.push(
        this.mergeUnifiedObject(
          staticMap.get(objectId) || null,
          dynamicMap.get(objectId) || null,
        ),
      );
    }
    out.sort((a, b) =>
      `${a.created_at || ""}:${a.account_id || a.object_id}`.localeCompare(
        `${b.created_at || ""}:${b.account_id || b.object_id}`,
      ),
    );
    return out;
  }

  async findUnifiedObjectByStaticField(objectType, fieldName, fieldValue, userId = null) {
    const staticObject = await this.staticDal.findObjectByField(
      objectType,
      fieldName,
      fieldValue,
      userId,
    );
    if (!staticObject) return null;
    return this.getUnifiedObject(
      staticObject.user_id,
      objectType,
      staticObject.object_id,
    );
  }

  splitLegacyUserAccount(row = {}) {
    const userId =
      String(row.user_id || row.userId || "default").trim() || "default";
    const accountId = String(row.account_id || row.accountId || "").trim();
    const legacyMeta = parseJsonField(row.metadata, {});
    const dynamicMetadata = {
      ...clone(legacyMeta),
      balance:
        row.balance == null || Number.isNaN(Number(row.balance))
          ? null
          : Number(row.balance),
      equity:
        row.equity == null || Number.isNaN(Number(row.equity))
          ? null
          : Number(row.equity),
      margin:
        row.margin == null || Number.isNaN(Number(row.margin))
          ? null
          : Number(row.margin),
      free_margin:
        row.free_margin == null || Number.isNaN(Number(row.free_margin))
          ? null
          : Number(row.free_margin),
      leverage:
        row.leverage == null || Number.isNaN(Number(row.leverage))
          ? null
          : Number(row.leverage),
      health_updated_at:
        legacyMeta.health_updated_at ||
        row.updated_at ||
        row.updatedAt ||
        nowIso(),
      source_ids_cache: Array.isArray(row.source_ids_cache)
        ? clone(row.source_ids_cache)
        : parseJsonField(row.source_ids_cache, []),
    };
    delete dynamicMetadata.account_id;
    delete dynamicMetadata.user_id;
    delete dynamicMetadata.name;
    delete dynamicMetadata.status;
    delete dynamicMetadata.api_key_hash;
    delete dynamicMetadata.api_key_last4;
    delete dynamicMetadata.api_key_rotated_at;
    delete dynamicMetadata.broker_name;

    const staticObject = {
      account_id: accountId,
      user_id: userId,
      name: String(row.name || accountId),
      broker_name: String(row.broker_name || ""),
      status: String(row.status || "ACTIVE"),
      api_key_hash: row.api_key_hash ? String(row.api_key_hash) : null,
      api_key_last4: row.api_key_last4 ? String(row.api_key_last4) : null,
      api_key_rotated_at: row.api_key_rotated_at
        ? normalizeIso(row.api_key_rotated_at)
        : null,
      metadata: {},
      created_at: normalizeIso(row.created_at || row.createdAt),
      updated_at: normalizeIso(row.updated_at || row.updatedAt),
    };

    return {
      userId,
      accountId,
      staticObject,
      dynamicMetadata,
      dynamicStatus: String(row.status || "ACTIVE"),
      createdAt: normalizeIso(row.created_at || row.createdAt),
      updatedAt: normalizeIso(row.updated_at || row.updatedAt),
    };
  }

  async migrateLegacyUserAccounts(rows = []) {
    const migrated = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      const split = this.splitLegacyUserAccount(row);
      if (!split.accountId) continue;
      const currentStatic = await this.getStaticObject(
        split.userId,
        "user_accounts",
        split.accountId,
      );
      if (!currentStatic) {
        await this.upsertStaticObject(
          split.userId,
          "user_accounts",
          split.accountId,
          split.staticObject,
          {
            created_at: split.createdAt,
            updated_at: split.updatedAt,
          },
        );
      }
      const currentDynamic = await this.getDynamicObject(
        split.userId,
        "user_accounts",
        split.accountId,
        { bypassCache: true },
      );
      if (!currentDynamic) {
        await this.upsertDynamicObject(
          split.userId,
          "user_accounts",
          split.accountId,
          split.dynamicMetadata,
          split.dynamicStatus,
          { created_at: split.createdAt, updated_at: split.updatedAt },
        );
      }
      migrated.push(split.accountId);
    }
    return migrated;
  }
}

function createUserObjectStore(options = {}) {
  return new UnifiedUserObjectStore(options);
}

module.exports = {
  USERS_ROOT,
  safePathPart,
  parseJsonField,
  createUserObjectStore,
  UnifiedUserObjectStore,
};
