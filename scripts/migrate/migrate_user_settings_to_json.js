#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const settingsStore = require("../../webhook/settingsStore");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed
      .slice(idx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function usage() {
  console.log(`Usage:
  node scripts/migrate/migrate_user_settings_to_json.js [--delete-db] [--drop-table]

Env:
  MT5_POSTGRES_URL or POSTGRES_URL or POSTGRE_URL
  SETTINGS_DATA_ROOT optional, default: ./data

Output:
  data/users/{user_id}/settings/{type}/{name}.json

Flags:
  --delete-db   delete rows from public.user_settings after JSON export succeeds
  --drop-table  drop public.user_settings after JSON export succeeds (implies --delete-db)
`);
}

function parseData(value) {
  if (value === null || value === undefined) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return { value };
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    usage();
    return;
  }

  loadEnvFile(path.join(__dirname, "..", "..", "webhook", ".env"));
  loadEnvFile(path.join(__dirname, "..", "..", ".env"));

  const connectionString =
    process.env.MT5_POSTGRES_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRE_URL;
  if (!connectionString) {
    throw new Error("Missing MT5_POSTGRES_URL/POSTGRES_URL/POSTGRE_URL");
  }

  const dropTable = args.has("--drop-table");
  const deleteDb = args.has("--delete-db") || dropTable;
  const pool = new Pool({ connectionString, max: 4 });

  try {
    const tableRes = await pool.query(
      `SELECT to_regclass('public.user_settings') AS table_name`,
    );
    if (!tableRes.rows?.[0]?.table_name) {
      console.log(
        "[settings-migrate] public.user_settings does not exist; nothing to migrate.",
      );
      return;
    }

    const { rows } = await pool.query(`
      SELECT
        id::text,
        user_id,
        type,
        COALESCE(NULLIF(name, ''), 'default') AS name,
        data,
        value,
        status,
        created_at,
        updated_at
      FROM public.user_settings
      ORDER BY user_id, type, name
    `);

    let exported = 0;
    for (const row of rows) {
      await settingsStore.putUserSettingRow({
        id: row.id,
        user_id: row.user_id || "default",
        type: row.type || "settings",
        name: row.name || "default",
        data: parseData(row.data),
        value: row.value ?? null,
        status: row.status || "ACTIVE",
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
      exported += 1;
    }

    console.log(
      `[settings-migrate] exported ${exported} settings to ${settingsStore.DATA_ROOT}/{user}/settings`,
    );

    if (deleteDb) {
      await pool.query(`DELETE FROM public.user_settings`);
      console.log("[settings-migrate] deleted rows from public.user_settings");
    }

    if (dropTable) {
      await pool.query(`DROP TABLE IF EXISTS public.user_settings CASCADE`);
      console.log("[settings-migrate] dropped public.user_settings");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(
    "[settings-migrate] failed:",
    err && err.message ? err.message : err,
  );
  process.exit(1);
});
