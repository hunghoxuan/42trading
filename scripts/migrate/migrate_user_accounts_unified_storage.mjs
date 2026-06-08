#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const webhookRequire = createRequire(path.join(PROJECT_ROOT, "webhook", "package.json"));

const { Client } = webhookRequire("pg");
const {
  createUserObjectStore,
} = webhookRequire(path.join(PROJECT_ROOT, "webhook", "userObjectStore.js"));

const postgresUrl =
  process.env.MT5_POSTGRES_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRE_URL ||
  "";

if (!postgresUrl) {
  console.error(
    "[migrate_user_accounts_unified_storage] missing MT5_POSTGRES_URL/POSTGRES_URL/POSTGRE_URL",
  );
  process.exit(1);
}

const store = createUserObjectStore({
  redisEnabled: false,
  getRedisClient: null,
  logger: console,
});

const client = new Client({ connectionString: postgresUrl });

try {
  await client.connect();
  const res = await client.query(`
    SELECT account_id, user_id, name, balance, status, metadata,
           api_key_hash, api_key_last4, api_key_rotated_at,
           source_ids_cache, equity, margin, free_margin, leverage,
           broker_name, created_at, updated_at
    FROM user_accounts
    ORDER BY user_id ASC, created_at ASC, account_id ASC
  `);
  const rows = res.rows || [];
  const migrated = await store.migrateLegacyUserAccounts(rows);
  const users = new Set(rows.map((row) => String(row.user_id || "default"))).size;
  console.log(
    JSON.stringify(
      {
        ok: true,
        users,
        legacy_rows: rows.length,
        migrated_accounts: migrated.length,
        users_root: path.relative(PROJECT_ROOT, store.usersRoot || path.join(PROJECT_ROOT, "data", "users")),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    `[migrate_user_accounts_unified_storage] failed: ${error?.message || error}`,
  );
  process.exitCode = 1;
} finally {
  try {
    await client.end();
  } catch {}
}
