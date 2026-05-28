// Drizzle ORM database instance
// Reuses the existing pg pool — no new connections

const { drizzle } = require("drizzle-orm/node-postgres");
const schema = require("./schema.js");

let _db = null;

function initDb(pool) {
  if (!_db) {
    _db = drizzle(pool, { schema });
  }
  return _db;
}

function getDb() {
  if (!_db) throw new Error("DB not initialized. Call initDb(pool) first.");
  return _db;
}

module.exports = { initDb, getDb, schema };
