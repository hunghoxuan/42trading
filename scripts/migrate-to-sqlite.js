// Migrate data from PostgreSQL to SQLite
// Usage: SQLITE_PATH=db/trading.db node scripts/migrate-to-sqlite.js

const { Pool } = require("../db/node_modules/pg");
const Database = require("../db/node_modules/better-sqlite3");

const PG_URL =
  process.env.POSTGRES_URL ||
  "postgresql://macmini@127.0.0.1:5432/mt5_bridge_local";
const SQLITE_PATH = process.env.SQLITE_PATH || "db/trading.db";

async function migrate() {
  console.log("📦 PostgreSQL...");
  const pg = new Pool({ connectionString: PG_URL, max: 5 });

  console.log("📦 SQLite...");
  const sqlite = new Database(SQLITE_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = OFF");

  // Get SQLite columns for each table
  function getSqliteCols(table) {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all();
    return new Set(cols.map((c) => c.name));
  }

  const tables = [
    "users",
    "user_accounts",
    "user_templates",
    "user_settings",
    "trades",
  ];

  for (const table of tables) {
    console.log(`\n📋 ${table}...`);
    const sqliteCols = getSqliteCols(table);
    if (!sqliteCols.size) {
      console.log("   (table missing, skipped)");
      continue;
    }

    const { rows } = await pg.query(`SELECT * FROM ${table}`);
    if (!rows.length) {
      console.log("   (empty, skipped)");
      continue;
    }

    // Filter to columns that exist in SQLite
    const pgCols = Object.keys(rows[0]).filter((c) => sqliteCols.has(c));
    const placeholders = pgCols.map(() => "?").join(", ");
    const colNames = pgCols.map((c) => `"${c}"`).join(", ");

    const stmt = sqlite.prepare(
      `INSERT OR REPLACE INTO ${table} (${colNames}) VALUES (${placeholders})`,
    );

    const insert = sqlite.transaction((batch) => {
      for (const row of batch) {
        const values = pgCols.map((c) => {
          const v = row[c];
          if (v === null || v === undefined) return null;
          if (typeof v === "object") return JSON.stringify(v);
          return v;
        });
        try {
          stmt.run(...values);
        } catch (e) {
          console.error(`   ⚠️ row error: ${e.message}`);
        }
      }
    });

    insert(rows);
    console.log(`   ✅ ${rows.length} rows`);
  }

  sqlite.pragma("foreign_keys = ON");
  await pg.end();
  sqlite.close();
  console.log(`\n✅ Done: ${SQLITE_PATH}`);
}

migrate().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
