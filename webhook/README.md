# Webhook Bot

Single webhook gateway at `/signal` (and tokenized path `/signal/<token>`).

It can:
- send Telegram notification (optional)
- execute Binance (when `BINANCE_MODE` is set)
- execute cTrader (when `CTRADER_MODE` is set)
- queue MT5 trade for EA pull (when `MT5_ENABLED=true`)

## Canonical production routes (2026-04-17)

- Landing:
  - `https://mozasolution.com`
  - `https://www.mozasolution.com`
- Trading UI:
  - `https://trade.mozasolution.com`
- Webhook/API root:
  - `https://trade.mozasolution.com/webhook`
- Health:
  - `https://trade.mozasolution.com/webhook/health`
  - `https://trade.mozasolution.com/webhook/mt5/health`

Webhook payload minimum requirements (`POST /signal` or `POST /mt5/tv/webhook`):
- `symbol` (string)
- `side` (`BUY` or `SELL`)
- `price` (number > 0)

## Config model (simplified)

Removed redundant global switches:
- `EXECUTION_ENABLED` removed
- `EXECUTION_DRY_RUN` removed
- `BINANCE_ENABLED` removed
- `CTRADER_ENABLED` removed

Now:
- Binance ON/OFF is controlled by `BINANCE_MODE` (`paper|live|""`)
- cTrader ON/OFF is controlled by `CTRADER_MODE` (`demo|live|""`)
- MT5 ON/OFF is controlled by `MT5_ENABLED` (`true|false`)

## Setup

```bash
cd /Users/macmini/Trade/Bot/trading/webhook
cp .env.example .env
npm install
npm start
```

Health check:

```bash
curl http://localhost:80/health
```

### cTrader bridge service (separate executor)

If you run cTrader through an external bridge (`CTRADER_EXECUTOR_URL`), use:

- Bridge script: [`/Users/macmini/Trade/Bot/trading/scripts/ctrader_executor_bridge.js`](/Users/macmini/Trade/Bot/trading/scripts/ctrader_executor_bridge.js)
- Install helper: [`/Users/macmini/Trade/Bot/trading/scripts/install_ctrader_executor_bridge.sh`](/Users/macmini/Trade/Bot/trading/scripts/install_ctrader_executor_bridge.sh)

Quick install on VPS:

```bash
cd /Users/macmini/Trade/Bot/trading
CTRADER_EXECUTOR_API_KEY=<random-long-key> bash scripts/install_ctrader_executor_bridge.sh
```

Then set webhook env:

```env
CTRADER_MODE=demo
CTRADER_EXECUTOR_URL=http://127.0.0.1:8099/execute
CTRADER_EXECUTOR_API_KEY=<same-key-as-bridge>
```

HTTPS (native TLS in Node):

```bash
# webhook/.env
HTTPS_ENABLED=true
HTTPS_PORT=443
HTTPS_KEY_PATH=./ssl/privkey.pem
HTTPS_CERT_PATH=./ssl/fullchain.pem
HTTPS_CA_PATH=./ssl/chain.pem      # optional
HTTPS_REDIRECT_HTTP=true           # keep PORT open and redirect to HTTPS
```

Notes:
- When `HTTPS_ENABLED=true`, server terminates TLS directly.
- If `HTTPS_REDIRECT_HTTP=true`, requests on `PORT` get `308` redirect to `HTTPS_PORT`.

## Deployment Automation

### Option A: Local deploy script (recommended)

Script file:
- `/Users/macmini/Trade/Bot/trading/scripts/deploy_webhook.sh`

Default behavior:
1. Run local syntax check (`node --check webhook/server.js`)
2. Push local `main` to origin
3. SSH to VPS, pull latest, restart webhook service, verify health endpoints

Step-by-step commands (copy/paste):

```bash
# 1) go to repo root
cd /Users/macmini/Trade/Bot/trading

# 2) optional: review local changes
git status

# 3) run deploy script (push + vps deploy + health checks)
bash scripts/deploy_webhook.sh
```

Config via env vars (advanced):

```bash
BRANCH=main \
PUSH_FIRST=1 \
VPS_HOST=root@139.59.211.192 \
VPS_APP_DIR=/opt/trading \
SERVICE_MODE=pm2 \
SERVICE_NAME=webhook \
HEALTH_PORT=80 \
bash scripts/deploy_webhook.sh
```

