# Start / Restart Scripts

Purpose: start or restart local services with predictable behavior.

## Full Stack

Standard local dev entrypoint (foreground runner for admin + API):

```bash
bash scripts/start/start_dev.sh
```

Behavior note:
- `src/api` on `:3001` is started through `start_api.sh launchctl` as a real LaunchAgent and kept independent from the foreground Vite runner.
- `src/admin` on `:3000` still runs in the foreground with HMR.
- Stopping the `start_dev.sh` terminal should no longer take the API down with it.

Hard reset and relaunch flow (kills stale processes, verifies API health, then relaunches with `launchctl`):

```bash
bash scripts/start/reset_stack_once.sh
```

This reset flow uses raw temporary `launchctl submit` labels:
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

Background shell start:

```bash
bash scripts/start/start_api.sh background
```

LaunchAgent-managed start:

```bash
bash scripts/start/start_api.sh launchctl
```

Verify src/api health:

```bash
bash tests/verify_webhook_local.sh
```

Inspect or repair a recurring local `3001` ownership/health issue:

```bash
bash scripts/start/fix_3001_being_killed.sh inspect
bash scripts/start/fix_3001_being_killed.sh repair
```

Notes:
- [fix_3001_being_killed.md](./fix_3001_being_killed.md)
- confirmed findings there include:
  - old ad-hoc `launchctl submit` ownership was unstable
  - `launchctl --force` previously did not really force a restart
  - JWT session cookies now prevent restart-only logout

## Web UI

Start Vite directly:

```bash
bash scripts/start/start_admin.sh
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
