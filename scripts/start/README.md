# Start / Restart Scripts

Purpose: start or restart local services with predictable behavior.

## Full Stack (Recommended)

Deterministic local boot (starts `3001` first, verifies, then starts `3000`):

```bash
bash scripts/start/reset_stack_once.sh
```

This uses raw `launchctl submit` labels:
- `trading-webhook-raw`
- `trading-webui-raw`

## Webhook Only

Persistent restart (survives shell exit):

```bash
bash scripts/start/restart_webhook.sh manual
```

Manual restart (plain shell run):

```bash
bash scripts/start/restart_webhook.sh manual
```

Verify webhook health:

```bash
bash scripts/test/verify_webhook_local.sh
```

## Web UI

Start Vite directly:

```bash
bash scripts/start/start_vite.sh
```