Notes:
- `SERVICE_MODE` supports `pm2` or `systemd`.
- For systemd, set `SERVICE_NAME` to your unit name.

Manual deploy equivalent (no script):

```bash
# Local machine
cd /Users/macmini/Trade/Bot/trading
git push origin main

# VPS
ssh root@139.59.211.192
cd /opt/trading
git pull --ff-only origin main
node --check webhook/server.js
pm2 restart webhook
curl -fsS http://127.0.0.1:80/health
curl -fsS http://127.0.0.1:80/mt5/health
```

Rollback commands:

```bash
ssh root@139.59.211.192
cd /opt/trading
git log --oneline -n 5
git checkout <PREVIOUS_COMMIT> -- webhook/server.js webhook/README.md
node --check webhook/server.js
pm2 restart webhook
```

### Option B: GitHub Actions deploy

Workflow file:
- `/Users/macmini/Trade/Bot/trading/.github/workflows/deploy-webhook.yml`

Triggers:
- Manual: `workflow_dispatch`
- Auto on push to `main` when files under `webhook/**` change

Required GitHub repository secrets:
- `VPS_HOST` (example: `139.59.211.192`)
- `VPS_USER` (example: `root`)
- `VPS_SSH_KEY` (private key content)
- `VPS_APP_DIR` (example: `/opt/trading`)
- Optional: `VPS_PORT` (defaults to `22`)
- Optional: `VPS_HEALTH_PORT` (defaults to `80`)

Step-by-step (for non-technical users):
1. Open GitHub repository page.
2. Go to `Settings` -> `Secrets and variables` -> `Actions`.
3. Add secrets above one by one.
4. Go to `Actions` tab -> `Deploy Webhook`.
5. Click `Run workflow`.
6. Choose `branch=main`, `service_mode=pm2`, `service_name=webhook`.
7. Click `Run workflow` and wait for green check.
8. Verify:
   - `https://trade.mozasolution.com/webhook/health`
   - `https://trade.mozasolution.com/webhook/mt5/health`

## MT5 CSV Sync Automation (macOS)

Use these scripts:
- `/Users/macmini/Trade/Bot/trading/scripts/mt5_csv_sync.sh`
- `/Users/macmini/Trade/Bot/trading/scripts/install_mt5_csv_sync_launchd.sh`

What sync does:
- Download `/csv` from signal.mozasolution.com (requires API_KEY env var)
- Save local copy: `scripts/daemons/tvbridge_signals.csv`
- Overwrite MT5 common file: `.../Terminal/Common/Files/tvbridge_signals.csv`

Run once manually:

```bash
cd /Users/macmini/Trade/Bot/trading
API_KEY="your_signal_api_key" bash scripts/daemons/mt5_csv_sync.sh
```

Install scheduler (every 5 minutes):

```bash
cd /Users/macmini/Trade/Bot/trading
API_KEY="your_signal_api_key" bash scripts/install/install_mt5_csv_sync_launchd.sh
```

Check scheduler status:

```bash
launchctl print "gui/$(id -u)/com.local.mt5csvsync" | sed -n '1,80p'
tail -n 50 "${TMPDIR:-/tmp}/mt5_csv_sync.log"
tail -n 50 "${TMPDIR:-/tmp}/mt5_csv_sync.err.log"
```

Run scheduler job immediately:

```bash
launchctl kickstart -k "gui/$(id -u)/com.local.mt5csvsync"
```

Disable scheduler:

```bash
launchctl unload ~/Library/LaunchAgents/com.local.mt5csvsync.plist
```

Re-enable scheduler:

```bash
launchctl load ~/Library/LaunchAgents/com.local.mt5csvsync.plist
```

## TradingView webhook

URL:
- Preferred: `https://trade.mozasolution.com/webhook/signal/<TV_WEBHOOK_TOKEN>`
- Backward-compatible: `https://trade.mozasolution.com/webhook/signal`

Body example:

```json
{
  "strategy": "Hung-SMC",
  "symbol": "BTCUSDT",
  "side": "BUY",
  "timeframe": "1m",
  "price": 68123.5,
  "sl": 67650,
  "tp": 68950,
  "note": "MSS + SMC"
}
```

Header auth alternative (recommended for non-TV clients):
- `x-api-key: <SIGNAL_API_KEY>`

## MT5 EA endpoints (for EA polling)

