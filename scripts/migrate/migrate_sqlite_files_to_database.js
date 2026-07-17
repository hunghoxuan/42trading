#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const apiRequire = createRequire(path.join(PROJECT_ROOT, "src/api", "package.json"));
const Database = apiRequire("better-sqlite3");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const args = {
    target: "",
    postgresUrl: "",
    skipPostgres: false,
    usersRoot: path.join(PROJECT_ROOT, "data", "users"),
    universal: path.join(PROJECT_ROOT, ".local", "universal-store.sqlite"),
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") {
      args.target = String(argv[i + 1] || "").trim();
      i += 1;
    } else if (arg === "--postgres-url") {
      args.postgresUrl = String(argv[i + 1] || "").trim();
      i += 1;
    } else if (arg === "--skip-postgres") {
      args.skipPostgres = true;
    } else if (arg === "--users-root") {
      args.usersRoot = String(argv[i + 1] || "").trim();
      i += 1;
    } else if (arg === "--universal") {
      args.universal = String(argv[i + 1] || "").trim();
      i += 1;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

function usage() {
  console.log(`Usage:
  node scripts/migrate/migrate_sqlite_files_to_database.js [--target data/database.db] [--dry-run]

Copies existing database-backed data into the unified SQLite database:
  - configured Postgres database tables
  - data/users/<user>/data.db
  - data/users/<user>/object_store.db
  - .local/universal-store.sqlite
`);
}

function resolveProjectPath(value, fallback) {
  const raw = String(value || fallback || "").trim();
  return path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
}

function listUserSqliteFiles(usersRoot) {
  const out = [];
  if (!fs.existsSync(usersRoot)) return out;
  for (const entry of fs.readdirSync(usersRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const userDir = path.join(usersRoot, entry.name);
    for (const file of ["data.db", "object_store.db"]) {
      const dbPath = path.join(userDir, file);
      if (fs.existsSync(dbPath)) out.push(dbPath);
    }
  }
  return out;
}

function tableNames(db) {
  return db
    .prepare(
      `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name <> '__drizzle_migrations'
      ORDER BY name
    `,
    )
    .all()
    .map((row) => String(row.name || "").trim())
    .filter(Boolean);
}

function tableSql(db, tableName) {
  return String(
    db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
      )
      .get(tableName)?.sql || "",
  ).trim();
}

function columnNames(db, tableName) {
  return db
    .prepare(`PRAGMA table_info(${JSON.stringify(tableName)})`)
    .all()
    .map((row) => String(row.name || "").trim())
    .filter(Boolean);
}

function quoteIdent(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function ensureDestinationTable(src, dst, tableName) {
  const exists = dst
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    )
    .get(tableName);
  if (exists) return;
  const createSql = tableSql(src, tableName);
  if (!createSql) throw new Error(`No CREATE TABLE SQL found for ${tableName}`);
  dst.exec(createSql);
}

function copyTable(src, dst, tableName, dryRun = false) {
  ensureDestinationTable(src, dst, tableName);
  const srcCols = columnNames(src, tableName);
  const dstSet = new Set(columnNames(dst, tableName));
  const cols = srcCols.filter((col) => dstSet.has(col));
  if (!cols.length) return { table: tableName, rows: 0, skipped: true };
  const rows = src.prepare(`SELECT ${cols.map(quoteIdent).join(", ")} FROM ${quoteIdent(tableName)}`).all();
  if (dryRun || !rows.length) return { table: tableName, rows: rows.length, skipped: false };

  const placeholders = cols.map(() => "?").join(", ");
  const insert = dst.prepare(
    `INSERT OR REPLACE INTO ${quoteIdent(tableName)} (${cols.map(quoteIdent).join(", ")}) VALUES (${placeholders})`,
  );
  const write = dst.transaction((items) => {
    for (const row of items) insert.run(cols.map((col) => row[col]));
  });
  write(rows);
  return { table: tableName, rows: rows.length, skipped: false };
}

function sqliteTypeFromPg(dataType = "", udtName = "") {
  const type = String(dataType || "").toLowerCase();
  const udt = String(udtName || "").toLowerCase();
  if (
    type.includes("int") ||
    udt.includes("int") ||
    type === "boolean"
  ) {
    return "INTEGER";
  }
  if (
    type.includes("double") ||
    type.includes("real") ||
    type.includes("numeric") ||
    type.includes("decimal")
  ) {
    return "REAL";
  }
  return "TEXT";
}

function normalizeDbValue(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

async function pgTableNames(pool) {
  const res = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return (res.rows || []).map((row) => String(row.table_name || "").trim()).filter(Boolean);
}

async function pgTableColumns(pool, tableName) {
  const res = await pool.query(
    `
    SELECT column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    ORDER BY ordinal_position
  `,
    [tableName],
  );
  return res.rows || [];
}

async function pgPrimaryKeyColumns(pool, tableName) {
  const res = await pool.query(
    `
    SELECT a.attname AS column_name
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid
     AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = $1::regclass
      AND i.indisprimary
    ORDER BY array_position(i.indkey, a.attnum)
  `,
    [`public.${tableName}`],
  );
  return (res.rows || []).map((row) => String(row.column_name || "").trim()).filter(Boolean);
}

async function ensureDestinationTableForPg(pool, dst, tableName) {
  const exists = dst
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    )
    .get(tableName);
  if (exists) return;

  const columns = await pgTableColumns(pool, tableName);
  const primaryKeys = new Set(await pgPrimaryKeyColumns(pool, tableName));
  if (!columns.length) throw new Error(`No Postgres columns found for ${tableName}`);
  const columnSql = columns.map((column) => {
    const name = String(column.column_name || "").trim();
    const type = sqliteTypeFromPg(column.data_type, column.udt_name);
    const required = column.is_nullable === "NO" ? " NOT NULL" : "";
    const primary = primaryKeys.has(name) && primaryKeys.size === 1 ? " PRIMARY KEY" : "";
    return `${quoteIdent(name)} ${type}${primary}${primary ? "" : required}`;
  });
  if (primaryKeys.size > 1) {
    columnSql.push(`PRIMARY KEY (${[...primaryKeys].map(quoteIdent).join(", ")})`);
  }
  dst.exec(`CREATE TABLE IF NOT EXISTS ${quoteIdent(tableName)} (${columnSql.join(", ")});`);
}

async function copyPostgresTable(pool, dst, tableName, dryRun = false) {
  await ensureDestinationTableForPg(pool, dst, tableName);
  const pgCols = (await pgTableColumns(pool, tableName))
    .map((column) => String(column.column_name || "").trim())
    .filter(Boolean);
  const dstSet = new Set(columnNames(dst, tableName));
  const cols = pgCols.filter((col) => dstSet.has(col));
  if (!cols.length) return { table: tableName, rows: 0, skipped: true };

  const res = await pool.query(
    `SELECT ${cols.map((col) => `"${col.replace(/"/g, '""')}"`).join(", ")} FROM "${tableName.replace(/"/g, '""')}"`,
  );
  const rows = res.rows || [];
  if (dryRun || !rows.length) return { table: tableName, rows: rows.length, skipped: false };

  const placeholders = cols.map(() => "?").join(", ");
  const insert = dst.prepare(
    `INSERT OR REPLACE INTO ${quoteIdent(tableName)} (${cols.map(quoteIdent).join(", ")}) VALUES (${placeholders})`,
  );
  const write = dst.transaction((items) => {
    for (const row of items) {
      insert.run(cols.map((col) => normalizeDbValue(row[col])));
    }
  });
  write(rows);
  return { table: tableName, rows: rows.length, skipped: false };
}

async function copyPostgresDatabase(postgresUrl, dst, dryRun = false) {
  const { Pool } = apiRequire("pg");
  const pool = new Pool({ connectionString: postgresUrl, max: 4 });
  try {
    const tables = await pgTableNames(pool);
    const copied = [];
    for (const table of tables) {
      copied.push(await copyPostgresTable(pool, dst, table, dryRun));
    }
    return { source: "postgres", tables: copied };
  } finally {
    await pool.end();
  }
}

async function initUnifiedDatabase(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const { initDb, migrateDb } = require("../../src/db");
  const { createUniversalStoreFacade } = apiRequire("./shared/universal-store");
  const db = initDb({ storage: { backend: "sqlite", sqlite: { path: targetPath } } });
  await migrateDb(db);
  await createUniversalStoreFacade({
    provider: "sqlite",
    sqlitePath: targetPath,
  }).init();
  const raw = new Database(targetPath);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.exec(`
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
  raw.close();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  loadEnvFile(path.join(PROJECT_ROOT, "src/api/.env"));
  loadEnvFile(path.join(PROJECT_ROOT, ".env"));

  const targetPath = resolveProjectPath(
    args.target || process.env.MT5_SQLITE_PATH,
    "data/database.db",
  );
  const postgresUrl =
    args.postgresUrl ||
    process.env.MT5_POSTGRES_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRE_URL ||
    "";
  const usersRoot = resolveProjectPath(args.usersRoot, "data/users");
  const universalPath = resolveProjectPath(
    args.universal,
    ".local/universal-store.sqlite",
  );
  const sources = [
    universalPath,
    ...listUserSqliteFiles(usersRoot),
  ].filter((sourcePath) => {
    if (!fs.existsSync(sourcePath)) return false;
    return path.resolve(sourcePath) !== path.resolve(targetPath);
  });

  await initUnifiedDatabase(targetPath);
  const dst = new Database(targetPath);
  dst.pragma("journal_mode = WAL");
  dst.pragma("foreign_keys = ON");

  const summary = [];
  try {
    if (!args.skipPostgres && postgresUrl) {
      summary.push(await copyPostgresDatabase(postgresUrl, dst, args.dryRun));
    }
    for (const sourcePath of sources) {
      const src = new Database(sourcePath, { readonly: true });
      try {
        const tables = tableNames(src);
        const copied = tables.map((table) =>
          copyTable(src, dst, table, args.dryRun),
        );
        summary.push({
          source: path.relative(PROJECT_ROOT, sourcePath),
          tables: copied,
        });
      } finally {
        src.close();
      }
    }
  } finally {
    dst.close();
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dry_run: args.dryRun,
        target: path.relative(PROJECT_ROOT, targetPath),
        sources: summary,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[sqlite-unify] failed:", error?.stack || error?.message || error);
  process.exitCode = 1;
});
