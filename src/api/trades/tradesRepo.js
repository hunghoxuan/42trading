"use strict";

const {
  createSqliteTradesProvider,
  createPostgresTradesProvider,
  resolveUserTradeDbPath,
  normalizeTradeRow,
  parseJsonField,
  jsonText,
  toTaskShape,
} = require("./tradesCore");

function createTradeRepository(options = {}) {
  const backend = String(options.storageBackend || "sqlite").trim().toLowerCase();
  if (backend === "postgres") return createPostgresTradesProvider(options);
  return createSqliteTradesProvider(options);
}

module.exports = {
  createTradeRepository,
  resolveUserTradeDbPath,
  normalizeTradeRow,
  parseJsonField,
  jsonText,
  toTaskShape,
};
