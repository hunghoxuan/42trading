"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const {
  objectDir: sharedObjectDir,
  objectDataPath: sharedObjectDataPath,
  objectLogsDir: sharedObjectLogsDir,
  safePathPart: sharedSafePathPart,
} = require("./objectStore");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
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
  return sharedSafePathPart(value, fallback);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function parseJsonField(value, fallback = {}) {
  if (value === null || value === undefined || value === "")
    return clone(fallback);
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
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function mergePlainObjects(baseValue, overrideValue) {
  const base = ensureObject(baseValue);
  const override = ensureObject(overrideValue);
  return { ...clone(base), ...clone(override) };
}

async function ensurePrivateDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true, mode: 0o700 });
}

async function writeJsonAtomic(filePath, value) {
  await ensurePrivateDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await fsp.writeFile(tmpPath, body, { mode: 0o600 });
  await fsp.rename(tmpPath, filePath);
}

async function listJsonFilesRecursive(dirPath) {
  let entries = [];
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  const out = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory())
      out.push(...(await listJsonFilesRecursive(fullPath)));
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(fullPath);
  }
  return out;
}

class StaticJsonObjectDal {
  constructor({ usersRoot = USERS_ROOT, logger = console } = {}) {
    this.usersRoot = usersRoot;
    this.logger = logger;
    this.writeQueues = new Map();
  }

  userRoot(userId) {
    return path.join(this.usersRoot, safePathPart(userId));
  }

  objectDir(userId, objectType) {
    return path.join(
      this.userRoot(userId),
      safePathPart(objectType, "objects"),
    );
  }

  objectFolderDir(userId, objectType, objectId) {
    return sharedObjectDir(userId, objectType, objectId);
  }

  objectPath(userId, objectType, objectId) {
    return sharedObjectDataPath(userId, objectType, objectId);
  }

  objectLogsDir(userId, objectType, objectId) {
    return sharedObjectLogsDir(userId, objectType, objectId);
  }

  legacyObjectPath(userId, objectType, objectId) {
    return path.join(
      this.objectDir(userId, objectType),
      `${safePathPart(objectId, "default")}.json`,
    );
  }

  async queueForPath(filePath, fn) {
    const prev = this.writeQueues.get(filePath) || Promise.resolve();
    const next = prev.then(fn, fn).finally(() => {
      if (this.writeQueues.get(filePath) === next)
        this.writeQueues.delete(filePath);
    });
    this.writeQueues.set(filePath, next);
    return next;
  }

  normalizeStaticObject(userId, objectType, objectId, data = {}, meta = {}) {
    const now = nowIso();
    const existing = ensureObject(data);
    return {
      object_type: String(objectType || ""),
      object_id: String(objectId || ""),
      user_id: String(userId || ""),
      created_at: normalizeIso(meta.created_at || existing.created_at, now),
      updated_at: normalizeIso(meta.updated_at || existing.updated_at, now),
      ...clone(existing),
    };
  }

  async readObjectFile(userId, objectType, objectId, filePath) {
    const raw = await fsp.readFile(filePath, "utf8");
    const parsed = parseJsonField(raw, null);
    if (!parsed || typeof parsed !== "object") return null;
    return this.normalizeStaticObject(
      userId,
      objectType,
      objectId,
      parsed,
      parsed,
    );
  }

  async getObject(userId, objectType, objectId) {
    const filePath = this.objectPath(userId, objectType, objectId);
    try {
      return await this.readObjectFile(userId, objectType, objectId, filePath);
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }

    const legacyPath = this.legacyObjectPath(userId, objectType, objectId);
    try {
      return await this.readObjectFile(
        userId,
        objectType,
        objectId,
        legacyPath,
      );
    } catch (err) {
      if (err && err.code === "ENOENT") return null;
      throw err;
    }
  }

  async upsertObject(userId, objectType, objectId, data = {}, meta = {}) {
    const filePath = this.objectPath(userId, objectType, objectId);
    return this.queueForPath(filePath, async () => {
      const prev = await this.getObject(userId, objectType, objectId);
      const row = this.normalizeStaticObject(
        userId,
        objectType,
        objectId,
        {
          ...(prev || {}),
          ...clone(data),
        },
        {
          created_at: meta.created_at || prev?.created_at,
          updated_at: meta.updated_at || nowIso(),
        },
      );
      await ensurePrivateDir(this.objectLogsDir(userId, objectType, objectId));
      await writeJsonAtomic(filePath, row);
      const legacyPath = this.legacyObjectPath(userId, objectType, objectId);
      if (legacyPath !== filePath) {
        try {
          await fsp.unlink(legacyPath);
        } catch (err) {
          if (!err || err.code !== "ENOENT") throw err;
        }
      }
      return row;
    });
  }

