"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { TABLE_NAME, sqliteSchema, postgresSchema } = require("./schema");

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    ...row,
    progress: Number(row.progress || 0),
    downloaded_bytes: Number(row.downloaded_bytes || 0),
    total_bytes: Number(row.total_bytes || 0),
    output_files: parseJson(row.output_files_json, []),
    options: parseJson(row.options_json, {}),
    output_files_json: undefined,
    options_json: undefined,
  };
}

function createSqliteProvider(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(sqliteSchema);
  const recoveredAt = new Date().toISOString();
  db.prepare(
    `UPDATE ${TABLE_NAME}
     SET status = 'failed', error_message = 'Download interrupted by API restart',
         completed_at = ?, updated_at = ?
     WHERE status IN ('queued', 'running')`,
  ).run(recoveredAt, recoveredAt);
  const insert = db.prepare(`
    INSERT INTO ${TABLE_NAME} (
      sid, user_id, source_url, source_title, extractor, media_kind,
      requested_format, status, progress, downloaded_bytes, total_bytes,
      speed_text, eta_text, output_files_json, options_json, error_message,
      created_at, updated_at, started_at, completed_at
    ) VALUES (
      @sid, @user_id, @source_url, @source_title, @extractor, @media_kind,
      @requested_format, @status, @progress, @downloaded_bytes, @total_bytes,
      @speed_text, @eta_text, @output_files_json, @options_json, @error_message,
      @created_at, @updated_at, @started_at, @completed_at
    )
  `);
  return {
    key: `sqlite:${filePath}`,
    async create(job) {
      insert.run({
        ...job,
        output_files_json: JSON.stringify(job.output_files || []),
        options_json: JSON.stringify(job.options || {}),
      });
      return normalizeRow(db.prepare(`SELECT * FROM ${TABLE_NAME} WHERE sid = ?`).get(job.sid));
    },
    async update(sid, patch) {
      const allowed = [
        "source_title", "extractor", "status", "progress", "downloaded_bytes",
        "total_bytes", "speed_text", "eta_text", "error_message", "updated_at",
        "started_at", "completed_at",
      ];
      const next = { ...patch };
      if (Object.hasOwn(next, "output_files")) {
        next.output_files_json = JSON.stringify(next.output_files || []);
        delete next.output_files;
        allowed.push("output_files_json");
      }
      const keys = allowed.filter((key) => Object.hasOwn(next, key));
      if (keys.length) {
        const assignments = keys.map((key) => `${key} = @${key}`).join(", ");
        db.prepare(`UPDATE ${TABLE_NAME} SET ${assignments} WHERE sid = @sid`).run({ sid, ...next });
      }
      return normalizeRow(db.prepare(`SELECT * FROM ${TABLE_NAME} WHERE sid = ?`).get(sid));
    },
    async get(sid, userId) {
      return normalizeRow(
        db.prepare(`SELECT * FROM ${TABLE_NAME} WHERE sid = ? AND user_id = ?`).get(sid, userId),
      );
    },
    async list(userId, limit) {
      return db
        .prepare(`SELECT * FROM ${TABLE_NAME} WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
        .all(userId, limit)
        .map(normalizeRow);
    },
  };
}

async function createPostgresProvider(pool) {
  await pool.query(postgresSchema);
  await pool.query(
    `UPDATE ${TABLE_NAME}
     SET status = 'failed', error_message = 'Download interrupted by API restart',
         completed_at = NOW(), updated_at = NOW()
     WHERE status IN ('queued', 'running')`,
  );
  const columns = [
    "sid", "user_id", "source_url", "source_title", "extractor", "media_kind",
    "requested_format", "status", "progress", "downloaded_bytes", "total_bytes",
    "speed_text", "eta_text", "output_files_json", "options_json", "error_message",
    "created_at", "updated_at", "started_at", "completed_at",
  ];
  return {
    key: "postgres",
    async create(job) {
      const values = columns.map((key) => {
        if (key === "output_files_json") return JSON.stringify(job.output_files || []);
        if (key === "options_json") return JSON.stringify(job.options || {});
        return job[key] ?? null;
      });
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
      const result = await pool.query(
        `INSERT INTO ${TABLE_NAME} (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`,
        values,
      );
      return normalizeRow(result.rows[0]);
    },
    async update(sid, patch) {
      const allowed = [
        "source_title", "extractor", "status", "progress", "downloaded_bytes",
        "total_bytes", "speed_text", "eta_text", "error_message", "updated_at",
        "started_at", "completed_at", "output_files",
      ];
      const keys = allowed.filter((key) => Object.hasOwn(patch, key));
      if (!keys.length) return null;
      const values = keys.map((key) =>
        key === "output_files" ? JSON.stringify(patch[key] || []) : patch[key],
      );
      const assignments = keys.map((key, index) => {
        const column = key === "output_files" ? "output_files_json" : key;
        const cast = key === "output_files" ? "::jsonb" : "";
        return `${column} = $${index + 1}${cast}`;
      });
      const result = await pool.query(
        `UPDATE ${TABLE_NAME} SET ${assignments.join(", ")} WHERE sid = $${keys.length + 1} RETURNING *`,
        [...values, sid],
      );
      return normalizeRow(result.rows[0]);
    },
    async get(sid, userId) {
      const result = await pool.query(
        `SELECT * FROM ${TABLE_NAME} WHERE sid = $1 AND user_id = $2`,
        [sid, userId],
      );
      return normalizeRow(result.rows[0]);
    },
    async list(userId, limit) {
      const result = await pool.query(
        `SELECT * FROM ${TABLE_NAME} WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, limit],
      );
      return result.rows.map(normalizeRow);
    },
  };
}

function createYtDlpRepo({ dataRoot, getBackend }) {
  const providers = new Map();
  async function provider() {
    const backend = (await getBackend?.()) || { storage: "sqlite", pool: null };
    if (backend.storage === "postgres" && backend.pool) {
      if (!providers.has("postgres")) {
        providers.set("postgres", await createPostgresProvider(backend.pool));
      }
      return providers.get("postgres");
    }
    const filePath = path.join(dataRoot, "modules", "yt-dlp", "data.db");
    const key = `sqlite:${filePath}`;
    if (!providers.has(key)) providers.set(key, createSqliteProvider(filePath));
    return providers.get(key);
  }
  return {
    create: async (job) => (await provider()).create(job),
    update: async (sid, patch) => (await provider()).update(sid, patch),
    get: async (sid, userId) => (await provider()).get(sid, userId),
    list: async (userId, limit = 100) => (await provider()).list(userId, limit),
  };
}

module.exports = { createYtDlpRepo, normalizeRow };