- `GET /mt5/ea/pull?account=...` (auth via `x-api-key` header)
- `POST /mt5/ea/ack`
- `GET /mt5/health`
- `GET /v2/bullmq/status`
- `GET /mt5/trades?limit=200&status=NEW` (admin API, add `apiKey` or `x-api-key`)
- `GET /mt5/dashboard/summary` (admin API; KPI cards + latest unprocessed)
- `GET /mt5/dashboard/pnl-series?period=today|week|month` (admin API)
- `GET /mt5/filters/symbols` (admin API)
- `GET /mt5/trades/search?page=1&pageSize=20&symbol=&status=&range=` (admin API)
- `GET /mt5/trades/:signal_id` (admin API; detail + chart levels + `events[]` timeline)
- `GET /csv?apiKey=...&limit=2000&status=&header=1` (admin API, download EA backtest CSV)
- `GET /mt5/csv?apiKey=...&limit=2000&status=&header=1` (same as `/csv`)
- `GET /mt5/ui` (lightweight web monitor, admin protected)
- `POST /mt5/prune` (admin API, optional body: `{"days":14}`)
- `POST /v2/broker/pull` (v2, account API key auth, feature-flagged)
- `POST /v2/broker/ack` (v2, lease-token ack, feature-flagged)
- `POST /v2/broker/sync` (v2, reconcile account snapshot, feature-flagged)
- `POST /v2/broker/heartbeat` (v2 broker liveness update, feature-flagged)
- `POST /v2/broker/trades/create` (v2 broker-originated trade, feature-flagged)
- `GET /v2/accounts` (v2 admin account list)
- `GET /v2/sources` (v2 admin source list)
- `GET /v2/accounts/{account_id}/subscriptions` (v2 admin subscription list)
- `PUT /v2/accounts/{account_id}/subscriptions` (v2 admin replace subscriptions)
- `POST /v2/accounts/{account_id}/api-key/rotate` (v2, admin protected)

## Cron + BullMQ architecture

- Master scheduler: one in-process loop (`mt5CronLoop`) runs every ~60s and orchestrates all active cron rows in DB.
- `ANALYSIS_CRON` and `SNAPSHOT_CRON` execute inline in the webhook process (no BullMQ queue).
- `MARKET_DATA_CRON` can execute via BullMQ queue `market-data-bars` when Redis + queue mode are enabled.
- BullMQ disabled does not stop analysis/snapshot cron; it only affects market-data queue execution mode.

### Health status semantics (UI)

- Green: enabled and healthy (`ok`)
- Gray: intentionally disabled (`disabled`)
- Red: enabled but unhealthy (`error`)

`/health` and `/v2/bullmq/status` are the source of truth for these states.

Open UI:
- `https://<your-domain>/mt5/ui?apiKey=<SIGNAL_API_KEY>`

EA file:
- `/Users/macmini/Trade/Bot/trading/bridge-clients/TVBridgeEA.mq5`

Backtest CSV columns:
- `timestamp;signal_id;action;symbol;volume;sl;tp;note`
- timestamp format is UTC: `YYYY.MM.DD HH:MM:SS`

EA key behavior:
- If `MT5_EA_API_KEYS` is empty, server reuses `SIGNAL_API_KEY`.
- If `MT5_TV_ALERT_API_KEYS` is empty, server reuses `SIGNAL_API_KEY`.
- If `MT5_TV_WEBHOOK_TOKENS` is empty, server reuses `SIGNAL_API_KEY`.
- Legacy fallback controls:
  - `MT5_AUTH_ALLOW_LEGACY_PAYLOAD_KEY=true|false` (default: `true`)
  - `MT5_AUTH_ALLOW_LEGACY_QUERY_KEY=true|false` (default: `true`)
- Execution Hub v2 Phase-2 dual-write toggle:
  - `MT5_V2_DUAL_WRITE_ENABLED=true|false` (default: `false`)
  - when enabled, each new signal is fan-out copied into v2 `trades` for subscribed accounts.
- Execution Hub v2 broker runtime toggles:
  - `MT5_V2_BROKER_API_ENABLED=true|false` (default: `false`)
  - `MT5_V2_LEASE_SECONDS=30` (lease ttl for `/v2/broker/pull`)

MT5 storage options:
- `MT5_STORAGE=sqlite` (default): uses `MT5_DB_PATH` like `./mt5-signals.db`
- `MT5_STORAGE=json`: uses `MT5_DB_PATH` like `./mt5-signals.json`
- `MT5_STORAGE=postgres`: uses `MT5_POSTGRES_URL` (or `POSTGRES_URL` / `POSTGRE_URL`)