  async deleteObject(userId, objectType, objectId) {
    const filePath = this.objectPath(userId, objectType, objectId);
    return this.queueForPath(filePath, async () => {
      await fsp.rm(this.objectFolderDir(userId, objectType, objectId), {
        recursive: true,
        force: true,
      });
      try {
        await fsp.unlink(this.legacyObjectPath(userId, objectType, objectId));
      } catch (err) {
        if (!err || err.code !== "ENOENT") throw err;
      }
    });
  }

  async listObjects(userId, objectType) {
    const rows = [];
    const seen = new Set();
    const files = await listJsonFilesRecursive(
      this.objectDir(userId, objectType),
    );
    for (const filePath of files) {
      try {
        const objectId = path.basename(path.dirname(filePath));
        if (!objectId || path.basename(filePath) !== "data.json") continue;
        const row = await this.readObjectFile(
          userId,
          objectType,
          objectId,
          filePath,
        );
        if (!row) continue;
        rows.push(row);
        seen.add(String(row.object_id));
      } catch (err) {
        this.logger.warn?.(
          `[user-object-store] failed reading static file ${filePath}: ${err.message}`,
        );
      }
    }

    const legacyDir = this.objectDir(userId, objectType);
    let legacyEntries = [];
    try {
      legacyEntries = await fsp.readdir(legacyDir, { withFileTypes: true });
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }
    for (const entry of legacyEntries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const objectId = path.basename(entry.name, ".json");
      if (seen.has(objectId)) continue;
      const filePath = path.join(legacyDir, entry.name);
      try {
        const row = await this.readObjectFile(
          userId,
          objectType,
          objectId,
          filePath,
        );
        if (!row) continue;
        rows.push(row);
        seen.add(String(row.object_id));
      } catch (err) {
        this.logger.warn?.(
          `[user-object-store] failed reading legacy static file ${filePath}: ${err.message}`,
        );
      }
    }

    rows.sort((a, b) =>
      `${a.object_type}:${a.object_id}`.localeCompare(
        `${b.object_type}:${b.object_id}`,
      ),
    );
    return rows;
  }

  async listUsersWithObjectType(objectType) {
    let entries = [];
    try {
      entries = await fsp.readdir(this.usersRoot, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === "ENOENT") return [];
      throw err;
    }
    const out = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = this.objectDir(entry.name, objectType);
      if (fs.existsSync(candidate)) out.push(entry.name);
    }
    return out;
  }

  async findObjectByField(objectType, fieldName, fieldValue, userId = null) {
    const users = userId
      ? [String(userId)]
      : await this.listUsersWithObjectType(objectType);
    const target = String(fieldValue ?? "");
    for (const uid of users) {
      const rows = await this.listObjects(uid, objectType);
      const found = rows.find(
        (row) => String(row?.[fieldName] ?? "") === target,
      );
      if (found) return found;
    }
    return null;
  }
}

class DynamicSqliteObjectDal {
  constructor({ usersRoot = USERS_ROOT } = {}) {
    this.usersRoot = usersRoot;
    this.dbCache = new Map();
  }

  userRoot(userId) {
    return path.join(this.usersRoot, safePathPart(userId));
  }

  dbPath(userId) {
    return path.join(this.userRoot(userId), "data.db");
  }

