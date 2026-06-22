# Testing Rules

- Run checks matching touched code.
- Canonical repo-level test location: `tests/`.
- Do not add new repo-level tests under `scripts/`.
- Do not add new repo-level tests under `tests/` unless the user explicitly asks for them and approves the addition.
- Backend:
  - `node --check src/api/server.js`
  - After any `src/api/` edit: `bash scripts/start/restart_webhook.sh manual`
  - Verify until healthy: `bash tests/verify_webhook_local.sh`
- UI:
  - `npm --prefix src/ui run build`
- Remote API:
  - `BASE_URL=https://trade.mozasolution.com/webhook bash tests/test_remote_api_default.sh`
- Remote UI:
  - `UI_URL=https://trade.mozasolution.com BASE_URL=https://trade.mozasolution.com/webhook bash tests/test_remote_ui.sh`
- Report actual commands and results.
- If skipped, say why.
