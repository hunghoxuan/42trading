"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const APP_DIR = __dirname;
const TRADING_DIR =
  process.env.TRADING_DIR || path.resolve(__dirname, "../..");
const CONFIG_PATH =
  process.env.DB_MANAGER_CONFIG ||
  path.join(TRADING_DIR, "db/.local/db-manager/connections.json");

// Always load credentials from webhook/.env (single source of truth)
const WEBHOOK_ENV_PATH = path.join(TRADING_DIR, "webhook/.env");
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
  pg = require(path.join(TRADING_DIR, "webhook/node_modules/pg"));
} catch (err) {
  console.error(
    "[db-manager] Missing pg dependency. Run npm install in webhook/ first.",
  );
  process.exit(1);
}

const { Pool } = pg;
const pools = new Map();

function readConfig() {
  const env = loadEnvFile();
  const url = env.MT5_POSTGRES_URL || env.POSTGRES_URL || env.POSTGRE_URL;
  if (url) {
    return [{
      id: "env",
      name: "Webhook DB",
      connectionString: url,
      note: "From webhook/.env",
    }];
  }
  return [];
}

function getConnection(id) {
  const conn = readConfig().find((c) => c.id === id);
  if (!conn) throw new Error(`Unknown connection: ${id}`);
  return conn;
}

