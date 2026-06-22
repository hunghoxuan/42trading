# Start / Restart Scripts

Purpose: start or restart local services with predictable behavior.

## Full Stack (Recommended)

Deterministic local boot (starts `3001` first, verifies, then starts `3000`):

```bash
bash scripts/start/reset_stack_once.sh
```

This uses raw `launchctl submit` labels:
- `trading-src/api-raw`
- `trading-webui-raw`

## Local Host Modes

Run app against local Postgres:

```bash
bash scripts/start/local_host_db.sh
```

Run app against remote VPS Postgres through an SSH tunnel:

```bash
bash scripts/start/local_host_remote_db.sh
```

## Webhook Only

Persistent restart (survives shell exit):

```bash
bash scripts/start/restart_webhook.sh manual
```

Manual restart (plain shell run):

```bash
bash scripts/start/restart_webhook.sh manual
```

Verify src/api health:

```bash
bash tests/verify_webhook_local.sh
```

## Web UI

Start Vite directly:

```bash
bash scripts/start/start_vite.sh
```

## Mobile Access

Expose the local UI to a phone over Tailscale, Cloudflare, or both:

```bash
bash scripts/start/start_mobile_access.sh tailscale
bash scripts/start/start_mobile_access.sh cloudflare
bash scripts/start/start_mobile_access.sh both
bash scripts/start/start_mobile_access.sh tv
bash scripts/start/start_mobile_access.sh all
```

Full usage notes:
- [mobile_access.md](./mobile_access.md)

TradingView/API tunnel notes:
- `tv` exposes local `src/api` on `:3001` for webhook delivery.
- `all` keeps Tailscale UI access and also starts the TradingView API tunnel.
- Set `CF_TV_TUNNEL_HOSTNAME=tv.yourdomain.com` after `cloudflared tunnel login` to use a named tunnel.
- Without a hostname/login, the script falls back to a temporary `trycloudflare.com` URL.
