const postgres = require("./schema.pg.js");
const sqlite = require("./schema.sqlite.js");

function getSchemaForBackend(backend = "postgres") {
  return String(backend || "postgres").trim().toLowerCase() === "sqlite"
    ? sqlite
    : postgres;
}

module.exports = {
  ...postgres,
  postgres,
  sqlite,
  getSchemaForBackend,
};
