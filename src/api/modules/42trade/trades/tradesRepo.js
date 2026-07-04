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

function tradesRepo(options = {}) {
  const backend = String(options.storageBackend || "sqlite").trim().toLowerCase();
  if (backend === "postgres") return createPostgresTradesProvider(options);
  return createSqliteTradesProvider(options);
}

module.exports = {
  tradesRepo,
  createTradeRepository: tradesRepo,
  resolveUserTradeDbPath,
  normalizeTradeRow,
  parseJsonField,
  jsonText,
  toTaskShape,
};
