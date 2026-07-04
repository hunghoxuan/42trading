"use strict";

const { Pool } = require("pg");

const jsonProvider = require("./jsonObjectStoreProvider");

let sharedPool = null;
let initPromise = null;

function resolvePostgresUrl(options = {}) {
  return String(
    options.postgresUrl ||
      options.connectionString ||
      process.env.OBJECT_STORE_POSTGRES_URL ||
      process.env.MT5_POSTGRES_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRE_URL ||
      "",
  ).trim();
}

function getPool(options = {}) {
  if (options.pool && typeof options.pool.query === "function") return options.pool;
  if (sharedPool) return sharedPool;

  const connectionString = resolvePostgresUrl(options);
  if (!connectionString) {
    throw new Error(
      'Object store provider "postgres" requires OBJECT_STORE_POSTGRES_URL, MT5_POSTGRES_URL, POSTGRES_URL, or POSTGRE_URL',
    );
  }

  sharedPool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  sharedPool.on("error", (err) => {
    console.error("[object-store:postgres] pool error", err);
  });
  return sharedPool;
}

async function ensureSchema(options = {}) {
  const pool = getPool(options);
  if (!initPromise) {
    initPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS object_store (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        value TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, type, name)
      );
      CREATE INDEX IF NOT EXISTS idx_object_store_user_type_name
        ON object_store(user_id, type, name);
      CREATE INDEX IF NOT EXISTS idx_object_store_user_type
        ON object_store(user_id, type);
    `);
  }
  await initPromise;
  return pool;
}

function normalizedUserId(userId) {
  return String(userId || "default").trim() || "default";
}

function normalizedObjectId(objectId) {
  return String(objectId || "default").trim() || "default";
}

function rowFromPostgres(row) {
  if (!row) return null;
  const type = jsonProvider.canonicalObjectType(row.type);
  return {
    id: row.id,
    user_id: row.user_id,
    userId: row.user_id,
    type,
    object_type: type,
    name: row.name,
    object_id: row.name,
    data: jsonProvider.parseJsonField(row.data) || {},
    value: row.value ?? null,
    status: row.status || "ACTIVE",
    created_at: new Date(row.created_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

module.exports = {
  ...jsonProvider,
  name: "postgres",
  kind: "database",
  resolvePostgresUrl,
  async listObjectsByType(userId, objectType, options = {}) {
    const pool = await ensureSchema(options);
    const params = [jsonProvider.canonicalObjectType(objectType)];
    let sql = `
      SELECT id, user_id, type, name, data, value, status, created_at, updated_at
      FROM object_store
      WHERE type = $1
    `;
    if (userId) {
      params.push(normalizedUserId(userId));
      sql += ` AND user_id = $2`;
    }
    sql += ` ORDER BY user_id, type, name`;
    const result = await pool.query(sql, params);
    return (result.rows || []).map((row) => rowFromPostgres(row)).filter(Boolean);
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
    const pool = await ensureSchema(options);
    const result = await pool.query(
      `
        SELECT id, user_id, type, name, data, value, status, created_at, updated_at
        FROM object_store
        WHERE user_id = $1 AND type = $2 AND name = $3
        LIMIT 1
      `,
      [
        normalizedUserId(userId),
        jsonProvider.canonicalObjectType(objectType),
        normalizedObjectId(objectId),
      ],
    );
    return rowFromPostgres(result.rows?.[0]);
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
    const pool = await ensureSchema(options);
    const row = {
      id:
        meta.id ||
        `${normalizedUserId(userId)}:${jsonProvider.canonicalObjectType(objectType)}:${normalizedObjectId(objectId)}`,
      user_id: normalizedUserId(userId),
      type: jsonProvider.canonicalObjectType(objectType),
      name: normalizedObjectId(objectId),
      data: data || {},
      value: meta.value ?? null,
      status: String(status || "ACTIVE"),
      created_at: meta.created_at || meta.createdAt || new Date().toISOString(),
      updated_at: meta.updated_at || meta.updatedAt || new Date().toISOString(),
    };

    const result = await pool.query(
      `
        INSERT INTO object_store (id, user_id, type, name, data, value, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::timestamptz, $9::timestamptz)
        ON CONFLICT (user_id, type, name) DO UPDATE SET
          id = EXCLUDED.id,
          data = EXCLUDED.data,
          value = EXCLUDED.value,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at
        RETURNING id, user_id, type, name, data, value, status, created_at, updated_at
      `,
      [
        row.id,
        row.user_id,
        row.type,
        row.name,
        JSON.stringify(row.data || {}),
        row.value,
        row.status,
        row.created_at,
        row.updated_at,
      ],
    );
    const stored = rowFromPostgres(result.rows?.[0]);
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
    const pool = await ensureSchema(options);
    await pool.query(
      `DELETE FROM object_store WHERE user_id = $1 AND type = $2 AND name = $3`,
      [
        normalizedUserId(userId),
        jsonProvider.canonicalObjectType(objectType),
        normalizedObjectId(objectId),
      ],
    );
  },
};
