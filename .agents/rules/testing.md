# Testing Rules

- Run checks matching touched code.
- Backend:
  - `node --check webhook/server.js`
  - After any `webhook/` edit: `bash scripts/start/restart_webhook.sh manual`
  - Verify until healthy: `bash scripts/test/verify_webhook_local.sh`
- UI:
  - `npm --prefix web-ui run build`
- Remote API:
  - `BASE_URL=https://trade.mozasolution.com/webhook bash scripts/test/test_remote_api_default.sh`
- Remote UI:
  - `UI_URL=https://trade.mozasolution.com BASE_URL=https://trade.mozasolution.com/webhook bash scripts/test/test_remote_ui.sh`
- Report actual commands and results.
- If skipped, say why.