  ensureDb(userId) {
    const dbPath = this.dbPath(userId);
    if (!this.dbCache.has(dbPath)) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
      const db = new DatabaseSync(dbPath);
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS user_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          object_type TEXT NOT NULL,
          object_id TEXT NOT NULL,
          metadata TEXT NOT NULL,
          status TEXT DEFAULT 'ACTIVE',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(object_type, object_id)
        );
        CREATE INDEX IF NOT EXISTS idx_user_data_object_type ON user_data(object_type);
        CREATE INDEX IF NOT EXISTS idx_user_data_object_type_id ON user_data(object_type, object_id);
      `);
      this.dbCache.set(dbPath, db);
    }
    return this.dbCache.get(dbPath);
  }

  normalizeDynamicRow(userId, row = {}) {
    if (!row || typeof row !== "object") return null;
    const objectType = String(row.object_type || "").trim();
    const objectId = String(row.object_id || "").trim();
    if (!objectType || !objectId) return null;
    return {
      user_id: String(userId || ""),
      object_type: objectType,
      object_id: objectId,
      metadata: parseJsonField(row.metadata, {}),
      status: String(row.status || "ACTIVE"),
      created_at: normalizeIso(row.created_at),
      updated_at: normalizeIso(row.updated_at),
    };
  }

  getObject(userId, objectType, objectId) {
    const db = this.ensureDb(userId);
    const stmt = db.prepare(`
      SELECT object_type, object_id, metadata, status, created_at, updated_at
      FROM user_data
      WHERE object_type = ? AND object_id = ?
      LIMIT 1
    `);
    const row = stmt.get(String(objectType || ""), String(objectId || ""));
    return this.normalizeDynamicRow(userId, row);
  }

  listObjects(userId, objectType) {
    const db = this.ensureDb(userId);
    const stmt = db.prepare(`
      SELECT object_type, object_id, metadata, status, created_at, updated_at
      FROM user_data
      WHERE object_type = ?
      ORDER BY created_at ASC, object_id ASC
    `);
    const rows = stmt.all(String(objectType || ""));
    return rows
      .map((row) => this.normalizeDynamicRow(userId, row))
      .filter(Boolean);
  }

  upsertObject(
    userId,
    objectType,
    objectId,
    metadata = {},
    status = "ACTIVE",
    meta = {},
  ) {
    const db = this.ensureDb(userId);
    const prev = this.getObject(userId, objectType, objectId);
    const now = nowIso();
    const createdAt = normalizeIso(meta.created_at || prev?.created_at, now);
    const updatedAt = normalizeIso(meta.updated_at || now, now);
    const stmt = db.prepare(`
      INSERT INTO user_data (
        object_type, object_id, metadata, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(object_type, object_id) DO UPDATE SET
        metadata = excluded.metadata,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      String(objectType || ""),
      String(objectId || ""),
      stableStringify(metadata || {}),
      String(status || "ACTIVE"),
      createdAt,
      updatedAt,
    );
    return this.getObject(userId, objectType, objectId);
  }

  deleteObject(userId, objectType, objectId) {
    const db = this.ensureDb(userId);
    db.prepare(
      `DELETE FROM user_data WHERE object_type = ? AND object_id = ?`,
    ).run(String(objectType || ""), String(objectId || ""));
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
    this.staticDal = new StaticJsonObjectDal({ usersRoot, logger });
    this.dynamicDal = new DynamicSqliteObjectDal({ usersRoot });
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
      await client.set(key, stableStringify(data), {
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

  async getDynamicObject(
    userId,
    objectType,
    objectId,
    { bypassCache = false } = {},
  ) {
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
    const row = this.dynamicDal.getObject(userId, objectType, objectId);
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
    const rows = this.dynamicDal.listObjects(userId, objectType);
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
    const row = this.dynamicDal.upsertObject(
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
    this.dynamicDal.deleteObject(userId, objectType, objectId);
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
    const mergedMetadata = mergePlainObjects(staticMeta, dynamicMeta);
    merged.metadata = mergedMetadata;
    if (
      base.broker &&
      typeof base.broker === "object" &&
      (!merged.broker || typeof merged.broker !== "object")
    ) {
      merged.broker = clone(base.broker);
    }
    if (
      base.connection &&
      typeof base.connection === "object" &&
      (!merged.connection || typeof merged.connection !== "object")
    ) {
      merged.connection = clone(base.connection);
    }
    if (dynamicRow?.user_id && !merged.user_id) merged.user_id = dynamicRow.user_id;
    if (dynamicRow?.created_at && !merged.created_at)
      merged.created_at = dynamicRow.created_at;
    if (dynamicRow?.updated_at) merged.updated_at = dynamicRow.updated_at;
    if (dynamicRow?.status) merged.status = dynamicRow.status;
    if (!merged.object_type)
      merged.object_type = dynamicRow?.object_type || staticObject?.object_type;
    if (!merged.object_id)
      merged.object_id = dynamicRow?.object_id || staticObject?.object_id;
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
    const staticMap = new Map(
      staticRows.map((row) => [String(row.object_id), row]),
    );
    const dynamicMap = new Map(
      dynamicRows.map((row) => [String(row.object_id), row]),
    );
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

  async findUnifiedObjectByStaticField(
    objectType,
    fieldName,
    fieldValue,
    userId = null,
  ) {
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
        {
          bypassCache: true,
        },
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
