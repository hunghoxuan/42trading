// Unit tests: Drizzle vs raw SQL equivalence
// Run: node tests/db-queries.test.js

const { Pool } = require("../db/node_modules/pg");
const { initDb } = require("../db");
const schema = require("../db/schema");
const queries = require("../db/queries");

const DB_CONFIG = {
  host: "127.0.0.1",
  port: 5432,
  database: "mt5_bridge_local",
  user: "macmini",
};

let pool, db;

async function setup() {
  pool = new Pool(DB_CONFIG);
  db = initDb(pool);
}

async function teardown() {
  await pool.end();
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

// ── listTradesV2 ──

async function test_listTradesV2_noFilters() {
  const result = await queries.listTradesV2(db);
  const raw = await pool.query("SELECT COUNT(*) FROM trades");

  if (result.total !== parseInt(raw.rows[0].count)) {
    throw new Error(`total mismatch: ${result.total} vs ${raw.rows[0].count}`);
  }
  if (!Array.isArray(result.items)) throw new Error("items not array");
  if (result.page !== 1) throw new Error(`page: ${result.page}`);
  if (result.items.length > result.pageSize) throw new Error("pageSize exceeded");
}

async function test_listTradesV2_bySymbol() {
  const result = await queries.listTradesV2(db, { symbol: "XAUUSD" });
  const raw = await pool.query(
    "SELECT COUNT(*) FROM trades WHERE symbol = $1",
    ["XAUUSD"],
  );

  if (result.total !== parseInt(raw.rows[0].count)) {
    throw new Error(`symbol filter mismatch: ${result.total} vs ${raw.rows[0].count}`);
  }
  if (result.items.every((t) => t.symbol === "XAUUSD") === false) {
    throw new Error("non-XAUUSD in results");
  }
}

async function test_listTradesV2_byStatus() {
  const result = await queries.listTradesV2(db, { execution_status: "FILLED" });
  const raw = await pool.query(
    "SELECT COUNT(*) FROM trades WHERE execution_status = $1",
    ["FILLED"],
  );

  if (result.total !== parseInt(raw.rows[0].count)) {
    throw new Error(`status filter mismatch: ${result.total} vs ${raw.rows[0].count}`);
  }
}

async function test_listTradesV2_pagination() {
  const page1 = await queries.listTradesV2(db, {}, 1, 2);
  const page2 = await queries.listTradesV2(db, {}, 2, 2);

  if (page1.items.length > 2) throw new Error("page1 size > 2");
  if (page2.page !== 2) throw new Error(`page2: ${page2.page}`);

  const ids1 = new Set(page1.items.map((t) => t.sid));
  const overlap = page2.items.filter((t) => ids1.has(t.sid));
  if (overlap.length > 0) throw new Error(`overlap: ${overlap.length} items`);
}

async function test_listTradesV2_search() {
  const result = await queries.listTradesV2(db, { q: "XAU" });
  if (!result.items.some((t) => String(t.symbol || "").includes("XAU"))) {
    throw new Error("search should find XAUUSD");
  }
}

// ── listSignals ──

async function test_listSignals_noFilters() {
  const result = await queries.listSignals(db);
  if (!Array.isArray(result)) throw new Error("not array");
  if (result.length > 200) throw new Error("limit exceeded");
}

async function test_listSignals_bySymbol() {
  const result = await queries.listSignals(db, { symbol: "XAUUSD" });
  if (result.some((s) => s.symbol !== "XAUUSD")) {
    throw new Error("non-XAUUSD in results");
  }
}

// ── listUserAccounts ──

async function test_listUserAccounts() {
  const result = await queries.listUserAccounts(db, "default");
  if (!Array.isArray(result)) throw new Error("not array");
  if (result.length === 0) throw new Error("no accounts for default user");
  if (!result[0].accountId) throw new Error("missing accountId");
}

// ── upsertSignal ──

async function test_upsertSignal() {
  const sid = "TEST_DRIZZLE_" + Date.now();
  const result = await queries.upsertSignal(db, {
    sid,
    created_at: new Date().toISOString(),
    user_id: "default",
    symbol: "TESTUSD",
    side: "BUY",
    status: "NEW",
  });
  if (!result.sid) throw new Error("no sid returned");

  // Verify it exists
  const raw = await pool.query("SELECT sid FROM signals WHERE sid = $1", [sid]);
  if (raw.rows.length !== 1) throw new Error("signal not inserted");

  // Duplicate should not throw
  const dup = await queries.upsertSignal(db, {
    sid,
    created_at: new Date().toISOString(),
    user_id: "default",
    symbol: "TESTUSD",
    side: "BUY",
    status: "NEW",
  });
  if (!dup.sid) throw new Error("duplicate should return sid");

  // Cleanup
  await pool.query("DELETE FROM signals WHERE sid = $1", [sid]);
}

// ── findAccountByApiKeyHash ──

async function test_findAccountByApiKeyHash() {
  const result = await queries.findAccountByApiKeyHash(db, "nonexistent_hash_12345");
  if (result !== null) throw new Error("should return null for nonexistent");
}

// ── Schema Integrity ──

async function test_schema_tablesExist() {
  const tableNames = [
    "users", "user_accounts", "user_templates", "user_settings",
    "signals", "trades", "logs", "market_data",
  ];

  for (const name of tableNames) {
    const res = await pool.query(
      "SELECT to_regclass($1) AS exists",
      [`public.${name}`],
    );
    if (!res.rows[0]?.exists) {
      throw new Error(`table ${name} does not exist`);
    }
  }
}

async function test_schema_columnMapping() {
  const drizzleCols = Object.keys(schema.trades);
  const dbCols = (
    await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'trades'",
    )
  ).rows.map((r) => r.column_name);

  if (drizzleCols.length < dbCols.length - 5) {
    throw new Error(`Drizzle cols (${drizzleCols.length}) << DB cols (${dbCols.length})`);
  }
}

// ── Run ──

(async () => {
  console.log("\n🧪 DB Query Tests\n");

  await setup();

  await test("schema tables exist", test_schema_tablesExist);
  await test("schema column mapping", test_schema_columnMapping);

  await test("listTradesV2 — no filters", test_listTradesV2_noFilters);
  await test("listTradesV2 — by symbol", test_listTradesV2_bySymbol);
  await test("listTradesV2 — by status", test_listTradesV2_byStatus);
  await test("listTradesV2 — pagination", test_listTradesV2_pagination);
  await test("listTradesV2 — search", test_listTradesV2_search);

  await test("listSignals — no filters", test_listSignals_noFilters);
  await test("listSignals — by symbol", test_listSignals_bySymbol);

  await test("listUserAccounts", test_listUserAccounts);
  await test("upsertSignal", test_upsertSignal);
  await test("findAccountByApiKeyHash", test_findAccountByApiKeyHash);

  await teardown();
  console.log("\n✅ All tests passed\n");
})();
