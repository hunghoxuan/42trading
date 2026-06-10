
const fs = require("fs");
const path = require("path");
const settingsStore = require("./webhook/settingsStore");
(async () => {
  const userId = "cron_migration_test_user";
  const name = "CRON_MIGRATION_TEST";
  const data = { cron_type: "MARKET_DATA_CRON", enabled: false, symbols: ["BTCUSD"], timeframes: ["1m"], cadence_seconds: 60 };
  const result = await settingsStore.upsertUserSetting(userId, "cron", name, data, "ACTIVE");
  const row = await settingsStore.getUserSetting(userId, "cron", name);
  const objectPath = path.join("data", "users", userId, "cron", name, "data.json");
  const legacyPath = path.join("data", "users", userId, "settings", "cron", name + ".json");
  console.log(JSON.stringify({
    ok: true,
    resultType: result && result[0] ? result[0].type : null,
    objectPath,
    objectExists: fs.existsSync(objectPath),
    legacyPath,
    legacyExists: fs.existsSync(legacyPath),
    fetchedType: row && row.type,
    fetchedName: row && row.name,
    fetchedCronType: row && row.data && row.data.cron_type,
  }, null, 2));
})();