Postgres config example (`webhook/.env`):

```env
MT5_STORAGE=postgres
MT5_POSTGRES_URL=postgresql://mt5_user:<password>@127.0.0.1:5432/mt5_bridge
```

Execution Hub v2 backfill helper (postgres):

```bash
cd /Users/macmini/Trade/Bot/trading
node scripts/mt5_v2_backfill.js
```

On VPS (if root workspace has no local `pg` dependency), use:

```bash
cd /opt/trading
NODE_PATH=/opt/trading/webhook/node_modules node scripts/mt5_v2_backfill.js
```

MT5 Postgres schema (created automatically by `server.js`):

```sql
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  password_salt TEXT,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'User',
  metadata JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name TEXT,
  balance DOUBLE PRECISION,
  status TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signals (
  signal_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'default',
  source TEXT,
  action TEXT NOT NULL,
  symbol TEXT NOT NULL,
  volume DOUBLE PRECISION NOT NULL,
  sl DOUBLE PRECISION NULL,
  tp DOUBLE PRECISION NULL,
  source_tf TEXT NULL,
  chart_tf TEXT NULL,
  entry_model TEXT NULL,
  rr_planned DOUBLE PRECISION NULL,
  risk_money_planned DOUBLE PRECISION NULL,
  pnl_money_realized DOUBLE PRECISION NULL,
  entry_price_exec DOUBLE PRECISION NULL,
  sl_exec DOUBLE PRECISION NULL,
  tp_exec DOUBLE PRECISION NULL,
  note TEXT,
  raw_json JSONB,
  status TEXT NOT NULL,
  locked_at TIMESTAMPTZ NULL,
  ack_at TIMESTAMPTZ NULL,
  opened_at TIMESTAMPTZ NULL,
  closed_at TIMESTAMPTZ NULL,
  ack_status TEXT NULL,
  ack_ticket TEXT NULL,
  ack_error TEXT NULL,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_signals_status_created
ON signals(status, created_at);

CREATE TABLE IF NOT EXISTS signal_events (
  id BIGSERIAL PRIMARY KEY,
  signal_id TEXT NOT NULL REFERENCES signals(signal_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_json JSONB,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_signal_events_signal_time
ON signal_events(signal_id, event_time);
```

React UI app (Dashboard + Trades + Trade detail):

```bash
cd /Users/macmini/Trade/Bot/trading/web-ui
npm install
VITE_API_BASE=https://trade.mozasolution.com/webhook npm run dev
```

Production build:

```bash
cd /Users/macmini/Trade/Bot/trading/web-ui
npm run build
```

MT5 prune options:
- `MT5_PRUNE_ENABLED=true|false`
- `MT5_PRUNE_DAYS=14` (delete terminal records older than N days)
- `MT5_PRUNE_INTERVAL_MINUTES=60` (scheduler frequency)
- Prune only affects terminal statuses: `DONE`, `FAILED`, `CANCELED`, `CLOSED_*`

MT5 status lifecycle:
- `NEW`: queued, not pulled yet
- `LOCKED`: already pulled by MT5 EA (dedupe-safe; not pulled again)
- `OK`: acknowledged success / accepted
- `START`: position/order became active
- `FAIL`: execution failure
- `TP`: closed by take profit
- `SL`: closed by stop loss
- `CANCEL`: canceled manually/system
- `EXPIRED`: ignored due to age gate

`/mt5/ea/ack` now accepts status:
- canonical: `OK`, `FAIL`, `START`, `TP`, `SL`, `CANCEL`, `EXPIRED`
- backward compatible aliases: `DONE`, `FAILED`, `CANCELED/CANCELLED`, `CLOSED_TP`, `CLOSED_SL`, `CLOSED_MANUAL`, `CLOSED`

Accounts note:
- `accounts` table exists in DB schema.
- `POST /mt5/ea/heartbeat` requires `account_id` and is intended to upsert account state.
- Current code still contains `TODO` for heartbeat DB upsert, so account records may not auto-update yet.

## Notes

- Telegram is optional. If token/chat id is missing, signal still executes.
- `MT5_DB_PATH=./mt5-signals.db` is a local SQLite file for MT5 queue storage.
- For production with higher throughput, move queue storage to Redis/Postgres if you need horizontal scaling.
- If you use Postgres backend, install dependency: `npm install` (includes `pg`).

