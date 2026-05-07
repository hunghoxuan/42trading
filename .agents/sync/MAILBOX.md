# MAILBOX

## 2026-05-06 23:12 - DONE
- Task: Rebuild `web-ui` from source directly on VPS for persistent `/trades` blank-page + `SignalDetailCard` runtime error report.
- Action taken:
  - SSH to `root@139.59.211.192`
  - `cd /opt/trading`
  - `git fetch --all --prune && git checkout main && git pull --ff-only origin main`
  - `npm --prefix web-ui install --no-audit --no-fund`
  - `npm --prefix web-ui run build`
  - `pm2 restart webhook`
- Verification:
  - VPS source build completed successfully from commit `9a23a6c`.
  - Built assets on VPS are still `index-BFR1piDZ.js`, `SignalDetailCard-sLd3tzqN.js`, `SymbolChart-BPjEaqx0.js`.
  - VPS `web-ui/dist/index.html` points at `/assets/index-BFR1piDZ.js`.
  - Public health still reports `{"ok":true,"version":"v2026.05.06 19:12 - c3e392e"}`.
- Next agent: If user still sees the same `Cannot access 'O' before initialization` error after hard refresh, investigate the actual module graph/minified output for a remaining circular-init bug in the current source, not deploy drift.

## 2026-05-06 22:55 - DONE
- Task: Restore production fix for `SignalDetailCard` ReferenceError on `/ai/browser/GBPJPY`, `/trades`, `/signals/39`.
- Root cause: Production was serving older build `v2026.05.06 18:59 - 2fab46d` even though `main` already contained the lazy-loading/export hardening shipped in `v2026.05.06 19:12 - c3e392e`.
- Action taken: Rebuilt and redeployed current `main` to VPS with `PUSH_FIRST=0 VPS_APP_DIR=/opt/trading bash scripts/deploy/deploy_webhook.sh`.
- Verification:
  - Local UI build emitted `dist/assets/index-BFR1piDZ.js`, `dist/assets/SignalDetailCard-sLd3tzqN.js`, `dist/assets/SymbolChart-BPjEaqx0.js`.
  - Public health endpoint now reports `{"ok":true,"version":"v2026.05.06 19:12 - c3e392e"}`.
  - Public `/ui/` now references `/assets/index-BFR1piDZ.js`.
- Next agent: If user still sees the error, focus on browser cache/CDN cache invalidation and capture fresh console/network traces from the affected page.
