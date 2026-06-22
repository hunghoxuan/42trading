const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { initDb, getBackend, migrateDb } = require("../src/db");
const schema = require("../src/db/schema");
const queries = require("../src/db/queries");

function makeTempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-provider-"));
  return path.join(dir, "trading.db");
}

async function seedSqliteDb(db) {
  const now = new Date().toISOString();

  db._provider.raw
    .prepare(
      `
        UPDATE users
        SET name = ?, email = ?, role = ?, is_active = ?, metadata = ?, created_at = ?, updated_at = ?
        WHERE user_id = ?
      `,
    )
    .run(
      "System",
      "system@example.com",
      "system",
      1,
      JSON.stringify({ theme: "dark" }),
      now,
      now,
      "default",
    );

  await db.insert(db._schema.trades).values([
    {
      sid: "T1",
      accountId: "acct-1",
      userId: "default",
      symbol: "XAUUSD",
      action: "BUY",
      dispatchStatus: "NEW",
      executionStatus: "PENDING",
      note: "First test trade",
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z",
    },
    {
      sid: "T2",
      accountId: "acct-1",
      userId: "default",
      symbol: "EURUSD",
      action: "SELL",
      dispatchStatus: "OPEN",
      executionStatus: "FILLED",
      note: "Second trade",
      createdAt: "2026-01-02T10:00:00.000Z",
      updatedAt: "2026-01-02T10:00:00.000Z",
    },
  ]);
}

test("schema module exposes both backend schemas", () => {
  assert.equal(typeof schema.getSchemaForBackend, "function");
  assert.ok(schema.postgres?.users);
  assert.ok(schema.sqlite?.users);
  assert.notEqual(schema.postgres.users, schema.sqlite.users);
});

test("initDb selects sqlite provider and annotates the drizzle instance", async () => {
  const dbPath = makeTempSqlitePath();
  const db = initDb({
    storage: {
      backend: "sqlite",
      sqlite: { path: dbPath },
    },
  });
  await migrateDb(db);

  assert.equal(getBackend(), "sqlite");
  assert.equal(db._backend, "sqlite");
  assert.equal(db._provider.backend, "sqlite");
  assert.equal(db._provider.connection.target, dbPath);
  assert.equal(db._schema, schema.sqlite);
});

test("queries DAL keeps the same API while running on sqlite", async () => {
  const db = initDb({
    storage: {
      backend: "sqlite",
      sqlite: { path: makeTempSqlitePath() },
    },
  });
  await migrateDb(db);

  await seedSqliteDb(db);

  const bySymbol = await queries.listTradesV2(db, { symbol: "XAUUSD" }, 1, 10);
  assert.equal(bySymbol.total, 1);
  assert.equal(bySymbol.items[0].sid, "T1");

  const bySearch = await queries.listTradesV2(db, { q: "Second" }, 1, 10);
  assert.equal(bySearch.total, 1);
  assert.equal(bySearch.items[0].sid, "T2");

  const users = await queries.listUiUsers(db);
  assert.equal(users.length, 1);
  assert.equal(users[0].user_id, "default");

  const metadata = await queries.getUserMetadata(db, "default");
  assert.deepEqual(queries.parseJsonField(metadata), { theme: "dark" });

  await queries.updateUserMetadata(db, "default", queries.jsonField({ theme: "light" }));
  const updatedMetadata = await queries.getUserMetadata(db, "default");
  assert.deepEqual(queries.parseJsonField(updatedMetadata), { theme: "light" });

  const promoted = await queries.promoteDraftTrade(db, "T1", "default");
  assert.equal(promoted.length, 1);
  assert.equal(promoted[0].executionStatus, "PENDING");
  assert.equal(promoted[0].dispatchStatus, "OPEN");
});
