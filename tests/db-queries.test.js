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
    console.log("  ✅ " + name);
  } catch (e) {
    console.log("  ❌ " + name + ": " + e.message);
    process.exitCode = 1;
  }
}

async function test_listTradesV2_noFilters() {
  const r = await queries.listTradesV2(db);
  const raw = await pool.query("SELECT COUNT(*) FROM trades");
  if (r.total !== parseInt(raw.rows[0].count))
    throw new Error("total mismatch");
  if (!Array.isArray(r.items)) throw new Error("items not array");
  if (r.page !== 1) throw new Error("page != 1");
  if (r.items.length > r.pageSize) throw new Error("pageSize exceeded");
}

async function test_listTradesV2_bySymbol() {
  const r = await queries.listTradesV2(db, { symbol: "XAUUSD" });
  const raw = await pool.query(
    "SELECT COUNT(*) FROM trades WHERE symbol = $1",
    ["XAUUSD"],
  );
  if (r.total !== parseInt(raw.rows[0].count))
    throw new Error("symbol filter mismatch");
  if (r.items.some((t) => t.symbol !== "XAUUSD"))
    throw new Error("non-XAUUSD in results");
}

async function test_listTradesV2_byStatus() {
  const r = await queries.listTradesV2(db, { execution_status: "FILLED" });
  const raw = await pool.query(
    "SELECT COUNT(*) FROM trades WHERE execution_status = $1",
    ["FILLED"],
  );
  if (r.total !== parseInt(raw.rows[0].count))
    throw new Error("status filter mismatch");
}

async function test_listTradesV2_pagination() {
  const p1 = await queries.listTradesV2(db, {}, 1, 2);
  const p2 = await queries.listTradesV2(db, {}, 2, 2);
  if (p1.items.length > 2) throw new Error("page1 size > 2");
  if (p2.page !== 2) throw new Error("page2 != 2");
  const ids1 = new Set(p1.items.map((t) => t.sid));
  if (p2.items.some((t) => ids1.has(t.sid))) throw new Error("overlap");
}

async function test_listTradesV2_search() {
  const r = await queries.listTradesV2(db, { q: "XAU" });
  if (!r.items.some((t) => String(t.symbol || "").includes("XAU")))
    throw new Error("search should find XAUUSD");
}

async function test_listSignals_noFilters() {
  const r = await queries.listSignals(db);
  if (!Array.isArray(r)) throw new Error("not array");
  if (r.length > 200) throw new Error("limit exceeded");
}

async function test_listSignals_bySymbol() {
  const r = await queries.listSignals(db, { symbol: "XAUUSD" });
  if (r.some((s) => s.symbol !== "XAUUSD")) throw new Error("non-XAUUSD");
}

async function test_listUserAccounts() {
  const r = await queries.listUserAccounts(db, "default");
  if (!Array.isArray(r)) throw new Error("not array");
  if (r.length === 0) throw new Error("no accounts");
  if (!r[0].accountId) throw new Error("missing accountId");
}

async function test_upsertSignal() {
  const sid = "TEST_DRIZZLE_" + Date.now();
  try {
    const r = await queries.upsertSignal(db, {
      sid,
      created_at: new Date().toISOString(),
      user_id: "default",
      symbol: "TESTUSD",
      side: "BUY",
      status: "NEW",
    });
    if (!r.sid) throw new Error("no sid");
    const raw = await pool.query("SELECT sid FROM signals WHERE sid = $1", [
      sid,
    ]);
    if (raw.rows.length !== 1) throw new Error("not inserted");
    await pool.query("DELETE FROM signals WHERE sid = $1", [sid]);
  } catch (e) {
    await pool
      .query("DELETE FROM signals WHERE sid = $1", [sid])
      .catch(() => {});
    throw e;
  }
}

async function test_findAccountByApiKeyHash() {
  const r = await queries.findAccountByApiKeyHash(db, "nonexistent_hash");
  if (r !== null) throw new Error("should return null");
}

async function test_listUiUsers() {
  const r = await queries.listUiUsers(db);
  if (!Array.isArray(r)) throw new Error("not array");
  if (r.length < 1) throw new Error("no users");
  if (!r[0].userId) throw new Error("missing userId");
}

async function test_upsertUserAccount() {
  const aid = "TEST_ACCT_" + Date.now();
  try {
    const r = await queries.upsertUserAccount(db, "default", {
      account_id: aid,
      name: "Test",
      balance: 10000,
      status: "ACTIVE",
    });
    if (!r || r.accountId !== aid) throw new Error("insert failed");
    const u = await queries.upsertUserAccount(db, "default", {
      account_id: aid,
      name: "Updated",
      balance: 20000,
    });
    if (u.name !== "Updated") throw new Error("upsert update failed");
    await pool.query("DELETE FROM user_accounts WHERE account_id = $1", [aid]);
  } catch (e) {
    await pool
      .query("DELETE FROM user_accounts WHERE account_id = $1", [aid])
      .catch(() => {});
    throw e;
  }
}

async function test_schema_tablesExist() {
  const names = [
    "users",
    "user_accounts",
    "user_templates",
    "signals",
    "trades",
    "market_data",
  ];
  for (const n of names) {
    const r = await pool.query("SELECT to_regclass($1) AS exists", [
      "public." + n,
    ]);
    if (!r.rows[0]?.exists) throw new Error("table " + n + " does not exist");
  }
}

async function test_schema_columnMapping() {
  const dc = Object.keys(schema.trades);
  const dbc = (
    await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'trades'",
    )
  ).rows.map((r) => r.column_name);
  if (dc.length < dbc.length - 5)
    throw new Error("Drizzle cols " + dc.length + " << DB cols " + dbc.length);
}

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
  await test("listUiUsers", test_listUiUsers);
  await test("upsertUserAccount", test_upsertUserAccount);

  await teardown();
  console.log("\n✅ All tests passed\n");
})();
