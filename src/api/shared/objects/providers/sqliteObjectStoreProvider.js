"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const jsonProvider = require("./jsonObjectStoreProvider");

const SQLITE_DBS = new Map();

function resolveObjectStoreSqlitePath(userId, options = {}) {
  const explicit = String(options.sqlitePath || "").trim();
  if (explicit) return explicit;
  const envPath = String(process.env.OBJECT_STORE_SQLITE_PATH || "").trim();
  if (envPath) return envPath;
  return path.join(jsonProvider.userRootDir(userId, options), "object_store.db");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
}

function openDb(dbPath) {
  if (SQLITE_DBS.has(dbPath)) return SQLITE_DBS.get(dbPath);

  ensureDir(path.dirname(dbPath));
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS object_store (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      value TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, type, name)
    );
    CREATE INDEX IF NOT EXISTS idx_object_store_user_type_name
      ON object_store(user_id, type, name);
    CREATE INDEX IF NOT EXISTS idx_object_store_user_type
      ON object_store(user_id, type);
  `);
  SQLITE_DBS.set(dbPath, db);
  return db;
}

function rowFromSqlite(row) {
  if (!row) return null;
  return jsonProvider.parseJsonField(row.data) !== null
    ? {
        id: row.id,
        user_id: row.user_id,
        userId: row.user_id,
        type: jsonProvider.canonicalObjectType(row.type),
        object_type: jsonProvider.canonicalObjectType(row.type),
        name: row.name,
        object_id: row.name,
        data: jsonProvider.parseJsonField(row.data) || {},
        value: row.value ?? null,
        status: row.status || "ACTIVE",
        created_at: row.created_at,
        createdAt: row.created_at,
        updated_at: row.updated_at,
        updatedAt: row.updated_at,
      }
    : null;
}

function normalizedUserId(userId) {
  return String(userId || "default").trim() || "default";
}

function normalizedObjectId(objectId) {
  return String(objectId || "default").trim() || "default";
}

async function readDbObject(userId, objectType, objectId = "default", options = {}) {
  const db = openDb(resolveObjectStoreSqlitePath(userId, options));
  const row = db
    .prepare(
      `SELECT id, user_id, type, name, data, value, status, created_at, updated_at
       FROM object_store
       WHERE user_id = ? AND type = ? AND name = ?
       LIMIT 1`,
    )
    .get(
      normalizedUserId(userId),
      jsonProvider.canonicalObjectType(objectType),
      normalizedObjectId(objectId),
    );
  return rowFromSqlite(row);
}

async function listDbObjectsForUser(userId, objectType, options = {}) {
  const dbPath = resolveObjectStoreSqlitePath(userId, options);
  if (!fs.existsSync(dbPath)) return [];
  const db = openDb(dbPath);
  const rows = db
    .prepare(
      `SELECT id, user_id, type, name, data, value, status, created_at, updated_at
       FROM object_store
       WHERE user_id = ? AND type = ?
       ORDER BY user_id, type, name`,
    )
    .all(normalizedUserId(userId), jsonProvider.canonicalObjectType(objectType));
  return rows.map((row) => rowFromSqlite(row)).filter(Boolean);
}

async function listKnownUsers() {
  let entries = [];
  try {
    entries = fs.readdirSync(jsonProvider.DATA_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

module.exports = {
  ...jsonProvider,
  name: "sqlite",
  kind: "database",
  resolveObjectStoreSqlitePath,
  async listObjectsByType(userId, objectType, options = {}) {
    const users = userId ? [normalizedUserId(userId)] : await listKnownUsers();
    const rows = [];
    for (const uid of users) {
      rows.push(...(await listDbObjectsForUser(uid, objectType, options)));
    }
    rows.sort((a, b) =>
      `${a.user_id}:${a.type}:${a.name}`.localeCompare(
        `${b.user_id}:${b.type}:${b.name}`,
      ),
    );
    return rows;
  },
  async listObjectsByTypeWithLegacyFallback(userId, objectType, options = {}) {
    const rows = await this.listObjectsByType(userId, objectType, options);
    const fallbackRows = await jsonProvider.listObjectsByTypeWithLegacyFallback(
      userId,
      objectType,
    );
    const seen = new Set(rows.map((row) => `${row.user_id}:${row.name}`));
    for (const row of fallbackRows) {
      const key = `${row.user_id}:${row.name}`;
      if (seen.has(key)) continue;
      rows.push(row);
      seen.add(key);
    }
    rows.sort((a, b) =>
      `${a.user_id}:${a.type}:${a.name}`.localeCompare(
        `${b.user_id}:${b.type}:${b.name}`,
      ),
    );
    return rows;
  },
  async getObject(userId, objectType, objectId = "default", options = {}) {
    return readDbObject(userId, objectType, objectId, options);
  },
  async getObjectWithLegacyFallback(
    userId,
    objectType,
    objectId = "default",
    options = {},
  ) {
    const row = await this.getObject(userId, objectType, objectId, options);
    if (row) return row;
    return jsonProvider.getObjectWithLegacyFallback(userId, objectType, objectId);
  },
  async getObjectData(userId, objectType, objectId = "default", options = {}) {
    const row = await this.getObject(userId, objectType, objectId, options);
    return row ? row.data : null;
  },
  async getObjectDataWithLegacyFallback(
    userId,
    objectType,
    objectId = "default",
    options = {},
  ) {
    const row = await this.getObjectWithLegacyFallback(
      userId,
      objectType,
      objectId,
      options,
    );
    return row ? row.data : null;
  },
  async upsertObject(
    userId,
    objectType,
    objectId,
    data,
    status = "ACTIVE",
    meta = {},
    options = {},
  ) {
    const canonicalType = jsonProvider.canonicalObjectType(objectType);
    const normalizedUser = normalizedUserId(userId);
    const normalizedName = normalizedObjectId(objectId);
    const existing = await this.getObject(
      normalizedUser,
      canonicalType,
      normalizedName,
      options,
    );
    const now = new Date().toISOString();
    const row = {
      id: meta.id || existing?.id || `${normalizedUser}:${canonicalType}:${normalizedName}`,
      user_id: normalizedUser,
      type: canonicalType,
      name: normalizedName,
      data: data || {},
      value: meta.value ?? existing?.value ?? null,
      status: String(status || existing?.status || "ACTIVE"),
      created_at:
        meta.created_at || meta.createdAt || existing?.created_at || now,
      updated_at: meta.updated_at || meta.updatedAt || now,
    };
    const db = openDb(resolveObjectStoreSqlitePath(normalizedUser, options));
    db.prepare(
      `INSERT INTO object_store (id, user_id, type, name, data, value, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, type, name) DO UPDATE SET
         id = excluded.id,
         data = excluded.data,
         value = excluded.value,
         status = excluded.status,
         created_at = object_store.created_at,
         updated_at = excluded.updated_at`,
    ).run(
      row.id,
      row.user_id,
      row.type,
      row.name,
      JSON.stringify(row.data || {}),
      row.value,
      row.status,
      row.created_at,
      row.updated_at,
    );
    const stored = await this.getObject(row.user_id, row.type, row.name, options);
    return stored ? [stored] : [];
  },
  async putObjectRow(row, options = {}) {
    if (!row || typeof row !== "object") return [];
    const normalized = {
      ...row,
      data: jsonProvider.parseJsonField(row.data) || {},
    };
    return this.upsertObject(
      normalized.user_id || normalized.userId,
      normalized.type || normalized.object_type,
      normalized.name || normalized.object_id,
      normalized.data,
      normalized.status,
      normalized,
      options,
    );
  },
  async deleteObject(userId, objectType, objectId = "default", options = {}) {
    const dbPath = resolveObjectStoreSqlitePath(userId, options);
    if (!fs.existsSync(dbPath)) return;
    const db = openDb(dbPath);
    db.prepare(
      `DELETE FROM object_store WHERE user_id = ? AND type = ? AND name = ?`,
    ).run(
      normalizedUserId(userId),
      jsonProvider.canonicalObjectType(objectType),
      normalizedObjectId(objectId),
    );
  },
};
