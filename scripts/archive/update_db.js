const { Pool } = require("pg");
require("dotenv").config({ path: __dirname + "/webhook/.env" });
const pool = new Pool({ connectionString: process.env.MT5_POSTGRES_URL || process.env.POSTGRES_URL });

async function run() {
  await pool.query("UPDATE user_settings SET type = 'trade', name = 'WATCHLIST' WHERE type = 'SYMBOLS' AND name = 'WATCHLIST';");
  await pool.query("UPDATE user_settings SET type = 'cron', name = 'ANALYSIS_CRON' WHERE type = 'ai_analysis_cron' AND name = 'default';");
  await pool.query("UPDATE user_settings SET type = 'cron', name = 'MARKET_DATA_CRON' WHERE type = 'market_data_cron' AND name = 'default';");
  console.log("DB Updated");
  process.exit(0);
}
run().catch(console.error);
