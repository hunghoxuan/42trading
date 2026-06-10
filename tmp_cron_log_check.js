
const fs = require("fs");
const path = require("path");
const { buildObjectLogLine, resolveObjectLogFilePath } = require("./webhook/objectLogService");
const userId = "cron_migration_test_user";
const cronName = "CRON_MIGRATION_TEST";
const metadata = { event: "CRON_AI_ANALYSIS", cron_name: cronName, symbol: "BTCUSD", status: "ok", message: "smoke test" };
const fullPath = resolveObjectLogFilePath(userId, "cron", cronName, metadata);
fs.mkdirSync(path.dirname(fullPath), { recursive: true });
fs.appendFileSync(fullPath, buildObjectLogLine(userId, "cron", cronName, metadata));
console.log(JSON.stringify({ ok: true, fullPath, exists: fs.existsSync(fullPath) }, null, 2));
