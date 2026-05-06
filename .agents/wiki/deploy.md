# Deploy Runbook (Canonical - 2026-04-17)

Project root: `/Users/macmini/Trade/Bot/trading`

This is the source of truth for AI handoff on web surfaces, webhook/API routes, server info, and deployment.

## 1) Web Surface Map

- Landing page:
  - `https://mozasolution.com`
  - `https://www.mozasolution.com`
  - Served from local folder: `/Users/macmini/Trade/Bot/trading/web`
- Trading UI:
  - `https://trade.mozasolution.com`
  - SPA routes example:
    - `https://trade.mozasolution.com/dashboard`
    - `https://trade.mozasolution.com/trades`
  - Built from: `/Users/macmini/Trade/Bot/trading/web-ui`
- Webhook/API root:
  - `https://trade.mozasolution.com/webhook`
  - Health:
    - `https://trade.mozasolution.com/webhook/health`
    - `https://trade.mozasolution.com/webhook/mt5/health`

## 2) Webhook/API List (Required Payload Included)

Base URL (canonical):
- `https://trade.mozasolution.com/webhook`

Main endpoints:
- `POST /signal` (general webhook)
- `POST /signal/<token>` (tokenized general webhook)
- `POST /mt5/tv/webhook` (MT5 TV bridge webhook)
- `POST /mt5/tv/webhook/<token>` (tokenized MT5 TV bridge webhook)
- `GET /mt5/ea/pull?account=<account_id>`
- `POST /mt5/ea/ack`
- `POST /mt5/ea/heartbeat`
- `GET /csv?apiKey=<SIGNAL_API_KEY>&limit=5000`
- `GET /mt5/trades/search?page=1&pageSize=20`

Authentication:
- Prefer header: `x-api-key: <SIGNAL_API_KEY>`
- TradingView token path is supported (`/signal/<token>`, `/mt5/tv/webhook/<token>`)

Required payload for webhook create signal (`POST /signal` or `POST /mt5/tv/webhook`):
- `symbol` (string, example `BTCUSDT`)
- `side` (string: `BUY` or `SELL`)
- `price` (number > 0)

Recommended payload fields:
- `strategy` (string)
- `timeframe` (string)
- `sl` (number)
- `tp` (number)
- `note` (string)
- `quantity` or `volume` (number)
- `user_id` (string)
- `entry_model` (string)

Example payload:
```json
{
  "strategy": "Hung-SMC",
  "symbol": "BTCUSDT",
  "side": "BUY",
  "timeframe": "1m",
  "price": 68123.5,
  "sl": 67650,
  "tp": 68950,
  "note": "MSS + SMC",
  "user_id": "default"
}
```

Required payload for EA ack (`POST /mt5/ea/ack`):
- `signal_id` (string)
- `status` (one of `OK`, `FAIL`, `START`, `TP`, `SL`, `CANCEL`, `EXPIRED`)

Recommended EA ack fields:
- `ticket` (broker ticket)
- `message` / `note`
- `error`

Required payload for EA heartbeat (`POST /mt5/ea/heartbeat`):
- `account_id` (string)

Recommended heartbeat fields:
- `balance`, `equity`, `free_margin`, `broker`, `terminal`, `metadata`

## 3) Server Info (Needed Info + Scripts)

VPS:
- Host: `root@139.59.211.192`
- App dir: `/opt/trading`
- Process manager: `pm2`
- Main process: `webhook` (single process now serves landing + web-ui + API)

TLS:
- Node native HTTPS from `webhook/server.js`
- Certificate path (server env):
  - `/etc/letsencrypt/live/mozasolution.com/fullchain.pem`
  - `/etc/letsencrypt/live/mozasolution.com/privkey.pem`
- SANs include:
  - `mozasolution.com`
  - `www.mozasolution.com`
  - `trade.mozasolution.com`

Key files:
- API server: `/Users/macmini/Trade/Bot/trading/webhook/server.js`
- Landing: `/Users/macmini/Trade/Bot/trading/web/index.html`
- Web UI: `/Users/macmini/Trade/Bot/trading/web-ui`
- Deploy script: `/Users/macmini/Trade/Bot/trading/scripts/deploy_webhook.sh`

Useful scripts:
- Deploy:
  - `bash scripts/deploy_webhook.sh`
- Remote API test:
  - `bash scripts/test_remote_api.sh`
  - `bash scripts/test_remote_api_default.sh`
- Remote UI test:
  - `bash scripts/test_remote_ui.sh`
- Full local stack smoke:
  - `bash scripts/test_local_stack.sh`

## 4) Deploy Guide (Updated)

Local deploy (recommended):
```bash
cd /Users/macmini/Trade/Bot/trading
bash scripts/deploy_webhook.sh
```

If branch is already pushed:
```bash
cd /Users/macmini/Trade/Bot/trading
PUSH_FIRST=0 VPS_APP_DIR=/opt/trading bash scripts/deploy_webhook.sh
```

What deploy script does:
1. SSH to VPS and `git pull` in `/opt/trading`
2. `node --check webhook/server.js`
3. Install webhook deps
4. Build `web-ui`
5. Restart `pm2 webhook`
6. Run health checks against localhost

Post-deploy verification:
```bash
ssh root@139.59.211.192 'pm2 ls'
ssh root@139.59.211.192 'curl -sS https://mozasolution.com | head -n 20'
ssh root@139.59.211.192 'curl -sS https://trade.mozasolution.com/webhook/health'
ssh root@139.59.211.192 'curl -sS https://trade.mozasolution.com/webhook/mt5/health'
```

GitHub Actions:
- Workflow: `/Users/macmini/Trade/Bot/trading/.github/workflows/deploy-webhook.yml`
- Auto triggers on `main` changes in:
  - `webhook/**`
  - `web-ui/**`
  - `web/**`
  - `scripts/deploy_webhook.sh`

## 5) What Changed vs Old Docs

- Old `webhook-ui` is renamed to `web-ui`.
- Old API domain references like `signal.mozasolution.com` are deprecated in runbooks.
- Canonical production API is now:
  - `https://trade.mozasolution.com/webhook`
- Landing moved to apex/www:
  - `https://mozasolution.com`
  - `https://www.mozasolution.com`