function getPool(id) {
  if (pools.has(id)) return pools.get(id);
  const conn = getConnection(id);
  const pool = new Pool({
    connectionString: conn.connectionString,
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

async function getTableSchema(pool, schema, table) {
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

function buildSearchClause(columns, term, params) {
  const q = String(term || "").trim();
  if (!q || !columns.length) return "";
  const token = `%${q}%`;
  const clauses = columns.map((col) => {
    params.push(token);
    return `COALESCE(${quoteIdent(col)}::text, '') ILIKE $${params.length}`;
  });
  return clauses.length ? ` WHERE (${clauses.join(" OR ")})` : "";
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/api/connections") {
      const connections = readConfig().map(({ id, name, note }) => ({
        id,
        name,
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
      const pageSize = clampInt(
        url.searchParams.get("pageSize"),
        50,
        1,
        200,
      );
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

      const primaryKey = schemaRows.find((row) => row.is_primary_key)?.column_name;
      const sortColRaw = String(url.searchParams.get("sortCol") || "").trim();
      const sortCol = columnNames.includes(sortColRaw)
        ? sortColRaw
        : primaryKey || columnNames[0];
      const sortDir = normalizeSortDir(url.searchParams.get("sortDir"));
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
        const sql = "UPDATE " + schema + "." + table + " SET " + sets + " WHERE " + pkCol + " = " + pgEscapeLiteral(pkVal);
        await pool.query(sql);
        return sendJson(res, 200, { ok: true, command: "UPDATE" });
      }
      if (req.method === "DELETE") {
        const pkCol = pgEscapeIdent(body.pkCol || "id");
        const pkVal = body.pkVal;
        const sql = "DELETE FROM " + schema + "." + table + " WHERE " + pkCol + " = " + pgEscapeLiteral(pkVal);
        await pool.query(sql);
        return sendJson(res, 200, { ok: true, command: "DELETE" });
      }
      if (req.method === "POST") {
        const cols = Object.keys(values).map(pgEscapeIdent).join(", ");
        const vals = Object.values(values).map(pgEscapeLiteral).join(", ");
        const sql = "INSERT INTO " + schema + "." + table + " (" + cols + ") VALUES (" + vals + ")";
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
    await pool.end().catch(() => {});
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DB Manager</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f141b;
      --panel: #151c24;
      --panel-2: #1b2430;
      --panel-3: #111821;
      --border: #243140;
      --muted: #8ea0b5;
      --text: #e6edf5;
      --accent: #22d3ee;
      --accent-2: #0ea5e9;
      --green: #24e38f;
      --red: #ff5a5a;
      --amber: #f59e0b;
      --shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
    }
    button, input, select, textarea {
      font: inherit;
      color: inherit;
    }
    .app-shell {
      display: grid;
      grid-template-rows: auto 1fr;
      min-height: 100vh;
    }
    .app-header {
      display: flex;
      gap: 12px;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      background: rgba(17, 24, 33, 0.96);
      position: sticky;
      top: 0;
      z-index: 10;
      backdrop-filter: blur(8px);
    }
    .title-wrap {
      min-width: 160px;
    }
    .title {
      font-size: 16px;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .subtitle {
      font-size: 11px;
      color: var(--muted);
      margin-top: 2px;
    }
    .header-controls {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      width: 100%;
    }
    .control,
    .action-button,
    .ghost-button,
    .tiny-button,
    textarea {
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 8px;
    }
    .control {
      height: 34px;
      padding: 0 10px;
      min-width: 180px;
    }
    .action-button,
    .ghost-button,
    .tiny-button {
      cursor: pointer;
      transition: 120ms ease;
    }
    .action-button {
      height: 34px;
      background: linear-gradient(180deg, #22d3ee, #06b6d4);
      color: #06232a;
      font-weight: 800;
      border-color: #1fcde5;
      padding: 0 14px;
    }
    .ghost-button {
      height: 34px;
      padding: 0 12px;
      color: var(--text);
    }
    .tiny-button {
      height: 26px;
      padding: 0 10px;
      font-size: 11px;
      color: var(--muted);
    }
    .action-button:hover,
    .ghost-button:hover,
    .tiny-button:hover {
      transform: translateY(-1px);
      border-color: #35506a;
    }
    .status-line {
      margin-left: auto;
      font-size: 12px;
      color: var(--muted);
      white-space: nowrap;
    }
    .workspace {
      display: grid;
      grid-template-columns: 200px minmax(0, 1fr);
      min-height: 0;
    }
    .sidebar {
      border-right: 1px solid var(--border);
      background: var(--panel-3);
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .sidebar-head,
    .sidebar-search {
      padding: 12px;
      border-bottom: 1px solid var(--border);
    }
    .sidebar-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-bottom: 8px;
      font-weight: 700;
    }
    .table-list {
      list-style: none;
      margin: 0;
      padding: 8px;
      overflow: auto;
      min-height: 0;
    }
    .table-item {
      width: 100%;
      text-align: left;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text);
      padding: 10px 12px;
      border-radius: 8px;
      margin-bottom: 6px;
      cursor: pointer;
    }
    .table-item:hover {
      background: rgba(34, 211, 238, 0.08);
      border-color: rgba(34, 211, 238, 0.12);
    }
    .table-item.active {
      background: rgba(34, 211, 238, 0.12);
      border-color: rgba(34, 211, 238, 0.45);
      box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.18);
    }
    .table-item-top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
    }
    .table-name {
      font-size: 13px;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .table-meta {
      margin-top: 4px;
      color: var(--muted);
      font-size: 11px;
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    .main {
      min-width: 0;
      display: grid;
      grid-template-rows: auto 1fr;
      min-height: 0;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      padding: 12px;
      border-bottom: 1px solid var(--border);
      background: rgba(21, 28, 36, 0.92);
    }
    .toolbar-group {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    .toolbar-spacer {
      margin-left: auto;
    }
    .pane-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
      min-height: 0;
    }
    .list-pane,
    .detail-pane {
      min-height: 0;
      overflow: auto;
    }
    .detail-pane {
      border-left: 1px solid var(--border);
      background: var(--panel-3);
    }
    /* When detail is hidden, list-pane takes full width */
    .pane-grid:has(.detail-pane.hidden) {
      grid-template-columns: 1fr;
    }
    .panel {
      margin: 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--panel);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .panel-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      background: rgba(27, 36, 48, 0.92);
    }
    .panel-title {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .minor-text {
      color: var(--muted);
      font-size: 11px;
    }
    .schema-grid {
      width: 100%;
      border-collapse: collapse;
    }
    .schema-grid th,
    .schema-grid td,
    .data-grid th,
    .data-grid td {
      border-bottom: 1px solid var(--border);
      padding: 9px 10px;
      font-size: 12px;
      text-align: left;
      vertical-align: top;
    }
    .schema-grid th,
    .data-grid th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--panel-2);
      font-size: 11px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      cursor: pointer;
      white-space: nowrap;
    }
    .data-grid-wrap {
      overflow: auto;
      max-height: calc(100vh - 265px);
    }
    .data-grid {
      width: 100%;
      min-width: 760px;
      border-collapse: collapse;
    }
    .data-row {
      cursor: pointer;
      transition: 120ms ease;
    }
    .data-row:hover {
      background: rgba(34, 211, 238, 0.06);
    }
    .data-row.active {
      background: rgba(34, 211, 238, 0.1);
      box-shadow: inset 3px 0 0 rgba(34, 211, 238, 0.9);
    }
    .cell-wrap {
      max-width: 260px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cell-wrap.multiline {
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border: 1px solid var(--border);
    }
    .badge.ok {
      color: var(--green);
      border-color: rgba(36, 227, 143, 0.35);
      background: rgba(36, 227, 143, 0.08);
    }
    .badge.fail {
      color: var(--red);
      border-color: rgba(255, 90, 90, 0.35);
      background: rgba(255, 90, 90, 0.08);
    }
    .badge.warn {
      color: var(--amber);
      border-color: rgba(245, 158, 11, 0.35);
      background: rgba(245, 158, 11, 0.08);
    }
    .badge.other {
      color: var(--muted);
      background: rgba(142, 160, 181, 0.08);
    }
    .detail-empty,
    .list-empty {
      padding: 28px 18px;
      color: var(--muted);
      text-align: center;
    }
    .detail-head {
      padding: 18px 18px 14px;
      border-bottom: 1px solid var(--border);
    }
    .detail-name {
      font-size: 17px;
      font-weight: 800;
      margin-bottom: 6px;
    }
    .detail-sub {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .detail-fields {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      padding: 16px 18px 18px;
    }
    .detail-field {
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 12px;
      align-items: start;
      text-align: left;
    }
    .detail-key {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--muted);
      text-align: left;
      white-space: nowrap;
    }
    .detail-value {
      font-size: 12px;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .field-edit {
      width: 100%;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: var(--text);
      font-size: 12px;
      padding: 4px 6px;
      font-family: inherit;
      resize: vertical;
      text-align: left;
    }
    .field-edit:focus {
      outline: none;
      border-color: var(--accent);
      background: rgba(34,211,238,0.04);
    }
    pre.json-block {
      margin: 0;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #0d131a;
      overflow: auto;
      font-size: 11px;
      color: #d6e2ee;
    }
    .sql-box {
      padding: 0 18px 18px;
      border-top: 1px solid var(--border);
      margin-top: 8px;
    }
    textarea {
      width: 100%;
      min-height: 120px;
      padding: 10px 12px;
      resize: vertical;
      margin-top: 12px;
      background: #0d131a;
    }
    .error {
      color: #fecaca;
      padding: 12px 14px;
      white-space: pre-wrap;
    }
    .footer-bar {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 12px 14px;
      border-top: 1px solid var(--border);
      background: rgba(27, 36, 48, 0.92);
    }
    .pagination {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .page-indicator {
      min-width: 72px;
      text-align: center;
      font-size: 12px;
      color: var(--muted);
    }
    .inline-status {
      font-size: 12px;
      color: var(--muted);
      white-space: nowrap;
    }
    .hidden { display: none !important; }
    @media (max-width: 1180px) {
      .pane-grid {
        grid-template-columns: 1fr;
      }
      .detail-pane {
        border-left: 0;
        border-top: 1px solid var(--border);
      }
    }
    @media (max-width: 900px) {
      .workspace {
        grid-template-columns: 1fr;
      }
      .sidebar {
        border-right: 0;
        border-bottom: 1px solid var(--border);
        max-height: 260px;
      }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <header class="app-header">
      <div class="title-wrap">
        <div class="title">DB Manager</div>
        <div class="subtitle">Generic local database browser</div>
      </div>
      <div class="header-controls">
        <select id="connection" class="control"></select>
        <button id="refreshTables" class="ghost-button" type="button">Refresh</button>
        <span id="headerStatus" class="status-line"></span>
      </div>
    </header>
    <div class="workspace">
      <aside class="sidebar">
        <div class="sidebar-head">
          <div class="sidebar-title">Tables</div>
          <div class="minor-text" id="tableCount"></div>
        </div>
        <div class="sidebar-search">
          <input id="tableSearch" class="control" style="width:100%;min-width:0" placeholder="Search tables..." />
        </div>
        <ul id="tableList" class="table-list"></ul>
      </aside>
      <section class="main">
        <div class="toolbar">
          <div class="toolbar-group">
            <button id="toggleSqlMode" class="ghost-button" type="button">SQL</button>
            <input id="rowSearch" class="control" style="min-width:220px" placeholder="Search records..." />
            <textarea id="inlineSqlEditor" class="control" style="min-width:400px;height:28px;display:none;resize:none" placeholder="SELECT ..." spellcheck="false"></textarea>
            <button id="runInlineSql" class="action-button" type="button" style="display:none">Run</button>
          </div>
          <div class="toolbar-group toolbar-spacer">
            <span id="tableInfo" class="inline-status"></span>
          </div>
        </div>
        <div class="pane-grid">
          <div class="list-pane">
            <section class="panel">
              <div class="panel-head">
                <div>
                  <div class="panel-title" id="rowsTitle">Rows</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center">
                  <select id="pageSize" class="control" style="min-width:90px;font-size:11px">
                    <option value="25">25</option>
                    <option value="50" selected>50</option>
                    <option value="100">100</option>
                    <option value="200">200</option>
                  </select>
                  <div class="pagination">
                    <button id="pageFirst" class="tiny-button" type="button">&laquo;</button>
                    <button id="pagePrev" class="tiny-button" type="button">&lsaquo;</button>
                    <span id="pageIndicator" class="page-indicator">0 / 0</span>
                    <button id="pageNext" class="tiny-button" type="button">&rsaquo;</button>
                    <button id="pageLast" class="tiny-button" type="button">&raquo;</button>
                  </div>
                  <span id="totalIndicator" class="inline-status"></span>
                  <span id="rowsStatus" class="minor-text"></span>
                </div>
              </div>
              <div id="rowsError" class="error hidden"></div>
              <div class="data-grid-wrap">
                <table class="data-grid">
                  <thead>
                    <tr id="tableHead"></tr>
                  </thead>
                  <tbody id="tableBody"></tbody>
                </table>
              </div>
            </section>
          </div>
          <aside class="detail-pane hidden" id="detailPane">
            <section class="panel">
              <div class="panel-head">
                <div>
                  <div class="panel-title" id="detailTitle">Detail</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center">
                  <button id="btnAddRow" class="tiny-button" type="button" title="Add new row" style="color:#22c55e;border-color:#22c55e44">+ New</button>
                  <button id="btnSaveRow" class="tiny-button" type="button" title="Save changes" disabled style="color:#22d3ee;border-color:#22d3ee44">Save</button>
                  <button id="btnCloneRow" class="tiny-button" type="button" title="Clone selected row" disabled style="color:#f59e0b;border-color:#f59e0b44">Clone</button>
                  <button id="btnDeleteRow" class="tiny-button" type="button" title="Delete selected row" disabled style="color:#ef4444;border-color:#ef444444">Del</button>
                  <button id="showSchemaBtn" class="tiny-button" type="button">Schema</button>
                  <button id="toggleDetail" class="tiny-button" type="button">✕</button>
                </div>
              </div>
              <div id="detailContent" class="detail-empty">Click a row to inspect its values.</div>
            </section>
          </aside>
        </div>
      </section>
    </div>
  </div>
  <script>
    const el = (id) => document.getElementById(id);
    const state = {
      connections: [],
      connection: "",
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
      showSchema: false,
      hiddenCols: new Set(),
      loadingRows: false,
      sqlMode: false,
      showDetail: false,
      showSchemaInDetail: false,
      editRow: null,       // { index, values: {col: val, ...} }
      isNewRow: false,
    };

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
      const res = await fetch(path, opts);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Request failed");
      return data;
    }

    function renderConnections() {
      el("connection").innerHTML = state.connections.map((c) => {
        return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + "</option>";
      }).join("");
      if (!state.connection && state.connections[0]) {
        state.connection = state.connections[0].id;
      }
      el("connection").value = state.connection || "";
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
          return '<button class="table-item' + (active ? ' active' : '') +
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
          '<div style="overflow:auto;max-height:70vh"><table class="schema-grid"><thead><tr><th>Column</th><th>Type</th><th>Nullable</th><th>Default</th><th>Show</th></tr></thead><tbody>' +
          state.schema.map((col) => {
            const typeLabel = col.data_type + (col.character_maximum_length ? " (" + col.character_maximum_length + ")" : "");
            return '<tr>' +
              '<td>' + escapeHtml(col.column_name) + (col.is_primary_key ? ' <span class="badge ok">PK</span>' : '') + '</td>' +
              '<td>' + escapeHtml(typeLabel) + '</td>' +
              '<td>' + escapeHtml(col.is_nullable) + '</td>' +
              '<td>' + escapeHtml(col.column_default || "-") + '</td>' +
              '<td style="text-align:center"><input type="checkbox" data-col="' + escapeHtml(col.column_name) + '" ' + (state.hiddenCols.has(col.column_name) ? "" : "checked") + ' /></td>' +
              '</tr>';
          }).join("") +
          '</tbody></table></div>';
        return;
      }
      const rowIdx = state.editRow ? state.editRow.index : state.selectedRowIndex;
      const isEditing = !!state.editRow;
      const row = isEditing ? state.editRow.values : state.rows[rowIdx];
      if (!row && !isEditing) {
        el("detailTitle").textContent = "Detail";
        el("detailContent").innerHTML = '<div class="detail-empty">Click a row to inspect its values.</div>';
        el("btnSaveRow").disabled = true;
        el("btnDeleteRow").disabled = true;
        el("btnCloneRow").disabled = true;
        return;
      }
      el("detailTitle").textContent = (isEditing ? "✎ Row" : "Row");
      el("btnSaveRow").disabled = !isEditing;
      el("btnDeleteRow").disabled = false;
      el("btnCloneRow").disabled = false;

      const cols = state.schema.map((c) => c.column_name);
      if (isEditing && !state.isNewRow) {
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
      } else {
        box.textContent = "";
        box.classList.add("hidden");
      }
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
        autoHideColumns();
        state.rows = Array.isArray(data.rows) ? data.rows : [];
        state.total = Number(data.total || 0);
        state.pages = Math.max(1, Number(data.pages || 1));
        state.page = Math.max(1, Number(data.page || state.page || 1));
        state.sortCol = String(data.sortCol || state.sortCol || "");
        state.sortDir = String(data.sortDir || state.sortDir || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
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
        renderTableData();
        renderDetail();
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
        renderDetail();
      });

      el("toggleDetail").addEventListener("click", () => {
        state.showDetail = false;
        state.showSchemaInDetail = false;
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
        if (!state.editRow || !state.selectedTable) return;
        const values = {};
        for (const el of document.querySelectorAll(".field-edit")) {
          values[el.getAttribute("data-field")] = el.value;
        }
        state.editRow.values = values;
        try {
          const pk = state.schema.find((c) => c.is_primary_key);
          const pkCol = pk ? pk.column_name : "id";
          await api(
            "/api/" + encodeURIComponent(state.connection) + "/write/" +
            encodeURIComponent(state.selectedSchema) + "/" + encodeURIComponent(state.selectedTable),
            { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pkCol, pkVal: state.rows[state.editRow.index][pkCol], values }) },
          );
          await loadRows();
        } catch (err) {
          showRowsError(err.message || "Save failed");
        }
        state.editRow = null;
        renderDetail();
      });

      // Delete button
      el("btnDeleteRow").addEventListener("click", async () => {
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
      el("btnAddRow").addEventListener("click", () => {
        const empty = {};
        for (const col of state.schema) {
          empty[col.column_name] = col.column_default || (col.is_nullable === "YES" ? null : "");
        }
        state.editRow = { index: -1, values: empty };
        state.isNewRow = true;
        state.showDetail = true;
        state.showSchemaInDetail = false;
        renderDetail();
        el("btnSaveRow").disabled = false;
        el("btnDeleteRow").disabled = true;
        el("btnCloneRow").disabled = true;
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

    init().catch((err) => {
      setHeaderStatus("Error");
      showRowsError(err.message || "Failed to initialize");
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
