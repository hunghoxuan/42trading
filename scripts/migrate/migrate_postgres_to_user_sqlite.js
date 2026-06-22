"use strict";

const fs = require("fs");
const path = require("path");
const { createTradeRepository } = require("../../src/api/repositories/tradeRepo");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function loadPgModule() {
  try {
    return require("pg");
  } catch {
    throw new Error("Could not load `pg`. Run `pnpm install` from the repo root first.");
  }
}

function usage() {
  console.log(`Usage:
  node scripts/migrate/migrate_postgres_to_user_sqlite.js [--user <user_id>] [--batch-size <n>]

Env:
  MT5_POSTGRES_URL or POSTGRES_URL or POSTGRE_URL

Behavior:
  Migrates users + trades from Postgres into per-user SQLite databases at:
  data/users/<user_id>/data.db
`);
}

function parseArgs(argv) {
  const args = { userId: null, batchSize: 500 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--user") {
      args.userId = String(argv[i + 1] || "").trim() || null;
      i += 1;
      continue;
    }
    if (arg === "--batch-size") {
      const n = Number(argv[i + 1] || 0);
      if (Number.isFinite(n) && n > 0) args.batchSize = Math.floor(n);
      i += 1;
    }
  }
  return args;
}

async function fetchUsers(pool, userId = null) {
  const params = [];
  let whereSql = "";
  if (userId) {
    params.push(userId);
    whereSql = `WHERE user_id = $1`;
  }
  const result = await pool.query(
    `
    SELECT user_id, name, email, role, metadata, created_at, updated_at
    FROM users
    ${whereSql}
    ORDER BY user_id ASC
  `,
    params,
  );
  return result.rows || [];
}

async function fetchTradeBatch(pool, userId, limit, offset) {
  const result = await pool.query(
    `
    SELECT *
    FROM trades
    WHERE user_id = $1
    ORDER BY created_at ASC, sid ASC
    LIMIT $2 OFFSET $3
  `,
    [userId, limit, offset],
  );
  return result.rows || [];
}

async function fetchTradeCounts(pool, userId) {
  const totalRes = await pool.query(
    `SELECT COUNT(*) AS count FROM trades WHERE user_id = $1`,
    [userId],
  );
  const statusRes = await pool.query(
    `
    SELECT execution_status, COUNT(*) AS count
    FROM trades
    WHERE user_id = $1
    GROUP BY execution_status
    ORDER BY execution_status ASC
  `,
    [userId],
  );
  return {
    total: Number(totalRes.rows?.[0]?.count || 0),
    byStatus: Object.fromEntries(
      (statusRes.rows || []).map((row) => [
        String(row.execution_status || ""),
        Number(row.count || 0),
      ]),
    ),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const projectRoot = path.resolve(__dirname, "..", "..");
  loadEnvFile(path.join(projectRoot, "web", "api", ".env"));
  loadEnvFile(path.join(projectRoot, "web", "api", ".env.local"));
  loadEnvFile(path.join(projectRoot, ".env"));

  const connectionString =
    process.env.MT5_POSTGRES_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRE_URL;
  if (!connectionString) {
    throw new Error("Missing MT5_POSTGRES_URL/POSTGRES_URL/POSTGRE_URL");
  }

  const { Pool } = loadPgModule();
  const pool = new Pool({ connectionString, max: 4 });
  const sqliteRepo = createTradeRepository({
    storageBackend: "sqlite",
    projectRoot,
  });

  try {
    const users = await fetchUsers(pool, args.userId);
    if (!users.length) {
      console.log("[sqlite-migrate] No matching users found.");
      return;
    }

    for (const user of users) {
      const userId = String(user.user_id || "").trim();
      if (!userId) continue;
      await sqliteRepo.upsertUser(user);
      const before = await fetchTradeCounts(pool, userId);
      let migrated = 0;
      let offset = 0;

      while (true) {
        const rows = await fetchTradeBatch(
          pool,
          userId,
          args.batchSize,
          offset,
        );
        if (!rows.length) break;
        await sqliteRepo.seedTrades(userId, rows);
        migrated += rows.length;
        offset += rows.length;
      }

      const afterCounts = await sqliteRepo.countTradesByExecutionStatus(userId, {
        user_id: userId,
      });
      const afterList = await sqliteRepo.listTradesV2(
        userId,
        { user_id: userId },
        1,
        1,
      );
      const sqliteTotal = Number(afterList.total || 0);
      const mismatch = sqliteTotal !== before.total;

      console.log(
        `[sqlite-migrate] user=${userId} pg_total=${before.total} sqlite_total=${sqliteTotal} migrated=${migrated} mismatch=${mismatch}`,
      );
      console.log(
        `[sqlite-migrate] user=${userId} pg_status=${JSON.stringify(before.byStatus)} sqlite_status=${JSON.stringify(afterCounts)}`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[sqlite-migrate] failed:", error?.message || error);
  process.exitCode = 1;
});
