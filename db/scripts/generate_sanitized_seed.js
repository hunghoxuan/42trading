"use strict";

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "../..");
let pg;
try {
  pg = require(path.join(ROOT_DIR, "webhook/node_modules/pg"));
} catch {
  console.error("Missing pg dependency. Run npm install in webhook/ first.");
  process.exit(1);
}

const dbUrl =
  process.env.SEED_DATABASE_URL ||
  "postgresql://macmini@127.0.0.1:5432/mt5_bridge_local";
const outputPath =
  process.env.SEED_OUTPUT || path.join(__dirname, "mt5_seed_sanitized.sql");

const { Pool } = pg;
const pool = new Pool({ connectionString: dbUrl });

const TABLES = [
  "users",
  "accounts",
  "user_accounts",
  "user_settings",
  "user_templates",
  "sources",
  "execution_profiles",
  "trades",
  "ea_logs",
];

const SKIP_MISSING = new Set(["sources"]);

const SENSITIVE_COLUMN_DEFAULTS = {
  password_hash: null,
  password_salt: null,
  api_key_hash: null,
  api_key_last4: null,
  api_key_rotated_at: null,
  lease_token: null,
};

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date)
    return `'${value.toISOString().replace(/'/g, "''")}'`;
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sanitizeJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out = { ...value };
  for (const key of Object.keys(out)) {
    const lowered = key.toLowerCase();
    if (
      lowered.includes("key") ||
      lowered.includes("token") ||
      lowered.includes("secret") ||
      lowered.includes("password") ||
      lowered.includes("hash")
    ) {
      out[key] = null;
    } else if (out[key] && typeof out[key] === "object") {
      out[key] = sanitizeJson(out[key]);
    }
  }
  return out;
}

function sanitizeRow(table, row) {
  const next = { ...row };
  for (const [column, value] of Object.entries(SENSITIVE_COLUMN_DEFAULTS)) {
    if (Object.prototype.hasOwnProperty.call(next, column))
      next[column] = value;
  }
  if (table === "users") {
    if (next.email) next.email = "local.seed@example.test";
    if (next.name) next.name = "Local Seed User";
    next.role = next.role || "Admin";
  }
  if (table === "user_settings") {
    next.value = null;
    next.data = sanitizeJson(next.data);
    if (String(next.type || "").toLowerCase() === "api_key") {
      next.data = { value: null, redacted: true };
    }
  }
  if (table === "accounts" || table === "user_accounts") {
    next.metadata = sanitizeJson(next.metadata);
  }
  if (table === "trades") {
    next.metadata = sanitizeJson(next.metadata);
    next.raw_json = sanitizeJson(next.raw_json);
  }
  return next;
}

async function tableExists(table) {
  const res = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [table],
  );
  return res.rowCount > 0;
}

async function exportTable(table) {
  if (!(await tableExists(table))) {
    if (SKIP_MISSING.has(table)) return [];
    return [`-- Table ${table} missing in source DB; skipped.`];
  }
  const result = await pool.query(`SELECT * FROM public.${quoteIdent(table)}`);
  if (!result.rows.length) return [`-- ${table}: no rows`];
  const fields = result.fields.map((f) => f.name);
  const columns = fields.map(quoteIdent).join(", ");
  const lines = [`-- ${table}: ${result.rows.length} rows`];
  for (const rawRow of result.rows) {
    const row = sanitizeRow(table, rawRow);
    const values = fields.map((field) => sqlValue(row[field])).join(", ");
    lines.push(
      `INSERT INTO public.${quoteIdent(table)} (${columns}) VALUES (${values});`,
    );
  }
  return lines;
}

async function exportSequenceSync() {
  const res = await pool.query(`
    SELECT
      table_name,
      column_name,
      pg_get_serial_sequence(format('%I.%I', table_schema, table_name), column_name) AS sequence_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_default LIKE 'nextval(%'
    ORDER BY table_name, column_name
  `);
  const lines = ["-- Reset owned sequences after explicit seed IDs."];
  for (const row of res.rows || []) {
    if (!row.sequence_name) continue;
    const table = quoteIdent(row.table_name);
    const column = quoteIdent(row.column_name);
    lines.push(
      `SELECT setval('${String(row.sequence_name).replace(/'/g, "''")}', COALESCE((SELECT MAX(${column}) FROM public.${table}), 1), true);`,
    );
  }
  return lines;
}

async function main() {
  const chunks = [
    "-- Sanitized seed data generated from local restored mt5_bridge_local.",
    "-- Production secrets, password hashes, API hashes, and token-like JSON values are redacted.",
    "BEGIN;",
    "SET session_replication_role = replica;",
  ];

  for (const table of TABLES) {
    chunks.push("", ...(await exportTable(table)));
  }

  chunks.push(
    "",
    ...(await exportSequenceSync()),
    "",
    "SET session_replication_role = DEFAULT;",
    "COMMIT;",
    "",
  );

  fs.writeFileSync(outputPath, chunks.join("\n"), "utf8");
  console.log(`wrote ${outputPath}`);
}

main()
  .catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));