## Local Smoke Test (health + db + api + ui)

Run one command from repo root:

```bash
cd /Users/macmini/Trade/Bot/trading
API_KEY=<SIGNAL_API_KEY> \
BASE_URL=http://127.0.0.1:80 \
UI_URL=http://127.0.0.1:5174 \
EXPECT_STORAGE=postgres \
bash scripts/test_local_stack.sh
```

What this script validates:
- `/health`
- `/mt5/health` (and optional storage expectation)
- create signal via `/mt5/tv/webhook`
- pull signal via `/mt5/ea/pull`
- ack signal via `/mt5/ea/ack`
- query trade via `/mt5/trades/:signal_id`
- `/mt5/trades/search`
- `/mt5/dashboard/summary`
- `/mt5/dashboard/pnl-series`
- `/mt5/filters/symbols`
- `/mt5/trades` (legacy endpoint)
- `/csv`
- UI page reachable at `${UI_URL}/dashboard`

Direct Node entrypoint (same test):

```bash
node /Users/macmini/Trade/Bot/trading/scripts/test_local_stack.mjs
```

## Remote UI E2E Test (Playwright)

Run browser-level integration tests against deployed UI/API:

```bash
cd /Users/macmini/Trade/Bot/trading
bash scripts/test_remote_ui.sh
```

What it validates:
- `/dashboard` renders dashboard content (not stuck on loading/error)
- `/trades` renders trade list page (not stuck on loading/error)
- API key and API base are injected from local `webhook/.env` and remote URL defaults

Reports:
- latest: `/Users/macmini/Trade/Bot/trading/test-results/remote-ui-latest.log`
- Playwright HTML report: `/Users/macmini/Trade/Bot/trading/web-ui/playwright-report/index.html`

## Remote API Test Framework (lightweight)

For remote-only validation (VPS URL + live API), use the Node built-in test runner:

- test file: `/Users/macmini/Trade/Bot/trading/tests/remote/mt5-remote.test.mjs`
- runner script: `/Users/macmini/Trade/Bot/trading/scripts/test_remote_api.sh`
- report output directory: `/Users/macmini/Trade/Bot/trading/test-results/`

What it tests:
- TradingView webhook push: `POST /mt5/tv/webhook`
- CSV download: `GET /csv`
- EA pull: `GET /mt5/ea/pull` (supports `signal_id` for deterministic pull)

Run from repo root:

```bash
cd /Users/macmini/Trade/Bot/trading
API_KEY="$(sed -n 's/^SIGNAL_API_KEY=//p' webhook/.env | head -n 1)" \
BASE_URL="https://trade.mozasolution.com/webhook" \
bash scripts/test_remote_api.sh
```

Report files:
- latest: `/Users/macmini/Trade/Bot/trading/test-results/remote-api-latest.log`
- timestamped: `/Users/macmini/Trade/Bot/trading/test-results/remote-api-YYYYMMDD-HHMMSS.log`

## Remote V2 Broker Smoke Test

Use this after enabling:
- `MT5_V2_DUAL_WRITE_ENABLED=true`
- `MT5_V2_BROKER_API_ENABLED=true`

Script:
- `/Users/macmini/Trade/Bot/trading/scripts/test_remote_v2_broker.sh`

Run:

```bash
cd /Users/macmini/Trade/Bot/trading
API_KEY="<ACCOUNT_API_KEY>" \
BASE_URL="https://trade.mozasolution.com/webhook" \
bash scripts/test_remote_v2_broker.sh
```

Sync smoke test:

```bash
cd /Users/macmini/Trade/Bot/trading
API_KEY="<ACCOUNT_API_KEY>" \
BASE_URL="https://trade.mozasolution.com/webhook" \
bash scripts/test_remote_v2_sync.sh
```

Rotate account api key (admin):

```bash
cd /Users/macmini/Trade/Bot/trading
ADMIN_API_KEY="<SIGNAL_API_KEY>" \
ACCOUNT_ID="<ACCOUNT_ID>" \
BASE_URL="https://trade.mozasolution.com/webhook" \
bash scripts/test_remote_v2_rotate.sh
```

Heartbeat + broker-originated trade create:

```bash
cd /Users/macmini/Trade/Bot/trading
API_KEY="<ACCOUNT_API_KEY>" \
BASE_URL="https://trade.mozasolution.com/webhook" \
bash scripts/test_remote_v2_broker_full.sh
```
