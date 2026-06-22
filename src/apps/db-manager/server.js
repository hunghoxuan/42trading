"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const APP_DIR = __dirname;
const TRADING_DIR =
  process.env.TRADING_DIR || path.resolve(__dirname, "../../..");
const ADMIN_SHARED_CSS_PATH = path.join(
  TRADING_DIR,
  "src/shared/styles/admin.css",
);
const SHARED_SITE_NAVIGATION_CSS_PATH = path.join(
  TRADING_DIR,
  "src/shared/components/SiteNavigation.css",
);
const SHARED_RESPONSIVE_PANEL_CSS_PATH = path.join(
  TRADING_DIR,
  "src/shared/components/ResponsivePanel.css",
);
const MINIAPP_BRIDGE_CLIENT_PATH = path.join(
  TRADING_DIR,
  "src/shared/bridge/miniappBridgeClient.js",
);
const DB_MANAGER_CSS_PATH = path.join(APP_DIR, "db-manager.css");
const DB_MANAGER_SHELL_TEMPLATE_PATH = path.join(APP_DIR, "shell.html");
const DB_MANAGER_MAIN_APP_URL =
  process.env.DB_MANAGER_MAIN_APP_URL || "http://127.0.0.1:3000";
const CONFIG_PATH =
  process.env.DB_MANAGER_CONFIG ||
  path.join(TRADING_DIR, "src/apps/.local/db-manager/connections.json");

function readSharedAsset(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.warn(`[db-manager] Failed to read shared asset ${filePath}: ${err.message}`);
    return fallback;
  }
}

// Always load credentials from src/api/.env (single source of truth)
const WEBHOOK_ENV_PATH = path.join(TRADING_DIR, "src/api/.env");
function loadEnvFile() {
  const vars = {};
  if (!fs.existsSync(WEBHOOK_ENV_PATH)) return vars;
  const raw = fs.readFileSync(WEBHOOK_ENV_PATH, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    vars[key] = value;
  }
  return vars;
}

let pg;
try {
  pg = require("pg");
} catch (err) {
  console.error(
    "[db-manager] Missing pg dependency. Run `pnpm install` at the repo root first.",
  );
  process.exit(1);
}

const { Pool } = pg;
const pools = new Map();

function sameConnectionTarget(a, b) {
  try {
    const ua = new URL(String(a || ""));
    const ub = new URL(String(b || ""));
    return (
      ua.protocol === ub.protocol &&
      ua.hostname === ub.hostname &&
      (ua.port || "5432") === (ub.port || "5432") &&
      ua.pathname === ub.pathname
    );
  } catch {
    return String(a || "").trim() === String(b || "").trim();
  }
}

function formatConnectionDisplayName(connection = {}) {
  const rawName = String(connection?.name || connection?.id || "").trim();
  const rawConnectionString = String(connection?.connectionString || "").trim();
  if (!rawConnectionString) return rawName;
  if (rawConnectionString.startsWith("sqlite:")) {
    const dbPath = rawConnectionString.slice("sqlite:".length);
    const folder = path.basename(path.dirname(dbPath));
    const file = path.basename(dbPath);
    const shortPath = folder && file ? `${folder}/${file}` : file || dbPath;
    return `sqlite: ${shortPath} - ${rawName}`;
  }
  try {
    const parsed = new URL(rawConnectionString);
    const proto =
      parsed.protocol === "postgresql:" || parsed.protocol === "postgres:"
        ? "postgres"
        : parsed.protocol.replace(/:$/, "");
    const host = parsed.hostname || "unknown";
    const port = parsed.port || "5432";
    const dbName = parsed.pathname.replace(/^\/+/, "") || "";
    const target = dbName ? `${host}:${port}/${dbName}` : `${host}:${port}`;
    return `${proto}: ${target} - ${rawName}`;
  } catch {
    return rawName;
  }
}

function readConfig() {
  const env = loadEnvFile();
  const connections = [];
  const seenIds = new Set();
  const resolveSqlitePath = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return path.isAbsolute(raw) ? raw : path.resolve(TRADING_DIR, raw);
  };
  const addConnection = (conn) => {
    const id = String(conn?.id || "").trim();
    const connectionString = String(conn?.connectionString || "").trim();
    if (!id || !connectionString || seenIds.has(id)) return;
    if (
      connections.some((existing) =>
        sameConnectionTarget(existing.connectionString, connectionString),
      )
    ) {
      return;
    }
    seenIds.add(id);
    connections.push({
      id,
      name: String(conn?.name || id).trim(),
      connectionString,
      note: String(conn?.note || "").trim(),
    });
  };

  addConnection({
    id: "local",
    name: "Local DB",
    connectionString: env.MT5_POSTGRES_URL_LOCAL,
    note: "From src/api/.env MT5_POSTGRES_URL_LOCAL",
  });
  addConnection({
    id: "vps",
    name: "VPS DB",
    connectionString: env.MT5_POSTGRES_URL_REMOTE,
    note: "From src/api/.env MT5_POSTGRES_URL_REMOTE",
  });
  const activeSqlitePath = resolveSqlitePath(env.MT5_SQLITE_PATH);
  if (activeSqlitePath && fs.existsSync(activeSqlitePath)) {
    addConnection({
      id: "sqlite-active",
      name: "MT5 Active SQLite",
      connectionString: `sqlite:${activeSqlitePath}`,
      note: "From src/api/.env MT5_SQLITE_PATH",
    });
  }

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      for (const conn of parsed?.connections || []) addConnection(conn);
    } catch (err) {
      console.error("[db-manager] Failed to read config:", err.message);
    }
  }

  // SQLite user databases
  const usersDir = path.join(TRADING_DIR, "data", "users");
  if (fs.existsSync(usersDir)) {
    for (const uid of fs.readdirSync(usersDir)) {
      const dbPath = path.join(usersDir, uid, "data.db");
      if (fs.existsSync(dbPath)) {
        addConnection({
          id: `sqlite-${uid}`,
          name: `User ${uid}`,
          connectionString: `sqlite:${dbPath}`,
          note: `SQLite data/users/${uid}/data.db`,
        });
      }
    }
  }

  return connections;
}

function getConnection(id) {
  const conn = readConfig().find((c) => c.id === id);
  if (!conn) throw new Error(`Unknown connection: ${id}`);
  return conn;
}

