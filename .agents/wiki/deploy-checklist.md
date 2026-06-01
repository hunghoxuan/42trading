# Server Deploy Checklist

## Architecture
```
Browser → https://trade.mozasolution.com:443
  → nginx
    → /, /assets/*  → web-ui/dist/ (static SPA)
    → /v2/*, /health, /auth, /mt5/*, /sse/* → proxy → 127.0.0.1:3001 (webhook)
```

## Prerequisites (one-time VPS setup)

- [ ] Node.js 20+ installed
- [ ] PostgreSQL running with `mt5_bridge` database
- [ ] PM2 installed: `npm i -g pm2`
- [ ] nginx installed with SSL certs (Let's Encrypt)
- [ ] `/opt/trading/webhook/.env` configured:
  ```
  PORT=3001
  MT5_STORAGE=postgres
  MT5_POSTGRES_URL=postgresql://user:pass@127.0.0.1:5432/mt5_bridge
  MT5_ENABLED=true
  ```
- [ ] nginx config (`/etc/nginx/sites-enabled/trading.conf`):
  - Serves `web-ui/dist/` on `/`
  - Proxies `/v2/`, `/health`, `/auth/`, `/mt5/`, `/sse/` to `http://127.0.0.1:3001`
- [ ] Git repo cloned to `/opt/trading`

## Deploy Steps

1. **Build web-ui locally**: `npm --prefix web-ui run build`
2. **Push to GitHub**: `git push origin main`
3. **SSH to VPS**: `ssh root@139.59.211.192`
4. **Pull code**: `cd /opt/trading && git pull origin main`
5. **Install deps**: `npm install` (if package.json changed)
6. **Build web-ui**: `cd /opt/trading/web-ui && npm run build`
7. **Restart webhook**: `pm2 restart webhook`
8. **Reload nginx**: `systemctl reload nginx`

Or use the script: `bash scripts/deploy/deploy_webhook.sh`

## Verify

- [ ] `curl -sk https://trade.mozasolution.com/health` → `"ok":true`
- [ ] `curl -sk https://trade.mozasolution.com/` → serves web-ui HTML
- [ ] `ssh root@VPS "pm2 list"` → webhook online, restarts=0
- [ ] `ssh root@VPS "tail -5 /root/.pm2/logs/webhook-out.log"` → no errors

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| 502 Bad Gateway | webhook not running | `pm2 restart webhook` |
| EADDRINUSE :443 | webhook on 443, nginx also needs it | Ensure `.env` has `PORT=3001` |
| MODULE_NOT_FOUND | deps not installed | `npm install` in /opt/trading |
| POSTGRES_URL empty | .env missing or wrong | Check `/opt/trading/webhook/.env` |
| 404 on API | nginx not proxying | Check `/etc/nginx/sites-enabled/trading.conf` |
| Old code running | PM2 not restarted | `pm2 restart webhook --update-env` |
| Stale UI | Vite build not updated | `npm --prefix web-ui run build` on VPS |
