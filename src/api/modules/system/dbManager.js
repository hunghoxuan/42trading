"use strict";

const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const pg = require("pg");

const { Pool } = pg;
const pools = new Map();

function resolvePath(projectRoot, value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
}

function loadEnvFile(envPath) {
  const vars = {};
  if (!envPath || !fs.existsSync(envPath)) return vars;
  const raw = fs.readFileSync(envPath, "utf8");
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

function pgEscapeIdent(str) {
  return `"${String(str).replace(/"/g, '""')}"`;
}

function pgEscapeLiteral(val) {
  if (val === null || val === undefined || val === "") return "NULL";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  return `'${String(val).replace(/'/g, "''")}'`;
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

function buildSearchClause(columns, term, params, pgMode = true) {
  const q = String(term || "").trim();
  if (!q || !columns.length) return "";
  const token = `%${q}%`;
  const clauses = columns.map((col) => {
    params.push(token);
    return pgMode
      ? `COALESCE(${quoteIdent(col)}::text, '') ILIKE $${params.length}`
      : `${quoteIdent(col)} LIKE ?`;
  });
  return clauses.length ? ` WHERE (${clauses.join(" OR ")})` : "";
}

function getConfigPath(projectRoot) {
  return path.join(projectRoot, ".local", "db-manager", "connections.json");
}

function readConnectionsConfig(projectRoot) {
  const configPath = getConfigPath(projectRoot);
  if (!fs.existsSync(configPath)) return { connections: [] };
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return { connections: [] };
  }
}

function readConnections(projectRoot, options = {}) {
  const envPath =
    options.envPath || path.join(projectRoot, "src", "api", ".env");
  const env = loadEnvFile(envPath);
  const connections = [];
  const seenIds = new Set();
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

  const configuredActivePostgresUrl = String(
    options.activePostgresUrl || env.MT5_POSTGRES_URL || "",
  ).trim();
  if (configuredActivePostgresUrl) {
    addConnection({
      id: "active",
      name: "Active DB",
      connectionString: configuredActivePostgresUrl,
      note: "Webhook default DB",
    });
  }

  const activeSqlitePath = resolvePath(
    projectRoot,
    options.activeSqlitePath || env.MT5_SQLITE_PATH,
  );
  if (activeSqlitePath && fs.existsSync(activeSqlitePath)) {
    addConnection({
      id: "sqlite-active",
      name: "MT5 Active SQLite",
      connectionString: `sqlite:${activeSqlitePath}`,
      note: "From src/api/.env MT5_SQLITE_PATH",
    });
  }

  const parsedConfig = readConnectionsConfig(projectRoot);
  for (const conn of parsedConfig?.connections || []) addConnection(conn);

  const usersDir = path.join(projectRoot, "data", "users");
  if (fs.existsSync(usersDir)) {
    for (const uid of fs.readdirSync(usersDir)) {
      const dbPath = path.join(usersDir, uid, "data.db");
      if (!fs.existsSync(dbPath)) continue;
      addConnection({
        id: `sqlite-${uid}`,
        name: `User ${uid}`,
        connectionString: `sqlite:${dbPath}`,
        note: `SQLite data/users/${uid}/data.db`,
      });
    }
  }

  return connections;
}

function getConnection(projectRoot, connId, options = {}) {
  const connections = readConnections(projectRoot, options);
  const match = connections.find((item) => item.id === String(connId || "").trim());
  if (!match) throw new Error(`Unknown connection: ${connId}`);
  return match;
}

function getPool(projectRoot, connId, options = {}) {
  const poolKey = `${projectRoot}::${connId}`;
  if (pools.has(poolKey)) return pools.get(poolKey);
  const conn = getConnection(projectRoot, connId, options);
  const cs = conn.connectionString;
  if (cs.startsWith("sqlite:")) {
    const dbPath = cs.slice("sqlite:".length);
    const Database = require("better-sqlite3");
    const sqlite = new Database(dbPath, { readonly: false });
    const pool = {
      _sqlite: true,
      query: (sql, params) => {
        try {
          const sqlUpper = String(sql || "").trim().toUpperCase();
          if (
            sqlUpper.startsWith("SELECT") ||
            sqlUpper.startsWith("PRAGMA") ||
            sqlUpper.startsWith("EXPLAIN")
          ) {
            const stmt = sqlite.prepare(sql);
            const rows = Array.isArray(params) ? stmt.all(...params) : stmt.all();
            return {
              rows,
              rowCount: rows.length,
              fields: rows.length ? Object.keys(rows[0]) : [],
            };
          }
          const stmt = sqlite.prepare(sql);
          const result = Array.isArray(params) ? stmt.run(...params) : stmt.run();
          return { rows: [], rowCount: result.changes, fields: [] };
        } catch (error) {
          throw new Error(error.message);
        }
      },
      end: () => sqlite.close(),
    };
    pools.set(poolKey, pool);
    return pool;
  }

  const pool = new Pool({
    connectionString: cs,
    max: 4,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 5000,
  });
  pools.set(poolKey, pool);
  return pool;
}

async function getTableSchema(pool, schema, table) {
  if (pool._sqlite) {
    const rows = pool.query(`PRAGMA table_info(${quoteIdent(table)})`).rows;
    return rows.map((row) => ({
      column_name: row.name,
      data_type: row.type || "TEXT",
      is_nullable: row.notnull ? "NO" : "YES",
      column_default: row.dflt_value,
      is_primary_key: row.pk > 0,
      character_maximum_length: null,
      numeric_precision: null,
      numeric_scale: null,
      ordinal_position: row.cid + 1,
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
  projectRoot,
  sourceConn,
  targetConn,
  schema,
  table,
  options = {},
}) {
  if (sourceConn === targetConn) {
    throw new Error("Source and target connections must be different");
  }
  const sourcePool = getPool(projectRoot, sourceConn, options);
  const targetPool = getPool(projectRoot, targetConn, options);
  const sourceSchema = await getTableSchema(sourcePool, schema, table);
  const targetSchema = await getTableSchema(targetPool, schema, table);
  if (!sourceSchema.length) {
    throw new Error(`Source table not found: ${schema}.${table}`);
  }
  if (!targetSchema.length) {
    throw new Error(`Target table not found: ${schema}.${table}`);
  }

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
  } catch (error) {
    await targetClient.query("ROLLBACK").catch(() => {});
    throw error;
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

async function listTables(projectRoot, connId, params = {}, options = {}) {
  const pool = getPool(projectRoot, connId, options);
  if (pool._sqlite) {
    const result = await pool.query(
      "SELECT name AS table_name, 'main' AS table_schema, 'TABLE' AS table_type, 0 AS row_estimate FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    return result.rows;
  }
  const search = String(params.q || "").trim();
  const sqlParams = [];
  let where = "";
  if (search) {
    sqlParams.push(`%${search}%`);
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
    sqlParams,
  );
  return result.rows;
}

async function listRows(projectRoot, connId, params = {}, options = {}) {
  const pool = getPool(projectRoot, connId, options);
  const schema = String(params.schema || "").trim();
  const table = String(params.table || "").trim();
  const page = clampInt(params.page, 1, 1, 100000);
  const pageSize = clampInt(params.pageSize, 50, 1, 200);
  const q = String(params.q || "").trim();
  const schemaRows = await getTableSchema(pool, schema, table);
  const columnNames = schemaRows.map((row) => row.column_name);
  if (!columnNames.length) {
    return {
      schema: schemaRows,
      rows: [],
      total: 0,
      pages: 1,
      page,
      pageSize,
      sortCol: "",
      sortDir: "DESC",
    };
  }

  const primaryKey = schemaRows.find((row) => row.is_primary_key)?.column_name;
  const sortColRaw = String(params.sortCol || "").trim();
  const sortCol = columnNames.includes(sortColRaw)
    ? sortColRaw
    : primaryKey || columnNames[0];
  const sortDir = normalizeSortDir(params.sortDir);

  if (pool._sqlite) {
    const sqlParams = [];
    const whereSql = buildSearchClause(columnNames, q, sqlParams, false);
    const countSql = `SELECT COUNT(*) AS total FROM ${quoteIdent(table)}${whereSql}`;
    const totalResult = await pool.query(countSql, sqlParams);
    const total = Number(totalResult.rows?.[0]?.total || 0);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, pages);
    const offset = (safePage - 1) * pageSize;
    const dataParams = sqlParams.slice();
    dataParams.push(pageSize, offset);
    const dataSql =
      `SELECT * FROM ${quoteIdent(table)}` +
      whereSql +
      ` ORDER BY ${quoteIdent(sortCol)} ${sortDir} LIMIT ? OFFSET ?`;
    const result = await pool.query(dataSql, dataParams);
    return {
      schema: schemaRows,
      rows: result.rows,
      total,
      pages,
      page: safePage,
      pageSize,
      sortCol,
      sortDir,
    };
  }

  const sqlParams = [];
  const whereSql = buildSearchClause(columnNames, q, sqlParams);
  const countSql = `SELECT COUNT(*)::bigint AS total FROM ${quoteIdent(schema)}.${quoteIdent(table)}${whereSql}`;
  const totalResult = await pool.query(countSql, sqlParams);
  const total = Number(totalResult.rows?.[0]?.total || 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const offset = (safePage - 1) * pageSize;
  const dataParams = sqlParams.slice();
  dataParams.push(pageSize, offset);
  const dataSql =
    `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)}` +
    whereSql +
    ` ORDER BY ${quoteIdent(sortCol)} ${sortDir} LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;
  const result = await pool.query(dataSql, dataParams);
  return {
    schema: schemaRows,
    rows: result.rows,
    total,
    pages,
    page: safePage,
    pageSize,
    sortCol,
    sortDir,
  };
}

async function runQuery(projectRoot, connId, sql, options = {}) {
  const pool = getPool(projectRoot, connId, options);
  const query = String(sql || "").trim();
  if (!query) throw new Error("SQL empty");
  const started = Date.now();
  const result = await pool.query(query);
  return {
    command: result.command,
    rowCount: result.rowCount,
    fields: result.fields ? result.fields.map((field) => field.name) : [],
    rows: Array.isArray(result.rows) ? result.rows : [],
    elapsedMs: Date.now() - started,
  };
}

async function writeRow(projectRoot, connId, body = {}, options = {}) {
  const pool = getPool(projectRoot, connId, options);
  const schema = pgEscapeIdent(body.schema || "public");
  const table = pgEscapeIdent(body.table || "");
  const values = body.values || {};

  if (pool._sqlite) {
    const pkCol = String(body.pkCol || "id").trim();
    if (body.method === "PUT") {
      const pkVal = body.pkVal;
      const cols = Object.keys(values);
      const setSql = cols.map((col) => `${quoteIdent(col)} = ?`).join(", ");
      await pool.query(
        `UPDATE ${quoteIdent(body.table)} SET ${setSql} WHERE ${quoteIdent(pkCol)} = ?`,
        [...cols.map((col) => values[col]), pkVal],
      );
      return { command: "UPDATE" };
    }
    if (body.method === "DELETE") {
      await pool.query(
        `DELETE FROM ${quoteIdent(body.table)} WHERE ${quoteIdent(pkCol)} = ?`,
        [body.pkVal],
      );
      return { command: "DELETE" };
    }
    const cols = Object.keys(values);
    const placeholders = cols.map(() => "?").join(", ");
    await pool.query(
      `INSERT INTO ${quoteIdent(body.table)} (${cols.map(quoteIdent).join(", ")}) VALUES (${placeholders})`,
      cols.map((col) => values[col]),
    );
    return { command: "INSERT" };
  }

  if (body.method === "PUT") {
    const pkCol = pgEscapeIdent(body.pkCol || "id");
    const pkVal = body.pkVal;
    const sets = Object.entries(values)
      .map(([key, value]) => `${pgEscapeIdent(key)} = ${pgEscapeLiteral(value)}`)
      .join(", ");
    const sql =
      `UPDATE ${schema}.${table} SET ${sets} WHERE ${pkCol} = ${pgEscapeLiteral(pkVal)}`;
    await pool.query(sql);
    return { command: "UPDATE" };
  }

  if (body.method === "DELETE") {
    const pkCol = pgEscapeIdent(body.pkCol || "id");
    const pkVal = body.pkVal;
    const sql =
      `DELETE FROM ${schema}.${table} WHERE ${pkCol} = ${pgEscapeLiteral(pkVal)}`;
    await pool.query(sql);
    return { command: "DELETE" };
  }

  const cols = Object.keys(values).map(pgEscapeIdent).join(", ");
  const vals = Object.values(values).map(pgEscapeLiteral).join(", ");
  const sql = `INSERT INTO ${schema}.${table} (${cols}) VALUES (${vals})`;
  await pool.query(sql);
  return { command: "INSERT" };
}

async function closeAllPools() {
  for (const pool of pools.values()) {
    try {
      await Promise.resolve(pool.end());
    } catch {}
  }
  pools.clear();
}

module.exports = {
  closeAllPools,
  formatConnectionDisplayName,
  getConfigPath,
  getConnection,
  getPool,
  getTableSchema,
  listConnections(projectRoot, options = {}) {
    return readConnections(projectRoot, options).map(({ id, name, note, connectionString }) => ({
      id,
      name: formatConnectionDisplayName({ id, name, connectionString }),
      note,
    }));
  },
  listRows,
  listTables,
  readConnectionsConfig,
  runQuery,
  syncTableRows,
  applyTableAction,
  writeRow,
};