function getPool(id) {
  if (pools.has(id)) return pools.get(id);
  const conn = getConnection(id);
  const cs = conn.connectionString;
  if (cs.startsWith("sqlite:")) {
    const dbPath = cs.slice(7);
    console.log("[db-manager] SQLite:", dbPath);
    const Database = require("better-sqlite3");
    const sqlite = new Database(dbPath, { readonly: true });
    const pool = {
      _sqlite: true,
      query: (sql, params) => {
        try {
          const sqlUpper = sql.trim().toUpperCase();
          if (
            sqlUpper.startsWith("SELECT") ||
            sqlUpper.startsWith("PRAGMA") ||
            sqlUpper.startsWith("EXPLAIN")
          ) {
            const stmt = sqlite.prepare(sql);
            const rows = params ? stmt.all(...params) : stmt.all();
            return {
              rows,
              rowCount: rows.length,
              fields: rows.length ? Object.keys(rows[0]) : [],
            };
          }
          const stmt = sqlite.prepare(sql);
          const result = params ? stmt.run(...params) : stmt.run();
          return { rows: [], rowCount: result.changes, fields: [] };
        } catch (e) {
          throw new Error(e.message);
        }
      },
      end: () => sqlite.close(),
    };
    pools.set(id, pool);
    return pool;
  }
  const pool = new Pool({
    connectionString: cs,
    max: 4,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 5000,
  });
  pools.set(id, pool);
  return pool;
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeSortDir(value) {
  return String(value || "").toUpperCase() === "ASC" ? "ASC" : "DESC";
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(INDEX_HTML);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function pgEscapeIdent(str) {
  return '"' + String(str).replace(/"/g, '""') + '"';
}

function pgEscapeLiteral(val) {
  if (val === null || val === undefined || val === "") return "NULL";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  return "'" + String(val).replace(/'/g, "''") + "'";
}

function assertWritableConnection(pool) {
  if (pool._sqlite) {
    throw new Error(
      "Schema changes are unavailable for SQLite connections in DB Manager",
    );
  }
}

function buildColumnType(typeName, length, precision, scale) {
  const base = String(typeName || "").trim();
  if (!base) throw new Error("Column type is required");
  if (length != null && length !== "") {
    const size = clampInt(length, 0, 1, 65535);
    return `${base}(${size})`;
  }
  if (precision != null && precision !== "") {
    const p = clampInt(precision, 0, 1, 1000);
    if (scale != null && scale !== "") {
      const s = clampInt(scale, 0, 0, p);
      return `${base}(${p}, ${s})`;
    }
    return `${base}(${p})`;
  }
  return base;
}

async function applyTableAction(pool, schemaName, tableName, body = {}) {
  assertWritableConnection(pool);
  const action = String(body.action || "").trim().toLowerCase();
  const schema = quoteIdent(schemaName);
  const table = quoteIdent(tableName);

  if (action === "add_column") {
    const columnName = String(body.columnName || "").trim();
    if (!columnName) throw new Error("columnName is required");
    const columnType = buildColumnType(
      body.typeName,
      body.length,
      body.precision,
      body.scale,
    );
    const clauses = [];
    if (body.nullable === false) clauses.push("NOT NULL");
    if (body.defaultMode === "expression") {
      const expr = String(body.defaultExpression || "").trim();
      if (!expr) throw new Error("defaultExpression is required");
      clauses.push(`DEFAULT ${expr}`);
    } else if (body.defaultMode === "literal") {
      clauses.push(`DEFAULT ${pgEscapeLiteral(body.defaultLiteral)}`);
    }
    const sql =
      `ALTER TABLE ${schema}.${table} ADD COLUMN ${quoteIdent(columnName)} ${columnType}` +
      (clauses.length ? ` ${clauses.join(" ")}` : "");
    await pool.query(sql);
    return { command: "ALTER TABLE", action: "add_column" };
  }

  if (action === "edit_column") {
    const currentName = String(body.columnName || "").trim();
    if (!currentName) throw new Error("columnName is required");
    const nextName = String(body.nextColumnName || currentName).trim();
    const columnType = buildColumnType(
      body.typeName,
      body.length,
      body.precision,
      body.scale,
    );
    const statements = [
      `ALTER TABLE ${schema}.${table} ALTER COLUMN ${quoteIdent(currentName)} TYPE ${columnType}`,
    ];
    if (body.nullable === false) {
      statements.push(
        `ALTER TABLE ${schema}.${table} ALTER COLUMN ${quoteIdent(currentName)} SET NOT NULL`,
      );
    } else {
      statements.push(
        `ALTER TABLE ${schema}.${table} ALTER COLUMN ${quoteIdent(currentName)} DROP NOT NULL`,
      );
    }
    if (body.defaultMode === "expression") {
      const expr = String(body.defaultExpression || "").trim();
      if (!expr) throw new Error("defaultExpression is required");
      statements.push(
        `ALTER TABLE ${schema}.${table} ALTER COLUMN ${quoteIdent(currentName)} SET DEFAULT ${expr}`,
      );
    } else if (body.defaultMode === "literal") {
      statements.push(
        `ALTER TABLE ${schema}.${table} ALTER COLUMN ${quoteIdent(currentName)} SET DEFAULT ${pgEscapeLiteral(body.defaultLiteral)}`,
      );
    } else {
      statements.push(
        `ALTER TABLE ${schema}.${table} ALTER COLUMN ${quoteIdent(currentName)} DROP DEFAULT`,
      );
    }
    if (nextName && nextName !== currentName) {
      statements.push(
        `ALTER TABLE ${schema}.${table} RENAME COLUMN ${quoteIdent(currentName)} TO ${quoteIdent(nextName)}`,
      );
    }
    for (const sql of statements) {
      await pool.query(sql);
    }
    return { command: "ALTER TABLE", action: "edit_column" };
  }

  if (action === "delete_columns") {
    const names = Array.isArray(body.columnNames)
      ? body.columnNames.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    if (!names.length) throw new Error("columnNames is required");
    const sql =
      `ALTER TABLE ${schema}.${table} ` +
      names.map((name) => `DROP COLUMN ${quoteIdent(name)}`).join(", ");
    await pool.query(sql);
    return { command: "ALTER TABLE", action: "delete_columns", count: names.length };
  }

  if (action === "truncate_data") {
    await pool.query(`TRUNCATE TABLE ${schema}.${table}`);
    return { command: "TRUNCATE", action: "truncate_data" };
  }

  if (action === "delete_table") {
    await pool.query(`DROP TABLE ${schema}.${table}`);
    return { command: "DROP TABLE", action: "delete_table" };
  }

  throw new Error(`Unsupported table action: ${action || "unknown"}`);
}

async function getTableSchema(pool, schema, table) {
  if (pool._sqlite) {
    const rows = pool.query(
      "PRAGMA table_info(" + quoteIdent(table) + ")",
    ).rows;
    return rows.map((r) => ({
      column_name: r.name,
      data_type: r.type || "TEXT",
      is_nullable: r.notnull ? "NO" : "YES",
      column_default: r.dflt_value,
      is_primary_key: r.pk > 0,
      character_maximum_length: null,
      numeric_precision: null,
      numeric_scale: null,
      ordinal_position: r.cid + 1,
    }));
  }
  const sql = `
    WITH pk_cols AS (
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
       AND tc.table_name = kcu.table_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
    )
    SELECT
      c.column_name,
      c.data_type,
      c.udt_name,
      c.is_nullable,
      c.column_default,
      c.character_maximum_length,
      c.numeric_precision,
      c.numeric_scale,
      c.ordinal_position,
      EXISTS (
        SELECT 1 FROM pk_cols pk WHERE pk.column_name = c.column_name
      ) AS is_primary_key
    FROM information_schema.columns c
    WHERE c.table_schema = $1
      AND c.table_name = $2
    ORDER BY c.ordinal_position
  `;
  const result = await pool.query(sql, [schema, table]);
  return result.rows;
}

function pickSyncKey(schemaRows = []) {
  const columns = schemaRows.map((row) => row.column_name);
  if (columns.includes("sid")) return "sid";
  const pk = schemaRows.find((row) => row.is_primary_key)?.column_name;
  if (pk) return pk;
  if (columns.includes("id")) return "id";
  return "";
}

function isGeneratedIdentityColumn(col = {}) {
  const name = String(col.column_name || "").toLowerCase();
  const def = String(col.column_default || "").toLowerCase();
  return name === "id" && def.includes("nextval(");
}

function syncInsertColumns(schemaRows = [], keyCol = "") {
  return schemaRows
    .filter((col) => {
      if (keyCol !== "id" && isGeneratedIdentityColumn(col)) return false;
      return true;
    })
    .map((col) => col.column_name);
}

function syncUpdateColumns(schemaRows = [], keyCol = "") {
  return schemaRows
    .filter((col) => col.column_name !== keyCol)
    .filter((col) => {
      if (keyCol !== "id" && isGeneratedIdentityColumn(col)) return false;
      return true;
    })
    .map((col) => col.column_name);
}

function commonColumns(sourceSchema = [], targetSchema = []) {
  const targetCols = new Set(targetSchema.map((col) => col.column_name));
  return sourceSchema.filter((col) => targetCols.has(col.column_name));
}

async function syncTableRows({
  sourcePool,
  targetPool,
  sourceConn,
  targetConn,
  schema,
  table,
}) {
  if (sourceConn === targetConn) {
    throw new Error("Source and target connections must be different");
  }
  const sourceSchema = await getTableSchema(sourcePool, schema, table);
  const targetSchema = await getTableSchema(targetPool, schema, table);
  if (!sourceSchema.length)
    throw new Error(`Source table not found: ${schema}.${table}`);
  if (!targetSchema.length)
    throw new Error(`Target table not found: ${schema}.${table}`);

  const sharedSchema = commonColumns(sourceSchema, targetSchema);
  const keyCol = pickSyncKey(sharedSchema);
  if (!keyCol) {
    throw new Error(
      `No sync key found for ${schema}.${table}; expected sid, primary key, or id`,
    );
  }

  const sourceColumns = sharedSchema.map((col) => col.column_name);
  const insertColumns = syncInsertColumns(sharedSchema, keyCol);
  const updateColumns = syncUpdateColumns(sharedSchema, keyCol);
  if (!insertColumns.includes(keyCol)) insertColumns.unshift(keyCol);

  const sourceSql =
    `SELECT ${sourceColumns.map(quoteIdent).join(", ")} ` +
    `FROM ${quoteIdent(schema)}.${quoteIdent(table)} ` +
    `ORDER BY ${quoteIdent(keyCol)} ASC`;
  const sourceRows = (await sourcePool.query(sourceSql)).rows || [];

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const targetClient = await targetPool.connect();
  try {
    await targetClient.query("BEGIN");
    for (const row of sourceRows) {
      const keyVal = row[keyCol];
      if (keyVal === null || keyVal === undefined || keyVal === "") {
        skipped += 1;
        continue;
      }

      const existsSql =
        `SELECT 1 FROM ${quoteIdent(schema)}.${quoteIdent(table)} ` +
        `WHERE ${quoteIdent(keyCol)} = $1 LIMIT 1`;
      const exists = await targetClient.query(existsSql, [keyVal]);
      if ((exists.rowCount || 0) > 0) {
        if (!updateColumns.length) {
          skipped += 1;
          continue;
        }
        const values = updateColumns.map((col) => row[col]);
        values.push(keyVal);
        const setSql = updateColumns
          .map((col, index) => `${quoteIdent(col)} = $${index + 1}`)
          .join(", ");
        const updateSql =
          `UPDATE ${quoteIdent(schema)}.${quoteIdent(table)} ` +
          `SET ${setSql} WHERE ${quoteIdent(keyCol)} = $${values.length}`;
        await targetClient.query(updateSql, values);
        updated += 1;
        continue;
      }

      const values = insertColumns.map((col) => row[col]);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
      const insertSql =
        `INSERT INTO ${quoteIdent(schema)}.${quoteIdent(table)} ` +
        `(${insertColumns.map(quoteIdent).join(", ")}) VALUES (${placeholders})`;
      await targetClient.query(insertSql, values);
      inserted += 1;
    }
    await targetClient.query("COMMIT");
  } catch (err) {
    await targetClient.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    targetClient.release();
  }

  return {
    sourceConn,
    targetConn,
    schema,
    table,
    keyCol,
    scanned: sourceRows.length,
    inserted,
    updated,
    skipped,
  };
}

function buildSearchClause(columns, term, params, pg = true) {
  const q = String(term || "").trim();
  if (!q || !columns.length) return "";
  const token = `%${q}%`;
  const clauses = columns.map((col) => {
    params.push(token);
    return pg
      ? `COALESCE(${quoteIdent(col)}::text, '') ILIKE $${params.length}`
      : `${quoteIdent(col)} LIKE ?`;
  });
  return clauses.length ? ` WHERE (${clauses.join(" OR ")})` : "";
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/api/connections") {
      const connections = readConfig().map(({ id, name, note }) => ({
        id,
        name: formatConnectionDisplayName({ id, name, connectionString: getConnection(id).connectionString }),
        note,
      }));
      return sendJson(res, 200, { ok: true, connections });
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "api" || !parts[1]) {
      return sendJson(res, 404, { ok: false, error: "Not found" });
    }

    const connId = decodeURIComponent(parts[1]);
    const pool = getPool(connId);

    if (req.method === "GET" && parts[2] === "tables") {
      if (pool._sqlite) {
        const result = await pool.query(
          "SELECT name AS table_name, 'main' AS table_schema, 'TABLE' AS table_type, 0 AS row_estimate FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        );
        return sendJson(res, 200, { ok: true, rows: result.rows });
      }
      const search = String(url.searchParams.get("q") || "").trim();
      const params = [];
      let where = "";
      if (search) {
        params.push(`%${search}%`);
        where = `
          AND (
            t.table_schema ILIKE $1
            OR t.table_name ILIKE $1
            OR (t.table_schema || '.' || t.table_name) ILIKE $1
          )
        `;
      }
      const result = await pool.query(
        `
          SELECT
            t.table_schema,
            t.table_name,
            t.table_type,
            COALESCE(ps.n_live_tup, pc.reltuples, 0)::bigint AS row_estimate
          FROM information_schema.tables t
          LEFT JOIN pg_catalog.pg_namespace pn
            ON pn.nspname = t.table_schema
          LEFT JOIN pg_catalog.pg_class pc
            ON pc.relnamespace = pn.oid
           AND pc.relname = t.table_name
          LEFT JOIN pg_catalog.pg_stat_user_tables ps
            ON ps.schemaname = t.table_schema
           AND ps.relname = t.table_name
          WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
          ${where}
          ORDER BY t.table_schema, t.table_name
        `,
        params,
      );
      return sendJson(res, 200, { ok: true, rows: result.rows });
    }

    if (req.method === "GET" && parts[2] === "schema" && parts[3] && parts[4]) {
      const schema = decodeURIComponent(parts[3]);
      const table = decodeURIComponent(parts[4]);
      const rows = await getTableSchema(pool, schema, table);
      return sendJson(res, 200, { ok: true, rows });
    }

    if (req.method === "GET" && parts[2] === "rows" && parts[3] && parts[4]) {
      const schema = decodeURIComponent(parts[3]);
      const table = decodeURIComponent(parts[4]);
      const page = clampInt(url.searchParams.get("page"), 1, 1, 100000);
      const pageSize = clampInt(url.searchParams.get("pageSize"), 50, 1, 200);
      const q = String(url.searchParams.get("q") || "").trim();
      const schemaRows = await getTableSchema(pool, schema, table);
      const columnNames = schemaRows.map((row) => row.column_name);
      if (!columnNames.length) {
        return sendJson(res, 200, {
          ok: true,
          schema: schemaRows,
          rows: [],
          total: 0,
          pages: 1,
          page,
          pageSize,
          sortCol: "",
          sortDir: "DESC",
        });
      }

      const primaryKey = schemaRows.find(
        (row) => row.is_primary_key,
      )?.column_name;
      const sortColRaw = String(url.searchParams.get("sortCol") || "").trim();
      const sortCol = columnNames.includes(sortColRaw)
        ? sortColRaw
        : primaryKey || columnNames[0];
      const sortDir = normalizeSortDir(url.searchParams.get("sortDir"));
      if (pool._sqlite) {
        // SQLite: use table name directly, ? params
        const params = [];
        const whereSql = buildSearchClause(columnNames, q, params, false);
        const countSql = `SELECT COUNT(*) AS total FROM ${quoteIdent(table)}${whereSql}`;
        const totalResult = await pool.query(countSql, params);
        const total = Number(totalResult.rows?.[0]?.total || 0);
        const pages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, pages);
        const offset = (safePage - 1) * pageSize;
        const dataParams = params.slice();
        dataParams.push(pageSize, offset);
        const dataSql =
          `SELECT * FROM ${quoteIdent(table)}` +
          whereSql +
          ` ORDER BY ${quoteIdent(sortCol)} ${sortDir} LIMIT ? OFFSET ?`;
        const result = await pool.query(dataSql, dataParams);
        return sendJson(res, 200, {
          ok: true,
          schema: schemaRows,
          rows: result.rows,
          total,
          pages,
          page: safePage,
          pageSize,
          sortCol,
          sortDir,
        });
      }
      // PostgreSQL
      const params = [];
      const whereSql = buildSearchClause(columnNames, q, params);
      const countSql = `SELECT COUNT(*)::bigint AS total FROM ${quoteIdent(schema)}.${quoteIdent(table)}${whereSql}`;
      const totalResult = await pool.query(countSql, params);
      const total = Number(totalResult.rows?.[0]?.total || 0);
      const pages = Math.max(1, Math.ceil(total / pageSize));
      const safePage = Math.min(page, pages);
      const offset = (safePage - 1) * pageSize;
      const dataParams = params.slice();
      dataParams.push(pageSize, offset);
      const dataSql =
        `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)}` +
        whereSql +
        ` ORDER BY ${quoteIdent(sortCol)} ${sortDir} LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;
      const result = await pool.query(dataSql, dataParams);
      return sendJson(res, 200, {
        ok: true,
        schema: schemaRows,
        rows: result.rows,
        total,
        pages,
        page: safePage,
        pageSize,
        sortCol,
        sortDir,
      });
    }

    if (req.method === "POST" && parts[2] === "query") {
      const body = await readBody(req);
      const sql = String(body.sql || "").trim();
      if (!sql) return sendJson(res, 400, { ok: false, error: "SQL empty" });
      const started = Date.now();
      const result = await pool.query(sql);
      return sendJson(res, 200, {
        ok: true,
        command: result.command,
        rowCount: result.rowCount,
        fields: result.fields ? result.fields.map((f) => f.name) : [],
        rows: Array.isArray(result.rows) ? result.rows : [],
        elapsedMs: Date.now() - started,
      });
    }

    if (req.method === "POST" && parts[2] === "sync" && parts[3] && parts[4]) {
      const body = await readBody(req);
      const otherConnId = String(body.otherConnId || "").trim();
      const direction = String(body.direction || "")
        .trim()
        .toLowerCase();
      if (!otherConnId) {
        return sendJson(res, 400, {
          ok: false,
          error: "otherConnId is required",
        });
      }
      if (!["to", "from"].includes(direction)) {
        return sendJson(res, 400, {
          ok: false,
          error: "direction must be to or from",
        });
      }
      const schema = decodeURIComponent(parts[3]);
      const table = decodeURIComponent(parts[4]);
      const sourceConn = direction === "to" ? connId : otherConnId;
      const targetConn = direction === "to" ? otherConnId : connId;
      const result = await syncTableRows({
        sourcePool: getPool(sourceConn),
        targetPool: getPool(targetConn),
        sourceConn,
        targetConn,
        schema,
        table,
      });
      return sendJson(res, 200, { ok: true, result });
    }

    if (
      req.method === "POST" &&
      parts[2] === "table-action" &&
      parts[3] &&
      parts[4]
    ) {
      const body = await readBody(req);
      const schema = decodeURIComponent(parts[3]);
      const table = decodeURIComponent(parts[4]);
      const result = await applyTableAction(pool, schema, table, body);
      return sendJson(res, 200, { ok: true, result });
    }

    if (parts[2] === "write" && parts[3] && parts[4]) {
      const body = await readBody(req);
      const schema = pgEscapeIdent(parts[3]);
      const table = pgEscapeIdent(parts[4]);
      const values = body.values || {};
      if (req.method === "PUT") {
        const pkCol = pgEscapeIdent(body.pkCol || "id");
        const pkVal = body.pkVal;
        const sets = Object.entries(values)
          .map(([k, v]) => pgEscapeIdent(k) + " = " + pgEscapeLiteral(v))
          .join(", ");
        const sql =
          "UPDATE " +
          schema +
          "." +
          table +
          " SET " +
          sets +
          " WHERE " +
          pkCol +
          " = " +
          pgEscapeLiteral(pkVal);
        await pool.query(sql);
        return sendJson(res, 200, { ok: true, command: "UPDATE" });
      }
      if (req.method === "DELETE") {
        const pkCol = pgEscapeIdent(body.pkCol || "id");
        const pkVal = body.pkVal;
        const sql =
          "DELETE FROM " +
          schema +
          "." +
          table +
          " WHERE " +
          pkCol +
          " = " +
          pgEscapeLiteral(pkVal);
        await pool.query(sql);
        return sendJson(res, 200, { ok: true, command: "DELETE" });
      }
      if (req.method === "POST") {
        const cols = Object.keys(values).map(pgEscapeIdent).join(", ");
        const vals = Object.values(values).map(pgEscapeLiteral).join(", ");
        const sql =
          "INSERT INTO " +
          schema +
          "." +
          table +
          " (" +
          cols +
          ") VALUES (" +
          vals +
          ")";
        await pool.query(sql);
        return sendJson(res, 200, { ok: true, command: "INSERT" });
      }
    }

    return sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (err) {
    return sendJson(res, 500, {
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
}

async function shutdown() {
  for (const pool of pools.values()) {
    try {
      await Promise.resolve(pool.end());
    } catch {}
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const ADMIN_SHARED_CSS = readSharedAsset(ADMIN_SHARED_CSS_PATH);
const SHARED_SITE_NAVIGATION_CSS = readSharedAsset(SHARED_SITE_NAVIGATION_CSS_PATH);
const SHARED_RESPONSIVE_PANEL_CSS = readSharedAsset(SHARED_RESPONSIVE_PANEL_CSS_PATH);
const MINIAPP_BRIDGE_CLIENT = readSharedAsset(MINIAPP_BRIDGE_CLIENT_PATH);
const DB_MANAGER_CSS = readSharedAsset(DB_MANAGER_CSS_PATH);
const DB_MANAGER_SHELL_HTML = readSharedAsset(DB_MANAGER_SHELL_TEMPLATE_PATH);

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>42DBMan</title>
  <style>
${ADMIN_SHARED_CSS}
${SHARED_SITE_NAVIGATION_CSS}
${SHARED_RESPONSIVE_PANEL_CSS}
${DB_MANAGER_CSS}
  </style>
</head>
<body>
  <script>
    (function () {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get("embedded") === "1") {
          document.body.classList.add("embedded");
        }
      } catch {}
    })();
  </script>
${DB_MANAGER_SHELL_HTML}
  <script>
${MINIAPP_BRIDGE_CLIENT}
  </script>
  <script>
    function trimTrailingSlashes(value) {
      var out = String(value || "");
      while (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
      return out;
    }

    function resolveMiniAppBasePath() {
      try {
        const params = new URLSearchParams(window.location.search);
        const fromQuery = String(params.get("basePath") || "").trim();
        if (fromQuery) return trimTrailingSlashes(fromQuery);
      } catch {}
      const marker = "/miniapps/db-manager";
      const pathname = String(window.location.pathname || "");
      const idx = pathname.indexOf(marker);
      if (idx >= 0) return pathname.slice(0, idx + marker.length);
      return "";
    }

    const DBM_BASE_PATH = resolveMiniAppBasePath();

    function getHostBridge() {
      return window.__42tradeMiniAppBridge || null;
    }

    const DBM_AUTH_CONFIG = {
      mode: "inherit-main",
      standaloneRedirectLogin: true,
      mainAppUrl: ${JSON.stringify(DB_MANAGER_MAIN_APP_URL)},
    };

    function applyHostBridgeContext(detail) {
      if (!detail || typeof detail !== "object") return;
      if (detail.theme) {
        document.documentElement.setAttribute(
          "data-theme",
          String(detail.theme).toLowerCase() === "light" ? "light" : "dark",
        );
      }
      if (detail.locale) {
        document.documentElement.lang = String(detail.locale || "English");
      }
    }

    function bridgeToast(message, type, extra) {
      const text = String(message || "").trim();
      if (!text) return;
      try {
        getHostBridge()?.toast?.({
          message: text,
          type: String(type || "info").trim() || "info",
          ...(extra && typeof extra === "object" ? extra : {}),
        });
      } catch {}
    }

    function bridgeLog(message, level, meta) {
      const text = String(message || "").trim();
      if (!text) return;
      try {
        getHostBridge()?.log?.({
          message: text,
          level: String(level || "info").trim() || "info",
          meta: meta && typeof meta === "object" ? meta : null,
        });
      } catch {}
    }

    window.addEventListener("42trade:context", (event) => {
      applyHostBridgeContext(event.detail || {});
    });
    window.addEventListener("42trade:theme", (event) => {
      applyHostBridgeContext(event.detail || {});
    });
    window.addEventListener("42trade:locale", (event) => {
      applyHostBridgeContext(event.detail || {});
    });
    applyHostBridgeContext(getHostBridge()?.getContext?.() || {});

    function resolveMainAppUrl() {
      try {
        const params = new URLSearchParams(window.location.search);
        const fromQuery = String(params.get("mainAppUrl") || "").trim();
        if (fromQuery) {
          localStorage.setItem("main_app_url", fromQuery);
          return fromQuery.replace(/\\/+$/, "");
        }
      } catch {}
      try {
        const fromStorage = String(localStorage.getItem("main_app_url") || "").trim();
        if (fromStorage) return fromStorage.replace(/\\/+$/, "");
      } catch {}
      if (DBM_AUTH_CONFIG.mainAppUrl) {
        return String(DBM_AUTH_CONFIG.mainAppUrl).replace(/\\/+$/, "");
      }
      if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
        return window.location.origin.replace(/\\/+$/, "");
      }
      return "http://127.0.0.1:3000";
    }

    function redirectToMainLogin() {
      const base = resolveMainAppUrl();
      const returnUrl = encodeURIComponent(window.location.href);
      window.location.assign(base + "/login?return_url=" + returnUrl);
    }

    function ensureStandaloneAuth() {
      const bridge = getHostBridge();
      try {
        const params = new URLSearchParams(window.location.search);
        if (bridge?.isEmbedded?.() || params.get("bridge") === "main" || params.get("embedded") === "1") {
          return Promise.resolve(true);
        }
      } catch {
        if (bridge?.isEmbedded?.()) return Promise.resolve(true);
      }
      if (DBM_AUTH_CONFIG.mode !== "inherit-main" || DBM_AUTH_CONFIG.standaloneRedirectLogin !== true) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const mainAppUrl = resolveMainAppUrl();
        let settled = false;
        let authFrame = null;
        const cleanup = () => {
          window.clearTimeout(timeoutId);
          window.removeEventListener("message", onMessage);
          if (authFrame && authFrame.parentNode) authFrame.parentNode.removeChild(authFrame);
        };
        const finish = (ok) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (ok) resolve(true);
          else redirectToMainLogin();
        };
        const expectedOrigin = new URL(mainAppUrl).origin;
        const onMessage = (event) => {
          if (event.origin !== expectedOrigin) return;
          const data = event.data || {};
          if (data.source !== "42trade-auth-probe") return;
          finish(!!data.ok);
        };
        const timeoutId = window.setTimeout(() => finish(false), 3000);
        window.addEventListener("message", onMessage);
        authFrame = document.createElement("iframe");
        authFrame.style.display = "none";
        authFrame.setAttribute("aria-hidden", "true");
        authFrame.src =
          mainAppUrl +
          "/bridge/auth-probe?parent_origin=" +
          encodeURIComponent(window.location.origin);
        document.body.appendChild(authFrame);
      });
    }
  </script>
  <script>
    const el = (id) => document.getElementById(id);
    const state = {
      connections: [],
      connection: "",
      syncConnection: "",
      syncing: false,
      tables: [],
      tableSearch: "",
      selectedSchema: "",
      selectedTable: "",
      schema: [],
      rows: [],
      total: 0,
      pages: 1,
      page: 1,
      pageSize: 50,
      q: "",
      sortCol: "",
      sortDir: "DESC",
      selectedRowIndex: -1,
      selectedSchemaColumns: new Set(),
      showSchema: false,
      hiddenCols: new Set(),
      loadingRows: false,
      sqlMode: false,
      showDetail: false,
      showSchemaInDetail: false,
      editRow: null,       // { index, values: {col: val, ...} }
      isNewRow: false,
    };

    function resetSchemaSelection() {
      state.selectedSchemaColumns = new Set();
    }

    function setActionButton(id, config) {
      const button = el(id);
      if (!button) return;
      button.textContent = config.label;
      button.title = config.title || config.label;
      button.disabled = !!config.disabled;
      button.classList.toggle("hidden", !!config.hidden);
    }

    function selectedSchemaColumns() {
      return Array.from(state.selectedSchemaColumns || []);
    }

    function getSingleSelectedSchemaColumn() {
      const names = selectedSchemaColumns();
      return names.length === 1 ? names[0] : "";
    }

    function deriveColumnTypeParts(col = {}) {
      return {
        typeName: String(col.udt_name || col.data_type || "text").trim(),
        length:
          col.character_maximum_length != null
            ? String(col.character_maximum_length)
            : "",
        precision:
          col.numeric_precision != null ? String(col.numeric_precision) : "",
        scale: col.numeric_scale != null ? String(col.numeric_scale) : "",
      };
    }

    function parseDefaultMode(rawValue) {
      const input = String(rawValue || "").trim().toLowerCase();
      if (!input || input === "none" || input === "null") return "none";
      if (input === "literal" || input === "expression") return input;
      return "";
    }

    async function runTableAction(payload, successText) {
      if (!state.connection || !state.selectedSchema || !state.selectedTable) {
        showRowsError("Select a table first");
        return false;
      }
      showRowsError("");
      setRowsStatus("Working...");
      await api(
        "/api/" + encodeURIComponent(state.connection) + "/table-action/" +
          encodeURIComponent(state.selectedSchema) + "/" +
          encodeURIComponent(state.selectedTable),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      resetSchemaSelection();
      state.selectedRowIndex = -1;
      state.editRow = null;
      state.isNewRow = false;
      state.showDetail = false;
      state.showSchemaInDetail = false;
      if (payload.action === "delete_table") await loadTables();
      else await loadRows();
      setRowsStatus(successText || "");
      if (successText) bridgeToast(successText, "success");
      return true;
    }

    function syncDetailActions() {
      if (state.showSchemaInDetail) {
        const selectedCols = selectedSchemaColumns();
        const canEdit = selectedCols.length === 1;
        const canDelete = selectedCols.length >= 1;
        setActionButton("btnAddRow", {
          label: "Add Column",
          title: "Add new column",
        });
        setActionButton("btnSaveRow", {
          label: "Edit Column",
          title: canEdit ? "Edit selected column" : "Select one column to edit",
          disabled: !canEdit,
        });
        setActionButton("btnCloneRow", {
          label: "Delete Columns",
          title: canDelete ? "Delete selected columns" : "Select columns to delete",
          disabled: !canDelete,
        });
        setActionButton("btnDeleteRow", {
          label: "Truncate Data",
          title: "Delete all rows in this table",
          disabled: false,
        });
        setActionButton("btnDeleteTable", {
          label: "Delete Table",
          title: "Drop this table",
          disabled: false,
          hidden: false,
        });
        return;
      }
      const rowIdx = state.editRow ? state.editRow.index : state.selectedRowIndex;
      const row = state.editRow ? state.editRow.values : state.rows[rowIdx];
      const isEditing = !!state.editRow;
      setActionButton("btnAddRow", {
        label: "+ New",
        title: "Add new row",
      });
      setActionButton("btnSaveRow", {
        label: "Save",
        title: "Save changes",
        disabled: !isEditing,
      });
      setActionButton("btnCloneRow", {
        label: "Clone",
        title: "Clone selected row",
        disabled: !row || isEditing,
      });
      setActionButton("btnDeleteRow", {
        label: "Del",
        title: "Delete selected row",
        disabled: !row || state.isNewRow,
      });
      setActionButton("btnDeleteTable", {
        label: "Delete Table",
        title: "Drop this table",
        hidden: true,
      });
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch]));
    }

    function jsonCell(value) {
      if (value === null || value === undefined) return "";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    }

    function looksLikeDate(value) {
      if (typeof value !== "string") return false;
      if (!value) return false;
      if (!/[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(value) && !value.includes("T")) return false;
      return Number.isFinite(Date.parse(value));
    }

    function formatValue(value) {
      if (value === null || value === undefined) return "-";
      if (typeof value === "boolean") return value ? "true" : "false";
      if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";
      if (typeof value === "object") return JSON.stringify(value);
      if (looksLikeDate(value)) {
        return new Date(value).toLocaleString();
      }
      return String(value);
    }

    function formatValueLong(value) {
      if (value === null || value === undefined) return "-";
      if (typeof value === "object") return JSON.stringify(value, null, 2);
      return formatValue(value);
    }

    function isObjectLike(value) {
      return value && typeof value === "object";
    }

    function statusBadge(raw) {
      const s = String(raw || "").toUpperCase();
      if (!s) return '<span class="badge other">-</span>';
      if (["ACTIVE", "SUCCESS", "OK", "ONLINE", "TRUE", "OPEN", "FILLED"].includes(s)) {
        return '<span class="badge ok">' + escapeHtml(s) + "</span>";
      }
      if (["ERROR", "FAILED", "REJECTED", "SL", "OFFLINE", "FALSE"].includes(s)) {
        return '<span class="badge fail">' + escapeHtml(s) + "</span>";
      }
      if (["PENDING", "WAITING", "LOCKED", "WARN", "WARNING"].includes(s)) {
        return '<span class="badge warn">' + escapeHtml(s) + "</span>";
      }
      return '<span class="badge other">' + escapeHtml(s) + "</span>";
    }

    function isStatusColumn(name) {
      const key = String(name || "").toLowerCase();
      return key === "status" || key.endsWith("_status") || key === "state";
    }

    function safeIdCandidate(row) {
      if (!row || typeof row !== "object") return "-";
      return row.id || row.sid || row.uuid || row.user_id || row.account_id || "-";
    }

    function updateUrl() {
      const params = new URLSearchParams();
      if (state.connection) params.set("conn", state.connection);
      if (state.selectedSchema) params.set("schema", state.selectedSchema);
      if (state.selectedTable) params.set("table", state.selectedTable);
      if (state.q) params.set("q", state.q);
      if (state.page > 1) params.set("page", String(state.page));
      if (state.pageSize !== 50) params.set("pageSize", String(state.pageSize));
      if (state.sortCol) params.set("sortCol", state.sortCol);
      if (state.sortDir !== "DESC") params.set("sortDir", state.sortDir);
      if (state.showSchemaInDetail) params.set("schema", "1");
      const qs = params.toString();
      const next = window.location.pathname + (qs ? "?" + qs : "");
      window.history.replaceState(null, "", next);
    }

    function applyUrlState() {
      const params = new URLSearchParams(window.location.search);
      state.connection = String(params.get("conn") || "").trim();
      state.selectedSchema = String(params.get("schema") || "").trim();
      state.selectedTable = String(params.get("table") || "").trim();
      state.q = String(params.get("q") || "").trim();
      state.page = Math.max(1, Number(params.get("page") || 1) || 1);
      state.pageSize = Math.max(1, Number(params.get("pageSize") || 50) || 50);
      state.sortCol = String(params.get("sortCol") || "").trim();
      state.sortDir = String(params.get("sortDir") || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
      state.showSchemaInDetail = params.get("schema") === "1";
    }

    async function api(path, opts) {
      const relativePath = String(path || "").replace(/^\\/+/, "");
      const res = await fetch(relativePath, opts);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Request failed");
      return data;
    }

    function renderConnections() {
      el("connection").innerHTML = state.connections.map((c) => {
        return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + "</option>";
      }).join("");
      const hasSelectedConnection = state.connections.some((c) => c.id === state.connection);
      if ((!state.connection || !hasSelectedConnection) && state.connections[0]) {
        state.connection = state.connections[0].id;
        updateUrl();
      }
      el("connection").value = state.connection || "";
      el("connection").disabled = state.syncing;
    }

    function filteredTables() {
      const q = String(state.tableSearch || "").trim().toLowerCase();
      if (!q) return state.tables;
      return state.tables.filter((t) => {
        const label = (t.table_schema + "." + t.table_name).toLowerCase();
        return label.includes(q);
      });
    }

    function renderTables() {
      const rows = filteredTables();
      el("tableCount").textContent = rows.length ? rows.length + " visible" : "No tables";
      const container = el("tableList");
      const ITEM_HEIGHT = 66;
      const BUFFER = 5;
      const totalHeight = rows.length * ITEM_HEIGHT;

      // Virtual scroll: only render visible items
      container.innerHTML = '<div style="height:' + totalHeight + 'px;position:relative"></div>';
      const spacer = container.firstChild;

      function renderVisible() {
        const scrollTop = container.scrollTop;
        const viewHeight = container.clientHeight || 600;
        const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
        const end = Math.min(rows.length, Math.ceil((scrollTop + viewHeight) / ITEM_HEIGHT) + BUFFER);
        spacer.innerHTML = rows.slice(start, end).map((t, i) => {
          const idx = start + i;
          const label = t.table_schema + "." + t.table_name;
          const active = state.selectedSchema === t.table_schema && state.selectedTable === t.table_name;
          const rowEstimate = Number(t.row_estimate || 0);
          return '<button class="table-item sidebar-item-v2' + (active ? ' active' : '') +
            '" data-schema="' + escapeHtml(t.table_schema) + '" data-table="' + escapeHtml(t.table_name) +
            '" style="position:absolute;top:' + (idx * ITEM_HEIGHT) + 'px;left:0;right:0;height:' + ITEM_HEIGHT + 'px">' +
            '<div class="table-item-top">' +
              '<div class="table-name">' + escapeHtml(t.table_name) + '</div>' +
              '<div class="minor-text">' + escapeHtml(t.table_schema) + '</div>' +
            '</div>' +
            '<div class="table-meta">' +
              '<span>' + escapeHtml(t.table_type || "TABLE") + '</span>' +
              '<span>~' + escapeHtml(rowEstimate.toLocaleString()) + '</span>' +
            '</div>' +
          '</button>';
        }).join("");
      }

      container.onscroll = renderVisible;
      renderVisible();
    }

    function visibleColumns() {
      return state.schema
        .map((c) => c.column_name)
        .filter((name) => !state.hiddenCols.has(name));
    }

    function autoHideColumns() {
      const keep = new Set();
      for (const col of state.schema) {
        const name = String(col.column_name || "").toLowerCase();
        const type = String(col.data_type || "").toLowerCase();
        // Always show: id, sid, *id, datetime, numeric, status, boolean
        if (
          name === "id" || name === "sid" || name.endsWith("_id") ||
          type.includes("timestamp") || type.includes("date") ||
          type.includes("int") || type.includes("float") || type.includes("double") ||
          type.includes("numeric") || type.includes("decimal") || type.includes("real") ||
          type === "boolean" || type === "bool" ||
          name === "status" || name.endsWith("_status") || name === "state" ||
          name === "action" || name === "symbol" || name === "side" ||
          name === "dispatch_status" || name === "execution_status"
        ) {
          keep.add(col.column_name);
        }
      }
      // Hide everything not in the keep set
      state.hiddenCols = new Set(
        state.schema.map((c) => c.column_name).filter((n) => !keep.has(n)),
      );
    }

    function renderSchemaPanel() {
      // Schema is now rendered in Detail panel via renderDetail()
      if (state.showSchemaInDetail) renderDetail();
    }

    function renderTableData() {
      const cols = visibleColumns();
      el("tableHead").innerHTML = cols.map((name) => {
        const isActive = state.sortCol === name;
        const arrow = isActive ? (state.sortDir === "ASC" ? " ▲" : " ▼") : "";
        return '<th data-sort="' + escapeHtml(name) + '">' + escapeHtml(name.replace(/_/g, " ")) + arrow + '</th>';
      }).join("");

      if (!cols.length) {
        el("tableBody").innerHTML = '<tr><td colspan="1" class="list-empty">No visible columns.</td></tr>';
        return;
      }
      if (!state.rows.length) {
        el("tableBody").innerHTML = '<tr><td colspan="' + cols.length + '" class="list-empty">No rows found.</td></tr>';
        return;
      }
      el("tableBody").innerHTML = state.rows.map((row, idx) => {
        const cells = cols.map((name) => {
          const value = row[name];
          if (isStatusColumn(name)) {
            return '<td>' + statusBadge(value) + '</td>';
          }
          const formatted = formatValue(value);
          const multiline = typeof value === "object" || String(formatted).length > 80;
          return '<td><div class="cell-wrap' + (multiline ? ' multiline' : '') + '">' + escapeHtml(formatted) + '</div></td>';
        }).join("");
        const active = idx === state.selectedRowIndex ? " active" : "";
        return '<tr class="data-row' + active + '" data-row-index="' + idx + '">' + cells + "</tr>";
      }).join("");
    }

    function renderDetail() {
      el("detailPane").classList.toggle("hidden", !state.showDetail && !state.showSchemaInDetail);
      if (state.showSchemaInDetail) {
        el("detailTitle").textContent = "Schema";
        el("detailContent").innerHTML =
          '<div style="overflow:auto;max-height:70vh"><table class="schema-grid"><thead><tr><th>Pick</th><th>Column</th><th>Type</th><th>Nullable</th><th>Default</th><th>Show</th></tr></thead><tbody>' +
          state.schema.map((col) => {
            const typeLabel = col.data_type + (col.character_maximum_length ? " (" + col.character_maximum_length + ")" : "");
            const selected = state.selectedSchemaColumns.has(col.column_name);
            return '<tr class="schema-row' + (selected ? ' active' : '') + '" data-schema-column="' + escapeHtml(col.column_name) + '">' +
              '<td style="text-align:center"><input type="checkbox" data-select-col="' + escapeHtml(col.column_name) + '" ' + (selected ? "checked" : "") + ' /></td>' +
              '<td>' + escapeHtml(col.column_name) + (col.is_primary_key ? ' <span class="badge ok">PK</span>' : '') + '</td>' +
              '<td>' + escapeHtml(typeLabel) + '</td>' +
              '<td>' + escapeHtml(col.is_nullable) + '</td>' +
              '<td>' + escapeHtml(col.column_default || "-") + '</td>' +
              '<td style="text-align:center"><input type="checkbox" data-col="' + escapeHtml(col.column_name) + '" ' + (state.hiddenCols.has(col.column_name) ? "" : "checked") + ' /></td>' +
              '</tr>';
          }).join("") +
          '</tbody></table></div>';
        syncDetailActions();
        return;
      }
      const rowIdx = state.editRow ? state.editRow.index : state.selectedRowIndex;
      const isEditing = !!state.editRow;
      const row = isEditing ? state.editRow.values : state.rows[rowIdx];
      if (!row && !isEditing) {
        el("detailTitle").textContent = "Detail";
        el("detailContent").innerHTML = '<div class="detail-empty">Click a row to inspect its values.</div>';
        state.isNewRow = false;
        syncDetailActions();
        return;
      }
      el("detailTitle").textContent = (isEditing ? "✎ Row" : "Row");

      const cols = state.schema.map((c) => c.column_name);
      if (isEditing) {
        // Editable mode: borderless inputs
        el("detailContent").innerHTML = '<div class="detail-fields">' +
          cols.map((name) => {
            const val = row[name];
            const str = val === null || val === undefined ? "" : (typeof val === "object" ? JSON.stringify(val, null, 2) : String(val));
            const isLong = str.length > 80 || typeof val === "object";
            const tag = isLong ? "textarea" : "input";
            return '<div class="detail-field">' +
              '<label class="detail-key">' + escapeHtml(name) + '</label>' +
              (isLong
                ? '<textarea class="field-edit" data-field="' + escapeHtml(name) + '" rows="' + Math.min(8, Math.max(2, str.split(String.fromCharCode(10)).length)) + '">' + escapeHtml(str) + '</textarea>'
                : '<input class="field-edit" data-field="' + escapeHtml(name) + '" value="' + escapeHtml(str) + '" />') +
              '</div>';
          }).join("") + '</div>';
      } else {
        // Read-only mode (click to edit)
        const fields = Object.entries(row).map(([key, value]) => {
          const rendered = isObjectLike(value)
            ? '<pre class="json-block">' + escapeHtml(JSON.stringify(value, null, 2)) + "</pre>"
            : '<div class="detail-value">' + escapeHtml(formatValueLong(value)) + "</div>";
          return '' +
            '<div class="detail-field" style="cursor:pointer" data-field="' + escapeHtml(key) + '">' +
              '<div class="detail-key">' + escapeHtml(key.replace(/_/g, " ")) + "</div>" +
              '<div class="detail-value">' + rendered + "</div>" +
            "</div>";
        }).join("");
        el("detailContent").innerHTML = '<div class="detail-fields">' + fields + "</div>";
      }
      syncDetailActions();
    }

    function renderPager() {
      el("pageIndicator").textContent = state.page + " / " + state.pages;
      el("totalIndicator").textContent = "Total: " + Number(state.total || 0).toLocaleString();
      el("pageFirst").disabled = state.page <= 1;
      el("pagePrev").disabled = state.page <= 1;
      el("pageNext").disabled = state.page >= state.pages;
      el("pageLast").disabled = state.page >= state.pages;
      el("rowsTitle").textContent = state.selectedTable
        ? state.selectedSchema + "." + state.selectedTable
        : "Rows";
      updateSchemaButtonVisibility();
    }

    function updateSchemaButtonVisibility() {
      const tableSelected = !!state.selectedSchema && !!state.selectedTable;
      const rowsAvailable = state.rows.length > 0;
      const showListSchemaBtn = tableSelected && !state.sqlMode;
      const showDetailSchemaBtn = tableSelected && rowsAvailable && !state.sqlMode;
      const listBtn = el("viewSchemaBtn");
      const detailBtn = el("showSchemaBtn");
      if (listBtn) {
        listBtn.classList.toggle("hidden", !showListSchemaBtn);
      }
      if (detailBtn) {
        detailBtn.classList.toggle("hidden", !showDetailSchemaBtn);
      }
      if (!tableSelected || state.sqlMode) {
        state.showSchemaInDetail = false;
        resetSchemaSelection();
      }
      syncDetailActions();
    }

    function setHeaderStatus(text) {
      el("headerStatus").textContent = text || "";
    }

    function setRowsStatus(text) {
      el("rowsStatus").textContent = text || "";
    }

    function showRowsError(message) {
      const box = el("rowsError");
      if (message) {
        box.textContent = message;
        box.classList.remove("hidden");
        bridgeLog(message, "error", {
          area: "rows",
          connection: state.connection,
          schema: state.selectedSchema,
          table: state.selectedTable,
        });
      } else {
        box.textContent = "";
        box.classList.add("hidden");
      }
    }

    function setSyncStatus(message, mode) {
      const box = el("syncStatus");
      const progress = el("syncProgress");
      box.classList.toggle("hidden", !message);
      box.classList.toggle("success", mode === "success");
      box.classList.toggle("error", mode === "error");
      progress.classList.toggle("hidden", mode !== "progress");
      el("syncStatusText").textContent = message || "";
      if (message && mode === "success") bridgeToast(message, "success");
      if (message && mode === "error") bridgeToast(message, "error");
    }

    async function loadConnections() {
      const data = await api("/api/connections");
      state.connections = data.connections || [];
      renderConnections();
      setHeaderStatus(state.connections.length ? "" : "No connections configured");
      if (state.connection) {
        await loadTables();
      }
    }

    async function loadTables() {
      if (!state.connection) return;
      setHeaderStatus("Loading tables...");
      const data = await api(
        "/api/" + encodeURIComponent(state.connection) + "/tables?q=" + encodeURIComponent(state.tableSearch || ""),
      );
      state.tables = Array.isArray(data.rows) ? data.rows : [];
      renderTables();
      setHeaderStatus(state.tables.length + " tables");

      const stillExists = state.tables.some((t) =>
        t.table_schema === state.selectedSchema && t.table_name === state.selectedTable,
      );
      if (!stillExists) {
        const first = state.tables[0];
        state.selectedSchema = first ? first.table_schema : "";
        state.selectedTable = first ? first.table_name : "";
        state.page = 1;
        state.selectedRowIndex = -1;
      }
      updateUrl();
      if (state.selectedSchema && state.selectedTable) {
        await loadRows();
      } else {
        state.schema = [];
        state.rows = [];
        renderSchemaPanel();
        renderTableData();
        renderDetail();
      }
    }

    async function loadRows() {
      if (!state.connection || !state.selectedSchema || !state.selectedTable) return;
      state.loadingRows = true;
      setRowsStatus("Loading...");
      showRowsError("");
      renderPager();
      const url =
        "/api/" +
        encodeURIComponent(state.connection) +
        "/rows/" +
        encodeURIComponent(state.selectedSchema) +
        "/" +
        encodeURIComponent(state.selectedTable) +
        "?page=" + encodeURIComponent(state.page) +
        "&pageSize=" + encodeURIComponent(state.pageSize) +
        "&q=" + encodeURIComponent(state.q) +
        "&sortCol=" + encodeURIComponent(state.sortCol) +
        "&sortDir=" + encodeURIComponent(state.sortDir);
      try {
        const data = await api(url);
        state.schema = Array.isArray(data.schema) ? data.schema : [];
        const validColumns = new Set(state.schema.map((col) => col.column_name));
        state.selectedSchemaColumns = new Set(
          selectedSchemaColumns().filter((name) => validColumns.has(name)),
        );
        autoHideColumns();
        state.rows = Array.isArray(data.rows) ? data.rows : [];
        state.total = Number(data.total || 0);
        state.pages = Math.max(1, Number(data.pages || 1));
        state.page = Math.max(1, Number(data.page || state.page || 1));
        state.sortCol = String(data.sortCol || state.sortCol || "");
        state.sortDir = String(data.sortDir || state.sortDir || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
        if (!state.rows.length) {
          state.showDetail = false;
          state.showSchemaInDetail = false;
          state.selectedRowIndex = -1;
        }
        if (state.selectedRowIndex >= state.rows.length) {
          state.selectedRowIndex = state.rows.length ? 0 : -1;
        }
        renderSchemaPanel();
        renderTableData();
        renderDetail();
        renderPager();
        updateUrl();
        setRowsStatus(state.rows.length + " rows");
      } catch (err) {
        showRowsError(err.message || "Failed to load rows");
        state.rows = [];
        state.showDetail = false;
        state.showSchemaInDetail = false;
        state.selectedRowIndex = -1;
        renderTableData();
        renderDetail();
        updateSchemaButtonVisibility();
        setRowsStatus("Error");
      } finally {
        state.loadingRows = false;
      }
    }

    async function runSql() {
      if (!state.connection) return;
      setRowsStatus("Running SQL...");
      showRowsError("");
      try {
        const data = await api(
          "/api/" + encodeURIComponent(state.connection) + "/query",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sql: el("inlineSqlEditor").value }),
          },
        );
        const fields = data.fields || (data.rows && data.rows[0] ? Object.keys(data.rows[0]) : []);
        // Populate Rows table with SQL results
        state.schema = fields.map((f) => ({ column_name: f, data_type: "text", is_nullable: "YES", is_primary_key: false }));
        resetSchemaSelection();
        state.rows = data.rows || [];
        state.total = data.rows ? data.rows.length : 0;
        state.pages = 1;
        state.page = 1;
        state.selectedRowIndex = -1;
        state.hiddenCols = new Set();
        state.sortCol = "";
        state.sortDir = "DESC";
        renderSchemaPanel();
        renderTableData();
        renderDetail();
        renderPager();
        setRowsStatus(data.command + " · " + data.rowCount + " rows · " + data.elapsedMs + " ms");
        el("rowsTitle").textContent = "SQL Result";
      } catch (err) {
        showRowsError(err.message || "SQL failed");
        setRowsStatus("Error");
      }
    }

    async function syncSelectedTable(direction) {
      if (!state.connection || !state.syncConnection) {
        setHeaderStatus("Choose another DB first");
        return;
      }
      if (!state.selectedSchema || !state.selectedTable) {
        setHeaderStatus("Select a table first");
        return;
      }
      const label = state.selectedSchema + "." + state.selectedTable;
      const other = state.connections.find((c) => c.id === state.syncConnection);
      const otherName = other ? other.name : state.syncConnection;
      const verb = direction === "to" ? "to" : "from";
      if (!confirm("Sync " + label + " " + verb + " " + otherName + "? Source rows win; destination-only rows are kept.")) {
        return;
      }
      state.syncing = true;
      renderConnections();
      setHeaderStatus("Syncing " + label + " " + verb + " " + otherName + "...");
      setSyncStatus("Syncing " + label + " " + verb + " " + otherName + ". This can take a moment.", "progress");
      showRowsError("");
      try {
        const data = await api(
          "/api/" + encodeURIComponent(state.connection) + "/sync/" +
          encodeURIComponent(state.selectedSchema) + "/" +
          encodeURIComponent(state.selectedTable),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              otherConnId: state.syncConnection,
              direction,
            }),
          },
        );
        const r = data.result || {};
        const summary =
          "Sync " + r.sourceConn + " → " + r.targetConn +
          " · key " + r.keyCol +
          " · inserted " + r.inserted +
          " · updated " + r.updated +
          " · skipped " + r.skipped;
        setHeaderStatus(summary);
        setSyncStatus(summary, "success");
        await loadRows();
      } catch (err) {
        setHeaderStatus("Sync failed");
        setSyncStatus(err.message || "Sync failed", "error");
        showRowsError(err.message || "Sync failed");
      } finally {
        state.syncing = false;
        renderConnections();
      }
    }

    function toggleSort(column) {
      if (!column) return;
      if (state.sortCol === column) {
        state.sortDir = state.sortDir === "ASC" ? "DESC" : "ASC";
      } else {
        state.sortCol = column;
        state.sortDir = "DESC";
      }
      state.page = 1;
      loadRows().catch((err) => showRowsError(err.message || "Failed to sort"));
    }

    function bindEvents() {
      el("connection").addEventListener("change", async (ev) => {
        state.connection = ev.target.value;
        state.page = 1;
        state.selectedRowIndex = -1;
        renderConnections();
        updateUrl();
        await loadTables();
      });

      el("refreshTables").addEventListener("click", () => {
        loadTables().catch((err) => setHeaderStatus(err.message || "Refresh failed"));
      });

      el("tableSearch").addEventListener("input", (ev) => {
        state.tableSearch = ev.target.value || "";
        loadTables().catch((err) => setHeaderStatus(err.message || "Search failed"));
      });

      let searchTimer = null;
      el("rowSearch").addEventListener("input", (ev) => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          state.q = ev.target.value || "";
          state.page = 1;
          loadRows().catch((err) => showRowsError(err.message || "Search failed"));
        }, 180);
      });

      el("pageSize").addEventListener("change", (ev) => {
        state.pageSize = Math.max(1, Number(ev.target.value || 50) || 50);
        state.page = 1;
        loadRows().catch((err) => showRowsError(err.message || "Failed to change page size"));
      });

      el("showSchemaBtn").addEventListener("click", () => {
        state.showSchemaInDetail = !state.showSchemaInDetail;
        state.showDetail = true;
        state.selectedRowIndex = -1;
        if (!state.showSchemaInDetail) resetSchemaSelection();
        renderDetail();
      });

      el("viewSchemaBtn").addEventListener("click", () => {
        state.showSchemaInDetail = !state.showSchemaInDetail;
        state.showDetail = true;
        state.selectedRowIndex = -1;
        if (!state.showSchemaInDetail) resetSchemaSelection();
        renderDetail();
      });

      el("toggleDetail").addEventListener("click", () => {
        state.showDetail = false;
        state.showSchemaInDetail = false;
        resetSchemaSelection();
        renderDetail();
      });

      el("toggleSqlMode").addEventListener("click", () => {
        state.sqlMode = !state.sqlMode;
        el("toggleSqlMode").textContent = state.sqlMode ? "Search" : "SQL";
        el("rowSearch").style.display = state.sqlMode ? "none" : "";
        el("inlineSqlEditor").style.display = state.sqlMode ? "" : "none";
        el("runInlineSql").style.display = state.sqlMode ? "" : "none";
        if (state.sqlMode) {
          const t = state.selectedSchema && state.selectedTable
            ? 'select * from "' + state.selectedSchema + '"."' + state.selectedTable + '" limit 100;'
            : "select now();";
          if (!el("inlineSqlEditor").value || el("inlineSqlEditor").value === "select now();") {
            el("inlineSqlEditor").value = t;
          }
          el("inlineSqlEditor").focus();
        }
      });

      el("runInlineSql").addEventListener("click", runSql);

      el("inlineSqlEditor").addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
          ev.preventDefault();
          runSql();
        }
      });

      el("detailContent").addEventListener("change", (ev) => {
        const selectCol = ev.target && ev.target.getAttribute("data-select-col");
        if (selectCol) {
          if (ev.target.checked) state.selectedSchemaColumns.add(selectCol);
          else state.selectedSchemaColumns.delete(selectCol);
          renderDetail();
          return;
        }
        const col = ev.target && ev.target.getAttribute("data-col");
        if (!col) return;
        if (ev.target.checked) state.hiddenCols.delete(col);
        else state.hiddenCols.add(col);
        renderTableData();
      });

      el("tableList").addEventListener("click", (ev) => {
        const btn = ev.target.closest("button[data-schema]");
        if (!btn) return;
        state.selectedSchema = btn.getAttribute("data-schema") || "";
        state.selectedTable = btn.getAttribute("data-table") || "";
        state.page = 1;
        state.selectedRowIndex = -1;
        state.showDetail = false;
        state.showSchemaInDetail = false;
        resetSchemaSelection();
        state.rows = [];
        state.total = 0;
        state.schema = [];
        renderSchemaPanel();
        renderTableData();
        renderDetail();
        updateSchemaButtonVisibility();
        renderTables();
        loadRows().catch((err) => showRowsError(err.message || "Failed to load table"));
      });

      el("tableHead").addEventListener("click", (ev) => {
        const th = ev.target.closest("th[data-sort]");
        if (!th) return;
        toggleSort(th.getAttribute("data-sort"));
      });

      el("tableBody").addEventListener("click", (ev) => {
        const row = ev.target.closest("tr[data-row-index]");
        if (!row) return;
        state.selectedRowIndex = Number(row.getAttribute("data-row-index"));
        state.editRow = null;
        state.isNewRow = false;
        state.showSchemaInDetail = false;
        resetSchemaSelection();
        state.showDetail = true;
        renderTableData();
        renderDetail();
      });

      el("pageFirst").addEventListener("click", () => {
        if (state.page <= 1) return;
        state.page = 1;
        loadRows().catch((err) => showRowsError(err.message || "Paging failed"));
      });
      el("pagePrev").addEventListener("click", () => {
        if (state.page <= 1) return;
        state.page -= 1;
        loadRows().catch((err) => showRowsError(err.message || "Paging failed"));
      });
      el("pageNext").addEventListener("click", () => {
        if (state.page >= state.pages) return;
        state.page += 1;
        loadRows().catch((err) => showRowsError(err.message || "Paging failed"));
      });
      el("pageLast").addEventListener("click", () => {
        if (state.page >= state.pages) return;
        state.page = state.pages;
        loadRows().catch((err) => showRowsError(err.message || "Paging failed"));
      });

      el("detailContent").addEventListener("click", (ev) => {
        const schemaRow = ev.target.closest("tr[data-schema-column]");
        if (schemaRow && state.showSchemaInDetail) {
          if (ev.target.closest('input[type="checkbox"]')) return;
          const colName = schemaRow.getAttribute("data-schema-column");
          if (!colName) return;
          if (state.selectedSchemaColumns.has(colName)) {
            state.selectedSchemaColumns.delete(colName);
          } else {
            state.selectedSchemaColumns.add(colName);
          }
          renderDetail();
          return;
        }
      });

      // Edit mode: click a detail field to start editing
      el("detailContent").addEventListener("click", (ev) => {
        const field = ev.target.closest(".detail-field[data-field]");
        if (!field || state.editRow) return;
        const row = state.rows[state.selectedRowIndex];
        if (!row) return;
        state.editRow = { index: state.selectedRowIndex, values: { ...row } };
        renderDetail();
      });

      // Save button
      el("btnSaveRow").addEventListener("click", async () => {
        if (state.showSchemaInDetail) {
          const columnName = getSingleSelectedSchemaColumn();
          const col = state.schema.find((item) => item.column_name === columnName);
          if (!col) return;
          const parts = deriveColumnTypeParts(col);
          const nextColumnName = prompt("Column name", col.column_name);
          if (nextColumnName == null) return;
          const typeName = prompt("Column type", parts.typeName);
          if (typeName == null) return;
          const nullable = confirm("Allow NULL values?");
          const useLength = /char|varchar|bit/i.test(typeName);
          const usePrecision = /numeric|decimal/i.test(typeName);
          const length = useLength
            ? prompt("Length (blank to skip)", parts.length)
            : "";
          if (length == null) return;
          const precision = usePrecision
            ? prompt("Precision (blank to skip)", parts.precision)
            : "";
          if (precision == null) return;
          const scale = usePrecision
            ? prompt("Scale (blank to skip)", parts.scale)
            : "";
          if (scale == null) return;
          const defaultModeInput = prompt(
            "Default mode: none, literal, or expression",
            col.column_default == null ? "none" : "expression",
          );
          if (defaultModeInput == null) return;
          const defaultMode = parseDefaultMode(defaultModeInput);
          if (!defaultMode) {
            showRowsError("Default mode must be none, literal, or expression");
            return;
          }
          let defaultLiteral = "";
          let defaultExpression = "";
          if (defaultMode === "literal") {
            const input = prompt("Default literal value", "");
            if (input == null) return;
            defaultLiteral = input;
          } else if (defaultMode === "expression") {
            const input = prompt(
              "Default SQL expression",
              col.column_default == null ? "" : String(col.column_default),
            );
            if (input == null) return;
            defaultExpression = input;
          }
          try {
            await runTableAction(
              {
                action: "edit_column",
                columnName,
                nextColumnName,
                typeName,
                nullable,
                length,
                precision,
                scale,
                defaultMode,
                defaultLiteral,
                defaultExpression,
              },
              "Column updated",
            );
          } catch (err) {
            showRowsError(err.message || "Column update failed");
          }
          return;
        }
        if (!state.editRow || !state.selectedTable) return;
        const values = {};
        for (const el of document.querySelectorAll(".field-edit")) {
          values[el.getAttribute("data-field")] = el.value;
        }
        state.editRow.values = values;
        try {
          if (state.isNewRow) {
            await api(
              "/api/" + encodeURIComponent(state.connection) + "/write/" +
              encodeURIComponent(state.selectedSchema) + "/" + encodeURIComponent(state.selectedTable),
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values }) },
            );
          } else {
            const pk = state.schema.find((c) => c.is_primary_key);
            const pkCol = pk ? pk.column_name : "id";
            await api(
              "/api/" + encodeURIComponent(state.connection) + "/write/" +
              encodeURIComponent(state.selectedSchema) + "/" + encodeURIComponent(state.selectedTable),
              { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pkCol, pkVal: state.rows[state.editRow.index][pkCol], values }) },
            );
          }
          await loadRows();
        } catch (err) {
          showRowsError(err.message || "Save failed");
        }
        state.editRow = null;
        state.isNewRow = false;
        renderDetail();
      });

      // Delete button
      el("btnDeleteRow").addEventListener("click", async () => {
        if (state.showSchemaInDetail) {
          if (!confirm("Truncate all rows from " + (state.selectedSchema + "." + state.selectedTable) + "?")) return;
          try {
            await runTableAction(
              { action: "truncate_data" },
              "Table truncated",
            );
          } catch (err) {
            showRowsError(err.message || "Truncate failed");
          }
          return;
        }
        const row = state.rows[state.selectedRowIndex];
        if (!row || !state.selectedTable) return;
        if (!confirm("Delete row " + (state.selectedSchema + "." + state.selectedTable) + "?")) return;
        try {
          const pk = state.schema.find((c) => c.is_primary_key);
          const pkCol = pk ? pk.column_name : "id";
          await api(
            "/api/" + encodeURIComponent(state.connection) + "/write/" +
            encodeURIComponent(state.selectedSchema) + "/" + encodeURIComponent(state.selectedTable),
            { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pkCol, pkVal: row[pkCol] }) },
          );
          state.selectedRowIndex = -1;
          state.showDetail = false;
          await loadRows();
        } catch (err) {
          showRowsError(err.message || "Delete failed");
        }
      });

      // Clone button
      el("btnCloneRow").addEventListener("click", async () => {
        if (state.showSchemaInDetail) {
          const columnNames = selectedSchemaColumns();
          if (!columnNames.length) return;
          if (!confirm("Delete " + columnNames.length + " column(s) from " + (state.selectedSchema + "." + state.selectedTable) + "?")) return;
          try {
            await runTableAction(
              { action: "delete_columns", columnNames },
              "Columns deleted",
            );
          } catch (err) {
            showRowsError(err.message || "Delete columns failed");
          }
          return;
        }
        const row = state.rows[state.selectedRowIndex];
        if (!row || !state.selectedTable) return;
        try {
          const pk = state.schema.find((c) => c.is_primary_key);
          const clone = { ...row };
          if (pk) delete clone[pk.column_name];
          await api(
            "/api/" + encodeURIComponent(state.connection) + "/write/" +
            encodeURIComponent(state.selectedSchema) + "/" + encodeURIComponent(state.selectedTable),
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: clone }) },
          );
          await loadRows();
        } catch (err) {
          showRowsError(err.message || "Clone failed");
        }
      });

      // Add New button
      el("btnAddRow").addEventListener("click", async () => {
        if (state.showSchemaInDetail) {
          const columnName = prompt("Column name");
          if (columnName == null) return;
          const typeName = prompt("Column type", "text");
          if (typeName == null) return;
          const nullable = confirm("Allow NULL values?");
          const useLength = /char|varchar|bit/i.test(typeName);
          const usePrecision = /numeric|decimal/i.test(typeName);
          const length = useLength ? prompt("Length (blank to skip)", "") : "";
          if (length == null) return;
          const precision = usePrecision ? prompt("Precision (blank to skip)", "") : "";
          if (precision == null) return;
          const scale = usePrecision ? prompt("Scale (blank to skip)", "") : "";
          if (scale == null) return;
          const defaultModeInput = prompt(
            "Default mode: none, literal, or expression",
            "none",
          );
          if (defaultModeInput == null) return;
          const defaultMode = parseDefaultMode(defaultModeInput);
          if (!defaultMode) {
            showRowsError("Default mode must be none, literal, or expression");
            return;
          }
          let defaultLiteral = "";
          let defaultExpression = "";
          if (defaultMode === "literal") {
            const input = prompt("Default literal value", "");
            if (input == null) return;
            defaultLiteral = input;
          } else if (defaultMode === "expression") {
            const input = prompt("Default SQL expression", "");
            if (input == null) return;
            defaultExpression = input;
          }
          try {
            await runTableAction(
              {
                action: "add_column",
                columnName,
                typeName,
                nullable,
                length,
                precision,
                scale,
                defaultMode,
                defaultLiteral,
                defaultExpression,
              },
              "Column added",
            );
          } catch (err) {
            showRowsError(err.message || "Add column failed");
          }
          return;
        }
        const empty = {};
        for (const col of state.schema) {
          empty[col.column_name] = col.column_default || (col.is_nullable === "YES" ? null : "");
        }
        state.editRow = { index: -1, values: empty };
        state.isNewRow = true;
        state.showDetail = true;
        state.showSchemaInDetail = false;
        renderDetail();
        syncDetailActions();
      });

      el("btnDeleteTable").addEventListener("click", async () => {
        if (!state.showSchemaInDetail) return;
        if (!confirm("Delete table " + (state.selectedSchema + "." + state.selectedTable) + "? This cannot be undone.")) return;
        try {
          await runTableAction(
            { action: "delete_table" },
            "Table deleted",
          );
        } catch (err) {
          showRowsError(err.message || "Delete table failed");
        }
      });

    }

    async function init() {
      applyUrlState();
      el("rowSearch").value = state.q;
      el("pageSize").value = String(state.pageSize);
      el("tableSearch").value = state.tableSearch;
      bindEvents();
      await loadConnections();
      renderSchemaPanel();
      renderPager();
    }

    ensureStandaloneAuth()
      .then(() => init())
      .catch((err) => {
        setHeaderStatus("Error");
        showRowsError(err.message || "Failed to initialize");
        bridgeToast(err.message || "Failed to initialize", "error");
      });
  </script>
</body>
</html>`;

const host = process.env.DB_MANAGER_HOST || "127.0.0.1";
const port = Number(process.env.DB_MANAGER_PORT || 8088);

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || host}`);
  if (url.pathname === "/" && req.method === "GET") return sendHtml(res);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return sendJson(res, 404, { ok: false, error: "Not found" });
});

server.listen(port, host, () => {
  console.log(`[db-manager] http://${host}:${port}`);
  console.log(`[db-manager] config=${CONFIG_PATH}`);
});
