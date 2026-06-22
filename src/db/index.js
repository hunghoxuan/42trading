const schema = require("./schema.js");
const {
  initDb,
  getDb,
  getBackend,
  getDbProvider,
  normalizeConfig,
  migrateDb,
} = require("./provider.js");

module.exports = {
  initDb,
  getDb,
  getBackend,
  getDbProvider,
  normalizeConfig,
  migrateDb,
  schema,
};
